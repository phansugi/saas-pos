/**
 * Uji **pairing vendor marketplace pusatbahanbangunan.com**.
 *
 * Bagian pertama tidak menyentuh jaringan sama sekali: normalisasi email/WA,
 * penyaringan direktori, bentuk kode pairing, hitungan snapshot, path endpoint,
 * serta wiring kartu Pengaturan ke store dan backend. Bagian ini selalu jalan.
 *
 * Bagian kedua **menulis ke deployment** dan hanya berjalan dengan
 * `MARKETPLACE_E2E=1`:
 *
 *   - membuat pemilik + workspace uji,
 *   - membaca direktori **publik** marketplace yang sesungguhnya,
 *   - memasangkan vendor lewat email,
 *   - mengunggah satu gambar produk sungguhan,
 *   - menarik snapshot lewat HTTP dan memeriksa seluruh field produk + gambarnya,
 *   - mendorong katalog produk (upsert per SKU) lewat `syncProducts`,
 *   - memastikan kasir tidak boleh memasangkan,
 *   - melepas pairing lalu memastikan token lama ditolak.
 *
 * Sesudah menjalankannya, bersihkan akun uji dengan `bun run bersih:uji`.
 *
 * Usage:
 *   bun scripts/verify-marketplace-pairing.mjs
 *   MARKETPLACE_E2E=1 bun scripts/verify-marketplace-pairing.mjs
 */
import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../src/convex/_generated/api.js";
import {
  EMPTY_MARKETPLACE_BARCODE_COUNTS,
  EMPTY_MARKETPLACE_CATALOG_COUNTS,
  EMPTY_MARKETPLACE_PRODUCT_COUNTS,
  EMPTY_MARKETPLACE_STOCK_DIFF_COUNTS,
  MARKETPLACE_BARCODE_SYNC_BATCH,
  MARKETPLACE_CATALOG_PRODUCT_LIMIT,
  MARKETPLACE_INBOUND_EVENTS,
  MARKETPLACE_INBOUND_LIMIT,
  MARKETPLACE_INBOUND_PATH,
  MARKETPLACE_ORDER_ID_PREFIX,
  MARKETPLACE_SALE_RECEIPT_LIMIT,
  MARKETPLACE_PRODUCTS_QUERY,
  MARKETPLACE_QUERY_URL_DEFAULT,
  MARKETPLACE_RECONCILE_HOUR_UTC,
  MARKETPLACE_PRODUCT_FIELDS,
  MARKETPLACE_STOCK_DIFF_LABELS,
  MARKETPLACE_STOCK_DIFF_LIMIT,
  MARKETPLACE_STOCK_DIFF_PUSH_LIMIT,
  MARKETPLACE_STOCK_QUEUE_LIMIT,
  filterMarketplaceVendors,
  marketplaceBarcodeSyncNote,
  marketplaceBarcodeSyncSentence,
  marketplaceCatalogImportSentence,
  marketplaceCatalogPushUrl,
  marketplaceCatalogTree,
  marketplaceInboundSentence,
  marketplaceInboundUrl,
  marketplaceOrderKey,
  marketplaceRetryPayload,
  isMarketplaceInboundEvent,
  isMarketplaceOrderBody,
  isMarketplaceSaleKey,
  prepareMarketplaceOrderBody,
  marketplaceReconcileSentence,
  marketplaceStockDiffSentence,
  marketplaceStockPushUrl,
  marketplaceStockSyncSentence,
  decodeMarketplaceBarcode,
  encodeMarketplaceBarcode,
  mergeMarketplaceStockQueue,
  parseMarketplaceCatalogProducts,
  parseMarketplaceStockRows,
  reconcileMarketplaceStock,
  stockDiffPushSkus,
  isMarketplaceSyncToken,
  isPairingCode,
  marketplaceSnapshotCounts,
  marketplaceSnapshotPath,
  pairingCodeFrom,
  parseMarketplaceContact,
  parseMarketplaceContactMatch,
  parseMarketplaceProductPushResponse,
  parseMarketplaceVendorRows,
  planMarketplaceBarcodeSync,
} from "../src/convex/lib/marketplace.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const HERE = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, HERE), "utf8");

/* --------------------------------------------------------- aturan kontak */

const email = parseMarketplaceContact({
  kind: "email",
  value: "  Owner@PusatBahanBangunan.COM ",
});
check("email dinormalkan huruf kecil", email.ok && email.value === "owner@pusatbahanbangunan.com", JSON.stringify(email));
check("email disamarkan", email.ok && email.masked.startsWith("o") && email.masked.endsWith("@pusatbahanbangunan.com"), email.masked);

for (const raw of ["0812-3456-7890", "+62 812-3456-7890", "6281234567890", "81234567890"]) {
  const wa = parseMarketplaceContact({ kind: "whatsapp", value: raw });
  check(`WA ${raw} → 6281234567890`, wa.ok && wa.value === "6281234567890", JSON.stringify(wa));
}
const waMasked = parseMarketplaceContact({ kind: "whatsapp", value: "081234567890" });
check("WA disamarkan tanpa membocorkan tengah", waMasked.ok && waMasked.masked.includes("•") && !waMasked.masked.includes("4567"), waMasked.masked);
check("email tanpa domain ditolak", parseMarketplaceContact({ kind: "email", value: "owner@toko" }).ok === false);
check("WA terlalu pendek ditolak", parseMarketplaceContact({ kind: "whatsapp", value: "0812" }).ok === false);
check("kontak kosong ditolak", parseMarketplaceContact({ kind: "email", value: "  " }).ok === false);

/* ----------------------------------------------------------- kode pairing */

const code = pairingCodeFrom("ab12cd34");
check("kode pairing berbentuk PBB-XXXX-XXXX", code === "PBB-AB12-CD34", code);
check("kode pairing dikenal", isPairingCode(code) === true, code);
check("kode pairing salah ditolak", isPairingCode("PBB-123") === false);

/* ------------------------------------------------------ direktori vendor */

const rawVendors = [
  { _id: "v1", vendorName: "Megah Jaya Bangunan", vendorCity: "Bekasi", productCount: 3, joinedAt: 100, vendorDescription: "Material proyek" },
  { _id: "v1", vendorName: "Duplikat", productCount: 99 },
  { _id: "v2", vendorName: "CV. Mitra Bangunan", vendorCity: "Bandung", productCount: 0, joinedAt: 200 },
  { vendorName: "Tanpa id" },
  { _id: "v3" },
  "bukan objek",
];
const vendors = parseMarketplaceVendorRows(rawVendors);
check("baris vendor tidak sah dibuang", vendors.length === 2, JSON.stringify(vendors));
check("duplikat id dibuang", vendors[0].id === "v1" && vendors[1].id === "v2", JSON.stringify(vendors));
check("nama & kota terbaca", vendors[0].name === "Megah Jaya Bangunan" && vendors[0].city === "Bekasi");
check("pencarian nama cocok", filterMarketplaceVendors(vendors, "mitra").length === 1);
check("pencarian kota cocok", filterMarketplaceVendors(vendors, "bekasi")[0]?.id === "v1");
check("pencarian kosong mengembalikan semua", filterMarketplaceVendors(vendors, "").length === 2);

const match = parseMarketplaceContactMatch({ vendor_id: "v1", name: "Megah Jaya Bangunan", verified: true });
check("balasan pencocokan kontak dibaca", match?.vendorId === "v1" && match.verified === true, JSON.stringify(match));
check("balasan pencocokan rusak ditolak", parseMarketplaceContactMatch({ vendorId: "" }) === null);

/* ------------------------------------------------------------ snapshot */

const counts = marketplaceSnapshotCounts({
  products: [1, 2, 3],
  sales: [1],
  purchases: [],
  payables: [1, 2],
});
check("hitungan snapshot benar", counts.products === 3 && counts.sales === 1 && counts.purchases === 0 && counts.payables === 2, JSON.stringify(counts));
check("path snapshot memuat token", marketplaceSnapshotPath("mp_abc").includes("token=mp_abc"));
check("token produksi dikenali", isMarketplaceSyncToken(`mp_${"a".repeat(48)}`));
check("token pendek ditolak", isMarketplaceSyncToken("mp_abc") === false);

/* --------------------------------------------------- katalog: seluruh field */

const pushCounts = { ...EMPTY_MARKETPLACE_PRODUCT_COUNTS };
check(
  "hitungan dorong katalog mulai dari nol",
  pushCounts.products === 0 && pushCounts.created === 0 && pushCounts.fieldsCreated === 0,
  JSON.stringify(pushCounts),
);

const reported = parseMarketplaceProductPushResponse({
  value: { created: 2, updated: 5, skipped: 1, fields_created: 3 },
});
check(
  "balasan dorong katalog dibaca",
  reported?.created === 2 && reported.updated === 5 && reported.skipped === 1 && reported.fieldsCreated === 3,
  JSON.stringify(reported),
);
check(
  "balasan tanpa hitungan tidak ditebak",
  parseMarketplaceProductPushResponse({ ok: true, message: "diterima" }) === null,
);
check(
  "nama field gaya camelCase juga terbaca",
  parseMarketplaceProductPushResponse({ result: { createdProducts: 4, updatedProducts: 0 } })?.created === 4,
);

/* ------------------------------------- katalog marketplace → MesinPOS (murni) */

check(
  "query katalog vendor benar",
  MARKETPLACE_PRODUCTS_QUERY === "marketplace:getProducts",
  MARKETPLACE_PRODUCTS_QUERY,
);
check(
  "hitungan impor katalog mulai dari nol",
  EMPTY_MARKETPLACE_CATALOG_COUNTS.products === 0 &&
    EMPTY_MARKETPLACE_CATALOG_COUNTS.created === 0 &&
    EMPTY_MARKETPLACE_CATALOG_COUNTS.images === 0 &&
    EMPTY_MARKETPLACE_CATALOG_COUNTS.stock === 0,
  JSON.stringify(EMPTY_MARKETPLACE_CATALOG_COUNTS),
);

const catalogRaw = [
  {
    _id: "p1",
    sku: "PBB-MAT-000001",
    name: "  Semen  Tiga Roda 50 kg ",
    category: "Material  Bangunan",
    subcategory: "Semen & Mortar",
    price: 68000.4,
    stock: 397.6,
    unit: "sak",
    active: true,
    barcode: "  8991234567890 ",
    images: [
      "https://media.pusatbahanbangunan.com/a.jpg",
      "https://media.pusatbahanbangunan.com/a.jpg",
      "javascript:alert(1)",
    ],
  },
  {
    _id: "p1-dup",
    sku: "pbb-mat-000001",
    name: "Duplikat SKU",
    price: 1,
  },
  {
    _id: "p2",
    sku: "PBB-CAT-000002",
    name: "Kuas cat",
    subCategory: "Kuas & Roll",
    category: "Cat & Finishing",
    price: 25000,
    unit: "",
    imageUrl: "https://media.pusatbahanbangunan.com/b.png",
    images: [],
    barcode: "https://supplier.example/label?id=7",
    barcodeType: "QR",
  },
  {
    _id: "p7",
    sku: "PBB-FALLBACK",
    name: "Kode teks di luar Code 39",
    price: 1000,
    barcode: "abc_def",
    barcodeType: "barcode",
  },
  { _id: "p3", name: "Tanpa SKU", price: 1000 },
  { _id: "p4", sku: "PBB-X", name: "", price: 1000 },
  { _id: "p5", sku: "PBB-NEG", name: "Harga negatif", price: -1 },
  { _id: "p6", sku: "PBB-NAN", name: "Harga rusak", price: "gratis" },
  "bukan produk",
];
const catalogProducts = parseMarketplaceCatalogProducts(catalogRaw);
check("baris katalog tidak sah dibuang", catalogProducts.length === 3, JSON.stringify(catalogProducts));
check(
  "SKU duplikat (beda huruf) hanya diambil sekali",
  catalogProducts.filter((row) => row.sku.toLowerCase() === "pbb-mat-000001").length === 1,
  JSON.stringify(catalogProducts.map((row) => row.sku)),
);
const firstCatalog = catalogProducts[0];
check(
  "nama & kategori dirapatkan spasinya",
  firstCatalog.name === "Semen Tiga Roda 50 kg" && firstCatalog.category === "Material Bangunan",
  JSON.stringify(firstCatalog),
);
check(
  "harga & stok dibulatkan ke bilangan bulat",
  firstCatalog.price === 68000 && firstCatalog.stock === 398,
  JSON.stringify({ price: firstCatalog.price, stock: firstCatalog.stock }),
);
check(
  "gambar marketplace disaring & diduplikasi",
  firstCatalog.images.length === 1 &&
    firstCatalog.images[0] === "https://media.pusatbahanbangunan.com/a.jpg",
  JSON.stringify(firstCatalog.images),
);
check(
  "produk tanpa field active tidak dianggap aktif",
  catalogProducts[1].active === null,
  JSON.stringify(catalogProducts[1]),
);
check(
  "satuan kosong menjadi PCS",
  catalogProducts[1].unit === "PCS" && catalogProducts[1].subcategory === "Kuas & Roll",
  JSON.stringify(catalogProducts[1]),
);
check(
  "harga tidak sah tidak menjadi nol diam-diam",
  !catalogProducts.some((row) => row.sku === "PBB-NAN"),
  JSON.stringify(catalogProducts.map((row) => row.sku)),
);

// Barcode/QR ikut dibaca supaya hasil scan di MesinPOS menemukan SKU yang sama.
check(
  "barcode marketplace dibaca & huruf Code 39 dirapikan",
  firstCatalog.barcode === "8991234567890" && firstCatalog.barcodeType === "barcode",
  JSON.stringify({ barcode: firstCatalog.barcode, type: firstCatalog.barcodeType }),
);
check(
  "jenis QR dibaca walau ditulis huruf besar",
  catalogProducts[1].barcode === "https://supplier.example/label?id=7" &&
    catalogProducts[1].barcodeType === "qr",
  JSON.stringify({
    barcode: catalogProducts[1].barcode,
    type: catalogProducts[1].barcodeType,
  }),
);
check(
  "kode di luar Code 39 dibaca sebagai QR, bukan dibuang",
  catalogProducts[2].barcode === "abc_def" && catalogProducts[2].barcodeType === "qr",
  JSON.stringify(catalogProducts[2]),
);
const tanpaBarcode = parseMarketplaceCatalogProducts([
  { sku: "PBB-NOKODE", name: "Tanpa kode", price: 1000 },
]);
check(
  "produk tanpa barcode tetap diimpor tanpa kode karangan",
  tanpaBarcode.length === 1 &&
    tanpaBarcode[0].barcode === null &&
    tanpaBarcode[0].barcodeType === null,
  JSON.stringify(tanpaBarcode),
);
const angkaBarcode = parseMarketplaceCatalogProducts([
  { sku: "PBB-ANGKA", name: "Barcode angka", price: 1000, barcode: 8991234567890 },
]);
check(
  "barcode berbentuk angka dibaca sebagai teks",
  angkaBarcode[0]?.barcode === "8991234567890" &&
    angkaBarcode[0]?.barcodeType === "barcode",
  JSON.stringify(angkaBarcode[0]),
);

// Marketplace menyimpan kode sebagai `code39:PBB-0000005` / `qr:https://…`.
// MesinPOS menyimpan teks kodenya saja + jenisnya, jadi impor harus membuka
// prefix itu — kalau tidak, kolomnya berisi teks yang tidak bisa dipindai.
const berprefix = parseMarketplaceCatalogProducts([
  {
    sku: "PBB-C39",
    name: "Barcode marketplace",
    price: 1000,
    barcode: "code39:PBB-0000008",
    barcodeType: "barcode",
  },
  {
    sku: "PBB-QRPREFIX",
    name: "QR marketplace",
    price: 1000,
    barcode: "qr:https://supplier.example/q",
    barcodeType: "barcode",
  },
]);
check(
  "prefix code39 dibaca sebagai barcode tanpa prefix",
  berprefix[0]?.barcode === "PBB-0000008" &&
    berprefix[0]?.barcodeType === "barcode",
  JSON.stringify(berprefix[0]),
);
check(
  "prefix qr dibaca sebagai QR dengan teks utuh",
  berprefix[1]?.barcode === "https://supplier.example/q" &&
    berprefix[1]?.barcodeType === "qr",
  JSON.stringify(berprefix[1]),
);
check(
  "prefix tak dikenal tidak dibuang dari kode",
  decodeMarketplaceBarcode("https://supplier.example/q", "qr").barcode ===
    "https://supplier.example/q",
  JSON.stringify(decodeMarketplaceBarcode("https://supplier.example/q", "qr")),
);
check(
  "kiriman ke marketplace memakai format prefix yang sama",
  encodeMarketplaceBarcode("PBB-0000005", "barcode") === "code39:PBB-0000005" &&
    encodeMarketplaceBarcode("https://supplier.example/q", "qr") ===
      "qr:https://supplier.example/q",
  JSON.stringify({
    barcode: encodeMarketplaceBarcode("PBB-0000005", "barcode"),
    qr: encodeMarketplaceBarcode("https://supplier.example/q", "qr"),
  }),
);

const catalogTree = marketplaceCatalogTree(catalogProducts);
check(
  "pohon kategori marketplace disusun",
  catalogTree.length === 2 &&
    catalogTree[0].name === "Material Bangunan" &&
    catalogTree[0].subcategories[0] === "Semen & Mortar" &&
    catalogTree[1].subcategories[0] === "Kuas & Roll",
  JSON.stringify(catalogTree),
);
const importSentence = marketplaceCatalogImportSentence({
  ...EMPTY_MARKETPLACE_CATALOG_COUNTS,
  products: 3,
  created: 2,
  updated: 1,
  categories: 2,
  subcategories: 2,
  images: 4,
  stock: 5,
  barcodes: 3,
  barcodeConflicts: 1,
});
check(
  "kalimat hasil impor menyebut angka yang nyata",
  importSentence.includes("2 produk baru") &&
    importSentence.includes("1 diperbarui") &&
    importSentence.includes("2 kategori") &&
    importSentence.includes("4 gambar") &&
    importSentence.includes("5 stok disesuaikan") &&
    importSentence.includes("3 barcode/QR kasir disimpan") &&
    importSentence.includes("1 barcode dilewati karena sudah dipakai"),
  importSentence,
);
check(
  "batas impor sekali tarik jelas",
  MARKETPLACE_CATALOG_PRODUCT_LIMIT >= 100,
  String(MARKETPLACE_CATALOG_PRODUCT_LIMIT),
);

const productFieldKeys = new Set(MARKETPLACE_PRODUCT_FIELDS.map((field) => field.key));
check(
  "barcode & jenisnya ikut dideklarasikan ke marketplace",
  productFieldKeys.has("barcode") && productFieldKeys.has("barcodeType"),
  [...productFieldKeys].join(", "),
);
for (const field of MARKETPLACE_PRODUCT_FIELDS) {
  check(`field ${field.key} dibuat bila belum ada`, field.createIfMissing === true);
}

/* ------------------------------------------- sinkron barcode otomatis (murni) */

check(
  "hitungan sinkron barcode mulai dari nol",
  EMPTY_MARKETPLACE_BARCODE_COUNTS.products === 0 &&
    EMPTY_MARKETPLACE_BARCODE_COUNTS.changed === 0 &&
    EMPTY_MARKETPLACE_BARCODE_COUNTS.conflicts === 0 &&
    EMPTY_MARKETPLACE_BARCODE_COUNTS.missing === 0,
  JSON.stringify(EMPTY_MARKETPLACE_BARCODE_COUNTS),
);

const barcodeLocal = [
  { productId: "p1", sku: "PBB-0000001", barcode: null, barcodeType: null },
  { productId: "p2", sku: "PBB-0000002", barcode: "LAMA-2", barcodeType: "qr" },
  { productId: "p3", sku: "PBB-0000003", barcode: "PBB-0000005", barcodeType: "barcode" },
];
const barcodeMarket = [
  { sku: "pbb-0000001", barcode: "PBB-0000001", barcodeType: "barcode" },
  { sku: "PBB-0000002", barcode: "PBB-0000002", barcodeType: "barcode" },
  { sku: "PBB-0000003", barcode: "PBB-0000005", barcodeType: "barcode" },
  { sku: "PBB-0000001", barcode: "PBB-0000005", barcodeType: "barcode" },
  { sku: "PBB-9999999", barcode: "PBB-9999999", barcodeType: "barcode" },
  { sku: "PBB-0000002", barcode: "", barcodeType: null },
];
const barcodePlan = planMarketplaceBarcodeSync({
  local: barcodeLocal,
  marketplace: barcodeMarket,
});
check(
  "sinkron barcode hanya mengubah kode yang berbeda",
  barcodePlan.counts.products === 5 &&
    barcodePlan.counts.changed === 2 &&
    barcodePlan.counts.unchanged === 1 &&
    barcodePlan.counts.conflicts === 1 &&
    barcodePlan.counts.missing === 1,
  JSON.stringify(barcodePlan.counts),
);
check(
  "produk dicocokkan lewat SKU tanpa beda huruf besar/kecil",
  barcodePlan.updates.length === 2 &&
    barcodePlan.updates.find((row) => row.productId === "p1")?.barcode ===
      "PBB-0000001" &&
    barcodePlan.updates.find((row) => row.productId === "p2")?.barcodeType ===
      "barcode",
  JSON.stringify(barcodePlan.updates),
);
check(
  "rencana sinkron barcode tidak membawa field lain",
  barcodePlan.updates.every(
    (row) =>
      Object.keys(row).sort().join(",") === "barcode,barcodeType,productId,sku",
  ),
  JSON.stringify(barcodePlan.updates),
);
check(
  "kode yang sudah dipakai produk lain tidak direbut",
  !barcodePlan.updates.some((row) => row.barcode === "PBB-0000005"),
  JSON.stringify(barcodePlan.updates),
);
check(
  "SKU marketplace yang belum ada tidak dibuat",
  !barcodePlan.updates.some((row) => row.productId === "PBB-9999999"),
  JSON.stringify(barcodePlan.updates),
);

const barcodeSetelahSinkron = barcodeLocal.map((row) => {
  const update = barcodePlan.updates.find((item) => item.productId === row.productId);
  return update
    ? {
        ...row,
        barcode: update.barcode,
        barcodeType: update.barcodeType,
      }
    : row;
});
const barcodeUlang = planMarketplaceBarcodeSync({
  local: barcodeSetelahSinkron,
  marketplace: barcodeMarket,
});
check(
  "sinkron barcode kedua tidak menulis apa pun lagi",
  barcodeUlang.counts.changed === 0 &&
    barcodeUlang.counts.unchanged === 3 &&
    barcodeUlang.counts.conflicts === 1 &&
    barcodeUlang.counts.missing === 1,
  JSON.stringify(barcodeUlang.counts),
);

const barcodeNote = marketplaceBarcodeSyncNote(barcodePlan.counts);
check(
  "kalimat sinkron barcode menyebut angka & batasnya",
  barcodeNote.includes("2 kode diperbarui") &&
    barcodeNote.includes("1 sudah sama") &&
    barcodeNote.includes("1 dilewati karena sudah dipakai produk lain") &&
    barcodeNote.includes("1 SKU belum ada di MesinPOS") &&
    barcodeNote.includes("Hanya kolom barcode/QR yang ditulis"),
  barcodeNote,
);
check(
  "sinkron barcode tanpa kode di marketplace tidak diklaim mengubah apa pun",
  marketplaceBarcodeSyncNote({ ...EMPTY_MARKETPLACE_BARCODE_COUNTS }).includes(
    "tidak ada yang ditulis",
  ),
);
check(
  "kalimat kartu: belum pernah berjalan",
  marketplaceBarcodeSyncSentence({
    lastBarcodeSyncAt: null,
  }).includes("belum pernah berjalan"),
  marketplaceBarcodeSyncSentence({ lastBarcodeSyncAt: null }),
);
check(
  "kalimat kartu: kegagalan disebut apa adanya",
  marketplaceBarcodeSyncSentence({
    lastBarcodeSyncAt: 1_792_500_000_000,
    lastBarcodeSyncStatus: "failed",
    lastBarcodeSyncNote: "Katalog marketplace tidak bisa dihubungi.",
  }).includes("gagal: Katalog marketplace tidak bisa dihubungi."),
  marketplaceBarcodeSyncSentence({
    lastBarcodeSyncAt: 1_792_500_000_000,
    lastBarcodeSyncStatus: "failed",
    lastBarcodeSyncNote: "Katalog marketplace tidak bisa dihubungi.",
  }),
);
check(
  "kalimat kartu: hasil sinkron menyebut jumlah kode",
  marketplaceBarcodeSyncSentence({
    lastBarcodeSyncAt: 1_792_500_000_000,
    lastBarcodeSyncStatus: "synced",
    lastBarcodeSyncCounts: {
      ...EMPTY_MARKETPLACE_BARCODE_COUNTS,
      products: 4,
      changed: 3,
      unchanged: 1,
    },
  }).includes("3 kode diperbarui, 1 sudah sama"),
  marketplaceBarcodeSyncSentence({
    lastBarcodeSyncAt: 1_792_500_000_000,
    lastBarcodeSyncStatus: "synced",
    lastBarcodeSyncCounts: { ...EMPTY_MARKETPLACE_BARCODE_COUNTS, products: 4, changed: 3, unchanged: 1 },
  }),
);
check(
  "batas workspace sekali putaran jelas",
  MARKETPLACE_BARCODE_SYNC_BATCH >= 1 && MARKETPLACE_BARCODE_SYNC_BATCH <= 50,
  String(MARKETPLACE_BARCODE_SYNC_BATCH),
);

/* ------------------------------------------------ stok otomatis (murni) */

check(
  "endpoint stok memakai kunci khusus kalau diisi",
  marketplaceStockPushUrl({
    PUSATBAHANBANGUNAN_STOCK_URL: " https://marketplace.test/stok ",
    PUSATBAHANBANGUNAN_PRODUCTS_URL: "https://marketplace.test/produk",
  }) === "https://marketplace.test/stok",
);
check(
  "endpoint stok jatuh ke endpoint produk",
  marketplaceStockPushUrl({
    PUSATBAHANBANGUNAN_PRODUCTS_URL: "https://marketplace.test/produk",
    PUSATBAHANBANGUNAN_SYNC_URL: "https://marketplace.test/snapshot",
  }) === "https://marketplace.test/produk",
);
check(
  "endpoint stok jatuh ke endpoint snapshot",
  marketplaceStockPushUrl({ PUSATBAHANBANGUNAN_SYNC_URL: "https://marketplace.test/snapshot" }) ===
    "https://marketplace.test/snapshot",
);
check("tanpa endpoint, dorongan stok tidak berjalan", marketplaceStockPushUrl({}) === "");

const mergedQueue = mergeMarketplaceStockQueue({
  productIds: ["p1", "p2"],
  incoming: ["p2", "p3"],
});
check(
  "antrean stok menggabungkan id tanpa duplikat",
  mergedQueue.productIds.join(",") === "p1,p2,p3" && mergedQueue.pushAll === false,
  JSON.stringify(mergedQueue),
);
const overflowQueue = mergeMarketplaceStockQueue({
  productIds: Array.from({ length: MARKETPLACE_STOCK_QUEUE_LIMIT }, (_, i) => `p${i}`),
  incoming: ["baru"],
});
check(
  "antrean yang lewat batas menjadi kirim seluruh katalog",
  overflowQueue.pushAll === true && overflowQueue.productIds.length === 0,
  JSON.stringify(overflowQueue),
);

const stockSentence = marketplaceStockSyncSentence({
  lastStockSyncAt: Date.UTC(2026, 9, 19, 4, 30),
  lastStockSyncStatus: "delivered",
  lastStockSyncNote: null,
  lastStockSyncCounts: { products: 3, created: 1, updated: 2, skipped: 0, fieldsCreated: 0 },
});
check(
  "kalimat stok otomatis menyebut angka yang nyata",
  stockSentence.includes("3 produk") &&
    stockSentence.includes("2 diperbarui") &&
    stockSentence.includes("1 dibuat"),
  stockSentence,
);
check(
  "stok yang belum pernah terkirim disebut demikian",
  marketplaceStockSyncSentence({
    lastStockSyncAt: null,
    lastStockSyncStatus: null,
    lastStockSyncNote: null,
    lastStockSyncCounts: null,
  }).includes("belum pernah"),
);
const stockFailed = marketplaceStockSyncSentence({
  lastStockSyncAt: Date.UTC(2026, 9, 19, 4, 30),
  lastStockSyncStatus: "failed",
  lastStockSyncNote: "HTTP 500 dari marketplace.",
  lastStockSyncCounts: null,
});
check(
  "kegagalan stok tidak pernah disebut tersinkron",
  stockFailed.includes("gagal") && stockFailed.includes("HTTP 500"),
  stockFailed,
);

/* ------------------------------- pesanan marketplace → MesinPOS (murni) */

check(
  "alamat pesanan marketplace dibangun dari situs Convex deployment",
  marketplaceInboundUrl("https://uji.convex.site/") ===
    `https://uji.convex.site${MARKETPLACE_INBOUND_PATH}` &&
    MARKETPLACE_INBOUND_PATH === "/api/marketplace/orders",
  marketplaceInboundUrl("https://uji.convex.site/"),
);
check(
  "tanpa alamat situs, tidak ada tautan yang dikarang",
  marketplaceInboundUrl("") === "" && marketplaceInboundUrl("   ") === "",
  marketplaceInboundUrl("   "),
);
check(
  "hanya pesanan & pembatalannya yang diterima dari marketplace",
  JSON.stringify(MARKETPLACE_INBOUND_EVENTS) ===
    JSON.stringify(["order.created", "sale.voided"]) &&
    isMarketplaceInboundEvent("order.created") === true &&
    isMarketplaceInboundEvent("sale.voided") === true &&
    isMarketplaceInboundEvent("stock.adjusted") === false &&
    isMarketplaceInboundEvent("product.updated") === false,
  JSON.stringify(MARKETPLACE_INBOUND_EVENTS),
);
check(
  "riwayat pesanan masuk dibatasi",
  MARKETPLACE_INBOUND_LIMIT > 0 && MARKETPLACE_INBOUND_LIMIT <= 20,
  String(MARKETPLACE_INBOUND_LIMIT),
);
const inboundEmpty = marketplaceInboundSentence({ orders: [] });
check(
  "belum ada pesanan disebut apa adanya",
  inboundEmpty === "Belum ada pesanan marketplace yang masuk.",
  inboundEmpty,
);
const inboundApplied = marketplaceInboundSentence({
  orders: [
    {
      orderId: "MP-1001",
      event: "order.created",
      status: "applied",
      saleNumber: "A-00042",
      message: null,
      at: Date.UTC(2026, 9, 22, 3, 15),
    },
  ],
});
check(
  "pesanan yang diterima menyebut nomor nota MesinPOS",
  inboundApplied.includes("MP-1001") && inboundApplied.includes("nota A-00042"),
  inboundApplied,
);
const inboundRejected = marketplaceInboundSentence({
  orders: [
    {
      orderId: "MP-1002",
      event: "order.created",
      status: "rejected",
      saleNumber: null,
      message: "SKU PBB-X tidak ditemukan",
      at: Date.UTC(2026, 9, 22, 3, 20),
    },
  ],
});
check(
  "pesanan yang ditolak menyebut sebabnya",
  inboundRejected.includes("ditolak") && inboundRejected.includes("PBB-X"),
  inboundRejected,
);
check(
  "id pesanan marketplace dinormalkan ke satu bentuk",
  MARKETPLACE_ORDER_ID_PREFIX === "pbb-order-" &&
    marketplaceOrderKey("n973x5qfn") === "pbb-order-n973x5qfn" &&
    marketplaceOrderKey("pbb-order-n973x5qfn") === "pbb-order-n973x5qfn" &&
    marketplaceOrderKey("  pbb-order-a  ") === "pbb-order-a" &&
    marketplaceOrderKey("   ") === "",
  JSON.stringify({
    tanpaPrefiks: marketplaceOrderKey("n973x5qfn"),
    denganPrefiks: marketplaceOrderKey("pbb-order-n973x5qfn"),
  }),
);
check(
  "hanya pesanan bertanda pbb-order- yang disiapkan lebih dulu",
  isMarketplaceOrderBody({ idempotencyKey: "pbb-order-abc" }) === true &&
    isMarketplaceOrderBody({ idempotencyKey: "web-order-0001" }) === false &&
    isMarketplaceOrderBody(null) === false &&
    isMarketplaceOrderBody([]) === false,
  JSON.stringify(
    isMarketplaceOrderBody({ idempotencyKey: "web-order-0001" }),
  ),
);
const marketplaceOrderPrepared = prepareMarketplaceOrderBody({
  idempotencyKey: "pbb-order-uji",
  total: 99_000,
  note: "catatan marketplace",
  lines: [
    {
      sku: "pbb-1",
      name: "Semen Uji",
      quantity: "1",
      price: 50_000,
      imageUrl: "https://media.contoh/a.jpg",
    },
    { sku: "PBB-1", quantity: 1, name: "Semen Uji" },
  ],
  payment: { method: "bank_transfer", amount: "99000", status: "paid" },
  discount: "0",
  customerCode: " b2b-0001 ",
});
check(
  "badan pesanan marketplace: field asing dibuang, baris kembar digabung",
  marketplaceOrderPrepared.total === undefined &&
    marketplaceOrderPrepared.note === undefined &&
    Array.isArray(marketplaceOrderPrepared.lines) &&
    marketplaceOrderPrepared.lines.length === 1 &&
    marketplaceOrderPrepared.lines[0].sku === "pbb-1" &&
    marketplaceOrderPrepared.lines[0].name === "Semen Uji" &&
    marketplaceOrderPrepared.lines[0].quantity === 2 &&
    marketplaceOrderPrepared.lines[0].price === undefined,
  JSON.stringify(marketplaceOrderPrepared),
);
check(
  "badan pesanan marketplace: angka teks & nama metode bayar dipetakan",
  marketplaceOrderPrepared.payment.method === "transfer" &&
    marketplaceOrderPrepared.payment.amount === 99_000 &&
    marketplaceOrderPrepared.payment.status === undefined &&
    marketplaceOrderPrepared.discount === 0 &&
    marketplaceOrderPrepared.customerCode === "b2b-0001",
  JSON.stringify(marketplaceOrderPrepared.payment),
);
check(
  "metode bayar tak dikenal tidak ditebak",
  prepareMarketplaceOrderBody({
    idempotencyKey: "pbb-order-uji",
    payment: { method: "kripto" },
  }).payment.method === "kripto",
  JSON.stringify(
    prepareMarketplaceOrderBody({
      idempotencyKey: "pbb-order-uji",
      payment: { method: "kripto" },
    }).payment,
  ),
);
check(
  "baris dengan modifier berbeda tidak digabung",
  prepareMarketplaceOrderBody({
    idempotencyKey: "pbb-order-uji",
    lines: [
      { sku: "KOPI", quantity: 1, modifiers: [{ groupCode: "LEVEL", optionCodes: ["1"] }] },
      { sku: "KOPI", quantity: 1, modifiers: [{ groupCode: "LEVEL", optionCodes: ["3"] }] },
    ],
    payment: { method: "cash" },
  }).lines.length === 2,
);
check(
  "pesanan non-marketplace tidak disiapkan diam-diam",
  (() => {
    const body = { idempotencyKey: "web-order-0001", total: 99_000 };
    return prepareMarketplaceOrderBody(body) === body;
  })(),
);
check(
  "nota marketplace dikenali dari kunci idempotensinya",
  isMarketplaceSaleKey("api:tenant1:pbb-order-abc", "tenant1") === true &&
    isMarketplaceSaleKey("api:tenant2:pbb-order-abc", "tenant1") === false &&
    isMarketplaceSaleKey("api:tenant1:web-123", "tenant1") === false &&
    isMarketplaceSaleKey("", "tenant1") === false,
);
check(
  "kalimat memakai nota terbaru yang benar-benar tercatat",
  marketplaceInboundSentence({
    orders: [],
    sales: [
      {
        number: "A-00008",
        total: 890_000,
        status: "completed",
        at: Date.UTC(2026, 9, 22, 3, 25),
      },
    ],
  }).includes("nota A-00008"),
);
check(
  "jumlah nota marketplace yang ditampilkan dibatasi",
  MARKETPLACE_SALE_RECEIPT_LIMIT > 0 && MARKETPLACE_SALE_RECEIPT_LIMIT <= 20,
  String(MARKETPLACE_SALE_RECEIPT_LIMIT),
);

/* --------------------------------------------------------------- wiring */

const schema = read("src/convex/schema.ts");
const crons = read("src/convex/crons.ts");
const marketplace = read("src/convex/marketplace.ts");
const marketplaceLib = read("src/convex/lib/marketplace.ts");
const http = read("src/convex/http.ts");
const card = read("src/components/MarketplacePairingCard.tsx");
const settings = read("src/pages/SettingsPage.tsx");
const convexStore = read("src/lib/store/convex.tsx");
const demoStore = read("src/lib/store/demo.tsx");

/* Seluruh kolom tabel `products` harus punya padanan di katalog yang dikirim. */
const productSchemaBlock = schema.slice(
  schema.indexOf("  products: defineTable({"),
  schema.indexOf("  customers: defineTable({"),
);
const schemaProductFields = [...productSchemaBlock.matchAll(/^ {4}(\w+):/gm)].map(
  (match) => match[1],
);
const fieldAlias = { categoryId: "category", subcategoryId: "subcategory" };
check(
  "blok skema produk terbaca",
  schemaProductFields.includes("images") && schemaProductFields.includes("modifiers"),
  schemaProductFields.join(","),
);
const missingFields = schemaProductFields
  .filter((field) => field !== "tenantId")
  .filter((field) => !productFieldKeys.has(fieldAlias[field] ?? field));
check(
  "setiap field produk ikut disalin",
  missingFields.length === 0,
  `belum disalin: ${missingFields.join(", ")}`,
);

check("tabel marketplacePairings ada", schema.includes("marketplacePairings: defineTable"));
check("index token ada", schema.includes('by_token", ["syncToken"]'));
check("endpoint snapshot terdaftar", http.includes('path: "/api/marketplace/snapshot"'));
check("endpoint mencatat tarikan", http.includes("recordPull"));
check("action direktori memanggil query publik", marketplace.includes('path: "vendor:listVendors"'));
check("pairing hanya pemilik", marketplace.includes("ownerOnlyReason"));
const snapshotBuilder = marketplace.slice(
  marketplace.indexOf("async function buildSnapshot"),
  marketplace.indexOf("export const snapshotForToken"),
);
check(
  "snapshot tidak membawa token ke badan",
  snapshotBuilder.length > 0 && !snapshotBuilder.includes("syncToken"),
);
check("katalog mendorong gambar produk", marketplace.includes("ctx.storage.getUrl(storageId)"));
check(
  "snapshot & dorongan membawa barcode kasir dalam format marketplace",
  marketplace.includes("encodeMarketplaceBarcode(") &&
    marketplace.includes("productBarcodeTypeOr(row.barcodeType)") &&
    marketplaceLib.includes("export function decodeMarketplaceBarcode("),
);
check(
  "impor katalog menulis barcode & tidak merebut kode yang sudah dipakai",
  marketplace.includes("changes.barcode = code") &&
    marketplace.includes("barcodeTaken") &&
    schema.includes("barcodeConflicts"),
);
check("katalog menyatakan field yang dibuat", marketplace.includes("productFields: MARKETPLACE_PRODUCT_FIELDS"));
check("dorongan katalog upsert per SKU", marketplace.includes('upsertKey: "sku"') && marketplace.includes("createMissing: true"));
check("action dorong katalog ada", marketplace.includes("export const syncProducts = action("));
check("endpoint dorong katalog bisa diatur", marketplaceLib.includes("PUSATBAHANBANGUNAN_PRODUCTS_URL"));
check("snapshot memuat pohon kategori", marketplace.includes("categories: catalog.categories"));
check("hasil dorong katalog disimpan", schema.includes("lastProductSyncCounts"));
check("snapshot memakai penyusun katalog yang sama", (marketplace.match(/buildProductCatalog\(/g) ?? []).length >= 3);
check("kartu dirender di Pengaturan", settings.includes("<MarketplacePairingCard />"));
check("kartu punya testid", card.includes('data-testid="marketplace-pairing"'));
check("kartu memakai store, bukan Convex langsung", !card.includes("convex/react") && card.includes("useStore()"));
check("convex store menyediakan pairing", convexStore.includes("api.marketplace.pair") && convexStore.includes("syncMarketplaceNow"));
check("demo store menyediakan pairing", demoStore.includes("lookupMarketplaceVendors") && demoStore.includes("syncMarketplaceNow"));
check("convex store menyediakan dorong produk", convexStore.includes("api.marketplace.syncProducts") && convexStore.includes("pushMarketplaceProducts"));
check("demo store menyediakan dorong produk", demoStore.includes("pushMarketplaceProducts"));
check("kartu punya tombol sinkron produk", card.includes('data-testid="marketplace-sync-products"') && card.includes("pushMarketplaceProducts"));
check("kartu melaporkan hasil dorong produk", card.includes('data-testid="marketplace-product-sync-note"'));
check("action impor katalog ada", marketplace.includes("export const pullCatalog = action("));
check("impor memanggil query katalog vendor", marketplace.includes("path: MARKETPLACE_PRODUCTS_QUERY"));
check("impor meng-upsert produk per SKU", marketplace.includes("applyCatalogImport"));
check("impor membuat kategori & subkategori", marketplace.includes('ensureCategory') && marketplace.includes('ensureSubcategory'));
check(
  "stok marketplace disalin ke lokasi jual & tercatat di ledger",
  marketplace.includes('ctx.db.insert("stockLevels"') &&
    marketplace.includes('ctx.db.insert("stockMovements"') &&
    marketplace.includes("Stok produk disalin ke lokasi jual toko utama"),
);
check("hasil impor katalog disimpan", schema.includes("lastCatalogCounts"));
check(
  "sinkron barcode terjadwal terdaftar di cron",
  crons.includes("internal.marketplace.syncAllBarcodes") &&
    crons.includes("MARKETPLACE_BARCODE_SYNC_HOUR_UTC"),
);
check(
  "pekerja barcode hanya menulis kolom barcode",
  marketplace.includes("planMarketplaceBarcodeSync({") &&
    marketplace.includes("barcode: update.barcode") &&
    marketplace.includes("barcodeType: update.barcodeType") &&
    !/applyBarcodeSync[\s\S]{0,2200}?changes\.price/.test(marketplace),
);
check(
  "hasil sinkron barcode disimpan & bisa dijalankan pemilik",
  schema.includes("lastBarcodeSyncAt") &&
    schema.includes("lastBarcodeSyncCounts") &&
    marketplace.includes("export const syncBarcodesNow = action(") &&
    marketplace.includes("export const syncBarcodesForTenant = internalAction("),
);
check(
  "kartu melaporkan sinkron barcode otomatis",
  card.includes('data-testid="marketplace-barcode-sync-note"') &&
    card.includes("marketplaceBarcodeSyncSentence(pairing)"),
);
check("convex store menyediakan impor katalog", convexStore.includes("api.marketplace.pullCatalog") && convexStore.includes("pullMarketplaceCatalog"));
check("demo store menyediakan impor katalog", demoStore.includes("pullMarketplaceCatalog"));
check("kartu punya tombol impor katalog", card.includes('data-testid="marketplace-import-catalog"') && card.includes("pullMarketplaceCatalog"));
check("kartu melaporkan hasil impor katalog", card.includes('data-testid="marketplace-catalog-import-note"'));

/* ------------------------------- pesanan marketplace → MesinPOS (wiring) */

const apiAccessFile = read("src/convex/apiAccess.ts");
const posFile = read("src/convex/pos.ts");

check(
  "tabel pesanan marketplace masuk ada beserta kunci idempotensinya",
  schema.includes("marketplaceInboundOrders: defineTable") &&
    schema.includes('by_pairing_order", ["pairingId", "orderId"]') &&
    schema.includes('by_tenant_created", ["tenantId", "createdAt"]'),
);
check(
  "endpoint penerimaan pesanan marketplace terdaftar",
  http.includes("path: MARKETPLACE_INBOUND_PATH") &&
    http.includes("internal.apiAccess.receiveMarketplaceOrder") &&
    http.includes("isMarketplaceSyncToken(token)") &&
    http.includes('resource: "marketplace.orders"'),
);
check(
  "tanda tangan arah balik diperiksa hanya bila dikirim",
  /if \(headers\.signature\)[\s\S]{0,900}?inboundSignatureProblem/.test(http) &&
    /if \(!auth\.pushSecret\)[\s\S]{0,400}?belum diisi/.test(http),
);
check(
  "pesanan marketplace dicatat sebagai penjualan lewat jalur kasir",
  apiAccessFile.includes("export const receiveMarketplaceOrder = internalMutation(") &&
    /receiveMarketplaceOrder[\s\S]{0,6000}?applyExternalOrder\([\s\S]{0,400}?fromMarketplace: true/.test(
      apiAccessFile,
    ) &&
    apiAccessFile.includes("parseVoidSale(withoutStore)") &&
    apiAccessFile.includes('"./lib/marketplace"'),
);
check(
  "kiriman ulang dengan id pesanan sama tidak membuat penjualan kedua",
  /by_pairing_order[\s\S]{0,700}?duplicate: true/.test(apiAccessFile),
);
check(
  "nota dari marketplace tidak dikabarkan balik sebagai penjualan baru",
  posFile.includes("fromMarketplace: v.optional(v.boolean())") &&
    /args\.fromMarketplace !== true[\s\S]{0,200}?queueMarketplaceSalePush/.test(posFile),
);
check(
  "snapshot memberi marketplace alamat kirim pesanan",
  /inbound: \{\s*url: marketplaceInboundUrl\(process\.env\.CONVEX_SITE_URL/.test(marketplace) &&
    marketplace.includes("MARKETPLACE_INBOUND_LIMIT")
);
check(
  "status pairing membaca riwayat pesanan masuk",
  marketplace.includes("export const inboundAuthForToken = internalQuery(") &&
    /inbound: pairing[\s\S]{0,120}?marketplaceInboundView/.test(marketplace) &&
    marketplace.includes("marketplaceInboundOrders")
);
check(
  "kartu menampilkan alamat & riwayat pesanan marketplace",
  card.includes('data-testid="marketplace-inbound-orders"') &&
    card.includes('data-testid="marketplace-inbound-url"') &&
    card.includes('data-testid="marketplace-inbound-row"') &&
    card.includes('data-testid="marketplace-inbound-sale"') &&
    card.includes('data-testid="marketplace-inbound-note"') &&
    card.includes("marketplaceInboundSentence(marketplace.inbound)") &&
    /Marketplace hanya mengirim pesanan yang sudah/.test(card) &&
    card.includes("Pesanan lunas yang belum masuk MesinPOS") &&
    card.includes("row.message"),
);
check(
  "kartu membaca nota marketplace yang sudah tercatat",
  /marketplaceInboundView[\s\S]{0,2600}?isMarketplaceSaleKey/.test(marketplace) &&
    marketplace.includes("MARKETPLACE_SALE_RECEIPT_LIMIT") &&
    card.includes("marketplace.inbound.sales"),
);
check(
  "isi pesanan tersimpan dibaca dari dua bentuk jalur",
  (() => {
    const langsung = marketplaceRetryPayload(
      JSON.stringify({ id: "a", event: "order.created", data: { lines: [], payment: {} } }),
    );
    const api = marketplaceRetryPayload(
      JSON.stringify({ lines: [], payment: {}, discount: 0 }),
    );
    return (
      langsung?.lines !== undefined &&
      langsung.discount === undefined &&
      api?.lines !== undefined &&
      api.discount === 0 &&
      marketplaceRetryPayload("bukan json") === null &&
      marketplaceRetryPayload("[]") === null &&
      marketplaceRetryPayload("\"teks\"") === null
    );
  })(),
);
check(
  "tombol catat ulang memakai isi pesanan tersimpan, bukan jaringan",
  apiAccessFile.includes("export const retryMarketplaceOrder = mutation(") &&
    apiAccessFile.includes("marketplaceRetryPayload(row.payload)") &&
    apiAccessFile.includes('"marketplace.order.retry"') &&
    /retryMarketplaceOrder[\s\S]{0,3000}?fromMarketplace: true/.test(apiAccessFile),
);
check(
  "kartu punya tombol catat ulang per pesanan yang ditolak",
  card.includes('data-testid="marketplace-inbound-retry"') &&
    card.includes("retryMarketplaceOrder(orderId)") &&
    /row\.status === "rejected"[\s\S]{0,600}?marketplace-inbound-retry/.test(card),
);
check(
  "penolakan lewat /api/v1/sales dicatat supaya sebabnya terbaca di kartu",
  apiAccessFile.includes("recordMarketplaceOrderRejection") &&
    apiAccessFile.includes("MARKETPLACE_ORDER_ID_PREFIX") &&
    /const result = await applyExternalOrder\([\s\S]{0,1200}?recordMarketplaceOrderRejection/.test(
      apiAccessFile,
    ),
);
check(
  "SKU yang tidak ditemukan dicoba lewat nama produk yang unik",
  apiAccessFile.includes("findProductByName") &&
    /findProductBySku\(ctx, actor\.tenantId, line\.sku\)\) \?\?[\s\S]{0,200}?findProductByName\(ctx, actor\.tenantId, line\.name\)/.test(
      apiAccessFile,
    ) &&
    read("src/convex/lib/apiOrders.ts").includes("name?: string"),
);
check(
  "jalur langsung & jalur API memakai kunci pesanan yang sama",
  apiAccessFile.includes("marketplaceOrderKey(orderId)") &&
    apiAccessFile.includes("isOrderIdempotencyKey(canonical)") &&
    read("src/convex/lib/apiOrders.ts").includes("export function isOrderIdempotencyKey"),
);

/* ------------------------------------------- stok otomatis setelah jual */

const stockQueue = read("src/convex/lib/marketplaceStockQueue.ts");
const access = read("src/convex/lib/access.ts");

check("tabel antrean stok marketplace ada", schema.includes("marketplaceStockQueue: defineTable"));
check(
  "hasil dorongan stok otomatis disimpan terpisah",
  schema.includes("lastStockSyncAt") && schema.includes("lastStockSyncCounts"),
);
check(
  "setiap pergerakan stok menitipkan produknya ke antrean",
  access.includes("queueMarketplaceStockPush"),
);
check(
  "hanya pergerakan di lokasi jual yang dikabarkan",
  access.includes("args.warehouseId === undefined"),
);
check(
  "tanpa endpoint & tanpa pairing, antrean tidak ditulis",
  stockQueue.includes("marketplaceStockPushUrl(process.env) === \"\"") &&
    stockQueue.includes('query("marketplacePairings")'),
);
check(
  "antrean stok dijadwalkan sesudah transaksi, bukan di dalamnya",
  stockQueue.includes("ctx.scheduler.runAfter(") &&
    stockQueue.includes("MARKETPLACE_STOCK_DEBOUNCE_MS"),
);
check(
  "action pengirim antrean stok ada",
  marketplace.includes("export const pushQueuedStock = internalAction("),
);
check(
  "antrean dibaca lalu dihapus, bukan sebaliknya",
  marketplace.includes("stockQueueForTenant") &&
    marketplace.includes("clearStockQueue") &&
    marketplace.indexOf("stockQueueForTenant,\n      tenantId: args.tenantId") <
      marketplace.indexOf("clearStockQueue, {"),
);
check(
  "dorongan katalog bisa dibatasi ke SKU yang bergerak",
  marketplace.includes("skus: v.optional(v.array(v.string()))") &&
    marketplace.includes("onlySkus"),
);
check(
  "badan dorongan otomatis memakai bentuk upsert yang sama",
  marketplace.includes("trigger: args.automatic") &&
    marketplace.includes("categories: prepared.catalog.categories"),
);
check(
  "setiap dorongan katalog/stok memakai amplop id + event yang diminta marketplace",
  marketplace.includes("const body = marketplacePushEnvelope({") &&
    marketplaceLib.includes("catalog: \"product.updated\"") &&
    marketplaceLib.includes("stock: \"stock.changed\"") &&
    marketplaceLib.includes("id: marketplacePushEventId({"),
);
check(
  "cron menyapu antrean stok yang tertinggal",
  crons.includes("sweepStockQueues") && crons.includes("MARKETPLACE_STOCK_SWEEP_INTERVAL_MINUTES"),
);
check(
  "kartu melaporkan stok otomatis",
  card.includes('data-testid="marketplace-stock-sync"') &&
    card.includes("marketplaceStockSyncSentence"),
);
check(
  "kartu menyebut endpoint yang belum diisi apa adanya",
  card.includes("pushEndpointReady") && card.includes("PUSATBAHANBANGUNAN_STOCK_URL"),
);
check(
  "store Convex membawa status endpoint dorong",
  convexStore.includes("pushEndpointReady"),
);

/* --------------------------- kategori & subkategori otomatis ke marketplace */

const categoryMutations = read("src/convex/categories.ts");
const subcategoryMutations = read("src/convex/subcategories.ts");

check(
  "endpoint katalog didahulukan dari endpoint stok",
  marketplaceCatalogPushUrl({
    PUSATBAHANBANGUNAN_PRODUCTS_URL: "https://p",
    PUSATBAHANBANGUNAN_SYNC_URL: "https://s",
    PUSATBAHANBANGUNAN_STOCK_URL: "https://k",
  }) === "https://p" &&
    marketplaceCatalogPushUrl({ PUSATBAHANBANGUNAN_STOCK_URL: "https://k" }) === "https://k",
  "urutan endpoint katalog salah",
);
check(
  "antrean kategori menandai kiriman sebagai katalog",
  stockQueue.includes("queueMarketplaceCategoryPush") &&
    stockQueue.includes("catalog: true") &&
    stockQueue.includes("pushAll: true"),
);
check(
  "antrean kategori menghormati endpoint & pairing",
  stockQueue.includes("marketplaceCatalogPushUrl(process.env) === \"\"") &&
    stockQueue.includes('query("marketplacePairings")'),
);
check(
  "setiap perubahan kategori menitipkan kiriman katalog",
  (categoryMutations.match(/queueMarketplaceCategoryPush\(ctx/g) ?? []).length >= 5,
  `${(categoryMutations.match(/queueMarketplaceCategoryPush\(ctx/g) ?? []).length} pemanggilan`,
);
check(
  "setiap perubahan subkategori menitipkan kiriman katalog",
  (subcategoryMutations.match(/queueMarketplaceCategoryPush\(ctx/g) ?? []).length >= 4,
  `${(subcategoryMutations.match(/queueMarketplaceCategoryPush\(ctx/g) ?? []).length} pemanggilan`,
);
check(
  "antrean kategori dikirim dengan event katalog, bukan event stok",
  marketplace.includes("batch.catalog") &&
    marketplace.includes("category: true") &&
    marketplace.includes("MARKETPLACE_PUSH_EVENTS.catalog") &&
    marketplace.includes('trigger: args.automatic ? "stock" : args.category ? "category" : "manual"'),
);
check(
  "status kategori dicatat di lastProductSync, bukan lastStockSync",
  marketplace.includes("if (batch.catalog)") &&
    marketplace.includes("recordProductSync") &&
    marketplace.includes("category: true"),
);
check(
  "kartu menjelaskan kategori & subkategori dikirim sendiri",
  card.includes('data-testid="marketplace-category-sync-note"') &&
    /dikirim sendiri sesudah\s+disimpan/.test(card),
);

/* ------------------------------------------- rekonsiliasi selisih stok */

const clean = reconcileMarketplaceStock({
  pos: [
    { sku: "PBB-SEM-560212", name: "Semen Tiga Roda 50 kg", stock: 382 },
    { sku: "PBB-MAT-339501", name: "Talang Air PVC 4 inch", stock: 109 },
  ],
  marketplace: [
    { sku: "PBB-SEM-560212", name: "Semen Tiga Roda 50 kg", stock: 382 },
    { sku: "PBB-MAT-339501", name: "Talang Air PVC 4 inch", stock: 109 },
  ],
});
check(
  "stok yang sama tidak dilaporkan sebagai selisih",
  clean.counts.matched === 2 &&
    clean.counts.differing === 0 &&
    clean.diffs.length === 0,
  JSON.stringify(clean.counts),
);
check(
  "kalimat rekonsiliasi menyatakan tidak ada selisih",
  marketplaceStockDiffSentence(clean.counts).includes("tidak ada selisih"),
  marketplaceStockDiffSentence(clean.counts),
);

const drifted = reconcileMarketplaceStock({
  pos: [
    { sku: "PBB-SEM-560212", name: "Semen Tiga Roda 50 kg", stock: 382 },
    { sku: "PBB-MAT-339501", name: "Talang Air PVC 4 inch", stock: 109 },
    { sku: "PBB-BARU-000001", name: "Produk hanya di POS", stock: 7 },
  ],
  marketplace: [
    // Beda spasi & huruf besar/kecil: kunci pembanding harus tetap sama.
    { sku: " pbb-sem-560212 ", name: "Semen Tiga Roda 50 kg", stock: 373 },
    { sku: "PBB-MAT-339501", name: "Talang Air PVC 4 inch", stock: 109 },
    { sku: "PBB-MAT-560212", name: "Semen Tiga Roda 50 kg", stock: 373 },
  ],
});
const semRow = drifted.diffs.find((row) => row.sku === "PBB-SEM-560212");
check(
  "selisih saldo dilaporkan dengan arah marketplace − POS",
  drifted.counts.differing === 1 &&
    semRow?.kind === "both" &&
    semRow.posStock === 382 &&
    semRow.marketplaceStock === 373 &&
    semRow.delta === -9,
  JSON.stringify(semRow),
);
check(
  "SKU yang hanya ada di satu sisi dibedakan dari selisih saldo",
  drifted.counts.posOnly === 1 &&
    drifted.counts.marketplaceOnly === 1 &&
    drifted.diffs.some(
      (row) => row.kind === "pos_only" && row.sku === "PBB-BARU-000001",
    ) &&
    drifted.diffs.some(
      (row) =>
        row.kind === "marketplace_only" &&
        row.sku === "PBB-MAT-560212" &&
        row.delta === null,
    ),
  JSON.stringify(drifted.diffs),
);
check(
  "selisih terbesar ditampilkan lebih dulu",
  drifted.diffs[0].sku === "PBB-SEM-560212",
  JSON.stringify(drifted.diffs.map((row) => row.sku)),
);
check(
  "label jenis selisih tersedia untuk kartu",
  MARKETPLACE_STOCK_DIFF_LABELS.both.length > 0 &&
    MARKETPLACE_STOCK_DIFF_LABELS.pos_only.length > 0 &&
    MARKETPLACE_STOCK_DIFF_LABELS.marketplace_only.length > 0,
  JSON.stringify(MARKETPLACE_STOCK_DIFF_LABELS),
);
check(
  "laporan dibatasi & ditandai terpotong",
  (() => {
    const many = Array.from({ length: MARKETPLACE_STOCK_DIFF_LIMIT + 5 }, (_, i) => ({
      sku: `SKU-${i}`,
      name: `Produk ${i}`,
      stock: i + 1,
    }));
    const result = reconcileMarketplaceStock({ pos: many, marketplace: [] });
    return (
      result.diffs.length === MARKETPLACE_STOCK_DIFF_LIMIT &&
      result.counts.truncated === true &&
      result.counts.posOnly === many.length
    );
  })(),
  "batas laporan tidak berlaku",
);

const parsedStockRows = parseMarketplaceStockRows([
  { sku: "A-1", name: "Tanpa harga", stock: 5 },
  { sku: "a-1", name: "Duplikat", stock: 9 },
  { sku: "", name: "Tanpa SKU", stock: 3 },
  { sku: "B-2", name: "Stok negatif", stock: -4.6 },
]);
check(
  "pembaca stok marketplace tidak membuang baris tanpa harga",
  parsedStockRows.length === 2 &&
    parsedStockRows[0].sku === "A-1" &&
    parsedStockRows[0].stock === 5 &&
    parsedStockRows[1].stock === 0,
  JSON.stringify(parsedStockRows),
);

check(
  "kalimat rekonsiliasi menjelaskan belum pernah diperiksa",
  marketplaceReconcileSentence({
    lastReconcileAt: null,
    lastReconcileStatus: null,
    lastReconcileNote: null,
    lastReconcileCounts: null,
  }).includes("belum pernah diperiksa"),
);
check(
  "kalimat rekonsiliasi menyebut kegagalan apa adanya",
  marketplaceReconcileSentence({
    lastReconcileAt: 1_792_500_000_000,
    lastReconcileStatus: "failed",
    lastReconcileNote: "Katalog marketplace tidak bisa dihubungi.",
    lastReconcileCounts: { ...EMPTY_MARKETPLACE_STOCK_DIFF_COUNTS },
  }).includes("gagal"),
);

check(
  "schema punya tabel & kolom laporan selisih",
  schema.includes("marketplaceStockDiffs: defineTable({") &&
    schema.includes("lastReconcileAt: v.optional(v.number())") &&
    schema.includes("lastReconcileCounts: v.optional(") &&
    schema.includes('v.literal("marketplace_only")'),
);
check(
  "backend menyediakan pemeriksaan terjadwal & tombol pemilik",
  marketplace.includes("export const reconcileStock = internalAction(") &&
    marketplace.includes("export const reconcileNow = action(") &&
    marketplace.includes("export const reconcileAllStocks = internalMutation(") &&
    marketplace.includes("gate.canPair") ,
);
check(
  "rekonsiliasi tidak menimpa stok siapa pun",
  !/runStockReconciliation[\s\S]{0,4000}?applyStockChange\(ctx/.test(
    marketplace,
  ) &&
    !/export const recordReconciliation[\s\S]{0,3000}?applyStockChange\(ctx/.test(
      marketplace,
    ),
);
check(
  "pemeriksaan yang gagal tidak menghapus laporan terakhir",
  /if \(args\.status === "checked"\)[\s\S]{0,600}?ctx\.db\.delete/.test(
    marketplace,
  ) &&
    marketplace.includes("Laporan selisih terakhir dipertahankan"),
);
check(
  "saldo yang dibandingkan hanya lokasi jual",
  marketplace.includes("export const stockReconcileState = internalQuery(") &&
    /stockReconcileState[\s\S]{0,2000}warehouseId !== undefined\) continue/.test(
      marketplace,
    ),
);
check(
  "cron harian menjalankan rekonsiliasi",
  crons.includes('"memeriksa selisih stok marketplace"') &&
    crons.includes("internal.marketplace.reconcileAllStocks") &&
    crons.includes("MARKETPLACE_RECONCILE_HOUR_UTC") &&
    MARKETPLACE_RECONCILE_HOUR_UTC >= 0 &&
    MARKETPLACE_RECONCILE_HOUR_UTC <= 23,
);
check(
  "kartu menampilkan laporan selisih per SKU",
  card.includes('data-testid="marketplace-stock-reconcile"') &&
    card.includes('data-testid="marketplace-stock-diff-table"') &&
    card.includes('data-testid="marketplace-reconcile-now"') &&
    card.includes("marketplaceReconcileSentence(pairing)") &&
    card.includes("MARKETPLACE_STOCK_DIFF_LABELS[row.kind]"),
);
/* ------------------------------- kirim stok hanya untuk SKU yang berbeda */

const pushableSkus = stockDiffPushSkus(drifted.diffs);
check(
  "tombol kirim hanya mengambil SKU yang saldonya berbeda",
  JSON.stringify(pushableSkus) === JSON.stringify(["PBB-SEM-560212"]),
  JSON.stringify({ skus: pushableSkus, diffs: drifted.diffs.map((row) => row.kind) }),
);
check(
  "SKU sepihak tidak ikut dikirim",
  !pushableSkus.includes("PBB-BARU-000001") &&
    !pushableSkus.includes("PBB-MAT-560212"),
  JSON.stringify(pushableSkus),
);
check(
  "daftar kiriman dibatasi & duplikat dibuang",
  (() => {
    const rows = [
      { sku: "A", name: "A", posStock: 1, marketplaceStock: 2, delta: 1, kind: "both" },
      { sku: " a ", name: "A", posStock: 1, marketplaceStock: 2, delta: 1, kind: "both" },
      ...Array.from({ length: MARKETPLACE_STOCK_DIFF_PUSH_LIMIT + 5 }, (_, i) => ({
        sku: `B-${i}`,
        name: `B ${i}`,
        posStock: 1,
        marketplaceStock: 0,
        delta: -1,
        kind: "both",
      })),
    ];
    const result = stockDiffPushSkus(rows);
    return (
      result.length === MARKETPLACE_STOCK_DIFF_PUSH_LIMIT &&
      result[0] === "A" &&
      result.filter((sku) => sku.trim().toLowerCase() === "a").length === 1
    );
  })(),
  "batas/duplikat kiriman tidak berlaku",
);
check(
  "laporan tanpa selisih tidak menghasilkan kiriman",
  stockDiffPushSkus([]).length === 0 &&
    stockDiffPushSkus(clean.diffs).length === 0,
);

check(
  "backend punya action kirim stok dari laporan selisih",
  marketplace.includes("export const pushStockDiffs = action(") &&
    marketplace.includes("export const stockDiffsToPush = internalQuery(") &&
    /pushStockDiffs[\s\S]{0,900}?gate\.canPair/.test(marketplace),
);
check(
  "kiriman memakai jalur stok otomatis dengan daftar SKU, bukan katalog penuh",
  /pushCatalogToMarketplace\(ctx, \{\s*tenantId: args\.tenantId,\s*skus: pending\.skus,\s*automatic: true,/.test(
    marketplace,
  ),
);
check(
  "laporan diperiksa ulang hanya kalau kiriman diterima",
  /push\.status === "delivered"[\s\S]{0,120}?runStockReconciliation/.test(
    marketplace,
  ),
);
check(
  "kartu punya tombol kirim stok SKU yang berbeda",
  card.includes('data-testid="marketplace-push-stock-diffs"') &&
    card.includes("pushMarketplaceStockDiffs") &&
    card.includes("Kirim stok") &&
    card.includes('row.kind === "both"'),
);
check(
  "kedua store menyediakan kirim stok dari laporan selisih",
  convexStore.includes("api.marketplace.pushStockDiffs") &&
    convexStore.includes("pushMarketplaceStockDiffs") &&
    demoStore.includes("pushMarketplaceStockDiffs") &&
    demoStore.includes("Mode demo tidak tersambung ke marketplace"),
);

check(
  "backend punya action tarik angka marketplace untuk SKU yang berbeda",
  marketplace.includes("export const pullStockDiffs = action(") &&
    marketplace.includes(
      "export const applyMarketplaceStockBySku = internalMutation(",
    ) &&
    /pullStockDiffs[\s\S]{0,900}?gate\.canPair/.test(marketplace) &&
    /pullStockDiffs[\s\S]{0,2000}?stockDiffsToPush/.test(marketplace),
);
check(
  "tarik angka membaca katalog terbaru, bukan angka tabel yang bisa basi",
  /pullStockDiffs[\s\S]{0,3000}?fetchMarketplaceCatalog\(meta\.vendorId\)/.test(
    marketplace,
  ),
);
check(
  "tarik angka menulis ledger adjustment, bukan lewat applyStockChange",
  /applyMarketplaceStockBySku[\s\S]{0,4000}?reason: "adjustment"/.test(
    marketplace,
  ) &&
    /applyMarketplaceStockBySku[\s\S]{0,2000}?Tarik stok dari laporan selisih marketplace/.test(
      marketplace,
    ) &&
    !/export const applyMarketplaceStockBySku[\s\S]{0,4000}?applyStockChange\(ctx/.test(
      marketplace,
    ),
);
check(
  "kartu punya pilihan arah: kirim stok & tarik angka",
  card.includes('data-testid="marketplace-push-stock-diffs"') &&
    card.includes('data-testid="marketplace-pull-stock-diffs"') &&
    card.includes("Kirim stok") &&
    card.includes("Tarik angka") &&
    card.includes("pullMarketplaceStockDiffs"),
);
check(
  "kedua store menyediakan tarik angka marketplace",
  convexStore.includes("api.marketplace.pullStockDiffs") &&
    convexStore.includes("pullMarketplaceStockDiffs") &&
    demoStore.includes("pullMarketplaceStockDiffs") &&
    demoStore.includes("Mode demo tidak punya katalog marketplace"),
);
check(
  "kedua store menyediakan tombol periksa selisih",
  convexStore.includes("api.marketplace.reconcileNow") &&
    convexStore.includes("reconcileMarketplaceStock") &&
    demoStore.includes("reconcileMarketplaceStock") &&
    demoStore.includes("Mode demo: katalog marketplace tidak dibaca"),
);

/* --------------------------------------------------------------- e2e */

if (process.env.MARKETPLACE_E2E === "1") {
  const url = process.env.VITE_CONVEX_URL;
  if (!url) {
    throw new Error("VITE_CONVEX_URL tidak diset; jalankan `bun convex dev --once` dulu.");
  }
  const site = url.endsWith(".convex.cloud")
    ? `${url.slice(0, -".convex.cloud".length)}.convex.site`
    : url;
  const client = new ConvexHttpClient(url);
  const runId = Date.now();
  const ownerEmail = `marketplace+${runId}@mesinpos.test`;

  const { userId } = await client.mutation(api.users.createOrGet, {
    email: ownerEmail,
    name: "Pemilik Marketplace Uji",
  });
  const { tenantId, storeId } = await client.mutation(api.tenants.create, {
    ownerId: userId,
    name: "Toko Marketplace Uji",
    slug: `marketplace-${runId}`,
    planKey: "professional",
    storeName: "Cabang Marketplace",
    verticals: ["wholesale"],
  });
  const { productId } = await client.mutation(api.products.create, {
    tenantId,
    storeId,
    actorId: userId,
    name: "Semen Uji Marketplace",
    price: 65000,
    unit: "SAK",
    openingStock: 12,
    barcode: "8990001112223",
    barcodeType: "barcode",
  });

  // Gambar produk sungguhan (PNG 1×1): yang diuji adalah jalur unggah → id
  // penyimpanan → URL bertanda tangan di snapshot/katalog, bukan isi gambarnya.
  const uploadUrl = await client.mutation(api.products.generateImageUploadUrl, {
    tenantId,
    actorId: userId,
  });
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const upload = await fetch(uploadUrl, {
    method: "POST",
    headers: { "content-type": "image/png" },
    body: pngBytes,
  });
  const uploaded = await upload.json();
  await client.mutation(api.products.addImage, {
    tenantId,
    actorId: userId,
    productId,
    storageId: uploaded.storageId,
  });

  const before = await client.query(api.marketplace.status, { tenantId, actorId: userId });
  check("workspace baru belum terpasang", before.pairing === null && before.canPair === true, JSON.stringify(before));

  // Pencarian kontak **tidak** boleh menjadi alasan menampilkan seluruh direktori:
  // hasilnya hanya vendor yang marketplace nyatakan cocok, atau kosong + alasan.
  const contactOnly = await client.action(api.marketplace.lookupVendors, {
    tenantId,
    actorId: userId,
    contactKind: "email",
    value: ownerEmail,
  });
  check(
    "pencarian kontak tidak mengembalikan direktori penuh",
    contactOnly.vendors.length <= 1,
    JSON.stringify(contactOnly).slice(0, 300),
  );
  check(
    "pencarian kontak menjawab cocok atau alasan kosong",
    contactOnly.vendors.length === 0
      ? contactOnly.match === null && contactOnly.note.length > 0
      : contactOnly.match?.vendorId === contactOnly.vendors[0].id,
    JSON.stringify(contactOnly).slice(0, 300),
  );

  const tanpaKontak = await client.action(api.marketplace.lookupVendors, {
    tenantId,
    actorId: userId,
    contactKind: "email",
    value: "",
  });
  check(
    "tanpa kontak, belum ada toko yang ditampilkan",
    tanpaKontak.vendors.length === 0 && tanpaKontak.note.length > 0,
    JSON.stringify(tanpaKontak).slice(0, 200),
  );

  // Direktori lengkap hanya lewat permintaan eksplisit pemilik.
  const directory = await client.action(api.marketplace.lookupVendors, {
    tenantId,
    actorId: userId,
    contactKind: "email",
    value: "",
    includeDirectory: true,
  });
  check("direktori marketplace terbaca", directory.vendors.length > 0, JSON.stringify(directory).slice(0, 300));
  check("vendor marketplace punya nama", directory.vendors.every((vendor) => vendor.name.length > 0));
  check("direktori dibuka lewat permintaan eksplisit", directory.source === "directory", directory.source);

  const vendor = directory.vendors[0];
  const paired = await client.mutation(api.marketplace.pair, {
    tenantId,
    actorId: userId,
    vendorId: vendor.id,
    vendorName: vendor.name,
    contactKind: "email",
    contact: ownerEmail,
    contactVerified: contactOnly.match?.vendorId === vendor.id,
  });
  check("pairing mengembalikan kode", isPairingCode(paired.pairing.pairingCode), paired.pairing.pairingCode);
  check("pairing menyimpan token", isMarketplaceSyncToken(paired.pairing.syncToken), paired.pairing.syncToken);
  check("kontak pemilik disamarkan", paired.pairing.contactMasked.includes("*") || paired.pairing.contactMasked.includes("•"), paired.pairing.contactMasked);

  const afterPair = await client.query(api.marketplace.status, { tenantId, actorId: userId });
  check("status membaca pairing", afterPair.pairing?.vendorId === vendor.id, JSON.stringify(afterPair));

  const snapshotUrl = `${site}${marketplaceSnapshotPath(paired.pairing.syncToken)}`;
  const snapshotResponse = await fetch(snapshotUrl);
  check("snapshot menjawab 200", snapshotResponse.status === 200, String(snapshotResponse.status));
  const snapshot = await snapshotResponse.json();
  check("snapshot membawa identitas vendor", snapshot.pairing?.vendorId === vendor.id, JSON.stringify(snapshot.pairing));
  check(
    "snapshot membawa kontak klaim untuk diverifikasi marketplace",
    snapshot.pairing?.contactKind === "email" &&
      snapshot.pairing?.contact === ownerEmail.toLowerCase() &&
      snapshot.pairing?.contactVerified === false,
    JSON.stringify(snapshot.pairing),
  );
  check("snapshot membawa produk", Array.isArray(snapshot.products) && snapshot.products.some((row) => row.name === "Semen Uji Marketplace"), JSON.stringify(snapshot.products).slice(0, 300));

  const productRow = snapshot.products.find((row) => row.name === "Semen Uji Marketplace");
  const expectedFields = [
    "sku",
    "name",
    "barcode",
    "barcodeType",
    "category",
    "subcategory",
    "price",
    "cost",
    "unit",
    "stock",
    "active",
    "trackStock",
    "tiers",
    "units",
    "modifiers",
    "images",
    "imageCount",
    "createdAt",
  ];
  const missingOnWire = productRow
    ? expectedFields.filter((field) => !(field in productRow))
    : expectedFields;
  check("produk membawa seluruh field", missingOnWire.length === 0, `hilang: ${missingOnWire.join(", ")}`);
  check(
    "gambar produk ikut di snapshot",
    Array.isArray(productRow?.images) && productRow.images.length === 1 && productRow.imageCount === 1,
    JSON.stringify(productRow?.images),
  );
  check(
    "stok yang dikirim stok lokasi jual",
    productRow?.stock === 12 && productRow.unit === "SAK",
    JSON.stringify({ stock: productRow?.stock, unit: productRow?.unit }),
  );
  check(
    "barcode/QR kasir ikut ke marketplace dalam format marketplace",
    productRow?.barcode === "code39:8990001112223" &&
      productRow?.barcodeType === "barcode",
    JSON.stringify({
      barcode: productRow?.barcode,
      type: productRow?.barcodeType,
    }),
  );
  const imageFetch = await fetch(productRow.images[0]);
  check(
    "URL gambar bisa diunduh marketplace",
    imageFetch.status === 200 && Number(imageFetch.headers.get("content-length") ?? pngBytes.length) > 0,
    String(imageFetch.status),
  );
  check(
    "snapshot menyatakan upsert & pembuatan field",
    snapshot.sync?.mode === "upsert" &&
      snapshot.sync?.upsertKey === "sku" &&
      snapshot.sync?.createMissing === true &&
      snapshot.productFields?.length === MARKETPLACE_PRODUCT_FIELDS.length,
    JSON.stringify(snapshot.sync),
  );
  check("snapshot membawa pohon kategori", Array.isArray(snapshot.categories), JSON.stringify(snapshot.categories)?.slice(0, 200));
  check("snapshot tidak menandai gambar terpotong", snapshot.truncated?.images === false, JSON.stringify(snapshot.truncated));
  check("snapshot tidak membocorkan token", !JSON.stringify(snapshot).includes(paired.pairing.syncToken));
  check("snapshot menghitung baris", snapshot.counts?.products >= 1, JSON.stringify(snapshot.counts));

  const afterPull = await client.query(api.marketplace.status, { tenantId, actorId: userId });
  check("tarikan tercatat di kartu", typeof afterPull.pairing?.lastPullAt === "number" && afterPull.pairing.lastPullCounts.products >= 1, JSON.stringify(afterPull.pairing?.lastPullCounts));

  // Kasir tidak boleh memasangkan / melepas.
  const cashierEmail = `marketplace-kasir+${runId}@mesinpos.test`;
  const { userId: cashierId } = await client.mutation(api.users.createOrGet, {
    email: cashierEmail,
    name: "Kasir Marketplace Uji",
  });
  await client.mutation(api.members.add, {
    tenantId,
    actorId: userId,
    email: cashierEmail,
    name: "Kasir Marketplace Uji",
    role: "cashier",
  });
  const cashierStatus = await client.query(api.marketplace.status, {
    tenantId,
    actorId: cashierId,
  });
  check("kasir bisa membaca status", cashierStatus.pairing?.vendorId === vendor.id);
  check("kasir tidak boleh memasangkan", cashierStatus.canPair === false, JSON.stringify(cashierStatus));
  let denied = false;
  try {
    await client.mutation(api.marketplace.unpair, { tenantId, actorId: cashierId });
  } catch {
    denied = true;
  }
  check("kasir ditolak saat melepas pairing", denied);

  let productPushDenied = false;
  try {
    await client.action(api.marketplace.syncProducts, {
      tenantId,
      actorId: cashierId,
    });
  } catch {
    productPushDenied = true;
  }
  check("kasir ditolak saat menyinkronkan produk", productPushDenied);

  const syncResult = await client.action(api.marketplace.syncNow, {
    tenantId,
    actorId: userId,
  });
  check("tombol sinkron menyusun snapshot", syncResult.counts.products >= 1, JSON.stringify(syncResult));
  // Deployment bisa berada di dua keadaan: endpoint dorong belum diisi (`ready`,
  // snapshot tetap bisa ditarik) atau sudah diisi (kiriman dicoba dan bisa
  // ditolak penerima). Yang diuji bukan keadaan lingkungannya, melainkan
  // kejujurannya: tanpa penerimaan, status tidak boleh "delivered".
  check(
    "dorongan snapshot tidak diklaim terkirim tanpa penerimaan",
    syncResult.delivered === false &&
      (syncResult.status === "ready" || syncResult.status === "failed"),
    JSON.stringify(syncResult),
  );

  const productPush = await client.action(api.marketplace.syncProducts, {
    tenantId,
    actorId: userId,
  });
  check(
    "dorong katalog menyusun seluruh produk",
    productPush.counts.products === snapshot.products.length,
    JSON.stringify(productPush.counts),
  );
  check(
    "dorongan katalog tidak diklaim terkirim tanpa penerimaan",
    productPush.delivered === false &&
      (productPush.status === "ready" || productPush.status === "failed") &&
      (productPush.status !== "failed" || /HTTP \d{3}/.test(productPush.note)),
    JSON.stringify(productPush),
  );
  check(
    "catatan dorong menyebut gambar & seluruh field, atau sebab penolakan",
    productPush.status === "failed"
      ? /HTTP \d{3}/.test(productPush.note)
      : productPush.note.includes("gambar") &&
          productPush.note.includes("field"),
    productPush.note,
  );

  const afterProductPush = await client.query(api.marketplace.status, {
    tenantId,
    actorId: userId,
  });
  check(
    "hasil dorong produk tercatat di kartu",
    afterProductPush.pairing?.lastProductSyncStatus === productPush.status &&
      afterProductPush.pairing.lastProductSyncCounts.products === productPush.counts.products,
    JSON.stringify(afterProductPush.pairing?.lastProductSyncCounts),
  );

  /* ------------------------------------------------ katalog marketplace → POS */

  // Katalog sumber dibaca langsung dari query publik yang sama, supaya
  // pemeriksaan memakai angka yang benar-benar ada di marketplace — bukan tebakan.
  const sourceResponse = await fetch(
    `${MARKETPLACE_QUERY_URL_DEFAULT}/api/query`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: MARKETPLACE_PRODUCTS_QUERY,
        args: { vendorId: vendor.id },
        format: "json",
      }),
    },
  );
  const sourceBody = await sourceResponse.json();
  const sourceRows = parseMarketplaceCatalogProducts(sourceBody.value);
  check(
    "katalog vendor marketplace terbaca",
    sourceResponse.status === 200 && sourceRows.length > 0,
    JSON.stringify(sourceBody).slice(0, 300),
  );

  let catalogDenied = false;
  try {
    await client.action(api.marketplace.pullCatalog, {
      tenantId,
      actorId: cashierId,
    });
  } catch {
    catalogDenied = true;
  }
  check("kasir ditolak saat mengimpor katalog", catalogDenied);

  const firstCatalogPull = await client.action(api.marketplace.pullCatalog, {
    tenantId,
    actorId: userId,
  });
  check(
    "impor katalog marketplace berhasil",
    firstCatalogPull.status === "imported",
    JSON.stringify(firstCatalogPull),
  );
  check(
    "produk marketplace dibuat di MesinPOS",
    firstCatalogPull.counts.created > 0 &&
      firstCatalogPull.counts.products === sourceRows.length,
    JSON.stringify(firstCatalogPull.counts),
  );
  check(
    "kategori & subkategori marketplace dibuat",
    firstCatalogPull.counts.categories > 0 &&
      firstCatalogPull.counts.subcategories > 0,
    JSON.stringify(firstCatalogPull.counts),
  );
  check(
    "gambar marketplace disimpan ke penyimpanan MesinPOS",
    firstCatalogPull.counts.images > 0,
    JSON.stringify(firstCatalogPull.counts),
  );
  const sourceWithBarcode = sourceRows.filter((row) => row.barcode).length;
  check(
    "setiap barcode marketplace disimpan atau dilaporkan bentrok",
    firstCatalogPull.counts.barcodes + firstCatalogPull.counts.barcodeConflicts ===
      sourceWithBarcode,
    JSON.stringify({
      disimpan: firstCatalogPull.counts.barcodes,
      bentrok: firstCatalogPull.counts.barcodeConflicts,
      sumber: sourceWithBarcode,
    }),
  );

  const catalogSnapshotResponse = await fetch(snapshotUrl);
  const catalogSnapshot = await catalogSnapshotResponse.json();
  const importedRow = catalogSnapshot.products.find(
    (row) => row.sku === sourceRows[0].sku,
  );
  check(
    "produk marketplace masuk katalog lokal",
    Boolean(importedRow) &&
      importedRow.name === sourceRows[0].name &&
      importedRow.price === sourceRows[0].price,
    JSON.stringify({ importedRow, source: sourceRows[0] }).slice(0, 500),
  );
  check(
    "kategori & subkategori produk ikut masuk",
    importedRow.category === sourceRows[0].category &&
      importedRow.subcategory === sourceRows[0].subcategory,
    JSON.stringify({
      category: importedRow.category,
      subcategory: importedRow.subcategory,
    }),
  );
  // Snapshot berbicara dalam format marketplace (`code39:…`), jadi yang dibaca
  // kartu produk adalah teks kodenya setelah prefix dibuka.
  const barcodeTersimpan = importedRow.barcode
    ? decodeMarketplaceBarcode(importedRow.barcode, importedRow.barcodeType)
    : { barcode: "", barcodeType: null };
  check(
    "barcode marketplace ikut tersimpan di POS",
    (barcodeTersimpan.barcode === "" ? null : barcodeTersimpan.barcode) ===
      (sourceRows[0].barcode ?? null) &&
      (sourceRows[0].barcode === null ||
        barcodeTersimpan.barcodeType === sourceRows[0].barcodeType),
    JSON.stringify({
      barcode: barcodeTersimpan.barcode,
      type: barcodeTersimpan.barcodeType,
      tersimpanDiSnapshot: importedRow.barcode,
      sumber: sourceRows[0].barcode,
    }),
  );
  check(
    "prefix simbol marketplace tidak ikut tersimpan",
    sourceRows.every(
      (row) => !row.barcode || !/^(code39|qr|code128|ean13):/i.test(row.barcode),
    ),
    JSON.stringify(sourceRows.map((row) => row.barcode).slice(0, 3)),
  );
  check(
    "stok marketplace ikut tersinkron ke POS",
    importedRow.stock === sourceRows[0].stock &&
      firstCatalogPull.counts.stock > 0 &&
      (importedRow.images?.length ?? 0) > 0,
    JSON.stringify({
      stock: importedRow.stock,
      marketplace: sourceRows[0].stock,
      disesuaikan: firstCatalogPull.counts.stock,
      images: importedRow.images?.length,
    }),
  );
  check(
    "kategori baru muncul di pohon katalog MesinPOS",
    catalogSnapshot.categories.some(
      (row) => row.name === sourceRows[0].category,
    ),
    JSON.stringify(catalogSnapshot.categories).slice(0, 300),
  );

  const secondCatalogPull = await client.action(api.marketplace.pullCatalog, {
    tenantId,
    actorId: userId,
  });
  check(
    "impor ulang tidak menggandakan produk maupun menggeser stok lagi",
    secondCatalogPull.counts.created === 0 &&
      secondCatalogPull.counts.updated === 0 &&
      secondCatalogPull.counts.stock === 0 &&
      secondCatalogPull.counts.barcodes === 0 &&
      secondCatalogPull.counts.unchanged === secondCatalogPull.counts.products,
    JSON.stringify(secondCatalogPull.counts),
  );

  /* ------------------------------------ sinkron barcode otomatis */

  // Kode dari marketplace sengaja dirusak di POS, lalu pekerja sinkron yang
  // sama dengan cron dipanggil: yang boleh berubah hanya kolom barcode/QR.
  const barcodeTarget = sourceRows.find((row) => row.barcode);
  check(
    "katalog marketplace punya barcode untuk diuji",
    Boolean(barcodeTarget),
    JSON.stringify(sourceRows.map((row) => row.barcode).slice(0, 3)),
  );

  const localBeforeBarcode = await client.query(api.products.listAll, {
    tenantId,
    storeId,
    actorId: userId,
  });
  const targetLocal = localBeforeBarcode.find(
    (row) => row.sku === barcodeTarget.sku,
  );
  check(
    "produk marketplace ada di POS untuk diuji barcode",
    Boolean(targetLocal),
    JSON.stringify(localBeforeBarcode.map((row) => row.sku).slice(0, 5)),
  );

  await client.mutation(api.products.setBarcode, {
    tenantId,
    actorId: userId,
    productId: targetLocal._id,
    barcode: "SALAH-1",
    barcodeType: "barcode",
  });

  let barcodeDenied = false;
  try {
    await client.action(api.marketplace.syncBarcodesNow, {
      tenantId,
      actorId: cashierId,
    });
  } catch {
    barcodeDenied = true;
  }
  check("kasir ditolak saat menyinkronkan barcode", barcodeDenied);

  const barcodeSync = await client.action(api.marketplace.syncBarcodesNow, {
    tenantId,
    actorId: userId,
  });
  check(
    "sinkron barcode otomatis berjalan atas katalog marketplace",
    barcodeSync.status === "synced" && barcodeSync.counts.products > 0,
    JSON.stringify(barcodeSync),
  );

  const localAfterBarcode = await client.query(api.products.listAll, {
    tenantId,
    storeId,
    actorId: userId,
  });
  const targetAfter = localAfterBarcode.find(
    (row) => row._id === targetLocal._id,
  );
  check(
    "barcode dipulihkan dari marketplace",
    targetAfter?.barcode === barcodeTarget.barcode &&
      targetAfter?.barcodeType === barcodeTarget.barcodeType &&
      barcodeSync.counts.changed >= 1,
    JSON.stringify({
      sesudah: targetAfter?.barcode,
      tipe: targetAfter?.barcodeType,
      marketplace: barcodeTarget.barcode,
      counts: barcodeSync.counts,
    }),
  );
  check(
    "sinkron barcode tidak membuat produk & tidak mengubah field lain",
    localAfterBarcode.length === localBeforeBarcode.length &&
      targetAfter?.name === targetLocal.name &&
      targetAfter?.price === targetLocal.price &&
      targetAfter?.stock === targetLocal.stock,
    JSON.stringify({
      sebelum: localBeforeBarcode.length,
      sesudah: localAfterBarcode.length,
      nama: targetAfter?.name,
      harga: targetAfter?.price,
      stok: targetAfter?.stock,
    }),
  );

  const barcodeAfterStatus = await client.query(api.marketplace.status, {
    tenantId,
    actorId: userId,
  });
  check(
    "hasil sinkron barcode tercatat di kartu",
    barcodeAfterStatus.pairing?.lastBarcodeSyncStatus === "synced" &&
      (barcodeAfterStatus.pairing?.lastBarcodeSyncCounts?.products ?? 0) > 0,
    JSON.stringify(barcodeAfterStatus.pairing?.lastBarcodeSyncCounts),
  );

  const afterCatalog = await client.query(api.marketplace.status, {
    tenantId,
    actorId: userId,
  });
  check(
    "hasil impor katalog tercatat di kartu",
    afterCatalog.pairing?.lastCatalogStatus === "imported" &&
      typeof afterCatalog.pairing.lastCatalogAt === "number" &&
      afterCatalog.pairing.lastCatalogCounts.products ===
        firstCatalogPull.counts.products,
    JSON.stringify(afterCatalog.pairing?.lastCatalogCounts),
  );

  /* ------------------------------------ rekonsiliasi stok per SKU */

  // Sesudah impor, kedua sisi memakai angka yang sama — pemeriksaan harus
  // mengatakannya apa adanya, bukan mengarang selisih.
  const cleanReconcile = await client.action(api.marketplace.reconcileNow, {
    tenantId,
    actorId: userId,
  });
  check(
    "rekonsiliasi menyatakan stok sama sesudah impor",
    cleanReconcile.status === "checked" &&
      cleanReconcile.counts.matched >= 1 &&
      cleanReconcile.counts.differing === 0 &&
      cleanReconcile.diffs.length === 0,
    JSON.stringify(cleanReconcile.counts),
  );

  let reconcileDenied = false;
  try {
    await client.action(api.marketplace.reconcileNow, {
      tenantId,
      actorId: cashierId,
    });
  } catch {
    reconcileDenied = true;
  }
  check("kasir ditolak saat memeriksa selisih stok", reconcileDenied);

  const localForDrift = await client.query(api.products.listAll, {
    tenantId,
    storeId,
    actorId: userId,
  });
  const driftProduct = localForDrift.find(
    (row) => row.sku === sourceRows[0].sku,
  );
  await client.mutation(api.products.adjustStock, {
    tenantId,
    storeId,
    productId: driftProduct._id,
    delta: 2,
    note: "Uji rekonsiliasi stok",
    actorId: userId,
  });

  const drifted = await client.action(api.marketplace.reconcileNow, {
    tenantId,
    actorId: userId,
  });
  const driftRow = drifted.diffs.find(
    (row) => row.sku === sourceRows[0].sku,
  );
  check(
    "selisih stok dilaporkan per SKU dengan arah yang benar",
    drifted.counts.differing >= 1 &&
      driftRow?.kind === "both" &&
      driftRow.posStock === driftProduct.stock + 2 &&
      driftRow.delta === driftRow.marketplaceStock - driftRow.posStock &&
      driftRow.delta !== 0,
    JSON.stringify(driftRow),
  );

  const driftStatus = await client.query(api.marketplace.status, {
    tenantId,
    actorId: userId,
  });
  check(
    "baris selisih tersimpan & terbaca kartu",
    (driftStatus.pairing?.stockDiffs ?? []).some(
      (row) => row.sku === sourceRows[0].sku,
    ),
    JSON.stringify(driftStatus.pairing?.stockDiffs),
  );
  check(
    "catatan menyebut selisih tidak ditimpa otomatis",
    typeof driftStatus.pairing?.lastReconcileNote === "string" &&
      driftStatus.pairing.lastReconcileNote.includes("tidak ditimpa otomatis"),
    driftStatus.pairing?.lastReconcileNote ?? "",
  );

  // Pemeriksaan hanya membaca: saldo lokal tidak boleh bergeser karenanya.
  const afterReconcileStock = await client.query(api.products.listAll, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "pemeriksaan tidak mengubah stok siapa pun",
    afterReconcileStock.find((row) => row.sku === sourceRows[0].sku)?.stock ===
      driftProduct.stock + 2,
    JSON.stringify({
      sesudah: afterReconcileStock.find((row) => row.sku === sourceRows[0].sku)
        ?.stock,
      sebelum: driftProduct.stock + 2,
    }),
  );

  // Tombol “Kirim stok N SKU”: hanya SKU yang berbeda yang berangkat.
  const diffPush = await client.action(api.marketplace.pushStockDiffs, {
    tenantId,
    actorId: userId,
  });
  check(
    "kirim stok hanya membawa SKU yang saldonya berbeda",
    diffPush.skus.length === 1 &&
      diffPush.skus[0] === sourceRows[0].sku &&
      diffPush.push.counts.products === 1,
    JSON.stringify({ skus: diffPush.skus, counts: diffPush.push.counts }),
  );
  check(
    "kiriman tanpa penerima tidak diklaim terkirim",
    diffPush.push.delivered === false &&
      (diffPush.push.status === "ready" || diffPush.push.status === "failed"),
    JSON.stringify(diffPush.push),
  );

  let diffPushDenied = false;
  try {
    await client.action(api.marketplace.pushStockDiffs, {
      tenantId,
      actorId: cashierId,
    });
  } catch {
    diffPushDenied = true;
  }
  check("kasir ditolak saat mengirim stok dari laporan selisih", diffPushDenied);

  const restoredForReconcile = await client.action(api.marketplace.pullCatalog, {
    tenantId,
    actorId: userId,
  });
  const cleanAgain = await client.action(api.marketplace.reconcileNow, {
    tenantId,
    actorId: userId,
  });
  check(
    "sesudah disamakan, laporan kembali bersih",
    restoredForReconcile.counts.stock === 1 &&
      cleanAgain.counts.differing === 0 &&
      cleanAgain.diffs.length === 0,
    JSON.stringify({
      impor: restoredForReconcile.counts,
      selisih: cleanAgain.counts,
    }),
  );

  // Arah kedua: tarik angka marketplace hanya untuk SKU yang berbeda.
  await client.mutation(api.products.adjustStock, {
    tenantId,
    storeId,
    productId: driftProduct._id,
    delta: 3,
    note: "Uji tarik angka marketplace",
    actorId: userId,
  });
  // Tombol bekerja atas **laporan terakhir**, jadi selisihnya dideteksi dulu —
  // sama seperti pemilik yang menekan “Periksa sekarang” sebelum menarik angka.
  await client.action(api.marketplace.reconcileNow, { tenantId, actorId: userId });
  const pull = await client.action(api.marketplace.pullStockDiffs, {
    tenantId,
    actorId: userId,
  });
  const afterPullLocal = await client.query(api.products.listAll, {
    tenantId,
    storeId,
    actorId: userId,
  });

  const liveResponse = await fetch(
    `${MARKETPLACE_QUERY_URL_DEFAULT}/api/query`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: MARKETPLACE_PRODUCTS_QUERY,
        args: { vendorId: vendor.id },
        format: "json",
      }),
    },
  );
  const liveBody = await liveResponse.json();
  const liveRow = parseMarketplaceStockRows(liveBody.value).find(
    (row) => row.sku === sourceRows[0].sku,
  );

  check(
    "tarik angka hanya menyentuh SKU yang saldonya berbeda",
    pull.counts.requested === 1 &&
      pull.counts.adjusted === 1 &&
      pull.skus.length === 1 &&
      pull.skus[0] === sourceRows[0].sku,
    JSON.stringify({ counts: pull.counts, skus: pull.skus }),
  );
  check(
    "saldo POS jadi sama dengan angka marketplace",
    typeof liveRow?.stock === "number" &&
      afterPullLocal.find((row) => row.sku === sourceRows[0].sku)?.stock ===
        liveRow.stock,
    JSON.stringify({
      pos: afterPullLocal.find((row) => row.sku === sourceRows[0].sku)?.stock,
      marketplace: liveRow?.stock,
    }),
  );
  check(
    "laporan langsung bersih sesudah tarik angka",
    (pull.reconcile?.counts.differing ?? -1) === 0,
    JSON.stringify(pull.reconcile?.counts),
  );

  let pullDenied = false;
  try {
    await client.action(api.marketplace.pullStockDiffs, {
      tenantId,
      actorId: cashierId,
    });
  } catch {
    pullDenied = true;
  }
  check("kasir ditolak saat menarik angka marketplace", pullDenied);

  let nothingToPush = false;
  let nothingToPushMessage = "";
  try {
    await client.action(api.marketplace.pushStockDiffs, { tenantId, actorId: userId });
  } catch (cause) {
    nothingToPush = true;
    nothingToPushMessage = cause instanceof Error ? cause.message : String(cause);
  }
  check(
    "tanpa selisih, tombol kirim menolak dengan alasan yang bisa dibaca",
    nothingToPush && nothingToPushMessage.includes("Tidak ada SKU dengan saldo berbeda"),
    nothingToPushMessage,
  );

  // Stok produk yang **sudah ada** juga harus diperbaiki, bukan hanya produk
  // baru. Saldo lokal digeser dulu, lalu impor berikutnya harus mengembalikannya
  // ke angka marketplace — dan hanya produk itu yang tersentuh.
  const localCatalog = await client.query(api.products.listAll, {
    tenantId,
    storeId,
    actorId: userId,
  });
  const importedLocal = localCatalog.find(
    (row) => row.sku === sourceRows[0].sku,
  );
  check(
    "produk impor terbaca dari katalog lokal",
    Boolean(importedLocal) && importedLocal.stock === sourceRows[0].stock,
    JSON.stringify({
      sku: sourceRows[0].sku,
      stock: importedLocal?.stock,
      sumber: sourceRows[0].stock,
    }),
  );
  await client.mutation(api.products.adjustStock, {
    tenantId,
    storeId,
    productId: importedLocal._id,
    delta: importedLocal.stock > 0 ? -1 : 3,
    note: "Uji impor stok marketplace",
    actorId: userId,
  });
  const stockPulled = await client.action(api.marketplace.pullCatalog, {
    tenantId,
    actorId: userId,
  });
  const afterStockPull = await client.query(api.products.listAll, {
    tenantId,
    storeId,
    actorId: userId,
  });
  const restoredLocal = afterStockPull.find(
    (row) => row.sku === sourceRows[0].sku,
  );
  check(
    "stok produk yang sudah ada ikut diperbaiki saat impor",
    stockPulled.counts.stock === 1 &&
      restoredLocal?.stock === sourceRows[0].stock,
    JSON.stringify({
      stock: restoredLocal?.stock,
      sumber: sourceRows[0].stock,
      disesuaikan: stockPulled.counts.stock,
      counts: stockPulled.counts,
    }),
  );

  /* ----------------------------------- penjualan & stok yang dibaca marketplace */

  // Kartu harus melaporkan keadaan endpoint dorong apa adanya. Nilainya bisa
  // `true` (endpoint diisi di server) atau `false` (belum), tergantung deployment;
  // yang tidak boleh adalah tidak ada jawabannya sama sekali.
  const beforeSaleStatus = await client.query(api.marketplace.status, {
    tenantId,
    actorId: userId,
  });
  check(
    "kartu melaporkan keadaan endpoint dorong stok",
    typeof beforeSaleStatus.pushEndpointReady === "boolean" &&
      typeof beforeSaleStatus.salesPushEndpointReady === "boolean",
    JSON.stringify({
      pushEndpointReady: beforeSaleStatus.pushEndpointReady,
      salesPushEndpointReady: beforeSaleStatus.salesPushEndpointReady,
    }),
  );

  const saleSource = afterStockPull.find((row) => row.sku === sourceRows[0].sku);
  const stockBeforeSale = saleSource.stock;
  const sale = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    cashierId: userId,
    items: [{ productId: saleSource._id, quantity: 1 }],
    payments: [{ method: "cash", amount: 0 }],
    payExactTotal: true,
    idempotencyKey: `marketplace-sale-${runId}`,
  });
  check(
    "penjualan uji tercatat",
    sale.deduplicated === false && sale.total > 0,
    JSON.stringify(sale),
  );

  // Inilah inti keluhan "stok tidak ikut terpotong": begitu penjualan tersimpan,
  // angka yang dibaca marketplace (snapshot maupun dorongan berikutnya) sudah
  // memakai saldo **sesudah** penjualan — bukan menunggu siapa pun menekan tombol.
  const afterSaleResponse = await fetch(snapshotUrl);
  const afterSaleSnapshot = await afterSaleResponse.json();
  const soldRow = afterSaleSnapshot.products.find(
    (row) => row.sku === sourceRows[0].sku,
  );
  check(
    "stok sesudah penjualan langsung terbaca marketplace",
    soldRow.stock === stockBeforeSale - 1,
    JSON.stringify({ sebelum: stockBeforeSale, sesudah: soldRow?.stock }),
  );

  const afterSaleStatus = await client.query(api.marketplace.status, {
    tenantId,
    actorId: userId,
  });
  check(
    "tanpa endpoint, dorongan stok tidak diklaim berhasil",
    beforeSaleStatus.pushEndpointReady === true ||
      ((afterSaleStatus.pairing?.lastStockSyncAt ?? null) === null &&
        (afterSaleStatus.pairing?.lastStockSyncStatus ?? null) === null),
    JSON.stringify({
      at: afterSaleStatus.pairing?.lastStockSyncAt ?? null,
      status: afterSaleStatus.pairing?.lastStockSyncStatus ?? null,
    }),
  );

  // Saldo dikembalikan lewat impor katalog supaya uji berikutnya tidak bergantung
  // pada sisa stok — sekaligus membuktikan impor tetap jalur yang bisa memulihkan
  // angka setelah penjualan menyentuhnya.
  const saleRestore = await client.action(api.marketplace.pullCatalog, {
    tenantId,
    actorId: userId,
  });
  const afterRestore = await client.query(api.products.listAll, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "impor katalog mengembalikan stok ke angka marketplace",
    saleRestore.counts.stock === 1 &&
      afterRestore.find((row) => row.sku === sourceRows[0].sku)?.stock ===
        sourceRows[0].stock,
    JSON.stringify({
      disesuaikan: saleRestore.counts.stock,
      stok: afterRestore.find((row) => row.sku === sourceRows[0].sku)?.stock,
      sumber: sourceRows[0].stock,
    }),
  );

  const unpair = await client.mutation(api.marketplace.unpair, {
    tenantId,
    actorId: userId,
  });
  check("pairing bisa dilepas", unpair.changed === true, JSON.stringify(unpair));

  const staleResponse = await fetch(snapshotUrl);
  check("token lama ditolak setelah dilepas", staleResponse.status === 401, String(staleResponse.status));
}

const passed = results.filter((row) => row.ok).length;
console.log(`${passed}/${results.length} pemeriksaan pairing marketplace lulus.`);
console.log("Bersihkan akun uji dengan: bun run bersih:uji");

/**
 * Uji **sinkronisasi platform** (pusatbahanbangunan.com) tanpa database.
 *
 * MesinPOS adalah sumber utama: penjualan, pembelian, stok, dan harga harus
 * keluar dari sini — realtime lewat webhook, dan bisa ditarik ulang untuk
 * rekonsiliasi. Harness ini menjaga bagian yang paling mudah melenceng:
 *
 *   1. **Event baru ada di katalog** (`product.updated`, `stock.changed`,
 *      `purchase.received`) dan bentuk isinya tetap seperti yang dijanjikan
 *      dokumentasi.
 *   2. **Pemicunya benar-benar terpasang** di jalur tulis domain — bukan hanya
 *      di halaman: produk (buat/ubah/harga/status), setiap pergerakan stok, dan
 *      penerimaan barang.
 *   3. **Endpoint tarik bisa dipakai loop sinkronisasi**: katalog berhalaman
 *      (`cursor` → `nextCursor`), `sales`/`purchases` menerima `since`, dan
 *      `http.ts` meneruskan kedua parameter itu.
 *   4. **Kontrak sinkronisasi** (`SYNC_DOC`) menyebut semua entitas, arah, dan
 *      aturan “MesinPOS menang” — supaya tidak ada dua sumber kebenaran.
 *
 * Usage: bun scripts/verify-platform-sync.mjs
 */
import { readFileSync } from "node:fs";
import { API_RESOURCES } from "../src/convex/lib/apiKeys.ts";
import {
  WEBHOOK_EVENT_KEYS,
  WEBHOOK_EVENTS,
} from "../src/convex/lib/webhooks.ts";
import {
  productUpdatedEventData,
  purchaseReceivedEventData,
  stockChangedEventData,
} from "../src/convex/lib/webhookEvents.ts";
import {
  API_DOC_ENDPOINTS,
  API_DOC_LIMITS,
  SYNC_DOC,
} from "../src/lib/apiDocs.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const HERE = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, HERE), "utf8");
const products = read("src/convex/products.ts");
const access = read("src/convex/lib/access.ts");
const purchasing = read("src/convex/purchasing.ts");
const apiAccess = read("src/convex/apiAccess.ts");
const http = read("src/convex/http.ts");
const apiKeys = read("src/convex/lib/apiKeys.ts");
const docsPage = read("src/pages/ApiDocsPage.tsx");

// ------------------------------------------------------- katalog event
for (const key of ["product.updated", "stock.changed", "purchase.received"]) {
  check(`event ${key} terdaftar`, WEBHOOK_EVENT_KEYS.includes(key), key);
  const definition = WEBHOOK_EVENTS.find((event) => event.key === key);
  check(
    `event ${key} punya label & keterangan`,
    Boolean(definition) && definition.label.length > 0 && definition.description.length > 30,
    definition?.description,
  );
}
check(
  "seluruh event tetap berbentuk objek.aksi",
  WEBHOOK_EVENTS.every((event) => /^[a-z]+\.[a-z]+$/.test(event.key)),
  WEBHOOK_EVENT_KEYS.join(", "),
);

// ------------------------------------------------------ isi event
const productEvent = productUpdatedEventData({
  sku: "PBB-SEM-000001",
  name: "Semen Portland 40 kg",
  price: 68000,
  unit: "SAK",
  active: true,
  changed: ["price"],
});
check(
  "product.updated membawa harga & field yang berubah",
  productEvent.sku === "PBB-SEM-000001" &&
    productEvent.price === 68000 &&
    productEvent.unit === "SAK" &&
    productEvent.active === true &&
    JSON.stringify(productEvent.changed) === JSON.stringify(["price"]),
  JSON.stringify(productEvent),
);

const renamedEvent = productUpdatedEventData({
  sku: "PBB-MAK-000007",
  name: "Semen Portland 40 kg",
  price: 69000,
  unit: "SAK",
  active: true,
  changed: ["price", "sku"],
  previousSku: "PBB-SAN-000007",
  previousPrice: 68000,
});
check(
  "product.updated membawa SKU & harga lama saat berubah",
  renamedEvent.previousSku === "PBB-SAN-000007" && renamedEvent.previousPrice === 68000,
  JSON.stringify(renamedEvent),
);
check(
  "field lama tidak dikirim sebagai null saat tidak berubah",
  !("previousSku" in productEvent) && !("previousPrice" in productEvent),
  JSON.stringify(productEvent),
);

const changedInput = ["price"];
const productEvent2 = productUpdatedEventData({
  sku: "X",
  name: "X",
  price: 1,
  unit: "PCS",
  active: true,
  changed: changedInput,
});
changedInput.push("name");
check(
  "product.updated menyalin daftar `changed` (tidak menyimpan referensi pemanggil)",
  JSON.stringify(productEvent2.changed) === JSON.stringify(["price"]),
  JSON.stringify(productEvent2.changed),
);

const stockEvent = stockChangedEventData({
  sku: "PBB-SEM-000001",
  name: "Semen Portland 40 kg",
  delta: -3,
  balance: 237,
  reason: "sale",
  refType: "sale",
  refId: "A-00042",
});
check(
  "stock.changed membawa delta, saldo, dan rujukan dokumen",
  stockEvent.delta === -3 &&
    stockEvent.balance === 237 &&
    stockEvent.reason === "sale" &&
    stockEvent.refType === "sale" &&
    stockEvent.refId === "A-00042",
  JSON.stringify(stockEvent),
);
const stockWithoutRef = stockChangedEventData({
  sku: "X",
  name: "X",
  delta: 1,
  balance: 1,
  reason: "adjustment",
});
check(
  "stock.changed menulis rujukan kosong sebagai null",
  stockWithoutRef.refType === null && stockWithoutRef.refId === null,
  JSON.stringify(stockWithoutRef),
);

const purchaseEvent = purchaseReceivedEventData({
  number: "GRN-00012",
  order: "PO-00008",
  supplier: "CV Sumber Semen",
  total: 4500000,
  lines: [
    { sku: "PBB-SEM-000001", name: "Semen Portland 40 kg", quantity: 60, unitCost: 75000 },
  ],
});
check(
  "purchase.received membawa nomor, supplier, total, dan baris",
  purchaseEvent.number === "GRN-00012" &&
    purchaseEvent.order === "PO-00008" &&
    purchaseEvent.supplier === "CV Sumber Semen" &&
    purchaseEvent.total === 4500000 &&
    purchaseEvent.lineCount === 1 &&
    JSON.stringify(purchaseEvent.lines) ===
      JSON.stringify([
        { sku: "PBB-SEM-000001", name: "Semen Portland 40 kg", quantity: 60, unitCost: 75000 },
      ]),
  JSON.stringify(purchaseEvent),
);

// -------------------------------------------------- pemicu di jalur tulis
check(
  "produk mengirim product.updated dari jalur tulisnya",
  products.includes("emitProductUpdated") &&
    (products.match(/await emitProductUpdated\(/g) ?? []).length >= 6 &&
    products.includes('event: "product.updated"') &&
    products.includes("previousSku") &&
    products.includes('["deleted"]'),
  `${(products.match(/await emitProductUpdated\(/g) ?? []).length} panggilan`,
);
check(
  "setiap pergerakan stok mengirim stock.changed",
  access.includes("enqueueWebhookEvent") &&
    access.includes('event: "stock.changed"') &&
    access.includes("stockChangedEventData"),
  "applyStockChange tidak mengabarkan stok",
);
check(
  "penerimaan barang mengirim purchase.received",
  purchasing.includes('event: "purchase.received"') &&
    purchasing.includes("purchaseReceivedEventData") &&
    purchasing.includes("scheduleWebhookDeliveryPass"),
  "GRN tidak mengabarkan pembelian",
);
check(
  "pemicu stok diletakkan di helper bersama, bukan di satu modul",
  /export async function applyStockChange[\s\S]{0,2200}stock\.changed/.test(access),
  "event stok tidak berada di applyStockChange",
);

// ------------------------------------------------------ endpoint tarik
const purchasesResource = API_RESOURCES.find((row) => row.resource === "purchases");
check(
  "API publik punya endpoint purchases baca-saja",
  Boolean(purchasesResource) &&
    purchasesResource.method === "GET" &&
    purchasesResource.path === "/api/v1/purchases" &&
    purchasesResource.scope === "purchase.view" &&
    purchasesResource.write === false,
  JSON.stringify(purchasesResource),
);
check(
  "readResource menangani purchases",
  apiAccess.includes('args.resource === "purchases"') &&
    apiAccess.includes("goodsReceipts"),
  "cabang purchases tidak ada",
);
check(
  "readResource menerima since & cursor",
  apiAccess.includes("since: v.optional(v.number())") &&
    apiAccess.includes("cursor: v.optional(v.string())") &&
    apiAccess.includes("clampSince"),
  "parameter sinkronisasi tidak diterima",
);
check(
  "katalog dibaca berhalaman dengan nextCursor",
  apiAccess.includes("nextCursor") && apiAccess.includes('withIndex("by_tenant_sku"'),
  "katalog masih satu halaman",
);
check(
  "sales memakai since yang dijepit",
  /clampSince\(args\.since/.test(apiAccess) && apiAccess.includes("by_tenant_store_created"),
  "sales tidak bisa ditarik bertahap",
);
check(
  "http.ts meneruskan since & cursor",
  http.includes('url.searchParams.get("since")') &&
    http.includes('url.searchParams.get("cursor")') &&
    http.includes("since: since === null"),
  "parameter tidak sampai ke readResource",
);
check(
  "endpoint purchases terdaftar di tabel scope",
  apiKeys.includes('path: "/api/v1/purchases"') &&
    apiKeys.includes('scope: "purchase.view"'),
  "tabel server tidak memuat purchases",
);

// -------------------------------------------------- kontrak sinkronisasi
const entities = SYNC_DOC.ownership.map((row) => row.entity.toLowerCase()).join(" | ");
for (const entity of ["penjualan", "pembelian", "stok", "harga", "pesanan"]) {
  check(`kontrak sinkronisasi menyebut ${entity}`, entities.includes(entity), entities);
}
check(
  "kontrak menetapkan MesinPOS sebagai sumber utama",
  SYNC_DOC.rules.some((rule) => rule.includes("MesinPOS menang")) &&
    SYNC_DOC.rules.some((rule) => rule.includes("Platform tidak mengirim balik")),
  "aturan sumber utama tidak ada",
);
check(
  "kontrak menyebut rekonsiliasi & idempotensi",
  SYNC_DOC.steps.some((step) => step.title.toLowerCase().includes("rekonsiliasi")) &&
    SYNC_DOC.rules.some((rule) => rule.includes("idempotensi")) &&
    SYNC_DOC.rules.some((rule) => rule.includes("`since`")),
  "rekonsiliasi tidak dijelaskan",
);
check(
  "kontrak menyebut event untuk pembelian, stok, harga",
  SYNC_DOC.ownership.some((row) => row.event.includes("purchase.received")) &&
    SYNC_DOC.ownership.some((row) => row.event.includes("stock.changed")) &&
    SYNC_DOC.ownership.some((row) => row.event.includes("product.updated")),
  JSON.stringify(SYNC_DOC.ownership.map((row) => row.event)),
);
check(
  "dokumentasi publik memuat purchases & batas since",
  API_DOC_ENDPOINTS.some((row) => row.resource === "purchases") &&
    API_DOC_LIMITS.some((row) => row.label.includes("since")),
  "dokumentasi belum menyebut sinkronisasi",
);
check(
  "halaman dokumentasi menampilkan bagian sinkronisasi",
  docsPage.includes("SYNC_DOC") &&
    docsPage.includes('id="sinkron"') &&
    docsPage.includes("SYNC_DOC.ownership.map"),
  "bagian sinkronisasi tidak dirender",
);

console.log(`${results.length}/${results.length} checks passed`);

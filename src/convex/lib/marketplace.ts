/**
 * Pairing vendor **pusatbahanbangunan.com** — aturan murninya.
 *
 * Pemilik bisnis menghubungkan workspace MesinPOS ini dengan satu **vendor**
 * yang sudah terdaftar di marketplace pusatbahanbangunan.com. **Email atau nomor
 * WA** pemilik adalah kunci pencariannya: yang ditampilkan hanya vendor yang
 * marketplace nyatakan terkait dengan kontak itu. Direktori publik hanya dibuka
 * kalau pemilik sendiri memintanya (mis. kontaknya belum terdaftar). Sesudah pairing, marketplace bisa menarik salinan data POS lewat
 * tautan snapshot bertoken; tidak ada dua sisi yang saling menimpa harga/stok.
 *
 * Kenapa aturannya di sini, bukan di halaman atau di fungsi Convex:
 *
 *  - bentuk email & nomor WA harus sama di form pengaturan, di server, dan di
 *    harness — kalau berbeda, vendor yang sama bisa gagal dicocokkan hanya karena
 *    satu sisi menerima `+62` dan sisi lain `08`;
 *  - direktori marketplace datang dari jaringan luar, jadi isinya **tidak
 *    dipercaya apa adanya** (`parseMarketplaceVendorRows` menyaring bentuknya);
 *  - status pairing, kalimat yang ditampilkan, dan daftar entitas yang ikut
 *    disinkronkan hanyalah teks yang diturunkan dari data — tidak perlu Convex
 *    untuk mengujinya.
 *
 * Yang **tidak** ada di sini: pemanggilan jaringan, penyimpanan, dan pemeriksaan
 * izin. Itu ada di `convex/marketplace.ts`; berkas ini bisa dijalankan tanpa
 * deployment dan tanpa satu pun byte keluar dari mesin uji.
 */

import { checkEmail, maskEmail, normalizeEmail } from "./otp";
import {
  normalizeProductBarcode,
  productBarcodeKey,
  productBarcodeTypeOr,
  validateProductBarcode,
  type ProductBarcodeType,
} from "./productBarcode";
import { normalizePhone } from "./team";
import { sanitizeEventSubject, signWebhookPayload } from "./webhooks";

/** Nama host yang ditampilkan ke pengguna (tanpa protokol). */
export const MARKETPLACE_HOST = "pusatbahanbangunan.com";

/**
 * Query publik marketplace yang mengembalikan **katalog satu vendor**.
 *
 * Query-nya sama dengan yang dipakai halaman toko marketplace; MesinPOS
 * memanggilnya dengan `vendorId` pairing, jadi yang ditarik hanya katalog milik
 * vendor yang benar-benar dipasangkan — bukan seluruh marketplace.
 */
export const MARKETPLACE_PRODUCTS_QUERY = "marketplace:getProducts";

/**
 * Alamat **query publik** marketplace. Marketplace-nya adalah aplikasi Convex
 * sendiri; query `vendor:listVendors` memang publik dan dipakai halaman
 * `https://pusatbahanbangunan.com/vendors`.
 *
 * Bisa diganti lewat `PUSATBAHANBANGUNAN_QUERY_URL` kalau deployment marketplace
 * berpindah. Nilai bawaan sengaja ditulis di sini supaya integrasi tetap hidup
 * tanpa konfigurasi tambahan — dan harness bisa memeriksa bahwa alamatnya tidak
 * berpindah diam-diam ke host lain.
 */
export const MARKETPLACE_QUERY_URL_DEFAULT =
  "https://scintillating-crane-800.convex.cloud";

/** Nama kunci lingkungan yang dibaca server, apa adanya. */
export const MARKETPLACE_ENV = {
  /** Alamat deployment Convex marketplace (tanpa garis miring di akhir). */
  queryUrl: "PUSATBAHANBANGUNAN_QUERY_URL",
  /**
   * Endpoint opsional di marketplace untuk mencocokkan email/WA ke satu vendor.
   * Selama endpoint ini belum ada, pemilik memilih vendor dari direktori publik
   * dan kontaknya dicatat sebagai klaim pairing (lihat `contactVerified`).
   */
  lookupUrl: "PUSATBAHANBANGUNAN_PAIRING_LOOKUP_URL",
  /** Token opsional untuk endpoint pencocokan kontak (header Bearer). */
  lookupToken: "PUSATBAHANBANGUNAN_PAIRING_LOOKUP_TOKEN",
  /**
   * Endpoint opsional untuk **mendorong** snapshot saat tombol sinkron ditekan.
   * Tanpa ini, marketplace tetap bisa menarik snapshot yang sama lewat tautan
   * pairing bertoken (`/api/marketplace/snapshot`).
   */
  syncUrl: "PUSATBAHANBANGUNAN_SYNC_URL",
  /**
   * Endpoint opsional untuk **mendorong katalog produk** (upsert per SKU).
   * Isinya seluruh field produk beserta gambar dan pohon kategori; marketplace
   * membuat field/produk/kategori yang belum ada, bukan menolaknya. Bila kunci
   * ini kosong, tombol “Sinkronkan produk” memakai `syncUrl` bila terisi.
   */
  productsUrl: "PUSATBAHANBANGUNAN_PRODUCTS_URL",
  /**
   * Endpoint opsional untuk **dorongan stok otomatis** sesudah penjualan,
   * pembatalan, penerimaan barang, opname, atau penyesuaian stok. Isinya katalog
   * dengan bentuk yang **sama** seperti dorongan produk — hanya barisnya yang
   * dibatasi ke produk yang baru bergerak — jadi sisi marketplace tidak perlu
   * jalur baru. Bila kunci ini kosong, dorongan memakai `productsUrl`, lalu
   * `syncUrl`.
   */
  stockUrl: "PUSATBAHANBANGUNAN_STOCK_URL",
  /**
   * Endpoint opsional untuk **dorongan penjualan otomatis** (nota selesai &
   * pembatalan) beserta stok terbaru SKU yang tersentuh. Bila kosong, dorongan
   * memakai `stockUrl`, lalu `productsUrl`, lalu `syncUrl` — jadi marketplace
   * yang sudah punya satu endpoint tulis tidak perlu jalur baru.
   */
  salesUrl: "PUSATBAHANBANGUNAN_SALES_URL",
} as const;

/** Kategori kontak pemilik yang bisa dipakai untuk pairing. */
export const MARKETPLACE_CONTACT_KINDS = ["email", "whatsapp"] as const;
export type MarketplaceContactKind = (typeof MARKETPLACE_CONTACT_KINDS)[number];

export const MARKETPLACE_CONTACT_LABELS: Record<MarketplaceContactKind, string> = {
  email: "Email",
  whatsapp: "Nomor WhatsApp",
};

export const MARKETPLACE_CONTACT_PLACEHOLDERS: Record<MarketplaceContactKind, string> = {
  email: "nama@bisnis.id",
  whatsapp: "0812-3456-7890",
};

/**
 * Keterangan singkat tiap metode kontak. Dipakai form supaya pemilik tahu
 * kontak mana yang dimaksud marketplace — bukan kontak bebas yang dikarang di
 * sini.
 */
export const MARKETPLACE_CONTACT_HINTS: Record<MarketplaceContactKind, string> = {
  email:
    "Email yang dipakai saat mendaftar vendor di pusatbahanbangunan.com. Dipakai marketplace untuk mencocokkan akun Anda.",
  whatsapp:
    "Nomor WA yang terdaftar di pusatbahanbangunan.com (boleh diawali 08, 628, atau +62). Nomor ini tidak dikirim ke siapa pun dari sini.",
};

/** Batas panjang masukan, supaya kolom iseng tidak disimpan apa adanya. */
export const MARKETPLACE_CONTACT_MAX = 120;
export const MARKETPLACE_VENDOR_NAME_MAX = 120;
export const MARKETPLACE_VENDOR_ID_MAX = 160;
/** Jumlah vendor yang dikembalikan sekali pencarian. */
export const MARKETPLACE_VENDOR_LIMIT = 100;

/**
 * Satu vendor seperti yang ditampilkan pemilih vendor. Field-nya hanya yang
 * memang publik di halaman `/vendors` marketplace; tidak ada email, WA, atau
 * data pribadi pemilik di sini.
 */
export interface MarketplaceVendor {
  id: string;
  name: string;
  description: string;
  city: string;
  productCount: number;
  joinedAt: number;
  logo: string | null;
  cover: string | null;
}

/** Hasil pencocokan kontak lewat endpoint marketplace (kalau tersedia). */
export interface MarketplaceContactMatch {
  vendorId: string;
  vendorName: string;
  /** Marketplace menyatakan kontak ini memang milik vendor tersebut. */
  verified: boolean;
}

export type MarketplaceLookupSource =
  /** Endpoint `PUSATBAHANBANGUNAN_PAIRING_LOOKUP_URL` menjawab satu vendor. */
  | "pairing-api"
  /**
   * Bukan hasil pencocokan kontak: direktori yang dibuka pemilik, atau
   * pencarian kontak yang belum menemukan vendor mana pun.
   */
  | "directory";

export interface MarketplaceLookupResult {
  vendors: MarketplaceVendor[];
  source: MarketplaceLookupSource;
  /** Satu vendor yang benar-benar cocok dengan kontak, bila endpoint mengembalikannya. */
  match: MarketplaceContactMatch | null;
  /** Kalimat yang ditampilkan apa adanya di kartu pengaturan. */
  note: string;
  /** Waktu direktori dibaca (milidetik epoch). */
  fetchedAt: number;
}

/** Hasil pemeriksaan kontak: nilai yang dinormalkan + bentuk tampilannya. */
export type MarketplaceContactCheck =
  | {
      ok: true;
      kind: MarketplaceContactKind;
      /** Sudah dinormalkan: email huruf kecil, WA berawalan `62`. */
      value: string;
      /** Bentuk yang aman ditampilkan (tidak membocorkan kontak lengkap). */
      masked: string;
    }
  | { ok: false; reason: string };

/**
 * Menormalkan email atau nomor WA pemilik.
 *
 * Email memakai aturan OTP yang sudah dipakai seluruh aplikasi; nomor WA memakai
 * `normalizePhone` yang sama dengan undangan tim dan struk WhatsApp. Dengan
 * begitu `0812…`, `+62 812…`, dan `62812…` berakhir sebagai satu nilai yang sama
 * — dan dua workspace tidak bisa "berbeda" hanya karena cara menulis nomornya.
 */
export function parseMarketplaceContact(input: {
  kind: MarketplaceContactKind;
  value: string;
}): MarketplaceContactCheck {
  const raw = (input.value ?? "").trim();
  if (raw.length > MARKETPLACE_CONTACT_MAX) {
    return { ok: false, reason: "Kontak terlalu panjang." };
  }

  if (input.kind === "email") {
    const check = checkEmail(raw);
    if (!check.valid) {
      return { ok: false, reason: check.reason ?? "Email tidak valid." };
    }
    const email = normalizeEmail(raw);
    return { ok: true, kind: "email", value: email, masked: maskEmail(email) };
  }

  const phone = normalizePhone(raw);
  if (!phone.valid) {
    return {
      ok: false,
      reason: (phone.reason ?? "Nomor WA tidak valid.").replace(
        "Nomor WhatsApp",
        "Nomor WA",
      ),
    };
  }
  const normalized = phone.value ?? "";
  return {
    ok: true,
    kind: "whatsapp",
    value: normalized,
    masked: maskWhatsapp(normalized),
  };
}

/**
 * Menebak jenis kontak dari yang diketik — hanya untuk kenyamanan form.
 * Yang tetap menentukan adalah pemilih metode; tebakan ini tidak pernah dipakai
 * server untuk memutuskan sesuatu.
 */
export function detectMarketplaceContactKind(raw: string): MarketplaceContactKind {
  return raw.includes("@") ? "email" : "whatsapp";
}

/** `6281234567890` → `62812••••890`. */
export function maskWhatsapp(normalized: string): string {
  const digits = (normalized ?? "").replace(/\D/g, "");
  if (digits.length <= 7) return digits;
  const head = digits.slice(0, 5);
  const tail = digits.slice(-3);
  return `${head}${"•".repeat(Math.min(4, Math.max(2, digits.length - 8)))}${tail}`;
}

/**
 * Kode pairing yang dibaca manusia, mis. `PBB-7F3A-9C21`.
 *
 * Kode ini **bukan** rahasia dan tidak dipakai untuk otentikasi; token sinkron
 * yang rahasia ada di kolom terpisah. Gunanya hanya untuk menyebut pasangan
 * workspace–vendor di layar dan di percakapan dukungan.
 */
export function pairingCodeFrom(seed: string): string {
  const hex = (seed ?? "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  const body = (hex + "00000000").slice(0, 8);
  return `PBB-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

/** Apakah teks ini sudah berbentuk kode pairing yang sah. */
export function isPairingCode(value: string): boolean {
  return /^PBB-[0-9A-F]{4}-[0-9A-F]{4}$/.test(value ?? "");
}

/**
 * Menyaring direktori berdasarkan kata kunci. Dipakai form supaya pemilik yang
 * sudah tahu nama tokonya tidak perlu menggulir seratus vendor.
 *
 * Pencarian mencakup nama, kota, dan keterangan — bukan kontak, karena
 * direktori publik memang tidak membawa kontak.
 */
export function filterMarketplaceVendors(
  vendors: readonly MarketplaceVendor[],
  query: string,
): MarketplaceVendor[] {
  const needle = (query ?? "").trim().toLowerCase();
  if (needle === "") return vendors.slice(0, MARKETPLACE_VENDOR_LIMIT);
  return vendors
    .filter((vendor) => {
      const haystack = [
        vendor.name,
        vendor.city,
        vendor.description,
        vendor.id,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, MARKETPLACE_VENDOR_LIMIT);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/* ------------------------------------------------- format barcode marketplace */

/**
 * Marketplace menyimpan barcode sebagai `<simbol>:<nilai>` — misal
 * `code39:PBB-0000005` atau `qr:https://…` — karena satu kolom dipakai untuk
 * beberapa jenis kode. MesinPOS menyimpan **teks kodenya saja** dan jenisnya di
 * kolom `barcodeType`, jadi konversi ini yang membuat hasil scan di kedua sisi
 * menunjuk barang yang sama.
 *
 * Simbol 1D dipetakan ke jenis `barcode` (MesinPOS menggambar Code 39 untuk jenis
 * itu; scanner tetap mengirim teksnya apa adanya), sedangkan `qr`/`qrcode` ke
 * jenis `qr`. Prefix yang tidak dikenal **tidak** dibuang karena bisa jadi bagian
 * dari kode itu sendiri (mis. URL `https://…`).
 */
export const MARKETPLACE_BARCODE_FORMATS: Record<string, ProductBarcodeType> = {
  code39: "barcode",
  code93: "barcode",
  code128: "barcode",
  ean13: "barcode",
  ean8: "barcode",
  upca: "barcode",
  upce: "barcode",
  itf: "barcode",
  codabar: "barcode",
  qr: "qr",
  qrcode: "qr",
};

/** Teks barcode apa adanya: string dirapikan, angka yang sah dibaca sebagai teks. */
function barcodeText(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asString(value);
}

/**
 * Membaca barcode marketplace menjadi `{ barcode, barcodeType }` MesinPOS.
 *
 * Prefix simbol menang atas `barcodeType` yang dikirim marketplace, karena prefix
 * itulah yang menentukan gambar/isi kodenya. Tanpa prefix, jenis mengikuti
 * `barcodeType` (`qr` → QR, selain itu Barcode).
 */
export function decodeMarketplaceBarcode(
  raw: unknown,
  explicitType?: unknown,
): { barcode: string; barcodeType: ProductBarcodeType | null } {
  const text = barcodeText(raw);
  if (text.trim() === "") return { barcode: "", barcodeType: null };

  const prefix = text.match(/^([a-z0-9_]+):(.*)$/i);
  const mapped = prefix
    ? MARKETPLACE_BARCODE_FORMATS[prefix[1].toLowerCase()]
    : undefined;
  if (prefix && mapped !== undefined) {
    const value = prefix[2].trim();
    return value === ""
      ? { barcode: "", barcodeType: null }
      : { barcode: value, barcodeType: mapped };
  }

  const hint = asString(explicitType).trim().toLowerCase();
  const barcodeType: ProductBarcodeType =
    hint === "qr" || hint === "qrcode" || hint === "qr_code"
      ? "qr"
      : "barcode";
  return { barcode: text, barcodeType };
}

/** Kebalikannya: teks + jenis MesinPOS → format yang dipakai marketplace. */
export function encodeMarketplaceBarcode(
  barcode: string,
  barcodeType: ProductBarcodeType,
): string {
  const value = normalizeProductBarcode(barcode);
  if (value === "") return "";
  return barcodeType === "qr" ? `qr:${value}` : `code39:${value}`;
}

/**
 * Membaca balasan `vendor:listVendors` marketplace tanpa mempercayainya.
 *
 * Deployment marketplace bisa berubah bentuk kapan saja; yang tidak berbentuk
 * benar dibuang, bukan disimpan sebagai `undefined` yang lalu pecah di UI.
 * Duplikat id juga dibuang supaya pemilih vendor tidak menampilkan toko yang sama
 * dua kali.
 */
export function parseMarketplaceVendorRows(raw: unknown): MarketplaceVendor[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rows: MarketplaceVendor[] = [];

  for (const value of raw) {
    const record = asRecord(value);
    const id = asString(record._id) || asString(record.id);
    const name = asString(record.vendorName) || asString(record.name);
    if (id === "" || name === "") continue;
    if (seen.has(id)) continue;
    seen.add(id);

    rows.push({
      id: id.slice(0, MARKETPLACE_VENDOR_ID_MAX),
      name: name.slice(0, MARKETPLACE_VENDOR_NAME_MAX),
      description: asString(record.vendorDescription).slice(0, 280),
      city: asString(record.vendorCity).slice(0, 80),
      productCount: Math.max(0, Math.round(asNumber(record.productCount))),
      joinedAt: Math.max(0, Math.round(asNumber(record.joinedAt))),
      logo: asString(record.logo) || null,
      cover: asString(record.cover) || null,
    });
    if (rows.length >= MARKETPLACE_VENDOR_LIMIT) break;
  }

  return rows;
}

/**
 * Membaca balasan endpoint pencocokan kontak (kalau ada).
 *
 * Bentuk yang diterima sengaja sempit: `vendorId` + `vendorName`, dengan
 * `verified` opsional. Balasan lain dianggap "tidak ada kecocokan", bukan
 * dipaksa menjadi vendor palsu.
 */
export function parseMarketplaceContactMatch(
  raw: unknown,
): MarketplaceContactMatch | null {
  const record = asRecord(raw);
  const vendorId = asString(record.vendorId) || asString(record.vendor_id) || asString(record.id);
  const vendorName =
    asString(record.vendorName) || asString(record.vendor_name) || asString(record.name);
  if (vendorId === "" || vendorName === "") return null;
  return {
    vendorId: vendorId.slice(0, MARKETPLACE_VENDOR_ID_MAX),
    vendorName: vendorName.slice(0, MARKETPLACE_VENDOR_NAME_MAX),
    verified: record.verified === true,
  };
}

/* ------------------------------------------------- katalog arah sebaliknya */

/**
 * Satu produk marketplace yang bisa diimpor ke katalog MesinPOS.
 *
 * Bentuknya disaring dari balasan `marketplace:getProducts`; produk yang tidak
 * punya SKU/nama atau harganya negatif **dibuang**, bukan disimpan setengah jadi.
 * `active` sengaja `null` bila marketplace tidak menyebutkannya: impor tidak
 * boleh menghidupkan produk yang sengaja dimatikan pemilik hanya karena field
 * itu tidak ada di balasan.
 */
export interface MarketplaceCatalogProduct {
  /** Id baris marketplace, hanya untuk jejak/duplikat. */
  sourceId: string;
  sku: string;
  name: string;
  /**
   * Kode yang dipindai kasir di marketplace; `null` = marketplace tidak
   * menyebutkannya. Kode yang tidak lolos aturan produk dibuang, produknya tetap
   * diimpor.
   */
  barcode: string | null;
  barcodeType: ProductBarcodeType | null;
  category: string | null;
  subcategory: string | null;
  price: number;
  /** Stok marketplace — dibaca untuk laporan, **tidak** menimpa stok POS. */
  stock: number;
  unit: string;
  active: boolean | null;
  /** URL gambar publik marketplace; diunduh action sebelum disimpan. */
  images: string[];
}

/** Batas baris yang diimpor sekali tekan. */
export const MARKETPLACE_CATALOG_PRODUCT_LIMIT = 500;
/** Maksimal gambar yang diunduh per produk saat impor. */
export const MARKETPLACE_CATALOG_IMAGES_PER_PRODUCT = 3;
/** Anggaran total unduhan gambar sekali impor, supaya action tidak menggantung. */
export const MARKETPLACE_CATALOG_IMAGE_BUDGET = 150;

/** Dibaca UI & harness: ringkasan hasil impor katalog. */
export interface MarketplaceCatalogCounts {
  /** Baris produk marketplace yang dibaca (sebelum disaring). */
  products: number;
  created: number;
  updated: number;
  /** Sudah sama persis; tidak ada yang ditulis. */
  unchanged: number;
  /** Baris yang dilewati karena tidak sah/duplikat. */
  skipped: number;
  /** Kategori baru yang dibuat di MesinPOS. */
  categories: number;
  /** Subkategori baru yang dibuat di MesinPOS. */
  subcategories: number;
  /** Gambar marketplace yang berhasil disimpan ke penyimpanan MesinPOS. */
  images: number;
  /** Produk yang saldo stok lokasi jualnya berubah mengikuti marketplace. */
  stock: number;
  /** Produk yang barcode/QR-nya baru disimpan dari marketplace. */
  barcodes: number;
  /** Kode marketplace yang dilewati karena sudah dipakai produk lain. */
  barcodeConflicts: number;
}

export const EMPTY_MARKETPLACE_CATALOG_COUNTS: MarketplaceCatalogCounts = {
  products: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
  categories: 0,
  subcategories: 0,
  images: 0,
  stock: 0,
  barcodes: 0,
  barcodeConflicts: 0,
};

export type MarketplaceCatalogStatus = "imported" | "empty" | "failed";

/** Hasil tombol “Impor katalog dari marketplace”. */
export interface MarketplaceCatalogPullResult {
  status: MarketplaceCatalogStatus;
  note: string;
  counts: MarketplaceCatalogCounts;
  at: number;
}

/** Pohon kategori hasil pembacaan katalog marketplace. */
export interface MarketplaceCatalogTreeRow {
  name: string;
  subcategories: string[];
}

function catalogText(value: unknown, max: number): string {
  return asString(value).replace(/\s+/g, " ").slice(0, max);
}

/**
 * Membaca barcode/QR satu baris katalog marketplace.
 *
 * Kode yang tidak lolos aturan produk (terlalu panjang, memuat karakter
 * kontrol) **tidak membatalkan barisnya**: produk tetap diimpor, hanya kodenya
 * yang dilewati — label rusak di marketplace tidak boleh membuat satu SKU
 * hilang dari kasir. Kode bertipe Barcode yang memuat karakter di luar Code 39
 * dicoba ulang sebagai QR, karena kode dari pemasok sering berupa teks bebas
 * (URL atau kode internal dengan `_`, `:`).
 */
function catalogBarcode(record: Record<string, unknown>): {
  barcode: string | null;
  barcodeType: ProductBarcodeType | null;
} {
  // Prefix simbol (`code39:`/`qr:`) dibaca lebih dulu: yang disimpan di MesinPOS
  // adalah teks kodenya, bukan "code39:PBB-0000005" yang tidak bisa dipindai.
  const raw = barcodeText(record.barcode).trim() !== ""
    ? record.barcode
    : record.qrCode;
  const decoded = decodeMarketplaceBarcode(
    raw,
    record.barcodeType ?? record.codeType,
  );
  if (decoded.barcode === "") return { barcode: null, barcodeType: null };
  const type: ProductBarcodeType = decoded.barcodeType ?? "barcode";

  const first = validateProductBarcode({
    barcode: decoded.barcode,
    barcodeType: type,
  });
  if (first.ok) {
    return first.value === ""
      ? { barcode: null, barcodeType: null }
      : { barcode: first.value, barcodeType: first.type };
  }

  const fallback = validateProductBarcode({
    barcode: decoded.barcode,
    barcodeType: "qr",
  });
  if (fallback.ok && fallback.value !== "") {
    return { barcode: fallback.value, barcodeType: fallback.type };
  }
  return { barcode: null, barcodeType: null };
}

/**
 * Membaca balasan `marketplace:getProducts` tanpa mempercayainya.
 *
 * SKU adalah kunci upsert, jadi baris tanpa SKU **dibuang** (dan dihitung sebagai
 * `skipped` oleh pemanggil lewat selisih jumlah). Duplikat SKU dalam satu balasan
 * hanya diambil yang pertama. Nama kategori/subkategori dirapatkan spasinya
 * supaya “Cat  & Finishing” dan “Cat & Finishing” menjadi satu kategori.
 *
 * Harga dibulatkan ke rupiah bulat dan stok ke satuan; angka negatif/NaN tidak
 * pernah masuk. URL gambar hanya `http(s)` — skema `javascript:` atau data URI
 * tidak akan pernah diunduh server.
 */
export function parseMarketplaceCatalogProducts(
  raw: unknown,
): MarketplaceCatalogProduct[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rows: MarketplaceCatalogProduct[] = [];

  for (const value of raw) {
    const record = asRecord(value);
    const sku = catalogText(record.sku, 80);
    const name = catalogText(record.name, 160);
    if (sku === "" || name === "") continue;
    const key = sku.toLowerCase();
    if (seen.has(key)) continue;

    // Harga yang tidak berbentuk angka **bukan** nol: mengimpor produk dengan
    // harga 0 karena field-nya rusak akan membuat kasir menjual gratis. Baris
    // seperti itu dilewati dan dilaporkan sebagai `skipped`.
    if (typeof record.price !== "number" || !Number.isFinite(record.price)) {
      continue;
    }
    const rawPrice = record.price;
    if (rawPrice < 0) continue;

    const images: string[] = [];
    const pushImage = (candidate: unknown) => {
      const url = asString(candidate);
      if (!/^https?:\/\//i.test(url)) return;
      if (images.includes(url)) return;
      if (images.length >= 8) return;
      images.push(url);
    };
    if (Array.isArray(record.images)) record.images.forEach(pushImage);
    pushImage(record.imageUrl);

    const active =
      typeof record.active === "boolean" ? record.active : null;

    seen.add(key);
    rows.push({
      sourceId: catalogText(record._id ?? record.id, 120),
      sku,
      name,
      ...catalogBarcode(record),
      category:
        catalogText(record.category, 80) === ""
          ? null
          : catalogText(record.category, 80),
      subcategory:
        catalogText(record.subcategory ?? record.subCategory, 80) === ""
          ? null
          : catalogText(record.subcategory ?? record.subCategory, 80),
      price: Math.max(0, Math.round(rawPrice)),
      stock: Math.max(0, Math.round(asNumber(record.stock))),
      unit: catalogText(record.unit, 24) || "PCS",
      active,
      images,
    });
    if (rows.length >= MARKETPLACE_CATALOG_PRODUCT_LIMIT) break;
  }

  return rows;
}

/**
 * Membaca **hanya SKU, nama, dan stok** dari balasan `marketplace:getProducts`.
 *
 * Dipakai rekonsiliasi stok, dan sengaja tidak memakai pembaca katalog impor:
 * pembaca itu membuang baris yang harganya tidak sah, sedangkan untuk
 * perbandingan stok harga tidak relevan — memakainya akan melaporkan produk
 * “hanya ada di MesinPOS” hanya karena marketplace belum mengisi harganya.
 * SKU kosong dilewati; duplikat SKU diambil yang pertama; stok dibulatkan dan
 * tidak boleh negatif.
 */
export function parseMarketplaceStockRows(
  raw: unknown,
): Array<{ sku: string; name: string; stock: number }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rows: Array<{ sku: string; name: string; stock: number }> = [];

  for (const value of raw) {
    const record = asRecord(value);
    const sku = catalogText(record.sku, 80);
    if (sku === "") continue;
    const key = stockSkuKey(sku);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    rows.push({
      sku,
      name: catalogText(record.name, 160),
      stock: Math.max(0, Math.round(asNumber(record.stock))),
    });
  }

  return rows;
}

/**
 * Pohon kategori + subkategori dari katalog marketplace, urut kemunculan.
 * Dipakai kartu Pengaturan untuk menyebut apa yang akan dibuat sebelum menekan
 * tombol — bukan mengubah data apa pun.
 */
export function marketplaceCatalogTree(
  products: readonly MarketplaceCatalogProduct[],
): MarketplaceCatalogTreeRow[] {
  const order: string[] = [];
  const byKey = new Map<string, { name: string; subs: string[] }>();

  for (const product of products) {
    if (!product.category) continue;
    const key = product.category.toLowerCase();
    let row = byKey.get(key);
    if (!row) {
      row = { name: product.category, subs: [] };
      byKey.set(key, row);
      order.push(key);
    }
    if (product.subcategory && !row.subs.includes(product.subcategory)) {
      row.subs.push(product.subcategory);
    }
  }

  return order.map((key) => {
    const row = byKey.get(key)!;
    return { name: row.name, subcategories: row.subs };
  });
}

/** Kalimat hasil impor, dipakai kartu & catatan pairing. */
export function marketplaceCatalogImportSentence(
  counts: MarketplaceCatalogCounts,
): string {
  const parts = [
    `${counts.created} produk baru`,
    `${counts.updated} diperbarui`,
    `${counts.categories} kategori & ${counts.subcategories} subkategori baru`,
  ];
  if (counts.unchanged > 0) parts.push(`${counts.unchanged} tidak berubah`);
  if (counts.skipped > 0) parts.push(`${counts.skipped} dilewati`);
  if (counts.images > 0) parts.push(`${counts.images} gambar disimpan`);
  if (counts.stock > 0) parts.push(`${counts.stock} stok disesuaikan`);
  if (counts.barcodes > 0) parts.push(`${counts.barcodes} barcode/QR kasir disimpan`);
  if (counts.barcodeConflicts > 0) {
    parts.push(`${counts.barcodeConflicts} barcode dilewati karena sudah dipakai`);
  }
  return `Katalog marketplace diimpor: ${parts.join(", ")}.`;
}

/** Kapan katalog marketplace terakhir diimpor ke workspace ini. */
export function marketplaceCatalogPullSentence(
  pairing: Pick<MarketplacePairingView, "lastCatalogAt" | "lastCatalogCounts">,
): string {
  if (!pairing.lastCatalogAt) {
    return "Katalog marketplace belum pernah diimpor ke workspace ini.";
  }
  const when = new Date(pairing.lastCatalogAt).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const counts = pairing.lastCatalogCounts;
  if (!counts) return `Katalog marketplace terakhir diimpor ${when}.`;
  return `Katalog marketplace terakhir diimpor ${when}: ${counts.created} produk baru, ${counts.updated} diperbarui, ${counts.unchanged} tidak berubah.`;
}

/* ------------------------------------------------- sinkron barcode otomatis */

/**
 * Sinkron **barcode/QR otomatis** — satu arah marketplace → MesinPOS, hanya
 * kolom kode.
 *
 * Impor katalog menyalin banyak hal sekaligus (nama, harga, stok, gambar), jadi
 * ia harus diperintahkan pemilik. Barcode berbeda: marketplace adalah sumber
 * labelnya, dan kode yang benar tidak pernah menimpa data lain. Karena itu kolom
 * ini boleh diperbarui sendiri oleh pekerja terjadwal — dengan syarat yang
 * ketat: produk yang belum ada **tidak** dibuat, dan satu kode tetap tidak boleh
 * dipakai dua produk.
 */
export const MARKETPLACE_BARCODE_SYNC_HOUR_UTC = 3;

/** Berapa workspace yang dijadwalkan satu putaran cron. */
export const MARKETPLACE_BARCODE_SYNC_BATCH = 20;

/** Batas produk lokal yang dipindai sekali jalan (sama dengan batas impor × 4). */
export const MARKETPLACE_BARCODE_SYNC_SCAN = 2000;

/** Ringkasan satu kali sinkron barcode. */
export interface MarketplaceBarcodeSyncCounts {
  /** Baris marketplace yang membawa kode (setelah disaring). */
  products: number;
  /** Produk lokal yang kodenya diperbarui mengikuti marketplace. */
  changed: number;
  /** Sudah sama persis; tidak ada yang ditulis. */
  unchanged: number;
  /** Kode yang dilewati karena sudah dipakai produk lain. */
  conflicts: number;
  /** SKU marketplace yang belum ada di MesinPOS — tidak dibuat oleh pekerja ini. */
  missing: number;
}

export const EMPTY_MARKETPLACE_BARCODE_COUNTS: MarketplaceBarcodeSyncCounts = {
  products: 0,
  changed: 0,
  unchanged: 0,
  conflicts: 0,
  missing: 0,
};

export type MarketplaceBarcodeSyncStatus = "synced" | "failed";

export interface MarketplaceBarcodeSyncResult {
  status: MarketplaceBarcodeSyncStatus;
  note: string;
  counts: MarketplaceBarcodeSyncCounts;
  at: number;
}

/** Satu produk lokal yang ikut dipertimbangkan (hanya kolom barcode). */
export interface MarketplaceBarcodeLocalRow {
  productId: string;
  sku: string;
  barcode: string | null;
  barcodeType: ProductBarcodeType | null;
}

/** Satu baris marketplace yang sudah diurai menjadi kode MesinPOS. */
export interface MarketplaceBarcodeMarketRow {
  sku: string;
  barcode: string | null;
  barcodeType: ProductBarcodeType | null;
}

/** Perubahan yang akan ditulis: **hanya** `barcode` + `barcodeType`. */
export interface MarketplaceBarcodeUpdate {
  productId: string;
  sku: string;
  barcode: string;
  barcodeType: ProductBarcodeType;
}

export interface MarketplaceBarcodePlan {
  updates: MarketplaceBarcodeUpdate[];
  counts: MarketplaceBarcodeSyncCounts;
}

/**
 * Menyusun rencana sinkron barcode tanpa menyentuh database.
 *
 * Aturannya sengaja sama dengan `applyCatalogImport` dan `products.setBarcode`:
 *
 *  - produk dicocokkan lewat **SKU** (tanpa beda huruf besar/kecil, spasi
 *    pinggir dirapikan); SKU yang belum ada dilewati, bukan dibuat;
 *  - satu kode hanya boleh menunjuk satu produk, dan kode tidak boleh menabrak
 *    SKU produk lain — kalau sudah dipakai, kodenya dilewati dan dihitung
 *    `conflicts`;
 *  - yang direncanakan hanya `barcode` + `barcodeType`; nama, harga, stok,
 *    kategori, dan gambar tidak pernah ikut.
 *
 * Fungsi ini murni supaya harness bisa membuktikan poin terakhir tanpa
 * deployment: keluaran `updates` memang tidak membawa field lain.
 */
export function planMarketplaceBarcodeSync(input: {
  local: readonly MarketplaceBarcodeLocalRow[];
  marketplace: readonly MarketplaceBarcodeMarketRow[];
}): MarketplaceBarcodePlan {
  const bySku = new Map<string, MarketplaceBarcodeLocalRow>();
  const skuOwner = new Map<string, string>();
  const codeOwner = new Map<string, string>();

  for (const row of input.local) {
    bySku.set(stockSkuKey(row.sku), row);
    skuOwner.set(productBarcodeKey(row.sku), row.productId);
    if (row.barcode) {
      codeOwner.set(productBarcodeKey(row.barcode), row.productId);
    }
  }

  const counts: MarketplaceBarcodeSyncCounts = {
    ...EMPTY_MARKETPLACE_BARCODE_COUNTS,
  };
  const updates: MarketplaceBarcodeUpdate[] = [];

  for (const row of input.marketplace) {
    const code = (row.barcode ?? "").trim();
    if (code === "") continue;
    counts.products += 1;

    const local = bySku.get(stockSkuKey(row.sku));
    if (!local) {
      counts.missing += 1;
      continue;
    }

    const barcodeType: ProductBarcodeType = row.barcodeType ?? "barcode";
    if (
      local.barcode === code &&
      productBarcodeTypeOr(local.barcodeType) === barcodeType
    ) {
      counts.unchanged += 1;
      continue;
    }

    const key = productBarcodeKey(code);
    const barcodeOwner = codeOwner.get(key);
    const ownerSku = skuOwner.get(key);
    if (
      (barcodeOwner !== undefined && barcodeOwner !== local.productId) ||
      (ownerSku !== undefined && ownerSku !== local.productId)
    ) {
      counts.conflicts += 1;
      continue;
    }

    updates.push({
      productId: local.productId,
      sku: local.sku,
      barcode: code,
      barcodeType,
    });
    codeOwner.set(key, local.productId);
    counts.changed += 1;
  }

  return { updates, counts };
}

/** Kalimat hasil sinkron barcode, dipakai action & catatan pairing. */
export function marketplaceBarcodeSyncNote(
  counts: MarketplaceBarcodeSyncCounts,
  truncated = false,
): string {
  const tail = truncated
    ? ` Sebagian produk tidak diperiksa karena batas ${MARKETPLACE_BARCODE_SYNC_SCAN} baris sekali jalan.`
    : "";
  if (counts.products === 0) {
    return `Marketplace belum punya barcode/QR untuk vendor ini; tidak ada yang ditulis.${tail}`;
  }
  const parts = [
    `${counts.changed} kode diperbarui`,
    `${counts.unchanged} sudah sama`,
  ];
  if (counts.conflicts > 0) {
    parts.push(`${counts.conflicts} dilewati karena sudah dipakai produk lain`);
  }
  if (counts.missing > 0) {
    parts.push(`${counts.missing} SKU belum ada di MesinPOS`);
  }
  return `Sinkron barcode otomatis: ${parts.join(", ")}. Hanya kolom barcode/QR yang ditulis.${tail}`;
}

/** Kalimat status sinkron barcode untuk kartu Pengaturan. */
export function marketplaceBarcodeSyncSentence(
  pairing: Pick<
    MarketplacePairingView,
    | "lastBarcodeSyncAt"
    | "lastBarcodeSyncStatus"
    | "lastBarcodeSyncNote"
    | "lastBarcodeSyncCounts"
  >,
): string {
  if (!pairing.lastBarcodeSyncAt) {
    return "Sinkron barcode otomatis belum pernah berjalan. Jadwalnya sekali sehari dan hanya menyentuh kolom barcode/QR.";
  }
  const when = new Date(pairing.lastBarcodeSyncAt).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  if (pairing.lastBarcodeSyncStatus === "failed") {
    return `Sinkron barcode otomatis ${when} gagal: ${
      pairing.lastBarcodeSyncNote ?? "katalog marketplace tidak bisa dibaca."
    }`;
  }
  const counts = pairing.lastBarcodeSyncCounts;
  if (!counts) return `Sinkron barcode otomatis terakhir ${when}.`;
  if (counts.products === 0) {
    return `Sinkron barcode otomatis ${when}: marketplace belum punya barcode/QR untuk vendor ini.`;
  }
  const parts = [
    `${counts.changed} kode diperbarui`,
    `${counts.unchanged} sudah sama`,
  ];
  if (counts.conflicts > 0) {
    parts.push(`${counts.conflicts} dilewati karena sudah dipakai`);
  }
  if (counts.missing > 0) {
    parts.push(`${counts.missing} SKU belum ada di MesinPOS`);
  }
  return `Sinkron barcode otomatis ${when}: ${parts.join(", ")}.`;
}

/* -------------------------------------------- rekonsiliasi stok dua arah */

/**
 * Batas baris selisih yang disimpan & ditampilkan sekali pemeriksaan.
 *
 * Laporan ini untuk **ditindaklanjuti**, bukan arsip: kalau ada 500 SKU yang
 * berbeda, yang berguna adalah daftar terburuk dulu — sisanya ditandai
 * `truncated` supaya tidak ada yang mengira sudah dilihat semuanya.
 */
export const MARKETPLACE_STOCK_DIFF_LIMIT = 50;

/**
 * Batas SKU yang dibandingkan sekali jalan. Sama dengan batas impor katalog,
 * jadi kedua arah membaca ukuran katalog yang sama.
 */
export const MARKETPLACE_RECONCILE_PRODUCT_LIMIT = 500;

/**
 * Jam pemeriksaan otomatis (UTC). Dipilih di luar jam jual supaya angka yang
 * dilaporkan adalah angka penutupan hari, bukan angka yang bergerak saat dibaca.
 */
export const MARKETPLACE_RECONCILE_HOUR_UTC = 2;
/** Berapa workspace yang dijadwalkan satu putaran cron. */
export const MARKETPLACE_RECONCILE_BATCH = 20;

/** Status pemeriksaan terakhir yang bisa terlihat di kartu. */
export type MarketplaceReconcileStatus = "checked" | "failed";

/**
 * Dari sisi mana sebuah SKU berbeda. Ketiganya penting dibedakan karena
 * tindakannya berbeda: `both` = saldo beda, `pos_only` = marketplace belum
 * punya produknya, `marketplace_only` = POS belum punya (biasanya sisa SKU lama
 * setelah rename).
 */
export type MarketplaceStockDiffKind = "both" | "pos_only" | "marketplace_only";

export const MARKETPLACE_STOCK_DIFF_LABELS: Record<
  MarketplaceStockDiffKind,
  string
> = {
  both: "Saldo berbeda",
  pos_only: "Hanya di MesinPOS",
  marketplace_only: "Hanya di marketplace",
};

/** Satu baris laporan selisih. `null` = sisi itu tidak punya SKU-nya. */
export interface MarketplaceStockDiff {
  sku: string;
  name: string;
  posStock: number | null;
  marketplaceStock: number | null;
  /** marketplace − POS; `null` kalau salah satu sisi tidak ada. */
  delta: number | null;
  kind: MarketplaceStockDiffKind;
}

/** Ringkasan satu kali pemeriksaan. */
export interface MarketplaceStockDiffCounts {
  /** SKU yang dihitung di sisi POS (lokasi jual). */
  pos: number;
  /** SKU yang dilaporkan marketplace. */
  marketplace: number;
  /** Ada di kedua sisi dengan saldo sama. */
  matched: number;
  /** Ada di kedua sisi tetapi saldonya beda. */
  differing: number;
  posOnly: number;
  marketplaceOnly: number;
  /** Daftar selisih terpotong batas laporan. */
  truncated: boolean;
}

export const EMPTY_MARKETPLACE_STOCK_DIFF_COUNTS: MarketplaceStockDiffCounts = {
  pos: 0,
  marketplace: 0,
  matched: 0,
  differing: 0,
  posOnly: 0,
  marketplaceOnly: 0,
  truncated: false,
};

/** Hasil satu pemeriksaan; bentuk yang sama untuk cron, tombol, dan harness. */
export interface MarketplaceReconcileResult {
  status: MarketplaceReconcileStatus;
  note: string;
  counts: MarketplaceStockDiffCounts;
  /** Baris yang ikut disimpan (sudah terbatas `MARKETPLACE_STOCK_DIFF_LIMIT`). */
  diffs: MarketplaceStockDiff[];
  at: number;
}

/** Kunci pembanding SKU: tanpa spasi pinggir & tanpa beda huruf besar/kecil. */
export function stockSkuKey(sku: string): string {
  return (sku ?? "").trim().toLowerCase();
}

/**
 * Membandingkan saldo stok **lokasi jual** MesinPOS dengan saldo marketplace.
 *
 * Aturan yang dipakai (dan diuji harness):
 *
 * 1. SKU adalah kunci — sama seperti upsert katalog, jadi perbandingannya
 *    memakai SKU yang sama persis, hanya dirapikan spasinya & hurufnya.
 * 2. Yang dilaporkan **hanya yang berbeda**; SKU yang sudah sama tidak
 *    ditampilkan tetapi dihitung di `matched` supaya “tidak ada selisih” bisa
 *    dibedakan dari “belum diperiksa”.
 * 3. Selisih saldo diurutkan dari yang terbesar (mutlak), lalu SKU yang hanya
 *    ada di satu sisi. Urutan ini deterministik, jadi dua pemeriksaan berturut
 *    tidak menukar baris hanya karena urutan tabel.
 * 4. Angka dari marketplace dibulatkan & tidak boleh negatif — sama dengan
 *    aturan pembaca katalog (`parseMarketplaceCatalogProducts`).
 */
export function reconcileMarketplaceStock(input: {
  pos: readonly { sku: string; name: string; stock: number }[];
  marketplace: readonly { sku: string; name: string; stock: number }[];
  limit?: number;
}): { counts: MarketplaceStockDiffCounts; diffs: MarketplaceStockDiff[] } {
  const limit = Math.min(
    MARKETPLACE_STOCK_DIFF_LIMIT,
    Math.max(1, Math.floor(input.limit ?? MARKETPLACE_STOCK_DIFF_LIMIT)),
  );

  const posBySku = new Map<string, { sku: string; name: string; stock: number }>();
  for (const row of input.pos) {
    const key = stockSkuKey(row.sku);
    if (key === "" || posBySku.has(key)) continue;
    posBySku.set(key, row);
  }
  const marketBySku = new Map<
    string,
    { sku: string; name: string; stock: number }
  >();
  for (const row of input.marketplace) {
    const key = stockSkuKey(row.sku);
    if (key === "" || marketBySku.has(key)) continue;
    marketBySku.set(key, row);
  }

  const counts: MarketplaceStockDiffCounts = {
    ...EMPTY_MARKETPLACE_STOCK_DIFF_COUNTS,
    pos: posBySku.size,
    marketplace: marketBySku.size,
  };
  const rows: MarketplaceStockDiff[] = [];

  for (const [key, local] of posBySku) {
    const remote = marketBySku.get(key);
    if (!remote) {
      counts.posOnly += 1;
      rows.push({
        sku: local.sku,
        name: local.name,
        posStock: local.stock,
        marketplaceStock: null,
        delta: null,
        kind: "pos_only",
      });
      continue;
    }
    if (remote.stock === local.stock) {
      counts.matched += 1;
      continue;
    }
    counts.differing += 1;
    rows.push({
      sku: local.sku,
      name: local.name || remote.name,
      posStock: local.stock,
      marketplaceStock: remote.stock,
      delta: remote.stock - local.stock,
      kind: "both",
    });
  }

  for (const [key, remote] of marketBySku) {
    if (posBySku.has(key)) continue;
    counts.marketplaceOnly += 1;
    rows.push({
      sku: remote.sku,
      name: remote.name,
      posStock: null,
      marketplaceStock: remote.stock,
      delta: null,
      kind: "marketplace_only",
    });
  }

  const weight = (row: MarketplaceStockDiff): number =>
    row.kind === "both" ? 2 : 1;
  rows.sort((a, b) => {
    if (weight(a) !== weight(b)) return weight(b) - weight(a);
    if (a.kind === "both" && b.kind === "both") {
      const byDelta = Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0);
      if (byDelta !== 0) return byDelta;
    }
    return stockSkuKey(a.sku).localeCompare(stockSkuKey(b.sku));
  });

  const diffs = rows.slice(0, limit);
  counts.truncated = rows.length > diffs.length;
  return { counts, diffs };
}

/** Kalimat hasil pemeriksaan, dipakai kartu & catatan pairing. */
export function marketplaceStockDiffSentence(
  counts: MarketplaceStockDiffCounts,
): string {
  if (counts.pos === 0 && counts.marketplace === 0) {
    return "Belum ada SKU yang bisa dibandingkan: katalog MesinPOS maupun marketplace sama-sama kosong.";
  }
  const parts: string[] = [];
  if (counts.differing > 0) parts.push(`${counts.differing} SKU saldonya berbeda`);
  if (counts.posOnly > 0) parts.push(`${counts.posOnly} hanya ada di MesinPOS`);
  if (counts.marketplaceOnly > 0)
    parts.push(`${counts.marketplaceOnly} hanya ada di marketplace`);
  if (parts.length === 0) {
    return `Stok ${counts.matched} SKU sama persis di kedua sisi; tidak ada selisih.`;
  }
  const tail = counts.truncated
    ? ` Daftar dibatasi ${MARKETPLACE_STOCK_DIFF_LIMIT} baris terburuk.`
    : "";
  return `Dari ${counts.pos} SKU MesinPOS dan ${counts.marketplace} SKU marketplace: ${parts.join(", ")}.${tail}`;
}

/** Kalimat status rekonsiliasi untuk kartu Pengaturan. */
export function marketplaceReconcileSentence(
  pairing: Pick<
    MarketplacePairingView,
    | "lastReconcileAt"
    | "lastReconcileStatus"
    | "lastReconcileNote"
    | "lastReconcileCounts"
  >,
): string {
  if (!pairing.lastReconcileAt) {
    return "Stok belum pernah diperiksa terhadap marketplace. Pemeriksaan otomatis berjalan sekali sehari.";
  }
  const when = new Date(pairing.lastReconcileAt).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  if (pairing.lastReconcileStatus === "failed") {
    return `Pemeriksaan stok ${when} gagal: ${
      pairing.lastReconcileNote ?? "katalog marketplace tidak bisa dibaca."
    }`;
  }
  const counts = pairing.lastReconcileCounts;
  if (!counts) return `Stok terakhir diperiksa ${when}.`;
  const summary = marketplaceStockDiffSentence(counts);
  return `Stok terakhir diperiksa ${when}. ${summary}`;
}

/**
 * Batas SKU yang dikirim sekali tekan pada laporan selisih. Angkanya sama dengan
 * batas antrean stok otomatis: satu kiriman besar masih wajar, dua ratus lebih
 * lebih baik dipecah supaya penerima tidak kehabisan waktu.
 */
export const MARKETPLACE_STOCK_DIFF_PUSH_LIMIT = 200;

/**
 * SKU yang **boleh dikirim** dari laporan selisih: hanya yang saldonya berbeda
 * di kedua sisi (`kind: "both"`).
 *
 * Dua jenis lain sengaja tidak ikut: `pos_only` berarti marketplace belum punya
 * produknya — mengirimnya akan **membuat** produk baru di marketplace, bukan
 * memperbaiki stok; `marketplace_only` tidak punya produk di POS untuk dikirim.
 * Keduanya tetap tampil di laporan, hanya bukan urusan tombol ini.
 */
export function stockDiffPushSkus(
  diffs: readonly MarketplaceStockDiff[],
  limit = MARKETPLACE_STOCK_DIFF_PUSH_LIMIT,
): string[] {
  const cap = Math.max(1, Math.floor(limit));
  const skus: string[] = [];
  for (const row of diffs) {
    if (row.kind !== "both") continue;
    const sku = (row.sku ?? "").trim();
    if (sku === "") continue;
    if (skus.some((existing) => stockSkuKey(existing) === stockSkuKey(sku))) continue;
    skus.push(sku);
    if (skus.length >= cap) break;
  }
  return skus;
}

/** Hasil tombol “Kirim stok SKU yang berbeda”. */
export interface MarketplaceStockDiffPushResult {
  /** SKU yang benar-benar ikut dikirim. */
  skus: string[];
  /** Hasil dorongan; `status` mengikuti aturan dorongan stok otomatis. */
  push: MarketplaceProductPushResult;
  /**
   * Pemeriksaan ulang sesudah kiriman diterima, supaya tabel tidak menampilkan
   * selisih yang sudah hilang. `null` kalau kirimannya tidak diterima (angka di
   * marketplace belum tentu berubah, jadi tidak perlu diperiksa ulang).
   */
  reconcile: MarketplaceReconcileResult | null;
  at: number;
}

/** Hasil tombol “Tarik angka marketplace” pada laporan selisih. */
export interface MarketplaceStockDiffPullResult {
  /** SKU yang ikut diambil dari laporan (yang saldonya berbeda). */
  skus: string[];
  counts: {
    /** SKU yang saldonya benar-benar disesuaikan di POS. */
    adjusted: number;
    /** Sudah sama saat ditulis (mis. berubah di antara pemeriksaan & tombol). */
    skipped: number;
    /** Tidak ada lagi di katalog marketplace saat angka ditarik. */
    missing: number;
    /** Jumlah SKU yang diminta dari laporan. */
    requested: number;
  };
  /** Pemeriksaan ulang sesudah penyesuaian supaya tabel tidak basi. */
  reconcile: MarketplaceReconcileResult | null;
  at: number;
}

/**
 * Entitas yang ikut disalin ke marketplace. Urutannya sama dengan `SYNC_DOC` di
 * dokumentasi API, dan **arahnya satu**: POS sumber utama.
 */
export const MARKETPLACE_SYNC_ENTITIES = [
  {
    key: "products",
    label: "Katalog, harga & stok",
    detail:
      "Seluruh field produk — SKU, nama, barcode/QR kasir, kategori/subkategori, harga, modal, satuan, stok, harga bertingkat, konversi satuan, modifier, dan gambar.",
  },
  {
    key: "sales",
    label: "Penjualan",
    detail: "Nota lunas 30 hari terakhir beserta item, total, dan metode bayarnya.",
  },
  {
    key: "purchases",
    label: "Penerimaan barang",
    detail: "GRN/pembelian yang sudah diterima beserta supplier dan nilainya.",
  },
  {
    key: "payables",
    label: "Hutang supplier",
    detail: "Tagihan yang masih terbuka, nilai, dan jatuh temponya.",
  },
] as const;

export type MarketplaceSyncEntityKey =
  (typeof MARKETPLACE_SYNC_ENTITIES)[number]["key"];

/* ------------------------------------------------------------ katalog produk */

/**
 * Satu field produk yang ikut disalin ke marketplace.
 *
 * Daftar ini bukan sekadar dokumentasi: ia **ikut di badan setiap dorongan**
 * (`fields`), sehingga sisi marketplace yang belum punya kolomnya tahu persis
 * field apa yang harus dibuat — bentuknya sama dengan sumbernya, bukan ditebak.
 * `createIfMissing` selalu `true` karena arahnya satu: MesinPOS sumber utama.
 */
export interface MarketplaceProductField {
  key: string;
  label: string;
  type: "string" | "string|null" | "number" | "boolean" | "object[]" | "string[]";
  createIfMissing: true;
}

export const MARKETPLACE_PRODUCT_FIELDS: readonly MarketplaceProductField[] = [
  { key: "sku", label: "SKU", type: "string", createIfMissing: true },
  { key: "name", label: "Nama produk", type: "string", createIfMissing: true },
  {
    key: "barcode",
    label: "Barcode / QR Code kasir",
    type: "string|null",
    createIfMissing: true,
  },
  {
    key: "barcodeType",
    label: "Jenis kode (barcode/QR)",
    type: "string|null",
    createIfMissing: true,
  },
  { key: "category", label: "Kategori", type: "string|null", createIfMissing: true },
  { key: "subcategory", label: "Subkategori", type: "string|null", createIfMissing: true },
  { key: "price", label: "Harga jual", type: "number", createIfMissing: true },
  { key: "cost", label: "Harga modal", type: "number", createIfMissing: true },
  { key: "unit", label: "Satuan dasar", type: "string", createIfMissing: true },
  { key: "stock", label: "Stok lokasi jual", type: "number", createIfMissing: true },
  { key: "active", label: "Aktif dijual", type: "boolean", createIfMissing: true },
  { key: "trackStock", label: "Stok dilacak", type: "boolean", createIfMissing: true },
  { key: "tiers", label: "Harga bertingkat", type: "object[]", createIfMissing: true },
  { key: "units", label: "Konversi satuan", type: "object[]", createIfMissing: true },
  { key: "modifiers", label: "Modifier", type: "object[]", createIfMissing: true },
  { key: "images", label: "Gambar produk (URL)", type: "string[]", createIfMissing: true },
  { key: "imageCount", label: "Jumlah gambar", type: "number", createIfMissing: true },
  { key: "createdAt", label: "Dibuat pada", type: "number", createIfMissing: true },
] as const;

/** Satu baris katalog — seluruh field tabel `products`, bukan sebagian. */
export interface MarketplaceProductPayload {
  sku: string;
  name: string;
  /**
   * Kode yang dipindai kasir selain SKU (barcode pabrik atau QR pemasok);
   * `null` = produk memang tidak punya kode. Ikut dikirim supaya pemindai di
   * sisi marketplace menemukan SKU yang sama, bukan hanya di MesinPOS.
   */
  barcode: string | null;
  /** Jenis kode untuk digambar/dibaca: Code 39 (`barcode`) atau QR (`qr`). */
  barcodeType: ProductBarcodeType | null;
  category: string | null;
  subcategory: string | null;
  price: number;
  /** Harga modal; ikut karena marketplace perlu tahu margin vendor. */
  cost: number;
  unit: string;
  stock: number;
  active: boolean;
  trackStock: boolean;
  tiers: { minQty: number; price: number }[];
  units: { code: string; factor: number }[];
  modifiers: {
    code: string;
    name: string;
    minSelect: number;
    maxSelect: number;
    options: { code: string; name: string; price: number }[];
  }[];
  /** URL gambar (bertanda tangan), urut seperti di MesinPOS. */
  images: string[];
  /** Jumlah gambar di sumber — tetap benar walau URL-nya terpotong. */
  imageCount: number;
  createdAt: number;
}

/** Pohon kategori yang ikut dikirim supaya marketplace membuat yang belum ada. */
export interface MarketplaceCategoryPayload {
  name: string;
  active: boolean;
  sortOrder: number;
  subcategories: { name: string; active: boolean; sortOrder: number }[];
}

/** Jumlah hasil dorongan katalog. */
export interface MarketplaceProductPushCounts {
  products: number;
  created: number;
  updated: number;
  skipped: number;
  fieldsCreated: number;
}

export const EMPTY_MARKETPLACE_PRODUCT_COUNTS: MarketplaceProductPushCounts = {
  products: 0,
  created: 0,
  updated: 0,
  skipped: 0,
  fieldsCreated: 0,
};

/** Hasil tombol “Sinkronkan produk”. */
export interface MarketplaceProductPushResult {
  delivered: boolean;
  status: "delivered" | "failed" | "ready";
  note: string;
  counts: MarketplaceProductPushCounts;
  at: number;
}

function readCount(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.round(value));
    }
  }
  return null;
}

/**
 * Membaca balasan endpoint dorong katalog tanpa mempercayainya.
 *
 * Bentuk yang diterima hanya **hitungan**: `created`/`updated`/`skipped` dan
 * `fieldsCreated` (boleh bernama `fields_created`). Balasan yang tidak memuat
 * satu pun hitungan dianggap “diterima tanpa laporan” — fungsi ini mengembalikan
 * `null`, bukan angka nol yang berpura-pura tahu.
 */
export function parseMarketplaceProductPushResponse(
  raw: unknown,
): Omit<MarketplaceProductPushCounts, "products"> | null {
  let record = asRecord(raw);
  // Convex membungkus hasil action/mutation di `value`, sebagian platform di `result`.
  for (const wrapper of ["value", "result", "data"]) {
    const inner = asRecord(record[wrapper]);
    if (Object.keys(inner).length > 0) {
      record = inner;
      break;
    }
  }

  const created = readCount(record, ["created", "createdProducts", "inserted"]);
  const updated = readCount(record, ["updated", "updatedProducts", "upserted"]);
  const skipped = readCount(record, ["skipped", "unchanged", "ignored"]);
  const fieldsCreated = readCount(record, [
    "fieldsCreated",
    "fields_created",
    "createdFields",
  ]);
  if (created === null && updated === null && skipped === null && fieldsCreated === null) {
    return null;
  }
  return {
    created: created ?? 0,
    updated: updated ?? 0,
    skipped: skipped ?? 0,
    fieldsCreated: fieldsCreated ?? 0,
  };
}

/* -------------------------------------------------------- stok otomatis */

/**
 * Jeda sebelum stok yang baru bergerak dikirim ke marketplace, milidetik.
 *
 * Penjualan jarang terdiri dari satu baris, dan satu nota bisa menyentuh
 * beberapa produk sekaligus. Jeda pendek ini mengumpulkan seluruh pergerakan
 * dari transaksi yang sama (termasuk pembatalan dan penerimaan barang) menjadi
 * **satu** kiriman, bukan satu permintaan per baris — tanpa membuat kasir
 * menunggu jaringan: jadwalnya dibawa oleh transaksi, bukan ditunggu di layar.
 */
export const MARKETPLACE_STOCK_DEBOUNCE_MS = 2_000;

/**
 * Batas jumlah produk dalam satu antrean stok otomatis. Antrean yang lebih besar
 * dari ini berubah menjadi “kirim seluruh katalog” — lebih baik mengirim satu
 * daftar besar sekali daripada kehilangan perubahan yang tidak masuk antrean.
 */
export const MARKETPLACE_STOCK_QUEUE_LIMIT = 200;

/**
 * Umur maksimum baris antrean sebelum disapu pekerja terjadwal, milidetik.
 * Antrean yang tertinggal (mis. action-nya mati di tengah jalan) dikirim ulang
 * dalam ≤ 1 menit, sehingga stok marketplace tidak tertinggal tanpa kabar.
 */
export const MARKETPLACE_STOCK_QUEUE_STALE_MS = 60_000;

/**
 * Seberapa sering pekerja terjadwal menyapu antrean stok yang tertinggal,
 * dalam menit, dan berapa baris yang diperiksa sekali jalan. Antrean yang sehat
 * sudah berangkat dalam hitungan detik, jadi pemeriksaan ini hanya jaring
 * pengaman — bukan jalur utama.
 */
export const MARKETPLACE_STOCK_SWEEP_INTERVAL_MINUTES = 5;
export const MARKETPLACE_STOCK_SWEEP_BATCH = 20;

/**
 * URL endpoint dorongan stok otomatis.
 *
 * Urutannya: `PUSATBAHANBANGUNAN_STOCK_URL` → `PUSATBAHANBANGUNAN_PRODUCTS_URL`
 * → `PUSATBAHANBANGUNAN_SYNC_URL`. Dengan begitu workspace yang sudah punya
 * endpoint katalog langsung memakai jalur yang sama, dan marketplace yang ingin
 * memisahkan jalur stok bisa mengisi kunci khususnya.
 */
export function marketplaceStockPushUrl(
  env: Record<string, string | undefined>,
): string {
  return (
    (env[MARKETPLACE_ENV.stockUrl] ??
      env[MARKETPLACE_ENV.productsUrl] ??
      env[MARKETPLACE_ENV.syncUrl] ??
      "") as string
  ).trim();
}

/**
 * URL endpoint dorongan **katalog** — dipakai tombol Sinkronkan produk dan
 * dorongan otomatis sesudah kategori/subkategori berubah.
 *
 * Urutannya `PUSATBAHANBANGUNAN_PRODUCTS_URL` → `PUSATBAHANBANGUNAN_SYNC_URL` →
 * `PUSATBAHANBANGUNAN_STOCK_URL`. Dua kunci pertama adalah endpoint katalog
 * seperti sebelumnya; kunci stok dipakai paling akhir supaya workspace yang
 * hanya mengisi jalur stok tetap menerima pohon kategori (kiriman katalog dan
 * stok memakai badan upsert yang sama, jadi endpoint itu memang memahaminya).
 */
export function marketplaceCatalogPushUrl(
  env: Record<string, string | undefined>,
): string {
  return (
    (env[MARKETPLACE_ENV.productsUrl] ??
      env[MARKETPLACE_ENV.syncUrl] ??
      env[MARKETPLACE_ENV.stockUrl] ??
      "") as string
  ).trim();
}

/** Satu baris antrean stok otomatis yang sudah digabung. */
export interface MarketplaceStockQueueMerge {
  productIds: string[];
  /** Benar kalau antreannya sudah penuh: yang dikirim seluruh katalog. */
  pushAll: boolean;
}

/**
 * Menggabungkan id produk yang baru bergerak ke dalam antrean yang sudah ada.
 *
 * Duplikat dibuang (satu produk boleh bergerak berkali-kali sebelum kiriman
 * berangkat) dan hasilnya dibatasi `MARKETPLACE_STOCK_QUEUE_LIMIT`. Lewat batas
 * itu, antreannya berubah menjadi `pushAll` — seluruh katalog dikirim — supaya
 * perubahan tidak hilang hanya karena produknya banyak (mis. opname besar).
 */
export function mergeMarketplaceStockQueue(input: {
  productIds: readonly string[];
  incoming: readonly string[];
}): MarketplaceStockQueueMerge {
  const merged: string[] = [];
  for (const id of [...input.productIds, ...input.incoming]) {
    if (id === "" || merged.includes(id)) continue;
    merged.push(id);
  }
  if (merged.length > MARKETPLACE_STOCK_QUEUE_LIMIT) {
    return { productIds: [], pushAll: true };
  }
  return { productIds: merged, pushAll: false };
}

/**
 * Kalimat status dorongan stok otomatis, dipakai kartu Pengaturan.
 *
 * Ditulis apa adanya: kiriman yang gagal tidak pernah disebut “tersinkron”, dan
 * laporan marketplace yang tidak ada tidak ditebak.
 */
export function marketplaceStockSyncSentence(
  pairing: Pick<
    MarketplacePairingView,
    | "lastStockSyncAt"
    | "lastStockSyncStatus"
    | "lastStockSyncNote"
    | "lastStockSyncCounts"
  >,
): string {
  if (!pairing.lastStockSyncAt) {
    return "Stok otomatis belum pernah dikirim ke marketplace.";
  }
  const when = new Date(pairing.lastStockSyncAt).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  if (pairing.lastStockSyncStatus === "failed") {
    return `Dorongan stok otomatis ${when} gagal: ${
      pairing.lastStockSyncNote ?? "marketplace menolak kiriman."
    }`;
  }
  const counts = pairing.lastStockSyncCounts;
  if (!counts) {
    return `Stok terakhir dikirim otomatis ${when}.`;
  }
  const parts = [`${counts.products} produk`];
  if (counts.updated > 0) parts.push(`${counts.updated} diperbarui`);
  if (counts.created > 0) parts.push(`${counts.created} dibuat`);
  if (counts.skipped > 0) parts.push(`${counts.skipped} tidak berubah`);
  return `Stok terakhir dikirim otomatis ${when}: ${parts.join(", ")}.`;
}

/* ------------------------------------------------- penjualan otomatis */

/**
 * Jeda sebelum penjualan yang baru tersimpan dikirim ke marketplace.
 *
 * Sama seperti antrean stok: satu nota tidak boleh menjadi satu kiriman per
 * baris, dan kasir tidak boleh menunggu jaringan. Jeda ini juga menggabungkan
 * pembatalan yang terjadi beberapa detik setelah penjualannya.
 */
export const MARKETPLACE_SALES_DEBOUNCE_MS = 2_000;

/** Batas nota dalam satu antrean; lewat batas ini yang tertinggal dibuang (nota
 * terbaru dipertahankan) karena marketplace tetap bisa menarik snapshot penuh. */
export const MARKETPLACE_SALES_QUEUE_LIMIT = 100;

/** Umur antrean sebelum disapu cron, milidetik (jaring pengaman action mati). */
export const MARKETPLACE_SALES_QUEUE_STALE_MS = 60_000;

export const MARKETPLACE_SALES_SWEEP_BATCH = 20;

/** Header penanda tangan kiriman MesinPOS → marketplace. */
export const MARKETPLACE_PUSH_HEADERS = {
  timestamp: "x-mesinpos-timestamp",
  signature: "x-mesinpos-signature",
  pairing: "x-mesinpos-pairing",
} as const;

/**
 * Header kiriman bertanda tangan.
 *
 * Marketplace mitra menolak kiriman tanpa tanda tangan (terbukti: HTTP 401
 * dengan pesan “Header x-mesinpos-timestamp tidak ada”). Skemanya sama dengan
 * webhook keluar — `sha256=HMAC(rahasia, timestamp + "." + badan)` — sehingga
 * satu rahasia yang disepakati di kedua Pengaturan cukup untuk semua dorongan
 * (katalog, stok, penjualan). Token pairing tetap dikirim sebagai Bearer untuk
 * menunjukkan workspace mana yang mengirim.
 */
export function marketplacePushHeaders(input: {
  secret: string;
  token: string;
  pairingCode: string;
  timestamp: number;
  body: string;
}): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${input.token}`,
    [MARKETPLACE_PUSH_HEADERS.timestamp]: String(input.timestamp),
    [MARKETPLACE_PUSH_HEADERS.signature]: signWebhookPayload(
      input.secret,
      input.timestamp,
      input.body,
    ),
    [MARKETPLACE_PUSH_HEADERS.pairing]: input.pairingCode,
  };
}

/**
 * Amplop peristiwa yang **wajib** menyertai setiap kiriman tulis ke marketplace.
 *
 * Marketplace mitra menolak kiriman tanpa amplop ini dengan HTTP 400 —
 * “Event MesinPOS tidak menyebut `id` atau `event`” — karena penerimanya memakai
 * bentuk yang sama dengan webhook keluar MesinPOS (`id`, `event`, isi). Jadi
 * setiap dorongan (katalog, stok, penjualan) membawa `id` yang unik per kiriman
 * dan `event` yang menyebut jenis isinya; penerima bisa memakai `id` untuk
 * membuang kiriman kembar tanpa menebak dari isinya.
 */
export const MARKETPLACE_PUSH_EVENTS = {
  /**
   * Katalog: tombol Sinkronkan produk **dan** dorongan otomatis sesudah
   * kategori/subkategori berubah. Keduanya membawa pohon kategori yang sama,
   * jadi penerima tidak perlu event baru untuk membuat kategori.
   */
  catalog: "product.updated",
  /** Stok yang bergerak sesudah transaksi. */
  stock: "stock.changed",
  /** Nota selesai. */
  sale: "sale.completed",
  /** Nota dibatalkan. */
  saleVoid: "sale.voided",
} as const;

export type MarketplacePushEvent =
  (typeof MARKETPLACE_PUSH_EVENTS)[keyof typeof MARKETPLACE_PUSH_EVENTS];

/**
 * `id` kiriman: `evt_<waktu>_<event>_<penanda>`. Penandanya nomor nota / SKU /
 * jumlah baris, dibersihkan dengan aturan yang sama seperti webhook keluar
 * supaya aman disisipkan ke JSON dan tidak tumbuh mengikuti isi dokumen.
 */
export function marketplacePushEventId(input: {
  event: MarketplacePushEvent;
  at: number;
  subject?: string;
}): string {
  const subject = sanitizeEventSubject(input.subject);
  return `evt_${input.at}_${input.event}${subject ? `_${subject}` : ""}`;
}

/** Amplop kiriman tulis MesinPOS → marketplace. */
export interface MarketplacePushEnvelope {
  id: string;
  event: MarketplacePushEvent;
  createdAt: string;
  version: 1;
  generatedAt: number;
  source: "mesinpos";
  mode: "upsert";
  upsertKey: "sku" | "number";
  createMissing: true;
  /**
   * Pemicu kiriman: tombol, stok otomatis, nota, atau perubahan
   * kategori/subkategori yang dikirim sendiri sesudah disimpan.
   */
  trigger: "manual" | "stock" | "sale" | "category";
  pairing: { vendorId: string; vendorName: string; pairingCode: string };
  /** Isi kiriman: katalog (SKU) atau nota + stok (nomor nota). */
  data: unknown;
}

/**
 * Menyusun amplop yang dipakai **semua** dorongan (katalog, stok, penjualan).
 *
 * Bentuknya sama dengan webhook keluar MesinPOS — `id`, `event`, `createdAt`,
 * `data` — karena itulah amplop yang sudah diterima penerima marketplace (200),
 * sementara kiriman tanpa `id`/`event` ditolak 400. Flag upsert tetap di akar
 * amplop (bukan hanya di `data`) supaya penerima lama yang membaca `upsertKey`
 * di akar tetap mengenalinya, tanpa menggandakan daftar produk.
 */
export function marketplacePushEnvelope(input: {
  event: MarketplacePushEvent;
  at: number;
  subject?: string;
  upsertKey: "sku" | "number";
  trigger: "manual" | "stock" | "sale" | "category";
  pairing: { vendorId: string; vendorName: string; pairingCode: string };
  data: unknown;
}): MarketplacePushEnvelope {
  return {
    id: marketplacePushEventId({ event: input.event, at: input.at, subject: input.subject }),
    event: input.event,
    createdAt: new Date(input.at).toISOString(),
    version: 1,
    generatedAt: input.at,
    source: "mesinpos",
    mode: "upsert",
    upsertKey: input.upsertKey,
    createMissing: true,
    trigger: input.trigger,
    pairing: input.pairing,
    data: input.data,
  };
}

/**
 * URL endpoint dorongan penjualan.
 *
 * Urutannya `SALES_URL` → `STOCK_URL` → `PRODUCTS_URL` → `SYNC_URL`: satu
 * endpoint tulis milik marketplace cukup untuk menerima katalog, stok, dan
 * penjualan — bentuk badannya dibedakan `trigger`.
 */
export function marketplaceSalesPushUrl(
  env: Record<string, string | undefined>,
): string {
  return (
    (env[MARKETPLACE_ENV.salesUrl] ??
      env[MARKETPLACE_ENV.stockUrl] ??
      env[MARKETPLACE_ENV.productsUrl] ??
      env[MARKETPLACE_ENV.syncUrl] ??
      "") as string
  ).trim();
}

export interface MarketplaceSaleQueueMerge {
  saleIds: string[];
}

/**
 * Menggabungkan id penjualan ke antrean yang sudah ada tanpa duplikat. Kalau
 * melewati batas, yang dibuang adalah nota **tertua** — nota terbaru justru
 * yang paling perlu segera terlihat di marketplace. Urutannya tetap: lama di
 * depan, baru di belakang.
 */
export function mergeMarketplaceSaleQueue(input: {
  saleIds: readonly string[];
  incoming: readonly string[];
}): MarketplaceSaleQueueMerge {
  const merged: string[] = [];
  for (const id of [...input.saleIds, ...input.incoming]) {
    if (id === "" || merged.includes(id)) continue;
    merged.push(id);
  }
  return {
    saleIds: merged.slice(Math.max(0, merged.length - MARKETPLACE_SALES_QUEUE_LIMIT)),
  };
}

/** Satu baris item dalam kiriman penjualan; kode modifier ikut bila ada. */
export interface MarketplaceSaleLine {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  modifiers: string[];
}

/** Satu nota dalam kiriman penjualan; `status: "void"` adalah pembatalan. */
export interface MarketplaceSaleRow {
  number: string;
  status: "completed" | "void";
  at: number;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  /** Metode bayar yang dipakai, digabung `+` bila lebih dari satu. */
  method: string;
  customerCode: string | null;
  memberCode: string | null;
  itemCount: number;
  items: MarketplaceSaleLine[];
}

/** Stok lokasi jual sebuah SKU **sesudah** transaksi, ikut di kiriman yang sama. */
export interface MarketplaceStockRow {
  sku: string;
  stock: number;
}

/**
 * Badan kiriman penjualan otomatis.
 *
 * `upsertKey: "number"` dipakai marketplace untuk menolak kiriman ulang (nota
 * yang sama dikirim dua kali karena percobaan ulang) — bukan menambah penjualan
 * kedua. Stok dikirim bersama supaya satu permintaan memperbarui keduanya,
 * persis seperti `stock.changed` pada webhook keluar.
 */
export interface MarketplaceSalesPushBody {
  version: 1;
  generatedAt: number;
  source: "mesinpos";
  mode: "upsert";
  upsertKey: "number";
  createMissing: true;
  trigger: "sale";
  pairing: { vendorId: string; vendorName: string; pairingCode: string };
  sales: MarketplaceSaleRow[];
  stock: MarketplaceStockRow[];
}

/** Menyusun badan kiriman dari baris yang sudah dibaca server. */
export function marketplaceSalesPushBody(input: {
  generatedAt: number;
  pairing: { vendorId: string; vendorName: string; pairingCode: string };
  sales: readonly MarketplaceSaleRow[];
  stock: readonly MarketplaceStockRow[];
}): MarketplaceSalesPushBody {
  return {
    version: 1,
    generatedAt: input.generatedAt,
    source: "mesinpos",
    mode: "upsert",
    upsertKey: "number",
    createMissing: true,
    trigger: "sale",
    pairing: {
      vendorId: input.pairing.vendorId,
      vendorName: input.pairing.vendorName,
      pairingCode: input.pairing.pairingCode,
    },
    sales: [...input.sales],
    stock: [...input.stock],
  };
}

/**
 * Jenis peristiwa untuk satu kiriman penjualan.
 *
 * Satu kiriman bisa memuat beberapa nota. Kalau **semuanya** pembatalan,
 * peristiwanya `sale.voided`; campuran tetap `sale.completed` karena status tiap
 * baris (`completed`/`void`) ikut dikirim di `data.sales`.
 */
export function marketplaceSalesPushEvent(
  sales: readonly { status: "completed" | "void" }[],
): MarketplacePushEvent {
  const allVoid = sales.length > 0 && sales.every((sale) => sale.status === "void");
  return allVoid ? MARKETPLACE_PUSH_EVENTS.saleVoid : MARKETPLACE_PUSH_EVENTS.sale;
}

/** Penanda `id` kiriman penjualan: nomor nota, atau jumlah nota bila banyak. */
export function marketplaceSalesPushSubject(sales: readonly { number: string }[]): string {
  return sales.length === 1 ? sales[0].number : `${sales.length}nota`;
}

/** Jumlah pada catatan dorongan penjualan terakhir. */
export interface MarketplaceSalesSyncCounts {
  sales: number;
  items: number;
  stock: number;
}

/**
 * Kalimat status dorongan penjualan untuk kartu Pengaturan. Ditulis apa adanya:
 * kiriman yang gagal tidak pernah disebut “tersinkron”.
 */
export function marketplaceSalesSyncSentence(
  pairing: Pick<
    MarketplacePairingView,
    | "lastSalesSyncAt"
    | "lastSalesSyncStatus"
    | "lastSalesSyncNote"
    | "lastSalesSyncCounts"
  >,
): string {
  if (!pairing.lastSalesSyncAt) {
    return "Penjualan otomatis belum pernah dikirim ke marketplace.";
  }
  const when = new Date(pairing.lastSalesSyncAt).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  if (pairing.lastSalesSyncStatus === "failed") {
    return `Dorongan penjualan otomatis ${when} gagal: ${
      pairing.lastSalesSyncNote ?? "marketplace menolak kiriman."
    }`;
  }
  const counts = pairing.lastSalesSyncCounts;
  if (!counts) return `Penjualan terakhir dikirim otomatis ${when}.`;
  return `Penjualan terakhir dikirim otomatis ${when}: ${counts.sales} nota, ${counts.items} item, ${counts.stock} SKU stok ikut.`;
}

/** Jumlah baris yang ikut dalam satu snapshot. */
export interface MarketplaceSnapshotCounts {
  products: number;
  sales: number;
  purchases: number;
  payables: number;
}

export const EMPTY_MARKETPLACE_COUNTS: MarketplaceSnapshotCounts = {
  products: 0,
  sales: 0,
  purchases: 0,
  payables: 0,
};

/** Jumlah baris dalam snapshot — satu sumber untuk layar dan harness. */
export function marketplaceSnapshotCounts(snapshot: {
  products?: unknown[];
  sales?: unknown[];
  purchases?: unknown[];
  payables?: unknown[];
}): MarketplaceSnapshotCounts {
  return {
    products: snapshot.products?.length ?? 0,
    sales: snapshot.sales?.length ?? 0,
    purchases: snapshot.purchases?.length ?? 0,
    payables: snapshot.payables?.length ?? 0,
  };
}

/** Status yang bisa terlihat di kartu pengaturan. */
export type MarketplacePairingState = "paired" | "unpaired";

/**
 * Satu baris pairing seperti yang dibaca UI. Token hanya ikut untuk pemilik;
 * anggota lain melihat pasangannya tanpa bisa menyalin tautan sinkron.
 */
export interface MarketplacePairingView {
  vendorId: string;
  vendorName: string;
  contactKind: MarketplaceContactKind;
  /** Kontak yang sudah dinormalkan; hanya ditampilkan ke pemilik. */
  contact: string | null;
  contactMasked: string;
  /** Marketplace sudah menyatakan kontak ini milik vendor tersebut. */
  contactVerified: boolean;
  pairedAt: number;
  pairedByName: string;
  pairingCode: string;
  /** Token rahasia tautan snapshot; `null` untuk anggota non-pemilik. */
  syncToken: string | null;
  lastPullAt: number | null;
  lastPullCounts: MarketplaceSnapshotCounts | null;
  /** Percobaan dorong terakhir (tombol “Sinkronkan sekarang”). */
  lastSyncAt: number | null;
  lastSyncStatus: "delivered" | "failed" | "ready" | null;
  lastSyncNote: string | null;
  /** Dorongan **katalog produk** terakhir (tombol “Sinkronkan produk”). */
  lastProductSyncAt: number | null;
  lastProductSyncStatus: "delivered" | "failed" | "ready" | null;
  lastProductSyncNote: string | null;
  lastProductSyncCounts: MarketplaceProductPushCounts | null;
  /** Tarikan **katalog marketplace → MesinPOS** terakhir (tombol “Impor katalog”). */
  lastCatalogAt: number | null;
  lastCatalogStatus: MarketplaceCatalogStatus | null;
  lastCatalogNote: string | null;
  lastCatalogCounts: MarketplaceCatalogCounts | null;
  /**
   * Dorongan **stok otomatis** terakhir — dikirim sendiri sesudah penjualan,
   * pembatalan, penerimaan barang, opname, atau penyesuaian stok; bukan tombol.
   * Opsional karena baris pairing lama (dan pairing mode demo) belum punya
   * kolomnya, dan itu harus terbaca sebagai “belum pernah”, bukan galat.
   */
  lastStockSyncAt?: number | null;
  lastStockSyncStatus?: "delivered" | "failed" | null;
  lastStockSyncNote?: string | null;
  lastStockSyncCounts?: MarketplaceProductPushCounts | null;
  /**
   * Dorongan **penjualan otomatis** terakhir (nota selesai & pembatalan)
   * beserta stok SKU yang tersentuh. Opsional untuk baris pairing lama.
   */
  lastSalesSyncAt?: number | null;
  lastSalesSyncStatus?: "delivered" | "failed" | null;
  lastSalesSyncNote?: string | null;
  lastSalesSyncCounts?: MarketplaceSalesSyncCounts | null;
  /** `true` kalau rahasia penanda tangan sudah diisi (nilainya tidak dikirim). */
  pushSecretSet?: boolean;
  /** Empat karakter terakhir rahasia penanda tangan, untuk memastikan yang sama. */
  pushSecretLastFour?: string | null;
  /**
   * **Pemeriksaan selisih stok** terakhir (cron harian atau tombol “Periksa
   * sekarang”). Opsional karena baris pairing lama belum punya kolomnya; UI
   * membacanya sebagai “belum pernah diperiksa”, bukan galat.
   */
  lastReconcileAt?: number | null;
  lastReconcileStatus?: MarketplaceReconcileStatus | null;
  lastReconcileNote?: string | null;
  lastReconcileCounts?: MarketplaceStockDiffCounts | null;
  /**
   * **Sinkron barcode otomatis** terakhir (cron harian): marketplace → POS,
   * hanya kolom `barcode`/`barcodeType`. Opsional untuk baris pairing lama.
   */
  lastBarcodeSyncAt?: number | null;
  lastBarcodeSyncStatus?: MarketplaceBarcodeSyncStatus | null;
  lastBarcodeSyncNote?: string | null;
  lastBarcodeSyncCounts?: MarketplaceBarcodeSyncCounts | null;
  /** Baris selisih per SKU dari pemeriksaan terakhir (sudah terbatas). */
  stockDiffs?: MarketplaceStockDiff[];
}

export interface MarketplaceStatusView {
  pairing: MarketplacePairingView | null;
  /** Hanya pemilik yang boleh memasangkan/melepas. */
  canPair: boolean;
  /** Alasan kenapa tombol pairing mati (mis. manajer). */
  pairBlockedReason: string | null;
  /** Query status masih dimuat; kartu menampilkan keadaan tunggu, bukan menebak. */
  loading: boolean;
  /**
   * Endpoint dorong (stok/katalog) terisi di server. Kalau `false`, perubahan
   * stok tidak bisa dikabarkan sendiri dan kartu mengatakannya apa adanya —
   * bukan menampilkan “tersinkron” untuk kiriman yang tidak pernah berangkat.
   */
  pushEndpointReady?: boolean;
  /** Endpoint dorong penjualan terisi; kalau `false`, nota hanya siap ditarik. */
  salesPushEndpointReady?: boolean;
  /**
   * Arah **marketplace → MesinPOS**: alamat penerimaan pesanan beserta riwayat
   * terakhir. Opsional karena pairing lama/mode demo belum punya barisnya.
   */
  inbound?: MarketplaceInboundView | null;
}

/** Ringkasan satu baris untuk badge kartu. */
export function marketplacePairingSentence(
  pairing: Pick<MarketplacePairingView, "vendorName" | "pairingCode"> | null,
): string {
  if (!pairing) return "Belum dipasangkan ke vendor marketplace.";
  return `Terpasang ke ${pairing.vendorName} (${pairing.pairingCode}).`;
}

/** Kalimat status kontak: terverifikasi marketplace atau masih klaim. */
export function marketplaceContactSentence(
  pairing: Pick<MarketplacePairingView, "contactKind" | "contactMasked" | "contactVerified">,
): string {
  const label = MARKETPLACE_CONTACT_LABELS[pairing.contactKind].toLowerCase();
  return pairing.contactVerified
    ? `Kontak ${label} ${pairing.contactMasked} sudah dicocokkan marketplace.`
    : `Kontak ${label} ${pairing.contactMasked} dicatat sebagai klaim pemilik; marketplace mencocokkannya saat menarik data.`;
}

/** Kalimat “kapan marketplace terakhir menarik data”. */
export function marketplacePullSentence(
  pairing: Pick<MarketplacePairingView, "lastPullAt" | "lastPullCounts">,
): string {
  if (!pairing.lastPullAt) {
    return "Marketplace belum pernah menarik data dari workspace ini.";
  }
  const when = new Date(pairing.lastPullAt).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const counts = pairing.lastPullCounts;
  if (!counts) return `Marketplace terakhir menarik data ${when}.`;
  return `Marketplace terakhir menarik data ${when}: ${counts.products} produk, ${counts.sales} penjualan, ${counts.purchases} penerimaan, ${counts.payables} hutang.`;
}

/**
 * Menyusun URL snapshot yang bisa dipakai marketplace. Token **selalu** ikut di
 * query supaya bisa ditempel apa adanya ke konfigurasi marketplace; tautannya
 * hanya ditampilkan ke pemilik.
 */
export function marketplaceSnapshotPath(token: string): string {
  return `/api/marketplace/snapshot?token=${encodeURIComponent(token)}`;
}

/** Apakah token berbentuk token sinkron yang kita terbitkan (`mp_` + hex). */
export function isMarketplaceSyncToken(value: string): boolean {
  return /^mp_[a-f0-9]{48}$/.test(value ?? "");
}

/* ------------------------------------------- pesanan marketplace → MesinPOS */

/**
 * Alamat yang dipanggil marketplace saat **penjualan terjadi di sana**.
 *
 * Sinkronisasi selama ini hanya satu arah (MesinPOS → marketplace) plus tautan
 * snapshot yang ditarik marketplace. Keduanya tidak memberi tahu MesinPOS bahwa
 * ada pesanan masuk di marketplace, jadi nota marketplace tidak pernah menjadi
 * penjualan di POS dan stoknya tidak berkurang. Alamat ini menutup arah itu:
 * marketplace mengirim pesanannya, MesinPOS mencatatnya lewat jalur penjualan
 * yang sama dengan kasir (harga, PPN, stok, dan audit dihitung server).
 */
export const MARKETPLACE_INBOUND_PATH = "/api/marketplace/orders";

/**
 * Event yang diterima dari marketplace. Sengaja hanya dua: pesanan baru dan
 * pembatalannya. Penyesuaian stok/harga dari marketplace **tidak** diterima
 * karena arah katalog tetap MesinPOS → marketplace; menerimanya akan membuat
 * dua sisi saling menimpa saldo yang baru saja dikirim.
 */
export const MARKETPLACE_INBOUND_EVENTS = ["order.created", "sale.voided"] as const;

export type MarketplaceInboundEvent = (typeof MARKETPLACE_INBOUND_EVENTS)[number];

/** Baris riwayat yang ditampilkan di kartu Pengaturan. */
export const MARKETPLACE_INBOUND_LIMIT = 5;

export function isMarketplaceInboundEvent(value: string): boolean {
  return (MARKETPLACE_INBOUND_EVENTS as readonly string[]).includes(value);
}

/**
 * Alamat lengkap untuk marketplace. `baseUrl` berasal dari `CONVEX_SITE_URL`
 * deployment ini; kalau kosong hasilnya string kosong dan kartu tidak mengarang
 * alamat yang tidak bisa dihubungi.
 */
export function marketplaceInboundUrl(baseUrl: string): string {
  const base = (baseUrl ?? "").trim().replace(/\/+$/, "");
  return base === "" ? "" : `${base}${MARKETPLACE_INBOUND_PATH}`;
}

/**
 * Penanda pesanan marketplace di dalam `idempotencyKey` penjualan MesinPOS.
 *
 * Marketplace sudah lebih dulu mengirim pesanan lunas lewat `POST /api/v1/sales`
 * dengan kunci `pbb-order-<id>`. Endpoint penerimaan langsung memakai penanda
 * yang sama supaya pesanan yang datang lewat **dua jalur** (cron marketplace dan
 * dorongan langsung) tetap menjadi **satu** penjualan, bukan dua.
 */
export const MARKETPLACE_ORDER_ID_PREFIX = "pbb-order-";

/** Jumlah nota marketplace terakhir yang ditampilkan di kartu. */
export const MARKETPLACE_SALE_RECEIPT_LIMIT = 5;

/**
 * Bentuk kanonik id pesanan marketplace: selalu `pbb-order-<id>`, apa pun bentuk
 * yang dikirim. Id kosong tetap kosong supaya pemanggil bisa menolaknya.
 */
export function marketplaceOrderKey(orderId: string): string {
  const raw = (orderId ?? "").trim();
  if (raw === "") return "";
  const bare = raw.startsWith(MARKETPLACE_ORDER_ID_PREFIX)
    ? raw.slice(MARKETPLACE_ORDER_ID_PREFIX.length)
    : raw;
  return bare === "" ? "" : `${MARKETPLACE_ORDER_ID_PREFIX}${bare}`;
}

/**
 * Apakah badan ini pesanan marketplace (dikenali dari kunci idempotensinya)?
 * Hanya pesanan bertanda itulah yang disiapkan lebih dulu; kiriman integrasi
 * lain tetap diperiksa dengan kontrak API yang ketat.
 */
export function isMarketplaceOrderBody(body: unknown): boolean {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const key = (body as Record<string, unknown>).idempotencyKey;
  return (
    typeof key === "string" &&
    key.trim().startsWith(MARKETPLACE_ORDER_ID_PREFIX)
  );
}

/** Metode bayar yang lazim ditulis marketplace → metode yang dikenal MesinPOS. */
const MARKETPLACE_PAYMENT_METHODS: Record<
  string,
  "cash" | "qris" | "card" | "transfer"
> = {
  cash: "cash",
  tunai: "cash",
  cod: "cash",
  bayar_di_tempat: "cash",
  qris: "qris",
  qr: "qris",
  qr_code: "qris",
  qrstatis: "qris",
  transfer: "transfer",
  bank: "transfer",
  bank_transfer: "transfer",
  transfer_bank: "transfer",
  manual_transfer: "transfer",
  transfer_manual: "transfer",
  va: "transfer",
  virtual_account: "transfer",
  card: "card",
  kartu: "card",
  debit: "card",
  credit: "card",
  credit_card: "card",
  kartu_kredit: "card",
  kartu_debit: "card",
};

function normalizePaymentMethod(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return MARKETPLACE_PAYMENT_METHODS[key] ?? raw;
}

/** Angka yang boleh datang sebagai teks (`"2"`, `"2.5"`, `" 2 "`). */
function numberLike(raw: unknown): unknown {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && /^\s*\d+(\.\d+)?\s*$/.test(raw)) {
    return Number(raw.trim());
  }
  return raw;
}

function textLike(raw: unknown): unknown {
  return typeof raw === "string" ? raw.trim() : raw;
}

/**
 * Menyiapkan badan pesanan marketplace sebelum diperiksa `parseExternalOrder`.
 *
 * Pesanan dari marketplace dibuat oleh aplikasi lain yang mengirim **lebih
 * banyak** field daripada kontrak API MesinPOS (nama & harga baris, catatan,
 * ongkir, dan status pembayaran mereka). Kontrak API tetap ketat untuk semua
 * pemanggil, tetapi pesanan yang **sudah lunas** tidak boleh tertahan hanya
 * karena penerimanya tidak mengenal field tambahan — jadi untuk pesanan bertanda
 * `pbb-order-…` field asing dibuang di sini, bukan ditolak.
 *
 * Tiga penyesuaian lain yang juga lazim dari marketplace:
 *  - **baris kembar digabung** (pelanggan membeli produk yang sama sebagai dua
 *    baris pesanan) — kuantitasnya dijumlahkan, bukan ditolak;
 *  - **angka berbentuk teks** (`"2"`) dibaca sebagai angka;
 *  - **nama metode bayar** dipetakan (`bank_transfer`/`va`/`cod`/… → metode yang
 *    dikenal MesinPOS), karena kalau tidak, seluruh pesanan ditolak 400.
 *
 * Nama produk (`name`) ikut dibawa: kalau SKU-nya bergeser, server masih bisa
 * mencocokkan produk lewat nama yang persis & unik.
 */
export function prepareMarketplaceOrderBody(body: unknown): unknown {
  if (!isMarketplaceOrderBody(body)) return body;
  const source = body as Record<string, unknown>;
  const prepared: Record<string, unknown> = {};

  for (const key of [
    "idempotencyKey",
    "discount",
    "customerCode",
    "memberCode",
  ]) {
    if (source[key] !== undefined) {
      prepared[key] = key === "discount" ? numberLike(source[key]) : textLike(source[key]);
    }
  }

  if (Array.isArray(source.lines)) {
    const merged: Record<string, unknown>[] = [];
    const bySignature = new Map<string, Record<string, unknown>>();
    for (const rawLine of source.lines) {
      if (typeof rawLine !== "object" || rawLine === null || Array.isArray(rawLine)) {
        merged.push(rawLine as Record<string, unknown>);
        continue;
      }
      const line = rawLine as Record<string, unknown>;
      const sku = textLike(line.sku ?? line.productSku ?? line.code);
      const unitCode = textLike(line.unitCode);
      const name = textLike(line.name ?? line.productName ?? line.title);
      const quantity = numberLike(line.quantity);
      const signature = [
        typeof sku === "string" ? sku.toUpperCase() : "",
        typeof unitCode === "string" ? unitCode.toUpperCase() : "",
        JSON.stringify(line.modifiers ?? null),
      ].join("@");

      const existing = bySignature.get(signature);
      if (
        existing &&
        typeof quantity === "number" &&
        typeof existing.quantity === "number"
      ) {
        existing.quantity = (existing.quantity as number) + quantity;
        continue;
      }

      const next: Record<string, unknown> = { sku, quantity };
      if (unitCode !== undefined && unitCode !== null && unitCode !== "") {
        next.unitCode = unitCode;
      }
      if (typeof name === "string" && name !== "") next.name = name;
      if (line.modifiers !== undefined) next.modifiers = line.modifiers;
      merged.push(next);
      bySignature.set(signature, next);
    }
    prepared.lines = merged;
  } else if (source.lines !== undefined) {
    prepared.lines = source.lines;
  }

  if (typeof source.payment === "object" && source.payment !== null) {
    const payment = source.payment as Record<string, unknown>;
    const next: Record<string, unknown> = { method: normalizePaymentMethod(payment.method) };
    if (payment.amount !== undefined) next.amount = numberLike(payment.amount);
    if (payment.provider !== undefined) next.provider = textLike(payment.provider);
    if (payment.providerRef !== undefined) next.providerRef = textLike(payment.providerRef);
    prepared.payment = next;
  } else if (source.payment !== undefined) {
    prepared.payment = source.payment;
  }

  return prepared;
}

/** Hasil tombol **Catat ulang** untuk pesanan marketplace yang pernah ditolak. */
export interface MarketplaceRetryResult {
  ok: boolean;
  /** Nomor nota MesinPOS kalau pesanannya kini tercatat. */
  saleNumber: string | null;
  message: string;
}

/**
 * Isi pesanan dari catatan penolakan yang tersimpan di
 * `marketplaceInboundOrders.payload`.
 *
 * Dua jalur menyimpan bentuk yang berbeda: endpoint langsung menyimpan amplop
 * `{ id, event, data }`, sedangkan `POST /api/v1/sales` menyimpan isi pesanan
 * saja (`{ lines, payment, … }`). Keduanya diterima di sini, jadi tombol **Catat
 * ulang** tidak perlu tahu dari jalur mana pesanan itu datang.
 */
export function marketplaceRetryPayload(
  payload: string,
): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const body = parsed as Record<string, unknown>;
  const data = body.data;
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return body;
}

/** Satu nota yang lahir dari pesanan marketplace (terdeteksi dari kuncinya). */
export interface MarketplaceSaleReceipt {
  number: string;
  total: number;
  status: "completed" | "void";
  at: number;
}

/**
 * Apakah penjualan ini berasal dari marketplace? Kuncinya ditulis jalur API
 * (`api:<tenant>:pbb-order-…`), jadi tidak perlu kolom baru di tabel penjualan
 * dan penjualan lama tetap terbaca apa adanya.
 */
export function isMarketplaceSaleKey(
  idempotencyKey: string,
  tenantId: string,
): boolean {
  return (idempotencyKey ?? "").startsWith(
    `api:${tenantId}:${MARKETPLACE_ORDER_ID_PREFIX}`,
  );
}

export type MarketplaceInboundStatus = "applied" | "rejected" | "duplicate";

/** Satu pesanan marketplace yang sudah diterima (atau ditolak) MesinPOS. */
export interface MarketplaceInboundOrderView {
  /** `id` pesanan dari marketplace — kunci idempotensi. */
  orderId: string;
  event: string;
  status: MarketplaceInboundStatus;
  /** Nomor nota MesinPOS yang lahir dari pesanan ini (bila berhasil). */
  saleNumber: string | null;
  message: string | null;
  at: number;
}

export interface MarketplaceInboundView {
  /** Kosong kalau `CONVEX_SITE_URL` deployment belum terbaca. */
  url: string;
  events: string[];
  /** Kiriman yang masuk lewat endpoint langsung (kalau marketplace memakainya). */
  orders: MarketplaceInboundOrderView[];
  /**
   * Nota yang lahir dari pesanan marketplace lewat jalur API yang sudah dipakai
   * marketplace (cron ±10 menit). Inilah bukti nyata bahwa penjualan di sana
   * sudah masuk MesinPOS, terlepas dari endpoint langsung dipakai atau tidak.
   */
  sales: MarketplaceSaleReceipt[];
}

/**
 * Kalimat status arah marketplace → MesinPOS. Ditulis apa adanya: "belum ada"
 * bukan berarti fitur mati, dan penolakan menyebut sebab yang bisa dibaca.
 */
export function marketplaceInboundSentence(view: {
  orders: readonly MarketplaceInboundOrderView[];
  sales?: readonly MarketplaceSaleReceipt[];
}): string {
  const lastOrder = view.orders[0];
  const lastSale = view.sales?.[0];
  const when = (at: number) =>
    new Date(at).toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });

  if (!lastOrder && !lastSale) {
    return "Belum ada pesanan marketplace yang masuk.";
  }
  // Nota yang benar-benar sudah tercatat lebih kuat daripada catatan kiriman:
  // itulah yang dilihat pemilik saat membuka riwayat penjualan.
  if (lastSale && (!lastOrder || lastSale.at >= lastOrder.at)) {
    return `Pesanan marketplace terakhir diterima ${when(
      lastSale.at,
    )} sebagai nota ${lastSale.number}.`;
  }
  if (!lastOrder) return "Belum ada pesanan marketplace yang masuk.";
  if (lastOrder.status === "rejected") {
    return `Pesanan marketplace ${lastOrder.orderId} ditolak ${when(
      lastOrder.at,
    )}: ${lastOrder.message ?? "bentuk kirimannya tidak sesuai."}`;
  }
  const nota = lastOrder.saleNumber
    ? `nota ${lastOrder.saleNumber}`
    : "tanpa nomor nota";
  return `Pesanan marketplace terakhir ${lastOrder.orderId} diterima ${when(
    lastOrder.at,
  )} sebagai ${nota}.`;
}

/** Hasil tombol “Sinkronkan sekarang”. */
export interface MarketplaceSyncResult {
  delivered: boolean;
  status: "delivered" | "failed" | "ready";
  note: string;
  counts: MarketplaceSnapshotCounts;
  at: number;
}

/** Kode status HTTP yang dipakai endpoint snapshot. */
export const MARKETPLACE_SNAPSHOT_ERRORS = {
  missingToken: "Token pairing wajib dikirim (query `token` atau header Authorization).",
  invalidToken: "Token pairing tidak dikenal atau pairing sudah dilepas.",
} as const;

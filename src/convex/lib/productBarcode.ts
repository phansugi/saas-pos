/**
 * Barcode / QR Code produk.
 *
 * Produk boleh punya **satu kode** yang dipindai kasir, terpisah dari SKU:
 *
 *  - `barcode`      — pilihan untuk barang yang labelnya membawa barcode pabrik
 *                     (EAN/UPC/Code 39) atau kode internal toko;
 *  - `qr`           — pilihan untuk kode dua dimensi, termasuk QR dari pemasok.
 *
 * Kode **tidak wajib**: produk tanpa kode tetap bisa dijual lewat SKU, dan hasil
 * scan selalu dicocokkan ke SKU lebih dulu. Tombol **Buat otomatis** membuat kode
 * dari SKU — Code 39 untuk jenis Barcode (standar kasir, cukup angka & huruf) dan
 * QR Code untuk jenis QR — jadi tidak ada kode yang dikarang tanpa dasar.
 *
 * Aturannya murni dan dipakai bersama halaman Produk & Stok, store demo, backend,
 * dan harness. Convex hanya membundel modul di bawah `src/convex`, karena itu
 * implementasinya ada di sini dan `src/lib/productBarcode.ts` hanya meneruskan.
 */

export type ProductBarcodeType = "barcode" | "qr";

export const PRODUCT_BARCODE_TYPES: ProductBarcodeType[] = ["barcode", "qr"];

export const PRODUCT_BARCODE_TYPE_LABELS: Record<ProductBarcodeType, string> = {
  barcode: "Barcode",
  qr: "QR Code",
};

/** Batas panjang kode. QR bisa lebih panjang, tetapi kode kasir tidak perlu. */
export const MAX_PRODUCT_BARCODE_LENGTH = 120;

/**
 * Karakter yang bisa ditulis Code 39. Barcode 1D di sini sengaja memakai Code 39
 * karena paling luas dibaca pemindai POS dan tidak butuh pustaka tambahan.
 */
const CODE39_PATTERN = /^[0-9A-Z\-. $/+%]+$/;

/**
 * Tabel Code 39 (9 elemen per karakter, elemen lebar = 3 modul). `*` adalah
 * penanda awal/akhir.
 */
const CODE39_ENCODINGS: Record<string, string> = {
  "0": "101000111011101",
  "1": "111010001010111",
  "2": "101110001010111",
  "3": "111011100010101",
  "4": "101000111010111",
  "5": "111010001110101",
  "6": "101110001110101",
  "7": "101000101110111",
  "8": "111010001011101",
  "9": "101110001011101",
  A: "111010100010111",
  B: "101110100010111",
  C: "111011101000101",
  D: "101011100010111",
  E: "111010111000101",
  F: "101110111000101",
  G: "101010001110111",
  H: "111010100011101",
  I: "101110100011101",
  J: "101011100011101",
  K: "111010101000111",
  L: "101110101000111",
  M: "111011101010001",
  N: "101011101000111",
  O: "111010111010001",
  P: "101110111010001",
  Q: "101010111000111",
  R: "111010101110001",
  S: "101110101110001",
  T: "101011101110001",
  U: "111000101010111",
  V: "100011101010111",
  W: "111000111010101",
  X: "100010111010111",
  Y: "111000101110101",
  Z: "100011101110101",
  "-": "100010101110111",
  ".": "111000101011101",
  " ": "100011101011101",
  $: "100010001000101",
  "/": "100010001010001",
  "+": "100010100010001",
  "%": "101000100010001",
  "*": "1000101110111010",
};

/** Teks kode dirapikan: spasi pinggir & spasi ganda hilang. */
export function normalizeProductBarcode(raw: string): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Kunci pembanding kode: huruf besar, spasi pinggir hilang. */
export function productBarcodeKey(raw: string): string {
  return normalizeProductBarcode(raw).toLocaleUpperCase("id-ID");
}

/** Benar kalau nilai ini salah satu jenis kode yang dikenal. */
export function isProductBarcodeType(value: unknown): value is ProductBarcodeType {
  return value === "barcode" || value === "qr";
}

/** Jenis kode yang dipakai kalau produk lama belum menyimpannya. */
export function productBarcodeTypeOr(value: unknown): ProductBarcodeType {
  return isProductBarcodeType(value) ? value : "barcode";
}

/**
 * Kode otomatis dari SKU. SKU dipakai apa adanya (huruf besar, spasi dirapikan),
 * jadi label yang dibuat di sini cocok dengan yang tercetak di kemasan.
 *
 * Mengembalikan `null` kalau SKU belum diisi atau mengandung karakter yang tidak
 * bisa ditulis Code 39 — pemanggil bisa menyarankan QR Code, bukan diam-diam
 * membuang karakter.
 */
export function barcodeFromSku(sku: string): string | null {
  const value = normalizeProductBarcode(sku).toLocaleUpperCase("id-ID");
  if (value.length === 0 || value.length > MAX_PRODUCT_BARCODE_LENGTH) return null;
  if (!CODE39_PATTERN.test(value)) return null;
  return value;
}

export interface ProductBarcodeInput {
  barcode?: string;
  /** Jenis pilihan pengguna; default Barcode kalau kosong/tidak dikenal. */
  barcodeType?: unknown;
}

export type ProductBarcodeValidation =
  | { ok: true; value: string; type: ProductBarcodeType }
  | { ok: false; reason: string };

/**
 * Memvalidasi kode sebelum disimpan. Kode kosong berarti **tidak ada kode** —
 * selalu boleh, supaya kode bisa dilepas lagi.
 *
 * Untuk jenis Barcode, nilai dinormalkan ke huruf besar karena Code 39 hanya
 * mengenal huruf besar; hasilnya dikembalikan supaya pemanggil menyimpan nilai
 * yang sama dengan yang digambar, bukan teks mentah yang diketik.
 */
export function validateProductBarcode(
  input: ProductBarcodeInput,
): ProductBarcodeValidation {
  const value = normalizeProductBarcode(input.barcode ?? "");
  const type = input.barcodeType === undefined
    ? "barcode"
    : isProductBarcodeType(input.barcodeType)
      ? input.barcodeType
      : null;

  if (type === null) {
    return {
      ok: false,
      reason: `Jenis kode tidak dikenal. Pilih ${PRODUCT_BARCODE_TYPE_LABELS.barcode} atau ${PRODUCT_BARCODE_TYPE_LABELS.qr}.`,
    };
  }

  if (value.length === 0) return { ok: true, value: "", type };
  if (value.length > MAX_PRODUCT_BARCODE_LENGTH) {
    return {
      ok: false,
      reason: `Kode maksimal ${MAX_PRODUCT_BARCODE_LENGTH} karakter.`,
    };
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return { ok: false, reason: "Kode tidak boleh memuat baris baru atau karakter kontrol." };
  }

  if (type === "barcode") {
    const upper = value.toLocaleUpperCase("id-ID");
    if (!CODE39_PATTERN.test(upper)) {
      return {
        ok: false,
        reason:
          "Barcode Code 39 hanya mendukung A–Z, 0–9, spasi, dan - . $ / + %. Pilih QR Code untuk kode dengan karakter lain.",
      };
    }
    return { ok: true, value: upper, type };
  }

  return { ok: true, value, type };
}

/**
 * Modul Code 39 (1 = batang gelap) untuk sebuah teks, sudah termasuk penanda
 * awal/akhir `*`. Array kosong berarti teksnya tidak bisa ditulis sebagai Code 39.
 *
 * Yang dikembalikan adalah **bitmap modul**, bukan daftar batang: komponen gambar
 * mengelompokkannya jadi batang selebar beberapa modul, jadi lebar batang tidak
 * ditentukan oleh CSS.
 */
export function code39Modules(raw: string): number[] {
  const value = normalizeProductBarcode(raw).toLocaleUpperCase("id-ID");
  if (value.length === 0 || !CODE39_PATTERN.test(value)) return [];

  let bits = CODE39_ENCODINGS["*"];
  for (const character of value) {
    const pattern = CODE39_ENCODINGS[character];
    if (!pattern) return [];
    bits += `${pattern}0`;
  }
  bits += CODE39_ENCODINGS["*"];

  return Array.from(bits, (bit) => (bit === "1" ? 1 : 0));
}

/**
 * Petak batang untuk SVG: setiap batang jadi `{ x, width }` dalam satuan modul.
 * Zona tenang 10 modul di kiri-kanan ikut dihitung pemanggil lewat `code39Extent`.
 */
export function code39Bars(raw: string): { x: number; width: number }[] {
  const modules = code39Modules(raw);
  const bars: { x: number; width: number }[] = [];
  let index = 0;
  while (index < modules.length) {
    if (modules[index] !== 1) {
      index += 1;
      continue;
    }
    let width = 0;
    while (index + width < modules.length && modules[index + width] === 1) {
      width += 1;
    }
    bars.push({ x: index, width });
    index += width;
  }
  return bars;
}

/** Zona tenang Code 39: 10 modul di tiap sisi, cukup untuk pemindai POS. */
export const CODE39_QUIET_ZONE = 10;

/** Lebar total gambar Code 39 (modul + zona tenang). */
export function code39Extent(raw: string): number {
  return code39Modules(raw).length + CODE39_QUIET_ZONE * 2;
}


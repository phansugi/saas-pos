/**
 * Aturan pencarian hasil **scan barcode / QR** di katalog MesinPOS.
 *
 * Setiap produk punya **SKU** dan boleh punya **barcode/QR** sendiri (kolom
 * `barcode` di form produk). Hasil scan (teks apa adanya dari kamera atau
 * pemindai USB) dicocokkan ke SKU lebih dulu, lalu ke barcode produk.
 *
 * Pencocokan sengaja:
 * - **persis** (bukan “mengandung”), supaya barcode `899` tidak membuka produk
 *   `899123` yang kebetulan berawalan sama;
 * - **tanpa membedakan huruf besar/kecil**, karena pemindai dan kamera sering
 *   mengirim teks dengan kapitalisasi berbeda dari yang diketik pemilik toko;
 * - spasi pinggir & spasi ganda dirapikan dulu, karena QR kadang membawa baris
 *   baru di ujungnya;
 * - beda **pemisah** (`PBB-0000005` ↔ `PBB0000005`) dan beda **karakter yang
 *   sering tertukar** (`B`↔`8`, `O`↔`0`, deretan nol yang panjang) masih
 *   dianggap kode yang sama **hanya kalau hasilnya tunggal** — lihat
 *   `findProductByScannedCode`. Label marketplace yang kecil sering terbaca
 *   `PB800005` untuk `PBB-0000005`, dan kasir tidak boleh disuruh mendaftarkan
 *   produk kembar hanya karena itu.
 *
 * Aturannya murni supaya halaman Kasir, halaman Produk & Stok, dan harness
 * menjawab dengan aturan yang sama — tidak ada dua pencocokan berbeda.
 */

/**
 * Prefix simbol yang dipakai marketplace di depan kode (`code39:PBB-0005`,
 * `qrcode:…`). Sebagian label/QR menyimpan nilai itu **apa adanya**, jadi prefix
 * yang dikenal dibuang sebelum dicocokkan — kode yang tersimpan di MesinPOS
 * adalah teks kodenya, bukan nama simbologinya.
 */
const SYMBOLOGY_PREFIXES = new Set([
  "code39",
  "code93",
  "code128",
  "ean13",
  "ean8",
  "upca",
  "upce",
  "itf",
  "codabar",
  "qrcode",
  "qr",
]);

/**
 * Teks hasil scan dirapikan: spasi pinggir & spasi ganda hilang, penanda
 * awal/akhir Code 39 (`*`) dan prefix simbologi marketplace dibuang.
 *
 * Prefix hanya dibuang kalau namanya dikenal **dan** ada isi di belakangnya,
 * sehingga QR berisi URL (`https://…`) tidak ikut terpotong.
 */
export function normalizeScannedCode(raw: string): string {
  let code = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  code = code.replace(/^\*+|\*+$/g, "").trim();
  const prefix = code.match(/^([a-z0-9_]+):(.*)$/i);
  if (
    prefix &&
    SYMBOLOGY_PREFIXES.has(prefix[1].toLowerCase()) &&
    prefix[2].trim() !== ""
  ) {
    return prefix[2].replace(/\s+/g, " ").trim();
  }
  return code;
}

/** Kunci tanpa pemisah: `PBB-0005` dan `PBB0005` dianggap kode yang sama. */
function looseScannedKey(raw: string): string {
  return scannedCodeKey(raw).replace(/[^0-9A-Z]/g, "");
}

/** Huruf/angka yang paling sering tertukar saat label dibaca pemindai murah. */
const CONFUSABLE_SCAN_CHARS: Record<string, string> = {
  "0": "O",
  "1": "I",
  "2": "Z",
  "5": "S",
  "6": "G",
  "8": "B",
};

/**
 * Kunci paling toleran: pemisah dibuang, angka yang sering tertukar dengan huruf
 * disamakan, lalu **deretan nol dirapatkan**. Dengan begitu `PBB-0000005` dan
 * `PB800005` sama-sama menjadi `PBBOS`.
 *
 * Dipakai hanya sebagai jalan terakhir dan hanya kalau hasilnya **tunggal**:
 * kode yang bisa menunjuk dua produk tetap dianggap belum terdaftar, karena
 * menebak barang yang salah lebih berbahaya daripada meminta kasir memilih.
 */
function tolerantScannedKey(raw: string): string {
  return looseScannedKey(raw)
    .replace(
      /[012568]/g,
      (character) => CONFUSABLE_SCAN_CHARS[character] ?? character,
    )
    .replace(/O{2,}/g, "O");
}

/** Kunci pembanding SKU: hasil scan yang sudah dirapikan & disamakan hurufnya. */
export function scannedCodeKey(raw: string): string {
  return normalizeScannedCode(raw).toLocaleUpperCase("id-ID");
}

/** Produk yang bisa dicari lewat scan; `barcode` opsional. */
export interface ScannableProduct {
  sku: string;
  barcode?: string;
}

/**
 * Produk yang SKU-nya (atau barcode/QR-nya) sama dengan hasil scan, atau `null`
 * kalau belum ada.
 *
 * SKU diperiksa lebih dulu: kode lama yang menempel di barang adalah SKU, dan
 * server menolak barcode yang bertabrakan dengan SKU produk lain. `null` bukan
 * berarti kodenya salah: artinya kode itu **belum terdaftar** dan boleh
 * didaftarkan sebagai produk baru (dengan catatan server tetap menolak kalau
 * kodenya ternyata sudah dipakai produk yang tidak dibaca di sini, mis. produk
 * nonaktif di halaman Kasir).
 */
export function findProductByScannedCode<T extends ScannableProduct>(
  products: readonly T[],
  raw: string,
): T | null {
  const key = scannedCodeKey(raw);
  if (key.length === 0) return null;
  const exact = products.find((product) => scannedCodeKey(product.sku) === key);
  if (exact) return exact;
  const byBarcode = products.find(
    (product) =>
      typeof product.barcode === "string" &&
      product.barcode.trim().length > 0 &&
      scannedCodeKey(product.barcode) === key,
  );
  if (byBarcode) return byBarcode;

  /*
    Terakhir, **hanya pemisah** yang diabaikan (`PBB-0005` ↔ `PBB0005`). Ini
    terjadi kalau pemindai dikonfigurasi tidak mengirim tanda hubung. Hasilnya
    harus **tunggal**: kalau dua produk bisa cocok, lebih baik kode dianggap
    belum terdaftar daripada menebak barang yang salah.
  */
  const loose = looseScannedKey(raw);
  if (loose.length < 4) return null;
  const longgar = products.filter(
    (product) =>
      looseScannedKey(product.sku) === loose ||
      (typeof product.barcode === "string" &&
        product.barcode.trim().length > 0 &&
        looseScannedKey(product.barcode) === loose),
  );
  if (longgar.length === 1) return longgar[0];
  if (longgar.length > 1) return null;

  /*
    Terakhir, karakter yang sering tertukar saat label kecil dibaca kamera
    (`B` terbaca `8`, deretan nol terlewat): `PB800005` untuk `PBB-0000005`.
    Sama seperti di atas, hanya kode yang menunjuk **tepat satu** produk yang
    diterima — kode yang ambigu tetap “belum terdaftar” dan kasir memilih dari
    usulan (`suggestProductsForScannedCode`).
  */
  const tolerant = tolerantScannedKey(raw);
  if (tolerant.length < 5) return null;
  const toleran = products.filter(
    (product) =>
      tolerantScannedKey(product.sku) === tolerant ||
      (typeof product.barcode === "string" &&
        product.barcode.trim().length > 0 &&
        tolerantScannedKey(product.barcode) === tolerant),
  );
  return toleran.length === 1 ? toleran[0] : null;
}

/**
 * Benar kalau hasil scan sama **persis** dengan SKU atau barcode produk (setelah
 * spasi/huruf besar-kecil/prefix simbologi dirapikan). Dipakai halaman Kasir
 * untuk memberi tahu kasir ketika produk hanya cocok **kira-kira** — barang tetap
 * tidak ditambahkan sendiri, jadi kasir masih bisa memeriksa nama & harganya.
 */
export function scannedCodeMatchesExactly(
  product: ScannableProduct,
  raw: string,
): boolean {
  const key = scannedCodeKey(raw);
  if (key === "") return false;
  if (scannedCodeKey(product.sku) === key) return true;
  return typeof product.barcode === "string" &&
    product.barcode.trim().length > 0 &&
    scannedCodeKey(product.barcode) === key;
}

function fuzzyScannedKey(raw: string): string {
  return looseScannedKey(raw).replace(
    /[012568]/g,
    (character) => CONFUSABLE_SCAN_CHARS[character] ?? character,
  );
}

/** Jarak edit Levenshtein dengan batas: mahal hanya untuk kode yang mirip. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** Maksimal usulan yang ditampilkan sekali scan. */
export const SCAN_SUGGESTION_LIMIT = 3;

/**
 * Kandidat produk yang **mirip** dengan kode hasil scan, untuk kasir.
 *
 * Dipakai hanya saat kode tidak cocok persis: pemindai murah yang membaca label
 * kecil (atau label di layar) kadang mengirim kode yang mirip tetapi tidak sama
 * — mis. `PB800005` untuk `PBB-0000005`. Tanpa usulan, kasir hanya melihat “belum
 * terdaftar” lalu mendaftarkan produk kembar.
 *
 * Usulan **tidak pernah** langsung masuk keranjang dan tidak mengubah aturan
 * pencocokan persis: kasir melihat nama, SKU, dan harga produknya lalu memutuskan
 * sendiri. Kode yang sangat pendek tidak diberi usulan karena jarak satu huruf
 * sudah terlalu banyak kemungkinan.
 *
 * Perbandingannya: pemisah dibuang, angka yang sering tertukar dengan huruf
 * disamakan (`0`↔`O`, `8`↔`B`, `5`↔`S`, …), lalu jarak editnya dihitung.
 */
export function suggestProductsForScannedCode<T extends ScannableProduct>(
  products: readonly T[],
  raw: string,
  limit: number = SCAN_SUGGESTION_LIMIT,
): T[] {
  const target = fuzzyScannedKey(raw);
  if (target.length < 5) return [];
  const maxDistance = target.length >= 8 ? 2 : 1;

  const scored: { product: T; distance: number }[] = [];
  for (const product of products) {
    let best = maxDistance + 1;
    for (const candidate of [product.sku, product.barcode ?? ""]) {
      const key = fuzzyScannedKey(candidate);
      if (key.length === 0) continue;
      if (Math.abs(key.length - target.length) > maxDistance) continue;
      best = Math.min(best, editDistance(target, key));
    }
    if (best <= maxDistance) scored.push({ product, distance: best });
  }

  scored.sort(
    (a, b) =>
      a.distance - b.distance || a.product.sku.localeCompare(b.product.sku),
  );
  return scored
    .slice(0, Math.max(0, Math.floor(limit)))
    .map((row) => row.product);
}

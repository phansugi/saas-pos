/**
 * SKU otomatis untuk produk.
 *
 * Formatnya `PBB-<nomor urut>` — contoh `PBB-0000042`:
 *
 *  - `PBB`     prefix tetap milik perusahaan (satu tempat untuk mengubahnya),
 *  - `0000042` nomor urut tujuh digit yang **berjalan sekali untuk seluruh tenant**:
 *              satu nomor tidak pernah dipakai dua produk, dan katalog lama yang
 *              SKU-nya diketik sendiri tidak menggeser nomornya.
 *
 * Kategori **tidak** ikut di dalam SKU. Dulu kode kategori tiga huruf diselipkan di
 * tengah (`PBB-SAN-000042`), tetapi itu berarti memindahkan produk ke kategori lain
 * harus mengubah SKU-nya — padahal SKU mungkin sudah tercetak di label. Sekarang
 * SKU hanya berisi nomor urut, jadi mengganti kategori tidak pernah menyentuh SKU.
 *
 * Aturannya murni dan dipakai bersama beberapa tempat, jadi tidak ada dua versi
 * format: tombol **Buat otomatis** di halaman Produk & Stok (mengisi kolom dari
 * daftar produk yang sudah ada, hanya selama kolomnya belum diubah manual), store
 * demo (perilaku yang sama tanpa server), dan `products.create` di server (yang
 * mengikat saat produk dibuat: nomor diberikan lewat counter tenant, lalu
 * diperiksa bentroknya dengan SKU yang sudah ada).
 */

/** Prefix tetap SKU. Ganti di sini kalau kode perusahaan berubah. */
export const PRODUCT_SKU_PREFIX = "PBB";

/** Jumlah digit nomor urut (`0000042`). */
export const PRODUCT_SKU_SEQUENCE_DIGITS = 7;

const SKU_PATTERN = new RegExp(
  `^${PRODUCT_SKU_PREFIX}-(\\d{${PRODUCT_SKU_SEQUENCE_DIGITS},})$`,
);

/**
 * Nomor urut sebagai teks tujuh digit (`42` → `0000042`). Nomor di bawah 1
 * diperlakukan sebagai 1, jadi SKU yang dihasilkan tidak pernah `0000000`.
 */
export function productSkuSequenceText(sequence: number): string {
  const value = Math.max(1, Math.trunc(Number(sequence) || 0));
  return String(value).padStart(PRODUCT_SKU_SEQUENCE_DIGITS, "0");
}

/** Susun SKU lengkap dari nomor urut. */
export function formatProductSku(input: { sequence: number }): string {
  return `${PRODUCT_SKU_PREFIX}-${productSkuSequenceText(input.sequence)}`;
}

/**
 * Nomor urut dari sebuah SKU, atau `null` kalau SKU itu **bukan** buatan sistem
 * (mis. SKU lama yang diketik manual, atau SKU berformat lama
 * `PBB-SAN-000042` yang tetap dipakai apa adanya).
 */
export function parseProductSkuSequence(sku: string): number | null {
  const match = SKU_PATTERN.exec((sku ?? "").trim().toUpperCase());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** Benar kalau SKU-nya mengikuti format `PBB-<nomor urut>`. */
export function isGeneratedProductSku(sku: string): boolean {
  return parseProductSkuSequence(sku) !== null;
}

/**
 * Nomor urut berikutnya = nomor tertinggi yang sudah terpakai + 1, mulai dari 1.
 * SKU di luar format diabaikan, jadi katalog lama tidak menggeser nomornya.
 */
export function nextProductSkuSequence(takenSkus: readonly string[]): number {
  let highest = 0;
  for (const sku of takenSkus) {
    const sequence = parseProductSkuSequence(sku);
    if (sequence !== null && sequence > highest) highest = sequence;
  }
  return highest + 1;
}

/**
 * SKU berikutnya dari daftar SKU yang sudah ada. Inilah yang dipakai tombol
 * **Buat otomatis** dan store demo: nomornya dijamin bebas — walau nomor final
 * dari server bisa berbeda sedikit, karena counter-nya juga terpakai untuk
 * percobaan yang bentrok.
 */
export function suggestProductSku(input: { takenSkus: readonly string[] }): string {
  return formatProductSku({ sequence: nextProductSkuSequence(input.takenSkus) });
}

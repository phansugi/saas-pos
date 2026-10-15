/**
 * SKU otomatis untuk produk.
 *
 * Formatnya `PBB-<KATEGORI>-<nomor urut>` — contoh `PBB-SAN-000042`:
 *
 *  - `PBB`  prefix tetap milik perusahaan (satu tempat untuk mengubahnya),
 *  - `SAN`  kode **tiga huruf** dari nama kategori ("Sanitasi" → `SAN`); produk
 *           tanpa kategori memakai `UMU` (umum), dan nama yang terlalu pendek
 *           diisi `X` supaya kodenya selalu tiga huruf,
 *  - `000042` nomor urut enam digit yang **berjalan sekali untuk seluruh tenant**:
 *           dua kategori berbeda karena itu tidak pernah menerima nomor yang sama,
 *           dan satu nomor tidak pernah dipakai dua produk.
 *
 * Kategori juga menentukan **kode di tengah**, jadi mengganti kategori sebuah
 * produk harus mengubah kodenya: itulah `recodeProductSku` — dipakai saat kategori
 * produk diganti dari halaman Produk & Stok (dan di store demo). Nomornya
 * dipertahankan selama masih bebas; yang **tidak** pernah disentuh adalah SKU yang
 * diketik pemilik toko di luar format ini (mis. `KOPI-01`) — itu miliknya sendiri.
 *
 * Aturannya murni dan dipakai bersama beberapa tempat, jadi tidak ada dua versi
 * format: tombol **Buat SKU otomatis** di halaman Produk & Stok (mengisi kolom
 * dari daftar produk yang sudah ada, dan ikut berubah saat kategori di form
 * diganti), store demo (perilaku yang sama tanpa server), `products.create` di
 * server (yang mengikat saat produk dibuat: nomor diberikan lewat counter tenant,
 * lalu diperiksa bentroknya dengan SKU yang sudah ada), dan `products.setCategory`
 * (kategori produk diganti → kode di SKU ikut berganti lewat `recodeProductSku`).
 */

/** Prefix tetap SKU. Ganti di sini kalau kode perusahaan berubah. */
export const PRODUCT_SKU_PREFIX = "PBB";

/** Panjang kode kategori di dalam SKU. */
export const PRODUCT_SKU_CATEGORY_LENGTH = 3;

/** Jumlah digit nomor urut (`000042`). */
export const PRODUCT_SKU_SEQUENCE_DIGITS = 6;

/** Kode kategori untuk produk tanpa kategori — `UMU` (umum). */
export const PRODUCT_SKU_FALLBACK_CATEGORY = "UMU";

/** Pengisi kalau nama kategorinya lebih pendek dari tiga huruf (`AB` → `ABX`). */
export const PRODUCT_SKU_CATEGORY_PADDING = "X";

const SKU_PATTERN = new RegExp(
  `^${PRODUCT_SKU_PREFIX}-([A-Z0-9]{${PRODUCT_SKU_CATEGORY_LENGTH}})-(\\d{${PRODUCT_SKU_SEQUENCE_DIGITS},})$`,
);

/**
 * Label yang dipakai store & tabel produk untuk “tidak ada kategori”. Kalau nilai
 * ini yang datang, artinya memang tidak ada kategori — bukan kategori bernama itu.
 */
export const PRODUCT_SKU_NO_CATEGORY_LABEL = "TANPAKATEGORI";

/**
 * Kode kategori tiga huruf dari nama kategori: huruf & angka saja, huruf besar,
 * diambil tiga karakter pertama. Tanpa kategori (termasuk label “Tanpa kategori”
 * yang dipakai tabel produk) → `UMU`. Nama yang terlalu pendek diisi `X`.
 */
export function productSkuCategoryCode(category?: string | null): string {
  const cleaned = (category ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length === 0 || cleaned === PRODUCT_SKU_NO_CATEGORY_LABEL) {
    return PRODUCT_SKU_FALLBACK_CATEGORY;
  }
  return cleaned
    .slice(0, PRODUCT_SKU_CATEGORY_LENGTH)
    .padEnd(PRODUCT_SKU_CATEGORY_LENGTH, PRODUCT_SKU_CATEGORY_PADDING);
}

/** Nomor urut sebagai teks enam digit (`42` → `000042`). */
export function productSkuSequenceText(sequence: number): string {
  const value = Math.max(1, Math.trunc(Number(sequence) || 0));
  return String(value).padStart(PRODUCT_SKU_SEQUENCE_DIGITS, "0");
}

/** Susun SKU lengkap dari kategori & nomor urut. */
export function formatProductSku(input: {
  category?: string | null;
  sequence: number;
}): string {
  return `${PRODUCT_SKU_PREFIX}-${productSkuCategoryCode(input.category)}-${productSkuSequenceText(
    input.sequence,
  )}`;
}

/**
 * Nomor urut dari sebuah SKU, atau `null` kalau SKU itu **bukan** buatan sistem
 * (mis. SKU lama yang diketik manual). Dipakai untuk mencari nomor berikutnya dan
 * untuk memeriksa apakah sebuah SKU mengikuti format ini.
 */
export function parseProductSkuSequence(sku: string): number | null {
  const match = SKU_PATTERN.exec((sku ?? "").trim().toUpperCase());
  if (!match) return null;
  const value = Number(match[2]);
  return Number.isFinite(value) ? value : null;
}

/** Benar kalau SKU-nya mengikuti format `PBB-<KATEGORI>-<nomor>`. */
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
 * SKU berikutnya untuk sebuah kategori. Inilah yang dipakai tombol **Buat SKU
 * otomatis** dan store demo: keduanya melihat daftar SKU yang sudah ada, jadi
 * nomornya dijamin bebas — walau nomor final dari server bisa berbeda sedikit,
 * karena counter-nya juga terpakai untuk percobaan yang bentrok.
 */
export function suggestProductSku(input: {
  category?: string | null;
  takenSkus: readonly string[];
}): string {
  return formatProductSku({
    category: input.category,
    sequence: nextProductSkuSequence(input.takenSkus),
  });
}

/**
 * SKU sebuah produk setelah kategorinya diganti — inti permintaan “kalau kategori
 * produk berubah, format SKU-nya ikut”.
 *
 * Aturannya:
 *
 *  - SKU **di luar format** (diketik pemilik toko, mis. `KOPI-01`) dikembalikan apa
 *    adanya. Kode itu miliknya, bukan milik sistem.
 *  - SKU berformat: kode kategorinya diganti, **nomornya dipertahankan** kalau masih
 *    bebas. Contoh `PBB-SAN-000042` + kategori “Makanan” → `PBB-MAK-000042`.
 *  - Kalau nomor itu ternyata sudah dipakai (mis. ada yang mengetik `PBB-MAK-000042`
 *    manual untuk produk lain), nomor berikutnya yang bebas dipakai supaya perubahan
 *    kategori tidak pernah gagal karena bentrok SKU.
 *
 * `takenSkus` adalah SKU produk **lain** — SKU produk yang sedang diubah harus
 * disingkirkan pemanggil, supaya nomornya sendiri tidak dianggap bentrok.
 */
export function recodeProductSku(input: {
  sku: string;
  category?: string | null;
  takenSkus: readonly string[];
}): string {
  const current = (input.sku ?? "").trim();
  const sequence = parseProductSkuSequence(current);
  if (sequence === null) return input.sku;

  const candidate = formatProductSku({ category: input.category, sequence });
  if (!input.takenSkus.includes(candidate)) return candidate;

  return formatProductSku({
    category: input.category,
    sequence: nextProductSkuSequence([...input.takenSkus, candidate]),
  });
}

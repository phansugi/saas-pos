/**
 * Aturan gambar produk.
 *
 * Satu produk boleh punya **maksimal 8 gambar** (`MAX_PRODUCT_IMAGES`), dan tiap
 * berkasnya maksimal 2 MB dengan tipe JPEG/PNG/WebP. Aturannya murni dan dipakai
 * bersama, jadi batasnya sama di tiga tempat:
 *
 *  - halaman Produk & Stok memakainya untuk mematikan tombolnya lebih dulu,
 *  - store demo memakainya untuk menolak di klien,
 *  - `products.addImage` memakainya **lagi** di server — request langsung ke
 *    fungsi Convex tidak bisa melewati batas yang hanya dijaga UI.
 *
 * Gambar **tidak** disimpan sebagai URL melainkan sebagai id berkas
 * (`_storage`): URL bertanda tangan punya masa berlaku, jadi URL yang ditulis ke
 * DB akan menjadi gambar mati setelah kedaluwarsa. URL-nya dibuat saat query
 * dijalankan (lihat `products.listByStore`).
 */

/** Batas jumlah gambar per produk. */
export const MAX_PRODUCT_IMAGES = 8;

/** Batas ukuran satu berkas gambar yang diterima (setelah diperkecil di klien). */
export const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024;

/** Tipe berkas yang diterima. GIF & SVG sengaja tidak: GIF kehilangan animasinya. */
export const PRODUCT_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ProductImageType = (typeof PRODUCT_IMAGE_TYPES)[number];

export interface Result<T> {
  ok: boolean;
  value?: T;
  reason?: string;
}

/** Tipe berkas tanpa parameter (`image/jpeg; charset=…` → `image/jpeg`). */
export function normaliseImageType(contentType?: string | null): string {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}

/** `"3/8"` — dipakai UI supaya angka batasnya tidak ditulis ulang di banyak tempat. */
export function productImageSlots(count: number): string {
  return `${Math.max(0, Math.trunc(count))}/${MAX_PRODUCT_IMAGES}`;
}

/** Sisa slot gambar; 0 berarti produk itu sudah penuh. */
export function remainingProductImageSlots(count: number): number {
  return Math.max(0, MAX_PRODUCT_IMAGES - Math.max(0, Math.trunc(count)));
}

/**
 * Boleh menambah gambar ke-`existingCount + 1`? Pesannya menyebut angka, supaya
 * pengguna tahu harus menghapus salah satu dulu.
 */
export function canAddProductImage(existingCount: number): Result<true> {
  if (!Number.isFinite(existingCount) || existingCount < 0) {
    return { ok: false, reason: "Jumlah gambar produk tidak masuk akal." };
  }
  if (existingCount >= MAX_PRODUCT_IMAGES) {
    return {
      ok: false,
      reason: `Gambar produk maksimal ${MAX_PRODUCT_IMAGES}. Hapus salah satu dulu untuk menambah gambar baru.`,
    };
  }
  return { ok: true, value: true };
}

/**
 * Periksa satu berkas gambar: tipe, ukuran, dan tidak kosong. Dipakai store demo
 * (di klien, sebelum berkas "diunggah") dan server (dari metadata `_storage`).
 */
export function validateProductImage(input: {
  contentType?: string | null;
  size: number;
}): Result<true> {
  const type = normaliseImageType(input.contentType);
  if (!PRODUCT_IMAGE_TYPES.includes(type as ProductImageType)) {
    return {
      ok: false,
      reason: "Gambar harus berformat JPG, PNG, atau WebP.",
    };
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, reason: "Berkas gambar kosong; pilih berkas lain." };
  }
  if (input.size > MAX_PRODUCT_IMAGE_BYTES) {
    return {
      ok: false,
      reason: `Ukuran gambar maksimal ${MAX_PRODUCT_IMAGE_BYTES / (1024 * 1024)} MB per berkas.`,
    };
  }
  return { ok: true, value: true };
}

/** Ringkasan untuk kolom tabel: "Belum ada gambar" atau "3/8 gambar". */
export function describeProductImages(count: number): string {
  const total = Math.max(0, Math.trunc(count));
  if (total === 0) return "Belum ada gambar";
  return `${productImageSlots(total)} gambar`;
}

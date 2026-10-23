/**
 * Entry point sisi aplikasi untuk aturan kategori produk (`category.manage`).
 *
 * Implementasinya ada di `src/convex/lib/categories.ts` supaya halaman Produk &
 * Stok, POS, kedua store, backend, dan harness memakai aturan yang sama persis —
 * termasuk nama terlarang “Tanpa kategori” dan aturan kategori nonaktif (Convex
 * hanya membundel modul di bawah `src/convex`).
 */
export * from "@/convex/lib/categories";

/**
 * Entry point sisi aplikasi untuk aturan SKU otomatis.
 *
 * Implementasinya ada di `src/convex/lib/productSku.ts` supaya halaman Produk &
 * Stok, store demo, store Convex, backend, dan harness memakai format yang sama
 * persis — `PBB-<nomor urut>` (Convex hanya membundel modul di bawah
 * `src/convex`). Kategori tidak ikut di dalam SKU.
 */
export * from "@/convex/lib/productSku";

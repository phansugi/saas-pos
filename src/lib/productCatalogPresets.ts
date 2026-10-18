/**
 * Entry point sisi aplikasi untuk **preset katalog produk** (master kategori &
 * subkategori yang mengikuti kategori bisnis pemilik).
 *
 * Implementasinya ada di `src/convex/lib/productCatalogPresets.ts` supaya halaman
 * dan backend memakai rencana yang sama persis: halaman bisa menghitung sendiri
 * “apa yang belum ada” untuk memberi tahu pemilik sebelum ia menekan tombol,
 * tanpa menebak nama preset di komponen.
 */
export * from "@/convex/lib/productCatalogPresets";

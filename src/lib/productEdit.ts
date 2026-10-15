/**
 * Entry point sisi aplikasi untuk aturan kelola produk yang sudah tersimpan
 * (ubah identitas, aktif/nonaktifkan, hapus).
 *
 * Implementasinya ada di `src/convex/lib/productEdit.ts` supaya halaman Produk &
 * Stok, kedua store (demo & Convex), backend, dan harness memakai aturan yang sama
 * persis — termasuk pagar “produk yang sudah dipakai tidak boleh dihapus” (Convex
 * hanya membundel modul di bawah `src/convex`).
 */
export * from "@/convex/lib/productEdit";

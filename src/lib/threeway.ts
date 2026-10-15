/**
 * Entry point sisi aplikasi untuk aturan pencocokan 3 arah (PO ↔ GRN ↔ tagihan).
 *
 * Implementasinya ada di `src/convex/lib/threeway.ts` supaya halaman Pembelian,
 * kedua store, dan backend memakai aturan yang sama persis (Convex hanya
 * membundel modul di bawah `src/convex`).
 */
export * from "@/convex/lib/threeway";

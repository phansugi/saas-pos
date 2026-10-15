/**
 * App-facing entry point for the table-QR guest flow rules (`@/lib/meja`).
 *
 * Sama seperti `@/lib/fnb` dan `@/lib/payments`: implementasinya ada di
 * `src/convex/lib/` karena Convex hanya membundel modul di dalam direktori
 * fungsi, sementara halaman tamu, halaman kasir, kedua store, dan harness wajib
 * memakai aturan yang sama.
 */
export * from "@/convex/lib/meja";

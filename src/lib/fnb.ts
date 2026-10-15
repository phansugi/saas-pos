/**
 * App-facing entry point for the F&B flow rules (denah meja + antrean dapur).
 *
 * Sama seperti `@/lib/wholesale` dan `@/lib/billing`: implementasinya ada di
 * `src/convex/lib/` karena Convex hanya membundel modul di dalam direktori
 * fungsi, sementara klien dan backend wajib memakai aturan yang sama.
 */
export * from "@/convex/lib/fnb";

/**
 * App-facing entry point for the wholesale receivable rules (piutang B2B).
 *
 * Implementasinya ada di `src/convex/lib/ar.ts` karena Convex hanya membundel
 * modul di dalam direktori fungsi, sementara klien (kasir & halaman Piutang) dan
 * backend wajib memakai satu perhitungan limit yang sama.
 */
export * from "@/convex/lib/ar";

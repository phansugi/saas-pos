/**
 * App-facing entry point for the member & member-discount rules (modul UMKM).
 *
 * Implementasinya ada di `src/convex/lib/loyalty.ts` karena Convex hanya
 * membundel modul di dalam direktori fungsi, sementara kasir dan halaman Member
 * wajib memakai perhitungan diskon yang sama dengan backend.
 */
export * from "@/convex/lib/loyalty";

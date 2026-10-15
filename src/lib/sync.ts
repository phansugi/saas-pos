/**
 * Entry point sisi aplikasi untuk aturan sinkronisasi real-time multi-perangkat
 * (`sync.realtime`, Phase 6).
 *
 * Implementasinya ada di `src/convex/lib/realtimeSync.ts` supaya halaman
 * Sinkronisasi, kedua store, backend, dan harness memakai aturan yang sama
 * persis (Convex hanya membundel modul di bawah `src/convex`).
 */
export * from "@/convex/lib/realtimeSync";

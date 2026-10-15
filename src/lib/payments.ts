/**
 * Entry point sisi aplikasi untuk aturan pembayaran digital (`payment.digital`,
 * Phase 6).
 *
 * Implementasinya ada di `src/convex/lib/digitalPayment.ts` supaya halaman
 * Pembayaran, kedua store, backend, dan harness memakai aturan yang sama persis
 * (Convex hanya membundel modul di bawah `src/convex`).
 */
export * from "@/convex/lib/digitalPayment";

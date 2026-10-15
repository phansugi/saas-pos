/**
 * Entry point sisi aplikasi untuk aturan pesanan masuk API (`POST /api/v1/sales`).
 *
 * Implementasinya ada di `src/convex/lib/apiOrders.ts` supaya halaman API &
 * Webhook, harness, dan backend memakai aturan yang sama persis (Convex hanya
 * membundel modul di bawah `src/convex`).
 */
export * from "@/convex/lib/apiOrders";

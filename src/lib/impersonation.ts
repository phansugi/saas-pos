/**
 * Entry point sisi aplikasi untuk aturan **impersonasi platform**.
 *
 * Implementasinya ada di `src/convex/lib/impersonation.ts` supaya backend, halaman
 * backstage, dan harness memakai aturan yang sama persis (Convex hanya membundel
 * modul di bawah `src/convex`). Aturan itu memuat bentuk alasan, batas waktu sesi,
 * status turunan “kedaluwarsa”, dan penyaring jejak audit milik tenant.
 */
export * from "@/convex/lib/impersonation";

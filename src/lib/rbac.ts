/**
 * Entry point sisi aplikasi untuk aturan peran kustom (`rbac.custom`, Phase 4).
 *
 * Implementasinya ada di `src/convex/lib/rbac.ts` supaya halaman Tim & Peran,
 * kedua store, backend, dan harness memakai aturan yang sama persis (Convex
 * hanya membundel modul di bawah `src/convex`).
 */
export * from "@/convex/lib/rbac";

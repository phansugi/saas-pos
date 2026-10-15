/**
 * App-facing entry point for the item modifier rules (modul F&B, `pos.modifier`).
 *
 * Sama seperti `@/lib/fnb`, `@/lib/wholesale`, dan `@/lib/billing`:
 * implementasinya ada di `src/convex/lib/` karena Convex hanya membundel modul di
 * dalam direktori fungsi, sementara klien dan backend wajib memakai aturan yang
 * sama — harga dan validasi tidak boleh hidup dua kali.
 */
export * from "@/convex/lib/modifiers";

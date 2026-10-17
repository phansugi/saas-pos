/**
 * Entry point sisi aplikasi untuk aturan **pengaturan peran bawaan** per workspace.
 *
 * Implementasinya ada di `src/convex/lib/roleSettings.ts` supaya backend
 * (`roles.setBuiltin`/`removeBuiltin`/`restoreBuiltin`/`resetBuiltin`, dan gate izin
 * lewat `resolveMembershipPermissions`), halaman Tim & Peran, kedua store, sesi
 * klien, dan harness memakai aturan yang sama persis (Convex hanya membundel modul
 * di bawah `src/convex`).
 */
export * from "@/convex/lib/roleSettings";

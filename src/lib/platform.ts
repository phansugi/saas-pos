/**
 * Entry point sisi aplikasi untuk aturan **akun platform**.
 *
 * Implementasinya ada di `src/convex/lib/platform.ts` supaya backend, halaman
 * backstage, dan harness memakai aturan yang sama persis (Convex hanya membundel
 * modul di bawah `src/convex`). Lihat berkas itu untuk alasan modelnya: akun
 * platform **bukan** peran tenant — keanggotaannya hanya boleh lahir dari
 * workspace yang ia dirikan sendiri, dan di tenant orang lain ia tidak muncul di
 * permukaan mana pun.
 */
export * from "@/convex/lib/platform";

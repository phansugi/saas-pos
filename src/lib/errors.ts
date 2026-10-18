/**
 * Entry point sisi aplikasi untuk **kalimat galat** (tenant maupun backstage).
 *
 * Implementasinya ada di `src/convex/lib/errors.ts` supaya backend dan halaman
 * memakai aturan yang sama persis (Convex hanya membundel modul di bawah
 * `src/convex`). Lihat berkas itu untuk alasan modelnya: yang sampai ke layar
 * pengguna harus berupa kalimat, bukan bungkusan `[CONVEX …]` + jejak berkas.
 */
export * from "@/convex/lib/errors";

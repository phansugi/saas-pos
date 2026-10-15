/**
 * Entry point sisi aplikasi untuk aturan profil (pengguna & usaha).
 *
 * Implementasinya ada di `src/convex/lib/profile.ts` supaya halaman Profil, kedua
 * store (demo & Convex), `users.updateProfile` + `tenants.updateProfile` di
 * backend, dan harness memakai aturan yang sama persis — termasuk batas nama,
 * validator email yang sama dengan pengiriman kode OTP, dan normalisasi nomor
 * WhatsApp yang sama dengan undangan tim (Convex hanya membundel modul di bawah
 * `src/convex`).
 */
export * from "@/convex/lib/profile";

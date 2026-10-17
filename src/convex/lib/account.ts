/**
 * Pembatalan pendaftaran akun — aturan murni.
 *
 * MesinPOS tidak punya formulir “daftar” terpisah: akun lahir saat kode OTP email
 * pertama kali terbukti (`otp.verifyCode`), dan di situlah baris `users` untuk
 * email itu dibuat. Kalau calon pengguna berubah pikiran di tengah onboarding,
 * satu-satunya jalan keluar yang jujur adalah **menghapus akun itu lagi** —
 * bukan sekadar keluar, karena dengan begitu emailnya tetap terdaftar dan tidak
 * bisa dipakai mendaftar dari awal.
 *
 * Yang boleh dihapus hanya pendaftaran yang belum menjadi bisnis. Dua pagar:
 *
 *  1. **Sudah punya keanggotaan** → ditolak. Baris `users` bisa menjadi pemilik
 *     workspace beserta seluruh datanya; menghapusnya dari halaman onboarding
 *     akan meninggalkan workspace tanpa pemilik.
 *  2. **Akun platform** (`platformRole`) → ditolak. Penanda itu diberikan lewat
 *     akses deployment dan hanya boleh dicabut dari sana.
 *
 * Penghapusannya sendiri memakai id baris `users` yang diklaim pemanggil dan
 * diverifikasi `verifyActor`, jadi tidak ada jalan menghapus email orang lain.
 * Aturannya tinggal di sini supaya server dan harness membaca kalimat yang sama.
 */

import { isPlatformRole } from "./platform";

/** Akun yang mau dibatalkan sudah tidak ada (mungkin sudah dihapus sebelumnya). */
export const CANCEL_NOT_FOUND_REASON =
  "Akun untuk email ini sudah tidak ada. Silakan masuk lagi dengan email itu kalau ingin memulai dari awal.";

/** Akun sudah menjadi pemilik/anggota sebuah workspace — bukan pendaftaran baru. */
export const CANCEL_HAS_WORKSPACE_REASON =
  "Akun ini sudah punya workspace, jadi pendaftarannya tidak bisa dibatalkan. Kelola workspace-nya dari dashboard, atau hubungi dukungan kalau memang ingin menghapus seluruh datanya.";

/** Akun platform tidak boleh mencabut penandanya lewat halaman pendaftaran. */
export const CANCEL_PLATFORM_REASON =
  "Akun platform tidak bisa dibatalkan dari halaman pendaftaran — penanda pengembangnya hanya bisa dicabut lewat akses deployment.";

export interface CancelRegistrationFacts {
  /** Apakah baris `users` ini sudah menjadi anggota (pemilik atau bukan) sebuah tenant. */
  hasMemberships: boolean;
  /** Penanda akun platform (`users.platformRole`), kalau ada. */
  platformRole?: string | null;
}

/**
 * Alasan penolakan, atau `null` kalau pendaftaran memang boleh dibatalkan.
 *
 * Urutannya disengaja: akun platform ditolak lebih dulu karena penandanya yang
 * membuat penghapusan berbahaya (baris itu dipakai backstage), lalu keanggotaan.
 */
export function cancelRegistrationRefusal(
  facts: CancelRegistrationFacts,
): string | null {
  if (isPlatformRole(facts.platformRole ?? "")) return CANCEL_PLATFORM_REASON;
  if (facts.hasMemberships) return CANCEL_HAS_WORKSPACE_REASON;
  return null;
}

/**
 * Kalimat hasil pembatalan — menyebut email yang benar-benar dihapus.
 *
 * Dipakai jawaban server (dan dibaca halaman sebelum kembali ke beranda), supaya
 * pengguna tahu alamat mana yang dibebaskan, bukan hanya “berhasil”.
 */
export function cancelledRegistrationSentence(email: string): string {
  return `Pendaftaran dengan ${email} dibatalkan: email itu sudah dihapus dan bisa dipakai mendaftar lagi kapan saja.`;
}

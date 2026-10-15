/**
 * Provider OTP email untuk Convex Auth — jalur masuk yang **menghasilkan
 * identitas terverifikasi** (`ctx.auth.getUserIdentity()`).
 *
 * Bedanya dengan jalur masuk biasa (`otp.ts` + `otpEmail.ts`):
 *
 *  - Jalur biasa membuktikan kepemilikan email dan membuat baris `users`, tetapi
 *    **tidak** menerbitkan token untuk Convex; server hanya tahu apa yang
 *    diklaim klien (`actorId`), sehingga gerbang aktor masih boleh longgar
 *    selama `ALLOW_UNVERIFIED_ACTOR`.
 *  - Provider ini memakai mesin Convex Auth: kode dikirim lewat Resend, lalu
 *    sesi + JWT diterbitkan **oleh server**, jadi `ctx.auth.getUserIdentity()`
 *    benar-benar terisi. Itulah yang menuntut gerbang akun platform
 *    (`requirePlatformDeveloper`) dan yang membuat `ALLOW_UNVERIFIED_ACTOR`
 *    bisa dimatikan nanti.
 *
 * Konfigurasinya sengaja memakai kunci & pengirim yang **sama** dengan jalur
 * biasa (`RESEND_API_KEY`, `OTP_EMAIL_FROM`) dan bentuk kode yang sama
 * (`lib/otp.ts`), supaya tidak ada dua kebenaran tentang cara mengirim kode:
 * aturan email, isi pesan, dan panjang kode semuanya datang dari satu tempat.
 *
 * Berkas ini tidak memakai `"use node"`: provider ini dieksekusi di dalam
 * mutation `signIn` Convex Auth, sedangkan berkas `"use node"` tidak bisa
 * dipanggil dari sana. Pengiriman karena itu memakai `fetch` (seperti halnya
 * `otpEmail.ts`, yang memanggil endpoint Resend yang sama).
 */

import { Email } from "@convex-dev/auth/providers/Email";
import {
  AUTH_EMAIL_PROVIDER_ID,
  generateOtpCode,
  normalizeEmail,
  otpEmailContent,
  otpEmailFrom,
  randomSource,
  resolveEmailTransport,
} from "./lib/otp";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Umur kode dalam detik — sama dengan `OTP_TTL_MS` di jalur masuk biasa. */
const CODE_TTL_SECONDS = 10 * 60;

export const authEmailOtp = Email({
  id: AUTH_EMAIL_PROVIDER_ID,
  maxAge: CODE_TTL_SECONDS,

  /**
   * Email dinormalkan di kedua sisi (permintaan kode & verifikasi) supaya
   * `Budi@Toko.id` dan `budi@toko.id` adalah akun yang sama — aturan yang sama
   * dipakai jalur masuk biasa.
   */
  normalizeIdentifier: (identifier: string) => normalizeEmail(identifier),

  /** Kode 6 digit dari aturan yang sama dengan jalur masuk biasa. */
  generateVerificationToken() {
    return Promise.resolve(generateOtpCode(randomSource()));
  },

  /**
   * Mengirim kode lewat Resend.
   *
   * Kegagalan **dilempar**, bukan ditelan: Convex Auth hanya boleh menerbitkan
   * sesi kalau kodenya benar-benar berangkat, jadi pengguna tidak pernah diberi
   * identitas terverifikasi atas email yang tidak pernah sampai.
   */
  async sendVerificationRequest({ identifier, token }) {
    const channel = resolveEmailTransport({
      resendApiKey: process.env.RESEND_API_KEY,
      from: process.env.OTP_EMAIL_FROM,
    });

    if (channel.kind === "unconfigured") {
      throw new Error(channel.reason ?? "Saluran email belum dikonfigurasi.");
    }

    const { subject, text } = otpEmailContent({
      code: token,
      ttlMinutes: Math.round(CODE_TTL_SECONDS / 60),
    });

    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${(process.env.RESEND_API_KEY ?? "").trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: otpEmailFrom(process.env.OTP_EMAIL_FROM),
        to: [normalizeEmail(identifier)],
        subject,
        text,
      }),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      throw new Error(`Resend membalas ${response.status}: ${detail}`);
    }
  },
});

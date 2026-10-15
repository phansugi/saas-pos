/**
 * Konfigurasi provider identitas untuk deployment ini.
 *
 * Berkas ini yang dibaca Convex saat memverifikasi JWT: token yang sampai ke
 * fungsi harus diterbitkan oleh `domain` di bawah, dengan `applicationID` itu di
 * klaim `aud`-nya. Convex Auth menerbitkan tokennya **sendiri** (lihat
 * `auth.ts`), jadi domainnya adalah alamat deployment ini:
 *
 *  - `CONVEX_SITE_URL` disediakan otomatis oleh Convex untuk setiap deployment
 *    (bukan nilai yang perlu disetel tangan), dan itu pula yang dipakai
 *    `@convex-dev/auth` sebagai `iss` token serta alamat dokumen
 *    `/.well-known/openid-configuration` + `/.well-known/jwks.json` yang
 *    disajikan `auth.addHttpRoutes` di `http.ts`.
 *  - `applicationID` harus sama dengan `aud` token — Convex Auth memakai
 *    `"convex"` (`setAudience("convex")`), jadi jangan diganti.
 *
 * Kalau `CONVEX_SITE_URL` kosong, verifikasi token gagal dengan pesan dari
 * Convex; itu memang lebih baik daripada diam-diam menerima token asing.
 */
import type { AuthConfig } from "convex/server";

const siteUrl = process.env.CONVEX_SITE_URL ?? "";

export default {
  providers: [
    {
      domain: siteUrl,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;

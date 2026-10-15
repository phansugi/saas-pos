/**
 * Convex Auth — identitas login yang **diverifikasi server**.
 *
 * Yang disediakan berkas ini:
 *
 *  - `signIn`/`signOut` (fungsi Convex Auth) beserta `auth`, yang dipakai
 *    `http.ts` untuk menyajikan `/.well-known/openid-configuration` dan
 *    `/.well-known/jwks.json`.
 *  - `callbacks.createOrUpdateUser` — **satu-satunya** tempat baris `users`
 *    dibuat/diubah lewat jalur ini.
 *  - `jwt.customClaims` — menambahkan `email` ke token, sehingga identitas yang
 *    dibaca server memuat email walau `sub`-nya berbentuk `id|sesi`.
 *
 * ## Kenapa callback-nya ditulis sendiri
 *
 * Bawaan Convex Auth akan **membuat baris `users` baru** berisi apa saja yang
 * ada di `profile` (untuk OTP email: `email` + penanda verifikasi). Dua masalah
 * dengan itu di sini:
 *
 *  1. Tabel `users` proyek ini menuntut `name`, `email`, dan `createdAt`, jadi
 *     baris buatan library tidak lolos validasi skema.
 *  2. Akun yang **sudah ada** (mis. akun platform dari `platform.grant`) harus
 *     diadopsi, bukan digandakan — `sub` token harus menunjuk baris `users`
 *     yang sama dengan yang dipakai server untuk memeriksa izin. Kalau
 *     digandakan, dua baris dengan email sama akan membuat `.unique()` pada
 *     indeks `users.email` melempar galat.
 *
 * Aturan adopsinya sempit dan disengaja: callback ini **hanya** dipanggil setelah
 * kode email diverifikasi (`type: "verification"`, lihat `verifyCodeAndSignIn`
 * di paket Convex Auth), jadi baris dengan email itu memang milik orang yang
 * memegang kodenya. Karena itu adopsi di sini tidak membuka jalan masuk baru:
 * pemilik email tetap harus bisa membuka kotak masuknya.
 */

import { convexAuth } from "@convex-dev/auth/server";
import type { MutationCtx } from "./_generated/server";
import { authEmailOtp } from "./authEmail";
import { defaultNameFromEmail, normalizeEmail } from "./lib/otp";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [authEmailOtp],

  callbacks: {
    async createOrUpdateUser(ctx, args) {
      /*
        Convex Auth mengetik konteks callback ini sebagai `AnyDataModel`, jadi
        nama tabel & indeks proyek ini tidak dikenali pemeriksa tipe. Cast di
        bawah mengembalikan tipe yang dihasilkan Convex untuk proyek ini, supaya
        nama tabel dan indeksnya tetap diperiksa seperti di berkas lain.
      */
      const db = ctx.db as unknown as MutationCtx["db"];
      const now = Date.now();
      const email =
        typeof args.profile.email === "string" ? normalizeEmail(args.profile.email) : "";

      // 1. Sign-in ke akun yang sudah tertaut di `authAccounts`: cukup lengkapi
      //    penanda verifikasinya.
      if (args.existingUserId) {
        await db.patch(args.existingUserId, { emailVerificationTime: now });
        return args.existingUserId;
      }

      // 2. Adopsi baris yang sudah ada (dibuat jalur masuk biasa atau
      //    `platform.grant`). Dua baris dengan email sama dianggap keadaan yang
      //    tidak terduga — lebih baik gagal jelas daripada menebak.
      if (email) {
        const rows = await db
          .query("users")
          .withIndex("email", (q) => q.eq("email", email))
          .take(2);
        if (rows.length > 1) {
          throw new Error(
            `Ada ${rows.length} baris pengguna untuk email yang sama; gabungkan dulu sebelum masuk.`,
          );
        }
        const existing = rows[0];
        if (existing) {
          await db.patch(existing._id, {
            emailVerificationTime: now,
            emailVerifiedAt: now,
          });
          return existing._id;
        }
      }

      // 3. Pengguna benar-benar baru.
      if (!email) {
        throw new Error("Kode masuk ini tidak memuat email; akun baru tidak bisa dibuat.");
      }
      return await db.insert("users", {
        name: defaultNameFromEmail(email),
        email,
        emailVerificationTime: now,
        emailVerifiedAt: now,
        createdAt: now,
      });
    },
  },

  jwt: {
    /**
     * `sub` token berbentuk `id_pengguna|id_sesi` (lihat `TOKEN_SUB_CLAIM_DIVIDER`
     * di paket Convex Auth), jadi identitas mentahnya tidak memuat email. Klaim
     * email ditambahkan di sini supaya pemetaan identitas di `lib/auth.ts` punya
     * dua jalur: id dari `sub` **dan** email.
     *
     * Yang dikembalikan hanya email milik baris yang menerima sesi itu sendiri —
     * nilainya dibaca dari database saat token dibuat, bukan dari masukan klien.
     */
    customClaims: async (ctx, { userId }) => {
      const user = await ctx.db.get(userId);
      return { email: user?.email };
    },
  },
});

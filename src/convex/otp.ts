/**
 * Masuk **tanpa kata sandi** lewat kode OTP yang dikirim ke email (`otp.auth`).
 *
 * Satu jalur untuk login dan daftar: `requestCode` mengirim kode ke email,
 * `verifyCode` menerimanya, dan akun `users` dibuat **saat kode itu terbukti
 * benar** — bukan sebelum. Jadi tidak ada kata sandi yang perlu dibuat,
 * diingat, atau disimpan, dan tidak ada tab "Masuk"/"Daftar" yang harus dipilih
 * pengguna: yang baru mendaftar, yang lama masuk, jalurnya sama.
 *
 * Aturannya sendiri ada di `lib/otp.ts` (murni, dipakai klien demo & harness);
 * berkas ini hanya menjahit aturan itu ke database:
 *
 *   - kode disimpan **sebagai hash** (`hashOtpCode`), dengan `OTP_PEPPER` opsional,
 *   - satu kode hidup per email lewat jeda kirim ulang, dibaca dari baris yang
 *     sudah ada — bukan dari penghitung terpisah yang bisa basi,
 *   - pengiriman email dijadwalkan sebagai aksi terpisah, sehingga kegagalan
 *     penyedia email tidak membatalkan baris yang sudah tercatat: pengiriman
 *     dicatat apa adanya lewat `deliveredAt` / `deliveryError`.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  checkEmail,
  defaultNameFromEmail,
  evaluateOtpRequest,
  hashOtpCode,
  isTestLoginEnabled,
  normalizeEmail,
  otpExpiresAt,
  otpEmailFrom,
  OTP_CODE_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_HOUR,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  otpResendAt,
  otpStatus,
  randomSource,
  resolveEmailTransport,
  resolveOtpCode,
  verifyOtpCode,
} from "./lib/otp";

const HOUR_MS = 60 * 60 * 1000;

/** Ukuran jendela riwayat yang dibaca untuk aturan kirim ulang. */
const RECENT_LIMIT = OTP_MAX_PER_HOUR * 4;

/** Rahasia tambahan untuk hash kode; kosong berarti hanya email yang mengikat. */
function otpPepper(): string {
  return (process.env.OTP_PEPPER ?? "").trim();
}

/** Saluran pengiriman yang benar-benar terpasang di deployment ini. */
function transport() {
  return resolveEmailTransport({
    resendApiKey: process.env.RESEND_API_KEY,
    from: process.env.OTP_EMAIL_FROM,
  });
}

/**
 * Kesiapan jalur masuk tanpa kata sandi, untuk ditampilkan sebelum pengguna
 * mengetik. Tidak ada rahasia di sini — hanya aturan yang berlaku dan apakah
 * saluran email sudah terpasang, sehingga UI bisa memberi tahu lebih awal
 * daripada membiarkan pengguna menunggu email yang tidak akan datang.
 */
export const status = query({
  args: {},
  handler: async () => {
    const channel = transport();
    return {
      emailConfigured: channel.kind !== "unconfigured",
      reason: channel.reason,
      codeLength: OTP_CODE_LENGTH,
      ttlMinutes: Math.round(OTP_TTL_MS / 60000),
      maxAttempts: OTP_MAX_ATTEMPTS,
      resendCooldownSeconds: Math.round(OTP_RESEND_COOLDOWN_MS / 1000),
      emailFrom: otpEmailFrom(process.env.OTP_EMAIL_FROM),
      /**
       * Apakah deployment ini memasang kode tetap untuk email uji `.test`
       * (`OTP_DEV_CODE`) — lihat `isTestLoginEnabled`. Yang dilaporkan hanya
       * **ada/tidaknya**, bukan nilainya: nilai itu hanya berguna bagi penguji,
       * bukan bagi klien.
       */
      devCodeForTestEmails: isTestLoginEnabled(
        "uji@mesinpos.test",
        process.env.OTP_DEV_CODE,
      ),
    };
  },
});

/**
 * Meminta kode masuk untuk satu email.
 *
 * Mengembalikan hasil, **tidak** melempar, supaya UI bisa menampilkan alasan
 * penolakan apa adanya (`ok: false` + `reason`) tanpa membedakan mana yang
 * kesalahan program dan mana yang memang aturan.
 */
export const requestCode = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const emailCheck = checkEmail(email);
    if (!emailCheck.valid) {
      return { ok: false as const, reason: emailCheck.reason, retryAfterMs: 0 };
    }

    // Saluran email diperiksa **sebelum** kode dibuat. Tanpa itu, pengguna akan
    // diberi tahu "kode terkirim" padahal tidak ada email yang berangkat.
    // Satu pengecualian yang sempit: email uji `.test` saat deployment memasang
    // `OTP_DEV_CODE` — lihat `isTestLoginEnabled` di lib/otp.ts.
    const devCode = process.env.OTP_DEV_CODE;
    const testLogin = isTestLoginEnabled(email, devCode);
    const channel = transport();
    if (channel.kind === "unconfigured" && !testLogin) {
      return { ok: false as const, reason: channel.reason, retryAfterMs: 0 };
    }

    const now = Date.now();
    const recent = await ctx.db
      .query("emailOtps")
      .withIndex("by_email_created", (q) =>
        q.eq("email", email).gte("createdAt", now - HOUR_MS),
      )
      .take(RECENT_LIMIT);

    const decision = evaluateOtpRequest({ now, recent });
    if (!decision.allowed) {
      return {
        ok: false as const,
        reason: decision.reason,
        retryAfterMs: decision.retryAfterMs,
      };
    }

    const code = resolveOtpCode({ email, devCode, random: randomSource() });
    const expiresAt = otpExpiresAt(now);
    const otpId = await ctx.db.insert("emailOtps", {
      email,
      codeHash: hashOtpCode(code, email, otpPepper()),
      createdAt: now,
      expiresAt,
      attempts: 0,
    });

    if (testLogin) {
      // Alamat uji tidak dikirimi email (lihat isTestLoginEnabled); jalurnya
      // dicatat apa adanya supaya barisnya tetap bisa dibedakan dari kode yang
      // benar-benar berangkat lewat penyedia email.
      await ctx.db.patch(otpId, { deliveredAt: now, deliveredVia: "uji" });
    } else {
      // Pengiriman dijadwalkan, bukan dijalankan di sini: mutation tidak boleh
      // menunggu jaringan, dan kegagalan penyedia email tidak boleh membatalkan
      // permintaan kode yang sudah tercatat.
      await ctx.scheduler.runAfter(0, internal.otpEmail.send, {
        otpId,
        email,
        code,
      });
    }

    return {
      ok: true as const,
      email,
      // Id baris ini dikembalikan supaya pemintanya bisa mengikuti keadaan
      // pengirimannya lewat `delivery` — lihat catatan di bawah.
      otpId,
      expiresAt,
      resendAt: otpResendAt(now),
      // "uji" berarti kodenya tidak berangkat lewat email (alamat uji `.test`).
      delivery: testLogin ? ("uji" as const) : ("dijadwalkan" as const),
    };
  },
});

/**
 * Memeriksa kode dan — kalau benar — menyelesaikan masuknya.
 *
 * Akun dibuat di sini (sekali pakai kode): pengguna pertama kali pun tidak perlu
 * mendaftar lebih dulu. `emailVerifiedAt` diisi karena kode hanya bisa tiba di
 * email itu, jadi barisnya memang terbukti milik pemiliknya.
 */
export const verifyCode = mutation({
  args: { email: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const emailCheck = checkEmail(email);
    if (!emailCheck.valid) {
      return {
        ok: false as const,
        reason: emailCheck.reason,
        remainingAttempts: 0,
      };
    }

    const now = Date.now();
    const row = await ctx.db
      .query("emailOtps")
      .withIndex("by_email", (q) => q.eq("email", email))
      .order("desc")
      .first();

    const decision = verifyOtpCode({
      row,
      code: args.code,
      email,
      codeHash: row?.codeHash ?? null,
      now,
      pepper: otpPepper(),
    });

    // Hitungan percobaan disimpan juga saat kodenya salah: tanpa itu, menebak
    // kode tidak pernah dibatasi.
    if (row && decision.attempts !== row.attempts) {
      await ctx.db.patch(row._id, { attempts: decision.attempts });
    }

    if (!decision.ok || !row) {
      return {
        ok: false as const,
        reason: decision.reason ?? "Kode tidak sesuai. Minta kode baru.",
        remainingAttempts: decision.remainingAttempts,
      };
    }

    await ctx.db.patch(row._id, {
      consumedAt: now,
      attempts: decision.attempts,
    });

    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();

    if (existing) {
      if (!existing.emailVerifiedAt) {
        // `emailVerificationTime` adalah nama field yang dibaca Convex Auth saat
        // menautkan akun; diisi bersama `emailVerifiedAt` supaya kedua jalur
        // masuk (kode OTP di sini & Convex Auth) menunjuk baris `users` yang
        // sama, bukan menggandakannya.
        await ctx.db.patch(existing._id, {
          emailVerifiedAt: now,
          emailVerificationTime: now,
        });
      }
      return {
        ok: true as const,
        userId: existing._id,
        email,
        name: existing.name,
        created: false,
        otpStatus: otpStatus({ ...row, consumedAt: now }, now),
      };
    }

    const name = defaultNameFromEmail(email);
    const userId = await ctx.db.insert("users", {
      name,
      email,
      emailVerifiedAt: now,
      // Lihat catatan di atas: nama field yang dipakai Convex Auth untuk
      // penautan akun.
      emailVerificationTime: now,
      createdAt: now,
    });
    return {
      ok: true as const,
      userId,
      email,
      name,
      created: true,
      otpStatus: otpStatus({ ...row, consumedAt: now }, now),
    };
  },
});

/**
 * Keadaan pengiriman satu permintaan kode, dibaca oleh klien yang memintanya.
 *
 * Pengiriman sengaja berjalan sebagai aksi terpisah (lihat `otpEmail.send`),
 * jadi jawaban `requestCode` baru berarti "kode sudah dicatat & kirimnya
 * dijadwalkan" — bukan "email sudah berangkat". Tanpa cara membaca hasil
 * kirimnya, pengguna akan menunggu email yang sudah ditolak penyedia. Query ini
 * penutup celah itu: klien memegang `otpId` dari `requestCode` (id acak, hanya
 * diberikan kepada pemintanya) dan menampilkan kegagalan apa adanya.
 *
 * Yang dibaca hanya **keadaan kirim** — kodenya tidak pernah ikut ke sini.
 */
export const delivery = query({
  args: { otpId: v.id("emailOtps") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.otpId);
    if (!row) return null;
    return {
      deliveredAt: row.deliveredAt ?? null,
      deliveredVia: row.deliveredVia ?? null,
      deliveryError: row.deliveryError ?? null,
    };
  },
});

/** Menandai email kode benar-benar berangkat (dipanggil aksi pengirim). */
export const markDelivered = internalMutation({
  args: { otpId: v.id("emailOtps"), via: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.otpId, {
      deliveredAt: Date.now(),
      deliveredVia: args.via,
      deliveryError: undefined,
    });
  },
});

/** Mencatat kegagalan pengiriman apa adanya — bukan diam-diam dianggap terkirim. */
export const markDeliveryFailed = internalMutation({
  args: { otpId: v.id("emailOtps"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.otpId, {
      deliveryError: args.error.slice(0, 300),
    });
  },
});

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  CANCEL_NOT_FOUND_REASON,
  cancelRegistrationRefusal,
  cancelledRegistrationSentence,
} from "./lib/account";
import { verifyActor } from "./lib/auth";
import {
  applyUserProfileDraft,
  sameUserProfile,
  userProfileOf,
  userProfileSentence,
} from "./lib/profile";

/**
 * Minimal user records. Once Convex Auth is enabled these rows are created by
 * the auth callbacks (ctx.auth.getUserIdentity()); the shape stays the same so
 * the rest of the backend does not change.
 */

export const createOrGet = mutation({
  args: { email: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("Email tidak valid.");

    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (existing) return { userId: existing._id, created: false };

    const userId = await ctx.db.insert("users", {
      name: args.name,
      email,
      createdAt: Date.now(),
    });
    return { userId, created: true };
  },
});

/**
 * Profil pengguna: nama yang tampil di aplikasi dan nomor WhatsApp-nya.
 *
 * Siapa saja boleh mengubah **profilnya sendiri**; syaratnya `verifyActor(ctx,
 * userId)` — sama dengan `get` di bawah. Tidak ada izin peran yang dibutuhkan
 * karena yang diubah adalah identitas orangnya sendiri, bukan data workspace:
 * kasir yang mengubah nomornya tidak boleh perlu persetujuan pemilik toko.
 *
 * Yang **tidak** diubah dari sini adalah email: email adalah identitas masuk
 * (kode OTP dikirim ke sana). Menggantinya berarti mengganti akun, dan jalannya
 * adalah masuk dengan email baru — bukan menambal baris ini dari halaman Profil.
 *
 * Aturannya murni (`lib/profile.ts`): nama 2–60 karakter, nomor WA dinormalkan
 * ke bentuk `wa.me` (`08…` → `62…`), dan kolom kosong berarti `null`.
 *
 * Catatan: perubahan ini tidak menulis jejak audit tenant. `auditLogs` selalu
 * milik satu tenant, sedangkan baris ini milik orangnya (ia bisa menjadi anggota
 * beberapa workspace sekaligus) — mencatatnya di salah satu tenant justru
 * menyesatkan pembaca jejaknya nanti.
 */
export const updateProfile = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await verifyActor(ctx, args.userId);

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("Akun tidak ditemukan.");

    const before = userProfileOf(user);
    const decision = applyUserProfileDraft(before, { name: args.name, phone: args.phone });
    if (!decision.ok) throw new Error(decision.reason);
    const after = decision.value;

    if (sameUserProfile(before, after)) {
      return { changed: false, ...after, sentence: userProfileSentence(after) };
    }

    await ctx.db.patch(args.userId, { name: after.name, phone: after.phone ?? undefined });
    return { changed: true, ...after, sentence: userProfileSentence(after) };
  },
});

/**
 * Membatalkan pendaftaran: **menghapus akun (email) yang baru dipakai mendaftar**.
 *
 * Dipanggil dari tautan “Batalkan” di halaman onboarding, yaitu saat akun baru
 * belum punya workspace. Yang dihapus bukan hanya sesi perangkat, melainkan baris
 * `users` beserta jejak masuknya (`authSessions`, `authRefreshTokens`,
 * `authAccounts`, `authVerificationCodes`) — tanpa itu emailnya tetap “sudah
 * terdaftar” dan tidak bisa dipakai mendaftar dari awal.
 *
 * Pagarnya ada di `lib/account.ts` dan dijalankan **sebelum** apa pun dihapus:
 * akun yang sudah punya keanggotaan (bisa saja barisnya pemilik workspace) dan
 * akun platform ditolak dengan kalimat yang menjelaskan jalan keluarnya. Pemanggil
 * juga harus memegang identitas baris yang sama (`verifyActor`), jadi id orang
 * lain tidak bisa dipakai menghapus akunnya.
 *
 * Baris `emailOtps` sengaja **tidak** ikut dihapus: isinya hash kode masuk yang
 * sudah kedaluwarsa dan dipakai sebagai bukti/batas kirim ulang. Yang diminta
 * pengguna adalah emailnya keluar dari daftar akun, bukan riwayat kode itu.
 */
export const cancelRegistration = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await verifyActor(ctx, args.userId);

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error(CANCEL_NOT_FOUND_REASON);

    // Keanggotaan apa pun — aktif maupun nonaktif — berarti akun ini sudah
    // menjadi bagian sebuah bisnis, jadi pendaftarannya bukan lagi “baru”.
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    const refusal = cancelRegistrationRefusal({
      hasMemberships: membership !== null,
      platformRole: user.platformRole,
    });
    if (refusal) throw new Error(refusal);

    // Sesi & token masuk yang menunjuk baris ini. Dihapus lebih dulu supaya
    // token yang masih hidup tidak menunjuk pengguna yang sudah tidak ada.
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .collect();
    for (const session of sessions) {
      const tokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
        .collect();
      for (const token of tokens) await ctx.db.delete(token._id);
      await ctx.db.delete(session._id);
    }

    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", args.userId))
      .collect();
    for (const account of accounts) {
      const codes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", account._id))
        .collect();
      for (const code of codes) await ctx.db.delete(code._id);
      await ctx.db.delete(account._id);
    }

    await ctx.db.delete(args.userId);
    return {
      deleted: true as const,
      email: user.email,
      sentence: cancelledRegistrationSentence(user.email),
    };
  },
});

/** Own profile only — a user row carries an email address. */
export const get = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await verifyActor(ctx, args.userId);
    return await ctx.db.get(args.userId);
  },
});

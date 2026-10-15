import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
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

/** Own profile only — a user row carries an email address. */
export const get = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await verifyActor(ctx, args.userId);
    return await ctx.db.get(args.userId);
  },
});

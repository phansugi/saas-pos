"use node";

/**
 * Pengiriman **email undangan** ke anggota tim yang baru didaftarkan.
 *
 * Dipisah dari `members.ts` dan ditandai `"use node"` karena hanya bagian ini yang
 * menyentuh jaringan luar dan membaca kunci rahasia deployment (`RESEND_API_KEY`).
 * Mutation `members.add` / `members.resendInvite` hanya **menjadwalkan** aksi ini,
 * jadi keanggotaannya sudah tercatat lebih dulu dan kegagalan penyedia email tidak
 * pernah membatalkan pendaftaran anggota.
 *
 * Yang penting di sini sama seperti jalur kode masuk: kegagalan **dicatat apa
 * adanya** lewat `members.markInviteFailed`, bukan dianggap sukses. Pengundang
 * tidak pernah melihat “undangan terkirim” kalau penyedia email menolaknya.
 *
 * Isi pesannya sengaja tidak memuat rahasia apa pun: jalan masuk aplikasi ini
 * adalah kode OTP ke email, dan kode itu hanya terbit kalau orangnya memintanya
 * sendiri di halaman Masuk. Jadi email undangan cuma memberi tahu siapa yang
 * mengundang, ke workspace mana, sebagai peran apa, dan ke mana harus pergi —
 * kalau salah kirim, tidak ada yang bisa dipakai orang lain dari email itu.
 *
 * Konfigurasi deployment (sama dengan jalur kode masuk):
 *   RESEND_API_KEY  — kunci API Resend (wajib untuk mengirim)
 *   OTP_EMAIL_FROM  — alamat pengirim terverifikasi
 *   SITE_URL        — alamat situs; dipakai membangun tautan halaman Masuk
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { isTestEmail, otpEmailFrom, resolveEmailTransport } from "./lib/otp";
import { inviteEmailContent, inviteLoginUrl } from "./lib/team";
import { roleValidator } from "./schema";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export const send = internalAction({
  args: {
    membershipId: v.id("memberships"),
    email: v.string(),
    name: v.optional(v.string()),
    /**
     * Peran bawaan; kosong kalau anggota itu hanya memakai peran tambahan —
     * peran tambahan berdiri sendiri dan namanya ada di `customRoleName`.
     */
    role: v.optional(roleValidator),
    /** Nama peran kustom anggota ini, kalau ia didaftarkan dengan salah satunya. */
    customRoleName: v.optional(v.string()),
    workspace: v.string(),
    /** Nama pengundang; kosong berarti tidak disebutkan di email. */
    invitedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Alamat uji `.test` tidak dikirimi email — aturan yang sama dengan permintaan
    // kode masuk (`isTestLoginEnabled`): domain itu tidak bisa didaftarkan siapa
    // pun, jadi mengirimnya hanya membuang kuota kirim. Keadaannya tetap dicatat
    // (`uji`) supaya bisa dibedakan dari email yang benar-benar berangkat.
    if (isTestEmail(args.email)) {
      await ctx.runMutation(internal.members.markInviteDelivered, {
        membershipId: args.membershipId,
        via: "uji",
      });
      return { sent: false, reason: "Alamat uji tidak dikirimi email." };
    }

    const channel = resolveEmailTransport({
      resendApiKey: process.env.RESEND_API_KEY,
      from: process.env.OTP_EMAIL_FROM,
    });

    if (channel.kind === "unconfigured") {
      await ctx.runMutation(internal.members.markInviteFailed, {
        membershipId: args.membershipId,
        error: channel.reason ?? "Saluran email belum dikonfigurasi.",
      });
      return { sent: false, reason: channel.reason };
    }

    const { subject, text } = inviteEmailContent({
      workspace: args.workspace,
      email: args.email,
      name: args.name,
      role: args.role ?? null,
      customRoleName: args.customRoleName,
      invitedBy: args.invitedBy,
      loginUrl: inviteLoginUrl(process.env.SITE_URL),
    });

    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${(process.env.RESEND_API_KEY ?? "").trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: otpEmailFrom(process.env.OTP_EMAIL_FROM),
          to: [args.email],
          subject,
          text,
        }),
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 200);
        throw new Error(`Resend membalas ${response.status}: ${detail}`);
      }

      await ctx.runMutation(internal.members.markInviteDelivered, {
        membershipId: args.membershipId,
        via: "resend",
      });
      return { sent: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.members.markInviteFailed, {
        membershipId: args.membershipId,
        error: message,
      });
      return { sent: false, reason: message };
    }
  },
});

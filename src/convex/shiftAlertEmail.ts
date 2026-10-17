"use node";

/**
 * Pengiriman **email pemberitahuan shift** ke pemilik toko.
 *
 * Kenapa ada: `shift.alert` (langganan webhook) hanya sampai ke workspace yang
 * sudah memasang endpoint sendiri. Pemilik toko hampir tidak pernah punya
 * endpoint seperti itu, jadi kabar “kas belum dibuka” / “shift belum ditutup”
 * hanya tercatat di tabelnya sendiri. Email ini yang membuat kabarnya benar-benar
 * sampai ke orangnya — lewat jalur yang sudah ada di deployment ini (Resend,
 * kunci & pengirim yang sama dengan kode masuk dan undangan anggota).
 *
 * Dipisah dari `shiftAlerts.ts` dan ditandai `"use node"` karena hanya bagian ini
 * yang menyentuh jaringan luar dan membaca kunci rahasia deployment. Mutation
 * `shiftAlerts.report` cuma **menjadwalkan** aksi ini, jadi laporannya sudah
 * tercatat lebih dulu dan kegagalan penyedia email tidak pernah membatalkan
 * catatannya — kegagalannya ditulis apa adanya (`markEmailFailed`), bukan
 * dianggap sukses.
 *
 * Konfigurasi deployment (sama dengan jalur kode masuk):
 *   RESEND_API_KEY  — kunci API Resend (wajib untuk mengirim)
 *   OTP_EMAIL_FROM  — alamat pengirim terverifikasi
 *   SITE_URL        — alamat situs; dipakai membangun tautan halaman Shift & Kas
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { isTestEmail, otpEmailFrom, resolveEmailTransport } from "./lib/otp";
import { shiftAlertEmailContent } from "./lib/shift";
import { shiftAlertKindValidator } from "./schema";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Tautan halaman Shift & Kas, atau `null` kalau `SITE_URL` belum diset. */
function shiftPageUrl(siteUrl?: string | null): string | null {
  const base = (siteUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/app/shift`;
}

export const send = internalAction({
  args: {
    alertId: v.id("shiftAlerts"),
    /** Alamat pemilik toko yang dikabari (sudah dinormalkan & unik). */
    recipients: v.array(v.string()),
    workspace: v.string(),
    kind: shiftAlertKindValidator,
    title: v.string(),
    message: v.string(),
    /** Hari kalender lokal perangkat, `YYYY-MM-DD`. */
    day: v.string(),
    /** Jam lokal perangkat saat keadaannya dilaporkan (`08:15`). */
    localClock: v.string(),
    /** Jam operasional yang berlaku (`08:00–22:00`). */
    operatingHours: v.string(),
  },
  handler: async (ctx, args) => {
    // Alamat uji `.test` tidak dikirimi email — aturan yang sama dengan undangan
    // anggota: domain itu tidak bisa didaftarkan siapa pun, jadi mengirimnya hanya
    // membuang kuota kirim. Keadaannya tetap dicatat (`uji`) supaya bisa dibedakan
    // dari email yang benar-benar berangkat.
    const penerima = args.recipients.filter((email) => !isTestEmail(email));
    if (penerima.length === 0) {
      await ctx.runMutation(internal.shiftAlerts.markEmailDelivered, {
        alertId: args.alertId,
        via: "uji",
      });
      return { sent: false, reason: "Alamat uji tidak dikirimi email." };
    }

    const channel = resolveEmailTransport({
      resendApiKey: process.env.RESEND_API_KEY,
      from: process.env.OTP_EMAIL_FROM,
    });

    if (channel.kind === "unconfigured") {
      await ctx.runMutation(internal.shiftAlerts.markEmailFailed, {
        alertId: args.alertId,
        error: channel.reason ?? "Saluran email belum dikonfigurasi.",
      });
      return { sent: false, reason: channel.reason };
    }

    const { subject, text } = shiftAlertEmailContent({
      workspace: args.workspace,
      title: args.title,
      message: args.message,
      day: args.day,
      localClock: args.localClock,
      operatingHours: args.operatingHours,
      shiftUrl: shiftPageUrl(process.env.SITE_URL),
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
          to: penerima,
          subject,
          text,
        }),
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 200);
        throw new Error(`Resend membalas ${response.status}: ${detail}`);
      }

      await ctx.runMutation(internal.shiftAlerts.markEmailDelivered, {
        alertId: args.alertId,
        via: "resend",
        deliveredAt: Date.now(),
      });
      return { sent: true };
    } catch (error) {
      const pesan = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.shiftAlerts.markEmailFailed, {
        alertId: args.alertId,
        error: pesan,
      });
      return { sent: false, reason: pesan };
    }
  },
});

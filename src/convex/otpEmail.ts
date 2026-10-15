"use node";

/**
 * Pengiriman email kode masuk lewat Resend.
 *
 * Dipisah dari `otp.ts` dan ditandai `"use node"` karena inilah satu-satunya
 * bagian yang menyentuh jaringan luar dan membaca kunci rahasia deployment
 * (`RESEND_API_KEY`). Mutation `otp.requestCode` hanya **menjadwalkan** aksi
 * ini, jadi kode sudah tercatat lebih dulu dan kegagalan pengiriman tidak
 * pernah membatalkan permintaan pengguna.
 *
 * Yang penting di sini: kegagalan pengiriman **dicatat apa adanya** lewat
 * `otp.markDeliveryFailed`, bukan dianggap sukses. Pengguna tidak diberi tahu
 * "kode terkirim" kalau penyedia email menolaknya.
 *
 * Konfigurasi deployment:
 *   RESEND_API_KEY  — kunci API Resend (wajib untuk mengirim)
 *   OTP_EMAIL_FROM  — alamat pengirim terverifikasi, mis. "MesinPOS <otp@toko.id>"
 *   OTP_PEPPER      — opsional, rahasia tambahan pada hash kode
 *   OTP_DEV_CODE    — opsional, kode tetap **hanya** untuk email uji `.test`
 */

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { otpEmailContent, otpEmailFrom, resolveEmailTransport } from "./lib/otp";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_DOMAINS_ENDPOINT = "https://api.resend.com/domains";

/** Alamat di dalam `OTP_EMAIL_FROM` (`Nama <alamat@domain>`) → domainnya saja. */
function senderDomainFrom(from: string): string {
  const address = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  return address.split("@")[1] ?? "";
}

interface ResendRecord {
  record?: string;
  type?: string;
  name?: string;
  value?: string;
  priority?: number | null;
  status?: string;
}

interface ResendDomain {
  name?: string;
  status?: string;
  records?: ResendRecord[];
}

export const send = internalAction({
  args: {
    otpId: v.id("emailOtps"),
    email: v.string(),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const channel = resolveEmailTransport({
      resendApiKey: process.env.RESEND_API_KEY,
      from: process.env.OTP_EMAIL_FROM,
    });

    if (channel.kind === "unconfigured") {
      await ctx.runMutation(internal.otp.markDeliveryFailed, {
        otpId: args.otpId,
        error: channel.reason ?? "Saluran email belum dikonfigurasi.",
      });
      return { sent: false, reason: channel.reason };
    }

    const { subject, text } = otpEmailContent({ code: args.code });

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

      await ctx.runMutation(internal.otp.markDelivered, {
        otpId: args.otpId,
        via: "resend",
      });
      return { sent: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.otp.markDeliveryFailed, {
        otpId: args.otpId,
        error: message,
      });
      return { sent: false, reason: message };
    }
  },
});

/**
 * Diagnostik domain pengirim: status tiap domain di akun Resend beserta catatan
 * DNS yang masih diminta. Dipakai saat email kode tidak sampai — penyebab paling
 * sering adalah domain pengirim **belum terverifikasi**, dan Resend menjawab 403
 * tanpa memberi tahu catatan DNS mana yang kurang. Itu hanya bisa dibaca dari
 * akun Resend-nya sendiri, jadi aksinya ada di sini, bukan di klien.
 *
 * Sengaja hanya **membaca**: tidak ada domain yang ditambahkan dan tidak ada
 * rahasia yang ikut ke keluaran — kunci API tidak pernah dikembalikan.
 */
export const domainHealth = internalAction({
  args: {},
  handler: async () => {
    const key = (process.env.RESEND_API_KEY ?? "").trim();
    const from = otpEmailFrom(process.env.OTP_EMAIL_FROM);
    const senderDomain = senderDomainFrom(from);

    if (!key) {
      return {
        senderDomain,
        senderDomainVerified: false,
        domains: [],
        error: "RESEND_API_KEY belum diset di deployment ini.",
      };
    }

    const response = await fetch(RESEND_DOMAINS_ENDPOINT, {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      return {
        senderDomain,
        senderDomainVerified: false,
        domains: [],
        error: `Resend membalas ${response.status}: ${detail}`,
      };
    }

    const body = (await response.json()) as { data?: ResendDomain[] };
    const domains = (body.data ?? []).map((domain) => ({
      name: (domain.name ?? "").toLowerCase(),
      status: domain.status ?? "tidak diketahui",
      records: (domain.records ?? []).map((record) => ({
        type: record.record ?? record.type ?? "?",
        name: record.name ?? "",
        value: record.value ?? "",
        priority: record.priority ?? null,
        status: record.status ?? "tidak diketahui",
      })),
    }));

    return {
      senderDomain,
      senderDomainVerified: domains.some(
        (domain) => domain.name === senderDomain && domain.status === "verified",
      ),
      domains,
      error: null,
    };
  },
});

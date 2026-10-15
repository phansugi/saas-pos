/**
 * Halaman data untuk kirim struk lewat WhatsApp: memeriksa izin kasir, menentukan
 * nomor penerimanya, dan mencatat hasil kirimannya.
 *
 * Dipisah dari `receiptWa.ts` karena modul itu bertanda `"use node"` (ia
 * menyentuh jaringan & kunci rahasia), dan di Convex modul Node **hanya boleh**
 * memuat action. Mutation di sini berjalan di runtime biasa supaya bisa membaca
 * basis data — dan supaya aturan “nomor mana yang dipakai” tetap diputuskan di
 * sini, bukan di klien.
 *
 * Urutan prioritas nomornya: nomor yang **tersimpan di data member** selalu
 * menang; nomor yang **diketik kasir** hanya dipakai untuk member tersebut kalau
 * ia belum punya nomor. Nomor ketikan itu tidak dipercaya apa adanya — ia
 * dinormalkan & divalidasi dengan `normalizePhone` yang sama seperti jalur lain,
 * dan asal nomornya (`member` / `kasir`) ikut dicatat di jejak audit.
 *
 * Struk **pembeli umum** (penjualan tanpa member sama sekali) lewat halaman yang
 * sama ini juga: tidak ada baris member yang bisa dibaca, jadi nomornya **wajib**
 * datang dari kolom nomor di dialog struk — divalidasi dengan aturan yang sama,
 * dan pembelinya ditandai `umum` di jejak audit supaya kasir tidak bisa menyamar
 * sebagai member saat mengirim struk.
 */

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { requirePermission, writeAuditLog } from "./lib/access";
import {
  receiptWhatsappConfig,
  receiptWhatsappRecipient,
  receiptWhatsappSummary,
  type ReceiptWhatsappBuyer,
  type ReceiptWhatsappFailure,
} from "./lib/receiptWhatsapp";

/**
 * Keadaan kanal WhatsApp **di deployment ini** — dibaca dari luar aplikasi.
 *
 * Kenapa ada: kirim struk hanya hidup kalau dua kunci rahasia ada di lingkungan
 * **deployment** (`bunx convex env set …`). Berkas `.env`/`.env.local` di mesin
 * pengembang maupun env hosting **tidak** sampai ke fungsi Convex, jadi workspace
 * yang sudah mengisi kuncinya di tempat yang salah tetap melihat jawaban “kanal
 * WhatsApp belum tersambung” di kasir — dan sampai sekarang satu-satunya cara
 * memeriksanya adalah mencoba mengirim struk sungguhan.
 *
 * Yang dibalikkan hanya **keadaannya**, bukan rahasianya: `configured` dan daftar
 * nama kunci yang belum diisi. Pembacaan ini memakai halaman data yang sama persis
 * dengan kirimannya (`receiptWhatsappConfig`), jadi tidak ada beda antara “kuncinya
 * ada di deployment” dan “kirimannya bisa membacanya”.
 *
 * Bersifat **internal**: tidak ada klien yang bisa memanggilnya, jadi keadaannya
 * tidak pernah terbaca dari peramban pengguna mana pun.
 *
 *   bunx convex run receiptWaData:channelStatus
 *   → {"configured":false,"missing":["WHATSAPP_ACCESS_TOKEN","WHATSAPP_PHONE_NUMBER_ID"]}
 *
 * Setelah kuncinya diisi, jalankan lagi: `configured` harus `true` dan `missing`
 * kosong. Pengiriman sungguhannya sendiri baru benar-benar terbukti setelah satu
 * struk terkirim ke nomor uji.
 */
export const channelStatus = internalQuery({
  args: {},
  handler: async (): Promise<{
    configured: boolean;
    missing: string[];
  }> =>
    receiptWhatsappSummary(
      receiptWhatsappConfig(
        process.env as unknown as Record<string, string | undefined>,
      ),
    ),
});

/** Balasan halaman disiapkan versi server (tanpa tipe dari klien). */
export type ReceiptWaPrepareResult =
  | {
      ok: true;
      phone: string;
      /** Dari mana nomornya diambil; dicatat di jejak audit. */
      source: "member" | "kasir";
      /** Struk member terdaftar atau pembeli umum; dicatat di jejak audit. */
      buyer: ReceiptWhatsappBuyer;
      /** Member penerimanya; kosong untuk struk pembeli umum. */
      memberId?: Id<"members">;
      memberCode?: string;
      memberName?: string;
    }
  | { ok: false; code: ReceiptWhatsappFailure; reason: string };

/**
 * Memeriksa izin kasir dan menentukan nomor WhatsApp penerimanya.
 *
 * Nomor yang **tersimpan di data member** selalu menang. Nomor yang diketik kasir
 * (`args.phone`) hanya dipakai kalau membernya belum punya nomor — mis. member
 * cash yang datanya belum lengkap — dan nomor itu tetap dinormalkan & divalidasi
 * di sini, jadi yang boleh dipakai hanya nomor yang bentuknya benar. Asal
 * nomornya dikembalikan supaya bisa dicatat di jejak audit.
 *
 * Kalau `memberId` tidak dikirim, yang dikirim adalah struk **pembeli umum**: tidak
 * ada member yang bisa dibaca, jadi nomor dari kasir itu bukan lagi cadangan
 * melainkan satu-satunya sumber — dan itu pun wajib lolos validasi yang sama.
 */
export const prepareSend = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    /** Member penerima; kosong = penjualan tanpa member (pembeli umum). */
    memberId: v.optional(v.id("members")),
    /** Nomor yang diketik kasir; hanya dipakai kalau member belum punya nomor. */
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ReceiptWaPrepareResult> => {
    await requirePermission(ctx, args.tenantId, args.actorId, "pos.sell");

    if (!args.memberId) {
      // Pembeli umum: tidak ada data member yang bisa dibaca, jadi nomornya hanya
      // boleh datang dari kolom nomor di dialog struk — dan tetap divalidasi.
      const tujuan = receiptWhatsappRecipient(null, args.phone, "umum");
      if (!tujuan.ok) {
        return { ok: false, code: "no-phone", reason: tujuan.reason };
      }
      return {
        ok: true,
        phone: tujuan.phone,
        source: tujuan.source,
        buyer: "umum",
      };
    }

    const member = await ctx.db.get(args.memberId);
    if (!member || member.tenantId !== args.tenantId) {
      return {
        ok: false,
        code: "no-member",
        reason: "Member penerima struk tidak ditemukan untuk workspace ini.",
      };
    }

    // Aturan “nomor mana yang dipakai” ada di fungsi murni yang dipakai bersama
    // mode demo — di sini cuma ditambahkan nama membernya untuk pesannya.
    const tujuan = receiptWhatsappRecipient(member.phone, args.phone, "member");
    if (!tujuan.ok) {
      return {
        ok: false,
        code: "no-phone",
        reason: `Member ${member.name} belum punya nomor WhatsApp. Isi nomornya di kolom “Nomor WhatsApp” pada dialog struk, atau lengkapi di halaman Member, lalu kirim ulang.`,
      };
    }

    return {
      ok: true,
      phone: tujuan.phone,
      source: tujuan.source,
      buyer: "member",
      memberId: member._id,
      memberCode: member.code,
      memberName: member.name,
    };
  },
});

/**
 * Mencatat hasil kiriman ke log audit.
 *
 * Entitasnya member penerimanya, atau nota penjualannya kalau struk itu milik
 * pembeli umum. Nomornya disimpan **tersensor** (`6281•••••890`): yang perlu ditelusuri nanti
 * adalah “struk member siapa dikirim ke nomor mana”, dan nomor penuh tidak
 * menambah apa pun untuk keperluan itu — sedangkan log audit dibaca lebih banyak
 * peran daripada data membernya sendiri.
 */
export const finishSend = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    /** Member penerima; kosong = penjualan tanpa member (pembeli umum). */
    memberId: v.optional(v.id("members")),
    memberCode: v.optional(v.string()),
    /** Nomor nota penjualannya; rujukan jejak audit untuk struk pembeli umum. */
    saleNumber: v.optional(v.string()),
    /** Nomor tersensor, mis. `6281•••••890`. */
    to: v.optional(v.string()),
    /** Asal nomornya: dari data member atau diketik kasir. */
    source: v.optional(v.union(v.literal("member"), v.literal("kasir"))),
    /** Struk member terdaftar atau pembeli umum. */
    buyer: v.optional(v.union(v.literal("member"), v.literal("umum"))),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
    reason: v.optional(v.string()),
    filename: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ recorded: true }> => {
    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "receipt.whatsapp",
      /*
        Jejaknya menempel pada membernya kalau ada; untuk pembeli umum — yang
        memang tidak punya baris member — pada **nota penjualannya**, supaya
        pertanyaan “struk tanpa member yang mana dikirim ke nomor siapa” tetap
        bisa dijawab dari log tanpa menebak dari jamnya.
      */
      entity: args.memberId ? "members" : "sales",
      entityId: args.memberId ? String(args.memberId) : args.saleNumber,
      meta: {
        code: args.memberCode,
        to: args.to,
        source: args.source,
        buyer: args.buyer,
        saleNumber: args.saleNumber,
        status: args.status,
        reason: args.reason,
        filename: args.filename,
        channel: "whatsapp-cloud",
      },
    });
    return { recorded: true as const };
  },
});

"use node";

/**
 * Mengirim **gambar struk** ke WhatsApp pembeli: member terdaftar maupun pembeli umum.
 *
 * Kenapa ada: kasir sudah bisa mencetak struk, mengunduh PDF-nya, dan membagikannya
 * lewat lembar bagikan perangkat. Aksi ini yang mengirimnya **dari server** untuk
 * pembeli yang meninggalkan meja — atas permintaan pemilik toko, yang dikirim adalah
 * **gambar struknya saja** (PNG berlogo yang sama dengan tombol *Bagikan gambar
 * struk*), bukan berkas PDF.
 *
 * Alasannya sesederhana yang dialami pemakainya: pesan **gambar** tampil langsung di
 * percakapan berikut logo tokonya, sedangkan berkas PDF menuntut penerimanya membuka
 * lampiran dulu — dan di Android pasangan berkas yang campurannya berbeda tipe tidak
 * selalu sampai utuh. PDF struknya sendiri tidak hilang: ia tetap bisa **diunduh**
 * dari dialog struk (`Unduh PDF`), dan bentuk pesan dokumennya tetap ada di modul
 * murni `lib/receiptWhatsapp.ts` (teruji) kalau suatu saat workspace mau
 * mengirimkannya lagi.
 *
 * Nomor penerimanya diutamakan dari data member. Untuk member yang belum
 * melengkapi profilnya — mis. member cash yang didaftarkan cepat di kasir — kasir
 * boleh mengisi nomor WA-nya di dialog struk, dan nomor itu dipakai sebagai
 * cadangan; nomor itu tetap divalidasi di sini (bukan dipercaya apa adanya) dan
 * pengirimannya tetap dicatat, sehingga pemilik toko bisa menelusuri ke nomor
 * siapa struknya pergi.
 *
 * **Struk pembeli umum** (penjualan tanpa member sama sekali) lewat aksi yang sama:
 * `memberId` cukup dikosongkan, dan nomor yang diketik kasir menjadi satu-satunya
 * tujuan — tetap divalidasi, dan kirimannya dicatat menempel pada nota penjualannya
 * supaya bukan menjadi jalur tanpa jejak.
 *
 * Dipisah dan ditandai `"use node"` karena inilah satu-satunya bagian yang
 * menyentuh jaringan luar dan membaca kunci rahasia deployment
 * (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`). Aturan *apa* yang dikirim
 * ada di `lib/receiptWhatsapp.ts` (murni, teruji tanpa jaringan); pemeriksaan izin
 * & pencatatan hasilnya ada di `receiptWaData.ts` (runtime biasa, boleh membaca
 * basis data); berkas ini hanya menyambungkannya ke `fetch`.
 *
 * Urutannya dua langkah, sama seperti WhatsApp Cloud API menuntutnya:
 *
 *   1. **unggah gambarnya** ke `/{phone-number-id}/media` → dapat `media_id`;
 *   2. **kirim pesan gambar** ke `/{phone-number-id}/messages` dengan id itu,
 *      berikut keterangan yang sama dengan jalur `wa.me` (isi struknya).
 *
 * Gambarnya diunggah langsung ke WhatsApp, jadi tidak ada server berkas publik yang
 * perlu diadakan hanya untuk satu struk.
 *
 * Yang tidak dilakukan: mengklaim terkirim kalau tidak. Baik unggahan maupun
 * pesannya harus membawa id dari WhatsApp; selain itu hasilnya dilaporkan gagal
 * beserta alasan yang dikembalikan WhatsApp — dan kegagalannya tetap dicatat di
 * log audit supaya pemilik toko bisa menelusurinya.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import {
  maskPhone,
  RECEIPT_WA_CAPTION_MAX,
  RECEIPT_WA_IMAGE_MAX_BYTES,
  receiptWhatsappConfig,
  receiptWhatsappFilename,
  receiptWhatsappImageMessageRequest,
  receiptWhatsappMediaOutcome,
  receiptWhatsappMediaRequest,
  receiptWhatsappMessageOutcome,
  type ReceiptWhatsappSendResult,
} from "./lib/receiptWhatsapp";

/** Membaca badan balasan sebagai JSON tanpa menjatuhkan aksinya. */
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Mengirim gambar struk ke WhatsApp pembeli. Balasannya selalu berbentuk hasil,
 * bukan lemparan: kasir perlu melihat **alasannya** (nomor tujuan yang belum ada,
 * kanal belum tersambung, atau penolakan WhatsApp) untuk bisa memperbaikinya.
 */
export const send = action({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    /** Member penerima; kosong = penjualan tanpa member sama sekali (pembeli umum). */
    memberId: v.optional(v.id("members")),
    /** Nomor nota penjualannya; rujukan jejak audit untuk struk pembeli umum. */
    saleNumber: v.optional(v.string()),
    /** Nama berkas gambarnya, mis. `struk-A-00042.png` (dipakai di unggahan & audit). */
    filename: v.string(),
    /** Isi pesan yang menemani gambarnya (keterangan pesan gambar). */
    caption: v.string(),
    /**
     * Gambar struk (PNG berlogo yang digambar di perangkat kasir) dalam base64
     * **tanpa** awalan data URL. Wajib: gambarnya satu-satunya isi pesan ini.
     */
    imageBase64: v.string(),
    /**
     * Nomor WA yang diketik kasir, dipakai **hanya** kalau membernya belum
     * punya nomor tersimpan — dan tetap divalidasi di `prepareSend`. Untuk struk
     * pembeli umum justru inilah satu-satunya sumber nomornya.
     */
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ReceiptWhatsappSendResult> => {
    const siap = await ctx.runMutation(internal.receiptWaData.prepareSend, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      memberId: args.memberId,
      phone: args.phone,
    });
    if (!siap.ok) {
      return { ok: false, code: siap.code, reason: siap.reason };
    }

    const catat = async (status: "sent" | "failed" | "skipped", reason?: string) => {
      await ctx.runMutation(internal.receiptWaData.finishSend, {
        tenantId: args.tenantId,
        actorId: args.actorId,
        memberId: siap.memberId,
        memberCode: siap.memberCode,
        saleNumber: args.saleNumber,
        buyer: siap.buyer,
        to: maskPhone(siap.phone),
        source: siap.source,
        status,
        reason,
        filename: args.filename,
      });
    };

    const config = receiptWhatsappConfig(
      process.env as unknown as Record<string, string | undefined>,
    );
    if (!config.configured) {
      const reason =
        "Kanal WhatsApp belum tersambung di server: kunci " +
        `${config.missing.join(" & ")} belum diisi. Struknya masih bisa diunduh sebagai PDF.`;
      await catat("skipped", reason);
      return {
        ok: false,
        code: "not-configured",
        reason,
        missing: config.missing,
      };
    }

    const bytes = new Uint8Array(Buffer.from(args.imageBase64, "base64"));
    if (bytes.length === 0 || bytes.length > RECEIPT_WA_IMAGE_MAX_BYTES) {
      const reason = `Gambar struk berukuran ${bytes.length} byte; yang bisa dikirim hanya gambar struk dari perangkat kasir (maksimal ${RECEIPT_WA_IMAGE_MAX_BYTES} byte).`;
      await catat("failed", reason);
      return { ok: false, code: "failed", reason };
    }

    const filename = receiptWhatsappFilename(args.filename, "gambar-struk.png");
    const upload = receiptWhatsappMediaRequest({
      config,
      bytes,
      filename,
      kind: "image",
      mimeType: "image/png",
      // Pemisah multipart harus unik per kiriman; yang diacak di sini, sedangkan
      // bentuk badannya tetap dari modul murni yang teruji.
      boundary: `----MesinPOS${crypto.randomUUID().replace(/-/g, "")}`,
    });

    let mediaOutcome;
    try {
      const response = await fetch(upload.url, {
        method: upload.method,
        headers: upload.headers,
        // Badan multipart berisi byte gambar; `BodyInit` DOM menuntut buffer yang
        // konkret, sedangkan di sini yang dipegang `Uint8Array` biasa.
        body: upload.body as unknown as BodyInit,
      });
      mediaOutcome = receiptWhatsappMediaOutcome(
        response.status,
        await readJson(response),
      );
    } catch (error) {
      mediaOutcome = {
        ok: false as const,
        reason: `Gagal menghubungi WhatsApp: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    if (!mediaOutcome.ok) {
      await catat("failed", mediaOutcome.reason);
      return { ok: false, code: "failed", reason: mediaOutcome.reason };
    }

    const message = receiptWhatsappImageMessageRequest({
      config,
      to: siap.phone,
      mediaId: mediaOutcome.mediaId,
      filename,
      caption: args.caption.slice(0, RECEIPT_WA_CAPTION_MAX),
    });

    let messageOutcome;
    try {
      const response = await fetch(message.url, {
        method: message.method,
        headers: message.headers,
        body: message.body,
      });
      messageOutcome = receiptWhatsappMessageOutcome(
        response.status,
        await readJson(response),
      );
    } catch (error) {
      messageOutcome = {
        ok: false as const,
        reason: `Gagal menghubungi WhatsApp: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    if (!messageOutcome.ok) {
      await catat("failed", messageOutcome.reason);
      return { ok: false, code: "failed", reason: messageOutcome.reason };
    }

    await catat("sent");
    return {
      ok: true,
      to: maskPhone(siap.phone),
      messageId: messageOutcome.messageId,
    };
  },
});

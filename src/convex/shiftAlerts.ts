/**
 * Pemberitahuan shift ke **pemilik toko** — sisi server.
 *
 * Kenapa ada: kas yang belum dibuka padahal toko sudah buka, dan shift yang belum
 * ditutup padahal toko sudah tutup, cuma kelihatan di perangkat kasirnya sendiri.
 * Pemilik toko sering tidak sedang di depan kas itu, jadi keadaannya harus
 * **dikabarkan** — bukan sekadar ditampilkan.
 *
 * Siapa memutuskan apa, sengaja dipisah begini:
 *
 * 1. **Perangkat** tahu keadaan shiftnya (`mesinpos.shifts.v1`) dan melaporkan
 *    keadaan itu beserta **jam lokalnya** (`localHour`/`localMinute`/`dayKey`).
 *    Shift di aplikasi ini memang hidup di perangkat supaya kasir tetap bisa
 *    bekerja saat internetnya putus; server tidak bisa menanyakan shift yang
 *    tidak pernah dilihatnya.
 * 2. **Server** memutuskan ulang dengan aturan murni `lib/shift.ts`
 *    (`shiftOwnerAlert`), memakai jam lokal yang dilaporkan itu. Karena itu
 *    laporan yang tidak cocok dengan keadaannya ditolak, bukan diteruskan: laporan
 *    “kas belum dibuka” yang datang di luar jam operasional — atau jenis yang
 *    tidak sesuai keadaan shift yang dilaporkan — tidak akan pernah menjadi
 *    pemberitahuan palsu di sisi pemilik.
 * 3. **Sekali per hari per jenis.** Kunci `(tenantId, kind, dayKey)` dijaga
 *    indeks `by_tenant_kind_day`, jadi kasir yang membuka halaman Kasir berulang
 *    kali tidak mengirim kabar yang sama berkali-kali. Pemberitahuan yang
 *    berulang tanpa kabar baru hanya membuat pemiliknya berhenti membacanya.
 *
 * Kirimannya sendiri tidak dikirim di dalam transaksi laporan: yang menyerahkan
 * ke pekerja percobaan ulang adalah `enqueueWebhookEvent` +
 * `scheduleWebhookDeliveryPass` (`lib/webhookOutbox.ts`), sama seperti
 * `payable.due` dan `receivable.overdue`. Kalau workspace itu tidak punya endpoint
 * webhook yang melanggan `shift.alert`, laporannya tetap tercatat — dan halaman
 * Shift & Kas mengatakannya apa adanya (`notifiedEndpoints === 0`), bukan
 * mengklaim sudah terkirim.
 *
 * **Jalur utamanya email, bukan webhook.** Langganan webhook hanya ada di
 * workspace yang memasangnya sendiri, sedangkan yang dituju kabar ini adalah
 * pemilik toko — hampir selalu orang yang tidak punya endpoint apa pun. Karena itu
 * setiap laporan juga dijadwalkan sebagai **email** ke pemilik workspace
 * (`tenants.ownerId` + anggota berperan `owner`), lewat aksi terpisah
 * `shiftAlertEmail.send`. Hasilnya disimpan di baris yang sama
 * (`emailRecipients`/`emailVia`/`emailDeliveredAt`/`emailError`), jadi “sudah
 * dikabari” bisa diperiksa ulang di halaman Shift & Kas — termasuk saat emailnya
 * gagal atau alamatnya alamat uji.
 *
 * Izinnya `shift.manage` — sama persis dengan rute `/app/shift`: yang melaporkan
 * adalah perangkat yang memegang kasnya, sedangkan yang membacanya
 * pemilik/manajer/kasir di halaman yang sama. Kabar kas memang urusan kas, bukan
 * urusan menjual: peran yang hanya mengawasi kas bisa memegangnya tanpa harus
 * bisa menjual.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getTenantOrThrow, requirePermission, writeAuditLog } from "./lib/access";
import {
  isShiftDayKey,
  shiftAlertOwnerRecipients,
  shiftAlertReportNotice,
  shiftClockText,
  shiftOperatingLabel,
  shiftOwnerAlert,
  shiftSettingOf,
  type ShiftLocalClock,
  type ShiftSetting,
} from "./lib/shift";
import { resolveEmailTransport } from "./lib/otp";
import { shiftAlertKindValidator } from "./schema";
import { shiftAlertEventData } from "./lib/webhookEvents";
import { enqueueWebhookEvent, scheduleWebhookDeliveryPass } from "./lib/webhookOutbox";

/** Batas kabar yang bisa dibaca satu halaman Shift & Kas. */
export const SHIFT_ALERT_LIMIT_DEFAULT = 10;
export const SHIFT_ALERT_LIMIT_MAX = 50;

const clockValidator = v.object({
  /** Jam lokal perangkat (0..23) — acuan jam operasional. */
  hour: v.number(),
  minute: v.number(),
  /** Hari kalender lokal perangkat, `YYYY-MM-DD`. */
  dayKey: v.string(),
});

/**
 * Melaporkan keadaan kas dari perangkat kasir dan — kalau memang perlu — mengirim
 * kabarnya ke pemilik toko.
 *
 * Yang dikembalikan selalu alasan yang bisa dibaca kasir, baik saat kabarnya
 * benar-benar terkirim (`recorded: true`) maupun saat tidak ada yang perlu
 * dikabarkan: saklarnya mati, keadaannya sudah tidak berlaku, atau hari itu sudah
 * pernah diberitahukan. Diam-diam tidak mengirim sambil mengaku berhasil justru
 * membuat kasir (dan pemilik) tidak tahu apa yang sebenarnya terjadi.
 */
export const report = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    storeId: v.optional(v.id("stores")),
    /** Jenis yang **diklaim** perangkat; diperiksa ulang terhadap keadaannya. */
    kind: shiftAlertKindValidator,
    clock: clockValidator,
    /** Waktu buka shift yang masih terbuka; kosong = tidak ada shift. */
    openedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "shift.manage");

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    const setting: ShiftSetting = shiftSettingOf(tenant.shift);
    const clock: ShiftLocalClock = {
      hour: args.clock.hour,
      minute: args.clock.minute,
      dayKey: args.clock.dayKey,
    };

    /** Bentuk balikan yang sama untuk semua jalan — supaya pemanggilnya tidak menebak. */
    const kosong = (notice: string) => ({
      recorded: false as const,
      duplicate: false,
      alertId: null,
      kind: null,
      reason: null,
      dayKey: null as string | null,
      notifiedEndpoints: 0,
      emailRecipients: [] as string[],
      notice,
    });

    if (!setting.notifyOwner) {
      return kosong(
        "Pemberitahuan ke pemilik toko dimatikan di halaman Pengaturan, jadi tidak ada kabar yang dikirim.",
      );
    }
    if (!isShiftDayKey(clock.dayKey)) {
      throw new Error("Hari laporan shift tidak terbaca (harus berbentuk YYYY-MM-DD).");
    }

    const openedAt =
      typeof args.openedAt === "number" && Number.isFinite(args.openedAt) && args.openedAt > 0
        ? args.openedAt
        : null;
    const alert = shiftOwnerAlert({
      current: openedAt ? { openedAt } : null,
      setting,
      clock,
    });

    if (!alert) {
      return kosong(
        "Keadaan kas ini tidak (lagi) perlu diberitahukan ke pemilik toko menurut jam operasional workspace.",
      );
    }
    if (alert.kind !== args.kind) {
      throw new Error(
        `Laporan “${args.kind}” tidak cocok dengan keadaan kas saat ini (yang berlaku: ${alert.kind}).`,
      );
    }

    const sudahAda = await ctx.db
      .query("shiftAlerts")
      .withIndex("by_tenant_kind_day", (q) =>
        q.eq("tenantId", args.tenantId).eq("kind", alert.kind).eq("dayKey", alert.dayKey),
      )
      .first();

    if (sudahAda) {
      return {
        ...kosong(
          `Pemilik toko sudah diberitahukan soal ini hari ini (pukul ${sudahAda.localClock}), jadi tidak ada kabar kedua.`,
        ),
        duplicate: true,
        alertId: sudahAda._id as string,
        kind: sudahAda.kind,
        dayKey: sudahAda.dayKey,
        notifiedEndpoints: sudahAda.notifiedEndpoints,
        emailRecipients: sudahAda.emailRecipients ?? [],
      };
    }

    const reportedAt = Date.now();
    const notifiedEndpoints = await enqueueWebhookEvent(ctx, {
      tenantId: args.tenantId,
      storeId: args.storeId,
      event: "shift.alert",
      subject: `${alert.kind}:${alert.dayKey}`,
      at: reportedAt,
      data: shiftAlertEventData({
        kind: alert.kind,
        reason: alert.reason,
        day: alert.dayKey,
        localClock: shiftClockText(clock),
        title: alert.title,
        message: alert.message,
        shiftOpenedAt: openedAt,
        operatingHours: shiftOperatingLabel(setting),
      }),
    });

    /*
      Siapa yang dikabari: **pemilik toko**-nya, bukan pemasang webhook. Webhook
      hanya sampai ke workspace yang sudah punya endpoint sendiri, sedangkan yang
      dituju kabar ini adalah orang yang memutuskan jam buka tokonya — hampir
      selalu tanpa endpoint apa pun. Karena itu alamat email pemiliknya (`ownerId`
      + anggota berperan `owner`) dihitung di sini, dan pengirimannya diserahkan
      ke aksi terpisah; laporannya sendiri sudah tercatat sebelum emailnya
      berangkat.
    */
    const recipients = await ownerRecipients(ctx, args.tenantId, tenant.ownerId);
    const emailChannel = resolveEmailTransport({
      resendApiKey: process.env.RESEND_API_KEY,
      from: process.env.OTP_EMAIL_FROM,
    });

    const alertId = await ctx.db.insert("shiftAlerts", {
      tenantId: args.tenantId,
      storeId: args.storeId,
      reportedBy: args.actorId,
      kind: alert.kind,
      reason: alert.reason,
      dayKey: alert.dayKey,
      title: alert.title,
      message: alert.message,
      openedAt: openedAt ?? undefined,
      localClock: shiftClockText(clock),
      notifiedEndpoints,
      emailRecipients: recipients.all,
      reportedAt,
    });

    if (recipients.all.length > 0) {
      await ctx.scheduler.runAfter(0, internal.shiftAlertEmail.send, {
        alertId,
        recipients: recipients.all,
        workspace: tenant.name,
        kind: alert.kind,
        title: alert.title,
        message: alert.message,
        day: alert.dayKey,
        localClock: shiftClockText(clock),
        operatingHours: shiftOperatingLabel(setting),
      });
    }

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "shift.alert",
      entity: "shiftAlerts",
      entityId: alertId,
      meta: {
        kind: alert.kind,
        reason: alert.reason,
        dayKey: alert.dayKey,
        notifiedEndpoints,
        emailRecipients: recipients.all,
      },
    });

    await scheduleWebhookDeliveryPass(ctx, notifiedEndpoints);

    return {
      recorded: true as const,
      duplicate: false,
      alertId: alertId as string,
      kind: alert.kind,
      reason: alert.reason,
      dayKey: alert.dayKey,
      notifiedEndpoints,
      emailRecipients: recipients.all,
      notice: shiftAlertReportNotice({
        title: alert.title,
        recipients,
        emailChannel,
        notifiedEndpoints,
      }),
    };
  },
});

/**
 * Kabar yang sudah pernah dikirim ke pemilik toko, terbaru dulu — dibaca halaman
 * Shift & Kas supaya “sudah diberi tahu” bukan klaim di layar kasir saja, tetapi
 * bisa diperiksa ulang (termasuk apakah workspace ini punya pelanggan webhooknya).
 */
export const list = query({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "shift.manage");

    const limit = Math.max(
      1,
      Math.min(
        SHIFT_ALERT_LIMIT_MAX,
        Math.floor(args.limit ?? SHIFT_ALERT_LIMIT_DEFAULT) || SHIFT_ALERT_LIMIT_DEFAULT,
      ),
    );

    const rows = await ctx.db
      .query("shiftAlerts")
      .withIndex("by_tenant_reported", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(limit);

    return rows.map((row) => ({
      id: row._id as string,
      kind: row.kind,
      reason: row.reason,
      dayKey: row.dayKey,
      title: row.title,
      message: row.message,
      localClock: row.localClock,
      openedAt: row.openedAt ?? null,
      notifiedEndpoints: row.notifiedEndpoints,
      emailRecipients: row.emailRecipients ?? [],
      emailVia: row.emailVia ?? null,
      emailDeliveredAt: row.emailDeliveredAt ?? null,
      emailError: row.emailError ?? null,
      reportedAt: row.reportedAt,
      resolvedAt: row.resolvedAt ?? null,
    }));
  },
});

/**
 * Pemilik toko yang bisa dikabari lewat email: pemilik tenant (`tenants.ownerId`)
 * beserta setiap anggota aktif yang berperan `owner`. Peran `owner` diambil dari
 * baris keanggotaan, bukan dari penanda lain, karena itulah yang menentukan siapa
 * pemilik workspace ini di seluruh aplikasi.
 */
async function ownerRecipients(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  ownerId: Id<"users">,
) {
  const pemilik = await ctx.db.get(ownerId);
  const anggota = await ctx.db
    .query("memberships")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();

  const barisPemilik = anggota.filter((row) => row.role === "owner" && row.active !== false);
  const lain = await Promise.all(
    barisPemilik.map(async (row) => {
      const user = await ctx.db.get(row.userId);
      return { email: user?.email ?? null, role: row.role, active: row.active };
    }),
  );

  return shiftAlertOwnerRecipients({ ownerEmail: pemilik?.email ?? null, members: lain });
}

/**
 * Email ke pemilik toko **sudah berangkat** (atau alamatnya alamat uji, yang
 * memang tidak dikirimi email). Dipanggil aksi pengirimnya, bukan oleh halaman —
 * jadi kartu Shift & Kas membaca hasil yang sebenarnya, bukan tebakan.
 */
export const markEmailDelivered = internalMutation({
  args: {
    alertId: v.id("shiftAlerts"),
    via: v.string(),
    /** Diisi hanya kalau emailnya benar-benar berangkat. */
    deliveredAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.alertId, {
      emailVia: args.via,
      emailDeliveredAt: args.deliveredAt,
      emailError: undefined,
    });
  },
});

/**
 * Email ke pemilik toko **gagal** — pesan penyedianya (atau “saluran email belum
 * dikonfigurasi”) disimpan apa adanya supaya pemilik bisa melihat sebabnya dan
 * tidak mengira dirinya sudah dikabari.
 */
export const markEmailFailed = internalMutation({
  args: { alertId: v.id("shiftAlerts"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.alertId, { emailError: args.error });
  },
});

/**
 * Menandai satu kabar sudah ditangani (kas dibuka, shift ditutup, atau pemiliknya
 * memang sudah memeriksanya). Yang dihapus **tidak ada**: jejaknya tetap ada
 * sebagai riwayat, karena tanya “kenapa pemilik tidak tahu kasnya belum dibuka?”
 * hanya bisa dijawab kalau laporannya masih tersimpan.
 */
export const resolve = mutation({
  args: { alertId: v.id("shiftAlerts"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    const alert = await ctx.db.get(args.alertId);
    if (!alert) throw new Error("Pemberitahuan shift tidak ditemukan.");

    await requirePermission(ctx, alert.tenantId, args.actorId, "shift.manage");

    if (alert.resolvedAt) return { changed: false };

    await ctx.db.patch(args.alertId, {
      resolvedAt: Date.now(),
      resolvedBy: args.actorId,
    });

    await writeAuditLog(ctx, {
      tenantId: alert.tenantId,
      actorId: args.actorId,
      action: "shift.alert.resolved",
      entity: "shiftAlerts",
      entityId: args.alertId,
      meta: { kind: alert.kind, dayKey: alert.dayKey },
    });

    return { changed: true };
  },
});

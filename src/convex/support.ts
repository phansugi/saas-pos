import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  entitlementsForTenant,
  getTenantOrThrow,
  nextSequence,
  requireFeature,
  requirePermission,
  writeAuditLog,
} from "./lib/access";
import { isFeatureEnabled } from "./lib/billing";
import {
  applySupportAction,
  dueAt,
  DUE_SOON_MAX_MS,
  HOUR_MS,
  logBodyFor,
  MAX_TICKET_LOG,
  MAX_OPEN_TICKETS,
  needsSlaReminder,
  openTicketCount,
  remainingHours,
  responseHoursFor,
  SLA_REMINDER_BATCH,
  slaState,
  supportPlanFor,
  supportSummary,
  ticketNumber,
  validateTicketInput,
  type SupportAction,
  type SupportTicketLike,
} from "./lib/support";
import {
  supportTicketCreatedEventData,
  supportTicketDueEventData,
  supportTicketEscalatedEventData,
  supportTicketResolvedEventData,
} from "./lib/webhookEvents";
import {
  enqueueWebhookEvent,
  scheduleWebhookDeliveryPass,
} from "./lib/webhookOutbox";
import {
  supportCategoryValidator,
  supportPriorityValidator,
} from "./schema";

/**
 * Dukungan khusus (`support.dedicated`, Phase 5 / Dukungan khusus & skala franchise).
 *
 * Satu tempat yang mengubah tabel `supportTickets`. Aturannya ada di
 * lib/support.ts (dipakai halaman & harness), jadi di sini hanya tiga hal yang
 * butuh database: membaca baris tenant, menjaga gerbang fitur/izin, dan menulis
 * audit.
 *
 * Gerbang fiturnya sengaja tidak seragam — pola yang sama dengan
 * `api.access` dan `rbac.custom`:
 *
 *  - **membuka tiket berprioritas Tinggi/Mendesak** dan **eskalasi ke manajer
 *    akun** butuh fitur `support.dedicated` (jalur tanggap cepat — inilah yang
 *    dibeli);
 *  - **membuka tiket prioritas Normal/Rendah, menambah catatan, menutup, dan
 *    membuka ulang** selalu boleh. Kalau paket turun, tenant tidak boleh
 *    kehilangan kemampuan menutup tiketnya sendiri.
 */

const SUPPORT_ACTIONS = [
  v.literal("note"),
  v.literal("start"),
  v.literal("resolve"),
  v.literal("reopen"),
  v.literal("escalate"),
] as const;

function toLike(ticket: Doc<"supportTickets">): SupportTicketLike {
  return {
    number: ticket.number,
    status: ticket.status,
    createdAt: ticket.createdAt,
    slaHours: ticket.slaHours,
    escalated: ticket.escalated,
    resolvedAt: ticket.resolvedAt ?? null,
    logCount: ticket.log.length,
  };
}

function toRow(ticket: Doc<"supportTickets">, now: number) {
  const like = toLike(ticket);
  return {
    id: ticket._id as string,
    number: ticket.number,
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    slaHours: ticket.slaHours,
    planKeyAtCreation: ticket.planKeyAtCreation,
    escalated: ticket.escalated,
    body: ticket.body,
    log: ticket.log.map((entry) => ({
      at: entry.at,
      kind: entry.kind,
      body: entry.body,
    })),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    resolvedAt: ticket.resolvedAt ?? null,
    dueAt: dueAt(like),
    slaState: slaState(like, now),
    remainingHours: Math.max(
      0,
      Math.ceil((dueAt(like) - now) / (60 * 60 * 1000)),
    ),
  };
}

/**
 * Daftar tiket beserta ringkasannya. Izin `support.view` — keuangan termasuk,
 * karena banyak tiket memang soal tagihan; `support.manage` yang mengubahnya.
 */
export const list = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "support.view");

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    const entitlements = entitlementsForTenant(tenant);
    const dedicated = isFeatureEnabled(
      entitlements,
      tenant.verticals,
      "support.dedicated",
    );

    const tickets = await ctx.db
      .query("supportTickets")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const now = Date.now();
    const rows = tickets
      .map((ticket) => toRow(ticket, now))
      .sort((a, b) => b.createdAt - a.createdAt);

    return {
      tickets: rows,
      summary: supportSummary(tickets.map(toLike), now),
      /** Janji dukungan paket ini, supaya halaman tidak menghitungnya sendiri. */
      plan: {
        planKey: tenant.planKey,
        dedicated,
        ...supportPlanFor(tenant.planKey),
      },
      limits: {
        maxOpenTickets: MAX_OPEN_TICKETS,
        maxLog: MAX_TICKET_LOG,
      },
    };
  },
});

/**
 * Membuka tiket baru. Prioritas Tinggi/Mendesak digerbang fitur; prioritas
 * Normal/Rendah boleh di paket mana pun.
 */
export const create = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    subject: v.string(),
    category: supportCategoryValidator,
    priority: supportPriorityValidator,
    body: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "support.manage");

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    const entitlements = entitlementsForTenant(tenant);
    const dedicated = isFeatureEnabled(
      entitlements,
      tenant.verticals,
      "support.dedicated",
    );

    const existing = await ctx.db
      .query("supportTickets")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const validation = validateTicketInput(
      {
        subject: args.subject,
        category: args.category,
        priority: args.priority,
        body: args.body,
      },
      { dedicated, openCount: openTicketCount(existing.map(toLike)) },
    );
    if (!validation.ok) throw new Error(validation.reason);
    const draft = validation.value;

    const now = Date.now();
    const sequence = await nextSequence(ctx, args.tenantId, "support-ticket");
    const number = ticketNumber(sequence, new Date(now).getFullYear());
    // Jam tanggap dari aturan murni (jam dasar paket × pengali prioritas) dan
    // **dipatok** di baris tiket: paket yang berubah nanti tidak menulis ulang
    // janji tanggap untuk tiket yang sudah masuk.
    const slaHours = responseHoursFor(tenant.planKey, draft.priority);

    const ticketId = await ctx.db.insert("supportTickets", {
      tenantId: args.tenantId,
      number,
      subject: draft.subject,
      category: draft.category,
      priority: draft.priority,
      status: "open",
      slaHours,
      // Janji tanggap dipatok sebagai waktu absolut supaya pekerja pengingat
      // tidak perlu menghitung ulang, dan penandanya siap dari awal.
      dueAt: now + slaHours * HOUR_MS,
      slaNotified: false,
      planKeyAtCreation: tenant.planKey,
      escalated: false,
      body: draft.body,
      log: [
        {
          at: now,
          kind: "status" as const,
          actorId: args.actorId,
          body: "Tiket dibuat.",
        },
      ],
      createdById: args.actorId,
      createdAt: now,
      updatedAt: now,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "support.create",
      entity: "supportTickets",
      entityId: ticketId,
      meta: {
        number,
        category: draft.category,
        priority: draft.priority,
        slaHours,
        dedicated,
      },
    });

    // Kanal keluar (`api.access`): tiket baru mengabarkan dirinya sendiri ke
    // endpoint tenant yang melanggan — tim tidak perlu membuka aplikasi dulu.
    const enqueued = await enqueueWebhookEvent(ctx, {
      tenantId: args.tenantId,
      event: "support.created",
      subject: number,
      at: now,
      data: supportTicketCreatedEventData({
        number,
        subject: draft.subject,
        category: draft.category,
        priority: draft.priority,
        slaHours,
        planKey: tenant.planKey,
        dueAt: now + slaHours * HOUR_MS,
      }),
    });
    await scheduleWebhookDeliveryPass(ctx, enqueued);

    return { ticketId, number, slaHours };
  },
});

/**
 * Menjalankan satu aksi atas tiket: catatan, mulai, selesaikan, buka ulang, atau
 * eskalasi. Perubahan statusnya sendiri divalidasi aturan murni, jadi tidak ada
 * lompatan status yang bisa dititipkan lewat argumen.
 */
export const act = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    ticketId: v.id("supportTickets"),
    action: v.union(...SUPPORT_ACTIONS),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "support.manage");

    const ticket = await ctx.db.get(args.ticketId);
    if (!ticket || ticket.tenantId !== args.tenantId) {
      throw new Error("Tiket dukungan tidak ditemukan untuk tenant ini.");
    }

    const action = args.action as SupportAction;

    // Eskalasi adalah bagian dari janji dukungan khusus; catatan, penutupan, dan
    // pembukaan ulang tidak digerbang fitur.
    if (action === "escalate") {
      await requireFeature(
        ctx,
        args.tenantId,
        args.actorId,
        "support.dedicated",
      );
    }

    const now = Date.now();
    const patch = applySupportAction(toLike(ticket), action, {
      now,
      note: args.note,
    });
    if (!patch.ok) throw new Error(patch.reason);
    const value = patch.value;

    const event = {
      at: now,
      kind: value.kind,
      actorId: args.actorId,
      body: logBodyFor(action, value),
    };

    await ctx.db.patch(ticket._id, {
      status: value.status,
      escalated: value.escalated,
      resolvedAt: value.resolvedAt === null ? undefined : value.resolvedAt,
      log: [...ticket.log, event].slice(-MAX_TICKET_LOG),
      updatedAt: now,
      // Tiket yang dibuka ulang butuh perhatian lagi, jadi pengingatnya direset;
      // tiket lama (sebelum kolom `dueAt` ada) dilengkapi saat disentuh.
      slaNotified: action === "reopen" ? false : (ticket.slaNotified ?? false),
      dueAt: ticket.dueAt ?? dueAt(toLike(ticket)),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: `support.${action}`,
      entity: "supportTickets",
      entityId: ticket._id,
      meta: {
        number: ticket.number,
        before: ticket.status,
        after: value.status,
        escalated: value.escalated,
      },
    });

    // Kanal keluar: satu tiket bisa mengabarkan dua hal berbeda — dieskalasi
    // dan/atau ditutup. Catatan & mulai tidak mengirim apa-apa (tidak ada
    // perubahan janji yang perlu diketahui penerima).
    let enqueued = 0;
    if (action === "escalate") {
      enqueued += await enqueueWebhookEvent(ctx, {
        tenantId: args.tenantId,
        event: "support.escalated",
        subject: ticket.number,
        at: now,
        data: supportTicketEscalatedEventData({
          number: ticket.number,
          priority: ticket.priority,
          slaHours: ticket.slaHours,
        }),
      });
    }
    if (action === "resolve") {
      enqueued += await enqueueWebhookEvent(ctx, {
        tenantId: args.tenantId,
        event: "support.resolved",
        subject: ticket.number,
        at: now,
        data: supportTicketResolvedEventData({
          number: ticket.number,
          slaHours: ticket.slaHours,
          slaState: slaState(
            { ...toLike(ticket), status: "resolved", resolvedAt: value.resolvedAt },
            now,
          ),
        }),
      });
    }
    await scheduleWebhookDeliveryPass(ctx, enqueued);

    return {
      ticketId: ticket._id,
      status: value.status,
      escalated: value.escalated,
      resolvedAt: value.resolvedAt,
    };
  },
});

/**
 * Pengingat janji tanggap (`support.due`) — dijalankan pekerja terjadwal
 * (`crons.ts`).
 *
 * Inilah bagian kedua kanal keluar dukungan khusus: tiket yang hidup di dalam
 * aplikasi hanya terlihat kalau ada yang membuka halamannya, jadi tiket yang
 * janji tanggapnya hampir (atau sudah) lewat harus mengabarkan dirinya sendiri.
 *
 * Tiga hal yang dijaga:
 *
 *  - **Dibatasi indeks, bukan memindai tabel.** Kandidatnya diambil lewat
 *    `by_sla` (`slaNotified = false` dan `dueAt` di bawah ambang terpanjang),
 *    lalu tiap tiket diperiksa aturan murni `needsSlaReminder` — jendela
 *    “segera jatuh tempo”-nya berbeda per tiket.
 *  - **Sekali per tiket.** Penanda `slaNotified` dipasang begitu kirimannya
 *    ditulis, jadi satu tiket tidak diberitakan setiap putaran; tiket yang
 *    dibuka ulang mereset penandanya di `act`.
 *  - **Tanpa gerbang fitur.** Pekerja hanya mengirim ke endpoint yang benar-benar
 *    melanggan `support.due`; menghitung ulang paket di sini akan mematikan
 *    pengingat yang sedang berjalan tanpa memberi tahu siapa pun.
 */
export const notifyDueTickets = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.max(
      1,
      Math.min(SLA_REMINDER_BATCH, Math.floor(args.limit ?? SLA_REMINDER_BATCH)),
    );
    // Ambang terpanjang yang mungkin (2 jam) membatasi rentang indeks; jendela
    // sebenarnya tetap ditentukan per tiket oleh aturan murni.
    const candidates = await ctx.db
      .query("supportTickets")
      .withIndex("by_sla", (q) =>
        q.eq("slaNotified", false).lt("dueAt", now + DUE_SOON_MAX_MS),
      )
      .take(limit);

    let reminded = 0;
    let enqueued = 0;
    for (const ticket of candidates) {
      const like = toLike(ticket);
      if (!needsSlaReminder({ ...like, slaNotified: ticket.slaNotified }, now)) {
        continue;
      }
      enqueued += await enqueueWebhookEvent(ctx, {
        tenantId: ticket.tenantId,
        event: "support.due",
        subject: ticket.number,
        at: now,
        data: supportTicketDueEventData({
          number: ticket.number,
          priority: ticket.priority,
          slaHours: ticket.slaHours,
          remainingHours: remainingHours(like, now),
          overdue: slaState(like, now) === "overdue",
        }),
      });
      await ctx.db.patch(ticket._id, { slaNotified: true, updatedAt: now });
      reminded += 1;
    }

    await scheduleWebhookDeliveryPass(ctx, enqueued);
    return { checked: candidates.length, reminded, enqueued };
  },
});


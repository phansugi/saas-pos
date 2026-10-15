import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireFeature, requirePermission, writeAuditLog } from "./lib/access";
import {
  agingOf,
  applyReceivablePayment,
  creditPosition,
  needsOverdueReminder,
  OVERDUE_REMINDER_BATCH,
  OVERDUE_REMINDER_WINDOW_MS,
  receivableBalance,
  resolveCustomerInput,
  summariseReceivables,
  type AgingBucket,
  type ReceivableLike,
} from "./lib/ar";
import { receivableOverdueEventData } from "./lib/webhookEvents";
import {
  enqueueWebhookEvent,
  scheduleWebhookDeliveryPass,
} from "./lib/webhookOutbox";
import { paymentMethodValidator } from "./schema";

/**
 * Piutang B2B & limit kredit (`ar.creditlimit`) — modul Grosir, Phase 2.
 *
 * Dua penjaga yang sengaja berbeda:
 *
 * - **Membuat piutang** (`pos.createSale` dengan bayar sebagian) butuh fitur
 *   `ar.creditlimit`, jadi mematikan modul Grosir menghentikan tempo baru.
 * - **Menagih piutang** (query & mutasi di sini) hanya butuh izin `ar.*`, bukan
 *   modulnya. Mematikan modul tidak boleh membuat utang pelanggan jadi tak
 *   tertagih: tagihan lama tetap harus bisa dilihat dan dilunasi.
 */

type Ctx = Parameters<typeof requirePermission>[0];

/** Dokumen piutang → bentuk minimal yang dipahami aturan murni. */
function toReceivableLike(receivable: Doc<"receivables">): ReceivableLike {
  return {
    amount: receivable.amount,
    paidAmount: receivable.paidAmount,
    dueDate: receivable.dueDate,
    status: receivable.status,
  };
}

async function loadReceivables(
  ctx: Ctx,
  tenantId: Id<"tenants">,
): Promise<Doc<"receivables">[]> {
  return await ctx.db
    .query("receivables")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
}

/**
 * Daftar pelanggan + piutang terbuka + ringkasan umur piutang, semuanya dihitung
 * dari aturan murni `lib/ar.ts` supaya angka di halaman Piutang sama persis
 * dengan yang dipakai server saat menerima/menolak penjualan tempo.
 */
export const list = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    // Melihat piutang = izin `ar.view` (kasir juga perlu, untuk sisa limit).
    await requirePermission(ctx, args.tenantId, args.actorId, "ar.view");

    const now = Date.now();
    const customers = await ctx.db
      .query("customers")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const receivables = await loadReceivables(ctx, args.tenantId);

    const byCustomer = new Map<string, Doc<"receivables">[]>();
    for (const receivable of receivables) {
      const list = byCustomer.get(receivable.customerId as string) ?? [];
      list.push(receivable);
      byCustomer.set(receivable.customerId as string, list);
    }

    const customerRows = customers
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "id-ID"))
      .map((customer) => ({
        id: customer._id,
        code: customer.code,
        name: customer.name,
        phone: customer.phone,
        creditLimit: customer.creditLimit,
        paymentTermDays: customer.paymentTermDays,
        active: customer.active,
        ...creditPosition(customer, (byCustomer.get(customer._id) ?? []).map(toReceivableLike), now),
      }));

    const nameByCustomer = new Map(customers.map((c) => [c._id as string, c]));
    const sales = await ctx.db
      .query("sales")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const saleNumberById = new Map(sales.map((sale) => [sale._id as string, sale.number]));

    const receivableRows = receivables
      .slice()
      .sort((a, b) => a.dueDate - b.dueDate)
      .map((receivable) => {
        const aging = agingOf(toReceivableLike(receivable), now);
        return {
          id: receivable._id,
          number: receivable.number,
          customerId: receivable.customerId,
          customerName: nameByCustomer.get(receivable.customerId as string)?.name ?? "—",
          saleId: receivable.saleId,
          saleNumber: receivable.saleId
            ? (saleNumberById.get(receivable.saleId as string) ?? null)
            : null,
          amount: receivable.amount,
          paidAmount: receivable.paidAmount,
          balance: receivableBalance(toReceivableLike(receivable)),
          dueDate: receivable.dueDate,
          status: receivable.status,
          daysPastDue: aging.daysPastDue,
          bucket: aging.bucket as AgingBucket,
          overdue: aging.overdue,
          createdAt: receivable.createdAt,
        };
      });

    return {
      customers: customerRows,
      receivables: receivableRows,
      summary: summariseReceivables(receivables.map(toReceivableLike), now),
      /** Total limit yang sudah diberikan, untuk konteks di halaman Piutang. */
      totalCreditLimit: customerRows.reduce((sum, c) => sum + c.creditLimit, 0),
    };
  },
});

/**
 * Menambah pelanggan B2B. Pelanggan tanpa limit (0) hanyalah daftar nama untuk
 * struk — karena itu hanya limit > 0 yang butuh modul Grosir aktif, sehingga
 * daftar pelanggan bisa dirapikan bahkan setelah modulnya dimatikan.
 */
export const createCustomer = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    name: v.string(),
    code: v.optional(v.string()),
    phone: v.optional(v.string()),
    creditLimit: v.optional(v.number()),
    paymentTermDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "ar.manage");

    const existing = await ctx.db
      .query("customers")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const resolved = resolveCustomerInput(
      {
        name: args.name,
        code: args.code,
        phone: args.phone,
        creditLimit: args.creditLimit,
        paymentTermDays: args.paymentTermDays,
      },
      existing.map((customer) => customer.code),
    );
    if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
    const customer = resolved.value;

    if (customer.creditLimit > 0) {
      await requireFeature(
        ctx,
        args.tenantId,
        args.actorId,
        "ar.creditlimit",
        "ar.manage",
      );
    }

    const duplicate = existing.find((row) => row.code === customer.code);
    if (duplicate) throw new Error(`Kode pelanggan ${customer.code} sudah dipakai.`);

    const customerId = await ctx.db.insert("customers", {
      tenantId: args.tenantId,
      code: customer.code,
      name: customer.name,
      phone: customer.phone,
      creditLimit: customer.creditLimit,
      paymentTermDays: customer.paymentTermDays,
      active: customer.active,
      createdAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "customer.create",
      entity: "customers",
      entityId: customerId,
      meta: { code: customer.code, name: customer.name, creditLimit: customer.creditLimit },
    });

    return { customerId, code: customer.code, name: customer.name };
  },
});

/**
 * Mengubah limit/tempo/status pelanggan. Menurunkan limit **dan** menutup kredit
 * (limit 0 = tunai saja) selalu boleh, bahkan tanpa modul Grosir — itu jalur
 * pembersihan konfigurasi, bukan penambahan kredit baru.
 */
export const setCredit = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    customerId: v.id("customers"),
    creditLimit: v.optional(v.number()),
    paymentTermDays: v.optional(v.number()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "ar.manage");

    const existing = await ctx.db.get(args.customerId);
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new Error("Pelanggan tidak ditemukan untuk tenant ini.");
    }

    const creditLimit = Math.trunc(args.creditLimit ?? existing.creditLimit);
    const paymentTermDays = Math.trunc(
      args.paymentTermDays ?? existing.paymentTermDays,
    );
    const active = args.active ?? existing.active;

    if (creditLimit > 0) {
      await requireFeature(
        ctx,
        args.tenantId,
        args.actorId,
        "ar.creditlimit",
        "ar.manage",
      );
    }

    const resolved = resolveCustomerInput({
      name: existing.name,
      code: existing.code,
      phone: existing.phone,
      creditLimit,
      paymentTermDays,
      active,
    });
    if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
    const customer = resolved.value;

    await ctx.db.patch(args.customerId, {
      creditLimit: customer.creditLimit,
      paymentTermDays: customer.paymentTermDays,
      active: customer.active,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "customer.credit",
      entity: "customers",
      entityId: args.customerId,
      meta: {
        from: existing.creditLimit,
        to: customer.creditLimit,
        termDays: customer.paymentTermDays,
        active: customer.active,
      },
    });

    return {
      creditLimit: customer.creditLimit,
      paymentTermDays: customer.paymentTermDays,
      active: customer.active,
    };
  },
});

/**
 * Menerima pembayaran piutang — boleh sebagian. Sengaja **tidak** digerbang
 * fitur modul: penagihan utang lama harus tetap bisa dilakukan walau modul
 * Grosir dimatikan, kalau tidak utang pelanggan menjadi tak tertagih.
 */
export const recordPayment = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    receivableId: v.id("receivables"),
    amount: v.number(),
    method: paymentMethodValidator,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "ar.manage");

    const receivable = await ctx.db.get(args.receivableId);
    if (!receivable || receivable.tenantId !== args.tenantId) {
      throw new Error("Piutang tidak ditemukan untuk tenant ini.");
    }

    const applied = applyReceivablePayment(toReceivableLike(receivable), args.amount);
    if (!applied.ok) throw new Error(applied.reason);

    const paidAmount = receivable.paidAmount + applied.accepted;
    await ctx.db.patch(args.receivableId, {
      paidAmount,
      status: applied.fullyPaid ? "paid" : "open",
    });

    await ctx.db.insert("receivablePayments", {
      tenantId: args.tenantId,
      receivableId: args.receivableId,
      customerId: receivable.customerId,
      amount: applied.accepted,
      method: args.method,
      note: args.note,
      actorId: args.actorId,
      createdAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "receivable.payment",
      entity: "receivables",
      entityId: args.receivableId,
      meta: {
        number: receivable.number,
        amount: applied.accepted,
        method: args.method,
        remaining: applied.remaining,
      },
    });

    return { paidAmount, remaining: applied.remaining, fullyPaid: applied.fullyPaid };
  },
});

/** Riwayat penerimaan satu nota — dipakai halaman Piutang untuk membuka detail. */
export const paymentsFor = query({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    receivableId: v.id("receivables"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "ar.view");

    const receivable = await ctx.db.get(args.receivableId);
    if (!receivable || receivable.tenantId !== args.tenantId) {
      throw new Error("Piutang tidak ditemukan untuk tenant ini.");
    }

    return await ctx.db
      .query("receivablePayments")
      .withIndex("by_receivable", (q) => q.eq("receivableId", args.receivableId))
      .collect();
  },
});

/**
 * Pengingat piutang lewat tempo (`receivable.overdue`) — dijalankan pekerja
 * harian (`crons.ts`).
 *
 * Pasangan kalender dari `payables.notifyDuePayables`: piutang menunggak juga
 * berubah karena **waktu**, bukan karena transaksi, jadi tanpa pekerja ini event
 * `receivable.overdue` bisa dilanggan tetapi tidak pernah berangkat.
 *
 * Kandidatnya dibaca dari indeks `by_overdue` (`overdueNotified = false` dan
 * `dueDate` lebih tua dari sekarang), lalu tiap baris diperiksa
 * `needsOverdueReminder` yang memakai `agingOf` yang sama dengan lencana halaman
 * Piutang. Penanda `overdueNotified` dipasang begitu kirimannya ditulis, jadi satu
 * nota tidak dikabarkan setiap hari.
 */
export const notifyOverdueReceivables = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.max(
      1,
      Math.min(OVERDUE_REMINDER_BATCH, Math.floor(args.limit ?? OVERDUE_REMINDER_BATCH)),
    );
    // Jendela 60 hari: lihat `OVERDUE_REMINDER_WINDOW_MS` — batas bawah inilah
    // yang mencegah nota lama menumpuk di depan indeks dan menghabiskan kuota
    // putaran.
    const candidates = await ctx.db
      .query("receivables")
      .withIndex("by_overdue", (q) =>
        q
          .eq("overdueNotified", false)
          .gt("dueDate", now - OVERDUE_REMINDER_WINDOW_MS)
          .lt("dueDate", now),
      )
      .take(limit);

    let reminded = 0;
    let enqueued = 0;
    for (const receivable of candidates) {
      const like = toReceivableLike(receivable);
      if (!needsOverdueReminder({ ...like, overdueNotified: receivable.overdueNotified }, now)) {
        continue;
      }

      const customer = await ctx.db.get(receivable.customerId);
      enqueued += await enqueueWebhookEvent(ctx, {
        tenantId: receivable.tenantId,
        storeId: receivable.storeId,
        event: "receivable.overdue",
        subject: receivable.number,
        at: now,
        data: receivableOverdueEventData({
          number: receivable.number,
          customerName: customer?.name ?? "Pelanggan",
          balance: receivableBalance(like),
          dueDate: receivable.dueDate,
          daysPastDue: agingOf(like, now).daysPastDue,
        }),
      });
      await ctx.db.patch(receivable._id, { overdueNotified: true });
      reminded += 1;
    }

    await scheduleWebhookDeliveryPass(ctx, enqueued);
    return { checked: candidates.length, reminded, enqueued };
  },
});

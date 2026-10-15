import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { nextSequence, requireFeature, requirePermission, writeAuditLog } from "./lib/access";
import { AGING_BUCKETS, type AgingBucket } from "./lib/ar";
import {
  applyPayablePayment,
  describePayableSource,
  DUE_REMINDER_BATCH,
  DUE_REMINDER_WINDOW_MS,
  needsDueReminder,
  payableAging,
  payableBalance,
  resolveBillInput,
  resolveDueDate,
  summarisePayables,
  MAX_PAYABLE_NOTE,
  type PayableLike,
  type PayableStatus,
} from "./lib/payables";
import {
  amountAfterDecision,
  batchPaymentNumber,
  canPayPayable,
  canRecordInvoice,
  matchPayable,
  planBatchPayment,
  resolveInvoiceInput,
  resolveMatchDecision,
  summariseThreeway,
  type BatchPayableLike,
  type MatchDecision,
  type MatchReceiptLine,
  type ThreewayMatch,
} from "./lib/threeway";
import { payableDueEventData } from "./lib/webhookEvents";
import {
  enqueueWebhookEvent,
  scheduleWebhookDeliveryPass,
} from "./lib/webhookOutbox";
import { paymentMethodValidator } from "./schema";

/**
 * Hutang usaha / AP (`purchasing.basic`, Phase 3).
 *
 * Dua penjaga yang sengaja berbeda, sama polanya dengan piutang B2B:
 *
 * - **Mencatat tagihan baru** (`createBill`) butuh fitur `purchasing.basic` —
 *   ini komitmen usaha baru, dan itulah yang dibayar.
 * - **Melihat dan membayar hutang** hanya butuh izin `payable.*`. Hutang yang
 *   sudah tercatat harus tetap bisa dilunasi walau paketnya turun; kalau tidak,
 *   tagihan supplier menggantung karena perubahan langganan.
 *
 * Hutang dari penerimaan barang (GRN) dibuat `purchasing.receive` lewat aturan
 * murni `lib/payables.ts` (`buildPayableForReceipt`), bukan di sini — supaya
 * "barang masuk" dan "hutangnya timbul" terjadi dalam satu transaksi.
 */

type Ctx = Parameters<typeof requirePermission>[0];

function toPayableLike(payable: Doc<"payables">): PayableLike {
  return {
    amount: payable.amount,
    paidAmount: payable.paidAmount,
    dueDate: payable.dueDate,
    status: payable.status as PayableStatus,
  };
}

async function loadPayables(
  ctx: Ctx,
  tenantId: Id<"tenants">,
): Promise<Doc<"payables">[]> {
  return await ctx.db
    .query("payables")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
}

/** Baris GRN dalam bentuk yang dipahami aturan pencocokan. */
function toMatchReceiptLines(
  receipt: Doc<"goodsReceipts"> | undefined | null,
): MatchReceiptLine[] {
  return (receipt?.lines ?? []).map((line) => ({
    productId: line.productId as string,
    name: line.name,
    quantity: line.quantity,
    unitCost: line.unitCost,
  }));
}

/** Baris PO dalam bentuk yang dipahami aturan pencocokan. */
function toMatchOrderLines(order: Doc<"purchaseOrders"> | undefined | null) {
  return (order?.lines ?? []).map((line) => ({
    productId: line.productId as string,
    name: line.name,
    quantity: line.quantity,
    unitCost: line.unitCost,
    receivedQty: line.receivedQty,
  }));
}

/** Dokumen supplier yang sudah dicatat untuk tagihan ini, atau `null`. */
function toInvoiceLike(payable: Doc<"payables">) {
  if (!payable.invoice) return null;
  return {
    reference: payable.invoice.reference,
    total: payable.invoice.total,
    lines: payable.invoice.lines.map((line) => ({
      productId: line.productId as string,
      name: line.name,
      quantity: line.quantity,
      unitCost: line.unitCost,
    })),
    recordedAt: payable.invoice.recordedAt,
  };
}

/**
 * Mencocokkan satu tagihan dengan PO & GRN-nya. Satu fungsi dipakai semua tempat
 * yang perlu status pencocokan (`list`, `recordInvoice`, `resolveMatch`), supaya
 * tidak ada dua cara menghitung selisih yang sama.
 */
function matchOf(args: {
  payable: Doc<"payables">;
  order?: Doc<"purchaseOrders"> | null;
  receipt?: Doc<"goodsReceipts"> | null;
}): ThreewayMatch {
  return matchPayable({
    orderLines: toMatchOrderLines(args.order),
    receiptLines: toMatchReceiptLines(args.receipt),
    invoice: toInvoiceLike(args.payable),
  });
}

/**
 * Tagihan supplier + ringkasan umur hutang. Angka di halaman Pembelian dihitung
 * dari aturan murni `lib/payables.ts`, jadi sama persis dengan yang dipakai
 * server saat menolak PO ke supplier menunggak.
 */
export const list = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "payable.view");

    const now = Date.now();
    const [payables, suppliers, payments, orders, receipts] = await Promise.all([
      loadPayables(ctx, args.tenantId),
      ctx.db
        .query("suppliers")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
      ctx.db
        .query("payablePayments")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
      ctx.db
        .query("purchaseOrders")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
      ctx.db
        .query("goodsReceipts")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
    ]);

    const supplierById = new Map(suppliers.map((supplier) => [supplier._id as string, supplier]));
    const orderById = new Map(orders.map((order) => [order._id as string, order]));
    const receiptById = new Map(receipts.map((receipt) => [receipt._id as string, receipt]));

    const rows = payables
      .slice()
      .sort((a, b) => a.dueDate - b.dueDate)
      .map((payable) => {
        const aging = payableAging(toPayableLike(payable), now);
        const supplier = supplierById.get(payable.supplierId as string);
        const receipt = payable.receiptId
          ? (receiptById.get(payable.receiptId as string) ?? null)
          : null;
        const order = payable.orderId
          ? (orderById.get(payable.orderId as string) ?? null)
          : receipt
            ? (orderById.get(receipt.orderId as string) ?? null)
            : null;
        const receiptNumber = receipt?.number ?? null;
        const orderNumber = order?.number ?? null;
        const match = matchOf({ payable, order, receipt });
        const balance = payableBalance(toPayableLike(payable));
        const decision: MatchDecision | null = payable.matchDecision
          ? {
              kind: payable.matchDecision.kind,
              note: payable.matchDecision.note,
              decidedAt: payable.matchDecision.decidedAt,
            }
          : null;
        return {
          id: payable._id,
          number: payable.number,
          supplierId: payable.supplierId,
          supplierName: supplier?.name ?? "Supplier dihapus",
          reference: payable.reference,
          orderNumber,
          receiptNumber,
          source: describePayableSource({
            orderNumber,
            receiptNumber,
            reference: payable.reference,
          }),          amount: payable.amount,
          paidAmount: payable.paidAmount,
          balance,
          /** Dokumen supplier + status pencocokan 3 arah (dihitung, bukan disimpan). */
          invoice: payable.invoice
            ? {
                reference: payable.invoice.reference ?? null,
                total: payable.invoice.total,
                lines: payable.invoice.lines.map((line) => ({
                  productId: line.productId,
                  name: line.name,
                  quantity: line.quantity,
                  unitCost: line.unitCost,
                })),
                note: payable.invoice.note ?? null,
                recordedAt: payable.invoice.recordedAt,
              }
            : null,
          decision,
          match,

          dueDate: payable.dueDate,
          paymentTermDays: payable.paymentTermDays,
          status: payable.status as PayableStatus,
          daysPastDue: aging.daysPastDue,
          bucket: aging.bucket as AgingBucket,
          overdue: aging.overdue,
          note: payable.note,
          createdAt: payable.createdAt,
        };
      });

    const paymentRows = payments
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((payment) => {
        const payable = payables.find((row) => row._id === payment.payableId);
        return {
          id: payment._id,
          payableId: payment.payableId,
          payableNumber: payable?.number ?? "—",
          supplierName:
            supplierById.get(payment.supplierId as string)?.name ?? "Supplier dihapus",
          amount: payment.amount,
          method: payment.method,
          note: payment.note,
          /** Nomor batch kalau pembayaran ini bagian dari bayar sekaligus. */
          batchNumber: payment.batchNumber,
          createdAt: payment.createdAt,
        };
      });

    // Pembayaran yang lahir dari satu kali "bayar sekaligus" dikelompokkan lagi
    // berdasarkan nomor batch-nya, supaya transfer bank bisa dicocokkan dengan
    // beberapa tagihan sekaligus.
    const batchRows = [
      ...payments
        .filter((payment) => payment.batchNumber !== undefined)
        .reduce((groups, payment) => {
          const key = payment.batchNumber as string;
          groups.set(key, [...(groups.get(key) ?? []), payment]);
          return groups;
        }, new Map<string, Doc<"payablePayments">[]>()),
    ]
      .map(([number, group]) => ({
        number,
        at: Math.max(...group.map((row) => row.createdAt)),
        total: group.reduce((sum, row) => sum + row.amount, 0),
        count: group.length,
        method: group[0].method,
        bills: group
          .map((row) => ({
            payableId: row.payableId,
            payableNumber:
              payables.find((payable) => payable._id === row.payableId)?.number ?? "—",
            supplierName:
              supplierById.get(row.supplierId as string)?.name ?? "Supplier dihapus",
            amount: row.amount,
          }))
          .sort((a, b) => a.payableNumber.localeCompare(b.payableNumber)),
      }))
      .sort((a, b) => b.at - a.at)
      .slice(0, 20);

    return {
      payables: rows,
      payments: paymentRows,
      summary: summarisePayables(payables.map(toPayableLike), now),
      /** Ringkasan pencocokan 3 arah: yang cocok, yang perlu ditinjau, sengketanya. */
      matchSummary: summariseThreeway(
        rows.map((row) => ({
          match: row.match,
          decision: row.decision,
          balance: row.balance,
        })),
      ),
      batches: batchRows,
      /** Daftar umur hutang yang dipakai halaman, terurut kanonik. */
      buckets: [...AGING_BUCKETS],
    };
  },
});

/**
 * Mencatat tagihan supplier di luar PO — saldo awal dari sistem lama, tagihan
 * jasa, atau nota yang baru ditagihkan sekarang. Jatuh temponya ditentukan
 * manual (boleh sudah lewat, supaya umur hutang lamanya benar).
 */
export const createBill = mutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
    supplierId: v.id("suppliers"),
    reference: v.optional(v.string()),
    amount: v.number(),
    dueDate: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Komitmen usaha baru: ini yang digerbang fitur.
    await requireFeature(
      ctx,
      args.tenantId,
      args.actorId,
      "purchasing.basic",
      "payable.manage",
    );

    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier || supplier.tenantId !== args.tenantId) {
      throw new Error("Supplier tidak ditemukan untuk tenant ini.");
    }

    const resolved = resolveBillInput(
      {
        reference: args.reference,
        amount: args.amount,
        dueDate: args.dueDate,
        note: args.note,
      },
      { supplierName: supplier.name },
    );
    if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
    const bill = resolved.value;

    const sequence = await nextSequence(ctx, args.tenantId, "ap");
    const number = `AP-${String(sequence).padStart(5, "0")}`;

    const payableId = await ctx.db.insert("payables", {
      tenantId: args.tenantId,
      storeId: args.storeId,
      supplierId: args.supplierId,
      number,
      reference: bill.reference,
      amount: bill.amount,
      paidAmount: 0,
      dueDate: bill.dueDate,
      paymentTermDays: 0,
      status: "open",
      note: bill.note,
      // Penanda pengingat ditulis sejak lahir — lihat catatan di
      // `purchasing.receive`: baris tanpa kolom ini tidak ditemukan indeks
      // `(dueNotified, dueDate)` yang dipakai pekerja harian.
      dueNotified: false,
      createdAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "payable.create",
      entity: "payables",
      entityId: payableId,
      meta: {
        number,
        supplier: supplier.name,
        reference: bill.reference,
        amount: bill.amount,
        dueDate: new Date(bill.dueDate).toISOString().slice(0, 10),
      },
    });

    return { payableId, number, amount: bill.amount, dueDate: bill.dueDate };
  },
});

/**
 * Membayar hutang supplier — boleh sebagian. **Tidak** digerbang fitur:
 * tagihan yang sudah ada harus tetap bisa dibayar walau paketnya turun.
 */
export const recordPayment = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    payableId: v.id("payables"),
    amount: v.number(),
    method: paymentMethodValidator,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "payable.manage");

    const payable = await ctx.db.get(args.payableId);
    if (!payable || payable.tenantId !== args.tenantId) {
      throw new Error("Hutang tidak ditemukan untuk tenant ini.");
    }

    // Sengketa selisih menahan uang: tagihan yang sedang disengketakan tidak
    // dibayar sampai selisihnya diterima atau sengketanya dicabut.
    const payableAllowed = canPayPayable(payable.matchDecision as MatchDecision | undefined);
    if (!payableAllowed.ok) throw new Error(payableAllowed.reason);

    const applied = applyPayablePayment(toPayableLike(payable), args.amount);
    if (!applied.ok) throw new Error(applied.reason);

    const paidAmount = payable.paidAmount + applied.accepted;
    await ctx.db.patch(args.payableId, {
      paidAmount,
      status: applied.fullyPaid ? "paid" : "open",
    });

    const note = args.note?.trim().slice(0, MAX_PAYABLE_NOTE) || undefined;
    await ctx.db.insert("payablePayments", {
      tenantId: args.tenantId,
      payableId: args.payableId,
      supplierId: payable.supplierId,
      amount: applied.accepted,
      method: args.method,
      note,
      actorId: args.actorId,
      createdAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "payable.payment",
      entity: "payables",
      entityId: args.payableId,
      meta: {
        number: payable.number,
        amount: applied.accepted,
        method: args.method,
        remaining: applied.remaining,
      },
    });

    return { paidAmount, remaining: applied.remaining, fullyPaid: applied.fullyPaid };
  },
});

/** PO & GRN yang jadi rujukan pencocokan sebuah tagihan. */
async function loadMatchContext(
  ctx: Ctx,
  tenantId: Id<"tenants">,
  payable: Doc<"payables">,
): Promise<{
  receipt: Doc<"goodsReceipts"> | null;
  order: Doc<"purchaseOrders"> | null;
}> {
  const receipt = payable.receiptId ? await ctx.db.get(payable.receiptId) : null;
  if (receipt && receipt.tenantId !== tenantId) {
    throw new Error("Penerimaan barang tidak ditemukan untuk tenant ini.");
  }
  const orderId = payable.orderId ?? receipt?.orderId;
  const order = orderId ? await ctx.db.get(orderId) : null;
  if (order && order.tenantId !== tenantId) {
    throw new Error("PO tidak ditemukan untuk tenant ini.");
  }
  return { receipt, order };
}

/**
 * Mencatat **dokumen supplier** (tagihan yang dikirim supplier) untuk sebuah
 * hutang dari penerimaan barang, lalu langsung mencocokkannya dengan PO & GRN.
 *
 * Yang digerbang fitur di sini adalah **dokumen tagihan**-nya: hutang dari GRN
 * tetap lahir di `purchasing.basic`, tetapi nilai yang ditagih supplier baru bisa
 * dibandingkan dengan pesanan & penerimaan di paket `purchasing.threeway`.
 */
export const recordInvoice = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    payableId: v.id("payables"),
    reference: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    note: v.optional(v.string()),
    lines: v.array(
      v.object({
        productId: v.id("products"),
        quantity: v.number(),
        unitCost: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireFeature(
      ctx,
      args.tenantId,
      args.actorId,
      "purchasing.threeway",
      "payable.manage",
    );

    const payable = await ctx.db.get(args.payableId);
    if (!payable || payable.tenantId !== args.tenantId) {
      throw new Error("Hutang tidak ditemukan untuk tenant ini.");
    }

    const allowed = canRecordInvoice({
      status: payable.status as PayableStatus,
      hasInvoice: payable.invoice !== undefined,
      hasReceipt: payable.receiptId !== undefined,
    });
    if (!allowed.ok) throw new Error(allowed.reason);

    const { receipt, order } = await loadMatchContext(ctx, args.tenantId, payable);
    const receiptLines = toMatchReceiptLines(receipt);
    if (receiptLines.length === 0) {
      throw new Error("Penerimaan barang ini tidak punya baris untuk dicocokkan.");
    }

    const resolved = resolveInvoiceInput(
      { reference: args.reference, lines: args.lines, note: args.note },
      { orderLines: toMatchOrderLines(order), receiptLines },
    );
    if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
    const invoice = resolved.value;

    const due = resolveDueDate(args.dueDate ?? payable.dueDate);
    if (!due.ok || due.value === undefined) throw new Error(due.reason);

    const recordedAt = Date.now();
    await ctx.db.patch(args.payableId, {
      invoice: {
        reference: invoice.reference,
        total: invoice.total,
        lines: invoice.lines.map((line) => ({
          productId: line.productId as Id<"products">,
          name: line.name,
          quantity: line.quantity,
          unitCost: line.unitCost,
        })),
        note: invoice.note,
        recordedById: args.actorId,
        recordedAt,
      },
      reference: invoice.reference ?? payable.reference,
      dueDate: due.value,
    });

    const match = matchPayable({
      orderLines: toMatchOrderLines(order),
      receiptLines,
      invoice: { ...invoice, recordedAt },
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "payable.invoice",
      entity: "payables",
      entityId: args.payableId,
      meta: {
        number: payable.number,
        reference: invoice.reference,
        total: invoice.total,
        received: match.receivedValue,
        flagged: match.flagged,
        variance: match.valueVariance,
        lines: invoice.lines.length,
      },
    });

    return {
      payableId: args.payableId,
      reference: invoice.reference ?? null,
      total: invoice.total,
      receivedValue: match.receivedValue,
      flagged: match.flagged,
      variance: match.valueVariance ?? 0,
      reasons: match.reasons,
    };
  },
});

/**
 * Keputusan manusia atas selisih pencocokan: **terima** (nilai hutang mengikuti
 * total tagihan supplier) atau **sengketa** (nilai tetap, pembayaran ditahan),
 * dan mencabut sengketa dengan `none`.
 */
export const resolveMatch = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    payableId: v.id("payables"),
    kind: v.union(v.literal("accepted"), v.literal("disputed"), v.literal("none")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireFeature(
      ctx,
      args.tenantId,
      args.actorId,
      "purchasing.threeway",
      "payable.manage",
    );

    const payable = await ctx.db.get(args.payableId);
    if (!payable || payable.tenantId !== args.tenantId) {
      throw new Error("Hutang tidak ditemukan untuk tenant ini.");
    }
    if (payable.status === "void") throw new Error("Tagihan ini sudah dibatalkan.");

    const { receipt, order } = await loadMatchContext(ctx, args.tenantId, payable);
    const match = matchOf({ payable, order, receipt });

    const current: MatchDecision | null = payable.matchDecision
      ? {
          kind: payable.matchDecision.kind,
          note: payable.matchDecision.note,
          decidedAt: payable.matchDecision.decidedAt,
        }
      : null;

    const resolved = resolveMatchDecision(
      { kind: args.kind, note: args.note },
      { current, hasVariance: match.flagged },
    );
    if (!resolved.ok) throw new Error(resolved.reason);
    const decision = resolved.value;

    const amountBefore = payable.amount;
    const amount = amountAfterDecision({
      currentAmount: payable.amount,
      paidAmount: payable.paidAmount,
      match,
      decision: decision ?? null,
    });

    await ctx.db.patch(args.payableId, {
      matchDecision: decision
        ? {
            kind: decision.kind,
            note: decision.note,
            decidedById: args.actorId,
            decidedAt: decision.decidedAt,
          }
        : undefined,
      amount,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "payable.match",
      entity: "payables",
      entityId: args.payableId,
      meta: {
        number: payable.number,
        decision: decision?.kind ?? "dicabut",
        note: decision?.note,
        variance: match.valueVariance,
        amountBefore,
        amountAfter: amount,
      },
    });

    return {
      kind: decision?.kind ?? null,
      amount,
      amountBefore,
      flagged: match.flagged,
      variance: match.valueVariance ?? 0,
    };
  },
});

/**
 * Membayar beberapa tagihan dalam satu kali bayar. **Tidak** digerbang fitur —
 * sama seperti pembayaran satuan: tagihan yang sudah tercatat harus tetap bisa
 * dilunasi, dan ini hanya cara yang lebih cepat untuk hal yang sama. Yang dijaga
 * tetap satu: setiap tagihan diperiksa `applyPayablePayment` (tanpa kelebihan
 * bayar) dan **tagihan bersengketa ditolak**.
 */
export const payBatch = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    method: paymentMethodValidator,
    note: v.optional(v.string()),
    payments: v.array(
      v.object({ payableId: v.id("payables"), amount: v.number() }),
    ),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "payable.manage");

    const loaded: BatchPayableLike[] = [];
    const docsById = new Map<string, Doc<"payables">>();
    const suppliers = await ctx.db
      .query("suppliers")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const supplierById = new Map(suppliers.map((row) => [row._id as string, row]));

    for (const request of args.payments) {
      const payable = await ctx.db.get(request.payableId);
      if (!payable || payable.tenantId !== args.tenantId) {
        throw new Error("Hutang tidak ditemukan untuk tenant ini.");
      }
      docsById.set(payable._id as string, payable);
      loaded.push({
        ...toPayableLike(payable),
        id: payable._id as string,
        number: payable.number,
        supplierName: supplierById.get(payable.supplierId as string)?.name,
        decision: payable.matchDecision
          ? {
              kind: payable.matchDecision.kind,
              note: payable.matchDecision.note,
              decidedAt: payable.matchDecision.decidedAt,
            }
          : null,
      });
    }

    const plan = planBatchPayment({
      payables: loaded,
      requests: args.payments.map((request) => ({
        payableId: request.payableId as string,
        amount: request.amount,
      })),
    });
    if (!plan.ok || !plan.value) throw new Error(plan.reason);

    const batchNumber = batchPaymentNumber(
      await nextSequence(ctx, args.tenantId, "paybatch"),
    );
    const note = args.note?.trim().slice(0, MAX_PAYABLE_NOTE) || undefined;
    const createdAt = Date.now();

    for (const row of plan.value.rows) {
      const payable = docsById.get(row.payableId);
      if (!payable) continue;
      await ctx.db.patch(payable._id, {
        paidAmount: payable.paidAmount + row.amount,
        status: row.fullyPaid ? "paid" : "open",
      });
      await ctx.db.insert("payablePayments", {
        tenantId: args.tenantId,
        payableId: payable._id,
        supplierId: payable.supplierId,
        amount: row.amount,
        method: args.method,
        note,
        batchNumber,
        actorId: args.actorId,
        createdAt,
      });
    }

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "payable.batch_payment",
      entity: "payables",
      entityId: plan.value.rows[0]?.payableId,
      meta: {
        batchNumber,
        total: plan.value.total,
        bills: plan.value.rows.length,
        fullyPaid: plan.value.fullyPaidCount,
        method: args.method,
      },
    });

    return {
      batchNumber,
      total: plan.value.total,
      fullyPaidCount: plan.value.fullyPaidCount,
      bills: plan.value.rows,
    };
  },
});

/**
 * Pengingat hutang jatuh tempo (`payable.due`) — dijalankan pekerja harian
 * (`crons.ts`).
 *
 * Inilah pemicu terakhir yang menggantung di katalog webhook: `payable.due`
 * hanya bisa dilanggan tetapi tidak pernah berangkat, karena keadaannya berubah
 * karena **waktu**, bukan karena transaksi. Tiga hal yang dijaga:
 *
 *  - **Diambil lewat indeks, bukan memindai tabel.** Kandidatnya dibaca dari
 *    `by_due` (`dueNotified = false` dan `dueDate` tidak lebih baru dari
 *    sekarang), lalu tiap baris diperiksa aturan murni `needsDueReminder` yang
 *    juga memastikan sisanya masih ada.
 *  - **Sekali per tagihan.** Penanda `dueNotified` dipasang begitu kirimannya
 *    ditulis, jadi tagihan yang sama tidak dikabarkan setiap hari; tagihan yang
 *    dibayar sebelum jatuh tempo terlewat karena sisanya 0.
 *  - **Tanpa gerbang fitur.** Pekerja hanya mengirim ke endpoint yang benar-benar
 *    melanggan `payable.due`; menghitung ulang paket di sini akan mematikan
 *    pengingat yang sedang berjalan tanpa memberi tahu siapa pun.
 */
export const notifyDuePayables = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.max(
      1,
      Math.min(DUE_REMINDER_BATCH, Math.floor(args.limit ?? DUE_REMINDER_BATCH)),
    );
    // Jendela 60 hari: lihat `DUE_REMINDER_WINDOW_MS` — tanpa batas bawah,
    // tagihan yang dibayar sebelum jatuh tempo (penandanya tetap `false`)
    // menumpuk di depan indeks dan membuat tagihan yang benar-benar jatuh tempo
    // kelaparan.
    const candidates = await ctx.db
      .query("payables")
      .withIndex("by_due", (q) =>
        q
          .eq("dueNotified", false)
          .gt("dueDate", now - DUE_REMINDER_WINDOW_MS)
          .lte("dueDate", now),
      )
      .take(limit);

    let reminded = 0;
    let enqueued = 0;
    for (const payable of candidates) {
      const like = toPayableLike(payable);
      if (!needsDueReminder({ ...like, dueNotified: payable.dueNotified }, now)) continue;

      const supplier = await ctx.db.get(payable.supplierId);
      enqueued += await enqueueWebhookEvent(ctx, {
        tenantId: payable.tenantId,
        storeId: payable.storeId,
        event: "payable.due",
        subject: payable.number,
        at: now,
        data: payableDueEventData({
          number: payable.number,
          supplierName: supplier?.name ?? "Supplier",
          amount: payable.amount,
          balance: payableBalance(like),
          dueDate: payable.dueDate,
          daysPastDue: Math.max(0, payableAging(like, now).daysPastDue),
          reference: payable.reference ?? null,
        }),
      });
      await ctx.db.patch(payable._id, { dueNotified: true });
      reminded += 1;
    }

    await scheduleWebhookDeliveryPass(ctx, enqueued);
    return { checked: candidates.length, reminded, enqueued };
  },
});

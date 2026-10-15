import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
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
import { PLANS } from "./lib/billing/catalog";
import {
  applyChargeAction,
  chargeLikeFrom,
  chargeNumber,
  expiryAtFor,
  expiryMinutesFor,
  qrPayload,
  remainingSeconds,
  statusOf,
  summariseCharges,
  validateChargeInput,
  virtualAccountNumber,
  DIGITAL_MAX_AMOUNT,
  DIGITAL_MIN_AMOUNT,
  DIGITAL_REFERENCE_MAX,
  DIGITAL_REASON_MAX,
  EXPIRING_SOON_SECONDS,
  QRIS_EXPIRY_MINUTES,
  VA_EXPIRY_MINUTES,
  type DigitalAction,
  type DigitalChargeLike,
  type DigitalMethod,
  type VaBank,
} from "./lib/digitalPayment";
import { digitalMethodValidator, vaBankValidator } from "./schema";

/**
 * Pembayaran digital (`payment.digital`, Phase 6).
 *
 * Satu tempat yang mengubah tabel `digitalCharges`. Aturannya ada di
 * lib/digitalPayment.ts (dipakai halaman & harness), jadi di sini hanya tiga hal
 * yang butuh database: membaca baris tenant, menjaga gerbang fitur/izin, dan
 * menulis audit.
 *
 * Gerbang fiturnya sengaja tidak seragam — pola yang sama dengan
 * `support.dedicated`, `api.access`, dan `rbac.custom`:
 *
 *  - **membuat tagihan baru** butuh fitur `payment.digital` (inilah kanal tagih
 *    yang dibeli);
 *  - **melunasi & membatalkan** selalu boleh. Uang pelanggan yang sudah di jalan
 *    harus tetap bisa dicatat masuk walau paket turun di tengah hari.
 */

const DIGITAL_ACTIONS = [v.literal("settle"), v.literal("cancel")] as const;

function toLike(charge: Doc<"digitalCharges">): DigitalChargeLike {
  // Bentuknya dari aturan bersama `@/lib/payments`, jadi backend dan kasir
  // membaca baris yang sama dengan cara yang sama.
  return chargeLikeFrom(charge);
}

function toRow(charge: Doc<"digitalCharges">, now: number) {
  const like = toLike(charge);
  return {
    id: charge._id as string,
    number: charge.number,
    method: charge.method as DigitalMethod,
    bank: (charge.bank as VaBank | undefined) ?? null,
    amount: charge.amount,
    reference: charge.reference ?? null,
    vaNumber: charge.vaNumber ?? null,
    qrPayload: charge.qrPayload ?? null,
    status: statusOf(like, now),
    expiresAt: charge.expiresAt,
    /** Penjualan yang dilunasi tagihan ini, kalau sudah ditagih dari kasir. */
    saleId: (charge.saleId as string | undefined) ?? null,
    saleNumber: charge.saleNumber ?? null,
    paidAmount: charge.paidAmount ?? null,
    paidAt: charge.paidAt ?? null,
    cancelReason: charge.cancelReason ?? null,
    cancelledAt: charge.cancelledAt ?? null,
    createdAt: charge.createdAt,
    updatedAt: charge.updatedAt,
    remainingSeconds: remainingSeconds(like, now),
  };
}

/**
 * Daftar tagihan beserta ringkasannya. Izin `payment.view` — kasir melihat
 * tagihan yang ia buat, keuangan melihat semuanya untuk rekonsiliasi.
 */
export const list = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "payment.view");

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    const entitlements = entitlementsForTenant(tenant);
    const digital = isFeatureEnabled(
      entitlements,
      tenant.verticals,
      "payment.digital",
    );

    const charges = await ctx.db
      .query("digitalCharges")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const now = Date.now();
    const rows = charges
      .map((charge) => toRow(charge, now))
      .sort((a, b) => b.createdAt - a.createdAt);

    return {
      charges: rows,
      summary: summariseCharges(charges.map(toLike), now),
      /** Apakah kanal tagih digital hidup untuk paket + modul tenant ini. */
      plan: { planKey: tenant.planKey, digital, planName: PLANS[tenant.planKey].name },
      limits: {
        minAmount: DIGITAL_MIN_AMOUNT,
        maxAmount: DIGITAL_MAX_AMOUNT,
        referenceMax: DIGITAL_REFERENCE_MAX,
        reasonMax: DIGITAL_REASON_MAX,
        expiringSoonSeconds: EXPIRING_SOON_SECONDS,
        qrisExpiryMinutes: QRIS_EXPIRY_MINUTES,
        vaExpiryMinutes: VA_EXPIRY_MINUTES,
      },
    };
  },
});

/**
 * Membuat tagihan baru. Nomor (`DIG-…`), nomor Virtual Account / payload QRIS,
 * dan tenggatnya ditetapkan server — klien tidak boleh menitipkan salah satunya.
 */
export const create = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    storeId: v.optional(v.id("stores")),
    amount: v.number(),
    method: digitalMethodValidator,
    bank: v.optional(vaBankValidator),
    reference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireFeature(
      ctx,
      args.tenantId,
      args.actorId,
      "payment.digital",
      "payment.manage",
    );

    const validation = validateChargeInput(
      {
        amount: args.amount,
        method: args.method,
        bank: args.bank ?? null,
        reference: args.reference,
      },
      { digital: true, planName: PLANS[tenant.planKey].name },
    );
    if (!validation.ok) throw new Error(validation.reason);
    const draft = validation.value;

    const now = Date.now();
    const sequence = await nextSequence(ctx, args.tenantId, "digital-charge");
    const number = chargeNumber(sequence, new Date(now).getFullYear());
    // Tenggat **dipatok** di baris tagihan: perubahan kebijakan umur tidak
    // mematikan tagihan yang sudah ditunjukkan ke pelanggan.
    const expiresAt = expiryAtFor(draft.method, now);

    const chargeId = await ctx.db.insert("digitalCharges", {
      tenantId: args.tenantId,
      storeId: args.storeId,
      number,
      method: draft.method,
      bank: draft.bank ?? undefined,
      amount: draft.amount,
      reference: draft.reference ?? undefined,
      vaNumber:
        draft.method === "va" && draft.bank
          ? virtualAccountNumber(draft.bank, sequence)
          : undefined,
      qrPayload:
        draft.method === "qris"
          ? qrPayload({ number, amount: draft.amount, merchantName: tenant.name })
          : undefined,
      status: "pending",
      expiresAt,
      createdById: args.actorId,
      createdAt: now,
      updatedAt: now,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "payment.create",
      entity: "digitalCharges",
      entityId: chargeId,
      meta: {
        number,
        method: draft.method,
        bank: draft.bank,
        amount: draft.amount,
        expiresAt,
      },
    });

    return {
      chargeId,
      number,
      expiresAt,
      expiryMinutes: expiryMinutesFor(draft.method),
    };
  },
});

/**
 * Melunasi (`settle`) atau membatalkan (`cancel`) sebuah tagihan.
 *
 * Gerbang fitur **sengaja tidak dipasang** di sini: menandai lunas dan
 * membatalkan tagihan yang masih menunggu selalu boleh, supaya penurunan paket
 * tidak mengunci uang yang sudah masuk. Perubahan statusnya sendiri divalidasi
 * aturan murni, jadi tidak ada lompatan status yang bisa dititipkan lewat
 * argumen.
 */
export const act = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    chargeId: v.id("digitalCharges"),
    action: v.union(...DIGITAL_ACTIONS),
    /** Wajib sama dengan nominal tagihan saat `settle`. */
    amount: v.optional(v.number()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "payment.manage");

    const charge = await ctx.db.get(args.chargeId);
    if (!charge || charge.tenantId !== args.tenantId) {
      throw new Error("Tagihan pembayaran tidak ditemukan untuk tenant ini.");
    }

    const now = Date.now();
    const patch = applyChargeAction(toLike(charge), args.action as DigitalAction, {
      now,
      amount: args.amount,
      reason: args.reason,
    });
    if (!patch.ok) throw new Error(patch.reason);
    const value = patch.value;

    await ctx.db.patch(charge._id, {
      status: value.status,
      paidAmount: value.paidAmount ?? undefined,
      paidAt: value.paidAt ?? undefined,
      cancelReason: value.cancelReason ?? undefined,
      cancelledAt: value.cancelledAt ?? undefined,
      updatedAt: now,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: `payment.${args.action}`,
      entity: "digitalCharges",
      entityId: charge._id,
      meta: {
        number: charge.number,
        before: charge.status,
        after: value.status,
        amount: value.paidAmount,
      },
    });

    // Tagihan pesanan QR meja yang lunas mengubah pesanannya menjadi penjualan
    // tertahan (tiket dapur) di titik ini juga — apa pun halaman yang melunasinya
    // (halaman Pembayaran atau kartu pesanan QR di layar dapur). Satu pelunasan
    // tidak boleh melewatkan penjualannya.
    if (value.status === "paid") {
      await ctx.runMutation(internal.meja.guestOrderPaid, {
        chargeId: charge._id,
      });
    }

    return {
      chargeId: charge._id,
      status: value.status,
      paidAt: value.paidAt,
      paidAmount: value.paidAmount,
    };
  },
});

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  getTenantOrThrow,
  nextSequence,
  requirePermission,
  writeAuditLog,
} from "./lib/access";
import {
  addBillingPeriod,
  computeProration,
  computeTax,
  entitlementFor,
  entitlementsDelta,
  formatInvoiceNumber,
  PLANS,
  trimVerticalsForPlan,
} from "./lib/billing/index";
import { effectiveTaxRatePct, taxSettingOf } from "./lib/tax";
import { planKeyValidator } from "./schema";

const providerValidator = v.union(
  v.literal("xendit"),
  v.literal("gdcpay"),
  v.literal("manual"),
);

/**
 * The SaaS subscription engine is owned here, not by the payment gateway.
 * Xendit/GDCPay only confirm money movement; lifecycle, entitlement and
 * invoice numbering are computed by this backend.
 */

export const currentSummary = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "billing.manage");

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    const invoices = await ctx.db
      .query("subscriptionInvoices")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const open = invoices.filter((i) => i.status === "open");
    const outstanding = open.reduce((sum, i) => sum + i.gross, 0);

    return {
      planKey: tenant.planKey,
      planVersion: tenant.planVersion,
      status: tenant.status,
      currentPeriodEnd: tenant.currentPeriodEnd ?? null,
      trialEndsAt: tenant.trialEndsAt ?? null,
      invoiceCount: invoices.length,
      outstanding,
      openInvoices: open.length,
    };
  },
});

export const listInvoices = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    // Who owes what — finance and the owner only.
    await requirePermission(ctx, args.tenantId, args.actorId, "billing.manage");

    const invoices = await ctx.db
      .query("subscriptionInvoices")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    return invoices.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Issues the next recurring invoice for the tenant's current plan. */
export const createInvoice = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    provider: v.optional(providerValidator),
  },
  handler: async (ctx, args) => {
    // Bills the tenant money — never allowed for a cashier or warehouse role.
    await requirePermission(ctx, args.tenantId, args.actorId, "billing.manage");

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    const plan = PLANS[tenant.planKey];
    const net = plan.price?.monthly ?? 0;

    const periodStart = tenant.currentPeriodEnd ?? Date.now();
    const periodEnd = addBillingPeriod(new Date(periodStart), "monthly").getTime();
    // Satu setelan PPN untuk seluruh dokumen workspace (lihat `lib/tax.ts`):
    // workspace yang mematikan PPN tidak dipungut PPN di tagihan langganannya juga.
    const taxed = computeTax(net, effectiveTaxRatePct(taxSettingOf(tenant)));

    const sequence = await nextSequence(ctx, args.tenantId, "invoice");
    const number = formatInvoiceNumber({
      tenantSlug: tenant.slug,
      sequence,
      issuedAt: new Date(),
    });

    const invoiceId = await ctx.db.insert("subscriptionInvoices", {
      tenantId: args.tenantId,
      number,
      periodStart,
      periodEnd,
      net: taxed.net,
      tax: taxed.tax,
      gross: taxed.gross,
      status: "open",
      provider: args.provider ?? "xendit",
      createdAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "invoice.create",
      entity: "subscriptionInvoices",
      entityId: invoiceId,
      meta: { number, gross: taxed.gross },
    });

    return { invoiceId, number, net: taxed.net, tax: taxed.tax, gross: taxed.gross };
  },
});

/**
 * Marks an invoice paid and advances the subscription period. Providers call
 * this through the webhook handler; it is intentionally not client-callable.
 */
export const confirmPayment = internalMutation({
  args: {
    invoiceNumber: v.string(),
    provider: providerValidator,
    providerRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db
      .query("subscriptionInvoices")
      .withIndex("by_number", (q) => q.eq("number", args.invoiceNumber))
      .unique();
    if (!invoice) throw new Error(`Invoice ${args.invoiceNumber} tidak ditemukan.`);

    if (invoice.status === "paid") {
      return { invoiceId: invoice._id, alreadyPaid: true };
    }

    const paidAt = Date.now();
    await ctx.db.patch(invoice._id, {
      status: "paid",
      paidAt,
      provider: args.provider,
      providerRef: args.providerRef,
    });

    await ctx.db.patch(invoice.tenantId, {
      status: "active",
      currentPeriodEnd: invoice.periodEnd,
    });

    await writeAuditLog(ctx, {
      tenantId: invoice.tenantId,
      action: "invoice.paid",
      entity: "subscriptionInvoices",
      entityId: invoice._id,
      meta: { provider: args.provider, providerRef: args.providerRef },
    });

    return { invoiceId: invoice._id, alreadyPaid: false };
  },
});

/** Idempotency ledger for provider webhooks — duplicate deliveries are no-ops. */
export const ingestWebhook = internalMutation({
  args: {
    provider: v.string(),
    eventId: v.string(),
    type: v.string(),
    payload: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("webhookEvents")
      .withIndex("by_provider_event", (q) =>
        q.eq("provider", args.provider).eq("eventId", args.eventId),
      )
      .unique();

    if (existing) return { duplicate: true as const, eventId: existing._id };

    const eventId = await ctx.db.insert("webhookEvents", {
      provider: args.provider,
      eventId: args.eventId,
      type: args.type,
      payload: args.payload,
      receivedAt: Date.now(),
    });

    return { duplicate: false as const, eventId };
  },
});

/**
 * Upgrade/downgrade with mid-cycle proration. Gateway APIs do not compute
 * proration, so it is calculated here from the plan catalog.
 */
export const changePlan = mutation({
  args: {
    tenantId: v.id("tenants"),
    newPlanKey: planKeyValidator,
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "billing.manage");

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    if (tenant.planKey === args.newPlanKey) {
      // Bentuk hasilnya sengaja sama dengan jalur yang benar-benar berubah
      // (`gained`/`lost` kosong) supaya klien tidak perlu menebak field yang ada.
      return {
        changed: false,
        planKey: tenant.planKey,
        gained: [],
        lost: [],
        proration: null,
      };
    }

    const fromPlan = PLANS[tenant.planKey];
    const toPlan = PLANS[args.newPlanKey];

    let proration = null;
    if (fromPlan.price && toPlan.price) {
      const periodEnd = tenant.currentPeriodEnd ?? Date.now() + 30 * 86_400_000;
      const periodStart = periodEnd - 30 * 86_400_000;
      proration = computeProration({
        oldPrice: fromPlan.price.monthly,
        newPrice: toPlan.price.monthly,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        changeAt: new Date(),
      });
    }

    // Modul yang tidak ada di paket baru dibuang. Aturannya satu tempat
    // (`trimVerticalsForPlan`) karena klien memakai yang sama untuk menyelaraskan
    // sesi setelah pindah paket.
    const nextEntitlements = entitlementFor(args.newPlanKey);
    const nextVerticals = trimVerticalsForPlan(
      args.newPlanKey,
      tenant.verticals,
    );

    await ctx.db.patch(args.tenantId, {
      planKey: args.newPlanKey,
      planVersion: toPlan.version,
      verticals: nextVerticals,
    });

    const delta = entitlementsDelta(
      entitlementFor(fromPlan.key),
      nextEntitlements,
    );

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "subscription.changePlan",
      entity: "tenants",
      entityId: args.tenantId,
      meta: {
        from: fromPlan.key,
        to: args.newPlanKey,
        gained: delta.gained,
        lost: delta.lost,
        proration,
      },
    });

    return {
      changed: true,
      from: fromPlan.key,
      planKey: args.newPlanKey,
      gained: delta.gained,
      lost: delta.lost,
      proration,
    };
  },
});

/** Marks a tenant past_due/suspended based on the clock (called by a cron). */
export const sweepDelinquent = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const tenants = await ctx.db.query("tenants").collect();
    const overdue = tenants.filter(
      (t) =>
        (t.status === "active" || t.status === "past_due") &&
        (t.currentPeriodEnd ?? 0) > 0 &&
        (t.currentPeriodEnd ?? 0) < now,
    );

    const updates: { tenantId: string; status: string }[] = [];
    for (const tenant of overdue) {
      const overdueDays = Math.floor(
        (now - (tenant.currentPeriodEnd ?? now)) / 86_400_000,
      );
      const next = overdueDays > tenant.graceDays ? "suspended" : "past_due";
      if (next !== tenant.status) {
        await ctx.db.patch(tenant._id, { status: next });
        updates.push({ tenantId: tenant._id, status: next });
      }
    }

    return { scanned: tenants.length, updated: updates.length, updates };
  },
});

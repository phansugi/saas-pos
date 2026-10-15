import { v } from "convex/values";
import { query } from "./_generated/server";
import {
  accessForTenant,
  entitlementsForTenant,
  getTenantOrThrow,
  requireMembership,
} from "./lib/access";
import { FEATURE_LABELS } from "./lib/billing/index";
import { taxIsActive } from "./lib/tax";
import { fnbTaxProfileOf } from "./lib/fnbTax";

/**
 * The single source of truth the client uses to gate UI. Both the web dashboard
 * and the mobile POS read this — a feature is never enabled purely because the
 * client says so.
 */
export const getForTenant = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    // Plan, trial clock and usage counts are tenant business data.
    await requireMembership(ctx, args.tenantId, args.actorId);

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    const entitlements = entitlementsForTenant(tenant);
    const access = accessForTenant(tenant);

    const [devices, stores, products, memberships] = await Promise.all([
      ctx.db
        .query("devices")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
      ctx.db
        .query("stores")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
      ctx.db
        .query("products")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
      ctx.db
        .query("memberships")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
    ]);

    return {
      planKey: tenant.planKey,
      planVersion: entitlements.planVersion,
      status: tenant.status,
      currency: tenant.currency,
      taxRatePct: tenant.taxRatePct,
      /** Tenant lama tanpa kolom ini dianggap memungut PPN (lihat `lib/tax.ts`). */
      taxActive: taxIsActive(tenant),
      /**
       * Setelan pajak & pungutan F&B. Selalu dikembalikan dalam bentuk lengkap
       * (baris tenant yang belum menyimpannya dibaca sebagai bawaan: belum ada
       * pungutan F&B), jadi klien tidak perlu tahu soal bidang yang kosong.
       */
      fnbTaxProfile: fnbTaxProfileOf(tenant.fnbTaxProfile),
      trialEndsAt: tenant.trialEndsAt ?? null,
      currentPeriodEnd: tenant.currentPeriodEnd ?? null,
      access,
      features: Array.from(entitlements.features).map((key) => ({
        key,
        label: FEATURE_LABELS[key],
        enabled: true,
      })),
      limits: entitlements.limits,
      verticals: entitlements.verticals,
      verticalLimit: entitlements.verticalLimit,
      usage: {
        devices: devices.filter((d) => !d.revoked).length,
        stores: stores.filter((s) => s.active).length,
        products: products.filter((p) => p.active).length,
        users: memberships.filter((m) => m.active).length,
      },
    };
  },
});

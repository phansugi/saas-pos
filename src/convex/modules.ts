/**
 * Vertical plug-in module API — Phase 2.
 *
 * The client never decides which modules are live: `setForTenant` re-validates
 * the selection against the plan catalog (allowed modules + `verticalLimit`)
 * before it writes `tenants.verticals`, and `getForTenant` is the single place
 * the Modul page reads its state from. Both require an actor, so a stranger can
 * neither read nor switch a tenant's modules.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  entitlementsForTenant,
  getTenantOrThrow,
  requireMembership,
  requirePermission,
  writeAuditLog,
} from "./lib/access";
import {
  FEATURE_LABELS,
  moduleSummary,
  resolveModuleSelection,
  VERTICAL_LABELS,
  type ModuleDefinition,
} from "./lib/billing/index";
import { verticalValidator } from "./schema";

/** Bentuk kartu modul yang dikirim ke klien (tanpa perlu impor katalog). */
function toCard(module: ModuleDefinition) {
  return {
    vertical: module.vertical,
    name: module.name,
    tagline: module.tagline,
    description: module.description,
    features: module.features.map((feature) => ({
      key: feature,
      label: FEATURE_LABELS[feature],
    })),
  };
}

/**
 * Everything the Modul page needs: which modules are live, which the plan can
 * still activate, which are locked behind a higher plan, and which paid-for
 * features are waiting on a module.
 */
export const getForTenant = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.tenantId, args.actorId);

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    const entitlements = entitlementsForTenant(tenant);
    const summary = moduleSummary(entitlements, tenant.verticals);

    return {
      planKey: summary.planKey,
      planName: summary.planName,
      limit: summary.limit,
      /** Dibaca apa adanya supaya UI bisa menandai modul aktif. */
      verticals: tenant.verticals,
      active: summary.active.map(toCard),
      available: summary.available.map(toCard),
      locked: summary.locked.map((module) => ({
        ...toCard(module),
        reason: `Tidak termasuk paket ${summary.planName}.`,
      })),
      blocked: summary.blocked.map((entry) => ({
        feature: entry.feature,
        label: FEATURE_LABELS[entry.feature],
        vertical: entry.module.vertical,
        moduleName: entry.module.name,
      })),
    };
  },
});

/**
 * Switch modules on and off. Requires `billing.manage` (owner / finance), and
 * refuses a selection that names an unknown module, drops every module, uses a
 * module the plan does not include, or exceeds the plan's module limit.
 */
export const setForTenant = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    verticals: v.array(verticalValidator),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "billing.manage");

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    const entitlements = entitlementsForTenant(tenant);
    const selection = resolveModuleSelection(entitlements, args.verticals);
    if (!selection.ok) {
      throw new Error(selection.reason ?? "Pilihan modul tidak valid.");
    }

    const before = tenant.verticals;
    const added = selection.selected.filter((value) => !before.includes(value));
    const removed = before.filter((value) => !selection.selected.includes(value));

    // Menulis hanya kalau berubah, supaya audit log tidak penuh entri kosong.
    if (added.length > 0 || removed.length > 0) {
      await ctx.db.patch(args.tenantId, { verticals: selection.selected });
      await writeAuditLog(ctx, {
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: "modules.set",
        entity: "tenants",
        entityId: args.tenantId,
        meta: { before, after: selection.selected },
      });
    }

    return {
      verticals: selection.selected,
      added: added.map((vertical) => VERTICAL_LABELS[vertical]),
      removed: removed.map((vertical) => VERTICAL_LABELS[vertical]),
    };
  },
});

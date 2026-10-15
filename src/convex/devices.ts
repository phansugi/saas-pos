import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  entitlementsForTenant,
  getTenantOrThrow,
  requirePermission,
  writeAuditLog,
} from "./lib/access";
import { isWithinLimit } from "./lib/billing/index";

/**
 * Device registry. The per-plan device limit is enforced on registration so a
 * Starter tenant cannot simply install the terminal on a second till.
 */

export const register = mutation({
  args: {
    tenantId: v.id("tenants"),
    name: v.string(),
    fingerprint: v.string(),
    storeId: v.optional(v.id("stores")),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "device.manage");

    const tenant = await getTenantOrThrow(ctx, args.tenantId);

    const existing = await ctx.db
      .query("devices")
      .withIndex("by_tenant_fingerprint", (q) =>
        q.eq("tenantId", args.tenantId).eq("fingerprint", args.fingerprint),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeenAt: Date.now(),
        revoked: false,
        name: args.name,
      });
      return { deviceId: existing._id, created: false };
    }

    const devices = await ctx.db
      .query("devices")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const activeCount = devices.filter((d) => !d.revoked).length;

    const entitlements = entitlementsForTenant(tenant);
    if (!isWithinLimit(entitlements, "devices", activeCount)) {
      throw new Error(
        `Batas perangkat paket ${tenant.planKey} tercapai (${activeCount}). Upgrade paket untuk menambah kasir.`,
      );
    }

    const deviceId = await ctx.db.insert("devices", {
      tenantId: args.tenantId,
      storeId: args.storeId,
      name: args.name,
      fingerprint: args.fingerprint,
      lastSeenAt: Date.now(),
      revoked: false,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      action: "device.register",
      entity: "devices",
      entityId: deviceId,
      meta: { name: args.name },
    });

    return { deviceId, created: true };
  },
});

export const heartbeat = mutation({
  args: { deviceId: v.id("devices") },
  handler: async (ctx, args) => {
    const device = await ctx.db.get(args.deviceId);
    if (!device) throw new Error("Perangkat tidak dikenal.");
    await ctx.db.patch(args.deviceId, { lastSeenAt: Date.now() });
    return { ok: true };
  },
});

export const revoke = mutation({
  args: { deviceId: v.id("devices"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    const device = await ctx.db.get(args.deviceId);
    if (!device) throw new Error("Perangkat tidak ditemukan.");

    // Killing a till is a privileged action, not something any caller may do.
    await requirePermission(ctx, device.tenantId, args.actorId, "device.manage");

    await ctx.db.patch(args.deviceId, { revoked: true });
    await writeAuditLog(ctx, {
      tenantId: device.tenantId,
      actorId: args.actorId,
      action: "device.revoke",
      entity: "devices",
      entityId: args.deviceId,
    });
    return { ok: true };
  },
});

export const list = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "device.manage");

    const devices = await ctx.db
      .query("devices")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    return devices.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  },
});

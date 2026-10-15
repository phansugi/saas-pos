import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  entitlementsForTenant,
  getTenantOrThrow,
  nextSequence,
  requireFeature,
  requireMembership,
  requirePermission,
  writeAuditLog,
} from "./lib/access";
import { isFeatureEnabled, isWithinLimit } from "./lib/billing";
import { PLANS } from "./lib/billing/catalog";
import {
  decidePush,
  idleSeconds,
  laggingDevices,
  MAX_CHANGES_PER_PULL,
  MAX_CLOCK_SKEW_MS,
  presenceState,
  pullWindow,
  resolvePullLimit,
  summariseSync,
  validatePushInput,
  validateSyncDevice,
  SYNC_ENTITY_KEYS,
  SYNC_ENTITY_LABELS,
  SYNC_FINGERPRINT_MAX,
  SYNC_LABEL_MAX,
  SYNC_PAYLOAD_MAX,
  SYNC_PLATFORM_LABELS,
  ONLINE_WINDOW_MS,
  IDLE_WINDOW_MS,
  type PresenceState,
  type PushOutcome,
  type SyncEntity,
  type SyncPlatform,
} from "./lib/realtimeSync";
import { syncPlatformValidator } from "./schema";

/**
 * Sinkronisasi real-time multi-perangkat (`sync.realtime`, Phase 6).
 *
 * Satu tempat yang menulis log `syncChanges`. Aturannya ada di
 * lib/realtimeSync.ts (dipakai halaman & harness), jadi di sini hanya empat hal
 * yang butuh database: membaca perangkat & log, menjaga gerbang fitur/izin,
 * menaikkan revisi lewat counter tenant, dan menulis audit.
 *
 * Gerbang fiturnya mengikuti pola fitur enterprise lain:
 *
 *  - **mendaftarkan perangkat ke hub real-time** dan **mendorong perubahan
 *    baru** butuh fitur `sync.realtime` (inilah yang dibeli);
 *  - **menarik perubahan, mendetak, dan menandai konflik selesai** selalu boleh.
 *    Perangkat yang kehilangan fiturnya tetap bisa mengosongkan perubahan
 *    terakhirnya dan membereskan konflik yang sudah terbuka.
 */

/** Perubahan terbaru yang dibaca satu kali untuk papan sinkronisasi. */
export const MAX_BOARD_CHANGES = 100;

const REVISION_COUNTER = "sync-revision";

/**
 * Revisi tertinggi tenant. Dibaca langsung dari counter (bukan dari baris log),
 * supaya angkanya tetap benar walau log-nya dipotong jendela tampilan.
 */
async function currentRevision(
  ctx: QueryCtx | MutationCtx,
  tenantId: Doc<"tenants">["_id"],
): Promise<number> {
  const counter = await ctx.db
    .query("counters")
    .withIndex("by_tenant_key", (q) =>
      q.eq("tenantId", tenantId).eq("key", REVISION_COUNTER),
    )
    .unique();
  return counter?.value ?? 0;
}

function deviceRow(
  device: Doc<"devices">,
  ownRevision: number,
  now: number,
) {
  return {
    deviceId: device._id as string,
    name: device.name,
    fingerprint: device.fingerprint,
    platform: (device.platform as SyncPlatform | undefined) ?? "web",
    lastSeenAt: device.lastSeenAt,
    revoked: device.revoked,
    presence: presenceState(device.lastSeenAt, now) as PresenceState,
    idleSeconds: idleSeconds(device.lastSeenAt, now),
    revision: ownRevision,
  };
}

function changeRow(change: Doc<"syncChanges">) {
  return {
    id: change._id as string,
    revision: change.revision,
    deviceId: change.deviceId,
    deviceName: change.deviceName,
    platform: change.platform as SyncPlatform,
    entity: change.entity as SyncEntity,
    entityId: change.entityId,
    baseRevision: change.baseRevision,
    outcome: change.outcome as PushOutcome,
    reason: change.reason ?? null,
    payload: change.payload,
    updatedAt: change.updatedAt,
    conflict: change.conflict,
    resolvedAt: change.resolvedAt ?? null,
    createdAt: change.createdAt,
  };
}

/**
 * Papan sinkronisasi: perangkat beserta kehadirannya, kursor tiap perangkat, dan
 * jendela perubahan terbaru beserta konfliknya. Izin `device.manage` — hub ini
 * mengelola perangkat, bukan penjualan.
 */
export const board = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "device.manage");

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    const realtime = isFeatureEnabled(
      entitlementsForTenant(tenant),
      tenant.verticals,
      "sync.realtime",
    );

    const devices = await ctx.db
      .query("devices")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const now = Date.now();
    // Kursor tiap perangkat dibaca dari revisi terakhir yang ia dorong; satu
    // pembacaan berindeks per perangkat, bukan pemindaian seluruh log.
    const rows = await Promise.all(
      devices.map(async (device) => {
        const latest = await ctx.db
          .query("syncChanges")
          .withIndex("by_tenant_device", (q) =>
            q.eq("tenantId", args.tenantId).eq("deviceId", device.fingerprint),
          )
          .order("desc")
          .first();
        return deviceRow(device, latest?.revision ?? 0, now);
      }),
    );
    rows.sort((a, b) => b.lastSeenAt - a.lastSeenAt);

    const changes = await ctx.db
      .query("syncChanges")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(MAX_BOARD_CHANGES);

    const latestRevision = await currentRevision(ctx, args.tenantId);
    const windowed = changes.map(changeRow);

    return {
      devices: rows,
      changes: windowed,
      latestRevision,
      summary: summariseSync(rows, windowed, now),
      lagging: laggingDevices(rows, latestRevision, now).map((d) => d.deviceId),
      /** Jendela tampilan dibatasi; jumlah baris log yang dibaca dilaporkan. */
      windowChanges: windowed.length,
      plan: {
        planKey: tenant.planKey,
        realtime,
        planName: PLANS[tenant.planKey].name,
      },
      limits: {
        maxChangesPerPull: MAX_CHANGES_PER_PULL,
        maxBoardChanges: MAX_BOARD_CHANGES,
        maxPayload: SYNC_PAYLOAD_MAX,
        maxClockSkewMs: MAX_CLOCK_SKEW_MS,
        onlineWindowMs: ONLINE_WINDOW_MS,
        idleWindowMs: IDLE_WINDOW_MS,
        maxLabel: SYNC_LABEL_MAX,
        maxFingerprint: SYNC_FINGERPRINT_MAX,
      },
      entities: SYNC_ENTITY_KEYS.map((key) => ({
        key,
        label: SYNC_ENTITY_LABELS[key],
      })),
      platforms: (Object.keys(SYNC_PLATFORM_LABELS) as SyncPlatform[]).map((key) => ({
        key,
        label: SYNC_PLATFORM_LABELS[key],
      })),
    };
  },
});

/**
 * Satu giliran tarik: perubahan berrevisi **lebih besar** dari kursor, urut naik.
 * Selalu boleh (tanpa gerbang fitur) supaya perangkat yang kehilangan fiturnya
 * masih bisa menyusul ketinggalannya.
 */
export const changes = query({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    cursor: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "device.manage");

    // Batasnya dinormalkan lebih dulu supaya klien tidak bisa meminta seluruh
    // riwayat sekaligus lewat satu tarikan.
    const limit = resolvePullLimit(args.limit);
    const rows = await ctx.db
      .query("syncChanges")
      .withIndex("by_tenant_revision", (q) =>
        q.eq("tenantId", args.tenantId).gt("revision", args.cursor),
      )
      .order("asc")
      .take(limit + 1);

    const window = pullWindow(rows, args.cursor, limit);
    return {
      items: window.items.map(changeRow),
      nextCursor: window.nextCursor,
      hasMore: window.hasMore,
      latestRevision: await currentRevision(ctx, args.tenantId),
    };
  },
});

/**
 * Mendaftarkan perangkat ke hub real-time. Inilah tindakan yang dibeli fitur
 * `sync.realtime`; batas perangkat paket tetap ditegakkan seperti registry
 * perangkat biasa (`limits.devices`).
 */
export const register = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    label: v.string(),
    platform: syncPlatformValidator,
    fingerprint: v.string(),
    storeId: v.optional(v.id("stores")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireFeature(
      ctx,
      args.tenantId,
      args.actorId,
      "sync.realtime",
      "device.manage",
    );

    const validation = validateSyncDevice({
      label: args.label,
      platform: args.platform,
      fingerprint: args.fingerprint,
    });
    if (!validation.ok) throw new Error(validation.reason);
    const draft = validation.value;

    const existing = await ctx.db
      .query("devices")
      .withIndex("by_tenant_fingerprint", (q) =>
        q.eq("tenantId", args.tenantId).eq("fingerprint", draft.fingerprint),
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeenAt: now,
        revoked: false,
        name: draft.label,
        platform: draft.platform,
      });
      return { deviceId: existing._id, name: draft.label, created: false };
    }

    const devices = await ctx.db
      .query("devices")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const activeCount = devices.filter((device) => !device.revoked).length;
    if (!isWithinLimit(entitlementsForTenant(tenant), "devices", activeCount)) {
      throw new Error(
        `Batas perangkat paket ${PLANS[tenant.planKey].name} tercapai (${activeCount}). Naikkan paket untuk menyambungkan kasir lain.`,
      );
    }

    const deviceId = await ctx.db.insert("devices", {
      tenantId: args.tenantId,
      storeId: args.storeId,
      name: draft.label,
      fingerprint: draft.fingerprint,
      platform: draft.platform,
      lastSeenAt: now,
      revoked: false,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "sync.register",
      entity: "devices",
      entityId: deviceId,
      meta: { label: draft.label, platform: draft.platform },
    });

    return { deviceId, name: draft.label, created: true };
  },
});

/**
 * Detak satu perangkat. Sengaja **tidak** menuntut `device.manage`: kasir yang
 * membuka aplikasinya harus bisa melaporkan kehadiran tanpa izin mengelola
 * perangkat. Yang diperiksa adalah keanggotaan tenant dan kepemilikan perangkat.
 */
export const heartbeat = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    deviceId: v.id("devices"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.tenantId, args.actorId);

    const device = await ctx.db.get(args.deviceId);
    if (!device || device.tenantId !== args.tenantId) {
      throw new Error("Perangkat tidak ditemukan untuk tenant ini.");
    }
    if (device.revoked) throw new Error("Perangkat sudah dicabut.");

    const now = Date.now();
    await ctx.db.patch(device._id, { lastSeenAt: now });
    return { deviceId: device._id as string, lastSeenAt: now };
  },
});

/**
 * Mendorong satu perubahan. Revisinya naik satu-satu per tenant, dan
 * penyelesaian konfliknya memakai aturan murni `decidePush` — jadi perangkat
 * kedua tidak bisa menimpa perangkat pertama diam-diam.
 */
export const push = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    deviceFingerprint: v.string(),
    deviceName: v.string(),
    platform: syncPlatformValidator,
    entity: v.string(),
    entityId: v.string(),
    baseRevision: v.number(),
    updatedAt: v.number(),
    payload: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireFeature(
      ctx,
      args.tenantId,
      args.actorId,
      "sync.realtime",
      "device.manage",
    );

    const validation = validatePushInput({
      entity: args.entity,
      entityId: args.entityId,
      payload: args.payload,
    });
    if (!validation.ok) throw new Error(validation.reason);
    const draft = validation.value;

    const now = Date.now();

    // Perubahan terakhir pada entitas ini: equality pada tiga kolom indeks,
    // urut revisi menurun — bukan memindai seluruh log.
    const latest = await ctx.db
      .query("syncChanges")
      .withIndex("by_tenant_entity", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("entity", draft.entity)
          .eq("entityId", draft.entityId),
      )
      .order("desc")
      .first();

    const decision = decidePush({
      baseRevision: args.baseRevision,
      entityRevision: latest ? latest.revision : null,
      localUpdatedAt: args.updatedAt,
      serverUpdatedAt: latest ? latest.updatedAt : null,
      localDeviceId: args.deviceFingerprint,
      serverDeviceId: latest ? latest.deviceId : null,
      now,
    });
    if (!decision.ok) throw new Error(decision.reason);
    const outcome = decision.value.outcome;

    // `nextSequence` sudah menaikkan counter dan mengembalikan nilai barunya;
    // memakai `nextRevision` lagi di sini akan melompati satu nomor revisi.
    const revision = await nextSequence(ctx, args.tenantId, REVISION_COUNTER);

    const changeId = await ctx.db.insert("syncChanges", {
      tenantId: args.tenantId,
      revision,
      deviceId: args.deviceFingerprint,
      deviceName: args.deviceName,
      platform: args.platform,
      entity: draft.entity,
      entityId: draft.entityId,
      baseRevision: args.baseRevision,
      outcome,
      reason: decision.value.reason ?? undefined,
      payload: draft.payload,
      updatedAt: args.updatedAt,
      conflict: outcome !== "applied",
      createdById: args.actorId,
      createdAt: now,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "sync.push",
      entity: "syncChanges",
      entityId: changeId,
      meta: {
        revision,
        entity: draft.entity,
        entityId: draft.entityId,
        baseRevision: args.baseRevision,
        outcome,
      },
    });

    return {
      changeId,
      revision,
      outcome,
      reason: decision.value.reason,
      planName: PLANS[tenant.planKey].name,
    };
  },
});

/**
 * Menandai konflik selesai. Tanpa gerbang fitur: konflik yang sudah terbuka harus
 * bisa dibereskan walau paketnya berubah.
 */
export const resolve = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    changeId: v.id("syncChanges"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "device.manage");

    const change = await ctx.db.get(args.changeId);
    if (!change || change.tenantId !== args.tenantId) {
      throw new Error("Perubahan sinkronisasi tidak ditemukan untuk tenant ini.");
    }
    if (!change.conflict) {
      throw new Error("Perubahan ini tidak tercatat sebagai konflik.");
    }
    if (change.resolvedAt !== undefined) {
      throw new Error("Konflik ini sudah ditandai selesai.");
    }

    const now = Date.now();
    await ctx.db.patch(change._id, { resolvedAt: now });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "sync.resolve",
      entity: "syncChanges",
      entityId: change._id,
      meta: { revision: change.revision, outcome: change.outcome },
    });

    return { changeId: change._id, resolvedAt: now };
  },
});

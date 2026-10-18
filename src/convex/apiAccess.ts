import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  requireFeature,
  requirePermission,
  resolveMembershipPermissions,
  writeAuditLog,
} from "./lib/access";
import type { Permission } from "./lib/authz";
import {
  API_KEY_EXPIRY_OPTIONS,
  keyStatus,
  maskApiKey,
  mintApiKey,
  parseApiKey,
  randomToken,
  sanitizeApiScopes,
  scopeAllowed,
  validateApiKeyInput,
  verifyApiKey,
  API_KEY_SECRET_ALPHABET,
  API_KEY_SECRET_LENGTH,
  API_SCOPES,
  resourceScope,
} from "./lib/apiKeys";
import {
  MAX_WEBHOOK_ENDPOINTS,
  deliveryOutcome,
  nextDeliveryAttemptAt,
  retryBatchLimit,
  retryStopReason,
  sampleDeliveryEvent,
  sampleDeliveryPayload,
  sanitizeWebhookEvents,
  validateWebhookEndpoint,
  webhookDeliveryHeaders,
} from "./lib/webhooks";
import { paymentMethodValidator, permissionValidator } from "./schema";

/**
 * Akses API & webhook keluar (`api.access`, Phase 4 / Enterprise Intelligence).
 *
 * Satu modul untuk dua hal yang saling melengkapi:
 *
 *  - **Kunci API** untuk endpoint HTTP `/api/v1/*` (lihat `http.ts`). Rahasia
 *    kunci tidak pernah disimpan; yang ada hanya hash-nya, dan scope-nya tidak
 *    boleh melebihi izin pembuatnya *saat ini* — kunci yang dibuat manajer ikut
 *    menyempit begitu perannya berubah.
 *  - **Webhook keluar**: endpoint langganan event, rahasia penanda tangan, dan
 *    riwayat kiriman dengan jadwal percobaan ulang.
 *
 * Gerbang fiturnya tidak seragam, sama pola dengan peran kustom: **membuat**
 * kunci/endpoint dan **mengubah** langganannya butuh `api.access`, sedangkan
 * **mencabut kunci**, **menonaktifkan/menghapus endpoint**, dan **melihat**
 * daftarnya selalu boleh. Mencabut akses tidak boleh pernah tertutup oleh
 * perubahan paket — itu justru tindakan pengamanannya.
 */

const DEFAULT_SALES_DAYS = 7;
const MAX_SALES_DAYS = 30;
const DEFAULT_PURCHASE_DAYS = 30;
const MAX_PURCHASE_DAYS = 90;
/** Batas `since` untuk sinkronisasi bertahap: paling lama satu tahun ke belakang. */
const MAX_SINCE_DAYS = 366;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Menjepit `since` (milidetik epoch) ke jendela yang boleh dipindai.
 *
 * `null` = parameter tidak dikirim, jadi pemanggil memakai `days`. Nilai yang
 * bukan angka, terlalu tua, atau di masa depan dijepit — bukan ditolak — supaya
 * loop sinkronisasi yang jamnya sedikit meleset tidak berhenti total.
 */
function clampSince(value: number | undefined, maxDays: number): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  const now = Date.now();
  const floor = now - maxDays * 24 * 60 * 60 * 1000;
  return Math.min(now, Math.max(floor, Math.trunc(value)));
}

/** Daftar kunci, endpoint, dan riwayat kiriman — satu bacaan untuk halaman. */
export const overview = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "api.manage");
    const now = Date.now();

    const [keys, endpoints, deliveries] = await Promise.all([
      ctx.db
        .query("apiKeys")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
      ctx.db
        .query("webhookEndpoints")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
      ctx.db
        .query("webhookDeliveries")
        .withIndex("by_tenant_created", (q) => q.eq("tenantId", args.tenantId))
        .order("desc")
        .take(20),
    ]);

    const keyRows = keys
      .map((key) => ({
        id: key._id as string,
        name: key.name,
        mask: maskApiKey(key.publicId),
        publicId: key.publicId,
        scopes: sanitizeApiScopes(key.scopes) as string[],
        creatorRole: key.creatorRole ?? null,
        status: keyStatus(key, now),
        expiresAt: key.expiresAt ?? null,
        lastUsedAt: key.lastUsedAt ?? null,
        createdAt: key.createdAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);

    const endpointRows = endpoints
      .map((endpoint) => ({
        id: endpoint._id as string,
        url: endpoint.url,
        description: endpoint.description,
        events: sanitizeWebhookEvents(endpoint.events),
        active: endpoint.active,
        secretLastFour: endpoint.secretLastFour,
        createdAt: endpoint.createdAt,
        updatedAt: endpoint.updatedAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);

    const deliveryRows = deliveries.map((delivery) => ({
      id: delivery._id as string,
      endpointId: delivery.endpointId as string,
      event: delivery.event,
      status: delivery.status,
      attempts: delivery.attempts,
      lastStatusCode: delivery.lastStatusCode ?? null,
      lastError: delivery.lastError ?? null,
      nextAttemptAt: delivery.nextAttemptAt ?? null,
      deliveredAt: delivery.deliveredAt ?? null,
      createdAt: delivery.createdAt,
    }));

    const soon = now + 14 * 24 * 60 * 60 * 1000;
    return {
      keys: keyRows,
      endpoints: endpointRows,
      deliveries: deliveryRows,
      summary: {
        activeKeys: keyRows.filter((row) => row.status === "active").length,
        revokedKeys: keyRows.filter((row) => row.status === "revoked").length,
        expiringSoon: keyRows.filter(
          (row) => row.status === "active" && row.expiresAt !== null && row.expiresAt <= soon,
        ).length,
        endpoints: endpointRows.length,
        activeEndpoints: endpointRows.filter((row) => row.active).length,
        pendingDeliveries: deliveryRows.filter((row) => row.status === "pending").length,
        failedDeliveries: deliveryRows.filter((row) => row.status === "failed").length,
      },
    };
  },
});

/**
 * Membuat kunci baru. Nilai `plaintext` hanya ada di kembalian ini: tidak
 * disimpan, tidak bisa dibaca lagi, dan tidak masuk audit log.
 */
export const createKey = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    name: v.string(),
    scopes: v.array(permissionValidator),
    /** 0 = tanpa kedaluwarsa; kosong = 90 hari. */
    expiresInDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, args.tenantId, args.actorId, "api.access", "api.manage");
    const membership = await requirePermission(ctx, args.tenantId, args.actorId, "api.manage");
    // Scope dibatasi izin **efektif** pembuat (peran bawaan atau peran kustom),
    // bukan hanya `role`: anggota berperan kustom pun tidak bisa melebihi izinnya.
    const { permissions } = await resolveMembershipPermissions(ctx, membership);

    const existing = await ctx.db
      .query("apiKeys")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const validation = validateApiKeyInput(
      { name: args.name, scopes: args.scopes, expiresInDays: args.expiresInDays },
      {
        permissions,
        existingNames: existing.map((row) => row.name),
        activeCount: existing.filter((row) => keyStatus(row, Date.now()) === "active").length,
      },
    );
    if (!validation.ok) throw new Error(validation.reason);
    const draft = validation.value;

    const minted = mintApiKey();
    const keyId = await ctx.db.insert("apiKeys", {
      tenantId: args.tenantId,
      name: draft.name,
      publicId: minted.publicId,
      secretHash: minted.secretHash,
      scopes: draft.scopes,
      /**
       * Hanya peran bawaan yang dicatat; anggota berperan tambahan tidak punya
       * peran dasar yang bisa ditulis. Verifikasi kunci tetap memakai izin
       * efektif pembuatnya (`createdById`).
       */
      creatorRole: membership.role ?? undefined,
      active: true,
      expiresAt: draft.expiresAt ?? undefined,
      createdById: args.actorId,
      createdAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "apiKey.create",
      entity: "apiKeys",
      entityId: keyId,
      // Sengaja tanpa rahasia: hanya nama, publicId, dan scope.
      meta: { name: draft.name, publicId: minted.publicId, scopes: draft.scopes },
    });

    return {
      keyId,
      name: draft.name,
      plaintext: minted.plaintext,
      mask: maskApiKey(minted.publicId),
      scopes: draft.scopes,
      expiresAt: draft.expiresAt,
    };
  },
});

/** Mencabut kunci. Selalu boleh, bahkan setelah paket kehilangan `api.access`. */
export const revokeKey = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    keyId: v.id("apiKeys"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "api.manage");

    const key = await ctx.db.get(args.keyId);
    if (!key || key.tenantId !== args.tenantId) {
      throw new Error("Kunci API tidak ditemukan untuk tenant ini.");
    }
    if (!key.active) throw new Error(`Kunci "${key.name}" sudah dicabut.`);

    await ctx.db.patch(key._id, { active: false, revokedAt: Date.now() });
    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "apiKey.revoke",
      entity: "apiKeys",
      entityId: key._id,
      meta: { name: key.name, publicId: key.publicId },
    });

    return { keyId: key._id as string };
  },
});

/** Rahasia webhook baru; dikembalikan sekali untuk disalin ke server penerima. */
function newWebhookSecret(): string {
  return randomToken(API_KEY_SECRET_LENGTH, API_KEY_SECRET_ALPHABET);
}

export const createEndpoint = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    url: v.string(),
    description: v.optional(v.string()),
    events: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, args.tenantId, args.actorId, "api.access", "api.manage");

    const existing = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    if (existing.length >= MAX_WEBHOOK_ENDPOINTS) {
      throw new Error(
        `Maksimal ${MAX_WEBHOOK_ENDPOINTS} endpoint webhook per tenant; hapus yang tidak dipakai dulu.`,
      );
    }

    const validation = validateWebhookEndpoint(
      { url: args.url, description: args.description, events: args.events },
      { existingUrls: existing.map((row) => row.url) },
    );
    if (!validation.ok) throw new Error(validation.reason);
    const draft = validation.value;

    const secret = newWebhookSecret();
    const now = Date.now();
    const endpointId = await ctx.db.insert("webhookEndpoints", {
      tenantId: args.tenantId,
      url: draft.url,
      description: draft.description,
      events: draft.events,
      secret,
      secretLastFour: secret.slice(-4),
      active: true,
      createdById: args.actorId,
      createdAt: now,
      updatedAt: now,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "webhook.create",
      entity: "webhookEndpoints",
      entityId: endpointId,
      meta: { url: draft.url, events: draft.events },
    });

    return { endpointId, url: draft.url, events: draft.events, secret };
  },
});

/**
 * Mengubah endpoint. Menyalakan/mematikan endpoint selalu boleh (itu cara
 * menghentikan kiriman yang bermasalah); mengubah event atau memutar rahasia
 * menambah komitmen baru dan karenanya butuh fiturnya.
 */
export const updateEndpoint = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    endpointId: v.id("webhookEndpoints"),
    active: v.optional(v.boolean()),
    description: v.optional(v.string()),
    events: v.optional(v.array(v.string())),
    rotateSecret: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "api.manage");

    const endpoint = await ctx.db.get(args.endpointId);
    if (!endpoint || endpoint.tenantId !== args.tenantId) {
      throw new Error("Endpoint webhook tidak ditemukan untuk tenant ini.");
    }

    const changesSubscription = args.events !== undefined || args.rotateSecret === true;
    const changesCopy = args.description !== undefined;
    if (changesSubscription) {
      await requireFeature(ctx, args.tenantId, args.actorId, "api.access");
    }

    const patch: Partial<Doc<"webhookEndpoints">> = { updatedAt: Date.now() };
    if (args.active !== undefined) patch.active = args.active;

    if (changesCopy) {
      const description = (args.description ?? "").trim().slice(0, 120);
      patch.description = description.length > 0 ? description : undefined;
    }

    if (args.events !== undefined) {
      const events = sanitizeWebhookEvents(args.events);
      if (events.length === 0) throw new Error("Pilih minimal satu event yang mau dikirim.");
      patch.events = events;
    }

    let secret: string | undefined;
    if (args.rotateSecret) {
      secret = newWebhookSecret();
      patch.secret = secret;
      patch.secretLastFour = secret.slice(-4);
    }

    await ctx.db.patch(endpoint._id, patch);
    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "webhook.update",
      entity: "webhookEndpoints",
      entityId: endpoint._id,
      meta: { url: endpoint.url, events: patch.events ?? endpoint.events, rotated: Boolean(secret) },
    });

    return { endpointId: endpoint._id as string, secret };
  },
});

export const removeEndpoint = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    endpointId: v.id("webhookEndpoints"),
  },
  handler: async (ctx, args) => {
    // Tanpa gerbang fitur: menghentikan kiriman harus selalu mungkin.
    await requirePermission(ctx, args.tenantId, args.actorId, "api.manage");

    const endpoint = await ctx.db.get(args.endpointId);
    if (!endpoint || endpoint.tenantId !== args.tenantId) {
      throw new Error("Endpoint webhook tidak ditemukan untuk tenant ini.");
    }

    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_endpoint", (q) => q.eq("endpointId", endpoint._id))
      .collect();
    for (const delivery of deliveries) {
      await ctx.db.delete(delivery._id);
    }

    await ctx.db.delete(endpoint._id);
    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "webhook.delete",
      entity: "webhookEndpoints",
      entityId: endpoint._id,
      meta: { url: endpoint.url, deliveries: deliveries.length },
    });

    return { endpointId: endpoint._id as string, removedDeliveries: deliveries.length };
  },
});

/**
 * Menyiapkan kiriman uji: memeriksa izin + fitur, menyusun payload, dan
 * mencatat baris `pending`. Dipisah dari aksi HTTP-nya supaya pemeriksaan izin
 * tetap berada di jalur yang sama dengan mutation lain (aksi tidak punya `db`).
 */
export const beginTestDelivery = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    endpointId: v.id("webhookEndpoints"),
  },
  // Tipe kembalian ditulis eksplisit: aksi `testEndpoint` di modul yang sama
  // memanggil fungsi ini, dan tanpa anotasi TypeScript berputar-putar menebak
  // tipe `internal.apiAccess` (TS7022/TS7023).
  handler: async (
    ctx,
    args,
  ): Promise<{
    deliveryId: string;
    url: string;
    secret: string;
    event: string;
    payload: string;
    timestamp: number;
    /** Selalu 0: kiriman uji baru dibuat, jadi percobaan ini adalah yang pertama. */
    attempts: number;
  }> => {
    await requireFeature(ctx, args.tenantId, args.actorId, "api.access", "api.manage");

    const endpoint = await ctx.db.get(args.endpointId);
    if (!endpoint || endpoint.tenantId !== args.tenantId) {
      throw new Error("Endpoint webhook tidak ditemukan untuk tenant ini.");
    }
    if (!endpoint.active) {
      throw new Error(
        `Endpoint ${endpoint.url} sedang nonaktif; aktifkan dulu sebelum mengirim uji.`,
      );
    }

    const now = Date.now();
    const event = sampleDeliveryEvent(endpoint.events);
    const payload = sampleDeliveryPayload(event, now);
    const deliveryId = await ctx.db.insert("webhookDeliveries", {
      tenantId: args.tenantId,
      endpointId: endpoint._id,
      event,
      payload,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
    });

    return {
      deliveryId: deliveryId as string,
      url: endpoint.url,
      secret: endpoint.secret,
      event,
      payload,
      timestamp: now,
      attempts: 0,
    };
  },
});

/** Mencatat hasil satu percobaan kiriman dan menjadwalkan percobaan berikutnya. */
export const finishDelivery = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    ok: v.boolean(),
    statusCode: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "delivered" | "pending" | "failed"; attempts: number }> => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) throw new Error("Kiriman webhook tidak ditemukan.");

    const attempts = delivery.attempts + 1;
    const now = Date.now();

    if (args.ok) {
      await ctx.db.patch(delivery._id, {
        attempts,
        status: "delivered",
        lastStatusCode: args.statusCode,
        lastError: undefined,
        nextAttemptAt: undefined,
        deliveredAt: now,
      });
      return { status: "delivered" as const, attempts };
    }

    const pending = deliveryOutcome(attempts) === "pending";
    await ctx.db.patch(delivery._id, {
      attempts,
      status: pending ? "pending" : "failed",
      lastStatusCode: args.statusCode,
      lastError: (args.error ?? "Kiriman gagal.").slice(0, 300),
      nextAttemptAt: pending ? (nextDeliveryAttemptAt(attempts, now) ?? undefined) : undefined,
    });
    return { status: pending ? ("pending" as const) : ("failed" as const), attempts };
  },
});

/** POST bertanda tangan HMAC; dipakai aksi uji (dan pekerja percobaan ulang). */
async function postSignedDelivery(input: {
  url: string;
  secret: string;
  payload: string;
  timestamp: number;
  event: string;
  /** Percobaan ke berapa — tampil di header `x-mesinpos-attempt`. */
  attempt: number;
}): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  try {
    const response = await fetch(input.url, {
      method: "POST",
      // Satu fungsi murni yang menandatangani badan kiriman: jalur uji dan jalur
      // percobaan ulang tidak bisa memakai skema tanda tangan berbeda.
      headers: webhookDeliveryHeaders({
        secret: input.secret,
        timestamp: input.timestamp,
        event: input.event,
        attempt: input.attempt,
        body: input.payload,
      }),
      body: input.payload,
    });
    if (!response.ok) {
      return { ok: false, statusCode: response.status, error: `Penerima menjawab ${response.status}.` };
    }
    return { ok: true, statusCode: response.status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Mengirim satu payload uji ke endpoint tenant.
 *
 * Ini satu-satunya jalur yang benar-benar berbicara ke internet: hasilnya
 * (berhasil, kode HTTP, pesan galat, dan jadwal percobaan berikutnya) selalu
 * dicatat di `webhookDeliveries`, jadi kegagalan tidak hilang di log.
 */
export const testEndpoint = action({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    endpointId: v.id("webhookEndpoints"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "delivered" | "pending" | "failed";
    attempts: number;
    event: string;
    error: string | null;
  }> => {
    const prepared = await ctx.runMutation(internal.apiAccess.beginTestDelivery, args);
    const result = await postSignedDelivery({
      url: prepared.url,
      secret: prepared.secret,
      payload: prepared.payload,
      timestamp: prepared.timestamp,
      event: prepared.event,
      attempt: prepared.attempts + 1,
    });
    const outcome = await ctx.runMutation(internal.apiAccess.finishDelivery, {
      deliveryId: prepared.deliveryId as Id<"webhookDeliveries">,
      ok: result.ok,
      statusCode: result.statusCode,
      error: result.error,
    });
    return { ...outcome, event: prepared.event, error: result.error ?? null };
  },
});

/**
 * Kiriman yang siap dicoba ulang: status `pending` dengan jadwal yang sudah
 * lewat.
 *
 * Diambil lewat indeks `by_status_next_attempt` (bukan memindai tabel), dan
 * dibatasi `retryBatchLimit` supaya satu putaran pekerja tetap sependek apa pun
 * panjang riwayatnya. Endpoint diambil sekalian karena pekerja butuh URL &
 * rahasianya untuk menandatangani kiriman; `stopReason` sudah berisi keputusan
 * murni `retryStopReason` kalau kirimannya tidak boleh dilanjutkan lagi.
 */
export const dueDeliveries = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (
    ctx,
    args,
  ): Promise<
    {
      deliveryId: string;
      event: string;
      payload: string;
      attempts: number;
      url: string | null;
      secret: string | null;
      stopReason: string | null;
    }[]
  > => {
    const rows = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_status_next_attempt", (q) =>
        q.eq("status", "pending").lte("nextAttemptAt", args.now),
      )
      .take(retryBatchLimit(args.limit));

    return await Promise.all(
      rows.map(async (row) => {
        const endpoint = await ctx.db.get(row.endpointId);
        return {
          deliveryId: row._id as string,
          event: row.event,
          payload: row.payload,
          attempts: row.attempts,
          url: endpoint?.url ?? null,
          secret: endpoint?.secret ?? null,
          stopReason: retryStopReason(endpoint),
        };
      }),
    );
  },
});

/**
 * Menutup kiriman yang tidak boleh dicoba lagi sebagai `failed`.
 *
 * Berbeda dari `finishDelivery` — yang menambah jumlah percobaan lalu
 * menjadwalkan percobaan berikutnya lewat backoff — fungsi ini menghentikan
 * percobaan **seketika**. Dipakai pekerja saat penerimanya sudah dinonaktifkan
 * atau dihapus, sehingga tidak ada kiriman `pending` yang menggantung selamanya
 * hanya karena endpoint-nya tidak ada lagi.
 */
export const stopDelivery = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries"), reason: v.string() },
  handler: async (ctx, args): Promise<{ status: "failed" }> => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (delivery) {
      await ctx.db.patch(delivery._id, {
        status: "failed",
        lastError: args.reason.slice(0, 300),
        nextAttemptAt: undefined,
      });
    }
    return { status: "failed" };
  },
});

/**
 * Pekerja terjadwal: kirim ulang webhook yang gagal **sesuai jadwalnya**.
 *
 * Dipanggil `src/convex/crons.ts` setiap `RETRY_WORKER_INTERVAL_MINUTES` menit.
 * Satu putaran: ambil kiriman yang jatuh tempo (`dueDeliveries`), kirim ulang satu
 * per satu memakai jalur bertanda tangan yang sama dengan kiriman biasa, lalu
 * catat hasilnya lewat `finishDelivery` — percobaan berikutnya dijadwalkan aturan
 * murni `deliveryOutcome`. Kiriman yang bertemu endpoint mati ditutup lewat
 * `stopDelivery`, jadi tidak ada baris `pending` yang menggantung.
 *
 * Satu kegagalan tidak menghentikan putaran: penerima yang bermasalah tidak boleh
 * menahan antrean penerima lain. Gerbang fiturnya juga sengaja tidak ada di sini —
 * percobaan ulang yang berhenti mendadak karena perubahan paket hanya akan
 * meninggalkan kiriman setengah jalan; tenant mematikan endpoint kalau memang
 * tidak ingin dikirimi lagi.
 */
export const retryDueDeliveries = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ scanned: number; delivered: number; scheduled: number; stopped: number }> => {
    const due = await ctx.runQuery(internal.apiAccess.dueDeliveries, {
      now: Date.now(),
      limit: retryBatchLimit(args.limit),
    });

    let delivered = 0;
    let scheduled = 0;
    let stopped = 0;

    for (const item of due) {
      const deliveryId = item.deliveryId as Id<"webhookDeliveries">;

      if (item.stopReason !== null || item.url === null || item.secret === null) {
        await ctx.runMutation(internal.apiAccess.stopDelivery, {
          deliveryId,
          reason:
            item.stopReason ?? "Data endpoint webhook tidak lengkap; percobaan ulang dihentikan.",
        });
        stopped += 1;
        continue;
      }

      const result = await postSignedDelivery({
        url: item.url,
        secret: item.secret,
        payload: item.payload,
        event: item.event,
        // Percobaan yang sedang dilakukan ini adalah `attempts + 1`; badan
        // kirimannya tidak berubah, jadi penerima tetap mengenali id yang sama.
        attempt: item.attempts + 1,
        timestamp: Date.now(),
      });

      const outcome = await ctx.runMutation(internal.apiAccess.finishDelivery, {
        deliveryId,
        ok: result.ok,
        statusCode: result.statusCode,
        error: result.error,
      });
      if (outcome.status === "delivered") delivered += 1;
      else if (outcome.status === "pending") scheduled += 1;
    }

    return { scanned: due.length, delivered, scheduled, stopped };
  },
});

/**
 * Autentikasi kunci untuk endpoint HTTP.
 *
 * Mengembalikan status yang bisa dipakai langsung oleh `http.ts` alih-alih
 * melempar: 404 resource asing, 401 kunci tidak sah, 403 scope/izin kurang.
 * Selain memeriksa kunci, fungsi ini juga memeriksa **izin pembuat saat ini**:
 * kunci buatan anggota yang sudah dikeluarkan dari tenant, atau yang perannya
 * diturunkan, langsung berhenti bekerja.
 */
export const authenticate = internalQuery({
  args: { plaintext: v.string(), resource: v.string() },
  handler: async (ctx, args) => {
    const scope = resourceScope(args.resource);
    if (scope === undefined) {
      return { ok: false as const, status: 404, error: "Resource API tidak dikenal." };
    }

    const parsed = parseApiKey(args.plaintext);
    if (!parsed) {
      return { ok: false as const, status: 401, error: "Format kunci API tidak dikenal." };
    }

    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_public_id", (q) => q.eq("publicId", parsed.publicId))
      .unique();
    const verdict = verifyApiKey(args.plaintext, key ?? null, Date.now());
    if (!verdict.ok || !key) {
      return { ok: false as const, status: 401, error: verdict.ok ? "Kunci API tidak dikenal." : verdict.reason };
    }

    const keyScopes = sanitizeApiScopes(key.scopes);

    // Izin pembuat saat ini: anggota yang sudah tidak aktif (atau diturunkan)
    // mempersempit kunci yang pernah dibuatnya.
    let creatorPermissions: Permission[] | null = null;
    if (key.createdById) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_tenant_user", (q) =>
          q.eq("tenantId", key.tenantId).eq("userId", key.createdById as Id<"users">),
        )
        .unique();
      if (!membership || !membership.active) {
        return {
          ok: false as const,
          status: 403,
          error: "Kunci dibuat oleh anggota yang sudah tidak aktif; minta pemilik membuat kunci baru.",
        };
      }
      creatorPermissions = (await resolveMembershipPermissions(ctx, membership)).permissions;
    }

    if (scope) {
      if (!keyScopes.includes(scope)) {
        return {
          ok: false as const,
          status: 403,
          error: `Kunci ini tidak punya scope ${scope}.`,
        };
      }
      const allowedNow = creatorPermissions
        ? creatorPermissions.includes(scope)
        : scopeAllowed(key.creatorRole, keyScopes, scope);
      if (!allowedNow) {
        return {
          ok: false as const,
          status: 403,
          error: `Izin pembuat kunci sudah tidak mencakup ${scope}; minta pemilik membuat kunci baru.`,
        };
      }
    }

    const store = await ctx.db
      .query("stores")
      .withIndex("by_tenant", (q) => q.eq("tenantId", key.tenantId))
      .first();

    return {
      ok: true as const,
      keyId: key._id as string,
      tenantId: key.tenantId,
      storeId: store?._id ?? null,
      scopes: keyScopes as string[],
      scope,
      keyName: key.name,
    };
  },
});

/** Mencatat pemakaian kunci; dipanggil endpoint HTTP setelah autentikasi. */
export const touchKey = internalMutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.keyId);
    if (!key) return { ok: false };
    await ctx.db.patch(key._id, { lastUsedAt: Date.now() });
    return { ok: true };
  },
});

/**
 * Pembacaan data untuk `/api/v1/*`.
 *
 * Satu fungsi dengan `switch` supaya setiap resource punya satu tempat: menambah
 * endpoint berarti menambah satu cabang di sini, bukan menambah jalur izin baru.
 * Semua scope sudah diperiksa `authenticate` sebelum fungsi ini dipanggil.
 */
export const readResource = internalQuery({
  args: {
    resource: v.string(),
    tenantId: v.id("tenants"),
    storeId: v.union(v.null(), v.id("stores")),
    days: v.optional(v.number()),
    limit: v.optional(v.number()),
    /** Hanya baris yang lebih baru dari ini (milidetik epoch); mengalahkan `days`. */
    since: v.optional(v.number()),
    /** SKU terakhir halaman sebelumnya, untuk melanjutkan katalog. */
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = clampNumber(args.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);

    if (args.resource === "ping") {
      const tenant = await ctx.db.get(args.tenantId);
      return {
        tenant: tenant?.name ?? null,
        planKey: tenant?.planKey ?? null,
        modules: tenant?.verticals ?? [],
        serverTime: new Date().toISOString(),
      };
    }

    if (args.resource === "sales") {
      if (!args.storeId) return { sales: [], total: 0 };
      const days = clampNumber(args.days, DEFAULT_SALES_DAYS, 1, MAX_SALES_DAYS);
      // `since` mengalahkan `days`: dipakai loop sinkronisasi yang menyimpan
      // posisi terakhir, bukan jendela waktu yang bergeser sendiri.
      const since = clampSince(args.since, MAX_SINCE_DAYS);
      const from = since ?? Date.now() - days * 24 * 60 * 60 * 1000;
      const rows = await ctx.db
        .query("sales")
        .withIndex("by_tenant_store_created", (q) =>
          q.eq("tenantId", args.tenantId).eq("storeId", args.storeId as Id<"stores">).gte("createdAt", from),
        )
        .order("desc")
        .take(limit);
      const sales = rows
        .filter((sale) => sale.status === "completed")
        .map((sale) => ({
          number: sale.number,
          total: sale.total,
          tax: sale.tax,
          discount: sale.discount,
          method: sale.payments[0]?.method ?? null,
          createdAt: new Date(sale.createdAt).toISOString(),
        }));
      return {
        sales,
        total: sales.length,
        // `days` hanya berarti kalau jendelanya memang dihitung dari `days`.
        // Saat `since` dipakai, mengirim `days` justru menyesatkan pembaca.
        ...(since === null ? { days } : {}),
        from: new Date(from).toISOString(),
      };
    }

    if (args.resource === "products") {
      // Katalog dibaca berurutan menurut SKU dan bisa dilanjutkan lewat
      // `cursor`. Tanpa itu, platform yang punya lebih dari `limit` produk hanya
      // pernah menerima halaman pertama saat menyamakan katalognya.
      //
      // Kategori & subkategori ikut dikirim sebagai **nama**, bukan id internal:
      // platform memakainya untuk menyusun katalog dua tingkat dan tidak perlu
      // mengenal id MesinPOS (sama seperti SKU sebagai kunci produk). Subkategori
      // dibuat di bawah kategorinya (lihat `subcategories.create`), jadi pasangan
      // `category`/`subcategory` di sini selalu konsisten.
      const cursor = (args.cursor ?? "").trim();
      const rows = await ctx.db
        .query("products")
        .withIndex("by_tenant_sku", (q) => {
          const byTenant = q.eq("tenantId", args.tenantId);
          return cursor.length > 0 ? byTenant.gt("sku", cursor) : byTenant;
        })
        .take(limit + 1);
      const page = rows.slice(0, limit);
      const nextCursor = rows.length > limit ? page[page.length - 1].sku : null;

      const levels = args.storeId
        ? await ctx.db
            .query("stockLevels")
            .withIndex("by_tenant_store", (q) =>
              q.eq("tenantId", args.tenantId).eq("storeId", args.storeId as Id<"stores">),
            )
            .collect()
        : [];
      // Nama kategori & subkategori dibaca sekali untuk seluruh halaman, bukan per
      // produk — keduanya menunjuk id, jadi nama barunya tidak perlu ditulis ulang
      // di produk.
      const [categoryRows, subcategoryRows] = await Promise.all([
        ctx.db
          .query("categories")
          .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
          .collect(),
        ctx.db
          .query("subcategories")
          .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
          .collect(),
      ]);
      const categoryName = new Map(
        categoryRows.map((row) => [row._id as string, row.name]),
      );
      const subcategoryName = new Map(
        subcategoryRows.map((row) => [row._id as string, row.name]),
      );

      // Hanya stok lokasi jual (`warehouseId` kosong) — angka yang dipakai kasir.
      const sellable = new Map<string, number>();
      for (const level of levels) {
        if (level.warehouseId) continue;
        const id = level.productId as string;
        sellable.set(id, (sellable.get(id) ?? 0) + level.quantity);
      }
      return {
        products: page.map((product) => ({
          sku: product.sku,
          name: product.name,
          category: product.categoryId
            ? categoryName.get(product.categoryId as string) ?? null
            : null,
          subcategory: product.subcategoryId
            ? subcategoryName.get(product.subcategoryId as string) ?? null
            : null,
          price: product.price,
          unit: product.unit ?? "PCS",
          active: product.active,
          trackStock: product.trackStock,
          sellable: sellable.get(product._id as string) ?? 0,
        })),
        total: page.length,
        nextCursor,
      };
    }

    if (args.resource === "purchases") {
      if (!args.storeId) return { purchases: [], total: 0 };
      const days = clampNumber(args.days, DEFAULT_PURCHASE_DAYS, 1, MAX_PURCHASE_DAYS);
      const since = clampSince(args.since, MAX_SINCE_DAYS);
      const from = since ?? Date.now() - days * 24 * 60 * 60 * 1000;

      const receipts = await ctx.db
        .query("goodsReceipts")
        .withIndex("by_tenant_store", (q) =>
          q.eq("tenantId", args.tenantId).eq("storeId", args.storeId as Id<"stores">),
        )
        .collect();
      const page = receipts
        .filter((receipt) => receipt.createdAt >= from)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);

      // Baris GRN menyimpan id produk & id PO; penerima perlu nomor PO, nama
      // supplier, dan SKU — bukan id internal MesinPOS.
      const orders = await Promise.all(page.map((receipt) => ctx.db.get(receipt.orderId)));
      const supplierIds = [
        ...new Set(
          orders
            .map((order) => (order ? (order.supplierId as string) : null))
            .filter((id): id is string => id !== null),
        ),
      ];
      const suppliers = await Promise.all(
        supplierIds.map((id) => ctx.db.get(id as Id<"suppliers">)),
      );
      const supplierName = new Map(
        suppliers.filter((row) => row !== null).map((row) => [row!._id as string, row!.name]),
      );

      const productIds = [
        ...new Set(
          page.flatMap((receipt) =>
            receipt.lines.map((line) => line.productId as string),
          ),
        ),
      ];
      const products = await Promise.all(
        productIds.map((id) => ctx.db.get(id as Id<"products">)),
      );
      const skuById = new Map(
        products.filter((row) => row !== null).map((row) => [row!._id as string, row!.sku]),
      );

      return {
        purchases: page.map((receipt, index) => {
          const order = orders[index];
          return {
            number: receipt.number,
            order: order?.number ?? null,
            supplier: order ? supplierName.get(order.supplierId as string) ?? null : null,
            total: receipt.total,
            receivedAt: new Date(receipt.createdAt).toISOString(),
            lines: receipt.lines.map((line) => ({
              sku: skuById.get(line.productId as string) ?? null,
              name: line.name,
              quantity: line.quantity,
              unitCost: line.unitCost,
            })),
          };
        }),
        total: page.length,
        ...(since === null ? { days } : {}),
        from: new Date(from).toISOString(),
      };
    }

    if (args.resource === "payables") {
      const [payables, suppliers] = await Promise.all([
        ctx.db
          .query("payables")
          .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
          .collect(),
        ctx.db
          .query("suppliers")
          .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
          .collect(),
      ]);
      const supplierName = new Map(suppliers.map((row) => [row._id as string, row.name]));
      const now = Date.now();
      const open = payables
        .filter((row) => row.status === "open")
        .sort((a, b) => a.dueDate - b.dueDate)
        .slice(0, limit)
        .map((row) => {
          const balance = row.amount - row.paidAmount;
          return {
            number: row.number,
            supplier: supplierName.get(row.supplierId as string) ?? null,
            balance,
            dueDate: new Date(row.dueDate).toISOString(),
            overdue: row.dueDate < now,
          };
        });
      return {
        payables: open,
        total: open.length,
        outstanding: open.reduce((sum, row) => sum + row.balance, 0),
      };
    }

    return { error: "Resource tidak dikenal." };
  },
});

/**
 * Hasil satu penulisan lewat API. Bentuknya membawa kode HTTP supaya `http.ts`
 * tidak perlu menebak: 400 = bentuk/data kiriman salah, 409 = aturan bisnis
 * menolak (stok kurang, modul mati, limit kredit habis), 401/403 = kunci.
 */
type ApiWriteResult =
  | {
      ok: true;
      data: {
        id: string;
        number: string;
        total: number;
        creditAmount: number;
        memberDiscount: number;
        deduplicated: boolean;
      };
    }
  | { ok: false; status: number; error: string };

/**
 * Mencari produk lewat SKU tanpa peka huruf besar-kecil.
 *
 * Dua percobaan (apa adanya & huruf kecil) cukup untuk dua kebiasaan penulisan
 * yang ada di lapangan, tanpa memindai seluruh katalog atau menambah indeks baru.
 */
async function findProductBySku(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  sku: string,
): Promise<Doc<"products"> | null> {
  for (const candidate of [sku, sku.toLowerCase()]) {
    const found = await ctx.db
      .query("products")
      .withIndex("by_tenant_sku", (q) =>
        q.eq("tenantId", tenantId).eq("sku", candidate),
      )
      .unique();
    if (found) return found;
  }
  return null;
}

/** Kode pelanggan B2B (`B2B-0001`) → pelanggan; pencocokan tidak peka huruf besar-kecil. */
async function findCustomerByCode(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  code: string,
): Promise<Doc<"customers"> | null> {
  for (const candidate of [code, code.toLowerCase()]) {
    const found = await ctx.db
      .query("customers")
      .withIndex("by_tenant_code", (q) =>
        q.eq("tenantId", tenantId).eq("code", candidate),
      )
      .unique();
    if (found) return found;
  }
  return null;
}

/** Kode member (`MBR-0001`) → member; pencocokan tidak peka huruf besar-kecil. */
async function findMemberByCode(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  code: string,
): Promise<Doc<"members"> | null> {
  for (const candidate of [code, code.toLowerCase()]) {
    const found = await ctx.db
      .query("members")
      .withIndex("by_tenant_code", (q) =>
        q.eq("tenantId", tenantId).eq("code", candidate),
      )
      .unique();
    if (found) return found;
  }
  return null;
}

/**
 * Menulis satu penjualan dari sistem luar (`POST /api/v1/sales`, scope `pos.sell`).
 *
 * Yang **tidak** dilakukan fungsi ini: menghitung harga, memutuskan stok cukup,
 * atau memutuskan kredit. Semuanya tetap di `pos.createSale` — fungsi ini hanya
 * menerjemahkan bahasa luar (SKU & kode) ke bahasa dalam (id), memastikan
 * kuncinya masih sah **saat menulis**, lalu memanggil jalur penjualan yang sama
 * dengan kasir. Karena itu satu penjualan dari API adalah penjualan yang sama
 * persis: stok lewat ledger, PPN & diskon dari paket tenant, audit log atas nama
 * pembuat kunci, dan replay dengan `idempotencyKey` yang sama tidak menagih dua kali.
 */
export const recordOrder = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.union(v.null(), v.id("stores")),
    keyId: v.id("apiKeys"),
    idempotencyKey: v.string(),
    lines: v.array(
      v.object({
        sku: v.string(),
        quantity: v.number(),
        unitCode: v.optional(v.string()),
      }),
    ),
    payment: v.object({
      method: paymentMethodValidator,
      amount: v.optional(v.number()),
      provider: v.optional(v.string()),
      providerRef: v.optional(v.string()),
    }),
    discount: v.number(),
    customerCode: v.union(v.null(), v.string()),
    memberCode: v.union(v.null(), v.string()),
  },
  handler: async (ctx, args): Promise<ApiWriteResult> => {
    // 1. Kunci diperiksa sekali lagi di dalam transaksi tulis: antara
    //    autentikasi dan penulisan, kuncinya bisa saja baru dicabut.
    const key = await ctx.db.get(args.keyId);
    if (!key || key.tenantId !== args.tenantId) {
      return { ok: false, status: 401, error: "Kunci API tidak valid untuk tenant ini." };
    }
    if (keyStatus(key, Date.now()) !== "active") {
      return { ok: false, status: 401, error: "Kunci API sudah tidak aktif." };
    }
    if (!sanitizeApiScopes(key.scopes).includes("pos.sell")) {
      return { ok: false, status: 403, error: "Kunci ini tidak punya scope pos.sell." };
    }
    if (!key.createdById) {
      return {
        ok: false,
        status: 409,
        error: "Kunci ini dibuat sebelum ada jejak pembuat; buat kunci baru agar penulisannya bisa diaudit.",
      };
    }
    if (!args.storeId) {
      return {
        ok: false,
        status: 409,
        error: "Tenant ini belum punya toko aktif, jadi penjualan belum bisa dicatat.",
      };
    }

    // 2. SKU → produk. Semua baris diperiksa dulu supaya pesanan yang salah
    //    tidak setengah masuk: tidak ada penjualan parsial dari API.
    const items: { productId: Id<"products">; quantity: number; unitCode?: string }[] = [];
    for (const [index, line] of args.lines.entries()) {
      const product = await findProductBySku(ctx, args.tenantId, line.sku);
      if (!product) {
        return {
          ok: false,
          status: 400,
          error: `Baris ke-${index + 1}: SKU ${line.sku} tidak ditemukan di katalog tenant ini.`,
        };
      }
      if (!product.active) {
        return {
          ok: false,
          status: 409,
          error: `Baris ke-${index + 1}: produk ${product.sku} sedang nonaktif; aktifkan dulu di halaman Produk.`,
        };
      }
      items.push(
        line.unitCode
          ? { productId: product._id, quantity: line.quantity, unitCode: line.unitCode }
          : { productId: product._id, quantity: line.quantity },
      );
    }

    const customer = args.customerCode
      ? await findCustomerByCode(ctx, args.tenantId, args.customerCode)
      : null;
    if (args.customerCode && !customer) {
      return {
        ok: false,
        status: 400,
        error: `customerCode ${args.customerCode} tidak ditemukan di tenant ini.`,
      };
    }
    const member = args.memberCode
      ? await findMemberByCode(ctx, args.tenantId, args.memberCode)
      : null;
    if (args.memberCode && !member) {
      return {
        ok: false,
        status: 400,
        error: `memberCode ${args.memberCode} tidak ditemukan di tenant ini.`,
      };
    }

    // 3. Jalur penjualan yang sama dengan kasir. Kunci bertindak **sebagai
    //    pembuatnya** (`cashierId`), jadi izin & auditnya sama dengan orang itu;
    //    kunci tidak pernah punya wewenang sendiri.
    const payExactTotal = args.payment.amount === undefined;
    try {
      // `pos.createSale` sengaja tetap jalur publik: penjualan dari API harus
      // melewati gerbang yang sama persis dengan kasir (langganan aktif, izin
      // `pos.sell` pembuat kunci, modul, harga server) — tidak ada jalur pintas.
      const sale = await ctx.runMutation(api.pos.createSale, {
        tenantId: args.tenantId,
        storeId: args.storeId,
        cashierId: key.createdById,
        items,
        discount: args.discount > 0 ? args.discount : undefined,
        payments: [
          {
            method: args.payment.method,
            amount: args.payment.amount ?? 0,
            provider: args.payment.provider,
            providerRef: args.payment.providerRef,
          },
        ],
        idempotencyKey: `api:${args.tenantId}:${args.idempotencyKey}`,
        customerId: customer?._id,
        memberId: member?._id,
        payExactTotal,
      });

      if (!sale.deduplicated) {
        await writeAuditLog(ctx, {
          tenantId: args.tenantId,
          actorId: key.createdById,
          action: "api.sale.create",
          entity: "sales",
          entityId: sale.saleId as string,
          meta: {
            kunci: key.name,
            kunciId: key._id as string,
            idempotencyKey: args.idempotencyKey,
            number: sale.number,
          },
        });
      }

      return {
        ok: true,
        data: {
          id: sale.saleId as string,
          number: sale.number,
          total: sale.total,
          creditAmount: sale.creditAmount,
          memberDiscount: sale.memberDiscount,
          deduplicated: sale.deduplicated,
        },
      };
    } catch (error) {
      // Aturan bisnis (stok kurang, modul mati, limit kredit) apa adanya dari
      // satu tempat: `pos.createSale`. Diterjemahkan menjadi 409, bukan 400,
      // supaya pengirim tahu bentuknya benar tetapi keadaannya menolak.
      return {
        ok: false,
        status: 409,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

/** Daftar scope & endpoint, dipakai halaman dan dokumentasi API. */
export const capabilities = query({
  args: {},
  handler: () => ({
    scopes: API_SCOPES as string[],
    expiryOptions: API_KEY_EXPIRY_OPTIONS,
  }),
});

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
  describeReceiverFailure,
  nextDeliveryAttemptAt,
  retryBatchLimit,
  retryStopReason,
  sampleDeliveryEvent,
  sampleDeliveryPayload,
  sanitizeWebhookEvents,
  validateWebhookEndpoint,
  validateWebhookSecret,
  webhookDeliveryHeaders,
} from "./lib/webhooks";
import { encodeCursor } from "./lib/apiQuery";
import { sha256Hex } from "./lib/hash";
import {
  inboundStoreCode,
  parseProductPatch,
  parseStockAdjust,
  parseVoidSale,
} from "./lib/apiWrites";
import {
  INBOUND_SECRET_ALPHABET,
  INBOUND_SECRET_LENGTH,
  INBOUND_TOKEN_ALPHABET,
  INBOUND_TOKEN_LENGTH,
  INBOUND_TOKEN_PREFIX,
  sanitizeInboundEvents,
  validateInboundEndpointInput,
} from "./lib/inboundWebhooks";
import { isOrderIdempotencyKey, parseExternalOrder } from "./lib/apiOrders";
import {
  MARKETPLACE_INBOUND_EVENTS,
  MARKETPLACE_ORDER_ID_PREFIX,
  isMarketplaceInboundEvent,
  marketplaceOrderKey,
  marketplaceRetryPayload,
  prepareMarketplaceOrderBody,
  type MarketplaceRetryResult,
} from "./lib/marketplace";
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

/**
 * Mencabut **dan menghapus** kunci. Selalu boleh, bahkan setelah paket kehilangan
 * `api.access`.
 *
 * Barisnya dihapus, bukan ditandai `active: false`: kunci yang sudah dicabut tidak
 * punya kegunaan lagi, rahasianya tidak bisa dipulihkan, dan menyimpannya hanya
 * membuat daftar kunci penuh baris mati yang bisa membingungkan (nama kunci lama
 * juga tetap terpakai). Jejak pencabutan tetap ada di **log audit**
 * (`apiKey.revoke`, berisi nama & `publicId`), jadi siapa mencabut kunci apa dan
 * kapan masih bisa diperiksa tanpa menyimpan hash rahasianya selamanya.
 *
 * Baris lama yang dulu dicabut dengan cara lama (`active: false`) dibersihkan
 * lewat `purgeRevokedKeys`.
 */
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
      throw new Error(
        "Kunci API tidak ditemukan — mungkin sudah dicabut dan dihapus.",
      );
    }
    if (!key.active) {
      // Baris peninggalan cara lama: hapus sekarang, bukan menolak.
      await ctx.db.delete(key._id);
      await writeAuditLog(ctx, {
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: "apiKey.purge",
        entity: "apiKeys",
        entityId: key._id,
        meta: { name: key.name, publicId: key.publicId },
      });
      return { keyId: key._id as string };
    }

    await ctx.db.delete(key._id);
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

/**
 * Membersihkan baris kunci **peninggalan** yang dulu dicabut dengan menandai
 * `active: false` (sebelum pencabutan menghapus baris). Kunci yang masih hidup —
 * termasuk yang sudah kedaluwarsa — tidak disentuh: kedaluwarsa bukan
 * pencabutan, dan barisnya masih berguna sebagai catatan sampai pemilik
 * mencabutnya.
 */
export const purgeRevokedKeys = mutation({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "api.manage");

    const rows = await ctx.db
      .query("apiKeys")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const revoked = rows.filter(
      (row) => !row.active || row.revokedAt !== undefined,
    );

    for (const row of revoked) {
      await ctx.db.delete(row._id);
      await writeAuditLog(ctx, {
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: "apiKey.purge",
        entity: "apiKeys",
        entityId: row._id,
        meta: { name: row.name, publicId: row.publicId },
      });
    }

    return {
      removed: revoked.length,
      sentence:
        revoked.length === 0
          ? "Tidak ada kunci yang sudah dicabut untuk dihapus."
          : `${revoked.length} kunci yang sudah dicabut dihapus permanen.`,
    };
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
 * menghentikan kiriman yang bermasalah); mengubah event, memutar rahasia, atau
 * memasang rahasia yang ditentukan penerimanya menambah komitmen baru dan
 * karenanya butuh fiturnya.
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
    /**
     * Rahasia yang **diketik**, biasanya nilai yang sama dengan yang disimpan
     * penerimanya. Dipakai untuk menyamakan kedua sisi tanpa harus memutar
     * rahasia di MesinPOS — inilah jalan keluar saat penerima menjawab 401
     * karena rahasianya berbeda. `rotateSecret` diabaikan bila ini diisi.
     */
    secret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "api.manage");

    const endpoint = await ctx.db.get(args.endpointId);
    if (!endpoint || endpoint.tenantId !== args.tenantId) {
      throw new Error("Endpoint webhook tidak ditemukan untuk tenant ini.");
    }

    const changesSubscription =
      args.events !== undefined || args.rotateSecret === true || args.secret !== undefined;
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

    // Rahasia yang diketik pemilik menang atas pemutaran: satu permintaan tidak
    // mungkin menetapkan dua nilai sekaligus.
    let secret: string | undefined;
    let secretFromReceiver = false;
    if (args.secret !== undefined) {
      const check = validateWebhookSecret(args.secret);
      if (!check.ok) throw new Error(check.reason);
      patch.secret = check.value;
      patch.secretLastFour = check.value.slice(-4);
      secretFromReceiver = true;
    } else if (args.rotateSecret) {
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
      meta: {
        url: endpoint.url,
        events: patch.events ?? endpoint.events,
        rotated: Boolean(secret),
        secretFromReceiver,
      },
    });

    // Rahasia yang diketik pemilik tidak dikembalikan lagi: nilainya sudah ada
    // padanya (dari penerima), jadi tidak ada yang perlu ditampilkan sekali.
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
      // Alasan dari penerima ikut disimpan: “Penerima menjawab 401” saja tidak
      // memberi tahu pemilik apa yang harus diperbaiki, sedangkan pesan penerima
      // biasanya menyebutkannya (mis. rahasia tanda tangan tidak cocok).
      let bodyText = "";
      try {
        bodyText = await response.text();
      } catch {
        bodyText = "";
      }
      return {
        ok: false,
        statusCode: response.status,
        error: describeReceiverFailure(response.status, bodyText),
      };
    }
    return { ok: true, statusCode: response.status };
  } catch (error) {
    return {
      ok: false,
      error: apiErrorMessage(error),
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
 * Menyiapkan **kiriman ulang** satu baris riwayat yang menunggu atau menyerah.
 *
 * Dipakai tombol “Kirim ulang” di halaman API & Webhook. Tiga hal yang dijaga:
 *
 *  - barisnya milik tenant ini (bukan id tebakan dari workspace lain);
 *  - yang sudah `delivered` ditolak — mengirimnya lagi hanya akan membuat
 *    penerima melihat kiriman yang sama untuk kedua kalinya;
 *  - endpoint-nya masih ada & aktif; endpoint yang sudah dihapus/dimatikan
 *    dikembalikan sebagai alasan yang bisa dibaca, bukan kegagalan jaringan.
 *
 * Penghitung `attempts` **direset**: tombol ini adalah kesempatan baru sesudah
 * penerimanya diperbaiki, bukan percobaan keenam dari jadwal mundur yang sudah
 * menyerah.
 */
export const beginRetryDelivery = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    deliveryId: v.id("webhookDeliveries"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    deliveryId: string;
    url: string;
    secret: string;
    event: string;
    payload: string;
    attempts: number;
  }> => {
    // Gerbang fiturnya sengaja **tidak** dipakai, sama seperti pekerja percobaan
    // ulang: kiriman yang sudah ditulis harus bisa diselesaikan, dan mengunci
    // tombolnya saat paket berubah hanya menambah kiriman yang tak pernah sampai.
    await requirePermission(ctx, args.tenantId, args.actorId, "api.manage");

    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.tenantId !== args.tenantId) {
      throw new Error("Kiriman webhook tidak ditemukan untuk tenant ini.");
    }
    if (delivery.status === "delivered") {
      throw new Error("Kiriman ini sudah diterima penerima; tidak perlu dikirim ulang.");
    }

    const endpoint = await ctx.db.get(delivery.endpointId);
    const stopReason = retryStopReason(endpoint);
    if (stopReason !== null || !endpoint) {
      throw new Error(stopReason ?? "Endpoint webhook sudah tidak ada; kiriman tidak bisa dikirim ulang.");
    }

    await ctx.db.patch(delivery._id, {
      status: "pending",
      attempts: 0,
      nextAttemptAt: Date.now(),
      lastError: undefined,
    });

    return {
      deliveryId: delivery._id as string,
      url: endpoint.url,
      secret: endpoint.secret,
      event: delivery.event,
      payload: delivery.payload,
      attempts: 0,
    };
  },
});

/**
 * Tombol “Kirim ulang” di riwayat kiriman.
 *
 * Bedanya dengan “Kirim uji”: yang dikirim adalah **kiriman yang benar-benar
 * terjadi** (mis. `stock.changed` dari penjualan tadi), dengan `id` yang sama di
 * badan kiriman — jadi penerima yang sudah menerimanya mengenalinya sebagai
 * kiriman yang sama, bukan penjualan kedua. Ini jalur penyembuhan setelah
 * penerimanya diperbaiki (mis. rahasianya baru dicocokkan).
 */
export const retryDelivery = action({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    deliveryId: v.id("webhookDeliveries"),
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
    const prepared = await ctx.runMutation(internal.apiAccess.beginRetryDelivery, args);
    const result = await postSignedDelivery({
      url: prepared.url,
      secret: prepared.secret,
      payload: prepared.payload,
      timestamp: Date.now(),
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
  args: {
    plaintext: v.string(),
    resource: v.string(),
    /**
     * Toko yang dituju (`?storeCode=`), opsional. Kosong = toko pertama
     * workspace seperti sebelumnya; kode yang tidak dikenal dijawab 404 supaya
     * platform tidak diam-diam menulis ke toko yang salah.
     */
    storeCode: v.optional(v.union(v.null(), v.string())),
  },
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

    // Toko: kode yang diminta dipilih di sini, bukan di jalur tulis masing-masing
    // — supaya pemilihan toko hanya punya satu arti (`?storeCode=`).
    const stores = await ctx.db
      .query("stores")
      .withIndex("by_tenant", (q) => q.eq("tenantId", key.tenantId))
      .collect();
    const wanted = (args.storeCode ?? "").trim().toUpperCase();
    const store =
      wanted.length === 0
        ? stores[0] ?? null
        : stores.find((row) => row.code.trim().toUpperCase() === wanted) ?? null;
    if (wanted.length > 0 && !store) {
      return {
        ok: false as const,
        status: 404,
        error: `Toko dengan kode ${wanted} tidak ada di workspace ini. Kode yang tersedia: ${
          stores.map((row) => row.code).join(", ") || "belum ada toko"
        }.`,
      };
    }

    return {
      ok: true as const,
      keyId: key._id as string,
      tenantId: key.tenantId,
      storeId: store?._id ?? null,
      storeCode: store?.code ?? null,
      storeName: store?.name ?? null,
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
    storeCode: v.optional(v.union(v.null(), v.string())),
    days: v.optional(v.number()),
    limit: v.optional(v.number()),
    /** Hanya baris yang lebih baru dari ini (milidetik epoch); mengalahkan `days`. */
    since: v.optional(v.number()),
    /** Batas bawah eksplisit (inklusif) & batas atas (eksklusif) dari `from`/`to`. */
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    /** Saringan status penjualan: `completed` (bawaan), `void`, atau `all`. */
    status: v.optional(v.string()),
    /** SKU terakhir halaman sebelumnya, untuk melanjutkan katalog. */
    cursor: v.optional(v.string()),
    /** Kursor berbasis waktu untuk penjualan, pembelian, pelanggan, dan member. */
    cursorAt: v.optional(v.number()),
    cursorKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = clampNumber(args.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const cursor =
      args.cursorAt === undefined || args.cursorKey === undefined
        ? null
        : { at: args.cursorAt, key: args.cursorKey };
    /** Rentang tanggal yang dipakai server, apa pun parameternya. */
    const rangeLabel = (from: number, to: number | null) => ({
      from: new Date(from).toISOString(),
      to: to === null ? null : new Date(to).toISOString(),
    });

    if (args.resource === "ping") {
      const tenant = await ctx.db.get(args.tenantId);
      // Daftar toko ikut dikirim supaya platform bisa menemukan `storeCode` yang
      // sah sebelum memesan/menyesuaikan stok — bukan menebak dari nama.
      const stores = await ctx.db
        .query("stores")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect();
      return {
        tenant: tenant?.name ?? null,
        planKey: tenant?.planKey ?? null,
        modules: tenant?.verticals ?? [],
        apiVersion: "v1",
        store: args.storeCode ?? null,
        stores: stores.map((row) => ({
          code: row.code,
          name: row.name,
          active: row.active,
        })),
        serverTime: new Date().toISOString(),
      };
    }

    if (args.resource === "sales") {
      if (!args.storeId) return { sales: [], total: 0, nextCursor: null };
      const storeId = args.storeId as Id<"stores">;
      const days = clampNumber(args.days, DEFAULT_SALES_DAYS, 1, MAX_SALES_DAYS);
      // `since` mengalahkan `days`: dipakai loop sinkronisasi yang menyimpan
      // posisi terakhir, bukan jendela waktu yang bergeser sendiri.
      const since = clampSince(args.since, MAX_SINCE_DAYS);
      const from = args.from ?? since ?? Date.now() - days * 24 * 60 * 60 * 1000;
      const to = args.to ?? null;
      const status = args.status ?? "completed";

      /**
       * Satu potong halaman: semua baris pada rentang, terbaru dulu, sampai
       * `take`. Kursor memecah baris pada milidetik yang sama lewat nomor struk
       * — dua penjualan serempak tidak boleh terlewat di perbatasan halaman.
       */
      const chunk = async (
        boundary: { at: number; key: string } | null,
        take: number,
      ): Promise<Doc<"sales">[]> => {
        const upper = boundary
          ? Math.min(boundary.at, to ?? Number.POSITIVE_INFINITY)
          : to;
        const rows = await ctx.db
          .query("sales")
          .withIndex("by_tenant_store_created", (q) => {
            const ranged = q
              .eq("tenantId", args.tenantId)
              .eq("storeId", storeId)
              .gte("createdAt", from);
            return upper === null ? ranged : ranged.lt("createdAt", upper);
          })
          .order("desc")
          .take(take);
        if (!boundary || (to !== null && boundary.at >= to)) return rows;
        const ties = await ctx.db
          .query("sales")
          .withIndex("by_tenant_store_created", (q) =>
            q
              .eq("tenantId", args.tenantId)
              .eq("storeId", storeId)
              .eq("createdAt", boundary.at),
          )
          .take(200);
        const older = ties
          .filter((row) => row.number < boundary.key)
          .sort((a, b) => (a.number < b.number ? 1 : -1));
        return [...rows, ...older];
      };

      const kept: Doc<"sales">[] = [];
      let boundary = cursor;
      let mayHaveMore = false;
      for (let round = 0; round < 5 && kept.length <= limit; round += 1) {
        const rows = await chunk(boundary, limit + 1);
        mayHaveMore = rows.length >= limit + 1;
        if (rows.length === 0) break;
        for (const row of rows) {
          if (status === "all" || row.status === status) kept.push(row);
          boundary = { at: row.createdAt, key: row.number };
        }
        if (!mayHaveMore) break;
      }

      const page = kept.slice(0, limit);
      const last = page[page.length - 1] ?? null;
      const nextCursor =
        kept.length > limit || (mayHaveMore && last)
          ? encodeCursor(last!.createdAt, last!.number)
          : null;

      const sales = page.map((sale) => ({
        number: sale.number,
        status: sale.status,
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
        // Saat `since`/`from` dipakai, mengirim `days` justru menyesatkan.
        ...(args.from === undefined && since === null ? { days } : {}),
        ...rangeLabel(from, to),
        nextCursor,
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
          /**
           * Konfigurasi modifier item (modul F&B). Kode grup & opsi ikut
           * dikirim supaya platform bisa menawarkan pilihan yang sama tanpa
           * menebak kode — `lines[].modifiers` memakai kode ini, bukan nama.
           */
          modifiers: (product.modifiers ?? []).map((group) => ({
            groupCode: group.code,
            name: group.name,
            minSelect: group.minSelect,
            maxSelect: group.maxSelect,
            options: group.options.map((option) => ({
              optionCode: option.code,
              name: option.name,
              price: option.price,
            })),
          })),
        })),
        total: page.length,
        nextCursor,
      };
    }

    if (args.resource === "purchases") {
      if (!args.storeId) return { purchases: [], total: 0, nextCursor: null };
      const storeId = args.storeId as Id<"stores">;
      const days = clampNumber(args.days, DEFAULT_PURCHASE_DAYS, 1, MAX_PURCHASE_DAYS);
      const since = clampSince(args.since, MAX_SINCE_DAYS);
      const from = args.from ?? since ?? Date.now() - days * 24 * 60 * 60 * 1000;
      const to = args.to ?? null;

      const chunk = async (
        boundary: { at: number; key: string } | null,
        take: number,
      ): Promise<Doc<"goodsReceipts">[]> => {
        const upper = boundary
          ? Math.min(boundary.at, to ?? Number.POSITIVE_INFINITY)
          : to;
        const rows = await ctx.db
          .query("goodsReceipts")
          .withIndex("by_tenant_store_created", (q) => {
            const ranged = q
              .eq("tenantId", args.tenantId)
              .eq("storeId", storeId)
              .gte("createdAt", from);
            return upper === null ? ranged : ranged.lt("createdAt", upper);
          })
          .order("desc")
          .take(take);
        if (!boundary || (to !== null && boundary.at >= to)) return rows;
        const ties = await ctx.db
          .query("goodsReceipts")
          .withIndex("by_tenant_store_created", (q) =>
            q
              .eq("tenantId", args.tenantId)
              .eq("storeId", storeId)
              .eq("createdAt", boundary.at),
          )
          .take(200);
        return [
          ...rows,
          ...ties
            .filter((row) => row.number < boundary.key)
            .sort((a, b) => (a.number < b.number ? 1 : -1)),
        ];
      };

      const rows = await chunk(cursor, limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1] ?? null;
      const nextCursor =
        rows.length > limit && last ? encodeCursor(last.createdAt, last.number) : null;

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
        ...(args.from === undefined && since === null ? { days } : {}),
        ...rangeLabel(from, to),
        nextCursor,
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

    if (args.resource === "inboundWebhooks") {
      const [endpoints, events] = await Promise.all([
        ctx.db
          .query("inboundWebhookEndpoints")
          .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
          .collect(),
        ctx.db
          .query("inboundWebhookEvents")
          .withIndex("by_tenant_created", (q) => q.eq("tenantId", args.tenantId))
          .order("desc")
          .take(limit),
      ]);
      const storeName = new Map<string, string>();
      for (const endpoint of endpoints) {
        if (!endpoint.storeId) continue;
        const store = await ctx.db.get(endpoint.storeId);
        if (store) storeName.set(store._id as string, store.code);
      }
      return {
        endpoints: endpoints.map((endpoint) => ({
          id: endpoint._id as string,
          name: endpoint.name,
          /** Path relatif; tempel ke alamat `.convex.site` deployment. */
          path: `/api/v1/webhooks/incoming/${endpoint.token}`,
          events: sanitizeInboundEvents(endpoint.events),
          active: endpoint.active,
          secretLastFour: endpoint.secretLastFour,
          storeCode: endpoint.storeId ? storeName.get(endpoint.storeId as string) ?? null : null,
          createdAt: new Date(endpoint.createdAt).toISOString(),
          updatedAt: new Date(endpoint.updatedAt).toISOString(),
        })),
        total: endpoints.length,
        events: events.map((row) => ({
          eventId: row.eventId,
          event: row.event,
          status: row.status,
          message: row.message ?? null,
          receivedAt: new Date(row.createdAt).toISOString(),
        })),
        nextCursor: null,
      };
    }

    /**
     * Halaman pelanggan/member: urut pendaftaran terbaru, kursor memakai kode
     * (`B2B-0001` / `MBR-0001`) untuk memecah baris pada waktu yang sama persis.
     * Keduanya jarang lahir serempak, tetapi batas halaman tidak boleh
     * bergantung pada itu.
     */
    if (args.resource === "customers") {
      const from = args.from ?? 0;
      const to = args.to ?? null;
      const chunk = async (
        boundary: { at: number; key: string } | null,
        take: number,
      ): Promise<Doc<"customers">[]> => {
        const upper = boundary
          ? Math.min(boundary.at, to ?? Number.POSITIVE_INFINITY)
          : to;
        const rows = await ctx.db
          .query("customers")
          .withIndex("by_tenant_created", (q) => {
            const ranged = q.eq("tenantId", args.tenantId).gte("createdAt", from);
            return upper === null ? ranged : ranged.lt("createdAt", upper);
          })
          .order("desc")
          .take(take);
        if (!boundary || (to !== null && boundary.at >= to)) return rows;
        const ties = await ctx.db
          .query("customers")
          .withIndex("by_tenant_created", (q) =>
            q.eq("tenantId", args.tenantId).eq("createdAt", boundary.at),
          )
          .take(200);
        return [
          ...rows,
          ...ties
            .filter((row) => row.code < boundary.key)
            .sort((a, b) => (a.code < b.code ? 1 : -1)),
        ];
      };
      const rows = await chunk(cursor, limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1] ?? null;
      const nextCursor =
        rows.length > limit && last ? encodeCursor(last.createdAt, last.code) : null;
      return {
        customers: page.map((row) => ({
          code: row.code,
          name: row.name,
          phone: row.phone ?? null,
          creditLimit: row.creditLimit,
          paymentTermDays: row.paymentTermDays,
          active: row.active,
          createdAt: new Date(row.createdAt).toISOString(),
        })),
        total: page.length,
        ...rangeLabel(from, to),
        nextCursor,
      };
    }

    if (args.resource === "members") {
      const from = args.from ?? 0;
      const to = args.to ?? null;
      const chunk = async (
        boundary: { at: number; key: string } | null,
        take: number,
      ): Promise<Doc<"members">[]> => {
        const upper = boundary
          ? Math.min(boundary.at, to ?? Number.POSITIVE_INFINITY)
          : to;
        const rows = await ctx.db
          .query("members")
          .withIndex("by_tenant_created", (q) => {
            const ranged = q.eq("tenantId", args.tenantId).gte("createdAt", from);
            return upper === null ? ranged : ranged.lt("createdAt", upper);
          })
          .order("desc")
          .take(take);
        if (!boundary || (to !== null && boundary.at >= to)) return rows;
        const ties = await ctx.db
          .query("members")
          .withIndex("by_tenant_created", (q) =>
            q.eq("tenantId", args.tenantId).eq("createdAt", boundary.at),
          )
          .take(200);
        return [
          ...rows,
          ...ties
            .filter((row) => row.code < boundary.key)
            .sort((a, b) => (a.code < b.code ? 1 : -1)),
        ];
      };
      const rows = await chunk(cursor, limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1] ?? null;
      const nextCursor =
        rows.length > limit && last ? encodeCursor(last.createdAt, last.code) : null;
      return {
        members: page.map((row) => ({
          code: row.code,
          name: row.name,
          phone: row.phone ?? null,
          discountPct: row.discountPct,
          active: row.active,
          createdAt: new Date(row.createdAt).toISOString(),
        })),
        total: page.length,
        ...rangeLabel(from, to),
        nextCursor,
      };
    }

    return { error: "Resource tidak dikenal." };
  },
});

/**
 * Hasil satu penulisan lewat API. Bentuknya membawa kode HTTP supaya `http.ts`
 * tidak perlu menebak: 400 = bentuk/data kiriman salah, 409 = aturan bisnis
 * menolak (stok kurang, modul mati, limit kredit habis), 401/403 = kunci.
 * `status` pada keberhasilan hanya dipakai endpoint yang membedakan 201/200.
 */
type ApiWriteResult =
  | { ok: true; status?: number; data: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * Pelaku sebuah penulisan API. Selalu orang sungguhan (`actorId`) — kunci API
 * maupun endpoint webhook masuk hanyalah cara bertindak atas nama pembuatnya,
 * sehingga izin, audit, dan laporan tetap menunjuk satu orang.
 */
interface WriteActor {
  tenantId: Id<"tenants">;
  storeId: Id<"stores"> | null;
  actorId: Id<"users">;
  key: { id: Id<"apiKeys">; name: string } | null;
  endpoint?: { id: Id<"inboundWebhookEndpoints">; name: string } | null;
}

/** Metadata audit yang sama untuk semua jalur tulis API. */
function actorMeta(actor: WriteActor): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    kunci: actor.key?.name ?? null,
    kunciId: actor.key?.id ?? null,
  };
  if (actor.endpoint) {
    meta.endpoint = actor.endpoint.name;
    meta.endpointId = actor.endpoint.id;
  }
  return meta;
}

/**
 * Memeriksa kunci **di dalam transaksi tulis** sebelum apa pun diubah.
 *
 * Autentikasi HTTP sudah memeriksa kunci, tetapi antara pembacaan itu dan
 * penulisan kunci bisa dicabut (atau pembuatnya diturunkan). Pemeriksaan kedua
 * ini yang membuat pencabutan berlaku seketika, bukan sesudah permintaan ini
 * selesai.
 */
async function activeWriteKey(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  keyId: Id<"apiKeys">,
  scope: Permission,
): Promise<{ ok: true; key: Doc<"apiKeys">; actorId: Id<"users"> } | { ok: false; status: number; error: string }> {
  const key = await ctx.db.get(keyId);
  if (!key || key.tenantId !== tenantId) {
    return { ok: false, status: 401, error: "Kunci API tidak valid untuk tenant ini." };
  }
  if (keyStatus(key, Date.now()) !== "active") {
    return { ok: false, status: 401, error: "Kunci API sudah tidak aktif." };
  }
  if (!sanitizeApiScopes(key.scopes).includes(scope)) {
    return { ok: false, status: 403, error: `Kunci ini tidak punya scope ${scope}.` };
  }
  if (!key.createdById) {
    return {
      ok: false,
      status: 409,
      error: "Kunci ini dibuat sebelum ada jejak pembuat; buat kunci baru agar penulisannya bisa diaudit.",
    };
  }
  return { ok: true, key, actorId: key.createdById };
}

/**
 * Pesan galat untuk klien API: **baris pertama saja**, tanpa awalan
 * `Uncaught Error:`. Convex menempelkan stack trace ke `error.message`; stack
 * internal bukan bagian dari kontrak API dan tidak boleh ikut terkirim ke
 * platform mitra. Aturan bisnis tetap dikirim apa adanya (mis. “Stok tidak
 * cukup”), hanya jejak kodenya yang dibuang.
 */
function apiErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.split("\n")[0].trim().replace(/^Uncaught Error:\s*/i, "");
}

/** Salinan data dari `pos.createSale` untuk balasan API. */
function saleResult(
  sale: {
    saleId: Id<"sales">;
    number: string;
    total: number;
    creditAmount: number;
    memberDiscount: number;
    deduplicated: boolean;
  },
): ApiWriteResult {
  return {
    ok: true,
    status: sale.deduplicated ? 200 : 201,
    data: {
      id: sale.saleId as string,
      number: sale.number,
      total: sale.total,
      creditAmount: sale.creditAmount,
      memberDiscount: sale.memberDiscount,
      deduplicated: sale.deduplicated,
    },
  };
}

/** Bentuk pesanan yang sudah lolos `parseExternalOrder` (dipakai dua arah). */
interface ExternalOrderInput {
  idempotencyKey: string;
  lines: {
    sku: string;
    /** Cadangan pencocokan kalau SKU tidak ditemukan (harus unik). */
    name?: string;
    quantity: number;
    unitCode?: string;
    modifiers?: { groupCode: string; optionCodes: string[] }[];
  }[];
  payment: {
    method: "cash" | "qris" | "card" | "transfer";
    amount?: number;
    provider?: string;
    providerRef?: string;
  };
  discount: number;
  customerCode: string | null;
  memberCode: string | null;
}

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

/** Batas pemindaian cadangan nama; katalog di atas ini tetap butuh SKU benar. */
const NAME_FALLBACK_SCAN = 1_000;

/**
 * Mencari produk lewat **nama persis** — cadangan saat SKU tidak ditemukan.
 *
 * Alasannya nyata: katalog marketplace sempat mengurutkan ulang SKU sementara
 * nama produknya tetap sama, dan pesanan yang sudah lunas tidak boleh tertahan
 * hanya karena kodenya bergeser. Pencocokan hanya diterima kalau **tepat satu**
 * produk yang namanya sama; nama kembar menghasilkan `null` supaya server tidak
 * menebak produk yang salah.
 */
async function findProductByName(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  name: string,
): Promise<Doc<"products"> | null> {
  const wanted = name.trim().toUpperCase();
  if (wanted === "") return null;
  const rows = await ctx.db
    .query("products")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .take(NAME_FALLBACK_SCAN);
  const matches = rows.filter(
    (row) => row.name.trim().toUpperCase() === wanted,
  );
  return matches.length === 1 ? matches[0] : null;
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
/**
 * Menerjemahkan pesanan luar (SKU & kode) menjadi penjualan MesinPOS.
 *
 * Dipakai **dua arah**: `POST /api/v1/sales` dan peristiwa webhook masuk
 * `order.created`. Keduanya melewati `pos.createSale`, jadi harga, PPN, diskon
 * member, stok, dan aturan kredit tetap di satu tempat — yang berbeda hanya
 * cara masuknya.
 */
async function applyExternalOrder(
  ctx: MutationCtx,
  actor: WriteActor & { storeId: Id<"stores"> },
  order: ExternalOrderInput,
  auditAction: string,
  options: { fromMarketplace?: boolean } = {},
): Promise<ApiWriteResult> {
  // 1. SKU → produk. Semua baris diperiksa dulu supaya pesanan yang salah tidak
  //    setengah masuk: tidak ada penjualan parsial dari API.
  const items: {
    productId: Id<"products">;
    quantity: number;
    unitCode?: string;
    modifiers?: { groupCode: string; optionCodes: string[] }[];
  }[] = [];
  for (const [index, line] of order.lines.entries()) {
    const product =
      (await findProductBySku(ctx, actor.tenantId, line.sku)) ??
      (line.name ? await findProductByName(ctx, actor.tenantId, line.name) : null);
    if (!product) {
      const byName = line.name
        ? ` Nama "${line.name}" juga tidak menunjuk tepat satu produk.`
        : "";
      return {
        ok: false,
        status: 400,
        error: `Baris ke-${index + 1}: SKU ${line.sku} tidak ditemukan di katalog tenant ini.${byName}`,
      };
    }
    if (!product.active) {
      return {
        ok: false,
        status: 409,
        error: `Baris ke-${index + 1}: produk ${product.sku} sedang nonaktif; aktifkan dulu di halaman Produk.`,
      };
    }
    const item: (typeof items)[number] = {
      productId: product._id,
      quantity: line.quantity,
    };
    if (line.unitCode) item.unitCode = line.unitCode;
    if (line.modifiers && line.modifiers.length > 0) item.modifiers = line.modifiers;
    items.push(item);
  }

  const customer = order.customerCode
    ? await findCustomerByCode(ctx, actor.tenantId, order.customerCode)
    : null;
  if (order.customerCode && !customer) {
    return {
      ok: false,
      status: 400,
      error: `customerCode ${order.customerCode} tidak ditemukan di tenant ini.`,
    };
  }
  const member = order.memberCode
    ? await findMemberByCode(ctx, actor.tenantId, order.memberCode)
    : null;
  if (order.memberCode && !member) {
    return {
      ok: false,
      status: 400,
      error: `memberCode ${order.memberCode} tidak ditemukan di tenant ini.`,
    };
  }

  // 2. Jalur penjualan yang sama dengan kasir. Pelaku bertindak sebagai dirinya
  //    sendiri (`actorId`), jadi izin & auditnya tidak bergantung pada kunci.
  const payExactTotal = order.payment.amount === undefined;
  try {
    const sale = await ctx.runMutation(api.pos.createSale, {
      tenantId: actor.tenantId,
      storeId: actor.storeId,
      cashierId: actor.actorId,
      items,
      discount: order.discount > 0 ? order.discount : undefined,
      payments: [
        {
          method: order.payment.method,
          amount: order.payment.amount ?? 0,
          provider: order.payment.provider,
          providerRef: order.payment.providerRef,
        },
      ],
      idempotencyKey: `api:${actor.tenantId}:${order.idempotencyKey}`,
      customerId: customer?._id,
      memberId: member?._id,
      payExactTotal,
      // Nota yang **berasal dari marketplace** tidak dikabarkan balik ke
      // marketplace sebagai penjualan baru: di sana nota itu sudah ada (dengan
      // nomor mereka), dan `upsertKey` kita adalah nomor MesinPOS — mengirimnya
      // akan tampak seperti penjualan kedua. Stok tetap berangkat lewat antrean
      // stok otomatis, jadi marketplace tetap menerima saldo terbarunya.
      fromMarketplace: options.fromMarketplace === true ? true : undefined,
    });

    if (!sale.deduplicated) {
      await writeAuditLog(ctx, {
        tenantId: actor.tenantId,
        actorId: actor.actorId,
        action: auditAction,
        entity: "sales",
        entityId: sale.saleId as string,
        meta: {
          ...actorMeta(actor),
          idempotencyKey: order.idempotencyKey,
          number: sale.number,
        },
      });
    }
    return saleResult(sale);
  } catch (error) {
    // Aturan bisnis (stok kurang, modul mati, limit kredit) apa adanya dari
    // satu tempat: `pos.createSale`. Diterjemahkan menjadi 409, bukan 400,
    // supaya pengirim tahu bentuknya benar tetapi keadaannya menolak.
    return {
      ok: false,
      status: 409,
      error: apiErrorMessage(error),
    };
  }
}

/**
 * Mencatat pesanan marketplace yang **ditolak** saat masuk lewat jalur API
 * (`POST /api/v1/sales`) supaya sebabnya terlihat di MesinPOS.
 *
 * Sebelumnya jalur ini senyap: marketplace menerima HTTP 400/409, menahan
 * pesanannya di antrean mereka, sementara kartu Pengaturan di MesinPOS tetap
 * berkata “belum ada pesanan”. Dengan mencatat penolakannya di sini, pemilik
 * melihat nomor pesanan dan sebabnya tanpa harus membuka aplikasi marketplace.
 * Hanya kunci bertanda `pbb-order-…` yang dicatat; penjualan API biasa tidak
 * ikut masuk riwayat marketplace.
 */
async function recordMarketplaceOrderRejection(
  ctx: MutationCtx,
  input: {
    tenantId: Id<"tenants">;
    idempotencyKey: string;
    message: string;
    payload: string;
  },
): Promise<void> {
  const key = input.idempotencyKey.trim();
  if (!key.startsWith(MARKETPLACE_ORDER_ID_PREFIX)) return;
  const orderId = key.slice(MARKETPLACE_ORDER_ID_PREFIX.length);
  if (orderId === "") return;

  const pairing = await ctx.db
    .query("marketplacePairings")
    .withIndex("by_tenant", (q) => q.eq("tenantId", input.tenantId))
    .first();
  if (!pairing) return;

  const existing = await ctx.db
    .query("marketplaceInboundOrders")
    .withIndex("by_pairing_order", (q) =>
      q.eq("pairingId", pairing._id).eq("orderId", orderId),
    )
    .first();
  const now = Date.now();
  if (existing) {
    // Nota yang sudah tercatat tidak ditimpa oleh percobaan ulang yang gagal.
    if (existing.status === "applied" || existing.status === "duplicate") return;
    await ctx.db.patch(existing._id, {
      status: "rejected",
      message: input.message,
      payload: input.payload,
      createdAt: now,
    });
    return;
  }

  await ctx.db.insert("marketplaceInboundOrders", {
    tenantId: input.tenantId,
    pairingId: pairing._id,
    orderId,
    event: "order.created",
    status: "rejected",
    message: input.message,
    payload: input.payload,
    createdAt: now,
  });
}

export const recordOrder = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.union(v.null(), v.id("stores")),
    keyId: v.id("apiKeys"),
    idempotencyKey: v.string(),
    lines: v.array(
      v.object({
        sku: v.string(),
        /** Cadangan pencocokan kalau SKU bergeser; harus menunjuk satu produk. */
        name: v.optional(v.string()),
        quantity: v.number(),
        unitCode: v.optional(v.string()),
        /** Modifier item (modul F&B); kode grup + kode opsi. */
        modifiers: v.optional(
          v.array(
            v.object({
              groupCode: v.string(),
              optionCodes: v.array(v.string()),
            }),
          ),
        ),
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
    const checked = await activeWriteKey(ctx, args.tenantId, args.keyId, "pos.sell");
    if (!checked.ok) return checked;
    if (!args.storeId) {
      return {
        ok: false,
        status: 409,
        error: "Tenant ini belum punya toko aktif, jadi penjualan belum bisa dicatat.",
      };
    }
    const result = await applyExternalOrder(
      ctx,
      {
        tenantId: args.tenantId,
        storeId: args.storeId,
        actorId: checked.actorId,
        key: { id: checked.key._id, name: checked.key.name },
      },
      args,
      "api.sale.create",
    );
    if (!result.ok) {
      await recordMarketplaceOrderRejection(ctx, {
        tenantId: args.tenantId,
        idempotencyKey: args.idempotencyKey,
        message: result.error,
        payload: JSON.stringify({
          lines: args.lines,
          payment: args.payment,
          discount: args.discount,
        }),
      });
    }
    return result;
  },
});

/* ------------------------------------------------------------ produk & stok */

/** Saldo stok lokasi jual (bucket tanpa `warehouseId`) sebuah produk di toko. */
async function sellableBalance(
  ctx: MutationCtx,
  storeId: Id<"stores">,
  productId: Id<"products">,
): Promise<number> {
  const levels = await ctx.db
    .query("stockLevels")
    .withIndex("by_product_store", (q) =>
      q.eq("productId", productId).eq("storeId", storeId),
    )
    .collect();
  return levels
    .filter((level) => !level.warehouseId)
    .reduce((sum, level) => sum + level.quantity, 0);
}

/**
 * Mengubah nama/modal, harga/satuan, dan status aktif produk lewat jalur yang
 * sama dengan halaman Produk (`products.update`, `setPricing`, `setActive`).
 * Perubahan apa pun langsung mengirim `product.updated` ke platform.
 */
async function applyProductPatch(
  ctx: MutationCtx,
  actor: WriteActor,
  input: {
    sku: string;
    name?: string;
    price?: number;
    unit?: string;
    active?: boolean;
    cost?: number;
  },
  auditAction: string,
): Promise<ApiWriteResult> {
  const product = await findProductBySku(ctx, actor.tenantId, input.sku);
  if (!product) {
    return {
      ok: false,
      status: 404,
      error: `SKU ${input.sku} tidak ditemukan di katalog tenant ini.`,
    };
  }

  const changed: string[] = [];
  try {
    if (input.name !== undefined || input.cost !== undefined) {
      const result = await ctx.runMutation(api.products.update, {
        tenantId: actor.tenantId,
        actorId: actor.actorId,
        productId: product._id,
        name: input.name,
        cost: input.cost,
      });
      changed.push(...result.changed);
    }
    if (input.price !== undefined || input.unit !== undefined) {
      const result = await ctx.runMutation(api.products.setPricing, {
        tenantId: actor.tenantId,
        actorId: actor.actorId,
        productId: product._id,
        price: input.price,
        unit: input.unit,
      });
      if (input.price !== undefined && result.price !== product.price) changed.push("price");
      if (input.unit !== undefined && (result.unit ?? "PCS") !== (product.unit ?? "PCS")) {
        changed.push("unit");
      }
    }
    if (input.active !== undefined && input.active !== product.active) {
      await ctx.runMutation(api.products.setActive, {
        tenantId: actor.tenantId,
        actorId: actor.actorId,
        productId: product._id,
        active: input.active,
      });
      changed.push("active");
    }
  } catch (error) {
    return {
      ok: false,
      status: 409,
      error: apiErrorMessage(error),
    };
  }

  const latest = await ctx.db.get(product._id);
  if (!latest) {
    return { ok: false, status: 409, error: "Produk hilang saat diubah; coba lagi." };
  }

  const unique = [...new Set(changed)];
  if (unique.length > 0) {
    await writeAuditLog(ctx, {
      tenantId: actor.tenantId,
      actorId: actor.actorId,
      action: auditAction,
      entity: "products",
      entityId: product._id,
      meta: {
        ...actorMeta(actor),
        sku: latest.sku,
        changed: unique,
        price: latest.price,
        active: latest.active,
      },
    });
  }
  return {
    ok: true,
    data: {
      sku: latest.sku,
      name: latest.name,
      price: latest.price,
      unit: latest.unit ?? "PCS",
      active: latest.active,
      cost: latest.cost,
      changed: unique,
    },
  };
}

/** Menghapus produk lewat pagar yang sama dengan halaman Produk. */
async function applyProductDelete(
  ctx: MutationCtx,
  actor: WriteActor,
  sku: string,
  auditAction: string,
): Promise<ApiWriteResult> {
  const product = await findProductBySku(ctx, actor.tenantId, sku);
  if (!product) {
    return { ok: false, status: 404, error: `SKU ${sku} tidak ditemukan di katalog tenant ini.` };
  }
  try {
    const result = await ctx.runMutation(api.products.remove, {
      tenantId: actor.tenantId,
      actorId: actor.actorId,
      productId: product._id,
    });
    await writeAuditLog(ctx, {
      tenantId: actor.tenantId,
      actorId: actor.actorId,
      action: auditAction,
      entity: "products",
      entityId: product._id,
      meta: { ...actorMeta(actor), sku: result.sku, name: result.name },
    });
    return {
      ok: true,
      data: { removed: true, sku: result.sku, name: result.name },
    };
  } catch (error) {
    // Produk yang sudah dipakai transaksi/stok tidak boleh dihapus; pesannya
    // dari `productDeletionCheck` (menyebut alasannya satu per satu).
    return {
      ok: false,
      status: 409,
      error: apiErrorMessage(error),
    };
  }
}

/** Penyesuaian stok lokasi jual: delta relatif atau angka mutlak. */
async function applyStockAdjust(
  ctx: MutationCtx,
  actor: WriteActor & { storeId: Id<"stores"> },
  input: { sku: string; delta?: number; quantity?: number; note?: string },
  auditAction: string,
): Promise<ApiWriteResult> {
  const product = await findProductBySku(ctx, actor.tenantId, input.sku);
  if (!product) {
    return { ok: false, status: 404, error: `SKU ${input.sku} tidak ditemukan di katalog tenant ini.` };
  }
  if (!product.trackStock) {
    return {
      ok: false,
      status: 409,
      error: `Produk ${product.sku} tidak melacak stok (jasa); stoknya tidak bisa disesuaikan.`,
    };
  }

  const balance = await sellableBalance(ctx, actor.storeId, product._id);
  const delta = input.quantity === undefined ? input.delta! : input.quantity - balance;
  if (delta === 0) {
    return { ok: true, data: { sku: product.sku, delta: 0, balance, changed: false } };
  }

  const result = await ctx.runMutation(api.products.adjustStock, {
    tenantId: actor.tenantId,
    storeId: actor.storeId,
    productId: product._id,
    delta,
    note: input.note,
    actorId: actor.actorId,
  });
  await writeAuditLog(ctx, {
    tenantId: actor.tenantId,
    actorId: actor.actorId,
    action: auditAction,
    entity: "products",
    entityId: product._id,
    meta: { ...actorMeta(actor), sku: product.sku, delta, balance: result.balance },
  });
  return {
    ok: true,
    data: { sku: product.sku, delta, balance: result.balance, changed: true },
  };
}

/* ------------------------------------------------- pelanggan & member */

/** Membuat pelanggan B2B baru; kode dari API dihormati, kode kosong dibuat server. */
async function applyCustomerCreate(
  ctx: MutationCtx,
  actor: WriteActor,
  input: {
    name: string;
    code?: string;
    phone?: string;
    creditLimit?: number;
    paymentTermDays?: number;
  },
  auditAction: string,
): Promise<ApiWriteResult> {
  try {
    const created = await ctx.runMutation(api.ar.createCustomer, {
      tenantId: actor.tenantId,
      actorId: actor.actorId,
      name: input.name,
      code: input.code,
      phone: input.phone,
      creditLimit: input.creditLimit,
      paymentTermDays: input.paymentTermDays,
    });
    await writeAuditLog(ctx, {
      tenantId: actor.tenantId,
      actorId: actor.actorId,
      action: auditAction,
      entity: "customers",
      entityId: created.customerId,
      meta: { ...actorMeta(actor), code: created.code, name: created.name },
    });
    return {
      ok: true,
      status: 201,
      data: { id: created.customerId as string, code: created.code, name: created.name },
    };
  } catch (error) {
    return {
      ok: false,
      status: 409,
      error: apiErrorMessage(error),
    };
  }
}

/** Membuat member pelanggan baru; diskon tetap dibatasi aturan `lib/loyalty.ts`. */
async function applyMemberCreate(
  ctx: MutationCtx,
  actor: WriteActor,
  input: { name: string; code?: string; phone?: string; discountPct?: number },
  auditAction: string,
): Promise<ApiWriteResult> {
  try {
    const created = await ctx.runMutation(api.loyalty.create, {
      tenantId: actor.tenantId,
      actorId: actor.actorId,
      name: input.name,
      code: input.code,
      phone: input.phone,
      discountPct: input.discountPct,
    });
    await writeAuditLog(ctx, {
      tenantId: actor.tenantId,
      actorId: actor.actorId,
      action: auditAction,
      entity: "members",
      entityId: created.memberId,
      meta: { ...actorMeta(actor), code: created.code, name: created.name },
    });
    return {
      ok: true,
      status: 201,
      data: { id: created.memberId as string, code: created.code, name: created.name },
    };
  } catch (error) {
    return {
      ok: false,
      status: 409,
      error: apiErrorMessage(error),
    };
  }
}

/* --------------------------------------------------------------- pembatalan */

/** Membatalkan penjualan lewat nomor struk, memakai jalur `pos.voidSale`. */
async function applyVoidSale(
  ctx: MutationCtx,
  actor: WriteActor,
  input: { number: string; reason?: string },
  auditAction: string,
): Promise<ApiWriteResult> {
  const sale = await ctx.db
    .query("sales")
    .withIndex("by_tenant_number", (q) =>
      q.eq("tenantId", actor.tenantId).eq("number", input.number),
    )
    .unique();
  if (!sale) {
    return { ok: false, status: 404, error: `Penjualan ${input.number} tidak ditemukan di tenant ini.` };
  }
  if (actor.storeId && sale.storeId !== actor.storeId) {
    return {
      ok: false,
      status: 404,
      error: `Penjualan ${input.number} bukan milik toko yang dipilih; kosongkan storeCode atau pilih tokonya.`,
    };
  }
  if (sale.status === "void") {
    return {
      ok: true,
      data: { number: sale.number, status: "void", alreadyVoided: true, restocked: false },
    };
  }
  if (sale.status !== "completed") {
    return {
      ok: false,
      status: 409,
      error: `Penjualan ${input.number} belum selesai (status ${sale.status}); hanya penjualan selesai yang bisa dibatalkan.`,
    };
  }

  try {
    await ctx.runMutation(api.pos.voidSale, {
      saleId: sale._id,
      actorId: actor.actorId,
      reason: input.reason,
    });
  } catch (error) {
    return {
      ok: false,
      status: 409,
      error: apiErrorMessage(error),
    };
  }

  await writeAuditLog(ctx, {
    tenantId: actor.tenantId,
    actorId: actor.actorId,
    action: auditAction,
    entity: "sales",
    entityId: sale._id,
    meta: { ...actorMeta(actor), number: sale.number, reason: input.reason },
  });
  return {
    ok: true,
    data: { number: sale.number, status: "void", alreadyVoided: false, restocked: true },
  };
}

/* ------------------------------------------- endpoint tulis berbasis kunci */

export const updateProduct = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    keyId: v.id("apiKeys"),
    sku: v.string(),
    name: v.optional(v.string()),
    price: v.optional(v.number()),
    unit: v.optional(v.string()),
    active: v.optional(v.boolean()),
    cost: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ApiWriteResult> => {
    const checked = await activeWriteKey(ctx, args.tenantId, args.keyId, "product.manage");
    if (!checked.ok) return checked;
    return await applyProductPatch(
      ctx,
      {
        tenantId: args.tenantId,
        storeId: null,
        actorId: checked.actorId,
        key: { id: checked.key._id, name: checked.key.name },
      },
      args,
      "api.product.update",
    );
  },
});

export const deleteProduct = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    keyId: v.id("apiKeys"),
    sku: v.string(),
  },
  handler: async (ctx, args): Promise<ApiWriteResult> => {
    const checked = await activeWriteKey(ctx, args.tenantId, args.keyId, "product.manage");
    if (!checked.ok) return checked;
    return await applyProductDelete(
      ctx,
      {
        tenantId: args.tenantId,
        storeId: null,
        actorId: checked.actorId,
        key: { id: checked.key._id, name: checked.key.name },
      },
      args.sku,
      "api.product.remove",
    );
  },
});

export const adjustStock = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.union(v.null(), v.id("stores")),
    keyId: v.id("apiKeys"),
    sku: v.string(),
    delta: v.optional(v.number()),
    quantity: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ApiWriteResult> => {
    const checked = await activeWriteKey(ctx, args.tenantId, args.keyId, "stock.adjust");
    if (!checked.ok) return checked;
    if (!args.storeId) {
      return {
        ok: false,
        status: 409,
        error: "Tenant ini belum punya toko, jadi stok tidak punya lokasi untuk disesuaikan.",
      };
    }
    return await applyStockAdjust(
      ctx,
      {
        tenantId: args.tenantId,
        storeId: args.storeId,
        actorId: checked.actorId,
        key: { id: checked.key._id, name: checked.key.name },
      },
      { sku: args.sku, delta: args.delta, quantity: args.quantity, note: args.note },
      "api.stock.adjust",
    );
  },
});

export const createCustomer = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    keyId: v.id("apiKeys"),
    name: v.string(),
    code: v.optional(v.string()),
    phone: v.optional(v.string()),
    creditLimit: v.optional(v.number()),
    paymentTermDays: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ApiWriteResult> => {
    const checked = await activeWriteKey(ctx, args.tenantId, args.keyId, "ar.manage");
    if (!checked.ok) return checked;
    return await applyCustomerCreate(
      ctx,
      {
        tenantId: args.tenantId,
        storeId: null,
        actorId: checked.actorId,
        key: { id: checked.key._id, name: checked.key.name },
      },
      {
        name: args.name,
        code: args.code,
        phone: args.phone,
        creditLimit: args.creditLimit,
        paymentTermDays: args.paymentTermDays,
      },
      "api.customer.create",
    );
  },
});

export const createMember = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    keyId: v.id("apiKeys"),
    name: v.string(),
    code: v.optional(v.string()),
    phone: v.optional(v.string()),
    discountPct: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ApiWriteResult> => {
    const checked = await activeWriteKey(ctx, args.tenantId, args.keyId, "member.manage");
    if (!checked.ok) return checked;
    return await applyMemberCreate(
      ctx,
      {
        tenantId: args.tenantId,
        storeId: null,
        actorId: checked.actorId,
        key: { id: checked.key._id, name: checked.key.name },
      },
      { name: args.name, code: args.code, phone: args.phone, discountPct: args.discountPct },
      "api.member.create",
    );
  },
});

export const voidSale = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.union(v.null(), v.id("stores")),
    keyId: v.id("apiKeys"),
    number: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ApiWriteResult> => {
    const checked = await activeWriteKey(ctx, args.tenantId, args.keyId, "pos.void");
    if (!checked.ok) return checked;
    return await applyVoidSale(
      ctx,
      {
        tenantId: args.tenantId,
        storeId: args.storeId,
        actorId: checked.actorId,
        key: { id: checked.key._id, name: checked.key.name },
      },
      { number: args.number, reason: args.reason },
      "api.sale.void",
    );
  },
});

/* --------------------------------------------------- webhook masuk (mitra) */

/** Token URL yang menunjuk satu endpoint masuk; bukan rahasia. */
function newInboundToken(): string {
  return `${INBOUND_TOKEN_PREFIX}${randomToken(
    INBOUND_TOKEN_LENGTH,
    INBOUND_TOKEN_ALPHABET,
  )}`;
}

/** Rahasia penanda tangan endpoint masuk. */
function newInboundSecret(): string {
  return randomToken(INBOUND_SECRET_LENGTH, INBOUND_SECRET_ALPHABET);
}

/** Toko sebuah endpoint masuk: kode yang diminta, atau toko pertama workspace. */
async function resolveStoreByCode(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  code: string | null | undefined,
): Promise<{ ok: true; storeId: Id<"stores"> | null } | { ok: false; error: string }> {
  const stores = await ctx.db
    .query("stores")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  if (!code) return { ok: true, storeId: stores[0]?._id ?? null };
  const wanted = code.trim().toUpperCase();
  const found = stores.find((store) => store.code.trim().toUpperCase() === wanted);
  if (!found) {
    return {
      ok: false,
      error: `Toko dengan kode ${wanted} tidak ada di workspace ini. Kode yang tersedia: ${
        stores.map((store) => store.code).join(", ") || "belum ada toko"
      }.`,
    };
  }
  return { ok: true, storeId: found._id };
}

export const createInboundWebhook = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    keyId: v.id("apiKeys"),
    name: v.string(),
    events: v.array(v.string()),
    secret: v.optional(v.string()),
    storeCode: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ApiWriteResult> => {
    const checked = await activeWriteKey(ctx, args.tenantId, args.keyId, "api.manage");
    if (!checked.ok) return checked;
    // Endpoint masuk adalah komitmen integrasi baru: butuh fitur yang sama
    // dengan membuat kunci webhook keluar.
    await requireFeature(ctx, args.tenantId, checked.actorId, "api.access", "api.manage");

    const existing = await ctx.db
      .query("inboundWebhookEndpoints")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const validation = validateInboundEndpointInput(
      { name: args.name, events: args.events },
      {
        existingNames: existing.map((row) => row.name),
        activeCount: existing.filter((row) => row.active).length,
      },
    );
    if (!validation.ok) return { ok: false, status: 400, error: validation.reason };
    const draft = validation.value;

    let secret = newInboundSecret();
    if (args.secret !== undefined) {
      const verdict = validateWebhookSecret(args.secret);
      if (!verdict.ok) return { ok: false, status: 400, error: verdict.reason };
      secret = verdict.value;
    }

    const store = await resolveStoreByCode(ctx, args.tenantId, args.storeCode);
    if (!store.ok) return { ok: false, status: 404, error: store.error };

    const now = Date.now();
    const token = newInboundToken();
    const endpointId = await ctx.db.insert("inboundWebhookEndpoints", {
      tenantId: args.tenantId,
      name: draft.name,
      token,
      secret,
      secretLastFour: secret.slice(-4),
      events: draft.events,
      active: true,
      storeId: store.storeId ?? undefined,
      createdById: checked.actorId,
      createdAt: now,
      updatedAt: now,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: checked.actorId,
      action: "inboundWebhook.create",
      entity: "inboundWebhookEndpoints",
      entityId: endpointId,
      meta: { ...actorMeta({ tenantId: args.tenantId, storeId: null, actorId: checked.actorId, key: { id: checked.key._id, name: checked.key.name } }), name: draft.name, events: draft.events },
    });

    return {
      ok: true,
      status: 201,
      data: {
        id: endpointId as string,
        name: draft.name,
        token,
        secret,
        events: draft.events,
        storeId: store.storeId ?? null,
      },
    };
  },
});

export const deleteInboundWebhook = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    keyId: v.id("apiKeys"),
    endpointId: v.string(),
  },
  handler: async (ctx, args): Promise<ApiWriteResult> => {
    const checked = await activeWriteKey(ctx, args.tenantId, args.keyId, "api.manage");
    if (!checked.ok) return checked;
    const endpoint = await ctx.db
      .query("inboundWebhookEndpoints")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect()
      .then((rows) => rows.find((row) => (row._id as string) === args.endpointId) ?? null);
    if (!endpoint) {
      return {
        ok: false,
        status: 404,
        error: `Endpoint ${args.endpointId} tidak ada di workspace ini.`,
      };
    }
    await ctx.db.delete(endpoint._id);
    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: checked.actorId,
      action: "inboundWebhook.remove",
      entity: "inboundWebhookEndpoints",
      entityId: endpoint._id,
      meta: { ...actorMeta({ tenantId: args.tenantId, storeId: null, actorId: checked.actorId, key: { id: checked.key._id, name: checked.key.name } }), name: endpoint.name },
    });
    return { ok: true, data: { removed: true, id: endpoint._id as string, name: endpoint.name } };
  },
});

/** Endpoint masuk yang cocok dengan token di URL, atau `null`. */
export const inboundEndpointByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const endpoint = await ctx.db
      .query("inboundWebhookEndpoints")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!endpoint) return null;
    return {
      endpointId: endpoint._id as string,
      tenantId: endpoint.tenantId as string,
      name: endpoint.name,
      secret: endpoint.secret,
      events: sanitizeInboundEvents(endpoint.events),
      active: endpoint.active,
      storeId: endpoint.storeId as string | null,
      createdById: endpoint.createdById as string | null,
    };
  },
});

/**
 * Menerapkan satu peristiwa webhook masuk. Pemeriksaan tanda tangan dilakukan
 * `http.ts` (di luar transaksi, karena butuh badan mentah); fungsi ini yang
 * memastikan endpoint masih aktif, event-nya dilanggan, dan kiriman kembar
 * tidak dijalankan dua kali.
 */
export const receiveInboundEvent = internalMutation({
  args: {
    endpointId: v.id("inboundWebhookEndpoints"),
    eventId: v.string(),
    event: v.string(),
    payload: v.string(),
    data: v.any(),
  },
  handler: async (ctx, args): Promise<ApiWriteResult> => {
    const endpoint = await ctx.db.get(args.endpointId);
    if (!endpoint) {
      return { ok: false, status: 404, error: "Endpoint webhook masuk tidak ditemukan." };
    }
    const record = async (
      status: "applied" | "rejected" | "duplicate",
      message: string | null,
    ) => {
      const now = Date.now();
      await ctx.db.insert("inboundWebhookEvents", {
        tenantId: endpoint.tenantId,
        endpointId: endpoint._id,
        eventId: args.eventId,
        event: args.event,
        status,
        message: message ?? undefined,
        payload: args.payload,
        createdAt: now,
        appliedAt: status === "applied" ? now : undefined,
      });
    };

    if (!endpoint.active) {
      return { ok: false, status: 410, error: "Endpoint webhook masuk sudah dinonaktifkan." };
    }

    const allowed = sanitizeInboundEvents(endpoint.events);
    if (!allowed.includes(args.event)) {
      const message = `Event ${args.event} tidak dilanggan endpoint ini; yang dilanggan: ${allowed.join(", ")}.`;
      await record("rejected", message);
      return { ok: false, status: 400, error: message };
    }

    const duplicate = await ctx.db
      .query("inboundWebhookEvents")
      .withIndex("by_endpoint_event", (q) =>
        q.eq("endpointId", endpoint._id).eq("eventId", args.eventId),
      )
      .first();
    if (duplicate) {
      return {
        ok: true,
        data: {
          duplicate: true,
          eventId: args.eventId,
          event: duplicate.event,
          status: duplicate.status,
          message: duplicate.message ?? null,
        },
      };
    }

    if (!endpoint.createdById) {
      const message =
        "Endpoint ini dibuat sebelum ada jejak pembuat; buat endpoint baru agar peristiwa bisa dijalankan atas nama seseorang.";
      await record("rejected", message);
      return { ok: false, status: 409, error: message };
    }

    const data = (args.data ?? {}) as Record<string, unknown>;
    // Toko: `storeCode` di peristiwa mengalahkan toko bawaan endpoint; tanpa
    // keduanya dipakai toko pertama workspace.
    const requestedStore = inboundStoreCode(data);
    const store = requestedStore
      ? await resolveStoreByCode(ctx, endpoint.tenantId, requestedStore)
      : endpoint.storeId
        ? { ok: true as const, storeId: endpoint.storeId }
        : await resolveStoreByCode(ctx, endpoint.tenantId, null);
    if (!store.ok) {
      await record("rejected", store.error);
      return { ok: false, status: 400, error: store.error };
    }

    const actor: WriteActor = {
      tenantId: endpoint.tenantId,
      storeId: store.storeId,
      actorId: endpoint.createdById,
      key: null,
      endpoint: { id: endpoint._id, name: endpoint.name },
    };
    const withoutStore = { ...data };
    delete withoutStore.storeCode;

    let result: ApiWriteResult;
    if (args.event === "order.created") {
      // Kunci idempotensi `pos.createSale` dibatasi 64 karakter, sedangkan id
      // Convex + id peristiwa mitra bisa lebih panjang. Sidik jari deterministik
      // ini menjaga sifat idempotennya: peristiwa yang sama selalu menghasilkan
      // kunci yang sama, tanpa memotong id sampai bisa bentrok.
      const sidikJari = sha256Hex(
        `${endpoint.tenantId}:${endpoint._id}:${args.eventId}`,
      ).slice(0, 40);
      const parsed = parseExternalOrder({
        ...withoutStore,
        idempotencyKey: `hook:${sidikJari}`,
      });
      if (!parsed.ok) {
        await record("rejected", parsed.reason);
        return { ok: false, status: 400, error: parsed.reason };
      }
      if (!actor.storeId) {
        const message = "Workspace ini belum punya toko, jadi pesanan belum bisa dicatat.";
        await record("rejected", message);
        return { ok: false, status: 409, error: message };
      }
      result = await applyExternalOrder(
        ctx,
        { ...actor, storeId: actor.storeId },
        parsed.value,
        "api.webhook.order",
      );
    } else if (args.event === "stock.adjusted") {
      const parsed = parseStockAdjust(withoutStore);
      if (!parsed.ok) {
        await record("rejected", parsed.reason);
        return { ok: false, status: 400, error: parsed.reason };
      }
      if (!actor.storeId) {
        const message = "Workspace ini belum punya toko, jadi stok tidak punya lokasi.";
        await record("rejected", message);
        return { ok: false, status: 409, error: message };
      }
      result = await applyStockAdjust(
        ctx,
        { ...actor, storeId: actor.storeId },
        parsed.value,
        "api.webhook.stock",
      );
    } else if (args.event === "product.updated") {
      const parsed = parseProductPatch(withoutStore);
      if (!parsed.ok) {
        await record("rejected", parsed.reason);
        return { ok: false, status: 400, error: parsed.reason };
      }
      result = await applyProductPatch(ctx, actor, parsed.value, "api.webhook.product");
    } else {
      const parsed = parseVoidSale(withoutStore);
      if (!parsed.ok) {
        await record("rejected", parsed.reason);
        return { ok: false, status: 400, error: parsed.reason };
      }
      result = await applyVoidSale(ctx, actor, parsed.value, "api.webhook.sale.void");
    }

    if (!result.ok) {
      await record("rejected", result.error);
      return result;
    }
    await record("applied", null);
    return { ok: true, data: { ...result.data, duplicate: false } };
  },
});

/**
 * Menerima satu pesanan yang **terjadi di marketplace** (`POST
 * /api/marketplace/orders`) lalu mencatatnya sebagai penjualan MesinPOS.
 *
 * Bedanya dengan `receiveInboundEvent`: endpoint marketplace tidak dibuat dulu
 * oleh pemilik. Yang membuktikan kiriman adalah **token pairing** (`mp_…`) yang
 * sudah dipegang marketplace dari tautan snapshotnya, jadi pairing langsung
 * membuka arah balik tanpa langkah pendaftaran tambahan.
 *
 * Tetap satu jalur penjualan: `applyExternalOrder` → `pos.createSale`, sehingga
 * harga, PPN, stok, audit, dan piutang dihitung server — bukan dipercaya dari
 * marketplace. `id` pesanan marketplace adalah kunci idempotensi, jadi kiriman
 * ulang (timeout, percobaan berikutnya) tidak menagih dua kali.
 */
export const receiveMarketplaceOrder = internalMutation({
  args: {
    token: v.string(),
    orderId: v.string(),
    event: v.string(),
    data: v.any(),
    payload: v.string(),
  },
  handler: async (ctx, args): Promise<ApiWriteResult> => {
    const pairing = await ctx.db
      .query("marketplacePairings")
      .withIndex("by_token", (q) => q.eq("syncToken", args.token))
      .unique();
    if (!pairing) {
      return {
        ok: false,
        status: 401,
        error: "Token pairing tidak dikenal atau pairing sudah dilepas.",
      };
    }

    const event = (args.event ?? "").trim();
    if (!isMarketplaceInboundEvent(event)) {
      return {
        ok: false,
        status: 400,
        error: `Event "${event}" tidak diterima dari marketplace; yang diterima: ${MARKETPLACE_INBOUND_EVENTS.join(
          ", ",
        )}.`,
      };
    }

    const orderId = (args.orderId ?? "").trim();
    if (orderId === "") {
      return { ok: false, status: 400, error: "id pesanan marketplace wajib diisi." };
    }

    const record = async (
      status: "applied" | "rejected",
      message: string | null,
      saleNumber?: string | null,
    ): Promise<void> => {
      const now = Date.now();
      await ctx.db.insert("marketplaceInboundOrders", {
        tenantId: pairing.tenantId,
        pairingId: pairing._id,
        orderId,
        event,
        status,
        message: message ?? undefined,
        saleNumber: saleNumber ?? undefined,
        payload: args.payload,
        createdAt: now,
        appliedAt: status === "applied" ? now : undefined,
      });
    };

    // Kiriman ulang (id pesanan yang sama) dijawab tanpa menjalankan penjualan
    // kedua — inilah yang membuat percobaan ulang aman bagi marketplace.
    const duplicate = await ctx.db
      .query("marketplaceInboundOrders")
      .withIndex("by_pairing_order", (q) =>
        q.eq("pairingId", pairing._id).eq("orderId", orderId),
      )
      .first();
    if (duplicate) {
      return {
        ok: true,
        data: {
          duplicate: true,
          orderId,
          event: duplicate.event,
          status: duplicate.status,
          number: duplicate.saleNumber ?? null,
          message: duplicate.message ?? null,
        },
      };
    }

    const data = (args.data ?? {}) as Record<string, unknown>;
    const requestedStore = inboundStoreCode(data);
    const store = await resolveStoreByCode(
      ctx,
      pairing.tenantId,
      requestedStore ?? null,
    );
    if (!store.ok) {
      await record("rejected", store.error);
      return { ok: false, status: 400, error: store.error };
    }
    if (!store.storeId) {
      const message =
        "Workspace ini belum punya toko, jadi pesanan marketplace belum bisa dicatat.";
      await record("rejected", message);
      return { ok: false, status: 409, error: message };
    }

    const withoutStore = { ...data };
    delete withoutStore.storeCode;
    const actor: WriteActor = {
      tenantId: pairing.tenantId,
      storeId: store.storeId,
      // Bertindak atas nama pemilik yang memasangkan; izin `pos.sell` ikut
      // diperiksa `pos.createSale` seperti penjualan lain.
      actorId: pairing.pairedBy,
      key: null,
      endpoint: null,
    };

    let result: ApiWriteResult;
    if (event === "order.created") {
      // Kunci idempotensi memakai **bentuk kanonik id pesanan marketplace**
      // (`pbb-order-…`), bukan sidik jari acak. Alasannya: marketplace sudah
      // mengirim pesanan lunas lewat `/api/v1/sales` dengan kunci yang sama;
      // kalau kedua jalur aktif, `pos.createSale` mengenali kuncinya dan hanya
      // membuat **satu** nota (stok tidak berkurang dua kali). Id yang bentuknya
      // tidak memenuhi aturan kunci tetap disidik jari supaya tidak ditolak.
      const canonical = marketplaceOrderKey(orderId);
      const idempotencyKey = isOrderIdempotencyKey(canonical)
        ? canonical
        : `mp:${sha256Hex(`${pairing._id}:${orderId}`).slice(0, 40)}`;
      const parsed = parseExternalOrder(
        prepareMarketplaceOrderBody({
          ...withoutStore,
          idempotencyKey,
        }),
      );
      if (!parsed.ok) {
        await record("rejected", parsed.reason);
        return { ok: false, status: 400, error: parsed.reason };
      }
      result = await applyExternalOrder(
        ctx,
        { ...actor, storeId: store.storeId },
        parsed.value,
        "marketplace.order",
        { fromMarketplace: true },
      );
    } else {
      const parsed = parseVoidSale(withoutStore);
      if (!parsed.ok) {
        await record("rejected", parsed.reason);
        return { ok: false, status: 400, error: parsed.reason };
      }
      result = await applyVoidSale(ctx, actor, parsed.value, "marketplace.void");
    }

    if (!result.ok) {
      await record("rejected", result.error);
      return result;
    }
    const saleNumber =
      typeof result.data.number === "string" ? result.data.number : null;
    await record("applied", null, saleNumber);
    return {
      ok: true,
      data: {
        ...result.data,
        orderId,
        event,
        duplicate: false,
        saleNumber,
      },
    };
  },
});

/**
 * Mencatat ulang pesanan marketplace yang pernah **ditolak** — tombol “Catat
 * ulang” di kartu Pengaturan.
 *
 * Kenapa tombol ini ada: penolakan paling sering disebabkan produk yang belum
 * dikenal (SKU bergeser atau barangnya baru didaftarkan sesudah pesanan lunas
 * terjadi). Sebelumnya satu-satunya jalan adalah menunggu marketplace mencoba
 * lagi — dengan jeda sendiri dan tanpa kepastian. Di sini isi pesanan yang sudah
 * tersimpan diterapkan **ulang** lewat jalur penjualan yang sama, tanpa jaringan
 * dan tanpa meminta marketplace mengirim ulang.
 *
 * Yang **tidak** dilakukan: mengirim apa pun ke marketplace. Pesanan itu sudah
 * ada di sana; kalau marketplace mencoba lagi nanti, kunci idempotensi yang sama
 * membuat MesinPOS menjawab `duplicate` dengan nota yang baru ini — bukan
 * penjualan kedua.
 */
export const retryMarketplaceOrder = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    orderId: v.string(),
  },
  handler: async (ctx, args): Promise<MarketplaceRetryResult> => {
    await requirePermission(ctx, args.tenantId, args.actorId, "pos.sell");

    const orderId = args.orderId.trim();
    if (orderId === "") {
      return { ok: false, saleNumber: null, message: "Nomor pesanan wajib diisi." };
    }

    const pairing = await ctx.db
      .query("marketplacePairings")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .first();
    if (!pairing) {
      return {
        ok: false,
        saleNumber: null,
        message: "Workspace ini belum dipasangkan ke vendor marketplace.",
      };
    }

    const row = await ctx.db
      .query("marketplaceInboundOrders")
      .withIndex("by_pairing_order", (q) =>
        q.eq("pairingId", pairing._id).eq("orderId", orderId),
      )
      .first();
    if (!row) {
      return {
        ok: false,
        saleNumber: null,
        message: `Tidak ada catatan pesanan marketplace ${orderId} di workspace ini.`,
      };
    }
    if (row.status === "applied") {
      return {
        ok: true,
        saleNumber: row.saleNumber ?? null,
        message: row.saleNumber
          ? `Pesanan ${orderId} sudah tercatat sebagai nota ${row.saleNumber}.`
          : `Pesanan ${orderId} sudah tercatat.`,
      };
    }

    const recordFailure = async (message: string): Promise<MarketplaceRetryResult> => {
      await ctx.db.patch(row._id, { status: "rejected", message });
      return { ok: false, saleNumber: null, message };
    };

    const data = marketplaceRetryPayload(row.payload);
    if (!data) {
      return await recordFailure(
        "Isi pesanan yang tersimpan tidak bisa dibaca, jadi tidak ada yang bisa dicatat ulang. Minta marketplace mengirim pesanannya lagi.",
      );
    }

    const requestedStore = inboundStoreCode(data);
    const store = await resolveStoreByCode(
      ctx,
      args.tenantId,
      requestedStore ?? null,
    );
    if (!store.ok) return await recordFailure(store.error);
    if (!store.storeId) {
      return await recordFailure(
        "Workspace ini belum punya toko, jadi pesanan marketplace belum bisa dicatat.",
      );
    }

    const parsed = parseExternalOrder(
      prepareMarketplaceOrderBody({
        ...data,
        idempotencyKey: marketplaceOrderKey(orderId),
      }),
    );
    if (!parsed.ok) return await recordFailure(parsed.reason);

    const result = await applyExternalOrder(
      ctx,
      {
        tenantId: args.tenantId,
        storeId: store.storeId,
        actorId: args.actorId,
        key: null,
        endpoint: null,
      },
      parsed.value,
      "marketplace.order.retry",
      { fromMarketplace: true },
    );
    if (!result.ok) return await recordFailure(result.error);

    const saleNumber =
      typeof result.data.number === "string" ? result.data.number : null;
    await ctx.db.patch(row._id, {
      status: "applied",
      saleNumber: saleNumber ?? undefined,
      message: undefined,
      appliedAt: Date.now(),
    });
    return {
      ok: true,
      saleNumber,
      message: saleNumber
        ? `Pesanan ${orderId} dicatat sebagai nota ${saleNumber}.`
        : `Pesanan ${orderId} berhasil dicatat.`,
    };
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

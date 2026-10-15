import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { auth } from "./auth";
import { API_RESOURCES, type ApiResource } from "./lib/apiKeys";
import { parseExternalOrder } from "./lib/apiOrders";

/**
 * Dua jenis endpoint HTTP di sini:
 *
 * 1. **Webhook provider (masuk)** — Xendit verifies with the shared
 *    `x-callback-token` header; GDCPay's public integration pack is not
 *    documented, so it uses the same shared-token pattern behind
 *    GDCPAY_CALLBACK_TOKEN. Every delivery is recorded in `webhookEvents` for
 *    idempotency — duplicate/out-of-order callbacks are safe.
 * 2. **API publik `/api/v1/*` (`api.access`, Phase 4)** — dibaca dengan kunci
 *    API tenant lewat header `Authorization: Bearer mp_…`. Daftar resource ada
 *    di `lib/apiKeys.ts` (`API_RESOURCES`) supaya scope yang ditawarkan di
 *    halaman selalu sama dengan yang benar-benar diperiksa di sini.
 *    Satu endpoint di antaranya **menulis**: `POST /api/v1/sales` mencatat
 *    pesanan masuk dari sistem luar. Jalur bacanya tetap jalur baca; jalur
 *    tulisnya memakai `handleApiWrite` di bawah, dengan urutan yang sama —
 *    kunci dulu, baru badan pesan.
 *
 * Required env vars (set in the Convex deployment):
 *   XENDIT_CALLBACK_TOKEN, GDCPAY_CALLBACK_TOKEN
 */

const http = httpRouter();

/*
  Rute milik Convex Auth: `/api/auth/*` (jalur masuk) plus dua dokumen yang
  dipakai Convex untuk memverifikasi token yang diterbitkan deployment ini
  sendiri — `/.well-known/openid-configuration` dan `/.well-known/jwks.json`.
  Keduanya yang menjawab `auth.config.ts`; tanpa baris ini, token yang sah tidak
  bisa diverifikasi dan `ctx.auth.getUserIdentity()` selalu kosong.
*/
auth.addHttpRoutes(http);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pickString(
  source: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function handleWebhook(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  req: Request,
  provider: "xendit" | "gdcpay",
  expectedToken: string | undefined,
): Promise<Response> {
  if (!expectedToken) {
    return json({ ok: false, error: "Webhook belum dikonfigurasi." }, 503);
  }

  const provided =
    req.headers.get("x-callback-token") ??
    req.headers.get("x-callback-signature");
  if (provided !== expectedToken) {
    return json({ ok: false, error: "Token callback tidak valid." }, 401);
  }

  const raw = await req.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "Body bukan JSON valid." }, 400);
  }

  const payload = asRecord(parsed);
  const data = asRecord(payload.data);

  const eventId =
    pickString(payload, "id", "event_id", "external_id") ??
    pickString(data, "id", "reference_id") ??
    String(Date.now());

  const type =
    pickString(payload, "event", "event_name", "status", "transaction_status") ??
    "unknown";

  const ingestion = await ctx.runMutation(internal.billing.ingestWebhook, {
    provider,
    eventId,
    type,
    payload: raw,
  });

  if (ingestion.duplicate) {
    return json({ ok: true, duplicate: true });
  }

  // Reconcile a successful subscription charge to the matching invoice.
  const isPaid = /paid|succeeded|settled|capture|complete/i.test(type);
  const invoiceNumber =
    pickString(payload, "external_id", "reference_id", "invoice_number") ??
    pickString(data, "reference_id", "external_id");

  if (isPaid && invoiceNumber) {
    try {
      await ctx.runMutation(internal.billing.confirmPayment, {
        invoiceNumber,
        provider,
        providerRef: eventId,
      });
    } catch {
      // Unknown invoice: acknowledge so the provider stops retrying, the event
      // stays recorded in webhookEvents for manual reconciliation.
      return json({ ok: true, reconciled: false });
    }
    return json({ ok: true, reconciled: true });
  }

  return json({ ok: true, reconciled: false });
}

http.route({
  path: "/webhooks/xendit",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    return await handleWebhook(
      ctx,
      req,
      "xendit",
      process.env.XENDIT_CALLBACK_TOKEN,
    );
  }),
});

http.route({
  path: "/webhooks/gdcpay",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    return await handleWebhook(
      ctx,
      req,
      "gdcpay",
      process.env.GDCPAY_CALLBACK_TOKEN,
    );
  }),
});

type HttpCtx = Parameters<Parameters<typeof httpAction>[0]>[0];

/** Kunci dari `Authorization: Bearer …` (atau `x-api-key` untuk klien sederhana). */
function bearerKey(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1].trim();
  }
  const fallback = req.headers.get("x-api-key");
  return fallback ? fallback.trim() : null;
}

/**
 * Satu jalur untuk semua resource `/api/v1/*`:
 *
 *   1. ambil kunci dari header (tidak ada → 401),
 *   2. `authenticate` memeriksa bentuk kunci, hash, status, scope, **dan izin
 *      pembuatnya saat ini** (401/403/404 dengan pesan yang bisa ditindaklanjuti),
 *   3. baca datanya, catat pemakaian kunci, lalu balas JSON.
 *
 * Urutan itu membuat tidak ada data tenant yang tersentuh sebelum kuncinya sah.
 */
async function handleApi(ctx: HttpCtx, req: Request, resource: string): Promise<Response> {
  const plaintext = bearerKey(req);
  if (!plaintext) {
    return json({ ok: false, error: "Kunci API tidak dikirim (Authorization: Bearer …)." }, 401);
  }

  const auth = await ctx.runQuery(internal.apiAccess.authenticate, { plaintext, resource });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const url = new URL(req.url);
  const days = url.searchParams.get("days");
  const limit = url.searchParams.get("limit");

  const data = await ctx.runQuery(internal.apiAccess.readResource, {
    resource,
    tenantId: auth.tenantId,
    storeId: auth.storeId,
    days: days === null ? undefined : Number(days),
    limit: limit === null ? undefined : Number(limit),
  });

  // Pemakaian kunci dicatat setelah data benar-benar terbaca.
  await ctx.runMutation(internal.apiAccess.touchKey, {
    keyId: auth.keyId as Id<"apiKeys">,
  });

  return json({
    ok: true,
    resource,
    key: auth.keyName,
    scopes: auth.scopes,
    data,
  });
}

/**
 * Jalur **tulis** `/api/v1/*` (`POST`).
 *
 * Urutannya sama seperti jalur baca, dan itu disengaja: kunci diperiksa lebih
 * dulu, baru badan pesan disentuh — jadi tenant yang tidak berhak tidak pernah
 * sampai ke tahap penguraian JSON. Bentuk badan diperiksa oleh aturan murni
 * `lib/apiOrders.ts` (400), sedangkan keputusan bisnis (stok, modul, limit
 * kredit) datang apa adanya dari `pos.createSale` lewat `recordOrder` (409).
 *
 * `201` untuk penjualan baru dan `200` untuk kiriman ulang dengan
 * `idempotencyKey` yang sama: pengirim tahu bedanya tanpa perlu membaca isi.
 */
async function handleApiWrite(
  ctx: HttpCtx,
  req: Request,
  resource: ApiResource,
): Promise<Response> {
  const plaintext = bearerKey(req);
  if (!plaintext) {
    return json({ ok: false, error: "Kunci API tidak dikirim (Authorization: Bearer …)." }, 401);
  }

  const auth = await ctx.runQuery(internal.apiAccess.authenticate, {
    plaintext,
    resource: resource.resource,
  });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!auth.storeId) {
    return json(
      { ok: false, error: "Tenant ini belum punya toko, jadi penjualan tidak bisa dicatat." },
      409,
    );
  }

  const raw = await req.text();
  let parsed: unknown = {};
  if (raw.trim().length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: "Body bukan JSON valid." }, 400);
    }
  }

  const order = parseExternalOrder(parsed);
  if (!order.ok) return json({ ok: false, error: order.reason }, 400);

  const result = await ctx.runMutation(internal.apiAccess.recordOrder, {
    tenantId: auth.tenantId,
    storeId: auth.storeId,
    keyId: auth.keyId as Id<"apiKeys">,
    idempotencyKey: order.value.idempotencyKey,
    lines: order.value.lines,
    payment: order.value.payment,
    discount: order.value.discount,
    customerCode: order.value.customerCode,
    memberCode: order.value.memberCode,
  });

  if (!result.ok) return json({ ok: false, error: result.error }, result.status);

  // Sama seperti jalur baca: pemakaian kunci dicatat setelah tulisannya jadi.
  await ctx.runMutation(internal.apiAccess.touchKey, {
    keyId: auth.keyId as Id<"apiKeys">,
  });

  return json(
    {
      ok: true,
      resource: resource.resource,
      key: auth.keyName,
      data: result.data,
    },
    result.data.deduplicated ? 200 : 201,
  );
}

for (const resource of API_RESOURCES) {
  http.route({
    path: resource.path,
    method: resource.method,
    handler: httpAction(async (ctx, req) =>
      resource.write
        ? await handleApiWrite(ctx, req, resource)
        : await handleApi(ctx, req, resource.resource),
    ),
  });
}

export default http;

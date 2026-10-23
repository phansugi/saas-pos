import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { auth } from "./auth";
import { API_RESOURCES, type ApiResource } from "./lib/apiKeys";
import { parseExternalOrder } from "./lib/apiOrders";
import {
  decodeCursor,
  parseDateRange,
  parseSaleStatus,
} from "./lib/apiQuery";
import {
  parseCustomerCreate,
  parseInboundEndpointCreate,
  parseInboundEndpointDelete,
  parseMemberCreate,
  parseProductDelete,
  parseProductPatch,
  parseStockAdjust,
  parseVoidSale,
} from "./lib/apiWrites";
import {
  INBOUND_HEADERS,
  INBOUND_PAYLOAD_MAX,
  INBOUND_WEBHOOK_PATH,
  inboundSignatureProblem,
  isInboundToken,
  parseInboundEnvelope,
} from "./lib/inboundWebhooks";
import {
  MARKETPLACE_INBOUND_EVENTS,
  MARKETPLACE_INBOUND_PATH,
  MARKETPLACE_SNAPSHOT_ERRORS,
  isMarketplaceSyncToken,
  prepareMarketplaceOrderBody,
} from "./lib/marketplace";

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

  const url = new URL(req.url);
  const storeCode = url.searchParams.get("storeCode");
  const auth = await ctx.runQuery(internal.apiAccess.authenticate, {
    plaintext,
    resource,
    storeCode: storeCode === null ? undefined : storeCode,
  });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const days = url.searchParams.get("days");
  const limit = url.searchParams.get("limit");
  const since = url.searchParams.get("since");

  // `from`/`to` diperiksa bentuknya sebelum menyentuh data: rentang yang salah
  // harus dijawab 400, bukan diam-diam memakai jendela bawaan.
  const range = parseDateRange(url.searchParams.get("from"), url.searchParams.get("to"));
  if (!range.ok) return json({ ok: false, error: range.reason }, 400);
  const status = parseSaleStatus(url.searchParams.get("status"));
  if (!status.ok) return json({ ok: false, error: status.reason }, 400);

  // Katalog memakai kursor SKU (teks bebas), daftar bertanggal memakai kursor
  // `waktu|kunci`. Keduanya datang dari `nextCursor` balasan sebelumnya.
  const rawCursor = url.searchParams.get("cursor");
  let skuCursor: string | undefined;
  let cursorAt: number | undefined;
  let cursorKey: string | undefined;
  if (resource === "products") {
    skuCursor = rawCursor ?? undefined;
  } else {
    const decoded = decodeCursor(rawCursor);
    if (!decoded.ok) return json({ ok: false, error: decoded.reason }, 400);
    if (decoded.value) {
      cursorAt = decoded.value.at;
      cursorKey = decoded.value.key;
    }
  }

  const data = await ctx.runQuery(internal.apiAccess.readResource, {
    resource,
    tenantId: auth.tenantId,
    storeId: auth.storeId,
    storeCode: auth.storeCode,
    days: days === null ? undefined : Number(days),
    limit: limit === null ? undefined : Number(limit),
    since: since === null ? undefined : Number(since),
    from: range.from ?? undefined,
    to: range.to ?? undefined,
    status: status.value,
    cursor: skuCursor,
    cursorAt,
    cursorKey,
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
    store: auth.storeCode,
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

  const url = new URL(req.url);
  const storeCode = url.searchParams.get("storeCode");
  const auth = await ctx.runQuery(internal.apiAccess.authenticate, {
    plaintext,
    resource: resource.resource,
    storeCode: storeCode === null ? undefined : storeCode,
  });
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const raw = await req.text();
  let parsed: unknown = {};
  if (raw.trim().length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: "Body bukan JSON valid." }, 400);
    }
  }

  const keyId = auth.keyId as Id<"apiKeys">;
  // `storeId` hanya ikut ke endpoint yang memang punya lokasi (penjualan,
  // penyesuaian stok, pembatalan). Endpoint katalog/pelanggan/member/webhook
  // bekerja pada tenant, jadi mengirimnya justru ditolak validator.
  const base = {
    tenantId: auth.tenantId,
    keyId,
  };
  const atStore = { ...base, storeId: auth.storeId };

  /** Balasan sukses/gagal yang seragam; `extra` menambah field khusus endpoint. */
  const respond = async (
    result:
      | { ok: true; status?: number; data: Record<string, unknown> }
      | { ok: false; status: number; error: string },
    extra: Record<string, unknown> = {},
  ): Promise<Response> => {
    if (!result.ok) return json({ ok: false, error: result.error }, result.status);
    // Sama seperti jalur baca: pemakaian kunci dicatat setelah tulisannya jadi.
    await ctx.runMutation(internal.apiAccess.touchKey, { keyId });
    return json(
      {
        ok: true,
        resource: resource.resource,
        key: auth.keyName,
        store: auth.storeCode,
        data: { ...result.data, ...extra },
      },
      result.status ?? 200,
    );
  };

  switch (resource.resource) {
    case "sales.create": {
      // Pesanan marketplace boleh membawa field tambahan & baris kembar; yang
      // lain tetap diperiksa dengan kontrak ketat (lihat
      // `prepareMarketplaceOrderBody`).
      const order = parseExternalOrder(prepareMarketplaceOrderBody(parsed));
      if (!order.ok) return json({ ok: false, error: order.reason }, 400);
      const result = await ctx.runMutation(internal.apiAccess.recordOrder, {
        ...atStore,
        idempotencyKey: order.value.idempotencyKey,
        lines: order.value.lines,
        payment: order.value.payment,
        discount: order.value.discount,
        customerCode: order.value.customerCode,
        memberCode: order.value.memberCode,
      });
      return await respond(result);
    }

    case "sales.void": {
      const input = parseVoidSale(parsed);
      if (!input.ok) return json({ ok: false, error: input.reason }, 400);
      const result = await ctx.runMutation(internal.apiAccess.voidSale, {
        ...atStore,
        number: input.value.number,
        reason: input.value.reason,
      });
      return await respond(result);
    }

    case "products.update": {
      const input = parseProductPatch(parsed);
      if (!input.ok) return json({ ok: false, error: input.reason }, 400);
      const result = await ctx.runMutation(internal.apiAccess.updateProduct, {
        ...base,
        sku: input.value.sku,
        name: input.value.name,
        price: input.value.price,
        unit: input.value.unit,
        active: input.value.active,
        cost: input.value.cost,
      });
      return await respond(result);
    }

    case "products.delete": {
      const input = parseProductDelete(parsed);
      if (!input.ok) return json({ ok: false, error: input.reason }, 400);
      const result = await ctx.runMutation(internal.apiAccess.deleteProduct, {
        ...base,
        sku: input.value.sku,
      });
      return await respond(result);
    }

    case "stock.adjust": {
      const input = parseStockAdjust(parsed);
      if (!input.ok) return json({ ok: false, error: input.reason }, 400);
      const result = await ctx.runMutation(internal.apiAccess.adjustStock, {
        ...atStore,
        sku: input.value.sku,
        delta: input.value.delta,
        quantity: input.value.quantity,
        note: input.value.note,
      });
      return await respond(result);
    }

    case "customers.create": {
      const input = parseCustomerCreate(parsed);
      if (!input.ok) return json({ ok: false, error: input.reason }, 400);
      const result = await ctx.runMutation(internal.apiAccess.createCustomer, {
        ...base,
        name: input.value.name,
        code: input.value.code,
        phone: input.value.phone,
        creditLimit: input.value.creditLimit,
        paymentTermDays: input.value.paymentTermDays,
      });
      return await respond(result);
    }

    case "members.create": {
      const input = parseMemberCreate(parsed);
      if (!input.ok) return json({ ok: false, error: input.reason }, 400);
      const result = await ctx.runMutation(internal.apiAccess.createMember, {
        ...base,
        name: input.value.name,
        code: input.value.code,
        phone: input.value.phone,
        discountPct: input.value.discountPct,
      });
      return await respond(result);
    }

    case "inboundWebhooks.create": {
      const input = parseInboundEndpointCreate(parsed);
      if (!input.ok) return json({ ok: false, error: input.reason }, 400);
      const result = await ctx.runMutation(internal.apiAccess.createInboundWebhook, {
        ...base,
        name: input.value.name,
        events: input.value.events,
        secret: input.value.secret,
        storeCode: input.value.storeCode,
      });
      // Alamat lengkap dirangkai dari asal permintaan supaya mitra langsung
      // bisa menempelkannya, tanpa menebak domain `.convex.site`.
      const origin = new URL(req.url).origin;
      const token = result.ok ? String(result.data.token ?? "") : "";
      return await respond(
        result,
        token ? { url: `${origin}${INBOUND_WEBHOOK_PATH}/${token}` } : {},
      );
    }

    case "inboundWebhooks.delete": {
      const input = parseInboundEndpointDelete(parsed);
      if (!input.ok) return json({ ok: false, error: input.reason }, 400);
      const result = await ctx.runMutation(internal.apiAccess.deleteInboundWebhook, {
        ...base,
        endpointId: input.value.id,
      });
      return await respond(result);
    }

    default:
      return json({ ok: false, error: "Endpoint tulis tidak dikenal." }, 404);
  }
}

/**
 * Snapshot pairing untuk marketplace pusatbahanbangunan.com.
 *
 * Route ini **publik tanpa sesi**, tetapi tidak terbuka: kuncinya adalah token
 * rahasia yang dibuat saat pemilik memasangkan workspace ke vendornya
 * (`marketplace.pair`). Token dikirim lewat query `token` atau header
 * `Authorization: Bearer …`, dan begitu pairing dilepas barisnya hilang sehingga
 * token lama langsung ditolak.
 *
 * Setiap tarikan dicatat (`lastPullAt`/`lastPullCounts`) supaya pemilik bisa
 * melihat kapan marketplace benar-benar mengambil data — bukan sekadar “tombol
 * sudah ditekan”.
 */
http.route({
  path: "/api/marketplace/snapshot",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const authorization = req.headers.get("authorization") ?? "";
    const bearer = /^bearer\s+/i.test(authorization)
      ? authorization.replace(/^bearer\s+/i, "").trim()
      : "";
    const token = (url.searchParams.get("token") ?? bearer).trim();

    if (token === "") {
      return new Response(
        JSON.stringify({
          ok: false,
          error: MARKETPLACE_SNAPSHOT_ERRORS.missingToken,
        }),
        {
          status: 401,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
        },
      );
    }

    const result = await ctx.runQuery(internal.marketplace.snapshotForToken, {
      token,
    });
    if (!result.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: result.error }),
        {
          status: 401,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
        },
      );
    }

    await ctx.runMutation(internal.marketplace.recordPull, {
      pairingId: result.pairingId,
      counts: result.counts,
    });

    return new Response(
      JSON.stringify({ ok: true, ...result.snapshot }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      },
    );
  }),
});

/**
 * **Pesanan dari marketplace** (`POST /api/marketplace/orders`).
 *
 * Ini arah yang selama ini tidak ada: penjualan yang terjadi di marketplace
 * harus menjadi penjualan MesinPOS (stok berkurang, nota terbit, laba ikut),
 * bukan hanya angka stok yang menyimpang esok harinya. Marketplace memanggil
 * alamat ini dengan **token pairing** yang sudah dipegangnya — token yang sama
 * dengan tautan snapshot — jadi pairing langsung membuka arah balik tanpa
 * pendaftaran endpoint tambahan.
 *
 * Tanda tangan HMAC (`x-mesinpos-timestamp` + `x-mesinpos-signature`) bersifat
 * **opsional**: kalau dikirim, ia diverifikasi dengan rahasia penanda tangan
 * pairing (rahasia yang sama dengan kiriman MesinPOS → marketplace). Bentuk
 * badannya sama dengan webhook masuk: `{ id, event, data }` dengan event
 * `order.created` atau `sale.voided`.
 */
http.route({
  path: MARKETPLACE_INBOUND_PATH,
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const authorization = req.headers.get("authorization") ?? "";
    const bearer = /^bearer\s+/i.test(authorization)
      ? authorization.replace(/^bearer\s+/i, "").trim()
      : "";
    const token = (url.searchParams.get("token") ?? bearer).trim();
    if (token === "" || !isMarketplaceSyncToken(token)) {
      return json(
        { ok: false, error: "Token pairing marketplace wajib dikirim (Authorization: Bearer mp_…)." },
        401,
      );
    }

    const auth = await ctx.runQuery(internal.marketplace.inboundAuthForToken, {
      token,
    });
    if (!auth) {
      return json({ ok: false, error: MARKETPLACE_SNAPSHOT_ERRORS.invalidToken }, 401);
    }

    const raw = await req.text();
    if (raw.length > INBOUND_PAYLOAD_MAX) {
      return json({ ok: false, error: "Badan kiriman terlalu besar." }, 413);
    }

    const headers = {
      timestamp: req.headers.get(INBOUND_HEADERS.timestamp),
      signature: req.headers.get(INBOUND_HEADERS.signature),
      event: req.headers.get(INBOUND_HEADERS.event),
      eventId: req.headers.get(INBOUND_HEADERS.eventId),
    };
    // Tanda tangan hanya diperiksa kalau memang dikirim: token pairing sudah
    // membuktikan pengirimnya, dan marketplace lama mungkin belum menandatangani
    // arah balik. Yang menandatangani harus memakai rahasia pairing yang sama.
    if (headers.signature) {
      if (!auth.pushSecret) {
        return json(
          {
            ok: false,
            error:
              "Kiriman bertanda tangan, tetapi rahasia penanda tangan pairing belum diisi di MesinPOS.",
          },
          409,
        );
      }
      const problem = inboundSignatureProblem({
        secret: auth.pushSecret,
        body: raw,
        headers,
        now: Date.now(),
      });
      if (problem) return json({ ok: false, error: problem }, 401);
    }

    const envelope = parseInboundEnvelope(raw, headers);
    if (!envelope.ok) return json({ ok: false, error: envelope.reason }, 400);
    if (!(MARKETPLACE_INBOUND_EVENTS as readonly string[]).includes(envelope.value.event)) {
      return json(
        {
          ok: false,
          error: `Event "${envelope.value.event}" tidak diterima dari marketplace; yang diterima: ${MARKETPLACE_INBOUND_EVENTS.join(
            ", ",
          )}.`,
        },
        400,
      );
    }

    const result = await ctx.runMutation(
      internal.apiAccess.receiveMarketplaceOrder,
      {
        token,
        orderId: envelope.value.id,
        event: envelope.value.event,
        data: envelope.value.data,
        payload: raw,
      },
    );
    if (!result.ok) return json({ ok: false, error: result.error }, result.status);

    const duplicate = result.data.duplicate === true;
    // Bentuk balasan sama dengan endpoint tulis `/api/v1/*`: `data` terpisah
    // dari status, jadi marketplace bisa membaca `data.number` tanpa menebak.
    return json(
      {
        ok: true,
        resource: "marketplace.orders",
        data: result.data,
      },
      duplicate ? 200 : 201,
    );
  }),
});

/**
 * **Webhook masuk** dari platform mitra (`POST /api/v1/webhooks/incoming/<token>`).
 *
 * Berbeda dari endpoint `/api/v1/*` lain: tidak ada kunci API di sini. Yang
 * membuktikan kiriman adalah tanda tangan HMAC endpoint (header yang sama dengan
 * webhook keluar), jadi urutannya: token → endpoint → tanda tangan → badan
 * pesan. Badan mentah harus dibaca **sebelum** diurai karena HMAC dihitung atas
 * teks persis yang dikirim, bukan atas hasil JSON.stringify.
 */
http.route({
  pathPrefix: `${INBOUND_WEBHOOK_PATH}/`,
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const token = url.pathname
      .slice(`${INBOUND_WEBHOOK_PATH}/`.length)
      .replace(/\/+$/, "");
    if (!isInboundToken(token)) {
      return json({ ok: false, error: "Endpoint webhook masuk tidak dikenal." }, 404);
    }

    const endpoint = await ctx.runQuery(internal.apiAccess.inboundEndpointByToken, {
      token,
    });
    if (!endpoint) {
      return json({ ok: false, error: "Endpoint webhook masuk tidak dikenal." }, 404);
    }
    if (!endpoint.active) {
      return json({ ok: false, error: "Endpoint webhook masuk sudah dinonaktifkan." }, 410);
    }

    const raw = await req.text();
    if (raw.length > INBOUND_PAYLOAD_MAX) {
      return json({ ok: false, error: "Badan kiriman terlalu besar." }, 413);
    }

    const headers = {
      timestamp: req.headers.get(INBOUND_HEADERS.timestamp),
      signature: req.headers.get(INBOUND_HEADERS.signature),
      event: req.headers.get(INBOUND_HEADERS.event),
      eventId: req.headers.get(INBOUND_HEADERS.eventId),
    };
    const signatureProblem = inboundSignatureProblem({
      secret: endpoint.secret,
      body: raw,
      headers,
      now: Date.now(),
    });
    if (signatureProblem) return json({ ok: false, error: signatureProblem }, 401);

    const envelope = parseInboundEnvelope(raw, headers);
    if (!envelope.ok) return json({ ok: false, error: envelope.reason }, 400);

    const result = await ctx.runMutation(internal.apiAccess.receiveInboundEvent, {
      endpointId: endpoint.endpointId as Id<"inboundWebhookEndpoints">,
      eventId: envelope.value.id,
      event: envelope.value.event,
      payload: raw,
      data: envelope.value.data,
    });
    if (!result.ok) return json({ ok: false, error: result.error }, result.status);

    const duplicate = result.data.duplicate === true;
    return json(
      {
        ok: true,
        resource: "inboundWebhooks.receive",
        event: envelope.value.event,
        duplicate,
        data: result.data,
      },
      duplicate ? 200 : 202,
    );
  }),
});

for (const resource of API_RESOURCES) {
  // Endpoint bertanda tangan punya rute sendiri di atas (token ada di URL).
  if (resource.auth === "signature") continue;
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

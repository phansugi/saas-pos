/**
 * Uji **penjualan & stok MesinPOS → marketplace**: aturan murni dan jalur nyata
 * di deployment.
 *
 * Yang dibuktikan:
 *
 *   1. **Aturan murni** — urutan endpoint dorongan penjualan, penggabungan
 *      antrean (tanpa duplikat, nota terbaru dipertahankan saat penuh), bentuk
 *      badan kiriman (`upsertKey: "number"`, nota + stok), dan kalimat status.
 *   2. **Jalur nyata** — workspace dipasangkan, satu penjualan dibuat lewat
 *      `pos.createSale` (jalur yang sama dengan kasir & API), lalu antrean
 *      otomatis mengirim/mencatat hasilnya di baris pairing. Karena endpoint
 *      marketplace tidak diisi di deployment dev, hasil yang benar adalah
 *      **gagal dengan sebab yang bisa dibaca** — bukan “tersinkron”.
 *   3. **Tarik snapshot** — marketplace membaca `GET /api/marketplace/snapshot`
 *      dengan token pairing dan menerima penjualan **beserta stok terbarunya**,
 *      jadi kedua data itu benar-benar bisa diperbarui marketplace tanpa endpoint
 *      dorong.
 *
 * Akun uji memakai domain `@mesinpos.test` → jalankan `bun run bersih:uji`
 * sesudahnya.
 *
 * Usage:
 *   VITE_CONVEX_URL=https://<deployment>.convex.cloud bun scripts/verify-marketplace-sales.mjs
 *   SKIP_PUSH=1 VITE_CONVEX_URL=… bun scripts/verify-marketplace-sales.mjs
 */
import { spawnSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../src/convex/_generated/api.js";
import {
  MARKETPLACE_PUSH_HEADERS,
  MARKETPLACE_SALES_QUEUE_LIMIT,
  marketplacePushEnvelope,
  marketplacePushHeaders,
  marketplaceSalesPushBody,
  marketplaceSalesPushEvent,
  marketplaceSalesPushSubject,
  marketplaceSalesPushUrl,
  marketplaceSalesSyncSentence,
  mergeMarketplaceSaleQueue,
} from "../src/convex/lib/marketplace.ts";

const url = process.env.VITE_CONVEX_URL;
if (!url) {
  console.error(
    "VITE_CONVEX_URL tidak diset — jalankan `bun convex dev --once` dulu lalu setel URL deployment.",
  );
  process.exit(1);
}

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pushOnce() {
  console.log("→ push kode backend (`bun convex dev --once`)…");
  const res = spawnSync("bun", ["convex", "dev", "--once"], {
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    encoding: "utf8",
    timeout: 240_000,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  if (!out.includes("Convex functions ready")) {
    throw new Error(`push backend gagal — pemeriksaan dibatalkan:\n${out}`);
  }
  console.log("  ✓ kode terbaru ter-push\n");
}

/* ---------------------------------------------------------- aturan murni */

function pureChecks() {
  check(
    "endpoint penjualan memakai SALES_URL lebih dulu, lalu STOCK/PRODUCTS/SYNC",
    marketplaceSalesPushUrl({ PUSATBAHANBANGUNAN_SALES_URL: "https://m.test/sales" }) ===
      "https://m.test/sales" &&
      marketplaceSalesPushUrl({ PUSATBAHANBANGUNAN_STOCK_URL: "https://m.test/stock" }) ===
        "https://m.test/stock" &&
      marketplaceSalesPushUrl({ PUSATBAHANBANGUNAN_PRODUCTS_URL: "https://m.test/products" }) ===
        "https://m.test/products" &&
      marketplaceSalesPushUrl({ PUSATBAHANBANGUNAN_SYNC_URL: "https://m.test/sync" }) ===
        "https://m.test/sync" &&
      marketplaceSalesPushUrl({}) === "",
    JSON.stringify({
      sales: marketplaceSalesPushUrl({ PUSATBAHANBANGUNAN_SALES_URL: "https://m.test/sales" }),
      kosong: marketplaceSalesPushUrl({}),
    }),
  );

  const headers = marketplacePushHeaders({
    secret: "rahasia-uji-marketplace",
    token: "mp_token",
    pairingCode: "PBB-AAAA-BBBB",
    timestamp: 1_700_000_000_000,
    body: '{"a":1}',
  });
  check(
    "kiriman marketplace selalu membawa timestamp + tanda tangan + token",
    headers[MARKETPLACE_PUSH_HEADERS.timestamp] === "1700000000000" &&
      /^sha256=[a-f0-9]{64}$/.test(headers[MARKETPLACE_PUSH_HEADERS.signature]) &&
      headers[MARKETPLACE_PUSH_HEADERS.pairing] === "PBB-AAAA-BBBB" &&
      headers.authorization === "Bearer mp_token",
    JSON.stringify(headers),
  );

  const merged = mergeMarketplaceSaleQueue({
    saleIds: ["a", "b"],
    incoming: ["b", "c"],
  });
  check(
    "antrean penjualan menggabung tanpa duplikat & urut lama→baru",
    JSON.stringify(merged.saleIds) === JSON.stringify(["a", "b", "c"]),
    JSON.stringify(merged),
  );

  const penuh = mergeMarketplaceSaleQueue({
    saleIds: Array.from({ length: MARKETPLACE_SALES_QUEUE_LIMIT }, (_, i) => `s${i}`),
    incoming: ["baru"],
  });
  check(
    "antrean penuh membuang nota tertua, bukan yang terbaru",
    penuh.saleIds.length === MARKETPLACE_SALES_QUEUE_LIMIT &&
      penuh.saleIds[penuh.saleIds.length - 1] === "baru" &&
      !penuh.saleIds.includes("s0"),
    JSON.stringify({ panjang: penuh.saleIds.length, akhir: penuh.saleIds.at(-1) }),
  );

  const data = marketplaceSalesPushBody({
    generatedAt: 1_700_000_000_000,
    pairing: { vendorId: "v1", vendorName: "Vendor", pairingCode: "PBB-AAAA-BBBB" },
    sales: [
      {
        number: "A-00001",
        status: "completed",
        at: 1_700_000_000_000,
        subtotal: 50_000,
        discount: 0,
        tax: 5_500,
        total: 55_500,
        method: "qris",
        customerCode: null,
        memberCode: null,
        itemCount: 2,
        items: [
          {
            sku: "KOPI",
            name: "Kopi",
            quantity: 2,
            unitPrice: 25_000,
            lineTotal: 50_000,
            modifiers: [],
          },
        ],
      },
    ],
    stock: [{ sku: "KOPI", stock: 8 }],
  });
  const envelope = marketplacePushEnvelope({
    event: marketplaceSalesPushEvent(data.sales),
    at: data.generatedAt,
    subject: marketplaceSalesPushSubject(data.sales),
    upsertKey: "number",
    trigger: "sale",
    pairing: data.pairing,
    data,
  });
  check(
    "badan kiriman: upsert per nomor nota + stok sesudah transaksi",
    data.version === 1 &&
      data.upsertKey === "number" &&
      data.createMissing === true &&
      data.trigger === "sale" &&
      data.sales[0].number === "A-00001" &&
      data.sales[0].items[0].sku === "KOPI" &&
      data.stock[0].stock === 8 &&
      data.pairing.pairingCode === "PBB-AAAA-BBBB",
    JSON.stringify(data).slice(0, 240),
  );
  check(
    "amplop kiriman penjualan: id + event sale.completed + createdAt + data",
    envelope.id.startsWith("evt_") &&
      envelope.id.includes("sale.completed") &&
      envelope.event === "sale.completed" &&
      envelope.createdAt === new Date(1_700_000_000_000).toISOString() &&
      envelope.data === data &&
      envelope.upsertKey === "number",
    JSON.stringify({ id: envelope.id, event: envelope.event }),
  );
  check(
    "pembatalan memakai event sale.voided, bukan sale.completed",
    marketplaceSalesPushEvent([{ status: "void" }]) === "sale.voided" &&
      marketplaceSalesPushEvent([{ status: "completed" }]) === "sale.completed" &&
      marketplaceSalesPushEvent([{ status: "completed" }, { status: "void" }]) ===
        "sale.completed",
    marketplaceSalesPushEvent([{ status: "void" }]),
  );
  check(
    "penanda id kiriman: nomor nota tunggal, jumlah nota bila banyak",
    marketplaceSalesPushSubject([{ number: "A-00001" }]) === "A-00001" &&
      marketplaceSalesPushSubject([{ number: "A-1" }, { number: "A-2" }]) === "2nota",
    marketplaceSalesPushSubject([{ number: "A-1" }, { number: "A-2" }]),
  );

  check(
    "badan kiriman tidak pernah memuat token pairing",
    !JSON.stringify(envelope).includes("syncToken") &&
      !JSON.stringify(envelope).includes("mp_"),
    JSON.stringify(envelope).slice(0, 240),
  );

  check(
    "kalimat status jujur: belum pernah, gagal, dan berhasil",
    marketplaceSalesSyncSentence({
      lastSalesSyncAt: null,
      lastSalesSyncStatus: null,
      lastSalesSyncNote: null,
      lastSalesSyncCounts: null,
    }).includes("belum pernah") &&
      marketplaceSalesSyncSentence({
        lastSalesSyncAt: 1_700_000_000_000,
        lastSalesSyncStatus: "failed",
        lastSalesSyncNote: "endpoint belum diisi",
        lastSalesSyncCounts: null,
      }).includes("gagal: endpoint belum diisi") &&
      marketplaceSalesSyncSentence({
        lastSalesSyncAt: 1_700_000_000_000,
        lastSalesSyncStatus: "delivered",
        lastSalesSyncNote: null,
        lastSalesSyncCounts: { sales: 2, items: 3, stock: 2 },
      }).includes("2 nota, 3 item, 2 SKU stok"),
    "kalimat status tidak sesuai",
  );
}

/* --------------------------------------------------------------- jalur nyata */

const siteCandidates = [
  process.env.VITE_CONVEX_SITE_URL,
  url.replace(/\.convex\.cloud\/?$/, ".convex.site"),
  "http://127.0.0.1:3211",
].filter(Boolean);

let siteUrl = null;

async function main() {
  pureChecks();

  if (process.env.SKIP_PUSH !== "1") pushOnce();

  const client = new ConvexHttpClient(url);
  await client.query(api.tenants.getBySlug, { slug: "__readiness_probe__" });

  const runId = Date.now();
  const { userId } = await client.mutation(api.users.createOrGet, {
    email: `mksale+${runId}@mesinpos.test`,
    name: "Uji Penjualan Marketplace",
  });
  const { tenantId, storeId } = await client.mutation(api.tenants.create, {
    ownerId: userId,
    name: "Toko Uji Marketplace",
    slug: `mksale-${runId}`,
    planKey: "professional",
    storeName: "Toko Uji",
    verticals: ["umkm"],
  });
  const sku = `MKS-${runId}`;
  const created = await client.mutation(api.products.create, {
    tenantId,
    storeId,
    sku,
    name: "Produk Marketplace",
    price: 25_000,
    openingStock: 10,
    actorId: userId,
  });

  const paired = await client.mutation(api.marketplace.pair, {
    tenantId,
    actorId: userId,
    vendorId: `vendor-${runId}`,
    vendorName: "Vendor Uji",
    contactKind: "email",
    contact: "toko@contoh.id",
    contactVerified: false,
  });
  const token = paired.pairing.syncToken;
  check(
    "workspace dipasangkan & token snapshot diterima pemilik",
    typeof token === "string" && token.startsWith("mp_"),
    JSON.stringify(paired.sentence),
  );

  // Tanpa `MARKETPLACE_PUSH_SECRET`, rahasia uji sengaja **tidak** sama dengan
  // rahasia marketplace: yang diuji adalah bahwa tanda tangan benar-benar
  // dihitung dan dikirim — penerima harus menjawab “tanda tangan tidak cocok”,
  // bukan “header tidak ada”. Dengan rahasia asli, ujiannya berubah menjadi
  // “diterima marketplace” (status `delivered`).
  const rahasiaAsli = (process.env.MARKETPLACE_PUSH_SECRET ?? "").trim();
  const rahasiaUji = rahasiaAsli !== "" ? rahasiaAsli : `RahasiaUjiMarketplace${runId}`;
  await client.mutation(api.marketplace.setPushSecret, {
    tenantId,
    actorId: userId,
    secret: rahasiaUji,
  });

  for (const candidate of siteCandidates) {
    try {
      const probe = await fetch(`${candidate}/api/marketplace/snapshot?token=${token}`);
      if (typeof probe.status === "number") {
        siteUrl = candidate;
        break;
      }
    } catch {
      // Coba kandidat berikutnya.
    }
  }
  check("endpoint snapshot marketplace menjawab", siteUrl !== null, siteCandidates.join(" | "));

  const snapshotBefore = await fetch(`${siteUrl}/api/marketplace/snapshot?token=${token}`).then(
    (response) => response.json(),
  );
  const produkSebelum = snapshotBefore.products?.find((row) => row.sku === sku);
  check(
    "snapshot marketplace memuat produk beserta stok lokasi jual (10)",
    snapshotBefore.ok === true && produkSebelum?.stock === 10,
    JSON.stringify(produkSebelum),
  );

  const sale = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    cashierId: userId,
    items: [{ productId: created.productId, quantity: 2 }],
    payments: [{ method: "qris", amount: 55_500 }],
    idempotencyKey: `mksale-${runId}`,
  });
  check(
    "penjualan tercatat (stok 10 → 8, total 55.500)",
    /^A-\d{5}$/.test(sale.number) && sale.total === 55_500,
    JSON.stringify(sale),
  );

  // Antrean otomatis berjalan sesudah transaksi (jeda ± 2 detik + action).
  let status = null;
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    status = await client.query(api.marketplace.status, { tenantId, actorId: userId });
    if (status.pairing?.lastSalesSyncAt) break;
    await sleep(1500);
  }
  check(
    "penjualan otomatis dicatat di baris pairing tanpa menunggu tombol",
    typeof status?.pairing?.lastSalesSyncAt === "number" &&
      status.pairing.lastSalesSyncCounts?.sales === 1 &&
      status.pairing.lastSalesSyncCounts?.stock === 1,
    JSON.stringify(status?.pairing?.lastSalesSyncCounts),
  );
  check(
    "rahasia penanda tangan tersimpan & ditampilkan tanpa nilainya",
    status.pairing.pushSecretSet === true &&
      status.pairing.pushSecretLastFour === rahasiaUji.slice(-4),
    JSON.stringify({
      set: status.pairing.pushSecretSet,
      lastFour: status.pairing.pushSecretLastFour,
    }),
  );
  check(
    rahasiaAsli !== ""
      ? "kiriman bertanda tangan diterima marketplace (status delivered)"
      : "kiriman penjualan ditandatangani: penerima menjawab “tanda tangan tidak cocok”, bukan header hilang",
    status.salesPushEndpointReady === true
      ? rahasiaAsli !== ""
        ? status.pairing.lastSalesSyncStatus === "delivered"
        : String(status.pairing.lastSalesSyncNote ?? "").includes("Tanda tangan tidak cocok")
      : status.pairing.lastSalesSyncStatus === "failed" &&
        String(status.pairing.lastSalesSyncNote ?? "").includes("endpoint dorong belum diisi"),
    JSON.stringify({
      siap: status.salesPushEndpointReady,
      status: status.pairing.lastSalesSyncStatus,
      catatan: status.pairing.lastSalesSyncNote,
    }),
  );

  const snapshotAfter = await fetch(`${siteUrl}/api/marketplace/snapshot?token=${token}`).then(
    (response) => response.json(),
  );
  const produkSesudah = snapshotAfter.products?.find((row) => row.sku === sku);
  const nota = snapshotAfter.sales?.find((row) => row.number === sale.number);
  check(
    "snapshot marketplace menerima nota + stok terbaru (8) tanpa dorongan",
    produkSesudah?.stock === 8 &&
      nota?.items?.some((item) => item.sku === sku && item.quantity === 2) &&
      nota?.total === 55_500,
    JSON.stringify({ stok: produkSesudah?.stock, nota: nota?.number }),
  );

  // Pembatalan: nota yang sama masuk antrean lagi; stok kembali & tercatat.
  await client.mutation(api.pos.voidSale, {
    saleId: sale.saleId,
    actorId: userId,
    reason: "Uji pembatalan marketplace",
  });
  const limit = Date.now() + 25_000;
  let setelahBatal = null;
  while (Date.now() < limit) {
    setelahBatal = await client.query(api.marketplace.status, { tenantId, actorId: userId });
    if ((setelahBatal.pairing?.lastSalesSyncAt ?? 0) > status.pairing.lastSalesSyncAt) break;
    await sleep(1500);
  }
  check(
    "pembatalan ikut antre & tercatat sebagai kiriman baru",
    (setelahBatal?.pairing?.lastSalesSyncAt ?? 0) > status.pairing.lastSalesSyncAt &&
      setelahBatal.pairing.lastSalesSyncCounts?.sales === 1,
    JSON.stringify(setelahBatal?.pairing?.lastSalesSyncCounts),
  );
  const snapshotVoid = await fetch(`${siteUrl}/api/marketplace/snapshot?token=${token}`).then(
    (response) => response.json(),
  );
  check(
    "stok marketplace kembali 10 setelah pembatalan",
    snapshotVoid.products?.find((row) => row.sku === sku)?.stock === 10,
    JSON.stringify(snapshotVoid.products?.find((row) => row.sku === sku)),
  );

  /* ------------------------------- arah balik: pesanan di marketplace */

  const saleSyncSebelumPesanan =
    (await client.query(api.marketplace.status, { tenantId, actorId: userId })).pairing
      ?.lastSalesSyncAt ?? null;
  const orderId = `mp-order-${runId}`;
  const postOrder = (body) =>
    fetch(`${siteUrl}/api/marketplace/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

  const inbound = await postOrder({
    id: orderId,
    event: "order.created",
    data: { lines: [{ sku, quantity: 1 }], payment: { method: "qris" } },
  });
  const inboundBody = await inbound.json();
  check(
    "pesanan marketplace dicatat sebagai penjualan MesinPOS",
    inbound.status === 201 &&
      /^A-\d{5}$/.test(String(inboundBody?.data?.number ?? "")) &&
      inboundBody?.data?.duplicate === false &&
      inboundBody?.data?.orderId === orderId,
    JSON.stringify(inboundBody).slice(0, 300),
  );
  const nomorPesanan = inboundBody?.data?.number;

  const snapshotPesanan = await fetch(
    `${siteUrl}/api/marketplace/snapshot?token=${token}`,
  ).then((response) => response.json());
  check(
    "stok lokasi jual berkurang karena pesanan marketplace (10 → 9)",
    snapshotPesanan.products?.find((row) => row.sku === sku)?.stock === 9,
    JSON.stringify(snapshotPesanan.products?.find((row) => row.sku === sku)),
  );

  // Beri waktu seandainya (salahnya) nota ini ikut masuk antrean dorongan.
  await sleep(3_000);
  const statusPesanan = await client.query(api.marketplace.status, {
    tenantId,
    actorId: userId,
  });
  check(
    "nota dari marketplace tidak dikirim balik sebagai penjualan baru",
    (statusPesanan.pairing?.lastSalesSyncAt ?? null) === saleSyncSebelumPesanan,
    JSON.stringify({
      sebelum: saleSyncSebelumPesanan,
      sesudah: statusPesanan.pairing?.lastSalesSyncAt ?? null,
    }),
  );
  check(
    "kartu menampilkan pesanan marketplace yang diterima",
    statusPesanan.inbound?.orders?.[0]?.orderId === orderId &&
      statusPesanan.inbound.orders[0].status === "applied" &&
      statusPesanan.inbound.orders[0].saleNumber === nomorPesanan,
    JSON.stringify(statusPesanan.inbound?.orders?.[0]),
  );

  const inboundUlang = await postOrder({
    id: orderId,
    event: "order.created",
    data: { lines: [{ sku, quantity: 1 }], payment: { method: "qris" } },
  });
  const ulangBody = await inboundUlang.json();
  const snapshotUlang = await fetch(
    `${siteUrl}/api/marketplace/snapshot?token=${token}`,
  ).then((response) => response.json());
  check(
    "kiriman ulang pesanan yang sama dijawab duplicate tanpa penjualan kedua",
    inboundUlang.status === 200 &&
      ulangBody?.data?.duplicate === true &&
      ulangBody?.data?.number === nomorPesanan &&
      snapshotUlang.products?.find((row) => row.sku === sku)?.stock === 9,
    JSON.stringify({ status: inboundUlang.status, body: ulangBody }).slice(0, 300),
  );

  const voidPesanan = await postOrder({
    id: `mp-void-${runId}`,
    event: "sale.voided",
    data: { number: nomorPesanan, reason: "Batal di marketplace" },
  });
  const voidBody = await voidPesanan.json();
  const snapshotBatalPesanan = await fetch(
    `${siteUrl}/api/marketplace/snapshot?token=${token}`,
  ).then((response) => response.json());
  check(
    "pembatalan dari marketplace mengembalikan stok",
    voidPesanan.status === 201 &&
      voidBody?.data?.status === "void" &&
      snapshotBatalPesanan.products?.find((row) => row.sku === sku)?.stock === 10,
    JSON.stringify({ body: voidBody, stok: snapshotBatalPesanan.products?.find((row) => row.sku === sku)?.stock }).slice(0, 300),
  );
  /* ------------------- dua jalur marketplace tidak menggandakan nota */

  const kunciPesanan = `pbb-order-e2e-${runId}`;
  const saleJalurApi = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    cashierId: userId,
    items: [{ productId: created.productId, quantity: 1 }],
    payments: [{ method: "qris", amount: 0 }],
    payExactTotal: true,
    idempotencyKey: `api:${tenantId}:${kunciPesanan}`,
  });
  const lewatEndpoint = await postOrder({
    id: kunciPesanan,
    event: "order.created",
    data: { lines: [{ sku, quantity: 1 }], payment: { method: "qris" } },
  });
  const lewatEndpointBody = await lewatEndpoint.json();
  const snapshotGanda = await fetch(
    `${siteUrl}/api/marketplace/snapshot?token=${token}`,
  ).then((response) => response.json());
  check(
    "pesanan yang sudah masuk lewat API tidak dibuat dua kali dari endpoint langsung",
    lewatEndpoint.status === 201 &&
      lewatEndpointBody?.data?.deduplicated === true &&
      lewatEndpointBody?.data?.number === saleJalurApi.number &&
      snapshotGanda.products?.find((row) => row.sku === sku)?.stock === 9,
    JSON.stringify({
      status: lewatEndpoint.status,
      body: lewatEndpointBody?.data,
      stok: snapshotGanda.products?.find((row) => row.sku === sku)?.stock,
    }).slice(0, 300),
  );
  const statusNota = await client.query(api.marketplace.status, {
    tenantId,
    actorId: userId,
  });
  check(
    "kartu membaca nota marketplace dari jalur API yang sudah dipakai",
    statusNota.inbound?.sales?.some(
      (row) => row.number === saleJalurApi.number && row.total === saleJalurApi.total,
    ),
    JSON.stringify(statusNota.inbound?.sales),
  );

  /* ------------- kiriman khas marketplace: field tambahan, baris kembar */

  const orderLentur = `pbb-order-lentur-${runId}`;
  const lentur = await postOrder({
    id: orderLentur,
    event: "order.created",
    data: {
      lines: [
        {
          sku,
          name: "Produk Marketplace",
          quantity: "1",
          price: 1,
          imageUrl: "https://media.contoh/a.jpg",
        },
        { sku: sku.toLowerCase(), quantity: 1, unitCode: null },
      ],
      payment: { method: "bank_transfer", status: "paid", providerRef: "TRX-1" },
      note: "kiriman khas marketplace",
      shippingCost: 20_000,
    },
  });
  const lenturBody = await lentur.json();
  const snapshotLentur = await fetch(
    `${siteUrl}/api/marketplace/snapshot?token=${token}`,
  ).then((response) => response.json());
  check(
    "field tambahan & baris kembar dari marketplace tidak menahan pesanan",
    lentur.status === 201 &&
      lenturBody?.data?.duplicate === false &&
      lenturBody?.data?.total === 55_500 &&
      snapshotLentur.products?.find((row) => row.sku === sku)?.stock === 7,
    JSON.stringify({ status: lentur.status, body: lenturBody?.data }).slice(0, 300),
  );

  const orderNama = `pbb-order-nama-${runId}`;
  const lewatNama = await postOrder({
    id: orderNama,
    event: "order.created",
    data: {
      lines: [{ sku: "SKU-BERGESER", name: "Produk Marketplace", quantity: 1 }],
      payment: { method: "qris" },
    },
  });
  const lewatNamaBody = await lewatNama.json();
  const snapshotNama = await fetch(
    `${siteUrl}/api/marketplace/snapshot?token=${token}`,
  ).then((response) => response.json());
  check(
    "SKU yang bergeser dicocokkan lewat nama produk yang unik",
    lewatNama.status === 201 &&
      lewatNamaBody?.data?.total === 27_750 &&
      snapshotNama.products?.find((row) => row.sku === sku)?.stock === 6,
    JSON.stringify({ status: lewatNama.status, body: lewatNamaBody?.data }).slice(0, 300),
  );

  const orderTolak = `pbb-order-tolak-${runId}`;
  const ditolak = await postOrder({
    id: orderTolak,
    event: "order.created",
    data: {
      lines: [{ sku: "TIDAK-ADA", name: "Produk Hilang", quantity: 1 }],
      payment: { method: "qris" },
    },
  });
  const statusTolak = await client.query(api.marketplace.status, {
    tenantId,
    actorId: userId,
  });
  check(
    "pesanan yang ditolak menyebut sebabnya di kartu, bukan hilang senyap",
    ditolak.status === 400 &&
      statusTolak.inbound?.orders?.[0]?.orderId === orderTolak &&
      statusTolak.inbound.orders[0].status === "rejected" &&
      String(statusTolak.inbound.orders[0].message ?? "").includes("tidak ditemukan"),
    JSON.stringify({
      status: ditolak.status,
      baris: statusTolak.inbound?.orders?.[0],
    }).slice(0, 300),
  );

  /* ------------------- catat ulang pesanan yang ditolak (produk diperbaiki) */

  await client.mutation(api.products.update, {
    tenantId,
    actorId: userId,
    productId: created.productId,
    sku: "TIDAK-ADA",
  });
  const retry = await client.mutation(api.apiAccess.retryMarketplaceOrder, {
    tenantId,
    actorId: userId,
    orderId: orderTolak,
  });
  const snapshotRetry = await fetch(
    `${siteUrl}/api/marketplace/snapshot?token=${token}`,
  ).then((response) => response.json());
  const statusRetry = await client.query(api.marketplace.status, {
    tenantId,
    actorId: userId,
  });
  check(
    "pesanan yang ditolak bisa dicatat ulang setelah produknya diperbaiki",
    retry.ok === true &&
      /^A-\d{5}$/.test(String(retry.saleNumber ?? "")) &&
      snapshotRetry.products?.find((row) => row.sku === "TIDAK-ADA")?.stock === 5 &&
      statusRetry.inbound?.orders?.[0]?.orderId === orderTolak &&
      statusRetry.inbound.orders[0].status === "applied" &&
      statusRetry.inbound.orders[0].saleNumber === retry.saleNumber,
    JSON.stringify({ retry, baris: statusRetry.inbound?.orders?.[0] }).slice(0, 400),
  );
  const retryUlang = await client.mutation(api.apiAccess.retryMarketplaceOrder, {
    tenantId,
    actorId: userId,
    orderId: orderTolak,
  });
  const snapshotRetryUlang = await fetch(
    `${siteUrl}/api/marketplace/snapshot?token=${token}`,
  ).then((response) => response.json());
  check(
    "catat ulang dua kali tidak membuat nota kedua",
    retryUlang.ok === true &&
      retryUlang.saleNumber === retry.saleNumber &&
      snapshotRetryUlang.products?.find((row) => row.sku === "TIDAK-ADA")?.stock === 5,
    JSON.stringify(retryUlang),
  );

  check(
    "token salah ditolak sebelum menyentuh data",
    (await fetch(`${siteUrl}/api/marketplace/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer mp_tidak_ada" },
      body: JSON.stringify({ id: "x", event: "order.created", data: {} }),
    })).status === 401,
  );
}

try {
  await main();
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}`);
  console.log(`\n${results.length}/${results.length} checks passed against ${url}`);
} catch (error) {
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}`);
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
}

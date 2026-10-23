/**
 * Uji **langsung** endpoint tulis API v1 terhadap deployment: bukan hanya aturan
 * murni di `scripts/verify-api.mjs`, tetapi HTTP sungguhan dengan kunci API,
 * toko, dan data di database.
 *
 * Yang dibuktikan di sini:
 *
 *   - `PATCH`/`DELETE /api/v1/products` mengubah harga/nama dan menghapus produk
 *     yang belum dipakai transaksi (dan menolak yang sudah dipakai);
 *   - `POST /api/v1/stock/adjust` menggerakkan saldo lokasi jual;
 *   - `POST /api/v1/customers` & `/members` menghormati kode yang dikirim dan
 *     menolak kode kembar;
 *   - `POST /api/v1/sales` menerima modifier item (level pedas, topping) dan
 *     harga/PPN tetap dihitung server;
 *   - `POST /api/v1/sales/void` mengembalikan stok dan idempoten;
 *   - paginasi kursor & saringan `from`/`to` bekerja pada data nyata;
 *   - webhook **masuk** mitra: tanda tangan, langganan event, idempotensi, dan
 *     operasi yang dijalankannya.
 *
 * Akun uji memakai domain `@mesinpos.test`, jadi sesudahnya wajib dibersihkan:
 *   bun run bersih:uji
 *
 * Usage:
 *   VITE_CONVEX_URL=https://<deployment>.convex.cloud bun scripts/verify-api-writes.mjs
 *   SKIP_PUSH=1 VITE_CONVEX_URL=… bun scripts/verify-api-writes.mjs
 */
import { spawnSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../src/convex/_generated/api.js";
import { signWebhookPayload } from "../src/convex/lib/webhooks.ts";
import { INBOUND_HEADERS } from "../src/convex/lib/inboundWebhooks.ts";

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

const siteCandidates = [
  process.env.VITE_CONVEX_SITE_URL,
  url.replace(/\.convex\.cloud\/?$/, ".convex.site"),
  "http://127.0.0.1:3211",
].filter(Boolean);

let siteUrl = null;

async function fetchApi(host, path, key, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  if (key) headers.authorization = `Bearer ${key}`;
  const response = await fetch(`${host}${path}`, { ...init, headers });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Balasan bukan JSON (mis. galat mentah Convex) tetap ditampilkan apa
    // adanya supaya kegagalan bisa dibaca, bukan menjadi `undefined`.
    body = { raw: text.slice(0, 300) };
  }
  return { status: response.status, body };
}

function jsonInit(method, body) {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function main() {
  if (process.env.SKIP_PUSH !== "1") pushOnce();

  const client = new ConvexHttpClient(url);
  await client.query(api.tenants.getBySlug, { slug: "__readiness_probe__" });

  const runId = Date.now();
  const { userId } = await client.mutation(api.users.createOrGet, {
    email: `apiv1+${runId}@mesinpos.test`,
    name: "Integrasi API v1",
  });
  const { tenantId, storeId } = await client.mutation(api.tenants.create, {
    ownerId: userId,
    name: "Workspace API v1",
    slug: `apiv1-${runId}`,
    planKey: "professional",
    storeName: "Toko API v1",
    verticals: ["fnb"],
  });
  await client.mutation(api.billing.changePlan, {
    tenantId,
    newPlanKey: "enterprise",
    actorId: userId,
  });

  const kunci = await client.mutation(api.apiAccess.createKey, {
    tenantId,
    actorId: userId,
    name: "Integrasi Uji",
    scopes: [
      "api.manage",
      "report.view",
      "pos.sell",
      "pos.void",
      "inventory.view",
      "product.manage",
      "stock.adjust",
      "ar.view",
      "ar.manage",
      "member.view",
      "member.manage",
    ],
  });

  for (const candidate of siteCandidates) {
    try {
      const probe = await fetchApi(candidate, "/api/v1/ping", kunci.plaintext);
      if (typeof probe.status === "number") {
        siteUrl = candidate;
        break;
      }
    } catch {
      // Coba kandidat berikutnya.
    }
  }
  check("HTTP action /api/v1 menjawab di salah satu host", siteUrl !== null, siteCandidates.join(" | "));

  const get = (path) => fetchApi(siteUrl, path, kunci.plaintext);
  const send = (method, path, body) =>
    fetchApi(siteUrl, path, kunci.plaintext, jsonInit(method, body));

  const skuKopi = `KOPI-${runId}`;
  const skuHapus = `HAPUS-${runId}`;
  const produkKopi = await client.mutation(api.products.create, {
    tenantId,
    storeId,
    sku: skuKopi,
    name: "Kopi Uji",
    price: 25_000,
    openingStock: 10,
    unit: "PCS",
    actorId: userId,
  });
  await client.mutation(api.products.setModifiers, {
    tenantId,
    actorId: userId,
    productId: produkKopi.productId,
    modifiers: [
      {
        code: "LEVEL",
        name: "Level Pedas",
        minSelect: 1,
        maxSelect: 1,
        options: [
          { code: "1", name: "Level 1", price: 0 },
          { code: "2", name: "Level 2", price: 0 },
          { code: "3", name: "Level 3", price: 0 },
        ],
      },
      {
        code: "TOPPING",
        name: "Topping",
        minSelect: 0,
        maxSelect: 2,
        options: [
          { code: "TELUR", name: "Telur", price: 5_000 },
          { code: "KEJU", name: "Keju", price: 8_000 },
        ],
      },
    ],
  });
  await client.mutation(api.products.create, {
    tenantId,
    storeId,
    sku: skuHapus,
    name: "Produk untuk Dihapus",
    price: 1_000,
    openingStock: 0,
    actorId: userId,
  });

  // ---- ping & pemilihan toko ---------------------------------------------
  const ping = await get("/api/v1/ping");
  check(
    "ping menyebut toko pertama & daftar toko workspace",
    ping.status === 200 &&
      ping.body?.data?.store === "MAIN" &&
      ping.body?.data?.stores?.some((row) => row.code === "MAIN"),
    `${ping.status} ${JSON.stringify(ping.body?.data)?.slice(0, 200)}`,
  );
  const tokoSah = await get("/api/v1/ping?storeCode=main");
  check(
    "storeCode yang sah (tanpa peka huruf) diterima",
    tokoSah.status === 200 && tokoSah.body?.store === "MAIN",
    `${tokoSah.status} ${JSON.stringify(tokoSah.body)}`,
  );
  const tokoAsing = await get("/api/v1/ping?storeCode=CABANG9");
  check(
    "storeCode yang tidak ada ditolak 404 dengan daftar kode yang sah",
    tokoAsing.status === 404 && String(tokoAsing.body?.error ?? "").includes("MAIN"),
    `${tokoAsing.status} ${JSON.stringify(tokoAsing.body)}`,
  );
  const tokoAsingTulis = await fetchApi(
    siteUrl,
    "/api/v1/stock/adjust?storeCode=CABANG9",
    kunci.plaintext,
    jsonInit("POST", { sku: skuKopi, delta: 1 }),
  );
  check(
    "toko asing ditolak sebelum badan pesan ditulis (404)",
    tokoAsingTulis.status === 404,
    `${tokoAsingTulis.status} ${JSON.stringify(tokoAsingTulis.body)}`,
  );

  // ---- katalog: paginasi kursor & modifier --------------------------------
  const halaman1 = await get("/api/v1/products?limit=1");
  check(
    "katalog halaman pertama mengirim kursor lanjutan",
    halaman1.status === 200 &&
      halaman1.body?.data?.products?.length === 1 &&
      typeof halaman1.body?.data?.nextCursor === "string",
    `${halaman1.status} ${JSON.stringify(halaman1.body?.data)?.slice(0, 200)}`,
  );
  const halaman2 = await get(
    `/api/v1/products?limit=1&cursor=${encodeURIComponent(halaman1.body.data.nextCursor)}`,
  );
  check(
    "kursor memindahkan halaman tanpa mengulang produk yang sama",
    halaman2.status === 200 &&
      halaman2.body?.data?.products?.length === 1 &&
      halaman2.body.data.products[0].sku !== halaman1.body.data.products[0].sku,
    `${halaman2.status} ${JSON.stringify(halaman2.body?.data?.products)}`,
  );
  const katalog = await get("/api/v1/products?limit=50");
  const kopiApi = katalog.body?.data?.products?.find((row) => row.sku === skuKopi);
  check(
    "katalog mengirim kode modifier yang dipakai pesanan masuk",
    JSON.stringify(kopiApi?.modifiers?.map((group) => group.groupCode)) ===
      JSON.stringify(["LEVEL", "TOPPING"]) &&
      kopiApi.modifiers[1].options.some((option) => option.optionCode === "TELUR"),
    JSON.stringify(kopiApi?.modifiers),
  );

  // ---- ubah & hapus produk ------------------------------------------------
  const ubah = await send("PATCH", "/api/v1/products", {
    sku: skuKopi.toLowerCase(),
    name: "Kopi Uji Baru",
    price: 30_000,
  });
  check(
    "PATCH mengubah nama & harga lewat SKU (tanpa peka huruf)",
    ubah.status === 200 &&
      ubah.body?.data?.price === 30_000 &&
      ubah.body?.data?.name === "Kopi Uji Baru" &&
      ubah.body?.data?.changed?.includes("price"),
    `${ubah.status} ${JSON.stringify(ubah.body?.data)}`,
  );
  const tanpaPerubahan = await send("PATCH", "/api/v1/products", { sku: skuKopi });
  check(
    "PATCH tanpa field perubahan ditolak 400",
    tanpaPerubahan.status === 400 &&
      String(tanpaPerubahan.body?.error ?? "").includes("minimal satu"),
    `${tanpaPerubahan.status} ${JSON.stringify(tanpaPerubahan.body)}`,
  );
  const skuAsing = await send("PATCH", "/api/v1/products", { sku: `TIDAK-${runId}`, price: 1 });
  check(
    "PATCH SKU yang tidak ada dijawab 404",
    skuAsing.status === 404,
    `${skuAsing.status} ${JSON.stringify(skuAsing.body)}`,
  );

  // ---- stok ---------------------------------------------------------------
  const kurang = await send("POST", "/api/v1/stock/adjust", { sku: skuKopi, delta: -2 });
  check(
    "penyesuaian delta memotong saldo (10 → 8)",
    kurang.status === 200 && kurang.body?.data?.balance === 8,
    `${kurang.status} ${JSON.stringify(kurang.body?.data)}`,
  );
  const pasti = await send("POST", "/api/v1/stock/adjust", { sku: skuKopi, quantity: 20, note: "Hitung ulang" });
  check(
    "penyesuaian angka pasti menetapkan saldo (8 → 20)",
    pasti.status === 200 && pasti.body?.data?.balance === 20,
    `${pasti.status} ${JSON.stringify(pasti.body?.data)}`,
  );
  const duaNiat = await send("POST", "/api/v1/stock/adjust", { sku: skuKopi, delta: 1, quantity: 5 });
  check(
    "delta & quantity sekaligus ditolak 400",
    duaNiat.status === 400 && String(duaNiat.body?.error ?? "").includes("jangan dua-duanya"),
    `${duaNiat.status} ${JSON.stringify(duaNiat.body)}`,
  );

  // ---- pelanggan & member -------------------------------------------------
  // Kode pelanggan/member dibatasi 10 karakter oleh `lib/ar.ts` & `lib/loyalty.ts`.
  const akhiran = String(runId).slice(-6);
  const kodePelanggan = `PLG-${akhiran}`;
  const pelanggan = await send("POST", "/api/v1/customers", {
    name: "Pelanggan Uji",
    code: kodePelanggan,
    phone: "081200000001",
  });
  check(
    "pelanggan baru memakai kode yang dikirim (201)",
    pelanggan.status === 201 && pelanggan.body?.data?.code === kodePelanggan,
    `${pelanggan.status} ${JSON.stringify(pelanggan.body)}`,
  );
  const pelangganKembar = await send("POST", "/api/v1/customers", {
    name: "Pelanggan Kembar",
    code: kodePelanggan,
  });
  check(
    "kode pelanggan kembar ditolak 409",
    pelangganKembar.status === 409 &&
      String(pelangganKembar.body?.error ?? "").includes("sudah dipakai"),
    `${pelangganKembar.status} ${JSON.stringify(pelangganKembar.body)}`,
  );
  const pelangganOtomatis = await send("POST", "/api/v1/customers", { name: "Pelanggan Tanpa Kode" });
  check(
    "kode pelanggan dibuat server kalau tidak dikirim",
    pelangganOtomatis.status === 201 &&
      typeof pelangganOtomatis.body?.data?.code === "string" &&
      pelangganOtomatis.body.data.code.length > 0,
    `${pelangganOtomatis.status} ${JSON.stringify(pelangganOtomatis.body?.data)}`,
  );

  const kodeMember = `MBR-${akhiran}`;
  const member = await send("POST", "/api/v1/members", {
    name: "Member Uji",
    code: kodeMember,
    phone: "081200000002",
  });
  check(
    "member baru memakai kode yang dikirim (201)",
    member.status === 201 && member.body?.data?.code === kodeMember,
    `${member.status} ${JSON.stringify(member.body?.data)}`,
  );
  const memberKembar = await send("POST", "/api/v1/members", { name: "Member Kembar", code: kodeMember });
  check(
    "kode member kembar ditolak 409",
    memberKembar.status === 409,
    `${memberKembar.status} ${JSON.stringify(memberKembar.body)}`,
  );
  const daftarPelanggan = await get("/api/v1/customers");
  const daftarMember = await get("/api/v1/members");
  check(
    "daftar pelanggan & member memuat baris yang baru dibuat",
    daftarPelanggan.body?.data?.customers?.some((row) => row.code === kodePelanggan) &&
      daftarMember.body?.data?.members?.some((row) => row.code === kodeMember),
    JSON.stringify({
      pelanggan: daftarPelanggan.body?.data?.customers?.map((row) => row.code),
      member: daftarMember.body?.data?.members?.map((row) => row.code),
    }),
  );

  // ---- pesanan masuk dengan modifier --------------------------------------
  const orderKey = `masuk-${runId}`;
  const tanpaLevel = await send("POST", "/api/v1/sales", {
    idempotencyKey: `${orderKey}-wajib`,
    lines: [{ sku: skuKopi, quantity: 1, modifiers: [{ groupCode: "TOPPING", optionCodes: ["TELUR"] }] }],
    payment: { method: "qris" },
  });
  check(
    "grup modifier wajib yang tidak dipilih ditolak 409 dari jalur kasir",
    tanpaLevel.status === 409 && String(tanpaLevel.body?.error ?? "").includes("wajib dipilih"),
    `${tanpaLevel.status} ${JSON.stringify(tanpaLevel.body)}`,
  );
  const pesanan = await send("POST", "/api/v1/sales", {
    idempotencyKey: orderKey,
    lines: [
      {
        sku: skuKopi,
        quantity: 2,
        modifiers: [
          { groupCode: "level", optionCodes: ["3"] },
          { groupCode: "TOPPING", optionCodes: ["telur"] },
        ],
      },
    ],
    payment: { method: "qris" },
    customerCode: kodePelanggan,
  });
  // 2 × (30.000 + 5.000 topping) = 70.000, PPN tenant 11% = 7.700.
  check(
    "modifier & PPN dihitung server (2 × 35.000 + PPN = 77.700)",
    pesanan.status === 201 && pesanan.body?.data?.total === 77_700,
    `${pesanan.status} ${JSON.stringify(pesanan.body?.data)}`,
  );
  check(
    "nomor struk dikembalikan untuk pembatalan",
    /^A-\d{5}$/.test(String(pesanan.body?.data?.number)),
    String(pesanan.body?.data?.number),
  );

  // ---- paginasi & saringan tanggal pada penjualan -------------------------
  const jendelaSalah = await get("/api/v1/sales?from=kemarin");
  check(
    "from yang bukan tanggal ditolak 400",
    jendelaSalah.status === 400,
    `${jendelaSalah.status} ${JSON.stringify(jendelaSalah.body)}`,
  );
  const now = Date.now();
  const sempit = await get(
    `/api/v1/sales?from=${now - 3_600_000}&to=${now - 1_800_000}`,
  );
  check(
    "rentang from/to menyaring keluar penjualan di luar jendela",
    sempit.status === 200 &&
      sempit.body?.data?.sales?.every(
        (row) => new Date(row.createdAt).getTime() < now - 1_800_000 + 1000,
      ),
    `${sempit.status} ${JSON.stringify(sempit.body?.data?.sales)}`,
  );
  const luas = await get(`/api/v1/sales?from=${now - 3_600_000}&to=${now + 3_600_000}`);
  check(
    "rentang lebar memuat penjualan modifier tadi",
    luas.status === 200 &&
      luas.body?.data?.sales?.some((row) => row.number === pesanan.body?.data?.number),
    `${luas.status} ${JSON.stringify(luas.body?.data?.sales)?.slice(0, 200)}`,
  );

  // ---- pembatalan ---------------------------------------------------------
  const stokSebelumBatal = await get("/api/v1/products?limit=50");
  const saldoSebelum = stokSebelumBatal.body?.data?.products?.find((row) => row.sku === skuKopi)?.sellable;
  check("stok turun karena pesanan (20 → 18)", saldoSebelum === 18, String(saldoSebelum));
  const batal = await send("POST", "/api/v1/sales/void", {
    number: pesanan.body.data.number,
    reason: "Salah input dari platform",
  });
  check(
    "pembatalan mengembalikan stok dan menandai penjualan void",
    batal.status === 200 &&
      batal.body?.data?.status === "void" &&
      batal.body?.data?.restocked === true,
    `${batal.status} ${JSON.stringify(batal.body?.data)}`,
  );
  const batalUlang = await send("POST", "/api/v1/sales/void", {
    number: pesanan.body.data.number,
  });
  check(
    "pembatalan kedua dijawab idempoten (alreadyVoided, tanpa stok ganda)",
    batalUlang.status === 200 &&
      batalUlang.body?.data?.alreadyVoided === true &&
      batalUlang.body?.data?.restocked === false,
    `${batalUlang.status} ${JSON.stringify(batalUlang.body?.data)}`,
  );
  const stokSesudah = await get("/api/v1/products?limit=50");
  check(
    "stok kembali ke 20 sesudah pembatalan",
    stokSesudah.body?.data?.products?.find((row) => row.sku === skuKopi)?.sellable === 20,
    JSON.stringify(stokSesudah.body?.data?.products?.find((row) => row.sku === skuKopi)),
  );

  // ---- hapus produk -------------------------------------------------------
  const hapusTerpakai = await send("DELETE", "/api/v1/products", { sku: skuKopi });
  check(
    "produk yang sudah dipakai transaksi tidak bisa dihapus (409)",
    hapusTerpakai.status === 409,
    `${hapusTerpakai.status} ${JSON.stringify(hapusTerpakai.body)}`,
  );
  const hapusKosong = await send("DELETE", "/api/v1/products", { sku: skuHapus });
  check(
    "produk tanpa transaksi dihapus lewat API",
    hapusKosong.status === 200 && hapusKosong.body?.data?.removed === true,
    `${hapusKosong.status} ${JSON.stringify(hapusKosong.body?.data)}`,
  );

  // ---- webhook masuk ------------------------------------------------------
  const rahasiaMitra = "RahasiaMitraUjiAPIv1_2026";
  const endpoint = await send("POST", "/api/v1/webhooks", {
    name: "Mitra Uji",
    events: ["order.created", "stock.adjusted"],
    secret: rahasiaMitra,
  });
  check(
    "endpoint webhook masuk dibuat dengan alamat & rahasia sekali tampil",
    endpoint.status === 201 &&
      String(endpoint.body?.data?.url ?? "").includes("/api/v1/webhooks/incoming/whi_") &&
      endpoint.body?.data?.secret === rahasiaMitra,
    `${endpoint.status} ${JSON.stringify(endpoint.body?.data)?.slice(0, 200)}`,
  );
  const daftarEndpoint = await get("/api/v1/webhooks");
  check(
    "daftar endpoint tidak membocorkan rahasia penanda tangan",
    daftarEndpoint.status === 200 &&
      JSON.stringify(daftarEndpoint.body).includes("Mitra Uji") &&
      !JSON.stringify(daftarEndpoint.body).includes(rahasiaMitra),
    JSON.stringify(daftarEndpoint.body)?.slice(0, 240),
  );

  const jalur = new URL(endpoint.body.data.url).pathname;
  async function kirimMasuk({ event, id, data, secret = rahasiaMitra, timestamp = Date.now(), tanpaTandaTangan = false }) {
    const body = JSON.stringify({ id, event, data });
    const headers = {
      "content-type": "application/json",
      [INBOUND_HEADERS.timestamp]: String(timestamp),
      [INBOUND_HEADERS.event]: event,
    };
    if (!tanpaTandaTangan) {
      headers[INBOUND_HEADERS.signature] = signWebhookPayload(secret, timestamp, body);
    }
    const response = await fetch(`${siteUrl}${jalur}`, { method: "POST", headers, body });
    let parsed = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  }

  const salahTanda = await kirimMasuk({
    event: "order.created",
    id: `evt-${runId}-0`,
    data: {},
    secret: "rahasia-yang-salah",
  });
  check(
    "tanda tangan yang salah ditolak 401",
    salahTanda.status === 401,
    `${salahTanda.status} ${JSON.stringify(salahTanda.body)}`,
  );

  const masuk = await kirimMasuk({
    event: "order.created",
    id: `evt-${runId}-1`,
    data: {
      lines: [{ sku: skuKopi, quantity: 1, modifiers: [{ groupCode: "LEVEL", optionCodes: ["1"] }] }],
      payment: { method: "qris" },
    },
  });
  check(
    "peristiwa order.created dijalankan sebagai penjualan (202)",
    masuk.status === 202 &&
      masuk.body?.ok === true &&
      masuk.body?.data?.duplicate === false &&
      /^A-\d{5}$/.test(String(masuk.body?.data?.number)),
    `${masuk.status} ${JSON.stringify(masuk.body)?.slice(0, 240)}`,
  );
  const kembar = await kirimMasuk({
    event: "order.created",
    id: `evt-${runId}-1`,
    data: {
      lines: [{ sku: skuKopi, quantity: 1, modifiers: [{ groupCode: "LEVEL", optionCodes: ["1"] }] }],
      payment: { method: "qris" },
    },
  });
  check(
    "id peristiwa yang sama tidak membuat penjualan kedua (200 duplicate)",
    kembar.status === 200 && kembar.body?.data?.duplicate === true,
    `${kembar.status} ${JSON.stringify(kembar.body)?.slice(0, 200)}`,
  );
  const stokSetelahMasuk = await get("/api/v1/products?limit=50");
  check(
    "penjualan lewat webhook hanya memotong stok sekali (20 → 19)",
    stokSetelahMasuk.body?.data?.products?.find((row) => row.sku === skuKopi)?.sellable === 19,
    JSON.stringify(stokSetelahMasuk.body?.data?.products?.find((row) => row.sku === skuKopi)),
  );

  const stokMasuk = await kirimMasuk({
    event: "stock.adjusted",
    id: `evt-${runId}-2`,
    data: { sku: skuKopi, quantity: 20, note: "Koreksi mitra" },
  });
  check(
    "peristiwa stock.adjusted menetapkan saldo",
    stokMasuk.status === 202 && stokMasuk.body?.data?.balance === 20,
    `${stokMasuk.status} ${JSON.stringify(stokMasuk.body?.data)}`,
  );

  const endpointSempit = await send("POST", "/api/v1/webhooks", {
    name: "Mitra Sempit",
    events: ["order.created"],
    secret: rahasiaMitra,
  });
  const jalurSempit = new URL(endpointSempit.body.data.url).pathname;
  const bodyTakDilanggan = JSON.stringify({ id: `evt-${runId}-3`, event: "stock.adjusted", data: { sku: skuKopi, delta: 1 } });
  const timestamp = Date.now();
  const takDilanggan = await fetch(`${siteUrl}${jalurSempit}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [INBOUND_HEADERS.timestamp]: String(timestamp),
      [INBOUND_HEADERS.signature]: signWebhookPayload(rahasiaMitra, timestamp, bodyTakDilanggan),
      [INBOUND_HEADERS.event]: "stock.adjusted",
    },
    body: bodyTakDilanggan,
  });
  const takDilangganBody = await takDilanggan.json().catch(() => null);
  check(
    "event di luar langganan ditolak 400 dengan daftar yang dilanggan",
    takDilanggan.status === 400 &&
      String(takDilangganBody?.error ?? "").includes("order.created"),
    `${takDilanggan.status} ${JSON.stringify(takDilangganBody)}`,
  );

  const hapusEndpoint = await send("DELETE", "/api/v1/webhooks", {
    id: endpoint.body.data.id,
  });
  check(
    "endpoint webhook masuk bisa dihapus",
    hapusEndpoint.status === 200 && hapusEndpoint.body?.data?.removed === true,
    `${hapusEndpoint.status} ${JSON.stringify(hapusEndpoint.body?.data)}`,
  );
  const setelahHapus = await fetch(`${siteUrl}${jalur}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [INBOUND_HEADERS.timestamp]: String(Date.now()),
      [INBOUND_HEADERS.signature]: "sha256=00",
      [INBOUND_HEADERS.event]: "order.created",
    },
    body: JSON.stringify({ id: "evt-setelah-hapus", event: "order.created", data: {} }),
  });
  check(
    "alamat endpoint yang dihapus langsung berhenti bekerja (404)",
    setelahHapus.status === 404,
    String(setelahHapus.status),
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

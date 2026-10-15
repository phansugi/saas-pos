/**
 * End-to-end smoke test for the Convex backend.
 *
 * Runs the real mutations/queries against whatever deployment VITE_CONVEX_URL
 * points at and asserts the business rules: server-side pricing, 11% PPN,
 * idempotent sale replay, atomic stock ledger, negative-stock refusal,
 * reporting, entitlements, and role-based authorization (a cashier may sell
 * but may not void, restock, or bill).
 *
 *   bun scripts/verify-backend.mjs              # assumes a backend is already up
 *   SPAWN_BACKEND=1 bun scripts/verify-backend.mjs  # starts one, then stops it
 *
 * With SPAWN_BACKEND=1 the script owns the `convex dev` process: it first
 * pushes the current source synchronously (aborting if that push does not
 * complete, so we can never assert against stale functions), then keeps a
 * backend alive for the checks, and always shuts it down in a `finally` block.
 */
import { spawn, spawnSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../src/convex/_generated/api.js";
// Aturan murni yang sama dipakai server dan klien; dipakai di sini untuk
// memeriksa denah meja dari data yang benar-benar disimpan backend.
import { tableStates } from "../src/convex/lib/fnb.ts";
// Aturan webhook keluar yang sama dipakai aksi kirim uji; dipakai di sini untuk
// memastikan tanda tangan yang dikirim server bisa diverifikasi penerima.
import {
  sampleDeliveryPayload,
  signWebhookPayload,
  verifyWebhookSignature,
} from "../src/convex/lib/webhooks.ts";
// Kode kategori SKU dipakai untuk menyusun harapan pada uji pindah kategori:
// `PBB-<KATEGORI>-<nomor urut>`.
import { productSkuCategoryCode } from "../src/convex/lib/productSku.ts";
// Isi email undangan & tautan halaman Masuk diperiksa langsung dari aturan murni
// yang dipakai aksi pengirim (`inviteEmail.ts`) — bukan dari salinan di harness.
import {
  inviteEmailContent,
  inviteLoginUrl,
} from "../src/convex/lib/team.ts";
import { ROLE_LABELS } from "../src/convex/lib/authz.ts";
// Aturan struk yang sama dipakai server & klien; dipakai di sini untuk membaca
// setelan yang benar-benar tersimpan (baris tenant boleh kosong).
import {
  DEFAULT_RECEIPT_SETTING,
  receiptSettingOf,
  sameReceiptSetting,
} from "../src/convex/lib/struk.ts";

const url = process.env.VITE_CONVEX_URL;
if (!url) {
  console.error("VITE_CONVEX_URL tidak diset — jalankan `bun convex dev --once` dulu.");
  process.exit(1);
}

const shouldSpawn = process.env.SPAWN_BACKEND === "1";
const results = [];

function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits until a real function answers, not just until the port is open. */
async function waitForBackend(client, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "belum siap";
  while (Date.now() < deadline) {
    try {
      await client.query(api.tenants.getBySlug, { slug: "__readiness_probe__" });
      return;
    } catch (error) {
      lastError = error?.message ?? String(error);
      await sleep(1500);
    }
  }
  throw new Error(`Backend tidak siap dalam ${timeoutMs / 1000}s: ${lastError}`);
}

let backend = null;

/**
 * Pushes the current source to the local deployment and refuses to continue
 * unless the push really completed. Without this the checks would happily run
 * against whatever functions were deployed by an earlier run.
 */
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

async function main() {
  if (shouldSpawn) {
    pushOnce();
    console.log("→ menjalankan `bun convex dev` (penjaga backend)…");
    backend = spawn("bun", ["convex", "dev"], {
      env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    backend.stderr.on("data", (chunk) => process.stderr.write(`  [convex] ${chunk}`));
  }

  const client = new ConvexHttpClient(url);
  await waitForBackend(client);
  console.log("→ backend siap, menjalankan pemeriksaan\n");

  const runId = Date.now();
  const slug = `verify-${runId}`;

  // -------------------------------------------------------------- onboarding
  const { userId } = await client.mutation(api.users.createOrGet, {
    email: `owner+${runId}@mesinpos.test`,
    name: "Verifikasi Otomatis",
  });
  check("users.createOrGet mengembalikan userId", typeof userId === "string", userId);

  const { tenantId, storeId } = await client.mutation(api.tenants.create, {
    ownerId: userId,
    name: "Toko Verifikasi",
    slug,
    planKey: "professional",
    storeName: "Cabang Uji",
    verticals: ["umkm", "fnb"],
  });
  check("tenants.create membuat tenant + store", Boolean(tenantId && storeId));

  const lookup = await client.query(api.tenants.getBySlug, { slug });
  check(
    "getBySlug menemukan tenant lewat slug",
    lookup?.name === "Toko Verifikasi",
    JSON.stringify(lookup),
  );
  check(
    "getBySlug tidak membocorkan data bisnis",
    lookup?.status === undefined &&
      lookup?.planKey === undefined &&
      lookup?.taxRatePct === undefined,
    JSON.stringify(lookup),
  );

  const tenant = await client.query(api.tenants.getMine, {
    tenantId,
    actorId: userId,
  });
  check(
    "tenant trial dengan PPN 11%",
    tenant?.status === "trialing" && tenant?.taxRatePct === 11,
    JSON.stringify({ status: tenant?.status, tax: tenant?.taxRatePct }),
  );
  check("tenant menyimpan 2 modul", tenant?.verticals?.length === 2, JSON.stringify(tenant?.verticals));

  // --------------------------------------------------------------- catalogue
  // `products.create` mengembalikan id **dan** SKU final (server bisa membuat SKU
  // otomatis kalau kolomnya kosong), jadi id-nya diambil dari balikan itu.
  const { productId: kopiId } = await client.mutation(api.products.create, {
    tenantId,
    storeId,
    sku: `KOPI-${runId}`,
    name: "Kopi Susu Gula Aren",
    price: 22000,
    openingStock: 10,
    actorId: userId,
  });
  const { productId: rotiId } = await client.mutation(api.products.create, {
    tenantId,
    storeId,
    sku: `ROTI-${runId}`,
    name: "Roti Bakar",
    price: 15000,
    openingStock: 5,
    actorId: userId,
  });

  let listed = await client.query(api.products.listByStore, { tenantId, storeId, actorId: userId });
  check(
    "stok awal tercatat 10 dan 5",
    listed.find((p) => p._id === kopiId)?.stock === 10 &&
      listed.find((p) => p._id === rotiId)?.stock === 5,
    JSON.stringify(listed.map((p) => [p.name, p.stock])),
  );

  // ------------------------------------------------------------ gambar produk
  // Batas 8 gambar, jenis berkas, dan ukurannya dijaga server - bukan hanya UI.
  // Berkasnya di sini benar-benar diunggah ke penyimpanan Convex lewat pola tiga
  // langkah (minta URL → POST berkas → tautkan id-nya), jadi jalur unggahnya ikut
  // diuji, bukan cuma validasinya.
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05,
  ]);
  async function uploadProductImage(productId, options = {}) {
    const type = options.type ?? "image/png";
    const bytes = options.bytes ?? pngBytes;
    const uploadUrl = await client.mutation(api.products.generateImageUploadUrl, {
      tenantId,
      actorId: userId,
    });
    check(
      "generateImageUploadUrl mengembalikan URL unggah",
      typeof uploadUrl === "string" && uploadUrl.startsWith("http"),
      String(uploadUrl).slice(0, 40),
    );
    const uploaded = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": type },
      body: bytes,
    });
    check(`berkas diterima penyimpanan (HTTP ${uploaded.status})`, uploaded.ok, String(uploaded.status));
    const { storageId } = await uploaded.json();
    await client.mutation(api.products.addImage, {
      tenantId,
      actorId: userId,
      productId,
      storageId,
    });
    return storageId;
  }

  const firstImageId = await uploadProductImage(kopiId);
  listed = await client.query(api.products.listByStore, { tenantId, storeId, actorId: userId });
  let kopiRow = listed.find((p) => p._id === kopiId);
  check(
    "gambar produk tersimpan dan dikembalikan dengan URL yang dibuat server",
    kopiRow?.images?.length === 1 &&
      kopiRow.images[0].id === firstImageId &&
      typeof kopiRow.images[0].url === "string" &&
      kopiRow.images[0].url.startsWith("https://"),
    JSON.stringify(kopiRow?.images),
  );

  const firstUrl = kopiRow.images[0].url;
  const fetchedImage = await fetch(firstUrl);
  const fetchedBytes = new Uint8Array(await fetchedImage.arrayBuffer());
  check(
    "URL gambar benar-benar menyajikan berkas yang diunggah",
    fetchedImage.ok && fetchedBytes.length === pngBytes.length && fetchedBytes[0] === pngBytes[0],
    `${fetchedImage.status} ${fetchedBytes.length} byte`,
  );

  for (let index = 0; index < 7; index += 1) {
    await uploadProductImage(kopiId);
  }
  listed = await client.query(api.products.listByStore, { tenantId, storeId, actorId: userId });
  kopiRow = listed.find((p) => p._id === kopiId);
  check("delapan gambar bisa tersimpan di satu produk", kopiRow?.images.length === 8, String(kopiRow?.images.length));

  let ninthRejected = null;
  try {
    await uploadProductImage(kopiId);
  } catch (error) {
    ninthRejected = error?.message ?? String(error);
  }
  check(
    "gambar ke-9 ditolak server dengan pesan batasnya",
    typeof ninthRejected === "string" && ninthRejected.includes("maksimal 8"),
    ninthRejected ?? "diterima",
  );
  check(
    "tidak ada gambar menyelinap setelah penolakan",
    kopiRow?.images.length === 8,
    String(typeof ninthRejected === "string"),
  );

  let nonImageRejected = null;
  try {
    await uploadProductImage(rotiId, { type: "application/pdf" });
  } catch (error) {
    nonImageRejected = error?.message ?? String(error);
  }
  check(
    "berkas non-gambar ditolak server",
    typeof nonImageRejected === "string" && nonImageRejected.includes("JPG, PNG, atau WebP"),
    nonImageRejected ?? "diterima",
  );
  check(
    "produk yang berkasnya ditolak tetap tanpa gambar",
    listed.find((p) => p._id === rotiId)?.images.length === 0,
    JSON.stringify(listed.find((p) => p._id === rotiId)?.images),
  );

  await client.mutation(api.products.removeImage, {
    tenantId,
    actorId: userId,
    productId: kopiId,
    storageId: firstImageId,
  });
  listed = await client.query(api.products.listByStore, { tenantId, storeId, actorId: userId });
  kopiRow = listed.find((p) => p._id === kopiId);
  check(
    "gambar bisa dilepas dari produk",
    kopiRow?.images.length === 7 && !kopiRow.images.some((image) => image.id === firstImageId),
    JSON.stringify(kopiRow?.images.map((image) => image.id)),
  );
  const afterDelete = await fetch(firstUrl);
  check(
    "berkas yang dihapus benar-benar hilang dari penyimpanan (404)",
    afterDelete.status === 404,
    String(afterDelete.status),
  );

  const { userId: nonMemberId } = await client.mutation(api.users.createOrGet, {
    email: `gambar-luar+${runId}@mesinpos.test`,
    name: "Bukan Anggota",
  });
  let deniedUpload = null;
  try {
    await client.mutation(api.products.generateImageUploadUrl, {
      tenantId,
      actorId: nonMemberId,
    });
  } catch (error) {
    deniedUpload = error?.message ?? String(error);
  }
  check(
    "akun di luar tenant tidak bisa meminta URL unggah gambar",
    typeof deniedUpload === "string",
    deniedUpload ?? "diterima",
  );

  // ----------------------------------------------------------------- pricing
  const idempotencyKey = `sale-${runId}`;
  const saleArgs = {
    tenantId,
    storeId,
    items: [
      { productId: kopiId, quantity: 2 },
      { productId: rotiId, quantity: 1 },
    ],
    payments: [{ method: "cash", amount: 65490 }],
    idempotencyKey,
    cashierId: userId,
  };

  const sale = await client.mutation(api.pos.createSale, saleArgs);
  check("nomor struk sekuensial A-00001", sale.number === "A-00001", sale.number);
  // 2 x 22.000 + 1 x 15.000 = 59.000 ; PPN 11% = 6.490 ; total 65.490
  check("total dihitung server-side (59.000 + 6.490)", sale.total === 65490, String(sale.total));
  check("sale baru bukan hasil dedup", sale.deduplicated === false, String(sale.deduplicated));

  // ------------------------------------------------------------- idempotency
  const replay = await client.mutation(api.pos.createSale, saleArgs);
  check(
    "replay idempotencyKey mengembalikan sale yang sama",
    replay.deduplicated === true && replay.saleId === sale.saleId,
    JSON.stringify(replay),
  );

  listed = await client.query(api.products.listByStore, { tenantId, storeId, actorId: userId });
  check(
    "stok berkurang tepat sekali (10→8, 5→4)",
    listed.find((p) => p._id === kopiId)?.stock === 8 &&
      listed.find((p) => p._id === rotiId)?.stock === 4,
    JSON.stringify(listed.map((p) => [p.name, p.stock])),
  );

  // ------------------------------------------------------------ recent list
  const recent = await client.query(api.pos.recent, { tenantId, storeId, actorId: userId, limit: 5 });
  check(
    "pos.recent mengembalikan sale terbaru beserta itemCount",
    recent.length === 1 && recent[0].itemCount === 3,
    JSON.stringify(recent.map((r) => [r.number, r.itemCount])),
  );

  // ------------------------------------------------- over-sell must be refused
  let refused = false;
  let refusalMessage = "";
  try {
    await client.mutation(api.pos.createSale, {
      tenantId,
      storeId,
      items: [{ productId: rotiId, quantity: 999 }],
      payments: [{ method: "qris", amount: 1 }],
      idempotencyKey: `oversell-${runId}`,
      cashierId: userId,
    });
  } catch (error) {
    refused = true;
    refusalMessage = error?.message ?? String(error);
  }
  check("penjualan melebihi stok ditolak", refused, refusalMessage);

  listed = await client.query(api.products.listByStore, { tenantId, storeId, actorId: userId });
  check(
    "stok tidak berubah setelah penolakan",
    listed.find((p) => p._id === rotiId)?.stock === 4,
    String(listed.find((p) => p._id === rotiId)?.stock),
  );

  // ---------------------------------------------------------------- reporting
  const summary = await client.query(api.reports.dailySummary, {
    tenantId,
    storeId,
    actorId: userId,
    from: runId - 600_000,
    to: Date.now() + 600_000,
  });
  check("laporan omzet = 65.490", summary.revenue === 65490, String(summary.revenue));
  check("laporan PPN = 6.490", summary.tax === 6490, String(summary.tax));
  check(
    "laporan 1 transaksi, 3 item",
    summary.transactions === 1 && summary.itemCount === 3,
    JSON.stringify({ t: summary.transactions, i: summary.itemCount }),
  );
  check("breakdown tunai = 65.490", summary.byMethod.cash === 65490, JSON.stringify(summary.byMethod));

  // --------------------------------------------------------------- adjustment
  const adjusted = await client.mutation(api.products.adjustStock, {
    tenantId,
    storeId,
    productId: kopiId,
    delta: 12,
    note: "Terima kiriman pagi",
    actorId: userId,
  });
  check("adjustStock mengembalikan saldo baru 20", adjusted.balance === 20, String(adjusted.balance));

  // -------------------------------------------------------------- entitlements
  const ent = await client.query(api.entitlements.getForTenant, {
    tenantId,
    actorId: userId,
  });
  check(
    "entitlement Professional punya pos.table",
    ent.features.some((f) => f.key === "pos.table" && f.enabled),
    JSON.stringify(ent.features.map((f) => f.key)),
  );
  check("usage produk = 2", ent.usage.products === 2, String(ent.usage.products));
  check("boleh buat penjualan saat trial", ent.access.canCreateSales === true, JSON.stringify(ent.access));

  // --------------------------------------------------------------- team RBAC
  const cashierEmail = `cashier+${runId}@mesinpos.test`;
  const { userId: cashierId } = await client.mutation(api.users.createOrGet, {
    email: cashierEmail,
    name: "Kasir Uji",
  });
  const { membershipId } = await client.mutation(api.members.add, {
    tenantId,
    actorId: userId,
    email: cashierEmail,
    name: "Kasir Uji",
    role: "cashier",
  });
  check("owner dapat mengundang kasir (team.manage)", typeof membershipId === "string", membershipId);

  const members = await client.query(api.members.list, { tenantId, actorId: userId });
  check(
    "tenant punya 2 anggota dengan peran berbeda",
    members.length === 2 &&
      members.some((m) => m.membership.role === "owner") &&
      members.some((m) => m.membership.role === "cashier"),
    JSON.stringify(members.map((m) => [m.user.email, m.membership.role])),
  );

  // A cashier may sell...
  const cashierSale = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    cashierId,
    items: [{ productId: rotiId, quantity: 1 }],
    payments: [{ method: "cash", amount: 16650 }],
    idempotencyKey: `cashier-${runId}`,
  });
  check(
    "kasir BOLEH menjual (pos.sell)",
    cashierSale.number === "A-00002" && cashierSale.deduplicated === false,
    JSON.stringify(cashierSale),
  );

  listed = await client.query(api.products.listByStore, { tenantId, storeId, actorId: userId });
  check(
    "penjualan kasir memotong stok (4→3)",
    listed.find((p) => p._id === rotiId)?.stock === 3,
    String(listed.find((p) => p._id === rotiId)?.stock),
  );

  // ...but may not reverse one.
  let voidRefused = false;
  let voidMessage = "";
  try {
    await client.mutation(api.pos.voidSale, {
      saleId: cashierSale.saleId,
      actorId: cashierId,
      reason: "uji otorisasi",
    });
  } catch (error) {
    voidRefused = true;
    voidMessage = error?.message ?? String(error);
  }
  check(
    "kasir TIDAK boleh void (pos.void)",
    voidRefused && voidMessage.includes("pos.void"),
    voidMessage,
  );

  listed = await client.query(api.products.listByStore, { tenantId, storeId, actorId: userId });
  check(
    "void yang ditolak tidak mengubah stok (tetap 3)",
    listed.find((p) => p._id === rotiId)?.stock === 3,
    String(listed.find((p) => p._id === rotiId)?.stock),
  );

  for (const [label, attempt] of [
    [
      "product.manage",
      () =>
        client.mutation(api.products.create, {
          tenantId,
          storeId,
          sku: `TERLARANG-${runId}`,
          name: "Tidak boleh dibuat kasir",
          price: 1000,
          actorId: cashierId,
        }),
    ],
    [
      "stock.adjust",
      () =>
        client.mutation(api.products.adjustStock, {
          tenantId,
          storeId,
          productId: kopiId,
          delta: 1,
          actorId: cashierId,
        }),
    ],
    [
      "device.manage",
      () =>
        client.mutation(api.devices.register, {
          tenantId,
          name: "Till Kasir",
          fingerprint: `fp-${runId}`,
          actorId: cashierId,
        }),
    ],
    [
      "billing.manage",
      () =>
        client.mutation(api.billing.createInvoice, {
          tenantId,
          actorId: cashierId,
        }),
    ],
    [
      "team.manage",
      () =>
        client.mutation(api.members.add, {
          tenantId,
          actorId: cashierId,
          email: `oranglain+${runId}@mesinpos.test`,
          role: "owner",
        }),
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    // Assert WHY, not just that it threw: a refusal caused by a plan limit or
    // some other validation would otherwise look like a passing ACL check.
    check(
      `kasir ditolak karena izin: ${label}`,
      blocked && message.includes(`izin ${label}`),
      message || "tidak ditolak sama sekali",
    );
  }

  // ------------------------------------------ owner voids: stock comes back
  const voided = await client.mutation(api.pos.voidSale, {
    saleId: cashierSale.saleId,
    actorId: userId,
    reason: "Salah input kasir",
  });
  check("owner BOLEH void", voided.saleId === cashierSale.saleId);

  listed = await client.query(api.products.listByStore, { tenantId, storeId, actorId: userId });
  check(
    "void mengembalikan stok ke rak (3→4)",
    listed.find((p) => p._id === rotiId)?.stock === 4,
    String(listed.find((p) => p._id === rotiId)?.stock),
  );

  const secondVoid = await client.mutation(api.pos.voidSale, {
    saleId: cashierSale.saleId,
    actorId: userId,
  });
  check("void kedua idempoten", secondVoid.saleId === cashierSale.saleId);

  listed = await client.query(api.products.listByStore, { tenantId, storeId, actorId: userId });
  check(
    "stok tidak dikembalikan dua kali (tetap 4)",
    listed.find((p) => p._id === rotiId)?.stock === 4,
    String(listed.find((p) => p._id === rotiId)?.stock),
  );

  const afterVoid = await client.query(api.reports.dailySummary, {
    tenantId,
    storeId,
    actorId: userId,
    from: runId - 600_000,
    to: Date.now() + 600_000,
  });
  check(
    "laporan mengeluarkan transaksi yang di-void",
    afterVoid.transactions === 1 && afterVoid.voidCount === 1 && afterVoid.revenue === 65490,
    JSON.stringify({
      transactions: afterVoid.transactions,
      voids: afterVoid.voidCount,
      revenue: afterVoid.revenue,
    }),
  );

  // ------------------------------------- read isolation (multi-tenant boundary)
  // Convex has no row-level security, so a non-member reading a tenant's data
  // would be a silent cross-tenant leak. These checks fail loudly if any read
  // forgets its membership guard.
  const { userId: outsiderId } = await client.mutation(api.users.createOrGet, {
    email: `outsider+${runId}@mesinpos.test`,
    name: "Bukan Anggota",
  });
  check(
    "pengguna luar bukan anggota tenant",
    typeof outsiderId === "string" && outsiderId !== userId,
    outsiderId,
  );

  for (const [label, attempt] of [
    ["tenants.listStores", () => client.query(api.tenants.listStores, { tenantId, actorId: outsiderId })],
    ["tenants.listCategories", () => client.query(api.tenants.listCategories, { tenantId, actorId: outsiderId })],
    ["tenants.getMine", () => client.query(api.tenants.getMine, { tenantId, actorId: outsiderId })],
    ["products.listByStore", () => client.query(api.products.listByStore, { tenantId, storeId, actorId: outsiderId })],
    ["products.lowStock", () => client.query(api.products.lowStock, { tenantId, storeId, actorId: outsiderId })],
    ["pos.recent", () => client.query(api.pos.recent, { tenantId, storeId, actorId: outsiderId })],
    ["pos.listHeld", () => client.query(api.pos.listHeld, { tenantId, actorId: outsiderId })],
    [
      "reports.dailySummary",
      () =>
        client.query(api.reports.dailySummary, {
          tenantId,
          storeId,
          actorId: outsiderId,
          from: 0,
          to: Date.now() + 600_000,
        }),
    ],
    ["entitlements.getForTenant", () => client.query(api.entitlements.getForTenant, { tenantId, actorId: outsiderId })],
    ["devices.list", () => client.query(api.devices.list, { tenantId, actorId: outsiderId })],
    ["billing.currentSummary", () => client.query(api.billing.currentSummary, { tenantId, actorId: outsiderId })],
    ["billing.listInvoices", () => client.query(api.billing.listInvoices, { tenantId, actorId: outsiderId })],
    ["members.list", () => client.query(api.members.list, { tenantId, actorId: outsiderId })],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `pengguna luar ditolak membaca: ${label}`,
      blocked && message.includes("bukan anggota"),
      message || "BERHASIL MEMBACA — isolasi multi-tenant bocor",
    );
  }

  // Isolation must not overshoot: a member with the weakest role still reads.
  const cashierView = await client.query(api.reports.dailySummary, {
    tenantId,
    storeId,
    actorId: cashierId,
    from: runId - 600_000,
    to: Date.now() + 600_000,
  });
  check(
    "kasir (anggota) tetap bisa membaca laporan",
    cashierView.transactions === 1,
    JSON.stringify({ transactions: cashierView.transactions }),
  );

  // ------------------------------------------- write-side authorization (shifts)
  // Not just "is this guarded": the guard must let the real owner through, or
  // the till would be unusable.
  const { deviceId } = await client.mutation(api.devices.register, {
    tenantId,
    name: "Till Utama",
    fingerprint: `fp-owner-${runId}`,
    actorId: userId,
  });
  check("owner dapat mendaftarkan perangkat", typeof deviceId === "string", String(deviceId));

  const shiftId = await client.mutation(api.pos.openShift, {
    tenantId,
    storeId,
    cashierId: userId,
    openingCash: 100000,
  });
  check("owner dapat membuka shift", typeof shiftId === "string", String(shiftId));

  let doubleShift = false;
  try {
    await client.mutation(api.pos.openShift, {
      tenantId,
      storeId,
      cashierId: userId,
      openingCash: 1,
    });
  } catch {
    doubleShift = true;
  }
  check("shift kedua untuk kasir yang sama ditolak", doubleShift);

  const shiftSale = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    shiftId,
    cashierId: userId,
    items: [{ productId: rotiId, quantity: 1 }],
    payments: [{ method: "cash", amount: 16650 }],
    idempotencyKey: `shift-sale-${runId}`,
  });
  check("penjualan bisa ditempelkan ke shift", shiftSale.deduplicated === false);

  // 15.000 + 11% PPN = 16.650 masuk ke laci atas kas awal 100.000
  const closed = await client.mutation(api.pos.closeShift, {
    shiftId,
    actorId: userId,
    closingCash: 116650,
  });
  check(
    "tutup shift: kas seharusnya 116.650 dan selisih 0",
    closed.expectedCash === 116650 && closed.variance === 0 && closed.transactions === 1,
    JSON.stringify(closed),
  );

  for (const [label, attempt] of [
    [
      "pos.openShift",
      () => client.mutation(api.pos.openShift, { tenantId, storeId, cashierId: outsiderId, openingCash: 1 }),
    ],
    [
      "pos.closeShift",
      () => client.mutation(api.pos.closeShift, { shiftId, actorId: outsiderId, closingCash: 0 }),
    ],
    ["devices.revoke", () => client.mutation(api.devices.revoke, { deviceId, actorId: outsiderId })],
    [
      "pos.createSale atas nama kasir lain",
      () =>
        client.mutation(api.pos.createSale, {
          tenantId,
          storeId,
          cashierId: outsiderId,
          items: [{ productId: rotiId, quantity: 1 }],
          payments: [{ method: "cash", amount: 1 }],
          idempotencyKey: `outsider-sale-${runId}`,
        }),
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `pengguna luar ditolak menulis: ${label}`,
      blocked && message.includes("bukan anggota"),
      message || "BERHASIL MENULIS — otorisasi bocor",
    );
  }

  // Note: guarding `tenants.create` and `users.get` against a *spoofed actor id*
  // cannot be exercised here — the placeholder deployment issues no identities,
  // so there is nothing to compare the claim against. Those cases are covered by
  // the pure policy tests in scripts/verify-authz.mjs (decideActor).
  const revoked = await client.mutation(api.devices.revoke, {
    deviceId,
    actorId: userId,
  });
  check("owner dapat mencabut perangkat", revoked.ok === true);

  // ------------------------------------------------------- modul plug-in Fase 2
  const mods = await client.query(api.modules.getForTenant, {
    tenantId,
    actorId: userId,
  });
  check(
    "modul: professional menawarkan 3 modul dengan batas 2",
    mods.available.length === 3 && mods.limit === 2,
    JSON.stringify({ available: mods.available.map((m) => m.vertical), limit: mods.limit }),
  );
  check(
    "modul: umkm + fnb aktif sejak onboarding",
    mods.active.length === 2 && mods.verticals.includes("fnb"),
    JSON.stringify(mods.verticals),
  );
  check(
    "modul: fitur grosir yang belum aktif dilaporkan menunggu",
    mods.blocked.some((b) => b.feature === "pricing.multitier"),
    JSON.stringify(mods.blocked.map((b) => b.feature)),
  );

  // Kasir boleh menjual, tetapi modul adalah keputusan penagihan (billing.manage).
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.modules.setForTenant, {
        tenantId,
        actorId: cashierId,
        verticals: ["umkm"],
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "modul: kasir ditolak mengubah modul",
      blocked && message.includes("tidak memiliki izin"),
      message || "BERHASIL MENGUBAH — otorisasi bocor",
    );
  }

  // Aturan paket ditegakkan di server, bukan hanya disembunyikan di klien.
  for (const [label, verticals, expected] of [
    ["seleksi kosong", [], "Minimal satu modul"],
    ["melebihi batas paket", ["umkm", "fnb", "wholesale"], "hanya mengizinkan 2 modul"],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.modules.setForTenant, { tenantId, actorId: userId, verticals });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `modul ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — aturan paket bocor",
    );
  }

  // Modul di luar paket: tenant Starter tidak boleh menyalakan F&B. Dibuat
  // terpisah supaya paket professional di atas tetap bisa dipakai menguji batas.
  const starterTenant = await client.mutation(api.tenants.create, {
    ownerId: userId,
    name: "Toko Starter Uji",
    slug: `${slug}-starter`,
    planKey: "starter",
    storeName: "Starter",
  });
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.modules.setForTenant, {
        tenantId: starterTenant.tenantId,
        actorId: userId,
        verticals: ["umkm", "fnb"],
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "modul di luar paket starter ditolak",
      blocked && message.includes("tidak tersedia di paket ini"),
      message || "DITERIMA — modul di luar paket bocor",
    );
  }

  // Gerbang modul pada alur nyata: pesanan ditahan lalu dikirim ke dapur adalah
  // alur F&B (KDS), jadi wajib punya modul aktif — bukan sekadar ada di paket.
  const held = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    cashierId: userId,
    items: [{ productId: rotiId, quantity: 1 }],
    payments: [{ method: "cash", amount: 15000 }],
    idempotencyKey: `held-${runId}`,
    status: "held",
  });
  check("pesanan tertahan dibuat saat modul F&B aktif", typeof held.saleId === "string", JSON.stringify(held));

  // ------------------------------- denah meja + antrean dapur (modul F&B)
  // Alur F&B punya dua penjaga yang berbeda: modulnya harus aktif (fitur) dan
  // aktornya harus punya izin `table.manage` untuk mengubah denahnya. Keduanya
  // diuji dari sisi server, bukan dari UI.
  const meja = await client.mutation(api.tables.create, {
    tenantId,
    storeId,
    actorId: userId,
    name: "A1",
    seats: 4,
  });
  check(
    "owner dapat menambah meja saat modul F&B aktif",
    typeof meja.tableId === "string" && meja.name === "A1",
    JSON.stringify(meja),
  );

  for (const [label, attempt, expected] of [
    [
      "nama meja duplikat (tanpa peka huruf besar-kecil)",
      () => client.mutation(api.tables.create, { tenantId, storeId, actorId: userId, name: "a1", seats: 2 }),
      "sudah ada di denah ini",
    ],
    [
      "kursi di luar batas",
      () => client.mutation(api.tables.create, { tenantId, storeId, actorId: userId, name: "B9", seats: 99 }),
      "Jumlah kursi",
    ],
    [
      "kasir mengubah denah meja",
      () => client.mutation(api.tables.create, { tenantId, storeId, actorId: cashierId, name: "C1", seats: 2 }),
      "table.manage",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `meja ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — aturan denah meja bocor",
    );
  }

  const denah = await client.query(api.tables.list, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check("denah meja berisi satu meja", denah.length === 1 && denah[0].name === "A1", JSON.stringify(denah));

  const antrean0 = await client.query(api.pos.kdsTickets, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "antrean dapur memuat pesanan tertahan tanpa meja",
    antrean0.length === 1 && antrean0[0].tableName === undefined,
    JSON.stringify(antrean0),
  );

  const mejaSale = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    cashierId: userId,
    items: [{ productId: rotiId, quantity: 2 }],
    payments: [{ method: "cash", amount: 30000 }],
    idempotencyKey: `held-meja-${runId}`,
    status: "held",
    tableId: meja.tableId,
  });
  check(
    "pesanan tertahan dapat ditempatkan di meja",
    typeof mejaSale.saleId === "string",
    JSON.stringify(mejaSale),
  );

  const antrean1 = await client.query(api.pos.kdsTickets, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check("antrean dapur memuat dua tiket", antrean1.length === 2, String(antrean1.length));
  check(
    "antrean diurutkan paling lama menunggu di depan",
    antrean1[0].saleId === held.saleId,
    antrean1.map((t) => t.number).join(","),
  );
  const tiketMeja = antrean1.find((t) => t.saleId === mejaSale.saleId);
  check("tiket menyebut meja pesanan", tiketMeja?.tableName === "A1", JSON.stringify(tiketMeja));
  check(
    "tiket memuat item pesanan",
    tiketMeja?.items?.length === 1 && tiketMeja.items[0].quantity === 2,
    JSON.stringify(tiketMeja?.items),
  );

  const openOrders = antrean1.map((ticket) => ({
    id: ticket.saleId,
    number: ticket.number,
    createdAt: ticket.createdAt,
    tableId: ticket.tableId,
  }));
  check(
    "meja terlihat terisi selama pesanannya terbuka",
    tableStates(denah, openOrders)[0].status === "occupied",
    JSON.stringify(tableStates(denah, openOrders)[0]),
  );

  for (const [label, attempt, expected] of [
    [
      "pesanan kedua di meja yang sama",
      () =>
        client.mutation(api.pos.createSale, {
          tenantId,
          storeId,
          cashierId: userId,
          items: [{ productId: rotiId, quantity: 1 }],
          payments: [{ method: "cash", amount: 15000 }],
          idempotencyKey: `held-meja-dup-${runId}`,
          status: "held",
          tableId: meja.tableId,
        }),
      "masih terisi",
    ],
    [
      "menonaktifkan meja yang masih terisi",
      () =>
        client.mutation(api.tables.setActive, {
          tenantId,
          tableId: meja.tableId,
          actorId: userId,
          active: false,
        }),
      "masih terisi",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `ditolak di server: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — aturan meja bocor",
    );
  }

  // Meja kosong tetap bisa dimatikan, dan meja nonaktif tidak bisa ditempati.
  const mejaKedua = await client.mutation(api.tables.create, {
    tenantId,
    storeId,
    actorId: userId,
    name: "A2",
    seats: 2,
  });
  await client.mutation(api.tables.setActive, {
    tenantId,
    tableId: mejaKedua.tableId,
    actorId: userId,
    active: false,
  });
  const denah2 = await client.query(api.tables.list, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "meja kosong bisa dinonaktifkan",
    denah2.find((t) => t.name === "A2")?.active === false,
    JSON.stringify(denah2),
  );
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.pos.createSale, {
        tenantId,
        storeId,
        cashierId: userId,
        items: [{ productId: rotiId, quantity: 1 }],
        payments: [{ method: "cash", amount: 15000 }],
        idempotencyKey: `held-meja-nonaktif-${runId}`,
        status: "held",
        tableId: mejaKedua.tableId,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "meja nonaktif tidak bisa ditempati",
      blocked && message.includes("tidak aktif"),
      message || "DITERIMA — meja nonaktif bocor",
    );
  }

  // Selesaikan pesanan meja: tiketnya hilang dari antrean dan mejanya kosong.
  await client.mutation(api.pos.finalizeHeldSale, {
    saleId: mejaSale.saleId,
    actorId: userId,
  });
  const antrean2 = await client.query(api.pos.kdsTickets, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "tiket hilang setelah pesanan selesai",
    !antrean2.some((ticket) => ticket.saleId === mejaSale.saleId),
    antrean2.map((t) => t.number).join(","),
  );
  check(
    "meja kosong lagi setelah pesanan selesai",
    tableStates(
      denah2,
      antrean2.map((ticket) => ({
        id: ticket.saleId,
        number: ticket.number,
        createdAt: ticket.createdAt,
        tableId: ticket.tableId,
      })),
    ).find((state) => state.name === "A1")?.status === "free",
    "meja masih terisi",
  );

  // ------------------------- pesanan QR meja (`pos.table` + `payment.digital`)
  // Rantai yang diuji dari sisi server: kartu QR meja → menu publik **tanpa
  // aktor** → pesanan tamu (tagihan QRIS) → pelunasan → tiket dapur + penjualan
  // yang menunjuk tagihan itu. Dua hal yang paling mudah bocor: harga pesanan
  // tamu harus datang dari katalog server, dan **tidak boleh ada tiket dapur
  // sebelum tagihannya lunas**.
  const kartu = await client.mutation(api.tables.issueMenuQr, {
    tenantId,
    tableId: meja.tableId,
    actorId: userId,
  });
  check(
    "owner menerbitkan token QR meja berbentuk `mj_…`",
    /^mj_[0-9a-f]{32}$/.test(kartu.token) && kartu.rotated === false,
    JSON.stringify(kartu),
  );

  const kartuLagi = await client.mutation(api.tables.issueMenuQr, {
    tenantId,
    tableId: meja.tableId,
    actorId: userId,
  });
  check(
    "menerbitkan ulang tidak mengganti token (kartu yang sudah tercetak tetap sah)",
    kartuLagi.token === kartu.token && kartuLagi.rotated === false,
    JSON.stringify(kartuLagi),
  );

  const kartuBaru = await client.mutation(api.tables.issueMenuQr, {
    tenantId,
    tableId: meja.tableId,
    actorId: userId,
    rotate: true,
  });
  check(
    "`rotate` mengganti token dan menandai penggantiannya",
    kartuBaru.token !== kartu.token && kartuBaru.rotated === true,
    JSON.stringify(kartuBaru),
  );
  const tokenMeja = kartuBaru.token;

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.tables.issueMenuQr, {
        tenantId,
        tableId: meja.tableId,
        actorId: cashierId,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "kasir tidak bisa menerbitkan/mengganti kartu QR meja",
      blocked && message.includes("table.manage"),
      message || "DITERIMA — izin bocor",
    );
  }

  // Menu tamu dibaca **tanpa aktor** — itu satu-satunya permukaan publik baru.
  const menuTamu = await client.query(api.meja.menu, { token: tokenMeja });
  check(
    "menu tamu dibaca tanpa sesi & menyebut usaha + mejanya",
    menuTamu.ok === true && menuTamu.business.length > 0 && menuTamu.tableLabel === "A1",
    JSON.stringify(menuTamu).slice(0, 200),
  );
  check(
    "menu tamu membawa aturan pajak/biaya layanan yang sedang berlaku",
    menuTamu.ok === true && menuTamu.tax.taxRatePct === 11,
    JSON.stringify(menuTamu.ok ? menuTamu.tax : menuTamu),
  );

  const menuAsing = await client.query(api.meja.menu, {
    token: "mj_00000000000000000000000000000000",
  });
  check(
    "token QR asing dijawab alasan yang bisa dibaca tamu (bukan galat mentah)",
    menuAsing.ok === false && menuAsing.reason.includes("tidak dikenal"),
    JSON.stringify(menuAsing),
  );

  // Produk khusus blok ini supaya angka totalnya pasti (harga & stok dari server).
  const { productId: kopiQrId } = await client.mutation(api.products.create, {
    tenantId,
    storeId,
    sku: `MEJAQR-${runId}`,
    name: "Kopi QR Uji",
    price: 12000,
    openingStock: 30,
    actorId: userId,
  });

  const menuLagi = await client.query(api.meja.menu, { token: tokenMeja });
  const itemKopi = menuLagi.ok
    ? menuLagi.groups.flatMap((group) => group.items).find((item) => item.id === kopiQrId)
    : null;
  check(
    "menu tamu memuat produk katalog toko beserta harga & stoknya",
    Boolean(itemKopi) && itemKopi.price === 12000 && itemKopi.available === true,
    JSON.stringify(itemKopi),
  );

  const menuTanpaHarga = await client.mutation(api.meja.order, {
    token: tokenMeja,
    items: [{ productId: "produk-hantu", quantity: 1 }],
  });
  check(
    "produk asing di pesanan tamu ditolak dengan kalimat yang bisa dibaca",
    menuTanpaHarga.ok === false && menuTanpaHarga.reason.includes("tidak dikenal"),
    JSON.stringify(menuTanpaHarga),
  );

  const antreanSebelumTamu = await client.query(api.pos.kdsTickets, {
    tenantId,
    storeId,
    actorId: userId,
  });

  const pesananTamu = await client.mutation(api.meja.order, {
    token: tokenMeja,
    items: [{ productId: kopiQrId, quantity: 2 }],
    guestName: "Rina",
  });
  // 2 × 12.000 = 24.000; PPN 11% = 2.640; total 26.640 — dihitung server.
  check(
    "pesanan tamu menerbitkan tagihan QRIS bernominal total server",
    pesananTamu.ok === true &&
      pesananTamu.subtotal === 24000 &&
      pesananTamu.total === 26640 &&
      /^DIG-\d{4}-\d{4}$/.test(pesananTamu.charge.number),
    JSON.stringify(pesananTamu).slice(0, 240),
  );
  check(
    "kode QRIS tagihan memuat nominal & nomor tagihannya",
    pesananTamu.ok === true &&
      pesananTamu.charge.qrPayload.includes("26640") &&
      pesananTamu.charge.qrPayload.includes(pesananTamu.charge.number),
    pesananTamu.ok ? pesananTamu.charge.qrPayload : "tidak ada tagihan",
  );

  const antreanSetelahPesan = await client.query(api.pos.kdsTickets, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "belum ada tiket dapur selama tagihan tamu belum lunas",
    antreanSetelahPesan.length === antreanSebelumTamu.length,
    `${antreanSebelumTamu.length} → ${antreanSetelahPesan.length}`,
  );

  const statusMenunggu = await client.query(api.meja.status, {
    watch: pesananTamu.watchToken,
  });
  check(
    "tamu memantau status pesanannya lewat token pemantau",
    statusMenunggu.ok === true &&
      statusMenunggu.status === "pending" &&
      statusMenunggu.chargeStatus === "pending" &&
      statusMenunggu.qrPayload !== null,
    JSON.stringify(statusMenunggu).slice(0, 200),
  );
  const statusAsing = await client.query(api.meja.status, {
    watch: "mjo_00000000000000000000000000000000",
  });
  check(
    "token pemantau asing tidak membuka pesanan siapa pun",
    statusAsing.ok === false,
    JSON.stringify(statusAsing),
  );

  // Pelunasan tagihan tamu — jalur yang sama dengan halaman Pembayaran.
  await client.mutation(api.payments.act, {
    tenantId,
    actorId: userId,
    chargeId: pesananTamu.charge.id,
    action: "settle",
    amount: pesananTamu.total,
  });

  const statusLunas = await client.query(api.meja.status, {
    watch: pesananTamu.watchToken,
  });
  check(
    "setelah lunas pesanan tamu menjadi penjualan tertahan bernomor",
    statusLunas.ok === true &&
      statusLunas.status === "paid" &&
      /^A-\d{5}$/.test(statusLunas.saleNumber ?? ""),
    JSON.stringify(statusLunas).slice(0, 200),
  );

  const antreanTamu = await client.query(api.pos.kdsTickets, {
    tenantId,
    storeId,
    actorId: userId,
  });
  const tiketTamu = antreanTamu.find(
    (ticket) => ticket.number === statusLunas.saleNumber,
  );
  check(
    "tiket dapur tamu memuat mejanya & isi pesanannya",
    tiketTamu?.tableName === "A1" &&
      tiketTamu.items.length === 1 &&
      tiketTamu.items[0].quantity === 2,
    JSON.stringify(tiketTamu),
  );

  const tagihanLunas = await client.query(api.payments.list, {
    tenantId,
    actorId: userId,
  });
  const tagihanTamu = tagihanLunas.charges.find(
    (charge) => charge.number === pesananTamu.charge.number,
  );
  check(
    "tagihan tamu menunjuk balik ke penjualan yang dibayarnya",
    tagihanTamu?.status === "paid" && tagihanTamu.saleNumber === statusLunas.saleNumber,
    JSON.stringify(tagihanTamu),
  );

  const daftarPesananQr = await client.query(api.meja.listOrders, {
    tenantId,
    actorId: userId,
  });
  const barisPesananQr = daftarPesananQr.find(
    (row) => row.chargeNumber === pesananTamu.charge.number,
  );
  check(
    "kasir melihat pesanan QR beserta tagihan & tiket dapurnya",
    barisPesananQr?.status === "paid" &&
      barisPesananQr.total === 26640 &&
      barisPesananQr.saleNumber === statusLunas.saleNumber,
    JSON.stringify(barisPesananQr),
  );

  const pesananKedua = await client.mutation(api.meja.order, {
    token: tokenMeja,
    items: [{ productId: kopiQrId, quantity: 1 }],
  });
  check(
    "meja yang masih terisi menolak pesanan QR kedua",
    pesananKedua.ok === false && pesananKedua.reason.includes("masih terisi"),
    JSON.stringify(pesananKedua),
  );

  // Tutup pesanannya: mejanya kembali kosong, stok bergerak seperti pesanan kasir.
  await client.mutation(api.pos.finalizeHeldSale, {
    saleId: barisPesananQr.saleId,
    actorId: userId,
  });
  const antreanAkhirQr = await client.query(api.pos.kdsTickets, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "meja kembali kosong setelah tiket tamu diselesaikan",
    !antreanAkhirQr.some((ticket) => ticket.number === statusLunas.saleNumber),
    antreanAkhirQr.map((ticket) => ticket.number).join(","),
  );

  // ------------------------------ pesanan QR meja: cara bayar Virtual Account
  // Kanalnya sama dengan QRIS, tetapi nominal & nomornya berbeda bentuk: tamu
  // memilih bank, server menerbitkan **nomor Virtual Account** (bukan payload
  // QRIS), dan pelunasannya tetap dari jalur tagihan yang sama.
  const pilihanSalah = await client.mutation(api.meja.order, {
    token: tokenMeja,
    items: [{ productId: kopiQrId, quantity: 1 }],
    method: "va",
  });
  check(
    "Virtual Account tanpa bank ditolak sebelum apa pun tersimpan",
    pilihanSalah.ok === false && pilihanSalah.reason.includes("Pilih bank"),
    JSON.stringify(pilihanSalah),
  );
  const bankPadaQris = await client.mutation(api.meja.order, {
    token: tokenMeja,
    items: [{ productId: kopiQrId, quantity: 1 }],
    method: "qris",
    bank: "bca",
  });
  check(
    "QRIS yang menyebut bank penerbit ditolak (bukan dipakai apa adanya)",
    bankPadaQris.ok === false && bankPadaQris.reason.includes("tidak memakai bank"),
    JSON.stringify(bankPadaQris),
  );
  const caraAsing = await client.mutation(api.meja.order, {
    token: tokenMeja,
    items: [{ productId: kopiQrId, quantity: 1 }],
    method: "ewallet",
  });
  check(
    "cara bayar asing ditolak dengan kalimat yang bisa dibaca tamu",
    caraAsing.ok === false && caraAsing.reason.includes("belum dikenal"),
    JSON.stringify(caraAsing),
  );

  const antreanSebelumVa = await client.query(api.pos.kdsTickets, {
    tenantId,
    storeId,
    actorId: userId,
  });
  const pesananVa = await client.mutation(api.meja.order, {
    token: tokenMeja,
    items: [{ productId: kopiQrId, quantity: 1 }],
    guestName: "Bagas",
    method: "va",
    bank: "bni",
  });
  // 1 × 12.000 = 12.000; PPN 11% = 1.320; total 13.320 — dihitung server.
  check(
    "pesanan tamu Virtual Account menerbitkan tagihan bernomor VA bank itu",
    pesananVa.ok === true &&
      pesananVa.charge.method === "va" &&
      pesananVa.charge.bank === "bni" &&
      /^8810\d{8}$/.test(pesananVa.charge.vaNumber ?? "") &&
      pesananVa.total === 13320 &&
      pesananVa.charge.qrPayload === null,
    JSON.stringify(pesananVa).slice(0, 240),
  );
  check(
    "kalimat cara bayar VA menyebut bank, nomor, & nominalnya",
    pesananVa.ok === true &&
      pesananVa.instruction.includes("Virtual Account BNI") &&
      pesananVa.instruction.includes(pesananVa.charge.vaNumber ?? "") &&
      pesananVa.instruction.includes("13.320"),
    pesananVa.ok ? pesananVa.instruction : "tidak ada tagihan",
  );

  const antreanSetelahVa = await client.query(api.pos.kdsTickets, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "belum ada tiket dapur selama tagihan Virtual Account belum lunas",
    antreanSetelahVa.length === antreanSebelumVa.length,
    `${antreanSebelumVa.length} → ${antreanSetelahVa.length}`,
  );

  const statusVa = await client.query(api.meja.status, {
    watch: pesananVa.watchToken,
  });
  check(
    "tamu memantau tagihan VA-nya beserta sisa waktunya (sehari)",
    statusVa.ok === true &&
      statusVa.method === "va" &&
      statusVa.bank === "bni" &&
      statusVa.vaNumber === pesananVa.charge.vaNumber &&
      statusVa.qrPayload === null &&
      statusVa.remainingSeconds > 20 * 60 * 60,
    JSON.stringify(statusVa).slice(0, 200),
  );

  const kasirLihatVa = await client.query(api.meja.listOrders, {
    tenantId,
    actorId: userId,
  });
  const barisVa = kasirLihatVa.find(
    (row) => row.chargeNumber === pesananVa.charge.number,
  );
  check(
    "kasir melihat pesanan VA beserta bank & nomor tujuannya",
    barisVa?.method === "va" &&
      barisVa.bank === "bni" &&
      barisVa.vaNumber === pesananVa.charge.vaNumber &&
      barisVa.status === "pending",
    JSON.stringify(barisVa),
  );

  await client.mutation(api.payments.act, {
    tenantId,
    actorId: userId,
    chargeId: pesananVa.charge.id,
    action: "settle",
    amount: pesananVa.total,
  });
  const statusVaLunas = await client.query(api.meja.status, {
    watch: pesananVa.watchToken,
  });
  const antreanVa = await client.query(api.pos.kdsTickets, {
    tenantId,
    storeId,
    actorId: userId,
  });
  const tiketVa = antreanVa.find(
    (ticket) => ticket.number === statusVaLunas.saleNumber,
  );
  check(
    "tagihan VA yang lunas menjadi penjualan tertahan + tiket dapur mejanya",
    statusVaLunas.ok === true &&
      statusVaLunas.status === "paid" &&
      tiketVa?.tableName === "A1" &&
      tiketVa.items[0].quantity === 1,
    JSON.stringify({ status: statusVaLunas, tiket: tiketVa }).slice(0, 240),
  );
  const tagihanVaLunas = await client.query(api.payments.list, {
    tenantId,
    actorId: userId,
  });
  const tagihanVa = tagihanVaLunas.charges.find(
    (charge) => charge.number === pesananVa.charge.number,
  );
  check(
    "tagihan VA menunjuk balik ke penjualan yang dibayarnya",
    tagihanVa?.status === "paid" &&
      tagihanVa.vaNumber === pesananVa.charge.vaNumber &&
      tagihanVa.saleNumber === statusVaLunas.saleNumber,
    JSON.stringify(tagihanVa),
  );

  // Tutup pesanan VA-nya supaya meja kembali kosong untuk blok berikutnya.
  const barisVaLunas = await client.query(api.meja.listOrders, {
    tenantId,
    actorId: userId,
  });
  const pesananVaTerakhir = barisVaLunas.find(
    (row) => row.chargeNumber === pesananVa.charge.number,
  );
  await client.mutation(api.pos.finalizeHeldSale, {
    saleId: pesananVaTerakhir.saleId,
    actorId: userId,
  });

  // ------------------- pembatalan pesanan oleh tamu dari ponselnya sendiri
  // Pembeli bisa berubah pikiran sebelum uangnya masuk, dan yang dilakukannya
  // hanya membatalkan pesanannya sendiri. Yang diperiksa di sini: pagar "belum
  // lunas", kode bayar yang ikut mati, dan bahwa pembatalan itu tidak pernah
  // meninggalkan tiket dapur atau tagihan yang masih bisa dibayar.
  const batalAsing = await client.mutation(api.meja.cancelOwnOrder, {
    watch: "mjo_00000000000000000000000000000000",
  });
  check(
    "token pemantau asing tidak membatalkan pesanan siapa pun",
    batalAsing.ok === false && batalAsing.reason === "Pesanan tidak ditemukan.",
    JSON.stringify(batalAsing),
  );
  const batalBentukSalah = await client.mutation(api.meja.cancelOwnOrder, {
    watch: "bukan-token",
  });
  check(
    "tautan status yang bentuknya salah ditolak sebelum apa pun dibaca",
    batalBentukSalah.ok === false && batalBentukSalah.reason.includes("tidak dikenal"),
    JSON.stringify(batalBentukSalah),
  );

  const antreanSebelumBatal = await client.query(api.pos.kdsTickets, {
    tenantId,
    storeId,
    actorId: userId,
  });
  const pesananBatal = await client.mutation(api.meja.order, {
    token: tokenMeja,
    items: [{ productId: kopiQrId, quantity: 1 }],
    guestName: "Sari",
  });
  const pembatalan = await client.mutation(api.meja.cancelOwnOrder, {
    watch: pesananBatal.watchToken,
    reason: "Tamu berubah pikiran",
  });
  check(
    "tamu bisa membatalkan pesanannya sendiri selama belum lunas",
    pembatalan.ok === true &&
      pembatalan.cancelled === true &&
      pembatalan.chargeCancelled === true,
    JSON.stringify(pembatalan),
  );

  const statusBatal = await client.query(api.meja.status, {
    watch: pesananBatal.watchToken,
  });
  check(
    "tamu melihat pesanannya berstatus dibatalkan (kode bayarnya hilang)",
    statusBatal.ok === true &&
      statusBatal.status === "cancelled" &&
      statusBatal.chargeStatus === "cancelled" &&
      statusBatal.qrPayload === null,
    JSON.stringify(statusBatal).slice(0, 200),
  );

  const tagihanSetelahBatal = await client.query(api.payments.list, {
    tenantId,
    actorId: userId,
  });
  check(
    "tagihan pesanan yang dibatalkan ikut dimatikan",
    tagihanSetelahBatal.charges.find(
      (charge) => charge.number === pesananBatal.charge.number,
    )?.status === "cancelled",
    JSON.stringify(
      tagihanSetelahBatal.charges.find(
        (charge) => charge.number === pesananBatal.charge.number,
      ),
    ),
  );
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.payments.act, {
        tenantId,
        actorId: userId,
        chargeId: pesananBatal.charge.id,
        action: "settle",
        amount: pesananBatal.total,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "tagihan yang dibatalkan tamu tidak bisa dilunasi lagi",
      blocked && message.includes("sudah dibatalkan"),
      message || "DITERIMA — tagihan batal masih bisa dibayar",
    );
  }

  const antreanSetelahBatal = await client.query(api.pos.kdsTickets, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "pembatalan tamu tidak pernah membuat tiket dapur",
    antreanSetelahBatal.length === antreanSebelumBatal.length,
    `${antreanSebelumBatal.length} → ${antreanSetelahBatal.length}`,
  );
  const daftarSetelahBatal = await client.query(api.meja.listOrders, {
    tenantId,
    actorId: userId,
  });
  check(
    "pesanan yang dibatalkan tidak lagi menunggu di daftar kasir",
    !daftarSetelahBatal.some(
      (row) => row.chargeNumber === pesananBatal.charge.number,
    ),
    daftarSetelahBatal.map((row) => row.chargeNumber).join(","),
  );
  const batalLagi = await client.mutation(api.meja.cancelOwnOrder, {
    watch: pesananBatal.watchToken,
  });
  check(
    "pesanan yang sudah dibatalkan tidak bisa dibatalkan dua kali",
    batalLagi.ok === false && batalLagi.reason === "Pesanan ini sudah dibatalkan.",
    JSON.stringify(batalLagi),
  );

  const pesananLunasQr = await client.mutation(api.meja.order, {
    token: tokenMeja,
    items: [{ productId: kopiQrId, quantity: 1 }],
    guestName: "Tono",
  });
  await client.mutation(api.payments.act, {
    tenantId,
    actorId: userId,
    chargeId: pesananLunasQr.charge.id,
    action: "settle",
    amount: pesananLunasQr.total,
  });
  const batalLunas = await client.mutation(api.meja.cancelOwnOrder, {
    watch: pesananLunasQr.watchToken,
  });
  check(
    "pesanan yang sudah lunas tidak bisa dibatalkan dari ponsel tamunya",
    batalLunas.ok === false &&
      batalLunas.reason.includes("sudah dibayar") &&
      /A-\d{5}/.test(batalLunas.reason),
    JSON.stringify(batalLunas),
  );
  // Tutup pesanan itu supaya mejanya kembali kosong untuk blok berikutnya.
  const barisLunasQr = (
    await client.query(api.meja.listOrders, { tenantId, actorId: userId })
  ).find((row) => row.chargeNumber === pesananLunasQr.charge.number);
  await client.mutation(api.pos.finalizeHeldSale, {
    saleId: barisLunasQr.saleId,
    actorId: userId,
  });

  // ------------------------------- denah meja: ubah & hapus (beserta pagarnya)
  // Meja adalah konfigurasi lantai, tetapi begitu dipakai ia jadi bagian riwayat:
  // karena itu hapus punya tiga pagar (terisi, tagihan tamu menunggu, riwayat
  // penjualan) dan jawabannya untuk yang beriwayat adalah menonaktifkan.
  const mejaDiubah = await client.mutation(api.tables.update, {
    tenantId,
    tableId: mejaKedua.tableId,
    actorId: userId,
    name: "A2 Baru",
    seats: 3,
    zone: "Teras",
  });
  const denahSetelahUbah = await client.query(api.tables.list, {
    tenantId,
    storeId,
    actorId: userId,
  });
  const barisA2 = denahSetelahUbah.find((row) => row.id === mejaKedua.tableId);
  check(
    "owner bisa mengubah nama, kursi, dan zona sebuah meja",
    mejaDiubah.name === "A2 Baru" &&
      barisA2?.name === "A2 Baru" &&
      barisA2.seats === 3 &&
      barisA2.zone === "Teras" &&
      barisA2.active === false,
    JSON.stringify(barisA2),
  );

  for (const [label, attempt, expected] of [
    [
      "nama meja yang diubah jadi duplikat",
      () =>
        client.mutation(api.tables.update, {
          tenantId,
          tableId: mejaKedua.tableId,
          actorId: userId,
          name: "A1",
          seats: 3,
        }),
      "sudah ada di denah ini",
    ],
    [
      "kursi di luar batas saat meja diubah",
      () =>
        client.mutation(api.tables.update, {
          tenantId,
          tableId: mejaKedua.tableId,
          actorId: userId,
          name: "A2 Baru",
          seats: 99,
        }),
      "Jumlah kursi",
    ],
    [
      "kasir mengubah meja yang sudah ada",
      () =>
        client.mutation(api.tables.update, {
          tenantId,
          tableId: mejaKedua.tableId,
          actorId: cashierId,
          name: "C9",
          seats: 2,
        }),
      "table.manage",
    ],
    [
      "kasir menghapus meja",
      () =>
        client.mutation(api.tables.remove, {
          tenantId,
          tableId: mejaKedua.tableId,
          actorId: cashierId,
        }),
      "table.manage",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `meja ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — aturan denah meja bocor",
    );
  }

  const pagarMejaBersih = await client.query(api.tables.deletionCheck, {
    tenantId,
    tableId: mejaKedua.tableId,
    actorId: userId,
  });
  check(
    "pagar hapus meja yang belum pernah dipakai: aman dihapus",
    pagarMejaBersih.canDelete === true &&
      pagarMejaBersih.name === "A2 Baru" &&
      pagarMejaBersih.usage.sales === 0 &&
      pagarMejaBersih.sentence.includes("belum pernah dipakai"),
    JSON.stringify(pagarMejaBersih).slice(0, 240),
  );

  const pagarMejaBeriwayat = await client.query(api.tables.deletionCheck, {
    tenantId,
    tableId: meja.tableId,
    actorId: userId,
  });
  check(
    "meja yang sudah punya riwayat penjualan ditolak dihapus (disarankan dinonaktifkan)",
    pagarMejaBeriwayat.canDelete === false &&
      pagarMejaBeriwayat.usage.sales >= 2 &&
      pagarMejaBeriwayat.sentence.includes("nonaktifkan saja meja ini"),
    JSON.stringify(pagarMejaBeriwayat).slice(0, 240),
  );

  const hapusBersih = await client.mutation(api.tables.remove, {
    tenantId,
    tableId: mejaKedua.tableId,
    actorId: userId,
  });
  const denahSetelahHapus = await client.query(api.tables.list, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "meja yang belum pernah dipakai benar-benar terhapus dari denah",
    hapusBersih.name === "A2 Baru" &&
      !denahSetelahHapus.some((row) => row.id === mejaKedua.tableId),
    JSON.stringify(denahSetelahHapus.map((row) => row.name)),
  );

  for (const [label, attempt, expected] of [
    [
      "memeriksa pagar hapus meja yang sudah dihapus",
      () =>
        client.query(api.tables.deletionCheck, {
          tenantId,
          tableId: mejaKedua.tableId,
          actorId: userId,
        }),
      "tidak ditemukan",
    ],
    [
      "menghapus meja yang sudah dihapus",
      () =>
        client.mutation(api.tables.remove, {
          tenantId,
          tableId: mejaKedua.tableId,
          actorId: userId,
        }),
      "tidak ditemukan",
    ],
    [
      "menghapus meja yang sudah punya riwayat penjualan",
      () =>
        client.mutation(api.tables.remove, {
          tenantId,
          tableId: meja.tableId,
          actorId: userId,
        }),
      "nonaktifkan saja meja ini",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `ditolak di server: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — pagar hapus meja bocor",
    );
  }

  // Tagihan tamu yang masih menunggu juga menghalangi: tamu bisa membayarnya
  // kapan saja, dan mejanya boleh dibatalkan tamunya sendiri lebih dulu.
  const pesananTunggu = await client.mutation(api.meja.order, {
    token: tokenMeja,
    items: [{ productId: kopiQrId, quantity: 1 }],
    guestName: "Dewi",
  });
  const pagarMejaTunggu = await client.query(api.tables.deletionCheck, {
    tenantId,
    tableId: meja.tableId,
    actorId: userId,
  });
  check(
    "meja dengan tagihan tamu yang masih menunggu tidak boleh dihapus",
    pagarMejaTunggu.canDelete === false &&
      pagarMejaTunggu.usage.pendingGuestOrders === 1 &&
      pagarMejaTunggu.blockers.some(
        (line) =>
          line.includes("menunggu pembayaran") &&
          line.includes("membatalkannya sendiri"),
      ),
    JSON.stringify(pagarMejaTunggu.blockers),
  );
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.tables.remove, {
        tenantId,
        tableId: meja.tableId,
        actorId: userId,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "menghapus meja yang tagihannya masih menunggu ditolak dengan kalimat itu",
      blocked && message.includes("menunggu pembayaran"),
      message || "DITERIMA — pagar hapus meja bocor",
    );
  }
  await client.mutation(api.meja.cancelOwnOrder, {
    watch: pesananTunggu.watchToken,
    reason: "Tamu batal sebelum bayar",
  });
  const pagarSetelahBatal = await client.query(api.tables.deletionCheck, {
    tenantId,
    tableId: meja.tableId,
    actorId: userId,
  });
  check(
    "pembatalan tamu melepas penghalang tagihan dari pagar hapus meja",
    pagarSetelahBatal.usage.pendingGuestOrders === 0 &&
      !pagarSetelahBatal.blockers.some((line) => line.includes("menunggu pembayaran")),
    JSON.stringify(pagarSetelahBatal.blockers),
  );

  /*
    Jalur yang sama dari sisi kasir: tagihan dibatalkan dari halaman Pembayaran
    (aksi `payments.act`), dan niat pesanan tamunya tetap tercatat. Tagihan yang
    sudah dibatalkan tidak bisa dibayar lagi, jadi ia tidak boleh lagi dihitung
    "menunggu pelunasan" — baik di layar dapur maupun di pagar hapus meja.
  */
  const pesananBatalKasir = await client.mutation(api.meja.order, {
    token: tokenMeja,
    items: [{ productId: kopiQrId, quantity: 1 }],
    guestName: "Eka",
  });
  await client.mutation(api.payments.act, {
    tenantId,
    actorId: userId,
    chargeId: pesananBatalKasir.charge.id,
    action: "cancel",
    reason: "Dibatalkan kasir dari halaman Pembayaran",
  });
  const pagarSetelahKasirBatal = await client.query(api.tables.deletionCheck, {
    tenantId,
    tableId: meja.tableId,
    actorId: userId,
  });
  check(
    "membatalkan tagihannya dari halaman Pembayaran melepas penghalang hapus meja",
    pagarSetelahKasirBatal.usage.pendingGuestOrders === 0 &&
      !pagarSetelahKasirBatal.blockers.some((line) => line.includes("menunggu pembayaran")),
    JSON.stringify(pagarSetelahKasirBatal.blockers),
  );

  // ------------------------- denah meja: urutan tersimpan & impor sekaligus
  // Urutan denah adalah keadaan bersama satu toko, jadi ia disimpan (`sortOrder`)
  // dan dihitung server — bukan disusun ulang klien setiap kali halaman dibuka.
  const mejaC = await client.mutation(api.tables.create, {
    tenantId,
    storeId,
    actorId: userId,
    name: "C1",
    seats: 4,
  });
  const denahUrut = await client.query(api.tables.list, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "meja baru masuk di akhir denah, bukan menyelip di antara meja lama",
    denahUrut.map((row) => row.name).join(",") === "A1,C1" &&
      denahUrut.every((row, index) => row.sortOrder === index + 1),
    JSON.stringify(denahUrut.map((row) => `${row.name}:${row.sortOrder}`)),
  );

  const geserMaju = await client.mutation(api.tables.move, {
    tenantId,
    tableId: mejaC.tableId,
    actorId: userId,
    step: -1,
  });
  const denahSetelahGeser = await client.query(api.tables.list, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "meja bisa digeser satu langkah di denah",
    geserMaju.changed >= 2 &&
      denahSetelahGeser.map((row) => row.name).join(",") === "C1,A1" &&
      denahSetelahGeser.every((row, index) => row.sortOrder === index + 1),
    JSON.stringify({ geserMaju, urut: denahSetelahGeser.map((r) => r.name) }),
  );

  for (const [label, attempt, expected] of [
    [
      "menggeser meja paling awal ke belakang",
      () =>
        client.mutation(api.tables.move, {
          tenantId,
          tableId: mejaC.tableId,
          actorId: userId,
          step: -1,
        }),
      "paling awal",
    ],
    [
      "menggeser meja paling akhir ke depan",
      () =>
        client.mutation(api.tables.move, {
          tenantId,
          tableId: meja.tableId,
          actorId: userId,
          step: 1,
        }),
      "paling akhir",
    ],
    [
      "menggeser meja yang tidak ada di denah ini",
      () =>
        client.mutation(api.tables.move, {
          tenantId,
          tableId: mejaKedua.tableId,
          actorId: userId,
          step: 1,
        }),
      "tidak ditemukan",
    ],
    [
      "kasir menata urutan denah",
      () =>
        client.mutation(api.tables.move, {
          tenantId,
          tableId: meja.tableId,
          actorId: cashierId,
          step: -1,
        }),
      "table.manage",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `ditolak di server: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — aturan urutan denah bocor",
    );
  }

  // Mengubah identitas meja tidak boleh menggeser tataannya.
  await client.mutation(api.tables.update, {
    tenantId,
    tableId: mejaC.tableId,
    actorId: userId,
    name: "C1 Baru",
    seats: 2,
    zone: "Bar",
  });
  const denahSetelahRename = await client.query(api.tables.list, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "mengubah nama meja tidak mengubah urutan denahnya",
    denahSetelahRename.map((row) => row.name).join(",") === "C1 Baru,A1",
    JSON.stringify(denahSetelahRename.map((row) => row.name)),
  );

  // Impor sekaligus: satu aksi, satu entri audit, urutannya mengikuti teksnya.
  const impor = await client.mutation(api.tables.importBatch, {
    tenantId,
    storeId,
    actorId: userId,
    text: "# denah teras\nT1, 4, Utama\nT2, 2\nTeras 2, 6, Teras",
  });
  const denahSetelahImpor = await client.query(api.tables.list, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "impor menambah beberapa meja sekaligus di akhir denah, urut teksnya",
    impor.created === 3 &&
      impor.names.join(",") === "T1,T2,Teras 2" &&
      denahSetelahImpor.map((row) => row.name).join(",") ===
        "C1 Baru,A1,T1,T2,Teras 2" &&
      denahSetelahImpor.every((row, index) => row.sortOrder === index + 1),
    JSON.stringify(denahSetelahImpor.map((row) => `${row.name}:${row.sortOrder}`)),
  );
  check(
    "meja hasil impor memakai kursi & zona dari barisnya (kolom kosong = bawaan)",
    denahSetelahImpor.find((row) => row.name === "T2")?.seats === 2 &&
      denahSetelahImpor.find((row) => row.name === "Teras 2")?.zone === "Teras",
    JSON.stringify(denahSetelahImpor.map((row) => `${row.name}/${row.seats}/${row.zone}`)),
  );

  for (const [label, text, expected] of [
    ["baris yang namanya kembar di batch", "U1, 4\nu1, 2", "Baris 2"],
    ["baris yang namanya sudah ada di denah", "U2, 4\nA1, 2", "sudah ada di denah ini"],
    ["baris dengan kursi di luar batas", "U3, 4\nU4, 99", "Jumlah kursi"],
    [
      "impor kebanyakan",
      Array.from({ length: 41 }, (_, i) => `W${i + 1}`).join("\n"),
      "maksimal 40 meja",
    ],
    ["impor tanpa satu baris pun", "   \n# hanya catatan\n", "Belum ada baris meja"],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.tables.importBatch, {
        tenantId,
        storeId,
        actorId: userId,
        text,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `impor ditolak di server: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — impor yang salah tetap tersimpan",
    );
  }
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.tables.importBatch, {
        tenantId,
        storeId,
        actorId: cashierId,
        text: "V1, 2",
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "impor denah ditolak untuk kasir (butuh table.manage)",
      blocked && message.includes("table.manage"),
      message || "DITERIMA — kasir bisa mengimpor denah",
    );
  }
  const denahSetelahImporGagal = await client.query(api.tables.list, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "impor yang ditolak tidak meninggalkan satu meja pun",
    denahSetelahImporGagal.map((row) => row.name).join(",") ===
      "C1 Baru,A1,T1,T2,Teras 2" &&
      denahSetelahImporGagal.every((row, index) => row.sortOrder === index + 1),
    JSON.stringify(denahSetelahImporGagal.map((row) => row.name)),
  );

  // ---------------------------------------- modifier item (`pos.modifier`)
  // Modifier punya dua penjaga seperti fitur modul lain: modulnya harus aktif,
  // dan sah-tidaknya pilihan divalidasi **server** (grup wajib, batas pilihan,
  // opsi asing) — bukan hanya di dialog kasir.
  const { productId: nasiId } = await client.mutation(api.products.create, {
    tenantId,
    storeId,
    sku: `NASI-${runId}`,
    name: "Nasi Goreng Uji",
    price: 10000,
    openingStock: 50,
    actorId: userId,
    modifiers: [
      {
        code: "PEDAS",
        name: "Level pedas",
        minSelect: 1,
        maxSelect: 1,
        options: [
          { code: "1", name: "Pedas 1", price: 0 },
          { code: "3", name: "Pedas 3", price: 0 },
        ],
      },
      {
        code: "TOPPING",
        name: "Topping",
        minSelect: 0,
        maxSelect: 2,
        options: [
          { code: "TELUR", name: "Telur", price: 5000 },
          { code: "KEJU", name: "Keju", price: 7000 },
          { code: "BAKSO", name: "Bakso", price: 6000 },
        ],
      },
    ],
  });

  const katalog = await client.query(api.products.listByStore, {
    tenantId,
    storeId,
    actorId: userId,
  });
  const nasi = katalog.find((p) => p._id === nasiId);
  check(
    "modifier tersimpan di produk (2 grup, 3 opsi)",
    nasi?.modifiers?.length === 2 && nasi.modifiers[1].options.length === 3,
    JSON.stringify(nasi?.modifiers),
  );

  for (const [label, modifiers, expected] of [
    ["grup wajib tidak dipilih", [], "wajib dipilih"],
    ["opsi tidak ada di grup", [{ groupCode: "PEDAS", optionCodes: ["9"] }], "tidak ada di grup"],
    ["grup tidak dikenal", [{ groupCode: "SAUS", optionCodes: ["A"] }], "tidak dikenal"],
    [
      "melebihi batas pilihan",
      [
        { groupCode: "PEDAS", optionCodes: ["1"] },
        { groupCode: "TOPPING", optionCodes: ["TELUR", "KEJU", "BAKSO"] },
      ],
      "Maksimal 2",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.pos.createSale, {
        tenantId,
        storeId,
        cashierId: userId,
        items: [{ productId: nasiId, quantity: 1, modifiers }],
        payments: [{ method: "cash", amount: 10000 }],
        idempotencyKey: `mod-${label}-${runId}`,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `modifier ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — validasi modifier bocor",
    );
  }

  // Tambahan modifier dihitung **per unit**: 2 × 10.000 + 2 × 5.000 = 30.000,
  // lalu PPN 11% → 33.300.
  const nasiSale = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    cashierId: userId,
    items: [
      {
        productId: nasiId,
        quantity: 2,
        modifiers: [
          { groupCode: "PEDAS", optionCodes: ["1"] },
          { groupCode: "TOPPING", optionCodes: ["TELUR"] },
        ],
      },
    ],
    payments: [{ method: "cash", amount: 33300 }],
    idempotencyKey: `mod-harga-${runId}`,
  });
  check(
    "total memuat tambahan modifier per unit (33.300)",
    nasiSale.total === 33300,
    String(nasiSale.total),
  );

  // Label modifier ikut ke tiket dapur, urutannya stabil (urut konfigurasi lalu
  // kode opsi) supaya dapur membaca hal yang sama untuk pilihan yang sama.
  const nasiHeld = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    cashierId: userId,
    items: [
      {
        productId: nasiId,
        quantity: 1,
        modifiers: [
          { groupCode: "PEDAS", optionCodes: ["3"] },
          { groupCode: "TOPPING", optionCodes: ["TELUR", "KEJU"] },
        ],
      },
    ],
    payments: [{ method: "cash", amount: 10000 }],
    status: "held",
    idempotencyKey: `mod-tiket-${runId}`,
  });
  const antreanModifier = await client.query(api.pos.kdsTickets, {
    tenantId,
    storeId,
    actorId: userId,
  });
  const tiketModifier = antreanModifier.find((t) => t.saleId === nasiHeld.saleId);
  check(
    "tiket dapur memuat label modifier",
    JSON.stringify(tiketModifier?.items?.[0]?.modifiers) ===
      JSON.stringify([
        "Level pedas: Pedas 3",
        "Topping: Keju",
        "Topping: Telur",
      ]),
    JSON.stringify(tiketModifier?.items),
  );
  await client.mutation(api.pos.finalizeHeldSale, {
    saleId: nasiHeld.saleId,
    actorId: userId,
  });

  await client.mutation(api.modules.setForTenant, {
    tenantId,
    actorId: userId,
    verticals: ["umkm"],
  });
  const afterOff = await client.query(api.tenants.getMine, { tenantId, actorId: userId });
  check(
    "modul F&B bisa dimatikan (tersisa UMKM)",
    afterOff?.verticals?.join(",") === "umkm",
    JSON.stringify(afterOff?.verticals),
  );

  for (const [label, attempt] of [
    [
      "kirim ke dapur",
      () =>
        client.mutation(api.pos.finalizeHeldSale, { saleId: held.saleId, actorId: userId }),
    ],
    [
      "buat pesanan tertahan",
      () =>
        client.mutation(api.pos.createSale, {
          tenantId,
          storeId,
          cashierId: userId,
          items: [{ productId: rotiId, quantity: 1 }],
          payments: [{ method: "cash", amount: 15000 }],
          idempotencyKey: `held-off-${runId}`,
          status: "held",
        }),
    ],
    [
      "menambah meja",
      () =>
        client.mutation(api.tables.create, {
          tenantId,
          storeId,
          actorId: userId,
          name: "D1",
          seats: 2,
        }),
    ],
    [
      "membaca antrean dapur",
      () => client.query(api.pos.kdsTickets, { tenantId, storeId, actorId: userId }),
    ],
    [
      "mengubah modifier produk",
      () =>
        client.mutation(api.products.setModifiers, {
          tenantId,
          actorId: userId,
          productId: nasiId,
          modifiers: [
            {
              code: "PEDAS",
              name: "Level pedas",
              minSelect: 1,
              maxSelect: 1,
              options: [{ code: "1", name: "Pedas 1", price: 0 }],
            },
          ],
        }),
    ],
    [
      "memilih modifier saat menjual",
      () =>
        client.mutation(api.pos.createSale, {
          tenantId,
          storeId,
          cashierId: userId,
          items: [
            {
              productId: nasiId,
              quantity: 1,
              modifiers: [{ groupCode: "PEDAS", optionCodes: ["1"] }],
            },
          ],
          payments: [{ method: "cash", amount: 10000 }],
          idempotencyKey: `mod-off-${runId}`,
        }),
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `alur F&B ditolak saat modul mati: ${label}`,
      blocked && message.includes("memerlukan modul"),
      message || "DITERIMA — gerbang modul bocor",
    );
  }

  // Produk bermodifier tidak boleh dijual tanpa modulnya: pilihan pelanggan
  // (mis. level pedas yang wajib) akan hilang diam-diam dari pesanannya.
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.pos.createSale, {
        tenantId,
        storeId,
        cashierId: userId,
        items: [{ productId: nasiId, quantity: 1 }],
        payments: [{ method: "cash", amount: 10000 }],
        idempotencyKey: `mod-tanpa-modul-${runId}`,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "produk bermodifier tidak dijual diam-diam saat modul F&B mati",
      blocked && message.includes("modifier item"),
      message || "DITERIMA — gerbang modifier bocor",
    );
  }

  // Mengosongkan konfigurasi selalu boleh, bahkan setelah modulnya dimatikan.
  await client.mutation(api.products.setModifiers, {
    tenantId,
    actorId: userId,
    productId: nasiId,
    modifiers: [],
  });
  const katalogKosong = await client.query(api.products.listByStore, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "modifier bisa dihapus tanpa modul F&B",
    (katalogKosong.find((p) => p._id === nasiId)?.modifiers ?? []).length === 0,
    JSON.stringify(katalogKosong.find((p) => p._id === nasiId)?.modifiers),
  );

  await client.mutation(api.modules.setForTenant, {
    tenantId,
    actorId: userId,
    verticals: ["umkm", "fnb"],
  });
  const finalized = await client.mutation(api.pos.finalizeHeldSale, {
    saleId: held.saleId,
    actorId: userId,
  });
  check(
    "setelah modul F&B dinyalakan lagi, kirim ke dapur berhasil",
    finalized.saleId === held.saleId,
    JSON.stringify(finalized),
  );

  // ------------------------------- grosir: harga bertingkat + konversi satuan
  // Professional hanya mengizinkan 2 modul, jadi F&B diganti Grosir di sini.
  await client.mutation(api.modules.setForTenant, {
    tenantId,
    actorId: userId,
    verticals: ["umkm", "wholesale"],
  });
  await client.mutation(api.products.adjustStock, {
    tenantId,
    storeId,
    productId: rotiId,
    delta: 24,
    note: "Siapkan uji grosir",
    actorId: userId,
  });

  const pricing = await client.mutation(api.products.setPricing, {
    tenantId,
    actorId: userId,
    productId: rotiId,
    price: 12000,
    unit: "pcs",
    units: [{ code: "dus", factor: 12 }],
    // Sengaja tidak terurut supaya bisa dibuktikan dinormalkan server.
    tiers: [
      { minQty: 12, price: 9000 },
      { minQty: 6, price: 10500 },
    ],
  });
  check(
    "harga grosir tersimpan: satuan dinormalkan & tier terurut",
    pricing.unit === "PCS" &&
      pricing.units[0].code === "DUS" &&
      pricing.tiers.map((t) => t.minQty).join(",") === "6,12",
    JSON.stringify(pricing),
  );

  const dusSale = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    cashierId: userId,
    items: [{ productId: rotiId, quantity: 1, unitCode: "DUS" }],
    payments: [{ method: "cash", amount: 119880 }],
    idempotencyKey: `dus-${runId}`,
  });
  check(
    "1 DUS = 12 Pcs, kena tier 9.000 → total 119.880 setelah PPN 11%",
    dusSale.total === 119880,
    JSON.stringify(dusSale),
  );

  const pcsSale = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    cashierId: userId,
    items: [{ productId: rotiId, quantity: 1 }],
    payments: [{ method: "cash", amount: 13320 }],
    idempotencyKey: `pcs-${runId}`,
  });
  check(
    "1 Pcs tetap memakai harga dasar 12.000 → 13.320 setelah PPN",
    pcsSale.total === 13320,
    JSON.stringify(pcsSale),
  );

  for (const [label, attempt, expected] of [
    [
      "satuan tak dikenal",
      () =>
        client.mutation(api.pos.createSale, {
          tenantId,
          storeId,
          cashierId: userId,
          items: [{ productId: rotiId, quantity: 1, unitCode: "PAK" }],
          payments: [{ method: "cash", amount: 1 }],
          idempotencyKey: `pak-${runId}`,
        }),
      "tidak dikenal",
    ],
    [
      "tier lebih mahal dari harga dasar",
      () =>
        client.mutation(api.products.setPricing, {
          tenantId,
          actorId: userId,
          productId: rotiId,
          tiers: [{ minQty: 6, price: 99999 }],
        }),
      "lebih mahal",
    ],
    [
      "faktor satuan di bawah 2",
      () =>
        client.mutation(api.products.setPricing, {
          tenantId,
          actorId: userId,
          productId: rotiId,
          units: [{ code: "PAK", factor: 1 }],
        }),
      "minimal 2",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `grosir ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — aturan grosir bocor",
    );
  }

  // Modul Grosir dimatikan: produk bergrosir tidak boleh dijual diam-diam
  // dengan harga dasar, dan penambahan tier baru butuh modulnya.
  await client.mutation(api.modules.setForTenant, {
    tenantId,
    actorId: userId,
    verticals: ["umkm"],
  });
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.pos.createSale, {
        tenantId,
        storeId,
        cashierId: userId,
        items: [{ productId: rotiId, quantity: 1 }],
        payments: [{ method: "cash", amount: 1 }],
        idempotencyKey: `grosir-off-${runId}`,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "produk bergrosir tidak bisa dijual saat modul Grosir mati",
      blocked && message.includes("aktifkan modul Grosir"),
      message || "DITERIMA — harga pelanggan berubah diam-diam",
    );
  }
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.products.setPricing, {
        tenantId,
        actorId: userId,
        productId: rotiId,
        tiers: [{ minQty: 24, price: 8000 }],
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "menambah tier ditolak saat modul Grosir mati",
      blocked && message.includes("memerlukan modul"),
      message || "DITERIMA — gerbang modul bocor",
    );
  }

  const cleared = await client.mutation(api.products.setPricing, {
    tenantId,
    actorId: userId,
    productId: rotiId,
    tiers: [],
    units: [],
  });
  check(
    "menghapus konfigurasi grosir tetap boleh tanpa modul",
    cleared.tiers.length === 0 && cleared.units.length === 0,
    JSON.stringify(cleared),
  );

  // ---------------- grosir: piutang B2B & credit limit (`ar.creditlimit`)
  // Tempo hanya boleh kalau pelanggannya ada, modulnya hidup, dan sisa limitnya
  // cukup — ketiganya diputuskan server, bukan dialog kasir.
  await client.mutation(api.modules.setForTenant, {
    tenantId,
    actorId: userId,
    verticals: ["umkm", "wholesale"],
  });

  const customer = await client.mutation(api.ar.createCustomer, {
    tenantId,
    actorId: userId,
    name: "Toko Berkah Jaya Uji",
    phone: "0812-3456-7890",
    creditLimit: 1_000_000,
    paymentTermDays: 30,
  });
  check(
    "pelanggan B2B dibuat dengan kode otomatis dari nama",
    customer.code === "TBJU",
    customer.code,
  );

  const paidCustomer = await client.mutation(api.ar.createCustomer, {
    tenantId,
    actorId: userId,
    name: "Warung Kecil Uji",
    creditLimit: 10_000,
    paymentTermDays: 7,
  });
  check(
    "pelanggan kedua menerima kode sendiri",
    paidCustomer.code === "WKU",
    paidCustomer.code,
  );

  for (const [label, attempt, expected] of [
    [
      "kode pelanggan duplikat",
      () =>
        client.mutation(api.ar.createCustomer, {
          tenantId,
          actorId: userId,
          name: "Toko Lain Uji",
          code: "TBJU",
        }),
      "sudah dipakai",
    ],
    [
      "limit kredit tanpa tempo",
      () =>
        client.mutation(api.ar.createCustomer, {
          tenantId,
          actorId: userId,
          name: "Toko Tanpa Tempo Uji",
          creditLimit: 100_000,
          paymentTermDays: 0,
        }),
      "harus punya tempo",
    ],
    [
      "telepon tidak valid",
      () =>
        client.mutation(api.ar.createCustomer, {
          tenantId,
          actorId: userId,
          name: "Toko Telepon Uji",
          phone: "abc",
        }),
      "telepon",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `pelanggan ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — validasi pelanggan bocor",
    );
  }

  // 1 Roti 12.000 + PPN 11% = 13.320; dibayar 5.000 → piutang 8.320 dengan tempo
  // 30 hari milik pelanggan yang dipilih.
  const creditSale = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    cashierId,
    items: [{ productId: rotiId, quantity: 1 }],
    payments: [{ method: "cash", amount: 5_000 }],
    customerId: customer.customerId,
    idempotencyKey: `ar-sebagian-${runId}`,
  });
  check(
    "bayar sebagian → sisa dicatat sebagai piutang",
    creditSale.total === 13_320 && creditSale.creditAmount === 8_320,
    JSON.stringify(creditSale),
  );

  let piutang = await client.query(api.ar.list, { tenantId, actorId: userId });
  const nota = piutang.receivables.find((row) => row.saleId === creditSale.saleId);
  const pembeli = piutang.customers.find((row) => row.id === customer.customerId);
  check(
    "nota piutang memuat nomor nota, sisa, dan pelanggannya",
    nota?.balance === 8_320 &&
      nota.paidAmount === 0 &&
      nota.customerName === "Toko Berkah Jaya Uji" &&
      nota.status === "open",
    JSON.stringify(nota),
  );
  check(
    "jatuh tempo mengikuti tempo pelanggan (30 hari)",
    nota !== undefined &&
      Math.round((nota.dueDate - nota.createdAt) / 86_400_000) === 30 &&
      nota.daysPastDue < 0,
    JSON.stringify({ due: nota?.dueDate, dibuat: nota?.createdAt, umur: nota?.daysPastDue }),
  );
  check(
    "piutang menurunkan sisa limit pelanggan",
    pembeli?.outstanding === 8_320 && pembeli.availableCredit === 991_680,
    JSON.stringify(pembeli),
  );
  check(
    "ringkasan piutang menghitung total terbuka",
    piutang.summary.outstanding === 8_320 && piutang.summary.openCount === 1,
    JSON.stringify(piutang.summary),
  );

  for (const [label, attempt, expected] of [
    [
      "tempo melebihi sisa limit",
      () =>
        client.mutation(api.pos.createSale, {
          tenantId,
          storeId,
          cashierId,
          items: [{ productId: rotiId, quantity: 1 }],
          payments: [{ method: "cash", amount: 0 }],
          customerId: paidCustomer.customerId,
          idempotencyKey: `ar-lewat-${runId}`,
        }),
      "Sisa limit kredit",
    ],
    [
      "tempo tanpa pelanggan",
      () =>
        client.mutation(api.pos.createSale, {
          tenantId,
          storeId,
          cashierId,
          items: [{ productId: rotiId, quantity: 1 }],
          payments: [{ method: "cash", amount: 5_000 }],
          idempotencyKey: `ar-tanpa-pelanggan-${runId}`,
        }),
      "butuh pelanggan B2B",
    ],
    [
      "tempo untuk pelanggan tunai (limit 0)",
      () =>
        client.mutation(api.ar.setCredit, {
          tenantId,
          actorId: userId,
          customerId: paidCustomer.customerId,
          creditLimit: 0,
          paymentTermDays: 0,
        }).then(() =>
          client.mutation(api.pos.createSale, {
            tenantId,
            storeId,
            cashierId,
            items: [{ productId: rotiId, quantity: 1 }],
            payments: [{ method: "cash", amount: 0 }],
            customerId: paidCustomer.customerId,
            idempotencyKey: `ar-limit-nol-${runId}`,
          }),
        ),
      "belum punya limit kredit",
    ],
    [
      "tempo pada pesanan yang masih di dapur",
      () =>
        client.mutation(api.pos.createSale, {
          tenantId,
          storeId,
          cashierId,
          items: [{ productId: rotiId, quantity: 1 }],
          payments: [{ method: "cash", amount: 0 }],
          customerId: customer.customerId,
          status: "held",
          idempotencyKey: `ar-held-${runId}`,
        }),
      "belum bisa dibayar tempo",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `tempo ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — aturan tempo bocor",
    );
  }

  // Kasir boleh **melihat** sisa limit (supaya tidak menjual melebihi limit),
  // tetapi memberi limit dan mencatat pelunasan bukan wewenangnya.
  const kasirPiutang = await client.query(api.ar.list, {
    tenantId,
    actorId: cashierId,
  });
  check(
    "kasir boleh melihat piutang & sisa limit",
    kasirPiutang.customers.some((row) => row.id === customer.customerId),
    JSON.stringify(kasirPiutang.customers.map((c) => c.name)),
  );
  for (const [label, attempt] of [
    [
      "mengubah limit kredit",
      () =>
        client.mutation(api.ar.setCredit, {
          tenantId,
          actorId: cashierId,
          customerId: customer.customerId,
          creditLimit: 99_000_000,
        }),
    ],
    [
      "menambah pelanggan B2B",
      () =>
        client.mutation(api.ar.createCustomer, {
          tenantId,
          actorId: cashierId,
          name: "Pelanggan Kasir Uji",
          creditLimit: 100_000,
        }),
    ],
    [
      "mencatat pelunasan piutang",
      () =>
        client.mutation(api.ar.recordPayment, {
          tenantId,
          actorId: cashierId,
          receivableId: nota.id,
          amount: 1_000,
          method: "cash",
        }),
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `kasir ditolak: ${label}`,
      blocked && message.includes("tidak memiliki izin"),
      message || "DITERIMA — izin piutang bocor",
    );
  }

  // Pelunasan: sebagian dulu, kelebihan ditolak, lalu sisanya.
  const partial = await client.mutation(api.ar.recordPayment, {
    tenantId,
    actorId: userId,
    receivableId: nota.id,
    amount: 3_320,
    method: "transfer",
    note: "Cicilan pertama",
  });
  check(
    "pelunasan sebagian mengurangi sisa piutang",
    partial.remaining === 5_000 && partial.fullyPaid === false,
    JSON.stringify(partial),
  );

  let overpay = "";
  try {
    await client.mutation(api.ar.recordPayment, {
      tenantId,
      actorId: userId,
      receivableId: nota.id,
      amount: 999_999,
      method: "cash",
    });
  } catch (error) {
    overpay = error?.message ?? String(error);
  }
  check("kelebihan bayar piutang ditolak", overpay.includes("melebihi sisa piutang"), overpay || "DITERIMA");

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.pos.voidSale, {
        saleId: creditSale.saleId,
        actorId: userId,
        reason: "Uji piutang sudah dibayar",
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "penjualan dengan piutang yang sudah dibayar tidak bisa dibatalkan",
      blocked && message.includes("sudah menerima pembayaran"),
      message || "DITERIMA — uang bisa hilang lewat void",
    );
  }

  // Modul Grosir dimatikan: tempo baru berhenti, tetapi nota lama tetap bisa
  // dilihat dan ditagih sampai lunas — utang tidak boleh jadi tak tertagih.
  await client.mutation(api.modules.setForTenant, {
    tenantId,
    actorId: userId,
    verticals: ["umkm"],
  });

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.pos.createSale, {
        tenantId,
        storeId,
        cashierId,
        items: [{ productId: rotiId, quantity: 1 }],
        payments: [{ method: "cash", amount: 0 }],
        customerId: customer.customerId,
        idempotencyKey: `ar-off-${runId}`,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "tempo baru ditolak saat modul Grosir mati",
      blocked && message.includes("memerlukan modul"),
      message || "DITERIMA — gerbang modul bocor",
    );
  }

  const stillCollectable = await client.query(api.ar.list, {
    tenantId,
    actorId: userId,
  });
  check(
    "piutang lama tetap terbaca tanpa modul Grosir",
    stillCollectable.summary.outstanding === 5_000,
    JSON.stringify(stillCollectable.summary),
  );

  const settled = await client.mutation(api.ar.recordPayment, {
    tenantId,
    actorId: userId,
    receivableId: nota.id,
    amount: 5_000,
    method: "cash",
  });
  check(
    "pelunasan sisa piutang tetap boleh tanpa modul Grosir",
    settled.fullyPaid === true && settled.remaining === 0,
    JSON.stringify(settled),
  );

  const afterSettle = await client.query(api.ar.list, { tenantId, actorId: userId });
  check(
    "limit pelanggan kembali penuh setelah nota lunas",
    afterSettle.summary.outstanding === 0 &&
      afterSettle.customers.find((row) => row.id === customer.customerId)
        ?.availableCredit === 1_000_000,
    JSON.stringify(afterSettle.summary),
  );

  // ------------------------- UMKM: member & diskon member (`member.discount`)
  // Diskon dihitung server dari **data member**, bukan dari angka yang dikirim
  // klien — dan hanya hidup selama modul UMKM menyala.
  await client.mutation(api.modules.setForTenant, {
    tenantId,
    actorId: userId,
    verticals: ["umkm"],
  });

  const member = await client.mutation(api.loyalty.create, {
    tenantId,
    actorId: userId,
    name: "Sari Uji",
    phone: "0812-1111-2222",
    discountPct: 5,
  });
  check("member dibuat dengan kode otomatis dari nama", member.code === "SU", member.code);

  for (const [label, attempt, expected] of [
    [
      "kode member duplikat",
      () =>
        client.mutation(api.loyalty.create, {
          tenantId,
          actorId: userId,
          name: "Sari Kedua",
          code: "SU",
        }),
      "sudah dipakai",
    ],
    [
      "diskon di atas batas",
      () =>
        client.mutation(api.loyalty.create, {
          tenantId,
          actorId: userId,
          name: "Member Boros Uji",
          discountPct: 80,
        }),
      "maksimal 50%",
    ],
    [
      "telepon tidak valid",
      () =>
        client.mutation(api.loyalty.create, {
          tenantId,
          actorId: userId,
          name: "Member Telepon Uji",
          phone: "abc",
        }),
      "telepon",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `member ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — validasi member bocor",
    );
  }

  // 1 × Roti 12.000 + PPN 11% = 13.320. Dengan member 5%: diskon 600 → net
  // 11.400 → PPN 1.254 → total 12.654.
  const memberSale = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    cashierId,
    items: [{ productId: rotiId, quantity: 1 }],
    payments: [{ method: "cash", amount: 12_654 }],
    memberId: member.memberId,
    idempotencyKey: `member-${runId}`,
  });
  check(
    "diskon member 5% dihitung server (600) dan totalnya 12.654",
    memberSale.total === 12_654 && memberSale.memberDiscount === 600,
    JSON.stringify(memberSale),
  );

  const recentWithMember = await client.query(api.pos.recent, {
    tenantId,
    storeId,
    actorId: userId,
    limit: 5,
  });
  const savedMemberSale = recentWithMember.find((sale) => sale._id === memberSale.saleId);
  check(
    "penjualan menyimpan member & bagian diskonnya",
    savedMemberSale?.memberId === member.memberId &&
      savedMemberSale?.memberDiscount === 600 &&
      savedMemberSale?.discount === 600,
    JSON.stringify({
      memberId: savedMemberSale?.memberId,
      memberDiscount: savedMemberSale?.memberDiscount,
      discount: savedMemberSale?.discount,
    }),
  );

  // Diskon manual + member digabung: 600 + 1.000 = 1.600 → net 10.400 → PPN
  // 1.144 → total 11.544.
  const combinedSale = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    cashierId,
    items: [{ productId: rotiId, quantity: 1 }],
    discount: 1_000,
    payments: [{ method: "cash", amount: 11_544 }],
    memberId: member.memberId,
    idempotencyKey: `member-gabung-${runId}`,
  });
  check(
    "diskon member + diskon manual digabung (11.544)",
    combinedSale.total === 11_544 && combinedSale.memberDiscount === 600,
    JSON.stringify(combinedSale),
  );

  // Kasir memakai diskon yang sudah ditetapkan, tetapi tidak menentukannya.
  const kasirMember = await client.query(api.loyalty.list, {
    tenantId,
    actorId: cashierId,
  });
  check(
    "kasir boleh melihat daftar member",
    kasirMember.some((row) => row.id === member.memberId),
    JSON.stringify(kasirMember.map((m) => m.name)),
  );
  for (const [label, attempt] of [
    [
      "menambah member",
      () =>
        client.mutation(api.loyalty.create, {
          tenantId,
          actorId: cashierId,
          name: "Member Kasir Uji",
          discountPct: 20,
        }),
    ],
    [
      "mengubah diskon member",
      () =>
        client.mutation(api.loyalty.update, {
          tenantId,
          actorId: cashierId,
          memberId: member.memberId,
          discountPct: 30,
        }),
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `kasir ditolak: ${label}`,
      blocked && message.includes("tidak memiliki izin"),
      message || "DITERIMA — izin member bocor",
    );
  }

  // Member nonaktif tidak boleh dipakai (dan tidak diam-diam kehilangan diskon).
  await client.mutation(api.loyalty.update, {
    tenantId,
    actorId: userId,
    memberId: member.memberId,
    active: false,
  });
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.pos.createSale, {
        tenantId,
        storeId,
        cashierId,
        items: [{ productId: rotiId, quantity: 1 }],
        payments: [{ method: "cash", amount: 13_320 }],
        memberId: member.memberId,
        idempotencyKey: `member-nonaktif-${runId}`,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "member nonaktif ditolak saat menjual",
      blocked && message.includes("tidak aktif"),
      message || "DITERIMA — member nonaktif masih mendapat diskon",
    );
  }

  // Modul UMKM dimatikan: diskon baru ditolak, tetapi data member tetap terbaca
  // dan diskon bisa ditutup (0%) sebagai jalur pembersihan.
  await client.mutation(api.loyalty.update, {
    tenantId,
    actorId: userId,
    memberId: member.memberId,
    active: true,
  });
  await client.mutation(api.modules.setForTenant, {
    tenantId,
    actorId: userId,
    verticals: ["wholesale"],
  });

  const masihBaca = await client.query(api.loyalty.list, {
    tenantId,
    actorId: userId,
  });
  check(
    "daftar member tetap terbaca tanpa modul UMKM",
    masihBaca.some((row) => row.id === member.memberId),
    JSON.stringify(masihBaca.map((m) => m.name)),
  );

  for (const [label, attempt, expected] of [
    [
      "member baru dengan diskon",
      () =>
        client.mutation(api.loyalty.create, {
          tenantId,
          actorId: userId,
          name: "Member Tanpa Modul Uji",
          discountPct: 5,
        }),
      "memerlukan modul",
    ],
    [
      "menaikkan diskon member",
      () =>
        client.mutation(api.loyalty.update, {
          tenantId,
          actorId: userId,
          memberId: member.memberId,
          discountPct: 10,
        }),
      "memerlukan modul",
    ],
    [
      "menjual dengan diskon member",
      () =>
        client.mutation(api.pos.createSale, {
          tenantId,
          storeId,
          cashierId,
          items: [{ productId: rotiId, quantity: 1 }],
          payments: [{ method: "cash", amount: 13_320 }],
          memberId: member.memberId,
          idempotencyKey: `member-tanpa-modul-${runId}`,
        }),
      "memerlukan modul",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `member ditolak saat modul UMKM mati: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — gerbang modul UMKM bocor",
    );
  }

  const memberTanpaDiskon = await client.mutation(api.loyalty.create, {
    tenantId,
    actorId: userId,
    name: "Member Tunai Uji",
  });
  check(
    "member tanpa diskon tetap bisa dibuat tanpa modul",
    typeof memberTanpaDiskon.memberId === "string",
    JSON.stringify(memberTanpaDiskon),
  );

  const ditutup = await client.mutation(api.loyalty.update, {
    tenantId,
    actorId: userId,
    memberId: member.memberId,
    discountPct: 0,
  });
  check(
    "menutup diskon member (0%) tetap boleh tanpa modul",
    ditutup.discountPct === 0,
    JSON.stringify(ditutup),
  );

  // ------------- Phase 3: gudang & perpindahan stok (`inventory.multiwarehouse`)
  // Satu aturan yang diuji di sini: **kasir menjual dari lokasi jual**, bukan
  // dari gudang. Menambah gudang butuh fitur (Enterprise), memindahkan stok dan
  // mengosongkan gudang selalu boleh.
  const { productId: gudangProductId } = await client.mutation(api.products.create, {
    tenantId,
    storeId,
    sku: `GD-${runId}`,
    name: "Karton Uji Gudang",
    price: 10_000,
    openingStock: 100,
    actorId: userId,
  });

  const awal = await client.query(api.inventory.list, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "lokasi jual selalu ada walau belum punya gudang",
    awal.warehouses.length === 0 &&
      awal.locations.length === 1 &&
      awal.locations[0].isDefault === true,
    JSON.stringify(awal.locations),
  );
  check(
    "stok awal seluruhnya di lokasi jual",
    awal.stock.find((row) => row.productId === gudangProductId)?.sellable === 100 &&
      awal.stock.find((row) => row.productId === gudangProductId)?.total === 100,
    JSON.stringify(awal.stock.find((row) => row.productId === gudangProductId)),
  );
  check(
    "paket Professional hanya memungkinkan lokasi jual",
    awal.capacity.limit === 1 && awal.capacity.full === true,
    JSON.stringify(awal.capacity),
  );

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.inventory.create, {
        tenantId,
        storeId,
        actorId: userId,
        name: "Gudang Utama",
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "menambah gudang ditolak di paket tanpa fiturnya",
      blocked && message.includes("tidak termasuk paket"),
      message || "DITERIMA — gerbang fitur gudang bocor",
    );
  }

  // Naik ke Enterprise: fitur & batasnya ikut naik, dan pemilik boleh.
  const upgraded = await client.mutation(api.billing.changePlan, {
    tenantId,
    newPlanKey: "enterprise",
    actorId: userId,
  });
  check(
    "naik paket ke Enterprise memberi fitur multi-warehouse",
    upgraded.changed === true && upgraded.planKey === "enterprise",
    JSON.stringify(upgraded),
  );
  check(
    "hasil naik paket membawa fitur yang didapat & dilepas",
    Array.isArray(upgraded.gained) &&
      upgraded.gained.length > 0 &&
      Array.isArray(upgraded.lost),
    JSON.stringify(upgraded),
  );

  // Kontrak yang dipakai klien: memilih paket yang **sama** bukan galat, dan
  // bentuk hasilnya tetap lengkap (`gained`/`lost` ada) — tombol Langganan memakai
  // field itu untuk memberi tahu apa yang berubah, jadi ia tidak boleh menebak.
  {
    const sama = await client.mutation(api.billing.changePlan, {
      tenantId,
      newPlanKey: "enterprise",
      actorId: userId,
    });
    check(
      "memilih paket yang sama menjawab changed:false tanpa kehilangan bentuk hasil",
      sama.changed === false &&
        sama.planKey === "enterprise" &&
        Array.isArray(sama.gained) &&
        sama.gained.length === 0 &&
        Array.isArray(sama.lost) &&
        sama.lost.length === 0,
      JSON.stringify(sama),
    );
  }

  const gudang = await client.mutation(api.inventory.create, {
    tenantId,
    storeId,
    actorId: userId,
    name: "Gudang Utama",
    address: "Jl. Sudirman 12",
  });
  check(
    "gudang dibuat dengan kode otomatis dari namanya",
    gudang.code === "GU",
    JSON.stringify(gudang),
  );

  const gudangKedua = await client.mutation(api.inventory.create, {
    tenantId,
    storeId,
    actorId: userId,
    name: "Gudang Cabang",
  });

  for (const [label, attempt, expected] of [
    [
      "kode gudang duplikat",
      () =>
        client.mutation(api.inventory.create, {
          tenantId,
          storeId,
          actorId: userId,
          name: "Gudang Duplikat",
          code: "GU",
        }),
      "sudah dipakai",
    ],
    [
      "nama gudang terlalu pendek",
      () =>
        client.mutation(api.inventory.create, {
          tenantId,
          storeId,
          actorId: userId,
          name: "A",
        }),
      "2–40 karakter",
    ],
    [
      "kode gudang tidak valid",
      () =>
        client.mutation(api.inventory.create, {
          tenantId,
          storeId,
          actorId: userId,
          name: "Gudang Kode",
          code: "G#",
        }),
      "tidak valid",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `gudang ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — validasi gudang bocor",
    );
  }

  // Pindahkan 40 unit ke gudang: stok yang bisa dijual turun, total tetap.
  const pindah = await client.mutation(api.inventory.transfer, {
    tenantId,
    storeId,
    actorId: userId,
    productId: gudangProductId,
    to: gudang.warehouseId,
    quantity: 40,
    note: "Stok simpanan",
  });
  check(
    "perpindahan stok ke gudang bernomor TRF-00001",
    pindah.number === "TRF-00001" && pindah.quantity === 40,
    JSON.stringify(pindah),
  );

  const setelahPindah = await client.query(api.inventory.list, {
    tenantId,
    storeId,
    actorId: userId,
  });
  const baris = setelahPindah.stock.find((row) => row.productId === gudangProductId);
  check(
    "stok terbagi: 60 bisa dijual, 40 di gudang, total tetap 100",
    baris.sellable === 60 &&
      baris.total === 100 &&
      baris.levels.find((level) => level.warehouseId === gudang.warehouseId)
        ?.quantity === 40,
    JSON.stringify(baris),
  );
  check(
    "riwayat perpindahan terbaca dari ledger (dari → ke)",
    setelahPindah.history.length === 1 &&
      setelahPindah.history[0].number === "TRF-00001" &&
      setelahPindah.history[0].fromName.includes("Lokasi jual") &&
      setelahPindah.history[0].toName.includes("Gudang Utama") &&
      setelahPindah.history[0].quantity === 40,
    JSON.stringify(setelahPindah.history),
  );
  check(
    "produk.listByStore hanya menghitung lokasi jual",
    (await client.query(api.products.listByStore, { tenantId, storeId, actorId: userId })).find(
      (product) => product._id === gudangProductId,
    )?.stock === 60,
    "stok halaman Produk = stok yang bisa dijual",
  );

  for (const [label, attempt, expected] of [
    [
      "melebihi stok di lokasi asal",
      () =>
        client.mutation(api.inventory.transfer, {
          tenantId,
          storeId,
          actorId: userId,
          productId: gudangProductId,
          to: gudang.warehouseId,
          quantity: 999,
        }),
      "hanya 60",
    ],
    [
      "lokasi asal sama dengan tujuan",
      () =>
        client.mutation(api.inventory.transfer, {
          tenantId,
          storeId,
          actorId: userId,
          productId: gudangProductId,
          from: gudang.warehouseId,
          to: gudang.warehouseId,
          quantity: 1,
        }),
      "tidak boleh sama",
    ],
    [
      "jumlah pecahan",
      () =>
        client.mutation(api.inventory.transfer, {
          tenantId,
          storeId,
          actorId: userId,
          productId: gudangProductId,
          to: gudang.warehouseId,
          quantity: 1.5,
        }),
      "bilangan bulat",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `perpindahan ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — aturan pindah stok bocor",
    );
  }

  // Perpindahan antar gudang, bukan hanya gudang ↔ lokasi jual.
  const antarGudang = await client.mutation(api.inventory.transfer, {
    tenantId,
    storeId,
    actorId: userId,
    productId: gudangProductId,
    from: gudang.warehouseId,
    to: gudangKedua.warehouseId,
    quantity: 10,
  });
  check(
    "perpindahan antar gudang bernomor lanjut (TRF-00002)",
    antarGudang.number === "TRF-00002",
    antarGudang.number,
  );

  // Gudang yang masih menyimpan stok tidak boleh dimatikan — kalau tidak,
  // stoknya hilang dari pandangan padahal fisiknya masih di rak.
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.inventory.update, {
        tenantId,
        actorId: userId,
        warehouseId: gudang.warehouseId,
        active: false,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "gudang yang masih berisi stok tidak bisa dinonaktifkan",
      blocked && message.includes("masih menyimpan 30 unit"),
      message || "DITERIMA — stok bisa disembunyikan",
    );
  }

  // Kasir: menjual dari lokasi jual, bukan dari gudang. Stok gudang penuh pun
  // tidak membuat penjualan bisa melebihi stok yang benar-benar bisa dijual.
  // Pindahkan seluruh sisa stok yang bisa dijual ke gudang, lalu coba menjual.
  await client.mutation(api.inventory.transfer, {
    tenantId,
    storeId,
    actorId: userId,
    productId: gudangProductId,
    to: gudang.warehouseId,
    quantity: 60,
  });

  const kosongDiJual = await client.query(api.inventory.list, {
    tenantId,
    storeId,
    actorId: userId,
  });
  const kosong = kosongDiJual.stock.find((row) => row.productId === gudangProductId);
  check(
    "semua stok bisa dipindahkan ke gudang (total tidak hilang)",
    kosong.sellable === 0 && kosong.total === 100,
    JSON.stringify(kosong),
  );

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.pos.createSale, {
        tenantId,
        storeId,
        cashierId,
        items: [{ productId: gudangProductId, quantity: 1 }],
        payments: [{ method: "cash", amount: 11_100 }],
        idempotencyKey: `gudang-jual-${runId}`,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "stok di gudang tidak bisa dijual sebelum dipindahkan",
      blocked && message.includes("Stok tidak cukup"),
      message || "DITERIMA — kasir bisa menjual barang yang masih di gudang",
    );
  }

  await client.mutation(api.inventory.transfer, {
    tenantId,
    storeId,
    actorId: userId,
    productId: gudangProductId,
    from: gudang.warehouseId,
    to: undefined,
    quantity: 5,
  });
  const gudangSale = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    cashierId,
    items: [{ productId: gudangProductId, quantity: 1 }],
    payments: [{ method: "cash", amount: 11_100 }],
    idempotencyKey: `gudang-jual-ok-${runId}`,
  });
  check(
    "setelah dipindahkan ke lokasi jual, produk bisa dijual (11.100)",
    gudangSale.total === 11_100,
    JSON.stringify(gudangSale),
  );

  // Kasir tidak bekerja dengan gudang: tidak melihat stok per lokasi, dan
  // tidak bisa memindahkan stok. Staf gudang sebaliknya.
  for (const [label, attempt] of [
    [
      "melihat stok per lokasi",
      () =>
        client.query(api.inventory.list, {
          tenantId,
          storeId,
          actorId: cashierId,
        }),
    ],
    [
      "memindahkan stok",
      () =>
        client.mutation(api.inventory.transfer, {
          tenantId,
          storeId,
          actorId: cashierId,
          productId: gudangProductId,
          to: gudang.warehouseId,
          quantity: 1,
        }),
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `kasir ditolak: ${label}`,
      blocked && message.includes("tidak memiliki izin"),
      message || "DITERIMA — izin gudang bocor",
    );
  }

  // Gudang kosong boleh dinonaktifkan, dan dinonaktifkan tidak bisa dipakai
  // sebagai tujuan perpindahan sampai diaktifkan lagi.
  const dikosongkan = await client.mutation(api.inventory.transfer, {
    tenantId,
    storeId,
    actorId: userId,
    productId: gudangProductId,
    from: gudang.warehouseId,
    to: undefined,
    quantity: 85,
  });
  check(
    "sisa stok gudang bisa dipindahkan seluruhnya",
    dikosongkan.quantity === 85,
    JSON.stringify(dikosongkan),
  );

  const nonaktif = await client.mutation(api.inventory.update, {
    tenantId,
    actorId: userId,
    warehouseId: gudang.warehouseId,
    active: false,
  });
  check(
    "gudang kosong boleh dinonaktifkan",
    nonaktif.active === false,
    JSON.stringify(nonaktif),
  );

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.inventory.transfer, {
        tenantId,
        storeId,
        actorId: userId,
        productId: gudangProductId,
        to: gudang.warehouseId,
        quantity: 1,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "gudang nonaktif tidak bisa menjadi tujuan",
      blocked && message.includes("nonaktif"),
      message || "DITERIMA — gudang nonaktif masih dipakai",
    );
  }

  // --------------- Phase 3: pembelian PR · PO · GRN (`purchasing.basic`)
  // Alur penuh: staf gudang mengajukan PR, pemilik menyetujui dan memesan ke
  // supplier, lalu staf gudang menerima barangnya — penerimaan itulah yang
  // menggerakkan stok. Yang meminta bukan yang menyetujui.
  const stafGudangEmail = `gudang+${runId}@mesinpos.test`;
  const { userId: stafGudangId } = await client.mutation(api.members.add, {
    tenantId,
    actorId: userId,
    email: stafGudangEmail,
    name: "Staf Gudang Uji",
    role: "inventory",
  });

  const pembelianAwal = await client.query(api.purchasing.list, {
    tenantId,
    actorId: userId,
  });
  check(
    "pembelian dimulai kosong dengan ringkasan nol",
    pembelianAwal.suppliers.length === 0 &&
      pembelianAwal.requisitions.length === 0 &&
      pembelianAwal.orders.length === 0 &&
      pembelianAwal.receipts.length === 0 &&
      pembelianAwal.summary.openOrderValue === 0,
    JSON.stringify(pembelianAwal.summary),
  );

  const supplier = await client.mutation(api.purchasing.createSupplier, {
    tenantId,
    actorId: userId,
    name: "PT Sumber Rejeki",
    address: "Kawasan Industri Pulogadung",
  });
  check(
    "supplier dibuat dengan kode otomatis dari namanya",
    supplier.code === "PSR",
    JSON.stringify(supplier),
  );

  for (const [label, attempt, expected] of [
    [
      "kode supplier duplikat",
      () =>
        client.mutation(api.purchasing.createSupplier, {
          tenantId,
          actorId: userId,
          name: "PT Sumber Rejeki",
          code: "psr",
        }),
      "sudah dipakai",
    ],
    [
      "nama supplier terlalu pendek",
      () =>
        client.mutation(api.purchasing.createSupplier, {
          tenantId,
          actorId: userId,
          name: "A",
        }),
      "2–60 karakter",
    ],
    [
      "tempo pembayaran tidak wajar",
      () =>
        client.mutation(api.purchasing.createSupplier, {
          tenantId,
          actorId: userId,
          name: "Supplier Tempo Uji",
          paymentTermDays: 400,
        }),
      "0–365 hari",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `supplier ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — validasi supplier bocor",
    );
  }

  const pr = await client.mutation(api.purchasing.createRequisition, {
    tenantId,
    storeId,
    actorId: stafGudangId,
    lines: [{ productId: gudangProductId, quantity: 20, note: "rak depan" }],
  });
  check(
    "staf gudang mengajukan PR-00001",
    pr.number === "PR-00001",
    JSON.stringify(pr),
  );

  for (const [label, attempt] of [
    [
      "melihat dokumen pembelian",
      () => client.query(api.purchasing.list, { tenantId, actorId: cashierId }),
    ],
    [
      "mengajukan PR",
      () =>
        client.mutation(api.purchasing.createRequisition, {
          tenantId,
          storeId,
          actorId: cashierId,
          lines: [{ productId: gudangProductId, quantity: 1 }],
        }),
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `kasir ditolak: ${label}`,
      blocked && message.includes("tidak memiliki izin"),
      message || "DITERIMA — izin pembelian bocor",
    );
  }

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.purchasing.decideRequisition, {
        tenantId,
        actorId: stafGudangId,
        requisitionId: pr.requisitionId,
        approve: true,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "staf gudang boleh meminta tetapi tidak menyetujui PR",
      blocked && message.includes("tidak memiliki izin"),
      message || "DITERIMA — pemisahan tugas bocor",
    );
  }

  const disetujui = await client.mutation(api.purchasing.decideRequisition, {
    tenantId,
    actorId: userId,
    requisitionId: pr.requisitionId,
    approve: true,
    note: "Setuju, stok menipis",
  });
  check("pemilik menyetujui PR", disetujui.status === "approved", JSON.stringify(disetujui));

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.purchasing.decideRequisition, {
        tenantId,
        actorId: userId,
        requisitionId: pr.requisitionId,
        approve: false,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "PR yang sudah diputuskan tidak bisa diputuskan lagi",
      blocked && message.includes("sudah diputuskan"),
      message || "DITERIMA — keputusan bisa diubah-ubah",
    );
  }

  const prKedua = await client.mutation(api.purchasing.createRequisition, {
    tenantId,
    storeId,
    actorId: stafGudangId,
    lines: [{ productId: gudangProductId, quantity: 5 }],
  });
  check("PR berikutnya bernomor lanjut", prKedua.number === "PR-00002", prKedua.number);

  for (const [label, attempt, expected] of [
    [
      "PO dari PR yang belum disetujui",
      () =>
        client.mutation(api.purchasing.createOrder, {
          tenantId,
          storeId,
          actorId: userId,
          supplierId: supplier.supplierId,
          requisitionId: prKedua.requisitionId,
          lines: [{ productId: gudangProductId, quantity: 5, unitCost: 5_000 }],
        }),
      "belum bisa dijadikan PO",
    ],
    [
      "PO melebihi jumlah di PR",
      () =>
        client.mutation(api.purchasing.createOrder, {
          tenantId,
          storeId,
          actorId: userId,
          supplierId: supplier.supplierId,
          requisitionId: pr.requisitionId,
          lines: [{ productId: gudangProductId, quantity: 999, unitCost: 5_000 }],
        }),
      "tidak boleh melebihi",
    ],
    [
      "PO tanpa baris",
      () =>
        client.mutation(api.purchasing.createOrder, {
          tenantId,
          storeId,
          actorId: userId,
          supplierId: supplier.supplierId,
          requisitionId: pr.requisitionId,
          lines: [],
        }),
      "minimal satu baris",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `PO ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — aturan PO bocor",
    );
  }

  const order = await client.mutation(api.purchasing.createOrder, {
    tenantId,
    storeId,
    actorId: userId,
    supplierId: supplier.supplierId,
    requisitionId: pr.requisitionId,
    note: "Kirim pagi",
    lines: [{ productId: gudangProductId, quantity: 20, unitCost: 5_000 }],
  });
  check(
    "PO dibuat dari PR (nilai 100.000)",
    order.number === "PO-00001" && order.total === 100_000,
    JSON.stringify(order),
  );

  for (const [label, attempt] of [
    [
      "memesan PR yang sudah punya PO",
      () =>
        client.mutation(api.purchasing.createOrder, {
          tenantId,
          storeId,
          actorId: userId,
          supplierId: supplier.supplierId,
          requisitionId: pr.requisitionId,
          lines: [{ productId: gudangProductId, quantity: 20, unitCost: 5_000 }],
        }),
      "sudah punya PO",
    ],
    [
      "menerima barang (kasir)",
      () =>
        client.mutation(api.purchasing.receive, {
          tenantId,
          storeId,
          actorId: cashierId,
          orderId: order.orderId,
          lines: [{ productId: gudangProductId, quantity: 1 }],
        }),
      "tidak memiliki izin",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `PO ditolak: ${label}`,
      blocked && message.includes(label.startsWith("menerima") ? "tidak memiliki izin" : "sudah punya PO"),
      message || "DITERIMA — aturan PO bocor",
    );
  }

  const sebelumTerima = (
    await client.query(api.inventory.list, { tenantId, storeId, actorId: userId })
  ).stock.find((row) => row.productId === gudangProductId);
  const sebelumTerimaGudang =
    sebelumTerima?.levels.find((level) => level.warehouseId === gudangKedua.warehouseId)
      ?.quantity ?? 0;

  const grn = await client.mutation(api.purchasing.receive, {
    tenantId,
    storeId,
    actorId: stafGudangId,
    orderId: order.orderId,
    lines: [{ productId: gudangProductId, quantity: 8 }],
    note: "Surat jalan 1",
  });
  check(
    "GRN pertama 8 unit (40.000) dan PO jadi partial",
    grn.number === "GRN-00001" &&
      grn.total === 40_000 &&
      grn.status === "partial" &&
      grn.remaining === 12,
    JSON.stringify(grn),
  );

  const setelahTerima = (
    await client.query(api.inventory.list, { tenantId, storeId, actorId: userId })
  ).stock.find((row) => row.productId === gudangProductId);
  check(
    "penerimaan menambah stok lokasi jual sebanyak 8 unit",
    setelahTerima.sellable === sebelumTerima.sellable + 8 &&
      setelahTerima.total === sebelumTerima.total + 8,
    JSON.stringify({ sebelum: sebelumTerima.sellable, sesudah: setelahTerima.sellable }),
  );

  const produkSetelahTerima = (
    await client.query(api.products.listByStore, { tenantId, storeId, actorId: userId })
  ).find((product) => product._id === gudangProductId);
  check(
    "harga beli terakhir tersimpan di produk",
    produkSetelahTerima.cost === 5_000,
    String(produkSetelahTerima.cost),
  );

  const pembelianSetelah = await client.query(api.purchasing.list, {
    tenantId,
    actorId: userId,
  });
  const poSetelah = pembelianSetelah.orders.find((row) => row.id === order.orderId);
  check(
    "PO menyimpan progres penerimaan per baris",
    poSetelah.status === "partial" &&
      poSetelah.receivedValue === 40_000 &&
      poSetelah.lines[0].receivedQty === 8 &&
      poSetelah.lines[0].lineTotal === 100_000,
    JSON.stringify(poSetelah.lines),
  );
  check(
    "riwayat GRN terbaca beserta PO-nya",
    pembelianSetelah.receipts[0].number === "GRN-00001" &&
      pembelianSetelah.receipts[0].orderNumber === "PO-00001" &&
      pembelianSetelah.receipts[0].total === 40_000,
    JSON.stringify(pembelianSetelah.receipts[0]),
  );
  check(
    "ringkasan menghitung komitmen belanja yang belum datang",
    pembelianSetelah.summary.openOrderValue === 60_000 &&
      pembelianSetelah.summary.openOrderUnits === 12 &&
      pembelianSetelah.summary.receivedThisMonth === 40_000,
    JSON.stringify(pembelianSetelah.summary),
  );

  {
    // PO yang sebagian barangnya sudah masuk tidak boleh hilang dari catatan.
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.purchasing.cancelOrder, {
        tenantId,
        actorId: userId,
        orderId: order.orderId,
        reason: "Salah supplier",
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "PO yang sebagian sudah diterima tidak boleh dibatalkan",
      blocked && message.includes("Sudah ada barang diterima"),
      message || "DITERIMA — stok yang sudah masuk bisa dihapus dari catatan",
    );
  }

  for (const [label, attempt, expected] of [
    [
      "melebihi sisa PO",
      () =>
        client.mutation(api.purchasing.receive, {
          tenantId,
          storeId,
          actorId: stafGudangId,
          orderId: order.orderId,
          lines: [{ productId: gudangProductId, quantity: 13 }],
        }),
      "hanya tersisa 12",
    ],
    [
      "jumlah nol",
      () =>
        client.mutation(api.purchasing.receive, {
          tenantId,
          storeId,
          actorId: stafGudangId,
          orderId: order.orderId,
          lines: [{ productId: gudangProductId, quantity: 0 }],
        }),
      "lebih dari 0",
    ],
    [
      "barang yang bukan bagian PO",
      () =>
        client.mutation(api.purchasing.receive, {
          tenantId,
          storeId,
          actorId: stafGudangId,
          orderId: order.orderId,
          lines: [{ productId: rotiId, quantity: 1 }],
        }),
      "bukan bagian dari PO",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `penerimaan ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — aturan penerimaan bocor",
    );
  }

  const grnGudang = await client.mutation(api.purchasing.receive, {
    tenantId,
    storeId,
    actorId: stafGudangId,
    orderId: order.orderId,
    warehouseId: gudangKedua.warehouseId,
    lines: [{ productId: gudangProductId, quantity: 12 }],
  });
  check(
    "penerimaan sisa ke gudang menutup PO",
    grnGudang.number === "GRN-00002" &&
      grnGudang.status === "received" &&
      grnGudang.locationName.includes("Gudang Cabang"),
    JSON.stringify(grnGudang),
  );

  const levelSetelahGudang = (
    await client.query(api.inventory.list, { tenantId, storeId, actorId: userId })
  ).stock.find((row) => row.productId === gudangProductId);
  check(
    "stok masuk ke gudang tujuan, bukan ke lokasi jual",
    levelSetelahGudang.levels.find(
      (level) => level.warehouseId === gudangKedua.warehouseId,
    )?.quantity === sebelumTerimaGudang + 12 &&
      levelSetelahGudang.sellable === setelahTerima.sellable,
    JSON.stringify({ gudang: levelSetelahGudang.levels, jual: levelSetelahGudang.sellable }),
  );

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.purchasing.receive, {
        tenantId,
        storeId,
        actorId: stafGudangId,
        orderId: order.orderId,
        lines: [{ productId: gudangProductId, quantity: 1 }],
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "PO yang sudah selesai tidak menerima barang lagi",
      blocked && message.includes("sudah diterima lengkap"),
      message || "DITERIMA — PO bisa dilebihkan",
    );
  }

  // PR berikutnya: PO dibatalkan selagi kosong, lalu bisa dipesan ulang.
  await client.mutation(api.purchasing.decideRequisition, {
    tenantId,
    actorId: userId,
    requisitionId: prKedua.requisitionId,
    approve: true,
  });
  const poKedua = await client.mutation(api.purchasing.createOrder, {
    tenantId,
    storeId,
    actorId: userId,
    supplierId: supplier.supplierId,
    requisitionId: prKedua.requisitionId,
    lines: [{ productId: gudangProductId, quantity: 5, unitCost: 4_500 }],
  });
  check("PO kedua bernomor lanjut", poKedua.number === "PO-00002", poKedua.number);

  const dibatalkan = await client.mutation(api.purchasing.cancelOrder, {
    tenantId,
    actorId: userId,
    orderId: poKedua.orderId,
    reason: "Supplier tidak bisa kirim",
  });
  check("PO kosong boleh dibatalkan", dibatalkan.status === "cancelled", JSON.stringify(dibatalkan));

  const poPengganti = await client.mutation(api.purchasing.createOrder, {
    tenantId,
    storeId,
    actorId: userId,
    supplierId: supplier.supplierId,
    requisitionId: prKedua.requisitionId,
    lines: [{ productId: gudangProductId, quantity: 5, unitCost: 4_500 }],
  });
  check(
    "PO yang dibatalkan tidak menghalangi PR dipesan ulang (PO-00003)",
    poPengganti.number === "PO-00003",
    poPengganti.number,
  );

  // Turun paket: PR/PO baru berhenti, tetapi barang yang sudah dipesan tetap
  // harus bisa diterima — kalau tidak, pesanan menggantung selamanya.
  await client.mutation(api.billing.changePlan, {
    tenantId,
    newPlanKey: "professional",
    actorId: userId,
  });

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.purchasing.createRequisition, {
        tenantId,
        storeId,
        actorId: stafGudangId,
        lines: [{ productId: gudangProductId, quantity: 1 }],
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "PR baru ditolak saat paket tidak memuat purchasing.basic",
      blocked && message.includes("tidak termasuk paket"),
      message || "DITERIMA — gerbang fitur pembelian bocor",
    );
  }

  const grnTanpaFitur = await client.mutation(api.purchasing.receive, {
    tenantId,
    storeId,
    actorId: stafGudangId,
    orderId: poPengganti.orderId,
    lines: [{ productId: gudangProductId, quantity: 5 }],
  });
  check(
    "penerimaan barang tetap boleh tanpa fitur pembelian",
    grnTanpaFitur.number === "GRN-00003" && grnTanpaFitur.status === "received",
    JSON.stringify(grnTanpaFitur),
  );

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.purchasing.cancelOrder, {
        tenantId,
        actorId: userId,
        orderId: poPengganti.orderId,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "PO yang sudah selesai tidak boleh dibatalkan",
      blocked && message.includes("sudah selesai tidak bisa dibatalkan"),
      message || "DITERIMA — PO berisi stok bisa dibatalkan",
    );
  }

  const pembelianAkhir = await client.query(api.purchasing.list, {
    tenantId,
    actorId: userId,
  });
  check(
    "dokumen pembelian tetap terbaca tanpa fiturnya",
    pembelianAkhir.orders.length === 3 &&
      pembelianAkhir.receipts.length === 3 &&
      pembelianAkhir.summary.openOrderValue === 0,
    JSON.stringify(pembelianAkhir.summary),
  );

  // ------------------- Phase 3: hutang usaha (AP) --------------------------
  // Tempo supplier bekerja penuh di sini: setiap GRN dari supplier bertempo
  // menghasilkan hutang berjatuh tempo sendiri, dan supplier yang menunggak
  // tidak dilayani PO baru sampai tagihannya dibayar.
  const DAY = 24 * 60 * 60 * 1000;

  const hutangAwal = await client.query(api.payables.list, { tenantId, actorId: userId });
  check(
    "setiap penerimaan dari supplier bertempo jadi satu hutang",
    hutangAwal.payables.length === 3 &&
      hutangAwal.payables.every((row) => row.paymentTermDays === 30) &&
      hutangAwal.payables.every((row) => row.status === "open"),
    JSON.stringify(hutangAwal.payables.map((row) => [row.number, row.amount])),
  );
  check(
    "nilai hutang = nilai barang yang diterima (122.500 dari 3 GRN)",
    hutangAwal.summary.outstanding === 122_500 && hutangAwal.summary.openCount === 3,
    JSON.stringify(hutangAwal.summary),
  );
  check(
    "jatuh tempo hutang = 30 hari sejak penerimaan",
    hutangAwal.payables.every(
      (row) => Math.round((row.dueDate - row.createdAt) / DAY) === 30,
    ),
    JSON.stringify(hutangAwal.payables.map((row) => row.dueDate - row.createdAt)),
  );
  check(
    "hutang menautkan PO dan GRN sumbernya",
    hutangAwal.payables[0].orderNumber === "PO-00001" &&
      Boolean(hutangAwal.payables[0].receiptNumber) &&
      hutangAwal.payables[0].source.startsWith("PO PO-00001"),
    JSON.stringify(hutangAwal.payables[0]),
  );
  check(
    "posisi hutang muncul di daftar supplier (pemilik)",
    pembelianAkhir.suppliers.find((row) => row.id === supplier.supplierId)?.outstanding ===
      122_500,
    JSON.stringify(pembelianAkhir.suppliers),
  );

  const pembelianStaf = await client.query(api.purchasing.list, {
    tenantId,
    actorId: stafGudangId,
  });
  check(
    "staf gudang melihat supplier tanpa angka hutangnya",
    pembelianStaf.suppliers.every((row) => row.outstanding === 0),
    JSON.stringify(pembelianStaf.suppliers),
  );

  for (const [label, attempt] of [
    [
      "melihat hutang usaha",
      () => client.query(api.payables.list, { tenantId, actorId: stafGudangId }),
    ],
    [
      "membayar hutang supplier",
      () =>
        client.mutation(api.payables.recordPayment, {
          tenantId,
          actorId: stafGudangId,
          payableId: hutangAwal.payables[0].id,
          amount: 1_000,
          method: "transfer",
        }),
    ],
    [
      "menyimpan tagihan manual",
      () =>
        client.mutation(api.payables.createBill, {
          tenantId,
          storeId,
          actorId: cashierId,
          supplierId: supplier.supplierId,
          amount: 1_000,
          dueDate: Date.now(),
        }),
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `kasir/staf gudang ditolak: ${label}`,
      blocked && message.includes("tidak memiliki izin"),
      message || "DITERIMA — izin hutang usaha bocor",
    );
  }

  const hutangPertama = hutangAwal.payables.find((row) => row.amount === 40_000) ?? hutangAwal.payables[0];
  const bayarSebagian = await client.mutation(api.payables.recordPayment, {
    tenantId,
    actorId: userId,
    payableId: hutangPertama.id,
    amount: 15_000,
    method: "transfer",
    note: "Cicilan pertama",
  });
  check(
    "pembayaran sebagian mengurangi sisa hutang",
    bayarSebagian.remaining === hutangPertama.amount - 15_000 && !bayarSebagian.fullyPaid,
    JSON.stringify(bayarSebagian),
  );

  for (const [label, amount, expected] of [
    ["melebihi sisa hutang", 999_999, "melebihi sisa hutang"],
    ["jumlah nol", 0, "lebih dari 0"],
    ["jumlah negatif", -5_000, "lebih dari 0"],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.payables.recordPayment, {
        tenantId,
        actorId: userId,
        payableId: hutangPertama.id,
        amount,
        method: "cash",
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `pembayaran hutang ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — aturan pembayaran bocor",
    );
  }

  const sisaHutang = hutangPertama.amount - 15_000;
  const lunasHutang = await client.mutation(api.payables.recordPayment, {
    tenantId,
    actorId: userId,
    payableId: hutangPertama.id,
    amount: sisaHutang,
    method: "transfer",
  });
  check(
    "pembayaran terakhir menandai hutang lunas",
    lunasHutang.fullyPaid && lunasHutang.remaining === 0,
    JSON.stringify(lunasHutang),
  );

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.payables.recordPayment, {
        tenantId,
        actorId: userId,
        payableId: hutangPertama.id,
        amount: 1_000,
        method: "cash",
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "hutang yang sudah lunas tidak bisa dibayar lagi",
      blocked && message.includes("sudah lunas"),
      message || "DITERIMA — hutang bisa dibayar dua kali",
    );
  }

  // Tagihan manual: komitmen baru, jadi butuh fitur `purchasing.basic` — dan
  // tenant masih di paket Professional pada titik ini.
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.payables.createBill, {
        tenantId,
        storeId,
        actorId: userId,
        supplierId: supplier.supplierId,
        amount: 300_000,
        dueDate: Date.now() - 40 * DAY,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "tagihan manual ditolak saat paket tidak memuat purchasing.basic",
      blocked && message.includes("tidak termasuk paket"),
      message || "DITERIMA — gerbang fitur tagihan bocor",
    );
  }

  await client.mutation(api.billing.changePlan, {
    tenantId,
    newPlanKey: "enterprise",
    actorId: userId,
  });

  const tagihanLama = await client.mutation(api.payables.createBill, {
    tenantId,
    storeId,
    actorId: userId,
    supplierId: supplier.supplierId,
    reference: "INV/LAMA/2026/77",
    amount: 300_000,
    dueDate: Date.now() - 40 * DAY,
    note: "Tagihan jasa angkut dari sistem lama",
  });
  check(
    "tagihan lama dicatat dengan nomor lanjut dan jatuh tempo di masa lalu",
    tagihanLama.number === "AP-00004" && tagihanLama.dueDate < Date.now(),
    JSON.stringify(tagihanLama),
  );

  const hutangMenunggak = await client.query(api.payables.list, {
    tenantId,
    actorId: userId,
  });
  check(
    "tagihan yang sudah lewat jatuh tempo terhitung sebagai tunggakan",
    hutangMenunggak.summary.overdueAmount === 300_000 &&
      hutangMenunggak.summary.overdueCount === 1 &&
      hutangMenunggak.payables.find((row) => row.number === "AP-00004")?.overdue === true,
    JSON.stringify(hutangMenunggak.summary),
  );

  // Pemicu berbasis kalender (`payable.due`) tidak bisa dipicu transaksi:
  // keadaannya berubah karena waktu. Pembuktian yang jujur adalah menjalankan
  // pekerja hariannya **apa adanya** — dipanggil lewat CLI ke fungsi yang
  // benar-benar ter-deploy, bukan tiruan aturannya. Penerima webhook dibuat lebih
  // dulu supaya setiap kiriman `payable.due` di bawah pasti datang dari langganan
  // yang baru ini.
  const penerimaJatuhTempo = await client.mutation(api.apiAccess.createEndpoint, {
    tenantId,
    actorId: userId,
    url: "https://tidak-ada.mesinpos.invalid/jatuh-tempo",
    description: "Penerima pengingat jatuh tempo",
    events: ["payable.due"],
  });
  const sebelumPekerja = await client.query(api.apiAccess.overview, {
    tenantId,
    actorId: userId,
  });
  check(
    "belum ada kiriman payable.due sebelum pekerja harian dijalankan",
    sebelumPekerja.deliveries.filter((row) => row.event === "payable.due").length === 0,
    JSON.stringify(sebelumPekerja.deliveries.map((row) => row.event)),
  );

  const jalankanPekerjaJatuhTempo = () =>
    spawnSync(
      "bun",
      ["convex", "run", "payables:notifyDuePayables", JSON.stringify({ limit: 50 })],
      { encoding: "utf8", timeout: 120_000 },
    );

  const putaranPertama = jalankanPekerjaJatuhTempo();
  const setelahPekerja = await client.query(api.apiAccess.overview, {
    tenantId,
    actorId: userId,
  });
  const kirimanJatuhTempo = setelahPekerja.deliveries.filter((row) => row.event === "payable.due");
  check(
    "pekerja harian menulis kiriman payable.due untuk tagihan yang sudah jatuh tempo",
    kirimanJatuhTempo.length >= 1 &&
      kirimanJatuhTempo.every((row) => row.endpointId === penerimaJatuhTempo.endpointId),
    `${putaranPertama.stdout ?? ""}${putaranPertama.stderr ?? ""}`.trim() ||
      JSON.stringify(setelahPekerja.deliveries.map((row) => row.event)),
  );

  // Putaran kedua tidak boleh menambah kiriman: penanda `dueNotified` yang
  // dipasang putaran pertama membuat tagihan yang sama tidak dikabarkan lagi.
  const putaranKedua = jalankanPekerjaJatuhTempo();
  const setelahPutaranKedua = await client.query(api.apiAccess.overview, {
    tenantId,
    actorId: userId,
  });
  const kirimanKedua = setelahPutaranKedua.deliveries.filter((row) => row.event === "payable.due");
  check(
    "pekerja tidak mengabarkan tagihan yang sama dua kali (penanda dueNotified)",
    kirimanKedua.length === kirimanJatuhTempo.length,
    `${kirimanJatuhTempo.length} → ${kirimanKedua.length}${
      (putaranKedua.stderr ?? "").trim() ? `; ${(putaranKedua.stderr ?? "").trim()}` : ""
    }`,
  );

  const penerimaJatuhTempoDibersihkan = await client.mutation(api.apiAccess.removeEndpoint, {
    tenantId,
    actorId: userId,
    endpointId: penerimaJatuhTempo.endpointId,
  });
  check(
    "penerima pengingat jatuh tempo dibersihkan setelah uji",
    penerimaJatuhTempoDibersihkan.removedDeliveries === kirimanJatuhTempo.length,
    String(penerimaJatuhTempoDibersihkan.removedDeliveries),
  );

  // Supplier menunggak → PO baru ditolak. Jalan keluarnya: bayar.
  const prHutang = await client.mutation(api.purchasing.createRequisition, {
    tenantId,
    storeId,
    actorId: stafGudangId,
    lines: [{ productId: gudangProductId, quantity: 5 }],
  });
  await client.mutation(api.purchasing.decideRequisition, {
    tenantId,
    actorId: userId,
    requisitionId: prHutang.requisitionId,
    approve: true,
  });

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.purchasing.createOrder, {
        tenantId,
        storeId,
        actorId: userId,
        supplierId: supplier.supplierId,
        requisitionId: prHutang.requisitionId,
        lines: [{ productId: gudangProductId, quantity: 5, unitCost: 4_500 }],
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "PO ke supplier yang menunggak ditolak dengan jumlah hutangnya",
      blocked && message.includes("punya hutang jatuh tempo") && message.includes("300.000"),
      message || "DITERIMA — supplier menunggak tetap dilayani",
    );
  }

  await client.mutation(api.payables.recordPayment, {
    tenantId,
    actorId: userId,
    payableId: tagihanLama.payableId,
    amount: 300_000,
    method: "transfer",
  });

  const poSetelahLunas = await client.mutation(api.purchasing.createOrder, {
    tenantId,
    storeId,
    actorId: userId,
    supplierId: supplier.supplierId,
    requisitionId: prHutang.requisitionId,
    lines: [{ productId: gudangProductId, quantity: 5, unitCost: 4_500 }],
  });
  check(
    "setelah tagihannya dibayar, PO ke supplier itu boleh lagi (PO-00004)",
    poSetelahLunas.number === "PO-00004",
    poSetelahLunas.number,
  );

  // Tempo 0 = bayar langsung: penerimaan berikutnya tidak menghasilkan hutang.
  await client.mutation(api.purchasing.updateSupplier, {
    tenantId,
    actorId: userId,
    supplierId: supplier.supplierId,
    paymentTermDays: 0,
  });
  const grnTanpaTempo = await client.mutation(api.purchasing.receive, {
    tenantId,
    storeId,
    actorId: stafGudangId,
    orderId: poSetelahLunas.orderId,
    lines: [{ productId: gudangProductId, quantity: 5 }],
  });
  const hutanAkhir = await client.query(api.payables.list, { tenantId, actorId: userId });
  check(
    "supplier tanpa tempo: penerimaan berikutnya tidak menagih hutang baru",
    grnTanpaTempo.number === "GRN-00004" && hutanAkhir.payables.length === 4,
    JSON.stringify({ grn: grnTanpaTempo.number, jumlah: hutanAkhir.payables.length }),
  );
  check(
    "tagihan lama tetap memakai tempo & jatuh tempo saat lahir",
    hutanAkhir.payables.find((row) => row.number === "AP-00001")?.paymentTermDays === 30 &&
      hutanAkhir.payables.find((row) => row.number === "AP-00004")?.paymentTermDays === 0,
    JSON.stringify(
      hutanAkhir.payables.map((row) => [row.number, row.paymentTermDays]),
    ),
  );
  const posisiAkhir = (
    await client.query(api.purchasing.list, { tenantId, actorId: userId })
  ).suppliers.find((row) => row.id === supplier.supplierId);
  check(
    "posisi hutang supplier mengikuti tagihan yang tersisa (82.500)",
    posisiAkhir?.outstanding === 82_500 &&
      posisiAkhir?.overdueAmount === 0 &&
      posisiAkhir?.openCount === 2,
    JSON.stringify({ posisi: posisiAkhir, summary: hutanAkhir.summary }),
  );

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.purchasing.updateSupplier, {
        tenantId,
        actorId: stafGudangId,
        supplierId: supplier.supplierId,
        paymentTermDays: 90,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "staf gudang tidak bisa mengubah tempo supplier",
      blocked && message.includes("tidak memiliki izin"),
      message || "DITERIMA — tempo supplier bisa diubah siapa saja",
    );
  }

  const supplierDiubah = await client.mutation(api.purchasing.updateSupplier, {
    tenantId,
    actorId: userId,
    supplierId: supplier.supplierId,
    phone: "+62215559000",
    paymentTermDays: 400,
  }).catch((error) => ({ error: error?.message ?? String(error) }));
  check(
    "tempo supplier di luar batas ditolak saat diubah",
    Boolean(supplierDiubah.error) && supplierDiubah.error.includes("0–365 hari"),
    JSON.stringify(supplierDiubah),
  );

  const pembayaranHutang = hutanAkhir.payments;
  check(
    "riwayat pembayaran hutang menyimpan tagihan, supplier, dan nilainya",
    pembayaranHutang.length === 3 &&
      pembayaranHutang.every((row) => row.amount > 0 && row.payableNumber.startsWith("AP-")) &&
      pembayaranHutang.some((row) => row.note === "Cicilan pertama"),
    JSON.stringify(pembayaranHutang.map((row) => [row.payableNumber, row.amount])),
  );

  // -------- Phase 3: pencocokan 3 arah & bayar sekaligus (`purchasing.threeway`)
  // Yang diuji di sini bukan "angkanya benar", tetapi **penjagaan uangnya**:
  // nilai yang ditagih supplier dibandingkan dengan yang dipesan (PO) & diterima
  // (GRN), selisihnya harus diputuskan manusia, dan tagihan bersengketa tidak
  // bisa dibayar — satu per satu maupun sekaligus.
  const tigaArahAwal = await client.query(api.payables.list, { tenantId, actorId: userId });
  const tagihanCocok = tigaArahAwal.payables.find((row) => row.number === "AP-00002");
  const tagihanSelisih = tigaArahAwal.payables.find((row) => row.number === "AP-00003");
  check(
    "prasyarat 3 arah: dua tagihan terbuka dari penerimaan barang (60.000 & 22.500)",
    tagihanCocok?.balance === 60_000 && tagihanSelisih?.balance === 22_500,
    JSON.stringify(tigaArahAwal.payables.map((row) => [row.number, row.balance])),
  );
  check(
    "hutang tanpa dokumen supplier berstatus `waiting_invoice` dengan nilai dari penerimaan",
    tagihanCocok.match.status === "waiting_invoice" &&
      tagihanCocok.match.receivedValue === 60_000 &&
      tagihanCocok.match.billedValue === undefined &&
      tagihanCocok.match.reasons[0].includes("belum dicatat"),
    JSON.stringify(tagihanCocok.match.reasons),
  );
  check(
    "ringkasan 3 arah: 2 tagihan menunggu dokumen, belum ada yang cocok",
    tigaArahAwal.matchSummary.waitingInvoice === 2 &&
      tigaArahAwal.matchSummary.needsReview === 0 &&
      tigaArahAwal.matchSummary.matched === 0,
    JSON.stringify(tigaArahAwal.matchSummary),
  );

  const barisDokumen = (row, extraQty = 0) =>
    row.match.lines
      .filter((line) => line.receivedQty > 0)
      .map((line) => ({
        productId: line.productId,
        quantity: line.receivedQty + extraQty,
        unitCost: line.receivedUnitCost,
      }));

  const dokumenCocok = await client.mutation(api.payables.recordInvoice, {
    tenantId,
    actorId: userId,
    payableId: tagihanCocok.id,
    reference: "INV/PSR/2026/0912",
    lines: barisDokumen(tagihanCocok),
  });
  check(
    "dokumen supplier yang sama dengan penerimaan: total dihitung dari barisnya, tanpa selisih",
    dokumenCocok.total === 60_000 &&
      dokumenCocok.receivedValue === 60_000 &&
      dokumenCocok.flagged === false &&
      dokumenCocok.variance === 0,
    JSON.stringify(dokumenCocok),
  );
  check(
    "alasan pencocokan menyebut nilai barang diterima, bukan cuma \"ok\"",
    dokumenCocok.reasons.length === 1 && dokumenCocok.reasons[0].includes("Cocok") &&
      dokumenCocok.reasons[0].includes("60.000"),
    JSON.stringify(dokumenCocok.reasons),
  );

  const setelahDokumen = await client.query(api.payables.list, { tenantId, actorId: userId });
  const tagihanCocokTersimpan = setelahDokumen.payables.find((row) => row.id === tagihanCocok.id);
  check(
    "status jadi `matched` dan dokumen supplier tersimpan lengkap",
    tagihanCocokTersimpan.match.status === "matched" &&
      tagihanCocokTersimpan.invoice.reference === "INV/PSR/2026/0912" &&
      tagihanCocokTersimpan.invoice.total === 60_000 &&
      tagihanCocokTersimpan.invoice.lines.length === 1,
    JSON.stringify(tagihanCocokTersimpan.invoice),
  );
  check(
    "ringkasan 3 arah ikut segar setelah dokumennya dicatat (1 cocok, 1 menunggu)",
    setelahDokumen.matchSummary.matched === 1 &&
      setelahDokumen.matchSummary.waitingInvoice === 1,
    JSON.stringify(setelahDokumen.matchSummary),
  );

  for (const [label, attempt, expected] of [
    [
      "mencatat dokumen supplier dua kali",
      () =>
        client.mutation(api.payables.recordInvoice, {
          tenantId,
          actorId: userId,
          payableId: tagihanCocok.id,
          lines: barisDokumen(tagihanCocok),
        }),
      "sudah dicatat",
    ],
    [
      "menerima selisih pada tagihan yang tidak berselisih",
      () =>
        client.mutation(api.payables.resolveMatch, {
          tenantId,
          actorId: userId,
          payableId: tagihanCocok.id,
          kind: "accepted",
        }),
      "tidak punya selisih",
    ],
    [
      "baris dokumen yang bukan bagian PO/penerimaan",
      () =>
        client.mutation(api.payables.recordInvoice, {
          tenantId,
          actorId: userId,
          payableId: tagihanSelisih.id,
          lines: [{ productId: kopiId, quantity: 1, unitCost: 1_000 }],
        }),
      "bukan bagian dari PO/penerimaan",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `pencocokan 3 arah ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — penjagaan 3 arah bocor",
    );
  }

  const dokumenSelisih = await client.mutation(api.payables.recordInvoice, {
    tenantId,
    actorId: userId,
    payableId: tagihanSelisih.id,
    reference: "INV/PSR/2026/0913",
    lines: barisDokumen(tagihanSelisih, 2),
  });
  check(
    "ditagih 2 unit lebih banyak: total 31.500, selisih 9.000, dan ditandai",
    dokumenSelisih.total === 31_500 &&
      dokumenSelisih.variance === 9_000 &&
      dokumenSelisih.flagged === true,
    JSON.stringify(dokumenSelisih),
  );
  check(
    "selisih kuantitas dijelaskan dengan angka ditagih & diterima",
    dokumenSelisih.reasons.some(
      (reason) => reason.includes("ditagih 7 unit") && reason.includes("diterima 5 unit"),
    ),
    JSON.stringify(dokumenSelisih.reasons),
  );

  const sengketa = await client.mutation(api.payables.resolveMatch, {
    tenantId,
    actorId: userId,
    payableId: tagihanSelisih.id,
    kind: "disputed",
    note: "Jumlah kurang 2 unit",
  });
  check(
    "menyengketakan selisih TIDAK mengubah nilai hutang (22.500)",
    sengketa.kind === "disputed" && sengketa.amount === 22_500 && sengketa.amountBefore === 22_500,
    JSON.stringify(sengketa),
  );

  const sebelumSengketa = await client.query(api.payables.list, { tenantId, actorId: userId });
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.payables.recordPayment, {
        tenantId,
        actorId: userId,
        payableId: tagihanSelisih.id,
        amount: 5_000,
        method: "transfer",
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "tagihan bersengketa ditolak dibayar (alasan sengketanya ikut dibawa)",
      blocked && message.includes("disengketakan") && message.includes("Jumlah kurang 2 unit"),
      message || "DITERIMA — sengketa tidak menahan uang",
    );
  }

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.payables.payBatch, {
        tenantId,
        actorId: userId,
        method: "transfer",
        payments: [
          { payableId: tagihanSelisih.id, amount: 22_500 },
          { payableId: tagihanCocok.id, amount: 60_000 },
        ],
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "satu tagihan bersengketa membatalkan SELURUH pembayaran sekaligus",
      blocked && message.includes("disengketakan"),
      message || "DITERIMA — batch melewati sengketa",
    );
  }

  const setelahSengketa = await client.query(api.payables.list, { tenantId, actorId: userId });
  check(
    "batch yang ditolak tidak menyisakan satu pun pembayaran",
    setelahSengketa.payments.length === sebelumSengketa.payments.length &&
      setelahSengketa.batches.length === sebelumSengketa.batches.length,
    JSON.stringify({
      sebelum: sebelumSengketa.payments.length,
      sesudah: setelahSengketa.payments.length,
    }),
  );
  check(
    "ringkasan 3 arah menghitung sengketa & nilai selisih yang belum selesai (9.000)",
    setelahSengketa.matchSummary.disputed === 1 &&
      setelahSengketa.matchSummary.needsReview === 1 &&
      setelahSengketa.matchSummary.openVarianceValue === 9_000,
    JSON.stringify(setelahSengketa.matchSummary),
  );

  const diterima = await client.mutation(api.payables.resolveMatch, {
    tenantId,
    actorId: userId,
    payableId: tagihanSelisih.id,
    kind: "accepted",
    note: "Jumlah & harga disetujui pemilik",
  });
  check(
    "menerima selisih menyesuaikan hutang ke total tagihan supplier (22.500 → 31.500)",
    diterima.kind === "accepted" &&
      diterima.amountBefore === 22_500 &&
      diterima.amount === 31_500,
    JSON.stringify(diterima),
  );
  check(
    "hutang yang sudah disesuaikan ikut terbaca di daftar tagihan",
    (await client.query(api.payables.list, { tenantId, actorId: userId })).payables.find(
      (row) => row.id === tagihanSelisih.id,
    )?.balance === 31_500,
    "sisa hutang tidak mengikuti total tagihan supplier",
  );

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.payables.resolveMatch, {
        tenantId,
        actorId: userId,
        payableId: tagihanSelisih.id,
        kind: "none",
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "menerima selisih tidak bisa dibatalkan diam-diam",
      blocked && message.includes("tidak bisa dibatalkan"),
      message || "DITERIMA — nilai hutang bisa dikembalikan tanpa jejak",
    );
  }

  const batch = await client.mutation(api.payables.payBatch, {
    tenantId,
    actorId: userId,
    method: "transfer",
    note: "Transfer bank 11 Okt",
    payments: [
      { payableId: tagihanSelisih.id, amount: 1_000 },
      { payableId: tagihanCocok.id, amount: 2_000 },
    ],
  });
  check(
    "bayar sekaligus: satu nomor PAY untuk beberapa tagihan (3.000)",
    batch.batchNumber === "PAY-00001" &&
      batch.total === 3_000 &&
      batch.bills.length === 2 &&
      batch.fullyPaidCount === 0,
    JSON.stringify(batch),
  );

  const setelahBatch = await client.query(api.payables.list, { tenantId, actorId: userId });
  const barisBatch = setelahBatch.payments.filter(
    (payment) => payment.batchNumber === "PAY-00001",
  );
  check(
    "setiap tagihan tetap punya baris pembayarannya sendiri dengan nomor batch yang sama",
    barisBatch.length === 2 &&
      barisBatch.every((payment) => payment.amount > 0 && payment.note === "Transfer bank 11 Okt"),
    JSON.stringify(barisBatch.map((payment) => [payment.payableNumber, payment.amount])),
  );
  check(
    "satu transfer bank terbaca sebagai satu batch berisi dua tagihan",
    setelahBatch.batches[0]?.number === "PAY-00001" &&
      setelahBatch.batches[0].count === 2 &&
      setelahBatch.batches[0].total === 3_000 &&
      setelahBatch.batches[0].bills.length === 2,
    JSON.stringify(setelahBatch.batches[0]),
  );
  check(
    "sisa hutang berkurang per tagihan (58.000 & 30.500)",
    setelahBatch.payables.find((row) => row.id === tagihanCocok.id)?.balance === 58_000 &&
      setelahBatch.payables.find((row) => row.id === tagihanSelisih.id)?.balance === 30_500,
    JSON.stringify(
      setelahBatch.payables.map((row) => [row.number, row.balance]),
    ),
  );
  check(
    "ringkasan 3 arah bersih: 1 cocok, 1 selisih diterima, tanpa sengketa tertinggal",
    setelahBatch.matchSummary.matched === 1 &&
      setelahBatch.matchSummary.accepted === 1 &&
      setelahBatch.matchSummary.disputed === 0 &&
      setelahBatch.matchSummary.waitingInvoice === 0 &&
      setelahBatch.matchSummary.needsReview === 0 &&
      setelahBatch.matchSummary.openVarianceValue === 0,
    JSON.stringify(setelahBatch.matchSummary),
  );

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.payables.payBatch, {
        tenantId,
        actorId: userId,
        method: "cash",
        payments: [{ payableId: tagihanCocok.id, amount: 999_999 }],
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "kelebihan bayar di batch ditolak dengan nomor tagihannya",
      blocked && message.includes("AP-00002") && message.includes("melebihi sisa hutang"),
      message || "DITERIMA — batch bisa kelebihan bayar",
    );
  }

  // Gerbang fitur tepat di tempat yang benar: **mencatat dokumen supplier** dan
  // **memutuskan selisih** berhenti saat paketnya turun, sedangkan membayar
  // hutang yang sudah tercatat tetap jalan — kalau tidak, tagihan supplier
  // menggantung hanya karena langganan berubah.
  await client.mutation(api.billing.changePlan, {
    tenantId,
    newPlanKey: "professional",
    actorId: userId,
  });
  for (const [label, attempt] of [
    [
      "mencatat dokumen supplier",
      () =>
        client.mutation(api.payables.recordInvoice, {
          tenantId,
          actorId: userId,
          payableId: tagihanSelisih.id,
          lines: barisDokumen(tagihanSelisih),
        }),
    ],
    [
      "mencabut keputusan selisih",
      () =>
        client.mutation(api.payables.resolveMatch, {
          tenantId,
          actorId: userId,
          payableId: tagihanSelisih.id,
          kind: "none",
        }),
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `ditolak tanpa fitur purchasing.threeway: ${label}`,
      blocked && message.includes("tidak termasuk paket"),
      message || "DITERIMA — gerbang fitur 3 arah bocor",
    );
  }
  const bayarTanpaFitur = await client.mutation(api.payables.recordPayment, {
    tenantId,
    actorId: userId,
    payableId: tagihanCocok.id,
    amount: 1_000,
    method: "cash",
  });
  check(
    "membayar hutang yang sudah tercatat tetap boleh walau paketnya turun",
    bayarTanpaFitur.remaining === 57_000 && bayarTanpaFitur.fullyPaid === false,
    JSON.stringify(bayarTanpaFitur),
  );
  await client.mutation(api.billing.changePlan, {
    tenantId,
    newPlanKey: "enterprise",
    actorId: userId,
  });

  // ------------------- Phase 3: stock opname (`inventory.opname`) ----------
  // Hitung fisik per lokasi. Yang diuji di sini bukan "angkanya benar", tetapi
  // **sumber kebenarannya**: hasil hitung mengalahkan catatan, penjualan di
  // tengah penghitungan tidak dihitung dua kali, dan baris yang belum dihitung
  // tidak pernah dianggap nol.
  const saldoJualAwal = (
    await client.query(api.inventory.list, { tenantId, storeId, actorId: userId })
  ).stock
    .find((row) => row.productId === gudangProductId)
    ?.levels.find((level) => level.warehouseId === "default")?.quantity ?? 0;
  check(
    "prasyarat opname: lokasi jual punya cukup stok untuk diuji",
    saldoJualAwal >= 10,
    `saldo lokasi jual ${saldoJualAwal}`,
  );

  const opnameKosong = await client.query(api.opname.list, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "opname dimulai kosong dengan ringkasan nol",
    opnameKosong.sessions.length === 0 &&
      opnameKosong.summary.openCount === 0 &&
      opnameKosong.summary.remainingLines === 0,
    JSON.stringify(opnameKosong.summary),
  );
  check(
    "lokasi jual selalu ada di daftar lokasi hitung",
    opnameKosong.locations[0].id === "default" && opnameKosong.locations.length >= 2,
    JSON.stringify(opnameKosong.locations.map((row) => row.id)),
  );

  {
    let blocked = false;
    let message = "";
    try {
      await client.query(api.opname.list, { tenantId, storeId, actorId: cashierId });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "kasir tidak memegang izin melihat sesi opname",
      blocked && message.includes("tidak memiliki izin"),
      message || "DITERIMA — izin opname bocor ke kasir",
    );
  }

  // Sesi pertama: hitung sebagian (cycle count) satu produk saja, supaya
  // ekspektasinya tepat dan aturan "hitung sebagian" ikut terbukti.
  const sesiOpname = await client.mutation(api.opname.start, {
    tenantId,
    storeId,
    actorId: userId,
    productIds: [gudangProductId],
    note: "Opname uji lokasi jual",
  });
  check(
    "sesi opname pertama dibuka di lokasi jual (OPN-00001, satu baris)",
    sesiOpname.number === "OPN-00001" &&
      sesiOpname.lineCount === 1 &&
      sesiOpname.locationName.startsWith("Lokasi jual"),
    JSON.stringify(sesiOpname),
  );

  for (const [label, attempt] of [
    [
      "memulai sesi opname",
      () => client.mutation(api.opname.start, { tenantId, storeId, actorId: cashierId }),
    ],
    [
      "menghitung baris opname",
      () =>
        client.mutation(api.opname.setCount, {
          tenantId,
          actorId: cashierId,
          sessionId: sesiOpname.sessionId,
          productId: gudangProductId,
          countedQty: 1,
        }),
    ],
    [
      "memposting sesi opname",
      () =>
        client.mutation(api.opname.post, {
          tenantId,
          actorId: cashierId,
          sessionId: sesiOpname.sessionId,
        }),
    ],
    [
      "membatalkan sesi opname",
      () =>
        client.mutation(api.opname.cancel, {
          tenantId,
          actorId: cashierId,
          sessionId: sesiOpname.sessionId,
        }),
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `kasir ditolak: ${label}`,
      blocked && message.includes("tidak memiliki izin"),
      message || "DITERIMA — izin opname bocor ke kasir",
    );
  }

  // Snapshot dibaca apa adanya: patokan selisih adalah saldo saat sesi dimulai,
  // dan baris yang belum dihitung memang belum punya hasil hitung.
  const opnameBerjalan = (
    await client.query(api.opname.list, { tenantId, storeId, actorId: userId })
  ).sessions[0];
  const barisOpname = opnameBerjalan.lines.find((line) => line.productId === gudangProductId);
  check(
    "baris sesi menyimpan snapshot saldo saat sesi dimulai",
    opnameBerjalan.number === "OPN-00001" &&
      opnameBerjalan.status === "draft" &&
      opnameBerjalan.note === "Opname uji lokasi jual" &&
      barisOpname.systemQty === saldoJualAwal &&
      barisOpname.countedQty === undefined,
    JSON.stringify({ baris: barisOpname, sesi: opnameBerjalan.number }),
  );
  check(
    "progres sesi dimulai dari nol dan hitung sebagian dihitung terpisah",
    opnameBerjalan.progress.total === 1 &&
      opnameBerjalan.progress.counted === 0 &&
      opnameBerjalan.progress.remaining === 1,
    JSON.stringify(opnameBerjalan.progress),
  );

  for (const [label, attempt, expected] of [
    [
      "membuka sesi kedua di lokasi yang sama",
      () =>
        client.mutation(api.opname.start, { tenantId, storeId, actorId: userId }),
      "OPN-00001",
    ],
    [
      "menghitung produk di luar sesi hitung sebagian",
      () =>
        client.mutation(api.opname.setCount, {
          tenantId,
          actorId: userId,
          sessionId: sesiOpname.sessionId,
          productId: rotiId,
          countedQty: 3,
        }),
      "bukan bagian dari sesi opname ini",
    ],
    [
      "menyimpan hasil hitung negatif",
      () =>
        client.mutation(api.opname.setCount, {
          tenantId,
          actorId: userId,
          sessionId: sesiOpname.sessionId,
          productId: gudangProductId,
          countedQty: -2,
        }),
      "tidak boleh negatif",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — aturan sesi opname bocor",
    );
  }

  // Penjualan di tengah penghitungan: rak sudah berkurang 2 unit sementara
  // snapshot sesi masih angka lama. Inilah yang membuat aturan "saldo terbaru"
  // penting — kalau posting memakai snapshot, 2 unit itu akan terhitung dua kali.
  const jualSaatOpname = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    cashierId,
    items: [{ productId: gudangProductId, quantity: 2 }],
    payments: [{ method: "cash", amount: 22_200 }],
    idempotencyKey: `opname-jual-${runId}`,
  });
  check(
    "kasir tetap bisa menjual selama sesi opname berjalan (22.200)",
    jualSaatOpname.total === 22_200,
    String(jualSaatOpname.total),
  );

  const hasilHitung = saldoJualAwal - 5;
  const tersimpan = await client.mutation(api.opname.setCount, {
    tenantId,
    actorId: stafGudangId,
    sessionId: sesiOpname.sessionId,
    productId: gudangProductId,
    countedQty: hasilHitung,
    note: "hasil hitung fisik",
  });
  check(
    "staf gudang menyimpan hasil hitung (fisik 5 unit kurang dari catatan)",
    tersimpan.countedQty === hasilHitung && tersimpan.progress.counted === 1,
    JSON.stringify(tersimpan),
  );

  const diposting = await client.mutation(api.opname.post, {
    tenantId,
    actorId: stafGudangId,
    sessionId: sesiOpname.sessionId,
  });
  check(
    "posting memakai saldo terbaru, bukan snapshot (delta −3, bukan −5)",
    diposting.movements.length === 1 &&
      diposting.movements[0].delta === -3 &&
      diposting.movements[0].currentQty === saldoJualAwal - 2 &&
      diposting.netUnits === -3,
    JSON.stringify(diposting.movements),
  );
  check(
    "selisih audit tetap dihitung dari snapshot (5 unit kurang)",
    diposting.variance.counted === 1 &&
      diposting.variance.uncounted === 0 &&
      diposting.variance.shortageUnits === 5 &&
      diposting.variance.netUnits === -5,
    JSON.stringify(diposting.variance),
  );

  const stokSetelahOpname = (
    await client.query(api.inventory.list, { tenantId, storeId, actorId: userId })
  ).stock.find((row) => row.productId === gudangProductId);
  check(
    "stok lokasi jual menjadi sama persis dengan hasil hitung",
    stokSetelahOpname.levels.find((level) => level.warehouseId === "default")
      ?.quantity === hasilHitung && stokSetelahOpname.sellable === hasilHitung,
    JSON.stringify({ levels: stokSetelahOpname.levels, sellable: stokSetelahOpname.sellable }),
  );

  for (const [label, attempt] of [
    [
      "posting ulang sesi yang sudah selesai",
      () =>
        client.mutation(api.opname.post, {
          tenantId,
          actorId: userId,
          sessionId: sesiOpname.sessionId,
        }),
    ],
    [
      "mengubah hasil hitung sesi selesai",
      () =>
        client.mutation(api.opname.setCount, {
          tenantId,
          actorId: userId,
          sessionId: sesiOpname.sessionId,
          productId: gudangProductId,
          countedQty: 7,
        }),
    ],
    [
      "membatalkan sesi selesai",
      () =>
        client.mutation(api.opname.cancel, {
          tenantId,
          actorId: userId,
          sessionId: sesiOpname.sessionId,
        }),
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await attempt();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `ditolak: ${label}`,
      blocked && message.includes("sudah selesai"),
      message || "DITERIMA — sesi selesai masih bisa diubah",
    );
  }

  // Sesi kedua menghitung semua produk di lokasi itu, tetapi hanya satu baris
  // yang diisi. Baris yang belum dihitung tidak boleh dianggap nol: kalau
  // dianggap nol, posting akan menghapus stok semua produk lain.
  const stokSebelumSesiKedua = (
    await client.query(api.inventory.list, { tenantId, storeId, actorId: userId })
  ).stock;
  const saldoRoti = stokSebelumSesiKedua
    .find((row) => row.productId === rotiId)
    ?.levels.find((level) => level.warehouseId === "default")?.quantity ?? 0;

  const sesiKedua = await client.mutation(api.opname.start, {
    tenantId,
    storeId,
    actorId: userId,
    note: "Opname semua produk",
  });
  check(
    "sesi kedua menghitung semua produk lokasi itu (OPN-00002)",
    sesiKedua.number === "OPN-00002" && sesiKedua.lineCount >= 2,
    JSON.stringify(sesiKedua),
  );

  const tambahEmpat = hasilHitung + 4;
  await client.mutation(api.opname.setCount, {
    tenantId,
    actorId: userId,
    sessionId: sesiKedua.sessionId,
    productId: gudangProductId,
    countedQty: tambahEmpat,
  });
  const postingSebagian = await client.mutation(api.opname.post, {
    tenantId,
    actorId: userId,
    sessionId: sesiKedua.sessionId,
  });
  check(
    "hitung sebagian: hanya baris yang dihitung yang menggerakkan stok",
    postingSebagian.movements.length === 1 &&
      postingSebagian.netUnits === 4 &&
      postingSebagian.variance.uncounted === sesiKedua.lineCount - 1,
    JSON.stringify({ movements: postingSebagian.movements, variance: postingSebagian.variance }),
  );

  const stokSetelahSesiKedua = (
    await client.query(api.inventory.list, { tenantId, storeId, actorId: userId })
  ).stock;
  check(
    "baris yang belum dihitung dibiarkan apa adanya (stok produk lain utuh)",
    (stokSetelahSesiKedua
      .find((row) => row.productId === rotiId)
      ?.levels.find((level) => level.warehouseId === "default")?.quantity ?? 0) ===
      saldoRoti &&
      (stokSetelahSesiKedua
        .find((row) => row.productId === gudangProductId)
        ?.levels.find((level) => level.warehouseId === "default")?.quantity ?? 0) ===
        tambahEmpat,
    JSON.stringify({ roti: saldoRoti, gudang: tambahEmpat }),
  );

  // Sesi ketiga dibatalkan: lokasinya bebas lagi, dan sesi batal tidak bisa
  // diisi maupun diposting.
  const sesiKetiga = await client.mutation(api.opname.start, {
    tenantId,
    storeId,
    actorId: userId,
    note: "Sesi yang akan dibatalkan",
  });
  const sesiDibatalkan = await client.mutation(api.opname.cancel, {
    tenantId,
    actorId: userId,
    sessionId: sesiKetiga.sessionId,
    reason: "Salah hari",
  });
  check(
    "sesi yang masih berjalan bisa dibatalkan dengan alasan",
    sesiDibatalkan.status === "cancelled",
    JSON.stringify(sesiDibatalkan),
  );

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.opname.setCount, {
        tenantId,
        actorId: userId,
        sessionId: sesiKetiga.sessionId,
        productId: gudangProductId,
        countedQty: 1,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "sesi yang dibatalkan tidak bisa dibuka kembali",
      blocked && message.includes("sudah dibatalkan"),
      message || "DITERIMA — sesi batal masih bisa diubah",
    );
  }

  const opnameAkhir = await client.query(api.opname.list, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "ringkasan akhir memisahkan sesi selesai, batal, dan yang masih berjalan",
    opnameAkhir.summary.postedCount === 2 &&
      opnameAkhir.summary.cancelledCount === 1 &&
      opnameAkhir.summary.openCount === 0 &&
      opnameAkhir.openByLocation.length === 0,
    JSON.stringify(opnameAkhir.summary),
  );
  check(
    "sesi terbaru tampil lebih dulu dan lokasinya terbaca",
    opnameAkhir.sessions[0].number === "OPN-00003" &&
      opnameAkhir.sessions[0].locationName.startsWith("Lokasi jual"),
    JSON.stringify(opnameAkhir.sessions.map((row) => [row.number, row.status])),
  );

  // Gerbang paketnya nyata: sesi baru butuh `inventory.opname` (Enterprise),
  // tetapi sesi lama harus tetap terbaca walau paketnya turun.
  await client.mutation(api.billing.changePlan, {
    tenantId,
    newPlanKey: "professional",
    actorId: userId,
  });
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.opname.start, { tenantId, storeId, actorId: userId });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "sesi opname baru ditolak di paket tanpa fitur opname",
      blocked && message.includes("tidak termasuk paket"),
      message || "DITERIMA — gerbang fitur opname bocor",
    );
  }
  const opnameSetelahTurun = await client.query(api.opname.list, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "sesi lama tetap terbaca & bisa diposting walau paketnya turun",
    opnameSetelahTurun.sessions.length === 3 && opnameSetelahTurun.summary.postedCount === 2,
    JSON.stringify(opnameSetelahTurun.summary),
  );

  await client.mutation(api.billing.changePlan, {
    tenantId,
    newPlanKey: "enterprise",
    actorId: userId,
  });

  // --------------- Phase 4: analitik lanjutan (`report.advanced`)
  // Laporan yang dibaca pemilik di halaman Laporan diuji dari ujung ke ujung:
  // satu produk yang harga belinya diketahui masuk lewat penjualan nyata, lalu
  // angkanya dicocokkan dengan laporan harian pada rentang yang sama.
  const { productId: analitikProductId } = await client.mutation(api.products.create, {
    tenantId,
    storeId,
    sku: `ANL-${runId}`,
    name: "Produk Analitik",
    price: 50_000,
    cost: 30_000,
    openingStock: 20,
    actorId: userId,
  });
  // 2 x 50.000 = 100.000 ; PPN 11% = 11.000 → dibayar 111.000, margin kotor 40%.
  await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    items: [{ productId: analitikProductId, quantity: 2 }],
    payments: [{ method: "cash", amount: 111_000 }],
    idempotencyKey: `analitik-${runId}`,
    cashierId: userId,
  });

  const analitik = await client.query(api.reports.advanced, {
    tenantId,
    storeId,
    actorId: userId,
    days: 30,
    timezoneOffsetMinutes: 420,
  });
  check(
    "analitik lanjutan lengkap: 30 hari, 24 jam, 7 hari, temuan terisi",
    analitik.range.days === 30 &&
      analitik.trend.length === 30 &&
      analitik.busyHours.length === 24 &&
      analitik.weekday.length === 7 &&
      analitik.topProducts.length > 0 &&
      analitik.byCategory.length > 0 &&
      analitik.insights.length > 0,
    JSON.stringify({
      rentang: analitik.range,
      tren: analitik.trend.length,
      jam: analitik.busyHours.length,
      hari: analitik.weekday.length,
    }),
  );
  check(
    "periode analitik mulai di tengah malam lokal (WIB), bukan UTC",
    (analitik.range.from + 420 * 60_000) % 86_400_000 === 0 &&
      analitik.range.to - analitik.range.from === 30 * 86_400_000,
    JSON.stringify(analitik.range),
  );

  const harianAnalitik = await client.query(api.reports.dailySummary, {
    tenantId,
    storeId,
    actorId: userId,
    from: analitik.range.from,
    to: analitik.range.to,
  });
  check(
    "analitik & laporan harian sepakat pada rentang yang sama",
    analitik.totals.revenue === harianAnalitik.revenue &&
      analitik.totals.transactions === harianAnalitik.transactions &&
      analitik.totals.itemCount === harianAnalitik.itemCount,
    JSON.stringify({ analitik: analitik.totals, harian: harianAnalitik }),
  );
  check(
    "omzet bersih = omzet − PPN dan rata-rata keranjang memakai omzet bersih",
    analitik.totals.netRevenue === analitik.totals.revenue - analitik.totals.tax &&
      analitik.totals.averageBasket ===
        Math.round(analitik.totals.netRevenue / analitik.totals.transactions),
    JSON.stringify(analitik.totals),
  );

  const barisAnalitik = analitik.topProducts.find(
    (row) => row.productId === analitikProductId,
  );
  check(
    "produk berharga beli dihitung marginnya dari data tersimpan (40%)",
    barisAnalitik?.quantity === 2 &&
      barisAnalitik.revenue === 100_000 &&
      barisAnalitik.cost === 60_000 &&
      barisAnalitik.profit === 40_000 &&
      barisAnalitik.marginPct === 40,
    JSON.stringify(barisAnalitik ?? analitik.topProducts),
  );
  check(
    "margin kotor konsisten & produk tanpa harga beli dipisahkan",
    analitik.margin.grossProfit === analitik.totals.netRevenue - analitik.margin.cost &&
      analitik.margin.marginPct ===
        Math.round((analitik.margin.grossProfit / analitik.totals.netRevenue) * 100) &&
      analitik.margin.uncostedRevenue > 0 &&
      analitik.insights.some((insight) => insight.text.includes("belum punya harga beli")),
    JSON.stringify(analitik.margin),
  );

  const totalJam = analitik.busyHours.reduce((sum, row) => sum + row.transactions, 0);
  const totalHari = analitik.weekday.reduce((sum, row) => sum + row.transactions, 0);
  const totalTren = analitik.trend.reduce((sum, row) => sum + row.transactions, 0);
  const omzetTren = analitik.trend.reduce((sum, row) => sum + row.revenue, 0);
  const totalKategori = analitik.byCategory.reduce((sum, row) => sum + row.revenue, 0);
  check(
    "jam, hari, dan grafik tren menjumlah persis ke transaksi periode ini",
    totalJam === analitik.totals.transactions &&
      totalHari === analitik.totals.transactions &&
      totalTren === analitik.totals.transactions &&
      omzetTren === analitik.totals.netRevenue,
    JSON.stringify({
      transaksi: analitik.totals.transactions,
      totalJam,
      totalHari,
      totalTren,
      omzetTren,
      netRevenue: analitik.totals.netRevenue,
    }),
  );
  // Baris penjualan memakai harga sebelum diskon: rincian kategori harus sama
  // dengan omzet bersih **ditambah** diskon, bukan dengan omzet bersih saja.
  check(
    "rincian kategori = omzet bersih + diskon",
    totalKategori === analitik.totals.netRevenue + analitik.totals.discount,
    JSON.stringify({
      totalKategori,
      netRevenue: analitik.totals.netRevenue,
      diskon: analitik.totals.discount,
    }),
  );
  check(
    "produk teratas diurutkan dari omzet terbesar",
    analitik.topProducts.every(
      (row, index, list) => index === 0 || list[index - 1].revenue >= row.revenue,
    ),
    JSON.stringify(analitik.topProducts.map((row) => [row.name, row.revenue])),
  );

  const analitikBatas = await client.query(api.reports.advanced, {
    tenantId,
    storeId,
    actorId: userId,
    days: 500,
  });
  check(
    "permintaan 500 hari dipotong ke batas 90 hari",
    analitikBatas.range.days === 90 && analitikBatas.trend.length === 90,
    JSON.stringify(analitikBatas.range),
  );

  // Gerbangnya nyata: paket turun → analitik lanjutan ditolak, laporan harian tetap jalan.
  await client.mutation(api.billing.changePlan, {
    tenantId,
    newPlanKey: "professional",
    actorId: userId,
  });
  {
    let blocked = false;
    let message = "";
    try {
      await client.query(api.reports.advanced, { tenantId, storeId, actorId: userId });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "analitik lanjutan ditolak di paket tanpa fiturnya",
      blocked && message.includes("tidak termasuk paket"),
      message || "DITERIMA — gerbang fitur analitik bocor",
    );
  }
  const harianPro = await client.query(api.reports.dailySummary, {
    tenantId,
    storeId,
    actorId: userId,
    from: analitik.range.from,
    to: analitik.range.to,
  });
  check(
    "laporan harian tetap jalan walau analitik lanjutannya mati",
    harianPro.transactions === harianAnalitik.transactions,
    JSON.stringify({ pro: harianPro.transactions, enterprise: harianAnalitik.transactions }),
  );

  await client.mutation(api.billing.changePlan, {
    tenantId,
    newPlanKey: "enterprise",
    actorId: userId,
  });
  const analitikKasir = await client.query(api.reports.advanced, {
    tenantId,
    storeId,
    actorId: cashierId,
  });
  check(
    "kasir boleh melihat analitik (report.view)",
    analitikKasir.totals.transactions === analitik.totals.transactions,
    JSON.stringify(analitikKasir.totals),
  );
  {
    let blocked = false;
    let message = "";
    try {
      await client.query(api.reports.advanced, {
        tenantId,
        storeId,
        actorId: outsiderId,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "pengguna luar ditolak membaca analitik",
      blocked && message.includes("bukan anggota aktif"),
      message || "DITERIMA — pengguna luar bisa membaca analitik",
    );
  }

  // --------------- Phase 4: peran kustom (`rbac.custom`)
  // Alur yang diuji dari ujung ke ujung: pemilik membuat peran bernama,
  // menugaskannya ke kasir, dan **gerbang server** benar-benar berubah — bukan
  // hanya tampilan di UI. Pagar eskalasi, larangan hapus, dan gerbang paketnya
  // juga diperiksa di sini.
  const { userId: managerUserId, membershipId: managerMembershipId } =
    await client.mutation(api.members.add, {
      tenantId,
      actorId: userId,
      email: `manager+${runId}@mesinpos.test`,
      name: "Manajer Uji",
      role: "manager",
    });

  const peranAwal = await client.query(api.roles.list, { tenantId, actorId: userId });
  check(
    "peran kustom mulai dari daftar kosong",
    peranAwal.roles.length === 0 && peranAwal.summary.total === 0,
    JSON.stringify(peranAwal.summary),
  );

  const peranGudang = await client.mutation(api.roles.create, {
    tenantId,
    actorId: userId,
    name: "  Pengawas   Stok ",
    description: "Boleh melihat stok per gudang",
    permissions: ["inventory.view", "report.view", "pos.sell", "report.view"],
  });
  check("pemilik bisa membuat peran kustom", peranGudang.name === "Pengawas Stok", peranGudang.name);
  check(
    "izin peran disimpan terurut kanonik tanpa duplikat",
    JSON.stringify(peranGudang.permissions) ===
      JSON.stringify(["pos.sell", "report.view", "inventory.view"]),
    JSON.stringify(peranGudang.permissions),
  );

  for (const [label, payload, expected] of [
    ["nama peran bawaan", { name: "Kasir", permissions: ["pos.sell"] }, "peran bawaan"],
    ["tanpa izin", { name: "Peran Kosong", permissions: [] }, "minimal satu izin"],
    ["nama terlalu pendek", { name: "ab", permissions: ["pos.sell"] }, "3–40 karakter"],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.roles.create, { tenantId, actorId: userId, ...payload });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `peran kustom ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — validasi bocor",
    );
  }

  // Pagar eskalasi: peran yang memberi izin di luar wewenang pembuatnya ditolak.
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.roles.create, {
        tenantId,
        actorId: managerUserId,
        name: "Admin Tagihan",
        permissions: ["billing.manage"],
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "manajer ditolak saat memberi izin di luar wewenangnya",
      blocked && message.includes("tidak punya"),
      message || "DITERIMA — eskalasi wewenang bocor",
    );
  }
  const peranManajer = await client.mutation(api.roles.create, {
    tenantId,
    actorId: managerUserId,
    name: "Pengawas Kasir",
    permissions: ["pos.void", "report.view"],
  });
  check(
    "manajer bisa membuat peran di dalam wewenangnya",
    peranManajer.name === "Pengawas Kasir",
    peranManajer.name,
  );

  // Kasir tanpa peran kustom tidak punya `inventory.view`.
  {
    let blocked = false;
    let message = "";
    try {
      await client.query(api.inventory.list, { tenantId, storeId, actorId: cashierId });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "kasir tanpa peran kustom ditolak membuka stok per gudang",
      blocked && message.includes("tidak memiliki izin"),
      message || "DITERIMA — izin kasir bocor",
    );
  }

  const penugasan = await client.mutation(api.roles.assign, {
    tenantId,
    actorId: userId,
    membershipId,
    customRoleId: peranGudang.roleId,
  });
  check(
    "pemilik bisa menugaskan peran kustom ke kasir",
    penugasan.customRoleId === peranGudang.roleId,
    JSON.stringify(penugasan),
  );

  const stokKasir = await client.query(api.inventory.list, {
    tenantId,
    storeId,
    actorId: cashierId,
  });
  check(
    "peran kustom memberi izin yang tadinya tidak dimiliki kasir",
    Array.isArray(stokKasir.locations) && stokKasir.locations.length > 0,
    JSON.stringify(stokKasir.locations?.length ?? stokKasir),
  );

  // ...dan sekaligus **mencabut** izin yang tidak ada di perannya (kasir punya
  // `ar.view` secara bawaan). Pesannya menyebut peran kustom yang berlaku.
  {
    let blocked = false;
    let message = "";
    try {
      await client.query(api.ar.list, { tenantId, actorId: cashierId });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "peran kustom menggantikan izin bawaan, bukan menambahinya",
      blocked &&
        message.includes("tidak memiliki izin") &&
        message.includes('peran kustom "Pengawas Stok"'),
      message || "DITERIMA — peran kustom hanya menambah",
    );
  }

  const aksesKasir = await client.query(api.roles.myAccess, {
    tenantId,
    actorId: cashierId,
  });
  check(
    "myAccess melaporkan peran kustom yang berlaku & peran bawaannya",
    aksesKasir.customRole?.name === "Pengawas Stok" && aksesKasir.role === "cashier",
    JSON.stringify(aksesKasir),
  );
  check(
    "myAccess mengembalikan izin efektif, bukan izin bawaan",
    JSON.stringify(aksesKasir.permissions) ===
      JSON.stringify(["pos.sell", "report.view", "inventory.view"]),
    JSON.stringify(aksesKasir.permissions),
  );

  const peranSetelahPakai = await client.query(api.roles.list, {
    tenantId,
    actorId: userId,
  });
  check(
    "daftar peran menghitung anggotanya",
    peranSetelahPakai.roles.find((row) => row.name === "Pengawas Stok")?.memberCount === 1 &&
      peranSetelahPakai.summary.assignedMembers === 1,
    JSON.stringify(peranSetelahPakai.summary),
  );

  const efektifKasir = await client.query(api.roles.effective, {
    tenantId,
    actorId: userId,
    membershipId,
  });
  check(
    "roles.effective membedakan izin efektif dari izin bawaan",
    efektifKasir.customRoleName === "Pengawas Stok" &&
      efektifKasir.permissions.length === 3 &&
      efektifKasir.basePermissions.includes("ar.view") &&
      !efektifKasir.permissions.includes("ar.view"),
    JSON.stringify(efektifKasir),
  );

  // Pemilik tenant selalu memegang seluruh izin — peran kustom tidak berlaku
  // untuknya, walaupun pemilik yang membuatnya.
  {
    const pemilik = (await client.query(api.members.list, { tenantId, actorId: userId })).find(
      (row) => row.membership.role === "owner",
    );
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.roles.assign, {
        tenantId,
        actorId: userId,
        membershipId: pemilik.membership._id,
        customRoleId: peranGudang.roleId,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "pemilik tenant tidak bisa dipindah ke peran kustom",
      blocked && message.includes("Pemilik"),
      message || "DITERIMA — pemilik kehilangan wewenangnya",
    );
  }

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.roles.remove, {
        tenantId,
        actorId: userId,
        roleId: peranGudang.roleId,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "peran yang masih dipakai anggota tidak bisa dihapus",
      blocked && message.includes("masih dipakai"),
      message || "DITERIMA — peran terpakai terhapus",
    );
  }

  // Gerbang paketnya nyata: membuat & menugaskan peran butuh `rbac.custom`,
  // tetapi **melepas** penugasan selalu boleh supaya akses bisa dicabut.
  await client.mutation(api.billing.changePlan, {
    tenantId,
    newPlanKey: "professional",
    actorId: userId,
  });
  for (const [label, run] of [
    [
      "membuat peran kustom ditolak di paket tanpa fiturnya",
      () =>
        client.mutation(api.roles.create, {
          tenantId,
          actorId: userId,
          name: "Peran Baru",
          permissions: ["pos.sell"],
        }),
    ],
    [
      "menugaskan peran kustom ditolak di paket tanpa fiturnya",
      () =>
        client.mutation(api.roles.assign, {
          tenantId,
          actorId: userId,
          membershipId: managerMembershipId,
          customRoleId: peranManajer.roleId,
        }),
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await run();
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(label, blocked && message.includes("tidak termasuk paket"), message || "DITERIMA — gerbang fitur bocor");
  }

  const dilepas = await client.mutation(api.roles.assign, {
    tenantId,
    actorId: userId,
    membershipId,
    customRoleId: null,
  });
  check(
    "melepas peran kustom selalu boleh walau paketnya turun",
    dilepas.customRoleId === null,
    JSON.stringify(dilepas),
  );

  const aksesKembali = await client.query(api.roles.myAccess, {
    tenantId,
    actorId: cashierId,
  });
  check(
    "izin kasir kembali ke peran bawaannya setelah peran kustom dilepas",
    aksesKembali.customRole === null &&
      aksesKembali.permissions.includes("ar.view") &&
      !aksesKembali.permissions.includes("inventory.view"),
    JSON.stringify(aksesKembali),
  );

  {
    let blocked = false;
    let message = "";
    try {
      await client.query(api.roles.list, { tenantId, actorId: cashierId });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "daftar peran hanya untuk pemegang izin team.manage",
      blocked && message.includes("team.manage"),
      message || "DITERIMA — kasir bisa membaca daftar peran",
    );
  }

  {
    let blocked = false;
    let message = "";
    try {
      await client.query(api.roles.list, { tenantId, actorId: outsiderId });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "pengguna luar ditolak membaca peran tenant",
      blocked && message.includes("bukan anggota aktif"),
      message || "DITERIMA — pengguna luar membaca peran",
    );
  }

  // --------------- Phase 4: akses API & webhook (`api.access`) ------------
  // Alur ujung ke ujung, bukan hanya aturan: pemilik membuat kunci, kunci itu
  // **benar-benar dipakai** memanggil HTTP action `/api/v1/*`, scope & izin
  // pembuatnya ditegakkan, lalu kuncinya dicabut dan langsung berhenti bekerja.
  // Kiriman webhook ke host yang tidak ada harus tercatat sebagai percobaan
  // gagal — kegagalan tidak boleh hilang.
  const siteCandidates = [
    process.env.VITE_CONVEX_SITE_URL,
    url.replace(/\.convex\.cloud\/?$/, ".convex.site"),
    "http://127.0.0.1:3211",
  ].filter(Boolean);

  // Bagian peran kustom sengaja menurunkan paket ke professional untuk menguji
  // gerbangnya; `api.access` hanya ada di Enterprise, jadi paketnya dinaikkan
  // lagi di sini — alurnya memang begitu bagi tenant nyata yang membeli fitur.
  await client.mutation(api.billing.changePlan, {
    tenantId,
    newPlanKey: "enterprise",
    actorId: userId,
  });

  async function fetchApi(host, path, apiKey, init = {}) {
    const headers = { ...(init.headers ?? {}) };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const response = await fetch(`${host}${path}`, { ...init, headers });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  /** Kirim pesanan masuk ke endpoint tulis; `raw` melewati JSON.stringify. */
  async function postOrder(apiKey, body, raw = false) {
    return await fetchApi(siteUrl, "/api/v1/sales", apiKey, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? body : JSON.stringify(body),
    });
  }

  const overviewAwal = await client.query(api.apiAccess.overview, {
    tenantId,
    actorId: userId,
  });
  check(
    "tenant baru belum punya kunci API maupun endpoint webhook",
    overviewAwal.keys.length === 0 &&
      overviewAwal.endpoints.length === 0 &&
      overviewAwal.deliveries.length === 0 &&
      overviewAwal.summary.activeKeys === 0,
    JSON.stringify(overviewAwal.summary),
  );

  const kunciServer = await client.mutation(api.apiAccess.createKey, {
    tenantId,
    actorId: userId,
    name: "Server Uji",
    scopes: ["report.view", "payable.view", "report.view"],
    expiresInDays: 30,
  });
  check(
    "kunci dibuat dengan bentuk mp_<publicId>_<secret> & scope unik",
    kunciServer.plaintext.startsWith("mp_") &&
      kunciServer.mask.includes(kunciServer.plaintext.split("_")[1]) &&
      JSON.stringify(kunciServer.scopes) === JSON.stringify(["report.view", "payable.view"]),
    JSON.stringify({ mask: kunciServer.mask, scopes: kunciServer.scopes }),
  );
  check(
    "rahasia kunci tidak ikut tersimpan di daftar",
    !JSON.stringify(
      await client.query(api.apiAccess.overview, { tenantId, actorId: userId }),
    ).includes(kunciServer.plaintext.split("_")[2]),
    "DITERIMA — rahasia kunci bocor lewat daftar",
  );

  // HTTP action: dicari host yang benar-benar menjawab (deployment cloud memakai
  // domain `.convex.site`, backend lokal port 3211).
  let siteUrl = null;
  const siteErrors = [];
  for (const candidate of siteCandidates) {
    try {
      const probe = await fetchApi(candidate, "/api/v1/ping", kunciServer.plaintext);
      if (typeof probe.status === "number") {
        siteUrl = candidate;
        break;
      }
    } catch (error) {
      siteErrors.push(`${candidate}: ${error?.message ?? String(error)}`);
    }
  }
  check(
    "HTTP action /api/v1 dilayani",
    siteUrl !== null,
    siteErrors.join(" | ") || "tidak ada host yang menjawab",
  );

  const ping = await fetchApi(siteUrl, "/api/v1/ping", kunciServer.plaintext);
  check(
    "kunci sah dipakai memanggil /api/v1/ping",
    ping.status === 200 && ping.body?.ok === true && ping.body?.resource === "ping",
    `${ping.status} ${JSON.stringify(ping.body)}`,
  );
  const tanpaKunci = await fetchApi(siteUrl, "/api/v1/ping");
  check(
    "tanpa kunci endpoint menjawab 401",
    tanpaKunci.status === 401,
    `${tanpaKunci.status} ${JSON.stringify(tanpaKunci.body)}`,
  );
  const kunciSalah = await fetchApi(siteUrl, "/api/v1/ping", `${kunciServer.plaintext}xyz`);
  check(
    "kunci dengan rahasia salah ditolak 401",
    kunciSalah.status === 401,
    `${kunciSalah.status} ${JSON.stringify(kunciSalah.body)}`,
  );
  const scopeKurang = await fetchApi(siteUrl, "/api/v1/products", kunciServer.plaintext);
  check(
    "scope yang tidak dimiliki kunci ditolak 403",
    scopeKurang.status === 403 &&
      String(scopeKurang.body?.error ?? "").includes("inventory.view"),
    `${scopeKurang.status} ${JSON.stringify(scopeKurang.body)}`,
  );
  const resourceAsing = await fetchApi(siteUrl, "/api/v1/penjualan", kunciServer.plaintext);
  check(
    "resource di luar daftar ditolak 404",
    resourceAsing.status === 404,
    `${resourceAsing.status} ${JSON.stringify(resourceAsing.body)}`,
  );
  const penjualan = await fetchApi(siteUrl, "/api/v1/sales?days=7", kunciServer.plaintext);
  check(
    "kunci membaca penjualan tenant yang benar",
    penjualan.status === 200 &&
      penjualan.body?.key === "Server Uji" &&
      Array.isArray(penjualan.body?.data?.sales) &&
      penjualan.body.data.days === 7,
    `${penjualan.status} ${JSON.stringify(penjualan.body)?.slice(0, 200)}`,
  );
  const hutang = await fetchApi(siteUrl, "/api/v1/payables", kunciServer.plaintext);
  check(
    "kunci dengan scope payable membaca hutang usaha",
    hutang.status === 200 && typeof hutang.body?.data?.outstanding === "number",
    `${hutang.status} ${JSON.stringify(hutang.body)?.slice(0, 200)}`,
  );

  // ---- Endpoint tulis `POST /api/v1/sales` (scope `pos.sell`) ------------
  // Produk baru dengan stok kecil supaya batas stoknya bisa diuji tepat, tanpa
  // bergantung pada sisa stok produk yang sudah dipakai bagian harness lain.
  await client.mutation(api.products.create, {
    tenantId,
    storeId,
    sku: `APIORD-${runId}`,
    name: "Produk Pesanan Masuk",
    price: 30000,
    openingStock: 3,
    actorId: userId,
  });

  const kunciBacaSaja = await client.mutation(api.apiAccess.createKey, {
    tenantId,
    actorId: userId,
    name: "Baca Laporan Saja",
    scopes: ["report.view"],
  });
  const kunciTulis = await client.mutation(api.apiAccess.createKey, {
    tenantId,
    actorId: userId,
    name: "Pesanan Masuk",
    scopes: ["pos.sell"],
    expiresInDays: 30,
  });
  check(
    "kunci bertulis scope pos.sell bisa dibuat pemegang izin penjualan",
    JSON.stringify(kunciTulis.scopes) === JSON.stringify(["pos.sell"]),
    JSON.stringify(kunciTulis.scopes),
  );

  const orderKey = `masuk-${runId}-1`;
  const orderLines = () => [{ sku: `apiord-${runId}`, quantity: 2 }];

  const tanpaKunciTulis = await postOrder(undefined, {
    idempotencyKey: orderKey,
    lines: orderLines(),
    payment: { method: "qris" },
  });
  check(
    "tanpa kunci endpoint tulis menjawab 401",
    tanpaKunciTulis.status === 401,
    `${tanpaKunciTulis.status} ${JSON.stringify(tanpaKunciTulis.body)}`,
  );
  const scopeKurangTulis = await postOrder(kunciBacaSaja.plaintext, {
    idempotencyKey: orderKey,
    lines: orderLines(),
    payment: { method: "qris" },
  });
  check(
    "kunci tanpa scope pos.sell ditolak 403 di endpoint tulis",
    scopeKurangTulis.status === 403 &&
      String(scopeKurangTulis.body?.error ?? "").includes("pos.sell"),
    `${scopeKurangTulis.status} ${JSON.stringify(scopeKurangTulis.body)}`,
  );
  const bodyBukanJson = await postOrder(kunciTulis.plaintext, "{bukan json", true);
  check(
    "body yang bukan JSON ditolak 400",
    bodyBukanJson.status === 400 &&
      String(bodyBukanJson.body?.error ?? "").includes("bukan JSON valid"),
    `${bodyBukanJson.status} ${JSON.stringify(bodyBukanJson.body)}`,
  );
  const tanpaIdempotency = await postOrder(kunciTulis.plaintext, {
    lines: orderLines(),
    payment: { method: "qris" },
  });
  check(
    "pesanan tanpa idempotencyKey ditolak 400",
    tanpaIdempotency.status === 400 &&
      String(tanpaIdempotency.body?.error ?? "").includes("idempotencyKey wajib"),
    `${tanpaIdempotency.status} ${JSON.stringify(tanpaIdempotency.body)}`,
  );
  const fieldAsing = await postOrder(kunciTulis.plaintext, {
    idempotencyKey: orderKey,
    lines: orderLines(),
    payment: { method: "qris" },
    total: 66_600,
  });
  check(
    "kiriman dengan field asing ditolak 400, harga tidak diterima dari luar",
    fieldAsing.status === 400 && String(fieldAsing.body?.error ?? "").includes("total"),
    `${fieldAsing.status} ${JSON.stringify(fieldAsing.body)}`,
  );

  const dibuat = await postOrder(kunciTulis.plaintext, {
    idempotencyKey: orderKey,
    lines: orderLines(),
    payment: { method: "qris" },
  });
  check(
    "penjualan dari sistem luar tercatat (HTTP 201)",
    dibuat.status === 201 &&
      dibuat.body?.ok === true &&
      dibuat.body?.data?.deduplicated === false &&
      dibuat.body?.resource === "sales.create",
    `${dibuat.status} ${JSON.stringify(dibuat.body)?.slice(0, 240)}`,
  );
  // 2 × 30.000 = 60.000, PPN tenant 11% = 6.600 — semuanya dihitung server,
  // karena kirimannya tidak memuat harga sama sekali.
  check(
    "harga & PPN dihitung server, tanpa jumlah bayar dari luar",
    dibuat.body?.data?.total === 66_600 && dibuat.body?.data?.creditAmount === 0,
    JSON.stringify(dibuat.body?.data),
  );
  check(
    "nomor struk & id penjualan dikembalikan ke pengirim",
    typeof dibuat.body?.data?.id === "string" &&
      /^A-\d{5}$/.test(String(dibuat.body?.data?.number)),
    JSON.stringify(dibuat.body?.data),
  );

  const kirimanUlang = await postOrder(kunciTulis.plaintext, {
    idempotencyKey: orderKey,
    lines: orderLines(),
    payment: { method: "qris" },
  });
  check(
    "kiriman ulang dengan kunci yang sama tidak menagih dua kali (HTTP 200)",
    kirimanUlang.status === 200 &&
      kirimanUlang.body?.data?.deduplicated === true &&
      kirimanUlang.body?.data?.id === dibuat.body?.data?.id &&
      kirimanUlang.body?.data?.number === dibuat.body?.data?.number,
    `${kirimanUlang.status} ${JSON.stringify(kirimanUlang.body?.data)}`,
  );

  // Kunci bertindak **sebagai pembuatnya**: penjualannya tercatat atas nama itu,
  // pembayarannya tepat sebesar total (bukan nol), dan kunci idempotensinya
  // dinamai per tenant supaya tidak bentrok antar tenant.
  const penjualanTerbaru = await client.query(api.pos.recent, {
    tenantId,
    storeId,
    actorId: userId,
    limit: 5,
  });
  const saleApi = penjualanTerbaru.find((row) => row.number === dibuat.body?.data?.number);
  check(
    "penjualan API tercatat atas nama pembuat kunci",
    saleApi?.cashierId === userId && saleApi?.status === "completed",
    JSON.stringify(saleApi && { cashier: saleApi.cashierId, status: saleApi.status }),
  );
  check(
    "pembayaran tepat sebesar total tercatat di penjualan",
    saleApi?.payments?.[0]?.method === "qris" &&
      saleApi?.payments?.[0]?.amount === 66_600 &&
      saleApi?.payments?.[0]?.change === undefined,
    JSON.stringify(saleApi?.payments),
  );
  check(
    "kunci idempotensi penjualan API dinamai per tenant",
    saleApi?.idempotencyKey === `api:${tenantId}:${orderKey}`,
    String(saleApi?.idempotencyKey),
  );

  // Tulis → baca: penjualannya terlihat di endpoint baca, dan stoknya bergerak.
  const penjualanLewatApi = await fetchApi(siteUrl, "/api/v1/sales?days=7", kunciServer.plaintext);
  check(
    "penjualan dari sistem luar terbaca lewat GET /api/v1/sales",
    penjualanLewatApi.status === 200 &&
      penjualanLewatApi.body?.data?.sales?.some(
        (row) =>
          row.number === dibuat.body?.data?.number &&
          row.method === "qris" &&
          row.total === 66_600,
      ),
    `${penjualanLewatApi.status} ${JSON.stringify(penjualanLewatApi.body?.data?.sales)?.slice(0, 240)}`,
  );
  const kunciStok = await client.mutation(api.apiAccess.createKey, {
    tenantId,
    actorId: userId,
    name: "Stok Baca",
    scopes: ["inventory.view"],
  });
  const katalogLewatApi = await fetchApi(siteUrl, "/api/v1/products", kunciStok.plaintext);
  check(
    "stok lokasi jual berkurang karena penjualan dari API (3 → 1)",
    katalogLewatApi.status === 200 &&
      katalogLewatApi.body?.data?.products?.some(
        (row) => row.sku === `APIORD-${runId}` && row.sellable === 1,
      ),
    `${katalogLewatApi.status} ${JSON.stringify(katalogLewatApi.body?.data?.products)?.slice(0, 240)}`,
  );

  // Aturan bisnis tetap milik `pos.createSale`, apa adanya dan dengan kode 409.
  const stokHabis = await postOrder(kunciTulis.plaintext, {
    idempotencyKey: `masuk-${runId}-2`,
    lines: [{ sku: `APIORD-${runId}`, quantity: 2 }],
    payment: { method: "qris" },
  });
  check(
    "stok kurang ditolak 409 dengan pesan dari jalur penjualan kasir",
    stokHabis.status === 409 && String(stokHabis.body?.error ?? "").includes("Stok tidak cukup"),
    `${stokHabis.status} ${JSON.stringify(stokHabis.body)}`,
  );
  const kurangBayar = await postOrder(kunciTulis.plaintext, {
    idempotencyKey: `masuk-${runId}-3`,
    lines: [{ sku: `APIORD-${runId}`, quantity: 1 }],
    payment: { method: "cash", amount: 1000 },
  });
  check(
    "sisa tagihan tanpa pelanggan ditolak 409 (bukan jadi piutang gelap)",
    kurangBayar.status === 409 && String(kurangBayar.body?.error ?? "").includes("B2B"),
    `${kurangBayar.status} ${JSON.stringify(kurangBayar.body)}`,
  );
  const skuAsing = await postOrder(kunciTulis.plaintext, {
    idempotencyKey: `masuk-${runId}-4`,
    lines: [{ sku: `TIDAK-ADA-${runId}`, quantity: 1 }],
    payment: { method: "qris" },
  });
  check(
    "SKU yang tidak ada di katalog ditolak 400 tanpa menulis apa pun",
    skuAsing.status === 400 && String(skuAsing.body?.error ?? "").includes("tidak ditemukan"),
    `${skuAsing.status} ${JSON.stringify(skuAsing.body)}`,
  );

  await client.mutation(api.apiAccess.revokeKey, {
    tenantId,
    actorId: userId,
    keyId: kunciTulis.keyId,
  });
  const setelahDicabutTulis = await postOrder(kunciTulis.plaintext, {
    idempotencyKey: `masuk-${runId}-5`,
    lines: orderLines(),
    payment: { method: "qris" },
  });
  check(
    "kunci tulis yang dicabut langsung berhenti bekerja",
    setelahDicabutTulis.status === 401,
    `${setelahDicabutTulis.status} ${JSON.stringify(setelahDicabutTulis.body)}`,
  );

  const setelahDipakai = await client.query(api.apiAccess.overview, {
    tenantId,
    actorId: userId,
  });
  // Dicari lewat namanya, bukan lewat urutan: endpoint tulis di bawah menambah
  // kunci lain, dan daftarnya terurut terbaru dulu.
  const barisKunciServer = setelahDipakai.keys.find((key) => key.name === "Server Uji");
  check(
    "pemakaian kunci tercatat (lastUsedAt terisi)",
    barisKunciServer?.lastUsedAt !== null &&
      barisKunciServer?.lastUsedAt !== undefined &&
      barisKunciServer?.creatorRole === "owner",
    JSON.stringify(barisKunciServer),
  );

  // Pagar eskalasi lewat peran kustom: kunci tidak boleh melebihi izin pembuat,
  // dan kunci buatan anggota yang perannya menyempit harus ikut berhenti.
  const peranIntegrator = await client.mutation(api.roles.create, {
    tenantId,
    actorId: userId,
    name: "Integrator Kasir",
    description: "Membuat kunci API untuk laporan saja",
    permissions: ["api.manage", "report.view"],
  });
  await client.mutation(api.roles.assign, {
    tenantId,
    actorId: userId,
    membershipId,
    customRoleId: peranIntegrator.roleId,
  });

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.apiAccess.createKey, {
        tenantId,
        actorId: cashierId,
        name: "Kunci Di Luar Wewenang",
        scopes: ["payable.view"],
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "kunci ditolak saat scope-nya di luar izin pembuat",
      blocked && message.includes("tidak punya"),
      message || "DITERIMA — eskalasi scope bocor",
    );
  }

  const kunciKasir = await client.mutation(api.apiAccess.createKey, {
    tenantId,
    actorId: cashierId,
    name: "Integrasi Kasir",
    scopes: ["report.view"],
  });
  const kasirPing = await fetchApi(siteUrl, "/api/v1/sales", kunciKasir.plaintext);
  check(
    "kunci buatan anggota berperan kustom bisa dipakai",
    kasirPing.status === 200,
    `${kasirPing.status} ${JSON.stringify(kasirPing.body)?.slice(0, 160)}`,
  );

  // Peran kustomnya dirampingkan: kunci yang pernah dibuatnya harus langsung
  // berhenti tanpa perlu dicabut satu per satu.
  await client.mutation(api.roles.update, {
    tenantId,
    actorId: userId,
    roleId: peranIntegrator.roleId,
    permissions: ["api.manage"],
  });
  const kasirSempit = await fetchApi(siteUrl, "/api/v1/sales", kunciKasir.plaintext);
  check(
    "kunci ikut menyempit saat izin pembuatnya dicabut",
    kasirSempit.status === 403 &&
      String(kasirSempit.body?.error ?? "").includes("sudah tidak mencakup"),
    `${kasirSempit.status} ${JSON.stringify(kasirSempit.body)}`,
  );

  await client.mutation(api.apiAccess.revokeKey, {
    tenantId,
    actorId: userId,
    keyId: kunciServer.keyId,
  });
  const setelahDicabut = await fetchApi(siteUrl, "/api/v1/ping", kunciServer.plaintext);
  check(
    "kunci yang dicabut langsung berhenti bekerja",
    setelahDicabut.status === 401 &&
      String(setelahDicabut.body?.error ?? "").includes("dicabut"),
    `${setelahDicabut.status} ${JSON.stringify(setelahDicabut.body)}`,
  );
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.apiAccess.revokeKey, {
        tenantId,
        actorId: userId,
        keyId: kunciServer.keyId,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "kunci tidak bisa dicabut dua kali",
      blocked && message.includes("sudah dicabut"),
      message || "DITERIMA — pencabutan bisa diulang",
    );
  }
  {
    // Staf gudang bukan pemegang `api.manage` (kasir di sini sudah memegangnya
    // lewat peran kustom Integrator Kasir).
    let blocked = false;
    let message = "";
    try {
      await client.query(api.apiAccess.overview, { tenantId, actorId: stafGudangId });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "daftar kunci hanya untuk pemegang izin api.manage",
      blocked && message.includes("api.manage"),
      message || "DITERIMA — peran tanpa api.manage bisa membaca daftar kunci",
    );
  }

  // Webhook keluar: rahasia, tanda tangan, dan riwayat kiriman.
  for (const [label, payload, expected] of [
    [
      "endpoint HTTP biasa",
      { url: "http://gudang.mesinpos.test/hook", events: ["sale.completed"] },
      "HTTPS",
    ],
    [
      "host jaringan dalam",
      { url: "https://10.0.0.8/hook", events: ["sale.completed"] },
      "publik",
    ],
    [
      "tanpa event",
      { url: "https://gudang.mesinpos.test/hook", events: [] },
      "minimal satu event",
    ],
  ]) {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.apiAccess.createEndpoint, {
        tenantId,
        actorId: userId,
        description: "Uji",
        ...payload,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      `endpoint webhook ditolak: ${label}`,
      blocked && message.includes(expected),
      message || "DITERIMA — validasi endpoint bocor",
    );
  }

  const endpoint = await client.mutation(api.apiAccess.createEndpoint, {
    tenantId,
    actorId: userId,
    url: "https://tidak-ada.mesinpos.invalid/hook",
    description: "Server uji",
    events: ["stock.low", "sale.completed", "stock.low"],
  });
  check(
    "endpoint webhook dibuat dengan rahasia & event unik terurut",
    endpoint.secret.length === 32 &&
      JSON.stringify(endpoint.events) === JSON.stringify(["sale.completed", "stock.low"]),
    JSON.stringify({ events: endpoint.events, panjang: endpoint.secret.length }),
  );
  check(
    "yang disimpan hanya 4 karakter akhir rahasia",
    (await client.query(api.apiAccess.overview, { tenantId, actorId: userId })).endpoints[0]
      ?.secretLastFour === endpoint.secret.slice(-4),
    "DITERIMA — rahasia webhook bocor lewat daftar",
  );

  // Pemicu event nyata: penjualan/opname sungguhan harus mengisi antrean
  // kiriman sendiri. Isi kirimannya diuji murni di `scripts/verify-api.mjs`;
  // yang dibuktikan di sini kejadiannya benar-benar berangkat dari jalur
  // transaksi — dan percobaan pertamanya langsung diserahkan ke pekerja yang
  // sama, bukan menunggu putaran cron berikutnya.
  /** Kejadian yang harus berangkat sendiri — tanpa ada yang memicu manual. */
  const kejadianWajib = ["sale.completed", "stock.low", "sale.voided", "opname.posted"];
  /**
   * Menunggu sampai pekerja sudah mencoba **semua** kejadian itu.
   *
   * Batasnya 75 detik, bukan 20 detik: penjadwalan langsung setelah transaksi
   * hanya mempercepat jalur normal, sedangkan jaminannya tetap putaran pekerja
   * tiap 1 menit — jadi cek ini tidak boleh bergantung pada penjadwalan yang
   * kebetulan sedang cepat.
   */
  async function tungguKejadianDicoba() {
    const deadline = Date.now() + 75_000;
    let terakhir = [];
    while (Date.now() < deadline) {
      const { deliveries } = await client.query(api.apiAccess.overview, {
        tenantId,
        actorId: userId,
      });
      terakhir = deliveries;
      if (
        kejadianWajib.every((event) =>
          deliveries.some((row) => row.event === event && row.attempts >= 1),
        )
      ) {
        return deliveries;
      }
      await sleep(1000);
    }
    throw new Error(
      `kejadian belum dicoba pekerja: ${JSON.stringify(terakhir.map((row) => [row.event, row.status, row.attempts]))}`,
    );
  }

  const belumAdaKejadian = await client.query(api.apiAccess.overview, {
    tenantId,
    actorId: userId,
  });
  check(
    "belum ada kiriman sebelum ada kejadian nyata",
    belumAdaKejadian.deliveries.length === 0,
    JSON.stringify(belumAdaKejadian.summary),
  );

  // Endpoint uji utama dimatikan sementara (mematikan endpoint selalu boleh):
  // pemicu di bawah diuji pada penerimanya sendiri supaya hitungan kiriman cek
  // berikutnya tetap utuh.
  await client.mutation(api.apiAccess.updateEndpoint, {
    tenantId,
    actorId: userId,
    endpointId: endpoint.endpointId,
    active: false,
  });
  const endpointPemicu = await client.mutation(api.apiAccess.createEndpoint, {
    tenantId,
    actorId: userId,
    url: "https://tidak-ada.mesinpos.invalid/pemicu",
    description: "Penerima pemicu kejadian",
    events: ["sale.completed", "sale.voided", "stock.low", "opname.posted"],
  });

  const { productId: produkAmbang } = await client.mutation(api.products.create, {
    tenantId,
    storeId,
    sku: `AMB-${runId}`,
    name: "Produk Ambang Stok",
    price: 10_000,
    openingStock: 6,
    actorId: userId,
  });
  const penjualanKejadian = await client.mutation(api.pos.createSale, {
    tenantId,
    storeId,
    cashierId: userId,
    items: [{ productId: produkAmbang, quantity: 2 }],
    payments: [{ method: "cash", amount: 22_200 }],
    idempotencyKey: `kejadian-${runId}`,
  });
  check(
    "penjualan pemicu memakai harga server (2 × 10.000 + PPN 11%)",
    penjualanKejadian.total === 22_200,
    String(penjualanKejadian.total),
  );

  // Antreannya terisi di dalam transaksi penjualan, jadi barisnya langsung ada —
  // yang tidak boleh ada adalah dua baris untuk kejadian yang sama.
  const setelahPenjualan = await client.query(api.apiAccess.overview, {
    tenantId,
    actorId: userId,
  });
  check(
    "penjualan nyata menulis satu kiriman sale.completed dan satu stock.low",
    setelahPenjualan.deliveries.filter((row) => row.event === "sale.completed").length === 1 &&
      setelahPenjualan.deliveries.filter((row) => row.event === "stock.low").length === 1,
    JSON.stringify(setelahPenjualan.deliveries.map((row) => row.event)),
  );

  await client.mutation(api.pos.voidSale, {
    saleId: penjualanKejadian.saleId,
    actorId: userId,
    reason: "Uji webhook pembatalan",
  });
  const setelahPembatalan = await client.query(api.apiAccess.overview, {
    tenantId,
    actorId: userId,
  });
  const kirimanPembatalan = setelahPembatalan.deliveries.find(
    (row) => row.event === "sale.voided",
  );
  check(
    "pembatalan penjualan menulis kiriman sale.voided ke endpoint langganannya",
    kirimanPembatalan !== undefined &&
      kirimanPembatalan.endpointId === endpointPemicu.endpointId,
    JSON.stringify(setelahPembatalan.deliveries.map((row) => row.event)),
  );

  // Opname yang diposting juga kejadian nyata: selisih hitung fisiknya ditunggu
  // akuntansi, jadi kirimannya berangkat dari jalur posting itu sendiri.
  const sesiPemicu = await client.mutation(api.opname.start, {
    tenantId,
    storeId,
    actorId: userId,
    note: "Sesi pemicu webhook",
  });
  await client.mutation(api.opname.setCount, {
    tenantId,
    actorId: userId,
    sessionId: sesiPemicu.sessionId,
    productId: produkAmbang,
    countedQty: 5,
  });
  await client.mutation(api.opname.post, {
    tenantId,
    actorId: userId,
    sessionId: sesiPemicu.sessionId,
  });
  const setelahOpname = await client.query(api.apiAccess.overview, {
    tenantId,
    actorId: userId,
  });
  const kirimanOpname = setelahOpname.deliveries.find((row) => row.event === "opname.posted");
  check(
    "opname yang diposting menulis kiriman opname.posted",
    kirimanOpname !== undefined && kirimanOpname.endpointId === endpointPemicu.endpointId,
    JSON.stringify(setelahOpname.deliveries.map((row) => row.event)),
  );

  // Baru sekarang ditunggu: pekerja harus mencoba keempatnya sendiri. Tidak ada
  // satu pun `testEndpoint` di antaranya — inilah yang membuktikan pemicunya
  // benar-benar berangkat, bukan hanya tercatat.
  const setelahDicoba = await tungguKejadianDicoba();
  check(
    "pekerja mencoba keempat kejadian tanpa pemicu manual",
    kejadianWajib.every((event) => {
      const row = setelahDicoba.find((entry) => entry.event === event);
      return (
        row !== undefined &&
        row.attempts >= 1 &&
        row.status === "pending" &&
        row.lastError !== null
      );
    }),
    JSON.stringify(setelahDicoba.map((row) => [row.event, row.status, row.attempts])),
  );

  // Bersihkan penerima pemicu supaya cek kiriman manual di bawah tetap punya
  // hitungan yang bisa diprediksi (satu baris per kiriman uji), lalu hidupkan
  // kembali endpoint uji utama.
  const dibersihkan = await client.mutation(api.apiAccess.removeEndpoint, {
    tenantId,
    actorId: userId,
    endpointId: endpointPemicu.endpointId,
  });
  check(
    "menghapus endpoint pemicu membuang keempat kiriman kejadiannya",
    dibersihkan.removedDeliveries === 4,
    String(dibersihkan.removedDeliveries),
  );
  await client.mutation(api.apiAccess.updateEndpoint, {
    tenantId,
    actorId: userId,
    endpointId: endpoint.endpointId,
    active: true,
  });
  // Satu cap waktu dipakai untuk badan, tanda tangan, dan pemeriksaan. Versi
  // sebelumnya memanggil `Date.now()` tiga kali dalam ekspresi yang sama, jadi
  // ia bisa gagal hanya karena jarum jam bergerak satu milidetik di antaranya —
  // nilai `at` di dalam badan ikut berubah, dan tanda tangannya tidak cocok.
  const capTandaTangan = Date.now();
  const badanTandaTangan = sampleDeliveryPayload("sale.completed", capTandaTangan);
  const badanLain = sampleDeliveryPayload("stock.low", capTandaTangan);
  check(
    "tanda tangan kiriman bisa diverifikasi penerima (HMAC timestamp.body)",
    verifyWebhookSignature({
      secret: endpoint.secret,
      timestamp: capTandaTangan,
      body: badanTandaTangan,
      signature: signWebhookPayload(endpoint.secret, capTandaTangan, badanTandaTangan),
      now: capTandaTangan,
    }),
    "DITOLAK — skema tanda tangan tidak konsisten",
  );
  check(
    "badan yang diubah membuat tanda tangan tidak lagi cocok",
    !verifyWebhookSignature({
      secret: endpoint.secret,
      timestamp: capTandaTangan,
      body: badanLain,
      signature: signWebhookPayload(endpoint.secret, capTandaTangan, badanTandaTangan),
      now: capTandaTangan,
    }),
    "DITERIMA — tanda tangan berlaku untuk badan lain",
  );
  check(
    "rahasia lain tidak bisa memalsukan tanda tangan",
    !verifyWebhookSignature({
      secret: `${endpoint.secret}x`,
      timestamp: capTandaTangan,
      body: badanTandaTangan,
      signature: signWebhookPayload(endpoint.secret, capTandaTangan, badanTandaTangan),
      now: capTandaTangan,
    }),
    "DITERIMA — tanda tangan bisa dipalsukan dengan rahasia lain",
  );

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.apiAccess.createEndpoint, {
        tenantId,
        actorId: userId,
        url: "https://tidak-ada.mesinpos.invalid/hook",
        events: ["sale.completed"],
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "URL endpoint kembar ditolak",
      blocked && message.includes("sudah terdaftar"),
      message || "DITERIMA — endpoint kembar dibuat",
    );
  }

  const kiriman = await client.action(api.apiAccess.testEndpoint, {
    tenantId,
    actorId: userId,
    endpointId: endpoint.endpointId,
  });
  check(
    "kiriman uji ke host yang tidak ada tercatat sebagai percobaan",
    kiriman.attempts === 1 &&
      kiriman.event === "sale.completed" &&
      (kiriman.status === "pending" || kiriman.status === "failed") &&
      kiriman.error !== null,
    JSON.stringify(kiriman),
  );
  const setelahKiriman = await client.query(api.apiAccess.overview, {
    tenantId,
    actorId: userId,
  });
  check(
    "riwayat kiriman menyimpan galat & jadwal percobaan berikutnya",
    setelahKiriman.deliveries.length === 1 &&
      setelahKiriman.deliveries[0].attempts === 1 &&
      setelahKiriman.deliveries[0].lastError !== null &&
      setelahKiriman.summary.pendingDeliveries === 1,
    JSON.stringify(setelahKiriman.deliveries[0]),
  );

  await client.mutation(api.apiAccess.updateEndpoint, {
    tenantId,
    actorId: userId,
    endpointId: endpoint.endpointId,
    active: false,
  });
  {
    let blocked = false;
    let message = "";
    try {
      await client.action(api.apiAccess.testEndpoint, {
        tenantId,
        actorId: userId,
        endpointId: endpoint.endpointId,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "endpoint nonaktif menolak kiriman uji",
      blocked && message.includes("nonaktif"),
      message || "DITERIMA — endpoint nonaktif masih dikirimi",
    );
  }

  const dihapus = await client.mutation(api.apiAccess.removeEndpoint, {
    tenantId,
    actorId: userId,
    endpointId: endpoint.endpointId,
  });
  const setelahDihapus = await client.query(api.apiAccess.overview, {
    tenantId,
    actorId: userId,
  });
  check(
    "hapus endpoint membuang riwayat kirimannya",
    dihapus.removedDeliveries === 1 &&
      setelahDihapus.endpoints.length === 0 &&
      setelahDihapus.deliveries.length === 0,
    JSON.stringify({ dihapus: dihapus.removedDeliveries, sisa: setelahDihapus.deliveries.length }),
  );

  // --------------- Phase 5: dukungan khusus (`support.dedicated`) ---------
  // Alur ujung ke ujung: pemilik membuka tiket berprioritas jalur cepat, tiket
  // itu benar-benar berjalan (mulai → catatan → tutup → buka ulang), janji
  // tanggapnya **dipatok** di baris tiket, dan gerbangnya nyata: paket turun
  // menolak prioritas jalur cepat & eskalasi, tetapi tidak mengunci tiket yang
  // sudah berjalan.
  await client.mutation(api.users.createOrGet, {
    email: `finance+${runId}@mesinpos.test`,
    name: "Keuangan Uji",
  });
  const { userId: financeId } = await client.mutation(api.members.add, {
    tenantId,
    actorId: userId,
    email: `finance+${runId}@mesinpos.test`,
    name: "Keuangan Uji",
    role: "finance",
  });

  const tiketAwal = await client.query(api.support.list, { tenantId, actorId: userId });
  check(
    "tenant ini belum punya tiket dukungan",
    tiketAwal.tickets.length === 0 &&
      tiketAwal.summary.open === 0 &&
      tiketAwal.plan.dedicated === true,
    JSON.stringify(tiketAwal.summary),
  );
  check(
    "janji dukungan Enterprise: kanal langsung + manajer akun, dasar 8 jam",
    tiketAwal.plan.accountManager === true &&
      tiketAwal.plan.responseHours === 8 &&
      tiketAwal.plan.channel.includes("manajer akun"),
    JSON.stringify(tiketAwal.plan),
  );
  check(
    "batas tiket berjalan & panjang riwayat dilaporkan server",
    tiketAwal.limits.maxOpenTickets === 25 && tiketAwal.limits.maxLog === 60,
    JSON.stringify(tiketAwal.limits),
  );

  const tiket = await client.mutation(api.support.create, {
    tenantId,
    actorId: userId,
    subject: "  Struk  Bluetooth terputus saat transaksi  ",
    category: "bug",
    priority: "urgent",
    body: "Printer memutus sambungan di transaksi ke-12 dan struk keluar setengah.",
  });
  check(
    "tiket baru bernomor urut & janji Mendesak = 2 jam (8 jam × pengali prioritas)",
    /^TKT-\d{4}-\d{4}$/.test(tiket.number) && tiket.slaHours === 2,
    JSON.stringify(tiket),
  );

  let daftarTiket = await client.query(api.support.list, { tenantId, actorId: userId });
  check(
    "tiket tersimpan dengan status, riwayat awal, dan status SLA-nya",
    daftarTiket.tickets.length === 1 &&
      daftarTiket.tickets[0].status === "open" &&
      daftarTiket.tickets[0].log.length === 1 &&
      daftarTiket.tickets[0].slaState === "on_track" &&
      daftarTiket.tickets[0].escalated === false,
    JSON.stringify(daftarTiket.tickets[0]),
  );
  check(
    "subjek disimpan sudah dirapikan (spasi ganda & pinggir hilang)",
    daftarTiket.tickets[0].subject === "Struk Bluetooth terputus saat transaksi",
    daftarTiket.tickets[0].subject,
  );

  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.support.create, {
        tenantId,
        actorId: userId,
        subject: "ak",
        category: "bug",
        priority: "normal",
        body: "Isi tiket yang cukup panjang untuk lolos validasi.",
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "subjek yang terlalu pendek ditolak",
      blocked && message.includes("Subjek harus"),
      message || "DITERIMA — validasi subjek bocor",
    );
  }

  // Keuangan **melihat** tiket (banyak tiket soal tagihan), kasir tidak —
  // sementara yang membuka & menutup tetap pemilik/manajer.
  const tiketKeuangan = await client.query(api.support.list, { tenantId, actorId: financeId });
  check(
    "keuangan boleh melihat tiket (support.view) beserta SLA-nya",
    tiketKeuangan.tickets.length === 1 && tiketKeuangan.tickets[0].slaHours === 2,
    JSON.stringify(tiketKeuangan.tickets.length),
  );
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.support.create, {
        tenantId,
        actorId: financeId,
        subject: "Tiket dari keuangan",
        category: "payment",
        priority: "normal",
        body: "Keuangan mencoba membuka tiket sendiri dari harness.",
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "keuangan tidak boleh membuka tiket (support.manage)",
      blocked && message.includes("support.manage"),
      message || "DITERIMA — keuangan bisa membuka tiket",
    );
  }
  {
    let blocked = false;
    let message = "";
    try {
      await client.query(api.support.list, { tenantId, actorId: cashierId });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "kasir tidak melihat tiket dukungan sama sekali",
      blocked && message.includes("support.view"),
      message || "DITERIMA — kasir membaca tiket",
    );
  }

  // Alur tiket: mulai ditangani → catatan → eskalasi → ditutup → dibuka ulang.
  await client.mutation(api.support.act, {
    tenantId,
    actorId: userId,
    ticketId: tiket.ticketId,
    action: "start",
  });
  await client.mutation(api.support.act, {
    tenantId,
    actorId: userId,
    ticketId: tiket.ticketId,
    action: "note",
    note: "Sudah dicek bersama tim kasir cabang.",
  });
  await client.mutation(api.support.act, {
    tenantId,
    actorId: userId,
    ticketId: tiket.ticketId,
    action: "escalate",
  });
  daftarTiket = await client.query(api.support.list, { tenantId, actorId: userId });
  check(
    "mulai + catatan + eskalasi mengubah tiket & menambah riwayatnya",
    daftarTiket.tickets[0].status === "in_progress" &&
      daftarTiket.tickets[0].escalated === true &&
      daftarTiket.tickets[0].log.length === 4 &&
      daftarTiket.tickets[0].log.some((entry) => entry.body.includes("manajer akun")),
    JSON.stringify(daftarTiket.tickets[0].log.map((entry) => entry.body)),
  );
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.support.act, {
        tenantId,
        actorId: userId,
        ticketId: tiket.ticketId,
        action: "resolve",
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "menutup tiket tanpa keterangan penyelesaian ditolak",
      blocked && message.includes("penyelesaiannya"),
      message || "DITERIMA — tiket bisa ditutup tanpa keterangan",
    );
  }
  const tiketDitutup = await client.mutation(api.support.act, {
    tenantId,
    actorId: userId,
    ticketId: tiket.ticketId,
    action: "resolve",
    note: "Kabel printer diganti, sudah diuji 10 transaksi.",
  });
  check(
    "menutup tiket menyimpan waktu selesai",
    tiketDitutup.status === "resolved" && tiketDitutup.resolvedAt !== null,
    JSON.stringify(tiketDitutup),
  );
  await client.mutation(api.support.act, {
    tenantId,
    actorId: userId,
    ticketId: tiket.ticketId,
    action: "reopen",
    note: "Muncul lagi setelah 10 menit.",
  });
  daftarTiket = await client.query(api.support.list, { tenantId, actorId: userId });
  check(
    "buka ulang mengembalikan tiket ke antrean & mencatat alasannya",
    daftarTiket.tickets[0].status === "open" &&
      daftarTiket.tickets[0].resolvedAt === null &&
      daftarTiket.tickets[0].log.some((entry) => entry.body.includes("Muncul lagi")),
    JSON.stringify(daftarTiket.tickets[0].log.map((entry) => entry.kind)),
  );

  // Gerbang fitur: paket turun menghentikan jalur cepat, bukan tiketnya.
  await client.mutation(api.billing.changePlan, {
    tenantId,
    newPlanKey: "professional",
    actorId: userId,
  });
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.support.create, {
        tenantId,
        actorId: userId,
        subject: "Prioritas jalur cepat tanpa fiturnya",
        category: "bug",
        priority: "urgent",
        body: "Harness mencoba jalur cepat setelah paket turun ke Professional.",
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "paket turun menolak prioritas jalur cepat (Mendesak)",
      blocked && message.includes("dukungan khusus"),
      message || "DITERIMA — jalur cepat tetap bisa dipakai tanpa fiturnya",
    );
  }
  const tiketBiasa = await client.mutation(api.support.create, {
    tenantId,
    actorId: userId,
    subject: "Pertanyaan harga setelah paket turun",
    category: "howto",
    priority: "normal",
    body: "Prioritas Normal harus tetap bisa dipakai tanpa fitur dukungan khusus.",
  });
  check(
    "prioritas Normal tetap bisa dibuka tanpa fiturnya (24 jam di Professional)",
    /^TKT-\d{4}-\d{4}$/.test(tiketBiasa.number) && tiketBiasa.slaHours === 24,
    JSON.stringify(tiketBiasa),
  );
  {
    let blocked = false;
    let message = "";
    try {
      await client.mutation(api.support.act, {
        tenantId,
        actorId: userId,
        ticketId: tiketBiasa.ticketId,
        action: "escalate",
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "eskalasi ke manajer akun ditolak tanpa fiturnya",
      blocked && message.includes("tidak termasuk paket"),
      message || "DITERIMA — eskalasi lolos tanpa fiturnya",
    );
  }
  daftarTiket = await client.query(api.support.list, { tenantId, actorId: userId });
  check(
    "janji tanggap tiket lama tidak berubah saat paket turun (dipatok saat dibuat)",
    daftarTiket.tickets.find((row) => row.number === tiket.number)?.slaHours === 2 &&
      daftarTiket.tickets.find((row) => row.number === tiket.number)?.planKeyAtCreation === "enterprise",
    JSON.stringify(
      daftarTiket.tickets.map((row) => [row.number, row.slaHours, row.planKeyAtCreation]),
    ),
  );
  await client.mutation(api.support.act, {
    tenantId,
    actorId: userId,
    ticketId: tiketBiasa.ticketId,
    action: "resolve",
    note: "Dijawab lewat email prioritas.",
  });
  check(
    "menutup tiket selalu boleh walau paket sudah turun",
    (await client.query(api.support.list, { tenantId, actorId: userId })).summary.resolved === 1,
    "DITERIMA — tiket lama terkunci setelah paket turun",
  );
  await client.mutation(api.billing.changePlan, {
    tenantId,
    newPlanKey: "enterprise",
    actorId: userId,
  });

  // ----------- Phase 5: optimasi beban skala franchise (`scale.franchise`) ---
  // Laporan lintas cabang adalah satu-satunya laporan yang tumbuh mengikuti
  // ukuran pelanggan, jadi yang diuji di sini bukan hanya angkanya: anggaran
  // per cabang harus dilaporkan apa adanya, angkanya harus sama dengan laporan
  // biasa pada jendela yang sama, gerbang fiturnya harus nyata, dan tenant lain
  // tidak boleh bocor ke dalamnya.
  const franchise = await client.query(api.reports.franchise, {
    tenantId,
    actorId: userId,
    days: 30,
    timezoneOffsetMinutes: 0,
  });
  check(
    "laporan lintas cabang memuat cabang tenant ini & tanpa pemotongan",
    franchise.outlets.length === 1 &&
      franchise.totals.activeOutlets === 1 &&
      franchise.totals.inactiveOutlets === 0 &&
      franchise.beyondWindow === 0 &&
      franchise.skippedOutlets === 0 &&
      franchise.truncated === false,
    JSON.stringify({ totals: franchise.totals, budget: franchise.budget }),
  );
  check(
    "anggaran query dibagi per cabang (1 cabang → 600 baris terbaru)",
    franchise.budget.stores === 1 &&
      franchise.budget.rowsPerStore === 600 &&
      franchise.budget.maxRows === 600,
    JSON.stringify(franchise.budget),
  );
  check(
    "pangsa cabang tunggal = 100%",
    franchise.outlets[0].sharePct === 100,
    String(franchise.outlets[0].sharePct),
  );
  const harianJendela = await client.query(api.reports.dailySummary, {
    tenantId,
    storeId,
    actorId: userId,
    from: franchise.window.from,
    to: franchise.window.to,
  });
  check(
    "omzet & transaksi lintas cabang sama dengan laporan pada jendela yang sama",
    franchise.totals.revenue === harianJendela.revenue &&
      franchise.totals.transactions === harianJendela.transactions,
    JSON.stringify({ franchise: franchise.totals, harian: harianJendela }),
  );
  check(
    "transaksi terbesar jaringan terurut menurun",
    franchise.topSales.length > 0 &&
      franchise.topSales.every((row, index) => index === 0 || row.total <= franchise.topSales[index - 1].total),
    JSON.stringify(franchise.topSales.map((row) => row.total)),
  );
  const franchiseBatas = await client.query(api.reports.franchise, {
    tenantId,
    actorId: userId,
    days: 500,
    timezoneOffsetMinutes: 0,
  });
  check(
    "permintaan 500 hari dipotong ke batas 90 hari",
    franchiseBatas.days === 90,
    String(franchiseBatas.days),
  );
  {
    let blocked = false;
    let message = "";
    try {
      await client.query(api.reports.franchise, { tenantId, actorId: outsiderId });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "pengguna luar ditolak membaca laporan lintas cabang",
      blocked && message.includes("bukan anggota aktif"),
      message || "DITERIMA — pengguna luar membaca laporan lintas cabang",
    );
  }

  // Isolasi tenant: tenant kedua dengan penjualannya sendiri tidak boleh ikut
  // terhitung — dan sebaliknya, laporan tenant ini tidak berubah karenanya.
  const jaringan = await client.mutation(api.tenants.create, {
    ownerId: userId,
    name: "Jaringan Uji",
    slug: `verify-franchise-${runId}`,
    planKey: "enterprise",
    storeName: "Cabang Jaringan",
    verticals: ["umkm"],
  });
  const { productId: kopiJaringan } = await client.mutation(api.products.create, {
    tenantId: jaringan.tenantId,
    storeId: jaringan.storeId,
    sku: `KOPI-B-${runId}`,
    name: "Kopi Jaringan",
    price: 30000,
    openingStock: 5,
    actorId: userId,
  });
  const saleJaringan = await client.mutation(api.pos.createSale, {
    tenantId: jaringan.tenantId,
    storeId: jaringan.storeId,
    items: [{ productId: kopiJaringan, quantity: 2 }],
    payments: [{ method: "cash", amount: 66600 }],
    idempotencyKey: `sale-jaringan-${runId}`,
    cashierId: userId,
  });
  const franchiseJaringan = await client.query(api.reports.franchise, {
    tenantId: jaringan.tenantId,
    actorId: userId,
    days: 30,
    timezoneOffsetMinutes: 0,
  });
  check(
    "laporan tenant lain hanya memuat penjualan tenant itu",
    franchiseJaringan.outlets.length === 1 &&
      franchiseJaringan.outlets[0].revenue === saleJaringan.total &&
      franchiseJaringan.totals.revenue === saleJaringan.total,
    JSON.stringify({ laporan: franchiseJaringan.totals.revenue, sale: saleJaringan.total }),
  );
  const franchiseSesudah = await client.query(api.reports.franchise, {
    tenantId,
    actorId: userId,
    days: 30,
    timezoneOffsetMinutes: 0,
  });
  check(
    "penjualan tenant lain tidak masuk ke laporan tenant ini (isolasi)",
    franchiseSesudah.totals.revenue === franchise.totals.revenue &&
      franchiseSesudah.totals.transactions === franchise.totals.transactions,
    JSON.stringify({ sebelum: franchise.totals, sesudah: franchiseSesudah.totals }),
  );

  {
    let blocked = false;
    let message = "";
    await client.mutation(api.billing.changePlan, {
      tenantId,
      newPlanKey: "professional",
      actorId: userId,
    });
    try {
      await client.query(api.reports.franchise, {
        tenantId,
        actorId: userId,
        days: 30,
        timezoneOffsetMinutes: 0,
      });
    } catch (error) {
      blocked = true;
      message = error?.message ?? String(error);
    }
    check(
      "paket turun menutup laporan lintas cabang (gerbang fitur)",
      blocked && message.includes("tidak termasuk paket"),
      message || "DITERIMA — laporan lintas cabang lolos tanpa fiturnya",
    );
    await client.mutation(api.billing.changePlan, {
      tenantId,
      newPlanKey: "enterprise",
      actorId: userId,
    });
  }
  // Peran yang memang memegang `report.view` boleh membacanya — di sini
  // keuangan, yang tidak dipindah ke peran kustom mana pun.
  const franchiseKeuangan = await client.query(api.reports.franchise, {
    tenantId,
    actorId: financeId,
    days: 30,
    timezoneOffsetMinutes: 0,
  });
  check(
    "peran dengan report.view (keuangan) boleh membaca laporan lintas cabang",
    franchiseKeuangan.totals.revenue === franchise.totals.revenue,
    JSON.stringify(franchiseKeuangan.totals),
  );

  // --------------- Phase 6: pembayaran digital (`payment.digital`) ---------
  // Alur ujung ke ujung: kasir menagih lewat QRIS/VA, tenggatnya **dipatok** di
  // baris tagihan, pelunasan harus pas, dan tagihan yang sudah lunas tidak bisa
  // dibatalkan. Gerbangnya nyata: paket turun menolak tagihan baru, tetapi
  // pelunasan & pembatalan tagihan lama tetap jalan supaya uang pelanggan tidak
  // terkunci.
  {
    const awal = await client.query(api.payments.list, { tenantId, actorId: userId });
    check(
      "pembayaran digital hidup di paket Enterprise",
      awal.plan.digital === true && awal.summary.pending === 0,
      JSON.stringify({ plan: awal.plan, pending: awal.summary.pending }),
    );
    // Kasir di sini memakai peran kustom dari bagian RBAC, jadi yang diperiksa
    // adalah keuangan (payment.view) dan pengguna luar (ditolak).
    const izinKeuangan = await client
      .query(api.payments.list, { tenantId, actorId: financeId })
      .then(() => true)
      .catch(() => false);
    const izinLuar = await client
      .query(api.payments.list, { tenantId, actorId: outsiderId })
      .then(() => true)
      .catch(() => false);
    check(
      "izin `payment.view` dimiliki keuangan & pengguna luar ditolak",
      izinKeuangan && !izinLuar,
      JSON.stringify({ izinKeuangan, izinLuar }),
    );

    const qris = await client.mutation(api.payments.create, {
      tenantId,
      actorId: userId,
      amount: 47_000,
      method: "qris",
      reference: "Meja 4",
    });
    check(
      "tagihan QRIS dibuat dengan nomor & tenggat yang ditetapkan server",
      /^DIG-\d{4}-\d{4}$/.test(qris.number) &&
        qris.expiryMinutes === 5 &&
        qris.expiresAt > Date.now() &&
        qris.expiresAt - Date.now() <= 6 * 60 * 1000,
      JSON.stringify(qris),
    );
    let daftar = await client.query(api.payments.list, { tenantId, actorId: userId });
    const barisQris = daftar.charges.find((row) => row.number === qris.number);
    check(
      "tagihan QRIS menyimpan payload QRIS & tidak punya nomor VA",
      barisQris && barisQris.status === "pending" && barisQris.qrPayload !== null && barisQris.vaNumber === null,
      JSON.stringify(barisQris),
    );

    const va = await client.mutation(api.payments.create, {
      tenantId,
      actorId: financeId,
      amount: 1_250_000,
      method: "va",
      bank: "bca",
    });
    daftar = await client.query(api.payments.list, { tenantId, actorId: userId });
    const barisVa = daftar.charges.find((row) => row.number === va.number);
    check(
      "tagihan VA memakai nomor berawalan bank penerbitnya",
      barisVa && barisVa.bank === "bca" && /^8808\d{8}$/.test(barisVa.vaNumber ?? ""),
      JSON.stringify(barisVa?.vaNumber),
    );
    check(
      "ringkasan memisahkan nominal menunggu & sudah masuk",
      daftar.summary.pending === 2 && daftar.summary.pendingAmount === 1_297_000,
      JSON.stringify(daftar.summary),
    );

    {
      let blocked = false;
      let message = "";
      try {
        await client.mutation(api.payments.act, {
          tenantId,
          actorId: userId,
          chargeId: barisQris.id,
          action: "settle",
          amount: 40_000,
        });
      } catch (error) {
        blocked = true;
        message = error?.message ?? String(error);
      }
      check(
        "pelunasan dengan nominal berbeda ditolak",
        blocked && message.includes("sama dengan nominal tagihan"),
        message || "DITERIMA — nominal pelunasan yang salah diterima",
      );
    }

    await client.mutation(api.payments.act, {
      tenantId,
      actorId: userId,
      chargeId: barisQris.id,
      action: "settle",
      amount: 47_000,
    });
    daftar = await client.query(api.payments.list, { tenantId, actorId: userId });
    const qrisLunas = daftar.charges.find((row) => row.id === barisQris.id);
    check(
      "tagihan yang dilunasi menyimpan nominal & waktu masuknya",
      qrisLunas.status === "paid" && qrisLunas.paidAmount === 47_000 && qrisLunas.paidAt !== null,
      JSON.stringify(qrisLunas),
    );
    check(
      "ringkasan memindahkan nominal dari menunggu ke sudah masuk",
      // Empat tagihan lunas di tenant ini: QRIS 47.000 dari bagian ini, tagihan
      // pesanan QR meja (26.640), tagihan Virtual Account pesanan meja (13.320),
      // dan tagihan pesanan QR yang sengaja dilunasi untuk menguji pagar
      // pembatalan tamu — tiga yang terakhir dari bagian F&B di atas. Tagihan
      // pesanan yang dibatalkan tamunya **tidak** ikut menghitung ke nominal
      // masuk, karena uangnya memang tidak pernah masuk.
      daftar.summary.pending === 1 &&
        daftar.summary.paid === 4 &&
        daftar.summary.paidAmount === 47_000 + 26_640 + 13_320 + pesananLunasQr.total,
      JSON.stringify(daftar.summary),
    );
    {
      let blocked = false;
      let message = "";
      try {
        await client.mutation(api.payments.act, {
          tenantId,
          actorId: userId,
          chargeId: barisQris.id,
          action: "cancel",
        });
      } catch (error) {
        blocked = true;
        message = error?.message ?? String(error);
      }
      check(
        "tagihan yang sudah lunas tidak bisa dibatalkan",
        blocked && message.includes("sudah lunas"),
        message || "DITERIMA — uang yang masuk dibalik",
      );
    }

    // Gerbang fitur: paket Starter menolak tagihan baru, tetapi tagihan yang
    // masih menunggu tetap bisa dilunasi & tagihan lama tetap bisa dibatalkan.
    await client.mutation(api.billing.changePlan, {
      tenantId,
      newPlanKey: "starter",
      actorId: userId,
    });
    {
      let blocked = false;
      let message = "";
      try {
        await client.mutation(api.payments.create, {
          tenantId,
          actorId: userId,
          amount: 47_000,
          method: "qris",
        });
      } catch (error) {
        blocked = true;
        message = error?.message ?? String(error);
      }
      check(
        "paket turun menutup pembuatan tagihan digital (gerbang fitur)",
        blocked && message.includes("tidak termasuk paket"),
        message || "DITERIMA — tagihan baru lolos tanpa fiturnya",
      );
    }
    const lunasSetelahTurun = await client.mutation(api.payments.act, {
      tenantId,
      actorId: financeId,
      chargeId: barisVa.id,
      action: "settle",
      amount: 1_250_000,
    });
    check(
      "paket turun tidak mengunci pelunasan tagihan yang masih berjalan",
      lunasSetelahTurun.status === "paid" && lunasSetelahTurun.paidAmount === 1_250_000,
      JSON.stringify(lunasSetelahTurun),
    );
    const daftarTurun = await client.query(api.payments.list, { tenantId, actorId: userId });
    check(
      "daftar tagihan tetap terbaca setelah paket turun",
      // Delapan tagihan tenant ini: QRIS 47.000, VA 1,25 juta, tagihan QR meja
      // 26.640, tagihan Virtual Account pesanan meja 13.320, tiga tagihan
      // pesanan QR dari blok pembatalan tamu (dua dibatalkan tamunya, satu
      // dilunasi), dan satu tagihan pesanan QR yang dibatalkan **kasir** dari
      // halaman Pembayaran (uji pagar hapus meja) — semuanya tetap terbaca walau
      // paketnya turun.
      daftarTurun.charges.length === 8 && daftarTurun.plan.digital === false,
      JSON.stringify({ charges: daftarTurun.charges.length, digital: daftarTurun.plan.digital }),
    );
    await client.mutation(api.billing.changePlan, {
      tenantId,
      newPlanKey: "enterprise",
      actorId: userId,
    });
  }

  // ------- Phase 6: kasir menagih QRIS dari keranjang (`payment.digital`) ---
  // Sambungan meja kasir: tagihan diterbitkan dari keranjang, lalu penjualannya
  // menunjuk tagihan itu. Yang diperiksa bukan cuma jalur bahagianya — tagihan
  // yang belum lunas, nominal yang meleset, metode yang tidak cocok, dan tagihan
  // milik tenant lain semuanya harus ditolak, dan setiap penolakan terjadi
  // **sebelum** apa pun tersimpan.
  {
    const totalKeranjang = 24_420; // 1 × 22.000 + PPN 11%
    const keranjang = [{ productId: kopiId, quantity: 1 }];
    const posCharge = await client.mutation(api.payments.create, {
      tenantId,
      actorId: userId,
      amount: totalKeranjang,
      method: "qris",
      reference: "POS · 1 baris · 1 item · 1× Kopi Susu Gula Aren",
    });
    check(
      "tagihan kasir terbit dari keranjang dengan nomor & tenggat server",
      /^DIG-\d{4}-\d{4}$/.test(posCharge.number) &&
        posCharge.expiryMinutes === 5 &&
        typeof posCharge.chargeId === "string",
      JSON.stringify(posCharge),
    );

    const stokSebelum = (
      await client.query(api.products.listByStore, { tenantId, storeId, actorId: userId })
    ).find((product) => product._id === kopiId)?.stock;

    let belumLunas = "";
    try {
      await client.mutation(api.pos.createSale, {
        tenantId,
        storeId,
        cashierId: userId,
        items: keranjang,
        payments: [{ method: "qris", amount: totalKeranjang }],
        idempotencyKey: `pos-charge-unpaid-${runId}`,
        digitalChargeId: posCharge.chargeId,
      });
    } catch (error) {
      belumLunas = error?.message ?? String(error);
    }
    check(
      "penjualan yang menunjuk tagihan belum lunas ditolak",
      belumLunas.includes("Menunggu pembayaran"),
      belumLunas || "DITERIMA — penjualan mendahului uangnya",
    );

    await client.mutation(api.payments.act, {
      tenantId,
      actorId: userId,
      chargeId: posCharge.chargeId,
      action: "settle",
      amount: totalKeranjang,
    });

    let nominalBeda = "";
    try {
      await client.mutation(api.pos.createSale, {
        tenantId,
        storeId,
        cashierId: userId,
        items: [{ productId: kopiId, quantity: 2 }],
        payments: [{ method: "qris", amount: 48_840 }],
        idempotencyKey: `pos-charge-amount-${runId}`,
        digitalChargeId: posCharge.chargeId,
      });
    } catch (error) {
      nominalBeda = error?.message ?? String(error);
    }
    check(
      "total penjualan yang berbeda dari tagihannya ditolak & menyebut kedua angka",
      nominalBeda.includes("24.420") && nominalBeda.includes("48.840"),
      nominalBeda || "DITERIMA — nota dan tagihan berbeda nominal",
    );

    let metodeBeda = "";
    try {
      await client.mutation(api.pos.createSale, {
        tenantId,
        storeId,
        cashierId: userId,
        items: keranjang,
        payments: [{ method: "cash", amount: totalKeranjang }],
        idempotencyKey: `pos-charge-method-${runId}`,
        digitalChargeId: posCharge.chargeId,
      });
    } catch (error) {
      metodeBeda = error?.message ?? String(error);
    }
    check(
      "metode pembayaran penjualan harus cocok dengan metode tagihannya",
      metodeBeda.includes("cash"),
      metodeBeda || "DITERIMA — tunai menutup tagihan QRIS",
    );

    let tenantLain = "";
    try {
      await client.mutation(api.pos.createSale, {
        tenantId: jaringan.tenantId,
        storeId: jaringan.storeId,
        cashierId: userId,
        items: [{ productId: kopiJaringan, quantity: 1 }],
        payments: [{ method: "qris", amount: 33_300 }],
        idempotencyKey: `pos-charge-cross-${runId}`,
        digitalChargeId: posCharge.chargeId,
      });
    } catch (error) {
      tenantLain = error?.message ?? String(error);
    }
    check(
      "tagihan tenant lain tidak bisa dipakai menutup penjualan",
      tenantLain.includes("tidak ditemukan untuk tenant ini"),
      tenantLain || "DITERIMA — tagihan lintas tenant",
    );

    const kasirSale = await client.mutation(api.pos.createSale, {
      tenantId,
      storeId,
      cashierId: userId,
      items: keranjang,
      payments: [{ method: "qris", amount: totalKeranjang }],
      idempotencyKey: `pos-charge-${runId}`,
      digitalChargeId: posCharge.chargeId,
    });
    check(
      "penjualan QRIS dari keranjang dicatat sebesar tagihannya",
      kasirSale.total === totalKeranjang && kasirSale.saleId !== undefined,
      JSON.stringify(kasirSale),
    );

    const daftarKasir = await client.query(api.payments.list, {
      tenantId,
      actorId: userId,
    });
    const tagihanKasir = daftarKasir.charges.find((row) => row.id === posCharge.chargeId);
    check(
      "tagihan menunjuk balik ke nota yang dilunasinya",
      tagihanKasir.status === "paid" && tagihanKasir.saleNumber === kasirSale.number,
      JSON.stringify({
        status: tagihanKasir.status,
        saleNumber: tagihanKasir.saleNumber,
        nota: kasirSale.number,
      }),
    );

    const stokSesudah = (
      await client.query(api.products.listByStore, { tenantId, storeId, actorId: userId })
    ).find((product) => product._id === kopiId)?.stock;
    check(
      "penolakan tidak menyimpan apa pun: stok hanya berkurang dari penjualan yang diterima",
      stokSesudah === stokSebelum - 1,
      `sebelum=${stokSebelum} sesudah=${stokSesudah}`,
    );
  }

  // ------------- Phase 6: sinkronisasi real-time (`sync.realtime`) ---------
  // Hub perangkat: kehadiran diturunkan dari detak, revisi naik satu-satu, dan
  // konflik diselesaikan deterministik. Gerbangnya nyata: paket turun menutup
  // pendaftaran perangkat & dorongan baru, tetapi detak, tarikan, dan penandaan
  // konflik tetap jalan.
  {
    const papanAwal = await client.query(api.sync.board, { tenantId, actorId: userId });
    check(
      "sinkronisasi real-time hidup di paket Enterprise",
      papanAwal.plan.realtime === true && Array.isArray(papanAwal.devices),
      JSON.stringify(papanAwal.plan),
    );

    const perangkat = await client.mutation(api.sync.register, {
      tenantId,
      actorId: userId,
      label: "Kasir Uji Backend",
      platform: "android",
      fingerprint: `fp-verify-${runId}`,
    });
    await client.mutation(api.sync.heartbeat, {
      tenantId,
      actorId: cashierId,
      deviceId: perangkat.deviceId,
    });
    const papan = await client.query(api.sync.board, { tenantId, actorId: userId });
    const baris = papan.devices.find((row) => row.fingerprint === `fp-verify-${runId}`);
    check(
      "perangkat terdaftar muncul dengan kehadiran online setelah mendetak",
      baris && baris.presence === "online" && baris.platform === "android",
      JSON.stringify(baris),
    );

    const diterima = await client.mutation(api.sync.push, {
      tenantId,
      actorId: userId,
      deviceFingerprint: `fp-verify-${runId}`,
      deviceName: "Kasir Uji Backend",
      platform: "android",
      entity: "stock",
      entityId: "p05",
      baseRevision: 0,
      updatedAt: Date.now(),
      payload: '{"stock":"18"}',
    });
    check(
      "dorongan pertama pada entitas baru diterima & menaikkan revisi",
      diterima.outcome === "applied" && diterima.revision === 1,
      JSON.stringify(diterima),
    );

    const disesuaikan = await client.mutation(api.sync.push, {
      tenantId,
      actorId: userId,
      deviceFingerprint: `fp-verify-${runId}`,
      deviceName: "Kasir Uji Backend",
      platform: "android",
      entity: "stock",
      entityId: "p05",
      baseRevision: 0,
      updatedAt: Date.now() + 1000,
      payload: '{"stock":"17"}',
    });
    check(
      "dorongan di atas basis basi diselesaikan last-write-wins (versi lokal menang)",
      disesuaikan.outcome === "rebased" && disesuaikan.revision === 2 && disesuaikan.reason !== null,
      JSON.stringify(disesuaikan),
    );
    const ditolak = await client.mutation(api.sync.push, {
      tenantId,
      actorId: userId,
      deviceFingerprint: "fp-perangkat-lain",
      deviceName: "Tablet Lain",
      platform: "web",
      entity: "stock",
      entityId: "p05",
      baseRevision: 0,
      updatedAt: Date.now() - 60_000,
      payload: '{"stock":"16"}',
    });
    check(
      "konflik dengan versi lokal lebih lama ditolak (versi server dipertahankan)",
      ditolak.outcome === "rejected" && ditolak.revision === 3,
      JSON.stringify(ditolak),
    );
    const melenceng = await client.mutation(api.sync.push, {
      tenantId,
      actorId: userId,
      deviceFingerprint: `fp-verify-${runId}`,
      deviceName: "Kasir Uji Backend",
      platform: "android",
      entity: "stock",
      entityId: "p05",
      baseRevision: 3,
      updatedAt: Date.now() + 60 * 60 * 1000,
      payload: "{}",
    });
    check(
      "jam perangkat yang melenceng ditolak dengan alasan yang menyebut detiknya",
      melenceng.outcome === "rejected" && /detik/.test(melenceng.reason ?? ""),
      JSON.stringify(melenceng),
    );

    const tarikPertama = await client.query(api.sync.changes, {
      tenantId,
      actorId: userId,
      cursor: 0,
      limit: 2,
    });
    check(
      "satu giliran tarik mengambil tepat satu jendela dan menunjuk kursor berikutnya",
      tarikPertama.items.length === 2 && tarikPertama.nextCursor === 2 && tarikPertama.hasMore === true,
      JSON.stringify({ length: tarikPertama.items.length, next: tarikPertama.nextCursor }),
    );
    const tarikKedua = await client.query(api.sync.changes, {
      tenantId,
      actorId: userId,
      cursor: tarikPertama.nextCursor,
      limit: 2,
    });
    check(
      "giliran berikutnya melanjutkan tepat setelah kursor",
      tarikKedua.items.length === 2 &&
        tarikKedua.items[0].revision === 3 &&
        tarikKedua.hasMore === false,
      JSON.stringify({ first: tarikKedua.items[0]?.revision, hasMore: tarikKedua.hasMore }),
    );

    const konflik = tarikKedua.items.find((row) => row.conflict);
    check(
      "perubahan hasil konflik tercatat sebagai konflik yang belum selesai",
      konflik && konflik.resolvedAt === null,
      JSON.stringify(konflik),
    );
    await client.mutation(api.sync.resolve, {
      tenantId,
      actorId: userId,
      changeId: konflik.id,
    });
    {
      let blocked = false;
      let message = "";
      try {
        await client.mutation(api.sync.resolve, {
          tenantId,
          actorId: userId,
          changeId: konflik.id,
        });
      } catch (error) {
        blocked = true;
        message = error?.message ?? String(error);
      }
      check(
        "konflik yang sudah ditandai selesai tidak bisa ditandai dua kali",
        blocked && message.includes("sudah ditandai"),
        message || "DITERIMA — penandaan ganda lolos",
      );
    }
    const ringkas = await client.query(api.sync.board, { tenantId, actorId: userId });
    check(
      "ringkasan hub melaporkan konflik yang sudah & belum selesai beserta revisi tertinggi",
      ringkas.summary.resolvedConflicts >= 1 && ringkas.summary.latestRevision >= 4,
      JSON.stringify(ringkas.summary),
    );

    // Gerbang fitur: paket Starter menutup pendaftaran & dorongan, tetapi detak,
    // tarikan, dan penandaan konflik tetap jalan.
    await client.mutation(api.billing.changePlan, {
      tenantId,
      newPlanKey: "starter",
      actorId: userId,
    });
    {
      let blocked = false;
      let message = "";
      try {
        await client.mutation(api.sync.push, {
          tenantId,
          actorId: userId,
          deviceFingerprint: `fp-verify-${runId}`,
          deviceName: "Kasir Uji Backend",
          platform: "android",
          entity: "stock",
          entityId: "p05",
          baseRevision: 4,
          updatedAt: Date.now(),
          payload: "{}",
        });
      } catch (error) {
        blocked = true;
        message = error?.message ?? String(error);
      }
      check(
        "paket turun menutup dorongan perubahan baru (gerbang fitur)",
        blocked && message.includes("tidak termasuk paket"),
        message || "DITERIMA — dorongan lolos tanpa fiturnya",
      );
    }
    await client.mutation(api.sync.heartbeat, {
      tenantId,
      actorId: cashierId,
      deviceId: perangkat.deviceId,
    });
    const tarikSetelahTurun = await client.query(api.sync.changes, {
      tenantId,
      actorId: userId,
      cursor: 0,
      limit: 10,
    });
    check(
      "paket turun tidak mengunci detak & tarikan perubahan",
      tarikSetelahTurun.items.length >= 4,
      JSON.stringify({ items: tarikSetelahTurun.items.length }),
    );
    {
      let blocked = false;
      let message = "";
      try {
        await client.query(api.sync.board, { tenantId, actorId: cashierId });
      } catch (error) {
        blocked = true;
        message = error?.message ?? String(error);
      }
      check(
        "kasir tidak boleh membuka hub perangkat (device.manage)",
        blocked && message.includes("device.manage"),
        message || "DITERIMA — kasir membuka hub",
      );
    }
    await client.mutation(api.billing.changePlan, {
      tenantId,
      newPlanKey: "enterprise",
      actorId: userId,
    });
  }

  // ------------- masuk tanpa kata sandi (`otp.auth`) ----------------------
  // Satu jalur untuk masuk **dan** daftar: kodenya dikirim ke email, dan akun
  // `users` dibuat saat kode itu terbukti benar. Yang diperiksa di sini adalah
  // perilaku deployment-nya (bukan aturan murninya — itu di scripts/verify-otp.mjs):
  // email tidak valid tidak pernah menghasilkan kode, permintaan kedua dalam 60
  // detik ditolak, dan kode yang benar benar-benar membentuk akun.
  {
    const kesiapan = await client.query(api.otp.status, {});
    check(
      "backend menyatakan aturan kode & kesiapan saluran email",
      kesiapan.codeLength === 6 &&
        kesiapan.ttlMinutes === 10 &&
        kesiapan.maxAttempts === 5 &&
        kesiapan.resendCooldownSeconds === 60 &&
        typeof kesiapan.emailConfigured === "boolean",
      JSON.stringify(kesiapan),
    );

    const emailSalahBentuk = await client.mutation(api.otp.requestCode, {
      email: "bukan-email",
    });
    check(
      "email tidak valid tidak pernah menghasilkan kode",
      emailSalahBentuk.ok === false &&
        String(emailSalahBentuk.reason).includes("nama@domain"),
      JSON.stringify(emailSalahBentuk),
    );
    const emailTanpaTitik = await client.mutation(api.otp.requestCode, {
      email: "budi@toko",
    });
    check(
      "domain tanpa titik ditolak dengan penjelasan",
      emailTanpaTitik.ok === false &&
        String(emailTanpaTitik.reason).includes("titik"),
      JSON.stringify(emailTanpaTitik),
    );

    // Email berdomain nyata: di sinilah gerbang saluran email terlihat. Tanpa
    // kunci penyedia email, permintaannya ditolak dengan jujur — bukan diklaim
    // "kode terkirim".
    const emailNyata = `uji-otp-${runId}@mesinpos.id`;
    const permintaanNyata = await client.mutation(api.otp.requestCode, {
      email: emailNyata,
    });
    if (kesiapan.emailConfigured) {
      check(
        "permintaan kode untuk email valid diterima saat saluran email siap",
        permintaanNyata.ok === true,
        JSON.stringify(permintaanNyata),
      );
      const permintaanKedua = await client.mutation(api.otp.requestCode, {
        email: emailNyata,
      });
      check(
        "kode kedua dalam 60 detik ditolak (satu kode hidup per email)",
        permintaanKedua.ok === false &&
          permintaanKedua.retryAfterMs > 0 &&
          String(permintaanKedua.reason).includes("Tunggu"),
        JSON.stringify(permintaanKedua),
      );
    } else {
      check(
        "tanpa kunci penyedia email, permintaan kode ditolak dengan jujur (bukan diklaim terkirim)",
        permintaanNyata.ok === false &&
          String(permintaanNyata.reason).includes("belum dikonfigurasi"),
        JSON.stringify(permintaanNyata),
      );
    }

    const tanpaKode = await client.mutation(api.otp.verifyCode, {
      email: `belum-minta-${runId}@mesinpos.id`,
      code: "428913",
    });
    check(
      "email yang belum pernah minta kode tidak bisa masuk dengan kode apa pun",
      tanpaKode.ok === false &&
        String(tanpaKode.reason).includes("Belum ada kode"),
      JSON.stringify(tanpaKode),
    );

    // Putaran penuh "kode → masuk" memakai kait pengujian: kode tetap yang hanya
    // berlaku untuk email uji `.test` (lihat `isTestLoginEnabled`). Kait itu tidak
    // pernah bisa dipakai untuk masuk ke akun berdomain nyata — dan justru itu
    // yang diperiksa di baris pertama blok ini.
    if (kesiapan.devCodeForTestEmails) {
      const OTP_DEV_CODE = "428913";
      const emailUji = `uji-kode-${runId}@mesinpos.test`;

      const dikirim = await client.mutation(api.otp.requestCode, {
        email: emailUji,
      });
      check(
        "kode untuk email uji bisa diminta lewat kait pengujian",
        dikirim.ok === true,
        JSON.stringify(dikirim),
      );

      const permintaanKedua = await client.mutation(api.otp.requestCode, {
        email: emailUji,
      });
      check(
        "kode kedua dalam 60 detik ditolak (satu kode hidup per email)",
        permintaanKedua.ok === false &&
          permintaanKedua.retryAfterMs > 0 &&
          String(permintaanKedua.reason).includes("Tunggu"),
        JSON.stringify(permintaanKedua),
      );

      const kodeSalah = await client.mutation(api.otp.verifyCode, {
        email: emailUji,
        code: "000000",
      });
      check(
        "kode yang tidak sesuai ditolak beserta sisa percobaan",
        kodeSalah.ok === false &&
          kodeSalah.remainingAttempts === 4 &&
          String(kodeSalah.reason).includes("Kode tidak sesuai"),
        JSON.stringify(kodeSalah),
      );

      const kodePendek = await client.mutation(api.otp.verifyCode, {
        email: emailUji,
        code: "12345",
      });
      check(
        "kode yang bukan 6 digit tidak pernah diterima",
        kodePendek.ok === false &&
          String(kodePendek.reason).includes("Sisa 3 percobaan"),
        JSON.stringify(kodePendek),
      );

      const masuk = await client.mutation(api.otp.verifyCode, {
        email: emailUji,
        code: OTP_DEV_CODE,
      });
      check(
        "kode yang benar membentuk akun baru (daftar tanpa formulir & tanpa kata sandi)",
        masuk.ok === true &&
          masuk.created === true &&
          typeof masuk.userId === "string",
        JSON.stringify(masuk),
      );

      if (masuk.ok) {
        const baris = await client.query(api.users.get, {
          userId: masuk.userId,
        });
        check(
          "akun hasil kode OTP ditandai emailnya terverifikasi",
          typeof baris?.emailVerifiedAt === "number" &&
            baris?.email === emailUji,
          JSON.stringify(baris),
        );
      }

      const dipakaiLagi = await client.mutation(api.otp.verifyCode, {
        email: emailUji,
        code: OTP_DEV_CODE,
      });
      check(
        "kode sekali pakai: pemakaian kedua ditolak walau kodenya benar",
        dipakaiLagi.ok === false &&
          String(dipakaiLagi.reason).includes("sudah dipakai"),
        JSON.stringify(dipakaiLagi),
      );
    } else {
      console.log(
        "· putaran penuh OTP dilewati: deployment tidak memasang OTP_DEV_CODE untuk email uji",
      );
    }
  }

  // ------------- akun platform (di luar RBAC tenant) ---------------------
  // Akun platform sengaja tidak punya peran tenant dan tidak punya keanggotaan,
  // jadi yang membuktikan modelnya bukan teksnya, melainkan tiga kenyataan di
  // backend nyata: ia tidak muncul di mana pun, jalur untuk membuatnya terlihat
  // ditolak, dan gerbangnya menuntut identitas terverifikasi.
  {
    const emailPlatform = `platform-${runId}@mesinpos.id`;

    // `platform.grant` adalah **internalMutation**: hanya akses deployment yang
    // bisa memanggilnya. Itu diuji lebih dulu — kalau klien bisa, akun platform
    // bisa dibuat siapa pun dan seluruh modelnya batal.
    {
      let blocked = false;
      let message = "";
      try {
        await client.mutation(api.platform.grant, {
          email: `nakal-${runId}@mesinpos.id`,
          name: "Nakal",
        });
      } catch (error) {
        blocked = true;
        message = error?.message ?? String(error);
      }
      check(
        "klien aplikasi tidak bisa memberi dirinya penanda akun platform",
        blocked,
        message || "DITERIMA — platform.grant bisa dipanggil klien",
      );
    }

    const hasilGrant = spawnSync(
      "bun",
      ["convex", "run", "platform:grant", JSON.stringify({ email: emailPlatform, name: "Pengembang Uji" })],
      { encoding: "utf8", timeout: 120_000 },
    );
    const keluaranGrant = `${hasilGrant.stdout ?? ""}${hasilGrant.stderr ?? ""}`;
    let grant = null;
    try {
      grant = JSON.parse(`${hasilGrant.stdout ?? ""}`.trim());
    } catch {
      grant = null;
    }
    check(
      "akses deployment bisa membuat akun platform lewat `convex run`",
      grant !== null && typeof grant.userId === "string" && grant.created === true,
      keluaranGrant.trim() || "keluaran grant tidak terbaca",
    );
    const platformUserId = grant?.userId ?? null;

    if (platformUserId) {
      const tenantDariAkun = await client.query(api.tenants.listMine, {
        userId: platformUserId,
      });
      check(
        "akun platform tidak punya satu pun tenant",
        Array.isArray(tenantDariAkun) && tenantDariAkun.length === 0,
        JSON.stringify(tenantDariAkun),
      );

      const anggota = await client.query(api.members.list, { tenantId, actorId: userId });
      check(
        "akun platform tidak muncul di daftar anggota tenant mana pun",
        anggota.every((row) => row.user.email !== emailPlatform),
        JSON.stringify(anggota.map((row) => row.user.email)),
      );

      {
        let blocked = false;
        let message = "";
        try {
          await client.mutation(api.members.add, {
            tenantId,
            actorId: userId,
            email: emailPlatform,
            role: "manager",
          });
        } catch (error) {
          blocked = true;
          message = error?.message ?? String(error);
        }
        check(
          "akun platform tidak bisa diundang masuk tenant (jalur jadi terlihat ditutup)",
          blocked && message.includes("tidak boleh menjadi anggota"),
          message || "DITERIMA — akun platform bisa diundang",
        );
      }

      // Akun platform **boleh** mendirikan workspace sendiri: keanggotaan pemilik
      // yang lahir dari `tenants.create` adalah satu-satunya keanggotaan yang sah
      // baginya, dan di situ ia memang pemiliknya. Yang tetap ditutup adalah jalur
      // undangan (di atas) — jadi dua-duanya diuji: berhasil mendirikan, lalu tetap
      // tidak bisa masuk ke tenant orang lain setelah punya workspace.
      let tenantPlatform = null;
      {
        let result = null;
        let message = "";
        try {
          result = await client.mutation(api.tenants.create, {
            ownerId: platformUserId,
            name: `Tenant Pengembang ${runId}`,
            slug: `dev-${runId}`,
            planKey: "starter",
            storeName: "Pusat",
            verticals: ["umkm"],
          });
        } catch (error) {
          message = error?.message ?? String(error);
        }
        check(
          "akun platform bisa mendirikan workspace sendiri",
          result !== null && typeof result?.tenantId === "string",
          message || "DITOLAK — akun platform tidak bisa mendirikan workspace",
        );
        tenantPlatform = result?.tenantId ?? null;
      }

      if (tenantPlatform) {
        const milikSendiri = await client.query(api.tenants.listMine, {
          userId: platformUserId,
        });
        check(
          "workspace sendiri tercatat sebagai milik akun platform",
          milikSendiri.length === 1 && milikSendiri[0].tenant._id === tenantPlatform,
          JSON.stringify(milikSendiri.map((row) => row.tenant.slug)),
        );

        const anggotaSendiri = await client.query(api.members.list, {
          tenantId: tenantPlatform,
          actorId: platformUserId,
        });
        check(
          "di workspace sendiri akun platform muncul sebagai pemilik",
          anggotaSendiri.some(
            (row) =>
              row.user.email === emailPlatform && row.membership.role === "owner",
          ),
          JSON.stringify(
            anggotaSendiri.map((row) => `${row.user.email}:${row.membership.role}`),
          ),
        );

        // Pagar undangan tetap utuh: punya workspace sendiri tidak membuka jalur
        // masuk ke tenant orang lain.
        {
          let blocked = false;
          let message = "";
          try {
            await client.mutation(api.members.add, {
              tenantId,
              actorId: userId,
              email: emailPlatform,
              role: "manager",
            });
          } catch (error) {
            blocked = true;
            message = error?.message ?? String(error);
          }
          check(
            "punya workspace sendiri tidak membuka undangan ke tenant orang lain",
            blocked && message.includes("tidak boleh menjadi anggota"),
            message || "DITERIMA — akun platform bisa diundang setelah punya workspace",
          );
        }

        const anggotaOrangLain = await client.query(api.members.list, {
          tenantId,
          actorId: userId,
        });
        check(
          "akun platform tetap tidak muncul di daftar anggota tenant orang lain",
          anggotaOrangLain.every((row) => row.user.email !== emailPlatform),
          JSON.stringify(anggotaOrangLain.map((row) => row.user.email)),
        );
      }

      // Gerbang backstage menuntut identitas terverifikasi. Klien harness tidak
      // pernah punya identitas (deployment anonim), jadi jalur yang benar-benar
      // bisa diuji di sini adalah **penolakannya**. Kalimatnya menyebut cara
      // memperbaikinya, bukan membocorkan apakah akunnya ada.
      {
        let blocked = false;
        let message = "";
        try {
          await client.query(api.platform.me, { userId: platformUserId });
        } catch (error) {
          blocked = true;
          message = error?.message ?? String(error);
        }
        check(
          "akun platform menolak pemanggil tanpa identitas terverifikasi",
          blocked &&
            message.includes("Akses ditolak") &&
            message.includes("ALLOW_UNVERIFIED_ACTOR"),
          message || "DITERIMA — backstage terbuka tanpa identitas",
        );
      }

      // ------- pendampingan platform (impersonasi berjejak) ---------------
      // Sesi pendampingan menuntut identitas login terverifikasi, dan klien
      // harness **tidak pernah** punya identitas. Jadi yang bisa dibuktikan di
      // sini adalah separuh yang paling penting: tidak ada jalur bagi klien
      // aplikasi — termasuk akun platform itu sendiri — untuk membuka sesi,
      // membaca isi tenant lewat sesi, atau melihat daftar tenant. Aturan jalur
      // “diterima”-nya diuji murni di `verify-impersonation.mjs`.
      {
        const expectRefused = async (name, run, mustInclude) => {
          let blocked = false;
          let message = "";
          try {
            await run();
          } catch (error) {
            blocked = true;
            message = error?.message ?? String(error);
          }
          check(
            name,
            blocked && mustInclude.every((needle) => message.includes(needle)),
            message || "DITERIMA — panggilan itu berhasil tanpa identitas",
          );
        };

        const alasanUji = "uji otomatis: cek penolakan sesi pendampingan";

        await expectRefused(
          "akun platform tidak bisa membuka sesi pendampingan tanpa identitas terverifikasi",
          () =>
            client.mutation(api.platform.impersonate, {
              actorId: platformUserId,
              tenantId,
              reason: alasanUji,
            }),
          ["Akses ditolak", "ALLOW_UNVERIFIED_ACTOR"],
        );

        // Anggota tenant biasa pun tidak bisa — jadi tidak ada jalan “member
        // biasa mengangkat dirinya jadi pendamping platform”.
        await expectRefused(
          "anggota tenant biasa juga tidak bisa membuka sesi pendampingan",
          () =>
            client.mutation(api.platform.impersonate, {
              actorId: userId,
              tenantId,
              reason: alasanUji,
            }),
          ["Akses ditolak"],
        );

        // Dua fungsi sesi tidak bisa diuji gerbang identitasnya tanpa satu baris
        // sesi nyata, dan baris itu hanya lahir dari jalur beridentitas. Yang
        // bisa dibuktikan di sini adalah batas terluarnya: id sesi **tidak bisa
        // dikarang** — id dari tabel lain ditolak validasi argumen sebelum
        // handler-nya berjalan, jadi tidak ada jalan memakai sesi yang tidak
        // pernah ada.
        await expectRefused(
          "id sesi karangan ditolak validasi argumen (ringkasan bantuan)",
          () =>
            client.mutation(api.platform.helpTenant, {
              actorId: platformUserId,
              sessionId: platformUserId,
            }),
          ["does not match the table name in validator"],
        );

        await expectRefused(
          "id sesi karangan ditolak validasi argumen (menutup sesi)",
          () =>
            client.mutation(api.platform.endImpersonation, {
              actorId: platformUserId,
              sessionId: tenantId,
            }),
          ["does not match the table name in validator"],
        );

        await expectRefused(
          "riwayat sesi milik platform tidak terbaca tanpa identitas",
          () => client.query(api.platform.myImpersonations, { actorId: platformUserId }),
          ["Akses ditolak", "ALLOW_UNVERIFIED_ACTOR"],
        );

        await expectRefused(
          "daftar seluruh tenant tidak terbaca klien mana pun",
          () => client.query(api.platform.tenantDirectory, { actorId: platformUserId }),
          ["Akses ditolak", "ALLOW_UNVERIFIED_ACTOR"],
        );

        // Kanal baca tenant: pemilik tenant boleh melihat jejak kunjungan ke
        // datanya. Sekarang belum ada kunjungan, jadi jawabannya kosong — dan itu
        // memang jawaban yang benar.
        {
          let trail = null;
          let message = "";
          try {
            trail = await client.query(api.platform.impersonationTrail, {
              tenantId,
              actorId: userId,
            });
          } catch (error) {
            message = error?.message ?? String(error);
          }
          check(
            "pemilik tenant bisa membaca jejak pendampingan datanya (kosong sebelum ada kunjungan)",
            trail !== null && Array.isArray(trail.rows) && trail.rows.length === 0,
            message || JSON.stringify(trail),
          );
        }

        // Sisi sebaliknya: yang bukan anggota tidak boleh melihat jejak tenant itu.
        {
          let blocked = false;
          let message = "";
          try {
            await client.query(api.platform.impersonationTrail, {
              tenantId,
              actorId: platformUserId,
            });
          } catch (error) {
            blocked = true;
            message = error?.message ?? String(error);
          }
          check(
            "akun platform tanpa keanggotaan tidak bisa membaca jejak tenant",
            blocked && message.includes("bukan anggota"),
            message || "DITERIMA — akun platform membaca jejak tenant",
          );
        }

        // Perapian sesi kedaluwarsa hanya bisa dijalankan dengan akses deployment,
        // dan tanpa sesi tersisa ia memang menutup nol baris.
        const hasilSweep = spawnSync(
          "bun",
          ["convex", "run", "platform:sweepExpiredImpersonations", JSON.stringify({ limit: 5 })],
          { encoding: "utf8", timeout: 120_000 },
        );
        const keluaranSweep = `${hasilSweep.stdout ?? ""}${hasilSweep.stderr ?? ""}`;
        let sweep = null;
        try {
          sweep = JSON.parse(`${hasilSweep.stdout ?? ""}`.trim());
        } catch {
          sweep = null;
        }
        check(
          "perapian sesi kedaluwarsa jalan lewat akses deployment & tidak menyentuh sesi hidup",
          sweep !== null && sweep.checked === 0 && sweep.closed === 0,
          keluaranSweep.trim() || "keluaran sweep tidak terbaca",
        );
      }

      const hasilRevoke = spawnSync(
        "bun",
        ["convex", "run", "platform:revoke", JSON.stringify({ email: emailPlatform })],
        { encoding: "utf8", timeout: 120_000 },
      );
      check(
        "penanda akun platform bisa dicabut lewat akses deployment",
        `${hasilRevoke.stdout ?? ""}`.includes("true"),
        `${hasilRevoke.stdout ?? ""}${hasilRevoke.stderr ?? ""}`.trim(),
      );
    } else {
      check("akun platform punya id untuk diperiksa", false, keluaranGrant.trim());
    }
  }

  // -------------------------------------------------------------- SKU otomatis
  // Kolom SKU boleh dikosongkan: server membuat `PBB-<KATEGORI>-<nomor urut>`
  // yang unik (kode kategori dari nama kategori, nomor urut dari counter tenant),
  // dan nomor yang benar-benar dipakai dikembalikan ke pemanggil.
  //
  // Pemeriksaan ini sengaja di **paling akhir** `main()`: setiap produk baru
  // menambah angka di cek `usage produk = 2` maupun di daftar produk yang dipakai
  // laporan, jadi membuatnya lebih dulu akan mengubah arti cek-cek itu.
  const kategoriTenant = await client.query(api.tenants.listCategories, {
    tenantId,
    actorId: userId,
  });
  const kategoriMakanan = kategoriTenant.find((row) => row.name === "Makanan");
  check(
    "tenant punya kategori bawaan untuk kode SKU",
    Boolean(kategoriMakanan),
    JSON.stringify(kategoriTenant.map((row) => row.name)),
  );

  const autoUmu = await client.mutation(api.products.create, {
    tenantId,
    storeId,
    name: "Produk SKU Otomatis",
    price: 1000,
    actorId: userId,
  });
  check(
    "SKU dibuat otomatis dengan format PBB-<KATEGORI>-<nomor urut>",
    /^PBB-[A-Z0-9]{3}-\d{6}$/.test(autoUmu.sku),
    autoUmu.sku,
  );
  check(
    "tanpa kategori memakai kode UMU",
    autoUmu.sku.startsWith("PBB-UMU-"),
    autoUmu.sku,
  );

  // SKU manual yang memakai format sama harus dilewati, bukan ditabrak: counter
  // berikutnya sudah “dipesan” oleh SKU yang diketik pemilik toko.
  const nomorTerpakai = Number(autoUmu.sku.slice(-6)) + 1;
  const skuManualBentrok = `PBB-UMU-${String(nomorTerpakai).padStart(6, "0")}`;
  await client.mutation(api.products.create, {
    tenantId,
    storeId,
    sku: skuManualBentrok,
    name: "SKU Manual Setelah Otomatis",
    price: 1000,
    actorId: userId,
  });
  const autoSetelahBentrok = await client.mutation(api.products.create, {
    tenantId,
    storeId,
    name: "Produk Otomatis Setelah Bentrok",
    price: 1000,
    actorId: userId,
  });
  check(
    "nomor urut yang sudah dipakai manual dilewati, bukan dipakai dua kali",
    autoSetelahBentrok.sku !== skuManualBentrok &&
      /^PBB-UMU-\d{6}$/.test(autoSetelahBentrok.sku) &&
      Number(autoSetelahBentrok.sku.slice(-6)) > nomorTerpakai,
    `${skuManualBentrok} → ${autoSetelahBentrok.sku}`,
  );

  const autoMakanan = await client.mutation(api.products.create, {
    tenantId,
    storeId,
    name: "Produk SKU Otomatis Makanan",
    price: 1000,
    categoryId: kategoriMakanan._id,
    actorId: userId,
  });
  check(
    "kode kategori diambil dari nama kategori (Makanan → MAK)",
    autoMakanan.sku.startsWith("PBB-MAK-"),
    autoMakanan.sku,
  );
  check(
    "nomor urut naik satu-satu untuk tenant ini",
    Number(autoMakanan.sku.slice(-6)) === Number(autoSetelahBentrok.sku.slice(-6)) + 1,
    `${autoSetelahBentrok.sku} → ${autoMakanan.sku}`,
  );

  const skuManual = await client.mutation(api.products.create, {
    tenantId,
    storeId,
    sku: `MANUAL-${runId}`,
    name: "Produk SKU Manual",
    price: 1000,
    actorId: userId,
  });
  check(
    "SKU yang diketik pemilik toko dipakai apa adanya",
    skuManual.sku === `MANUAL-${runId}`,
    skuManual.sku,
  );

  const daftarSetelahAuto = await client.query(api.products.listByStore, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "SKU otomatis tersimpan di produk, bukan hanya dikembalikan",
    daftarSetelahAuto.find((p) => p._id === autoUmu.productId)?.sku === autoUmu.sku &&
      daftarSetelahAuto.find((p) => p._id === autoMakanan.productId)?.sku === autoMakanan.sku,
    JSON.stringify(
      daftarSetelahAuto
        .filter((p) => [autoUmu.productId, autoMakanan.productId].includes(p._id))
        .map((p) => p.sku),
    ),
  );
  {
    const semuaSku = daftarSetelahAuto.map((p) => p.sku);
    check(
      "tidak ada SKU kembar di katalog tenant",
      new Set(semuaSku).size === semuaSku.length,
      JSON.stringify(semuaSku),
    );
  }

  let skuKembarDitolak = null;
  try {
    await client.mutation(api.products.create, {
      tenantId,
      storeId,
      sku: autoUmu.sku,
      name: "Produk SKU Kembar",
      price: 1000,
      actorId: userId,
    });
  } catch (error) {
    skuKembarDitolak = error?.message ?? String(error);
  }
  check(
    "SKU manual yang sudah dipakai tetap ditolak",
    typeof skuKembarDitolak === "string" && skuKembarDitolak.includes("sudah dipakai"),
    skuKembarDitolak ?? "diterima",
  );

  // -------------------------------------- kategori berubah → kode SKU ikut
  // Kategori menentukan kode di tengah SKU, jadi memindahkan produk ke kategori
  // lain harus ikut memindahkan kodenya — nomor urutnya dipertahankan selama bebas,
  // dan SKU yang diketik pemilik toko tidak disentuh.
  const kategoriLain = kategoriTenant.find((row) => row.name !== "Makanan");
  check(
    "tenant punya kategori kedua untuk uji pindah kategori",
    Boolean(kategoriLain),
    JSON.stringify(kategoriTenant.map((row) => row.name)),
  );

  const pindahKeMakanan = await client.mutation(api.products.setCategory, {
    tenantId,
    actorId: userId,
    productId: autoUmu.productId,
    categoryId: kategoriMakanan._id,
  });
  check(
    "kategori produk berubah → kode SKU ikut kategori barunya",
    /^PBB-MAK-\d{6}$/.test(pindahKeMakanan.sku) &&
      pindahKeMakanan.previousSku === autoUmu.sku,
    JSON.stringify(pindahKeMakanan),
  );
  check(
    "nomor urut dipertahankan saat kategori berganti",
    pindahKeMakanan.sku.slice(-6) === autoUmu.sku.slice(-6),
    `${autoUmu.sku} → ${pindahKeMakanan.sku}`,
  );

  const kategoriDilepas = await client.mutation(api.products.setCategory, {
    tenantId,
    actorId: userId,
    productId: autoUmu.productId,
  });
  check(
    "kategori dikosongkan → kode SKU kembali UMU",
    kategoriDilepas.sku.startsWith("PBB-UMU-") && kategoriDilepas.category === null,
    JSON.stringify(kategoriDilepas),
  );

  const manualDipindah = await client.mutation(api.products.setCategory, {
    tenantId,
    actorId: userId,
    productId: skuManual.productId,
    categoryId: kategoriMakanan._id,
  });
  check(
    "SKU yang diketik pemilik toko TIDAK ikut berubah",
    manualDipindah.sku === skuManual.sku && manualDipindah.previousSku === skuManual.sku,
    JSON.stringify(manualDipindah),
  );
  check(
    "kategori produk ber-SKU manual tetap tersimpan",
    manualDipindah.category === "Makanan",
    String(manualDipindah.category),
  );

  // Nomor yang sudah terpakai di kategori tujuan tidak boleh ditabrak: SKU-nya
  // pindah ke nomor berikutnya yang bebas, bukan gagal.
  const nomorMakanan = Number(autoMakanan.sku.slice(-6));
  const kodeKategoriLain = productSkuCategoryCode(kategoriLain.name);
  const skuMenahanNomor = `PBB-${kodeKategoriLain}-${String(nomorMakanan).padStart(6, "0")}`;
  await client.mutation(api.products.create, {
    tenantId,
    storeId,
    sku: skuMenahanNomor,
    name: "SKU Menahan Nomor",
    price: 1000,
    actorId: userId,
  });
  const pindahBentrok = await client.mutation(api.products.setCategory, {
    tenantId,
    actorId: userId,
    productId: autoMakanan.productId,
    categoryId: kategoriLain._id,
  });
  check(
    "nomor yang sudah dipakai di kategori tujuan dilewati, bukan ditabrak",
    pindahBentrok.sku !== skuMenahanNomor &&
      pindahBentrok.sku.startsWith(`PBB-${kodeKategoriLain}-`) &&
      Number(pindahBentrok.sku.slice(-6)) > nomorMakanan,
    `${skuMenahanNomor} → ${pindahBentrok.sku}`,
  );

  // Kasir boleh menjual, tapi tidak boleh mengubah katalog.
  let kategoriKasirDitolak = null;
  try {
    await client.mutation(api.products.setCategory, {
      tenantId,
      actorId: cashierId,
      productId: autoMakanan.productId,
      categoryId: kategoriMakanan._id,
    });
  } catch (error) {
    kategoriKasirDitolak = error?.message ?? String(error);
  }
  check(
    "kasir ditolak memindahkan kategori produk (izin product.manage)",
    typeof kategoriKasirDitolak === "string" &&
      kategoriKasirDitolak.includes("izin product.manage"),
    kategoriKasirDitolak ?? "DITERIMA — kasir boleh memindahkan kategori",
  );

  const daftarSetelahKategori = await client.query(api.products.listByStore, {
    tenantId,
    storeId,
    actorId: userId,
  });
  check(
    "SKU hasil pindah kategori tersimpan di produk, bukan hanya dikembalikan",
    daftarSetelahKategori.find((p) => p._id === autoMakanan.productId)?.sku ===
      pindahBentrok.sku &&
      daftarSetelahKategori.find((p) => p._id === autoUmu.productId)?.sku ===
        kategoriDilepas.sku,
    JSON.stringify(
      daftarSetelahKategori
        .filter((p) => [autoMakanan.productId, autoUmu.productId].includes(p._id))
        .map((p) => [p.name, p.sku]),
    ),
  );
  {
    const semuaSku = daftarSetelahKategori.map((p) => p.sku);
    check(
      "tidak ada SKU kembar setelah pindah kategori",
      new Set(semuaSku).size === semuaSku.length,
      JSON.stringify(semuaSku),
    );
  }

  // ------------------------------------------- kategori produk (category.manage)
  // Tambah, ganti nama, aktif/nonaktif, dan hapus kategori lewat deployment
  // sungguhan. Yang diuji di sini bukan tampilannya, melainkan pagar yang hanya
  // bisa dibuktikan server: izin `category.manage` terpisah dari `product.manage`,
  // kategori nonaktif ditolak untuk produk baru/perpindahan, dan **hapus kategori
  // melepas produknya tanpa menghapus produk atau menulis ulang SKU-nya**.
  {
    const namaKategori = `Sanitasi ${runId}`;
    const dibuat = await client.mutation(api.categories.create, {
      tenantId,
      actorId: userId,
      name: namaKategori,
    });
    check(
      "owner bisa menambah kategori beserta kode SKU-nya",
      dibuat.name === namaKategori && dibuat.skuCode === "SAN",
      JSON.stringify(dibuat),
    );

    const setelahTambah = await client.query(api.tenants.listCategories, {
      tenantId,
      actorId: userId,
    });
    const barisBaru = setelahTambah.find((row) => row._id === dibuat.categoryId);
    check(
      "kategori baru tersimpan aktif & terbaca oleh pemilih kategori",
      barisBaru?.name === namaKategori && barisBaru?.active === true,
      JSON.stringify({ kategori: setelahTambah.map((row) => [row.name, row.active]) }),
    );
    check(
      "kategori bawaan tenant juga aktif (baris lama tanpa penanda nonaktif)",
      setelahTambah.filter((row) => row.active === true).length === setelahTambah.length,
      JSON.stringify(setelahTambah.map((row) => [row.name, row.active])),
    );

    // Nama yang sudah ada dan nama yang berarti “tidak ada kategori” ditolak
    // server, bukan hanya di layar.
    let kembarDitolak = null;
    try {
      await client.mutation(api.categories.create, {
        tenantId,
        actorId: userId,
        // Huruf besar & spasi berlebih: nama yang sama tetap harus dikenali
        // sebagai duplikat oleh aturan bersama.
        name: `  ${namaKategori.toUpperCase()}  `,
      });
    } catch (error) {
      kembarDitolak = error?.message ?? String(error);
    }
    check(
      "kategori dengan nama sama ditolak server",
      typeof kembarDitolak === "string" && kembarDitolak.includes("sudah ada di workspace ini"),
      kembarDitolak ?? "DITERIMA — kategori kembar lolos",
    );

    let terlarangDitolak = null;
    try {
      await client.mutation(api.categories.create, {
        tenantId,
        actorId: userId,
        name: "Tanpa kategori",
      });
    } catch (error) {
      terlarangDitolak = error?.message ?? String(error);
    }
    check(
      "nama “Tanpa kategori” ditolak server",
      typeof terlarangDitolak === "string" &&
        terlarangDitolak.includes("produk tanpa kategori"),
      terlarangDitolak ?? "DITERIMA — nama terlarang lolos",
    );

    // Izinnya memang terpisah: kasir & staf gudang tidak boleh menyentuh struktur
    // katalog, walaupun staf gudang boleh mengelola produk.
    for (const [label, actor] of [
      ["kasir", cashierId],
      ["staf gudang", stafGudangId],
    ]) {
      let ditolak = null;
      try {
        await client.mutation(api.categories.rename, {
          tenantId,
          actorId: actor,
          categoryId: dibuat.categoryId,
          name: `${namaKategori} X`,
        });
      } catch (error) {
        ditolak = error?.message ?? String(error);
      }
      check(
        `${label} ditolak mengganti nama kategori (izin category.manage)`,
        typeof ditolak === "string" && ditolak.includes("izin category.manage"),
        ditolak ?? "DITERIMA — izin category.manage bocor",
      );
    }

    // Ganti nama: kodenya bisa berubah untuk produk **berikutnya**, tetapi SKU
    // yang sudah ada tidak boleh ditulis ulang.
    const namaMakanan = "Makanan";
    const makanan = setelahTambah.find((row) => row.name === namaMakanan);
    // Satu produk ber-SKU otomatis di kategori “Makanan”: inilah bukti bahwa SKU
    // yang sudah ada tidak ditulis ulang saat kategorinya berganti nama.
    const produkMakananUji = await client.mutation(api.products.create, {
      tenantId,
      storeId,
      name: `Produk Makanan ${runId}`,
      price: 1000,
      categoryId: makanan._id,
      actorId: userId,
    });
    check(
      "produk uji ganti nama kategori memakai kode kategori yang benar",
      produkMakananUji.sku.startsWith("PBB-MAK-"),
      produkMakananUji.sku,
    );
    const skuSebelumGantiNama = produkMakananUji.sku;
    const gantiSama = await client.mutation(api.categories.rename, {
      tenantId,
      actorId: userId,
      categoryId: dibuat.categoryId,
      name: `${namaKategori} Bersih`,
    });
    check(
      "ganti nama kategori yang kodenya tetap ditandai tidak mengubah kode SKU",
      gantiSama.name === `${namaKategori} Bersih` && gantiSama.skuCodeChanged === false,
      JSON.stringify(gantiSama),
    );
    const gantiBeda = await client.mutation(api.categories.rename, {
      tenantId,
      actorId: userId,
      categoryId: makanan._id,
      name: "Peralatan",
    });
    check(
      "ganti nama kategori yang mengubah kode ditandai apa adanya",
      gantiBeda.skuCodeChanged === true && gantiBeda.previousName === namaMakanan,
      JSON.stringify(gantiBeda),
    );
    const daftarSetelahGantiNama = await client.query(api.products.listByStore, {
      tenantId,
      storeId,
      actorId: userId,
    });
    const produkMakananSesudah = daftarSetelahGantiNama.find(
      (p) => p._id === produkMakananUji.productId,
    );
    check(
      "SKU produk yang sudah ada TIDAK ditulis ulang oleh ganti nama kategori",
      produkMakananSesudah?.sku === skuSebelumGantiNama &&
        produkMakananSesudah?.categoryId === makanan._id,
      `${skuSebelumGantiNama} → ${produkMakananSesudah?.sku}`,
    );
    const kembalikanNama = await client.mutation(api.categories.rename, {
      tenantId,
      actorId: userId,
      categoryId: makanan._id,
      name: namaMakanan,
    });
    check(
      "nama kategori bisa dikembalikan seperti semula",
      kembalikanNama.name === namaMakanan && kembalikanNama.skuCodeChanged === true,
      JSON.stringify(kembalikanNama),
    );

    // Produk menempel ke kategori baru, lalu kategorinya dinonaktifkan: produk itu
    // tetap ada & tetap terbaca, tetapi tidak bisa dipakai produk baru/perpindahan.
    const produkKategoriUji = await client.mutation(api.products.create, {
      tenantId,
      storeId,
      name: `Produk Kategori Uji ${runId}`,
      price: 1000,
      categoryId: dibuat.categoryId,
      actorId: userId,
    });
    check(
      "produk bisa memakai kategori yang baru dibuat",
      produkKategoriUji.sku.startsWith("PBB-SAN-"),
      produkKategoriUji.sku,
    );
    const nonaktif = await client.mutation(api.categories.setActive, {
      tenantId,
      actorId: userId,
      categoryId: dibuat.categoryId,
      active: false,
    });
    check(
      "kategori bisa dinonaktifkan lewat server",
      nonaktif.active === false && nonaktif.changed === true,
      JSON.stringify(nonaktif),
    );

    let produkBaruDitolak = null;
    try {
      await client.mutation(api.products.create, {
        tenantId,
        storeId,
        sku: `NONAKTIF-${runId}`,
        name: "Produk di Kategori Nonaktif",
        price: 1000,
        categoryId: dibuat.categoryId,
        actorId: userId,
      });
    } catch (error) {
      produkBaruDitolak = error?.message ?? String(error);
    }
    check(
      "produk baru ditolak memakai kategori nonaktif",
      typeof produkBaruDitolak === "string" && produkBaruDitolak.includes("sedang nonaktif"),
      produkBaruDitolak ?? "DITERIMA — kategori nonaktif masih bisa dipakai",
    );

    let pindahDitolak = null;
    try {
      await client.mutation(api.products.setCategory, {
        tenantId,
        actorId: userId,
        productId: autoUmu.productId,
        categoryId: dibuat.categoryId,
      });
    } catch (error) {
      pindahDitolak = error?.message ?? String(error);
    }
    check(
      "produk lama ditolak dipindahkan ke kategori nonaktif",
      typeof pindahDitolak === "string" && pindahDitolak.includes("sedang nonaktif"),
      pindahDitolak ?? "DITERIMA — perpindahan ke kategori nonaktif lolos",
    );

    const daftarNonaktif = await client.query(api.products.listByStore, {
      tenantId,
      storeId,
      actorId: userId,
    });
    check(
      "produk yang sudah memakai kategori nonaktif tetap ada & tetap memakainya",
      daftarNonaktif.find((p) => p._id === produkKategoriUji.productId)?.categoryId ===
        dibuat.categoryId,
      JSON.stringify(
        daftarNonaktif
          .filter((p) => p._id === produkKategoriUji.productId)
          .map((p) => [p.name, p.categoryId]),
      ),
    );

    const aktifLagi = await client.mutation(api.categories.setActive, {
      tenantId,
      actorId: userId,
      categoryId: dibuat.categoryId,
      active: true,
    });
    check(
      "kategori bisa diaktifkan kembali",
      aktifLagi.active === true && aktifLagi.changed === true,
      JSON.stringify(aktifLagi),
    );
    const nonaktifIdempoten = await client.mutation(api.categories.setActive, {
      tenantId,
      actorId: userId,
      categoryId: dibuat.categoryId,
      active: true,
    });
    check(
      "menyalakan kategori yang sudah aktif tidak mengubah apa pun lagi",
      nonaktifIdempoten.changed === false,
      JSON.stringify(nonaktifIdempoten),
    );

    // Hapus kategori yang masih dipakai satu produk: produknya dilepas, bukan
    // ikut terhapus, dan SKU-nya tidak disentuh.
    const hapus = await client.mutation(api.categories.remove, {
      tenantId,
      actorId: userId,
      categoryId: dibuat.categoryId,
    });
    check(
      "hapus kategori melaporkan berapa produk yang dilepas",
      hapus.removed === true && hapus.detachedProducts === 1,
      JSON.stringify(hapus),
    );

    const daftarSetelahHapus = await client.query(api.products.listByStore, {
      tenantId,
      storeId,
      actorId: userId,
    });
    const produkDilepas = daftarSetelahHapus.find((p) => p._id === produkKategoriUji.productId);
    check(
      "hapus kategori tidak menghapus produk & tidak menulis ulang SKU-nya",
      Boolean(produkDilepas) &&
        produkDilepas.categoryId === undefined &&
        produkDilepas.sku === produkKategoriUji.sku,
      JSON.stringify(
        produkDilepas ? [produkDilepas.name, produkDilepas.sku, produkDilepas.categoryId] : null,
      ),
    );

    const kategoriSetelahHapus = await client.query(api.tenants.listCategories, {
      tenantId,
      actorId: userId,
    });
    check(
      "kategori yang dihapus hilang dari daftar",
      !kategoriSetelahHapus.some((row) => row._id === dibuat.categoryId),
      JSON.stringify(kategoriSetelahHapus.map((row) => row.name)),
    );
    check(
      "kategori bawaan tenant tetap utuh setelah semua perubahan",
      kategoriSetelahHapus.filter((row) => row.name === namaMakanan).length === 1,
      JSON.stringify(kategoriSetelahHapus.map((row) => row.name)),
    );

    // Kategori workspace lain tetap tidak bisa disentuh dari sini (isolasi tenant
    // berlaku juga untuk struktur katalog, bukan hanya produk).
    const { userId: pemilikLain } = await client.mutation(api.users.createOrGet, {
      email: `kategori-lain+${runId}@mesinpos.test`,
      name: "Pemilik Kategori Lain",
    });
    const bisnisLain = await client.mutation(api.tenants.create, {
      ownerId: pemilikLain,
      name: `Kategori Lain ${runId}`,
      slug: `kategori-lain-${runId}`,
      planKey: "professional",
      storeName: "Pusat Kategori",
      verticals: ["umkm"],
    });
    const kategoriLainTenant = await client.query(api.tenants.listCategories, {
      tenantId: bisnisLain.tenantId,
      actorId: pemilikLain,
    });
    let lintasTenantDitolak = null;
    try {
      await client.mutation(api.categories.remove, {
        tenantId: bisnisLain.tenantId,
        actorId: userId,
        categoryId: kategoriLainTenant[0]._id,
      });
    } catch (error) {
      lintasTenantDitolak = error?.message ?? String(error);
    }
    check(
      "kategori workspace lain tidak bisa dihapus dari sini",
      typeof lintasTenantDitolak === "string" && lintasTenantDitolak.includes("bukan anggota"),
      lintasTenantDitolak ?? "DITERIMA — lintas tenant bocor",
    );
    check(
      "workspace baru sudah punya kategori bawaan yang aktif",
      kategoriLainTenant.length > 0 &&
        kategoriLainTenant.every((row) => row.active === true),
      JSON.stringify(kategoriLainTenant.map((row) => [row.name, row.active])),
    );
  }

  // ------------------- produk tersimpan: ubah identitas, aktif/nonaktif, hapus
  // Tiga jalur yang diuji di sini sengaja terpisah dari harga/kategori: memperbaiki
  // salah ketik nama tidak boleh ikut mengubah harga jual, menonaktifkan harus
  // benar-benar menutup penjualannya (bukan hanya tampilan), dan menghapus hanya
  // boleh untuk produk yang belum meninggalkan jejak apa pun. Produk ujinya
  // dibuat berstok 0 dan belum pernah dipakai, jadi bisa dihapus lagi di akhir —
  // tenant uji tidak ditinggali produk sisa.
  {
    const { productId: kelolaId } = await client.mutation(api.products.create, {
      tenantId,
      storeId,
      name: `Produk Kelola ${runId}`,
      price: 7000,
      cost: 3000,
      actorId: userId,
    });
    const daftarAwal = await client.query(api.products.listAll, {
      tenantId,
      storeId,
      actorId: userId,
    });
    const awal = daftarAwal.find((p) => p._id === kelolaId);
    check(
      "produk baru berstok 0 & aktif, siap diuji kelola",
      awal?.stock === 0 && awal?.active === true && awal?.cost === 3000,
      JSON.stringify(awal),
    );

    // --- ubah identitas -------------------------------------------------
    const ubah = await client.mutation(api.products.update, {
      tenantId,
      actorId: userId,
      productId: kelolaId,
      name: `Produk Kelola Ubah ${runId}`,
      sku: `KELOLA-${runId}`,
      cost: 4500,
    });
    check(
      "products.update menyimpan nama, SKU, dan harga beli dan menyebut kolom yang berubah",
      ubah.changed.join(",") === "name,sku,cost" &&
        ubah.name === `Produk Kelola Ubah ${runId}` &&
        ubah.sku === `KELOLA-${runId}` &&
        ubah.cost === 4500,
      JSON.stringify(ubah),
    );
    const setelahUbah = (
      await client.query(api.products.listAll, { tenantId, storeId, actorId: userId })
    ).find((p) => p._id === kelolaId);
    check(
      "products.update tidak menyentuh harga jual",
      setelahUbah?.price === awal.price && setelahUbah?.name === ubah.name,
      JSON.stringify({ sebelum: awal?.price, sesudah: setelahUbah?.price }),
    );

    const ubahKosong = await client.mutation(api.products.update, {
      tenantId,
      actorId: userId,
      productId: kelolaId,
      name: `Produk Kelola Ubah ${runId}`,
      cost: 4500,
    });
    check(
      "perubahan kosong tidak menulis apa pun (changed kosong)",
      ubahKosong.changed.length === 0,
      JSON.stringify(ubahKosong),
    );

    let skuKembar = null;
    try {
      const skuLain = String(daftarAwal.find((p) => p._id === kopiId)?.sku ?? "");
      await client.mutation(api.products.update, {
        tenantId,
        actorId: userId,
        productId: kelolaId,
        // Hurufnya sengaja dibalik: yang kembar adalah SKU-nya, bukan ketikannya.
        sku: skuLain.toLowerCase(),
      });
    } catch (error) {
      skuKembar = error?.message ?? String(error);
    }
    check(
      "SKU yang sudah dipakai produk lain ditolak (huruf besar-kecil diabaikan)",
      typeof skuKembar === "string" && skuKembar.includes("sudah dipakai"),
      skuKembar ?? "DITERIMA — SKU kembar lolos",
    );

    let namaTerlaluPendek = null;
    try {
      await client.mutation(api.products.update, {
        tenantId,
        actorId: userId,
        productId: kelolaId,
        name: "K",
      });
    } catch (error) {
      namaTerlaluPendek = error?.message ?? String(error);
    }
    check(
      "nama produk di luar 2–60 karakter ditolak server",
      typeof namaTerlaluPendek === "string" && namaTerlaluPendek.includes("2–60"),
      namaTerlaluPendek ?? "DITERIMA — nama mustahil lolos",
    );

    // --- nonaktifkan: hilang dari kasir, ditolak kalau dipaksa ----------
    const dimatikan = await client.mutation(api.products.setActive, {
      tenantId,
      actorId: userId,
      productId: kelolaId,
      active: false,
    });
    check(
      "products.setActive mematikan produk dan mencatat perubahannya",
      dimatikan.active === false && dimatikan.changed === true,
      JSON.stringify(dimatikan),
    );

    const dijual = await client.query(api.products.listByStore, {
      tenantId,
      storeId,
      actorId: userId,
    });
    const dikelola = await client.query(api.products.listAll, {
      tenantId,
      storeId,
      actorId: userId,
    });
    check(
      "produk nonaktif hilang dari katalog kasir tetapi tetap ada di katalog pengelolaan",
      !dijual.some((p) => p._id === kelolaId) &&
        dikelola.find((p) => p._id === kelolaId)?.active === false,
      JSON.stringify({ dijual: dijual.length, dikelola: dikelola.length }),
    );

    let jualNonaktif = null;
    try {
      await client.mutation(api.pos.createSale, {
        tenantId,
        storeId,
        // Pemilik yang menjual: yang sedang diuji produknya, bukan izin kasirnya.
        cashierId: userId,
        items: [{ productId: kelolaId, quantity: 1 }],
        payments: [{ method: "cash", amount: 1 }],
        idempotencyKey: `nonaktif-${runId}`,
      });
    } catch (error) {
      jualNonaktif = error?.message ?? String(error);
    }
    check(
      "menjual produk nonaktif ditolak server, bukan hanya disembunyikan dari kasir",
      typeof jualNonaktif === "string" && jualNonaktif.includes("sedang nonaktif"),
      jualNonaktif ?? "DITERIMA — produk nonaktif masih bisa dijual",
    );

    const dinyalakan = await client.mutation(api.products.setActive, {
      tenantId,
      actorId: userId,
      productId: kelolaId,
      active: true,
    });
    check(
      "produk bisa diaktifkan kembali dan kembali ke katalog kasir",
      dinyalakan.active === true &&
        (await client.query(api.products.listByStore, { tenantId, storeId, actorId: userId })).some(
          (p) => p._id === kelolaId,
        ),
      JSON.stringify(dinyalakan),
    );
    const nyalaLagi = await client.mutation(api.products.setActive, {
      tenantId,
      actorId: userId,
      productId: kelolaId,
      active: true,
    });
    check(
      "menyalakan produk yang sudah aktif tidak mengubah apa pun lagi",
      nyalaLagi.changed === false,
      JSON.stringify(nyalaLagi),
    );

    // --- pagar hapus ----------------------------------------------------
    const pagarBersih = await client.query(api.products.deletionCheck, {
      tenantId,
      actorId: userId,
      productId: kelolaId,
    });
    check(
      "produk yang belum pernah dipakai boleh dihapus",
      pagarBersih.canDelete === true && pagarBersih.blockers.length === 0,
      JSON.stringify(pagarBersih),
    );

    // Produk uji kedua sengaja **berstok**: pagar hapusnya harus menyebut stok dan
    // pergerakan stok yang sudah tercatat, bukan cuma “tidak bisa dihapus”.
    const { productId: terpakaiId } = await client.mutation(api.products.create, {
      tenantId,
      storeId,
      name: `Produk Terpakai ${runId}`,
      price: 5000,
      openingStock: 5,
      actorId: userId,
    });
    const pagarTerpakai = await client.query(api.products.deletionCheck, {
      tenantId,
      actorId: userId,
      productId: terpakaiId,
    });
    check(
      "produk yang masih berstok ditolak dihapus, alasannya menyebut angkanya satu per satu",
      pagarTerpakai.canDelete === false &&
        pagarTerpakai.blockers.some((alasan) => alasan.includes("stok")) &&
        pagarTerpakai.blockers.some((alasan) => alasan.includes("pergerakan stok")) &&
        pagarTerpakai.sentence.includes("Nonaktifkan saja"),
      JSON.stringify(pagarTerpakai),
    );

    let hapusTerpakai = null;
    try {
      await client.mutation(api.products.remove, {
        tenantId,
        actorId: userId,
        productId: terpakaiId,
      });
    } catch (error) {
      hapusTerpakai = error?.message ?? String(error);
    }
    const terpakaiSetelahDitolak = (
      await client.query(api.products.listAll, { tenantId, storeId, actorId: userId })
    ).find((p) => p._id === terpakaiId);
    check(
      "hapus produk yang sudah punya riwayat ditolak & produknya tetap ada",
      typeof hapusTerpakai === "string" &&
        hapusTerpakai.includes("tidak bisa dihapus") &&
        Boolean(terpakaiSetelahDitolak),
      hapusTerpakai ?? "DITERIMA — produk berjejak terhapus",
    );

    const dihapus = await client.mutation(api.products.remove, {
      tenantId,
      actorId: userId,
      productId: kelolaId,
    });
    const sisa = await client.query(api.products.listAll, {
      tenantId,
      storeId,
      actorId: userId,
    });
    check(
      "produk yang layak dihapus benar-benar hilang dari katalog",
      dihapus.removed === true && !sisa.some((p) => p._id === kelolaId),
      JSON.stringify({ hasil: dihapus, sisa: sisa.length }),
    );

    // --- izin: kasir bukan pengelola produk -----------------------------
    const { productId: produkIzin } = await client.mutation(api.products.create, {
      tenantId,
      storeId,
      name: `Produk Izin ${runId}`,
      price: 1000,
      actorId: userId,
    });
    let kasirUbah = null;
    try {
      await client.mutation(api.products.update, {
        tenantId,
        actorId: cashierId,
        productId: produkIzin,
        name: "Diubah Kasir",
      });
    } catch (error) {
      kasirUbah = error?.message ?? String(error);
    }
    let kasirHapus = null;
    try {
      await client.mutation(api.products.remove, {
        tenantId,
        actorId: cashierId,
        productId: produkIzin,
      });
    } catch (error) {
      kasirHapus = error?.message ?? String(error);
    }
    const produkIzinSetelah = (
      await client.query(api.products.listAll, { tenantId, storeId, actorId: userId })
    ).find((p) => p._id === produkIzin);
    check(
      "kasir tidak bisa mengubah atau menghapus produk (product.manage)",
      typeof kasirUbah === "string" &&
        typeof kasirHapus === "string" &&
        kasirUbah.includes("product.manage") &&
        kasirHapus.includes("product.manage") &&
        produkIzinSetelah?.name === `Produk Izin ${runId}`,
      `ubah=${kasirUbah ?? "LOLOS"} | hapus=${kasirHapus ?? "LOLOS"}`,
    );

    const bersih = await client.mutation(api.products.remove, {
      tenantId,
      actorId: userId,
      productId: produkIzin,
    });
    check("produk uji izin dibersihkan lagi", bersih.removed === true, JSON.stringify(bersih));
  }

  // ------------------------- satu akun = satu bisnis (workspace berdiri sendiri)
  // Nama bisnis **bukan** kunci unik: dua pemilik toko boleh sama-sama menamai
  // bisnisnya “Kopi Senja”. Yang harus dijamin: dua akun itu mendapat dua
  // workspace terpisah (walau alamat yang diminta sama), tiap workspace hanya
  // bisa dilihat dan diatur pemiliknya, dan mendaftar ulang — mis. di perangkat
  // baru yang sesinya kosong — memakai kembali workspace sendiri alih-alih
  // menumpuk bisnis kedua.
  {
    const { userId: pemilikA } = await client.mutation(api.users.createOrGet, {
      email: `kopi-a+${runId}@mesinpos.test`,
      name: "Pemilik Kopi A",
    });
    const { userId: pemilikB } = await client.mutation(api.users.createOrGet, {
      email: `kopi-b+${runId}@mesinpos.test`,
      name: "Pemilik Kopi B",
    });

    const alamatDiminta = `kopi-senja-${runId}`;
    const bisnisA = await client.mutation(api.tenants.create, {
      ownerId: pemilikA,
      name: "Kopi Senja",
      slug: alamatDiminta,
      planKey: "professional",
      storeName: "Pusat A",
      verticals: ["umkm"],
    });
    // Nama sama dan alamat yang diminta juga sama: bisnis kedua tidak boleh
    // ditolak, dan tidak boleh dilempar ke workspace bisnis pertama.
    const bisnisB = await client.mutation(api.tenants.create, {
      ownerId: pemilikB,
      name: "Kopi Senja",
      slug: alamatDiminta,
      planKey: "professional",
      storeName: "Pusat B",
      verticals: ["umkm"],
    });

    check(
      "dua bisnis bernama sama tidak berbagi workspace",
      bisnisA.tenantId !== bisnisB.tenantId && bisnisA.storeId !== bisnisB.storeId,
      JSON.stringify({ a: bisnisA.tenantId, b: bisnisB.tenantId }),
    );
    check(
      "pendaftar kedua mendapat alamat sendiri, bukan alamat orang lain",
      bisnisB.slug === `${alamatDiminta}-2` && bisnisA.slug === alamatDiminta,
      JSON.stringify({ a: bisnisA.slug, b: bisnisB.slug }),
    );
    check(
      "kedua pendaftaran membuat workspace baru (bukan memakai milik orang lain)",
      bisnisA.reused === false && bisnisB.reused === false,
      JSON.stringify({ a: bisnisA.reused, b: bisnisB.reused }),
    );

    const milikA = await client.query(api.tenants.listMine, { userId: pemilikA });
    const milikB = await client.query(api.tenants.listMine, { userId: pemilikB });
    check(
      "tiap akun hanya melihat workspace miliknya sendiri",
      milikA.length === 1 &&
        milikB.length === 1 &&
        milikA[0].tenant._id === bisnisA.tenantId &&
        milikB[0].tenant._id === bisnisB.tenantId,
      JSON.stringify({
        a: milikA.map((r) => r.tenant.slug),
        b: milikB.map((r) => r.tenant.slug),
      }),
    );
    check(
      "pendaftar menjadi pemilik (owner) di workspace masing-masing",
      milikA[0].role === "owner" && milikB[0].role === "owner",
      JSON.stringify({ a: milikA[0].role, b: milikB[0].role }),
    );
    // Identitas inilah yang diadopsi sesi perangkat baru; kalau ada yang hilang,
    // pemulihan workspace akan menampilkan data default, bukan milik bisnisnya.
    check(
      "workspace membawa identitas lengkap untuk pemulihan sesi",
      milikB[0].tenant.name === "Kopi Senja" &&
        milikB[0].tenant.planKey === "professional" &&
        milikB[0].tenant.verticals.join(",") === "umkm" &&
        typeof milikB[0].tenant.createdAt === "number" &&
        typeof milikB[0].tenant.trialEndsAt === "number",
      JSON.stringify({
        name: milikB[0].tenant.name,
        planKey: milikB[0].tenant.planKey,
        verticals: milikB[0].tenant.verticals,
        createdAt: typeof milikB[0].tenant.createdAt,
        trialEndsAt: typeof milikB[0].tenant.trialEndsAt,
      }),
    );

    // Membaca dan menulis workspace orang lain harus tetap ditolak walau kedua
    // bisnis memakai nama yang sama — di sinilah "berdiri sendiri" diuji.
    {
      let bacaDitolak = null;
      try {
        await client.query(api.products.listByStore, {
          tenantId: bisnisA.tenantId,
          storeId: bisnisA.storeId,
          actorId: pemilikB,
        });
      } catch (error) {
        bacaDitolak = error?.message ?? String(error);
      }
      check(
        "pemilik bisnis kedua ditolak membaca katalog bisnis pertama",
        typeof bacaDitolak === "string" && bacaDitolak.includes("bukan anggota"),
        bacaDitolak ?? "DITERIMA — katalog bisnis lain bisa dibaca",
      );

      let tulisDitolak = null;
      try {
        await client.mutation(api.products.create, {
          tenantId: bisnisA.tenantId,
          storeId: bisnisA.storeId,
          name: `Produk Titipan ${runId}`,
          price: 15000,
          trackStock: false,
          actorId: pemilikB,
        });
      } catch (error) {
        tulisDitolak = error?.message ?? String(error);
      }
      check(
        "pemilik bisnis kedua ditolak menulis ke katalog bisnis pertama",
        typeof tulisDitolak === "string" && tulisDitolak.includes("bukan anggota"),
        tulisDitolak ?? "DITERIMA — bisnis lain bisa ditulisi",
      );
    }

    // Data yang benar-benar disimpan juga terpisah, bukan hanya pagarnya.
    await client.mutation(api.products.create, {
      tenantId: bisnisB.tenantId,
      storeId: bisnisB.storeId,
      name: `Menu B ${runId}`,
      price: 20000,
      trackStock: false,
      actorId: pemilikB,
    });
    const katalogA = await client.query(api.products.listByStore, {
      tenantId: bisnisA.tenantId,
      storeId: bisnisA.storeId,
      actorId: pemilikA,
    });
    check(
      "produk bisnis kedua tidak muncul di katalog bisnis pertama",
      katalogA.every((p) => p.name !== `Menu B ${runId}`),
      JSON.stringify(katalogA.map((p) => p.name)),
    );

    // Tiap workspace mengatur dirinya sendiri: pilihan modul di satu bisnis tidak
    // mengubah bisnis lain walau namanya sama.
    const modulB = await client.mutation(api.modules.setForTenant, {
      tenantId: bisnisB.tenantId,
      actorId: pemilikB,
      verticals: ["umkm", "fnb"],
    });
    const modulA = await client.query(api.modules.getForTenant, {
      tenantId: bisnisA.tenantId,
      actorId: pemilikA,
    });
    check(
      "mengubah modul di satu bisnis tidak menyentuh bisnis lain",
      modulB.verticals.length === 2 && modulA.verticals.join(",") === "umkm",
      JSON.stringify({ b: modulB.verticals, a: modulA.verticals }),
    );

    // Onboarding ulang (perangkat baru dengan sesi kosong) harus memakai kembali
    // workspace yang sudah ada — bukan mendirikan bisnis kedua.
    const ulang = await client.mutation(api.tenants.create, {
      ownerId: pemilikB,
      name: "Kopi Senja",
      slug: bisnisB.slug,
      planKey: "professional",
      storeName: "Pusat B",
      verticals: ["umkm"],
    });
    check(
      "mendaftar ulang memakai kembali workspace sendiri",
      ulang.reused === true &&
        ulang.tenantId === bisnisB.tenantId &&
        ulang.slug === bisnisB.slug,
      JSON.stringify(ulang),
    );
    const milikBSetelah = await client.query(api.tenants.listMine, {
      userId: pemilikB,
    });
    check(
      "onboarding ulang tidak menumpuk workspace kedua",
      milikBSetelah.length === 1 &&
        milikBSetelah[0].tenant._id === bisnisB.tenantId,
      JSON.stringify(milikBSetelah.map((r) => r.tenant.slug)),
    );
    // Modul yang tadi dinyalakan bisnis kedua tetap seperti diatur pemiliknya:
    // jalur pakai-ulang tidak boleh menimpa pengaturan workspace.
    const modulBSetelah = await client.query(api.modules.getForTenant, {
      tenantId: bisnisB.tenantId,
      actorId: pemilikB,
    });
    check(
      "pengaturan workspace tidak tertimpa saat mendaftar ulang",
      modulBSetelah.verticals.join(",") === "umkm,fnb",
      JSON.stringify(modulBSetelah.verticals),
    );
  }

  // ------------- anggota tim baru di **bisnis yang sama** (tim, bukan bisnis) --
  // Undangan mengikat **email**, bukan perangkat: yang diundang masuk sendiri lewat
  // kode OTP ke email itu, dan karena keanggotaannya ada di server ia berada di
  // workspace pengundang. Yang diperiksa di sini: akunnya benar-benar akun orang itu
  // (bukan akun kedua beremail sama), ia TIDAK mendapat bisnis baru untuk dirinya,
  // undangan ulang jadi perubahan peran, dan pagar izinnya berlaku.
  {
    // Workspace-nya dicari dari keanggotaan pemiliknya lagi — cara yang sama
    // dengan perangkat baru yang sesinya kosong.
    const { userId: pemilikBisnis } = await client.mutation(api.users.createOrGet, {
      email: `kopi-a+${runId}@mesinpos.test`,
      name: "Pemilik Kopi A",
    });
    const milikPemilik = await client.query(api.tenants.listMine, {
      userId: pemilikBisnis,
    });
    const bisnis = milikPemilik[0].tenant;
    const cabang = (
      await client.query(api.tenants.listStores, {
        tenantId: bisnis._id,
        actorId: pemilikBisnis,
      })
    )[0];

    const emailStaf = `kasir-baru+${runId}@mesinpos.test`;
    const undangan = await client.mutation(api.members.add, {
      tenantId: bisnis._id,
      actorId: pemilikBisnis,
      email: emailStaf,
      name: "Kasir Baru",
      role: "cashier",
    });
    check(
      "undangan anggota tim membuat keanggotaan di workspace pengundang",
      undangan.created === true && typeof undangan.membershipId === "string",
      JSON.stringify(undangan),
    );

    // Orangnya masuk dengan email itu: harus baris `users` yang sama dengan yang
    // dibuat undangan, bukan akun kedua untuk email yang sama.
    const { userId: akunKasir } = await client.mutation(api.users.createOrGet, {
      email: emailStaf,
      name: "Kasir Baru",
    });
    check(
      "undangan terikat ke akun yang dipakai orangnya untuk masuk",
      akunKasir === undangan.userId,
      JSON.stringify({ undangan: undangan.userId, masuk: akunKasir }),
    );

    const workspaceKasir = await client.query(api.tenants.listMine, {
      userId: akunKasir,
    });
    check(
      "akun yang diundang berada di bisnis pengundang, bukan bisnis baru",
      workspaceKasir.length === 1 &&
        workspaceKasir[0].tenant._id === bisnis._id &&
        workspaceKasir[0].role === "cashier",
      JSON.stringify(workspaceKasir.map((row) => `${row.tenant.slug}:${row.role}`)),
    );

    const katalogKasir = await client.query(api.products.listByStore, {
      tenantId: bisnis._id,
      storeId: cabang._id,
      actorId: akunKasir,
    });
    check(
      "anggota yang diundang bisa membaca data bisnis tempatnya bekerja",
      Array.isArray(katalogKasir),
      typeof katalogKasir,
    );

    // Peran kasir **memang ditolak** server untuk katalog pengelolaan, dan itulah
    // sebab laporan “Halaman ini gagal dimuat”: langganan Convex yang ditolak
    // menggagalkan halaman yang memuatnya. Dua sisi yang dipastikan di sini: server
    // tetap menolaknya (isolasi izin tidak dilonggarkan), dan `roles.myAccess` —
    // sumber izin yang dipakai klien untuk memutuskan berlangganan — jujur
    // melaporkan bahwa kasir tidak memegang `product.manage`.
    const aksesKasir = await client.query(api.roles.myAccess, {
      tenantId: bisnis._id,
      actorId: akunKasir,
    });
    check(
      "roles.myAccess kasir: peran terbaca & tanpa product.manage",
      aksesKasir.role === "cashier" &&
        aksesKasir.permissions.includes("pos.sell") &&
        !aksesKasir.permissions.includes("product.manage"),
      JSON.stringify({ role: aksesKasir.role, izin: aksesKasir.permissions }),
    );

    let katalogPengelolaan = null;
    try {
      await client.query(api.products.listAll, {
        tenantId: bisnis._id,
        storeId: cabang._id,
        actorId: akunKasir,
      });
    } catch (error) {
      katalogPengelolaan = error?.message ?? String(error);
    }
    check(
      "kasir ditolak membaca katalog pengelolaan (products.listAll)",
      typeof katalogPengelolaan === "string" &&
        katalogPengelolaan.includes("product.manage"),
      katalogPengelolaan ?? "DITERIMA — kasir bisa membaca katalog pengelolaan",
    );

    let kasirDitolak = null;
    try {
      await client.mutation(api.members.add, {
        tenantId: bisnis._id,
        actorId: akunKasir,
        email: `anggota-lain+${runId}@mesinpos.test`,
        role: "cashier",
      });
    } catch (error) {
      kasirDitolak = error?.message ?? String(error);
    }
    check(
      "kasir ditolak mendaftarkan anggota tim berikutnya (izin team.manage)",
      typeof kasirDitolak === "string" && kasirDitolak.includes("izin team.manage"),
      kasirDitolak ?? "DITERIMA — kasir boleh mendaftarkan anggota",
    );

    const ulangAnggota = await client.mutation(api.members.add, {
      tenantId: bisnis._id,
      actorId: pemilikBisnis,
      email: emailStaf,
      role: "manager",
    });
    check(
      "undangan ulang memperbarui peran anggota yang sama",
      ulangAnggota.created === false &&
        ulangAnggota.membershipId === undangan.membershipId &&
        ulangAnggota.userId === akunKasir,
      JSON.stringify(ulangAnggota),
    );

    const daftarA = await client.query(api.members.list, {
      tenantId: bisnis._id,
      actorId: pemilikBisnis,
    });
    check(
      "anggota yang sama tidak muncul dua kali di daftar tim",
      daftarA.filter((row) => row.user.email === emailStaf).length === 1,
      JSON.stringify(daftarA.map((row) => row.user.email)),
    );

    // Email yang tidak bisa menerima kode ditolak undangannya — aturan yang sama
    // dengan halaman masuk (`validateTeamInvite` dipakai server).
    let emailDitolak = null;
    try {
      await client.mutation(api.members.add, {
        tenantId: bisnis._id,
        actorId: pemilikBisnis,
        email: "staf@toko",
        role: "cashier",
      });
    } catch (error) {
      emailDitolak = error?.message ?? String(error);
    }
    check(
      "undangan ditolak untuk email yang tidak bisa menerima kode",
      typeof emailDitolak === "string" &&
        emailDitolak.includes("Domain email harus punya titik"),
      emailDitolak ?? "DITERIMA — email tanpa titik bisa diundang",
    );
  }

  // ------------- email undangan: dikirim, dicatat, dan bisa dikirim ulang ----
  // "Kirim undangan ke anggota tim untuk login ke workspace" hanya benar-benar
  // terjadi kalau pengirimannya **dijadwalkan server** dan hasilnya ditulis balik
  // ke baris keanggotaan. Yang diuji di sini: jejak kirimnya muncul, alamat uji
  // `.test` tidak dikirimi email (aturan yang sama dengan kode masuk), kirim ulang
  // menambah percobaan, dan izin yang sama berlaku untuk aksi itu.
  {
    const { userId: pemilikUndangan } = await client.mutation(api.users.createOrGet, {
      email: `kopi-a+${runId}@mesinpos.test`,
      name: "Pemilik Kopi A",
    });
    const bisnisUndangan = (
      await client.query(api.tenants.listMine, { userId: pemilikUndangan })
    )[0].tenant;

    const emailUndangan = `undangan+${runId}@mesinpos.test`;
    const baris = await client.mutation(api.members.add, {
      tenantId: bisnisUndangan._id,
      actorId: pemilikUndangan,
      email: emailUndangan,
      name: "Anggota Undangan",
      role: "cashier",
    });

    // Aksi pengiriman dijadwalkan (`runAfter(0)`), jadi jejaknya muncul sesaat
    // kemudian — ditunggu sebentar, bukan diasumsikan langsung ada.
    const bacaAnggota = async () => {
      const rows = await client.query(api.members.list, {
        tenantId: bisnisUndangan._id,
        actorId: pemilikUndangan,
      });
      return rows.find((row) => row.membership._id === baris.membershipId)?.membership ?? null;
    };
    let anggota = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      anggota = await bacaAnggota();
      if (anggota?.inviteSentVia) break;
      await sleep(250);
    }

    check(
      "undangan anggota dijadwalkan dan hasil kirimnya dicatat",
      anggota?.inviteSentVia === "uji" &&
        typeof anggota?.inviteSentAt === "number" &&
        anggota?.inviteError === undefined,
      JSON.stringify({
        via: anggota?.inviteSentVia,
        sentAt: anggota?.inviteSentAt,
        error: anggota?.inviteError,
      }),
    );
    check(
      "jumlah percobaan kirim undangan tercatat",
      anggota?.inviteAttempts === 1,
      String(anggota?.inviteAttempts),
    );

    // Pagar izin berlaku untuk kirim ulang juga: kasir tidak boleh mengirim
    // undangan apa pun, termasuk mengulang milik orang lain.
    let kirimUlangKasir = null;
    try {
      await client.mutation(api.members.resendInvite, {
        tenantId: bisnisUndangan._id,
        actorId: baris.userId,
        membershipId: baris.membershipId,
      });
    } catch (error) {
      kirimUlangKasir = error?.message ?? String(error);
    }
    check(
      "kasir ditolak mengirim ulang undangan (izin team.manage)",
      typeof kirimUlangKasir === "string" && kirimUlangKasir.includes("izin team.manage"),
      kirimUlangKasir ?? "DITERIMA — kasir bisa mengirim ulang undangan",
    );

    const ulang = await client.mutation(api.members.resendInvite, {
      tenantId: bisnisUndangan._id,
      actorId: pemilikUndangan,
      membershipId: baris.membershipId,
    });
    check(
      "pemilik bisa menjadwalkan ulang undangan",
      ulang.queued === true && ulang.email === emailUndangan,
      JSON.stringify(ulang),
    );

    let setelahUlang = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      setelahUlang = await bacaAnggota();
      if ((setelahUlang?.inviteAttempts ?? 0) >= 2) break;
      await sleep(250);
    }
    check(
      "kirim ulang menambah percobaan kirim pada anggota yang sama",
      setelahUlang?.inviteAttempts === 2 && setelahUlang?.inviteSentVia === "uji",
      JSON.stringify({
        attempts: setelahUlang?.inviteAttempts,
        via: setelahUlang?.inviteSentVia,
      }),
    );

    // Isi emailnya diperiksa dari aturan murni yang dipakai aksi pengirim: tanpa
    // ini, "email undangan" bisa saja berisi tautan salah atau peran yang keliru.
    const isi = inviteEmailContent({
      workspace: "Kopi Senja",
      email: emailUndangan,
      name: "Anggota Undangan",
      role: "cashier",
      invitedBy: "Pemilik Kopi A",
      loginUrl: inviteLoginUrl("https://mesinpos.id/"),
    });
    check(
      "email undangan menyebut workspace, peran, dan cara masuknya",
      isi.subject.includes("Kopi Senja") &&
        isi.text.includes(emailUndangan) &&
        isi.text.includes(ROLE_LABELS.cashier) &&
        isi.text.includes("https://mesinpos.id/auth") &&
        isi.text.includes("kode 6 digit") &&
        isi.text.includes("Pemilik Kopi A") &&
        // Tanpa kode yang diminta sendiri, email ini tidak bisa dipakai masuk
        // oleh siapa pun yang menemukannya.
        isi.text.includes("tidak ada yang bisa masuk ke akun ini"),
      isi.text.slice(0, 300),
    );
    check(
      "email undangan tanpa SITE_URL menyebut halamannya tanpa mengarang alamat",
      inviteLoginUrl(null) === null &&
        inviteEmailContent({
          workspace: "Kopi Senja",
          email: emailUndangan,
          role: "manager",
          loginUrl: inviteLoginUrl(undefined),
        }).text.includes("halaman Masuk MesinPOS"),
      String(inviteLoginUrl(undefined)),
    );
  }

  // ---- undangan WhatsApp + kelola anggota: ubah, aktif/nonaktif, hapus -------
  // "Kirim undangan lewat WA ke tim yang sudah dibuat" dan "tambah, edit,
  // aktif/nonaktif, hapus untuk semua akun tim" hanya benar kalau servernya
  // menyimpannya: nomor WA tersimpan dalam bentuk yang dikenali `wa.me`, perubahan
  // benar-benar menulis, penghapusan menghilangkan keanggotaan **tanpa** menghapus
  // akunnya, dan pagar izin yang sama berlaku untuk semua aksi itu.
  {
    const { userId: pemilikKelola } = await client.mutation(api.users.createOrGet, {
      email: `kopi-a+${runId}@mesinpos.test`,
      name: "Pemilik Kopi A",
    });
    const bisnisKelola = (
      await client.query(api.tenants.listMine, { userId: pemilikKelola })
    )[0].tenant;

    const bacaDaftar = () =>
      client.query(api.members.list, {
        tenantId: bisnisKelola._id,
        actorId: pemilikKelola,
      });
    const cariBaris = async (membershipId) =>
      (await bacaDaftar()).find((row) => row.membership._id === membershipId) ??
      null;

    const emailWa = `wa-baru+${runId}@mesinpos.test`;
    const barisWa = await client.mutation(api.members.add, {
      tenantId: bisnisKelola._id,
      actorId: pemilikKelola,
      email: emailWa,
      name: "Anggota WA",
      phone: "0812-9999-8888",
      role: "cashier",
    });
    const waTersimpan = await cariBaris(barisWa.membershipId);
    check(
      "nomor WhatsApp anggota disimpan dalam bentuk yang dikenali wa.me",
      waTersimpan?.membership.phone === "6281299998888",
      String(waTersimpan?.membership.phone),
    );
    check(
      "undangan WhatsApp belum dianggap terkirim sebelum tautannya dibuka",
      waTersimpan?.membership.waInviteAt === undefined &&
        waTersimpan?.membership.waInviteCount === undefined,
      JSON.stringify({
        at: waTersimpan?.membership.waInviteAt,
        count: waTersimpan?.membership.waInviteCount,
      }),
    );

    // Nomor yang tidak bisa dibuka `wa.me` ditolak **sebelum** keanggotaannya jadi.
    let nomorDitolak = null;
    try {
      await client.mutation(api.members.add, {
        tenantId: bisnisKelola._id,
        actorId: pemilikKelola,
        email: `wa-salah+${runId}@mesinpos.test`,
        phone: "0812",
        role: "cashier",
      });
    } catch (error) {
      nomorDitolak = error?.message ?? String(error);
    }
    check(
      "nomor WhatsApp salah bentuk ditolak saat mendaftarkan anggota",
      typeof nomorDitolak === "string" && nomorDitolak.includes("8–15 digit"),
      nomorDitolak ?? "DITERIMA — nomor 4 digit tersimpan",
    );

    // Membuka tautan undangan WA dicatat di server — satu-satunya bukti yang
    // jujur, karena pesannya dikirim dari aplikasi WhatsApp pengundang.
    const catatWa = await client.mutation(api.members.recordWaInvite, {
      tenantId: bisnisKelola._id,
      actorId: pemilikKelola,
      membershipId: barisWa.membershipId,
    });
    const setelahCatat = await cariBaris(barisWa.membershipId);
    check(
      "undangan WhatsApp dicatat sebagai tautan yang dibuka",
      catatWa.recorded === true &&
        typeof setelahCatat?.membership.waInviteAt === "number" &&
        setelahCatat?.membership.waInviteCount === 1,
      JSON.stringify({
        recorded: catatWa.recorded,
        count: setelahCatat?.membership.waInviteCount,
      }),
    );
    await client.mutation(api.members.recordWaInvite, {
      tenantId: bisnisKelola._id,
      actorId: pemilikKelola,
      membershipId: barisWa.membershipId,
    });
    const setelahDuaKali = await cariBaris(barisWa.membershipId);
    check(
      "pembukaan tautan kedua menambah jumlah undangan WhatsApp",
      setelahDuaKali?.membership.waInviteCount === 2,
      String(setelahDuaKali?.membership.waInviteCount),
    );

    // Anggota tanpa nomor: tautan WA tidak punya tujuan, jadi permintaannya ditolak
    // apa adanya — bukan dicatat sebagai terkirim ke nomor kosong.
    const emailTanpaNomor = `tanpa-wa+${runId}@mesinpos.test`;
    const barisTanpaNomor = await client.mutation(api.members.add, {
      tenantId: bisnisKelola._id,
      actorId: pemilikKelola,
      email: emailTanpaNomor,
      name: "Tanpa Nomor",
      role: "cashier",
    });
    let waTanpaNomor = null;
    try {
      await client.mutation(api.members.recordWaInvite, {
        tenantId: bisnisKelola._id,
        actorId: pemilikKelola,
        membershipId: barisTanpaNomor.membershipId,
      });
    } catch (error) {
      waTanpaNomor = error?.message ?? String(error);
    }
    check(
      "undangan WhatsApp ditolak untuk anggota tanpa nomor",
      typeof waTanpaNomor === "string" &&
        waTanpaNomor.includes("belum punya nomor WhatsApp"),
      waTanpaNomor ?? "DITERIMA — undangan WA tanpa nomor dicatat",
    );

    // ------------------------------- ubah anggota --------------------------
    const ubah = await client.mutation(api.members.update, {
      tenantId: bisnisKelola._id,
      actorId: pemilikKelola,
      membershipId: barisWa.membershipId,
      name: "Anggota WA Diubah",
      phone: "0813-1111-2222",
      active: false,
    });
    const setelahUbah = await cariBaris(barisWa.membershipId);
    check(
      "nama, nomor WhatsApp, dan status tersimpan sebagai satu perubahan",
      ubah.changed.includes("name") &&
        ubah.changed.includes("phone") &&
        ubah.changed.includes("active") &&
        setelahUbah?.user.name === "Anggota WA Diubah" &&
        setelahUbah?.membership.phone === "6281311112222" &&
        setelahUbah?.membership.active === false &&
        // Peran yang tidak disebut tidak ikut berubah.
        setelahUbah?.membership.role === "cashier",
      JSON.stringify({
        changed: ubah.changed,
        phone: setelahUbah?.membership.phone,
        active: setelahUbah?.membership.active,
      }),
    );

    // Keanggotaan nonaktif **tetap dilaporkan** `listMine` dengan penanda
    // `active: false`. Klien memakai penanda itu untuk berhenti berlangganan data
    // workspace sebelum server sempat menolaknya (kalau ditolak, halaman anggota
    // tersebut gagal dimuat); dan barisnya sengaja tidak disembunyikan, karena
    // akun tanpa keanggotaan sama sekali justru dibuatkan workspace baru dari sisa
    // sesi perangkatnya.
    if (!setelahUbah?.membership.userId) {
      throw new Error("Uji keanggotaan nonaktif: baris anggota tidak terbaca.");
    }
    const workspaceNonaktif = await client.query(api.tenants.listMine, {
      userId: setelahUbah.membership.userId,
    });
    check(
      "keanggotaan nonaktif tetap terlihat di listMine dengan penanda active:false",
      workspaceNonaktif.length === 1 &&
        workspaceNonaktif[0].active === false &&
        workspaceNonaktif[0].role === "cashier",
      JSON.stringify(
        workspaceNonaktif.map((row) => `${row.tenant.slug}:${row.role}:${row.active}`),
      ),
    );

    const kosongkanNomor = await client.mutation(api.members.update, {
      tenantId: bisnisKelola._id,
      actorId: pemilikKelola,
      membershipId: barisWa.membershipId,
      phone: null,
    });
    const setelahNomorDihapus = await cariBaris(barisWa.membershipId);
    check(
      "nomor WhatsApp yang dikosongkan berarti dihapus, bukan disimpan kosong",
      kosongkanNomor.changed.includes("phone") &&
        setelahNomorDihapus?.membership.phone === undefined,
      String(setelahNomorDihapus?.membership.phone),
    );

    // Nama & email hidup di baris akun — memperbaikinya berarti memperbaiki jalan
    // masuk orang itu, jadi hasilnya dibaca dari akunnya, bukan dari catatan klien.
    const emailBaru = `wa-pindah+${runId}@mesinpos.test`;
    const gantiEmail = await client.mutation(api.members.update, {
      tenantId: bisnisKelola._id,
      actorId: pemilikKelola,
      membershipId: barisWa.membershipId,
      email: emailBaru,
    });
    const setelahGantiEmail = await cariBaris(barisWa.membershipId);
    check(
      "email anggota bisa diperbaiki dan ikut berubah di akunnya",
      gantiEmail.changed.includes("email") &&
        setelahGantiEmail?.user.email === emailBaru,
      String(setelahGantiEmail?.user.email),
    );
    check(
      "mengubah tanpa perubahan tidak menulis apa pun",
      (
        await client.mutation(api.members.update, {
          tenantId: bisnisKelola._id,
          actorId: pemilikKelola,
          membershipId: barisWa.membershipId,
          name: "Anggota WA Diubah",
        })
      ).changed.length === 0,
      "ada field yang dianggap berubah padahal nilainya sama",
    );

    let emailBentrok = null;
    try {
      await client.mutation(api.members.update, {
        tenantId: bisnisKelola._id,
        actorId: pemilikKelola,
        membershipId: barisWa.membershipId,
        email: emailTanpaNomor,
      });
    } catch (error) {
      emailBentrok = error?.message ?? String(error);
    }
    check(
      "email milik anggota lain ditolak saat diubah",
      typeof emailBentrok === "string" &&
        emailBentrok.includes("sudah dipakai anggota lain"),
      emailBentrok ?? "DITERIMA — dua anggota bisa beremail sama",
    );

    // Pagar “pemilik terakhir” dan “akun sendiri” diuji lewat server, bukan cuma
    // di aturan murni: yang penting adalah apa yang benar-benar ditolak backend.
    const barisPemilik = (await bacaDaftar()).find(
      (row) => row.membership.userId === pemilikKelola,
    );
    let turunPemilik = null;
    try {
      await client.mutation(api.members.update, {
        tenantId: bisnisKelola._id,
        actorId: pemilikKelola,
        membershipId: barisPemilik.membership._id,
        role: "manager",
      });
    } catch (error) {
      turunPemilik = error?.message ?? String(error);
    }
    check(
      "pemilik aktif terakhir tidak bisa diturunkan",
      typeof turunPemilik === "string" &&
        turunPemilik.includes("minimal satu pemilik aktif"),
      turunPemilik ?? "DITERIMA — workspace kehilangan pemiliknya",
    );
    // Pemilik mengangkat pemilik kedua: sesudah ini workspace punya dua pemilik
    // **aktif**, sehingga pagar “akun sendiri” bisa diuji terpisah dari pagar
    // “pemilik terakhir” (urutan pagarnya memang begitu di `lib/team.ts`).
    await client.mutation(api.members.update, {
      tenantId: bisnisKelola._id,
      actorId: pemilikKelola,
      membershipId: barisWa.membershipId,
      role: "owner",
      active: true,
    });
    const pemilikKedua = await cariBaris(barisWa.membershipId);
    check(
      "pemilik boleh mengangkat anggota lain menjadi pemilik",
      pemilikKedua?.membership.role === "owner" &&
        pemilikKedua?.membership.active === true,
      JSON.stringify({
        role: pemilikKedua?.membership.role,
        active: pemilikKedua?.membership.active,
      }),
    );

    let nonaktifSendiri = null;
    try {
      await client.mutation(api.members.update, {
        tenantId: bisnisKelola._id,
        actorId: pemilikKelola,
        membershipId: barisPemilik.membership._id,
        active: false,
      });
    } catch (error) {
      nonaktifSendiri = error?.message ?? String(error);
    }
    check(
      "akun sendiri tidak bisa dinonaktifkan dari server",
      typeof nonaktifSendiri === "string" &&
        nonaktifSendiri.includes("Akun Anda sendiri tidak bisa dinonaktifkan"),
      nonaktifSendiri ?? "DITERIMA — pemilik menonaktifkan dirinya sendiri",
    );

    // ------------------------------- hapus anggota -------------------------
    let hapusSendiri = null;
    try {
      await client.mutation(api.members.remove, {
        tenantId: bisnisKelola._id,
        actorId: pemilikKelola,
        membershipId: barisPemilik.membership._id,
      });
    } catch (error) {
      hapusSendiri = error?.message ?? String(error);
    }
    check(
      "akun sendiri tidak bisa dihapus dari tim lewat server",
      typeof hapusSendiri === "string" &&
        hapusSendiri.includes("Akun Anda sendiri tidak bisa dihapus"),
      hapusSendiri ?? "DITERIMA — pemilik menghapus aksesnya sendiri",
    );

    // Kasir (tanpa `team.manage`) ditolak untuk **semua** aksi pengelolaan:
    // undangan WA, ubah, dan hapus memakai pagar izin yang sama.
    const alasanKasir = async (action) => {
      try {
        await action();
        return null;
      } catch (error) {
        return error?.message ?? String(error);
      }
    };
    const kasirWa = await alasanKasir(() =>
      client.mutation(api.members.recordWaInvite, {
        tenantId: bisnisKelola._id,
        actorId: barisTanpaNomor.userId,
        membershipId: barisWa.membershipId,
      }),
    );
    const kasirUbah = await alasanKasir(() =>
      client.mutation(api.members.update, {
        tenantId: bisnisKelola._id,
        actorId: barisTanpaNomor.userId,
        membershipId: barisWa.membershipId,
        name: "Diubah Kasir",
      }),
    );
    const kasirHapus = await alasanKasir(() =>
      client.mutation(api.members.remove, {
        tenantId: bisnisKelola._id,
        actorId: barisTanpaNomor.userId,
        membershipId: barisWa.membershipId,
      }),
    );
    check(
      "kasir ditolak mengirim undangan WhatsApp (izin team.manage)",
      typeof kasirWa === "string" && kasirWa.includes("izin team.manage"),
      kasirWa ?? "DITERIMA — kasir boleh mengirim undangan WA",
    );
    check(
      "kasir ditolak mengubah anggota tim (izin team.manage)",
      typeof kasirUbah === "string" && kasirUbah.includes("izin team.manage"),
      kasirUbah ?? "DITERIMA — kasir boleh mengubah anggota",
    );
    check(
      "kasir ditolak menghapus anggota tim (izin team.manage)",
      typeof kasirHapus === "string" && kasirHapus.includes("izin team.manage"),
      kasirHapus ?? "DITERIMA — kasir boleh menghapus anggota",
    );

    const hapus = await client.mutation(api.members.remove, {
      tenantId: bisnisKelola._id,
      actorId: pemilikKelola,
      membershipId: barisTanpaNomor.membershipId,
    });
    const daftarSetelahHapus = await bacaDaftar();
    check(
      "anggota yang dihapus hilang dari daftar tim",
      hapus.removed === true &&
        hapus.email === emailTanpaNomor &&
        !daftarSetelahHapus.some(
          (row) => row.membership._id === barisTanpaNomor.membershipId,
        ),
      JSON.stringify({ hapus, jumlah: daftarSetelahHapus.length }),
    );

    // Akunnya **bukan** ikut terhapus: orangnya bisa diundang lagi atau jadi
    // anggota workspace lain, dan membuang baris `users` akan membuat akun
    // kedua beremail sama. Masuk dengan email itu harus akun yang sama.
    const { userId: akunBekas } = await client.mutation(api.users.createOrGet, {
      email: emailTanpaNomor,
      name: "Tanpa Nomor",
    });
    check(
      "menghapus dari tim tidak menghapus akunnya",
      akunBekas === barisTanpaNomor.userId,
      JSON.stringify({ dulunya: barisTanpaNomor.userId, sekarang: akunBekas }),
    );
    const workspaceBekas = await client.query(api.tenants.listMine, {
      userId: akunBekas,
    });
    check(
      "bekas anggota kehilangan akses ke workspace itu",
      !workspaceBekas.some((row) => row.tenant._id === bisnisKelola._id),
      JSON.stringify(workspaceBekas.map((row) => row.tenant.slug)),
    );
  }

  // ------------- halaman Profil: identitas orangnya & identitas usahanya ---
  //
  // Dua mutation, dua pemilik data: `users.updateProfile` (profil orangnya
  // sendiri — setiap peran boleh, karena itu tidak ada izin peran yang
  // dibutuhkan) dan `tenants.updateProfile` (identitas usaha — `billing.manage`,
  // berjejak audit). Keduanya memakai aturan murni yang sama dengan halaman
  // Profil & kedua store, jadi yang diperiksa di sini adalah kontrak servernya:
  // siapa yang boleh, apa yang benar-benar tersimpan (`08…` → `628…`), dan apa
  // yang ditolak tanpa mengubah apa pun.
  {
    const profilSuffix = `${runId}-profil`;
    const { userId: profilOwnerId } = await client.mutation(api.users.createOrGet, {
      email: `profil-owner+${profilSuffix}@mesinpos.test`,
      name: "Pemilik Uji Profil",
    });
    const { tenantId: profilTenantId } = await client.mutation(api.tenants.create, {
      ownerId: profilOwnerId,
      name: "Toko Uji Profil",
      slug: `verify-profil-${runId}`,
      planKey: "starter",
      storeName: "Cabang Profil",
    });
    const profilKasirEmail = `profil-kasir+${profilSuffix}@mesinpos.test`;
    const { userId: profilKasirId } = await client.mutation(api.users.createOrGet, {
      email: profilKasirEmail,
      name: "Kasir Uji Profil",
    });
    await client.mutation(api.members.add, {
      tenantId: profilTenantId,
      actorId: profilOwnerId,
      email: profilKasirEmail,
      name: "Kasir Uji Profil",
      role: "cashier",
    });
    const { userId: profilLuarId } = await client.mutation(api.users.createOrGet, {
      email: `profil-luar+${profilSuffix}@mesinpos.test`,
      name: "Orang Luar Profil",
    });

    // ── profil orangnya: kasir boleh memperbaiki namanya sendiri ──────────
    const profilOrang = await client.mutation(api.users.updateProfile, {
      userId: profilKasirId,
      name: "  Kasir   Profil ",
      phone: "0812-3456-7890",
    });
    check(
      "kasir menyimpan profilnya sendiri tanpa izin peran (nama dirapikan, nomor jadi wa.me)",
      profilOrang.changed === true &&
        profilOrang.name === "Kasir Profil" &&
        profilOrang.phone === "6281234567890",
      JSON.stringify(profilOrang),
    );
    check(
      "kalimat notisnya menyebut kelengkapannya",
      profilOrang.sentence === "Profil Kasir Profil tersimpan lengkap.",
      profilOrang.sentence,
    );
    const profilBaris = await client.query(api.users.get, { userId: profilKasirId });
    check(
      "yang tersimpan adalah baris pengguna itu sendiri",
      profilBaris.name === "Kasir Profil" && profilBaris.phone === "6281234567890",
      JSON.stringify({ name: profilBaris.name, phone: profilBaris.phone }),
    );

    const profilOrangSama = await client.mutation(api.users.updateProfile, {
      userId: profilKasirId,
      name: "Kasir Profil",
      phone: "6281234567890",
    });
    check(
      "menyimpan profil yang sama tidak dianggap perubahan",
      profilOrangSama.changed === false && profilOrangSama.name === "Kasir Profil",
      JSON.stringify(profilOrangSama),
    );

    for (const [label, args, harapan] of [
      ["nama satu karakter ditolak", { name: "A" }, "minimal 2 karakter"],
      ["nomor tanpa angka ditolak dengan sebabnya", { phone: "abc" }, "harus berisi angka"],
      ["nomor terlalu pendek ditolak", { phone: "0812" }, "8–15 digit"],
    ]) {
      let pesan = "";
      try {
        await client.mutation(api.users.updateProfile, { userId: profilKasirId, ...args });
      } catch (error) {
        pesan = error?.message ?? String(error);
      }
      check(`profil orang: ${label}`, pesan.includes(harapan), pesan || "diterima server");
    }
    check(
      "penolakan tidak menyentuh profil orang yang tersimpan",
      (await client.query(api.users.get, { userId: profilKasirId })).name === "Kasir Profil",
      "baris pengguna",
    );

    const profilOrangKosong = await client.mutation(api.users.updateProfile, {
      userId: profilKasirId,
      phone: "",
    });
    check(
      "mengosongkan nomor WA jadi “belum diisi”, dan namanya tidak ikut berubah",
      profilOrangKosong.changed === true &&
        profilOrangKosong.phone === null &&
        profilOrangKosong.name === "Kasir Profil" &&
        profilOrangKosong.sentence === "Profil Kasir Profil tersimpan. Belum diisi: nomor WA.",
      JSON.stringify(profilOrangKosong),
    );

    // ── profil usaha: pemilik boleh, kasir & orang luar ditolak ───────────
    const profilUsaha = await client.mutation(api.tenants.updateProfile, {
      tenantId: profilTenantId,
      actorId: profilOwnerId,
      name: "Toko Profil Jaya",
      address: "Jl. Merdeka 10, Bandung",
      email: "Halo@Profil.ID ",
      phone: "0813-1111-2222",
    });
    check(
      "pemilik menyimpan identitas usaha (nama, alamat, email, nomor wa.me)",
      profilUsaha.changed === true &&
        profilUsaha.name === "Toko Profil Jaya" &&
        profilUsaha.address === "Jl. Merdeka 10, Bandung" &&
        profilUsaha.email === "halo@profil.id" &&
        profilUsaha.phone === "6281311112222",
      JSON.stringify(profilUsaha),
    );
    check(
      "kalimat notisnya menyebut nama usaha & kelengkapannya",
      profilUsaha.sentence === "Profil usaha “Toko Profil Jaya” tersimpan lengkap.",
      profilUsaha.sentence,
    );
    const profilTenant = await client.query(api.tenants.getMine, {
      tenantId: profilTenantId,
      actorId: profilOwnerId,
    });
    check(
      "identitas usaha benar-benar tersimpan di baris tenant",
      profilTenant.name === "Toko Profil Jaya" &&
        profilTenant.address === "Jl. Merdeka 10, Bandung" &&
        profilTenant.email === "halo@profil.id" &&
        profilTenant.phone === "6281311112222",
      JSON.stringify({
        name: profilTenant.name,
        address: profilTenant.address,
        email: profilTenant.email,
        phone: profilTenant.phone,
      }),
    );

    // Dua penolakan yang berbeda sebabnya: anggota tanpa izin ditolak karena
    // izinnya, orang di luar workspace ditolak lebih dulu karena bukan anggota.
    for (const [label, actorId, harapan] of [
      [
        "kasir ditolak mengubah identitas usaha (izin billing.manage)",
        profilKasirId,
        "izin billing.manage",
      ],
      [
        "orang di luar workspace ditolak mengubah identitas usaha",
        profilLuarId,
        "bukan anggota aktif",
      ],
    ]) {
      let pesan = "";
      try {
        await client.mutation(api.tenants.updateProfile, {
          tenantId: profilTenantId,
          actorId,
          name: "Toko Dibajak",
        });
      } catch (error) {
        pesan = error?.message ?? String(error);
      }
      check(label, pesan.includes(harapan), pesan || "diterima server");
    }

    for (const [label, args, harapan] of [
      ["nama usaha satu karakter ditolak", { name: "A" }, "minimal 2 karakter"],
      ["email usaha tanpa titik ditolak", { email: "halo@toko" }, "titik"],
      [
        "alamat di atas batas ditolak",
        { address: "x".repeat(161) },
        "maksimal 160 karakter",
      ],
    ]) {
      let pesan = "";
      try {
        await client.mutation(api.tenants.updateProfile, {
          tenantId: profilTenantId,
          actorId: profilOwnerId,
          ...args,
        });
      } catch (error) {
        pesan = error?.message ?? String(error);
      }
      check(`profil usaha: ${label}`, pesan.includes(harapan), pesan || "diterima server");
    }
    const profilTenantTolak = await client.query(api.tenants.getMine, {
      tenantId: profilTenantId,
      actorId: profilOwnerId,
    });
    check(
      "satu kolom yang ditolak membatalkan seluruh penyimpanan",
      profilTenantTolak.name === "Toko Profil Jaya" &&
        profilTenantTolak.address === "Jl. Merdeka 10, Bandung" &&
        profilTenantTolak.email === "halo@profil.id" &&
        profilTenantTolak.phone === "6281311112222",
      JSON.stringify({
        name: profilTenantTolak.name,
        email: profilTenantTolak.email,
        address: profilTenantTolak.address,
      }),
    );

    const profilUsahaKosong = await client.mutation(api.tenants.updateProfile, {
      tenantId: profilTenantId,
      actorId: profilOwnerId,
      address: "",
      email: "",
      phone: "",
    });
    check(
      "mengosongkan alamat/email/nomor itu sah (jadi belum diisi, bukan galat)",
      profilUsahaKosong.changed === true &&
        profilUsahaKosong.address === null &&
        profilUsahaKosong.email === null &&
        profilUsahaKosong.phone === null &&
        profilUsahaKosong.sentence ===
          "Profil usaha “Toko Profil Jaya” tersimpan. Belum diisi: alamat, email, nomor WA.",
      JSON.stringify(profilUsahaKosong),
    );
  }

  // ------------------------------------------------------------ setelan PPN
  //
  // Tarif PPN bisa diatur besar/kecil dan bisa dimatikan — dan satu setelan itu
  // menggerakkan **dua** dokumen sekaligus: struk penjualan (`pos.createSale`)
  // dan tagihan langganan (`billing.createInvoice`). Tenant-nya sendiri dibuat di
  // sini supaya angka penjualan tenant utama tidak ikut berubah.
  {
    const ppnSuffix = `${runId}-ppn`;
    const { userId: ppnOwnerId } = await client.mutation(api.users.createOrGet, {
      email: `ppn-owner+${ppnSuffix}@mesinpos.test`,
      name: "Pemilik Uji PPN",
    });
    const { tenantId: ppnTenantId, storeId: ppnStoreId } = await client.mutation(
      api.tenants.create,
      {
        ownerId: ppnOwnerId,
        name: "Toko Uji PPN",
        slug: `verify-ppn-${runId}`,
        planKey: "professional",
        storeName: "Cabang PPN",
      },
    );

    const ppnAwal = await client.query(api.tenants.getMine, {
      tenantId: ppnTenantId,
      actorId: ppnOwnerId,
    });
    check(
      "tenant baru mulai dengan PPN 11% dan belum menulis kolom taxActive",
      ppnAwal.taxRatePct === 11 && ppnAwal.taxActive === undefined,
      JSON.stringify({ taxRatePct: ppnAwal.taxRatePct, taxActive: ppnAwal.taxActive }),
    );
    const ppnEntAwal = await client.query(api.entitlements.getForTenant, {
      tenantId: ppnTenantId,
      actorId: ppnOwnerId,
    });
    check(
      "tenant lama tanpa kolom taxActive dibaca AKTIF, bukan mati",
      ppnEntAwal.taxActive === true && ppnEntAwal.taxRatePct === 11,
      JSON.stringify({ taxActive: ppnEntAwal.taxActive, taxRatePct: ppnEntAwal.taxRatePct }),
    );

    const { productId: ppnProductId } = await client.mutation(api.products.create, {
      tenantId: ppnTenantId,
      storeId: ppnStoreId,
      sku: `PPN-${runId}`,
      name: "Barang Uji PPN",
      price: 20000,
      openingStock: 10,
      actorId: ppnOwnerId,
    });

    // Kasir & staf gudang tidak ditawari mengubah setelan uang ini.
    const ppnKasirEmail = `ppn-kasir+${ppnSuffix}@mesinpos.test`;
    const { userId: ppnKasirId } = await client.mutation(api.users.createOrGet, {
      email: ppnKasirEmail,
      name: "Kasir Uji PPN",
    });
    await client.mutation(api.members.add, {
      tenantId: ppnTenantId,
      actorId: ppnOwnerId,
      email: ppnKasirEmail,
      name: "Kasir Uji PPN",
      role: "cashier",
    });
    let ppnKasirDitolak = false;
    let ppnKasirPesan = "";
    try {
      await client.mutation(api.tenants.updateTax, {
        tenantId: ppnTenantId,
        actorId: ppnKasirId,
        active: true,
        ratePct: 5,
      });
    } catch (error) {
      ppnKasirDitolak = true;
      ppnKasirPesan = error?.message ?? String(error);
    }
    check(
      "kasir ditolak mengubah setelan PPN karena izin billing.manage",
      ppnKasirDitolak && ppnKasirPesan.includes("izin billing.manage"),
      ppnKasirPesan || "tidak ditolak sama sekali",
    );

    // Tarif diperbesar: 12,5%.
    const ppnNaik = await client.mutation(api.tenants.updateTax, {
      tenantId: ppnTenantId,
      actorId: ppnOwnerId,
      active: true,
      ratePct: 12.5,
    });
    check(
      "pemilik bisa menaikkan tarif PPN ke 12,5%",
      ppnNaik.changed === true && ppnNaik.active === true && ppnNaik.ratePct === 12.5,
      JSON.stringify(ppnNaik),
    );
    check(
      "kalimatnya menyebut tarif baru yang benar-benar berlaku",
      ppnNaik.sentence.includes("12,5%") &&
        ppnNaik.sentence.includes("penjualan lama tetap"),
      ppnNaik.sentence,
    );
    const ppnEnt = await client.query(api.entitlements.getForTenant, {
      tenantId: ppnTenantId,
      actorId: ppnOwnerId,
    });
    check(
      "entitlements mengembalikan setelan PPN yang baru",
      ppnEnt.taxActive === true && ppnEnt.taxRatePct === 12.5,
      JSON.stringify({ taxActive: ppnEnt.taxActive, taxRatePct: ppnEnt.taxRatePct }),
    );

    // Struk: 20.000 + 12,5% = 22.500.
    const ppnSale = await client.mutation(api.pos.createSale, {
      tenantId: ppnTenantId,
      storeId: ppnStoreId,
      cashierId: ppnOwnerId,
      items: [{ productId: ppnProductId, quantity: 1 }],
      payments: [{ method: "cash", amount: 22500 }],
      idempotencyKey: `ppn-naik-${ppnSuffix}`,
    });
    check(
      "penjualan memungut tarif setelan (20.000 → 22.500)",
      ppnSale.total === 22500,
      JSON.stringify(ppnSale),
    );
    const ppnRecent = await client.query(api.pos.recent, {
      tenantId: ppnTenantId,
      storeId: ppnStoreId,
      actorId: ppnOwnerId,
      limit: 5,
    });
    const ppnStruk = ppnRecent.find((row) => row._id === ppnSale.saleId);
    check(
      "struk menyimpan pajak dan tarifnya, bukan cuma totalnya",
      ppnStruk?.tax === 2500 && ppnStruk?.taxRatePct === 12.5 && ppnStruk?.total === 22500,
      JSON.stringify({ tax: ppnStruk?.tax, taxRatePct: ppnStruk?.taxRatePct }),
    );

    // Menyimpan setelan yang sama dua kali tidak menulis apa pun.
    const ppnSama = await client.mutation(api.tenants.updateTax, {
      tenantId: ppnTenantId,
      actorId: ppnOwnerId,
      active: true,
      ratePct: 12.5,
    });
    check(
      "setelan yang tidak berubah tidak dianggap perubahan",
      ppnSama.changed === false && ppnSama.ratePct === 12.5,
      JSON.stringify(ppnSama),
    );

    // Nilai yang tidak masuk akal ditolak — dan penolakan tidak mengubah apa pun.
    for (const [label, attempt, harapan] of [
      [
        "aktif dengan tarif 0% ditolak",
        () =>
          client.mutation(api.tenants.updateTax, {
            tenantId: ppnTenantId,
            actorId: ppnOwnerId,
            active: true,
            ratePct: 0,
          }),
        "tidak bisa 0%",
      ],
      [
        "tarif di atas 100% ditolak",
        () =>
          client.mutation(api.tenants.updateTax, {
            tenantId: ppnTenantId,
            actorId: ppnOwnerId,
            active: true,
            ratePct: 130,
          }),
        "maksimal 100%",
      ],
      [
        "tarif negatif ditolak",
        () =>
          client.mutation(api.tenants.updateTax, {
            tenantId: ppnTenantId,
            actorId: ppnOwnerId,
            active: true,
            ratePct: -3,
          }),
        "tidak boleh negatif",
      ],
    ]) {
      let pesan = "";
      try {
        await attempt();
      } catch (error) {
        pesan = error?.message ?? String(error);
      }
      check(label, pesan.includes(harapan), pesan || "diterima server");
    }
    const ppnSetelahTolak = await client.query(api.tenants.getMine, {
      tenantId: ppnTenantId,
      actorId: ppnOwnerId,
    });
    check(
      "penolakan tidak menyentuh tarif yang tersimpan (tetap 12,5%)",
      ppnSetelahTolak.taxRatePct === 12.5 && ppnSetelahTolak.taxActive === true,
      JSON.stringify({
        taxRatePct: ppnSetelahTolak.taxRatePct,
        taxActive: ppnSetelahTolak.taxActive,
      }),
    );

    // Tagihan langganan memakai setelan yang sama: 12,5% dari harga paket.
    const ppnInvoiceHidup = await client.mutation(api.billing.createInvoice, {
      tenantId: ppnTenantId,
      actorId: ppnOwnerId,
    });
    check(
      "tagihan langganan memungut tarif setelan",
      ppnInvoiceHidup.tax === Math.round((ppnInvoiceHidup.net * 12.5) / 100) &&
        ppnInvoiceHidup.gross === ppnInvoiceHidup.net + ppnInvoiceHidup.tax,
      JSON.stringify(ppnInvoiceHidup),
    );

    // PPN dimatikan: tarifnya tetap tersimpan, tapi tidak lagi dipungut.
    const ppnMati = await client.mutation(api.tenants.updateTax, {
      tenantId: ppnTenantId,
      actorId: ppnOwnerId,
      active: false,
      ratePct: 12.5,
    });
    check(
      "PPN bisa dimatikan dan tarifnya tidak hilang",
      ppnMati.changed === true && ppnMati.active === false && ppnMati.ratePct === 12.5,
      JSON.stringify(ppnMati),
    );
    check(
      "kalimatnya menyebut penjualan lama tidak berubah",
      ppnMati.sentence.includes("Penjualan lama tidak berubah"),
      ppnMati.sentence,
    );

    const ppnSaleMati = await client.mutation(api.pos.createSale, {
      tenantId: ppnTenantId,
      storeId: ppnStoreId,
      cashierId: ppnOwnerId,
      items: [{ productId: ppnProductId, quantity: 1 }],
      payments: [{ method: "cash", amount: 20000 }],
      idempotencyKey: `ppn-mati-${ppnSuffix}`,
    });
    check(
      "PPN dimatikan: penjualan 20.000 tidak dipungut pajak",
      ppnSaleMati.total === 20000,
      JSON.stringify(ppnSaleMati),
    );
    const ppnRecentMati = await client.query(api.pos.recent, {
      tenantId: ppnTenantId,
      storeId: ppnStoreId,
      actorId: ppnOwnerId,
      limit: 5,
    });
    const ppnStrukMati = ppnRecentMati.find((row) => row._id === ppnSaleMati.saleId);
    check(
      "struk tanpa PPN mencatat tarif 0, bukan 12,5% diam-diam",
      ppnStrukMati?.tax === 0 && ppnStrukMati?.taxRatePct === 0,
      JSON.stringify({ tax: ppnStrukMati?.tax, taxRatePct: ppnStrukMati?.taxRatePct }),
    );
    check(
      "struk lama tetap memakai tarif saat penjualannya terjadi",
      ppnStruk?.taxRatePct === 12.5 && ppnStruk?.tax === 2500,
      JSON.stringify({ taxRatePct: ppnStruk?.taxRatePct, tax: ppnStruk?.tax }),
    );

    const ppnInvoiceMati = await client.mutation(api.billing.createInvoice, {
      tenantId: ppnTenantId,
      actorId: ppnOwnerId,
    });
    check(
      "tagihan langganan ikut tanpa PPN saat setelannya dimatikan",
      ppnInvoiceMati.tax === 0 && ppnInvoiceMati.gross === ppnInvoiceMati.net,
      JSON.stringify(ppnInvoiceMati),
    );

    // Dinyalakan lagi dengan tarif kecil (5%) — pembesaran & pengecilan tarif
    // sama-sama berlaku, dan bukan cuma angka yang tersimpan.
    await client.mutation(api.tenants.updateTax, {
      tenantId: ppnTenantId,
      actorId: ppnOwnerId,
      active: true,
      ratePct: 5,
    });
    const ppnSaleKecil = await client.mutation(api.pos.createSale, {
      tenantId: ppnTenantId,
      storeId: ppnStoreId,
      cashierId: ppnOwnerId,
      items: [{ productId: ppnProductId, quantity: 1 }],
      payments: [{ method: "cash", amount: 21000 }],
      idempotencyKey: `ppn-kecil-${ppnSuffix}`,
    });
    check(
      "tarif bisa diperkecil lagi (5% → 21.000)",
      ppnSaleKecil.total === 21000,
      JSON.stringify(ppnSaleKecil),
    );

    // Di luar anggota: setelan uang workspace bukan untuk dibaca orang lain.
    let ppnOrangLuar = "";
    try {
      await client.query(api.tenants.getMine, {
        tenantId: ppnTenantId,
        actorId: outsiderId,
      });
    } catch (error) {
      ppnOrangLuar = error?.message ?? String(error);
    }
    check(
      "orang di luar workspace tidak bisa membaca setelan PPN-nya",
      ppnOrangLuar.length > 0,
      ppnOrangLuar || "dibaca tanpa penolakan",
    );
  }

  //
  // Pajak & pungutan khas F&B: PBJT (pajak daerah) menggantikan PPN di struk,
  // biaya layanan berdiri sebagai barisnya sendiri, pengecualian usaha mikro
  // benar-benar membebaskan PBJT, dan ringkasan setoran bulanannya dihitung dari
  // penjualan yang benar-benar tersimpan — bukan perkiraan klien. Tenant-nya
  // dibuat sendiri supaya angka tenant lain tidak ikut berubah.
  {
    const fnbSuffix = `${runId}-fnb`;
    const { userId: fnbOwnerId } = await client.mutation(api.users.createOrGet, {
      email: `fnb-owner+${fnbSuffix}@mesinpos.test`,
      name: "Pemilik Uji F&B",
    });
    const { tenantId: fnbTenantId, storeId: fnbStoreId } = await client.mutation(
      api.tenants.create,
      {
        ownerId: fnbOwnerId,
        name: "Kafe Uji F&B",
        slug: `verify-fnb-${runId}`,
        planKey: "professional",
        storeName: "Cabang F&B",
      },
    );
    const { productId: fnbProductId } = await client.mutation(api.products.create, {
      tenantId: fnbTenantId,
      storeId: fnbStoreId,
      sku: `FNB-${runId}`,
      name: "Kopi Uji F&B",
      price: 20000,
      openingStock: 30,
      actorId: fnbOwnerId,
    });

    // Bawaan: belum ada pungutan F&B, jadi perilaku lamanya (PPN) tidak berubah.
    const fnbEntAwal = await client.query(api.entitlements.getForTenant, {
      tenantId: fnbTenantId,
      actorId: fnbOwnerId,
    });
    check(
      "tenant baru belum memungut apa pun dari F&B, dan profilnya dibaca lengkap",
      fnbEntAwal.fnbTaxProfile.regionalActive === false &&
        fnbEntAwal.fnbTaxProfile.serviceChargeActive === false &&
        fnbEntAwal.fnbTaxProfile.umkmFinalActive === false &&
        fnbEntAwal.fnbTaxProfile.regionalRatePct === 10,
      JSON.stringify(fnbEntAwal.fnbTaxProfile),
    );

    // Kasir tidak ditawari mengubah setelan uang ini.
    const fnbKasirEmail = `fnb-kasir+${fnbSuffix}@mesinpos.test`;
    const { userId: fnbKasirId } = await client.mutation(api.users.createOrGet, {
      email: fnbKasirEmail,
      name: "Kasir Uji F&B",
    });
    await client.mutation(api.members.add, {
      tenantId: fnbTenantId,
      actorId: fnbOwnerId,
      email: fnbKasirEmail,
      name: "Kasir Uji F&B",
      role: "cashier",
    });
    let fnbKasirPesan = "";
    try {
      await client.mutation(api.tenants.updateFnbTax, {
        tenantId: fnbTenantId,
        actorId: fnbKasirId,
        profile: { regionalActive: true, regionalRatePct: 10 },
      });
    } catch (error) {
      fnbKasirPesan = error?.message ?? String(error);
    }
    check(
      "kasir ditolak mengubah setelan pajak F&B karena izin billing.manage",
      fnbKasirPesan.includes("izin billing.manage"),
      fnbKasirPesan || "tidak ditolak sama sekali",
    );

    // Setelan tidak sah ditolak **seluruhnya** — bukan disimpan sebagian.
    let fnbBatasPesan = "";
    try {
      await client.mutation(api.tenants.updateFnbTax, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
        profile: { regionalActive: true, regionalRatePct: 12 },
      });
    } catch (error) {
      fnbBatasPesan = error?.message ?? String(error);
    }
    check(
      "PBJT di atas 10% ditolak server dengan alasan batasnya",
      fnbBatasPesan.includes("10%"),
      fnbBatasPesan || "diterima server",
    );
    const fnbSetelahTolak = await client.query(api.entitlements.getForTenant, {
      tenantId: fnbTenantId,
      actorId: fnbOwnerId,
    });
    check(
      "penolakan tidak menyimpan setelan setengah jadi",
      fnbSetelahTolak.fnbTaxProfile.regionalActive === false,
      JSON.stringify(fnbSetelahTolak.fnbTaxProfile),
    );

    // Setelan sah: PBJT 10% + biaya layanan 7% + kewajiban pusat.
    const fnbSet = await client.mutation(api.tenants.updateFnbTax, {
      tenantId: fnbTenantId,
      actorId: fnbOwnerId,
      profile: {
        regionalActive: true,
        regionalRatePct: 10,
        microExemptActive: false,
        microExemptBelowIdr: 42000000,
        serviceChargeActive: true,
        serviceChargePct: 7,
        serviceChargeInTaxBase: false,
        umkmFinalActive: true,
        umkmEntityType: "perorangan",
        umkmStartYear: 2026,
        payrollTaxActive: true,
        rentTaxActive: true,
        rentMonthlyIdr: 10000000,
        rentRatePct: 10,
      },
    });
    check(
      "pemilik bisa menyimpan PBJT 10% + biaya layanan 7%",
      fnbSet.changed === true &&
        fnbSet.profile.regionalRatePct === 10 &&
        fnbSet.profile.serviceChargePct === 7,
      JSON.stringify(fnbSet.profile),
    );
    check(
      "kalimatnya memisahkan pungutan pelanggan dari kewajiban pengusaha",
      fnbSet.sentence.includes("Dari pelanggan:") &&
        fnbSet.sentence.includes("Kewajiban pengusaha:") &&
        fnbSet.sentence.includes("bukan pajak"),
      fnbSet.sentence,
    );

    // Struk: 20.000 + biaya layanan 7% (1.400) + PBJT 10% dari nilai jual (2.000).
    const fnbSale = await client.mutation(api.pos.createSale, {
      tenantId: fnbTenantId,
      storeId: fnbStoreId,
      cashierId: fnbOwnerId,
      items: [{ productId: fnbProductId, quantity: 1 }],
      payments: [{ method: "cash", amount: 23400 }],
      idempotencyKey: `fnb-pbjt-${fnbSuffix}`,
    });
    check(
      "penjualan F&B memungut PBJT 10% + biaya layanan 7% (20.000 → 23.400)",
      fnbSale.total === 23400,
      JSON.stringify(fnbSale),
    );
    const fnbRecent = await client.query(api.pos.recent, {
      tenantId: fnbTenantId,
      storeId: fnbStoreId,
      actorId: fnbOwnerId,
      limit: 5,
    });
    const fnbStruk = fnbRecent.find((row) => row._id === fnbSale.saleId);
    check(
      "struk mencatat jenis pajak (regional), tarifnya, dan biaya layanan terpisah",
      fnbStruk?.taxKind === "regional" &&
        fnbStruk?.tax === 2000 &&
        fnbStruk?.taxRatePct === 10 &&
        fnbStruk?.serviceCharge === 1400,
      JSON.stringify({
        taxKind: fnbStruk?.taxKind,
        tax: fnbStruk?.tax,
        taxRatePct: fnbStruk?.taxRatePct,
        serviceCharge: fnbStruk?.serviceCharge,
      }),
    );

    // Kalau Perda menghitung pajak termasuk biaya layanan: 10% x 21.400 = 2.140.
    await client.mutation(api.tenants.updateFnbTax, {
      tenantId: fnbTenantId,
      actorId: fnbOwnerId,
      profile: { ...fnbSet.profile, serviceChargeInTaxBase: true },
    });
    const fnbSaleDasar = await client.mutation(api.pos.createSale, {
      tenantId: fnbTenantId,
      storeId: fnbStoreId,
      cashierId: fnbOwnerId,
      items: [{ productId: fnbProductId, quantity: 1 }],
      payments: [{ method: "cash", amount: 23540 }],
      idempotencyKey: `fnb-dasar-${fnbSuffix}`,
    });
    check(
      "dasar pengenaan pajak bisa ikut menghitung biaya layanan (20.000 → 23.540)",
      fnbSaleDasar.total === 23540,
      JSON.stringify(fnbSaleDasar),
    );

    // Pengecualian usaha mikro: PBJT berhenti dipungut, PPN yang berlaku lagi.
    await client.mutation(api.tenants.updateFnbTax, {
      tenantId: fnbTenantId,
      actorId: fnbOwnerId,
      profile: {
        ...fnbSet.profile,
        microExemptActive: true,
        microExemptBelowIdr: 42000000,
        serviceChargeActive: false,
      },
    });
    const fnbSaleMikro = await client.mutation(api.pos.createSale, {
      tenantId: fnbTenantId,
      storeId: fnbStoreId,
      cashierId: fnbOwnerId,
      items: [{ productId: fnbProductId, quantity: 1 }],
      payments: [{ method: "cash", amount: 22200 }],
      idempotencyKey: `fnb-mikro-${fnbSuffix}`,
    });
    check(
      "pengecualian usaha mikro: PBJT tidak dipungut, PPN yang berlaku (20.000 → 22.200)",
      fnbSaleMikro.total === 22200,
      JSON.stringify(fnbSaleMikro),
    );
    const fnbRecentMikro = await client.query(api.pos.recent, {
      tenantId: fnbTenantId,
      storeId: fnbStoreId,
      actorId: fnbOwnerId,
      limit: 5,
    });
    const fnbStrukMikro = fnbRecentMikro.find((row) => row._id === fnbSaleMikro.saleId);
    check(
      "struk mikro mencatat jenis pajaknya ppn, bukan regional",
      fnbStrukMikro?.taxKind === "ppn" &&
        fnbStrukMikro?.taxRatePct === 11 &&
        fnbStrukMikro?.serviceCharge === 0,
      JSON.stringify({
        taxKind: fnbStrukMikro?.taxKind,
        taxRatePct: fnbStrukMikro?.taxRatePct,
        serviceCharge: fnbStrukMikro?.serviceCharge,
      }),
    );

    // Laporan pajak & pungutan F&B per bulan (`reports.fnbTaxMonths`). Batas
    // bulannya dikirim klien (waktu lokal perangkat), sama seperti ringkasan
    // harian — server tidak menebak bulan dari zona waktunya sendiri.
    const fnbBulanIni = new Date();
    const fnbWindow = (offset) => {
      const from = new Date(fnbBulanIni.getFullYear(), fnbBulanIni.getMonth() + offset, 1);
      const to = new Date(fnbBulanIni.getFullYear(), fnbBulanIni.getMonth() + offset + 1, 1);
      return {
        year: from.getFullYear(),
        monthIndex: from.getMonth(),
        from: from.getTime(),
        to: to.getTime(),
      };
    };
    const fnbBulanLalu = fnbWindow(-1);
    const fnbSekarang = fnbWindow(0);
    const fnbRekap = await client.query(api.reports.fnbTaxMonths, {
      tenantId: fnbTenantId,
      actorId: fnbOwnerId,
      months: [fnbBulanLalu, fnbSekarang],
    });
    const fnbBarisLalu = fnbRekap[0];
    const fnbBarisIni = fnbRekap[1];
    check(
      "laporan pajak F&B mengembalikan satu baris per bulan yang diminta (tertua dulu)",
      fnbRekap.length === 2 &&
        fnbBarisLalu.year === fnbBulanLalu.year &&
        fnbBarisLalu.monthIndex === fnbBulanLalu.monthIndex &&
        fnbBarisIni.monthIndex === fnbSekarang.monthIndex,
      JSON.stringify(fnbRekap.map((row) => [row.year, row.monthIndex])),
    );
    check(
      "omzet, transaksi, dan biaya layanan bulan ini diambil dari struknya",
      // Biaya layanan 7% tercatat di dua struk (1.400 + 1.400), terpisah dari pajak.
      fnbBarisIni.recordedSales === 3 &&
        fnbBarisIni.monthGrossIdr === 23400 + 23540 + 22200 &&
        fnbBarisIni.serviceChargeIdr === 2800,
      JSON.stringify(fnbBarisIni),
    );
    check(
      "PBJT dan PPN dijumlahkan terpisah (PBJT 2.000 + 2.140, PPN 2.200)",
      fnbBarisIni.regionalTaxIdr === 4140 &&
        fnbBarisIni.regionalSales === 2 &&
        fnbBarisIni.ppnTaxIdr === 2200,
      JSON.stringify({
        regional: fnbBarisIni.regionalTaxIdr,
        regionalSales: fnbBarisIni.regionalSales,
        ppn: fnbBarisIni.ppnTaxIdr,
      }),
    );
    check(
      "bulan tanpa penjualan tetap ada sebagai baris nol",
      fnbBarisLalu.recordedSales === 0 &&
        fnbBarisLalu.monthGrossIdr === 0 &&
        fnbBarisLalu.regionalTaxIdr === 0 &&
        fnbBarisLalu.ppnTaxIdr === 0,
      JSON.stringify(fnbBarisLalu),
    );

    // Penjualan yang dibatalkan tidak pernah dihitung sebagai uang yang diterima
    // — di laporan maupun di ringkasan setoran.
    await client.mutation(api.pos.voidSale, {
      saleId: fnbSaleDasar.saleId,
      actorId: fnbOwnerId,
      reason: "Uji laporan pajak",
    });
    const fnbRekapVoid = await client.query(api.reports.fnbTaxMonths, {
      tenantId: fnbTenantId,
      actorId: fnbOwnerId,
      months: [fnbBulanLalu, fnbSekarang],
    });
    check(
      "penjualan yang di-void hilang dari laporan (omzet & pajaknya)",
      fnbRekapVoid[1].recordedSales === 2 &&
        fnbRekapVoid[1].monthGrossIdr === 23400 + 22200 &&
        fnbRekapVoid[1].regionalTaxIdr === 2000,
      JSON.stringify({
        recordedSales: fnbRekapVoid[1].recordedSales,
        gross: fnbRekapVoid[1].monthGrossIdr,
        regional: fnbRekapVoid[1].regionalTaxIdr,
      }),
    );

    let fnbLuarPesan = "";
    try {
      await client.query(api.reports.fnbTaxMonths, {
        tenantId: fnbTenantId,
        actorId: outsiderId,
        months: [fnbBulanLalu, fnbSekarang],
      });
    } catch (error) {
      fnbLuarPesan = error?.message ?? String(error);
    }
    check(
      "orang di luar workspace tidak bisa membaca omzet pajak F&B",
      fnbLuarPesan.length > 0,
      fnbLuarPesan || "dibaca tanpa penolakan",
    );

    //
    // Setelan struk belanja: jenis printer, lebar kertas, rangkap, dan catatan
    // kakinya disimpan di baris tenant dan dibaca kasir saat mencetak. Yang dijaga
    // di sini adalah pagar yang membuat setelan itu tidak berbohong: rangkap hanya
    // mungkin di printer impact, lebar kertas harus benar-benar didukung printernya,
    // dan izinnya sama dengan setelan PPN/F&B (`billing.manage`). Tenant-nya sama
    // dengan tenant pajak F&B di atas supaya tidak menambah workspace uji baru.
    {
      // Bawaan: tenant yang belum pernah mengatur struk tidak punya kolomnya, dan
      // pembacanya mengembalikan bentuk bawaan (thermal 80 mm, sekali cetak).
      const strukAwal = await client.query(api.tenants.getMine, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
      });
      check(
        "tenant baru belum menyimpan setelan struk, dan bawaannya thermal 80 mm sekali cetak",
        strukAwal.receipt === undefined &&
          sameReceiptSetting(receiptSettingOf(strukAwal.receipt), DEFAULT_RECEIPT_SETTING),
        JSON.stringify(strukAwal.receipt),
      );

      // Kasir: mencetak struk boleh, mengubah setelannya tidak.
      let strukKasirPesan = "";
      try {
        await client.mutation(api.tenants.updateReceipt, {
          tenantId: fnbTenantId,
          actorId: fnbKasirId,
          setting: { printerId: "thermal", paperWidthMm: 80, copies: 1, footerText: "Halo" },
        });
      } catch (error) {
        strukKasirPesan = error?.message ?? String(error);
      }
      check(
        "kasir ditolak mengubah setelan struk karena izin billing.manage",
        strukKasirPesan.includes("izin billing.manage"),
        strukKasirPesan || "tidak ditolak sama sekali",
      );

      let strukLuarPesan = "";
      try {
        await client.mutation(api.tenants.updateReceipt, {
          tenantId: fnbTenantId,
          actorId: outsiderId,
          setting: { printerId: "thermal", paperWidthMm: 80, copies: 1, footerText: "Halo" },
        });
      } catch (error) {
        strukLuarPesan = error?.message ?? String(error);
      }
      check(
        "orang di luar workspace tidak bisa mengubah setelan struknya",
        strukLuarPesan.length > 0,
        strukLuarPesan || "diterima tanpa penolakan",
      );

      // Tembusan karbon di printer thermal: tidak mungkin, jadi ditolak dengan
      // alasan yang menyebut printer yang bisa.
      let strukRangkapPesan = "";
      try {
        await client.mutation(api.tenants.updateReceipt, {
          tenantId: fnbTenantId,
          actorId: fnbOwnerId,
          setting: { printerId: "thermal", paperWidthMm: 80, copies: 2, footerText: "Halo" },
        });
      } catch (error) {
        strukRangkapPesan = error?.message ?? String(error);
      }
      check(
        "rangkap dua di printer thermal ditolak server dengan alasan yang menyebut dot matrix",
        strukRangkapPesan.includes("tembusan karbon") && strukRangkapPesan.includes("Dot Matrix"),
        strukRangkapPesan || "diterima server",
      );

      let strukKertasPesan = "";
      try {
        await client.mutation(api.tenants.updateReceipt, {
          tenantId: fnbTenantId,
          actorId: fnbOwnerId,
          setting: { printerId: "portable", paperWidthMm: 80, copies: 1, footerText: "Halo" },
        });
      } catch (error) {
        strukKertasPesan = error?.message ?? String(error);
      }
      check(
        "lebar kertas yang tidak didukung printer portable ditolak",
        strukKertasPesan.includes("58 mm"),
        strukKertasPesan || "diterima server",
      );

      let strukCatatanPesan = "";
      try {
        await client.mutation(api.tenants.updateReceipt, {
          tenantId: fnbTenantId,
          actorId: fnbOwnerId,
          setting: {
            printerId: "thermal",
            paperWidthMm: 80,
            copies: 1,
            footerText: "baris satu\nbaris dua\nbaris tiga",
          },
        });
      } catch (error) {
        strukCatatanPesan = error?.message ?? String(error);
      }
      check(
        "catatan kaki lebih dari dua baris ditolak (tidak terpotong diam-diam)",
        strukCatatanPesan.includes("2 baris"),
        strukCatatanPesan || "diterima server",
      );

      const strukSetelahTolak = await client.query(api.tenants.getMine, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
      });
      check(
        "penolakan tidak menyimpan setelan struk setengah jadi",
        strukSetelahTolak.receipt === undefined,
        JSON.stringify(strukSetelahTolak.receipt),
      );

      // Setelan sah: printer dot matrix 76 mm, dua lembar, catatan kaki sendiri.
      const strukSet = await client.mutation(api.tenants.updateReceipt, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
        setting: {
          printerId: "dot_matrix",
          paperWidthMm: 76,
          copies: 2,
          footerText: "WA 0812-3456 · Terima kasih",
        },
      });
      check(
        "setelan struk rangkap dua tersimpan apa adanya untuk printer dot matrix",
        strukSet.changed === true &&
          strukSet.setting.printerId === "dot_matrix" &&
          strukSet.setting.paperWidthMm === 76 &&
          strukSet.setting.copies === 2,
        JSON.stringify(strukSet.setting),
      );
      check(
        "kalimat balikan server menyebut printer, kertas, dan jumlah lembarnya",
        strukSet.sentence.includes("Dot matrix") &&
          strukSet.sentence.includes("76 mm") &&
          strukSet.sentence.includes("2 lembar (asli + 1 tembusan)"),
        strukSet.sentence,
      );
      const strukTersimpan = await client.query(api.tenants.getMine, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
      });
      check(
        "yang dibaca kembali dari database persis setelan yang disimpan",
        sameReceiptSetting(receiptSettingOf(strukTersimpan.receipt), strukSet.setting),
        JSON.stringify(strukTersimpan.receipt),
      );

      const strukUlang = await client.mutation(api.tenants.updateReceipt, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
        setting: {
          printerId: "dot_matrix",
          paperWidthMm: 76,
          copies: 2,
          footerText: "WA 0812-3456 · Terima kasih",
        },
      });
      check(
        "menyimpan setelan struk yang sama tidak menulis perubahan (tanpa audit kosong)",
        strukUlang.changed === false,
        JSON.stringify(strukUlang),
      );

      // Kasir tetap boleh **membaca** setelan itu: justru dialah yang mencetaknya.
      const strukKasirBaca = await client.query(api.tenants.getMine, {
        tenantId: fnbTenantId,
        actorId: fnbKasirId,
      });
      check(
        "kasir bisa membaca setelan struk workspace-nya (dipakai saat mencetak)",
        receiptSettingOf(strukKasirBaca.receipt).copies === 2 &&
          receiptSettingOf(strukKasirBaca.receipt).printerId === "dot_matrix",
        JSON.stringify(strukKasirBaca.receipt),
      );

      //
      // Logo toko (`tenants.logo`): satu berkas per workspace yang tercetak di atas
      // nama usaha pada setiap struk. Berkasnya benar-benar diunggah ke penyimpanan
      // lewat pola tiga langkah, jadi jalur unggahnya ikut diuji — bukan hanya
      // validasinya. Tenant-nya sama dengan setelan struk di atas.
      const logoAwal = await client.query(api.tenants.getMine, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
      });
      check(
        "tenant yang belum memasang logo belum punya kolomnya (struk tanpa logo)",
        logoAwal.logo === undefined,
        JSON.stringify(logoAwal.logo),
      );
      const daftarTanpaLogo = await client.query(api.tenants.listMine, { userId: fnbOwnerId });
      check(
        "daftar workspace mengembalikan `logoUrl: null` selama logonya belum ada",
        daftarTanpaLogo.find((row) => row.tenant._id === fnbTenantId)?.logoUrl === null,
        JSON.stringify(
          daftarTanpaLogo.find((row) => row.tenant._id === fnbTenantId)?.logoUrl ?? "(tidak ada)",
        ),
      );

      /** Minta URL unggah logo sebagai `actorId`; melempar kalau ditolak. */
      async function mintaUrlLogo(actorId) {
        return await client.mutation(api.tenants.generateLogoUploadUrl, {
          tenantId: fnbTenantId,
          actorId,
        });
      }

      /** Unggah satu berkas ke penyimpanan dan kembalikan id berkasnya. */
      async function unggahBerkasLogo({ type, bytes, actorId = fnbOwnerId }) {
        const uploadUrl = await mintaUrlLogo(actorId);
        const uploaded = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": type },
          body: bytes,
        });
        if (!uploaded.ok) {
          throw new Error(`unggahan ditolak penyimpanan (HTTP ${uploaded.status})`);
        }
        const { storageId } = await uploaded.json();
        return storageId;
      }

      let logoKasirPesan = "";
      try {
        await mintaUrlLogo(fnbKasirId);
      } catch (error) {
        logoKasirPesan = error?.message ?? String(error);
      }
      check(
        "kasir ditolak meminta URL unggah logo (izin billing.manage)",
        logoKasirPesan.includes("izin billing.manage"),
        logoKasirPesan || "tidak ditolak sama sekali",
      );

      // Berkas yang bukan gambar (PDF) ditolak, dan berkasnya tidak boleh tertinggal.
      const storagePdf = await unggahBerkasLogo({ type: "application/pdf", bytes: pngBytes });
      let logoPdfPesan = "";
      try {
        await client.mutation(api.tenants.setLogo, {
          tenantId: fnbTenantId,
          actorId: fnbOwnerId,
          storageId: storagePdf,
        });
      } catch (error) {
        logoPdfPesan = error?.message ?? String(error);
      }
      check(
        "berkas bukan gambar ditolak dengan alasan yang menyebut formatnya",
        logoPdfPesan.includes("Logo harus berformat JPG, PNG, atau WebP"),
        logoPdfPesan || "tidak ditolak sama sekali",
      );

      // Batas 1 MB ditegakkan server, bukan hanya di halaman Pengaturan.
      const storageBesar = await unggahBerkasLogo({
        type: "image/png",
        bytes: new Uint8Array(1_100_000),
      });
      let logoBesarPesan = "";
      try {
        await client.mutation(api.tenants.setLogo, {
          tenantId: fnbTenantId,
          actorId: fnbOwnerId,
          storageId: storageBesar,
        });
      } catch (error) {
        logoBesarPesan = error?.message ?? String(error);
      }
      check(
        "logo lebih dari 1 MB ditolak server",
        logoBesarPesan.includes("Ukuran logo maksimal 1 MB"),
        logoBesarPesan || "tidak ditolak sama sekali",
      );
      const logoSetelahTolak = await client.query(api.tenants.getMine, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
      });
      check(
        "penolakan tidak menyisakan logo setengah jadi",
        logoSetelahTolak.logo === undefined,
        JSON.stringify(logoSetelahTolak.logo),
      );

      // Pemasangan sah: berkas PNG kecil, lalu dibaca kembali oleh kasir juga.
      const storageLogo = await unggahBerkasLogo({ type: "image/png", bytes: pngBytes });
      const logoPasang = await client.mutation(api.tenants.setLogo, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
        storageId: storageLogo,
      });
      check(
        "logo sah tersimpan dan server mengembalikan URL siap pakainya",
        logoPasang.changed === true &&
          typeof logoPasang.logoUrl === "string" &&
          logoPasang.logoUrl.startsWith("https://"),
        JSON.stringify(logoPasang.logoUrl),
      );
      const logoTersimpan = await client.query(api.tenants.getMine, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
      });
      check(
        "yang tersimpan adalah id berkasnya (bukan URL yang bisa kedaluwarsa)",
        logoTersimpan.logo === storageLogo,
        `${String(logoTersimpan.logo)} vs ${storageLogo}`,
      );
      const daftarBerlogo = await client.query(api.tenants.listMine, { userId: fnbOwnerId });
      const daftarKasir = await client.query(api.tenants.listMine, { userId: fnbKasirId });
      check(
        "pemilik & kasir sama-sama membaca `logoUrl` workspace-nya (kasir mencetaknya)",
        (daftarBerlogo.find((row) => row.tenant._id === fnbTenantId)?.logoUrl ?? "").startsWith(
          "https://",
        ) &&
          (daftarKasir.find((row) => row.tenant._id === fnbTenantId)?.logoUrl ?? "").startsWith(
            "https://",
          ),
        JSON.stringify(
          daftarKasir.find((row) => row.tenant._id === fnbTenantId)?.logoUrl ?? "(tidak ada)",
        ),
      );
      const logoUlang = await client.mutation(api.tenants.setLogo, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
        storageId: storageLogo,
      });
      check(
        "memasang berkas logo yang sama tidak menulis perubahan",
        logoUlang.changed === false,
        JSON.stringify(logoUlang),
      );

      // Mengganti logo: kolomnya menunjuk berkas baru, bukan berkas lama.
      const storageLogoBaru = await unggahBerkasLogo({ type: "image/webp", bytes: pngBytes });
      const logoGanti = await client.mutation(api.tenants.setLogo, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
        storageId: storageLogoBaru,
      });
      const logoSelesaiGanti = await client.query(api.tenants.getMine, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
      });
      check(
        "mengganti logo membuat kolomnya menunjuk berkas yang baru",
        logoGanti.changed === true &&
          logoSelesaiGanti.logo === storageLogoBaru &&
          logoSelesaiGanti.logo !== storageLogo,
        `${String(logoSelesaiGanti.logo)} vs ${storageLogoBaru}`,
      );

      // Orang di luar workspace tidak bisa memasang logo tetangganya.
      const storageLuar = await unggahBerkasLogo({ type: "image/png", bytes: pngBytes });
      let logoLuarPesan = "";
      try {
        await client.mutation(api.tenants.setLogo, {
          tenantId: fnbTenantId,
          actorId: outsiderId,
          storageId: storageLuar,
        });
      } catch (error) {
        logoLuarPesan = error?.message ?? String(error);
      }
      check(
        "orang di luar workspace tidak bisa memasang logo",
        logoLuarPesan.length > 0,
        logoLuarPesan || "dipasang tanpa penolakan",
      );
      let logoKasirHapusPesan = "";
      try {
        await client.mutation(api.tenants.removeLogo, {
          tenantId: fnbTenantId,
          actorId: fnbKasirId,
        });
      } catch (error) {
        logoKasirHapusPesan = error?.message ?? String(error);
      }
      check(
        "kasir juga ditolak melepas logo",
        logoKasirHapusPesan.includes("izin billing.manage"),
        logoKasirHapusPesan || "tidak ditolak sama sekali",
      );

      // Melepas logo: struknya kembali dicetak tanpa logo.
      const logoHapus = await client.mutation(api.tenants.removeLogo, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
      });
      const logoSelesaiHapus = await client.query(api.tenants.getMine, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
      });
      const daftarSelesaiHapus = await client.query(api.tenants.listMine, {
        userId: fnbOwnerId,
      });
      check(
        "logo dilepas: kolomnya kosong lagi dan `logoUrl` kembali null",
        logoHapus.changed === true &&
          logoSelesaiHapus.logo === undefined &&
          daftarSelesaiHapus.find((row) => row.tenant._id === fnbTenantId)?.logoUrl === null,
        JSON.stringify(daftarSelesaiHapus.find((row) => row.tenant._id === fnbTenantId)?.logoUrl),
      );
      const logoHapusUlang = await client.mutation(api.tenants.removeLogo, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
      });
      check(
        "melepas logo yang memang tidak ada tidak menulis perubahan",
        logoHapusUlang.changed === false,
        JSON.stringify(logoHapusUlang),
      );

      //
      // Kirim struk lewat WhatsApp (`receiptWa.send`): siapa penerimanya dan nomor
      // mana yang dipakai ditentukan **server**, bukan klien.
      //
      // Penjualan yang **tidak punya member sama sekali** (pembeli umum) juga lewat
      // aksi yang sama sekarang: `memberId` dikosongkan, dan nomor yang diketik kasir
      // menjadi satu-satunya tujuan — tetap divalidasi di server, dan kirimannya
      // dicatat menempel pada nota penjualannya.
      //
      // Yang dikirim ke WhatsApp pembeli sekarang **gambarnya saja** (PNG berlogo
      // yang digambar di perangkat kasir) — tidak ada lagi PDF di pesan itu, karena
      // lewat pesan dokumen logo & isi struknya baru terlihat kalau penerimanya
      // membuka lampirannya. Semua pemeriksaan di sini sengaja memakai `imageBase64`
      // kosong, jadi berhenti sebelum jaringan: gambar 0 byte ditolak sebelum ada
      // satu pun permintaan ke WhatsApp, sehingga kanal yang (belum) tersambung pun
      // tidak pernah benar-benar mengirim pesan ke nomor uji.
      async function kirimStrukWa(args) {
        return await client.action(api.receiptWa.send, {
          tenantId: fnbTenantId,
          actorId: fnbOwnerId,
          filename: "struk-A-00099.png",
          caption: "Struk belanja",
          imageBase64: "",
          ...args,
        });
      }
      /** Diterima halaman datanya: berhenti di kanal/size, bukan ditolak soal penerimanya. */
      const diterima = (hasil) =>
        hasil.ok === false && (hasil.code === "not-configured" || hasil.code === "failed");

      const waUmum = await kirimStrukWa({ phone: "0812-3456-7890" });
      check(
        "struk pembeli umum (tanpa memberId) diterima server — bukan ditolak karena tidak ada member",
        diterima(waUmum),
        JSON.stringify(waUmum),
      );

      const waUmumTanpaNomor = await kirimStrukWa({});
      check(
        "pembeli umum tanpa nomor ditolak dengan petunjuk mengisi kolomnya — bukan disamakan dengan member",
        waUmumTanpaNomor.ok === false &&
          waUmumTanpaNomor.code === "no-phone" &&
          waUmumTanpaNomor.reason.includes("Nomor WhatsApp pembeli") &&
          !/member/i.test(waUmumTanpaNomor.reason),
        JSON.stringify(waUmumTanpaNomor),
      );

      const waUmumNomorSalah = await kirimStrukWa({ phone: "0812" });
      check(
        "nomor pembeli umum yang belum sah ditolak server, bukan dipakai apa adanya",
        waUmumNomorSalah.ok === false && waUmumNomorSalah.code === "no-phone",
        JSON.stringify(waUmumNomorSalah),
      );

      // Member yang sudah punya nomor: nomor tersimpannya yang dipakai, walau kasir
      // mengetik nomor lain — atau tidak mengetik apa pun.
      const { memberId: waMemberId } = await client.mutation(api.loyalty.create, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
        name: "Pembeli Uji WhatsApp",
        phone: "0857-0000-1234",
      });
      const waMember = await kirimStrukWa({
        memberId: waMemberId,
        phone: "0812-9999-0000",
      });
      check(
        "struk member tetap diterima walau kasir mengetik nomor lain (nomor tersimpan yang menang, diputuskan server)",
        diterima(waMember),
        JSON.stringify(waMember),
      );

      const { memberId: waMemberKosongId } = await client.mutation(api.loyalty.create, {
        tenantId: fnbTenantId,
        actorId: fnbOwnerId,
        name: "Member Tanpa Nomor",
      });
      const waMemberKosong = await kirimStrukWa({ memberId: waMemberKosongId });
      check(
        "member yang belum punya nomor ditolak beserta namanya (petunjuknya menunjuk kolom nomor di dialog struk)",
        waMemberKosong.ok === false &&
          waMemberKosong.code === "no-phone" &&
          waMemberKosong.reason.includes("Member Tanpa Nomor"),
        JSON.stringify(waMemberKosong),
      );

      let waLuar = null;
      try {
        waLuar = await kirimStrukWa({ memberId: waMemberId, actorId: outsiderId });
      } catch (error) {
        // Penolakan izin memang dilempar, bukan dikembalikan sebagai kode hasil.
        waLuar = { ok: false, code: "ditolak", reason: error?.message ?? String(error) };
      }
      check(
        "orang di luar workspace tidak bisa mengirim struk atas nama workspace itu",
        waLuar.ok === false && waLuar.code !== "not-configured" && waLuar.code !== "failed",
        JSON.stringify(waLuar),
      );
    }
  }
}

try {
  await main();
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}`);
  console.log(`\n${results.length}/${results.length} checks passed against ${url}`);
} catch (error) {
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}`);
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
} finally {
  if (backend) {
    console.log("→ mematikan backend uji…");
    backend.kill("SIGTERM");
    await sleep(1500);
    if (!backend.killed) backend.kill("SIGKILL");
    // `convex dev` leaves the local backend binary running as a grandchild;
    // stop it by name so no test backend is left holding port 3210.
    spawnSync("pkill", ["-f", "convex-local-backend"], { encoding: "utf8" });
    await sleep(500);
  }
}

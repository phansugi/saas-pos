import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { validateWebhookSecret } from "./lib/webhooks";
import {
  productBarcodeKey,
  productBarcodeTypeOr,
  type ProductBarcodeType,
} from "./lib/productBarcode";
import {
  findStockLevel,
  getTenantOrThrow,
  requireMembership,
  requirePermission,
  writeAuditLog,
} from "./lib/access";
import {
  EMPTY_MARKETPLACE_BARCODE_COUNTS,
  EMPTY_MARKETPLACE_CATALOG_COUNTS,
  EMPTY_MARKETPLACE_COUNTS,
  EMPTY_MARKETPLACE_STOCK_DIFF_COUNTS,
  MARKETPLACE_BARCODE_SYNC_SCAN,
  MARKETPLACE_CATALOG_IMAGE_BUDGET,
  MARKETPLACE_CATALOG_IMAGES_PER_PRODUCT,
  MARKETPLACE_CATALOG_PRODUCT_LIMIT,
  MARKETPLACE_CONTACT_KINDS,
  MARKETPLACE_CONTACT_MAX,
  MARKETPLACE_ENV,
  MARKETPLACE_INBOUND_EVENTS,
  MARKETPLACE_INBOUND_LIMIT,
  MARKETPLACE_PRODUCT_FIELDS,
  MARKETPLACE_SALE_RECEIPT_LIMIT,
  MARKETPLACE_PRODUCTS_QUERY,
  MARKETPLACE_PUSH_EVENTS,
  MARKETPLACE_QUERY_URL_DEFAULT,
  MARKETPLACE_RECONCILE_PRODUCT_LIMIT,
  MARKETPLACE_SALES_QUEUE_STALE_MS,
  MARKETPLACE_STOCK_DIFF_LIMIT,
  MARKETPLACE_SNAPSHOT_ERRORS,
  MARKETPLACE_STOCK_QUEUE_STALE_MS,
  MARKETPLACE_VENDOR_ID_MAX,
  MARKETPLACE_VENDOR_LIMIT,
  MARKETPLACE_VENDOR_NAME_MAX,
  encodeMarketplaceBarcode,
  filterMarketplaceVendors,
  isMarketplaceSyncToken,
  marketplaceBarcodeSyncNote,
  marketplaceCatalogImportSentence,
  isMarketplaceSaleKey,
  planMarketplaceBarcodeSync,
  marketplaceInboundUrl,
  marketplaceCatalogPushUrl,
  MARKETPLACE_PUSH_HEADERS,
  marketplacePushEnvelope,
  marketplacePushHeaders,
  marketplaceSalesPushBody,
  marketplaceSalesPushEvent,
  marketplaceSalesPushSubject,
  marketplaceSalesPushUrl,
  marketplaceSnapshotCounts,
  marketplaceStockDiffSentence,
  marketplaceStockPushUrl,
  pairingCodeFrom,
  stockDiffPushSkus,
  stockSkuKey,
  parseMarketplaceCatalogProducts,
  parseMarketplaceStockRows,
  reconcileMarketplaceStock,
  parseMarketplaceContact,
  parseMarketplaceContactMatch,
  parseMarketplaceProductPushResponse,
  parseMarketplaceVendorRows,
  type MarketplaceBarcodeLocalRow,
  type MarketplaceBarcodeMarketRow,
  type MarketplaceBarcodeSyncCounts,
  type MarketplaceBarcodeSyncResult,
  type MarketplaceCatalogCounts,
  type MarketplaceCatalogPullResult,
  type MarketplaceInboundView,
  type MarketplaceCategoryPayload,
  type MarketplaceContactKind,
  type MarketplaceLookupResult,
  type MarketplacePairingView,
  type MarketplaceProductPayload,
  type MarketplaceReconcileResult,
  type MarketplaceProductPushCounts,
  type MarketplaceProductPushResult,
  type MarketplaceSaleLine,
  type MarketplaceSaleRow,
  type MarketplaceSalesPushBody,
  type MarketplaceStockDiff,
  type MarketplaceStockDiffCounts,
  type MarketplaceStockDiffPullResult,
  type MarketplaceStockDiffPushResult,
  type MarketplaceStockRow,
  type MarketplaceSnapshotCounts,
  type MarketplaceSyncResult,
  type MarketplaceVendor,
} from "./lib/marketplace";

/**
 * Pairing vendor **pusatbahanbangunan.com**.
 *
 * Tiga permukaan yang disengaja sempit:
 *
 * 1. **Direktori vendor** dibaca dari query publik marketplace
 *    (`vendor:listVendors`) lewat action. Tidak ada kunci API dan tidak ada data
 *    pribadi yang diambil; yang masuk ke sini hanya nama toko, kota, keterangan,
 *    dan jumlah produk — sama dengan yang terlihat di `/vendors`.
 * 2. **Pairing** hanya boleh dilakukan **pemilik**, karena yang diikat adalah
 *    identitas bisnis ke akun marketplace-nya. Manajer/keuangan tetap bisa
 *    membaca kartunya, tetapi tombol pasang/lepas ditolak server.
 * 3. **Sinkronisasi** berjalan satu arah untuk katalog: POS sumber utama,
 *    marketplace menarik snapshot lewat `GET /api/marketplace/snapshot?token=…`.
 *    Token itu dibuat saat pairing dan mati begitu pairing dilepas. Kalau
 *    marketplace kelak menyediakan endpoint tulis, `PUSATBAHANBANGUNAN_SYNC_URL`
 *    bisa diisi dan tombol “Sinkronkan sekarang” akan mendorong snapshot yang
 *    sama ke sana.
 * 4. **Penjualan di marketplace masuk balik** lewat
 *    `POST /api/marketplace/orders` dengan token pairing yang sama. Action-nya
 *    ada di `apiAccess`, karena jalurnya sama dengan penjualan API/webhook:
 *    `pos.createSale` yang menghitung harga, PPN, dan stok.
 *
 * Snapshot sengaja **tidak** memuat `syncToken`; token hanya dipakai sebagai
 * kunci masuk dan tidak ikut tersalin ke sisi marketplace.
 */

const contactKindValidator = v.union(v.literal("email"), v.literal("whatsapp"));

/** Batas ukuran snapshot. Baris di luar batas ditandai `truncated`. */
const SNAPSHOT_PRODUCTS = 1000;
const SNAPSHOT_SALES = 200;
/** Baris item per nota; nota besar tetap terkirim, itemnya ditandai terpotong. */
const SNAPSHOT_SALE_ITEMS = 20;
const SNAPSHOT_PURCHASES = 200;
const SNAPSHOT_PAYABLES = 200;
const SNAPSHOT_CATEGORIES = 500;
const SNAPSHOT_SUBCATEGORIES = 1000;
const SNAPSHOT_STOCK_ROWS = 4000;
const SNAPSHOT_SUPPLIERS = 500;
/**
 * Batas URL gambar yang dibuat sekali susun. `ctx.storage.getUrl` dipanggil per
 * gambar, jadi katalog besar tidak boleh berubah menjadi ribuan panggilan dalam
 * satu query. Yang terpotong ditandai `truncated.images`, bukan diam-diam hilang.
 */
const SNAPSHOT_IMAGE_URLS = 1500;
const SNAPSHOT_IMAGES_PER_PRODUCT = 8;
const SNAPSHOT_LOOKBACK_MS = 30 * 86_400_000;

/** Batas tunggu panggilan jaringan supaya halaman tidak menggantung tanpa akhir. */
const MARKETPLACE_FETCH_TIMEOUT_MS = 12_000;

function marketplaceFetchSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(MARKETPLACE_FETCH_TIMEOUT_MS)
    : undefined;
}

/** Hex acak dari Web Crypto; dipakai untuk token & kode pairing. */
function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoApi?.getRandomValues) {
    // Hanya jaring pengaman untuk runtime tanpa Web Crypto (tidak terjadi di
    // Convex); token tetap panjang dan tidak bisa ditebak dari data pelanggan.
    return Array.from({ length: bytes * 2 }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join("");
  }
  cryptoApi.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Token snapshot: `mp_` + 48 hex (24 byte). */
function newSyncToken(): string {
  return `mp_${randomHex(24)}`;
}

/** Pemilik = satu-satunya peran yang boleh mengikat identitas bisnis. */
function ownerOnlyReason(role: string | null | undefined): string | null {
  if (role === "owner") return null;
  return "Hanya pemilik bisnis yang boleh memasangkan atau melepas vendor marketplace.";
}

/** Membaca satu baris pairing milik tenant, kalau ada. */
async function pairingOf(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"marketplacePairings"> | null> {
  return await ctx.db
    .query("marketplacePairings")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .unique();
}

/** Bentuk yang dibaca UI. Token & kontak lengkap hanya untuk pemilik. */
async function pairingView(
  ctx: QueryCtx,
  pairing: Doc<"marketplacePairings">,
  includeSecret: boolean,
): Promise<MarketplacePairingView> {
  const pairedBy = await ctx.db.get(pairing.pairedBy);
  return {
    vendorId: pairing.vendorId,
    vendorName: pairing.vendorName,
    contactKind: pairing.contactKind,
    contact: includeSecret ? pairing.contact : null,
    contactMasked: pairing.contactMasked,
    contactVerified: pairing.contactVerified,
    pairedAt: pairing.pairedAt,
    pairedByName: pairedBy?.name ?? pairedBy?.email ?? "pemilik",
    pairingCode: pairing.pairingCode,
    syncToken: includeSecret ? pairing.syncToken : null,
    lastPullAt: pairing.lastPullAt ?? null,
    lastPullCounts: pairing.lastPullCounts ?? null,
    lastSyncAt: pairing.lastSyncAt ?? null,
    lastSyncStatus: pairing.lastSyncStatus ?? null,
    lastSyncNote: pairing.lastSyncNote ?? null,
    lastProductSyncAt: pairing.lastProductSyncAt ?? null,
    lastProductSyncStatus: pairing.lastProductSyncStatus ?? null,
    lastProductSyncNote: pairing.lastProductSyncNote ?? null,
    lastProductSyncCounts: pairing.lastProductSyncCounts ?? null,
    // Dorongan stok otomatis: dikirim sesudah penjualan/penerimaan/opname, bukan
    // dari tombol mana pun — karena itu catatannya terpisah.
    lastStockSyncAt: pairing.lastStockSyncAt ?? null,
    lastStockSyncStatus: pairing.lastStockSyncStatus ?? null,
    lastStockSyncNote: pairing.lastStockSyncNote ?? null,
    lastStockSyncCounts: pairing.lastStockSyncCounts ?? null,
    lastSalesSyncAt: pairing.lastSalesSyncAt ?? null,
    lastSalesSyncStatus: pairing.lastSalesSyncStatus ?? null,
    lastSalesSyncNote: pairing.lastSalesSyncNote ?? null,
    lastSalesSyncCounts: pairing.lastSalesSyncCounts ?? null,
    // Pemeriksaan selisih stok — hanya hasil baca, tidak mengubah saldo siapa pun.
    lastReconcileAt: pairing.lastReconcileAt ?? null,
    lastReconcileStatus: pairing.lastReconcileStatus ?? null,
    lastReconcileNote: pairing.lastReconcileNote ?? null,
    lastReconcileCounts: pairing.lastReconcileCounts ?? null,
    stockDiffs: (
      await ctx.db
        .query("marketplaceStockDiffs")
        .withIndex("by_tenant", (q) => q.eq("tenantId", pairing.tenantId))
        .take(MARKETPLACE_STOCK_DIFF_LIMIT)
    ).map((row) => ({
      sku: row.sku,
      name: row.name,
      posStock: row.posStock,
      marketplaceStock: row.marketplaceStock,
      delta: row.delta,
      kind: row.kind,
    })),
    pushSecretSet: (pairing.pushSecret ?? "").length > 0,
    pushSecretLastFour: pairing.pushSecretLastFour ?? null,
    lastCatalogAt: pairing.lastCatalogAt ?? null,
    lastCatalogStatus: pairing.lastCatalogStatus ?? null,
    lastCatalogNote: pairing.lastCatalogNote ?? null,
    // Baris hasil impor versi lama belum punya `stock`; yang dibaca UI harus
    // tetap berbentuk lengkap, bukan `undefined` yang membuat angka hilang.
    lastCatalogCounts: pairing.lastCatalogCounts
      ? {
          products: pairing.lastCatalogCounts.products,
          created: pairing.lastCatalogCounts.created,
          updated: pairing.lastCatalogCounts.updated,
          unchanged: pairing.lastCatalogCounts.unchanged,
          skipped: pairing.lastCatalogCounts.skipped,
          categories: pairing.lastCatalogCounts.categories,
          subcategories: pairing.lastCatalogCounts.subcategories,
          images: pairing.lastCatalogCounts.images,
          stock: pairing.lastCatalogCounts.stock ?? 0,
          barcodes: pairing.lastCatalogCounts.barcodes ?? 0,
          barcodeConflicts: pairing.lastCatalogCounts.barcodeConflicts ?? 0,
        }
      : null,
    lastBarcodeSyncAt: pairing.lastBarcodeSyncAt ?? null,
    lastBarcodeSyncStatus: pairing.lastBarcodeSyncStatus ?? null,
    lastBarcodeSyncNote: pairing.lastBarcodeSyncNote ?? null,
    lastBarcodeSyncCounts: pairing.lastBarcodeSyncCounts ?? null,
  };
}

/**
 * Alamat penerimaan pesanan marketplace + riwayat terakhirnya untuk kartu.
 *
 * Alamatnya berasal dari `CONVEX_SITE_URL` deployment ini, bukan dari domain
 * aplikasi: yang dipanggil marketplace adalah endpoint HTTP Convex. Kalau nilai
 * itu belum terbaca, `url` kosong dan kartu tidak mengarang tautan.
 */
async function marketplaceInboundView(
  ctx: QueryCtx,
  tenantId: Id<"tenants">,
): Promise<MarketplaceInboundView> {
  const rows = await ctx.db
    .query("marketplaceInboundOrders")
    .withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId))
    .order("desc")
    .take(MARKETPLACE_INBOUND_LIMIT);

  // Jalur yang **sudah** dipakai marketplace hari ini adalah `/api/v1/sales`
  // dengan kunci `api:<tenant>:pbb-order-…`. Nota-nota itu dibaca dari tabel
  // penjualan, bukan dari catatan endpoint baru — supaya kartu menunjukkan
  // pesanan yang benar-benar sudah tercatat, bukan hanya kiriman terbaru.
  const recentSales = await ctx.db
    .query("sales")
    .withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId))
    .order("desc")
    .take(200);
  const sales = recentSales
    .filter((sale) => isMarketplaceSaleKey(sale.idempotencyKey, tenantId))
    .slice(0, MARKETPLACE_SALE_RECEIPT_LIMIT)
    .map((sale) => ({
      number: sale.number,
      total: sale.total,
      status: sale.status === "void" ? ("void" as const) : ("completed" as const),
      at: sale.createdAt,
    }));

  return {
    url: marketplaceInboundUrl(process.env.CONVEX_SITE_URL ?? ""),
    events: [...MARKETPLACE_INBOUND_EVENTS],
    orders: rows.map((row) => ({
      orderId: row.orderId,
      event: row.event,
      status: row.status,
      saleNumber: row.saleNumber ?? null,
      message: row.message ?? null,
      at: row.createdAt,
    })),
    sales,
  };
}

/**
 * Gerbang untuk action. Action tidak bisa memakai `requirePermission` langsung
 * (tidak ada `ctx.db`), jadi pemeriksaannya lewat query internal ini — dan hasilnya
 * dipakai apa adanya: action tidak pernah menebak peran sendiri.
 */
export const access = internalQuery({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx, args.tenantId, args.actorId);
    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    return {
      role: membership.role ?? null,
      canPair: ownerOnlyReason(membership.role) === null,
      blockedReason: ownerOnlyReason(membership.role),
      tenantName: tenant.name,
    };
  },
});

/**
 * Status pairing untuk kartu Pengaturan. Semua anggota bisa membaca; hanya
 * pemilik yang menerima kontak lengkap & token snapshot.
 */
export const status = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx, args.tenantId, args.actorId);
    const canPair = ownerOnlyReason(membership.role) === null;
    const pairing = await pairingOf(ctx, args.tenantId);
    return {
      pairing: pairing ? await pairingView(ctx, pairing, canPair) : null,
      canPair,
      pairBlockedReason: ownerOnlyReason(membership.role),
      // Dibaca server, bukan ditebak klien: kartu perlu tahu apakah perubahan
      // stok bisa berangkat sendiri atau hanya “siap ditarik”.
      pushEndpointReady: marketplaceStockPushUrl(process.env) !== "",
      salesPushEndpointReady: marketplaceSalesPushUrl(process.env) !== "",
      // Arah balik (marketplace → MesinPOS) dibaca dari baris pesanan yang
      // benar-benar diterima, bukan dari asumsi bahwa marketplace sudah
      // mengirim sesuatu.
      inbound: pairing
        ? await marketplaceInboundView(ctx, pairing.tenantId)
        : null,
    };
  },
});

/**
 * Rahasia penanda tangan untuk kiriman **masuk** dari marketplace, dicari lewat
 * token pairing. Dipakai `http.ts` sebelum badan kiriman diurai: token menunjuk
 * pairing, rahasia yang sama dengan arah keluar memverifikasi HMAC-nya.
 */
export const inboundAuthForToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const pairing = await ctx.db
      .query("marketplacePairings")
      .withIndex("by_token", (q) => q.eq("syncToken", args.token))
      .unique();
    if (!pairing) return null;
    return {
      pairingId: pairing._id,
      tenantId: pairing.tenantId,
      vendorId: pairing.vendorId,
      pushSecret: pairing.pushSecret ?? null,
    };
  },
});

/** Membaca direktori publik marketplace tanpa mempercayai bentuk balasannya. */
async function fetchMarketplaceVendors(): Promise<MarketplaceVendor[]> {
  const base = (
    process.env[MARKETPLACE_ENV.queryUrl] ?? MARKETPLACE_QUERY_URL_DEFAULT
  )
    .trim()
    .replace(/\/+$/, "");

  let response: Response;
  try {
    response = await fetch(`${base}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "vendor:listVendors",
        args: {},
        format: "json",
      }),
      signal: marketplaceFetchSignal(),
    });
  } catch {
    throw new ConvexError(
      "Direktori vendor marketplace tidak bisa dihubungi. Periksa sambungan lalu coba lagi.",
    );
  }
  if (!response.ok) {
    throw new ConvexError(
      `Direktori vendor marketplace tidak bisa dibaca (HTTP ${response.status}). Coba lagi beberapa saat lagi.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ConvexError(
      "Direktori vendor marketplace mengirim balasan yang tidak bisa dibaca.",
    );
  }

  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  if (record.status !== "success") {
    throw new ConvexError(
      "Marketplace menolak permintaan direktori vendor. Coba lagi beberapa saat lagi.",
    );
  }
  return parseMarketplaceVendorRows(record.value).slice(
    0,
    MARKETPLACE_VENDOR_LIMIT,
  );
}

/** Mencocokkan kontak lewat endpoint marketplace, kalau endpoint itu diisi. */
async function lookupContact(
  contactKind: MarketplaceContactKind,
  contact: string,
): Promise<{
  match: { vendorId: string; vendorName: string; verified: boolean } | null;
  note: string | null;
}> {
  const url = process.env[MARKETPLACE_ENV.lookupUrl];
  if (!url) return { match: null, note: null };

  try {
    const token = process.env[MARKETPLACE_ENV.lookupToken];
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ contactKind, contact }),
      signal: marketplaceFetchSignal(),
    });
    if (!response.ok) {
      return {
        match: null,
        note: `Endpoint pencocokan kontak marketplace menjawab HTTP ${response.status}; vendor dipilih dari direktori.`,
      };
    }
    const body: unknown = await response.json();
    const record =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const match = parseMarketplaceContactMatch(record.match ?? body);
    return {
      match,
      note: match
        ? null
        : "Kontak ini belum cocok dengan vendor mana pun di marketplace; pilih toko Anda dari direktori.",
    };
  } catch {
    return {
      match: null,
      note: "Endpoint pencocokan kontak marketplace tidak bisa dihubungi; vendor dipilih dari direktori.",
    };
  }
}

/**
 * Mencari vendor untuk dipasangkan.
 *
 * Dua mode, dan bedanya disengaja:
 *
 * - **Pencarian kontak** (bawaan). Pemilik mengetik email/WA, dan yang
 *   dikembalikan hanya vendor yang marketplace nyatakan cocok dengan kontak
 *   itu — bukan seluruh direktori. Tanpa endpoint pencocokan di marketplace,
 *   hasilnya kosong beserta alasannya, bukan daftar seratus toko yang membuat
 *   pemilik menebak toko mana yang miliknya.
 * - **Direktori** (`includeDirectory: true`). Hanya dipakai saat pemilik sendiri
 *   menekan “Tampilkan direktori toko”, misalnya karena kontaknya belum
 *   terdaftar di marketplace. Ini satu-satunya jalur yang mengembalikan daftar
 *   toko selain vendor yang cocok.
 */
export const lookupVendors = action({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    contactKind: contactKindValidator,
    value: v.string(),
    /** `true` = pemilik sengaja membuka direktori lengkap marketplace. */
    includeDirectory: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<MarketplaceLookupResult> => {
    const gate = await ctx.runQuery(internal.marketplace.access, {
      tenantId: args.tenantId,
      actorId: args.actorId,
    });
    if (!gate.canPair) {
      throw new ConvexError(gate.blockedReason ?? "Akses ditolak.");
    }

    const raw = (args.value ?? "").trim();
    if (raw.length > MARKETPLACE_CONTACT_MAX + MARKETPLACE_VENDOR_NAME_MAX) {
      throw new ConvexError("Kata kunci terlalu panjang.");
    }

    let contact: string | null = null;
    if (raw !== "") {
      const parsed = parseMarketplaceContact({
        kind: args.contactKind,
        value: raw,
      });
      if (!parsed.ok) throw new ConvexError(parsed.reason);
      contact = parsed.value;
    }

    const includeDirectory = args.includeDirectory === true;

    // Tanpa kontak dan tanpa permintaan direktori, tidak ada yang perlu dicari:
    // kartu menampilkan keadaan kosong, bukan daftar semua vendor marketplace.
    if (!includeDirectory && contact === null) {
      return {
        vendors: [],
        source: "directory",
        match: null,
        note: "Masukkan email atau nomor WA yang terdaftar di marketplace dulu — daftar toko hanya menampilkan vendor yang cocok dengan kontak itu.",
        fetchedAt: Date.now(),
      };
    }

    const contactLookup = contact
      ? await lookupContact(args.contactKind, contact)
      : { match: null, note: null };

    // Mode kontak: hanya vendor yang benar-benar cocok. Direktori hanya dipakai
    // untuk melengkapi kota/jumlah produk vendor itu; kalau direktori sedang
    // tidak bisa dibaca, kecocokan dari marketplace tetap ditampilkan apa adanya.
    if (!includeDirectory) {
      const match = contactLookup.match;
      if (!match) {
        return {
          vendors: [],
          source: "directory",
          match: null,
          note:
            contactLookup.note ??
            "Kontak ini belum cocok dengan vendor mana pun di marketplace. Periksa ejaan email/WA; direktori toko ditampilkan di langkah 2 supaya Anda bisa memilih toko sendiri.",
          fetchedAt: Date.now(),
        };
      }
      let enriched: MarketplaceVendor | null = null;
      try {
        const rows = await fetchMarketplaceVendors();
        enriched = rows.find((vendor) => vendor.id === match.vendorId) ?? null;
      } catch {
        enriched = null;
      }
      return {
        vendors: [
          enriched ?? {
            id: match.vendorId,
            name: match.vendorName,
            description: "",
            city: "",
            productCount: 0,
            joinedAt: 0,
            logo: null,
            cover: null,
          },
        ],
        source: "pairing-api",
        match,
        note: `Kontak cocok dengan ${match.vendorName}.`,
        fetchedAt: Date.now(),
      };
    }

    let vendors = await fetchMarketplaceVendors();

    // Di direktori, vendor yang cocok dengan kontak ditaruh paling atas supaya
    // pemilik tidak perlu mencari lagi.
    if (contactLookup.match) {
      const match = contactLookup.match;
      const index = vendors.findIndex((vendor) => vendor.id === match.vendorId);
      if (index >= 0) {
        vendors = [
          vendors[index],
          ...vendors.filter((_, position) => position !== index),
        ];
      } else {
        vendors = [
          {
            id: match.vendorId,
            name: match.vendorName,
            description: "",
            city: "",
            productCount: 0,
            joinedAt: 0,
            logo: null,
            cover: null,
          },
          ...vendors,
        ];
      }
    }

    const source = contactLookup.match ? "pairing-api" : "directory";
    const note =
      contactLookup.note ??
      (contactLookup.match
        ? `Kontak cocok dengan ${contactLookup.match.vendorName}.`
        : "Direktori toko marketplace. Pilih toko Anda di bawah, lalu konfirmasi kontaknya.");

    return {
      vendors: contactLookup.match
        ? vendors.slice(0, MARKETPLACE_VENDOR_LIMIT)
        : filterMarketplaceVendors(
            vendors,
            contact ? "" : raw,
          ),
      source,
      match: contactLookup.match,
      note,
      fetchedAt: Date.now(),
    };
  },
});

/**
 * Memasangkan workspace ke satu vendor.
 *
 * Pemilik bisa mengganti kontak (mis. email → WA) tanpa melepas pairing lewat
 * pemanggilan ulang dengan vendor yang sama; vendor berbeda harus dilepas dulu.
 * Ini mencegah satu klik tidak sengaja memindahkan seluruh riwayat ke toko lain.
 */
export const pair = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    vendorId: v.string(),
    vendorName: v.string(),
    contactKind: contactKindValidator,
    contact: v.string(),
    contactVerified: v.boolean(),
  },
  handler: async (ctx, args) => {
    const membership = await requirePermission(
      ctx,
      args.tenantId,
      args.actorId,
      "billing.manage",
    );
    const blocked = ownerOnlyReason(membership.role);
    if (blocked) throw new ConvexError(blocked);

    const vendorId = (args.vendorId ?? "").trim();
    const vendorName = (args.vendorName ?? "").trim();
    if (vendorId === "" || vendorId.length > MARKETPLACE_VENDOR_ID_MAX) {
      throw new ConvexError("Vendor marketplace tidak valid. Muat ulang direktori.");
    }
    if (vendorName === "" || vendorName.length > MARKETPLACE_VENDOR_NAME_MAX) {
      throw new ConvexError("Nama vendor marketplace tidak valid.");
    }

    const contact = parseMarketplaceContact({
      kind: args.contactKind,
      value: args.contact,
    });
    if (!contact.ok) throw new ConvexError(contact.reason);

    const existing = await pairingOf(ctx, args.tenantId);
    if (existing && existing.vendorId !== vendorId) {
      throw new ConvexError(
        `Workspace ini sudah dipasangkan ke ${existing.vendorName}. Lepas pairing lama dulu sebelum memasang vendor lain.`,
      );
    }

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        vendorName,
        contactKind: contact.kind,
        contact: contact.value,
        contactMasked: contact.masked,
        contactVerified:
          existing.contactVerified ||
          (existing.vendorId === vendorId && args.contactVerified),
      });
      await writeAuditLog(ctx, {
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: "marketplace.pair-contact",
        entity: "marketplacePairings",
        entityId: existing._id,
        meta: { vendorId, contactKind: contact.kind },
      });
      return {
        changed: true,
        pairing: await pairingView(ctx, existing, true),
        sentence: `Kontak pairing ${vendorName} diperbarui menjadi ${contact.masked}.`,
      };
    }

    const token = newSyncToken();
    const pairingId = await ctx.db.insert("marketplacePairings", {
      tenantId: args.tenantId,
      vendorId,
      vendorName,
      contactKind: contact.kind,
      contact: contact.value,
      contactMasked: contact.masked,
      contactVerified: args.contactVerified === true,
      pairingCode: pairingCodeFrom(randomHex(4)),
      syncToken: token,
      pairedAt: now,
      pairedBy: args.actorId,
    });

    const pairing = await ctx.db.get(pairingId);
    if (!pairing) throw new ConvexError("Pairing gagal disimpan.");

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "marketplace.pair",
      entity: "marketplacePairings",
      entityId: pairingId,
      meta: { vendorId, vendorName, contactKind: contact.kind },
    });

    return {
      changed: true,
      pairing: await pairingView(ctx, pairing, true),
      sentence: `Workspace dipasangkan ke ${vendorName} (${pairing.pairingCode}).`,
    };
  },
});

/** Melepas pairing. Token snapshot ikut mati karena barisnya dihapus. */
export const unpair = mutation({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    const membership = await requirePermission(
      ctx,
      args.tenantId,
      args.actorId,
      "billing.manage",
    );
    const blocked = ownerOnlyReason(membership.role);
    if (blocked) throw new ConvexError(blocked);

    const pairing = await pairingOf(ctx, args.tenantId);
    if (!pairing) {
      return { changed: false, sentence: "Workspace belum dipasangkan ke vendor mana pun." };
    }

    await ctx.db.delete(pairing._id);
    // Antrean lama ikut dibersihkan: tanpa pairing, action tidak punya tujuan
    // maupun token, jadi baris yang tertinggal hanya akan menumpuk.
    for (const table of ["marketplaceStockQueue", "marketplaceSaleQueue"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "marketplace.unpair",
      entity: "marketplacePairings",
      entityId: pairing._id,
      meta: { vendorId: pairing.vendorId, vendorName: pairing.vendorName },
    });

    return {
      changed: true,
      sentence: `Pairing dengan ${pairing.vendorName} dilepas. Tautan sinkron lama tidak berlaku lagi.`,
    };
  },
});

/**
 * Menyimpan **rahasia penanda tangan** kiriman MesinPOS → marketplace.
 *
 * Rahasianya harus sama dengan “rahasia endpoint” di Pengaturan marketplace —
 * di sanalah penerima menghitung ulang HMAC-nya. Disimpan di baris pairing
 * (bukan env) supaya pemilik bisa mengisinya sendiri dari halaman Pengaturan,
 * tanpa menyentuh setelan deployment. Mengirim string kosong menghapusnya.
 */
export const setPushSecret = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    secret: v.union(v.null(), v.string()),
  },
  handler: async (ctx, args) => {
    const membership = await requirePermission(
      ctx,
      args.tenantId,
      args.actorId,
      "billing.manage",
    );
    const blocked = ownerOnlyReason(membership.role);
    if (blocked) throw new ConvexError(blocked);

    const pairing = await pairingOf(ctx, args.tenantId);
    if (!pairing) {
      throw new ConvexError(
        "Pasangkan workspace ke vendor marketplace dulu sebelum mengisi rahasia penanda tangan.",
      );
    }

    const raw = (args.secret ?? "").trim();
    if (raw === "") {
      await ctx.db.patch(pairing._id, {
        pushSecret: undefined,
        pushSecretLastFour: undefined,
      });
      await writeAuditLog(ctx, {
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: "marketplace.push-secret-clear",
        entity: "marketplacePairings",
        entityId: pairing._id,
        meta: { vendorId: pairing.vendorId },
      });
      return {
        saved: false,
        lastFour: null,
        sentence:
          "Rahasia penanda tangan dihapus; kiriman ke marketplace hanya membawa token pairing.",
      };
    }

    const verdict = validateWebhookSecret(raw);
    if (!verdict.ok) throw new ConvexError(verdict.reason);

    await ctx.db.patch(pairing._id, {
      pushSecret: verdict.value,
      pushSecretLastFour: verdict.value.slice(-4),
    });
    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "marketplace.push-secret",
      entity: "marketplacePairings",
      entityId: pairing._id,
      meta: { vendorId: pairing.vendorId, lastFour: verdict.value.slice(-4) },
    });
    return {
      saved: true,
      lastFour: verdict.value.slice(-4),
      sentence: `Rahasia penanda tangan disimpan (••••${verdict.value.slice(-4)}). Pastikan nilai yang sama diisi di Pengaturan marketplace.`,
    };
  },
});

/* ------------------------------------------------------------------ snapshot */

interface SnapshotBusiness {
  name: string;
  slug: string;
  storeName: string;
  storeCode: string;
  address: string;
  email: string;
  phone: string;
  currency: string;
  category: string | null;
  subcategory: string | null;
}

interface SnapshotSale {
  number: string;
  at: number;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  method: string;
  itemCount: number;
  /** `true` = baris item dipotong di `SNAPSHOT_SALE_ITEMS`. */
  itemsTruncated: boolean;
  items: {
    sku: string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
}

interface SnapshotPurchase {
  number: string;
  at: number;
  supplier: string;
  total: number;
}

interface SnapshotPayable {
  number: string;
  supplier: string;
  amount: number;
  paid: number;
  dueDate: number;
  status: string;
}

interface MarketplaceSnapshotBody {
  version: 1;
  generatedAt: number;
  pairing: {
    vendorId: string;
    vendorName: string;
    pairingCode: string;
    /** Kontak yang diklaim pemilik; dipakai marketplace untuk memverifikasi pasangan. */
    contactKind: "email" | "whatsapp";
    contact: string;
    contactVerified: boolean;
    /**
     * Alamat yang dipanggil marketplace saat ada **penjualan di sana**, sehingga
     * pesanannya tercatat sebagai penjualan MesinPOS. Marketplace tidak perlu
     * menunggu pemilik menyalin tautan: alamat ini ikut di setiap snapshot.
     */
    inbound: { url: string; events: string[] };
  };
  business: SnapshotBusiness;
  owner: { name: string; email: string };
  /**
   * Bentuk salinan katalog: upsert per SKU, field yang belum ada **dibuat**
   * mengikuti sumbernya. Marketplace yang sudah punya kolomnya tetap memakai
   * nilainya dari sini karena MesinPOS sumber utama.
   */
  sync: { mode: "upsert"; upsertKey: "sku"; createMissing: true };
  /** Daftar field yang ikut dikirim — sisi penerima tidak perlu menebak. */
  productFields: typeof MARKETPLACE_PRODUCT_FIELDS;
  /** Pohon kategori & subkategori sumber, supaya yang belum ada bisa dibuat. */
  categories: MarketplaceCategoryPayload[];
  products: MarketplaceProductPayload[];
  sales: SnapshotSale[];
  purchases: SnapshotPurchase[];
  payables: SnapshotPayable[];
  counts: MarketplaceSnapshotCounts;
  truncated: {
    products: boolean;
    sales: boolean;
    purchases: boolean;
    payables: boolean;
    /** Sebagian URL gambar tidak ikut karena batas panggilan penyimpanan. */
    images: boolean;
  };
}

interface ProductCatalog {
  products: MarketplaceProductPayload[];
  categories: MarketplaceCategoryPayload[];
  /** id produk → SKU, dipakai baris nota tanpa membaca tabel produk dua kali. */
  skuById: Map<string, string>;
  productsTruncated: boolean;
  imagesTruncated: boolean;
}

/**
 * Menyusun katalog lengkap: seluruh field produk, gambar, dan pohon kategori.
 *
 * Dipakai **dua arah yang sama**: snapshot bertoken (`GET
 * /api/marketplace/snapshot`) dan dorongan katalog dari tombol “Sinkronkan
 * produk”. Karena keduanya memakai penyusun ini, tidak mungkin snapshot memuat
 * gambar sementara dorongan tidak.
 */
async function buildProductCatalog(
  ctx: QueryCtx,
  tenantId: Id<"tenants">,
  store: Doc<"stores"> | null,
  /**
   * Bila diisi, hanya produk dengan SKU ini yang ikut. Dipakai dorongan stok
   * otomatis: yang berangkat hanya baris yang baru bergerak, tetapi bentuk
   * kirimannya sama persis dengan tombol “Sinkronkan produk”.
   */
  onlySkus: ReadonlySet<string> | null = null,
): Promise<ProductCatalog> {
  const categoryRows = await ctx.db
    .query("categories")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .take(SNAPSHOT_CATEGORIES);
  const subcategoryRows = await ctx.db
    .query("subcategories")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .take(SNAPSHOT_SUBCATEGORIES);

  const categoryById = new Map(
    categoryRows.map((row) => [row._id as string, row]),
  );
  const subcategoryById = new Map(
    subcategoryRows.map((row) => [row._id as string, row]),
  );

  const categories: MarketplaceCategoryPayload[] = [...categoryRows]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((row) => ({
      name: row.name,
      active: row.active !== false,
      sortOrder: row.sortOrder,
      subcategories: subcategoryRows
        .filter((sub) => sub.categoryId === row._id)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map((sub) => ({
          name: sub.name,
          active: sub.active !== false,
          sortOrder: sub.sortOrder,
        })),
    }));

  const productRows = await ctx.db
    .query("products")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .take(onlySkus ? SNAPSHOT_PRODUCTS : SNAPSHOT_PRODUCTS + 1);
  const filtered = onlySkus
    ? productRows.filter((row) => onlySkus.has(row.sku))
    : productRows;
  const productsTruncated = onlySkus
    ? false
    : filtered.length > SNAPSHOT_PRODUCTS;
  const rows = productsTruncated
    ? filtered.slice(0, SNAPSHOT_PRODUCTS)
    : filtered;

  const stockRows = store
    ? await ctx.db
        .query("stockLevels")
        .withIndex("by_tenant_store", (q) =>
          q.eq("tenantId", tenantId).eq("storeId", store._id),
        )
        .take(SNAPSHOT_STOCK_ROWS)
    : [];
  const stockByProduct = new Map<string, number>();
  for (const row of stockRows) {
    if (row.warehouseId !== undefined) continue;
    const id = row.productId as string;
    stockByProduct.set(id, (stockByProduct.get(id) ?? 0) + row.quantity);
  }

  let imageBudget = SNAPSHOT_IMAGE_URLS;
  let imagesTruncated = false;
  const products: MarketplaceProductPayload[] = [];
  const skuById = new Map<string, string>();

  for (const row of rows) {
    skuById.set(row._id as string, row.sku);
    const stored = row.images ?? [];
    const wanted = stored.slice(0, SNAPSHOT_IMAGES_PER_PRODUCT);
    if (stored.length > wanted.length) imagesTruncated = true;

    const images: string[] = [];
    for (const storageId of wanted) {
      if (imageBudget <= 0) {
        imagesTruncated = true;
        break;
      }
      imageBudget -= 1;
      const url = await ctx.storage.getUrl(storageId);
      if (url) images.push(url);
    }

    const category = row.categoryId
      ? categoryById.get(row.categoryId as string)
      : undefined;
    const subcategory = row.subcategoryId
      ? subcategoryById.get(row.subcategoryId as string)
      : undefined;

    products.push({
      sku: row.sku,
      name: row.name,
      // Kode yang dipindai kasir ikut nama SKU-nya: marketplace maupun
      // MesinPOS memakai hasil scan yang sama untuk menemukan produk ini.
      // Nilainya dikirim dalam format marketplace (`code39:…`/`qr:…`) supaya
      // kolom barcode di sana tetap bisa digambar dan dipindai; jenisnya tetap
      // ikut di `barcodeType`.
      barcode: row.barcode
        ? encodeMarketplaceBarcode(
            row.barcode,
            productBarcodeTypeOr(row.barcodeType),
          )
        : null,
      barcodeType: row.barcode ? productBarcodeTypeOr(row.barcodeType) : null,
      category: category?.name ?? null,
      subcategory: subcategory?.name ?? null,
      price: row.price,
      cost: row.cost,
      unit: row.unit ?? "PCS",
      stock: stockByProduct.get(row._id as string) ?? 0,
      active: row.active,
      trackStock: row.trackStock,
      tiers: (row.tiers ?? []).map((tier) => ({
        minQty: tier.minQty,
        price: tier.price,
      })),
      units: (row.units ?? []).map((unit) => ({
        code: unit.code,
        factor: unit.factor,
      })),
      modifiers: (row.modifiers ?? []).map((group) => ({
        code: group.code,
        name: group.name,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        options: group.options.map((option) => ({
          code: option.code,
          name: option.name,
          price: option.price,
        })),
      })),
      images,
      imageCount: stored.length,
      createdAt: row.createdAt,
    });
  }

  return {
    products,
    categories,
    skuById,
    productsTruncated,
    imagesTruncated,
  };
}

/**
 * Menyusun salinan data operasional untuk marketplace.
 *
 * Angkanya dibaca langsung dari tabel domain (bukan dari ringkasan halaman), dan
 * stok yang dikirim adalah **lokasi jual** — bucket yang dipakai kasir. Gudang
 * tambahan tidak dikirim karena marketplace menjual dari stok toko.
 */
async function buildSnapshot(
  ctx: QueryCtx,
  pairing: Doc<"marketplacePairings">,
): Promise<MarketplaceSnapshotBody | null> {
  const tenant = await ctx.db.get(pairing.tenantId);
  if (!tenant) return null;

  const owner = await ctx.db.get(tenant.ownerId);
  const store = await ctx.db
    .query("stores")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
    .first();

  const catalog = await buildProductCatalog(ctx, tenant._id, store);

  const productBySku = catalog.skuById;

  const cutoff = Date.now() - SNAPSHOT_LOOKBACK_MS;
  const saleRows = await ctx.db
    .query("sales")
    .withIndex("by_tenant_created", (q) =>
      q.eq("tenantId", tenant._id).gte("createdAt", cutoff),
    )
    .order("desc")
    .take(SNAPSHOT_SALES + 1);
  const salesTruncated = saleRows.length > SNAPSHOT_SALES;
  const sales = saleRows
    .filter((row) => row.status === "completed")
    .slice(0, SNAPSHOT_SALES);

  const saleItems: SnapshotSale[] = [];
  for (const sale of sales) {
    const items = await ctx.db
      .query("saleItems")
      .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
      .take(SNAPSHOT_SALE_ITEMS);
    const methods = Array.from(
      new Set(sale.payments.map((payment) => payment.method)),
    );
    saleItems.push({
      number: sale.number,
      at: sale.createdAt,
      subtotal: sale.subtotal,
      discount: sale.discount,
      tax: sale.tax,
      total: sale.total,
      method: methods.join("+"),
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
      itemsTruncated: items.length >= SNAPSHOT_SALE_ITEMS,
      items: items.map((item) => ({
        sku: productBySku.get(item.productId as string) ?? "",
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
    });
  }

  const supplierRows = await ctx.db
    .query("suppliers")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
    .take(SNAPSHOT_SUPPLIERS);
  const supplierById = new Map(
    supplierRows.map((row) => [row._id as string, row.name]),
  );

  const purchaseRows = await ctx.db
    .query("purchaseOrders")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
    .order("desc")
    .take(SNAPSHOT_PURCHASES * 2 + 1);
  const received = purchaseRows.filter(
    (row) => row.status === "received" && (row.receivedAt ?? 0) >= cutoff,
  );
  const purchasesTruncated = received.length > SNAPSHOT_PURCHASES;
  const purchases: SnapshotPurchase[] = received
    .slice(0, SNAPSHOT_PURCHASES)
    .map((row) => ({
      number: row.number,
      at: row.receivedAt ?? row.createdAt,
      supplier: supplierById.get(row.supplierId as string) ?? "",
      // Nilai yang benar-benar diterima — bukan jumlah yang dipesan. PO yang
      // diterima sebagian tetap tercatat sebesar barang yang masuk.
      total: row.lines.reduce(
        (sum, line) => sum + (line.receivedQty || line.quantity) * line.unitCost,
        0,
      ),
    }));

  const payableRows = await ctx.db
    .query("payables")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
    .order("desc")
    .take(SNAPSHOT_PAYABLES * 2 + 1);
  const openPayables = payableRows.filter((row) => row.status === "open");
  const payablesTruncated = openPayables.length > SNAPSHOT_PAYABLES;
  const payables: SnapshotPayable[] = openPayables
    .slice(0, SNAPSHOT_PAYABLES)
    .map((row) => ({
      number: row.number,
      supplier: supplierById.get(row.supplierId as string) ?? "",
      amount: row.amount,
      paid: row.paidAmount,
      dueDate: row.dueDate,
      status: row.status,
    }));

  return {
    version: 1,
    generatedAt: Date.now(),
    pairing: {
      vendorId: pairing.vendorId,
      vendorName: pairing.vendorName,
      pairingCode: pairing.pairingCode,
      // Kontak lengkap ikut supaya marketplace bisa mencocokkannya dengan akun
      // vendornya. Snapshot hanya bisa dibaca dengan token pairing; token itu
      // tidak pernah ikut ke badan snapshot.
      contactKind: pairing.contactKind,
      contact: pairing.contact,
      contactVerified: pairing.contactVerified,
      inbound: {
        url: marketplaceInboundUrl(process.env.CONVEX_SITE_URL ?? ""),
        events: [...MARKETPLACE_INBOUND_EVENTS],
      },
    },
    business: {
      name: tenant.name,
      slug: tenant.slug,
      storeName: store?.name ?? "",
      storeCode: store?.code ?? "",
      address: tenant.address ?? store?.address ?? "",
      email: tenant.email ?? owner?.email ?? "",
      phone: tenant.phone ?? "",
      currency: tenant.currency,
      category: tenant.businessCategory?.categoryLabel ?? null,
      subcategory: tenant.businessCategory?.subcategoryLabel ?? null,
    },
    owner: {
      name: owner?.name ?? owner?.email ?? "",
      email: owner?.email ?? "",
    },
    sync: { mode: "upsert", upsertKey: "sku", createMissing: true },
    productFields: MARKETPLACE_PRODUCT_FIELDS,
    categories: catalog.categories,
    products: catalog.products,
    sales: saleItems,
    purchases,
    payables,
    counts: marketplaceSnapshotCounts({
      products: catalog.products,
      sales: saleItems,
      purchases,
      payables,
    }),
    truncated: {
      products: catalog.productsTruncated,
      sales: salesTruncated,
      purchases: purchasesTruncated,
      payables: payablesTruncated,
      images: catalog.imagesTruncated,
    },
  };
}

/**
 * Snapshot untuk satu token pairing. Endpoint HTTP memakai ini; bentuk
 * balasannya sudah membedakan “token salah” dari “data belum siap”.
 */
export const snapshotForToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const token = (args.token ?? "").trim();
    if (!isMarketplaceSyncToken(token)) {
      return { ok: false as const, error: MARKETPLACE_SNAPSHOT_ERRORS.invalidToken };
    }
    const pairing = await ctx.db
      .query("marketplacePairings")
      .withIndex("by_token", (q) => q.eq("syncToken", token))
      .unique();
    if (!pairing) {
      return { ok: false as const, error: MARKETPLACE_SNAPSHOT_ERRORS.invalidToken };
    }
    const snapshot = await buildSnapshot(ctx, pairing);
    if (!snapshot) {
      return {
        ok: false as const,
        error: "Workspace pairing sudah tidak ada.",
      };
    }
    return {
      ok: true as const,
      snapshot,
      pairingId: pairing._id,
      counts: snapshot.counts,
    };
  },
});

/** Snapshot untuk tombol “Sinkronkan sekarang”; hanya untuk pemilik. */
export const snapshotForTenant = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const pairing = await pairingOf(ctx, args.tenantId);
    if (!pairing) {
      return { ok: false as const, error: "Workspace belum dipasangkan ke vendor." };
    }
    const snapshot = await buildSnapshot(ctx, pairing);
    if (!snapshot) {
      return { ok: false as const, error: "Workspace pairing sudah tidak ada." };
    }
    return {
      ok: true as const,
      snapshot,
      counts: snapshot.counts,
      syncToken: pairing.syncToken,
      pairingCode: pairing.pairingCode,
      vendorName: pairing.vendorName,
    };
  },
});

/**
 * Katalog untuk didorong ke marketplace (dipakai action `syncProducts` dan
 * dorongan stok otomatis). Bentuk produknya sama persis dengan `products` di
 * snapshot bertoken, jadi marketplace menerima field & gambar yang sama dari
 * kedua jalur. `skus` membatasi baris yang dikirim — dipakai dorongan otomatis
 * supaya satu penjualan tidak mengirim seluruh katalog.
 */
export const productCatalogForTenant = internalQuery({
  args: {
    tenantId: v.id("tenants"),
    skus: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const pairing = await pairingOf(ctx, args.tenantId);
    if (!pairing) {
      return {
        ok: false as const,
        error: "Workspace belum dipasangkan ke vendor.",
      };
    }
    const store = await ctx.db
      .query("stores")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .first();
    const onlySkus = args.skus ? new Set(args.skus) : null;
    const catalog = await buildProductCatalog(ctx, args.tenantId, store, onlySkus);
    // `skuById` adalah `Map` dan hanya dipakai di dalam query snapshot; Map bukan
    // tipe Convex yang sah untuk nilai balik, jadi yang dikirim ke action hanya
    // bagian serialisasinya.
    return {
      ok: true as const,
      pairingId: pairing._id,
      syncToken: pairing.syncToken,
      pairingCode: pairing.pairingCode,
      pushSecret: pairing.pushSecret ?? null,
      vendorId: pairing.vendorId,
      vendorName: pairing.vendorName,
      catalog: {
        products: catalog.products,
        categories: catalog.categories,
        productsTruncated: catalog.productsTruncated,
        imagesTruncated: catalog.imagesTruncated,
      },
    };
  },
});

/** Mencatat hasil dorongan katalog produk ke baris pairing. */
export const recordProductSync = internalMutation({
  args: {
    pairingId: v.id("marketplacePairings"),
    status: v.union(
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("ready"),
    ),
    note: v.string(),
    counts: v.object({
      products: v.number(),
      created: v.number(),
      updated: v.number(),
      skipped: v.number(),
      fieldsCreated: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const pairing = await ctx.db.get(args.pairingId);
    if (!pairing) return;
    await ctx.db.patch(args.pairingId, {
      lastProductSyncAt: Date.now(),
      lastProductSyncStatus: args.status,
      lastProductSyncNote: args.note,
      lastProductSyncCounts: args.counts,
    });
  },
});

/**
 * “Sinkronkan produk”: mendorong **katalog** MesinPOS ke marketplace.
 *
 * Bedanya dengan `syncNow`: yang dikirim hanya katalog (bukan penjualan,
 * penerimaan, atau hutang), dan setiap produk membawa **seluruh field** —
 * termasuk gambar, harga modal, harga bertingkat, konversi satuan, dan modifier —
 * beserta pohon kategori sumber. Badan dorongannya menyatakan `upsertKey: "sku"`
 * dan `createMissing: true`: produk/kategori/field yang belum ada di marketplace
 * dibuat mengikuti sumbernya, bukan ditolak.
 *
 * Arahnya tetap satu jalur: MesinPOS sumber utama. Bila endpoint dorong belum
 * diisi, hasilnya jujur `ready` — data sudah tersusun dan tetap bisa ditarik
 * lewat tautan pairing bertoken.
 */
export const syncProducts = action({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args): Promise<MarketplaceProductPushResult> => {
    const gate = await ctx.runQuery(internal.marketplace.access, {
      tenantId: args.tenantId,
      actorId: args.actorId,
    });
    if (!gate.canPair) {
      throw new ConvexError(gate.blockedReason ?? "Akses ditolak.");
    }

    return await pushCatalogToMarketplace(ctx, {
      tenantId: args.tenantId,
      automatic: false,
    });
  },
});

/**
 * Rahasia penanda tangan untuk satu alamat dorongan.
 *
 * Urutannya: rahasia **endpoint webhook MesinPOS** yang URL-nya sama dengan
 * alamat dorongan (endpoint itulah yang sudah terbukti diterima marketplace —
 * riwayat kirimannya 200), lalu rahasia yang diisi khusus di kartu pairing,
 * lalu `null` (kiriman tanpa tanda tangan). Dengan begitu workspace yang sudah
 * punya endpoint webhook ke marketplace tidak perlu menyalin rahasianya lagi,
 * dan tanda tangannya dijamin sama dengan kiriman webhook yang sudah diterima.
 */
export const pushSecretForUrl = internalQuery({
  args: { tenantId: v.id("tenants"), url: v.string() },
  handler: async (ctx, args) => {
    const endpoints = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const matching = endpoints.find((row) => row.active && row.url === args.url);
    return matching?.secret ?? null;
  },
});

/**
 * Header kiriman MesinPOS → marketplace.
 *
 * Kalau rahasia penanda tangan belum diisi, header tanda tangan tidak dikirim —
 * permintaan tetap dicoba (marketplace lain mungkin hanya memakai token), dan
 * hasilnya dilaporkan apa adanya. Begitu rahasianya diisi, semua dorongan
 * (katalog, stok, penjualan) ditandatangani dengan skema webhook keluar.
 */
function marketplaceRequestHeaders(input: {
  secret: string | null;
  token: string;
  pairingCode: string;
  body: string;
}): Record<string, string> {
  if (!input.secret) {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${input.token}`,
      [MARKETPLACE_PUSH_HEADERS.pairing]: input.pairingCode,
    };
  }
  return marketplacePushHeaders({
    secret: input.secret,
    token: input.token,
    pairingCode: input.pairingCode,
    timestamp: Date.now(),
    body: input.body,
  });
}

/**
 * Pesan penolakan dari marketplace, kalau ada. Penerima menuliskan sebabnya di
 * `error`; membacanya membuat catatan status bisa ditindaklanjuti (“tanda tangan
 * tidak cocok”), bukan hanya “HTTP 401”.
 */
async function marketplaceRejection(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload?.error === "string" && payload.error.trim() !== "") {
      return ` — ${payload.error.trim().slice(0, 180)}`;
    }
  } catch {
    // Badan bukan JSON: cukup status HTTP-nya.
  }
  return "";
}

/**
 * Inti satu dorongan katalog ke marketplace — dipakai dua jalur.
 *
 *  - **manual** (tombol “Sinkronkan produk”): seluruh katalog, dicatat sebagai
 *    `lastProductSync*`.
 *  - **otomatis** (stok sesudah penjualan/opname/penerimaan): hanya SKU yang
 *    baru bergerak, bentuk badan kirimannya sama persis, dicatat sebagai
 *    `lastStockSync*`. Marketplace memakai upsert per SKU, jadi sebagian katalog
 *    tidak menghapus produk lain.
 *  - **kategori** (kategori/subkategori berubah): katalog penuh dengan event
 *    katalog `product.updated`, dicatat sebagai `lastProductSync*` — pohon
 *    kategori yang belum ada di marketplace dibuat dari kiriman ini.
 *
 * Endpoint-nya juga dipilih per jalur: jalur katalog/ kategori memakai
 * `marketplaceCatalogPushUrl` (produk → snapshot → stok), jalur stok otomatis
 * memakai `marketplaceStockPushUrl` (kunci stok → produk → snapshot).
 */
async function pushCatalogToMarketplace(
  ctx: ActionCtx,
  args: {
    tenantId: Id<"tenants">;
    /** Bila diisi, hanya produk dengan SKU ini yang ikut. */
    skus?: string[];
    automatic: boolean;
    /** Dorongan penuh karena kategori/subkategori berubah, bukan tombol. */
    category?: boolean;
  },
): Promise<MarketplaceProductPushResult> {
  const prepared = await ctx.runQuery(
    internal.marketplace.productCatalogForTenant,
    { tenantId: args.tenantId, skus: args.skus },
  );
  if (!prepared.ok) {
    if (!args.automatic) throw new ConvexError(prepared.error);
    // Workspace dilepas saat antreannya masih berjalan: tidak ada lagi yang
    // bisa dicatat, dan tidak ada yang perlu diulang.
    return {
      delivered: false,
      status: "failed",
      note: prepared.error,
      counts: { products: 0, created: 0, updated: 0, skipped: 0, fieldsCreated: 0 },
      at: Date.now(),
    };
  }

  const base: MarketplaceProductPushCounts = {
    products: prepared.catalog.products.length,
    created: 0,
    updated: 0,
    skipped: 0,
    fieldsCreated: 0,
  };
  const truncatedNote =
    prepared.catalog.productsTruncated || prepared.catalog.imagesTruncated
      ? " Sebagian katalog/gambar terpotong batas sekali kirim; jalankan lagi untuk sisanya."
      : "";
  const automaticNote = args.automatic
    ? " Perubahan stok lain akan menyusul sendiri; tombol Sinkronkan produk tetap ada untuk kiriman penuh."
    : args.category
      ? " Perubahan kategori berikutnya dikirim sendiri sesudah disimpan."
      : truncatedNote;

  /** Satu tempat pencatatan: jalur manual & otomatis tidak saling menimpa. */
  const record = async (
    status: "delivered" | "failed" | "ready",
    note: string,
    counts: MarketplaceProductPushCounts,
  ) => {
    if (args.automatic) {
      await ctx.runMutation(internal.marketplace.recordStockSync, {
        pairingId: prepared.pairingId,
        status: status === "ready" ? "failed" : status,
        note,
        counts,
      });
      return;
    }
    await ctx.runMutation(internal.marketplace.recordProductSync, {
      pairingId: prepared.pairingId,
      status,
      note,
      counts,
    });
  };

  const endpoint = args.automatic
    ? marketplaceStockPushUrl(process.env)
    : marketplaceCatalogPushUrl(process.env);

  // Rahasia endpoint webhook yang alamatnya sama menang atas rahasia kartu:
  // kiriman webhook ke alamat itu sudah terbukti diterima (riwayat 200).
  const endpointSecret =
    endpoint === ""
      ? null
      : await ctx.runQuery(internal.marketplace.pushSecretForUrl, {
          tenantId: args.tenantId,
          url: endpoint,
        });
  const signingSecret = endpointSecret ?? prepared.pushSecret;

  if (endpoint === "") {
    const note = args.automatic
      ? `Stok ${base.products} produk siap, tetapi endpoint dorong stok belum diisi. Isi ${MARKETPLACE_ENV.stockUrl} atau ${MARKETPLACE_ENV.productsUrl} supaya perubahan stok berangkat sendiri.`
      : args.category
        ? `Kategori & subkategori sudah tersimpan, tetapi endpoint dorong katalog belum diisi. Isi ${MARKETPLACE_ENV.productsUrl} supaya pohonnya berangkat sendiri; sementara itu marketplace tetap menerimanya lewat tautan pairing.`
        : `Katalog ${base.products} produk — gambar dan seluruh field ikut — sudah siap ditarik marketplace lewat tautan pairing. Isi ${MARKETPLACE_ENV.productsUrl} untuk mendorong katalog langsung.${truncatedNote}`;
    await record("ready", note, base);
    return {
      delivered: false,
      status: "ready",
      note,
      counts: base,
      at: Date.now(),
    };
  }

  const at = Date.now();
  // Amplop peristiwa (`id` + `event`) wajib: penerima marketplace menolak
  // kiriman tanpa keduanya dengan HTTP 400 — “Event MesinPOS tidak menyebut
  // `id` atau `event`”. Amplopnya sama dengan webhook keluar, `id` unik per
  // kiriman supaya penerima bisa membuang kiriman kembar, dan `event` menyebut
  // isinya (katalog/manual vs stok otomatis).
  const event = args.automatic
    ? MARKETPLACE_PUSH_EVENTS.stock
    : MARKETPLACE_PUSH_EVENTS.catalog;
  const subject = args.automatic
    ? `${args.skus?.length ?? base.products}sku`
    : args.category
      ? "kategori"
      : "katalog";
  const body = marketplacePushEnvelope({
    event,
    at,
    subject,
    upsertKey: "sku",
    /**
     * “stock” = berangkat sendiri sesudah perubahan stok; “category” = berangkat
     * sendiri sesudah kategori/subkategori berubah; “manual” = tombol.
     */
    trigger: args.automatic ? "stock" : args.category ? "category" : "manual",
    pairing: {
      vendorId: prepared.vendorId,
      vendorName: prepared.vendorName,
      pairingCode: prepared.pairingCode,
    },
    data: {
      fields: MARKETPLACE_PRODUCT_FIELDS,
      categories: prepared.catalog.categories,
      products: prepared.catalog.products,
      truncated: {
        products: prepared.catalog.productsTruncated,
        images: prepared.catalog.imagesTruncated,
      },
    },
  });

  try {
    const payloadText = JSON.stringify(body);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: marketplaceRequestHeaders({
        secret: signingSecret,
        token: prepared.syncToken,
        pairingCode: prepared.pairingCode,
        body: payloadText,
      }),
      body: payloadText,
      signal: marketplaceFetchSignal(),
    });

    if (!response.ok) {
      const reason = await marketplaceRejection(response);
      const note = args.automatic
        ? `Marketplace menolak kiriman stok otomatis (HTTP ${response.status})${reason}. Perubahan stok berikutnya akan mencobanya lagi.`
        : args.category
          ? `Marketplace menolak kiriman kategori & subkategori (HTTP ${response.status})${reason}. Kategori tetap bisa ditarik lewat tautan pairing; perubahan berikutnya akan mencobanya lagi.${truncatedNote}`
          : `Marketplace menolak katalog (HTTP ${response.status})${reason}. Katalog tetap bisa ditarik lewat tautan pairing.${truncatedNote}`;
      await record("failed", note, base);
      return {
        delivered: false,
        status: "failed",
        note,
        counts: base,
        at: Date.now(),
      };
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const reported = parseMarketplaceProductPushResponse(payload);
    const counts: MarketplaceProductPushCounts = reported
      ? { ...base, ...reported }
      : base;
    const note = reported
      ? args.automatic
        ? `Stok ${counts.products} produk diterima marketplace: ${counts.created} dibuat, ${counts.updated} diperbarui, ${counts.skipped} tidak berubah.${automaticNote}`
        : args.category
          ? `Kategori & subkategori terkirim bersama katalog: ${counts.created} produk dibuat, ${counts.updated} diperbarui, ${counts.skipped} tidak berubah, ${counts.fieldsCreated} field baru dibuat.${automaticNote}`
          : `Katalog diterima marketplace: ${counts.created} produk dibuat, ${counts.updated} diperbarui, ${counts.skipped} tidak berubah, ${counts.fieldsCreated} field baru dibuat.${truncatedNote}`
      : args.automatic
        ? `Stok ${counts.products} produk diterima marketplace; marketplace tidak melaporkan jumlah yang berubah.${automaticNote}`
        : args.category
          ? `Katalog ${counts.products} produk beserta kategori & subkategori diterima marketplace; marketplace tidak melaporkan jumlah produk yang dibuat/diperbarui.${automaticNote}`
          : `Katalog ${counts.products} produk diterima marketplace; marketplace tidak melaporkan jumlah produk yang dibuat/diperbarui.${truncatedNote}`;

    await record("delivered", note, counts);
    return {
      delivered: true,
      status: "delivered",
      note,
      counts,
      at: Date.now(),
    };
  } catch {
    const note = args.automatic
      ? `Endpoint marketplace tidak bisa dihubungi saat mengirim stok. Perubahan stok berikutnya akan mencobanya lagi, atau tekan Sinkronkan produk.${automaticNote}`
      : args.category
        ? `Endpoint marketplace tidak bisa dihubungi saat mengirim kategori & subkategori. Perubahan berikutnya akan mencobanya lagi; katalog tetap bisa ditarik lewat tautan pairing.${truncatedNote}`
        : `Endpoint marketplace tidak bisa dihubungi. Katalog tetap bisa ditarik lewat tautan pairing.${truncatedNote}`;
    await record("failed", note, base);
    return {
      delivered: false,
      status: "failed",
      note,
      counts: base,
      at: Date.now(),
    };
  }
}

/* --------------------------------------------------------- stok otomatis */

/**
 * Antrean stok yang menunggu dikirim, sudah diterjemahkan ke SKU.
 *
 * `skus: null` berarti antreannya melewati batas dan yang benar dikirim adalah
 * seluruh katalog (`pushAll`) — bukan sebagian yang membuat sisa perubahan hilang.
 */
export const stockQueueForTenant = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const pairing = await pairingOf(ctx, args.tenantId);
    if (!pairing) return null;

    const rows = await ctx.db
      .query("marketplaceStockQueue")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    if (rows.length === 0) return null;

    const pushAll = rows.some((row) => row.pushAll);
    // Baris `catalog` lahir dari perubahan kategori/subkategori: kirimannya
    // memakai event katalog, bukan event stok.
    const catalog = rows.some((row) => row.catalog === true);
    const ids = new Set<string>();
    for (const row of rows) {
      for (const id of row.productIds) ids.add(id as string);
    }

    const skus: string[] = [];
    for (const id of ids) {
      const product = await ctx.db.get(id as Id<"products">);
      // Produk yang sudah dihapus atau milik tenant lain dilewati: yang dikirim
      // hanya baris yang benar-benar milik workspace ini.
      if (product && product.tenantId === args.tenantId) skus.push(product.sku);
    }

    return {
      pairingId: pairing._id,
      skus: pushAll ? null : skus,
      catalog,
      queued: rows.length,
    };
  },
});

/** Menghapus antrean stok tenant setelah isinya dibaca. */
export const clearStockQueue = internalMutation({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("marketplaceStockQueue")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});

/** Mencatat hasil dorongan stok otomatis ke baris pairing. */
export const recordStockSync = internalMutation({
  args: {
    pairingId: v.id("marketplacePairings"),
    status: v.union(v.literal("delivered"), v.literal("failed")),
    note: v.string(),
    counts: v.object({
      products: v.number(),
      created: v.number(),
      updated: v.number(),
      skipped: v.number(),
      fieldsCreated: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const pairing = await ctx.db.get(args.pairingId);
    if (!pairing) return;
    await ctx.db.patch(args.pairingId, {
      lastStockSyncAt: Date.now(),
      lastStockSyncStatus: args.status,
      lastStockSyncNote: args.note,
      lastStockSyncCounts: args.counts,
    });
  },
});

/**
 * Mengirim antrean stok satu workspace ke marketplace.
 *
 * Dijadwalkan `queueMarketplaceStockPush` sesudah setiap pergerakan stok, dan
 * disapu cron kalau ada antrean yang tertinggal. Urutannya sengaja: **baca lalu
 * hapus**, supaya pergerakan stok yang datang saat kiriman sedang berjalan
 * membuat baris baru beserta jadwal baru — bukan hilang bersama baris lama.
 */
export const pushQueuedStock = internalAction({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args): Promise<void> => {
    const batch = await ctx.runQuery(internal.marketplace.stockQueueForTenant, {
      tenantId: args.tenantId,
    });
    if (!batch) return;
    await ctx.runMutation(internal.marketplace.clearStockQueue, {
      tenantId: args.tenantId,
    });

    // `skus: null` = seluruh katalog; daftar kosong = semua produknya sudah
    // hilang, jadi tidak ada yang perlu dikirim.
    if (batch.skus !== null && batch.skus.length === 0) return;
    if (batch.catalog) {
      // Perubahan kategori/subkategori: katalog penuh dengan event katalog,
      // dicatat di `lastProductSync*` seperti tombol Sinkronkan produk.
      await pushCatalogToMarketplace(ctx, {
        tenantId: args.tenantId,
        automatic: false,
        category: true,
      });
      return;
    }
    await pushCatalogToMarketplace(ctx, {
      tenantId: args.tenantId,
      skus: batch.skus ?? undefined,
      automatic: true,
    });
  },
});

/**
 * Menyapu antrean stok yang tertinggal (mis. action-nya gagal di tengah jalan).
 *
 * Dijalankan cron: baris yang lebih tua dari `MARKETPLACE_STOCK_QUEUE_STALE_MS`
 * dijadwalkan ulang, satu kali per workspace. Tanpa ini, satu action yang mati
 * membuat stok marketplace tertinggal sampai ada penjualan berikutnya.
 */
export const sweepStockQueues = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - MARKETPLACE_STOCK_QUEUE_STALE_MS;
    const rows = await ctx.db
      .query("marketplaceStockQueue")
      .withIndex("by_created", (q) => q.lt("createdAt", cutoff))
      .take(Math.max(1, Math.min(50, Math.floor(args.limit))));

    const tenants = new Set<Id<"tenants">>();
    for (const row of rows) tenants.add(row.tenantId);
    for (const tenantId of tenants) {
      await ctx.scheduler.runAfter(0, internal.marketplace.pushQueuedStock, {
        tenantId,
      });
    }
    return { scanned: rows.length, scheduled: tenants.size };
  },
});

/* ------------------------------------------------ penjualan otomatis */

/** Saldo stok **lokasi jual** (bucket tanpa `warehouseId`) satu produk. */
async function sellableStock(
  ctx: QueryCtx,
  storeId: Id<"stores"> | undefined,
  productId: Id<"products">,
): Promise<number> {
  if (!storeId) return 0;
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
 * Antrean penjualan yang menunggu dikirim, sudah diterjemahkan ke baris kiriman.
 *
 * Stok dibaca **sesudah** transaksi tersimpan, jadi angkanya adalah saldo yang
 * benar-benar dilihat kasir sekarang — bukan angka sebelum nota. Nota yang sudah
 * dihapus atau bukan milik tenant dilewati, bukan dikirim sebagai baris kosong.
 */
export const salesQueueForTenant = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const pairing = await pairingOf(ctx, args.tenantId);
    if (!pairing) return null;

    const rows = await ctx.db
      .query("marketplaceSaleQueue")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    if (rows.length === 0) return null;

    const ids = new Set<string>();
    for (const row of rows) {
      for (const id of row.saleIds) ids.add(id as string);
    }

    const sales: MarketplaceSaleRow[] = [];
    const stock = new Map<string, MarketplaceStockRow>();
    for (const id of ids) {
      const sale = await ctx.db.get(id as Id<"sales">);
      if (!sale || sale.tenantId !== args.tenantId) continue;

      const items = await ctx.db
        .query("saleItems")
        .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
        .collect();
      const lines: MarketplaceSaleLine[] = [];
      for (const item of items) {
        const product = await ctx.db.get(item.productId);
        const sku = product?.sku ?? "";
        lines.push({
          sku,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          modifiers: item.modifiers ?? [],
        });
        if (sku !== "" ) {
          stock.set(sku, {
            sku,
            stock: await sellableStock(ctx, sale.storeId, item.productId),
          });
        }
      }

      const customer = sale.customerId ? await ctx.db.get(sale.customerId) : null;
      const member = sale.memberId ? await ctx.db.get(sale.memberId) : null;
      const methods = Array.from(
        new Set(sale.payments.map((payment) => payment.method)),
      );
      sales.push({
        number: sale.number,
        status: sale.status === "void" ? "void" : "completed",
        at: sale.createdAt,
        subtotal: sale.subtotal,
        discount: sale.discount,
        tax: sale.tax,
        total: sale.total,
        method: methods.join("+"),
        customerCode: customer?.code ?? null,
        memberCode: member?.code ?? null,
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
        items: lines,
      });
    }

    return {
      pairingId: pairing._id,
      syncToken: pairing.syncToken,
      pairingCode: pairing.pairingCode,
      pushSecret: pairing.pushSecret ?? null,
      vendorId: pairing.vendorId,
      vendorName: pairing.vendorName,
      sales,
      stock: [...stock.values()],
      queued: rows.length,
    };
  },
});

/** Menghapus antrean penjualan tenant setelah isinya dibaca. */
export const clearSalesQueue = internalMutation({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("marketplaceSaleQueue")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});

/** Mencatat hasil dorongan penjualan otomatis ke baris pairing. */
export const recordSalesSync = internalMutation({
  args: {
    pairingId: v.id("marketplacePairings"),
    status: v.union(v.literal("delivered"), v.literal("failed")),
    note: v.string(),
    counts: v.object({
      sales: v.number(),
      items: v.number(),
      stock: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const pairing = await ctx.db.get(args.pairingId);
    if (!pairing) return;
    await ctx.db.patch(args.pairingId, {
      lastSalesSyncAt: Date.now(),
      lastSalesSyncStatus: args.status,
      lastSalesSyncNote: args.note,
      lastSalesSyncCounts: args.counts,
    });
  },
});

/**
 * Mengirim antrean penjualan satu workspace ke marketplace.
 *
 * Dijadwalkan `queueMarketplaceSalePush` sesudah setiap nota selesai/dibatalkan,
 * dan disapu cron kalau ada antrean yang tertinggal. Urutannya **baca lalu
 * hapus**, sama seperti antrean stok: nota yang masuk saat kiriman berjalan
 * membuat baris baru dengan jadwal baru, bukan hilang bersama baris lama.
 */
export const pushQueuedSales = internalAction({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args): Promise<void> => {
    const batch = await ctx.runQuery(internal.marketplace.salesQueueForTenant, {
      tenantId: args.tenantId,
    });
    if (!batch) return;
    await ctx.runMutation(internal.marketplace.clearSalesQueue, {
      tenantId: args.tenantId,
    });

    const counts = {
      sales: batch.sales.length,
      items: batch.sales.reduce((sum, sale) => sum + sale.items.length, 0),
      stock: batch.stock.length,
    };
    if (batch.sales.length === 0) return;

    const endpoint = marketplaceSalesPushUrl(process.env);
    const endpointSecret =
      endpoint === ""
        ? null
        : await ctx.runQuery(internal.marketplace.pushSecretForUrl, {
            tenantId: args.tenantId,
            url: endpoint,
          });
    const signingSecret = endpointSecret ?? batch.pushSecret;
    if (endpoint === "") {
      await ctx.runMutation(internal.marketplace.recordSalesSync, {
        pairingId: batch.pairingId,
        status: "failed",
        note: `Penjualan ${counts.sales} nota siap, tetapi endpoint dorong belum diisi. Isi ${MARKETPLACE_ENV.salesUrl} (atau ${MARKETPLACE_ENV.stockUrl}) supaya nota berangkat sendiri; marketplace juga tetap bisa menariknya lewat tautan pairing.`,
        counts,
      });
      return;
    }

    const data: MarketplaceSalesPushBody = marketplaceSalesPushBody({
      generatedAt: Date.now(),
      pairing: {
        vendorId: batch.vendorId,
        vendorName: batch.vendorName,
        pairingCode: batch.pairingCode,
      },
      sales: batch.sales,
      stock: batch.stock,
    });
    // Amplop yang sama dengan dorongan katalog: `id`/`event` wajib ada, kalau
    // tidak marketplace menjawab HTTP 400 (“tidak menyebut `id` atau `event`”).
    const body = marketplacePushEnvelope({
      event: marketplaceSalesPushEvent(batch.sales),
      at: data.generatedAt,
      subject: marketplaceSalesPushSubject(batch.sales),
      upsertKey: "number",
      trigger: "sale",
      pairing: data.pairing,
      data,
    });

    try {
      const payloadText = JSON.stringify(body);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: marketplaceRequestHeaders({
          secret: signingSecret,
          token: batch.syncToken,
          pairingCode: batch.pairingCode,
          body: payloadText,
        }),
        body: payloadText,
        signal: marketplaceFetchSignal(),
      });
      if (!response.ok) {
        const reason = await marketplaceRejection(response);
        await ctx.runMutation(internal.marketplace.recordSalesSync, {
          pairingId: batch.pairingId,
          status: "failed",
          note: `Marketplace menolak kiriman penjualan (HTTP ${response.status})${reason}. Nota berikutnya akan mencoba lagi; kiriman yang gagal tidak diklaim tersinkron.`,
          counts,
        });
        return;
      }
      await ctx.runMutation(internal.marketplace.recordSalesSync, {
        pairingId: batch.pairingId,
        status: "delivered",
        note: `Penjualan ${counts.sales} nota (${counts.items} item) dan stok ${counts.stock} SKU diterima marketplace.`,
        counts,
      });
    } catch {
      await ctx.runMutation(internal.marketplace.recordSalesSync, {
        pairingId: batch.pairingId,
        status: "failed",
        note: "Endpoint marketplace tidak bisa dihubungi saat mengirim penjualan. Nota berikutnya akan mencoba lagi.",
        counts,
      });
    }
  },
});

/** Menyapu antrean penjualan yang tertinggal (action mati di tengah jalan). */
export const sweepSaleQueues = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - MARKETPLACE_SALES_QUEUE_STALE_MS;
    const rows = await ctx.db
      .query("marketplaceSaleQueue")
      .withIndex("by_created", (q) => q.lt("createdAt", cutoff))
      .take(Math.max(1, Math.min(50, Math.floor(args.limit))));

    const tenants = new Set<Id<"tenants">>();
    for (const row of rows) tenants.add(row.tenantId);
    for (const tenantId of tenants) {
      await ctx.scheduler.runAfter(0, internal.marketplace.pushQueuedSales, {
        tenantId,
      });
    }
    return { scanned: rows.length, scheduled: tenants.size };
  },
});

/** Mencatat bahwa marketplace sudah menarik snapshot. */
export const recordPull = internalMutation({
  args: {
    pairingId: v.id("marketplacePairings"),
    counts: v.object({
      products: v.number(),
      sales: v.number(),
      purchases: v.number(),
      payables: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const pairing = await ctx.db.get(args.pairingId);
    if (!pairing) return;
    await ctx.db.patch(args.pairingId, {
      lastPullAt: Date.now(),
      lastPullCounts: args.counts,
    });
  },
});

/** Mencatat hasil dorongan snapshot ke endpoint marketplace. */
export const recordSync = internalMutation({
  args: {
    pairingId: v.id("marketplacePairings"),
    status: v.union(
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("ready"),
    ),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const pairing = await ctx.db.get(args.pairingId);
    if (!pairing) return;
    await ctx.db.patch(args.pairingId, {
      lastSyncAt: Date.now(),
      lastSyncStatus: args.status,
      lastSyncNote: args.note,
    });
  },
});

/**
 * “Sinkronkan sekarang”.
 *
 * Snapshot selalu disusun dari data terbaru. Kalau marketplace menyediakan
 * endpoint tulis (`PUSATBAHANBANGUNAN_SYNC_URL`), snapshot didorong ke sana;
 * kalau belum, hasilnya jujur: data **siap** dan marketplace bisa menariknya
 * lewat tautan pairing. Tidak ada klaim “terkirim” tanpa jawaban 2xx.
 */
export const syncNow = action({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args): Promise<MarketplaceSyncResult> => {
    const gate = await ctx.runQuery(internal.marketplace.access, {
      tenantId: args.tenantId,
      actorId: args.actorId,
    });
    if (!gate.canPair) {
      throw new ConvexError(gate.blockedReason ?? "Akses ditolak.");
    }

    const prepared = await ctx.runQuery(internal.marketplace.snapshotForTenant, {
      tenantId: args.tenantId,
    });
    if (!prepared.ok) throw new ConvexError(prepared.error);

    const pairingRow = await ctx.runQuery(internal.marketplace.pairingMeta, {
      tenantId: args.tenantId,
    });
    if (!pairingRow) throw new ConvexError("Workspace belum dipasangkan ke vendor.");

    const syncUrl = process.env[MARKETPLACE_ENV.syncUrl];
    if (!syncUrl) {
      const note =
        "Snapshot terbaru sudah disusun. Marketplace menariknya lewat tautan pairing; endpoint dorong belum diisi.";
      await ctx.runMutation(internal.marketplace.recordSync, {
        pairingId: pairingRow.pairingId,
        status: "ready",
        note,
      });
      return {
        delivered: false as const,
        status: "ready" as const,
        note,
        counts: prepared.counts,
        at: Date.now(),
      };
    }

    try {
      const response = await fetch(syncUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${prepared.syncToken}`,
          "x-mesinpos-pairing": prepared.pairingCode,
        },
        body: JSON.stringify(prepared.snapshot),
        signal: marketplaceFetchSignal(),
      });
      if (!response.ok) {
        const note = `Marketplace menolak snapshot (HTTP ${response.status}). Data tetap bisa ditarik lewat tautan pairing.`;
        await ctx.runMutation(internal.marketplace.recordSync, {
          pairingId: pairingRow.pairingId,
          status: "failed",
          note,
        });
        return {
          delivered: false as const,
          status: "failed" as const,
          note,
          counts: prepared.counts,
          at: Date.now(),
        };
      }
      const note = "Snapshot diterima marketplace.";
      await ctx.runMutation(internal.marketplace.recordSync, {
        pairingId: pairingRow.pairingId,
        status: "delivered",
        note,
      });
      return {
        delivered: true as const,
        status: "delivered" as const,
        note,
        counts: prepared.counts,
        at: Date.now(),
      };
    } catch {
      const note =
        "Endpoint marketplace tidak bisa dihubungi. Data tetap bisa ditarik lewat tautan pairing.";
      await ctx.runMutation(internal.marketplace.recordSync, {
        pairingId: pairingRow.pairingId,
        status: "failed",
        note,
      });
      return {
        delivered: false as const,
        status: "failed" as const,
        note,
        counts: prepared.counts,
        at: Date.now(),
      };
    }
  },
});

/* ---------------------------------------- katalog marketplace → MesinPOS */

/**
 * “Impor katalog dari marketplace”: arah sebaliknya dari tombol “Sinkronkan
 * produk”.
 *
 * Yang diambil hanyalah katalog vendor yang **sudah dipasangkan** (query publik
 * `marketplace:getProducts` dengan `vendorId` pairing), lalu:
 *
 *  - kategori & subkategori yang belum ada **dibuat** di MesinPOS;
 *  - produk di-upsert **berdasarkan SKU** — nama, harga, satuan, kategori, dan
 *    status aktif mengikuti marketplace;
 *  - gambar marketplace diunduh ke penyimpanan MesinPOS untuk produk baru (atau
 *    produk lokal yang belum punya gambar), maksimal 3 gambar/produk;
 *  - **stok ikut disinkronkan** ke saldo lokasi jual toko utama, dan setiap
 *    perubahan ditulis sebagai pergerakan stok `adjustment` agar bisa diaudit.
 *    Harga modal tetap milik POS karena marketplace tidak mengirimkannya; stok
 *    gudang tambahan tidak disentuh.
 *
 * Hanya pemilik yang boleh menjalankannya, sama seperti tombol marketplace
 * lainnya. Hasilnya disimpan di baris pairing supaya kartu bisa menunjukkan
 * kapan impor terakhir berjalan dan berapa yang berubah.
 */

const CATALOG_LOCAL_PRODUCT_SCAN = 2000;
/** Batas ukuran satu gambar marketplace yang mau disimpan (byte). */
const CATALOG_IMAGE_MAX_BYTES = 1_500_000;

function catalogNameKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID");
}

async function fetchMarketplaceCatalog(vendorId: string): Promise<unknown> {
  const base = (
    process.env[MARKETPLACE_ENV.queryUrl] ?? MARKETPLACE_QUERY_URL_DEFAULT
  )
    .trim()
    .replace(/\/+$/, "");

  let response: Response;
  try {
    response = await fetch(`${base}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: MARKETPLACE_PRODUCTS_QUERY,
        args: { vendorId },
        format: "json",
      }),
      signal: marketplaceFetchSignal(),
    });
  } catch {
    throw new ConvexError(
      "Katalog marketplace tidak bisa dihubungi. Periksa sambungan lalu coba lagi.",
    );
  }
  if (!response.ok) {
    throw new ConvexError(
      `Katalog marketplace tidak bisa dibaca (HTTP ${response.status}). Coba lagi beberapa saat lagi.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ConvexError(
      "Katalog marketplace mengirim balasan yang tidak bisa dibaca.",
    );
  }

  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  if (record.status !== "success") {
    throw new ConvexError(
      "Marketplace menolak permintaan katalog vendor. Coba lagi beberapa saat lagi.",
    );
  }
  return record.value;
}

/** Mengunduh satu gambar marketplace ke penyimpanan Convex; gagal = `null`. */
async function storeCatalogImage(
  ctx: ActionCtx,
  url: string,
): Promise<Id<"_storage"> | null> {
  try {
    const response = await fetch(url, { signal: marketplaceFetchSignal() });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!type.startsWith("image/")) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > CATALOG_IMAGE_MAX_BYTES) {
      return null;
    }
    return await ctx.storage.store(new Blob([bytes], { type }));
  } catch {
    return null;
  }
}

/**
 * SKU lokal yang **sudah punya gambar**. Action memakainya untuk tidak
 * mengunduh ulang gambar yang sudah ada — impor berulang tidak boleh menggandakan
 * berkas penyimpanan.
 */
export const catalogImportState = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .take(CATALOG_LOCAL_PRODUCT_SCAN);
    return {
      withImages: rows
        .filter((row) => (row.images?.length ?? 0) > 0)
        .map((row) => row.sku),
    };
  },
});

/**
 * Menulis hasil impor katalog ke tabel domain.
 *
 * Seluruh baris diproses dalam **satu mutation**, jadi tidak ada keadaan setengah
 * jadi: kalau satu baris gagal, tidak ada kategori/produk yang tertinggal.
 */
export const applyCatalogImport = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    pairingId: v.id("marketplacePairings"),
    /** Baris marketplace yang dibuang `parseMarketplaceCatalogProducts`. */
    skippedRows: v.number(),
    products: v.array(
      v.object({
        sourceId: v.string(),
        sku: v.string(),
        name: v.string(),
        category: v.union(v.string(), v.null()),
        subcategory: v.union(v.string(), v.null()),
        price: v.number(),
        stock: v.number(),
        unit: v.string(),
        active: v.union(v.boolean(), v.null()),
        barcode: v.union(v.string(), v.null()),
        barcodeType: v.union(
          v.literal("barcode"),
          v.literal("qr"),
          v.null(),
        ),
        images: v.array(v.string()),
        imageIds: v.array(v.id("_storage")),
      }),
    ),
  },
  handler: async (ctx, args): Promise<MarketplaceCatalogCounts> => {
    const now = Date.now();
    const counts: MarketplaceCatalogCounts = {
      ...EMPTY_MARKETPLACE_CATALOG_COUNTS,
      products: args.products.length,
      skipped: Math.max(0, Math.round(args.skippedRows)),
    };

    const categoryRows = await ctx.db
      .query("categories")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .take(1000);
    const subcategoryRows = await ctx.db
      .query("subcategories")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .take(2000);

    const categoryIdByName = new Map<string, Id<"categories">>(
      categoryRows.map((row) => [catalogNameKey(row.name), row._id]),
    );
    let nextCategoryOrder = categoryRows.reduce(
      (max, row) => Math.max(max, row.sortOrder + 1),
      0,
    );

    const subcategoryIdByKey = new Map<string, Id<"subcategories">>(
      subcategoryRows.map((row) => [
        `${row.categoryId as string}:${catalogNameKey(row.name)}`,
        row._id,
      ]),
    );
    const nextSubcategoryOrder = new Map<string, number>();
    for (const row of subcategoryRows) {
      nextSubcategoryOrder.set(
        row.categoryId as string,
        Math.max(
          nextSubcategoryOrder.get(row.categoryId as string) ?? 0,
          row.sortOrder + 1,
        ),
      );
    }

    /** Kategori dibuat saat pertama kali disebut, urut kemunculan katalog. */
    const ensureCategory = async (
      name: string,
    ): Promise<Id<"categories">> => {
      const key = catalogNameKey(name);
      const existing = categoryIdByName.get(key);
      if (existing) return existing;
      const id = await ctx.db.insert("categories", {
        tenantId: args.tenantId,
        name,
        sortOrder: nextCategoryOrder,
        active: true,
        createdAt: now,
      });
      nextCategoryOrder += 1;
      categoryIdByName.set(key, id);
      counts.categories += 1;
      return id;
    };

    const ensureSubcategory = async (
      categoryId: Id<"categories">,
      name: string,
    ): Promise<Id<"subcategories">> => {
      const key = `${categoryId as string}:${catalogNameKey(name)}`;
      const existing = subcategoryIdByKey.get(key);
      if (existing) return existing;
      const id = await ctx.db.insert("subcategories", {
        tenantId: args.tenantId,
        categoryId,
        name,
        sortOrder: nextSubcategoryOrder.get(categoryId as string) ?? 0,
        active: true,
        createdAt: now,
      });
      nextSubcategoryOrder.set(
        categoryId as string,
        (nextSubcategoryOrder.get(categoryId as string) ?? 0) + 1,
      );
      subcategoryIdByKey.set(key, id);
      counts.subcategories += 1;
      return id;
    };

    const localRows = await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .take(CATALOG_LOCAL_PRODUCT_SCAN);
    const productBySku = new Map(
      localRows.map((row) => [catalogNameKey(row.sku), row]),
    );

    /*
      Peta pemilik kode: satu hasil scan hanya boleh menunjuk satu produk, dan
      kode tidak boleh menabrak SKU produk lain — aturan yang sama dengan
      `products.create`/`products.setBarcode`. Peta ini diisi produk yang sudah
      ada **dan** produk yang baru dibuat di impor ini, supaya dua baris
      marketplace tidak merebut satu kode.
    */
    const barcodeOwner = new Map<string, Id<"products">>();
    const skuOwner = new Map<string, Id<"products">>();
    for (const row of localRows) {
      skuOwner.set(productBarcodeKey(row.sku), row._id);
      if (row.barcode) barcodeOwner.set(productBarcodeKey(row.barcode), row._id);
    }

    const barcodeTaken = (
      key: string,
      productId?: Id<"products">,
    ): boolean => {
      if (key === "") return false;
      const ownerBarcode = barcodeOwner.get(key);
      if (ownerBarcode !== undefined && ownerBarcode !== productId) return true;
      const ownerSku = skuOwner.get(key);
      return ownerSku !== undefined && ownerSku !== productId;
    };

    /*
      Stok yang disinkronkan adalah stok **lokasi jual toko utama** — bucket yang
      dipakai kasir. Impor katalog marketplace adalah permintaan pemilik: saldo
      produk yang datang dari marketplace dipakai apa adanya, lalu setiap
      perubahan dicatat sebagai pergerakan stok `adjustment` supaya riwayatnya
      bisa diaudit. Stok gudang tambahan tidak disentuh.
    */
    const store = await ctx.db
      .query("stores")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .first();
    for (const row of args.products) {
      const sku = row.sku.trim();
      if (sku === "") {
        counts.skipped += 1;
        continue;
      }

      const categoryId = row.category ? await ensureCategory(row.category) : null;
      const subcategoryId =
        categoryId && row.subcategory
          ? await ensureSubcategory(categoryId, row.subcategory)
          : null;

      /*
        Barcode/QR kasir ikut tersinkron: hasil scan di marketplace dan di kasir
        menunjuk SKU yang sama. Kode yang sudah dipakai produk lain dilewati —
        satu kode tidak boleh membuka dua barang — dan produknya tetap diimpor,
        bukan dibatalkan seluruhnya.
      */
      const code = (row.barcode ?? "").trim();
      const codeKey = code === "" ? "" : productBarcodeKey(code);
      const codeType: ProductBarcodeType = row.barcodeType ?? "barcode";

      const existing = productBySku.get(catalogNameKey(sku));
      let productId: Id<"products">;
      if (!existing) {
        const simpanKode = code !== "" && !barcodeTaken(codeKey);
        if (code !== "" && !simpanKode) counts.barcodeConflicts += 1;
        productId = await ctx.db.insert("products", {
          tenantId: args.tenantId,
          sku,
          name: row.name,
          ...(categoryId ? { categoryId } : {}),
          ...(subcategoryId ? { subcategoryId } : {}),
          price: Math.max(0, Math.round(row.price)),
          cost: 0,
          trackStock: true,
          active: row.active ?? true,
          unit: row.unit || "PCS",
          ...(simpanKode ? { barcode: code, barcodeType: codeType } : {}),
          ...(row.imageIds.length > 0 ? { images: row.imageIds } : {}),
          createdAt: now,
        });
        if (simpanKode) {
          counts.barcodes += 1;
          barcodeOwner.set(codeKey, productId);
        }
        skuOwner.set(productBarcodeKey(sku), productId);
        counts.created += 1;
        counts.images += row.imageIds.length;
      } else {
        productId = existing._id;
        const changes: {
          name?: string;
          price?: number;
          unit?: string;
          active?: boolean;
          categoryId?: Id<"categories">;
          subcategoryId?: Id<"subcategories">;
          images?: Id<"_storage">[];
          barcode?: string;
          barcodeType?: ProductBarcodeType;
        } = {};

        if (existing.name !== row.name) changes.name = row.name;
        const price = Math.max(0, Math.round(row.price));
        if (existing.price !== price) changes.price = price;
        const unit = row.unit || "PCS";
        if ((existing.unit ?? "PCS") !== unit) changes.unit = unit;
        if (row.active !== null && existing.active !== row.active) {
          changes.active = row.active;
        }
        if (categoryId && existing.categoryId !== categoryId) {
          changes.categoryId = categoryId;
        }
        if (subcategoryId && existing.subcategoryId !== subcategoryId) {
          changes.subcategoryId = subcategoryId;
        }
        if (
          row.imageIds.length > 0 &&
          (existing.images?.length ?? 0) === 0
        ) {
          changes.images = row.imageIds;
          counts.images += row.imageIds.length;
        }
        if (code !== "") {
          if (barcodeTaken(codeKey, existing._id)) {
            counts.barcodeConflicts += 1;
          } else {
            // Kode yang dilepas di marketplace **tidak** menghapus kode lokal:
            // baris tanpa kode bisa berarti marketplace belum mengisinya, dan
            // menghapus label yang sudah tercetak bukan tugas impor.
            if (
              existing.barcode !== code ||
              productBarcodeTypeOr(existing.barcodeType) !== codeType
            ) {
              changes.barcode = code;
              changes.barcodeType = codeType;
              counts.barcodes += 1;
            }
            barcodeOwner.set(codeKey, existing._id);
          }
        }

        if (Object.keys(changes).length > 0) {
          await ctx.db.patch(existing._id, changes);
          counts.updated += 1;
        } else {
          counts.unchanged += 1;
        }
      }

      if (!store) continue;
      const target = Math.max(0, Math.round(row.stock));
      const level = await findStockLevel(ctx, {
        productId,
        storeId: store._id,
      });
      const current = level?.quantity ?? 0;
      if (current === target) continue;

      if (level) {
        await ctx.db.patch(level._id, { quantity: target, updatedAt: now });
      } else {
        await ctx.db.insert("stockLevels", {
          tenantId: args.tenantId,
          productId,
          storeId: store._id,
          quantity: target,
          updatedAt: now,
        });
      }

      // Ledger stok tetap diisi supaya saldo baru bisa ditelusuri. Satu baris per
      // produk yang berubah — bukan pemanggilan `applyStockChange` per produk,
      // yang akan mengirim `stock.changed` ratusan kali untuk satu tombol impor.
      await ctx.db.insert("stockMovements", {
        tenantId: args.tenantId,
        productId,
        storeId: store._id,
        delta: target - current,
        balanceAfter: target,
        reason: "adjustment",
        refType: "marketplace",
        refId: row.sourceId || sku,
        note: "Impor katalog marketplace",
        actorId: args.actorId,
        createdAt: now,
      });
      counts.stock += 1;
    }

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "marketplace.catalog.import",
      entity: "marketplacePairings",
      entityId: args.pairingId,
      meta: counts,
    });

    return counts;
  },
});

/** Mencatat hasil impor katalog di baris pairing. */
export const recordCatalogImport = internalMutation({
  args: {
    pairingId: v.id("marketplacePairings"),
    status: v.union(
      v.literal("imported"),
      v.literal("empty"),
      v.literal("failed"),
    ),
    note: v.string(),
    counts: v.object({
      products: v.number(),
      created: v.number(),
      updated: v.number(),
      unchanged: v.number(),
      skipped: v.number(),
      categories: v.number(),
      subcategories: v.number(),
      images: v.number(),
      stock: v.number(),
      barcodes: v.number(),
      barcodeConflicts: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const pairing = await ctx.db.get(args.pairingId);
    if (!pairing) return;
    await ctx.db.patch(args.pairingId, {
      lastCatalogAt: Date.now(),
      lastCatalogStatus: args.status,
      lastCatalogNote: args.note,
      lastCatalogCounts: args.counts,
    });
  },
});

export const pullCatalog = action({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args): Promise<MarketplaceCatalogPullResult> => {
    const gate = await ctx.runQuery(internal.marketplace.access, {
      tenantId: args.tenantId,
      actorId: args.actorId,
    });
    if (!gate.canPair) {
      throw new ConvexError(gate.blockedReason ?? "Akses ditolak.");
    }

    const meta = await ctx.runQuery(internal.marketplace.pairingMeta, {
      tenantId: args.tenantId,
    });
    if (!meta) throw new ConvexError("Workspace belum dipasangkan ke vendor.");

    const finish = async (
      status: "empty" | "failed",
      note: string,
      counts: MarketplaceCatalogCounts,
    ): Promise<MarketplaceCatalogPullResult> => {
      await ctx.runMutation(internal.marketplace.recordCatalogImport, {
        pairingId: meta.pairingId,
        status,
        note,
        counts,
      });
      return { status, note, counts, at: Date.now() };
    };

    let raw: unknown;
    try {
      raw = await fetchMarketplaceCatalog(meta.vendorId);
    } catch (cause) {
      return await finish(
        "failed",
        cause instanceof Error
          ? cause.message
          : "Katalog marketplace tidak bisa dibaca.",
        EMPTY_MARKETPLACE_CATALOG_COUNTS,
      );
    }

    const fetchedRows = Array.isArray(raw) ? raw.length : 0;
    const products = parseMarketplaceCatalogProducts(raw);
    if (products.length === 0) {
      return await finish(
        "empty",
        fetchedRows === 0
          ? "Marketplace belum punya produk untuk vendor ini. Tambahkan produk di marketplace, lalu impor lagi."
          : "Balasan katalog marketplace tidak memuat produk yang bisa diimpor (SKU/nama kosong atau harga tidak sah).",
        {
          ...EMPTY_MARKETPLACE_CATALOG_COUNTS,
          products: fetchedRows,
          skipped: fetchedRows,
        },
      );
    }

    const state = await ctx.runQuery(internal.marketplace.catalogImportState, {
      tenantId: args.tenantId,
    });
    const withImages = new Set(
      state.withImages.map((sku) => catalogNameKey(sku)),
    );

    let budget = MARKETPLACE_CATALOG_IMAGE_BUDGET;
    let imageFailures = 0;
    const prepared: Array<
      (typeof products)[number] & { imageIds: Id<"_storage">[] }
    > = [];
    for (const row of products) {
      const imageIds: Id<"_storage">[] = [];
      if (!withImages.has(catalogNameKey(row.sku)) && budget > 0) {
        for (const url of row.images.slice(
          0,
          MARKETPLACE_CATALOG_IMAGES_PER_PRODUCT,
        )) {
          if (budget <= 0) break;
          budget -= 1;
          const stored = await storeCatalogImage(ctx, url);
          if (stored) imageIds.push(stored);
          else imageFailures += 1;
        }
      }
      prepared.push({ ...row, imageIds });
    }

    const counts = await ctx.runMutation(
      internal.marketplace.applyCatalogImport,
      {
        tenantId: args.tenantId,
        actorId: args.actorId,
        pairingId: meta.pairingId,
        skippedRows: Math.max(0, fetchedRows - products.length),
        products: prepared,
      },
    );

    const notes = [marketplaceCatalogImportSentence(counts)];
    if (fetchedRows > MARKETPLACE_CATALOG_PRODUCT_LIMIT) {
      notes.push(
        `Sebagian katalog tidak diimpor karena batas ${MARKETPLACE_CATALOG_PRODUCT_LIMIT} produk sekali tarik.`,
      );
    }
    if (imageFailures > 0) {
      notes.push(
        `${imageFailures} gambar marketplace gagal diunduh; produknya tetap diimpor tanpa gambar itu.`,
      );
    }
    notes.push(
      "Stok produk disalin ke lokasi jual toko utama; harga modal tetap dihitung dari pembelian POS.",
    );
    const note = notes.join(" ");

    await ctx.runMutation(internal.marketplace.recordCatalogImport, {
      pairingId: meta.pairingId,
      status: "imported",
      note,
      counts,
    });
    return { status: "imported", note, counts, at: Date.now() };
  },
});

/* ------------------------------------------------------- rekonsiliasi stok */

/**
 * Bahan pemeriksaan selisih: saldo **lokasi jual** MesinPOS per SKU.
 *
 * Action tidak boleh menyentuh `ctx.db`, jadi pembacaan tabelnya di sini — dan
 * yang dibaca hanya yang memang dikirim ke marketplace: bucket tanpa
 * `warehouseId` (stok toko), bukan gudang tambahan. Batas `SKU` sama dengan
 * batas impor katalog, supaya kedua arah membaca ukuran katalog yang sama.
 */
export const stockReconcileState = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const pairing = await pairingOf(ctx, args.tenantId);
    if (!pairing) return null;

    const store = await ctx.db
      .query("stores")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .first();

    const scanned = await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .take(MARKETPLACE_RECONCILE_PRODUCT_LIMIT + 1);
    const productsTruncated = scanned.length > MARKETPLACE_RECONCILE_PRODUCT_LIMIT;
    const products = productsTruncated
      ? scanned.slice(0, MARKETPLACE_RECONCILE_PRODUCT_LIMIT)
      : scanned;

    const levels = store
      ? await ctx.db
          .query("stockLevels")
          .withIndex("by_tenant_store", (q) =>
            q.eq("tenantId", args.tenantId).eq("storeId", store._id),
          )
          .take(SNAPSHOT_STOCK_ROWS)
      : [];
    const stockByProduct = new Map<string, number>();
    for (const level of levels) {
      if (level.warehouseId !== undefined) continue;
      const id = level.productId as string;
      stockByProduct.set(id, (stockByProduct.get(id) ?? 0) + level.quantity);
    }

    return {
      pairingId: pairing._id,
      vendorId: pairing.vendorId,
      /** Ada yang tidak diperiksa karena batas; disebut apa adanya di kartu. */
      truncated: productsTruncated || levels.length >= SNAPSHOT_STOCK_ROWS,
      pos: products.map((row) => ({
        sku: row.sku,
        name: row.name,
        stock: stockByProduct.get(row._id as string) ?? 0,
      })),
    };
  },
});

/**
 * Menyimpan hasil pemeriksaan: baris selisih **diganti** (bukan ditumpuk) dan
 * catatan terakhir ditempel di baris pairing.
 *
 * Rekonsiliasi sengaja **tidak menulis stok**: kalau ia menimpa salah satu sisi
 * otomatis, penjualan yang baru terjadi di sisi lain bisa hilang tanpa jejak.
 * Yang dilaporkan adalah selisihnya; keputusan menimpanya tetap milik pemilik
 * lewat tombol yang sudah ada (Impor katalog atau Sinkronkan produk).
 */
export const recordReconciliation = internalMutation({
  args: {
    pairingId: v.id("marketplacePairings"),
    status: v.union(v.literal("checked"), v.literal("failed")),
    note: v.string(),
    counts: v.object({
      pos: v.number(),
      marketplace: v.number(),
      matched: v.number(),
      differing: v.number(),
      posOnly: v.number(),
      marketplaceOnly: v.number(),
      truncated: v.boolean(),
    }),
    diffs: v.array(
      v.object({
        sku: v.string(),
        name: v.string(),
        posStock: v.union(v.number(), v.null()),
        marketplaceStock: v.union(v.number(), v.null()),
        delta: v.union(v.number(), v.null()),
        kind: v.union(
          v.literal("both"),
          v.literal("pos_only"),
          v.literal("marketplace_only"),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const pairing = await ctx.db.get(args.pairingId);
    if (!pairing) return;

    // Pemeriksaan yang **gagal** tidak menghapus laporan terakhir: marketplace
    // yang sedang tidak bisa dihubungi bukan alasan untuk menghilangkan selisih
    // yang sudah diketahui. Barisnya hanya diganti saat pemeriksaannya berhasil.
    if (args.status === "checked") {
      const previous = await ctx.db
        .query("marketplaceStockDiffs")
        .withIndex("by_tenant", (q) => q.eq("tenantId", pairing.tenantId))
        .collect();
      for (const row of previous) await ctx.db.delete(row._id);
    }

    const at = Date.now();
    for (const row of args.diffs.slice(0, MARKETPLACE_STOCK_DIFF_LIMIT)) {
      await ctx.db.insert("marketplaceStockDiffs", {
        tenantId: pairing.tenantId,
        sku: row.sku,
        name: row.name,
        posStock: row.posStock,
        marketplaceStock: row.marketplaceStock,
        delta: row.delta,
        kind: row.kind,
        detectedAt: at,
      });
    }

    await ctx.db.patch(pairing._id, {
      lastReconcileAt: at,
      lastReconcileStatus: args.status,
      lastReconcileNote: args.note,
      lastReconcileCounts: args.counts,
    });
  },
});

/**
 * Satu pemeriksaan lengkap untuk satu workspace.
 *
 * Dipakai dua jalur — cron harian (`reconcileStock`) dan tombol pemilik
 * (`reconcileNow`) — supaya keduanya menghasilkan angka & kalimat yang sama
 * persis. Kegagalan jaringan tidak melempar: dicatat sebagai `failed` dengan
 * sebab yang bisa dibaca, dan selisih lama dibiarkan (tidak dihapus) supaya
 * laporan terakhir tidak hilang hanya karena marketplace sedang tidak bisa
 * dihubungi.
 */
async function runStockReconciliation(
  ctx: ActionCtx,
  tenantId: Id<"tenants">,
): Promise<MarketplaceReconcileResult> {
  const state = await ctx.runQuery(internal.marketplace.stockReconcileState, {
    tenantId,
  });
  if (!state) throw new ConvexError("Workspace belum dipasangkan ke vendor.");

  const finish = async (
    status: "checked" | "failed",
    note: string,
    counts: MarketplaceStockDiffCounts,
    diffs: MarketplaceStockDiff[],
  ): Promise<MarketplaceReconcileResult> => {
    await ctx.runMutation(internal.marketplace.recordReconciliation, {
      pairingId: state.pairingId,
      status,
      note,
      counts,
      diffs,
    });
    return { status, note, counts, diffs, at: Date.now() };
  };

  let raw: unknown;
  try {
    raw = await fetchMarketplaceCatalog(state.vendorId);
  } catch (cause) {
    const reason =
      cause instanceof Error
        ? cause.message
        : "Katalog marketplace tidak bisa dibaca.";
    return await finish(
      "failed",
      `${reason} Laporan selisih terakhir dipertahankan; pemeriksaan dicoba lagi pada jadwal berikutnya.`,
      { ...EMPTY_MARKETPLACE_STOCK_DIFF_COUNTS, pos: state.pos.length },
      [],
    );
  }

  const marketplace = parseMarketplaceStockRows(raw);
  const { counts, diffs } = reconcileMarketplaceStock({
    pos: state.pos,
    marketplace,
  });

  const notes = [marketplaceStockDiffSentence(counts)];
  if (state.truncated) {
    notes.push(
      `Sebagian katalog tidak diperiksa karena batas ${MARKETPLACE_RECONCILE_PRODUCT_LIMIT} SKU sekali jalan.`,
    );
  }
  if (counts.differing > 0 || counts.marketplaceOnly > 0) {
    notes.push(
      "Selisih tidak ditimpa otomatis: putuskan arahnya dulu — Impor katalog menyalin angka marketplace ke POS, Sinkronkan produk mengirim angka POS ke marketplace.",
    );
  }

  return await finish("checked", notes.join(" "), counts, diffs);
}

/**
 * Pemeriksaan **terjadwal** satu workspace (dipanggil cron). Tanpa gerbang
 * peran: pekerja ini berjalan atas nama sistem, dan yang ditulis hanya laporan.
 */
export const reconcileStock = internalAction({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args): Promise<MarketplaceReconcileResult> => {
    return await runStockReconciliation(ctx, args.tenantId);
  },
});

/**
 * Tombol “Periksa sekarang”: pemeriksaan yang sama, tetapi hanya pemilik —
 * alasannya sama dengan tombol sinkron lain (yang dijalankan adalah panggilan
 * keluar ke marketplace atas nama bisnis).
 */
export const reconcileNow = action({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args): Promise<MarketplaceReconcileResult> => {
    const gate = await ctx.runQuery(internal.marketplace.access, {
      tenantId: args.tenantId,
      actorId: args.actorId,
    });
    if (!gate.canPair) {
      throw new ConvexError(gate.blockedReason ?? "Akses ditolak.");
    }
    return await runStockReconciliation(ctx, args.tenantId);
  },
});

/**
 * Titik masuk cron harian: menjadwalkan satu pemeriksaan per workspace yang
 * dipasangkan. Dijadwalkan, bukan dijalankan langsung, karena tiap workspace
 * perlu panggilan jaringan sendiri — satu action per workspace lebih mudah
 * diulang bila gagal, dan satu yang gagal tidak menahan yang lain.
 */
export const reconcileAllStocks = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit)));
    const pairings = await ctx.db.query("marketplacePairings").take(limit);
    for (const pairing of pairings) {
      await ctx.scheduler.runAfter(0, internal.marketplace.reconcileStock, {
        tenantId: pairing.tenantId,
      });
    }
    return { scanned: pairings.length, scheduled: pairings.length };
  },
});

/* -------------------------------------------- sinkron barcode otomatis */

/** Bahan satu kali sinkron barcode: pairing mana yang dibaca katalognya. */
export const barcodeSyncState = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const pairing = await pairingOf(ctx, args.tenantId);
    if (!pairing) return null;
    return { pairingId: pairing._id, vendorId: pairing.vendorId };
  },
});

/**
 * Menulis rencana barcode: **hanya** `barcode` + `barcodeType`.
 *
 * Rencananya disusun `planMarketplaceBarcodeSync` (aturan murni): produk dicari
 * lewat SKU, produk yang belum ada tidak dibuat, dan kode yang sudah dipakai
 * produk lain dilewati. Nama, harga, stok, kategori, gambar, dan status aktif
 * tidak pernah ikut ditulis — inilah bedanya dengan “Impor katalog” yang memang
 * menyalin banyak field sekaligus.
 *
 * Satu audit untuk satu kali sinkron, bukan satu per produk: pekerja ini
 * berjalan sendiri tiap hari, dan ratusan baris audit untuk perubahan yang sama
 * justru menyulitkan pembacaan riwayat pemilik.
 */
export const applyBarcodeSync = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    pairingId: v.id("marketplacePairings"),
    rows: v.array(
      v.object({
        sku: v.string(),
        barcode: v.union(v.string(), v.null()),
        barcodeType: v.union(
          v.literal("barcode"),
          v.literal("qr"),
          v.null(),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const scanned = await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .take(MARKETPLACE_BARCODE_SYNC_SCAN + 1);
    const truncated = scanned.length > MARKETPLACE_BARCODE_SYNC_SCAN;
    const local: MarketplaceBarcodeLocalRow[] = scanned
      .slice(0, MARKETPLACE_BARCODE_SYNC_SCAN)
      .map((row) => ({
        productId: row._id as string,
        sku: row.sku,
        barcode: row.barcode ?? null,
        barcodeType: row.barcodeType ?? null,
      }));

    const plan = planMarketplaceBarcodeSync({
      local,
      marketplace: args.rows,
    });

    for (const update of plan.updates) {
      await ctx.db.patch(update.productId as Id<"products">, {
        barcode: update.barcode,
        barcodeType: update.barcodeType,
      });
    }

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      action: "marketplace.barcode.sync",
      entity: "marketplacePairings",
      entityId: args.pairingId,
      meta: { ...plan.counts, truncated, automatic: true },
    });

    return { counts: plan.counts, truncated };
  },
});

/** Mencatat hasil sinkron barcode di baris pairing (dibaca kartu Pengaturan). */
export const recordBarcodeSync = internalMutation({
  args: {
    pairingId: v.id("marketplacePairings"),
    status: v.union(v.literal("synced"), v.literal("failed")),
    note: v.string(),
    counts: v.object({
      products: v.number(),
      changed: v.number(),
      unchanged: v.number(),
      conflicts: v.number(),
      missing: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const pairing = await ctx.db.get(args.pairingId);
    if (!pairing) return;
    await ctx.db.patch(args.pairingId, {
      lastBarcodeSyncAt: Date.now(),
      lastBarcodeSyncStatus: args.status,
      lastBarcodeSyncNote: args.note,
      lastBarcodeSyncCounts: args.counts,
    });
  },
});

/**
 * Satu kali sinkron barcode untuk satu workspace.
 *
 * Dipakai dua jalur — cron harian (`syncBarcodesForTenant`) dan pemicu manual
 * pemilik (`syncBarcodesNow`) — supaya hasil, angka, dan kalimatnya sama persis.
 * Kegagalan jaringan tidak melempar: dicatat `failed` beserta sebabnya, lalu
 * jadwal berikutnya mencoba lagi. Kode lokal **tidak** dihapus hanya karena
 * marketplace berhenti menyebutkannya — baris tanpa kode bisa berarti kolomnya
 * belum diisi di sana, dan label yang sudah tercetak tidak boleh menjadi buta.
 */
async function runBarcodeSync(
  ctx: ActionCtx,
  tenantId: Id<"tenants">,
): Promise<MarketplaceBarcodeSyncResult> {
  const state = await ctx.runQuery(internal.marketplace.barcodeSyncState, {
    tenantId,
  });
  if (!state) throw new ConvexError("Workspace belum dipasangkan ke vendor.");

  const finish = async (
    status: "synced" | "failed",
    note: string,
    counts: MarketplaceBarcodeSyncCounts,
  ): Promise<MarketplaceBarcodeSyncResult> => {
    await ctx.runMutation(internal.marketplace.recordBarcodeSync, {
      pairingId: state.pairingId,
      status,
      note,
      counts,
    });
    return { status, note, counts, at: Date.now() };
  };

  let raw: unknown;
  try {
    raw = await fetchMarketplaceCatalog(state.vendorId);
  } catch (cause) {
    const reason =
      cause instanceof Error
        ? cause.message
        : "Katalog marketplace tidak bisa dibaca.";
    return await finish(
      "failed",
      `${reason} Sinkron barcode dicoba lagi pada jadwal berikutnya.`,
      { ...EMPTY_MARKETPLACE_BARCODE_COUNTS },
    );
  }

  const rows: MarketplaceBarcodeMarketRow[] = parseMarketplaceCatalogProducts(raw)
    .filter((row) => row.barcode !== null)
    .map((row) => ({
      sku: row.sku,
      barcode: row.barcode,
      barcodeType: row.barcodeType,
    }));

  const applied = await ctx.runMutation(internal.marketplace.applyBarcodeSync, {
    tenantId,
    pairingId: state.pairingId,
    rows,
  });

  return await finish(
    "synced",
    marketplaceBarcodeSyncNote(applied.counts, applied.truncated),
    applied.counts,
  );
}

/** Pekerja **terjadwal** satu workspace (dipanggil cron, tanpa gerbang peran). */
export const syncBarcodesForTenant = internalAction({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args): Promise<MarketplaceBarcodeSyncResult> => {
    return await runBarcodeSync(ctx, args.tenantId);
  },
});

/**
 * Pemicu manual pemilik — pekerja yang sama dengan cron, untuk memastikan kode
 * yang baru diubah di marketplace langsung terbaca tanpa menunggu jadwal.
 */
export const syncBarcodesNow = action({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args): Promise<MarketplaceBarcodeSyncResult> => {
    const gate = await ctx.runQuery(internal.marketplace.access, {
      tenantId: args.tenantId,
      actorId: args.actorId,
    });
    if (!gate.canPair) {
      throw new ConvexError(gate.blockedReason ?? "Akses ditolak.");
    }
    return await runBarcodeSync(ctx, args.tenantId);
  },
});

/**
 * Titik masuk cron harian: satu pekerja barcode per workspace terpasang.
 * Dijadwalkan, bukan dijalankan langsung, karena tiap workspace butuh panggilan
 * jaringan sendiri dan satu yang gagal tidak boleh menahan yang lain.
 */
export const syncAllBarcodes = internalMutation({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit)));
    const pairings = await ctx.db.query("marketplacePairings").take(limit);
    for (const pairing of pairings) {
      await ctx.scheduler.runAfter(
        0,
        internal.marketplace.syncBarcodesForTenant,
        { tenantId: pairing.tenantId },
      );
    }
    return { scanned: pairings.length, scheduled: pairings.length };
  },
});

/**
 * SKU yang menunggu dikirim dari **laporan selisih terakhir**.
 *
 * Tombol “Kirim stok SKU yang berbeda” bekerja atas apa yang sedang terlihat di
 * tabel — bukan menghitung ulang diam-diam — supaya yang dikirim sama persis
 * dengan yang dibaca pemilik. Yang ikut hanya baris `both` (lihat
 * `stockDiffPushSkus`).
 */
export const stockDiffsToPush = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const pairing = await pairingOf(ctx, args.tenantId);
    if (!pairing) return null;

    const rows = await ctx.db
      .query("marketplaceStockDiffs")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .take(MARKETPLACE_STOCK_DIFF_LIMIT);
    const diffs: MarketplaceStockDiff[] = rows.map((row) => ({
      sku: row.sku,
      name: row.name,
      posStock: row.posStock,
      marketplaceStock: row.marketplaceStock,
      delta: row.delta,
      kind: row.kind,
    }));

    return {
      pairingId: pairing._id,
      skus: stockDiffPushSkus(diffs),
      differing: rows.length,
    };
  },
});

/**
 * Menulis saldo marketplace ke **lokasi jual** POS untuk daftar SKU tertentu.
 *
 * Satu mutation untuk semua baris: kalau satu SKU gagal, tidak ada yang setengah
 * tertulis. Penulisan saldo & ledger-nya mengikuti jalur impor katalog — bukan
 * `applyStockChange` — karena angka ini **berasal dari marketplace**: memakai
 * helper itu akan memicu kiriman balik `stock.changed` dan antrean dorongan stok
 * untuk nilai yang baru saja kita terima.
 */
export const applyMarketplaceStockBySku = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    stocks: v.array(v.object({ sku: v.string(), stock: v.number() })),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db
      .query("stores")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .first();

    const counts = { adjusted: 0, skipped: 0, missing: 0 };
    const now = Date.now();

    for (const row of args.stocks) {
      const sku = (row.sku ?? "").trim();
      if (sku === "") continue;
      if (!store) {
        counts.missing += 1;
        continue;
      }

      const product = await ctx.db
        .query("products")
        .withIndex("by_tenant_sku", (q) =>
          q.eq("tenantId", args.tenantId).eq("sku", sku),
        )
        .unique();
      if (!product) {
        counts.missing += 1;
        continue;
      }

      const target = Math.max(0, Math.round(row.stock));
      const level = await findStockLevel(ctx, {
        productId: product._id,
        storeId: store._id,
      });
      const current = level?.quantity ?? 0;
      if (current === target) {
        counts.skipped += 1;
        continue;
      }

      if (level) {
        await ctx.db.patch(level._id, { quantity: target, updatedAt: now });
      } else {
        await ctx.db.insert("stockLevels", {
          tenantId: args.tenantId,
          productId: product._id,
          storeId: store._id,
          quantity: target,
          updatedAt: now,
        });
      }

      await ctx.db.insert("stockMovements", {
        tenantId: args.tenantId,
        productId: product._id,
        storeId: store._id,
        delta: target - current,
        balanceAfter: target,
        reason: "adjustment",
        refType: "marketplace",
        refId: sku,
        note: "Tarik stok dari laporan selisih marketplace",
        actorId: args.actorId,
        createdAt: now,
      });
      counts.adjusted += 1;
    }

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "marketplace.stock.pull",
      entity: "marketplacePairings",
      entityId: args.tenantId,
      meta: counts,
    });

    return counts;
  },
});

/**
 * “Tarik angka marketplace”: arah sebaliknya dari tombol kirim, dengan daftar
 * SKU yang **sama** (hanya baris yang saldonya berbeda).
 *
 * Angkanya dibaca **ulang** dari marketplace saat tombol ditekan, bukan memakai
 * angka di tabel yang bisa sudah basi — yang ditulis ke POS harus angka yang
 * benar-benar berlaku sekarang. SKU yang sudah hilang dari katalog marketplace
 * dihitung `missing`, bukan dipaksa menjadi nol.
 */
export const pullStockDiffs = action({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args): Promise<MarketplaceStockDiffPullResult> => {
    const gate = await ctx.runQuery(internal.marketplace.access, {
      tenantId: args.tenantId,
      actorId: args.actorId,
    });
    if (!gate.canPair) {
      throw new ConvexError(gate.blockedReason ?? "Akses ditolak.");
    }

    const pending = await ctx.runQuery(internal.marketplace.stockDiffsToPush, {
      tenantId: args.tenantId,
    });
    if (!pending) throw new ConvexError("Workspace belum dipasangkan ke vendor.");
    if (pending.skus.length === 0) {
      throw new ConvexError(
        "Tidak ada SKU dengan saldo berbeda untuk ditarik. Tekan “Periksa sekarang” dulu supaya laporannya terbaru.",
      );
    }

    const meta = await ctx.runQuery(internal.marketplace.pairingMeta, {
      tenantId: args.tenantId,
    });
    if (!meta) throw new ConvexError("Workspace belum dipasangkan ke vendor.");

    const remote = new Map<string, number>();
    try {
      const raw = await fetchMarketplaceCatalog(meta.vendorId);
      for (const row of parseMarketplaceStockRows(raw)) {
        remote.set(stockSkuKey(row.sku), row.stock);
      }
    } catch (cause) {
      throw new ConvexError(
        cause instanceof Error
          ? `Angka marketplace tidak bisa dibaca: ${cause.message}`
          : "Angka marketplace tidak bisa dibaca.",
      );
    }

    const wanted: Array<{ sku: string; stock: number }> = [];
    let missing = 0;
    for (const sku of pending.skus) {
      const stock = remote.get(stockSkuKey(sku));
      if (stock === undefined) {
        missing += 1;
        continue;
      }
      wanted.push({ sku, stock });
    }

    const applied = await ctx.runMutation(
      internal.marketplace.applyMarketplaceStockBySku,
      { tenantId: args.tenantId, actorId: args.actorId, stocks: wanted },
    );

    const reconcile = await runStockReconciliation(ctx, args.tenantId);

    return {
      skus: pending.skus,
      counts: {
        adjusted: applied.adjusted,
        skipped: applied.skipped,
        missing: missing + applied.missing,
        requested: pending.skus.length,
      },
      reconcile,
      at: Date.now(),
    };
  },
});

/**
 * “Kirim stok SKU yang berbeda”: mendorong **hanya** SKU yang selisih saldonya
 * dari laporan terakhir.
 *
 * Bentuk kirimannya sama dengan dorongan stok otomatis (upsert per SKU, amplop
 * `stock.changed`, tercatat di `lastStockSync*`) — bedanya barisnya dibatasi ke
 * SKU yang memang berbeda, jadi katalog lain tidak ikut terkirim dan penjualan
 * yang belum tampil di laporan tidak tersentuh. Kalau kirimannya diterima,
 * pemeriksaan diulang supaya tabel tidak lagi menampilkan selisih yang sudah
 * hilang.
 */
export const pushStockDiffs = action({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args): Promise<MarketplaceStockDiffPushResult> => {
    const gate = await ctx.runQuery(internal.marketplace.access, {
      tenantId: args.tenantId,
      actorId: args.actorId,
    });
    if (!gate.canPair) {
      throw new ConvexError(gate.blockedReason ?? "Akses ditolak.");
    }

    const pending = await ctx.runQuery(internal.marketplace.stockDiffsToPush, {
      tenantId: args.tenantId,
    });
    if (!pending) throw new ConvexError("Workspace belum dipasangkan ke vendor.");
    if (pending.skus.length === 0) {
      throw new ConvexError(
        "Tidak ada SKU dengan saldo berbeda untuk dikirim. Tekan “Periksa sekarang” dulu supaya laporannya terbaru.",
      );
    }

    const push = await pushCatalogToMarketplace(ctx, {
      tenantId: args.tenantId,
      skus: pending.skus,
      automatic: true,
    });
    const reconcile =
      push.status === "delivered"
        ? await runStockReconciliation(ctx, args.tenantId)
        : null;

    return { skus: pending.skus, push, reconcile, at: Date.now() };
  },
});

/** Metadata minimal untuk action sinkron (tanpa membawa kontak/token ke klien). */
export const pairingMeta = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const pairing = await pairingOf(ctx, args.tenantId);
    if (!pairing) return null;
    return {
      pairingId: pairing._id,
      vendorId: pairing.vendorId,
      vendorName: pairing.vendorName,
    };
  },
});

/**
 * Daftar kode kontak yang dikenal — dipakai halaman dokumentasi/harness supaya
 * tidak ada label yang ditulis ulang di dua tempat.
 */
export const CONTACT_KINDS = MARKETPLACE_CONTACT_KINDS;
export const EMPTY_COUNTS = EMPTY_MARKETPLACE_COUNTS;

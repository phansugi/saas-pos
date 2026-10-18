import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  canAddProductImage,
  validateProductImage,
} from "./lib/productImages";
import {
  applyStockChange,
  nextSequence,
  requireFeature,
  requireMembership,
  requirePermission,
  writeAuditLog,
} from "./lib/access";
import { categoryIsActive, subcategoryIsActive } from "./lib/categories";
import {
  productDeletionCheck,
  validateProductIdentity,
  type ProductUsage,
} from "./lib/productEdit";
import { formatProductSku, recodeProductSku } from "./lib/productSku";
import {
  resolveModifierConfig,
  type ModifierGroup,
} from "./lib/modifiers";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "./lib/inventory";
import { enqueueWebhookEvent, scheduleWebhookDeliveryPass } from "./lib/webhookOutbox";
import { productUpdatedEventData } from "./lib/webhookEvents";
import {
  BASE_UNIT,
  normaliseUnitCode,
  sortTiers,
  validateTiers,
  validateUnits,
  type PriceTier,
  type UnitConversion,
} from "./lib/wholesale";

/**
 * Memberi tahu platform mitra bahwa katalog/harga berubah (`product.updated`).
 *
 * Dipanggil dari jalur tulis yang benar-benar mengubah produk — bukan dari
 * halaman — supaya perubahan yang datang dari kasir, impor, atau penerimaan
 * barang sama-sama terkirim. Kalau tidak ada endpoint yang melanggan, fungsi
 * ini tidak menulis apa pun (lihat `enqueueWebhookEvent`).
 */
async function emitProductUpdated(
  ctx: MutationCtx,
  product: {
    tenantId: Id<"tenants">;
    sku: string;
    name: string;
    price: number;
    unit?: string;
    active: boolean;
    /** Kategori & subkategori ikut dikirim supaya platform bisa menyusun katalog. */
    categoryId?: Id<"categories">;
    subcategoryId?: Id<"subcategories">;
  },
  changed: string[],
  previous: { sku?: string; price?: number } = {},
): Promise<number> {
  if (changed.length === 0) return 0;
  // Nama kategori & subkategori dibaca di sini, bukan diketik pemanggil: satu jalur
  // untuk semua pemicu, sehingga kiriman tidak pernah membawa nama yang sudah
  // berganti (produk menunjuk id, bukan nama).
  const category = product.categoryId ? await ctx.db.get(product.categoryId) : null;
  const subcategory = product.subcategoryId
    ? await ctx.db.get(product.subcategoryId)
    : null;
  const enqueued = await enqueueWebhookEvent(ctx, {
    tenantId: product.tenantId,
    event: "product.updated",
    subject: product.sku,
    data: productUpdatedEventData({
      sku: product.sku,
      name: product.name,
      price: product.price,
      unit: product.unit ?? BASE_UNIT,
      active: product.active,
      category: category?.name ?? null,
      subcategory: subcategory?.name ?? null,
      changed,
      previousSku: previous.sku,
      previousPrice: previous.price,
    }),
  });
  await scheduleWebhookDeliveryPass(ctx, enqueued);
  return enqueued;
}

/** Bentuk argumen yang sama dipakai `create` dan `setPricing`. */
const tierValidator = v.array(
  v.object({ minQty: v.number(), price: v.number() }),
);
const unitValidator = v.array(
  v.object({ code: v.string(), factor: v.number() }),
);

/**
 * Memeriksa subkategori untuk sebuah penempatan katalog.
 *
 * Subkategori dibuat **di bawah** sebuah kategori (lihat `src/convex/subcategories.ts`),
 * jadi tiga hal yang dijaga di sini: subkategorinya milik tenant ini, ia memang
 * bagian dari kategori yang dipilih, dan ia masih aktif — semuanya alasan yang bisa
 * diperbaiki pengguna, bukan galat diam-diam.
 */
async function resolveSubcategory(
  ctx: MutationCtx,
  args: {
    tenantId: Id<"tenants">;
    categoryId?: Id<"categories">;
    categoryName?: string | null;
    subcategoryId?: Id<"subcategories">;
  },
): Promise<{ subcategoryId?: Id<"subcategories">; name?: string }> {
  if (!args.subcategoryId) return {};

  if (!args.categoryId) {
    throw new Error(
      "Subkategori hanya bisa dipakai bersama kategori — pilih kategorinya lebih dulu.",
    );
  }

  const subcategory = await ctx.db.get(args.subcategoryId);
  if (!subcategory || subcategory.tenantId !== args.tenantId) {
    throw new Error("Subkategori tidak ditemukan untuk tenant ini.");
  }
  if (subcategory.categoryId !== args.categoryId) {
    throw new Error(
      `Subkategori ${subcategory.name} bukan bagian dari kategori ${args.categoryName ?? "yang dipilih"} — pilih subkategori yang ada di kategori itu.`,
    );
  }
  if (!subcategoryIsActive(subcategory)) {
    throw new Error(
      `Subkategori ${subcategory.name} sedang nonaktif — aktifkan dulu di halaman Produk & Stok, atau pilih subkategori lain.`,
    );
  }

  return { subcategoryId: args.subcategoryId, name: subcategory.name };
}

/** Modifier item (`pos.modifier`) — modul F&B. */
const modifierValidator = v.array(
  v.object({
    code: v.string(),
    name: v.string(),
    minSelect: v.number(),
    maxSelect: v.number(),
    options: v.array(
      v.object({ code: v.string(), name: v.string(), price: v.number() }),
    ),
  }),
);

/**
 * Menormalkan dan memvalidasi konfigurasi modifier, dan menegakkan modulnya:
 * modifier adalah fitur modul F&B (`pos.modifier`). Mengosongkan daftar selalu
 * boleh — supaya konfigurasi bisa dibersihkan bahkan setelah modulnya mati.
 */
async function resolveModifiers(
  ctx: MutationCtx,
  args: {
    tenantId: Id<"tenants">;
    actorId: Id<"users">;
    modifiers?: ModifierGroup[];
  },
): Promise<ModifierGroup[]> {
  const raw = args.modifiers ?? [];
  if (raw.length === 0) return [];

  await requireFeature(
    ctx,
    args.tenantId,
    args.actorId,
    "pos.modifier",
    "product.manage",
  );

  const config = resolveModifierConfig(raw);
  if (!config.ok) throw new Error(config.reason);
  return config.groups;
}

/**
 * Menormalkan sekaligus memvalidasi konfigurasi grosir, dan menegakkan modulnya:
 * harga bertingkat butuh `pricing.multitier`, konversi satuan butuh
 * `uom.multilevel` — keduanya milik modul Grosir. Satu jalur untuk `create` dan
 * `setPricing` supaya aturannya tidak pernah bercabang.
 */
async function resolveWholesale(
  ctx: MutationCtx,
  args: {
    tenantId: Id<"tenants">;
    actorId: Id<"users">;
    price: number;
    unit?: string;
    tiers?: PriceTier[];
    units?: UnitConversion[];
  },
): Promise<{ unit: string; tiers: PriceTier[]; units: UnitConversion[] }> {
  const baseUnit = normaliseUnitCode(args.unit ?? "") || BASE_UNIT;
  const tiers: PriceTier[] = sortTiers(args.tiers ?? []).map((tier) => ({
    minQty: tier.minQty,
    price: tier.price,
  }));
  const units: UnitConversion[] = (args.units ?? []).map((unit) => ({
    code: normaliseUnitCode(unit.code),
    factor: unit.factor,
  }));

  if (tiers.length > 0) {
    await requireFeature(
      ctx,
      args.tenantId,
      args.actorId,
      "pricing.multitier",
      "product.manage",
    );
    const valid = validateTiers(args.price, tiers);
    if (!valid.ok) throw new Error(valid.reason);
  }

  if (units.length > 0) {
    await requireFeature(
      ctx,
      args.tenantId,
      args.actorId,
      "uom.multilevel",
      "product.manage",
    );
    const valid = validateUnits(units, baseUnit);
    if (!valid.ok) throw new Error(valid.reason);
  }

  return { unit: baseUnit, tiers, units };
}

/**
 * Menentukan SKU sebuah produk baru.
 *
 * SKU yang **diketik** pemilik toko dipakai apa adanya; SKU yang **kosong** dibuat
 * otomatis dengan format `PBB-<KATEGORI>-<nomor urut>` (lihat lib/productSku.ts).
 * Nomornya datang dari counter tenant (naik sekali per pembuatan), lalu
 * dicocokkan dengan SKU yang sudah ada: SKU yang diketik manual dengan format sama
 * (mis. `PBB-SAN-000042` yang dibuat sendiri) tidak boleh tertabrak, jadi
 * counter-nya dinaikkan lagi sampai ketemu nomor yang bebas. Pemeriksaan itu tetap
 * perlu walau counter-nya monoton — katalog lama bisa punya SKU apa saja.
 */
async function resolveProductSku(
  ctx: MutationCtx,
  args: {
    tenantId: Id<"tenants">;
    requested?: string;
    categoryId?: Id<"categories">;
  },
): Promise<string> {
  const requested = (args.requested ?? "").trim();
  if (requested.length > 0) return requested;

  const category = args.categoryId ? await ctx.db.get(args.categoryId) : null;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const sequence = await nextSequence(ctx, args.tenantId, "product.sku");
    const candidate = formatProductSku({ category: category?.name, sequence });
    const clash = await ctx.db
      .query("products")
      .withIndex("by_tenant_sku", (q) =>
        q.eq("tenantId", args.tenantId).eq("sku", candidate),
      )
      .unique();
    if (!clash) return candidate;
  }

  throw new Error(
    "Tidak bisa membuat SKU otomatis yang unik. Isi kolom SKU secara manual.",
  );
}

/**
 * Gambar sebuah produk dalam bentuk yang bisa langsung ditampilkan klien: `id`
 * untuk menghapus, `url` untuk `<img src>`.
 *
 * URL dibuat **saat query dijalankan**, bukan disimpan: URL berkas Convex
 * bertanda tangan dan bisa kedaluwarsa, jadi URL yang ditulis ke DB akan menjadi
 * gambar mati. Berkas yang sudah hilang dari penyimpanan dilewati saja — bukan
 * dikembalikan sebagai entri ber-URL kosong yang merusak tata letak.
 */
async function readProductImages(
  ctx: QueryCtx,
  storageIds: Id<"_storage">[] | undefined,
): Promise<{ id: Id<"_storage">; url: string }[]> {
  const ids = storageIds ?? [];
  const urls = await Promise.all(ids.map((storageId) => ctx.storage.getUrl(storageId)));
  const images: { id: Id<"_storage">; url: string }[] = [];
  ids.forEach((storageId, index) => {
    const url = urls[index];
    if (url) images.push({ id: storageId, url });
  });
  return images;
}

/**
 * Produk sebuah toko beserta stok terkini, dengan opsi menyertakan yang nonaktif.
 *
 * Dua pemakaian, satu isi: katalog **penjualan** (`listByStore`, hanya aktif) dan
 * katalog **pengelolaan** (`listAll`, termasuk yang nonaktif supaya bisa
 * dinonaktifkan/dihapus/dinyalakan kembali dari halaman Produk & Stok). Yang
 * membedakan hanya penyaring terakhirnya, jadi bentuk datanya dijamin sama.
 */
async function readStoreProducts(
  ctx: QueryCtx,
  args: {
    tenantId: Id<"tenants">;
    storeId: Id<"stores">;
    includeInactive: boolean;
  },
) {
  const products = await ctx.db
    .query("products")
    .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
    .collect();

  const levels = await ctx.db
    .query("stockLevels")
    .withIndex("by_tenant_store", (q) =>
      q.eq("tenantId", args.tenantId).eq("storeId", args.storeId),
    )
    .collect();

  // Hanya **lokasi jual** (bucket tanpa `warehouseId`) yang menjadi angka
  // "stok" di sini: itulah yang benar-benar bisa dijual kasir. Stok di gudang
  // tampil di halaman Gudang & Stok sampai dipindahkan (Phase 3).
  const levelByProduct = new Map(
    levels
      .filter((level) => level.warehouseId === undefined)
      .map((level) => [level.productId, level.quantity]),
  );

  return await Promise.all(
    products
      .filter((p) => args.includeInactive || p.active)
      .map(async (p) => ({
        ...p,
        stock: levelByProduct.get(p._id) ?? 0,
        images: await readProductImages(ctx, p.images),
      })),
  );
}

/** Products for a store with their current stock level joined in. */
export const listByStore = query({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.tenantId, args.actorId);
    return await readStoreProducts(ctx, {
      tenantId: args.tenantId,
      storeId: args.storeId,
      includeInactive: false,
    });
  },
});

/**
 * Katalog lengkap untuk **pengelolaan**: termasuk produk yang nonaktif.
 *
 * Izinnya `product.manage` — sama dengan yang boleh mengubah, mematikan, dan
 * menghapus produk — jadi kasir tidak ikut menerima daftar produk mati yang tidak
 * bisa dia apa-apakan. Katalog penjualan (`listByStore`) tetap hanya aktif.
 */
export const listAll = query({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "product.manage");
    return await readStoreProducts(ctx, {
      tenantId: args.tenantId,
      storeId: args.storeId,
      includeInactive: true,
    });
  },
});

export const create = mutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.optional(v.id("stores")),
    /** Kosongkan/boleh tidak diisi: server membuat SKU otomatis yang unik. */
    sku: v.optional(v.string()),
    name: v.string(),
    price: v.number(),
    cost: v.optional(v.number()),
    categoryId: v.optional(v.id("categories")),
    /** Subkategori yang dibuat di bawah `categoryId`; hanya boleh bersama `categoryId`. */
    subcategoryId: v.optional(v.id("subcategories")),
    trackStock: v.optional(v.boolean()),
    openingStock: v.optional(v.number()),
    /** Satuan dasar; modul Grosir memakai ini bersama `tiers`/`units`. */
    unit: v.optional(v.string()),
    tiers: v.optional(tierValidator),
    units: v.optional(unitValidator),
    modifiers: v.optional(modifierValidator),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    if (args.price < 0) throw new Error("Harga tidak boleh negatif.");
    await requirePermission(ctx, args.tenantId, args.actorId, "product.manage");

    // Kategori nonaktif tidak boleh dipakai produk baru: itulah arti menonaktifkan
    // (lihat lib/categories.ts). Produk lama yang masih di sana tetap dijual —
    // memindahkannya atau mengaktifkan kembali kategorinya adalah dua jalan yang
    // jelas, bukan penghapusan diam-diam.
    let categoryName: string | undefined;
    if (args.categoryId) {
      const category = await ctx.db.get(args.categoryId);
      if (!category || category.tenantId !== args.tenantId) {
        throw new Error("Kategori tidak ditemukan untuk tenant ini.");
      }
      if (!categoryIsActive(category)) {
        throw new Error(
          `Kategori ${category.name} sedang nonaktif — aktifkan dulu di halaman Produk & Stok, atau pilih kategori lain.`,
        );
      }
      categoryName = category.name;
    }
    const subcategory = await resolveSubcategory(ctx, {
      tenantId: args.tenantId,
      categoryId: args.categoryId,
      categoryName,
      subcategoryId: args.subcategoryId,
    });
    const wholesale = await resolveWholesale(ctx, args);
    const modifiers = await resolveModifiers(ctx, args);

    const sku = await resolveProductSku(ctx, {
      tenantId: args.tenantId,
      requested: args.sku,
      categoryId: args.categoryId,
    });

    const duplicate = await ctx.db
      .query("products")
      .withIndex("by_tenant_sku", (q) =>
        q.eq("tenantId", args.tenantId).eq("sku", sku),
      )
      .unique();
    if (duplicate) throw new Error(`SKU ${sku} sudah dipakai.`);

    const now = Date.now();
    const productId = await ctx.db.insert("products", {
      tenantId: args.tenantId,
      sku,
      name: args.name,
      categoryId: args.categoryId,
      subcategoryId: subcategory.subcategoryId,
      price: args.price,
      cost: args.cost ?? 0,
      trackStock: args.trackStock ?? true,
      active: true,
      unit: wholesale.unit,
      tiers: wholesale.tiers,
      units: wholesale.units,
      modifiers,
      createdAt: now,
    });

    if (args.storeId && (args.openingStock ?? 0) > 0) {
      await applyStockChange(ctx, {
        tenantId: args.tenantId,
        storeId: args.storeId,
        productId,
        delta: args.openingStock ?? 0,
        reason: "adjustment",
        note: "Stok awal",
        actorId: args.actorId,
      });
    }

    // Katalog baru langsung dikabarkan ke platform mitra; produk yang dibuat
    // tanpa stok pun tetap perlu muncul di sana.
    await emitProductUpdated(
      ctx,
      {
        tenantId: args.tenantId,
        sku,
        name: args.name,
        price: args.price,
        unit: wholesale.unit,
        active: true,
        categoryId: args.categoryId,
        subcategoryId: subcategory.subcategoryId,
      },
      ["created"],
    );

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "product.create",
      entity: "products",
      entityId: productId,
      meta: { sku, name: args.name },
    });

    // SKU-nya ikut dikembalikan: kalau server yang membuatnya, klien perlu tahu
    // nomor yang benar-benar dipakai (bukan menebak sendiri).
    return { productId, sku };
  },
});

/**
 * Mengubah harga dasar dan/atau konfigurasi grosir sebuah produk (harga
 * bertingkat + konversi satuan). Kosongkan `tiers`/`units` untuk menghapusnya —
 * itu selalu boleh, bahkan setelah modul Grosir dimatikan.
 */
export const setPricing = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    productId: v.id("products"),
    price: v.optional(v.number()),
    unit: v.optional(v.string()),
    tiers: v.optional(tierValidator),
    units: v.optional(unitValidator),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "product.manage");

    const product = await ctx.db.get(args.productId);
    if (!product || product.tenantId !== args.tenantId) {
      throw new Error("Produk tidak ditemukan untuk tenant ini.");
    }

    const price = args.price ?? product.price;
    if (price < 0) throw new Error("Harga tidak boleh negatif.");

    const wholesale = await resolveWholesale(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      price,
      unit: args.unit ?? product.unit,
      tiers: args.tiers ?? product.tiers,
      units: args.units ?? product.units,
    });

    await ctx.db.patch(args.productId, {
      price,
      unit: wholesale.unit,
      tiers: wholesale.tiers,
      units: wholesale.units,
    });

    const changed = [
      price !== product.price ? "price" : null,
      (wholesale.unit ?? BASE_UNIT) !== (product.unit ?? BASE_UNIT) ? "unit" : null,
      JSON.stringify(wholesale.tiers) !== JSON.stringify(product.tiers ?? [])
        ? "tiers"
        : null,
      JSON.stringify(wholesale.units) !== JSON.stringify(product.units ?? [])
        ? "units"
        : null,
    ].filter((field): field is string => field !== null);

    await emitProductUpdated(
      ctx,
      {
        tenantId: args.tenantId,
        sku: product.sku,
        name: product.name,
        price,
        unit: wholesale.unit,
        active: product.active,
        categoryId: product.categoryId,
        subcategoryId: product.subcategoryId,
      },
      changed,
      changed.includes("price") ? { price: product.price } : {},
    );

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "product.pricing",
      entity: "products",
      entityId: args.productId,
      meta: {
        price,
        unit: wholesale.unit,
        tiers: wholesale.tiers.length,
        units: wholesale.units.map((unit) => `${unit.code}x${unit.factor}`),
      },
    });

    return {
      price,
      unit: wholesale.unit,
      tiers: wholesale.tiers,
      units: wholesale.units,
    };
  },
});

/**
 * Mengatur penempatan katalog produk: kategori dan subkategorinya.
 *
 * Kategori menentukan **kode di tengah SKU**, jadi menggantinya harus ikut
 * mengganti SKU — kalau tidak, `PBB-SAN-000042` tetap tertulis “Sanitasi” di
 * sistem padahal produknya sudah Makanan. Aturannya ada di `recodeProductSku`:
 * nomornya dipertahankan selama masih bebas, dan SKU yang **diketik pemilik toko**
 * (di luar format `PBB-…`) tidak disentuh sama sekali. Subkategori **tidak**
 * menyentuh SKU maupun tab POS: ia hanya label katalog yang ikut disinkronkan.
 *
 * Pemanggilan ini menetapkan penempatan utuh (bukan menambal sebagian):
 * `subcategoryId` yang tidak dikirim berarti produknya tidak punya subkategori,
 * sama seperti `categoryId` yang tidak dikirim berarti tanpa kategori.
 *
 * Balikannya menyebut SKU sebelum & sesudah (beserta nama kategori & subkategori
 * terbaru) supaya halaman bisa memberi tahu apa yang benar-benar berubah — bukan
 * menebak sendiri.
 */
export const setCategory = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    productId: v.id("products"),
    /** Kosong = produk tanpa kategori (kode SKU-nya kembali ke `UMU`). */
    categoryId: v.optional(v.id("categories")),
    /** Subkategori yang dibuat di bawah `categoryId`; kosong = tanpa subkategori. */
    subcategoryId: v.optional(v.id("subcategories")),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "product.manage");

    const product = await ctx.db.get(args.productId);
    if (!product || product.tenantId !== args.tenantId) {
      throw new Error("Produk tidak ditemukan untuk tenant ini.");
    }

    let categoryName: string | undefined;
    if (args.categoryId) {
      const category = await ctx.db.get(args.categoryId);
      if (!category || category.tenantId !== args.tenantId) {
        throw new Error("Kategori tidak ditemukan untuk tenant ini.");
      }
      if (!categoryIsActive(category)) {
        throw new Error(
          `Kategori ${category.name} sedang nonaktif — aktifkan dulu di halaman Produk & Stok kalau produk ini memang masuk ke sana.`,
        );
      }
      categoryName = category.name;
    }
    const subcategory = await resolveSubcategory(ctx, {
      tenantId: args.tenantId,
      categoryId: args.categoryId,
      categoryName,
      subcategoryId: args.subcategoryId,
    });

    // SKU produk lain dipakai sebagai daftar “sudah terpakai”; SKU produk ini
    // sendiri disingkirkan supaya nomornya tidak dianggap bentrok.
    const others = await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const takenSkus = others.filter((row) => row._id !== args.productId).map((row) => row.sku);

    const sku = recodeProductSku({
      sku: product.sku,
      category: categoryName,
      takenSkus,
    });

    if (sku !== product.sku && takenSkus.includes(sku)) {
      throw new Error(`SKU ${sku} sudah dipakai.`);
    }

    await ctx.db.patch(args.productId, {
      categoryId: args.categoryId,
      subcategoryId: subcategory.subcategoryId,
      sku,
    });

    const categoryChanged = (product.categoryId ?? null) !== (args.categoryId ?? null);
    const subcategoryChanged =
      (product.subcategoryId ?? null) !== (subcategory.subcategoryId ?? null);
    if (categoryChanged || subcategoryChanged || sku !== product.sku) {
      await emitProductUpdated(
        ctx,
        {
          tenantId: args.tenantId,
          sku,
          name: product.name,
          price: product.price,
          unit: product.unit,
          active: product.active,
          categoryId: args.categoryId,
          subcategoryId: subcategory.subcategoryId,
        },
        [
          ...(categoryChanged ? ["category"] : []),
          ...(subcategoryChanged ? ["subcategory"] : []),
          ...(sku !== product.sku ? ["sku"] : []),
        ],
        // SKU baru saja berganti: penerima harus tahu SKU lama yang harus
        // diganti, bukan menebak dari nama produk.
        sku !== product.sku ? { sku: product.sku } : {},
      );
    }

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "product.category",
      entity: "products",
      entityId: args.productId,
      meta: {
        category: categoryName ?? null,
        subcategory: subcategory.name ?? null,
        previousSubcategoryId: product.subcategoryId ?? null,
        previousSku: product.sku,
        sku,
        skuChanged: sku !== product.sku,
      },
    });

    return {
      sku,
      previousSku: product.sku,
      category: categoryName ?? null,
      subcategory: subcategory.name ?? null,
    };
  },
});

/*
 * ---------------------------------------------------------------- kelola produk
 * Tiga hal untuk produk yang **sudah tersimpan** — semuanya berizin
 * `product.manage`, sama seperti membuat produk, karena ini pekerjaan katalog:
 *
 *   - `update`     : perbaiki nama, SKU, atau harga belinya;
 *   - `setActive`  : sembunyikan dari kasir tanpa menghapus datanya;
 *   - `remove`     : buang produk yang memang belum dipakai apa pun.
 *
 * Harga jual, satuan, harga bertingkat, kategori, modifier, dan gambar tetap
 * diatur oleh mutation-nya masing-masing (`setPricing`, `setCategory`,
 * `setModifiers`, `addImage`/`removeImage`) supaya tiap perubahan punya satu
 * jalur dan satu jejak audit.
 */

/**
 * Seberapa terpakai sebuah produk — dasar keputusan hapus.
 *
 * Dihitung dari data yang sebenarnya (bukan kolom yang bisa basi): stok yang masih
 * tercatat, baris penjualan, pergerakan stok, dokumen pembelian, dan sesi opname.
 * Semuanya dijawab lewat indeks, kecuali dokumen pembelian & opname yang barisnya
 * tersimpan di dalam dokumennya sendiri (karena itu dokumennya dipindai per tenant,
 * bukan seluruh koleksi).
 */
async function readProductUsage(
  ctx: QueryCtx,
  tenantId: Id<"tenants">,
  productId: Id<"products">,
): Promise<ProductUsage> {
  const levels = await ctx.db
    .query("stockLevels")
    .withIndex("by_product_store", (q) => q.eq("productId", productId))
    .collect();
  const stock = levels
    .filter((level) => level.tenantId === tenantId)
    .reduce((sum, level) => sum + level.quantity, 0);

  const saleLines = await ctx.db
    .query("saleItems")
    .withIndex("by_tenant_product", (q) =>
      q.eq("tenantId", tenantId).eq("productId", productId),
    )
    .collect();

  const movements = await ctx.db
    .query("stockMovements")
    .withIndex("by_tenant_product", (q) =>
      q.eq("tenantId", tenantId).eq("productId", productId),
    )
    .collect();

  // Dokumen pembelian & opname menyimpan barisnya di dalam dokumen, jadi yang
  // dihitung adalah dokumennya (itu yang akan menggantung kalau produknya hilang).
  const lineDocs = await Promise.all([
    ctx.db
      .query("purchaseRequisitions")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect(),
    ctx.db
      .query("purchaseOrders")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect(),
    ctx.db
      .query("goodsReceipts")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect(),
  ]);
  let purchases = lineDocs.reduce(
    (count, docs) =>
      count +
      docs.filter((doc) =>
        doc.lines.some((line) => line.productId === productId),
      ).length,
    0,
  );

  // Tagihan supplier menyimpan barisnya di dalam fakturnya (`payable.invoice.lines`),
  // bukan di `lines` seperti dokumen pembelian lain.
  const payableDocs = await ctx.db
    .query("payables")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  purchases += payableDocs.filter((payable) =>
    (payable.invoice?.lines ?? []).some((line) => line.productId === productId),
  ).length;

  const opnameDocs = await ctx.db
    .query("opnameSessions")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  const opname = opnameDocs.filter((session) =>
    session.lines.some((line) => line.productId === productId),
  ).length;

  return {
    stock,
    sales: saleLines.length,
    movements: movements.length,
    purchases,
    opname,
  };
}

/**
 * Mengubah identitas produk: nama, SKU, dan/atau harga beli.
 *
 * SKU dijaga unik di antara produk tenant ini (tanpa peduli huruf besar-kecil) dan
 * tetap dipakai apa adanya; harga jual **tidak** disentuh di sini — itu urusan
 * `setPricing`. Perubahan yang tidak mengubah apa pun tidak menulis audit.
 */
export const update = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    productId: v.id("products"),
    name: v.optional(v.string()),
    sku: v.optional(v.string()),
    cost: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "product.manage");

    const product = await ctx.db.get(args.productId);
    if (!product || product.tenantId !== args.tenantId) {
      throw new Error("Produk tidak ditemukan untuk tenant ini.");
    }

    const others = await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const decision = validateProductIdentity(
      { name: product.name, sku: product.sku, cost: product.cost },
      { name: args.name, sku: args.sku, cost: args.cost },
      {
        otherSkus: others
          .filter((row) => row._id !== args.productId)
          .map((row) => row.sku),
      },
    );
    if (!decision.ok) throw new Error(decision.reason);

    if (decision.changed.length === 0) {
      return {
        productId: args.productId,
        name: product.name,
        sku: product.sku,
        cost: product.cost,
        changed: [] as string[],
      };
    }

    await ctx.db.patch(args.productId, {
      name: decision.value.name,
      sku: decision.value.sku,
      cost: decision.value.cost,
    });

    await emitProductUpdated(
      ctx,
      {
        tenantId: args.tenantId,
        sku: decision.value.sku,
        name: decision.value.name,
        price: product.price,
        unit: product.unit,
        active: product.active,
        categoryId: product.categoryId,
        subcategoryId: product.subcategoryId,
      },
      decision.changed,
    );

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "product.update",
      entity: "products",
      entityId: args.productId,
      meta: {
        changed: decision.changed,
        from: { name: product.name, sku: product.sku, cost: product.cost },
        to: decision.value,
      },
    });

    return {
      productId: args.productId,
      name: decision.value.name,
      sku: decision.value.sku,
      cost: decision.value.cost,
      changed: decision.changed,
    };
  },
});

/**
 * Mengaktifkan/menonaktifkan produk.
 *
 * Nonaktif berarti produk itu **tidak dijual lagi**: `products.listByStore` hanya
 * mengembalikan produk aktif, jadi kasir dan katalog penjualan tidak lagi
 * menawarkannya. Datanya tetap ada — stok, riwayat penjualan, dan dokumen supplier
 * masih menunjuk produk yang sama, dan tabel Produk tetap memuatnya supaya bisa
 * diaktifkan kembali.
 */
export const setActive = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    productId: v.id("products"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "product.manage");

    const product = await ctx.db.get(args.productId);
    if (!product || product.tenantId !== args.tenantId) {
      throw new Error("Produk tidak ditemukan untuk tenant ini.");
    }

    if (product.active === args.active) {
      return {
        productId: args.productId,
        name: product.name,
        sku: product.sku,
        active: args.active,
        changed: false,
      };
    }

    await ctx.db.patch(args.productId, { active: args.active });

    await emitProductUpdated(
      ctx,
      {
        tenantId: args.tenantId,
        sku: product.sku,
        name: product.name,
        price: product.price,
        unit: product.unit,
        active: args.active,
        categoryId: product.categoryId,
        subcategoryId: product.subcategoryId,
      },
      ["active"],
    );

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "product.status",
      entity: "products",
      entityId: args.productId,
      meta: { name: product.name, sku: product.sku, active: args.active },
    });

    return {
      productId: args.productId,
      name: product.name,
      sku: product.sku,
      active: args.active,
      changed: true,
    };
  },
});

/**
 * Boleh tidaknya sebuah produk dihapus, beserta alasannya.
 *
 * Dipakai halaman sebelum menekan Hapus: yang ditampilkan adalah hitungan server,
 * bukan tebakan klien — dan produk yang sudah dipakai tetap bisa dinonaktifkan
 * (jalur itu selalu ada, lihat `setActive`).
 */
export const deletionCheck = query({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    productId: v.id("products"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "product.manage");

    const product = await ctx.db.get(args.productId);
    if (!product || product.tenantId !== args.tenantId) {
      throw new Error("Produk tidak ditemukan untuk tenant ini.");
    }

    const usage = await readProductUsage(ctx, args.tenantId, args.productId);
    return { name: product.name, sku: product.sku, usage, ...productDeletionCheck(product.name, usage) };
  },
});

/**
 * Menghapus produk — hanya kalau memang belum dipakai apa pun.
 *
 * Pagarnya `productDeletionCheck`: produk yang sudah terjual, masih berstok,
 * punya pergerakan stok, atau muncul di dokumen pembelian/opname **ditolak** dengan
 * alasan satu per satu. Untuk produk seperti itu jawabannya menonaktifkan, bukan
 * menghapus riwayat orang lain. Yang ikut dibuang saat produknya memang layak
 * dihapus: baris stoknya (semuanya nol) dan berkas gambarnya, supaya tidak ada
 * data atau berkas yang menggantung.
 */
export const remove = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    productId: v.id("products"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "product.manage");

    const product = await ctx.db.get(args.productId);
    if (!product || product.tenantId !== args.tenantId) {
      throw new Error("Produk tidak ditemukan untuk tenant ini.");
    }

    const usage = await readProductUsage(ctx, args.tenantId, args.productId);
    const decision = productDeletionCheck(product.name, usage);
    if (!decision.canDelete) throw new Error(decision.sentence);

    const levels = await ctx.db
      .query("stockLevels")
      .withIndex("by_product_store", (q) => q.eq("productId", args.productId))
      .collect();
    for (const level of levels) {
      if (level.tenantId === args.tenantId) await ctx.db.delete(level._id);
    }

    const images = product.images ?? [];
    for (const storageId of images) {
      await ctx.storage.delete(storageId);
    }

    await ctx.db.delete(args.productId);

    // Produk yang benar-benar boleh dihapus (belum dipakai apa pun) juga harus
    // hilang dari salinan platform — `deleted` membedakannya dari sekadar
    // dinonaktifkan.
    await emitProductUpdated(
      ctx,
      {
        tenantId: args.tenantId,
        sku: product.sku,
        name: product.name,
        price: product.price,
        unit: product.unit,
        active: false,
        categoryId: product.categoryId,
        subcategoryId: product.subcategoryId,
      },
      ["deleted"],
    );

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "product.remove",
      entity: "products",
      entityId: args.productId,
      meta: { name: product.name, sku: product.sku, usage, images: images.length },
    });

    return { removed: true as const, name: product.name, sku: product.sku, usage };
  },
});

/**
 * Mengubah konfigurasi modifier item sebuah produk. Kosongkan daftarnya untuk
 * menghapus semua modifier — itu selalu boleh, bahkan setelah modul F&B mati.
 */
export const setModifiers = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    productId: v.id("products"),
    modifiers: modifierValidator,
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "product.manage");

    const product = await ctx.db.get(args.productId);
    if (!product || product.tenantId !== args.tenantId) {
      throw new Error("Produk tidak ditemukan untuk tenant ini.");
    }

    const modifiers = await resolveModifiers(ctx, args);

    await ctx.db.patch(args.productId, { modifiers });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "product.modifiers",
      entity: "products",
      entityId: args.productId,
      meta: {
        product: product.name,
        groups: modifiers.length,
        options: modifiers.reduce((sum, group) => sum + group.options.length, 0),
      },
    });

    return { modifiers };
  },
});

/**
 * URL unggah sekali pakai untuk gambar produk.
 *
 * Izinnya `product.manage` — sama dengan yang boleh mengubah data produk itu
 * sendiri, karena gambar produk memang bagian dari data produk. Klien memakai
 * URL ini untuk mengirim berkasnya langsung ke penyimpanan, lalu menautkannya
 * lewat `addImage` (pola tiga langkah Convex: minta URL → POST berkas → simpan
 * id-nya).
 */
export const generateImageUploadUrl = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "product.manage");
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Menautkan satu gambar ke sebuah produk. Dua hal dijaga di sini, bukan hanya di
 * UI: jumlahnya tidak melebihi `MAX_PRODUCT_IMAGES`, dan berkasnya benar-benar
 * gambar yang ukurannya wajar (dibaca dari metadata `_storage`). Berkas yang
 * ditolak langsung dihapus supaya tidak menumpuk sebagai sampah penyimpanan.
 */
export const addImage = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    productId: v.id("products"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "product.manage");

    const product = await ctx.db.get(args.productId);
    if (!product || product.tenantId !== args.tenantId) {
      throw new Error("Produk tidak ditemukan untuk tenant ini.");
    }

    const images = product.images ?? [];
    const room = canAddProductImage(images.length);
    if (!room.ok) throw new Error(room.reason);
    if (images.includes(args.storageId)) {
      throw new Error("Gambar itu sudah terpasang di produk ini.");
    }

    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) {
      throw new Error("Berkas gambar tidak ditemukan di penyimpanan.");
    }
    const size = Number(metadata.size ?? 0);
    const valid = validateProductImage({ contentType: metadata.contentType, size });
    if (!valid.ok) {
      await ctx.storage.delete(args.storageId);
      throw new Error(valid.reason);
    }

    await ctx.db.patch(args.productId, { images: [...images, args.storageId] });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "product.image.add",
      entity: "products",
      entityId: args.productId,
      meta: { product: product.name, images: images.length + 1, bytes: size },
    });

    return { images: images.length + 1 };
  },
});

/**
 * Melepas satu gambar dari produk sekaligus menghapus berkasnya, supaya kuota
 * penyimpanan tidak terisi gambar yang sudah tidak dipakai siapa pun.
 */
export const removeImage = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    productId: v.id("products"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "product.manage");

    const product = await ctx.db.get(args.productId);
    if (!product || product.tenantId !== args.tenantId) {
      throw new Error("Produk tidak ditemukan untuk tenant ini.");
    }

    const images = product.images ?? [];
    if (!images.includes(args.storageId)) {
      throw new Error("Gambar itu tidak terpasang di produk ini.");
    }

    const remaining = images.filter((storageId) => storageId !== args.storageId);
    await ctx.db.patch(args.productId, { images: remaining });
    await ctx.storage.delete(args.storageId);

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "product.image.remove",
      entity: "products",
      entityId: args.productId,
      meta: { product: product.name, images: remaining.length },
    });

    return { images: remaining.length };
  },
});

/** Manual stock correction (damage, counts, receiving without a PO). */
export const adjustStock = mutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    productId: v.id("products"),
    delta: v.number(),
    note: v.optional(v.string()),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "stock.adjust");

    const balance = await applyStockChange(ctx, {
      tenantId: args.tenantId,
      storeId: args.storeId,
      productId: args.productId,
      delta: args.delta,
      reason: "adjustment",
      note: args.note,
      actorId: args.actorId,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "stock.adjust",
      entity: "products",
      entityId: args.productId,
      meta: { delta: args.delta, balance },
    });

    return { balance };
  },
});

export const lowStock = query({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
    threshold: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.tenantId, args.actorId);

    const threshold = args.threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

    const levels = await ctx.db
      .query("stockLevels")
      .withIndex("by_tenant_store", (q) =>
        q.eq("tenantId", args.tenantId).eq("storeId", args.storeId),
      )
      .collect();

    // Stok kritis = stok di lokasi jual; stok yang masih di gudang memang belum
    // bisa dijual, jadi tidak boleh menyembunyikan kekurangan di rak.
    const low = levels.filter(
      (l) => l.warehouseId === undefined && l.quantity <= threshold,
    );
    const products = await Promise.all(
      low.map(async (l) => {
        const product = await ctx.db.get(l.productId);
        return product ? { product, quantity: l.quantity } : null;
      }),
    );

    return products.filter((p): p is NonNullable<typeof p> => p !== null);
  },
});

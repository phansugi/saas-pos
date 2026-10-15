import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requirePermission, writeAuditLog } from "./lib/access";
import {
  MAX_CATEGORIES_PER_TENANT,
  categorySkuCode,
  renamesSkuCode,
  validateCategoryName,
} from "./lib/categories";

/**
 * Kategori produk — struktur katalog, bukan isi rak.
 *
 * Gerbangnya satu izin: `category.manage` (pemilik & manajer). Staf gudang memang
 * mengelola **produk** (`product.manage`), tetapi kategori menentukan kode di
 * tengah SKU (`PBB-<KATEGORI>-<nomor>`) dan susunan tab di POS, jadi yang
 * mengaturnya adalah peran pengelola — sama seperti `team.manage` dan
 * `api.manage`.
 *
 * Yang bisa dilakukan di sini: **tambah**, **ganti nama**, **aktifkan/nonaktifkan**,
 * dan **hapus**. Semuanya lewat aturan murni `lib/categories.ts`, dan tiap aksi
 * menulis jejak audit — termasuk berapa produk yang kehilangan kategorinya saat
 * dihapus.
 *
 * Tiga hal yang sengaja **tidak** dilakukan di sini:
 *
 *  - membaca daftar: itu `tenants.listCategories` (cukup keanggotaan), karena
 *    pemilih kategori di form Produk baru dipakai semua peran yang boleh membuat
 *    produk, dan POS memakai daftar yang sama untuk tabnya;
 *  - menghapus atau mengubah **produk**: hapus kategori hanya melepas
 *    `products.categoryId`, produknya tetap ada;
 *  - menulis ulang SKU: SKU produk dibuat sekali dan tidak diubah diam-diam oleh
 *    perubahan nama kategori (lihat catatan di lib/categories.ts).
 */

/** Kategori milik tenant ini, atau galat yang jelas untuk pemanggilnya. */
async function loadCategory(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  categoryId: Id<"categories">,
): Promise<Doc<"categories">> {
  const category = await ctx.db.get(categoryId);
  if (!category || category.tenantId !== tenantId) {
    throw new Error("Kategori tidak ditemukan untuk tenant ini.");
  }
  return category;
}

/** Semua kategori tenant, terurut seperti yang dibaca halaman. */
async function listTenantCategories(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"categories">[]> {
  const rows = await ctx.db
    .query("categories")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

export const create = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "category.manage");

    const existing = await listTenantCategories(ctx, args.tenantId);
    const decision = validateCategoryName(
      { name: args.name },
      { existingNames: existing.map((row) => row.name), count: existing.length },
    );
    if (!decision.ok) throw new Error(decision.reason);

    // Kategori baru ditaruh di urutan terakhir: urutan yang sudah dipakai kasir
    // di POS tidak berubah hanya karena satu kategori ditambahkan.
    const sortOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0);
    const categoryId = await ctx.db.insert("categories", {
      tenantId: args.tenantId,
      name: decision.value.name,
      sortOrder,
      active: true,
      createdAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "category.create",
      entity: "categories",
      entityId: categoryId,
      meta: { name: decision.value.name, skuCode: categorySkuCode(decision.value.name) },
    });

    return {
      categoryId,
      name: decision.value.name,
      skuCode: categorySkuCode(decision.value.name),
      limit: MAX_CATEGORIES_PER_TENANT,
    };
  },
});

/**
 * Mengganti nama kategori.
 *
 * Nama barunya mengubah kode di SKU **produk berikutnya**, bukan SKU yang sudah
 * ada: produknya tidak berpindah kategori, jadi SKU-nya tetap sah. Balikannya
 * menyebut kode lama & kode baru supaya halaman bisa mengatakannya apa adanya.
 */
export const rename = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    categoryId: v.id("categories"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "category.manage");

    const category = await loadCategory(ctx, args.tenantId, args.categoryId);
    const others = (await listTenantCategories(ctx, args.tenantId)).filter(
      (row) => row._id !== args.categoryId,
    );
    const decision = validateCategoryName(
      { name: args.name },
      { existingNames: others.map((row) => row.name) },
    );
    if (!decision.ok) throw new Error(decision.reason);

    const previousName = category.name;
    if (decision.value.name === previousName) {
      return {
        categoryId: args.categoryId,
        name: previousName,
        previousName,
        skuCodeChanged: false,
        changed: false,
      };
    }

    await ctx.db.patch(args.categoryId, { name: decision.value.name });

    const skuCodeChanged = renamesSkuCode(previousName, decision.value.name);
    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "category.update",
      entity: "categories",
      entityId: args.categoryId,
      meta: {
        from: previousName,
        to: decision.value.name,
        skuCodeFrom: categorySkuCode(previousName),
        skuCodeTo: categorySkuCode(decision.value.name),
        skuCodeChanged,
      },
    });

    return {
      categoryId: args.categoryId,
      name: decision.value.name,
      previousName,
      skuCodeChanged,
      changed: true,
    };
  },
});

/**
 * Mengaktifkan/menonaktifkan kategori.
 *
 * Nonaktif bukan hapus: produk yang sudah memakainya tetap dijual dan tetap
 * muncul di POS, tetapi kategori itu hilang dari pemilih kategori produk baru.
 * Karena itu aksinya selalu bisa dibatalkan.
 */
export const setActive = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    categoryId: v.id("categories"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "category.manage");

    const category = await loadCategory(ctx, args.tenantId, args.categoryId);
    const current = category.active !== false;
    if (current === args.active) {
      return { categoryId: args.categoryId, name: category.name, active: current, changed: false };
    }

    await ctx.db.patch(args.categoryId, { active: args.active });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "category.status",
      entity: "categories",
      entityId: args.categoryId,
      meta: { name: category.name, active: args.active },
    });

    return { categoryId: args.categoryId, name: category.name, active: args.active, changed: true };
  },
});

/**
 * Menghapus kategori.
 *
 * Produk yang memakainya **tidak** ikut terhapus: `categoryId`-nya dilepas di sini
 * supaya tidak ada produk yang menunjuk kategori yang sudah tidak ada (di layar
 * produk itu tampil sebagai “Tanpa kategori”). Jumlah produk yang dilepas
 * dikembalikan dan dicatat di jejak audit — halaman memakainya untuk meminta
 * konfirmasi lebih dulu, dan setelah dihapus untuk mengatakan apa yang terjadi.
 */
export const remove = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    categoryId: v.id("categories"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "category.manage");

    const category = await loadCategory(ctx, args.tenantId, args.categoryId);

    const products = await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const attached = products.filter((product) => product.categoryId === args.categoryId);

    for (const product of attached) {
      await ctx.db.patch(product._id, { categoryId: undefined });
    }
    await ctx.db.delete(args.categoryId);

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "category.remove",
      entity: "categories",
      entityId: args.categoryId,
      meta: {
        name: category.name,
        skuCode: categorySkuCode(category.name),
        detachedProducts: attached.length,
        // SKU sengaja tidak ditulis ulang; dicatat supaya jejaknya jelas.
        skusUnchanged: true,
      },
    });

    return {
      removed: true as const,
      name: category.name,
      detachedProducts: attached.length,
    };
  },
});
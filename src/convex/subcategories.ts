import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requirePermission, writeAuditLog } from "./lib/access";
import {
  MAX_SUBCATEGORIES_PER_CATEGORY,
  validateSubcategoryName,
} from "./lib/categories";
import { queueMarketplaceCategoryPush } from "./lib/marketplaceStockQueue";

/**
 * Subkategori produk — satu tingkat katalog **di bawah** kategori.
 *
 * Kategorinya menentukan susunan tab POS (SKU `PBB-<nomor urut>` tidak memuatnya),
 * jadi yang mengatur subkategori pun peran pengelola yang sama: izin
 * `category.manage`. Yang bisa dilakukan di sini: **tambah** (selalu di bawah
 * sebuah kategori), **ganti nama**, **aktifkan/nonaktifkan**, dan **hapus**.
 *
 * Tiga hal yang sengaja **tidak** dilakukan di sini:
 *
 *  - membaca daftar: `tenants.listSubcategories` (cukup keanggotaan), karena
 *    pemilih subkategori di form Produk dipakai semua peran yang boleh membuat
 *    produk;
 *  - mengubah `products.categoryId`: subkategori tidak pernah memindahkan kategori,
 *    jadi tidak ada jalur tulis produk dari sini;
 *  - menulis ulang SKU: subkategori tidak menyentuh SKU sama sekali — ganti nama,
 *    nonaktifkan, atau hapus semuanya tidak mengubah satu SKU pun (produk menunjuk
 *    id subkategorinya, bukan namanya).
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

/** Subkategori milik tenant ini, atau galat yang jelas untuk pemanggilnya. */
async function loadSubcategory(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  subcategoryId: Id<"subcategories">,
): Promise<Doc<"subcategories">> {
  const row = await ctx.db.get(subcategoryId);
  if (!row || row.tenantId !== tenantId) {
    throw new Error("Subkategori tidak ditemukan untuk tenant ini.");
  }
  return row;
}

/** Semua subkategori tenant, terurut seperti yang dibaca halaman. */
async function listTenantSubcategories(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"subcategories">[]> {
  const rows = await ctx.db
    .query("subcategories")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

export const create = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    /** Subkategori selalu lahir di bawah sebuah kategori — tidak ada yang berdiri sendiri. */
    categoryId: v.id("categories"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "category.manage");

    const category = await loadCategory(ctx, args.tenantId, args.categoryId);
    const existing = (await listTenantSubcategories(ctx, args.tenantId)).filter(
      (row) => row.categoryId === args.categoryId,
    );
    const decision = validateSubcategoryName(
      { name: args.name },
      { existingNames: existing.map((row) => row.name), count: existing.length },
    );
    if (!decision.ok) throw new Error(decision.reason);

    // Subkategori baru ditaruh paling akhir: urutan pemilih yang sudah dipakai
    // tidak berubah hanya karena satu subkategori ditambahkan.
    const sortOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0);
    const subcategoryId = await ctx.db.insert("subcategories", {
      tenantId: args.tenantId,
      categoryId: args.categoryId,
      name: decision.value.name,
      sortOrder,
      active: true,
      createdAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "subcategory.create",
      entity: "subcategories",
      entityId: subcategoryId,
      meta: { name: decision.value.name, category: category.name },
    });

    // Pohon kategori di marketplace dibuat dari katalog; subkategori baru ikut
    // terkirim sesudah tersimpan, bukan menunggu tombol manual.
    await queueMarketplaceCategoryPush(ctx, { tenantId: args.tenantId });

    return {
      subcategoryId,
      categoryId: args.categoryId,
      name: decision.value.name,
      limit: MAX_SUBCATEGORIES_PER_CATEGORY,
    };
  },
});

/**
 * Mengganti nama subkategori.
 *
 * Produk menunjuk id-nya, jadi namanya berubah di seluruh aplikasi sekaligus dan
 * tidak ada label produk yang perlu ditulis ulang — hanya kiriman berikutnya ke
 * platform yang membawa nama baru.
 */
export const rename = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    subcategoryId: v.id("subcategories"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "category.manage");

    const row = await loadSubcategory(ctx, args.tenantId, args.subcategoryId);
    const others = (await listTenantSubcategories(ctx, args.tenantId)).filter(
      (candidate) => candidate.categoryId === row.categoryId && candidate._id !== args.subcategoryId,
    );
    const decision = validateSubcategoryName(
      { name: args.name },
      { existingNames: others.map((candidate) => candidate.name) },
    );
    if (!decision.ok) throw new Error(decision.reason);

    const previousName = row.name;
    if (decision.value.name === previousName) {
      return {
        subcategoryId: args.subcategoryId,
        name: previousName,
        previousName,
        changed: false,
      };
    }

    await ctx.db.patch(args.subcategoryId, { name: decision.value.name });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "subcategory.update",
      entity: "subcategories",
      entityId: args.subcategoryId,
      meta: { from: previousName, to: decision.value.name },
    });

    await queueMarketplaceCategoryPush(ctx, { tenantId: args.tenantId });

    return {
      subcategoryId: args.subcategoryId,
      name: decision.value.name,
      previousName,
      changed: true,
    };
  },
});

/**
 * Mengaktifkan/menonaktifkan subkategori.
 *
 * Nonaktif bukan hapus: produk yang sudah menunjuknya tetap menyimpan
 * subkategorinya (dan tetap terkirim di API), tetapi subkategori itu hilang dari
 * pemilih di form produk. Karena itu aksinya selalu bisa dibatalkan.
 */
export const setActive = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    subcategoryId: v.id("subcategories"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "category.manage");

    const row = await loadSubcategory(ctx, args.tenantId, args.subcategoryId);
    const current = row.active !== false;
    if (current === args.active) {
      return {
        subcategoryId: args.subcategoryId,
        name: row.name,
        active: current,
        changed: false,
      };
    }

    await ctx.db.patch(args.subcategoryId, { active: args.active });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "subcategory.status",
      entity: "subcategories",
      entityId: args.subcategoryId,
      meta: { name: row.name, active: args.active },
    });

    await queueMarketplaceCategoryPush(ctx, { tenantId: args.tenantId });

    return { subcategoryId: args.subcategoryId, name: row.name, active: args.active, changed: true };
  },
});

/**
 * Menghapus subkategori.
 *
 * Produk yang menunjuknya **tidak** ikut terhapus dan kategorinya tidak berubah:
 * hanya `subcategoryId`-nya yang dilepas (produknya tetap di kategori yang sama,
 * kini tanpa subkategori). Jumlah produk yang dilepas dikembalikan dan dicatat di
 * jejak audit — halaman memakainya untuk meminta konfirmasi lebih dulu.
 */
export const remove = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    subcategoryId: v.id("subcategories"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "category.manage");

    const row = await loadSubcategory(ctx, args.tenantId, args.subcategoryId);

    const products = await ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const attached = products.filter((product) => product.subcategoryId === args.subcategoryId);
    for (const product of attached) {
      await ctx.db.patch(product._id, { subcategoryId: undefined });
    }
    await ctx.db.delete(args.subcategoryId);

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "subcategory.remove",
      entity: "subcategories",
      entityId: args.subcategoryId,
      meta: {
        name: row.name,
        detachedProducts: attached.length,
        // Nama subkategori tidak tersimpan di produk mana pun — dicatat supaya
        // jelas tidak ada label yang perlu dibersihkan.
        skusUnchanged: true,
      },
    });

    // Subkategori yang hilang ikut terkirim dalam pohon katalog terbaru;
    // marketplace yang memutuskan apakah menyimpan riwayatnya.
    await queueMarketplaceCategoryPush(ctx, { tenantId: args.tenantId });

    return {
      removed: true as const,
      name: row.name,
      detachedProducts: attached.length,
    };
  },
});

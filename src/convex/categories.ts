import { v } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requirePermission, writeAuditLog } from "./lib/access";
import {
  MAX_CATEGORIES_PER_TENANT,
  categorySkuCode,
  renamesSkuCode,
  validateCategoryName,
} from "./lib/categories";
import { businessCategoryOf } from "./lib/businessCategory";
import {
  businessCategoryLabel,
  seedProductCatalogFromBusinessCategory,
} from "./lib/productCatalogSeed";
import { productCatalogSeedSentence } from "./lib/productCatalogPresets";

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
 * produk itu tampil sebagai “Tanpa kategori”). Subkategori di bawahnya ikut
 * terhapus — subkategori tidak punya arti tanpa kategorinya — dan produk yang
 * menunjuk subkategori itu ikut kehilangan `subcategoryId`-nya. Jumlah produk yang
 * dilepas dan jumlah subkategori yang terhapus dikembalikan serta dicatat di jejak
 * audit: halaman memakainya untuk meminta konfirmasi lebih dulu, dan setelah
 * dihapus untuk mengatakan apa yang terjadi.
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

    const subcategories = await ctx.db
      .query("subcategories")
      .withIndex("by_tenant_category", (q) =>
        q.eq("tenantId", args.tenantId).eq("categoryId", args.categoryId),
      )
      .collect();

    for (const product of attached) {
      await ctx.db.patch(product._id, { categoryId: undefined, subcategoryId: undefined });
    }
    // Subkategori yang menempel di produk di luar `attached` (seharusnya tidak
    // ada — penempatan dijaga `products.setCategory`) tetap dilepas juga, supaya
    // tidak ada produk yang menunjuk baris yang sudah dihapus.
    const subcategoryIds = new Set(subcategories.map((row) => row._id as string));
    const others = products.filter(
      (product) =>
        product.categoryId !== args.categoryId &&
        product.subcategoryId !== undefined &&
        subcategoryIds.has(product.subcategoryId as string),
    );
    for (const product of others) {
      await ctx.db.patch(product._id, { subcategoryId: undefined });
    }
    for (const row of subcategories) {
      await ctx.db.delete(row._id);
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
        removedSubcategories: subcategories.length,
        // SKU sengaja tidak ditulis ulang; dicatat supaya jejaknya jelas.
        skusUnchanged: true,
      },
    });

    return {
      removed: true as const,
      name: category.name,
      detachedProducts: attached.length,
      removedSubcategories: subcategories.length,
    };
  },
});

/**
 * Menyamakan katalog produk dengan **kategori bisnis** workspace ini.
 *
 * Dipakai tombol di halaman Produk & Stok: workspace yang sudah berdiri sebelum
 * fitur presets ada — atau yang katalognya sempat dirapikan lalu ingin memakai
 * lagi daftar bawaan untuk bisnisnya — bisa meminta master kategori & subkategori
 * produk yang relevan tanpa mengubah kategori yang sudah ada.
 *
 * Sifatnya sama dengan penyemaian saat onboarding: **hanya menambah** (tidak
 * mengganti nama, tidak menonaktifkan, tidak menghapus, tidak menyentuh produk)
 * dan idempoten — ditekan dua kali, panggilan kedua melaporkan tidak ada yang
 * perlu ditambahkan. Workspace yang belum pernah memilih kategori bisnis ditolak
 * dengan alasan yang menyebut jalan keluarnya (pilih dulu di halaman Profil).
 */
/**
 * Penyapuan admin: menyemai katalog produk untuk **semua** workspace yang sudah
 * memilih kategori bisnis (dipakai sekali setelah fitur presets dirilis, dan
 * aman dijalankan berkali-kali).
 *
 * Kenapa perlu: workspace yang mengunci kategori bisnisnya **sebelum** fitur ini
 * ada tidak ikut berubah sendiri — pemiliknya baru mendapat master kategori &
 * subkategori produk setelah menekan tombol di halaman Produk & Stok. Penyapuan
 * ini melakukan hal yang sama untuk semua workspace sekaligus, tanpa menyentuh
 * kategori yang sudah ada dan tanpa mengubah pilihan bisnis siapa pun.
 *
 * `internalMutation`: hanya bisa dijalankan dari CLI/deployment admin
 * (`bun convex run categories:backfillFromBusinessCategory`), tidak pernah dari
 * aplikasi — akun platform memang bukan anggota tenant orang lain.
 */
export const backfillFromBusinessCategory = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const tenants = await ctx.db.query("tenants").collect();
    // Batasnya longgar dengan sengaja: deployment yang sudah lama berjalan bisa
    // punya ratusan workspace uji, dan yang ingin dicapai justru “semua sekaligus”.
    const batas = args.limit ?? 2000;

    const tanpaPilihan: string[] = [];
    const sudahSesuai: string[] = [];
    const disemai: {
      tenantId: string;
      slug: string;
      businessCategory: string;
      createdCategories: string[];
      createdSubcategories: number;
      skippedCategories: string[];
    }[] = [];

    for (const tenant of tenants.slice(0, batas)) {
      const locked = businessCategoryOf(tenant);
      if (!locked) {
        tanpaPilihan.push(tenant.slug);
        continue;
      }

      const seeded = await seedProductCatalogFromBusinessCategory(ctx, {
        tenantId: tenant._id,
        category: locked.category,
        subcategory: locked.subcategory,
        categoryLabel: locked.categoryLabel,
        subcategoryLabel: locked.subcategoryLabel,
      });

      if (seeded.unchanged) {
        sudahSesuai.push(tenant.slug);
        continue;
      }

      disemai.push({
        tenantId: tenant._id,
        slug: tenant.slug,
        businessCategory: businessCategoryLabel(locked),
        createdCategories: seeded.createdCategoryNames,
        createdSubcategories: seeded.createdSubcategoryCount,
        skippedCategories: seeded.skippedCategoryNames,
      });
    }

    return {
      tenantsDibaca: Math.min(tenants.length, batas),
      workspaceDisemai: disemai.length,
      workspaceSudahSesuai: sudahSesuai.length,
      workspaceTanpaKategoriBisnis: tanpaPilihan.length,
      disemai,
      sentence:
        disemai.length === 0
          ? "Tidak ada workspace yang perlu disemai — katalog produk semuanya sudah sesuai pilihan bisnisnya."
          : `${disemai.length} workspace disemai master kategori & subkategori produk sesuai pilihan bisnisnya.`,
    };
  },
});

export const syncFromBusinessCategory = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "category.manage");

    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) throw new Error("Tenant tidak ditemukan.");

    const locked = businessCategoryOf(tenant);
    if (!locked) {
      throw new Error(
        "Workspace ini belum memilih kategori utama bisnis. Pilih lebih dulu di halaman Profil supaya katalog produknya bisa menyesuaikan.",
      );
    }

    const seeded = await seedProductCatalogFromBusinessCategory(ctx, {
      tenantId: args.tenantId,
      category: locked.category,
      subcategory: locked.subcategory,
      categoryLabel: locked.categoryLabel,
      subcategoryLabel: locked.subcategoryLabel,
    });

    const sentence = productCatalogSeedSentence({
      businessLabel: businessCategoryLabel(locked),
      createdCategoryNames: seeded.createdCategoryNames,
      createdSubcategoryCount: seeded.createdSubcategoryCount,
      skippedCategoryNames: seeded.skippedCategoryNames,
    });

    if (!seeded.unchanged) {
      await writeAuditLog(ctx, {
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: "category.sync_from_business_category",
        entity: "categories",
        meta: {
          businessCategory: locked.category,
          businessSubcategory: locked.subcategory,
          createdCategories: seeded.createdCategoryNames,
          createdSubcategories: seeded.createdSubcategoryCount,
          skippedCategories: seeded.skippedCategoryNames,
        },
      });
    }

    return {
      changed: !seeded.unchanged,
      businessCategoryLabel: businessCategoryLabel(locked),
      createdCategories: seeded.createdCategoryNames,
      createdSubcategories: seeded.createdSubcategoryCount,
      skippedCategories: seeded.skippedCategoryNames,
      sentence,
    };
  },
});
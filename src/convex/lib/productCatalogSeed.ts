/**
 * Penyemaian **master kategori & subkategori produk** dari kategori bisnis pemilik.
 *
 * Pemilik bisnis memilih satu kategori utama + subkategori saat onboarding (dan
 * pilihan itu terkunci permanen). Berkas ini yang menerjemahkan pilihan tersebut
 * menjadi baris nyata di tabel `categories` & `subcategories` milik workspace itu:
 *
 *   - dipanggil `tenants.create` saat workspace lahir (katalog produknya langsung
 *     sesuai bisnisnya, bukan daftar generik),
 *   - dipanggil `tenants.setBusinessCategory` saat pemilik lama mengunci pilihan
 *     pertamanya,
 *   - dipanggil `categories.syncFromBusinessCategory` saat pemilik menekan tombol
 *     sinkronisasi di halaman Produk & Stok.
 *
 * Tiga sifat yang sengaja:
 *
 *  1. **Hanya menambah** — kategori/subkategori yang sudah ada tidak diganti nama,
 *     tidak dinonaktifkan, dan tidak dihapus; produk tidak pernah tersentuh.
 *     Rencananya dihitung modul murni `lib/productCatalogPresets.ts`.
 *  2. **Idempoten** — menjalankan ulang pada katalog yang sudah lengkap tidak
 *     membuat baris baru sama sekali.
 *  3. **Menghormati batas** — jumlah kategori per workspace dan subkategori per
 *     kategori dibatasi aturan halaman Produk & Stok; yang tidak muat dilewati dan
 *     dilaporkan, bukan menggagalkan seluruh penyemaian.
 */
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { categoryNameKey } from "./categories";
import {
  planProductCatalogSeeding,
  productCatalogPlanIsEmpty,
  productCatalogPresetFor,
} from "./productCatalogPresets";

export { businessCategoryLabel } from "./productCatalogPresets";

export interface ProductCatalogSeedResult {
  /** Nama kategori produk yang baru dibuat (urut sesuai preset). */
  createdCategoryNames: string[];
  /** Total subkategori yang baru dibuat, termasuk di kategori yang sudah ada. */
  createdSubcategoryCount: number;
  /** Preset kategori yang dilewati karena batas jumlah kategori. */
  skippedCategoryNames: string[];
  /** Benar kalau tidak ada baris yang ditulis. */
  unchanged: boolean;
}

/**
 * Menyemai katalog produk untuk satu workspace. Pemanggil sudah memegang izin
 * (`category.manage`) atau sedang membuat tenant; fungsi ini tidak memeriksa izin
 * sendiri supaya bisa dipakai `tenants.create` (yang berjalan sebelum keanggotaan
 * ada).
 */
export async function seedProductCatalogFromBusinessCategory(
  ctx: MutationCtx,
  input: {
    tenantId: Id<"tenants">;
    category: string;
    subcategory?: string | null;
    categoryLabel?: string | null;
    subcategoryLabel?: string | null;
    now?: number;
  },
): Promise<ProductCatalogSeedResult> {
  const now = input.now ?? Date.now();

  const categories = await ctx.db
    .query("categories")
    .withIndex("by_tenant", (q) => q.eq("tenantId", input.tenantId))
    .collect();
  const subcategories = await ctx.db
    .query("subcategories")
    .withIndex("by_tenant", (q) => q.eq("tenantId", input.tenantId))
    .collect();

  const categoryById = new Map(categories.map((row) => [row._id, row]));
  const categoryIdByName = new Map(
    categories.map((row) => [categoryNameKey(row.name), row._id]),
  );

  const preset = productCatalogPresetFor({
    category: input.category,
    subcategory: input.subcategory,
    categoryLabel: input.categoryLabel,
    subcategoryLabel: input.subcategoryLabel,
  });

  const plan = planProductCatalogSeeding({
    preset: preset.categories,
    existingCategoryNames: categories.map((row) => row.name),
    existingSubcategories: subcategories
      .map((row) => {
        const parent = categoryById.get(row.categoryId);
        return parent ? { categoryName: parent.name, name: row.name } : null;
      })
      .filter((row): row is { categoryName: string; name: string } => row !== null),
  });

  if (productCatalogPlanIsEmpty(plan)) {
    return {
      createdCategoryNames: [],
      createdSubcategoryCount: 0,
      skippedCategoryNames: plan.skippedCategoryNames,
      unchanged: true,
    };
  }

  // Kategori baru diletakkan di urutan terakhir supaya tab POS yang sudah dipakai
  // kasir tidak bergeser hanya karena katalognya baru disemai.
  let sortOrder = categories.reduce(
    (max, row) => Math.max(max, row.sortOrder + 1),
    0,
  );

  const createdCategoryNames: string[] = [];
  for (const row of plan.categories) {
    const categoryId = await ctx.db.insert("categories", {
      tenantId: input.tenantId,
      name: row.name,
      sortOrder,
      active: true,
      createdAt: now,
    });
    sortOrder += 1;
    createdCategoryNames.push(row.name);
    categoryIdByName.set(categoryNameKey(row.name), categoryId);
  }

  let createdSubcategoryCount = 0;
  const insertSubcategories = async (
    categoryId: Id<"categories">,
    existingCount: number,
    names: readonly string[],
  ): Promise<void> => {
    let order = existingCount;
    for (const name of names) {
      await ctx.db.insert("subcategories", {
        tenantId: input.tenantId,
        categoryId,
        name,
        sortOrder: order,
        active: true,
        createdAt: now,
      });
      order += 1;
      createdSubcategoryCount += 1;
    }
  };

  for (const row of plan.categories) {
    const categoryId = categoryIdByName.get(categoryNameKey(row.name));
    if (!categoryId) continue;
    await insertSubcategories(categoryId, 0, row.subcategories);
  }

  const subcategoriesPerCategory = new Map<string, number>();
  for (const row of subcategories) {
    const key = row.categoryId;
    subcategoriesPerCategory.set(key, (subcategoriesPerCategory.get(key) ?? 0) + 1);
  }

  for (const row of plan.subcategoriesForExistingCategories) {
    const categoryId = categoryIdByName.get(categoryNameKey(row.name));
    if (!categoryId) continue;
    await insertSubcategories(
      categoryId,
      subcategoriesPerCategory.get(categoryId) ?? 0,
      row.subcategories,
    );
  }

  return {
    createdCategoryNames,
    createdSubcategoryCount,
    skippedCategoryNames: plan.skippedCategoryNames,
    unchanged: false,
  };
}

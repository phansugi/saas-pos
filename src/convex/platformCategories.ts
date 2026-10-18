/**
 * Backstage: pengelolaan **kategori utama bisnis** oleh pemilik platform.
 *
 * Pemilik developer platform bisa membuat, mengubah nama, mengaktifkan/
 * menonaktifkan, dan menghapus kategori maupun subkategorinya dari sini. Dua hal
 * yang membuat permukaan ini sempit dengan sengaja:
 *
 *  - **Gerbangnya `requirePlatformDeveloper`**, bukan izin tenant. Katalog ini
 *    berlaku untuk seluruh deployment, jadi anggota/pemilik tenant mana pun tidak
 *    boleh menyentuhnya — dan akun platform wajib beridentitas login terverifikasi
 *    (lebih ketat daripada gate tenant yang masih longgar selama transisi).
 *  - **Perubahan tidak menulis ulang pilihan yang sudah terkunci.** Workspace
 *    menyimpan salinan label saat mengunci; ganti nama/hapus di sini hanya
 *    memengaruhi pilihan baru. Karena itu tidak ada migrasi data tenant.
 *
 * Semua keputusan sah/tidaknya perubahan dihitung di aturan murni
 * `lib/businessCategory.ts` (`applyBusinessCategoryChange`), termasuk dua pagar
 * yang menjaga produk tetap bisa dipakai: minimal satu kategori aktif, dan setiap
 * kategori aktif wajib punya minimal satu subkategori aktif.
 */
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requirePlatformDeveloper } from "./lib/access";
import {
  activeBusinessCategoryOptions,
  applyBusinessCategoryChange,
  type BusinessCategoryAction,
} from "./lib/businessCategory";
import {
  businessCategoriesAreStored,
  ensureBusinessCategorySeeded,
  readBusinessCategoryRows,
  saveBusinessCategoryRows,
} from "./lib/businessCategoryStore";

/** Bentuk aksi yang diterima dari halaman backstage, satu per satu. */
const businessCategoryActionValidator = v.union(
  v.object({ type: v.literal("createCategory"), label: v.string() }),
  v.object({ type: v.literal("renameCategory"), key: v.string(), label: v.string() }),
  v.object({
    type: v.literal("setCategoryActive"),
    key: v.string(),
    active: v.boolean(),
  }),
  v.object({ type: v.literal("removeCategory"), key: v.string() }),
  v.object({
    type: v.literal("createSubcategory"),
    categoryKey: v.string(),
    label: v.string(),
  }),
  v.object({
    type: v.literal("renameSubcategory"),
    categoryKey: v.string(),
    key: v.string(),
    label: v.string(),
  }),
  v.object({
    type: v.literal("setSubcategoryActive"),
    categoryKey: v.string(),
    key: v.string(),
    active: v.boolean(),
  }),
  v.object({
    type: v.literal("removeSubcategory"),
    categoryKey: v.string(),
    key: v.string(),
  }),
);

/**
 * Daftar lengkap untuk backstage — termasuk yang nonaktif, supaya pemilik
 * platform bisa mengaktifkannya lagi. Tenant hanya menerima yang aktif
 * (`tenants.listBusinessCategories`).
 */
export const list = query({
  args: { actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requirePlatformDeveloper(ctx, args.actorId);
    const seeded = await businessCategoriesAreStored(ctx);
    const categories = await readBusinessCategoryRows(ctx);
    return {
      seeded,
      categories,
      activeOptions: activeBusinessCategoryOptions(categories).length,
      note: seeded
        ? "Katalog ini tersimpan di database dan dipakai seluruh deployment."
        : "Deployment ini masih memakai katalog bawaan. Perubahan pertama Anda akan menyimpan bawaannya sebagai data, tanpa mengubah pilihan yang sudah terkunci.",
    };
  },
});

/**
 * Menjalankan satu perubahan taksonomi.
 *
 * Mengembalikan daftar baris terbaru supaya kartu backstage langsung bisa
 * menggambarnya tanpa menunggu pembacaan ulang; penolakan datang sebagai pesan
 * yang menyebut pagar mana yang dilanggar.
 */
export const apply = mutation({
  args: {
    actorId: v.id("users"),
    action: businessCategoryActionValidator,
  },
  handler: async (ctx, args) => {
    await requirePlatformDeveloper(ctx, args.actorId);
    await ensureBusinessCategorySeeded(ctx);

    const before = await readBusinessCategoryRows(ctx);
    const decision = applyBusinessCategoryChange(
      before,
      args.action as BusinessCategoryAction,
    );
    if (!decision.ok) throw new ConvexError(decision.reason);

    await saveBusinessCategoryRows(ctx, decision.rows);

    return {
      changed: true,
      sentence: decision.sentence,
      categories: decision.rows,
    };
  },
});

/**
 * Akses database untuk taksonomi **kategori utama bisnis**.
 *
 * Aturannya sendiri (validasi label, kunci, pagar minimum) hidup murni di
 * `./businessCategory.ts`; berkas ini hanya menyambungkannya ke tabel
 * `businessCategories`: membaca (dengan bawaan bila deployment belum pernah
 * menulis), menyemai bawaan pada perubahan pertama, dan menyimpan hasil
 * perubahan. Dipisah dari `platformCategories.ts` supaya `tenants.create` /
 * `tenants.setBusinessCategory` bisa membaca katalog yang **sama persis** tanpa
 * ikut mengangkut fungsi publik backstage.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import {
  defaultBusinessCategoryRows,
  type BusinessCategoryRow,
} from "./businessCategory";

type Ctx = QueryCtx | MutationCtx;

function rowOf(doc: Doc<"businessCategories">): BusinessCategoryRow {
  return {
    key: doc.key,
    label: doc.label,
    active: doc.active,
    sortOrder: doc.sortOrder,
    subcategories: doc.subcategories.map((sub) => ({
      key: sub.key,
      label: sub.label,
      active: sub.active,
      sortOrder: sub.sortOrder,
    })),
  };
}

function sortRows(rows: BusinessCategoryRow[]): BusinessCategoryRow[] {
  return rows.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "id-ID"),
  );
}

/**
 * Katalog yang berlaku sekarang.
 *
 * Deployment yang belum pernah mengubah taksonomi belum punya satu baris pun di
 * tabel ini; untuk mereka yang dibaca adalah bawaan kode — persis perilaku
 * sebelum taksonomi bisa dikelola. Setelah perubahan pertama di backstage,
 * bawaannya tersimpan sebagai data dan tabel itu yang menjadi sumbernya.
 */
export async function readBusinessCategoryRows(
  ctx: Ctx,
): Promise<BusinessCategoryRow[]> {
  const docs = await ctx.db.query("businessCategories").collect();
  if (docs.length === 0) return defaultBusinessCategoryRows();
  return sortRows(docs.map(rowOf));
}

/** Apakah tabelnya sudah pernah diisi (bukan lagi memakai bawaan kode). */
export async function businessCategoriesAreStored(ctx: Ctx): Promise<boolean> {
  const first = await ctx.db.query("businessCategories").first();
  return first !== null;
}

/**
 * Menyimpan bawaan ke tabel bila masih kosong.
 *
 * Dipanggil **sebelum** perubahan pertama dari backstage, bukan saat pembacaan:
 * tenant yang hanya memilih kategori (dan halaman yang membacanya) tidak pernah
 * menulis apa pun ke tabel platform.
 */
export async function ensureBusinessCategorySeeded(ctx: MutationCtx): Promise<void> {
  const first = await ctx.db.query("businessCategories").first();
  if (first) return;
  const now = Date.now();
  for (const row of defaultBusinessCategoryRows()) {
    await ctx.db.insert("businessCategories", {
      key: row.key,
      label: row.label,
      active: row.active,
      sortOrder: row.sortOrder,
      subcategories: row.subcategories,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/**
 * Menulis daftar baris hasil perubahan: baris yang hilang dihapus, baris baru
 * ditambahkan, sisanya ditambal. Diff per kunci (bukan hapus-semua-lalu-isi-ulang)
 * supaya id baris tidak berubah-ubah dan riwayat `updatedAt` tetap berarti.
 */
export async function saveBusinessCategoryRows(
  ctx: MutationCtx,
  rows: readonly BusinessCategoryRow[],
): Promise<void> {
  const now = Date.now();
  const existing = await ctx.db.query("businessCategories").collect();
  const byKey = new Map(existing.map((doc) => [doc.key, doc]));
  const keep = new Set(rows.map((row) => row.key));

  for (const doc of existing) {
    if (!keep.has(doc.key)) await ctx.db.delete(doc._id);
  }

  for (const row of rows) {
    const doc = byKey.get(row.key);
    if (!doc) {
      await ctx.db.insert("businessCategories", {
        key: row.key,
        label: row.label,
        active: row.active,
        sortOrder: row.sortOrder,
        subcategories: row.subcategories,
        createdAt: now,
        updatedAt: now,
      });
      continue;
    }
    await ctx.db.patch(doc._id, {
      label: row.label,
      active: row.active,
      sortOrder: row.sortOrder,
      subcategories: row.subcategories,
      updatedAt: now,
    });
  }
}

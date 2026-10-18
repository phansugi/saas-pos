/**
 * Kategori produk — struktur katalog yang diatur peran pengelola (`category.manage`).
 *
 * Kategori bukan sekadar label: namanya menentukan **kode di tengah SKU**
 * (`PBB-<KATEGORI>-<nomor urut>`, lihat lib/productSku.ts) dan menentukan tab
 * filter di POS. Karena itu mengubahnya bukan pekerjaan meja kasir — aturannya
 * ada di sini, dipakai bersama backend (`src/convex/categories.ts`), kedua store,
 * halaman Produk & Stok, dan harness.
 *
 * Empat keputusan yang sengaja diambil:
 *
 * 1. **Nama "Tanpa kategori" tidak boleh dipakai.** Di seluruh aplikasi kalimat
 *    itu berarti “produk ini tidak punya kategori” (tabel Produk, pemilih
 *    kategori, `productSkuCategoryCode`). Kategori dengan nama itu akan membuat
 *    produk tanpa kategori dan produk berkategori itu tidak bisa dibedakan lagi,
 *    jadi namanya ditolak — bukan disimpan lalu ditafsirkan ulang.
 * 2. **Menonaktifkan ≠ menghapus.** Kategori nonaktif hilang dari pemilih
 *    kategori produk (jadi tidak ada produk baru yang masuk ke sana), tetapi
 *    produk yang sudah memakainya tetap dijual, tetap muncul di tab POS, dan
 *    tetap bisa dilihat di tabel Produk (ditandai “nonaktif”). Menonaktifkan juga
 *    selalu bisa dibatalkan.
 * 3. **Hapus kategori melepas produknya** — produknya tidak ikut terhapus, hanya
 *    kehilangan kategorinya (jadi “Tanpa kategori”) dan itu diberitahukan lebih
 *    dulu dengan jumlah yang pasti. SKU-nya **tidak** ditulis ulang: SKU adalah
 *    identitas yang mungkin sudah tercetak di label.
 * 4. **Ganti nama kategori tidak menulis ulang SKU.** SKU produk dibuat sekali
 *    mengikuti kategori saat produk itu dibuat/dipindah; mengganti nama kategori
 *    tidak memindahkan produk mana pun, jadi kode lama di SKU-nya tetap sah
 *    (nomornya tetap unik). Halaman memakai `categorySkuCode` untuk memberi tahu
 *    kode baru yang akan dipakai produk berikutnya, bukan mengklaim SKU lama ikut
 *    berubah.
 */

import { productSkuCategoryCode, PRODUCT_SKU_NO_CATEGORY_LABEL } from "./productSku";

export const CATEGORY_NAME_MIN = 2;
export const CATEGORY_NAME_MAX = 40;

/**
 * Subkategori: satu tingkat katalog **di dalam** kategori, mis.
 * “Semen & Mortar › Semen Portland”.
 *
 * Bedanya dengan kategori sengaja tegas: kategori menentukan kode di tengah SKU
 * dan tab POS, sedangkan subkategori **tidak** menyentuh keduanya — ia bagian
 * katalog yang ikut disinkronkan (API & webhook). Karena itu subkategori punya
 * barisnya sendiri (`subcategories`, induknya `categoryId`) yang **dibuat di bawah
 * kategori** di halaman Produk & Stok, dan produk menunjuk **id**-nya: ganti nama
 * subkategori tidak menulis ulang apa pun, dan hapus subkategori melepas produknya
 * tanpa menghapus produk maupun mengubah SKU-nya.
 */
export const SUBCATEGORY_NAME_MIN = 2;
export const SUBCATEGORY_NAME_MAX = 40;

/** Batas jumlah subkategori per kategori, supaya pemilihnya tetap bisa dibaca. */
export const MAX_SUBCATEGORIES_PER_CATEGORY = 50;

/** Batas jumlah kategori per workspace, supaya pemilihnya tetap bisa dibaca. */
export const MAX_CATEGORIES_PER_TENANT = 100;

/** Label yang dipakai aplikasi untuk “produk tanpa kategori”. */
export const CATEGORY_NO_CATEGORY_LABEL = "Tanpa kategori";

export interface CategoryLike {
  name: string;
  /** Baris lama (sebelum ada kolom `active`) tidak punya nilai ini. */
  active?: boolean | null;
}

export interface CategoryInput {
  name: string;
  active?: boolean;
}

export type CategoryValidation =
  | { ok: true; value: { name: string; active: boolean } }
  | { ok: false; reason: string };

/**
 * Rapikan nama kategori: buang spasi pinggir dan rapatkan spasi tengah, sehingga
 * “Kopi  Susu” dan “Kopi Susu” tidak hidup sebagai dua kategori berbeda.
 */
export function normalizeCategoryName(raw: string): string {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Kunci pembanding nama kategori: huruf & angka saja, huruf besar. Dipakai untuk
 * mendeteksi duplikat (“Kopi Susu” vs “kopi susu”) **dan** nama terlarang, tanpa
 * membuat aturan kedua yang bisa menyimpang.
 */
export function categoryNameKey(raw: string): string {
  return normalizeCategoryName(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Benar untuk nama yang berarti “tidak ada kategori” di aplikasi ini. */
export function isReservedCategoryName(raw: string): boolean {
  const key = categoryNameKey(raw);
  return key.length === 0 || key === PRODUCT_SKU_NO_CATEGORY_LABEL;
}

/** Kode tiga huruf kategori di dalam SKU (`Sanitasi` → `SAN`). */
export function categorySkuCode(name: string): string {
  return productSkuCategoryCode(name);
}

/**
 * Rapikan nama subkategori dengan aturan spasi yang sama seperti kategori, supaya
 * “Semen  Portland” dan “Semen Portland” tidak hidup sebagai dua label berbeda.
 */
export function normalizeSubcategoryName(raw: string): string {
  return normalizeCategoryName(raw);
}

export interface SubcategoryLike {
  name: string;
  categoryId?: string | null;
  /** Baris lama (sebelum ada kolom `active`) tidak punya nilai ini. */
  active?: boolean | null;
}

export interface SubcategoryInput {
  name: string;
  active?: boolean;
}

export type SubcategoryValidation =
  | { ok: true; value: { name: string; active: boolean } }
  | { ok: false; reason: string };

/** Kunci pembanding nama subkategori — aturannya sama dengan nama kategori. */
export function subcategoryNameKey(raw: string): string {
  return categoryNameKey(raw);
}

/**
 * Validasi nama subkategori yang **dibuat di bawah sebuah kategori**.
 *
 * Aturannya sama bentuknya dengan nama kategori (2–40 karakter, tanpa duplikat di
 * kategori yang sama, “Tanpa kategori” terlarang) supaya kedua pemilih di halaman
 * terasa satu sistem. Duplikatnya diperiksa **per kategori** — “Lainnya” di dua
 * kategori berbeda adalah dua subkategori yang memang berbeda.
 */
export function validateSubcategoryName(
  input: SubcategoryInput,
  options: { existingNames?: readonly string[]; count?: number } = {},
): SubcategoryValidation {
  const name = normalizeSubcategoryName(input.name ?? "");
  if (name.length < SUBCATEGORY_NAME_MIN || name.length > SUBCATEGORY_NAME_MAX) {
    return {
      ok: false,
      reason: `Nama subkategori harus ${SUBCATEGORY_NAME_MIN}–${SUBCATEGORY_NAME_MAX} karakter.`,
    };
  }
  if (isReservedCategoryName(name)) {
    return {
      ok: false,
      reason: `"${CATEGORY_NO_CATEGORY_LABEL}" dipakai sistem untuk produk tanpa kategori; pakai nama subkategori lain.`,
    };
  }

  const key = subcategoryNameKey(name);
  const duplicate = (options.existingNames ?? []).some(
    (existing) => subcategoryNameKey(existing) === key,
  );
  if (duplicate) {
    return { ok: false, reason: `Subkategori "${name}" sudah ada di kategori ini.` };
  }

  if (options.count !== undefined && options.count >= MAX_SUBCATEGORIES_PER_CATEGORY) {
    return {
      ok: false,
      reason: `Maksimal ${MAX_SUBCATEGORIES_PER_CATEGORY} subkategori per kategori.`,
    };
  }

  return { ok: true, value: { name, active: input.active ?? true } };
}

/** Baris subkategori dianggap aktif kecuali ditandai nonaktif (baris lama). */
export function subcategoryIsActive(row: SubcategoryLike): boolean {
  return row.active !== false;
}

/**
 * Subkategori yang boleh dipilih untuk sebuah produk: milik kategori itu yang
 * **aktif**, ditambah subkategori yang sedang dipakai produk ini walau sudah
 * nonaktif — kalau tidak, membuka “Atur harga” akan tampak seperti memindahkan
 * produknya.
 */
export function selectableSubcategoryNames(
  rows: readonly SubcategoryLike[],
  /** Kategori induk; kosong (produk tanpa kategori) berarti tidak ada pilihan. */
  categoryId: string | undefined | null,
  currentName?: string | null,
): string[] {
  const names = categoryId
    ? rows
        .filter((row) => row.categoryId === categoryId && subcategoryIsActive(row))
        .map((row) => row.name)
    : [];
  const current = normalizeSubcategoryName(currentName ?? "");
  if (
    current.length > 0 &&
    !names.some((name) => subcategoryNameKey(name) === subcategoryNameKey(current))
  ) {
    names.push(current);
  }
  return names;
}

/** Jumlah produk yang sekarang memakai sebuah subkategori (pembanding id). */
export function countProductsInSubcategory(
  subcategoryId: string,
  products: readonly { subcategoryId?: string | null }[],
): number {
  return products.filter((product) => product.subcategoryId === subcategoryId).length;
}

/** Kalimat dampak sebelum subkategori dihapus — jumlahnya pasti. */
export function deleteSubcategorySentence(name: string, productCount: number): string {
  if (productCount === 0) {
    return `Subkategori "${name}" tidak dipakai produk mana pun, jadi menghapusnya tidak mengubah katalog.`;
  }
  return `Subkategori "${name}" masih dipakai ${productCount} produk. Menghapusnya tidak menghapus produknya: ${productCount} produk itu kehilangan subkategorinya (kategorinya tetap).`;
}

/** Benar kalau ganti nama kategori ikut mengubah kode di SKU produk berikutnya. */
export function renamesSkuCode(previousName: string, nextName: string): boolean {
  return categorySkuCode(previousName) !== categorySkuCode(nextName);
}

/** Baris kategori dianggap aktif kecuali ditandai nonaktif (baris lama). */
export function categoryIsActive(row: CategoryLike): boolean {
  return row.active !== false;
}

/**
 * Validasi satu kategori. `existingNames` memuat nama kategori lain di tenant ini
 * (kecualikan kategori yang sedang diubah — itu tugas pemanggil), dan `count`
 * hanya perlu diisi saat **menambah**, karena batas jumlah tidak boleh menahan
 * perbaikan nama kategori yang sudah ada.
 */
export function validateCategoryName(
  input: CategoryInput,
  options: { existingNames?: readonly string[]; count?: number } = {},
): CategoryValidation {
  const name = normalizeCategoryName(input.name ?? "");
  if (name.length < CATEGORY_NAME_MIN || name.length > CATEGORY_NAME_MAX) {
    return {
      ok: false,
      reason: `Nama kategori harus ${CATEGORY_NAME_MIN}–${CATEGORY_NAME_MAX} karakter.`,
    };
  }
  if (isReservedCategoryName(name)) {
    return {
      ok: false,
      reason: `"${CATEGORY_NO_CATEGORY_LABEL}" dipakai sistem untuk produk tanpa kategori; pakai nama lain.`,
    };
  }

  const key = categoryNameKey(name);
  const duplicate = (options.existingNames ?? []).some(
    (existing) => categoryNameKey(existing) === key,
  );
  if (duplicate) {
    return { ok: false, reason: `Kategori "${name}" sudah ada di workspace ini.` };
  }

  if (options.count !== undefined && options.count >= MAX_CATEGORIES_PER_TENANT) {
    return {
      ok: false,
      reason: `Maksimal ${MAX_CATEGORIES_PER_TENANT} kategori per workspace.`,
    };
  }

  return { ok: true, value: { name, active: input.active ?? true } };
}

/** Jumlah produk yang sekarang memakai sebuah kategori (pembanding huruf besar). */
export function countProductsInCategory(
  categoryName: string,
  products: readonly { category: string }[],
): number {
  const key = categoryNameKey(categoryName);
  return products.filter((product) => categoryNameKey(product.category) === key).length;
}

/**
 * Kategori yang boleh dipilih untuk sebuah produk: yang **aktif**, ditambah
 * kategori produk itu sendiri walau sudah nonaktif — kalau tidak, membuka “Atur
 * harga” pada produk di kategori lama akan tampak seperti memindahkan produknya.
 */
export function selectableCategoryNames(
  categories: readonly CategoryLike[],
  currentName?: string | null,
): string[] {
  const names = categories.filter(categoryIsActive).map((row) => row.name);
  const current = normalizeCategoryName(currentName ?? "");
  if (current.length > 0 && !names.some((name) => categoryNameKey(name) === categoryNameKey(current))) {
    names.push(current);
  }
  return names;
}

/**
 * Tab kategori di POS: kategori aktif, ditambah kategori nonaktif yang **masih
 * dipakai** produk — produk yang sudah terjual di kategori lama tidak boleh
 * kehilangan tabnya hanya karena kategorinya dinonaktifkan.
 */
export function posCategoryChips(
  categories: readonly CategoryLike[],
  usedCategoryNames: readonly string[],
): string[] {
  const chips = categories.filter(categoryIsActive).map((row) => row.name);
  const shown = new Set(chips.map((row) => categoryNameKey(row)));
  for (const used of usedCategoryNames) {
    const name = normalizeCategoryName(used);
    if (name.length === 0) continue;
    const key = categoryNameKey(name);
    if (shown.has(key)) continue;
    shown.add(key);
    chips.push(name);
  }
  return chips;
}

/**
 * Kode SKU yang dipakai lebih dari satu kategori (mis. “Makanan” & “Makmur” sama-
 * sama `MAK`). Bukan larangan — SKU tetap unik karena nomornya per tenant — tetapi
 * layak diberitahukan: orang membaca kode tengah SKU sebagai nama kategori.
 */
export function duplicateCategoryCodes(
  categories: readonly CategoryLike[],
): { code: string; names: string[] }[] {
  const byCode = new Map<string, string[]>();
  for (const row of categories) {
    const code = categorySkuCode(row.name);
    byCode.set(code, [...(byCode.get(code) ?? []), row.name]);
  }
  return [...byCode.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([code, names]) => ({ code, names }));
}

/**
 * Kalimat dampak sebelum kategori dihapus — jumlahnya pasti, bukan “beberapa”.
 * `subcategoryCount` menyebut subkategori di dalamnya yang ikut terhapus, supaya
 * akibatnya terlihat sebelum tombolnya ditekan (produknya tetap, hanya kehilangan
 * kategori & subkategorinya).
 */
export function deleteCategorySentence(
  name: string,
  productCount: number,
  subcategoryCount = 0,
): string {
  const subSentence =
    subcategoryCount > 0
      ? ` ${subcategoryCount} subkategori di bawahnya juga ikut terhapus, dan produk yang memakainya kehilangan subkategorinya.`
      : "";
  if (productCount === 0) {
    return `Kategori "${name}" tidak dipakai produk mana pun, jadi menghapusnya tidak mengubah katalog.${subSentence}`;
  }
  return `Kategori "${name}" masih dipakai ${productCount} produk. Menghapusnya tidak menghapus produknya: ${productCount} produk itu menjadi “${CATEGORY_NO_CATEGORY_LABEL}”, dan SKU-nya tidak ditulis ulang.${subSentence}`;
}

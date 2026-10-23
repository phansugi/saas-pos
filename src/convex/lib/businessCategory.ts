/**
 * Kategori utama bisnis — taksonomi tetap MesinPOS dan aturan **penguncian
 * permanen**.
 *
 * Pemilik bisnis memilih satu kategori utama beserta satu subkategorinya sekali.
 * Setelah tersimpan, pilihan itu tidak bisa diubah, dikosongkan, atau diganti
 * oleh siapa pun lewat jalur aplikasi: kategori tersebut menjadi identitas bisnis
 * di seluruh sistem. Karena itu aturannya hidup di satu modul murni yang dipakai
 * backend (`tenants.setBusinessCategory`), kedua store (demo & Convex), halaman
 * onboarding, halaman Profil, dan harness — bukan disalin ke masing-masing.
 *
 * Kenapa taksonominya **tetap** (bukan teks bebas): pilihan yang dikunci
 * selamanya harus bisa dibandingkan dan dilaporkan. Teks bebas membuat “Kafe”,
 * “kafe”, dan “Coffee Shop” menjadi tiga kategori berbeda yang tidak bisa
 * dirapikan lagi setelah terkunci.
 *
 * Modul aplikasi (UMKM/F&B/Grosir) tetap pilihan terpisah: kategori utama
 * menjawab “bisnis ini apa”, sedangkan modul menjawab “fitur apa yang dipakai”.
 * `suggestedVerticalFor` hanya menawarkan modul yang paling masuk akal saat
 * kategori dipilih — bukan memaksanya.
 */
import type { Vertical } from "./billing";

export interface BusinessSubcategory {
  /** Kunci stabil yang disimpan di database; label boleh berubah tanpa migrasi. */
  key: string;
  label: string;
  /** `false` = tidak ditawarkan lagi ke pemilih baru; kosong = aktif. */
  active?: boolean;
}

/** Satu subkategori yang **tersimpan** di tabel `businessCategories`. */
export interface BusinessSubcategoryRow {
  key: string;
  label: string;
  active: boolean;
  sortOrder: number;
}

/** Satu kategori utama yang **tersimpan** di tabel `businessCategories`. */
export interface BusinessCategoryRow {
  key: string;
  label: string;
  active: boolean;
  sortOrder: number;
  subcategories: BusinessSubcategoryRow[];
}

/**
 * Katalog yang dipakai untuk memilih (daftar baris yang **aktif** saja).
 *
 * Bentuknya sengaja lebih ringkas daripada baris database: pemilih tidak butuh
 * status/tombol admin, dan katalog ini juga yang dikirim ke klien.
 */
export interface BusinessCategoryOption {
  key: string;
  label: string;
  subcategories: { key: string; label: string }[];
}

export interface BusinessCategoryDefinition {
  key: string;
  label: string;
  subcategories: readonly BusinessSubcategory[];
}

/**
 * Daftar kategori utama & subkategorinya.
 *
 * “Lainnya” sengaja ada sebagai jalan keluar yang jujur: bisnis yang tidak masuk
 * lima kategori pertama tetap bisa memakai MesinPOS tanpa memilih kategori yang
 * salah — dan tanpa membuka pintu teks bebas yang tidak bisa dilaporkan.
 */
export const BUSINESS_CATEGORIES: readonly BusinessCategoryDefinition[] = [
  {
    key: "retail",
    label: "Perdagangan Eceran",
    subcategories: [
      { key: "minimarket", label: "Minimarket & Kelontong" },
      { key: "bangunan", label: "Toko Bangunan & Material" },
      { key: "fashion", label: "Pakaian & Aksesori" },
      { key: "elektronik", label: "Elektronik & Gadget" },
      { key: "apotek", label: "Apotek & Kesehatan" },
      { key: "buah-sayur", label: "Buah & Sayur" },
    ],
  },
  {
    key: "fnb",
    label: "Makanan & Minuman",
    subcategories: [
      { key: "kafe", label: "Kafe & Kedai Kopi" },
      { key: "restoran", label: "Restoran" },
      { key: "warung", label: "Warung & Rumah Makan" },
      { key: "bakery", label: "Bakery & Kue" },
      { key: "katering", label: "Katering" },
    ],
  },
  {
    key: "wholesale",
    label: "Perdagangan Besar & Distribusi",
    subcategories: [
      { key: "distributor-bangunan", label: "Distributor Bahan Bangunan" },
      { key: "distributor-sembako", label: "Distributor Sembako" },
      { key: "grosir-fashion", label: "Grosir Pakaian" },
      { key: "distributor-elektronik", label: "Distributor Elektronik" },
    ],
  },
  {
    key: "service",
    label: "Jasa & Layanan",
    subcategories: [
      { key: "laundry", label: "Laundry" },
      { key: "salon", label: "Salon & Barbershop" },
      { key: "bengkel", label: "Bengkel & Servis" },
      { key: "percetakan", label: "Jasa Percetakan" },
      { key: "rental", label: "Rental & Penyewaan" },
    ],
  },
  {
    key: "production",
    label: "Produksi & Kerajinan",
    subcategories: [
      { key: "makanan-olahan", label: "Makanan Olahan" },
      { key: "konveksi", label: "Fashion & Konveksi" },
      { key: "furnitur", label: "Furnitur & Kayu" },
      { key: "kerajinan", label: "Kerajinan Tangan" },
    ],
  },
  {
    key: "other",
    label: "Lainnya",
    subcategories: [
      { key: "usaha-umum", label: "Usaha Umum" },
      { key: "belum-termasuk", label: "Belum Termasuk Kategori Lain" },
    ],
  },
] as const;

/** Jumlah kategori utama yang disediakan MesinPOS. */
export const BUSINESS_CATEGORY_COUNT = BUSINESS_CATEGORIES.length;

/** Pesan tetap untuk setiap percobaan mengubah pilihan yang sudah terkunci. */
export const BUSINESS_CATEGORY_LOCKED_NOTE =
  "Kategori utama bisnis sudah dikunci permanen dan tidak bisa diubah lagi.";

export interface BusinessCategoryChoice {
  category: string;
  subcategory: string;
}

/**
 * Nilai yang **tersimpan** setelah dikunci. Label ikut disimpan sebagai salinan
 * saat penguncian, sehingga laporan lama tetap terbaca walau taksonomi kelak
 * diperluas; kuncinya yang dipakai untuk mencocokkan.
 */
export interface LockedBusinessCategory {
  category: string;
  categoryLabel: string;
  subcategory: string;
  subcategoryLabel: string;
  /** Milidetik epoch saat pilihan pertama kali dikunci. */
  lockedAt: number;
  /** Id pengguna pemilik yang mengunci (di mode demo: email pemilik). */
  lockedBy: string;
}

export type BusinessCategoryDecision =
  | { ok: true; value: BusinessCategoryChoice }
  | { ok: false; reason: string };

function normalizeKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeLabel(value: unknown): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toLowerCase()
    : "";
}

/** Katalog bawaan, dipakai bila pemanggil tidak menyebut katalog tersimpan. */
export function businessCategoryDefinition(
  key: unknown,
  catalog: readonly BusinessCategoryDefinition[] = BUSINESS_CATEGORIES,
): BusinessCategoryDefinition | null {
  const wanted = normalizeKey(key);
  if (!wanted) return null;
  const byKey = catalog.find((row) => row.key === wanted);
  if (byKey) return byKey;
  const label = normalizeLabel(key);
  return catalog.find((row) => normalizeLabel(row.label) === label) ?? null;
}

export function businessSubcategoryDefinition(
  categoryKey: unknown,
  subcategoryKey: unknown,
  catalog: readonly BusinessCategoryDefinition[] = BUSINESS_CATEGORIES,
): BusinessSubcategory | null {
  const category = businessCategoryDefinition(categoryKey, catalog);
  if (!category) return null;
  const wanted = normalizeKey(subcategoryKey);
  if (!wanted) return null;
  const byKey = category.subcategories.find((row) => row.key === wanted);
  if (byKey) return byKey;
  const label = normalizeLabel(subcategoryKey);
  return category.subcategories.find((row) => normalizeLabel(row.label) === label) ?? null;
}

/** Apakah katalog (bawaan atau tersimpan) menandai baris ini nonaktif. */
export function catalogRowIsActive(
  row: { active?: boolean } | BusinessCategoryDefinition,
): boolean {
  return (row as { active?: boolean }).active !== false;
}

/**
 * Mencari kategori dari **kunci atau labelnya**. Halaman mengirim kunci, tetapi
 * pemanggil langsung (mis. integrasi internal) boleh mengirim label yang dibaca
 * pengguna; keduanya dipetakan ke kunci kanonik supaya yang tersimpan selalu
 * bentuk yang sama.
 */
function resolveCategory(
  value: unknown,
  catalog: readonly BusinessCategoryDefinition[],
): BusinessCategoryDefinition | null {
  return businessCategoryDefinition(value, catalog);
}

function resolveSubcategory(
  category: BusinessCategoryDefinition,
  value: unknown,
): BusinessSubcategory | null {
  return businessSubcategoryDefinition(category.key, value, [category]);
}

/**
 * Memvalidasi pilihan pemilik. Kategori dan subkategori **wajib keduanya**: yang
 * dikunci adalah pasangannya, bukan kategori tanpa keterangan.
 */
export function validateBusinessCategory(
  input: {
    category?: unknown;
    subcategory?: unknown;
  },
  catalog: readonly BusinessCategoryDefinition[] = BUSINESS_CATEGORIES,
): BusinessCategoryDecision {
  const rawCategory = input.category;
  if (normalizeKey(rawCategory) === "") {
    return {
      ok: false,
      reason: "Pilih kategori utama bisnis lebih dulu — pilihan ini akan dikunci permanen.",
    };
  }

  const category = resolveCategory(rawCategory, catalog);
  if (!category) {
    return {
      ok: false,
      reason: `Kategori utama “${String(rawCategory).trim()}” tidak disediakan MesinPOS. Pilih dari daftar kategori yang ada.`,
    };
  }
  if (!catalogRowIsActive(category)) {
    return {
      ok: false,
      reason: `Kategori utama “${category.label}” sedang dinonaktifkan di MesinPOS. Pilih kategori lain.`,
    };
  }

  const rawSubcategory = input.subcategory;
  if (normalizeKey(rawSubcategory) === "") {
    return {
      ok: false,
      reason: `Pilih subkategori untuk kategori ${category.label} — pilihan ini juga ikut dikunci.`,
    };
  }

  const subcategory = resolveSubcategory(category, rawSubcategory);
  if (!subcategory) {
    return {
      ok: false,
      reason: `Subkategori “${String(rawSubcategory).trim()}” bukan bagian dari kategori ${category.label}.`,
    };
  }
  if (!catalogRowIsActive(subcategory)) {
    return {
      ok: false,
      reason: `Subkategori “${subcategory.label}” sedang dinonaktifkan di MesinPOS. Pilih subkategori lain.`,
    };
  }

  return {
    ok: true,
    value: { category: category.key, subcategory: subcategory.key },
  };
}

/**
 * Membaca kolom `tenants.businessCategory` apa adanya.
 *
 * Nilai yang **sudah terkunci** dibaca dari barisnya sendiri, bukan dicocokkan
 * ulang ke taksonomi: kategori di backstage bisa diganti nama, dinonaktifkan,
 * bahkan dihapus, dan workspace yang sudah mengunci pilihan tidak boleh mendadak
 * kehilangan identitasnya. Label yang tersimpan dipakai apa adanya; kalau baris
 * lama belum memuat label, label bawaan/ kunci-nya yang dipakai sebagai cadangan.
 *
 * Bentuk yang benar-benar rusak (kategori atau subkategori kosong) dibaca
 * `null` — pemanggil yang menulis wajib memeriksa kolom mentahnya supaya data
 * rusak tidak diam-diam bisa diganti.
 */
export function businessCategoryOf(
  row:
    | {
        businessCategory?:
          | (Partial<LockedBusinessCategory> & { category?: string; subcategory?: string })
          | null;
      }
    | null
    | undefined,
): LockedBusinessCategory | null {
  const value = row?.businessCategory;
  if (!value) return null;
  const categoryKey = normalizeKey(value.category);
  const subcategoryKey = normalizeKey(value.subcategory);
  if (!categoryKey || !subcategoryKey) return null;
  // Cadangan label hanya dipakai kalau barisnya memang belum memuat label:
  // kunci yang tidak lagi ada di taksonomi tetap tidak menghapus pilihan.
  const category = businessCategoryDefinition(categoryKey);
  const subcategory = category
    ? resolveSubcategory(category, subcategoryKey)
    : null;
  return {
    category: categoryKey,
    categoryLabel:
      typeof value.categoryLabel === "string" && value.categoryLabel.trim()
        ? value.categoryLabel.trim()
        : (category?.label ?? categoryKey),
    subcategory: subcategoryKey,
    subcategoryLabel:
      typeof value.subcategoryLabel === "string" && value.subcategoryLabel.trim()
        ? value.subcategoryLabel.trim()
        : (subcategory?.label ?? subcategoryKey),
    lockedAt:
      typeof value.lockedAt === "number" && Number.isFinite(value.lockedAt)
        ? value.lockedAt
        : 0,
    lockedBy: typeof value.lockedBy === "string" ? value.lockedBy : "",
  };
}

export function sameBusinessCategory(
  a: LockedBusinessCategory | null,
  b: LockedBusinessCategory | null,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.category === b.category &&
    a.subcategory === b.subcategory &&
    a.lockedAt === b.lockedAt &&
    a.lockedBy === b.lockedBy
  );
}

export type BusinessCategoryLockDecision =
  | { ok: true; value: LockedBusinessCategory; changed: boolean }
  | { ok: false; reason: string };

/**
 * Memutuskan hasil penyimpanan.
 *
 * - Pilihan pertama → tersimpan, `changed: true`.
 * - Pilihan **sama persis** → tidak menulis apa pun, `changed: false` (memanggil
 *   ulang tombol yang sama tidak dihitung sebagai perubahan).
 * - Pilihan berbeda / pengosongan → ditolak; inilah arti “selamanya”.
 */
export function lockBusinessCategory(input: {
  current: LockedBusinessCategory | null;
  choice: BusinessCategoryChoice;
  actorId: string;
  now?: number;
  /** Katalog tersimpan dari backstage; bawaan dipakai bila tidak disebut. */
  catalog?: readonly BusinessCategoryDefinition[];
}): BusinessCategoryLockDecision {
  const catalog = input.catalog ?? BUSINESS_CATEGORIES;
  const decision = validateBusinessCategory(input.choice, catalog);
  if (!decision.ok) return decision;

  const category = businessCategoryDefinition(decision.value.category, catalog);
  const subcategory = businessSubcategoryDefinition(
    decision.value.category,
    decision.value.subcategory,
    catalog,
  );
  if (!category || !subcategory) {
    return { ok: false, reason: "Kategori utama bisnis tidak dikenal." };
  }

  if (input.current) {
    const same =
      input.current.category === category.key &&
      input.current.subcategory === subcategory.key;
    if (same) return { ok: true, value: input.current, changed: false };
    return {
      ok: false,
      reason: `Kategori utama bisnis sudah dikunci sebagai ${input.current.categoryLabel} — ${input.current.subcategoryLabel} dan tidak bisa diubah lagi, termasuk oleh pemilik.`,
    };
  }

  return {
    ok: true,
    changed: true,
    value: {
      category: category.key,
      categoryLabel: category.label,
      subcategory: subcategory.key,
      subcategoryLabel: subcategory.label,
      lockedAt: input.now ?? Date.now(),
      lockedBy: input.actorId,
    },
  };
}

/** Kalimat notis setelah pilihan tersimpan / saat sudah terkunci. */
export function businessCategorySentence(
  value: LockedBusinessCategory | null,
): string {
  if (!value) {
    return "Kategori utama bisnis belum dipilih. Pilih sekali, lalu MesinPOS menguncinya permanen.";
  }
  return `Kategori utama bisnis: ${value.categoryLabel} — ${value.subcategoryLabel}. ${BUSINESS_CATEGORY_LOCKED_NOTE}`;
}

/** Pilihan yang ditampilkan sebagai pratinjau sebelum dikunci. */
export function businessCategoryChoiceOf(
  categoryKey: unknown,
  subcategoryKey: unknown,
  catalog: readonly BusinessCategoryDefinition[] = BUSINESS_CATEGORIES,
): BusinessCategoryChoice | null {
  const category = businessCategoryDefinition(categoryKey, catalog);
  if (!category) return null;
  const subcategory = businessSubcategoryDefinition(
    category.key,
    subcategoryKey,
    catalog,
  );
  if (!subcategory) return null;
  return { category: category.key, subcategory: subcategory.key };
}

/**
 * Apakah pilihan bisnis ini masuk akal memakai **layanan meja & dapur** — fitur
 * modul F&B (`pos.table`, `pos.kds`, `pos.modifier`).
 *
 * Kenapa ada: modul boleh dinyalakan pemilik kapan saja (dan paket Enterprise
 * memuat semuanya), jadi gerbang “modul + paket” saja masih menampilkan denah
 * meja, antrean dapur, dan modifier kepada toko bangunan. Yang menjawab “apakah
 * bisnis ini memang seperti itu” adalah kategori yang **sudah dikunci** pemilik
 * saat onboarding — dan itu yang dipakai di sini, di satu tempat, supaya halaman
 * Kasir, sidebar, dan harness tidak pernah menjawab berbeda.
 *
 * Jawabannya sengaja **tidak** mematikan apa pun untuk pilihan yang tidak bisa
 * dipastikan: “Lainnya”, kategori bisnis baru buatan backstage, dan workspace
 * lama tanpa kategori tetap `true` — di situ modul yang menjadi penentu, persis
 * seperti perilaku lamanya. Yang benar-benar berbeda hanya bisnis yang jelas
 * bukan layanan meja: eceran (kecuali… tidak ada pengecualian), grosir, jasa,
 * dan produksi.
 */
export function businessUsesTableService(input: {
  category?: string | null;
  subcategory?: string | null;
}): boolean {
  const category = normalizeKey(input.category);
  if (!category) return true;
  if (category === "fnb" || category === "other") return true;
  return !["retail", "wholesale", "service", "production"].includes(category);
}

/**
 * Modul yang paling masuk akal untuk sebuah kategori utama. Hanya **saran** saat
 * kategori dipilih di onboarding; pemilik tetap boleh memilih modul lain.
 */
export function suggestedVerticalFor(categoryKey: unknown): Vertical {
  const category = businessCategoryDefinition(categoryKey);
  switch (category?.key) {
    case "fnb":
      return "fnb";
    case "wholesale":
      return "wholesale";
    default:
      return "umkm";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Pengelolaan taksonomi oleh pemilik platform (backstage)
//
//  Kategori & subkategori bisa dibuat, diubah namanya, diaktifkan/nonaktifkan,
//  dan dihapus oleh akun platform. Semua aturannya di bawah ini murni: Convex
//  hanya membaca/menulis baris tabel `businessCategories`, sedangkan keputusan
//  “perubahan ini sah atau tidak” selalu dihitung di sini supaya backstage,
//  backend, dan harness tidak pernah berbeda jawaban.
//
//  Dua pagar yang sengaja dipasang, bukan sekadar tampilan:
//
//   1. **Minimal satu kategori aktif** harus selalu ada — kalau tidak, pemilik
//      baru tidak punya pilihan apa pun saat onboarding dan terkunci selamanya
//      tanpa identitas.
//   2. **Kategori aktif wajib punya minimal satu subkategori aktif** — kategori
//      yang aktif tetapi tidak bisa dipilih hanya menyesatkan pemilih.
//
//  Perubahan taksonomi **tidak** menulis ulang nilai yang sudah terkunci:
//  workspace menyimpan salinan label saat mengunci, jadi ganti nama/hapus di
//  sini tidak mengubah identitas bisnis yang sudah berdiri.
// ═══════════════════════════════════════════════════════════════════════════

/** Batas jumlah kategori utama yang boleh disediakan MesinPOS. */
export const MAX_BUSINESS_CATEGORIES = 40;

/** Batas jumlah subkategori per kategori. */
export const MAX_BUSINESS_SUBCATEGORIES = 12;

/** Panjang label kategori/subkategori yang diterima. */
export const BUSINESS_LABEL_MIN = 2;
export const BUSINESS_LABEL_MAX = 40;

/** Katalog bawaan dalam bentuk baris tabel (aktif semua, urut sesuai daftar). */
export function defaultBusinessCategoryRows(): BusinessCategoryRow[] {
  return BUSINESS_CATEGORIES.map((row, index) => ({
    key: row.key,
    label: row.label,
    active: true,
    sortOrder: index,
    subcategories: row.subcategories.map((sub, subIndex) => ({
      key: sub.key,
      label: sub.label,
      active: true,
      sortOrder: subIndex,
    })),
  }));
}

/**
 * Katalog yang ditawarkan ke pemilih (onboarding & halaman Profil): hanya baris
 * aktif, subkategori nonaktif dibuang, urut sesuai `sortOrder`.
 */
export function activeBusinessCategoryOptions(
  rows: readonly BusinessCategoryRow[],
): BusinessCategoryOption[] {
  return [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "id-ID"))
    .filter((row) => row.active)
    .map((row) => ({
      key: row.key,
      label: row.label,
      subcategories: [...row.subcategories]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "id-ID"))
        .filter((sub) => sub.active)
        .map((sub) => ({ key: sub.key, label: sub.label })),
    }))
    .filter((row) => row.subcategories.length > 0);
}

/** Label dirapikan: spasi pinggir dibuang, spasi ganda jadi satu. */
export function normalizeBusinessLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/**
 * Kunci stabil dari label: huruf kecil, angka, dan tanda hubung. Dipakai untuk
 * baris baru supaya kategori buatan backstage tetap bisa dipakai di API & audit.
 * Kalau kuncinya sudah dipakai, ditambahkan `-2`, `-3`, …
 */
export function businessCategoryKeyFromLabel(
  label: unknown,
  takenKeys: readonly string[] = [],
): string {
  const base =
    normalizeBusinessLabel(label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "kategori";
  const taken = new Set(takenKeys.map((key) => normalizeKey(key)));
  if (!taken.has(base)) return base;
  for (let attempt = 2; attempt <= 100; attempt += 1) {
    const candidate = `${base}-${attempt}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export type BusinessLabelDecision =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/** Validasi satu label kategori/subkategori (panjang, isi, dan nama kembar). */
export function validateBusinessLabel(input: {
  label: unknown;
  existingLabels?: readonly string[];
  count?: number;
  max?: number;
  kind: "kategori" | "subkategori";
}): BusinessLabelDecision {
  const label = normalizeBusinessLabel(input.label);
  if (label.length < BUSINESS_LABEL_MIN || label.length > BUSINESS_LABEL_MAX) {
    return {
      ok: false,
      reason: `Nama ${input.kind} harus ${BUSINESS_LABEL_MIN}–${BUSINESS_LABEL_MAX} karakter.`,
    };
  }
  if (!/[\p{L}\p{N}]/u.test(label)) {
    return {
      ok: false,
      reason: `Nama ${input.kind} harus memuat huruf atau angka.`,
    };
  }
  const max = input.max ?? MAX_BUSINESS_CATEGORIES;
  if (input.count !== undefined && input.count >= max) {
    return {
      ok: false,
      reason: `Maksimal ${max} ${input.kind} — hapus atau nonaktifkan yang lain lebih dulu.`,
    };
  }
  const wanted = normalizeLabel(label);
  if ((input.existingLabels ?? []).some((row) => normalizeLabel(row) === wanted)) {
    return {
      ok: false,
      reason: `Nama ${input.kind} “${label}” sudah ada. Pilih nama lain.`,
    };
  }
  return { ok: true, value: label };
}

/** Satu perubahan taksonomi dari backstage. */
export type BusinessCategoryAction =
  | { type: "createCategory"; label: string }
  | { type: "renameCategory"; key: string; label: string }
  | { type: "setCategoryActive"; key: string; active: boolean }
  | { type: "removeCategory"; key: string }
  | { type: "createSubcategory"; categoryKey: string; label: string }
  | { type: "renameSubcategory"; categoryKey: string; key: string; label: string }
  | { type: "setSubcategoryActive"; categoryKey: string; key: string; active: boolean }
  | { type: "removeSubcategory"; categoryKey: string; key: string };

export type BusinessCategoryChangeDecision =
  | { ok: true; rows: BusinessCategoryRow[]; sentence: string }
  | { ok: false; reason: string };

function sortedRows(rows: readonly BusinessCategoryRow[]): BusinessCategoryRow[] {
  return [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "id-ID"))
    .map((row) => ({
      ...row,
      subcategories: [...row.subcategories].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "id-ID"),
      ),
    }));
}

function findCategoryRow(
  rows: readonly BusinessCategoryRow[],
  key: unknown,
): BusinessCategoryRow | null {
  const wanted = normalizeKey(key);
  if (!wanted) return null;
  return rows.find((row) => row.key === wanted) ?? null;
}

function categoryInvariantReason(rows: readonly BusinessCategoryRow[]): string | null {
  const active = rows.filter((row) => row.active);
  if (active.length === 0) {
    return "Minimal satu kategori aktif harus tersedia supaya pemilik baru bisa memilih kategori utamanya — aktifkan atau tambahkan kategori lain lebih dulu.";
  }
  const kosong = active.find((row) => !row.subcategories.some((sub) => sub.active));
  if (kosong) {
    return `Kategori “${kosong.label}” aktif tetapi belum punya subkategori aktif. Tambahkan subkategori atau nonaktifkan kategorinya.`;
  }
  return null;
}

/**
 * Menjalankan satu perubahan taksonomi terhadap daftar baris saat ini.
 *
 * Selalu mengembalikan **daftar baris yang baru** (tidak mengubah masukan) atau
 * alasan penolakan; pemanggil (backend) cukup menulis selisihnya ke database.
 * Pagar minimal-satu-kategori-aktif dan kategori-aktif-wajib-punya-subkategori
 * diperiksa setelah perubahan, jadi urutan tindakan di backstage tidak bisa
 * membawa katalog ke keadaan yang tidak bisa dipakai onboarding.
 */
export function applyBusinessCategoryChange(
  rows: readonly BusinessCategoryRow[],
  action: BusinessCategoryAction,
): BusinessCategoryChangeDecision {
  const current = sortedRows(rows);

  const finish = (
    next: BusinessCategoryRow[],
    sentence: string,
  ): BusinessCategoryChangeDecision => {
    const reason = categoryInvariantReason(next);
    if (reason) return { ok: false, reason };
    return { ok: true, rows: sortedRows(next), sentence };
  };

  switch (action.type) {
    case "createCategory": {
      const label = validateBusinessLabel({
        label: action.label,
        kind: "kategori",
        count: current.length,
        max: MAX_BUSINESS_CATEGORIES,
        existingLabels: current.map((row) => row.label),
      });
      if (!label.ok) return label;
      const row: BusinessCategoryRow = {
        key: businessCategoryKeyFromLabel(label.value, current.map((item) => item.key)),
        label: label.value,
        // Kategori baru lahir nonaktif: pagar “aktif wajib punya subkategori”
        // tidak bisa dilanggar, dan pemilik baru tidak melihat pilihan kosong.
        active: false,
        sortOrder: current.length === 0 ? 0 : Math.max(...current.map((item) => item.sortOrder)) + 1,
        subcategories: [],
      };
      return finish(
        [...current, row],
        `Kategori “${row.label}” dibuat (nonaktif). Tambahkan minimal satu subkategori, lalu aktifkan.`,
      );
    }

    case "renameCategory": {
      const row = findCategoryRow(current, action.key);
      if (!row) return { ok: false, reason: "Kategori itu tidak ada di katalog." };
      const label = validateBusinessLabel({
        label: action.label,
        kind: "kategori",
        existingLabels: current.filter((item) => item.key !== row.key).map((item) => item.label),
      });
      if (!label.ok) return label;
      return finish(
        current.map((item) => (item.key === row.key ? { ...item, label: label.value } : item)),
        `Nama kategori diubah menjadi “${label.value}”.`,
      );
    }

    case "setCategoryActive": {
      const row = findCategoryRow(current, action.key);
      if (!row) return { ok: false, reason: "Kategori itu tidak ada di katalog." };
      if (action.active && !row.subcategories.some((sub) => sub.active)) {
        return {
          ok: false,
          reason: `Kategori “${row.label}” belum punya subkategori aktif. Tambahkan subkategori dulu, baru aktifkan.`,
        };
      }
      return finish(
        current.map((item) =>
          item.key === row.key ? { ...item, active: action.active } : item,
        ),
        action.active
          ? `Kategori “${row.label}” diaktifkan — sudah bisa dipilih pemilik baru.`
          : `Kategori “${row.label}” dinonaktifkan — tidak ditawarkan lagi ke pemilih baru, workspace yang sudah memakainya tidak berubah.`,
      );
    }

    case "removeCategory": {
      const row = findCategoryRow(current, action.key);
      if (!row) return { ok: false, reason: "Kategori itu tidak ada di katalog." };
      const jumlahSub = row.subcategories.length;
      return finish(
        current.filter((item) => item.key !== row.key),
        jumlahSub === 0
          ? `Kategori “${row.label}” dihapus.`
          : `Kategori “${row.label}” dihapus beserta ${jumlahSub} subkategorinya.`,
      );
    }

    case "createSubcategory": {
      const row = findCategoryRow(current, action.categoryKey);
      if (!row) return { ok: false, reason: "Kategori induk itu tidak ada di katalog." };
      const label = validateBusinessLabel({
        label: action.label,
        kind: "subkategori",
        count: row.subcategories.length,
        max: MAX_BUSINESS_SUBCATEGORIES,
        existingLabels: row.subcategories.map((sub) => sub.label),
      });
      if (!label.ok) return label;
      const sub: BusinessSubcategoryRow = {
        key: businessCategoryKeyFromLabel(
          label.value,
          row.subcategories.map((item) => item.key),
        ),
        label: label.value,
        active: true,
        sortOrder:
          row.subcategories.length === 0
            ? 0
            : Math.max(...row.subcategories.map((item) => item.sortOrder)) + 1,
      };
      return finish(
        current.map((item) =>
          item.key === row.key
            ? { ...item, subcategories: [...item.subcategories, sub] }
            : item,
        ),
        `Subkategori “${sub.label}” ditambahkan ke kategori “${row.label}”.`,
      );
    }

    case "renameSubcategory": {
      const row = findCategoryRow(current, action.categoryKey);
      if (!row) return { ok: false, reason: "Kategori induk itu tidak ada di katalog." };
      const sub = row.subcategories.find((item) => item.key === normalizeKey(action.key));
      if (!sub) return { ok: false, reason: "Subkategori itu tidak ada di kategori ini." };
      const label = validateBusinessLabel({
        label: action.label,
        kind: "subkategori",
        existingLabels: row.subcategories
          .filter((item) => item.key !== sub.key)
          .map((item) => item.label),
      });
      if (!label.ok) return label;
      return finish(
        current.map((item) =>
          item.key === row.key
            ? {
                ...item,
                subcategories: item.subcategories.map((child) =>
                  child.key === sub.key ? { ...child, label: label.value } : child,
                ),
              }
            : item,
        ),
        `Nama subkategori diubah menjadi “${label.value}”.`,
      );
    }

    case "setSubcategoryActive": {
      const row = findCategoryRow(current, action.categoryKey);
      if (!row) return { ok: false, reason: "Kategori induk itu tidak ada di katalog." };
      const sub = row.subcategories.find((item) => item.key === normalizeKey(action.key));
      if (!sub) return { ok: false, reason: "Subkategori itu tidak ada di kategori ini." };
      if (!action.active && row.active && sub.active) {
        const sisaAktif = row.subcategories.filter(
          (item) => item.active && item.key !== sub.key,
        ).length;
        if (sisaAktif === 0) {
          return {
            ok: false,
            reason: `“${sub.label}” satu-satunya subkategori aktif di kategori “${row.label}”. Nonaktifkan kategorinya dulu, atau tambahkan subkategori lain.`,
          };
        }
      }
      return finish(
        current.map((item) =>
          item.key === row.key
            ? {
                ...item,
                subcategories: item.subcategories.map((child) =>
                  child.key === sub.key ? { ...child, active: action.active } : child,
                ),
              }
            : item,
        ),
        action.active
          ? `Subkategori “${sub.label}” diaktifkan.`
          : `Subkategori “${sub.label}” dinonaktifkan — tidak ditawarkan lagi ke pemilih baru.`,
      );
    }

    case "removeSubcategory": {
      const row = findCategoryRow(current, action.categoryKey);
      if (!row) return { ok: false, reason: "Kategori induk itu tidak ada di katalog." };
      const sub = row.subcategories.find((item) => item.key === normalizeKey(action.key));
      if (!sub) return { ok: false, reason: "Subkategori itu tidak ada di kategori ini." };
      if (row.active && sub.active) {
        const sisaAktif = row.subcategories.filter(
          (item) => item.active && item.key !== sub.key,
        ).length;
        if (sisaAktif === 0) {
          return {
            ok: false,
            reason: `“${sub.label}” satu-satunya subkategori aktif di kategori “${row.label}”. Nonaktifkan kategorinya dulu, atau hapus kategorinya sekalian.`,
          };
        }
      }
      return finish(
        current.map((item) =>
          item.key === row.key
            ? {
                ...item,
                subcategories: item.subcategories.filter((child) => child.key !== sub.key),
              }
            : item,
        ),
        `Subkategori “${sub.label}” dihapus dari kategori “${row.label}”.`,
      );
    }
  }
}

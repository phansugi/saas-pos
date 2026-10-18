/**
 * Master **kategori & subkategori produk** yang mengikuti kategori bisnis pemilik.
 *
 * Pemilik bisnis sudah memilih satu kategori utama + satu subkategori saat
 * onboarding (`lib/businessCategory.ts`), dan pilihan itu terkunci permanen. Yang
 * dilakukan modul ini: menerjemahkan pilihan tersebut menjadi **preset katalog
 * produk** — daftar kategori produk beserta subkategorinya yang masuk akal untuk
 * bisnis itu (kafe → Kopi, Non-Kopi, Bahan Baku; toko bangunan → Semen & Mortar,
 * Besi & Logam, …). Preset ini disemai ke workspace baru (`tenants.create`) dan ke
 * workspace lama saat pilihannya baru dikunci (`tenants.setBusinessCategory`),
 * serta bisa disinkronkan ulang kapan pun lewat tombol di halaman Produk & Stok.
 *
 * Empat keputusan yang sengaja diambil:
 *
 * 1. **Murni.** Tidak ada Convex di sini: yang dihitung adalah *rencana* —
 *    kategori mana yang belum ada, subkategori mana yang belum ada di dalamnya.
 *    Penulisnya ada di `lib/productCatalogSeed.ts`, dan harness bisa menguji
 *    rencananya tanpa database.
 * 2. **Hanya menambah.** Preset tidak pernah mengganti nama, menonaktifkan, atau
 *    menghapus kategori/subkategori yang sudah ada — apalagi produk. Workspace
 *    yang katalognya sudah dirapikan pemiliknya tidak boleh diacak-acak oleh
 *    penyemaian ulang; nama yang sudah ada dilewati (pembanding kunci nama, jadi
 *    “Kopi Susu” dan “kopi  susu” dihitung satu).
 * 3. **Idempoten.** Menjalankan rencana yang sama dua kali menghasilkan rencana
 *    kosong pada percobaan kedua, jadi tombol sinkronisasi boleh ditekan berkali-
 *    kali tanpa menggandakan kategori.
 * 4. **Ada jalur fallback.** Kategori bisnis dibuat pemilik platform di backstage
 *    dan bisa bertambah kapan saja, jadi preset yang tidak dikenal tidak
 *    dibiarkan kosong: yang dipakai adalah nama subkategori bisnisnya sendiri
 *    sebagai satu kategori produk (mis. kategori baru “Otomotif › Bengkel Motor”
 *    → kategori produk “Bengkel Motor”). Katalognya tetap bisa dipakai, dan
 *    pemilik bebas menambah kategori lain.
 */

import {
  MAX_CATEGORIES_PER_TENANT,
  MAX_SUBCATEGORIES_PER_CATEGORY,
  categoryNameKey,
  subcategoryNameKey,
} from "./categories";

/** Satu kategori produk beserta subkategori yang dibuat di bawahnya. */
export interface ProductCategoryPreset {
  name: string;
  subcategories: readonly string[];
}

/** Dari mana preset sebuah workspace diambil — dipakai pesan & uji. */
export type ProductCatalogPresetSource = "subcategory" | "category" | "fallback";

export interface BusinessProductCatalogPreset {
  source: ProductCatalogPresetSource;
  categories: readonly ProductCategoryPreset[];
}

/**
 * Preset per **subkategori** bisnis — yang paling spesifik, jadi yang dipakai
 * lebih dulu kalau pasangannya cocok.
 */
const PRESETS_BY_SUBCATEGORY: Record<string, readonly ProductCategoryPreset[]> = {
  // ── Perdagangan Eceran ────────────────────────────────────────────────────
  minimarket: [
    {
      name: "Sembako",
      subcategories: ["Beras & Tepung", "Minyak & Gula", "Bumbu Dapur"],
    },
    {
      name: "Minuman",
      subcategories: ["Air Mineral", "Minuman Kemasan", "Minuman Panas"],
    },
    {
      name: "Makanan Ringan",
      subcategories: ["Biskuit & Wafer", "Permen & Cokelat", "Snack Gurih"],
    },
    {
      name: "Kebutuhan Rumah",
      subcategories: ["Perawatan Tubuh", "Pembersih & Laundry", "Perlengkapan Dapur"],
    },
  ],
  bangunan: [
    {
      name: "Semen & Mortar",
      subcategories: ["Semen Portland", "Mortar & Perekat"],
    },
    {
      name: "Besi & Logam",
      subcategories: ["Besi Beton", "Baja Ringan", "Paku & Baut"],
    },
    {
      name: "Cat & Finishing",
      subcategories: ["Cat Tembok", "Cat Kayu & Besi", "Kuas & Roll"],
    },
    {
      name: "Pipa & Sanitasi",
      subcategories: ["Pipa PVC", "Fitting & Sambungan", "Keran & Kloset"],
    },
    {
      name: "Alat Listrik",
      subcategories: ["Kabel", "Saklar & Stop Kontak", "Lampu"],
    },
  ],
  fashion: [
    {
      name: "Pakaian Pria",
      subcategories: ["Kemeja & Kaos", "Celana", "Jaket"],
    },
    {
      name: "Pakaian Wanita",
      subcategories: ["Blus & Dress", "Rok & Celana", "Hijab"],
    },
    { name: "Anak & Bayi", subcategories: ["Pakaian Anak", "Perlengkapan Bayi"] },
    {
      name: "Aksesori",
      subcategories: ["Tas", "Sepatu & Sandal", "Perhiasan Imitasi"],
    },
  ],
  elektronik: [
    {
      name: "Handphone & Aksesori",
      subcategories: ["Handphone", "Charger & Kabel", "Casing & Pelindung"],
    },
    {
      name: "Komputer & Laptop",
      subcategories: ["Laptop", "Aksesori Komputer", "Jaringan"],
    },
    {
      name: "Audio & Video",
      subcategories: ["Speaker", "Televisi", "Headset"],
    },
    {
      name: "Peralatan Rumah",
      subcategories: ["Kipas & Pendingin", "Alat Masak Listrik", "Lampu & Fitting"],
    },
  ],
  apotek: [
    {
      name: "Obat Bebas",
      subcategories: ["Obat Batuk & Flu", "Obat Nyeri", "Obat Lambung"],
    },
    {
      name: "Vitamin & Suplemen",
      subcategories: ["Vitamin", "Suplemen Daya Tahan", "Suplemen Anak"],
    },
    {
      name: "Alat Kesehatan",
      subcategories: ["Termometer", "Tensimeter", "Perban & Plester"],
    },
    {
      name: "Perawatan Diri",
      subcategories: ["Sabun & Hand Sanitizer", "Masker", "Skincare"],
    },
  ],

  // ── Makanan & Minuman ─────────────────────────────────────────────────────
  kafe: [
    {
      name: "Kopi",
      subcategories: ["Kopi Susu", "Espresso Based", "Manual Brew"],
    },
    {
      name: "Non-Kopi",
      subcategories: ["Teh", "Cokelat & Matcha", "Jus & Smoothies"],
    },
    {
      name: "Makanan Ringan",
      subcategories: ["Pastry & Roti", "Gorengan & Snack", "Dessert"],
    },
    {
      name: "Makanan Utama",
      subcategories: ["Rice Bowl", "Pasta & Mie", "Sandwich"],
    },
    {
      name: "Bahan Baku",
      subcategories: ["Biji Kopi", "Susu & Sirup", "Cup & Kemasan"],
    },
  ],
  restoran: [
    {
      name: "Makanan Utama",
      subcategories: ["Nasi & Lauk", "Mie & Bakso", "Ayam & Seafood"],
    },
    { name: "Pendamping", subcategories: ["Sayur & Sup", "Kerupuk & Acar"] },
    {
      name: "Minuman",
      subcategories: ["Teh & Kopi", "Jus", "Minuman Kemasan"],
    },
    { name: "Snack & Dessert", subcategories: ["Gorengan", "Kue & Puding"] },
    {
      name: "Bahan Baku",
      subcategories: ["Bumbu & Rempah", "Beras & Tepung", "Daging & Ikan"],
    },
  ],
  warung: [
    { name: "Makanan", subcategories: ["Nasi & Lauk", "Mie & Bakso", "Gorengan"] },
    {
      name: "Minuman",
      subcategories: ["Teh & Kopi", "Minuman Kemasan", "Es & Sirup"],
    },
    { name: "Snack", subcategories: ["Kerupuk & Kue Basah", "Rokok & Permen"] },
    {
      name: "Bumbu & Bahan",
      subcategories: ["Bumbu Dapur", "Minyak & Gula", "Beras & Tepung"],
    },
  ],
  bakery: [
    {
      name: "Roti & Kue",
      subcategories: ["Roti Manis", "Roti Tawar", "Kue Kering"],
    },
    {
      name: "Bahan Kue",
      subcategories: ["Tepung & Gula", "Mentega & Telur", "Cokelat & Topping"],
    },
    { name: "Minuman", subcategories: ["Kopi & Teh", "Minuman Kemasan"] },
    {
      name: "Kemasan & Perlengkapan",
      subcategories: ["Box Kue", "Lilin & Topper"],
    },
  ],
  katering: [
    {
      name: "Paket Katering",
      subcategories: ["Paket Makan Siang", "Paket Prasmanan", "Paket Tumpeng"],
    },
    {
      name: "Bahan Baku",
      subcategories: ["Beras & Tepung", "Daging & Ikan", "Sayur & Buah"],
    },
    {
      name: "Peralatan & Kemasan",
      subcategories: ["Box Makanan", "Peralatan Saji"],
    },
    { name: "Minuman", subcategories: ["Minuman Kemasan", "Teh & Kopi"] },
  ],

  // ── Perdagangan Besar & Distribusi ────────────────────────────────────────
  "distributor-bangunan": [
    {
      name: "Semen & Material",
      subcategories: ["Semen Kantong", "Mortar & Perekat", "Pasir & Batu"],
    },
    {
      name: "Besi & Logam",
      subcategories: ["Besi Beton", "Baja Ringan", "Paku & Baut"],
    },
    { name: "Pipa & Sanitasi", subcategories: ["Pipa PVC", "Fitting", "Keran"] },
    { name: "Cat & Finishing", subcategories: ["Cat Tembok", "Cat Kayu & Besi"] },
  ],
  "distributor-sembako": [
    {
      name: "Beras & Biji-bijian",
      subcategories: ["Beras Premium", "Beras Medium", "Kacang & Biji"],
    },
    { name: "Minyak & Gula", subcategories: ["Minyak Goreng", "Gula Pasir"] },
    {
      name: "Minuman Kemasan",
      subcategories: ["Air Mineral", "Sirup & Teh Kemasan"],
    },
    {
      name: "Kebutuhan Harian",
      subcategories: ["Sabun & Detergen", "Mie Instan"],
    },
  ],
  "grosir-fashion": [
    {
      name: "Pakaian Grosir",
      subcategories: ["Kaos Polos", "Kemeja", "Celana"],
    },
    { name: "Aksesori", subcategories: ["Tas", "Topi & Ikat Pinggang"] },
    { name: "Kain & Bahan", subcategories: ["Katun", "Rayon & Linen"] },
  ],
  "distributor-elektronik": [
    {
      name: "Elektronik",
      subcategories: ["Peralatan Rumah", "Audio & Video"],
    },
    { name: "Aksesori & Kabel", subcategories: ["Kabel", "Charger", "Adaptor"] },
    { name: "Suku Cadang", subcategories: ["Komponen", "Alat Perbaikan"] },
  ],

  // ── Jasa & Layanan ────────────────────────────────────────────────────────
  laundry: [
    {
      name: "Cuci Kering",
      subcategories: ["Cuci Kering Reguler", "Cuci Kering Express"],
    },
    {
      name: "Cuci Setrika",
      subcategories: ["Cuci Setrika Reguler", "Cuci Setrika Express"],
    },
    { name: "Setrika Saja", subcategories: ["Setrika Reguler", "Setrika Express"] },
    {
      name: "Layanan Tambahan",
      subcategories: ["Cuci Sepatu", "Cuci Selimut", "Antar Jemput"],
    },
  ],
  salon: [
    {
      name: "Potong & Styling",
      subcategories: ["Potong Rambut", "Cukur", "Hair Styling"],
    },
    {
      name: "Perawatan Wajah",
      subcategories: ["Facial", "Creambath", "Masker"],
    },
    {
      name: "Perawatan Tubuh",
      subcategories: ["Massage", "Body Scrub", "Waxing"],
    },
    {
      name: "Produk Perawatan",
      subcategories: ["Shampoo & Kondisioner", "Pomade & Hair Tonic"],
    },
  ],
  bengkel: [
    {
      name: "Jasa Servis",
      subcategories: ["Servis Ringan", "Servis Besar", "Tune Up"],
    },
    {
      name: "Suku Cadang",
      subcategories: ["Filter & Busi", "Kampas Rem", "Rantai & Gear"],
    },
    {
      name: "Oli & Cairan",
      subcategories: ["Oli Mesin", "Oli Gardan", "Minyak Rem"],
    },
    {
      name: "Aksesori",
      subcategories: ["Lampu & Kelistrikan", "Variasi & Cover"],
    },
  ],
  percetakan: [
    {
      name: "Cetak Digital",
      subcategories: ["Banner & Spanduk", "Kartu Nama", "Stiker & Label"],
    },
    {
      name: "Desain & Pra-cetak",
      subcategories: ["Desain Logo", "Setting Layout"],
    },
    {
      name: "Bahan Cetak",
      subcategories: ["Kertas", "Tinta & Toner", "Vinyl & Flexi"],
    },
  ],
  rental: [
    {
      name: "Alat & Perlengkapan",
      subcategories: ["Alat Pesta", "Alat Kerja", "Elektronik"],
    },
    {
      name: "Perlengkapan Acara",
      subcategories: ["Tenda & Kursi", "Dekorasi", "Sound System"],
    },
    { name: "Layanan Antar", subcategories: ["Antar Lokasi", "Bongkar Pasang"] },
  ],

  // ── Produksi & Kerajinan ──────────────────────────────────────────────────
  "makanan-olahan": [
    {
      name: "Bahan Baku",
      subcategories: ["Tepung & Gula", "Minyak & Lemak", "Bumbu & Rempah"],
    },
    {
      name: "Produk Jadi",
      subcategories: ["Snack Olahan", "Sambal & Saus", "Frozen Food"],
    },
    { name: "Kemasan", subcategories: ["Plastik & Standing Pouch", "Label & Stiker"] },
  ],
  konveksi: [
    { name: "Kain & Bahan", subcategories: ["Katun", "Rayon & Linen", "Benang"] },
    {
      name: "Pakaian Jadi",
      subcategories: ["Kaos & Kemeja", "Celana", "Seragam"],
    },
    { name: "Aksesori", subcategories: ["Kancing & Resleting", "Label & Bordir"] },
  ],
  furnitur: [
    {
      name: "Kayu & Bahan",
      subcategories: ["Kayu Olahan", "Plywood & MDF", "HPL & Finishing"],
    },
    {
      name: "Furnitur Jadi",
      subcategories: ["Meja & Kursi", "Lemari & Rak", "Tempat Tidur"],
    },
    { name: "Finishing", subcategories: ["Cat & Pelitur", "Alat & Aksesori Kerja"] },
  ],
  kerajinan: [
    {
      name: "Bahan Kerajinan",
      subcategories: ["Rotan & Bambu", "Kain & Benang", "Manik & Aksesori"],
    },
    {
      name: "Produk Kerajinan",
      subcategories: ["Kerajinan Dekorasi", "Souvenir", "Tas & Anyaman"],
    },
    { name: "Kemasan", subcategories: ["Box & Kantong", "Label & Kartu Ucapan"] },
  ],
};

/**
 * Preset per **kategori** bisnis — dipakai saat subkategorinya belum punya preset
 * khusus (mis. subkategori baru dari backstage di dalam kategori lama).
 */
const PRESETS_BY_CATEGORY: Record<string, readonly ProductCategoryPreset[]> = {
  retail: PRESETS_BY_SUBCATEGORY.minimarket,
  fnb: [
    { name: "Makanan", subcategories: ["Makanan Utama", "Snack", "Dessert"] },
    { name: "Minuman", subcategories: ["Kopi & Teh", "Jus", "Minuman Kemasan"] },
    { name: "Bahan Baku", subcategories: ["Bumbu & Rempah", "Susu & Sirup"] },
  ],
  wholesale: [
    {
      name: "Barang Dagangan",
      subcategories: ["Stok Utama", "Stok Grosir"],
    },
    { name: "Kemasan & Perlengkapan", subcategories: ["Kemasan", "Perlengkapan"] },
    { name: "Aksesori", subcategories: ["Aksesori Penjualan"] },
  ],
  service: [
    { name: "Jasa Utama", subcategories: ["Paket Reguler", "Paket Express"] },
    { name: "Layanan Tambahan", subcategories: ["Layanan Tambahan"] },
    { name: "Produk Pendukung", subcategories: ["Barang Penunjang"] },
  ],
  production: [
    { name: "Bahan Baku", subcategories: ["Bahan Utama", "Bahan Pendukung"] },
    { name: "Produk Jadi", subcategories: ["Produk Jadi"] },
    { name: "Kemasan", subcategories: ["Kemasan & Label"] },
  ],
  other: [
    {
      name: "Umum",
      subcategories: ["Barang Dagangan", "Jasa"],
    },
    { name: "Lainnya", subcategories: ["Lain-lain"] },
  ],
};

/**
 * Katalog bawaan **lama** untuk workspace yang dibuat tanpa memilih kategori
 * bisnis (pemanggil API/internal, atau data sebelum fitur kategori utama ada).
 * Sengaja dipertahankan apa adanya supaya perilaku lama tidak berubah diam-diam.
 */
export const LEGACY_DEFAULT_CATEGORIES = ["Kopi", "Makanan", "Snack", "Minuman"];

/**
 * Preset untuk satu pilihan bisnis.
 *
 * Urutannya sengaja: subkategori (paling spesifik) → kategori → fallback dari
 * label subkategori/kategori bisnisnya. Fallback hanya dipakai kalau pilihan itu
 * memang belum punya preset — dan itu tetap berguna: kategorinya bisa langsung
 * dipakai, bukan katalog kosong.
 */
export function productCatalogPresetFor(input: {
  category: string;
  subcategory?: string | null;
  categoryLabel?: string | null;
  subcategoryLabel?: string | null;
}): BusinessProductCatalogPreset {
  const subcategoryKey = (input.subcategory ?? "").trim();
  const specific = subcategoryKey
    ? PRESETS_BY_SUBCATEGORY[subcategoryKey]
    : undefined;
  if (specific) return { source: "subcategory", categories: specific };

  const categoryKey = (input.category ?? "").trim();
  const byCategory = categoryKey ? PRESETS_BY_CATEGORY[categoryKey] : undefined;
  if (byCategory) return { source: "category", categories: byCategory };

  const label =
    (input.subcategoryLabel ?? "").trim() || (input.categoryLabel ?? "").trim();
  return {
    source: "fallback",
    categories: label
      ? [{ name: label, subcategories: [] }]
      : [],
  };
}

export interface PlannedProductCategory {
  name: string;
  subcategories: string[];
}

export interface ProductCatalogSeedPlan {
  /** Kategori yang perlu dibuat (belum ada di workspace). */
  categories: PlannedProductCategory[];
  /** Subkategori yang perlu dibuat di kategori yang **sudah ada** (map nama → sub). */
  subcategoriesForExistingCategories: PlannedProductCategory[];
  /** Yang dilewati karena batas jumlah kategori, supaya bisa dilaporkan. */
  skippedCategoryNames: string[];
}

/**
 * Rencana penyemaian: apa yang belum ada dan karenanya perlu dibuat.
 *
 * Kategori yang sudah ada **tidak** diubah namanya; subkategorinya tetap
 * dilengkapi kalau preset menyebut subkategori yang belum ada di sana — jadi
 * workspace yang sudah punya “Kopi” (tanpa subkategori) tetap mendapat
 * “Kopi Susu”, “Espresso Based”, dan seterusnya.
 *
 * Batas jumlah dihormati seperti aturan halaman Produk & Stok
 * (`MAX_CATEGORIES_PER_TENANT`, `MAX_SUBCATEGORIES_PER_CATEGORY`): yang tidak
 * muat dilewati dan dilaporkan, bukan membuat penyemaian gagal seluruhnya.
 */
export function planProductCatalogSeeding(input: {
  preset: readonly ProductCategoryPreset[];
  existingCategoryNames: readonly string[];
  /** Nama subkategori yang sudah ada, beserta nama kategori induknya. */
  existingSubcategories: readonly { categoryName: string; name: string }[];
  maxCategories?: number;
  maxSubcategoriesPerCategory?: number;
}): ProductCatalogSeedPlan {
  const maxCategories = input.maxCategories ?? MAX_CATEGORIES_PER_TENANT;
  const maxSubcategories =
    input.maxSubcategoriesPerCategory ?? MAX_SUBCATEGORIES_PER_CATEGORY;

  const existingCategories = new Map(
    input.existingCategoryNames.map((name) => [categoryNameKey(name), name]),
  );
  const subcategoriesByCategory = new Map<string, Set<string>>();
  for (const row of input.existingSubcategories) {
    const key = categoryNameKey(row.categoryName);
    const set = subcategoriesByCategory.get(key) ?? new Set<string>();
    set.add(subcategoryNameKey(row.name));
    subcategoriesByCategory.set(key, set);
  }

  const plan: ProductCatalogSeedPlan = {
    categories: [],
    subcategoriesForExistingCategories: [],
    skippedCategoryNames: [],
  };

  let categoryCount = existingCategories.size;

  for (const preset of input.preset) {
    const key = categoryNameKey(preset.name);
    if (key.length === 0) continue;

    const alreadyExists = existingCategories.has(key);
    if (!alreadyExists && categoryCount >= maxCategories) {
      plan.skippedCategoryNames.push(preset.name);
      continue;
    }
    if (!alreadyExists) categoryCount += 1;

    // Subkategori yang belum ada di kategori ini (baru maupun lama). Kategori
    // tanpa subkategori tetap berguna — produk bisa langsung masuk ke sana — jadi
    // kategori baru dimasukkan walau daftar subkategorinya kosong.
    const taken = subcategoriesByCategory.get(key) ?? new Set<string>();
    const wanted = preset.subcategories
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .filter((name) => !taken.has(subcategoryNameKey(name)))
      .slice(0, Math.max(0, maxSubcategories - taken.size));

    if (alreadyExists) {
      if (wanted.length > 0) {
        plan.subcategoriesForExistingCategories.push({
          name: preset.name,
          subcategories: wanted,
        });
      }
      continue;
    }

    plan.categories.push({ name: preset.name, subcategories: wanted });
  }

  return plan;
}

/** Label bisnis untuk kalimat/audit: “Makanan & Minuman — Kafe & Kedai Kopi”. */
export function businessCategoryLabel(input: {
  categoryLabel?: string | null;
  subcategoryLabel?: string | null;
}): string {
  const kategori = (input.categoryLabel ?? "").trim();
  const sub = (input.subcategoryLabel ?? "").trim();
  if (kategori && sub) return `${kategori} — ${sub}`;
  return kategori || sub || "yang dipilih";
}

/** Benar kalau rencananya tidak menambah apa pun (penyemaian ulang). */
export function productCatalogPlanIsEmpty(plan: ProductCatalogSeedPlan): boolean {
  return (
    plan.categories.length === 0 &&
    plan.subcategoriesForExistingCategories.length === 0
  );
}

/**
 * Kalimat hasil penyemaian — satu tempat, dipakai backend (balikan mutation),
 * store, dan halaman Produk & Stok supaya ketiganya tidak pernah berbeda.
 */
export function productCatalogSeedSentence(input: {
  businessLabel: string;
  createdCategoryNames: readonly string[];
  createdSubcategoryCount: number;
  skippedCategoryNames?: readonly string[];
}): string {
  const categories = input.createdCategoryNames.length;
  const subs = input.createdSubcategoryCount;
  const skipped = input.skippedCategoryNames ?? [];

  if (categories === 0 && subs === 0) {
    return `Katalog produk sudah sesuai dengan kategori bisnis ${input.businessLabel} — tidak ada yang perlu ditambahkan.`;
  }

  const bagian: string[] = [];
  if (categories > 0) {
    bagian.push(
      `${categories} kategori produk (${input.createdCategoryNames.join(", ")})`,
    );
  }
  if (subs > 0) {
    bagian.push(
      subs === 1 ? "1 subkategori" : `${subs} subkategori`,
    );
  }

  const lewat = skipped.length
    ? ` ${skipped.length} kategori preset dilewati karena batas ${MAX_CATEGORIES_PER_TENANT} kategori (${skipped.join(", ")}).`
    : "";

  return `${bagian.join(" dan ")} dibuat mengikuti kategori bisnis ${input.businessLabel}.${lewat}`;
}

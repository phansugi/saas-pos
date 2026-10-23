/**
 * Uji **preset katalog produk** yang mengikuti kategori bisnis pemilik.
 *
 * Yang diuji adalah `src/convex/lib/productCatalogPresets.ts` — modul murni yang
 * dipakai `tenants.create`, `tenants.setBusinessCategory`,
 * `categories.syncFromBusinessCategory`, kedua store, dan halaman Produk & Stok.
 * Janji yang dijaga di sini:
 *
 *   1. tiap pilihan bisnis yang punya preset menghasilkan kategori produk beserta
 *      subkategorinya (kafe → Kopi & subkategorinya, toko bangunan → semen, besi,
 *      cat, …), dan pilihan yang belum punya preset tetap menghasilkan satu
 *      kategori dari nama subkategori bisnisnya — bukan katalog kosong;
 *   2. rencana penyemaian **hanya menambah**: kategori yang sudah ada tidak
 *      diubah/diduplikasi, dan subkategorinya tetap dilengkapi;
 *   3. rencananya **idempoten** dan menghormati batas jumlah kategori;
 *   4. kalimatnya menyebut apa yang baru dibuat, atau bahwa katalog sudah sesuai.
 *
 * Usage: bun scripts/verify-product-presets.mjs
 */
import {
  businessCategoryLabel,
  LEGACY_DEFAULT_CATEGORIES,
  planProductCatalogSeeding,
  productCatalogPlanIsEmpty,
  productCatalogPresetFor,
  productCatalogSeedSentence,
} from "../src/convex/lib/productCatalogPresets.ts";
import { BUSINESS_CATEGORIES } from "../src/convex/lib/businessCategory.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// ------------------------------------------------------- preset per pilihan
{
  const kafe = productCatalogPresetFor({ category: "fnb", subcategory: "kafe" });
  check(
    "kafe memakai preset subkategorinya (Kopi, Non-Kopi, bahan baku)",
    kafe.source === "subcategory" &&
      ["Kopi", "Non-Kopi", "Makanan Ringan", "Makanan Utama", "Bahan Baku"].every((name) =>
        kafe.categories.some((row) => row.name === name),
      ),
    JSON.stringify(kafe),
  );
  const kopi = kafe.categories.find((row) => row.name === "Kopi");
  check(
    "setiap kategori preset membawa subkategorinya",
    Boolean(kopi) && kopi.subcategories.length >= 2 && kopi.subcategories.includes("Kopi Susu"),
    JSON.stringify(kopi),
  );

  const bangunan = productCatalogPresetFor({ category: "retail", subcategory: "bangunan" });
  check(
    "toko bangunan mendapat preset semen/besi/cat/pipa/alat listrik",
    bangunan.source === "subcategory" &&
      ["Semen & Mortar", "Besi & Logam", "Cat & Finishing", "Pipa & Sanitasi", "Alat Listrik"].every(
        (name) => bangunan.categories.some((row) => row.name === name),
      ) &&
      !bangunan.categories.some((row) => row.name === "Kopi"),
    JSON.stringify(bangunan.categories.map((row) => row.name)),
  );

  /*
    “Buah & Sayur” pernah jatuh ke preset `retail` (Sembako, Minuman, Makanan
    Ringan, Kebutuhan Rumah) karena kuncinya tidak punya preset sendiri — master
    yang ada, tetapi tidak menjawab barang dagangan toko buah. Dua cek di bawah
    menjaga agar subkategori itu punya master sendiri dan tidak kembali ke
    preset generik.
  */
  const buahSayur = productCatalogPresetFor({
    category: "retail",
    subcategory: "buah-sayur",
    subcategoryLabel: "Buah & Sayur",
  });
  check(
    "toko buah & sayur memakai preset khusus buah/sayur, bukan preset minimarket",
    buahSayur.source === "subcategory" &&
      ["Buah Segar", "Sayur Segar", "Bumbu & Pelengkap"].every((name) =>
        buahSayur.categories.some((row) => row.name === name),
      ) &&
      !buahSayur.categories.some((row) => row.name === "Sembako"),
    JSON.stringify(buahSayur.categories.map((row) => row.name)),
  );
  check(
    "setiap kategori master buah & sayur membawa subkategorinya",
    buahSayur.categories.every((row) => row.subcategories.length >= 2),
    JSON.stringify(buahSayur.categories),
  );
  check(
    "subkategori Buah & Sayur terdaftar di katalog bisnis bawaan",
    BUSINESS_CATEGORIES.some(
      (row) =>
        row.key === "retail" &&
        row.subcategories.some((sub) => sub.key === "buah-sayur" && sub.label === "Buah & Sayur"),
    ),
    BUSINESS_CATEGORIES.map((row) => row.key).join(", "),
  );

  const laundry = productCatalogPresetFor({ category: "service", subcategory: "laundry" });
  check(
    "jasa laundry memakai preset layanan (bukan barang dagangan)",
    laundry.source === "subcategory" &&
      laundry.categories.some((row) => row.name === "Cuci Setrika") &&
      laundry.categories.every((row) => row.subcategories.length > 0),
    JSON.stringify(laundry.categories.map((row) => row.name)),
  );

  const subBaru = productCatalogPresetFor({ category: "fnb", subcategory: "sub-baru" });
  check(
    "subkategori baru di kategori lama jatuh ke preset kategorinya",
    subBaru.source === "category" && subBaru.categories.some((row) => row.name === "Makanan"),
    JSON.stringify(subBaru.categories.map((row) => row.name)),
  );

  const asing = productCatalogPresetFor({
    category: "otomotif",
    subcategory: "bengkel-motor",
    subcategoryLabel: "Bengkel Motor",
    categoryLabel: "Otomotif",
  });
  check(
    "kategori bisnis tanpa preset tetap menghasilkan satu kategori produk dari nama subkategorinya",
    asing.source === "fallback" &&
      asing.categories.length === 1 &&
      asing.categories[0].name === "Bengkel Motor",
    JSON.stringify(asing),
  );

  const tanpaLabel = productCatalogPresetFor({ category: "otomotif", subcategory: "x" });
  check(
    "fallback tanpa label tidak mengarang baris kosong",
    tanpaLabel.categories.length === 0,
    JSON.stringify(tanpaLabel),
  );

  check(
    "setiap kategori bisnis bawaan punya preset (subkategori atau kategorinya)",
    BUSINESS_CATEGORIES.every((row) => {
      for (const sub of row.subcategories) {
        const preset = productCatalogPresetFor({ category: row.key, subcategory: sub.key });
        if (preset.source === "fallback" || preset.categories.length === 0) {
          const perKategori = productCatalogPresetFor({ category: row.key });
          if (perKategori.source === "fallback" || perKategori.categories.length === 0) {
            return false;
          }
        }
      }
      return true;
    }),
    BUSINESS_CATEGORIES.map((row) => row.key).join(", "),
  );

  check(
    "daftar kategori bawaan lama tetap tersedia sebagai jalur tanpa pilihan bisnis",
    LEGACY_DEFAULT_CATEGORIES.length === 4 &&
      LEGACY_DEFAULT_CATEGORIES.includes("Kopi"),
    JSON.stringify(LEGACY_DEFAULT_CATEGORIES),
  );
}

// ----------------------------------------------------- rencana penyemaian
{
  const preset = productCatalogPresetFor({ category: "fnb", subcategory: "kafe" }).categories;

  const kosong = planProductCatalogSeeding({
    preset,
    existingCategoryNames: [],
    existingSubcategories: [],
  });
  check(
    "workspace kosong mendapat seluruh kategori preset beserta subkategorinya",
    kosong.categories.length === preset.length &&
      kosong.categories.every((row) => row.subcategories.length > 0) &&
      kosong.subcategoriesForExistingCategories.length === 0 &&
      kosong.skippedCategoryNames.length === 0,
    JSON.stringify(kosong),
  );

  const adaKategori = planProductCatalogSeeding({
    preset,
    existingCategoryNames: ["Kopi", "Makanan"],
    existingSubcategories: [],
  });
  check(
    "kategori yang sudah ada tidak diduplikasi, tetapi subkategorinya tetap dilengkapi",
    adaKategori.categories.every((row) => row.name !== "Kopi" && row.name !== "Makanan") &&
      adaKategori.subcategoriesForExistingCategories.some(
        (row) => row.name === "Kopi" && row.subcategories.includes("Kopi Susu"),
      ),
    JSON.stringify(adaKategori),
  );

  const bedaSpasi = planProductCatalogSeeding({
    preset,
    existingCategoryNames: ["  kopi  "],
    existingSubcategories: [{ categoryName: "KOPI", name: "kopi susu" }],
  });
  const kopiLama = bedaSpasi.subcategoriesForExistingCategories.find(
    (row) => row.name === "Kopi",
  );
  check(
    "pembanding nama mengabaikan besar-kecil huruf dan spasi (tidak ada kategori/subkategori kembar)",
    bedaSpasi.categories.every((row) => row.name !== "Kopi") &&
      Boolean(kopiLama) &&
      !kopiLama.subcategories.some((name) => name.toLowerCase() === "kopi susu") &&
      kopiLama.subcategories.includes("Espresso Based"),
    JSON.stringify(bedaSpasi),
  );

  /*
    Keadaan yang dilaporkan pemilik repo: workspace ber-“Toko Bangunan & Material”
    tetapi katalognya masih **empat kategori bawaan lama** (Kopi, Makanan, Snack,
    Minuman) tanpa subkategori — jadi master bisnisnya “tidak ada”. Rencana ini
    yang dipakai halaman Produk & Stok untuk mengatakannya: bukan kosong, dan
    tidak satu pun kategori lama disentuh.
  */
  const bangunan = productCatalogPresetFor({ category: "retail", subcategory: "bangunan" });
  const warisanLama = planProductCatalogSeeding({
    preset: bangunan.categories,
    existingCategoryNames: LEGACY_DEFAULT_CATEGORIES,
    existingSubcategories: [],
  });
  const subkategoriBawaan = bangunan.categories.reduce(
    (total, row) => total + row.subcategories.length,
    0,
  );
  check(
    "workspace bergaya toko bangunan yang masih memakai daftar bawaan lama mendapat seluruh master bisnisnya",
    warisanLama.categories.length === bangunan.categories.length &&
      warisanLama.categories.length === 5 &&
      warisanLama.subcategoriesForExistingCategories.length === 0 &&
      subkategoriBawaan === 14 &&
      warisanLama.categories.reduce((total, row) => total + row.subcategories.length, 0) ===
        subkategoriBawaan,
    JSON.stringify({
      kategori: warisanLama.categories.map((row) => row.name),
      subkategori: warisanLama.categories.reduce(
        (total, row) => total + row.subcategories.length,
        0,
      ),
    }),
  );
  check(
    "rencana itu bukan rencana kosong — halaman harus menyebut “belum ada”, bukan “sudah sesuai”",
    !productCatalogPlanIsEmpty(warisanLama) &&
      !warisanLama.categories.some((row) => LEGACY_DEFAULT_CATEGORIES.includes(row.name)),
    JSON.stringify(warisanLama.categories.map((row) => row.name)),
  );

  // Idempoten: rencana pertama dianggap sudah dijalankan, rencana kedua harus kosong.
  const sudahAda = [
    ...kosong.categories.map((row) => row.name),
    ...kosong.subcategoriesForExistingCategories.map((row) => row.name),
  ];
  const subkategoriSudahAda = kosong.categories.flatMap((row) =>
    row.subcategories.map((name) => ({ categoryName: row.name, name })),
  );
  const ulang = planProductCatalogSeeding({
    preset,
    existingCategoryNames: sudahAda,
    existingSubcategories: subkategoriSudahAda,
  });
  check(
    "menjalankan rencana yang sama dua kali tidak menambah apa pun",
    productCatalogPlanIsEmpty(ulang),
    JSON.stringify(ulang),
  );

  const terbatas = planProductCatalogSeeding({
    preset,
    existingCategoryNames: [],
    existingSubcategories: [],
    maxCategories: 2,
  });
  check(
    "batas jumlah kategori dihormati dan sisanya dilaporkan (bukan gagal total)",
    terbatas.categories.length === 2 && terbatas.skippedCategoryNames.length === preset.length - 2,
    JSON.stringify({
      dibuat: terbatas.categories.map((row) => row.name),
      dilewati: terbatas.skippedCategoryNames,
    }),
  );

  const batasSub = planProductCatalogSeeding({
    preset,
    existingCategoryNames: [],
    existingSubcategories: [],
    maxSubcategoriesPerCategory: 1,
  });
  check(
    "batas subkategori per kategori juga dihormati",
    batasSub.categories.every((row) => row.subcategories.length <= 1),
    JSON.stringify(batasSub.categories),
  );
}

// ------------------------------------------------------------- kalimat hasil
{
  const dibuat = productCatalogSeedSentence({
    businessLabel: "Makanan & Minuman — Kafe & Kedai Kopi",
    createdCategoryNames: ["Kopi", "Non-Kopi"],
    createdSubcategoryCount: 6,
  });
  check(
    "kalimat hasil menyebut jumlah, nama kategori, dan kategori bisnisnya",
    dibuat.includes("2 kategori produk") &&
      dibuat.includes("Kopi, Non-Kopi") &&
      dibuat.includes("6 subkategori") &&
      dibuat.includes("Kafe & Kedai Kopi"),
    dibuat,
  );

  const kosong = productCatalogSeedSentence({
    businessLabel: "Lainnya — Usaha Umum",
    createdCategoryNames: [],
    createdSubcategoryCount: 0,
  });
  check(
    "kalimat “tidak ada yang perlu ditambahkan” dipakai saat katalog sudah sesuai",
    kosong.includes("sudah sesuai") && kosong.includes("Usaha Umum"),
    kosong,
  );

  const terlewat = productCatalogSeedSentence({
    businessLabel: "Lainnya — Usaha Umum",
    createdCategoryNames: [],
    createdSubcategoryCount: 0,
    skippedCategoryNames: [],
  });
  check(
    "tanpa kategori terlewat, kalimatnya tidak menyebut batas",
    !terlewat.includes("dilewati"),
    terlewat,
  );

  check(
    "label bisnis digabung dengan pemisah yang sama di seluruh aplikasi",
    businessCategoryLabel({
      categoryLabel: "Perdagangan Eceran",
      subcategoryLabel: "Toko Bangunan & Material",
    }) === "Perdagangan Eceran — Toko Bangunan & Material",
    businessCategoryLabel({ categoryLabel: "Lainnya" }),
  );
}

console.log(`${results.length}/${results.length} checks passed`);

/**
 * Uji aturan kategori produk (`category.manage`) tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/categories.ts` — modul murni yang dipakai
 * server (`src/convex/categories.ts`), kedua store (demo & Convex), halaman
 * Produk & Stok, tab POS, dan harness ini. Empat hal yang paling mudah rusak
 * diam-diam:
 *
 *   1. nama “Tanpa kategori” masuk sebagai kategori sungguhan, sehingga produk
 *      tanpa kategori dan produk yang memakai kategori itu tidak bisa dibedakan;
 *   2. ganti nama kategori diam-diam menulis ulang SKU produk (SKU berformat
 *      `PBB-<nomor urut>` tanpa nama kategori, jadi tidak boleh tersentuh);
 *   3. kategori nonaktif tetap ditawarkan ke produk baru, atau sebaliknya hilang
 *      dari tab POS padahal produknya masih dijual;
 *   4. hapus kategori yang masih dipakai produk tidak diberitahukan dampaknya.
 *
 * Usage: bun scripts/verify-categories.mjs
 */
import {
  CATEGORY_NAME_MAX,
  CATEGORY_NAME_MIN,
  CATEGORY_NO_CATEGORY_LABEL,
  categoryIsActive,
  categoryNameKey,
  countProductsInCategory,
  deleteCategorySentence,
  isReservedCategoryName,
  MAX_CATEGORIES_PER_TENANT,
  countProductsInSubcategory,
  deleteSubcategorySentence,
  MAX_SUBCATEGORIES_PER_CATEGORY,
  normalizeCategoryName,
  normalizeSubcategoryName,
  posCategoryChips,
  selectableCategoryNames,
  selectableSubcategoryNames,
  SUBCATEGORY_NAME_MAX,
  SUBCATEGORY_NAME_MIN,
  subcategoryIsActive,
  subcategoryNameKey,
  validateCategoryName,
  validateSubcategoryName,
} from "../src/convex/lib/categories.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// ------------------------------------------------------------------ nama
check(
  "nama kategori dirapikan: spasi pinggir & spasi ganda",
  normalizeCategoryName("  Kopi   Susu  ") === "Kopi Susu",
  JSON.stringify(normalizeCategoryName("  Kopi   Susu  ")),
);
check(
  "kunci pembanding mengabaikan huruf besar & pemisah",
  categoryNameKey("Kopi-Susu") === categoryNameKey("kopi susu"),
  `${categoryNameKey("Kopi-Susu")} vs ${categoryNameKey("kopi susu")}`,
);

check(
  "kategori valid diterima apa adanya (tanpa diubah hurufnya)",
  validateCategoryName({ name: " Sanitasi " }).value?.name === "Sanitasi",
  JSON.stringify(validateCategoryName({ name: " Sanitasi " })),
);
check(
  "kategori baru aktif secara default",
  validateCategoryName({ name: "Sanitasi" }).value?.active === true,
  JSON.stringify(validateCategoryName({ name: "Sanitasi" })),
);

for (const [label, input, expected] of [
  ["nama terlalu pendek", { name: "A" }, `${CATEGORY_NAME_MIN}–${CATEGORY_NAME_MAX}`],
  [
    "nama terlalu panjang",
    { name: "K".repeat(CATEGORY_NAME_MAX + 1) },
    `${CATEGORY_NAME_MIN}–${CATEGORY_NAME_MAX}`,
  ],
  // Nama kosong lebih dulu tertangkap aturan panjang (2 karakter) — urutan
  // pemeriksaan itu yang dipakai server, jadi diuji apa adanya.
  ["nama kosong", { name: "   " }, `${CATEGORY_NAME_MIN}–${CATEGORY_NAME_MAX}`],
  ["nama terlarang", { name: "Tanpa kategori" }, "produk tanpa kategori"],
]) {
  const result = validateCategoryName(input);
  check(
    `kategori ditolak: ${label}`,
    !result.ok && (result.reason ?? "").includes(expected),
    result.ok ? "DITERIMA — validasi bocor" : result.reason,
  );
}

// “Tanpa kategori” berarti “tidak ada kategori” di seluruh aplikasi: tabel produk
// dan pemilih kategori. Nama itu harus dikenali dari bentuk apa pun, bukan hanya
// kalimat persisnya.
check(
  "semua bentuk “tanpa kategori” dianggap terlarang",
  isReservedCategoryName("Tanpa kategori") &&
    isReservedCategoryName("tanpa  kategori") &&
    isReservedCategoryName("TANPAKATEGORI") &&
    isReservedCategoryName("Tanpa-Kategori") &&
    isReservedCategoryName("   ") &&
    !isReservedCategoryName("Tanpa Kategori Baru"),
  ["Tanpa kategori", "TANPAKATEGORI", "Tanpa-Kategori", "Tanpa Kategori Baru"]
    .map((value) => `${value}=${isReservedCategoryName(value)}`)
    .join(", "),
);
// --------------------------------------------------------------- subkategori
check(
  "nama subkategori dirapikan dengan aturan spasi yang sama",
  normalizeSubcategoryName("  Semen   Portland ") === "Semen Portland",
  JSON.stringify(normalizeSubcategoryName("  Semen   Portland ")),
);
check(
  "subkategori valid diterima apa adanya (tanpa diubah hurufnya)",
  validateSubcategoryName({ name: " Semen  Portland " }).value?.name === "Semen Portland",
  JSON.stringify(validateSubcategoryName({ name: " Semen  Portland " })),
);
check(
  "subkategori baru aktif secara default",
  validateSubcategoryName({ name: "Semen Portland" }).value?.active === true,
  JSON.stringify(validateSubcategoryName({ name: "Semen Portland" })),
);
for (const [label, input, expected] of [
  ["nama terlalu pendek", { name: "S" }, `${SUBCATEGORY_NAME_MIN}–${SUBCATEGORY_NAME_MAX}`],
  [
    "nama terlalu panjang",
    { name: "S".repeat(SUBCATEGORY_NAME_MAX + 1) },
    `${SUBCATEGORY_NAME_MIN}–${SUBCATEGORY_NAME_MAX}`,
  ],
  ["nama terlarang", { name: "Tanpa kategori" }, "produk tanpa kategori"],
]) {
  const result = validateSubcategoryName(input);
  check(
    `subkategori ditolak: ${label}`,
    !result.ok && (result.reason ?? "").includes(expected),
    result.ok ? "DITERIMA — validasi bocor" : result.reason,
  );
}
check(
  "subkategori kembar di kategori yang sama ditolak",
  validateSubcategoryName(
    { name: "semen portland" },
    { existingNames: ["Semen Portland", "Semen Putih"] },
  ).ok === false,
  JSON.stringify(
    validateSubcategoryName(
      { name: "semen portland" },
      { existingNames: ["Semen Portland", "Semen Putih"] },
    ),
  ),
);
check(
  "nama subkategori yang mirip tetapi berbeda tetap diterima",
  validateSubcategoryName(
    { name: "Semen Putih" },
    { existingNames: ["Semen Portland"] },
  ).ok === true,
  JSON.stringify(
    validateSubcategoryName({ name: "Semen Putih" }, { existingNames: ["Semen Portland"] }),
  ),
);
check(
  `batas ${MAX_SUBCATEGORIES_PER_CATEGORY} subkategori per kategori ditegakkan saat menambah`,
  validateSubcategoryName(
    { name: "Semen Putih" },
    { count: MAX_SUBCATEGORIES_PER_CATEGORY, existingNames: [] },
  ).ok === false,
  JSON.stringify(
    validateSubcategoryName(
      { name: "Semen Putih" },
      { count: MAX_SUBCATEGORIES_PER_CATEGORY, existingNames: [] },
    ),
  ),
);
check(
  "batas itu tidak menahan perbaikan nama subkategori yang sudah ada",
  validateSubcategoryName({ name: "Semen Putih" }, { existingNames: [] }).ok === true,
  JSON.stringify(validateSubcategoryName({ name: "Semen Putih" }, { existingNames: [] })),
);
check(
  "baris subkategori lama tanpa kolom aktif dianggap aktif",
  subcategoryIsActive({ name: "Semen Putih" }) &&
    subcategoryIsActive({ name: "Semen Putih", active: undefined }) &&
    !subcategoryIsActive({ name: "Semen Putih", active: false }),
  JSON.stringify([
    subcategoryIsActive({ name: "Semen Putih" }),
    subcategoryIsActive({ name: "Semen Putih", active: false }),
  ]),
);
check(
  "kunci pembanding nama subkategori memakai aturan yang sama",
  subcategoryNameKey("Semen-Portland") === subcategoryNameKey("semen portland"),
  `${subcategoryNameKey("Semen-Portland")} vs ${subcategoryNameKey("semen portland")}`,
);

// ------------------------------------ pemilih subkategori (di bawah kategori)
{
  const baris = [
    { name: "Semen Portland", categoryId: "cat-semen", active: true },
    { name: "Semen Putih", categoryId: "cat-semen", active: false },
    { name: "Besi Beton", categoryId: "cat-besi", active: true },
  ];
  check(
    "pemilih subkategori hanya menawarkan milik kategori itu yang aktif",
    JSON.stringify(selectableSubcategoryNames(baris, "cat-semen")) ===
      JSON.stringify(["Semen Portland"]),
    JSON.stringify(selectableSubcategoryNames(baris, "cat-semen")),
  );
  check(
    "subkategori kategori lain tidak ikut ditawarkan",
    !selectableSubcategoryNames(baris, "cat-semen").includes("Besi Beton"),
    JSON.stringify(selectableSubcategoryNames(baris, "cat-semen")),
  );
  check(
    "subkategori nonaktif yang sedang dipakai produk tetap tersedia",
    JSON.stringify(selectableSubcategoryNames(baris, "cat-semen", "Semen Putih")) ===
      JSON.stringify(["Semen Portland", "Semen Putih"]),
    JSON.stringify(selectableSubcategoryNames(baris, "cat-semen", "Semen Putih")),
  );
  check(
    "produk tanpa kategori tidak menawarkan subkategori apa pun",
    JSON.stringify(selectableSubcategoryNames(baris, undefined)) === JSON.stringify([]),
    JSON.stringify(selectableSubcategoryNames(baris, undefined)),
  );
  check(
    "kategori aktif milik produk tidak didaftarkan dua kali",
    JSON.stringify(selectableSubcategoryNames(baris, "cat-semen", "Semen Portland")) ===
      JSON.stringify(["Semen Portland"]),
    JSON.stringify(selectableSubcategoryNames(baris, "cat-semen", "Semen Portland")),
  );
}
check(
  "jumlah produk per subkategori dihitung dari id yang ditunjuk produk",
  countProductsInSubcategory("sub-1", [
    { subcategoryId: "sub-1" },
    { subcategoryId: "sub-1" },
    { subcategoryId: "sub-2" },
  ]) === 2,
  String(
    countProductsInSubcategory("sub-1", [
      { subcategoryId: "sub-1" },
      { subcategoryId: "sub-1" },
      { subcategoryId: "sub-2" },
    ]),
  ),
);
check(
  "kalimat hapus subkategori kosong menyebut tidak ada produk",
  deleteSubcategorySentence("Semen Putih", 0).includes("tidak dipakai produk"),
  deleteSubcategorySentence("Semen Putih", 0),
);
check(
  "kalimat hapus subkategori menyebut jumlah produk & kategorinya tetap",
  deleteSubcategorySentence("Semen Putih", 4).includes("4 produk") &&
    deleteSubcategorySentence("Semen Putih", 4).includes("kategorinya tetap"),
  deleteSubcategorySentence("Semen Putih", 4),
);

// ------------------------------------------------------------------ duplikat
{
  const duplicate = validateCategoryName(
    { name: "kopi" },
    { existingNames: ["Kopi", "Makanan"] },
  );
  check(
    "nama yang sama (beda huruf besar) ditolak",
    !duplicate.ok && duplicate.reason.includes("sudah ada"),
    duplicate.ok ? "DITERIMA — duplikat lolos" : duplicate.reason,
  );
  check(
    "nama yang mirip tetapi berbeda tetap diterima",
    validateCategoryName({ name: "Kopi Susu" }, { existingNames: ["Kopi"] }).ok === true,
    JSON.stringify(validateCategoryName({ name: "Kopi Susu" }, { existingNames: ["Kopi"] })),
  );
}

// ------------------------------------------------------------------- batas
check(
  `batas ${MAX_CATEGORIES_PER_TENANT} kategori ditegakkan saat menambah`,
  validateCategoryName(
    { name: "Kategori Baru" },
    { count: MAX_CATEGORIES_PER_TENANT, existingNames: [] },
  ).ok === false,
  JSON.stringify(
    validateCategoryName(
      { name: "Kategori Baru" },
      { count: MAX_CATEGORIES_PER_TENANT, existingNames: [] },
    ),
  ),
);
check(
  "batas itu tidak menahan perbaikan nama kategori yang sudah ada",
  validateCategoryName({ name: "Kategori Baru" }, { existingNames: [] }).ok === true,
  JSON.stringify(validateCategoryName({ name: "Kategori Baru" }, { existingNames: [] })),
);

// -------------------------------------------------------------- status aktif
check(
  "baris kategori lama tanpa kolom aktif dianggap aktif",
  categoryIsActive({ name: "Kopi" }) &&
    categoryIsActive({ name: "Kopi", active: undefined }) &&
    categoryIsActive({ name: "Kopi", active: null }) &&
    !categoryIsActive({ name: "Kopi", active: false }),
  JSON.stringify([categoryIsActive({ name: "Kopi" }), categoryIsActive({ name: "Kopi", active: false })]),
);

// -------------------------------------------------- hitungan & pemilih produk
const katalog = [
  { category: "Kopi" },
  { category: "kopi" },
  { category: "Makanan" },
  { category: "Tanpa kategori" },
];
check(
  "jumlah produk per kategori tidak peduli huruf besar",
  countProductsInCategory("KOPI", katalog) === 2,
  String(countProductsInCategory("KOPI", katalog)),
);
check(
  "kategori tanpa produk dihitung nol",
  countProductsInCategory("Minuman", katalog) === 0,
  String(countProductsInCategory("Minuman", katalog)),
);

{
  const daftar = [
    { name: "Kopi", active: true },
    { name: "Makanan", active: false },
    { name: "Minuman", active: true },
  ];
  check(
    "produk baru hanya bisa memilih kategori aktif",
    JSON.stringify(selectableCategoryNames(daftar)) === JSON.stringify(["Kopi", "Minuman"]),
    JSON.stringify(selectableCategoryNames(daftar)),
  );
  check(
    "kategori produk itu sendiri tetap tersedia walau nonaktif",
    JSON.stringify(selectableCategoryNames(daftar, "Makanan")) ===
      JSON.stringify(["Kopi", "Minuman", "Makanan"]),
    JSON.stringify(selectableCategoryNames(daftar, "Makanan")),
  );
  check(
    "kategori aktif milik produk tidak didaftarkan dua kali",
    JSON.stringify(selectableCategoryNames(daftar, "Kopi")) ===
      JSON.stringify(["Kopi", "Minuman"]),
    JSON.stringify(selectableCategoryNames(daftar, "Kopi")),
  );
  check(
    "produk tanpa kategori tidak menambah pilihan apa pun",
    JSON.stringify(selectableCategoryNames(daftar, "Tanpa kategori")) ===
      JSON.stringify(["Kopi", "Minuman", "Tanpa kategori"]),
    JSON.stringify(selectableCategoryNames(daftar, "Tanpa kategori")),
  );
}

// --------------------------------------------------------------- tab POS
{
  const daftar = [
    { name: "Kopi", active: true },
    { name: "Makanan", active: false },
    { name: "Minuman", active: true },
    { name: "Snack", active: false },
  ];
  const chips = posCategoryChips(daftar, ["Kopi", "Makanan", "Jajanan Lama"]);
  check(
    "tab POS = kategori aktif + kategori nonaktif yang masih dipakai produk",
    JSON.stringify(chips) === JSON.stringify(["Kopi", "Minuman", "Makanan", "Jajanan Lama"]),
    JSON.stringify(chips),
  );
  check(
    "kategori nonaktif tanpa produk tidak muncul sebagai tab",
    !chips.includes("Snack"),
    JSON.stringify(chips),
  );
  check(
    "kategori yang sudah dipakai tapi barisnya hilang tetap dibuatkan tab",
    posCategoryChips([], ["Arsip Lama"]).includes("Arsip Lama"),
    JSON.stringify(posCategoryChips([], ["Arsip Lama"])),
  );
}

// ------------------------------------------------------- dampak hapus kategori
check(
  "kalimat hapus kategori kosong menyebut tidak ada produk",
  deleteCategorySentence("Sanitasi", 0).includes("tidak dipakai produk"),
  deleteCategorySentence("Sanitasi", 0),
);
check(
  "kalimat hapus kategori menyebut subkategori yang ikut terhapus",
  deleteCategorySentence("Semen & Mortar", 0, 2).includes("2 subkategori") &&
    !deleteCategorySentence("Semen & Mortar", 0, 0).includes("subkategori"),
  deleteCategorySentence("Semen & Mortar", 0, 2),
);
{
  const kalimat = deleteCategorySentence("Kopi", 3);
  check(
    "kalimat hapus kategori menyebut jumlah produk & nasib SKU-nya",
    kalimat.includes("3 produk") &&
      kalimat.includes(CATEGORY_NO_CATEGORY_LABEL) &&
      kalimat.includes("SKU-nya tidak ditulis ulang"),
    kalimat,
  );
}

console.log(`${results.length}/${results.length} checks passed`);

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
 *   2. ganti nama kategori diam-diam menulis ulang SKU produk (atau sebaliknya,
 *      halaman mengklaim kodenya berubah padahal tidak);
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
  categorySkuCode,
  countProductsInCategory,
  deleteCategorySentence,
  duplicateCategoryCodes,
  isReservedCategoryName,
  MAX_CATEGORIES_PER_TENANT,
  normalizeCategoryName,
  posCategoryChips,
  renamesSkuCode,
  selectableCategoryNames,
  validateCategoryName,
} from "../src/convex/lib/categories.ts";
import { PRODUCT_SKU_NO_CATEGORY_LABEL } from "../src/convex/lib/productSku.ts";

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

// “Tanpa kategori” berarti “tidak ada kategori” di seluruh aplikasi: tabel produk,
// pemilih kategori, dan kode SKU (`productSkuCategoryCode` → `UMU`). Nama itu harus
// dikenali dari bentuk apa pun, bukan hanya kalimat persisnya.
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
check(
  "label terlarang memang label yang dipakai SKU untuk “tanpa kategori”",
  categoryNameKey(CATEGORY_NO_CATEGORY_LABEL) === PRODUCT_SKU_NO_CATEGORY_LABEL,
  `${categoryNameKey(CATEGORY_NO_CATEGORY_LABEL)} vs ${PRODUCT_SKU_NO_CATEGORY_LABEL}`,
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

// ----------------------------------------------------------------- kode SKU
for (const [name, code] of [
  ["Sanitasi", "SAN"],
  ["Kopi", "KOP"],
  ["AB", "ABX"],
  ["", "UMU"],
  ["Tanpa kategori", "UMU"],
]) {
  check(
    `kode SKU kategori “${name}” = ${code}`,
    categorySkuCode(name) === code,
    categorySkuCode(name),
  );
}

check(
  "ganti nama yang mengubah kode SKU dikenali",
  renamesSkuCode("Makanan", "Minuman") === true,
  `${categorySkuCode("Makanan")} → ${categorySkuCode("Minuman")}`,
);
check(
  "ganti nama yang tidak mengubah kode SKU juga dikenali",
  renamesSkuCode("Sanitasi", "Sanitasi & Kebersihan") === false,
  `${categorySkuCode("Sanitasi")} → ${categorySkuCode("Sanitasi & Kebersihan")}`,
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

// ------------------------------------------------------- kode SKU yang bentrok
{
  const bentrok = duplicateCategoryCodes([
    { name: "Makanan" },
    { name: "Makmur" },
    { name: "Kopi" },
  ]);
  check(
    "dua kategori dengan kode SKU yang sama dilaporkan",
    bentrok.length === 1 &&
      bentrok[0].code === "MAK" &&
      bentrok[0].names.join(",") === "Makanan,Makmur",
    JSON.stringify(bentrok),
  );
  check(
    "kategori dengan kode berbeda tidak dilaporkan",
    duplicateCategoryCodes([{ name: "Kopi" }, { name: "Makanan" }]).length === 0,
    JSON.stringify(duplicateCategoryCodes([{ name: "Kopi" }, { name: "Makanan" }])),
  );
}

// ------------------------------------------------------- dampak hapus kategori
check(
  "kalimat hapus kategori kosong menyebut tidak ada produk",
  deleteCategorySentence("Sanitasi", 0).includes("tidak dipakai produk"),
  deleteCategorySentence("Sanitasi", 0),
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

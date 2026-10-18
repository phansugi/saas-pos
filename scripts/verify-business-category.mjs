/**
 * Uji aturan **kategori utama bisnis** (`tenants.setBusinessCategory`).
 *
 * Fitur ini menjanjikan dua hal yang mudah rusak diam-diam:
 *
 *   1. pilihan hanya boleh berasal dari taksonomi MesinPOS — bukan teks bebas —
 *      supaya kategori yang dikunci selamanya tetap bisa dibandingkan; dan
 *   2. setelah dipilih, pasangan kategori + subkategori **tidak bisa berubah**,
 *      termasuk oleh pemilik, sementara panggilan ulang dengan pasangan yang sama
 *      tidak boleh dianggap perubahan.
 *
 * Yang diuji adalah `src/convex/lib/businessCategory.ts` — modul murni yang
 * dipakai backend, kedua store, halaman onboarding, halaman Profil, dan harness.
 *
 * Usage: bun scripts/verify-business-category.mjs
 */
import {
  activeBusinessCategoryOptions,
  applyBusinessCategoryChange,
  BUSINESS_CATEGORIES,
  BUSINESS_CATEGORY_COUNT,
  BUSINESS_CATEGORY_LOCKED_NOTE,
  BUSINESS_LABEL_MAX,
  businessCategoryChoiceOf,
  businessCategoryDefinition,
  businessCategoryKeyFromLabel,
  businessCategoryOf,
  businessCategorySentence,
  businessSubcategoryDefinition,
  businessUsesTableService,
  defaultBusinessCategoryRows,
  lockBusinessCategory,
  MAX_BUSINESS_CATEGORIES,
  MAX_BUSINESS_SUBCATEGORIES,
  sameBusinessCategory,
  suggestedVerticalFor,
  validateBusinessCategory,
  validateBusinessLabel,
} from "../src/convex/lib/businessCategory.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// ------------------------------------------------------------------ taksonomi
check(
  `tersedia ${BUSINESS_CATEGORY_COUNT} kategori utama`,
  BUSINESS_CATEGORIES.length === BUSINESS_CATEGORY_COUNT && BUSINESS_CATEGORY_COUNT >= 5,
  String(BUSINESS_CATEGORIES.length),
);
{
  const keys = BUSINESS_CATEGORIES.map((row) => row.key);
  const labels = BUSINESS_CATEGORIES.map((row) => row.label);
  check(
    "kunci & label kategori tidak kembar",
    new Set(keys).size === keys.length && new Set(labels).size === labels.length,
    JSON.stringify({ keys, labels }),
  );
  check(
    "setiap kategori punya minimal 2 subkategori, kuncinya tidak kembar",
    BUSINESS_CATEGORIES.every((row) => {
      const subKeys = row.subcategories.map((sub) => sub.key);
      return row.subcategories.length >= 2 && new Set(subKeys).size === subKeys.length;
    }),
    JSON.stringify(BUSINESS_CATEGORIES.map((row) => [row.key, row.subcategories.length])),
  );
  check(
    "subkategori tidak pernah menjadi milik dua kategori",
    new Set(BUSINESS_CATEGORIES.flatMap((row) => row.subcategories.map((sub) => sub.key)))
      .size ===
      BUSINESS_CATEGORIES.flatMap((row) => row.subcategories.map((sub) => sub.key)).length,
    "kunci subkategori global",
  );
  check(
    "kunci kategori berbentuk slug yang aman disimpan",
    keys.every((key) => /^[a-z0-9-]+$/.test(key)),
    JSON.stringify(keys),
  );
}

// ------------------------------------------------------------------ pencarian
check(
  "kategori ditemukan lewat kunci maupun labelnya",
  businessCategoryDefinition("fnb")?.label === "Makanan & Minuman" &&
    businessCategoryDefinition("  MAKANAN & MINUMAN ")?.key === "fnb",
  JSON.stringify([
    businessCategoryDefinition("fnb"),
    businessCategoryDefinition("  MAKANAN & MINUMAN "),
  ]),
);
check(
  "kategori yang tidak dikenal dibaca kosong, bukan ditebak",
  businessCategoryDefinition("toko-bangunan") === null &&
    businessCategoryDefinition("") === null &&
    businessCategoryDefinition(undefined) === null,
  "unknown category",
);
check(
  "subkategori dicari di dalam kategori induknya",
  businessSubcategoryDefinition("fnb", "kafe")?.label === "Kafe & Kedai Kopi" &&
    businessSubcategoryDefinition("retail", "kafe") === null,
  JSON.stringify(businessSubcategoryDefinition("retail", "kafe")),
);

// ---------------------------------------------------------------- validasi
{
  const kosong = validateBusinessCategory({});
  check(
    "kategori wajib dipilih lebih dulu",
    !kosong.ok && kosong.reason.includes("Pilih kategori utama"),
    kosong.ok ? "DITERIMA" : kosong.reason,
  );

  const tanpaSub = validateBusinessCategory({ category: "fnb" });
  check(
    "subkategori wajib ikut dipilih",
    !tanpaSub.ok && tanpaSub.reason.includes("Pilih subkategori"),
    tanpaSub.ok ? "DITERIMA" : tanpaSub.reason,
  );

  const asing = validateBusinessCategory({ category: "toko-bangunan", subcategory: "x" });
  check(
    "kategori di luar taksonomi ditolak",
    !asing.ok && asing.reason.includes("tidak disediakan MesinPOS"),
    asing.ok ? "DITERIMA" : asing.reason,
  );

  const salahPasangan = validateBusinessCategory({
    category: "retail",
    subcategory: "kafe",
  });
  check(
    "subkategori milik kategori lain ditolak",
    !salahPasangan.ok && salahPasangan.reason.includes("bukan bagian dari kategori"),
    salahPasangan.ok ? "DITERIMA" : salahPasangan.reason,
  );

  const sah = validateBusinessCategory({
    category: "  MAKANAN & MINUMAN ",
    subcategory: " Kafe & Kedai Kopi ",
  });
  check(
    "label yang dikirim dipetakan ke kunci kanonik",
    sah.ok && sah.value.category === "fnb" && sah.value.subcategory === "kafe",
    JSON.stringify(sah),
  );

  const pilihan = businessCategoryChoiceOf("retail", "bangunan");
  check(
    "pratinjau pilihan memakai kunci kanonik, dan pasangan salah menjadi null",
    pilihan?.category === "retail" &&
      pilihan?.subcategory === "bangunan" &&
      businessCategoryChoiceOf("retail", "kafe") === null,
    JSON.stringify(pilihan),
  );
}

// ------------------------------------------------------- penguncian permanen
{
  const pertama = lockBusinessCategory({
    current: null,
    choice: { category: "fnb", subcategory: "kafe" },
    actorId: "user-owner",
    now: 1_770_000_000_000,
  });
  check(
    "pilihan pertama tersimpan lengkap dengan label, waktu, dan pemilik",
    pertama.ok &&
      pertama.changed === true &&
      pertama.value.category === "fnb" &&
      pertama.value.categoryLabel === "Makanan & Minuman" &&
      pertama.value.subcategory === "kafe" &&
      pertama.value.subcategoryLabel === "Kafe & Kedai Kopi" &&
      pertama.value.lockedAt === 1_770_000_000_000 &&
      pertama.value.lockedBy === "user-owner",
    JSON.stringify(pertama),
  );

  const ulang = lockBusinessCategory({
    current: pertama.ok ? pertama.value : null,
    choice: { category: "fnb", subcategory: "kafe" },
    actorId: "user-lain",
    now: 1_800_000_000_000,
  });
  check(
    "panggilan ulang dengan pasangan sama tidak menulis apa pun",
    ulang.ok && ulang.changed === false && ulang.value.lockedAt === 1_770_000_000_000,
    JSON.stringify(ulang),
  );

  const ganti = lockBusinessCategory({
    current: pertama.ok ? pertama.value : null,
    choice: { category: "retail", subcategory: "minimarket" },
    actorId: "user-owner",
    now: 1_800_000_000_000,
  });
  check(
    "pilihan berbeda ditolak selamanya dan menyebut nilai yang terkunci",
    !ganti.ok &&
      ganti.reason.includes("Makanan & Minuman") &&
      ganti.reason.includes("Kafe & Kedai Kopi") &&
      ganti.reason.includes("tidak bisa diubah lagi"),
    ganti.ok ? "DITERIMA — penguncian bocor" : ganti.reason,
  );

  const kosongkan = lockBusinessCategory({
    current: pertama.ok ? pertama.value : null,
    choice: { category: "", subcategory: "" },
    actorId: "user-owner",
  });
  check(
    "pengosongan juga ditolak",
    !kosongkan.ok,
    kosongkan.ok ? "DITERIMA — pilihan bisa dikosongkan" : kosongkan.reason,
  );

  const tanpaAktor = lockBusinessCategory({
    current: null,
    choice: { category: "retail", subcategory: "minimarket" },
    actorId: "",
    now: 1,
  });
  check(
    "penguncian tanpa aktor tetap tercatat sebagai nilai kosong (bukan crash)",
    tanpaAktor.ok && tanpaAktor.value.lockedBy === "",
    JSON.stringify(tanpaAktor),
  );
}

// ----------------------------------------------------------- membaca baris
check(
  "baris lama tanpa kolom dibaca sebagai belum dipilih",
  businessCategoryOf(undefined) === null &&
    businessCategoryOf(null) === null &&
    businessCategoryOf({}) === null,
  "legacy tenant",
);
{
  const terbaca = businessCategoryOf({
    businessCategory: {
      category: "retail",
      categoryLabel: "",
      subcategory: "bangunan",
      subcategoryLabel: "",
      lockedAt: 1_770_000_000_000,
      lockedBy: "user-owner",
    },
  });
  check(
    "label kosong di baris lama diisi dari taksonomi, kunci tetap dipakai",
    terbaca?.categoryLabel === "Perdagangan Eceran" &&
      terbaca?.subcategoryLabel === "Toko Bangunan & Material" &&
      terbaca?.lockedAt === 1_770_000_000_000,
    JSON.stringify(terbaca),
  );

  /*
    Kunci yang tidak lagi ada di taksonomi (kategori dihapus/diganti nama di
    backstage) **tetap terbaca**: pilihan yang sudah terkunci tidak boleh hilang
    hanya karena katalognya berubah. Labelnya sendiri yang jadi cadangan terakhir
    untuk kunci yang sudah tidak dikenal.
  */
  const taksonomiBerubah = businessCategoryOf({
    businessCategory: {
      category: "otomotif",
      subcategory: "bengkel-motor",
      lockedAt: 1,
      lockedBy: "x",
    },
  });
  check(
    "kunci yang sudah tidak ada di taksonomi tetap terbaca dengan label cadangannya",
    taksonomiBerubah?.category === "otomotif" &&
      taksonomiBerubah?.subcategory === "bengkel-motor" &&
      taksonomiBerubah?.categoryLabel === "otomotif" &&
      taksonomiBerubah?.subcategoryLabel === "bengkel-motor",
    JSON.stringify(taksonomiBerubah),
  );

  const rusakBetulan = businessCategoryOf({
    businessCategory: {
      category: "",
      subcategory: "",
      lockedAt: 1,
      lockedBy: "x",
    },
  });
  check(
    "baris yang benar-benar rusak (kunci kosong) dibaca kosong",
    rusakBetulan === null,
    String(rusakBetulan),
  );
}
{
  const a = businessCategoryOf({
    businessCategory: {
      category: "fnb",
      categoryLabel: "Makanan & Minuman",
      subcategory: "kafe",
      subcategoryLabel: "Kafe & Kedai Kopi",
      lockedAt: 10,
      lockedBy: "u",
    },
  });
  const b = { ...a };
  check(
    "pembanding nilai terkunci memakai pasangan, waktu, dan pemiliknya",
    sameBusinessCategory(a, b) && !sameBusinessCategory(a, null),
    JSON.stringify([a, b]),
  );
  check(
    "kalimat notis menyebut kategori, subkategori, dan janji permanen",
    businessCategorySentence(a).includes("Makanan & Minuman") &&
      businessCategorySentence(a).includes("Kafe & Kedai Kopi") &&
      businessCategorySentence(a).includes(BUSINESS_CATEGORY_LOCKED_NOTE),
    businessCategorySentence(a),
  );
  check(
    "belum dipilih dijelaskan sebagai pilihan sekali, bukan kosong tanpa arahan",
    businessCategorySentence(null).includes("belum dipilih") &&
      businessCategorySentence(null).includes("permanen"),
    businessCategorySentence(null),
  );
}

// ═══════════════════════════════════════ pengelolaan taksonomi (backstage)
{
  const baris = defaultBusinessCategoryRows();
  check(
    "bawaan tersedia sebagai baris tabel: urut, aktif semua, subkategori lengkap",
    baris.length === BUSINESS_CATEGORY_COUNT &&
      baris.every((row) => row.active && row.subcategories.every((sub) => sub.active)) &&
      baris.map((row) => row.key).join(",") ===
        BUSINESS_CATEGORIES.map((row) => row.key).join(","),
    JSON.stringify(baris.map((row) => [row.key, row.subcategories.length])),
  );

  const opsi = activeBusinessCategoryOptions(baris);
  check(
    "pemilih hanya menerima baris aktif & subkategori aktif",
    opsi.length === baris.length &&
      opsi[0].subcategories.every((sub) => typeof sub.key === "string") &&
      !("active" in (opsi[0] ?? {})),
    JSON.stringify(opsi[0]),
  );
  {
    const sebagian = activeBusinessCategoryOptions([
      { ...baris[0], active: false },
      {
        ...baris[1],
        subcategories: baris[1].subcategories.map((sub, index) =>
          index === 0 ? { ...sub, active: false } : sub,
        ),
      },
    ]);
    check(
      "kategori nonaktif hilang dan subkategori nonaktif tidak ikut ditawarkan",
      sebagian.length === 1 &&
        sebagian[0].key === baris[1].key &&
        !sebagian[0].subcategories.some((sub) => sub.key === baris[1].subcategories[0].key),
      JSON.stringify(sebagian),
    );
  }
}

// ------------------------------------------------- kunci stabil & validasi label
for (const [label, key] of [
  ["Otomotif", "otomotif"],
  ["Suku Cadang & Aksesori", "suku-cadang-aksesori"],
  ["  Bengkel   Motor  ", "bengkel-motor"],
]) {
  check(
    `kunci baru dari “${label}” = ${key}`,
    businessCategoryKeyFromLabel(label) === key,
    businessCategoryKeyFromLabel(label),
  );
}
check(
  "kunci yang sudah dipakai mendapat akhiran -2, -3, …",
  businessCategoryKeyFromLabel("Otomotif", ["otomotif", "otomotif-2"]) === "otomotif-3",
  businessCategoryKeyFromLabel("Otomotif", ["otomotif", "otomotif-2"]),
);
check(
  "label tanpa huruf/angka tetap menghasilkan kunci yang aman",
  businessCategoryKeyFromLabel("!!!") === "kategori" &&
    businessCategoryKeyFromLabel("¶¶ ¶¶") === "kategori",
  businessCategoryKeyFromLabel("¶¶ ¶¶"),
);

for (const [nama, input, expected] of [
  ["terlalu pendek", { label: "A", kind: "kategori" }, "2–40"],
  [
    "terlalu panjang",
    { label: "K".repeat(BUSINESS_LABEL_MAX + 1), kind: "kategori" },
    "2–40",
  ],
  ["tanpa huruf/angka", { label: "!!!", kind: "kategori" }, "huruf atau angka"],
  [
    "nama kembar",
    { label: "  makanan   & MINUMAN ", kind: "kategori", existingLabels: ["Makanan & Minuman"] },
    "sudah ada",
  ],
  [
    "batas jumlah tercapai",
    { label: "Otomotif", kind: "kategori", count: MAX_BUSINESS_CATEGORIES },
    "Maksimal 40 kategori",
  ],
]) {
  const hasil = validateBusinessLabel(input);
  check(
    `label ditolak: ${nama}`,
    !hasil.ok && hasil.reason.includes(expected),
    hasil.ok ? "DITERIMA — validasi bocor" : hasil.reason,
  );
}
check(
  "batas subkategori memakai angka subkategori, bukan kategori",
  validateBusinessLabel({
    label: "Bengkel Motor",
    kind: "subkategori",
    count: MAX_BUSINESS_SUBCATEGORIES,
    max: MAX_BUSINESS_SUBCATEGORIES,
  }).ok === false &&
    validateBusinessLabel({ label: "Bengkel Motor", kind: "subkategori" }).ok === true,
  JSON.stringify(
    validateBusinessLabel({
      label: "Bengkel Motor",
      kind: "subkategori",
      count: MAX_BUSINESS_SUBCATEGORIES,
      max: MAX_BUSINESS_SUBCATEGORIES,
    }),
  ),
);
check(
  "label yang valid dirapikan tanpa mengubah hurufnya",
  validateBusinessLabel({ label: "  Suku   Cadang ", kind: "kategori" }).value ===
    "Suku Cadang",
  JSON.stringify(validateBusinessLabel({ label: "  Suku   Cadang ", kind: "kategori" })),
);

// ------------------------------------------------------- perubahan taksonomi
{
  const awal = defaultBusinessCategoryRows();
  const kategoriBaru = applyBusinessCategoryChange(awal, {
    type: "createCategory",
    label: "Otomotif",
  });
  check(
    "kategori baru dibuat nonaktif dengan kunci dari namanya",
    kategoriBaru.ok &&
      kategoriBaru.rows.length === awal.length + 1 &&
      kategoriBaru.rows.at(-1)?.key === "otomotif" &&
      kategoriBaru.rows.at(-1)?.active === false &&
      kategoriBaru.sentence.includes("nonaktif"),
    JSON.stringify(kategoriBaru.ok ? kategoriBaru.rows.at(-1) : kategoriBaru),
  );
  const setelahTambah = kategoriBaru.ok ? kategoriBaru.rows : awal;

  const aktifTanpaSub = applyBusinessCategoryChange(setelahTambah, {
    type: "setCategoryActive",
    key: "otomotif",
    active: true,
  });
  check(
    "kategori tanpa subkategori aktif tidak bisa diaktifkan",
    !aktifTanpaSub.ok && aktifTanpaSub.reason.includes("belum punya subkategori aktif"),
    aktifTanpaSub.ok ? "DITERIMA" : aktifTanpaSub.reason,
  );

  const subBaru = applyBusinessCategoryChange(setelahTambah, {
    type: "createSubcategory",
    categoryKey: "otomotif",
    label: "Bengkel Motor",
  });
  check(
    "subkategori baru lahir aktif di bawah kategorinya",
    subBaru.ok &&
      subBaru.rows.find((row) => row.key === "otomotif")?.subcategories.length === 1 &&
      subBaru.sentence.includes("Bengkel Motor"),
    JSON.stringify(subBaru.ok ? subBaru.rows.at(-1) : subBaru),
  );
  const denganSub = subBaru.ok ? subBaru.rows : setelahTambah;

  const aktif = applyBusinessCategoryChange(denganSub, {
    type: "setCategoryActive",
    key: "otomotif",
    active: true,
  });
  check(
    "kategori bisa diaktifkan setelah punya subkategori aktif",
    aktif.ok && aktif.rows.find((row) => row.key === "otomotif")?.active === true,
    JSON.stringify(aktif),
  );
  const aktifRows = aktif.ok ? aktif.rows : denganSub;

  const gantiNama = applyBusinessCategoryChange(aktifRows, {
    type: "renameCategory",
    key: "otomotif",
    label: "Otomotif & Suku Cadang",
  });
  check(
    "ganti nama kategori tidak mengubah kuncinya",
    gantiNama.ok &&
      gantiNama.rows.find((row) => row.key === "otomotif")?.label ===
        "Otomotif & Suku Cadang",
    JSON.stringify(gantiNama.ok ? gantiNama.rows.at(-1) : gantiNama),
  );
  const namaKembar = applyBusinessCategoryChange(aktifRows, {
    type: "renameCategory",
    key: "otomotif",
    label: "makanan & minuman",
  });
  check(
    "nama kategori kembar ditolak",
    !namaKembar.ok && namaKembar.reason.includes("sudah ada"),
    namaKembar.ok ? "DITERIMA" : namaKembar.reason,
  );

  const matikanKategori = applyBusinessCategoryChange(aktifRows, {
    type: "setCategoryActive",
    key: "otomotif",
    active: false,
  });
  const kategoriMati = matikanKategori.ok ? matikanKategori.rows : aktifRows;
  const matikanSubTerakhir = applyBusinessCategoryChange(kategoriMati, {
    type: "setSubcategoryActive",
    categoryKey: "otomotif",
    key: "bengkel-motor",
    active: false,
  });
  check(
    "subkategori terakhir boleh dimatikan setelah kategorinya nonaktif",
    matikanSubTerakhir.ok,
    matikanSubTerakhir.ok ? "ok" : matikanSubTerakhir.reason,
  );
  const semuaMati = matikanSubTerakhir.ok ? matikanSubTerakhir.rows : kategoriMati;
  const aktifkanLagi = applyBusinessCategoryChange(semuaMati, {
    type: "setCategoryActive",
    key: "otomotif",
    active: true,
  });
  check(
    "kategori tanpa subkategori aktif tetap ditolak saat diaktifkan lagi",
    !aktifkanLagi.ok,
    aktifkanLagi.ok ? "DITERIMA" : aktifkanLagi.reason,
  );

  const hapus = applyBusinessCategoryChange(aktifRows, {
    type: "removeCategory",
    key: "otomotif",
  });
  check(
    "hapus kategori membawa serta subkategorinya dan menyebut jumlahnya",
    hapus.ok &&
      !hapus.rows.some((row) => row.key === "otomotif") &&
      hapus.sentence.includes("1 subkategorinya"),
    hapus.ok ? hapus.sentence : hapus.reason,
  );

  // Pagar terakhir: katalog tidak boleh kosong dari kategori aktif.
  let tiris = awal.map((row) => ({ ...row, active: false }));
  tiris = tiris.map((row) => ({ ...row, subcategories: [] }));
  const semuaNonaktif = tiris.map((row, index) =>
    index === 0 ? { ...row, active: true } : row,
  );
  const kosongkanKategori = applyBusinessCategoryChange(semuaNonaktif, {
    type: "setCategoryActive",
    key: semuaNonaktif[0].key,
    active: false,
  });
  check(
    "kategori aktif terakhir tidak bisa dinonaktifkan",
    !kosongkanKategori.ok &&
      kosongkanKategori.reason.includes("Minimal satu kategori aktif"),
    kosongkanKategori.ok ? "DITERIMA" : kosongkanKategori.reason,
  );
  const hapusTerakhir = applyBusinessCategoryChange(semuaNonaktif, {
    type: "removeCategory",
    key: semuaNonaktif[0].key,
  });
  check(
    "kategori aktif terakhir juga tidak bisa dihapus",
    !hapusTerakhir.ok,
    hapusTerakhir.ok ? "DITERIMA" : hapusTerakhir.reason,
  );
}

// ----------------------------------- validasi pilihan memakai katalog dinamis
{
  const katalog = [
    {
      key: "otomotif",
      label: "Otomotif",
      active: true,
      sortOrder: 0,
      subcategories: [
        { key: "bengkel-motor", label: "Bengkel Motor", active: true, sortOrder: 0 },
        { key: "mobil", label: "Bengkel Mobil", active: false, sortOrder: 1 },
      ],
    },
    {
      key: "arsip",
      label: "Kategori Lama",
      active: false,
      sortOrder: 1,
      subcategories: [
        { key: "umum", label: "Umum", active: true, sortOrder: 0 },
      ],
    },
  ];

  check(
    "kategori nonaktif ditolak dengan alasan yang menyebut nonaktif",
    (() => {
      const hasil = validateBusinessCategory(
        { category: "arsip", subcategory: "umum" },
        katalog,
      );
      return !hasil.ok && hasil.reason.includes("dinonaktifkan");
    })(),
    JSON.stringify(validateBusinessCategory({ category: "arsip", subcategory: "umum" }, katalog)),
  );
  check(
    "subkategori nonaktif ditolak dengan alasan yang menyebut nonaktif",
    (() => {
      const hasil = validateBusinessCategory(
        { category: "otomotif", subcategory: "mobil" },
        katalog,
      );
      return !hasil.ok && hasil.reason.includes("dinonaktifkan");
    })(),
    JSON.stringify(validateBusinessCategory({ category: "otomotif", subcategory: "mobil" }, katalog)),
  );

  const kunci = lockBusinessCategory({
    current: null,
    choice: { category: "otomotif", subcategory: "bengkel-motor" },
    actorId: "pemilik",
    now: 42,
    catalog: katalog,
  });
  check(
    "kategori buatan backstage bisa dikunci dengan labelnya sendiri",
    kunci.ok &&
      kunci.value.categoryLabel === "Otomotif" &&
      kunci.value.subcategoryLabel === "Bengkel Motor",
    JSON.stringify(kunci),
  );
  const tersimpan = businessCategoryOf({ businessCategory: kunci.ok ? kunci.value : null });
  check(
    "nilai terkunci tetap terbaca walau barisnya kelak dihapus dari katalog",
    tersimpan?.categoryLabel === "Otomotif" &&
      businessCategoryOf({ businessCategory: tersimpan })?.subcategory === "bengkel-motor",
    JSON.stringify(tersimpan),
  );
}

// -------------------------------------------------------------- saran modul
for (const [category, vertical] of [
  ["fnb", "fnb"],
  ["wholesale", "wholesale"],
  ["retail", "umkm"],
  ["service", "umkm"],
  ["production", "umkm"],
  ["other", "umkm"],
]) {
  check(
    `saran modul untuk ${category} = ${vertical}`,
    suggestedVerticalFor(category) === vertical,
    suggestedVerticalFor(category),
  );
}

/*
  ------------------------------------------------------- alur meja & dapur

  Modul F&B boleh dinyalakan siapa saja (dan paket Enterprise memuat semuanya),
  jadi pilihan kategori yang menentukan apakah denah meja, antrean dapur, dan
  modifier ditawarkan. Yang diuji di sini **batasnya**: bisnis yang jelas bukan
  layanan meja harus mati, sedangkan pilihan yang tidak bisa dipastikan —
  termasuk workspace lama yang belum memilih — tetap hidup supaya modul tetap
  menjadi satu-satunya penentu di situ.
*/
for (const [category, expected, alasan] of [
  ["fnb", true, "kafe/restoran memang berlayanan meja"],
  ["retail", false, "toko eceran melayani pembeli di kasir"],
  ["wholesale", false, "distributor menjual ke pedagang"],
  ["service", false, "jasa tidak punya tamu duduk"],
  ["production", false, "produsen tidak melayani tamu"],
  ["other", true, "tidak bisa dipastikan: modul yang menentukan"],
]) {
  check(
    `alur meja untuk kategori ${category} = ${expected} (${alasan})`,
    businessUsesTableService({ category }) === expected,
    String(businessUsesTableService({ category })),
  );
}

check(
  "workspace tanpa kategori tetap memakai modul sebagai penentu",
  businessUsesTableService({}) === true &&
    businessUsesTableService({ category: null }) === true &&
    businessUsesTableService({ category: "" }) === true,
  String(businessUsesTableService({})),
);

check(
  "kategori bisnis backstage yang tidak dikenal tidak diam-diam mematikan alur meja",
  businessUsesTableService({ category: "kategori-buatan-backstage" }) === true,
  String(businessUsesTableService({ category: "kategori-buatan-backstage" })),
);

check(
  "penulisan kategori (huruf besar & spasi) tidak mengubah jawabannya",
  businessUsesTableService({ category: "  RETAIL " }) === false &&
    businessUsesTableService({ category: " FnB " }) === true,
  String(businessUsesTableService({ category: "  RETAIL " })),
);

check(
  "subkategori ikut dibaca tanpa mengubah aturan kategorinya",
  businessUsesTableService({ category: "retail", subcategory: "bangunan" }) === false &&
    businessUsesTableService({ category: "fnb", subcategory: "kafe" }) === true,
  String(businessUsesTableService({ category: "retail", subcategory: "bangunan" })),
);

check(
  "setiap kategori taksonomi dijawab tanpa melempar",
  BUSINESS_CATEGORIES.every((row) =>
    typeof businessUsesTableService({ category: row.key }) === "boolean",
  ),
  BUSINESS_CATEGORIES.map((row) => `${row.key}=${businessUsesTableService({ category: row.key })}`).join(", "),
);

console.log(`${results.length}/${results.length} checks passed`);

/**
 * Uji aturan SKU otomatis tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/productSku.ts` — modul murni yang dipakai
 * tombol **Buat SKU otomatis** di halaman Produk & Stok, store demo,
 * `products.create`, dan `products.setCategory` di server. Karena formatnya satu,
 * SKU yang dihasilkan klien dan server tidak mungkin berbeda bentuk — termasuk saat
 * **kategori produk diganti**: kode di tengah SKU harus ikut kategori barunya.
 *
 * Format yang dijaga di sini: `PBB-<KATEGORI>-<nomor urut>` (contoh
 * `PBB-SAN-000042`).
 *
 * Usage: bun scripts/verify-product-sku.mjs
 */
import {
  formatProductSku,
  isGeneratedProductSku,
  nextProductSkuSequence,
  parseProductSkuSequence,
  productSkuCategoryCode,
  productSkuSequenceText,
  PRODUCT_SKU_PREFIX,
  PRODUCT_SKU_SEQUENCE_DIGITS,
  recodeProductSku,
  suggestProductSku,
} from "../src/convex/lib/productSku.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// --------------------------------------------------------------- bentuk SKU
check("prefix SKU PBB", PRODUCT_SKU_PREFIX === "PBB", PRODUCT_SKU_PREFIX);
check("nomor urut enam digit", PRODUCT_SKU_SEQUENCE_DIGITS === 6, String(PRODUCT_SKU_SEQUENCE_DIGITS));
check(
  "contoh dari permintaan terbentuk persis (PBB-SAN-000042)",
  formatProductSku({ category: "Sanitasi", sequence: 42 }) === "PBB-SAN-000042",
  formatProductSku({ category: "Sanitasi", sequence: 42 }),
);

// ------------------------------------------------------------ kode kategori
const codes = [
  ["Sanitasi", "SAN"],
  ["Minuman", "MIN"],
  ["Makanan", "MAK"],
  ["Snack", "SNA"],
  ["Kopi", "KOP"],
  ["kopi", "KOP"],
  ["Kopi Susu", "KOP"],
  ["Kopi-Susu", "KOP"],
  ["A B", "ABX"],
  ["12", "12X"],
  ["123", "123"],
  ["K", "KXX"],
];
for (const [name, expected] of codes) {
  check(
    `kode kategori "${name}" → ${expected}`,
    productSkuCategoryCode(name) === expected,
    productSkuCategoryCode(name),
  );
}
check(
  "tanpa kategori memakai UMU",
  productSkuCategoryCode(undefined) === "UMU" &&
    productSkuCategoryCode(null) === "UMU" &&
    productSkuCategoryCode("") === "UMU" &&
    productSkuCategoryCode("  ") === "UMU" &&
    productSkuCategoryCode("!!!") === "UMU",
  `${productSkuCategoryCode(undefined)} | ${productSkuCategoryCode("!!!")}`,
);

// ------------------------------------------------------------- nomor urut
const sequences = [
  [1, "000001"],
  [42, "000042"],
  [999999, "999999"],
  [1000000, "1000000"],
  [0, "000001"],
  [-5, "000001"],
  [7.9, "000007"],
];
for (const [value, expected] of sequences) {
  check(
    `nomor ${value} → ${expected}`,
    productSkuSequenceText(value) === expected,
    productSkuSequenceText(value),
  );
}

// ------------------------------------------------------- baca & nomor lanjut
check(
  "SKU buatan sistem dikenali",
  isGeneratedProductSku("PBB-SAN-000042") &&
    isGeneratedProductSku("pbb-min-000007") &&
    isGeneratedProductSku(" PBB-UMU-000001 ") === true,
  "tidak dikenali",
);
check(
  "SKU di luar format tidak dianggap buatan sistem",
  !isGeneratedProductSku("KOPI-01") &&
    !isGeneratedProductSku("PBB-SAN-42") &&
    !isGeneratedProductSku("PBB-SAN-000042-EXTRA") &&
    !isGeneratedProductSku("XS-SAN-000042") &&
    !isGeneratedProductSku(""),
  "salah dikenali",
);
check(
  "nomor bisa dibaca balik",
  parseProductSkuSequence("PBB-SAN-000042") === 42 &&
    parseProductSkuSequence("KOPI-01") === null,
  String(parseProductSkuSequence("PBB-SAN-000042")),
);
check(
  "nomor lanjut = tertinggi + 1, SKU lain diabaikan",
  nextProductSkuSequence([]) === 1 &&
    nextProductSkuSequence(["KOPI-01", "ROTI"]) === 1 &&
    nextProductSkuSequence(["PBB-SAN-000042"]) === 43 &&
    nextProductSkuSequence(["PBB-SAN-000042", "PBB-MIN-000007"]) === 43 &&
    nextProductSkuSequence(["PBB-MIN-000007", "KOPI-01"]) === 8,
  `${nextProductSkuSequence([])} | ${nextProductSkuSequence(["PBB-SAN-000042"])} | ${nextProductSkuSequence([
    "PBB-SAN-000042",
    "PBB-MIN-000007",
  ])}`,
);

// ------------------------------------------------------- usulan lengkap
check(
  "usulan SKU melanjutkan nomor kategori apa pun (contoh permintaan)",
  suggestProductSku({ category: "Sanitasi", takenSkus: ["PBB-SAN-000041"] }) === "PBB-SAN-000042",
  suggestProductSku({ category: "Sanitasi", takenSkus: ["PBB-SAN-000041"] }),
);
check(
  "usulan pertama untuk katalog kosong",
  suggestProductSku({ category: undefined, takenSkus: [] }) === "PBB-UMU-000001",
  suggestProductSku({ category: undefined, takenSkus: [] }),
);

// 20 usulan berturut-turut harus semuanya berbeda & naik satu-satu.
{
  const taken = [];
  for (let index = 0; index < 20; index += 1) {
    taken.push(suggestProductSku({ category: "Makanan", takenSkus: taken }));
  }
  const unique = new Set(taken);
  check(
    "20 usulan berturut-turut unik dan berurutan",
    unique.size === 20 &&
      taken[0] === "PBB-MAK-000001" &&
      taken[19] === "PBB-MAK-000020",
    `${taken[0]} … ${taken[19]} (unik: ${unique.size})`,
  );
  check(
    "kategori berbeda memakai nomor yang tetap unik",
    (() => {
      const mixed = [];
      mixed.push(suggestProductSku({ category: "Kopi", takenSkus: mixed }));
      mixed.push(suggestProductSku({ category: "Snack", takenSkus: mixed }));
      return mixed[0] === "PBB-KOP-000001" && mixed[1] === "PBB-SNA-000002";
    })(),
    "-",
  );
}

// ------------------------------------------------- kategori berubah → SKU ikut
// Inilah yang dipakai `products.setCategory` (dan store demo): kode di tengah SKU
// harus mengikuti kategori yang sekarang dipilih, tanpa kehilangan nomor urutnya.
check(
  "kategori berubah → kode SKU ikut, nomor urut dipertahankan (contoh permintaan)",
  recodeProductSku({
    sku: "PBB-SAN-000042",
    category: "Makanan",
    takenSkus: ["PBB-KOP-000001", "PBB-MAK-000007"],
  }) === "PBB-MAK-000042",
  recodeProductSku({
    sku: "PBB-SAN-000042",
    category: "Makanan",
    takenSkus: ["PBB-KOP-000001", "PBB-MAK-000007"],
  }),
);
check(
  "kategori dilepas → kode kembali UMU",
  recodeProductSku({ sku: "PBB-MAK-000042", category: undefined, takenSkus: [] }) ===
    "PBB-UMU-000042",
  recodeProductSku({ sku: "PBB-MAK-000042", category: undefined, takenSkus: [] }),
);
check(
  "kategori tak berubah → SKU tidak berubah",
  recodeProductSku({ sku: "PBB-MAK-000042", category: "MAKANAN", takenSkus: [] }) ===
    "PBB-MAK-000042",
  recodeProductSku({ sku: "PBB-MAK-000042", category: "MAKANAN", takenSkus: [] }),
);
check(
  "label “Tanpa kategori” dihitung sebagai tanpa kategori (UMU)",
  productSkuCategoryCode("Tanpa kategori") === "UMU" &&
    productSkuCategoryCode("tanpa kategori") === "UMU" &&
    productSkuCategoryCode(undefined) === "UMU",
  `${productSkuCategoryCode("Tanpa kategori")}/${productSkuCategoryCode("tanpa kategori")}`,
);
check(
  "SKU yang diketik pemilik toko TIDAK ikut berubah",
  recodeProductSku({ sku: "KOPI-01", category: "Makanan", takenSkus: [] }) === "KOPI-01" &&
    recodeProductSku({ sku: "kopi-susu", category: "Kopi", takenSkus: [] }) === "kopi-susu",
  recodeProductSku({ sku: "KOPI-01", category: "Makanan", takenSkus: [] }),
);
check(
  "nomor yang sudah terpakai di kategori baru → nomor berikutnya yang bebas",
  recodeProductSku({
    sku: "PBB-SAN-000042",
    category: "Makanan",
    takenSkus: ["PBB-MAK-000042", "PBB-MAK-000050"],
  }) === "PBB-MAK-000051",
  recodeProductSku({
    sku: "PBB-SAN-000042",
    category: "Makanan",
    takenSkus: ["PBB-MAK-000042", "PBB-MAK-000050"],
  }),
);
{
  // Beberapa produk dipindah kategori satu per satu, seperti di server: setiap
  // pemindahan melihat katalog yang **sudah** memuat hasil pemindahan sebelumnya.
  // Hasilnya tidak boleh pernah menabrak SKU yang sudah ada — termasuk saat nomor
  // lamanya kebetulan sudah dipakai di kategori tujuan.
  // `takenSkus` adalah SKU produk **lain**; SKU produk yang sedang dipindah tidak
  // ikut (kalau ikut, nomornya sendiri akan dianggap bentrok).
  let taken = ["PBB-MAK-000001", "PBB-MAK-000002", "PBB-UMU-000003"];
  const sebelum = taken.length;
  const hasil = [];
  const pindah = [
    ["PBB-UMU-000001", "Makanan"],
    ["PBB-UMU-000002", "Makanan"],
    ["PBB-MAK-000003", "Snack"],
    ["PBB-SAN-000002", "Minuman"],
    ["KOPI-01", "Gudang"],
  ];
  for (const [sku, category] of pindah) {
    const skuBaru = recodeProductSku({ sku, category, takenSkus: taken });
    hasil.push(skuBaru);
    taken = [...taken, skuBaru];
  }
  check(
    "hasil recode tidak pernah bentrok dengan SKU yang sudah ada",
    hasil.every((sku) => !taken.slice(0, sebelum).includes(sku)) &&
      new Set(hasil).size === hasil.length,
    JSON.stringify(hasil),
  );
  check(
    "SKU manual tetap utuh walau kategori produknya dipindah",
    hasil.at(-1) === "KOPI-01",
    hasil.at(-1),
  );
}

console.log(`${results.length}/${results.length} checks passed`);

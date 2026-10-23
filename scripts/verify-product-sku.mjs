/**
 * Uji aturan SKU otomatis tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/productSku.ts` — modul murni yang dipakai
 * tombol **Buat SKU otomatis** di halaman Produk & Stok, store demo, dan
 * `products.create` di server. Karena formatnya satu, SKU yang dihasilkan klien dan
 * server tidak mungkin berbeda bentuk.
 *
 * Format yang dijaga di sini: `PBB-<nomor urut>` (contoh `PBB-0000042`). Kategori
 * **tidak** ikut di dalam SKU, jadi mengganti kategori tidak pernah mengubah SKU.
 *
 * Usage: bun scripts/verify-product-sku.mjs
 */
import {
  formatProductSku,
  isGeneratedProductSku,
  nextProductSkuSequence,
  parseProductSkuSequence,
  productSkuSequenceText,
  PRODUCT_SKU_PREFIX,
  PRODUCT_SKU_SEQUENCE_DIGITS,
  suggestProductSku,
} from "../src/convex/lib/productSku.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// --------------------------------------------------------------- bentuk SKU
check("prefix SKU PBB", PRODUCT_SKU_PREFIX === "PBB", PRODUCT_SKU_PREFIX);
check(
  "nomor urut tujuh digit",
  PRODUCT_SKU_SEQUENCE_DIGITS === 7,
  String(PRODUCT_SKU_SEQUENCE_DIGITS),
);
check(
  "contoh dari permintaan terbentuk persis (PBB-0000042)",
  formatProductSku({ sequence: 42 }) === "PBB-0000042",
  formatProductSku({ sequence: 42 }),
);
check(
  "format tidak lagi memuat kode kategori",
  formatProductSku({ sequence: 42 }).split("-").length === 2,
  formatProductSku({ sequence: 42 }),
);

// ------------------------------------------------------------- nomor urut
const sequences = [
  [1, "0000001"],
  [42, "0000042"],
  [9999999, "9999999"],
  [10000000, "10000000"],
  [0, "0000001"],
  [-5, "0000001"],
  [7.9, "0000007"],
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
  isGeneratedProductSku("PBB-0000042") &&
    isGeneratedProductSku("pbb-0000007") &&
    isGeneratedProductSku(" PBB-0000001 ") === true,
  "tidak dikenali",
);
check(
  "SKU di luar format tidak dianggap buatan sistem",
  !isGeneratedProductSku("KOPI-01") &&
    !isGeneratedProductSku("PBB-00042") &&
    !isGeneratedProductSku("PBB-SAN-000042") &&
    !isGeneratedProductSku("PBB-0000042-EXTRA") &&
    !isGeneratedProductSku("XS-0000042") &&
    !isGeneratedProductSku(""),
  "salah dikenali",
);
check(
  "nomor bisa dibaca balik",
  parseProductSkuSequence("PBB-0000042") === 42 &&
    parseProductSkuSequence("KOPI-01") === null &&
    parseProductSkuSequence("PBB-SAN-000042") === null,
  `${parseProductSkuSequence("PBB-0000042")} | ${parseProductSkuSequence("PBB-SAN-000042")}`,
);
check(
  "nomor lanjut = tertinggi + 1, SKU lain diabaikan",
  nextProductSkuSequence([]) === 1 &&
    nextProductSkuSequence(["KOPI-01", "ROTI", "PBB-SAN-000042"]) === 1 &&
    nextProductSkuSequence(["PBB-0000042"]) === 43 &&
    nextProductSkuSequence(["PBB-0000042", "PBB-0000007"]) === 43 &&
    nextProductSkuSequence(["PBB-0000007", "KOPI-01"]) === 8,
  `${nextProductSkuSequence([])} | ${nextProductSkuSequence(["PBB-0000042"])} | ${nextProductSkuSequence([
    "PBB-0000042",
    "PBB-0000007",
  ])}`,
);

// ------------------------------------------------------- usulan lengkap
check(
  "usulan SKU melanjutkan nomor yang sudah ada (contoh permintaan)",
  suggestProductSku({ takenSkus: ["PBB-0000041"] }) === "PBB-0000042",
  suggestProductSku({ takenSkus: ["PBB-0000041"] }),
);
check(
  "usulan pertama untuk katalog kosong",
  suggestProductSku({ takenSkus: [] }) === "PBB-0000001",
  suggestProductSku({ takenSkus: [] }),
);

// 20 usulan berturut-turut harus semuanya berbeda & naik satu-satu.
{
  const taken = [];
  for (let index = 0; index < 20; index += 1) {
    taken.push(suggestProductSku({ takenSkus: taken }));
  }
  const unique = new Set(taken);
  check(
    "20 usulan berturut-turut unik dan berurutan",
    unique.size === 20 && taken[0] === "PBB-0000001" && taken[19] === "PBB-0000020",
    `${taken[0]} … ${taken[19]} (unik: ${unique.size})`,
  );
  check(
    "nomor tidak pernah dipakai dua kali walau katalognya bercampur",
    (() => {
      const mixed = ["KOPI-01", ...taken, "PBB-SAN-000020"];
      const next = suggestProductSku({ takenSkus: mixed });
      return next === "PBB-0000021";
    })(),
    suggestProductSku({ takenSkus: ["KOPI-01", ...taken, "PBB-SAN-000020"] }),
  );
}

// ------------------------------------------------- kategori tidak di SKU
// Ini yang menjaga perilaku “pindah kategori tidak menulis ulang SKU”: formatnya
// tidak punya tempat untuk kode kategori sama sekali.
check(
  "SKU lama berformat kategori tetap terbaca sebagai SKU manual, bukan buatan sistem",
  !isGeneratedProductSku("PBB-UMU-000001") &&
    !isGeneratedProductSku("PBB-MAK-000003") &&
    parseProductSkuSequence("PBB-UMU-000001") === null,
  `${isGeneratedProductSku("PBB-UMU-000001")}`,
);

console.log(`${results.length}/${results.length} checks passed`);

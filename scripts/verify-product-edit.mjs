/**
 * Uji aturan produk yang **sudah tersimpan** tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/productEdit.ts` — modul murni yang dipakai
 * halaman Produk & Stok, kedua store (demo & Convex), `products.update`,
 * `products.setActive`, `products.deletionCheck`, dan `products.remove` di server.
 * Karena aturannya satu, produk yang boleh dihapus menurut halaman tidak mungkin
 * berbeda dari yang diterima server.
 *
 * Tiga hal yang dijaga di sini:
 *  1. **ubah identitas** (nama/SKU/harga beli) — batas nama, bentuk SKU, SKU kembar
 *     tanpa peduli huruf besar-kecil, harga beli negatif, dan `changed` yang kosong
 *     saat tidak ada yang berubah;
 *  2. **aktif/nonaktif** — kalimatnya menyebut nasib produknya (hilang dari kasir,
 *     data & riwayat tetap ada) dan tetap menyebut stok yang tertinggal;
 *  3. **pagar hapus** — produk yang sudah terjual/berstok/bergerak/dipakai dokumen
 *     pembelian/opname ditolak dengan alasan satu per satu, dan yang belum pernah
 *     dipakai apa pun boleh dihapus.
 *
 * Usage: bun scripts/verify-product-edit.mjs
 */
import {
  EMPTY_PRODUCT_USAGE,
  normalizeProductName,
  normalizeProductSku,
  PRODUCT_NAME_MAX,
  PRODUCT_NAME_MIN,
  PRODUCT_SKU_MAX,
  productDeletionBlockers,
  productDeletionCheck,
  productStatusSentence,
  validateProductIdentity,
} from "../src/convex/lib/productEdit.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const KOPI = { name: "Kopi Susu", sku: "KOPI-01", cost: 12000 };

// ------------------------------------------------------------ rapikan teks
check(
  "nama dirapikan: spasi pinggir dibuang, spasi ganda dirapatkan",
  normalizeProductName("  Kopi   Susu  Gula  ") === "Kopi Susu Gula",
  normalizeProductName("  Kopi   Susu  Gula  "),
);
check(
  "SKU hanya dipangkas — hurufnya tidak diubah",
  normalizeProductSku("  kopi-01 ") === "kopi-01" &&
    normalizeProductSku("PBB-SAN-000042") === "PBB-SAN-000042",
  normalizeProductSku("  kopi-01 "),
);
check(
  "batas nama 2–60 karakter",
  PRODUCT_NAME_MIN === 2 && PRODUCT_NAME_MAX === 60,
  `${PRODUCT_NAME_MIN}/${PRODUCT_NAME_MAX}`,
);

// ------------------------------------------------------- ubah identitas: nama
check(
  "nama terlalu pendek ditolak",
  (() => {
    const d = validateProductIdentity(KOPI, { name: "K" });
    return !d.ok && d.reason.includes("2–60");
  })(),
  JSON.stringify(validateProductIdentity(KOPI, { name: "K" })),
);
check(
  "nama terlalu panjang ditolak",
  (() => {
    const d = validateProductIdentity(KOPI, { name: "x".repeat(PRODUCT_NAME_MAX + 1) });
    return !d.ok && d.reason.includes("60");
  })(),
  JSON.stringify(validateProductIdentity(KOPI, { name: "x".repeat(61) })),
);
check(
  "nama sama persis → tidak ada yang berubah (changed kosong)",
  (() => {
    const d = validateProductIdentity(KOPI, { name: "Kopi Susu" });
    return d.ok && d.changed.length === 0;
  })(),
  JSON.stringify(validateProductIdentity(KOPI, { name: "Kopi Susu" })),
);
check(
  "nama berubah hanya spasi → tidak dianggap perubahan",
  (() => {
    const d = validateProductIdentity(KOPI, { name: "  Kopi   Susu " });
    return d.ok && d.changed.length === 0 && d.value.name === "Kopi Susu";
  })(),
  JSON.stringify(validateProductIdentity(KOPI, { name: "  Kopi   Susu " })),
);
check(
  "nama baru mencatat changed: [name]",
  (() => {
    const d = validateProductIdentity(KOPI, { name: "Kopi Susu Aren" });
    return d.ok && d.value.name === "Kopi Susu Aren" && d.changed.join(",") === "name";
  })(),
  JSON.stringify(validateProductIdentity(KOPI, { name: "Kopi Susu Aren" })),
);

// ------------------------------------------------------- ubah identitas: SKU
check(
  "SKU kosong ditolak — SKU tidak pernah bisa dihapus",
  (() => {
    const d = validateProductIdentity(KOPI, { sku: "   " });
    return !d.ok && d.reason.includes("tidak boleh kosong");
  })(),
  JSON.stringify(validateProductIdentity(KOPI, { sku: "   " })),
);
check(
  "SKU terlalu panjang ditolak",
  (() => {
    const d = validateProductIdentity(KOPI, { sku: "A".repeat(PRODUCT_SKU_MAX + 1) });
    return !d.ok && d.reason.includes(String(PRODUCT_SKU_MAX));
  })(),
  `panjang=${PRODUCT_SKU_MAX}`,
);
check(
  "SKU dengan spasi ditolak (tidak bisa dipindai/diketik ulang dengan yakin)",
  (() => {
    const d = validateProductIdentity(KOPI, { sku: "KOPI 01" });
    return !d.ok && d.reason.includes("tanpa spasi");
  })(),
  JSON.stringify(validateProductIdentity(KOPI, { sku: "KOPI 01" })),
);
check(
  "SKU dengan huruf, angka, dan pemisah lazim diterima apa adanya",
  ["KOPI-01", "pbb-san-000042", "AB/12", "DU.X_1"].every((sku) => {
    const d = validateProductIdentity(KOPI, { sku });
    return d.ok && d.value.sku === sku;
  }),
  "salah satu SKU ditolak",
);
check(
  "SKU kembar ditolak tanpa peduli huruf besar-kecil",
  (() => {
    const d = validateProductIdentity(KOPI, { sku: "teh-01" }, { otherSkus: ["TEH-01"] });
    return !d.ok && d.reason.includes("sudah dipakai");
  })(),
  JSON.stringify(validateProductIdentity(KOPI, { sku: "teh-01" }, { otherSkus: ["TEH-01"] })),
);
check(
  "SKU sendiri tidak dianggap kembar (perubahan huruf saja tetap boleh)",
  (() => {
    const d = validateProductIdentity(KOPI, { sku: "kopi-01" });
    return d.ok && d.value.sku === "kopi-01" && d.changed.join(",") === "sku";
  })(),
  JSON.stringify(validateProductIdentity(KOPI, { sku: "kopi-01" })),
);

// ------------------------------------------------- ubah identitas: harga beli
check(
  "harga beli negatif ditolak",
  (() => {
    const d = validateProductIdentity(KOPI, { cost: -1 });
    return !d.ok && d.reason.includes("negatif");
  })(),
  JSON.stringify(validateProductIdentity(KOPI, { cost: -1 })),
);
check(
  "harga beli bukan angka ditolak",
  (() => {
    const d = validateProductIdentity(KOPI, { cost: Number.NaN });
    return !d.ok && d.reason.includes("angka");
  })(),
  JSON.stringify(validateProductIdentity(KOPI, { cost: Number.NaN })),
);
check(
  "harga beli dibulatkan ke rupiah bulat",
  (() => {
    const d = validateProductIdentity(KOPI, { cost: 12000.6 });
    return d.ok && d.value.cost === 12001 && d.changed.join(",") === "cost";
  })(),
  JSON.stringify(validateProductIdentity(KOPI, { cost: 12000.6 })),
);
check(
  "harga beli sama → tanpa perubahan",
  (() => {
    const d = validateProductIdentity(KOPI, { cost: 12000 });
    return d.ok && d.changed.length === 0;
  })(),
  JSON.stringify(validateProductIdentity(KOPI, { cost: 12000 })),
);

// ------------------------------------------- kombinasi: kolom yang berubah
check(
  "nama + SKU + harga beli sekaligus mencatat tiga kolom",
  (() => {
    const d = validateProductIdentity(
      KOPI,
      { name: "Kopi Susu Gula Aren", sku: "KOPI-02", cost: 13500 },
      { otherSkus: ["TEH-01"] },
    );
    return d.ok && d.changed.join(",") === "name,sku,cost" && d.value.cost === 13500;
  })(),
  JSON.stringify(validateProductIdentity(KOPI, { name: "a", sku: "b", cost: 1 })),
);
check(
  "satu kolom salah → seluruh perubahan ditolak (tidak ada yang tersimpan separuh)",
  (() => {
    const d = validateProductIdentity(KOPI, { name: "Kopi Susu Gula Aren", sku: "" });
    return !d.ok && d.value === undefined;
  })(),
  JSON.stringify(validateProductIdentity(KOPI, { name: "Kopi Susu Gula Aren", sku: "" })),
);
check(
  "tanpa patch apa pun → tidak ada yang berubah",
  (() => {
    const d = validateProductIdentity(KOPI, {});
    return d.ok && d.changed.length === 0 && d.value.sku === "KOPI-01";
  })(),
  JSON.stringify(validateProductIdentity(KOPI, {})),
);

// ------------------------------------------------------------ pagar hapus
check(
  "produk yang belum dipakai apa pun boleh dihapus",
  (() => {
    const d = productDeletionCheck("Kopi Susu", EMPTY_PRODUCT_USAGE);
    return d.canDelete && d.blockers.length === 0 && d.sentence.includes("boleh") === false;
  })(),
  JSON.stringify(productDeletionCheck("Kopi Susu", EMPTY_PRODUCT_USAGE)),
);
check(
  "kalimat produk yang boleh dihapus menyebut kenapa aman",
  productDeletionCheck("Kopi Susu", EMPTY_PRODUCT_USAGE).sentence.includes(
    "belum pernah terjual",
  ),
  productDeletionCheck("Kopi Susu", EMPTY_PRODUCT_USAGE).sentence,
);

const cases = [
  [{ stock: 5 }, "stok"],
  [{ sales: 3 }, "terjual"],
  [{ movements: 12 }, "pergerakan stok"],
  [{ purchases: 2 }, "dokumen pembelian"],
  [{ opname: 1 }, "opname"],
];
for (const [patch, kata] of cases) {
  const usage = { ...EMPTY_PRODUCT_USAGE, ...patch };
  check(
    `alasan hapus muncul untuk ${kata}`,
    (() => {
      const d = productDeletionCheck("Kopi Susu", usage);
      return !d.canDelete && d.blockers.length === 1 && d.sentence.includes(kata);
    })(),
    JSON.stringify(productDeletionCheck("Kopi Susu", usage)),
  );
}
check(
  "semua alasan dilaporkan sekaligus, satu per satu",
  (() => {
    const usage = { stock: 4, sales: 2, movements: 7, purchases: 3, opname: 1 };
    const blockers = productDeletionBlockers(usage);
    const d = productDeletionCheck("Kopi Susu", usage);
    return (
      blockers.length === 5 &&
      !d.canDelete &&
      d.blockers.length === 5 &&
      d.sentence.includes("Nonaktifkan saja")
    );
  })(),
  JSON.stringify(productDeletionCheck("Kopi Susu", { stock: 4, sales: 2, movements: 7, purchases: 3, opname: 1 })),
);
check(
  "alasan hapus menyebut angkanya, bukan cuma “tidak bisa dihapus”",
  (() => {
    const d = productDeletionCheck("Kopi Susu", { stock: 5, sales: 3, movements: 0, purchases: 0, opname: 0 });
    return d.blockers[0].includes("5") && d.blockers[1].includes("3");
  })(),
  JSON.stringify(productDeletionCheck("Kopi Susu", { stock: 5, sales: 3, movements: 0, purchases: 0, opname: 0 })),
);
check(
  "stok 0 tidak pernah jadi alasan (stok kosong = aman)",
  productDeletionBlockers({ ...EMPTY_PRODUCT_USAGE, stock: 0 }).length === 0,
  JSON.stringify(productDeletionBlockers({ ...EMPTY_PRODUCT_USAGE, stock: 0 })),
);
check(
  "alasan hapus selalu mengarahkan ke nonaktifkan, bukan menghapus riwayat",
  (() => {
    const d = productDeletionCheck("Kopi Susu", { ...EMPTY_PRODUCT_USAGE, sales: 1 });
    return d.sentence.includes("Nonaktifkan saja") && d.sentence.includes("riwayatnya tetap utuh");
  })(),
  productDeletionCheck("Kopi Susu", { ...EMPTY_PRODUCT_USAGE, sales: 1 }).sentence,
);

// --------------------------------------------------- kalimat aktif/nonaktif
check(
  "kalimat nonaktif menyebut hilang dari kasir & data tetap ada",
  (() => {
    const s = productStatusSentence("Kopi Susu", false, 0);
    return s.includes("Kopi Susu") && s.includes("kasir") && s.includes("tabel Produk tetap memuatnya");
  })(),
  productStatusSentence("Kopi Susu", false, 0),
);
check(
  "kalimat nonaktif menyebut stok yang tetap tercatat",
  productStatusSentence("Kopi Susu", false, 7).includes("7"),
  productStatusSentence("Kopi Susu", false, 7),
);
check(
  "kalimat aktif kembali menyebut bisa dijual lagi",
  (() => {
    const s = productStatusSentence("Kopi Susu", true, 3);
    return s.includes("diaktifkan kembali") && s.includes("bisa dijual lagi") && !s.includes("stoknya masih 0");
  })(),
  productStatusSentence("Kopi Susu", true, 3),
);
check(
  "aktif dengan stok 0 diberi tahu caranya mengisi stok",
  (() => {
    const s = productStatusSentence("Kopi Susu", true, 0);
    return s.includes("stoknya masih 0") && s.includes("penerimaan barang");
  })(),
  productStatusSentence("Kopi Susu", true, 0),
);

console.log(`${results.length}/${results.length} checks passed`);

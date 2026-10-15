/**
 * Tes murni untuk fitur grosir (Phase 2): harga bertingkat + konversi satuan.
 *
 * Semua perhitungan duit diuji tanpa deployment, karena aturan yang sama
 * (`src/convex/lib/wholesale.ts`) dipakai tiga tempat: server saat menjual,
 * klien saat menampilkan, dan harness ini. Kalau salah di sini, kasir dan
 * laporan akan berbeda angka.
 *
 * Usage: bun scripts/verify-wholesale.mjs
 */
import {
  BASE_UNIT,
  describeTiers,
  normaliseUnitCode,
  priceLine,
  sortTiers,
  tierFor,
  unitFactor,
  usesWholesale,
  validateTiers,
  validateUnits,
} from "../src/convex/lib/wholesale.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// ------------------------------------------------------------------ validasi
check("satuan dasar default adalah Pcs", BASE_UNIT === "PCS");
check("kode satuan dinormalkan ke huruf besar", normaliseUnitCode(" dus ") === "DUS");

check(
  "tier sah diterima",
  validateTiers(10000, [{ minQty: 12, price: 9000 }]).ok === true,
);
check(
  "kuantitas tier harus minimal 2",
  validateTiers(10000, [{ minQty: 1, price: 9000 }]).ok === false,
  validateTiers(10000, [{ minQty: 1, price: 9000 }]).reason,
);
check(
  "kuantitas tier duplikat ditolak",
  validateTiers(10000, [
    { minQty: 12, price: 9000 },
    { minQty: 12, price: 8000 },
  ]).ok === false,
);
check(
  "harga tier lebih mahal dari harga dasar ditolak",
  validateTiers(10000, [{ minQty: 12, price: 12000 }]).ok === false,
  validateTiers(10000, [{ minQty: 12, price: 12000 }]).reason,
);
check(
  "harga tier negatif ditolak",
  validateTiers(10000, [{ minQty: 12, price: -1 }]).ok === false,
);
check("daftar kosong selalu sah", validateTiers(10000, []).ok && validateUnits([]).ok);

check("satuan sah diterima", validateUnits([{ code: "DUS", factor: 24 }]).ok === true);
check(
  "satuan sekode dengan satuan dasar ditolak",
  validateUnits([{ code: "PCS", factor: 24 }], "PCS").ok === false,
);
check(
  "faktor satuan minimal 2",
  validateUnits([{ code: "PAK", factor: 1 }]).ok === false,
  validateUnits([{ code: "PAK", factor: 1 }]).reason,
);
check("satuan duplikat ditolak", validateUnits([{ code: "DUS", factor: 24 }, { code: "DUS", factor: 12 }]).ok === false);
check("kode satuan aneh ditolak", validateUnits([{ code: "D", factor: 12 }]).ok === false);

// -------------------------------------------------------------------- tier
const tiers = [
  { minQty: 24, price: 4000 },
  { minQty: 12, price: 4500 },
];
check(
  "sortTiers mengurutkan menaik tanpa mengubah input",
  sortTiers(tiers).map((t) => t.minQty).join(",") === "12,24" && tiers[0].minQty === 24,
);
check("di bawah tier pertama memakai harga dasar", tierFor(tiers, 11) === null);
check("tepat di batas tier memakai tier itu", tierFor(tiers, 12)?.price === 4500);
check("di antara dua tier memakai tier bawah", tierFor(tiers, 20)?.price === 4500);
check("di atas tier tertinggi memakai tier tertinggi", tierFor(tiers, 100)?.price === 4000);
check("tanpa tier selalu harga dasar", tierFor(undefined, 99) === null);

// ------------------------------------------------------------------- satuan
const units = [{ code: "DUS", factor: 24 }, { code: "PAK", factor: 6 }];
check("satuan dasar berfaktor 1", unitFactor(units, "PCS", "PCS") === 1);
check("satuan tak diisi berarti satuan dasar", unitFactor(units, undefined, "PCS") === 1);
check("faktor DUS terbaca", unitFactor(units, "dus", "PCS") === 24);
check("satuan asing mengembalikan null", unitFactor(units, "KARUNG", "PCS") === null);

// ------------------------------------------------------- harga satu baris
const product = { price: 5000, unit: "PCS", units, tiers };

{
  const line = priceLine({ product, quantity: 3 });
  check(
    "3 Pcs tanpa tier: harga dasar, tanpa konversi",
    line.baseQty === 3 && line.factor === 1 && line.unitCode === "PCS" && line.lineTotal === 15000 && line.tier === null,
    JSON.stringify(line),
  );
}
{
  const line = priceLine({ product, quantity: 12 });
  check(
    "12 Pcs kena tier 4.500",
    line.tier?.minQty === 12 && line.baseUnitPrice === 4500 && line.lineTotal === 54000,
    JSON.stringify(line),
  );
}
{
  const line = priceLine({ product, quantity: 1, unitCode: "DUS" });
  check(
    "1 DUS = 24 Pcs, kena tier 4.000, harga per DUS 96.000",
    line.baseQty === 24 &&
      line.factor === 24 &&
      line.unitCode === "DUS" &&
      line.baseUnitPrice === 4000 &&
      line.unitPrice === 96000 &&
      line.lineTotal === 96000,
    JSON.stringify(line),
  );
}
{
  const line = priceLine({ product, quantity: 2, unitCode: "PAK" });
  check(
    "2 PAK = 12 Pcs, tier 4.500 → 54.000 (tier dihitung dari satuan dasar)",
    line.baseQty === 12 && line.lineTotal === 54000,
    JSON.stringify(line),
  );
}
{
  let message = "";
  try {
    priceLine({ product, quantity: 1, unitCode: "KARUNG" });
  } catch (error) {
    message = error.message;
  }
  check("satuan tak dikenal ditolak dengan pesan jelas", message.includes("tidak dikenal"), message || "tidak menolak");
}
{
  let message = "";
  try {
    priceLine({ product, quantity: 0 });
  } catch (error) {
    message = error.message;
  }
  check("kuantitas nol ditolak", message.includes("lebih dari 0"), message || "tidak menolak");
}

// ------------------------------------------------------------ penanda modul
check(
  "usesWholesale menandai produk bertier/satuan",
  usesWholesale(product) === true &&
    usesWholesale({ price: 5000 }) === false &&
    usesWholesale({ price: 5000, tiers: [] }) === false,
);
check(
  "describeTiers membuat ringkasan terurut",
  describeTiers(tiers) === "12+ @4500 · 24+ @4000" && describeTiers(undefined) === "—",
  describeTiers(tiers),
);

console.log(`${results.length}/${results.length} checks passed`);

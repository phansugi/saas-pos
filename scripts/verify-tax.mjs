/**
 * Uji aturan PPN tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/tax.ts` — modul murni yang dipakai halaman
 * Pengaturan, kasir, kedua store (demo & Convex), `tenants.updateTax`,
 * `pos.createSale`, dan `billing.createInvoice` di server. Karena satu modul,
 * tarif yang dilihat pemilik toko, yang dicatat di struk, dan yang masuk ke
 * tagihan langganan tidak mungkin berbeda.
 *
 * Tiga hal yang dijaga di sini:
 *
 *   1. **Besar/kecilnya tarif** — batas 0–100%, pembulatan dua desimal, dan
 *      pembacaan angka Indonesia (“11,5”) yang sama dengan yang diketik di
 *      halaman Pengaturan.
 *   2. **Aktif/nonaktifnya PPN** — termasuk tenant lama yang belum punya kolom
 *      `taxActive`: baris itu **tetap** memungut PPN seperti sebelumnya.
 *   3. **“Aktif 0%” ditolak** — supaya “PPN 0%” tidak pernah bercampur dengan
 *      “PPN tidak aktif”; keduanya harus bisa dibedakan pembaca struk.
 *
 * Usage: bun scripts/verify-tax.mjs
 */
import {
  effectiveTaxRatePct,
  formatTaxRatePct,
  normalizeTaxRatePct,
  parseTaxRateInput,
  sameTaxSetting,
  taxHint,
  taxIsActive,
  taxLabel,
  taxSample,
  taxSettingOf,
  taxSettingSentence,
  validateTaxRatePct,
  TAX_RATE_MAX,
  TAX_RATE_MIN,
} from "../src/convex/lib/tax.ts";
import { computeTax } from "../src/convex/lib/billing/billingCalc.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// ------------------------------------------------------- batas & normalisasi
check("tarif minimum 0%", TAX_RATE_MIN === 0, String(TAX_RATE_MIN));
check("tarif maksimum 100%", TAX_RATE_MAX === 100, String(TAX_RATE_MAX));

const normalized = [
  [11, 11],
  [11.5, 11.5],
  [12.25, 12.25],
  [0, 0],
  [11.000000000000002, 11],
  [11.556, 11.56],
  [11.551, 11.55],
  [NaN, 0],
  [Infinity, 0],
  [-Infinity, 0],
];
for (const [input, expected] of normalized) {
  check(
    `normalizeTaxRatePct(${input}) → ${expected}`,
    normalizeTaxRatePct(input) === expected,
    String(normalizeTaxRatePct(input)),
  );
}

// -------------------------------------------------- tenant lama & penanda aktif
check("tanpa kolom taxActive dianggap aktif", taxIsActive({}) === true, String(taxIsActive({})));
check(
  "taxActive null dianggap aktif",
  taxIsActive({ taxActive: null }) === true,
  String(taxIsActive({ taxActive: null })),
);
check(
  "taxActive false tetap nonaktif",
  taxIsActive({ taxActive: false }) === false,
  String(taxIsActive({ taxActive: false })),
);

check(
  "tenant lama (tanpa taxActive) → aktif 11%",
  sameTaxSetting(taxSettingOf({ taxRatePct: 11 }), { active: true, ratePct: 11 }),
  JSON.stringify(taxSettingOf({ taxRatePct: 11 })),
);
check(
  "tenant dengan tarif 12% → aktif 12%",
  sameTaxSetting(taxSettingOf({ taxRatePct: 12 }), { active: true, ratePct: 12 }),
  JSON.stringify(taxSettingOf({ taxRatePct: 12 })),
);
check(
  "tenant nonaktif membaca tarifnya apa adanya",
  sameTaxSetting(taxSettingOf({ taxActive: false, taxRatePct: 11 }), {
    active: false,
    ratePct: 11,
  }),
  JSON.stringify(taxSettingOf({ taxActive: false, taxRatePct: 11 })),
);
check(
  "tarif tenant dibulatkan dua desimal saat dibaca",
  taxSettingOf({ taxRatePct: 11.5555 }).ratePct === 11.56,
  String(taxSettingOf({ taxRatePct: 11.5555 }).ratePct),
);

// ------------------------------------------------------------ tarif efektif
check(
  "aktif 11% memungut 11%",
  effectiveTaxRatePct({ active: true, ratePct: 11 }) === 11,
  String(effectiveTaxRatePct({ active: true, ratePct: 11 })),
);
check(
  "nonaktif 11% memungut 0%",
  effectiveTaxRatePct({ active: false, ratePct: 11 }) === 0,
  String(effectiveTaxRatePct({ active: false, ratePct: 11 })),
);
check(
  "nonaktif tarif apa pun tetap 0%",
  effectiveTaxRatePct({ active: false, ratePct: 75 }) === 0,
  String(effectiveTaxRatePct({ active: false, ratePct: 75 })),
);

// Tarif efektif harus menghasilkan angka yang sama dengan nol saat dimatikan —
// satu perhitungan, dipakai `pos.createSale` maupun `billing.createInvoice`.
check(
  "dimatikan: computeTax sama dengan tanpa pajak",
  computeTax(100_000, effectiveTaxRatePct({ active: false, ratePct: 11 })).gross === 100_000,
  String(computeTax(100_000, effectiveTaxRatePct({ active: false, ratePct: 11 })).gross),
);
check(
  "diaktifkan: computeTax memungut tarifnya",
  computeTax(100_000, effectiveTaxRatePct({ active: true, ratePct: 12 })).gross === 112_000,
  String(computeTax(100_000, effectiveTaxRatePct({ active: true, ratePct: 12 })).gross),
);

// -------------------------------------------------------------- validasi tarif
check(
  "angka bukan number ditolak",
  ["11", null, undefined, {}, NaN].every(
    (value) => validateTaxRatePct(value, { active: true }).ok === false,
  ),
  JSON.stringify(["11", null, undefined, {}, NaN].map((v) => validateTaxRatePct(v, { active: true }))),
);
check(
  "pesan angka bukan number menyebut angka",
  /angka/.test(validateTaxRatePct("11", { active: true }).reason ?? ""),
  validateTaxRatePct("11", { active: true }).reason,
);
check(
  "tarif negatif ditolak",
  validateTaxRatePct(-1, { active: true }).ok === false &&
    /negatif/.test(validateTaxRatePct(-1, { active: true }).reason ?? ""),
  validateTaxRatePct(-1, { active: true }).reason,
);
check(
  "tarif di atas 100% ditolak",
  validateTaxRatePct(101, { active: true }).ok === false,
  JSON.stringify(validateTaxRatePct(101, { active: true })),
);
check(
  "pesan batas atas menyebut angka batasnya",
  /100%/.test(validateTaxRatePct(101, { active: true }).reason ?? ""),
  validateTaxRatePct(101, { active: true }).reason,
);
check(
  "aktif dengan tarif 0% ditolak",
  validateTaxRatePct(0, { active: true }).ok === false,
  JSON.stringify(validateTaxRatePct(0, { active: true })),
);
check(
  "pesan 0% menyarankan mematikan PPN-nya",
  /matikan/i.test(validateTaxRatePct(0, { active: true }).reason ?? ""),
  validateTaxRatePct(0, { active: true }).reason,
);
check(
  "0% diterima saat PPN dimatikan",
  validateTaxRatePct(0, { active: false }).ok === true &&
    validateTaxRatePct(0, { active: false }).value === 0,
  JSON.stringify(validateTaxRatePct(0, { active: false })),
);
check(
  "tarif sah dikembalikan apa adanya",
  validateTaxRatePct(11, { active: true }).value === 11,
  String(validateTaxRatePct(11, { active: true }).value),
);
check(
  "tarif desimal dibulatkan ke dua angka",
  validateTaxRatePct(11.556, { active: true }).value === 11.56,
  String(validateTaxRatePct(11.556, { active: true }).value),
);
check(
  "tarif hasil pembacaan “11,5” diterima",
  validateTaxRatePct(parseTaxRateInput("11,5"), { active: true }).value === 11.5,
  String(validateTaxRatePct(parseTaxRateInput("11,5"), { active: true }).value),
);

// ------------------------------------------------------- membaca angka yang diketik
const parsed = [
  ["11", 11],
  [" 11 ", 11],
  ["11,5", 11.5],
  ["11.5", 11.5],
  ["0", 0],
  ["12", 12],
];
for (const [input, expected] of parsed) {
  check(
    `parseTaxRateInput("${input}") → ${expected}`,
    parseTaxRateInput(input) === expected,
    String(parseTaxRateInput(input)),
  );
}
const unreadable = ["", "   ", "abc", "11%", "1.234,5", "-", "1,2,3"];
for (const input of unreadable) {
  check(
    `parseTaxRateInput("${input}") → null (bukan 0)`,
    parseTaxRateInput(input) === null,
    String(parseTaxRateInput(input)),
  );
}

// ---------------------------------------------------------- kalimat & label
check("label aktif", taxLabel({ active: true, ratePct: 11 }) === "PPN 11%", taxLabel({ active: true, ratePct: 11 }));
check(
  "label nonaktif",
  taxLabel({ active: false, ratePct: 11 }) === "PPN tidak aktif",
  taxLabel({ active: false, ratePct: 11 }),
);
check("format bilangan bulat", formatTaxRatePct(11) === "11%", formatTaxRatePct(11));
check("format desimal koma", formatTaxRatePct(11.5) === "11,5%", formatTaxRatePct(11.5));
check("format dua desimal", formatTaxRatePct(12.25) === "12,25%", formatTaxRatePct(12.25));
check("format nol", formatTaxRatePct(0) === "0%", formatTaxRatePct(0));

const offSentence = taxSettingSentence({ active: false, ratePct: 11 });
check("kalimat nonaktif menyebut dimatikan", /dimatikan/i.test(offSentence), offSentence);
check("kalimat nonaktif menyebut penjualan lama tidak berubah", /Penjualan lama tidak berubah/i.test(offSentence), offSentence);
check("kalimat nonaktif menyebut tagihan langganan", /tagihan langganan/i.test(offSentence), offSentence);
const onSentence = taxSettingSentence({ active: true, ratePct: 12 });
check("kalimat aktif menyebut tarifnya", /12%/.test(onSentence), onSentence);
check("kalimat aktif menyebut penjualan lama", /lama tetap/i.test(onSentence), onSentence);

check("hint aktif menyebut struk penjualan", /struk penjualan/i.test(taxHint({ active: true, ratePct: 11 })), taxHint({ active: true, ratePct: 11 }));
check("hint nonaktif menyebut nyalakan lagi", /Nyalakan lagi/i.test(taxHint({ active: false, ratePct: 11 })), taxHint({ active: false, ratePct: 11 }));

// --------------------------------------------------------- contoh perhitungan
const sampleOn = taxSample({ active: true, ratePct: 11 }, 100_000);
check(
  "contoh aktif: 100.000 → pajak 11.000, total 111.000",
  sampleOn.net === 100_000 && sampleOn.tax === 11_000 && sampleOn.gross === 111_000,
  JSON.stringify(sampleOn),
);
check("contoh aktif memakai label tarifnya", sampleOn.label === "PPN 11%", sampleOn.label);
const sampleOff = taxSample({ active: false, ratePct: 11 }, 100_000);
check(
  "contoh nonaktif: tanpa pajak",
  sampleOff.tax === 0 && sampleOff.gross === 100_000,
  JSON.stringify(sampleOff),
);
check("contoh nonaktif dilabeli tidak aktif", sampleOff.label === "PPN tidak aktif", sampleOff.label);
check(
  "contoh membulatkan nominal dan pajaknya setengah ke atas",
  (() => {
    const row = taxSample({ active: true, ratePct: 11 }, 12_345.4);
    return row.net === 12_345 && row.tax === 1_358 && row.gross === 13_703;
  })(),
  JSON.stringify(taxSample({ active: true, ratePct: 11 }, 12_345.4)),
);
check(
  "contoh nominal negatif dijepit ke nol",
  (() => {
    const row = taxSample({ active: true, ratePct: 11 }, -500);
    return row.net === 0 && row.tax === 0 && row.gross === 0;
  })(),
  JSON.stringify(taxSample({ active: true, ratePct: 11 }, -500)),
);

// ------------------------------------------------------- “berubah atau tidak”
check(
  "11 dan 11,0 dianggap setelan yang sama",
  sameTaxSetting({ active: true, ratePct: 11 }, { active: true, ratePct: 11.0 }) === true,
  "tidak sama",
);
check(
  "11,004 dan 11 dibulatkan jadi sama",
  sameTaxSetting({ active: true, ratePct: 11.004 }, { active: true, ratePct: 11 }) === true,
  "tidak sama",
);
check(
  "tarif berbeda → berubah",
  sameTaxSetting({ active: true, ratePct: 11 }, { active: true, ratePct: 12 }) === false,
  "dianggap sama",
);
check(
  "aktif ↔ nonaktif → berubah walau tarifnya sama",
  sameTaxSetting({ active: true, ratePct: 11 }, { active: false, ratePct: 11 }) === false,
  "dianggap sama",
);

console.log(`${results.length}/${results.length} checks passed`);

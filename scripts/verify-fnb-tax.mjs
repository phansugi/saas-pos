/**
 * Uji aturan pajak & pungutan F&B tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/fnbTax.ts` — modul murni yang dipakai halaman
 * Pengaturan, kasir, kedua store (demo & Convex), `tenants.updateTaxProfile`, dan
 * `pos.createSale` di server. Karena satu modul, angka yang dilihat pemilik toko
 * di pratinjau, yang tercetak di struk, dan yang dicatat server tidak mungkin
 * berbeda.
 *
 * Yang dijaga di sini:
 *
 *   1. **PBJT menggantikan PPN**, bukan menambahnya — dan kalau keduanya
 *      dinyalakan, alasannya harus terbaca (bukan diam-diam memungut dua kali).
 *   2. **Batas 10%** untuk PBJT & biaya layanan, dan “aktif 0%” ditolak.
 *   3. **Biaya layanan bukan pajak**: barisnya sendiri, dan dasar pengenaan
 *      pajaknya bisa disetel (Perda berbeda-beda).
 *   4. **Kewajiban pusat dihitung dari omzet**, bukan ditambahkan ke struk:
 *      PPh final UMKM 0,5% (dengan bagian bebas Rp 500 juta setahun untuk orang
 *      pribadi dan batas waktu 7/4/3 tahun per bentuk badan) serta PPh 4(2) sewa.
 *   5. **Setelan rusak tidak boleh berarti “tidak memungut pajak”** diam-diam.
 *
 * Usage: bun scripts/verify-fnb-tax.mjs
 */
import {
  DEFAULT_FNB_TAX_PROFILE,
  fnbTaxProfileSentence,
  validateFnbTaxProfile as validateWholeProfile,
  DEFAULT_MICRO_EXEMPT_BELOW_IDR,
  FNB_ENTITY_LABELS,
  REGIONAL_TAX_MAX_PCT,
  RENT_TAX_RATE_PCT,
  SERVICE_CHARGE_MAX_PCT,
  UMKM_FINAL_RATE_PCT,
  UMKM_FIRST_SCHEME_YEAR,
  UMKM_INDIVIDUAL_ANNUAL_EXEMPT_IDR,
  UMKM_YEAR_LIMIT,
  fnbMonthlySummary,
  fnbTaxProfileOf,
  formatIdrPlain,
  emptyMonthlyTaxRows,
  fnbCurrentMonthSummary,
  fnbTaxMonthReport,
  fnbTaxReportTotals,
  formatPctPlain,
  microExemptWarning,
  monthLabel,
  monthlyTaxRows,
  monthWindow,
  orderTaxPlan,
  orderTotal,
  payrollTaxInfo,
  recordedGross,
  rentTaxWithholding,
  sameFnbTaxProfile,
  tallyGross,
  umkmFinalEstimate,
  validateMicroExemptBelowIdr,
  validateRegionalRatePct,
  validateRentMonthlyIdr,
  validateRentRatePct,
  validateServiceChargePct,
  validateUmkmStartYear,
} from "../src/convex/lib/fnbTax.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const PPN_ON = { active: true, ratePct: 11 };
const PPN_OFF = { active: false, ratePct: 11 };

/** Profil F&B yang dipakai berulang: PBJT 10%. */
const PBJT_10 = fnbTaxProfileOf({
  regionalActive: true,
  regionalRatePct: 10,
});

// --------------------------------------------------------------- batas angka
check("PBJT dibatasi 10%", REGIONAL_TAX_MAX_PCT === 10, String(REGIONAL_TAX_MAX_PCT));
check(
  "biaya layanan dibatasi 10%",
  SERVICE_CHARGE_MAX_PCT === 10,
  String(SERVICE_CHARGE_MAX_PCT),
);
check("tarif PPh final UMKM 0,5%", UMKM_FINAL_RATE_PCT === 0.5, String(UMKM_FINAL_RATE_PCT));
check(
  "bagian bebas orang pribadi Rp 500 juta setahun",
  UMKM_INDIVIDUAL_ANNUAL_EXEMPT_IDR === 500_000_000,
  String(UMKM_INDIVIDUAL_ANNUAL_EXEMPT_IDR),
);
check(
  "batas waktu 7 tahun (orang pribadi), 4 (CV/Firma/Koperasi), 3 (PT)",
  UMKM_YEAR_LIMIT.perorangan === 7 &&
    UMKM_YEAR_LIMIT.cv_firma_koperasi === 4 &&
    UMKM_YEAR_LIMIT.pt === 3,
  JSON.stringify(UMKM_YEAR_LIMIT),
);
check(
  "batas omzet usaha mikro bawaan Rp 42 juta (contoh Perda DKI)",
  DEFAULT_MICRO_EXEMPT_BELOW_IDR === 42_000_000,
  String(DEFAULT_MICRO_EXEMPT_BELOW_IDR),
);
check("tarif PPh sewa bawaan 10%", RENT_TAX_RATE_PCT === 10, String(RENT_TAX_RATE_PCT));
check(
  "label bentuk badan usaha tersedia untuk ketiganya",
  FNB_ENTITY_LABELS.perorangan === "Orang pribadi" &&
    FNB_ENTITY_LABELS.cv_firma_koperasi === "CV / Firma / Koperasi" &&
    FNB_ENTITY_LABELS.pt === "PT",
  JSON.stringify(FNB_ENTITY_LABELS),
);

// ------------------------------------------------- bawaan = perilaku lama
check(
  "profil bawaan tidak memungut apa pun dari pelanggan",
  DEFAULT_FNB_TAX_PROFILE.regionalActive === false &&
    DEFAULT_FNB_TAX_PROFILE.serviceChargeActive === false,
  JSON.stringify(DEFAULT_FNB_TAX_PROFILE),
);
check(
  "workspace tanpa setelan F&B tetap memungut PPN seperti sebelumnya",
  orderTotal({ net: 100_000, ppn: PPN_ON, fnb: DEFAULT_FNB_TAX_PROFILE }).total === 111_000,
  String(orderTotal({ net: 100_000, ppn: PPN_ON, fnb: DEFAULT_FNB_TAX_PROFILE }).total),
);
check(
  "profil yang belum ada dibaca sebagai bawaan",
  sameFnbTaxProfile(fnbTaxProfileOf(undefined), DEFAULT_FNB_TAX_PROFILE) &&
    sameFnbTaxProfile(fnbTaxProfileOf(null), DEFAULT_FNB_TAX_PROFILE),
  JSON.stringify(fnbTaxProfileOf(undefined)),
);
check(
  "profil sebagian digabung dengan bawaannya",
  fnbTaxProfileOf({ regionalActive: true }).regionalRatePct === 10 &&
    fnbTaxProfileOf({ regionalActive: true }).serviceChargePct === 5,
  JSON.stringify(fnbTaxProfileOf({ regionalActive: true })),
);

// ------------------------------------------- setelan rusak ≠ tidak dipungut
check(
  "tarif PBJT yang tidak terbaca kembali ke bawaan (bukan 0%)",
  fnbTaxProfileOf({ regionalActive: true, regionalRatePct: Number.NaN }).regionalRatePct === 10,
  String(fnbTaxProfileOf({ regionalActive: true, regionalRatePct: Number.NaN }).regionalRatePct),
);
check(
  "PBJT aktif dengan tarif tersimpan 0 kembali ke bawaan",
  fnbTaxProfileOf({ regionalActive: true, regionalRatePct: 0 }).regionalRatePct === 10,
  String(fnbTaxProfileOf({ regionalActive: true, regionalRatePct: 0 }).regionalRatePct),
);
check(
  "pungutan yang tidak aktif menyimpan angkanya apa adanya",
  fnbTaxProfileOf({ regionalActive: false, regionalRatePct: 0 }).regionalRatePct === 0 &&
    fnbTaxProfileOf({ serviceChargeActive: true, serviceChargePct: 0 }).serviceChargePct === 5,
  JSON.stringify([
    fnbTaxProfileOf({ regionalActive: false, regionalRatePct: 0 }).regionalRatePct,
    fnbTaxProfileOf({ serviceChargeActive: true, serviceChargePct: 0 }).serviceChargePct,
  ]),
);
check(
  "bentuk badan yang asing kembali ke orang pribadi",
  fnbTaxProfileOf({ umkmEntityType: "yayasan" }).umkmEntityType === "perorangan",
  String(fnbTaxProfileOf({ umkmEntityType: "yayasan" }).umkmEntityType),
);

// ------------------------------------------------- PBJT menggantikan PPN
const pbjtPlan = orderTaxPlan(PPN_ON, PBJT_10);
check("PBJT berlaku → yang dipungut PBJT", pbjtPlan.kind === "regional", pbjtPlan.kind);
check(
  "PBJT memakai tarifnya sendiri (10%), bukan tarif PPN",
  pbjtPlan.ratePct === 10,
  String(pbjtPlan.ratePct),
);
check("labelnya menyebut PBJT", pbjtPlan.label === "PBJT 10%", pbjtPlan.label);
check(
  "PPN & PBJT dua-duanya aktif ditandai, dengan alasannya",
  pbjtPlan.bothConfigured === true &&
    pbjtPlan.notes.some((note) => note.includes("PPN pusat tidak dipungut")),
  JSON.stringify(pbjtPlan.notes),
);
check(
  "alasan itu menyebut barang kemasan pabrik tetap kena PPN",
  pbjtPlan.notes.some((note) => note.includes("kemasan pabrik")),
  JSON.stringify(pbjtPlan.notes),
);
check(
  "100.000 dengan PBJT 10% → total 110.000 (PPN tidak ditambahkan)",
  orderTotal({ net: 100_000, ppn: PPN_ON, fnb: PBJT_10 }).total === 110_000,
  String(orderTotal({ net: 100_000, ppn: PPN_ON, fnb: PBJT_10 }).total),
);
check(
  "PPN mati + PBJT aktif → tetap PBJT",
  orderTaxPlan(PPN_OFF, PBJT_10).kind === "regional" &&
    orderTaxPlan(PPN_OFF, PBJT_10).bothConfigured === false,
  JSON.stringify(orderTaxPlan(PPN_OFF, PBJT_10)),
);
check(
  "PBJT mati + PPN aktif → kembali ke PPN",
  orderTaxPlan(PPN_ON, DEFAULT_FNB_TAX_PROFILE).kind === "ppn" &&
    orderTaxPlan(PPN_ON, DEFAULT_FNB_TAX_PROFILE).ratePct === 11,
  JSON.stringify(orderTaxPlan(PPN_ON, DEFAULT_FNB_TAX_PROFILE)),
);
check(
  "keduanya mati → tidak ada pajak, dan itu dikatakan",
  orderTaxPlan(PPN_OFF, DEFAULT_FNB_TAX_PROFILE).kind === "none" &&
    orderTaxPlan(PPN_OFF, DEFAULT_FNB_TAX_PROFILE).label === "Tanpa pajak" &&
    orderTaxPlan(PPN_OFF, DEFAULT_FNB_TAX_PROFILE).notes.some((note) =>
      note.includes("Tidak ada pajak"),
    ),
  JSON.stringify(orderTaxPlan(PPN_OFF, DEFAULT_FNB_TAX_PROFILE)),
);

// --------------------------------------------------- pengecualian usaha mikro
const MIKRO = fnbTaxProfileOf({
  regionalActive: true,
  regionalRatePct: 10,
  microExemptActive: true,
  microExemptBelowIdr: 42_000_000,
});
const mikroPlan = orderTaxPlan(PPN_ON, MIKRO);
check(
  "usaha mikro: PBJT tidak dipungut, PPN yang berlaku",
  mikroPlan.microExempt === true && mikroPlan.kind === "ppn",
  JSON.stringify(mikroPlan),
);
check(
  "alasannya menyebut batas omzetnya",
  mikroPlan.notes.some((note) => note.includes("Usaha mikro") && note.includes("Rp 42.000.000")),
  JSON.stringify(mikroPlan.notes),
);
check(
  "usaha mikro tanpa PPN → tanpa pajak sama sekali",
  orderTaxPlan(PPN_OFF, MIKRO).kind === "none",
  orderTaxPlan(PPN_OFF, MIKRO).kind,
);

// ------------------------------------------------------------- validasi tarif
check(
  "PBJT 10% diterima",
  validateRegionalRatePct(10, { active: true }).ok === true,
  JSON.stringify(validateRegionalRatePct(10, { active: true })),
);
check(
  "PBJT di atas 10% ditolak, pesannya menyebut batasnya",
  validateRegionalRatePct(11, { active: true }).ok === false &&
    /10%/.test(validateRegionalRatePct(11, { active: true }).reason ?? ""),
  validateRegionalRatePct(11, { active: true }).reason,
);
check(
  "PBJT aktif 0% ditolak dengan saran mematikannya",
  validateRegionalRatePct(0, { active: true }).ok === false &&
    /matikan/i.test(validateRegionalRatePct(0, { active: true }).reason ?? ""),
  validateRegionalRatePct(0, { active: true }).reason,
);
check(
  "PBJT 0% diterima saat dimatikan",
  validateRegionalRatePct(0, { active: false }).ok === true,
  JSON.stringify(validateRegionalRatePct(0, { active: false })),
);
check(
  "PBJT negatif & bukan angka ditolak",
  validateRegionalRatePct(-1, { active: true }).ok === false &&
    validateRegionalRatePct("10", { active: true }).ok === false,
  JSON.stringify([
    validateRegionalRatePct(-1, { active: true }),
    validateRegionalRatePct("10", { active: true }),
  ]),
);
check(
  "PBJT desimal dibulatkan dua angka",
  validateRegionalRatePct(7.555, { active: true }).value === 7.56,
  String(validateRegionalRatePct(7.555, { active: true }).value),
);

check(
  "biaya layanan 7,5% diterima",
  validateServiceChargePct(7.5, { active: true }).value === 7.5,
  String(validateServiceChargePct(7.5, { active: true }).value),
);
check(
  "biaya layanan di atas 10% ditolak",
  validateServiceChargePct(11, { active: true }).ok === false &&
    /10%/.test(validateServiceChargePct(11, { active: true }).reason ?? ""),
  validateServiceChargePct(11, { active: true }).reason,
);
check(
  "biaya layanan aktif 0% ditolak",
  validateServiceChargePct(0, { active: true }).ok === false,
  JSON.stringify(validateServiceChargePct(0, { active: true })),
);

check(
  "batas omzet usaha mikro harus lebih dari nol saat dipakai",
  validateMicroExemptBelowIdr(0, { active: true }).ok === false &&
    validateMicroExemptBelowIdr(42_000_000, { active: true }).value === 42_000_000,
  JSON.stringify([validateMicroExemptBelowIdr(0, { active: true })]),
);
check(
  "tahun mulai PPh final UMKM tidak boleh sebelum 2018",
  validateUmkmStartYear(2017, { now: 2026 }).ok === false,
  validateUmkmStartYear(2017, { now: 2026 }).reason,
);
check(
  "tahun mulai PPh final UMKM tidak boleh di masa depan",
  validateUmkmStartYear(2027, { now: 2026 }).ok === false,
  validateUmkmStartYear(2027, { now: 2026 }).reason,
);
check(
  "tahun mulai PPh final UMKM yang sah diterima apa adanya",
  validateUmkmStartYear(2024, { now: 2026 }).value === 2024 &&
    UMKM_FIRST_SCHEME_YEAR === 2018,
  String(validateUmkmStartYear(2024, { now: 2026 }).value),
);
check(
  "nilai sewa aktif harus lebih dari nol",
  validateRentMonthlyIdr(0, { active: true }).ok === false &&
    validateRentMonthlyIdr(10_000_000, { active: true }).value === 10_000_000,
  JSON.stringify(validateRentMonthlyIdr(0, { active: true })),
);
check(
  "tarif PPh sewa 0% saat aktif ditolak, 10% diterima",
  validateRentRatePct(0, { active: true }).ok === false &&
    validateRentRatePct(10, { active: true }).value === 10,
  JSON.stringify(validateRentRatePct(0, { active: true })),
);

// ---------------------------------------------------------- biaya layanan
const withService = fnbTaxProfileOf({
  regionalActive: true,
  regionalRatePct: 10,
  serviceChargeActive: true,
  serviceChargePct: 7,
});
const serviceExcluded = orderTotal({ net: 100_000, ppn: PPN_ON, fnb: withService });
check(
  "biaya layanan 7% dari 100.000 → 7.000",
  serviceExcluded.serviceCharge === 7_000,
  String(serviceExcluded.serviceCharge),
);
check(
  "pajak dihitung dari nilai jualnya saja (biaya layanan di luar dasar)",
  serviceExcluded.taxBase === 100_000 && serviceExcluded.tax === 10_000,
  `${serviceExcluded.taxBase} / ${serviceExcluded.tax}`,
);
check(
  "totalnya nilai jual + biaya layanan + pajak = 117.000",
  serviceExcluded.total === 117_000,
  String(serviceExcluded.total),
);
check(
  "struk punya baris biaya layanan tersendiri, bukan dicampur ke pajak",
  serviceExcluded.lines.length === 3 &&
    serviceExcluded.lines[1].kind === "service" &&
    serviceExcluded.lines[1].label === "Biaya layanan 7%" &&
    serviceExcluded.lines[2].kind === "tax",
  JSON.stringify(serviceExcluded.lines),
);

const serviceIncluded = orderTotal({
  net: 100_000,
  ppn: PPN_ON,
  fnb: { ...withService, serviceChargeInTaxBase: true },
});
check(
  "kalau Perda menghitung termasuk biaya layanan: dasar 107.000, pajak 10.700, total 117.700",
  serviceIncluded.taxBase === 107_000 &&
    serviceIncluded.tax === 10_700 &&
    serviceIncluded.total === 117_700,
  JSON.stringify(serviceIncluded),
);
check(
  "biaya layanan tidak pernah muncul saat dimatikan",
  orderTotal({ net: 100_000, ppn: PPN_ON, fnb: PBJT_10 }).serviceCharge === 0 &&
    orderTotal({ net: 100_000, ppn: PPN_ON, fnb: PBJT_10 }).lines.length === 2,
  JSON.stringify(orderTotal({ net: 100_000, ppn: PPN_ON, fnb: PBJT_10 }).lines),
);
check(
  "nilai jual negatif dijepit ke nol",
  orderTotal({ net: -50_000, ppn: PPN_ON, fnb: PBJT_10 }).total === 0,
  String(orderTotal({ net: -50_000, ppn: PPN_ON, fnb: PBJT_10 }).total),
);

// ------------------------------------------------ PPh final UMKM 0,5%
const UMKM_BASE = fnbTaxProfileOf({
  umkmFinalActive: true,
  umkmEntityType: "perorangan",
  umkmStartYear: 2024,
});
const umkmBelowExempt = umkmFinalEstimate({
  profile: UMKM_BASE,
  year: 2026,
  monthGrossIdr: 50_000_000,
  beforeMonthGrossIdr: 0,
});
check(
  "orang pribadi di bawah Rp 500 juta setahun → belum ada PPh final",
  umkmBelowExempt.monthTaxIdr === 0 &&
    umkmBelowExempt.yearTaxIdr === 0 &&
    umkmBelowExempt.monthTaxableIdr === 0,
  JSON.stringify(umkmBelowExempt),
);
check(
  "alasannya menyebut bagian bebas Rp 500 juta",
  umkmBelowExempt.note.includes("Rp 500.000.000") && umkmBelowExempt.note.includes("bagian bebas"),
  umkmBelowExempt.note,
);

const umkmOverExempt = umkmFinalEstimate({
  profile: UMKM_BASE,
  year: 2026,
  monthGrossIdr: 50_000_000,
  beforeMonthGrossIdr: 520_000_000,
});
check(
  "bagian bebas habis di omzet sebelumnya → bulan ini kena penuh 0,5%",
  umkmOverExempt.monthTaxableIdr === 50_000_000 &&
    umkmOverExempt.monthTaxIdr === 250_000,
  JSON.stringify(umkmOverExempt),
);
check(
  "PPh setahun dihitung dari omzet kena pajak sejak Januari",
  umkmOverExempt.yearTaxIdr === 350_000,
  String(umkmOverExempt.yearTaxIdr),
);
check(
  "bagian bebas memakan omzet paling awal, bukan bulan terakhir",
  umkmFinalEstimate({
    profile: UMKM_BASE,
    year: 2026,
    monthGrossIdr: 580_000_000,
    beforeMonthGrossIdr: 0,
  }).monthTaxableIdr === 80_000_000,
  String(
    umkmFinalEstimate({
      profile: UMKM_BASE,
      year: 2026,
      monthGrossIdr: 580_000_000,
      beforeMonthGrossIdr: 0,
    }).monthTaxableIdr,
  ),
);

const umkmCv = umkmFinalEstimate({
  profile: { ...UMKM_BASE, umkmEntityType: "cv_firma_koperasi" },
  year: 2026,
  monthGrossIdr: 50_000_000,
  beforeMonthGrossIdr: 0,
});
check(
  "badan usaha tidak punya bagian bebas → 0,5% dari omzet bulan",
  umkmCv.monthTaxIdr === 250_000 && umkmCv.monthTaxableIdr === 50_000_000,
  JSON.stringify(umkmCv),
);
check(
  "tahun terakhir CV/Firma/Koperasi = mulai + 4 − 1",
  umkmCv.lastEligibleYear === 2027,
  String(umkmCv.lastEligibleYear),
);
check(
  "tahun terakhir PT = mulai + 3 − 1",
  umkmFinalEstimate({ profile: { ...UMKM_BASE, umkmEntityType: "pt" }, year: 2026, monthGrossIdr: 0, beforeMonthGrossIdr: 0 })
    .lastEligibleYear === 2026,
  String(
    umkmFinalEstimate({ profile: { ...UMKM_BASE, umkmEntityType: "pt" }, year: 2026, monthGrossIdr: 0, beforeMonthGrossIdr: 0 })
      .lastEligibleYear,
  ),
);
check(
  "tahun terakhir orang pribadi = mulai + 7 − 1",
  umkmBelowExempt.lastEligibleYear === 2030,
  String(umkmBelowExempt.lastEligibleYear),
);

const umkmExpired = umkmFinalEstimate({
  profile: { ...UMKM_BASE, umkmEntityType: "pt", umkmStartYear: 2024 },
  year: 2027,
  monthGrossIdr: 50_000_000,
  beforeMonthGrossIdr: 0,
});
check(
  "batas waktunya lewat → tidak lagi dihitung 0,5%, dan itu dikatakan",
  umkmExpired.eligible === false &&
    umkmExpired.monthTaxIdr === 0 &&
    umkmExpired.note.includes("sudah lewat") &&
    umkmExpired.note.includes("2026"),
  umkmExpired.note,
);
check(
  "sebelum tahun mulainya juga tidak dihitung",
  umkmFinalEstimate({
    profile: { ...UMKM_BASE, umkmStartYear: 2025 },
    year: 2024,
    monthGrossIdr: 50_000_000,
    beforeMonthGrossIdr: 0,
  }).eligible === false,
  "eligible",
);
check(
  "PPh final UMKM yang tidak dipakai menghasilkan nol + alasan",
  (() => {
    const row = umkmFinalEstimate({
      profile: DEFAULT_FNB_TAX_PROFILE,
      year: 2026,
      monthGrossIdr: 50_000_000,
      beforeMonthGrossIdr: 0,
    });
    return row.active === false && row.monthTaxIdr === 0 && row.note.includes("tidak dipakai");
  })(),
  JSON.stringify(umkmFinalEstimate({ profile: DEFAULT_FNB_TAX_PROFILE, year: 2026, monthGrossIdr: 0, beforeMonthGrossIdr: 0 })),
);

// ------------------------------------------------------------- PPh 4(2) sewa
const rent = rentTaxWithholding(
  fnbTaxProfileOf({ rentTaxActive: true, rentMonthlyIdr: 10_000_000, rentRatePct: 10 }),
);
check(
  "PPh 4(2): 10% dari sewa 10 juta → 1 juta dipotong",
  rent.withheldIdr === 1_000_000 && rent.ratePct === 10,
  JSON.stringify(rent),
);
check(
  "labelnya menyebut pasal & objeknya",
  rent.label.includes("Pasal 4 ayat (2)") && rent.label.includes("sewa tanah/bangunan"),
  rent.label,
);
check(
  "penjelasannya menegaskan bukan pungutan ke pelanggan",
  rent.note.includes("Bukan pungutan ke pelanggan"),
  rent.note,
);
check(
  "sewa yang tidak aktif tidak memotong apa pun",
  rentTaxWithholding(fnbTaxProfileOf({ rentTaxActive: false, rentMonthlyIdr: 10_000_000 }))
    .withheldIdr === 0,
  "withheld",
);

// --------------------------------------------------------------- PPh 21
check(
  "PPh 21 yang aktif menjelaskan kewajiban menahan & menyetor",
  payrollTaxInfo(fnbTaxProfileOf({ payrollTaxActive: true })).active === true &&
    payrollTaxInfo(fnbTaxProfileOf({ payrollTaxActive: true })).note.includes("menahan PPh 21"),
  payrollTaxInfo(fnbTaxProfileOf({ payrollTaxActive: true })).note,
);
check(
  "PPh 21 yang tidak aktif menyebut tidak ada karyawan yang digaji",
  payrollTaxInfo(DEFAULT_FNB_TAX_PROFILE).active === false &&
    payrollTaxInfo(DEFAULT_FNB_TAX_PROFILE).note.includes("Tidak ada karyawan"),
  payrollTaxInfo(DEFAULT_FNB_TAX_PROFILE).note,
);

// ------------------------------------------------- ringkasan setoran bulanan
const RINGKASAN_PROFILE = fnbTaxProfileOf({
  regionalActive: true,
  regionalRatePct: 10,
  serviceChargeActive: true,
  serviceChargePct: 5,
  umkmFinalActive: true,
  umkmEntityType: "perorangan",
  umkmStartYear: 2024,
  rentTaxActive: true,
  rentMonthlyIdr: 10_000_000,
  rentRatePct: 10,
});
const ringkasan = fnbMonthlySummary({
  profile: RINGKASAN_PROFILE,
  ppn: PPN_ON,
  year: 2026,
  monthGrossIdr: 30_000_000,
  beforeMonthGrossIdr: 0,
  recordedSales: 12,
});
check(
  "ringkasan memisahkan yang dipungut dari pelanggan & kewajiban pengusaha",
  ringkasan.rows.filter((row) => row.source === "pelanggan").length === 2 &&
    ringkasan.rows.filter((row) => row.source === "pengusaha").length === 3,
  JSON.stringify(ringkasan.rows.map((row) => `${row.source}:${row.amountIdr}`)),
);
check(
  "PBJT bulan ini = 10% dari omzet tercatat (30 juta → 3 juta)",
  ringkasan.regionalChargedIdr === 3_000_000,
  String(ringkasan.regionalChargedIdr),
);
check(
  "biaya layanan bulan ini = 5% dari omzet tercatat (1,5 juta)",
  ringkasan.serviceChargeIdr === 1_500_000,
  String(ringkasan.serviceChargeIdr),
);
check(
  "PPh 4(2) sewa masuk sebagai kewajiban pengusaha (1 juta)",
  ringkasan.rows.some((row) => row.source === "pengusaha" && row.amountIdr === 1_000_000),
  JSON.stringify(ringkasan.rows),
);
check(
  "PPh final UMKM tidak dihitung kalau omzet masih di bawah bagian bebas",
  ringkasan.umkm.monthTaxIdr === 0 && ringkasan.umkm.note.includes("bagian bebas"),
  ringkasan.umkm.note,
);
check(
  "ringkasan menyebut jumlah transaksi yang ikut dihitung",
  ringkasan.recordedSales === 12 && ringkasan.monthGrossIdr === 30_000_000,
  `${ringkasan.recordedSales} / ${ringkasan.monthGrossIdr}`,
);
check(
  "pungutan yang tidak berlaku ditandai belum ada nilainya",
  fnbMonthlySummary({
    profile: DEFAULT_FNB_TAX_PROFILE,
    ppn: PPN_ON,
    year: 2026,
    monthGrossIdr: 30_000_000,
    beforeMonthGrossIdr: 0,
    recordedSales: 3,
  }).rows.every((row) => row.amountIdr === 0 && row.settled === false),
  "masih ada nilai",
);

// ------------------------------------------------- omzet tercatat (per bulan)
const SALES = [
  { createdAt: new Date(2026, 0, 15).getTime(), total: 100_000 },
  { createdAt: new Date(2026, 1, 5).getTime(), total: 200_000 },
  { createdAt: new Date(2026, 1, 10).getTime(), total: 50_000, status: "void" },
  { createdAt: new Date(2026, 1, 11).getTime(), total: 70_000, status: "held" },
  { createdAt: new Date(2025, 1, 11).getTime(), total: 999_000 },
  { createdAt: new Date(2026, 2, 1).getTime(), total: 300_000 },
];
const tercatat = recordedGross({ sales: SALES, key: { year: 2026, monthIndex: 1 } });
check(
  "omzet bulan ini hanya dari bulan itu & transaksi yang benar-benar dibayar",
  tercatat.monthGrossIdr === 200_000 && tercatat.monthSales === 1,
  JSON.stringify(tercatat),
);
check(
  "omzet sebelum bulan itu dipisah untuk menghitung bagian bebas",
  tercatat.beforeMonthGrossIdr === 100_000,
  String(tercatat.beforeMonthGrossIdr),
);
check(
  "penjualan void & held tidak dihitung",
  recordedGross({
    sales: [
      { createdAt: new Date(2026, 1, 2).getTime(), total: 10_000, status: "void" },
      { createdAt: new Date(2026, 1, 3).getTime(), total: 20_000, status: "held" },
      { createdAt: new Date(2026, 1, 4).getTime(), total: 30_000, status: "completed" },
    ],
    key: { year: 2026, monthIndex: 1 },
  }).monthGrossIdr === 30_000,
  "nilai",
);

check(
  "penjumlahan rentang melewati void & held dan menghitung transaksinya",
  (() => {
    const tally = tallyGross([
      { createdAt: 1, total: 10_000 },
      { createdAt: 2, total: 20_000, status: "completed" },
      { createdAt: 3, total: 90_000, status: "void" },
      { createdAt: 4, total: 80_000, status: "held" },
    ]);
    return tally.grossIdr === 30_000 && tally.salesCount === 2;
  })(),
  JSON.stringify(tallyGross([{ createdAt: 1, total: 10_000 }, { createdAt: 2, total: 20_000, status: "completed" }])),
);

// ------------------------------------------- laporan pajak & pungutan per bulan
/**
 * Tiga bulan berurutan dengan isi yang sengaja tidak seragam: PPN, PBJT,
 * penjualan tanpa pajak (dengan biaya layanan), baris void/held, dan satu baris
 * lama tanpa kolom `taxKind` (dibaca sebagai PPN).
 */
const LAPORAN_MONTHS = [
  monthWindow({ year: 2026, monthIndex: 0 }),
  monthWindow({ year: 2026, monthIndex: 1 }),
  monthWindow({ year: 2026, monthIndex: 2 }),
];
const LAPORAN_SALES = [
  { createdAt: new Date(2026, 0, 10).getTime(), total: 1_100_000, tax: 100_000, taxKind: "ppn" },
  { createdAt: new Date(2026, 0, 12).getTime(), total: 550_000, tax: 50_000, taxKind: "regional" },
  {
    createdAt: new Date(2026, 0, 13).getTime(),
    total: 315_000,
    tax: 15_000,
    taxKind: "none",
    serviceCharge: 15_000,
  },
  {
    createdAt: new Date(2026, 1, 5).getTime(),
    total: 220_000,
    tax: 20_000,
    taxKind: "regional",
    serviceCharge: 10_000,
  },
  {
    createdAt: new Date(2026, 1, 6).getTime(),
    total: 999_000,
    tax: 0,
    taxKind: "regional",
    status: "void",
  },
  { createdAt: new Date(2026, 1, 7).getTime(), total: 888_000, status: "held", taxKind: "regional" },
  // Baris lama tanpa `taxKind` → dibaca sebagai PPN (yang berlaku saat ditulis).
  { createdAt: new Date(2026, 1, 8).getTime(), total: 111_000, tax: 11_000 },
  { createdAt: new Date(2025, 11, 31).getTime(), total: 777_000, taxKind: "regional" },
];
const LAPORAN = monthlyTaxRows({ sales: LAPORAN_SALES, months: LAPORAN_MONTHS });

check(
  "kerangka laporan memakai nama bulan bahasa Indonesia",
  LAPORAN.length === 3 &&
    LAPORAN[0].label === "Januari 2026" &&
    monthLabel(LAPORAN_MONTHS[2], { short: true }) === "Mar 2026",
  JSON.stringify(LAPORAN.map((row) => row.label)),
);
check(
  "omzet sebulan = jumlah yang dibayar pelanggan, void & held dilewati",
  LAPORAN[0].monthGrossIdr === 1_965_000 &&
    LAPORAN[0].recordedSales === 3 &&
    LAPORAN[1].monthGrossIdr === 331_000 &&
    LAPORAN[1].recordedSales === 2,
  JSON.stringify(LAPORAN.map((row) => `${row.monthGrossIdr}/${row.recordedSales}`)),
);
check(
  "pajak dipisah per jenisnya: PBJT, PPN, dan ‘tanpa pajak’ tidak dicampur",
  LAPORAN[0].regionalTaxIdr === 50_000 &&
    LAPORAN[0].ppnTaxIdr === 100_000 &&
    LAPORAN[0].regionalSales === 1 &&
    LAPORAN[1].regionalTaxIdr === 20_000 &&
    LAPORAN[1].ppnTaxIdr === 11_000,
  JSON.stringify(LAPORAN.map((row) => `${row.regionalTaxIdr}/${row.ppnTaxIdr}`)),
);
check(
  "baris lama tanpa taxKind dihitung sebagai PPN (bukan diam-diam hilang)",
  LAPORAN[1].ppnTaxIdr === 11_000,
  String(LAPORAN[1].ppnTaxIdr),
);
check(
  "biaya layanan dijumlahkan terpisah dari pajak",
  LAPORAN[0].serviceChargeIdr === 15_000 && LAPORAN[1].serviceChargeIdr === 10_000,
  JSON.stringify(LAPORAN.map((row) => row.serviceChargeIdr)),
);
check(
  "bulan tanpa penjualan tetap ada sebagai baris nol",
  LAPORAN[2].monthGrossIdr === 0 &&
    LAPORAN[2].recordedSales === 0 &&
    LAPORAN[2].regionalTaxIdr === 0 &&
    LAPORAN[2].ppnTaxIdr === 0,
  JSON.stringify(LAPORAN[2]),
);
check(
  "omzet setahun berjalan menumpuk sampai bulan itu saja",
  LAPORAN[0].yearToDateGrossIdr === 1_965_000 &&
    LAPORAN[1].yearToDateGrossIdr === 2_296_000 &&
    LAPORAN[2].yearToDateGrossIdr === 2_296_000,
  JSON.stringify(LAPORAN.map((row) => row.yearToDateGrossIdr)),
);
check(
  "penjualan di luar bulan yang diminta tidak masuk ke baris mana pun",
  LAPORAN.reduce((sum, row) => sum + row.monthGrossIdr, 0) === 2_296_000,
  String(LAPORAN.reduce((sum, row) => sum + row.monthGrossIdr, 0)),
);
check(
  "total laporan menjumlah kolomnya",
  (() => {
    const total = fnbTaxReportTotals(LAPORAN);
    return (
      total.grossIdr === 2_296_000 &&
      total.recordedSales === 5 &&
      total.regionalTaxIdr === 70_000 &&
      total.ppnTaxIdr === 111_000 &&
      total.serviceChargeIdr === 25_000 &&
      total.regionalSales === 2
    );
  })(),
  JSON.stringify(fnbTaxReportTotals(LAPORAN)),
);
check(
  "kerangka kosong berisi nol untuk tiap bulan (dipakai saat data belum tiba)",
  emptyMonthlyTaxRows(LAPORAN_MONTHS).length === 3 &&
    emptyMonthlyTaxRows(LAPORAN_MONTHS).every(
      (row) => row.monthGrossIdr === 0 && row.recordedSales === 0 && row.label !== "",
    ),
  JSON.stringify(emptyMonthlyTaxRows(LAPORAN_MONTHS)),
);

// ---------------------------------- rincian satu bulan di halaman Laporan
const RINCIAN_JAN = fnbTaxMonthReport({
  row: LAPORAN[0],
  profile: RINGKASAN_PROFILE,
  ppn: PPN_ON,
});
check(
  "PBJT & PPN bulan itu dibaca dari struknya, bukan dari tarif yang berlaku sekarang",
  RINCIAN_JAN.regionalToPayIdr === 50_000 && RINCIAN_JAN.ppnToPayIdr === 100_000,
  `${RINCIAN_JAN.regionalToPayIdr} / ${RINCIAN_JAN.ppnToPayIdr}`,
);
check(
  "catatan bulan menyebut PBJT disetor ke kas daerah",
  RINCIAN_JAN.notes.some((note) => note.includes("Bapenda")),
  JSON.stringify(RINCIAN_JAN.notes),
);
check(
  "catatan bulan menyebut PPN lewat jalur pusat, bukan kas daerah",
  RINCIAN_JAN.notes.some((note) => note.includes("bukan kas daerah")),
  JSON.stringify(RINCIAN_JAN.notes),
);
check(
  "catatan bulan menegaskan biaya layanan bukan pajak",
  RINCIAN_JAN.notes.some((note) => note.includes("bukan pajak")),
  JSON.stringify(RINCIAN_JAN.notes),
);
check(
  "kewajiban pengusaha = PPh final UMKM + PPh sewa, bukan pungutan pelanggan",
  RINCIAN_JAN.ownerObligationsIdr ===
    RINCIAN_JAN.umkm.monthTaxIdr + RINCIAN_JAN.rent.withheldIdr &&
    RINCIAN_JAN.ownerObligationsIdr === 1_000_000,
  String(RINCIAN_JAN.ownerObligationsIdr),
);
check(
  "bulan yang seluruhnya ber-PPN padahal PBJT berlaku diberi keterangan",
  (() => {
    const rows = monthlyTaxRows({
      sales: [
        { createdAt: new Date(2026, 0, 4).getTime(), total: 111_000, tax: 11_000, taxKind: "ppn" },
      ],
      months: [LAPORAN_MONTHS[0]],
    });
    const detail = fnbTaxMonthReport({ row: rows[0], profile: PBJT_10, ppn: PPN_ON });
    return detail.notes.some((note) => note.includes("belum dipakai saat penjualan itu terjadi"));
  })(),
  "tidak ada keterangan",
);
check(
  "bulan tanpa penjualan diberi catatan apa adanya",
  fnbTaxMonthReport({ row: LAPORAN[2], profile: PBJT_10, ppn: PPN_ON }).notes.some((note) =>
    note.includes("Belum ada penjualan"),
  ),
  JSON.stringify(fnbTaxMonthReport({ row: LAPORAN[2], profile: PBJT_10, ppn: PPN_ON }).notes),
);

// -------------------------------------- ringkasan bulan berjalan (Pengaturan)
const RINGKASAN_BULANAN = fnbCurrentMonthSummary(LAPORAN);
check(
  "ringkasan bulan berjalan memakai bulan terakhir yang ada di laporan",
  RINGKASAN_BULANAN.year === 2026 &&
    RINGKASAN_BULANAN.monthGrossIdr === 0 &&
    RINGKASAN_BULANAN.recordedSales === 0,
  JSON.stringify(RINGKASAN_BULANAN),
);
check(
  "omzet sebelum bulan berjalan = omzet setahun berjalan − bulan itu",
  (() => {
    const ringkas = fnbCurrentMonthSummary(LAPORAN.slice(0, 2));
    return (
      ringkas.monthGrossIdr === 331_000 &&
      ringkas.beforeMonthGrossIdr === 1_965_000 &&
      ringkas.recordedSales === 2
    );
  })(),
  JSON.stringify(fnbCurrentMonthSummary(LAPORAN.slice(0, 2))),
);
check(
  "ringkasan setoran di halaman Pengaturan memakai angka bulan yang sama",
  fnbMonthlySummary({
    profile: RINGKASAN_PROFILE,
    ppn: PPN_ON,
    ...fnbCurrentMonthSummary(LAPORAN.slice(0, 2)),
  }).monthGrossIdr === 331_000,
  String(
    fnbMonthlySummary({
      profile: RINGKASAN_PROFILE,
      ppn: PPN_ON,
      ...fnbCurrentMonthSummary(LAPORAN.slice(0, 2)),
    }).monthGrossIdr,
  ),
);
check(
  "laporan yang belum punya data mengembalikan nol, bukan bulan yang dikira-kira",
  fnbCurrentMonthSummary([]).monthGrossIdr === 0 &&
    fnbCurrentMonthSummary([]).beforeMonthGrossIdr === 0 &&
    fnbCurrentMonthSummary([]).year === new Date().getFullYear(),
  JSON.stringify(fnbCurrentMonthSummary([])),
);

// -------------------------------------------------- peringatan usaha mikro
check(
  "tanpa PBJT tidak ada peringatan usaha mikro",
  microExemptWarning({ profile: DEFAULT_FNB_TAX_PROFILE, monthGrossIdr: 1_000_000 }) === null,
  "ada peringatan",
);
check(
  "omzet di bawah batas tapi pengecualian belum dinyalakan → disarankan menyalakan",
  (microExemptWarning({ profile: PBJT_10, monthGrossIdr: 30_000_000 }) ?? "").includes(
    "boleh tidak dipungut",
  ),
  String(microExemptWarning({ profile: PBJT_10, monthGrossIdr: 30_000_000 })),
);
check(
  "omzet sudah di atas batas & pengecualian menyala → diperingatkan",
  (microExemptWarning({ profile: MIKRO, monthGrossIdr: 51_000_000 }) ?? "").includes("melewati"),
  String(microExemptWarning({ profile: MIKRO, monthGrossIdr: 51_000_000 })),
);
check(
  "omzet masih di bawah batas & pengecualian menyala → tenang",
  microExemptWarning({ profile: MIKRO, monthGrossIdr: 41_000_000 }) === null,
  String(microExemptWarning({ profile: MIKRO, monthGrossIdr: 41_000_000 })),
);

// ------------------------------------------------------------------ format
check("format rupiah memakai titik ribuan", formatIdrPlain(1_234_567) === "Rp 1.234.567", formatIdrPlain(1_234_567));
check("format rupiah nol", formatIdrPlain(0) === "Rp 0", formatIdrPlain(0));
check("format rupiah ribuan bulat", formatIdrPlain(1_000) === "Rp 1.000", formatIdrPlain(1_000));
check("format rupiah dibulatkan", formatIdrPlain(1_000.6) === "Rp 1.001", formatIdrPlain(1_000.6));
check("format persen bulat", formatPctPlain(10) === "10%", formatPctPlain(10));
check("format persen desimal pakai koma", formatPctPlain(0.5) === "0,5%", formatPctPlain(0.5));
check("format persen 7,5", formatPctPlain(7.5) === "7,5%", formatPctPlain(7.5));

// ------------------------------------- validasi seluruh profil (yang disimpan)
check(
  "profil bawaan lolos validasi apa adanya",
  (() => {
    const result = validateWholeProfile(DEFAULT_FNB_TAX_PROFILE);
    return result.ok === true && sameFnbTaxProfile(result.value, DEFAULT_FNB_TAX_PROFILE);
  })(),
  JSON.stringify(validateWholeProfile(DEFAULT_FNB_TAX_PROFILE)),
);
check(
  "profil kosong lolos dan menjadi bawaan",
  (() => {
    const result = validateWholeProfile(undefined);
    return result.ok === true && sameFnbTaxProfile(result.value, DEFAULT_FNB_TAX_PROFILE);
  })(),
  JSON.stringify(validateWholeProfile(undefined)),
);
check(
  "PBJT di atas 10% ditolak seluruhnya, bukan disimpan sebagian",
  (() => {
    const result = validateWholeProfile({ ...PBJT_10, regionalRatePct: 12 });
    return result.ok === false && /10%/.test(result.reason);
  })(),
  JSON.stringify(validateWholeProfile({ ...PBJT_10, regionalRatePct: 12 })),
);
check(
  "biaya layanan di atas 10% ikut menahan penyimpanan",
  validateWholeProfile({
    ...PBJT_10,
    serviceChargeActive: true,
    serviceChargePct: 15,
  }).ok === false,
  "lolos",
);
check(
  "sewa aktif tanpa nilai sewa ditolak",
  validateWholeProfile({ rentTaxActive: true, rentMonthlyIdr: 0 }).ok === false,
  "lolos",
);
check(
  "tahun mulai 2017 ditolak walau profil lainnya benar",
  validateWholeProfile({ umkmFinalActive: true, umkmStartYear: 2017 }).ok === false,
  "lolos",
);
check(
  "profil lengkap yang sah dinormalkan (dua desimal & rupiah bulat)",
  (() => {
    const result = validateWholeProfile({
      regionalActive: true,
      regionalRatePct: 8.333,
      serviceChargeActive: true,
      serviceChargePct: 5.5,
      microExemptActive: true,
      microExemptBelowIdr: 42_000_000.4,
      umkmFinalActive: true,
      umkmEntityType: "cv_firma_koperasi",
      umkmStartYear: 2024,
      rentTaxActive: true,
      rentMonthlyIdr: 12_500_000.6,
      rentRatePct: 10,
    });
    return (
      result.ok === true &&
      result.value.regionalRatePct === 8.33 &&
      result.value.serviceChargePct === 5.5 &&
      result.value.microExemptBelowIdr === 42_000_000 &&
      result.value.rentMonthlyIdr === 12_500_001 &&
      result.value.umkmEntityType === "cv_firma_koperasi"
    );
  })(),
  JSON.stringify(validateWholeProfile({ regionalActive: true, regionalRatePct: 8.333 })),
);

// ------------------------------------------------------------- kalimat setelan
check(
  "kalimat setelan menyebut PBJT sebagai pungutan pelanggan",
  fnbTaxProfileSentence(PBJT_10).includes("Dari pelanggan: PBJT 10% dipungut dari pelanggan di struk"),
  fnbTaxProfileSentence(PBJT_10),
);
check(
  "kalimat setelan menegaskan biaya layanan bukan pajak",
  fnbTaxProfileSentence(withService).includes("bukan pajak"),
  fnbTaxProfileSentence(withService),
);
check(
  "kalimat setelan memisahkan kewajiban pengusaha dari pungutan pelanggan",
  (() => {
    const sentence = fnbTaxProfileSentence(RINGKASAN_PROFILE);
    return (
      sentence.includes("Kewajiban pengusaha:") &&
      sentence.includes("PPh final UMKM 0,5%") &&
      sentence.includes("PPh 4 ayat (2) memotong Rp 1.000.000")
    );
  })(),
  fnbTaxProfileSentence(RINGKASAN_PROFILE),
);
check(
  "kalimat setelan mengakui kalau belum ada pungutan yang berlaku",
  fnbTaxProfileSentence(DEFAULT_FNB_TAX_PROFILE).includes("belum ada pungutan yang berlaku"),
  fnbTaxProfileSentence(DEFAULT_FNB_TAX_PROFILE),
);
check(
  "pengecualian usaha mikro disebut di kalimat setelan",
  fnbTaxProfileSentence(MIKRO).includes("pengecualian usaha mikro"),
  fnbTaxProfileSentence(MIKRO),
);

// -------------------------------------------------------------- “berubah?”
check(
  "profil yang sama persis dianggap tidak berubah",
  sameFnbTaxProfile(fnbTaxProfileOf({ regionalActive: true }), fnbTaxProfileOf({ regionalActive: true })) === true,
  "dianggap berubah",
);
check(
  "satu bidang berbeda → berubah",
  sameFnbTaxProfile(fnbTaxProfileOf({ regionalActive: true }), fnbTaxProfileOf({ regionalActive: false })) === false,
  "dianggap sama",
);
check(
  "tarif PBJT berbeda → berubah",
  sameFnbTaxProfile(
    fnbTaxProfileOf({ regionalActive: true, regionalRatePct: 10 }),
    fnbTaxProfileOf({ regionalActive: true, regionalRatePct: 8 }),
  ) === false,
  "dianggap sama",
);

console.log(`${results.length}/${results.length} checks passed`);

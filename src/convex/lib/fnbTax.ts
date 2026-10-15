/**
 * Pajak & pungutan khas usaha makanan/minuman (F&B) — PBJT, biaya layanan, dan
 * kewajiban pajak pusat pengusahanya.
 *
 * Kenapa ada: setelan PPN saja tidak cukup untuk kafe/restoran. Ada **pajak
 * daerah** yang justru menggantikan PPN untuk makanan/minuman yang disajikan
 * langsung (PBJT — pengganti istilah lama Pajak Restoran/PB1), ada **biaya
 * layanan** yang sering keliru dianggap pajak, dan ada kewajiban pusat yang
 * menempel pada pengusaha (PPh final UMKM, PPh 21 karyawan, PPh 4 ayat (2) sewa
 * tempat) — bukan yang dipungut dari pelanggan.
 *
 * Aturannya hidup di satu berkas murni karena ada empat pemakai yang harus
 * menjawab hal yang sama: `pos.createSale` (struk & nominal yang dicatat server),
 * kedua store (pratinjau di kasir), halaman Pengaturan (setelan & ringkasan
 * setoran), dan harness.
 *
 * Empat keputusan yang sengaja diambil:
 *
 * 1. **PBJT menggantikan PPN untuk penjualan makanan/minuman, bukan menambahnya.**
 *    Kalau pajak daerah berlaku, penjualan itu **tidak** memungut PPN lagi —
 *    memungut dua-duanya membuat pelanggan membayar dua pajak untuk satu barang.
 *    Kalau keduanya sama-sama dinyalakan, kasir menampilkan alasannya (barang
 *    kemasan pabrik yang tetap kena PPN dijual terpisah — lihat catatan modul).
 * 2. **Biaya layanan bukan pajak.** Ia dipungut dari pelanggan dan dibagikan
 *    sebagai insentif karyawan (SE-04/BW/1999), jadi ia berdiri sebagai barisnya
 *    sendiri di struk, terpisah dari baris pajak.
 * 3. **Kewajiban pusat dihitung, bukan dipungut dari pelanggan.** PPh final UMKM
 *    (0,5% dari omzet) dan PPh 4(2) sewa hanya muncul sebagai **perkiraan setoran**
 *    pengusaha; tidak ada satu sen pun yang ditambahkan ke struk pelanggan.
 * 4. **Setelan bawaan = perilaku lama.** Workspace tanpa profil F&B tetap memungut
 *    PPN persis seperti sebelumnya; PBJT, biaya layanan, dan kewajiban pusat baru
 *    berlaku setelah pemilik menyalakannya.
 */

import { formatTaxRatePct, type TaxSetting } from "./tax";

// ------------------------------------------------------------------ batasan

/** Batas tarif PBJT menurut aturan daerah: maksimal 10%. */
export const REGIONAL_TAX_MAX_PCT = 10;
/** Tarif PBJT minimum yang masuk akal kalau dipungut (harus lebih dari nol). */
export const REGIONAL_TAX_MIN_PCT = 0.01;

/** Biaya layanan lazimnya 5–10%, dan tidak pernah lebih dari 10% di aplikasi ini. */
export const SERVICE_CHARGE_MAX_PCT = 10;
export const SERVICE_CHARGE_MIN_PCT = 0.01;

/** Tarif PPh final UMKM (PP No. 55 Tahun 2022): 0,5% dari peredaran bruto. */
export const UMKM_FINAL_RATE_PCT = 0.5;

/**
 * Bagian peredaran bruto orang pribadi yang **tidak** dikenai PPh final:
 * Rp 500 juta setahun (PP 55/2022). Badan (CV/PT/Koperasi) tidak punya bagian
 * bebas ini.
 */
export const UMKM_INDIVIDUAL_ANNUAL_EXEMPT_IDR = 500_000_000;

/**
 * Batas waktu pemakaian tarif 0,5% menurut bentuk badan usaha (dihitung sejak
 * tahun skema itu mulai dipakai). Tahun terakhir yang masih boleh memakainya
 * adalah `startYear + limit - 1` — jadi perorangan 7 tahun, CV/Firma/Koperasi 4
 * tahun, PT 3 tahun.
 */
export const UMKM_YEAR_LIMIT: Record<FnbEntityType, number> = {
  perorangan: 7,
  cv_firma_koperasi: 4,
  pt: 3,
};

/** Tahun pertama skema 0,5% berlaku (PP 23/2018); tahun sebelum itu ditolak. */
export const UMKM_FIRST_SCHEME_YEAR = 2018;

/** Tarif umum PPh Pasal 4 ayat (2) atas sewa tanah/bangunan. */
export const RENT_TAX_RATE_PCT = 10;

/**
 * Batas omzet bulanan contoh untuk pengecualian usaha mikro: Perda DKI Jakarta
 * memakai Rp 42 juta per bulan. Dipakai sebagai **nilai bawaan** yang bisa
 * diganti pemilik toko, karena angka di Perda setiap kabupaten/kota berbeda.
 */
export const DEFAULT_MICRO_EXEMPT_BELOW_IDR = 42_000_000;

// ------------------------------------------------------------------- bentuk

export type FnbEntityType = "perorangan" | "cv_firma_koperasi" | "pt";

export const FNB_ENTITY_LABELS: Record<FnbEntityType, string> = {
  perorangan: "Orang pribadi",
  cv_firma_koperasi: "CV / Firma / Koperasi",
  pt: "PT",
};

export interface FnbTaxProfile {
  /** Pajak daerah: PBJT makanan &/atau minuman — dipungut dari konsumen. */
  regionalActive: boolean;
  regionalRatePct: number;
  /** Usaha mikro di bawah batas omzet Perda: PBJT tidak dipungut. */
  microExemptActive: boolean;
  microExemptBelowIdr: number;
  /** Biaya layanan (bukan pajak) — dipungut dari konsumen, dibagikan ke karyawan. */
  serviceChargeActive: boolean;
  serviceChargePct: number;
  /** Apakah pajak dihitung dari nilai termasuk biaya layanan (berbeda per Perda). */
  serviceChargeInTaxBase: boolean;
  /** PPh final UMKM 0,5% (kewajiban pengusaha atas omzet). */
  umkmFinalActive: boolean;
  umkmEntityType: FnbEntityType;
  umkmStartYear: number;
  /** PPh Pasal 21: menahan pajak atas gaji karyawan (kewajiban pengusaha). */
  payrollTaxActive: boolean;
  /** PPh Pasal 4 ayat (2): memotong pajak atas sewa tempat usaha. */
  rentTaxActive: boolean;
  rentMonthlyIdr: number;
  rentRatePct: number;
}

/** Profil bawaan: tidak ada pungutan F&B, jadi perilaku lama tidak berubah. */
export const DEFAULT_FNB_TAX_PROFILE: FnbTaxProfile = {
  regionalActive: false,
  regionalRatePct: REGIONAL_TAX_MAX_PCT,
  microExemptActive: false,
  microExemptBelowIdr: DEFAULT_MICRO_EXEMPT_BELOW_IDR,
  serviceChargeActive: false,
  serviceChargePct: 5,
  serviceChargeInTaxBase: false,
  umkmFinalActive: false,
  umkmEntityType: "perorangan",
  umkmStartYear: UMKM_FIRST_SCHEME_YEAR,
  payrollTaxActive: false,
  rentTaxActive: false,
  rentMonthlyIdr: 0,
  rentRatePct: RENT_TAX_RATE_PCT,
};

/** Kolom `taxProfile` boleh sebagian (dan boleh belum ada) — sisanya default. */
export type FnbTaxProfileSource = Partial<FnbTaxProfile> | null | undefined;

function isEntityType(value: unknown): value is FnbEntityType {
  return value === "perorangan" || value === "cv_firma_koperasi" || value === "pt";
}

/** Angka persen dinormalkan ke dua desimal, sama seperti tarif PPN. */
export function normalizePct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/** Rupiah selalu bilangan bulat; nilai asing dibiarkan nol. */
function normalizeIdr(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

/**
 * Membaca satu tarif dari setelan tersimpan.
 *
 * Dua penjagaan disengaja — setelan yang rusak **tidak boleh** berubah jadi “tidak
 * memungut pajak” diam-diam: nilai yang tidak terbaca kembali ke bawaannya, dan
 * tarif yang nol/nol-palsu pada pungutan yang katanya **aktif** juga kembali ke
 * bawaan (bukan dipungut 0%). Pungutan yang memang tidak aktif dibiarkan apa
 * adanya supaya pemilik toko melihat angka yang ia simpan sendiri.
 */
function readPct(value: unknown, active: boolean, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const normalized = normalizePct(value);
  if (active && normalized <= 0) return fallback;
  return normalized;
}

/**
 * Membaca profil dari baris tenant/sesi. Nilai yang rusak/asing **tidak**
 * menggagalkan pembacaan: bidang itu kembali ke bawaannya, karena setelan pajak
 * yang gagal dibaca tidak boleh membuat kasir tidak bisa menjual.
 */
export function fnbTaxProfileOf(source: FnbTaxProfileSource): FnbTaxProfile {
  if (!source) return { ...DEFAULT_FNB_TAX_PROFILE };
  const regionalActive = source.regionalActive ?? DEFAULT_FNB_TAX_PROFILE.regionalActive;
  const serviceChargeActive =
    source.serviceChargeActive ?? DEFAULT_FNB_TAX_PROFILE.serviceChargeActive;
  const rentTaxActive = source.rentTaxActive ?? DEFAULT_FNB_TAX_PROFILE.rentTaxActive;

  return {
    regionalActive,
    regionalRatePct: readPct(
      source.regionalRatePct,
      regionalActive,
      DEFAULT_FNB_TAX_PROFILE.regionalRatePct,
    ),
    microExemptActive: source.microExemptActive ?? DEFAULT_FNB_TAX_PROFILE.microExemptActive,
    microExemptBelowIdr: normalizeIdr(
      source.microExemptBelowIdr ?? DEFAULT_FNB_TAX_PROFILE.microExemptBelowIdr,
    ),
    serviceChargeActive,
    serviceChargePct: readPct(
      source.serviceChargePct,
      serviceChargeActive,
      DEFAULT_FNB_TAX_PROFILE.serviceChargePct,
    ),
    serviceChargeInTaxBase:
      source.serviceChargeInTaxBase ?? DEFAULT_FNB_TAX_PROFILE.serviceChargeInTaxBase,
    umkmFinalActive: source.umkmFinalActive ?? DEFAULT_FNB_TAX_PROFILE.umkmFinalActive,
    umkmEntityType: isEntityType(source.umkmEntityType)
      ? source.umkmEntityType
      : DEFAULT_FNB_TAX_PROFILE.umkmEntityType,
    umkmStartYear: normalizeIdr(source.umkmStartYear ?? DEFAULT_FNB_TAX_PROFILE.umkmStartYear),
    payrollTaxActive: source.payrollTaxActive ?? DEFAULT_FNB_TAX_PROFILE.payrollTaxActive,
    rentTaxActive,
    rentMonthlyIdr: normalizeIdr(source.rentMonthlyIdr ?? DEFAULT_FNB_TAX_PROFILE.rentMonthlyIdr),
    rentRatePct: readPct(
      source.rentRatePct,
      rentTaxActive,
      DEFAULT_FNB_TAX_PROFILE.rentRatePct,
    ),
  };
}

/**
 * Memvalidasi **seluruh** profil sebelum disimpan: setiap angka diperiksa aturan
 * yang sama dengan yang dipakai kartu di halaman Pengaturan, jadi server tidak
 * pernah menyimpan setelan yang tidak bisa dibaca ulang.
 */
export function validateFnbTaxProfile(
  source: FnbTaxProfileSource,
): { ok: true; value: FnbTaxProfile } | { ok: false; reason: string } {
  const regionalActive = source?.regionalActive ?? DEFAULT_FNB_TAX_PROFILE.regionalActive;
  const serviceChargeActive =
    source?.serviceChargeActive ?? DEFAULT_FNB_TAX_PROFILE.serviceChargeActive;
  const rentTaxActive = source?.rentTaxActive ?? DEFAULT_FNB_TAX_PROFILE.rentTaxActive;
  const microExemptActive =
    source?.microExemptActive ?? DEFAULT_FNB_TAX_PROFILE.microExemptActive;

  const regional = validateRegionalRatePct(
    source?.regionalRatePct ?? DEFAULT_FNB_TAX_PROFILE.regionalRatePct,
    { active: regionalActive },
  );
  if (!regional.ok) return regional;
  const serviceCharge = validateServiceChargePct(
    source?.serviceChargePct ?? DEFAULT_FNB_TAX_PROFILE.serviceChargePct,
    { active: serviceChargeActive },
  );
  if (!serviceCharge.ok) return serviceCharge;
  const micro = validateMicroExemptBelowIdr(
    source?.microExemptBelowIdr ?? DEFAULT_FNB_TAX_PROFILE.microExemptBelowIdr,
    { active: microExemptActive },
  );
  if (!micro.ok) return micro;
  const rent = validateRentMonthlyIdr(
    source?.rentMonthlyIdr ?? DEFAULT_FNB_TAX_PROFILE.rentMonthlyIdr,
    { active: rentTaxActive },
  );
  if (!rent.ok) return rent;
  const rentRate = validateRentRatePct(
    source?.rentRatePct ?? DEFAULT_FNB_TAX_PROFILE.rentRatePct,
    { active: rentTaxActive },
  );
  if (!rentRate.ok) return rentRate;
  const startYear = validateUmkmStartYear(
    source?.umkmStartYear ?? DEFAULT_FNB_TAX_PROFILE.umkmStartYear,
    { now: new Date().getFullYear() },
  );
  if (!startYear.ok) return startYear;

  return {
    ok: true,
    value: {
      regionalActive,
      regionalRatePct: regional.value,
      microExemptActive,
      microExemptBelowIdr: micro.value,
      serviceChargeActive,
      serviceChargePct: serviceCharge.value,
      serviceChargeInTaxBase:
        source?.serviceChargeInTaxBase ?? DEFAULT_FNB_TAX_PROFILE.serviceChargeInTaxBase,
      umkmFinalActive: source?.umkmFinalActive ?? DEFAULT_FNB_TAX_PROFILE.umkmFinalActive,
      umkmEntityType: isEntityType(source?.umkmEntityType)
        ? source.umkmEntityType
        : DEFAULT_FNB_TAX_PROFILE.umkmEntityType,
      umkmStartYear: startYear.value,
      payrollTaxActive: source?.payrollTaxActive ?? DEFAULT_FNB_TAX_PROFILE.payrollTaxActive,
      rentTaxActive,
      rentMonthlyIdr: rent.value,
      rentRatePct: rentRate.value,
    },
  };
}

/**
 * Kalimat sesudah setelan disimpan, untuk notis halaman Pengaturan: apa yang
 * sekarang dipungut dari pelanggan dan apa yang jadi kewajiban pengusaha sendiri.
 */
export function fnbTaxProfileSentence(profile: FnbTaxProfile): string {
  const customer: string[] = [];
  if (profile.regionalActive) {
    customer.push(
      profile.microExemptActive
        ? `PBJT disiapkan ${formatPctPlain(profile.regionalRatePct)} tetapi tidak dipungut karena pengecualian usaha mikro (batas ${formatIdrPlain(profile.microExemptBelowIdr)})`
        : `PBJT ${formatPctPlain(profile.regionalRatePct)} dipungut dari pelanggan di struk`,
    );
  }
  if (profile.serviceChargeActive) {
    customer.push(
      `biaya layanan ${formatPctPlain(profile.serviceChargePct)} dipungut terpisah sebagai insentif karyawan (bukan pajak)`,
    );
  }

  const owner: string[] = [];
  if (profile.umkmFinalActive) {
    owner.push(`PPh final UMKM ${formatPctPlain(UMKM_FINAL_RATE_PCT)} dihitung dari omzet tercatat`);
  }
  if (profile.rentTaxActive) {
    owner.push(
      `PPh 4 ayat (2) memotong ${formatIdrPlain(Math.round(profile.rentMonthlyIdr * (profile.rentRatePct / 100)))} dari sewa bulanan`,
    );
  }
  if (profile.payrollTaxActive) owner.push("PPh 21 karyawan dicatat sebagai kewajiban");

  if (customer.length === 0 && owner.length === 0) {
    return "Setelan pajak F&B disimpan, tetapi belum ada pungutan yang berlaku: pelanggan tidak dikenai pajak daerah/biaya layanan, dan tidak ada kewajiban pusat yang dihitung.";
  }

  const parts: string[] = [];
  if (customer.length > 0) parts.push(`Dari pelanggan: ${customer.join("; ")}.`);
  if (owner.length > 0) parts.push(`Kewajiban pengusaha: ${owner.join("; ")}.`);
  return parts.join(" ");
}

/** Apakah dua profil sama persis (untuk menghindari audit & notis kosong). */
export function sameFnbTaxProfile(a: FnbTaxProfile, b: FnbTaxProfile): boolean {
  const keys = Object.keys(DEFAULT_FNB_TAX_PROFILE) as Array<keyof FnbTaxProfile>;
  return keys.every((key) => a[key] === b[key]);
}

// ------------------------------------------------------ format uang (murni)

/**
 * Rupiah tanpa Intl: `1234567` → `Rp 1.234.567`.
 *
 * Disalin kecil di sini (bukan memakai `@/lib/utils`) supaya modul ini tetap
 * murni dan bisa dibundel ke Convex tanpa dependensi klien.
 */
export function formatIdrPlain(amount: number): string {
  const value = Math.round(Number.isFinite(amount) ? amount : 0);
  const sign = value < 0 ? "-" : "";
  const digits = Math.abs(value).toString();
  const withDots = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}Rp ${withDots}`;
}

// ------------------------------------------------------------- validasi

export type FnbTaxDecision =
  | { ok: true; value: number }
  | { ok: false; reason: string };

/**
 * Tarif PBJT: maksimal 10% menurut Perda, dan **aktif dengan 0% ditolak** —
 * alasannya sama dengan PPN: “PBJT 0%” dan “PBJT tidak dipungut” harus bisa
 * dibedakan pembaca struk.
 */
export function validateRegionalRatePct(value: unknown, options: { active: boolean }): FnbTaxDecision {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, reason: "Tarif PBJT harus berupa angka." };
  }
  if (value < 0) return { ok: false, reason: "Tarif PBJT tidak boleh negatif." };
  if (value > REGIONAL_TAX_MAX_PCT) {
    return {
      ok: false,
      reason: `Tarif PBJT maksimal ${REGIONAL_TAX_MAX_PCT}% — batas itu ditetapkan aturan daerah, periksa lagi angkanya.`,
    };
  }
  const normalized = normalizePct(value);
  if (options.active && normalized === 0) {
    return {
      ok: false,
      reason:
        "Tarif PBJT tidak bisa 0% selama pajak daerahnya aktif — matikan saja PBJT-nya kalau memang tidak dipungut.",
    };
  }
  return { ok: true, value: normalized };
}

/**
 * Biaya layanan: 0–10%. Aktif dengan 0% ditolak supaya “biaya layanan 0%” tidak
 * ikut tercetak di struk pelanggan.
 */
export function validateServiceChargePct(
  value: unknown,
  options: { active: boolean },
): FnbTaxDecision {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, reason: "Biaya layanan harus berupa angka." };
  }
  if (value < 0) return { ok: false, reason: "Biaya layanan tidak boleh negatif." };
  if (value > SERVICE_CHARGE_MAX_PCT) {
    return {
      ok: false,
      reason: `Biaya layanan maksimal ${SERVICE_CHARGE_MAX_PCT}% — kisaran yang lazim 5–10%.`,
    };
  }
  const normalized = normalizePct(value);
  if (options.active && normalized === 0) {
    return {
      ok: false,
      reason:
        "Biaya layanan tidak bisa 0% selama ia dipungut — matikan saja biaya layanannya kalau memang tidak ada.",
    };
  }
  return { ok: true, value: normalized };
}

/** Batas omzet bulanan pengecualian usaha mikro: harus lebih dari nol. */
export function validateMicroExemptBelowIdr(
  value: unknown,
  options: { active: boolean },
): FnbTaxDecision {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, reason: "Batas omzet usaha mikro harus berupa angka." };
  }
  const normalized = normalizeIdr(value);
  if (options.active && normalized <= 0) {
    return {
      ok: false,
      reason:
        "Batas omzet usaha mikro harus lebih dari nol — kalau semua penjualan dikecualikan, gunakan batas yang menjadi acuan Perda daerah Anda.",
    };
  }
  if (normalized < 0) return { ok: false, reason: "Batas omzet tidak boleh negatif." };
  return { ok: true, value: normalized };
}

/** Tahun mulai skema PPh final UMKM: tahun yang masuk akal, tidak di masa depan. */
export function validateUmkmStartYear(value: unknown, options: { now: number }): FnbTaxDecision {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, reason: "Tahun mulai PPh final UMKM harus berupa angka tahun." };
  }
  const year = Math.round(value);
  if (year < UMKM_FIRST_SCHEME_YEAR) {
    return {
      ok: false,
      reason: `Tahun mulai minimal ${UMKM_FIRST_SCHEME_YEAR} — tarif 0,5% baru ada sejak PP 23/2018.`,
    };
  }
  if (year > options.now) {
    return {
      ok: false,
      reason: `Tahun mulai tidak boleh di masa depan (sekarang ${options.now}).`,
    };
  }
  return { ok: true, value: year };
}

/** Nilai sewa bulanan untuk PPh Pasal 4 ayat (2). */
export function validateRentMonthlyIdr(
  value: unknown,
  options: { active: boolean },
): FnbTaxDecision {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, reason: "Nilai sewa bulanan harus berupa angka." };
  }
  const normalized = normalizeIdr(value);
  if (normalized < 0) return { ok: false, reason: "Nilai sewa tidak boleh negatif." };
  if (options.active && normalized === 0) {
    return {
      ok: false,
      reason:
        "Nilai sewa bulanan harus lebih dari nol selama PPh 4 ayat (2) diaktifkan — matikan saja kalau tempat usahanya bukan sewa.",
    };
  }
  return { ok: true, value: normalized };
}

/** Tarif PPh Pasal 4 ayat (2) atas sewa: tarif umumnya 10%. */
export function validateRentRatePct(value: unknown, options: { active: boolean }): FnbTaxDecision {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, reason: "Tarif PPh sewa harus berupa angka." };
  }
  if (value < 0) return { ok: false, reason: "Tarif PPh sewa tidak boleh negatif." };
  if (value > 100) return { ok: false, reason: "Tarif PPh sewa maksimal 100%." };
  const normalized = normalizePct(value);
  if (options.active && normalized === 0) {
    return {
      ok: false,
      reason: "Tarif PPh sewa tidak bisa 0% selama pemotongan sewanya aktif.",
    };
  }
  return { ok: true, value: normalized };
}

// --------------------------------------------------- pajak yang dipungut di struk

export type OrderTaxKind = "none" | "ppn" | "regional";

export interface OrderTaxPlan {
  kind: OrderTaxKind;
  /** Tarif yang benar-benar dipungut (0 kalau tidak ada pajak). */
  ratePct: number;
  /** Label baris pajak di struk, mis. “PBJT 10%”. */
  label: string;
  /** PBJT berlaku untuk penjualan ini (aktif & tidak dikecualikan). */
  regionalApplies: boolean;
  /** Usaha mikro dikecualikan, jadi PBJT-nya tidak dipungut. */
  microExempt: boolean;
  /** PPN & PBJT dua-duanya aktif: PPN tidak dipungut di penjualan ini. */
  bothConfigured: boolean;
  /** Alasan yang harus terbaca kasir/pemilik — bukan diam-diam. */
  notes: string[];
}

/**
 * Pajak mana yang dipungut untuk **satu penjualan**: PBJT kalau berlaku (ia
 * menggantikan PPN untuk makanan/minuman yang disajikan langsung), kalau tidak
 * ya PPN seperti sebelumnya.
 */
export function orderTaxPlan(ppn: TaxSetting, fnb: FnbTaxProfile): OrderTaxPlan {
  const microExempt = fnb.regionalActive && fnb.microExemptActive;
  const regionalApplies = fnb.regionalActive && !fnb.microExemptActive;
  const bothConfigured = regionalApplies && ppn.active;

  const kind: OrderTaxKind = regionalApplies ? "regional" : ppn.active ? "ppn" : "none";
  const ratePct =
    kind === "regional"
      ? normalizePct(fnb.regionalRatePct)
      : kind === "ppn"
        ? normalizePct(ppn.ratePct)
        : 0;

  const notes: string[] = [];
  if (bothConfigured) {
    notes.push(
      "PPN pusat tidak dipungut di penjualan ini: makanan/minuman yang disajikan langsung memakai pajak daerah (PBJT). Barang kemasan pabrik tetap kena PPN — jual lewat kasir dengan PBJT dimatikan, atau catat terpisah.",
    );
  }
  if (microExempt) {
    notes.push(
      `Usaha mikro: PBJT tidak dipungut menurut setelan (batas omzet bulanan ${formatIdrPlain(fnb.microExemptBelowIdr)}).`,
    );
  }
  if (kind === "none") {
    notes.push("Tidak ada pajak yang dipungut di penjualan ini.");
  }

  const label =
    kind === "regional"
      ? `PBJT ${formatPctPlain(ratePct)}`
      : kind === "ppn"
        ? `PPN ${formatPctPlain(ratePct)}`
        : "Tanpa pajak";

  return { kind, ratePct, label, regionalApplies, microExempt, bothConfigured, notes };
}

/**
 * Angka persen versi Indonesia (`10` → `10%`, `7.5` → `7,5%`) — persis formatter
 * tarif PPN (`formatTaxRatePct`), karena PBJT, biaya layanan, dan PPN ditulis di
 * dokumen yang sama dan tidak boleh punya dua gaya penulisan angka.
 */
export const formatPctPlain = formatTaxRatePct;

export interface OrderTotalLine {
  /** Jenis baris: nilai jual, biaya layanan, atau pajak. */
  kind: "net" | "service" | "tax";
  label: string;
  amount: number;
  ratePct: number;
}

export interface OrderTotal {
  /** Nilai makanan/minuman setelah diskon. */
  net: number;
  serviceCharge: number;
  serviceChargePct: number;
  /** Dasar pengenaan pajak (net, atau net + biaya layanan sesuai setelan). */
  taxBase: number;
  tax: number;
  plan: OrderTaxPlan;
  total: number;
  lines: OrderTotalLine[];
}

/**
 * Total satu penjualan: nilai jual → biaya layanan → pajak.
 *
 * Urutannya disengaja: biaya layanan dipungut lebih dulu, lalu pajak dihitung
 * dari dasar yang dipilih pemilik toko (`serviceChargeInTaxBase`) — karena Perda
 * tiap daerah berbeda soal biaya layanan masuk dasar pengenaan atau tidak.
 */
export function orderTotal(input: {
  net: number;
  ppn: TaxSetting;
  fnb: FnbTaxProfile;
}): OrderTotal {
  const net = Math.max(0, Math.round(input.net));
  const plan = orderTaxPlan(input.ppn, input.fnb);

  const serviceChargePct = input.fnb.serviceChargeActive
    ? normalizePct(input.fnb.serviceChargePct)
    : 0;
  const serviceCharge = Math.round(net * (serviceChargePct / 100));

  const taxBase = net + (serviceChargePct > 0 && input.fnb.serviceChargeInTaxBase ? serviceCharge : 0);
  const tax = Math.round(taxBase * (plan.ratePct / 100));
  const total = net + serviceCharge + tax;

  const lines: OrderTotalLine[] = [
    { kind: "net", label: "Nilai jual", amount: net, ratePct: 0 },
  ];
  if (serviceCharge > 0) {
    lines.push({
      kind: "service",
      label: `Biaya layanan ${formatPctPlain(serviceChargePct)}`,
      amount: serviceCharge,
      ratePct: serviceChargePct,
    });
  }
  if (tax > 0) {
    lines.push({ kind: "tax", label: plan.label, amount: tax, ratePct: plan.ratePct });
  }

  return {
    net,
    serviceCharge,
    serviceChargePct,
    taxBase,
    tax,
    plan,
    total,
    lines,
  };
}

// ------------------------------------------- kewajiban pusat (bukan dari pelanggan)

export interface UmkmFinalEstimate {
  /** Setelannya sedang dipakai atau tidak. */
  active: boolean;
  /** Masih boleh memakai tarif 0,5% di tahun ini atau tidak. */
  eligible: boolean;
  ratePct: number;
  year: number;
  /** Tahun terakhir yang masih boleh memakai tarif 0,5% untuk bentuk badan ini. */
  lastEligibleYear: number;
  entityLabel: string;
  /** Omzet yang tercatat: bulan ini & sejak awal tahun (termasuk bulan ini). */
  monthGrossIdr: number;
  yearToDateGrossIdr: number;
  /** Bagian yang kena pajak setelah bagian bebas orang pribadi. */
  monthTaxableIdr: number;
  monthTaxIdr: number;
  yearTaxIdr: number;
  note: string;
}

/**
 * Perkiraan PPh final UMKM 0,5% dari omzet yang **tercatat di aplikasi**.
 *
 * Bagian bebas Rp 500 juta setahun untuk orang pribadi dihitung berurutan:
 * bagian bebas itu memakan omzet paling awal di tahun itu, jadi omzet bulan ini
 * hanya kena pajak sebesar bagian yang **melewati** batas tersebut.
 */
export function umkmFinalEstimate(input: {
  profile: FnbTaxProfile;
  year: number;
  /** Omzet tercatat bulan ini. */
  monthGrossIdr: number;
  /** Omzet tercatat sejak Januari sampai sebelum bulan ini. */
  beforeMonthGrossIdr: number;
}): UmkmFinalEstimate {
  const profile = input.profile;
  const year = Math.round(input.year);
  const limit = UMKM_YEAR_LIMIT[profile.umkmEntityType];
  const lastEligibleYear = profile.umkmStartYear + limit - 1;
  const annualExempt =
    profile.umkmEntityType === "perorangan" ? UMKM_INDIVIDUAL_ANNUAL_EXEMPT_IDR : 0;

  const monthGross = Math.max(0, Math.round(input.monthGrossIdr));
  const beforeMonth = Math.max(0, Math.round(input.beforeMonthGrossIdr));
  const yearToDate = beforeMonth + monthGross;

  const taxableBefore = Math.max(0, beforeMonth - annualExempt);
  const taxableWithMonth = Math.max(0, yearToDate - annualExempt);
  const monthTaxable = taxableWithMonth - taxableBefore;

  const eligible = profile.umkmFinalActive && year >= profile.umkmStartYear && year <= lastEligibleYear;
  const monthTax = eligible ? Math.round(monthTaxable * (UMKM_FINAL_RATE_PCT / 100)) : 0;
  const yearTax = eligible ? Math.round(taxableWithMonth * (UMKM_FINAL_RATE_PCT / 100)) : 0;

  let note: string;
  if (!profile.umkmFinalActive) {
    note = "PPh final UMKM tidak dipakai. Kalau omzet masih di bawah ketentuan PP 55/2022, aktifkan supaya perkiraan setorannya ikut dihitung.";
  } else if (year < profile.umkmStartYear) {
    note = `Skema 0,5% baru dimulai tahun ${profile.umkmStartYear}, jadi tahun ${year} belum masuk hitungan PPh final.`;
  } else if (year > lastEligibleYear) {
    note = `Batas waktu tarif 0,5% untuk ${FNB_ENTITY_LABELS[profile.umkmEntityType]} sudah lewat (tahun terakhir ${lastEligibleYear}), jadi PPh-nya kembali memakai tarif umum dan tidak dihitung di sini.`;
  } else if (profile.umkmEntityType === "perorangan" && yearToDate <= annualExempt) {
    note = `Omzet tahun ini ${formatIdrPlain(yearToDate)} masih di dalam bagian bebas ${formatIdrPlain(annualExempt)}, jadi belum ada PPh final yang perlu disetor.`;
  } else {
    note = `Perkiraan dari omzet yang tercatat di aplikasi, bukan perhitungan pajak resmi: tarif ${formatPctPlain(UMKM_FINAL_RATE_PCT)} diterapkan pada omzet tahun berjalan setelah bagian bebas. Tahun terakhir untuk ${FNB_ENTITY_LABELS[profile.umkmEntityType]} adalah ${lastEligibleYear}.`;
  }

  return {
    active: profile.umkmFinalActive,
    eligible,
    ratePct: UMKM_FINAL_RATE_PCT,
    year,
    lastEligibleYear,
    entityLabel: FNB_ENTITY_LABELS[profile.umkmEntityType],
    monthGrossIdr: monthGross,
    yearToDateGrossIdr: yearToDate,
    monthTaxableIdr: monthTaxable,
    monthTaxIdr: monthTax,
    yearTaxIdr: yearTax,
    note,
  };
}

export interface RentWithholding {
  active: boolean;
  ratePct: number;
  monthlyRentIdr: number;
  /** PPh 4(2) yang dipotong dari pembayaran sewa bulan itu. */
  withheldIdr: number;
  label: string;
  note: string;
}

/** PPh Pasal 4 ayat (2): pemotongan 10% dari nilai sewa tempat usaha. */
export function rentTaxWithholding(profile: FnbTaxProfile): RentWithholding {
  const active = profile.rentTaxActive;
  const ratePct = normalizePct(profile.rentRatePct);
  const monthlyRentIdr = Math.max(0, Math.round(profile.rentMonthlyIdr));
  const withheldIdr = active ? Math.round(monthlyRentIdr * (ratePct / 100)) : 0;

  return {
    active,
    ratePct,
    monthlyRentIdr,
    withheldIdr,
    label: `PPh Pasal 4 ayat (2) — sewa tanah/bangunan ${formatPctPlain(ratePct)}`,
    note: active
      ? `Dipotong dari pembayaran sewa ${formatIdrPlain(monthlyRentIdr)} per bulan, lalu disetor ke kas negara. Bukan pungutan ke pelanggan.`
      : "Tempat usaha ini tidak menyewa (atau pajaknya tidak dipotong di sini), jadi tidak ada baris sewa di ringkasan setoran.",
  };
}

export interface PayrollTaxInfo {
  active: boolean;
  label: string;
  note: string;
}

/** PPh Pasal 21: kewajiban menahan pajak atas gaji karyawan. */
export function payrollTaxInfo(profile: FnbTaxProfile): PayrollTaxInfo {
  return {
    active: profile.payrollTaxActive,
    label: "PPh Pasal 21 — pajak karyawan",
    note: profile.payrollTaxActive
      ? "Ada karyawan yang digaji, jadi ada kewajiban menahan PPh 21 dari penghasilan mereka dan menyetorkannya tiap bulan. Aplikasi ini belum menghitung gajian — angka PPh 21-nya dicatat di luar sini."
      : "Tidak ada karyawan yang digaji lewat usaha ini, jadi tidak ada PPh 21 yang perlu ditahan.",
  };
}

export interface FnbMonthlyDepositRow {
  /** Dari mana pungutan ini datang: pelanggan atau pengusaha sendiri. */
  source: "pelanggan" | "pengusaha";
  label: string;
  amountIdr: number;
  note: string;
  settled: boolean;
}

export interface FnbMonthlySummary {
  year: number;
  /** Omzet yang tercatat bulan ini (dasar pajak daerah & PPh final). */
  monthGrossIdr: number;
  /** Jumlah transaksi yang ikut dihitung. */
  recordedSales: number;
  umkm: UmkmFinalEstimate;
  rent: RentWithholding;
  payroll: PayrollTaxInfo;
  /** Yang dipungut dari pelanggan bulan ini, dihitung dari omzet tercatat. */
  regionalChargedIdr: number;
  serviceChargeIdr: number;
  rows: FnbMonthlyDepositRow[];
}

/**
 * Ringkasan setoran bulan berjalan: apa yang dipungut dari pelanggan, apa yang
 * jadi kewajiban pengusaha, dan apa yang tidak berlaku.
 *
 * Yang **tidak** dihitung di sini: PPN yang sudah dipungut kasir — itu bagian
 * setoran PPN biasa (lihat kartu PPN), bukan pajak daerah.
 */
export function fnbMonthlySummary(input: {
  profile: FnbTaxProfile;
  ppn: TaxSetting;
  year: number;
  monthGrossIdr: number;
  beforeMonthGrossIdr: number;
  recordedSales: number;
}): FnbMonthlySummary {
  const profile = input.profile;
  const plan = orderTaxPlan(input.ppn, profile);
  const gross = Math.max(0, Math.round(input.monthGrossIdr));

  // Nilai jual dianggap sama dengan omzet tercatat: pratinjau ini memakai
  // setelan saat ini untuk seluruh omzet bulan itu, bukan menjumlahkan per nota.
  const serviceChargeIdr = profile.serviceChargeActive
    ? Math.round(gross * (normalizePct(profile.serviceChargePct) / 100))
    : 0;
  const regionalChargedIdr =
    plan.kind === "regional" ? Math.round(gross * (plan.ratePct / 100)) : 0;

  const umkm = umkmFinalEstimate({
    profile,
    year: input.year,
    monthGrossIdr: gross,
    beforeMonthGrossIdr: input.beforeMonthGrossIdr,
  });
  const rent = rentTaxWithholding(profile);
  const payroll = payrollTaxInfo(profile);

  const rows: FnbMonthlyDepositRow[] = [
    {
      source: "pelanggan",
      label: plan.kind === "regional" ? plan.label : "Pajak daerah (PBJT)",
      amountIdr: regionalChargedIdr,
      note: plan.regionalApplies
        ? "Dipungut dari pelanggan di struk, lalu disetor ke kas daerah (Bapenda) setiap bulan."
        : plan.microExempt
          ? "Tidak dipungut: usaha mikro di bawah batas omzet Perda."
          : "PBJT belum dinyalakan, jadi tidak ada pungutan pajak daerah.",
      settled: regionalChargedIdr > 0,
    },
    {
      source: "pelanggan",
      label: "Biaya layanan (bukan pajak)",
      amountIdr: serviceChargeIdr,
      note: profile.serviceChargeActive
        ? "Bukan pajak: dibagikan sebagai insentif/tip karyawan sesuai kebijakan internal (SE-04/BW/1999)."
        : "Biaya layanan tidak dipungut.",
      settled: serviceChargeIdr > 0,
    },
    {
      source: "pengusaha",
      label: `PPh final UMKM ${formatPctPlain(UMKM_FINAL_RATE_PCT)}`,
      amountIdr: umkm.monthTaxIdr,
      note: umkm.note,
      settled: umkm.monthTaxIdr > 0,
    },
    {
      source: "pengusaha",
      label: rent.label,
      amountIdr: rent.withheldIdr,
      note: rent.note,
      settled: rent.withheldIdr > 0,
    },
    {
      source: "pengusaha",
      label: payroll.label,
      amountIdr: 0,
      note: payroll.note,
      settled: payroll.active,
    },
  ];

  return {
    year: input.year,
    monthGrossIdr: gross,
    recordedSales: input.recordedSales,
    umkm,
    rent,
    payroll,
    regionalChargedIdr,
    serviceChargeIdr,
    rows,
  };
}

// ------------------------------------------------------- saringan transaksi

/** Baris penjualan yang dipakai untuk menghitung omzet tercatat. */
export interface MonthlySalesRow {
  createdAt: number;
  total: number;
  status?: string;
}

export interface MonthKey {
  year: number;
  /** 0–11, sama seperti `Date.getMonth()`. */
  monthIndex: number;
}

export function monthKeyAt(timestamp: number): MonthKey {
  const date = new Date(timestamp);
  return { year: date.getFullYear(), monthIndex: date.getMonth() };
}

/**
 * Omzet tercatat untuk bulan `key` dan untuk tahun berjalan **sebelum** bulan
 * itu. Penjualan yang dibatalkan (`void`) tidak dihitung, karena uangnya tidak
 * benar-benar diterima; order `held` juga tidak (belum dibayar).
 *
 * Yang dihitung adalah kolom `total` — total yang benar-benar dibayar pelanggan,
 * termasuk pungutan yang bukan milik penjual. Untuk setoran, yang dipungut
 * memang dihitung dari uang yang masuk.
 */
export interface GrossTally {
  grossIdr: number;
  salesCount: number;
}

/**
 * Jumlah omzet dari sekumpulan baris penjualan yang **sudah tersaring rentang
 * tanggalnya** (mis. lewat indeks Convex). Yang dibatalkan (`void`) dan pesanan
 * tertahan (`held`) dilewati di sini juga, supaya satu baris yang lolos saringan
 * tidak pernah dihitung sebagai uang yang benar-benar diterima.
 */
export function tallyGross(sales: MonthlySalesRow[]): GrossTally {
  let grossIdr = 0;
  let salesCount = 0;
  for (const sale of sales) {
    if (sale.status === "void" || sale.status === "held") continue;
    grossIdr += Number.isFinite(sale.total) ? Math.round(sale.total) : 0;
    salesCount += 1;
  }
  return { grossIdr, salesCount };
}

export function recordedGross(input: {
  sales: MonthlySalesRow[];
  key: MonthKey;
}): { monthGrossIdr: number; beforeMonthGrossIdr: number; monthSales: number } {
  const inMonth: MonthlySalesRow[] = [];
  const before: MonthlySalesRow[] = [];

  for (const sale of input.sales) {
    const at = monthKeyAt(sale.createdAt);
    if (at.year !== input.key.year) continue;
    if (at.monthIndex === input.key.monthIndex) inMonth.push(sale);
    else if (at.monthIndex < input.key.monthIndex) before.push(sale);
  }

  const month = tallyGross(inMonth);
  return {
    monthGrossIdr: month.grossIdr,
    beforeMonthGrossIdr: tallyGross(before).grossIdr,
    monthSales: month.salesCount,
  };
}

// --------------------------------------------- laporan pajak & pungutan bulanan

/**
 * Satu bulan dalam laporan. Batasnya (`from`/`to`) datang dari **waktu lokal**
 * pemanggil, bukan dari zona waktu server: penjualan tengah malam di WIB tidak
 * boleh jatuh ke bulan sebelumnya hanya karena deployment-nya berjalan di UTC.
 * Karena itu pengelompokan penjualan ke bulannya memakai rentang ini, bukan
 * `new Date(...).getMonth()` di sisi server.
 */
export interface FnbMonthWindow extends MonthKey {
  /** Awal bulan (milidetik, inklusif). */
  from: number;
  /** Awal bulan berikutnya (eksklusif). */
  to: number;
}

/** Baris penjualan yang dipakai laporan pajak: apa yang benar-benar tercatat. */
export interface MonthlyTaxSale extends MonthlySalesRow {
  /** Pajak yang dipungut saat penjualan itu terjadi. */
  tax?: number;
  /**
   * Jenis pajaknya (`sales.taxKind`). Baris yang belum punya kolom ini —
   * penjualan sebelum setelan F&B ada — dibaca sebagai **PPN**, karena itulah
   * yang berlaku saat barisnya ditulis (pola yang sama dengan `taxActive` yang
   * kosong dianggap aktif).
   */
  taxKind?: "none" | "ppn" | "regional";
  /** Biaya layanan yang dipungut penjualan itu (`sales.serviceCharge`). */
  serviceCharge?: number;
}

export interface FnbMonthTaxRow extends FnbMonthWindow {
  /** Nama bulan siap-baca, mis. “Oktober 2026”. */
  label: string;
  /** Omzet yang tercatat bulan itu (tanpa void & pesanan tertahan). */
  monthGrossIdr: number;
  recordedSales: number;
  /**
   * Omzet sejak Januari sampai **akhir** bulan ini, dihitung dari bulan-bulan
   * yang ikut diminta laporan — dasar bagian bebas PPh final orang pribadi.
   */
  yearToDateGrossIdr: number;
  /** PBJT (pajak daerah) yang dipungut dari pelanggan bulan itu. */
  regionalTaxIdr: number;
  /** PPN yang dipungut bulan itu (penjualan yang tidak memakai pajak daerah). */
  ppnTaxIdr: number;
  /** Biaya layanan bulan itu — dipungut dari pelanggan, tetapi **bukan pajak**. */
  serviceChargeIdr: number;
  /** Berapa transaksi yang memakai pajak daerah bulan itu. */
  regionalSales: number;
}

/** Nama bulan versi Indonesia, tanpa `Intl` (aman dibundel ke Convex). */
export const MONTH_LABELS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

/** Nama bulan pendek untuk tombol pemilih, mis. “Okt 2026”. */
const MONTH_LABELS_ID_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

function monthName(index: number): string {
  return MONTH_LABELS_ID[((index % 12) + 12) % 12];
}

function monthNameShort(index: number): string {
  return MONTH_LABELS_ID_SHORT[((index % 12) + 12) % 12];
}

/** “Oktober 2026” / “Okt 2026” (pendek) dari satu kunci bulan. */
export function monthLabel(key: MonthKey, options: { short?: boolean } = {}): string {
  const name = options.short ? monthNameShort(key.monthIndex) : monthName(key.monthIndex);
  return `${name} ${key.year}`;
}

/**
 * Batas satu bulan menurut **waktu lokal** pemanggil. Dipakai kedua store supaya
 * daftar bulan di laporan sama persis antara mode demo dan mode server.
 */
export function monthWindow(key: MonthKey): FnbMonthWindow {
  const from = new Date(key.year, key.monthIndex, 1).getTime();
  const to = new Date(key.year, key.monthIndex + 1, 1).getTime();
  return { ...key, from, to };
}

/**
 * `count` bulan terakhir (termasuk bulan `now`), **tertua dulu** — urutan yang
 * dipakai tabel laporan dan urutan yang sama dipakai saat membaca penjualan.
 */
export function recentMonthWindows(count: number, now: number = Date.now()): FnbMonthWindow[] {
  const base = new Date(now);
  const windows: FnbMonthWindow[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const key = {
      year: base.getFullYear(),
      monthIndex: base.getMonth() - i,
    };
    const normalized = new Date(key.year, key.monthIndex, 1);
    windows.push(monthWindow({ year: normalized.getFullYear(), monthIndex: normalized.getMonth() }));
  }
  return windows;
}

/**
 * Menyusun laporan per bulan dari penjualan yang benar-benar tercatat.
 *
 * Yang dijumlahkan adalah angka yang **tercatat di struknya masing-masing**
 * (`tax`, `taxKind`, `serviceCharge`) — bukan setelan yang berlaku sekarang.
 * Jadi mengubah tarif PBJT hari ini tidak menulis ulang laporan bulan lalu; yang
 * berubah hanya perkiraan PPh final (itu memang dihitung dari setelan sekarang,
 * dan halaman mengatakannya).
 */
export function monthlyTaxRows(input: {
  sales: MonthlyTaxSale[];
  months: FnbMonthWindow[];
}): FnbMonthTaxRow[] {
  const rows = emptyMonthlyTaxRows(input.months);

  for (const sale of input.sales) {
    if (sale.status === "void" || sale.status === "held") continue;
    const index = rows.findIndex(
      (row) => sale.createdAt >= row.from && sale.createdAt < row.to,
    );
    if (index === -1) continue;
    const row = rows[index];
    const total = Number.isFinite(sale.total) ? Math.round(sale.total) : 0;
    const tax = Number.isFinite(sale.tax ?? Number.NaN) ? Math.round(sale.tax ?? 0) : 0;
    const serviceCharge = Number.isFinite(sale.serviceCharge ?? Number.NaN)
      ? Math.round(sale.serviceCharge ?? 0)
      : 0;

    row.monthGrossIdr += total;
    row.recordedSales += 1;
    row.serviceChargeIdr += serviceCharge;
    // Baris lama (tanpa `taxKind`) dibaca sebagai PPN — lihat catatan di tipe.
    if (sale.taxKind === "regional") {
      row.regionalTaxIdr += tax;
      row.regionalSales += 1;
    } else if (sale.taxKind !== "none") {
      row.ppnTaxIdr += tax;
    }
  }

  for (const row of rows) {
    row.yearToDateGrossIdr = rows
      .filter((other) => other.year === row.year && other.monthIndex <= row.monthIndex)
      .reduce((sum, other) => sum + other.monthGrossIdr, 0);
  }

  return rows;
}

/**
 * Kerangka laporan: satu baris nol untuk tiap bulan yang diminta.
 *
 * Dipakai `monthlyTaxRows` (mengisi angkanya dari penjualan) **dan** sisi klien
 * (menampilkan kerangkanya selama kueri server masih dimuat), supaya tabel di
 * halaman Laporan tidak pernah kehilangan barisnya hanya karena datanya belum
 * datang — bulan tanpa penjualan tetap muncul sebagai nol, bukan hilang.
 */
export function emptyMonthlyTaxRows(months: FnbMonthWindow[]): FnbMonthTaxRow[] {
  return months.map((window) => ({
    ...window,
    label: monthLabel(window),
    monthGrossIdr: 0,
    recordedSales: 0,
    yearToDateGrossIdr: 0,
    regionalTaxIdr: 0,
    ppnTaxIdr: 0,
    serviceChargeIdr: 0,
    regionalSales: 0,
  }));
}

/** Total sederajat untuk baris “jumlah” di tabel laporan. */
export interface FnbTaxReportTotals {
  grossIdr: number;
  recordedSales: number;
  regionalTaxIdr: number;
  ppnTaxIdr: number;
  serviceChargeIdr: number;
  regionalSales: number;
}

export function fnbTaxReportTotals(rows: FnbMonthTaxRow[]): FnbTaxReportTotals {
  return rows.reduce<FnbTaxReportTotals>(
    (sum, row) => ({
      grossIdr: sum.grossIdr + row.monthGrossIdr,
      recordedSales: sum.recordedSales + row.recordedSales,
      regionalTaxIdr: sum.regionalTaxIdr + row.regionalTaxIdr,
      ppnTaxIdr: sum.ppnTaxIdr + row.ppnTaxIdr,
      serviceChargeIdr: sum.serviceChargeIdr + row.serviceChargeIdr,
      regionalSales: sum.regionalSales + row.regionalSales,
    }),
    {
      grossIdr: 0,
      recordedSales: 0,
      regionalTaxIdr: 0,
      ppnTaxIdr: 0,
      serviceChargeIdr: 0,
      regionalSales: 0,
    },
  );
}

export interface FnbTaxReportMonth {
  row: FnbMonthTaxRow;
  umkm: UmkmFinalEstimate;
  rent: RentWithholding;
  payroll: PayrollTaxInfo;
  /** PBJT bulan itu — yang disetor ke kas daerah (Bapenda). */
  regionalToPayIdr: number;
  /** PPN bulan itu — setoran pajak pusat, bukan pajak daerah. */
  ppnToPayIdr: number;
  /** Kewajiban pengusaha sendiri (PPh final + PPh sewa), bukan pungutan pelanggan. */
  ownerObligationsIdr: number;
  /** Kalimat yang harus terbaca pemilik toko tentang bulan itu. */
  notes: string[];
}

/**
 * Rincian satu bulan untuk laporan: apa yang dipungut dari pelanggan, apa yang
 * harus disetor, dan apa yang menjadi kewajiban pengusaha sendiri.
 */
export function fnbTaxMonthReport(input: {
  row: FnbMonthTaxRow;
  profile: FnbTaxProfile;
  ppn: TaxSetting;
}): FnbTaxReportMonth {
  const row = input.row;
  const profile = input.profile;
  const umkm = umkmFinalEstimate({
    profile,
    year: row.year,
    monthGrossIdr: row.monthGrossIdr,
    beforeMonthGrossIdr: Math.max(0, row.yearToDateGrossIdr - row.monthGrossIdr),
  });
  const rent = rentTaxWithholding(profile);
  const payroll = payrollTaxInfo(profile);

  const notes: string[] = [];
  if (row.regionalTaxIdr > 0) {
    notes.push(
      `PBJT ${formatIdrPlain(row.regionalTaxIdr)} dipungut dari pelanggan bulan itu (${row.regionalSales} transaksi) — setorkan ke kas daerah (Bapenda).`,
    );
  }
  if (row.ppnTaxIdr > 0) {
    notes.push(
      `PPN ${formatIdrPlain(row.ppnTaxIdr)} berasal dari penjualan yang tidak memakai pajak daerah (mis. barang kemasan pabrik) — setornya lewat jalur PPN pusat, bukan kas daerah.`,
    );
  }
  if (row.serviceChargeIdr > 0) {
    notes.push(
      `Biaya layanan ${formatIdrPlain(row.serviceChargeIdr)} bukan pajak: tidak disetor ke negara, dibagikan sesuai kebijakan internal (SE-04/BW/1999).`,
    );
  }
  if (profile.regionalActive && row.monthGrossIdr > 0 && row.regionalSales === 0) {
    notes.push(
      "Seluruh penjualan bulan itu tercatat sebagai PPN: PBJT yang berlaku sekarang belum dipakai saat penjualan itu terjadi, dan struk lamanya tidak diubah.",
    );
  }
  if (row.recordedSales === 0) {
    notes.push("Belum ada penjualan yang tercatat di bulan itu.");
  }

  return {
    row,
    umkm,
    rent,
    payroll,
    regionalToPayIdr: row.regionalTaxIdr,
    ppnToPayIdr: row.ppnTaxIdr,
    ownerObligationsIdr: umkm.monthTaxIdr + rent.withheldIdr,
    notes,
  };
}

/**
 * Ringkasan **bulan berjalan** dari baris laporan bulanan — bentuk yang dipakai
 * ringkasan setoran di halaman Pengaturan (`fnbMonthlySummary`).
 *
 * Diturunkan dari baris yang sama dengan tabel di halaman Laporan, bukan dari
 * kueri kedua: kalau ringkasan setoran dan tabel laporan bisa menjawab angka
 * yang berbeda, pemilik toko tidak punya cara tahu mana yang benar.
 */
export interface FnbMonthSummary {
  year: number;
  /** Omzet tercatat bulan berjalan. */
  monthGrossIdr: number;
  /** Omzet tahun berjalan **sebelum** bulan berjalan (bagian bebas PPh final). */
  beforeMonthGrossIdr: number;
  recordedSales: number;
}

/**
 * Bulan terakhir yang ada di laporan, dibaca sebagai “bulan berjalan”.
 *
 * Baris kosong berarti laporan belum punya datanya (mis. kueri server masih
 * dimuat): yang dikembalikan adalah angka nol, **bukan** tanggal hari ini yang
 * sudah dibulatkan — melaporkan setoran nol karena data belum tiba akan membuat
 * halaman Pengaturan terlihat seperti “tidak ada kewajiban apa pun”.
 */
export function fnbCurrentMonthSummary(rows: FnbMonthTaxRow[]): FnbMonthSummary {
  if (rows.length === 0) {
    const now = new Date();
    return {
      year: now.getFullYear(),
      monthGrossIdr: 0,
      beforeMonthGrossIdr: 0,
      recordedSales: 0,
    };
  }
  const latest = rows.reduce((best, row) =>
    row.year > best.year || (row.year === best.year && row.monthIndex > best.monthIndex)
      ? row
      : best,
  );
  return {
    year: latest.year,
    monthGrossIdr: latest.monthGrossIdr,
    beforeMonthGrossIdr: Math.max(0, latest.yearToDateGrossIdr - latest.monthGrossIdr),
    recordedSales: latest.recordedSales,
  };
}

/**
 * Peringatan yang harus terlihat pemilik toko: omzet tercatat bulan ini sudah
 * melewati batas pengecualian usaha mikro, padahal PBJT-nya dimatikan karena
 * alasan itu.
 */
export function microExemptWarning(input: {
  profile: FnbTaxProfile;
  monthGrossIdr: number;
}): string | null {
  const profile = input.profile;
  if (!profile.regionalActive) return null;
  const gross = Math.max(0, Math.round(input.monthGrossIdr));
  if (!profile.microExemptActive) {
    if (gross > 0 && profile.microExemptBelowIdr > 0 && gross <= profile.microExemptBelowIdr) {
      return `Omzet tercatat bulan ini ${formatIdrPlain(gross)} masih di bawah batas ${formatIdrPlain(profile.microExemptBelowIdr)}. Kalau usaha Anda termasuk mikro, PBJT-nya boleh tidak dipungut — nyalakan pengecualiannya.`;
    }
    return null;
  }
  if (gross > profile.microExemptBelowIdr) {
    return `Omzet tercatat bulan ini ${formatIdrPlain(gross)} sudah melewati batas ${formatIdrPlain(profile.microExemptBelowIdr)}, jadi pengecualian usaha mikro tidak lagi berlaku — PBJT-nya seharusnya dipungut mulai sekarang.`;
  }
  return null;
}

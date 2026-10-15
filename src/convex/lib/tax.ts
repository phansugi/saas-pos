/**
 * PPN (VAT) workspace: **tarifnya bisa diatur besar/kecil** dan **bisa
 * diaktifkan/dinonaktifkan**.
 *
 * Aturannya hidup di satu berkas murni karena ada empat pemakai yang harus
 * menjawab hal yang sama: `pos.createSale` (struk), `billing.createInvoice`
 * (tagihan langganan), kedua store (pratinjau di kasir & halaman Pengaturan), dan
 * harness.
 *
 * Tiga keputusan yang sengaja diambil:
 *
 * 1. **Satu setelan untuk seluruh dokumen workspace.** Mematikan PPN berarti
 *    tidak ada PPN di struk penjualan **dan** di tagihan langganan workspace itu.
 *    Setengah-setengah (struk mati, tagihan tetap memungut) membuat pemilik toko
 *    melihat dua angka berbeda dari satu setelan yang sama.
 * 2. **`taxActive` opsional, dan yang kosong berarti AKTIF.** Baris tenant yang
 *    dibuat sebelum kolom ini ada tetap sah dan tetap memungut PPN seperti dulu —
 *    mematikan pajak diam-diam untuk tenant lama jauh lebih berbahaya daripada
 *    membiarkannya seperti sebelumnya (pola yang sama dengan `categories.active`).
 * 3. **Aktif dengan tarif 0% ditolak.** “PPN 0%” dan “PPN tidak aktif” adalah dua
 *    hal yang berbeda bagi pembaca struk; kalau keduanya menghasilkan angka yang
 *    sama, setelannya jadi tidak bisa dibaca ulang dengan yakin.
 */

/** Batas tarif yang masuk akal untuk satu PPN (persen). */
export const TAX_RATE_MIN = 0;
export const TAX_RATE_MAX = 100;

/** Tarif disimpan dengan paling banyak dua angka di belakang koma. */
const TAX_RATE_SCALE = 100;

export interface TaxSetting {
  active: boolean;
  ratePct: number;
}

/** Sumber yang mungkin belum punya kolom `taxActive` (tenant lama). */
export interface TaxSettingSource {
  taxActive?: boolean | null;
  taxRatePct: number;
}

/** Tarif dibulatkan ke dua desimal supaya tidak ada 11,000000000000002 di UI. */
export function normalizeTaxRatePct(value: number): number {
  if (!Number.isFinite(value)) return TAX_RATE_MIN;
  return Math.round(value * TAX_RATE_SCALE) / TAX_RATE_SCALE;
}

/** Tenant tanpa kolom `taxActive` dianggap **aktif** (lihat catatan modul). */
export function taxIsActive(source: { taxActive?: boolean | null }): boolean {
  return source.taxActive ?? true;
}

/** Setelan PPN sebuah tenant dalam bentuk yang dipakai aturan lain. */
export function taxSettingOf(source: TaxSettingSource): TaxSetting {
  return {
    active: taxIsActive(source),
    ratePct: normalizeTaxRatePct(source.taxRatePct),
  };
}

/**
 * Tarif yang benar-benar dipungut: nol saat PPN dimatikan. **Satu-satunya**
 * tempat yang boleh menjawab pertanyaan ini — dipakai server maupun klien, supaya
 * pratinjau kasir dan angka yang dicatat server tidak pernah berbeda.
 */
export function effectiveTaxRatePct(setting: TaxSetting): number {
  return setting.active ? normalizeTaxRatePct(setting.ratePct) : 0;
}

export type TaxRateDecision =
  | { ok: true; value: number }
  | { ok: false; reason: string };

/**
 * Validasi tarif yang diketik pengguna. Pesannya menyebut angka yang benar, bukan
 * “tarif tidak valid” — pemilik toko harus tahu apa yang harus diperbaiki.
 */
export function validateTaxRatePct(
  value: unknown,
  options: { active: boolean },
): TaxRateDecision {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, reason: "Tarif PPN harus berupa angka." };
  }
  if (value < TAX_RATE_MIN) {
    return { ok: false, reason: `Tarif PPN tidak boleh negatif.` };
  }
  if (value > TAX_RATE_MAX) {
    return {
      ok: false,
      reason: `Tarif PPN maksimal ${TAX_RATE_MAX}% — periksa lagi angkanya.`,
    };
  }
  const normalized = normalizeTaxRatePct(value);
  if (normalized === 0 && options.active) {
    return {
      ok: false,
      reason:
        "Tarif PPN tidak bisa 0% selama PPN-nya aktif — matikan saja PPN-nya kalau memang tidak memungut pajak.",
    };
  }
  return { ok: true, value: normalized };
}

/**
 * Membaca angka tarif yang **diketik pengguna**. Angka Indonesia memakai koma
 * untuk desimal, tetapi papan tombol dan tempelan dari tempat lain sama sering
 * memakai titik — keduanya diterima, dan `null` berarti “tidak bisa dibaca”
 * (bukan 0), supaya kolom kosong tidak pernah diam-diam berarti “tarif 0%”.
 */
export function parseTaxRateInput(input: string): number | null {
  const text = input.trim().replace(/\s/g, "").replace(",", ".");
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Angka tarif versi Indonesia: koma desimal, tanpa “,00” yang tidak perlu. */
export function formatTaxRatePct(ratePct: number): string {
  const normalized = normalizeTaxRatePct(ratePct);
  const text = Number.isInteger(normalized)
    ? String(normalized)
    : String(normalized).replace(".", ",");
  return `${text}%`;
}

/** Label pendek untuk struk/kasir: “PPN 11%” atau “PPN tidak aktif”. */
export function taxLabel(setting: TaxSetting): string {
  return setting.active ? `PPN ${formatTaxRatePct(setting.ratePct)}` : "PPN tidak aktif";
}

/** Kalimat sesudah setelannya disimpan, untuk notis halaman Pengaturan. */
export function taxSettingSentence(setting: TaxSetting): string {
  if (!setting.active) {
    return "PPN dimatikan. Struk penjualan berikutnya tidak memungut PPN, dan tagihan langganan workspace ini ikut tanpa PPN. Penjualan lama tidak berubah.";
  }
  return `PPN aktif dengan tarif ${formatTaxRatePct(setting.ratePct)}. Struk penjualan berikutnya memungut PPN sebesar itu, dan penjualan lama tetap memakai tarif yang tercatat di struknya.`;
}

/** Penjelasan singkat di bawah kolom tarif. */
export function taxHint(setting: TaxSetting): string {
  return setting.active
    ? "Tarif ini dipakai struk penjualan dan tagihan langganan. Penjualan yang sudah tercatat tidak ikut berubah."
    : "PPN tidak dipungut di struk penjualan maupun tagihan langganan. Nyalakan lagi kapan saja — data penjualan lama tetap utuh.";
}

export interface TaxSample {
  net: number;
  tax: number;
  gross: number;
  label: string;
}

/**
 * Contoh perhitungan untuk satu nominal bersih. Halaman Pengaturan memakainya
 * supaya pemilik toko melihat akibat tarifnya dalam rupiah sebelum menyimpan,
 * memakai pembulatan yang sama dengan `computeTax` di `lib/billing`.
 */
export function taxSample(setting: TaxSetting, net: number): TaxSample {
  const ratePct = effectiveTaxRatePct(setting);
  const safeNet = Math.max(0, Math.round(net));
  const tax = Math.round(safeNet * (ratePct / 100));
  return { net: safeNet, tax, gross: safeNet + tax, label: taxLabel(setting) };
}

/** Apakah setelan ini sama persis dengan yang tersimpan (untuk menghindari audit kosong). */
export function sameTaxSetting(a: TaxSetting, b: TaxSetting): boolean {
  return a.active === b.active && normalizeTaxRatePct(a.ratePct) === normalizeTaxRatePct(b.ratePct);
}

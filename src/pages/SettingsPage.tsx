import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlarmClock,
  BadgeCheck,
  BellRing,
  ImageUp,
  Minus,
  Percent,
  Plus,
  Power,
  Printer,
  RefreshCw,
  Receipt,
  Save,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { MarketplacePairingCard } from "@/components/MarketplacePairingCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  effectiveTaxRatePct,
  formatTaxRatePct,
  parseTaxRateInput,
  sameTaxSetting,
  taxHint,
  taxLabel,
  taxSample,
  validateTaxRatePct,
  type TaxSetting,
} from "@/lib/tax";
import {
  FNB_ENTITY_LABELS,
  UMKM_FINAL_RATE_PCT,
  fnbMonthlySummary,
  fnbTaxProfileOf,
  formatIdrPlain,
  microExemptWarning,
  orderTotal,
  sameFnbTaxProfile,
  validateFnbTaxProfile,
  type FnbEntityType,
  type FnbTaxProfile,
} from "@/lib/fnbTax";
import { entitlementFor } from "@/lib/billing";
import { settingsSectionVisibility } from "@/lib/settingsVisibility";
import {
  SCAN_BEEP,
  SCAN_BEEP_VOLUME_MAX,
  SCAN_BEEP_VOLUME_MIN,
  scanBeepVolumeHint,
  scanBeepVolumeLabel,
} from "@/lib/scanBeep";
import { useSession } from "@/lib/session";
import {
  sameShiftSetting,
  shiftHourLabel,
  shiftOperatingLabel,
  shiftOwnerAlertHint,
  shiftSettingHint,
  shiftSettingSentence,
  validateShiftSetting,
  type ShiftSetting,
} from "@/lib/shift";
import { useStore } from "@/lib/store";
import {
  RECEIPT_FOOTER_LINE_MAX,
  RECEIPT_FOOTER_MAX_LINES,
  RECEIPT_PRINTERS,
  RECEIPT_WALK_IN_NAME,
  receiptCopiesHint,
  receiptCopiesLabel,
  receiptDocument,
  receiptPaperLabel,
  receiptPrinterOf,
  receiptSettingOf,
  receiptSettingSentence,
  receiptSettingWithCopies,
  receiptSettingWithPaper,
  receiptSettingWithPrinter,
  receiptWidthHint,
  sameReceiptPrinterChoice,
  sameReceiptSetting,
  suggestReceiptSetting,
  validateReceiptSetting,
  type ReceiptDraft,
  type ReceiptSetting,
} from "@/lib/struk";
import {
  describeTenantLogo,
  prepareTenantLogo,
  TENANT_LOGO_TYPES,
  tenantLogoHint,
} from "@/lib/tenantLogo";
import { useScanBeep } from "@/lib/useScanBeep";
import { cn, formatIDR } from "@/lib/utils";

/**
 * Pengaturan workspace — tempat setelan yang berlaku untuk **seluruh dokumen**
 * diatur: PPN, lalu pajak & pungutan khas F&B (PBJT/pajak daerah, biaya layanan,
 * dan kewajiban pajak pusat pengusaha) beserta ringkasan setoran bulanannya.
 *
 * Semua angkanya datang dari store (`tax`), bukan dari salinan di halaman ini:
 * store Convex membaca setelan yang sama dengan yang dibaca `pos.createSale`
 * (baris `tenants`), sedangkan mode demo menyimpannya di sesi. Karena itu angka
 * di kartu ini, di kasir, dan di tagihan langganan tidak bisa berbeda.
 *
 * Yang diketik di sini **belum** berlaku sampai tombol simpan ditekan: pemilik
 * toko bisa melihat akibatnya dalam rupiah (contoh perhitungan) lebih dulu, dan
 * penolakan server (mis. “aktif dengan tarif 0%”) muncul apa adanya.
 */

/** Nominal contoh di kartu pratinjau: cukup besar untuk melihat pembulatannya. */
const SAMPLE_NET = 100_000;

/** Tarif yang sering dipakai di Indonesia, sebagai jalan pintas mengetik. */
const RATE_PRESETS = [5, 11, 12];

/** Tarif PBJT & biaya layanan yang lazim di Perda/kebijakan kafe. */
const FNB_RATE_PRESETS = [5, 7.5, 10];

/** Bentuk badan usaha PPh final UMKM, urut seperti yang tampil di kartu. */
const FNB_ENTITY_ORDER: FnbEntityType[] = ["perorangan", "cv_firma_koperasi", "pt"];

/**
 * Angka rupiah yang diketik pemilik toko: titik/spasi pemisah ribuan dibuang,
 * dan kolom kosong berarti **tidak bisa dibaca** (bukan nol) — supaya batas
 * omzet atau nilai sewa tidak diam-diam menjadi 0 hanya karena kolomnya
 * dikosongkan saat mengetik.
 */
function parseIdrInput(text: string): number {
  const digits = text.replace(/[^\d]/g, "");
  if (digits === "") return Number.NaN;
  return Number(digits);
}

/** Enam angka yang diketik sebagai teks; sisanya boolean & pilihan bentuk badan. */
interface FnbDraftText {
  regionalRate: string;
  microBelow: string;
  serviceRate: string;
  umkmStartYear: string;
  rentMonthly: string;
  rentRate: string;
}

function draftTextOf(profile: FnbTaxProfile): FnbDraftText {
  return {
    regionalRate: String(profile.regionalRatePct),
    microBelow: String(profile.microExemptBelowIdr),
    serviceRate: String(profile.serviceChargePct),
    umkmStartYear: String(profile.umkmStartYear),
    rentMonthly: String(profile.rentMonthlyIdr),
    rentRate: String(profile.rentRatePct),
  };
}

/** Nilai jual contoh di pratinjau struk (sebelum diskon) — kecil, tapi cukup
 * panjang namanya untuk memperlihatkan pembungkusan baris di kertas 58 mm. */
const RECEIPT_SAMPLE_NET = 70_000;

/** Diskon contoh di pratinjau, supaya baris diskon ikut terlihat. */
const RECEIPT_SAMPLE_DISCOUNT = 5_000;

/**
 * Isi contoh untuk pratinjau struk.
 *
 * Pajak & biaya layanannya **tidak** dikarang di halaman ini: keduanya dihitung
 * `orderTotal` — aturan murni yang sama dengan yang dipakai kasir — dari setelan
 * PPN & F&B workspace, jadi pratinjau memperlihatkan struk yang benar-benar akan
 * keluar, bukan contoh yang berbeda dari kasirnya.
 */
function receiptSampleDraft(input: {
  business: string;
  store: string;
  tax: TaxSetting;
  fnbTax: FnbTaxProfile;
}): ReceiptDraft {
  const totals = orderTotal({
    net: RECEIPT_SAMPLE_NET - RECEIPT_SAMPLE_DISCOUNT,
    ppn: input.tax,
    fnb: input.fnbTax,
  });
  const serviceLine = totals.lines.find((line) => line.kind === "service");
  const taxLine = totals.lines.find((line) => line.kind === "tax");
  return {
    business: input.business,
    store: input.store,
    number: "A-00042",
    when: "13/10/2026 14:20",
    items: [
      { name: "Kopi Susu Gula Aren Large", qty: 2, unitPrice: 24_000, amount: 48_000 },
      { name: "Croissant Butter", qty: 1, unitPrice: 22_000, amount: 22_000 },
    ],
    subtotal: RECEIPT_SAMPLE_NET,
    discount: RECEIPT_SAMPLE_DISCOUNT,
    serviceLabel: serviceLine?.label,
    serviceAmount: serviceLine?.amount,
    taxLabel: taxLine?.label,
    taxAmount: taxLine?.amount,
    total: totals.total,
    paid: 100_000,
    change: 100_000 - totals.total,
  };
}

export function SettingsPage() {
  const {
    tax,
    setTax,
    fnbTax,
    setFnbTax,
    fnbTaxMonth,
  receipt,
  setReceipt,
  shift,
  setShift,
  logo,
  setLogo,
  removeLogo,
  modules,
} = useStore();
  const { session } = useSession();
  // Setelan bunyi bip kasir bersifat **per perangkat**, bukan per workspace:
  // pengeras suara yang berbeda itu perangkat, jadi tombol ini tidak menulis ke
  // server sama sekali (lihat `src/lib/scanBeep.ts`).
  const beep = useScanBeep();

  const [active, setActive] = useState(tax.active);
  const [rateText, setRateText] = useState(String(tax.ratePct));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Formulir mengikuti setelan yang **tersimpan**. Kalau diubah dari perangkat
   * lain (mode Convex menyiarkannya langsung), yang tampil di sini ikut berubah —
   * jadi layar ini tidak pernah mengklaim tarif yang sudah tidak berlaku.
   */
  useEffect(() => {
    setActive(tax.active);
    setRateText(String(tax.ratePct));
  }, [tax.active, tax.ratePct]);

  const parsed = parseTaxRateInput(rateText);
  const decision = validateTaxRatePct(parsed ?? Number.NaN, { active });
  /** Setelan yang sedang diketik, dipakai pratinjau & pemeriksaan “berubah?”. */
  const draft: TaxSetting = {
    active,
    ratePct: parsed ?? tax.ratePct,
  };
  const dirty = !sameTaxSetting(draft, tax);
  const sample = useMemo(() => taxSample(draft, SAMPLE_NET), [draft.active, draft.ratePct]);
  const nextEffective = effectiveTaxRatePct(draft);

  async function save() {
    setError(null);
    setNotice(null);

    if (parsed === null) {
      setError("Tarif PPN harus berupa angka. Contoh: 11 atau 11,5");
      return;
    }
    if (!decision.ok) {
      setError(decision.reason);
      return;
    }

    setBusy(true);
    try {
      const result = await setTax({ active, ratePct: decision.value });
      setNotice(
        result.changed
          ? result.sentence
          : "Setelan PPN sudah seperti itu — tidak ada yang perlu diubah.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Menyalakan/mematikan PPN.
   *
   * Saat dimatikan, kolom yang berisi 0 dikembalikan ke tarif yang tersimpan:
   * 0% hanya sah selama PPN mati, jadi menekan tombol ini setelah mencoba angka
   * nol tidak boleh menghapus tarif yang sebenarnya tanpa sengaja.
   */
  function toggleActive() {
    const next = !active;
    if (!next && (parseTaxRateInput(rateText) ?? 0) <= 0) {
      setRateText(String(tax.ratePct));
    }
    setActive(next);
    setError(null);
    setNotice(null);
  }

  function reset() {
    setActive(tax.active);
    setRateText(String(tax.ratePct));
    setError(null);
    setNotice(null);
  }

  /*
    Setelan pajak & pungutan F&B. Seluruh profil disusun dulu di sini (boolean +
    enam angka yang diketik sebagai teks), lalu diperiksa `validateFnbTaxProfile`
    sebelum dikirim — jadi server tidak pernah menerima setelan setengah jadi, dan
    pemilik toko melihat penolakannya sebelum menekan simpan.
  */
  const [fnbDraft, setFnbDraft] = useState<FnbTaxProfile>(fnbTax);
  const [fnbText, setFnbText] = useState<FnbDraftText>(() => draftTextOf(fnbTax));
  const [fnbBusy, setFnbBusy] = useState(false);

  /**
   * Formulir F&B mengikuti setelan yang **tersimpan** (mode Convex menyiarkannya
   * langsung), supaya layar ini tidak pernah menampilkan angka yang sudah tidak
   * berlaku setelah diubah dari perangkat lain.
   */
  useEffect(() => {
    setFnbDraft(fnbTax);
    setFnbText(draftTextOf(fnbTax));
  }, [fnbTax]);

  /** Profil yang sedang diketik, dengan angka hasil pembacaan kolom teks. */
  const fnbCandidate: FnbTaxProfile = {
    ...fnbDraft,
    regionalRatePct: parseTaxRateInput(fnbText.regionalRate) ?? Number.NaN,
    microExemptBelowIdr: parseIdrInput(fnbText.microBelow),
    serviceChargePct: parseTaxRateInput(fnbText.serviceRate) ?? Number.NaN,
    umkmStartYear: Number(fnbText.umkmStartYear.replace(/\D/g, "")) || Number.NaN,
    rentMonthlyIdr: parseIdrInput(fnbText.rentMonthly),
    rentRatePct: parseTaxRateInput(fnbText.rentRate) ?? Number.NaN,
  };
  const fnbDecision = validateFnbTaxProfile(fnbCandidate);
  const fnbDirty = !sameFnbTaxProfile(fnbTaxProfileOf(fnbCandidate), fnbTax);

  /**
   * Pratinjau memakai profil yang **bisa dibaca** (`fnbTaxProfileOf` mengembalikan
   * angka rusak ke bawaannya), sedangkan penyimpanan tetap menolak angka rusak —
   * jadi angka di kartu ini tidak pernah menyesatkan tanpa alasan yang terlihat.
   */
  const fnbPreview = fnbTaxProfileOf(fnbCandidate);
  const fnbSample = orderTotal({ net: SAMPLE_NET, ppn: tax, fnb: fnbPreview });
  const fnbSummary = fnbMonthlySummary({
    profile: fnbPreview,
    ppn: tax,
    year: fnbTaxMonth.year,
    monthGrossIdr: fnbTaxMonth.monthGrossIdr,
    beforeMonthGrossIdr: fnbTaxMonth.beforeMonthGrossIdr,
    recordedSales: fnbTaxMonth.recordedSales,
  });
  const fnbWarning = microExemptWarning({
    profile: fnbPreview,
    monthGrossIdr: fnbTaxMonth.monthGrossIdr,
  });

  async function saveFnb() {
    setError(null);
    setNotice(null);
    if (!fnbDecision.ok) {
      setError(fnbDecision.reason);
      return;
    }
    setFnbBusy(true);
    try {
      const result = await setFnbTax(fnbDecision.value);
      setNotice(
        result.changed
          ? result.sentence
          : "Setelan pajak F&B sudah seperti itu — tidak ada yang perlu diubah.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setFnbBusy(false);
    }
  }

  function resetFnb() {
    setFnbDraft(fnbTax);
    setFnbText(draftTextOf(fnbTax));
    setError(null);
    setNotice(null);
  }

  /** Satu bidang boolean/teks draft; angka dibiarkan di `fnbText`. */
  function patchFnb(patch: Partial<FnbTaxProfile>) {
    setFnbDraft((current) => ({ ...current, ...patch }));
    setError(null);
    setNotice(null);
  }

  function patchFnbText(key: keyof FnbDraftText, value: string) {
    setFnbText((current) => ({ ...current, [key]: value }));
    setError(null);
    setNotice(null);
  }

  /*
    Setelan struk belanja. Formulirnya mengikuti setelan yang **tersimpan** (mode
    Convex menyiarkannya langsung), dan yang tampil di pratinjau selalu setelan
    yang sedang diketik — supaya pemilik toko melihat akibat lebar kertas & jumlah
    rangkapnya **sebelum** menyimpan, bukan menebak dari label.
  */
  const [receiptDraft, setReceiptDraft] = useState<ReceiptSetting>(receipt);
  const [receiptBusy, setReceiptBusy] = useState(false);

  useEffect(() => {
    setReceiptDraft(receipt);
  }, [receipt]);

  /*
    Logo toko. Berkasnya diperkecil dulu di klien (`prepareTenantLogo`) sebelum
    dikirim, sama seperti gambar produk — fotonya biasanya dari ponsel. Yang
    tersimpan bukan berkasnya melainkan tautannya (`tenants.logo`), jadi yang
    disimpan di sini hanya keadaan tombolnya.
  */
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoNotice, setLogoNotice] = useState<string | null>(null);

  async function pilihLogo(files: File[]) {
    const file = files[0];
    if (!file) return;
    setLogoBusy(true);
    setLogoError(null);
    setLogoNotice(null);
    try {
      const prepared = await prepareTenantLogo(file);
      await setLogo(prepared.blob);
      setLogoNotice(
        prepared.compressed
          ? `Logo tersimpan (${Math.round(prepared.bytes / 1024)} KB setelah diperkecil dari ${Math.round(
              prepared.originalBytes / 1024,
            )} KB).`
          : `Logo tersimpan (${Math.round(prepared.bytes / 1024)} KB).`,
      );
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Logo gagal disimpan.");
    } finally {
      setLogoBusy(false);
    }
  }

  async function hapusLogo() {
    setLogoBusy(true);
    setLogoError(null);
    setLogoNotice(null);
    try {
      await removeLogo();
      setLogoNotice("Logo dihapus. Struk kembali dicetak tanpa logo.");
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Logo gagal dihapus.");
    } finally {
      setLogoBusy(false);
    }
  }

  /** Setelan yang sedang diketik; catatan kakinya ikut diketik apa adanya. */
  const receiptCandidate: ReceiptSetting = receiptDraft;
  const receiptDecision = validateReceiptSetting(receiptCandidate);
  const receiptDirty = !sameReceiptSetting(receiptCandidate, receipt);
  /**
   * Yang dipakai pratinjau: setelan yang bisa dibaca (`receiptSettingOf`
   * mengembalikan nilai janggal ke bawaannya), sedangkan penyimpanan tetap
   * menolak nilai janggal — jadi pratinjau tidak pernah menampilkan bentuk struk
   * yang tidak mungkin dicetak tanpa alasan yang terlihat.
   */
  const receiptPreviewSetting = receiptSettingOf(receiptCandidate);
  const receiptPreviewPrinter = receiptPrinterOf(receiptPreviewSetting.printerId);
  const receiptPreviewDocument = receiptDocument(
    receiptPreviewSetting,
    {
      ...receiptSampleDraft({
        business: session?.tenant?.name ?? "Nama Usaha",
        store: session?.tenant?.storeName ?? "Cabang Utama",
        tax,
        fnbTax,
      }),
      // Logo toko yang sedang terpasang: pratinjau menampilkan struk yang benar-benar
      // akan keluar, termasuk logonya — bukan contoh tanpa logo.
      logoUrl: logo?.url,
    },
  );
  /** Pratinjau memakai kertas selebar yang dipilih — 58 mm dan 80 mm tidak sama. */
  const receiptPreviewWidthMm = receiptPreviewSetting.paperWidthMm;
  /*
    Setelan yang fiturnya tidak ada di paket tidak ditampilkan (aturannya di
    `@/lib/settingsVisibility`): kartu F&B mengikuti modul F&B yang hidup, dan
    kartu struk mengikuti fitur cetak ESC/POS. Profil F&B yang **masih memungut**
    tetap tampil walau modulnya mati, supaya pungutan yang sudah berjalan bisa
    dihentikan — bukan disembunyikan bersama kartunya.
  */
  const fnbTaxInUse =
    fnbTax.regionalActive ||
    fnbTax.serviceChargeActive ||
    fnbTax.umkmFinalActive ||
    fnbTax.payrollTaxActive ||
    fnbTax.rentTaxActive;
  const settingsSections = settingsSectionVisibility({
    // `modules.planKey` sudah berasal dari server (bukan sesi yang mungkin
    // tertinggal), jadi paket yang digerbang di sini sama dengan yang dipakai
    // backend saat modul & fitur diperiksa.
    entitlements: entitlementFor(modules.planKey),
    activeVerticals: modules.activeVerticals,
    fnbTaxInUse,
  });
  /*
    Saran setelan dari bentuk workspace. Yang menentukan jawabannya modul yang
    sedang hidup (F&B, grosir, atau ritel biasa), dan yang memutuskan tetap pemilik
    toko: peramban tidak punya cara melihat printer yang benar-benar terpasang,
    jadi menuliskan pilihan mesin diam-diam bisa membuat struknya tidak keluar
    sama sekali. Karena itu sarannya ditawarkan sebagai satu klik.
  */
  const receiptSuggestion = suggestReceiptSetting({
    vertical: session?.tenant?.vertical ?? null,
    verticals: modules.activeVerticals,
  });
  /** Pilihan mesinnya (printer/kertas/rangkap) sudah sama dengan sarannya. */
  const receiptSuggestionApplied = sameReceiptPrinterChoice(
    receiptPreviewSetting,
    receiptSuggestion.setting,
  );

  function patchReceipt(patch: Partial<ReceiptSetting>) {
    setReceiptDraft((current) => ({ ...current, ...patch }));
    setError(null);
    setNotice(null);
  }

  async function saveReceipt() {
    setError(null);
    setNotice(null);
    if (!receiptDecision.ok) {
      setError(receiptDecision.reason);
      return;
    }
    setReceiptBusy(true);
    try {
      const result = await setReceipt(receiptDecision.value);
      setNotice(
        result.changed
          ? result.sentence
          : "Setelan struk sudah seperti itu — tidak ada yang perlu diubah.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReceiptBusy(false);
    }
  }

  function resetReceipt() {
    setReceiptDraft(receipt);
    setError(null);
    setNotice(null);
  }

  /*
    Setelan pengingat tutup shift. Jam & ambangnya diketik sebagai teks dulu,
    bukan angka langsung: kolom yang sedang kosong saat pemilik toko mengetik
    harus bisa dibedakan dari angka yang salah, dan yang menentukan sah/tidaknya
    tetap aturan murni `@/lib/shift` (jam 0–23, ambang 1–24 jam) — di halaman ini
    **dan** di server.
  */
  const [shiftActiveDraft, setShiftActiveDraft] = useState(shift.active);
  const [shiftHourText, setShiftHourText] = useState(String(shift.reminderHour));
  const [shiftHoursText, setShiftHoursText] = useState(String(shift.longShiftHours));
  /*
    Jam operasional & saklar pemberitahuan ke pemilik toko. Jamnya juga diketik
    sebagai teks dengan alasan yang sama seperti jam pengingat: kolom kosong harus
    bisa dibedakan dari angka yang salah, dan yang memutuskan sah/tidaknya tetap
    aturan murni `@/lib/shift` — di halaman ini maupun di server.
  */
  const [shiftOpenText, setShiftOpenText] = useState(String(shift.openHour));
  const [shiftCloseText, setShiftCloseText] = useState(String(shift.closeHour));
  const [shiftNotifyDraft, setShiftNotifyDraft] = useState(shift.notifyOwner);
  const [shiftBusy, setShiftBusy] = useState(false);

  useEffect(() => {
    setShiftActiveDraft(shift.active);
    setShiftHourText(String(shift.reminderHour));
    setShiftHoursText(String(shift.longShiftHours));
    setShiftOpenText(String(shift.openHour));
    setShiftCloseText(String(shift.closeHour));
    setShiftNotifyDraft(shift.notifyOwner);
  }, [
    shift.active,
    shift.reminderHour,
    shift.longShiftHours,
    shift.openHour,
    shift.closeHour,
    shift.notifyOwner,
  ]);

  /** Kolom yang belum berisi angka sah menghasilkan `null` (bukan 0). */
  function parseShiftNumber(text: string): number | null {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    const value = Number(trimmed);
    return Number.isInteger(value) ? value : null;
  }

  const shiftCandidate: ShiftSetting = {
    active: shiftActiveDraft,
    reminderHour: parseShiftNumber(shiftHourText) ?? Number.NaN,
    longShiftHours: parseShiftNumber(shiftHoursText) ?? Number.NaN,
    openHour: parseShiftNumber(shiftOpenText) ?? Number.NaN,
    closeHour: parseShiftNumber(shiftCloseText) ?? Number.NaN,
    notifyOwner: shiftNotifyDraft,
  };
  const shiftDecision = validateShiftSetting(shiftCandidate);
  const shiftDirty = !sameShiftSetting(shiftCandidate, shift);

  function patchShift() {
    setError(null);
    setNotice(null);
  }

  async function saveShift() {
    setError(null);
    setNotice(null);
    if (!shiftDecision.ok) {
      setError(shiftDecision.reason);
      return;
    }
    setShiftBusy(true);
    try {
      const result = await setShift(shiftDecision.value);
      setNotice(
        result.changed
          ? result.sentence
          : "Setelan pengingat tutup shift sudah seperti itu — tidak ada yang perlu diubah.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setShiftBusy(false);
    }
  }

  function resetShift() {
    setShiftActiveDraft(shift.active);
    setShiftHourText(String(shift.reminderHour));
    setShiftHoursText(String(shift.longShiftHours));
    setShiftOpenText(String(shift.openHour));
    setShiftCloseText(String(shift.closeHour));
    setShiftNotifyDraft(shift.notifyOwner);
    setError(null);
    setNotice(null);
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-primary/12 text-primary">
            <Percent className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Pengaturan workspace</h2>
            <p className="text-sm text-muted-foreground">
              Setelan berlaku untuk seluruh dokumen workspace ini. Hanya pemilik, manajer, dan
              keuangan yang bisa mengubahnya.
            </p>
          </div>
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          {notice}
        </p>
      )}

      <MarketplacePairingCard />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base">Setelan PPN</CardTitle>
              <CardDescription className="mt-1">
                Tarifnya bisa diubah besar/kecil, dan PPN-nya bisa dimatikan sekaligus.
              </CardDescription>
            </div>
            <Badge variant={tax.active ? "default" : "secondary"} className="shrink-0 gap-1">
              <BadgeCheck className="size-3" />
              {taxLabel(tax)}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {active ? "PPN dipungut" : "PPN tidak dipungut"}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {active
                  ? `Struk penjualan memungut ${formatTaxRatePct(draft.ratePct)} dari nilai setelah diskon.`
                  : "Struk penjualan tidak menambahkan pajak sama sekali."}
              </p>
            </div>
            <Button
              type="button"
              role="switch"
              aria-checked={active}
              aria-label="Aktifkan PPN"
              variant={active ? "outline" : "default"}
              className="gap-2"
              onClick={toggleActive}
            >
              <Power className="size-4" />
              {active ? "Matikan PPN" : "Nyalakan PPN"}
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-start">
            <div className="space-y-2">
              <Label htmlFor="tax-rate">Tarif PPN (%)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="tax-rate"
                  inputMode="decimal"
                  autoComplete="off"
                  value={rateText}
                  disabled={!active}
                  aria-describedby="tax-rate-hint"
                  onChange={(event) => {
                    setRateText(event.target.value);
                    setError(null);
                    setNotice(null);
                  }}
                  className="font-mono"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {RATE_PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    size="sm"
                    variant={draft.ratePct === preset && active ? "secondary" : "outline"}
                    disabled={!active}
                    onClick={() => {
                      setRateText(String(preset));
                      setError(null);
                      setNotice(null);
                    }}
                  >
                    {formatTaxRatePct(preset)}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="overflow-hidden rounded-lg border border-border/60">
                <table className="w-full text-sm">
                  <caption className="sr-only">Contoh perhitungan PPN</caption>
                  <tbody className="divide-y divide-border/60">
                    <tr>
                      <td className="px-4 py-2 text-muted-foreground">
                        Belanja (sebelum pajak)
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {formatIDR(sample.net)}
                      </td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2 text-muted-foreground">
                        {active ? `PPN ${formatTaxRatePct(draft.ratePct)}` : "PPN (dimatikan)"}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2 text-right font-mono",
                          active ? "" : "text-muted-foreground",
                        )}
                      >
                        {formatIDR(sample.tax)}
                      </td>
                    </tr>
                    <tr className="bg-secondary/20 font-medium">
                      <td className="px-4 py-2">Total dibayar pembeli</td>
                      <td className="px-4 py-2 text-right font-mono">{formatIDR(sample.gross)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p id="tax-rate-hint" className="text-xs text-muted-foreground">
                {taxHint(draft)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              className="gap-2"
              disabled={busy || !dirty}
              onClick={() => void save()}
            >
              <Save className="size-4" />
              {busy ? "Menyimpan…" : "Simpan setelan PPN"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="gap-2"
              disabled={busy || !dirty}
              onClick={reset}
            >
              <RefreshCw className="size-4" />
              Batalkan perubahan
            </Button>
            {dirty && (
              <p className="text-xs text-muted-foreground">
                Belum disimpan: yang akan berlaku {active
                  ? `PPN ${formatTaxRatePct(draft.ratePct)}`
                  : "tanpa PPN"}
                .
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {settingsSections.fnbTax && (
      <Card id="pajak-fnb" data-testid="setelan-pajak-fnb">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Receipt className="size-4 text-primary" />
                Pajak &amp; pungutan F&amp;B
              </CardTitle>
              <CardDescription className="mt-1">
                Untuk kafe, restoran, dan warung: pajak daerah yang dipungut dari pelanggan
                (PBJT — pengganti istilah lama Pajak Restoran/PB1), biaya layanan yang bukan
                pajak, dan kewajiban pajak pusat pengusahanya.
              </CardDescription>
            </div>
            <Badge
              variant={fnbTax.regionalActive || fnbTax.serviceChargeActive ? "default" : "secondary"}
              className="shrink-0 gap-1"
            >
              <BadgeCheck className="size-3" />
              {fnbTax.regionalActive
                ? fnbTax.microExemptActive
                  ? "PBJT: pengecualian mikro"
                  : `PBJT ${formatTaxRatePct(fnbTax.regionalRatePct)}`
                : "PBJT belum dipungut"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* 1. Pajak daerah: dipungut dari pelanggan, menggantikan PPN. */}
          <div
            data-testid="fnb-pbjt"
            className="space-y-4 rounded-lg border border-border/60 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  PBJT makanan dan/atau minuman — pajak daerah
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Dipungut langsung dari pelanggan di struk, lalu disetor ke kas daerah (Bapenda)
                  setiap bulan. Tarifnya ditetapkan Perda kabupaten/kota — maksimal 10%.
                </p>
              </div>
              <Button
                type="button"
                role="switch"
                aria-checked={fnbDraft.regionalActive}
                aria-label="Aktifkan PBJT"
                variant={fnbDraft.regionalActive ? "outline" : "default"}
                className="gap-2"
                onClick={() => patchFnb({ regionalActive: !fnbDraft.regionalActive })}
              >
                <Power className="size-4" />
                {fnbDraft.regionalActive ? "Matikan PBJT" : "Nyalakan PBJT"}
              </Button>
            </div>

            {fnbDraft.regionalActive && (
              <>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-start">
                  <div className="space-y-2">
                    <Label htmlFor="fnb-regional-rate">Tarif PBJT (%)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="fnb-regional-rate"
                        inputMode="decimal"
                        autoComplete="off"
                        value={fnbText.regionalRate}
                        onChange={(event) => patchFnbText("regionalRate", event.target.value)}
                        className="font-mono"
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {FNB_RATE_PRESETS.map((preset) => (
                        <Button
                          key={preset}
                          type="button"
                          size="sm"
                          variant={
                            fnbPreview.regionalRatePct === preset ? "secondary" : "outline"
                          }
                          onClick={() => patchFnbText("regionalRate", String(preset))}
                        >
                          {formatTaxRatePct(preset)}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2 text-xs text-muted-foreground">
                    <p>
                      Struk pelanggan akan menampilkan barisnya sendiri: belanja{" "}
                      {formatIDR(fnbSample.net)}
                      {fnbSample.serviceCharge > 0 &&
                        ` + biaya layanan ${formatIDR(fnbSample.serviceCharge)}`}
                      {" → "}pajak {formatIDR(fnbSample.tax)} → total{" "}
                      <strong className="text-foreground">{formatIDR(fnbSample.total)}</strong>.
                    </p>
                    <p>
                      Kalau PBJT menyala, <strong className="text-foreground">PPN pusat tidak
                      dipungut</strong> untuk makanan/minuman yang disajikan langsung — memungut
                      keduanya berarti pelanggan membayar dua pajak untuk satu gelas kopi. Barang
                      kemasan pabrik (mis. snack kemasan) tetap kena PPN dan sebaiknya dicatat
                      terpisah.
                    </p>
                    {tax.active && (
                      <p>
                        Setelan PPN workspace ini masih aktif (
                        {formatTaxRatePct(effectiveTaxRatePct(tax))}) — ia otomatis tidak
                        dipungut selama PBJT di atas menyala.
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border border-dashed border-border/70 p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      id="fnb-micro-exempt"
                      type="checkbox"
                      checked={fnbDraft.microExemptActive}
                      onChange={(event) =>
                        patchFnb({ microExemptActive: event.target.checked })
                      }
                    />
                    Usaha mikro — PBJT tidak dipungut
                  </label>
                  {fnbDraft.microExemptActive && (
                    <div className="space-y-2 sm:max-w-xs">
                      <Label htmlFor="fnb-micro-below">Batas omzet bulanan (Rp)</Label>
                      <Input
                        id="fnb-micro-below"
                        inputMode="numeric"
                        autoComplete="off"
                        value={fnbText.microBelow}
                        onChange={(event) => patchFnbText("microBelow", event.target.value)}
                        className="font-mono"
                      />
                      <p className="text-xs text-muted-foreground">
                        Batas minimum ditetapkan Perda setempat — mis. DKI Jakarta tidak
                        memungut PBJT untuk omzet sampai Rp 42.000.000 per bulan.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* 2. Biaya layanan: dipungut dari pelanggan, tetapi bukan pajak. */}
          <div
            data-testid="fnb-service"
            className="space-y-4 rounded-lg border border-border/60 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">Biaya layanan (service charge)</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Kebijakan internal restoran (SE-04/BW/1999) yang dibagikan sebagai insentif/tip
                  karyawan — <strong className="text-foreground">bukan pajak</strong> dan bukan
                  setoran ke kas negara, jadi barisnya dipisah dari pajak di struk.
                </p>
              </div>
              <Button
                type="button"
                role="switch"
                aria-checked={fnbDraft.serviceChargeActive}
                aria-label="Aktifkan biaya layanan"
                variant={fnbDraft.serviceChargeActive ? "outline" : "default"}
                className="gap-2"
                onClick={() => patchFnb({ serviceChargeActive: !fnbDraft.serviceChargeActive })}
              >
                <Power className="size-4" />
                {fnbDraft.serviceChargeActive ? "Matikan biaya layanan" : "Nyalakan biaya layanan"}
              </Button>
            </div>

            {fnbDraft.serviceChargeActive && (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-start">
                <div className="space-y-2">
                  <Label htmlFor="fnb-service-rate">Tarif biaya layanan (%)</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="fnb-service-rate"
                      inputMode="decimal"
                      autoComplete="off"
                      value={fnbText.serviceRate}
                      onChange={(event) => patchFnbText("serviceRate", event.target.value)}
                      className="font-mono"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {FNB_RATE_PRESETS.map((preset) => (
                      <Button
                        key={preset}
                        type="button"
                        size="sm"
                        variant={fnbPreview.serviceChargePct === preset ? "secondary" : "outline"}
                        onClick={() => patchFnbText("serviceRate", String(preset))}
                      >
                        {formatTaxRatePct(preset)}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3 text-xs text-muted-foreground">
                  <p>
                    Kisaran lazimnya 5–10% dari harga makanan. Pada contoh belanja Rp 100.000,
                    biaya layanannya {formatIDR(fnbPreview.serviceChargeActive
                      ? Math.round(100_000 * (fnbPreview.serviceChargePct / 100))
                      : 0)}.
                  </p>
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      id="fnb-service-in-base"
                      type="checkbox"
                      checked={fnbDraft.serviceChargeInTaxBase}
                      onChange={(event) =>
                        patchFnb({ serviceChargeInTaxBase: event.target.checked })
                      }
                    />
                    Pajaknya dihitung dari nilai termasuk biaya layanan
                  </label>
                  <p>
                    Sebagian Perda menghitung pajak setelah biaya layanan, sebagian tidak —
                    centang kalau aturan daerah Anda menghitungnya termasuk biaya layanan.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 3. Kewajiban pusat: dihitung dari omzet, bukan ditambahkan ke struk. */}
          <div data-testid="fnb-pusat" className="space-y-4 rounded-lg border border-border/60 p-4">
            <div className="min-w-0">
              <div className="text-sm font-medium">Kewajiban pajak pusat pengusaha</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Tidak ada satu sen pun yang ditambahkan ke struk pelanggan dari bagian ini —
                inilah pajak yang menjadi tanggungan pemilik usaha.
              </p>
            </div>

            <div className="space-y-3 rounded-lg border border-dashed border-border/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <span className="font-medium">PPh final UMKM {formatTaxRatePct(UMKM_FINAL_RATE_PCT)}</span>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Dihitung dari omzet bruto bulanan (PP No. 55 Tahun 2022) — bukan ditagihkan ke
                    pelanggan.
                  </p>
                </div>
                <Button
                  type="button"
                  role="switch"
                  aria-checked={fnbDraft.umkmFinalActive}
                  aria-label="Aktifkan PPh final UMKM"
                  variant={fnbDraft.umkmFinalActive ? "outline" : "default"}
                  className="gap-2"
                  onClick={() => patchFnb({ umkmFinalActive: !fnbDraft.umkmFinalActive })}
                >
                  <Power className="size-4" />
                  {fnbDraft.umkmFinalActive ? "Matikan PPh final" : "Nyalakan PPh final"}
                </Button>
              </div>

              {fnbDraft.umkmFinalActive && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <span className="text-sm">Bentuk badan usaha</span>
                    <div className="flex flex-wrap gap-1.5">
                      {FNB_ENTITY_ORDER.map((entity) => (
                        <Button
                          key={entity}
                          type="button"
                          size="sm"
                          variant={fnbDraft.umkmEntityType === entity ? "secondary" : "outline"}
                          onClick={() => patchFnb({ umkmEntityType: entity })}
                        >
                          {FNB_ENTITY_LABELS[entity]}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Menentukan batas waktunya: orang pribadi 7 tahun, CV/Firma/Koperasi 4 tahun,
                      PT 3 tahun sejak tarif 0,5% mulai dipakai.
                    </p>
                  </div>
                  <div className="space-y-2 sm:max-w-[220px]">
                    <Label htmlFor="fnb-umkm-start-year">Tahun mulai memakai tarif 0,5%</Label>
                    <Input
                      id="fnb-umkm-start-year"
                      inputMode="numeric"
                      autoComplete="off"
                      value={fnbText.umkmStartYear}
                      onChange={(event) => patchFnbText("umkmStartYear", event.target.value)}
                      className="font-mono"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {fnbSummary.umkm.eligible
                      ? `Omzet tahun ini ${formatIdrPlain(fnbSummary.umkm.yearToDateGrossIdr)} → perkiraan PPh final tahun ini ${formatIdrPlain(fnbSummary.umkm.yearTaxIdr)} (bulan ini ${formatIdrPlain(fnbSummary.umkm.monthTaxIdr)}). Tahun terakhir tarif ini untuk ${fnbSummary.umkm.entityLabel}: ${fnbSummary.umkm.lastEligibleYear}.`
                      : fnbSummary.umkm.note}
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border/70 p-3">
              <div className="min-w-0 text-sm">
                <span className="font-medium">PPh Pasal 21 — pajak karyawan</span>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {fnbSummary.payroll.note}
                </p>
              </div>
              <Button
                type="button"
                role="switch"
                aria-checked={fnbDraft.payrollTaxActive}
                aria-label="Aktifkan PPh 21"
                variant={fnbDraft.payrollTaxActive ? "outline" : "default"}
                className="gap-2"
                onClick={() => patchFnb({ payrollTaxActive: !fnbDraft.payrollTaxActive })}
              >
                <Power className="size-4" />
                {fnbDraft.payrollTaxActive ? "Matikan PPh 21" : "Nyalakan PPh 21"}
              </Button>
            </div>

            <div className="space-y-3 rounded-lg border border-dashed border-border/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <span className="font-medium">PPh Pasal 4 ayat (2) — sewa tempat usaha</span>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Dipotong dari pembayaran sewa ruko/gedung/tanah (tarif umumnya 10%), lalu
                    disetor ke kas negara. Bukan pungutan ke pelanggan.
                  </p>
                </div>
                <Button
                  type="button"
                  role="switch"
                  aria-checked={fnbDraft.rentTaxActive}
                  aria-label="Aktifkan PPh 4 ayat (2)"
                  variant={fnbDraft.rentTaxActive ? "outline" : "default"}
                  className="gap-2"
                  onClick={() => patchFnb({ rentTaxActive: !fnbDraft.rentTaxActive })}
                >
                  <Power className="size-4" />
                  {fnbDraft.rentTaxActive ? "Matikan PPh sewa" : "Nyalakan PPh sewa"}
                </Button>
              </div>

              {fnbDraft.rentTaxActive && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="fnb-rent-monthly">Nilai sewa per bulan (Rp)</Label>
                    <Input
                      id="fnb-rent-monthly"
                      inputMode="numeric"
                      autoComplete="off"
                      value={fnbText.rentMonthly}
                      onChange={(event) => patchFnbText("rentMonthly", event.target.value)}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fnb-rent-rate">Tarif PPh sewa (%)</Label>
                    <Input
                      id="fnb-rent-rate"
                      inputMode="decimal"
                      autoComplete="off"
                      value={fnbText.rentRate}
                      onChange={(event) => patchFnbText("rentRate", event.target.value)}
                      className="font-mono"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    Potongan tiap bulan:{" "}
                    <strong className="text-foreground">
                      {formatIdrPlain(fnbSummary.rent.withheldIdr)}
                    </strong>{" "}
                    dari sewa {formatIdrPlain(fnbSummary.rent.monthlyRentIdr)}.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* 4. Ringkasan setoran bulan berjalan dari omzet yang tercatat. */}
          <div data-testid="fnb-ringkasan" className="space-y-3">
            <div>
              <div className="text-sm font-medium">Ringkasan setoran bulan ini</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Dari {fnbTaxMonth.recordedSales} transaksi yang tercatat bulan ini (omzet{" "}
                {formatIdrPlain(fnbTaxMonth.monthGrossIdr)}). Perkiraan dari data aplikasi — bukan
                perhitungan pajak resmi.
              </p>
            </div>
            <div className="overflow-hidden rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <caption className="sr-only">Ringkasan setoran pajak &amp; pungutan bulan ini</caption>
                <tbody className="divide-y divide-border/60">
                  {fnbSummary.rows.map((row) => (
                    <tr key={row.label}>
                      <td className="px-4 py-2">
                        <div className="font-medium">{row.label}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{row.note}</div>
                      </td>
                      <td className="px-4 py-2 text-right align-top">
                        <div className="font-mono">{formatIdrPlain(row.amountIdr)}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {row.source === "pelanggan" ? "dari pelanggan" : "kewajiban pengusaha"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {fnbWarning && (
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {fnbWarning}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              PPN yang sudah dipungut kasir tidak ikut di sini — itu bagian setoran PPN biasa di
              kartu atas.
            </p>
          </div>

          {!fnbDecision.ok && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {fnbDecision.reason}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              className="gap-2"
              disabled={fnbBusy || !fnbDirty || !fnbDecision.ok}
              onClick={() => void saveFnb()}
            >
              <Save className="size-4" />
              {fnbBusy ? "Menyimpan…" : "Simpan setelan pajak F&B"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="gap-2"
              disabled={fnbBusy || !fnbDirty}
              onClick={resetFnb}
            >
              <RefreshCw className="size-4" />
              Batalkan perubahan
            </Button>
            {fnbDirty && fnbDecision.ok && (
              <p className="text-xs text-muted-foreground">
                Belum disimpan: pelanggan{" "}
                {fnbPreview.regionalActive
                  ? fnbPreview.microExemptActive
                    ? " tidak dipungut PBJT (pengecualian usaha mikro)"
                    : ` dipungut PBJT ${formatTaxRatePct(fnbPreview.regionalRatePct)}`
                  : " tidak dipungut pajak daerah"}
                {fnbPreview.serviceChargeActive
                  ? `, ditambah biaya layanan ${formatTaxRatePct(fnbPreview.serviceChargePct)}`
                  : ""}
                .
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      )}

      {settingsSections.receipt && (
      <Card id="struk-belanja" data-testid="setelan-struk-belanja">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Printer className="size-4 text-primary" />
                Struk belanja
              </CardTitle>
              <CardDescription className="mt-1">
                Bentuk struk yang keluar dari printer di kasir
                (<code className="font-mono text-xs">/app/pos</code>): jenis printernya, lebar
                kertas, jumlah rangkap, dan catatan kakinya. Yang dipilih di sini benar-benar
                mengubah apa yang tercetak, bukan hanya tampilan di layar.
              </CardDescription>
            </div>
            <Badge variant={receiptDirty ? "secondary" : "default"} className="shrink-0 gap-1">
              <Printer className="size-3" />
              {receiptPrinterOf(receipt.printerId).label} · {receiptPaperLabel(receipt)}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/*
            0. Logo toko. Ia bagian dari identitas yang tercetak di struk, jadi
            tempatnya di kartu struk. Yang tersimpan adalah tautan berkasnya
            (`tenants.logo`), dan kasir langsung memakai logo itu — mengubah logo
            tidak perlu menyimpan setelan struk lebih dulu.
          */}
          <div className="space-y-3" data-testid="struk-logo">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="text-sm font-medium">Logo toko</span>
                <p className="mt-0.5 text-xs text-muted-foreground">{tenantLogoHint()}</p>
              </div>
              <Badge variant={logo ? "secondary" : "outline"} className="shrink-0">
                {describeTenantLogo(Boolean(logo))}
              </Badge>
            </div>

            <div className="flex flex-wrap items-start gap-4">
              {logo ? (
                <figure className="overflow-hidden rounded-lg border border-border bg-background px-4 py-3 text-center">
                  <img
                    src={logo.url}
                    alt="Logo toko"
                    data-testid="logo-toko-gambar"
                    className="mx-auto h-16 w-auto max-w-48 object-contain"
                  />
                  <figcaption className="mt-2 text-[11px] text-muted-foreground">
                    Logo yang tercetak di struk
                  </figcaption>
                </figure>
              ) : (
                <div
                  data-testid="logo-toko-kosong"
                  className="grid min-h-24 place-items-center rounded-lg border border-dashed border-border/70 px-6 py-4 text-center text-xs text-muted-foreground"
                >
                  Belum ada logo — struk dicetak tanpa logo.
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-xs ${
                    logoBusy
                      ? "cursor-not-allowed border-border text-muted-foreground/60"
                      : "border-primary/40 text-primary hover:border-primary"
                  }`}
                >
                  <span className="space-y-1 text-center">
                    <ImageUp className="mx-auto size-5" />
                    <span className="block font-medium">
                      {logoBusy ? "Menyiapkan…" : logo ? "Ganti logo" : "Tambah logo"}
                    </span>
                  </span>
                  <input
                    type="file"
                    accept={TENANT_LOGO_TYPES.join(",")}
                    className="sr-only"
                    aria-label="Pilih berkas logo toko"
                    disabled={logoBusy}
                    onChange={(event) => {
                      const input = event.currentTarget;
                      const files = Array.from(input.files ?? []);
                      // Dikosongkan supaya berkas yang sama bisa dipilih ulang
                      // (mis. setelah logonya dihapus).
                      input.value = "";
                      void pilihLogo(files);
                    }}
                  />
                </label>
                {logo && (
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    aria-label="Hapus logo toko"
                    disabled={logoBusy}
                    onClick={() => void hapusLogo()}
                  >
                    <Trash2 className="size-4" />
                    Hapus logo
                  </Button>
                )}
              </div>
            </div>

            {logoError && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {logoError}
              </p>
            )}
            {logoNotice && <p className="text-xs text-muted-foreground">{logoNotice}</p>}
          </div>

          {/*
            Saran setelan otomatis dari bentuk workspace. Ia ditaruh paling atas
            karena inilah yang menjawab “printer apa yang saya butuhkan” tanpa
            pemilik toko harus membaca ketiga katalog di bawahnya dulu.
          */}
          <div
            data-testid="struk-saran-otomatis"
            className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Sparkles className="size-4 text-primary" />
                    Saran setelan otomatis
                  </span>
                  <Badge variant="secondary" className="shrink-0">
                    {receiptSuggestion.basis}
                  </Badge>
                  {receiptSuggestionApplied && (
                    <Badge variant="outline" className="shrink-0 gap-1">
                      <BadgeCheck className="size-3" />
                      sudah dipakai
                    </Badge>
                  )}
                </div>
                <p
                  data-testid="struk-saran-alasan"
                  className="mt-1 text-xs text-muted-foreground"
                >
                  {receiptSuggestion.reason}
                </p>
                <p className="mt-2 text-xs font-medium">
                  {receiptSettingSentence(receiptSuggestion.setting)}
                </p>
              </div>
              <Button
                type="button"
                variant={receiptSuggestionApplied ? "outline" : "default"}
                size="sm"
                className="shrink-0 gap-2"
                data-testid="struk-pakai-saran"
                disabled={receiptSuggestionApplied}
                onClick={() =>
                  patchReceipt({
                    printerId: receiptSuggestion.setting.printerId,
                    paperWidthMm: receiptSuggestion.setting.paperWidthMm,
                    copies: receiptSuggestion.setting.copies,
                  })
                }
              >
                <Sparkles className="size-4" />
                {receiptSuggestionApplied ? "Sudah sesuai" : "Pakai saran ini"}
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Tekan <strong className="text-foreground">Simpan setelan struk</strong> supaya
              pilihan ini sampai ke kasir. Kalimat catatan kaki tidak ikut diubah, dan lebar
              kertasnya menyesuaikan sendiri begitu jenis printernya berganti.
            </p>
          </div>

          {/*
            Jalur cetaknya disebut pemilik toko yang memilih mesinnya, karena di
            situlah syaratnya kelihatan: cetak langsung hanya mungkin di peramban
            dengan WebUSB/Web Bluetooth (Chrome/Edge, halaman HTTPS), sedangkan
            printer jaringan memang belum bisa dijangkau halaman web tanpa program
            perantara. Kedua jalur memakai setelan printer & kertas di kartu ini,
            jadi jawabannya sama dari sisi mana pun struknya keluar.
          */}
          <p
            data-testid="struk-jalur-cetak"
            className="rounded-lg border border-border/60 bg-secondary/30 px-4 py-3 text-xs text-muted-foreground"
          >
            Struknya dicetak <strong className="text-foreground">langsung ke printer</strong>{" "}
            dari dialog struk di kasir (perintah ESC/POS lewat USB atau Bluetooth), jadi
            ukuran kertasnya tidak perlu dipilih lagi di dialog cetak sistem. Syaratnya
            Chrome/Edge (desktop untuk USB &amp; Bluetooth, Android untuk Bluetooth) dan
            halaman yang dibuka lewat HTTPS; di Windows printer USB perlu driver WinUSB.
            Printer jaringan (LAN) dan peramban tanpa WebUSB/Web Bluetooth tetap memakai{" "}
            <strong className="text-foreground">dialog cetak peramban</strong> — keduanya
            memakai setelan di kartu ini.
          </p>

          {/*
            1. Jenis printer. Tiap pilihan menjelaskan cara kerjanya sendiri — termasuk
            kekurangannya — karena justru kelebihan & kekurangan itulah yang menentukan
            pilihan pemilik toko (cepat vs bisa rangkap, senyap vs tahan panas).
          */}
          <div className="space-y-3" data-testid="struk-jenis-printer">
            <div className="min-w-0">
              <span className="text-sm font-medium">Jenis printer struk</span>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pilih mesin yang benar-benar ada di kasir. Jenisnya menentukan lebar kertas yang
                bisa dipakai dan apakah struknya bisa dicetak rangkap.
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              {RECEIPT_PRINTERS.map((printer) => {
                const chosen = receiptPreviewSetting.printerId === printer.id;
                return (
                  <button
                    key={printer.id}
                    type="button"
                    data-testid={`struk-printer-${printer.id}`}
                    aria-pressed={chosen}
                    onClick={() =>
                      patchReceipt(receiptSettingWithPrinter(receiptCandidate, printer.id))
                    }
                    className={cn(
                      "rounded-lg border p-4 text-left transition-colors",
                      chosen
                        ? "border-primary/50 bg-primary/5"
                        : "border-border hover:bg-secondary/40",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{printer.label}</span>
                      {chosen && <BadgeCheck className="size-4 text-primary" />}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {printer.title}
                    </span>
                    <span className="mt-3 block space-y-1.5 text-xs text-muted-foreground">
                      <span className="block">
                        <span className="font-medium text-foreground">Cara kerja: </span>
                        {printer.how}
                      </span>
                      <span className="block">
                        <span className="font-medium text-foreground">Kelebihan: </span>
                        {printer.pros.join(" · ")}
                      </span>
                      <span className="block">
                        <span className="font-medium text-foreground">Kekurangan: </span>
                        {printer.cons.join(" · ")}
                      </span>
                      <span className="block">
                        <span className="font-medium text-foreground">Cocok untuk: </span>
                        {printer.fits}
                      </span>
                      <span className="block">
                        <span className="font-medium text-foreground">Contoh produk: </span>
                        {printer.examples}
                      </span>
                      <span className="block">
                        <span className="font-medium text-foreground">Sambungan: </span>
                        {printer.connection}
                      </span>
                      <span className="block">
                        <span className="font-medium text-foreground">Kertas: </span>
                        {printer.papers.map((paper) => paper.label).join(" / ")}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Lebar kertas — pilihannya mengikuti printernya, bukan daftar bebas. */}
          <div className="space-y-2" data-testid="struk-kertas">
            <span className="text-sm font-medium">Lebar kertas</span>
            <div className="flex flex-wrap gap-1.5">
              {receiptPreviewPrinter.papers.map((paper) => (
                <Button
                  key={paper.widthMm}
                  type="button"
                  size="sm"
                  data-testid={`struk-kertas-${paper.widthMm}`}
                  variant={
                    receiptPreviewSetting.paperWidthMm === paper.widthMm
                      ? "secondary"
                      : "outline"
                  }
                  onClick={() =>
                    patchReceipt(receiptSettingWithPaper(receiptCandidate, paper.widthMm))
                  }
                >
                  {paper.label} · {paper.cols} kolom
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {receiptWidthHint(receiptPreviewSetting)}
            </p>
            {/*
              Lebar kertas mengikuti printer yang dipilih — ini bagian yang bekerja
              sendiri, tanpa perlu ditekan: mengganti jenis printer memindahkan
              pilihannya ke kertas terdekat yang didukung mesin barunya.
            */}
            <p data-testid="struk-kertas-otomatis" className="text-xs text-muted-foreground">
              Saat jenis printernya diganti, pilihan lebarnya pindah sendiri ke kertas
              terdekat yang didukung mesin barunya — 76 mm menjadi 80 mm di printer
              thermal, bukan turun ke 58 mm — dan jumlah rangkapnya dipangkas ke
              kemampuan printer itu.
            </p>
          </div>

          {/* 3. Rangkap: hanya printer impact yang bisa tembusan karbon. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Jumlah rangkap (tembusan)</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {receiptCopiesHint(receiptPreviewSetting)}
              </p>
            </div>
            {/* Label rangkap menyempit di layar tersempit: dengan `w-40` tetap,
                baris ini melewati lebar 320 px dan tombol “+” terpotong di tepi. */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Kurangi rangkap struk"
                disabled={receiptCandidate.copies <= 1}
                onClick={() =>
                  patchReceipt(
                    receiptSettingWithCopies(receiptCandidate, receiptCandidate.copies - 1),
                  )
                }
              >
                <Minus />
              </Button>
              <span
                data-testid="struk-rangkap"
                className="w-32 text-center text-sm font-medium sm:w-40"
              >
                {receiptCopiesLabel(receiptCandidate)}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Tambah rangkap struk"
                disabled={receiptCandidate.copies >= receiptPreviewPrinter.maxCopies}
                onClick={() =>
                  patchReceipt(
                    receiptSettingWithCopies(receiptCandidate, receiptCandidate.copies + 1),
                  )
                }
              >
                <Plus />
              </Button>
            </div>
          </div>

          {/* 4. Catatan kaki: satu tempat untuk kalimat penutup toko. */}
          <div className="space-y-2 sm:max-w-xl">
            <Label htmlFor="struk-footer">Catatan kaki struk</Label>
            <Input
              id="struk-footer"
              data-testid="struk-footer"
              autoComplete="off"
              value={receiptCandidate.footerText}
              onChange={(event) => patchReceipt({ footerText: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Kalimat penutup di bawah total — mis. ucapan terima kasih atau nomor WhatsApp
              toko. Paling banyak {RECEIPT_FOOTER_MAX_LINES} baris (pisahkan dengan Enter) dan{" "}
              {RECEIPT_FOOTER_LINE_MAX} karakter per baris. Dikosongkan berarti tanpa catatan
              kaki.
            </p>
          </div>

          {/* 5. Pratinjau: bentuk struk yang benar-benar akan tercetak. */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">Pratinjau struk</span>
              <span className="text-xs text-muted-foreground">
                {receiptPaperLabel(receiptPreviewSetting)}
                {receiptPreviewDocument.copies > 1
                  ? ` · ${receiptPreviewDocument.copies} lembar sekaligus`
                  : ""}
              </span>
            </div>
            <div
              data-testid="struk-pratinjau"
              className="flex flex-wrap items-start gap-4 rounded-lg border border-dashed border-border/70 bg-secondary/20 p-4"
            >
              {receiptPreviewDocument.sheets.map((sheet) => (
                /*
                  Lebar lembar mengikuti kertas sungguhan (58/80/241 mm) supaya
                  pratinjaunya jujur. Di HP, kertas 80 mm (≈ 302 px) lebih lebar dari
                  layar, jadi wadahnya yang diberi `max-w-full overflow-x-auto`:
                  lembarnya tidak dipepetkan (kolom & barisnya tetap persis seperti
                  yang tercetak), dan pemakainya cukup menggeser pratinjaunya.
                */
                <div
                  key={sheet.copyIndex}
                  className="max-w-full space-y-1 overflow-x-auto"
                  style={{ width: `${receiptPreviewWidthMm}mm` }}
                >
                  {sheet.copyLabel !== "" && (
                    <span className="block text-xs text-muted-foreground">
                      Lembar {sheet.copyIndex + 1} — {sheet.copyLabel}
                    </span>
                  )}
                  {/*
                    Logo digambar sekecil & seputih-hitam apa yang akan keluar di
                    kertas: kotaknya tetap 110 px × 110 px (`RECEIPT_LOGO_SIZE_PX`),
                    bukan selebar kertas, dan warnanya disaring `RECEIPT_LOGO_FILTER`.
                    Pratinjaunya jadi jujur — apa yang dilihat di sini itulah yang
                    keluar dari printer kasir.
                  */}
                  {receiptPreviewDocument.logoUrl && (
                    <img
                      src={receiptPreviewDocument.logoUrl}
                      alt="Logo toko di struk"
                      data-testid={
                        sheet.copyIndex === 0
                          ? "struk-preview-logo"
                          : `struk-preview-logo-${sheet.copyIndex + 1}`
                      }
                      style={{
                        width: `${receiptPreviewDocument.logoSizePx}px`,
                        height: `${receiptPreviewDocument.logoSizePx}px`,
                        filter: receiptPreviewDocument.logoFilter,
                      }}
                      className="mx-auto block object-contain"
                    />
                  )}
                  <pre
                    data-testid={
                      sheet.copyIndex === 0 ? "struk-preview" : `struk-preview-${sheet.copyIndex + 1}`
                    }
                    style={{ width: `${receiptPreviewWidthMm}mm` }}
                    className="overflow-hidden rounded border border-border/60 bg-card px-3 py-2 font-mono text-[10px] leading-[1.35] text-foreground"
                  >
                    {sheet.lines.join("\n")}
                  </pre>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Contoh di atas memakai setelan PPN, PBJT, dan biaya layanan yang sedang berlaku —{" "}
              jadi baris pajaknya ikut berubah kalau setelan itu diubah, persis seperti di kasir.
            </p>
            <p className="text-xs text-muted-foreground">
              Baris <span className="font-mono">Member</span> memuat nama member yang dipilih kasir saat
              bayar. Kalau tidak ada member yang dipilih, struknya mencetak{" "}
              <span className="font-medium text-foreground">“{RECEIPT_WALK_IN_NAME}”</span> — pembeli umum
              tetap punya nama di kertasnya.
            </p>
          </div>

          {!receiptDecision.ok && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {receiptDecision.reason}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              className="gap-2"
              disabled={receiptBusy || !receiptDirty || !receiptDecision.ok}
              onClick={() => void saveReceipt()}
            >
              <Save className="size-4" />
              {receiptBusy ? "Menyimpan…" : "Simpan setelan struk"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="gap-2"
              disabled={receiptBusy || !receiptDirty}
              onClick={resetReceipt}
            >
              <RefreshCw className="size-4" />
              Batalkan perubahan
            </Button>
            {receiptDirty && receiptDecision.ok && (
              <p className="text-xs text-muted-foreground">
                Belum disimpan: {receiptSettingSentence(receiptDecision.value)}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      )}

      <Card id="pengingat-shift" data-testid="setelan-pengingat-shift">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlarmClock className="size-4 text-primary" />
                Pengingat tutup shift
              </CardTitle>
              <CardDescription className="mt-1">
                Kapan kasir diingatkan menutup shift di halaman kasir
                (<code className="font-mono text-xs">/app/pos</code>) dan di halaman Shift & Kas.
                Pengingatnya muncul saat jam yang dipilih di sini terlewat, saat shift sudah
                berjalan lebih lama dari ambangnya, atau saat shift kemarin belum ditutup.
              </CardDescription>
            </div>
            <Badge
              data-testid="shift-lencana"
              variant={shiftDirty ? "secondary" : "default"}
              className="shrink-0 gap-1"
            >
              <AlarmClock className="size-3" />
              {shift.active
                ? `${shiftHourLabel(shift.reminderHour)} · ${shift.longShiftHours} jam`
                : "Mati"}
              {shift.notifyOwner ? ` · operasional ${shiftOperatingLabel(shift)}` : " · pemilik tidak dikabari"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {shiftActiveDraft
                  ? "Kasir diingatkan kalau kasnya belum ditutup"
                  : "Pengingat dimatikan"}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {shiftActiveDraft
                  ? "Pengingatnya tampil di dalam aplikasi — bukan notifikasi ke ponsel, dan shift tetap ditutup manusia."
                  : "Cocok untuk toko yang buka 24 jam: kas tetap bisa ditutup kapan saja, tanpa pengingat."}
              </p>
            </div>
            <Button
              type="button"
              role="switch"
              aria-checked={shiftActiveDraft}
              aria-label="Pengingat tutup shift"
              data-testid="shift-saklar"
              variant={shiftActiveDraft ? "default" : "outline"}
              className="shrink-0 gap-2"
              onClick={() => {
                setShiftActiveDraft((current) => !current);
                patchShift();
              }}
            >
              <Power className="size-4" />
              {shiftActiveDraft ? "Aktif" : "Mati"}
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="shift-jam">Mulai diingatkan pukul</Label>
              <Input
                id="shift-jam"
                data-testid="shift-jam"
                inputMode="numeric"
                value={shiftHourText}
                onChange={(event) => {
                  setShiftHourText(event.target.value.replace(/[^\d]/g, ""));
                  patchShift();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Jam 0–23 menurut waktu perangkat kasir yang membuka halaman. Bawaan 21:00 —
                perkiraan jam toko/kafe tutup.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="shift-ambang">Peringatan keras setelah (jam)</Label>
              <Input
                id="shift-ambang"
                data-testid="shift-ambang"
                inputMode="numeric"
                value={shiftHoursText}
                onChange={(event) => {
                  setShiftHoursText(event.target.value.replace(/[^\d]/g, ""));
                  patchShift();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Angka 1–24. Bawaan 14 jam: shift yang sudah berjalan selama itu pasti melewati
                satu pergantian jam kerja.
              </p>
            </div>
          </div>

          {/*
            Jam operasional & pemberitahuan ke pemilik toko. Pengingat kasir di atas
            hanya berguna kalau ada orang di depan kasnya; dua keadaan ini justru
            perlu sampai ke pemiliknya — kas yang belum dibuka padahal toko sudah
            buka, dan shift yang belum ditutup padahal toko sudah tutup.
          */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="shift-buka">Jam buka toko</Label>
              <Input
                id="shift-buka"
                data-testid="shift-buka"
                inputMode="numeric"
                value={shiftOpenText}
                onChange={(event) => {
                  setShiftOpenText(event.target.value.replace(/[^\d]/g, ""));
                  patchShift();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Jam 0–23. Setengah jam setelah jam ini, pemilik toko dikabari kalau kasnya belum
                dibuka.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="shift-tutup">Jam tutup toko</Label>
              <Input
                id="shift-tutup"
                data-testid="shift-tutup"
                inputMode="numeric"
                value={shiftCloseText}
                onChange={(event) => {
                  setShiftCloseText(event.target.value.replace(/[^\d]/g, ""));
                  patchShift();
                }}
              />
              <p className="text-xs text-muted-foreground">
                Jam 0–23 juga. Lebih kecil dari jam buka berarti toko buka lintas malam (mis.
                20 → 2), dan dua jam yang sama berarti buka 24 jam.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {shiftNotifyDraft
                  ? "Pemilik toko dikabari kalau kas belum dibuka atau shift belum ditutup"
                  : "Pemberitahuan ke pemilik toko dimatikan"}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {shiftNotifyDraft
                  ? "Kabarnya dikirim lewat email ke alamat pemilik workspace ini (dan ikut masuk ke endpoint webhook yang melanggan shift.alert), lalu tercatat di halaman Shift & Kas."
                  : "Pengingat untuk kasir tetap berjalan; yang mati hanya kabar ke pemilik toko."}
              </p>
            </div>
            <Button
              type="button"
              role="switch"
              aria-checked={shiftNotifyDraft}
              aria-label="Pemberitahuan ke pemilik toko"
              data-testid="shift-pemberitahuan-saklar"
              variant={shiftNotifyDraft ? "default" : "outline"}
              className="shrink-0 gap-2"
              onClick={() => {
                setShiftNotifyDraft((current) => !current);
                patchShift();
              }}
            >
              <BellRing className="size-4" />
              {shiftNotifyDraft ? "Aktif" : "Mati"}
            </Button>
          </div>

          {shiftDecision.ok && (
            <p
              data-testid="shift-petunjuk-pemilik"
              className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3 text-xs text-muted-foreground"
            >
              {shiftOwnerAlertHint(shiftDecision.value)}
            </p>
          )}

          {shiftDecision.ok ? (
            <p
              data-testid="shift-petunjuk"
              className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3 text-xs text-muted-foreground"
            >
              {shiftSettingHint(shiftDecision.value)}
            </p>
          ) : (
            <p
              role="alert"
              data-testid="shift-petunjuk"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {shiftDecision.reason}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              className="gap-2"
              data-testid="shift-simpan"
              disabled={shiftBusy || !shiftDirty || !shiftDecision.ok}
              onClick={() => void saveShift()}
            >
              <Save className="size-4" />
              {shiftBusy ? "Menyimpan…" : "Simpan setelan pengingat"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="gap-2"
              data-testid="shift-ulangi"
              disabled={shiftBusy || !shiftDirty}
              onClick={resetShift}
            >
              <RefreshCw className="size-4" />
              Batalkan perubahan
            </Button>
            {shiftDirty && shiftDecision.ok && (
              <p className="text-xs text-muted-foreground">
                Belum disimpan: {shiftSettingSentence(shiftDecision.value)}
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Berlaku untuk seluruh kasir di workspace ini; yang memutuskan jamnya tetap manusia.
            Kasir yang ingin melihat rekap & menutup shiftnya membuka{" "}
            <Link to="/app/shift" className="text-primary hover:underline">
              halaman Shift & Kas
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base">Bunyi bip kasir</CardTitle>
              <CardDescription className="mt-1">
                Tanda terdengar tiap kali produk diklik masuk keranjang di halaman kasir
                (<code className="font-mono text-xs">/app/pos</code>). Setelannya berlaku untuk
                perangkat ini saja.
              </CardDescription>
            </div>
            <Badge variant={beep.enabled ? "default" : "secondary"} className="shrink-0 gap-1">
              {beep.enabled ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
              {beep.enabled ? "Aktif" : "Mati"}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {beep.enabled
                  ? "Bip berbunyi saat produk diklik"
                  : "Bip dimatikan — kasir bekerja senyap"}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {beep.enabled
                  ? `Nadanya pendek dan tenang (${SCAN_BEEP.frequencyHz} Hz, ${SCAN_BEEP.durationMs} ms) — tanda “tercatat”, bukan alarm.`
                  : "Transaksi tetap tercatat seperti biasa; yang hilang hanya tanda bunyinya."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                role="switch"
                aria-checked={beep.enabled}
                aria-label="Aktifkan bunyi bip kasir"
                variant={beep.enabled ? "outline" : "default"}
                className="gap-2"
                onClick={() => {
                  const next = !beep.enabled;
                  beep.setEnabled(next);
                  // Menyalakan langsung diperdengarkan: orang yang menyalakannya
                  // harus bisa menilai bunyinya di perangkat ini.
                  if (next) beep.preview();
                }}
              >
                {beep.enabled ? (
                  <VolumeX className="size-4" />
                ) : (
                  <Volume2 className="size-4" />
                )}
                {beep.enabled ? "Matikan bunyi" : "Nyalakan bunyi"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="gap-2"
                onClick={() => beep.preview()}
              >
                <Volume2 className="size-4" />
                Coba bunyikan
              </Button>
            </div>
          </div>

          {/*
            Volume: bip yang sama bisa terlalu pelan di ruang ramai dan terlalu
            keras di ruang sepi, dan yang tahu bedanya cuma orang yang berdiri di
            til itu. Karena itu angkanya bisa dinaikkan/diturunkan per 10 %, dan
            tiap tekan **langsung diperdengarkan** — menyetel kerasnya bunyi tanpa
            mendengarnya hanya menebak.
          */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Volume2 className="size-4 text-muted-foreground" />
                Volume bip
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {scanBeepVolumeHint(beep.volume)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Kecilkan volume bip"
                title={
                  beep.volume <= SCAN_BEEP_VOLUME_MIN
                    ? "Volume bip sudah paling pelan"
                    : "Satu tingkat lebih pelan"
                }
                disabled={beep.volume <= SCAN_BEEP_VOLUME_MIN}
                onClick={() => {
                  beep.decreaseVolume();
                  // Langsung diperdengarkan dengan volume barunya.
                  beep.preview();
                }}
              >
                <Minus />
              </Button>
              <span
                data-testid="beep-volume-value"
                className="w-14 text-center text-sm font-medium tabular-nums"
              >
                {scanBeepVolumeLabel(beep.volume)}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Besarkan volume bip"
                title={
                  beep.volume >= SCAN_BEEP_VOLUME_MAX
                    ? "Volume bip sudah paling keras"
                    : "Satu tingkat lebih keras"
                }
                disabled={beep.volume >= SCAN_BEEP_VOLUME_MAX}
                onClick={() => {
                  beep.increaseVolume();
                  beep.preview();
                }}
              >
                <Plus />
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Pilihannya disimpan di <strong className="text-foreground">perangkat ini</strong> — tidak
            dikirim ke server, jadi tiap til bisa diatur berbeda: kasir yang ruangnya ramai bisa
            menyalakannya & menaikkan volumenya, kasir shift malam bisa mematikannya. Tombol yang sama{" "}
            <strong className="text-foreground">beserta kontrol volumenya</strong> juga ada di header
            halaman kasir, dan <strong className="text-foreground">Coba bunyikan</strong> tetap
            berbunyi walau bipnya sedang mati.
          </p>
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="size-4 text-primary" />
              Apa yang ikut berubah
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Setelan ini dipakai <strong className="text-foreground">satu kali</strong> untuk
              seluruh dokumen workspace:
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong className="text-foreground">Struk penjualan</strong> di kasir — tarif
                efektif sekarang {formatTaxRatePct(nextEffective)}.
              </li>
              <li>
                <strong className="text-foreground">Tagihan langganan</strong> workspace ini:
                PPN-nya mengikuti setelan yang sama, jadi tidak ada dua angka berbeda dari satu
                setelan.
              </li>
              <li>
                Penjualan dan tagihan yang <strong className="text-foreground">sudah tercatat</strong>{" "}
                tidak berubah: nominal dan tarifnya tetap seperti di struknya.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mematikan ≠ tarif 0%</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              “PPN tidak aktif” berarti tidak ada baris pajak di struk, sedangkan tarif 0% tetap
              menampilkan pajaknya. Karena itu setelan aktif dengan tarif 0% ditolak — supaya
              pembaca struk tidak menebak mana yang sedang berlaku.
            </p>
            <p>
              Pindah paket atau mengubah modul tidak menyentuh setelan ini; yang mengubahnya hanya
              pemilik, manajer, atau keuangan, dan setiap perubahan meninggalkan jejak audit.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link
                to="/app/pos"
                className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary"
              >
                Lihat di kasir
              </Link>
              <Link
                to="/app/panduan"
                className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary"
              >
                Panduan PPN
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

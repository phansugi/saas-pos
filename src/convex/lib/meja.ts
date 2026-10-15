/**
 * Pesanan QR meja (modul F&B) — aturan murni.
 *
 * Tamu yang duduk di meja memindai kode QR yang ditempel di meja, memilih menu
 * dari katalog **toko yang sama** dengan katalog kasir, lalu membayar lewat
 * kanal tagih digital. Yang dijaga di sini — satu tempat, dipakai backend,
 * halaman tamu, kedua store, dan harness:
 *
 * 1. **Tautan meja memuat rahasia, bukan id.** Kode QR di meja bisa difoto siapa
 *    pun, jadi isinya bukan `tableId` (yang bisa dipakai untuk menebak meja lain)
 *    melainkan token acak (`mj_…`) yang hanya bisa dicetak dari dalam workspace,
 *    dan bisa diganti (di-*rotate*) kalau kartunya hilang.
 * 2. **Menu tamu = katalog jual toko itu.** Nama, harga, dan ketersediaannya
 *    datang dari baris produk yang sama dengan kasir — harga tidak pernah
 *    dititipkan dari ponsel tamu.
 * 3. **Pesanan tamu tunduk pada aturan yang sudah ada**: satu meja satu pesanan
 *    terbuka (`seatTable`), pajak & biaya layanan workspace (`orderTotal`), dan
 *    tagihan digital sebagai satu-satunya catatan uang (`digitalPayment`).
 * 4. **Total tamu = total server.** `guestOrderTotal` memakai rumus yang sama
 *    dengan `orderTotal`; harness membandingkan keduanya untuk beberapa setelan
 *    pajak, jadi angka di ponsel tamu tidak bisa berbeda dari yang ditagih.
 */

import {
  FEATURE_LABELS,
  PLANS,
  VERTICAL_LABELS,
  featureOwner,
  isFeatureEnabled,
} from "./billing";
import type {
  EntitlementSnapshot,
  FeatureKey,
  Vertical,
} from "./billing";
import {
  normalizePct,
  orderTaxPlan,
  type FnbTaxProfile,
  type OrderTotalLine,
} from "./fnbTax";
import type { TaxSetting } from "./tax";
import {
  DIGITAL_METHOD_LABELS,
  DIGITAL_REFERENCE_MAX,
  VA_BANKS,
  isDigitalMethod,
  isVaBank,
  vaBankLabel,
  type DigitalMethod,
  type DigitalStatus,
  type VaBank,
} from "./digitalPayment";

// ------------------------------------------------------------------ tautan QR

/** Jalan halaman menu tamu; token menempel di belakangnya. */
export const MEJA_MENU_PATH = "/meja";

/** Awalan token meja, supaya token workspace lain tidak bisa tertukar tempat. */
export const MEJA_TOKEN_PREFIX = "mj_";

/** Awalan token pemantau satu pesanan tamu (rahasia kedua, per pesanan). */
export const MEJA_WATCH_PREFIX = "mjo_";

/** Jumlah karakter acak di belakang awalan (hex huruf kecil). */
export const MEJA_TOKEN_LENGTH = 32;

function tokenFrom(prefix: string, randomId: string): string {
  const cleaned = (randomId ?? "")
    .toLowerCase()
    .replace(/[^0-9a-z]/g, "")
    .padEnd(MEJA_TOKEN_LENGTH, "0")
    .slice(0, MEJA_TOKEN_LENGTH);
  return `${prefix}${cleaned}`;
}

/**
 * Token meja dari nilai acak apa pun (biasanya `crypto.randomUUID()`), dirapikan
 * jadi bentuk kanonik `mj_<32 hex>`. Fungsi murni supaya panjang & bentuknya
 * bisa diuji tanpa backend, dan supaya demo memakai bentuk yang sama.
 */
export function mejaMenuToken(randomId: string): string {
  return tokenFrom(MEJA_TOKEN_PREFIX, randomId);
}

/** Token pemantau pesanan tamu; dipakai ponsel tamu untuk menanyakan status. */
export function mejaWatchToken(randomId: string): string {
  return tokenFrom(MEJA_WATCH_PREFIX, randomId);
}

export function isMejaMenuToken(value: string): boolean {
  return new RegExp(`^${MEJA_TOKEN_PREFIX}[0-9a-f]{${MEJA_TOKEN_LENGTH}}$`).test(value ?? "");
}

export function isMejaWatchToken(value: string): boolean {
  return new RegExp(`^${MEJA_WATCH_PREFIX}[0-9a-f]{${MEJA_TOKEN_LENGTH}}$`).test(value ?? "");
}

/** Path halaman tamu untuk sebuah token. */
export function mejaMenuPath(token: string): string {
  return `${MEJA_MENU_PATH}/${token}`;
}

/**
 * Tautan absolut yang dikodekan ke dalam kode QR meja. `origin` datang dari
 * peramban yang mencetak kartunya (`window.location.origin`), karena alamat
 * aplikasi berbeda-beda per deployment dan tidak boleh ditulis di dalam kode.
 */
export function mejaMenuUrl(origin: string, token: string): string {
  const base = (origin ?? "").replace(/\/+$/, "");
  return `${base}${mejaMenuPath(token)}`;
}

// ------------------------------------------------------------------- batasan

/** Batas isi satu pesanan tamu; angka kecil supaya pesanan jahil tidak lolos. */
export const GUEST_MAX_LINES = 20;
export const GUEST_MAX_QTY_PER_ITEM = 10;
export const GUEST_MAX_UNITS = 40;
export const GUEST_NAME_MAX = 24;

/** Panjang nama tamu yang sudah dirapikan. */
export function normalizeGuestName(raw: string | undefined | null): string {
  return (raw ?? "").trim().replace(/\s+/g, " ").slice(0, GUEST_NAME_MAX);
}

export type MejaResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

// ----------------------------------------------------------------- validasi

/** Produk apa adanya dari baris katalog toko (harga dari server, bukan tamu). */
export interface GuestProduct {
  id: string;
  name: string;
  price: number;
  active: boolean;
  trackStock: boolean;
  /** Stok di lokasi jual toko; 0 kalau tidak dilacak. */
  stock: number;
}

export interface GuestCartInput {
  productId: string;
  quantity: number;
}

export interface GuestOrderLine {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

/**
 * Baris pesanan tamu setelah dicocokkan dengan katalog: harga dari produk,
 * jumlah dibatasi, dan **harga jual dihitung server**. Produk nonaktif atau
 * habis ditolak dengan nama produknya, bukan diam-diam dibuang.
 */
export function validateGuestCart(
  items: readonly GuestCartInput[],
  products: readonly GuestProduct[],
): MejaResult<{ lines: GuestOrderLine[]; subtotal: number }> {
  if (items.length === 0) {
    return { ok: false, reason: "Belum ada menu yang dipilih." };
  }
  if (items.length > GUEST_MAX_LINES) {
    return {
      ok: false,
      reason: `Satu pesanan tamu maksimal ${GUEST_MAX_LINES} baris menu; pesan sisanya di pesanan berikutnya.`,
    };
  }

  const byId = new Map(products.map((product) => [product.id, product]));
  const lines: GuestOrderLine[] = [];
  let units = 0;

  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) {
      return { ok: false, reason: "Ada menu yang tidak dikenal di pesanan ini; muat ulang halaman lalu coba lagi." };
    }
    if (!product.active) {
      return { ok: false, reason: `Menu ${product.name} sedang tidak dijual.` };
    }
    if (product.trackStock && product.stock <= 0) {
      return { ok: false, reason: `Menu ${product.name} sedang habis.` };
    }

    const quantity = Math.trunc(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, reason: `Jumlah ${product.name} harus lebih dari 0.` };
    }
    if (quantity > GUEST_MAX_QTY_PER_ITEM) {
      return {
        ok: false,
        reason: `${product.name} maksimal ${GUEST_MAX_QTY_PER_ITEM} porsi per pesanan; hubungi pelayan untuk jumlah lebih banyak.`,
      };
    }
    if (product.trackStock && quantity > product.stock) {
      return {
        ok: false,
        reason: `Stok ${product.name} tinggal ${product.stock}; kurangi jumlahnya.`,
      };
    }

    units += quantity;
    if (units > GUEST_MAX_UNITS) {
      return {
        ok: false,
        reason: `Satu pesanan tamu maksimal ${GUEST_MAX_UNITS} item; hubungi pelayan untuk pesanan besar.`,
      };
    }

    lines.push({
      productId: product.id,
      name: product.name,
      unitPrice: product.price,
      quantity,
      lineTotal: product.price * quantity,
    });
  }

  return {
    ok: true,
    value: {
      lines,
      subtotal: lines.reduce((sum, line) => sum + line.lineTotal, 0),
    },
  };
}

// ---------------------------------------------------------------------- uang

/**
 * Setelan pajak & biaya layanan yang **perlu diketahui ponsel tamu** untuk
 * menghitung pratinjau totalnya — bukan seluruh profil pajak workspace.
 * Nilainya diturunkan `guestTaxRulesFrom` dari setelan yang sebenarnya, jadi
 * tarif yang dilihat tamu selalu tarif yang sedang berlaku.
 */
export interface GuestTaxRules {
  /** Biaya layanan dalam persen; 0 = tidak dipungut. */
  serviceChargePct: number;
  /** Biaya layanan ikut dasar pengenaan pajak (Perda berbeda-beda). */
  serviceChargeInTaxBase: boolean;
  /** Tarif pajak yang menggantikan/menambah PPN; 0 = tanpa pajak. */
  taxRatePct: number;
  /** Nama pajaknya, mis. `PPN 11%` atau `PBJT 10%`; kosong = tanpa pajak. */
  taxLabel: string;
}

export function guestTaxRulesFrom(ppn: TaxSetting, fnb: FnbTaxProfile): GuestTaxRules {
  const plan = orderTaxPlan(ppn, fnb);
  const serviceChargePct = fnb.serviceChargeActive ? fnb.serviceChargePct : 0;
  return {
    serviceChargePct,
    serviceChargeInTaxBase: fnb.serviceChargeInTaxBase,
    taxRatePct: plan.ratePct,
    taxLabel: plan.ratePct > 0 ? plan.label : "",
  };
}

/**
 * Pratinjau total satu pesanan tamu. **Rumusnya sama** dengan `orderTotal`
 * (biaya layanan lebih dulu, lalu pajak dari dasar yang dipilih pemilik toko),
 * tetapi hanya memakai `GuestTaxRules` — jadi ponsel tamu tidak perlu tahu
 * bentuk badan usaha atau ambang omzet workspace. Harness membandingkan
 * hasilnya dengan `orderTotal` untuk beberapa setelan, supaya tidak ada dua
 * rumus yang bisa berbeda diam-diam.
 */
export function guestOrderTotal(
  net: number,
  rules: GuestTaxRules,
): { net: number; serviceCharge: number; tax: number; total: number; lines: OrderTotalLine[] } {
  const cleanNet = Math.max(0, Math.round(net));
  // Pembulatan & batas persennya dari `normalizePct` yang sama dengan
  // `orderTotal`, bukan salinan rumus.
  const serviceChargePct = normalizePct(rules.serviceChargePct);
  const serviceCharge = Math.round(cleanNet * (serviceChargePct / 100));
  const taxBase =
    cleanNet + (serviceChargePct > 0 && rules.serviceChargeInTaxBase ? serviceCharge : 0);
  const tax = Math.round(taxBase * (Math.max(0, rules.taxRatePct) / 100));

  const lines: OrderTotalLine[] = [{ kind: "net", label: "Nilai jual", amount: cleanNet, ratePct: 0 }];
  if (serviceCharge > 0) {
    lines.push({
      kind: "service",
      label: `Biaya layanan ${formatPctPlain(serviceChargePct)}`,
      amount: serviceCharge,
      ratePct: serviceChargePct,
    });
  }
  if (tax > 0) {
    lines.push({
      kind: "tax",
      label: rules.taxLabel || "Pajak",
      amount: tax,
      ratePct: rules.taxRatePct,
    });
  }

  return {
    net: cleanNet,
    serviceCharge,
    tax,
    total: cleanNet + serviceCharge + tax,
    lines,
  };
}

/** Angka persen versi Indonesia (`11` → `11%`, `7,5` → `7,5%`). */
export function formatPctPlain(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${String(rounded).replace(".", ",")}%`;
}

/**
 * Keterangan tagihan tamu untuk halaman Pembayaran:
 * `Meja A2 · 3 item · 2× Kopi Susu, 1× Roti Bakar`, dipotong pada batas kolom
 * keterangan tagihan (nama terakhir yang terpotong, bukan angkanya).
 */
export function guestChargeReference(
  tableName: string,
  lines: readonly { name: string; quantity: number }[],
): string {
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  const head = `Meja ${tableName} · ${units} item`;
  if (lines.length === 0) return head.slice(0, DIGITAL_REFERENCE_MAX);
  const detail = lines.map((line) => `${line.quantity}× ${line.name}`).join(", ");
  return `${head} · ${detail}`.slice(0, DIGITAL_REFERENCE_MAX);
}

// --------------------------------------------------------------- cara bayar
//
// Halaman tamu menawarkan **dua cara bayar** dari kanal tagih digital yang sama:
// QRIS (dipindai — atau disimpan sebagai gambar lalu dibuka dari galeri) dan
// **Virtual Account** (transfer bank). Tiga hal yang dijaga di sini:
//
// 1. **Bawaannya QRIS.** Pesanan tanpa pilihan cara bayar tetap sah, jadi tautan
//    lama & store yang belum ikut memperbarui tidak pecah.
// 2. **Virtual Account wajib menyebut bank penerbitnya**, karena nomor VA-nya
//    turunan dari bank itu (`virtualAccountNumber`); QRIS justru **tidak boleh**
//    memakai bank.
// 3. **Kalimatnya bisa dibaca tamu.** Nomor tagihan, nominal, dan cara bayarnya
//    disebut apa adanya — galat Convex mentah tidak berguna di ponsel pembeli.

/** Pilihan cara bayar yang ditawarkan ke tamu, urut dari yang paling cepat. */
export const GUEST_PAY_METHODS: DigitalMethod[] = ["qris", "va"];

/** Cara bayar bawaan kalau tamu tidak memilih apa pun. */
export const GUEST_DEFAULT_PAY_METHOD: DigitalMethod = "qris";

/** Bank penerbit Virtual Account yang boleh dipilih tamu. */
export const GUEST_PAY_BANKS: VaBank[] = ["bca", "bni", "bri", "mandiri"];

/** Label tombol simpan gambar QRIS; satu kalimat untuk halaman & harness. */
export const GUEST_QRIS_SCREENSHOT_LABEL = "Screenshot QRIS";

export interface GuestPayOption {
  method: DigitalMethod;
  label: string;
  /** Satu kalimat yang menjelaskan apa yang harus dilakukan tamu. */
  hint: string;
}

/** Dua pilihan cara bayar beserta kalimat penjelasnya, untuk ponsel tamu. */
export function guestPayOptions(): GuestPayOption[] {
  return GUEST_PAY_METHODS.map((method) => ({
    method,
    label: DIGITAL_METHOD_LABELS[method],
    hint:
      method === "qris"
        ? "Pindai kodenya, atau simpan gambarnya lalu buka dari aplikasi bank/e-wallet."
        : "Transfer tepat sejumlah tagihan ke nomor Virtual Account bank pilihan Anda.",
  }));
}

export interface GuestBankOption {
  bank: VaBank;
  label: string;
  /** Empat digit awal nomor Virtual Account bank ini. */
  prefix: string;
}

/** Bank Virtual Account yang bisa dipilih tamu, dari daftar bank yang sama dengan
 *  halaman Pembayaran (satu sumber, `VA_BANKS`). */
export function guestBankOptions(): GuestBankOption[] {
  return GUEST_PAY_BANKS.map((bank) => ({
    bank,
    label: vaBankLabel(bank),
    prefix: VA_BANKS[bank].prefix,
  }));
}

/**
 * Cara bayar tamu yang sudah divalidasi. Bentuknya sengaja sama dengan separuh
 * `DigitalChargeDraft` (metode + bank) supaya halaman tamu bisa memakainya untuk
 * pratinjau, dan `meja.order` meneruskannya ke `validateChargeInput` — aturan
 * tagihan yang sama dengan kasir, bukan salinan kedua.
 */
export function guestPaymentMethod(input: {
  method?: string | null;
  bank?: string | null;
}): MejaResult<{ method: DigitalMethod; bank: VaBank | null }> {
  const method = (input.method ?? "").trim() || GUEST_DEFAULT_PAY_METHOD;
  if (!isDigitalMethod(method)) {
    return {
      ok: false,
      reason:
        "Cara bayar yang dipilih belum dikenal di halaman ini; pilih QRIS atau Virtual Account.",
    };
  }

  const bank = (input.bank ?? "").trim();
  if (method === "va") {
    if (!isVaBank(bank)) {
      return {
        ok: false,
        reason:
          "Pilih bank penerbit Virtual Account dulu (BCA, BNI, BRI, atau Mandiri).",
      };
    }
    return { ok: true, value: { method, bank } };
  }

  if (bank.length > 0) {
    return {
      ok: false,
      reason:
        "QRIS tidak memakai bank penerbit — pilih bank hanya untuk Virtual Account.",
    };
  }
  return { ok: true, value: { method: "qris", bank: null } };
}

/**
 * Kalimat cara bayar untuk ponsel tamu. QRIS menyebut jalur screenshot-nya —
 * ponsel yang **menampilkan** kode tidak bisa memindainya sendiri, jadi yang
 * bekerja adalah menyimpan gambarnya lalu memilih bayar dari galeri di aplikasi
 * bank/e-wallet. Nominalnya selalu angka tagihan server.
 */
export function guestPaymentInstruction(input: {
  method: DigitalMethod;
  bank: VaBank | null;
  amount: number;
  vaNumber?: string | null;
  qrPayload?: string | null;
}): string {
  const nominal = `${Math.trunc(input.amount).toLocaleString("id-ID")} rupiah`;
  if (input.method === "qris") {
    return (
      `Pindai kode QRIS ini untuk membayar ${nominal} — atau tekan “${GUEST_QRIS_SCREENSHOT_LABEL}”, ` +
      "lalu pilih bayar dari galeri di aplikasi bank/e-wallet Anda."
    );
  }
  const bank = input.bank ? vaBankLabel(input.bank) : "bank";
  const nomor = (input.vaNumber ?? "").trim();
  return (
    `Transfer tepat ${nominal} ke Virtual Account ${bank}${nomor ? ` ${nomor}` : ""} ` +
    "dari aplikasi bank Anda, lalu tunggu status di halaman ini berubah."
  );
}

/**
 * Nama berkas gambar QRIS untuk screenshot: `qris-DIG-2026-0007.png`. Sisi
 * depannya nomor tagihannya, jadi gambar yang tersimpan di galeri masih bisa
 * dicocokkan dengan tagihan yang sedang ditampilkan kasir.
 */
export function guestQrisFileName(chargeNumber: string): string {
  const clean = (chargeNumber ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-z]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `qris-${clean || "tagihan"}.png`;
}

// -------------------------------------------------------------------- status

/** Status satu pesanan tamu di sisi toko. */
export type MejaOrderStatus = "pending" | "paid" | "cancelled";

export const MEJA_ORDER_STATUS_LABELS: Record<MejaOrderStatus, string> = {
  pending: "Menunggu pembayaran",
  paid: "Lunas — pesanan dikirim ke dapur",
  cancelled: "Dibatalkan",
};

/**
 * Boleh tidaknya **tamu sendiri** membatalkan pesanannya dari ponselnya.
 *
 * Pembeli bisa berubah pikiran sebelum uangnya masuk, dan menahan pembatalannya
 * sampai kasir sempat menekan tombol hanya membuat meja tertahan. Karena itu
 * pembatalan tamu punya aturan sempit yang bisa dibaca siapa pun:
 *
 *  - **hanya selama tagihannya belum lunas** — uang yang sudah masuk tidak
 *    dibalik oleh tombol di ponsel pembeli;
 *  - **tagihan yang kedaluwarsa tetap boleh dibereskan** — pembatalannya cuma
 *    merapikan niat pesanannya, bukan mengubah uang;
 *  - **tagihan yang sudah dibatalkan kasir** juga dibereskan, supaya baris
 *    pesanannya tidak menggantung sebagai “menunggu”.
 */
export function guestCancelCheck(input: {
  status: MejaOrderStatus;
  chargeStatus: DigitalStatus;
  saleNumber?: string | null;
}): MejaResult<null> {
  if (input.status === "paid" || input.chargeStatus === "paid") {
    const nota = input.saleNumber ? ` (${input.saleNumber})` : "";
    return {
      ok: false,
      reason: `Pesanan ini sudah dibayar${nota} — uangnya sudah masuk, jadi tanyakan pelayan kalau memang ingin dibatalkan.`,
    };
  }
  if (input.status === "cancelled") {
    return { ok: false, reason: "Pesanan ini sudah dibatalkan." };
  }
  return { ok: true, value: null };
}

/**
 * Apakah sebuah pesanan QR **masih menunggu pelunasan** — dan karena itu bisa
 * dilunasi/dibatalkan?
 *
 * Dua syarat, karena niat pesanannya dan tagihannya bisa berpisah jalan:
 *
 *  - niatnya masih `pending`, dan
 *  - tagihannya **masih bisa dibayar** (`chargeStatus: "pending"`).
 *
 * Tagihan yang sudah dibatalkan kasir dari halaman Pembayaran atau kedaluwarsa
 * tidak lagi menunggu apa pun: melaporkannya sebagai "menunggu pelunasan" akan
 * menyuruh kasir membayar tagihan yang sudah mati, dan menahannya di pagar hapus
 * meja akan mengunci denah karena tagihan yang tidak akan pernah dibayar.
 */
export function isAwaitingPayment(input: {
  status: MejaOrderStatus;
  chargeStatus: DigitalStatus | null;
}): boolean {
  return input.status === "pending" && input.chargeStatus === "pending";
}

// ---------------------------------------------------------------- gerbang

/**
 * Kenapa menu QR meja tidak hidup: modul F&B belum aktif, paket tidak memuat
 * salah satu fiturnya, atau kanal tagih digitalnya mati. Kalimatnya memakai
 * kalimat kanonik `requireFeature` (`FEATURE_LABELS`/`VERTICAL_LABELS`) supaya
 * tamu, kasir, dan pesan server menceritakan hal yang sama.
 */
export const MEJA_REQUIRED_FEATURES: FeatureKey[] = ["pos.table", "pos.kds", "payment.digital"];

export function mejaFeatureReason(
  feature: FeatureKey,
  entitlements: EntitlementSnapshot,
  verticals: readonly Vertical[],
): string | null {
  if (isFeatureEnabled(entitlements, verticals as Vertical[], feature)) return null;

  const label = FEATURE_LABELS[feature];
  const owner = featureOwner(feature);
  if (owner && !(verticals as Vertical[]).includes(owner)) {
    return `Fitur ${label} memerlukan modul ${VERTICAL_LABELS[owner]} yang belum aktif.`;
  }
  const planName = PLANS[entitlements.planKey]?.name ?? entitlements.planKey;
  return owner
    ? `Fitur ${label} tidak termasuk paket ${planName}.`
    : `Fitur ${label} tidak termasuk paket ${planName}.`;
}

/** Alasan pertama yang membuat menu tamu tidak bisa dipakai, atau `null`. */
export function mejaUnavailableReason(
  entitlements: EntitlementSnapshot,
  verticals: readonly Vertical[],
): string | null {
  for (const feature of MEJA_REQUIRED_FEATURES) {
    const reason = mejaFeatureReason(feature, entitlements, verticals);
    if (reason) return reason;
  }
  return null;
}

/**
 * Pembayaran digital (`payment.digital`, Phase 6) — aturan murni, termasuk jalur
 * kasir yang menagih QRIS langsung dari keranjang (`POS_CHARGE_METHOD`).
 *
 * Modul ini dipakai bersama oleh backend (`src/convex/payments.ts`), halaman
 * Pembayaran, kedua store, dan harness, jadi semua keputusan ada di sini (Convex
 * hanya membundel modul di bawah `src/convex`).
 *
 * Lima prinsipnya:
 *
 * 1. **Tagihan digital adalah utang pelanggan kepada toko, bukan penjualan.**
 *    Kasir membuat satu tagihan bernomor (`DIG-…`) untuk sebuah nominal, lalu
 *    pelanggan memindai QRIS atau mentransfer ke nomor Virtual Account. Uang
 *    baru dianggap masuk saat tagihan itu **dilunasi** — bukan saat dibuat.
 * 2. **Kedaluwarsa dihitung saat dibaca, bukan oleh pekerja terjadwal.** QRIS
 *    berumur pendek (5 menit) dan VA sehari; tagihan yang lewat tenggat tidak
 *    boleh menggantung sebagai "menunggu" hanya karena belum ada yang
 *    menyapunya. `statusOf` menurunkannya dari `expiresAt` — satu-satunya
 *    kebenaran soal umur tagihan.
 * 3. **Janji umurnya dipatok saat tagihan dibuat.** `expiresAt` disimpan di
 *    barisnya, bukan dihitung ulang dari metode hari ini: mengubah kebijakan
 *    kedaluwarsa tidak boleh mematikan tagihan yang sudah ditunjukkan ke
 *    pelanggan.
 * 4. **Pelunasan harus pas.** Nominal pelunasan yang tidak sama dengan tagihan
 *    ditolak dengan menyebut angkanya — kelebihan/kekurangan pembayaran bukan
 *    hal yang boleh dipangkas diam-diam.
 * 5. **Membuat tagihan butuh fitur `payment.digital`; melunasi & membatalkannya
 *    selalu boleh.** Kalau paket turun di tengah hari, uang pelanggan yang sudah
 *    di jalan tetap harus bisa dicatat masuk.
 * 6. **Kasir menagih langsung dari keranjang.** Tombol QRIS di kasir menerbitkan
 *    tagihan bernominal **total keranjang**, dan penjualannya baru dicatat
 *    setelah tagihan itu lunas (`checkSaleAgainstCharge`) — tagihan pelanggan dan
 *    penjualan toko tidak boleh berbeda nominal, apalagi berbeda nasib.
 */

import { FEATURE_LABELS, type PlanKey } from "./billing/catalog";
import { PLANS } from "./billing/catalog";

// -------------------------------------------------------------------- metode

export type DigitalMethod = "qris" | "va";

export const DIGITAL_METHOD_LABELS: Record<DigitalMethod, string> = {
  qris: "QRIS (pindai kode)",
  va: "Virtual Account (transfer bank)",
};

export const DIGITAL_METHOD_KEYS = Object.keys(
  DIGITAL_METHOD_LABELS,
) as DigitalMethod[];

export function isDigitalMethod(value: string): value is DigitalMethod {
  return (DIGITAL_METHOD_KEYS as string[]).includes(value);
}

// -------------------------------------------------------------- bank VA

export type VaBank = "bca" | "bni" | "bri" | "mandiri";

export interface VaBankProfile {
  label: string;
  /** Awalan nomor Virtual Account bank ini. */
  prefix: string;
}

export const VA_BANKS: Record<VaBank, VaBankProfile> = {
  bca: { label: "BCA", prefix: "8808" },
  bni: { label: "BNI", prefix: "8810" },
  bri: { label: "BRI", prefix: "8888" },
  mandiri: { label: "Mandiri", prefix: "8907" },
};

export const VA_BANK_KEYS = Object.keys(VA_BANKS) as VaBank[];

export function isVaBank(value: string): value is VaBank {
  return (VA_BANK_KEYS as string[]).includes(value);
}

export function vaBankLabel(bank: VaBank): string {
  return VA_BANKS[bank]?.label ?? bank;
}

// ------------------------------------------------------------------- status

export type DigitalStatus = "pending" | "paid" | "expired" | "cancelled";

export const DIGITAL_STATUS_LABELS: Record<DigitalStatus, string> = {
  pending: "Menunggu pembayaran",
  paid: "Lunas",
  expired: "Kedaluwarsa",
  cancelled: "Dibatalkan",
};

export type DigitalAction = "settle" | "cancel";

export const DIGITAL_ACTIONS: DigitalAction[] = ["settle", "cancel"];

export const DIGITAL_ACTION_LABELS: Record<DigitalAction, string> = {
  settle: "Tandai lunas",
  cancel: "Batalkan tagihan",
};

// ------------------------------------------------------------------ umur

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;

/** QRIS berumur pendek; VA diberi waktu sehari agar transfer bank sempat. */
export const QRIS_EXPIRY_MINUTES = 5;
export const VA_EXPIRY_MINUTES = 24 * 60;

/** Jendela "segera kedaluwarsa" untuk kartu di halaman. */
export const EXPIRING_SOON_SECONDS = 60;

export function expiryMinutesFor(method: DigitalMethod): number {
  return method === "qris" ? QRIS_EXPIRY_MINUTES : VA_EXPIRY_MINUTES;
}

export function expiryAtFor(method: DigitalMethod, createdAt: number): number {
  return createdAt + expiryMinutesFor(method) * MINUTE_MS;
}

// ----------------------------------------------------------------- nominal

export const DIGITAL_MIN_AMOUNT = 1_000;
export const DIGITAL_MAX_AMOUNT = 50_000_000;

export function isDigitalAmountValid(amount: number): boolean {
  return (
    Number.isFinite(amount) &&
    Number.isInteger(amount) &&
    amount >= DIGITAL_MIN_AMOUNT &&
    amount <= DIGITAL_MAX_AMOUNT
  );
}

// ------------------------------------------------------------------ teks

export const DIGITAL_REFERENCE_MAX = 60;
export const DIGITAL_REASON_MAX = 120;

export type DigitalResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

/** Rapikan teks pendek: buang spasi pinggir & rapatkan spasi tengah. */
export function normalizeReference(raw: string): string {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

// ------------------------------------------------------------------ nomor

/** Nomor tagihan: `DIG-2026-0007`, urut per tenant. */
export function chargeNumber(sequence: number, year: number): string {
  return `DIG-${year}-${String(Math.max(1, Math.trunc(sequence))).padStart(4, "0")}`;
}

/**
 * Nomor Virtual Account: awalan bank + 8 digit urut. Deterministik dari urutan,
 * sehingga nomor yang sama tidak pernah menunjuk dua tagihan berbeda.
 */
export function virtualAccountNumber(bank: VaBank, sequence: number): string {
  const profile = VA_BANKS[bank];
  const prefix = profile ? profile.prefix : "0000";
  return `${prefix}${String(Math.max(1, Math.trunc(sequence))).padStart(8, "0")}`;
}

/**
 * Payload QRIS. Bentuknya deterministik dan memuat nominal + nomor tagihan,
 * supaya tagihan yang sama selalu menghasilkan kode yang sama (bisa dicetak
 * ulang) dan dua tagihan berbeda tidak pernah bertukar kode.
 */
export function qrPayload(charge: {
  number: string;
  amount: number;
  merchantName?: string;
}): string {
  const merchant = (charge.merchantName ?? "MESINPOS")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  const amount = String(Math.trunc(charge.amount));
  return (
    `00020101021226${String(merchant.length).padStart(2, "0")}${merchant}` +
    `5303360` +
    `54${String(amount.length).padStart(2, "0")}${amount}` +
    `5802ID` +
    `62${String(charge.number.length).padStart(2, "0")}${charge.number}` +
    `6304`
  );
}

// ---------------------------------------------------------------- validasi

export interface DigitalChargeDraft {
  amount: number;
  method: DigitalMethod;
  /** Wajib untuk `va`; wajib kosong untuk `qris`. */
  bank: VaBank | null;
  reference: string | null;
}

export interface DigitalChargeOptions {
  /** Fitur `payment.digital` hidup untuk paket + modul tenant ini. */
  digital: boolean;
  /** Nama paket, dipakai untuk pesan penolakan yang menyuruh naik paket. */
  planName?: string;
}

export function validateChargeInput(
  input: {
    amount?: number;
    method?: string;
    bank?: string | null;
    reference?: string;
  },
  options: DigitalChargeOptions,
): DigitalResult<DigitalChargeDraft> {
  if (!options.digital) {
    const plan = options.planName ? ` (paket ${options.planName})` : "";
    return {
      ok: false,
      reason: `Fitur ${FEATURE_LABELS["payment.digital"]} tidak termasuk paket ini${plan}; naikkan paket untuk memakainya.`,
    };
  }

  if (typeof input.amount !== "number" || !isDigitalAmountValid(input.amount)) {
    return {
      ok: false,
      reason: `Nominal tagihan harus bilangan bulat antara ${DIGITAL_MIN_AMOUNT.toLocaleString("id-ID")} dan ${DIGITAL_MAX_AMOUNT.toLocaleString("id-ID")} rupiah.`,
    };
  }

  if (!input.method || !isDigitalMethod(input.method)) {
    return { ok: false, reason: "Pilih metode pembayaran yang dikenal (QRIS atau Virtual Account)." };
  }
  const method = input.method;

  let bank: VaBank | null = null;
  if (method === "va") {
    if (!input.bank || !isVaBank(input.bank)) {
      return { ok: false, reason: "Pilih bank penerbit Virtual Account yang dikenal." };
    }
    bank = input.bank;
  } else if (input.bank) {
    // QRIS tidak punya bank penerbit; mengirimkannya berarti klien salah paham.
    return {
      ok: false,
      reason: "QRIS tidak memakai bank penerbit — pilih bank hanya untuk Virtual Account.",
    };
  }

  const reference = normalizeReference(input.reference ?? "");
  if (reference.length > DIGITAL_REFERENCE_MAX) {
    return {
      ok: false,
      reason: `Keterangan maksimal ${DIGITAL_REFERENCE_MAX} karakter.`,
    };
  }

  return {
    ok: true,
    value: {
      amount: input.amount,
      method,
      bank,
      reference: reference.length > 0 ? reference : null,
    },
  };
}

// ------------------------------------------------------------------ status

/** Bagian tagihan yang dibutuhkan aturan transisi (bukan seluruh baris DB). */
export interface DigitalChargeLike {
  number: string;
  method: DigitalMethod;
  amount: number;
  status: DigitalStatus;
  createdAt: number;
  expiresAt: number;
  paidAt: number | null;
  paidAmount: number | null;
  cancelledAt: number | null;
  cancelReason: string | null;
}

/**
 * Bentuk longgar satu baris tabel `digitalCharges` (Convex atau demo) supaya
 * bagian yang dibutuhkan aturan transisi bisa diambil dari mana pun tanpa
 * menyalin sepuluh medan di setiap pemanggil.
 */
export interface DigitalChargeRowLike {
  number: string;
  method: string;
  amount: number;
  status: string;
  createdAt: number;
  expiresAt: number;
  paidAt?: number | null;
  paidAmount?: number | null;
  cancelledAt?: number | null;
  cancelReason?: string | null;
}

/** Ambil bagian tagihan yang dipakai aturan; medan opsional menjadi `null`. */
export function chargeLikeFrom(charge: DigitalChargeRowLike): DigitalChargeLike {
  return {
    number: charge.number,
    method: charge.method as DigitalMethod,
    amount: charge.amount,
    status: charge.status as DigitalStatus,
    createdAt: charge.createdAt,
    expiresAt: charge.expiresAt,
    paidAt: charge.paidAt ?? null,
    paidAmount: charge.paidAmount ?? null,
    cancelledAt: charge.cancelledAt ?? null,
    cancelReason: charge.cancelReason ?? null,
  };
}

/** Rupiah tanpa awalan "Rp", untuk pesan yang menyebut angkanya. */
function rupiah(amount: number): string {
  return `${Math.trunc(amount).toLocaleString("id-ID")} rupiah`;
}

/**
 * Status efektif sebuah tagihan pada waktu `now`.
 *
 * Tagihan yang tersimpan `pending` tapi sudah melewati `expiresAt` **dibaca
 * sebagai** `expired` — inilah yang membuat kedaluwarsa tidak butuh pekerja
 * terjadwal, dan tidak ada tagihan "menunggu" yang menggantung selamanya.
 */
export function statusOf(charge: DigitalChargeLike, now: number): DigitalStatus {
  if (charge.status !== "pending") return charge.status;
  return now >= charge.expiresAt ? "expired" : "pending";
}

export function remainingSeconds(charge: DigitalChargeLike, now: number): number {
  const left = charge.expiresAt - now;
  return left <= 0 ? 0 : Math.ceil(left / 1000);
}

export interface DigitalActionPatch {
  status: DigitalStatus;
  paidAt: number | null;
  paidAmount: number | null;
  cancelledAt: number | null;
  cancelReason: string | null;
}

/**
 * Hasil satu aksi atas tagihan. Transisinya sempit dengan sengaja:
 *
 *   - `settle`: hanya tagihan yang masih `pending` dan **belum lewat tenggat**;
 *     nominalnya harus sama persis dengan tagihan.
 *   - `cancel`: hanya tagihan yang masih `pending`.
 *
 * Tidak ada jalan dari `paid`, `expired`, atau `cancelled` ke status lain:
 * uang yang sudah masuk atau batal tidak diubah oleh satu tombol di halaman.
 */
export function applyChargeAction(
  charge: DigitalChargeLike,
  action: DigitalAction,
  args: { now: number; amount?: number; reason?: string },
): DigitalResult<DigitalActionPatch> {
  const current = statusOf(charge, args.now);

  const cancelReason = normalizeReference(args.reason ?? "");

  if (action === "cancel") {
    if (current === "paid") {
      return {
        ok: false,
        reason: `Tagihan ${charge.number} sudah lunas; pembatalan tidak bisa membalik uang yang sudah masuk.`,
      };
    }
    if (current === "cancelled") {
      return { ok: false, reason: `Tagihan ${charge.number} sudah dibatalkan.` };
    }
    if (current === "expired") {
      return { ok: false, reason: `Tagihan ${charge.number} sudah kedaluwarsa; tidak perlu dibatalkan.` };
    }
    if (cancelReason.length > DIGITAL_REASON_MAX) {
      return {
        ok: false,
        reason: `Alasan pembatalan maksimal ${DIGITAL_REASON_MAX} karakter.`,
      };
    }
    return {
      ok: true,
      value: {
        status: "cancelled",
        paidAt: null,
        paidAmount: null,
        cancelledAt: args.now,
        cancelReason: cancelReason.length > 0 ? cancelReason : null,
      },
    };
  }

  // settle
  if (current === "paid") {
    return { ok: false, reason: `Tagihan ${charge.number} sudah lunas.` };
  }
  if (current === "cancelled") {
    return { ok: false, reason: `Tagihan ${charge.number} sudah dibatalkan; buat tagihan baru untuk pelanggan.` };
  }
  if (current === "expired") {
    return {
      ok: false,
      reason: `Tagihan ${charge.number} sudah kedaluwarsa pada ${new Date(charge.expiresAt).toLocaleString("id-ID")}; buat tagihan baru.`,
    };
  }

  const amount = args.amount === undefined ? charge.amount : args.amount;
  if (!Number.isFinite(amount) || amount !== charge.amount) {
    return {
      ok: false,
      reason: `Pelunasan harus sama dengan nominal tagihan (${charge.amount.toLocaleString("id-ID")} rupiah), bukan ${Number.isFinite(amount) ? amount.toLocaleString("id-ID") : String(amount)}.`,
    };
  }

  return {
    ok: true,
    value: {
      status: "paid",
      paidAt: args.now,
      paidAmount: amount,
      cancelledAt: null,
      cancelReason: null,
    },
  };
}

// ------------------------------------------------- tagih dari keranjang (POS)
//
// Kanal tagih digital juga hidup **di meja kasir**: dari keranjang, kasir
// menekan QRIS, tagihan terbit bernominal total keranjang, pelanggan memindai,
// dan penjualan baru dicatat **setelah** tagihan itu lunas. Dua pagar khas kasir
// tinggal di sini supaya halaman kasir, kedua store, dan backend menilainya
// sama:
//
//  1. **Nominal tagihan = total keranjang.** Kasir tidak mengetik nominalnya,
//     jadi tidak ada tagihan yang berbeda dari yang ditunjukkan ke pelanggan.
//  2. **Pelunasan dan penjualan harus atas tagihan yang sama.** Keranjang yang
//     berubah setelah tagihan terbit tidak boleh dilunasi dengan tagihan lama —
//     itu mencatat penjualan yang nominalnya berbeda dari uang yang masuk.

/** Satu metode tagih yang ditawarkan dari keranjang: QRIS yang dipindai. */
export const POS_CHARGE_METHOD: DigitalMethod = "qris";

/** Baris keranjang yang dibutuhkan keterangan tagihan. */
export interface CartLineSummary {
  name: string;
  quantity: number;
}

/**
 * Keterangan tagihan dari isi keranjang: `POS · 2 baris · 3 item · 2× Kopi`.
 * Dipotong pada `DIGITAL_REFERENCE_MAX` — nama produk boleh panjang, kolom
 * keterangan tidak, dan yang terpotong adalah nama terakhir (bukan angkanya).
 */
export function cartChargeReference(lines: readonly CartLineSummary[]): string {
  const items = lines.filter((line) => line.quantity > 0);
  const units = items.reduce((sum, line) => sum + line.quantity, 0);
  const head = `POS · ${items.length} baris · ${units} item`;
  if (items.length === 0) return head;
  const detail = items
    .map((line) => `${line.quantity}× ${line.name}`)
    .join(", ");
  return `${head} · ${detail}`.slice(0, DIGITAL_REFERENCE_MAX);
}

/**
 * Menyiapkan tagihan untuk sebuah keranjang: nominalnya **total keranjang**,
 * metodenya QRIS, dan keterangannya ringkasan isi keranjang. Gerbang fitur serta
 * batas nominalnya tetap dari `validateChargeInput` — satu aturan, bukan dua.
 */
export function validateCartCharge(
  cart: { total: number; lines: readonly CartLineSummary[] },
  options: DigitalChargeOptions,
): DigitalResult<DigitalChargeDraft> {
  return validateChargeInput(
    {
      amount: cart.total,
      method: POS_CHARGE_METHOD,
      bank: null,
      reference: cartChargeReference(cart.lines),
    },
    options,
  );
}

/**
 * Apakah tagihan kasir ini masih cocok dengan keranjang yang sekarang terbuka.
 * Diperiksa **sebelum melunasi**: keranjang yang ditambah atau dikurangi setelah
 * tagihan terbit harus dibuatkan tagihan baru, bukan dicatat sebagai penjualan
 * bernominal lain.
 */
export function checkCartMatchesCharge(
  charge: { number: string; amount: number },
  cartTotal: number,
): DigitalResult<{ number: string; amount: number }> {
  if (charge.amount !== cartTotal) {
    return {
      ok: false,
      reason: `Keranjang sekarang ${rupiah(cartTotal)} sedangkan tagihan ${charge.number} senilai ${rupiah(charge.amount)}; batalkan tagihan ini dan terbitkan yang baru.`,
    };
  }
  return { ok: true, value: { number: charge.number, amount: charge.amount } };
}

/**
 * Metode pembayaran penjualan yang bisa melunasi sebuah metode tagihan. QRIS
 * dipindai, jadi penjualannya juga `qris`; Virtual Account dibayar lewat
 * transfer bank, jadi penjualannya `transfer`.
 */
export function saleMethodMatchesCharge(
  saleMethod: string,
  method: DigitalMethod,
): boolean {
  if (method === "qris") return saleMethod === "qris";
  return saleMethod === "transfer" || saleMethod === "va";
}

/**
 * Gerbang server untuk penjualan kasir yang menunjuk tagihan digital: tagihannya
 * harus **sudah lunas**, metodenya cocok, dan nominalnya sama persis dengan total
 * penjualan yang dihitung server. Dengan ini dua catatan uang — tagihan
 * pelanggan dan penjualan toko — tidak bisa saling berbeda.
 */
export function checkSaleAgainstCharge(
  charge: DigitalChargeLike,
  input: { saleTotal: number; saleMethod: string | null; now: number },
): DigitalResult<{ number: string; amount: number }> {
  const status = statusOf(charge, input.now);
  if (status !== "paid") {
    return {
      ok: false,
      reason: `Tagihan ${charge.number} berstatus "${DIGITAL_STATUS_LABELS[status]}"; penjualan hanya boleh menunjuk tagihan yang sudah lunas.`,
    };
  }
  if (
    input.saleMethod &&
    !saleMethodMatchesCharge(input.saleMethod, charge.method)
  ) {
    return {
      ok: false,
      reason: `Pembayaran penjualan (${input.saleMethod}) tidak sama dengan metode tagihan ${charge.number} (${charge.method}).`,
    };
  }
  if (charge.amount !== input.saleTotal) {
    return {
      ok: false,
      reason: `Total penjualan ${rupiah(input.saleTotal)} tidak sama dengan tagihan ${charge.number} (${rupiah(charge.amount)}).`,
    };
  }
  return { ok: true, value: { number: charge.number, amount: charge.amount } };
}

// ---------------------------------------------------------------- ringkasan

export interface DigitalSummary {
  pending: number;
  paid: number;
  expired: number;
  cancelled: number;
  /** Total nominal tagihan yang masih menunggu dibayar. */
  pendingAmount: number;
  /** Total nominal yang benar-benar sudah masuk. */
  paidAmount: number;
  /** Tagihan menunggu yang tinggal ≤ `EXPIRING_SOON_SECONDS` detik. */
  expiringSoon: number;
  /** Tenggat terdekat dari tagihan yang masih menunggu. */
  nextExpiryAt: number | null;
}

export function summariseCharges(
  charges: readonly (DigitalChargeLike & { paidAmount?: number | null })[],
  now: number,
): DigitalSummary {
  let pending = 0;
  let paid = 0;
  let expired = 0;
  let cancelled = 0;
  let pendingAmount = 0;
  let paidAmount = 0;
  let expiringSoon = 0;
  let nextExpiryAt: number | null = null;

  for (const charge of charges) {
    const status = statusOf(charge, now);
    if (status === "pending") {
      pending += 1;
      pendingAmount += charge.amount;
      if (remainingSeconds(charge, now) <= EXPIRING_SOON_SECONDS) expiringSoon += 1;
      if (nextExpiryAt === null || charge.expiresAt < nextExpiryAt) {
        nextExpiryAt = charge.expiresAt;
      }
    } else if (status === "paid") {
      paid += 1;
      paidAmount += charge.paidAmount ?? charge.amount;
    } else if (status === "expired") {
      expired += 1;
    } else {
      cancelled += 1;
    }
  }

  return {
    pending,
    paid,
    expired,
    cancelled,
    pendingAmount,
    paidAmount,
    expiringSoon,
    nextExpiryAt,
  };
}

/**
 * Kalimat pendek yang menjelaskan **di mana** pelanggan membayar tagihan ini:
 * QRIS memakai kode terpindai, VA memakai nomor transfer bank.
 */
export function paymentInstruction(charge: {
  method: DigitalMethod;
  bank: VaBank | null;
  amount: number;
  qrPayload?: string;
  vaNumber?: string;
}): string {
  if (charge.method === "qris") {
    return `Pindai kode QRIS untuk membayar ${charge.amount.toLocaleString("id-ID")} rupiah.`;
  }
  const bank = charge.bank ? vaBankLabel(charge.bank) : "bank";
  return `Transfer tepat ${charge.amount.toLocaleString("id-ID")} rupiah ke Virtual Account ${bank} ${charge.vaNumber ?? ""}`.trim();
}

/** Nama paket untuk pesan penolakan; paket tak dikenal jatuh ke label planKey. */
export function planNameOf(planKey: PlanKey): string {
  return PLANS[planKey]?.name ?? planKey;
}

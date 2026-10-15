/**
 * Hutang usaha / AP (`purchasing.basic`, Phase 3) — pasangan dari piutang B2B.
 *
 * Pembelian belum selesai di penerimaan barang: kalau supplier memberi **tempo**,
 * barang yang datang hari ini baru dibayar nanti, dan selisih waktu itulah yang
 * harus dilacak. Yang dijaga di sini:
 *
 * 1. **Hutang lahir dari bukti, bukan dari ingatan.** Barang yang diterima lewat
 *    GRN otomatis menghasilkan satu hutang dengan jatuh tempo = tanggal terima +
 *    tempo supplier, jadi tidak ada tagihan supplier yang perlu diingat-ingat.
 * 2. **Tempo 0 berarti bayar langsung.** Supplier tanpa tempo tidak menghasilkan
 *    hutang sama sekali — sama seperti pelanggan tanpa limit kredit yang tidak
 *    boleh punya piutang.
 * 3. **Membayar hutang selalu boleh**, bahkan saat paket turun atau fiturnya mati.
 *    Yang butuh fitur adalah *mencatat tagihan baru*; hutang lama tidak boleh
 *    menjadi tak terbayar karena paketnya berubah.
 * 4. **Supplier yang menunggak tidak dilayani PO baru.** Hutang yang lewat jatuh
 *    tempo punya konsekuensi nyata: PO ke supplier itu ditolak sampai dibayar
 *    (atau supplier dinonaktifkan sendiri oleh pemiliknya).
 * 5. Semua nominal **integer rupiah**, dan aturan ini murni (tanpa dependensi
 *    Convex). Kosakata umur tagihan (bucket, jatuh tempo, rupiah) dipinjam dari
 *    `lib/ar.ts` supaya laporan piutang dan hutang tidak pernah berbeda arti.
 */

import {
  agingOf,
  dueDateFrom,
  rupiah,
  type Aging,
  type AgingBucket,
  type ReceivableLike,
} from "./ar";

export const MAX_BILL_REFERENCE = 40;
export const MAX_PAYABLE_NOTE = 120;
/** Batas atas yang masuk akal untuk satu tagihan supplier (Rp 10 miliar). */
export const MAX_BILL_AMOUNT = 10_000_000_000;
/** Tagihan yang jatuh temponya tinggal ≤ 7 hari dianggap "segera jatuh tempo". */
export const DUE_SOON_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Jatuh tempo manual tidak masuk akal kalau lebih dari 3 tahun ke depan. */
const MAX_DUE_AHEAD_DAYS = 3 * 365;
const MIN_DUE_TIMESTAMP = Date.UTC(2000, 0, 1);

/**
 * Status hutang. Sengaja sama persis dengan piutang (`receivables`) supaya
 * `agingOf` dari `lib/ar.ts` bisa dipakai apa adanya.
 */
export type PayableStatus = "open" | "paid" | "void";

/** Bentuk minimal dokumen hutang yang dibutuhkan aturan murni. */
export interface PayableLike {
  amount: number;
  paidAmount: number;
  dueDate: number;
  status: PayableStatus;
}

export interface Result<T> {
  ok: boolean;
  value?: T;
  reason?: string;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Sisa hutang yang belum dibayar; 0 untuk hutang yang sudah lunas/dibatalkan. */
export function payableBalance(payable: PayableLike): number {
  if (payable.status !== "open") return 0;
  return Math.max(0, payable.amount - payable.paidAmount);
}

/** Umur satu hutang — memakai aturan yang sama dengan piutang. */
export function payableAging(payable: PayableLike, now: number = Date.now()): Aging {
  return agingOf(payable as ReceivableLike, now);
}

/** True kalau hutang ini terbuka, masih bersisa, dan jatuh temponya ≤ 7 hari. */
export function isDueSoon(payable: PayableLike, now: number = Date.now()): boolean {
  if (payableBalance(payable) <= 0) return false;
  const remaining = payable.dueDate - now;
  return remaining <= DUE_SOON_DAYS * DAY_MS;
}

/**
 * Batas dokumen yang diperiksa **satu putaran** pekerja pengingat jatuh tempo.
 * Dipakai `crons.ts` (argumen pekerja) dan `payables.notifyDuePayables`.
 */
export const DUE_REMINDER_BATCH = 50;

/**
 * Jendela pengingat: pekerja harian hanya memeriksa tagihan yang jatuh temponya
 * **tidak lebih tua dari 60 hari**.
 *
 * Ini bukan batas sewenang-wenang. Tagihan yang sudah dibayar **sebelum** jatuh
 * tempo tidak pernah perlu diberitahukan, jadi penandanya tetap `false` — dan
 * tanpa jendela, baris seperti itu menumpuk di depan indeks `(dueNotified,
 * dueDate)` selamanya sampai seluruh kuota putaran habis dan tagihan yang
 * benar-benar jatuh tempo kelaparan. Batas bawah ini membuat baris lama keluar
 * dari pandangan; tagihan yang baru jatuh tempo selalu di dalamnya karena `now`
 * ikut maju.
 */
export const DUE_REMINDER_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Apakah tagihan supplier ini perlu diberitahukan lewat event `payable.due`
 * **sekarang**.
 *
 * Keadaan ini berubah karena **waktu**, bukan karena transaksi — pekerja harian
 * yang menemukannya, jadi syaratnya harus ketat: masih terbuka, masih bersisa,
 * jatuh temponya sudah tiba, dan **belum pernah** diberitahukan. Penanda
 * `dueNotified` yang membuat tagihan yang sama tidak dikabarkan setiap hari;
 * pemberitahuan berulang tanpa kabar baru hanya membuat penerimanya berhenti
 * membacanya.
 */
export function needsDueReminder(
  payable: PayableLike & { dueNotified?: boolean },
  now: number = Date.now(),
): boolean {
  if (payable.dueNotified) return false;
  if (payableBalance(payable) <= 0) return false;
  return payable.dueDate <= now;
}

export interface PayablePosition {
  /** Total hutang terbuka ke supplier ini. */
  outstanding: number;
  /** Bagian yang sudah lewat jatuh tempo. */
  overdueAmount: number;
  overdueCount: number;
  openCount: number;
  /** Bagian yang jatuh tempo ≤ 7 hari lagi. */
  dueSoonAmount: number;
}

export function payablePosition(
  payables: readonly PayableLike[],
  now: number = Date.now(),
): PayablePosition {
  let outstanding = 0;
  let overdueAmount = 0;
  let overdueCount = 0;
  let openCount = 0;
  let dueSoonAmount = 0;

  for (const payable of payables) {
    const balance = payableBalance(payable);
    if (balance <= 0) continue;
    openCount += 1;
    outstanding += balance;
    if (payableAging(payable, now).overdue) {
      overdueAmount += balance;
      overdueCount += 1;
    } else if (isDueSoon(payable, now)) {
      dueSoonAmount += balance;
    }
  }

  return { outstanding, overdueAmount, overdueCount, openCount, dueSoonAmount };
}

export interface PayableSummary extends PayablePosition {
  /** Total hutang terbuka per umur. */
  byBucket: Record<AgingBucket, number>;
}

export function summarisePayables(
  payables: readonly PayableLike[],
  now: number = Date.now(),
): PayableSummary {
  const byBucket: Record<AgingBucket, number> = {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    ">60": 0,
  };

  for (const payable of payables) {
    const balance = payableBalance(payable);
    if (balance <= 0) continue;
    byBucket[payableAging(payable, now).bucket] += balance;
  }

  return { ...payablePosition(payables, now), byBucket };
}

/**
 * Hutang yang lahir dari satu penerimaan barang. `null` berarti memang **tidak
 * ada** hutang: supplier tanpa tempo dibayar langsung, dan penerimaan bernilai 0
 * (barang contoh/hibah) tidak menagih apa pun.
 */
export interface ReceiptPayableDraft {
  amount: number;
  dueDate: number;
  paymentTermDays: number;
}

export function buildPayableForReceipt(args: {
  supplier: { name: string; paymentTermDays: number };
  total: number;
  receivedAt: number;
}): Result<ReceiptPayableDraft | null> {
  const total = Math.trunc(Number(args.total) || 0);
  if (total <= 0) return { ok: true, value: null };

  const termDays = Math.trunc(Number(args.supplier.paymentTermDays) || 0);
  if (termDays <= 0) {
    // Bayar langsung di muka: tidak ada hutang yang perlu dilacak.
    return { ok: true, value: null };
  }
  if (termDays > 365) {
    return {
      ok: false,
      reason: `Tempo supplier ${args.supplier.name} tidak wajar (${termDays} hari).`,
    };
  }

  return {
    ok: true,
    value: {
      amount: total,
      dueDate: dueDateFrom(args.receivedAt, termDays),
      paymentTermDays: termDays,
    },
  };
}

/** Sumber satu hutang, untuk ditampilkan di halaman Pembelian dan audit. */
export function describePayableSource(payable: {
  orderNumber?: string | null;
  receiptNumber?: string | null;
  reference?: string | null;
}): string {
  if (payable.orderNumber) {
    return payable.receiptNumber
      ? `PO ${payable.orderNumber} · ${payable.receiptNumber}`
      : `PO ${payable.orderNumber}`;
  }
  return payable.reference?.trim() || "Tagihan manual";
}

export interface BillInput {
  reference?: string;
  amount: number;
  dueDate: number;
  note?: string;
}

export interface ResolvedBill {
  reference?: string;
  amount: number;
  dueDate: number;
  note?: string;
}

/**
 * Tagihan supplier di luar PO (saldo awal, tagihan jasa, atau nota yang baru
 * ditagihkan sekarang). Jatuh tempo **boleh di masa lalu** — justru itu gunanya:
 * hutang lama yang baru dicatat tetap punya umur yang benar, bukan jatuh tempo
 * palsu di masa depan.
 */
/**
 * Jatuh tempo tagihan: boleh **sudah lewat** (saldo awal dari sistem lama), tetapi
 * tidak masuk akal kalau lebih dari tiga tahun ke depan. Dipakai tagihan manual
 * maupun dokumen supplier yang dicocokkan (`lib/threeway.ts`), supaya aturannya
 * satu.
 */
export function resolveDueDate(raw: number, now: number = Date.now()): Result<number> {
  const dueDate = Math.trunc(Number(raw) || 0);
  if (!Number.isFinite(dueDate) || dueDate < MIN_DUE_TIMESTAMP) {
    return { ok: false, reason: "Tanggal jatuh tempo tagihan tidak valid." };
  }
  if (dueDate > now + MAX_DUE_AHEAD_DAYS * DAY_MS) {
    return { ok: false, reason: "Tanggal jatuh tempo terlalu jauh di masa depan." };
  }
  return { ok: true, value: dueDate };
}

export function resolveBillInput(
  input: BillInput,
  options: { now?: number; supplierName: string },
): Result<ResolvedBill> {
  const now = options.now ?? Date.now();

  const amount = Math.trunc(Number(input.amount) || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "Nilai tagihan supplier harus lebih dari 0." };
  }
  if (amount > MAX_BILL_AMOUNT) {
    return { ok: false, reason: "Nilai tagihan supplier melebihi batas wajar." };
  }

  const resolvedDue = resolveDueDate(input.dueDate, now);
  if (!resolvedDue.ok || resolvedDue.value === undefined) {
    return { ok: false, reason: resolvedDue.reason };
  }
  const dueDate = resolvedDue.value;

  const reference = input.reference ? collapse(input.reference) : "";
  if (reference.length > MAX_BILL_REFERENCE) {
    return {
      ok: false,
      reason: `Nomor tagihan supplier maksimal ${MAX_BILL_REFERENCE} karakter.`,
    };
  }

  const note = input.note ? collapse(input.note) : "";
  if (note.length > MAX_PAYABLE_NOTE) {
    return { ok: false, reason: `Catatan hutang maksimal ${MAX_PAYABLE_NOTE} karakter.` };
  }

  return {
    ok: true,
    value: {
      reference: reference === "" ? undefined : reference,
      amount,
      dueDate,
      note: note === "" ? undefined : note,
    },
  };
}

/**
 * Mencatat pembayaran hutang (boleh sebagian). Kelebihan bayar **ditolak**, bukan
 * dipangkas diam-diam — sama seperti penerimaan piutang, supaya salah ketik
 * terlihat, bukan tersimpan sebagai hutang negatif.
 */
export function applyPayablePayment(payable: PayableLike, amount: number): PaymentApplication {
  const balance = payableBalance(payable);
  const paid = Math.trunc(Number(amount) || 0);

  if (payable.status === "void") {
    return { ok: false, remaining: 0, accepted: 0, fullyPaid: false, reason: "Hutang ini sudah dibatalkan." };
  }
  if (payable.status === "paid" || balance <= 0) {
    return { ok: false, remaining: 0, accepted: 0, fullyPaid: true, reason: "Hutang ini sudah lunas." };
  }
  if (paid <= 0) {
    return { ok: false, remaining: balance, accepted: 0, fullyPaid: false, reason: "Jumlah pembayaran harus lebih dari 0." };
  }
  if (paid > balance) {
    return {
      ok: false,
      remaining: balance,
      accepted: 0,
      fullyPaid: false,
      reason: `Pembayaran melebihi sisa hutang (${rupiah(balance)}).`,
    };
  }

  const remaining = balance - paid;
  return { ok: true, remaining, accepted: paid, fullyPaid: remaining === 0 };
}

export interface PaymentApplication {
  ok: boolean;
  reason?: string;
  /** Sisa hutang setelah pembayaran (0 berarti lunas). */
  remaining: number;
  /** Jumlah yang benar-benar dibayar. */
  accepted: number;
  fullyPaid: boolean;
}

/**
 * Alasan sebuah supplier **tidak boleh** diberi PO baru, atau `null` kalau aman.
 * Dipakai `purchasing.createOrder` (server) dan halaman Pembelian (peringatan
 * lebih awal) dari aturan yang sama.
 */
export function supplierBlockedReason(
  payables: readonly PayableLike[],
  supplier: { name: string },
  now: number = Date.now(),
): string | null {
  const position = payablePosition(payables, now);
  if (position.overdueAmount <= 0) return null;
  return `Supplier ${supplier.name} punya hutang jatuh tempo ${rupiah(position.overdueAmount)}; bayar dulu sebelum membuat PO baru.`;
}

/**
 * Piutang B2B & credit limit (`ar.creditlimit`) — fitur modul Grosir, Phase 2.
 *
 * Grosir tidak selesai di harga bertingkat: pelanggan toko/langganan membeli
 * dengan **tempo**, jadi penjualan bisa dibayar sebagian dan sisanya menjadi
 * piutang yang harus dilacak sampai lunas. Yang dijaga di sini:
 *
 * 1. **Limit kredit dievaluasi di server** — bukan hanya di kasir. Transaksi
 *    yang melewati sisa limit atau pelanggan yang piutangnya jatuh tempo
 *    ditolak, bukan sekadar diberi peringatan.
 * 2. **Piutang disimpan per penjualan**, bukan satu saldo per pelanggan, supaya
 *    umur piutang (aging) dan pelunasan sebagian bisa dilacak per nota.
 * 3. **Menagih piutang selalu boleh**, bahkan saat modul Grosir dimatikan:
 *    mematikan modul tidak boleh membuat utang pelanggan menjadi tak tertagih.
 *    Yang butuh modul adalah *membuat* piutang baru.
 * 4. Semua nominal **integer rupiah**, dan aturan ini murni (tanpa dependensi
 *    Convex) supaya backend, klien, dan harness memakai perhitungan yang sama —
 *    aturan duit tidak boleh hidup dua kali.
 */

export const DEFAULT_TERM_DAYS = 30;
export const MAX_TERM_DAYS = 120;
export const MIN_CUSTOMER_NAME_LENGTH = 2;
export const MAX_CUSTOMER_NAME_LENGTH = 60;
/** Batas atas yang masuk akal untuk satu pelanggan (Rp 5 miliar). */
export const MAX_CREDIT_LIMIT = 5_000_000_000;
export const MAX_CUSTOMER_CODE_LENGTH = 10;

/** Kode pelanggan dipakai di nota: huruf besar, angka, dan `-` (mis. `TB-MAJU`). */
const CUSTOMER_CODE_PATTERN = /^[A-Z][A-Z0-9-]{1,9}$/;

const DAY_MS = 24 * 60 * 60 * 1000;

export type AgingBucket = "current" | "1-30" | "31-60" | ">60";

/** Urutan kanonik untuk tabel umur piutang (paling ringan ke paling berat). */
export const AGING_BUCKETS: AgingBucket[] = ["current", "1-30", "31-60", ">60"];

export const AGING_LABELS: Record<AgingBucket, string> = {
  current: "Belum jatuh tempo",
  "1-30": "1–30 hari",
  "31-60": "31–60 hari",
  ">60": "lebih dari 60 hari",
};

/** Piutang yang masih menagih. `paid` dan `void` sudah tidak dihitung limit. */
export type ReceivableStatus = "open" | "paid" | "void";

export interface CustomerInput {
  name: string;
  code?: string;
  phone?: string;
  /** 0 berarti tunai saja (tidak boleh tempo). */
  creditLimit?: number;
  paymentTermDays?: number;
  active?: boolean;
}

export interface Customer {
  code: string;
  name: string;
  phone?: string;
  creditLimit: number;
  paymentTermDays: number;
  active: boolean;
}

/** Bagian piutang yang dibutuhkan aturan limit (bentuk minimal, bukan dokumen DB). */
export interface ReceivableLike {
  amount: number;
  paidAmount: number;
  dueDate: number;
  status: ReceivableStatus;
}

export interface ConfigResult<T> {
  ok: boolean;
  value?: T;
  reason?: string;
}

export function normaliseCustomerCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Nomor telepon: digit saja setelah pemisah dirapikan (`+62 812-3456-7890`). */
export function normalisePhone(value: string): string {
  return value.trim().replace(/[\s().-]/g, "");
}

export function suggestCustomerCode(name: string, taken: readonly string[] = []): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("");
  const base = initials
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, MAX_CUSTOMER_CODE_LENGTH);

  let candidate = CUSTOMER_CODE_PATTERN.test(base) ? base : "PLG";
  let attempt = 2;
  while (taken.includes(candidate)) {
    const suffix = `-${attempt}`;
    candidate = `${candidate.slice(0, MAX_CUSTOMER_CODE_LENGTH - suffix.length)}${suffix}`;
    attempt += 1;
  }
  return candidate;
}

/**
 * Menormalkan sekaligus memvalidasi data pelanggan. Dipakai jalur tulis server
 * dan harness; klien boleh memanggilnya untuk memberi tahu kesalahan lebih awal,
 * tetapi server tetap memvalidasi ulang.
 */
export function resolveCustomerInput(
  input: CustomerInput,
  takenCodes: readonly string[] = [],
): ConfigResult<Customer> {
  const name = (input.name ?? "").replace(/\s+/g, " ").trim();
  if (name.length < MIN_CUSTOMER_NAME_LENGTH || name.length > MAX_CUSTOMER_NAME_LENGTH) {
    return {
      ok: false,
      reason: `Nama pelanggan wajib diisi, ${MIN_CUSTOMER_NAME_LENGTH}–${MAX_CUSTOMER_NAME_LENGTH} karakter.`,
    };
  }

  const code = normaliseCustomerCode(input.code ?? "") || suggestCustomerCode(name, takenCodes);
  if (!CUSTOMER_CODE_PATTERN.test(code) || code.length > MAX_CUSTOMER_CODE_LENGTH) {
    return {
      ok: false,
      reason: `Kode pelanggan "${input.code ?? ""}" tidak valid (2–${MAX_CUSTOMER_CODE_LENGTH} karakter huruf/angka/-, diawali huruf).`,
    };
  }

  let phone: string | undefined;
  if (input.phone !== undefined && input.phone.trim() !== "") {
    phone = normalisePhone(input.phone);
    if (!/^\+?\d{8,15}$/.test(phone)) {
      return { ok: false, reason: "Nomor telepon pelanggan tidak valid (8–15 digit)." };
    }
  }

  const creditLimit = Math.trunc(Number(input.creditLimit ?? 0));
  if (!Number.isFinite(creditLimit) || creditLimit < 0) {
    return { ok: false, reason: "Limit kredit tidak boleh negatif." };
  }
  if (creditLimit > MAX_CREDIT_LIMIT) {
    return { ok: false, reason: "Limit kredit melebihi batas wajar." };
  }

  const paymentTermDays = Math.trunc(Number(input.paymentTermDays ?? DEFAULT_TERM_DAYS));
  if (!Number.isFinite(paymentTermDays) || paymentTermDays < 0 || paymentTermDays > MAX_TERM_DAYS) {
    return {
      ok: false,
      reason: `Tempo pembayaran harus 0–${MAX_TERM_DAYS} hari.`,
    };
  }

  // Limit tanpa tempo berarti pelanggan boleh berutang tetapi harus lunas saat
  // transaksi — itu bertentangan, jadi tempo 0 dirapikan ke tempo default.
  if (creditLimit > 0 && paymentTermDays === 0) {
    return {
      ok: false,
      reason: `Pelanggan dengan limit kredit harus punya tempo pembayaran (minimal 1 hari, maksimal ${MAX_TERM_DAYS}).`,
    };
  }

  return {
    ok: true,
    value: {
      code,
      name,
      phone,
      creditLimit,
      paymentTermDays,
      active: input.active ?? true,
    },
  };
}

/** Sisa piutang satu nota: `amount` yang belum dibayar. */
export function receivableBalance(receivable: ReceivableLike): number {
  if (receivable.status !== "open") return 0;
  return Math.max(0, receivable.amount - receivable.paidAmount);
}

export function dueDateFrom(startedAt: number, termDays: number): number {
  return startedAt + Math.max(0, Math.trunc(termDays)) * DAY_MS;
}

export interface Aging {
  /** Hari melewati jatuh tempo; 0 atau negatif berarti belum jatuh tempo. */
  daysPastDue: number;
  bucket: AgingBucket;
  /** True hanya kalau nota masih terbuka, masih bersisa, dan sudah lewat tempo. */
  overdue: boolean;
}

export function agingOf(receivable: ReceivableLike, now: number = Date.now()): Aging {
  // **Hari penuh** sejak jatuh tempo, bukan pembulatan ke atas: nota yang jatuh
  // tempo 30 hari 20 jam lalu masih "1–30 hari", bukan "31–60 hari". Pembulatan
  // ke atas membuat umur piutang melompat satu hari hanya karena beberapa
  // milidetik sudah berlalu.
  const daysPastDue = Math.floor((now - receivable.dueDate) / DAY_MS);
  const bucket: AgingBucket =
    daysPastDue <= 0 ? "current" : daysPastDue <= 30 ? "1-30" : daysPastDue <= 60 ? "31-60" : ">60";
  return {
    daysPastDue,
    bucket,
    overdue: receivable.status === "open" && receivableBalance(receivable) > 0 && daysPastDue > 0,
  };
}

export interface CreditPosition {
  /** Total piutang terbuka (belum dibayar) pelanggan ini. */
  outstanding: number;
  /** Bagian yang sudah lewat jatuh tempo. */
  overdueAmount: number;
  overdueCount: number;
  openCount: number;
  /** Limit dikurangi piutang terbuka; bisa 0 kalau limit habis. */
  availableCredit: number;
  /** True kalau limitnya habis atau piutangnya ada yang jatuh tempo. */
  blocked: boolean;
}

export function creditPosition(
  customer: { creditLimit: number },
  receivables: readonly ReceivableLike[],
  now: number = Date.now(),
): CreditPosition {
  let outstanding = 0;
  let overdueAmount = 0;
  let overdueCount = 0;
  let openCount = 0;

  for (const receivable of receivables) {
    const balance = receivableBalance(receivable);
    if (balance <= 0) continue;
    openCount += 1;
    outstanding += balance;
    if (agingOf(receivable, now).overdue) {
      overdueAmount += balance;
      overdueCount += 1;
    }
  }

  const availableCredit = Math.max(0, customer.creditLimit - outstanding);
  return {
    outstanding,
    overdueAmount,
    overdueCount,
    openCount,
    availableCredit,
    blocked: customer.creditLimit <= 0 || overdueAmount > 0,
  };
}

/** Format rupiah ringkas yang dipakai pesan galat — sama di server dan klien. */
export function rupiah(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? "-" : "";
  const digits = Math.abs(rounded).toString();
  return `Rp ${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

export interface CreditCheckInput {
  customer: {
    name: string;
    creditLimit: number;
    active?: boolean;
  };
  /** Piutang pelanggan yang sudah ada. */
  receivables: readonly ReceivableLike[];
  /** Nilai yang akan dijadikan piutang baru (sisa tagihan yang belum dibayar). */
  newDebt: number;
  now?: number;
}

export interface CreditDecision extends CreditPosition {
  ok: boolean;
  /** Piutang terbuka kalau transaksi ini diterima. */
  projectedOutstanding: number;
  reason?: string;
}

/**
 * Keputusan limit untuk satu transaksi tempo. Dipakai `pos.createSale` (server)
 * dan kasir (pratinjau) **dari aturan yang sama**, jadi kasir tidak pernah
 * melihat transaksi yang akan ditolak server.
 */
export function decideCredit(input: CreditCheckInput): CreditDecision {
  const now = input.now ?? Date.now();
  const position = creditPosition(input.customer, input.receivables, now);
  const newDebt = Math.max(0, Math.trunc(Number(input.newDebt) || 0));
  const projectedOutstanding = position.outstanding + newDebt;
  const base = { ...position, projectedOutstanding };

  // Tidak ada yang ditanggungkan: bukan transaksi tempo, jadi limit tidak relevan.
  if (newDebt === 0) return { ...base, ok: true };

  if (input.customer.active === false) {
    return {
      ...base,
      ok: false,
      reason: `Pelanggan ${input.customer.name} tidak aktif, jadi tidak bisa membeli tempo.`,
    };
  }

  if (input.customer.creditLimit <= 0) {
    return {
      ...base,
      ok: false,
      reason: `Pelanggan ${input.customer.name} belum punya limit kredit (tunai saja).`,
    };
  }

  if (position.overdueAmount > 0) {
    return {
      ...base,
      ok: false,
      reason: `Pelanggan ${input.customer.name} punya piutang jatuh tempo ${rupiah(position.overdueAmount)}; tagih dulu sebelum menambah piutang baru.`,
    };
  }

  if (newDebt > position.availableCredit) {
    return {
      ...base,
      ok: false,
      reason: `Sisa limit kredit ${input.customer.name} tidak cukup: tersedia ${rupiah(position.availableCredit)}, dibutuhkan ${rupiah(newDebt)}.`,
    };
  }

  return { ...base, ok: true };
}

export interface PaymentApplication {
  ok: boolean;
  reason?: string;
  /** Sisa piutang setelah pembayaran (0 berarti lunas). */
  remaining: number;
  /** Jumlah yang benar-benar diterima (sama dengan `amount` kalau diterima). */
  accepted: number;
  fullyPaid: boolean;
}

/**
 * Menerapkan pelunasan (boleh sebagian) ke satu nota. Pembayaran lebih besar
 * dari sisa piutang ditolak — bukan dipangkas diam-diam, supaya kasir tahu ada
 * yang salah ketik alih-alih menyimpan kelebihan sebagai piutang negatif.
 */
export function applyReceivablePayment(
  receivable: ReceivableLike,
  amount: number,
): PaymentApplication {
  const balance = receivableBalance(receivable);
  const paid = Math.trunc(Number(amount) || 0);

  if (receivable.status === "void") {
    return { ok: false, remaining: 0, accepted: 0, fullyPaid: false, reason: "Piutang ini sudah dibatalkan." };
  }
  if (balance <= 0 || receivable.status === "paid") {
    return { ok: false, remaining: 0, accepted: 0, fullyPaid: true, reason: "Piutang ini sudah lunas." };
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
      reason: `Pembayaran melebihi sisa piutang (${rupiah(balance)}).`,
    };
  }

  const remaining = balance - paid;
  return { ok: true, remaining, accepted: paid, fullyPaid: remaining === 0 };
}

/** Batas dokumen yang diperiksa **satu putaran** pekerja pengingat piutang lewat tempo. */
export const OVERDUE_REMINDER_BATCH = 50;

/**
 * Jendela pengingat: pekerja harian hanya memeriksa piutang yang jatuh temponya
 * **tidak lebih tua dari 60 hari**.
 *
 * Alasannya sama dengan sisi hutang: nota yang diingatkan sekali tetap
 * diperiksa lagi kalau tidak ada batas, dan tanpa batas bawah barisnya menumpuk
 * di depan indeks `(overdueNotified, dueDate)`. Nota yang baru lewat tempo selalu
 * di dalam jendela karena `now` ikut maju.
 */
export const OVERDUE_REMINDER_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Apakah piutang ini perlu diberitahukan lewat event `receivable.overdue`
 * **sekarang**: penandanya belum pernah dipasang dan ia benar-benar lewat tempo
 * menurut `agingOf` — aturan umur yang sama dengan lencana di halaman Piutang,
 * jadi pengingat dan tampilan tidak pernah berbeda pendapat. Nota yang sudah
 * lunas/dibatalkan tidak pernah menunggak, jadi tidak pernah diberitakan.
 */
export function needsOverdueReminder(
  receivable: ReceivableLike & { overdueNotified?: boolean },
  now: number = Date.now(),
): boolean {
  if (receivable.overdueNotified) return false;
  return agingOf(receivable, now).overdue;
}

export interface ReceivableSummary {
  /** Jumlah nota yang masih bersisa. */
  openCount: number;
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
  /** Total piutang per umur (semua nota terbuka). */
  byBucket: Record<AgingBucket, number>;
}

export function summariseReceivables(
  receivables: readonly ReceivableLike[],
  now: number = Date.now(),
): ReceivableSummary {
  const byBucket: Record<AgingBucket, number> = {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    ">60": 0,
  };
  let openCount = 0;
  let outstanding = 0;
  let overdueAmount = 0;
  let overdueCount = 0;

  for (const receivable of receivables) {
    const balance = receivableBalance(receivable);
    if (balance <= 0) continue;
    const aging = agingOf(receivable, now);
    openCount += 1;
    outstanding += balance;
    byBucket[aging.bucket] += balance;
    if (aging.overdue) {
      overdueAmount += balance;
      overdueCount += 1;
    }
  }

  return { openCount, outstanding, overdueAmount, overdueCount, byBucket };
}

/**
 * Sisa tagihan yang menjadi piutang baru untuk sebuah penjualan: total dikurangi
 * yang benar-benar dibayar. Nilai negatif (kelebihan bayar/kembalian) dirapikan
 * ke 0 — kembalian bukan piutang.
 */
export function creditFromPayment(total: number, paidAmount: number): number {
  const totalValue = Math.max(0, Math.trunc(Number(total) || 0));
  const paid = Math.trunc(Number(paidAmount) || 0);
  return Math.max(0, totalValue - Math.max(0, paid));
}

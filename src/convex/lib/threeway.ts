/**
 * Pencocokan 3 arah & pembayaran batch (`purchasing.threeway`, Phase 3).
 *
 * Hutang usaha sudah lahir otomatis dari penerimaan barang (`lib/payables.ts`),
 * tetapi tagihan yang **dikirim supplier** belum pernah dicocokkan dengan dua
 * dokumen yang kita pegang: apa yang **dipesan** (PO) dan apa yang **datang**
 * (GRN). Selisih di situ adalah uang, dan selisih yang tidak dicatat adalah uang
 * yang hilang tanpa jejak. Yang dijaga di sini:
 *
 * 1. **Dokumen supplier dicatat apa adanya.** `invoice` menyimpan nomor tagihan
 *    supplier, barisnya (kuantitas & harga yang **ditagih**), dan totalnya yang
 *    dihitung sistem dari baris itu — bukan angka yang diketik terpisah, supaya
 *    total dan barisnya tidak pernah saling bertentangan.
 * 2. **Pencocokan selalu dihitung ulang, tidak pernah disimpan.** Status cocok /
 *    ada selisih diturunkan dari PO + GRN + dokumen supplier setiap kali dibaca,
 *    jadi tidak ada status yang bisa basi setelah dokumennya diperbaiki.
 * 3. **Selisih tidak menahan pekerjaan, tetapi menahan pembayaran.** Tagihan yang
 *    selisihnya **diterima** disesuaikan nilainya ke total tagihan supplier;
 *    tagihan yang **disengketakan** tidak bisa dibayar (satu per satu maupun
 *    dalam batch) sampai sengketanya dicabut atau selisihnya diterima. Tanpa
 *    aturan itu, 3-way matching hanya jadi hiasan.
 * 4. **Menerima selisih tidak bisa dibatalkan diam-diam.** Nilai hutangnya sudah
 *    berubah, jadi membatalkan keputusan itu akan menyembunyikan perubahan uang;
 *    sengketa boleh dicabut, penerimaan tidak.
 * 5. **Satu kali bayar, satu nomor (`PAY-…`).** Membayar beberapa tagihan
 *    sekaligus tetap menghasilkan satu baris pembayaran per tagihan — jejak
 *    auditnya sama seperti pembayaran satuan — dan semuanya memakai nomor batch
 *    yang sama supaya rekonsiliasi bank cocok dengan transfernya.
 *
 * Semua nominal integer rupiah, dan aturan ini murni (tanpa dependensi Convex)
 * supaya server, kedua store, halaman Pembelian, dan harness memakai perhitungan
 * yang sama.
 */

import { rupiah } from "./ar";
import {
  applyPayablePayment,
  MAX_BILL_REFERENCE,
  MAX_PAYABLE_NOTE,
  type PayableLike,
  type Result,
} from "./payables";

/** Batas baris dokumen supplier — sama masuk akalnya dengan baris PO. */
export const MAX_INVOICE_LINES = 50;
/** Batas jumlah tagihan dalam satu kali bayar. */
export const MAX_BATCH_BILLS = 30;
/** Selisih di bawah ini dianggap pembulatan, bukan temuan. */
export const MATCH_TOLERANCE = 1;
export const BATCH_NUMBER_PREFIX = "PAY";

export type MatchStatus = "no_reference" | "waiting_invoice" | "matched" | "variance";

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  no_reference: "Tanpa PO/GRN",
  waiting_invoice: "Dokumen supplier belum dicatat",
  matched: "Cocok",
  variance: "Ada selisih",
};

/** Baris dokumen supplier: apa yang benar-benar ditagih. */
export interface InvoiceLine {
  productId: string;
  name: string;
  quantity: number;
  unitCost: number;
}

export interface InvoiceLike {
  reference?: string;
  /** Total tagihan supplier = jumlah baris; selalu konsisten dengan barisnya. */
  total: number;
  lines: InvoiceLine[];
  recordedAt: number;
}

/** Baris PO yang dibutuhkan pencocokan. */
export interface MatchOrderLine {
  productId: string;
  name: string;
  quantity: number;
  unitCost: number;
  receivedQty: number;
}

/** Baris GRN yang dibutuhkan pencocokan. */
export interface MatchReceiptLine {
  productId: string;
  name: string;
  quantity: number;
  unitCost: number;
}

/** Satu baris perbandingan pesan ⇄ datang ⇄ ditagih. */
export interface MatchLine {
  productId: string;
  name: string;
  orderedQty: number;
  orderedUnitCost: number;
  receivedQty: number;
  receivedUnitCost: number;
  /** Kosong kalau dokumen supplier belum dicatat. */
  billedQty?: number;
  billedUnitCost?: number;
  /** `billedQty − receivedQty` dalam unit. */
  qtyVariance: number;
  /** `billedUnitCost − receivedUnitCost` per unit. */
  priceVariance: number;
  /** Nilai selisih baris ini (`ditagih − diterima`), dalam rupiah. */
  valueVariance: number;
}

export interface ThreewayMatch {
  status: MatchStatus;
  /** `true` kalau ada beda yang perlu ditinjau manusia. */
  flagged: boolean;
  orderedValue: number;
  receivedValue: number;
  /** Kosong kalau dokumen supplier belum dicatat. */
  billedValue?: number;
  /** `billedValue − receivedValue`. */
  valueVariance?: number;
  qtyVarianceUnits: number;
  priceVarianceValue: number;
  lines: MatchLine[];
  /** Kalimat siap tampil, satu per temuan. */
  reasons: string[];
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isPositiveInteger(value: number): boolean {
  return Number.isFinite(value) && Math.trunc(value) === value && value > 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isFinite(value) && Math.trunc(value) === value && value >= 0;
}

function lineValue(quantity: number, unitCost: number): number {
  return Math.trunc(quantity) * Math.trunc(unitCost);
}

/**
 * Membandingkan satu tagihan dengan PO & GRN-nya. Dipakai halaman Pembelian,
 * kedua store, dan server (lewat `payables.list`), jadi angka selisih yang
 * dilihat pemilik adalah angka yang sama dengan yang dipakai server saat
 * menolak pembayaran tagihan bersengketa.
 */
export function matchPayable(args: {
  orderLines?: readonly MatchOrderLine[] | null;
  receiptLines?: readonly MatchReceiptLine[] | null;
  invoice?: InvoiceLike | null;
}): ThreewayMatch {
  const orderLines = args.orderLines ?? [];
  const receiptLines = args.receiptLines ?? [];
  const invoice = args.invoice ?? null;

  const ordered = new Map(orderLines.map((line) => [line.productId, line]));
  const received = new Map(receiptLines.map((line) => [line.productId, line]));
  const billed = new Map((invoice?.lines ?? []).map((line) => [line.productId, line]));

  const ids = [
    ...new Set([
      ...ordered.keys(),
      ...received.keys(),
      ...billed.keys(),
    ]),
  ];

  const lines: MatchLine[] = ids.map((productId) => {
    const order = ordered.get(productId);
    const receipt = received.get(productId);
    const bill = billed.get(productId);
    const receivedQty = receipt?.quantity ?? 0;
    const receivedUnitCost = receipt?.unitCost ?? order?.unitCost ?? 0;
    const qtyVariance = bill ? bill.quantity - receivedQty : 0;
    const priceVariance = bill ? bill.unitCost - receivedUnitCost : 0;
    const valueVariance = bill
      ? lineValue(bill.quantity, bill.unitCost) - lineValue(receivedQty, receivedUnitCost)
      : 0;
    return {
      productId,
      name: order?.name ?? receipt?.name ?? bill?.name ?? "Produk dihapus",
      orderedQty: order?.quantity ?? 0,
      orderedUnitCost: order?.unitCost ?? 0,
      receivedQty,
      receivedUnitCost,
      billedQty: bill?.quantity,
      billedUnitCost: bill?.unitCost,
      qtyVariance,
      priceVariance,
      valueVariance,
    };
  });

  const orderedValue = lines.reduce(
    (sum, line) => sum + lineValue(line.orderedQty, line.orderedUnitCost),
    0,
  );
  const receivedValue = lines.reduce(
    (sum, line) => sum + lineValue(line.receivedQty, line.receivedUnitCost),
    0,
  );

  if (!invoice) {
    const hasReference = orderLines.length > 0 || receiptLines.length > 0;
    return {
      status: hasReference ? "waiting_invoice" : "no_reference",
      flagged: false,
      orderedValue,
      receivedValue,
      qtyVarianceUnits: 0,
      priceVarianceValue: 0,
      lines,
      reasons: hasReference
        ? ["Tagihan supplier belum dicatat; belum ada yang dicocokkan."]
        : ["Tagihan ini tidak berasal dari PO/GRN, jadi tidak ada yang dicocokkan."],
    };
  }

  const billedValue = invoice.lines.reduce(
    (sum, line) => sum + lineValue(line.quantity, line.unitCost),
    0,
  );
  const valueVariance = billedValue - receivedValue;
  const qtyVarianceUnits = lines.reduce((sum, line) => sum + Math.abs(line.qtyVariance), 0);
  // Bagian harga dari selisih: beda harga per unit dikalikan jumlah yang benar-
  // benar ditagih. Dipisah dari selisih kuantitas supaya halaman bisa menyebut
  // "harganya lebih mahal" dan "jumlahnya kurang" tanpa menebak.
  const priceVarianceValue = lines.reduce(
    (sum, line) => sum + (line.billedQty ?? 0) * line.priceVariance,
    0,
  );

  const reasons: string[] = [];
  for (const line of lines) {
    if (line.qtyVariance !== 0) {
      reasons.push(
        `${line.name}: ditagih ${line.billedQty} unit, diterima ${line.receivedQty} unit (${line.qtyVariance > 0 ? "+" : ""}${line.qtyVariance}).`,
      );
    }
    if (line.priceVariance !== 0) {
      reasons.push(
        `${line.name}: harga tagihan ${rupiah(line.billedUnitCost ?? 0)} berbeda dari harga terima ${rupiah(line.receivedUnitCost)} (${line.priceVariance > 0 ? "+" : ""}${rupiah(line.priceVariance)}/unit).`,
      );
    }
  }
  if (reasons.length === 0 && Math.abs(valueVariance) > MATCH_TOLERANCE) {
    reasons.push(
      `Nilai tagihan ${rupiah(billedValue)} berbeda dari nilai barang diterima ${rupiah(receivedValue)}.`,
    );
  }

  const flagged = reasons.length > 0;
  if (!flagged) reasons.push(`Cocok dengan PO dan penerimaan (${rupiah(billedValue)}).`);

  return {
    status: flagged ? "variance" : "matched",
    flagged,
    orderedValue,
    receivedValue,
    billedValue,
    valueVariance,
    qtyVarianceUnits,
    priceVarianceValue,
    lines,
    reasons,
  };
}

// ------------------------------------------------------------ dokumen supplier

export interface InvoiceDraftLine extends InvoiceLine {
  /** Kuantitas yang sudah diterima menurut GRN (untuk pratinjau halaman). */
  receivedQty: number;
  /** Kuantitas yang dipesan menurut PO (0 kalau tidak ada PO-nya). */
  orderedQty: number;
}

/**
 * Baris awal dokumen supplier dari penerimaan: kuantitas & harga **menurut GRN**.
 * Halaman memakainya sebagai nilai awal yang bisa disunting, sehingga mencatat
 * tagihan yang cocok tidak perlu mengetik ulang apa pun.
 */
export function buildInvoiceDraft(args: {
  receiptLines: readonly MatchReceiptLine[];
  orderLines?: readonly MatchOrderLine[] | null;
}): InvoiceDraftLine[] {
  const ordered = new Map((args.orderLines ?? []).map((line) => [line.productId, line]));
  return args.receiptLines.map((line) => ({
    productId: line.productId,
    name: line.name,
    quantity: line.quantity,
    unitCost: line.unitCost,
    receivedQty: line.quantity,
    orderedQty: ordered.get(line.productId)?.quantity ?? 0,
  }));
}

export interface InvoiceInputLine {
  productId: string;
  quantity: number;
  unitCost: number;
}

export interface ResolvedInvoice {
  reference?: string;
  lines: InvoiceLine[];
  /** Total tagihan supplier, dihitung dari barisnya. */
  total: number;
  note?: string;
}

/**
 * Mencatat dokumen supplier: nomor tagihan, baris yang ditagih, dan catatan.
 * Totalnya **dihitung**, bukan diterima dari input — supaya baris dan total
 * tidak pernah berbeda, dan pencocokan tidak bisa dibohongi lewat total saja.
 */
export function resolveInvoiceInput(
  input: {
    reference?: string;
    lines: readonly InvoiceInputLine[];
    note?: string;
  },
  options: {
    /** Baris PO + GRN yang jadi rujukan; produk di luar itu ditolak. */
    orderLines?: readonly MatchOrderLine[] | null;
    receiptLines: readonly MatchReceiptLine[];
    productNames?: Map<string, string>;
  },
): Result<ResolvedInvoice> {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return { ok: false, reason: "Isi dulu baris barang yang ditagih supplier." };
  }
  if (input.lines.length > MAX_INVOICE_LINES) {
    return {
      ok: false,
      reason: `Satu dokumen supplier maksimal ${MAX_INVOICE_LINES} baris.`,
    };
  }

  const known = new Map<string, string>();
  for (const line of options.receiptLines) known.set(line.productId, line.name);
  for (const line of options.orderLines ?? []) {
    if (!known.has(line.productId)) known.set(line.productId, line.name);
  }

  const seen = new Set<string>();
  const lines: InvoiceLine[] = [];

  for (const row of input.lines) {
    if (seen.has(row.productId)) {
      return { ok: false, reason: "Ada barang yang muncul dua kali di tagihan supplier." };
    }
    seen.add(row.productId);

    const name = known.get(row.productId);
    if (!name) {
      return {
        ok: false,
        reason: "Ada baris tagihan yang bukan bagian dari PO/penerimaan ini.",
      };
    }
    if (!isPositiveInteger(row.quantity)) {
      return {
        ok: false,
        reason: `Jumlah ditagih ${name} harus bilangan bulat lebih dari 0.`,
      };
    }
    if (!isNonNegativeInteger(row.unitCost)) {
      return {
        ok: false,
        reason: `Harga satuan tagihan ${name} harus bilangan bulat 0 atau lebih.`,
      };
    }

    lines.push({
      productId: row.productId,
      name,
      quantity: row.quantity,
      unitCost: row.unitCost,
    });
  }

  const reference = input.reference ? collapse(input.reference) : "";
  if (reference.length > MAX_BILL_REFERENCE) {
    return {
      ok: false,
      reason: `Nomor tagihan supplier maksimal ${MAX_BILL_REFERENCE} karakter.`,
    };
  }

  const note = input.note ? collapse(input.note) : "";
  if (note.length > MAX_PAYABLE_NOTE) {
    return { ok: false, reason: `Catatan tagihan maksimal ${MAX_PAYABLE_NOTE} karakter.` };
  }

  return {
    ok: true,
    value: {
      reference: reference === "" ? undefined : reference,
      lines,
      total: lines.reduce((sum, line) => sum + lineValue(line.quantity, line.unitCost), 0),
      note: note === "" ? undefined : note,
    },
  };
}

/**
 * Setiap tagihan hanya boleh punya **satu** dokumen supplier. Mencatat ulang
 * berarti menimpa hasil pencocokan yang sudah ditinjau orang, jadi ditolak dan
 * harus lewat keputusan selisih.
 */
export function canRecordInvoice(args: {
  status: "open" | "paid" | "void";
  hasInvoice: boolean;
  hasReceipt: boolean;
}): Result<true> {
  if (args.status === "void") {
    return { ok: false, reason: "Tagihan ini sudah dibatalkan." };
  }
  if (!args.hasReceipt) {
    return {
      ok: false,
      reason: "Tagihan ini tidak menunjuk penerimaan barang (GRN), jadi tidak ada yang dicocokkan.",
    };
  }
  if (args.hasInvoice) {
    return {
      ok: false,
      reason: "Dokumen supplier untuk tagihan ini sudah dicatat; ubah lewat keputusan selisih.",
    };
  }
  return { ok: true, value: true };
}

// ------------------------------------------------------------- keputusan selisih

export type MatchDecisionKind = "accepted" | "disputed";

export interface MatchDecision {
  kind: MatchDecisionKind;
  note?: string;
  decidedById?: string;
  decidedAt: number;
}

export const MATCH_DECISION_LABELS: Record<MatchDecisionKind, string> = {
  accepted: "Selisih diterima",
  disputed: "Disengketakan",
};

/**
 * Keputusan manusia atas selisih: **menerima** (nilai hutang ikut menyesuaikan
 * total tagihan supplier) atau **menyengketakan** (nilai tetap, pembayaran
 * ditahan) — dan mencabut sengketa dengan `none`.
 */
export function resolveMatchDecision(
  input: { kind: MatchDecisionKind | "none"; note?: string },
  options: { current?: MatchDecision | null; hasVariance: boolean },
): Result<MatchDecision | null> {
  if (input.kind === "none") {
    if (!options.current) {
      return { ok: false, reason: "Tagihan ini belum punya keputusan selisih." };
    }
    if (options.current.kind === "accepted") {
      return {
        ok: false,
        reason:
          "Keputusan menerima selisih tidak bisa dibatalkan; nilai hutangnya sudah disesuaikan.",
      };
    }
    return { ok: true, value: null };
  }

  if (input.kind === "accepted" && !options.hasVariance) {
    return { ok: false, reason: "Tagihan ini tidak punya selisih untuk diterima." };
  }

  const note = input.note ? collapse(input.note) : "";
  if (note.length > MAX_PAYABLE_NOTE) {
    return { ok: false, reason: `Catatan selisih maksimal ${MAX_PAYABLE_NOTE} karakter.` };
  }
  if (input.kind === "disputed" && note.length < 3) {
    return { ok: false, reason: "Tuliskan alasan sengketa (minimal 3 karakter)." };
  }

  return {
    ok: true,
    value: {
      kind: input.kind,
      note: note === "" ? undefined : note,
      decidedAt: Date.now(),
    },
  };
}

/** Nilai hutang setelah keputusan: menerima selisih berarti ikut total tagihan. */
export function amountAfterDecision(args: {
  currentAmount: number;
  paidAmount: number;
  match: ThreewayMatch;
  decision: MatchDecision | null;
}): number {
  if (args.decision?.kind !== "accepted") return args.currentAmount;
  const billed = args.match.billedValue ?? args.currentAmount;
  return Math.max(args.paidAmount, billed);
}

/**
 * Penjaga pembayaran: tagihan yang sedang disengketakan **tidak dibayar** — baik
 * satu per satu maupun dalam batch. Ini yang membuat sengketa punya arti.
 */
export function canPayPayable(decision?: MatchDecision | null): Result<true> {
  if (decision?.kind === "disputed") {
    return {
      ok: false,
      reason: `Tagihan ini sedang disengketakan${decision.note ? ` (${decision.note})` : ""}; terima selisihnya atau cabut sengketanya dulu.`,
    };
  }
  return { ok: true, value: true };
}

// -------------------------------------------------------- pembayaran sekaligus

export interface BatchPayableLike extends PayableLike {
  id: string;
  number: string;
  supplierName?: string;
  decision?: MatchDecision | null;
}

export interface BatchPaymentRequest {
  payableId: string;
  amount: number;
}

export interface BatchPaymentRow {
  payableId: string;
  number: string;
  supplierName?: string;
  amount: number;
  remaining: number;
  fullyPaid: boolean;
}

export interface BatchPaymentPlan {
  rows: BatchPaymentRow[];
  total: number;
  fullyPaidCount: number;
}

/**
 * Rencana pembayaran sekaligus: memeriksa tiap tagihan dengan aturan pembayaran
 * yang sama seperti pembayaran satuan (`applyPayablePayment`), menolak sengketa,
 * dan mengembalikan total yang akan keluar — jadi halaman bisa menunjukkan
 * angkanya sebelum uang bergerak.
 */
export function planBatchPayment(args: {
  payables: readonly BatchPayableLike[];
  requests: readonly BatchPaymentRequest[];
}): Result<BatchPaymentPlan> {
  if (!Array.isArray(args.requests) || args.requests.length === 0) {
    return { ok: false, reason: "Pilih dulu tagihan yang mau dibayar." };
  }
  if (args.requests.length > MAX_BATCH_BILLS) {
    return {
      ok: false,
      reason: `Satu kali bayar maksimal ${MAX_BATCH_BILLS} tagihan.`,
    };
  }

  const byId = new Map(args.payables.map((payable) => [payable.id, payable]));
  const seen = new Set<string>();
  const rows: BatchPaymentRow[] = [];
  let total = 0;
  let fullyPaidCount = 0;

  for (const request of args.requests) {
    const payable = byId.get(request.payableId);
    if (!payable) {
      return { ok: false, reason: "Ada tagihan yang tidak ditemukan untuk tenant ini." };
    }
    if (seen.has(request.payableId)) {
      return { ok: false, reason: `Tagihan ${payable.number} muncul dua kali di pembayaran ini.` };
    }
    seen.add(request.payableId);

    const blocked = canPayPayable(payable.decision);
    if (!blocked.ok) return { ok: false, reason: blocked.reason };

    const applied = applyPayablePayment(payable, request.amount);
    if (!applied.ok) {
      return { ok: false, reason: `${payable.number}: ${applied.reason}` };
    }

    total += applied.accepted;
    if (applied.fullyPaid) fullyPaidCount += 1;
    rows.push({
      payableId: payable.id,
      number: payable.number,
      supplierName: payable.supplierName,
      amount: applied.accepted,
      remaining: applied.remaining,
      fullyPaid: applied.fullyPaid,
    });
  }

  return { ok: true, value: { rows, total, fullyPaidCount } };
}

export function batchPaymentNumber(sequence: number): string {
  const safe = Number.isFinite(sequence) ? Math.trunc(sequence) : 1;
  return `${BATCH_NUMBER_PREFIX}-${String(Math.max(1, safe)).padStart(5, "0")}`;
}

// ------------------------------------------------------------------ ringkasan
export interface ThreewayRowLike {
  match: ThreewayMatch;
  decision?: MatchDecision | null;
  /** Sisa hutang tagihan ini; 0 = tidak perlu ditinjau lagi. */
  balance: number;
}

export interface ThreewaySummary {
  /** Tagihan terbuka yang dokumen suppliernya belum dicatat. */
  waitingInvoice: number;
  /** Tagihan terbuka dengan selisih yang belum diputuskan. */
  needsReview: number;
  /** Tagihan terbuka yang sudah cocok tanpa perlu keputusan. */
  matched: number;
  accepted: number;
  disputed: number;
  /** Nilai selisih (absolut) yang belum diselesaikan, dalam rupiah. */
  openVarianceValue: number;
}

export function summariseThreeway(
  rows: readonly ThreewayRowLike[],
): ThreewaySummary {
  let waitingInvoice = 0;
  let needsReview = 0;
  let matched = 0;
  let accepted = 0;
  let disputed = 0;
  let openVarianceValue = 0;

  for (const row of rows) {
    if (row.balance <= 0) continue;
    if (row.decision?.kind === "accepted") accepted += 1;
    if (row.decision?.kind === "disputed") disputed += 1;

    if (row.match.status === "no_reference") {
      // Tagihan manual (tanpa PO/GRN) tidak punya apa pun untuk dicocokkan, jadi
      // ia tidak boleh muncul sebagai "Cocok" — angkanya akan menyesatkan.
      continue;
    }
    if (row.match.status === "waiting_invoice") {
      waitingInvoice += 1;
      continue;
    }
    if (!row.match.flagged) {
      if (row.decision?.kind !== "accepted") matched += 1;
      continue;
    }
    if (row.decision?.kind === "accepted") continue;
    needsReview += 1;
    openVarianceValue += Math.abs(row.match.valueVariance ?? 0);
  }

  return { waitingInvoice, needsReview, matched, accepted, disputed, openVarianceValue };
}

/** Kalimat pendek untuk kartu/halaman. */
export function describeMatch(match: ThreewayMatch): string {
  if (match.status === "no_reference") return "Tanpa PO/GRN — tidak ada yang dicocokkan";
  if (match.status === "waiting_invoice") {
    return `Diterima ${rupiah(match.receivedValue)} — dokumen supplier belum dicatat`;
  }
  if (!match.flagged) return `Cocok dengan PO & penerimaan (${rupiah(match.billedValue ?? 0)})`;
  const variance = match.valueVariance ?? 0;
  return `Selisih ${variance > 0 ? "+" : "−"}${rupiah(Math.abs(variance))} dari nilai barang diterima`;
}

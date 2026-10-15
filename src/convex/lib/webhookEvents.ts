/**
 * Pemicu event webhook keluar (`api.access`) — aturan murni.
 *
 * `lib/webhooks.ts` mengatur **bentuk** kiriman (endpoint, tanda tangan, jadwal
 * ulang); berkas ini mengatur **isi** yang dikirim saat sesuatu benar-benar
 * terjadi: penjualan selesai/dibatalkan, stok menembus ambang, dan opname
 * diposting. Isinya sengaja dikumpulkan di satu tempat supaya bentuk kiriman
 * yang diterima tenant tidak berbeda-beda tergantung dari modul mana ia
 * dipicu — dan supaya bisa diuji tanpa database maupun jaringan.
 *
 * Nama field mengikuti bahasa yang sudah dipakai di aplikasi (nomor struk,
 * total, dsb.) alih-alih menciptakan kosakata baru untuk integrasi.
 */

import { DEFAULT_LOW_STOCK_THRESHOLD } from "./inventory";

/**
 * Apakah stok **baru saja** menembus ambang: sebelumnya masih di atas, sekarang
 * di atau di bawah.
 *
 * Dipakai supaya `stock.low` dikirim **saat kejadiannya**, bukan setiap penjualan
 * berikutnya selama stoknya masih rendah: notifikasi yang berulang tanpa kabar
 * baru hanya membuat penerimanya berhenti membacanya. Sisa stok yang naik lagi
 * (barang datang) otomatis “mengisi ulang” pemicunya.
 */
export function stockCrossedLow(
  previousQuantity: number,
  remainingQuantity: number,
  threshold: number = DEFAULT_LOW_STOCK_THRESHOLD,
): boolean {
  return previousQuantity > threshold && remainingQuantity <= threshold;
}

export interface SaleCompletedEventInput {
  number: string;
  total: number;
  tax: number;
  discount: number;
  /** Sisa yang dicatat sebagai piutang (0 untuk penjualan tunai). */
  creditAmount: number;
  itemCount: number;
  method: string | null;
}

/** Isi `sale.completed`: cukup untuk rekonsiliasi tanpa membuka POS lagi. */
export function saleCompletedEventData(
  input: SaleCompletedEventInput,
): Record<string, unknown> {
  return {
    number: input.number,
    total: input.total,
    tax: input.tax,
    discount: input.discount,
    creditAmount: input.creditAmount,
    itemCount: input.itemCount,
    method: input.method,
    paid: input.total - input.creditAmount,
  };
}

export interface SaleVoidedEventInput {
  number: string;
  total: number;
  /** Pesanan yang belum pernah selesai tidak mengembalikan stok. */
  restocked: boolean;
  reason?: string;
}

export function saleVoidedEventData(
  input: SaleVoidedEventInput,
): Record<string, unknown> {
  return {
    number: input.number,
    total: input.total,
    restocked: input.restocked,
    reason: input.reason ?? null,
  };
}

export interface StockLowEventInput {
  sku: string;
  name: string;
  remaining: number;
  /** Ambang yang berlaku; bawaan sama dengan ambang stok kritis halaman Produk. */
  threshold?: number;
}

export function stockLowEventData(
  input: StockLowEventInput,
): Record<string, unknown> {
  return {
    sku: input.sku,
    name: input.name,
    remaining: input.remaining,
    threshold: input.threshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
  };
}

export interface OpnamePostedEventInput {
  number: string;
  /** Lokasi yang dihitung: lokasi jual toko atau nama gudang. */
  location: string;
  /** Baris yang hasil hitungnya berbeda dari catatan. */
  counted: number;
  uncounted: number;
  /** Selisih bersih dalam satuan dasar (positif = stok bertambah). */
  netUnits: number;
  movements: number;
}

export function opnamePostedEventData(
  input: OpnamePostedEventInput,
): Record<string, unknown> {
  return {
    number: input.number,
    location: input.location,
    counted: input.counted,
    uncounted: input.uncounted,
    netUnits: input.netUnits,
    movements: input.movements,
  };
}

// ------------------------------------------------- dukungan khusus

/**
 * Isi `support.created`: kanal keluar pertama milik dukungan khusus — tim (atau
 * helpdesk tenant) tahu ada tiket baru beserta janji tanggapnya tanpa perlu
 * membuka aplikasi. Kategori & prioritas dikirim sebagai **kunci** yang stabil
 * (`bug`, `urgent`), sama seperti `method` pada `sale.completed`.
 */
export interface SupportTicketCreatedEventInput {
  number: string;
  subject: string;
  category: string;
  priority: string;
  slaHours: number;
  /** Paket yang berlaku saat tiket dibuat (janji dipatok, bukan dihitung ulang). */
  planKey: string;
  /** Janji tanggap dalam waktu absolut, supaya penerima tidak perlu berhitung. */
  dueAt: number;
}

export function supportTicketCreatedEventData(
  input: SupportTicketCreatedEventInput,
): Record<string, unknown> {
  return {
    number: input.number,
    subject: input.subject,
    category: input.category,
    priority: input.priority,
    slaHours: input.slaHours,
    planKey: input.planKey,
    dueAt: input.dueAt,
  };
}

export interface SupportTicketEscalatedEventInput {
  number: string;
  priority: string;
  slaHours: number;
}

export function supportTicketEscalatedEventData(
  input: SupportTicketEscalatedEventInput,
): Record<string, unknown> {
  return {
    number: input.number,
    priority: input.priority,
    slaHours: input.slaHours,
    escalated: true,
  };
}

export interface SupportTicketResolvedEventInput {
  number: string;
  slaHours: number;
  /** `met` bila ditutup di dalam janji, `missed` bila lewat. */
  slaState: string;
}

export function supportTicketResolvedEventData(
  input: SupportTicketResolvedEventInput,
): Record<string, unknown> {
  return {
    number: input.number,
    slaHours: input.slaHours,
    slaState: input.slaState,
    metSla: input.slaState === "met",
  };
}

/**
 * Isi `support.due`: dipicu pekerja terjadwal saat tiket berjalan memasuki
 * jendela “segera jatuh tempo” (atau sudah melewatinya) dan belum pernah
 * diingatkan. Dikirim **sekali** per tiket supaya pengingat tidak jadi kebisingan.
 */
export interface SupportTicketDueEventInput {
  number: string;
  priority: string;
  slaHours: number;
  /** Sisa jam menuju janji; 0 kalau sudah lewat. */
  remainingHours: number;
  overdue: boolean;
}

export function supportTicketDueEventData(
  input: SupportTicketDueEventInput,
): Record<string, unknown> {
  return {
    number: input.number,
    priority: input.priority,
    slaHours: input.slaHours,
    remainingHours: input.remainingHours,
    overdue: input.overdue,
  };
}

// ------------------------------------------------- dokumen jatuh tempo

/**
 * Isi `payable.due`: tagihan supplier yang jatuh temponya sudah tiba namun belum
 * dibayar. Berbeda dari empat event transaksi, keadaan ini berubah karena
 * **waktu**, jadi yang mengirimnya pekerja harian — isinya sengaja memuat angka
 * yang sudah dihitung server (sisa, umur) supaya penerima tidak perlu membuka
 * halaman pembelian dulu untuk tahu tagihan mana yang dimaksud.
 */
export interface PayableDueEventInput {
  number: string;
  supplierName: string;
  amount: number;
  /** Sisa yang belum dibayar. */
  balance: number;
  dueDate: number;
  daysPastDue: number;
  /** Nomor tagihan dari supplier, kalau ada. */
  reference?: string | null;
}

export function payableDueEventData(
  input: PayableDueEventInput,
): Record<string, unknown> {
  return {
    number: input.number,
    supplier: input.supplierName,
    amount: input.amount,
    balance: input.balance,
    dueDate: input.dueDate,
    daysPastDue: input.daysPastDue,
    reference: input.reference ?? null,
  };
}

/**
 * Isi `receivable.overdue`: piutang B2B yang sudah lewat tempo dan belum lunas.
 * Sama seperti `payable.due`, ia dipicu pekerja harian — umur piutang
 * (`daysPastDue`) dihitung dengan aturan `agingOf` yang sama dengan lencana di
 * halaman Piutang.
 */
export interface ReceivableOverdueEventInput {
  number: string;
  customerName: string;
  /** Sisa piutang yang belum dibayar. */
  balance: number;
  dueDate: number;
  daysPastDue: number;
}

export function receivableOverdueEventData(
  input: ReceivableOverdueEventInput,
): Record<string, unknown> {
  return {
    number: input.number,
    customer: input.customerName,
    balance: input.balance,
    dueDate: input.dueDate,
    daysPastDue: input.daysPastDue,
  };
}

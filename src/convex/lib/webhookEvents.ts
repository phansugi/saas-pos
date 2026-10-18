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

/**
 * Isi `product.updated` — dipakai platform untuk menyegarkan katalog & harga
 * tanpa menarik ulang seluruh katalog. `changed` menyebut field apa yang
 * berubah supaya penerima bisa memilih menyimpan sebagian (mis. hanya harga).
 */
export interface ProductUpdatedEventInput {
  sku: string;
  name: string;
  price: number;
  unit: string;
  active: boolean;
  /**
   * Kategori & subkategori katalog saat ini — `null` kalau tidak ada. Dikirim
   * bersama setiap perubahan (bukan hanya saat kategorinya berubah) supaya
   * penerima bisa menyusun katalog dua tingkat tanpa menarik ulang produknya.
   */
  category: string | null;
  subcategory: string | null;
  changed: readonly string[];
  /** SKU lama saat kategori berganti (SKU ikut diganti kode kategorinya). */
  previousSku?: string;
  /** Harga lama saat harga berubah — membantu penerima mengurutkan perubahan. */
  previousPrice?: number;
}

export function productUpdatedEventData(
  input: ProductUpdatedEventInput,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    sku: input.sku,
    name: input.name,
    price: input.price,
    unit: input.unit,
    active: input.active,
    category: input.category ?? null,
    subcategory: input.subcategory ?? null,
    changed: [...input.changed],
  };
  // Hanya dikirim kalau memang ada: penerima lama tidak perlu membaca `null`
  // pada perubahan yang bukan pergantian SKU/harga.
  if (input.previousSku) data.previousSku = input.previousSku;
  if (input.previousPrice !== undefined) data.previousPrice = input.previousPrice;
  return data;
}

/**
 * Isi `stock.changed` — **satu pergerakan stok**, bukan saldo hasil hitung ulang.
 *
 * `delta` dan `balance` dikirim bersama supaya penerima bisa memakai salah
 * satunya: platform yang menghitung sendiri memakai `delta`, sedangkan platform
 * yang ingin langsung menyamakan angkanya memakai `balance`. `refType`/`refId`
 * menyebut dokumen asalnya (nomor struk, GRN, opname) sehingga penerima bisa
 * menolak kiriman ganda dengan pasangan yang sama.
 */
export interface StockChangedEventInput {
  sku: string;
  name: string;
  delta: number;
  balance: number;
  reason: string;
  refType?: string;
  refId?: string;
}

export function stockChangedEventData(
  input: StockChangedEventInput,
): Record<string, unknown> {
  return {
    sku: input.sku,
    name: input.name,
    delta: input.delta,
    balance: input.balance,
    reason: input.reason,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
  };
}

/** Satu baris barang yang diterima pada `purchase.received`. */
export interface PurchaseReceivedLine {
  sku: string;
  name: string;
  quantity: number;
  unitCost: number;
}

export interface PurchaseReceivedEventInput {
  number: string;
  /** Nomor PO asal barang. */
  order: string;
  supplier: string;
  total: number;
  lines: readonly PurchaseReceivedLine[];
}

/** Isi `purchase.received`: cukup untuk memperbarui stok & harga beli di platform. */
export function purchaseReceivedEventData(
  input: PurchaseReceivedEventInput,
): Record<string, unknown> {
  return {
    number: input.number,
    order: input.order,
    supplier: input.supplier,
    total: input.total,
    lineCount: input.lines.length,
    lines: input.lines.map((line) => ({
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      unitCost: line.unitCost,
    })),
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

// ------------------------------------------------------------- shift & kas

/**
 * Isi `shift.alert`: kabar untuk **pemilik toko** bahwa kas belum dibuka padahal
 * toko sudah buka, atau shift belum ditutup padahal toko sudah tutup (termasuk
 * shift yang dibuka hari sebelumnya).
 *
 * Berbeda dari empat event transaksi, keadaannya tidak berasal dari baris
 * database melainkan dari perangkat kasir — shift hidup di perangkat supaya kasir
 * tetap bisa bekerja saat internetnya putus. Karena itu `day` dan `localClock`
 * dikirim apa adanya: penerima membandingkannya dengan jamnya sendiri, bukan
 * menebak dari `at` yang selalu UTC.
 */
export interface ShiftAlertEventInput {
  kind: string;
  reason: string;
  /** Hari kalender lokal perangkat, `YYYY-MM-DD`. */
  day: string;
  /** Jam lokal perangkat saat laporan dibuat (`08:15`). */
  localClock: string;
  title: string;
  message: string;
  /** Waktu buka shift yang masih terbuka; `null` untuk kabar “kas belum dibuka”. */
  shiftOpenedAt: number | null;
  /** Jam operasional workspace yang berlaku saat itu, mis. `08:00–22:00`. */
  operatingHours: string;
}

export function shiftAlertEventData(
  input: ShiftAlertEventInput,
): Record<string, unknown> {
  return {
    kind: input.kind,
    reason: input.reason,
    day: input.day,
    localClock: input.localClock,
    title: input.title,
    message: input.message,
    shiftOpenedAt: input.shiftOpenedAt,
    operatingHours: input.operatingHours,
  };
}

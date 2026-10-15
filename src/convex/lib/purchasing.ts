/**
 * Aturan purchasing — PR (permintaan pembelian) · PO (pesanan pembelian) ·
 * GRN (penerimaan barang) — Phase 3, fitur `purchasing.basic`.
 *
 * Modul murni: dipakai server (`src/convex/purchasing.ts`), dua store klien,
 * halaman Pembelian, dan harness. Semua keputusan angka & status ada di sini,
 * jadi angka di layar tidak bisa berbeda dari yang dicatat backend.
 *
 * Alur yang dimodelkan sengaja berurutan dan tidak bisa dilompati:
 *
 *   PR (submitted) --setujui--> PR (approved) --buat--> PO (open)
 *   PO --terima sebagian--> PO (partial) --terima sisanya--> PO (received)
 *
 * Tiga keputusan yang perlu diketahui:
 *
 * - **Yang meminta tidak menyetujui.** PR ada supaya ada dua orang: staf gudang
 *   mengajukan, pemilik/manajer menyetujui. Izinnya dipisah server-side
 *   (`purchase.request` vs `purchase.approve`).
 * - **PO dari PR yang sudah disetujui**, bukan dari udara: setiap pembelian bisa
 *   ditelusuri ke permintaan asalnya. Supplier & harga beli ditentukan di PO
 *   (di PR belum ada supplier — itu keputusan pembelian, bukan kebutuhan gudang).
 * - **Penerimaan tidak boleh melebihi sisa PO.** Lebih barang dari yang dipesan
 *   itu bukan kemenangan: harganya sudah disepakati, dan lebihnya membuat
 *   pembukuan tidak bisa dicocokkan. Sisa per baris dihitung di sini, bukan di UI.
 */

export interface Result<T> {
  ok: boolean;
  value?: T;
  reason?: string;
}

export type RequisitionStatus = "submitted" | "approved" | "rejected";
export type OrderStatus = "open" | "partial" | "received" | "cancelled";

export const REQUISITION_STATUS_LABELS: Record<RequisitionStatus, string> = {
  submitted: "Menunggu persetujuan",
  approved: "Disetujui",
  rejected: "Ditolak",
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  open: "Terbuka",
  partial: "Diterima sebagian",
  received: "Selesai",
  cancelled: "Dibatalkan",
};

export const MAX_PURCHASE_LINES = 50;
export const MAX_LINE_NOTE = 80;
export const MAX_SUPPLIER_NAME = 60;
export const MAX_SUPPLIER_CODE = 10;
export const MAX_SUPPLIER_ADDRESS = 120;
export const MAX_ORDER_NOTE = 120;

/** Bentuk minimal produk yang dipahami aturan di berkas ini. */
export interface ProductLike {
  id: string;
  name: string;
  active?: boolean;
}

export interface PurchaseLineInput {
  productId: string;
  quantity: number;
  note?: string;
}

export interface PurchaseLine {
  productId: string;
  name: string;
  quantity: number;
  note?: string;
}

/** Baris PO: kebutuhan dari PR + harga beli yang disepakati + yang sudah datang. */
export interface OrderLine {
  productId: string;
  name: string;
  quantity: number;
  unitCost: number;
  receivedQty: number;
}

export interface OrderLineInput {
  productId: string;
  quantity: number;
  unitCost: number;
}

function collapse(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function isPositiveInteger(value: number): boolean {
  return Number.isFinite(value) && Math.trunc(value) === value && value > 0;
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isFinite(value) && Math.trunc(value) === value && value >= 0;
}

// ------------------------------------------------------------------ supplier
export interface SupplierInput {
  name: string;
  code?: string;
  phone?: string;
  address?: string;
  paymentTermDays?: number;
}

export interface ResolvedSupplier {
  code: string;
  name: string;
  phone?: string;
  address?: string;
  paymentTermDays: number;
  active: boolean;
}

export function normalizeSupplierCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

export function isValidSupplierCode(code: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]{1,9}$/.test(code);
}

/** "PT Sumber Rejeki" → "PSR"; menambah nomor kalau sudah dipakai. */
export function suggestSupplierCode(name: string, existing: string[] = []): string {
  const words = collapse(name)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .split(" ")
    .filter((word) => word.length > 0);
  const initials = words
    .map((word) => word[0])
    .join("")
    .slice(0, 4);
  const base = (initials.length >= 2 ? initials : words[0]?.slice(0, 4) ?? "SUP") || "SUP";

  const taken = new Set(existing.map((code) => normalizeSupplierCode(code)));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`.slice(0, MAX_SUPPLIER_CODE);
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-X`.slice(0, MAX_SUPPLIER_CODE);
}

export function resolveSupplierInput(
  input: SupplierInput,
  existingCodes: string[] = [],
): Result<ResolvedSupplier> {
  const name = collapse(input.name ?? "");
  if (name.length < 2 || name.length > MAX_SUPPLIER_NAME) {
    return { ok: false, reason: `Nama supplier harus 2–${MAX_SUPPLIER_NAME} karakter.` };
  }

  const code = input.code
    ? normalizeSupplierCode(input.code)
    : suggestSupplierCode(name, existingCodes);
  if (!isValidSupplierCode(code)) {
    return {
      ok: false,
      reason: `Kode supplier ${input.code} tidak valid — pakai 2–${MAX_SUPPLIER_CODE} huruf/angka (mis. PSR).`,
    };
  }
  if (existingCodes.some((row) => normalizeSupplierCode(row) === code)) {
    return { ok: false, reason: `Kode supplier ${code} sudah dipakai.` };
  }

  const address = input.address ? collapse(input.address) : "";
  if (address.length > MAX_SUPPLIER_ADDRESS) {
    return { ok: false, reason: `Alamat supplier maksimal ${MAX_SUPPLIER_ADDRESS} karakter.` };
  }

  const termDays = input.paymentTermDays === undefined ? 30 : Math.trunc(input.paymentTermDays);
  if (!Number.isFinite(termDays) || termDays < 0 || termDays > 365) {
    return { ok: false, reason: "Tempo pembayaran supplier harus 0–365 hari." };
  }

  return {
    ok: true,
    value: {
      code,
      name,
      phone: input.phone ? collapse(input.phone) : undefined,
      address: address === "" ? undefined : address,
      paymentTermDays: termDays,
      active: true,
    },
  };
}

export interface SupplierPatch {
  name?: string;
  phone?: string;
  address?: string;
  paymentTermDays?: number;
  active?: boolean;
}

/**
 * Mengubah supplier yang sudah ada. Kode supplier **tidak** bisa diubah: ia
 * sudah tercetak di PO/GRN lama, jadi menggantinya akan memutus jejak dokumen.
 * Menonaktifkan supplier adalah jalur pembersihan yang selalu boleh (dan itu
 * jalan keluar saat supplier menunggak tetapi tetap tidak boleh dipakai).
 */
export function resolveSupplierUpdate(
  existing: ResolvedSupplier,
  patch: SupplierPatch,
): Result<ResolvedSupplier> {
  const resolved = resolveSupplierInput(
    {
      name: patch.name ?? existing.name,
      // Kode lama dipakai apa adanya, dan tanpa daftar kode lain supaya
      // pengecekan duplikat tidak menabrak dirinya sendiri.
      code: existing.code,
      phone: patch.phone ?? existing.phone,
      address: patch.address ?? existing.address,
      paymentTermDays: patch.paymentTermDays ?? existing.paymentTermDays,
    },
    [],
  );
  if (!resolved.ok || !resolved.value) return resolved;
  return { ok: true, value: { ...resolved.value, active: patch.active ?? existing.active } };
}

// --------------------------------------------------------------- PR (baris)
export function resolveRequisitionInput(
  lines: PurchaseLineInput[],
  products: ProductLike[],
): Result<PurchaseLine[]> {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, reason: "Permintaan pembelian butuh minimal satu baris." };
  }
  if (lines.length > MAX_PURCHASE_LINES) {
    return { ok: false, reason: `Maksimal ${MAX_PURCHASE_LINES} baris per permintaan.` };
  }

  const byId = new Map(products.map((product) => [product.id, product]));
  const resolved: PurchaseLine[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product) return { ok: false, reason: "Produk tidak valid untuk tenant ini." };
    if (product.active === false) {
      return { ok: false, reason: `Produk ${product.name} sudah nonaktif.` };
    }
    if (seen.has(line.productId)) {
      return { ok: false, reason: `${product.name} muncul dua kali; gabungkan jadi satu baris.` };
    }
    seen.add(line.productId);

    if (!isPositiveInteger(line.quantity)) {
      return { ok: false, reason: `Jumlah ${product.name} harus bilangan bulat lebih dari 0.` };
    }

    const note = line.note ? collapse(line.note).slice(0, MAX_LINE_NOTE) : undefined;
    resolved.push({
      productId: line.productId,
      name: product.name,
      quantity: line.quantity,
      note: note === undefined ? undefined : note,
    });
  }

  return { ok: true, value: resolved };
}

/** PR hanya bisa diputuskan sekali, dan hanya saat masih menunggu. */
export function canDecideRequisition(status: RequisitionStatus): boolean {
  return status === "submitted";
}

/** PO hanya bisa dibuat dari PR yang sudah disetujui, dan hanya satu PO per PR. */
export function canOrderFromRequisition(
  status: RequisitionStatus,
  alreadyOrdered: boolean,
): Result<true> {
  if (alreadyOrdered) {
    return { ok: false, reason: "PR ini sudah punya PO; lanjutkan di PO tersebut." };
  }
  if (status !== "approved") {
    return {
      ok: false,
      reason: `PR berstatus "${REQUISITION_STATUS_LABELS[status]}" belum bisa dijadikan PO.`,
    };
  }
  return { ok: true, value: true };
}

// --------------------------------------------------------------- PO (baris)
export function resolveOrderInput(
  lines: OrderLineInput[],
  products: ProductLike[],
): Result<OrderLine[]> {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, reason: "PO butuh minimal satu baris." };
  }
  if (lines.length > MAX_PURCHASE_LINES) {
    return { ok: false, reason: `Maksimal ${MAX_PURCHASE_LINES} baris per PO.` };
  }

  const byId = new Map(products.map((product) => [product.id, product]));
  const resolved: OrderLine[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product) return { ok: false, reason: "Produk tidak valid untuk tenant ini." };
    if (seen.has(line.productId)) {
      return { ok: false, reason: `${product.name} muncul dua kali; gabungkan jadi satu baris.` };
    }
    seen.add(line.productId);

    if (!isPositiveInteger(line.quantity)) {
      return { ok: false, reason: `Jumlah ${product.name} harus bilangan bulat lebih dari 0.` };
    }
    if (!Number.isFinite(line.unitCost) || line.unitCost < 0) {
      return { ok: false, reason: `Harga beli ${product.name} tidak boleh negatif.` };
    }

    resolved.push({
      productId: line.productId,
      name: product.name,
      quantity: line.quantity,
      unitCost: Math.round(line.unitCost),
      receivedQty: 0,
    });
  }

  return { ok: true, value: resolved };
}

export function orderLineTotal(line: { quantity: number; unitCost: number }): number {
  return Math.round(line.quantity * line.unitCost);
}

export function orderTotal(lines: { quantity: number; unitCost: number }[]): number {
  return lines.reduce((sum, line) => sum + orderLineTotal(line), 0);
}

/** Sisa yang masih harus datang untuk satu baris PO. */
export function lineRemaining(line: { quantity: number; receivedQty: number }): number {
  return Math.max(0, line.quantity - line.receivedQty);
}

export function orderRemaining(lines: { quantity: number; receivedQty: number }[]): number {
  return lines.reduce((sum, line) => sum + lineRemaining(line), 0);
}

export function orderProgressPct(lines: { quantity: number; receivedQty: number }[]): number {
  const ordered = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (ordered === 0) return 0;
  const received = lines.reduce((sum, line) => sum + line.receivedQty, 0);
  return Math.min(100, Math.round((received / ordered) * 100));
}

/** PO yang sudah diterima penuh atau dibatalkan tidak menerima barang lagi. */
export function canReceiveOrder(status: OrderStatus): Result<true> {
  if (status === "received") {
    return { ok: false, reason: "PO ini sudah diterima lengkap." };
  }
  if (status === "cancelled") {
    return { ok: false, reason: "PO ini sudah dibatalkan." };
  }
  return { ok: true, value: true };
}

/** PO hanya bisa dibatalkan selagi belum ada barang yang diterima. */
export function canCancelOrder(lines: { receivedQty: number }[], status: OrderStatus): Result<true> {
  if (status === "cancelled") return { ok: false, reason: "PO ini sudah dibatalkan." };
  if (status === "received") {
    return { ok: false, reason: "PO yang sudah selesai tidak bisa dibatalkan." };
  }
  if (lines.some((line) => line.receivedQty > 0)) {
    return {
      ok: false,
      reason: "Sudah ada barang diterima untuk PO ini; selesaikan atau kembalikan dulu barangnya.",
    };
  }
  return { ok: true, value: true };
}

// -------------------------------------------------------------- GRN (terima)
export interface ReceiptRequestLine {
  productId: string;
  quantity: number;
}

export interface ReceiptPlanLine {
  productId: string;
  name: string;
  quantity: number;
  unitCost: number;
}

export interface ReceiptPlan {
  lines: ReceiptPlanLine[];
  /** Nilai barang yang masuk (dipakai untuk laporan & audit). */
  total: number;
  /** Status PO setelah penerimaan ini. */
  status: OrderStatus;
  /** Sisa unit PO setelah penerimaan ini. */
  remaining: number;
}

/**
 * Rencana penerimaan: memeriksa setiap baris terhadap sisa PO, menghitung nilai
 * barang, dan menentukan status PO setelahnya. Satu fungsi untuk halaman (pesan
 * langsung) dan server (penolakan sebenarnya).
 */
export function planReceipt(args: {
  status: OrderStatus;
  lines: OrderLine[];
  requests: ReceiptRequestLine[];
}): Result<ReceiptPlan> {
  const receive = canReceiveOrder(args.status);
  if (!receive.ok) return { ok: false, reason: receive.reason };

  if (!Array.isArray(args.requests) || args.requests.length === 0) {
    return { ok: false, reason: "Pilih dulu barang yang benar-benar diterima." };
  }

  const byId = new Map(args.lines.map((line) => [line.productId, line]));
  const seen = new Set<string>();
  const planned: ReceiptPlanLine[] = [];

  for (const request of args.requests) {
    const line = byId.get(request.productId);
    if (!line) {
      return { ok: false, reason: "Ada baris yang bukan bagian dari PO ini." };
    }
    if (seen.has(request.productId)) {
      return { ok: false, reason: `${line.name} muncul dua kali di penerimaan ini.` };
    }
    seen.add(request.productId);

    if (!isPositiveInteger(request.quantity)) {
      return {
        ok: false,
        reason: `Jumlah terima ${line.name} harus bilangan bulat lebih dari 0 (isi 0 kalau belum datang).`,
      };
    }

    const remaining = lineRemaining(line);
    if (request.quantity > remaining) {
      return {
        ok: false,
        reason: `${line.name} hanya tersisa ${remaining} unit di PO ini; tidak bisa menerima ${request.quantity}.`,
      };
    }

    planned.push({
      productId: line.productId,
      name: line.name,
      quantity: request.quantity,
      unitCost: line.unitCost,
    });
  }

  const after = args.lines.map((line) => {
    const received = planned.find((row) => row.productId === line.productId);
    return {
      ...line,
      receivedQty: line.receivedQty + (received?.quantity ?? 0),
    };
  });

  const remaining = orderRemaining(after);
  return {
    ok: true,
    value: {
      lines: planned,
      total: orderTotal(planned),
      status: remaining === 0 ? "received" : "partial",
      remaining,
    },
  };
}

/** Status PO dihitung dari barisnya — tidak ada status yang bisa basi. */
export function orderStatusFromLines(
  status: OrderStatus,
  lines: { quantity: number; receivedQty: number }[],
): OrderStatus {
  if (status === "cancelled") return "cancelled";
  const received = lines.reduce((sum, line) => sum + line.receivedQty, 0);
  if (received === 0) return "open";
  return orderRemaining(lines) === 0 ? "received" : "partial";
}

// ------------------------------------------------------------------ ringkasan
export interface PurchasingSummary {
  pendingRequisitions: number;
  openOrders: number;
  /**
   * Sisa nilai yang masih harus datang — bukan nilai PO penuh. PO 20 unit yang
   * 8 unit-nya sudah diterima hanya menyisakan 12 unit sebagai komitmen.
   */
  openOrderValue: number;
  openOrderUnits: number;
  /** PO yang sudah lengkap tapi belum ada penerimaannya. */
  awaitingReceipt: number;
  receivedThisMonth: number;
}

export function summarisePurchasing(args: {
  requisitions: { status: RequisitionStatus }[];
  orders: { status: OrderStatus; lines: { quantity: number; unitCost: number; receivedQty: number }[] }[];
  receipts: { total: number; createdAt: number }[];
  now?: number;
}): PurchasingSummary {
  const now = args.now ?? Date.now();
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const outstanding = args.orders.filter(
    (order) => orderStatusFromLines(order.status, order.lines) !== "cancelled" &&
      orderStatusFromLines(order.status, order.lines) !== "received",
  );

  return {
    pendingRequisitions: args.requisitions.filter((row) => row.status === "submitted").length,
    openOrders: outstanding.length,
    openOrderValue: outstanding.reduce(
      (sum, order) =>
        sum +
        order.lines.reduce(
          (lineSum, line) => lineSum + lineRemaining(line) * line.unitCost,
          0,
        ),
      0,
    ),
    openOrderUnits: outstanding.reduce((sum, order) => sum + orderRemaining(order.lines), 0),
    awaitingReceipt: args.orders.filter(
      (order) => orderStatusFromLines(order.status, order.lines) === "partial",
    ).length,
    receivedThisMonth: args.receipts
      .filter((receipt) => receipt.createdAt >= monthStart.getTime())
      .reduce((sum, receipt) => sum + receipt.total, 0),
  };
}

export function describeSupplier(supplier: { code: string; name: string }): string {
  return `${supplier.code} · ${supplier.name}`;
}

export function describeOrderProgress(lines: { quantity: number; receivedQty: number }[]): string {
  const ordered = lines.reduce((sum, line) => sum + line.quantity, 0);
  const received = lines.reduce((sum, line) => sum + line.receivedQty, 0);
  return `${received}/${ordered} unit`;
}

/** Validasi tempo/harga yang datang dari klien untuk pembaruan supplier. */
export function isValidPaymentTerm(days: number): boolean {
  return isNonNegativeInteger(days) && days <= 365;
}

export function suggestUnitCost(previousCost: number, fallback: number): number {
  const cost = Math.round(previousCost);
  return cost > 0 ? cost : Math.max(0, Math.round(fallback));
}

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  applyStockChange,
  nextSequence,
  requireFeature,
  requirePermission,
  writeAuditLog,
} from "./lib/access";
import { can } from "./lib/authz";
import {
  DEFAULT_WAREHOUSE_ID,
  defaultWarehouse,
  describeWarehouse,
} from "./lib/inventory";
import {
  buildPayableForReceipt,
  payablePosition,
  supplierBlockedReason,
  type PayableLike,
  type PayableStatus,
} from "./lib/payables";
import {
  canCancelOrder,
  canDecideRequisition,
  canOrderFromRequisition,
  orderLineTotal,
  orderStatusFromLines,
  orderTotal,
  planReceipt,
  resolveOrderInput,
  resolveRequisitionInput,
  resolveSupplierInput,
  resolveSupplierUpdate,
  summarisePurchasing,
  MAX_ORDER_NOTE,
  type OrderLine,
  type OrderStatus,
  type RequisitionStatus,
} from "./lib/purchasing";

/**
 * Purchasing: PR · PO · GRN (`purchasing.basic`) — Phase 3.
 *
 * Gerbangnya mengikuti pola piutang/member — **tindakan baru yang dibayar,
 * penyelesaian yang sudah berjalan selalu boleh**:
 *
 * - Membuat PR/PO butuh fitur `purchasing.basic` (Enterprise).
 * - Menerima barang (GRN) hanya butuh izin `purchase.receive`: barang yang sudah
 *   dipesan harus tetap bisa dicatat datang walau paketnya turun, dan penerimaan
 *   itulah yang menggerakkan stok.
 *
 * Izinnya juga dipisah: yang **meminta** (`purchase.request`) bukan yang
 * **menyetujui** (`purchase.approve`), dan yang menyetujui bukan yang menerima
 * barang di gudang.
 */

type Ctx = Parameters<typeof requirePermission>[0];

async function productsFor(
  ctx: Ctx,
  tenantId: Id<"tenants">,
): Promise<Doc<"products">[]> {
  return await ctx.db
    .query("products")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
}

function toProductLike(products: Doc<"products">[]) {
  return products.map((product) => ({
    id: product._id as string,
    name: product.name,
    active: product.active,
  }));
}

async function loadRequisitions(
  ctx: Ctx,
  tenantId: Id<"tenants">,
): Promise<Doc<"purchaseRequisitions">[]> {
  return await ctx.db
    .query("purchaseRequisitions")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
}

async function loadOrders(
  ctx: Ctx,
  tenantId: Id<"tenants">,
): Promise<Doc<"purchaseOrders">[]> {
  return await ctx.db
    .query("purchaseOrders")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
}

async function loadPayables(
  ctx: Ctx,
  tenantId: Id<"tenants">,
): Promise<Doc<"payables">[]> {
  return await ctx.db
    .query("payables")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
}

function toPayableLike(payable: Doc<"payables">): PayableLike {
  return {
    amount: payable.amount,
    paidAmount: payable.paidAmount,
    dueDate: payable.dueDate,
    status: payable.status as PayableStatus,
  };
}

/** Hutang per supplier, dipakai untuk kolom hutang di daftar supplier. */
function payablesBySupplier(payables: Doc<"payables">[]): Map<string, PayableLike[]> {
  const map = new Map<string, PayableLike[]>();
  for (const payable of payables) {
    const key = payable.supplierId as string;
    const list = map.get(key) ?? [];
    list.push(toPayableLike(payable));
    map.set(key, list);
  }
  return map;
}

/** Setiap dokumen purchasing harus milik tenant ini — batas isolasi. */
async function loadRequisitionOrThrow(
  ctx: Ctx,
  tenantId: Id<"tenants">,
  requisitionId: Id<"purchaseRequisitions">,
): Promise<Doc<"purchaseRequisitions">> {
  const row = await ctx.db.get(requisitionId);
  if (!row || row.tenantId !== tenantId) {
    throw new Error("PR tidak ditemukan untuk tenant ini.");
  }
  return row;
}

async function loadOrderOrThrow(
  ctx: Ctx,
  tenantId: Id<"tenants">,
  orderId: Id<"purchaseOrders">,
): Promise<Doc<"purchaseOrders">> {
  const row = await ctx.db.get(orderId);
  if (!row || row.tenantId !== tenantId) {
    throw new Error("PO tidak ditemukan untuk tenant ini.");
  }
  return row;
}

async function loadSupplierOrThrow(
  ctx: Ctx,
  tenantId: Id<"tenants">,
  supplierId: Id<"suppliers">,
): Promise<Doc<"suppliers">> {
  const row = await ctx.db.get(supplierId);
  if (!row || row.tenantId !== tenantId) {
    throw new Error("Supplier tidak ditemukan untuk tenant ini.");
  }
  return row;
}

/**
 * Supplier, PR, PO, dan GRN dalam satu payload. Membaca tidak digerbang fitur
 * supaya dokumen lama tetap bisa ditutup (barang tetap harus diterima) walau
 * paketnya turun; izin `purchase.view` tetap diperiksa server.
 */
export const list = query({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const membership = await requirePermission(
      ctx,
      args.tenantId,
      args.actorId,
      "purchase.view",
    );
    // Posisi hutang hanya untuk peran yang memang boleh melihat uang; staf
    // gudang memakai daftar supplier tanpa angka hutangnya.
    const seesPayables = can(membership.role, "payable.view");
    const now = Date.now();

    const [suppliers, requisitions, orders, receipts, products, payables] = await Promise.all([
      ctx.db
        .query("suppliers")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
      loadRequisitions(ctx, args.tenantId),
      loadOrders(ctx, args.tenantId),
      ctx.db
        .query("goodsReceipts")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
      productsFor(ctx, args.tenantId),
      seesPayables ? loadPayables(ctx, args.tenantId) : Promise.resolve([]),
    ]);

    const debtBySupplier = payablesBySupplier(payables);
    const supplierNameById = new Map(
      suppliers.map((supplier) => [supplier._id as string, supplier.name]),
    );
    const requisitionNumberById = new Map(
      requisitions.map((row) => [row._id as string, row.number]),
    );
    const orderNumberById = new Map(orders.map((row) => [row._id as string, row.number]));

    return {
      suppliers: suppliers
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "id-ID"))
        .map((supplier) => ({
          id: supplier._id,
          code: supplier.code,
          name: supplier.name,
          phone: supplier.phone,
          address: supplier.address,
          paymentTermDays: supplier.paymentTermDays,
          active: supplier.active,
          // Hutang usaha supplier ini — dihitung dari aturan murni `lib/payables`.
          ...payablePosition(debtBySupplier.get(supplier._id as string) ?? [], now),
        })),
      requisitions: requisitions
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((row) => ({
          id: row._id,
          number: row.number,
          status: row.status as RequisitionStatus,
          note: row.note,
          decisionNote: row.decisionNote,
          createdAt: row.createdAt,
          decidedAt: row.decidedAt,
          lines: row.lines.map((line) => ({
            productId: line.productId,
            name: line.name,
            quantity: line.quantity,
            note: line.note,
          })),
          orderNumber: orders.find((order) => order.requisitionId === row._id)?.number ?? null,
        })),
      orders: orders
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((order) => {
          const status = orderStatusFromLines(order.status as OrderStatus, order.lines);
          return {
            id: order._id,
            number: order.number,
            status,
            supplierId: order.supplierId,
            supplierName:
              supplierNameById.get(order.supplierId as string) ?? "Supplier dihapus",
            requisitionNumber: order.requisitionId
              ? (requisitionNumberById.get(order.requisitionId as string) ?? null)
              : null,
            expectedAt: order.expectedAt,
            note: order.note,
            createdAt: order.createdAt,
            total: orderTotal(order.lines),
            receivedValue: orderTotal(order.lines.filter((line) => line.receivedQty > 0).map((line) => ({
              quantity: line.receivedQty,
              unitCost: line.unitCost,
            }))),
            lines: order.lines.map((line) => ({
              productId: line.productId,
              name: line.name,
              quantity: line.quantity,
              unitCost: line.unitCost,
              receivedQty: line.receivedQty,
              lineTotal: orderLineTotal(line),
            })),
          };
        }),
      receipts: receipts
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((receipt) => ({
          id: receipt._id,
          number: receipt.number,
          orderId: receipt.orderId,
          orderNumber: orderNumberById.get(receipt.orderId as string) ?? "—",
          locationName: receipt.warehouseId
            ? "Gudang"
            : defaultWarehouse().name,
          warehouseId: receipt.warehouseId ?? DEFAULT_WAREHOUSE_ID,
          note: receipt.note,
          total: receipt.total,
          createdAt: receipt.createdAt,
          lines: receipt.lines.map((line) => ({
            productId: line.productId,
            name: line.name,
            quantity: line.quantity,
            unitCost: line.unitCost,
          })),
        })),
      summary: summarisePurchasing({
        requisitions: requisitions.map((row) => ({ status: row.status as RequisitionStatus })),
        orders: orders.map((order) => ({
          status: order.status as OrderStatus,
          lines: order.lines,
        })),
        receipts: receipts.map((receipt) => ({
          total: receipt.total,
          createdAt: receipt.createdAt,
        })),
      }),
      /** Harga beli terakhir per produk, untuk mengisi form PO. */
      costs: products.map((product) => ({
        productId: product._id,
        cost: product.cost,
      })),
    };
  },
});

export const createSupplier = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    name: v.string(),
    code: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    paymentTermDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Supplier adalah master data pembelian: menambahnya butuh izin aproval,
    // bukan izin meminta.
    await requirePermission(ctx, args.tenantId, args.actorId, "purchase.approve");

    const existing = await ctx.db
      .query("suppliers")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const resolved = resolveSupplierInput(
      {
        name: args.name,
        code: args.code,
        phone: args.phone,
        address: args.address,
        paymentTermDays: args.paymentTermDays,
      },
      existing.map((supplier) => supplier.code),
    );
    if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
    const supplier = resolved.value;

    const supplierId = await ctx.db.insert("suppliers", {
      tenantId: args.tenantId,
      code: supplier.code,
      name: supplier.name,
      phone: supplier.phone,
      address: supplier.address,
      paymentTermDays: supplier.paymentTermDays,
      active: true,
      createdAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "supplier.create",
      entity: "suppliers",
      entityId: supplierId,
      meta: { code: supplier.code, name: supplier.name },
    });

    return { supplierId, code: supplier.code, name: supplier.name };
  },
});

/**
 * Mengubah supplier yang sudah ada: kontak, tempo pembayaran, dan status aktif.
 *
 * Kode supplier tidak bisa diubah (sudah tercetak di PO/GRN lama). Tempo bisa
 * diubah kapan saja — hutang yang sudah lahir menyimpan temponya sendiri, jadi
 * mengubah tempo supplier tidak menulis ulang jatuh tempo tagihan lama.
 */
export const updateSupplier = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    supplierId: v.id("suppliers"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    paymentTermDays: v.optional(v.number()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "purchase.approve");

    const existing = await loadSupplierOrThrow(ctx, args.tenantId, args.supplierId);
    const resolved = resolveSupplierUpdate(existing, {
      name: args.name,
      phone: args.phone,
      address: args.address,
      paymentTermDays: args.paymentTermDays,
      active: args.active,
    });
    if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
    const supplier = resolved.value;

    await ctx.db.patch(args.supplierId, {
      name: supplier.name,
      phone: supplier.phone,
      address: supplier.address,
      paymentTermDays: supplier.paymentTermDays,
      active: supplier.active,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "supplier.update",
      entity: "suppliers",
      entityId: args.supplierId,
      meta: {
        code: existing.code,
        termDays: supplier.paymentTermDays,
        active: supplier.active,
      },
    });

    return {
      name: supplier.name,
      paymentTermDays: supplier.paymentTermDays,
      active: supplier.active,
    };
  },
});

/** Membuat PR. Butuh fitur `purchasing.basic` + izin `purchase.request`. */
export const createRequisition = mutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
    lines: v.array(
      v.object({
        productId: v.id("products"),
        quantity: v.number(),
        note: v.optional(v.string()),
      }),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireFeature(
      ctx,
      args.tenantId,
      args.actorId,
      "purchasing.basic",
      "purchase.request",
    );

    const products = await productsFor(ctx, args.tenantId);
    const resolved = resolveRequisitionInput(
      args.lines.map((line) => ({
        productId: line.productId as string,
        quantity: line.quantity,
        note: line.note,
      })),
      toProductLike(products),
    );
    if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);

    const sequence = await nextSequence(ctx, args.tenantId, "pr");
    const number = `PR-${String(sequence).padStart(5, "0")}`;

    const requisitionId = await ctx.db.insert("purchaseRequisitions", {
      tenantId: args.tenantId,
      storeId: args.storeId,
      number,
      status: "submitted",
      note: args.note?.trim().slice(0, MAX_ORDER_NOTE) || undefined,
      lines: resolved.value.map((line) => ({
        productId: line.productId as Id<"products">,
        name: line.name,
        quantity: line.quantity,
        note: line.note,
      })),
      requesterId: args.actorId,
      createdAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "requisition.create",
      entity: "purchaseRequisitions",
      entityId: requisitionId,
      meta: { number, lines: resolved.value.length },
    });

    return { requisitionId, number };
  },
});

/** Menyetujui/menolak PR. Yang meminta bukan yang menyetujui. */
export const decideRequisition = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    requisitionId: v.id("purchaseRequisitions"),
    approve: v.boolean(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "purchase.approve");

    const requisition = await loadRequisitionOrThrow(
      ctx,
      args.tenantId,
      args.requisitionId,
    );
    if (!canDecideRequisition(requisition.status as RequisitionStatus)) {
      throw new Error(
        `PR ${requisition.number} sudah diputuskan; statusnya tidak bisa diubah lagi.`,
      );
    }

    const status: RequisitionStatus = args.approve ? "approved" : "rejected";
    await ctx.db.patch(args.requisitionId, {
      status,
      decidedById: args.actorId,
      decidedAt: Date.now(),
      decisionNote: args.note?.trim().slice(0, MAX_ORDER_NOTE) || undefined,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: args.approve ? "requisition.approve" : "requisition.reject",
      entity: "purchaseRequisitions",
      entityId: args.requisitionId,
      meta: { number: requisition.number },
    });

    return { status };
  },
});

/**
 * Membuat PO dari PR yang sudah disetujui; supplier & harga beli ditentukan di
 * sini. Butuh fitur `purchasing.basic` + izin `purchase.approve`.
 */
export const createOrder = mutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
    supplierId: v.id("suppliers"),
    requisitionId: v.id("purchaseRequisitions"),
    lines: v.array(
      v.object({
        productId: v.id("products"),
        quantity: v.number(),
        unitCost: v.number(),
      }),
    ),
    expectedAt: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireFeature(
      ctx,
      args.tenantId,
      args.actorId,
      "purchasing.basic",
      "purchase.approve",
    );

    const requisition = await loadRequisitionOrThrow(
      ctx,
      args.tenantId,
      args.requisitionId,
    );
    const supplier = await loadSupplierOrThrow(ctx, args.tenantId, args.supplierId);
    if (!supplier.active) throw new Error(`Supplier ${supplier.name} sedang nonaktif.`);

    // Supplier yang menunggak tidak dilayani PO baru: tempo punya konsekuensi.
    // Jalan keluarnya nyata — bayar hutangnya, atau nonaktifkan suppliernya.
    const supplierPayables = await ctx.db
      .query("payables")
      .withIndex("by_tenant_supplier", (q) =>
        q.eq("tenantId", args.tenantId).eq("supplierId", args.supplierId),
      )
      .collect();
    const blockedReason = supplierBlockedReason(
      supplierPayables.map(toPayableLike),
      supplier,
    );
    if (blockedReason) throw new Error(blockedReason);

    const existingOrder = (
      await ctx.db
        .query("purchaseOrders")
        .withIndex("by_requisition", (q) => q.eq("requisitionId", args.requisitionId))
        .collect()
    ).find((order) => order.status !== "cancelled");

    const allowed = canOrderFromRequisition(
      requisition.status as RequisitionStatus,
      Boolean(existingOrder),
    );
    if (!allowed.ok) throw new Error(allowed.reason);

    // Baris PO tidak boleh meminta lebih banyak dari PR yang disetujui.
    const requisitionQty = new Map(
      requisition.lines.map((line) => [line.productId as string, line.quantity]),
    );
    const products = await productsFor(ctx, args.tenantId);

    const resolved = resolveOrderInput(
      args.lines.map((line) => ({
        productId: line.productId as string,
        quantity: line.quantity,
        unitCost: line.unitCost,
      })),
      toProductLike(products),
    );
    if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);

    for (const line of resolved.value) {
      const ordered = requisitionQty.get(line.productId);
      if (ordered === undefined) {
        throw new Error(`${line.name} tidak ada di PR ${requisition.number}.`);
      }
      if (line.quantity > ordered) {
        throw new Error(
          `${line.name} diminta ${ordered} unit di PR; PO tidak boleh melebihi itu (${line.quantity}).`,
        );
      }
    }

    const sequence = await nextSequence(ctx, args.tenantId, "po");
    const number = `PO-${String(sequence).padStart(5, "0")}`;

    const orderId = await ctx.db.insert("purchaseOrders", {
      tenantId: args.tenantId,
      storeId: args.storeId,
      number,
      supplierId: args.supplierId,
      requisitionId: args.requisitionId,
      status: "open",
      expectedAt: args.expectedAt,
      note: args.note?.trim().slice(0, MAX_ORDER_NOTE) || undefined,
      lines: resolved.value.map((line) => ({
        productId: line.productId as Id<"products">,
        name: line.name,
        quantity: line.quantity,
        unitCost: line.unitCost,
        receivedQty: 0,
      })),
      createdById: args.actorId,
      createdAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "order.create",
      entity: "purchaseOrders",
      entityId: orderId,
      meta: { number, supplier: supplier.code, value: orderTotal(resolved.value) },
    });

    return { orderId, number, total: orderTotal(resolved.value) };
  },
});

/** Membatalkan PO selama belum ada barang yang diterima. */
export const cancelOrder = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    orderId: v.id("purchaseOrders"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "purchase.approve");

    const order = await loadOrderOrThrow(ctx, args.tenantId, args.orderId);
    const allowed = canCancelOrder(order.lines, order.status as OrderStatus);
    if (!allowed.ok) throw new Error(allowed.reason);

    await ctx.db.patch(args.orderId, {
      status: "cancelled",
      cancelledAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "order.cancel",
      entity: "purchaseOrders",
      entityId: args.orderId,
      meta: { number: order.number, reason: args.reason },
    });

    return { status: "cancelled" as const };
  },
});

/**
 * Menerima barang (GRN): stok masuk ke lokasi yang dipilih, ledger mencatat
 * alasan `purchase`, dan `receivedQty` PO bertambah. **Tidak** digerbang fitur —
 * barang yang sudah dipesan harus tetap bisa dicatat datang.
 */
export const receive = mutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
    orderId: v.id("purchaseOrders"),
    /** Kosong = lokasi jual toko. */
    warehouseId: v.optional(v.id("warehouses")),
    lines: v.array(
      v.object({
        productId: v.id("products"),
        quantity: v.number(),
      }),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "purchase.receive");

    const order = await loadOrderOrThrow(ctx, args.tenantId, args.orderId);

    let locationName = defaultWarehouse().name;
    if (args.warehouseId) {
      const warehouse = await ctx.db.get(args.warehouseId);
      if (!warehouse || warehouse.tenantId !== args.tenantId) {
        throw new Error("Gudang tidak ditemukan untuk tenant ini.");
      }
      if (warehouse.storeId !== order.storeId) {
        throw new Error("Gudang berada di toko yang berbeda dengan PO-nya.");
      }
      if (!warehouse.active) {
        throw new Error(`${describeWarehouse(warehouse)} sedang nonaktif; aktifkan dulu.`);
      }
      locationName = describeWarehouse(warehouse);
    }

    const plan = planReceipt({
      status: order.status as OrderStatus,
      lines: order.lines as OrderLine[],
      requests: args.lines.map((line) => ({
        productId: line.productId as string,
        quantity: line.quantity,
      })),
    });
    if (!plan.ok || !plan.value) throw new Error(plan.reason);
    const receipt = plan.value;

    const sequence = await nextSequence(ctx, args.tenantId, "grn");
    const number = `GRN-${String(sequence).padStart(5, "0")}`;

    // Stok masuk per baris ke lokasi yang dipilih; satu nomor GRN untuk semuanya.
    for (const line of receipt.lines) {
      await applyStockChange(ctx, {
        tenantId: args.tenantId,
        storeId: order.storeId,
        productId: line.productId as Id<"products">,
        warehouseId: args.warehouseId,
        delta: line.quantity,
        reason: "purchase",
        refType: "grn",
        refId: number,
        note: `${order.number} · ${locationName}`,
        actorId: args.actorId,
      });
    }

    // Harga beli terakhir ikut tersimpan di produk supaya laporan margin tidak
    // memakai harga lama; ini **bukan** rata-rata bergerak (belum ada itu).
    for (const line of receipt.lines) {
      if (line.unitCost > 0) {
        await ctx.db.patch(line.productId as Id<"products">, { cost: line.unitCost });
      }
    }

    const nextLines = order.lines.map((line) => {
      const received = receipt.lines.find((row) => row.productId === line.productId);
      return received
        ? { ...line, receivedQty: line.receivedQty + received.quantity }
        : line;
    });

    await ctx.db.patch(args.orderId, {
      lines: nextLines,
      status: receipt.status,
      receivedAt: receipt.status === "received" ? Date.now() : order.receivedAt,
    });

    const receiptId = await ctx.db.insert("goodsReceipts", {
      tenantId: args.tenantId,
      storeId: order.storeId,
      number,
      orderId: args.orderId,
      warehouseId: args.warehouseId,
      note: args.note?.trim().slice(0, MAX_ORDER_NOTE) || undefined,
      lines: receipt.lines.map((line) => ({
        productId: line.productId as Id<"products">,
        name: line.name,
        quantity: line.quantity,
        unitCost: line.unitCost,
      })),
      total: receipt.total,
      receivedById: args.actorId,
      createdAt: Date.now(),
    });

    // Barang yang datang dengan tempo supplier berarti **hutang**, dan hutang
    // itu lahir di transaksi yang sama dengan stoknya — kalau dipisah, akan ada
    // penerimaan yang stoknya masuk tetapi tagihannya terlupa.
    const supplier = await loadSupplierOrThrow(ctx, args.tenantId, order.supplierId);
    const payableDraft = buildPayableForReceipt({
      supplier,
      total: receipt.total,
      receivedAt: Date.now(),
    });
    if (!payableDraft.ok) throw new Error(payableDraft.reason);

    let payableNumber: string | null = null;
    if (payableDraft.value) {
      const payableSequence = await nextSequence(ctx, args.tenantId, "ap");
      payableNumber = `AP-${String(payableSequence).padStart(5, "0")}`;
      await ctx.db.insert("payables", {
        tenantId: args.tenantId,
        storeId: order.storeId,
        supplierId: order.supplierId,
        number: payableNumber,
        orderId: args.orderId,
        receiptId,
        amount: payableDraft.value.amount,
        paidAmount: 0,
        dueDate: payableDraft.value.dueDate,
        paymentTermDays: payableDraft.value.paymentTermDays,
        status: "open",
        note: `${order.number} · ${number}`,
        // Penanda pengingat ditulis sejak lahir: pekerja harian `payable.due`
        // mencari lewat indeks `(dueNotified, dueDate)`, dan indeks Convex hanya
        // memuat baris yang kolomnya **memang bernilai false** — baris tanpa
        // kolom ini tidak akan pernah ditemukan.
        dueNotified: false,
        createdAt: Date.now(),
      });
    }

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "goods.receive",
      entity: "goodsReceipts",
      entityId: receiptId,
      meta: {
        number,
        order: order.number,
        location: locationName,
        value: receipt.total,
        status: receipt.status,
        payable: payableNumber,
      },
    });

    return {
      receiptId,
      number,
      total: receipt.total,
      status: receipt.status,
      remaining: receipt.remaining,
      locationName,
      payableNumber,
      paymentTermDays: payableDraft.value?.paymentTermDays ?? 0,
    };
  },
});

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  applyStockChange,
  entitlementsForTenant,
  findStockLevel,
  getTenantOrThrow,
  nextSequence,
  requireFeature,
  requirePermission,
  writeAuditLog,
} from "./lib/access";
import {
  DEFAULT_WAREHOUSE_ID,
  MAX_TRANSFER_NOTE,
  defaultWarehouse,
  describeWarehouse,
  normalizeWarehouseCode,
  planTransfer,
  resolveWarehouseInput,
  warehouseCapacity,
  type StockLevelLike,
} from "./lib/inventory";
import { PLANS } from "./lib/billing/index";

/**
 * Gudang & perpindahan stok (`inventory.multiwarehouse`) — Phase 3.
 *
 * Dua penjaga yang sengaja berbeda, mengikuti pola piutang/member:
 *
 * - **Menambah gudang** butuh fitur `inventory.multiwarehouse` (Enterprise):
 *   itulah tindakan yang dibayar.
 * - **Memindahkan stok & mematikan gudang** hanya butuh izin `inventory.manage`.
 *   Kalau paket turun, gudang lama harus tetap bisa dikosongkan — memblokir
 *   perpindahan akan mengunci stok fisik di rak yang salah.
 *
 * Stok dijual selalu berasal dari **lokasi jual toko** (bucket tanpa
 * `warehouseId`), jadi kasir tidak bisa menjual barang yang masih di gudang.
 */

type Ctx = Parameters<typeof requirePermission>[0];

function toWarehouseRow(warehouse: Doc<"warehouses">) {
  return {
    id: warehouse._id,
    code: warehouse.code,
    name: warehouse.name,
    address: warehouse.address,
    active: warehouse.active,
  };
}

async function loadWarehouses(
  ctx: Ctx,
  tenantId: Id<"tenants">,
  storeId?: Id<"stores">,
): Promise<Doc<"warehouses">[]> {
  return await ctx.db
    .query("warehouses")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect()
    .then((rows) =>
      storeId ? rows.filter((row) => row.storeId === storeId) : rows,
    );
}

/** Gudang harus milik tenant ini (dan toko yang diminta) — batas isolasi. */
async function loadWarehouseOrThrow(
  ctx: Ctx,
  tenantId: Id<"tenants">,
  warehouseId: Id<"warehouses">,
): Promise<Doc<"warehouses">> {
  const warehouse = await ctx.db.get(warehouseId);
  if (!warehouse || warehouse.tenantId !== tenantId) {
    throw new Error("Gudang tidak ditemukan untuk tenant ini.");
  }
  return warehouse;
}

/**
 * Stok per lokasi satu toko: lokasi jual (bucket lama) + setiap gudang.
 * Selalu memuat baris untuk semua lokasi, termasuk yang bernilai 0, supaya
 * tabelnya menunjukkan "kosong", bukan menghilangkan lokasinya.
 */
async function stockLevelsFor(
  ctx: Ctx,
  args: {
    tenantId: Id<"tenants">;
    storeId: Id<"stores">;
    warehouses: Doc<"warehouses">[];
  },
): Promise<Map<string, StockLevelLike[]>> {
  const rows = await ctx.db
    .query("stockLevels")
    .withIndex("by_tenant_store", (q) =>
      q.eq("tenantId", args.tenantId).eq("storeId", args.storeId),
    )
    .collect();

  const quantityByProductAndLocation = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.productId as string}|${row.warehouseId ?? DEFAULT_WAREHOUSE_ID}`;
    quantityByProductAndLocation.set(
      key,
      (quantityByProductAndLocation.get(key) ?? 0) + row.quantity,
    );
  }

  const products = await ctx.db
    .query("products")
    .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
    .collect();

  const levels = new Map<string, StockLevelLike[]>();
  for (const product of products) {
    const locations = [DEFAULT_WAREHOUSE_ID, ...args.warehouses.map((w) => w._id as string)];
    levels.set(
      product._id as string,
      locations.map((location) => ({
        warehouseId: location,
        quantity:
          quantityByProductAndLocation.get(`${product._id as string}|${location}`) ?? 0,
      })),
    );
  }
  return levels;
}

/** Daftar gudang + stok per lokasi + batas paket, untuk halaman Gudang & Stok. */
export const list = query({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Melihat stok per lokasi = izin `inventory.view` (staf gudang, manajer,
    // pemilik). Kasir menjual dari lokasi jual; halaman ini bukan untuknya.
    await requirePermission(ctx, args.tenantId, args.actorId, "inventory.view");

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    const entitlements = entitlementsForTenant(tenant);
    const warehouses = (await loadWarehouses(ctx, args.tenantId, args.storeId)).sort(
      (a, b) => a.code.localeCompare(b.code, "id-ID"),
    );

    const products = (
      await ctx.db
        .query("products")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect()
    )
      .filter((product) => product.active)
      .sort((a, b) => a.name.localeCompare(b.name, "id-ID"));

    const levels = await stockLevelsFor(ctx, {
      tenantId: args.tenantId,
      storeId: args.storeId,
      warehouses,
    });

    const stock = products.map((product) => {
      const productLevels = levels.get(product._id as string) ?? [];
      const sellable =
        productLevels.find((level) => level.warehouseId === DEFAULT_WAREHOUSE_ID)
          ?.quantity ?? 0;
      return {
        productId: product._id,
        sku: product.sku,
        name: product.name,
        unit: product.unit ?? "PCS",
        levels: productLevels,
        sellable,
        total: productLevels.reduce((sum, level) => sum + level.quantity, 0),
      };
    });

    // Riwayat perpindahan dari ledger: satu baris keluar (delta negatif) dan
    // satu baris masuk per nomor pindah — dipasangkan kembali untuk dibaca
    // sebagai "dari → ke".
    const movements = await ctx.db
      .query("stockMovements")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const transfers = new Map<string, Doc<"stockMovements">[]>();
    for (const movement of movements) {
      if (movement.reason !== "transfer") continue;
      const key = movement.refId ?? movement._id;
      const group = transfers.get(key) ?? [];
      group.push(movement);
      transfers.set(key, group);
    }
    const productNameById = new Map(
      products.map((product) => [product._id as string, product.name]),
    );
    const warehouseNameById = new Map<string, string>([
      [DEFAULT_WAREHOUSE_ID, defaultWarehouse().name],
      ...warehouses.map((warehouse) => [
        warehouse._id as string,
        warehouse.name,
      ] as [string, string]),
    ]);

    const history = [...transfers.entries()]
      .map(([number, group]) => {
        const out = group.find((movement) => movement.delta < 0);
        const into = group.find((movement) => movement.delta >= 0);
        const sample = group[0];
        return {
          number,
          at: Math.max(...group.map((movement) => movement.createdAt)),
          productId: sample.productId,
          productName:
            productNameById.get(sample.productId as string) ?? "Produk dihapus",
          fromName:
            warehouseNameById.get(out?.warehouseId ?? DEFAULT_WAREHOUSE_ID) ??
            "Lokasi tidak dikenal",
          toName:
            warehouseNameById.get(into?.warehouseId ?? DEFAULT_WAREHOUSE_ID) ??
            "Lokasi tidak dikenal",
          quantity: Math.abs(out?.delta ?? sample.delta),
          note: sample.note,
        };
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, 20);

    const capacity = warehouseCapacity(
      entitlements.limits.warehouses,
      warehouses.length,
    );

    return {
      planKey: entitlements.planKey,
      warehouses: warehouses.map(toWarehouseRow),
      locations: [
        defaultWarehouse(),
        ...warehouses.map((warehouse) => ({
          ...toWarehouseRow(warehouse),
          isDefault: false,
        })),
      ],
      capacity,
      stock,
      history,
      summary: {
        skuCount: stock.length,
        withStockCount: stock.filter((row) => row.total > 0).length,
        sellableUnits: stock.reduce((sum, row) => sum + row.sellable, 0),
        storedUnits: stock.reduce((sum, row) => sum + (row.total - row.sellable), 0),
      },
    };
  },
});

/**
 * Menambah gudang. Ini tindakan yang dibayar: butuh fitur
 * `inventory.multiwarehouse` **dan** sisa slot paket (`limits.warehouses`,
 * di mana lokasi jual sudah menempati satu slot).
 */
export const create = mutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
    name: v.string(),
    code: v.optional(v.string()),
    address: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireFeature(
      ctx,
      args.tenantId,
      args.actorId,
      "inventory.multiwarehouse",
      "inventory.manage",
    );

    const store = await ctx.db.get(args.storeId);
    if (!store || store.tenantId !== args.tenantId) {
      throw new Error("Toko tidak valid untuk tenant ini.");
    }

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    const entitlements = entitlementsForTenant(tenant);
    // Kode gudang unik per tenant, dan batas paket dihitung tenant-wide — bukan
    // per toko — supaya satu tenant tidak bisa melewati batasnya dengan
    // menambah toko.
    const existing = await loadWarehouses(ctx, args.tenantId);

    const resolved = resolveWarehouseInput(
      { name: args.name, code: args.code, address: args.address },
      existing.map((warehouse) => warehouse.code),
    );
    if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
    const warehouse = resolved.value;

    const capacity = warehouseCapacity(
      entitlements.limits.warehouses,
      existing.length,
    );
    if (capacity.full) {
      throw new Error(
        `Paket ${PLANS[entitlements.planKey].name} memungkinkan ${capacity.limit} lokasi stok termasuk lokasi jual; naikkan paket untuk menambah gudang.`,
      );
    }

    const duplicate = existing.find(
      (row) => normalizeWarehouseCode(row.code) === warehouse.code,
    );
    if (duplicate) throw new Error(`Kode gudang ${warehouse.code} sudah dipakai.`);

    const warehouseId = await ctx.db.insert("warehouses", {
      tenantId: args.tenantId,
      storeId: args.storeId,
      code: warehouse.code,
      name: warehouse.name,
      address: warehouse.address,
      active: true,
      createdAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "warehouse.create",
      entity: "warehouses",
      entityId: warehouseId,
      meta: { code: warehouse.code, name: warehouse.name },
    });

    return { warehouseId, code: warehouse.code, name: warehouse.name };
  },
});

/**
 * Mengubah nama/alamat/status gudang. Tidak digerbang fitur: merapikan gudang
 * yang sudah ada bukan tindakan yang dibayar. Gudang yang masih menyimpan stok
 * **tidak boleh** dinonaktifkan — kalau tidak, stoknya hilang dari pandangan
 * sementara fisiknya masih ada di rak.
 */
export const update = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    warehouseId: v.id("warehouses"),
    name: v.optional(v.string()),
    address: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "inventory.manage");

    const existing = await loadWarehouseOrThrow(ctx, args.tenantId, args.warehouseId);

    const resolved = resolveWarehouseInput(
      {
        name: args.name ?? existing.name,
        code: existing.code,
        address: args.address ?? existing.address,
      },
      [],
    );
    if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
    const next = resolved.value;

    const active = args.active ?? existing.active;
    if (!active) {
      const levels = await ctx.db
        .query("stockLevels")
        .withIndex("by_tenant_store", (q) =>
          q.eq("tenantId", args.tenantId).eq("storeId", existing.storeId),
        )
        .collect();
      const held = levels
        .filter((level) => level.warehouseId === args.warehouseId)
        .reduce((sum, level) => sum + level.quantity, 0);
      if (held !== 0) {
        throw new Error(
          `${describeWarehouse(existing)} masih menyimpan ${held} unit; pindahkan dulu stoknya ke lokasi lain.`,
        );
      }
    }

    await ctx.db.patch(args.warehouseId, {
      name: next.name,
      address: next.address,
      active,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "warehouse.update",
      entity: "warehouses",
      entityId: args.warehouseId,
      meta: {
        name: next.name,
        address: next.address,
        active,
        from: existing.active ? "aktif" : "nonaktif",
      },
    });

    return { name: next.name, address: next.address, active };
  },
});

/**
 * Memindahkan stok antar lokasi (gudang → lokasi jual, atau sebaliknya).
 *
 * Ledger mencatat **dua** baris untuk satu perpindahan (keluar dan masuk)
 * dengan nomor `TRF-…` yang sama, jadi jumlah total stok tidak pernah berubah
 * dan setiap perpindahan bisa ditelusuri. Tidak digerbang fitur: mengosongkan
 * gudang selalu boleh.
 */
export const transfer = mutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
    productId: v.id("products"),
    /** Kosong = lokasi jual toko. */
    from: v.optional(v.id("warehouses")),
    to: v.optional(v.id("warehouses")),
    quantity: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "inventory.manage");

    const product = await ctx.db.get(args.productId);
    if (!product || product.tenantId !== args.tenantId) {
      throw new Error("Produk tidak ditemukan untuk tenant ini.");
    }
    const store = await ctx.db.get(args.storeId);
    if (!store || store.tenantId !== args.tenantId) {
      throw new Error("Toko tidak valid untuk tenant ini.");
    }

    const source = args.from
      ? await loadWarehouseOrThrow(ctx, args.tenantId, args.from)
      : null;
    const target = args.to
      ? await loadWarehouseOrThrow(ctx, args.tenantId, args.to)
      : null;
    for (const warehouse of [source, target]) {
      if (warehouse && warehouse.storeId !== args.storeId) {
        throw new Error("Gudang berada di toko yang berbeda.");
      }
    }

    const fromName = source ? describeWarehouse(source) : defaultWarehouse().name;
    const toName = target ? describeWarehouse(target) : defaultWarehouse().name;

    const level = await findStockLevel(ctx, {
      productId: args.productId,
      storeId: args.storeId,
      warehouseId: args.from,
    });
    const available = level?.quantity ?? 0;

    const plan = planTransfer({
      from: args.from ?? DEFAULT_WAREHOUSE_ID,
      to: args.to ?? DEFAULT_WAREHOUSE_ID,
      quantity: args.quantity,
      available,
      fromName,
      toName,
      fromActive: source?.active ?? true,
      toActive: target?.active ?? true,
    });
    if (!plan.ok || !plan.value) throw new Error(plan.reason);
    const quantity = plan.value.quantity;

    const note = args.note ? args.note.trim().slice(0, MAX_TRANSFER_NOTE) : undefined;
    const sequence = await nextSequence(ctx, args.tenantId, "transfer");
    const number = `TRF-${String(sequence).padStart(5, "0")}`;

    await applyStockChange(ctx, {
      tenantId: args.tenantId,
      storeId: args.storeId,
      productId: args.productId,
      warehouseId: args.from,
      delta: -quantity,
      reason: "transfer",
      refType: "transfer",
      refId: number,
      note: `${fromName} → ${toName}${note ? ` · ${note}` : ""}`,
      actorId: args.actorId,
    });
    const balance = await applyStockChange(ctx, {
      tenantId: args.tenantId,
      storeId: args.storeId,
      productId: args.productId,
      warehouseId: args.to,
      delta: quantity,
      reason: "transfer",
      refType: "transfer",
      refId: number,
      note: `${fromName} → ${toName}${note ? ` · ${note}` : ""}`,
      actorId: args.actorId,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "inventory.transfer",
      entity: "products",
      entityId: args.productId,
      meta: {
        number,
        from: fromName,
        to: toName,
        quantity,
        product: product.name,
      },
    });

    return {
      number,
      productId: args.productId,
      productName: product.name,
      quantity,
      from: { id: args.from ?? DEFAULT_WAREHOUSE_ID, name: fromName },
      to: { id: args.to ?? DEFAULT_WAREHOUSE_ID, name: toName },
      /** Saldo lokasi tujuan setelah perpindahan. */
      balance,
    };
  },
});

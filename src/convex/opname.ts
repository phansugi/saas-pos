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
import {
  DEFAULT_WAREHOUSE_ID,
  defaultWarehouse,
  describeWarehouse,
} from "./lib/inventory";
import {
  buildOpnameLines,
  canCancelOpname,
  canEditOpname,
  canPostOpname,
  countProgress,
  lineVariance,
  opnameNumber,
  planOpnamePost,
  resolveOpnameNote,
  resolveOpnameStart,
  setCountedQty,
  summariseOpnameSessions,
  summariseVariance,
  MAX_OPNAME_NOTE,
  type OpnameLineLike,
  type OpnameStatus,
} from "./lib/opname";
import { opnamePostedEventData } from "./lib/webhookEvents";
import {
  enqueueWebhookEvent,
  scheduleWebhookDeliveryPass,
} from "./lib/webhookOutbox";

/**
 * Stock opname (`inventory.opname`, Phase 3).
 *
 * Gerbangnya mengikuti pola yang sama dengan fitur Phase 3 lain — **tindakan yang
 * dibayar vs pekerjaan yang sudah jalan**:
 *
 * - **Membuat sesi baru** butuh fitur `inventory.opname` (Enterprise).
 * - **Menghitung, memposting, dan membatalkan** hanya butuh izin
 *   `inventory.manage`. Fisik barang sudah dihitung di rak; paket yang turun
 *   tidak boleh membuat hasil hitungan itu hilang.
 *
 * Izinnya punya dua tingkat seperti gudang: `inventory.view` untuk melihat sesi &
 * selisihnya (staf gudang, manajer, pemilik), `inventory.manage` untuk menulis
 * hasil hitung dan mempostingnya.
 */

type Ctx = Parameters<typeof requirePermission>[0];

function toLineLike(line: Doc<"opnameSessions">["lines"][number]): OpnameLineLike {
  return {
    productId: line.productId as string,
    name: line.name,
    sku: line.sku,
    unit: line.unit,
    systemQty: line.systemQty,
    countedQty: line.countedQty,
    note: line.note,
  };
}

async function loadSessionOrThrow(
  ctx: Ctx,
  tenantId: Id<"tenants">,
  sessionId: Id<"opnameSessions">,
): Promise<Doc<"opnameSessions">> {
  const session = await ctx.db.get(sessionId);
  if (!session || session.tenantId !== tenantId) {
    throw new Error("Sesi opname tidak ditemukan untuk tenant ini.");
  }
  return session;
}

async function loadSessions(
  ctx: Ctx,
  tenantId: Id<"tenants">,
): Promise<Doc<"opnameSessions">[]> {
  return await ctx.db
    .query("opnameSessions")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
}

/**
 * Saldo lokasi saat ini per produk. Dipakai untuk dua hal: menampilkan saldo
 * terkini di samping snapshot, dan menghitung delta saat posting.
 */
async function currentQtyFor(
  ctx: Ctx,
  args: {
    tenantId: Id<"tenants">;
    storeId: Id<"stores">;
    warehouseId?: Id<"warehouses">;
  },
): Promise<Map<string, number>> {
  const rows = await ctx.db
    .query("stockLevels")
    .withIndex("by_tenant_store", (q) =>
      q.eq("tenantId", args.tenantId).eq("storeId", args.storeId),
    )
    .collect();

  const target = args.warehouseId ?? null;
  const map = new Map<string, number>();
  for (const row of rows) {
    if ((row.warehouseId ?? null) !== target) continue;
    const key = row.productId as string;
    map.set(key, (map.get(key) ?? 0) + row.quantity);
  }
  return map;
}

/** Nama lokasi sesi; sesi lama dengan gudang terhapus tetap terbaca. */
function locationLabel(
  session: Doc<"opnameSessions">,
  warehouseById: Map<string, Doc<"warehouses">>,
): string {
  if (!session.warehouseId) return defaultWarehouse().name;
  const warehouse = warehouseById.get(session.warehouseId as string);
  return warehouse ? describeWarehouse(warehouse) : "Gudang dihapus";
}

/**
 * Sesi opname + stok terkini lokasinya. Membaca tidak digerbang fitur: sesi yang
 * sudah berjalan harus tetap bisa diselesaikan walau paketnya turun.
 */
export const list = query({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "inventory.view");

    const [sessions, warehouses] = await Promise.all([
      loadSessions(ctx, args.tenantId),
      ctx.db
        .query("warehouses")
        .withIndex("by_tenant_store", (q) =>
          q.eq("tenantId", args.tenantId).eq("storeId", args.storeId),
        )
        .collect(),
    ]);

    const warehouseById = new Map(warehouses.map((row) => [row._id as string, row]));

    const rows = await Promise.all(
      sessions
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(async (session) => {
          const current = await currentQtyFor(ctx, {
            tenantId: args.tenantId,
            storeId: session.storeId,
            warehouseId: session.warehouseId,
          });
          return {
            id: session._id,
            number: session.number,
            storeId: session.storeId,
            warehouseId: session.warehouseId ?? DEFAULT_WAREHOUSE_ID,
            locationName: locationLabel(session, warehouseById),
            status: session.status as OpnameStatus,
            note: session.note,
            createdAt: session.createdAt,
            postedAt: session.postedAt,
            cancelledAt: session.cancelledAt,
            progress: countProgress(session.lines.map(toLineLike)),
            variance: summariseVariance(session.lines.map(toLineLike)),
            lines: session.lines.map((line) => {
              const like = toLineLike(line);
              return {
                ...like,
                /** Saldo lokasi saat ini — pembanding snapshot & dasar posting. */
                currentQty: current.get(like.productId) ?? 0,
                variance: lineVariance(like),
              };
            }),
          };
        }),
    );

    return {
      sessions: rows,
      locations: [
        { id: DEFAULT_WAREHOUSE_ID, name: defaultWarehouse().name, active: true },
        ...warehouses.map((warehouse) => ({
          id: warehouse._id as string,
          name: describeWarehouse(warehouse),
          active: warehouse.active,
        })),
      ],
      summary: summariseOpnameSessions(
        sessions.map((session) => ({
          status: session.status as OpnameStatus,
          lines: session.lines.map(toLineLike),
        })),
      ),
      /** Sesi berjalan per lokasi, untuk memperingatkan sebelum memulai yang baru. */
      openByLocation: sessions
        .filter((session) => session.status === "draft")
        .map((session) => ({
          number: session.number,
          locationId: session.warehouseId ?? DEFAULT_WAREHOUSE_ID,
        })),
    };
  },
});

/**
 * Memulai sesi opname di satu lokasi. Baris sesi adalah **snapshot** saldo
 * lokasi itu saat ini; `productIds` boleh diisi untuk hitung sebagian (cycle
 * count), kalau tidak semua produk aktif yang dilacak stoknya ikut dihitung.
 */
export const start = mutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
    /** Kosong = lokasi jual toko. */
    warehouseId: v.optional(v.id("warehouses")),
    productIds: v.optional(v.array(v.id("products"))),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Sesi baru adalah tindakan yang dibayar.
    await requireFeature(
      ctx,
      args.tenantId,
      args.actorId,
      "inventory.opname",
      "inventory.manage",
    );

    const locations = await ctx.db
      .query("warehouses")
      .withIndex("by_tenant_store", (q) =>
        q.eq("tenantId", args.tenantId).eq("storeId", args.storeId),
      )
      .collect();
    const warehouseById = new Map(locations.map((row) => [row._id as string, row]));

    let locationName = defaultWarehouse().name;
    if (args.warehouseId) {
      const warehouse = warehouseById.get(args.warehouseId as string);
      if (!warehouse) {
        throw new Error("Gudang tidak ditemukan untuk tenant ini.");
      }
      if (!warehouse.active) {
        throw new Error(`${describeWarehouse(warehouse)} sedang nonaktif; aktifkan dulu.`);
      }
      locationName = describeWarehouse(warehouse);
    }

    const openSessions = (await loadSessions(ctx, args.tenantId))
      .filter((session) => session.status === "draft")
      .map((session) => ({
        number: session.number,
        locationId: session.warehouseId ?? DEFAULT_WAREHOUSE_ID,
        createdAt: session.createdAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);

    const products = (
      await ctx.db
        .query("products")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect()
    )
      .filter((product) => product.active && product.trackStock)
      .filter((product) =>
        args.productIds ? args.productIds.includes(product._id) : true,
      )
      .sort((a, b) => a.name.localeCompare(b.name, "id-ID"));

    const current = await currentQtyFor(ctx, {
      tenantId: args.tenantId,
      storeId: args.storeId,
      warehouseId: args.warehouseId,
    });

    const lines = buildOpnameLines(
      products.map((product) => ({
        id: product._id as string,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
      })),
      (productId) => current.get(productId) ?? 0,
    );

    const plan = resolveOpnameStart({
      location: { id: args.warehouseId ?? DEFAULT_WAREHOUSE_ID, name: locationName },
      openSessions,
      lines,
    });
    if (!plan.ok || !plan.value) throw new Error(plan.reason);

    const note = resolveOpnameNote(args.note);
    if (!note.ok) throw new Error(note.reason);

    const sequence = await nextSequence(ctx, args.tenantId, "opname");
    const number = opnameNumber(sequence);

    const sessionId = await ctx.db.insert("opnameSessions", {
      tenantId: args.tenantId,
      storeId: args.storeId,
      number,
      warehouseId: args.warehouseId,
      status: "draft",
      note: note.value,
      lines: plan.value.lines.map((line) => ({
        productId: line.productId as Id<"products">,
        name: line.name,
        sku: line.sku ?? "",
        unit: line.unit ?? "PCS",
        systemQty: line.systemQty,
      })),
      startedById: args.actorId,
      createdAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "opname.start",
      entity: "opnameSessions",
      entityId: sessionId,
      meta: {
        number,
        location: locationName,
        lines: plan.value.lines.length,
        units: plan.value.lines.reduce((sum, line) => sum + line.systemQty, 0),
      },
    });

    return {
      sessionId,
      number,
      locationName,
      lineCount: plan.value.lines.length,
    };
  },
});

/**
 * Menulis (atau menghapus) hasil hitung satu baris. Baris yang belum dihitung
 * tetap "belum dihitung" — bukan nol.
 */
export const setCount = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    sessionId: v.id("opnameSessions"),
    productId: v.id("products"),
    /** Kosongkan untuk mengembalikan baris ke "belum dihitung". */
    countedQty: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "inventory.manage");

    const session = await loadSessionOrThrow(ctx, args.tenantId, args.sessionId);
    const editable = canEditOpname(session.status as OpnameStatus);
    if (!editable.ok) throw new Error(editable.reason);

    const updated = setCountedQty(session.lines.map(toLineLike), {
      productId: args.productId as string,
      countedQty: args.countedQty,
      note: args.note,
    });
    if (!updated.ok || !updated.value) throw new Error(updated.reason);

    await ctx.db.patch(args.sessionId, {
      lines: updated.value.map((line) => ({
        productId: line.productId as Id<"products">,
        name: line.name,
        sku: line.sku ?? "",
        unit: line.unit ?? "PCS",
        systemQty: line.systemQty,
        countedQty: line.countedQty,
        note: line.note,
      })),
    });

    const progress = countProgress(updated.value);
    return {
      countedQty: updated.value.find((line) => line.productId === args.productId)?.countedQty,
      progress,
    };
  },
});

/**
 * Memposting sesi: stok lokasi dibuat sama persis dengan hasil hitung, dan setiap
 * perubahan dicatat di ledger dengan alasan `opname` + nomor sesi sebagai `refId`.
 * Baris yang belum dihitung tidak disentuh sama sekali.
 */
export const post = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    sessionId: v.id("opnameSessions"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "inventory.manage");

    const session = await loadSessionOrThrow(ctx, args.tenantId, args.sessionId);
    const allowed = canPostOpname({
      status: session.status as OpnameStatus,
      lines: session.lines.map(toLineLike),
    });
    if (!allowed.ok) throw new Error(allowed.reason);

    const current = await currentQtyFor(ctx, {
      tenantId: args.tenantId,
      storeId: session.storeId,
      warehouseId: session.warehouseId,
    });
    const plan = planOpnamePost(
      session.lines.map(toLineLike),
      current,
    );
    const location = session.warehouseId
      ? await ctx.db.get(session.warehouseId)
      : null;
    const locationName = location ? describeWarehouse(location) : defaultWarehouse().name;

    for (const movement of plan.movements) {
      await applyStockChange(ctx, {
        tenantId: args.tenantId,
        storeId: session.storeId,
        productId: movement.productId as Id<"products">,
        warehouseId: session.warehouseId,
        delta: movement.delta,
        reason: "opname",
        refType: "opname",
        refId: session.number,
        note: `Opname ${session.number} · ${locationName} · catatan ${movement.systemQty} → hitung ${movement.countedQty}`,
        actorId: args.actorId,
        // Koreksi opname boleh mengurangi stok di bawah nol? Tidak: kalau hasil
        // hitung lebih kecil dari saldo, deltanya negatif tetapi hasil akhirnya
        // `countedQty ≥ 0`, jadi stok tidak pernah menjadi negatif.
      });
    }

    await ctx.db.patch(args.sessionId, {
      status: "posted",
      postedById: args.actorId,
      postedAt: Date.now(),
    });

    const variance = summariseVariance(session.lines.map(toLineLike));

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "opname.post",
      entity: "opnameSessions",
      entityId: args.sessionId,
      meta: {
        number: session.number,
        location: locationName,
        counted: variance.counted,
        uncounted: variance.uncounted,
        netUnits: variance.netUnits,
        movements: plan.movements.length,
      },
    });

    // Webhook `opname.posted`: selisih hitung fisik adalah kejadian yang ditunggu
    // akuntansi, jadi ia dikirim setelah stoknya benar-benar terkoreksi.
    const enqueuedOpname = await enqueueWebhookEvent(ctx, {
      tenantId: args.tenantId,
      storeId: session.storeId,
      event: "opname.posted",
      subject: session.number,
      data: opnamePostedEventData({
        number: session.number,
        location: locationName,
        counted: variance.counted,
        uncounted: variance.uncounted,
        netUnits: variance.netUnits,
        movements: plan.movements.length,
      }),
    });
    await scheduleWebhookDeliveryPass(ctx, enqueuedOpname);

    return {
      number: session.number,
      locationName,
      /** Baris yang hasil hitungnya berbeda dari catatan (bukti audit). */
      variance,
      /** Gerakan stok yang benar-benar dicatat. */
      movements: plan.movements.map((movement) => ({
        productId: movement.productId,
        name: movement.name,
        systemQty: movement.systemQty,
        currentQty: movement.currentQty,
        countedQty: movement.countedQty,
        delta: movement.delta,
      })),
      unchanged: plan.unchanged,
      netUnits: plan.netUnits,
    };
  },
});

/** Membatalkan sesi yang masih berjalan (salah lokasi, salah hari, dsb). */
export const cancel = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    sessionId: v.id("opnameSessions"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "inventory.manage");

    const session = await loadSessionOrThrow(ctx, args.tenantId, args.sessionId);
    const allowed = canCancelOpname(session.status as OpnameStatus);
    if (!allowed.ok) throw new Error(allowed.reason);

    const reason = args.reason
      ? args.reason.trim().slice(0, MAX_OPNAME_NOTE)
      : undefined;

    await ctx.db.patch(args.sessionId, {
      status: "cancelled",
      cancelledAt: Date.now(),
      note: reason ?? session.note,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "opname.cancel",
      entity: "opnameSessions",
      entityId: args.sessionId,
      meta: { number: session.number, reason },
    });

    return { status: "cancelled" as const };
  },
});

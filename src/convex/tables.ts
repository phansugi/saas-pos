/**
 * Denah meja (modul F&B, `pos.table`) — Phase 2.
 *
 * Meja adalah konfigurasi lantai toko, bukan data transaksi: karena itu setiap
 * penulisannya butuh modul F&B aktif **dan** izin `table.manage` (pemilik /
 * manajer). Kasir memakai meja lewat penjualan (`pos.createSale` dengan
 * `tableId`), bukan dengan mengubah denahnya.
 *
 * Meja bisa ditambah, diubah, dinonaktifkan, **dan dihapus** — tetapi hapus
 * punya pagarnya sendiri (`tableDeletionCheck`): meja yang masih terisi, masih
 * menunggu pembayaran tamu, atau sudah punya riwayat penjualan **ditolak** dan
 * dijawab dengan menonaktifkan. Yang benar-benar dihapus adalah meja yang belum
 * pernah dipakai (mis. salah tambah), supaya riwayat tidak kehilangan mejanya.
 * Status "terisi" juga tidak disimpan di sini; aturannya ada di `lib/fnb.ts`
 * (meja terisi = ada pesanan `held` yang menunjuknya).
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  requireFeature,
  requireMembership,
  writeAuditLog,
} from "./lib/access";
import {
  DEFAULT_TABLE_ZONE,
  nextTableSortOrder,
  planTableImport,
  planTableMove,
  resolveTableInput,
  sortTablesByOrder,
  tableDeletionCheck,
  tableNameTaken,
  type TableRef,
  type TableUsage,
} from "./lib/fnb";
import { isAwaitingPayment, mejaMenuToken } from "./lib/meja";
import { chargeLikeFrom, statusOf } from "./lib/digitalPayment";

type Ctx = QueryCtx | MutationCtx;

/** Bentuk meja yang dikirim ke klien (tanpa perlu impor tipe Convex). */
function toRef(table: Doc<"tables">): TableRef {
  return {
    id: table._id,
    name: table.name,
    zone: table.zone,
    seats: table.seats,
    active: table.active,
    // Token QR ikut terkirim ke anggota: kasir perlu mencetak kartunya, dan
    // tokennya hanya bisa dipakai untuk **membaca** menu satu meja.
    menuToken: table.menuToken,
    sortOrder: table.sortOrder,
  };
}

/**
 * Meja sebuah toko, tersusun untuk denah.
 *
 * Urutannya adalah urutan **yang disimpan** (`sortOrder`, lihat
 * `sortTablesByOrder`) — bukan urutan pembuatan dan bukan urutan nama, supaya
 * denah yang sudah ditata pemiliknya tidak berubah sendiri saat ada meja baru
 * ditambahkan di antaranya. Data lama yang belum punya urutan tetap dibaca
 * dengan aturan lama (zona dulu, lalu nama).
 */
async function tablesForStore(
  ctx: Ctx,
  tenantId: Id<"tenants">,
  storeId: Id<"stores">,
): Promise<Doc<"tables">[]> {
  const rows = await ctx.db
    .query("tables")
    .withIndex("by_tenant_store", (q) =>
      q.eq("tenantId", tenantId).eq("storeId", storeId),
    )
    .collect();
  const byId = new Map(rows.map((row) => [row._id as string, row]));
  return sortTablesByOrder(rows.map(toRef)).map(
    (ref) => byId.get(ref.id) as Doc<"tables">,
  );
}

/** Pesanan terbuka (tertahan) yang menempati sebuah meja, kalau ada. */
async function openOrderOnTable(
  ctx: Ctx,
  tableId: Id<"tables">,
): Promise<Doc<"sales"> | null> {
  const rows = await ctx.db
    .query("sales")
    .withIndex("by_table", (q) => q.eq("tableId", tableId))
    .collect();
  return rows.find((sale) => sale.status === "held") ?? null;
}

/** Denah meja sebuah toko. Dibaca kasir dan layar dapur; anggota saja. */
export const list = query({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.tenantId, args.actorId);
    const rows = await tablesForStore(ctx, args.tenantId, args.storeId);
    return rows.map(toRef);
  },
});

/** Menambah meja ke denah. Butuh modul F&B aktif + izin `table.manage`. */
export const create = mutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
    name: v.string(),
    seats: v.number(),
    zone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, args.tenantId, args.actorId, "pos.table", "table.manage");

    const store = await ctx.db.get(args.storeId);
    if (!store || store.tenantId !== args.tenantId) {
      throw new Error("Toko tidak valid untuk tenant ini.");
    }

    const parsed = resolveTableInput({
      name: args.name,
      seats: args.seats,
      zone: args.zone,
    });
    if (!parsed.ok) throw new Error(parsed.reason ?? "Data meja tidak valid.");

    const existing = await tablesForStore(ctx, args.tenantId, args.storeId);
    const existingRefs = existing.map(toRef);
    if (tableNameTaken(existingRefs, parsed.name)) {
      throw new Error(`Meja ${parsed.name} sudah ada di denah ini.`);
    }

    const tableId = await ctx.db.insert("tables", {
      tenantId: args.tenantId,
      storeId: args.storeId,
      name: parsed.name,
      seats: parsed.seats,
      zone: parsed.zone,
      active: true,
      // Meja baru selalu masuk **di akhir denah**, bukan menyelip di antara meja
      // yang sudah ditata: menambah meja tidak boleh menggeser denah orang.
      sortOrder: nextTableSortOrder(existingRefs),
      createdAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "table.create",
      entity: "tables",
      entityId: tableId,
      meta: { name: parsed.name, seats: parsed.seats, zone: parsed.zone },
    });

    return { tableId, name: parsed.name };
  },
});

/** Ubah nama, jumlah kursi, dan zona sebuah meja. */
export const update = mutation({
  args: {
    tenantId: v.id("tenants"),
    tableId: v.id("tables"),
    actorId: v.id("users"),
    name: v.string(),
    seats: v.number(),
    zone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, args.tenantId, args.actorId, "pos.table", "table.manage");

    const table = await ctx.db.get(args.tableId);
    if (!table || table.tenantId !== args.tenantId) {
      throw new Error("Meja tidak ditemukan untuk tenant ini.");
    }

    const parsed = resolveTableInput({
      name: args.name,
      seats: args.seats,
      zone: args.zone,
    });
    if (!parsed.ok) throw new Error(parsed.reason ?? "Data meja tidak valid.");

    const siblings = await tablesForStore(ctx, args.tenantId, table.storeId);
    if (tableNameTaken(siblings.map(toRef), parsed.name, args.tableId)) {
      throw new Error(`Meja ${parsed.name} sudah ada di denah ini.`);
    }

    await ctx.db.patch(args.tableId, {
      name: parsed.name,
      seats: parsed.seats,
      zone: parsed.zone,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "table.update",
      entity: "tables",
      entityId: args.tableId,
      meta: { before: table.name, after: parsed.name },
    });

    return { tableId: args.tableId, name: parsed.name };
  },
});

/**
 * Menggeser satu meja satu langkah di denah (`step: -1` mundur, `1` maju).
 *
 * Urutannya dihitung **server** dari data yang tersimpan (`planTableMove`),
 * bukan dari daftar yang dikirim klien: denah adalah keadaan bersama satu toko,
 * dan dua perangkat yang menata bersamaan tidak boleh saling menimpa dengan
 * urutan yang salah. Yang disimpan hanya baris yang nilainya benar-benar
 * berubah. Butuh modul F&B aktif + izin `table.manage`, sama seperti menambah
 * meja — menata denah juga mengubah lantai orang lain.
 */
export const move = mutation({
  args: {
    tenantId: v.id("tenants"),
    tableId: v.id("tables"),
    actorId: v.id("users"),
    step: v.number(),
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, args.tenantId, args.actorId, "pos.table", "table.manage");

    const table = await ctx.db.get(args.tableId);
    if (!table || table.tenantId !== args.tenantId) {
      throw new Error("Meja tidak ditemukan untuk tenant ini.");
    }

    const step = args.step < 0 ? -1 : 1;
    const rows = await tablesForStore(ctx, args.tenantId, table.storeId);
    const plan = planTableMove(rows.map(toRef), args.tableId, step);
    if (!plan.ok) throw new Error(plan.reason);

    const current = new Map(rows.map((row) => [row._id as string, row.sortOrder]));
    let changed = 0;
    for (const move of plan.moves) {
      if (current.get(move.id) === move.sortOrder) continue;
      await ctx.db.patch(move.id as Id<"tables">, { sortOrder: move.sortOrder });
      changed += 1;
    }

    if (changed > 0) {
      await writeAuditLog(ctx, {
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: "table.move",
        entity: "tables",
        entityId: args.tableId,
        meta: { name: table.name, step, changed },
      });
    }

    return { tableId: args.tableId, step, changed };
  },
});

/**
 * Menambah **beberapa meja sekaligus** dari teks (satu meja per baris).
 *
 * Teksnya diurai dan diperiksa dengan aturan yang sama dengan halaman
 * (`planTableImport`): semua atau tidak sama sekali, dengan nomor baris pada
 * kalimat penolakannya. Impor hanya menambah — denah yang ada tidak diubah,
 * dan meja barunya masuk berurutan **di belakang** sesuai urutan penulisan,
 * supaya hasilnya bisa ditebak dari teksnya sendiri. Satu impor = satu entri
 * audit, karena satu aksi pengguna.
 */
export const importBatch = mutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, args.tenantId, args.actorId, "pos.table", "table.manage");

    const store = await ctx.db.get(args.storeId);
    if (!store || store.tenantId !== args.tenantId) {
      throw new Error("Toko tidak valid untuk tenant ini.");
    }

    const existing = await tablesForStore(ctx, args.tenantId, args.storeId);
    const plan = planTableImport(existing.map(toRef), args.text);
    if (!plan.ok) throw new Error(plan.reason);

    let order = nextTableSortOrder(existing.map(toRef));
    const now = Date.now();
    const created: string[] = [];
    for (const table of plan.tables) {
      await ctx.db.insert("tables", {
        tenantId: args.tenantId,
        storeId: args.storeId,
        name: table.name,
        seats: table.seats,
        // `planTableImport` sudah menormalkan zonenya (selalu terisi); bawaan ini
        // hanya jaring agar zonenya tidak pernah kosong di baris baru.
        zone: table.zone ?? DEFAULT_TABLE_ZONE,
        active: true,
        sortOrder: order,
        createdAt: now,
      });
      created.push(table.name);
      order += 1;
    }

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "table.import",
      entity: "tables",
      entityId: args.storeId,
      meta: { rows: created.length, names: created.slice(0, 40) },
    });

    return { created: created.length, names: created };
  },
});

/**
 * Aktif/nonaktifkan meja. Meja yang masih menampung pesanan terbuka tidak boleh
 * dimatikan — pesanannya akan kehilangan mejanya di layar dapur.
 */
export const setActive = mutation({
  args: {
    tenantId: v.id("tenants"),
    tableId: v.id("tables"),
    actorId: v.id("users"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, args.tenantId, args.actorId, "pos.table", "table.manage");

    const table = await ctx.db.get(args.tableId);
    if (!table || table.tenantId !== args.tenantId) {
      throw new Error("Meja tidak ditemukan untuk tenant ini.");
    }

    if (!args.active) {
      const open = await openOrderOnTable(ctx, args.tableId);
      if (open) {
        throw new Error(
          `Meja ${table.name} masih terisi pesanan ${open.number}. Selesaikan atau batalkan dulu.`,
        );
      }
    }

    await ctx.db.patch(args.tableId, { active: args.active });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "table.setActive",
      entity: "tables",
      entityId: args.tableId,
      meta: { name: table.name, active: args.active },
    });

    return { tableId: args.tableId, active: args.active };
  },
});

/**
 * Pemakaian sebuah meja: pesanan terbuka, riwayat penjualan, dan tagihan tamu
 * yang masih menunggu dibayar. Dipakai pagar hapus — satu tempat, supaya query
 * pemeriksaannya dan mutation penghapusnya tidak bisa berbeda pendapat.
 */
async function tableUsage(
  ctx: Ctx,
  tableId: Id<"tables">,
): Promise<TableUsage> {
  const sales = await ctx.db
    .query("sales")
    .withIndex("by_table", (q) => q.eq("tableId", tableId))
    .collect();
  const open = sales.find((sale) => sale.status === "held") ?? null;

  const guestOrders = await ctx.db
    .query("mejaOrders")
    .withIndex("by_table", (q) => q.eq("tableId", tableId))
    .collect();

  // Yang menahan hapus meja hanyalah tagihan tamu yang **masih bisa dibayar**
  // (`isAwaitingPayment`): pesanan yang tagihannya sudah dibatalkan kasir (dari
  // halaman Pembayaran) atau kedaluwarsa tidak lagi menunggu apa pun.
  const now = Date.now();
  let pendingGuestOrders = 0;
  for (const order of guestOrders) {
    if (order.status !== "pending") continue;
    const charge = await ctx.db.get(order.chargeId);
    const chargeStatus = charge ? statusOf(chargeLikeFrom(charge), now) : null;
    if (isAwaitingPayment({ status: order.status, chargeStatus })) {
      pendingGuestOrders += 1;
    }
  }

  return {
    openOrders: open ? 1 : 0,
    openOrderNumber: open?.number,
    sales: sales.length,
    pendingGuestOrders,
  };
}

/**
 * Pagar hapus sebuah meja: apa yang menghalangi, tanpa menghapus apa pun.
 * Dipakai dialog konfirmasi di halaman Dapur & Meja supaya kalimatnya sama
 * dengan yang akan dijawab server.
 */
export const deletionCheck = query({
  args: {
    tenantId: v.id("tenants"),
    tableId: v.id("tables"),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.tenantId, args.actorId);

    const table = await ctx.db.get(args.tableId);
    if (!table || table.tenantId !== args.tenantId) {
      throw new Error("Meja tidak ditemukan untuk tenant ini.");
    }

    const usage = await tableUsage(ctx, args.tableId);
    return {
      name: table.name,
      active: table.active,
      usage,
      ...tableDeletionCheck(table.name, usage),
    };
  },
});

/**
 * Menghapus meja dari denah — hanya kalau memang belum pernah dipakai.
 *
 * Pagarnya `tableDeletionCheck`: meja yang masih terisi, masih punya pesanan QR
 * menunggu bayar, atau sudah punya riwayat penjualan ditolak dengan alasannya
 * masing-masing (untuk yang beriwayat: nonaktifkan saja). Meja yang belum pernah
 * dipakai memang tidak dirujuk apa pun, jadi tidak ada yang tertinggal.
 */
export const remove = mutation({
  args: {
    tenantId: v.id("tenants"),
    tableId: v.id("tables"),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, args.tenantId, args.actorId, "pos.table", "table.manage");

    const table = await ctx.db.get(args.tableId);
    if (!table || table.tenantId !== args.tenantId) {
      throw new Error("Meja tidak ditemukan untuk tenant ini.");
    }

    const usage = await tableUsage(ctx, args.tableId);
    const decision = tableDeletionCheck(table.name, usage);
    if (!decision.canDelete) throw new Error(decision.sentence);

    await ctx.db.delete(args.tableId);

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "table.remove",
      entity: "tables",
      entityId: args.tableId,
      meta: { name: table.name, zone: table.zone, seats: table.seats },
    });

    return { tableId: args.tableId, name: table.name };
  },
});

/**
 * Menerbitkan (atau mengganti) token kode QR meja — kode yang ditempel di meja
 * supaya tamu bisa memindai menu workspace ini.
 *
 * Dua hal yang disengaja:
 *
 *  - **Idempoten tanpa `rotate`.** Menekan "Tampilkan QR" berkali-kali tidak
 *    boleh membuat kartu yang sudah tercetak mati diam-diam; tokennya cuma
 *    dibuat sekali per meja, dan penggantian harus diminta eksplisit.
 *  - **Meja nonaktif tidak diterbitkan kode.** Kartu QR yang masih menempel di
 *    meja yang sedang diperbaiki akan menawarkan menu yang pesanannya tidak
 *    mungkin dilayani — jadi tokennya hanya diberikan untuk meja aktif.
 *
 * Tokennya acak (`crypto.randomUUID`), bukan turunan `tableId`: kode yang difoto
 * tamu tidak boleh bisa dipakai menebak meja lain, dan mengganti kode (rotate)
 * adalah satu-satunya cara mencabut kartu yang hilang.
 */
export const issueMenuQr = mutation({
  args: {
    tenantId: v.id("tenants"),
    tableId: v.id("tables"),
    actorId: v.id("users"),
    /** Ganti token yang sudah ada; kartu lama langsung tidak berlaku. */
    rotate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, args.tenantId, args.actorId, "pos.table", "table.manage");

    const table = await ctx.db.get(args.tableId);
    if (!table || table.tenantId !== args.tenantId) {
      throw new Error("Meja tidak ditemukan untuk tenant ini.");
    }
    if (!table.active) {
      throw new Error(
        `Meja ${table.name} sedang nonaktif; aktifkan dulu sebelum mencetak kode QR-nya.`,
      );
    }

    const rotate = args.rotate === true && Boolean(table.menuToken);
    if (table.menuToken && !rotate) {
      return { tableId: args.tableId, token: table.menuToken, rotated: false };
    }

    const token = mejaMenuToken(crypto.randomUUID());
    await ctx.db.patch(args.tableId, { menuToken: token });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: rotate ? "table.menuQrRotate" : "table.menuQr",
      entity: "tables",
      entityId: args.tableId,
      meta: { name: table.name, rotated: rotate },
    });

    return { tableId: args.tableId, token, rotated: rotate };
  },
});

/**
 * Pesanan QR meja (modul F&B) — backend.
 *
 * Alur lengkapnya: tamu memindai kartu QR di mejanya → halaman tamu memuat menu
 * toko yang sama dengan katalog kasir → tamu memilih menu **dan cara bayarnya
 * (QRIS dipindai, atau Virtual Account bank pilihan)** → server menerbitkan
 * **tagihan digital** senilai total pesanan dan menahan isi pesanannya → tamu
 * membayar → begitu tagihannya lunas (`payments.act`), pesanan itu baru menjadi
 * **penjualan tertahan**: tiketnya masuk antrean dapur, dan penjualannya menunjuk
 * tagihan yang sudah lunas.
 *
 * Empat pagar yang disengaja:
 *
 * 1. **Tagihan dulu, penjualan kemudian.** Tidak ada tiket dapur (apalagi stok
 *    yang bergerak) sebelum uangnya tercatat masuk — tamu yang menutup halaman
 *    sebelum membayar tidak meninggalkan penjualan hantu.
 * 2. **Harga & total dari server.** Ponsel tamu hanya mengirim `productId` dan
 *    jumlah; harga, pajak, dan biaya layanan dihitung ulang di sini dari baris
 *    produk & setelan tenant, jadi nominal tagihan tidak bisa dititipkan dari
 *    luar (`validateGuestCart` + `orderTotal`).
 * 3. **Token rahasia, bukan id.** Meja ditunjuk token `mj_…` yang hanya bisa
 *    diterbitkan izin `table.manage`, dan status pesanan ditanyakan dengan token
 *    `mjo_…` per pesanan — halaman tamu tidak pernah bisa menyebut id Convex.
 * 4. **Satu meja satu pesanan terbuka.** Pesanan tamu ikut aturan `seatTable`
 *    yang sama dengan kasir, supaya dua pesanan ke satu meja tidak menumpuk.
 */

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  entitlementsForTenant,
  getTenantOrThrow,
  nextSequence,
  requireMembership,
  requirePermission,
  requireSalesAllowed,
  writeAuditLog,
} from "./lib/access";
import { PLANS } from "./lib/billing";
import { fnbTaxProfileOf, orderTotal } from "./lib/fnbTax";
import { taxSettingOf } from "./lib/tax";
import {
  DIGITAL_REASON_MAX,
  applyChargeAction,
  chargeLikeFrom,
  chargeNumber,
  expiryAtFor,
  normalizeReference,
  qrPayload,
  remainingSeconds,
  statusOf,
  validateChargeInput,
  virtualAccountNumber,
  type DigitalAction,
  type DigitalChargeLike,
  type DigitalMethod,
  type DigitalStatus,
  type VaBank,
} from "./lib/digitalPayment";
import { seatTable, tableLabel, type TableRef } from "./lib/fnb";
import {
  GUEST_MAX_LINES,
  GUEST_MAX_QTY_PER_ITEM,
  GUEST_MAX_UNITS,
  GUEST_NAME_MAX,
  guestBankOptions,
  guestCancelCheck,
  guestChargeReference,
  guestPayOptions,
  guestPaymentInstruction,
  guestPaymentMethod,
  guestTaxRulesFrom,
  isMejaMenuToken,
  isMejaWatchToken,
  mejaUnavailableReason,
  mejaWatchToken,
  normalizeGuestName,
  validateGuestCart,
  type GuestProduct,
} from "./lib/meja";

type Ctx = QueryCtx | MutationCtx;

/** Berapa lama pesanan tamu yang sudah lunas masih ditampilkan ke kasir. */
const MEJA_ORDER_HISTORY_MS = 12 * 60 * 60 * 1000;
const MEJA_ORDER_LIST_MAX = 50;

/** Satu baris katalog tamu: produk apa adanya + stok di lokasi jual toko. */
interface GuestCatalogRow extends GuestProduct {
  categoryId: string | null;
  imageId: Id<"_storage"> | null;
}

/** Meja yang ditunjuk sebuah token QR. `null` = token tidak dikenal. */
async function tableByToken(ctx: Ctx, token: string): Promise<Doc<"tables"> | null> {
  const trimmed = (token ?? "").trim();
  if (!isMejaMenuToken(trimmed)) return null;
  return await ctx.db
    .query("tables")
    .withIndex("by_menu_token", (q) => q.eq("menuToken", trimmed))
    .unique();
}

type MejaGate =
  | { ok: true; table: Doc<"tables">; tenant: Doc<"tenants"> }
  | { ok: false; reason: string };

/**
 * Meja + tenant + gerbang fiturnya untuk sebuah token. Dikembalikan sebagai
 * hasil, bukan lemparan: halaman tamu harus bisa mengatakan **kenapa** menunya
 * tidak hidup (modul F&B mati, paket tidak memuat, meja nonaktif) — pesan galat
 * mentah Convex tidak berguna di ponsel tamu.
 */
async function resolveMeja(ctx: Ctx, token: string): Promise<MejaGate> {
  const table = await tableByToken(ctx, token);
  if (!table) {
    return {
      ok: false,
      reason:
        "Kode QR ini tidak dikenal. Pastikan Anda memindai kartu yang ada di meja, atau tanyakan pelayan.",
    };
  }
  if (!table.active) {
    return {
      ok: false,
      reason: `Meja ${table.name} sedang tidak aktif; tanyakan pelayan untuk tempat lain.`,
    };
  }

  const tenant = await getTenantOrThrow(ctx, table.tenantId);
  const reason = mejaUnavailableReason(entitlementsForTenant(tenant), tenant.verticals);
  if (reason) return { ok: false, reason };

  return { ok: true, table, tenant };
}

function toTableRef(table: Doc<"tables">): TableRef {
  return {
    id: table._id,
    name: table.name,
    zone: table.zone,
    seats: table.seats,
    active: table.active,
    menuToken: table.menuToken,
  };
}

/**
 * Katalog yang boleh dilihat tamu: produk sebuah toko beserta stok di lokasi
 * jualnya. Harga selalu dari baris produk ini — ponsel tamu tidak pernah
 * mengirim harga.
 */
async function guestCatalog(
  ctx: Ctx,
  tenantId: Id<"tenants">,
  storeId: Id<"stores">,
): Promise<GuestCatalogRow[]> {
  const products = await ctx.db
    .query("products")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();

  const levels = await ctx.db
    .query("stockLevels")
    .withIndex("by_tenant_store", (q) =>
      q.eq("tenantId", tenantId).eq("storeId", storeId),
    )
    .collect();

  // Hanya lokasi jual (bucket tanpa `warehouseId`) yang dihitung — sama dengan
  // katalog kasir: stok gudang belum bisa dijual sampai dipindahkan.
  const stockByProduct = new Map(
    levels
      .filter((level) => level.warehouseId === undefined)
      .map((level) => [level.productId as string, level.quantity]),
  );

  return products.map((product) => ({
    id: product._id as string,
    name: product.name,
    price: product.price,
    active: product.active,
    trackStock: product.trackStock,
    stock: stockByProduct.get(product._id as string) ?? 0,
    categoryId: (product.categoryId as string | undefined) ?? null,
    imageId: product.images?.[0] ?? null,
  }));
}

/**
 * Menu yang dilihat tamu: dikelompokkan per kategori (urutan kategori dari
 * setelan, sama seperti tab di kasir). Yang habis tetap dikirim dengan
 * `available: false` supaya tampil "habis", bukan menghilang diam-diam.
 */
export const menu = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const resolved = await resolveMeja(ctx, args.token);
    if (!resolved.ok) return { ok: false as const, reason: resolved.reason };
    const { table, tenant } = resolved;

    const store = await ctx.db.get(table.storeId);
    const catalog = await guestCatalog(ctx, tenant._id, table.storeId);
    const categories = (
      await ctx.db
        .query("categories")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
        .collect()
    )
      .filter((category) => category.active !== false)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const nameByCategory = new Map(
      categories.map((category) => [category._id as string, category.name]),
    );
    const groupNames = [
      ...categories.map((category) => category.name),
      "Menu lain",
    ];
    const groups = groupNames.map((name) => ({
      name,
      items: [] as {
        id: string;
        name: string;
        price: number;
        available: boolean;
        /** Sisa porsi kalau stoknya dilacak; `null` = tidak dilacak. */
        stock: number | null;
        imageUrl: string | null;
      }[],
    }));
    const groupIndex = new Map(groups.map((group, index) => [group.name, index]));

    const visible = catalog
      .filter((product) => product.active)
      .sort((a, b) => a.name.localeCompare(b.name, "id"));

    for (const product of visible) {
      const categoryName = product.categoryId
        ? nameByCategory.get(product.categoryId) ?? "Menu lain"
        : "Menu lain";
      const index = groupIndex.get(categoryName) ?? groups.length - 1;
      groups[index].items.push({
        id: product.id,
        name: product.name,
        price: product.price,
        available: !product.trackStock || product.stock > 0,
        stock: product.trackStock ? product.stock : null,
        imageUrl: product.imageId ? await ctx.storage.getUrl(product.imageId) : null,
      });
    }

    return {
      ok: true as const,
      business: tenant.name,
      storeName: store?.name ?? "",
      tableLabel: tableLabel(table),
      /**
       * Logo merchant untuk header halaman tamu — berkas yang sama dengan logo
       * struk, diterjemahkan jadi URL baca-saja. Tanpa sesi pun aman: yang bisa
       * membaca menunya hanyalah pemegang kartu QR meja (`mj_…`).
       */
      logoUrl: tenant.logo ? await ctx.storage.getUrl(tenant.logo) : null,
      groups: groups.filter((group) => group.items.length > 0),
      tax: guestTaxRulesFrom(taxSettingOf(tenant), fnbTaxProfileOf(tenant.fnbTaxProfile)),
      /** Cara bayar yang boleh dipilih tamu — satu sumber dengan halamannya. */
      payment: {
        methods: guestPayOptions(),
        banks: guestBankOptions(),
      },
      limits: {
        maxLines: GUEST_MAX_LINES,
        maxQtyPerItem: GUEST_MAX_QTY_PER_ITEM,
        maxUnits: GUEST_MAX_UNITS,
        nameMax: GUEST_NAME_MAX,
      },
    };
  },
});

/**
 * Menerima pesanan tamu: membuat **tagihan QRIS** senilai totalnya, lalu menahan
 * isi pesanannya di `mejaOrders`. Penjualan & tiket dapurnya baru lahir saat
 * tagihannya lunas (`guestOrderPaid`), jadi tidak ada penjualan yang tidak
 * pernah dibayar.
 */
export const order = mutation({
  args: {
    token: v.string(),
    items: v.array(
      v.object({
        // Sengaja `string`, bukan `v.id("products")`: id yang tidak dikenal
        // harus dijawab kalimat yang bisa dibaca tamu, bukan galat validasi.
        productId: v.string(),
        quantity: v.number(),
      }),
    ),
    guestName: v.optional(v.string()),
    /**
     * Cara bayar yang dipilih tamu (`qris` bawaan, atau `va`). Sengaja `string`,
     * bukan union: pilihan yang tidak dikenal harus dijawab kalimat yang bisa
     * dibaca tamu, bukan galat validasi Convex.
     */
    method: v.optional(v.string()),
    /** Bank penerbit Virtual Account; wajib untuk `va`, kosong untuk `qris`. */
    bank: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const resolved = await resolveMeja(ctx, args.token);
    if (!resolved.ok) return { ok: false as const, reason: resolved.reason };
    const { table, tenant } = resolved;

    // Pesanan tamu (nanti) menjadi penjualan: langganan harus boleh mencatat
    // penjualan baru, sama seperti kasir.
    await requireSalesAllowed(ctx, tenant._id);

    const catalog = await guestCatalog(ctx, tenant._id, table.storeId);
    const validated = validateGuestCart(args.items, catalog);
    if (!validated.ok) return { ok: false as const, reason: validated.reason };
    const { lines, subtotal } = validated.value;

    // Cara bayar tamu divalidasi **sebelum** apa pun tersimpan: pesanan dengan
    // metode/bank yang tidak dikenal ditolak utuh, bukan separuh jadi.
    const pay = guestPaymentMethod({ method: args.method, bank: args.bank });
    if (!pay.ok) return { ok: false as const, reason: pay.reason };

    /*
      Satu meja satu pesanan terbuka. Di sini yang dihitung **hanya pesanan
      tertahan**, bukan seluruh tiket dapur seperti `pos.createSale`: yang sedang
      diperiksa adalah tamu yang duduk di meja itu dan memesan lewat kartu QR —
      mereka boleh memesan giliran berikutnya selama tidak ada tagihan yang masih
      terbuka di meja yang sama. Kunci meja "sampai dapur menekan Selesai"
      berlaku untuk **pemilihan meja oleh kasir**, tempat dua transaksi berbeda
      bisa tercampur di satu meja.
    */
    const onTable = await ctx.db
      .query("sales")
      .withIndex("by_table", (q) => q.eq("tableId", table._id))
      .collect();
    const seat = seatTable(
      [toTableRef(table)],
      onTable
        .filter((sale) => sale.status === "held")
        .map((sale) => ({
          id: sale._id,
          number: sale.number,
          createdAt: sale.createdAt,
          tableId: sale.tableId,
        })),
      table._id,
    );
    if (!seat.ok) return { ok: false as const, reason: seat.reason };

    const totals = orderTotal({
      net: subtotal,
      ppn: taxSettingOf(tenant),
      fnb: fnbTaxProfileOf(tenant.fnbTaxProfile),
    });
    const now = Date.now();
    const draft = validateChargeInput(
      {
        amount: totals.total,
        method: pay.value.method,
        bank: pay.value.bank,
        reference: guestChargeReference(table.name, lines),
      },
      { digital: true, planName: PLANS[tenant.planKey].name },
    );
    if (!draft.ok) return { ok: false as const, reason: draft.reason };

    const sequence = await nextSequence(ctx, tenant._id, "digital-charge");
    const number = chargeNumber(sequence, new Date(now).getFullYear());
    const expiresAt = expiryAtFor(draft.value.method, now);
    // Virtual Account memakai nomor turunan bank + urutan tagihannya; QRIS memakai
    // payload deterministik dari nomor + nominal, jadi kode yang digambar di
    // ponsel tamu persis sama dengan yang tercatat di baris tagihannya.
    const vaNumber =
      draft.value.method === "va" && draft.value.bank
        ? virtualAccountNumber(draft.value.bank, sequence)
        : undefined;
    const payload =
      draft.value.method === "qris"
        ? qrPayload({
            number,
            amount: totals.total,
            merchantName: tenant.name,
          })
        : undefined;

    const chargeId = await ctx.db.insert("digitalCharges", {
      tenantId: tenant._id,
      storeId: table.storeId,
      number,
      method: draft.value.method,
      bank: draft.value.bank ?? undefined,
      amount: draft.value.amount,
      reference: draft.value.reference ?? undefined,
      vaNumber,
      qrPayload: payload,
      status: "pending",
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    const watchToken = mejaWatchToken(crypto.randomUUID());
    const guestName = normalizeGuestName(args.guestName);
    const orderId = await ctx.db.insert("mejaOrders", {
      tenantId: tenant._id,
      storeId: table.storeId,
      tableId: table._id,
      tableName: table.name,
      watchToken,
      /** Cara bayar yang dipilih tamu + nomor VA-nya (kalau memilih VA). */
      method: draft.value.method,
      bank: draft.value.bank ?? undefined,
      vaNumber,
      lines: lines.map((line) => ({
        productId: line.productId as Id<"products">,
        name: line.name,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        lineTotal: line.lineTotal,
      })),
      subtotal,
      tax: totals.tax,
      taxRatePct: totals.plan.ratePct,
      taxKind: totals.plan.kind,
      serviceCharge: totals.serviceCharge,
      total: totals.total,
      guestName: guestName || undefined,
      chargeId,
      chargeNumber: number,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    await writeAuditLog(ctx, {
      tenantId: tenant._id,
      action: "meja.order",
      entity: "mejaOrders",
      entityId: orderId,
      meta: {
        table: table.name,
        charge: number,
        total: totals.total,
        method: draft.value.method,
        bank: draft.value.bank ?? null,
        units: lines.reduce((sum, line) => sum + line.quantity, 0),
        guestName: guestName || null,
      },
    });

    return {
      ok: true as const,
      orderId,
      watchToken,
      tableLabel: tableLabel(table),
      business: tenant.name,
      guestName: guestName || null,
      subtotal,
      total: totals.total,
      lines: totals.lines,
      charge: {
        id: chargeId,
        number,
        method: draft.value.method,
        bank: draft.value.bank,
        vaNumber: vaNumber ?? null,
        qrPayload: payload ?? null,
        expiresAt,
        expiryMinutes: Math.max(1, Math.round((expiresAt - now) / 60_000)),
      },
      instruction: guestPaymentInstruction({
        method: draft.value.method,
        bank: draft.value.bank,
        amount: totals.total,
        vaNumber: vaNumber ?? null,
        qrPayload: payload ?? null,
      }),
    };
  },
});

/**
 * Status satu pesanan tamu, dibaca ponsel tamu dengan token pemantaunya. Yang
 * dijawab hanya pesanan itu sendiri — tidak ada daftar, tidak ada meja lain.
 */
export const status = query({
  args: { watch: v.string() },
  handler: async (ctx, args) => {
    const watch = (args.watch ?? "").trim();
    if (!isMejaWatchToken(watch)) {
      return { ok: false as const, reason: "Tautan status pesanan tidak dikenal." };
    }
    const order = await ctx.db
      .query("mejaOrders")
      .withIndex("by_watch", (q) => q.eq("watchToken", watch))
      .unique();
    if (!order) {
      return { ok: false as const, reason: "Pesanan tidak ditemukan." };
    }

    const charge = await ctx.db.get(order.chargeId);
    const like: DigitalChargeLike | null = charge ? chargeLikeFrom(charge) : null;
    const now = Date.now();
    const chargeStatus: DigitalStatus = like ? statusOf(like, now) : "cancelled";
    const method: DigitalMethod = (order.method as DigitalMethod | undefined) ?? "qris";
    const bank = (order.bank as VaBank | undefined) ?? null;
    // Nomor VA & payload hanya berarti selama tagihannya masih menunggu; begitu
    // lunas (atau kedaluwarsa), yang ditampilkan adalah hasilnya, bukan kodenya.
    const vaNumber =
      chargeStatus === "pending" ? (charge?.vaNumber ?? order.vaNumber ?? null) : null;
    const qrPayload = chargeStatus === "pending" ? charge?.qrPayload ?? null : null;

    return {
      ok: true as const,
      status: order.status,
      chargeStatus,
      chargeNumber: order.chargeNumber,
      method,
      bank,
      vaNumber,
      instruction: guestPaymentInstruction({
        method,
        bank,
        amount: order.total,
        vaNumber,
        qrPayload,
      }),
      tableLabel: order.tableName,
      guestName: order.guestName ?? null,
      subtotal: order.subtotal,
      tax: order.tax,
      serviceCharge: order.serviceCharge,
      total: order.total,
      lines: order.lines,
      saleNumber: order.saleNumber ?? null,
      paidAt: order.paidAt ?? null,
      expiresAt: charge?.expiresAt ?? null,
      remainingSeconds: like ? remainingSeconds(like, now) : 0,
      qrPayload,
    };
  },
});

/**
 * Daftar pesanan QR meja untuk kasir & layar dapur: yang masih menunggu
 * pembayaran (berapa pun umurnya) plus yang sudah lunas dalam 12 jam terakhir.
 * Halaman Pembayaran memakainya untuk mengenali tagihan pesanan QR (dan
 * melunasinya di sana), sementara layar Dapur & Meja memakainya sebagai penanda
 * kanal + momen pelunasan tiket — pesanan yang belum lunas tidak tampil sebagai
 * antrean dapur. Cukup keanggotaan: denah meja & antrean dapur memang dibaca
 * kasir; aksi melunasi & membatalkan tetap diperiksa izinnya masing-masing.
 */
export const listOrders = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.tenantId, args.actorId);

    const rows = await ctx.db
      .query("mejaOrders")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const charges = await ctx.db
      .query("digitalCharges")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const chargeById = new Map(charges.map((charge) => [charge._id as string, charge]));

    const now = Date.now();
    return rows
      .filter(
        (row) =>
          row.status === "pending" ||
          (row.paidAt !== undefined && now - row.createdAt <= MEJA_ORDER_HISTORY_MS),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MEJA_ORDER_LIST_MAX)
      .map((row) => {
        const charge = chargeById.get(row.chargeId as string) ?? null;
        const like = charge ? chargeLikeFrom(charge) : null;
        return {
          id: row._id as string,
          tableId: row.tableId as string,
          tableName: row.tableName,
          guestName: row.guestName ?? null,
          lines: row.lines.map((line) => ({
            name: line.name,
            quantity: line.quantity,
            lineTotal: line.lineTotal,
          })),
          subtotal: row.subtotal,
          tax: row.tax,
          serviceCharge: row.serviceCharge,
          total: row.total,
          status: row.status,
          chargeId: row.chargeId as string,
          chargeNumber: row.chargeNumber,
          chargeStatus: like ? statusOf(like, now) : null,
          method: (row.method as DigitalMethod | undefined) ?? "qris",
          bank: (row.bank as VaBank | undefined) ?? null,
          vaNumber: row.vaNumber ?? null,
          expiresAt: charge?.expiresAt ?? null,
          remainingSeconds: like ? remainingSeconds(like, now) : 0,
          saleId: (row.saleId as string | undefined) ?? null,
          saleNumber: row.saleNumber ?? null,
          paidAt: row.paidAt ?? null,
          createdAt: row.createdAt,
        };
      });
  },
});

/**
 * Tagihan pesanan tamu **lunas** → pesanan itu menjadi penjualan tertahan.
 *
 * Dipanggil `payments.act` setiap kali sebuah tagihan ditandai lunas — dari
 * halaman Pembayaran (tempat kasir melunasi/membatalkan pesanan QR yang belum
 * dibayar), atau dari jalur lain yang memakai tagihan yang sama — jadi satu
 * pelunasan tidak pernah melewatkan penjualannya. Penandaan `paidAt` di baris
 * pesanannya memakai `now` yang sama dengan `createdAt` penjualannya, jadi tiket
 * dapur bisa menyebut momen pelunasannya sebagai momen tiket itu diterima.
 * Penjualan yang dibuat di sini menunjuk tagihan yang memang sudah lunas, sesuai
 * aturan `checkSaleAgainstCharge`.
 *
 * Angka pesanannya **dipakai apa adanya** dari baris `mejaOrders`: tagihannya
 * sudah dibayar dengan angka itu, jadi mengubah setelan pajak setelahnya tidak
 * boleh menulis ulang nota yang sudah dibayar.
 */
export const guestOrderPaid = internalMutation({
  args: { chargeId: v.id("digitalCharges") },
  handler: async (ctx, args) => {
    const order = await ctx.db
      .query("mejaOrders")
      .withIndex("by_charge", (q) => q.eq("chargeId", args.chargeId))
      .unique();
    if (!order || order.status !== "pending") return null;

    const now = Date.now();
    const seq = await nextSequence(ctx, order.tenantId, "sale");
    const number = `A-${String(seq).padStart(5, "0")}`;

    const saleId = await ctx.db.insert("sales", {
      tenantId: order.tenantId,
      storeId: order.storeId,
      number,
      status: "held",
      subtotal: order.subtotal,
      discount: 0,
      tax: order.tax,
      taxRatePct: order.taxRatePct,
      taxKind: order.taxKind,
      serviceCharge: order.serviceCharge,
      total: order.total,
      // Tamu sudah membayar tepat sebesar totalnya, lewat kanal yang **dipilihnya
      // saat memesan**: QRIS dipindai, Virtual Account lewat transfer bank —
      // `saleMethodMatchesCharge` menerima keduanya untuk tagihan VA, sedangkan
      // pesanan lama yang belum menyimpan metodenya tetap dibaca QRIS.
      payments: [
        {
          method: order.method === "va" ? "transfer" : "qris",
          amount: order.total,
        },
      ],
      idempotencyKey: `meja-${order._id}`,
      tableId: order.tableId,
      digitalChargeId: order.chargeId,
      createdAt: now,
    });

    for (const line of order.lines) {
      await ctx.db.insert("saleItems", {
        tenantId: order.tenantId,
        saleId,
        productId: line.productId,
        name: line.name,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        lineTotal: line.lineTotal,
      });
    }

    await ctx.db.patch(order.chargeId, { saleId, saleNumber: number });
    await ctx.db.patch(order._id, {
      status: "paid",
      paidAt: now,
      saleId,
      saleNumber: number,
      updatedAt: now,
    });

    await writeAuditLog(ctx, {
      tenantId: order.tenantId,
      action: "meja.paid",
      entity: "mejaOrders",
      entityId: order._id,
      meta: {
        table: order.tableName,
        charge: order.chargeNumber,
        sale: number,
        total: order.total,
      },
    });

    return { orderId: order._id, saleId, number };
  },
});

/**
 * Membatalkan pesanan **dari ponsel tamunya sendiri**, lewat token pemantau
 * (`mjo_…`) — bukan dari halaman kasir.
 *
 * Pembeli bisa berubah pikiran sebelum uangnya masuk, dan yang dilakukannya
 * hanyalah membatalkan pesanannya sendiri: aturan `guestCancelCheck` memastikan
 * tagihannya belum lunas, tagihan yang masih menunggu ikut dimatikan (agar kode
 * bayarnya tidak bisa dipakai membayar pesanan yang sudah dibatalkan), dan yang
 * sudah kedaluwarsa tidak perlu diubah apa-apa.
 *
 * Tanpa aktor (ponsel tamu tidak punya akun) tetapi juga tanpa kebocoran: yang
 * bisa dibatalkan hanyalah pesanan yang tokennya dipegang pemanggil.
 */
export const cancelOwnOrder = mutation({
  args: { watch: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const watch = (args.watch ?? "").trim();
    if (!isMejaWatchToken(watch)) {
      return { ok: false as const, reason: "Tautan status pesanan tidak dikenal." };
    }
    const order = await ctx.db
      .query("mejaOrders")
      .withIndex("by_watch", (q) => q.eq("watchToken", watch))
      .unique();
    if (!order) return { ok: false as const, reason: "Pesanan tidak ditemukan." };

    const charge = await ctx.db.get(order.chargeId);
    const like: DigitalChargeLike | null = charge ? chargeLikeFrom(charge) : null;
    const now = Date.now();
    const chargeStatus: DigitalStatus = like ? statusOf(like, now) : "cancelled";

    const allowed = guestCancelCheck({
      status: order.status,
      chargeStatus,
      saleNumber: order.saleNumber ?? null,
    });
    if (!allowed.ok) return { ok: false as const, reason: allowed.reason };

    const reason = normalizeReference(args.reason ?? "").slice(0, DIGITAL_REASON_MAX);
    let chargeCancelled = false;
    if (like) {
      const action = applyChargeAction(like, "cancel" as DigitalAction, {
        now,
        reason: reason || "Dibatalkan tamu dari halaman meja",
      });
      if (action.ok) {
        await ctx.db.patch(order.chargeId, {
          status: action.value.status,
          paidAmount: action.value.paidAmount ?? undefined,
          paidAt: action.value.paidAt ?? undefined,
          cancelReason: action.value.cancelReason ?? undefined,
          cancelledAt: action.value.cancelledAt ?? undefined,
          updatedAt: now,
        });
        chargeCancelled = true;
      }
    }

    await ctx.db.patch(order._id, { status: "cancelled", updatedAt: now });

    await writeAuditLog(ctx, {
      tenantId: order.tenantId,
      action: "meja.cancelOwn",
      entity: "mejaOrders",
      entityId: order._id,
      meta: {
        table: order.tableName,
        charge: order.chargeNumber,
        total: order.total,
        chargeCancelled,
        reason: reason || null,
      },
    });

    return { ok: true as const, cancelled: true, chargeCancelled };
  },
});

/**
 * Membatalkan pesanan tamu yang tagihannya tidak akan dibayar (tamu pergi, salah
 * pesan, kanal bayar bermasalah). Tagihannya **tidak** ikut dibatalkan di sini —
 * itu aksi `payments.act` dengan alasannya sendiri — karena yang dibatalkan di
 * baris ini hanyalah niat pesanannya, dan tidak ada penjualan yang perlu
 * dibalik: penjualannya memang belum pernah dibuat.
 */
export const cancelOrder = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    orderId: v.id("mejaOrders"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "payment.manage");

    const order = await ctx.db.get(args.orderId);
    if (!order || order.tenantId !== args.tenantId) {
      throw new Error("Pesanan QR tidak ditemukan untuk tenant ini.");
    }
    if (order.status === "paid") {
      throw new Error(
        `Pesanan meja ${order.tableName} sudah lunas (${order.saleNumber ?? order.chargeNumber}); batalkan dari sisi penjualannya, bukan dari sini.`,
      );
    }
    if (order.status === "cancelled") {
      return { orderId: order._id, cancelled: false };
    }

    const now = Date.now();
    await ctx.db.patch(order._id, { status: "cancelled", updatedAt: now });
    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "meja.cancel",
      entity: "mejaOrders",
      entityId: order._id,
      meta: {
        table: order.tableName,
        charge: order.chargeNumber,
        reason: (args.reason ?? "").slice(0, 120) || null,
      },
    });

    return { orderId: order._id, cancelled: true };
  },
});

import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  applyStockChange,
  entitlementsForTenant,
  nextSequence,
  requireFeature,
  requireMembership,
  requirePermission,
  requireSalesAllowed,
  writeAuditLog,
} from "./lib/access";
import {
  creditFromPayment,
  decideCredit,
  dueDateFrom,
  rupiah as formatRupiah,
  type ReceivableLike,
} from "./lib/ar";
import { taxSettingOf } from "./lib/tax";
import { fnbTaxProfileOf, orderTotal } from "./lib/fnbTax";
import {
  chargeLikeFrom,
  checkSaleAgainstCharge,
} from "./lib/digitalPayment";
import { discountBreakdown } from "./lib/loyalty";
import { isFeatureEnabled, isModuleActive } from "./lib/billing/modules";
import {
  fireKitchenOnSale,
  isKitchenTicket,
  kdsQueue,
  seatTable,
  tableHolders,
  ticketPaidLabel,
  type KdsTicketItem,
} from "./lib/fnb";
import {
  applyModifiers,
  hasModifiers,
  lineTotalWithModifiers,
} from "./lib/modifiers";
import { priceLine, usesWholesale } from "./lib/wholesale";
import {
  saleCompletedEventData,
  saleVoidedEventData,
  stockCrossedLow,
  stockLowEventData,
} from "./lib/webhookEvents";
import {
  enqueueWebhookEvent,
  scheduleWebhookDeliveryPass,
} from "./lib/webhookOutbox";
import { queueMarketplaceSalePush } from "./lib/marketplaceSaleQueue";
import { paymentValidator } from "./schema";

const saleStatusValidator = v.union(
  v.literal("completed"),
  v.literal("held"),
);

interface ModifierSelectionInput {
  groupCode: string;
  optionCodes: string[];
}

/**
 * Satu baris keranjang. `unitCode` dari modul Grosir (mis. "DUS") dan
 * `modifiers` dari modul F&B (mis. level pedas + topping).
 */
const saleItemValidator = v.object({
  productId: v.id("products"),
  quantity: v.number(),
  unitCode: v.optional(v.string()),
  modifiers: v.optional(
    v.array(
      v.object({ groupCode: v.string(), optionCodes: v.array(v.string()) }),
    ),
  ),
});

type SaleItemInput = {
  productId: Id<"products">;
  quantity: number;
  unitCode?: string;
  modifiers?: ModifierSelectionInput[];
};

interface ResolvedLine {
  productId: Id<"products">;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  trackStock: boolean;
  /** Label modifier siap tampil di struk & layar dapur. */
  modifierLabels: string[];
}

async function resolveLines(
  ctx: { db: { get: (id: Id<"products">) => Promise<Doc<"products"> | null> } },
  tenantId: Id<"tenants">,
  items: SaleItemInput[],
  wholesaleActive: boolean,
  modifiersActive: boolean,
): Promise<{ lines: ResolvedLine[]; subtotal: number }> {
  if (items.length === 0) throw new Error("Keranjang kosong.");

  const lines: ResolvedLine[] = [];
  let subtotal = 0;

  for (const item of items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error("Kuantitas setiap item harus lebih dari 0.");
    }
    const product = await ctx.db.get(item.productId);
    if (!product || product.tenantId !== tenantId) {
      throw new Error("Produk tidak valid untuk tenant ini.");
    }

    // Produk nonaktif tidak dijual lagi (`products.setActive`): kasir sudah tidak
    // ditawari produknya, dan permintaan langsung dari perangkat lama pun ditolak
    // di sini — supaya "nonaktif" bukan sekadar tampilan.
    if (!product.active) {
      throw new Error(
        `Produk ${product.name} sedang nonaktif; aktifkan dulu di halaman Produk & Stok kalau memang masih dijual.`,
      );
    }

    // Produk bergrosir tidak boleh diam-diam dijual dengan harga dasar ketika
    // modul Grosir mati: itu mengubah harga pelanggan tanpa diminta. Lebih baik
    // menolak transaksinya dengan pesan yang bisa ditindaklanjuti.
    if (!wholesaleActive && usesWholesale(product)) {
      throw new Error(
        `Produk ${product.name} memakai harga bertingkat/satuan grosir; aktifkan modul Grosir dulu di halaman Modul.`,
      );
    }

    // Modifier adalah fitur modul F&B. Produk yang punya grup modifier ditolak
    // saat modulnya mati — sama seperti produk grosir — supaya pilihan pelanggan
    // tidak hilang diam-diam dari pesanannya.
    if (!modifiersActive && hasModifiers(product)) {
      throw new Error(
        `Produk ${product.name} memakai modifier item; aktifkan modul Food & Beverage dulu di halaman Modul.`,
      );
    }

    // Satu perhitungan dengan klien: konversi satuan dulu, lalu tier atas
    // kuantitas dalam satuan dasar.
    const priced = priceLine({
      product: {
        price: product.price,
        tiers: product.tiers,
        unit: product.unit,
        units: product.units,
      },
      quantity: item.quantity,
      unitCode: item.unitCode,
    });

    // Modifier divalidasi ulang di server (grup wajib, batas pilihan, opsi asing)
    // dan tambahan harganya dihitung per unit yang dijual — bukan per satuan
    // dasar, supaya satu Dus 24 Pcs tidak mengalikan topping 24×.
    const modifiers = applyModifiers(product, item.modifiers ?? []);
    if (!modifiers.ok) throw new Error(modifiers.reason);
    const lineTotal = lineTotalWithModifiers(
      priced.lineTotal,
      item.quantity,
      modifiers.surcharge,
    );

    subtotal += lineTotal;
    lines.push({
      productId: product._id,
      name: product.name,
      unitPrice: priced.baseUnitPrice,
      // Disimpan dalam satuan dasar supaya stok, ledger, dan laporan konsisten.
      quantity: priced.baseQty,
      lineTotal,
      trackStock: product.trackStock,
      modifierLabels: modifiers.labels,
    });
  }

  return { lines, subtotal };
}

/**
 * Creates a sale. `idempotencyKey` is client-generated so an offline device can
 * safely replay the same sale after reconnecting without double-charging.
 */
export const createSale = mutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    shiftId: v.optional(v.id("shifts")),
    cashierId: v.id("users"),
    items: v.array(saleItemValidator),
    discount: v.optional(v.number()),
    payments: v.array(paymentValidator),
    idempotencyKey: v.string(),
    status: v.optional(saleStatusValidator),
    /** Meja yang ditempati pesanan ini (modul F&B, `pos.table`). */
    tableId: v.optional(v.id("tables")),
    /**
     * Pelanggan B2B penanggung tagihan (modul Grosir). Kalau totalnya belum
     * dibayar penuh, kekurangannya menjadi piutang pelanggan ini.
     */
    customerId: v.optional(v.id("customers")),
    /** Member yang memakai diskonnya (modul UMKM, `member.discount`). */
    memberId: v.optional(v.id("members")),
    /**
     * Tagihan digital yang melunasi penjualan ini (`payment.digital`). Kasir yang
     * menagih QRIS dari keranjang mengirim id tagihan yang baru dilunasi, sehingga
     * penjualan QRIS dan tagihan pelanggan menunjuk catatan uang yang sama.
     */
    digitalChargeId: v.optional(v.id("digitalCharges")),
    /**
     * Bayar tepat sebesar total yang dihitung server (`POST /api/v1/sales`).
     * Pemanggil yang tidak menghitung harganya sendiri — mis. sistem luar —
     * tidak boleh menebak, jadi jumlah pada baris pembayaran diambil dari total
     * server. Hanya berlaku untuk satu metode pembayaran.
     */
    payExactTotal: v.optional(v.boolean()),
    /**
     * Nota ini **berasal dari marketplace** (`POST /api/marketplace/orders`).
     * Notanya tidak dikabarkan balik sebagai penjualan baru ke marketplace —
     * di sana pesanan itu sudah ada dengan nomornya sendiri, sedangkan
     * `upsertKey` kita adalah nomor MesinPOS. Stok tetap dikirim lewat antrean
     * stok otomatis, jadi saldo marketplace tetap menyusul.
     */
    fromMarketplace: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // 1. Idempotency — replaying the same key returns the original sale.
    const existing = await ctx.db
      .query("sales")
      .withIndex("by_idempotency", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (existing) {
      return {
        saleId: existing._id,
        number: existing.number,
        total: existing.total,
        creditAmount: 0,
        memberDiscount: existing.memberDiscount ?? 0,
        deduplicated: true,
      };
    }

    // 2. Subscription must permit new sales, the caller's role must allow
    //    selling, and the store must belong to the tenant.
    const tenant = await requireSalesAllowed(ctx, args.tenantId);
    await requirePermission(ctx, args.tenantId, args.cashierId, "pos.sell");
    const store = await ctx.db.get(args.storeId);
    if (!store || store.tenantId !== args.tenantId) {
      throw new Error("Toko tidak valid untuk tenant ini.");
    }
    if (args.shiftId) {
      const shift = await ctx.db.get(args.shiftId);
      if (!shift || shift.tenantId !== args.tenantId) {
        throw new Error("Shift tidak valid untuk tenant ini.");
      }
    }

    // 2b. Denah meja (modul F&B). Aturan "satu meja satu pesanan terbuka"
    //     datang dari `lib/fnb.ts` — aturan yang sama juga dipakai UI, jadi
    //     kasir tidak pernah melihat meja yang akan ditolak server.
    let table: Doc<"tables"> | null = null;
    if (args.tableId) {
      await requireFeature(ctx, args.tenantId, args.cashierId, "pos.table");

      const candidate = await ctx.db.get(args.tableId);
      if (
        !candidate ||
        candidate.tenantId !== args.tenantId ||
        candidate.storeId !== args.storeId
      ) {
        throw new Error("Meja tidak valid untuk toko ini.");
      }
      table = candidate;

      const onTable = await ctx.db
        .query("sales")
        .withIndex("by_table", (q) => q.eq("tableId", args.tableId))
        .collect();
      // Meja ditempati selama masih ada **tiket dapur** yang menunjuknya —
      // termasuk penjualan yang sudah dibayar tetapi belum ditandai selesai oleh
      // dapur (`tableHolders`). Jadi meja tamu yang uangnya sudah masuk tetap
      // terkunci sampai dapurnya menekan Selesai, bukan langsung bebas.
      const openOrders = tableHolders(
        onTable.map((s) => ({
          id: s._id,
          number: s.number,
          createdAt: s.createdAt,
          tableId: s.tableId,
          status: s.status,
          kitchenFiredAt: s.kitchenFiredAt,
          kitchenDoneAt: s.kitchenDoneAt,
        })),
      );

      const seat = seatTable(
        [
          {
            id: candidate._id,
            name: candidate.name,
            zone: candidate.zone,
            seats: candidate.seats,
            active: candidate.active,
          },
        ],
        openOrders,
        candidate._id,
      );
      if (!seat.ok) throw new Error(seat.reason);
    }

    // 3. Price lines server-side — never trust client totals.
    // Modul Grosir menentukan apakah tier/satuan boleh dipakai pada transaksi
    // ini; paket saja tidak cukup.
    const entitlements = entitlementsForTenant(tenant);
    const wholesaleActive = isModuleActive(entitlements, tenant.verticals, "wholesale");
    const modifiersActive = isModuleActive(entitlements, tenant.verticals, "fnb");

    // Memilih modifier butuh fitur `pos.modifier` (modul F&B) — pesan galatnya
    // kanonik dari `requireFeature`, sama seperti fitur modul lain.
    if (args.items.some((item) => (item.modifiers ?? []).length > 0)) {
      await requireFeature(ctx, args.tenantId, args.cashierId, "pos.modifier");
    }

    const { lines, subtotal } = await resolveLines(
      ctx,
      args.tenantId,
      args.items,
      wholesaleActive,
      modifiersActive,
    );
    const status = args.status ?? "completed";

    // 3a. Diskon: member (`member.discount`, modul UMKM) + diskon manual yang
    //     diketik kasir, digabung aturan murni `lib/loyalty.ts`. Persentase
    //     member datang dari **data member di server**, bukan dari klien — angka
    //     diskon tidak boleh bisa dititipkan lewat request.
    let member: Doc<"members"> | null = null;
    if (args.memberId) {
      const candidate = await ctx.db.get(args.memberId);
      if (!candidate || candidate.tenantId !== args.tenantId) {
        throw new Error("Member tidak valid untuk tenant ini.");
      }
      if (!candidate.active) {
        throw new Error(
          `Member ${candidate.name} tidak aktif; aktifkan dulu di halaman Member kalau memang masih berlangganan.`,
        );
      }
      member = candidate;

      if (member.discountPct > 0) {
        await requireFeature(
          ctx,
          args.tenantId,
          args.cashierId,
          "member.discount",
          "pos.sell",
        );
      }
    }

    const discount = discountBreakdown({
      subtotal,
      manualDiscount: args.discount,
      member: member
        ? { name: member.name, discountPct: member.discountPct }
        : null,
    });
    // Pajak mana yang dipungut penjualan ini ditentukan aturan murni
    // `lib/fnbTax.ts`: kalau PBJT (pajak daerah) berlaku untuk makanan/minuman
    // yang disajikan langsung, ia **menggantikan** PPN — bukan ditambahkan — dan
    // biaya layanan berdiri sebagai barisnya sendiri (bukan pajak). Setelan
    // workspace yang sama dipakai kasir untuk pratinjaunya, jadi angka di layar
    // dan yang dicatat di sini tidak pernah berbeda.
    const totals = orderTotal({
      net: discount.net,
      ppn: taxSettingOf(tenant),
      fnb: fnbTaxProfileOf(tenant.fnbTaxProfile),
    });
    // Bentuk `taxed` sengaja dipertahankan (net/tax/gross/ratePct) supaya seluruh
    // alur uang di bawah ini membaca satu sumber yang sama — dan `taxRatePct` yang
    // tercatat di struk adalah tarif yang benar-benar dipungut, jadi struk lama
    // tetap bisa dibaca walau setelannya diubah kemudian.
    const taxed = {
      net: totals.net,
      tax: totals.tax,
      gross: totals.total,
      ratePct: totals.plan.ratePct,
    };

    // 3a-2. “Bayar tepat sebesar total”: jumlahnya dari server, bukan kiriman.
    //       Tanpa ini, pemanggil API harus menyalin rumus PPN & diskon — dua
    //       tempat yang pasti akan berbeda suatu hari.
    if (args.payExactTotal === true && args.payments.length !== 1) {
      throw new Error(
        "Pembayaran tepat sebesar total hanya boleh memakai satu metode pembayaran.",
      );
    }
    const payments =
      args.payExactTotal === true
        ? [{ ...args.payments[0], amount: taxed.gross, change: undefined }]
        : args.payments;

    // 3b. Penjualan tempo (`ar.creditlimit`, modul Grosir). Sisa tagihan yang
    //     belum dibayar menjadi piutang pelanggan, jadi tiga hal dievaluasi
    //     server sebelum barang keluar: pelanggannya ada, modulnya hidup, dan
    //     sisa limit kreditnya masih cukup. Aturannya dari `lib/ar.ts` — sama
    //     dengan yang dipakai kasir untuk pratinjau.
    const now = Date.now();
    const tendered = payments.reduce(
      (sum, payment) => sum + (Number(payment.amount) || 0),
      0,
    );
    const shortfall = creditFromPayment(taxed.gross, tendered);
    // Pesanan yang masih di dapur belum dibayar siapa pun: pembayaran yang
    // tercatat di situ hanyalah niat metodenya, jadi tidak pernah jadi piutang.
    // Kalau pengirimnya tetap minta tempo, ditolak — uang yang tidak dicatat
    // lebih berbahaya daripada penolakan yang jelas.
    let creditAmount = shortfall;
    if (status === "held") {
      if (args.customerId && shortfall > 0) {
        throw new Error(
          "Pesanan yang masih di dapur belum bisa dibayar tempo; selesaikan pesanannya dulu.",
        );
      }
      creditAmount = 0;
    }

    let customer: Doc<"customers"> | null = null;
    if (args.customerId) {
      const candidate = await ctx.db.get(args.customerId);
      if (!candidate || candidate.tenantId !== args.tenantId) {
        throw new Error("Pelanggan tidak valid untuk tenant ini.");
      }
      customer = candidate;
    }

    if (creditAmount > 0) {
      if (!customer) {
        throw new Error(
          `Sisa tagihan ${formatRupiah(creditAmount)} butuh pelanggan B2B; pilih pelanggannya dulu.`,
        );
      }

      await requireFeature(
        ctx,
        args.tenantId,
        args.cashierId,
        "ar.creditlimit",
        "pos.sell",
      );

      const existingDebts = await ctx.db
        .query("receivables")
        .withIndex("by_tenant_customer", (q) =>
          q.eq("tenantId", args.tenantId).eq("customerId", customer!._id),
        )
        .collect();

      const decision = decideCredit({
        customer: {
          name: customer.name,
          creditLimit: customer.creditLimit,
          active: customer.active,
        },
        receivables: existingDebts.map(
          (row): ReceivableLike => ({
            amount: row.amount,
            paidAmount: row.paidAmount,
            dueDate: row.dueDate,
            status: row.status,
          }),
        ),
        newDebt: creditAmount,
        now,
      });
      if (!decision.ok) throw new Error(decision.reason);
    }

    // 3b-2. Tagihan digital yang menanggung penjualan ini (`payment.digital`).
    //       Kasir yang menagih QRIS dari keranjang menunjuk tagihan yang baru ia
    //       lunasi; server memeriksa ulang bahwa tagihannya **lunas**, metodenya
    //       cocok, dan nominalnya sama dengan total penjualan yang dihitung di
    //       sini. Aturannya dari `lib/digitalPayment.ts` — sama dengan yang dipakai
    //       halaman kasir, jadi klien tidak pernah menjanjikan penjualan yang akan
    //       ditolak server.
    let digitalCharge: Doc<"digitalCharges"> | null = null;
    if (args.digitalChargeId) {
      const candidate = await ctx.db.get(args.digitalChargeId);
      if (!candidate || candidate.tenantId !== args.tenantId) {
        throw new Error("Tagihan pembayaran tidak ditemukan untuk tenant ini.");
      }
      const check = checkSaleAgainstCharge(chargeLikeFrom(candidate), {
        saleTotal: taxed.gross,
        saleMethod: payments[0]?.method ?? null,
        now,
      });
      if (!check.ok) throw new Error(check.reason);
      digitalCharge = candidate;
    }

    // 3c. Pesanan yang ditahan adalah alur F&B (dikirim ke dapur belakangan),
    //     jadi modulnya harus benar-benar aktif — bukan sekadar ada di paket.
    //     Diperiksa setelah aturan tempo supaya pesan yang lebih spesifik
    //     ("belum bisa dibayar tempo") yang muncul lebih dulu.
    if (status === "held") {
      await requireFeature(ctx, args.tenantId, args.cashierId, "pos.kds");
    }

    // 4. Sequential, per-tenant receipt number.
    const seq = await nextSequence(ctx, args.tenantId, "sale");
    const number = `A-${String(seq).padStart(5, "0")}`;

    const saleId = await ctx.db.insert("sales", {
      tenantId: args.tenantId,
      storeId: args.storeId,
      shiftId: args.shiftId,
      number,
      status,
      subtotal,
      discount: discount.totalDiscount,
      tax: taxed.tax,
      taxRatePct: taxed.ratePct,
      taxKind: totals.plan.kind,
      serviceCharge: totals.serviceCharge,
      total: taxed.gross,
      payments,
      cashierId: args.cashierId,
      idempotencyKey: args.idempotencyKey,
      tableId: args.tableId,
      customerId: args.customerId,
      memberId: member?._id,
      memberDiscount:
        discount.memberDiscount > 0 ? discount.memberDiscount : undefined,
      digitalChargeId: args.digitalChargeId,
      createdAt: now,
    });

    // 4a. Tagihannya menunjuk balik ke penjualan ini: satu tagihan QRIS yang
    //     sudah lunas tepat melunasi satu penjualan, dan keuangan bisa menelusuri
    //     keduanya dari arah mana pun.
    if (digitalCharge) {
      await ctx.db.patch(digitalCharge._id, { saleId, saleNumber: number });
    }

    for (const line of lines) {
      await ctx.db.insert("saleItems", {
        tenantId: args.tenantId,
        saleId,
        productId: line.productId,
        name: line.name,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        lineTotal: line.lineTotal,
        // Label (bukan kode) supaya mengubah tulisan opsi tidak mengubah riwayat
        // struk: yang tercetak saat itu tetap yang tercetak.
        modifiers:
          line.modifierLabels.length > 0 ? line.modifierLabels : undefined,
      });
    }

    // 4b. Catat piutangnya sebagai nota sendiri (nomor `AR-…`), supaya
    //     pelunasan sebagian dan umur piutang bisa dilacak per penjualan.
    if (creditAmount > 0 && customer) {
      const arSeq = await nextSequence(ctx, args.tenantId, "receivable");
      await ctx.db.insert("receivables", {
        tenantId: args.tenantId,
        storeId: args.storeId,
        customerId: customer._id,
        saleId,
        number: `AR-${String(arSeq).padStart(5, "0")}`,
        amount: creditAmount,
        paidAmount: 0,
        dueDate: dueDateFrom(now, customer.paymentTermDays),
        status: "open",
        // Penanda pengingat ditulis sejak lahir: pekerja harian
        // `receivable.overdue` mencari lewat indeks `(overdueNotified, dueDate)`,
        // dan indeks Convex hanya memuat baris yang kolomnya memang bernilai
        // false — baris tanpa kolom ini tidak akan pernah ditemukan.
        overdueNotified: false,
        createdAt: now,
      });
    }

    // 4c. Dapur (modul F&B). Penjualan yang **sudah lunas** langsung dikirim ke
    //     antrean dapur pada momen pembayarannya — begitulah kasir bekerja:
    //     pembeli membayar (tunai, QRIS, atau VA), pesanannya berangkat ke
    //     dapur, dan struknya ditawarkan di layar yang sama. Tanpa langkah ini
    //     dapur baru melihat pesanannya setelah kasir menekan tombol kedua.
    //
    //     Gerbangnya fitur `pos.kds` (bukan sekadar modul F&B): kalau layar
    //     dapurnya tidak ada di paket workspace ini, tidak ada yang menerima
    //     tiketnya — dan penjualannya tidak diklaim "sudah ke dapur".
    const fireKitchen = fireKitchenOnSale({
      kdsFeatureOn: isFeatureEnabled(entitlements, tenant.verticals, "pos.kds"),
      status,
    });
    if (fireKitchen) {
      await ctx.db.patch(saleId, { kitchenFiredAt: now });
    }

    // 5. Deduct stock through the ledger unless the order is only held.
    //    Stok yang **baru saja** menembus ambang dicatat di sini supaya webhook
    //    `stock.low` dikirim saat kejadiannya, bukan pada setiap penjualan
    //    berikutnya selama stoknya masih rendah.
    const lowStockCrossings: { productId: Id<"products">; remaining: number }[] = [];
    if (status === "completed") {
      for (const line of lines) {
        if (!line.trackStock) continue;
        const remaining = await applyStockChange(ctx, {
          tenantId: args.tenantId,
          storeId: args.storeId,
          productId: line.productId,
          delta: -line.quantity,
          reason: "sale",
          refType: "sale",
          refId: saleId,
          actorId: args.cashierId,
        });
        // `delta` = −kuantitas, jadi stok sebelumnya = sesudah + kuantitasnya —
        // tidak perlu membaca level stoknya dua kali.
        if (stockCrossedLow(remaining + line.quantity, remaining)) {
          lowStockCrossings.push({ productId: line.productId, remaining });
        }
      }
    }

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.cashierId,
      action: status === "completed" ? "sale.create" : "sale.hold",
      entity: "sales",
      entityId: saleId,
      meta: {
        number,
        total: taxed.gross,
        itemCount: lines.length,
        table: table?.name,
        customer: customer?.name,
        credit: creditAmount > 0 ? creditAmount : undefined,
        digitalCharge: digitalCharge?.number,
        member: member?.code,
        memberDiscount: discount.memberDiscount,
        // Dapur ikut tercatat di jejak audit: ini keputusan yang menggerakkan
        // orang, bukan hanya angka di layar.
        kitchen: fireKitchen ? "fired" : undefined,
      },
    });

    // 6. Webhook keluar: yang dikirim adalah kejadian yang benar-benar sudah
    //    tersimpan — bukan niat yang masih bisa dibatalkan. Transaksinya sendiri
    //    tidak menunggu jaringan; `enqueueWebhookEvent` menulis baris antrean dan
    //    memanggil pekerja percobaan ulang segera setelah transaksinya tersimpan.
    if (status === "completed") {
      let enqueued = await enqueueWebhookEvent(ctx, {
        tenantId: args.tenantId,
        storeId: args.storeId,
        event: "sale.completed",
        subject: number,
        data: saleCompletedEventData({
          number,
          total: taxed.gross,
          tax: taxed.tax,
          discount: discount.totalDiscount,
          creditAmount,
          itemCount: lines.length,
          method: payments[0]?.method ?? null,
        }),
      });

      for (const crossing of lowStockCrossings) {
        const product = await ctx.db.get(crossing.productId);
        if (!product) continue;
        enqueued += await enqueueWebhookEvent(ctx, {
          tenantId: args.tenantId,
          storeId: args.storeId,
          event: "stock.low",
          subject: product.sku,
          data: stockLowEventData({
            sku: product.sku,
            name: product.name,
            remaining: crossing.remaining,
          }),
        });
      }

      // Satu putaran pekerja untuk semua kiriman transaksi ini (lihat alasannya
      // di `scheduleWebhookDeliveryPass`).
      await scheduleWebhookDeliveryPass(ctx, enqueued);

      // Penjualan juga dikabarkan ke vendor marketplace yang dipasangkan — nota
      // + stok SKU-nya dalam satu kiriman. Tanpa pairing, ini hanya satu kueri
      // berindeks dan tidak menulis apa pun. Nota yang datang **dari**
      // marketplace dilewati supaya tidak tercatat dua kali di sana.
      if (args.fromMarketplace !== true) {
        await queueMarketplaceSalePush(ctx, { tenantId: args.tenantId, saleId });
      }
    }

    return {
      saleId,
      number,
      total: taxed.gross,
      /** Sisa tagihan yang dicatat sebagai piutang (0 untuk penjualan tunai). */
      creditAmount,
      /** Bagian diskon yang berasal dari member (0 kalau tanpa member). */
      memberDiscount: discount.memberDiscount,
      /**
       * Penjualan ini sudah masuk antrean dapur pada momen yang sama. Dibaca
       * layar kasir untuk memberi tahu kasirnya — bukan untuk memutuskan apa pun.
       */
      kitchenFired: fireKitchen,
      deduplicated: false,
    };
  },
});

/**
 * Isi penyelesaian pesanan tertahan, dipakai dua jalan: tombol **Selesai** di
 * layar dapur (`finalizeHeldSale`) dan `kitchenDone` yang menerima tiket tertahan
 * maupun tiket yang sudah lunas. Satu tempat supaya stok, audit, dan webhook-nya
 * tidak pernah berbeda tergantung tombol mana yang ditekan.
 */
async function finalizeHeldSaleNow(
  ctx: MutationCtx,
  saleId: Id<"sales">,
  actorId: Id<"users">,
) {
  {
    const sale = await ctx.db.get(saleId);
    if (!sale) throw new Error("Pesanan tidak ditemukan.");
    if (sale.status === "completed") return { saleId: sale._id };

    await requireSalesAllowed(ctx, sale.tenantId);
    // Mengirim pesanan tertahan ke dapur = alur KDS milik modul F&B. Izinnya
    // `kds.manage` (bukan `pos.sell`): menyelesaikan tiket dapur adalah
    // pekerjaan dapur, dan peran “dapur saja” harus bisa menyelesaikannya.
    await requireFeature(ctx, sale.tenantId, actorId, "pos.kds", "kds.manage");

    const items = await ctx.db
      .query("saleItems")
      .withIndex("by_sale", (q) => q.eq("saleId", saleId))
      .collect();

    const lowStockCrossings: {
      sku: string;
      name: string;
      remaining: number;
    }[] = [];

    for (const item of items) {
      const product = await ctx.db.get(item.productId);
      if (product && !product.trackStock) continue;
      const remaining = await applyStockChange(ctx, {
        tenantId: sale.tenantId,
        storeId: sale.storeId,
        productId: item.productId,
        delta: -item.quantity,
        reason: "sale",
        refType: "sale",
        refId: sale._id,
        actorId,
      });
      if (product && stockCrossedLow(remaining + item.quantity, remaining)) {
        lowStockCrossings.push({
          sku: product.sku,
          name: product.name,
          remaining,
        });
      }
    }

    await ctx.db.patch(sale._id, { status: "completed" });

    await writeAuditLog(ctx, {
      tenantId: sale.tenantId,
      actorId,
      action: "sale.finalize",
      entity: "sales",
      entityId: sale._id,
    });

    // Pesanan yang dikirim dari dapur baru sekarang benar-benar menjadi
    // penjualan — pada titik itulah webhook `sale.completed` berangkat. Pesanan
    // tertahan tidak pernah dibayar tempo, jadi sisanya selalu 0.
    let enqueued = await enqueueWebhookEvent(ctx, {
      tenantId: sale.tenantId,
      storeId: sale.storeId,
      event: "sale.completed",
      subject: sale.number,
      data: saleCompletedEventData({
        number: sale.number,
        total: sale.total,
        tax: sale.tax,
        discount: sale.discount,
        creditAmount: 0,
        itemCount: items.length,
        method: sale.payments[0]?.method ?? null,
      }),
    });

    for (const crossing of lowStockCrossings) {
      enqueued += await enqueueWebhookEvent(ctx, {
        tenantId: sale.tenantId,
        storeId: sale.storeId,
        event: "stock.low",
        subject: crossing.sku,
        data: stockLowEventData({
          sku: crossing.sku,
          name: crossing.name,
          remaining: crossing.remaining,
        }),
      });
    }

    await scheduleWebhookDeliveryPass(ctx, enqueued);
    await queueMarketplaceSalePush(ctx, {
      tenantId: sale.tenantId,
      saleId: sale._id,
    });

    return { saleId: sale._id };
  }
}

/** Completes a previously held order, deducting stock at that moment. */
export const finalizeHeldSale = mutation({
  args: { saleId: v.id("sales"), actorId: v.id("users") },
  handler: async (ctx, args) => finalizeHeldSaleNow(ctx, args.saleId, args.actorId),
});

/**
 * Tombol **Selesai** di layar dapur, untuk kedua jenis tiket.
 *
 * Dua keadaan yang memang berbeda, dan bedanya bukan hiasan:
 *
 *  - **pesanan tertahan** (`status: "held"`) — uangnya belum tercatat sebagai
 *    penjualan yang selesai, dan stoknya belum bergerak. Menekan Selesai di sini
 *    adalah penyelesaian penjualannya (`finalizeHeldSale`), termasuk pesanan QR
 *    meja yang memang sudah dibayar tamunya.
 *  - **penjualan lunas yang dikirim ke dapur** (`kitchenFiredAt` terisi) —
 *    penjualannya sudah tercatat dan stoknya sudah bergerak sejak kasir menagih
 *    uangnya, jadi dapur hanya **menandai** tiketnya beres (`kitchenDoneAt`).
 *    Menyelesaikan penjualan untuk kedua kalinya justru akan mengurangi stok dua
 *    kali, dan itu yang dijaga fungsi ini.
 */
export const kitchenDone = mutation({
  args: { saleId: v.id("sales"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    const sale = await ctx.db.get(args.saleId);
    if (!sale) throw new Error("Pesanan tidak ditemukan.");

    // Pesanan tertahan diserahkan ke jalur yang sudah ada, apa adanya.
    if (sale.status === "held") {
      return await finalizeHeldSaleNow(ctx, args.saleId, args.actorId);
    }

    await requireSalesAllowed(ctx, sale.tenantId);
    await requireFeature(ctx, sale.tenantId, args.actorId, "pos.kds", "kds.manage");

    if (!isKitchenTicket(sale)) {
      throw new Error(
        "Pesanan ini tidak sedang menunggu di dapur — mungkin sudah ditandai selesai atau dibatalkan.",
      );
    }

    const now = Date.now();
    await ctx.db.patch(sale._id, { kitchenDoneAt: now });

    await writeAuditLog(ctx, {
      tenantId: sale.tenantId,
      actorId: args.actorId,
      action: "sale.kitchenDone",
      entity: "sales",
      entityId: sale._id,
      meta: { number: sale.number, firedAt: sale.kitchenFiredAt },
    });

    return { saleId: sale._id };
  },
});

/** Voids a completed sale and returns the stock to the shelf. */
export const voidSale = mutation({
  args: {
    saleId: v.id("sales"),
    actorId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sale = await ctx.db.get(args.saleId);
    if (!sale) throw new Error("Transaksi tidak ditemukan.");
    if (sale.status === "void") return { saleId: sale._id };

    // Reversing a sale is a sensitive action — a cashier may not do it.
    await requirePermission(ctx, sale.tenantId, args.actorId, "pos.void");

    // Piutang yang sudah menerima uang tidak boleh dihapus begitu saja oleh
    // pembatalan penjualan: uangnya sudah masuk, jadi harus diselesaikan dulu
    // (dicatat sebagai pelunasan/koreksi), bukan hilang bersama transaksinya.
    const debts = await ctx.db
      .query("receivables")
      .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
      .collect();
    const paidDebt = debts.find((debt) => debt.paidAmount > 0);
    if (paidDebt) {
      throw new Error(
        `Piutang ${paidDebt.number} sudah menerima pembayaran ${formatRupiah(paidDebt.paidAmount)}; selesaikan piutangnya dulu sebelum membatalkan penjualan.`,
      );
    }

    const wasCompleted = sale.status === "completed";
    const items = await ctx.db
      .query("saleItems")
      .withIndex("by_sale", (q) => q.eq("saleId", args.saleId))
      .collect();

    if (wasCompleted) {
      for (const item of items) {
        const product = await ctx.db.get(item.productId);
        if (product && !product.trackStock) continue;
        await applyStockChange(ctx, {
          tenantId: sale.tenantId,
          storeId: sale.storeId,
          productId: item.productId,
          delta: item.quantity,
          reason: "void",
          refType: "sale",
          refId: sale._id,
          note: args.reason,
          actorId: args.actorId,
        });
      }
    }

    await ctx.db.patch(sale._id, { status: "void" });

    // Piutang yang belum menerima apa pun ikut dibatalkan, sehingga limit
    // pelanggan kembali seperti sebelum transaksi.
    for (const debt of debts) {
      if (debt.status === "open") {
        await ctx.db.patch(debt._id, { status: "void" });
      }
    }

    await writeAuditLog(ctx, {
      tenantId: sale.tenantId,
      actorId: args.actorId,
      action: "sale.void",
      entity: "sales",
      entityId: sale._id,
      meta: {
        reason: args.reason,
        restocked: wasCompleted,
        receivablesVoided: debts.filter((debt) => debt.status === "open").length,
      },
    });

    // Pembatalan juga kejadian yang harus sampai ke sistem tenant — `restocked`
    // membedakan penjualan yang stoknya dikembalikan dari pesanan tertahan yang
    // memang belum pernah menggerakkan stok.
    const enqueuedVoid = await enqueueWebhookEvent(ctx, {
      tenantId: sale.tenantId,
      storeId: sale.storeId,
      event: "sale.voided",
      subject: sale.number,
      data: saleVoidedEventData({
        number: sale.number,
        total: sale.total,
        restocked: wasCompleted,
        reason: args.reason,
      }),
    });
    await scheduleWebhookDeliveryPass(ctx, enqueuedVoid);
    // Pembatalan memakai antrean yang sama: nota yang sama dikirim ulang dengan
    // `status: "void"` dan stok sesudah pengembalian, bukan sebagai nota baru.
    await queueMarketplaceSalePush(ctx, {
      tenantId: sale.tenantId,
      saleId: sale._id,
    });

    return { saleId: sale._id };
  },
});

export const listHeld = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.tenantId, args.actorId);

    const held = await ctx.db
      .query("sales")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    return held.filter((s) => s.status === "held");
  },
});

/**
 * Antrean dapur (`pos.kds` + izin `kds.manage`): pesanan tertahan, paling lama
 * menunggu di depan, lengkap dengan meja dan itemnya. Dihitung oleh aturan yang
 * sama dengan layar dapur (`lib/fnb.ts`), jadi urutan dan penandaan "lama" tidak
 * bisa berbeda antara server dan UI.
 */
export const kdsTickets = query({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Layar dapur adalah fitur modul F&B **dan** pekerjaan tersendiri
    // (`kds.manage`): tanpa modulnya aktif tidak ada antrean yang boleh dibaca,
    // dan peran yang bukan pekerja dapur tidak membaca pesanan pelanggan
    // (bukan sekadar disembunyikan di klien).
    await requireFeature(ctx, args.tenantId, args.actorId, "pos.kds", "kds.manage");

    const tables = await ctx.db
      .query("tables")
      .withIndex("by_tenant_store", (q) =>
        q.eq("tenantId", args.tenantId).eq("storeId", args.storeId),
      )
      .collect();

    const sales = await ctx.db
      .query("sales")
      .withIndex("by_tenant_store_created", (q) =>
        q.eq("tenantId", args.tenantId).eq("storeId", args.storeId),
      )
      .collect();
    // Dua sumber tiket: pesanan tertahan, dan penjualan lunas yang sudah dikirim
    // ke dapur tetapi belum ditandai selesai (`isKitchenTicket` — aturan yang sama
    // dipakai store demo, jadi demo tidak pernah menampilkan antrean yang berbeda).
    const tickets = sales.filter((sale) => isKitchenTicket(sale));

    const orders: {
      id: string;
      number: string;
      createdAt: number;
      tableId?: Id<"tables">;
      items: KdsTicketItem[];
      settled: boolean;
      paidLabel: string | null;
    }[] = [];

    for (const sale of tickets) {
      const items = await ctx.db
        .query("saleItems")
        .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
        .collect();
      const settled = sale.status !== "held";
      orders.push({
        id: sale._id,
        number: sale.number,
        // Tiket lunas menunggu **sejak dikirim ke dapur**, bukan sejak keranjangnya
        // mulai disusun — itu momen yang dipakai dapur untuk menilai lama tunggu.
        createdAt: sale.kitchenFiredAt ?? sale.createdAt,
        tableId: sale.tableId,
        settled,
        paidLabel: settled
          ? ticketPaidLabel({
              method: sale.payments[0]?.method ?? "",
              firedAt: sale.kitchenFiredAt,
            })
          : null,
        items: items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          modifiers: item.modifiers,
        })),
      });
    }

    return kdsQueue(
      orders,
      tables.map((table) => ({
        id: table._id,
        name: table.name,
        zone: table.zone,
        seats: table.seats,
        active: table.active,
      })),
    );
  },
});

export const recent = query({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.tenantId, args.actorId);

    const limit = args.limit ?? 20;
    const rows = await ctx.db
      .query("sales")
      .withIndex("by_tenant_store_created", (q) =>
        q.eq("tenantId", args.tenantId).eq("storeId", args.storeId),
      )
      .order("desc")
      .take(limit);

    // Join line quantities so the client can show item counts without an extra
    // round trip per sale.
    return await Promise.all(
      rows.map(async (sale) => {
        const items = await ctx.db
          .query("saleItems")
          .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
          .collect();
        return {
          ...sale,
          itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
        };
      }),
    );
  },
});

/*
  Kas toko itu **satu**, bukan satu per ponsel. Shift disimpan di tabel `shifts`
  (`pos.openShift`/`pos.closeShift`), jadi kas yang dibuka pemilik harus terbaca
  kasir di perangkat lain — tanpa itu gerbang kasir di halaman POS hanya melihat
  perangkatnya sendiri dan menolak menjual walau kas tokonya jelas terbuka.

  Yang dituntut hanya **keanggotaan**, bukan `shift.manage`: kasir yang melayani
  penjualan justru tidak memegang izin kas, dan merekalah yang paling perlu tahu
  kasnya sudah dibuka. Isi yang dikembalikan pun hanya keadaan kas — tidak ada
  uang, nama pelanggan, atau apa pun yang bisa dibaca peran lain dari sini.
*/
export const till = query({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.tenantId, args.actorId);

    const store = await ctx.db.get(args.storeId);
    if (!store || store.tenantId !== args.tenantId) {
      throw new Error("Toko tidak valid untuk tenant ini.");
    }

    const rows = await ctx.db
      .query("shifts")
      .withIndex("by_tenant_store", (q) =>
        q.eq("tenantId", args.tenantId).eq("storeId", args.storeId),
      )
      .order("desc")
      .take(60);

    // Shift yang paling baru dibuka yang masih berjalan. Kalau ada lebih dari
    // satu (mis. dua kasir membuka kas di jam yang sama), yang terbaru yang
    // dipakai: kasnya memang sedang terbuka, dan jam bukanya yang paling dekat
    // dengan keadaan sekarang.
    const open = rows.find((row) => row.status === "open") ?? null;
    const history = rows
      .filter((row) => row.status === "closed" && row.closedAt !== undefined)
      .slice(0, 10);

    return {
      current: open
        ? {
            id: open._id as string,
            openedAt: open.openedAt,
            openingCash: open.openingCash,
            cashierId: open.cashierId as string,
          }
        : null,
      history: history.map((row) => ({
        id: row._id as string,
        openedAt: row.openedAt,
        closedAt: row.closedAt as number,
        openingCash: row.openingCash,
        countedCash: row.closingCash ?? 0,
        expectedCash: row.expectedCash ?? 0,
        variance: row.variance ?? 0,
      })),
    };
  },
});

export const openShift = mutation({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    cashierId: v.id("users"),
    openingCash: v.number(),
  },
  handler: async (ctx, args) => {
    await requireSalesAllowed(ctx, args.tenantId);
    // Kas dibuka penjualnya sendiri (`shift.manage`), bukan lewat izin menjual:
    // mengelola kas adalah pekerjaan tersendiri yang bisa dipisah merchant.
    await requirePermission(ctx, args.tenantId, args.cashierId, "shift.manage");

    const store = await ctx.db.get(args.storeId);
    if (!store || store.tenantId !== args.tenantId) {
      throw new Error("Toko tidak valid untuk tenant ini.");
    }

    /*
      Satu kas per **toko**, bukan per kasir: keadaannya dibaca semua perangkat
      (`pos.till`), jadi dua shift terbuka untuk toko yang sama akan membuat
      halaman Kasir memilih salah satunya dan Z-report-nya terbelah. Pengguna
      yang menekan Buka shift dua kali (atau dari dua perangkat) ditolak dengan
      kalimat yang menyebut kasnya, bukan “kasir ini”.
    */
    const open = await ctx.db
      .query("shifts")
      .withIndex("by_tenant_store", (q) =>
        q.eq("tenantId", args.tenantId).eq("storeId", args.storeId),
      )
      .order("desc")
      .take(20);
    if (open.some((s) => s.status === "open")) {
      throw new Error(
        "Kas toko ini masih terbuka — tutup dulu shift yang berjalan sebelum membuka yang baru.",
      );
    }

    return await ctx.db.insert("shifts", {
      tenantId: args.tenantId,
      storeId: args.storeId,
      cashierId: args.cashierId,
      status: "open",
      openingCash: args.openingCash,
      openedAt: Date.now(),
    });
  },
});

/**
 * Closes a shift and computes the Z-report: expected drawer cash vs counted.
 * Only `cash` payments move physical cash; QRIS/card settle electronically.
 */
export const closeShift = mutation({
  args: {
    shiftId: v.id("shifts"),
    actorId: v.id("users"),
    closingCash: v.number(),
  },
  handler: async (ctx, args) => {
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new Error("Shift tidak ditemukan.");

    // A Z-report moves money and closes a till — same authority as selling on
    // it, but its own permission (`shift.manage`): a cash-count supervisor may
    // hold it without being able to sell. (The actor need not be the shift's
    // own cashier: a manager may close.)
    await requirePermission(ctx, shift.tenantId, args.actorId, "shift.manage");

    if (shift.status === "closed") throw new Error("Shift sudah ditutup.");

    const closedAt = Date.now();
    const sales = await ctx.db
      .query("sales")
      .withIndex("by_tenant_store_created", (q) =>
        q
          .eq("tenantId", shift.tenantId)
          .eq("storeId", shift.storeId)
          .gte("createdAt", shift.openedAt),
      )
      .collect();

    const shiftSales = sales.filter(
      (s) => s.shiftId === shift._id && s.status === "completed",
    );

    const cashIn = shiftSales.reduce((sum, sale) => {
      const cash = sale.payments
        .filter((p) => p.method === "cash")
        .reduce((acc, p) => acc + p.amount, 0);
      const change = sale.payments.reduce((acc, p) => acc + (p.change ?? 0), 0);
      return sum + cash - change;
    }, 0);

    const expectedCash = shift.openingCash + cashIn;
    const variance = args.closingCash - expectedCash;

    await ctx.db.patch(args.shiftId, {
      status: "closed",
      closingCash: args.closingCash,
      expectedCash,
      variance,
      closedAt,
    });

    await writeAuditLog(ctx, {
      tenantId: shift.tenantId,
      actorId: args.actorId,
      action: "shift.close",
      entity: "shifts",
      entityId: shift._id,
      meta: { expectedCash, counted: args.closingCash, variance },
    });

    return {
      expectedCash,
      counted: args.closingCash,
      variance,
      transactions: shiftSales.length,
    };
  },
});

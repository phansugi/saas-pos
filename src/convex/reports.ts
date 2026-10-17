import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireFeature, requirePermission } from "./lib/access";
import {
  analyticsRange,
  buildAdvancedReport,
  previousRange,
  resolveAnalyticsDays,
  type AnalyticsItemInput,
  type AnalyticsSaleInput,
} from "./lib/analytics";
import { monthlyTaxRows } from "./lib/fnbTax";
import {
  FRANCHISE_TOP_SALES,
  franchiseRollup,
  MAX_OUTLET_WINDOW,
  mergeTopN,
  outletReadLimit,
  queryBudgetFor,
  trimOutletRows,
  type FranchiseOutletInput,
} from "./lib/scale";

/**
 * Laporan pajak & pungutan F&B per bulan untuk **seluruh workspace** (semua
 * toko): omzet tercatat, PBJT yang dipungut, PPN, dan biaya layanan tiap bulan.
 *
 * Bedanya dengan `dailySummary` yang per toko: setelan PBJT, biaya layanan, dan
 * PPh final UMKM adalah setelan **workspace**, jadi omzet yang jadi dasarnya juga
 * tidak boleh hanya satu toko — kalau tidak, pemilik dua cabang melihat angka
 * setoran yang lebih kecil dari kenyataan.
 *
 * `months` dikirim klien (lewat `recentMonthWindows`) karena batas bulan
 * mengikuti **waktu lokal** perangkat, sama seperti ringkasan harian; server
 * tidak pernah menebak bulan dari zona waktunya sendiri. Penjumlahannya memakai
 * aturan murni `lib/fnbTax.ts` (baris `void`/`held` tidak dihitung, dan tiap
 * angka diambil dari yang tercatat di struknya — bukan setelan yang berlaku
 * sekarang), jadi mode demo dan mode server menjawab dengan angka yang sama.
 */
export const fnbTaxMonths = query({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    months: v.array(
      v.object({
        year: v.number(),
        monthIndex: v.number(),
        from: v.number(),
        to: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // Omzet workspace: izinnya sama dengan laporan lain (`report.view`).
    await requirePermission(ctx, args.tenantId, args.actorId, "report.view");

    if (args.months.length === 0) return [];
    const first = args.months[0];
    const last = args.months[args.months.length - 1];

    const sales = await ctx.db
      .query("sales")
      .withIndex("by_tenant_created", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .gte("createdAt", first.from)
          .lt("createdAt", last.to),
      )
      .collect();

    return monthlyTaxRows({
      sales: sales.map((sale) => ({
        createdAt: sale.createdAt,
        total: sale.total,
        tax: sale.tax,
        taxKind: sale.taxKind,
        serviceCharge: sale.serviceCharge,
        status: sale.status,
      })),
      months: args.months,
    });
  },
});

/**
 * Daily summary for a store. Reads straight from the sales index so it stays
 * reactive — a new sale updates every subscribed dashboard automatically.
 */
export const dailySummary = query({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
    from: v.number(),
    to: v.number(),
  },
  handler: async (ctx, args) => {
    // Revenue data: readable by any member whose role can see reports.
    await requirePermission(ctx, args.tenantId, args.actorId, "report.view");

    const sales = await ctx.db
      .query("sales")
      .withIndex("by_tenant_store_created", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("storeId", args.storeId)
          .gte("createdAt", args.from)
          .lt("createdAt", args.to),
      )
      .collect();

    const completed = sales.filter((s) => s.status === "completed");

    let revenue = 0;
    let tax = 0;
    let discount = 0;
    let itemCount = 0;
    const byMethod: Record<string, number> = {};

    for (const sale of completed) {
      revenue += sale.total;
      tax += sale.tax;
      discount += sale.discount;
      for (const payment of sale.payments) {
        byMethod[payment.method] = (byMethod[payment.method] ?? 0) + payment.amount;
      }
    }

    const items = await Promise.all(
      completed.map((sale) =>
        ctx.db
          .query("saleItems")
          .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
          .collect(),
      ),
    );
    for (const list of items) {
      for (const item of list) itemCount += item.quantity;
    }

    return {
      revenue,
      tax,
      discount,
      transactions: completed.length,
      itemCount,
      averagePerTransaction:
        completed.length > 0 ? Math.round(revenue / completed.length) : 0,
      byMethod,
      heldCount: sales.filter((s) => s.status === "held").length,
      voidCount: sales.filter((s) => s.status === "void").length,
    };
  },
});

/**
 * Analitik lanjutan (`report.advanced`, Phase 4 / Enterprise Intelligence).
 *
 * Mengembalikan laporan yang sudah jadi: tren harian, margin kotor, produk &
 * kategori teratas, jam sibuk, pola hari, perbandingan dengan periode sama
 * panjang sebelumnya, dan kalimat temuan. Semua perhitungan ada di aturan murni
 * `lib/analytics.ts`, jadi halaman Laporan tidak pernah menghitung ulang angka
 * yang berbeda dari yang dipakai server.
 *
 * Dua sumber data yang dibaca: penjualan (`completed` saja) dan baris
 * penjualannya (harga jual per baris) + katalog produk (harga beli & kategori).
 * Harga pokok memakai `products.cost` hari ini: ini **analitik**, bukan
 * pembukuan historis — kalau harga beli berubah, margin periode lama ikut
 * dihitung ulang dan itu memang yang ingin dilihat pemilik.
 */
export const advanced = query({
  args: {
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    actorId: v.id("users"),
    /** 1–90 hari; kosong = 30 hari. */
    days: v.optional(v.number()),
    /** Offset zona waktu klien dalam menit (WIB = 420). */
    timezoneOffsetMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Gerbang fiturnya di depan izin: laporan ini memang yang dijual di paket
    // Enterprise, sedangkan `report.view`-nya sama seperti laporan harian.
    await requireFeature(
      ctx,
      args.tenantId,
      args.actorId,
      "report.advanced",
      "report.view",
    );

    const offset = Math.trunc(args.timezoneOffsetMinutes ?? 0);
    const days = resolveAnalyticsDays(args.days);
    const range = analyticsRange({ days, now: Date.now(), timezoneOffsetMinutes: offset });
    const previous = previousRange(range);

    // Periode ini + periode pembanding dibaca sekali jalan, jadi keduanya pasti
    // memakai snapshot data yang sama.
    const windowRows = await ctx.db
      .query("sales")
      .withIndex("by_tenant_store_created", (q) =>
        q
          .eq("tenantId", args.tenantId)
          .eq("storeId", args.storeId)
          .gte("createdAt", previous.from)
          .lt("createdAt", range.to),
      )
      .collect();

    const completed = windowRows.filter((sale) => sale.status === "completed");

    const [products, categories] = await Promise.all([
      ctx.db
        .query("products")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
      ctx.db
        .query("categories")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
    ]);
    const productById = new Map(products.map((row) => [row._id as string, row]));
    const categoryById = new Map(categories.map((row) => [row._id as string, row.name]));

    const itemLists = await Promise.all(
      completed.map((sale) =>
        ctx.db
          .query("saleItems")
          .withIndex("by_sale", (q) => q.eq("saleId", sale._id))
          .collect(),
      ),
    );

    const toInput = (
      sale: (typeof completed)[number],
      items: (typeof itemLists)[number],
    ): AnalyticsSaleInput => ({
      id: sale._id as string,
      createdAt: sale.createdAt,
      total: sale.total,
      tax: sale.tax,
      discount: sale.discount,
      method: sale.payments[0]?.method ?? "cash",
      items: items.map(
        (item): AnalyticsItemInput => {
          const product = productById.get(item.productId as string);
          return {
            productId: item.productId as string,
            name: item.name,
            category: product?.categoryId
              ? (categoryById.get(product.categoryId as string) ?? "Tanpa kategori")
              : "Tanpa kategori",
            quantity: item.quantity,
            net: item.lineTotal,
            // Harga pokok per satuan dasar × jumlah: harga beli terakhir dipakai
            // sebagai perkiraan terbaik yang kita punya untuk periode ini.
            cost: Math.trunc(product?.cost ?? 0) * Math.trunc(item.quantity),
          };
        },
      ),
    });

    const inputs = completed.map((sale, index) => toInput(sale, itemLists[index] ?? []));

    return buildAdvancedReport({
      sales: inputs,
      previousSales: inputs,
      range,
      timezoneOffsetMinutes: offset,
      // “Hari ini” menurut jam server hanya dipakai untuk memisahkan hari penuh
      // dari hari yang sedang berjalan; batas harinya sendiri tetap mengikuti
      // offset klien lewat `range`.
      now: Date.now(),
    });
  },
});

/**
 * Laporan lintas cabang — optimasi beban skala franchise (`scale.franchise`,
 * Phase 5 / Dukungan khusus & skala franchise).
 *
 * Kenapa permintaan ini diperlakukan khusus: ini satu-satunya laporan yang
 * **tumbuh mengikuti ukuran pelanggan**, bukan mengikuti ukuran halaman. Tenant
 * satu toko bisa membaca seluruh riwayatnya tanpa terasa; jaringan dengan 40
 * cabang akan menggandakan biaya bacanya 40 kali kalau ditulis seperti laporan
 * biasa. Karena itu bentuk pembacaannya diatur aturan murni `lib/scale.ts`:
 *
 *   1. daftar cabang dibaca `MAX_OUTLET_WINDOW + 1` dokumen (satu baris ekstra
 *      hanya untuk **tahu** ada cabang di luar jendela, bukan untuk memakainya);
 *   2. per cabang hanya dibaca `budget.rowsPerStore + 1` penjualan **terbaru**
 *      dari indeks `(tenantId, storeId, createdAt)` — dokumen di luar anggaran
 *      tidak pernah diambil dari database;
 *   3. transaksi terbesar jaringan digabung dengan `mergeTopN` (memori O(n)),
 *      bukan dengan menyatukan semua baris lalu mengurutkannya.
 *
 * Semua pemotongan dilaporkan apa adanya (`truncated`, `skippedOutlets`,
 * `beyondWindow`, `budget`), jadi halaman bisa mengatakan "sebagian" alih-alih
 * menampilkan angka yang terlihat lengkap padahal bukan.
 *
 * Batas yang jujur: laporan ini **tidak** menghitung produk teratas lintas
 * cabang, karena itu butuh membaca baris penjualan per transaksi (satu kueri
 * per penjualan) dan justru mengembalikan beban yang sedang dihindari di sini.
 * Produk teratas tetap tersedia per cabang di halaman Laporan biasa.
 */
export const franchise = query({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    /** 1–90 hari; kosong = 30 hari (periode yang sama dengan analitik). */
    days: v.optional(v.number()),
    timezoneOffsetMinutes: v.optional(v.number()),
    topSales: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Gerbang paket di depan izin: laporan lintas cabang adalah bagian yang
    // dibeli di paket Enterprise, sedangkan `report.view`-nya sama seperti
    // laporan lain.
    await requireFeature(
      ctx,
      args.tenantId,
      args.actorId,
      "scale.franchise",
      "report.view",
    );

    const offset = Math.trunc(args.timezoneOffsetMinutes ?? 0);
    const days = resolveAnalyticsDays(args.days);
    const range = analyticsRange({ days, now: Date.now(), timezoneOffsetMinutes: offset });

    // 1. Jendela cabang. Satu dokumen ekstra hanya dipakai untuk mengetahui
    //    bahwa masih ada cabang di luar jendela.
    const storeRows = await ctx.db
      .query("stores")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .take(MAX_OUTLET_WINDOW + 1);
    const beyondWindow = Math.max(0, storeRows.length - MAX_OUTLET_WINDOW);
    const windowStores = storeRows.slice(0, MAX_OUTLET_WINDOW);

    const budget = queryBudgetFor(storeRows.length);
    const activeStores = windowStores.filter((store) => store.active);
    const aggregated = activeStores.slice(0, budget.stores);
    const readLimit = outletReadLimit(budget);
    const topSalesLimit = Math.max(
      1,
      Math.trunc(args.topSales ?? FRANCHISE_TOP_SALES),
    );

    const inputs: FranchiseOutletInput[] = [];
    const perOutletTop: {
      saleId: string;
      storeId: string;
      storeName: string;
      number: string;
      total: number;
      createdAt: number;
    }[][] = [];

    for (const store of aggregated) {
      // 2. Baris terbaru cabang ini saja, dibatasi anggaran (lewat `+1` supaya
      //    pemotongannya bisa diketahui, bukan ditebak).
      const rows = await ctx.db
        .query("sales")
        .withIndex("by_tenant_store_created", (q) =>
          q
            .eq("tenantId", args.tenantId)
            .eq("storeId", store._id)
            .gte("createdAt", range.from)
            .lt("createdAt", range.to),
        )
        .order("desc")
        .take(readLimit);

      const completed = rows.filter((sale) => sale.status === "completed");
      const trimmed = trimOutletRows(
        completed.map((sale) => ({ total: sale.total, createdAt: sale.createdAt })),
        budget,
      );

      inputs.push({
        storeId: store._id as string,
        name: store.name,
        code: store.code,
        active: true,
        sales: trimmed.sales,
        truncated: trimmed.truncated,
      });

      perOutletTop.push(
        completed
          .map((sale) => ({
            saleId: sale._id as string,
            storeId: store._id as string,
            storeName: store.name,
            number: sale.number,
            total: sale.total,
            createdAt: sale.createdAt,
          }))
          .sort((a, b) => b.total - a.total),
      );
    }

    // Cabang nonaktif dan cabang aktif di luar anggaran tidak dibaca penjualannya,
    // tetapi tetap dikirim — supaya laporan melaporkan "ada berapa", bukan
    // menyembunyikannya.
    for (const store of activeStores.slice(budget.stores)) {
      inputs.push({
        storeId: store._id as string,
        name: store.name,
        code: store.code,
        active: true,
        sales: [],
      });
    }
    for (const store of windowStores.filter((row) => !row.active)) {
      inputs.push({
        storeId: store._id as string,
        name: store.name,
        code: store.code,
        active: false,
        sales: [],
      });
    }

    // 3. Transaksi terbesar jaringan: tiap cabang sudah mengurutkan miliknya
    //    (≤ anggaran baris), jadi penggabungannya berbatas memori.
    const topSales = mergeTopN(perOutletTop, topSalesLimit, (row) => row.total);

    const report = franchiseRollup({
      outlets: inputs,
      budget,
      from: range.from,
      to: range.to,
    });

    return {
      ...report,
      days,
      timezoneOffsetMinutes: offset,
      generatedAt: Date.now(),
      topSales,
      /** Cabang di luar jendela global (`MAX_OUTLET_WINDOW`). */
      beyondWindow,
    };
  },
});

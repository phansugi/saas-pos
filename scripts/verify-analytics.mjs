/**
 * Uji aturan analitik lanjutan (`report.advanced`) tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/analytics.ts` — modul murni yang dipakai
 * server (`reports.advanced`), store demo, halaman Laporan, dan harness ini.
 * Karena aturannya satu, angka yang dilihat pemilik di layar adalah angka yang
 * sama yang dihitung server.
 *
 * Titik yang paling mudah salah dan karena itu diuji ketat: **batas hari**
 * (periode memakai tengah malam lokal, bukan UTC), **hari tanpa penjualan tetap
 * punya titik** (grafik tidak boleh bolong), **margin dihitung dari omzet bersih**
 * (PPN bukan pendapatan), dan **periode pembanding sama panjang**.
 *
 * Usage: bun scripts/verify-analytics.mjs
 */
import {
  ANALYTICS_PERIODS,
  analyticsRange,
  BASKET_PAIR_LIMIT,
  BASKET_PAIR_SCAN_LIMIT,
  buildAdvancedReport,
  buildBasketReport,
  buildCategoryBreakdown,
  buildForecast,
  buildHourlyBreakdown,
  buildInsights,
  buildMethodBreakdown,
  buildProductBreakdown,
  buildTrend,
  buildWeekdayBreakdown,
  comparePeriods,
  CONCENTRATION_PCT,
  dayKey,
  dayLabel,
  DEFAULT_ANALYTICS_DAYS,
  FORECAST_MIN_DAYS,
  hourOf,
  LOW_MARGIN_PCT,
  marginOf,
  MAX_ANALYTICS_DAYS,
  previousRange,
  resolveAnalyticsDays,
  summariseSales,
  weekdayLabel,
  weekdayOf,
  DAY_MS,
} from "../src/convex/lib/analytics.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

/** WIB (UTC+7) — offset yang dipakai halaman Laporan dari peramban. */
const WIB = 420;
const NOW = Date.UTC(2026, 9, 11, 10, 0, 0); // 2026-10-11 17:00 WIB

/** Tengah malam lokal (WIB) untuk tanggal tertentu. */
function localMidnight(year, month, day) {
  return Date.UTC(year, month, day, 0, 0, 0) - WIB * 60_000;
}

/** Jam lokal pada tanggal tertentu. */
function localAt(year, month, day, hour, minute = 0) {
  return Date.UTC(year, month, day, hour, minute, 0) - WIB * 60_000;
}

const item = (productId, name, category, quantity, net, cost) => ({
  productId,
  name,
  category,
  quantity,
  net,
  cost,
});

const sale = (id, createdAt, net, tax, method, items, discount = 0) => ({
  id,
  createdAt,
  total: net + tax,
  tax,
  discount,
  method,
  items,
});

// -------------------------------------------------------------------- periode
check(
  "pilihan periode baku 7 / 30 / 90 hari",
  ANALYTICS_PERIODS.length === 3 && ANALYTICS_PERIODS[0] === 7 && ANALYTICS_PERIODS[2] === 90,
  JSON.stringify(ANALYTICS_PERIODS),
);
check("periode baku 30 hari", DEFAULT_ANALYTICS_DAYS === 30, String(DEFAULT_ANALYTICS_DAYS));
check(
  "periode di luar batas dipepetkan, bukan diterima apa adanya",
  resolveAnalyticsDays(0) === 1 &&
    resolveAnalyticsDays(-5) === 1 &&
    resolveAnalyticsDays(1000) === MAX_ANALYTICS_DAYS &&
    resolveAnalyticsDays(45.7) === 45,
  JSON.stringify([
    resolveAnalyticsDays(0),
    resolveAnalyticsDays(1000),
    resolveAnalyticsDays(45.7),
  ]),
);
check(
  "periode kosong/tidak masuk akal jatuh ke 30 hari",
  resolveAnalyticsDays(undefined) === 30 && resolveAnalyticsDays(Number.NaN) === 30,
);

{
  const range = analyticsRange({ days: 7, now: NOW, timezoneOffsetMinutes: WIB });
  check(
    "periode berakhir di tengah malam lokal setelah hari terakhir",
    range.to === localMidnight(2026, 9, 12) && range.from === localMidnight(2026, 9, 5),
    JSON.stringify([new Date(range.from).toISOString(), new Date(range.to).toISOString()]),
  );
  check(
    "panjang periode = jumlah hari yang diminta",
    range.days === 7 && range.to - range.from === 7 * DAY_MS,
    JSON.stringify(range),
  );
  check(
    "hari terakhir periode adalah hari ini menurut waktu lokal",
    dayKey(range.to - 1, WIB) === "2026-10-11",
    dayKey(range.to - 1, WIB),
  );

  const previous = previousRange(range);
  check(
    "periode pembanding tepat sebelum periode ini, sama panjang",
    previous.to === range.from &&
      previous.from === range.from - 7 * DAY_MS &&
      previous.days === range.days,
    JSON.stringify(previous),
  );

  const midnightRange = analyticsRange({ days: 1, now: localMidnight(2026, 9, 11), timezoneOffsetMinutes: WIB });
  check(
    "tengah malam lokal tetap dihitung sebagai hari itu (bukan hari sebelumnya)",
    dayKey(midnightRange.from, WIB) === "2026-10-11",
    dayKey(midnightRange.from, WIB),
  );

  const utcRange = analyticsRange({ days: 1, now: NOW });
  check(
    "tanpa offset, batas hari memakai UTC",
    dayKey(utcRange.from, 0) === "2026-10-11",
    dayKey(utcRange.from, 0),
  );
}

check(
  "label hari memakai tanggal & bulan Indonesia",
  dayLabel(localAt(2026, 9, 5, 12), WIB) === "05 Okt",
  dayLabel(localAt(2026, 9, 5, 12), WIB),
);
check(
  "jam & hari mengikuti offset klien, bukan UTC",
  hourOf(localAt(2026, 9, 11, 17), WIB) === 17 &&
    hourOf(localAt(2026, 9, 11, 17), WIB) !== new Date(localAt(2026, 9, 11, 17)).getUTCHours(),
  String(hourOf(localAt(2026, 9, 11, 17), WIB)),
);
check(
  "hari dalam minggu memakai waktu lokal",
  weekdayOf(localMidnight(2026, 9, 11), WIB) === 0 && weekdayLabel(0) === "Minggu",
  `${weekdayOf(localMidnight(2026, 9, 11), WIB)} / ${weekdayLabel(0)}`,
);

// -------------------------------------------------------------------- ringkasan
{
  const sales = [
    sale("s1", localAt(2026, 9, 11, 12), 100_000, 11_000, "cash", [
      item("p1", "Kopi Susu", "Minuman", 2, 100_000, 60_000),
    ]),
    sale("s2", localAt(2026, 9, 10, 15), 50_000, 5_500, "qris", [
      item("p2", "Roti Bakar", "Makanan", 1, 50_000, 30_000),
    ], 5_000),
  ];
  const totals = summariseSales(sales);
  check(
    "omzet = yang dibayar pelanggan, omzet bersih = total − PPN",
    totals.revenue === 166_500 && totals.tax === 16_500 && totals.netRevenue === 150_000,
    JSON.stringify(totals),
  );
  check(
    "diskon, jumlah transaksi, dan jumlah item dijumlahkan",
    totals.discount === 5_000 && totals.transactions === 2 && totals.itemCount === 3,
    JSON.stringify(totals),
  );
  check(
    "rata-rata keranjang dihitung dari omzet bersih (75.000)",
    totals.averageBasket === 75_000,
    String(totals.averageBasket),
  );

  const empty = summariseSales([]);
  check(
    "periode kosong menghasilkan nol, bukan NaN",
    empty.revenue === 0 &&
      empty.netRevenue === 0 &&
      empty.transactions === 0 &&
      empty.averageBasket === 0,
    JSON.stringify(empty),
  );
}

{
  const margin = marginOf([
    sale("s1", localAt(2026, 9, 11, 12), 100_000, 11_000, "cash", [
      item("p1", "Kopi Susu", "Minuman", 1, 100_000, 60_000),
    ]),
    // Produk tanpa harga beli: omzetnya dihitung, tetapi marginnya belum akurat.
    sale("s2", localAt(2026, 9, 11, 13), 40_000, 4_400, "cash", [
      item("p9", "Produk Tanpa HPP", "Lain", 1, 40_000, 0),
    ]),
  ]);
  check(
    "laba kotor = omzet bersih − harga pokok (140.000 − 60.000)",
    margin.cost === 60_000 && margin.grossProfit === 80_000,
    JSON.stringify(margin),
  );
  check(
    "margin dihitung dari omzet bersih, bukan dari total ber-PPN",
    margin.marginPct === Math.round((80_000 / 140_000) * 100),
    `${margin.marginPct}%`,
  );
  check(
    "omzet tanpa harga beli dicatat terpisah supaya terlihat",
    margin.uncostedRevenue === 40_000,
    String(margin.uncostedRevenue),
  );
  check(
    "tanpa penjualan, margin 0% (bukan pembagian nol)",
    marginOf([]).marginPct === 0 && marginOf([]).grossProfit === 0,
    JSON.stringify(marginOf([])),
  );
}

// ------------------------------------------------------------------ tren harian
{
  const range = analyticsRange({ days: 7, now: NOW, timezoneOffsetMinutes: WIB });
  const sales = [
    sale("s1", localAt(2026, 9, 11, 12), 100_000, 11_000, "cash", [
      item("p1", "Kopi", "Minuman", 2, 100_000, 60_000),
    ]),
    sale("s2", localAt(2026, 9, 11, 18), 50_000, 5_500, "qris", [
      item("p1", "Kopi", "Minuman", 1, 50_000, 30_000),
    ]),
    sale("s3", localAt(2026, 9, 6, 9), 30_000, 3_300, "cash", [
      item("p1", "Kopi", "Minuman", 1, 30_000, 18_000),
    ]),
    // Di luar periode: tidak boleh muncul di tren.
    sale("s4", localAt(2026, 9, 4, 9), 999_000, 0, "cash", []),
    sale("s5", localAt(2026, 9, 12, 9), 999_000, 0, "cash", []),
  ];
  const trend = buildTrend(sales, range, WIB);
  check(
    "satu titik per hari, termasuk hari tanpa penjualan",
    trend.length === 7 &&
      trend[0].key === "2026-10-05" &&
      trend[6].key === "2026-10-11",
    JSON.stringify(trend.map((point) => [point.key, point.revenue])),
  );
  check(
    "hari tanpa penjualan bernilai 0 tetapi tetap punya titik",
    trend.filter((point) => point.transactions === 0).length === 5 &&
      trend.every((point) => point.revenue >= 0),
    JSON.stringify(trend.map((point) => point.transactions)),
  );
  check(
    "penjualan dijumlahkan ke hari lokalnya",
    trend[1].revenue === 30_000 &&
      trend[6].revenue === 150_000 &&
      trend[6].transactions === 2,
    JSON.stringify([trend[1], trend[6]]),
  );
  check(
    "penjualan di luar periode diabaikan, bukan ditumpuk ke hari terdekat",
    trend.every((point) => point.revenue < 999_000),
    JSON.stringify(trend.map((point) => point.revenue)),
  );
  check(
    "penjualan pukul 23:59 lokal tetap masuk hari itu",
    buildTrend(
      [sale("s6", localAt(2026, 9, 11, 23, 59), 10_000, 0, "cash", [])],
      range,
      WIB,
    )[6].transactions === 1,
  );
}

// --------------------------------------------------------------- rincian produk
{
  const sales = [
    sale("s1", localAt(2026, 9, 11, 12), 120_000, 13_200, "cash", [
      item("p1", "Kopi Susu", "Minuman", 2, 100_000, 60_000),
      item("p2", "Roti Bakar", "Makanan", 1, 20_000, 15_000),
    ]),
    sale("s2", localAt(2026, 9, 10, 13), 60_000, 6_600, "qris", [
      item("p1", "Kopi Susu", "Minuman", 1, 50_000, 30_000),
    ]),
  ];
  const products = buildProductBreakdown(sales, 0);
  check(
    "produk diagregasi lintas transaksi (Kopi Susu 3 unit, 150.000)",
    products.length === 2 &&
      products[0].productId === "p1" &&
      products[0].quantity === 3 &&
      products[0].revenue === 150_000,
    JSON.stringify(products),
  );
  check(
    "laba & margin per produk dihitung, bukan cuma omzet",
    products[0].profit === 60_000 && products[0].marginPct === 40,
    JSON.stringify({ laba: products[0].profit, margin: products[0].marginPct }),
  );
  check(
    "porsi omzet dibulatkan dan jumlahnya masuk akal",
    products[0].sharePct === 88 && products[1].sharePct === 12,
    JSON.stringify(products.map((row) => row.sharePct)),
  );
  check(
    "urutan dari omzet terbesar; seri ditentukan laba terbesar",
    products[0].revenue >= products[1].revenue,
  );

  const loss = buildProductBreakdown(
    [
      sale("s3", localAt(2026, 9, 11, 12), 10_000, 0, "cash", [
        item("p3", "Produk Rugi", "Lain", 1, 10_000, 12_000),
      ]),
    ],
    0,
  );
  check(
    "produk yang dijual di bawah harga beli terlihat dari laba negatif",
    loss[0].profit === -2_000 && loss[0].marginPct === -20,
    JSON.stringify(loss[0]),
  );

  const limited = buildProductBreakdown(sales, 1);
  check("batas baris teratas dihormati", limited.length === 1, String(limited.length));
  check(
    "tanpa batas (0) semua produk dikembalikan",
    buildProductBreakdown(sales, 0).length === 2,
  );

  const categories = buildCategoryBreakdown(sales);
  check(
    "kategori diagregasi beserta porsinya",
    categories.length === 2 &&
      categories[0].category === "Minuman" &&
      categories[0].revenue === 150_000 &&
      categories[0].sharePct === 88,
    JSON.stringify(categories),
  );
  check(
    "produk tanpa kategori masuk keranjang “Tanpa kategori”",
    buildCategoryBreakdown([
      sale("s4", localAt(2026, 9, 11, 12), 10_000, 0, "cash", [item("p4", "X", "", 1, 10_000, 5_000)]),
    ])[0].category === "Tanpa kategori",
  );

  const methods = buildMethodBreakdown(sales);
  check(
    "metode bayar dipecah beserta jumlah transaksinya",
    methods.length === 2 &&
      methods[0].method === "cash" &&
      methods[0].revenue === 133_200 &&
      methods[0].transactions === 1 &&
      methods[0].sharePct === 67,
    JSON.stringify(methods),
  );
}

// ----------------------------------------------------------------- jam & hari
{
  const sales = [
    sale("s1", localAt(2026, 9, 11, 12, 30), 100_000, 11_000, "cash", [
      item("p1", "Kopi", "Minuman", 1, 100_000, 60_000),
    ]),
    sale("s2", localAt(2026, 9, 11, 12, 45), 50_000, 5_500, "cash", [
      item("p1", "Kopi", "Minuman", 1, 50_000, 30_000),
    ]),
    sale("s3", localAt(2026, 9, 10, 19), 40_000, 4_400, "cash", [
      item("p1", "Kopi", "Minuman", 1, 40_000, 24_000),
    ]),
  ];
  const hours = buildHourlyBreakdown(sales, WIB);
  check(
    "selalu 24 baris jam, nol diisi apa adanya",
    hours.length === 24 && hours.every((row) => row.revenue >= 0),
    JSON.stringify(hours.map((row) => row.revenue)),
  );
  check(
    "jam dihitung waktu lokal (12:30 WIB masuk jam 12, bukan jam 5 UTC)",
    hours[12].revenue === 150_000 && hours[12].transactions === 2 && hours[19].revenue === 40_000,
    JSON.stringify(hours.filter((row) => row.revenue > 0)),
  );
  check(
    "transaksi pukul 00:15 masuk jam 0",
    buildHourlyBreakdown(
      [sale("s4", localAt(2026, 9, 11, 0, 15), 5_000, 0, "cash", [])],
      WIB,
    )[0].transactions === 1,
  );

  const weekdays = buildWeekdayBreakdown(sales, WIB);
  check(
    "selalu 7 baris hari, Minggu = 0",
    weekdays.length === 7 && weekdays[0].weekday === 0,
    JSON.stringify(weekdays.map((row) => row.weekday)),
  );
  check(
    "2026-10-10 Sabtu & 2026-10-11 Minggu masuk barisnya masing-masing",
    weekdays[6].revenue === 40_000 && weekdays[0].revenue === 150_000,
    JSON.stringify(weekdays.filter((row) => row.revenue > 0)),
  );
}

// -------------------------------------------------------------- perbandingan
{
  const current = summariseSales([
    sale("s1", localAt(2026, 9, 11, 12), 110_000, 0, "cash", [
      item("p1", "Kopi", "Minuman", 1, 110_000, 60_000),
    ]),
  ]);
  const previous = summariseSales([
    sale("s2", localAt(2026, 9, 4, 12), 100_000, 0, "cash", [
      item("p1", "Kopi", "Minuman", 1, 100_000, 70_000),
    ]),
  ]);
  const comparison = comparePeriods({
    current,
    previous,
    currentMargin: marginOf([
      sale("s1", localAt(2026, 9, 11, 12), 110_000, 0, "cash", [
        item("p1", "Kopi", "Minuman", 1, 110_000, 60_000),
      ]),
    ]),
    previousMargin: marginOf([
      sale("s2", localAt(2026, 9, 4, 12), 100_000, 0, "cash", [
        item("p1", "Kopi", "Minuman", 1, 100_000, 70_000),
      ]),
    ]),
  });
  check(
    "perubahan omzet & transaksi dihitung dalam persen",
    comparison.revenueDeltaPct === 10 && comparison.transactionsDeltaPct === 0,
    JSON.stringify(comparison),
  );
  check(
    "perubahan margin dihitung dalam poin persen (45% − 30% = 15)",
    comparison.marginPctDelta === 15,
    String(comparison.marginPctDelta),
  );
  check(
    "periode pembanding kosong → null, bukan pembagian nol atau 100%",
    (() => {
      const empty = comparePeriods({
        current,
        previous: summariseSales([]),
        currentMargin: marginOf([]),
        previousMargin: marginOf([]),
      });
      return (
        empty.revenueDeltaPct === null &&
        empty.transactionsDeltaPct === null &&
        empty.averageBasketDeltaPct === null
      );
    })(),
  );
  check(
    "rata-rata keranjang dibandingkan juga",
    comparison.averageBasketDeltaPct === 10,
    String(comparison.averageBasketDeltaPct),
  );
}

// -------------------------------------------------------------------- temuan
{
  const base = {
    totals: summariseSales([]),
    margin: marginOf([]),
    comparison: comparePeriods({
      current: summariseSales([]),
      previous: summariseSales([]),
      currentMargin: marginOf([]),
      previousMargin: marginOf([]),
    }),
    trend: buildTrend([], analyticsRange({ days: 3, now: NOW, timezoneOffsetMinutes: WIB }), WIB),
    topProducts: [],
    allProducts: [],
    busyHours: buildHourlyBreakdown([], WIB),
    weekday: buildWeekdayBreakdown([], WIB),
  };

  const rising = buildInsights({
    ...base,
    totals: { ...base.totals, netRevenue: 120, transactions: 5 },
    margin: { cost: 40, grossProfit: 80, marginPct: 66, uncostedRevenue: 0 },
    comparison: { ...base.comparison, previous: { ...base.comparison.previous, netRevenue: 100, transactions: 4 }, revenueDeltaPct: 20, transactionsDeltaPct: 25 },
    topProducts: [{ productId: "p1", name: "Kopi", category: "Minuman", quantity: 3, revenue: 120, cost: 40, profit: 80, marginPct: 66, sharePct: 30 }],
    allProducts: [{ productId: "p1", name: "Kopi", category: "Minuman", quantity: 3, revenue: 120, cost: 40, profit: 80, marginPct: 66, sharePct: 30 }],
  });
  check(
    "omzet naik ≥10% jadi temuan baik yang menyebut angkanya",
    rising.some((insight) => insight.level === "good" && insight.text.includes("20%")),
    JSON.stringify(rising),
  );

  const falling = buildInsights({
    ...base,
    totals: { ...base.totals, netRevenue: 80, transactions: 3 },
    comparison: { ...base.comparison, previous: { ...base.comparison.previous, netRevenue: 100, transactions: 4 }, revenueDeltaPct: -25, transactionsDeltaPct: -25 },
  });
  check(
    "omzet turun ≥10% jadi peringatan yang menyebut besarnya penurunan",
    falling.some((insight) => insight.level === "warn" && insight.text.includes("25%")),
    JSON.stringify(falling),
  );
  check(
    "peringatan ditempatkan sebelum temuan baik/info",
    falling[0].level === "warn",
    JSON.stringify(falling.map((insight) => insight.level)),
  );

  const stable = buildInsights({
    ...base,
    totals: { ...base.totals, netRevenue: 100, transactions: 2 },
    comparison: { ...base.comparison, previous: { ...base.comparison.previous, netRevenue: 100, transactions: 2 }, revenueDeltaPct: 2, transactionsDeltaPct: 0 },
  });
  check(
    "perubahan kecil dibaca “stabil”, bukan dipaksa jadi tren",
    stable.some((insight) => insight.text.includes("stabil")),
    JSON.stringify(stable),
  );

  check(
    "tanpa periode pembanding dijelaskan apa adanya",
    base.comparison.revenueDeltaPct === null &&
      buildInsights(base).some((insight) => insight.text.includes("belum bisa dibandingkan")),
    JSON.stringify(buildInsights(base)),
  );

  const thin = buildInsights({
    ...base,
    totals: { ...base.totals, netRevenue: 1000, transactions: 4 },
    margin: { cost: 900, grossProfit: 100, marginPct: 10, uncostedRevenue: 0 },
    comparison: { ...base.comparison, previous: { ...base.comparison.previous, netRevenue: 1000 }, revenueDeltaPct: 0 },
  });
  check(
    `margin di bawah ${LOW_MARGIN_PCT}% jadi peringatan`,
    thin.some((insight) => insight.level === "warn" && insight.text.includes("10%")),
    JSON.stringify(thin),
  );

  const lossy = buildInsights({
    ...base,
    totals: { ...base.totals, netRevenue: 1000, transactions: 3 },
    margin: { cost: 900, grossProfit: 100, marginPct: 25, uncostedRevenue: 0 },
    comparison: { ...base.comparison, previous: { ...base.comparison.previous, netRevenue: 1000 }, revenueDeltaPct: 0 },
    topProducts: [{ productId: "p2", name: "Rugi", category: "Lain", quantity: 1, revenue: 100, cost: 150, profit: -50, marginPct: -50, sharePct: 5 }],
    allProducts: [{ productId: "p2", name: "Rugi", category: "Lain", quantity: 1, revenue: 100, cost: 150, profit: -50, marginPct: -50, sharePct: 5 }],
  });
  check(
    "produk yang dijual di bawah harga beli disebut namanya",
    lossy.some((insight) => insight.level === "warn" && insight.text.includes("Rugi")),
    JSON.stringify(lossy),
  );

  const concentrated = buildInsights({
    ...base,
    totals: { ...base.totals, netRevenue: 1000, transactions: 3 },
    margin: { cost: 400, grossProfit: 600, marginPct: 60, uncostedRevenue: 0 },
    comparison: { ...base.comparison, previous: { ...base.comparison.previous, netRevenue: 1000 }, revenueDeltaPct: 0 },
    topProducts: [{ productId: "p1", name: "Kopi", category: "Minuman", quantity: 9, revenue: 900, cost: 300, profit: 600, marginPct: 66, sharePct: CONCENTRATION_PCT }],
    allProducts: [{ productId: "p1", name: "Kopi", category: "Minuman", quantity: 9, revenue: 900, cost: 300, profit: 600, marginPct: 66, sharePct: CONCENTRATION_PCT }],
  });
  check(
    `ketergantungan satu produk ≥${CONCENTRATION_PCT}% jadi peringatan`,
    concentrated.some((insight) => insight.level === "warn" && insight.text.includes("Kopi")),
    JSON.stringify(concentrated),
  );

  const busy = buildInsights({
    ...base,
    totals: { ...base.totals, netRevenue: 1000, transactions: 3 },
    margin: { cost: 400, grossProfit: 600, marginPct: 60, uncostedRevenue: 0 },
    comparison: { ...base.comparison, previous: { ...base.comparison.previous, netRevenue: 1000 }, revenueDeltaPct: 0 },
    busyHours: buildHourlyBreakdown(
      [sale("s1", localAt(2026, 9, 11, 23, 10), 900, 0, "cash", [])],
      WIB,
    ),
    weekday: buildWeekdayBreakdown([sale("s1", localAt(2026, 9, 11, 23, 10), 900, 0, "cash", [])], WIB),
  });
  check(
    "jam tersibuk disebut beserta rentangnya, termasuk pembungkusan 23 → 00",
    busy.some((insight) => insight.text.includes("23:00–00:00")),
    JSON.stringify(busy),
  );
  check(
    "hari paling ramai disebut namanya (Minggu)",
    busy.some((insight) => insight.level === "good" && insight.text.includes("Minggu")),
    JSON.stringify(busy),
  );

  const uncosted = buildInsights({
    ...base,
    totals: { ...base.totals, netRevenue: 1000, transactions: 2 },
    margin: { cost: 0, grossProfit: 1000, marginPct: 100, uncostedRevenue: 1000 },
    comparison: { ...base.comparison, previous: { ...base.comparison.previous, netRevenue: 1000 }, revenueDeltaPct: 0 },
  });
  check(
    "omzet tanpa harga beli diberitahukan supaya margin tidak dipercaya buta",
    uncosted.some((insight) => insight.text.includes("harga beli")),
    JSON.stringify(uncosted),
  );

  const longList = buildInsights({
    ...base,
    totals: { ...base.totals, netRevenue: 1000, transactions: 2 },
    margin: { cost: 900, grossProfit: 100, marginPct: 10, uncostedRevenue: 500 },
    comparison: { ...base.comparison, previous: { ...base.comparison.previous, netRevenue: 100 }, revenueDeltaPct: -30 },
    trend: buildTrend([], analyticsRange({ days: 7, now: NOW, timezoneOffsetMinutes: WIB }), WIB),
    topProducts: [{ productId: "p1", name: "Kopi", category: "Minuman", quantity: 1, revenue: 900, cost: 300, profit: 600, marginPct: 66, sharePct: 90 }],
    allProducts: [
      { productId: "p1", name: "Kopi", category: "Minuman", quantity: 1, revenue: 900, cost: 300, profit: 600, marginPct: 66, sharePct: 90 },
      { productId: "p2", name: "Rugi", category: "Lain", quantity: 1, revenue: 100, cost: 150, profit: -50, marginPct: -50, sharePct: 10 },
    ],
    busyHours: buildHourlyBreakdown([sale("s1", localAt(2026, 9, 11, 12), 900, 0, "cash", [])], WIB),
  });
  check(
    "daftar temuan dipotong maksimal 6 agar tetap terbaca",
    longList.length === 6,
    String(longList.length),
  );
}

// ------------------------------------------------------------- laporan lengkap
{
  const range = analyticsRange({ days: 7, now: NOW, timezoneOffsetMinutes: WIB });
  const currentSales = [
    sale("s1", localAt(2026, 9, 11, 12), 220_000, 0, "cash", [
      item("p1", "Kopi Susu", "Minuman", 2, 100_000, 50_000),
      item("p2", "Roti Bakar", "Makanan", 1, 120_000, 100_000),
    ]),
    sale("s2", localAt(2026, 9, 7, 9), 50_000, 0, "qris", [
      item("p1", "Kopi Susu", "Minuman", 1, 50_000, 25_000),
    ]),
  ];
  const previousSales = [
    sale("p0", localAt(2026, 9, 2, 12), 100_000, 0, "cash", [
      item("p1", "Kopi Susu", "Minuman", 2, 100_000, 60_000),
    ]),
  ];

  const report = buildAdvancedReport({
    sales: currentSales,
    previousSales,
    range,
    timezoneOffsetMinutes: WIB,
  });
  check(
    "laporan memuat periode, ringkasan, margin, dan seluruh pecahan",
    report.range.days === 7 &&
      report.totals.transactions === 2 &&
      report.totals.netRevenue === 270_000 &&
      report.trend.length === 7 &&
      report.busyHours.length === 24 &&
      report.weekday.length === 7 &&
      report.byCategory.length === 2 &&
      report.byMethod.length === 2,
    JSON.stringify({ totals: report.totals, kategori: report.byCategory.length }),
  );
  check(
    "margin laporan = omzet bersih − harga pokok (270.000 − 175.000)",
    report.margin.cost === 175_000 && report.margin.grossProfit === 95_000,
    JSON.stringify(report.margin),
  );
  check(
    "periode pembanding dipakai apa adanya untuk perbandingan",
    report.comparison.previous.netRevenue === 100_000 &&
      report.comparison.revenueDeltaPct === 170,
    JSON.stringify(report.comparison),
  );
  check(
    "temuan tidak kosong selama ada penjualan",
    report.insights.length > 0,
    JSON.stringify(report.insights),
  );
  check(
    "semua nominal bulat (tidak ada pecahan rupiah di layar)",
    Object.values(report.totals).every((value) => Number.isInteger(value)) &&
      Object.values(report.margin).every((value) => Number.isInteger(value)) &&
      report.topProducts.every((row) => Number.isInteger(row.revenue) && Number.isInteger(row.profit)),
  );
  check(
    "produk terlaris diurutkan dari omzet terbesar",
    report.topProducts[0].productId === "p1" &&
      report.topProducts[0].revenue === 150_000 &&
      report.topProducts.length === 2,
    JSON.stringify(report.topProducts.map((row) => [row.productId, row.revenue])),
  );

  const emptyReport = buildAdvancedReport({
    sales: [],
    range,
    timezoneOffsetMinutes: WIB,
  });
  check(
    "laporan tanpa penjualan tetap berbentuk lengkap dan tidak pecah",
    emptyReport.totals.transactions === 0 &&
      emptyReport.margin.marginPct === 0 &&
      emptyReport.trend.length === 7 &&
      emptyReport.topProducts.length === 0 &&
      emptyReport.insights.length > 0,
    JSON.stringify(emptyReport.insights),
  );
  check(
    "hari tepat di awal periode masuk periode ini, bukan pembanding",
    (() => {
      const probe = buildAdvancedReport({
        sales: [sale("sa", range.from, 10_000, 0, "cash", [])],
        previousSales: [sale("sb", range.from - 1, 999_000, 0, "cash", [])],
        range,
        timezoneOffsetMinutes: WIB,
      });
      return probe.totals.revenue === 10_000 && probe.comparison.previous.revenue === 999_000;
    })(),
  );
}

// ---------------------------------------- proyeksi akhir periode (enterprise)
{
  const range = analyticsRange({ days: 7, now: NOW, timezoneOffsetMinutes: WIB });
  // Periode 5–11 Okt; NOW = 11 Okt 17:00 WIB → 6 hari penuh, hari ini berjalan.
  const sales = [
    sale("a", localAt(2026, 9, 5, 10), 100_000, 0, "cash", [
      item("p1", "Kopi Susu", "Minuman", 1, 100_000, 40_000),
    ]),
    sale("b", localAt(2026, 9, 6, 10), 200_000, 0, "qris", [
      item("p1", "Kopi Susu", "Minuman", 2, 200_000, 100_000),
    ]),
    sale("c", localAt(2026, 9, 11, 9), 50_000, 0, "cash", [
      item("p1", "Kopi Susu", "Minuman", 1, 50_000, 20_000),
    ]),
  ];
  // Periode pembanding 28 Sep–4 Okt; hanya hari pertama yang masuk “6 hari penuh
  // pertama”, jadi angka kedua sengaja tidak boleh ikut terhitung.
  const previous = [
    sale("pa", localAt(2026, 8, 28, 10), 120_000, 0, "cash", [
      item("p1", "Kopi Susu", "Minuman", 1, 120_000, 50_000),
    ]),
    sale("pb", localAt(2026, 9, 4, 10), 500_000, 0, "cash", [
      item("p1", "Kopi Susu", "Minuman", 1, 500_000, 200_000),
    ]),
  ];
  const forecast = buildForecast({
    sales,
    previousSales: previous,
    range,
    now: NOW,
    timezoneOffsetMinutes: WIB,
  });

  check(
    "proyeksi memisahkan hari penuh dari hari yang sedang berjalan",
    forecast.elapsedDays === 6 &&
      forecast.todayCounted === true &&
      forecast.completedNet === 300_000 &&
      forecast.todayNet === 50_000 &&
      forecast.netRunRate === 50_000,
    JSON.stringify({
      hari: forecast.elapsedDays,
      penuh: forecast.completedNet,
      hariIni: forecast.todayNet,
      laju: forecast.netRunRate,
    }),
  );
  check(
    "proyeksi akhir periode = hari penuh + hari ini pada laju hariannya",
    forecast.projectedNet === 350_000 && forecast.projectedTransactions === 3,
    JSON.stringify({ omzet: forecast.projectedNet, transaksi: forecast.projectedTransactions }),
  );
  check(
    "proyeksi laba memakai laju laba, bukan laju omzet",
    forecast.completedProfit === 160_000 &&
      forecast.profitRunRate === 26_667 &&
      forecast.projectedProfit === 190_000,
    JSON.stringify({
      laju: forecast.profitRunRate,
      hariIni: forecast.todayProfit,
      proyeksi: forecast.projectedProfit,
    }),
  );
  check(
    "hari yang sudah melampaui lajunya tidak diproyeksikan turun",
    (() => {
      const probe = buildForecast({
        sales: [
          sale("a", localAt(2026, 9, 5, 10), 100_000, 0, "cash", []),
          sale("c", localAt(2026, 9, 11, 9), 400_000, 0, "cash", []),
        ],
        range,
        now: NOW,
        timezoneOffsetMinutes: WIB,
      });
      return (
        probe.netRunRate === 16_667 &&
        probe.todayNet === 400_000 &&
        probe.projectedNet === 500_000
      );
    })(),
  );
  check(
    "pembanding laju memakai jumlah hari penuh yang sama, bukan periode penuh",
    forecast.previousDays === 6 &&
      forecast.previousSamePaceNet === 120_000 &&
      forecast.paceDeltaPct === 150,
    JSON.stringify({
      hari: forecast.previousDays,
      pembanding: forecast.previousSamePaceNet,
      delta: forecast.paceDeltaPct,
    }),
  );

  const noFullDay = buildForecast({
    sales,
    range: analyticsRange({ days: 1, now: NOW, timezoneOffsetMinutes: WIB }),
    now: NOW,
    timezoneOffsetMinutes: WIB,
  });
  check(
    "tanpa satu hari penuh pun, proyeksinya mengaku belum punya dasar",
    FORECAST_MIN_DAYS === 1 &&
      noFullDay.elapsedDays === 0 &&
      noFullDay.hasBasis === false &&
      noFullDay.netRunRate === 0 &&
      noFullDay.projectedNet === noFullDay.todayNet,
    JSON.stringify({ hari: noFullDay.elapsedDays, proyeksi: noFullDay.projectedNet }),
  );

  const pastPeriod = buildForecast({
    sales,
    range,
    now: localAt(2026, 9, 12, 10),
    timezoneOffsetMinutes: WIB,
  });
  check(
    "periode yang sudah lewat tidak lagi punya hari berjalan",
    pastPeriod.elapsedDays === 7 &&
      pastPeriod.todayCounted === false &&
      pastPeriod.completedNet === 350_000 &&
      pastPeriod.todayNet === 0 &&
      pastPeriod.projectedNet === 350_000,
    JSON.stringify({
      hari: pastPeriod.elapsedDays,
      penuh: pastPeriod.completedNet,
      proyeksi: pastPeriod.projectedNet,
    }),
  );
}

// ---------------------------------------- analisis keranjang (enterprise)
{
  const basket = buildBasketReport([
    sale("k1", NOW, 90_000, 0, "cash", [
      item("p1", "Kopi Susu", "Minuman", 1, 30_000, 10_000),
      item("p2", "Roti Bakar", "Makanan", 1, 40_000, 20_000),
      item("p3", "Air Mineral", "Minuman", 1, 20_000, 5_000),
    ]),
    sale("k2", NOW, 70_000, 0, "qris", [
      item("p1", "Kopi Susu", "Minuman", 2, 40_000, 12_000),
      item("p2", "Roti Bakar", "Makanan", 1, 30_000, 15_000),
    ]),
    sale("k3", NOW, 30_000, 0, "cash", [
      item("p1", "Kopi Susu", "Minuman", 1, 30_000, 10_000),
    ]),
    sale("k4", NOW, 0, 0, "cash", []),
  ]);

  check(
    "keranjang: nota tanpa baris barang dilewati, bukan dihitung kosong",
    basket.receipts === 3 && basket.skippedReceipts === 1 && basket.items === 7,
    JSON.stringify({ nota: basket.receipts, dilewati: basket.skippedReceipts, barang: basket.items }),
  );
  check(
    "keranjang: rata-rata barang per nota & porsi nota berisi beberapa jenis",
    basket.averageItems === 2.33 &&
      basket.multiItemReceipts === 2 &&
      basket.multiItemSharePct === 67,
    JSON.stringify({
      rata: basket.averageItems,
      notaBanyak: basket.multiItemReceipts,
      porsi: basket.multiItemSharePct,
    }),
  );
  check(
    "keranjang: ukuran keranjang dipecah empat rentang & menjumlah ke seluruh nota",
    basket.sizes.length === 4 &&
      basket.sizes[0].label === "1 barang" &&
      basket.sizes[0].receipts === 1 &&
      basket.sizes[1].receipts === 0 &&
      basket.sizes[2].receipts === 2 &&
      basket.sizes.reduce((sum, row) => sum + row.receipts, 0) === basket.receipts &&
      basket.sizes.reduce((sum, row) => sum + row.sharePct, 0) === 100,
    JSON.stringify(basket.sizes.map((row) => [row.label, row.receipts, row.sharePct])),
  );
  check(
    "keranjang: pasangan dihitung sekali per nota & paling sering bersama di atas",
    basket.pairs.length === 3 &&
      basket.pairs[0].aId === "p1" &&
      basket.pairs[0].bId === "p2" &&
      basket.pairs[0].together === 2 &&
      basket.pairs[0].supportPct === 67 &&
      basket.pairs[0].lift === 1,
    JSON.stringify(basket.pairs.map((row) => [row.aName, row.bName, row.together, row.lift])),
  );
  check(
    "keranjang: lift memisahkan kebiasaan dari kebetulan (Air Mineral tidak laris sendiri)",
    basket.pairs[1].aId === "p2" &&
      basket.pairs[1].bId === "p3" &&
      basket.pairs[1].together === 1 &&
      basket.pairs[1].lift === 1.5 &&
      basket.pairs[2].lift === 1,
    JSON.stringify(basket.pairs.map((row) => [`${row.aId}+${row.bId}`, row.lift])),
  );
  check(
    "keranjang: omzet pasangan diambil dari kedua barisnya",
    basket.pairs[0].revenue === 140_000 &&
      basket.pairs[1].revenue === 60_000 &&
      basket.pairs[2].revenue === 50_000,
    JSON.stringify(basket.pairs.map((row) => [row.aName, row.revenue])),
  );
  check(
    "keranjang: batas pasangan membuat laporannya sebagian, bukan mengklaim lengkap",
    (() => {
      const banyak = [
        sale(
          "kr",
          NOW,
          0,
          0,
          "cash",
          Array.from({ length: 210 }, (_, index) =>
            item(`r${index}`, `Barang ${index}`, "Lain", 1, 1_000, 500),
          ),
        ),
      ];
      const laporan = buildBasketReport(banyak);
      const dipotong = buildBasketReport(banyak, 1);
      return (
        BASKET_PAIR_SCAN_LIMIT === 20_000 &&
        BASKET_PAIR_LIMIT === 8 &&
        laporan.truncated === true &&
        laporan.pairs.length === BASKET_PAIR_LIMIT &&
        dipotong.pairs.length === 1
      );
    })(),
  );
  check(
    "keranjang: laporan kosong tetap berbentuk sah, bukan angka karangan",
    (() => {
      const kosong = buildBasketReport([]);
      return (
        kosong.receipts === 0 && kosong.averageItems === 0 && kosong.pairs.length === 0 &&
        kosong.truncated === false && kosong.sizes.length === 4
      );
    })(),
  );
  check(
    "laporan analitik membawa proyeksi & keranjang bersama angka lamanya",
    (() => {
      const laporan = buildAdvancedReport({
        sales: [
          sale("z", localAt(2026, 9, 6, 10), 100_000, 0, "cash", [
            item("p1", "Kopi Susu", "Minuman", 2, 100_000, 40_000),
          ]),
        ],
        range: analyticsRange({ days: 7, now: NOW, timezoneOffsetMinutes: WIB }),
        now: NOW,
        timezoneOffsetMinutes: WIB,
      });
      return (
        laporan.forecast.elapsedDays === 6 &&
        laporan.forecast.hasBasis === true &&
        laporan.basket.receipts === 1 &&
        laporan.basket.items === 2 &&
        laporan.totals.netRevenue === 100_000
      );
    })(),
  );
}

console.log(`${results.length}/${results.length} checks passed`);

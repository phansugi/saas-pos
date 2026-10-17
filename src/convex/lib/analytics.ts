/**
 * Analitik lanjutan / BI (`report.advanced`, Phase 4).
 *
 * Laporan harian sudah menjawab "hari ini dapat berapa". Yang belum terjawab
 * adalah pertanyaan yang membuat pemilik mengambil keputusan: **arah** omzet
 * (naik atau turun dibanding periode sebelumnya), **margin** (bukan cuma omzet),
 * produk & kategori mana yang benar-benar menghasilkan uang, **jam dan hari**
 * sibuk untuk menyusun shift, dan ketergantungan pada satu produk.
 *
 * Semua angka dihitung dari satu sumber: baris penjualan (harga jual, harga
 * pokok, kategori, waktu). Modul ini murni — tanpa dependensi Convex — supaya
 * server, store demo, halaman Laporan, dan harness memakai perhitungan yang sama
 * persis. Yang dilihat pemilik di layar adalah angka yang sama dengan yang
 * dihitung server, bukan versi perkiraan di UI.
 *
 * Dua keputusan yang perlu diketahui:
 *
 * 1. **Margin dihitung dari omzet bersih (tanpa PPN).** PPN bukan pendapatan
 *    kita — ia uang negara yang kebetulan lewat kasir. `netRevenue` = `total`
 *    penjualan − `tax`, lalu `labaKotor = netRevenue − harga pokok`. Kalau ada
 *    produk yang belum punya harga beli, omzetnya dicatat di `uncostedRevenue`
 *    supaya margin yang kurang akurat **terlihat**, bukan disembunyikan.
 * 2. **Hari & jam dihitung memakai offset waktu klien** (menit, WIB = +420),
 *    bukan zona server: "jam tersibuk" harus jam dinding tempat tokonya berdiri.
 *
 * Periode dibandingkan dengan periode **sama panjang** tepat sebelumnya, jadi
 * "turun 12%" tidak pernah membandingkan 30 hari dengan 7 hari.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Pilihan periode yang masuk akal untuk laporan; lainnya dipepetkan. */
export const ANALYTICS_PERIODS = [7, 30, 90] as const;
export const DEFAULT_ANALYTICS_DAYS = 30;
export const MAX_ANALYTICS_DAYS = 90;
export const MIN_ANALYTICS_DAYS = 1;

/** Berapa baris teratas yang dikembalikan untuk produk & kategori. */
export const TOP_PRODUCT_LIMIT = 8;

/** Ambang yang dipakai untuk menyusun kalimat temuan. */
export const STABLE_REVENUE_PCT = 10;
export const LOW_MARGIN_PCT = 20;
export const HEALTHY_MARGIN_PCT = 40;
export const CONCENTRATION_PCT = 40;

export type InsightLevel = "warn" | "good" | "info";

/** Satu baris penjualan: nilai jual & harga pokoknya. */
export interface AnalyticsItemInput {
  productId: string;
  name: string;
  category?: string;
  quantity: number;
  /** Nilai jual baris **tanpa pajak**. */
  net: number;
  /** Harga pokok baris; 0 kalau harga beli produknya belum diketahui. */
  cost: number;
}

export interface AnalyticsSaleInput {
  id: string;
  createdAt: number;
  /** Nilai yang dibayar pelanggan (termasuk pajak). */
  total: number;
  tax: number;
  /**
   * Jenis pajak yang dipungut penjualan itu (`sales.taxKind`) — dipakai laporan
   * pajak & pungutan F&B. Baris lama/seed yang tidak mengisinya dibaca sebagai
   * PPN, karena itulah yang berlaku saat barisnya ditulis.
   */
  taxKind?: "none" | "ppn" | "regional";
  /** Biaya layanan yang dipungut penjualan itu (bukan pajak); kosong = 0. */
  serviceCharge?: number;
  discount?: number;
  /** Kunci metode kanonik: `cash` | `qris` | `card` | `transfer`. */
  method: string;
  items: readonly AnalyticsItemInput[];
}

export interface AnalyticsRange {
  /** Awal periode (termasuk). */
  from: number;
  /** Akhir periode (eksklusif) — tengah malam lokal setelah hari terakhir. */
  to: number;
  days: number;
}

export interface PeriodTotals {
  revenue: number;
  netRevenue: number;
  tax: number;
  discount: number;
  transactions: number;
  itemCount: number;
  averageBasket: number;
}

export interface MarginTotals {
  cost: number;
  grossProfit: number;
  /** Persen laba kotor terhadap omzet bersih (dibulatkan). */
  marginPct: number;
  /** Omzet dari produk yang **belum** punya harga beli — margin belum akurat. */
  uncostedRevenue: number;
}

export interface TrendPoint {
  /** `YYYY-MM-DD` lokal; dipakai sebagai kunci React. */
  key: string;
  /** Label pendek untuk sumbu/daftar, mis. "12 Okt". */
  label: string;
  /** Awal hari itu (ms UTC). */
  from: number;
  revenue: number;
  transactions: number;
}

export interface ProductRow {
  productId: string;
  name: string;
  category: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
  marginPct: number;
  /** Porsi omzet bersih (persen, dibulatkan). */
  sharePct: number;
}

export interface CategoryRow {
  category: string;
  revenue: number;
  profit: number;
  sharePct: number;
}

export interface MethodRow {
  method: string;
  revenue: number;
  transactions: number;
  sharePct: number;
}

export interface HourRow {
  hour: number;
  revenue: number;
  transactions: number;
}

export interface WeekdayRow {
  /** 0 = Minggu … 6 = Sabtu. */
  weekday: number;
  revenue: number;
  transactions: number;
}

export interface PeriodComparison {
  previous: PeriodTotals;
  previousMargin: MarginTotals;
  /** Perubahan omzet dalam persen; `null` kalau periode sebelumnya kosong. */
  revenueDeltaPct: number | null;
  transactionsDeltaPct: number | null;
  averageBasketDeltaPct: number | null;
  /** Perubahan margin dalam **poin persen** (bukan persen relatif). */
  marginPctDelta: number;
}

export interface Insight {
  level: InsightLevel;
  text: string;
}

export interface AdvancedReport {
  range: AnalyticsRange;
  totals: PeriodTotals;
  margin: MarginTotals;
  trend: TrendPoint[];
  topProducts: ProductRow[];
  byCategory: CategoryRow[];
  byMethod: MethodRow[];
  busyHours: HourRow[];
  weekday: WeekdayRow[];
  comparison: PeriodComparison;
  /**
   * Proyeksi akhir periode dari laju hari-hari penuh (bagian enterprise: bukan
   * hanya “berapa yang sudah masuk”, tetapi “berapa yang akan masuk”).
   */
  forecast: ForecastReport;
  /** Analisis keranjang: ukuran keranjang & produk yang sering dibeli bersama. */
  basket: BasketReport;
  insights: Insight[];
}

function truncate(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function share(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Nama hari & bulan Indonesia, singkat, dipakai label grafik. */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];
const WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

function shifted(ts: number, offsetMinutes: number): Date {
  return new Date(ts + offsetMinutes * 60_000);
}

/** Kunci hari lokal (`YYYY-MM-DD`). */
export function dayKey(ts: number, offsetMinutes = 0): string {
  return shifted(ts, offsetMinutes).toISOString().slice(0, 10);
}

/** Label pendek hari, mis. "12 Okt". */
export function dayLabel(ts: number, offsetMinutes = 0): string {
  const date = shifted(ts, offsetMinutes);
  return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]}`;
}

export function hourOf(ts: number, offsetMinutes = 0): number {
  return shifted(ts, offsetMinutes).getUTCHours();
}

export function weekdayOf(ts: number, offsetMinutes = 0): number {
  return shifted(ts, offsetMinutes).getUTCDay();
}

export function weekdayLabel(weekday: number): string {
  return WEEKDAYS[weekday] ?? "-";
}

/**
 * Periode laporan: `days` hari terakhir **sampai hari ini**, berakhir di tengah
 * malam lokal berikutnya sehingga jumlah titik grafiknya selalu sama dengan
 * jumlah hari yang diminta.
 */
export function analyticsRange(args: {
  days: number;
  now: number;
  timezoneOffsetMinutes?: number;
}): AnalyticsRange {
  const offset = args.timezoneOffsetMinutes ?? 0;
  const days = resolveAnalyticsDays(args.days);
  const localNow = args.now + offset * 60_000;
  const localMidnight = Math.floor(localNow / DAY_MS) * DAY_MS;
  const to = localMidnight + DAY_MS - offset * 60_000;
  return { from: to - days * DAY_MS, to, days };
}

/** Periode pembanding: `days` hari tepat sebelum periode ini. */
export function previousRange(range: AnalyticsRange): AnalyticsRange {
  return {
    from: range.from - range.days * DAY_MS,
    to: range.from,
    days: range.days,
  };
}

export function resolveAnalyticsDays(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_ANALYTICS_DAYS;
  return Math.min(MAX_ANALYTICS_DAYS, Math.max(MIN_ANALYTICS_DAYS, Math.trunc(value)));
}

/** Baris penjualan hanya dihitung sekali; penjualan di luar periode diabaikan. */
function inRange(sale: AnalyticsSaleInput, range: AnalyticsRange): boolean {
  return sale.createdAt >= range.from && sale.createdAt < range.to;
}

function netOf(sale: AnalyticsSaleInput): number {
  // Omzet bersih = yang dibayar pelanggan dikurangi pajak. Barisnya dipakai
  // untuk rincian produk, jadi tidak ada penjumlahan yang perlu dipercaya buta.
  return truncate(sale.total) - truncate(sale.tax);
}

export function summariseSales(sales: readonly AnalyticsSaleInput[]): PeriodTotals {
  let revenue = 0;
  let netRevenue = 0;
  let tax = 0;
  let discount = 0;
  let itemCount = 0;

  for (const sale of sales) {
    revenue += truncate(sale.total);
    tax += truncate(sale.tax);
    discount += truncate(sale.discount ?? 0);
    netRevenue += netOf(sale);
    for (const item of sale.items) itemCount += truncate(item.quantity);
  }

  return {
    revenue,
    netRevenue,
    tax,
    discount,
    transactions: sales.length,
    itemCount,
    averageBasket: sales.length > 0 ? Math.round(netRevenue / sales.length) : 0,
  };
}

export function marginOf(sales: readonly AnalyticsSaleInput[]): MarginTotals {
  let cost = 0;
  let netRevenue = 0;
  let uncostedRevenue = 0;

  for (const sale of sales) {
    netRevenue += netOf(sale);
    for (const item of sale.items) {
      cost += truncate(item.cost);
      if (truncate(item.cost) <= 0) uncostedRevenue += truncate(item.net);
    }
  }

  const grossProfit = netRevenue - cost;
  return {
    cost,
    grossProfit,
    marginPct: netRevenue > 0 ? Math.round((grossProfit / netRevenue) * 100) : 0,
    uncostedRevenue,
  };
}

/** Satu titik per hari, termasuk hari tanpa penjualan (bukan dilompati). */
export function buildTrend(
  sales: readonly AnalyticsSaleInput[],
  range: AnalyticsRange,
  timezoneOffsetMinutes = 0,
): TrendPoint[] {
  const points: TrendPoint[] = [];
  const index = new Map<string, TrendPoint>();

  for (let i = 0; i < range.days; i += 1) {
    const from = range.from + i * DAY_MS;
    const point: TrendPoint = {
      key: dayKey(from, timezoneOffsetMinutes),
      label: dayLabel(from, timezoneOffsetMinutes),
      from,
      revenue: 0,
      transactions: 0,
    };
    points.push(point);
    index.set(point.key, point);
  }

  for (const sale of sales) {
    if (!inRange(sale, range)) continue;
    const point = index.get(dayKey(sale.createdAt, timezoneOffsetMinutes));
    if (!point) continue;
    point.revenue += netOf(sale);
    point.transactions += 1;
  }

  return points;
}

export function buildProductBreakdown(
  sales: readonly AnalyticsSaleInput[],
  limit = TOP_PRODUCT_LIMIT,
): ProductRow[] {
  const rows = new Map<string, ProductRow>();
  let totalNet = 0;

  for (const sale of sales) {
    for (const item of sale.items) {
      const key = item.productId;
      const current =
        rows.get(key) ??
        {
          productId: key,
          name: item.name,
          category: item.category ?? "Tanpa kategori",
          quantity: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
          marginPct: 0,
          sharePct: 0,
        };
      current.quantity += truncate(item.quantity);
      current.revenue += truncate(item.net);
      current.cost += truncate(item.cost);
      rows.set(key, current);
      totalNet += truncate(item.net);
    }
  }

  const list = [...rows.values()].map((row) => {
    const profit = row.revenue - row.cost;
    return {
      ...row,
      profit,
      marginPct: row.revenue > 0 ? Math.round((profit / row.revenue) * 100) : 0,
      sharePct: share(row.revenue, totalNet),
    };
  });

  // Urutan: omzet terbesar dulu. Kalau seri, laba terbesar yang menang supaya
  // produk bervolume besar tetapi tipis tidak mendahului yang menguntungkan.
  list.sort((a, b) => b.revenue - a.revenue || b.profit - a.profit || a.name.localeCompare(b.name));
  return limit > 0 ? list.slice(0, limit) : list;
}

export function buildCategoryBreakdown(
  sales: readonly AnalyticsSaleInput[],
): CategoryRow[] {
  const rows = new Map<string, CategoryRow>();
  let totalNet = 0;

  for (const sale of sales) {
    for (const item of sale.items) {
      const key = item.category?.trim() || "Tanpa kategori";
      const current = rows.get(key) ?? { category: key, revenue: 0, profit: 0, sharePct: 0 };
      current.revenue += truncate(item.net);
      current.profit += truncate(item.net) - truncate(item.cost);
      rows.set(key, current);
      totalNet += truncate(item.net);
    }
  }

  return [...rows.values()]
    .map((row) => ({ ...row, sharePct: share(row.revenue, totalNet) }))
    .sort((a, b) => b.revenue - a.revenue || a.category.localeCompare(b.category));
}

export function buildMethodBreakdown(sales: readonly AnalyticsSaleInput[]): MethodRow[] {
  const rows = new Map<string, MethodRow>();
  let total = 0;

  for (const sale of sales) {
    const key = sale.method;
    const current = rows.get(key) ?? { method: key, revenue: 0, transactions: 0, sharePct: 0 };
    current.revenue += truncate(sale.total);
    current.transactions += 1;
    rows.set(key, current);
    total += truncate(sale.total);
  }

  return [...rows.values()]
    .map((row) => ({ ...row, sharePct: share(row.revenue, total) }))
    .sort((a, b) => b.revenue - a.revenue || a.method.localeCompare(b.method));
}

export function buildHourlyBreakdown(
  sales: readonly AnalyticsSaleInput[],
  timezoneOffsetMinutes = 0,
): HourRow[] {
  const hours: HourRow[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    revenue: 0,
    transactions: 0,
  }));

  for (const sale of sales) {
    const row = hours[hourOf(sale.createdAt, timezoneOffsetMinutes)];
    if (!row) continue;
    row.revenue += netOf(sale);
    row.transactions += 1;
  }

  return hours;
}

export function buildWeekdayBreakdown(
  sales: readonly AnalyticsSaleInput[],
  timezoneOffsetMinutes = 0,
): WeekdayRow[] {
  const days: WeekdayRow[] = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    revenue: 0,
    transactions: 0,
  }));

  for (const sale of sales) {
    const row = days[weekdayOf(sale.createdAt, timezoneOffsetMinutes)];
    if (!row) continue;
    row.revenue += netOf(sale);
    row.transactions += 1;
  }

  return days;
}

export function comparePeriods(args: {
  current: PeriodTotals;
  previous: PeriodTotals;
  currentMargin: MarginTotals;
  previousMargin: MarginTotals;
}): PeriodComparison {
  return {
    previous: args.previous,
    previousMargin: args.previousMargin,
    revenueDeltaPct: pctChange(args.current.netRevenue, args.previous.netRevenue),
    transactionsDeltaPct: pctChange(args.current.transactions, args.previous.transactions),
    averageBasketDeltaPct: pctChange(
      args.current.averageBasket,
      args.previous.averageBasket,
    ),
    marginPctDelta: args.currentMargin.marginPct - args.previousMargin.marginPct,
  };
}

/* --------------------------------------------------------------- proyeksi */

/**
 * Berapa hari penuh yang harus sudah lewat sebelum laju harian dipakai untuk
 * memproyeksikan periode. Hari yang sedang berjalan sengaja **tidak** dihitung:
 * pagi hari selalu terlihat seperti penurunan, dan proyeksi yang berubah-ubah
 * mengikuti jam lebih buruk daripada proyeksi yang mengaku belum punya dasar.
 */
export const FORECAST_MIN_DAYS = 1;

export interface ForecastReport {
  /** Hari **penuh** yang sudah lewat di dalam periode (dasar laju). */
  elapsedDays: number;
  /**
   * Hari ini masuk periode yang dibaca, dan bagiannya belum dihitung penuh.
   * Periode laporan selalu berakhir di tengah malam nanti, jadi inilah satu-satunya
   * bagian periode yang masih berjalan.
   */
  todayCounted: boolean;
  completedNet: number;
  completedProfit: number;
  completedTransactions: number;
  /** Omzet bersih hari ini — bagian hari yang belum selesai. */
  todayNet: number;
  todayProfit: number;
  todayTransactions: number;
  netRunRate: number;
  profitRunRate: number;
  transactionRunRate: number;
  /**
   * Perkiraan angka **akhir periode**: hari-hari penuh yang sudah tercatat + hari
   * ini diperkirakan ditutup pada laju hariannya (tidak lebih kecil daripada yang
   * sudah masuk hari ini).
   */
  projectedNet: number;
  projectedProfit: number;
  projectedTransactions: number;
  /** Ada minimal satu hari penuh? Kalau tidak, proyeksinya belum layak dipercaya. */
  hasBasis: boolean;
  /**
   * Jumlah hari yang dibandingkan pada periode sebelumnya: **sama dengan jumlah
   * hari penuh** periode ini, sehingga hari yang sedang berjalan tidak ikut
   * menyeret perbandingannya.
   */
  previousDays: number;
  /** Omzet bersih periode sebelumnya pada jumlah hari yang sama. */
  previousSamePaceNet: number;
  previousSamePaceTransactions: number;
  /** Laju periode ini vs periode sebelumnya pada rentang hari yang sama (%). */
  paceDeltaPct: number | null;
}

/**
 * Proyeksi akhir periode: dari laju hari-hari **penuh** yang sudah lewat, bukan
 * dari rata-rata seluruh periode (hari yang sedang berjalan akan menyeretnya
 * turun lalu naik lagi sepanjang hari — pagi hari selalu terlihat seperti
 * penurunan).
 *
 * Ambang “hari penuh” memakai tengah malam lokal klien, sama seperti batas
 * periode analitik — jadi “hari” di sini hari dinding toko, bukan hari server.
 * Bagian periode yang masih berjalan itu hari ini, jadi proyeksinya = hari-hari
 * penuh + hari ini pada lajunya; kalau periode yang dibaca sudah lewat
 * sepenuhnya (tidak ada hari berjalan), proyeksinya sama dengan yang tercatat.
 *
 * Pembandingnya sengaja **bukan** periode sebelumnya penuh, melainkan periode
 * sebelumnya pada **jumlah hari yang sama** — membandingkan 29 hari yang sudah
 * lewat dengan 30 hari periode lalu membuat laju selalu terlihat turun.
 */
export function buildForecast(args: {
  sales: readonly AnalyticsSaleInput[];
  previousSales?: readonly AnalyticsSaleInput[];
  range: AnalyticsRange;
  now?: number;
  timezoneOffsetMinutes?: number;
}): ForecastReport {
  const offset = args.timezoneOffsetMinutes ?? 0;
  const now = args.now ?? args.range.to - DAY_MS;
  const todayStart = Math.floor((now + offset * 60_000) / DAY_MS) * DAY_MS - offset * 60_000;
  const cut = Math.min(todayStart, args.range.to);
  const elapsedDays = Math.min(
    args.range.days,
    Math.max(0, Math.round((cut - args.range.from) / DAY_MS)),
  );
  const todayCounted = todayStart >= args.range.from && todayStart < args.range.to;

  const completed: AnalyticsSaleInput[] = [];
  const running: AnalyticsSaleInput[] = [];
  for (const sale of args.sales) {
    // Baris di luar periode diabaikan di sini juga, bukan cuma di pemanggil: fungsi
    // ini sering dipanggil dengan daftar yang lebih lebar (periode + pembandingnya).
    if (!inRange(sale, args.range)) continue;
    (sale.createdAt < cut ? completed : running).push(sale);
  }

  const completedTotals = summariseSales(completed);
  const runningTotals = summariseSales(running);
  const completedProfit = marginOf(completed).grossProfit;
  const todayProfit = marginOf(running).grossProfit;
  const hasBasis = elapsedDays >= FORECAST_MIN_DAYS;

  const netRunRate = hasBasis ? Math.round(completedTotals.netRevenue / elapsedDays) : 0;
  const profitRunRate = hasBasis ? Math.round(completedProfit / elapsedDays) : 0;
  const transactionRunRate = hasBasis
    ? Math.round(completedTotals.transactions / elapsedDays)
    : 0;

  // Lajunya dibandingkan hari penuh dengan hari penuh: periode sebelumnya dipotong
  // pada jumlah hari yang sama, bukan diadu dengan periode penuh yang lebih panjang.
  const previousDays = elapsedDays;
  const previousRangeDays = previousRange(args.range);
  const previousCut = previousRangeDays.from + previousDays * DAY_MS;
  let previousSamePaceNet = 0;
  let previousSamePaceTransactions = 0;
  for (const sale of args.previousSales ?? []) {
    if (!inRange(sale, previousRangeDays)) continue;
    if (sale.createdAt >= previousCut) continue;
    previousSamePaceNet += netOf(sale);
    previousSamePaceTransactions += 1;
  }

  const soFarNet = completedTotals.netRevenue + runningTotals.netRevenue;
  const soFarProfit = completedProfit + todayProfit;
  const soFarTransactions = completedTotals.transactions + runningTotals.transactions;
  /** Proyeksi hanya masuk akal kalau ada laju **dan** bagian yang masih berjalan. */
  const forecastable = hasBasis && todayCounted;

  return {
    elapsedDays,
    todayCounted,
    completedNet: completedTotals.netRevenue,
    completedProfit,
    completedTransactions: completedTotals.transactions,
    todayNet: runningTotals.netRevenue,
    todayProfit,
    todayTransactions: runningTotals.transactions,
    netRunRate,
    profitRunRate,
    transactionRunRate,
    // Hari ini diperkirakan ditutup pada laju hariannya; kalau bagiannya yang
    // sudah masuk justru lebih tinggi, angka itu yang dipakai (proyeksi tidak
    // boleh meramalkan penurunan yang belum terjadi). Kalau tidak ada hari yang
    // sedang berjalan — atau belum ada satu hari penuh pun — proyeksinya sama
    // dengan yang tercatat, bukan angka tambahan.
    projectedNet: forecastable
      ? completedTotals.netRevenue + Math.max(runningTotals.netRevenue, netRunRate)
      : soFarNet,
    projectedProfit: forecastable
      ? completedProfit + Math.max(todayProfit, profitRunRate)
      : soFarProfit,
    projectedTransactions: forecastable
      ? completedTotals.transactions +
        Math.max(runningTotals.transactions, transactionRunRate)
      : soFarTransactions,
    hasBasis,
    previousDays,
    previousSamePaceNet,
    previousSamePaceTransactions,
    paceDeltaPct: pctChange(completedTotals.netRevenue, previousSamePaceNet),
  };
}

/* ---------------------------------------------------------------- keranjang */

/** Berapa pasangan produk yang dilaporkan (paling sering dibeli bersama). */
export const BASKET_PAIR_LIMIT = 8;

/**
 * Batas jumlah pasangan berbeda yang dipindai. Satu nota dengan 60 jenis barang
 * sudah menghasilkan 1.770 pasangan; tanpa batas, satu nota raksasa bisa
 * menghabiskan memori laporan. Kalau batasnya tersentuh, itu **dilaporkan**
 * (`truncated`), bukan disembunyikan.
 */
export const BASKET_PAIR_SCAN_LIMIT = 20_000;

export interface BasketSizeRow {
  label: string;
  minItems: number;
  /** `null` = tanpa batas atas. */
  maxItems: number | null;
  receipts: number;
  sharePct: number;
  /** Omzet bersih nota-nota di rentang ukuran ini. */
  revenue: number;
}

export interface BasketPairRow {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  /** Nota yang memuat kedua produk itu. */
  together: number;
  /** Porsi nota yang memuat keduanya (%). */
  supportPct: number;
  /**
   * Berapa kali lebih sering keduanya muncul bersama dibanding kalau keduanya
   * saling bebas (1 = tidak ada hubungan, > 1 = saling menarik).
   */
  lift: number;
  /** Omzet bersih kedua baris itu di nota-nota yang memuat keduanya. */
  revenue: number;
}

export interface BasketReport {
  /** Nota yang ikut dihitung (punya minimal satu barang). */
  receipts: number;
  /** Nota tanpa baris barang — dilewati, bukan dihitung sebagai keranjang kosong. */
  skippedReceipts: number;
  items: number;
  /** Rata-rata barang per nota (dua angka di belakang koma). */
  averageItems: number;
  /** Nota dengan minimal dua **jenis** barang berbeda. */
  multiItemReceipts: number;
  multiItemSharePct: number;
  sizes: BasketSizeRow[];
  pairs: BasketPairRow[];
  pairLimit: number;
  /** Pemindaian pasangan dihentikan karena batas — angkanya sebagian. */
  truncated: boolean;
}

/** Rentang ukuran keranjang yang dilaporkan; jumlah barang di luar ini masuk “6+”. */
const BASKET_SIZES: Array<{ label: string; minItems: number; maxItems: number | null }> = [
  { label: "1 barang", minItems: 1, maxItems: 1 },
  { label: "2 barang", minItems: 2, maxItems: 2 },
  { label: "3-5 barang", minItems: 3, maxItems: 5 },
  { label: "6 barang atau lebih", minItems: 6, maxItems: null },
];

function basketSizeIndex(quantity: number): number {
  if (quantity <= 1) return 0;
  if (quantity === 2) return 1;
  if (quantity <= 5) return 2;
  return 3;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Analisis keranjang: berapa barang yang biasanya dibawa pulang satu pelanggan,
 * dan **produk mana yang sering dibeli bersama** — dasar keputusan bundling & tata
 * letak rak. Semua dari baris penjualan yang sudah ada, tanpa data baru.
 *
 * Satu produk dihitung **sekali per nota** (dua baris produk yang sama tidak
 * membuat “pasangan” dengan dirinya sendiri), dan yang memisahkan kebiasaan dari
 * kebetulan adalah `lift`: produk yang memang laris akan sering muncul di mana-mana,
 * jadi pasangan yang sering tetapi tidak lebih sering daripada kebiasaannya bukan
 * temuan.
 */
export function buildBasketReport(
  sales: readonly AnalyticsSaleInput[],
  limit = BASKET_PAIR_LIMIT,
): BasketReport {
  const sizeReceipts = BASKET_SIZES.map(() => 0);
  const sizeRevenue = BASKET_SIZES.map(() => 0);
  const productReceipts = new Map<string, number>();
  const pairs = new Map<string, { aId: string; bId: string; aName: string; bName: string; together: number; revenue: number }>();

  let receipts = 0;
  let skippedReceipts = 0;
  let items = 0;
  let multiItemReceipts = 0;
  let truncated = false;

  for (const sale of sales) {
    const distinct = new Map<string, { name: string; net: number }>();
    let quantity = 0;
    for (const item of sale.items) {
      const qty = truncate(item.quantity);
      quantity += qty;
      items += qty;
      const current = distinct.get(item.productId) ?? { name: item.name, net: 0 };
      current.net += truncate(item.net);
      distinct.set(item.productId, current);
    }
    if (distinct.size === 0) {
      skippedReceipts += 1;
      continue;
    }

    receipts += 1;
    const bucket = basketSizeIndex(quantity);
    sizeReceipts[bucket] += 1;
    sizeRevenue[bucket] += netOf(sale);
    if (distinct.size >= 2) multiItemReceipts += 1;

    const entries = [...distinct.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [id] of entries) {
      productReceipts.set(id, (productReceipts.get(id) ?? 0) + 1);
    }

    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const [aId, a] = entries[i];
        const [bId, b] = entries[j];
        const key = `${aId}\u0000${bId}`;
        const revenue = a.net + b.net;
        const current = pairs.get(key);
        if (current) {
          current.together += 1;
          current.revenue += revenue;
          continue;
        }
        if (pairs.size >= BASKET_PAIR_SCAN_LIMIT) {
          truncated = true;
          continue;
        }
        pairs.set(key, {
          aId,
          bId,
          aName: a.name,
          bName: b.name,
          together: 1,
          revenue,
        });
      }
    }
  }

  const list: BasketPairRow[] = [...pairs.values()].map((pair) => {
    const countA = productReceipts.get(pair.aId) ?? 0;
    const countB = productReceipts.get(pair.bId) ?? 0;
    // Kebiasaan masing-masing produk: kalau keduanya saling bebas, porsi nota yang
    // memuat keduanya adalah hasil kali keduanya. `lift` = seberapa jauh kenyataannya
    // melampaui itu.
    const independent =
      receipts > 0 ? (countA / receipts) * (countB / receipts) * receipts : 0;
    return {
      ...pair,
      supportPct: share(pair.together, receipts),
      lift: independent > 0 ? round2(pair.together / independent) : 0,
    };
  });

  list.sort(
    (a, b) =>
      b.together - a.together ||
      b.lift - a.lift ||
      b.revenue - a.revenue ||
      a.aName.localeCompare(b.aName) ||
      a.bName.localeCompare(b.bName),
  );

  return {
    receipts,
    skippedReceipts,
    items,
    averageItems: receipts > 0 ? round2(items / receipts) : 0,
    multiItemReceipts,
    multiItemSharePct: share(multiItemReceipts, receipts),
    sizes: BASKET_SIZES.map((bucket, index) => ({
      ...bucket,
      receipts: sizeReceipts[index],
      sharePct: share(sizeReceipts[index], receipts),
      revenue: sizeRevenue[index],
    })),
    pairs: limit > 0 ? list.slice(0, limit) : list,
    pairLimit: limit,
    truncated,
  };
}

/**
 * Kalimat temuan: satu bagian yang paling mudah dilewatkan orang — mengubah
 * angka menjadi keputusan. Urutannya penting (peringatan lebih dulu), karena
 * daftar ini dipotong di halaman.
 */
export function buildInsights(args: {
  totals: PeriodTotals;
  margin: MarginTotals;
  comparison: PeriodComparison;
  trend: TrendPoint[];
  topProducts: ProductRow[];
  allProducts: readonly ProductRow[];
  busyHours: HourRow[];
  weekday: WeekdayRow[];
}): Insight[] {
  const warnings: Insight[] = [];
  const goods: Insight[] = [];
  const infos: Insight[] = [];

  const delta = args.comparison.revenueDeltaPct;
  if (delta === null) {
    infos.push({
      level: "info",
      text: "Belum ada penjualan pada periode pembanding, jadi arah omzet belum bisa dibandingkan.",
    });
  } else if (delta >= STABLE_REVENUE_PCT) {
    goods.push({
      level: "good",
      text: `Omzet naik ${delta}% dibanding ${args.comparison.previous.transactions} periode sebelumnya.`,
    });
  } else if (delta <= -STABLE_REVENUE_PCT) {
    warnings.push({
      level: "warn",
      text: `Omzet turun ${Math.abs(delta)}% dibanding periode sebelumnya — periksa hari atau produk yang melemah.`,
    });
  } else {
    infos.push({
      level: "info",
      text: `Omzet relatif stabil (${delta >= 0 ? "+" : ""}${delta}%) dibanding periode sebelumnya.`,
    });
  }

  if (args.totals.transactions === 0) {
    warnings.push({
      level: "warn",
      text: "Tidak ada penjualan sama sekali pada periode ini.",
    });
  } else if (args.margin.marginPct < LOW_MARGIN_PCT) {
    warnings.push({
      level: "warn",
      text: `Margin kotor hanya ${args.margin.marginPct}% — periksa harga jual atau harga beli produk terlaris.`,
    });
  } else if (args.margin.marginPct >= HEALTHY_MARGIN_PCT) {
    goods.push({
      level: "good",
      text: `Margin kotor sehat: ${args.margin.marginPct}% dari omzet bersih.`,
    });
  }

  const loss = args.allProducts.filter((row) => row.profit < 0);
  if (loss.length > 0) {
    warnings.push({
      level: "warn",
      text: `${loss.length} produk terjual di bawah harga beli (${loss
        .slice(0, 2)
        .map((row) => row.name)
        .join(", ")}).`,
    });
  }

  const leader = args.topProducts[0];
  if (leader && leader.sharePct >= CONCENTRATION_PCT) {
    warnings.push({
      level: "warn",
      text: `Omzet bergantung pada satu produk: ${leader.name} menyumbang ${leader.sharePct}%.`,
    });
  }

  const emptyDays = args.trend.filter((point) => point.transactions === 0);
  if (emptyDays.length > 0 && args.totals.transactions > 0) {
    infos.push({
      level: "info",
      text: `${emptyDays.length} hari tanpa penjualan dalam periode ini.`,
    });
  }

  if (args.margin.uncostedRevenue > 0) {
    infos.push({
      level: "info",
      text: "Sebagian produk belum punya harga beli, jadi marginnya belum dihitung penuh.",
    });
  }

  const busiest = args.busyHours
    .slice()
    .sort((a, b) => b.revenue - a.revenue || a.hour - b.hour)[0];
  if (busiest && busiest.revenue > 0) {
    infos.push({
      level: "info",
      text: `Jam tersibuk ${String(busiest.hour).padStart(2, "0")}:00–${String(
        (busiest.hour + 1) % 24,
      ).padStart(2, "0")}:00 — siapkan shift di situ.`,
    });
  }

  const bestDay = args.weekday
    .slice()
    .sort((a, b) => b.revenue - a.revenue || a.weekday - b.weekday)[0];
  if (bestDay && bestDay.revenue > 0) {
    goods.push({
      level: "good",
      text: `${weekdayLabel(bestDay.weekday)} paling ramai dalam periode ini.`,
    });
  }

  return [...warnings, ...goods, ...infos].slice(0, 6);
}

export function buildAdvancedReport(args: {
  sales: readonly AnalyticsSaleInput[];
  previousSales?: readonly AnalyticsSaleInput[];
  range: AnalyticsRange;
  timezoneOffsetMinutes?: number;
  /**
   * “Sekarang” menurut pemanggil (ms). Dipakai proyeksi untuk tahu hari mana yang
   * sudah dihitung penuh; kalau kosong, hari terakhir periode dianggap baru mulai.
   */
  now?: number;
  topLimit?: number;
  /** Batas pasangan produk yang dilaporkan di analisis keranjang. */
  basketPairLimit?: number;
}): AdvancedReport {
  const offset = args.timezoneOffsetMinutes ?? 0;
  const current = args.sales.filter((sale) => inRange(sale, args.range));
  const previous = (args.previousSales ?? []).filter((sale) =>
    inRange(sale, previousRange(args.range)),
  );

  const totals = summariseSales(current);
  const margin = marginOf(current);
  const previousTotals = summariseSales(previous);
  const previousMargin = marginOf(previous);
  const trend = buildTrend(current, args.range, offset);
  const topProducts = buildProductBreakdown(current, args.topLimit ?? TOP_PRODUCT_LIMIT);
  const allProducts = buildProductBreakdown(current, 0);

  return {
    range: args.range,
    totals,
    margin,
    trend,
    topProducts,
    byCategory: buildCategoryBreakdown(current),
    byMethod: buildMethodBreakdown(current),
    busyHours: buildHourlyBreakdown(current, offset),
    weekday: buildWeekdayBreakdown(current, offset),
    comparison: comparePeriods({
      current: totals,
      previous: previousTotals,
      currentMargin: margin,
      previousMargin,
    }),
    forecast: buildForecast({
      sales: current,
      previousSales: previous,
      range: args.range,
      now: args.now,
      timezoneOffsetMinutes: offset,
    }),
    basket: buildBasketReport(current, args.basketPairLimit ?? BASKET_PAIR_LIMIT),
    insights: buildInsights({
      totals,
      margin,
      comparison: comparePeriods({
        current: totals,
        previous: previousTotals,
        currentMargin: margin,
        previousMargin,
      }),
      trend,
      topProducts,
      allProducts,
      busyHours: buildHourlyBreakdown(current, offset),
      weekday: buildWeekdayBreakdown(current, offset),
    }),
  };
}

import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  Clock,
  Info,
  Landmark,
  Lightbulb,
  Lock,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ANALYTICS_PERIODS, type InsightLevel } from "@/lib/analytics";
import {
  fnbCurrentMonthSummary,
  fnbTaxMonthReport,
  fnbTaxReportTotals,
  formatPctPlain,
  microExemptWarning,
  UMKM_FINAL_RATE_PCT,
} from "@/lib/fnbTax";
import { describeBudget } from "@/lib/scale";
import { useSession } from "@/lib/session";
import { PAYMENT_LABELS, useStore } from "@/lib/store";
import { featureUnavailableReason } from "@/lib/store/modules";
import { formatIDR, cn } from "@/lib/utils";

/** Tinggi grafik tren harian; bar-nya relatif terhadap omzet tertinggi. */
const TREND_HEIGHT_PX = 96;

const INSIGHT_ICONS: Record<InsightLevel, typeof Info> = {
  warn: AlertTriangle,
  good: ArrowUpRight,
  info: Info,
};

const INSIGHT_CLASSES: Record<InsightLevel, string> = {
  warn: "border-accent/50 bg-accent/10 text-accent",
  good: "border-primary/40 bg-primary/10 text-primary",
  info: "border-border/60 bg-secondary/20 text-muted-foreground",
};

/** "+12%" / "−5%" / "—" kalau tidak ada pembandingnya. */
function formatDelta(value: number | null, suffix = "%"): string {
  if (value === null) return "—";
  if (value === 0) return `0${suffix}`;
  return `${value > 0 ? "+" : "−"}${Math.abs(value)}${suffix}`;
}

function DeltaBadge({ value, suffix = "%" }: { value: number | null; suffix?: string }) {
  const tone =
    value === null || value === 0
      ? "text-muted-foreground"
      : value > 0
        ? "text-primary"
        : "text-destructive";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", tone)}>
      {value !== null && value !== 0 && (
        value > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />
      )}
      {formatDelta(value, suffix)}
      <span className="text-muted-foreground">vs periode sebelumnya</span>
    </span>
  );
}

export function ReportsPage() {
  const {
    summary,
    source,
    analyticsReport,
    analyticsDays,
    setAnalyticsDays,
    franchiseReport,
    modules,
    tax,
    fnbTax,
    fnbTaxMonths,
  } = useStore();
  const { session } = useSession();
  const planKey = session?.tenant?.planKey ?? "starter";

  /**
   * Gerbang fiturnya memakai kalimat yang sama dengan server
   * (`featureUnavailableReason`), jadi halaman tidak pernah menjanjikan laporan
   * yang akan ditolak backend.
   */
  const gateReason = featureUnavailableReason(
    planKey,
    modules.activeVerticals,
    "report.advanced",
  );
  /** Gerbang laporan lintas cabang (`scale.franchise`) — kalimat yang sama
   * dengan server, jadi tidak ada kartu yang menampilkan laporan yang akan
   * ditolak backend. */
  const franchiseGateReason = featureUnavailableReason(
    planKey,
    modules.activeVerticals,
    "scale.franchise",
  );

  const rows = PAYMENT_LABELS.map((method) => {
    const total = summary.byMethod[method];
    return {
      method,
      total,
      share: summary.revenue > 0 ? total / summary.revenue : 0,
    };
  }).filter((row) => row.total > 0);

  const cards = [
    { label: "Total omzet", value: formatIDR(summary.revenue) },
    { label: "PPN terkumpul", value: formatIDR(summary.tax) },
    {
      label: "Rata-rata / transaksi",
      value: formatIDR(summary.averagePerTransaction),
    },
    { label: "Jumlah transaksi", value: String(summary.transactions) },
  ];

  /*
    Laporan pajak & pungutan F&B: rinciannya dihitung aturan murni yang sama
    dengan halaman Pengaturan (`fnbTaxMonthReport`), dari baris penjualan yang
    benar-benar tersimpan. Yang dipungut dari pelanggan (PBJT, PPN, biaya
    layanan) dibaca dari struk masing-masing bulan, sedangkan kewajiban pengusaha
    (PPh final UMKM & PPh sewa) dihitung dari setelan yang berlaku sekarang —
    itu sebabnya barisnya diberi keterangan sendiri, bukan dicampur.
  */
  const fnbMonths = fnbTaxMonths.map((row) =>
    fnbTaxMonthReport({ row, profile: fnbTax, ppn: tax }),
  );
  const fnbTotals = fnbTaxReportTotals(fnbTaxMonths);
  const fnbOwnerTotal = fnbMonths.reduce(
    (sum, month) => sum + month.ownerObligationsIdr,
    0,
  );
  const fnbCurrent = fnbCurrentMonthSummary(fnbTaxMonths);
  const fnbMicroWarning = microExemptWarning({
    profile: fnbTax,
    monthGrossIdr: fnbCurrent.monthGrossIdr,
  });
  /** Bulan yang benar-benar ada penjualannya — dasar kalimat di bawah tabel. */
  const fnbActiveMonths = fnbMonths.filter((month) => month.row.recordedSales > 0);
  const fnbNotes = fnbActiveMonths.flatMap((month) =>
    month.notes.map((note) => ({ label: month.row.label, note })),
  );

  const report = analyticsReport;
  const peakRevenue = report.trend.reduce(
    (max, point) => (point.revenue > max ? point.revenue : max),
    0,
  );
  const peakHour = report.busyHours.reduce(
    (max, row) => (row.revenue > max ? row.revenue : max),
    0,
  );
  const peakWeekday = report.weekday.reduce(
    (max, row) => (row.revenue > max ? row.revenue : max),
    0,
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Omzet per metode bayar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada transaksi pada periode ini.
            </p>
          ) : (
            rows.map((m) => (
              <div key={m.method}>
                <div className="flex items-center justify-between text-sm">
                  <span>{m.method}</span>
                  <span className="font-mono">
                    {formatIDR(m.total)}{" "}
                    <span className="text-muted-foreground">
                      ({Math.round(m.share * 100)}%)
                    </span>
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.round(m.share * 100)}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {c.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-2xl font-bold">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ------- Pajak & pungutan F&B per bulan (setelan workspace) ---------- */}
      <Card data-testid="fnb-tax-report">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="size-4" />
            Pajak &amp; pungutan F&amp;B per bulan
          </CardTitle>
          <CardDescription>
            {fnbTaxMonths.length} bulan terakhir <strong className="text-foreground">seluruh
            toko</strong> workspace ini — setelan PBJT, biaya layanan, dan PPh final
            adalah setelan workspace, jadi omzet semua cabang ikut dihitung. Angka
            pajaknya diambil dari yang tercatat di tiap struk: mengubah tarif hari ini
            tidak menulis ulang bulan lalu.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
              <div className="text-xs text-muted-foreground">
                PBJT dipungut ({fnbTaxMonths.length} bulan)
              </div>
              <div className="font-mono text-lg font-bold">
                {formatIDR(fnbTotals.regionalTaxIdr)}
              </div>
              <div className="text-xs text-muted-foreground">
                dari {fnbTotals.regionalSales} transaksi ber-PBJT
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
              <div className="text-xs text-muted-foreground">
                PPN dipungut ({fnbTaxMonths.length} bulan)
              </div>
              <div className="font-mono text-lg font-bold">
                {formatIDR(fnbTotals.ppnTaxIdr)}
              </div>
              <div className="text-xs text-muted-foreground">setoran PPN pusat</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
              <div className="text-xs text-muted-foreground">
                Biaya layanan — bukan pajak
              </div>
              <div className="font-mono text-lg font-bold">
                {formatIDR(fnbTotals.serviceChargeIdr)}
              </div>
              <div className="text-xs text-muted-foreground">
                dibagikan internal, bukan setoran negara
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
              <div className="text-xs text-muted-foreground">
                Kewajiban pengusaha
              </div>
              <div className="font-mono text-lg font-bold">
                {formatIDR(fnbOwnerTotal)}
              </div>
              <div className="text-xs text-muted-foreground">
                PPh final UMKM + PPh sewa, bukan dari pelanggan
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <caption className="sr-only">
                Laporan pajak &amp; pungutan F&amp;B per bulan
              </caption>
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2">Bulan</th>
                  <th className="py-2 text-right">Omzet tercatat</th>
                  <th className="py-2 text-right">PBJT</th>
                  <th className="py-2 text-right">PPN</th>
                  <th className="py-2 text-right">Biaya layanan</th>
                  <th className="py-2 text-right">PPh final UMKM</th>
                  <th className="py-2 text-right">PPh sewa</th>
                  <th className="py-2 text-right">Setoran pengusaha</th>
                </tr>
              </thead>
              <tbody>
                {fnbMonths.map((month) => (
                  <tr
                    key={month.row.label}
                    data-testid={`fnb-tax-month-${month.row.year}-${month.row.monthIndex}`}
                    className="border-t border-border/60"
                  >
                    <td className="py-2">
                      <div className="font-medium">{month.row.label}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {month.row.recordedSales} transaksi · omzet setahun berjalan{" "}
                        {formatIDR(month.row.yearToDateGrossIdr)}
                      </div>
                    </td>
                    <td className="py-2 text-right font-mono">
                      {formatIDR(month.row.monthGrossIdr)}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {month.regionalToPayIdr > 0
                        ? formatIDR(month.regionalToPayIdr)
                        : "—"}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {month.ppnToPayIdr > 0 ? formatIDR(month.ppnToPayIdr) : "—"}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {month.row.serviceChargeIdr > 0
                        ? formatIDR(month.row.serviceChargeIdr)
                        : "—"}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {month.umkm.monthTaxIdr > 0
                        ? formatIDR(month.umkm.monthTaxIdr)
                        : "—"}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {month.rent.withheldIdr > 0
                        ? formatIDR(month.rent.withheldIdr)
                        : "—"}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {month.ownerObligationsIdr > 0
                        ? formatIDR(month.ownerObligationsIdr)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot data-testid="fnb-tax-total">
                <tr className="border-t-2 border-border/80">
                  <td className="py-2 font-semibold">
                    Jumlah
                    <div className="text-[11px] font-normal text-muted-foreground">
                      dari {fnbTotals.recordedSales} transaksi yang tercatat
                    </div>
                  </td>
                  <td className="py-2 text-right font-mono font-semibold">
                    {formatIDR(fnbTotals.grossIdr)}
                  </td>
                  <td className="py-2 text-right font-mono font-semibold">
                    {formatIDR(fnbTotals.regionalTaxIdr)}
                  </td>
                  <td className="py-2 text-right font-mono font-semibold">
                    {formatIDR(fnbTotals.ppnTaxIdr)}
                  </td>
                  <td className="py-2 text-right font-mono font-semibold">
                    {formatIDR(fnbTotals.serviceChargeIdr)}
                  </td>
                  <td className="py-2 text-right font-mono font-semibold">
                    {formatIDR(
                      fnbMonths.reduce((sum, month) => sum + month.umkm.monthTaxIdr, 0),
                    )}
                  </td>
                  <td className="py-2 text-right font-mono font-semibold">
                    {formatIDR(
                      fnbMonths.reduce((sum, month) => sum + month.rent.withheldIdr, 0),
                    )}
                  </td>
                  <td className="py-2 text-right font-mono font-semibold">
                    {formatIDR(fnbOwnerTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {fnbActiveMonths.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Belum ada penjualan yang tercatat pada {fnbTaxMonths.length} bulan terakhir.
              Setelah kasir mencatat penjualan, bulan-bulannya terisi sendiri — penjualan
              yang dibatalkan (void) dan pesanan tertahan tidak pernah ikut dihitung.
            </p>
          )}

          {fnbMicroWarning && (
            <p
              data-testid="fnb-tax-micro-warning"
              className="rounded-lg border border-accent/50 bg-accent/10 px-4 py-3 text-sm text-accent"
            >
              {fnbMicroWarning}
            </p>
          )}

          {fnbNotes.length > 0 && (
            <div data-testid="fnb-tax-notes" className="space-y-2">
              <div className="text-sm font-semibold">Catatan per bulan</div>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                {fnbNotes.map((entry, index) => (
                  <li
                    key={`${entry.label}-${index}`}
                    className="flex items-start gap-2 rounded border border-border/60 px-3 py-1.5"
                  >
                    <span className="shrink-0 font-medium text-foreground">{entry.label}</span>
                    <span>{entry.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Dipungut dari pelanggan: <strong className="text-foreground">PBJT</strong> disetor ke kas
            daerah (Bapenda), <strong className="text-foreground">PPN</strong> lewat jalur pajak
            pusat, dan <strong className="text-foreground">biaya layanan</strong> bukan pajak sama
            sekali. Kewajiban pengusaha (PPh final UMKM {formatPctPlain(UMKM_FINAL_RATE_PCT)}
            {fnbTax.rentTaxActive ? " + PPh sewa" : ""}) dihitung dari omzet tercatat dan tidak
            pernah ditambahkan ke struk pelanggan. Tarif, batas omzet mikro, dan dasar pengenaan
            pajak berbeda per Perda — semuanya bisa diubah di halaman Pengaturan, dan angka di sini
            tetap <strong className="text-foreground">perkiraan dari data aplikasi</strong>, bukan
            perhitungan pajak resmi.
          </p>
        </CardContent>
      </Card>

      {/* --------------- Analitik lanjutan (`report.advanced`) ---------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="size-4" />
            Analitik lanjutan (Enterprise)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Arah omzet, margin kotor, produk &amp; kategori yang benar-benar
            menghasilkan, plus jam dan hari tersibuk — dari data penjualan nyata,
            bukan perkiraan.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {gateReason ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              {gateReason}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {ANALYTICS_PERIODS.map((days) => (
                  <Button
                    key={days}
                    size="sm"
                    variant={analyticsDays === days ? "default" : "outline"}
                    onClick={() => setAnalyticsDays(days)}
                  >
                    {days} hari
                  </Button>
                ))}
                <span className="text-xs text-muted-foreground">
                  {report.range.days} hari terakhir · dibandingkan dengan periode
                  sebelumnya yang sama panjang
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
                  <div className="text-xs text-muted-foreground">Omzet bersih</div>
                  <div className="font-mono text-lg font-bold">
                    {formatIDR(report.totals.netRevenue)}
                  </div>
                  <DeltaBadge value={report.comparison.revenueDeltaPct} />
                </div>
                <div className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
                  <div className="text-xs text-muted-foreground">Transaksi</div>
                  <div className="font-mono text-lg font-bold">
                    {report.totals.transactions}
                  </div>
                  <DeltaBadge value={report.comparison.transactionsDeltaPct} />
                </div>
                <div className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
                  <div className="text-xs text-muted-foreground">
                    Rata-rata keranjang
                  </div>
                  <div className="font-mono text-lg font-bold">
                    {formatIDR(report.totals.averageBasket)}
                  </div>
                  <DeltaBadge value={report.comparison.averageBasketDeltaPct} />
                </div>
                <div className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
                  <div className="text-xs text-muted-foreground">Margin kotor</div>
                  <div className="font-mono text-lg font-bold">
                    {formatIDR(report.margin.grossProfit)}{" "}
                    <span className="text-sm text-muted-foreground">
                      ({report.margin.marginPct}%)
                    </span>
                  </div>
                  <DeltaBadge
                    value={report.comparison.marginPctDelta}
                    suffix=" poin"
                  />
                </div>
              </div>

              {/* Tren harian: satu bar per hari, termasuk hari tanpa penjualan. */}
              <div>
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span>Tren omzet harian</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    tertinggi {formatIDR(peakRevenue)}
                  </span>
                </div>
                <div
                  className="mt-3 flex items-end gap-[3px]"
                  style={{ height: TREND_HEIGHT_PX }}
                  role="img"
                  aria-label={`Tren omzet ${report.range.days} hari terakhir`}
                >
                  {report.trend.map((point) => (
                    <div
                      key={point.key}
                      className="group relative flex-1 rounded-t bg-primary/70 hover:bg-primary"
                      style={{
                        height:
                          peakRevenue > 0
                            ? `${Math.max(2, Math.round((point.revenue / peakRevenue) * TREND_HEIGHT_PX))}px`
                            : "2px",
                      }}
                      title={`${point.label}: ${formatIDR(point.revenue)} · ${point.transactions} transaksi`}
                    >
                      <span className="sr-only">
                        {point.label} {formatIDR(point.revenue)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                  <span>{report.trend[0]?.label}</span>
                  <span>{report.trend[report.trend.length - 1]?.label}</span>
                </div>
              </div>

              {/* Temuan: angka yang sudah diterjemahkan jadi kalimat. */}
              {report.insights.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Lightbulb className="size-4" />
                    Temuan
                  </div>
                  <ul className="mt-2 space-y-2">
                    {report.insights.map((insight) => {
                      const Icon = INSIGHT_ICONS[insight.level];
                      return (
                        <li
                          key={insight.text}
                          className={cn(
                            "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
                            INSIGHT_CLASSES[insight.level],
                          )}
                        >
                          <Icon className="mt-0.5 size-3.5 shrink-0" />
                          <span>{insight.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <div className="text-sm font-semibold">Produk teratas</div>
                  {report.topProducts.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Belum ada penjualan pada periode ini.
                    </p>
                  ) : (
                    <table className="mt-2 w-full text-sm">
                      <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="py-2">Produk</th>
                          <th className="py-2 text-right">Qty</th>
                          <th className="py-2 text-right">Omzet</th>
                          <th className="py-2 text-right">Margin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.topProducts.map((row) => (
                          <tr key={row.productId} className="border-t border-border/60">
                            <td className="py-2">
                              <div className="truncate">{row.name}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {row.category} · {row.sharePct}% omzet
                              </div>
                            </td>
                            <td className="py-2 text-right font-mono">{row.quantity}</td>
                            <td className="py-2 text-right font-mono">
                              {formatIDR(row.revenue)}
                            </td>
                            <td
                              className={cn(
                                "py-2 text-right font-mono",
                                row.marginPct < 0
                                  ? "text-destructive"
                                  : row.marginPct < 20
                                    ? "text-accent"
                                    : "",
                              )}
                            >
                              {row.marginPct}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <div className="mt-4 text-sm font-semibold">Per kategori</div>
                  <div className="mt-2 space-y-2">
                    {report.byCategory.map((row) => (
                      <div key={row.category}>
                        <div className="flex items-center justify-between text-xs">
                          <span>{row.category}</span>
                          <span className="font-mono">
                            {formatIDR(row.revenue)}{" "}
                            <span className="text-muted-foreground">
                              ({row.sharePct}%)
                            </span>
                          </span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${row.sharePct}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Clock className="size-4" />
                      Jam tersibuk
                    </div>
                    <div className="mt-3 flex items-end gap-[2px]" style={{ height: 64 }}>
                      {report.busyHours.map((row) => (
                        <div
                          key={row.hour}
                          className="flex-1 rounded-t bg-primary/60 hover:bg-primary"
                          style={{
                            height:
                              peakHour > 0
                                ? `${Math.max(2, Math.round((row.revenue / peakHour) * 64))}px`
                                : "2px",
                          }}
                          title={`${String(row.hour).padStart(2, "0")}:00 · ${formatIDR(row.revenue)} · ${row.transactions} transaksi`}
                        />
                      ))}
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                      <span>00:00</span>
                      <span>12:00</span>
                      <span>23:00</span>
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-semibold">Pola hari</div>
                    <div className="mt-2 space-y-1.5">
                      {report.weekday.map((row) => (
                        <div key={row.weekday} className="flex items-center gap-2 text-xs">
                          <span className="w-16 shrink-0 text-muted-foreground">
                            {["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][
                              row.weekday
                            ]}
                          </span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{
                                width:
                                  peakWeekday > 0
                                    ? `${Math.round((row.revenue / peakWeekday) * 100)}%`
                                    : "0%",
                              }}
                            />
                          </div>
                          <span className="w-24 shrink-0 text-right font-mono">
                            {formatIDR(row.revenue)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">
                      <Sparkles className="mr-1 size-3" />
                      {report.margin.uncostedRevenue > 0
                        ? `Sebagian omzet belum ber-HPP (${formatIDR(report.margin.uncostedRevenue)})`
                        : "Semua produk punya harga beli"}
                    </Badge>
                    <span>
                      Margin dihitung dari omzet bersih (tanpa PPN) − harga pokok.
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------- Skala franchise (`scale.franchise`): lintas cabang -------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="size-4" />
            Skala franchise · lintas cabang
          </CardTitle>
          <CardDescription>
            Satu laporan untuk seluruh cabang, dibaca dengan anggaran per cabang —
            bukan dengan memindai seluruh riwayat tenant. Anggarannya:{" "}
            {describeBudget(franchiseReport.budget)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {franchiseGateReason ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              {franchiseGateReason}
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
                  <div className="text-xs text-muted-foreground">
                    Omzet jaringan ({franchiseReport.days} hari)
                  </div>
                  <div className="font-mono text-lg font-bold">
                    {formatIDR(franchiseReport.totals.revenue)}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
                  <div className="text-xs text-muted-foreground">Transaksi</div>
                  <div className="font-mono text-lg font-bold">
                    {franchiseReport.totals.transactions}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
                  <div className="text-xs text-muted-foreground">
                    Rata-rata keranjang
                  </div>
                  <div className="font-mono text-lg font-bold">
                    {formatIDR(franchiseReport.totals.averageBasket)}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3">
                  <div className="text-xs text-muted-foreground">Cabang</div>
                  <div className="font-mono text-lg font-bold">
                    {franchiseReport.totals.activeOutlets} aktif
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {franchiseReport.totals.inactiveOutlets} nonaktif
                  </div>
                </div>
              </div>

              {franchiseReport.truncated && (
                <p className="flex items-start gap-2 rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-xs text-accent">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Sebagian angka dihitung dari jendela terbatas:{" "}
                  {franchiseReport.skippedOutlets} cabang belum diagregasi
                  {franchiseReport.beyondWindow > 0
                    ? ` dan ${franchiseReport.beyondWindow} cabang di luar jendela global`
                    : ""}
                  ; cabang yang omzetnya terpotong ditandai “sebagian”.
                </p>
              )}

              {franchiseReport.outlets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Belum ada cabang aktif dengan penjualan pada periode ini.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="py-2">Cabang</th>
                      <th className="py-2 text-right">Omzet</th>
                      <th className="py-2 text-right">Transaksi</th>
                      <th className="py-2 text-right">Rata-rata</th>
                      <th className="py-2 text-right">Pangsa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {franchiseReport.outlets.map((row) => (
                      <tr key={row.storeId} className="border-t border-border/60">
                        <td className="py-2">
                          <div className="truncate">{row.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {row.code}
                            {row.truncated ? " · sebagian (mentok anggaran)" : ""}
                          </div>
                        </td>
                        <td className="py-2 text-right font-mono">
                          {formatIDR(row.revenue)}
                        </td>
                        <td className="py-2 text-right font-mono">{row.transactions}</td>
                        <td className="py-2 text-right font-mono">
                          {formatIDR(row.averageBasket)}
                        </td>
                        <td className="py-2 text-right font-mono">{row.sharePct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {franchiseReport.topSales.length > 0 && (
                <div>
                  <div className="text-sm font-semibold">Transaksi terbesar jaringan</div>
                  <ul className="mt-2 space-y-1 text-xs">
                    {franchiseReport.topSales.map((sale) => (
                      <li
                        key={sale.saleId}
                        className="flex items-center justify-between gap-3 rounded border border-border/60 px-3 py-1.5"
                      >
                        <span>
                          {sale.storeName} · {sale.number}
                        </span>
                        <span className="font-mono">{formatIDR(sale.total)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {source === "convex"
          ? "Dihitung dari transaksi tenant Anda pada hari ini."
          : "Angka ini berasal dari data contoh. Setelah server tersambung, nilainya dihitung dari transaksi nyata per tenant."}
        {!gateReason &&
          ` Analitik lanjutan memakai ${report.range.days} hari terakhir dan membandingkannya dengan periode sebelumnya yang sama panjang.`}
      </p>
    </div>
  );
}

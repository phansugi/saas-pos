import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Boxes,
  HandCoins,
  Landmark,
  Receipt,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AGING_BUCKETS, AGING_LABELS } from "@/lib/ar";
import { useStore } from "@/lib/store";
import { useCan } from "@/lib/usePermission";
import { cn, formatIDR } from "@/lib/utils";

const LOW_STOCK_THRESHOLD = 5;
/** Daftar menunggak diringkas di dashboard; halaman Piutang memuat semuanya. */
const OVERDUE_PREVIEW = 5;
/** Jatuh tempo yang ditampilkan di dashboard; sisanya ada di halaman Pembelian. */
const DUE_PREVIEW = 5;
/** Riwayat bayar sekaligus yang ditampilkan di dashboard. */
const BATCH_PREVIEW = 5;

/**
 * Warna empat kartu ringkasan di kepala dashboard.
 *
 * Angka-angka ini dibaca sekilas sambil melayani pembeli, jadi tiap kartu diberi
 * nadanya sendiri supaya "yang mana omzet, yang mana stok" langsung terbaca
 * tanpa membaca labelnya lebih dulu. Yang berwarna hanya **permukaan, garis atas,
 * kotak ikon, dan angkanya**; label tetap `muted-foreground` supaya kontras
 * bacanya tidak dikorbankan. Warnanya dari palet Tailwind baku dan punya
 * pasangannya sendiri di tema gelap, jadi tetap enak dilihat di kedua tema.
 */
const SUMMARY_TONES = {
  /** Uang masuk hari ini. */
  emerald: {
    surface:
      "border-emerald-500/40 bg-gradient-to-br from-emerald-500/15 via-card to-card hover:border-emerald-500/60",
    strip: "from-emerald-400 to-teal-500",
    icon: "bg-emerald-500/15 text-emerald-600 ring-emerald-500/30 dark:text-emerald-400",
    value: "text-emerald-700 dark:text-emerald-300",
  },
  /** Banyaknya transaksi yang tercatat. */
  sky: {
    surface:
      "border-sky-500/40 bg-gradient-to-br from-sky-500/15 via-card to-card hover:border-sky-500/60",
    strip: "from-sky-400 to-blue-500",
    icon: "bg-sky-500/15 text-sky-600 ring-sky-500/30 dark:text-sky-400",
    value: "text-sky-700 dark:text-sky-300",
  },
  /** Barang yang keluar dari rak. */
  violet: {
    surface:
      "border-violet-500/40 bg-gradient-to-br from-violet-500/15 via-card to-card hover:border-violet-500/60",
    strip: "from-violet-400 to-fuchsia-500",
    icon: "bg-violet-500/15 text-violet-600 ring-violet-500/30 dark:text-violet-400",
    value: "text-violet-700 dark:text-violet-300",
  },
  /** Stok menipis: perlu dilihat, belum mendesak. */
  amber: {
    surface:
      "border-amber-500/40 bg-gradient-to-br from-amber-500/15 via-card to-card hover:border-amber-500/60",
    strip: "from-amber-300 to-orange-500",
    icon: "bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-400",
    value: "text-amber-700 dark:text-amber-300",
  },
  /** Ada barang yang benar-benar kritis: nada bahaya + titik berdenyut. */
  rose: {
    surface:
      "border-rose-500/45 bg-gradient-to-br from-rose-500/[0.18] via-card to-card hover:border-rose-500/70",
    strip: "from-rose-400 to-red-500",
    icon: "bg-rose-500/15 text-rose-600 ring-rose-500/30 dark:text-rose-400",
    value: "text-rose-700 dark:text-rose-300",
  },
} as const;

type SummaryTone = keyof typeof SUMMARY_TONES;

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function DashboardPage() {
  const {
    products,
    sales,
    summary,
    source,
    customers,
    receivables,
    arSummary,
    payables,
    payableSummary,
    paymentBatches,
  } = useStore();
  const can = useCan();
  const lowStock = products.filter((p) => p.stock <= LOW_STOCK_THRESHOLD);

  // Piutang punya izinnya sendiri (`ar.view`) — gudang tidak memilikinya, jadi
  // bagiannya disembunyikan alih-alih menampilkan "Rp 0" yang menyesatkan.
  const canViewAr = can("ar.view");
  // Hutang usaha juga: kasir dan staf gudang tidak boleh melihat uang supplier.
  const canViewPayables = can("payable.view");

  /**
   * Tagihan supplier terdekat jatuh temponya — **termasuk yang sudah lewat**,
   * dan yang paling mendesak muncul paling atas. Umurnya diambil dari baris yang
   * sudah dihitung aturan `@/lib/payables`, jadi angkanya sama dengan halaman
   * Pembelian (tidak ada perhitungan kedua di UI).
   */
  const nearestDue = useMemo(
    () =>
      payables
        .filter((row) => row.balance > 0)
        .slice()
        .sort((a, b) => a.dueDate - b.dueDate)
        .slice(0, DUE_PREVIEW),
    [payables],
  );

  /**
   * Pelanggan menunggak, diurutkan dari yang paling besar. Umur piutangnya
   * diambil dari nota terlama yang lewat tempo — angka yang sama dengan halaman
   * Piutang, karena keduanya memakai aturan `@/lib/ar`.
   */
  const overdueCustomers = useMemo(() => {
    const worstByCustomer = new Map<string, { daysPastDue: number; bucket: string }>();
    for (const row of receivables) {
      if (!row.overdue) continue;
      const current = worstByCustomer.get(row.customerId);
      if (!current || row.daysPastDue > current.daysPastDue) {
        worstByCustomer.set(row.customerId, {
          daysPastDue: row.daysPastDue,
          bucket: row.bucket,
        });
      }
    }

    return customers
      .filter((customer) => customer.overdueAmount > 0)
      .map((customer) => ({
        customer,
        aging: worstByCustomer.get(customer.id) ?? null,
      }))
      .sort((a, b) => b.customer.overdueAmount - a.customer.overdueAmount);
  }, [customers, receivables]);

  // Kartu stok menyalakan nada bahaya hanya kalau memang ada barang yang kritis;
  // kartu peringatan yang menyala terus-menerus lama-lama tidak dibaca lagi.
  const cards: Array<{
    /** Penanda tetap untuk harness (`data-summary`), bukan untuk dibaca kasir. */
    key: "omzet" | "transaksi" | "item" | "stok";
    label: string;
    value: string;
    icon: typeof TrendingUp;
    tone: SummaryTone;
  }> = [
    {
      key: "omzet",
      label: source === "convex" ? "Omzet hari ini" : "Omzet (contoh hari ini)",
      value: formatIDR(summary.revenue),
      icon: TrendingUp,
      tone: "emerald",
    },
    {
      key: "transaksi",
      label: "Transaksi",
      value: String(summary.transactions),
      icon: Receipt,
      tone: "sky",
    },
    {
      key: "item",
      label: "Item terjual",
      value: String(summary.itemCount),
      icon: ShoppingCart,
      tone: "violet",
    },
    {
      key: "stok",
      label: "Stok kritis",
      value: `${lowStock.length} item`,
      icon: Boxes,
      tone: lowStock.length > 0 ? "rose" : "amber",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c, index) => {
          const tone = SUMMARY_TONES[c.tone];
          const kritis = c.tone === "rose";
          return (
            <Card
              key={c.key}
              data-summary={c.key}
              className={cn("relative animate-fade-up overflow-hidden", tone.surface)}
              // Muncul berurutan dari kiri ke kanan: mata mengikuti satu arah,
              // bukan empat kartu yang berkedip bersamaan.
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-0 top-0 h-1 bg-gradient-to-r",
                  tone.strip,
                )}
              />
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {c.label}
                  </CardTitle>
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-lg ring-1 ring-inset",
                      tone.icon,
                    )}
                  >
                    <c.icon className="size-4" />
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <span className={cn("font-mono text-2xl font-bold", tone.value)}>
                    {c.value}
                  </span>
                  {/* Denyut hanya saat ada yang benar-benar perlu ditindak. */}
                  {kritis && (
                    <span className="relative flex size-2" aria-hidden>
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-500/70" />
                      <span className="relative inline-flex size-2 rounded-full bg-rose-500" />
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {canViewAr && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Piutang B2B
                </CardTitle>
                <HandCoins className="size-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="font-mono text-2xl font-bold">
                {formatIDR(arSummary.outstanding)}
              </div>
              <p className="text-xs text-muted-foreground">
                {arSummary.openCount === 0
                  ? "Tidak ada piutang terbuka."
                  : `${arSummary.openCount} nota piutang terbuka`}
                {arSummary.overdueAmount > 0 && (
                  <>
                    {" · "}
                    <span className="text-accent">
                      {formatIDR(arSummary.overdueAmount)} jatuh tempo
                    </span>
                  </>
                )}
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
                {AGING_BUCKETS.map((bucket) => (
                  <div
                    key={bucket}
                    className="rounded-md border border-border/60 bg-secondary/20 px-2 py-1.5"
                  >
                    <div className="text-[11px] text-muted-foreground">
                      {AGING_LABELS[bucket]}
                    </div>
                    <div className="font-mono text-xs font-semibold">
                      {formatIDR(arSummary.byBucket[bucket])}
                    </div>
                  </div>
                ))}
              </div>
              <Link
                to="/app/receivables"
                className="inline-flex items-center gap-1 pt-1 text-xs text-primary hover:underline"
              >
                Kelola piutang
                <ArrowRight className="size-3.5" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Pelanggan menunggak
                </CardTitle>
                <AlertTriangle
                  className={
                    overdueCustomers.length > 0
                      ? "size-4 text-accent"
                      : "size-4 text-muted-foreground"
                  }
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {overdueCustomers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {arSummary.openCount > 0
                    ? "Tidak ada yang lewat jatuh tempo."
                    : "Belum ada pelanggan menunggak."}
                </p>
              ) : (
                <>
                  {overdueCustomers.slice(0, OVERDUE_PREVIEW).map(({ customer, aging }) => (
                    <div
                      key={customer.id}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate">{customer.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {customer.overdueCount} nota
                          {aging ? ` · ${AGING_LABELS[aging.bucket as keyof typeof AGING_LABELS]}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono font-semibold text-accent">
                          {formatIDR(customer.overdueAmount)}
                        </div>
                        {aging && (
                          <div className="text-xs text-muted-foreground">
                            lewat {aging.daysPastDue} hari
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {overdueCustomers.length > OVERDUE_PREVIEW && (
                    <p className="text-xs text-muted-foreground">
                      +{overdueCustomers.length - OVERDUE_PREVIEW} pelanggan lain menunggak.
                    </p>
                  )}
                  <Link
                    to="/app/receivables"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Tagih sekarang
                    <ArrowRight className="size-3.5" />
                  </Link>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {canViewPayables && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Hutang usaha
                </CardTitle>
                <Landmark className="size-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="font-mono text-2xl font-bold">
                {formatIDR(payableSummary.outstanding)}
              </div>
              <p className="text-xs text-muted-foreground">
                {payableSummary.openCount === 0
                  ? "Tidak ada tagihan supplier yang terbuka."
                  : `${payableSummary.openCount} tagihan supplier belum lunas`}
                {payableSummary.overdueAmount > 0 && (
                  <>
                    {" · "}
                    <span className="text-destructive">
                      {formatIDR(payableSummary.overdueAmount)} lewat jatuh tempo
                    </span>
                  </>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {payableSummary.dueSoonAmount > 0
                  ? `${formatIDR(payableSummary.dueSoonAmount)} jatuh tempo dalam 7 hari ke depan.`
                  : "Tidak ada tagihan yang jatuh tempo minggu ini."}
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
                {AGING_BUCKETS.map((bucket) => (
                  <div
                    key={bucket}
                    className="rounded-md border border-border/60 bg-secondary/20 px-2 py-1.5"
                  >
                    <div className="text-[11px] text-muted-foreground">
                      {AGING_LABELS[bucket]}
                    </div>
                    <div className="font-mono text-xs font-semibold">
                      {formatIDR(payableSummary.byBucket[bucket])}
                    </div>
                  </div>
                ))}
              </div>
              <Link
                to="/app/purchasing"
                className="inline-flex items-center gap-1 pt-1 text-xs text-primary hover:underline"
              >
                Bayar di Pembelian
                <ArrowRight className="size-3.5" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Jatuh tempo terdekat
                </CardTitle>
                <AlertTriangle
                  className={
                    payableSummary.overdueAmount > 0
                      ? "size-4 text-destructive"
                      : "size-4 text-muted-foreground"
                  }
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {nearestDue.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Belum ada tagihan supplier yang perlu dibayar.
                </p>
              ) : (
                <>
                  {nearestDue.map((row) => (
                    <div key={row.id} className="flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <div className="truncate">{row.supplierName}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.number} · {row.source} · {formatDate(row.dueDate)}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={
                            row.overdue
                              ? "font-mono font-semibold text-destructive"
                              : "font-mono font-semibold"
                          }
                        >
                          {formatIDR(row.balance)}
                        </div>
                        <div
                          className={
                            row.overdue
                              ? "text-xs text-destructive"
                              : "text-xs text-muted-foreground"
                          }
                        >
                          {row.daysPastDue > 0
                            ? `lewat ${row.daysPastDue} hari`
                            : row.daysPastDue === 0
                              ? "jatuh tempo hari ini"
                              : `${-row.daysPastDue} hari lagi`}
                        </div>
                      </div>
                    </div>
                  ))}
                  {payables.filter((row) => row.balance > 0).length > DUE_PREVIEW && (
                    <p className="text-xs text-muted-foreground">
                      +
                      {payables.filter((row) => row.balance > 0).length - DUE_PREVIEW}{" "}
                      tagihan lain menunggu dibayar.
                    </p>
                  )}
                  <Link
                    to="/app/purchasing"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Catat pembayaran
                    <ArrowRight className="size-3.5" />
                  </Link>
                </>
              )}
            </CardContent>
          </Card>

        {/*
          Riwayat bayar sekaligus: satu transfer bank bisa melunasi beberapa
          tagihan, dan nomor `PAY-…` itulah yang dicocokkan dengan mutasi bank.
          Yang ditampilkan adalah batch yang benar-benar terjadi (bukan
          perkiraan), lengkap dengan tagihan yang dibayar di dalamnya.
        */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pembayaran supplier terakhir
              </CardTitle>
              <Banknote className="size-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {paymentBatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum ada pembayaran hutang yang tercatat. Pembayaran sekaligus
                tercatat dengan satu nomor <span className="font-mono">PAY-…</span>,
                jadi satu transfer bank bisa dicocokkan dengan beberapa tagihan
                sekaligus.
              </p>
            ) : (
              <>
                {paymentBatches.slice(0, BATCH_PREVIEW).map((batch) => (
                  <div
                    key={batch.number}
                    className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-sm">{batch.number}</span>
                      <span className="font-mono text-sm font-semibold">
                        {formatIDR(batch.total)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(batch.at)} · {batch.method} · {batch.count} tagihan
                    </div>
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      {batch.bills.map((bill) => (
                        <li key={`${batch.number}-${bill.payableId}`} className="font-mono">
                          {bill.payableNumber} · {formatIDR(bill.amount)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {paymentBatches.length > BATCH_PREVIEW && (
                  <p className="text-xs text-muted-foreground">
                    +{paymentBatches.length - BATCH_PREVIEW} pembayaran lain tercatat.
                  </p>
                )}
                <Link
                  to="/app/purchasing"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Lihat semua pembayaran
                  <ArrowRight className="size-3.5" />
                </Link>
              </>
            )}
          </CardContent>
        </Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stok kritis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Tidak ada stok yang menipis.
              </p>
            ) : (
              lowStock.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{p.name}</span>
                  <Badge variant={p.stock === 0 ? "outline" : "accent"}>
                    {p.stock === 0 ? "Habis" : `${p.stock} tersisa`}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transaksi terakhir</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {sales.length === 0 ? (
              <p className="text-sm text-muted-foreground">Belum ada transaksi.</p>
            ) : (
              sales.slice(0, 5).map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="font-mono text-muted-foreground">
                    {s.number}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-muted-foreground">{s.method}</span>
                    <span className="font-mono">{formatIDR(s.total)}</span>
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        {source === "convex"
          ? "Angka di atas dihitung dari transaksi nyata tenant Anda."
          : "Angka di atas adalah data contoh. Setelah server tersambung, nilai ini dihitung dari transaksi nyata per tenant."}
        {canViewAr &&
          " Piutang dihitung dari nota tempo yang belum lunas, termasuk yang sudah lewat jatuh tempo."}
        {canViewPayables &&
          " Hutang usaha dihitung dari tagihan supplier yang belum lunas; yang lewat jatuh tempo menahan PO baru ke supplier itu sampai dibayar."}
      </p>
    </div>
  );
}

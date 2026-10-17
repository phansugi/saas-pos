import { useMemo, useState } from "react";
import { Check, Lock, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ALL_FEATURES,
  computeTax,
  entitlementFor,
  entitlementsDelta,
  evaluateAccess,
  FEATURE_LABELS,
  formatInvoiceNumber,
  getLimit,
  hasFeature,
  isUnlimited,
  nextPlanUp,
  PLANS,
  type LimitKey,
  type PlanKey,
} from "@/lib/billing";
import { useSession } from "@/lib/session";
import { effectiveTaxRatePct } from "@/lib/tax";
import { useStore } from "@/lib/store";
import { cn, formatIDR } from "@/lib/utils";

const DAY = 86_400_000;

const LIMIT_LABELS: Record<LimitKey, string> = {
  devices: "Perangkat kasir",
  stores: "Cabang / toko",
  warehouses: "Gudang",
  products: "Produk",
  users: "Pengguna",
};

export function SubscriptionPage() {
  const { session } = useSession();
  const { products, changePlan, tax: taxSetting } = useStore();
  const tenant = session?.tenant ?? null;
  const planKey = tenant?.planKey ?? "starter";
  const tenantSlug = tenant?.slug ?? "demo";
  const productsUsed = products.length;

  // Keadaan aksi pindah paket: tombolnya nyata (`billing.changePlan`), jadi hasil
  // dan penolakannya harus terlihat — bukan tombol yang diam tanpa jejak.
  const [pending, setPending] = useState<PlanKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const model = useMemo(() => {
    const now = new Date();
    const trialEndsAt = tenant
      ? new Date(tenant.trialEndsAt)
      : new Date(now.getTime() + 5 * DAY);
    const access = evaluateAccess({
      status: "trialing",
      now,
      trialEndsAt,
    });
    const entitlements = entitlementFor(planKey);
    const current = entitlements;
    // Pembanding kartu “Yang Anda dapat” adalah **paket berikutnya di atas** milik
    // tenant (`nextPlanUp`), bukan nama tetap: di paket tertinggi tidak ada yang di
    // atasnya, jadi delta-nya kosong dan kartunya mengatakan itu apa adanya.
    const next = nextPlanUp(planKey);
    const upgraded = next ? entitlementFor(next.key) : entitlements;
    const delta = entitlementsDelta(current, upgraded);
    const daysLeft = Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY);

    const usage: Record<LimitKey, number> = {
      devices: 1,
      stores: 1,
      warehouses: 1,
      products: productsUsed,
      users: 1,
    };

    const monthly = PLANS[planKey].price?.monthly ?? 149000;
    // Tagihan langganan memakai setelan PPN workspace yang sama dengan struk
    // penjualan (`billing.createInvoice` membaca tenant yang sama), jadi
    // pratinjaunya di sini tidak boleh memakai tarif sendiri.
    const tax = computeTax(monthly, effectiveTaxRatePct(taxSetting));
    const invoices = [2, 1].map((sequence) => ({
      number: formatInvoiceNumber({
        tenantSlug,
        sequence,
        issuedAt: new Date(now.getFullYear(), now.getMonth() - (2 - sequence), 1),
      }),
      net: tax.net,
      tax: tax.tax,
      gross: tax.gross,
      status: sequence === 2 ? "Lunas" : "Lunas",
    }));

    return { access, entitlements, delta, daysLeft, usage, tax, invoices, next };
  }, [planKey, tenant, productsUsed, tenantSlug, taxSetting]);

  const { access, entitlements, delta, daysLeft, usage, invoices, next } = model;

  const limitKeys = Object.keys(LIMIT_LABELS) as LimitKey[];

  const handleUpgrade = async () => {
    if (!next) return;
    setPending(next.key);
    setError(null);
    setNotice(null);
    try {
      const result = await changePlan(next.key);
      if (!result.changed) {
        setNotice(`Tenant sudah memakai paket ${PLANS[result.planKey].name}.`);
      } else {
        const gained = result.gained.length;
        const lost = result.lost.length;
        setNotice(
          `Paket diubah ke ${PLANS[result.planKey].name}: ${gained} fitur baru aktif` +
            (lost > 0 ? `, ${lost} fitur dilepas` : "") +
            ".",
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-6">
      {/*
        `grid-cols-1` wajib: tanpa kolom eksplisit, kolom implisitnya berukuran
        `auto` — ia melebar sampai `max-content` isinya, jadi satu panel yang lebih
        lebar dari layar HP menarik seluruh halaman ikut melebar dan isinya
        terpotong di tepi kanan (kelas bug yang sama dengan halaman kasir).
      */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl capitalize">
                  Paket {planKey}
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Versi katalog v{entitlements.planVersion} ·{" "}
                  {PLANS[planKey].subtitle}
                </p>
              </div>
              <Badge variant="accent" className="gap-1.5">
                <ShieldCheck className="size-3.5" />
                {access.mode === "full" ? "Aktif" : access.mode}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-secondary/40 px-4 py-3 text-sm">
              <span className="text-muted-foreground">{access.reason}</span>
              {access.mode === "full" && (
                <span className="ml-1 font-medium">
                  {daysLeft} hari tersisa.
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Aturan akses: saat pembayaran tertunda, tenant masuk mode
              baca-saja (kasir baru diblokir), bukan lock instan — supaya
              transaksi tidak terputus di tengah jalan.
            </p>
            <div className="flex flex-wrap gap-2">
              {next ? (
                <Button
                  onClick={() => void handleUpgrade()}
                  disabled={pending !== null}
                >
                  {pending ? `Memindahkan ke ${PLANS[pending].name}…` : `Upgrade ke ${next.name}`}
                </Button>
              ) : (
                <Button variant="secondary" disabled>
                  Paket tertinggi — semua fitur aktif
                </Button>
              )}
              <Button variant="outline" disabled>
                Bayar via QRIS (GDCPay)
              </Button>
              <Button variant="outline" disabled>
                Kelola kartu (Xendit)
              </Button>
            </div>
            {next ? (
              <p className="text-xs text-muted-foreground">
                Pindah paket langsung berlaku: server menghitung prorata sisa
                periode, memangkas modul yang tidak termasuk paket baru, dan
                menulis jejaknya di audit tenant. Tombol pembayaran masih mati
                sampai gateway penagihan (GDCPay / Xendit) tersambung.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {PLANS[planKey].name} adalah paket tertinggi di katalog ini, jadi
                tidak ada paket di atasnya yang bisa ditawarkan. Tombol pembayaran
                masih mati sampai gateway penagihan (GDCPay / Xendit) tersambung.
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {error}
              </p>
            )}
            {notice && (
              <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
                {notice}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pemakaian kuota</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {limitKeys.map((key) => {
              const limit = getLimit(entitlements, key);
              const used = usage[key];
              if (isUnlimited(limit)) {
                return (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {LIMIT_LABELS[key]}
                    </span>
                    <span className="font-mono">
                      {used} / <span className="text-primary">∞</span>
                    </span>
                  </div>
                );
              }
              const pct = Math.min(100, Math.round((used / limit) * 100));
              const full = used >= limit;
              return (
                <div key={key}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {LIMIT_LABELS[key]}
                    </span>
                    <span
                      className={cn("font-mono", full && "text-accent")}
                    >
                      {used} / {limit}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        full ? "bg-accent" : "bg-primary",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entitlement fitur</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {ALL_FEATURES.map((feature) => {
              const on = hasFeature(entitlements, feature);
              return (
                <div
                  key={feature}
                  className="flex items-start gap-2 text-sm"
                >
                  {on ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  ) : (
                    <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span
                    className={on ? "" : "text-muted-foreground"}
                  >
                    {FEATURE_LABELS[feature]}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {next ? `Yang Anda dapat dengan ${next.name}` : "Paket tertinggi"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {delta.gained.map((f) => (
                <div key={f} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{FEATURE_LABELS[f]}</span>
                </div>
              ))}
              {delta.gained.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Anda sudah di paket tertinggi — semua fitur katalog sudah aktif.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Riwayat tagihan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {invoices.map((inv) => (
                <div
                  key={inv.number}
                  className="flex items-center justify-between text-sm"
                >
                  <div>
                    <div className="font-mono">{inv.number}</div>
                    <div className="text-xs text-muted-foreground">
                      Net {formatIDR(inv.net)} + PPN {formatIDR(inv.tax)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-semibold">
                      {formatIDR(inv.gross)}
                    </div>
                    <Badge>{inv.status}</Badge>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Penagihan: Xendit menangani recurring (kartu & e-wallet), GDCPay
        menangani QRIS / Virtual Account untuk perpanjangan manual. Engine
        langganan, entitlement, dan penomoran invoice dihitung di sisi kami.
      </p>
    </div>
  );
}

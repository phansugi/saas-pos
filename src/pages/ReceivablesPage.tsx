import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BadgeCheck,
  BanknoteArrowUp,
  HandCoins,
  Lock,
  Plus,
  Puzzle,
  UserPlus,
  X,
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
import { Input } from "@/components/ui/input";
import {
  AGING_BUCKETS,
  AGING_LABELS,
  suggestCustomerCode,
  type AgingBucket,
} from "@/lib/ar";
import type { PaymentLabel } from "@/lib/store";
import { useStore } from "@/lib/store";
import { featureUnavailableReason } from "@/lib/store/modules";
import { useSession } from "@/lib/session";
import { useCan } from "@/lib/usePermission";
import { cn, formatIDR } from "@/lib/utils";

const PAYMENT_METHODS: PaymentLabel[] = ["Tunai", "Transfer", "QRIS", "Kartu"];

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Piutang & Limit Kredit (`ar.creditlimit`) — modul Grosir, Phase 2.
 *
 * Tiga hal yang membuat halaman ini bukan sekadar daftar: limit per pelanggan
 * dihitung dari piutang terbukanya (bukan angka tersimpan yang bisa basi), umur
 * piutang ditandai supaya penagihan terarah, dan penerimaan pembayaran boleh
 * sebagian — semua memakai aturan yang sama dengan server (`@/lib/ar`).
 *
 * Membaca piutang **tidak** butuh modul Grosir aktif: nota lama harus tetap bisa
 * ditagih walau modulnya dimatikan. Yang butuh modul adalah memberi/menaikkan
 * limit dan menjual tempo — dan itu dijelaskan di layar, bukan disembunyikan.
 */
export function ReceivablesPage() {
  const {
    customers,
    receivables,
    arSummary,
    createCustomer,
    setCredit,
    recordPayment,
    modules,
  } = useStore();
  const { session } = useSession();
  const can = useCan();

  const canManage = can("ar.manage");
  const planKey = session?.tenant?.planKey ?? "starter";
  // Alasan yang tepat: modul Grosir mati, atau paket ini memang tidak memuat
  // fiturnya — dua hal itu butuh tindakan yang berbeda dari pengguna.
  const creditUnavailable = featureUnavailableReason(
    planKey,
    modules.activeVerticals,
    "ar.creditlimit",
  );
  const creditModuleOn = creditUnavailable === null;

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState<PaymentLabel>("Transfer");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    code: "",
    phone: "",
    creditLimit: "",
    paymentTermDays: "30",
  });

  const openReceivables = useMemo(
    () => receivables.filter((row) => row.balance > 0),
    [receivables],
  );
  const selected = openReceivables.find((row) => row.id === payFor) ?? null;

  const totalLimit = customers.reduce((sum, customer) => sum + customer.creditLimit, 0);
  const totalUsed = arSummary.outstanding;

  function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    action()
      .then(() => setNotice(message))
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setBusy(false));
  }

  async function addCustomer() {
    const limit = Number(form.creditLimit) || 0;
    if (!creditModuleOn && limit > 0) {
      setError(
        `${creditUnavailable ?? "Limit kredit belum bisa dipakai."} Simpan pelanggan tanpa limit dulu, atau rapikan paketnya.`,
      );
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createCustomer({
        name: form.name,
        code: form.code.trim() || undefined,
        phone: form.phone.trim() || undefined,
        creditLimit: limit,
        paymentTermDays: Number(form.paymentTermDays) || 0,
      });
      setForm({ name: "", code: "", phone: "", creditLimit: "", paymentTermDays: "30" });
      setNotice(`Pelanggan ${created.code} ditambahkan.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-primary/12 text-primary">
            <HandCoins className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Piutang & Limit Kredit</h2>
            <p className="text-sm text-muted-foreground">
              Modul Grosir · {customers.length} pelanggan ·{" "}
              {formatIDR(totalUsed)} dari {formatIDR(totalLimit)} limit terpakai
            </p>
          </div>
        </div>
        {creditUnavailable && (
          <Badge variant="outline" className="gap-1.5 py-1">
            <Lock className="size-3" />
            Tempo baru terkunci
          </Badge>
        )}
      </header>

      {creditUnavailable && (
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          {creditUnavailable} Halaman ini hanya bisa dibaca: nota lama tetap
          terlihat, tetapi tidak bisa ditagih atau diubah dari sini sampai
          langganannya memuat modul itu.{" "}
          {can("billing.manage") && (
            <Link to="/app/modules" className="underline">
              Kelola modul &amp; paket
            </Link>
          )}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          {notice}
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Piutang terbuka", value: formatIDR(arSummary.outstanding), hint: `${arSummary.openCount} nota` },
          { label: "Jatuh tempo", value: formatIDR(arSummary.overdueAmount), hint: `${arSummary.overdueCount} nota lewat tempo` },
          { label: "Sisa limit", value: formatIDR(Math.max(0, totalLimit - totalUsed)), hint: `dari ${formatIDR(totalLimit)}` },
          { label: "Pelanggan menunggak", value: String(customers.filter((c) => c.overdueAmount > 0).length), hint: "perlu ditagih" },
        ].map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="font-mono text-xl">{card.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">{card.hint}</CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Umur piutang</CardTitle>
          <CardDescription>
            Dihitung dari jatuh tempo tiap nota — bukan dari tanggal transaksi.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          {AGING_BUCKETS.map((bucket) => (
            <div
              key={bucket}
              className={cn(
                "rounded-lg border px-3 py-2",
                bucket === ">60" && arSummary.byBucket[bucket] > 0
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-border/60 bg-secondary/20",
              )}
            >
              <div className="text-xs text-muted-foreground">{AGING_LABELS[bucket]}</div>
              <div className="mt-1 font-mono text-sm font-semibold">
                {formatIDR(arSummary.byBucket[bucket])}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Nota piutang terbuka</CardTitle>
          <CardDescription>
            Paling dekat jatuh tempo di atas. Pelunasan boleh sebagian.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {openReceivables.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Tidak ada piutang terbuka. Penjualan tempo dari kasir akan muncul di sini.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2">Nota</th>
                    <th className="px-2 py-2">Pelanggan</th>
                    <th className="px-2 py-2">Jatuh tempo</th>
                    <th className="px-2 py-2">Umur</th>
                    <th className="px-2 py-2 text-right">Nilai</th>
                    <th className="px-2 py-2 text-right">Dibayar</th>
                    <th className="px-2 py-2 text-right">Sisa</th>
                    {canManage && <th className="px-2 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {openReceivables.map((row) => (
                    <tr key={row.id} className="border-t border-border/60">
                      <td className="px-2 py-2 font-mono text-xs">
                        {row.number}
                        {row.saleNumber && (
                          <div className="text-[11px] text-muted-foreground">
                            {row.saleNumber}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2">{row.customerName}</td>
                      <td className="px-2 py-2 text-xs">{formatDate(row.dueDate)}</td>
                      <td className="px-2 py-2">
                        <Badge variant={row.overdue ? "accent" : "outline"}>
                          {row.overdue
                            ? `Lewat ${row.daysPastDue} hari`
                            : AGING_LABELS[row.bucket as AgingBucket]}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-right font-mono">
                        {formatIDR(row.amount)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-muted-foreground">
                        {formatIDR(row.paidAmount)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono font-semibold">
                        {formatIDR(row.balance)}
                      </td>
                      {canManage && (
                        <td className="px-2 py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setPayFor(row.id);
                              setPayAmount(row.balance);
                              setPayMethod("Transfer");
                              setError(null);
                              setNotice(null);
                            }}
                          >
                            <BanknoteArrowUp />
                            Terima
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pelanggan & limit kredit</CardTitle>
          <CardDescription>
            Limit 0 berarti tunai saja. Sisa limit dihitung dari piutang terbuka,
            jadi selalu ikut nota terbaru.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Kode</th>
                  <th className="px-2 py-2">Nama</th>
                  <th className="px-2 py-2">Tempo</th>
                  <th className="px-2 py-2 text-right">Limit</th>
                  <th className="px-2 py-2 text-right">Terpakai</th>
                  <th className="px-2 py-2 text-right">Sisa limit</th>
                  <th className="px-2 py-2 text-right">Jatuh tempo</th>
                  {canManage && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id} className="border-t border-border/60">
                    <td className="px-2 py-2 font-mono text-xs">{customer.code}</td>
                    <td className="px-2 py-2">
                      {customer.name}
                      {!customer.active && (
                        <Badge variant="outline" className="ml-2">
                          nonaktif
                        </Badge>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {customer.creditLimit > 0
                        ? `${customer.paymentTermDays} hari`
                        : "tunai"}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {formatIDR(customer.creditLimit)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-muted-foreground">
                      {formatIDR(customer.outstanding)}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2 text-right font-mono font-semibold",
                        customer.availableCredit === 0 && customer.creditLimit > 0
                          ? "text-destructive"
                          : "text-primary",
                      )}
                    >
                      {formatIDR(customer.availableCredit)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs">
                      {customer.overdueAmount > 0
                        ? formatIDR(customer.overdueAmount)
                        : "—"}
                    </td>
                    {canManage && (
                      <td className="px-2 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            run(
                              () => setCredit({ customerId: customer.id, active: !customer.active }),
                              customer.active
                                ? `${customer.name} dinonaktifkan.`
                                : `${customer.name} diaktifkan kembali.`,
                            )
                          }
                        >
                          {customer.active ? "Nonaktifkan" : "Aktifkan"}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
                {customers.length === 0 && (
                  <tr>
                    <td
                      colSpan={canManage ? 8 : 7}
                      className="px-2 py-4 text-center text-sm text-muted-foreground"
                    >
                      Belum ada pelanggan B2B.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canManage && (
            <div className="mt-5 rounded-lg border border-border/60 bg-secondary/20 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <UserPlus className="size-4" />
                Tambah pelanggan
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-5">
                <label className="text-xs text-muted-foreground md:col-span-2">
                  Nama
                  <Input
                    className="mt-1"
                    value={form.name}
                    placeholder="Toko Berkah Jaya"
                    onChange={(e) => {
                      const name = e.target.value;
                      setForm((current) => ({
                        ...current,
                        name,
                        // Kode diusulkan otomatis; pemilik toko tetap bisa menimpanya.
                        code: current.code === "" ? suggestCustomerCode(name, customers.map((c) => c.code)) : current.code,
                      }));
                    }}
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Kode
                  <Input
                    className="mt-1 font-mono"
                    value={form.code}
                    placeholder="TBJ"
                    onChange={(e) => setForm((c) => ({ ...c, code: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Limit kredit
                  <Input
                    className="mt-1 font-mono"
                    type="number"
                    min={0}
                    value={form.creditLimit}
                    placeholder="0"
                    onChange={(e) => setForm((c) => ({ ...c, creditLimit: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Tempo (hari)
                  <Input
                    className="mt-1"
                    type="number"
                    min={0}
                    value={form.paymentTermDays}
                    onChange={(e) => setForm((c) => ({ ...c, paymentTermDays: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-muted-foreground md:col-span-2">
                  Telepon (opsional)
                  <Input
                    className="mt-1"
                    value={form.phone}
                    placeholder="0812…"
                    onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))}
                  />
                </label>
                <div className="flex items-start md:col-span-3">
                  <Button
                    className="mt-auto w-full md:w-auto"
                    disabled={busy || form.name.trim().length < 2}
                    onClick={() => void addCustomer()}
                  >
                    <Plus />
                    Simpan pelanggan
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Limit &gt; 0 butuh modul Grosir aktif; menyimpan limit 0 (tunai saja)
                selalu boleh.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {!canManage && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="size-3.5" />
          Kasir boleh melihat sisa limit, tetapi mengubah limit dan menerima
          pelunasan butuh peran manajer/keuangan.
        </p>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">Terima pembayaran</h3>
                <p className="text-sm text-muted-foreground">
                  {selected.number} · {selected.customerName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPayFor(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-4 flex items-baseline justify-between rounded-lg bg-secondary/40 px-4 py-3">
              <span className="text-sm text-muted-foreground">Sisa piutang</span>
              <span className="font-mono text-xl font-bold text-primary">
                {formatIDR(selected.balance)}
              </span>
            </div>

            <div className="mt-4 space-y-2">
              <label className="text-sm font-medium" htmlFor="ar-amount">
                Jumlah diterima
              </label>
              <Input
                id="ar-amount"
                type="number"
                min={0}
                value={payAmount === 0 ? "" : payAmount}
                onChange={(e) => setPayAmount(Number(e.target.value) || 0)}
                className="font-mono"
              />
              {payAmount > 0 && payAmount < selected.balance && (
                <p className="text-xs text-muted-foreground">
                  Sisa setelah pembayaran: {formatIDR(selected.balance - payAmount)}
                </p>
              )}
              {payAmount > selected.balance && (
                <p className="text-xs text-destructive">
                  Melebihi sisa piutang {formatIDR(selected.balance)}.
                </p>
              )}
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2">
              {PAYMENT_METHODS.map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPayMethod(method)}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                    payMethod === method
                      ? "border-primary/50 bg-primary/12 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {method}
                </button>
              ))}
            </div>

            <Button
              className="mt-6 w-full"
              size="lg"
              disabled={busy || payAmount <= 0 || payAmount > selected.balance}
              onClick={() =>
                run(async () => {
                  await recordPayment({
                    receivableId: selected.id,
                    amount: payAmount,
                    method: payMethod,
                  });
                  setPayFor(null);
                }, "Pembayaran piutang dicatat.")
              }
            >
              <BadgeCheck />
              Catat pembayaran
            </Button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Menagih piutang tetap bisa dilakukan walau modul Grosir dimatikan.
            </p>

            {error && (
              <p
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {error}
              </p>
            )}
          </div>
        </div>
      )}

      {creditModuleOn && arSummary.overdueCount > 0 && (
        <p className="flex items-center gap-2 text-xs text-accent">
          <Puzzle className="size-3.5" />
          Ada {arSummary.overdueCount} nota jatuh tempo — pelanggannya diblokir untuk
          tempo baru sampai ditagih.
        </p>
      )}
      {!creditModuleOn && arSummary.openCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {arSummary.openCount} nota piutang terbuka masih bisa ditagih. Tempo baru
          menunggu modul Grosir diaktifkan kembali.
        </p>
      )}
      {receivables.length > 0 && receivables.length !== openReceivables.length && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <BadgeCheck className="size-3.5" />
          {receivables.length - openReceivables.length} nota sudah lunas/dibatalkan dan
          tidak lagi memakai limit.
        </p>
      )}
    </div>
  );
}

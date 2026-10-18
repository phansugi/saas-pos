import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Landmark,
  Lock,
  Plus,
  QrCode,
  Receipt,
  XCircle,
} from "lucide-react";
import { QrCodeImage } from "@/components/QrCodeImage";
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
import { Label } from "@/components/ui/label";
import {
  DIGITAL_METHOD_KEYS,
  DIGITAL_METHOD_LABELS,
  DIGITAL_STATUS_LABELS,
  VA_BANK_KEYS,
  VA_BANKS,
  paymentInstruction,
  type DigitalMethod,
  type DigitalStatus,
  type VaBank,
} from "@/lib/payments";
import { useSession } from "@/lib/session";
import { useStore } from "@/lib/store";
import { featureUnavailableReason } from "@/lib/store/modules";
import { useCan } from "@/lib/usePermission";
import { cn } from "@/lib/utils";

/**
 * Pembayaran digital (`payment.digital`, Phase 6).
 *
 * Halaman ini adalah kanal tagih toko: kasir mengetik nominal, memilih QRIS atau
 * Virtual Account, lalu pelanggan membayar. Dua hal dijaga di sini:
 *
 *  - **umur tagihan dipatok saat dibuat** (QRIS 5 menit, VA sehari) dan sisanya
 *    ditampilkan apa adanya — termasuk saat tagihan sudah kedaluwarsa, yang
 *    diturunkan dari tenggat alih-alih disimpan sebagai status;
 *  - **nominal pelunasan harus sama** dengan tagihan, dan tagihan yang sudah
 *    lunas atau kedaluwarsa tidak bisa dibatalkan — uang yang sudah masuk tidak
 *    dibalik oleh satu tombol.
 *
 * Gerbangnya mengikuti server: **membuat tagihan** butuh fitur `payment.digital`;
 * **menandai lunas & membatalkan** selalu boleh, supaya penurunan paket tidak
 * mengunci uang yang sudah di jalan.
 */

const STATUS_TONE: Record<DigitalStatus, string> = {
  pending: "border-accent/50 bg-accent/10 text-accent",
  paid: "border-primary/40 bg-primary/10 text-primary",
  expired: "border-destructive/50 bg-destructive/10 text-destructive",
  cancelled: "border-border/60 bg-secondary/20 text-muted-foreground",
};

function formatRupiah(value: number): string {
  return `Rp ${value.toLocaleString("id-ID")}`;
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Sisa umur dibaca sebagai janji, bukan angka mentah. */
function describeRemaining(charge: {
  status: DigitalStatus;
  expiresAt: number;
  remainingSeconds: number;
  paidAt: number | null;
}): string {
  if (charge.status === "paid") {
    return charge.paidAt === null ? "Lunas" : `Lunas ${formatClock(charge.paidAt)}`;
  }
  if (charge.status === "cancelled") return "Dibatalkan";
  if (charge.status === "expired") return `Lewat ${formatClock(charge.expiresAt)}`;
  if (charge.remainingSeconds < 60) return `Sisa ${charge.remainingSeconds} detik`;
  return `Sisa ${Math.ceil(charge.remainingSeconds / 60)} menit`;
}

export function PaymentsPage() {
  const {
    digitalCharges,
    digitalSummary,
    digitalPlan,
    digitalLimits,
    createDigitalCharge,
    actDigitalCharge,
    mejaOrders,
    modules,
  } = useStore();
  const { session } = useSession();
  const can = useCan();
  /*
    Kanal tagih digital (`payment.digital`) milik paket Professional ke atas.
    Tanpa fiturnya halaman ini hanya bisa dibaca (gerbang rutenya
    `ModuleRoute`), jadi kalimat alasannya dipakai di sini juga.
  */
  const gateReason = featureUnavailableReason(
    session?.tenant?.planKey ?? "starter",
    modules.activeVerticals,
    "payment.digital",
  );
  const canManage = can("payment.manage");
  const canView = can("payment.view");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    amount: "",
    method: "qris" as DigitalMethod,
    bank: "bca" as VaBank,
    reference: "",
  });
  /** Keterangan pembatalan per tagihan. */
  const [reasons, setReasons] = useState<Record<string, string>>({});

  /**
   * Tagihan yang lahir dari pesanan QR meja, per id tagihannya.
   *
   * Halaman inilah tempat kasir melunasi (atau membatalkan) pesanan QR yang
   * belum dibayar: layar Dapur & Meja sengaja tidak menampilkan pesanan yang
   * belum lunas, jadi tagihannya harus bisa **dikenali** di sini — meja mana yang
   * menunggu, dan siapa tamunya. Pelunasannya memakai jalur tagihan digital yang
   * sama, sehingga penjualan & tiket dapurnya langsung lahir di titik ini.
   * Baris penandanya hanya muncul untuk tagihan yang masih menunggu: tagihan
   * yang sudah lunas tidak perlu dijelaskan lagi ke kasir.
   */
  const mejaOrderByCharge = useMemo(
    () => new Map(mejaOrders.map((order) => [order.chargeId, order])),
    [mejaOrders],
  );

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const submitCharge = () => {
    const amount = Number(form.amount.replace(/[^\d]/g, ""));
    void run(async () => {
      const created = await createDigitalCharge({
        amount,
        method: form.method,
        bank: form.method === "va" ? form.bank : null,
        reference: form.reference,
      });
      setForm({ amount: "", method: form.method, bank: form.bank, reference: "" });
      setNotice(
        `Tagihan ${created.number} dibuat — tenggat ${formatClock(created.expiresAt)}.`,
      );
    }, "Tagihan dibuat.");
  };

  const settle = (chargeId: string, number: string) =>
    void run(
      () => actDigitalCharge({ chargeId, action: "settle" }),
      `Tagihan ${number} ditandai lunas.`,
    );

  const cancel = (chargeId: string, number: string) =>
    void run(
      () =>
        actDigitalCharge({
          chargeId,
          action: "cancel",
          reason: reasons[chargeId] ?? "",
        }),
      `Tagihan ${number} dibatalkan.`,
    );

  return (
    <div className="space-y-6">
      {/* ------------------------------- Kanji tagih ------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <QrCode className="size-4" />
            Pembayaran digital (QRIS / VA)
          </CardTitle>
          <CardDescription>
            {digitalPlan.planName} · QRIS berumur {digitalLimits.qrisExpiryMinutes}{" "}
            menit dan Virtual Account {Math.round(digitalLimits.vaExpiryMinutes / 60)}{" "}
            jam. Umurnya dipatok saat tagihan dibuat, jadi perubahan kebijakan
            tidak mematikan tagihan yang sudah ditunjukkan ke pelanggan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!digitalPlan.digital && (
            <p className="flex items-start gap-2 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-sm text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              {gateReason} Halaman ini hanya bisa dibaca: tagihan lama tetap
              terlihat, tetapi menagih, melunasi, dan membatalkannya tidak bisa
              dari sini sampai langganannya memuat modul itu.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "Menunggu dibayar",
                value: digitalSummary.pending,
                hint: formatRupiah(digitalSummary.pendingAmount),
              },
              {
                label: "Lunas",
                value: digitalSummary.paid,
                hint: formatRupiah(digitalSummary.paidAmount),
              },
              {
                label: "Kedaluwarsa",
                value: digitalSummary.expired,
                hint: "tidak lagi bisa dilunasi",
              },
              {
                label: "Segera kedaluwarsa",
                value: digitalSummary.expiringSoon,
                hint: `≤ ${digitalLimits.expiringSoonSeconds} detik lagi`,
              },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3"
              >
                <div className="text-xs text-muted-foreground">{card.label}</div>
                <div className="mt-1 font-mono text-lg font-bold">{card.value}</div>
                <div className="text-xs text-muted-foreground">{card.hint}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={digitalPlan.digital ? "accent" : "outline"}>
              {digitalPlan.digital ? "Kanal tagih digital aktif" : "Kanal tagih digital nonaktif"}
            </Badge>
            <span>
              Nominal {formatRupiah(digitalLimits.minAmount)}–
              {formatRupiah(digitalLimits.maxAmount)}, keterangan maksimal{" "}
              {digitalLimits.referenceMax} karakter.
            </span>
          </div>
        </CardContent>
      </Card>

      {(error || notice) && (
        <p
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
            error
              ? "border-destructive/50 bg-destructive/10 text-destructive"
              : "border-primary/40 bg-primary/10 text-primary",
          )}
        >
          {error ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          )}
          {error ?? notice}
        </p>
      )}

      {/* ------------------------------- Buat tagihan ------------------------ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Plus className="size-4" />
            Buat tagihan
          </CardTitle>
          <CardDescription>
            Nomor tagihan (`DIG-…`), nomor Virtual Account, kode QRIS, dan
            tenggatnya ditetapkan server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canManage ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              Peran Anda dapat melihat tagihan dan statusnya, tetapi membuat dan
              melunasi tagihan adalah wewenang kasir, keuangan, dan manajer.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="charge-amount">Nominal</Label>
                  <Input
                    id="charge-amount"
                    inputMode="numeric"
                    value={form.amount}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, amount: event.target.value }))
                    }
                    placeholder="47000"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="charge-method">Metode</Label>
                  <select
                    id="charge-method"
                    value={form.method}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        method: event.target.value as DigitalMethod,
                      }))
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {DIGITAL_METHOD_KEYS.map((method) => (
                      <option key={method} value={method}>
                        {DIGITAL_METHOD_LABELS[method]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="charge-bank">Bank (Virtual Account)</Label>
                  <select
                    id="charge-bank"
                    value={form.bank}
                    disabled={form.method !== "va"}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        bank: event.target.value as VaBank,
                      }))
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {VA_BANK_KEYS.map((bank) => (
                      <option key={bank} value={bank}>
                        {VA_BANKS[bank].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="charge-reference">Keterangan</Label>
                  <Input
                    id="charge-reference"
                    value={form.reference}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, reference: event.target.value }))
                    }
                    placeholder="Meja 4 / pesanan supplier"
                  />
                </div>
              </div>
              <Button disabled={busy || !digitalPlan.digital} onClick={submitCharge}>
                <Plus className="size-4" />
                Buat tagihan
              </Button>
              {!digitalPlan.digital && (
                <p className="text-xs text-muted-foreground">
                  Naikkan paket untuk mengaktifkan kanal tagih digital.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------- Daftar tagihan ---------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="size-4" />
            Tagihan tenant ini
          </CardTitle>
          <CardDescription>
            Urut dari yang terbaru. Status kedaluwarsa dihitung saat halaman
            dibuka, jadi tidak ada tagihan “menunggu” yang menggantung.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canView || digitalCharges.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {canView
                ? "Belum ada tagihan. Tagihan pertama Anda akan muncul di sini beserta sisa umurnya."
                : "Daftar tagihan hanya terbuka untuk peran dengan izin melihat pembayaran digital."}
            </p>
          ) : (
            digitalCharges.map((charge) => (
              <div
                key={charge.id}
                data-testid={`tagihan-${charge.number}`}
                className="rounded-lg border border-border/60 bg-secondary/10 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {charge.number}
                      </span>
                      <Badge variant={charge.status === "paid" ? "default" : "secondary"}>
                        {charge.method === "qris" ? (
                          <>
                            <QrCode className="mr-1 size-3" />
                            QRIS
                          </>
                        ) : (
                          <>
                            <Landmark className="mr-1 size-3" />
                            VA {charge.bank ? VA_BANKS[charge.bank].label : ""}
                          </>
                        )}
                      </Badge>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs",
                          STATUS_TONE[charge.status],
                        )}
                      >
                        <Clock className="size-3" />
                        {DIGITAL_STATUS_LABELS[charge.status]}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold">
                      {formatRupiah(charge.amount)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {charge.reference ? `${charge.reference} · ` : ""}
                      dibuat {formatClock(charge.createdAt)} ·{" "}
                      {describeRemaining(charge)}
                      {charge.saleNumber
                        ? ` · melunasi penjualan ${charge.saleNumber}`
                        : ""}
                    </div>
                  </div>
                  {charge.vaNumber && (
                    <div className="rounded-md border border-border/60 bg-background px-3 py-2 text-right">
                      <div className="text-xs text-muted-foreground">
                        Virtual Account
                      </div>
                      <div className="font-mono text-sm font-bold">
                        {charge.vaNumber}
                      </div>
                    </div>
                  )}
                </div>

                {charge.status === "pending" && mejaOrderByCharge.get(charge.id) && (
                  <div
                    data-testid={`tagihan-meja-${charge.id}`}
                    className="mt-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-muted-foreground"
                  >
                    <strong className="text-foreground">
                      Pesanan QR meja {mejaOrderByCharge.get(charge.id)?.tableName}
                      {mejaOrderByCharge.get(charge.id)?.guestName
                        ? ` · ${mejaOrderByCharge.get(charge.id)?.guestName}`
                        : ""}
                    </strong>{" "}
                    — dapur baru menerima pesanannya setelah tagihan ini lunas.
                  </div>
                )}

                <p className="mt-2 text-xs text-muted-foreground">
                  {paymentInstruction({
                    method: charge.method,
                    bank: charge.bank,
                    amount: charge.amount,
                    vaNumber: charge.vaNumber ?? undefined,
                    qrPayload: charge.qrPayload ?? undefined,
                  })}
                </p>
                {charge.qrPayload && (
                  <div className="mt-3">
                    {charge.status === "pending" && (
                      <div className="flex items-start gap-3">
                        <div className="rounded-lg border border-border/60 bg-white p-2">
                          <QrCodeImage
                            value={charge.qrPayload}
                            label={`Kode QR tagihan ${charge.number}`}
                            className="size-28"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Pindai kode ini dengan aplikasi pembayaran pelanggan.
                        </p>
                      </div>
                    )}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[10px] text-muted-foreground/70">
                        Payload teks (cadangan)
                      </summary>
                      <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground/80">
                        QRIS: {charge.qrPayload}
                      </p>
                    </details>
                  </div>
                )}

                {canManage && charge.status === "pending" && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Input
                      value={reasons[charge.id] ?? ""}
                      onChange={(event) =>
                        setReasons((current) => ({
                          ...current,
                          [charge.id]: event.target.value,
                        }))
                      }
                      placeholder="Alasan pembatalan (opsional)…"
                      className="h-9 max-w-md flex-1"
                    />
                    <Button
                      size="sm"
                      disabled={busy}
                      data-testid={`tagihan-lunasi-${charge.id}`}
                      onClick={() => settle(charge.id, charge.number)}
                    >
                      <BadgeCheck className="size-4" />
                      {mejaOrderByCharge.has(charge.id)
                        ? "Lunasi & kirim ke dapur"
                        : "Tandai lunas"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      data-testid={`tagihan-batal-${charge.id}`}
                      onClick={() => cancel(charge.id, charge.number)}
                    >
                      <XCircle className="size-4" />
                      Batalkan
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

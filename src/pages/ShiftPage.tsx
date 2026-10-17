import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlarmClock,
  AlertTriangle,
  BellRing,
  Calculator,
  CheckCircle2,
  Clock,
  Lock,
  Unlock,
  Wallet,
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
import { Label } from "@/components/ui/label";
/*
  Bentuk data shift & aturan pengingat tutup shift hidup di `@/lib/shift`, bukan
  di sini: halaman Kasir memakai hal yang sama (badge shift terbuka + peringatan
  jangan lupa tutup shift), jadi keduanya tidak boleh punya definisi sendiri.
*/
import {
  shiftAlertDelivered,
  shiftAlertDeliveryText,
  shiftClockLabel,
  shiftDurationLabel,
  shiftOperatingLabel,
  shiftReminder,
} from "@/lib/shift";
import { useStore } from "@/lib/store";
import { useCan } from "@/lib/usePermission";
/*
  Kabar untuk pemilik toko (kas belum dibuka di jam operasional / shift belum
  ditutup) dilaporkan dari perangkat ini oleh hook yang sama dengan halaman Kasir,
  lalu daftarnya dibaca ulang di kartu bawah supaya “sudah diberi tahu” bisa
  diperiksa, bukan cuma diklaim.
*/
import {
  shiftOwnerAlertStatusLabel,
  useShiftOwnerAlert,
} from "@/lib/useShiftOwnerAlert";
import { cn, formatIDR } from "@/lib/utils";

/**
 * Shift di halaman ini mengikuti model shift di src/convex/pos.ts: uang yang
 * seharusnya ada = kas awal + penjualan tunai, dan selisihnya adalah uang yang
 * dihitung kasir dikurangi angka itu. Angka penjualannya dibaca langsung dari
 * ringkasan kasir, jadi ikut berubah begitu ada transaksi tercatat.
 *
 * Keadaannya **milik toko, bukan perangkat ini** (`store.till`): kas yang dibuka
 * pemilik di ponselnya harus terbuka juga untuk kasir di ponsel lain, dan kasir
 * yang melayani pembeli tidak perlu memegang izin `shift.manage` untuk itu. Di
 * mode Convex keadaannya dibaca dari tabel `shifts` (`pos.till`), di mode demo
 * dari penyimpanan perangkat — halaman ini tidak perlu tahu bedanya.
 *
 * Satu hal yang menghubungkan halaman ini dengan halaman Kasir: begitu kas
 * dibuka, halaman Kasir **langsung dibuka** untuk peran yang boleh menjual.
 * Halaman Kasir memang sudah membaca keadaan kas yang sama dan terbuka begitu
 * dibuka — tetapi hanya kalau orangnya pindah ke sana sendiri; itulah yang
 * dikeluhkan pemilik toko (“sudah buka shift, halaman kasirnya tidak terbuka”).
 * Sekarang perpindahannya ikut menekan tombol Buka shift.
 */

export function ShiftPage() {
  // Setelan pengingatnya milik workspace (`tenants.shift`), diatur pemilik toko di
  // halaman Pengaturan — bukan konstanta di kode.
  const {
    summary,
    source,
    ready,
    shift: shiftSetting,
    shiftAlerts,
    resolveShiftAlert,
    till,
    openTill,
    closeTill,
  } = useStore();

  const [openingCash, setOpeningCash] = useState("300000");
  const [countedCash, setCountedCash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  /*
    Setelah kas dibuka, yang berikutnya memang melayani pembeli. Pemilik/kasir
    yang membuka shiftnya sendiri dibawa langsung ke halaman Kasir supaya tidak
    ada yang menebak-nebak apakah halaman itu sudah terbuka — tetapi hanya kalau
    perannya memang boleh menjual: peran “kas saja” tetap di halaman ini.
  */
  const canSell = useCan()("pos.sell");

  const figures = useMemo(
    () => ({
      cashSales: summary.byMethod.Tunai,
      totalSales: summary.revenue,
      saleCount: summary.transactions,
    }),
    [summary],
  );

  const current = till.current;
  const expectedCash = current ? current.openingCash + figures.cashSales : 0;
  const counted = Number(countedCash || 0);
  const previewVariance = current ? counted - expectedCash : 0;
  /*
    Pengingat tutup shift ditampilkan di halaman tempat kasir benar-benar
    menutupnya — kalimatnya sama dengan yang muncul di halaman Kasir, karena
    dua-duanya membaca `shiftReminder` di `@/lib/shift`. Waktu bukanya sudah
    dalam milidetik (`shifts.openedAt`), sama seperti yang dibaca `pos.till`.
  */
  const openedMs = current ? current.openedAt : Number.NaN;
  const reminder = Number.isFinite(openedMs)
    ? shiftReminder({ openedAt: openedMs, setting: shiftSetting })
    : null;
  /*
    Keadaan yang perlu dikabarkan ke **pemilik toko** — dan laporannya. Hook-nya
    yang mengirim (sekali per hari per jenis) dan mengembalikan apa yang benar-benar
    terjadi: terkirim, sudah pernah, atau belum sampai ke siapa pun.
  */
  // Laporan menunggu store-nya siap: sebelum itu setelan jam operasionalnya masih
  // bawaan, jadi “kas belum dibuka” bisa berbunyi dari setelan yang belum pasti.
  const ownerAlert = useShiftOwnerAlert({ current, setting: shiftSetting, enabled: ready });
  const berjalan = current && Number.isFinite(openedMs)
    ? `${shiftClockLabel(openedMs)} · ${shiftDurationLabel(Date.now() - openedMs)}`
    : "";

  const openShift = async () => {
    const amount = Number(openingCash || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Kas awal harus berupa angka 0 atau lebih.");
      return;
    }
    setError(null);
    try {
      await openTill({ openingCash: amount });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return;
    }
    if (canSell) navigate("/app/pos");
  };

  const closeShift = async () => {
    if (!current) return;
    if (countedCash.trim() === "" || !Number.isFinite(counted)) {
      setError("Masukkan jumlah uang fisik yang dihitung di kas.");
      return;
    }
    setError(null);
    try {
      await closeTill({ countedCash: counted });
      setCountedCash("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Shift & Kas</h2>
          <p className="text-sm text-muted-foreground">
            Buka kas di awal shift, tutup dan cocokkan uang fisik di akhir.
          </p>
        </div>
        {current ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default" className="gap-1.5">
              <Unlock className="size-3" /> Shift terbuka
            </Badge>
            {berjalan && (
              <span className="text-xs text-muted-foreground">Dibuka {berjalan}</span>
            )}
            {!canSell && (
              <span className="text-xs text-muted-foreground">
                Halaman Kasir butuh izin “Melakukan penjualan”; kasnya tetap
                tercatat & bisa ditutup dari sini.
              </span>
            )}
          </div>
        ) : (
          <Badge variant="outline" className="gap-1.5">
            <Lock className="size-3" /> Kas tertutup
          </Badge>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {/*
        Pengingat jangan-lupa-tutup-shift. Muncul sendiri begitu jam tutup
        terlewat, shift berjalan sangat lama, atau shift kemarin masih terbuka —
        aturannya di `@/lib/shift`, kalimatnya sama dengan yang tampil di halaman
        Kasir.
      */}
      {reminder && (
        <div
          data-testid="shift-ingat-tutup"
          data-level={reminder.level}
          className={cn(
            "flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3",
            reminder.level === "late"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-accent/40 bg-accent/10 text-accent",
          )}
        >
          <AlarmClock className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium">{reminder.title}</p>
            <p className="text-xs opacity-90">{reminder.message}</p>
          </div>
        </div>
      )}

      {/*
        Kabar yang pergi ke **pemilik toko** (kas belum dibuka di jam operasional /
        shift belum ditutup). Muncul di halaman tempat kasirnya bekerja supaya
        kelihatan bahwa pemiliknya ikut dikabari — bukan hanya kasir yang diingatkan.
      */}
      {ownerAlert.alert && (
        <div
          data-testid="pemberitahuan-pemilik"
          data-status={ownerAlert.status}
          role="status"
          className={cn(
            "flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3",
            ownerAlert.alert.kind === "shift-open"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-accent/40 bg-accent/10 text-accent",
          )}
        >
          <BellRing className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium">
              {ownerAlert.alert.title} · {shiftOwnerAlertStatusLabel(ownerAlert.status)}
            </p>
            <p className="text-xs opacity-90">{ownerAlert.alert.message}</p>
            {ownerAlert.notice && (
              <p className="text-xs opacity-75">{ownerAlert.notice}</p>
            )}
          </div>
        </div>
      )}

      {!current ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="size-4 text-primary" /> Buka shift
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-xs space-y-2">
              <Label htmlFor="opening">Kas awal (uang kembalian)</Label>
              <Input
                id="opening"
                inputMode="numeric"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <Button data-testid="shift-buka" onClick={() => void openShift()}>
              <Unlock /> Buka shift
            </Button>
            {/*
              Apa yang terjadi sesudah tombol ini ditekan dikatakan lebih dulu:
              peran yang menjual langsung dibawa ke halaman Kasir (kas yang
              terbuka memang untuk melayani pembeli), sedangkan peran “kas saja”
              diberi tahu halaman mana yang jadi tempatnya bekerja.
            */}
            <p data-testid="shift-buka-catatan" className="text-xs text-muted-foreground">
              {canSell
                ? "Begitu kas dibuka, halaman Kasir langsung terbuka — kasir siap melayani pembeli pertama."
                : "Halaman Kasir butuh izin “Melakukan penjualan”; tanpa izin itu kasnya tetap tercatat & bisa ditutup dari sini."}
            </p>
            <p className="text-xs text-muted-foreground">
              {source === "convex"
                ? "Penjualan tunai dihitung dari transaksi nyata tenant Anda."
                : "Angka penjualan masih berasal dari data demo sampai server tersambung."}
            </p>
          </CardContent>
        </Card>
      ) : (
        /*
          `grid-cols-1` mencegah kolom implisit ber-ukuran `auto` melebar sampai
          `max-content` isinya — penyebab isi terpotong di tepi kanan layar HP.
        */
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="size-4 text-primary" /> Rekap shift berjalan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <Row label="Kas awal" value={formatIDR(current.openingCash)} />
              <Row
                label={`Penjualan tunai (${figures.saleCount} transaksi)`}
                value={formatIDR(figures.cashSales)}
              />
              <Row
                label="Uang yang seharusnya ada"
                value={formatIDR(expectedCash)}
                emphasis
              />
              <Row
                label="Total semua penjualan"
                value={formatIDR(figures.totalSales)}
              />
              <Row
                label="Shift dibuka"
                value={new Date(current.openedAt).toLocaleString("id-ID")}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="size-4 text-primary" /> Tutup shift
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="counted">Uang fisik dihitung</Label>
                <Input
                  id="counted"
                  inputMode="numeric"
                  value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value.replace(/\D/g, ""))}
                  placeholder="0"
                />
              </div>

              {countedCash.trim() !== "" && (
                <div
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm",
                    previewVariance === 0
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : previewVariance > 0
                        ? "border-accent/40 bg-accent/10 text-accent"
                        : "border-destructive/40 bg-destructive/10 text-destructive",
                  )}
                >
                  Selisih: {formatIDR(previewVariance)}
                  {previewVariance === 0
                    ? " (pas)"
                    : previewVariance > 0
                      ? " (lebih)"
                      : " (kurang)"}
                </div>
              )}

              <Button onClick={() => void closeShift()} className="w-full">
                <Lock /> Tutup shift & simpan Z-report
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/*
        Kabar yang **sudah dikirim ke pemilik toko**. Daftarnya dibaca dari server
        (`shiftAlerts.list`), bukan dari penanda di perangkat ini, jadi bisa
        diperiksa ulang — termasuk bagaimana emailnya berakhir (terkirim, gagal
        beserta sebabnya, atau alamat uji) dan berapa endpoint webhook workspace
        yang ikut menerimanya. Barisnya tidak pernah mengaku “sudah sampai” kalau
        kanalnya memang belum berangkat.
      */}
      <Card data-testid="setelan-pemberitahuan-pemilik" id="pemberitahuan-pemilik">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <BellRing className="size-4 text-primary" /> Pemberitahuan ke pemilik toko
              </CardTitle>
              <CardDescription className="mt-1">
                Kas yang belum dibuka di jam operasional
                (<strong className="font-medium">{shiftOperatingLabel(shiftSetting)}</strong>) dan shift
                yang belum ditutup dikabarkan ke pemilik toko lewat{" "}
                <strong className="font-medium">email ke alamat pemilik workspace ini</strong> — dan ikut
                masuk ke langganan webhook workspace ({" "}
                <code className="font-mono text-xs">shift.alert</code>). Keadaan kasnya dibaca dari
                data kas toko saat halaman Kasir atau halaman ini terbuka, jadi kabarnya dikirim saat
                salah satu halaman itu dibuka — satu kali per hari per jenis.
              </CardDescription>
            </div>
            <Badge
              data-testid="pemberitahuan-pemilik-lencana"
              variant={shiftSetting.notifyOwner ? "default" : "outline"}
              className="shrink-0 gap-1"
            >
              <BellRing className="size-3" />
              {shiftSetting.notifyOwner ? "Aktif" : "Mati"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {shiftAlerts.length === 0 ? (
            <p data-testid="pemberitahuan-pemilik-kosong" className="text-sm text-muted-foreground">
              Belum ada kabar yang dikirim. Kabarnya muncul kalau kas belum dibuka setengah jam setelah
              jam buka, atau shift belum ditutup saat toko sudah tutup / shiftnya sudah terlalu lama.
            </p>
          ) : (
            <ul className="space-y-2">
              {shiftAlerts.map((alert) => (
                <li
                  key={alert.id}
                  data-testid={`pemberitahuan-pemilik-${alert.kind}`}
                  data-terkirim={shiftAlertDelivered(alert) ? "true" : "false"}
                  className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{alert.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {alert.dayKey} · pukul {alert.localClock} ·{" "}
                        {alert.kind === "till-closed" ? "kas belum dibuka" : "shift belum ditutup"}
                      </p>
                    </div>
                    {alert.resolvedAt ? (
                      <span className="shrink-0 text-xs text-primary">
                        Ditangani {new Date(alert.resolvedAt).toLocaleString("id-ID")}
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        data-testid="pemberitahuan-pemilik-tangani"
                        onClick={() => void resolveShiftAlert(alert.id)}
                      >
                        Tandai ditangani
                      </Button>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{alert.message}</p>
                  <p data-testid="pemberitahuan-pemilik-status" className="mt-2 text-xs">
                    {shiftAlertDeliveryText(alert)}
                  </p>
                  {alert.emailDeliveredAt && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Email berangkat {new Date(alert.emailDeliveredAt).toLocaleString("id-ID")}
                      {alert.emailVia ? ` lewat ${alert.emailVia}` : ""}.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riwayat Z-report</CardTitle>
        </CardHeader>
        <CardContent>
          {till.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada shift yang ditutup.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-medium">Ditutup</th>
                    <th className="pb-2 text-right font-medium">Kas awal</th>
                    <th className="pb-2 text-right font-medium">Tunai</th>
                    <th className="pb-2 text-right font-medium">Seharusnya</th>
                    <th className="pb-2 text-right font-medium">Dihitung</th>
                    <th className="pb-2 text-right font-medium">Selisih</th>
                  </tr>
                </thead>
                <tbody>
                  {till.history.map((shift) => (
                    <tr key={shift.id} className="border-b border-border/50 last:border-0">
                      <td className="py-2.5 text-muted-foreground">
                        {shift.closedAt
                          ? new Date(shift.closedAt).toLocaleString("id-ID")
                          : "—"}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {formatIDR(shift.openingCash)}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {/* Tunai shift itu = yang seharusnya ada dikurangi kas awalnya. */}
                        {formatIDR(shift.expectedCash - shift.openingCash)}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {formatIDR(shift.expectedCash ?? 0)}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">
                        {formatIDR(shift.countedCash ?? 0)}
                      </td>
                      <td
                        className={cn(
                          "py-2.5 text-right font-medium tabular-nums",
                          (shift.variance ?? 0) === 0
                            ? "text-primary"
                            : "text-destructive",
                        )}
                      >
                        {formatIDR(shift.variance ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 text-primary" />
        <span>
          Kapan pengingat tutup shift muncul (jamnya, ambang shift lama, dan
          saklarnya) diatur pemilik toko di halaman Pengaturan. Kas toko disimpan
          sebagai baris tabel
          <code className="mx-1 rounded bg-secondary px-1.5 py-0.5 text-xs">shifts</code>,
          jadi kas yang Anda buka berlaku untuk semua perangkat yang melayani toko
          ini — bukan hanya ponsel ini.
        </span>
        <Link to="/app/pos" className="text-primary hover:underline">
          Buka kasir →
        </Link>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-sm tabular-nums",
          emphasis ? "font-semibold text-foreground" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

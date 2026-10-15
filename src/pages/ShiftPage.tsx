import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Clock,
  Lock,
  Unlock,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useStore } from "@/lib/store";
import { cn, formatIDR } from "@/lib/utils";

const STORAGE_KEY = "mesinpos.shifts.v1";

/**
 * Mirrors the server-side shift model in src/convex/pos.ts:
 * expected cash = opening float + cash taken in (change excluded), and the
 * variance is what the cashier counts minus that expectation.
 *
 * The cash figure is read live from the store's daily summary, so it tracks
 * real sales as soon as they are recorded.
 */
export interface ShiftRecord {
  id: string;
  openedAt: string;
  openingCash: number;
  cashSales: number;
  totalSales: number;
  saleCount: number;
  closedAt: string | null;
  countedCash: number | null;
  expectedCash: number | null;
  variance: number | null;
}

interface ShiftState {
  current: ShiftRecord | null;
  history: ShiftRecord[];
}

const EMPTY_STATE: ShiftState = { current: null, history: [] };

function readState(): ShiftState {
  if (typeof window === "undefined") return EMPTY_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw) as Partial<ShiftState>;
    return {
      current: parsed.current ?? null,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return EMPTY_STATE;
  }
}

export function ShiftPage() {
  const { summary, source } = useStore();

  const [state, setState] = useState<ShiftState>(EMPTY_STATE);
  const [openingCash, setOpeningCash] = useState("300000");
  const [countedCash, setCountedCash] = useState("");
  const [error, setError] = useState<string | null>(null);

  const figures = useMemo(
    () => ({
      cashSales: summary.byMethod.Tunai,
      totalSales: summary.revenue,
      saleCount: summary.transactions,
    }),
    [summary],
  );

  useEffect(() => {
    setState(readState());
  }, []);

  const persist = useCallback((next: ShiftState) => {
    setState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — keep in memory */
    }
  }, []);

  const current = state.current;
  const expectedCash = current ? current.openingCash + figures.cashSales : 0;
  const counted = Number(countedCash || 0);
  const previewVariance = current ? counted - expectedCash : 0;

  const openShift = () => {
    const amount = Number(openingCash || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Kas awal harus berupa angka 0 atau lebih.");
      return;
    }
    setError(null);
    persist({
      ...state,
      current: {
        id: `shift-${Date.now()}`,
        openedAt: new Date().toISOString(),
        openingCash: amount,
        ...figures,
        closedAt: null,
        countedCash: null,
        expectedCash: null,
        variance: null,
      },
    });
  };

  const closeShift = () => {
    if (!current) return;
    if (countedCash.trim() === "" || !Number.isFinite(counted)) {
      setError("Masukkan jumlah uang fisik yang dihitung di kas.");
      return;
    }
    setError(null);
    const closed: ShiftRecord = {
      ...current,
      ...figures,
      closedAt: new Date().toISOString(),
      countedCash: counted,
      expectedCash,
      variance: counted - expectedCash,
    };
    persist({ current: null, history: [closed, ...state.history].slice(0, 10) });
    setCountedCash("");
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
          <Badge variant="default" className="gap-1.5">
            <Unlock className="size-3" /> Shift terbuka
          </Badge>
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
            <Button onClick={openShift}>
              <Unlock /> Buka shift
            </Button>
            <p className="text-xs text-muted-foreground">
              {source === "convex"
                ? "Penjualan tunai dihitung dari transaksi nyata tenant Anda."
                : "Angka penjualan masih berasal dari data demo sampai server tersambung."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
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

              <Button onClick={closeShift} className="w-full">
                <Lock /> Tutup shift & simpan Z-report
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riwayat Z-report</CardTitle>
        </CardHeader>
        <CardContent>
          {state.history.length === 0 ? (
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
                  {state.history.map((shift) => (
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
                        {formatIDR(shift.cashSales)}
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
          Setiap penutupan shift mencatat selisih kas, siap disinkronkan ke tabel
          <code className="mx-1 rounded bg-secondary px-1.5 py-0.5 text-xs">shifts</code>
          saat backend aktif.
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

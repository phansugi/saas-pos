import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Lock, PackagePlus, Power, Puzzle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Vertical } from "@/lib/billing";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * Halaman Modul — pusat Phase 2.
 *
 * Pemilik (atau finance) menyalakan modul vertikal di sini; paket menentukan
 * mana yang boleh hidup dan berapa banyak. Halaman ini **tidak** menyimpan
 * keputusannya sendiri: `setModules` mengirim pilihan ke backend, yang
 * memvalidasi ulang terhadap katalog paket. Fitur yang sudah dibayar tapi belum
 * punya modul aktif ditampilkan terpisah supaya tidak terasa "hilang".
 */
export function ModulesPage() {
  const { modules, setModules } = useStore();
  const [busy, setBusy] = useState<Vertical | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const limitReached =
    modules.limit !== "unlimited" && modules.active.length >= modules.limit;
  const onlyOneActive = modules.active.length <= 1;

  const activeSet = new Set(modules.activeVerticals);

  async function apply(next: Vertical[]) {
    setError(null);
    setNotice(null);
    setBusy(next.length > modules.active.length ? lastAdded(next) : null);
    try {
      await setModules(next);
      setNotice("Modul diperbarui.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  function lastAdded(next: Vertical[]): Vertical | null {
    const added = next.find((vertical) => !activeSet.has(vertical));
    return added ?? null;
  }

  function activate(vertical: Vertical) {
    return apply([...modules.activeVerticals, vertical]);
  }

  function deactivate(vertical: Vertical) {
    return apply(modules.activeVerticals.filter((v) => v !== vertical));
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-primary/12 text-primary">
            <Puzzle className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Modul plug-in</h2>
            <p className="text-sm text-muted-foreground">
              Paket {modules.planName} ·{" "}
              {modules.limit === "unlimited"
                ? "modul tanpa batas"
                : `maksimal ${modules.limit} modul aktif`}
            </p>
          </div>
        </div>
      </header>

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

      <section className="grid gap-4 lg:grid-cols-3">
        {[...modules.available, ...modules.locked].map((card) => {
          const isActive = activeSet.has(card.vertical);
          const isLocked = "reason" in card;
          const lockedReason = isLocked ? (card as { reason: string }).reason : null;
          const blockedByLimit = !isActive && !isLocked && limitReached;

          return (
            <Card
              key={card.vertical}
              className={cn(
                "flex flex-col",
                isActive && "border-primary/50 ring-1 ring-primary/30",
              )}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{card.name}</CardTitle>
                    <CardDescription className="mt-1">{card.tagline}</CardDescription>
                  </div>
                  {isActive ? (
                    <Badge variant="default" className="shrink-0 gap-1">
                      <Check className="size-3" />
                      Aktif
                    </Badge>
                  ) : isLocked ? (
                    <Badge variant="outline" className="shrink-0 gap-1">
                      <Lock className="size-3" />
                      Terkunci
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0">
                      Tersedia
                    </Badge>
                  )}
                </div>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col gap-4">
                <p className="text-sm text-muted-foreground">{card.description}</p>

                <ul className="space-y-1.5 text-sm">
                  {card.features.map((feature) => (
                    <li key={feature.key} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      <span className="text-muted-foreground">{feature.label}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-auto space-y-2">
                  {isActive ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full gap-2"
                        disabled={busy !== null || onlyOneActive}
                        onClick={() => void deactivate(card.vertical)}
                      >
                        <Power className="size-4" />
                        Matikan modul
                      </Button>
                      {onlyOneActive && (
                        <p className="text-xs text-muted-foreground">
                          Minimal satu modul harus tetap aktif.
                        </p>
                      )}
                    </>
                  ) : isLocked ? (
                    <>
                      <Link
                        to="/app/subscription"
                        className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
                      >
                        <PackagePlus className="size-4" />
                        Naikkan paket
                      </Link>
                      <p className="text-xs text-muted-foreground">{lockedReason}</p>
                    </>
                  ) : (
                    <>
                      <Button
                        type="button"
                        className="w-full gap-2"
                        disabled={busy !== null || blockedByLimit}
                        onClick={() => void activate(card.vertical)}
                      >
                        <PackagePlus className="size-4" />
                        {busy === card.vertical ? "Mengaktifkan…" : "Aktifkan modul"}
                      </Button>
                      {blockedByLimit && (
                        <p className="text-xs text-muted-foreground">
                          Batas modul paket {modules.planName} tercapai. Matikan satu modul
                          dulu, atau naikkan paket.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Menunggu modulnya dinyalakan</h3>
        {modules.blocked.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Semua fitur yang sudah Anda bayar sedang bisa dipakai.
          </p>
        ) : (
          <ul className="space-y-2">
            {modules.blocked.map((entry) => (
              <li
                key={entry.feature}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-secondary/20 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{entry.label}</div>
                  <div className="text-xs text-muted-foreground">
                    Bagian dari modul {entry.moduleName}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || limitReached}
                  onClick={() => void activate(entry.vertical)}
                >
                  Aktifkan {entry.moduleName}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Modul yang dimatikan tidak menghapus data: transaksi, produk, dan laporan tetap utuh
        dan bisa dibuka lagi kapan saja.
      </p>
    </div>
  );
}

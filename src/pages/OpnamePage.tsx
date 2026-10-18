import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Lock,
  Play,
  RotateCcw,
  XCircle,
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
import { DEFAULT_WAREHOUSE_ID } from "@/lib/inventory";
import {
  canCancelOpname,
  canEditOpname,
  canPostOpname,
  MAX_OPNAME_NOTE,
  OPNAME_STATUS_LABELS,
} from "@/lib/opname";
import { useSession } from "@/lib/session";
import { useStore } from "@/lib/store";
import { featureUnavailableReason } from "@/lib/store/modules";
import type { StoreOpnameSession } from "@/lib/store/types";
import { useCan } from "@/lib/usePermission";
import { cn } from "@/lib/utils";

/**
 * Stock opname (`inventory.opname`) — Phase 3.
 *
 * Aturan yang menentukan halaman ini: **hitungan fisik menggantikan saldo
 * sistem**, bukan menambahinya. Karena itu satu lokasi hanya boleh punya satu
 * sesi berjalan, setiap baris menyimpan snapshot saldo saat sesi dimulai, dan
 * selisih baru masuk ledger setelah sesi **diposting** — sehingga hitungan yang
 * belum selesai tidak pernah mengubah stok.
 *
 * Waktu penghitungan bisa berselang dengan penjualan, jadi posting memakai saldo
 * lokasi **saat itu** (`currentQty`) sebagai titik awal, bukan snapshot: hasil
 * hitung tetap menjadi angka akhir, dan selisih yang tercipta dari penjualan di
 * tengah sesi ikut tercatat apa adanya.
 */
export function OpnamePage() {
  const {
    products,
    opnameSessions,
    opnameLocations,
    opnameSummary,
    opnameOpenByLocation,
    startOpname,
    setOpnameCount,
    postOpname,
    cancelOpname,
    modules,
  } = useStore();
  const { session: authSession } = useSession();
  const can = useCan();

  const canManage = can("inventory.manage");
  const planKey = authSession?.tenant?.planKey ?? "starter";
  const gateReason = featureUnavailableReason(
    planKey,
    modules.activeVerticals,
    "inventory.opname",
  );

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startForm, setStartForm] = useState({
    locationId: DEFAULT_WAREHOUSE_ID,
    note: "",
  });
  /** Nilai yang sedang diketik, per sesi per produk. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const openSessions = useMemo(
    () => opnameSessions.filter((row) => row.status === "draft"),
    [opnameSessions],
  );
  const doneSessions = useMemo(
    () => opnameSessions.filter((row) => row.status !== "draft"),
    [opnameSessions],
  );

  const selected: StoreOpnameSession | null =
    opnameSessions.find((row) => row.id === selectedId) ?? openSessions[0] ?? null;

  const selectedLocationName =
    opnameLocations.find((row) => row.id === startForm.locationId)?.name ??
    opnameLocations[0]?.name ??
    "Lokasi jual";

  const blockingSession = opnameOpenByLocation.find(
    (row) => row.locationId === startForm.locationId,
  );

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

  function submitStart() {
    if (busy) return;
    run(
      async () => {
        const created = await startOpname({
          warehouseId: startForm.locationId,
          note: startForm.note.trim() || undefined,
        });
        setStartForm((current) => ({ ...current, note: "" }));
        setSelectedId(created.id);
        return created;
      },
      `Sesi ${selectedLocationName} dimulai.`,
    );
  }

  /** Menyimpan satu baris hitung; nilai kosong = kembalikan ke "belum dihitung". */
  function commitCount(target: StoreOpnameSession, productId: string) {
    const key = `${target.id}:${productId}`;
    const raw = drafts[key];
    if (raw === undefined) return;
    const line = target.lines.find((row) => row.productId === productId);
    const parsed = raw.trim() === "" ? undefined : Number(raw);
    if (parsed !== undefined && (!Number.isFinite(parsed) || parsed < 0)) {
      setError("Jumlah hitung harus angka 0 atau lebih.");
      return;
    }
    if (parsed === (line?.countedQty ?? undefined)) {
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    run(async () => {
      await setOpnameCount({
        sessionId: target.id,
        productId,
        countedQty: parsed,
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }, "Hitungan disimpan.");
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-primary/12 text-primary">
            <ClipboardCheck className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Stock Opname</h2>
            <p className="text-sm text-muted-foreground">
              {openSessions.length} sesi berjalan · {opnameSummary.remainingLines}{" "}
              baris belum dihitung · selisih bersih berjalan{" "}
              {opnameSummary.runningNetUnits > 0 ? "+" : ""}
              {opnameSummary.runningNetUnits} unit
            </p>
          </div>
        </div>
        {gateReason && (
          <Badge variant="outline" className="gap-1.5 py-1">
            <Lock className="size-3" />
            Sesi baru butuh paket lebih tinggi
          </Badge>
        )}
      </header>

      {gateReason && (
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          {gateReason} Halaman ini hanya bisa dibaca: sesi yang sudah berjalan pun
          tidak bisa dihitung, diposting, atau dibatalkan dari sini sampai
          langganannya memuat modul itu.{" "}
          {can("billing.manage") && (
            <Link to="/app/subscription" className="underline">
              Kelola langganan
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

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Sesi berjalan",
            value: String(opnameSummary.openCount),
            hint: `${opnameSummary.remainingLines} baris tersisa`,
          },
          {
            label: "Selesai",
            value: String(opnameSummary.postedCount),
            hint: "sudah diposting ke ledger",
          },
          {
            label: "Dibatalkan",
            value: String(opnameSummary.cancelledCount),
            hint: "tidak mengubah stok",
          },
          {
            label: "Selisih berjalan",
            value: `${opnameSummary.runningNetUnits > 0 ? "+" : ""}${opnameSummary.runningNetUnits}`,
            hint: "unit, dari sesi yang belum diposting",
          },
        ].map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="font-mono text-xl">{card.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {card.hint}
            </CardContent>
          </Card>
        ))}
      </section>

      {/* ----------------------------- mulai sesi -------------------------- */}
      {canManage && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Play className="size-4" />
              Mulai sesi hitung
            </CardTitle>
            <CardDescription>
              Baris sesi adalah snapshot saldo lokasi saat ini; satu lokasi hanya
              boleh punya satu sesi berjalan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="text-xs text-muted-foreground md:col-span-2">
                Lokasi yang dihitung
                <select
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                  value={startForm.locationId}
                  aria-label="Lokasi yang dihitung"
                  onChange={(e) =>
                    setStartForm((current) => ({
                      ...current,
                      locationId: e.target.value,
                    }))
                  }
                >
                  {opnameLocations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                      {location.active ? "" : " (nonaktif)"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground md:col-span-2">
                Catatan sesi (opsional)
                <Input
                  className="mt-1"
                  maxLength={MAX_OPNAME_NOTE}
                  value={startForm.note}
                  placeholder="Opname akhir bulan"
                  onChange={(e) =>
                    setStartForm((current) => ({ ...current, note: e.target.value }))
                  }
                />
              </label>
            </div>

            {blockingSession && (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {selectedLocationName} masih punya sesi berjalan (
                {blockingSession.number}). Selesaikan atau batalkan sesi itu dulu.
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                disabled={
                  busy ||
                  gateReason !== null ||
                  blockingSession !== undefined ||
                  products.length === 0
                }
                title={gateReason ?? `Hitung ${selectedLocationName}`}
                onClick={submitStart}
              >
                <Play />
                Mulai hitung {selectedLocationName}
              </Button>
              <span className="text-xs text-muted-foreground">
                {products.length} produk aktif ikut dihitung.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* --------------------------- daftar sesi --------------------------- */}
      {opnameSessions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {[...openSessions, ...doneSessions].map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setSelectedId(row.id)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                selected?.id === row.id
                  ? "border-primary/50 bg-primary/10"
                  : "border-border/60 hover:bg-secondary/40",
              )}
            >
              <span className="block font-mono text-[11px] text-muted-foreground">
                {row.number}
              </span>
              <span className="block font-medium">{row.locationName}</span>
              <span className="block text-muted-foreground">
                {OPNAME_STATUS_LABELS[row.status]} · {row.progress.counted}/
                {row.progress.total}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <SessionCard
          session={selected}
          busy={busy}
          canManage={canManage}
          drafts={drafts}
          onDraft={(productId, value) =>
            setDrafts((current) => ({
              ...current,
              [`${selected.id}:${productId}`]: value,
            }))
          }
          onCommit={(productId) => commitCount(selected, productId)}
          onPost={() =>
            run(
              () => postOpname(selected.id),
              `Sesi ${selected.number} diposting; stok ${selected.locationName} kini sama dengan hasil hitung.`,
            )
          }
          onCancel={() =>
            run(
              () => cancelOpname(selected.id),
              `Sesi ${selected.number} dibatalkan tanpa mengubah stok.`,
            )
          }
        />
      )}

      {opnameSessions.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Belum ada sesi opname. Mulai dari lokasi jual atau salah satu gudang
            untuk membandingkan stok sistem dengan hasil hitung fisik.
          </CardContent>
        </Card>
      )}

      {!canManage && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="size-3.5" />
          Melihat sesi butuh izin `inventory.view`; menghitung, memposting, dan
          membatalkan sesi butuh peran manajer, pemilik, atau staf gudang.
        </p>
      )}
    </div>
  );
}

/** Satu sesi: progres, tabel hitung, dan aksi posting / pembatalan. */
function SessionCard({
  session,
  busy,
  canManage,
  drafts,
  onDraft,
  onCommit,
  onPost,
  onCancel,
}: {
  session: StoreOpnameSession;
  busy: boolean;
  canManage: boolean;
  drafts: Record<string, string>;
  onDraft: (productId: string, value: string) => void;
  onCommit: (productId: string) => void;
  onPost: () => void;
  onCancel: () => void;
}) {
  const editable = canEditOpname(session.status).ok;
  const postable = canPostOpname({
    status: session.status,
    lines: session.lines,
  });
  const cancellable = canCancelOpname(session.status).ok;
  const { progress, variance } = session;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="size-4" />
              {session.number} · {session.locationName}
            </CardTitle>
            <CardDescription>
              {OPNAME_STATUS_LABELS[session.status]} · dimulai{" "}
              {new Date(session.createdAt).toLocaleString("id-ID", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              {session.note ? ` · ${session.note}` : ""}
            </CardDescription>
          </div>
          <Badge
            variant={
              session.status === "draft"
                ? "default"
                : session.status === "posted"
                  ? "secondary"
                  : "outline"
            }
          >
            {progress.counted}/{progress.total} dihitung
          </Badge>
        </div>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {variance.matched} baris cocok · {variance.surplusLines} lebih (
          {variance.surplusUnits} unit) · {variance.shortageLines} kurang (
          {variance.shortageUnits} unit) · selisih bersih{" "}
          <span
            className={cn(
              "font-mono",
              variance.netUnits > 0 && "text-primary",
              variance.netUnits < 0 && "text-destructive",
            )}
          >
            {variance.netUnits > 0 ? "+" : ""}
            {variance.netUnits}
          </span>
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-2">Produk</th>
                <th className="px-2 py-2 text-right">Sistem (snapshot)</th>
                <th className="px-2 py-2 text-right">Sekarang</th>
                <th className="px-2 py-2 text-right">Hitung fisik</th>
                <th className="px-2 py-2 text-right">Selisih</th>
              </tr>
            </thead>
            <tbody>
              {session.lines.map((line) => {
                const key = `${session.id}:${line.productId}`;
                const value =
                  drafts[key] ?? (line.countedQty === undefined ? "" : String(line.countedQty));
                const delta = line.countedQty === undefined ? null : line.variance ?? 0;
                return (
                  <tr key={key} className="border-t border-border/60">
                    <td className="px-2 py-2">
                      <div className="font-medium">{line.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {line.sku || "—"} · {line.unit || "unit"}
                        {line.note ? ` · ${line.note}` : ""}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-muted-foreground">
                      {line.systemQty}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-muted-foreground">
                      {line.currentQty}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {editable ? (
                        <Input
                          className="ml-auto w-24 text-right font-mono"
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          value={value}
                          aria-label={`Jumlah hitung ${line.name}`}
                          placeholder="—"
                          onChange={(e) => onDraft(line.productId, e.target.value)}
                          onBlur={() => onCommit(line.productId)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") onCommit(line.productId);
                          }}
                        />
                      ) : (
                        <span className="font-mono">
                          {line.countedQty === undefined ? "—" : line.countedQty}
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2 text-right font-mono",
                        delta === null && "text-muted-foreground",
                        delta !== null && delta > 0 && "text-primary",
                        delta !== null && delta < 0 && "text-destructive",
                      )}
                    >
                      {delta === null
                        ? "belum dihitung"
                        : `${delta > 0 ? "+" : ""}${delta}`}
                    </td>
                  </tr>
                );
              })}
              {session.lines.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-2 py-4 text-center text-sm text-muted-foreground"
                  >
                    Tidak ada produk ber-stok di lokasi ini saat sesi dimulai.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-secondary/20 p-3">
            <Button
              disabled={busy || !postable.ok}
              title={postable.ok ? "Terapkan hasil hitung" : postable.reason}
              onClick={onPost}
            >
              <CheckCircle2 />
              Posting hasil hitung
            </Button>
            {cancellable && (
              <Button variant="ghost" disabled={busy} onClick={onCancel}>
                <XCircle />
                Batalkan sesi
              </Button>
            )}
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RotateCcw className="size-3.5" />
              {postable.ok
                ? "Posting menulis satu baris ledger per baris yang berbeda."
                : postable.reason}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  GitCompareArrows,
  Lock,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Smartphone,
  Wifi,
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
import {
  PUSH_OUTCOME_LABELS,
  SYNC_ENTITY_KEYS,
  SYNC_ENTITY_LABELS,
  SYNC_PLATFORM_KEYS,
  SYNC_PLATFORM_LABELS,
  type PresenceState,
  type SyncEntity,
  type SyncPlatform,
} from "@/lib/sync";
import { useSession } from "@/lib/session";
import { useStore, type PullSyncResult } from "@/lib/store";
import { featureUnavailableReason } from "@/lib/store/modules";
import { useCan } from "@/lib/usePermission";
import { cn } from "@/lib/utils";

/**
 * Sinkronisasi real-time multi-perangkat (`sync.realtime`, Phase 6).
 *
 * Halaman ini memperlihatkan hub-nya apa adanya: perangkat mana yang sedang
 * online (kehadiran diturunkan dari detak terakhir, bukan status tersimpan),
 * revisi mana yang sudah dilihat tiap perangkat, dan perubahan apa yang terakhir
 * masuk — termasuk yang **bertabrakan**. Dorongan yang basisnya sudah basi
 * diselesaikan last-write-wins oleh aturan murni `@/lib/sync`, jadi dua kasir
 * tidak bisa saling menimpa tanpa jejak.
 *
 * Gerbangnya mengikuti server: **mendaftarkan perangkat** dan **mendorong
 * perubahan** butuh fitur `sync.realtime`; **detak, menarik, dan menandai konflik
 * selesai** selalu boleh — perangkat yang kehilangan fiturnya tetap bisa
 * mengosongkan perubahan terakhirnya.
 */

const PRESENCE_TONE: Record<PresenceState, string> = {
  online: "border-primary/40 bg-primary/10 text-primary",
  idle: "border-accent/50 bg-accent/10 text-accent",
  offline: "border-border/60 bg-secondary/20 text-muted-foreground",
};

const PRESENCE_LABEL: Record<PresenceState, string> = {
  online: "Online",
  idle: "Menganggur",
  offline: "Offline",
};

const OUTCOME_TONE: Record<string, string> = {
  applied: "border-primary/40 bg-primary/10 text-primary",
  rebased: "border-accent/50 bg-accent/10 text-accent",
  rejected: "border-destructive/50 bg-destructive/10 text-destructive",
};

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function describeIdle(seconds: number): string {
  if (seconds < 60) return `${seconds} detik lalu`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} menit lalu`;
  return `${Math.floor(seconds / 3600)} jam lalu`;
}

export function SyncPage() {
  const {
    syncDevices,
    syncChanges,
    syncSummary,
    syncLagging,
    syncPlan,
    syncLimits,
    syncEntities,
    syncPlatforms,
    registerSyncDevice,
    heartbeatSyncDevice,
    pushSync,
    pullSync,
    resolveSyncChange,
    modules,
  } = useStore();
  const { session } = useSession();
  const can = useCan();
  /*
    Hub real-time (`sync.realtime`) milik paket Professional ke atas. Tanpa
    fiturnya halaman ini hanya bisa dibaca (gerbang rutenya `ModuleRoute`), jadi
    kalimat alasannya dipakai di sini juga.
  */
  const gateReason = featureUnavailableReason(
    session?.tenant?.planKey ?? "starter",
    modules.activeVerticals,
    "sync.realtime",
  );
  const canManage = can("device.manage");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    label: "",
    platform: "android" as SyncPlatform,
    fingerprint: "",
  });
  const [push, setPush] = useState({
    deviceId: "",
    entity: "stock" as SyncEntity,
    entityId: "p05",
    baseRevision: "0",
    payload: '{"stock":"17"}',
  });
  /** Tarik perubahan: kursor yang sudah dilihat perangkat + batas satu jendela. */
  const [pull, setPull] = useState({ cursor: "0", limit: "" });
  const [pulled, setPulled] = useState<PullSyncResult | null>(null);

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

  const submitDevice = () =>
    void run(async () => {
      const created = await registerSyncDevice({
        label: form.label,
        platform: form.platform,
        fingerprint: form.fingerprint,
      });
      setForm({ label: "", platform: form.platform, fingerprint: "" });
      setNotice(`Perangkat ${created.name} tersambung ke hub real-time.`);
    }, "Perangkat tersambung.");

  const submitPush = () => {
    const device =
      syncDevices.find((row) => row.deviceId === push.deviceId) ??
      syncDevices[0] ??
      null;
    void run(async () => {
      if (!device) throw new Error("Sambungkan satu perangkat dulu.");
      const result = await pushSync({
        deviceFingerprint: device.fingerprint,
        deviceName: device.name,
        platform: device.platform,
        entity: push.entity,
        entityId: push.entityId,
        baseRevision: Number(push.baseRevision.replace(/[^\d]/g, "")) || 0,
        updatedAt: Date.now(),
        payload: push.payload,
      });
      setNotice(
        `Revisi ${result.revision} · ${PUSH_OUTCOME_LABELS[result.outcome]}${
          result.reason ? ` — ${result.reason}` : ""
        }`,
      );
    }, "Perubahan didorong.");
  };

  const submitPull = () => {
    void run(async () => {
      const result = await pullSync({
        cursor: Number(pull.cursor.replace(/[^\d]/g, "")) || 0,
        limit:
          pull.limit.trim() === ""
            ? undefined
            : Number(pull.limit.replace(/[^\d]/g, "")) || undefined,
      });
      setPulled(result);
    }, "Perubahan ditarik.");
  };

  return (
    <div className="space-y-6">
      {/* ------------------------------- Ringkasan hub ----------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="size-4" />
            Sinkronisasi real-time multi-perangkat
          </CardTitle>
          <CardDescription>
            {syncPlan.planName} · revisi tertinggi{" "}
            <span className="font-mono">{syncSummary.latestRevision}</span> ·
            kehadiran dihitung dari detak terakhir (online ≤{" "}
            {Math.round(syncLimits.onlineWindowMs / 1000)} detik, menganggur ≤{" "}
            {Math.round(syncLimits.idleWindowMs / 60000)} menit).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!syncPlan.realtime && (
            <p className="flex items-start gap-2 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-sm text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              {gateReason} Halaman ini hanya bisa dibaca: perangkat dan konflik
              lama tetap terlihat, tetapi mendaftarkan perangkat, mendorong
              perubahan, menarik, dan membereskan konflik tidak bisa dari sini
              sampai langganannya memuat modul itu.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Online", value: syncSummary.online, hint: "mendetak baru-baru ini" },
              { label: "Menganggur", value: syncSummary.idle, hint: "masih terhubung, jarang aktif" },
              { label: "Offline", value: syncSummary.offline, hint: "tidak terdengar" },
              {
                label: "Konflik belum selesai",
                value: syncSummary.unresolvedConflicts,
                hint: `${syncSummary.resolvedConflicts} sudah ditandai selesai`,
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
            <Badge variant={syncPlan.realtime ? "accent" : "outline"}>
              {syncPlan.realtime ? "Hub real-time aktif" : "Hub real-time nonaktif"}
            </Badge>
            <span>
              {syncSummary.total} perangkat · batas muatan{" "}
              {syncLimits.maxPayload.toLocaleString("id-ID")} karakter · toleransi
              jam {Math.round(syncLimits.maxClockSkewMs / 60000)} menit.
            </span>
          </div>
          {syncLagging.length > 0 && (
            <p className="flex items-start gap-2 text-sm text-accent">
              <GitCompareArrows className="mt-0.5 size-3.5 shrink-0" />
              {syncLagging.length} perangkat online belum menerima revisi terbaru —
              tarik perubahan di perangkat itu sebelum menutup kasir.
            </p>
          )}
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

      {/* ------------------------------- Perangkat --------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="size-4" />
            Perangkat hub
          </CardTitle>
          <CardDescription>
            Kehadiran diturunkan dari detak terakhir; revisi adalah perubahan
            terakhir yang sudah dilihat perangkat ini.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canManage || syncDevices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {canManage
                ? "Belum ada perangkat tersambung. Sambungkan kasir pertama Anda di bawah."
                : "Hub perangkat hanya terbuka untuk peran dengan izin mengelola perangkat."}
            </p>
          ) : (
            syncDevices.map((device) => (
              <div
                key={device.deviceId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-secondary/10 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{device.name}</span>
                    <Badge variant="outline">
                      {SYNC_PLATFORM_LABELS[device.platform]}
                    </Badge>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs",
                        PRESENCE_TONE[device.presence],
                      )}
                    >
                      <Wifi className="size-3" />
                      {PRESENCE_LABEL[device.presence]}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {device.fingerprint} · revisi {device.revision} · terakhir{" "}
                    {describeIdle(device.idleSeconds)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => heartbeatSyncDevice(device.deviceId),
                      `${device.name} melaporkan detak.`,
                    )
                  }
                >
                  <RefreshCw className="size-4" />
                  Detak
                </Button>
              </div>
            ))
          )}

          {canManage && (
            <div className="space-y-3 rounded-lg border border-dashed border-border/60 p-4">
              <div className="text-sm font-semibold">Sambungkan perangkat</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sync-label">Nama perangkat</Label>
                  <Input
                    id="sync-label"
                    value={form.label}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, label: event.target.value }))
                    }
                    placeholder="Kasir Depan"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sync-platform">Jenis</Label>
                  <select
                    id="sync-platform"
                    value={form.platform}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        platform: event.target.value as SyncPlatform,
                      }))
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {(syncPlatforms.length > 0
                      ? syncPlatforms
                      : SYNC_PLATFORM_KEYS.map((key) => ({
                          key,
                          label: SYNC_PLATFORM_LABELS[key],
                        }))
                    ).map((platform) => (
                      <option key={platform.key} value={platform.key}>
                        {platform.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sync-fingerprint">Sidik perangkat</Label>
                  <Input
                    id="sync-fingerprint"
                    value={form.fingerprint}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        fingerprint: event.target.value,
                      }))
                    }
                    placeholder="fp-kasir-depan-02"
                  />
                </div>
              </div>
              <Button disabled={busy || !syncPlan.realtime} onClick={submitDevice}>
                <Plus className="size-4" />
                Sambungkan
              </Button>
              {!syncPlan.realtime && (
                <p className="text-xs text-muted-foreground">
                  Naikkan paket untuk menyambungkan perangkat ke hub real-time.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------- Dorong perubahan -------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="size-4" />
            Dorong perubahan
          </CardTitle>
          <CardDescription>
            Basis revisi dibandingkan dengan revisi entitas di server. Kalau
            ada perubahan yang lebih baru, aturan last-write-wins yang memutuskan
            — lengkap dengan alasannya.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canManage ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              Peran Anda dapat melihat hub, tetapi mendorong perubahan adalah
              wewenang pemilik/manajer.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="push-device">Perangkat</Label>
                  <select
                    id="push-device"
                    value={push.deviceId || syncDevices[0]?.deviceId || ""}
                    onChange={(event) =>
                      setPush((current) => ({ ...current, deviceId: event.target.value }))
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {syncDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="push-entity">Jenis data</Label>
                  <select
                    id="push-entity"
                    value={push.entity}
                    onChange={(event) =>
                      setPush((current) => ({
                        ...current,
                        entity: event.target.value as SyncEntity,
                      }))
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {(syncEntities.length > 0
                      ? syncEntities
                      : SYNC_ENTITY_KEYS.map((key) => ({
                          key,
                          label: SYNC_ENTITY_LABELS[key],
                        }))
                    ).map((entity) => (
                      <option key={entity.key} value={entity.key}>
                        {entity.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="push-entity-id">ID data</Label>
                  <Input
                    id="push-entity-id"
                    value={push.entityId}
                    onChange={(event) =>
                      setPush((current) => ({ ...current, entityId: event.target.value }))
                    }
                    placeholder="p05"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="push-base">Basis revisi</Label>
                  <Input
                    id="push-base"
                    inputMode="numeric"
                    value={push.baseRevision}
                    onChange={(event) =>
                      setPush((current) => ({
                        ...current,
                        baseRevision: event.target.value,
                      }))
                    }
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5 xl:col-span-2">
                  <Label htmlFor="push-payload">Muatan</Label>
                  <Input
                    id="push-payload"
                    value={push.payload}
                    onChange={(event) =>
                      setPush((current) => ({ ...current, payload: event.target.value }))
                    }
                    placeholder='{"stock":"17"}'
                  />
                </div>
              </div>
              <Button
                disabled={busy || !syncPlan.realtime || syncDevices.length === 0}
                onClick={submitPush}
              >
                <Send className="size-4" />
                Dorong
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------- Tarik perubahan -------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="size-4" />
            Tarik perubahan
          </CardTitle>
          <CardDescription>
            Satu giliran tarik mengambil tepat satu jendela perubahan di atas
            kursor (maksimal {syncLimits.maxChangesPerPull} baris) dan menunjuk
            kursor berikutnya — perangkat menyusul ketinggalannya tanpa menarik
            seluruh riwayat. Gerbang fiturnya searah dengan server: menarik selalu
            boleh, jadi perangkat yang paketnya turun tetap bisa mengosongkan
            perubahan terakhirnya.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canManage ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              Peran Anda dapat melihat hub, tetapi menarik perubahan adalah
              wewenang pemilik/manajer.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pull-cursor">Kursor revisi</Label>
                  <Input
                    id="pull-cursor"
                    inputMode="numeric"
                    value={pull.cursor}
                    onChange={(event) =>
                      setPull((current) => ({ ...current, cursor: event.target.value }))
                    }
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pull-limit">Batas baris</Label>
                  <Input
                    id="pull-limit"
                    inputMode="numeric"
                    value={pull.limit}
                    onChange={(event) =>
                      setPull((current) => ({ ...current, limit: event.target.value }))
                    }
                    placeholder={`${syncLimits.maxChangesPerPull}`}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={busy} onClick={submitPull}>
                  <Download className="size-4" />
                  Tarik
                </Button>
                {pulled && (
                  <span className="text-xs text-muted-foreground">
                    {pulled.items.length} perubahan · kursor berikutnya r
                    {pulled.nextCursor} ·{" "}
                    {pulled.hasMore
                      ? "masih ada baris di atasnya"
                      : "sudah yang terbaru"}{" "}
                    · revisi tertinggi r{pulled.latestRevision}
                  </span>
                )}
              </div>
              {pulled && (
                <ul className="space-y-1.5 border-l border-border/60 pl-3">
                  {pulled.items.length === 0 ? (
                    <li className="text-xs text-muted-foreground">
                      Tidak ada perubahan di atas kursor itu.
                    </li>
                  ) : (
                    pulled.items.map((item) => (
                      <li key={item.id} className="text-xs">
                        <span className="font-mono text-muted-foreground">
                          r{item.revision}
                        </span>{" "}
                        {SYNC_ENTITY_LABELS[item.entity] ?? item.entity}{" "}
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {item.entityId}
                        </span>{" "}
                        · {PUSH_OUTCOME_LABELS[item.outcome]}
                        {item.conflict ? " · konflik" : ""}
                      </li>
                    ))
                  )}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------- Log perubahan ---------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <GitCompareArrows className="size-4" />
            Log perubahan
          </CardTitle>
          <CardDescription>
            Revisi naik satu-satu per tenant. Konflik append-only: riwayatnya tidak
            dihapus, hanya ditandai selesai saat sudah dibereskan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!canManage || syncChanges.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {canManage
                ? "Belum ada perubahan tercatat. Dorongan pertama dari perangkat akan muncul di sini."
                : "Log sinkronisasi hanya terbuka untuk peran dengan izin mengelola perangkat."}
            </p>
          ) : (
            syncChanges.map((change) => (
              <div
                key={change.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/60 bg-secondary/10 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      r{change.revision}
                    </span>
                    <span className="text-sm font-semibold">
                      {SYNC_ENTITY_LABELS[change.entity] ?? change.entity}{" "}
                      <span className="font-mono text-xs text-muted-foreground">
                        {change.entityId}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs",
                        OUTCOME_TONE[change.outcome],
                      )}
                    >
                      {PUSH_OUTCOME_LABELS[change.outcome]}
                    </span>
                    {change.conflict && (
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs",
                          change.resolvedAt === null
                            ? "border-destructive/50 bg-destructive/10 text-destructive"
                            : "border-border text-muted-foreground",
                        )}
                      >
                        {change.resolvedAt === null ? "konflik terbuka" : "konflik selesai"}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {change.deviceName} · basis r{change.baseRevision} ·{" "}
                    {formatClock(change.createdAt)}
                  </div>
                  {change.reason && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {change.reason}
                    </div>
                  )}
                  <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground/80">
                    {change.payload}
                  </div>
                </div>
                {change.conflict && change.resolvedAt === null && canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => resolveSyncChange(change.id),
                        `Konflik r${change.revision} ditandai selesai.`,
                      )
                    }
                  >
                    <CheckCircle2 className="size-4" />
                    Tandai selesai
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Copy,
  KeyRound,
  Lock,
  PenLine,
  Plug,
  RadioTower,
  RefreshCw,
  Send,
  Trash2,
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
import { PERMISSION_LABELS, ROLE_LABELS, type Permission } from "@/lib/authz";
import {
  API_KEY_EXPIRY_OPTIONS,
  API_RESOURCES,
  API_SCOPE_OPTIONS,
  maskApiKey,
  validateApiKeyInput,
} from "@/lib/apiKeys";
import {
  sanitizeWebhookEvents,
  validateWebhookEndpoint,
  WEBHOOK_EVENTS,
} from "@/lib/webhooks";
import {
  describeExternalOrder,
  sampleExternalOrderBody,
} from "@/lib/apiOrders";
import { useSession } from "@/lib/session";
import { useStore } from "@/lib/store";
import { featureUnavailableReason } from "@/lib/store/modules";
import { useCan, usePermissions } from "@/lib/usePermission";
import { cn } from "@/lib/utils";

/**
 * API & Webhook (`api.access`, Phase 4 / Enterprise Intelligence).
 *
 * Halaman ini adalah pintu keluar data MesinPOS: **kunci API** untuk membaca dan
 * (satu endpoint) **menulis** lewat `/api/v1/*`, plus **webhook** yang kita kirim
 * ke server tenant saat sesuatu terjadi. Dua hal yang sengaja tidak pernah
 * ditampilkan lagi di sini:
 *
 * - rahasia kunci API — yang tersimpan hanya hash-nya, jadi setelah dialog
 *   “salin sekarang” ditutup, rahasianya memang tidak bisa dibaca ulang;
 * - rahasia webhook yang sudah dibuat — kalau hilang, putar saja rahasianya.
 *
 * Gerbangnya mengikuti aturan yang sama dengan server: **membuat** kunci dan
 * **mengubah langganan** webhook butuh fitur `api.access` + izin `api.manage`,
 * sementara **mencabut kunci**, **mematikan/menghapus endpoint**, dan **melihat
 * daftarnya** selalu boleh. Mencabut akses tidak boleh ikut terkunci saat paket
 * turun — itu justru tindakan pengamanannya.
 */
export function ApiPage() {
  const {
    apiKeys,
    apiKeySummary,
    webhookEndpoints,
    webhookDeliveries,
    webhookSummary,
    createApiKey,
    revokeApiKey,
    createWebhookEndpoint,
    updateWebhookEndpoint,
    removeWebhookEndpoint,
    testWebhookEndpoint,
    modules,
  } = useStore();
  const { session } = useSession();
  const can = useCan();
  const permissions = usePermissions();

  const canManage = can("api.manage");
  const planKey = session?.tenant?.planKey ?? "starter";
  // Alasan yang ditulis halaman sama dengan yang akan dijawab server
  // (`requireFeature`), jadi tidak ada tombol yang pasti ditolak.
  const gateReason = featureUnavailableReason(
    planKey,
    modules.activeVerticals,
    "api.access",
  );

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [freshKey, setFreshKey] = useState<{ name: string; plaintext: string } | null>(
    null,
  );
  const [freshSecret, setFreshSecret] = useState<{ url: string; secret: string } | null>(
    null,
  );
  const [keyForm, setKeyForm] = useState({
    name: "",
    scopes: [] as Permission[],
    expiresInDays: 90,
  });
  const [endpointForm, setEndpointForm] = useState({
    url: "",
    description: "",
    events: ["sale.completed"] as string[],
  });

  /** Scope yang boleh dipilih: hanya yang **juga** dipegang pengguna ini. */
  const selectableScopes = useMemo(
    () => API_SCOPE_OPTIONS.filter((option) => permissions.includes(option.permission)),
    [permissions],
  );

  const keyPreview = useMemo(
    () =>
      validateApiKeyInput(
        {
          name: keyForm.name,
          scopes: keyForm.scopes,
          expiresInDays: keyForm.expiresInDays,
        },
        {
          permissions,
          existingNames: apiKeys.map((row) => row.name),
          activeCount: apiKeySummary.active,
        },
      ),
    [apiKeys, apiKeySummary.active, keyForm, permissions],
  );

  const endpointPreview = useMemo(
    () =>
      validateWebhookEndpoint(
        {
          url: endpointForm.url,
          description: endpointForm.description,
          events: endpointForm.events,
        },
        { existingUrls: webhookEndpoints.map((row) => row.url) },
      ),
    [endpointForm, webhookEndpoints],
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

  function toggleScope(scope: Permission) {
    setKeyForm((current) => ({
      ...current,
      scopes: current.scopes.includes(scope)
        ? current.scopes.filter((value) => value !== scope)
        : [...current.scopes, scope],
    }));
  }

  function toggleEvent(event: string) {
    setEndpointForm((current) => ({
      ...current,
      events: current.events.includes(event)
        ? current.events.filter((value) => value !== event)
        : [...current.events, event],
    }));
  }

  function submitKey() {
    if (busy || !keyPreview.ok) return;
    const value = keyPreview.value;
    setBusy(true);
    setError(null);
    setNotice(null);
    createApiKey({
      name: value.name,
      scopes: value.scopes,
      expiresInDays: keyForm.expiresInDays,
    })
      .then((created) => {
        setFreshKey({ name: created.name, plaintext: created.plaintext });
        setNotice(
          `Kunci ${created.name} dibuat. Rahasianya hanya tampil sekali — salin sekarang.`,
        );
        setKeyForm({ name: "", scopes: [], expiresInDays: 90 });
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setBusy(false));
  }

  function submitEndpoint() {
    if (busy || !endpointPreview.ok) return;
    const value = endpointPreview.value;
    setBusy(true);
    setError(null);
    setNotice(null);
    createWebhookEndpoint({
      url: value.url,
      description: value.description,
      events: value.events,
    })
      .then((created) => {
        setFreshSecret({ url: value.url, secret: created.secret });
        setNotice(`Endpoint ${value.url} terdaftar. Rahasianya hanya tampil sekali.`);
        setEndpointForm({ url: "", description: "", events: ["sale.completed"] });
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setBusy(false));
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-primary/12 text-primary">
            <Plug className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-tight">API &amp; Webhook</h2>
            <p className="text-sm text-muted-foreground">
              {apiKeySummary.active} kunci aktif · {webhookSummary.activeEndpoints} endpoint
              webhook aktif · {webhookSummary.pendingDeliveries} kiriman menunggu
            </p>
          </div>
        </div>
        {gateReason && (
          <Badge variant="outline" className="gap-1.5 py-1">
            <Lock className="size-3" />
            API akses terkunci
          </Badge>
        )}
      </header>

      {gateReason && (
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          {gateReason} Kunci dan endpoint yang sudah ada tetap terlihat, dan keduanya
          tetap bisa dicabut/dimatikan; yang ditolak adalah membuat kunci atau endpoint
          baru.{" "}
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

      {freshKey && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4" />
              Kunci {freshKey.name} — salin sekarang
            </CardTitle>
            <CardDescription>
              Server hanya menyimpan hash-nya, jadi nilai ini tidak bisa ditampilkan
              lagi. Kalau hilang, cabut kuncinya dan buat yang baru.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-background px-2 py-1 font-mono text-xs">
                {freshKey.plaintext}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(freshKey.plaintext);
                  setNotice("Kunci disalin ke papan klip.");
                }}
              >
                <Copy />
                Salin
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setFreshKey(null)}>
                Sudah disalin
              </Button>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">
              Tampilan di daftar: {maskApiKey(freshKey.plaintext.split("_")[1] ?? "")}
            </p>
          </CardContent>
        </Card>
      )}

      {freshSecret && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <RadioTower className="size-4" />
              Rahasia webhook untuk {freshSecret.url}
            </CardTitle>
            <CardDescription>
              Pakai nilai ini untuk memverifikasi tanda tangan kiriman. Rahasianya
              tidak ditampilkan lagi; kalau hilang, putar (rotate) rahasianya.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <code className="break-all rounded bg-background px-2 py-1 font-mono text-xs">
              {freshSecret.secret}
            </code>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Kunci aktif", value: `${apiKeySummary.active}`, hint: "bisa memanggil API" },
          {
            label: "Kedaluwarsa ≤ 14 hari",
            value: `${apiKeySummary.expiringSoon}`,
            hint: "buat pengganti sebelum mati",
          },
          {
            label: "Endpoint aktif",
            value: `${webhookSummary.activeEndpoints}`,
            hint: `dari ${webhookSummary.endpoints} endpoint`,
          },
          {
            label: "Kiriman bermasalah",
            value: `${webhookSummary.pendingDeliveries + webhookSummary.failedDeliveries}`,
            hint: `${webhookSummary.failedDeliveries} menyerah setelah 5 percobaan`,
          },
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

      {/* --------------------------------- Kendaraan: endpoint /api/v1 ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Endpoint `/api/v1`</CardTitle>
          <CardDescription>
            Kirim kunci di header <code>Authorization: Bearer mp_…</code>. HTTP action
            Convex dilayani di domain <code>&lt;deployment&gt;.convex.site</code>. Baris
            bertanda <strong>tulis</strong> mengubah data tenant, jadi kuncinya perlu scope
            itu secara sadar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/dokumentasi-api">Dokumentasi API publik</Link>
            </Button>
            <span className="text-xs text-muted-foreground">
              Halaman itu bisa dibaca tanpa masuk — bagikan ke tim platform mitra.
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Endpoint</th>
                  <th className="px-2 py-2">Keterangan</th>
                  <th className="px-2 py-2">Scope</th>
                </tr>
              </thead>
              <tbody>
                {API_RESOURCES.map((resource) => (
                  <tr key={resource.resource} className="border-t border-border/60">
                    <td className="px-2 py-2 font-mono text-xs">
                      {resource.method} {resource.path}
                    </td>
                    <td className="px-2 py-2">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {resource.write && (
                          <Badge variant="accent" className="gap-1">
                            <PenLine className="size-3" />
                            tulis
                          </Badge>
                        )}
                        {resource.label}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {resource.scope ? PERMISSION_LABELS[resource.scope] : "cukup kunci sah"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-border/60 bg-secondary/10 p-3 text-xs">
{`curl -H "Authorization: Bearer mp_…" \\
  "https://<deployment>.convex.site/api/v1/sales?days=7&limit=20"`}
          </pre>

          <div className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="accent" className="gap-1">
                <PenLine className="size-3" />
                tulis
              </Badge>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pesanan masuk dari sistem luar
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Produk ditunjuk dengan <code>sku</code>, bukan id internal. Harga, harga
              bertingkat, diskon member, dan PPN dihitung server — karena itu jumlah
              bayar boleh dihilangkan (dianggap “bayar tepat sebesar total”).
              <code> idempotencyKey</code> wajib: kiriman ulang dengan kunci yang sama
              mengembalikan penjualan yang sama (HTTP 200), bukan penjualan kedua;
              kiriman baru dijawab 201.
            </p>
            <pre className="overflow-x-auto rounded-lg border border-border/60 bg-secondary/10 p-3 text-xs">
{`curl -X POST -H "Authorization: Bearer mp_…" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(sampleExternalOrderBody(), null, 2)}' \\
  "https://<deployment>.convex.site/api/v1/sales"`}
            </pre>
            <p className="text-xs text-muted-foreground">
              Contoh di atas: {describeExternalOrder(sampleExternalOrderBody())} — harga
              satuannya diambil dari katalog tenant, bukan dari kiriman ini.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------- Kunci API ------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" />
            Kunci API
          </CardTitle>
          <CardDescription>
            Scope kunci tidak boleh melebihi izin pembuatnya. Kunci buatan anggota yang
            perannya diturunkan (atau dikeluarkan dari tim) langsung berhenti bekerja.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Nama</th>
                  <th className="px-2 py-2">Kunci</th>
                  <th className="px-2 py-2">Scope</th>
                  <th className="px-2 py-2">Dibuat oleh</th>
                  <th className="px-2 py-2">Berlaku s/d</th>
                  <th className="px-2 py-2">Terakhir dipakai</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => (
                  <tr key={key.id} className="border-t border-border/60">
                    <td className="px-2 py-2">{key.name}</td>
                    <td className="px-2 py-2 font-mono text-[11px]">{key.mask}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <span
                            key={scope}
                            className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {PERMISSION_LABELS[scope]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {key.creatorRole ? ROLE_LABELS[key.creatorRole] : "peran tambahan"}
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {key.expiresAt === null ? "tanpa kedaluwarsa" : formatDate(key.expiresAt)}
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {key.lastUsedAt === null ? "belum pernah" : formatDate(key.lastUsedAt)}
                    </td>
                    <td className="px-2 py-2">
                      <Badge
                        variant={
                          key.status === "active"
                            ? "default"
                            : key.status === "expired"
                              ? "accent"
                              : "outline"
                        }
                      >
                        {KEY_STATUS_LABELS[key.status]}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || !canManage || key.status !== "active"}
                        title={
                          key.status === "active"
                            ? "Cabut kunci ini"
                            : "Kunci sudah tidak aktif"
                        }
                        onClick={() =>
                          run(
                            () => revokeApiKey(key.id),
                            `Kunci ${key.name} dicabut.`,
                          )
                        }
                      >
                        Cabut
                      </Button>
                    </td>
                  </tr>
                ))}
                {apiKeys.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-2 py-4 text-center text-sm text-muted-foreground"
                    >
                      Belum ada kunci API untuk workspace ini.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------- Kunci baru ------------ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Kunci API baru</CardTitle>
          <CardDescription>
            Pilih sedikit mungkin scope: kunci “Server produksi” yang hanya membaca
            laporan tidak perlu boleh melihat stok atau hutang.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs text-muted-foreground md:col-span-2">
              Nama kunci
              <Input
                className="mt-1"
                value={keyForm.name}
                disabled={busy || !canManage}
                placeholder="Server produksi"
                onChange={(event) =>
                  setKeyForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Masa berlaku
              <select
                className="mt-1 h-10 w-full rounded-md border border-border/60 bg-background px-2 text-sm disabled:opacity-60"
                value={keyForm.expiresInDays}
                disabled={busy || !canManage}
                aria-label="Masa berlaku kunci"
                onChange={(event) =>
                  setKeyForm((current) => ({
                    ...current,
                    expiresInDays: Number(event.target.value),
                  }))
                }
              >
                {API_KEY_EXPIRY_OPTIONS.map((option) => (
                  <option key={option.days} value={option.days}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Scope
            </div>
            <p className="text-[11px] text-muted-foreground">
              Scope bertanda “tulis” membuka endpoint POST yang mencatat data — berikan
              hanya kepada sistem yang memang membuat pesanan, bukan ke layar pemantau.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {selectableScopes.map((option) => {
                const selected = keyForm.scopes.includes(option.permission);
                return (
                  <button
                    key={option.permission}
                    type="button"
                    aria-pressed={selected}
                    disabled={busy || !canManage}
                    onClick={() => toggleScope(option.permission)}
                    title={
                      option.write
                        ? `${option.endpoint} · menulis data`
                        : option.endpoint
                    }
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60",
                      selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/60 text-muted-foreground hover:border-primary/40",
                    )}
                  >
                    {option.label}
                    {option.write && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide text-accent">
                        <PenLine className="size-2.5" />
                        tulis
                      </span>
                    )}
                  </button>
                );
              })}
              {selectableScopes.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  Tidak ada scope yang bisa Anda berikan — kunci dibatasi izin
                  pembuatnya.
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={busy || !canManage || !keyPreview.ok}
              onClick={() => submitKey()}
            >
              <KeyRound />
              Buat kunci
            </Button>
            <span className="text-xs text-muted-foreground">
              {keyPreview.ok
                ? `${keyPreview.value.scopes.length} scope dipilih · ${activeKeyHint(apiKeySummary.active)}`
                : keyPreview.reason}
            </span>
          </div>

          {!canManage && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="size-3.5" />
              Melihat kunci boleh; membuat &amp; mencabutnya butuh izin `api.manage`.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------- Webhook ------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <RadioTower className="size-4" />
            Webhook keluar
          </CardTitle>
          <CardDescription>
            Kiriman ditandatangani HMAC-SHA256 atas <code>timestamp.body</code> dengan
            header <code>x-mesinpos-signature</code> dan <code>x-mesinpos-attempt</code>
            (percobaan ke berapa). Kiriman yang gagal diulang otomatis oleh pekerja
            terjadwal tiap menit — 1 → 5 → 30 → 120 → 720 menit, lima percobaan, lalu
            berhenti; mematikan endpoint menghentikan sisa percobaannya. Empat event
            dikirim begitu peristiwanya terjadi (penjualan selesai/dibatalkan, stok
            menipis, opname diposting, termasuk pesanan dari sistem luar); dua event
            jatuh tempo (hutang usaha &amp; piutang lewat tempo) belum punya pemicunya.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {webhookEndpoints.map((endpoint) => (
            <div
              key={endpoint.id}
              className="rounded-lg border border-border/60 bg-secondary/10 px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="break-all font-mono text-xs">{endpoint.url}</span>
                    <Badge variant={endpoint.active ? "default" : "outline"}>
                      {endpoint.active ? "aktif" : "nonaktif"}
                    </Badge>
                  </div>
                  {endpoint.description && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {endpoint.description}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    rahasia penanda tangan ····{endpoint.secretLastFour} · diperbarui{" "}
                    {formatDate(endpoint.updatedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !canManage || !endpoint.active}
                    title={
                      endpoint.active
                        ? "Kirim satu payload uji"
                        : "Endpoint sedang nonaktif"
                    }
                    onClick={() =>
                      run(async () => {
                        const result = await testWebhookEndpoint(endpoint.id);
                        if (result.status === "delivered") return;
                        throw new Error(
                          `Kiriman uji ${result.event} belum sampai${
                            result.error ? `: ${result.error}` : "."
                          }`,
                        );
                      }, `Kiriman uji ${endpoint.url} terkirim.`)
                    }
                  >
                    <Send />
                    Kirim uji
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !canManage}
                    onClick={() =>
                      run(
                        () =>
                          updateWebhookEndpoint({
                            endpointId: endpoint.id,
                            active: !endpoint.active,
                          }),
                        endpoint.active
                          ? `Endpoint ${endpoint.url} dinonaktifkan.`
                          : `Endpoint ${endpoint.url} diaktifkan.`,
                      )
                    }
                  >
                    {endpoint.active ? "Nonaktifkan" : "Aktifkan"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !canManage}
                    title="Putar rahasia penanda tangan"
                    onClick={() =>
                      run(async () => {
                        const result = await updateWebhookEndpoint({
                          endpointId: endpoint.id,
                          rotateSecret: true,
                        });
                        if (result.secret) {
                          setFreshSecret({ url: endpoint.url, secret: result.secret });
                        }
                      }, `Rahasia webhook ${endpoint.url} diputar.`)
                    }
                  >
                    <RefreshCw />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !canManage}
                    title="Hapus endpoint beserta riwayat kirimannya"
                    onClick={() =>
                      run(
                        () => removeWebhookEndpoint(endpoint.id),
                        `Endpoint ${endpoint.url} dihapus.`,
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {endpoint.events.map((event) => (
                  <span
                    key={event}
                    className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {WEBHOOK_EVENTS.find((row) => row.key === event)?.label ?? event}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {webhookEndpoints.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Belum ada endpoint webhook. Tanpa endpoint, tidak ada satu pun peristiwa
              yang dikirim ke sistem lain.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Endpoint webhook baru</CardTitle>
          <CardDescription>
            URL wajib HTTPS dan host publik — webhook ke <code>http://</code> atau ke
            alamat jaringan dalam akan membocorkan data penjualan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs text-muted-foreground md:col-span-2">
              URL endpoint
              <Input
                className="mt-1"
                value={endpointForm.url}
                disabled={busy || !canManage}
                placeholder="https://sistem-anda.example.com/hooks/mesinpos"
                onChange={(event) =>
                  setEndpointForm((current) => ({ ...current, url: event.target.value }))
                }
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Keterangan (opsional)
              <Input
                className="mt-1"
                value={endpointForm.description}
                disabled={busy || !canManage}
                placeholder="Gudang pusat"
                onChange={(event) =>
                  setEndpointForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Event yang dikirim
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {WEBHOOK_EVENTS.map((event) => {
                const selected = endpointForm.events.includes(event.key);
                return (
                  <button
                    key={event.key}
                    type="button"
                    aria-pressed={selected}
                    disabled={busy || !canManage}
                    onClick={() => toggleEvent(event.key)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60",
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border/60 hover:border-primary/40",
                    )}
                  >
                    <div className="text-xs font-semibold">{event.label}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {event.description}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {event.key}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={busy || !canManage || !endpointPreview.ok}
              onClick={() => submitEndpoint()}
            >
              <RadioTower />
              Daftarkan endpoint
            </Button>
            <span className="text-xs text-muted-foreground">
              {endpointPreview.ok
                ? `${sanitizeWebhookEvents(endpointPreview.value.events).length} event dipilih.`
                : endpointPreview.reason}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------- Riwayat kiriman ------ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Riwayat kiriman</CardTitle>
          <CardDescription>
            Hanya 20 kiriman terakhir. Kiriman yang belum berhasil menampilkan jadwal
            percobaan berikutnya dan dikirim ulang otomatis oleh pekerja terjadwal
            begitu jadwalnya lewat; setelah percobaan kelima statusnya menjadi
            “menyerah”.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Waktu</th>
                  <th className="px-2 py-2">Event</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2 text-right">Percobaan</th>
                  <th className="px-2 py-2">Percobaan berikutnya</th>
                  <th className="px-2 py-2">Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {webhookDeliveries.map((delivery) => (
                  <tr key={delivery.id} className="border-t border-border/60">
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {formatDate(delivery.createdAt)}
                    </td>
                    <td className="px-2 py-2 font-mono text-[11px]">{delivery.event}</td>
                    <td className="px-2 py-2">
                      <Badge
                        variant={
                          delivery.status === "delivered"
                            ? "default"
                            : delivery.status === "failed"
                              ? "accent"
                              : "outline"
                        }
                      >
                        {DELIVERY_STATUS_LABELS[delivery.status]}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-xs">
                      {delivery.attempts}
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {delivery.nextAttemptAt === null
                        ? "—"
                        : formatDate(delivery.nextAttemptAt)}
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground">
                      {delivery.lastError ??
                        (delivery.lastStatusCode
                          ? `Penerima menjawab ${delivery.lastStatusCode}.`
                          : "—")}
                    </td>
                  </tr>
                ))}
                {webhookDeliveries.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-2 py-4 text-center text-sm text-muted-foreground"
                    >
                      Belum ada kiriman tercatat.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            Skema tanda tangan untuk sisi penerima:{" "}
            <code>sha256=&lt;hmac(rahasia, `timestamp.body`)&gt;</code> pada header{" "}
            <code>x-mesinpos-signature</code>, dengan{" "}
            <code>x-mesinpos-timestamp</code> ditolak bila selisihnya lebih dari 5 menit.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

const KEY_STATUS_LABELS: Record<string, string> = {
  active: "aktif",
  revoked: "dicabut",
  expired: "kedaluwarsa",
  disabled: "nonaktif",
};

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  delivered: "terkirim",
  pending: "menunggu",
  failed: "menyerah",
};

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Kalimat kecil di samping tombol “Buat kunci”. */
function activeKeyHint(active: number): string {
  return active === 0 ? "belum ada kunci aktif" : `${active} kunci aktif sekarang`;
}

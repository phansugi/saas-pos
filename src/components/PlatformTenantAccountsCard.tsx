/**
 * Backstage: kartu **akun bisnis** (`/platform`) — lihat, ubah, nonaktifkan/
 * aktifkan, dan hapus.
 *
 * Hanya akun platform yang sudah lolos gerbang server (`platform.me`) yang sampai
 * ke sini; komponen ini tidak memutuskan siapa yang boleh masuk, dan setiap aksi
 * dikirim apa adanya ke mutation yang memeriksa ulang penandanya
 * (`requirePlatformDeveloper`).
 *
 * Empat keputusan yang terlihat di sini:
 *
 * 1. **Mengubah hanya nama & paket.** Slug dipakai untuk masuk dan alamat, dan isi
 *    operasional (produk, harga, anggota) milik pemilik bisnis — pengelola
 *    platform tidak menyentuhnya. Turun paket memakai aturan modul yang sama
 *    dengan halaman Langganan, jadi modul di luar paket baru ikut mati.
 * 2. **Menonaktifkan bukan menghapus.** Akun yang dinonaktifkan tetap terlihat
 *    beserta seluruh isinya, tetapi transaksi baru berhenti dan bisa dinyalakan
 *    lagi kapan saja — status langganannya tidak ikut diubah.
 * 3. **Menghapus butuh nama singkat yang diketik.** Satu klik konfirmasi terlalu
 *    murah untuk tindakan yang tidak punya tombol urungkan; yang harus diketik
 *    adalah `slug` bisnis itu, dan tombol hapusnya mati sampai ketikannya sama
 *    (aturan yang sama diperiksa server, bukan hanya halaman).
 * 4. **Jejaknya terlihat di kartu yang sama.** Daftar tindakan di bawah memuat
 *    siapa yang mengubah/menonaktifkan/menghapus apa dan kapan — termasuk akun
 *    yang sudah tidak ada, karena log ini milik platform, bukan tenant.
 */
import { Component, useEffect, useState, type ReactNode } from "react";
import { useConvex, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Ban,
  CheckCircle2,
  History,
  Pencil,
  Search,
  ShieldOff,
  Trash2,
  Users,
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
import { ErrorNotice } from "@/components/ErrorNotice";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  PLATFORM_NOTE_MAX,
  slugConfirmationMatches,
  TENANT_ACCOUNT_LIMIT,
  TENANT_SEARCH_SCAN,
} from "@/convex/lib/platformTenants";
import { PLAN_LIST, type PlanKey } from "@/lib/billing";
import { PROFILE_NAME_MAX, PROFILE_NAME_MIN } from "@/lib/profile";
import { cn } from "@/lib/utils";

type Accounts = FunctionReturnType<typeof api.platform.tenantAccounts>;

/** Jeda sebelum kata kunci dikirim ke server (lihat `searchQuery` di bawah). */
const SEARCH_DEBOUNCE_MS = 300;
type AccountRow = Accounts["rows"][number];
type History = FunctionReturnType<typeof api.platform.platformActions>;
type HistoryRow = History["rows"][number];

function formatMoment(ms: number): string {
  return new Date(ms).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Nama paket dari katalog; paket yang tidak dikenal ditampilkan apa adanya. */
function planLabel(planKey: string): string {
  return PLAN_LIST.find((plan) => plan.key === planKey)?.name ?? planKey;
}

/**
 * Pembatas error **kartu**, bukan halaman.
 *
 * `useQuery` melempar saat querynya ditolak (mis. identitas platform dicabut saat
 * halaman masih terbuka, atau fungsi ini belum ter-push ke deployment). Tanpa
 * pembatas, satu penolakan seperti itu melepas seluruh pohon backstage dan yang
 * tersisa hanya halaman putih — persis keluhan “kartunya tidak muncul”. Di sini
 * penolakannya tampil sebagai kalimat di tempat kartunya, dan kartu lain tetap
 * hidup.
 */
class CardBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message || String(error) };
  }

  componentDidCatch(error: Error) {
    console.error("Kartu akun bisnis gagal dimuat:", error);
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <Card data-testid="platform-akun-gagal">
        <CardHeader>
          <CardTitle className="text-base">2. Akun bisnis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ErrorNotice
            error={this.state.error}
            testId="platform-akun-gagal-pesan"
            title="Daftar akun bisnis tidak bisa dibaca"
          />
          <p className="text-muted-foreground">
            Penyebab paling sering: identitas login platform sudah tidak berlaku lagi. Masuk
            ulang lewat <strong>Kirim kode</strong> di kartu identitas paling atas, lalu buka
            halaman ini lagi.
          </p>
        </CardContent>
      </Card>
    );
  }
}

export function PlatformTenantAccountsCard({
  actorId,
}: {
  actorId: Id<"users">;
}) {
  return (
    <CardBoundary>
      <TenantAccountsBody actorId={actorId} />
    </CardBoundary>
  );
}

function TenantAccountsBody({ actorId }: { actorId: Id<"users"> }) {
  const convex = useConvex();
  const [search, setSearch] = useState("");
  /**
   * Kata kunci yang **dikirim ke server**, menunggu ketikan berhenti sebentar.
   *
   * Sejak pencarian menyapu seluruh akun (bukan hanya 100 baris yang tampil),
   * menembakkannya tiap ketukan berarti membaca ribuan baris berkali-kali untuk
   * satu kata. Kolomnya tetap responsif karena yang ditahan hanya bagian servernya.
   */
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const accounts = useQuery(api.platform.tenantAccounts, {
    actorId,
    search: searchQuery,
  });
  const history = useQuery(api.platform.platformActions, { actorId });

  const [busy, setBusy] = useState<string | null>(null);
  /** Galat terakhir dari server — disimpan utuh supaya detail teknisnya bisa dibuka. */
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Baris yang sedang dikonfirmasi tindakannya + isi ketikannya. */
  const [confirming, setConfirming] = useState<
    { id: string; action: "suspend" | "activate" | "delete"; typed: string; note: string } | null
  >(null);
  /** Baris yang sedang diubah (nama & paket) + isi formulirnya. */
  const [editing, setEditing] = useState<
    { id: string; name: string; planKey: string; note: string } | null
  >(null);

  function openEdit(row: AccountRow) {
    setEditing({ id: row.id, name: row.name, planKey: row.planKey, note: "" });
    setConfirming(null);
    setError(null);
    setNotice(null);
  }

  async function saveEdit(row: AccountRow) {
    if (!editing || editing.id !== row.id) return;
    setBusy(row.id);
    setError(null);
    setNotice(null);
    try {
      const result = await convex.mutation(api.platform.updateTenant, {
        actorId,
        tenantId: row.id as Id<"tenants">,
        name: editing.name,
        planKey: editing.planKey as PlanKey,
        note: editing.note,
      });
      setNotice(result.summary);
      setEditing(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  }

  function openConfirm(row: AccountRow, action: "suspend" | "activate" | "delete") {
    setConfirming({ id: row.id, action, typed: "", note: "" });
    // Dua panel terbuka sekaligus di satu baris membingungkan: panel lain ditutup.
    setEditing(null);
    setError(null);
    setNotice(null);
  }

  async function run(row: AccountRow, action: "suspend" | "activate" | "delete") {
    if (!confirming || confirming.id !== row.id) return;
    setBusy(row.id);
    setError(null);
    setNotice(null);
    try {
      if (action === "delete") {
        const result = await convex.mutation(api.platform.deleteTenant, {
          actorId,
          tenantId: row.id as Id<"tenants">,
          confirmSlug: confirming.typed,
          note: confirming.note,
        });
        setNotice(result.summary);
      } else {
        const result = await convex.mutation(api.platform.setTenantSuspended, {
          actorId,
          tenantId: row.id as Id<"tenants">,
          suspended: action === "suspend",
          note: confirming.note,
        });
        setNotice(result.summary);
      }
      setConfirming(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  }

  const summary = accounts?.summary ?? { total: 0, active: 0, suspended: 0, deleting: 0 };

  return (
    <Card data-testid="platform-akun">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4" />
          2. Akun bisnis
        </CardTitle>
        <CardDescription>
          Daftar workspace yang berdiri di deployment ini. Mengubah hanya menyentuh nama
          dan paket; menonaktifkan menghentikan transaksi baru tanpa menghapus apa pun;
          menghapus menyapu seluruh isi akun bisnis itu dan{" "}
          <strong>tidak bisa diurungkan</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{summary.total} akun terbaca</Badge>
          <Badge variant="outline">{summary.active} aktif</Badge>
          <Badge variant={summary.suspended > 0 ? "accent" : "outline"}>
            {summary.suspended} nonaktif
          </Badge>
          {summary.deleting > 0 && (
            <Badge variant="accent">{summary.deleting} sedang dihapus</Badge>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="plat-akun-cari" className="flex items-center gap-2">
            <Search className="size-3.5" /> Cari akun bisnis
          </Label>
          <Input
            id="plat-akun-cari"
            data-testid="platform-akun-cari"
            value={search}
            placeholder="nama, slug, email pemilik, atau paket"
            onChange={(event) => setSearch(event.target.value)}
          />
          {/*
            Cakupan pencarian ditulis apa adanya: dulu kotak ini hanya menyaring akun
            yang kebetulan sudah tampil, sehingga bisnis lama dijawab “tidak ada yang
            cocok” padahal akunnya ada. Sekarang pencariannya menyapu seluruh
            deployment, dan kalau batas penyapuan yang menghentikannya, itu ikut
            disebut — lengkap dengan berapa akun yang benar-benar diperiksa.
          */}
          <p data-testid="platform-akun-cakupan" className="text-xs text-muted-foreground">
            {search.trim()
              ? accounts === undefined
                ? "Memeriksa seluruh akun — bukan hanya yang tampil…"
                : accounts.scanCapped
                  ? `Diperiksa ${accounts.scanned} akun terbaru — masih ada akun lain di luar batas ${TENANT_SEARCH_SCAN} yang belum diperiksa, jadi persempit kata kuncinya kalau belum ketemu.`
                  : `Diperiksa ${accounts.scanned} akun (seluruh deployment), ${accounts.rows.length} di antaranya cocok.`
              : `Pencarian memeriksa seluruh akun, bukan hanya ${accounts?.limit ?? TENANT_ACCOUNT_LIMIT} yang tampil di daftar.`}
          </p>
        </div>

        <ErrorNotice
          error={error}
          testId="platform-akun-error"
          hint="Periksa pesannya, lalu ulangi tindakan setelah sebabnya dibereskan. Akun bisnis tidak berubah selama permintaan ditolak."
        />
        {notice && (
          <p
            data-testid="platform-akun-notice"
            className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary"
          >
            {notice}
          </p>
        )}

        <div className="space-y-2">
          {accounts === undefined && (
            <p className="text-sm text-muted-foreground">Membaca daftar akun…</p>
          )}
          {accounts?.rows.length === 0 && (
            <p data-testid="platform-akun-kosong" className="text-sm text-muted-foreground">
              {accounts.search
                ? accounts.scanCapped
                  ? `Belum ketemu dalam ${accounts.scanned} akun terbaru yang diperiksa (batasnya ${TENANT_SEARCH_SCAN}). Masih ada akun yang belum diperiksa — coba kata kunci lain atau buka halaman ini lagi nanti.`
                  : `Tidak ada akun yang cocok dengan pencarian itu — seluruh ${accounts.scanned} akun di deployment ini sudah diperiksa, bukan hanya yang tampil di daftar.`
                : accounts.summary.total === 0
                  ? "Belum ada akun bisnis di deployment ini."
                  : "Belum ada akun yang bisa ditampilkan."}
            </p>
          )}

          {(accounts?.rows ?? []).map((row) => {
            const open = confirming?.id === row.id;
            const nonaktif = row.accountStatus === "nonaktif";
            const kenapaDikunci = row.deleting
              ? "Akun ini sedang dihapus; statusnya tidak bisa diubah lagi."
              : null;
            const bolehHapus = !row.deleting;

            return (
              <div
                key={row.id}
                data-testid={`platform-akun-${row.slug}`}
                className={cn(
                  "rounded-lg border p-3 text-sm",
                  nonaktif ? "border-accent/40 bg-accent/5" : "border-border",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{row.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {row.slug}
                      </span>
                      <Badge
                        data-testid={`platform-akun-status-${row.slug}`}
                        variant={nonaktif ? "accent" : "secondary"}
                      >
                        {row.deleting ? "sedang dihapus" : nonaktif ? "nonaktif" : "aktif"}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {row.ownerName}
                      {row.ownerEmail ? ` · ${row.ownerEmail}` : ""} · paket {row.planKey} ·
                      langganan {row.status}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {row.members} anggota (aktif {row.activeMembers}) · {row.stores} toko ·{" "}
                      {row.products} produk · dibuat {formatMoment(row.createdAt)}
                    </div>
                    {row.suspendedAt !== null && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Dinonaktifkan {row.suspendLabel ?? formatMoment(row.suspendedAt)}
                        {row.suspendedNote ? ` — ${row.suspendedNote}` : ""}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`platform-akun-edit-${row.slug}`}
                      disabled={busy !== null || row.deleting}
                      title={kenapaDikunci ?? undefined}
                      onClick={() => openEdit(row)}
                    >
                      <Pencil className="size-4" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant={nonaktif ? "default" : "outline"}
                      data-testid={`platform-akun-${nonaktif ? "aktifkan" : "nonaktifkan"}-${row.slug}`}
                      disabled={busy !== null || row.deleting}
                      title={kenapaDikunci ?? undefined}
                      onClick={() => openConfirm(row, nonaktif ? "activate" : "suspend")}
                    >
                      {nonaktif ? (
                        <>
                          <CheckCircle2 className="size-4" /> Aktifkan
                        </>
                      ) : (
                        <>
                          <Ban className="size-4" /> Nonaktifkan
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`platform-akun-hapus-${row.slug}`}
                      disabled={busy !== null || !bolehHapus}
                      title={kenapaDikunci ?? undefined}
                      onClick={() => openConfirm(row, "delete")}
                      className="text-destructive"
                    >
                      <Trash2 className="size-4" /> Hapus
                    </Button>
                  </div>
                </div>

                {editing?.id === row.id && (
                  <form
                    data-testid={`platform-akun-form-${row.slug}`}
                    className="mt-3 space-y-3 rounded-md border border-border bg-background p-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveEdit(row);
                    }}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor={`plat-akun-nama-${row.slug}`} className="text-xs">
                          Nama bisnis
                        </Label>
                        <Input
                          id={`plat-akun-nama-${row.slug}`}
                          data-testid={`platform-akun-nama-${row.slug}`}
                          value={editing.name}
                          minLength={PROFILE_NAME_MIN}
                          maxLength={PROFILE_NAME_MAX}
                          onChange={(event) =>
                            setEditing((current) =>
                              current ? { ...current, name: event.target.value } : current,
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`plat-akun-paket-${row.slug}`} className="text-xs">
                          Paket langganan
                        </Label>
                        <select
                          id={`plat-akun-paket-${row.slug}`}
                          data-testid={`platform-akun-paket-${row.slug}`}
                          value={editing.planKey}
                          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                          onChange={(event) =>
                            setEditing((current) =>
                              current ? { ...current, planKey: event.target.value } : current,
                            )
                          }
                        >
                          {PLAN_LIST.map((plan) => (
                            <option key={plan.key} value={plan.key}>
                              {plan.name} · {plan.subtitle}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Nama singkat <span className="font-mono">{row.slug}</span> tidak
                      berubah. Pindah paket ikut mematikan modul yang tidak ada di paket
                      barunya, dan status langganan tidak disentuh. Paket sekarang:{" "}
                      {planLabel(row.planKey)}.
                    </p>
                    <div className="space-y-1">
                      <Label
                        htmlFor={`plat-akun-edit-catatan-${row.slug}`}
                        className="text-xs"
                      >
                        Catatan (opsional, {PLATFORM_NOTE_MAX} karakter)
                      </Label>
                      <Input
                        id={`plat-akun-edit-catatan-${row.slug}`}
                        data-testid={`platform-akun-edit-catatan-${row.slug}`}
                        value={editing.note}
                        maxLength={PLATFORM_NOTE_MAX}
                        placeholder="mis. permintaan pemilik via WhatsApp"
                        onChange={(event) =>
                          setEditing((current) =>
                            current ? { ...current, note: event.target.value } : current,
                          )
                        }
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        type="submit"
                        data-testid={`platform-akun-simpan-${row.slug}`}
                        disabled={
                          busy !== null ||
                          editing.name.trim().length < PROFILE_NAME_MIN
                        }
                      >
                        {busy === row.id ? "Menyimpan…" : "Simpan perubahan"}
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant="ghost"
                        onClick={() => setEditing(null)}
                        disabled={busy !== null}
                      >
                        Batal
                      </Button>
                    </div>
                  </form>
                )}

                {open && confirming && (
                  <div className="mt-3 space-y-3 rounded-md border border-border bg-background p-3">
                    <p className="text-xs text-muted-foreground">
                      {confirming.action === "delete"
                        ? `Menghapus ${row.name} menyapu seluruh isinya (anggota, produk, penjualan, stok, dokumen pembelian, kunci API) dan tidak bisa diurungkan. Penggunanya tidak ikut terhapus — hanya keanggotaannya di bisnis ini.`
                        : confirming.action === "suspend"
                          ? `Menonaktifkan ${row.name} menghentikan transaksi baru. Datanya tetap utuh, dan akun bisa diaktifkan kembali kapan saja.`
                          : `Mengaktifkan ${row.name} memulihkan transaksi baru tanpa mengubah status langganannya.`}
                    </p>
                    <div className="space-y-1">
                      <Label
                        htmlFor={`plat-akun-catatan-${row.slug}`}
                        className="text-xs"
                      >
                        Catatan (opsional, {PLATFORM_NOTE_MAX} karakter)
                      </Label>
                      <Input
                        id={`plat-akun-catatan-${row.slug}`}
                        data-testid={`platform-akun-catatan-${row.slug}`}
                        value={confirming.note}
                        maxLength={PLATFORM_NOTE_MAX}
                        placeholder="mis. laporan penyalahgunaan #118"
                        onChange={(event) =>
                          setConfirming((current) =>
                            current ? { ...current, note: event.target.value } : current,
                          )
                        }
                      />
                    </div>
                    {confirming.action === "delete" && (
                      <div className="space-y-1">
                        <Label
                          htmlFor={`plat-akun-konfirmasi-${row.slug}`}
                          className="text-xs"
                        >
                          Ketik <span className="font-mono">{row.slug}</span> untuk
                          mengonfirmasi
                        </Label>
                        <Input
                          id={`plat-akun-konfirmasi-${row.slug}`}
                          data-testid={`platform-akun-konfirmasi-${row.slug}`}
                          value={confirming.typed}
                          placeholder={row.slug}
                          onChange={(event) =>
                            setConfirming((current) =>
                              current ? { ...current, typed: event.target.value } : current,
                            )
                          }
                        />
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant={confirming.action === "delete" ? "secondary" : "default"}
                        className={
                          confirming.action === "delete" ? "text-destructive" : undefined
                        }
                        data-testid={`platform-akun-lanjut-${row.slug}`}
                        disabled={
                          busy !== null ||
                          (confirming.action === "delete" &&
                            !slugConfirmationMatches({
                              typed: confirming.typed,
                              slug: row.slug,
                            }))
                        }
                        onClick={() => void run(row, confirming.action)}
                      >
                        {busy === row.id
                          ? "Memproses…"
                          : confirming.action === "delete"
                            ? "Hapus permanen"
                            : confirming.action === "suspend"
                              ? "Nonaktifkan akun"
                              : "Aktifkan akun"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirming(null)}
                        disabled={busy !== null}
                      >
                        Batal
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {accounts?.truncated && (
          <p data-testid="platform-akun-dipotong" className="text-xs text-muted-foreground">
            {accounts.search
              ? `Hasil pencarian ditampilkan maksimum ${accounts.limit} akun; masih ada akun lain yang cocok — persempit kata kuncinya.`
              : `Daftar menampilkan ${accounts.limit} akun terbaru dari ${accounts.scanned} yang dibaca. Untuk akun lain, pakai kotak pencarian di atas — pencariannya memeriksa seluruh akun, bukan hanya yang tampil di sini.`}
          </p>
        )}
        {accounts?.countsCapped && (
          <p className="text-xs text-muted-foreground">
            Angka anggota/toko/produk dihitung dari sampel 50 baris per akun.
          </p>
        )}

        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <History className="size-3.5" /> Tindakan pengelola terakhir
          </div>
          {(history?.rows ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Belum ada tindakan. Mengubah, menonaktifkan, mengaktifkan, dan menghapus akan
              tercatat di sini.
            </p>
          )}
          {(history?.rows ?? []).map((row: HistoryRow) => (
            <div
              key={row.id}
              data-testid="platform-akun-riwayat"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-secondary/30 px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <span className="font-medium text-foreground">{row.actionLabel}</span>{" "}
                <span className="font-mono">{row.tenantSlug}</span>
                {row.detail ? ` — ${row.detail}` : ""}
                {row.note ? ` (${row.note})` : ""}
                <div className="text-muted-foreground">
                  {row.actorEmail} · {formatMoment(row.at)}
                </div>
              </div>
              <Badge
                variant={row.action === "delete" ? "accent" : "outline"}
                className="shrink-0 gap-1"
              >
                {row.action === "delete" ? (
                  <ShieldOff className="size-3" />
                ) : row.action === "suspend" ? (
                  <Ban className="size-3" />
                ) : row.action === "update" ? (
                  <Pencil className="size-3" />
                ) : (
                  <CheckCircle2 className="size-3" />
                )}
                {row.tenantName}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

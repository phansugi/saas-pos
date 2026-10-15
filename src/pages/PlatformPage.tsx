/**
 * Backstage platform (`/platform`) — permukaan **di luar RBAC tenant**.
 *
 * Halaman ini rumah bagi akun platform (lihat `lib/platform.ts` &
 * `lib/impersonation.ts`) dan sengaja hidup di luar `/app`: akun platform tidak
 * punya keanggotaan di tenant orang lain, jadi `RequireTenant` tidak berlaku
 * untuknya. Karena itu pula halaman ini **tidak punya tautan di menu mana pun** —
 * keberadaan akun platform tidak boleh bisa ditemukan dari dalam tenant, jadi
 * satu-satunya jalan masuk adalah alamatnya langsung.
 *
 * Workspace miliknya sendiri tetap dibuka lewat `/app` seperti pemilik biasa —
 * tautannya ada di halaman ini, di baris “Workspace saya”; yang mendampingi tenant
 * orang lain dan yang bekerja di rumah sendiri memang dua hal berbeda.
 *
 * Tiga hal yang membedakannya dari halaman tenant biasa:
 *
 * 1. **Terang-terangan bisa gagal.** Semua panggilan ke server dilakukan di dalam
 *    penangan kejadian dengan `try/catch`, bukan lewat hook query. Penolakan
 *    server (mis. “akun platform menuntut identitas login yang terverifikasi”)
 *    ditampilkan sebagai pesan, bukan menjatuhkan halaman.
 * 2. **Membaca, bukan mengubah.** Sesi pendampingan hanya membuka ringkasan
 *    bantuan. Tidak ada tombol yang menulis data tenant, karena akun platform
 *    memang tidak punya izin tulis di dalam tenant.
 * 3. **Jejaknya disebut di muka.** Setiap langkah sesi ini menulis baris audit ke
 *    tenant yang dibantu, jadi halaman ini juga menjelaskan apa yang akan dilihat
 *    tenant, bukan hanya apa yang dilihat pengembang.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useConvex, useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import type { FunctionReturnType } from "convex/server";
import { LifeBuoy, Lock, RefreshCw, ShieldAlert, ShieldCheck, Square, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  IMPERSONATION_DEFAULT_MINUTES,
  IMPERSONATION_MAX_MINUTES,
  IMPERSONATION_REASON_MAX,
  validateImpersonationReason,
} from "@/lib/impersonation";
import { AUTH_EMAIL_PROVIDER_ID } from "@/lib/otp";
import { useSession } from "@/lib/session";
import { dataSource } from "@/lib/store";
import { cn } from "@/lib/utils";

type BackstageMe = FunctionReturnType<typeof api.platform.me>;
type Directory = FunctionReturnType<typeof api.platform.tenantDirectory>;
type MySessions = FunctionReturnType<typeof api.platform.myImpersonations>;
type Help = FunctionReturnType<typeof api.platform.helpTenant>;
type SessionRow = MySessions["sessions"][number];

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Pesan Convex tiba sebagai "...\nUncaught ConvexError: <pesan>"; ambil bagian
  // yang benar-benar ditulis server supaya yang dibaca operator pesannya.
  const marker = raw.lastIndexOf("ConvexError: ");
  return (marker >= 0 ? raw.slice(marker + "ConvexError: ".length) : raw).trim();
}

function formatMoment(ms: number): string {
  return new Date(ms).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatRemaining(ms: number): string {
  const menit = Math.max(0, Math.round(ms / 60_000));
  if (menit < 60) return `${menit} menit lagi`;
  const jam = Math.floor(menit / 60);
  return `${jam} jam ${menit % 60} menit lagi`;
}

const MINUTE_OPTIONS = [30, IMPERSONATION_DEFAULT_MINUTES, IMPERSONATION_MAX_MINUTES];

export function PlatformPage() {
  if (dataSource !== "convex") return <PlatformShell><LockedNotice /></PlatformShell>;
  return <PlatformBackstage />;
}

function PlatformShell({ children }: { children: ReactNode }) {
  // Sesi perangkat ini dipakai untuk menunjukkan **workspace sendiri**: akun
  // platform boleh punya satu, dan dashboard-nya hidup di `/app` — bukan di sini.
  // Kalau perangkat ini belum punya tenant, tautannya mengarah ke onboarding,
  // bukan ke `/app` yang akan melempar balik ke sana.
  const { session } = useSession();
  const tenant = session?.tenant ?? null;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
        <header className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ShieldAlert className="size-4" />
            Di luar RBAC tenant
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Backstage platform</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Rumah akun platform: pendampingan tenant dibuka dari sini. Akun platform tidak
            punya keanggotaan di tenant orang lain — bantuannya berupa <em>sesi</em> beralasan
            dan berbatas waktu yang <strong>selalu ditulis ke jejak audit tenant</strong>,
            bukan izin diam-diam yang membuatnya tampak seperti anggota biasa. Workspace
            miliknya sendiri tetap bisa ia pakai sebagai pemilik.
          </p>
          <div
            data-testid="platform-workspace"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-secondary/20 px-4 py-3 text-sm"
          >
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Workspace saya
              </div>
              <div className="mt-0.5 truncate">
                {tenant
                  ? `${tenant.name} · ${tenant.storeName}`
                  : "Belum ada workspace di perangkat ini"}
              </div>
            </div>
            <Link
              to={tenant ? "/app" : "/auth?returnTo=/onboarding"}
              className="shrink-0 font-medium text-primary hover:underline"
            >
              {tenant ? "Buka dashboard →" : "Buat workspace →"}
            </Link>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

function LockedNotice() {
  return (
    <Card data-testid="platform-locked">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="size-4 text-muted-foreground" />
          Backstage butuh Convex dan identitas terverifikasi
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          Aplikasi ini sedang berjalan dengan data demo, jadi tidak ada deployment yang bisa
          memeriksa akun platform. Backstage baru hidup setelah dua hal terpasang:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <code className="font-mono text-xs">VITE_CONVEX_URL</code> +{" "}
            <code className="font-mono text-xs">VITE_DATA_SOURCE=convex</code>
          </li>
          <li>
            provider autentikasi, supaya <code className="font-mono text-xs">platform.me</code>{" "}
            bisa mencocokkan identitas login dengan akun platform
          </li>
        </ul>
        <p>
          Ini disengaja: gerbang akun platform memang lebih ketat daripada gerbang tenant, dan
          tanpa identitas terverifikasi ia tidak boleh dibuka siapa pun.
        </p>
      </CardContent>
    </Card>
  );
}

function PlatformBackstage() {
  const convex = useConvex();
  const { session } = useSession();

  const [actorId, setActorId] = useState<Id<"users"> | null>(null);
  const [me, setMe] = useState<BackstageMe | null>(null);
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [sessions, setSessions] = useState<MySessions | null>(null);
  const [help, setHelp] = useState<Help | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [filter, setFilter] = useState("");
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(IMPERSONATION_DEFAULT_MINUTES);

  /*
    Identitas Convex Auth: langkah terpisah dari sesi aplikasi, dan memang harus
    terpisah — sesi aplikasi dibuktikan ke server lewat kode OTP biasa, sedangkan
    gerbang akun platform menuntut token yang diterbitkan server itu sendiri.
  */
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const [authEmail, setAuthEmail] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [authSent, setAuthSent] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  /** Email yang dipakai: yang diketik pengembang, kalau tidak ada berarti email sesi. */
  const emailValue = authEmail || session?.user.email || "";

  const reasonError = validateImpersonationReason(reason);

  const refresh = useCallback(
    async (id: Id<"users">) => {
      const [dir, mine] = await Promise.all([
        convex.query(api.platform.tenantDirectory, { actorId: id }),
        convex.query(api.platform.myImpersonations, { actorId: id }),
      ]);
      setDirectory(dir);
      setSessions(mine);
      setTenantId((current) => current || dir.tenants[0]?.id || "");
    },
    [convex],
  );

  /** Membuka backstage: resolusi aktor, lalu pemeriksaan akun platform oleh server. */
  const open = useCallback(async () => {
    const email = session?.user.email;
    if (!email) return;
    setBusy(true);
    setDenied(null);
    setNotice(null);
    try {
      const { userId } = await convex.mutation(api.users.createOrGet, {
        email,
        name: session?.user.name ?? email.split("@")[0] ?? "Pengembang",
      });
      const id = userId as Id<"users">;
      const profile = await convex.query(api.platform.me, { userId: id });
      setActorId(id);
      setMe(profile);
      await refresh(id);
    } catch (error) {
      setDenied(errorText(error));
      setMe(null);
      setDirectory(null);
      setSessions(null);
    } finally {
      setBusy(false);
    }
  }, [convex, refresh, session]);

  /** Mengirim kode Convex Auth — kode itu yang menerbitkan identitas terverifikasi. */
  const sendAuthCode = useCallback(async () => {
    const email = emailValue.trim();
    if (!email) return;
    setAuthBusy(true);
    setAuthNotice(null);
    try {
      await signIn(AUTH_EMAIL_PROVIDER_ID, { email });
      setAuthSent(true);
      setAuthNotice(`Kode dikirim ke ${email}. Kode ini juga yang membuat identitas Anda terverifikasi di server.`);
    } catch (error) {
      setAuthNotice(`Gagal mengirim kode: ${errorText(error)}`);
    } finally {
      setAuthBusy(false);
    }
  }, [emailValue, signIn]);

  const verifyAuthCode = useCallback(async () => {
    const email = emailValue.trim();
    const code = authCode.trim();
    if (!email || !code) return;
    setAuthBusy(true);
    setAuthNotice(null);
    try {
      await signIn(AUTH_EMAIL_PROVIDER_ID, { email, code });
      setAuthCode("");
      setAuthSent(false);
      setAuthNotice("Identitas terverifikasi. Backstage dibuka atas nama akun ini.");
    } catch (error) {
      setAuthNotice(`Kode tidak diterima: ${errorText(error)}`);
    } finally {
      setAuthBusy(false);
    }
  }, [authCode, emailValue, signIn]);

  /**
   * Begitu identitasnya terverifikasi, backstage dibuka sendiri: menekan tombol
   * tambahan tidak menambah keamanan apa pun — gerbangnya tetap di server.
   * Penandanya direset saat keluar supaya masuk lagi tetap otomatis membuka.
   */
  const openedByAuth = useRef(false);
  useEffect(() => {
    if (!isAuthenticated) {
      openedByAuth.current = false;
      return;
    }
    if (openedByAuth.current) return;
    openedByAuth.current = true;
    void open();
  }, [isAuthenticated, open]);

  const start = useCallback(async () => {
    if (!actorId || !tenantId) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await convex.mutation(api.platform.impersonate, {
        actorId,
        tenantId: tenantId as Id<"tenants">,
        reason,
        minutes,
      });
      setReason("");
      setHelp(null);
      setNotice(result.summary);
      await refresh(actorId);
    } catch (error) {
      setNotice(`Gagal membuka sesi: ${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  }, [actorId, convex, minutes, reason, refresh, tenantId]);

  const readHelp = useCallback(
    async (sessionId: string) => {
      if (!actorId) return;
      setBusy(true);
      try {
        const snapshot = await convex.mutation(api.platform.helpTenant, {
          actorId,
          sessionId: sessionId as Id<"impersonationSessions">,
        });
        setHelp(snapshot);
        setNotice(`Ringkasan dibaca — tercatat sebagai baca ke-${snapshot.helpCount}.`);
        await refresh(actorId);
      } catch (error) {
        setNotice(`Gagal membaca ringkasan: ${errorText(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [actorId, convex, refresh],
  );

  const end = useCallback(
    async (sessionId: string) => {
      if (!actorId) return;
      setBusy(true);
      try {
        const result = await convex.mutation(api.platform.endImpersonation, {
          actorId,
          sessionId: sessionId as Id<"impersonationSessions">,
        });
        setHelp(null);
        setNotice(result.summary);
        await refresh(actorId);
      } catch (error) {
        setNotice(`Gagal menutup sesi: ${errorText(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [actorId, convex, refresh],
  );

  const visibleTenants =
    directory?.tenants.filter((tenant) =>
      `${tenant.name} ${tenant.slug}`.toLowerCase().includes(filter.trim().toLowerCase()),
    ) ?? [];
  const activeSession =
    (sessions?.sessions ?? []).find((row) => row.status === "active") ?? null;

  return (
    <PlatformShell>
      <Card data-testid="platform-identity">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" />
            Identitas login terverifikasi
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Gerbang akun platform menuntut identitas yang diterbitkan <strong>server</strong>, bukan
            sekadar id yang dikirim klien. Identitas itu datang dari masuk lewat kode email di
            sini: kodenya diterbitkan Convex Auth untuk deployment ini, jadi baris{" "}
            <code className="font-mono text-xs">users</code> yang dipakai memeriksa izin sudah pasti
            milik orang yang benar-benar memegang kotak masuknya.
          </p>

          {isAuthenticated ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary/40 px-4 py-3 text-sm">
              <Badge variant="secondary">Terverifikasi</Badge>
              <span className="font-medium">{emailValue || "akun platform"}</span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => void signOut()}
              >
                Keluar dari identitas
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="plat-auth-email">Email akun platform</Label>
                <Input
                  id="plat-auth-email"
                  type="email"
                  value={emailValue}
                  placeholder="nama@domain.id"
                  onChange={(event) => setAuthEmail(event.target.value)}
                />
              </div>
              {authSent && (
                <div className="space-y-2">
                  <Label htmlFor="plat-auth-code">Kode dari email</Label>
                  <Input
                    id="plat-auth-code"
                    inputMode="numeric"
                    value={authCode}
                    placeholder="6 digit"
                    onChange={(event) => setAuthCode(event.target.value)}
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  disabled={authBusy || emailValue.trim().length === 0}
                  onClick={() => void sendAuthCode()}
                >
                  {authBusy ? "Mengirim…" : authSent ? "Kirim ulang kode" : "Kirim kode"}
                </Button>
                {authSent && (
                  <Button
                    variant="outline"
                    disabled={authBusy || authCode.trim().length === 0}
                    onClick={() => void verifyAuthCode()}
                  >
                    Verifikasi kode
                  </Button>
                )}
                {authLoading && (
                  <span className="text-xs text-muted-foreground">Memeriksa identitas…</span>
                )}
              </div>
            </div>
          )}

          {authNotice && <p className="text-sm text-muted-foreground">{authNotice}</p>}
        </CardContent>
      </Card>

      <Card data-testid="platform-access">
        <CardHeader>
          <CardTitle className="text-base">1. Identitas platform</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Sesi pendampingan menuntut identitas login yang <strong>terverifikasi</strong> —
            lebih ketat daripada gerbang tenant, yang masih boleh longgar selama transisi
            tanpa provider autentikasi. Karena itu pemeriksaannya dilakukan saat tombol ini
            ditekan: penolakannya muncul sebagai pesan, bukan halaman kosong.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void open()} disabled={busy}>
              {busy ? "Memeriksa…" : "Periksa akun platform"}
            </Button>
            {actorId && (
              <Button variant="outline" onClick={() => void refresh(actorId)} disabled={busy}>
                <RefreshCw className="size-4" />
                Segarkan
              </Button>
            )}
          </div>
          {me && (
            <div className="rounded-lg bg-secondary/40 px-4 py-3 text-sm">
              <div className="font-medium">{me.label}</div>
              <div className="text-xs text-muted-foreground">
                Peran platform: {me.roleLabel} · keanggotaan tenant: tidak ada
              </div>
            </div>
          )}
          {denied && (
            <div
              data-testid="platform-denied"
              className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm"
            >
              <div className="font-medium">Backstage ditolak server</div>
              <div className="mt-1 text-muted-foreground">{denied}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {me && (
        <>
          <Card data-testid="platform-start">
            <CardHeader>
              <CardTitle className="text-base">2. Buka sesi pendampingan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Sesi wajib beralasan, berbatas waktu, dan hanya <strong>satu</strong> yang boleh
                hidup per pengembang — jejak audit yang bercampur tidak bisa dipastikan milik
                sesi yang mana.
              </p>

              <div className="space-y-2">
                <Label htmlFor="plat-filter">Cari tenant</Label>
                <Input
                  id="plat-filter"
                  value={filter}
                  placeholder="nama atau slug"
                  onChange={(event) => setFilter(event.target.value)}
                />
              </div>

              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
                {visibleTenants.length === 0 && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    {directory?.tenants.length
                      ? "Tidak ada tenant yang cocok."
                      : "Belum ada tenant di deployment ini."}
                  </p>
                )}
                {visibleTenants.map((tenant) => (
                  <button
                    key={tenant.id}
                    type="button"
                    onClick={() => setTenantId(tenant.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors",
                      tenantId === tenant.id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-secondary",
                    )}
                  >
                    <span>
                      <span className="font-medium">{tenant.name}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {tenant.slug}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {tenant.planKey} · {tenant.status}
                    </span>
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <Label htmlFor="plat-reason">Alasan pendampingan</Label>
                <Input
                  id="plat-reason"
                  value={reason}
                  maxLength={IMPERSONATION_REASON_MAX}
                  placeholder="mis. tiket #482: kasir tidak bisa menutup shift"
                  onChange={(event) => setReason(event.target.value)}
                />
                <p
                  className={cn(
                    "text-xs",
                    reasonError ? "text-muted-foreground" : "text-primary",
                  )}
                >
                  {reasonError ??
                    "Alasan ini ikut tertulis di jejak audit tenant — tulis apa yang mau dibantu."}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Label>Lama sesi</Label>
                {MINUTE_OPTIONS.map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant={minutes === option ? "default" : "outline"}
                    onClick={() => setMinutes(option)}
                  >
                    {option} menit
                  </Button>
                ))}
                <Button
                  className="ml-auto"
                  disabled={busy || !tenantId || reasonError !== null}
                  onClick={() => void start()}
                >
                  Mulai pendampingan
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Kedaluwarsa dihitung saat dibaca, jadi sesi mati tepat waktu walaupun pekerja
                perapian belum berjalan. Setelah ditutup, permukaan tenant tertutup lagi —
                hanya jejaknya yang permanen.
              </p>
            </CardContent>
          </Card>

          <Card data-testid="platform-sessions">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <LifeBuoy className="size-4" />
                3. Sesi dan ringkasan bantuan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {notice && (
                <div className="rounded-lg bg-secondary/40 px-4 py-3 text-sm">{notice}</div>
              )}

              {activeSession ? (
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{activeSession.tenantName}</div>
                      <div className="text-xs text-muted-foreground">
                        {activeSession.reason}
                      </div>
                    </div>
                    <Badge variant="accent">{formatRemaining(activeSession.remainingMs)}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Dibuka {formatMoment(activeSession.startedAt)} · dibaca{" "}
                    {activeSession.helpCount}× · hanya baca
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void readHelp(activeSession.id)}
                    >
                      <Users className="size-4" />
                      Buka ringkasan bantuan
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void end(activeSession.id)}
                    >
                      <Square className="size-4" />
                      Akhiri pendampingan
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Tidak ada sesi hidup. Tenant hanya melihat kunjungan, bukan keberadaan akun
                  ini.
                </p>
              )}

              {help && (
                <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                  <div className="text-sm font-medium">
                    {help.tenant.name} · {help.tenant.planKey} · {help.tenant.status}
                  </div>
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                    <div>{help.counts.members} anggota (aktif {help.counts.activeMembers})</div>
                    <div>{help.counts.stores} toko dibaca</div>
                    <div>sisa {formatRemaining(help.remainingMs)}</div>
                  </div>
                  <div className="space-y-1">
                    {help.members.map((member) => (
                      <div
                        key={member.userId}
                        className="flex items-center justify-between rounded-md bg-background px-3 py-2 text-sm"
                      >
                        <span>
                          {member.name}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {member.email}
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {member.role}
                          {member.active ? "" : " · nonaktif"}
                        </span>
                      </div>
                    ))}
                  </div>
                  {(help.membersTruncated || help.storesTruncated) && (
                    <p className="text-xs text-muted-foreground">
                      Daftar dipotong: ringkasan bantuan dibaca dengan batas, bukan dengan
                      memindai seluruh tenant.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Sesi ini tidak memberi izin tulis apa pun di dalam tenant.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="platform-history">
            <CardHeader>
              <CardTitle className="text-base">4. Riwayat sesi milik Anda</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Sisi platform dari jejak audit: {sessions?.summary.total ?? 0} sesi ·{" "}
                {sessions?.summary.helpTotal ?? 0}× baca · {sessions?.summary.minutesTotal ?? 0}{" "}
                menit total. Sisi tenant-nya dibaca lewat{" "}
                <code className="font-mono">platform.impersonationTrail</code> (izin{" "}
                <code className="font-mono">team.manage</code>).
              </p>
              {(sessions?.sessions ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">Belum ada sesi.</p>
              )}
              {(sessions?.sessions ?? []).map((row: SessionRow) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium">{row.tenantName}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatMoment(row.startedAt)} · {row.reason}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={row.status === "active" ? "accent" : "outline"}>
                      {row.status === "active"
                        ? "berjalan"
                        : row.status === "expired"
                          ? "kedaluwarsa"
                          : "ditutup"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {row.durationMinutes} menit · {row.helpCount}× baca
                    </span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {!me && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Belum ada tenant yang dibuka</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Setelah identitas platform diperiksa, daftar tenant dan tombol pendampingan muncul
            di sini. Yang tercatat di jejak tenant adalah kunjungan sesi, bukan sekadar akun
            ini ada.
          </CardContent>
        </Card>
      )}
    </PlatformShell>
  );
}

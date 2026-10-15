/**
 * Halaman **Profil** (`/app/profil`) — identitas orang yang sedang masuk, identitas
 * usahanya, dan jalan keluar dari perangkat ini, semuanya di satu tempat.
 *
 * Pembagian kartunya mengikuti **siapa yang berhak**, bukan selera tata letak:
 *
 *  1. **Profil saya** (`users.updateProfile`) — nama & nomor WhatsApp pengguna
 *     aktif. Siapa saja boleh menyimpannya; server memeriksa bahwa yang diubah
 *     memang barisnya sendiri (`verifyActor`), jadi kasir tidak perlu izin
 *     tambahan untuk memperbaiki namanya. Emailnya ditampilkan sebagai keterangan
 *     (bukan kolom): ia identitas masuk — kode OTP dikirim ke sana — jadi
 *     menggantinya berarti masuk dengan email baru.
 *  2. **Profil usaha** (`tenants.updateProfile`) — nama usaha, alamat, email
 *     kontak, dan nomor WA. Izinnya `billing.manage`, sama dengan setelan
 *     workspace lain; peran tanpa izin itu tetap **melihat** isinya (mereka perlu
 *     tahu alamat & WA tokonya) tetapi kolomnya terkunci dan alasannya disebut.
 *  3. **Keluar** — mengakhiri sesi **di perangkat ini**. Dijelaskan apa adanya:
 *     data workspace tidak ikut terhapus, dan masuk lagi memakai kode OTP ke email
 *     yang sama.
 *
 * Aturannya sendiri tidak hidup di halaman ini: validasi & kalimat notisnya datang
 * dari `@/lib/profile` (aturan murni yang sama dengan server dan kedua store), jadi
 * pesan yang dibaca pemakai di mode demo, di mode Convex, dan yang ditolak server
 * berbunyi sama.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, LogOut, MessageCircle, Save, UserRound } from "lucide-react";
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
  applyTenantProfileDraft,
  applyUserProfileDraft,
  describeTenantProfile,
  describeUserProfile,
  formatWhatsapp,
  whatsappHref,
} from "@/lib/profile";
import { useSession } from "@/lib/session";
import { useStore } from "@/lib/store";
import { useCan } from "@/lib/usePermission";

/** Pesan galat apa pun jadi satu kalimat yang bisa dibaca. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ProfilePage() {
  const { session, signOut } = useSession();
  const { myProfile, setMyProfile, tenantProfile, setTenantProfile } = useStore();
  const can = useCan();
  const navigate = useNavigate();
  const canManageTenant = can("billing.manage");

  const email = session?.user.email ?? "";

  // ── Profil saya ────────────────────────────────────────────────────────────
  const [nameDraft, setNameDraft] = useState(myProfile.name);
  const [userWaDraft, setUserWaDraft] = useState(myProfile.whatsapp ?? "");
  const [userBusy, setUserBusy] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  const [userNotice, setUserNotice] = useState<string | null>(null);

  /**
   * Formulir mengikuti profil yang **tersimpan**: kalau namanya berubah dari
   * perangkat lain (mode Convex menyiarkannya), kolom di sini ikut berubah — jadi
   * halaman ini tidak pernah menampilkan nama yang sudah tidak berlaku.
   */
  useEffect(() => {
    setNameDraft(myProfile.name);
    setUserWaDraft(myProfile.whatsapp ?? "");
  }, [myProfile.name, myProfile.whatsapp]);

  const userBefore = useMemo(
    () => ({ name: myProfile.name, phone: myProfile.whatsapp }),
    [myProfile.name, myProfile.whatsapp],
  );
  const userDecision = applyUserProfileDraft(userBefore, {
    name: nameDraft,
    phone: userWaDraft,
  });
  const userDirty =
    nameDraft !== myProfile.name || userWaDraft !== (myProfile.whatsapp ?? "");

  async function simpanProfilSaya() {
    setUserBusy(true);
    setUserError(null);
    setUserNotice(null);
    try {
      const result = await setMyProfile({ name: nameDraft, whatsapp: userWaDraft });
      setUserNotice(result.sentence);
    } catch (error) {
      setUserError(errorText(error));
    } finally {
      setUserBusy(false);
    }
  }

  // ── Profil usaha ───────────────────────────────────────────────────────────
  const [tenantName, setTenantName] = useState(tenantProfile.name);
  const [tenantAddress, setTenantAddress] = useState(tenantProfile.address ?? "");
  const [tenantEmail, setTenantEmail] = useState(tenantProfile.email ?? "");
  const [tenantWa, setTenantWa] = useState(tenantProfile.whatsapp ?? "");
  const [tenantBusy, setTenantBusy] = useState(false);
  const [tenantError, setTenantError] = useState<string | null>(null);
  const [tenantNotice, setTenantNotice] = useState<string | null>(null);

  useEffect(() => {
    setTenantName(tenantProfile.name);
    setTenantAddress(tenantProfile.address ?? "");
    setTenantEmail(tenantProfile.email ?? "");
    setTenantWa(tenantProfile.whatsapp ?? "");
  }, [
    tenantProfile.name,
    tenantProfile.address,
    tenantProfile.email,
    tenantProfile.whatsapp,
  ]);

  const tenantBefore = useMemo(
    () => ({
      name: tenantProfile.name,
      address: tenantProfile.address,
      email: tenantProfile.email,
      phone: tenantProfile.whatsapp,
    }),
    [
      tenantProfile.name,
      tenantProfile.address,
      tenantProfile.email,
      tenantProfile.whatsapp,
    ],
  );
  const tenantDecision = applyTenantProfileDraft(tenantBefore, {
    name: tenantName,
    address: tenantAddress,
    email: tenantEmail,
    phone: tenantWa,
  });
  const tenantDirty =
    tenantName !== tenantProfile.name ||
    tenantAddress !== (tenantProfile.address ?? "") ||
    tenantEmail !== (tenantProfile.email ?? "") ||
    tenantWa !== (tenantProfile.whatsapp ?? "");

  async function simpanProfilUsaha() {
    setTenantBusy(true);
    setTenantError(null);
    setTenantNotice(null);
    try {
      const result = await setTenantProfile({
        name: tenantName,
        address: tenantAddress,
        email: tenantEmail,
        whatsapp: tenantWa,
      });
      setTenantNotice(result.sentence);
    } catch (error) {
      setTenantError(errorText(error));
    } finally {
      setTenantBusy(false);
    }
  }

  const chatHref = whatsappHref(myProfile.whatsapp);
  const chatsUsaha = whatsappHref(tenantProfile.whatsapp);

  function keluar() {
    // Sesi perangkat ini yang berakhir — data workspace tidak disentuh server.
    signOut();
    navigate("/", { replace: true });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profil</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Identitas Anda dan identitas usaha di satu tempat. Yang Anda ubah di sini
          langsung dipakai aplikasi: nama Anda tercetak sebagai nama kasir di struk
          dan tampil di daftar anggota Tim &amp; Peran, sedangkan nama, alamat,
          email, dan nomor WA usaha dipakai sebagai identitas bisnis.
        </p>
      </div>

      {/* ── Kartu 1: profil pengguna ───────────────────────────────────────── */}
      <Card data-testid="profil-saya">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <UserRound className="size-4 text-primary" />
                Profil saya
              </CardTitle>
              <CardDescription className="mt-1">
                Nama yang tercetak sebagai baris Kasir di struk dan tampil di daftar
                anggota Tim &amp; Peran, beserta nomor WhatsApp Anda. Emailnya tidak
                bisa diubah di sini karena ia yang menerima kode masuk.
              </CardDescription>
            </div>
            <Badge
              variant={userDirty ? "secondary" : "default"}
              className="shrink-0"
              data-testid="profil-saya-lencana"
            >
              {describeUserProfile({
                name: myProfile.name,
                phone: myProfile.whatsapp,
              })}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="profil-nama">Nama</Label>
              <Input
                id="profil-nama"
                data-testid="profil-nama"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.currentTarget.value)}
                autoComplete="name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profil-email">Email masuk (dari kode OTP)</Label>
              <Input
                id="profil-email"
                data-testid="profil-email-masuk"
                value={email}
                readOnly
                disabled
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profil-wa">Nomor WhatsApp</Label>
              <Input
                id="profil-wa"
                data-testid="profil-wa"
                value={userWaDraft}
                onChange={(event) => setUserWaDraft(event.currentTarget.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="0812-3456-7890"
              />
              <p className="text-xs text-muted-foreground">
                Boleh ditulis <span className="font-mono">0812…</span> — yang
                tersimpan bentuk yang bisa dibuka WhatsApp (
                <span className="font-mono">62812…</span>).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Tersimpan</Label>
              <div className="flex min-h-9 flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs">
                  {formatWhatsapp(myProfile.whatsapp)}
                </span>
                {chatHref && (
                  <a
                    href={chatHref}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="profil-chat-wa"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <MessageCircle className="size-3.5" />
                    Coba nomor ini
                  </a>
                )}
              </div>
            </div>
          </div>

          {!userDecision.ok && (
            <p
              role="alert"
              data-testid="profil-saya-validasi"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {userDecision.reason}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              data-testid="simpan-profil-saya"
              disabled={userBusy || !userDirty || !userDecision.ok}
              onClick={() => void simpanProfilSaya()}
              className="gap-2"
            >
              <Save className="size-4" />
              {userBusy ? "Menyimpan…" : "Simpan profil saya"}
            </Button>
            {userDirty && userDecision.ok && (
              <span className="text-xs text-muted-foreground">Belum disimpan.</span>
            )}
          </div>

          {userError && (
            <p
              role="alert"
              data-testid="profil-saya-galat"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {userError}
            </p>
          )}
          {userNotice && (
            <p data-testid="profil-saya-notis" className="text-xs text-muted-foreground">
              {userNotice}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Kartu 2: profil usaha ──────────────────────────────────────────── */}
      <Card data-testid="profil-usaha">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="size-4 text-primary" />
                Profil usaha
              </CardTitle>
              <CardDescription className="mt-1">
                Nama usaha beserta alamat, email, dan nomor WA-nya. Ketiganya
                ditampilkan sebagai identitas bisnis Anda; alamat &amp; WA juga yang
                dicari orang saat menghubungi toko.
              </CardDescription>
            </div>
            <Badge variant="outline" className="shrink-0" data-testid="profil-usaha-lencana">
              {/* Nama kolomnya sengaja diterjemahkan di sini: store memakai nama
                  yang dibaca halaman (`whatsapp`), sedangkan aturan murninya
                  memakai nama kolomnya di server (`phone`). Tanpa terjemahan ini
                  lencananya akan selalu mengaku nomor WA-nya belum diisi. */}
              {describeTenantProfile({
                name: tenantProfile.name,
                address: tenantProfile.address,
                email: tenantProfile.email,
                phone: tenantProfile.whatsapp,
              })}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {!canManageTenant && (
            <p
              data-testid="profil-usaha-baca-saja"
              className="rounded-lg border border-border/60 bg-secondary/30 px-4 py-3 text-xs text-muted-foreground"
            >
              Anda bisa membaca identitas usaha ini, tetapi mengubahnya butuh izin
              <strong className="text-foreground"> Mengelola langganan</strong> —
              peran pemilik, manajer, atau keuangan. Server tetap menolak
              perubahan yang dipaksakan dari luar halaman ini.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="profil-nama-usaha">Nama usaha</Label>
              <Input
                id="profil-nama-usaha"
                data-testid="profil-nama-usaha"
                value={tenantName}
                disabled={!canManageTenant}
                onChange={(event) => setTenantName(event.currentTarget.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profil-alamat">Alamat</Label>
              <Input
                id="profil-alamat"
                data-testid="profil-alamat"
                value={tenantAddress}
                disabled={!canManageTenant}
                onChange={(event) => setTenantAddress(event.currentTarget.value)}
                placeholder="Jl. Merdeka 10, Bandung"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profil-email-usaha">Email</Label>
              <Input
                id="profil-email-usaha"
                data-testid="profil-email"
                value={tenantEmail}
                disabled={!canManageTenant}
                onChange={(event) => setTenantEmail(event.currentTarget.value)}
                placeholder="halo@bisnis.id"
                inputMode="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profil-wa-usaha">Nomor WhatsApp</Label>
              <Input
                id="profil-wa-usaha"
                data-testid="profil-wa-usaha"
                value={tenantWa}
                disabled={!canManageTenant}
                onChange={(event) => setTenantWa(event.currentTarget.value)}
                inputMode="tel"
                placeholder="0812-3456-7890"
              />
              <p className="text-xs text-muted-foreground">
                Tersimpan:{" "}
                <span className="font-mono">{formatWhatsapp(tenantProfile.whatsapp)}</span>
                {chatsUsaha && (
                  <>
                    {" · "}
                    <a
                      href={chatsUsaha}
                      target="_blank"
                      rel="noreferrer"
                      data-testid="profil-chat-wa-usaha"
                      className="text-primary hover:underline"
                    >
                      Buka di WhatsApp
                    </a>
                  </>
                )}
              </p>
            </div>
          </div>

          {canManageTenant && !tenantDecision.ok && (
            <p
              role="alert"
              data-testid="profil-usaha-validasi"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {tenantDecision.reason}
            </p>
          )}

          {canManageTenant && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                data-testid="simpan-profil-usaha"
                disabled={tenantBusy || !tenantDirty || !tenantDecision.ok}
                onClick={() => void simpanProfilUsaha()}
                className="gap-2"
              >
                <Save className="size-4" />
                {tenantBusy ? "Menyimpan…" : "Simpan profil usaha"}
              </Button>
              {tenantDirty && tenantDecision.ok && (
                <span className="text-xs text-muted-foreground">Belum disimpan.</span>
              )}
            </div>
          )}

          {tenantError && (
            <p
              role="alert"
              data-testid="profil-usaha-galat"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {tenantError}
            </p>
          )}
          {tenantNotice && (
            <p data-testid="profil-usaha-notis" className="text-xs text-muted-foreground">
              {tenantNotice}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Kartu 3: keluar ────────────────────────────────────────────────── */}
      <Card data-testid="profil-keluar-kartu">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LogOut className="size-4 text-primary" />
            Keluar
          </CardTitle>
          <CardDescription className="mt-1">
            Mengakhiri sesi di perangkat ini saja. Data workspace tidak ikut
            terhapus — masuk lagi memakai kode OTP ke email{" "}
            <span className="font-mono text-xs">{email || "—"}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            data-testid="profil-keluar"
            onClick={keluar}
            className="gap-2"
          >
            <LogOut className="size-4" />
            Keluar dari perangkat ini
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

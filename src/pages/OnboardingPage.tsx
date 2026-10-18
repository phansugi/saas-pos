import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Building2,
  Check,
  CreditCard,
  Loader2,
  Rocket,
  ShieldCheck,
  Store,
  Truck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatIDR } from "@/lib/utils";
import { PLAN_LIST, VERTICAL_LABELS, type PlanKey, type Vertical } from "@/lib/billing";
import { suggestedVerticalFor } from "@/lib/businessCategory";
import { useSession, TRIAL_DAYS } from "@/lib/session";
import { useStore } from "@/lib/store";

const STEPS = ["Bisnis", "Modul", "Paket"] as const;

const VERTICAL_ICONS: Record<Vertical, typeof Store> = {
  umkm: Store,
  fnb: Boxes,
  wholesale: Truck,
};

/**
 * Three-step tenant setup that mirrors the server-side onboarding in
 * src/convex/tenants.ts (tenant + store + owner membership + trial). The
 * vertical chosen here seeds which module the tenant gets.
 *
 * Satu akun = satu bisnis. Karena itu halaman ini **menunggu** dulu sampai
 * identitas bisnis milik akun ditanyakan server (`workspacePending`): pemilik toko
 * yang masuk di perangkat baru tidak boleh ditawari mendirikan bisnis kedua hanya
 * karena sesi perangkat ini kosong.
 */
export function OnboardingPage() {
  const { session, ready, createTenant, signOut } = useSession();
  const {
    workspacePending,
    error: storeError,
    cancelRegistration,
    // Katalog yang boleh dipilih datang dari store: di mode Convex isinya
    // mengikuti pengelolaan backstage (kategori nonaktif tidak ditawarkan), di
    // mode demo taksonomi bawaannya.
    businessCategories,
    // Akun platform developer tidak selalu punya workspace; tautan backstage di
    // header ini jalan masuknya saat sidebar aplikasi belum bisa dibuka.
    platformDeveloper,
  } = useStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Tujuan setelah selesai diambil dari URL (`RequireTenant` mengirimnya), tapi
  // hanya jalur di dalam aplikasi yang diterima — nilai dari luar tidak boleh
  // dipakai sebagai alamat keluar.
  const diminta = params.get("returnTo") || "/app";
  const returnTo =
    diminta.startsWith("/") && !diminta.startsWith("//") ? diminta : "/app";

  const [step, setStep] = useState(0);
  const [businessName, setBusinessName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [vertical, setVertical] = useState<Vertical>("umkm");
  const [planKey, setPlanKey] = useState<PlanKey>("starter");
  /*
    Kategori utama bisnis dipilih **sekali** di sini dan ikut dikunci saat trial
    dimulai. Karena itu subkategorinya direset setiap kali kategorinya berganti —
    pasangan lama tidak boleh tertinggal dan ikut terkunci tanpa dibaca pemilik.
  */
  const [businessCategoryKey, setBusinessCategoryKey] = useState("");
  const [businessSubcategoryKey, setBusinessSubcategoryKey] = useState("");
  const kategoriUtama =
    businessCategories.find((row) => row.key === businessCategoryKey) ?? null;
  /** Keadaan tautan “Batalkan” — sedang menghapus, atau alasan penolakannya. */
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  /**
   * Pendaftaran sudah dihapus dan halaman ini sedang menuju beranda.
   *
   * Perpindahan rute berjalan sebagai transisi, sedangkan pelepasan sesi adalah
   * pembaruan mendesak — jadi sesaat halaman ini masih terpasang dengan sesi
   * kosong. Tanpa penanda ini, penjaga “belum masuk” di bawah akan melempar
   * pengguna ke `/auth` dan mengalahkan tujuan yang sudah dipilih: beranda.
   */
  const [cancelled, setCancelled] = useState(false);

  /** Only plans whose verticals include the chosen module can be picked. */
  const availablePlans = useMemo(
    () => PLAN_LIST.filter((plan) => plan.verticals.includes(vertical)),
    [vertical],
  );

  // Picking a module that the current plan excludes must not silently persist.
  const effectivePlan = availablePlans.some((p) => p.key === planKey)
    ? planKey
    : availablePlans[0]?.key ?? "starter";

  if (!ready) return null;
  if (!session) {
    // Sedang ditinggalkan menuju beranda setelah pendaftaran dibatalkan: jangan
    // diarahkan ke halaman masuk, dan jangan dirender sebagai formulir kosong.
    if (cancelled) return null;
    return <Navigate to="/auth?returnTo=/onboarding" replace />;
  }
  /*
    Identitas bisnis akun ini belum pasti: daftar keanggotaan masih dimuat, atau
    sesi perangkat ini masih memuat identitas lain dan efek adopsi store belum
    menutup selisihnya. Formulirnya ditahan sebentar — kalau tidak, akun yang
    memang sudah punya workspace akan mendirikan bisnis kedua di sini.
  */
  if (workspacePending) {
    return <WorkspaceRecovery error={storeError} />;
  }
  if (session.tenant) {
    return <Navigate to={returnTo} replace />;
  }

  const canContinue =
    step === 0
      ? businessName.trim().length >= 2 && storeName.trim().length >= 2
      : step === 1
        ? Boolean(kategoriUtama && businessSubcategoryKey)
        : true;

  const finish = () => {
    // Halaman tidak boleh mengunci pasangan yang belum lengkap: tombolnya memang
    // sudah nonaktif, dan penjagaan ini menutup jalur panggilan langsung.
    if (!kategoriUtama || !businessSubcategoryKey) return;
    createTenant({
      businessName: businessName.trim(),
      storeName: storeName.trim(),
      vertical,
      planKey: effectivePlan,
      businessCategory: {
        category: kategoriUtama.key,
        subcategory: businessSubcategoryKey,
      },
    });
    navigate(returnTo, { replace: true });
  };

  /*
    “Batalkan” **menghapus akun** yang baru dibuat — email yang tadi dipakai
    mendaftar keluar dari daftar akun, bukan hanya sesi perangkat ini yang
    ditutup. Urutannya penting: server dihubungi lebih dulu. Kalau server menolak
    (mis. akun ternyata sudah punya workspace), sesinya tidak disentuh dan alasan
    penolakannya ditampilkan apa adanya.
  */
  const batalkan = async () => {
    setCancelBusy(true);
    setCancelError(null);
    try {
      await cancelRegistration();
      /*
        Beranda **dulu**, baru sesi dilepas — dan penanda `cancelled` dipasang
        sebelum sesinya hilang. Perpindahan rute adalah transisi, sedangkan
        pelepasan sesi mendesak: tanpa penanda itu, penjaga “belum masuk” sempat
        berjalan lebih dulu dan melempar pengguna ke `/auth`.
      */
      setCancelled(true);
      navigate("/", { replace: true });
      signOut();
    } catch (cause) {
      setCancelError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background px-6 py-12">
      <div className="absolute inset-0 -z-10 bg-radial-glow" />
      <div className="absolute inset-0 -z-10 bg-grid opacity-25" />

      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-lg bg-primary/15 text-primary">
              <Store className="size-5" />
            </span>
            <span className="text-lg font-bold tracking-tight">
              Mesin<span className="text-primary">POS</span>
            </span>
          </Link>
          {platformDeveloper && (
            <Link
              to="/platform"
              data-testid="onboarding-backstage"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              title="Backstage pengembang platform: kategori bisnis, pendampingan tenant, dan jejak audit."
            >
              <ShieldCheck className="size-3.5" />
              Backstage platform
            </Link>
          )}
        </div>

        <div className="mt-10">
          <h1 className="text-3xl font-bold tracking-tight text-balance">
            Siapkan bisnis Anda
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tiga langkah singkat. Anda mendapat {TRIAL_DAYS} hari gratis dengan
            semua fitur paket terpilih.
          </p>
        </div>

        {/* Progress */}
        <ol className="mt-8 flex items-center gap-3">
          {STEPS.map((label, index) => {
            const done = index < step;
            const active = index === step;
            return (
              <li key={label} className="flex flex-1 items-center gap-3">
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-colors",
                    done && "border-primary bg-primary text-primary-foreground",
                    active && !done && "border-primary text-primary",
                    !done && !active && "border-border text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-4" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "hidden text-sm font-medium sm:block",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
                {index < STEPS.length - 1 && (
                  <span className="h-px flex-1 bg-border" />
                )}
              </li>
            );
          })}
        </ol>

        <motion.div
          key={step}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="mt-6"
        >
          {step === 0 && (
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="space-y-2">
                  <Label htmlFor="business">Nama bisnis</Label>
                  <Input
                    id="business"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="Kedai Kopi Nusantara"
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    Muncul di struk, laporan, dan invoice langganan.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="store">Nama cabang pertama</Label>
                  <Input
                    id="store"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="Cabang Sudirman"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {step === 1 && (
            <div className="space-y-4">
              {/**
                Kategori utama berada **sebelum** pilihan modul karena ia yang
                menjelaskan bisnisnya; modul di bawahnya hanya fitur. Pilihan ini
                dikunci permanen saat trial dimulai, jadi peringatannya ditulis
                sebelum pemilik memilih — bukan setelah.
              */}
              <div
                data-testid="onboarding-kategori-utama"
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Building2 className="size-4 text-primary" />
                      Kategori utama bisnis
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Pilih sekali. Setelah trial dimulai, MesinPOS mengunci kategori
                      dan subkategori ini permanen — tidak bisa diubah, termasuk oleh
                      pemilik.
                    </p>
                  </div>
                  <Badge variant="accent" className="shrink-0">
                    Dikunci permanen
                  </Badge>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-xs text-muted-foreground">
                    Kategori
                    <select
                      data-testid="onboarding-kategori"
                      className="w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                      value={businessCategoryKey}
                      onChange={(event) => {
                        const key = event.target.value;
                        setBusinessCategoryKey(key);
                        // Subkategori hanya berlaku di dalam kategorinya, dan modul
                        // yang ditawarkan mengikuti kategori baru.
                        setBusinessSubcategoryKey("");
                        if (key) setVertical(suggestedVerticalFor(key));
                      }}
                    >
                      <option value="">Pilih kategori utama…</option>
                      {businessCategories.map((row) => (
                        <option key={row.key} value={row.key}>
                          {row.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-xs text-muted-foreground">
                    Subkategori
                    <select
                      data-testid="onboarding-subkategori"
                      className="w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground disabled:opacity-60"
                      value={businessSubcategoryKey}
                      disabled={!kategoriUtama}
                      onChange={(event) => setBusinessSubcategoryKey(event.target.value)}
                    >
                      <option value="">Pilih subkategori…</option>
                      {(kategoriUtama?.subcategories ?? []).map((row) => (
                        <option key={row.key} value={row.key}>
                          {row.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Dipakai sebagai identitas bisnis Anda di seluruh MesinPOS — termasuk
                  laporan dan dukungan. Tidak ada tombol “ubah” setelah dikunci.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {(Object.keys(VERTICAL_LABELS) as Vertical[]).map((key) => {
                const Icon = VERTICAL_ICONS[key];
                const selected = vertical === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setVertical(key)}
                    className={cn(
                      "rounded-lg border p-4 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:border-primary/40 hover:bg-secondary/50",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-9 place-items-center rounded-lg",
                        selected
                          ? "bg-primary/15 text-primary"
                          : "bg-secondary text-muted-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <div className="mt-3 text-sm font-semibold">
                      {VERTICAL_LABELS[key]}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {key === "umkm" && "Kasir cepat, stok, satu cabang."}
                      {key === "fnb" && "Meja, KDS, modifier menu."}
                      {key === "wholesale" && "Harga bertingkat, satuan, piutang."}
                    </p>
                  </button>
                );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Modul dipilihkan sesuai kategori utama, tetapi masih bisa diganti di
                sini. Modul mengatur fitur yang aktif, bukan identitas bisnis.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              {availablePlans.map((plan) => {
                const selected = effectivePlan === plan.key;
                return (
                  <button
                    key={plan.key}
                    type="button"
                    onClick={() => setPlanKey(plan.key)}
                    className={cn(
                      "flex w-full items-start justify-between gap-4 rounded-lg border p-4 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:border-primary/40 hover:bg-secondary/50",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{plan.name}</span>
                        {plan.highlight && (
                          <Badge variant="accent">Populer</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {plan.description}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {plan.limits.devices === "unlimited"
                          ? "Perangkat tanpa batas"
                          : `${plan.limits.devices} perangkat`}{" "}
                        · {plan.limits.products === "unlimited"
                          ? "produk tanpa batas"
                          : `${plan.limits.products.toLocaleString("id-ID")} produk`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {plan.price ? (
                        <>
                          <div className="text-sm font-semibold">
                            {formatIDR(plan.price.monthly)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            /bulan
                          </div>
                        </>
                      ) : (
                        <div className="text-sm font-semibold">Custom</div>
                      )}
                    </div>
                  </button>
                );
              })}
              <div className="flex items-start gap-3 rounded-lg border border-accent/30 bg-accent/10 p-3 text-xs text-muted-foreground">
                <CreditCard className="mt-0.5 size-4 shrink-0 text-accent" />
                <p>
                  Belum ada tagihan sekarang. Kartu baru diminta setelah trial{" "}
                  {TRIAL_DAYS} hari berakhir, dan Anda bisa berhenti kapan saja.
                </p>
              </div>
            </div>
          )}
        </motion.div>

        <div className="mt-6 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            <ArrowLeft /> Kembali
          </Button>

          {step < STEPS.length - 1 ? (
            <Button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canContinue}
            >
              Lanjut <ArrowRight />
            </Button>
          ) : (
            <Button type="button" variant="accent" onClick={finish}>
              <Rocket /> Mulai trial {TRIAL_DAYS} hari
            </Button>
          )}
        </div>

        {step === 0 && (
          <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Building2 className="size-3.5" />
            Anda bisa menambah cabang lain nanti sesuai paket.
          </p>
        )}

        {/*
          Jalan keluar yang jujur untuk pendaftaran yang belum jadi: akunnya
          dihapus, bukan dibiarkan terdaftar. Hanya ada di halaman ini karena
          di sinilah akun baru belum punya workspace — server tetap menolak
          pembatalan kalau ternyata sudah punya.
        */}
        <div className="mt-8 rounded-lg border border-dashed border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                Berubah pikiran di tengah pendaftaran?
              </div>
              <p
                data-testid="batalkan-catatan"
                className="mt-1 text-xs text-muted-foreground"
              >
                Email {session.user.email} akan dihapus dari sistem, jadi bisa
                dipakai mendaftar lagi kapan saja. Anda kembali ke beranda.
              </p>
            </div>
            <button
              type="button"
              data-testid="batalkan-pendaftaran"
              onClick={() => void batalkan()}
              disabled={cancelBusy}
              className="shrink-0 text-sm font-semibold text-destructive underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
            >
              {cancelBusy ? "Menghapus email…" : "Batalkan"}
            </button>
          </div>
          {cancelError && (
            <p
              role="alert"
              data-testid="batalkan-galat"
              className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {cancelError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Keadaan menunggu saat identitas bisnis akun ini sedang dipulihkan dari server.
 *
 * Dipakai dua situasi: akun yang datang dari perangkat baru (workspace-nya sudah
 * ada di server) dan akun yang baru mendaftar (belum punya). Keduanya tampak sama
 * dari sesi perangkat ini, jadi yang membedakan hanya jawaban server — dan selama
 * jawaban itu belum ada, menampilkan formulir “nama bisnis” akan menyesatkan
 * pemilik toko yang bisnisnya sudah berdiri.
 */
function WorkspaceRecovery({ error }: { error: string | null }) {
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-6 py-12">
      <div className="absolute inset-0 -z-10 bg-radial-glow" />
      <div className="absolute inset-0 -z-10 bg-grid opacity-25" />

      <div className="w-full max-w-md text-center">
        <span className="mx-auto grid size-10 place-items-center rounded-lg bg-primary/15 text-primary">
          <Store className="size-5" />
        </span>
        <h1 className="mt-5 text-xl font-bold tracking-tight">
          {error ? "Workspace belum tersambung" : "Memuat workspace Anda"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error
            ? error
            : "Sebentar — kami memeriksa apakah bisnis Anda sudah terdaftar, supaya tidak ada dua workspace untuk satu akun."}
        </p>
        {!error && (
          <p className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Menghubungi server…
          </p>
        )}
        {error && (
          <Button
            type="button"
            variant="secondary"
            className="mt-5"
            onClick={() => window.location.reload()}
          >
            Coba lagi
          </Button>
        )}
      </div>
    </div>
  );
}

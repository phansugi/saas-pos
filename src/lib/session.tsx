/**
 * Client session + tenant store.
 *
 * This is the single integration seam for authentication and tenancy. It
 * currently persists to localStorage because the Convex deployment is not
 * connected yet (see src/convex/*). When Convex Auth lands, only the bodies of
 * `signInWithOtp`, `signOut` and `createTenant` need to change — every
 * consumer keeps using `useSession`, `RequireAuth` and `RequireTenant`.
 *
 * Masuk **tanpa kata sandi**: `signInWithOtp` dipanggil setelah kode OTP untuk
 * email itu terbukti benar (lihat `@/components/OtpForm` dan `src/convex/otp.ts`).
 * Satu jalur melayani masuk dan daftar — pemanggilnya tidak perlu tahu mana
 * yang sedang terjadi.
 *
 * IMPORTANT: this file only *records* the session the OTP check produced. In
 * mode demo, kode OTP-nya sendiri dihasilkan & diperiksa di klien memakai aturan
 * yang sama dengan server (`@/lib/otp`), jadi jalur navigasinya bisa lengkap dan
 * teruji sebelum backend tersambung.
 */

import { defaultNameFromEmail } from "@/lib/otp";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { isRole, ROLE_LABELS, type Permission, type Role } from "@/lib/authz";
import { DEFAULT_TAX_RATE_PCT, type PlanKey, type Vertical } from "@/lib/billing";
import { effectivePermissions, sanitizePermissions } from "@/lib/rbac";
import {
  DEFAULT_FNB_TAX_PROFILE,
  sameFnbTaxProfile,
  type FnbTaxProfile,
} from "@/lib/fnbTax";
import {
  DEFAULT_RECEIPT_SETTING,
  sameReceiptSetting,
  type ReceiptSetting,
} from "@/lib/struk";

const STORAGE_KEY = "mesinpos.session.v1";

/** Matches the server-side trial length in src/convex/tenants.ts. */
export const TRIAL_DAYS = 14;

export interface SessionUser {
  name: string;
  email: string;
}

/** Peran kustom yang berlaku untuk pengguna aktif (`rbac.custom`, Phase 4). */
export interface SessionCustomRole {
  id: string;
  name: string;
  permissions: Permission[];
}

export interface SessionTenant {
  name: string;
  slug: string;
  storeName: string;
  /** Modul utama pilihan saat onboarding (modul pertama yang aktif). */
  vertical: Vertical;
  /**
   * Modul plug-in yang aktif (Phase 2). Cermin dari `tenants.verticals` di
   * backend; paket menentukan modul mana yang boleh hidup dan berapa banyak.
   */
  verticals: Vertical[];
  planKey: PlanKey;
  /**
   * Setelan PPN workspace (kolom `tenants.taxActive` & `tenants.taxRatePct`).
   *
   * Kolomnya **opsional** dan yang kosong berarti **aktif** dengan tarif
   * bawaan — aturan yang sama dengan `@/lib/tax` di server, jadi sesi lama yang
   * tersimpan sebelum PPN bisa diatur tetap memungut pajak seperti dulu.
   */
  taxActive?: boolean;
  taxRatePct?: number;
  /**
   * Setelan pajak & pungutan F&B workspace (`tenants.fnbTaxProfile`).
   *
   * Kolomnya **opsional** dan yang kosong berarti **bawaan tanpa pungutan F&B**,
   * jadi sesi lama maupun workspace yang belum mengaturnya tetap berjalan seperti
   * sebelumnya. Di mode demo inilah satu-satunya tempat setelannya hidup; di mode
   * Convex nilainya datang dari `entitlements.getForTenant`.
   */
  fnbTaxProfile?: FnbTaxProfile;
  /**
   * Setelan struk belanja workspace (`tenants.receipt`): jenis printer, lebar
   * kertas, rangkap, catatan kaki.
   *
   * Kolomnya **opsional** dan yang kosong berarti **bawaan** (thermal 80 mm, satu
   * lembar) — jadi sesi lama maupun workspace yang belum mengaturnya tetap
   * mencetak struk seperti sebelumnya. Di mode demo inilah satu-satunya tempat
   * setelannya hidup; di mode Convex nilainya datang dari baris tenant.
   */
  receipt?: ReceiptSetting;
  /**
   * Logo toko yang tercetak di atas nama usaha pada struk (`tenants.logo`).
   *
   * Di mode Convex nilainya datang dari server (`tenants.listMine` mengembalikan
   * `logoUrl` yang dibuat dari id berkasnya); di mode demo inilah satu-satunya
   * tempat logonya hidup, sebagai data URL — demo tidak punya penyimpanan berkas.
   * Kosong berarti workspace itu belum punya logo.
   */
  logoUrl?: string | null;
  /**
   * The signed-in user's role *within this tenant* — mirrors
   * `memberships.role` on the backend, and drives every client-side gate.
   */
  role: Role;
  /**
   * Peran kustom yang **menggantikan** izin `role` kalau ada. Di backend ini
   * datang dari `memberships.customRoleId` (`roles.myAccess`); di tenant tanpa
   * peran kustom, kosong.
   */
  customRole?: SessionCustomRole | null;
  /** ISO timestamp of onboarding completion. */
  createdAt: string;
  /** ISO timestamp the 14-day trial ends. */
  trialEndsAt: string;
}

export interface Session {
  user: SessionUser;
  tenant: SessionTenant | null;
}

export interface CreateTenantInput {
  businessName: string;
  storeName: string;
  vertical: Vertical;
  planKey: PlanKey;
}

/**
 * Fakta workspace yang datang dari server (keanggotaan pengguna aktif).
 * Dipakai untuk memulihkan sesi di perangkat yang belum pernah memuat workspace
 * itu — nama bisnis, slug, paket, dan peran yang tampil selalu milik workspace
 * yang benar-benar dipakai, bukan sisa sesi lama.
 */
export interface AdoptWorkspaceInput {
  name: string;
  slug: string;
  role: Role;
  planKey?: PlanKey;
  verticals?: Vertical[];
  storeName?: string;
  createdAt?: string;
  trialEndsAt?: string;
}

interface SessionContextValue {
  session: Session | null;
  /** False until the persisted session has been read (avoids a redirect flash). */
  ready: boolean;
  /**
   * Menyelesaikan masuk/daftar setelah kode OTP email terbukti benar.
   *
   * Akun baru tidak perlu mendaftar lebih dulu: baris `users` dibuat server saat
   * kodenya diverifikasi, dan di sini tenant lama hanya dipertahankan kalau
   * emailnya sama — akun baru mulai dari onboarding.
   */
  signInWithOtp: (input: { email: string; name?: string }) => Session;
  createTenant: (input: CreateTenantInput) => SessionTenant;
  /**
   * Menyelaraskan sesi perangkat ini dengan workspace milik pengguna di server.
   *
   * Ini yang membuat tiap akun “berdiri sendiri”: perangkat baru (atau
   * `localStorage` yang dibersihkan) tetap masuk ke workspace miliknya, dan nama
   * bisnis yang tampil selalu workspace itu — bukan tebakan dari nama yang
   * diketik ulang. Workspace yang bukan milik pengguna tidak pernah diadopsi
   * (sumbernya hanya query keanggotaan di server).
   */
  adoptWorkspace: (input: AdoptWorkspaceInput) => void;
  /** Menyalakan/mematikan modul plug-in; backend tetap memvalidasi ulang. */
  setVerticals: (verticals: Vertical[]) => void;
  /**
   * Menyimpan setelan PPN workspace hasil `tenants.updateTax` di server. Di mode
   * demo inilah satu-satunya tempat setelannya hidup; di mode Convex nilainya
   * datang dari `entitlements.getForTenant` dan hanya dipakai sebagai jembatan.
   */
  setTaxSetting: (active: boolean, ratePct: number) => void;
  /**
   * Menyimpan setelan pajak & pungutan F&B hasil `tenants.updateFnbTax` di server.
   * Kasir, struk, dan halaman Pengaturan membaca angka yang sama dari sini.
   */
  setFnbTaxProfile: (profile: FnbTaxProfile) => void;
  /**
   * Menyimpan setelan struk belanja hasil `tenants.updateReceipt` di server. Kasir
   * (yang mencetak) dan halaman Pengaturan (yang menampilkan pratinjau) membaca
   * setelan yang sama dari sini.
   */
  setReceiptSetting: (setting: ReceiptSetting) => void;
  /**
   * Menyimpan logo toko hasil `tenants.setLogo`/`removeLogo`. Mode demo memakainya
   * sebagai rumah logonya (data URL); mode Convex membacanya dari server, jadi
   * pemanggilnya hanya store demo.
   */
  setLogoUrl: (url: string | null) => void;
  /**
   * Menyelaraskan paket & modul sesi setelah pindah paket di server
   * (`billing.changePlan`). Tanpa ini, sidebar dan gerbang fitur tetap memakai
   * paket lama sampai pengguna masuk ulang — sementara server sudah memakai
   * paket baru.  
   */
  setPlan: (planKey: PlanKey, verticals?: Vertical[]) => void;
  /**
   * Menyimpan peran kustom yang berlaku untuk pengguna aktif (dari backend).
   * Menu & rute harus mengikuti izin server, bukan menebak dari `role`.
   */
  setCustomRole: (role: SessionCustomRole | null) => void;
  signOut: () => void;
  /** Demo helper: changes the acting role so the RBAC gates are observable. */
  setRole: (role: Role) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);
}

/** Read the persisted session without throwing on corrupted/absent storage. */
function readStoredSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.user?.email) return null;
    // Sessions persisted before roles existed (or from an older backend) are
    // normalised rather than trusted, so `can()` never sees an unknown role.
    if (parsed.tenant && !isRole(parsed.tenant.role)) {
      return { ...parsed, tenant: { ...parsed.tenant, role: "owner" } };
    }
    // Sesi yang tersimpan sebelum modul plug-in ada hanya punya `vertical`,
    // jadi diperluas di sini alih-alih dipercaya apa adanya.
    if (parsed.tenant && !Array.isArray(parsed.tenant.verticals)) {
      return {
        ...parsed,
        tenant: { ...parsed.tenant, verticals: [parsed.tenant.vertical] },
      };
    }
    // Peran kustom dari sesi lama dinormalkan: izin yang tidak dikenal dibuang,
    // dan peran yang tidak menyisakan izin apa pun dilepas supaya anggota tidak
    // terkunci dari menu karena baris yang salah bentuk.
    if (parsed.tenant?.customRole) {
      const permissions = sanitizePermissions(parsed.tenant.customRole.permissions);
      if (permissions.length === 0) {
        return {
          ...parsed,
          tenant: { ...parsed.tenant, customRole: null },
        };
      }
      return {
        ...parsed,
        tenant: {
          ...parsed.tenant,
          customRole: { ...parsed.tenant.customRole, permissions },
        },
      };
    }
    return parsed;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => readStoredSession());
  const [ready, setReady] = useState(false);

  // Re-read on mount: the initial render happens before storage is available
  // in some embedding contexts, and effects keep StrictMode double-render safe.
  useEffect(() => {
    setSession(readStoredSession());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    // `localStorage` BISA melempar: mode privat, penyimpanan diblokir browser HP,
    // atau kuota penuh. Penulisannya dulu tidak dijaga, dan satu lemparan di
    // dalam efek membuat React melepas seluruh pohon komponen — layar jadi
    // putih semua tanpa pesan. Sesi tetap hidup di memori untuk tab ini.
    try {
      if (session) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* penyimpanan tidak tersedia — sesi tidak dipersistensikan, aplikasi jalan terus */
    }
  }, [session, ready]);

  // Persistence happens in the effect above, so these updaters stay pure and
  // StrictMode's double-invocation cannot cause duplicate side effects.
  const signInWithOtp = useCallback(
    ({ email, name }: { email: string; name?: string }): Session => {
      const normalized = email.trim().toLowerCase();
      // Nama dari server (akun yang sudah ada) menang; kalau kosong, nama wajar
      // dari email dipakai supaya sidebar tidak pernah kosong.
      const resolved = (name ?? "").trim() || defaultNameFromEmail(normalized);
      const next: Session = {
        user: { name: resolved, email: normalized },
        // Email yang sama di perangkat ini tetap memakai tenantnya; email lain
        // (akun baru) mulai dari onboarding.
        tenant: session?.user.email === normalized ? session.tenant : null,
      };
      setSession(next);
      return next;
    },
    [session],
  );

  const createTenant = useCallback(
    (input: CreateTenantInput): SessionTenant => {
      const now = new Date();
      const trialEnds = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
      const tenant: SessionTenant = {
        name: input.businessName,
        slug: slugify(input.businessName) || "toko",
        storeName: input.storeName,
        vertical: input.vertical,
        verticals: [input.vertical],
        planKey: input.planKey,
        // Bawaan sama dengan `tenants.create`: PPN aktif 11% sampai diubah
        // pemiliknya di halaman Pengaturan.
        taxActive: true,
        taxRatePct: DEFAULT_TAX_RATE_PCT,
        // Bawaan pajak F&B = belum ada pungutan F&B, sama dengan kolom kosong di
        // server; PBJT & biaya layanan baru berlaku setelah pemilik menyalakannya
        // di halaman Pengaturan.
        fnbTaxProfile: { ...DEFAULT_FNB_TAX_PROFILE },
        // Bawaan struk sama dengan kolom `tenants.receipt` yang masih kosong:
        // thermal 80 mm sekali cetak, dengan catatan kaki yang sudah dipakai
        // aplikasi ini sejak sebelum setelannya bisa diatur.
        receipt: { ...DEFAULT_RECEIPT_SETTING },
        // The person who onboards owns the tenant (`tenants.create` makes them
        // the owner membership server-side too).
        role: "owner",
        createdAt: now.toISOString(),
        trialEndsAt: trialEnds.toISOString(),
      };
      setSession((current: Session | null): Session => ({
        ...(current ?? {
          user: { name: "Pemilik", email: "owner@mesinpos.id" },
          tenant: null,
        }),
        tenant,
      }));
      return tenant;
    },
    [],
  );

  const adoptWorkspace = useCallback((input: AdoptWorkspaceInput) => {
    setSession((current) => {
      // Belum masuk: tidak ada sesi yang bisa diisi.
      if (!current) return current;
      const previous = current.tenant;
      const verticals =
        input.verticals && input.verticals.length > 0
          ? input.verticals
          : previous?.verticals ?? ["umkm"];
      const next: SessionTenant = {
        name: input.name,
        slug: input.slug,
        storeName: input.storeName ?? previous?.storeName ?? "Toko Utama",
        vertical: verticals[0],
        verticals,
        planKey: input.planKey ?? previous?.planKey ?? "starter",
        role: input.role,
        // Peran kustom diisi efek lain dari server (`roles.myAccess`); adopsi
        // workspace tidak menyentuhnya supaya izin yang sudah berlaku tidak hilang.
        customRole: previous?.customRole ?? null,
        createdAt: input.createdAt ?? previous?.createdAt ?? new Date().toISOString(),
        trialEndsAt: input.trialEndsAt ?? previous?.trialEndsAt ?? new Date().toISOString(),
      };
      // Identitas sama → jangan memicu render ulang: efek store bisa berjalan
      // berkali-kali, dan pembaruan sesi tanpa perubahan akan jadi gelung.
      if (
        previous &&
        previous.name === next.name &&
        previous.slug === next.slug &&
        previous.storeName === next.storeName &&
        previous.planKey === next.planKey &&
        previous.role === next.role &&
        previous.createdAt === next.createdAt &&
        previous.verticals.join(",") === next.verticals.join(",")
      ) {
        return current;
      }
      return { ...current, tenant: next };
    });
  }, []);

  const setVerticals = useCallback((verticals: Vertical[]) => {
    setSession((current) => {
      if (!current?.tenant || verticals.length === 0) return current;
      return {
        ...current,
        tenant: {
          ...current.tenant,
          verticals,
          // Modul pertama tetap dilaporkan sebagai `vertical` supaya konsumen
          // lama (onboarding, label sidebar) tidak perlu tahu soal daftar.
          vertical: verticals[0],
        },
      };
    });
  }, []);

  const setPlan = useCallback((planKey: PlanKey, verticals?: Vertical[]) => {
    setSession((current) => {
      if (!current?.tenant) return current;
      // Modul yang dipotong server dikirim pemanggil (satu aturan,
      // `trimVerticalsForPlan`); kalau tidak dikirim, daftar lama dipertahankan.
      const nextVerticals =
        verticals && verticals.length > 0
          ? verticals
          : current.tenant.verticals;
      return {
        ...current,
        tenant: {
          ...current.tenant,
          planKey,
          verticals: nextVerticals,
          vertical: nextVerticals[0] ?? current.tenant.vertical,
        },
      };
    });
  }, []);

  const setTaxSetting = useCallback((active: boolean, ratePct: number) => {
    setSession((current) => {
      if (!current?.tenant) return current;
      if (
        current.tenant.taxActive === active &&
        current.tenant.taxRatePct === ratePct
      ) {
        return current;
      }
      return { ...current, tenant: { ...current.tenant, taxActive: active, taxRatePct: ratePct } };
    });
  }, []);

  const setFnbTaxProfile = useCallback((profile: FnbTaxProfile) => {
    setSession((current) => {
      if (!current?.tenant) return current;
      const currentProfile = current.tenant.fnbTaxProfile;
      if (currentProfile && sameFnbTaxProfile(currentProfile, profile)) return current;
      return {
        ...current,
        tenant: { ...current.tenant, fnbTaxProfile: { ...profile } },
      };
    });
  }, []);

  const setReceiptSetting = useCallback((setting: ReceiptSetting) => {
    setSession((current) => {
      if (!current?.tenant) return current;
      const currentSetting = current.tenant.receipt;
      if (currentSetting && sameReceiptSetting(currentSetting, setting)) return current;
      return {
        ...current,
        tenant: { ...current.tenant, receipt: { ...setting } },
      };
    });
  }, []);

  const setLogoUrl = useCallback((url: string | null) => {
    setSession((current) => {
      if (!current?.tenant) return current;
      const next = url && url.trim() !== "" ? url : null;
      if ((current.tenant.logoUrl ?? null) === next) return current;
      return { ...current, tenant: { ...current.tenant, logoUrl: next } };
    });
  }, []);

  const setCustomRole = useCallback((role: SessionCustomRole | null) => {
    setSession((current) => {
      if (!current?.tenant) return current;
      const permissions = role ? sanitizePermissions(role.permissions) : [];
      const next: SessionCustomRole | null =
        role && permissions.length > 0
          ? { id: role.id, name: role.name, permissions }
          : null;
      const currentRole = current.tenant.customRole ?? null;
      // Identitas sama → jangan memicu render ulang; efek store bisa berjalan
      // berkali-kali dan pembaruan sesi tanpa perubahan akan jadi gelung.
      if (
        (currentRole === null && next === null) ||
        (currentRole !== null &&
          next !== null &&
          currentRole.id === next.id &&
          currentRole.name === next.name &&
          [...currentRole.permissions].sort().join(",") ===
            [...next.permissions].sort().join(","))
      ) {
        return current;
      }
      return { ...current, tenant: { ...current.tenant, customRole: next } };
    });
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
    setReady(true);
  }, []);

  const setRole = useCallback((role: Role) => {
    setSession((current) =>
      current?.tenant ? { ...current, tenant: { ...current.tenant, role } } : current,
    );
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      ready,
      signInWithOtp,
      createTenant,
      adoptWorkspace,
      setVerticals,
      setPlan,
      setTaxSetting,
      setFnbTaxProfile,
      setReceiptSetting,
      setLogoUrl,
      setCustomRole,
      signOut,
      setRole,
    }),
    [
      session,
      ready,
      signInWithOtp,
      createTenant,
      adoptWorkspace,
      setVerticals,
      setPlan,
      setTaxSetting,
      setFnbTaxProfile,
      setReceiptSetting,
      setLogoUrl,
      setCustomRole,
      signOut,
      setRole,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession harus dipakai di dalam <SessionProvider>.");
  }
  return ctx;
}

/** The acting role for the current tenant; an owner-less session is an owner. */
export function actingRole(session: Session | null): Role {
  return session?.tenant?.role ?? "owner";
}

/**
 * Izin efektif pengguna aktif: peran kustom (kalau ada) **menggantikan** peran
 * bawaan — aturan yang sama dengan backend (`effectivePermissions`).
 *
 * Sesi **tanpa tenant tidak punya izin sama sekali** — bukan izin pemilik.
 * Sesi seperti itu memang ada di kehidupan nyata: perangkat yang baru masuk
 * belum tahu workspace mana miliknya, dan halaman di bawah `/app` baru dirender
 * setelah `RequireTenant` memastikan tenant-nya ada. Membacanya sebagai pemilik
 * membuat klien membuka hal-hal yang server tolak — persis penyebab halaman
 * “gagal dimuat” saat kasir yang diundang masuk di perangkat baru (lihat
 * `ConvexStoreProvider`).
 */
export function actingPermissions(session: Session | null): Permission[] {
  const tenant = session?.tenant;
  if (!tenant) return [];
  return effectivePermissions(
    tenant.role,
    tenant.customRole?.permissions ?? null,
  );
}

/**
 * Route gate for a permission. Nav hiding alone is not a gate — a typed URL
 * would bypass it — so every permission-sensitive route renders through this.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { session, ready } = useSession();

  if (!ready) return <SessionLoading />;
  const role = actingRole(session);
  const permissions = actingPermissions(session);
  if (permissions.includes(permission)) return <>{children}</>;

  return (
    <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-6 text-center">
      <div className="text-sm font-semibold">Akses ditolak</div>
      <p className="mt-2 text-sm text-muted-foreground">
        {session?.tenant?.customRole
          ? `Peran kustom ${session.tenant.customRole.name} tidak memiliki izin untuk halaman ini.`
          : `Peran ${ROLE_LABELS[role]} tidak memiliki izin untuk halaman ini.`}
      </p>
      <Link
        to="/app"
        className="mt-4 inline-block text-sm text-primary hover:underline"
      >
        Kembali ke dashboard
      </Link>
    </div>
  );
}

function SessionLoading() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        Memuat sesi…
      </div>
    </div>
  );
}

/**
 * Gate for everything under /app. Signed-out visitors are sent to /auth with
 * the path they wanted, so a successful sign-in returns them there.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, ready } = useSession();
  const location = useLocation();

  if (!ready) return <SessionLoading />;
  if (!session) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate to={`/auth?returnTo=${encodeURIComponent(returnTo)}`} replace />
    );
  }
  return <>{children}</>;
}

/**
 * Requires a signed-in user with a tenant; otherwise routes to onboarding.
 *
 * Halaman yang dituju ikut dibawa (`returnTo`): akun yang masuk di perangkat baru
 * melewati onboarding sebentar untuk memulihkan workspace-nya, dan setelah pulih
 * ia harus mendarat di halaman yang tadi dibuka — bukan dilempar ke dashboard.
 */
export function RequireTenant({ children }: { children: ReactNode }) {
  const { session, ready } = useSession();
  const location = useLocation();

  if (!ready) return <SessionLoading />;
  if (!session) {
    return <Navigate to="/auth?returnTo=/onboarding" replace />;
  }
  if (!session.tenant) {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate to={`/onboarding?returnTo=${encodeURIComponent(returnTo)}`} replace />
    );
  }
  return <>{children}</>;
}

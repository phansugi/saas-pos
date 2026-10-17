import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { NavLink, Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  BookOpen,
  Boxes,
  ChefHat,
  ClipboardCheck,
  CreditCard,
  HandCoins,
  IdCard,
  LayoutGrid,
  LogOut,
  LifeBuoy,
  Menu,
  Plug,
  Puzzle,
  QrCode,
  Radio,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
  UserRound,
  Wallet,
  Warehouse,
  X,
} from "lucide-react";
import { FullscreenToggle } from "@/components/FullscreenToggle";
import { ProvisioningNotice } from "@/components/ProvisioningNotice";
import { NewVersionNotice } from "@/components/NewVersionNotice";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isRole, ROLE_LABELS, ROLES, type Permission } from "@/lib/authz";
import {
  sidebarBackdropClass,
  sidebarClass,
  sidebarMenuButtonClass,
  sidebarMenuHint,
  sidebarMenuLabel,
} from "@/lib/sidebarMenu";
import { useFullscreen } from "@/lib/useFullscreen";
import { getPlan, VERTICAL_LABELS, type FeatureKey } from "@/lib/billing";
import { useSession } from "@/lib/session";
import { useStore } from "@/lib/store";
import { moduleFeatureEnabled } from "@/lib/store/modules";
import { useCan } from "@/lib/usePermission";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end: boolean;
  /**
   * Izin yang sama dengan gerbang rutenya — satu kebijakan, dua pemakaian.
   * **Kosong** untuk halaman yang boleh dibuka semua anggota (Profil): isinya
   * profil orang yang sedang masuk, jadi tidak ada izin peran yang bisa
   * dipakai. Rutenya pun tanpa `RequirePermission`, dan harness menu
   * membandingkan keduanya apa adanya.
   */
  permission?: Permission;
  /**
   * Fitur modul yang harus hidup (Phase 2). Halaman tetap memeriksa hal yang
   * sama, jadi menyembunyikan menu bukan pengganti gerbang.
   */
  feature?: FeatureKey;
  /**
   * Menu tetap tampil walau fitur modulnya mati kalau masih ada data
   * tertinggal — piutang (nota belum ditagih) dan member (data yang perlu
   * dirapikan). Server mengizinkan keduanya, jadi menunya tidak boleh hilang.
   */
  showWithPendingData?: "receivables" | "members";
}

const nav: NavItem[] = [
  { to: "/app", label: "Dashboard", icon: LayoutGrid, end: true, permission: "report.view" },
  { to: "/app/pos", label: "Kasir (POS)", icon: ShoppingCart, end: false, permission: "pos.sell" },
  {
    // Dapur punya izinnya sendiri (`kds.manage`): peran “dapur saja” tidak
    // perlu bisa menjual, dan kasir yang memang bekerja di antrean tetap bisa.
    to: "/app/kds",
    label: "Dapur & Meja",
    icon: ChefHat,
    end: false,
    permission: "kds.manage",
    feature: "pos.kds",
  },
  {
    // Shift & kas (`shift.manage`) juga berdiri sendiri. Perlu diketahui
    // merchant: penjualan menuntut shift terbuka, jadi peran yang menjual harus
    // memegang `pos.sell` + `shift.manage` (peran bawaan Kasir & Manajer sudah).
    to: "/app/shift",
    label: "Shift & Kas",
    icon: Wallet,
    end: false,
    permission: "shift.manage",
  },
  { to: "/app/products", label: "Produk & Stok", icon: Boxes, end: false, permission: "stock.adjust" },
  {
    // Gudang & Stok (Phase 3). Menu tampil selama perannya bekerja dengan stok;
    // halaman tetap menjelaskan sendiri saat paketnya tidak memuat gudang
    // tambahan, karena stok yang sudah ada harus tetap bisa dipindahkan.
    to: "/app/inventory",
    label: "Gudang & Stok",
    icon: Warehouse,
    end: false,
    permission: "inventory.view",
  },
  {
    // Stock opname (Phase 3). Tanpa gerbang fitur: sesi yang sudah berjalan
    // harus tetap bisa diselesaikan walau paketnya tidak lagi memuat
    // `inventory.opname`.
    to: "/app/opname",
    label: "Opname",
    icon: ClipboardCheck,
    end: false,
    permission: "inventory.view",
  },
  {
    to: "/app/receivables",
    label: "Piutang",
    icon: HandCoins,
    end: false,
    permission: "ar.view",
    feature: "ar.creditlimit",
    showWithPendingData: "receivables",
  },
  {
    to: "/app/members",
    label: "Member",
    icon: IdCard,
    end: false,
    permission: "member.view",
    feature: "member.discount",
    showWithPendingData: "members",
  },  {
    // Pembelian (Phase 3). Menu tampil selama perannya melihat dokumen
    // pembelian; halaman menjelaskan sendiri saat paketnya tidak memuat PR/PO
    // baru, karena penerimaan barang tetap harus bisa dicatat.
    to: "/app/purchasing",
    label: "Pembelian",
    icon: Truck,
    end: false,
    permission: "purchase.view",
  },  { to: "/app/reports", label: "Laporan", icon: BarChart3, end: false, permission: "report.view" },
  {
    // Pembayaran digital (`payment.digital`, Phase 6). Tanpa gerbang fitur:
    // tagihan yang sudah beredar harus tetap bisa dilunasi & dibatalkan walau
    // paketnya tidak lagi memuat kanal tagih digitalnya.
    to: "/app/payments",
    label: "Pembayaran",
    icon: QrCode,
    end: false,
    permission: "payment.view",
  },
  {
    // Tim & Peran (`rbac.custom`, Phase 4). Tanpa gerbang fitur: peran kustom
    // yang sudah ada harus tetap bisa dilihat & anggotanya dikembalikan ke
    // peran bawaan walau paketnya tidak lagi memuat fiturnya.
    to: "/app/team",
    label: "Tim & Peran",
    icon: ShieldCheck,
    end: false,
    permission: "team.manage",
  },
  {
    // API & Webhook (`api.access`, Phase 4). Tanpa gerbang fitur: kunci dan
    // endpoint yang sudah ada harus tetap bisa dilihat & dicabut walau paketnya
    // tidak lagi memuat `api.access`.
    to: "/app/api",
    label: "API & Webhook",
    icon: Plug,
    end: false,
    permission: "api.manage",
  },
  {
    // Dukungan khusus (`support.dedicated`, Phase 5). Tanpa gerbang fitur:
    // tiket yang sudah berjalan harus tetap bisa dilihat & ditutup walau paketnya
    // tidak lagi memuat jalur cepatnya — yang ditolak server hanya membuka
    // prioritas Tinggi/Mendesak dan eskalasi.
    to: "/app/support",
    label: "Dukungan",
    icon: LifeBuoy,
    end: false,
    permission: "support.view",
  },
  {
    // Sinkronisasi real-time (`sync.realtime`, Phase 6). Tanpa gerbang fitur:
    // kehadiran perangkat, kursor, dan konflik yang sudah terbuka harus tetap
    // bisa dilihat & dibereskan walau paketnya berubah.
    to: "/app/sync",
    label: "Sinkronisasi",
    icon: Radio,
    end: false,
    permission: "device.manage",
  },
  {
    // Panduan operasional. Izinnya `report.view` - sama dengan Dashboard -
    // supaya kasir dan staf gudang juga bisa membacanya, karena merekalah yang
    // paling sering mengisi stok.
    to: "/app/panduan",
    label: "Panduan",
    icon: BookOpen,
    end: false,
    permission: "report.view",
  },
  { to: "/app/modules", label: "Modul", icon: Puzzle, end: false, permission: "billing.manage" },
  {
    // Pengaturan workspace (PPN). Izinnya `billing.manage` — sama dengan
    // langganan — karena setelannya adalah setelan uang: ia mengubah angka di
    // setiap struk dan di tagihan langganan workspace ini.
    to: "/app/settings",
    label: "Pengaturan",
    icon: Settings,
    end: false,
    permission: "billing.manage",
  },
  { to: "/app/subscription", label: "Langganan", icon: CreditCard, end: false, permission: "billing.manage" },
  {
    // Profil: nama & nomor WA pengguna, identitas usaha, dan tombol keluar.
    // Tanpa izin — setiap peran berhak memperbaiki namanya sendiri. Kartu
    // **profil usaha** di dalamnya yang dijaga `billing.manage` (ditawarkan
    // klien, ditegakkan `tenants.updateProfile` di server).
    to: "/app/profil",
    label: "Profil",
    icon: UserRound,
    end: false,
  },
];

export function AppLayout() {
  const { session, signOut, setRole } = useSession();
  // `error` adalah kegagalan menyambungkan workspace ke server. Ia ditampilkan
  // di sini, bukan di satu halaman saja: tanpa itu setiap aksi di semua halaman
  // hanya menjawab “Tenant belum siap” tanpa pernah menyebut sebabnya.
  const { source, modules, arSummary, members, error, logo } = useStore();
  const navigate = useNavigate();
  const can = useCan();
  const tenant = session?.tenant ?? null;

  // A hidden link is not a gate — the route re-checks the same permission — but
  // showing a cashier a menu they cannot open is worse UX than hiding it. Menu
  // modul (Dapur & Meja) hanya muncul saat modul pemiliknya benar-benar hidup.
  const planKey = session?.tenant?.planKey ?? "starter";
  const visibleNav = useMemo(
    () =>
      nav.filter((item) => {
        // Menu tanpa izin (Profil) tampil untuk semua anggota; sisanya mengikuti
        // izin peran — halaman yang dibuka tetap memeriksa hal yang sama.
        if (item.permission && !can(item.permission)) return false;
        if (!item.feature) return true;
        if (moduleFeatureEnabled(planKey, modules.activeVerticals, item.feature)) {
          return true;
        }
        if (!item.showWithPendingData) return false;
        return item.showWithPendingData === "receivables"
          ? arSummary.openCount > 0
          : members.length > 0;
      }),
    [can, modules.activeVerticals, planKey, arSummary.openCount, members.length],
  );

  const trialDaysLeft = useMemo(() => {
    if (!tenant) return null;
    const ms = new Date(tenant.trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  }, [tenant]);

  const handleSignOut = () => {
    signOut();
    navigate("/", { replace: true });
  };

  /**
   * Mode layar penuh: sidebar disembunyikan, header tetap ada. Nilai ini dipakai
   * **dua** tempat — sidebar dan tombolnya — karena itu state-nya satu, dari
   * `useFullscreen` (lihat `@/lib/fullscreen` untuk aturannya).
   */
  const { active: fullscreen, toggle: toggleFullscreen } = useFullscreen();

  /**
   * Panel menu (burger) di header: satu state untuk dua sebab yang sama —
   * layar kecil (sidebar statiknya tidak tampil di bawah `lg`) dan mode layar
   * penuh (sidebar statiknya sengaja dimatikan). Aturannya di `@/lib/sidebarMenu`.
   */
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  /**
   * Pindah halaman selalu menutup panelnya. Menu yang tetap terbuka setelah
   * navigasi menutupi justru halaman yang baru dibuka — termasuk saat pindahnya
   * bukan dari menu (mis. tombol “Kelola langganan” di dalam sidebar).
   */
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  /**
   * Esc menutup panelnya. Pemakai ponsel tidak punya tombol itu, tetapi papan
   * tombol di desktop ada — dan tanpa ini panelnya hanya bisa ditutup dengan
   * mengklik latarnya.
   */
  useEffect(() => {
    if (!menuOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  const handleFullscreenToggle = useCallback(() => {
    // Layar penuh = layar jual yang memakai seluruh lebar: panelnya ditutup dulu
    // supaya tidak menutupi halaman yang baru diperbesar.
    setMenuOpen(false);
    toggleFullscreen();
  }, [toggleFullscreen]);

  return (
    /*
      Shell-nya sendiri yang setinggi layar dan **tidak** bergulir; hanya kolom
      isi (`main`) yang punya gulirannya sendiri. Jadi header dan sidebar tidak
      ikut bergerak saat halaman digulir **bukan** karena `sticky`, melainkan
      karena keduanya memang berada di luar satu-satunya area gulir — tidak ada
      cara keduanya ikut terangkat, di browser mana pun.

      Tingginya dari kelas `app-shell-height` (`src/index.css`): 100vh sebagai
      cadangan, diganti `100dvh` di browser yang mendukung — sebab `100vh` selalu
      memakai tinggi layar *terbesar*, sehingga di ponsel bagian bawah shell
      tertutup bilah alamat yang sedang tampil.
    */
    <div className="app-shell-height flex overflow-hidden bg-background">
      {/*
        Latar penutup saat panel menu terbuka: menekan di sini menutup panelnya,
        sama seperti memilih satu menu. Tidak ikut dirender saat panelnya tertutup
        supaya halaman tidak pernah tertutup lapisan yang tak terlihat.
      */}
      {menuOpen && (
        <div
          data-testid="sidebar-backdrop"
          aria-hidden="true"
          onClick={closeMenu}
          className={sidebarBackdropClass(fullscreen)}
        />
      )}
      <aside
        id="app-sidebar"
        data-testid="app-sidebar"
        className={cn(
          "sidebar-surface w-64 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border p-4 text-sidebar-foreground",
          // Sengaja bercabang, bukan menumpuk `lg:flex` + `lg:hidden` — dua kelas
          // display di layer yang sama membuat pemenangnya bergantung urutan CSS,
          // bukan urutan penulisannya. Aturannya satu tempat di
          // `@/lib/sidebarMenu` (statik / panel melayang / sembunyi).
          sidebarClass({ fullscreen, open: menuOpen }),
        )}
      >
        <Link to="/" onClick={closeMenu} className="flex items-center gap-2.5 px-2 py-2">
          {/*
            Penanda workspace: **logo toko** kalau sudah diunggah (Pengaturan →
            Struk belanja), dan ikon bawaan kalau belum. Logonya diberi alas putih,
            bukan dibiarkan tembus pandang di atas sidebar gelap: logo toko digambar
            untuk kertas struk yang putih, dan logo berwarna gelap akan hilang di
            sini. Kasir melihat identitas yang sama dengan yang tercetak di struknya.
          */}
          {logo ? (
            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/95 p-1">
              <img
                src={logo.url}
                alt={`Logo ${tenant?.name ?? "workspace"}`}
                data-testid="sidebar-logo"
                className="max-h-full max-w-full object-contain"
              />
            </span>
          ) : (
            <span
              data-testid="sidebar-logo-kosong"
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-sidebar-active/15 text-sidebar-active"
            >
              <Store className="size-5" />
            </span>
          )}
          <span className="text-base font-bold tracking-tight">
            Mesin<span className="text-sidebar-active">POS</span>
          </span>
        </Link>

        <nav className="mt-6 space-y-1">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              // Panel menu (di layar kecil) ikut tertutup begitu menu dipilih,
              // supaya halaman tujuan langsung terbaca penuh.
              onClick={closeMenu}
              className={({ isActive }) =>
                cn(
                  "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-active/15 text-sidebar-active before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-sidebar-active"
                    : "text-sidebar-muted hover:bg-sidebar-active/10 hover:text-sidebar-foreground",
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto rounded-lg border border-sidebar-border bg-sidebar-deep/70 p-3">
          <div className="text-xs text-sidebar-muted">Paket aktif</div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-sm font-semibold">
              {tenant ? getPlan(tenant.planKey).name : "—"}
            </span>
            {trialDaysLeft !== null && (
              <Badge variant="outline" className="border-sidebar-border text-sidebar-muted">
                {trialDaysLeft > 0 ? `Trial ${trialDaysLeft}h` : "Trial berakhir"}
              </Badge>
            )}
          </div>
          {tenant && (
            <div className="mt-1 text-xs text-sidebar-muted">
              {modules.active.length > 0
                ? `Modul: ${modules.active.map((m) => m.name).join(" · ")}`
                : `Modul: ${VERTICAL_LABELS[tenant.vertical]}`}
            </div>
          )}
          {can("billing.manage") && (
            <Link
              to="/app/subscription"
              onClick={closeMenu}
              className="mt-2 block text-xs text-sidebar-active hover:underline"
            >
              Kelola langganan →
            </Link>
          )}
          {source === "demo" && tenant && (
            <label className="mt-3 flex items-center justify-between gap-2 text-xs text-sidebar-muted">
              Peran
              <select
                value={tenant.role ?? ""}
                onChange={(e) => {
                  if (isRole(e.target.value)) setRole(e.target.value);
                }}
                aria-label="Ganti peran (demo)"
                className="rounded border border-sidebar-border bg-sidebar-deep px-1.5 py-1 text-xs text-sidebar-foreground"
              >
                {/* Anggota berperan tambahan tidak punya peran bawaan yang bisa dipilih. */}
                {tenant.role === null && (
                  <option value="">peran tambahan</option>
                )}
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          `relative z-40`: saat panel menu terbuka, latar penutupnya (`z-30`)
          menutupi seluruh layar — termasuk di belakang header ini. Header-nya
          sengaja berada **di atas** latar itu supaya tombol menunya tetap bisa
          diklik; `h-16`-nya juga yang jadi acuan `top-16` panelnya, jadi panel
          tidak pernah menutupi tombol yang membukanya (lihat `@/lib/sidebarMenu`).
        */}
        <header className="glass relative z-40 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-1">
            {/*
              Tombol menu (burger) — paling kiri di header, di depan nama
              workspace. Muncul di layar kecil (sidebar statiknya tidak tampil di
              bawah `lg`) dan di mode layar penuh (sidebar statiknya dimatikan);
              kelasnya datang dari `@/lib/sidebarMenu` supaya kedua sebab itu
              tidak pernah dijawab berbeda oleh header dan sidebar.
            */}
            <button
              type="button"
              data-testid="sidebar-menu-button"
              aria-label={sidebarMenuLabel(menuOpen)}
              aria-expanded={menuOpen}
              aria-controls="app-sidebar"
              title={sidebarMenuHint(menuOpen)}
              onClick={() => setMenuOpen((open) => !open)}
              className={cn(
                "-ml-1 size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/40 hover:text-foreground",
                sidebarMenuButtonClass(fullscreen),
              )}
            >
              {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">
                {tenant?.name ?? "Workspace"}
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {tenant?.storeName ?? "—"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/*
              Penanda **sumber data**, bukan status langganan: hijau berarti
              angka di layar datang dari server aplikasi (`VITE_DATA_SOURCE=convex`
              + `VITE_CONVEX_URL`), sedangkan kuning berarti belum tersambung dan
              yang tampil adalah data contoh di perangkat. Namanya sengaja tidak
              menyebut merek backend — yang perlu diketahui pengguna hanya
              “tersambung ke server atau tidak”. `title` menjelaskannya bagi yang
              belum tahu arti warnanya.
            */}
            <Badge
              data-testid="data-source-badge"
              variant="secondary"
              className="hidden gap-1.5 sm:inline-flex"
              title={
                source === "convex"
                  ? "Data dibaca dan disimpan ke server aplikasi, jadi angka ini data sungguhan workspace Anda."
                  : "Belum tersambung ke server: yang tampil adalah data contoh di perangkat ini."
              }
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  source === "convex" ? "bg-primary" : "bg-accent",
                )}
              />
              {source === "convex" ? "Terhubung ke server" : "Data demo"}
            </Badge>
            {/*
              Layar penuh: sidebar disembunyikan supaya layar jual (kasir, dapur)
              memakai seluruh lebar. Header tetap ada — di situlah tombol keluarnya.
            */}
            <FullscreenToggle active={fullscreen} onToggle={handleFullscreenToggle} />
            {/* Tema tersedia di mana saja, bukan hanya di beranda publik. */}
            <ThemeToggle />
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Keluar</span>
            </button>
          </div>
        </header>

        <ProvisioningNotice error={error} />

        {/*
          Bundel yang sudah berganti versi tapi masih dijalankan tab ini: SPA
          hanya berpindah lewat muat ulang, jadi pengguna perlu diberi tahu —
          lihat `src/lib/bundleVersion.ts`.
        */}
        <NewVersionNotice />

        {/*
          Satu-satunya area gulir di backstage. `overflow-x-hidden` tetap ada
          supaya tabel lebar tidak membuat halaman melebar. `relative` bukan
          hiasan: ia menjadikan kolom isi **acuan posisi** bagi elemen `absolute`
          di dalam halaman. Tanpa itu, elemen absolut yang tidak punya leluhur
          ber-posisi — terutama `.sr-only` (teks pembaca layar, mis. `<caption>`
          tabel) — punya containing block di luar area gulir ini, sehingga klip
          `overflow` di sini **tidak berlaku** untuk mereka: tinggi dokumen ikut
          memanjang dan seluruh shell (sidebar + header) jadi bisa digulir ke
          atas. Dengan `relative`, elemen-elemen itu ikut terklip di sini seperti
          isi halaman yang lain (lihat `verify-browser-scroll.mjs`).
        */}
        <main className="relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

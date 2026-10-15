import { Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LandingPage } from "@/pages/LandingPage";
import { AuthPage } from "@/pages/AuthPage";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { AppLayout } from "@/layouts/AppLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { PosPage } from "@/pages/PosPage";
import { KdsPage } from "@/pages/KdsPage";
import { ReceivablesPage } from "@/pages/ReceivablesPage";
import { MembersPage } from "@/pages/MembersPage";
import { InventoryPage } from "@/pages/InventoryPage";
import { OpnamePage } from "@/pages/OpnamePage";
import { PurchasingPage } from "@/pages/PurchasingPage";
import { ProductsPage } from "@/pages/ProductsPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { ModulesPage } from "@/pages/ModulesPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TeamPage } from "@/pages/TeamPage";
import { ApiPage } from "@/pages/ApiPage";
import { SupportPage } from "@/pages/SupportPage";
import { PanduanPage } from "@/pages/PanduanPage";
import { MejaPage } from "@/pages/MejaPage";
import { PaymentsPage } from "@/pages/PaymentsPage";
import { SyncPage } from "@/pages/SyncPage";
import { ShiftPage } from "@/pages/ShiftPage";
import { SubscriptionPage } from "@/pages/SubscriptionPage";
import { PlatformPage } from "@/pages/PlatformPage";
import {
  RequireAuth,
  RequirePermission,
  RequireTenant,
  SessionProvider,
} from "@/lib/session";
import { BackendProvider, StoreProvider } from "@/lib/store";
import { InstallPrompt, InstallProvider } from "@/components/InstallPrompt";

export function App() {
  return (
    /*
      Boundary berada di luar semua provider: kalau salah satu provider (sesi,
      Convex, store) yang melempar, halamannya tetap menampilkan pesan yang
      bisa dibaca, bukan layar putih tanpa petunjuk.
    */
    <ErrorBoundary>
      <SessionProvider>
        <BackendProvider>
          <StoreProvider>
            {/*
              Pemasangan PWA punya satu pemilik keadaan untuk seluruh aplikasi:
              banner ajakan 10 detik dan tombol di header membacanya dari sini,
              supaya tidak ada dua yang berebut janji pemasangan dari browser.
            */}
            <InstallProvider>
            <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/auth" element={<AuthPage />} />
            {/*
              Halaman menu tamu: **publik dan tanpa sesi**. Isinya ditentukan
              token kode QR yang ditempel di meja (`mj_…`), dan yang bisa
              dilakukannya hanya membaca menu satu meja itu serta memesan dari
              situ — lihat `src/convex/meja.ts`.
            */}
            <Route path="/meja/:token" element={<MejaPage />} />
            <Route
              path="/onboarding"
              element={
                <RequireAuth>
                  <OnboardingPage />
                </RequireAuth>
              }
            />

            {/*
              Backstage platform: di luar `/app` dan **tanpa** `RequireTenant`,
              karena akun platform tidak punya keanggotaan di tenant orang lain.
              Sengaja juga tanpa tautan di menu: keberadaannya tidak boleh bisa
              ditemukan dari dalam tenant, jadi jalan masuknya hanya alamat ini.
              Workspace miliknya sendiri tetap dibuka lewat `/app` — tautannya ada
              di halaman ini. Gerbang sesungguhnya ada di server
              (`requirePlatformDeveloper`).
            */}
            <Route
              path="/platform"
              element={
                <RequireAuth>
                  <PlatformPage />
                </RequireAuth>
              }
            />

            <Route
              path="/app"
              element={
                <RequireAuth>
                  <RequireTenant>
                    <AppLayout />
                  </RequireTenant>
                </RequireAuth>
              }
            >
              {/*
                Every route re-checks the permission its nav item is gated on,
                so typing the URL cannot bypass the role.
              */}
              <Route
                index
                element={
                  <RequirePermission permission="report.view">
                    <DashboardPage />
                  </RequirePermission>
                }
              />
              <Route
                path="pos"
                element={
                  <RequirePermission permission="pos.sell">
                    <PosPage />
                  </RequirePermission>
                }
              />
              <Route
                path="kds"
                element={
                  /* Layar dapur: izin kasir, dan server tetap menolak tenant yang
                     modul F&B-nya mati. */
                  <RequirePermission permission="pos.sell">
                    <KdsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="shift"
                element={
                  <RequirePermission permission="pos.sell">
                    <ShiftPage />
                  </RequirePermission>
                }
              />
              <Route
                path="receivables"
                element={
                  /* Piutang B2B (modul Grosir): kasir boleh melihat sisa limit,
                     tetapi server tetap memeriksa izin `ar.view` per peran. */
                  <RequirePermission permission="ar.view">
                    <ReceivablesPage />
                  </RequirePermission>
                }
              />
              <Route
                path="members"
                element={
                  /* Member & diskon (modul UMKM): kasir boleh melihat daftarnya,
                     tetapi server tetap memeriksa izin `member.view` per peran. */
                  <RequirePermission permission="member.view">
                    <MembersPage />
                  </RequirePermission>
                }
              />
              <Route
                path="products"
                element={
                  <RequirePermission permission="stock.adjust">
                    <ProductsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="inventory"
                element={
                  /* Gudang & stok per lokasi (Phase 3): izin `inventory.view`
                     per peran, dan server tetap menolak penambahan gudang di
                     luar paket/fitur `inventory.multiwarehouse`. */
                  <RequirePermission permission="inventory.view">
                    <InventoryPage />
                  </RequirePermission>
                }
              />
              <Route
                path="opname"
                element={
                  /* Stock opname (Phase 3): izin `inventory.view` untuk melihat,
                     `inventory.manage` untuk menghitung & memposting, dan
                     server tetap menolak sesi baru di luar fitur
                     `inventory.opname`. */
                  <RequirePermission permission="inventory.view">
                    <OpnamePage />
                  </RequirePermission>
                }
              />
              <Route
                path="purchasing"
                element={
                  /* Pembelian (Phase 3): izin `purchase.view`. Setiap tombol di
                     halaman memakai izin yang lebih sempit lagi (request /
                     approve / receive), dan server memeriksa ulang. */
                  <RequirePermission permission="purchase.view">
                    <PurchasingPage />
                  </RequirePermission>
                }
              />
              <Route
                path="reports"
                element={
                  <RequirePermission permission="report.view">
                    <ReportsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="team"
                element={
                  /* Tim & Peran (`rbac.custom`, Phase 4): izin `team.manage`,
                     dan server tetap menolak pembuatan/penugasan peran di luar
                     paket yang memuat fiturnya. */
                  <RequirePermission permission="team.manage">
                    <TeamPage />
                  </RequirePermission>
                }
              />
              <Route
                path="api"
                element={
                  /* API & Webhook (`api.access`, Phase 4): izin `api.manage`.
                     Halaman tetap boleh dibuka tanpa fiturnya supaya kunci &
                     endpoint lama bisa dicabut — yang ditolak server adalah
                     membuat yang baru. */
                  <RequirePermission permission="api.manage">
                    <ApiPage />
                  </RequirePermission>
                }
              />
              <Route
                path="support"
                element={
                  /* Dukungan khusus (`support.dedicated`, Phase 5): izin
                     `support.view` untuk melihat tiket & SLA, `support.manage`
                     untuk mengubahnya. Halaman tetap boleh dibuka tanpa fiturnya
                     supaya tiket lama bisa ditutup — yang ditolak server adalah
                     prioritas jalur cepat & eskalasi. */
                  <RequirePermission permission="support.view">
                    <SupportPage />
                  </RequirePermission>
                }
              />
              <Route
                path="payments"
                element={
                  /* Pembayaran digital (`payment.digital`, Phase 6): izin
                     `payment.view` untuk melihat, `payment.manage` untuk
                     menagih & melunasi. Halaman tetap boleh dibuka tanpa
                     fiturnya supaya tagihan lama bisa dilunasi & dibatalkan —
                     yang ditolak server adalah membuat tagihan baru. */
                  <RequirePermission permission="payment.view">
                    <PaymentsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="sync"
                element={
                  /* Sinkronisasi real-time (`sync.realtime`, Phase 6): izin
                     `device.manage`. Hub tetap bisa dibuka tanpa fiturnya
                     supaya detak, menarik, dan membereskan konflik lama tetap
                     jalan. */
                  <RequirePermission permission="device.manage">
                    <SyncPage />
                  </RequirePermission>
                }
              />
              <Route
                path="panduan"
                element={
                  /* Panduan operasional: izinnya sama dengan menu yang sudah
                     dibuka semua peran (`report.view`), karena cara mengisi stok
                     dibutuhkan kasir dan staf gudang sama seperti pemilik. */
                  <RequirePermission permission="report.view">
                    <PanduanPage />
                  </RequirePermission>
                }
              />
              <Route
                path="modules"
                element={
                  /* Modul plug-in menentukan fitur mana yang hidup, jadi gerbangnya
                     sama dengan langganan: yang boleh mengubah tagihan. */
                  <RequirePermission permission="billing.manage">
                    <ModulesPage />
                  </RequirePermission>
                }
              />
              <Route
                path="settings"
                element={
                  /* Pengaturan workspace (PPN): setelannya mengubah angka di
                     setiap struk dan di tagihan langganan, jadi gerbangnya sama
                     dengan pengelola tagihan. */
                  <RequirePermission permission="billing.manage">
                    <SettingsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="subscription"
                element={
                  <RequirePermission permission="billing.manage">
                    <SubscriptionPage />
                  </RequirePermission>
                }
              />
            </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
              {/* Ajakan hanya muncul sekali; tombolnya tinggal di header. */}
              <InstallPrompt />
            </InstallProvider>
          </StoreProvider>
        </BackendProvider>
      </SessionProvider>
    </ErrorBoundary>
  );
}

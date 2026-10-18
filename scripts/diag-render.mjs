/**
 * Diagnostik layar putih: merender aplikasi tanpa browser memakai SSR Vite.
 *
 * Vite memuat modul aplikasi persis seperti di browser (alias `@/`, TSX,
 * Tailwind tidak relevan di sini), lalu rute yang diminta dirender ke HTML.
 * Kalau ada `throw` saat render (mis. membaca properti dari `undefined`),
 * galatnya muncul di sini — dengan pesan asli dari komponennya.
 *
 * Efek samping tak dijalankan pada render server, jadi yang diuji adalah
 * render awal: komponen, hook, dan provider. Bukan pengganti uji browser, tapi
 * cukup untuk memisahkan "layar putih karena render gagal" dari penyebab lain.
 *
 * Usage: bun scripts/diag-render.mjs [/] [/app/modules]
 */
// Diagnostik ini memeriksa render **data demo**, apa pun isi `.env.local` mesin ini
// (harness DOM tiruan memakai aturan yang sama, lihat `./happy-dom-setup.mjs`).
process.env.VITE_DATA_SOURCE = "demo";

import { createServer } from "vite";
// React dimuat sebagai impor biasa (bukan lewat ssrLoadModule): di SSR Vite
// mengeksternal node_modules, jadi instansinya sama dengan yang dipakai
// komponen aplikasi — dan berkas CJS seperti ini gagal kalau di-inline.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

const routes = process.argv.slice(2);
const entries = routes.length > 0 ? routes : ["/"];

/**
 * DIAG_SESSION=1 memasang sesi tiruan di "localStorage". Tanpa ini,
 * `readStoredSession()` selalu null saat render server, sehingga rute
 * terautentikasi berhenti di "Memuat sesi…" dan tidak pernah diuji.
 */
if (process.env.DIAG_SESSION === "1") {
  const store = new Map();
  store.set(
    "mesinpos.session.v1",
    JSON.stringify({
      user: { name: "Uji Diagnostik", email: "diag@mesinpos.test" },
      tenant: {
        name: "Toko Diagnostik",
        slug: "toko-diagnostik",
        storeName: "Cabang Uji",
        vertical: "wholesale",
        verticals: ["umkm", "wholesale"],
        planKey: "professional",
        role: "owner",
        createdAt: new Date().toISOString(),
        trialEndsAt: new Date(Date.now() + 86400000).toISOString(),
      },
    }),
  );
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.localStorage = globalThis.window.localStorage;
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "warn",
});

let failed = 0;
try {
  const { App } = await server.ssrLoadModule("/src/App.tsx");

  // Mode halaman: rute di balik gerbang sesi tidak pernah sampai dirender di
  // SSR (efek tidak jalan, jadi `ready` tetap false), padahal justru halaman
  // itulah yang tampil setelah masuk. Jadi komponennya dirender langsung di
  // dalam susunan provider yang sama seperti di aplikasi.
  if (process.env.DIAG_PAGES === "1") {
    const { SessionProvider } = await server.ssrLoadModule("/src/lib/session.tsx");
    const { BackendProvider, StoreProvider } = await server.ssrLoadModule(
      "/src/lib/store/index.tsx",
    );
    const pages = [
      ["DashboardPage", "/src/pages/DashboardPage.tsx"],
      ["PosPage", "/src/pages/PosPage.tsx"],
      ["ShiftPage", "/src/pages/ShiftPage.tsx"],
      ["ProductsPage", "/src/pages/ProductsPage.tsx"],
      ["ReportsPage", "/src/pages/ReportsPage.tsx"],
      ["ModulesPage", "/src/pages/ModulesPage.tsx"],
      ["SubscriptionPage", "/src/pages/SubscriptionPage.tsx"],
      ["OnboardingPage", "/src/pages/OnboardingPage.tsx"],
    ];

    for (const [name, path] of pages) {
      try {
        const module = await server.ssrLoadModule(path);
        const Page = module[name];
        const html = renderToStaticMarkup(
          React.createElement(
            MemoryRouter,
            { initialEntries: ["/app"] },
            React.createElement(
              SessionProvider,
              null,
              React.createElement(
                BackendProvider,
                null,
                React.createElement(StoreProvider, null, React.createElement(Page, null)),
              ),
            ),
          ),
        );
        console.log(`DIAG halaman ${name} \u2713 panjang_html=${html.length}`);
      } catch (error) {
        failed += 1;
        console.log(`DIAG halaman ${name} \u2717 ${error?.message ?? String(error)}`);
        console.log(String(error?.stack ?? "").split("\n").slice(0, 6).join("\n"));
      }
    }
  }

  // Mode boundary: membuktikan ErrorBoundary benar-benar menangkap error
  // render dan menampilkan pesannya, bukan layar kosong.
  if (process.env.DIAG_BOUNDARY === "1") {
    const { ErrorBoundary } = await server.ssrLoadModule(
      "/src/components/ErrorBoundary.tsx",
    );
    function Boom() {
      throw new Error("kesalahan uji diagnostik");
    }
    try {
      const html = renderToStaticMarkup(
        React.createElement(
          ErrorBoundary,
          null,
          React.createElement(Boom, null),
        ),
      );
      const showsMessage = html.includes("gagal dimuat");
      const showsError = html.includes("kesalahan uji diagnostik");
      console.log(
        `DIAG boundary ${showsMessage && showsError ? "\u2713" : "\u2717"} panjang_html=${html.length} pesan=${showsMessage} error=${showsError}`,
      );
      if (!showsMessage || !showsError) failed += 1;
    } catch (error) {
      failed += 1;
      console.log(`DIAG boundary \u2717 error bocor: ${error?.message ?? String(error)}`);
    }
  }

  for (const route of entries) {
    try {
      const html = renderToStaticMarkup(
        React.createElement(
          MemoryRouter,
          { initialEntries: [route] },
          React.createElement(App),
        ),
      );
      const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      console.log(
        `DIAG render ${route} ✓ panjang_html=${html.length} teks="${text.slice(0, 90)}"`,
      );
    } catch (error) {
      failed += 1;
      console.log(`DIAG render ${route} ✗ ${error?.message ?? String(error)}`);
      console.log(String(error?.stack ?? "").split("\n").slice(0, 6).join("\n"));
    }
  }
} finally {
  await server.close();
}

if (failed > 0) process.exitCode = 1;

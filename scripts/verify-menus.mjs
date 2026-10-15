/**
 * Audit menu sidebar: **setiap menu** diuji terhadap **setiap peran**.
 *
 * Kenapa ada: `verify-render.mjs` membuktikan tiap *halaman* bisa dirender dan
 * `verify-authz.mjs` membuktikan tabel izinnya benar, tetapi keduanya tidak
 * pernah membuktikan hal yang paling mudah rusak diam-diam — dan yang paling
 * langsung terasa oleh pengguna:
 *
 *   1. menu yang menunjuk rute yang tidak ada, sehingga klik menuju halaman
     kosong,
 *   2. menu yang tampil untuk peran yang tidak berhak, atau hilang untuk peran
 *      yang berhak,
 *   3. rute `/app/*` yang lolos tanpa gerbang izin, sehingga URL yang diketik
 *      langsung membukanya walau menunya disembunyikan,
 *   4. menu yang bergantung modul plug-in tetapi tidak ikut hidup/mati.
 *
 * Yang diperiksa di sini: peta menu (nav di `AppLayout`) dicocokkan satu lawan
 * satu dengan peta rute di `App.tsx`, lalu tiap menu dirender **sebagai
 * aplikasi yang sesungguhnya** (router + provider asli, DOM tiruan happy-dom)
 * untuk kelima peran. Peran yang berhak harus mendapat halaman aslinya; peran
 * yang tidak berhak harus mendapat "Akses ditolak" walau URL diketik langsung.
 *
 * Usage: bun scripts/verify-menus.mjs
 */
import "./happy-dom-setup.mjs";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const window = globalThis.window;
const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router-dom");

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// Animasi framer-motion (beranda) dibatalkan saat pohonnya dilepas, dan
// happy-dom melaporkan pembatalan itu sebagai rejection tanpa penangkap.
// Membongkar render memang begitu — bukan kegagalan uji — jadi AbortError
// diabaikan; rejection lain tetap dilempar supaya tidak ada galat yang diam.
process.on("unhandledRejection", (reason) => {
  if (reason?.name === "AbortError") return;
  throw reason;
});

const errors = [];
const originalError = console.error;
console.error = (...args) => {
  errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  originalError(...args);
};
globalThis.reportError = (error) => {
  errors.push(`reportError: ${error?.message ?? String(error)}`);
};
window.reportError = globalThis.reportError;

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

let failure = null;

/**
 * Penanda halaman untuk tiap menu. Dipakai sebagai bukti bahwa yang terbuka
 * benar-benar halaman menu itu — bukan halaman lain yang kebetulan dirender.
 * Setiap menu wajib punya penanda, dan penandanya tidak boleh sama.
 */
const PAGE_MARKERS = {
  "/app": "Stok kritis",
  "/app/pos": "Keranjang kosong",
  "/app/kds": "Antrean dapur",
  "/app/shift": "Shift & Kas",
  "/app/products": "Atur harga",
  "/app/inventory": "Gudang & Stok",
  "/app/opname": "Stock Opname",
  "/app/receivables": "Piutang & Limit Kredit",
  "/app/members": "Member & Diskon",
  "/app/purchasing": "Pembelian",
  "/app/reports": "Omzet per metode bayar",
  "/app/payments": "Pembayaran digital",
  "/app/team": "Tim & Peran",
  "/app/api": "API & Webhook",
  "/app/support": "Prioritas",
  "/app/sync": "Sambungkan perangkat",
  "/app/panduan": "Panduan MesinPOS",
  "/app/modules": "Modul plug-in",
  "/app/settings": "Setelan PPN",
  "/app/subscription": "Pemakaian kuota",
  "/app/profil": "Profil saya",
};

/** Baca daftar menu dari sumber `AppLayout` — bukan dari salinan di harness. */
function parseNav(source) {
  const start = source.indexOf("const nav: NavItem[] = [");
  const end = source.indexOf("\n];", start);
  if (start < 0 || end < 0) throw new Error("blok `const nav` tidak ditemukan di AppLayout");
  return source
    .slice(start, end)
    .split(/(?=to:\s*")/)
    .slice(1)
    .map((part) => ({
      to: /to:\s*"([^"]+)"/.exec(part)?.[1] ?? null,
      label: /label:\s*"([^"]+)"/.exec(part)?.[1] ?? null,
      permission: /permission:\s*"([^"]+)"/.exec(part)?.[1] ?? null,
      feature: /feature:\s*"([^"]+)"/.exec(part)?.[1] ?? null,
    }));
}

/**
 * Baca peta rute anak `/app` dari sumber `App.tsx`.
 *
 * Rute **tanpa** `RequirePermission` ikut dibaca dengan `permission: null` —
 * memang ada satu (Profil: profil orangnya sendiri, boleh diperbaiki setiap
 * peran), dan justru itulah yang harus dibuktikan harness ini: menu dan rutenya
 * sama-sama tanpa izin, dan halamannya benar-benar terbuka untuk semua peran.
 */
function parseAppRoutes(source) {
  return source
    .split(/<Route\b/)
    .slice(1)
    .map((chunk) => {
      const permission = /permission="([^"]+)"/.exec(chunk)?.[1] ?? null;
      const path = /path="([^"]+)"/.exec(chunk)?.[1];
      if (!path) return /\bindex\b/.test(chunk) ? { to: "/app", permission } : null;
      // Rute tangkapan (`path="*"`) bukan halaman menu: ia hanya mengalihkan
      // alamat asing ke beranda.
      if (path === "*") return null;
      if (path.startsWith("/")) return null;
      return { to: `/app/${path}`, permission };
    })
    .filter(Boolean);
}

try {
  const { App } = await server.ssrLoadModule("/src/App.tsx");
  const { SessionProvider } = await server.ssrLoadModule("/src/lib/session.tsx");
  const { BackendProvider, StoreProvider } = await server.ssrLoadModule(
    "/src/lib/store/index.tsx",
  );
  const { ROLES, ROLE_LABELS } = await server.ssrLoadModule("/src/lib/authz.ts");
  const { effectivePermissions } = await server.ssrLoadModule("/src/lib/rbac.ts");
  const { moduleFeatureEnabled } = await server.ssrLoadModule(
    "/src/lib/store/modules.ts",
  );

  const ALL_MODULES = ["umkm", "fnb", "wholesale"];

  const menu = parseNav(
    readFileSync(new URL("../src/layouts/AppLayout.tsx", import.meta.url), "utf8"),
  );
  const routes = parseAppRoutes(
    readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8"),
  );

  // ── 1. Peta menu ↔ peta rute (statis, dari sumbernya) ─────────────────────
  check("menu sidebar terbaca dari sumbernya", menu.length > 0, `jumlah=${menu.length}`);
  check(
    "setiap menu punya tujuan & label",
    menu.every((item) => item.to && item.label),
    JSON.stringify(menu.filter((item) => !item.to || !item.label)),
  );
  check(
    "hanya satu menu tanpa izin, dan itu memang halaman semua peran (Profil)",
    menu.filter((item) => !item.permission).length === 1 &&
      menu.filter((item) => !item.permission)[0].to === "/app/profil",
    menu
      .filter((item) => !item.permission)
      .map((item) => item.to)
      .join(", "),
  );
  check(
    "jumlah menu sama dengan jumlah rute anak /app (satu menu satu rute)",
    menu.length === routes.length,
    `menu=${menu.length} rute=${routes.length}`,
  );
  check(
    "tidak ada tujuan menu yang dipakai dua kali",
    new Set(menu.map((item) => item.to)).size === menu.length,
    menu.map((item) => item.to).join(", "),
  );
  check(
    "tidak ada label menu yang dipakai dua kali",
    new Set(menu.map((item) => item.label)).size === menu.length,
    menu.map((item) => item.label).join(", "),
  );

  for (const item of menu) {
    const route = routes.find((row) => row.to === item.to);
    check(`${item.label}: punya rute di App.tsx`, Boolean(route), item.to);
    check(
      `${item.label}: izin menu sama dengan izin rutenya`,
      route.permission === item.permission,
      `menu=${item.permission} rute=${route.permission}`,
    );
  }
  for (const route of routes) {
    check(
      `rute ${route.to}: punya menu di sidebar`,
      menu.some((item) => item.to === route.to),
      route.to,
    );
  }
  for (const item of menu) {
    check(`${item.label}: punya penanda halaman`, Boolean(PAGE_MARKERS[item.to]), item.to);
  }
  check(
    "penanda halaman berbeda satu sama lain",
    new Set(menu.map((item) => PAGE_MARKERS[item.to])).size === menu.length,
    Object.values(PAGE_MARKERS).join(", "),
  );

  // ── Render aplikasi asli (router + provider) di DOM tiruan ────────────────
  function sessionOf(role, options = {}) {
    const { planKey = "enterprise", verticals = ALL_MODULES } = options;
    return {
      user: { name: "Uji Menu", email: `menu-${role}@mesinpos.test` },
      tenant: {
        name: "Toko Uji Menu",
        slug: "toko-uji-menu",
        storeName: "Cabang Uji",
        vertical: verticals[0],
        verticals,
        planKey,
        role,
        customRole: null,
        createdAt: new Date().toISOString(),
        trialEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      },
    };
  }

  async function renderApp(route, session) {
    if (session) {
      window.localStorage.setItem("mesinpos.session.v1", JSON.stringify(session));
    } else {
      window.localStorage.removeItem("mesinpos.session.v1");
    }
    const container = window.document.createElement("div");
    window.document.body.appendChild(container);
    const root = createRoot(container);
    const before = errors.length;

    await React.act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          { initialEntries: [route] },
          React.createElement(
            SessionProvider,
            null,
            React.createElement(
              BackendProvider,
              null,
              React.createElement(StoreProvider, null, React.createElement(App, null)),
            ),
          ),
        ),
      );
    });

    return {
      text: container.textContent.replace(/\s+/g, " ").trim(),
      /** Menu yang benar-benar tergambar, berikut tujuan tautannya. */
      links: [...container.querySelectorAll("aside nav a")].map((anchor) => ({
        href: anchor.getAttribute("href") ?? "",
        label: (anchor.textContent ?? "").trim(),
      })),
      newErrors: errors.slice(before),
      async close() {
        await React.act(async () => {
          root.unmount();
        });
        container.remove();
      },
    };
  }

  /** Menu yang seharusnya tampil menurut tabel izin + gerbang fitur modul. */
  function visibleFor(role, planKey = "enterprise", verticals = ALL_MODULES) {
    const permissions = effectivePermissions(role, null);
    return menu
      .filter((item) => {
        // Menu tanpa izin (Profil) memang tampil untuk semua peran.
        if (item.permission && !permissions.includes(item.permission)) return false;
        if (!item.feature) return true;
        return moduleFeatureEnabled(planKey, verticals, item.feature);
      })
      .map((item) => item.label);
  }

  // ── 2. Menu yang tergambar per peran ─────────────────────────────────────
  for (const role of ROLES) {
    const expected = visibleFor(role);
    const view = await renderApp("/app", sessionOf(role));
    const shown = view.links.map((link) => link.label);
    check(
      `menu peran ${ROLE_LABELS[role]} sama persis dengan izinnya`,
      shown.join(" | ") === expected.join(" | "),
      `tampil=[${shown.join(" | ")}] harap=[${expected.join(" | ")}]`,
    );
    check(
      `menu peran ${ROLE_LABELS[role]} tidak duplikat`,
      new Set(shown).size === shown.length,
      shown.join(", "),
    );
    check(
      `menu peran ${ROLE_LABELS[role]}: tautan menunjuk rute yang benar`,
      view.links.every((link) => menu.some((item) => item.to === link.href)),
      view.links.map((link) => link.href).join(", "),
    );
    check(
      `menu peran ${ROLE_LABELS[role]} tanpa error konsol`,
      view.newErrors.length === 0,
      view.newErrors.join(" | ").slice(0, 200),
    );
    await view.close();
  }

  // Peran kustom (`rbac.custom`) menggantikan peran bawaan — termasuk di menu.
  {
    const custom = {
      id: "role-uji",
      name: "Pengawas Menu",
      permissions: ["report.view", "team.manage"],
    };
    const view = await renderApp("/app", {
      user: { name: "Uji Menu", email: "menu-kustom@mesinpos.test" },
      tenant: { ...sessionOf("cashier").tenant, customRole: custom },
    });
    const shown = view.links.map((link) => link.label);
    const expected = menu
      .filter(
        (item) =>
          (!item.permission ||
            effectivePermissions("cashier", custom.permissions).includes(item.permission)) &&
          (!item.feature || moduleFeatureEnabled("enterprise", ALL_MODULES, item.feature)),
      )
      .map((item) => item.label);
    check(
      "peran kustom menggantikan peran bawaan di menu",
      shown.join(" | ") === expected.join(" | "),
      `tampil=[${shown.join(" | ")}] harap=[${expected.join(" | ")}]`,
    );
    await view.close();
  }

  // ── 3. Matriks menu × peran: terbuka atau ditolak ────────────────────────
  for (const role of ROLES) {
    const permissions = effectivePermissions(role, null);
    for (const item of menu) {
      const view = await renderApp(item.to, sessionOf(role));
      // Menu tanpa izin (Profil) harus terbuka untuk **setiap** peran — itulah
      // bedanya dengan menu lain, jadi pengecualiannya disebut di sini, bukan
      // disembunyikan dengan memberi halaman itu izin pinjaman.
      const allowed = item.permission ? permissions.includes(item.permission) : true;

      if (allowed) {
        check(
          `${item.label}: terbuka untuk ${ROLE_LABELS[role]}`,
          !view.text.includes("Akses ditolak") && !view.text.includes("gagal dimuat"),
          view.text.slice(0, 200),
        );
        check(
          `${item.label}: terisi untuk ${ROLE_LABELS[role]}`,
          view.text.length > 200,
          `panjang=${view.text.length}`,
        );
        if (role === "owner") {
          check(
            `${item.label}: memuat penanda "${PAGE_MARKERS[item.to]}"`,
            view.text.includes(PAGE_MARKERS[item.to]),
            view.text.slice(0, 220),
          );
        }
      } else {
        check(
          `${item.label}: menolak ${ROLE_LABELS[role]} walau URL diketik langsung`,
          view.text.includes("Akses ditolak"),
          view.text.slice(0, 200),
        );
      }

      check(
        `${item.label} (${ROLE_LABELS[role]}): tanpa error konsol`,
        view.newErrors.length === 0,
        view.newErrors.join(" | ").slice(0, 200),
      );
      await view.close();
    }
  }

  // ── 4. Gerbang modul benar-benar menggerakkan menu ───────────────────────
  {
    const starter = sessionOf("owner", { planKey: "starter", verticals: ["umkm"] });
    const view = await renderApp("/app", starter);
    const labels = view.links.map((link) => link.label);
    check(
      "Starter + modul UMKM: menu Dapur & Meja tidak tampil",
      !labels.includes("Dapur & Meja"),
      labels.join(" | "),
    );
    check(
      "Starter + modul UMKM: menu inti tetap tampil",
      ["Dashboard", "Kasir (POS)", "Produk & Stok", "Laporan", "Modul"].every((label) =>
        labels.includes(label),
      ),
      labels.join(" | "),
    );
    await view.close();

    const off = await renderApp("/app/kds", starter);
    check(
      "Starter + modul UMKM: halaman Dapur menjelaskan modulnya, bukan gagal",
      off.text.includes("Butuh modul F&B") &&
        off.text.includes("hidup di modul Food & Beverage"),
      off.text.slice(0, 260),
    );
    check(
      "Starter + modul UMKM: layar dapur tidak diklaim aktif",
      !off.text.includes("Layar dapur aktif"),
      off.text.slice(0, 260),
    );
    await off.close();

    const live = await renderApp("/app/kds", sessionOf("owner"));
    check(
      "Enterprise + modul F&B: layar dapur hidup dan menunya tampil",
      live.text.includes("Layar dapur aktif"),
      live.text.slice(0, 200),
    );
    await live.close();
  }

  // ── 5. Rute yang berdiri di luar menu tetap hidup ────────────────────────
  {
    const landing = await renderApp("/", null);
    check(
      "beranda publik merender tanpa sesi",
      landing.text.length > 400 && !landing.text.includes("gagal dimuat"),
      `panjang=${landing.text.length}`,
    );
    await landing.close();

    const tamu = await renderApp("/app/pos", null);
    check(
      "tamu yang membuka /app/pos diarahkan ke halaman masuk",
      tamu.text.includes("Masuk atau daftar"),
      tamu.text.slice(0, 160),
    );
    await tamu.close();

    const baru = { user: { name: "Uji Menu", email: "menu-baru@mesinpos.test" }, tenant: null };
    const onboarding = await renderApp("/onboarding", baru);
    check(
      "onboarding merender form pendaftaran tenant",
      onboarding.text.includes("Nama bisnis") &&
        onboarding.text.includes("Nama cabang pertama"),
      onboarding.text.slice(0, 220),
    );
    check(
      "onboarding tanpa error konsol",
      onboarding.newErrors.length === 0,
      onboarding.newErrors.join(" | ").slice(0, 200),
    );
    await onboarding.close();

    const platform = await renderApp("/platform", {
      user: { name: "Uji Menu", email: "menu-platform@mesinpos.test" },
      tenant: null,
    });
    check(
      "backstage platform terbuka untuk akun tanpa tenant",
      platform.text.includes("Backstage platform"),
      platform.text.slice(0, 160),
    );
    await platform.close();
  }
  // ── 6. Sumber izin yang dipakai gerbang rute & langganan ───────────────
  //
  //     Sesi perangkat **bukan** sumber izin yang boleh dipercaya. Perangkat
  //     yang baru masuk belum tahu workspace mana miliknya (`tenant: null`), dan
  //     menerjemahkan keadaan itu sebagai “pemilik” pernah membuat kasir yang
  //     diundang membuka katalog yang server tolak — akibatnya halaman berhenti
  //     merender dengan pesan `Akses ditolak: peran cashier tidak memiliki izin
  //     product.manage`, bukan dijelaskan.
  {
    const { actingPermissions } = await server.ssrLoadModule("/src/lib/session.tsx");

    const tanpaTenant = actingPermissions({
      user: { name: "Uji Menu", email: "tanpa-tenant@mesinpos.test" },
      tenant: null,
    });
    check(
      "sesi tanpa tenant tidak punya izin sama sekali",
      tanpaTenant.length === 0,
      JSON.stringify(tanpaTenant),
    );
    check(
      "sesi tanpa tenant tidak dibaca sebagai pemilik",
      !tanpaTenant.includes("product.manage") &&
        !tanpaTenant.includes("billing.manage"),
      JSON.stringify(tanpaTenant),
    );

    const izinKasir = actingPermissions(sessionOf("cashier"));
    check(
      "kasir tidak memegang product.manage (izin yang menolak products.listAll)",
      izinKasir.includes("pos.sell") && !izinKasir.includes("product.manage"),
      JSON.stringify(izinKasir),
    );

    const izinKustom = actingPermissions({
      ...sessionOf("cashier"),
      tenant: {
        ...sessionOf("cashier").tenant,
        customRole: { id: "role-uji", name: "Pengawas Izin", permissions: ["report.view"] },
      },
    });
    check(
      "peran kustom menggantikan izin bawaan juga di gerbang rute",
      izinKustom.includes("report.view") && !izinKustom.includes("pos.sell"),
      JSON.stringify(izinKustom),
    );

    check(
      "sesi kosong tidak punya izin",
      actingPermissions(null).length === 0,
      JSON.stringify(actingPermissions(null)),
    );
  }
} catch (error) {
  failure = error;
} finally {
  await server.close();
  await window.happyDOM?.close?.();
}

if (failure) {
  for (const result of results) {
    console.log(`${result.ok ? "✓" : "✗"} ${result.name}`);
  }
  console.error(`\n✗ ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`${results.length}/${results.length} checks passed`);
  process.exit(0);
}

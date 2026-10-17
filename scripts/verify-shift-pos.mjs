/**
 * Laporan pengguna: “saat shift kas dibuka oleh pemilik bisnis/merchant, halaman
 * Kasir (POS) tidak otomatis terbuka.”
 *
 * Keadaan kas dibaca kedua halaman dari satu tempat (`store.till`; di mode demo
 * perangkat, `mesinpos.shifts.v1`) — halaman ini menjalankan mode demo, jadi yang
 * dibuktikan di sini adalah jalur perangkat itu plus perpindahan halamannya.
 * Kas **toko** lintas perangkat dibuktikan di `scripts/verify-backend.mjs`
 * (`pos.till` terbaca oleh kasir tanpa `shift.manage`). Dua hal yang harus benar
 * karena itu satu penyimpanan:
 *
 *   1. **Perpindahannya otomatis** — menekan **Buka shift** membawa peran yang
 *      boleh menjual langsung ke halaman Kasir, bukan membiarkannya menebak
 *      apakah halaman itu sudah terbuka;
 *   2. **Keadaannya nyata** — halaman Kasir tidak terkunci setelah shift dibuka
 *      (baik dibuka lewat tombol itu maupun dimuat ulang), dan terkunci lagi
 *      begitu kasnya ditutup. Tab lain yang sedang membuka Kasir ikut terbuka
 *      lewat pendengar `storage`.
 *
 * Peran “kas saja” (punya `shift.manage`, tanpa `pos.sell`) sengaja **tidak**
 * dipindahkan: halaman Kasir memang bukan halamannya, dan halaman Shift & Kas
 * mengatakan itu.
 *
 * Usage: bun scripts/verify-shift-pos.mjs
 */
import "./happy-dom-setup.mjs";
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

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

const SESSION_KEY = "mesinpos.session.v1";
const SHIFT_KEY = "mesinpos.shifts.v1";
/** Menulis nilai input seperti pengguna mengetik (React butuh setter aslinya). */
function typeInto(element, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(element, value);
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
}

try {
  const { App } = await server.ssrLoadModule("/src/App.tsx");
  const { SessionProvider } = await server.ssrLoadModule("/src/lib/session.tsx");
  const { BackendProvider, StoreProvider } = await server.ssrLoadModule(
    "/src/lib/store/index.tsx",
  );

  function sessionOf(role) {
    return {
      user: { name: "Uji Shift", email: `shift-${role}@mesinpos.test` },
      tenant: {
        name: "Toko Uji Shift",
        slug: "toko-uji-shift",
        storeName: "Cabang Uji",
        vertical: "fnb",
        verticals: ["fnb"],
        planKey: "enterprise",
        role,
        customRole: null,
        createdAt: new Date().toISOString(),
        trialEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      },
    };
  }

  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container);

  let renderKe = 0;
  async function renderAt(route) {
    /*
      `key` baru tiap render memaksa pohonnya benar-benar **dipasang ulang**,
      seperti halaman yang dimuat ulang. Tanpa itu React memakai ulang komponen
      halaman yang sama, sehingga pembacaan shift “saat halaman dibuka” — yang
      justru diuji di sini — tidak pernah berjalan lagi.
    */
    renderKe += 1;
    await React.act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          { key: `render-${renderKe}`, initialEntries: [route] },
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
  }

  const text = () => (container.textContent ?? "").replace(/\s+/g, " ").trim();
  const query = (selector) => container.querySelector(selector);
  const findButton = (label) =>
    [...container.querySelectorAll("button")].find((button) =>
      (button.textContent ?? "").replace(/\s+/g, " ").includes(label),
    );
  const gate = () => query('[data-testid="pos-gerbang-shift"]');
  const shiftTersimpan = () =>
    JSON.parse(window.localStorage.getItem(SHIFT_KEY) ?? "{}");

  // ── 1. Pemilik membuka kasnya: aplikasi pindah ke halaman Kasir ────────
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(sessionOf("owner")));
  window.localStorage.removeItem(SHIFT_KEY);

  await renderAt("/app/shift");
  check(
    "halaman Shift & Kas terbuka dengan kas tertutup",
    text().includes("Buka shift") && text().includes("Kas tertutup"),
    text().slice(0, 200),
  );

  const tombolBuka = query('[data-testid="shift-buka"]');
  check("tombol Buka shift ada", Boolean(tombolBuka), text().slice(0, 200));
  check(
    "halaman Shift & Kas mengatakan halaman Kasir akan terbuka sendiri",
    text().includes("halaman Kasir langsung terbuka"),
    text().slice(0, 260),
  );
  await React.act(async () => {
    tombolBuka.click();
  });

  check(
    "menekan Buka shift menyimpan shift terbuka di perangkat",
    typeof shiftTersimpan().current?.openedAt === "string" &&
      shiftTersimpan().current?.closedAt === null,
    JSON.stringify(shiftTersimpan().current ?? shiftTersimpan()),
  );
  check(
    "setelah kas dibuka, halaman Kasir otomatis terbuka (tanpa klik menu lagi)",
    query('[data-testid="pos-bayar"]') !== null && text().includes("Keranjang"),
    text().slice(0, 240),
  );
  check(
    "halaman Kasir yang terbuka otomatis itu TIDAK terkunci",
    gate() === null,
    (gate()?.textContent ?? "").slice(0, 200),
  );

  // ── 2. Dimuat ulang/dibuka lagi lewat menu: tetap terbuka ──────────────
  await renderAt("/app/pos");
  check(
    "halaman Kasir yang dibuka sendiri memakai shift perangkat yang sama",
    gate() === null && text().includes("Shift terbuka"),
    gate() ? (gate().textContent ?? "").slice(0, 200) : text().slice(0, 240),
  );
  //  Gerbangnya terkunci berarti kartu produk mati; jadi yang dibuktikan di
  //  sini bukan “tombolnya ada”, melainkan kasir benar-benar bisa memasukkan
  //  barang ke keranjang.
  await React.act(async () => {
    const produk = [...container.querySelectorAll("button")].find((tombol) =>
      /stok \d+/.test(tombol.textContent ?? ""),
    );
    produk?.click();
  });
  check(
    "kasir benar-benar bisa menjual: produk masuk ke keranjang",
    !(query('[data-testid="keranjang-jumlah-item"]')?.textContent ?? "").includes(
      "0 item",
    ),
    `jumlah=${query('[data-testid="keranjang-jumlah-item"]')?.textContent}`,
  );
  check(
    "halaman Kasir tanpa error konsol",
    errors.length === 0,
    errors.join(" | ").slice(0, 200),
  );

  // ── 3. Tab lain yang sedang membuka Kasir ikut terbuka ─────────────────
  window.localStorage.removeItem(SHIFT_KEY);
  await renderAt("/app/pos");
  check(
    "tanpa shift, halaman Kasir terkunci (gerbangnya memang hidup)",
    gate() !== null,
    text().slice(0, 200),
  );
  window.localStorage.setItem(
    SHIFT_KEY,
    JSON.stringify({
      current: {
        id: "shift-tab-lain",
        openedAt: new Date().toISOString(),
        openingCash: 300000,
        cashSales: 0,
        totalSales: 0,
        saleCount: 0,
        closedAt: null,
        countedCash: null,
        expectedCash: null,
        variance: null,
      },
      history: [],
    }),
  );
  await React.act(async () => {
    window.dispatchEvent(
      new window.StorageEvent("storage", {
        key: SHIFT_KEY,
        newValue: window.localStorage.getItem(SHIFT_KEY),
      }),
    );
  });
  check(
    "shift yang dibuka dari tab lain membuka gerbang halaman Kasir yang sedang terbuka",
    gate() === null && text().includes("Shift terbuka"),
    gate() ? (gate().textContent ?? "").slice(0, 200) : text().slice(0, 200),
  );

  // ── 4. Menutup kas mengunci halaman Kasir lagi ─────────────────────────
  await renderAt("/app/shift");
  const hitung = container.querySelector("#counted");
  check("kolom uang fisik ada saat shift terbuka", Boolean(hitung), text().slice(0, 200));
  await React.act(async () => {
    typeInto(hitung, "300000");
  });
  const tombolTutup = findButton("Tutup shift");
  check("tombol Tutup shift ada", Boolean(tombolTutup), text().slice(0, 200));
  await React.act(async () => {
    tombolTutup.click();
  });
  check(
    "menutup shift mengosongkan shift yang berjalan",
    shiftTersimpan().current === null && Array.isArray(shiftTersimpan().history),
    JSON.stringify(shiftTersimpan().current ?? shiftTersimpan()),
  );

  await renderAt("/app/pos");
  check(
    "setelah kas ditutup, halaman Kasir terkunci lagi",
    gate() !== null,
    text().slice(0, 200),
  );

  // ── 5. Peran “kas saja” tidak dipindahkan ke halaman yang bukan haknya ──
  //     Perannya kustom (`shift.manage` tanpa `pos.sell`): dibuka di halaman
  //     Shift & Kas, tekan Buka shift, dan tetap di situ — bukan dilempar ke
  //     halaman Kasir yang rutenya memang tertutup untuknya.
  window.localStorage.removeItem(SHIFT_KEY);
  const sesiKas = sessionOf("cashier");
  sesiKas.tenant.customRole = {
    id: "role-kas",
    name: "Kas Saja",
    permissions: ["shift.manage"],
  };
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(sesiKas));
  await renderAt("/app/shift");
  const bukaKas = query('[data-testid="shift-buka"]');
  check(
    "peran kas saja tetap boleh membuka kasnya",
    Boolean(bukaKas),
    text().slice(0, 240),
  );
  check(
    "peran kas saja diberi tahu lebih dulu bahwa halaman Kasir bukan tempatnya",
    text().includes("Halaman Kasir butuh izin") &&
      !text().includes("halaman Kasir langsung terbuka"),
    text().slice(0, 320),
  );
  await React.act(async () => {
    bukaKas.click();
  });
  const isiHalaman = () =>
    (container.querySelector("main")?.textContent ?? "").replace(/\s+/g, " ").trim();
  check(
    "peran kas saja tetap di halaman Shift & Kas setelah membuka kas",
    text().includes("Shift terbuka") && query('[data-testid="pos-bayar"]') === null,
    isiHalaman().slice(0, 260),
  );
  check(
    "halaman Shift & Kas menjelaskan kenapa halaman Kasir tidak dibuka",
    isiHalaman().includes("Halaman Kasir butuh izin"),
    isiHalaman().slice(0, 260),
  );
  check(
    "shift peran kas saja tetap tersimpan",
    typeof shiftTersimpan().current?.openedAt === "string",
    JSON.stringify(shiftTersimpan().current ?? shiftTersimpan()),
  );

  await React.act(async () => {
    root.unmount();
  });
  container.remove();

  const failed = results.filter((result) => !result.ok).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await server.close();
}

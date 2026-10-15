/**
 * Uji **peramban sungguhan**: gulir shell backstage hanya boleh terjadi **di dalam
 * `main`** — header dan sidebar tidak pernah ikut terangkat, dan dokumennya sendiri
 * tidak boleh bisa digulir sama sekali.
 *
 * Kenapa harness ini ada: laporan pengguna “di halaman Pengaturan, setelah sampai
 * paling bawah halaman tetap bisa di-scroll ke atas — sidebar, header, dan halaman
 * naik semua”. Gejala itu hanya bisa terjadi kalau **dokumen** (bukan `main`) yang
 * bergulir, dan itu tidak terlihat di DOM tiruan: `verify-render.mjs` tidak
 * menghitung tata letak & gulir sungguhan.
 *
 * Yang diperiksa untuk tiap halaman backstage, di dua ukuran layar (HP 390×844 dan
 * desktop 1280×800):
 *
 *   1. dokumennya tidak bisa digulir (`scrollHeight` dokumen ≤ tinggi layar), dan
 *      `window.scrollTo` tidak menggeser apa pun;
 *   2. setelah `main` digulir sampai paling bawah, `window.scrollY` tetap 0 dan
 *      header & sidebar tetap menempel di atas (`top ≈ 0`);
 *   3. `main` memang punya gulirannya sendiri saat isinya lebih panjang dari layar.
 *
 * Prasyarat — paket peramban sengaja dipasang **di luar repo**, supaya unduhan
 * Chromium tidak ikut masuk ke instalasi build hosting:
 *
 *   mkdir -p /tmp/pw && cd /tmp/pw && bun init -y && bun add playwright
 *   bunx playwright install --with-deps chromium --only-shell
 *
 * Usage:
 *   PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-browser-scroll.mjs [baseUrl]
 *
 * Default: `http://localhost:5173` (dev server/preview yang sedang berjalan). Sesi
 * backstage disemai lewat `localStorage` sebelum halaman dibuka, jadi uji ini tidak
 * butuh login dan tidak menyentuh data siapa pun.
 */
import { createRequire } from "node:module";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/+$/, "");

/** Playwright dari direktori terpisah (lihat "Prasyarat" di atas). */
const playwrightDir = process.env.PLAYWRIGHT_DIR;
const requireFrom = playwrightDir
  ? createRequire(`${playwrightDir.replace(/\/+$/, "")}/`)
  : createRequire(import.meta.url);
const { chromium } = requireFrom("playwright");

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const SESSION_KEY = "mesinpos.session.v1";
const SESSION = {
  user: { name: "Uji Gulir Halaman", email: "gulir-halaman@mesinpos.test" },
  tenant: {
    name: "Kafe Uji Gulir",
    slug: "kafe-uji-gulir-halaman",
    storeName: "Pusat",
    vertical: "fnb",
    verticals: ["fnb", "umkm"],
    planKey: "enterprise",
    role: "owner",
    createdAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
  },
};

/** Halaman yang diperiksa, beserta penanda isinya supaya tidak salah halaman. */
const HALAMAN = [
  ["Pengaturan", "/app/settings", "Pengaturan workspace"],
  ["Laporan", "/app/reports", "Omzet per metode bayar"],
  ["Produk & Stok", "/app/products", "Kategori produk"],
  ["Kasir", "/app/pos", "Keranjang"],
  ["Gudang & Stok", "/app/inventory", "Gudang"],
  ["Panduan", "/app/panduan", "Panduan"],
];

/** Keadaan gulir yang sedang terjadi di halaman. */
const ukurGulir = (page) =>
  page.evaluate(() => {
    const main = document.querySelector("main");
    const header = document.querySelector("header");
    const sidebar = document.querySelector('[data-testid="app-sidebar"]');
    const doc = document.scrollingElement ?? document.documentElement;
    const kotak = (el) => {
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return { top: Math.round(box.top), height: Math.round(box.height) };
    };
    return {
      docScrollHeight: doc.scrollHeight,
      docClientHeight: doc.clientHeight,
      docScrollTop: doc.scrollTop,
      windowScrollY: window.scrollY,
      innerHeight: window.innerHeight,
      mainScrollTop: main ? Math.round(main.scrollTop) : null,
      mainScrollHeight: main ? main.scrollHeight : null,
      mainClientHeight: main ? main.clientHeight : null,
      header: kotak(header),
      sidebar: kotak(sidebar),
    };
  });

const browser = await chromium.launch();

async function halaman(viewport, path) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SESSION_KEY, JSON.stringify(SESSION)],
  );
  const page = await context.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 30_000 });
  await page.waitForTimeout(400);
  return { context, page };
}

try {
  for (const [viewport, label] of [
    [{ width: 390, height: 844 }, "HP 390×844"],
    [{ width: 1280, height: 800 }, "desktop 1280×800"],
  ]) {
    for (const [nama, path, penanda] of HALAMAN) {
      const { context, page } = await halaman(viewport, path);

      check(
        `${label} · ${nama}: halamannya yang benar-benar terbuka`,
        await page.evaluate((teks) => document.body.innerText.includes(teks), penanda),
        (await page.evaluate(() => document.body.innerText)).slice(0, 160),
      );

      const awal = await ukurGulir(page);
      check(
        `${label} · ${nama}: dokumennya tidak lebih tinggi dari layar (tidak bisa digulir)`,
        awal.docScrollHeight <= awal.innerHeight + 1,
        JSON.stringify({
          docScrollHeight: awal.docScrollHeight,
          innerHeight: awal.innerHeight,
        }),
      );

      // Digulir sampai paling bawah lewat `main`, lalu dokumennya dicoba digeser.
      const akhir = await page.evaluate(() => {
        const main = document.querySelector("main");
        if (main) main.scrollTop = main.scrollHeight;
        window.scrollTo(0, 5000);
        return true;
      });
      void akhir;
      await page.waitForTimeout(200);
      const setelah = await ukurGulir(page);

      check(
        `${label} · ${nama}: setelah sampai bawah, dokumennya tetap di posisi 0`,
        setelah.docScrollTop === 0 && setelah.windowScrollY === 0,
        JSON.stringify({
          docScrollTop: setelah.docScrollTop,
          windowScrollY: setelah.windowScrollY,
        }),
      );
      check(
        `${label} · ${nama}: header & sidebar tidak ikut naik`,
        setelah.header?.top === 0 &&
          (viewport.width < 1024 ? true : setelah.sidebar?.top === 0),
        `header=${JSON.stringify(setelah.header)} sidebar=${JSON.stringify(setelah.sidebar)}`,
      );
      check(
        `${label} · ${nama}: kalau isinya lebih panjang, yang bergulir adalah main`,
        setelah.mainScrollHeight <= setelah.mainClientHeight + 1 ||
          setelah.mainScrollTop > 0,
        `scrollTop=${setelah.mainScrollTop} scrollHeight=${setelah.mainScrollHeight} clientHeight=${setelah.mainClientHeight}`,
      );

      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log("\nHasil:");
for (const { name, ok } of results) {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
}
console.log(`\n${results.length}/${results.length} pemeriksaan lulus.`);

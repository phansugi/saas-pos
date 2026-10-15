/**
 * Uji **peramban sungguhan**: tombol menu (burger) di header backstage muncul
 * saat layar sedang **mode layar penuh** atau **dilihat dari HP/layar kecil**, dan
 * panel menunya benar-benar menutupi halaman dari kiri atas.
 *
 * Kenapa harus peramban sungguhan: satu-satunya sebab tombolnya muncul di layar
 * kecil adalah **media query** (`lg:hidden`). DOM tiruan (`verify-render.mjs`)
 * tidak menghitung media query, jadi di sana yang bisa diperiksa hanya kelasnya.
 * Di sini yang diperiksa hasil layout yang sebenarnya: `getBoundingClientRect` +
 * `getComputedStyle` pada dua ukuran layar berbeda, plus mode layar penuh.
 *
 * Yang diperiksa:
 *
 *   1. HP 390×844 — tombol menu tampil di kiri atas header, sidebar statiknya
 *      memang tidak tampil (itulah sebab tombolnya ada);
 *   2. HP — menekan tombolnya membuka panel fixed selebar 256 px menempel kiri,
 *      dengan latar penutup di atas halaman, dan menunya benar-benar terbaca;
 *   3. HP — memilih satu menu menutup panelnya **dan** membuka halamannya;
 *   4. HP — Esc menutup panelnya;
 *   5. layar lebar 1280×800 tanpa layar penuh — tombolnya tidak muncul, sidebar
 *      statiknya tampil seperti biasa;
 *   6. layar lebar + mode layar penuh — sidebar statiknya hilang, tombol menu
 *      tetap tampil, dan panelnya tetap melayang (tidak kembali statik);
 *   7. keluar dari layar penuh — sidebar statiknya kembali dan tombolnya kembali
 *      tersembunyi.
 *
 * Prasyarat — paket peramban sengaja dipasang **di luar repo**, supaya unduhan
 * Chromium tidak ikut masuk ke instalasi build hosting:
 *
 *   mkdir -p /tmp/pw && cd /tmp/pw && bun init -y && bun add playwright
 *   bunx playwright install --with-deps chromium --only-shell
 *
 * Usage:
 *   PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-browser-menu.mjs [baseUrl]
 *
 * Default: `http://localhost:5173` (dev server/preview yang sedang berjalan).
 * Sesi backstage disemai lewat `localStorage` sebelum halaman dibuka, sama seperti
 * harness DOM — jadi uji ini tidak butuh login dan tidak menyentuh data siapa pun.
 */
import { createRequire } from "node:module";
import { mkdirSync, statSync } from "node:fs";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/+$/, "");
const SHOTS = "/tmp/browser-shots";

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
  user: { name: "Uji Menu HP", email: "menu-hp@mesinpos.test" },
  tenant: {
    name: "Kafe Uji Menu",
    slug: "kafe-uji-menu",
    storeName: "Pusat",
    vertical: "umkm",
    verticals: ["umkm"],
    planKey: "enterprise",
    role: "owner",
    createdAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
  },
};

const TOMBOL_MENU = '[data-testid="sidebar-menu-button"]';
const LATAR = '[data-testid="sidebar-backdrop"]';
/**
 * Sidebar backstage, dituju lewat `data-testid`-nya — bukan `aside` telanjang:
 * halaman kasir juga punya `<aside>` sendiri (panel keranjang), dan `aside`
 * pertama di DOM belum tentu yang dimaksud kalau susunannya berubah.
 */
const SIDEBAR = '[data-testid="app-sidebar"]';

/** Ukuran & posisi nyata sebuah elemen setelah CSS (media query) dihitung. */
const ukuran = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return {
      display: style.display,
      position: style.position,
      zIndex: style.zIndex,
      width: Math.round(box.width),
      height: Math.round(box.height),
      left: Math.round(box.left),
      top: Math.round(box.top),
      tampil:
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        box.width > 0 &&
        box.height > 0,
    };
  }, selector);

const browser = await chromium.launch();

/** Perangkat baru: sesi disemai dulu, lalu halaman backstage dibuka. */
async function perangkat(viewport) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [SESSION_KEY, JSON.stringify(SESSION)],
  );
  const page = await context.newPage();
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  // `attached`, bukan `visible`: baik tombol menu (layar lebar) maupun sidebar
  // statik (layar kecil) memang disembunyikan media query di salah satu ukuran —
  // justru itu yang sedang diuji, jadi yang ditunggu hanya keberadaannya.
  await page.waitForSelector(TOMBOL_MENU, { state: "attached", timeout: 30_000 });
  await page.waitForSelector(SIDEBAR, { state: "attached", timeout: 30_000 });
  return { context, page };
}

try {
  mkdirSync(SHOTS, { recursive: true });

  // ------------------------------------------------------------- HP / kecil
  {
    const { context, page } = await perangkat({ width: 390, height: 844 });

    const tombol = await ukuran(page, TOMBOL_MENU);
    check(
      "HP 390×844: tombol menu benar-benar tampil di header (≥ 32 px, di kiri atas)",
      tombol?.tampil === true &&
        tombol.width >= 32 &&
        tombol.height >= 32 &&
        tombol.left <= 24 &&
        tombol.top < 64,
      JSON.stringify(tombol),
    );

    const sidebarStatik = await ukuran(page, SIDEBAR);
    check(
      "HP: sidebar statiknya memang tidak tampil — itulah sebab tombolnya muncul",
      sidebarStatik?.tampil === false,
      JSON.stringify(sidebarStatik),
    );

    await page.click(TOMBOL_MENU);
    await page.waitForTimeout(200);
    const panel = await ukuran(page, SIDEBAR);
    check(
      "HP: panelnya terbuka menempel kiri, selebar 256 px, melayang di atas halaman",
      panel?.tampil === true &&
        panel.position === "fixed" &&
        panel.left === 0 &&
        panel.width === 256 &&
        Number(panel.zIndex) >= 40,
      JSON.stringify(panel),
    );
    const latar = await ukuran(page, LATAR);
    check(
      "HP: halaman di belakangnya tertutup latar, di bawah panelnya (z-30 < z-40)",
      latar?.tampil === true && Number(latar.zIndex) >= 30 && Number(latar.zIndex) < 40,
      JSON.stringify(latar),
    );
    check(
      "HP: panelnya benar-benar memuat menu navigasi",
      await page.evaluate(() =>
        [...document.querySelectorAll('#app-sidebar a')].some((a) =>
          (a.textContent ?? "").includes("Kasir (POS)"),
        ),
      ),
      "menu tidak terbaca di panelnya",
    );
    const hpShot = `${SHOTS}/menu-hp-panel-terbuka.png`;
    await page.screenshot({ path: hpShot });

    // Klik kedua pada tombol yang sama: inilah jalur yang dulu rusak di
    // peramban sungguhan (panelnya menutupi tombolnya sendiri, jadi kliknya
    // tertelan) — di DOM tiruan hal itu tidak terlihat sama sekali.
    await page.click(TOMBOL_MENU);
    await page.waitForTimeout(200);
    const setelahKlikKedua = await ukuran(page, SIDEBAR);
    check(
      "HP: menekan tombol menu sekali lagi menutup panelnya (tombolnya tidak tertutup panel)",
      setelahKlikKedua?.tampil === false && (await ukuran(page, LATAR)) === null,
      JSON.stringify(setelahKlikKedua),
    );

    await page.click(TOMBOL_MENU);
    await page.waitForTimeout(200);
    await page.click('#app-sidebar a:has-text("Laporan")');
    await page.waitForTimeout(300);
    const setelahMemilih = await ukuran(page, SIDEBAR);
    check(
      "HP: memilih satu menu menutup panelnya dan halaman tujuannya benar-benar terbuka",
      setelahMemilih?.tampil === false && page.url().includes("/app/reports"),
      `${JSON.stringify(setelahMemilih)} url=${page.url()}`,
    );

    await page.click(TOMBOL_MENU);
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const setelahEsc = await ukuran(page, SIDEBAR);
    check("HP: Esc menutup panelnya", setelahEsc?.tampil === false, JSON.stringify(setelahEsc));

    console.log(`· tangkapan layar: ${hpShot} (${statSync(hpShot).size} B)`);
    await context.close();
  }

  // ------------------------------------------------- layar lebar & layar penuh
  {
    const { context, page } = await perangkat({ width: 1280, height: 800 });

    const tombolBiasa = await ukuran(page, TOMBOL_MENU);
    const sidebarBiasa = await ukuran(page, SIDEBAR);
    check(
      "layar 1280×800 (bukan layar penuh): tombol menu tidak muncul, sidebar statiknya tampil",
      tombolBiasa?.tampil === false &&
        sidebarBiasa?.tampil === true &&
        sidebarBiasa.position === "static" &&
        sidebarBiasa.left === 0 &&
        sidebarBiasa.width === 256,
      `tombol=${JSON.stringify(tombolBiasa)} sidebar=${JSON.stringify(sidebarBiasa)}`,
    );

    await page.click('[aria-label="Layar penuh"]');
    await page.waitForTimeout(300);
    const tombolPenuh = await ukuran(page, TOMBOL_MENU);
    const sidebarPenuh = await ukuran(page, SIDEBAR);
    check(
      "layar penuh: sidebar statiknya hilang, tapi tombol menu tetap tampil",
      tombolPenuh?.tampil === true && sidebarPenuh?.tampil === false,
      `tombol=${JSON.stringify(tombolPenuh)} sidebar=${JSON.stringify(sidebarPenuh)}`,
    );

    await page.click(TOMBOL_MENU);
    await page.waitForTimeout(200);
    const panelPenuh = await ukuran(page, SIDEBAR);
    check(
      "layar penuh: panelnya tetap melayang di layar lebar (tidak kembali statik)",
      panelPenuh?.tampil === true && panelPenuh.position === "fixed" && panelPenuh.left === 0,
      JSON.stringify(panelPenuh),
    );
    const penuhShot = `${SHOTS}/menu-layar-penuh-panel.png`;
    await page.screenshot({ path: penuhShot });
    console.log(`· tangkapan layar: ${penuhShot} (${statSync(penuhShot).size} B)`);

    await page.click(TOMBOL_MENU);
    await page.waitForTimeout(200);
    await page.click('[aria-label="Keluar dari layar penuh"]');
    await page.waitForTimeout(300);
    const akhirSidebar = await ukuran(page, SIDEBAR);
    const akhirTombol = await ukuran(page, TOMBOL_MENU);
    check(
      "keluar dari layar penuh: sidebar statiknya kembali dan tombol menu kembali tersembunyi",
      akhirSidebar?.tampil === true &&
        akhirSidebar.position === "static" &&
        akhirTombol?.tampil === false,
      `sidebar=${JSON.stringify(akhirSidebar)} tombol=${JSON.stringify(akhirTombol)}`,
    );

    await context.close();
  }
} finally {
  await browser.close();
}

console.log("\nHasil:");
for (const { name, ok } of results) {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
}
console.log(`\n${results.length}/${results.length} pemeriksaan lulus.`);

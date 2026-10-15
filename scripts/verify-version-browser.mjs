/**
 * Banner “Versi baru tersedia — muat ulang” di **browser sungguhan**
 * (Chromium/Playwright) atas preview yang sedang berjalan.
 *
 * Kenapa ada: `bun scripts/verify-version.mjs` sudah membuktikan aturannya di
 * DOM tiruan, tetapi dua hal hanya benar-benar terbukti di browser: bahwa
 * **jadwal 45 detiknya** memang berjalan (tab yang hidup tidak di-throttle jadi
 * tidak pernah memeriksa), dan bahwa banner itu benar-benar tampil di shell
 * `/app` lalu tombolnya memuat ulang halaman.
 *
 * Caranya tidak menunggu deploy kedua (itu tidak mungkin dari sini): permintaan
 * **dokumen** dijawab dengan HTML yang memuat script modul tiruan
 * `/assets/index-AAAA1111.js` — persis bentuk HTML hasil build — sedangkan
 * permintaan `/index.html?v=…` (yang dipakai pemantau versi) dijawab dengan
 * `/assets/index-BBBB2222.js`. Dari sudut aplikasi, situsnya baru saja berganti
 * bundel. Yang diuji karena itu tetap kode aplikasi yang sebenarnya.
 *
 * Prasyarat:
 *   1. preview sedang berjalan (mode data apa pun; sesi demo ditanam skrip ini),
 *   2. Playwright terpasang **di luar repo** (`PLAYWRIGHT_DIR`), sama seperti
 *      `scripts/verify-browser-invite.mjs`.
 *
 * Catatan: script modul tiruannya tidak pernah ada di server, jadi browser
 * mencatat satu galat 404 untuk berkas itu. Itu bagian dari cara uji ini bekerja
 * (yang dibaca aplikasi adalah **isi dokumen**, bukan keberhasilan berkasnya),
 * bukan temuan.
 *
 * Usage: PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-version-browser.mjs [http://localhost:5173]
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/+$/, "");
const SHOTS = "/tmp/browser-shots";

/** Playwright dari direktori terpisah (lihat “Prasyarat” di atas). */
const playwrightDir = process.env.PLAYWRIGHT_DIR;
const requireFrom = playwrightDir
  ? createRequire(`${playwrightDir.replace(/\/+$/, "")}/`)
  : createRequire(import.meta.url);
const { chromium } = requireFrom("playwright");

mkdirSync(SHOTS, { recursive: true });

const LAMA = "index-AAAA1111.js";
const BARU = "index-BBBB2222.js";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

/** Sesi demo pemilik toko, supaya `/app` bisa dibuka tanpa alur masuk. */
const session = {
  user: { name: "Uji Versi", email: "versi@mesinpos.test" },
  tenant: {
    name: "Toko Uji Versi",
    slug: "toko-uji-versi",
    storeName: "Pusat",
    vertical: "umkm",
    verticals: ["umkm"],
    planKey: "enterprise",
    role: "owner",
    createdAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
  },
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript(
  ([key, value]) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Penyimpanan diblokir: bukan bagian yang diuji di sini.
    }
  },
  ["mesinpos.session.v1", JSON.stringify(session)],
);

const dilihat = { dokumen: 0, cekVersi: 0 };
await context.route("**/*", async (route) => {
  const request = route.request();
  const isiDokumen = request.resourceType() === "document";
  const url = new URL(request.url());
  // `/index.html` juga dilayani SPA-fallback Vite untuk rute aplikasi, jadi
  // pembedanya bukan jalurnya saja, melainkan **jenis** permintaannya.
  if (!isiDokumen && url.pathname !== "/index.html") return route.continue();

  const bundel = isiDokumen ? LAMA : BARU;
  if (isiDokumen) dilihat.dokumen += 1;
  else dilihat.cekVersi += 1;

  const response = await route.fetch();
  const body = (await response.text()).replace(
    "</head>",
    `<script type="module" crossorigin src="/assets/${bundel}"></script></head>`,
  );
  return route.fulfill({ response, body });
});

const page = await context.newPage();
const galatKonsol = [];
page.on("console", (message) => {
  if (message.type() === "error") galatKonsol.push(message.text());
});

let navigasi = 0;
page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) navigasi += 1;
});

let failure = null;
try {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.innerText.includes("Kasir"), null, {
    timeout: 45_000,
  });
  const siap = Date.now();
  await page.screenshot({ path: `${SHOTS}/versi-sebelum.png` });

  await page.waitForFunction(
    () => document.body.innerText.includes("Versi baru tersedia"),
    null,
    { timeout: 90_000 },
  );
  const muncul = Date.now();
  await page.screenshot({ path: `${SHOTS}/versi-banner.png` });

  const teks = (await page.textContent("body")).replace(/\s+/g, " ").trim();
  const jeda = muncul - siap;
  check(
    "banner muncul dari pemeriksaan pertama, tidak menyergap render awal",
    teks.includes("Versi baru tersedia") && jeda >= 40_000 && jeda <= 70_000,
    `muncul ${jeda} ms setelah halaman siap`,
  );
  check(
    "banner menyebut bundel yang berjalan & yang terbaru",
    teks.includes(LAMA) && teks.includes(BARU),
    teks.slice(0, 400),
  );
  check("halaman kasir tetap terbaca di bawah banner", teks.includes("Kasir"), teks.slice(0, 200));
  /*
    Setidaknya satu permintaan — dan yang penting: tidak menumpuk. Peramban
    boleh saja memicu pemeriksaan lebih awal (mis. acara `online` tepat setelah
    halaman siap), jadi jumlahnya tidak dipatok; yang dipastikan adalah tidak ada
    penagihan berulang setelah kabarnya sampai.
  */
  check(
    "pemantau versi benar-benar meminta dokumen situs sebelum banner tampil",
    dilihat.cekVersi >= 1,
    `cekVersi=${dilihat.cekVersi}`,
  );
  const sesudahBanner = dilihat.cekVersi;
  await page.waitForTimeout(3_000);
  check(
    "setelah banner tampil, pemantau tidak menagih server berulang",
    dilihat.cekVersi === sesudahBanner,
    `${sesudahBanner} → ${dilihat.cekVersi}`,
  );

  check(
    "tombol “Muat ulang sekarang” ada sekali di banner",
    (await page.getByRole("button", { name: "Muat ulang sekarang" }).count()) === 1,
    "jumlah tombol",
  );
  /*
    Bukti muat ulang diambil dari **dunia halaman**, bukan dari penghitung
    jaringan: begitu dokumennya dimuat ulang, variabel yang ditanam di sini ikut
    hilang. Penghitung permintaan tidak bisa dipakai karena setelah service worker
    mengambil alih klien, navigasi berikutnya dilayani di luar jangkauan route
    Playwright.
  */
  await page.evaluate(() => {
    window.__ujiSebelumMuatUlang = true;
  });
  await page.getByRole("button", { name: "Muat ulang sekarang" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("Kasir"), null, {
    timeout: 45_000,
  });
  check(
    "tombol “Muat ulang sekarang” benar-benar memuat ulang halaman",
    (await page.evaluate(() => window.__ujiSebelumMuatUlang === undefined)) && navigasi >= 2,
    `navigasi=${navigasi} dokumen=${dilihat.dokumen}`,
  );
  await page.screenshot({ path: `${SHOTS}/versi-sesudah.png` });
} catch (error) {
  failure = error;
} finally {
  await browser.close();
}

if (failure) {
  for (const result of results) console.log(`${result.ok ? "✓" : "✗"} ${result.name}`);
  console.error(`\n✗ ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`${results.length}/${results.length} checks passed`);
  console.log(`galat konsol selama uji: ${galatKonsol.length}`);
  process.exit(0);
}

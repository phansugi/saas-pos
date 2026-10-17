/**
 * Uji **peramban sungguhan**: tombol “Pasang” (dan ajakan 10 detik) tidak muncul
 * lagi di perangkat yang sudah memasang aplikasinya.
 *
 * Kenapa harness ini ada: pemilik repo melaporkan tombol “Pasang” di header masih
 * muncul walaupun aplikasinya sudah dipasang di HP-nya. Penyebabnya hanya kelihatan
 * di peramban sungguhan dengan **tab browser biasa**: `appinstalled` hanya berbunyi
 * di tab yang sedang terbuka, dan `display-mode` hanya cocok kalau aplikasinya
 * dibuka dari ikonnya. Karena itu di sini keadaan “sudah terpasang” dibangun dari
 * tiga jalur yang benar-benar dipakai aplikasi — catatan perangkat (`installedAt`),
 * jawaban `navigator.getInstalledRelatedApps()`, dan mode jendela aplikasi — lalu
 * diperiksa dari DOM peramban: yang hilang harus tombol **dan** ajakannya.
 *
 * Prasyarat — paket peramban dipasang di luar repo, sama seperti harness peramban
 * lain (`verify-mobile-overflow.mjs`):
 *
 *   mkdir -p /tmp/pw && cd /tmp/pw && bun init -y && bun add playwright
 *   bunx playwright install --with-deps chromium --only-shell
 *
 * Usage:
 *   PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-pwa-browser.mjs [baseUrl]
 *
 * Default: `http://localhost:5173` (preview/dev server yang sedang berjalan).
 * Beranda hanya dibaca, tidak ada data siapa pun yang disentuh.
 */
import { createRequire } from "node:module";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/+$/, "");

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

const INSTALL_KEY = "mesinpos.install.v1";
const TOMBOL = 'button[aria-label="Pasang aplikasi MesinPOS"]';
const AJAKAN = "Pasang MesinPOS di perangkat ini";
const NOTIS_SEMENTARA = '[data-notis="alamat-sementara"]';
const ALAMAT_TETAP = "https://mesinpos.freebuff.app";

/**
 * Harness ini juga sering dijalankan terhadap preview (`localhost` / `*.e2b.app`)
 * yang **sementara** — di alamat seperti itu aplikasinya justru harus memperingatkan
 * bahwa ikon yang dipasang dari sana nanti tidak bisa dibuka, sedangkan di alamat
 * tetap peringatan itu tidak boleh muncul. Jadi pemeriksaannya mengikuti alamatnya.
 */
const HOST = new URL(BASE).hostname.toLowerCase();
const ALAMAT_SEMENTARA =
  HOST === "localhost" ||
  HOST.endsWith(".localhost") ||
  HOST === "127.0.0.1" ||
  HOST === "e2b.app" ||
  HOST.endsWith(".e2b.app");

/** Catatan kunjungan lama: pernah diundang, ditutup, belum memasang. */
const BELUM_TERPASANG = {
  firstSeenAt: "2026-10-12T09:00:00.000Z",
  invitedAt: "2026-10-12T09:00:10.000Z",
  dismissedAt: "2026-10-12T09:00:25.000Z",
};
const SUDAH_TERPASANG = { ...BELUM_TERPASANG, installedAt: "2026-10-12T09:05:00.000Z" };

const browser = await chromium.launch({ args: ["--no-sandbox"] });

/**
 * Satu perangkat (konteks peramban terpisah) → satu pengukuran. Keadaan awal
 * disemai sebelum skrip halaman berjalan, karena ajakan & tombolnya diputuskan
 * sudah di render pertama.
 */
async function buka(opsi) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(
    ([key, opsi]) => {
      if (opsi.catatan) window.localStorage.setItem(key, JSON.stringify(opsi.catatan));
      else window.localStorage.removeItem(key);
      // Peramban yang bisa ditanya (Chromium) menjawab dari API ini.
      if (opsi.relatedApps) {
        window.navigator.getInstalledRelatedApps = async () => opsi.relatedApps;
      }
      // `display-mode: standalone` = aplikasi dibuka dari ikonnya.
      if (opsi.standalone) {
        const asli = window.matchMedia.bind(window);
        window.matchMedia = (query) =>
          String(query).includes("standalone")
            ? {
                matches: true,
                addEventListener() {},
                removeEventListener() {},
                addListener() {},
                removeListener() {},
              }
            : asli(query);
      }
    },
    [INSTALL_KEY, opsi],
  );
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  // Halaman kosong akan “lulus” tanpa membuktikan apa pun — jadi isinya ditunggu.
  await page.waitForFunction(
    () => (document.getElementById("root")?.textContent ?? "").trim().length > 0,
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(600);
  // Ajakan 10 detik dijalankan sungguhan (bukan timer tiruan) supaya jedanya ikut
  // diuji: kalau keputusan “sudah terpasang” datang belakangan, ajakannya justru
  // muncul di sini.
  if (opsi.tunggu > 0) await page.waitForTimeout(opsi.tunggu);
  return {
    halaman: page,
    tombol: await page.locator(TOMBOL).count(),
    header: await page.locator("header").count(),
    ajakan: await page.evaluate(
      (teks) => (document.body.textContent ?? "").includes(teks),
      AJAKAN,
    ),
    catatan: await page.evaluate((key) => window.localStorage.getItem(key), INSTALL_KEY),
    async tutup() {
      await context.close();
    },
  };
}

let failure = null;

try {
  // 1. Kontrol — belum memasang, sudah pernah diundang: tombolnya **harus** ada.
  //    Tanpa pembanding ini, “tidak ada tombol di mana-mana” juga akan lulus.
  const belum = await buka({ catatan: BELUM_TERPASANG });
  check(
    "beranda benar-benar terbuka (header ada)",
    belum.header === 1,
    `header=${belum.header}`,
  );
  check(
    "belum memasang: tombol “Pasang” ada di header beranda",
    belum.tombol === 1,
    `tombol=${belum.tombol}`,
  );
  // Tombol dibuka: peramban tidak menawarkan pemasangan di sini, jadi yang tampil
  // adalah langkah manualnya — di situlah peringatan alamat sementara ikut muncul.
  await belum.halaman.locator(TOMBOL).click();
  await belum.halaman.waitForTimeout(300);
  const notis = belum.halaman.locator(NOTIS_SEMENTARA);
  const jumlahNotis = await notis.count();
  if (ALAMAT_SEMENTARA) {
    check(
      `alamat sementara (${HOST}): petunjuk pasang memperingatkan ikonnya nanti tidak bisa dibuka`,
      jumlahNotis === 1 &&
        (await notis.first().textContent())?.includes(ALAMAT_TETAP) === true,
      `jumlah=${jumlahNotis}`,
    );
  } else {
    check(
      `alamat tetap (${HOST}): tidak ada peringatan alamat sementara`,
      jumlahNotis === 0,
      `jumlah=${jumlahNotis}`,
    );
  }
  await belum.tutup();

  // 2. Keluhan yang dilaporkan: perangkat ini **sudah memasang** aplikasinya, lalu
  //    alamatnya dibuka di tab browser biasa.
  const sudah = await buka({ catatan: SUDAH_TERPASANG });
  check(
    "sudah memasang (catatan perangkat): tombol “Pasang” tidak ada lagi, walau di tab browser",
    sudah.tombol === 0,
    `tombol=${sudah.tombol}`,
  );
  check(
    "catatan pemasangannya tidak ditulis ulang",
    sudah.catatan === JSON.stringify(SUDAH_TERPASANG),
    sudah.catatan,
  );
  await sudah.tutup();

  // 3. Peramban yang bisa ditanya (Chromium) menjawab “sudah terpasang” dari tab
  //    biasa: ajakan 10 detik harus dibatalkan dan buktinya dicatat di perangkat.
  const dijawab = await buka({
    relatedApps: [{ id: "/", platform: "webapp", url: `${BASE}/manifest.webmanifest` }],
    tunggu: 11_000,
  });
  check(
    "jawaban “sudah terpasang” membatalkan ajakan 10 detik (ditunggu sungguhan 11 detik)",
    !dijawab.ajakan && dijawab.tombol === 0,
    `ajakan=${dijawab.ajakan} tombol=${dijawab.tombol}`,
  );
  check(
    "jawaban itu juga dicatat di perangkat (kunjungan berikutnya tidak ditawari lagi)",
    Boolean(JSON.parse(dijawab.catatan ?? "{}").installedAt),
    dijawab.catatan,
  );
  await dijawab.tutup();

  // 4. Dibuka dari ikon aplikasi (mode jendela aplikasi) — juga bukti pemasangan.
  const dariIkon = await buka({ standalone: true });
  check(
    "dibuka dari ikon aplikasi: tanpa tombol (dan buktinya dicatat)",
    dariIkon.tombol === 0 && Boolean(JSON.parse(dariIkon.catatan ?? "{}").installedAt),
    `tombol=${dariIkon.tombol} catatan=${dariIkon.catatan}`,
  );
  await dariIkon.tutup();
} catch (error) {
  failure = error;
} finally {
  await browser.close();
}

if (failure) {
  for (const result of results) {
    console.log(`${result.ok ? "✓" : "✗"} ${result.name}`);
  }
  console.error(`\n✗ ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`${results.length}/${results.length} checks passed against ${BASE}`);
  process.exit(0);
}

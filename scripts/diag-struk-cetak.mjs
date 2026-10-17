/**
 * Diagnostik: **kenapa struk yang dicetak bisa kehilangan bagian atasnya**
 * (logo, nama toko, alamat, barang, kasir) sehingga yang terlihat hanya bagian
 * bawahnya (TOTAL/Bayar/Kembali/catatan kaki) — laporan pengguna dari ponsel.
 *
 * Dugaan yang diukur skrip ini: `.struk-cetak` hidup di dalam `<main>` yang
 * **selalu setinggi layar dan bisa digulir** (`app-shell-height` +
 * `overflow-y-auto`), jadi begitu halaman kasir tergulir, elemen berposisi
 * `absolute` itu ikut tergeser ke atas jendela gulir dan terpotong saat dicetak.
 *
 * Untuk tiap ukuran layar & posisi gulir, skrip mengukur: kotak area cetak,
 * jumlah halaman PDF (kertas struk & A4), dan piksel gelap di pita paling atas
 * area cetak (bukti baris pertama/logo benar-benar ikut tercetak). Lalu hal yang
 * sama diukur ulang dengan satu kandidat perbaikan disuntikkan.
 *
 * Usage: PLAYWRIGHT_DIR=/tmp/pw bun scripts/diag-struk-cetak.mjs [http://localhost:5173]
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/+$/, "");
const SHOTS = "/tmp/browser-shots";

const playwrightDir = process.env.PLAYWRIGHT_DIR;
const requireFrom = playwrightDir
  ? createRequire(`${playwrightDir.replace(/\/+$/, "")}/`)
  : createRequire(import.meta.url);
const { chromium } = requireFrom("playwright");

mkdirSync(SHOTS, { recursive: true });

const session = {
  user: { name: "Uji Cetak", email: "diag-cetak@mesinpos.test" },
  tenant: {
    name: "Warung Diag Cetak",
    slug: "warung-diag-cetak",
    storeName: "Cabang Diag",
    vertical: "umkm",
    verticals: ["umkm", "fnb"],
    planKey: "enterprise",
    role: "owner",
    taxActive: true,
    taxRatePct: 11,
    // Pengingat tutup shift dimatikan: yang diperiksa di sini hasil cetaknya,
    // dan bannernya tidak boleh mengubahnya tergantung jam diagnosanya.
    shift: { active: false, reminderHour: 21, longShiftHours: 14 },
    createdAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
  },
};

/**
 * Pembanding yang disuntikkan: **keadaan bug yang dilaporkan** — area cetak
 * dikembalikan ke `position: absolute` seperti sebelum diperbaiki. Jadi “SEBELUM”
 * adalah perilaku sekarang (fixed, benar) dan “SESUDAH” adalah keadaan lamanya;
 * angkanya berdampingan supaya bedanya terlihat langsung di satu layar/ukuran.
 */
const KANDIDAT = {
  nama: "dikembalikan ke position: absolute (keadaan bug yang dilaporkan)",
  css: `@media print { .struk-cetak { position: absolute !important; left: 0 !important; top: 0 !important; } }`,
};

const browser = await chromium.launch();

/** Jumlah halaman PDF: “/Type /Page” per halaman, “/Type /Pages” pohonnya. */
const halaman = (bytes) =>
  (bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

for (const ukuran of [
  { label: "ponsel 390×844", width: 390, height: 844 },
  { label: "desktop 1400×950", width: 1400, height: 950 },
]) {
  const context = await browser.newContext({
    viewport: { width: ukuran.width, height: ukuran.height },
  });
  await context.addInitScript(([key, value]) => {
    try {
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
    } catch {
      // Penyimpanan diblokir: bukan bagian yang diperiksa.
    }
  }, ["mesinpos.session.v1", JSON.stringify(session)]);

  // Gerbang kasir (`posShiftGate`): tanpa shift yang terbuka, halaman Kasir
  // menolak menjual — sedangkan diagnosa ini memang membeli satu produk.
  await context.addInitScript(
    ([key, id]) => {
      try {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            current: {
              id,
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
      } catch {
        // Penyimpanan diblokir: bukan bagian yang diperiksa.
      }
    },
    ["mesinpos.shifts.v1", `shift-diag-cetak-${ukuran.width}`],
  );

  const page = await context.newPage();
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Cappuccino/ }).first().click();
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  await page.waitForSelector('[data-testid="cash-cepat-10000"]', { timeout: 30_000 });
  await page.locator('[data-testid="cash-cepat-100000"]').click();
  await page.getByRole("button", { name: "Selesaikan pembayaran" }).click();
  await page.waitForSelector('[data-testid="struk-unduh-pdf"]', { timeout: 30_000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  /** Kotak area cetak + keadaan `<main>` yang menggulirnya. */
  const ukur = async () =>
    await page.evaluate(() => {
      const cetak = document.querySelector('[data-testid="struk-cetak"]');
      const main = document.querySelector("main");
      const r = cetak?.getBoundingClientRect();
      return {
        cetak: r
          ? {
              top: Math.round(r.top),
              bottom: Math.round(r.bottom),
              left: Math.round(r.left),
            }
          : null,
        posisi: cetak ? window.getComputedStyle(cetak).position : null,
        main: main
          ? { scrollTop: main.scrollTop, clientHeight: main.clientHeight }
          : null,
        leluhurBerkontainmen: (() => {
          const khusus = [];
          for (let el = cetak?.parentElement; el; el = el.parentElement) {
            const style = window.getComputedStyle(el);
            if (style.transform !== "none") khusus.push("transform");
            if (style.filter !== "none") khusus.push("filter");
            if (style.backdropFilter && style.backdropFilter !== "none")
              khusus.push("backdrop-filter");
            if (style.perspective !== "none") khusus.push("perspective");
            if (style.contain !== "none") khusus.push("contain");
          }
          return khusus;
        })(),
      };
    });

  /** Piksel gelap di pita paling atas area cetak (logo / baris pertama struk). */
  const pita = async () => {
    const bytes = await page.screenshot({ clip: { x: 0, y: 0, width: 320, height: 40 } });
    return await page.evaluate(async (base64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let gelap = 0;
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i] + data[i + 1] + data[i + 2]) / 3 < 128) gelap += 1;
      }
      return gelap;
    }, bytes.toString("base64"));
  };

  const lapor = async (label) => {
    const u = await ukur();
    const pdfStruk = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const pdfA4 = await page.pdf({ printBackground: true });
    const gelap = await pita();
    console.log(
      `  ${label}: rect=${JSON.stringify(u.cetak)} posisi=${u.posisi} main.scrollTop=${u.main?.scrollTop}/${u.main?.clientHeight} ` +
        `pdfStruk=${pdfStruk.length}B/${halaman(pdfStruk)}hlm pdfA4=${pdfA4.length}B/${halaman(pdfA4)}hlm pikselGelapAtas=${gelap} ` +
        `leluhurBerkontainmen=${JSON.stringify(u.leluhurBerkontainmen)}`,
    );
  };

  for (const gulir of ["atas", "bawah"]) {
    await page.evaluate((arah) => {
      const main = document.querySelector("main");
      if (main) main.scrollTop = arah === "bawah" ? main.scrollHeight : 0;
    }, gulir);
    await page.emulateMedia({ media: "print" });
    await page.waitForTimeout(200);

    console.log(`\n=== ${ukuran.label} · gulir ${gulir} ===`);
    await lapor("SEBELUM");

    const handle = await page.addStyleTag({ content: KANDIDAT.css });
    await page.waitForTimeout(150);
    await lapor(`SESUDAH (${KANDIDAT.nama})`);
    await handle.evaluate((node) => node.remove());

    await page.screenshot({
      path: `${SHOTS}/diag-cetak-${ukuran.width}-${gulir}.png`,
      fullPage: true,
    });
    await page.emulateMedia({ media: "screen" });
  }

  await context.close();
}

await browser.close();

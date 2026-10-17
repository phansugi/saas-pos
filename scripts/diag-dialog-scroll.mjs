/**
 * Diagnostik: **isi dialog bisa digulir & terjangkau?**
 *
 * Kenapa ada: laporan pemilik repo (tangkapan layar ponsel) — dialog “Struk
 * belanja” di kasir tingginya melebihi layar dan **tidak bisa digulir**, jadi
 * bagian bawahnya (kolom nomor WhatsApp, daftar PDF, tombol Tutup) tidak pernah
 * bisa dibaca kasir. Layar desktop 1400×950 tidak pernah menunjukkan gejala ini,
 * karena dialognya muat semuanya.
 *
 * Yang diukur (semua dari peramban sendiri, bukan dari kode sumber):
 *
 *   - kotak dialog vs tinggi layar: berapa piksel yang keluar layar di atas/bawah,
 *   - leluhur yang bisa digulir (dialognya? lapisannya? dokumennya?),
 *   - kontrol paling bawah di dalam dialog (“Tutup”) — apakah berada di layar
 *     tanpa menggulir, dan apakah **terjangkau** setelah menggulir apa pun yang
 *     bisa digulir.
 *
 * Prasyarat sama seperti harness peramban lain: Playwright di luar repo
 * (`PLAYWRIGHT_DIR`) dan preview yang sedang berjalan.
 *
 * Ukuran yang diukur juga menyertakan **tinggi layar pendek** (mis. 360×740 =
 * ponsel dengan bilah alamat terlihat) dan keadaan isi yang **penuh** seperti
 * tangkapan layar pemilik repo: sudah ada satu PDF terunduh (daftar PDF muncul),
 * nomor WhatsApp sudah diisi, dan kirimannya sudah dicoba (notis + tautan wa.me
 * ikut tampil) — itulah yang membuat dialognya paling tinggi.
 *
 * Usage:
 *   PLAYWRIGHT_DIR=/tmp/pw bun scripts/diag-dialog-scroll.mjs [baseUrl] [lebarxTinggi…]
 *   PLAYWRIGHT_DIR=/tmp/pw bun scripts/diag-dialog-scroll.mjs http://localhost:5173 360x740 390x844
 *
 * Default: `http://localhost:5173` dan `360x740` — sesi demo ditanam skrip ini,
 * jadi tidak ada data siapa pun yang disentuh.
 */
import { createRequire } from "node:module";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/+$/, "");
const UKURAN = (process.argv.slice(3).length > 0 ? process.argv.slice(3) : ["360x740"])
  .map((teks) => teks.split("x").map(Number))
  .filter(([lebar, tinggi]) => lebar > 0 && tinggi > 0);

const playwrightDir = process.env.PLAYWRIGHT_DIR;
const requireFrom = playwrightDir
  ? createRequire(`${playwrightDir.replace(/\/+$/, "")}/`)
  : createRequire(import.meta.url);
const { chromium } = requireFrom("playwright");

const SESSION = {
  user: { name: "Diagnosa Dialog", email: "diag-dialog@mesinpos.test" },
  tenant: {
    name: "Warung Diagnosa Dialog",
    slug: "warung-diagnosa-dialog",
    storeName: "Cabang Diagnosa",
    vertical: "umkm",
    verticals: ["umkm", "fnb"],
    planKey: "enterprise",
    role: "owner",
    taxActive: true,
    taxRatePct: 11,
    // Pengingat tutup shift dimatikan: yang diukur di sini dialog & gulirannya,
    // dan bannernya tidak boleh mengubah hasilnya tergantung jam diagnosanya.
    shift: { active: false, reminderHour: 21, longShiftHours: 14 },
    createdAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
  },
};

/**
 * Isi dialog diukur dari sudut pandang yang bisa dibaca orang: berapa bagian
 * dialog yang keluar layar, dan mana yang masih bisa dijangkau dengan menggulir.
 *
 * Dipakai untuk **dua** dialog yang benar-benar dipakai di ponsel: Pembayaran
 * (sebelum lunas) dan Struk belanja (sesudah lunas).
 */
const UKUR = (selector) => {
  const dialog = document.querySelector(selector);
  if (!dialog) return { ada: false };
  const kotak = (el) => {
    const r = el.getBoundingClientRect();
    return {
      atas: Math.round(r.top),
      bawah: Math.round(r.bottom),
      tinggi: Math.round(r.height),
    };
  };
  // Leluhur yang benar-benar bisa digulir (punya kelebihan tinggi di dalamnya).
  const bisaDigulir = [];
  for (let el = dialog; el; el = el.parentElement) {
    const gaya = window.getComputedStyle(el);
    const bisa = /auto|scroll/.test(gaya.overflowY) && el.scrollHeight > el.clientHeight + 1;
    if (bisa) bisaDigulir.push(el.dataset?.testid ?? el.className.toString().slice(0, 40));
  }
  const paling = [...dialog.querySelectorAll("button")].at(-1);
  const sebelum = paling ? kotak(paling) : null;
  // Gulir apa pun yang bisa digulir, lalu lihat apakah kontrol terakhir terjangkau.
  for (const el of [dialog, ...(function* () {
    for (let node = dialog.parentElement; node; node = node.parentElement) yield node;
  })()]) {
    el.scrollTop = el.scrollHeight;
  }
  if (document.scrollingElement) document.scrollingElement.scrollTop = 1e9;
  const sesudah = paling ? kotak(paling) : null;
  return {
    ada: true,
    layar: { tinggi: window.innerHeight, lebar: window.innerWidth },
    panjangTeks: (dialog.textContent ?? "").replace(/\s+/g, " ").trim().length,
    jumlahTombol: dialog.querySelectorAll("button").length,
    dialog: kotak(dialog),
    keluarAtas: Math.max(0, -kotak(dialog).atas),
    keluarBawah: Math.max(0, kotak(dialog).bawah - window.innerHeight),
    bisaDigulir,
    dokumenBisaDigulir:
      document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight + 1,
    kontrolTerakhir: {
      label: (paling?.textContent ?? "").trim(),
      sebelum,
      sesudah,
      terjangkau:
        Boolean(sesudah) &&
        sesudah.atas >= 0 &&
        sesudah.bawah <= window.innerHeight + 1,
    },
  };
};

/**
 * “Pembayaran” sebelum lunas — dialog yang paling sering dibuka kasir di ponsel.
 * Dipilih dari tombol tutupnya (bukan `data-testid`), supaya angka “sebelum
 * diperbaiki” bisa diukur **tanpa** mengubah aplikasinya lebih dulu.
 */
const DIALOG_BAYAR = 'div.fixed:has([aria-label="Tutup pembayaran"]) > div';

const browser = await chromium.launch({ args: ["--no-sandbox"] });
let gagal = null;

function lapor(nama, lebar, tinggi, hasil) {
  console.log(`\n=== ${nama} · ${lebar}×${tinggi} → ${BASE} ===`);
  if (!hasil.ada) {
    console.log("dialog tidak terbuka");
    gagal = new Error(`${nama}: dialog tidak terbuka`);
    return;
  }
  console.log(`teks dialog: ${hasil.panjangTeks} karakter · ${hasil.jumlahTombol} tombol`);
  console.log(
    `dialog: tinggi=${hasil.dialog.tinggi}px atas=${hasil.dialog.atas} bawah=${hasil.dialog.bawah} ` +
      `(layar ${hasil.layar.tinggi}px) → keluar atas=${hasil.keluarAtas}px bawah=${hasil.keluarBawah}px`,
  );
  console.log(
    `yang bisa digulir: [${hasil.bisaDigulir.join(" | ") || "-"}] · dokumen: ${
      hasil.dokumenBisaDigulir ? "bisa" : "tidak"
    }`,
  );
  console.log(
    `kontrol terakhir “${hasil.kontrolTerakhir.label}”: sebelum gulir ${JSON.stringify(
      hasil.kontrolTerakhir.sebelum,
    )} → sesudah gulir ${JSON.stringify(hasil.kontrolTerakhir.sesudah)} → terjangkau=${
      hasil.kontrolTerakhir.terjangkau ? "YA" : "TIDAK"
    }`,
  );
}

try {
  for (const [lebar, tinggi] of UKURAN) {
    const context = await browser.newContext({
      viewport: { width: lebar, height: tinggi },
      isMobile: true,
      hasTouch: true,
    });
    await context.addInitScript(
      ([key, value]) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          // Penyimpanan diblokir: bukan bagian yang diukur.
        }
      },
      ["mesinpos.session.v1", JSON.stringify(SESSION)],
    );
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
          // Penyimpanan diblokir: bukan bagian yang diukur.
        }
      },
      ["mesinpos.shifts.v1", `shift-diag-${lebar}x${tinggi}`],
    );
    const page = await context.newPage();
    await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Cappuccino/ }).first().click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Bayar", exact: true }).click();
    await page.waitForSelector('[data-testid="cash-cepat-10000"]', { timeout: 30_000 });
    await page.waitForTimeout(200);
    lapor("Dialog Pembayaran", lebar, tinggi, await page.evaluate(UKUR, DIALOG_BAYAR));
    await page.locator('[data-testid="cash-cepat-100000"]').click();
    await page.getByRole("button", { name: "Selesaikan pembayaran" }).click();
    await page.waitForSelector('[data-testid="struk-dialog"]', { timeout: 30_000 });
    await page.waitForTimeout(300);

    // Isi penuh seperti tangkapan layar: satu PDF terunduh (daftar PDF muncul),
    // nomor pembeli diisi, lalu kirimannya dicoba (notis + tautan wa.me).
    try {
      const [unduhan] = await Promise.all([
        page.waitForEvent("download", { timeout: 20_000 }),
        page.locator('[data-testid="struk-unduh-pdf"]').click(),
      ]);
      await unduhan.path();
      await page.locator('[data-testid="struk-daftar-pdf-tombol"]').click();
      await page.locator('[data-testid="struk-nomor-wa"]').fill("0812-3456-7890");
      await page.locator('[data-testid="struk-kirim-wa"]').click();
      await page.waitForTimeout(800);
    } catch (error) {
      console.log(`(isi penuh tidak lengkap: ${error.message.split("\n")[0]})`);
    }

    lapor(
      "Dialog Struk belanja",
      lebar,
      tinggi,
      await page.evaluate(UKUR, '[data-testid="struk-dialog"]'),
    );
    await context.close();
  }
} catch (error) {
  gagal = error;
} finally {
  await browser.close();
}

if (gagal) {
  console.error(`\n✗ ${gagal.message}`);
  process.exitCode = 1;
}

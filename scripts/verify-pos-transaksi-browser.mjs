/**
 * Lembar **“Transaksi terakhir (shift ini)”** di halaman kasir, di browser sungguhan
 * (Chromium/Playwright) atas preview yang sedang berjalan.
 *
 * Kenapa ada: yang diminta pengguna bukan sekadar daftar transaksi, melainkan
 * **tombol yang bisa diklik** dengan **animasi dari bawah ke atas**. Dua hal itu
 * justru yang tidak bisa dibuktikan DOM tiruan: `framer-motion` menjalankan
 * animasinya lewat bingkai demi bingkai di mesin render, sedangkan happy-dom hanya
 * menempelkan atribut gaya. Di sini posisi lembarnya diukur **dari peramban
 * sendiri** setiap bingkai animasi:
 *
 *   1. sebelum diklik tidak ada lembar sama sekali (tidak ada daftar tersembunyi
 *      yang sebenarnya sudah terbuka);
 *   2. saat muncul, lembarnya **benar-benar naik dari bawah** — bingkai pertama
 *      tercatat masih di bawah layar, lalu naik makin tinggi sampai menempel di
 *      tepi bawah;
 *   3. daftarnya memuat **seluruh** penjualan shift itu (bukan enam baris), baris
 *      teratas adalah transaksi terbaru, dan penjualan yang baru diselesaikan di
 *      lembar ini ikut muncul di puncaknya;
 *   4. lembarnya bisa ditutup dengan tiga cara yang wajar: silang, Escape, dan
 *      sentuhan di latarnya.
 *
 * Prasyarat:
 *   1. preview sedang berjalan (sesi demo ditanam skrip ini),
 *   2. Playwright terpasang **di luar repo** (`PLAYWRIGHT_DIR`), sama seperti
 *      `scripts/verify-struk-browser.mjs`.
 *
 * Usage: PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-pos-transaksi-browser.mjs [http://localhost:5173]
 */
import { createRequire } from "node:module";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/+$/, "");

/** Playwright dari direktori terpisah (lihat “Prasyarat” di atas). */
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

/** Sesi demo pemilik toko, supaya `/app/pos` bisa dibuka tanpa alur masuk. */
const session = {
  user: { name: "Uji Transaksi", email: "transaksi-browser@mesinpos.test" },
  tenant: {
    name: "Warung Uji Transaksi",
    slug: "warung-uji-transaksi-browser",
    storeName: "Cabang Transaksi",
    vertical: "umkm",
    verticals: ["umkm", "fnb"],
    planKey: "enterprise",
    role: "owner",
    taxActive: true,
    taxRatePct: 11,
    // Pengingat tutup shift dimatikan: skrip ini menguji daftar transaksinya,
    // bukan pengingatnya, dan bannernya tidak boleh mengubah tata letaknya
    // tergantung jam berapa skrip dijalankan.
    shift: { active: false, reminderHour: 21, longShiftHours: 14 },
    createdAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
  },
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const consoleErrors = [];

await context.addInitScript(([key, value]) => {
  try {
    if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
  } catch {
    // Penyimpanan diblokir: bukan bagian yang diuji di sini.
  }
}, ["mesinpos.session.v1", JSON.stringify(session)]);

/*
  Gerbang kasir (`posShiftGate`): halaman Kasir tidak bisa menjual kalau tidak ada
  shift yang terbuka di perangkat ini, jadi shiftnya dibuka lebih dulu di sini —
  sama seperti kasir sungguhan, yang membukanya di halaman Shift & Kas.
*/
await context.addInitScript(([key, id]) => {
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
    // Penyimpanan diblokir: tombol kasirnya akan menyebut sebabnya sendiri.
  }
}, ["mesinpos.shifts.v1", "shift-uji-browser"]);

const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

const TOMBOL = '[data-testid="transaksi-terakhir-tombol"]';
const LEMBAR = '[data-testid="transaksi-terakhir-lembar"]';
const DAFTAR = '[data-testid="transaksi-terakhir-daftar"]';
const rapi = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** Ringkasan yang ditulis tombol & lembarnya, dibaca apa adanya dari layar. */
async function ringkasan() {
  return await page.evaluate(
    ([tombol, lembar, daftar]) => {
      const angka = (teks) => Number(String(teks ?? "").replace(/[^\d]/g, ""));
      const isiTombol = document.querySelector(tombol)?.textContent ?? "";
      const baris = [...document.querySelectorAll(`${daftar} li`)];
      return {
        isiTombol: isiTombol.replace(/\s+/g, " ").trim(),
        jumlahBaris: baris.length,
        barisPertama: (baris[0]?.textContent ?? "").replace(/\s+/g, " ").trim(),
        labelLembar: document.querySelector(lembar)?.getAttribute("aria-label") ?? null,
        peran: document.querySelector(lembar)?.getAttribute("role") ?? null,
        // Angka di dalam teks tombol: “12 transaksi · 15 item · Rp 1.234.000”.
        angka: (isiTombol.match(/\d+ transaksi/g) ?? []).map(angka)[0] ?? null,
      };
    },
    [TOMBOL, LEMBAR, DAFTAR],
  );
}

try {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(TOMBOL, { timeout: 45_000 });
  await page.waitForTimeout(300);

  const awal = await ringkasan();
  check(
    "halaman kasir punya tombol “Transaksi terakhir (shift ini)” di bagian bawah, dan daftarnya belum terbuka",
    (await page.locator(LEMBAR).count()) === 0 &&
      awal.isiTombol.includes("Transaksi terakhir (shift ini)") &&
      awal.isiTombol.includes("Lihat daftar") &&
      (await page.locator(`${TOMBOL}`).getAttribute("aria-expanded")) === "false",
    `${awal.isiTombol} · lembar=${await page.locator(LEMBAR).count()}`,
  );
  check(
    "tombolnya sudah menyebut jumlah transaksi shift ini, bukan tombol kosong",
    awal.jumlahBaris === 0 && typeof awal.angka === "number" && awal.angka > 0,
    `${awal.angka} transaksi · ${awal.isiTombol}`,
  );

  /*
    Pengambil contoh per bingkai dipasang **sebelum** klik: ia merekam posisi
    lembar setiap kali mesin render menggambar ulang, jadi yang diperiksa adalah
    lintasan animasinya, bukan hanya keadaan akhirnya.
  */
  await page.evaluate(() => {
    window.__sampelLembar = [];
    const kumpulkan = () => {
      const lembar = document.querySelector('[data-testid="transaksi-terakhir-lembar"]');
      if (lembar) {
        const kotak = lembar.getBoundingClientRect();
        window.__sampelLembar.push({
          top: Math.round(kotak.top),
          bottom: Math.round(kotak.bottom),
          tinggiLayar: window.innerHeight,
        });
      }
      if (window.__sampelLembar.length < 120) requestAnimationFrame(kumpulkan);
    };
    requestAnimationFrame(kumpulkan);
  });

  await page.locator(TOMBOL).click();
  await page.waitForFunction(() => window.__sampelLembar.length >= 80, null, {
    timeout: 15_000,
  });
  const sampel = await page.evaluate(() => window.__sampelLembar);
  const pertama = sampel[0];
  const terakhir = sampel[sampel.length - 1];
  const naik = sampel.filter((titik) => titik.top < pertama.top - 1).length;
  check(
    "lembarnya muncul dari bawah lalu naik ke tepi bawah layar — bukan langsung menempel",
    sampel.length >= 80 &&
      pertama.top >= pertama.tinggiLayar - 2 &&
      Math.abs(terakhir.bottom - terakhir.tinggiLayar) <= 2 &&
      naik >= 3 &&
      new Set(sampel.map((titik) => titik.top)).size >= 5,
    `${sampel.length} bingkai · top pertama ${pertama.top} → ${terakhir.top} (layar ${pertama.tinggiLayar}) · ${naik} bingkai bergerak naik`,
  );
  check(
    "posisi akhirnya menempel di bawah, dan tepi atasnya benar-benar berada di dalam layar",
    terakhir.bottom === terakhir.tinggiLayar &&
      terakhir.top > 0 &&
      terakhir.top < terakhir.tinggiLayar,
    `top=${terakhir.top} bottom=${terakhir.bottom} layar=${terakhir.tinggiLayar}`,
  );

  const terbuka = await ringkasan();
  check(
    "lembarnya berdialog (role=dialog, aria-modal) dengan judul yang menyebut shift ini",
    terbuka.peran === "dialog" &&
      terbuka.labelLembar === "Transaksi terakhir (shift ini)" &&
      (await page.locator(LEMBAR).getAttribute("aria-modal")) === "true",
    `${terbuka.peran} · ${terbuka.labelLembar}`,
  );
  check(
    "daftarnya memuat transaksi shift ini sebanyak yang disebut tombolnya",
    terbuka.jumlahBaris === terbuka.angka && terbuka.angka > 0,
    `${terbuka.jumlahBaris} baris vs ${terbuka.angka} transaksi di tombol`,
  );
  check(
    "tiap baris menyebut nomor nota, jam, jumlah item, metode bayar, dan totalnya",
    /^[A-Z]+-\d+/.test(terbuka.barisPertama) &&
      /\d{2}[:.]\d{2}/.test(terbuka.barisPertama) &&
      /\d+ item/.test(terbuka.barisPertama) &&
      /Rp/.test(terbuka.barisPertama),
    terbuka.barisPertama,
  );

  /* ----------------------------------- Transaksi baru masuk ke daftarnya */
  /*
    Bukti terakhir yang paling berguna bagi kasir: penjualan yang baru saja
    diselesaikan muncul di puncak daftar — jadi lembarnya membaca penjualan yang
    **benar-benar tercatat**, bukan salinan yang dibuat saat halaman dibuka.
  */
  /**
   * Menunggu lembarnya benar-benar lepas dari DOM.
   *
   * Ada animasi keluarnya (`AnimatePresence`), jadi elemennya tidak hilang seketika
   * setelah diklik — menunggu jumlahnya nol itu memeriksa hasil akhirnya tanpa
   * menebak berapa lama pegasnya mereda.
   */
  async function tungguLembarHilang() {
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="transaksi-terakhir-lembar"]').length === 0,
      null,
      { timeout: 10_000 },
    );
  }

  await page.locator('[aria-label="Tutup transaksi terakhir"]').click();
  await tungguLembarHilang();
  check(
    "silang di lembarnya menutupnya, dan tombolnya kembali menyatakan tertutup",
    (await page.locator(LEMBAR).count()) === 0 &&
      (await page.locator(TOMBOL).getAttribute("aria-expanded")) === "false",
    `lembar=${await page.locator(LEMBAR).count()}`,
  );

  /** Satu penjualan tunai utuh dari kasir; mengembalikan nomor notanya. */
  async function jualSatu() {
    await page.getByRole("button", { name: /Cappuccino/ }).first().click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "Bayar", exact: true }).click();
    await page.waitForSelector('[data-testid="cash-cepat-100000"]', { timeout: 20_000 });
    await page.locator('[data-testid="cash-cepat-100000"]').click();
    await page.getByRole("button", { name: "Selesaikan pembayaran" }).click();
    await page.waitForSelector('[data-testid="struk-dialog"]', { timeout: 20_000 });
    const nomor = await page.evaluate(() => {
      const teks =
        document.querySelector('[data-testid="struk-cetak-lembar-1"]')?.textContent ?? "";
      return (
        teks
          .split("\n")
          .find((baris) => baris.trim().startsWith("No."))
          ?.replace(/^No\.\s*/, "")
          .trim() ?? ""
      );
    });
    await page.locator('[aria-label="Tutup struk"]').click();
    await page.waitForTimeout(400);
    return nomor;
  }

  /*
    Dua penjualan supaya jumlahnya melewati batas tabel lama (enam baris terakhir):
    kalau daftarnya masih dipotong seperti itu, jumlah barisnya tidak akan sama
    dengan angka yang disebut tombolnya.
  */
  const nomorPertama = await jualSatu();
  const nomorBaru = await jualSatu();

  const sesudahJual = await ringkasan();
  check(
    "setiap penjualan yang diselesaikan menambah jumlah transaksi di tombolnya",
    sesudahJual.angka === awal.angka + 2,
    `${awal.angka} → ${sesudahJual.angka} (nota ${nomorPertama}, ${nomorBaru})`,
  );

  await page.locator(TOMBOL).click();
  await page.waitForSelector(LEMBAR, { timeout: 15_000 });
  await page.waitForTimeout(800);
  const setelahJual = await ringkasan();
  check(
    "daftarnya memuat seluruh transaksi shift ini — lebih banyak dari batas enam baris tabel lama — sebanyak yang disebut tombolnya",
    setelahJual.jumlahBaris === sesudahJual.angka && sesudahJual.angka > 6,
    `${setelahJual.jumlahBaris} baris vs ${sesudahJual.angka} transaksi di tombol`,
  );
  check(
    "transaksi terbaru itu muncul di puncak daftar lembar transaksinya",
    nomorBaru !== "" &&
      setelahJual.barisPertama.includes(nomorBaru) &&
      !setelahJual.barisPertama.includes(nomorPertama),
    `${setelahJual.barisPertama} vs nota ${nomorBaru} (sebelumnya ${nomorPertama})`,
  );

  /* --------------------------------------------- Tiga cara menutupnya */
  await page.keyboard.press("Escape");
  await tungguLembarHilang();
  check(
    "tekanan Escape menutup lembar transaksinya",
    (await page.locator(LEMBAR).count()) === 0,
    `lembar=${await page.locator(LEMBAR).count()}`,
  );

  await page.locator(TOMBOL).click();
  await page.waitForSelector(LEMBAR, { timeout: 15_000 });
  await page.waitForTimeout(600);
  await page.locator('[data-testid="transaksi-terakhir-latar"]').click({ position: { x: 10, y: 10 } });
  await tungguLembarHilang();
  check(
    "sentuhan di latarnya juga menutup lembarnya (daftar tidak mengunci layar kasir)",
    (await page.locator(LEMBAR).count()) === 0,
    `lembar=${await page.locator(LEMBAR).count()}`,
  );

  check(
    "kasir tanpa galat konsol di alur lembar transaksi",
    consoleErrors.length === 0,
    consoleErrors.join(" | ").slice(0, 300),
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}

if (process.exitCode !== 1) {
  for (const result of results) console.log(`✓ ${result.name}`);
  console.log(`\n${results.length}/${results.length} pemeriksaan lulus.`);
}

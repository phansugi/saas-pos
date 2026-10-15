/**
 * Bip kasir & warna kartu dashboard di **browser sungguhan** (Chromium/Playwright)
 * atas preview yang sedang berjalan.
 *
 * Kenapa ada: `bun scripts/verify-scan-beep.mjs` sudah membuktikan nada yang
 * dijadwalkan dan `bun scripts/verify-render.mjs` membuktikan **kapan** halaman
 * memanggilnya, tetapi dua hal itu belum membuktikan Web Audio peramban yang
 * sebenarnya: bahwa ketukan produk benar-benar membuka `AudioContext` dan
 * menjadwalkan nada di dalamnya, serta bahwa empat kartu dashboard benar-benar
 * tercat warna berbeda saat dirender.
 *
 * Cara kerjanya tidak menebak: `AudioContext` diganti pembungkus yang mencatat
 * setiap konteks yang dibuat dan setiap nada yang dijadwalkan (frekuensi, bentuk
 * gelombang, dan jam mulai/berhentinya), sedangkan warna kartu dibaca dari
 * **gaya terhitung** yang benar-benar dipakai peramban.
 *
 * Prasyarat:
 *   1. preview sedang berjalan (sesi demo ditanam skrip ini),
 *   2. Playwright terpasang **di luar repo** (`PLAYWRIGHT_DIR`), sama seperti
 *      `scripts/verify-version-browser.mjs`.
 *
 * Usage: PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-bip-warna-browser.mjs [http://localhost:5173]
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
// Resep nada dibaca dari modul yang sama dengan yang dipakai halaman kasir, bukan
// disalin ulang: menaikkan frekuensi di `scanBeep.ts` langsung ikut terperiksa.
import {
  SCAN_BEEP,
  SCAN_BEEP_MAX_GAIN,
  SCAN_BEEP_STORAGE_KEY,
  SCAN_BEEP_VOLUME_DEFAULT,
  SCAN_BEEP_VOLUME_STORAGE_KEY,
} from "../src/lib/scanBeep.ts";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/+$/, "");
const SHOTS = "/tmp/browser-shots";

/** Playwright dari direktori terpisah (lihat “Prasyarat” di atas). */
const playwrightDir = process.env.PLAYWRIGHT_DIR;
const requireFrom = playwrightDir
  ? createRequire(`${playwrightDir.replace(/\/+$/, "")}/`)
  : createRequire(import.meta.url);
const { chromium } = requireFrom("playwright");

mkdirSync(SHOTS, { recursive: true });

const NADA_HZ = SCAN_BEEP.frequencyHz;
const NADA_MS = SCAN_BEEP.durationMs;
const NADA_GELOMBANG = SCAN_BEEP.waveform;

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

/** Sesi demo pemilik toko, supaya `/app` bisa dibuka tanpa alur masuk. */
const session = {
  user: { name: "Uji Bip", email: "bip@mesinpos.test" },
  tenant: {
    name: "Toko Uji Bip",
    slug: "toko-uji-bip",
    storeName: "Pusat",
    vertical: "umkm",
    verticals: ["umkm", "fnb"],
    planKey: "enterprise",
    role: "owner",
    createdAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
  },
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

await context.addInitScript(
  ([key, value]) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Penyimpanan diblokir: bukan bagian yang diuji di sini.
    }

    // Pembungkus AudioContext: konteks asli tetap yang membunyikan nada, tetapi
    // setiap pembuatan konteks dan setiap nada yang dijadwalkan dicatat supaya
    // bisa diperiksa dari luar halaman.
    const catatan = { contexts: 0, instances: [], nodes: [] };
    window.__bip = catatan;

    const Real = window.AudioContext || window.webkitAudioContext;
    if (!Real) return;

    class Terpantau extends Real {
      constructor() {
        super();
        catatan.contexts += 1;
        catatan.instances.push(this);
      }
      createOscillator() {
        const oscillator = super.createOscillator();
        const nada = {
          type: null,
          frequencyHz: null,
          startedAt: null,
          stoppedAt: null,
          // Kekuatan puncak nada — inilah angka yang berubah kalau volume
          // dinaikkan/diturunkan, jadi `createGain` di bawah mengisinya.
          peakGain: null,
        };
        const start = oscillator.start.bind(oscillator);
        const stop = oscillator.stop.bind(oscillator);
        oscillator.start = (time) => {
          nada.startedAt = time;
          nada.type = oscillator.type;
          nada.frequencyHz = oscillator.frequency.value;
          return start(time);
        };
        oscillator.stop = (time) => {
          nada.stoppedAt = time;
          return stop(time);
        };
        catatan.nodes.push(nada);
        return oscillator;
      }
      createGain() {
        const gain = super.createGain();
        // Nada yang sedang disiapkan pemutar bip: `createOscillator` dipanggil
        // tepat sebelum `createGain`, dan amplopnya ditulis ke gain ini.
        const nada = catatan.nodes.at(-1);
        const ramp = gain.gain.exponentialRampToValueAtTime.bind(gain.gain);
        gain.gain.exponentialRampToValueAtTime = (value, time) => {
          if (nada && (nada.peakGain === null || value > nada.peakGain)) {
            nada.peakGain = value;
          }
          return ramp(value, time);
        };
        return gain;
      }
    }

    window.AudioContext = Terpantau;
    window.webkitAudioContext = Terpantau;
  },
  ["mesinpos.session.v1", JSON.stringify(session)],
);

const page = await context.newPage();
const galatKonsol = [];
page.on("console", (message) => {
  if (message.type() === "error") galatKonsol.push(message.text());
});

/** Membaca warna terhitung keempat kartu ringkasan + denyutnya. */
const bacaKartu = () =>
  page.evaluate(() => {
    const kunci = ["omzet", "transaksi", "item", "stok"];
    return Object.fromEntries(
      kunci.map((key) => {
        const card = document.querySelector(`[data-summary="${key}"]`);
        if (!card) return [key, null];
        const style = getComputedStyle(card);
        const strip = card.querySelector('[aria-hidden="true"]');
        const denyut = card.querySelector(".animate-ping");
        return [
          key,
          {
            teks: (card.textContent ?? "").replace(/\s+/g, " ").trim(),
            border: style.borderTopColor,
            latar: style.backgroundImage,
            garisAtas: strip ? getComputedStyle(strip).backgroundImage : null,
            denyut: denyut ? denyut.getBoundingClientRect().width : 0,
          },
        ];
      }),
    );
  });

/** "rgb(16, 185, 129)" → [16, 185, 129] supaya rona warnanya bisa dibandingkan. */
function rgb(text) {
  const match = /rgba?\(([^)]+)\)/.exec(text ?? "");
  if (!match) return null;
  return match[1].split(",").slice(0, 3).map((value) => Number(value.trim()));
}

let failure = null;
try {
  // ── 1. Kartu ringkasan dashboard berwarna ───────────────────────────────
  await page.goto(`${BASE}/app`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-summary="omzet"]', { timeout: 45_000 });
  await page.waitForFunction(
    () => document.body.innerText.includes("Stok kritis"),
    null,
    { timeout: 45_000 },
  );
  await page.screenshot({ path: `${SHOTS}/dashboard-warna.png` });

  const kartu = await bacaKartu();
  check(
    "keempat kartu ringkasan dashboard dirender di browser",
    ["omzet", "transaksi", "item", "stok"].every((key) => kartu[key] !== null),
    JSON.stringify(Object.keys(kartu)),
  );

  const batas = ["omzet", "transaksi", "item", "stok"].map((key) => kartu[key].border);
  check(
    "keempat kartu punya warna batas yang berbeda satu sama lain",
    new Set(batas).size === 4,
    batas.join(" | "),
  );
  const garis = ["omzet", "transaksi", "item", "stok"].map((key) => kartu[key].garisAtas);
  check(
    "garis atas tiap kartu bergradien warna berbeda (bukan kartu putih seragam)",
    garis.every((value) => typeof value === "string" && value.includes("gradient")) &&
      new Set(garis).size === 4,
    garis.map((value) => String(value).slice(0, 48)).join(" || "),
  );

  const omzet = rgb(kartu.omzet.border);
  const stok = rgb(kartu.stok.border);
  check(
    "kartu omzet bernuansa hijau (uang masuk) dan kartu stok bernuansa merah",
    Boolean(omzet && stok) && omzet[1] > omzet[0] && stok[0] > stok[1],
    `omzet=${kartu.omzet.border} stok=${kartu.stok.border}`,
  );
  check(
    "kartu stok yang kritis benar-benar berdenyut (titiknya terlihat)",
    kartu.stok.denyut > 0 &&
      ["omzet", "transaksi", "item"].every((key) => kartu[key].denyut === 0),
    `denyut stok=${kartu.stok.denyut} lainnya=${["omzet", "transaksi", "item"].map((k) => kartu[k].denyut).join(",")}`,
  );
  check(
    "kartu berwarna tetap memuat label & angkanya",
    kartu.omzet.teks.includes("Omzet") &&
      kartu.transaksi.teks.includes("Transaksi") &&
      kartu.item.teks.includes("Item terjual") &&
      kartu.stok.teks.includes("Stok kritis"),
    [kartu.omzet.teks, kartu.transaksi.teks, kartu.item.teks, kartu.stok.teks].join(" | "),
  );

  // ── 2. Bip kasir saat produk diklik ─────────────────────────────────────
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.body.innerText.includes("Keranjang"),
    null,
    { timeout: 45_000 },
  );

  const sebelum = await page.evaluate(() => ({
    contexts: window.__bip.contexts,
    nodes: window.__bip.nodes.length,
  }));
  check(
    "sebelum ada produk diklik belum ada nada sama sekali",
    sebelum.contexts === 0 && sebelum.nodes === 0,
    JSON.stringify(sebelum),
  );

  const produk = page.getByRole("button", { name: /Kopi Susu Gula Aren/ }).first();
  await produk.click();
  await page.waitForFunction(() => window.__bip.nodes.length >= 1, null, { timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}/kasir-bip.png` });

  const sesudahSatu = await page.evaluate(() => ({
    contexts: window.__bip.contexts,
    nodes: window.__bip.nodes.map((nada) => ({ ...nada })),
  }));
  const nada = sesudahSatu.nodes[0];
  check(
    "mengklik produk membuat AudioContext dan menjadwalkan satu bip",
    sesudahSatu.contexts === 1 && sesudahSatu.nodes.length === 1,
    `konteks=${sesudahSatu.contexts} nada=${sesudahSatu.nodes.length}`,
  );
  check(
    `nada bip seperti mesin kasir (${NADA_HZ} Hz, ${NADA_GELOMBANG}, ${NADA_MS} ms)`,
    nada.type === NADA_GELOMBANG &&
      nada.frequencyHz === NADA_HZ &&
      Math.abs((nada.stoppedAt - nada.startedAt) * 1000 - NADA_MS) < 1,
    JSON.stringify(nada),
  );

  const produkLain = page.getByRole("button", { name: /Air Mineral/ }).first();
  await produkLain.click();
  const sesudahDua = await page.evaluate(() => ({
    contexts: window.__bip.contexts,
    nodes: window.__bip.nodes.length,
    keranjang: document.body.innerText.includes("Air Mineral"),
  }));
  check(
    "klik berikutnya berbunyi lagi tanpa membuat konteks baru (dipakai ulang)",
    sesudahDua.contexts === 1 && sesudahDua.nodes === 2 && sesudahDua.keranjang,
    JSON.stringify(sesudahDua),
  );

  // Keadaan peramban: nada yang dijadwalkan di konteks yang masih tertahan
  // autoplay tidak akan terdengar, jadi ini bukan detail sepele.
  // Nada yang dijadwalkan di konteks yang masih tertahan autoplay tidak akan
  // terdengar, jadi keadaan konteks **milik aplikasi** itu diperiksa, bukan
  // konteks baru buatan pengujian.
  await page.waitForTimeout(500);
  const keadaan = await page.evaluate(() => window.__bip.instances[0]?.state ?? "tidak ada");
  check(
    "konteks audio milik kasir tidak terkunci autoplay (nada benar-benar terdengar)",
    keadaan === "running",
    `state=${keadaan}`,
  );

  // ── 3. Setelan bip kasir: bisa dimatikan dari tombol di kasir ───────────
  const tombolBip = page.getByRole("switch", { name: "Bunyi bip saat produk diklik" });
  check(
    "tombol bip kasir ada di header kasir & menyala sejak awal",
    (await tombolBip.count()) === 1 &&
      (await tombolBip.getAttribute("aria-checked")) === "true",
    `jumlah=${await tombolBip.count()} checked=${await tombolBip.getAttribute("aria-checked")}`,
  );

  await tombolBip.click();
  const setelahMatikan = await page.evaluate((kunci) => ({
    checked: document
      .querySelector('[role="switch"][aria-label="Bunyi bip saat produk diklik"]')
      ?.getAttribute("aria-checked"),
    tersimpan: window.localStorage.getItem(kunci),
    nada: window.__bip.nodes.length,
    konteks: window.__bip.contexts,
  }), SCAN_BEEP_STORAGE_KEY);
  check(
    "mematikan bip tersimpan di perangkat ini & tombolnya berubah",
    setelahMatikan.checked === "false" && setelahMatikan.tersimpan === "off",
    JSON.stringify(setelahMatikan),
  );

  await page.getByRole("button", { name: /Kentang Goreng/ }).first().click();
  const saatMati = await page.evaluate(() => ({
    nada: window.__bip.nodes.length,
    konteks: window.__bip.contexts,
    keranjang: document.body.innerText.includes("Pesanan baru"),
  }));
  check(
    "produk yang diklik saat bip mati tidak menjadwalkan nada sama sekali",
    saatMati.nada === setelahMatikan.nada &&
      saatMati.konteks === setelahMatikan.konteks &&
      saatMati.keranjang,
    JSON.stringify(saatMati),
  );

  await tombolBip.click();
  const menyala = await page.evaluate((kunci) => ({
    checked: document
      .querySelector('[role="switch"][aria-label="Bunyi bip saat produk diklik"]')
      ?.getAttribute("aria-checked"),
    tersimpan: window.localStorage.getItem(kunci),
    nada: window.__bip.nodes.length,
  }), SCAN_BEEP_STORAGE_KEY);
  check(
    "menyalakan lagi menyimpan setelannya & langsung membunyikan contoh nada",
    menyala.checked === "true" &&
      menyala.tersimpan === "on" &&
      menyala.nada === saatMati.nada + 1,
    JSON.stringify(menyala),
  );

  await page.getByRole("button", { name: /Roti Bakar/ }).first().click();
  const sesudahNyalakan = await page.evaluate(() => window.__bip.nodes.length);
  check(
    "setelah dinyalakan, ketukan produk berbunyi lagi seperti semula",
    sesudahNyalakan === menyala.nada + 1,
    `nada=${menyala.nada} → ${sesudahNyalakan}`,
  );

  // ── 4. Volume bip: naik/turun dari kasir, dan kekuatan yang benar-benar dijadwalkan
  const nilaiVolume = () =>
    page.evaluate(
      () =>
        document.querySelector('[data-testid="pos-beep-volume"]')?.textContent?.trim() ?? null,
    );
  const nadaTerakhir = () => page.evaluate(() => ({ ...window.__bip.nodes.at(-1) }));

  check(
    "kontrol volume ada di header kasir & menyebut volume bawaannya",
    (await nilaiVolume()) === `${SCAN_BEEP_VOLUME_DEFAULT} %`,
    `volume=${await nilaiVolume()}`,
  );

  const sebelumNaik = await page.evaluate(() => window.__bip.nodes.length);
  await page.getByRole("button", { name: "Besarkan volume bip" }).click();
  await page.waitForFunction(
    (sebelum) => window.__bip.nodes.length > sebelum,
    sebelumNaik,
    { timeout: 10_000 },
  );
  const sesudahNaik = await page.evaluate((kunci) => ({
    label: document.querySelector('[data-testid="pos-beep-volume"]')?.textContent?.trim() ?? null,
    tersimpan: window.localStorage.getItem(kunci),
  }), SCAN_BEEP_VOLUME_STORAGE_KEY);
  check(
    "menaikkan volume dari kasir bergerak satu langkah & tersimpan di perangkat",
    sesudahNaik.label === "80 %" && sesudahNaik.tersimpan === "80",
    JSON.stringify(sesudahNaik),
  );
  check(
    "nada yang benar-benar dijadwalkan setelah dinaikkan memakai kekuatan barunya (0,2)",
    Math.abs(((await nadaTerakhir()).peakGain ?? 0) - SCAN_BEEP_MAX_GAIN * 0.8) < 0.0001,
    `peak=${(await nadaTerakhir()).peakGain}`,
  );

  await page.getByRole("button", { name: /Air Mineral/ }).first().click();
  await page.waitForFunction(
    (sebelum) => window.__bip.nodes.length > sebelum,
    sebelumNaik + 1,
    { timeout: 10_000 },
  );
  check(
    "ketukan produk berbunyi dengan volume yang diatur, bukan kekuatan penuh",
    Math.abs(((await nadaTerakhir()).peakGain ?? 0) - SCAN_BEEP_MAX_GAIN * 0.8) < 0.0001 &&
      (await nadaTerakhir()).frequencyHz === NADA_HZ,
    `peak=${(await nadaTerakhir()).peakGain} nada=${(await nadaTerakhir()).frequencyHz}`,
  );

  // Muat ulang: setelannya harus bertahan di perangkat ini, bukan cuma di memori tab.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.body.innerText.includes("Keranjang"),
    null,
    { timeout: 45_000 },
  );
  check(
    "volume tersimpan di perangkat: setelah muat ulang tetap 80 %",
    (await nilaiVolume()) === "80 %" &&
      (await page.evaluate(
        (kunci) => window.localStorage.getItem(kunci),
        SCAN_BEEP_VOLUME_STORAGE_KEY,
      )) === "80",
    `volume=${await nilaiVolume()}`,
  );

  await page.getByRole("button", { name: /Roti Bakar/ }).first().click();
  await page.waitForFunction(() => window.__bip.nodes.length >= 1, null, { timeout: 10_000 });
  check(
    "setelah muat ulang, ketukan produk tetap memakai volume tersimpan (0,2)",
    Math.abs(((await nadaTerakhir()).peakGain ?? 0) - SCAN_BEEP_MAX_GAIN * 0.8) < 0.0001,
    `peak=${(await nadaTerakhir()).peakGain}`,
  );

  await page.getByRole("button", { name: "Kecilkan volume bip" }).click();
  await page.getByRole("button", { name: "Kecilkan volume bip" }).click();
  const sebelumTurun = await page.evaluate(() => window.__bip.nodes.length);
  await page.getByRole("button", { name: /Kentang Goreng/ }).first().click();
  await page.waitForFunction(
    (sebelum) => window.__bip.nodes.length > sebelum,
    sebelumTurun,
    { timeout: 10_000 },
  );
  check(
    "menurunkan volume dua langkah (80 % → 60 %) juga sampai ke nada yang dijadwalkan (0,15)",
    (await nilaiVolume()) === "60 %" &&
      Math.abs(((await nadaTerakhir()).peakGain ?? 0) - SCAN_BEEP_MAX_GAIN * 0.6) < 0.0001,
    `volume=${await nilaiVolume()} peak=${(await nadaTerakhir()).peakGain}`,
  );
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
  if (galatKonsol.length > 0) console.log(galatKonsol.slice(0, 3).join("\n"));
  process.exit(0);
}

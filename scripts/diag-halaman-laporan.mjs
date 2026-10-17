/**
 * Diagnosa warna halaman Laporan: “berwarna-warni” yang tidak sampai ke layar.
 *
 * Kenapa alat ini ada: kelas Tailwind yang salah, warna yang tertimpa kelas lain, atau
 * lapisan rona yang justru menutupi kartunya tidak terlihat dari kode — hanya terlihat
 * dari **warna yang benar-benar dihitung peramban**. Alat ini membuka halaman Laporan
 * di Chromium sungguhan lalu mencetak, untuk tiap bagian:
 *
 *   1. garis tepi, warna permukaan, pita warna, dan warna kotak ikonnya;
 *   2. warna pita kepala kolom tabelnya (bagian yang paling mudah hilang);
 *   3. rasio kontras judul, keterangan, dan pita kepala kolomnya di **tema gelap**
 *      (tema bawaan proyek) — pita berwarna dengan tulisan samar bukan kemajuan;
 *   4. dua tangkapan layar (`/tmp/laporan-desktop.png`, `/tmp/laporan-ponsel.png`,
 *      dan `/tmp/laporan-gelap.png`) untuk dilihat manusia.
 *
 * Bandingkan hasilnya dengan pemeriksaan yang sudah otomatis di
 * `verify-laporan-browser.mjs` (pita kepala kolom, baris selang-seling, baris jumlah,
 * jarak dalam sel, dan kontras ≥ 4,5:1). Kalau angkanya berbeda dari yang tertulis di
 * `worklog.md`, salah satu berubah — dan itu yang perlu diketahui.
 *
 * Prasyarat sama seperti harness peramban lain (paket peramban di luar repo, preview
 * sedang berjalan):
 *
 *   mkdir -p /tmp/pw && cd /tmp/pw && bun init -y && bun add playwright
 *   bunx playwright install --with-deps chromium --only-shell
 *
 * Usage: PLAYWRIGHT_DIR=/tmp/pw bun scripts/diag-halaman-laporan.mjs [baseUrl]
 */
import { createRequire } from "node:module";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/+$/, "");

const playwrightDir = process.env.PLAYWRIGHT_DIR;
const requireFrom = playwrightDir
  ? createRequire(`${playwrightDir.replace(/\/+$/, "")}/`)
  : createRequire(import.meta.url);
const { chromium } = requireFrom("playwright");

/** Sesi backstage disemai lewat `localStorage`, jadi tidak butuh login. */
const SESSION = {
  user: { name: "Diagnosa Warna", email: "diag-warna@mesinpos.test" },
  tenant: {
    name: "Pusat Bahan Bangunan",
    slug: "pusat-bahan-bangunan",
    storeName: "Pusat",
    vertical: "umkm",
    verticals: ["umkm", "fnb", "wholesale"],
    planKey: "enterprise",
    role: "owner",
    customRole: null,
    shift: { active: false, reminderHour: 21, longShiftHours: 14 },
    createdAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  },
};

/**
 * Nada warna tiap bagian laporan, dibaca dari elemennya. Bagian yang berupa kartu
 * punya `testid` atau `id`; keduanya diperiksa supaya alat ini tidak perlu diubah
 * kalau salah satunya berganti nama.
 */
const BAGIAN = [
  "ringkasan",
  "angka-utama",
  "omzet-metode",
  "unduh-laporan",
  "pajak-fnb",
  "analitik",
  "franchise",
];

/** Fungsi yang dijalankan **di dalam peramban**: mengukur warna & kontras. */
function ukurHalaman(bagian) {
  const keRgba = (warna) => {
    const angka = (warna.match(/[\d.]+/g) ?? ["0", "0", "0", "1"]).map(Number);
    return [angka[0], angka[1], angka[2], angka[3] ?? 1];
  };
  const luminansi = ([r, g, b]) => {
    const f = (nilai) => {
      const v = nilai / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  /** Kontras teks terhadap latar efektifnya (latar leluhur ditimpa dari belakang). */
  const kontras = (elemen) => {
    if (!elemen) return null;
    const tumpukan = [];
    for (let node = elemen; node; node = node.parentElement) {
      tumpukan.push(getComputedStyle(node).backgroundColor);
    }
    let latar = [255, 255, 255];
    for (const warna of tumpukan.reverse()) {
      const [r, g, b, a] = keRgba(warna);
      latar = [
        r * a + latar[0] * (1 - a),
        g * a + latar[1] * (1 - a),
        b * a + latar[2] * (1 - a),
      ];
    }
    const l1 = luminansi(keRgba(getComputedStyle(elemen).color).slice(0, 3));
    const l2 = luminansi(latar);
    const [terang, gelap] = l1 > l2 ? [l1, l2] : [l2, l1];
    return Math.round(((terang + 0.05) / (gelap + 0.05)) * 100) / 100;
  };

  const potret = bagian.map((nama) => {
    const elemen = document.querySelector(
      `[data-testid="${nama}"], [id="${nama}"], [data-testid="${nama}-report"]`,
    );
    if (!elemen) return { bagian: nama, catatan: "tidak ada di halaman" };
    const gaya = getComputedStyle(elemen);
    const pita = elemen.querySelector("span[aria-hidden]");
    const kotakIkon = elemen.querySelector("svg")?.parentElement;
    const kepalaKolom = elemen.querySelector("thead");
    return {
      bagian: nama,
      garisKartu: gaya.borderTopColor,
      permukaan: gaya.backgroundColor,
      pita: pita ? gayaAwal(pita, "backgroundImage") : null,
      kotakIkon: kotakIkon ? gayaAwal(kotakIkon, "color") : null,
      pitaKepalaKolom: kepalaKolom ? gayaAwal(kepalaKolom, "backgroundColor") : null,
      kontrasJudul: kontras(elemen.querySelector("h3")),
      kontrasKeterangan: kontras(elemen.querySelector("p")),
    };
  });

  function gayaAwal(elemen, sifat) {
    return getComputedStyle(elemen)[sifat].slice(0, 64);
  }

  const kepalaPajak = document.querySelector('[data-testid="fnb-tax-report"] thead th');
  return {
    tema: document.documentElement.className || "terang",
    potret,
    kontrasPitaKepalaKolom: kontras(kepalaPajak),
    tinggiDokumen: document.documentElement.scrollHeight,
  };
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await context.addInitScript(
    ([key, session]) => {
      window.localStorage.setItem(key, JSON.stringify(session));
      // Tema gelap: tema bawaan proyek, dan yang paling mudah membuat warna hilang.
      window.localStorage.setItem("mesinpos.theme.v1", "dark");
    },
    ["mesinpos.session.v1", SESSION],
  );

  const page = await context.newPage();
  const galat = [];
  page.on("pageerror", (error) => galat.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") galat.push(message.text());
  });

  await page.goto(`${BASE}/app/reports`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="laporan-kepala"]', { timeout: 30000 });

  const hasil = await page.evaluate(ukurHalaman, BAGIAN);
  console.log(JSON.stringify(hasil, null, 2));
  console.log(
    `galat konsol: ${galat.length}${galat.length ? ` — ${galat.slice(0, 3).join(" | ")}` : ""}`,
  );

  await page.screenshot({ path: "/tmp/laporan-gelap.png" });
  await page.screenshot({ path: "/tmp/laporan-desktop.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: "/tmp/laporan-ponsel.png" });
  console.log(
    "tangkapan layar: /tmp/laporan-desktop.png, /tmp/laporan-ponsel.png, /tmp/laporan-gelap.png",
  );
} finally {
  await browser.close();
}

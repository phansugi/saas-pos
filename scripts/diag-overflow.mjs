/**
 * Diagnosa **luapan horizontal** di peramban sungguhan: daftar elemen yang
 * melewati lebar layar, beserta kelas & ukurannya — plus rantai leluhur elemen
 * terlebar, supaya kelihatan siapa yang menentukan lebarnya.
 *
 * Kenapa ada: `overflow-x-clip`/`overflow-x-hidden` menyembunyikan gejalanya —
 * halaman tidak bisa digulir ke samping, jadi yang terlihat cuma isi yang
 * terpotong di tepi kanan (mis. tombol “Coba Gratis” di beranda atau kartu produk
 * di kasir). DOM tiruan tidak menghitung tata letak, jadi tidak ada harness lain
 * yang bisa menemukannya; skrip ini mengukur **setiap** elemen di peramban.
 *
 * Dua jenis luapan dibedakan, karena hanya satu yang salah:
 *
 *   - **terpotong** — melewati layar tanpa jalan membacanya (yang dilaporkan);
 *   - **bisa digeser** — di dalam wadah `overflow-x: auto` yang sendiri muat di
 *     layar (tabel lebar) — sah, jadi tidak dihitung.
 *
 * Prasyarat — paket peramban dipasang di luar repo (lihat `verify-browser-scroll.mjs`):
 *
 *   mkdir -p /tmp/pw && cd /tmp/pw && bun init -y && bun add playwright
 *   bunx playwright install --with-deps chromium --only-shell
 *
 * Usage:
 *   PLAYWRIGHT_DIR=/tmp/pw node scripts/diag-overflow.mjs [baseUrl] [lebar] [rute ...]
 *   PROBE="teks" PLAYWRIGHT_DIR=/tmp/pw node scripts/diag-overflow.mjs … # rantai leluhur elemen berisi teks itu
 *
 * Default: `http://localhost:5173`, lebar 390 (HP), rute `/` dan `/app/pos`.
 */
import { createRequire } from "node:module";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/+$/, "");
const WIDTH = Number(process.argv[3] ?? 390);
const ROUTES = process.argv.slice(4).length > 0 ? process.argv.slice(4) : ["/", "/app/pos"];
const HEIGHT = 844;
/** `PROBE="teks"` mencetak rantai leluhur elemen terlebar yang memuat teks itu. */
const PROBE = process.env.PROBE ?? "";

const playwrightDir = process.env.PLAYWRIGHT_DIR;
const requireFrom = playwrightDir
  ? createRequire(`${playwrightDir.replace(/\/+$/, "")}/`)
  : createRequire(import.meta.url);
const { chromium } = requireFrom("playwright");

const SESSION_KEY = "mesinpos.session.v1";
const SESSION = {
  user: { name: "Uji Luapan", email: "luapan@mesinpos.test" },
  tenant: {
    name: "Pusat Bahan Bangunan",
    slug: "pusat-bahan-bangunan",
    storeName: "Pusat",
    vertical: "umkm",
    verticals: ["umkm", "fnb", "wholesale"],
    planKey: "enterprise",
    role: "owner",
    customRole: null,
    createdAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  },
};

/**
 * Satu fungsi **mandiri** untuk dijalankan di halaman: Playwright hanya mengirim
 * fungsi ini, jadi tidak ada penolong di berkas yang bisa dipanggil dari dalamnya.
 */
const SCAN = (probeText) => {
  const lebar = window.innerWidth;

  /** Luapannya sah kalau ada wadah geser mendatar yang sendiri muat di layar. */
  const bisaDibaca = (element) => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX !== "auto" && style.overflowX !== "scroll") continue;
      const rect = node.getBoundingClientRect();
      if (rect.right > lebar + 0.5 || rect.left < -0.5) continue;
      if (node.scrollWidth > node.clientWidth) return true;
    }
    return false;
  };

  const rantaiDari = (element) => {
    const rantai = [];
    let node = element;
    while (node && node !== document.documentElement.parentElement) {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      rantai.push(
        `    ${node.tagName.toLowerCase()} ${String(node.className ?? "").slice(0, 90)} · left ${Math.round(rect.left)} · width ${Math.round(rect.width)} · ${style.display} · min-width ${style.minWidth} · pad ${style.paddingLeft}/${style.paddingRight} · ox ${style.overflowX}`,
      );
      node = node.parentElement;
    }
    return rantai.join("\n");
  };

  const luapan = [];
  for (const element of document.querySelectorAll("body *")) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const kanan = Math.round(rect.right - lebar);
    const kiri = Math.round(rect.left);
    if (kanan <= 0 && kiri >= 0) continue;
    if (bisaDibaca(element)) continue;
    luapan.push({
      element,
      tag: element.tagName.toLowerCase(),
      className: String(element.className ?? "").slice(0, 170),
      testid: element.getAttribute("data-testid") ?? "",
      text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
      kanan,
      kiri,
      width: Math.round(rect.width),
    });
  }
  luapan.sort((a, b) => b.kanan - a.kanan);

  const terlebar = luapan.slice().sort((a, b) => b.width - a.width)[0] ?? null;
  const cocokProbe = probeText
    ? luapan.filter((row) => row.text.includes(probeText) && row.element.textContent.includes(probeText))
    : [];

  return {
    lebar,
    scrollWidth: document.documentElement.scrollWidth,
    jumlah: luapan.length,
    rows: luapan.slice(0, 25).map(({ element, ...row }) => row),
    rantai: terlebar ? rantaiDari(terlebar.element) : "(tidak ada luapan)",
    rantaiProbe: cocokProbe.length > 0 ? rantaiDari(cocokProbe[0].element) : null,
  };
};

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});
await context.addInitScript(
  ([key, value]) => {
    window.localStorage.setItem(key, value);
  },
  [SESSION_KEY, JSON.stringify(SESSION)],
);

for (const route of ROUTES) {
  const page = await context.newPage();
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const hasil = await page.evaluate(SCAN, PROBE);
  console.log(
    `\n=== ${route} @ ${hasil.lebar}px — dokumen ${hasil.scrollWidth}px · ${hasil.jumlah} elemen terpotong`,
  );
  for (const row of hasil.rows) {
    const sisi = row.kanan > 0 ? `kanan +${row.kanan}` : `kiri ${row.kiri}`;
    console.log(
      `  ${sisi}px · ${row.width}px · <${row.tag}>${row.testid ? ` [${row.testid}]` : ""} · ${row.className} · “${row.text}”`,
    );
  }
  console.log(`  lebar isi terdalam:\n${hasil.rantai}`);
  if (hasil.rantaiProbe) console.log(`  rantai leluhur “${PROBE}”:\n${hasil.rantaiProbe}`);
  await page.close();
}

await browser.close();

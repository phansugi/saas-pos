/**
 * DIAGNOSTIK SEMENTARA (tidak untuk dipertahankan): mencari penyebab dokumen
 * backstage lebih tinggi dari layar sehingga seluruh shell bisa digulir.
 *
 * Usage: PLAYWRIGHT_DIR=/tmp/pw bun scripts/diag-scroll.mjs [baseUrl] [path...]
 */
import { createRequire } from "node:module";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/+$/, "");
const PATHS = process.argv.slice(3);
const RUTE = PATHS.length > 0 ? PATHS : ["/app/settings", "/app/reports", "/app/products"];

const playwrightDir = process.env.PLAYWRIGHT_DIR;
const requireFrom = playwrightDir
  ? createRequire(`${playwrightDir.replace(/\/+$/, "")}/`)
  : createRequire(import.meta.url);
const { chromium } = requireFrom("playwright");

const SESSION = {
  user: { name: "Diag Gulir", email: "diag@mesinpos.test" },
  tenant: {
    name: "Kafe Diag",
    slug: "kafe-diag",
    storeName: "Pusat",
    vertical: "fnb",
    verticals: ["fnb", "umkm"],
    planKey: "enterprise",
    role: "owner",
    createdAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
  },
};

const browser = await chromium.launch();

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  for (const path of RUTE) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      ["mesinpos.session.v1", JSON.stringify(SESSION)],
    );
    const page = await context.newPage();
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("main", { timeout: 30_000 });
    await page.waitForTimeout(400);

    const data = await page.evaluate(() => {
      const info = (el, label) => {
        if (!el) return { label, ada: false };
        const style = window.getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return {
          label,
          ada: true,
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          rectHeight: Math.round(box.height),
          rectTop: Math.round(box.top),
          height: style.height,
          minHeight: style.minHeight,
          overflow: style.overflow,
          overflowY: style.overflowY,
          display: style.display,
          flex: style.flex,
          position: style.position,
        };
      };
      const doc = document.scrollingElement ?? document.documentElement;
      const shell = document.querySelector(".app-shell-height");
      const main = document.querySelector("main");
      // Rantai elemen teratas yang lebih tinggi dari layar, dari #root ke bawah.
      const tinggi = [];
      const walk = (el, depth) => {
        if (!el || depth > 8) return;
        const box = el.getBoundingClientRect();
        if (box.height > window.innerHeight + 1) {
          tinggi.push({
            depth,
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute("class") ?? "").slice(0, 90),
            height: Math.round(box.height),
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            overflowY: window.getComputedStyle(el).overflowY,
            minHeight: window.getComputedStyle(el).minHeight,
          });
        }
        for (const child of el.children) walk(child, depth + 1);
      };
      walk(document.getElementById("root"), 0);
      return {
        doc: { scrollHeight: doc.scrollHeight, clientHeight: doc.clientHeight },
        body: info(document.body, "body"),
        root: info(document.getElementById("root"), "#root"),
        shell: info(shell, ".app-shell-height"),
        main: info(main, "main"),
        kolom: info(main?.parentElement, "kolom main"),
        tinggi,
      };
    });

    console.log(`\n=== ${path} @ ${viewport.width}×${viewport.height} ===`);
    console.log(
      `dokumen: scrollHeight=${data.doc.scrollHeight} clientHeight=${data.doc.clientHeight}`,
    );
    for (const key of ["body", "root", "shell", "kolom", "main"]) {
      const row = data[key];
      if (!row?.ada) {
        console.log(`${key}: (tidak ada)`);
        continue;
      }
      console.log(
        `${key}: rect=${row.rectTop}+${row.rectHeight} client=${row.clientHeight} scroll=${row.scrollHeight} height=${row.height} minHeight=${row.minHeight} overflowY=${row.overflowY} display=${row.display} flex=${row.flex}`,
      );
    }
    // Siapa yang membuat dokumennya bisa digulir? Tiap elemen dicoba
    // disembunyikan sebentar, lalu tinggi dokumen diukur lagi.
    const pelaku = await page.evaluate(() => {
      const doc = document.scrollingElement ?? document.documentElement;
      const awal = doc.scrollHeight;
      const hasil = [];
      for (const el of document.querySelectorAll("body *")) {
        const style = window.getComputedStyle(el);
        if (style.display === "none") continue;
        const box = el.getBoundingClientRect();
        const menonjol = box.bottom > window.innerHeight + 1 || box.top < -1;
        const mengambang = style.position === "fixed" || style.position === "absolute";
        if (!menonjol && !mengambang) continue;
        const sebelum = el.style.display;
        el.style.display = "none";
        const sesudah = doc.scrollHeight;
        el.style.display = sebelum;
        if (sesudah < awal - 1) {
          hasil.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute("class") ?? "").slice(0, 110),
            position: style.position,
            top: Math.round(box.top),
            bottom: Math.round(box.bottom),
            awal,
            sesudah,
          });
        }
      }
      // Ambil yang paling mengurangi tinggi dokumen (kandidat terkuat).
      hasil.sort((a, b) => a.sesudah - b.sesudah);
      return hasil.slice(0, 8);
    });
    console.log("kandidat penyebab dokumen tinggi (disembunyikan → tinggi dokumen):");
    for (const row of pelaku) {
      console.log(
        `  ${row.tag} position=${row.position} top=${row.top} bottom=${row.bottom} ${row.awal} → ${row.sesudah} class="${row.cls}"`,
      );
    }
    if (pelaku.length === 0) console.log("  (tidak ada yang mengurangi tinggi dokumen)");
    await context.close();
  }
}

await browser.close();

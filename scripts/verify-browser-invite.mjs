/**
 * Uji **peramban sungguhan**: pemilik mengundang kasir, lalu kasir itu masuk di
 * **perangkat baru** (localStorage kosong) dan yang benar-benar tampil di layarnya
 * diperiksa apa adanya.
 *
 * Kenapa harness ini ada: harness DOM lain (`verify-render.mjs`) berjalan di mode
 * demo, jadi jalur store Convex tidak pernah benar-benar dibuka di sana. Bug yang
 * pernah dilaporkan — "Halaman ini gagal dimuat" disertai
 * `[CONVEX Q(products:listAll)] ... peran cashier tidak memiliki izin
 * product.manage` — hanya muncul di peramban sungguhan dengan backend hidup,
 * karena **langganan Convex yang ditolak server menjatuhkan render** halaman yang
 * memuatnya.
 *
 * Yang diperiksa, semuanya dari peramban (bukan dari kode sumber):
 *
 *   1. pemilik: `/app/products` benar-benar tampil (gerbangnya tidak ikut menutup
 *      orang yang berhak), dan kliennya memang mengirim langganan
 *      `products:listAll` — sekaligus bukti bahwa pencatat bingkai ini bekerja;
 *   2. undangan kasir lewat halaman Tim & Peran benar-benar diterima server;
 *   3. kasir di perangkat baru: sesinya memakai workspace undangan itu dengan
 *      peran `cashier` (bukan mendirikan bisnis kedua);
 *   4. kasir: halaman pertama setelah masuk tampil, begitu pula `/app/pos` —
 *      tidak ada "Halaman ini gagal dimuat" di keduanya;
 *   5. kasir: klien mengirim `roles:myAccess` & `products:listByStore` (katalog
 *      jualnya sendiri) tetapi **tidak pernah** `products:listAll`, dibaca dari
 *      bingkai websocket yang benar-benar dikirim klien;
 *   6. kasir: `/app/products` menjawab "Akses ditolak" milik klien, bukan galat
 *      server yang menjatuhkan halaman.
 *
 * Prasyarat — paket peramban sengaja dipasang **di luar repo**, supaya unduhan
 * Chromium tidak ikut masuk ke instalasi build hosting:
 *
 *   mkdir -p /tmp/pw && cd /tmp/pw && bun init -y && bun add playwright
 *   bunx playwright install --with-deps chromium --only-shell
 *
 * Usage:
 *   PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-browser-invite.mjs [baseUrl] [kodeUji]
 *
 * Default: `http://localhost:5173` dan kode uji `428913`. Kode uji itu hanya
 * berlaku untuk email berdomain `.test` di deployment yang memasang
 * `OTP_DEV_CODE` (lihat `isTestLoginEnabled` di `src/convex/lib/otp.ts`), jadi
 * uji ini tidak pernah menyentuh kotak surat orang sungguhan.
 *
 * Aplikasi harus sedang berjalan dalam **mode Convex** (`VITE_DATA_SOURCE=convex`
 * + `VITE_CONVEX_URL`), karena justru jalur itulah yang diuji.
 */
import { createRequire } from "node:module";
import { mkdirSync, statSync } from "node:fs";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/+$/, "");
const DEV_CODE = process.argv[3] ?? "428913";
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

const stamp = Date.now();
const OWNER_EMAIL = `pemilik-uji-${stamp}@mesinpos.test`;
const CASHIER_EMAIL = `kasir-uji-${stamp}@mesinpos.test`;
const BUSINESS = `Uji Undangan ${stamp}`;
const BRANCH = "Cabang Uji Browser";

const FAILED_PAGE = "Halaman ini gagal dimuat";

/** Menunggu sampai salah satu teks muncul di badan halaman. */
async function tungguSalahSatuTeks(page, daftar, timeout = 45_000) {
  await page.waitForFunction(
    (teks) => teks.some((t) => document.body.innerText.includes(t)),
    daftar,
    { timeout },
  );
}

const bodyText = (page) => page.evaluate(() => document.body.innerText);

async function newDevice(browser, label) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    /*
      Service worker dimatikan di uji ini: cangkang PWA yang tersimpan bisa
      menyajikan dokumen lama, dan yang diuji adalah aplikasi yang baru dimuat.
    */
    serviceWorkers: "block",
  });
  /*
    Bingkai yang **dikirim klien** ke Convex dicatat dari dalam halaman, bukan
    dari sisi Playwright: `send` socket ditangkap sebelum aplikasi membuatnya,
    jadi tidak ada bingkai awal yang lolos karena balapan waktu (`Connect` +
    `ModifyQuerySet` dikirim seketika socket dibuka). Setiap dokumen baru
    menjalankan skrip ini lagi, dan `log.frames` mengumpulkan hasilnya.
  */
  await context.addInitScript(() => {
    const Asli = window.WebSocket;
    const tercatat = [];
    window.__bingkaiTerkirim = tercatat;
    class WebSocketTercatat extends Asli {
      send(data) {
        try {
          tercatat.push(String(data));
        } catch {
          // Diabaikan: pencatatan tidak boleh mengubah perilaku aplikasi.
        }
        return super.send(data);
      }
    }
    window.WebSocket = WebSocketTercatat;
  });

  const page = await context.newPage();
  const log = { label, errors: [], frames: [] };
  page.on("console", (msg) => {
    if (msg.type() === "error") log.errors.push(msg.text());
  });
  page.on("pageerror", (error) => log.errors.push(`pageerror: ${error.message}`));
  return { context, page, log };
}

/** Menyalin bingkai yang sudah dikirim dokumen saat ini ke catatan perangkat. */
async function kumpulkanBingkai(page, log) {
  const sekarang = await page.evaluate(() => window.__bingkaiTerkirim ?? []);
  for (const frame of sekarang) {
    if (!log.frames.includes(frame)) log.frames.push(frame);
  }
  return log.frames.length;
}

/**
 * Menunggu klien Convex benar-benar bicara: socket-nya baru **dibuka** setelah
 * dokumen selesai dimuat, jadi memeriksa bingkai terlalu dini akan membaca
 * "belum ada langganan apa pun" dan menyimpulkan hal yang salah.
 */
async function tungguBingkai(page, log, { timeout = 30_000, tenang = 2500 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await kumpulkanBingkai(page, log)) > 0) break;
    await page.waitForTimeout(400);
  }
  // Beri waktu langganan berikutnya (mis. katalog) ikut terkirim.
  await page.waitForTimeout(tenang);
  return kumpulkanBingkai(page, log);
}

/** Apakah ada bingkai yang menyebut nama fungsi Convex tertentu. */
const menyebut = (log, nama) => log.frames.some((frame) => frame.includes(nama));

/** Masuk lewat halaman /auth memakai kode uji OTP (email `.test`). */
async function masuk(page, email) {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#email", { timeout: 45_000 });
  await page.fill("#email", email);
  await page.click('form button[type="submit"]');
  await page.waitForSelector("#otp", { timeout: 45_000 });
  await page.fill("#otp", DEV_CODE);
  await page.click('form button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.startsWith("/auth"), null, {
    timeout: 45_000,
  });
}

/** Onboarding 3 tahap dengan pilihan bawaan (modul UMKM, paket terpilih). */
async function selesaikanOnboarding(page) {
  await page.waitForSelector("#business", { timeout: 45_000 });
  await page.fill("#business", BUSINESS);
  await page.fill("#store", BRANCH);
  await page.click('button:has-text("Lanjut")');
  await page.click('button:has-text("Lanjut")');
  await page.click('button:has-text("Mulai trial")');
}

async function simpanTangkapan(page, nama) {
  mkdirSync(SHOTS, { recursive: true });
  const berkas = `${SHOTS}/${nama}.png`;
  await page.screenshot({ path: berkas, fullPage: false });
  return statSync(berkas).size;
}

const browser = await chromium.launch();
let galatTerkumpul = [];

try {
  // -------------------------------------------------- perangkat 1: pemilik
  const owner = await newDevice(browser, "pemilik");
  console.log(`· peramban: ${browser.version()}`);
  console.log(`· pemilik  : ${OWNER_EMAIL}`);

  await masuk(owner.page, OWNER_EMAIL);
  await selesaikanOnboarding(owner.page);
  await owner.page.waitForFunction(() => location.pathname === "/app", null, {
    timeout: 45_000,
  });
  check(
    "pemilik selesai onboarding dan masuk ke /app",
    owner.page.url().endsWith("/app"),
    owner.page.url(),
  );
  await tungguBingkai(owner.page, owner.log);

  await owner.page.goto(`${BASE}/app/products`, { waitUntil: "domcontentloaded" });
  await tungguSalahSatuTeks(owner.page, ["Produk & Stok", FAILED_PAGE]);
  await tungguBingkai(owner.page, owner.log);
  const teksPemilik = await bodyText(owner.page);
  check(
    "pemilik melihat halaman Produk & Stok (bukan halaman gagal dimuat)",
    teksPemilik.includes("Produk & Stok") && !teksPemilik.includes(FAILED_PAGE),
    teksPemilik.slice(0, 300),
  );
  check(
    "klien pemilik memang membuka langganan products:listAll (pencatat bingkai bekerja)",
    menyebut(owner.log, "products:listAll"),
    `${owner.log.frames.length} bingkai terkirim: ${owner.log.frames
      .join(" ~ ")
      .slice(0, 500)}`,
  );

  // ------------------------------------- undangan kasir lewat halaman Tim
  console.log(`· kasir    : ${CASHIER_EMAIL}`);
  await owner.page.goto(`${BASE}/app/team`, { waitUntil: "domcontentloaded" });
  await owner.page.waitForSelector("#member-email", { timeout: 45_000 });
  /*
    Formulirnya sudah bisa diklik sebelum store selesai menyelesaikan workspace
    dari server — mengirim undangan pada saat itu dijawab "Tenant belum siap".
    Jadi tunggu dulu sampai daftar anggota dari server benar-benar terlihat
    (pemiliknya muncul di tabel).
  */
  await owner.page.waitForFunction(
    (email) => document.body.innerText.includes(email),
    OWNER_EMAIL,
    { timeout: 45_000 },
  );
  await owner.page.fill("#member-email", CASHIER_EMAIL);
  await owner.page.selectOption("#member-role", "cashier");
  await owner.page.click('button:has-text("Daftarkan ke tim")');
  try {
    await owner.page.waitForFunction(
      (email) => document.body.innerText.includes(email),
      CASHIER_EMAIL,
      { timeout: 45_000 },
    );
  } catch (error) {
    await simpanTangkapan(owner.page, "gagal-undang");
    throw new Error(
      `undangan tidak terlihat di halaman Tim: ${(await bodyText(owner.page))
        .replace(/\n+/g, " | ")
        .slice(600, 3000)}`,
      { cause: error },
    );
  }
  const teksTim = await bodyText(owner.page);
  check(
    "kasir terdaftar di tim sebagai Kasir",
    teksTim.includes(CASHIER_EMAIL) && /Kasir/.test(teksTim),
    teksTim.slice(0, 400),
  );

  // -------------------------------------- perangkat 2: kasir yang diundang
  const cashier = await newDevice(browser, "kasir");
  await masuk(cashier.page, CASHIER_EMAIL);
  await cashier.page.waitForFunction(
    () => location.pathname.startsWith("/app"),
    null,
    { timeout: 45_000 },
  );
  // Halaman pertama setelah masuk: di sinilah dulu muncul "Halaman ini gagal
  // dimuat", karena klien membuka langganan bergerbang atas nama peran pemilik
  // tebakan sesi perangkat, sementara server menilainya kasir.
  await tungguBingkai(cashier.page, cashier.log);

  const sesiKasir = await cashier.page.evaluate(() =>
    JSON.parse(localStorage.getItem("mesinpos.session.v1") ?? "null"),
  );
  check(
    "kasir memakai workspace undangan itu dengan peran cashier",
    sesiKasir?.tenant?.role === "cashier" && sesiKasir?.tenant?.name === BUSINESS,
    JSON.stringify(sesiKasir?.tenant ?? null).slice(0, 400),
  );
  const teksPertama = await bodyText(cashier.page);
  check(
    "halaman pertama kasir setelah masuk tampil, bukan halaman gagal dimuat",
    teksPertama.length > 0 && !teksPertama.includes(FAILED_PAGE),
    teksPertama.slice(0, 400),
  );
  // Bukti paling langsung: dokumen pertama kasir ini memang mengirim langganan,
  // dan tidak satu pun di antaranya katalog pengelolaan (`products:listAll`).
  const bingkaiDokumenPertama = await cashier.page.evaluate(
    () => window.__bingkaiTerkirim ?? [],
  );
  check(
    "dokumen pertama kasir mengirim langganan tanpa products:listAll",
    bingkaiDokumenPertama.length > 0 &&
      !bingkaiDokumenPertama.some((frame) => frame.includes("products:listAll")),
    `${bingkaiDokumenPertama.length} bingkai: ${bingkaiDokumenPertama
      .join(" ~ ")
      .slice(0, 400)}`,
  );

  // ------------------------------------------------- halaman kasir: /app/pos
  await cashier.page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await tungguSalahSatuTeks(cashier.page, ["Keranjang", "Cari produk", FAILED_PAGE]);
  await tungguBingkai(cashier.page, cashier.log);
  const teksPos = await bodyText(cashier.page);
  const ukuranPos = await simpanTangkapan(cashier.page, "kasir-pos");
  check(
    "kasir melihat halaman kasir (/app/pos), bukan halaman gagal dimuat",
    teksPos.includes("Keranjang") && !teksPos.includes(FAILED_PAGE),
    teksPos.slice(0, 400),
  );
  check(
    "klien kasir benar-benar membuka langganannya sendiri (izin dari server & katalog jual)",
    menyebut(cashier.log, "roles:myAccess") &&
      menyebut(cashier.log, "products:listByStore"),
    `${cashier.log.frames.length} bingkai terkirim: ${cashier.log.frames
      .join(" ~ ")
      .slice(0, 500)}`,
  );
  check(
    "klien kasir TIDAK membuka langganan products:listAll",
    !menyebut(cashier.log, "products:listAll"),
    `${cashier.log.frames.filter((f) => f.includes("listAll")).length} bingkai menyebut listAll`,
  );

  // ------------------------------------------- halaman bergerbang: /app/products
  await cashier.page.goto(`${BASE}/app/products`, { waitUntil: "domcontentloaded" });
  await tungguSalahSatuTeks(cashier.page, ["Akses ditolak", FAILED_PAGE]);
  await tungguBingkai(cashier.page, cashier.log);
  const teksProdukKasir = await bodyText(cashier.page);
  const ukuranProduk = await simpanTangkapan(cashier.page, "kasir-produk");
  check(
    "kasir mendapat “Akses ditolak” milik klien, bukan galat server",
    teksProdukKasir.includes("Akses ditolak") && !teksProdukKasir.includes(FAILED_PAGE),
    teksProdukKasir.slice(0, 400),
  );

  // Gaya benar-benar termuat (bukan HTML telanjang tanpa Tailwind).
  const gaya = await cashier.page.evaluate(() => {
    const el = document.querySelector(".rounded-lg");
    return {
      radius: el ? getComputedStyle(el).borderRadius : null,
      ikon: document.querySelectorAll("svg").length,
    };
  });
  check(
    "halaman kasir benar-benar tergaya (Tailwind & ikon ikut render)",
    gaya.radius !== null && gaya.radius !== "0px" && gaya.ikon > 0,
    JSON.stringify(gaya),
  );

  galatTerkumpul = [
    ...cashier.log.errors.map((e) => `[kasir] ${e}`),
    ...owner.log.errors.map((e) => `[pemilik] ${e}`),
  ];
  check(
    "tidak ada galat konsol yang menyebut izin ditolak / products:listAll",
    !galatTerkumpul.some(
      (e) => e.includes("Akses ditolak") || e.includes("products:listAll"),
    ),
    galatTerkumpul.join(" | ").slice(0, 600),
  );

  console.log(
    `· tangkapan layar: ${SHOTS}/kasir-pos.png (${ukuranPos} B) · ` +
      `${SHOTS}/kasir-produk.png (${ukuranProduk} B)`,
  );
  await owner.context.close();
  await cashier.context.close();
} catch (error) {
  if (galatTerkumpul.length > 0) {
    console.error("Galat konsol yang tercatat:");
    for (const baris of galatTerkumpul) console.error(`  ${baris}`);
  }
  console.error(`caught: ${error.message}`);
  await browser.close();
  throw error;
}

await browser.close();

console.log("\nHasil:");
for (const { name, ok } of results) {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
}
console.log(`\n${results.length}/${results.length} pemeriksaan lulus.`);

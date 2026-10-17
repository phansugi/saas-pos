/**
 * Uji **peramban sungguhan**: tidak ada isi halaman yang terpotong di lebar HP.
 *
 * Kenapa harness ini ada: pemilik repo melaporkan isi halaman **beranda** &
 * **kasir** melebihi lebar layar di HP — tombol “Coba Gratis” di header terpotong,
 * kartu produk & keranjang kasir terpotong di tepi kanan. Kedua gejala itu tidak
 * mungkin terlihat di harness DOM (`verify-render.mjs`, `verify-menus.mjs`):
 * happy-dom tidak menghitung tata letak. Yang menyembunyikannya juga bukan
 * ketidaksengajaan — shell backstage memakai `overflow-x-hidden` supaya dokumennya
 * tidak bisa digulir ke samping, jadi isi yang terlalu lebar **terpotong diam-diam**.
 *
 * Dua jenis luapan dibedakan, karena hanya satu yang salah:
 *
 *   - **terpotong** — melewati layar tanpa jalan membacanya (yang diuji);
 *   - **bisa digeser** — di dalam wadah `overflow-x: auto` yang sendiri muat di
 *     layar (tabel lebar) — sah. Justru harus begitu: kolom terakhir tabel katalog
 *     produk **diuji bisa dicapai** dengan menggeser wadahnya, bukan hilang.
 *
 * Selain tata letak umum, harness ini menguji keadaan yang **hanya** muncul pada
 * data tertentu (pengingat tutup shift, gerbang kasir, banner pemberitahuan ke
 * pemilik toko) dengan menyemai `localStorage` di konteksnya sendiri, karena
 * banner-banner itu tidak pernah ikut terukur di halaman kosong.
 *
 * Prasyarat — paket peramban dipasang di luar repo, supaya unduhan Chromium tidak
 * ikut masuk ke instalasi build hosting (sama seperti `verify-browser-scroll.mjs`):
 *
 *   mkdir -p /tmp/pw && cd /tmp/pw && bun init -y && bun add playwright
 *   bunx playwright install --with-deps chromium --only-shell
 *
 * Usage:
 *   PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-mobile-overflow.mjs [baseUrl]
 *
 * Default: `http://localhost:5173` (dev server/preview yang sedang berjalan).
 * Sesi backstage disemai lewat `localStorage`, jadi uji ini tidak butuh login dan
 * tidak menyentuh data siapa pun.
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

const SESSION_KEY = "mesinpos.session.v1";
const SESSION = {
  user: { name: "Uji Lebar Layar", email: "lebar-layar@mesinpos.test" },
  tenant: {
    name: "Pusat Bahan Bangunan",
    slug: "pusat-bahan-bangunan",
    storeName: "Pusat",
    vertical: "umkm",
    verticals: ["umkm", "fnb", "wholesale"],
    planKey: "enterprise",
    role: "owner",
    customRole: null,
    // Pengingat tutup shift dimatikan di sesi umum: yang diukur di sini tata
    // letaknya, dan bannernya tidak boleh muncul-hilang tergantung jam berapa
    // skrip dijalankan. Blok yang memang menguji bannernya menyalakannya sendiri.
    shift: { active: false, reminderHour: 21, longShiftHours: 14 },
    createdAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  },
};

/**
 * Shift kas yang terbuka — gerbang kasir (`posShiftGate`) menuntut shiftnya
 * dibuka sebelum halaman Kasir bisa menjual, sedangkan skrip ini menekan tombol
 * kasir (produk, Hold) di beberapa blok.
 */
function seedShift(context, id) {
  return context.addInitScript(
    ([key, shiftId]) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          current: {
            id: shiftId,
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
    },
    ["mesinpos.shifts.v1", id],
  );
}

/** Menyalakan kembali pengingat tutup shift untuk blok yang mengujinya. */
function seedReminderOn(context) {
  return context.addInitScript(() => {
    const raw = window.localStorage.getItem("mesinpos.session.v1");
    if (!raw) return;
    const sesi = JSON.parse(raw);
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        ...sesi,
        tenant: {
          ...sesi.tenant,
          shift: { active: true, reminderHour: 21, longShiftHours: 14 },
        },
      }),
    );
  });
}

/** Halaman yang diuji di **empat** lebar HP; sisanya cukup dua (tersempit & umum). */
const EMPAT_LEBAR = ["/", "/app/pos", "/app/products"];
/** Seluruh rute backstage + halaman publik, supaya satu wadah yang melebar ketahuan. */
const RUTE_LENGKAP = [
  "/",
  "/auth",
  "/app",
  "/app/pos",
  "/app/kds",
  "/app/shift",
  "/app/products",
  "/app/inventory",
  "/app/opname",
  "/app/receivables",
  "/app/members",
  "/app/purchasing",
  "/app/reports",
  "/app/payments",
  "/app/team",
  "/app/api",
  "/app/support",
  "/app/sync",
  "/app/panduan",
  "/app/modules",
  "/app/settings",
  "/app/subscription",
  "/app/profil",
];
const LEBAR = [320, 360, 390, 414];

/** Ukur luapan: satu fungsi mandiri (Playwright hanya mengirim fungsi ini). */
const UKUR = () => {
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

  const terpotong = [];
  for (const element of document.querySelectorAll("body *")) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.right - lebar <= 0.5 && rect.left >= -0.5) continue;
    if (bisaDibaca(element)) continue;
    terpotong.push(
      `<${element.tagName.toLowerCase()} class="${String(element.className ?? "").slice(0, 120)}"> “${(element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 50)}” +${Math.round(rect.right - lebar)}px`,
    );
  }

  return {
    lebar,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    terpotong: terpotong.slice(0, 6),
    jumlahTerpotong: terpotong.length,
    panjangTeks: (document.body.textContent ?? "").replace(/\s+/g, " ").trim().length,
    /** Kontrol header yang harus tetap utuh di beranda (laporan pemilik repo). */
    header: [...document.querySelectorAll("header a, header button")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          teks: (element.textContent ?? element.getAttribute("aria-label") ?? "").trim(),
          kanan: Math.round(rect.right),
          lebar: Math.round(rect.width),
          terlihat:
            rect.width > 0 &&
            rect.height > 0 &&
            getComputedStyle(element).display !== "none" &&
            getComputedStyle(element).visibility !== "hidden",
        };
      })
      .filter((row) => row.terlihat),
  };
};

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
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
await seedShift(context, "shift-uji-360");

/** Buka satu halaman pada satu lebar layar, lalu kembalikan hasil pengukurannya. */
async function buka(route, width, ctx = context) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  // Aplikasi adalah SPA: menunggu jaringan sepi saja belum tentu setelah React
  // memasang pohonnya. Ukurannya diukur setelah isinya benar-benar ada, karena
  // mengukur halaman kosong akan “lulus” tanpa membuktikan apa pun.
  await page.waitForFunction(
    () => (document.getElementById("root")?.textContent ?? "").trim().length > 0,
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(200);
  const hasil = await page.evaluate(UKUR);
  return { page, hasil };
}

let failure = null;

try {
  // ── 1. Seluruh rute pada lebar paling rawan (320 px) dan lebar HP umum (390 px)
  for (const route of RUTE_LENGKAP) {
    for (const lebar of [320, 390]) {
      const { page, hasil } = await buka(route, lebar);
      check(
        `${route} @ ${lebar}px: dokumen tidak lebih lebar dari layar`,
        hasil.scrollWidth <= hasil.lebar && hasil.bodyScrollWidth <= hasil.lebar,
        `dokumen=${hasil.scrollWidth} body=${hasil.bodyScrollWidth} layar=${hasil.lebar}`,
      );
      check(
        `${route} @ ${lebar}px: tidak ada isi yang terpotong di tepi`,
        hasil.jumlahTerpotong === 0,
        `${hasil.jumlahTerpotong} elemen: ${hasil.terpotong.join(" | ")}`,
      );
      check(
        `${route} @ ${lebar}px: halamannya benar-benar terisi (bukan halaman kosong)`,
        hasil.panjangTeks > 200,
        `panjang teks halaman=${hasil.panjangTeks}`,
      );
      await page.close();
    }
  }

  // ── 2. Tiga halaman yang dilaporkan, di empat lebar HP
  for (const route of EMPAT_LEBAR) {
    for (const lebar of LEBAR.filter((w) => w !== 320 && w !== 390)) {
      const { page, hasil } = await buka(route, lebar);
      check(
        `${route} @ ${lebar}px: tidak ada isi yang terpotong di tepi`,
        hasil.jumlahTerpotong === 0,
        `${hasil.jumlahTerpotong} elemen: ${hasil.terpotong.join(" | ")}`,
      );
      await page.close();
    }
  }

  // ── 3. Beranda: seluruh kontrol header utuh di lebar 390 px (gejala yang dilaporkan)
  {
    const { page, hasil } = await buka("/", 390);
    const label = hasil.header.map((row) => row.teks).filter(Boolean);
    check(
      "beranda @ 390px: tombol “Coba Gratis” ada di header",
      label.some((teks) => teks.includes("Coba Gratis")),
      label.join(" | "),
    );
    check(
      "beranda @ 390px: tombol “Masuk” ada di header",
      label.some((teks) => teks === "Masuk"),
      label.join(" | "),
    );
    const terpotong = hasil.header.filter((row) => row.kanan > hasil.lebar + 0.5);
    check(
      "beranda @ 390px: tidak ada kontrol header yang terpotong (dulu +60 px)",
      terpotong.length === 0,
      terpotong.map((row) => `${row.teks} +${row.kanan - hasil.lebar}px`).join(" | "),
    );
    check(
      "beranda @ 390px: tombol utama tetap terbaca utuh, bukan dipotong",
      hasil.header
        .filter((row) => row.teks.includes("Coba Gratis"))
        .every((row) => row.lebar > 80),
      hasil.header
        .filter((row) => row.teks.includes("Coba Gratis"))
        .map((row) => `${row.lebar}px`)
        .join(","),
    );
    await page.close();
  }

  // ── 4. Kasir: keranjang tidak terpotong, dan ia turun ke bawah daftar produk
  {
    const { page, hasil } = await buka("/app/pos", 360);
    check(
      "kasir @ 360px: tidak ada isi yang terpotong (dulu +28 px)",
      hasil.jumlahTerpotong === 0,
      `${hasil.jumlahTerpotong} elemen: ${hasil.terpotong.join(" | ")}`,
    );
    const keranjang = await page.evaluate(() => {
      const aside = [...document.querySelectorAll("aside")].find((element) =>
        element.textContent.includes("Keranjang"),
      );
      if (!aside) return null;
      const rect = aside.getBoundingClientRect();
      const kolom = getComputedStyle(aside.parentElement).gridTemplateColumns;
      return {
        kanan: Math.round(rect.right),
        lebar: Math.round(rect.width),
        lebarLayar: window.innerWidth,
        kolom,
      };
    });
    check(
      "kasir @ 360px: panel keranjang muat di layar (bukan terpotong)",
      keranjang !== null && keranjang.kanan <= keranjang.lebarLayar,
      JSON.stringify(keranjang),
    );
    check(
      "kasir @ 360px: kolomnya satu kolom eksplisit (bukan kolom `auto` yang melebar)",
      keranjang !== null && !keranjang.kolom.includes("916") && keranjang.kolom.split(" ").length === 1,
      JSON.stringify(keranjang),
    );
    await page.close();
  }

  // ── 4b. Kasir @ 360px: transaksi yang **ditahan** (tombol Hold) tetap muat di
  //        layar HP — daftar Transaksi ditahan bukan panel yang terpotong, dan
  //        tombol Lanjutkan-nya benar-benar bisa ditekan dari ponsel.
  {
    const { page } = await buka("/app/pos", 360);
    // Kartu produk yang stoknya masih ada **dan** tanpa grup modifier: kartu
    // bermodifier membuka dialog, jadi bukan jalur "tambah barang" yang diuji.
    const kartu = page
      .locator("button")
      .filter({ hasText: /stok \d+/ })
      .filter({ hasNotText: "grup pilihan" });
    await kartu.first().click();
    await page.locator('[data-testid="pos-hold"]').click();
    await page.waitForTimeout(150);

    const baris = page.locator('[data-testid^="pos-lanjutkan-"]');
    const jumlahBaris = await baris.count();
    const kotak = jumlahBaris > 0 ? await baris.first().boundingBox() : null;
    check(
      "kasir @ 360px: transaksi yang ditahan muncul di daftarnya",
      jumlahBaris === 1,
      `baris = ${jumlahBaris}`,
    );
    const hasilDitahan = await page.evaluate(UKUR);
    check(
      "kasir @ 360px: daftar Transaksi ditahan tidak ada yang terpotong",
      hasilDitahan.jumlahTerpotong === 0,
      `${hasilDitahan.jumlahTerpotong} elemen: ${hasilDitahan.terpotong.join(" | ")}`,
    );
    check(
      "kasir @ 360px: tombol Lanjutkan terjangkau di layar",
      kotak !== null && kotak.x >= 0 && kotak.x + kotak.width <= 360.5,
      JSON.stringify(kotak),
    );

    await baris.first().click();
    const isiKeranjang = await page
      .locator('[data-testid="keranjang-jumlah-item"]')
      .innerText();
    check(
      "kasir @ 360px: Lanjutkan mengembalikan transaksinya ke keranjang",
      isiKeranjang.includes("1 item"),
      isiKeranjang,
    );
    await page.close();
  }

  // ── 4c. Kasir @ 360px dengan kas yang **belum ditutup**: peringatan
  //        jangan-lupa-tutup-shift harus terbaca utuh di layar HP. Pengingat yang
  //        terpotong di tepi kanan sama saja dengan tidak ada — dan memperbesar
  //        keranjangnya (`grid-cols-1`) tidak menjamin isi **di atas** keranjang
  //        ikut muat.
  {
    const ctxShift = await browser.newContext({
      viewport: { width: 360, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    await ctxShift.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [SESSION_KEY, JSON.stringify(SESSION)],
    );
    // Blok ini justru menguji bannernya, jadi pengingat sesi umum dinyalakan lagi.
    await seedReminderOn(ctxShift);
    await ctxShift.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [
        "mesinpos.shifts.v1",
        JSON.stringify({
          current: {
            id: "shift-uji-360",
            // 26 jam lalu: pasti hari kalender sebelumnya, kapan pun tesnya jalan.
            openedAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
            openingCash: 300000,
            cashSales: 1250000,
            totalSales: 1500000,
            saleCount: 24,
            closedAt: null,
            countedCash: null,
            expectedCash: null,
            variance: null,
          },
          history: [],
        }),
      ],
    );

    const { page, hasil } = await buka("/app/pos", 360, ctxShift);
    const banner = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="kasir-ingat-tutup-shift"]');
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const tautan = element.querySelector("a");
      const rectTautan = tautan ? tautan.getBoundingClientRect() : null;
      return {
        level: element.getAttribute("data-level"),
        teks: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
        kiri: Math.round(rect.left),
        kanan: Math.round(rect.right),
        tautanKanan: rectTautan ? Math.round(rectTautan.right) : null,
        layar: window.innerWidth,
      };
    });
    check(
      "kasir @ 360px: peringatan tutup shift muncul saat kas masih terbuka",
      banner !== null,
      JSON.stringify(banner),
    );
    check(
      "kasir @ 360px: peringatan tutup shift menyebut shift kemarin & levelnya",
      banner !== null && banner.level === "late" && banner.teks.includes("Shift kemarin belum ditutup"),
      JSON.stringify(banner),
    );
    check(
      "kasir @ 360px: peringatan tutup shift tidak terpotong di tepi kanan",
      banner !== null && banner.kiri >= -0.5 && banner.kanan <= banner.layar + 0.5,
      JSON.stringify(banner),
    );
    check(
      "kasir @ 360px: tautan menuju halaman Shift & Kas terjangkau di layar",
      banner !== null && banner.tautanKanan !== null && banner.tautanKanan <= banner.layar + 0.5,
      JSON.stringify(banner),
    );
    check(
      "kasir @ 360px: halaman dengan peringatan tidak ada isi yang terpotong",
      hasil.jumlahTerpotong === 0,
      `${hasil.jumlahTerpotong} elemen: ${hasil.terpotong.join(" | ")}`,
    );
    await page.close();

    // Halaman tempat kasir benar-benar menutup shiftnya juga harus muat.
    const halaman = await buka("/app/shift", 360, ctxShift);
    const kartu = await halaman.page.evaluate(() => {
      const element = document.querySelector('[data-testid="shift-ingat-tutup"]');
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        level: element.getAttribute("data-level"),
        kiri: Math.round(rect.left),
        kanan: Math.round(rect.right),
        layar: window.innerWidth,
      };
    });
    check(
      "halaman Shift & Kas @ 360px: kartu pengingat tutup shift muncul",
      kartu !== null && kartu.level === "late",
      JSON.stringify(kartu),
    );
    check(
      "halaman Shift & Kas @ 360px: kartu pengingat tidak terpotong",
      kartu !== null && kartu.kiri >= -0.5 && kartu.kanan <= kartu.layar + 0.5,
      JSON.stringify(kartu),
    );
    check(
      "halaman Shift & Kas @ 360px: tidak ada isi yang terpotong",
      halaman.hasil.jumlahTerpotong === 0,
      `${halaman.hasil.jumlahTerpotong} elemen: ${halaman.hasil.terpotong.join(" | ")}`,
    );
    await halaman.page.close();
    await ctxShift.close();
  }

  // ── 4d. Kasir @ 360px dengan kas yang **belum dibuka**: gerbangnya harus utuh di
  //        layar HP. Pesan “Buka shift (kas) terlebih dahulu” beserta tombol jalan
  //        keluarnya tidak boleh terpotong — di situlah satu-satunya jalan kasir
  //        untuk bisa mulai berjualan lagi.
  {
    const ctxGerbang = await browser.newContext({
      viewport: { width: 360, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    await ctxGerbang.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [SESSION_KEY, JSON.stringify(SESSION)],
    );

    const { page, hasil } = await buka("/app/pos", 360, ctxGerbang);
    const gerbang = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="pos-gerbang-shift"]');
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const tautan = element.querySelector("a");
      const rectTautan = tautan ? tautan.getBoundingClientRect() : null;
      return {
        teks: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
        kiri: Math.round(rect.left),
        kanan: Math.round(rect.right),
        tautan: tautan?.getAttribute("href") ?? null,
        tautanKanan: rectTautan ? Math.round(rectTautan.right) : null,
        layar: window.innerWidth,
      };
    });
    check(
      "kasir @ 360px: gerbang “shift belum dibuka” muncul dan menyuruh membukanya dulu",
      gerbang !== null && gerbang.teks.includes("Buka shift (kas) terlebih dahulu"),
      JSON.stringify(gerbang),
    );
    check(
      "kasir @ 360px: gerbangnya tidak terpotong di tepi kanan",
      gerbang !== null && gerbang.kiri >= -0.5 && gerbang.kanan <= gerbang.layar + 0.5,
      JSON.stringify(gerbang),
    );
    check(
      "kasir @ 360px: tombol “Buka shift sekarang” terjangkau & menuju halaman Shift & Kas",
      gerbang !== null &&
        gerbang.tautan === "/app/shift" &&
        gerbang.tautanKanan !== null &&
        gerbang.tautanKanan <= gerbang.layar + 0.5,
      JSON.stringify(gerbang),
    );
    check(
      "kasir @ 360px: halaman yang terkunci tidak ada isi yang terpotong",
      hasil.jumlahTerpotong === 0,
      `${hasil.jumlahTerpotong} elemen: ${hasil.terpotong.join(" | ")}`,
    );
    await page.close();
    await ctxGerbang.close();
  }

  // ── 4e. Kasir & Shift @ 360px: banner pemberitahuan ke **pemilik toko** juga
  //        harus terbaca utuh di layar HP. Banner itu muncul dari keadaan shift
  //        yang nyata (shift kemarin belum ditutup) dan memuat tautan
  //        “Buka Shift & Kas” yang tidak boleh terdorong keluar layar: tautan itu
  //        satu-satunya jalan keluar yang ditawarkan banner. Halaman Shift & Kas
  //        diuji di lebar yang sama — banner-nya plus kartu “Pemberitahuan ke
  //        pemilik toko” beserta tombol “Tandai ditangani”.
  {
    const ctxPemilik = await browser.newContext({
      viewport: { width: 360, height: 844 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    await ctxPemilik.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [
        SESSION_KEY,
        JSON.stringify({
          ...SESSION,
          tenant: {
            ...SESSION.tenant,
            // Jam operasional eksplisit: di mode demo inilah satu-satunya tempat
            // setelannya hidup (mode Convex membacanya dari baris tenant, yang
            // di sesi uji ini jatuh ke bawaan 08:00–22:00 dengan pemberitahuan
            // hidup). Kabar yang diuji berlaku di kedua mode: shift yang dibuka
            // **hari sebelumnya** selalu perlu dikabarkan, jam berapa pun.
            shift: {
              // Pengingat tutup shift ikut dinyalakan supaya banner tetangganya
              // (pola flex yang sama, di halaman yang sama) ikut terukur di
              // lebar ini — dahulu kolom teksnya terjepit tanpa terpotong.
              active: true,
              reminderHour: 21,
              longShiftHours: 14,
              openHour: 8,
              closeHour: 22,
              notifyOwner: true,
            },
          },
        }),
      ],
    );
    await ctxPemilik.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [
        "mesinpos.shifts.v1",
        JSON.stringify({
          current: {
            id: "shift-uji-pemilik",
            // 26 jam lalu: pasti hari kalender sebelumnya, kapan pun tesnya jalan.
            openedAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
            openingCash: 300000,
            cashSales: 1250000,
            totalSales: 1500000,
            saleCount: 24,
            closedAt: null,
            countedCash: null,
            expectedCash: null,
            variance: null,
          },
          history: [],
        }),
      ],
    );

    /** Ukur satu element berserta tautan/tombol di dalamnya. */
    const UKUR_BANNER = (id) => {
      const element = document.querySelector(`[data-testid="${id}"]`);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const tautan = element.querySelector("a");
      const rectTautan = tautan ? tautan.getBoundingClientRect() : null;
      return {
        status: element.getAttribute("data-status"),
        teks: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
        lebar: Math.round(rect.width),
        kiri: Math.round(rect.left),
        kanan: Math.round(rect.right),
        /*
          Lebar kolom teksnya (semua `<p>` di dalam div `flex-1`). Ini yang
          menangkap “terjepit”: tautan `shrink-0` yang tidak mau turun baris
          memaksa paragrafnya jadi segelintir kata per baris — secara teknis
          tidak terpotong, tetapi bannernya jadi setinggi setengah layar HP.
        */
        lebarParagraf: [...element.querySelectorAll("p")].map((paragraf) =>
          Math.round(paragraf.getBoundingClientRect().width),
        ),
        tautanKiri: rectTautan ? Math.round(rectTautan.left) : null,
        tautanKanan: rectTautan ? Math.round(rectTautan.right) : null,
        layar: window.innerWidth,
      };
    };

    const { page, hasil } = await buka("/app/pos", 360, ctxPemilik);
    await page.waitForSelector('[data-testid="pos-pemberitahuan-pemilik"]', { timeout: 15_000 });
    const banner = await page.evaluate(UKUR_BANNER, "pos-pemberitahuan-pemilik");
    check(
      "kasir @ 360px: banner pemberitahuan ke pemilik toko muncul (shift kemarin belum ditutup)",
      banner !== null && banner.teks.includes("Shift kemarin belum ditutup"),
      JSON.stringify(banner),
    );
    check(
      "kasir @ 360px: banner pemberitahuan pemilik tidak terpotong di tepi",
      banner !== null && banner.kiri >= -0.5 && banner.kanan <= banner.layar + 0.5,
      JSON.stringify(banner),
    );
    check(
      "kasir @ 360px: tautan “Buka Shift & Kas” di banner pemberitahuan terjangkau",
      banner !== null &&
        banner.tautanKanan !== null &&
        banner.tautanKiri !== null &&
        banner.tautanKiri >= -0.5 &&
        banner.tautanKanan <= banner.layar + 0.5,
      JSON.stringify(banner),
    );
    check(
      "kasir @ 360px: halaman yang memasang banner pemilik tidak ada isi yang terpotong",
      hasil.jumlahTerpotong === 0,
      `${hasil.jumlahTerpotong} elemen: ${hasil.terpotong.join(" | ")}`,
    );
    check(
      "kasir @ 360px: kolom teks banner pemilik tidak terjepit (tautannya turun baris, dulu 129 px)",
      banner !== null &&
        banner.lebarParagraf.length > 0 &&
        Math.min(...banner.lebarParagraf) >= 200,
      JSON.stringify({ lebar: banner?.lebar, paragraf: banner?.lebarParagraf }),
    );
    const ingatTutupShift = await page.evaluate(UKUR_BANNER, "kasir-ingat-tutup-shift");
    check(
      "kasir @ 360px: kolom teks banner “ingat tutup shift” ikut lega (dulu 107 px)",
      ingatTutupShift !== null &&
        ingatTutupShift.lebarParagraf.length > 0 &&
        Math.min(...ingatTutupShift.lebarParagraf) >= 200 &&
        ingatTutupShift.kanan <= ingatTutupShift.layar + 0.5,
      JSON.stringify({ lebar: ingatTutupShift?.lebar, paragraf: ingatTutupShift?.lebarParagraf }),
    );
    await page.close();

    // Lebar paling rawan (di bawah 360 px yang diminta): banner yang sama harus
    // tetap muat — ia ikut dipakai toko yang perangkat kasirnya HP murah.
    const { page: pageSempit } = await buka("/app/pos", 320, ctxPemilik);
    await pageSempit.waitForSelector('[data-testid="pos-pemberitahuan-pemilik"]', {
      timeout: 15_000,
    });
    const bannerSempit = await pageSempit.evaluate(UKUR_BANNER, "pos-pemberitahuan-pemilik");
    check(
      "kasir @ 320px: banner pemberitahuan pemilik tetap tidak terpotong",
      bannerSempit !== null &&
        bannerSempit.kiri >= -0.5 &&
        bannerSempit.kanan <= bannerSempit.layar + 0.5 &&
        bannerSempit.tautanKanan !== null &&
        bannerSempit.tautanKanan <= bannerSempit.layar + 0.5,
      JSON.stringify(bannerSempit),
    );
    check(
      "kasir @ 320px: kolom teks banner pemilik juga tidak terjepit",
      bannerSempit !== null &&
        bannerSempit.lebarParagraf.length > 0 &&
        Math.min(...bannerSempit.lebarParagraf) >= 160,
      JSON.stringify({ lebar: bannerSempit?.lebar, paragraf: bannerSempit?.lebarParagraf }),
    );
    await pageSempit.close();

    const halaman = await buka("/app/shift", 360, ctxPemilik);
    await halaman.page.waitForSelector('[data-testid="pemberitahuan-pemilik"]', {
      timeout: 15_000,
    });
    const bannerShift = await halaman.page.evaluate(UKUR_BANNER, "pemberitahuan-pemilik");
    check(
      "halaman Shift & Kas @ 360px: banner pemberitahuan pemilik muncul dan tidak terpotong",
      bannerShift !== null &&
        bannerShift.kiri >= -0.5 &&
        bannerShift.kanan <= bannerShift.layar + 0.5 &&
        bannerShift.teks.includes("Shift kemarin belum ditutup"),
      JSON.stringify(bannerShift),
    );
    const kartuPemilik = await halaman.page.evaluate(() => {
      const element = document.querySelector('[data-testid="setelan-pemberitahuan-pemilik"]');
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const tombol = element.querySelector('[data-testid="pemberitahuan-pemilik-tangani"]');
      const rectTombol = tombol ? tombol.getBoundingClientRect() : null;
      return {
        kiri: Math.round(rect.left),
        kanan: Math.round(rect.right),
        lencana: element.querySelector('[data-testid="pemberitahuan-pemilik-lencana"]')
          ?.textContent?.trim() ?? null,
        tombolAda: Boolean(tombol),
        tombolKiri: rectTombol ? Math.round(rectTombol.left) : null,
        tombolKanan: rectTombol ? Math.round(rectTombol.right) : null,
        layar: window.innerWidth,
      };
    });
    check(
      "halaman Shift & Kas @ 360px: kartu “Pemberitahuan ke pemilik toko” muat di layar",
      kartuPemilik !== null &&
        kartuPemilik.kiri >= -0.5 &&
        kartuPemilik.kanan <= kartuPemilik.layar + 0.5,
      JSON.stringify(kartuPemilik),
    );
    check(
      "halaman Shift & Kas @ 360px: tombol “Tandai ditangani” (kalau ada barisnya) terjangkau",
      kartuPemilik !== null &&
        (!kartuPemilik.tombolAda ||
          (kartuPemilik.tombolKiri !== null &&
            kartuPemilik.tombolKiri >= -0.5 &&
            kartuPemilik.tombolKanan !== null &&
            kartuPemilik.tombolKanan <= kartuPemilik.layar + 0.5)),
      JSON.stringify(kartuPemilik),
    );
    check(
      "halaman Shift & Kas @ 360px: halaman dengan banner pemilik tidak ada isi yang terpotong",
      halaman.hasil.jumlahTerpotong === 0,
      `${halaman.hasil.jumlahTerpotong} elemen: ${halaman.hasil.terpotong.join(" | ")}`,
    );
    await halaman.page.close();
    await ctxPemilik.close();
  }

  // ── 5. Tabel katalog produk: kolom terakhirnya harus **bisa dicapai** dengan menggeser
  {
    const { page } = await buka("/app/products", 360);
    const tabel = await page.evaluate(() => {
      const table = document.querySelector("table");
      let wadah = table?.parentElement ?? null;
      while (wadah && getComputedStyle(wadah).overflowX !== "auto") wadah = wadah.parentElement;
      if (!wadah) return null;
      const headerTerakhir = [...table.querySelectorAll("th")].at(-1);
      const sebelum = headerTerakhir.getBoundingClientRect().right;
      wadah.scrollLeft = wadah.scrollWidth;
      const sesudah = headerTerakhir.getBoundingClientRect().right;
      return {
        overflowX: getComputedStyle(wadah).overflowX,
        bisaGeser: wadah.scrollWidth > wadah.clientWidth,
        sebelum: Math.round(sebelum),
        sesudah: Math.round(sesudah),
        layar: window.innerWidth,
        labelTerakhir: headerTerakhir.textContent.trim(),
      };
    });
    check(
      "katalog produk: tabelnya berada di wadah yang bisa digeser mendatar",
      tabel !== null && tabel.overflowX === "auto" && tabel.bisaGeser === true,
      JSON.stringify(tabel),
    );
    check(
      "katalog produk: kolom terakhir (Aksi) bisa dicapai dengan menggeser — dulu terpotong 581 px",
      tabel !== null && tabel.sesudah <= tabel.layar && tabel.sebelum > tabel.layar,
      JSON.stringify(tabel),
    );
    await page.close();
  }
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

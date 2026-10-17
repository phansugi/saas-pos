/**
 * Struk belanja di **browser sungguhan** (Chromium/Playwright) atas preview yang
 * sedang berjalan.
 *
 * Kenapa ada: `bun scripts/verify-struk.mjs` sudah membuktikan aturan murninya
 * (kolom per lebar kertas, penanda rangkap, catatan kaki) dan
 * `bun scripts/verify-render.mjs` membuktikan halaman & kasir merender struk itu —
 * tetapi keduanya berjalan di DOM tiruan yang **tidak punya lembar gaya cetak**.
 * Yang tidak bisa dibuktikan di sana justru dua hal yang paling mudah salah:
 *
 *   1. pratinjau struk di halaman Pengaturan benar-benar selebar kertas yang
 *      dipilih (76 mm di layar bukan sekadar angka di label), dan
 *   2. saat halaman **dicetak**, hanya struknya yang terlihat: sisanya (sidebar,
 *      header, keranjang) disembunyikan lembar gaya `@media print`.
 *
 * Keduanya diperiksa dari keadaan yang dihitung peramban sendiri —
 * `getComputedStyle` untuk lebar, dan `emulateMedia({ media: "print" })` untuk
 * aturan cetaknya — bukan dari kode sumber.
 *
 * Prasyarat:
 *   1. preview sedang berjalan (sesi demo ditanam skrip ini),
 *   2. Playwright terpasang **di luar repo** (`PLAYWRIGHT_DIR`), sama seperti
 *      `scripts/verify-bip-warna-browser.mjs`.
 *
 * Usage: PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs [http://localhost:5173]
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/+$/, "");
const SHOTS = "/tmp/browser-shots";

/** Playwright dari direktori terpisah (lihat “Prasyarat” di atas). */
const playwrightDir = process.env.PLAYWRIGHT_DIR;
const requireFrom = playwrightDir
  ? createRequire(`${playwrightDir.replace(/\/+$/, "")}/`)
  : createRequire(import.meta.url);
const { chromium } = requireFrom("playwright");

mkdirSync(SHOTS, { recursive: true });

/** 1 mm dalam piksel CSS (96 dpi) — untuk membandingkan lebar pratinjau. */
const MM_IN_PX = 96 / 25.4;

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

/** Sesi demo pemilik toko, supaya `/app` bisa dibuka tanpa alur masuk. */
const session = {
  user: { name: "Uji Struk", email: "struk-browser@mesinpos.test" },
  tenant: {
    name: "Warung Uji Struk",
    slug: "warung-uji-struk-browser",
    storeName: "Cabang Struk",
    vertical: "umkm",
    verticals: ["umkm", "fnb"],
    planKey: "enterprise",
    role: "owner",
    taxActive: true,
    taxRatePct: 11,
    // Pengingat tutup shift dimatikan: skrip ini menguji struk, bukan
    // pengingatnya — bannernya tidak boleh ikut mengubah tata letak kasir.
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
    // Hanya ditanam kalau belum ada: skrip init berjalan di **setiap** navigasi,
    // jadi menulis tanpa syarat akan menghapus setelan struk yang baru disimpan
    // begitu berpindah dari halaman Pengaturan ke kasir — dan yang diuji jadi
    // bukan aplikasinya, melainkan ulah harness-nya sendiri.
    if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
  } catch {
    // Penyimpanan diblokir: bukan bagian yang diuji di sini.
  }
}, ["mesinpos.session.v1", JSON.stringify(session)]);

/*
  Gerbang kasir (`posShiftGate`): halaman Kasir tidak bisa menjual kalau tidak ada
  shift yang terbuka di perangkat ini. Semua struk yang diuji di sini lahir dari
  penjualan di kasir, jadi shiftnya dibuka lebih dulu — sama seperti kasir
  sungguhan, yang membukanya di halaman Shift & Kas.
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
}, ["mesinpos.shifts.v1", "shift-uji-struk"]);

const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

/** Lebar & gaya terhitung sebuah elemen, apa adanya dari peramban. */
async function computed(selector, property) {
  return await page.evaluate(
    ([sel, prop]) => {
      const element = document.querySelector(sel);
      if (!element) return null;
      return window.getComputedStyle(element)[prop];
    },
    [selector, property],
  );
}

try {
  // ------------------------------------------------------------------ Pengaturan
  await page.goto(`${BASE}/app/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="struk-preview"]', { timeout: 45_000 });

  check(
    "halaman Pengaturan menampilkan kartu struk belanja di browser sungguhan",
    (await page.locator('[data-testid="struk-jenis-printer"]').isVisible()) &&
      (await page.getByText("Struk belanja").first().isVisible()),
    "kartu struk tidak terlihat",
  );

  const lebarBawaan = (await computed('[data-testid="struk-preview"]', "width")) ?? "";
  check(
    "pratinjau bawaan benar-benar selebar 80 mm di layar",
    Math.abs(parseFloat(lebarBawaan) - 80 * MM_IN_PX) < 2,
    `${lebarBawaan} px (80 mm = ${(80 * MM_IN_PX).toFixed(1)} px)`,
  );

  check(
    "pratinjau struk menyebut pembeli umum “Cash” selama kasir tidak memilih member",
    (await page.locator('[data-testid="struk-preview"]').innerText()).includes("Member : Cash"),
    (await page.locator('[data-testid="struk-preview"]').innerText()).slice(0, 160).replace(/\n/g, " / "),
  );
  check(
    "workspace tanpa logo menampilkan ajakan menambah logo, bukan kotak kosong",
    (await page.locator('[data-testid="logo-toko-kosong"]').isVisible()) &&
      (await page.getByText("Belum ada logo").first().isVisible()) &&
      (await page.locator('[data-testid="struk-preview-logo"]').count()) === 0,
    "seksi logo tidak sesuai bawaan",
  );
  check(
    "sebelum ada logo, sidebar memakai ikon bawaan (bukan gambar kosong)",
    (await page.locator('[data-testid="sidebar-logo-kosong"]').count()) === 1 &&
      (await page.locator('[data-testid="sidebar-logo"]').count()) === 0,
    `kosong=${await page.locator('[data-testid="sidebar-logo-kosong"]').count()} logo=${await page.locator('[data-testid="sidebar-logo"]').count()}`,
  );

  /*
    Logo diunggah lewat input berkas yang sama dengan yang dipakai pemilik toko,
    dengan berkas PNG yang **benar-benar digambar peramban** (canvas → PNG). Jadi
    yang diuji adalah jalur unggahnya, bukan berkas contoh yang ditempel: kalau
    gambarnya gagal didekode, `naturalWidth`-nya nol dan cek berikutnya merah.
  */
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 48;
    const context = canvas.getContext("2d");
    context.fillStyle = "#14532d";
    context.fillRect(0, 0, 96, 48);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const file = new File([blob], "logo-toko.png", { type: "image/png" });
    const input = document.querySelector('[aria-label="Pilih berkas logo toko"]');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForSelector('[data-testid="logo-toko-gambar"]', { timeout: 20_000 });
  const logoKartu = await page.evaluate(() => {
    const image = document.querySelector('[data-testid="logo-toko-gambar"]');
    return { natural: image?.naturalWidth ?? 0, src: (image?.src ?? "").slice(0, 22) };
  });
  check(
    "berkas logo benar-benar diterima & didekode peramban (96 px dari canvas)",
    logoKartu.natural === 96 && logoKartu.src.startsWith("data:image"),
    `naturalWidth=${logoKartu.natural} · ${logoKartu.src}`,
  );
  check(
    "logo tersimpan di sesi workspace (bertahan setelah muat ulang)",
    await page.evaluate(() =>
      (
        JSON.parse(window.localStorage.getItem("mesinpos.session.v1") ?? "null")?.tenant
          ?.logoUrl ?? ""
      ).startsWith("data:image"),
    ),
    "tenant.logoUrl kosong di penyimpanan sesi",
  );
  const logoSidebar = await page.evaluate(() => {
    const image = document.querySelector('[data-testid="sidebar-logo"]');
    return image ? { natural: image.naturalWidth, alt: image.alt } : null;
  });
  check(
    "logo yang sama langsung jadi penanda workspace di sidebar kiri",
    logoSidebar?.natural === 96 &&
      logoSidebar?.alt === "Logo Warung Uji Struk" &&
      (await page.locator('[data-testid="sidebar-logo-kosong"]').count()) === 0,
    JSON.stringify(logoSidebar),
  );

  const lebarLogo80 = (await computed('[data-testid="struk-preview-logo"]', "width")) ?? "";
  const tinggiLogo80 = (await computed('[data-testid="struk-preview-logo"]', "height")) ?? "";
  const filterLogo80 = (await computed('[data-testid="struk-preview-logo"]', "filter")) ?? "";
  check(
    "logo di pratinjau benar-benar 110 px × 110 px di layar, hitam putih, di atas nama usaha",
    Math.abs(parseFloat(lebarLogo80) - 110) < 2 &&
      Math.abs(parseFloat(tinggiLogo80) - 110) < 2 &&
      filterLogo80.includes("grayscale") &&
      (await page.evaluate(() => {
        const logo = document.querySelector('[data-testid="struk-preview-logo"]');
        const kertas = document.querySelector('[data-testid="struk-preview"]');
        if (!logo || !kertas) return false;
        return logo.getBoundingClientRect().top < kertas.getBoundingClientRect().top;
      })),
    `${lebarLogo80} × ${tinggiLogo80} px · filter ${filterLogo80}`,
  );

  // Pindah ke dot matrix + kertas faktur 241 mm, lalu tambah satu rangkap.
  await page.locator('[data-testid="struk-printer-dot_matrix"]').click();
  await page.locator('[data-testid="struk-kertas-241"]').click();
  await page.locator('button[aria-label="Tambah rangkap struk"]').click();

  const lebar241 = (await computed('[data-testid="struk-preview"]', "width")) ?? "";
  check(
    "memilih kertas 241 mm membuat pratinjaunya benar-benar selebar 241 mm",
    Math.abs(parseFloat(lebar241) - 241 * MM_IN_PX) < 2,
    `${lebar241} px (241 mm = ${(241 * MM_IN_PX).toFixed(1)} px)`,
  );
  const lebarLogo241 = (await computed('[data-testid="struk-preview-logo"]', "width")) ?? "";
  check(
    "logo tidak ikut melebar di kertas faktur 241 mm (tetap 110 px, bukan 121 mm)",
    Math.abs(parseFloat(lebarLogo241) - 110) < 2,
    `${lebarLogo241} px (logo tetap 110 px; 121 mm di layar = ${(121 * MM_IN_PX).toFixed(1)} px)`,
  );
  check(
    "rangkap dua menampilkan lembar kedua yang bisa dibaca (TEMBUSAN 1)",
    (await page.locator('[data-testid="struk-preview-2"]').innerText()).includes("TEMBUSAN 1"),
    (await page.locator('[data-testid="struk-preview-2"]').innerText()).slice(0, 120),
  );

  await page.getByRole("button", { name: "Simpan setelan struk" }).click();
  await page.waitForTimeout(300);
  const tersimpan = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("mesinpos.session.v1") ?? "null"),
  );
  check(
    "setelan yang dipilih tersimpan di workspace (dot matrix 241 mm, dua lembar)",
    tersimpan?.tenant?.receipt?.printerId === "dot_matrix" &&
      tersimpan?.tenant?.receipt?.paperWidthMm === 241 &&
      tersimpan?.tenant?.receipt?.copies === 2,
    JSON.stringify(tersimpan?.tenant?.receipt ?? null),
  );
  await page.screenshot({ path: `${SHOTS}/struk-pengaturan.png`, fullPage: false });

  /*
    Saran setelan otomatis: dasarnya modul yang hidup — di sesi ini UMKM + F&B,
    jadi jalur thermal 80 mm yang disarankan, sedangkan setelan yang tersimpan di
    workspace ini adalah dot matrix 241 mm (dua lembar). Karena itu tombolnya
    menawarkan perpindahan, dan menekannya harus benar-benar mengubah mesinnya.
  */
  const saranOtomatis = await page.evaluate(() => {
    const kotak = document.querySelector('[data-testid="struk-saran-otomatis"]');
    const tombol = document.querySelector('[data-testid="struk-pakai-saran"]');
    const kertas = document.querySelector('[data-testid="struk-kertas-otomatis"]');
    return {
      ada: Boolean(kotak),
      teks: (kotak?.textContent ?? "").replace(/\s+/g, " ").trim(),
      tombol: (tombol?.textContent ?? "").replace(/\s+/g, " ").trim(),
      tombolTerkunci: tombol?.disabled ?? null,
      kertas: (kertas?.textContent ?? "").replace(/\s+/g, " ").trim(),
    };
  });
  check(
    "kartu saran otomatis menyebut dasar modulnya (F&B) beserta mesin yang disarankan",
    saranOtomatis.ada &&
      saranOtomatis.teks.includes("Modul F&B") &&
      saranOtomatis.teks.includes("printer Thermal") &&
      saranOtomatis.tombol.includes("Pakai saran ini") &&
      saranOtomatis.tombolTerkunci === false,
    saranOtomatis.teks.slice(0, 200),
  );
  check(
    "catatan kertas menyebut lebar yang menyesuaikan sendiri saat printer diganti",
    saranOtomatis.kertas.includes("76 mm") && saranOtomatis.kertas.includes("80 mm"),
    saranOtomatis.kertas,
  );
  await page.locator('[data-testid="struk-pakai-saran"]').click();
  await page.waitForTimeout(250);
  const setelahSaran = await page.evaluate(() => {
    const teks = (selector) =>
      (document.querySelector(selector)?.textContent ?? "").replace(/\s+/g, " ").trim();
    return {
      thermalTerpilih: document
        .querySelector('[data-testid="struk-printer-thermal"]')
        ?.getAttribute("aria-pressed"),
      kertas58: Boolean(document.querySelector('[data-testid="struk-kertas-58"]')),
      kertas80: Boolean(document.querySelector('[data-testid="struk-kertas-80"]')),
      kertas241: Boolean(document.querySelector('[data-testid="struk-kertas-241"]')),
      lebarPratinjau:
        document.querySelector('[data-testid="struk-preview"]')?.style?.width ?? null,
      rangkap: teks('[data-testid="struk-rangkap"]'),
      tombol: teks('[data-testid="struk-pakai-saran"]'),
      tombolTerkunci:
        document.querySelector('[data-testid="struk-pakai-saran"]')?.disabled ?? null,
    };
  });
  check(
    "menekan “Pakai saran ini” benar-benar memindahkan setelannya (thermal 80 mm, satu lembar)",
    setelahSaran.thermalTerpilih === "true" &&
      setelahSaran.kertas58 &&
      setelahSaran.kertas80 &&
      !setelahSaran.kertas241 &&
      setelahSaran.lebarPratinjau === "80mm" &&
      setelahSaran.rangkap.includes("1 lembar") &&
      setelahSaran.tombol.includes("Sudah sesuai") &&
      setelahSaran.tombolTerkunci === true,
    JSON.stringify(setelahSaran),
  );

  // Muat ulang halaman: logo tidak boleh hilang hanya karena sesi dibaca ulang.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="logo-toko-gambar"]', { timeout: 45_000 });
  check(
    "setelah halaman dimuat ulang, logonya masih terpasang di pratinjau struk",
    (await page.locator('[data-testid="struk-preview-logo"]').count()) === 1,
    "logo hilang setelah muat ulang",
  );

  // -------------------------------------------------------------- Panduan
  // Halaman Panduan memakai logo workspace yang sama: kasir yang membuka panduan
  // melihat identitas yang benar-benar tercetak di struknya.
  await page.goto(`${BASE}/app/panduan`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="panduan-logo"]', { timeout: 45_000 });
  const logoPanduan = await page.evaluate(() => {
    const image = document.querySelector('[data-testid="panduan-logo"]');
    return image ? { natural: image.naturalWidth, alt: image.alt } : null;
  });
  check(
    "halaman Panduan menampilkan logo workspace yang sama dengan sidebar",
    logoPanduan?.natural === 96 && logoPanduan?.alt === "Logo Warung Uji Struk",
    JSON.stringify(logoPanduan),
  );
  check(
    "halaman Panduan menyebut panduan PDF 19 bagian & 12 gambar",
    await page.getByText("19 bagian · 12 gambar").first().isVisible(),
    "lencana jumlah bagian tidak ditemukan",
  );
  /*
    Panduan singkat kirim struk ke WhatsApp pembeli tampil di halaman ini (bukan
    cuma di berkas PDF): kasir memakainya sebagai petunjuk pertama, dan yang
    dijelaskan harus perilaku yang benar-benar ada di layar kasir — satu gambar
    struk berlogo, nomor pembeli umum, dan syarat kanal WhatsApp-nya.
  */
  const kartuPanduanStruk = page.locator('[data-testid="panduan-kirim-struk"]');
  const teksPanduanStruk = (await kartuPanduanStruk.innerText()).replace(/\s+/g, " ");
  check(
    "panduan singkat kirim struk ke WhatsApp pembeli tampil di halaman Panduan",
    (await kartuPanduanStruk.isVisible()) &&
      teksPanduanStruk.includes("Kirim struk ke WhatsApp pembeli") &&
      teksPanduanStruk.includes("gambar struk PNG berlogo") &&
      teksPanduanStruk.includes("Nomor WhatsApp pembeli") &&
      teksPanduanStruk.includes("WHATSAPP_PHONE_NUMBER_ID") &&
      teksPanduanStruk.includes("Bagikan gambar struk") &&
      teksPanduanStruk.includes("Unduh PDF") &&
      teksPanduanStruk.includes("bagian 18"),
    teksPanduanStruk.slice(0, 200),
  );
  check(
    "panduan struk itu menautkan ke kasir & ke setelan struk",
    (await kartuPanduanStruk.locator('a[href="/app/pos"]').count()) === 1 &&
      (await kartuPanduanStruk.locator('a[href="/app/settings"]').count()) === 1,
    `${await kartuPanduanStruk.locator('a[href="/app/pos"]').count()} tautan kasir · ${await kartuPanduanStruk.locator('a[href="/app/settings"]').count()} tautan setelan`,
  );

  // ------------------------------------------------------------------- Kasir
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Cappuccino/ }).first().click();
  await page.waitForTimeout(200);

  check(
    "di layar, area cetak struk kasir memang disembunyikan",
    (await computed('[data-testid="struk-cetak"]', "display")) === "none",
    (await computed('[data-testid="struk-cetak"]', "display")) ?? "(tidak ada)",
  );
  /*
    Alur struk: cetak & kirim baru ditawarkan sesudah pembayarannya lunas. Di
    keranjang yang masih disusun, keduanya belum ada sama sekali — bukan sekadar
    terkunci.
  */
  check(
    "keranjang yang belum dibayar belum menawarkan Cetak / Struk & kirim di panel",
    (await page.locator('button[aria-label="Cetak struk"]').count()) === 0 &&
      (await page.locator('button[aria-label="Struk & kirim"]').count()) === 0 &&
      (await page.locator('[data-testid="struk-lunas-catatan"]').count()) === 0,
    `cetak=${await page.locator('button[aria-label="Cetak struk"]').count()} panel=${await page.locator('button[aria-label="Struk & kirim"]').count()}`,
  );

  const strukLayar = await page.locator('[data-testid="struk-cetak"]').innerText();
  check(
    "struk kasir memuat barang, penanda rangkap, dan catatan kaki setelan",
    strukLayar.includes("Cappuccino") &&
      strukLayar.includes("ASLI") &&
      strukLayar.includes("TEMBUSAN 1") &&
      strukLayar.includes("Terima kasih telah berbelanja"),
    strukLayar.slice(0, 240).replace(/\n/g, " / "),
  );
  // Diperiksa **per lembar**: teks seluruh area cetak menyambung baris terakhir
  // lembar pertama dengan baris pertama lembar kedua (tidak ada pemisah antar
  // `<pre>`), padahal di kertas keduanya terpisah.
  const barisLembarSatu = (
    await page.locator('[data-testid="struk-cetak-lembar-1"]').innerText()
  ).split("\n");
  check(
    "setiap baris struk kasir paling panjang 80 karakter (kertas faktur 241 mm)",
    barisLembarSatu.every((line) => line.length <= 80),
    String(Math.max(...barisLembarSatu.map((line) => line.length))),
  );

  check(
    "struk kasir memuat logo toko dan nama kasir yang melayaninya",
    (await page.locator('[data-testid="struk-cetak-logo-1"]').count()) === 1 &&
      barisLembarSatu.some((line) => line.trim() === "Kasir : Uji Struk") &&
      barisLembarSatu.indexOf("Member : Cash") <
        barisLembarSatu.indexOf("Kasir : Uji Struk"),
    barisLembarSatu.slice(0, 8).join(" / "),
  );
  check(
    "kasir tanpa member mencetak “Member : Cash” di struknya",
    barisLembarSatu.some((line) => line.trim() === "Member : Cash"),
    barisLembarSatu.slice(0, 8).join(" / "),
  );

  // Member dengan diskon 0 % dipilih supaya totalnya tidak berubah: yang diuji di
  // sini baris pembelinya, bukan hitungan diskonnya.
  await page.locator('[aria-label="Cari member"]').fill("Rina");
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: /Rina Kartika/ }).first().click();
  await page.waitForTimeout(200);
  const barisSetelahMember = (
    await page.locator('[data-testid="struk-cetak-lembar-1"]').innerText()
  ).split("\n");
  check(
    "memilih member di kasir mengganti baris pembeli di struk dengan namanya",
    barisSetelahMember.includes("Member : Rina Kartika") &&
      !barisSetelahMember.some((line) => line.includes("Cash")),
    barisSetelahMember.slice(0, 8).join(" / "),
  );

  // ------------------------------- Pilihan rupiah di pembayaran tunai
  /*
    Kasir menekan pecahan uang yang diserahkan pembeli alih-alih mengetiknya.
    Labelnya dirender `Intl` di peramban (bisa berbeda spasi/pemisahnya dari DOM
    tiruan), jadi yang diperiksa di sini adalah hasil render sungguhan beserta
    akibatnya: kolom “Uang diterima” terisi, pilihannya ditandai aktif, dan
    kembaliannya dihitung dari nominal itu. Dialognya ditutup lagi supaya
    pemeriksaan cetak di bawah tidak dijalankan di atas modal yang terbuka.
  */
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  await page.waitForSelector('[data-testid="cash-cepat-10000"]', { timeout: 20_000 });

  const PECAHAN = [10_000, 20_000, 50_000, 100_000, 500_000];
  const labelPecahan = await page.evaluate(
    (daftar) =>
      daftar.map((amount) => {
        const button = document.querySelector(`[data-testid="cash-cepat-${amount}"]`);
        return button ? (button.textContent ?? "").replace(/\s+/g, " ").trim() : null;
      }),
    PECAHAN,
  );
  check(
    "dialog tunai menampilkan lima tombol pecahan uang: Rp 10.000, 20.000, 50.000, 100.000, 500.000",
    labelPecahan.every((label) => /^Rp[\s\u00a0]?\d{1,3}(\.\d{3})*$/.test(label ?? "")) &&
      labelPecahan[0].includes("10.000") &&
      labelPecahan[4].includes("500.000"),
    JSON.stringify(labelPecahan),
  );

  // Panel kasir hanya selebar 380 px: tombol yang meluber ke luar dialog bukan
  // sekadar jelek — di layar kecil sebagian tombolnya tidak bisa ditekan lagi.
  const muatDiDialog = await page.evaluate(() => {
    const baris = document.querySelector('[data-testid="cash-cepat"]');
    const modal = baris?.closest("div.fixed");
    const kotak = modal?.querySelector('[class*="max-w-md"]');
    const batas = kotak?.getBoundingClientRect();
    const tombol = [...document.querySelectorAll('[data-testid^="cash-cepat-"]')];
    if (!batas || tombol.length === 0) return null;
    return {
      jumlah: tombol.length,
      meluber: tombol.filter(
        (row) =>
          row.getBoundingClientRect().right > batas.right + 0.5 ||
          row.getBoundingClientRect().left < batas.left - 0.5,
      ).length,
      terlihat: tombol.filter((row) => row.getBoundingClientRect().width > 0).length,
    };
  });
  check(
    "kelima tombol pecahan benar-benar muat di dalam dialog (tidak meluber)",
    muatDiDialog?.jumlah === 5 &&
      muatDiDialog.meluber === 0 &&
      muatDiDialog.terlihat === 5,
    JSON.stringify(muatDiDialog),
  );

  await page.locator('[data-testid="cash-cepat-100000"]').click();
  await page.waitForTimeout(200);
  const tunai = await page.evaluate(() => {
    const input = document.querySelector("#cash");
    const aktif = document.querySelector('[data-testid="cash-cepat-100000"]');
    const baris = [...document.querySelectorAll("div")].find((row) =>
      (row.textContent ?? "").replace(/\s+/g, " ").trim().startsWith("Kembalian"),
    );
    const kolom = baris ? [...baris.querySelectorAll("span")] : [];
    const simpan = [...document.querySelectorAll("button")].find((button) =>
      (button.textContent ?? "").includes("Selesaikan pembayaran"),
    );
    return {
      nilai: input ? Number(input.value) : null,
      aktif: aktif?.getAttribute("aria-pressed") ?? null,
      kembalian: kolom.length ? (kolom[kolom.length - 1].textContent ?? "").trim() : null,
      simpanTerkunci: simpan?.disabled ?? null,
    };
  });
  check(
    "menekan Rp 100.000 mengisi kolom Uang diterima, menandai pilihannya aktif, dan membuka tombol simpan",
    tunai.nilai === 100_000 && tunai.aktif === "true" && tunai.simpanTerkunci === false,
    JSON.stringify(tunai),
  );
  check(
    "kembaliannya dihitung peramban dari nominal itu (Rp 100.000 − total, bukan Rp 0)",
    typeof tunai.kembalian === "string" &&
      /^Rp/.test(tunai.kembalian) &&
      Number(tunai.kembalian.replace(/[^\d]/g, "")) > 0,
    String(tunai.kembalian),
  );

  await page.getByRole("button", { name: "Tutup pembayaran" }).click();
  await page.waitForTimeout(200);
  check(
    "setelah dialognya ditutup, keranjang & struknya tetap utuh (tidak ada penjualan tercatat)",
    (await page.locator('[data-testid="cash-cepat-10000"]').count()) === 0 &&
      (await page.locator('[data-testid="struk-cetak"]').count()) === 1,
    `pecahan=${await page.locator('[data-testid="cash-cepat-10000"]').count()} struk=${await page.locator('[data-testid="struk-cetak"]').count()}`,
  );

  // Mode cetak: justru inilah yang tidak bisa diuji di DOM tiruan.
  await page.emulateMedia({ media: "print" });
  check(
    "saat dicetak, area struknya yang tampil (bukan disembunyikan lagi)",
    (await computed('[data-testid="struk-cetak"]', "display")) === "block" &&
      (await computed('[data-testid="struk-cetak"]', "visibility")) === "visible",
    `${await computed('[data-testid="struk-cetak"]', "display")} / ${await computed(
      '[data-testid="struk-cetak"]',
      "visibility",
    )}`,
  );
  const cetakLogo = await page.evaluate(() => {
    const image = document.querySelector('[data-testid="struk-cetak-logo-1"]');
    if (!image) return null;
    const style = window.getComputedStyle(image);
    return { visibility: style.visibility, width: style.width, height: style.height, filter: style.filter };
  });
  check(
    "logonya ikut terlihat saat mencetak, dengan ukuran 110 px × 110 px & saringan hitam putih",
    cetakLogo?.visibility === "visible" &&
      Math.abs(parseFloat(cetakLogo.width) - 110) < 2 &&
      Math.abs(parseFloat(cetakLogo.height) - 110) < 2 &&
      cetakLogo.filter.includes("grayscale"),
    JSON.stringify(cetakLogo),
  );

  /*
    Bukti terakhir yang paling dekat dengan kertasnya: gambarnya benar-benar
    keluar **satu warna**. Logo uji diunggah sebagai kotak hijau (#14532d), jadi
    kalau filternya tidak dipakai di jalur cetak, pikselnya tetap punya selisih
    kanal. Tangkapan layar elemen diambil peramban dalam mode cetak, lalu dibaca
    ulang lewat canvas: selisih kanal terbesar harus 0 (abu-abu murni), dan tetap
    ada piksel gelap — supaya “putih semua” tidak lolos sebagai hitam putih.
  */
  const tangkapanLogo = await page
    .locator('[data-testid="struk-cetak-logo-1"]')
    .screenshot();
  const pikselLogo = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let maxChroma = 0;
    let gelap = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      maxChroma = Math.max(maxChroma, Math.max(r, g, b) - Math.min(r, g, b));
      if ((r + g + b) / 3 < 128) gelap += 1;
    }
    return { maxChroma, gelap, total: (canvas.width * canvas.height) | 0 };
  }, tangkapanLogo.toString("base64"));
  check(
    "hasil cetak logonya benar-benar satu warna: tanpa selisih kanal sama sekali (hijau → abu-abu)",
    pikselLogo.maxChroma === 0 && pikselLogo.gelap > 0,
    `selisih kanal maks ${pikselLogo.maxChroma} · ${pikselLogo.gelap}/${pikselLogo.total} piksel gelap`,
  );
  check(
    "sidebar & header aplikasi disembunyikan saat mencetak",
    (await computed("aside", "visibility")) === "hidden" &&
      (await computed("header", "visibility")) === "hidden",
    `${await computed("aside", "visibility")} / ${await computed("header", "visibility")}`,
  );

  const teksCetak = await page.evaluate(() => document.body.innerText);
  check(
    "yang tercetak hanya struknya — teks antarmuka kasir tidak ikut",
    /*
      Penandanya kalimat yang **hanya** ada di antarmuka: “Bayar” tidak dipakai
      lagi di sini karena struknya sendiri punya baris `Bayar` (nominal uang yang
      diterima kasir) — sejak pembayaran tunai meninggalkan uangnya, kata itu
      muncul di kertas secara sah, jadi tidak lagi bisa membedakan bocornya UI.
    */
    teksCetak.includes("Cappuccino") &&
      !teksCetak.includes("Selesaikan pembayaran") &&
      !teksCetak.includes("Keranjang"),
    teksCetak.slice(0, 200).replace(/\n/g, " / "),
  );

  // Satu halaman PDF sungguhan: bukti aturan cetaknya dipakai mesin cetak, bukan
  // hanya dibaca peramban.
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  check(
    "mencetak struk menghasilkan berkas PDF yang benar-benar berisi (bukan halaman kosong)",
    pdf.length > 1500,
    `${pdf.length} byte`,
  );

  /*
    Ukuran kertas printer struk: halaman kasir menulis aturan `@page` dari setelan
    workspace (dot matrix 241 mm, dua lembar), dan yang diuji di sini bukan teksnya
    melainkan **akibatnya di mesin cetak peramban** — halaman PDF yang benar-benar
    dihasilkan harus selebar 241 mm, bukan A4/Leter bawaan. `auto` di tinggi kertas
    sengaja ditolak: bentuk itu tidak sah dan dibuang peramban tanpa pesan apa pun
    (`document.styleSheets` hanya menyisakan margin-nya).
  */
  const aturanCetak = await page.evaluate(() => {
    const style = document.querySelector('[data-testid="struk-kertas-css"]');
    if (!style) return null;
    const cssRules = style.sheet
      ? Array.from(style.sheet.cssRules).map((rule) => rule.cssText)
      : [];
    /*
      Tinggi area struk yang diukur peramban sendiri (dalam piksel CSS), dari
      dua lembar rangkap yang menumpuk: angka inilah yang harus muat di kertas
      yang ditulis aplikasi — kalau tingginya kurang, lembar tembusannya terpotong.
    */
    const area = document.querySelector('[data-testid="struk-cetak"]');
    const rect = area?.getBoundingClientRect();
    return {
      teks: style.textContent ?? "",
      cssRules,
      tinggiAreaPx: rect?.height ?? null,
      lebarAreaPx: rect?.width ?? null,
    };
  });
  check(
    "aturan cetaknya benar-benar terbaca peramban: @page selebar 241 mm × tinggi notanya",
    aturanCetak !== null &&
      aturanCetak.cssRules.some((rule) => /^@page \{ size: 241mm \d+(\.\d+)?mm; margin: 4mm; \}$/.test(rule)) &&
      !(aturanCetak.teks).includes("auto"),
    JSON.stringify(aturanCetak),
  );
  const mediaBox = /MediaBox\s*\[([^\]]*)\]/.exec(pdf.toString("latin1"));
  const [lebarPt, tinggiPt] = (mediaBox?.[1] ?? "")
    .trim()
    .split(/\s+/)
    .map(Number)
    .slice(2);
  const MM_KE_PT = 72 / 25.4;
  check(
    "halaman yang benar-benar tercetak selebar kertas struknya (241 mm), bukan A4/Leter",
    Number.isFinite(lebarPt) &&
      Math.abs(lebarPt - 241 * MM_KE_PT) < 2 &&
      Number.isFinite(tinggiPt) &&
      tinggiPt > 50 &&
      tinggiPt < 2000,
    `${lebarPt?.toFixed(1)} × ${tinggiPt?.toFixed(1)} pt (241 mm = ${(241 * MM_KE_PT).toFixed(1)} pt)`,
  );
  /*
    Tinggi kertasnya diuji **terhadap tinggi isi yang diukur peramban sendiri**:
    struk ini bercetak rangkap dua, jadi kertasnya harus cukup untuk kedua lembar
    yang menumpuk. Angka tinggi yang salah tidak terlihat dari kode — hanya dari
    perbandingan ukuran halaman PDF dengan ukuran area struk di mesin render.
  */
  const tinggiAreaMm = (aturanCetak?.tinggiAreaPx ?? 0) * 25.4 / 96;
  check(
    "tinggi kertasnya cukup untuk seluruh isi struknya (dua lembar rangkap tidak terpotong)",
    tinggiAreaMm > 20 && tinggiPt > tinggiAreaMm * MM_KE_PT - 1,
    `kertas ${tinggiPt?.toFixed(1)} pt = ${(tinggiPt / MM_KE_PT).toFixed(1)} mm · isi ${tinggiAreaMm.toFixed(1)} mm`,
  );
  await page.screenshot({ path: `${SHOTS}/struk-cetak.png` });
  await page.emulateMedia({ media: "screen" });

  // ------------------------------- Dialog struk sesudah pembayaran lunas
  /*
    Satu dialog untuk tiga jalan struk sampai ke pembeli: cetak, unduh PDF, dan
    kirim ke WhatsApp member. Inilah bagian yang tidak bisa dipercaya dari kode
    saja — berkas PDF-nya harus benar-benar **terunduh** (byte-nya dibaca kembali
    di sini), dan jendela cetak peramban tidak boleh terbuka sebelum kasir memilih
    Cetak. Jendela cetaknya sendiri tidak bisa dibuka uji otomatis, jadi
    `window.print` diganti penghitung: yang diperiksa **kapan** ia dipanggil dan
    **apa** isi area cetak saat itu.
  */
  await page.evaluate(() => {
    window.__cetakanStruk = 0;
    window.print = () => {
      window.__cetakanStruk += 1;
    };
  });

  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  await page.waitForSelector('[data-testid="cash-cepat-100000"]', { timeout: 20_000 });
  await page.locator('[data-testid="cash-cepat-100000"]').click();
  await page.getByRole("button", { name: "Selesaikan pembayaran" }).click();
  await page.waitForSelector('[data-testid="struk-dialog"]', { timeout: 20_000 });
  await page.waitForTimeout(200);

  /** Tombol di dalam dialog struk — namanya sama dengan tombol panel kasir. */
  const tombolDialog = (nama) =>
    page.locator('[data-testid="struk-dialog"]').getByRole("button", { name: nama });

  const nomorStruk =
    (await page
      .locator('[data-testid="struk-cetak-lembar-1"]')
      .innerText()
      .then((teks) => teks.split("\n").find((baris) => baris.trim().startsWith("No.")))
      .catch(() => null)) ?? "";
  const nomorNota = nomorStruk.replace(/^No\.\s*/, "").trim();
  check(
    "pembayaran tunai lunas membuka dialog struk — dan belum mencetak apa pun",
    (await page.locator('[data-testid="struk-unduh-pdf"]').isVisible()) &&
      (await page.locator('[data-testid="struk-kirim-wa"]').isVisible()) &&
      (await page.locator('[data-testid="struk-cetak-dialog"]').isVisible()) &&
      (await page.evaluate(() => window.__cetakanStruk)) === 0,
    `nomor=${nomorStruk}`,
  );
  check(
    "dialognya menyebut nomor nota penjualan yang baru lunas, bukan keranjang kosong",
    nomorNota !== "" &&
      (await page.locator('[data-testid="struk-dialog"]').innerText()).includes(nomorNota),
    `${nomorStruk} · ${(await page.locator('[data-testid="struk-dialog"]').innerText()).slice(0, 120).replace(/\n/g, " / ")}`,
  );

  /*
    Perintah ke dapur: bagian alur F&B yang diminta pemilik repo — begitu uangnya
    diterima (tunai, QRIS, atau VA), pesanannya berangkat sendiri ke dapur, tanpa
    kasir menekan tombol kedua. Yang dibaca di sini kalimatnya di dialog struk
    yang baru terbuka, karena itulah tempat kasir sedang menatap.
  */
  const notisDapur = page.locator('[data-testid="struk-dapur"]');
  check(
    "dialog struk memberi tahu kasir bahwa pesanannya sudah dikirim ke dapur",
    (await notisDapur.count()) === 1 && /dikirim ke dapur/.test(await notisDapur.innerText()),
    (await notisDapur.count()) === 1 ? await notisDapur.innerText() : "notis dapur tidak ada",
  );

  // Unduhan sungguhan: berkasnya diambil peramban, lalu dibaca kembali di sini.
  const [unduhan] = await Promise.all([
    page.waitForEvent("download", { timeout: 20_000 }),
    page.locator('[data-testid="struk-unduh-pdf"]').click(),
  ]);
  const namaBerkas = unduhan.suggestedFilename();
  const berkasPdf = readFileSync(await unduhan.path());
  const teksPdf = berkasPdf.toString("latin1");
  check(
    `berkas PDF struk benar-benar terunduh, bernama nomor notanya (${namaBerkas})`,
    namaBerkas === `struk-${nomorNota}.pdf`,
    namaBerkas,
  );
  check(
    "isinya berkas PDF yang utuh: header, trailer, dan satu halaman per lembar rangkap",
    teksPdf.startsWith("%PDF-1.4") &&
      teksPdf.trimEnd().endsWith("%%EOF") &&
      berkasPdf.length > 1000 &&
      (teksPdf.match(/\/Type \/Page /g) ?? []).length === 2,
    `${berkasPdf.length} byte · ${(teksPdf.match(/\/Type \/Page /g) ?? []).length} halaman`,
  );
  check(
    "PDF-nya memuat isi struk yang sama — nama usaha, pembeli, kasir, barang, total, dan penanda tembusannya",
    teksPdf.includes("Warung Uji Struk") &&
      teksPdf.includes("Member : Rina Kartika") &&
      teksPdf.includes("Kasir : Uji Struk") &&
      teksPdf.includes("Cappuccino") &&
      teksPdf.includes("TOTAL") &&
      teksPdf.includes("TEMBUSAN 1") &&
      teksPdf.includes("Terima kasih telah berbelanja"),
    teksPdf.slice(0, 160).replace(/\n/g, " / "),
  );
  /*
    Logonya benar-benar ada **di dalam berkasnya**, bukan cuma di pratinjau: yang
    diunggah tadi adalah PNG 96 × 48 berisi satu warna (#14532d) dari kanvas
    peramban, jadi byte gambarnya bisa dicocokkan satu per satu. Keabuannya
    memakai bobot yang sama dengan jalur ESC/POS (0,299 R + 0,587 G + 0,114 B),
    yaitu 60 untuk #14532d.
  */
  const gambarPdf = /\/Subtype \/Image \/Width (\d+) \/Height (\d+) \/ColorSpace \/DeviceGray \/BitsPerComponent 8 \/Length (\d+) >>\nstream\n/.exec(
    teksPdf,
  );
  const abuAbu = Math.round(0.299 * 0x14 + 0.587 * 0x53 + 0.114 * 0x2d);
  const byteGambar = gambarPdf
    ? [...berkasPdf.subarray(gambarPdf.index + gambarPdf[0].length)]
    : [];
  check(
    "berkas PDF-nya memuat gambar logonya: satu objek DeviceGray seukuran aslinya (96 × 48, tidak diperbesar)",
    Boolean(gambarPdf) &&
      gambarPdf[1] === "96" &&
      gambarPdf[2] === "48" &&
      Number(gambarPdf[3]) === 96 * 48,
    gambarPdf ? `${gambarPdf[1]}×${gambarPdf[2]} · ${gambarPdf[3]} byte` : "objek gambar tidak ada",
  );
  check(
    `isi gambar itu benar-benar logonya (${abuAbu} = abu-abu #14532d)`, 
    byteGambar.length >= 96 * 48 &&
      byteGambar.slice(0, 96 * 48).every((byte) => byte === abuAbu),
    `byte pertama ${byteGambar.slice(0, 6).join(",")} · diharapkan ${abuAbu}`,
  );
  check(
    "gambarnya disimpan satu kali walau struknya dua lembar",
    (teksPdf.match(/\/Subtype \/Image/g) ?? []).length === 1 &&
      (teksPdf.match(/\/XObject << \/Logo /g) ?? []).length === 2,
    `${(teksPdf.match(/\/Subtype \/Image/g) ?? []).length} gambar · ${(teksPdf.match(/\/XObject << \/Logo /g) ?? []).length} rujukan`,
  );

  check(
    "laporan hasilnya menyebut nama berkas & ukurannya, bukan klaim kosong",
    (await page.locator('[data-testid="struk-notice"]').innerText()).includes(
      namaBerkas,
    ) &&
      (await page.locator('[data-testid="struk-notice"]').innerText()).includes("KB"),
    await page.locator('[data-testid="struk-notice"]').innerText(),
  );

  /*
    **Gambar** struk (satu berkas PNG): jalur yang di Android paling mungkin
    menampilkan logonya di WhatsApp, karena pasangan PDF + PNG diserahkan dengan
    tipe intent umum dan WhatsApp bisa mengambil berkas pertamanya saja. Yang
    diperiksa bukan “tombolnya ada”, melainkan berkasnya: satu berkas `image/png`
    bernama nomor notanya, ukurannya **sama** dengan yang dilaporkan dialognya, dan
    isinya benar-benar struknya — logo hijau yang diunggah tadi di atas nama usaha
    (di **kedua** lembar rangkap), teks gelap di badannya, dan tidak ada baris yang
    terpotong di tepi kanan kertasnya.
  */
  await page.evaluate(() => {
    window.__bagikanGambar = [];
    Object.defineProperty(window.navigator, "share", {
      value: async (payload) => {
        window.__bagikanGambar.push(payload);
      },
      configurable: true,
    });
    Object.defineProperty(window.navigator, "canShare", {
      value: (payload) => Array.isArray(payload?.files) && payload.files.length > 0,
      configurable: true,
    });
  });
  check(
    "dialog struk menawarkan satu jalur berbagi struk: “Bagikan gambar struk”",
    (await page.locator('[data-testid="struk-bagikan-gambar"]').isVisible()) &&
      (await page.locator('[data-testid="struk-bagikan-pdf"]').count()) === 0,
    `gambar=${await page.locator('[data-testid="struk-bagikan-gambar"]').count()} · pdf=${await page.locator('[data-testid="struk-bagikan-pdf"]').count()}`,
  );
  await page.locator('[data-testid="struk-bagikan-gambar"]').click();
  await page.waitForFunction(() => (window.__bagikanGambar?.length ?? 0) > 0, null, {
    timeout: 30_000,
  });
  const gambar = await page.evaluate(async () => {
    const berkas = window.__bagikanGambar.at(-1)?.files ?? [];
    if (berkas.length !== 1) return { jumlah: berkas.length };
    const file = berkas[0];
    const bitmap = await createImageBitmap(file);
    const kanvas = document.createElement("canvas");
    kanvas.width = bitmap.width;
    kanvas.height = bitmap.height;
    const ctx = kanvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;

    const mirip = (r, g, b, acuan) =>
      Math.abs(r - acuan[0]) <= 6 && Math.abs(g - acuan[1]) <= 6 && Math.abs(b - acuan[2]) <= 6;

    /*
      Baris “latar” = hampir seluruh barisnya abu-abu (238,241,245) — di situlah
      tepi gambar dan jarak antar lembar. Baris “kertas” = sisanya. Kolom tengah
      saja tidak bisa dipakai: teks struk memotongnya, jadi satu lembar akan
      terlihat seperti puluhan blok kecil.
    */
    let blokKertas = 0;
    let barisLatar = 0;
    let sedangKertas = false;
    for (let y = 0; y < bitmap.height; y += 1) {
      let latar = 0;
      let contoh = 0;
      for (let x = 0; x < bitmap.width; x += 2) {
        const offset = (y * bitmap.width + x) * 4;
        contoh += 1;
        if (mirip(px[offset], px[offset + 1], px[offset + 2], [238, 241, 245])) latar += 1;
      }
      const barisLatarIni = latar / contoh >= 0.9;
      if (barisLatarIni) barisLatar += 1;
      else if (!sedangKertas) blokKertas += 1;
      sedangKertas = !barisLatarIni;
    }

    /*
      Logo uji itu satu warna (#14532d) dan digambar **berwarna** di gambar ini
      (di kertas & PDF ia hitam putih), jadi pikselnya bisa dicocokkan langsung.
      Teks struknya gelap; piksel terjauhnya dipakai untuk membuktikan tidak ada
      baris yang melewati tepi kanan kertasnya.
    */
    const hijau = { atas: 0, bawah: 0, minX: bitmap.width, maxX: 0, minY: bitmap.height, maxY: 0 };
    let gelap = 0;
    let maxXGelap = 0;
    for (let y = 0; y < bitmap.height; y += 1) {
      for (let x = 0; x < bitmap.width; x += 1) {
        const offset = (y * bitmap.width + x) * 4;
        const r = px[offset];
        const g = px[offset + 1];
        const b = px[offset + 2];
        if (
          Math.abs(r - 0x14) <= 24 &&
          Math.abs(g - 0x53) <= 24 &&
          Math.abs(b - 0x2d) <= 24
        ) {
          if (y < bitmap.height / 2) hijau.atas += 1;
          else hijau.bawah += 1;
          if (x < hijau.minX) hijau.minX = x;
          if (x > hijau.maxX) hijau.maxX = x;
          if (y < hijau.minY) hijau.minY = y;
          if (y > hijau.maxY) hijau.maxY = y;
        } else if (r < 120 && g < 120 && b < 120) {
          gelap += 1;
          if (x > maxXGelap) maxXGelap = x;
        }
      }
    }

    return {
      jumlah: 1,
      nama: file.name,
      tipe: file.type,
      ukuran: file.size,
      lebar: bitmap.width,
      tinggi: bitmap.height,
      blokKertas,
      barisLatar,
      hijau,
      gelap,
      maxXGelap,
    };
  });

  /** Lebar kertas struknya dibaca dari aturan `@page` yang ditulis halaman kasir. */
  const aturanKertas = (await page.locator('[data-testid="struk-kertas-css"]').innerText()) ?? "";
  const lebarKertasMm = Number(/size:\s*([\d.]+)mm/.exec(aturanKertas)?.[1] ?? 0);
  check(
    `satu berkas gambar benar-benar diserahkan ke lembar bagikan — ${gambar.nama} (${gambar.tipe}), bukan pasangan PDF + logo`,
    gambar.jumlah === 1 &&
      gambar.nama === `struk-${nomorNota}.png` &&
      gambar.tipe === "image/png" &&
      gambar.ukuran > 5_000 &&
      gambar.ukuran < 2_000_000,
    `${gambar.jumlah} berkas · ${gambar.nama} · ${gambar.tipe} · ${gambar.ukuran} byte`,
  );
  const muatanBagikan = await page.evaluate(() => ({
    text: window.__bagikanGambar.at(-1)?.text ?? "",
    title: window.__bagikanGambar.at(-1)?.title ?? "",
  }));
  check(
    "isi struknya ikut sebagai teks pesannya & judulnya menyebut nomor notanya",
    muatanBagikan.text.includes("TOTAL") &&
      muatanBagikan.text.includes(`No. ${nomorNota}`) &&
      muatanBagikan.title.includes(nomorNota),
    `judul=${muatanBagikan.title} · teks=${muatanBagikan.text.slice(0, 40).replace(/\n/g, " / ")}`,
  );
  check(
    `lebarnya mengikuti lebar kertas struknya (${lebarKertasMm} mm → ${gambar.lebar} px, 14 px per mm)`,
    gambar.lebar ===
      Math.min(1400, Math.round(lebarKertasMm * 14)),
    `${gambar.lebar} px dari kertas ${lebarKertasMm} mm`,
  );
  check(
    "tinggi gambarnya yang dilaporkan dialognya sama dengan ukuran berkasnya sendiri",
    (await page.locator('[data-testid="struk-notice"]').innerText()).includes(
      `${gambar.lebar}×${gambar.tinggi} px`,
    ),
    await page.locator('[data-testid="struk-notice"]').innerText(),
  );
  check(
    "gambarnya memuat dua lembar kertas terpisah (rangkap 2) di atas latar abu-abu, bukan satu bidang putih",
    gambar.blokKertas === 2 && gambar.barisLatar >= 40,
    `${gambar.blokKertas} blok kertas · ${gambar.barisLatar} baris latar`,
  );
  check(
    "logo hijau tokonya tergambar **di dalam** gambarnya — di kedua lembarnya, di atas nama usaha",
    gambar.hijau.atas >= 100 &&
      gambar.hijau.bawah >= 100 &&
      gambar.hijau.minX > 0 &&
      gambar.hijau.maxX < gambar.lebar,
    `atas ${gambar.hijau.atas} px · bawah ${gambar.hijau.bawah} px · x ${gambar.hijau.minX}–${gambar.hijau.maxX} · y ${gambar.hijau.minY}–${gambar.hijau.maxY}`,
  );
  check(
    "logo itu digambar berwarna (bukan hitam putih seperti di kertas), muat di kertasnya, dan di tengah",
    gambar.hijau.minY < gambar.tinggi / 3 &&
      gambar.hijau.maxX - gambar.hijau.minX <= gambar.lebar - 2 * 14 - 2 * 16 &&
      Math.abs((gambar.hijau.minX + gambar.hijau.maxX) / 2 - gambar.lebar / 2) <= gambar.lebar / 10,
    `lebar logo ${gambar.hijau.maxX - gambar.hijau.minX} px · tengah ${((gambar.hijau.minX + gambar.hijau.maxX) / 2).toFixed(0)} vs ${gambar.lebar / 2}`,
  );
  check(
    "isi struknya tergambar sebagai teks gelap, dan tidak ada baris yang menembus tepi kanan kertasnya",
    gambar.gelap > 2_000 &&
      gambar.maxXGelap <= gambar.lebar - 14 - 16 + 2,
    `${gambar.gelap} piksel gelap · terjauh di x=${gambar.maxXGelap} (batas ${gambar.lebar - 14 - 16 + 2})`,
  );
  check(
    "laporannya menyebut gambar ini satu berkas yang tampil sebagai foto, beserta logo yang ada di dalamnya",
    (await page.locator('[data-testid="struk-notice"]').innerText()).includes(
      "menampilkannya sebagai foto",
    ) &&
      (await page.locator('[data-testid="struk-notice"]').innerText()).includes(
        "Logo tokonya ada di dalam gambarnya",
      ),
    await page.locator('[data-testid="struk-notice"]').innerText(),
  );

  /*
    **Satu jalur, satu berkas gambar.** Dulu di sebelah tombol ini ada “Bagikan PDF”
    yang menyerahkan PDF + gambar sekaligus; pasangan berkas campuran di Android
    diserahkan sebagai satu intent bertipe **umum** dan WhatsApp bisa mengambil
    berkas pertamanya saja — logo & isi struknya lalu tidak pernah terlihat. Karena
    itu tombol PDF-nya dihapus: yang diperiksa di sini (1) tidak ada lagi tombol itu,
    dan (2) menekan tombol bagikan sekali lagi menyerahkan **satu** gambar yang sama,
    bukan menambahkan PDF di belakangnya.
  */
  check(
    "tidak ada lagi tombol “Bagikan PDF” — jalur berbagi struknya satu: gambar struk",
    (await page.locator('[data-testid="struk-bagikan-pdf"]').count()) === 0 &&
      (await page.locator('[data-testid="struk-bagikan-gambar"]').count()) === 1,
    `${await page.locator('[data-testid="struk-bagikan-pdf"]').count()} tombol PDF · ${await page.locator('[data-testid="struk-bagikan-gambar"]').count()} tombol gambar`,
  );
  await page.locator('[data-testid="struk-bagikan-gambar"]').click();
  await page.waitForFunction(() => (window.__bagikanGambar?.length ?? 0) > 1, null, {
    timeout: 30_000,
  });
  const bagikanUlang = await page.evaluate(() => {
    const berkas = window.__bagikanGambar.at(-1)?.files ?? [];
    return berkas.map((file) => ({ nama: file.name, tipe: file.type, ukuran: file.size }));
  });
  check(
    "menekan tombolnya lagi menyerahkan satu berkas gambar yang sama — tanpa PDF di belakangnya",
    bagikanUlang.length === 1 &&
      bagikanUlang[0].tipe === "image/png" &&
      bagikanUlang[0].nama === `struk-${nomorNota}.png` &&
      bagikanUlang[0].ukuran === gambar.ukuran,
    bagikanUlang.map((row) => `${row.nama} (${row.tipe}, ${row.ukuran} B)`).join(" + "),
  );
  const laporanBagikan = (
    await page.locator('[data-testid="struk-notice"]').innerText()
  )
    .replace(/\s+/g, " ")
    .trim();
  check(
    "laporannya menyebut gambar tunggal yang diserahkan beserta ukurannya, dan bahwa logonya ada di dalamnya",
    laporanBagikan.includes(`Gambar struk-${nomorNota}.png`) &&
      laporanBagikan.includes("px") &&
      laporanBagikan.includes("diserahkan ke lembar bagikan") &&
      laporanBagikan.includes("Satu berkas gambar") &&
      laporanBagikan.includes("Logo tokonya ada di dalam gambarnya") &&
      !laporanBagikan.includes("PDF"),
    laporanBagikan,
  );

  // Angka apa adanya dari berkas yang benar-benar diserahkan tadi: berguna saat
  // harness ini dijalankan lagi setelah halamannya berubah.
  console.log(
    `  gambar struk: ${gambar.nama} · ${gambar.lebar}×${gambar.tinggi} px · ${gambar.ukuran} byte · ${gambar.blokKertas} lembar · logo ${gambar.hijau.atas + gambar.hijau.bawah} px hijau (${gambar.hijau.maxX - gambar.hijau.minX} px lebar) · ${gambar.gelap} px teks`,
  );

  /*
    Daftar PDF sesi ini: berkas yang barusan diunduh harus bisa **dibuka lagi**
    dari dialog. Di Chromium tautan `blob:`-nya benar-benar bisa dibaca, jadi yang
    diperiksa bukan cuma keberadaan tautannya: isi di baliknya harus PDF yang sama
    persis dengan yang tadi terunduh.
  */
  const tombolDaftarPdf = page.locator('[data-testid="struk-daftar-pdf-tombol"]');
  check(
    "dialog struk menyediakan tombol daftar PDF, dan daftarnya masih tertutup",
    (await tombolDaftarPdf.getAttribute("aria-expanded")) === "false" &&
      (await page.locator('[data-testid="struk-daftar-pdf-lembar"]').count()) === 0 &&
      (await tombolDaftarPdf.innerText()).includes("Daftar PDF struk (1)"),
    await tombolDaftarPdf.innerText(),
  );
  await tombolDaftarPdf.click();
  await page.waitForSelector('[data-testid="struk-daftar-pdf-lembar"]', {
    timeout: 10_000,
  });
  const tautanPdf = page.locator('[data-testid="struk-daftar-pdf-item"]');
  const hrefPdf = await tautanPdf.first().getAttribute("href");
  check(
    "daftarnya memuat berkas PDF yang sudah dibuat, dengan tautan blob: yang bisa dibuka",
    (await tautanPdf.count()) === 1 &&
      (await tautanPdf.first().innerText()).includes(namaBerkas) &&
      (hrefPdf ?? "").startsWith("blob:"),
    `${await tautanPdf.count()} berkas · ${hrefPdf}`,
  );
  const dariDaftar = await page.evaluate(async (href) => {
    const resp = await fetch(href);
    const buf = new Uint8Array(await resp.arrayBuffer());
    return {
      panjang: buf.length,
      kepala: String.fromCharCode(...buf.slice(0, 8)),
      ekor: String.fromCharCode(...buf.slice(buf.length - 6)),
    };
  }, hrefPdf);
  check(
    "berkas di balik tautan daftar itu PDF struk yang sama dengan yang barusan terunduh",
    dariDaftar.kepala === "%PDF-1.4" &&
      dariDaftar.ekor.trim() === "%%EOF" &&
      dariDaftar.panjang === berkasPdf.length,
    JSON.stringify(dariDaftar),
  );
  await tombolDaftarPdf.click();
  check(
    "menekan tombol daftar sekali lagi menutupnya kembali",
    (await tombolDaftarPdf.getAttribute("aria-expanded")) === "false" &&
      (await page.locator('[data-testid="struk-daftar-pdf-lembar"]').count()) === 0,
    `aria-expanded=${await tombolDaftarPdf.getAttribute("aria-expanded")}`,
  );

  /*
    Member yang dipilih di keranjang (Rina Kartika) memang belum mengisi nomor WA,
    jadi justru dialah yang membuktikan jalur penolakannya: struk tanpa nomor
    tujuan ditahan **beserta sebabnya**, bukan dikirim ke nomor tebakan.
  */
  check(
    "member tanpa nomor WA diperingatkan di dialog struknya",
    (await page.locator('[data-testid="struk-tanpa-nomor"]').innerText()).includes(
      "belum mengisi nomor WhatsApp",
    ),
    await page.locator('[data-testid="struk-tanpa-nomor"]').innerText(),
  );
  await page.locator('[data-testid="struk-kirim-wa"]').click();
  await page.waitForSelector('[data-testid="struk-error"]', { timeout: 20_000 });
  check(
    "mengirim struk member tanpa nomor ditolak dengan sebab yang bisa dibetulkan",
    (await page.locator('[data-testid="struk-error"]').innerText()).includes(
      "belum mengisi nomor WhatsApp",
    ),
    await page.locator('[data-testid="struk-error"]').innerText(),
  );

  /*
    Member cash yang belum mengisi profilnya: dialog struk menawarkan **kolom
    nomor** supaya kasir bisa mengirim sekarang, tanpa membuka halaman Member.
    Nomor yang belum sah ditolak dengan sebabnya, nomor yang benar dipakai.
  */
  check(
    "member tanpa nomor WA diberi kolom untuk menampung nomornya di dialog struk",
    (await page.locator('[data-testid="struk-nomor-wa"]').isVisible()) &&
      (await page.locator('[data-testid="struk-nomor-wa-kotak"]').innerText()).includes(
        "Rina Kartika",
      ),
    (await page.locator('[data-testid="struk-nomor-wa-kotak"]').innerText()).slice(0, 140),
  );
  await page.locator('[data-testid="struk-nomor-wa"]').fill("0812");
  await page.locator('[data-testid="struk-kirim-wa"]').click();
  await page.waitForTimeout(200);
  check(
    "nomor yang belum lengkap ditolak dengan alasannya, bukan memakai nomor tebakan",
    (await page.locator('[data-testid="struk-nomor-wa-galat"]').innerText()).includes(
      "8–15 digit",
    ) &&
      (await page.locator('[data-testid="struk-notice"]').count()) === 0,
    await page.locator('[data-testid="struk-nomor-wa-galat"]').innerText(),
  );
  await page.locator('[data-testid="struk-nomor-wa"]').fill("0812-3456-7890");
  await page.locator('[data-testid="struk-kirim-wa"]').click();
  await page.waitForSelector('[data-testid="struk-notice"]', { timeout: 20_000 });
  const kirimNomorKasir = await page.locator('[data-testid="struk-notice"]').innerText();
  check(
    "mengisi nomornya membuat struk member cash terkirim ke nomor itu (disimulasikan di mode demo)",
    /WhatsApp/.test(kirimNomorKasir) &&
      (kirimNomorKasir.includes("Mode demo") || kirimNomorKasir.includes("belum tersambung")) &&
      /6281/.test(kirimNomorKasir),
    kirimNomorKasir,
  );

  /*
    Tombol cetak di dialog sekarang bernama **Cetak lewat dialog peramban**: jalur
    utama dialog itu adalah cetak langsung ESC/POS (diuji
    `scripts/verify-escpos-browser.mjs`), dan yang diperiksa di sini jalur
    cadangannya — peramban yang belum punya WebUSB/Web Bluetooth, atau kasir yang
    memang memilih dialog cetak sistem.
  */
  await page.locator('[data-testid="struk-cetak-dialog"]').click();
  await page.waitForTimeout(250);
  check(
    "menekan Cetak lewat dialog peramban memanggil dialog cetak peramban sekali, dengan nota yang sama",
    (await page.evaluate(() => window.__cetakanStruk)) === 1 &&
      (await page.locator('[data-testid="struk-cetak-lembar-1"]').innerText()).includes(
        nomorNota,
      ),
    `cetakan=${await page.evaluate(() => window.__cetakanStruk)}`,
  );
  await page.locator('[aria-label="Tutup struk"]').click();
  await page.waitForTimeout(200);

  const setelahTutup = await page.evaluate(() => ({
    dialog: document.querySelectorAll('[data-testid="struk-dialog"]').length,
    cetakTerkunci:
      document.querySelector('button[aria-label="Cetak struk"]')?.disabled ?? null,
    bayarTerkunci:
      [...document.querySelectorAll("button")].find(
        (button) => (button.textContent ?? "").trim() === "Bayar",
      )?.disabled ?? null,
  }));
  check(
    "menutup dialog struk tidak menghapus notanya, dan keranjangnya memang sudah kosong",
    setelahTutup.dialog === 0 &&
      setelahTutup.bayarTerkunci === true &&
      setelahTutup.cetakTerkunci === false,
    JSON.stringify(setelahTutup),
  );
  check(
    "sesudah lunas, panel menyebut nota mana yang sudah dibayar & bisa dicetak lagi",
    (await page.locator('[data-testid="struk-lunas-catatan"]').innerText()).includes(nomorNota),
    await page.locator('[data-testid="struk-lunas-catatan"]').innerText(),
  );

  // Cetak ulang dari tombol panel tetap satu klik, tanpa lewat dialog.
  await page.locator('button[aria-label="Cetak struk"]').click();
  await page.waitForTimeout(250);
  check(
    "tombol Cetak struk di panel mengeluarkan nota yang sama sekali lagi",
    (await page.evaluate(() => window.__cetakanStruk)) === 2,
    `cetakan=${await page.evaluate(() => window.__cetakanStruk)}`,
  );

  // ------------- Pesanannya benar-benar tiba di antrean dapur (perintah ke dapur)
  /*
    Notis di dialog struk barulah janji di layar kasir; yang membuktikannya adalah
    halaman **Dapur & Meja**: nota yang sama harus ada di antreannya, ditandai
    sudah lunas beserta cara bayarnya, dan isinya sudah terbaca dapur.

    Perpindahannya lewat menu sidebar, bukan `page.goto`, karena sesi demo
    menyimpan penjualannya di memori halaman: muat ulang akan menghapus tiket
    yang justru sedang diperiksa di sini.
  */
  await page.getByRole("link", { name: /Dapur & Meja/ }).first().click();
  await page.waitForURL(/\/app\/kds/, { timeout: 20_000 });
  await page.waitForTimeout(400);

  const kartuDapur = page.locator("article", { hasText: nomorNota });
  check(
    "nota yang baru dibayar di kasir sudah menunggu di antrean dapur",
    (await kartuDapur.count()) === 1 && /Cappuccino/.test(await kartuDapur.innerText()),
    `${await kartuDapur.count()} kartu memuat ${nomorNota}`,
  );
  const barisLunasDapur = kartuDapur.locator('[data-testid^="kds-lunas-kasir-"]');
  check(
    "tiket dapurnya menandai sendiri penjualannya lunas beserta cara bayarnya",
    (await barisLunasDapur.count()) === 1 &&
      /^Lunas Tunai/.test((await barisLunasDapur.innerText()).trim()),
    (await barisLunasDapur.count()) === 1
      ? await barisLunasDapur.innerText()
      : "baris lunas tidak ada",
  );
  await page.screenshot({ path: `${SHOTS}/dapur-tiket-lunas.png` });

  // Kembali ke kasir lewat menu yang sama supaya tahap berikutnya berjalan di
  // halaman yang sama seperti sebelumnya (sesi demo tetap hidup).
  await page.getByRole("link", { name: /Kasir \(POS\)/ }).first().click();
  await page.waitForURL(/\/app\/pos/, { timeout: 20_000 });
  await page.waitForTimeout(300);

  // ------------- Kirim struk ke WhatsApp member yang sudah punya nomor
  /*
    Tahap berikutnya memakai member **Bu Sari Wulandari** (punya nomor WA): yang
    diperiksa adalah nomor tujuannya datang dari data member (dan ditampilkan
    tersensor), lalu hasil kirimannya dilaporkan apa adanya. Mode demo menyimulasikan
    pengirimannya; deployment Convex tanpa kunci WhatsApp menjawab “belum tersambung”
    — dua-duanya harus terbaca di layar, bukan diklaim berhasil.
  */
  const bayarCepat = async () => {
    await page.getByRole("button", { name: "Bayar", exact: true }).click();
    await page.waitForSelector('[data-testid="cash-cepat-100000"]', { timeout: 20_000 });
    await page.locator('[data-testid="cash-cepat-100000"]').click();
    await page.getByRole("button", { name: "Selesaikan pembayaran" }).click();
    await page.waitForSelector('[data-testid="struk-dialog"]', { timeout: 20_000 });
    await page.waitForTimeout(200);
  };

  // Keranjangnya sudah kosong sesudah penjualan, jadi pilihan membernya juga
  // sudah dilepas — kolom pencariannya kembali tampil tanpa perlu dihapus dulu.
  await page.locator('[aria-label="Cari member"]').fill("Sari");
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: /Bu Sari Wulandari/ }).first().click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: /Cappuccino/ }).first().click();
  await page.waitForTimeout(200);
  await bayarCepat();

  const barisPenerima = await page
    .locator('[data-testid="struk-dialog-member"]')
    .innerText();
  check(
    "dialog struk menyebut penerimanya dan nomornya tersensor (bukan nomor penuh di layar kasir)",
    barisPenerima.includes("Bu Sari Wulandari") &&
      barisPenerima.includes("•") &&
      !barisPenerima.includes("281234567890"),
    barisPenerima,
  );

  await page.locator('[data-testid="struk-kirim-wa"]').click();
  await page.waitForSelector('[data-testid="struk-notice"]', { timeout: 20_000 });
  const laporanKirim = await page.locator('[data-testid="struk-notice"]').innerText();
  check(
    "hasil kirim struk ke WhatsApp dilaporkan apa adanya — disimulasikan di mode demo, atau disebut belum tersambung kalau kuncinya belum ada",
    /WhatsApp/.test(laporanKirim) &&
      (laporanKirim.includes("Mode demo") || laporanKirim.includes("belum tersambung")),
    laporanKirim,
  );
  /*
    **Gambar struknya ikut**: logo toko harus terlihat di percakapan, bukan cuma di
    dalam berkas PDF. Di mode demo kirimannya disimulasikan dan laporannya harus
    menyebut gambar berlogo itu sebagai bagian yang dikirim; di deployment Convex
    tanpa kunci WhatsApp, yang jujur adalah menyebut kuncinya belum ada — bukan
    mengklaim gambarnya terkirim.
  */
  check(
    laporanKirim.includes("Mode demo")
      ? "kiriman struk di mode demo hanya menyertakan gambar struknya (berlogo PNG) — bukan PDF"
      : "tanpa kunci Cloud API, kirimannya menyebut kuncinya belum ada — tidak mengklaim gambar terkirim",
    laporanKirim.includes("Mode demo")
      ? laporanKirim.includes("gambar struk") &&
        laporanKirim.includes("berlogo") &&
        laporanKirim.includes(".png") &&
        !laporanKirim.includes(".pdf")
      : laporanKirim.includes("belum tersambung") &&
        laporanKirim.includes("WHATSAPP_ACCESS_TOKEN"),
    laporanKirim,
  );
  await page.locator('[aria-label="Tutup struk"]').click();
  await page.waitForTimeout(200);

  // ------------- Kirim struk pembeli umum (penjualan tanpa member sama sekali)
  /*
    Penjualan yang tidak punya member sama sekali dulu jalan buntu: tidak ada data
    member yang bisa dibaca, jadi tidak ada nomor tujuan yang bisa dipakai. Sekarang
    dialog struknya menawarkan **kolom nomor pembeli** — nomor yang belum sah
    ditolak, nomor yang benar dipakai untuk mengirim, dan hasilnya tetap dilaporkan
    apa adanya. Keranjangnya sudah kosong sesudah penjualan sebelumnya, jadi kali
    ini barangnya ditambahkan **tanpa** memilih member: itulah pembeli umum.
  */
  await page.getByRole("button", { name: /Cappuccino/ }).first().click();
  await page.waitForTimeout(200);
  await bayarCepat();

  check(
    "penjualan tanpa member memberi kolom nomor WhatsApp untuk pembelinya sendiri",
    (await page.locator('[data-testid="struk-nomor-wa"]').isVisible()) &&
      (await page
        .locator('[data-testid="struk-nomor-wa-kotak"]')
        .innerText()).includes("Nomor WhatsApp pembeli") &&
      (await page.locator('[data-testid="struk-dialog-member"]').count()) === 0,
    (await page.locator('[data-testid="struk-nomor-wa-kotak"]').innerText()).slice(0, 140),
  );
  await page.locator('[data-testid="struk-kirim-wa"]').click();
  await page.waitForSelector('[data-testid="struk-error"]', { timeout: 20_000 });
  check(
    "mengirim struk pembeli umum tanpa nomor ditolak dengan petunjuk mengisi kolomnya",
    (await page.locator('[data-testid="struk-error"]').innerText()).includes(
      "Nomor WhatsApp pembeli",
    ),
    await page.locator('[data-testid="struk-error"]').innerText(),
  );
  await page.locator('[data-testid="struk-nomor-wa"]').fill("0821");
  await page.locator('[data-testid="struk-kirim-wa"]').click();
  await page.waitForTimeout(200);
  check(
    "nomor pembeli umum yang belum lengkap ditolak dengan alasannya, bukan dipakai apa adanya",
    (await page.locator('[data-testid="struk-nomor-wa-galat"]').innerText()).includes(
      "8–15 digit",
    ),
    await page.locator('[data-testid="struk-nomor-wa-galat"]').innerText(),
  );
  await page.locator('[data-testid="struk-nomor-wa"]').fill("0821-1111-2222");
  await page.locator('[data-testid="struk-kirim-wa"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="struk-notice"]') !== null ||
      document.querySelector('[data-testid="struk-error"]') !== null,
    { timeout: 20_000 },
  );
  const laporanUmum =
    (await page.locator('[data-testid="struk-notice"]').count()) > 0
      ? await page.locator('[data-testid="struk-notice"]').innerText()
      : await page.locator('[data-testid="struk-error"]').innerText();
  check(
    "struk pembeli umum terkirim ke nomor yang diberikan pembelinya (disimulasikan di mode demo, atau disebut belum tersambung tanpa kunci kanal)",
    /WhatsApp/.test(laporanUmum) &&
      (laporanUmum.includes("Mode demo")
        ? /6282/.test(laporanUmum) && laporanUmum.includes("pembeli umum")
        : laporanUmum.includes("belum tersambung")),
    laporanUmum,
  );
  await page.locator('[aria-label="Tutup struk"]').click();
  await page.waitForTimeout(200);

  /*
    ---------------- Cetak struk di halaman kasir yang **tergulir** (ponsel)

    Laporan pengguna: di ponsel, hasil cetak struknya hanya memperlihatkan
    ekornya (TOTAL / Bayar / Kembali / catatan kaki) — logo, nama toko, alamat,
    dan baris kasir serta pembelinya hilang. Sebabnya bukan aturan struknya,
    melainkan **letak area cetaknya**: `.struk-cetak` hidup di dalam `<main>`
    yang setinggi layar & bisa digulir, jadi elemen berposisi `absolute` ikut
    tergeser oleh gulir itu dan terpotong saat dicetak. Halaman desktop pada
    ukuran 1400×950 tidak pernah bisa menggulir, jadi seluruh pemeriksaan di
    atas tidak pernah menyentuh keadaan ini.

    Bagian ini mengulang keadaannya di layar ponsel — halaman kasir digulir
    sampai bawah — lalu yang diperiksa adalah **hasil cetaknya**, bukan
    tampilannya: kotak area cetak harus mulai dari sudut kiri-atas kertas (bukan
    dari posisi gulir), seluruh lembar & logonya harus muat di kertas itu, dan
    berkas PDF yang keluar saat halaman tergulir harus **sama persis** dengan
    yang keluar saat halaman tidak tergulir. Sebelum diperbaiki, keadaan ini
    menghasilkan halaman kosong (area cetaknya tergeser 1.092 px ke atas kertas).
  */
  const sesiTersimpan = await page.evaluate(() =>
    window.localStorage.getItem("mesinpos.session.v1"),
  );
  const shiftTersimpan = await page.evaluate(() =>
    window.localStorage.getItem("mesinpos.shifts.v1"),
  );
  const konteksPonsel = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await konteksPonsel.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Penyimpanan diblokir: bukan bagian yang diuji di sini.
      }
    },
    ["mesinpos.session.v1", sesiTersimpan ?? ""],
  );
  /*
    Shiftnya ikut disalin: halaman kasir di ponsel hanya bisa menjual kalau ada
    shift yang terbuka (`posShiftGate`), dan perangkat yang sama memang memakai
    shift yang sama — jadi berkas struknya pun dari shift yang sama, bukan dari
    kas yang kebetulan masih kosong.
  */
  await konteksPonsel.addInitScript(
    ([key, value]) => {
      try {
        if (value) window.localStorage.setItem(key, value);
      } catch {
        // Penyimpanan diblokir: bukan bagian yang diuji di sini.
      }
    },
    ["mesinpos.shifts.v1", shiftTersimpan ?? ""],
  );
  const hp = await konteksPonsel.newPage();
  hp.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`ponsel: ${message.text()}`);
  });
  hp.on("pageerror", (error) => consoleErrors.push(`ponsel pageerror: ${error.message}`));

  await hp.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await hp.getByRole("button", { name: /Cappuccino/ }).first().click();
  await hp.waitForTimeout(200);
  await hp.getByRole("button", { name: "Bayar", exact: true }).click();
  await hp.waitForSelector('[data-testid="cash-cepat-10000"]', { timeout: 20_000 });
  await hp.locator('[data-testid="cash-cepat-100000"]').click();
  await hp.getByRole("button", { name: "Selesaikan pembayaran" }).click();
  await hp.waitForSelector('[data-testid="struk-unduh-pdf"]', { timeout: 20_000 });

  /*
    ------------------------------------------------- Dialog yang lebih tinggi

    Laporan pemilik repo (tangkapan layar ponsel): dialog “Struk belanja”
    tingginya melebihi layar dan **isinya tidak bisa digulir** — daftar PDF,
    notis, dan tombol Tutup di bagian bawahnya tidak pernah terbaca kasir.
    Sebelum diperbaiki, pada layar ponsel yang pendek isinya 963 px (239 px keluar
    layar) dan kontrol terakhirnya **tidak terjangkau** walau semua yang bisa
    digulir sudah digulir. Layar 1400×950 di bagian atas tidak pernah menyentuh
    keadaan ini, justru karena dialognya muat di sana.

    Ukuran ponsel pendek dipakai sengaja (bilah alamat peramban + papan tombol
    memangkas tinggi layar yang terlihat), lalu dikembalikan sebelum bagian cetak.
  */
  await hp.setViewportSize({ width: 360, height: 720 });
  await hp.waitForTimeout(200);
  const dialogHp = await hp.evaluate(() => {
    const dialog = document.querySelector('[data-testid="struk-dialog"]');
    if (!dialog) return null;
    const kotak = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        atas: Math.round(r.top),
        bawah: Math.round(r.bottom),
        tinggi: Math.round(r.height),
      };
    };
    const paling = [...dialog.querySelectorAll("button")].at(-1);
    const sebelum = kotak(paling);
    dialog.scrollTop = dialog.scrollHeight;
    return {
      layar: window.innerHeight,
      dialog: kotak(dialog),
      bisaDigulir:
        /auto|scroll/.test(window.getComputedStyle(dialog).overflowY) &&
        dialog.scrollHeight > dialog.clientHeight,
      sisaGulir: dialog.scrollHeight - dialog.clientHeight,
      tergulir: dialog.scrollTop,
      sebelum,
      sesudah: kotak(paling),
      judul: kotak(dialog.querySelector("h3")),
      tombolTutup: kotak(dialog.querySelector('[aria-label="Tutup struk"]')),
    };
  });
  check(
    "dialog struk di layar ponsel pendek dibatasi setinggi layar — tidak ada isi yang keluar layar",
    Boolean(dialogHp) &&
      dialogHp.dialog.atas >= 0 &&
      dialogHp.dialog.bawah <= dialogHp.layar + 1,
    JSON.stringify({ dialog: dialogHp?.dialog, layar: dialogHp?.layar }),
  );
  check(
    "isi dialog struk yang lebih tinggi dari layar benar-benar bisa digulir",
    Boolean(dialogHp) && dialogHp.bisaDigulir && dialogHp.tergulir > 0,
    JSON.stringify({
      bisaDigulir: dialogHp?.bisaDigulir,
      sisaGulir: dialogHp?.sisaGulir,
      tergulir: dialogHp?.tergulir,
    }),
  );
  check(
    "kontrol terakhir dialog (“Tutup”) terjangkau setelah isinya digulir sampai bawah",
    Boolean(dialogHp?.sesudah) &&
      dialogHp.sesudah.atas >= 0 &&
      dialogHp.sesudah.bawah <= dialogHp.layar + 1,
    JSON.stringify({ sebelum: dialogHp?.sebelum, sesudah: dialogHp?.sesudah, layar: dialogHp?.layar }),
  );
  check(
    "judul & tombol tutup struk tetap terlihat setelah digulir sampai bawah (menempel di atas)",
    Boolean(dialogHp?.judul && dialogHp?.tombolTutup) &&
      dialogHp.judul.atas >= 0 &&
      dialogHp.judul.bawah <= dialogHp.layar &&
      dialogHp.tombolTutup.atas >= 0 &&
      dialogHp.tombolTutup.bawah <= dialogHp.layar,
    JSON.stringify({ judul: dialogHp?.judul, tombolTutup: dialogHp?.tombolTutup, layar: dialogHp?.layar }),
  );

  await hp.setViewportSize({ width: 390, height: 844 });
  await hp.waitForTimeout(150);
  await hp.locator('[aria-label="Tutup struk"]').click();
  await hp.waitForTimeout(300);

  await hp.emulateMedia({ media: "print" });
  await hp.waitForTimeout(200);

  /**
   * Kotak area cetak, tiap lembarnya, logonya, dan leluhur yang bisa membuat
   * containing block sendiri — diukur dari peramban, bukan dari kode sumber.
   */
  const ukurCetak = async (halaman) =>
    await halaman.evaluate(() => {
      const area = document.querySelector('[data-testid="struk-cetak"]');
      if (!area) return null;
      const kotak = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          left: Math.round(r.left),
          right: Math.round(r.right),
        };
      };
      const khusus = [];
      for (let el = area.parentElement; el; el = el.parentElement) {
        const style = window.getComputedStyle(el);
        for (const [properti, nilai] of [
          ["transform", style.transform],
          ["filter", style.filter],
          ["backdrop-filter", style.backdropFilter],
          ["perspective", style.perspective],
          ["contain", style.contain],
        ]) {
          if (nilai && nilai !== "none") khusus.push(properti);
        }
      }
      return {
        kertas:
          document.querySelector('[data-testid="struk-kertas-css"]')?.textContent ?? "",
        posisi: window.getComputedStyle(area).position,
        tampil: window.getComputedStyle(area).display,
        area: kotak(area),
        logo: kotak(document.querySelector('[data-testid="struk-cetak-logo-1"]')),
        lembar: [...document.querySelectorAll('[data-testid^="struk-cetak-lembar-"]')].map(
          kotak,
        ),
        leluhurBerkontainmen: khusus,
      };
    });

  /** “@page { size: 241mm 106.7mm; ... }” → tinggi halaman dalam piksel CSS. */
  const tinggiKertasPx = (aturan) => {
    const ukuran = /size:\s*([\d.]+)mm\s+([\d.]+)mm/.exec(aturan ?? "");
    return ukuran ? Number(ukuran[2]) * MM_IN_PX : null;
  };
  /** Jumlah halaman dari berkas PDF-nya (“/Type /Pages” adalah pohonnya). */
  const jumlahHalaman = (bytes) =>
    (bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

  /*
    Pembanding: keadaan sebelum halaman digulir. Yang diuji bukan “struknya
    terlihat”, melainkan **hasil cetaknya** — peramban di mode cetak menempatkan
    area cetaknya sendiri, jadi angka-angka ini datang dari mesin tata letaknya.
  */
  const dasar = await ukurCetak(hp);
  const pdfDasar = await hp.pdf({ preferCSSPageSize: true, printBackground: true });
  check(
    "area cetak struk sudah menempel di sudut kiri-atas kertas, bukan di bawah header aplikasi",
    dasar?.posisi === "fixed" && dasar?.area?.top === 0 && dasar?.area?.left === 0,
    JSON.stringify({ posisi: dasar?.posisi, area: dasar?.area, kertas: dasar?.kertas }),
  );

  // Halaman kasir di ponsel memang lebih tinggi dari layarnya: tanpa itu, bug
  // yang diperiksa di bawah tidak akan pernah muncul. Jadi keadaan itu dulu yang
  // dibuktikan, bukan diandaikan.
  await hp.emulateMedia({ media: "screen" });
  const gulir = await hp.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return null;
    main.scrollTop = main.scrollHeight;
    return {
      scrollTop: main.scrollTop,
      scrollHeight: main.scrollHeight,
      clientHeight: main.clientHeight,
    };
  });
  check(
    "di ponsel, halaman kasirnya benar-benar lebih tinggi dari layar & tergulir sampai bawah",
    Boolean(gulir) && gulir.scrollTop > 0 && gulir.scrollHeight > gulir.clientHeight,
    JSON.stringify(gulir),
  );

  await hp.emulateMedia({ media: "print" });
  await hp.waitForTimeout(200);

  const ukurPonsel = await ukurCetak(hp);
  check(
    "halaman kasir yang tergulir sampai bawah tidak lagi menggeser area cetaknya (dulu −1.092 px → halaman kosong)",
    ukurPonsel?.posisi === "fixed" &&
      ukurPonsel?.area?.top === 0 &&
      ukurPonsel?.area?.left === 0,
    JSON.stringify({
      posisi: ukurPonsel?.posisi,
      area: ukurPonsel?.area,
      main: gulir,
    }),
  );
  check(
    "tidak ada leluhur area cetak yang mengikat `position: fixed` (transform/filter/background-filter/contain)",
    (ukurPonsel?.leluhurBerkontainmen ?? []).length === 0,
    JSON.stringify(ukurPonsel?.leluhurBerkontainmen),
  );

  const tinggiHalaman = tinggiKertasPx(ukurPonsel?.kertas);
  check(
    "seluruh lembar struk & logonya muat di dalam kertas — tidak ada baris yang jatuh ke kertas berikutnya",
    ukurPonsel?.area != null &&
      tinggiHalaman != null &&
      ukurPonsel.lembar.length > 0 &&
      ukurPonsel.lembar.every(
        (kotak) => kotak.top >= 0 && kotak.bottom <= tinggiHalaman + 1,
      ) &&
      ukurPonsel.logo != null &&
      ukurPonsel.logo.top >= 0 &&
      ukurPonsel.logo.bottom <= tinggiHalaman + 1,
    JSON.stringify({
      tinggiHalamanPx: tinggiHalaman === null ? null : Math.round(tinggiHalaman),
      area: ukurPonsel?.area,
      logo: ukurPonsel?.logo,
      lembar: ukurPonsel?.lembar,
      kertas: ukurPonsel?.kertas,
    }),
  );

  /*
    Isi yang dicetak: daftar keluhan pengguna ada di sini — logo, nama toko,
    alamat, kasir, dan pembeli. Ketiga baris terakhir itu ada di teks lembar
    cetaknya, dan karena letaknya sudah terbukti di dalam kertas (cek di atas),
    yang diperiksa di sini adalah isinya.
  */
  const isiCetakPonsel = await hp.evaluate(() => ({
    logo: document.querySelector('[data-testid="struk-cetak-logo-1"]') !== null,
    baris: (
      document.querySelector('[data-testid="struk-cetak-lembar-1"]')?.textContent ?? ""
    ).split("\n"),
  }));
  check(
    "struk yang tercetak memuat logo, nama usaha, kasir, dan pembelinya — bukan cuma ekor TOTAL/Bayar/Kembali",
    isiCetakPonsel.logo &&
      isiCetakPonsel.baris.some((baris) => baris.trim() === "Warung Uji Struk") &&
      isiCetakPonsel.baris.some((baris) => baris.trim() === "Kasir : Uji Struk") &&
      isiCetakPonsel.baris.some((baris) => baris.trim() === "Member : Cash") &&
      isiCetakPonsel.baris.some((baris) => baris.includes("Cappuccino")),
    isiCetakPonsel.baris
      .filter((baris) => baris.trim() !== "")
      .slice(0, 6)
      .join(" / "),
  );

  /*
    Bukti terakhir, dan yang paling dekat dengan kertasnya: berkas PDF yang
    benar-benar keluar dari mesin cetak. Saat halaman tergulir, PDF-nya harus
    sama persis dengan yang keluar saat halaman belum tergulir — byte & jumlah
    halamannya. Sebelum diperbaiki, keadaan tergulir menghasilkan 1.109 byte
    (halaman kosong), sedangkan yang tidak tergulir 27.410 byte.
  */
  /*
    Perbandingannya memakai kelonggaran 64 byte: berkas PDF dari mesin cetak
    peramban membawa beberapa angka pembukuan (id/panjang aliran) yang bisa
    berbeda satu-dua byte antar pembuatan, dan itu bukan isi struknya. Bug yang
    diperiksa di sini bedanya ~24.000 byte (halaman kosong: 1.109 vs 26.705),
    jadi kelonggaran sekecil itu tidak menyamarkan apa pun.
  */
  const pdfPonsel = await hp.pdf({ preferCSSPageSize: true, printBackground: true });
  const bedaPdf = Math.abs(pdfPonsel.length - pdfDasar.length);
  check(
    "mencetak di ponsel yang tergulir menghasilkan berkas PDF yang sama dengan yang tidak tergulir",
    pdfPonsel.length > 1500 &&
      bedaPdf <= 64 &&
      jumlahHalaman(pdfPonsel) === jumlahHalaman(pdfDasar),
    `${pdfPonsel.length} byte/${jumlahHalaman(pdfPonsel)} hlm · dasar ${pdfDasar.length} byte/${jumlahHalaman(pdfDasar)} hlm · beda ${bedaPdf} byte · ${(ukurPonsel?.kertas ?? "").replace(/\s+/g, " ").trim()}`,
  );

  // Kertas A4: yang dipilih jasa cetak ponsel kalau `@page` tidak dihormati.
  // Yang diperiksa di sini: struknya tetap keluar di halaman pertama, dan tidak
  // mencetak halaman kosong tambahan di belakangnya.
  const pdfA4Ponsel = await hp.pdf({ printBackground: true });
  check(
    "di kertas A4 bawaan (yang dipakai jasa cetak ponsel), struknya tetap satu halaman — tanpa halaman kosong tambahan",
    pdfA4Ponsel.length > 1500 && jumlahHalaman(pdfA4Ponsel) === 1,
    `${pdfA4Ponsel.length} byte · ${jumlahHalaman(pdfA4Ponsel)} halaman`,
  );

  await hp.screenshot({ path: `${SHOTS}/struk-ponsel-cetak.png`, fullPage: true });
  await hp.emulateMedia({ media: "screen" });
  await konteksPonsel.close();

  check(
    "tanpa galat konsol di ketiga halaman (Pengaturan, Panduan, Kasir)",
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

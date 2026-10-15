/**
 * Alur pesanan QR meja di **browser sungguhan** (Chromium/Playwright) atas
 * preview yang sedang berjalan.
 *
 * Kenapa ada: `bun scripts/verify-meja.mjs` membuktikan aturan murninya (token,
 * validasi keranjang, total tamu = total kasir), tetapi tidak ada yang membuktikan
 * rantai utuhnya benar-benar tersambung di layar: kartu QR yang dicetak berisi
 * tautan meja yang benar, tamu bisa memesan sampai membayar, dan pesanan yang
 * lunas **muncul di antrean dapur** sebagai tiket yang bisa diselesaikan.
 *
 * Yang diperiksa (mode demo, karena di situlah preview berjalan):
 *
 *   1. denah meja menerbitkan kartu QR yang tautannya bisa dipindai
 *      (`data-qr-value` pada SVG) dan hanya kartu itu yang terlihat saat dicetak;
 *   2. halaman tamu menampilkan menu toko itu, dan angka dari menu → keranjang →
 *      tagihan tidak berubah (sesi uji tanpa pajak/biaya layanan, jadi angkanya
 *      harus sama persis);
 *   3. **tombol “Screenshot QRIS” benar-benar menyerahkan berkas PNG** — berkas
 *      unduhannya diperiksa dari byte-nya (PNG asli + ukuran yang sama dengan tata
 *      letak aturan murninya);
 *   4. tamu yang memilih **Virtual Account** menerima nomor bank pilihannya,
 *      kartunya menawarkan salin nomor (bukan kode QRIS), dan tiket dapurnya
 *      bertanda `Lunas VA <bank> dari meja · diterima dapur pukul HH:MM`;
 *   5. **dapur hanya melihat pesanan yang sudah lunas**: pesanan QR yang belum
 *      dibayar tidak pernah tampil sebagai antrean — layar dapur hanya menyebut
 *      jumlahnya dan menautkan kasir ke halaman Pembayaran, tempat tagihannya
 *      dilunasi (“Lunasi & kirim ke dapur”) atau dibatalkan, dan tiket dapurnya
 *      langsung lahir dari pelunasan itu;
 *   6. **tiket dapur ditandai momen & kanal pelunasannya** (`Lunas QRIS dari meja
 *      · diterima dapur pukul 13:42`), sehingga terlihat tiket itu memang masuk
 *      bersamaan dengan uangnya, bukan pesanan lama yang baru dilunasi;
 *   7. meja yang sudah terisi menolak pesanan QR kedua;
 *   8. **tamu bisa membatalkan pesanannya sendiri** sebelum uangnya masuk: tombol
 *      di ponselnya mematikan kode bayarnya, pesanannya berhenti menunggu di
 *      layar dapur, dan mejanya kembali kosong;
 *   9. **denah meja bisa ditambah, diubah, dan dihapus** dari dasbor admin —
 *      termasuk pagar hapusnya: meja terisi dan meja yang tagihan tamunya masih
 *      menunggu ditolak dengan kalimatnya sendiri, dan tombol Hapusnya mati.
 *
 * Navigasi antar halaman memakai **navigasi sisi klien** (pushState + popstate):
 * state mode demo hidup di memori, jadi memuat ulang halaman akan mengulang
 * datanya dan yang diuji bukan lagi aplikasinya.
 *
 * Prasyarat:
 *   1. preview sedang berjalan (sesi demo ditanam skrip ini),
 *   2. Playwright terpasang **di luar repo** (`PLAYWRIGHT_DIR`), sama seperti
 *      `scripts/verify-struk-browser.mjs`.
 *
 * Usage: PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-meja-browser.mjs [http://localhost:5173]
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { qrisImageCaption, qrisImageLayout } from "../src/lib/qrisImage.ts";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/+$/, "");
const SHOTS = "/tmp/browser-shots";

const playwrightDir = process.env.PLAYWRIGHT_DIR;
const requireFrom = playwrightDir
  ? createRequire(`${playwrightDir.replace(/\/+$/, "")}/`)
  : createRequire(import.meta.url);
const { chromium } = requireFrom("playwright");

mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

/** Sesi demo pemilik toko (modul F&B aktif, paket Enterprise, tanpa pajak). */
const session = {
  user: { name: "Uji Meja", email: "meja-browser@mesinpos.test" },
  tenant: {
    name: "Kopi Uji Meja",
    slug: "kopi-uji-meja-browser",
    storeName: "Cabang Meja",
    vertical: "fnb",
    verticals: ["umkm", "fnb"],
    planKey: "enterprise",
    role: "owner",
    // Logo merchant untuk header halaman tamu (SVG sebaris supaya tidak perlu
    // berkas contoh): yang diuji adalah bahwa logonya benar-benar dipasang di
    // header, bukan isi gambarnya.
    logoUrl:
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><rect width='36' height='36' rx='8' fill='%230f172a'/></svg>",
    // Tanpa pajak & tanpa biaya layanan: angka menu → keranjang → tagihan harus
    // sama persis, sehingga selisih sekecil apa pun langsung kelihatan.
    taxActive: false,
    taxRatePct: 11,
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

const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

/** Navigasi sisi klien: state demo tidak boleh diulang oleh muat ulang halaman. */
async function gotoSpa(path) {
  await page.evaluate((target) => {
    window.history.pushState({}, "", target);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await page.waitForTimeout(250);
}

/** Angka rupiah dari teks `Rp 22.000` / `Rp 22.000,00` → 22000. */
function rupiahOf(text) {
  const digits = String(text ?? "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : NaN;
}

/**
 * Satu pesanan tamu: pilih menu pertama yang tersedia, tentukan cara bayarnya,
 * lalu kirim. `opsi.method` kosong = QRIS (bawaan halaman), `va` = Virtual
 * Account dengan bank pada `opsi.bank`.
 */
async function placeGuestOrder(expectedPath, opsi = {}) {
  await page.waitForSelector('[data-testid="meja-menu"]', { timeout: 15000 });
  check(
    `halaman tamu termuat di ${expectedPath}`,
    page.url().includes(expectedPath),
    page.url(),
  );

  // Menu pertama yang benar-benar bisa dipesan (yang habis tombolnya mati).
  const plus = page.locator('button[aria-label^="Tambah "]:not([disabled])').first();
  const row = plus.locator("xpath=ancestor::li[1]");
  // Hanya angka harganya (titik ribuan), bukan angka jumlah di baris yang sama.
  const firstPrice = rupiahOf((await row.innerText()).match(/Rp\s*[\d.]+/)?.[0]);
  await plus.click();
  await plus.click();
  await page.waitForTimeout(120);

  const cartTotal = rupiahOf(
    await page.locator('[data-testid="meja-total-keranjang"]').innerText(),
  );
  check(
    "keranjang menagih harga menu × jumlah (2×)",
    cartTotal === firstPrice * 2,
    `keranjang=${cartTotal} harga=${firstPrice}`,
  );

  await page.click('[data-testid="meja-lanjut-bayar"]');
  await page.waitForSelector('[data-testid="meja-total-checkout"]');
  const checkoutTotal = rupiahOf(
    await page.locator('[data-testid="meja-total-checkout"]').innerText(),
  );
  check(
    "total di lembar pesanan sama dengan total keranjang",
    checkoutTotal === cartTotal,
    `lembar=${checkoutTotal} keranjang=${cartTotal}`,
  );

  if (opsi.method === "va") {
    await page.click('[data-testid="meja-bayar-va"]');
    await page.click(`[data-testid="meja-bank-${opsi.bank ?? "bri"}"]`);
  }

  await page.fill('input[aria-label="Nama tamu"]', "Rina");
  await page.click('[data-testid="meja-kirim-pesanan"]');
  await page.waitForSelector('[data-testid="meja-pembayaran"]', { timeout: 15000 });

  const chargeText = await page
    .locator('[data-testid="meja-pembayaran"]')
    .innerText();
  const total = rupiahOf(
    await page.locator('[data-testid="meja-total-tagihan"]').innerText(),
  );
  check(
    "total tagihan server sama dengan total yang dilihat tamu",
    total === checkoutTotal,
    `tagihan=${total} lembar=${checkoutTotal}`,
  );
  check(
    "tagihan pesanan tamu bernomor & berstatus menunggu pembayaran",
    /DIG-\d{4}-\d{4}/.test(chargeText) && chargeText.includes("Menunggu pembayaran"),
    chargeText.slice(0, 120),
  );

  const qris =
    opsi.method === "va"
      ? null
      : await page
          .locator('[data-testid="meja-pembayaran"] svg[data-qr-value]')
          .first()
          .getAttribute("data-qr-value");
  if (opsi.method !== "va") {
    check(
      "kode QRIS yang digambar memuat nominal & nomor tagihannya",
      Boolean(qris) && qris.includes(String(total)) && /DIG-\d{4}-\d{4}/.test(qris),
      qris ?? "tidak ada kode",
    );
  }

  return { total, question: chargeText, qris };
}

try {
  // ------------------------------------------------- layar dapur: kartu QR meja
  await page.goto(`${BASE}/app/kds`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid^="meja-qr-"]', { timeout: 20000 });

  const qrButton = page.locator('[data-testid^="meja-qr-"]').first();
  await qrButton.click();
  await page.waitForSelector('[data-testid="meja-qr-kartu"] svg[data-qr-value]');

  const tableCard = await page.locator('[data-testid="meja-qr-kartu"]').innerText();
  const menuUrl = await page
    .locator('[data-testid="meja-qr-kartu"] svg[data-qr-value]')
    .first()
    .getAttribute("data-qr-value");

  check(
    "kartu QR meja mengodekan tautan `/meja/<token>` yang sah",
    Boolean(menuUrl) && /\/meja\/mj_[0-9a-f]{32}$/.test(menuUrl),
    menuUrl ?? "tidak ada tautan",
  );
  check(
    "kartu QR menyebut nama mejanya",
    /QR menu meja \S/.test(tableCard),
    tableCard.slice(0, 80),
  );

  // Hanya kartu QR yang terlihat saat dicetak (aturan cetak dari index.css).
  await page.emulateMedia({ media: "print" });
  const printState = await page.evaluate(() => {
    const area = document.querySelector('[data-testid="meja-qr-cetak-area"]');
    const live = document.querySelector('[data-testid="meja-qr-kartu"]');
    if (!area || !live) return null;
    return {
      areaVisibility: getComputedStyle(area).visibility,
      areaDisplay: getComputedStyle(area).display,
      liveVisibility: getComputedStyle(live).visibility,
      hasQr: Boolean(area.querySelector("svg[data-qr-value]")),
    };
  });
  await page.emulateMedia({ media: "screen" });
  check(
    "saat dicetak hanya kartu QR yang terlihat",
    printState &&
      printState.areaVisibility === "visible" &&
      printState.areaDisplay === "block" &&
      printState.liveVisibility === "hidden" &&
      printState.hasQr,
    JSON.stringify(printState),
  );

  // Menerbitkan ulang kartu tidak mengganti tokennya (kartu tercetak tetap sah).
  await page.click('[data-testid="meja-qr-salin"]');
  await page.waitForTimeout(150);
  const menuUrlAgain = await page
    .locator('[data-testid="meja-qr-kartu"] svg[data-qr-value]')
    .first()
    .getAttribute("data-qr-value");
  check(
    "membuka kartu QR berkali-kali tidak mengganti kodenya",
    menuUrlAgain === menuUrl,
    `${menuUrlAgain} ≠ ${menuUrl}`,
  );

  const guestPath = new URL(menuUrl).pathname;

  // -------------------------------------------- tamu: pesan, lalu simulasi bayar
  await gotoSpa(guestPath);
  await page.waitForSelector('[data-testid="meja-header"]', { timeout: 15000 });

  /*
    Header sticky halaman tamu: identitas merchant harus tetap terbaca saat menu
    digulir. Yang diperiksa di sini gaya yang benar-benar dihitung peramban —
    `position: sticky`, latar tembus pandang, dan `backdrop-filter: blur(…)` —
    lalu posisinya setelah halaman digulir.
  */
  const headerAwal = await page.evaluate(() => {
    const header = document.querySelector('[data-testid="meja-header"]');
    if (!header) return null;
    const style = getComputedStyle(header);
    return {
      position: style.position,
      blur: style.backdropFilter || style.webkitBackdropFilter || "",
      background: style.backgroundColor,
      top: Math.round(header.getBoundingClientRect().top),
      text: (header.textContent ?? "").replace(/\s+/g, " ").trim(),
    };
  });
  check(
    "header halaman tamu menempel diam dengan latar tembus pandang ber-blur",
    headerAwal?.position === "sticky" &&
      headerAwal.blur.includes("blur(") &&
      /rgba?\(/.test(headerAwal.background),
    JSON.stringify(headerAwal),
  );
  check(
    "header memuat identitas merchant, tokonya, dan meja yang dipesan",
    (headerAwal?.text ?? "").includes("Kopi Uji Meja") &&
      (headerAwal?.text ?? "").includes("Cabang Meja") &&
      /Meja [A-Z0-9]+/.test(headerAwal?.text ?? "") &&
      (headerAwal?.text ?? "").includes("Menu digital"),
    headerAwal?.text ?? "tidak ada header",
  );
  const logoTamu = await page
    .locator('[data-testid="meja-header-logo"]')
    .getAttribute("src");
  check(
    "logo merchant yang diunggah tampil di header",
    Boolean(logoTamu?.startsWith("data:image/svg+xml")),
    logoTamu ?? "tidak ada logo",
  );

  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(200);
  const headerSetelahGulir = await page.evaluate(() => {
    const header = document.querySelector('[data-testid="meja-header"]');
    return header
      ? { top: Math.round(header.getBoundingClientRect().top), scrollY: Math.round(window.scrollY) }
      : null;
  });
  check(
    "header tetap di atas setelah menunya digulir jauh",
    (headerSetelahGulir?.scrollY ?? 0) > 200 && headerSetelahGulir?.top === 0,
    JSON.stringify(headerSetelahGulir),
  );
  await page.evaluate(() => window.scrollTo(0, 0));

  const order = await placeGuestOrder(guestPath);
  check(
    "nama tamu ikut tercatat di pesanannya",
    order.question.includes("a/n Rina"),
    order.question.slice(0, 120),
  );

  /*
    Tombol “Screenshot QRIS” harus benar-benar menyerahkan berkas: Chromium
    headless tidak punya lembar bagikan berkas, jadi jalur unduhan yang dipakai.
    Berkasnya diperiksa dari byte-nya (PNG asli), dan ukurannya dibandingkan
    dengan tata letak aturan murninya — gambar yang salah ukuran berarti kanvas &
    aturannya tidak lagi sepakat.
  */
  const nomorTagihan = (order.question.match(/DIG-\d{4}-\d{4}/) ?? [])[0] ?? "";
  const [unduhan] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.click('[data-testid="meja-qris-screenshot"]'),
  ]);
  const namaBerkas = unduhan.suggestedFilename();
  check(
    "tombol Screenshot QRIS menyerahkan berkas PNG bernomor tagihannya",
    /^qris-dig-\d{4}-\d{4}\.png$/.test(namaBerkas),
    namaBerkas,
  );
  const lokasiBerkas = `${SHOTS}/${namaBerkas}`;
  await unduhan.saveAs(lokasiBerkas);
  const byteGambar = readFileSync(lokasiBerkas);
  check(
    "berkas screenshot benar-benar PNG, bukan berkas kosong",
    byteGambar.length > 1000 &&
      byteGambar
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    `${byteGambar.length} byte`,
  );
  const lebarGambar = byteGambar.readUInt32BE(16);
  const tinggiGambar = byteGambar.readUInt32BE(20);
  const harapan = qrisImageLayout(order.qris, {
    caption: qrisImageCaption({ amount: order.total, chargeNumber: nomorTagihan }),
  });
  check(
    "ukuran gambar screenshot sama dengan tata letak yang dijanjikan aturannya",
    lebarGambar === harapan.widthPx && tinggiGambar === harapan.heightPx,
    `${lebarGambar}×${tinggiGambar} vs ${harapan.widthPx}×${harapan.heightPx}`,
  );
  const notisGambar = await page.locator('[data-testid="meja-bayar-notis"]').innerText();
  check(
    "tamu diberi tahu berkasnya tersimpan beserta jalur bayarnya dari galeri",
    notisGambar.includes(namaBerkas) && notisGambar.includes("galeri"),
    notisGambar.slice(0, 160),
  );

  await page.click('[data-testid="meja-simulasi-bayar"]');
  await page.waitForSelector('text=Pembayaran diterima', { timeout: 15000 });
  const paidText = await page.locator('[data-testid="meja-pembayaran"]').innerText();
  const ticketNumber = (paidText.match(/A-\d{5}/) ?? [])[0];
  check(
    "setelah lunas, tamu melihat pesanannya masuk dapur beserta nomor tiketnya",
    Boolean(ticketNumber) && paidText.includes("sudah masuk ke dapur"),
    paidText.slice(0, 160),
  );

  // ---------------------------------------- layar dapur: pesanan & tiket muncul
  /*
    Dapur hanya bekerja atas pesanan yang **sudah lunas**. Tiketnya lahir tepat
    saat tagihan tamu lunas, dan penandanya menyebut kanal sekaligus momen
    pelunasannya — jadi terlihat tiket itu memang diterima bersamaan dengan
    uangnya masuk, bukan pesanan lama yang baru dilunasi belakangan.
  */
  await gotoSpa("/app/kds");
  const qrisBadge = page.locator('[data-testid^="kds-lunas-meja-"]').first();
  await qrisBadge.waitFor({ timeout: 15000 });
  const teksQrisBadge = (await qrisBadge.innerText()).trim();
  check(
    "tiket dapur menandai kanal & momen pelunasan pesanan QRIS dari meja",
    /^Lunas QRIS dari meja · diterima dapur pukul \d{2}:\d{2}$/.test(teksQrisBadge),
    teksQrisBadge,
  );
  const momenBadge = Number(await qrisBadge.getAttribute("data-paid-at"));
  check(
    "momen di tiket adalah momen pelunasannya (baru saja, bukan waktu pesanan dibuat)",
    Number.isFinite(momenBadge) && Math.abs(Date.now() - momenBadge) < 5 * 60 * 1000,
    `data-paid-at=${momenBadge}`,
  );
  const ticketCard = await qrisBadge.locator("xpath=ancestor::article[1]").innerText();
  check(
    "tiket dapur memuat nomor pesanan yang sama",
    ticketCard.includes(ticketNumber),
    ticketCard.slice(0, 160),
  );
  check(
    "layar dapur tidak menawarkan pelunasan tagihan & tidak ada pesanan QR yang menunggu",
    (await page.locator('[data-testid^="meja-lunasi-"]').count()) === 0 &&
      (await page.locator('[data-testid="meja-qr-menunggu-bayar"]').count()) === 0,
    "layar dapur masih menampilkan pesanan QR yang belum lunas",
  );

  // ------------------------------- tamu kedua di meja lain: lunas dari dapur
  const qrButtons = page.locator('[data-testid^="meja-qr-"]');
  check(
    "denah meja menyediakan lebih dari satu kartu QR untuk diuji",
    (await qrButtons.count()) >= 2,
    `tombol=${await qrButtons.count()}`,
  );
  await qrButtons.nth(1).click();
  await page.waitForSelector('[data-testid="meja-qr-kartu"] svg[data-qr-value]');
  const secondUrl = await page
    .locator('[data-testid="meja-qr-kartu"] svg[data-qr-value]')
    .first()
    .getAttribute("data-qr-value");
  check(
    "setiap meja punya tautan QR sendiri",
    secondUrl !== menuUrl && /\/meja\/mj_[0-9a-f]{32}$/.test(secondUrl ?? ""),
    secondUrl ?? "tidak ada tautan",
  );

  await gotoSpa(new URL(secondUrl).pathname);
  const order2 = await placeGuestOrder(new URL(secondUrl).pathname);
  const tagihan2 = (order2.question.match(/DIG-\d{4}-\d{4}/) ?? [])[0] ?? "";
  // Nama mejanya dibaca dari kartu tagihan tamunya, bukan ditebak dari urutan
  // denah (urutan meja mengikuti zona, bukan nomornya).
  const meja2 = (order2.question.match(/Meja (\S+)/) ?? [])[1] ?? "";

  // Pesanan yang belum dibayar: layar dapur menyebut jumlahnya, bukan isinya.
  await gotoSpa("/app/kds");
  await page.waitForSelector('[data-testid="meja-qr-menunggu-bayar"]');
  const notisTunggu = await page
    .locator('[data-testid="meja-qr-menunggu-bayar"]')
    .innerText();
  const teksDapurTunggu = await page.locator("main").innerText();
  check(
    "pesanan QR yang belum dibayar tidak tampil di layar dapur",
    !teksDapurTunggu.includes(tagihan2) &&
      !teksDapurTunggu.includes("Rina") &&
      (await page.locator('[data-testid^="meja-lunasi-"]').count()) === 0 &&
      (await page.locator('[data-testid^="kds-lunas-meja-"]').count()) === 1,
    teksDapurTunggu.slice(0, 200),
  );
  check(
    "layar dapur menyebut ada pesanan QR menunggu pelunasan, beserta tautan ke halaman Pembayaran",
    notisTunggu.includes("1 pesanan QR meja menunggu pelunasan") &&
      notisTunggu.includes("Dapur hanya menerima pesanan yang sudah lunas") &&
      (await page
        .locator('[data-testid="meja-qr-ke-pembayaran"]')
        .getAttribute("href")) === "/app/payments",
    notisTunggu.slice(0, 200),
  );
  // Penghitung & tombolnya harus benar-benar berada di kartu antrean dapur
  // (kolom tempat tiket dapur), bukan di kolom denah meja: itulah yang membuat
  // kasir membacanya tanpa berpindah halaman lebih dulu.
  const panelAntreanDapur = await page
    .locator('[data-testid="meja-qr-menunggu-bayar"] >> xpath=ancestor::section[1]')
    .innerText();
  check(
    "penghitung & tombolnya menempel di kartu antrean dapur, bukan di kolom denah meja",
    panelAntreanDapur.includes("Antrean dapur") &&
      panelAntreanDapur.includes("1 pesanan QR meja menunggu pelunasan") &&
      panelAntreanDapur.includes("Ke halaman Pembayaran") &&
      !panelAntreanDapur.includes("Denah meja"),
    panelAntreanDapur.slice(0, 200),
  );
  check(
    "penghitungnya terbaca sebagai lencana berangka, tombolnya berlabel tujuan",
    (await page.locator('[data-testid="meja-qr-menunggu-jumlah"]').innerText()).includes(
      "1 pesanan QR meja menunggu pelunasan",
    ) &&
      (await page.locator('[data-testid="meja-qr-ke-pembayaran"]').innerText()).includes(
        "Ke halaman Pembayaran",
      ),
    `${await page.locator('[data-testid="meja-qr-menunggu-jumlah"]').innerText()} | ${await page.locator('[data-testid="meja-qr-ke-pembayaran"]').innerText()}`,
  );

  /*
    Notifikasi tagihan baru di **peramban sungguhan**: kilatnya harus benar-benar
    terpasang sebagai animasi CSS `kilat` dari Tailwind (bukan sekadar nama kelas
    di markup), tandanya menyebut jumlahnya, dan saklar bunyinya bisa dimatikan
    dari kartu antrean itu sendiri — dimatikan pun kilatnya tetap berjalan, karena
    yang hilang hanya bunyinya.

    Bunyinya sendiri tidak bisa "didengar" di sini: nada yang benar-benar
    dijadwalkan ke Web Audio diperiksa di `verify-scan-beep.mjs`, dan bahwa layar
    dapur memanggilnya sekali per tagihan baru diperiksa di `verify-render.mjs`.
  */
  const animasiKilat = await page
    .locator('[data-testid="meja-qr-menunggu-bayar"]')
    .evaluate((node) => {
      const gaya = getComputedStyle(node);
      return {
        kilat: node.getAttribute("data-kilat"),
        nama: gaya.animationName,
        durasi: gaya.animationDuration,
      };
    });
  check(
    "tagihan QR baru benar-benar mengkilatkan kartu antrean dapur (animasi `kilat` terpasang)",
    animasiKilat.kilat === "1" &&
      animasiKilat.nama.split(",").map((nama) => nama.trim()).includes("kilat") &&
      animasiKilat.durasi !== "0s",
    JSON.stringify(animasiKilat),
  );
  check(
    "tanda “baru” menyebut berapa tagihan yang baru masuk",
    (await page.locator('[data-testid="meja-qr-kilat"]').innerText()).includes(
      "1 tagihan QR baru masuk",
    ) &&
      (await page
        .locator('[data-testid="meja-qr-kilat"]')
        .getAttribute("data-kilat-jumlah")) === "1",
    await page.locator('[data-testid="meja-qr-kilat"]').innerText(),
  );
  const saklarBip = page.locator('[data-testid="meja-qr-bip"]');
  check(
    "saklar bunyi tagihan ada di kartu antrean dapur & menyala secara bawaan",
    (await saklarBip.innerText()).includes("Bip tagihan aktif") &&
      (await saklarBip.getAttribute("aria-checked")) === "true",
    await saklarBip.innerText(),
  );
  await saklarBip.click();
  await page.waitForTimeout(120);
  check(
    "mematikan bunyinya dari kartu antrean tidak mematikan kilatnya",
    (await saklarBip.getAttribute("aria-checked")) === "false" &&
      (await saklarBip.innerText()).includes("Bip tagihan mati") &&
      (await page
        .locator('[data-testid="meja-qr-menunggu-bayar"]')
        .getAttribute("data-kilat")) === "1",
    `${await saklarBip.innerText()} · kilat=${await page
      .locator('[data-testid="meja-qr-menunggu-bayar"]')
      .getAttribute("data-kilat")}`,
  );
  await saklarBip.click();
  await page.waitForTimeout(120);
  check(
    "menyalakannya lagi kembali ke keadaan berbunyi",
    (await saklarBip.getAttribute("aria-checked")) === "true" &&
      (await saklarBip.innerText()).includes("Bip tagihan aktif"),
    await saklarBip.innerText(),
  );

  // Kasir mengikuti tautan itu: tagihannya dikenali sebagai pesanan QR meja A2.
  await page.click('[data-testid="meja-qr-ke-pembayaran"]');
  await page.waitForURL("**/app/payments");
  const barisTagihan2 = page.locator(`[data-testid="tagihan-${tagihan2}"]`);
  await barisTagihan2.waitFor({ timeout: 15000 });
  const teksBaris2 = await barisTagihan2.innerText();
  check(
    "halaman Pembayaran mengenali tagihan pesanan QR beserta meja & tamunya",
    teksBaris2.includes(`Pesanan QR meja ${meja2}`) &&
      teksBaris2.includes("Rina") &&
      teksBaris2.includes("dapur baru menerima pesanannya setelah tagihan ini lunas"),
    teksBaris2.slice(0, 260),
  );
  check(
    "tombol pelunasan di halaman Pembayaran menyebut akan mengirim pesanannya ke dapur",
    (await barisTagihan2.locator('[data-testid^="tagihan-lunasi-"]').innerText()).includes(
      "Lunasi & kirim ke dapur",
    ),
    await barisTagihan2.locator('[data-testid^="tagihan-lunasi-"]').innerText(),
  );
  await barisTagihan2.locator('[data-testid^="tagihan-lunasi-"]').click();
  await page.waitForSelector("text=ditandai lunas", { timeout: 15000 });

  await gotoSpa("/app/kds");
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="kds-lunas-meja-"]').length >= 2,
    undefined,
    { timeout: 15000 },
  );
  const afterSettleBadges = await page.locator('[data-testid^="kds-lunas-meja-"]').count();
  check(
    "melunasi dari halaman Pembayaran langsung membuat tiket dapurnya",
    afterSettleBadges >= 2 &&
      (await page.locator('[data-testid="meja-qr-menunggu-bayar"]').count()) === 0,
    `penanda Lunas = ${afterSettleBadges}`,
  );
  const settledCard = await page
    .locator('[data-testid^="kds-lunas-meja-"]')
    .last()
    .locator("xpath=ancestor::article[1]")
    .innerText();
  check(
    "tiket dapur kedua juga memuat nomor pesanannya sendiri & momen pelunasan QRIS",
    /A-\d{5}/.test(settledCard) &&
      settledCard.includes("Lunas QRIS dari meja · diterima dapur pukul"),
    settledCard.slice(0, 200),
  );

  // ---------------------------------- meja yang terisi menolak pesanan kedua
  await gotoSpa(guestPath);
  await page.waitForSelector('[data-testid="meja-menu"]', { timeout: 15000 });
  await page.locator('button[aria-label^="Tambah "]:not([disabled])').first().click();
  await page.click('[data-testid="meja-lanjut-bayar"]');
  await page.click('[data-testid="meja-kirim-pesanan"]');
  await page.waitForSelector('[data-testid="meja-error"]', { timeout: 15000 });
  const rejection = await page.locator('[data-testid="meja-error"]').innerText();
  check(
    "meja yang masih terisi menolak pesanan QR kedua",
    rejection.includes("masih terisi pesanan"),
    rejection,
  );

  // ------------------------------- tamu ketiga: bayar lewat Virtual Account
  await gotoSpa("/app/kds");
  await page.waitForSelector('[data-testid^="meja-qr-"]', { timeout: 20000 });
  await page.locator('[data-testid^="meja-qr-"]').nth(2).click();
  await page.waitForSelector('[data-testid="meja-qr-kartu"] svg[data-qr-value]');
  const vaUrl = await page
    .locator('[data-testid="meja-qr-kartu"] svg[data-qr-value]')
    .first()
    .getAttribute("data-qr-value");
  const vaPath = new URL(vaUrl).pathname;
  await gotoSpa(vaPath);
  const orderVa = await placeGuestOrder(vaPath, { method: "va", bank: "bri" });
  const tagihanVa = (orderVa.question.match(/DIG-\d{4}-\d{4}/) ?? [])[0] ?? "";
  const mejaVa = (orderVa.question.match(/Meja (\S+)/) ?? [])[1] ?? "";

  const nomorVa = (
    await page.locator('[data-testid="meja-va-nomor"]').innerText()
  ).trim();
  check(
    "tamu Virtual Account menerima nomor VA bank yang dipilihnya (BRI)",
    /^8888\d{8}$/.test(nomorVa),
    nomorVa || "tidak ada nomor VA",
  );
  check(
    "kartu VA tidak menggambar kode QRIS & menyediakan tombol salin",
    (await page.locator('[data-testid="meja-pembayaran"] svg[data-qr-value]').count()) === 0 &&
      (await page.locator('[data-testid="meja-va-salin"]').count()) === 1 &&
      (await page.locator('[data-testid="meja-qris-screenshot"]').count()) === 0,
    "kartu VA tidak sesuai",
  );
  await page.click('[data-testid="meja-va-salin"]');
  await page.waitForTimeout(250);
  const notisVa = await page.locator('[data-testid="meja-bayar-notis"]').innerText();
  check(
    "menekan Salin melaporkan nomornya (atau jalur salin manualnya)",
    notisVa.includes(nomorVa),
    notisVa.slice(0, 160),
  );

  // Layar dapur tetap tidak menampilkan pesanan VA yang belum dibayar.
  await gotoSpa("/app/kds");
  await page.waitForSelector('[data-testid="meja-qr-menunggu-bayar"]');
  const teksDapurVa = await page.locator("main").innerText();
  check(
    "pesanan VA yang belum dibayar tidak tampil sebagai antrean dapur",
    teksDapurVa.includes("1 pesanan QR meja menunggu pelunasan") &&
      !teksDapurVa.includes(tagihanVa) &&
      !teksDapurVa.includes(nomorVa) &&
      (await page.locator('[data-testid^="meja-lunasi-"]').count()) === 0,
    teksDapurVa.slice(0, 240),
  );

  // Kasir melunasi tagihan VA itu dari halaman Pembayaran.
  await gotoSpa("/app/payments");
  const barisTagihanVa = page.locator(`[data-testid="tagihan-${tagihanVa}"]`);
  await barisTagihanVa.waitFor({ timeout: 15000 });
  const teksBarisVa = await barisTagihanVa.innerText();
  check(
    "kasir melihat pesanan VA beserta bank & nomor tujuannya dari halaman Pembayaran",
    teksBarisVa.includes(`Pesanan QR meja ${mejaVa}`) &&
      teksBarisVa.includes("Virtual Account") &&
      teksBarisVa.includes(nomorVa) &&
      teksBarisVa.includes("VA BRI"),
    teksBarisVa.slice(0, 260),
  );

  await barisTagihanVa.locator('[data-testid^="tagihan-lunasi-"]').click();
  await page.waitForSelector("text=ditandai lunas", { timeout: 15000 });
  const tiketVa = (
    (await barisTagihanVa.innerText()).match(/A-\d{5}/) ?? []
  )[0] ?? "";
  check(
    "pelunasan itu mencatat penjualannya (nomor tiket terlihat di baris tagihannya)",
    /^A-\d{5}$/.test(tiketVa),
    tiketVa || "tidak ada nomor penjualan",
  );

  await gotoSpa("/app/kds");
  const badgeVa = page.locator('[data-testid^="kds-lunas-meja-"]').last();
  await badgeVa.waitFor({ timeout: 15000 });
  const teksBadgeVa = (await badgeVa.innerText()).trim();
  check(
    "tiket dapur menandai pesanan itu lunas lewat Virtual Account bank-nya beserta momennya",
    /^Lunas VA BRI dari meja · diterima dapur pukul \d{2}:\d{2}$/.test(teksBadgeVa),
    teksBadgeVa,
  );
  check(
    "tiket yang muncul di dapur adalah penjualan dari pelunasan tagihan itu",
    (await badgeVa.locator("xpath=ancestor::article[1]").innerText()).includes(tiketVa),
    await badgeVa.locator("xpath=ancestor::article[1]").innerText(),
  );

  /*
    ------------------------------- tamu membatalkan pesanannya sendiri
    Pembeli yang berubah pikiran harus bisa membatalkan pesanannya sendiri dari
    ponselnya, tanpa menunggu kasir — dan pembatalan itu harus terlihat di layar
    dapur serta meninggalkan mejanya kosong (bukan tertahan selamanya).
  */
  await gotoSpa("/app/kds");
  await page.waitForSelector('[data-testid^="meja-qr-"]', { timeout: 20000 });
  const tombolQrBatal = page.locator('[data-testid^="meja-qr-"]').nth(3);
  const idMejaBatal = ((await tombolQrBatal.getAttribute("data-testid")) ?? "").replace(
    "meja-qr-",
    "",
  );
  await tombolQrBatal.click();
  await page.waitForSelector('[data-testid="meja-qr-kartu"] svg[data-qr-value]');
  const batalUrl = await page
    .locator('[data-testid="meja-qr-kartu"] svg[data-qr-value]')
    .first()
    .getAttribute("data-qr-value");
  const batalPath = new URL(batalUrl).pathname;
  await gotoSpa(batalPath);
  const orderBatal = await placeGuestOrder(batalPath);
  const nomorBatal = (orderBatal.question.match(/DIG-\d{4}-\d{4}/) ?? [])[0] ?? "";

  check(
    "tagihan tamu menawarkan pembatalan selama uangnya belum masuk",
    (await page.locator('[data-testid="meja-batal-pesanan"]').count()) === 1,
    "tombol batalkan pesanan tidak ada",
  );
  await page.click('[data-testid="meja-batal-pesanan"]');
  const konfirmasiBatal = await page.locator('[data-testid="meja-batal-area"]').innerText();
  check(
    "membatalkan pesanan meminta konfirmasi & menjelaskan akibatnya",
    konfirmasiBatal.includes("tidak diteruskan ke dapur") &&
      (await page.locator('[data-testid="meja-batal-konfirmasi"]').count()) === 1,
    konfirmasiBatal.slice(0, 160),
  );
  await page.click('[data-testid="meja-batal-tidak"]');
  await page.waitForTimeout(150);
  check(
    "menolak konfirmasi mengembalikan pesanannya (belum dibatalkan)",
    (await page.locator('[data-testid="meja-batal-pesanan"]').count()) === 1 &&
      (await page.locator('[data-testid="meja-pembayaran"]').innerText()).includes(
        "Menunggu pembayaran",
      ),
    await page.locator('[data-testid="meja-pembayaran"]').innerText(),
  );

  await page.click('[data-testid="meja-batal-pesanan"]');
  await page.click('[data-testid="meja-batal-konfirmasi"]');
  await page.waitForSelector('[data-testid="meja-batal-notis"]', { timeout: 15000 });
  const notisBatal = await page.locator('[data-testid="meja-batal-notis"]').innerText();
  const kartuBatal = await page.locator('[data-testid="meja-pembayaran"]').innerText();
  check(
    "membatalkan pesanan mengubah statusnya & mematikan kode bayarnya",
    notisBatal.includes("sudah dibatalkan") &&
      kartuBatal.includes("Pesanan dibatalkan") &&
      (await page.locator('[data-testid="meja-pembayaran"] svg[data-qr-value]').count()) === 0,
    kartuBatal.slice(0, 200),
  );

  await gotoSpa("/app/kds");
  await page.waitForSelector('[data-testid^="meja-qr-"]', { timeout: 20000 });
  const teksKartuQr = await page.locator("main").innerText();
  check(
    "pesanan yang dibatalkan tamunya tidak menunggu apa pun di layar dapur",
    !teksKartuQr.includes(nomorBatal) &&
      (await page.locator('[data-testid="meja-qr-menunggu-bayar"]').count()) === 0,
    teksKartuQr.slice(0, 240),
  );
  const kartuMejaBatal = await page
    .locator(`[data-testid="meja-kartu-${idMejaBatal}"]`)
    .innerText();
  check(
    "meja tamu yang membatalkan pesanannya kembali kosong",
    kartuMejaBatal.includes("Kosong"),
    kartuMejaBatal.slice(0, 160),
  );

  /*
    ------------------------------ denah meja dari dasbor admin
    Tambah, ubah, hapus — dengan pagar hapusnya. Meja yang tagihan tamunya masih
    menunggu ditolak lewat kalimat yang sama dengan yang dibaca tamu di ponselnya
    ("tamunya juga bisa membatalkannya sendiri").
  */
  const tombolQrTunggu = page.locator('[data-testid^="meja-qr-"]').nth(4);
  const idMejaTunggu = ((await tombolQrTunggu.getAttribute("data-testid")) ?? "").replace(
    "meja-qr-",
    "",
  );
  await tombolQrTunggu.click();
  await page.waitForSelector('[data-testid="meja-qr-kartu"] svg[data-qr-value]');
  const tungguUrl = await page
    .locator('[data-testid="meja-qr-kartu"] svg[data-qr-value]')
    .first()
    .getAttribute("data-qr-value");
  await gotoSpa(new URL(tungguUrl).pathname);
  await placeGuestOrder(new URL(tungguUrl).pathname);

  await gotoSpa("/app/kds");
  await page.waitForSelector('[data-testid^="meja-hapus-"]', { timeout: 20000 });
  const kartuMejaUji = () =>
    page.locator('[data-testid^="meja-kartu-"]').filter({ hasText: "UJI-BROWSER" });
  const jumlahKartuMeja = () => page.locator('[data-testid^="meja-kartu-"]').count();
  const sebelumTambah = await jumlahKartuMeja();

  const kalimatBlokir = async (tableId) => {
    await page.locator(`[data-testid="meja-hapus-${tableId}"]`).click();
    await page.waitForSelector('[data-testid="meja-dialog-kalimat"]');
    const kalimat = await page.locator('[data-testid="meja-dialog-kalimat"]').innerText();
    const terblokir = await page.locator('[data-testid="meja-dialog-hapus"]').isDisabled();
    await page.click('[data-testid="meja-dialog-batal"]');
    await page.waitForTimeout(120);
    return { kalimat, terblokir };
  };

  const tungguTolak = await kalimatBlokir(idMejaTunggu);
  check(
    "meja yang tagihan tamunya masih menunggu tidak bisa dihapus",
    tungguTolak.terblokir &&
      tungguTolak.kalimat.includes("menunggu pembayaran") &&
      tungguTolak.kalimat.includes("tamunya juga bisa membatalkannya sendiri"),
    tungguTolak.kalimat.slice(0, 200),
  );

  const kartuTerisi = page
    .locator('[data-testid^="meja-kartu-"]')
    .filter({ hasText: "Terisi" })
    .first();
  const idMejaTerisi = ((await kartuTerisi.getAttribute("data-testid")) ?? "").replace(
    "meja-kartu-",
    "",
  );
  const terisiTolak = await kalimatBlokir(idMejaTerisi);
  check(
    "meja yang masih terisi pesanan terbuka tidak bisa dihapus",
    terisiTolak.terblokir && terisiTolak.kalimat.includes("masih terisi pesanan"),
    terisiTolak.kalimat.slice(0, 200),
  );

  await page.fill('[aria-label="Nama meja"]', "UJI-BROWSER");
  await page.fill('[aria-label="Jumlah kursi"]', "3");
  await page.fill('[aria-label="Zona meja"]', "Uji Browser");
  await page.click('[data-testid="meja-tambah"]');
  await page.waitForTimeout(250);
  check(
    "menambah meja dari dasbor menambah kartunya di denah",
    (await jumlahKartuMeja()) === sebelumTambah + 1 &&
      (await kartuMejaUji().count()) === 1,
    `${sebelumTambah} → ${await jumlahKartuMeja()}`,
  );

  await kartuMejaUji().locator('[data-testid^="meja-ubah-"]').click();
  await page.waitForSelector('[data-testid="meja-ubah-nama"]');
  await page.fill('[data-testid="meja-ubah-nama"]', "UJI-BROWSER 2");
  await page.fill('[data-testid="meja-ubah-kursi"]', "5");
  await page.fill('[data-testid="meja-ubah-zona"]', "Uji B");
  await page.click('[data-testid="meja-dialog-simpan"]');
  await page.waitForTimeout(250);
  const kartuDiubah = await kartuMejaUji().innerText();
  check(
    "mengubah meja mengganti nama, kursi, dan zonanya di denah",
    kartuDiubah.includes("UJI-BROWSER 2") &&
      kartuDiubah.includes("5 kursi") &&
      kartuDiubah.includes("Uji B"),
    kartuDiubah.slice(0, 160),
  );

  // Nama meja tetap unik: menambah meja dengan nama yang sudah dipakai ditolak.
  await page.fill('[aria-label="Nama meja"]', "UJI-BROWSER 2");
  await page.fill('[aria-label="Jumlah kursi"]', "4");
  await page.click('[data-testid="meja-tambah"]');
  await page.waitForTimeout(250);
  check(
    "menambah meja dengan nama yang sudah dipakai ditolak dengan kalimatnya",
    (await page.locator('[data-testid="meja-galat"]').innerText()).includes(
      "sudah ada di denah ini",
    ),
    await page.locator('[data-testid="meja-galat"]').innerText(),
  );

  await kartuMejaUji()
    .locator('[data-testid^="meja-hapus-"]')
    .click();
  await page.waitForSelector('[data-testid="meja-dialog-kalimat"]');
  const kalimatHapus = await page.locator('[data-testid="meja-dialog-kalimat"]').innerText();
  check(
    "meja yang belum pernah dipakai boleh dihapus (tombol Hapusnya hidup)",
    kalimatHapus.includes("belum pernah dipakai") &&
      (await page.locator('[data-testid="meja-dialog-hapus"]').isEnabled()),
    kalimatHapus.slice(0, 200),
  );
  await page.click('[data-testid="meja-dialog-hapus"]');
  await page.waitForTimeout(250);
  check(
    "meja yang dihapus benar-benar hilang dari denah",
    (await jumlahKartuMeja()) === sebelumTambah &&
      (await kartuMejaUji().count()) === 0,
    `${await jumlahKartuMeja()} kartu`,
  );

  /*
    Urutan denah: meja bisa digeser satu langkah, tombolnya mati di ujung denah,
    dan urutannya menempel pada mejanya (bukan pada posisi di layar).
  */
  const kartuMejaIds = () =>
    page
      .locator('[data-testid^="meja-kartu-"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-testid") ?? ""),
      );
  const urutAwal = await kartuMejaIds();
  const idPalingAwal = (urutAwal[0] ?? "").replace("meja-kartu-", "");
  const idPalingAkhir = (urutAwal[urutAwal.length - 1] ?? "").replace(
    "meja-kartu-",
    "",
  );
  check(
    "meja paling awal tidak bisa digeser ke kiri",
    await page.locator(`[data-testid="meja-geser-kiri-${idPalingAwal}"]`).isDisabled(),
    "tombol geser kiri di meja pertama masih hidup",
  );
  check(
    "meja paling akhir tidak bisa digeser ke kanan",
    await page
      .locator(`[data-testid="meja-geser-kanan-${idPalingAkhir}"]`)
      .isDisabled(),
    "tombol geser kanan di meja terakhir masih hidup",
  );
  await page.click(`[data-testid="meja-geser-kanan-${idPalingAwal}"]`);
  await page.waitForTimeout(250);
  const urutGeser = await kartuMejaIds();
  check(
    "menekan Geser memindahkan meja satu langkah di denah",
    urutGeser[0] === urutAwal[1] &&
      urutGeser[1] === urutAwal[0] &&
      urutGeser.slice(2).join(",") === urutAwal.slice(2).join(","),
    `${urutAwal.slice(0, 2).join(" ")} → ${urutGeser.slice(0, 2).join(" ")}`,
  );
  await page.click(`[data-testid="meja-geser-kiri-${idPalingAwal}"]`);
  await page.waitForTimeout(250);
  check(
    "menggeser balik mengembalikan denah ke urutan semula",
    (await kartuMejaIds()).join(",") === urutAwal.join(","),
    (await kartuMejaIds()).slice(0, 3).join(" "),
  );

  /*
    Impor sekaligus: pratinjaunya memakai aturan yang sama dengan server,
    penolakannya menyebut nomor barisnya, dan hasilnya masuk berurutan di akhir
    denah.
  */
  await page.fill('[data-testid="meja-impor-teks"]', "IMP-1, 4, Teras\nIMP-2, 2");
  await page.waitForSelector('[data-testid="meja-impor-pratinjau"]');
  const pratinjauImpor = await page
    .locator('[data-testid="meja-impor-pratinjau"]')
    .innerText();
  check(
    "pratinjau impor menyebut jumlah meja & kolom tiap barisnya",
    pratinjauImpor.includes("2 meja siap ditambahkan") &&
      pratinjauImpor.includes("IMP-1 · Teras") &&
      pratinjauImpor.includes("4 kursi") &&
      pratinjauImpor.includes("IMP-2"),
    pratinjauImpor.slice(0, 200),
  );

  await page.fill('[data-testid="meja-impor-teks"]', "IMP-1, 4\nimp-1, 2");
  await page.waitForSelector('[data-testid="meja-impor-galat"]');
  const galatImpor = await page.locator('[data-testid="meja-impor-galat"]').innerText();
  check(
    "impor yang salah ditolak sebelum dikirim, beserta nomor barisnya",
    galatImpor.includes("Baris 2") &&
      galatImpor.includes("dua kali") &&
      (await page.locator('[data-testid="meja-impor"]').isDisabled()),
    galatImpor.slice(0, 200),
  );

  await page.fill('[data-testid="meja-impor-teks"]', "IMP-1, 4, Teras\nIMP-2, 2");
  await page.waitForSelector('[data-testid="meja-impor-pratinjau"]');
  const sebelumImpor = (await kartuMejaIds()).length;
  await page.click('[data-testid="meja-impor"]');
  await page.waitForSelector('[data-testid="meja-impor-notis"]', { timeout: 15000 });
  const notisImpor = await page.locator('[data-testid="meja-impor-notis"]').innerText();
  check(
    "impor menambah beberapa meja sekaligus & melaporkan hasilnya",
    (await kartuMejaIds()).length === sebelumImpor + 2 &&
      notisImpor.includes("2 meja ditambahkan") &&
      notisImpor.includes("IMP-1") &&
      notisImpor.includes("IMP-2"),
    notisImpor.slice(0, 200),
  );
  const urutImpor = await kartuMejaIds();
  const teksDuaTerakhir = await Promise.all(
    urutImpor.slice(-2).map((id) =>
      page.locator(`[data-testid="${id}"]`).innerText(),
    ),
  );
  check(
    "meja hasil impor masuk berurutan di akhir denah dengan kursi & zonanya",
    teksDuaTerakhir[0].includes("IMP-1") &&
      teksDuaTerakhir[0].includes("4 kursi") &&
      teksDuaTerakhir[0].includes("Teras") &&
      teksDuaTerakhir[1].includes("IMP-2"),
    teksDuaTerakhir.join(" | ").slice(0, 200),
  );

  check(
    "tidak ada galat konsol selama alur berjalan",
    consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(" | "),
  );
} catch (error) {
  await page.screenshot({ path: `${SHOTS}/meja-browser-gagal.png`, fullPage: true });
  results.push({ name: "alur berhenti karena galat", ok: false });
  console.error(String(error?.stack ?? error));
} finally {
  await context.close();
  await browser.close();
}

const failed = results.filter((result) => !result.ok).length;
if (failed === 0) {
  console.log(`${results.length}/${results.length} checks passed`);
} else {
  for (const result of results) {
    console.log(`${result.ok ? "✓" : "✗"} ${result.name}`);
  }
  process.exitCode = 1;
}

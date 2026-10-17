/**
 * Cetak struk **langsung ke printer** (ESC/POS) di browser sungguhan —
 * Chromium/Playwright atas preview yang sedang berjalan.
 *
 * Kenapa ada: `scripts/verify-escpos.mjs` menjaga byte-nya (urutan perintah,
 * saringan ASCII, raster, pemecahan per chunk) dan `scripts/verify-render.mjs`
 * menjaga tampilannya di DOM tiruan — tetapi DOM tiruan tidak punya `navigator.usb`
 * maupun `navigator.bluetooth`, jadi di sana seluruh jalur perangkat hanya bisa
 * terlihat sebagai “tidak didukung”. Yang diuji di sini justru jalur yang paling
 * mudah salah dan paling mahal kalau salah:
 *
 *   1. tombol **Sambungkan** benar-benar meminta perangkat, membuka konfigurasi,
 *      memilih alternate, dan meng-*claim* interface-nya;
 *   2. tombol **Cetak ke printer** benar-benar mengirim byte ke endpoint USB —
 *      dan **tidak** memanggil `window.print()` sama sekali (itu janji fiturnya);
 *   3. jalur Bluetooth memecah byte jadi potongan kecil (≤ 100 byte) lewat
 *      karakteristik tulis yang benar, karena MTU BLE memang kecil;
 *   4. peramban tanpa kedua API (Firefox/Safari) tetap bisa mencetak lewat
 *      **dialog cetak peramban**, dan alasannya dikatakan di layar;
 *   5. pemilih perangkat yang ditutup kasir dijelaskan apa adanya, dan kegagalan
 *      itu **tidak** diam-diam beralih ke dialog cetak peramban.
 *
 * Catatan tentang gerbang paket: jalur ini dikunci fitur `peripheral.escpos`, dan
 * ketiga paket di katalog (`starter`, `professional`, `enterprise`) sama-sama
 * memuatnya — jadi hari ini tidak ada paket yang bisa dipakai sebagai contoh
 * negatif. Karena itu yang diuji di sini bukan penolakan paket, melainkan
 * penolakan **peramban** (konteks 2).
 *
 * Perangkatnya **tiruan** (dipasang lewat `addInitScript`): printer struk tidak
 * bisa disambungkan ke mesin CI, dan yang perlu dibuktikan di sini adalah perilaku
 * aplikasinya — API peramban yang dipanggil, urutan panggilannya, dan byte yang
 * keluar — bukan driver Windows atau firmware printer. Peramban tanpa WebUSB/Web
 * Bluetooth ditiru dengan menghapus kedua properti itu di konteks uji, persis
 * seperti keadaan Firefox/Safari.
 *
 * Prasyarat:
 *   1. preview sedang berjalan (sesi demo ditanam skrip ini),
 *   2. Playwright terpasang **di luar repo** (`PLAYWRIGHT_DIR`), sama seperti
 *      `scripts/verify-struk-browser.mjs`.
 *
 * Usage: PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-escpos-browser.mjs [http://localhost:5173]
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
const SHIFT_KEY = "mesinpos.shifts.v1";

/** Sesi demo pemilik toko, supaya `/app` bisa dibuka tanpa alur masuk. */
function sessionFor(planKey) {
  return {
    user: { name: "Uji Escpos", email: "escpos-browser@mesinpos.test" },
    tenant: {
      name: "Warung Uji Struk",
      slug: `warung-uji-escpos-${planKey}`,
      storeName: "Cabang Struk",
      vertical: "umkm",
      verticals: ["umkm"],
      planKey,
      role: "owner",
      taxActive: true,
      taxRatePct: 11,
      // Pengingat tutup shift dimatikan: skrip ini menguji pencetakan langsung
      // ke printer, bukan pengingatnya.
      shift: { active: false, reminderHour: 21, longShiftHours: 14 },
      createdAt: new Date().toISOString(),
      trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
    },
  };
}

/**
 * Shift kas yang terbuka di konteks itu. Gerbang kasir (`posShiftGate`) menuntut
 * shiftnya dibuka sebelum halaman Kasir bisa menjual, sedangkan semua struk yang
 * diuji di sini lahir dari penjualan di kasir — jadi shiftnya dibuka lebih dulu,
 * sama seperti kasir sungguhan di halaman Shift & Kas.
 */
function seedShift(context, id) {
  return context.addInitScript(
    ([key, shiftId]) => {
      try {
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
      } catch {
        // Penyimpanan diblokir: tombol kasirnya akan menyebut sebabnya sendiri.
      }
    },
    [SHIFT_KEY, id],
  );
}

/* --------------------------------------------------------- tiruan perangkat -- */

/**
 * Memasang **perangkat printer tiruan** ke `navigator` (WebUSB & Web Bluetooth).
 *
 * Bentuk perangkatnya sengaja dibuat seperti printer yang sebenarnya: konfigurasi
 * dengan satu interface kelas printer (0x07) ber-endpoint bulk-out, dan untuk
 * Bluetooth satu layanan ISSC dengan karakteristik tulis tanpa respons. Semua
 * panggilan dicatat (`__usbLog`, `__escposBytes`, `__bleChunks`) supaya yang
 * diperiksa di bawah adalah panggilan API & byte yang benar-benar lewat.
 */
function installFakePrinters() {
  const ESCPOS_USB = "49535343-fe7d-4ae5-8fa9-9fafd205e455";
  const ESCPOS_USB_WRITE = "49535343-8841-43f4-a8d4-ecbe34729bb3";

  window.__usbLog = [];
  window.__escposBytes = [];
  window.__bleBytes = [];
  window.__bleChunks = [];
  window.__usbRequests = 0;
  window.__bleRequest = null;
  window.__cetakanStruk = 0;
  window.print = () => {
    window.__cetakanStruk += 1;
  };

  function createUsbDevice() {
    const endpoint = {
      endpointNumber: 2,
      direction: "out",
      type: "bulk",
      packetSize: 64,
    };
    const alternate = {
      alternateSetting: 0,
      interfaceClass: 0x07,
      interfaceSubclass: 1,
      interfaceProtocol: 2,
      endpoints: [endpoint],
    };
    const iface = {
      interfaceNumber: 0,
      claimed: false,
      alternate,
      alternates: [alternate],
    };
    const configuration = { configurationValue: 1, interfaces: [iface] };

    return {
      vendorId: 0x04b8,
      productId: 0x0e15,
      manufacturerName: "Epson",
      productName: "TM-T82X (uji)",
      serialNumber: "UJI-0001",
      configuration,
      configurations: [configuration],
      opened: false,
      async open() {
        this.opened = true;
        window.__usbLog.push("open");
      },
      async close() {
        this.opened = false;
        window.__usbLog.push("close");
      },
      async selectConfiguration(value) {
        window.__usbLog.push(`selectConfiguration ${value}`);
      },
      async selectAlternateInterface(interfaceNumber, alternateSetting) {
        window.__usbLog.push(`selectAlternate ${interfaceNumber}/${alternateSetting}`);
      },
      async claimInterface(interfaceNumber) {
        iface.claimed = true;
        window.__usbLog.push(`claimInterface ${interfaceNumber}`);
      },
      async releaseInterface(interfaceNumber) {
        iface.claimed = false;
        window.__usbLog.push(`releaseInterface ${interfaceNumber}`);
      },
      async transferOut(endpointNumber, data) {
        window.__usbLog.push(`transferOut ${endpointNumber} ${data.length}`);
        window.__escposBytes.push(...data);
        return { status: "ok", bytesWritten: data.length };
      },
    };
  }

  const usb = {
    devices: [],
    async requestDevice(options) {
      window.__usbRequests += 1;
      window.__usbFilters = options?.filters ?? null;
      const device = createUsbDevice();
      usb.devices.push(device);
      return device;
    },
    async getDevices() {
      // Perilaku peramban: izin yang sudah pernah diberikan tetap terdaftar, jadi
      // sambungan berikutnya tidak perlu memilih perangkat lagi.
      return usb.devices.slice();
    },
    addEventListener() {},
    removeEventListener() {},
  };

  const characteristic = {
    uuid: ESCPOS_USB_WRITE,
    properties: { write: true, writeWithoutResponse: true },
    async writeValueWithoutResponse(data) {
      window.__bleChunks.push(Array.from(data));
      window.__bleBytes.push(...data);
    },
    async writeValueWithResponse(data) {
      window.__bleChunks.push(Array.from(data));
      window.__bleBytes.push(...data);
    },
  };

  const server = {
    connected: false,
    async connect() {
      this.connected = true;
      return this;
    },
    disconnect() {
      this.connected = false;
    },
    async getPrimaryService(uuid) {
      if (uuid !== ESCPOS_USB) throw new DOMException("tak ada layanan", "NotFoundError");
      return {
        uuid,
        async getCharacteristics() {
          return [characteristic];
        },
        async getCharacteristic(target) {
          if (target !== ESCPOS_USB_WRITE) {
            throw new DOMException("tak ada karakteristik", "NotFoundError");
          }
          return characteristic;
        },
      };
    },
    async getPrimaryServices() {
      return [await this.getPrimaryService(ESCPOS_USB)];
    },
  };

  const bluetooth = {
    async requestDevice(options) {
      window.__bleRequest = options ?? null;
      return { id: "uji-ble", name: "Printer Portable Uji", gatt: server };
    },
  };

  Object.defineProperty(navigator, "usb", { configurable: true, get: () => usb });
  Object.defineProperty(navigator, "bluetooth", { configurable: true, get: () => bluetooth });
}

/** Meniru peramban yang tidak punya WebUSB maupun Web Bluetooth (Firefox/Safari). */
function removePrinterApis() {
  Object.defineProperty(navigator, "usb", { configurable: true, value: undefined });
  Object.defineProperty(navigator, "bluetooth", { configurable: true, value: undefined });
  window.__cetakanStruk = 0;
  window.print = () => {
    window.__cetakanStruk += 1;
  };
}

/* ------------------------------------------------------------------ bantuan -- */

/** Satu penjualan tunai lunas, lalu dialog struknya terbuka. */
async function bayarDanBukaStruk(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Cappuccino/ }).first().click();
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  await page.waitForSelector('[data-testid="cash-cepat-100000"]', { timeout: 20_000 });
  await page.locator('[data-testid="cash-cepat-100000"]').click();
  await page.getByRole("button", { name: "Selesaikan pembayaran" }).click();
  await page.waitForSelector('[data-testid="struk-dialog"]', { timeout: 20_000 });
}

const bacaBytes = (page, nama) => page.evaluate((key) => window[key] ?? [], nama);

const browser = await chromium.launch();

try {
  /* ============================ 1. Peramban dengan printer USB & Bluetooth === */

  const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  await context.addInitScript(installFakePrinters);
  await context.addInitScript(
    ([key, value]) => {
      try {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
      } catch {
        // Penyimpanan diblokir: bukan bagian yang diuji di sini.
      }
    },
    [SESSION_KEY, JSON.stringify(sessionFor("enterprise"))],
  );
  await seedShift(context, "shift-escpos-lengkap");

  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await bayarDanBukaStruk(page);
  await page.waitForTimeout(150);

  check(
    "kasir menawarkan sambungan printer di dialog struk, dan belum mengirim apa pun",
    (await page.locator('[data-testid="struk-printer"]').isVisible()) &&
      (await page.locator('[data-testid="struk-printer-belum"]').isVisible()) &&
      (await page.locator('[data-testid="struk-sambungkan"]').isVisible()) &&
      (await page.locator('[data-testid="struk-cetak-langsung"]').isVisible()) &&
      (await page.evaluate(() => window.__escposBytes.length)) === 0 &&
      (await page.evaluate(() => window.__cetakanStruk)) === 0,
    `byte=${await page.evaluate(() => window.__escposBytes.length)} cetak=${await page.evaluate(() => window.__cetakanStruk)}`,
  );

  await page.locator('[data-testid="struk-sambungkan"]').click();
  await page.waitForSelector('[data-testid="struk-printer-nama"]', { timeout: 20_000 });
  const usbLog = await page.evaluate(() => window.__usbLog);
  check(
    "tombol Sambungkan meminta perangkat USB dengan saringan kelas printer & vendor",
    (await page.evaluate(() => window.__usbRequests)) === 1 &&
      JSON.stringify(await page.evaluate(() => window.__usbFilters)) ===
        JSON.stringify([{ classCode: 7 }, { classCode: 255 }]),
    JSON.stringify(await page.evaluate(() => window.__usbFilters)),
  );
  check(
    "perangkatnya dibuka, alternate-nya dipilih, lalu interface-nya di-claim (urutan yang benar)",
    usbLog.join(" | ") === "open | selectAlternate 0/0 | claimInterface 0",
    usbLog.join(" | "),
  );
  check(
    "nama printer yang tersambung tampil di layar kasir",
    (await page.locator('[data-testid="struk-printer-nama"]').innerText()).includes(
      "Epson TM-T82X (uji)",
    ),
    await page.locator('[data-testid="struk-printer-nama"]').innerText(),
  );
  check(
    "menyambung saja belum mencetak apa pun (tidak ada byte & tidak ada dialog cetak)",
    (await page.evaluate(() => window.__escposBytes.length)) === 0 &&
      (await page.evaluate(() => window.__cetakanStruk)) === 0,
    `byte=${await page.evaluate(() => window.__escposBytes.length)}`,
  );

  await page.locator('[data-testid="struk-cetak-langsung"]').click();
  await page.waitForSelector('[data-testid="struk-printer-notice"]', { timeout: 20_000 });
  const bytes = await bacaBytes(page, "__escposBytes");
  const catatan = await page.locator('[data-testid="struk-printer-notice"]').innerText();
  check(
    "struk benar-benar dikirim ke endpoint USB printer, dan **tidak** lewat dialog cetak peramban",
    bytes.length > 200 && (await page.evaluate(() => window.__cetakanStruk)) === 0,
    `${bytes.length} byte dikirim · window.print dipanggil ${await page.evaluate(() => window.__cetakanStruk)}×`,
  );
  check(
    "byte-nya dimulai dengan inisialisasi, halaman kode, dan lebar cetak 80 mm (576 dot)",
    [0x1b, 0x40, 0x1b, 0x74, 0x00, 0x1d, 0x57, 0x40, 0x02].every(
      (value, index) => value === bytes[index],
    ),
    bytes
      .slice(0, 9)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join(" "),
  );
  /*
    Bagian teksnya dipisahkan dari bagian perintah untuk pemeriksaan berikutnya:
    sembilan byte pertama adalah header (inisialisasi, halaman kode, lebar), dan
    sebelas byte terakhir adalah ekor (umpan, potong, pulsa laci) — byte perintah
    memang boleh di atas 0x7e (mis. 0xfa pada pulsa laci), teksnya tidak.
  */
  const EKOR = 11;
  const teksBytes = bytes.slice(9, bytes.length - EKOR);
  check(
    "teks struknya ASCII murni: tidak ada byte di atas 0x7e yang bisa keluar jadi huruf acak",
    teksBytes.every((value) => value === 0x0a || (value >= 0x20 && value <= 0x7e)),
    `${teksBytes.length} byte teks, maks 0x${Math.max(...teksBytes).toString(16)}`,
  );
  const teks = teksBytes.map((value) => String.fromCharCode(value)).join("");
  check(
    "isi struk yang dikirim memuat identitas toko, item, dan TOTAL",
    teks.includes("Warung Uji Struk") &&
      teks.includes("Cappuccino") &&
      teks.includes("TOTAL") &&
      teks.includes("Member : Cash"),
    teks.split("\n").slice(1, 4).join(" / "),
  );
  check(
    "diakhiri umpan, potong kertas, lalu pulsa laci kas (pembayaran tunai)",
    (() => {
      const ekor = bytes.slice(-11).join(",");
      return ekor === [0x1b, 0x64, 0x04, 0x1d, 0x56, 0x00, 0x1b, 0x70, 0x00, 0x19, 0xfa].join(",");
    })(),
    bytes
      .slice(-11)
      .map((value) => value.toString(16).padStart(2, "0"))
      .join(" "),
  );
  check(
    "laporan di layar menyebut jumlah byte yang benar-benar terkirim, bukan klaim kosong",
    catatan.includes(`${bytes.length} byte`) && catatan.includes("Epson TM-T82X (uji)"),
    catatan,
  );

  // ------------------------------------------------ jalur Bluetooth (portabel)
  await page.locator('[data-testid="struk-transport"]').selectOption("bluetooth");
  await page.waitForTimeout(150);
  check(
    "mengganti jalur memutuskan printer sebelumnya dan menunggu sambungan baru",
    (await page.locator('[data-testid="struk-printer-belum"]').count()) === 1 &&
      (await page.locator('[data-testid="struk-sambungkan"]').count()) === 1,
    "jalur Bluetooth siap",
  );
  await page.locator('[data-testid="struk-cetak-langsung"]').click();
  await page.waitForSelector('[data-testid="struk-printer-notice"]', { timeout: 20_000 });
  const bleBytes = await bacaBytes(page, "__bleBytes");
  const bleChunks = await bacaBytes(page, "__bleChunks");
  check(
    "printer Bluetooth diminta dengan semua profil yang dikenal beserta semua layanan lain",
    (await page.evaluate(() => window.__bleRequest))?.acceptAllDevices === true &&
      (await page.evaluate(() => window.__bleRequest))?.optionalServices?.length === 5 &&
      (await page.evaluate(() => window.__bleRequest))?.optionalServices?.includes(
        "49535343-fe7d-4ae5-8fa9-9fafd205e455",
      ),
    JSON.stringify(await page.evaluate(() => window.__bleRequest)),
  );
  check(
    "struk yang sama dikirim lewat karakteristik tulis Bluetooth, byte-nya sama dengan jalur USB",
    bleBytes.length === bytes.length && bleBytes.every((value, index) => value === bytes[index]),
    `${bleBytes.length} byte (` + (bleBytes.length === bytes.length ? "sama" : "BERBEDA") + `)`,
  );
  check(
    "byte Bluetooth dipecah per ≤ 100 byte (MTU BLE kecil), tidak dikirim satu blob",
    bleChunks.length > 1 && bleChunks.every((chunk) => chunk.length > 0 && chunk.length <= 100),
    `${bleChunks.length} potongan, terbesar ${Math.max(...bleChunks.map((chunk) => chunk.length))} byte`,
  );
  check(
    "mencetak lewat Bluetooth juga tidak membuka dialog cetak peramban",
    (await page.evaluate(() => window.__cetakanStruk)) === 0,
    `window.print dipanggil ${await page.evaluate(() => window.__cetakanStruk)}×`,
  );

  // ----------------------------------------------------------- memutuskan lagi
  await page.locator('[data-testid="struk-putuskan"]').click();
  await page.waitForTimeout(150);
  const usbLogSetelahPutus = await page.evaluate(() => window.__usbLog);
  check(
    "tombol Putuskan menutup sambungannya (release + close), dan kasir bisa menyambung lagi kapan pun",
    (await page.locator('[data-testid="struk-printer-belum"]').count()) === 1 &&
      (await page.locator('[data-testid="struk-sambungkan"]').count()) === 1 &&
      usbLogSetelahPutus.slice(-2).join(" | ") === "releaseInterface 0 | close",
    usbLogSetelahPutus.join(" | "),
  );

  // ------------------------------------------------- jalur cadangan tetap ada
  await page.locator('[data-testid="struk-cetak-dialog"]').click();
  check(
    "dialog cetak peramban tetap tersedia sebagai cadangan (dan benar-benar dipanggil sekali)",
    (await page.evaluate(() => window.__cetakanStruk)) === 1,
    `window.print dipanggil ${await page.evaluate(() => window.__cetakanStruk)}×`,
  );
  check(
    "tanpa galat konsol di halaman kasir sepanjang jalur cetak langsung",
    consoleErrors.length === 0,
    consoleErrors.slice(0, 2).join(" | "),
  );

  await context.close();

  /* ========================== 2. Peramban tanpa WebUSB/Web Bluetooth ======= */

  const contextLama = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  await contextLama.addInitScript(removePrinterApis);
  await contextLama.addInitScript(
    ([key, value]) => {
      try {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
      } catch {
        // Penyimpanan diblokir: bukan bagian yang diuji di sini.
      }
    },
    [SESSION_KEY, JSON.stringify(sessionFor("enterprise"))],
  );
  await seedShift(contextLama, "shift-escpos-tanpa-api");
  const pageLama = await contextLama.newPage();
  const galatLama = [];
  pageLama.on("pageerror", (error) => galatLama.push(error.message));

  await bayarDanBukaStruk(pageLama);
  await pageLama.waitForTimeout(150);
  check(
    "peramban tanpa kedua API (Firefox/Safari) tidak menawarkan jalur langsung sama sekali",
    (await pageLama.locator('[data-testid="struk-cetak-langsung"]').count()) === 0 &&
      (await pageLama.locator('[data-testid="struk-printer"]').count()) === 0,
    "tidak ada tombol cetak langsung",
  );
  check(
    "alasannya dikatakan apa adanya: butuh Chrome/Edge, dan dialog cetak peramban jadi jalurnya",
    (await pageLama.locator('[data-testid="struk-tanpa-escpos"]').innerText()).includes("Chrome") &&
      (await pageLama.locator('[data-testid="struk-tanpa-escpos"]').innerText()).includes(
        "dialog cetak peramban",
      ),
    await pageLama.locator('[data-testid="struk-tanpa-escpos"]').innerText(),
  );
  await pageLama.locator('[data-testid="struk-cetak-dialog"]').click();
  check(
    "dan mencetaknya masih bisa: dialog cetak peramban dipanggil sekali",
    (await pageLama.evaluate(() => window.__cetakanStruk)) === 1,
    `window.print dipanggil ${await pageLama.evaluate(() => window.__cetakanStruk)}×`,
  );
  check(
    "peramban tanpa API printer tidak memunculkan galat di konsol",
    galatLama.length === 0,
    galatLama.slice(0, 2).join(" | "),
  );
  await contextLama.close();

  /* ================= 3. Kasir membatalkan/menolak pemilih perangkat ======= */

  /*
    Menutup pemilih perangkat bukan hal langka (salah printer, kabel belum
    tercolok). Yang tidak boleh terjadi: layar diam saja, atau struknya diam-diam
    ikut dikirim ke dialog cetak peramban karena permintaannya gagal.
  */
  const contextBatal = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  await contextBatal.addInitScript(() => {
    Object.defineProperty(navigator, "usb", {
      configurable: true,
      value: {
        async requestDevice() {
          throw new DOMException("No device selected.", "NotFoundError");
        },
        async getDevices() {
          return [];
        },
      },
    });
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: undefined });
    window.__cetakanStruk = 0;
    window.print = () => {
      window.__cetakanStruk += 1;
    };
  });
  await contextBatal.addInitScript(
    ([key, value]) => {
      try {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
      } catch {
        // Penyimpanan diblokir: bukan bagian yang diuji di sini.
      }
    },
    [SESSION_KEY, JSON.stringify(sessionFor("enterprise"))],
  );
  await seedShift(contextBatal, "shift-escpos-batal");
  const pageBatal = await contextBatal.newPage();
  await bayarDanBukaStruk(pageBatal);
  await pageBatal.locator('[data-testid="struk-sambungkan"]').click();
  await pageBatal.waitForSelector('[data-testid="struk-printer-error"]', { timeout: 20_000 });
  check(
    "pemilih perangkat yang ditutup dijelaskan apa adanya (“tidak ada printer USB yang dipilih”)",
    (await pageBatal.locator('[data-testid="struk-printer-error"]').innerText()).includes(
      "Tidak ada printer USB yang dipilih",
    ),
    await pageBatal.locator('[data-testid="struk-printer-error"]').innerText(),
  );
  check(
    "kegagalan menyambung tidak diam-diam mencetak lewat dialog peramban",
    (await pageBatal.evaluate(() => window.__cetakanStruk)) === 0 &&
      (await pageBatal.locator('[data-testid="struk-printer-belum"]').count()) === 1,
    `window.print dipanggil ${await pageBatal.evaluate(() => window.__cetakanStruk)}×`,
  );
  await pageBatal.locator('[data-testid="struk-cetak-dialog"]').click();
  check(
    "sesudah gagal, jalur cadangan tetap bisa dipakai kasir untuk nota itu",
    (await pageBatal.evaluate(() => window.__cetakanStruk)) === 1,
    `window.print dipanggil ${await pageBatal.evaluate(() => window.__cetakanStruk)}×`,
  );
  await contextBatal.close();
} finally {
  await browser.close();
}

console.log(`${results.length}/${results.length} pemeriksaan lulus`);

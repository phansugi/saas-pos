/**
 * Bahasa printer **ESC/POS**: dari dokumen struk yang sudah jadi ke byte yang
 * benar-benar dikirim ke mesin.
 *
 * Kenapa ada: sampai sekarang struk keluar lewat **dialog cetak peramban**, jadi
 * yang mencetak adalah driver sistem, bukan aplikasi ini. Akibatnya ukuran kertas
 * harus ditulis ke lembar gaya (`@page`), kertas faktur tidak bisa dipilih, dan
 * printer portabel Bluetooth tidak bisa dipakai sama sekali karena tidak muncul
 * sebagai printer di sistem. Modul ini menyusun sendiri rangkaian perintah
 * ESC/POS-nya, sehingga yang dikirim ke printer adalah hal yang bisa dibaca,
 * diuji, dan disengaja.
 *
 * Isi modul ini **murni** (tanpa `navigator`, tanpa DOM) karena tiga alasan:
 *
 * 1. aturan byte-nya diuji tanpa peramban (`scripts/verify-escpos.mjs`) — kalau
 *    urutan perintahnya salah, kertas keluarnya kacau, dan itu tidak bisa dites di
 *    uji tampilan mana pun;
 * 2. modul ini ikut dibundel ke Convex (aturan struk yang sama dipakai server &
 *    klien), jadi ia tidak boleh menyentuh API peramban;
 * 3. sambungan ke perangkatnya (WebUSB / Web Bluetooth) hidup di
 *    `src/lib/escposDevice.ts`, jadi bagian yang berisiko itu terpisah dari bagian
 *    yang harus benar.
 *
 * Teks yang dikirim **disaring jadi ASCII** (`escposSafe`). Printer struk murah
 * memakai halaman kode yang berbeda-beda (CP437, CP850, WPC1252) dan yang tidak
 * diatur bisa mengeluarkan huruf acak untuk tanda seperti “ ” · —; karena itu
 * huruf beraksen dibuang aksennya, tanda tipografi dipetakan ke bentuk ASCII-nya,
 * dan sisa karakter di luar jangkauan menjadi `?` — supaya tidak ada byte yang
 * berakhir sebagai huruf acak di kertas.
 *
 * Kejujuran yang perlu diketahui: ini **bukan** jaminan semua printer menerima
 * urutan yang sama. Perintah yang dipakai di sini (ESC @, ESC t, GS W, ESC d,
 * GS v 0, GS V) adalah perintah Epson yang diikuti hampir semua printer struk,
 * tetapi model yang memakai protokol vendornya sendiri (mis. sebagian printer
 * label NIIMBOT/Marklife) tetap butuh perintah khusus yang tidak ada di sini.
 */

import {
  RECEIPT_PRINT_LOGO_MM,
  receiptCols,
  receiptPrinterOf,
  receiptSettingOf,
} from "./struk";
import type {
  ReceiptDocument,
  ReceiptPrinterId,
  ReceiptSetting,
} from "./struk";

// ------------------------------------------------------------- kode kendali --

/** Byte pengenal perintah dua byte: `ESC` (0x1B) dan `GS` (0x1D). */
export const ESC = 0x1b;
export const GS = 0x1d;

/**
 * Lebar satu huruf **font A** ESC/POS, dalam titik (dot).
 *
 * Angka ini yang membuat struk tetap lurus: 58 mm (384 dot di 203 dpi) memuat
 * tepat 32 huruf, 80 mm (576 dot) memuat 48 huruf, 76 mm (40 kolom) 480 dot, dan
 * faktur 241 mm (80 kolom) 960 dot. Itu sebabnya lebar cetak struk dikirim sebagai
 * `GS W` dari jumlah kolom × 12, bukan dari angka millimeter — kolom yang sama
 * dengan yang dipakai menyusun barisnya.
 */
export const ESC_POS_FONT_DOTS = 12;

/** Tinggi satu baris font A, dalam dot (24 dot = 1/8 inci di 203 dpi). */
export const ESC_POS_LINE_DOTS = 24;

/** Umpan sebelum potong/sobek, dalam baris. */
export const ESC_POS_FEED_LINES = 4;

/** Jarak antar lembar rangkap di kertas kontinu (dot matrix), dalam baris. */
export const ESC_POS_COPY_GAP_LINES = 4;

/**
 * Halaman kode yang diminta: **0 = CP437**, halaman bawaan hampir semua printer
 * struk. Karena teksnya sudah disaring jadi ASCII, halaman kode ini hanya
 * berpengaruh pada simbol yang benar-benar dipakai printer itu sendiri.
 */
export const ESC_POS_CODE_PAGE = 0;

/** Resolusi printer struk lazim: 203 dpi ≈ 8 dot per milimeter. */
export const ESC_POS_DOTS_PER_MM = 8;

/** Sisi logo di kertas, dalam milimeter — sama dengan jalur cetak peramban. */
export const ESC_POS_LOGO_MM = RECEIPT_PRINT_LOGO_MM;

/** Sisa ruang di kiri/kanan logo, dalam dot, supaya tidak menempel di tepi kertas. */
export const ESC_POS_LOGO_MARGIN_DOTS = 8;

/**
 * Batas satu kali kirim.
 *
 * USB boleh besar (dokumentasi WebUSB menyarankan pecah per 16 KiB), sedangkan
 * Bluetooth tidak: MTU BLE bawaannya 23 byte sehingga payload aman 20 byte, dan
 * printer yang buffer-nya kecil bisa kacau kalau dikirim terlalu cepat — 100 byte
 * dengan jeda kecil adalah angka yang dipakai banyak implementasi yang dilaporkan
 * berhasil.
 */
export const ESC_POS_USB_CHUNK_BYTES = 16 * 1024;
export const ESC_POS_BLE_CHUNK_BYTES = 100;
export const ESC_POS_BLE_CHUNK_DELAY_MS = 25;

/** Pulsa pembuka laci kas: `ESC p 0 25 250` (pin 2, 25 × 2 ms, 250 × 2 ms). */
export const ESC_POS_DRAWER_PULSE = [ESC, 0x70, 0x00, 0x19, 0xfa];

// ----------------------------------------------------------------- transport --

export type EscposTransport = "usb" | "bluetooth";

export interface EscposTransportInfo {
  id: EscposTransport;
  label: string;
  /** Di mana jalur ini benar-benar tersedia. */
  where: string;
  /** Kalau hal ini tidak ada di peramban, jalur ini mati. */
  api: "usb" | "bluetooth";
}

/**
 * Dua jalur yang bisa dipakai halaman web tanpa memasang apa pun di komputer
 * kasir: kabel USB (WebUSB) dan Bluetooth (Web Bluetooth).
 *
 * **LAN/jaringan tidak ada di sini dengan sengaja.** Printer yang tersambung lewat
 * jaringan memakai TCP port 9100, dan halaman web tidak punya cara membuka socket
 * mentah; menambahkannya berarti memasang program perantara di komputer kasir —
 * hal yang justru ingin dihindari oleh “cetak langsung dari halaman kasir”.
 */
export const ESC_POS_TRANSPORTS: EscposTransportInfo[] = [
  {
    id: "usb",
    label: "USB",
    where: "Chrome/Edge desktop, printer tersambung kabel USB",
    api: "usb",
  },
  {
    id: "bluetooth",
    label: "Bluetooth",
    where: "Chrome/Edge desktop & Chrome Android, printer BLE",
    api: "bluetooth",
  },
];

export function escposTransportOf(id: unknown): EscposTransport {
  return id === "bluetooth" ? "bluetooth" : "usb";
}

export function escposTransportLabel(id: unknown): string {
  return escposTransportOf(id) === "bluetooth" ? "Bluetooth" : "USB";
}

/** Berapa byte sekali kirim untuk satu jalur. */
export function escposChunkBytes(transport: EscposTransport): number {
  return transport === "bluetooth" ? ESC_POS_BLE_CHUNK_BYTES : ESC_POS_USB_CHUNK_BYTES;
}

/** Memecah byte menjadi potongan yang aman dikirim (USB besar, BLE kecil). */
export function escposChunks(bytes: Uint8Array, chunkBytes: number): Uint8Array[] {
  const ukuran = Math.max(1, Math.floor(chunkBytes));
  const hasil: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += ukuran) {
    hasil.push(bytes.slice(offset, Math.min(bytes.length, offset + ukuran)));
  }
  return hasil;
}

// ------------------------------------------------------------- kemampuan mesin --

export interface EscposCapability {
  /** Printer bisa memotong sendiri (`GS V 0`)? */
  cut: boolean;
  /** Menerima logo sebagai raster bitmap (`GS v 0`)? */
  raster: boolean;
  /** Keterangan singkat untuk ditampilkan di layar. */
  note: string;
}

/**
 * Kemampuan yang **berbeda** antar jenis printer, dan karena itu tidak boleh
 * disamakan:
 *
 * - **thermal** punya pemotong otomatis, jadi struknya dipotong setelah dicetak;
 * - **dot matrix** mencetak di kertas faktur/kontinu: dipotong justru merusak
 *   gulungannya, dan karena itu hanya diberi jarak — lembar ASLI & tembusannya
 *   tetap tersambung seperti nota berkarbon;
 * - **portable** umumnya hanya punya tepi sobek, bukan pemotong.
 *
 * Raster logo (`GS v 0`) hanya dikirim ke printer thermal/portable: printer
 * berpita mengurus gambar lewat perintah lain (`ESC *`) yang tidak seragam antar
 * model, dan mengirim raster ke mesin yang tidak mengenalinya bisa mengeluarkan
 * halaman berisi karakter sampah — lebih baik logonya dilewati dan itu dikatakan
 * di layar.
 */
export const ESC_POS_CAPABILITY: Record<ReceiptPrinterId, EscposCapability> = {
  thermal: {
    cut: true,
    raster: true,
    note: "potong otomatis setelah struk",
  },
  dot_matrix: {
    cut: false,
    raster: false,
    note: "kertas kontinu: tidak dipotong, hanya diberi jarak; logo dilewati",
  },
  portable: {
    cut: false,
    raster: true,
    note: "tanpa pemotong: kertas disobek di tepinya",
  },
};

export function escposCapability(printerId: unknown): EscposCapability {
  return ESC_POS_CAPABILITY[receiptPrinterOf(printerId).id];
}

// --------------------------------------------------------------------- teks --

/**
 * Tanda tipografi yang punya bentuk ASCII yang jelas.
 *
 * Dipakai sebelum huruf di luar ASCII dibuang, supaya kalimat seperti “Terima
 * kasih — sampai jumpa” tetap terbaca di kertas, bukan jadi tanda tanya.
 */
const ESC_POS_TYPOGRAPHIC: Record<string, string> = {
  "\u201c": '"',
  "\u201d": '"',
  "\u201e": '"',
  "\u00ab": '"',
  "\u00bb": '"',
  "\u2018": "'",
  "\u2019": "'",
  "\u201a": "'",
  "\u2039": "'",
  "\u203a": "'",
  "\u2013": "-",
  "\u2014": "-",
  "\u2212": "-",
  "\u00b7": "-",
  "\u2022": "*",
  "\u2026": "...",
  "\u00d7": "x",
  "\u00f7": "/",
  "\u00b1": "+/-",
  "\u2264": "<=",
  "\u2265": ">=",
  "\u2260": "!=",
  "\u2192": "->",
  "\u2190": "<-",
  "\u00b0": "o",
  "\u00b5": "u",
  "\u00a9": "(c)",
  "\u00ae": "(R)",
  "\u2122": "(TM)",
  "\u00bd": "1/2",
  "\u00bc": "1/4",
  "\u00be": "3/4",
  "\u00df": "ss",
  "\u00e6": "ae",
  "\u00c6": "AE",
  "\u00f8": "o",
  "\u00d8": "O",
  "\u0111": "d",
  "\u0142": "l",
  "\u00fe": "th",
  "\u00f0": "d",
  "\u20ac": "EUR",
  "\u00a3": "GBP",
  "\u00a5": "JPY",
  "\u20b9": "INR",
  "\u20a9": "KRW",
  "\u00a0": " ",
};

/**
 * Menyaring teks supaya hanya berisi huruf yang pasti dikenali printer:
 * aksen dibuang (`é` → `e`), tanda tipografi dipetakan ke bentuk ASCII, karakter
 * kendali dibuang, dan sisanya menjadi `?`.
 *
 * Baris baru dipertahankan karena di ESC/POS baris baru memang perintah sendiri.
 */
export function escposSafe(text: unknown): string {
  let out = "";
  for (const char of String(text ?? "")) {
    if (char === "\n") {
      out += "\n";
      continue;
    }
    if (char === "\r") continue;
    /*
      Pemetaan tanda tipografi diperiksa **sebelum** aksen dibuang: sebagian
      tanda justru terurai jadi huruf biasa kalau dinormalisasi lebih dulu —
      “≠” (U+2260) terurai menjadi “=” + garis miring penggabung, dan hasilnya
      “=” yang artinya sudah berbeda. Yang dipetakan eksplisit harus menang.
    */
    const peta = ESC_POS_TYPOGRAPHIC[char];
    if (peta !== undefined) {
      out += peta;
      continue;
    }
    const code = char.codePointAt(0) ?? 0x3f;
    if (code < 0x20 || code === 0x7f) {
      // Karakter kendali: tab jadi spasi, sisanya dibuang.
      if (char === "\t") out += " ";
      continue;
    }
    // Huruf beraksen diubah jadi huruf dasarnya (NFD memisahkan aksennya).
    const tanpaAksen = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (tanpaAksen === "") continue;
    out += /^[\x20-\x7e]+$/.test(tanpaAksen) ? tanpaAksen : "?";
  }
  return out;
}

/**
 * Satu baris struk siap kirim: disaring jadi ASCII **lalu dipotong selebar
 * kertasnya**.
 *
 * Pemotongan ini bukan hiasan: penyaringan di atas bisa **memanjangkan** baris
 * (mis. `…` menjadi `...`), sedangkan printer tidak membungkus baris sendiri —
 * baris yang lebih panjang dari kertasnya akan membungkus di tempat yang tidak
 * dipilih siapa pun, dan kolom nominal rata kanannya jadi berantakan. Garis
 * barisnya sudah dihitung `receiptDocument`; di sini tinggal dijaga tetap segitu
 * setelah hurufnya disaring.
 */
export function escposLine(text: unknown, cols: number): string {
  const lebar = Math.max(1, Math.floor(cols));
  return escposSafe(text).slice(0, lebar);
}

/** Lebar area cetak, dalam dot, dari jumlah kolom kertasnya. */
export function escposPrintWidthDots(
  setting: ReceiptSetting | { printerId?: unknown; paperWidthMm?: unknown },
): number {
  return receiptCols(receiptSettingOf(setting as Partial<ReceiptSetting>)) * ESC_POS_FONT_DOTS;
}

/**
 * Sisi logo di kertas, dalam dot.
 *
 * Logo dicetak sebesar di jalur cetak peramban (29 mm, `RECEIPT_PRINT_LOGO_MM`)
 * supaya pemilik toko tidak melihat dua ukuran logo yang berbeda hanya karena
 * notanya keluar dari jalur yang lain — dan dibatasi supaya tetap muat di kertas
 * tersempit (58 mm = 384 dot).
 */
export function escposLogoDots(
  setting: ReceiptSetting | { printerId?: unknown; paperWidthMm?: unknown },
): number {
  const alami = Math.round(ESC_POS_LOGO_MM * ESC_POS_DOTS_PER_MM);
  const muat = escposPrintWidthDots(setting) - ESC_POS_LOGO_MARGIN_DOTS;
  return Math.max(0, Math.min(alami, muat));
}

// -------------------------------------------------------------------- raster --

export interface EscposBitmap {
  /** Lebar bitmap dalam dot — selalu kelipatan 8 (lebar dibulatkan ke atas). */
  widthPx: number;
  heightPx: number;
  /** Satu bit per piksel, baris demi baris, bit kiri = bit paling berarti. */
  data: Uint8Array;
}

/**
 * Memadatkan piksel hitam-putih menjadi bitmap 1 bit untuk `GS v 0`.
 *
 * Lebarnya dibulatkan ke atas ke kelipatan 8 karena perintah raster ESC/POS
 * mengirim lebar dalam **byte**; tanpa pembulatan, baris bitmap berikutnya akan
 * bergeser dan logonya keluar miring.
 */
export function escposPackBitmap(
  widthPx: number,
  heightPx: number,
  isDark: (x: number, y: number) => boolean,
): EscposBitmap {
  const lebar = Math.max(0, Math.floor(widthPx));
  const tinggi = Math.max(0, Math.floor(heightPx));
  const perBaris = Math.ceil(lebar / 8) || 1;
  const data = new Uint8Array(perBaris * tinggi);
  for (let y = 0; y < tinggi; y += 1) {
    for (let x = 0; x < lebar; x += 1) {
      if (!isDark(x, y)) continue;
      data[y * perBaris + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { widthPx: perBaris * 8, heightPx: tinggi, data };
}

/** `GS v 0` (raster bitmap hitam-putih) untuk satu bitmap. */
export function escposRasterCommand(bitmap: EscposBitmap): number[] {
  const lebarByte = bitmap.widthPx / 8;
  return [
    GS,
    0x76,
    0x30,
    0x00,
    lebarByte & 0xff,
    (lebarByte >> 8) & 0xff,
    bitmap.heightPx & 0xff,
    (bitmap.heightPx >> 8) & 0xff,
    ...bitmap.data,
  ];
}

// ------------------------------------------------------------ rangkaian struk --

export interface EscposStep {
  /** Nama langkahnya, dalam bahasa Indonesia — dipakai uji & keterangan layar. */
  label: string;
  bytes: number[];
}

export interface EscposReceiptOptions {
  /** Bitmap logo (dari `escposPackBitmap`); diabaikan kalau mesinnya bukan raster. */
  logo?: EscposBitmap | null;
  /** Kirim pulsa pembuka laci kas sesudah mencetak (untuk pembayaran tunai). */
  openDrawer?: boolean;
}

function asciiBytes(text: string): number[] {
  const out: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    out.push(text.charCodeAt(index) & 0xff);
  }
  return out;
}

/**
 * Seluruh langkah yang dikirim ke printer, satu per satu.
 *
 * Bentuknya daftar bernama (bukan satu tumpukan byte) supaya urutannya bisa
 * diperiksa dan ditampilkan: kalau ada yang salah, yang terlihat bukan “bytes
 * tidak cocok” melainkan langkah mana yang salah.
 */
export function escposReceiptSteps(
  document: ReceiptDocument,
  options: EscposReceiptOptions = {},
): EscposStep[] {
  const capability = escposCapability(document.printer.id);
  const lebar = escposPrintWidthDots({
    printerId: document.printer.id,
    paperWidthMm: document.paper.widthMm,
  });
  const langkah: EscposStep[] = [
    { label: "inisialisasi (ESC @)", bytes: [ESC, 0x40] },
    {
      label: `halaman kode CP437 (ESC t ${ESC_POS_CODE_PAGE})`,
      bytes: [ESC, 0x74, ESC_POS_CODE_PAGE],
    },
    {
      label: `lebar cetak ${lebar} dot (GS W)`,
      bytes: [GS, 0x57, lebar & 0xff, (lebar >> 8) & 0xff],
    },
  ];

  const logo = options.logo ?? null;
  if (logo && capability.raster && logo.heightPx > 0 && logo.widthPx > 0) {
    langkah.push({
      label: `logo ${logo.widthPx}x${logo.heightPx} dot (GS v 0)`,
      bytes: escposRasterCommand(logo),
    });
  }

  document.sheets.forEach((sheet, index) => {
    if (index > 0) {
      langkah.push({
        label: `jarak antar lembar ${ESC_POS_COPY_GAP_LINES} baris (ESC d)`,
        bytes: [ESC, 0x64, ESC_POS_COPY_GAP_LINES],
      });
    }
    const teks = `${sheet.lines.map((line) => escposLine(line, document.cols)).join("\n")}\n`;
    langkah.push({
      label: `teks lembar ${sheet.copyIndex + 1} (${sheet.lines.length} baris)`,
      bytes: asciiBytes(teks),
    });
  });

  langkah.push({
    label: `umpan ${ESC_POS_FEED_LINES} baris (ESC d)`,
    bytes: [ESC, 0x64, ESC_POS_FEED_LINES],
  });
  langkah.push(
    capability.cut
      ? { label: "potong kertas (GS V 0)", bytes: [GS, 0x56, 0x00] }
      : { label: `tanpa potong: ${capability.note}`, bytes: [] },
  );
  if (options.openDrawer) {
    langkah.push({ label: "buka laci kas (ESC p 0 25 250)", bytes: ESC_POS_DRAWER_PULSE });
  }
  return langkah;
}

/**
 * Seluruh byte satu kali cetak.
 *
 * Deterministik: masukan yang sama menghasilkan byte yang sama, jadi harness bisa
 * memeriksanya byte per byte — dan kasir yang mencetak ulang nota yang sama
 * benar-benar mengirim hal yang sama ke printer.
 */
export function escposReceiptBytes(
  document: ReceiptDocument,
  options: EscposReceiptOptions = {},
): Uint8Array {
  const langkah = escposReceiptSteps(document, options);
  const total = langkah.reduce((sum, step) => sum + step.bytes.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const step of langkah) {
    out.set(step.bytes, cursor);
    cursor += step.bytes.length;
  }
  return out;
}

// ----------------------------------------------------------------- sambungan --

export interface EscposBleProfile {
  service: string;
  characteristic: string;
  label: string;
  note: string;
}

/**
 * Profil GATT Bluetooth yang beredar pada printer struk ESC/POS.
 *
 * Ini **daftar percobaan**, bukan daftar dukungan: Web Bluetooth hanya boleh
 * menyentuh layanan yang dicantumkan saat meminta izin, jadi kelimanya
 * didaftarkan (`optionalServices`) lalu aplikasi mencoba satu per satu dan
 * memakai karakteristik tulis pertama yang benar-benar ada. UUID menentukan kanal
 * komunikasinya, bukan bahasa cetaknya: sebagian perangkat di keluarga yang sama
 * memakai protokol vendor sendiri, dan itu memang tidak bisa ditangani di sini
 * (printer seperti itu tetap bisa dicetak lewat dialog cetak peramban).
 */
export const ESC_POS_BLE_PROFILES: EscposBleProfile[] = [
  {
    service: "49535343-fe7d-4ae5-8fa9-9fafd205e455",
    characteristic: "49535343-8841-43f4-a8d4-ecbe34729bb3",
    label: "ISSC / Microchip UART",
    note: "jalur UART transparan; dilaporkan berhasil pada printer 58 mm (YHK, GOOJPRT PT-210)",
  },
  {
    service: "000018f0-0000-1000-8000-00805f9b34fb",
    characteristic: "00002af1-0000-1000-8000-00805f9b34fb",
    label: "18F0 / 2AF1",
    note: "dipakai GOOJPRT PT-210 & beberapa printer AiYin",
  },
  {
    service: "0000ff00-0000-1000-8000-00805f9b34fb",
    characteristic: "0000ff02-0000-1000-8000-00805f9b34fb",
    label: "FF00 / FF02",
    note: "keluarga printer portabel Marklife/Phomemo — sebagian memakai protokol sendiri",
  },
  {
    service: "0000ffe0-0000-1000-8000-00805f9b34fb",
    characteristic: "0000ffe1-0000-1000-8000-00805f9b34fb",
    label: "HM-10 / CC254x UART",
    note: "modul UART generik pada printer thermal 58 mm & 80 mm",
  },
  {
    service: "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
    characteristic: "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f",
    label: "NIIMBOT",
    note: "umum pada printer NIIMBOT; biasanya protokol vendor, bukan ESC/POS standar",
  },
];

/** UUID layanan yang diminta izinnya ke peramban (tanpa duplikat). */
export const ESC_POS_BLE_OPTIONAL_SERVICES: string[] = [
  ...new Set(ESC_POS_BLE_PROFILES.map((profile) => profile.service)),
];

/**
 * Saringan pemilih perangkat USB.
 *
 * USB printer berkelas `0x07`, tetapi banyak printer struk melaporkan dirinya
 * sebagai vendor-specific (`0xFF`) — karena itu keduanya didaftarkan. Nilai di
 * dalam satu saringan harus cocok semua, sedangkan beberapa saringan berarti
 * “salah satu boleh”.
 */
export const ESC_POS_USB_FILTERS: { classCode: number }[] = [
  { classCode: 0x07 },
  { classCode: 0xff },
];

export interface EscposSupport {
  usb: boolean;
  bluetooth: boolean;
  supported: boolean;
  /** Kalimat yang bisa langsung ditampilkan kalau tidak ada jalur yang hidup. */
  reason: string;
}

/** Keadaan dukungan peramban, dihitung dari ada/tidaknya API-nya. */
export function escposSupport(hasUsb: boolean, hasBluetooth: boolean): EscposSupport {
  const supported = hasUsb || hasBluetooth;
  return {
    usb: hasUsb,
    bluetooth: hasBluetooth,
    supported,
    reason: supported
      ? ""
      : "Peramban ini tidak menyediakan WebUSB maupun Web Bluetooth, jadi struk " +
        "hanya bisa keluar lewat dialog cetak peramban. Untuk cetak langsung, buka " +
        "halaman ini di Chrome atau Edge (desktop untuk USB & Bluetooth, Android " +
        "untuk Bluetooth).",
  };
}

/**
 * Terjemahan galat sambungan jadi kalimat yang bisa ditindaklanjuti kasir.
 *
 * `name` adalah `DOMException.name` dari peramban — nilainya berbeda-beda antar
 * API, dan justru perbedaan itu yang memberi tahu apa yang harus dikerjakan
 * (pilih perangkat, izinkan, pakai HTTPS, atau cabut-nyambung kabel).
 */
export function escposErrorMessage(name: string, transport: EscposTransport): string {
  const jalur = escposTransportLabel(transport);
  switch (name) {
    case "NotFoundError":
      return `Tidak ada printer ${jalur} yang dipilih.`;
    case "NotAllowedError":
      return `Izin ke printer ${jalur} ditolak peramban atau belum diberikan.`;
    case "SecurityError":
      return (
        "Peramban menolak permintaan ini karena halaman bukan HTTPS atau tombolnya " +
        "bukan ditekan langsung oleh kasir."
      );
    case "NetworkError":
      return `Peramban gagal menyambung ke printer ${jalur}: mesinnya tidak menjawab.`;
    case "InvalidStateError":
    case "InvalidState":
      return "Printer sudah dipakai sambungan lain — cabut dan sambungkan ulang.";
    case "NotSupportedError":
      return `Printer ${jalur} ini tidak menyediakan jalur tulis yang dikenali (kemungkinan memakai protokol vendornya sendiri).`;
    case "TimeoutError":
      return `Printer ${jalur} tidak menjawab dalam batas waktu.`;
    case "AbortError":
      return "Sambungan ke printer dibatalkan.";
    default:
      return name
        ? `Gagal menyambung ke printer ${jalur} (${name}).`
        : `Gagal menyambung ke printer ${jalur}.`;
  }
}

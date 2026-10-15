/**
 * Berkas **PDF** struk belanja: tata letaknya di halaman dan byte PDF-nya.
 *
 * Kenapa ada: struk tidak selalu bisa langsung keluar dari printer. Kasir sering
 * diminta mengirim notanya — ke WhatsApp pembeli, ke email, atau ke arsip pemilik
 * toko — dan dialog cetak peramban tidak bisa dipakai untuk itu karena isinya
 * harus disimpan dulu sebagai berkas. Modul ini membuat berkasnya **di perangkat
 * kasir**, dari teks struk yang sama dengan yang keluar di kertas.
 *
 * Empat keputusan yang sengaja diambil:
 *
 * 1. **Berkasnya dibuat dari teks struk yang sudah ada**, bukan dari tata letak
 *    kedua. Sumbernya `@/lib/struk` (`sheet.lines`): baris yang sama, lebar kolom
 *    yang sama, penanda rangkap yang sama. Kalau setelan struk berubah, PDF-nya
 *    ikut berubah tanpa ada tata letak lain yang perlu dijaga bersamaan.
 * 2. **Satu halaman per lembar.** Printer dot matrix mengeluarkan dua lembar
 *    (ASLI + tembusan) yang di kertas memang terpisah; PDF yang menumpuk keduanya
 *    jadi satu halaman akan membuat penerimanya mencetak satu lembar berisi dua
 *    struk.
 * 3. **Ukuran halamannya selebar kertasnya**, tinggi mengikuti jumlah barisnya.
 *    PDF 58 mm × 40 mm bisa langsung dicetak ke printer struk tanpa dipaskan lagi,
 *    dan tidak ada halaman kosong di bawah struk yang cuma berisi beberapa baris.
 * 4. **Penulis PDF-nya sendiri, bukan pustaka.** Berkas ini harus bisa dibuat di
 *    peramban kasir **dan** diuji tanpa peramban; satu berkas struk hanya butuh
 *    teks satu jenis huruf pada satu halaman, jadi menulis objek, xref, dan trailer
 *    PDF langsung di sini jauh lebih kecil daripada membawa mesin PDF beserta
 *    penyemat hurufnya ke bundel kasir.
 */

/*
  Impor ini **relatif**, bukan lewat `@/`: berkas ini dipanggil langsung oleh
  harness murni (`bun scripts/verify-struk-pdf.mjs`), dan di sana alias `@/`
  tidak dikenali — sama seperti modul murni lain di `src/convex/lib` yang saling
  mengimpor secara relatif.
*/
import { RECEIPT_PRINT_LOGO_MM } from "../convex/lib/struk";
import type { ReceiptDocument } from "../convex/lib/struk";

/** 1 inci = 72 poin; 1 mm = 72/25.4 poin. Satuan PDF adalah poin. */
const PT_PER_MM = 72 / 25.4;

/** Margin kiri/kanan/atas/bawah halaman, dalam poin (≈ 2 mm). */
export const RECEIPT_PDF_MARGIN_PT = 6;

/**
 * Batas ukuran huruf, dalam poin.
 *
 * Batas atas 9 pt = ukuran huruf struk thermal yang nyaman dibaca; batas bawah
 * 4,5 pt membuat kertas faktur 241 mm dengan 80 kolom tetap muat tanpa huruf yang
 * saling menempel.
 */
export const RECEIPT_PDF_MAX_FONT_PT = 9;
export const RECEIPT_PDF_MIN_FONT_PT = 4.5;

/** Jarak antar baris dibanding ukuran hurufnya (1,32 = enak dibaca, hemat kertas). */
export const RECEIPT_PDF_LINE_RATIO = 1.32;

/** Jenis huruf PDF yang dipakai: monospace, sama seperti pratinjau struk. */
export const RECEIPT_PDF_FONT = "Courier";

/** Lebar satu karakter Courier relatif terhadap ukuran hurufnya. */
const COURIER_ADVANCE = 0.6;

/** Nama pembuat berkas yang ditulis di `/Info`. */
export const RECEIPT_PDF_PRODUCER = "MesinPOS";

/**
 * Logo toko yang **siap ditempel**: satu byte keabuan per piksel (0 = hitam,
 * 255 = putih), baris paling atas lebih dulu.
 *
 * Bentuknya begitu karena modul ini **murni** — tanpa `canvas`, tanpa `Image`,
 * tanpa jaringan — sehingga bisa diuji tanpa peramban dan tetap deterministik.
 * Yang mengubah gambar jadi byte keabuan adalah peramban kasir
 * (`@/lib/receiptLogoRaster`), dan ia yang menyiapkan ukurannya.
 */
export interface ReceiptPdfLogo {
  width: number;
  height: number;
  gray: Uint8Array;
}

/**
 * Tinggi pita logo di halaman PDF, dalam poin — **sama** dengan tinggi logo di
 * kertas struk (`RECEIPT_PRINT_LOGO_MM`, 29,11 mm): berkas PDF dan kertas yang
 * keluar dari printer bukan dua dokumen yang berbeda, jadi logo yang mendorong
 * baris-baris struk di kertas juga mendorongnya di PDF.
 */
export const RECEIPT_PDF_LOGO_PT = RECEIPT_PRINT_LOGO_MM * PT_PER_MM;

/**
 * Ukuran raster logo yang diminta dari peramban, dalam piksel (sisi panjang).
 *
 * Sekitar **dua kali** ukuran cetaknya (82,5 pt ≈ 110 px): cukup tajam untuk
 * dilihat di layar ponsel, tetapi berkasnya tetap jauh di bawah batas unggah
 * WhatsApp (1 byte keabuan per piksel = ± 48 KB di ukuran ini, dan gambarnya
 * hanya disimpan **sekali** walau lembar rangkapnya dua).
 */
export const RECEIPT_PDF_LOGO_RASTER_PX = 220;

/** Apakah logo ini bisa dipakai: ukurannya masuk akal & byte-nya lengkap. */
function receiptPdfLogoOk(logo: ReceiptPdfLogo | null | undefined): boolean {
  if (!logo) return false;
  const { width, height, gray } = logo;
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    gray.length === width * height
  );
}

export interface ReceiptPdfLayout {
  /** Lebar halaman, dalam poin — selebar kertas struknya. */
  widthPt: number;
  /** Tinggi halaman, dalam poin — mengikuti jumlah barisnya (+ pita logonya). */
  heightPt: number;
  marginPt: number;
  fontSizePt: number;
  leadingPt: number;
  /** Lebar kolom teks (jumlah karakter per baris) dari aturan struk. */
  cols: number;
  /** Jumlah baris terbanyak di antara lembarnya. */
  lines: number;
  /** Tinggi pita logo di atas teks, dalam poin; 0 kalau tanpa logo. */
  logoBandPt: number;
  /** Ukuran logo yang benar-benar digambar (sudah dimuatkan ke pita), dalam poin. */
  logoWidthPt: number;
  logoHeightPt: number;
}

/** Bagian struk yang dibutuhkan pembuat PDF (sisanya urusan layar). */
export type ReceiptPdfSource = Pick<ReceiptDocument, "paper" | "cols" | "sheets">;

/** Pilihan tambahan saat menyusun PDF: judul berkas & logo toko. */
export interface ReceiptPdfOptions {
  /** Judul di dalam berkas (`/Info`), mis. nomor notanya. */
  title?: string;
  /** Logo toko; ukuran/byte yang tidak masuk akal diabaikan, bukan menggagalkan struk. */
  logo?: ReceiptPdfLogo | null;
}

/**
 * Ukuran halaman & huruf untuk satu dokumen struk.
 *
 * Ukuran hurufnya dihitung dari kolomnya: huruf harus muat `cols` karakter pada
 * lebar kertas yang tersisa setelah margin, jadi semua lebar kertas memakai
 * proporsi yang sama dan tidak ada baris yang terpotong di tepi kanan.
 */
export function receiptPdfLayout(
  document: ReceiptPdfSource,
  options: { logo?: ReceiptPdfLogo | null } = {},
): ReceiptPdfLayout {
  const widthPt = document.paper.widthMm * PT_PER_MM;
  const cols = Math.max(1, document.cols);
  const usable = Math.max(1, widthPt - 2 * RECEIPT_PDF_MARGIN_PT);
  const fontSizePt = Math.min(
    RECEIPT_PDF_MAX_FONT_PT,
    Math.max(RECEIPT_PDF_MIN_FONT_PT, usable / (COURIER_ADVANCE * cols)),
  );
  const leadingPt = fontSizePt * RECEIPT_PDF_LINE_RATIO;
  const lines = Math.max(
    1,
    ...document.sheets.map((sheet) => sheet.lines.length),
  );

  /*
    Logo dimuatkan ke kotak persegi setinggi pitanya (`contain`, sama seperti
    `object-contain` di layar & di kertas): rasio gambarnya tidak diubah, dan
    logo yang lebar tetap berada di dalam kertas sempit 58 mm.
  */
  const logo = receiptPdfLogoOk(options.logo) ? options.logo! : null;
  const band = logo ? RECEIPT_PDF_LOGO_PT : 0;
  const skala = logo
    ? Math.min(band / logo.width, band / logo.height)
    : 0;

  return {
    widthPt,
    heightPt: 2 * RECEIPT_PDF_MARGIN_PT + band + lines * leadingPt,
    marginPt: RECEIPT_PDF_MARGIN_PT,
    fontSizePt,
    leadingPt,
    cols,
    lines,
    logoBandPt: band,
    logoWidthPt: logo ? logo.width * skala : 0,
    logoHeightPt: logo ? logo.height * skala : 0,
  };
}

/**
 * Sisi depan nama berkas struk, tanpa ekstensi: `struk-A-00042`.
 *
 * Dipakai bersama oleh berkas PDF (`receiptPdfFileName`) dan gambar struk
 * (`@/lib/receiptImage`) supaya dua berkas dari penjualan yang sama punya nama
 * berpasangan — di folder unduhan & di percakapan WhatsApp orang mencari nomor
 * notanya, bukan nama berkas yang berbeda-beda.
 *
 * Nomor notanya dipakai kalau ada, karena itulah yang dicari orang; kalau
 * nomornya belum ada (struk sementara), waktunya yang dipakai supaya dua berkas
 * tidak saling menimpa.
 */
export function receiptFileNameStem(input: {
  number?: string | null;
  now?: Date;
}): string {
  const nomor = sanitizeFilePart(input.number ?? "");
  if (nomor !== "") return `struk-${nomor}`;
  return `struk-${stamp(input.now ?? new Date())}`;
}

/** Nama berkas PDF: `struk-A-00042.pdf`. */
export function receiptPdfFileName(input: {
  number?: string | null;
  now?: Date;
}): string {
  return `${receiptFileNameStem(input)}.pdf`;
}

function sanitizeFilePart(raw: string): string {
  return raw
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `20261013-1430` — urut secara abjad sama seperti urut waktu. */
function stamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

/** Membuang karakter kendali dan memetakan huruf di luar Latin-1 jadi `?`. */
function pdfSanitize(text: string): string {
  const bersih = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  let out = "";
  for (const char of bersih) {
    const code = char.codePointAt(0) ?? 63;
    // Huruf dengan huruf dasar di Latin-1 (mis. “é”) tetap dibaca; yang di luar
    // jangkauan huruf PDF standar diganti tanda tanya supaya berkasnya tidak rusak.
    out += code <= 255 ? String.fromCharCode(code) : "?";
  }
  return out;
}

/** Karakter yang mengakhiri/menutup string di dalam PDF harus di-escape. */
function pdfEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/** Angka PDF tanpa notasi eksponen dan tanpa nol berekor. */
function num(value: number): string {
  return String(Number(value.toFixed(3)));
}

/**
 * Byte gambar jadi string **Latin-1** — bentuk yang dipakai seluruh perakitan
 * berkas ini (setiap karakter = satu byte, jadi offset xref bisa dihitung dari
 * panjang string). Dipotong 32 KB sekali jalan supaya tidak menjebol tumpukan
 * lewat `String.fromCharCode(...)` dengan ratusan ribu argumen.
 */
function latin1FromBytes(bytes: Uint8Array): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return out;
}

/**
 * Isi aliran halaman: gambar logonya (kalau ada) di pita atas, lalu baris-baris
 * struk, satu `Tj` per baris.
 *
 * Logonya digambar lebih dulu dengan matriks `cm` (lebar 0 0 tinggi x y), lalu
 * teksnya dimulai di bawah pita itu — jadi tidak ada baris yang tertimpa gambar,
 * dan tinggi halaman yang sudah dihitung `receiptPdfLayout` memang cukup.
 */
function receiptPdfContent(
  lines: readonly string[],
  layout: ReceiptPdfLayout,
  imageObject?: number,
): string {
  const isi: string[] = [];
  if (imageObject !== undefined && layout.logoWidthPt > 0 && layout.logoHeightPt > 0) {
    const x = (layout.widthPt - layout.logoWidthPt) / 2;
    const y =
      layout.heightPt -
      layout.marginPt -
      layout.logoBandPt +
      (layout.logoBandPt - layout.logoHeightPt) / 2;
    isi.push(
      "q",
      `${num(layout.logoWidthPt)} 0 0 ${num(layout.logoHeightPt)} ${num(x)} ${num(y)} cm`,
      "/Logo Do",
      "Q",
    );
  }
  isi.push(
    "BT",
    `/F1 ${num(layout.fontSizePt)} Tf`,
    `${num(layout.leadingPt)} TL`,
    `1 0 0 1 ${num(layout.marginPt)} ${num(
      layout.heightPt - layout.marginPt - layout.logoBandPt - layout.fontSizePt,
    )} Tm`,
  );
  const baris = lines.length > 0 ? lines : [""];
  baris.forEach((line, index) => {
    // Dipotong di kolomnya: baris struk seharusnya sudah selebar itu, dan kalau
    // ada yang lebih panjang, teks yang meluber ke luar kertas lebih buruk
    // daripada satu baris yang dipotong.
    const teks = pdfSanitize(line).slice(0, layout.cols);
    if (index > 0) isi.push("T*");
    isi.push(`(${pdfEscape(teks)}) Tj`);
  });
  isi.push("ET");
  return isi.join("\n");
}

/**
 * Byte berkas PDF untuk satu dokumen struk.
 *
 * Hasilnya **deterministik** untuk masukan yang sama (tidak ada tanggal dibuat
 * atau id acak di dalamnya): dua kali membuat struk yang sama menghasilkan berkas
 * yang sama, dan harness bisa membandingkannya byte per byte.
 */
export function receiptPdfBytes(
  document: ReceiptPdfSource,
  options: ReceiptPdfOptions = {},
): Uint8Array {
  const logo = receiptPdfLogoOk(options.logo) ? options.logo! : null;
  const layout = receiptPdfLayout(document, { logo });
  const sheets =
    document.sheets.length > 0
      ? document.sheets
      : [{ copyIndex: 0, copyLabel: "", lines: [] as string[] }];

  // Nomor objek: 1 katalog, 2 daftar halaman, 3 huruf, lalu dua objek per lembar
  // (halaman + isinya), lalu info berkas, dan paling akhir gambar logonya.
  //
  // Logonya ditaruh **di akhir** supaya penomoran yang sudah ada tidak bergeser,
  // dan ia dipakai bersama oleh semua halaman: lembar rangkap tidak menggandakan
  // gambarnya, jadi berkas dua lembar pun cuma membawa satu salinan logo.
  const fontObject = 3;
  const pageObjects = sheets.map((_sheet, index) => 4 + index * 2);
  const contentObjects = sheets.map((_sheet, index) => 5 + index * 2);
  const infoObject = 4 + sheets.length * 2;
  const logoObject = logo ? infoObject + 1 : null;

  const bodies: string[] = [];
  bodies.push("<< /Type /Catalog /Pages 2 0 R >>");
  bodies.push(
    `<< /Type /Pages /Kids [${pageObjects
      .map((number) => `${number} 0 R`)
      .join(" ")}] /Count ${sheets.length} >>`,
  );
  bodies.push(
    `<< /Type /Font /Subtype /Type1 /BaseFont /${RECEIPT_PDF_FONT} /Encoding /WinAnsiEncoding >>`,
  );

  const resources =
    logoObject === null
      ? `/Resources << /Font << /F1 ${fontObject} 0 R >> >>`
      : `/Resources << /Font << /F1 ${fontObject} 0 R >> /XObject << /Logo ${logoObject} 0 R >> >>`;

  sheets.forEach((sheet, index) => {
    const content = receiptPdfContent(sheet.lines, layout, logoObject ?? undefined);
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(layout.widthPt)} ${num(
        layout.heightPt,
      )}] ${resources} /Contents ${contentObjects[index]} 0 R >>`,
    );
    // `/Length` harus sama dengan jumlah byte di antara `stream` dan `endstream`;
    // karena seluruh berkas ini Latin-1, panjang string = panjang byte.
    bodies.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  const title = pdfSanitize(options.title ?? "Struk belanja");
  bodies.push(
    `<< /Producer (${pdfEscape(pdfSanitize(RECEIPT_PDF_PRODUCER))}) /Title (${pdfEscape(title)}) >>`,
  );

  /*
    Gambar logonya: satu byte keabuan per piksel, **tanpa pemadatan** — penulis
    PDF ini tidak membawa pustaka pemadatan, dan ukuran yang diminta peramban
    sudah kecil (± 48 KB pada 220 px, dan hanya sekali per berkas).
  */
  if (logo && logoObject !== null) {
    bodies.push(
      `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height}` +
        ` /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${logo.gray.length} >>\n` +
        `stream\n${latin1FromBytes(logo.gray)}\nendstream`,
    );
  }

  // Berkas dirakit sebagai string Latin-1 supaya offset xref bisa dihitung dari
  // panjang string — offset di xref adalah posisi **byte**, dan di sini keduanya
  // kebetulan sama karena setiap karakter tepat satu byte.
  let out = "%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n";
  const offsets: number[] = [];
  bodies.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const startxref = out.length;
  const size = bodies.length + 1;
  out += `xref\n0 ${size}\n`;
  out += "0000000000 65535 f \n";
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${size} /Root 1 0 R /Info ${infoObject} 0 R >>\n`;
  out += `startxref\n${startxref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let index = 0; index < out.length; index += 1) {
    bytes[index] = out.charCodeAt(index) & 0xff;
  }
  return bytes;
}

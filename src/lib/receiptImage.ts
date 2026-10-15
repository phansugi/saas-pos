/*
  Struk sebagai **satu gambar** (PNG) — bukan berkas PDF, bukan teks.

  Kenapa ada: di Android, lembar bagikan yang membawa **dua berkas berbeda tipe**
  (PDF + logo PNG) diserahkan ke aplikasi penerima sebagai satu intent bertipe
  **umum** — begitu Chrome menyusunnya (`ACTION_SEND_MULTIPLE`, tipe MIME-nya jadi
  “apa saja” kalau tipe berkasnya berbeda). WhatsApp bisa mengambil berkas
  pertamanya saja, jadi logonya tidak terlihat walaupun aplikasi sudah
  menyerahkannya. Satu berkas **gambar** menutup celah itu dari akarnya: tipe
  intent-nya `image/png`, WhatsApp selalu menampilkannya sebagai foto, dan logonya
  sudah berada **di dalam** gambarnya, di atas nama usaha — bukan berkas kedua yang
  bisa tercecer di perjalanan.

  Modul ini **murni** — tanpa `canvas`, tanpa `Image`, tanpa jaringan — sehingga
  ukuran gambarnya bisa diuji tanpa peramban dan hasilnya sama di mana pun. Yang
  benar-benar menggambar adalah `@/lib/receiptImageRaster` di peramban kasir, dan
  di sanalah ukuran hurufnya dicocokkan dengan huruf yang ada di perangkat itu.
*/
/*
  Impor ini **relatif**, bukan lewat `@/`: berkas ini dipanggil langsung oleh
  harness murni (`bun scripts/verify-struk-gambar.mjs`), dan di sana alias `@/`
  tidak dikenali — sama seperti modul murni lain di `src/convex/lib`.
*/
import type { ReceiptDocument } from "../convex/lib/struk";
import { receiptFileNameStem } from "./receiptPdf";

/**
 * Skala gambar: 14 piksel per milimeter kertas.
 *
 * Struk 58 mm jadi 812 px — selebar foto yang nyaman dibuka di ponsel, dan teks
 * struknya (± 30 px) tetap terbaca tanpa mencubit layar. Ukuran ini dipilih dari
 * **pembacaannya**, bukan dari ukuran cetaknya: yang mengirim gambar ini adalah
 * orang yang sedang berdiri di depan pembeli memegang HP.
 */
export const RECEIPT_IMAGE_PX_PER_MM = 14;

/**
 * Lebar gambar paling besar. Kertas faktur 241 mm sekaligus 80 kolom akan jadi
 * gambar 3.374 px — jauh lebih besar daripada yang bisa dibaca di ponsel, dan
 * berkasnya hanya membebani kiriman WhatsApp.
 */
export const RECEIPT_IMAGE_MAX_WIDTH_PX = 1400;

/** Jarak tepi gambar ke kertas & antar lembar rangkap, dalam piksel. */
export const RECEIPT_IMAGE_GAP_PX = 14;

/** Jarak tepi kertas ke isinya, dalam piksel. */
export const RECEIPT_IMAGE_PAD_PX = 16;

/**
 * Sisi kotak logo di atas nama usaha, dalam piksel.
 *
 * Bukan pita 29,11 mm milik kertas (`RECEIPT_PRINT_LOGO_MM`): gambar ini untuk
 * dilihat di layar, jadi logonya punya tempat sendiri yang lebih lega daripada
 * garis tipis di kertas termal — dan tetap muat di kertas tersempit.
 */
export const RECEIPT_IMAGE_LOGO_PX = 140;

/** Jarak antar baris dibanding ukuran hurufnya — sama seperti struk di kertas & PDF. */
export const RECEIPT_IMAGE_LINE_RATIO = 1.32;

/** Huruf monospace: kolom-kolom struk (nominal rata kanan) butuh lebar tetap. */
export const RECEIPT_IMAGE_FONT = '"Courier New", Courier, monospace';

/** Lebar satu karakter relatif terhadap ukuran hurufnya (Courier/monospace). */
export const RECEIPT_IMAGE_ADVANCE_RATIO = 0.6;

/** Batas bawah ukuran huruf: kertas banyak kolom tetap terbaca, bukan jadi titik-titik. */
export const RECEIPT_IMAGE_MIN_FONT_PX = 7;

/** Latar di luar kertas — abu-abu sangat muda, sama seperti foto struk di layar. */
export const RECEIPT_IMAGE_BG = "#eef1f5";

/** Warna teks struk di dalam gambarnya. */
export const RECEIPT_IMAGE_INK = "#111827";

/** Bagian struk yang dibutuhkan: kertasnya, jumlah kolomnya, dan lembarnya. */
export type ReceiptImageSource = Pick<ReceiptDocument, "paper" | "cols" | "sheets">;

export interface ReceiptImageLayout {
  /** Lebar seluruh gambar, dalam piksel. */
  widthPx: number;
  /** Tinggi seluruh gambar (semua lembar + jarak antar & tepinya), dalam piksel. */
  heightPx: number;
  gapPx: number;
  padPx: number;
  /** Lebar satu lembar kertas di dalam gambar. */
  sheetWidthPx: number;
  /** Lebar yang benar-benar bisa dipakai teks (setelah tepi kertas). */
  usablePx: number;
  /** Jumlah lembar yang digambar (rangkap printer). */
  sheetCount: number;
  /** Tinggi satu lembar. */
  sheetHeightPx: number;
  fontSizePx: number;
  lineHeightPx: number;
  cols: number;
  /** Jumlah baris terbanyak di antara lembarnya. */
  lines: number;
  /** Tinggi pita logo di atas teks, dalam piksel; 0 kalau tanpa logo. */
  logoBandPx: number;
  /** Ukuran logo yang benar-benar digambar (rasio tetap, muat di kotak & kertas). */
  logoWidthPx: number;
  logoHeightPx: number;
}

/**
 * Tata letak gambar struk: ukuran kanvas, ukuran kertas, dan posisi tiap bagian.
 *
 * Ukuran hurufnya dihitung dari jumlah kolom, **bukan** ditetapkan: struk 32 kolom
 * dan 80 kolom harus sama-sama memakai seluruh lebar kertasnya, seperti di kertas
 * yang sesungguhnya. Pemanggil boleh menyerahkan `advanceRatio` hasil pengukuran
 * huruf di perangkatnya (`receiptImageRaster`) — dipakai kalau huruf di sana lebih
 * lebar daripada perkiraan, supaya tidak ada baris yang terpotong di tepi kanan.
 */
export function receiptImageLayout(
  struk: ReceiptImageSource,
  options: { logo?: { width: number; height: number } | null; advanceRatio?: number } = {},
): ReceiptImageLayout {
  const cols = Math.max(1, struk.cols);
  const gapPx = RECEIPT_IMAGE_GAP_PX;
  const padPx = RECEIPT_IMAGE_PAD_PX;
  const widthPx = Math.min(
    RECEIPT_IMAGE_MAX_WIDTH_PX,
    Math.max(1, Math.round(struk.paper.widthMm * RECEIPT_IMAGE_PX_PER_MM)),
  );
  const sheetWidthPx = Math.max(1, widthPx - 2 * gapPx);
  const usablePx = Math.max(1, sheetWidthPx - 2 * padPx);

  const advance =
    options.advanceRatio && options.advanceRatio > 0
      ? options.advanceRatio
      : RECEIPT_IMAGE_ADVANCE_RATIO;
  /*
    Ukuran huruf & jarak barisnya **bilangan bulat**: kanvas tidak bisa selebar
    805,85 px — ukuran yang bukan bilangan bulat dipangkas diam-diam oleh peramban,
    dan gambar yang digambar untuk tinggi yang berbeda dari ukuran kanvasnya akan
    memotong lembar terakhirnya. Pembaginya dibulatkan **ke bawah** supaya teks
    selebar `cols` kolom tidak pernah melebihi kertasnya.
  */
  const fontSizePx = Math.max(
    RECEIPT_IMAGE_MIN_FONT_PX,
    Math.floor(usablePx / (advance * cols)),
  );
  const lineHeightPx = Math.max(
    fontSizePx,
    Math.round(fontSizePx * RECEIPT_IMAGE_LINE_RATIO),
  );

  const lines = Math.max(1, ...struk.sheets.map((sheet) => sheet.lines.length));
  const sheetCount = Math.max(1, struk.sheets.length);

  /*
    Logo dimuatkan ke kotaknya (`contain`, seperti `object-contain` di layar &
    kertas): rasionya tidak diubah, dan logo selebar apa pun tetap berada di dalam
    kertas — termasuk saat kertasnya cuma 58 mm.
  */
  const logo =
    options.logo &&
    Number.isFinite(options.logo.width) &&
    Number.isFinite(options.logo.height) &&
    options.logo.width > 0 &&
    options.logo.height > 0
      ? options.logo
      : null;
  const logoBandPx = logo ? RECEIPT_IMAGE_LOGO_PX : 0;
  const skalaLogo = logo
    ? Math.min(logoBandPx / logo.width, logoBandPx / logo.height, usablePx / logo.width)
    : 0;

  const sheetHeightPx = 2 * padPx + logoBandPx + lines * lineHeightPx;

  return {
    widthPx,
    heightPx:
      2 * gapPx + sheetCount * sheetHeightPx + (sheetCount - 1) * gapPx,
    gapPx,
    padPx,
    sheetWidthPx,
    usablePx,
    sheetCount,
    sheetHeightPx,
    fontSizePx,
    lineHeightPx,
    cols,
    lines,
    logoBandPx,
    logoWidthPx: logo ? logo.width * skalaLogo : 0,
    logoHeightPx: logo ? logo.height * skalaLogo : 0,
  };
}

/**
 * Nama berkas gambar struk: `struk-A-00042.png`.
 *
 * Sisi depannya **sama persis** dengan nama berkas PDF-nya (`receiptFileNameStem`),
 * jadi dua berkas dari penjualan yang sama berpasangan: yang satu bisa dibuka di
 * aplikasi mana pun, yang satu lagi tampil sebagai foto di percakapan WhatsApp.
 */
export function receiptImageFileName(input: { number?: string | null; now?: Date }): string {
  return `${receiptFileNameStem(input)}.png`;
}

#!/usr/bin/env node
/**
 * Membuat PDF panduan operasional MesinPOS (`public/panduan/panduan-mesinpos.pdf`).
 *
 * Dua hal yang membentuk berkas ini:
 *
 *  1. **Isi** - langkah-langkah ditulis mengikuti layar yang benar-benar ada di
 *     aplikasi (label tombol, nama halaman, dan aturan server yang menolak).
 *  2. **Gambar** - setiap gambar adalah ilustrasi vektor yang digambar di sini,
 *     bukan tangkapan layar. Karena itu judulnya selalu "ilustrasi layar", supaya
 *     pembaca tidak mengira itu foto aplikasinya.
 *
 * Dokumen dibangun dua lintasan: lintasan pertama hanya mencatat nomor halaman
 * tiap bagian, lintasan kedua yang menghasilkan berkasnya (daftar isi sudah
 * lengkap di sana). Sampul & daftar isi selalu satu halaman, jadi nomor halaman
 * dari lintasan pertama tetap sah untuk lintasan kedua.
 *
 * Font standar PDF memakai encoding WinAnsi (CP1252). Setiap teks lewat `safe()`
 * yang menolak karakter di luar susunan itu, jadi tidak ada huruf yang hilang
 * tanpa jejak.
 *
 * Jalankan: `bun run panduan:pdf`
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import PDFDocument from "pdfkit";

const OUT = resolve(process.cwd(), "public/panduan/panduan-mesinpos.pdf");

// ---------------------------------------------------------------- tata letak --

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const CONTENT_W = A4.width - MARGIN * 2;
const FOOTER_H = 34;

const C = {
  ink: "#0F172A",
  body: "#1E293B",
  muted: "#64748B",
  border: "#CBD5E1",
  soft: "#F1F5F9",
  primary: "#047857",
  primaryDark: "#065F46",
  primarySoft: "#ECFDF5",
  warn: "#B45309",
  warnSoft: "#FFFBEB",
  screenChrome: "#E2E8F0",
};

const FONT = {
  regular: "Helvetica",
  bold: "Helvetica-Bold",
  italic: "Helvetica-Oblique",
  mono: "Courier",
};

// ------------------------------------------------------------- keamanan teks --

/**
 * Karakter tambahan CP1252 di atas Latin-1. Karakter di luar daftar ini (mis.
 * panah Unicode atau tanda centang) akan tampil salah tanpa peringatan, jadi
 * seluruh teks dokumen diperiksa di sini.
 */
const CP1252_EXTRA =
  "\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178";

function isEncodable(text) {
  for (const char of text) {
    if (char.codePointAt(0) <= 0xff) continue;
    if (CP1252_EXTRA.includes(char)) continue;
    return false;
  }
  return true;
}

function safe(text) {
  const value = String(text);
  if (!isEncodable(value)) {
    const bad = [...new Set([...value].filter((char) => !isEncodable(char)))];
    throw new Error(
      `Teks memuat karakter yang tidak bisa dicetak font PDF: ${bad
        .map((char) => `"${char}" (U+${char.codePointAt(0).toString(16).toUpperCase()})`)
        .join(", ")}`,
    );
  }
  return value;
}

// ------------------------------------------------------------------ penulis --

/** Melacak nomor halaman, posisi vertikal, dan halaman awal tiap bagian. */
class Writer {
  constructor() {
    this.doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN, bottom: MARGIN + FOOTER_H, left: MARGIN, right: MARGIN },
      autoFirstPage: false,
      bufferPages: true,
      info: {
        Title: "Panduan Operasional MesinPOS",
        Author: "MesinPOS",
        Subject: "Cara mengisi stok dan mengoperasikan MesinPOS",
      },
    });
    this.page = 0;
    this.y = MARGIN;
    this.toc = [];
    this.doc.on("pageAdded", () => {
      this.page += 1;
      this.renderFooter();
      this.y = MARGIN;
    });
  }

  addPage() {
    this.doc.addPage();
    return this;
  }

  renderFooter() {
    const doc = this.doc;
    const y = A4.height - MARGIN - 8;
    /*
      Footer berada di bawah batas margin bawah halaman. Tanpa menonaktifkan
      margin itu sebentar, pdfkit mengira teksnya tidak muat lalu membuat
      halaman baru - dan halaman baru memanggil footer lagi tanpa henti.
    */
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.save();
    doc
      .moveTo(MARGIN, y - 12)
      .lineTo(A4.width - MARGIN, y - 12)
      .lineWidth(0.5)
      .strokeColor(C.border)
      .stroke();
    doc.font(FONT.regular).fontSize(8).fillColor(C.muted);
    doc.text("Panduan Operasional MesinPOS", MARGIN, y - 8, { width: CONTENT_W / 2 });
    doc.text(`Halaman ${this.page}`, MARGIN + CONTENT_W / 2, y - 8, {
      width: CONTENT_W / 2,
      align: "right",
    });
    doc.restore();
    doc.page.margins.bottom = bottomMargin;
  }

  /** Ruang yang masih tersedia di halaman aktif. */
  get room() {
    return A4.height - MARGIN - FOOTER_H - this.y;
  }

  ensure(height) {
    if (this.room < height) this.addPage();
    return this;
  }

  gap(size = 10) {
    this.y += size;
    return this;
  }
}

// --------------------------------------------------------- blok teks dasar ----

function paragraph(w, value, options = {}) {
  const doc = w.doc;
  const width = options.width ?? CONTENT_W;
  doc.font(options.bold ? FONT.bold : FONT.regular).fontSize(options.size ?? 10.5);
  const height = doc.heightOfString(safe(value), { width, lineGap: 2 });
  w.ensure(height + 6);
  doc.fillColor(options.color ?? C.body);
  doc.text(safe(value), MARGIN, w.y, {
    width,
    lineGap: 2,
    align: options.align ?? "left",
  });
  w.y = doc.y + (options.after ?? 8);
  return w;
}

function sectionTitle(w, number, title) {
  w.addPage();
  w.toc.push({ number, title, page: w.page });

  const doc = w.doc;
  doc.font(FONT.regular).fontSize(9).fillColor(C.primary);
  doc.text(safe(`BAGIAN ${number}`), MARGIN, w.y);
  doc.font(FONT.bold).fontSize(18).fillColor(C.ink);
  doc.text(safe(title), MARGIN, doc.y + 2, { width: CONTENT_W });
  const barY = doc.y + 6;
  doc
    .moveTo(MARGIN, barY)
    .lineTo(MARGIN + 64, barY)
    .lineWidth(3)
    .strokeColor(C.primary)
    .stroke();
  w.y = barY + 16;
  return w;
}

function subTitle(w, title) {
  const doc = w.doc;
  w.ensure(34);
  doc.font(FONT.bold).fontSize(12).fillColor(C.ink);
  doc.text(safe(title), MARGIN, w.y, { width: CONTENT_W });
  w.y = doc.y + 6;
  return w;
}

/** Langkah bernomor dengan bulatan angka - bentuk yang paling mudah diikuti. */
function steps(w, items) {
  const doc = w.doc;
  const labelWidth = 22;
  items.forEach((item, index) => {
    doc.font(FONT.regular).fontSize(10.5);
    const height = doc.heightOfString(safe(item), { width: CONTENT_W - labelWidth, lineGap: 2 });
    w.ensure(height + 10);

    doc.save();
    doc.circle(MARGIN + 8, w.y + 7, 8).fill(C.primarySoft);
    doc
      .fillColor(C.primaryDark)
      .font(FONT.bold)
      .fontSize(9)
      .text(String(index + 1), MARGIN - 1, w.y + 3.5, { width: 18, align: "center" });
    doc.restore();

    doc.font(FONT.regular).fontSize(10.5).fillColor(C.body);
    doc.text(safe(item), MARGIN + labelWidth, w.y, {
      width: CONTENT_W - labelWidth,
      lineGap: 2,
    });
    w.y = doc.y + 8;
  });
  return w;
}

function bulletItems(doc, x, y, width, items) {
  let cursor = y;
  items.forEach((item) => {
    doc.font(FONT.regular).fontSize(10.5);
    doc.fillColor(C.primary).text("-", x, cursor);
    doc.font(FONT.regular).fontSize(10.5).fillColor(C.body);
    doc.text(safe(item), x + 12, cursor, { width: width - 12, lineGap: 2 });
    cursor = doc.y + 6;
  });
  return cursor;
}

/**
 * Daftar berbutir yang sadar halaman: tiap butir diukur lebih dulu, dan butir
 * yang tidak muat pindah ke halaman berikutnya secara utuh. Tanpa itu butir
 * yang panjang dicetak menembus batas bawah dan pdfkit membuat halaman baru di
 * tengah kalimat - hasilnya halaman demi halaman yang isinya satu baris.
 */
function bullets(w, items) {
  const doc = w.doc;
  const x = MARGIN + 4;
  const width = CONTENT_W;
  items.forEach((item) => {
    doc.font(FONT.regular).fontSize(10.5);
    const height = doc.heightOfString(safe(item), { width: width - 12, lineGap: 2 });
    w.ensure(height + 8);
    doc.fillColor(C.primary).text("-", x, w.y);
    doc.font(FONT.regular).fontSize(10.5).fillColor(C.body);
    doc.text(safe(item), x + 12, w.y, { width: width - 12, lineGap: 2 });
    w.y = doc.y + 6;
  });
  w.y += 2;
  return w;
}

/** Kotak berwarna untuk catatan penting / peringatan. */
function callout(w, title, lines, tone = "info") {
  const doc = w.doc;
  const palette =
    tone === "warn"
      ? { border: "#FCD34D", bg: C.warnSoft, title: C.warn }
      : { border: "#A7F3D0", bg: C.primarySoft, title: C.primaryDark };

  const inner = CONTENT_W - 24;
  doc.font(FONT.regular).fontSize(10);
  let height = 22;
  for (const line of lines) {
    height += doc.heightOfString(safe(line), { width: inner, lineGap: 2 }) + 4;
  }

  w.ensure(height + 10);
  doc.save();
  doc.roundedRect(MARGIN, w.y, CONTENT_W, height, 6).fillAndStroke(palette.bg, palette.border);
  doc.restore();

  doc.font(FONT.bold).fontSize(10).fillColor(palette.title);
  doc.text(safe(title), MARGIN + 12, w.y + 8, { width: inner });
  let cursor = doc.y + 3;
  doc.font(FONT.regular).fontSize(10).fillColor(C.body);
  for (const line of lines) {
    doc.text(safe(line), MARGIN + 12, cursor, { width: inner, lineGap: 2 });
    cursor = doc.y + 4;
  }
  w.y += height + 12;
  return w;
}

/** Panel abu-abu bergaya terminal, untuk perintah verifikasi. */
function codeBlock(w, lines) {
  const doc = w.doc;
  const inner = CONTENT_W - 24;
  doc.font(FONT.mono).fontSize(8.5);
  let height = 16;
  for (const line of lines) height += doc.heightOfString(safe(line), { width: inner }) + 3;

  w.ensure(height + 12);
  doc.save();
  doc.roundedRect(MARGIN, w.y, CONTENT_W, height, 6).fill(C.soft);
  doc.restore();
  let cursor = w.y + 8;
  doc.font(FONT.mono).fontSize(8.5).fillColor(C.body);
  for (const line of lines) {
    doc.text(safe(line), MARGIN + 12, cursor, { width: inner });
    cursor = doc.y + 3;
  }
  w.y += height + 12;
  return w;
}

function table(w, headers, rows, widths) {
  const doc = w.doc;
  const total = widths.reduce((sum, value) => sum + value, 0);
  const scaled = widths.map((value) => (value / total) * CONTENT_W);
  const pad = 6;

  const rowHeight = (cells, font, size) => {
    doc.font(font).fontSize(size);
    return (
      Math.max(
        ...cells.map((cell, index) =>
          doc.heightOfString(safe(cell), { width: scaled[index] - pad * 2, lineGap: 1.5 }),
        ),
      ) +
      pad * 2
    );
  };

  const drawHeader = () => {
    const height = rowHeight(headers, FONT.bold, 9.5);
    doc.save();
    doc.rect(MARGIN, w.y, CONTENT_W, height).fill(C.soft);
    doc.restore();
    let x = MARGIN;
    doc.font(FONT.bold).fontSize(9.5).fillColor(C.ink);
    headers.forEach((cell, index) => {
      doc.text(safe(cell), x + pad, w.y + pad, { width: scaled[index] - pad * 2, lineGap: 1.5 });
      x += scaled[index];
    });
    w.y += height;
  };

  drawHeader();
  rows.forEach((cells, index) => {
    const height = rowHeight(cells, FONT.regular, 9.5);
    if (w.room < height + 6) {
      w.addPage();
      drawHeader();
    }
    if (index % 2 === 1) {
      doc.save();
      doc.rect(MARGIN, w.y, CONTENT_W, height).fill("#F8FAFC");
      doc.restore();
    }
    let x = MARGIN;
    cells.forEach((cell, columnIndex) => {
      doc.font(FONT.regular).fontSize(9.5).fillColor(C.body);
      doc.text(safe(cell), x + pad, w.y + pad, {
        width: scaled[columnIndex] - pad * 2,
        lineGap: 1.5,
      });
      x += scaled[columnIndex];
    });
    doc
      .moveTo(MARGIN, w.y + height)
      .lineTo(MARGIN + CONTENT_W, w.y + height)
      .lineWidth(0.5)
      .strokeColor(C.border)
      .stroke();
    w.y += height;
  });
  w.gap(14);
  return w;
}

// ------------------------------------------------------------- gambar vektor --

/** Bingkai bergaya jendela aplikasi; `draw` mengisi isinya. */
function screen(w, caption, height, draw) {
  const doc = w.doc;
  w.ensure(height + 34);

  const top = w.y;
  doc.save();
  doc.roundedRect(MARGIN, top, CONTENT_W, height, 8).fillAndStroke("#FFFFFF", C.border);
  doc.rect(MARGIN, top, CONTENT_W, 22).fill(C.screenChrome);
  doc.circle(MARGIN + 14, top + 11, 3).fill("#FCA5A5");
  doc.circle(MARGIN + 26, top + 11, 3).fill("#FCD34D");
  doc.circle(MARGIN + 38, top + 11, 3).fill("#86EFAC");
  doc.restore();
  text(doc, "mesinpos.produkaplikasi.my.id", MARGIN + 52, top + 7, {
    size: 8,
    color: C.muted,
    width: CONTENT_W - 64,
  });

  const area = { x: MARGIN, y: top + 22, w: CONTENT_W, h: height - 22 };
  draw(doc, area);

  w.y = top + height + 6;
  doc.font(FONT.italic).fontSize(8.5).fillColor(C.muted);
  doc.text(safe(caption), MARGIN, w.y, { width: CONTENT_W, lineGap: 2 });
  w.y = doc.y + 14;
  return w;
}

function panel(doc, x, y, width, height, options = {}) {
  doc.save();
  doc
    .roundedRect(x, y, width, height, 5)
    .fillAndStroke(options.bg ?? "#FFFFFF", options.border ?? C.border);
  doc.restore();
}

function text(doc, value, x, y, options = {}) {
  doc
    .font(options.bold ? FONT.bold : options.mono ? FONT.mono : FONT.regular)
    .fontSize(options.size ?? 8.5)
    .fillColor(options.color ?? C.body);
  doc.text(safe(value), x, y, {
    width: options.width,
    align: options.align ?? "left",
    lineGap: 1,
  });
}

function button(doc, value, x, y, width, options = {}) {
  doc.save();
  doc.roundedRect(x, y, width, 18, 4).fill(options.bg ?? C.primary);
  doc.restore();
  text(doc, value, x, y + 5, {
    size: 8.5,
    bold: true,
    color: options.color ?? "#FFFFFF",
    width,
    align: "center",
  });
}

function outlineButton(doc, value, x, y, width) {
  panel(doc, x, y, width, 18, { bg: "#FFFFFF", border: C.border });
  text(doc, value, x, y + 5, { size: 8.5, width, align: "center" });
}

/** Bulatan bernomor sebagai penunjuk bagian gambar. */
function marker(doc, x, y, value) {
  doc.save();
  doc.circle(x, y, 8).fill(C.primary);
  doc.restore();
  text(doc, String(value), x - 6, y - 4, {
    size: 8.5,
    bold: true,
    color: "#FFFFFF",
    width: 12,
    align: "center",
  });
}

/**
 * Kerangka halaman aplikasi: sidebar + area isi.
 *
 * `markerX` disediakan untuk bulatan nomor penunjuk: letaknya di dalam bingkai
 * (bukan menempel di tepi), jadi tidak ada penanda yang terpotong.
 */
function appFrame(doc, area, active, options = {}) {
  const navItems = [
    "Dashboard",
    "Kasir (POS)",
    "Shift & Kas",
    "Produk & Stok",
    "Gudang & Stok",
    "Opname",
    "Pembelian",
    "Laporan",
    "Modul",
    "Langganan",
  ];
  const navW = 118;
  panel(doc, area.x + 8, area.y + 8, navW, area.h - 16, { bg: "#F8FAFC" });
  text(doc, "MesinPOS", area.x + 18, area.y + 18, { size: 9, bold: true, color: C.primaryDark });
  navItems.forEach((item, index) => {
    const y = area.y + 36 + index * 17;
    const isActive = item === active;
    if (isActive) {
      doc.save();
      doc.roundedRect(area.x + 14, y - 3, navW - 12, 15, 4).fill(C.primarySoft);
      doc.restore();
    }
    text(doc, item, area.x + 20, y, {
      size: 8,
      color: isActive ? C.primaryDark : C.muted,
      bold: isActive,
    });
  });

  const x = area.x + navW + 18;
  return {
    x,
    width: area.w - navW - (options.tail ?? 46),
    markerX: area.x + area.w - 15,
  };
}

/** Gambar 1: halaman Produk & Stok dengan tombol Tambah produk. */
function figureProductsPage(doc, area) {
  const { x, width, markerX } = appFrame(doc, area, "Produk & Stok");

  text(doc, "Produk & Stok", x, area.y + 14, { size: 12, bold: true, color: C.ink });
  text(doc, "12 produk - kolom stok adalah jumlah yang bisa dijual kasir dari lokasi jual.", x, area.y + 31, {
    size: 7.5,
    color: C.muted,
    width: width - 92,
  });
  button(doc, "Tambah produk", x + width - 92, area.y + 14, 92);
  marker(doc, markerX, area.y + 23, 1);

  const tableY = area.y + 56;
  panel(doc, x, tableY, width, 152);
  const columns = [
    { title: "SKU", width: 62 },
    { title: "Produk", width: 92 },
    { title: "Harga", width: 64 },
    { title: "Stok", width: 36 },
    { title: "Status", width: 48 },
    { title: "", width: 74 },
  ];
  doc.save();
  doc.rect(x, tableY, width, 18).fill(C.soft);
  doc.restore();
  let headerX = x + 8;
  columns.forEach((column) => {
    text(doc, column.title, headerX, tableY + 6, { size: 7.5, bold: true, color: C.muted });
    headerX += column.width;
  });

  const rows = [
    ["KOPISUSU", "Kopi Susu Gula Aren", "Rp 22.000", "48", "Tersedia"],
    ["TEHMANIS", "Teh Manis", "Rp 8.000", "4", "Menipis"],
    ["NASGOR01", "Nasi Goreng Spesial", "Rp 27.000", "0", "Habis"],
  ];
  rows.forEach((row, rowIndex) => {
    const rowY = tableY + 22 + rowIndex * 30;
    doc
      .moveTo(x, rowY + 26)
      .lineTo(x + width, rowY + 26)
      .lineWidth(0.5)
      .strokeColor(C.border)
      .stroke();
    let cellX = x + 8;
    row.forEach((cell, columnIndex) => {
      const column = columns[columnIndex];
      if (columnIndex === 5) {
        outlineButton(doc, "Sesuaikan stok", cellX, rowY + 4, column.width - 6);
      } else {
        text(doc, cell, cellX, rowY + 8, {
          size: 7.5,
          mono: columnIndex === 0 || columnIndex === 3,
          bold: columnIndex === 1,
          color: columnIndex === 4 && rowIndex > 0 ? C.warn : C.body,
        });
      }
      cellX += column.width;
    });
  });
  marker(doc, markerX, tableY + 40, 2);

  const noteY = tableY + 158;
  panel(doc, x, noteY, width, 34, { bg: "#F8FAFC" });
  text(doc, "Kategori: Kopi 5 - Makanan 4 - Minuman 3", x + 10, noteY + 12, {
    size: 7.5,
    color: C.muted,
  });
}

/** Gambar 2: form "Produk baru" dengan nomor urut pengisian. */
function figureNewProductForm(doc, area) {
  const { x, width, markerX } = appFrame(doc, area, "Produk & Stok");

  panel(doc, x, area.y + 12, width, 184, { bg: C.primarySoft, border: "#A7F3D0" });
  text(doc, "Produk baru", x + 12, area.y + 24, { size: 10.5, bold: true, color: C.ink });
  text(doc, "Isi nama, harga, dan stok awal yang benar-benar ada di rak.", x + 12, area.y + 40, {
    size: 7.5,
    color: C.muted,
    width: width - 24,
  });

  const fields = [
    { label: "Nama produk", value: "Kopi Susu Gula Aren", num: 1 },
    { label: "SKU (kosongkan untuk otomatis)", value: "PBB-KOP-000007", num: 2 },
    { label: "Kategori", value: "Kopi", num: 3 },
    { label: "Harga jual", value: "22000", num: 4 },
    { label: "Harga beli", value: "12000", num: 5 },
    { label: "Satuan dasar", value: "PCS", num: 6 },
    { label: "Stok awal", value: "48", num: 7 },
  ];
  const fieldW = (width - 24) / 2 - 10;
  fields.forEach((field, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const fieldX = x + 12 + column * ((width - 24) / 2);
    const fieldY = area.y + 58 + row * 30;
    text(doc, field.label, fieldX, fieldY, { size: 7, color: C.muted });
    panel(doc, fieldX, fieldY + 10, fieldW, 17);
    text(doc, field.value, fieldX + 6, fieldY + 15, { size: 7.5, mono: field.num >= 4 });
    if (field.num === 2 || field.num === 7) {
      marker(doc, fieldX + fieldW + 10, fieldY + 18, field.num);
    }
  });

  button(doc, "Simpan produk", x + 12, area.y + 172, 86);
  marker(doc, markerX, area.y + 181, 8);
}

/** Gambar 3: panel "Sesuaikan stok" pada satu baris produk. */
function figureAdjustStock(doc, area) {
  const { x, width, markerX } = appFrame(doc, area, "Produk & Stok");

  text(doc, "Produk & Stok", x, area.y + 14, { size: 12, bold: true, color: C.ink });

  const tableY = area.y + 40;
  panel(doc, x, tableY, width, 62);
  text(doc, "KOPISUSU", x + 8, tableY + 12, { size: 7.5, mono: true, color: C.muted });
  text(doc, "Kopi Susu Gula Aren", x + 72, tableY + 12, { size: 8.5, bold: true });
  text(doc, "Rp 22.000", x + 170, tableY + 12, { size: 8, mono: true });
  text(doc, "48", x + 236, tableY + 12, { size: 8, mono: true });
  outlineButton(doc, "Sesuaikan stok", x + width - 96, tableY + 8, 90);
  marker(doc, markerX, tableY + 18, 1);

  const formY = tableY + 66;
  panel(doc, x, formY, width, 96, { bg: "#F8FAFC" });
  text(
    doc,
    "Stok Kopi Susu Gula Aren saat ini 48 PCS di lokasi jual. Tulis angka negatif untuk mengurangi.",
    x + 10,
    formY + 10,
    { size: 7.5, color: C.muted, width: width - 20 },
  );

  text(doc, "Jumlah penyesuaian", x + 10, formY + 30, { size: 7, color: C.muted });
  panel(doc, x + 10, formY + 40, 84, 18);
  text(doc, "-3", x + 16, formY + 45, { size: 8, mono: true });
  marker(doc, x + 106, formY + 49, 2);

  text(doc, "Catatan (opsional)", x + 124, formY + 30, { size: 7, color: C.muted });
  panel(doc, x + 124, formY + 40, width - 232, 18);
  text(doc, "Rusak saat pengiriman", x + 130, formY + 45, { size: 7.5 });
  marker(doc, x + 124 + (width - 232) / 2, formY + 22, 3);

  text(doc, "Stok jadi 45", x + width - 92, formY + 30, { size: 7.5, color: C.muted });
  button(doc, "Sesuaikan stok", x + width - 92, formY + 40, 82);
  marker(doc, markerX, formY + 49, 4);

  text(doc, "Catatan itu tersimpan di ledger stok bersama siapa yang mengubahnya.", x + 10, formY + 72, {
    size: 7,
    color: C.muted,
    width: width - 20,
  });
}

/**
 * Gambar 10: seksi Logo toko di halaman Pengaturan, beserta pratinjau struk yang
 * mencetaknya. Digambar sesudah teks bagian 16 supaya ceritanya berurutan:
 * unggah logonya, lihat pratinjaunya, lalu lihat hasilnya di sidebar & struk.
 */
function figureTenantLogo(doc, area) {
  const x = area.x + 16;
  const width = area.w - 32;

  text(doc, "Pengaturan - kartu Struk belanja", x, area.y + 12, {
    size: 11,
    bold: true,
    color: C.ink,
  });

  const cardY = area.y + 32;
  const cardH = 92;
  panel(doc, x, cardY, width, cardH, { bg: "#F8FAFC" });

  text(doc, "Logo toko", x + 12, cardY + 10, { size: 9.5, bold: true });
  text(
    doc,
    "Satu logo per workspace, maksimal 1 MB (JPG, PNG, atau WebP). Di struk dicetak 110 x 110 px dan hitam putih.",
    x + 12,
    cardY + 24,
    { size: 7.5, color: C.muted, width: width - 24 },
  );

  // (2) Logo yang sedang terpasang, digambar sebagai kotak logo di atas alas putih.
  panel(doc, x + 12, cardY + 38, 70, 40, { bg: "#FFFFFF" });
  doc.save();
  doc.roundedRect(x + 26, cardY + 47, 42, 20, 3).fill(C.primarySoft);
  doc.restore();
  text(doc, "LOGO", x + 26, cardY + 53, {
    size: 7,
    bold: true,
    color: C.primaryDark,
    width: 42,
    align: "center",
  });
  text(doc, "Logo terpasang", x + 12, cardY + 80, { size: 7, color: C.muted });
  marker(doc, x + 90, cardY + 58, 2);

  // (1) Tombol unggah/ganti & hapus.
  outlineButton(doc, "Ganti logo", x + 108, cardY + 46, 78);
  outlineButton(doc, "Hapus logo", x + 194, cardY + 46, 78);
  marker(doc, x + 147, cardY + 36, 1);

  // (3) Pratinjau struk dengan logo di atas nama usaha. Kotak logonya sengaja
  //     digambar abu-abu - di struk logonya memang dicetak hitam putih.
  const strukX = x + width - 156;
  panel(doc, strukX, cardY + 8, 144, cardH - 16, { bg: "#FFFFFF" });
  doc.save();
  doc.roundedRect(strukX + 57, cardY + 16, 30, 13, 2).fill("#E5E7EB");
  doc.restore();
  text(doc, "LOGO", strukX + 57, cardY + 19, {
    size: 5.5,
    bold: true,
    color: "#4B5563",
    width: 30,
    align: "center",
  });
  text(doc, "WARUNG UJI STRUK", strukX, cardY + 34, {
    size: 7,
    mono: true,
    width: 144,
    align: "center",
  });
  text(doc, "Cabang Struk", strukX, cardY + 43, {
    size: 7,
    mono: true,
    width: 144,
    align: "center",
  });
  text(doc, "==============================", strukX, cardY + 52, {
    size: 6.5,
    mono: true,
    color: C.muted,
    width: 144,
    align: "center",
  });
  text(doc, "Member : Cash", strukX + 6, cardY + 60, { size: 6.5, mono: true });
  text(doc, "Kasir : Bu Sari", strukX + 6, cardY + 69, { size: 6.5, mono: true });
  text(doc, "Pratinjau struk (80 mm)", strukX, cardY + 80, {
    size: 6.5,
    color: C.muted,
    width: 144,
    align: "center",
  });
  marker(doc, strukX + 132, cardY + 24, 3);

  // Sisi sidebar: penanda workspace yang dipakai saat logo sudah terpasang.
  const sideY = cardY + cardH + 10;
  text(doc, "Di sidebar, logo yang sama menjadi penanda workspace:", x, sideY, {
    size: 7.5,
    color: C.muted,
    width: width - 20,
  });
  panel(doc, x, sideY + 14, 150, 34, { bg: C.sidebar ?? "#0F172A" });
  doc.save();
  doc.roundedRect(x + 10, sideY + 22, 18, 18, 4).fill("#FFFFFF");
  doc.restore();
  doc.save();
  doc.roundedRect(x + 14, sideY + 26, 10, 10, 2).fill(C.primarySoft);
  doc.restore();
  text(doc, "MesinPOS", x + 36, sideY + 26, { size: 8.5, bold: true, color: "#FFFFFF" });
  text(
    doc,
    "Logo yang diunggah pemilik toko menggantikan ikon bawaan di kotak itu; kalau belum ada, ikon bawaannya yang dipakai.",
    x + 162,
    sideY + 20,
    { size: 7.5, color: C.muted, width: width - 172 },
  );
}

/**
 * Gambar 11: kartu Struk belanja di halaman Pengaturan - saran setelan otomatis,
 * tiga kartu jenis printer, dan lebar kertas yang didukung mesin terpilih.
 */
function figureReceiptPrinter(doc, area) {
  const x = area.x + 16;
  const width = area.w - 32;

  text(doc, "Pengaturan - kartu Struk belanja", x, area.y + 12, {
    size: 11,
    bold: true,
    color: C.ink,
  });

  /*
    (1) Saran setelan otomatis duduk paling atas kartu: inilah yang menjawab
    "printer apa yang saya butuhkan" tanpa pemilik toko harus membaca ketiga
    katalog mesin di bawahnya - dan tombolnya tetap satu klik, karena yang
    memutuskan mesin mana yang dibeli tetap pemilik toko.
  */
  const sugY = area.y + 30;
  panel(doc, x, sugY, width, 46, { bg: C.primarySoft, border: "#A7F3D0" });
  text(doc, "Saran setelan otomatis", x + 10, sugY + 8, {
    size: 9,
    bold: true,
    color: C.primaryDark,
  });
  doc.save();
  doc.roundedRect(x + 122, sugY + 7, 118, 12, 3).fill("#D1FAE5");
  doc.restore();
  text(doc, "Modul Grosir & Wholesale", x + 122, sugY + 9, {
    size: 6.5,
    color: C.primaryDark,
    width: 118,
    align: "center",
  });
  outlineButton(doc, "Pakai saran ini", x + width - 96, sugY + 4, 86);
  text(
    doc,
    "Nota tempo ditandatangani & diarsipkan, jadi tembusan karbonnya bernilai.",
    x + 10,
    sugY + 22,
    { size: 7, color: C.muted, width: width - 130 },
  );
  text(doc, "Dot matrix - 76 mm - 2 lembar", x + 10, sugY + 34, { size: 7.5, bold: true });
  marker(doc, x + width - 104, sugY + 13, 1);

  // (2) Tiga jenis printer beserta kertas & rangkapnya. Kartu yang sedang dipilih
  //     bergaris hijau; yang lain putih. Kelebihan & kekurangannya ikut di sini.
  const cardY = sugY + 56;
  const cardH = 92;
  const gap = 8;
  const cardW = (width - gap * 2) / 3;
  const printers = [
    {
      label: "Thermal",
      how: "Elemen pemanas membakar lapisan kimia kertas thermal.",
      papers: "58 mm (32 kolom) / 80 mm (48 kolom)",
      copies: "1 lembar",
      chosen: false,
    },
    {
      label: "Dot matrix",
      how: "Jarum-jarum kecil memukul pita karbon ke kertas.",
      papers: "76 mm (40 kolom) / 241 mm (80 kolom)",
      copies: "sampai 3 lembar",
      chosen: true,
    },
    {
      label: "Portable",
      how: "Printer thermal kecil, baterai isi ulang, Bluetooth.",
      papers: "58 mm (32 kolom)",
      copies: "1 lembar",
      chosen: false,
    },
  ];
  printers.forEach((printer, index) => {
    const cardX = x + index * (cardW + gap);
    panel(
      doc,
      cardX,
      cardY,
      cardW,
      cardH,
      printer.chosen ? { bg: C.primarySoft, border: "#A7F3D0" } : { bg: "#FFFFFF" },
    );
    text(doc, printer.label, cardX + 8, cardY + 8, {
      size: 9,
      bold: true,
      color: printer.chosen ? C.primaryDark : C.ink,
    });
    text(doc, printer.how, cardX + 8, cardY + 22, {
      size: 6.8,
      color: C.muted,
      width: cardW - 16,
    });
    text(doc, "Kertas", cardX + 8, cardY + 48, { size: 6.5, color: C.muted });
    text(doc, printer.papers, cardX + 8, cardY + 57, { size: 6.8, width: cardW - 16 });
    text(doc, "Rangkap", cardX + 8, cardY + 73, { size: 6.5, color: C.muted });
    text(doc, printer.copies, cardX + 8, cardY + 82, { size: 6.8 });
    if (printer.chosen) marker(doc, cardX + cardW - 10, cardY + 12, 2);
  });

  // (3) Lebar kertas: pilihannya hanya yang benar-benar didukung mesin terpilih.
  const paperY = cardY + cardH + 10;
  text(doc, "Lebar kertas (hanya yang didukung mesin terpilih)", x, paperY, {
    size: 8,
    bold: true,
    color: C.ink,
  });
  outlineButton(doc, "76 mm - 40 kolom", x, paperY + 14, 104);
  outlineButton(doc, "241 mm - 80 kolom", x + 112, paperY + 14, 104);
  marker(doc, x + 226, paperY + 23, 3);
  text(
    doc,
    "Mengganti jenis printer memindahkan lebarnya sendiri ke kertas terdekat yang didukung mesin barunya.",
    x + 240,
    paperY + 17,
    { size: 7, color: C.muted, width: width - 240 },
  );
}

/**
 * Gambar 12: pratinjau struk selebar kertas yang dipilih, dan ukuran kertas yang
 * ditulis halaman kasir sendiri ke dialog cetak - kasir tidak perlu memilihnya.
 */
function figureReceiptPrint(doc, area) {
  const x = area.x + 16;
  const width = area.w - 32;

  text(doc, "Pratinjau di Pengaturan & dialog cetak di kasir", x, area.y + 12, {
    size: 11,
    bold: true,
    color: C.ink,
  });

  const top = area.y + 34;
  const blockH = 124;
  const line = (value, atX, atY) =>
    text(doc, value, atX, atY, { size: 6.2, mono: true });
  const struk58 = [
    "   WARUNG UJI STRUK",
    "     Cabang Struk",
    "============================",
    "1x Kopi Susu    22.000",
    "1x Teh Manis     8.000",
    "----------------------------",
    "Subtotal         30.000",
    "PPN 11%           3.300",
    "TOTAL            33.300",
    "Member : Cash",
    "Kasir  : Bu Sari",
    "Terima kasih sudah belanja",
  ];
  const struk80 = [
    "        WARUNG UJI STRUK",
    "          Cabang Struk",
    "==========================================",
    "1x Kopi Susu Gula Aren Large",
    "                            22.000",
    "1x Teh Manis Dingin          8.000",
    "------------------------------------------",
    "Subtotal                    30.000",
    "PPN 11%                      3.300",
    "TOTAL                       33.300",
    "Member : Cash",
    "Kasir  : Bu Sari",
    "Terima kasih sudah belanja di toko kami",
  ];

  // (1) Pratinjau memakai kertas yang dipilih: 58 mm dan 80 mm tidak sama lebarnya.
  text(doc, "58 mm - 32 kolom", x, top, { size: 7, color: C.muted });
  marker(doc, x + 100, top + 3, 1);
  panel(doc, x, top + 12, 120, blockH, { bg: "#FFFFFF" });
  struk58.forEach((value, index) => line(value, x + 6, top + 18 + index * 8));

  text(doc, "80 mm - 48 kolom", x + 132, top, { size: 7, color: C.muted });
  panel(doc, x + 132, top + 12, 150, blockH, { bg: "#FFFFFF" });
  struk80.forEach((value, index) => line(value, x + 138, top + 18 + index * 8));

  text(
    doc,
    "Pratinjau menampilkan struk yang benar-benar akan tercetak: selebar kertas yang dipilih dan satu blok per lembar rangkap.",
    x,
    top + blockH + 20,
    { size: 7, color: C.muted, width: 282 },
  );

  /*
    (2) Dialog cetak peramban: ukuran kertasnya sudah terisi dari setelan
    workspace, jadi kasir tidak lagi memilih "Paper size" di depan antrean.
  */
  const dlgX = x + 300;
  const dlgW = width - 300;
  panel(doc, dlgX, top + 12, dlgW, 160, { bg: "#F8FAFC" });
  text(doc, "Cetak", dlgX + 10, top + 20, { size: 9, bold: true, color: C.ink });
  const rows = [
    ["Printer", "Epson TM-T82X"],
    ["Ukuran kertas", "80 mm x 118 mm"],
    ["Margin", "4 mm"],
    ["Salinan", "1"],
  ];
  rows.forEach(([label, value], index) => {
    const rowY = top + 38 + index * 17;
    text(doc, label, dlgX + 10, rowY, { size: 6.8, color: C.muted, width: 60 });
    text(doc, value, dlgX + 74, rowY, { size: 7, bold: index === 1 });
  });
  marker(doc, dlgX + dlgW - 12, top + 51, 2);
  text(
    doc,
    "Ukuran kertas ditulis halaman kasir dari setelan workspace (@page), bukan dipilih di sini.",
    dlgX + 10,
    top + 108,
    { size: 6.8, color: C.muted, width: dlgW - 20 },
  );
  text(
    doc,
    "Kertas sempit memakai margin 2 mm supaya 32 kolomnya tidak makin sempit.",
    dlgX + 10,
    top + 134,
    { size: 6.8, color: C.muted, width: dlgW - 20 },
  );
}

/** Gambar 4: diagram alur stok masuk. */
function figureStockFlow(doc, area) {
  const x = area.x + 16;
  const usable = area.w - 32;
  const nodeW = 100;
  const nodeH = 46;
  const gap = (usable - nodeW * 4) / 3;
  const y = area.y + 44;

  text(doc, "Alur stok masuk yang dicatat server", x, area.y + 16, {
    size: 10,
    bold: true,
    color: C.ink,
  });

  const nodes = [
    { title: "Permintaan (PR)", line: "staf gudang meminta", strong: false },
    { title: "Pesanan (PO)", line: "pemilik/manajer menyetujui", strong: false },
    { title: "Penerimaan (GRN)", line: "barang datang dihitung", strong: true },
    { title: "Stok bertambah", line: "lokasi jual atau gudang", strong: true },
  ];
  nodes.forEach((node, index) => {
    const nodeX = x + index * (nodeW + gap);
    panel(doc, nodeX, y, nodeW, nodeH, {
      bg: node.strong ? C.primarySoft : "#FFFFFF",
      border: node.strong ? "#A7F3D0" : C.border,
    });
    text(doc, node.title, nodeX + 8, y + 10, { size: 8.5, bold: true, color: C.ink });
    text(doc, node.line, nodeX + 8, y + 24, { size: 7.5, color: C.muted, width: nodeW - 16 });
    if (index < nodes.length - 1) {
      const from = nodeX + nodeW + 4;
      const to = nodeX + nodeW + gap - 4;
      const arrowY = y + nodeH / 2;
      doc.moveTo(from, arrowY).lineTo(to, arrowY).lineWidth(1).strokeColor(C.primary).stroke();
      doc.moveTo(to, arrowY).lineTo(to - 6, arrowY - 3).lineTo(to - 6, arrowY + 3).fill(C.primary);
    }
  });

  const legendY = y + nodeH + 20;
  panel(doc, x, legendY, usable, 78, { bg: "#F8FAFC" });
  bulletItems(doc, x + 12, legendY + 12, usable - 24, [
    "Stok awal dan penyesuaian manual ditulis sebagai pergerakan beralasan \u201cadjustment\u201d beserta catatannya.",
    "Penerimaan barang menambah stok ke lokasi yang dipilih: gudang bila disimpan dulu, atau lokasi jual bila langsung dipajang.",
    "Kasir hanya menjual stok lokasi jual; stok yang masih di gudang tidak muncul di kasir.",
  ]);
}

/** Gambar 5: pesanan pembelian dengan penerimaan bertahap (GRN sebagian). */
function figurePurchaseOrder(doc, area) {
  const { x, width, markerX } = appFrame(doc, area, "Pembelian");

  text(doc, "Pembelian", x, area.y + 14, { size: 12, bold: true, color: C.ink });

  const stats = [
    ["Menunggu persetujuan", "1"],
    ["PO terbuka", "2"],
    ["Nilai PO terbuka", "Rp 4.850.000"],
    ["Diterima bulan ini", "Rp 12.300.000"],
  ];
  const statW = (width - 18) / 4;
  stats.forEach((stat, index) => {
    const statX = x + index * (statW + 6);
    panel(doc, statX, area.y + 30, statW, 38);
    text(doc, stat[0], statX + 6, area.y + 37, { size: 6.5, color: C.muted, width: statW - 12 });
    text(doc, stat[1], statX + 6, area.y + 50, { size: 8.5, bold: true, mono: true });
  });

  const tableY = area.y + 78;
  panel(doc, x, tableY, width, 66);
  const columns = [
    { title: "Nomor", width: 66 },
    { title: "Supplier", width: 76 },
    { title: "Progres", width: 50 },
    { title: "Nilai", width: 62 },
    { title: "Status", width: 55 },
  ];
  doc.save();
  doc.rect(x, tableY, width, 18).fill(C.soft);
  doc.restore();
  let headerX = x + 8;
  columns.forEach((column) => {
    text(doc, column.title, headerX, tableY + 6, { size: 7.5, bold: true, color: C.muted });
    headerX += column.width;
  });
  const row = ["PO-2026-0007", "PT Sumber Rejeki", "12 / 24", "Rp 1.440.000", "Sebagian"];
  let cellX = x + 8;
  row.forEach((cell, index) => {
    text(doc, cell, cellX, tableY + 30, {
      size: 7.5,
      mono: index === 0 || index === 2 || index === 3,
      color: index === 4 ? C.warn : C.body,
    });
    cellX += columns[index].width;
  });
  marker(doc, markerX, tableY + 34, 1);

  // Penerimaan barang: sisa dihitung dari baris PO, bukan dari status.
  const formY = tableY + 74;
  panel(doc, x, formY, width, 122, { bg: "#F8FAFC" });
  text(doc, "Penerimaan barang (GRN)", x + 10, formY + 10, { size: 9, bold: true, color: C.ink });
  text(doc, "PO", x + 10, formY + 28, { size: 7, color: C.muted });
  panel(doc, x + 10, formY + 38, width / 2 - 18, 17);
  text(doc, "PO-2026-0007 - PT Sumber Rejeki", x + 16, formY + 43, { size: 7 });
  text(doc, "Lokasi tujuan", x + width / 2 + 6, formY + 28, { size: 7, color: C.muted });
  panel(doc, x + width / 2 + 6, formY + 38, width / 2 - 16, 17);
  text(doc, "Lokasi jual", x + width / 2 + 12, formY + 43, { size: 7 });

  text(doc, "Kopi Susu Gula Aren", x + 10, formY + 66, { size: 7.5, bold: true });
  text(doc, "sisa 12 dari 24", x + 110, formY + 66, { size: 7, color: C.muted });
  panel(doc, x + width - 96, formY + 62, 40, 16);
  text(doc, "12", x + width - 90, formY + 66, { size: 7.5, mono: true });
  marker(doc, x + width - 110, formY + 70, 2);

  text(doc, "Air Mineral", x + 10, formY + 86, { size: 7.5, bold: true });
  text(doc, "sisa 0 dari 24 - sudah diterima penuh", x + 110, formY + 86, {
    size: 7,
    color: C.muted,
  });
  panel(doc, x + width - 96, formY + 82, 40, 16);
  text(doc, "0", x + width - 90, formY + 86, { size: 7.5, mono: true });

  button(doc, "Terima barang", x + 10, formY + 98, 86);
  marker(doc, markerX, formY + 107, 3);
}

/** Gambar 6: hutang usaha + pencocokan 3 arah + pembayaran. */
function figurePayables(doc, area) {
  const { x, width, markerX } = appFrame(doc, area, "Pembelian");

  text(doc, "Hutang usaha (AP)", x, area.y + 14, { size: 12, bold: true, color: C.ink });

  const stats = [
    ["Total hutang terbuka", "Rp 4.850.000"],
    ["Lewat jatuh tempo", "Rp 1.200.000"],
    ["Jatuh tempo <= 7 hari", "Rp 980.000"],
  ];
  const statW = (width - 12) / 3;
  stats.forEach((stat, index) => {
    const statX = x + index * (statW + 6);
    panel(doc, statX, area.y + 30, statW, 38, {
      bg: index === 1 ? "#FEF2F2" : "#FFFFFF",
      border: index === 1 ? "#FCA5A5" : C.border,
    });
    text(doc, stat[0], statX + 6, area.y + 37, { size: 6.5, color: C.muted, width: statW - 12 });
    text(doc, stat[1], statX + 6, area.y + 50, {
      size: 8.5,
      bold: true,
      mono: true,
      color: index === 1 ? "#B91C1C" : C.body,
    });
  });

  const tableY = area.y + 78;
  panel(doc, x, tableY, width, 86);
  const columns = [
    { title: "Nomor", width: 58 },
    { title: "Supplier", width: 70 },
    { title: "Jatuh tempo", width: 54 },
    { title: "Umur", width: 50 },
    { title: "3 arah", width: 46 },
    { title: "Sisa", width: 45 },
  ];
  doc.save();
  doc.rect(x, tableY, width, 18).fill(C.soft);
  doc.restore();
  let headerX = x + 8;
  columns.forEach((column) => {
    text(doc, column.title, headerX, tableY + 6, { size: 7, bold: true, color: C.muted });
    headerX += column.width;
  });
  const rows = [
    ["AP-0003", "PT Sumber Rejeki", "12/10/2026", "lewat 3 hari", "Ditinjau", "1.200.000"],
    ["AP-0004", "CV Aneka Kemas", "24/10/2026", "6 hari", "Cocok", "980.000"],
  ];
  rows.forEach((cells, rowIndex) => {
    const rowY = tableY + 22 + rowIndex * 28;
    doc
      .moveTo(x, rowY + 24)
      .lineTo(x + width, rowY + 24)
      .lineWidth(0.5)
      .strokeColor(C.border)
      .stroke();
    let cellX = x + 8;
    cells.forEach((cell, index) => {
      text(doc, cell, cellX, rowY + 8, {
        size: 7,
        mono: index === 0 || index === 5,
        color: index === 3 ? C.warn : C.body,
      });
      cellX += columns[index].width;
    });
  });
  marker(doc, markerX, tableY + 34, 1);

  // Keputusan selisih: pembayaran ditahan selama sengketa belum selesai.
  const decisionY = tableY + 94;
  panel(doc, x, decisionY, width, 74, { bg: "#F8FAFC" });
  text(doc, "Pencocokan 3 arah (PO / GRN / tagihan)", x + 10, decisionY + 10, {
    size: 8.5,
    bold: true,
    color: C.ink,
  });
  text(
    doc,
    "AP-0003: tagihan supplier Rp 1.260.000, PO Rp 1.440.000 -> selisih Rp 180.000",
    x + 10,
    decisionY + 24,
    { size: 7, color: C.muted, width: width - 20 },
  );
  outlineButton(doc, "Terima selisih", x + 10, decisionY + 42, 74);
  outlineButton(doc, "Sengketa", x + 90, decisionY + 42, 62);
  marker(doc, x + 158, decisionY + 51, 2);
  text(doc, "Pembayaran ditahan selama sengketa belum dicabut.", x + 10, decisionY + 65, {
    size: 6.5,
    color: C.muted,
  });

  // Bayar sekaligus: satu nomor batch untuk beberapa tagihan.
  const payY = decisionY + 82;
  panel(doc, x, payY, width, 44, { bg: "#FFFFFF" });
  text(doc, "Bayar sekaligus", x + 10, payY + 9, { size: 8.5, bold: true, color: C.ink });
  text(doc, "2 tagihan terpilih   Rp 2.180.000", x + 10, payY + 24, { size: 7, mono: true });
  text(doc, "Metode", x + width - 150, payY + 24, { size: 7, color: C.muted });
  panel(doc, x + width - 120, payY + 20, 56, 16);
  text(doc, "Transfer", x + width - 114, payY + 24, { size: 7 });
  button(doc, "Bayar terpilih", x + width - 58, payY + 20, 52);
  marker(doc, markerX, payY + 29, 3);
}

/** Gambar 7: pindah stok antar lokasi. */
function figureTransfer(doc, area) {
  const { x, width, markerX } = appFrame(doc, area, "Gudang & Stok");

  text(doc, "Gudang & Stok", x, area.y + 14, { size: 12, bold: true, color: C.ink });

  const cards = [
    ["Lokasi stok", "2"],
    ["Bisa dijual", "120"],
    ["Di gudang", "48"],
  ];
  const cardW = (width - 16) / 3;
  cards.forEach((card, index) => {
    const cardX = x + index * (cardW + 8);
    panel(doc, cardX, area.y + 32, cardW, 40);
    text(doc, card[0], cardX + 8, area.y + 40, { size: 7, color: C.muted });
    text(doc, card[1], cardX + 8, area.y + 52, { size: 11, bold: true, mono: true });
  });

  const formY = area.y + 84;
  panel(doc, x, formY, width, 146, { bg: "#F8FAFC" });
  text(doc, "Pindah stok antar lokasi", x + 10, formY + 10, { size: 9, bold: true, color: C.ink });

  const fields = [
    ["Produk", "Kopi Susu Gula Aren"],
    ["Dari", "Gudang Utama"],
    ["Ke", "Lokasi jual"],
    ["Jumlah", "24"],
  ];
  const fieldW = (width - 20) / 2 - 10;
  fields.forEach((field, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const fieldX = x + 10 + column * ((width - 20) / 2);
    const fieldY = formY + 28 + row * 30;
    text(doc, field[0], fieldX, fieldY, { size: 7, color: C.muted });
    panel(doc, fieldX, fieldY + 10, fieldW, 17);
    text(doc, field[1], fieldX + 6, fieldY + 15, { size: 7.5, mono: index === 3 });
  });

  text(doc, "Catatan (opsional)", x + 10, formY + 88, { size: 7, color: C.muted });
  panel(doc, x + 10, formY + 98, width - 130, 17);
  text(doc, "Stok untuk rak depan", x + 16, formY + 103, { size: 7.5 });
  button(doc, "Pindah stok", x + width - 108, formY + 97, 98);
  marker(doc, markerX, formY + 106, 1);

  text(doc, "Perpindahan tercatat sebagai dua baris ledger bernomor TRF-00001.", x + 10, formY + 124, {
    size: 7,
    color: C.muted,
    width: width - 20,
  });
}

/**
 * Gambar 8: sesi opname lengkap.
 *
 * Dua kolom saldo sengaja digambar berdampingan: `Sistem (snapshot)` adalah saldo
 * saat sesi dimulai, `Sekarang` saldo saat ini - stok bisa bergerak selagi dihitung,
 * dan yang diterapkan saat posting adalah selisih terhadap saldo terakhir.
 */
function figureOpname(doc, area) {
  const { x, width, markerX } = appFrame(doc, area, "Opname");

  text(doc, "Stock Opname", x, area.y + 14, { size: 12, bold: true, color: C.ink });
  text(doc, "Satu lokasi satu sesi berjalan; stok baru berubah setelah sesinya diposting.", x, area.y + 31, {
    size: 7.5,
    color: C.muted,
    width: width - 8,
  });

  text(doc, "Lokasi yang dihitung", x, area.y + 46, { size: 7, color: C.muted });
  panel(doc, x, area.y + 56, width / 2 - 12, 17);
  text(doc, "Lokasi jual", x + 6, area.y + 61, { size: 7.5 });
  button(doc, "Mulai hitung Lokasi jual", x + width / 2, area.y + 55, 140);
  marker(doc, markerX, area.y + 64, 1);

  const cardY = area.y + 82;
  panel(doc, x, cardY, width, 54, { bg: "#F8FAFC" });
  text(doc, "OPN-2026-0011 - Lokasi jual", x + 10, cardY + 9, { size: 9, bold: true, color: C.ink });
  text(doc, "5/12 dihitung", x + width - 78, cardY + 9, { size: 7.5, mono: true, color: C.muted });
  doc.save();
  doc.roundedRect(x + 10, cardY + 22, width - 20, 5, 2.5).fill("#E2E8F0");
  doc.roundedRect(x + 10, cardY + 22, (width - 20) * 0.42, 5, 2.5).fill(C.primary);
  doc.restore();
  text(
    doc,
    "2 baris cocok - 1 lebih (1 unit) - 2 kurang (5 unit) - selisih bersih -4",
    x + 10,
    cardY + 33,
    { size: 7, color: C.muted, width: width - 20 },
  );
  marker(doc, markerX, cardY + 40, 2);

  const tableY = cardY + 62;
  panel(doc, x, tableY, width, 92);
  const columns = [
    { title: "Produk", width: 100 },
    { title: "Sistem (snapshot)", width: 58 },
    { title: "Sekarang", width: 50 },
    { title: "Hitung fisik", width: 54 },
    { title: "Selisih", width: 46 },
  ];
  doc.save();
  doc.rect(x, tableY, width, 18).fill(C.soft);
  doc.restore();
  let headerX = x + 8;
  columns.forEach((column) => {
    text(doc, column.title, headerX, tableY + 6, { size: 7, bold: true, color: C.muted });
    headerX += column.width;
  });

  const rows = [
    ["Kopi Susu Gula Aren", "48", "45", "45", "-3"],
    ["Teh Manis", "4", "4", "4", "0"],
    ["Air Mineral", "72", "68", "70", "-2"],
  ];
  rows.forEach((row, index) => {
    const rowY = tableY + 22 + index * 24;
    doc
      .moveTo(x, rowY + 22)
      .lineTo(x + width, rowY + 22)
      .lineWidth(0.5)
      .strokeColor(C.border)
      .stroke();
    let cellX = x + 8;
    row.forEach((cell, columnIndex) => {
      text(doc, cell, cellX, rowY + 6, {
        size: 7,
        mono: columnIndex > 0,
        color: columnIndex === 4 && cell !== "0" ? C.warn : C.body,
      });
      if (columnIndex === 3) {
        panel(doc, cellX - 4, rowY + 2, columns[columnIndex].width - 8, 17);
        text(doc, cell, cellX, rowY + 6, { size: 7, mono: true });
      }
      cellX += columns[columnIndex].width;
    });
  });

  const footerY = tableY + 100;
  button(doc, "Posting hasil hitung", x + 10, footerY, 130);
  marker(doc, markerX, footerY + 9, 3);
  outlineButton(doc, "Batalkan sesi", x + 148, footerY, 78);
  text(
    doc,
    "Baris belum dihitung tidak pernah dianggap nol, jadi hitung sebagian tetap sah.",
    x + 10,
    footerY + 24,
    { size: 6.5, color: C.muted, width: width - 20 },
  );
}

/** Gambar 7: layar kasir. */
function figurePos(doc, area) {
  const { x, width, markerX } = appFrame(doc, area, "Kasir (POS)");

  text(doc, "Kasir (POS)", x, area.y + 14, { size: 12, bold: true, color: C.ink });
  text(doc, "Klik produk untuk masuk keranjang; angka stok muncul di bawah nama.", x, area.y + 31, {
    size: 7.5,
    color: C.muted,
    width: width - 120,
  });

  const gridY = area.y + 52;
  const tiles = [
    ["Kopi Susu", "48"],
    ["Teh Manis", "4"],
    ["Nasi Goreng", "0"],
    ["Es Jeruk", "26"],
    ["Roti Bakar", "15"],
    ["Air Mineral", "72"],
  ];
  const tileW = (width - 134) / 3 - 6;
  tiles.forEach((tile, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const tileX = x + column * (tileW + 6);
    const tileY = gridY + row * 46;
    panel(doc, tileX, tileY, tileW, 40, {
      bg: tile[1] === "0" ? "#F8FAFC" : "#FFFFFF",
      border: tile[1] === "0" ? C.border : "#A7F3D0",
    });
    text(doc, tile[0], tileX + 6, tileY + 8, { size: 8, bold: true });
    text(doc, `stok ${tile[1]}`, tileX + 6, tileY + 24, {
      size: 7,
      mono: true,
      color: tile[1] === "0" ? C.muted : C.primaryDark,
    });
  });
  marker(doc, x + width - 130 + 62, gridY - 12, 2);

  const cartX = x + width - 126;
  panel(doc, cartX, gridY, 126, 138, { bg: "#F8FAFC" });
  text(doc, "Keranjang", cartX + 8, gridY + 8, { size: 8.5, bold: true });
  text(doc, "2 x Kopi Susu      44.000", cartX + 8, gridY + 24, { size: 7, mono: true });
  text(doc, "1 x Es Jeruk       10.000", cartX + 8, gridY + 36, { size: 7, mono: true });
  text(doc, "Subtotal           54.000", cartX + 8, gridY + 54, { size: 7, mono: true });
  text(doc, "PPN 11%             5.940", cartX + 8, gridY + 66, { size: 7, mono: true });
  text(doc, "Total              59.940", cartX + 8, gridY + 78, {
    size: 7.5,
    mono: true,
    bold: true,
  });
  outlineButton(doc, "Tunai", cartX + 8, gridY + 94, 34);
  outlineButton(doc, "QRIS", cartX + 46, gridY + 94, 34);
  outlineButton(doc, "Kartu", cartX + 84, gridY + 94, 34);
  button(doc, "Selesaikan pembayaran", cartX + 8, gridY + 118, 110);
  marker(doc, markerX, gridY + 127, 1);
}

// ------------------------------------------------------------------- isi -----

const ROLE_ROWS = [
  ["Membuat produk & menetapkan harga", "product.manage", "Pemilik, Manajer, Staf gudang"],
  ["Menambah / mengurangi stok manual", "stock.adjust", "Pemilik, Manajer, Staf gudang"],
  ["Memindahkan stok antar lokasi", "inventory.manage", "Pemilik, Manajer, Staf gudang"],
  ["Melihat gudang & stok per lokasi", "inventory.view", "Pemilik, Manajer, Staf gudang"],
  ["Menghitung fisik & posting opname", "inventory.manage", "Pemilik, Manajer, Staf gudang"],
  ["Mengajukan permintaan pembelian (PR)", "purchase.request", "Pemilik, Manajer, Staf gudang"],
  ["Menyetujui PR & membuat PO", "purchase.approve", "Pemilik, Manajer"],
  ["Menerima barang (GRN)", "purchase.receive", "Pemilik, Manajer, Staf gudang"],
  ["Menjual di kasir", "pos.sell", "Pemilik, Manajer, Kasir"],
  ["Bekerja di antrean dapur (KDS)", "kds.manage", "Pemilik, Manajer, Kasir"],
  ["Membuka & menutup shift kas", "shift.manage", "Pemilik, Manajer, Kasir"],
];

const SECTIONS = [
  {
    number: 1,
    title: "Masuk dan menyiapkan workspace",
    render(w) {
      paragraph(
        w,
        "Semua langkah di panduan ini dikerjakan dari dalam aplikasi MesinPOS. Siapkan email aktif dan nama toko Anda sebelum mulai.",
      );
      subTitle(w, "Langkah masuk");
      steps(w, [
        "Buka alamat aplikasi Anda, lalu tekan Masuk atau daftar di halaman depan.",
        "Tulis email Anda. Kode masuk dikirim ke email itu, jadi tidak ada kata sandi yang perlu dibuat.",
        "Buka kotak masuk, lalu masukkan kode yang dikirim. Kode hanya bisa dipakai sekali dan punya masa berlaku.",
        "Kalau emailnya tidak masuk: periksa folder spam, lalu minta kode baru. Kode lama otomatis tidak berlaku.",
      ]);
      subTitle(w, "Menyiapkan workspace (sekali saja)");
      paragraph(
        w,
        "Kalau akun Anda belum punya workspace, aplikasi membuka halaman pendaftaran tiga langkah: Bisnis, Modul, Paket.",
      );
      steps(w, [
        "Langkah Bisnis: isi nama bisnis dan nama toko pertama Anda.",
        "Langkah Modul: pilih modul yang sesuai cara berjualan Anda - UMKM (toko/ritel), Food & Beverage (kafe/restoran), atau Grosir (harga bertingkat & piutang).",
        "Langkah Paket: pilih Starter, Professional, atau Enterprise. Uji coba 14 hari berjalan sejak workspace dibuat.",
        "Selesai. Anda masuk ke Dashboard, dan menu di sidebar kiri sudah menyesuaikan peran Anda.",
      ]);
      callout(w, "Catatan paket dan fitur", [
        "Sidebar hanya menampilkan menu yang boleh dibuka peran Anda. Menu yang disembunyikan juga ditolak di server, jadi alamat yang diketik langsung tidak menembus izin.",
        "Paket menentukan fitur yang tersedia; modul menentukan fitur mana yang hidup. Gudang tambahan, opname, dan pembelian penuh ada di paket yang lebih tinggi.",
      ]);
    },
  },
  {
    number: 2,
    title: "Jawaban singkat: tiga cara mengisi stok",
    render(w) {
      paragraph(
        w,
        "Cara mengisi stok ada tiga, tergantung dari mana barangnya datang. Semuanya menulis pergerakan ke ledger stok yang sama, jadi setiap angka bisa ditelusuri.",
      );
      table(
        w,
        ["Cara", "Halaman", "Kapan dipakai", "Izin"],
        [
          [
            "1. Stok awal saat produk dibuat",
            "Produk & Stok, tombol Tambah produk",
            "Saat pertama kali memasukkan barang yang sudah ada di rak.",
            "product.manage",
          ],
          [
            "2. Sesuaikan stok",
            "Produk & Stok, tombol Sesuaikan stok",
            "Barang datang tanpa PO, rusak, hilang, atau salah hitung.",
            "stock.adjust",
          ],
          [
            "3. Penerimaan barang (GRN)",
            "Pembelian, kartu Penerimaan barang (GRN)",
            "Barang datang dari supplier dengan dokumen pesanan.",
            "purchase.receive",
          ],
        ],
        [110, 120, 160, 70],
      );
      callout(w, "Aturan yang tidak berubah", [
        "Stok yang bisa dijual kasir adalah stok di lokasi jual. Barang yang masih di gudang harus dipindahkan dulu (Bagian 6).",
        "Mengurangi stok melebihi jumlah yang ada ditolak dengan pesan yang menyebut stok tersedia. Tidak ada stok minus.",
      ]);
    },
  },
  {
    number: 3,
    title: "Cara 1: membuat produk dan mengisi stok awal",
    render(w) {
      paragraph(
        w,
        "Ini jalur pertama yang harus dipakai di toko baru: tanpa produk, tidak ada yang bisa dijual dan tidak ada stok yang bisa diisi.",
      );
      steps(w, [
        "Buka menu Produk & Stok di sidebar kiri.",
        "Tekan tombol Tambah produk di kanan atas halaman. Form Produk baru terbuka di bawah judul halaman.",
        "Isi Nama produk, misalnya Kopi Susu Gula Aren. SKU boleh dibiarkan kosong: kalau kolomnya kosong, sistem membuat kode otomatis berformat PBB-<KATEGORI>-<nomor urut> (contoh PBB-SAN-000042) yang dijamin unik. Tombol Buat otomatis di sebelah kolomnya mengisi kode itu lebih dulu kalau Anda ingin melihatnya sebelum menyimpan, dan kalau toko Anda punya aturan kode sendiri, ketik saja di kolom SKU - ketikan Anda yang dipakai.",
        "Pilih Kategori. Workspace baru sudah punya kategori bawaan: Kopi, Makanan, Snack, dan Minuman. Kategori menentukan kode di tengah SKU, jadi selama kolom SKU masih berisi hasil tombol Buat otomatis, mengganti Kategori ikut mengganti kodenya (nomornya tetap). Nanti pun begitu: kolom Kategori di kartu Atur harga mengganti kategori produk, dan SKU buatan sistem ikut menyesuaikan - sedangkan SKU yang Anda ketik sendiri tidak pernah diubah.",
        "Isi Harga jual, Harga beli (opsional, dipakai sebagai saran harga di pesanan pembelian), dan Satuan dasar seperti PCS, Porsi, atau Botol.",
        "Isi Stok awal dengan jumlah fisik yang benar-benar ada di rak hari ini.",
        "Tekan Simpan produk. Pemberitahuan hijau muncul, dan barisnya langsung tampil di tabel produk.",
      ]);
      table(
        w,
        ["Hasil setelah menyimpan", "Keterangan"],
        [
          [
            "Baris produk muncul di tabel",
            "Kolom Stok menampilkan stok awal tadi, dan Status membaca Tersedia, Menipis (5 atau kurang), atau Habis.",
          ],
          [
            "Stok bisa langsung dijual",
            "Stok awal masuk ke lokasi jual, jadi produk itu langsung muncul di Kasir (POS).",
          ],
          [
            "Punya jejak audit",
            "Server mencatatnya sebagai penyesuaian beralasan \u201cStok awal\u201d beserta siapa yang mengisinya.",
          ],
        ],
        [150, 350],
      );
      callout(w, "Bacaan penting: stok awal bukan angka bebas", [
        "Setelah produknya berjalan, jangan mengubah stok dengan mengedit angka produk. Gunakan Sesuaikan stok (Bagian 4) atau Penerimaan barang (Bagian 5) supaya alasan perubahannya ikut tercatat.",
      ]);
    },
  },
  {
    number: 4,
    title: "Cara 2: menambah atau mengurangi stok manual",
    render(w) {
      paragraph(
        w,
        "Jalur ini untuk penyesuaian yang tidak lewat supplier: barang titipan datang, barang rusak, susut, atau hitungan fisik berbeda dengan catatan.",
      );
      steps(w, [
        "Buka Produk & Stok, lalu cari produk yang ingin disesuaikan pada tabel.",
        "Tekan tombol Sesuaikan stok di kolom Aksi pada baris produk itu. Panel penyesuaian terbuka tepat di bawah barisnya.",
        "Isi Jumlah penyesuaian: angka biasa untuk menambah, angka negatif (misalnya -3) untuk mengurangi.",
        "Isi Catatan supaya alasannya bisa dibaca ulang, misalnya \u201cRusak saat pengiriman\u201d atau \u201cBarang datang tanpa PO\u201d.",
        "Periksa tulisan Stok jadi pada panel. Tombolnya hanya menyala kalau hasil akhirnya nol atau lebih.",
        "Tekan Sesuaikan stok. Pemberitahuan hijau menyebut stok terbaru produk itu.",
      ]);
      callout(w, "Jangan pakai jalur ini untuk menghitung seluruh toko", [
        "Untuk menghitung semua produk sekaligus, pakai sesi Opname (Bagian 7). Selisihnya tersimpan sebagai bukti audit, sedangkan penyesuaian manual hanya menyisakan catatan singkat.",
      ]);
    },
  },
  {
    number: 5,
    title: "Cara 3: mengisi stok lewat pembelian supplier",
    render(w) {
      paragraph(
        w,
        "Barang yang datang dari supplier tidak diketik langsung ke stok. Rantainya Permintaan pembelian (PR), Pesanan pembelian (PO), lalu Penerimaan barang (GRN), dan hanya langkah terakhir yang mengubah stok.",
      );
      steps(w, [
        "Buka menu Pembelian. Halaman ini dibaca dari atas: Permintaan pembelian (PR), Pesanan pembelian (PO), Penerimaan barang (GRN), lalu tagihan supplier.",
        "Pada kartu Permintaan pembelian (PR), pilih produk dan jumlah yang perlu dibeli, lalu kirim permintaannya. Staf gudang yang mengajukan, pemilik atau manajer yang menyetujui.",
        "Pada kartu Pesanan pembelian (PO), tekan Setujui pada PR yang masuk, tentukan supplier dan harga beli per produk, lalu buat pesanannya.",
        "Saat barang tiba, buka kartu Penerimaan barang (GRN), pilih PO yang menunggu barang, lalu isi jumlah yang benar-benar datang pada setiap baris.",
        "Pilih lokasi tujuan penerimaan: barang yang langsung dipajang masuk ke lokasi jual, barang yang disimpan dulu masuk ke gudang.",
        "Tekan Terima barang. Stok bertambah di lokasi yang dipilih, dan sisa pesanan dihitung ulang dari baris PO-nya.",
      ]);
      callout(w, "Kalau barangnya belum pernah ada di daftar produk", [
        "Buat dulu produknya lewat Produk & Stok, tombol Tambah produk, dengan stok awal 0. Setelah produknya ada, produk itu muncul di pilihan PR dan PO.",
      ]);
    },
  },
  {
    number: 6,
    title: "Pembelian lengkap: supplier, PR, PO, GRN, tagihan & pembayaran",
    render(w) {
      paragraph(
        w,
        "Bagian ini melengkapi jalur ketiga di atas sampai tuntas: menyiapkan supplier, memesan, menerima barang sebagian, mencatat tagihan supplier, memutuskan selisih dokumen, sampai membayar hutangnya. Semua langkah dikerjakan di satu halaman, menu Pembelian.",
      );
      subTitle(w, "Yang ada di halaman Pembelian");
      table(
        w,
        ["Bagian", "Isinya"],
        [
          [
            "Empat angka ringkas",
            "Menunggu persetujuan (PR yang belum diputuskan), PO terbuka beserta unit yang belum datang, Nilai PO terbuka, dan Diterima bulan ini.",
          ],
          ["Supplier", "Daftar supplier beserta tempo pembayaran (hari) dan status aktifnya."],
          [
            "Permintaan pembelian (PR)",
            "Permintaan dari staf gudang; pemilik/manajer menyetujui atau menolaknya.",
          ],
          [
            "Pesanan pembelian (PO)",
            "Pesanan ke supplier: siapa suppliernya, harga beli per unit, dan sisa barang yang belum datang.",
          ],
          [
            "Penerimaan barang (GRN)",
            "Barang yang benar-benar datang dicatat per baris, boleh sebagian, dan stok masuk ke lokasi yang dipilih.",
          ],
          ["Hutang usaha (AP)", "Tagihan supplier beserta jatuh tempo, umur, dan pelunasannya."],
          [
            "Pencocokan 3 arah",
            "Perbandingan dokumen supplier dengan yang dipesan (PO) dan yang datang (GRN).",
          ],
        ],
        [150, 350],
      );

      subTitle(w, "Langkah 1 - siapkan supplier");
      steps(w, [
        "Pada bagian Supplier, di sub-form Tambah supplier, isi Nama supplier; Kode akan diusulkan otomatis dan boleh diubah sebelum disimpan.",
        "Isi Tempo (hari): 30 berarti tagihan supplier jatuh tempo 30 hari setelah barang diterima; 0 berarti bayar langsung saat barang datang.",
        "Tekan Simpan supplier. Supplier aktif langsung muncul di pilihan saat membuat PO.",
      ]);

      subTitle(w, "Langkah 2 - ajukan permintaan pembelian (PR)");
      steps(w, [
        "Pada kartu Permintaan pembelian (PR), pilih Produk, isi Jumlah, dan tulis Catatan bila perlu (mis. \u201cstok rak depan\u201d).",
        "Tekan Tambah baris, lalu ulangi untuk produk lain bila permintaannya lebih dari satu.",
        "Tekan Kirim permintaan (jumlah baris). Permintaan bernomor PR- tercatat dengan status menunggu keputusan.",
      ]);

      subTitle(w, "Langkah 3 - setujui PR dan buat pesanan (PO)");
      steps(w, [
        "Pemilik atau manajer menekan Setujui pada baris PR yang masuk; Tombol Tolak menutup permintaan itu tanpa memesan apa pun.",
        "Pada bagian Pesanan pembelian (PO), pilih PR yang sudah disetujui, lalu pilih Supplier.",
        "Isi Harga beli / unit untuk setiap baris - kolomnya sudah terisi dari harga beli terakhir produk itu. Isi Perkiraan datang bila supplier memberi tanggalnya.",
        "Simpan pesanannya. PO bernomor PO- muncul dengan kolom Progres yang menunjukkan berapa unit sudah diterima dari yang dipesan (mis. 12 / 24).",
      ]);
      callout(w, "Supplier yang menunggak tidak dilayani PO baru", [
        "Kalau supplier masih punya hutang yang lewat jatuh tempo, namanya ditandai \u201c(menunggak)\u201d di daftar pilihan dan server menolak PO baru untuknya. Pesannya menyebut nominal yang harus dibayar dulu - jadi jalan keluarnya adalah melunasi (langkah 7), bukan mengakalinya dengan mengubah nama supplier.",
      ]);

      subTitle(w, "Langkah 4 - catat barang yang datang (GRN)");
      steps(w, [
        "Pada kartu Penerimaan barang (GRN), pilih PO yang menunggu barang. Pilihan ini hanya memuat PO yang masih punya sisa.",
        "Tentukan Lokasi tujuan: Lokasi jual bila barang langsung dipajang, atau gudang bila disimpan dulu.",
        "Isi Catatan dengan nomor surat jalannya, supaya penerimaan ini bisa dicocokkan dengan dokumen fisik.",
        "Periksa kolom Terima pada tiap baris: angkanya sudah terisi sisa pesanan (\u201csisa 12 dari 24\u201d). Ubah bila yang datang memang kurang, dan tulis 0 untuk barang yang belum datang.",
        "Tekan Terima barang. Stok bertambah di lokasi yang dipilih, angka Terima bulan ini naik, dan sisa PO dihitung ulang dari barisnya.",
      ]);
      callout(w, "Penerimaan sebagian itu normal", [
        "Barang yang datang bertahap tidak perlu ditunggu lengkap. Setiap penerimaan mencatat apa yang benar-benar datang, dan PO tetap terbuka dengan sisa yang tinggal. Riwayat penerimaan di bawah halaman memperlihatkan seluruh GRN yang pernah dibuat.",
      ]);

      subTitle(w, "Langkah 5 - tagihan supplier dan hutang usaha (AP)");
      steps(w, [
        "Supplier bertempo: begitu barang diterima, sistem membuat tagihan hutang dengan jatuh tempo sendiri. Tiga angka di bagian Hutang usaha memisahkan total terbuka, yang lewat jatuh tempo, dan yang jatuh tempo dalam 7 hari.",
        "Untuk tagihan di luar PO (saldo awal atau tagihan jasa), isi bagian Catat tagihan supplier (di luar PO): Supplier, Nomor tagihan, Nilai, dan Jatuh tempo - tanggal yang sudah lewat pun boleh, supaya umur hutang lamanya ikut benar.",
        "Tekan Simpan tagihan. Barisnya muncul di tabel hutang dengan kolom Umur (mis. \u201clewat 3 hari\u201d) dan kolom Sisa.",
      ]);

      subTitle(w, "Langkah 6 - cocokkan dokumen supplier (3 arah) dan putuskan selisihnya");
      steps(w, [
        "Buka kartu Pencocokan 3 arah (PO / GRN / tagihan). Empat angkanya memisahkan: Perlu ditinjau, Menunggu dokumen, Cocok, dan Sengketa.",
        "Tekan Tinjau pada tagihan yang ingin diperiksa. Alasan selisihnya ditulis di sana, misalnya tagihan lebih mahal dari PO atau jumlah yang ditagih melebihi yang diterima.",
        "Bila dokumen supplier belum dicatat, tekan Catat dokumen supplier: barisnya terisi dari barang yang benar-benar diterima, jadi tidak perlu mengetik ulang.",
        "Untuk selisih yang bisa diterima, tulis Catatan keputusan lalu tekan Terima selisih - nilai hutang mengikuti total tagihan supplier.",
        "Untuk tagihan yang dipertengkarkan, tekan Sengketa. Pembayarannya ditahan sampai sengketa itu dicabut lewat tombol Cabut sengketa.",
      ]);

      subTitle(w, "Langkah 7 - bayar hutang supplier");
      steps(w, [
        "Satu tagihan: tekan Bayar pada barisnya, isi Jumlah dibayar (boleh sebagian) dan metodenya, lalu simpan. Sisa hutangnya berkurang, dan pembayaran terakhir tercatat di bawah tabel.",
        "Beberapa tagihan sekaligus: centang tagihan yang ingin dibayar, pilih Metode, lalu tekan Bayar terpilih. Semuanya dibayar dalam satu nomor batch PAY- tetapi jejaknya tetap satu baris per tagihan, jadi rekonsiliasi bank tetap bisa dicocokkan.",
        "Tagihan yang sedang disengketakan tidak bisa dicentang - pembayarannya memang ditahan sampai sengketa selesai.",
      ]);
      callout(w, "Kalau penerimaan barang ditolak", [
        "Tiga sebab yang paling sering: PO-nya belum disetujui (setujui PR dulu), jumlah yang diterima melebihi sisa pesanan (kurangi angkanya), atau gudang tujuannya sedang nonaktif (aktifkan dulu di halaman Gudang & Stok).",
      ]);
    },
  },
  {
    number: 7,
    title: "Memindahkan stok dari gudang ke lokasi jual",
    render(w) {
      paragraph(
        w,
        "Kasir hanya menjual dari lokasi jual. Barang yang tersimpan di gudang harus dipindahkan lebih dulu, persis seperti stok fisik yang dibawa ke rak depan.",
      );
      steps(w, [
        "Buka menu Gudang & Stok. Halaman ini memperlihatkan jumlah lokasi, stok yang bisa dijual, dan stok yang masih di gudang.",
        "Pilih produk pada bagian Pindah stok antar lokasi.",
        "Tentukan lokasi asal di kolom Dari (misalnya Gudang Utama) dan lokasi tujuan di kolom Ke (misalnya Lokasi jual).",
        "Isi Jumlah dan catatan bila perlu, lalu tekan Pindah stok. Satu perpindahan dicatat sebagai dua baris ledger bernomor TRF- sehingga total stok tidak berubah karena pemindahan.",
        "Periksa tabel Stok per lokasi untuk memastikan angkanya sudah berpindah.",
        "Untuk menambah gudang baru, isi bagian Tambah gudang lalu tekan Simpan gudang. Fitur ini memerlukan paket yang memuat gudang tambahan.",
      ]);
      callout(w, "Gudang yang masih berisi stok", [
        "Gudang yang masih menyimpan stok tidak bisa dinonaktifkan. Kalau dipaksa, stoknya hilang dari pandangan padahal fisiknya masih ada di rak gudang.",
      ]);
    },
  },
  {
    number: 8,
    title: "Opname lengkap: hitung fisik, selisih, dan posting",
    render(w) {
      paragraph(
        w,
        "Opname adalah cara resmi membandingkan catatan dengan kenyataan. Hitungannya disimpan sebagai bukti audit, stok baru berubah setelah sesinya diposting, dan sesi yang dibatalkan tidak mengubah apa pun.",
      );
      subTitle(w, "Empat angka di atas halaman");
      table(
        w,
        ["Angka", "Artinya"],
        [
          ["Sesi berjalan", "Sesi yang belum diposting, beserta berapa baris yang masih tersisa."],
          ["Selesai", "Sesi yang sudah diposting ke ledger stok."],
          ["Dibatalkan", "Sesi yang ditutup tanpa mengubah stok."],
          ["Selisih berjalan", "Selisih bersih (unit) dari sesi yang belum diposting."],
        ],
        [130, 370],
      );

      subTitle(w, "Langkah menghitung");
      steps(w, [
        "Buka menu Opname, lalu pilih lokasi pada kolom Lokasi yang dihitung - lokasi jual atau salah satu gudang.",
        "Isi Catatan sesi bila perlu (mis. \u201copname akhir bulan\u201d), lalu tekan Mulai hitung <nama lokasi>.",
        "Sesi bernomor OPN- terbentuk dan muncul sebagai kartu. Buka kartunya untuk melihat daftar produknya.",
        "Hitung barang di rak, lalu tulis jumlah fisiknya di kolom Hitung fisik. Angka tersimpan begitu Anda pindah kolom atau menekan Enter.",
        "Ulangi untuk produk lain. Bilangan yang belum dihitung dibiarkan kosong - bukan nol.",
        "Setelah selesai, tekan Posting hasil hitung. Satu baris ledger ditulis untuk setiap baris yang selisihnya tidak nol, dan stok mengikuti hasil hitung itu.",
      ]);

      subTitle(w, "Membaca kolomnya dengan benar");
      table(
        w,
        ["Kolom", "Isinya"],
        [
          [
            "Sistem (snapshot)",
            "Saldo lokasi saat sesi dimulai. Angka ini tidak berubah walau ada penjualan setelahnya.",
          ],
          [
            "Sekarang",
            "Saldo lokasi saat ini. Berbeda dari snapshot kalau ada penjualan atau penerimaan selagi Anda menghitung.",
          ],
          ["Hitung fisik", "Jumlah yang Anda lihat dan hitung di rak."],
          [
            "Selisih",
            "Hitung fisik dikurangi saldo snapshot. Angka negatif berarti stok kurang dari catatan saat sesi dibuat.",
          ],
        ],
        [120, 380],
      );
      callout(w, "Selisih diterapkan terhadap saldo terakhir, bukan snapshot", [
        "Saat posting, sistem menulis selisih antara jumlah hitung fisik dan saldo lokasi pada saat itu. Ini yang membuat opname tetap benar walau toko masih berjualan selama penghitungan: penjualan yang terjadi di tengah proses tidak ikut terhapus oleh hasil hitung.",
      ]);

      subTitle(w, "Aturan yang ditegakkan server");
      bullets(w, [
        "Satu lokasi hanya boleh punya satu sesi berjalan. Membuka sesi kedua ditolak dengan pesan yang menyebut nomor sesi lama - selesaikan atau batalkan sesi itu dulu.",
        "Lokasi tanpa produk berstok tidak bisa dimulai sesinya, karena tidak ada yang bisa dihitung.",
        "Posting hanya perlu ada minimal satu baris yang dihitung, jadi hitung sebagian (cycle count) tetap sah dan berguna.",
        "Sesi yang sudah diposting atau dibatalkan tidak bisa diubah lagi. Untuk menghitung ulang, mulai sesi baru.",
        "Hitungan disimpan sebagai bilangan bulat, tidak boleh negatif, dan ada batas kewajaran untuk mencegah salah ketik.",
      ]);
      callout(w, "Gerbang paket dan izin", [
        "Membuka sesi baru butuh fitur inventory.opname (paket Enterprise). Menghitung, memposting, dan membatalkan hanya butuh izin inventory.manage - jadi paket yang turun tidak membuat hitungan fisik yang sudah dikerjakan hilang, dan sesi lama tetap bisa diselesaikan.",
        "Kalau tombol Posting hasil hitung tidak menyala, sebabnya tertulis di sebelahnya di dalam aplikasi - biasanya belum ada satu baris pun yang dihitung.",
      ]);
    },
  },
  {
    number: 9,
    title: "Menjual di kasir",
    render(w) {
      paragraph(
        w,
        "Setelah stok terisi, penjualan berjalan di menu Kasir (POS). Setiap penjualan yang selesai otomatis mengurangi stok lokasi jual.",
      );
      steps(w, [
        "Buka menu Kasir (POS). Grid produk tampil dengan angka stoknya, beserta foto produk untuk produk yang fotonya sudah diunggah di halaman Produk & Stok.",
        "Klik produk untuk memasukkannya ke keranjang; klik lagi untuk menambah jumlahnya. Foto produknya ikut tampil di baris keranjang, jadi barang yang dihitung gampang dicocokkan dengan yang dipegang pembeli.",
        "Produk yang belum difoto tetap bisa dijual: kartunya bertanda belum ada gambar. Kalau belum ada satu pun produk berfoto, kartunya kembali ringkas tanpa kotak gambar.",
        "Di header ada tombol Layar penuh: sidebar kiri disembunyikan supaya grid produk memakai seluruh lebar layar. Tekan sekali lagi (atau Esc) untuk memunculkan sidebar kembali; tombol Keluar tetap terlihat karena headernya tidak ikut disembunyikan.",
        "Untuk produk bermodifier (level pedas, topping), dialog pilihan muncul lebih dulu. Grup bertanda wajib harus dipilih sebelum pesanan bisa disimpan.",
        "Pilih metode pembayaran: Tunai, QRIS, atau Kartu. Untuk Tunai, tekan tombol pecahan uang yang diserahkan pembeli - Rp 10.000, 20.000, 50.000, 100.000, atau 500.000 - atau ketik sendiri nominalnya kalau uangnya bukan pecahan pas. Kembaliannya dihitung otomatis.",
        "Bila pelanggan membayar sebagian, isi Dibayar sekarang lebih kecil dari total. Sisanya menjadi piutang yang ditagih di halaman Piutang (modul Grosir).",
        "Tekan Selesaikan pembayaran. Begitu penjualannya tercatat, dialog Struk belanja terbuka: di situ Anda memilih mencetak notanya, mengunduh PDF-nya, atau mengirimkannya ke WhatsApp pembeli. Sebelum pembayarannya lunas, tombol cetak & kirim struk belum ditawarkan sama sekali - pilihannya baru muncul setelah ada nota yang benar-benar dibayar. Berlaku untuk semua cara bayar yang mencatat penjualan - tunai, kartu, tempo, dan QRIS yang tagihannya sudah lunas.",
        "Untuk memeriksa penjualan yang sudah tercatat di shift ini, tekan tombol Transaksi terakhir (shift ini) di bagian bawah halaman kasir. Daftarnya muncul dari bawah layar: nomor nota, jam, jumlah item, metode bayar, dan totalnya, terbaru di atas, ditutup dengan tombol silang, tekanan Escape, atau sentuhan di latar gelapnya.",
      ]);
      callout(w, "Struk: cetak, PDF, atau WhatsApp", [
        "Cetak - dialog struk yang terbuka sesudah pelunasan menawarkan dua jalan: Cetak ke printer (langsung ke mesinnya lewat USB atau Bluetooth, tanpa dialog cetak sistem - syaratnya di bagian Printer & kertas struk) dan Cetak lewat dialog peramban. Keduanya memakai printer & setelan struk workspace, termasuk rangkapnya untuk printer dot matrix. Tombol Cetak di panel keranjang baru muncul setelah pembayarannya lunas, dan gunanya mencetak ulang nota itu, misalnya kertasnya habis di tengah antrean - keranjang yang sedang disusun berikutnya tidak ikut tercetak.",
        "Unduh PDF - berkasnya dibuat di perangkat kasir, tanpa diunggah ke mana pun. Ukuran halamannya selebar kertas struknya, logonya ikut tercetak di atas nama usaha (sama seperti di kertas), dan namanya memakai nomor nota, contoh struk-A-00042.pdf, jadi gampang dicari di folder unduhan.",
        "Kirim ke WhatsApp pembeli - gambar struknya dikirim ke WhatsApp pembelinya, bukan PDF-nya: lewat pesan gambar, struk beserta logo tokonya langsung terlihat di percakapan tanpa dibuka lebih dulu. Untuk pembeli yang terdaftar sebagai member, nomornya diambil dari data member (diisi sendiri di halaman Member) dan nomor itulah yang diutamakan - kasir tidak perlu mengetik apa pun, dan member yang belum mengisi nomornya ditawari kolom nomor di dialog struk supaya kirimannya tidak perlu menunggu profilnya dilengkapi. Langkah lengkap beserta syarat kanalnya ada di bagian Kirim struk ke WhatsApp pembeli.",
        "Pembeli umum (penjualan tanpa member sama sekali) juga bisa dikirimi struk: di dialog struknya muncul kolom Nomor WhatsApp pembeli. Tulis nomor yang diberikan pembelinya (mis. 0812-3456-7890) lalu tekan kirim - nomornya divalidasi dulu, dan yang belum sah ditolak beserta sebabnya. Nomor itu dipakai sekali untuk kiriman tersebut; ia tidak disimpan sebagai data member. Tiap kiriman tetap tercatat di jejak audit beserta asal nomornya (dari data member atau diketik kasir) dan nomor tujuannya ditampilkan tersensor, mis. 6281-••••-890.",
        "Kanal WhatsApp-nya diatur pemilik workspace lewat dua kunci di lingkungan deployment (WHATSAPP_ACCESS_TOKEN dan WHATSAPP_PHONE_NUMBER_ID; versi Graph API opsional). Selama kuncinya belum diisi, tombol kirimnya menjawab apa adanya bahwa kanalnya belum tersambung, dan struknya tetap bisa dicetak atau diunduh - jalur tanpa kunci & syaratnya dibahas di bagian Kirim struk ke WhatsApp pembeli.",
      ]);
      callout(w, "Dapur di workspace F&B", [
        "Di kafe/restoran, pesanan yang dibayar di kasir - tunai, QRIS, maupun Virtual Account - langsung dikirim ke dapur pada momen pembayarannya: tiketnya muncul di menu Dapur & Meja dengan penanda cara bayarnya (mis. Lunas Tunai, diterima dapur pukul 13:42), dan dialog struk yang terbuka otomatis menyebutkan bahwa pesanannya sudah diterima dapur. Stoknya sudah berkurang saat uangnya dicatat, jadi dapur cukup menandai tiketnya Selesai - tanpa menggerakkan stok untuk kedua kalinya.",
        "Meja yang dipakai pesanan itu tetap terkunci untuk kasir sampai dapur menekan Selesai: kasir tidak bisa memilih meja itu lagi untuk pembeli berikutnya, karena tamunya masih menunggu pesanannya di situ. Meja yang tiketnya sudah ditandai Selesai langsung bebas dipakai lagi.",
        "Keranjang yang belum dibayar ditahan sementara dengan tombol Hold supaya pembeli berikutnya bisa dilayani lebih dulu, lalu transaksinya dilanjutkan dari daftar Transaksi ditahan di halaman kasir. Selama ditahan belum ada uang, stok, atau tiket dapur yang tercatat - yang ditahan memang urusan layar kasir. Meja yang sudah dipilih ikut ditahan selama transaksinya ada di daftar itu.",
        "QRIS pada workspace dengan kanal tagih digital menerbitkan tagihan lebih dulu; penjualannya baru tercatat setelah tagihan itu lunas.",
      ]);
    },
  },
  {
    number: 10,
    title: "Shift kas dan laporan harian",
    render(w) {
      steps(w, [
        "Sebelum mulai melayani, buka menu Shift & Kas dan tekan Buka shift. Isi Kas awal, yaitu uang kembalian yang ada di laci.",
        "Halaman Kasir memang terkunci sebelum shiftnya dibuka: tanpa shift yang terbuka, kartu merah Kasir terkunci - shift (kas) belum dibuka muncul di atas daftar produk, dan kartu produk, pemilih meja, tombol Hold, serta tombol Bayar dimatikan. Buka shiftnya dulu di halaman Shift & Kas lewat tombol Buka shift sekarang, lalu keranjang dan pembayaran hidup kembali.",
        "Setelah selesai melayani, tekan Tutup shift & simpan Z-report. Uang di laci dicocokkan dengan penjualan yang tercatat.",
        "Kasir juga diingatkan supaya tidak lupa menutup shift: halaman Kasir menampilkan banner di atas daftar produk, dan halaman Shift & Kas menampilkan kartu pengingat yang sama, begitu jam pengingatnya lewat, shift sudah berjalan melewati ambangnya, atau shift kemarin belum ditutup. Banner di halaman Kasir disertai tautan Tutup shift sekarang.",
        "Jam pengingat dan ambang shift lamanya diatur pemilik toko di menu Pengaturan, kartu Pengingat tutup shift: jamnya dipilih 0-23 (bawaan 21.00), ambang shift lama 1-24 jam (bawaan 14 jam), dan pengingatnya bisa dimatikan untuk toko yang buka 24 jam.",
        "Hasil penjualan dan stok yang bergerak bisa dibaca di menu Laporan.",
      ]);
      callout(w, "Mengapa shift penting", [
        "Selisih kas selalu punya shift pemiliknya. Tanpa shift yang dibuka dan ditutup, selisih uang tidak bisa ditelusuri ke orang dan waktu.",
        "Karena itu penjualan barunya juga tidak boleh dimulai tanpa shift: kas yang belum dibuka berarti uang kembalian awalnya tidak diketahui, dan selisihnya tidak bisa dicocokkan ke siapa pun. Saklar pengingat di halaman Pengaturan hanya mematikan pengingatnya, bukan gerbang ini.",
      ]);
      callout(w, "Izin halaman ini: shift.manage", [
        "Halaman Shift & Kas beserta tombol Buka/Tutup shift dan kabar kas ke pemilik toko dijaga izin shift.manage - bukan pos.sell. Kasir yang melayani penjualan membutuhkan keduanya (penjualan menuntut shift terbuka), sedangkan pengawas kas bisa diberi shift.manage saja tanpa bisa menjual. Mengatur izin peran ada di halaman Tim & Peran (paket Enterprise).",
      ]);
    },
  },
  {
    number: 11,
    title: "Merapikan produk yang sudah tersimpan: ubah, nonaktifkan, hapus",
    render(w) {
      paragraph(
        w,
        "Produk yang sudah dibuat tidak perlu dibiarkan apa adanya. Di halaman Produk & Stok, kolom Aksi pada setiap baris menyediakan tiga pekerjaan rumah tangga: memperbaiki identitasnya, menghentikan penjualannya, atau menghapusnya kalau memang belum dipakai.",
      );
      table(
        w,
        ["Tombol di kolom Aksi", "Kapan dipakai"],
        [
          [
            "Atur harga",
            "Mengubah harga jual, satuan, tier grosir, gambar, serta nama, SKU, dan harga beli produk.",
          ],
          [
            "Nonaktifkan",
            "Produk berhenti dijual, tetapi semua datanya tetap ada dan bisa dinyalakan lagi kapan saja.",
          ],
          [
            "Hapus",
            "Hanya untuk produk yang belum pernah terjual, stoknya nol, dan tidak dipakai dokumen mana pun.",
          ],
        ],
        [130, 370],
      );

      subTitle(w, "Memperbaiki nama, SKU, atau harga beli");
      bullets(w, [
        "Tekan Atur harga pada baris produknya. Selain harga dan kategori, kartu itu memuat kolom Nama produk, SKU, dan Harga beli.",
        "Ubah yang perlu, lalu tekan Simpan harga. Hanya kolom yang benar-benar berubah yang disimpan - notis di bawah tabel menyebutkannya satu per satu.",
        "Harga jual tidak ikut berubah oleh kolom itu, dan harga beli hanya dipakai menghitung margin, bukan harga yang dibayar pelanggan.",
        "SKU harus unik di dalam satu workspace; SKU yang sudah dipakai produk lain ditolak, termasuk kalau hanya berbeda huruf besar-kecil.",
        "Mengganti Kategori tetap jalur tersendiri: kode di tengah SKU buatan sistem ikut menyesuaikan, sedangkan SKU yang Anda ketik sendiri tidak pernah diubah.",
      ]);

      subTitle(w, "Menghentikan penjualan tanpa kehilangan data");
      bullets(w, [
        "Tekan Nonaktifkan pada baris produknya. Baris itu langsung bertanda Nonaktif, dan judul tabel tetap menghitung berapa produk yang aktif.",
        "Produk nonaktif hilang dari kasir dan dari katalog penjualan, termasuk kalau keranjang di perangkat lama masih menyimpannya - penjualannya ditolak server.",
        "Stok, riwayat penjualan, dokumen supplier, dan kartu Atur harga-nya tetap ada. Menyalakannya kembali cukup satu tombol Aktifkan.",
        "Memasukkan produk ke kategori yang dinonaktifkan berbeda halnya: itu urusan kategori, bukan status produknya.",
      ]);

      subTitle(w, "Menghapus produk - dan kenapa sering ditolak");
      bullets(w, [
        "Tekan Hapus pada baris produknya. Dialog konfirmasi menampilkan hasil pemeriksaan server: produknya layak dihapus atau tidak, beserta alasannya.",
        "Produk dengan stok tersisa, pernah terjual, punya pergerakan stok, dipakai dokumen pembelian, atau ikut sesi opname tidak bisa dihapus - struk, buku besar stok, dan dokumen supplier lamanya harus tetap bisa dibuka.",
        "Untuk produk seperti itu, dialognya menawarkan Nonaktifkan saja: produknya berhenti dijual tanpa satu pun catatan yang menggantung.",
        "Kalau produknya memang belum pernah dipakai, tombol Hapus produk aktif dan produknya benar-benar dibuang beserta gambarnya.",
      ]);
      callout(w, "Ragu antara menghapus dan menonaktifkan? Pilih nonaktifkan", [
        "Menonaktifkan selalu bisa dibatalkan, sedangkan menghapus tidak. Untuk produk yang hanya berhenti dijual, nonaktifkan sudah cukup: kasir tidak lagi menawarkannya, dan riwayatnya tetap utuh.",
      ]);
    },
  },
  {
    number: 12,
    title: "Kalau stok tidak sesuai: pemecahan masalah",
    render(w) {
      table(
        w,
        ["Gejala", "Sebab yang paling sering", "Tindakan"],
        [
          [
            "Stok bertambah, tetapi kasir tidak bisa menjualnya.",
            "Barangnya masuk ke gudang, bukan ke lokasi jual.",
            "Buka Gudang & Stok, lalu pindahkan stoknya ke Lokasi jual.",
          ],
          [
            "Angka stok benar, tetapi produknya tidak muncul di kasir.",
            "Produknya nonaktif, atau modul yang dibutuhkan produk itu mati.",
            "Periksa status produk di Produk & Stok dan modulnya di halaman Modul.",
          ],
          [
            "Penerimaan barang ditolak.",
            "PO belum disetujui, atau jumlah yang diterima melebihi sisa pesanan.",
            "Setujui PO-nya lebih dulu, lalu samakan jumlah penerimaan dengan sisa pada baris PO.",
          ],
          [
            "Tombol Mulai hitung di halaman Opname mati.",
            "Lokasi itu masih punya sesi opname yang berjalan, atau paket tidak memuat fiturnya.",
            "Selesaikan atau batalkan sesi lama; periksa paket di halaman Langganan.",
          ],
          [
            "Pesan \u201cstok tidak cukup\u201d saat menjual.",
            "Stok lokasi jual lebih kecil dari jumlah yang dijual.",
            "Isi ulang stok (Bagian 3, 4, atau 5), lalu periksa lagi angka stok di kasir.",
          ],
          [
            "Perubahan stok tidak terlihat di perangkat lain.",
            "Halaman belum memuat data terbaru.",
            "Muat ulang halaman. Untuk perangkat yang sering terputus, pakai menu Sinkronisasi.",
          ],
        ],
        [140, 170, 190],
      );
    },
  },
  {
    number: 13,
    title: "Peran dan izin untuk pekerjaan stok",
    render(w) {
      paragraph(
        w,
        "Izin di MesinPOS dipisah menurut pekerjaan, bukan menurut jabatan. Tabel ini memetakan pekerjaan stok ke izin yang dibutuhkan dan peran yang memegangnya.",
      );
      table(w, ["Pekerjaan", "Izin", "Peran"], ROLE_ROWS, [210, 120, 170]);
      paragraph(
        w,
        "Peran bawaan tidak bisa diubah, tetapi peran kustom bisa dibuat di halaman Tim & Peran bila pembagian kerjanya berbeda (fitur peran kustom ada di paket Enterprise).",
        { color: C.muted, size: 10 },
      );
    },
  },
  {
    number: 14,
    title: "Istilah, rumus, dan verifikasi teknis",
    render(w) {
      subTitle(w, "Istilah stok");
      table(
        w,
        ["Istilah", "Arti"],
        [
          [
            "SKU",
            "Kode unik produk di dalam satu workspace. Dikosongkan berarti dibuat otomatis dengan format PBB-<KATEGORI>-<nomor urut> (contoh PBB-SAN-000042).",
          ],
          [
            "Lokasi jual",
            "Tempat kasir menjual; angka inilah yang tampil sebagai Stok di halaman Produk & Stok.",
          ],
          ["Gudang", "Lokasi penyimpanan tambahan; stok di sini belum bisa dijual."],
          [
            "Ledger stok",
            "Catatan setiap pergerakan stok beserta alasannya: penjualan, penyesuaian, pemindahan (TRF), penerimaan (GRN).",
          ],
          [
            "PR / PO / GRN",
            "Permintaan pembelian, pesanan pembelian, dan penerimaan barang dari supplier.",
          ],
          [
            "Opname",
            "Penghitungan fisik stok; selisihnya disimpan sebagai bukti audit sebelum stok berubah.",
          ],
        ],
        [110, 390],
      );
      subTitle(w, "Rumus yang dipakai sistem");
      bullets(w, [
        "Total stok satu produk = jumlah di lokasi jual + jumlah di semua gudang.",
        "Stok yang bisa dijual = jumlah di lokasi jual saja.",
        "Selisih opname = jumlah hitung fisik dikurangi stok sistem pada saat sesi dibuat.",
        "Sisa pesanan pada PO = jumlah dipesan dikurangi jumlah yang sudah diterima.",
      ]);
      subTitle(w, "Untuk tim teknis: memeriksa aturan stok");
      paragraph(
        w,
        "Aturan stok, gudang, pembelian, dan opname punya harness sendiri dan bisa dijalankan tanpa server:",
      );
      codeBlock(w, [
        "bun scripts/verify-inventory.mjs     # gudang + perpindahan stok",
        "bun scripts/verify-purchasing.mjs    # rantai PR / PO / GRN",
        "bun scripts/verify-opname.mjs        # opname + bukti selisih",
        "bun scripts/verify-product-sku.mjs   # SKU otomatis PBB-<KATEGORI>-<nomor>",
        "bun scripts/verify-product-edit.mjs  # ubah produk, aktif/nonaktif, pagar hapus",
        "bun scripts/verify-tax.mjs           # tarif PPN + aktif/nonaktifnya",
        "bun scripts/verify-struk.mjs         # struk: printer, kertas, logo, kasir",
        "bun tsc -b --noEmit                  # pemeriksaan tipe seluruh proyek",
      ]);
      callout(w, "Menghasilkan ulang panduan ini", [
        "Berkas PDF ini dibuat dari skrip di repositori. Jalankan bun run panduan:pdf untuk membangunnya kembali setelah ada perubahan alur.",
      ]);
    },
  },
  {
    number: 15,
    title: "PPN: mengubah tarif dan mematikannya",
    render(w) {
      paragraph(
        w,
        "Satu setelan PPN berlaku untuk seluruh dokumen workspace: struk penjualan di kasir dan tagihan langganan workspace ini memakai angka yang sama, jadi pemilik toko tidak pernah melihat dua pajak berbeda dari satu keputusan.",
      );
      subTitle(w, "Mengubah tarif");
      steps(w, [
        "Buka menu Pengaturan di sidebar kiri. Izinnya billing.manage - pemilik, manajer, dan keuangan.",
        "Isi kolom Tarif PPN (%). Angka Indonesia boleh memakai koma, misalnya 11 atau 11,5; tombol 5% / 11% / 12% mengisi tarif yang sering dipakai.",
        "Periksa contoh perhitungan di sebelah kolomnya: belanja 100.000 sebelum pajak, nilai PPN-nya, dan total yang dibayar pembeli.",
        "Tekan Simpan setelan PPN. Angka di kasir dan di tagihan langganan langsung memakai tarif baru; penjualan yang sudah tercatat tidak berubah.",
      ]);
      subTitle(w, "Mematikan PPN");
      steps(w, [
        "Tekan Matikan PPN, lalu Simpan setelan PPN. Tarifnya tetap tersimpan supaya bisa dinyalakan lagi dengan angka yang sama.",
        "Struk penjualan berikutnya tidak memungut pajak: baris PPN di keranjang kasir hilang, bukan menampilkan nol.",
      ]);
      callout(w, "Yang perlu diketahui", [
        "PPN tidak aktif berbeda dari PPN 0%: karena itu setelan aktif dengan tarif 0% ditolak, supaya pembaca struk tidak menebak mana yang sedang berlaku.",
        "Tarif bisa dinaikkan maupun diturunkan: struk berikutnya memungut angka yang tersimpan saat itu, misalnya 12,5% lalu diturunkan ke 5%.",
        "Setiap perubahan meninggalkan jejak audit. Pindah paket atau mengubah modul tidak menyentuh setelan ini.",
      ]);
    },
  },
  {
    number: 16,
    title: "Logo toko: di sidebar dan setiap struk",
    render(w) {
      paragraph(
        w,
        "Logo toko adalah identitas workspace Anda. Ia tampil di sidebar aplikasi sebagai penanda workspace, dan tercetak di atas nama usaha pada setiap lembar struk belanja - termasuk lembar tembusan.",
      );
      subTitle(w, "Memasang logo");
      steps(w, [
        "Siapkan berkas logonya: JPG, PNG, atau WebP, maksimal 1 MB. Gambar besar diperkecil otomatis sebelum diunggah, jadi foto dari ponsel pun aman.",
        "Buka menu Pengaturan di sidebar kiri, lalu cari kartu Struk belanja. Izinnya billing.manage - pemilik, manajer, dan keuangan.",
        "Di seksi Logo toko, tekan Tambah logo (atau Ganti logo kalau sudah ada). Logonya langsung tersimpan; setelan struk tidak perlu disimpan ulang.",
        "Periksa pratinjau struk di sebelahnya: logonya digambar di atas nama usaha dengan ukuran dan warna yang sama seperti yang akan keluar di kertas, jadi tidak perlu mencetak satu lembar pun untuk memeriksanya.",
        "Untuk melepasnya, tekan Hapus logo. Struk berikutnya dicetak tanpa logo, dan sidebar kembali memakai ikon bawaan.",
      ]);
      subTitle(w, "Di mana logonya muncul");
      bullets(w, [
        "Sidebar kiri - penanda workspace yang sedang dibuka, di samping nama MesinPOS.",
        "Pratinjau struk di halaman Pengaturan, jadi bentuk struknya terlihat sebelum satu lembar pun tercetak.",
        "Setiap lembar struk di kasir, juga saat printer dot matrix mencetak rangkap.",
        "Ukurannya tetap 110 px x 110 px (sekitar 29 mm) di semua kertas: kertas 58 mm maupun faktur 241 mm memakai logo yang sama besarnya.",
        "Warnanya dipaksa hitam putih, sama seperti teks struknya. Printer struk hanya punya satu warna tinta, jadi logo berwarna yang dicetak apa adanya keluar sebagai bercak kelabu.",
      ]);
      callout(w, "Yang perlu diketahui", [
        "Satu logo per workspace. Mengunggah logo baru otomatis mengganti yang lama, termasuk berkasnya di penyimpanan, jadi tidak ada logo lama yang menumpuk.",
        "Ukuran di struk dibatasi sistem, bukan mengikuti ukuran berkas: logo yang dikecilkan sendiri lebih dulu justru terlihat paling rapi, karena logo selebar kertas akan mendorong nama usaha dan daftar barangnya ke halaman berikutnya.",
        "Kasir tidak perlu mengatur apa pun. Logo dipakai bersama seluruh kasir di workspace ini, dan struk yang sudah tercetak tidak berubah.",
      ]);
    },
  },
  {
    number: 17,
    title: "Printer & kertas struk: memilih mesin dan ukurannya",
    render(w) {
      paragraph(
        w,
        "Struk adalah satu-satunya keluaran MesinPOS yang keluar dari mesin fisik, jadi setelannya ada di kartu Struk belanja pada halaman Pengaturan. Izinnya billing.manage - pemilik, manajer, dan keuangan. Yang dipilih di kartu itu benar-benar mengubah apa yang tercetak dari tombol cetak di kasir, bukan hanya tampilan di layar.",
      );
      subTitle(w, "Memilih jenis printer");
      steps(w, [
        "Buka menu Pengaturan di sidebar kiri, lalu cari kartu Struk belanja.",
        "Di seksi Jenis printer struk, tekan kartu mesin yang benar-benar ada di kasir. Tiap kartu menyebut cara kerjanya, kelebihan, kekurangan, kertas yang didukung, dan contoh produknya - termasuk kabar buruknya, supaya tidak baru diketahui setelah mesinnya dibeli.",
        "Thermal: elemen pemanas membakar lapisan kimia kertas, paling cepat dan tanpa tinta atau pita, tetapi hasilnya bisa memudar kena panas atau minyak. Kertasnya 58 mm (32 kolom) atau 80 mm (48 kolom), satu lembar sekali cetak.",
        "Dot matrix: jarum-jarum kecil (pinhead) memukul pita karbon ke kertas, jadi satu-satunya jenis yang bisa mencetak rangkap (tembusan karbon) dan tahan panas - konsekuensinya mesinnya bising dan cetaknya lebih lambat. Kertasnya 76 mm (40 kolom) atau faktur kontinu 241 mm (80 kolom), sampai tiga lembar sekali cetak.",
        "Portable (Bluetooth): printer thermal kecil berbaterai untuk ponsel atau tablet. Ringkas dan tanpa kabel, tetapi gulungan kertasnya lebih kecil dan hanya 58 mm (32 kolom), satu lembar sekali cetak.",
        "Pilih lebar kertas dari pilihan yang memang didukung mesin itu - 80 mm di printer portable 58 mm akan terpotong di kertas, jadi pilihannya memang dibatasi. Tekan Simpan setelan struk supaya pilihannya sampai ke kasir.",
      ]);
      table(
        w,
        ["Jenis printer", "Kertas yang didukung", "Rangkap sekali cetak"],
        [
          [
            "Thermal - cepat, senyap, tanpa tinta",
            "58 mm (32 kolom) / 80 mm (48 kolom)",
            "1 lembar",
          ],
          [
            "Dot matrix - bisa tembusan karbon, bising",
            "76 mm (40 kolom) / 241 mm (80 kolom)",
            "sampai 3 lembar",
          ],
          ["Portable - ringkas, berbaterai, Bluetooth", "58 mm (32 kolom)", "1 lembar"],
        ],
        [190, 180, 110],
      );
      subTitle(w, "Saran setelan yang dihitung dari modul workspace");
      paragraph(
        w,
        "Di atas ketiga katalog itu ada kartu Saran setelan otomatis: satu jawaban untuk pertanyaan printer apa yang saya butuhkan, beserta alasannya. Dasarnya modul yang benar-benar hidup di workspace ini, bukan paket langganan - yang menentukan bentuk nota adalah apa yang dijual tokonya.",
      );
      bullets(w, [
        "Grosir tanpa F&B -> dot matrix 76 mm, 2 lembar: nota tempo ditandatangani dan diarsipkan, jadi tembusan karbonnya bernilai - dan tembusan hanya bisa di printer berpita.",
        "F&B, termasuk kafe yang sekaligus grosir -> thermal 80 mm, 1 lembar: nama menu dan catatan pesanannya panjang, sementara meja kasirnya melayani pembeli langsung.",
        "Ritel atau UMKM biasa, juga workspace yang belum mengaktifkan modul apa pun -> thermal 80 mm, 1 lembar, ukuran thermal yang paling banyak dipakai kasir ritel.",
        "Lencana di kartu itu menyebut dasar penentuannya (misalnya Modul Grosir & Wholesale), dan alasannya ditulis dengan bahasa toko. Tombol Pakai saran ini mengisi pilihan mesinnya - printer, kertas, dan rangkap - tanpa menyentuh catatan kaki yang sedang diketik; kalau pilihan mesinnya sudah sama, tombolnya membaca Sudah sesuai dan ikut terkunci.",
        "Saran itu ditawarkan, bukan ditulis sendiri ke setelannya: peramban tidak punya cara melihat printer yang benar-benar terpasang, dan memilih jalur dot matrix untuk toko grosir yang mesin kasirnya thermal membuat struknya tidak keluar sama sekali.",
      ]);
      subTitle(w, "Yang menyesuaikan sendiri tanpa ditanya");
      bullets(w, [
        "Lebar kertas mengikuti jenis printer yang dipilih. Lebar yang tidak didukung mesin barunya dipindahkan ke kertas terdekat - 76 mm menjadi 80 mm saat pindah dari dot matrix ke thermal, faktur 241 mm menjadi 80 mm, dan 80 mm di printer portable menjadi 58 mm - bukan jatuh ke kertas pertama yang selalu paling sempit.",
        "Rangkap dipangkas ke kemampuan mesinnya: printer thermal dan portable tidak bisa tembusan karbon, jadi permintaan lebih dari satu lembar ditolak server dengan alasan yang menyebut printer dot matrix.",
      ]);
      subTitle(w, "Cetak langsung dari kasir (ESC/POS)");
      paragraph(
        w,
        "Sesudah pembayaran, dialog struk di kasir menawarkan Cetak ke printer: perintah printer dikirim langsung dari halaman kasir ke mesinnya, jadi dialog cetak sistem tidak muncul sama sekali dan ukuran kertasnya tidak perlu dipilih lagi.",
      );
      steps(w, [
        "Di dialog struk, pilih jalurnya lebih dulu: USB (kabel ke komputer kasir) atau Bluetooth (printer portabel).",
        "Tekan Sambungkan, lalu pilih printernya di jendela yang muncul dari peramban. Setelah itu tekan Cetak ke printer - struknya keluar tanpa dialog cetak sistem.",
        "Peramban mengingat izin per perangkat, jadi struk berikutnya di perangkat yang sama tidak perlu disambungkan lagi. Printer Bluetooth memang dipilih ulang setiap kali halaman dimuat ulang, karena peramban belum menyimpan daftarnya.",
        "Tombol Putuskan menutup sambungannya kalau mesinnya dipindah atau diganti.",
        "Pembayaran tunai sekaligus membuka laci kas lewat printer; pulsa laci tidak dikirim saat pembayarannya bukan tunai.",
      ]);
      bullets(w, [
        "Printer berpita (dot matrix) mencetak tanpa logo dan tanpa potong otomatis: lembar ASLI dan tembusannya tetap tersambung seperti nota berkarbon, jadi arsipnya tidak tercecer.",
        "Printer thermal dan portabel memotong sendiri di akhir struk kalau mesinnya punya pemotong; yang tidak punya cukup disobek di tepinya.",
        "Logo toko ikut tercetak sebagai gambar hitam putih sebesar di jalur cetak peramban, dan kalau berkas logonya tidak bisa dibaca, struknya tetap keluar tanpa logo.",
        "Kalau pengiriman ke printer gagal, halaman kasir mengatakannya apa adanya dan tidak diam-diam mencetak lewat dialog peramban - struk yang keluar dua kali harus disobek, sedangkan yang belum keluar masih bisa dicetak ulang.",
      ]);
      callout(w, "Syarat jalur cetak langsung", [
        "Perambannya harus Chrome atau Edge: desktop untuk USB & Bluetooth, Android untuk Bluetooth. Firefox dan Safari belum punya WebUSB maupun Web Bluetooth, jadi di sana struk tetap keluar lewat dialog cetak peramban - dan halaman kasirnya mengatakan sebabnya, bukan menyembunyikan tombolnya.",
        "Halamannya harus dibuka lewat HTTPS (atau localhost), dan pemilih printer hanya boleh muncul dari ketukan kasir - bukan otomatis saat halaman dibuka.",
        "Di Windows, printer USB perlu driver WinUSB (misalnya lewat Zadig) supaya interface-nya tidak direbut driver pabrik. Kalau printer USB tidak muncul di pemilih peramban, itu sebab yang paling sering.",
        "Printer jaringan (LAN, port 9100) belum bisa dijangkau halaman web tanpa program perantara di komputer kasir. Perintah yang dikirim adalah perintah Epson standar (ESC @, ESC t, GS W, ESC d, GS v 0, GS V), jadi printer yang memakai protokol vendornya sendiri - misalnya sebagian printer label - tidak bisa dipakai lewat jalur ini.",
      ]);
      subTitle(w, "Ukuran kertas di dialog cetak");
      steps(w, [
        "Tekan Cetak struk di kasir. Dialog cetak peramban sudah terbuka dengan kertas selebar struknya dan setinggi isi notanya - bukan A4 yang menyisakan halaman kosong.",
        "Tidak ada yang perlu diubah di kolom ukuran kertas: halaman kasir menulis aturannya sendiri dari setelan workspace (58, 76, 80, atau 241 mm), jadi ukurannya selalu sama dengan kertas yang dipakai mesin itu.",
        "Kertas sempit (sampai 60 mm) memakai margin 2 mm supaya 32 kolomnya tidak makin sempit; kertas yang lebih lebar memakai margin 4 mm.",
        "Tombol cetaknya menyebut printer, lebar kertas, dan jumlah lembarnya, jadi kasir tahu setelan mana yang sedang berlaku sebelum menekan apa pun.",
      ]);
      callout(w, "Yang perlu diketahui", [
        "Tinggi kertasnya ditulis sebagai angka, bukan auto: bentuk size: 80mm auto tidak sah menurut CSS Paged Media dan dibuang peramban tanpa pesan apa pun - dan struknya kembali tercetak di halaman A4.",
        "Setelan ini berlaku untuk seluruh kasir di workspace ini. Struk yang sudah tercetak tidak berubah, dan mengganti mesin tidak menyentuh penjualan yang sudah tercatat.",
        "Pratinjau di kartu itu sudah selebar kertas yang dipilih (58/76/80/241 mm di layar) dan satu blok per lembar rangkap, jadi tidak perlu mencetak percobaan hanya untuk memeriksa bentuknya.",
        "Paket langganan yang belum memuat fitur Cetak struk ESC/POS masih bisa menyimpan setelan ini; pilihannya langsung dipakai begitu fiturnya aktif.",
      ]);
    },
  },
  {
    number: 18,
    title: "Kirim struk ke WhatsApp pembeli",
    render(w) {
      paragraph(
        w,
        "Sesudah pembayarannya lunas, dialog Struk belanja tidak hanya menawarkan cetak dan unduh. Ada tombol Kirim ke WhatsApp pembeli yang mengirimkan struknya langsung ke nomor pembelinya, dan yang sampai ke penerimanya adalah satu gambar struk PNG berlogo - tampil sebagai foto di percakapan, jadi identitas tokonya tidak perlu dibuka dulu. Bagian ini merangkum langkahnya, yang perlu disiapkan, dan apa yang terjadi kalau kanal WhatsApp-nya belum tersambung.",
      );
      subTitle(w, "Langkah mengirim");
      steps(w, [
        "Selesaikan pembayarannya lebih dulu. Dialog Struk belanja terbuka sendiri begitu ada nota yang benar-benar lunas; tombol Kirim ke WhatsApp pembeli ada di dalamnya, di samping Bagikan gambar struk dan Unduh PDF. Tombol Cetak di panel keranjang mengeluarkan hal yang sama untuk nota itu, jadi struk yang kertasnya habis bisa dicetak ulang tanpa membuka ulang dialognya.",
        "Tentukan nomornya. Member yang nomornya sudah tersimpan di halaman Member dikirim ke nomor itu - kasir tidak perlu mengetik apa pun, dan nomor yang tersimpan selalu menang atas nomor yang diketik. Untuk pembeli umum (penjualan tanpa member sama sekali), isi kolom Nomor WhatsApp pembeli dengan nomor yang diberikan pembelinya, contoh 0812-3456-7890.",
        "Tekan Kirim ke WhatsApp pembeli. Nomor yang belum sah ditolak di halaman maupun di server beserta sebabnya, jadi kiriman tidak pernah menebak tujuan.",
        "Baca laporannya apa adanya. Laporan yang baik menyebut nomor tujuan (selalu tersensor, contoh 6281-••••-890), nama gambar yang dikirim beserta ukurannya (contoh: gambar struk struk-A-00042.png, 1400x1898 px, 231,5 KB, berlogo), dan di mode demo kata disimulasikan - bukan klaim terkirim tanpa bukti.",
      ]);
      subTitle(w, "Apa yang sampai ke pembeli");
      bullets(w, [
        "Satu berkas gambar PNG, dikirim sebagai pesan gambar WhatsApp dengan keterangan pesan berisi nomor nota, tanggal, dan total belanjanya. Penerimanya melihat struknya langsung di percakapan tanpa membuka lampiran apa pun.",
        "Isinya sama dengan yang keluar di kertas: nama usaha, nama kasir, nama pembeli (atau Cash untuk pembeli umum), barang beserta jumlah dan harganya dengan kolom nominal rata kanan, TOTAL, serta lembar rangkapnya sebagai dua lembar terpisah. Logonya digambar berwarna di sini - di kertas dan PDF hitam putih karena printernya begitu, sedangkan di percakapan ia dilihat sebagai foto.",
        "PDF tidak lagi dikirim lewat jalur ini. Lewat pesan dokumen, logo dan isi struknya baru terlihat kalau penerimanya membuka lampirannya - itulah sebabnya jalur WhatsApp memakai gambar. Berkas PDF tetap bisa diminta sendiri lewat Unduh PDF.",
        "Tiap kiriman tercatat di jejak audit workspace: penerimanya (member atau pembeli umum beserta nomor notanya), asal nomornya (dari data member atau diketik kasir), nama berkas gambarnya, dan status kirimannya - jadi kiriman bisa ditelusuri tanpa memajang nomor penuh.",
      ]);
      subTitle(w, "Yang perlu disiapkan");
      bullets(w, [
        "Nomor WhatsApp pembeli: nomor tersimpan di data member, atau nomor yang diketik kasir untuk pembeli umum. Nomor ketikan itu dipakai sekali untuk kiriman tersebut dan tidak disimpan sebagai member.",
        "Izin pos.sell untuk mengirim struk. Peran kasir sudah memilikinya, jadi tidak ada izin tambahan yang perlu dipasang hanya untuk mengirim struk.",
        "Kunci kanal WhatsApp di lingkungan deployment: WHATSAPP_ACCESS_TOKEN dan WHATSAPP_PHONE_NUMBER_ID (versi Graph API bisa dipatok lewat WHATSAPP_GRAPH_VERSION). Kunci ini dibaca fungsi server, jadi berkas env di komputer kasir tidak berpengaruh.",
        "Halaman kasir harus bisa menggambar struknya (kanvas peramban) - gambarnya dibuat di perangkat kasir dan tidak diunggah ke mana pun kecuali ke kanal WhatsApp itu sendiri.",
      ]);
      callout(w, "Kalau kanalnya belum tersambung", [
        "Tombol kirimnya menjawab apa adanya: kanal WhatsApp belum tersambung di server beserta nama kunci yang belum diisi. Struknya tidak hilang - ia tetap bisa dicetak atau diunduh; yang perlu dikerjakan pemilik workspace adalah mengisi kuncinya di lingkungan deployment.",
        "Di sebelah laporan itu, halaman kasir menampilkan tautan cadangan wa.me yang membawa isi struknya sebagai teks - angka belanjanya terbaca penerimanya tanpa lampiran apa pun. Lampiran gambarnya menyusul lewat tombol Bagikan gambar struk (lembar bagikan perangkat: pilih WhatsApp, lalu pilih nomornya), atau lewat Unduh PDF yang dilampirkan sendiri oleh kasir.",
        "Kalau perangkat kasirnya tidak bisa menggambar struknya, halamannya mengatakan itu apa adanya dan mengarahkan ke Unduh PDF - bukan mengirim berkas lain yang tidak diminta.",
        "Di mode demo, kirimannya disimulasikan dan laporannya menulis kata Mode demo. Tidak ada satu pesan pun yang benar-benar keluar, dan itu dikatakan supaya tidak disangka sudah terkirim.",
      ]);
    },
  },
  {
    number: 19,
    title: "Jam operasional & pemberitahuan ke pemilik toko",
    render(w) {
      paragraph(
        w,
        "Pengingat di Bagian 10 ditujukan ke kasir yang berdiri di depan kasnya. Dua keadaan di bawah ini tidak bisa menunggu kasirnya sadar sendiri, karena pemilik toko sering tidak sedang di toko: kas yang belum dibuka padahal toko sudah buka, dan shift yang belum ditutup padahal toko sudah tutup. Keduanya dikabarkan ke pemilik toko, dan penentunya adalah jam operasional toko.",
      );
      subTitle(w, "Mengatur jam operasional toko");
      steps(w, [
        "Buka menu Pengaturan di sidebar kiri, lalu cari kartu Pengingat tutup shift. Izinnya billing.manage - pemilik, manajer, dan keuangan.",
        "Isi Jam buka toko dan Jam tutup toko, masing-masing bilangan bulat 0-23 menurut waktu perangkat kasir yang membuka halamannya. Bawaannya 08:00 dan 22:00.",
        "Jam tutup yang lebih kecil dari jam buka berarti toko buka lintas malam, misalnya 20 lalu 2. Dua jam yang sama berarti toko buka 24 jam - dan toko 24 jam tidak pernah menerima kabar kas yang belum dibuka, karena tidak punya jam buka.",
        "Baca kalimat petunjuk di bawah kolomnya: di situ tertulis jam operasional yang sedang berlaku beserta akibatnya, misalnya pemilik toko dikabari setelah 30 menit kasnya belum dibuka.",
        "Saklar Pemberitahuan ke pemilik toko memisahkan kabar ini dari pengingat kasir: kafe 24 jam boleh mematikan pengingat tutup shift tanpa ikut mematikan kabar kas yang belum dibuka ke pemiliknya.",
        "Tekan Simpan setelan shift. Jam operasional ini dipakai bersama seluruh kasir di workspace ini, dan mengubahnya tidak pernah menulis ulang penjualan yang sudah tercatat.",
      ]);
      subTitle(w, "Kapan pemilik toko dikabari");
      table(
        w,
        ["Keadaan kas", "Kapan kabarnya berangkat"],
        [
          [
            "Kas belum dibuka padahal toko sudah buka",
            "Hanya di dalam jam operasional, dan baru setelah lewat 30 menit dari jam buka - sebelum itu kasirnya masih menghitung uang kembalian. Di luar jam operasional tokonya memang belum berjualan, jadi tidak ada yang dikabarkan.",
          ],
          [
            "Toko sudah tutup, shift belum ditutup",
            "Begitu toko tutup menurut jam operasional, padahal shiftnya masih terbuka.",
          ],
          [
            "Shift kemarin belum ditutup",
            "Shift yang dibuka pada hari kalender sebelumnya: uangnya sudah bercampur ke hari berikutnya, jadi penutupannya perlu ditagih hari itu juga.",
          ],
          [
            "Shift sudah berjalan terlalu lama",
            "Shift yang belum ditutup lebih lama dari ambangnya (bawaan 14 jam, diatur di kartu yang sama), supaya selisih kasnya tidak menumpuk sampai tutup toko.",
          ],
        ],
        [150, 350],
      );
      subTitle(w, "Yang dilihat kasir dan pemilik");
      bullets(w, [
        "Di halaman Kasir, kabarnya muncul sebagai banner di atas daftar produk beserta tautan ke halaman Shift & Kas; banner yang sama juga ada di halaman Shift & Kas. Kasir jadi tahu bahwa pemiliknya memang ikut dikabari, bukan hanya dirinya yang diingatkan.",
        "Banner itu menyebut apa yang benar-benar terjadi dengan kabarnya: sedang memberi tahu, pemilik toko sudah diberi tahu, hari itu sudah pernah, emailnya dijadwalkan ke alamat pemilik, atau gagal dikirim beserta sebabnya. Kalimatnya tidak pernah diubah menjadi klaim terkirim kalau kanalnya memang belum ada.",
        "Halaman Shift & Kas memuat kartu Pemberitahuan ke pemilik toko: daftar kabar yang dibaca dari server, bukan dari penanda di perangkat ini - lengkap dengan hari, jam lokalnya, dan tombol Tandai ditangani. Yang ditandai tidak dihapus, jejaknya tetap ada sebagai riwayat.",
        "Tiap baris menyebutkan siapa penerimanya: alamat email pemilik workspace ini beserta hasil pengirimannya (terkirim, sedang dikirim, gagal beserta pesan penyedianya, atau alamat uji yang memang tidak dikirimi email), lalu berapa endpoint webhook yang ikut menerimanya. Kalau belum ada endpoint yang melanggan shift.alert, barisnya tetap jujur: kabarnya tersimpan, dan lewat email itulah pemiliknya dikabari.",
      ]);
      callout(w, "Bukan notifikasi push", [
        "Shift di aplikasi ini hidup di perangkat kasir, jadi server tidak punya cara melihat shift yang tidak pernah dilihatnya. Alurnya: perangkat melaporkan keadaan kasnya beserta jam lokalnya, server memutuskan ulang memakai jam operasional workspace, lalu kabarnya dikirim sebagai email ke alamat pemilik workspace ini (dan ikut masuk ke langganan webhook workspace sebagai event shift.alert).",
        "Karena itu kabarnya berangkat saat halaman Kasir atau halaman Shift & Kas terbuka di perangkat yang memegang shiftnya - bukan saat ponsel pemiliknya berdering. Laporan yang tidak cocok dengan keadaannya, misalnya dilaporkan di luar jam operasional, ditolak server dan bukan diteruskan.",
        "Satu kabar per jenis per hari: kunci (workspace, jenis, hari) di server menahannya, jadi kasir yang membuka halaman Kasir berkali-kali tidak mengirim kabar yang sama berulang-ulang. Di mode demo tidak ada kanal email server maupun endpoint webhook, jadi kabarnya tercatat tetapi tidak sampai ke siapa pun.",
        "Izinnya shift.manage - satu izin dengan halaman Shift & Kas, karena kabar ini memang soal kas, bukan soal menjual. Kasir sudah memilikinya secara bawaan bersama izin menjualnya.",
      ]);
    },
  },
];

/** Setelah bagian mana gambar ditampilkan, supaya teks tetap mengalir rapi. */
const FIGURES = {
  3: [
    {
      height: 254,
      caption:
        "Gambar 1 - Ilustrasi layar Produk & Stok: tombol Tambah produk (1) dan tombol Sesuaikan stok di kolom Aksi (2).",
      draw: figureProductsPage,
    },
    {
      height: 272,
      caption:
        "Gambar 2 - Ilustrasi form Produk baru: urutan pengisian 1 sampai 8, dengan penekanan pada SKU (2) yang boleh dikosongkan untuk dibuat otomatis, dan Stok awal (7).",
      draw: figureNewProductForm,
    },
  ],
  4: [
    {
      height: 244,
      caption:
        "Gambar 3 - Ilustrasi panel Sesuaikan stok: tombol di baris produk (1), jumlah penyesuaian (2), catatan (3), dan tombol simpan (4).",
      draw: figureAdjustStock,
    },
  ],
  5: [
    {
      height: 216,
      caption:
        "Gambar 4 - Diagram rantai pembelian: PR, PO, GRN, lalu stok bertambah di lokasi yang dipilih.",
      draw: figureStockFlow,
    },
  ],
  6: [
    {
      height: 316,
      caption:
        "Gambar 5 - Ilustrasi pesanan pembelian dengan penerimaan bertahap: baris PO berprogres 12/24 (1), kolom Terima per baris dengan sisa pesanannya (2), dan tombol Terima barang (3).",
      draw: figurePurchaseOrder,
    },
    {
      height: 340,
      caption:
        "Gambar 6 - Ilustrasi hutang usaha & pencocokan 3 arah: tabel tagihan dengan umur dan status 3 arah (1), keputusan selisih Terima selisih / Sengketa (2), dan pembayaran beberapa tagihan sekaligus dengan satu nomor PAY- (3).",
      draw: figurePayables,
    },
  ],
  7: [
    {
      height: 292,
      caption:
        "Gambar 7 - Ilustrasi halaman Gudang & Stok: ringkasan lokasi stok dan form Pindah stok antar lokasi (1).",
      draw: figureTransfer,
    },
  ],
  8: [
    {
      height: 300,
      caption:
        "Gambar 8 - Ilustrasi sesi Opname: tombol Mulai hitung (1), kartu sesi dengan progres dan ringkasan selisih (2), kolom Sistem (snapshot) / Sekarang / Hitung fisik / Selisih, serta tombol Posting hasil hitung (3).",
      draw: figureOpname,
    },
  ],
  9: [
    {
      height: 254,
      caption:
        "Gambar 9 - Ilustrasi layar Kasir (POS): ringkasan keranjang dengan tombol Selesaikan pembayaran (1) dan grid produk (2).",
      draw: figurePos,
    },
  ],
  16: [
    {
      height: 216,
      caption:
        "Gambar 10 - Ilustrasi seksi Logo toko di halaman Pengaturan: tombol Tambah/Ganti logo (1), logo yang terpasang di kartu (2), dan pratinjau struk yang mencetaknya kecil serta hitam putih di atas nama usaha (3) - logo yang sama menjadi penanda workspace di sidebar.",
      draw: figureTenantLogo,
    },
  ],
  17: [
    {
      height: 258,
      caption:
        "Gambar 11 - Ilustrasi kartu Struk belanja: saran setelan otomatis beserta dasar penentuannya (1), tiga jenis printer dengan kertas & rangkap yang didukungnya (2), dan lebar kertas yang boleh dipilih dari mesin itu (3).",
      draw: figureReceiptPrinter,
    },
    {
      height: 244,
      caption:
        "Gambar 12 - Ilustrasi pratinjau struk selebar kertas yang dipilih, 58 mm dan 80 mm (1), serta dialog cetak yang ukuran kertasnya sudah ditulis halaman kasir dari setelan workspace (2).",
      draw: figureReceiptPrint,
    },
  ],
};

// ----------------------------------------------------------- sampul & daftar --

function frontMatter(w, toc) {
  const doc = w.doc;
  w.addPage();

  doc.save();
  doc.rect(0, 0, A4.width, 250).fill(C.primarySoft);
  doc.restore();

  doc.font(FONT.regular).fontSize(10).fillColor(C.primaryDark);
  doc.text("MesinPOS - SaaS POS untuk toko, kafe, dan grosir", MARGIN, 74, { width: CONTENT_W });

  doc.font(FONT.bold).fontSize(30).fillColor(C.ink);
  doc.text("Panduan Operasional", MARGIN, 100, { width: CONTENT_W });
  doc.text("Cara Mengisi Stok", MARGIN, 136, { width: CONTENT_W });
  doc.text("dan Menjalankan Toko", MARGIN, 172, { width: CONTENT_W });

  doc.font(FONT.regular).fontSize(11).fillColor(C.body);
  doc.text(
    "Langkah demi langkah: menyiapkan produk, mengisi stok dari tiga jalur berbeda, memindahkan stok, menghitung fisik, sampai menjual di kasir.",
    MARGIN,
    218,
    { width: CONTENT_W - 110, lineGap: 3 },
  );

  doc
    .moveTo(MARGIN, 288)
    .lineTo(MARGIN + 64, 288)
    .lineWidth(3)
    .strokeColor(C.primary)
    .stroke();

  doc.font(FONT.bold).fontSize(12).fillColor(C.ink);
  doc.text("Isi panduan ini", MARGIN, 306, { width: CONTENT_W });

  let cursor = 330;
  toc.forEach((entry) => {
    doc.font(FONT.regular).fontSize(10.5).fillColor(C.body);
    doc.text(`${entry.number}. ${entry.title}`, MARGIN, cursor, { width: CONTENT_W - 40 });
    doc
      .font(FONT.mono)
      .fontSize(10)
      .fillColor(C.muted)
      .text(String(entry.page), MARGIN, cursor, { width: CONTENT_W, align: "right" });
    cursor = doc.y + 6;
  });

  doc.font(FONT.regular).fontSize(9).fillColor(C.muted);
  doc.text(
    "Gambar di dalam panduan ini adalah ilustrasi layar yang digambar ulang, bukan tangkapan layar. Label tombol dan nama halaman mengikuti aplikasi yang sedang berjalan.",
    MARGIN,
    Math.min(cursor + 26, A4.height - MARGIN - FOOTER_H - 40),
    { width: CONTENT_W - 60, lineGap: 2 },
  );
}

/** Membangun seluruh dokumen. `toc` kosong pada lintasan pengukuran. */
function build(toc) {
  const w = new Writer();
  frontMatter(w, toc);

  SECTIONS.forEach((section) => {
    sectionTitle(w, section.number, section.title);
    section.render(w);
    for (const figure of FIGURES[section.number] ?? []) {
      screen(w, figure.caption, figure.height, figure.draw);
    }
  });

  // Catatan penutup.
  const doc = w.doc;
  w.addPage();
  doc.font(FONT.bold).fontSize(16).fillColor(C.ink);
  doc.text("Penutup", MARGIN, w.y, { width: CONTENT_W });
  w.y = doc.y + 12;
  paragraph(
    w,
    "Tiga hal yang paling sering menyelamatkan operasi harian: pindahkan stok ke lokasi jual sebelum jam buka, hitung fisik secara berkala lewat Opname, dan selalu isi catatan pada setiap penyesuaian stok supaya angka yang aneh bisa ditelusuri.",
  );
  paragraph(
    w,
    "Bila ada langkah yang tidak bisa dijalankan karena tombolnya mati atau paketnya belum memuat fiturnya, pesan di layar akan menyebut sebabnya - dan pesan itu bisa dikutip apa adanya saat menghubungi dukungan lewat menu Dukungan.",
  );

  return w;
}

// Lintasan pertama: hanya untuk mencatat halaman tiap bagian.
const measured = build([]).toc;

// Lintasan kedua: dokumen sungguhan, daftar isi sudah lengkap.
const final = build(measured);
const chunks = [];
final.doc.on("data", (chunk) => chunks.push(chunk));

await new Promise((done, reject) => {
  final.doc.on("end", done);
  final.doc.on("error", reject);
  final.doc.end();
});

const buffer = Buffer.concat(chunks);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, buffer);

console.log(
  [
    `PDF dibuat: ${OUT}`,
    `ukuran: ${(buffer.length / 1024).toFixed(1)} KB`,
    `halaman: ${final.page}`,
    `bagian: ${SECTIONS.length}`,
    `gambar: ${Object.values(FIGURES).reduce((sum, list) => sum + list.length, 0)}`,
  ].join("\n"),
);

#!/usr/bin/env node
/**
 * Memeriksa PDF panduan operasional (`public/panduan/panduan-mesinpos.pdf`).
 *
 * Berkas PDF tidak bisa "dibaca sekilas" seperti berkas teks, jadi harness ini
 * membongkar isinya: setiap stream halaman didekompresi, operator teksnya
 * dibaca, lalu diperiksa terhadap janji dokumen itu sendiri -
 *
 *  1. jumlah halaman & footer bernomor ada di semua halaman,
 *  2. daftar isi menunjuk halaman yang benar-benar memuat bagian itu,
 *  3. semua bagian dan langkah kunci (Tambah produk, Sesuaikan stok, Terima
 *     barang, Posting hasil hitung) benar-benar ada di halaman yang tepat,
 *  4. tidak ada teks yang tercetak di luar area cetak (menembus margin atas
 *     atau menabrak footer).
 *
 * Jalankan: `bun scripts/verify-panduan.mjs`
 */

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { resolve } from "node:path";

const PDF_PATH = resolve(process.cwd(), "public/panduan/panduan-mesinpos.pdf");
const A4_HEIGHT = 841.89;
const MARGIN = 48;

const checks = [];
function check(name, passed, detail = "") {
  checks.push({ name, passed, detail });
}

// ------------------------------------------------------------- baca berkas ---

const raw = readFileSync(PDF_PATH);
const text = raw.toString("latin1");
check("Berkas berawalan %PDF-", text.startsWith("%PDF-"), text.slice(0, 8));

/** Semua objek stream di dalam berkas, sudah didekompresi. */
function readStreams(source) {
  const streams = [];
  const marker = /stream\r?\n/g;
  let match;
  while ((match = marker.exec(source)) !== null) {
    const start = match.index + match[0].length;
    const end = source.indexOf("endstream", start);
    if (end === -1) continue;
    const chunk = Buffer.from(source.slice(start, end), "latin1");
    try {
      streams.push(inflateSync(chunk).toString("latin1"));
    } catch {
      // Stream tanpa kompresi (mis. metadata) dilewati begitu saja.
    }
  }
  return streams;
}

const streams = readStreams(text);
check("Stream halaman bisa didekompresi", streams.length > 10, `${streams.length} stream`);

// --------------------------------------------------- bongkar operator teks ---

/** Susunan CP1252 untuk byte 0x80-0x9F, supaya teks balikannya sama. */
const CP1252 = {
  0x80: "\u20AC",
  0x82: "\u201A",
  0x83: "\u0192",
  0x84: "\u201E",
  0x85: "\u2026",
  0x86: "\u2020",
  0x87: "\u2021",
  0x88: "\u02C6",
  0x89: "\u2030",
  0x8a: "\u0160",
  0x8b: "\u2039",
  0x8c: "\u0152",
  0x8e: "\u017D",
  0x91: "\u2018",
  0x92: "\u2019",
  0x93: "\u201C",
  0x94: "\u201D",
  0x95: "\u2022",
  0x96: "\u2013",
  0x97: "\u2014",
  0x98: "\u02DC",
  0x99: "\u2122",
  0x9a: "\u0161",
  0x9b: "\u203A",
  0x9c: "\u0153",
  0x9e: "\u017E",
  0x9f: "\u0178",
};

function decodeHex(value) {
  const bytes = value.replace(/[^0-9A-Fa-f]/g, "");
  let out = "";
  for (let index = 0; index < bytes.length; index += 2) {
    const byte = parseInt(bytes.slice(index, index + 2), 16);
    out += CP1252[byte] ?? String.fromCharCode(byte);
  }
  return out;
}

function decodeLiteral(value) {
  return value
    .replace(/\\([nrtbf()\\])/g, (_, char) =>
      ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" })[char] ?? char,
    )
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

/** Mengubah isi satu array TJ (campuran teks literal & heksadesimal) jadi teks. */
function decodeTjArray(inner) {
  const parts = [];
  const token = /(\((?:\\.|[^\\()])*\))|(<[0-9A-Fa-f\s]*>)/g;
  let match;
  while ((match = token.exec(inner)) !== null) {
    if (match[1]) parts.push(decodeLiteral(match[1].slice(1, -1)));
    else parts.push(decodeHex(match[2]));
  }
  return parts.join("");
}

/**
 * Membaca kembali posisi & isi setiap Tj/TJ dari satu stream konten.
 *
 * pdfkit menulis teks sebagai array TJ berisi string heksadesimal, dan
 * membungkus tiap blok teks dengan `1 0 0 -1 0 H cm` sehingga nilai y pada `Tm`
 * adalah jarak dari **bawah** halaman. Jarak dari atas dihitung di luar sini.
 */
function extractText(stream) {
  const runs = [];
  let tx = 0;
  let ty = 0;
  let leading = 0;
  const token =
    /(\[[^\]]*\]\s*TJ)|(\((?:\\.|[^\\()])*\)\s*Tj)|(<[0-9A-Fa-f\s]*>\s*Tj)|(-?[\d.]+ -?[\d.]+ (?:Td|TD))|(-?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+ Tm)|(-?[\d.]+ TL)|T\*/g;

  let match;
  while ((match = token.exec(stream)) !== null) {
    const value = match[0];
    if (value.endsWith("TJ")) {
      runs.push({ text: decodeTjArray(value.slice(0, value.lastIndexOf("]"))), x: tx, y: ty });
    } else if (value.endsWith("Tj")) {
      const body = value.slice(0, -2).trim();
      const textValue = body.startsWith("<")
        ? decodeHex(body.slice(1, -1))
        : decodeLiteral(body.slice(1, -1));
      runs.push({ text: textValue, x: tx, y: ty });
    } else if (value.endsWith("Td") || value.endsWith("TD")) {
      const [dx, dy] = value.split(" ").map(Number);
      tx += dx;
      ty += dy;
      if (value.endsWith("TD")) leading = -dy;
    } else if (value.endsWith("Tm")) {
      const parts = value.split(" ").map(Number);
      tx = parts[4];
      ty = parts[5];
    } else if (value.endsWith("TL")) {
      leading = Number(value.split(" ")[0]);
    } else if (value === "T*") {
      ty -= leading;
    }
  }
  return runs;
}

const pages = streams
  .map(extractText)
  .filter((runs) => runs.length > 0)
  .map((runs) => ({
    runs,
    lines: runs.map((run) => run.text),
    /*
      Teks antar-runs disatukan dengan satu spasi. Baris yang dibungkus pdfkit
      menyisakan spasi di ujung baris pertamanya, jadi tanpa dinormalisasi dulu
      "Bayar terpilih" bisa terbaca "Bayar  terpilih" dan pemeriksaan frasa akan
      gagal karena hal yang bukan masalah.
    */
    text: runs
      .map((run) => run.text)
      .join(" ")
      .replace(/\s+/g, " "),
    // Jarak tiap teks dari tepi atas halaman (titik acuan: garis dasar teks).
    tops: runs.map((run) => A4_HEIGHT - run.y),
    lefts: runs.map((run) => run.x),
  }));

check("Ada minimal 10 halaman berisi teks", pages.length >= 10, `${pages.length} halaman`);

// ------------------------------------------------------ footer tiap halaman --

const missingFooter = pages
  .map((page, index) => (page.text.includes(`Halaman ${index + 1}`) ? null : index + 1))
  .filter((value) => value !== null);
check(
  "Setiap halaman punya footer 'Halaman n'",
  missingFooter.length === 0,
  missingFooter.length === 0 ? `${pages.length}/${pages.length}` : `hilang di: ${missingFooter.join(", ")}`,
);

// ------------------------------------------------------------- daftar isi ----

/**
 * Daftar isi ditulis sebagai baris "n. Judul" diikuti nomor halaman pada baris
 * yang sama. Pasangan itu diambil dari halaman sampul (halaman pertama).
 */
const coverRuns = pages[0].runs;
const tocEntries = [];
for (let index = 0; index < coverRuns.length; index += 1) {
  const line = coverRuns[index].text;
  const match = /^(\d{1,2})\.\s+(.+)$/.exec(line);
  if (!match) continue;
  const pageNumber = coverRuns[index + 1]?.text;
  if (pageNumber && /^\d+$/.test(pageNumber)) {
    tocEntries.push({ number: Number(match[1]), title: match[2], page: Number(pageNumber) });
  }
}
check("Daftar isi memuat 19 bagian", tocEntries.length === 19, `${tocEntries.length} entri`);

const badToc = tocEntries.filter((entry) => {
  const page = pages[entry.page - 1];
  if (!page) return true;
  return !page.text.includes(`BAGIAN ${entry.number}`) || !page.text.includes(entry.title);
});
check(
  "Daftar isi menunjuk halaman yang benar",
  badToc.length === 0,
  badToc.length === 0
    ? tocEntries.map((entry) => `${entry.number}->${entry.page}`).join(" ")
    : badToc.map((entry) => `${entry.number}->${entry.page}`).join(" "),
);

// ------------------------------------------------------- bagian & langkah ----

const numbering = tocEntries.map((entry) => entry.number).join(",");
check(
  "Nomor bagian berurutan 1..19",
  numbering === "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19",
  numbering,
);

/**
 * Frasa yang membuktikan tiap alur benar-benar tercakup. Setiap pasangan adalah
 * frasa dan bagian tempatnya seharusnya berada - supaya bagian yang salah tempat
 * (mis. langkah pembelian tertinggal di bagian opname) ikut tertangkap.
 */
const REQUIRED = [
  ["Stok awal", 3],
  ["Tambah produk", 3],
  ["Sesuaikan stok", 4],
  ["Stok jadi", 4],
  ["Penerimaan barang (GRN)", 5],
  ["Terima barang", 5],
  ["Tambah supplier", 6],
  ["Kirim permintaan", 6],
  ["Pesanan pembelian (PO)", 6],
  ["Terima selisih", 6],
  ["Catat tagihan supplier", 6],
  ["Bayar terpilih", 6],
  ["Pindah stok antar lokasi", 7],
  ["Mulai hitung", 8],
  ["Hitung fisik", 8],
  ["Sistem (snapshot)", 8],
  ["Batalkan sesi", 8],
  ["Posting hasil hitung", 8],
  ["Selesaikan pembayaran", 9],
  ["belum ada gambar", 9],
  ["Layar penuh", 9],
  ["Buka shift", 10],
  // Bagian 10: gerbang kasir — tanpa shift terbuka, kasir tidak bisa menjual.
  ["Kasir terkunci", 10],
  ["shift (kas) belum dibuka", 10],
  // Bagian 11: merapikan produk yang sudah tersimpan.
  ["Harga beli", 11],
  ["Nonaktifkan saja", 11],
  ["Nonaktif", 11],
  // Bagian 14: daftar harness yang dipakai tim teknis.
  ["verify-tax.mjs", 14],
  // Bagian 16: logo toko yang tampil di sidebar & struk.
  ["Logo toko", 16],
  ["Tambah logo", 16],
  ["Ganti logo", 16],
  ["Hapus logo", 16],
  ["Sidebar kiri", 16],
  // Bagian 15: setelan PPN workspace.
  ["Tarif PPN", 15],
  ["Simpan setelan PPN", 15],
  ["Matikan PPN", 15],
  // Bagian 17: printer & kertas struk beserta ukuran cetaknya.
  ["Printer & kertas struk", 17],
  ["Jenis printer struk", 17],
  ["Dot matrix", 17],
  ["Portable (Bluetooth)", 17],
  ["Pakai saran ini", 17],
  ["Simpan setelan struk", 17],
  ["kertas terdekat", 17],
  ["Cetak struk", 17],
  ["margin 2 mm", 17],
  // Bagian 18: mengirim struk ke WhatsApp pembeli (gambar berlogo, bukan PDF).
  ["Kirim struk ke WhatsApp pembeli", 18],
  ["Nomor WhatsApp pembeli", 18],
  ["gambar struk PNG berlogo", 18],
  ["pos.sell", 18],
  ["WHATSAPP_ACCESS_TOKEN", 18],
  ["Bagikan gambar struk", 18],
  // Bagian 10: izin halaman Shift & Kas berdiri sendiri (`shift.manage`).
  ["shift.manage", 10],
  // Bagian 13: tabel peran & izin memuat izin dapur dan kas.
  ["kds.manage", 13],
  ["Membuka & menutup shift kas", 13],
  // Bagian 19: jam operasional & kabar ke pemilik toko (kas belum dibuka /
  // shift belum ditutup).
  ["Jam buka toko", 19],
  ["Jam tutup toko", 19],
  ["Pemberitahuan ke pemilik toko", 19],
  ["Kas belum dibuka padahal toko sudah buka", 19],
  ["Toko sudah tutup, shift belum ditutup", 19],
  ["Tandai ditangani", 19],
  ["shift.alert", 19],
  ["alamat email pemilik", 19],
];
const missingSteps = REQUIRED.filter(([needle, section]) => {
  const sectionPage = tocEntries.find((entry) => entry.number === section)?.page;
  if (!sectionPage) return true;
  /*
    Bagian yang panjang menempati lebih dari satu halaman, jadi frasanya dicari
    mulai dari halaman bagian itu sampai sebelum bagian berikutnya. Bagian
    terakhir tidak punya bagian berikutnya, jadi batasnya halaman terakhir
    dokumen (sebelum penutup tidak bisa dibedakan dari daftar isi, dan itu tidak
    masalah: bagiannya tetap yang pertama memuat frasa itu).
  */
  const nextPage = tocEntries.find((entry) => entry.number === section + 1)?.page;
  const end = nextPage ? nextPage - 1 : pages.length;
  return !pages.slice(sectionPage - 1, end).some((page) => page.text.includes(needle));
});
check(
  "Langkah kunci ada di bagian yang benar",
  missingSteps.length === 0,
  missingSteps.length === 0
    ? `${REQUIRED.length} frasa`
    : missingSteps.map(([word, section]) => `${word} (bagian ${section})`).join(", "),
);

// ----------------------------------------------------------- batas halaman ---

/**
 * Footer digambar di bawah batas margin bawah (y = 841.89 - 82 = 759.89) dan
 * sudah diperiksa terpisah, jadi ambangnya 812 pt: teks yang lebih rendah dari
 * itu berarti konten benar-benar menabrak footer.
 */
const escaped = [];
pages.forEach((page, pageIndex) => {
  page.runs.forEach((run, runIndex) => {
    if (run.text.startsWith("Panduan Operasional") || run.text.startsWith("Halaman ")) return;
    const top = page.tops[runIndex];
    if (top < MARGIN - 12 || top > 812) {
      escaped.push(`hal ${pageIndex + 1}: "${run.text.slice(0, 24)}" pada y=${top.toFixed(0)}`);
    }
  });
});
check(
  "Tidak ada teks di luar area cetak",
  escaped.length === 0,
  escaped.length === 0 ? `${pages.length} halaman bersih` : escaped.slice(0, 3).join(" | "),
);

const offLeft = [];
pages.forEach((page, pageIndex) => {
  page.lefts.forEach((left, runIndex) => {
    if (left < MARGIN - 12) offLeft.push(`hal ${pageIndex + 1}: x=${left.toFixed(0)} "${page.runs[runIndex].text.slice(0, 18)}"`);
  });
});
check(
  "Tidak ada teks melewati margin kiri",
  offLeft.length === 0,
  offLeft.length === 0 ? "aman" : offLeft.slice(0, 3).join(" | "),
);

/**
 * Pemeriksaan geometri gambar.
 *
 * Seluruh isi halaman dibungkus `1 0 0 -1 0 H cm`, jadi koordinat gambar (`m`,
 * `l`, `re`) memakai y = jarak dari tepi atas. Kalau ada kotak atau garis yang
 * keluar dari 24..800 pt, gambarnya terpotong di tepi kertas atau menabrak
 * footer - dan itu tidak terlihat dari daftar teks di atas.
 */
const geometryViolations = [];
streams.forEach((stream, pageIndex) => {
  // Sampul memang punya pita warna penuh lebar (0..595), jadi dilewati.
  if (pageIndex === 0) return;
  const op = /(-?[\d.]+) (-?[\d.]+) (?:m|l)|(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/g;
  let match;
  while ((match = op.exec(stream)) !== null) {
    const [, mx, my, rx, ry, rw, rh] = match;
    const points = mx !== undefined ? [[Number(mx), Number(my)]] : [[Number(rx), Number(ry)], [Number(rx) + Number(rw), Number(ry) + Number(rh)]];
    for (const [x, y] of points) {
      if (x < 40 || x > 556 || y < 24 || y > 800) {
        geometryViolations.push(`hal ${pageIndex + 1}: (${x.toFixed(0)}, ${y.toFixed(0)})`);
      }
    }
  }
});
check(
  "Gambar tidak terpotong di tepi kertas atau footer",
  geometryViolations.length === 0,
  geometryViolations.length === 0
    ? "semua titik di dalam area cetak"
    : geometryViolations.slice(0, 3).join(" | "),
);

/**
 * Tautan halaman ke berkasnya. Halaman menyajikan PDF lewat satu konstanta
 * (`PDF_URL`); kalau berkasnya diganti nama tanpa mengubah konstanta itu, tombol
 * unduh akan menunjuk berkas yang tidak ada - dan tidak ada pemeriksaan lain yang
 * menangkapnya.
 */
const pageSource = readFileSync(resolve(process.cwd(), "src/pages/PanduanPage.tsx"), "utf8");
const linkedUrl = /const PDF_URL = "([^"]+)"/.exec(pageSource)?.[1] ?? null;
const linkedFile = linkedUrl ? resolve(process.cwd(), `public${linkedUrl}`) : null;
let linkedOk = false;
try {
  linkedOk = Boolean(linkedFile) && readFileSync(linkedFile).length === raw.length;
} catch {
  linkedOk = false;
}
check(
  "Halaman Panduan menunjuk berkas PDF yang benar-benar ada",
  linkedOk,
  linkedUrl ? `${linkedUrl} (${raw.length} byte)` : "PDF_URL tidak ditemukan di PanduanPage.tsx",
);

/**
 * Panduan singkat **kirim struk ke WhatsApp pembeli** hidup di halaman, bukan di
 * berkas PDF: kasir membukanya dari sidebar, dan pratinjau PDF-nya sering tidak
 * tampil di ponsel. Yang diperiksa di sini adalah sumber halamannya (PDF-nya
 * sendiri sudah diperiksa di atas) — langkahnya harus menyebut perilaku yang
 * benar-benar ada di layar kasir: **satu gambar struk berlogo** sebagai pesan
 * gambar, nomor pembeli umum yang diketik kasir, dan syarat kanal WhatsApp-nya.
 */
const panduanStrukAda = pageSource.includes('data-testid="panduan-kirim-struk"');
check(
  "Halaman Panduan memuat panduan singkat kirim struk ke WhatsApp pembeli",
  panduanStrukAda &&
    pageSource.includes("Kirim ke WhatsApp pembeli") &&
    pageSource.includes("gambar struk PNG berlogo") &&
    pageSource.includes("Nomor WhatsApp pembeli") &&
    pageSource.includes("WHATSAPP_PHONE_NUMBER_ID"),
  panduanStrukAda ? "kartu panduan-kirim-struk" : "kartu panduan-kirim-struk tidak ada",
);

check(
  "Gambar (ilustrasi) punya keterangan bernomor",
  [
    "Gambar 1",
    "Gambar 2",
    "Gambar 3",
    "Gambar 4",
    "Gambar 5",
    "Gambar 6",
    "Gambar 7",
    "Gambar 8",
    "Gambar 9",
    "Gambar 10",
    "Gambar 11",
    "Gambar 12",
  ].every((label) => pages.some((page) => page.text.includes(label))),
  "1 sampai 12",
);

// ---------------------------------------------------------------- laporan ----

const failed = checks.filter((item) => !item.passed);
for (const item of checks) {
  const mark = item.passed ? "OK  " : "GAGAL";
  console.log(`${mark} ${item.name}${item.detail ? ` - ${item.detail}` : ""}`);
}
console.log(`\n${checks.length - failed.length}/${checks.length} pemeriksaan lolos`);
if (failed.length > 0) process.exit(1);

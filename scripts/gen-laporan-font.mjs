/**
 * Pembuat tabel **lebar huruf Helvetica & Helvetica-Bold** untuk berkas PDF laporan.
 *
 * Kenapa perlu tabel sendiri: berkas PDF laporan ditulis tanpa pustaka tata letak
 * (`src/convex/lib/laporanPdf.ts`) dan sekarang memakai huruf **Helvetica** —
 * huruf standar PDF yang bentuknya sama dengan huruf halaman aplikasi. Bedanya
 * dengan Courier yang dipakai sebelumnya: lebarnya **tidak** sama untuk semua
 * huruf, jadi perataan kolom, pemotongan teks, dan pembungkusan kalimat harus
 * memakai lebar huruf yang sebenarnya. Angka lebarnya datang dari berkas AFM resmi
 * Adobe yang ikut terpasang bersama `pdfkit` (devDependency), dibaca **sekali** di
 * sini lalu ditulis sebagai tabel di dalam repo — halaman web tidak boleh
 * bergantung pada `pdfkit` yang hanya dipakai skrip.
 *
 * Jalankan: `bun scripts/gen-laporan-font.mjs`
 */

import { readFileSync, writeFileSync } from "node:fs";

const AKAR = new URL("..", import.meta.url).pathname;

/** Nama huruf kode 32–126 pada **WinAnsiEncoding** (urutan ASCII biasa). */
const NAMA_ASCII = [
  "space", "exclam", "quotedbl", "numbersign", "dollar", "percent", "ampersand",
  "quotesingle", "parenleft", "parenright", "asterisk", "plus", "comma", "hyphen",
  "period", "slash",
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "colon", "semicolon", "less", "equal", "greater", "question", "at",
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
  "bracketleft", "backslash", "bracketright", "asciicircum", "underscore", "grave",
  "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
  "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
  "braceleft", "bar", "braceright", "asciitilde",
];

/**
 * Nama huruf kode 128–255 pada WinAnsiEncoding. Kode yang memang tidak berisi
 * huruf apa pun di encoding itu ditulis `null`: lebarnya memakai lebar cadangan.
 */
const NAMA_TINGGI = [
  "Euro", null, "quotesinglbase", "florin", "quotedblbase", "ellipsis", "dagger",
  "daggerdbl", "circumflex", "perthousand", "Scaron", "guilsinglleft", "OE", null,
  "Zcaron", null, null, "quoteleft", "quoteright", "quotedblleft", "quotedblright",
  "bullet", "endash", "emdash", "tilde", "trademark", "scaron", "guilsinglright",
  "oe", null, "zcaron", "Ydieresis", "space", "exclamdown", "cent", "sterling",
  "currency", "yen", "brokenbar", "section", "dieresis", "copyright", "ordfeminine",
  "guillemotleft", "logicalnot", "hyphen", "registered", "macron", "degree",
  "plusminus", "twosuperior", "threesuperior", "acute", "mu", "paragraph",
  "periodcentered", "cedilla", "onesuperior", "ordmasculine", "guillemotright",
  "onequarter", "onehalf", "threequarters", "questiondown", "Agrave", "Aacute",
  "Acircumflex", "Atilde", "Adieresis", "Aring", "AE", "Ccedilla", "Egrave",
  "Eacute", "Ecircumflex", "Edieresis", "Igrave", "Iacute", "Icircumflex",
  "Idieresis", "Eth", "Ntilde", "Ograve", "Oacute", "Ocircumflex", "Otilde",
  "Odieresis", "multiply", "Oslash", "Ugrave", "Uacute", "Ucircumflex", "Udieresis",
  "Yacute", "Thorn", "germandbls", "agrave", "aacute", "acircumflex", "atilde",
  "adieresis", "aring", "ae", "ccedilla", "egrave", "eacute", "ecircumflex",
  "edieresis", "igrave", "iacute", "icircumflex", "idieresis", "eth", "ntilde",
  "ograve", "oacute", "ocircumflex", "otilde", "odieresis", "divide", "oslash",
  "ugrave", "uacute", "ucircumflex", "udieresis", "yacute", "thorn", "ydieresis",
];

/** Lebar cadangan (1/1000 em) untuk huruf yang tidak ada di AFM-nya. */
const LEBAR_CADANGAN = 556;

/** Membaca satu berkas AFM: nama huruf → lebarnya dalam 1/1000 em. */
function bacaAfm(berkas) {
  const teks = readFileSync(`${AKAR}node_modules/pdfkit/js/data/${berkas}`, "latin1");
  const lebar = new Map();
  for (const baris of teks.split("\n")) {
    const cocok = /^C\s+-?\d+\s*;\s*WX\s+(-?\d+)\s*;\s*N\s+(\S+)/.exec(baris.trim());
    if (cocok) lebar.set(cocok[2], Number(cocok[1]));
  }
  return lebar;
}

/** Tabel lebar satu huruf untuk kode WinAnsi 32–255. */
function tabel(lebar) {
  const nama = [...NAMA_ASCII, ...NAMA_TINGGI];
  return nama.map((glyph) => (glyph === null ? LEBAR_CADANGAN : lebar.get(glyph) ?? LEBAR_CADANGAN));
}

const biasa = tabel(bacaAfm("Helvetica.afm"));
const tebal = tabel(bacaAfm("Helvetica-Bold.afm"));

/** Baris angka dibungkus agar berkasnya tetap terbaca, 16 angka per baris. */
function tulis(angka) {
  const baris = [];
  for (let index = 0; index < angka.length; index += 16) {
    baris.push(`  ${angka.slice(index, index + 16).join(", ")},`);
  }
  return baris.join("\n");
}

const isi = `/**
 * Lebar huruf **Helvetica** & **Helvetica-Bold** untuk kode WinAnsiEncoding 32–255,
 * dalam 1/1000 em. Dipakai penulis PDF laporan (\`./laporanPdf\`) untuk mengukur
 * teks: lebar kolom tabel, pemotongan teks, dan pembungkusan kalimat.
 *
 * Kenapa tabelnya ada di repo, bukan dihitung saat jalan: angka ini berasal dari
 * berkas AFM resmi yang ikut terpasang bersama \`pdfkit\` (devDependency, dipakai
 * skrip pembuat panduan), sedangkan bundel aplikasi tidak memuat \`pdfkit\`.
 * Tabelnya dibaca **sekali** oleh \`scripts/gen-laporan-font.mjs\` lalu ditulis ke
 * sini — **jangan disunting tangan**; jalankan ulang skripnya kalau perlu diperbarui.
 *
 * Urutannya: indeks 0 = kode ${32} (spasi) sampai indeks ${biasa.length - 1} = kode ${255}.
 * Huruf yang tidak ada di AFM memakai lebar cadangan ${LEBAR_CADANGAN} (1/1000 em).
 */

/** Kode huruf pertama yang ada di tabel (spasi). */
export const LAPORAN_PDF_LEBAR_KODE_AWAL = 32;

/** Lebar yang dipakai kalau hurufnya tidak ada di tabel (1/1000 em). */
export const LAPORAN_PDF_LEBAR_CADANGAN = ${LEBAR_CADANGAN};

/** Helvetica biasa (PDF \`/F1\`). */
export const LAPORAN_PDF_LEBAR_BIASA: readonly number[] = [
${tulis(biasa)}
];

/** Helvetica-Bold (PDF \`/F2\`) — untuk judul, kepala kolom, dan baris jumlah. */
export const LAPORAN_PDF_LEBAR_TEBAL: readonly number[] = [
${tulis(tebal)}
];
`;

const tujuan = `${AKAR}src/convex/lib/laporanPdfFont.ts`;
writeFileSync(tujuan, isi, "latin1");
console.log(`Tabel lebar huruf ditulis: src/convex/lib/laporanPdfFont.ts (${biasa.length} huruf × 2 huruf)`);
console.log(`Contoh: "1" biasa=${biasa[49 - 32]} tebal=${tebal[49 - 32]} · "W" biasa=${biasa[87 - 32]} · "i" biasa=${biasa[105 - 32]}`);

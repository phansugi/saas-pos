/**
 * Berkas **Excel** (`.xlsx`) dari dokumen laporan: XML Office Open XML di dalam
 * wadah ZIP — ditulis sendiri, tanpa pustaka spreadsheet.
 *
 * Kenapa sendiri: berkas yang diunduh pemilik toko harus benar-benar bisa dibuka
 * Excel, dan bentuk yang paling aman adalah `.xlsx` asli (bukan CSV yang diberi
 * nama `.xls`, yang selalu memunculkan peringatan “format berkas berbeda”). Yang
 * dibutuhkan untuk itu ternyata sedikit: XML daftar isi, relasi, buku kerja, gaya,
 * lembar-lembar laporan, dan — untuk tiap grafik — satu lembar data plus **bagan
 * Excel asli** (`chartN.xml` + `drawingN.xml` + relasinya). Wadahnya arsip ZIP
 * **tanpa pemadatan** (isi teks laporan tidak sebanding dengan membawa mesin deflate
 * ke bundel aplikasi), dengan cap waktu entri tetap supaya hasilnya deterministik.
 *
 * Empat hal yang membuat berkasnya nyaman dipakai:
 *
 * 1. **Setiap bagian laporan jadi lembar sendiri** (Ringkasan, Metode bayar, Pajak
 *    & pungutan, tiap tabel analitik, lintas cabang) — angka pajak tidak perlu
 *    digulir jauh untuk ditemukan.
 * 2. **Grafiknya bagan Excel yang benar-benar hidup**: bagannya menunjuk ke sel
 *    lembar datanya (`'Grafik - Omzet per jam'!$B$2:$B$25`), jadi mengubah angka di
 *    lembar itu langsung menggerakkan batangnya — bukan gambar tempelan yang tidak
 *    bisa diapa-apakan.
 * 3. **Sel uang & angka ditulis sebagai angka**, dengan format bawaan Excel
 *    `#,##0` (rupiah) dan `0.00` (desimal). Jadi kolom omzet bisa langsung
 *    dijumlahkan; teks seperti “Rp1.234.567” akan membuat SUM mengembalikan 0.
 * 4. **Hasilnya deterministik**: cap waktu arsip ZIP-nya tetap, jadi dua unduhan
 *    dari data yang sama menghasilkan byte yang sama — dan harness bisa
 *    membandingkannya.
 * 5. **Warnanya mengikuti bagiannya**, bukan satu warna untuk seluruh berkas: tiap
 *    lembar memakai satu keluarga warna dari `laporanWarna.ts` (sumber yang sama
 *    dengan berkas PDF) — pita judul berhuruf putih, pita kepala kolom, baris
 *    selang-seling, baris jumlah bergaris tebal, dan batang bagannya.
 *
 * Isinya **hanya** dari `LaporanDocument` yang sama dengan CSV & PDF: modul ini tidak
 * menghitung angka apa pun, hanya menggambar.
 */

import {
  cellIsNumeric,
  cellValue,
  laporanChartValues,
  type LaporanCell,
  type LaporanChart,
  type LaporanDocument,
  type LaporanSection,
} from "./laporan";
import {
  LAPORAN_WARNA,
  LAPORAN_WARNA_DAFTAR,
  laporanWarnaArgb,
  laporanWarnaBatang,
  laporanWarnaBatangSemua,
  laporanWarnaNamaBagian,
  type LaporanWarnaNama,
} from "./laporanWarna";

/** Nilai sel yang dipakai di berkas Excel: teks atau angka. */
type SheetValue = string | number;

/** Jenis angka sel: menentukan format bawaannya (`#,##0` atau `0.00`). */
type CellKind = "text" | "money" | "number";

/**
 * Peran sel — yang menentukan warnanya, sama seperti peran baris di berkas PDF.
 *
 * Peran dipisahkan dari jenis isinya karena keduanya memang beda pertanyaan:
 * “angkanya uang atau teks” menentukan format, sedangkan “ini kepala kolom, baris
 * selang-seling, atau baris jumlah” menentukan pita & ketebalannya.
 */
export type CellRole =
  /** Sel biasa tanpa bingkai (dipakai lembar info). */
  | "normal"
  /** Judul lembar (nama bagian laporan). */
  | "title"
  /** Keterangan kecil di bawah tabel. */
  | "note"
  /** Kepala kolom: huruf putih di atas pita. */
  | "header"
  /** Sel isi bertabel. */
  | "cell"
  /** Sel isi berselang-seling (pita tipis). */
  | "band"
  /** Baris jumlah: pita aksen + garis tebal di atasnya. */
  | "total";

interface SheetCell {
  value: SheetValue;
  kind: CellKind;
  role: CellRole;
}

interface SheetRow {
  cells: SheetCell[];
}

interface Sheet {
  name: string;
  rows: SheetRow[];
  /**
   * Keluarga warna lembar ini — satu bagian laporan = satu keluarga warna, sama
   * seperti halaman Laporan dan berkas PDF-nya. Warna inilah yang dipakai pita
   * kepala kolom, pita baris selang-seling, pita baris jumlah, garis tebal baris
   * jumlah, dan warna huruf judulnya.
   */
  warna: LaporanWarnaNama;
  /**
   * Berapa baris pertama yang dibekukan (judul + kepala kolom). Nol = tidak
   * dibekukan. Angka ini juga dipakai menyaring rentangnya (`autofilter`).
   */
  freezeRows: number;
  /** Diisi kalau lembar ini menemani sebuah grafik (lembar data bagannya). */
  chart?: LaporanChart;
}

function rowFromCells(cells: LaporanCell[], role: CellRole = "cell"): SheetRow {
  return {
    cells: cells.map((cell) => ({
      value: cellValue(cell),
      kind: cellIsNumeric(cell) ? ("money" in cell ? "money" : "number") : "text",
      role,
    })),
  };
}

function textRow(label: string, value: SheetValue, role: CellRole = "normal"): SheetRow {
  return {
    cells: [
      { value: label, kind: "text", role },
      { value, kind: "text", role },
    ],
  };
}

/* --------------------------------------------------------------- gaya ---- */

/**
 * Daftar format sel, **berurutan**: indeksnya di `styles.xml` lahir dari urutan
 * ini, jadi menambah satu peran cukup ditambahkan di daftar perannya.
 */
const PERAN_SEL: CellRole[] = ["normal", "title", "note", "header", "cell", "band", "total"];
const JENIS_SEL: CellKind[] = ["text", "money", "number"];

/** Indeks keluarga warna di `styles.xml` — urutannya dari `LAPORAN_WARNA_DAFTAR`. */
function keluargaIndex(warna: LaporanWarnaNama): number {
  return Math.max(0, LAPORAN_WARNA_DAFTAR.indexOf(warna));
}

/**
 * Indeks gaya satu sel di `styles.xml`.
 *
 * Gaya disusun **per keluarga warna**: 21 gaya pertama (7 peran × 3 jenis angka) milik
 * keluarga `netral`, 21 berikutnya milik keluarga kedua, dan seterusnya. Keluarga
 * netral ditaruh paling depan supaya nomor gaya netral tidak bergeser saat keluarga
 * baru ditambahkan di akhir daftar, dan supaya nomor gaya bagian mana pun bisa
 * **dihitung** dari peran + jenis + warnanya, bukan dicari-cari di berkasnya.
 */
export function laporanCellStyleIndex(
  role: CellRole,
  kind: CellKind,
  warna: LaporanWarnaNama = "netral",
): number {
  const peran = Math.max(0, PERAN_SEL.indexOf(role));
  const jenis = Math.max(0, JENIS_SEL.indexOf(kind));
  return (keluargaIndex(warna) * PERAN_SEL.length + peran) * JENIS_SEL.length + jenis;
}

/**
 * Cacah & indeks bagian `styles.xml`, diturunkan dari daftar keluarga warna — jadi
 * menambah satu keluarga warna menambah empat pita dan satu bingkai jumlah, tanpa ada
 * angka yang perlu diperbarui satu per satu.
 */
const KELUARGA = LAPORAN_WARNA_DAFTAR.length;
const HURUF_BANYAK = 5;
// Dua pita pertama bukan warna (`none` & `gray125`), sisanya empat nada per keluarga.
const PITA_BANYAK = 2 + KELUARGA * 4;
const BINGKAI_BANYAK = 2 + KELUARGA;
const HURUF_BIASA = 0;
const HURUF_TEBAL = 1;
const HURUF_PUTIH_TEBAL = 2;
/** Judul lembar: putih di atas pita bagiannya, sama seperti judul bagian di PDF. */
const HURUF_JUDUL = 3;
const HURUF_KECIL = 4;
const BINGKAI_KOSONG = 0;
const BINGKAI_TIPIS = 1;

/** Pita satu keluarga: judul lembar, kepala kolom, baris selang-seling, baris jumlah. */
function pitaKeluarga(
  keluarga: number,
  peran: "bagian" | "kepala" | "selang" | "jumlah",
): number {
  const urutan = peran === "bagian" ? 0 : peran === "kepala" ? 1 : peran === "selang" ? 2 : 3;
  return 2 + keluarga * 4 + urutan;
}

/** Bingkai baris jumlah satu keluarga: bergaris tebal di tepi atas. */
const bingkaiJumlah = (keluarga: number) => 2 + keluarga;

/** Format angka bawaan Excel: ribuan dengan pemisah & desimal dua angka. */
const NUMFMT = { umum: 0, ribuan: 3, desimal: 4 } as const;

interface CellFormat {
  font: number;
  fill: number;
  border: number;
  numFmt: number;
}

/**
 * Susunan warna satu peran: kepala kolom berpita hijau tua berhuruf putih, baris
 * selang-seling berpita sangat tipis, dan baris jumlah berpita aksen dengan garis
 * tebal di atasnya — sama seperti berkas PDF-nya, supaya pembaca yang menerima
 * kedua berkas mengenali tabelnya sebagai laporan yang sama.
 */
function formatSel(
  role: CellRole,
  kind: CellKind,
  warna: LaporanWarnaNama = "netral",
): CellFormat {
  const numFmt =
    kind === "money" ? NUMFMT.ribuan : kind === "number" ? NUMFMT.desimal : NUMFMT.umum;
  const keluarga = keluargaIndex(warna);
  switch (role) {
    case "title":
      return {
        font: HURUF_JUDUL,
        fill: pitaKeluarga(keluarga, "bagian"),
        border: BINGKAI_KOSONG,
        numFmt,
      };
    case "note":
      return { font: HURUF_KECIL, fill: 0, border: BINGKAI_KOSONG, numFmt };
    case "header":
      return {
        font: HURUF_PUTIH_TEBAL,
        fill: pitaKeluarga(keluarga, "kepala"),
        border: BINGKAI_TIPIS,
        numFmt,
      };
    case "cell":
      return { font: HURUF_BIASA, fill: 0, border: BINGKAI_TIPIS, numFmt };
    case "band":
      return {
        font: HURUF_BIASA,
        fill: pitaKeluarga(keluarga, "selang"),
        border: BINGKAI_TIPIS,
        numFmt,
      };
    case "total":
      return {
        font: HURUF_TEBAL,
        fill: pitaKeluarga(keluarga, "jumlah"),
        border: bingkaiJumlah(keluarga),
        numFmt,
      };
    default:
      return { font: HURUF_BIASA, fill: 0, border: BINGKAI_KOSONG, numFmt };
  }
}

function styleOf(cell: SheetCell, warna: LaporanWarnaNama): number {
  return laporanCellStyleIndex(cell.role, cell.kind, warna);
}

/**
 * Nama lembar Excel: ≤ 31 huruf, tanpa karakter terlarang, dan tidak kembar.
 *
 * Tanda kutip tunggal ikut dibuang: nama lembar dipakai di dalam rumus rujukan
 * bagan (`'Grafik - Omzet per jam'!$B$2`), dan kutip di dalam nama akan membuat
 * rumusnya pecah di Excel.
 */
export function laporanSheetName(title: string, dipakai: Set<string>): string {
  const bersih = title.replace(/[[\]:*?/\\']/g, "-").trim();
  const dasar = (bersih === "" ? "Lembar" : bersih).slice(0, 31);
  let nama = dasar;
  let nomor = 2;
  while (dipakai.has(nama.toLowerCase())) {
    const akhiran = ` (${nomor})`;
    nama = `${dasar.slice(0, 31 - akhiran.length)}${akhiran}`;
    nomor += 1;
  }
  dipakai.add(nama.toLowerCase());
  return nama;
}

/** Baris & kolom (0 = A) jadi acuan sel Excel: `B7`. */
export function laporanCellRef(rowIndex: number, colIndex: number): string {
  let col = "";
  let index = colIndex;
  do {
    col = String.fromCharCode(65 + (index % 26)) + col;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return `${col}${rowIndex + 1}`;
}

/** Teks → XML yang sah (kendali di luar yang diizinkan XML dibuang). */
export function laporanXmlEscape(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Rujukan rentang di lembar lain untuk rumus Excel: `'Grafik - Jam'!$A$2:$A$25`. */
export function laporanSheetRange(
  sheetName: string,
  dariKolom: string,
  dariBaris: number,
  sampaiKolom: string,
  sampaiBaris: number,
): string {
  const nama = sheetName.replace(/'/g, "''");
  return `'${nama}'!$${dariKolom}$${dariBaris}:$${sampaiKolom}$${sampaiBaris}`;
}

/**
 * Rentang tabel yang disaring (`autoFilter`): dari baris kepala kolom sampai baris
 * terakhir yang isinya masih bagian tabel itu — keterangan di bawah tabel tidak ikut,
 * karena menyaringnya akan menghilangkan penjelasan yang dibutuhkan pembacanya.
 */
function rentangSaring(sheet: Sheet): string | null {
  const mulai = sheet.rows.findIndex((row) => row.cells.some((cell) => cell.role === "header"));
  if (mulai < 0) return null;
  let akhir = mulai;
  for (let index = mulai + 1; index < sheet.rows.length; index += 1) {
    const peran = new Set(sheet.rows[index].cells.map((cell) => cell.role));
    if (peran.has("cell") || peran.has("band") || peran.has("total")) akhir = index;
    else break;
  }
  const kolom = Math.max(1, ...sheet.rows.map((row) => row.cells.length));
  return `A${mulai + 1}:${laporanCellRef(akhir, kolom - 1)}`;
}

function sheetXml(sheet: Sheet, drawingIndex: number | null): string {
  const lebarKolom: number[] = [];
  for (const row of sheet.rows) {
    // Baris judul ikut dilewati walau pitanya selebar tabel: teksnya lebih panjang dari
    // isi kolom mana pun, dan kalau lebarnya ikut dihitung kolom A melebar mengikuti
    // panjang judulnya lalu tabelnya terdorong ke kanan.
    if (row.cells.every((cell) => cell.role === "title")) continue;
    row.cells.forEach((cell, index) => {
      const panjang = String(cell.value).length + 2;
      lebarKolom[index] = Math.max(lebarKolom[index] ?? 0, panjang);
    });
  }

  const cols =
    lebarKolom.length === 0
      ? ""
      : `<cols>${lebarKolom
          .map(
            (_lebar, index) =>
              `<col min="${index + 1}" max="${index + 1}" width="${Math.min(
                48,
                Math.max(10, lebarKolom[index]),
              )}" customWidth="1"/>`,
          )
          .join("")}</cols>`;

  const rows = sheet.rows
    .map((row, rowIndex) => {
      const cells = row.cells
        .map((cell, colIndex) => {
          const ref = laporanCellRef(rowIndex, colIndex);
          const style = styleOf(cell, sheet.warna);
          if (typeof cell.value === "number") {
            return `<c r="${ref}" s="${style}"><v>${String(cell.value)}</v></c>`;
          }
          if (cell.value === "") return `<c r="${ref}" s="${style}"/>`;
          return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${laporanXmlEscape(
            cell.value,
          )}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  // Baris judul & kepala kolom dibekukan: saat menggulir tabel sembilan kolom ke
  // bawah, pembacanya tidak perlu lagi menebak kolom mana milik siapa.
  const beku =
    sheet.freezeRows <= 0
      ? ""
      : `<pane ySplit="${sheet.freezeRows}" topLeftCell="A${
          sheet.freezeRows + 1
        }" activePane="bottomLeft" state="frozen"/>` +
        `<selection pane="bottomLeft" activeCell="A${
          sheet.freezeRows + 1
        }" sqref="A${sheet.freezeRows + 1}"/>`;

  const saring = rentangSaring(sheet);

  // `<autoFilter>` dan `<drawing>` harus berada **setelah** `sheetData` menurut
  // skema OOXML; bagan yang ditulis sebelum datanya membuat Excel menolak berkasnya.
  const sesudahData =
    (saring === null ? "" : `<autoFilter ref="${saring}"/>`) +
    (drawingIndex === null ? "" : `<drawing r:id="rIdDrawing${drawingIndex}"/>`);

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0">${beku}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    cols +
    `<sheetData>${rows}</sheetData>` +
    sesudahData +
    `</worksheet>`
  );
}

/**
 * `styles.xml`: warna laporan, **satu keluarga warna per bagian**.
 *
 * Warnanya datang utuh dari `laporanWarna.ts` — sumber yang sama dengan berkas PDF —
 * jadi lembar `Pajak & pungutan` di Excel memakai pita kuning madu yang sama dengan
 * halaman bagian itu di PDF, bukan warna yang kebetulan mirip.
 *
 * Tiga aturan yang dipegang, sama seperti berkas PDF-nya:
 *
 * 1. warna dipakai untuk **menuntun mata** (kepala kolom, baris selang-seling, baris
 *    jumlah), bukan menghias;
 * 2. kepala kolom selalu **tingkat 700** — putih di atas nada yang lebih muda dari
 *    itu tidak lolos kontras 4,5:1;
 * 3. warna tidak dipakai untuk hal yang bisa hilang saat dicetak hitam-putih: angkanya
 *    tetap angka, kepala kolom & baris jumlah tetap dicetak tebal.
 *
 * Pita baris dibuat sangat tipis (nada 50/100) supaya tidak menjadi blok warna di
 * layar, sedangkan bingkai tipis ada di semua sel tabel supaya kolom angkanya tidak
 * “melayang” saat digulir mendatar.
 */
const STYLES_XML = (() => {
  const fonts =
    `<font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="13"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
    `<font><i/><sz val="10"/><color rgb="FF5F6B6E"/><name val="Calibri"/></font>`;

  const fills =
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    LAPORAN_WARNA_DAFTAR.flatMap((nama) => {
      const warna = LAPORAN_WARNA[nama];
      return [warna.bagian, warna.kepala, warna.selang, warna.jumlah].map(
        (hex) =>
          `<fill><patternFill patternType="solid"><fgColor rgb="${laporanWarnaArgb(
            hex,
          )}"/><bgColor indexed="64"/></patternFill></fill>`,
      );
    }).join("");

  const garisTipis =
    `<left style="thin"><color rgb="FFB9CDCA"/></left>` +
    `<right style="thin"><color rgb="FFB9CDCA"/></right>` +
    `<bottom style="thin"><color rgb="FFB9CDCA"/></bottom>`;
  const borders =
    `<border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border>${garisTipis}<top style="thin"><color rgb="FFB9CDCA"/></top><diagonal/></border>` +
    LAPORAN_WARNA_DAFTAR.map(
      (nama) =>
        // Garis tebal di tepi atas baris jumlah memakai warna aksen keluarga itu,
        // jadi baris jumlahnya menonjol tanpa perlu dibaca angkanya.
        `<border>${garisTipis}<top style="medium"><color rgb="${laporanWarnaArgb(
          LAPORAN_WARNA[nama].garis,
        )}"/></top><diagonal/></border>`,
    ).join("");

  const xfs = LAPORAN_WARNA_DAFTAR.flatMap((nama) =>
    PERAN_SEL.flatMap((role) =>
      JENIS_SEL.map((kind) => {
        const gaya = formatSel(role, kind, nama);
        return (
          `<xf numFmtId="${gaya.numFmt}" fontId="${gaya.font}" fillId="${gaya.fill}" borderId="${gaya.border}" xfId="0"` +
          `${gaya.numFmt === 0 ? "" : ' applyNumberFormat="1"'}` +
          `${gaya.font === 0 ? "" : ' applyFont="1"'}` +
          `${gaya.fill === 0 ? "" : ' applyFill="1"'}` +
          `${gaya.border === 0 ? "" : ' applyBorder="1"'}/>`
        );
      }),
    ),
  ).join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="${HURUF_BANYAK}">${fonts}</fonts>` +
    `<fills count="${PITA_BANYAK}">${fills}</fills>` +
    `<borders count="${BINGKAI_BANYAK}">${borders}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${PERAN_SEL.length * JENIS_SEL.length * KELUARGA}">${xfs}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
})();

const CHART_NAMESPACE = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const DRAWING_NAMESPACE =
  "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const DRAWINGML_NAMESPACE = "http://schemas.openxmlformats.org/drawingml/2006/main";
const REL_NAMESPACE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/**
 * Bagan bawaan satu grafik laporan.
 *
 * Bentuknya sengaja yang paling dasar yang masih dianggap lengkap oleh Excel:
 * bagan batang tegak satu seri, dengan **cache** nilai & kategori di dalam berkasnya
 * (itu sebabnya bagannya tetap tampil walau Excel memilih menghitung ulang), judul
 * bagan, sumbu nilai berformat ribuan, dan garis bantu mendatar supaya tingginya
 * gampang dibaca.
 */
export function laporanChartXml(chart: LaporanChart, sheetName: string): string {
  const values = laporanChartValues(chart);
  const n = chart.points.length;
  const kategoriCache = chart.points
    .map(
      (point, index) =>
        `<c:pt idx="${index}"><c:v>${laporanXmlEscape(point.label)}</c:v></c:pt>`,
    )
    .join("");
  const nilaiCache = values
    .map((value, index) => `<c:pt idx="${index}"><c:v>${String(value)}</c:v></c:pt>`)
    .join("");
  // Lembar datanya bertabel: baris 1 judul, baris 2 kepala kolom, datanya mulai
  // baris 3. Rujukannya harus ikut — bagan yang menunjuk baris kosong tampil rata
  // tanpa batang, dan itu tampak seperti laporan yang rusak.
  const kategoriRef = laporanSheetRange(sheetName, "A", 3, "A", n + 2);
  const nilaiRef = laporanSheetRange(sheetName, "B", 3, "B", n + 2);
  const judulRef = laporanSheetRange(sheetName, "B", 2, "B", 2);
  const formatCode = chart.unit === "money" ? "#,##0" : "General";
  /*
    Batangnya diberi warna per titik, dengan aturan yang sama seperti berkas PDF
    (`laporanWarnaBatang`): makin tinggi nilainya, makin tua nadanya. Bagannya jadi
    terbaca dari warnanya juga — bukan hanya dari panjang batangnya — dan tetap satu
    keluarga warna dengan tabel di atasnya.
  */
  const warnaBatang = laporanWarnaBatangSemua(chart.sectionId);
  const dPt = chart.points
    .map(
      (_point, index) =>
        `<c:dPt><c:idx val="${index}"/><c:spPr><a:solidFill><a:srgbClr val="${laporanWarnaBatang(
          chart.sectionId,
          values[index] ?? 0,
          Math.max(0, ...values),
        )}"/></a:solidFill></c:spPr></c:dPt>`,
    )
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<c:chartSpace xmlns:c="${CHART_NAMESPACE}" xmlns:a="${DRAWINGML_NAMESPACE}" xmlns:r="${REL_NAMESPACE}">` +
    `<c:chart>` +
    // Judul bagannya dicetak tebal dengan nada tua bagiannya, sama seperti judul
    // grafik di berkas PDF — jadi grafik bagian mana pun langsung dikenali warnanya.
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r>` +
    `<a:rPr lang="id-ID" b="1"><a:solidFill><a:srgbClr val="${
      LAPORAN_WARNA[laporanWarnaNamaBagian(chart.sectionId)].bagian
    }"/></a:solidFill></a:rPr><a:t>${laporanXmlEscape(chart.title)}</a:t></a:r></a:p></c:rich></c:tx>` +
    `<c:overlay val="0"/></c:title>` +
    `<c:plotArea>` +
    `<c:layout/>` +
    `<c:barChart>` +
    `<c:barDir val="col"/>` +
    `<c:grouping val="clustered"/>` +
    `<c:varyColors val="0"/>` +
    `<c:ser>` +
    `<c:idx val="0"/><c:order val="0"/>` +
    `<c:tx><c:strRef><c:f>${laporanXmlEscape(judulRef)}</c:f>` +
    `<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${laporanXmlEscape(
      chart.unit === "money" ? "Nilai (Rp)" : "Nilai",
    )}</c:v></c:pt></c:strCache></c:strRef></c:tx>` +
    `<c:cat><c:strRef><c:f>${laporanXmlEscape(kategoriRef)}</c:f>` +
    `<c:strCache><c:ptCount val="${n}"/>${kategoriCache}</c:strCache></c:strRef></c:cat>` +
    `<c:spPr><a:solidFill><a:srgbClr val="${warnaBatang[2]}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>` +
    dPt +
    `<c:val><c:numRef><c:f>${laporanXmlEscape(nilaiRef)}</c:f>` +
    `<c:numCache><c:formatCode>${formatCode}</c:formatCode><c:ptCount val="${n}"/>${nilaiCache}</c:numCache></c:numRef></c:val>` +
    `</c:ser>` +
    `<c:gapWidth val="55"/>` +
    `<c:axId val="111111111"/><c:axId val="222222222"/>` +
    `</c:barChart>` +
    `<c:catAx>` +
    `<c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="b"/><c:crossAx val="222222222"/>` +
    `</c:catAx>` +
    `<c:valAx>` +
    `<c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="l"/>` +
    `<c:majorGridlines/>` +
    `<c:numFmt formatCode="${formatCode}" sourceLinked="0"/>` +
    `<c:crossAx val="111111111"/>` +
    `</c:valAx>` +
    `</c:plotArea>` +
    `<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>` +
    `<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>` +
    `</c:chart>` +
    `<c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings>` +
    `</c:chartSpace>`
  );
}

/** Bagan ditempel di sebelah kanan tabel datanya: kolom E, baris 2, ± 12 × 8 cm. */
export function laporanDrawingXml(chartIndex: number): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="${DRAWING_NAMESPACE}" xmlns:a="${DRAWINGML_NAMESPACE}" xmlns:c="${CHART_NAMESPACE}" xmlns:r="${REL_NAMESPACE}">` +
    `<xdr:twoCellAnchor>` +
    `<xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:to><xdr:col>12</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>19</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
    `<xdr:graphicFrame macro="">` +
    `<xdr:nvGraphicFramePr>` +
    `<xdr:cNvPr id="${chartIndex + 1}" name="Grafik ${chartIndex + 1}"/>` +
    `<xdr:cNvGraphicFramePr/>` +
    `</xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
    `<a:graphic><a:graphicData uri="${CHART_NAMESPACE}">` +
    `<c:chart r:id="rIdChart${chartIndex}"/>` +
    `</a:graphicData></a:graphic>` +
    `</xdr:graphicFrame>` +
    `<xdr:clientData/>` +
    `</xdr:twoCellAnchor>` +
    `</xdr:wsDr>`
  );
}

/**
 * Seluruh lembar berkas, **berurutan**: satu lembar **Info berkas** (kepala berkas &
 * catatan), satu lembar per bagian laporan, lalu satu lembar data + bagan per grafik.
 */
/**
 * Baris judul lembar: huruf putih tebal di atas pita keluarga warnanya.
 *
 * Pitanya dilebarkan sampai kolom terakhir tabelnya (`kolom`), bukan hanya sel
 * judulnya — pita yang hanya menutupi kolom A akan tampak menggantung di sisi kiri
 * tabel yang sembilan kolom lebarnya.
 */
function judulLembar(text: string, kolom = 1): SheetRow {
  return {
    cells: [
      { value: text, kind: "text", role: "title" },
      ...Array.from({ length: Math.max(0, kolom - 1) }, () => ({
        value: "",
        kind: "text" as const,
        role: "title" as const,
      })),
    ],
  };
}

/** Baris keterangan kecil di bawah tabel (satu sel, huruf miring). */
function catatanLembar(text: string): SheetRow {
  return { cells: [{ value: text, kind: "text", role: "note" }] };
}

export function laporanSheets(document: LaporanDocument): Sheet[] {
  const dipakai = new Set<string>();
  /*
    Lembar “Info berkas” dibuka ringkasan bahasa sehari-hari: pembaca yang tidak
    terbiasa dengan istilah pembukuan bisa berhenti di lembar pertama dan sudah tahu
    tokonya dapat berapa. Barisnya ditulis dari `summaryLines` — sumber yang sama
    dengan berkas PDF & CSV — jadi tidak ada angka yang diketik ulang di sini.
  */
  const info: SheetRow[] = [judulLembar("Info berkas", 2)];
  if (document.summaryLines.length > 0) {
    info.push(judulLembar("Ringkasan singkat", 2));
    for (const line of document.summaryLines) {
      info.push({ cells: [{ value: line, kind: "text", role: "normal" }] });
    }
  }
  info.push(
    textRow("Judul", document.title),
    textRow("Ruang kerja", document.workspace),
    textRow("Toko", document.store),
    textRow("Periode", document.period),
    textRow("Dibuat", new Date(document.generatedAt).toISOString()),
  );
  for (const note of document.notes) info.push(textRow("Catatan", note));

  const sheets: Sheet[] = [
    {
      name: laporanSheetName("Info berkas", dipakai),
      rows: info,
      // Lembar info memakai keluarga warna bagian ringkasan (hijau zamrud), sama
      // dengan kotak ringkasan di halaman pertama PDF.
      warna: laporanWarnaNamaBagian("ringkasan"),
      freezeRows: 0,
    },
  ];

  /**
   * Satu bagian laporan jadi satu lembar bertabel: judul, kepala kolom berpita,
   * baris isi berselang-seling, baris jumlah berpita aksen, lalu keterangannya.
   * Kepala kolom & judulnya dibekukan (`freezeRows: 2`), jadi saat menggulir tabel
   * sembilan kolom ke bawah, nama kolomnya tetap terlihat.
   */
  const sectionRows = (section: LaporanSection): SheetRow[] => [
    judulLembar(section.title, section.headers.length),
    {
      cells: section.headers.map((header) => ({
        value: header,
        kind: "text" as const,
        role: "header" as const,
      })),
    },
    ...section.rows.map((row, index) =>
      rowFromCells(row.cells, index % 2 === 1 ? "band" : "cell"),
    ),
    ...(section.total ? [rowFromCells(section.total.cells, "total")] : []),
    ...(section.note ? [catatanLembar(section.note)] : []),
  ];

  for (const section of document.sections) {
    sheets.push({
      name: laporanSheetName(section.title, dipakai),
      rows: sectionRows(section),
      warna: laporanWarnaNamaBagian(section.id),
      freezeRows: 2,
    });
  }

  for (const chart of document.charts) {
    const values = laporanChartValues(chart);
    const rows: SheetRow[] = [
      judulLembar(`Grafik - ${chart.title}`, 2),
      {
        cells: [
          { value: "Label", kind: "text", role: "header" },
          {
            value: chart.unit === "money" ? "Nilai (Rp)" : "Nilai",
            kind: "text",
            role: "header",
          },
        ],
      },
      ...chart.points.map((point, index) => ({
        cells: [
          {
            value: point.label,
            kind: "text" as const,
            role: (index % 2 === 1 ? "band" : "cell") as CellRole,
          },
          {
            value: values[index] ?? 0,
            kind: (chart.unit === "money" ? "money" : "number") as "money" | "number",
            role: (index % 2 === 1 ? "band" : "cell") as CellRole,
          },
        ],
      })),
    ];
    sheets.push({
      name: laporanSheetName(`Grafik - ${chart.title}`, dipakai),
      rows,
      // Lembar data bagan memakai warna bagian grafiknya, jadi warnanya tidak
      // berpindah saat matanya bergerak dari tabel ke grafiknya.
      warna: laporanWarnaNamaBagian(chart.sectionId),
      freezeRows: 2,
      chart,
    });
  }
  return sheets;
}

/* ---------------------------------------------------------------- ZIP ---- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** CRC-32 standar ZIP dari byte apa pun. */
export function laporanCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

/**
 * Arsip ZIP **tanpa pemadatan** (`method 0`).
 *
 * Tanggal & jam entri sengaja tetap (1 Januari 1980) supaya byte arsipnya
 * deterministik: berkas yang sama tidak berubah hanya karena diunduh pada menit
 * yang berbeda.
 */
export function zipStored(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (value: number) => [value & 0xff, (value >>> 8) & 0xff];
  const u32 = (value: number) => [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];

  const DOS_DATE = 0x0021; // 1980-01-01
  const DOS_TIME = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = laporanCrc32(entry.bytes);
    const size = entry.bytes.length;

    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(DOS_TIME),
      ...u16(DOS_DATE),
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      ...u16(0),
    ]);
    chunks.push(local, nameBytes, entry.bytes);

    central.push(
      new Uint8Array([
        ...u32(0x02014b50),
        ...u16(20),
        ...u16(20),
        ...u16(0),
        ...u16(0),
        ...u16(DOS_TIME),
        ...u16(DOS_DATE),
        ...u32(crc),
        ...u32(size),
        ...u32(size),
        ...u16(nameBytes.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
        ...nameBytes,
      ]),
    );

    offset += local.length + nameBytes.length + size;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralSize),
    ...u32(offset),
    ...u16(0),
  ]);

  const parts = [...chunks, ...central, end];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/* -------------------------------------------------------------- berkas --- */

/**
 * Daftar bagian (`[Content_Types].xml` dst.) berurutan, tanpa wadah ZIP-nya.
 *
 * Bagan butuh rantai relasi yang lengkap — lembar → gambar → bagan — dan tiap mata
 * rantainya harus terdaftar di daftar isi; satu mata yang hilang membuat Excel
 * menolak berkasnya atau menawarkan “perbaikan”.
 */
export function laporanXlsxParts(document: LaporanDocument): ZipEntry[] {
  const encoder = new TextEncoder();
  const sheets = laporanSheets(document);
  const chartSheets = sheets
    .map((sheet, index) => ({ sheet, index }))
    .filter((row) => row.sheet.chart !== undefined);

  const parts: ZipEntry[] = [];
  const add = (name: string, xml: string) =>
    parts.push({ name, bytes: encoder.encode(xml) });

  const gambarUntuk = (sheetIndex: number): number | null => {
    const posisi = chartSheets.findIndex((row) => row.index === sheetIndex);
    return posisi < 0 ? null : posisi + 1;
  };

  add(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      sheets
        .map(
          (_sheet, index) =>
            `<Override PartName="/xl/worksheets/sheet${
              index + 1
            }.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("") +
      chartSheets
        .map(
          (_row, index) =>
            `<Override PartName="/xl/drawings/drawing${
              index + 1
            }.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` +
            `<Override PartName="/xl/charts/chart${
              index + 1
            }.xml" ContentType="application/vnd.openxmlformats-officedocument.chart+xml"/>`,
        )
        .join("") +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
  );

  add(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL_NAMESPACE}/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );

  add(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL_NAMESPACE}">` +
      `<sheets>` +
      sheets
        .map(
          (sheet, index) =>
            `<sheet name="${laporanXmlEscape(sheet.name)}" sheetId="${
              index + 1
            }" r:id="rId${index + 1}"/>`,
        )
        .join("") +
      `</sheets>` +
      `</workbook>`,
  );

  add(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets
        .map(
          (_sheet, index) =>
            `<Relationship Id="rId${
              index + 1
            }" Type="${REL_NAMESPACE}/worksheet" Target="worksheets/sheet${
              index + 1
            }.xml"/>`,
        )
        .join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="${REL_NAMESPACE}/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  );

  add("xl/styles.xml", STYLES_XML);

  sheets.forEach((sheet, index) => {
    const gambar = gambarUntuk(index);
    add(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet, gambar));
    if (gambar !== null) {
      add(
        `xl/worksheets/_rels/sheet${index + 1}.xml.rels`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rIdDrawing${gambar}" Type="${REL_NAMESPACE}/drawing" Target="../drawings/drawing${gambar}.xml"/>` +
          `</Relationships>`,
      );
    }
  });

  chartSheets.forEach((row, index) => {
    const nomor = index + 1;
    add(`xl/drawings/drawing${nomor}.xml`, laporanDrawingXml(nomor));
    add(
      `xl/drawings/_rels/drawing${nomor}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rIdChart${nomor}" Type="${REL_NAMESPACE}/chart" Target="../charts/chart${nomor}.xml"/>` +
        `</Relationships>`,
    );
    add(
      `xl/charts/chart${nomor}.xml`,
      laporanChartXml(row.sheet.chart!, row.sheet.name),
    );
  });

  return parts;
}

/** Byte berkas `.xlsx` siap diunduh. */
export function laporanXlsx(document: LaporanDocument): Uint8Array {
  return zipStored(laporanXlsxParts(document));
}

/** Lembar & barisnya sebagai teks — dipakai harness untuk memeriksa isinya. */
export function laporanXlsxTextRows(document: LaporanDocument): string[][] {
  return laporanSheets(document).map((sheet) => [
    sheet.name,
    ...sheet.rows.map((row) => row.cells.map((cell) => String(cell.value)).join(" | ")),
  ]);
}

/**
 * Berkas **PDF** laporan: halaman A4 tegak yang **tampilannya mengikuti halaman
 * Laporan di aplikasi**, bukan sekadar tabel berpita.
 *
 * Kenapa ditulis sendiri: sama seperti berkas PDF struk (`@/lib/receiptPdf`), yang
 * dibutuhkan hanya huruf, garis, dan kotak berwarna pada halaman berukuran tetap —
 * jauh lebih kecil daripada membawa mesin tata letak beserta penyemat hurufnya ke
 * bundel aplikasi. Modul ini **murni**: tanpa DOM, tanpa jaringan, dan tanpa
 * tanggal “sekarang” dari jamnya sendiri, jadi berkasnya bisa dirakit dan diperiksa
 * di luar peramban.
 *
 * Yang membuat berkasnya terbaca sebagai **laporan yang sama** dengan halamannya:
 *
 * 1. **Huruf sans-serif yang sama dengan halaman** (Helvetica + Helvetica-Bold,
 *    huruf standar PDF). Sebelumnya berkasnya memakai Courier — huruf monospace
 *    yang semua hurufnya sama lebar; di A4 hasilnya terbaca seperti keluaran mesin
 *    ketik, bukan laporan. Lebar huruf Helvetica tidak seragam, jadi lebar kolom,
 *    pemotongan teks, dan pembungkusan kalimat diukur dari **tabel lebar huruf
 *    asli** (`./laporanPdfFont`, dari berkas AFM Adobe) — bukan ditebak.
 * 2. **Kartu seperti di halaman**: tiap bagian dibungkus kartu putih bergaris tepi
 *    bernada bagiannya, dengan pita warna di tepi atas, kotak ikon, label kecil
 *    (*kicker*), judul, dan keterangan — kerangka yang sama dengan `SectionCard`
 *    di halaman Laporan.
 * 3. **Petak angka seperti di halaman**: “Ringkasan periode” digambar sebagai
 *    petak-petak angka (label kecil + angka besar + keterangan), bukan tabel dua
 *    kolom; “Ringkasan singkat” digambar sebagai kalimat bernomor di dalam kotak
 *    bernada. Bentuk inilah yang dibaca orang lebih dulu di halaman, jadi bentuk
 *    yang sama dipakai di berkasnya.
 * 4. **Tabel & bagan yang sama bahasanya**: kepala kolom berpita nada tua bagiannya
 *    berhuruf putih, baris isi berselang-seling pita tipis, baris jumlah berpita
 *    aksen dengan garis tebal di atasnya, dan batang bagan memakai nada bagian yang
 *    makin tua kalau nilainya makin tinggi. Warnanya datang dari **satu** tempat
 *    (`./laporanWarna`) yang juga dipakai halaman dan berkas Excel, jadi layar, PDF,
 *    dan Excel tidak bisa menyimpang.
 * 5. **Warna bagiannya tembus pandang**, ditulis lewat `ExtGState` (`/A08 gs`) —
 *    persis seperti `bg-emerald-500/[0.08]` di halaman. Karena itu halamannya tetap
 *    terang (hemat tinta saat dicetak & difotokopi) padahal berwarna.
 * 6. **Kepala tabel tidak pernah terpisah dari barisnya**, dan bagian yang panjang
 *    (mis. 120 produk) menyambung ke halaman berikutnya **dengan kartu, label, dan
 *    kepala tabel yang diulang** — pembaca halaman kedua tidak perlu menebak kolom
 *    mana yang mana. Tiap halaman juga punya kepala, kaki, dan nomor halaman.
 *
 * Isinya **hanya** dari `LaporanDocument` yang sama dengan berkas Excel & CSV, jadi
 * ketiga berkas tidak bisa berbeda diam-diam.
 */

import {
  LAPORAN_WARNA,
  laporanWarnaBagian,
  laporanWarnaBatang,
  laporanWarnaNamaBagian,
  laporanWarnaPdf,
  type LaporanWarnaNama,
} from "./laporanWarna";
import {
  LAPORAN_CHART_AXIS_LABELS_MAX,
  cellDisplay,
  laporanChartAxisLabels,
  laporanChartValueText,
  laporanChartValues,
  type LaporanChart,
  type LaporanDocument,
  type LaporanRow,
  type LaporanSection,
} from "./laporan";
import {
  LAPORAN_PDF_LEBAR_BIASA,
  LAPORAN_PDF_LEBAR_CADANGAN,
  LAPORAN_PDF_LEBAR_KODE_AWAL,
  LAPORAN_PDF_LEBAR_TEBAL,
} from "./laporanPdfFont";

/* ====================================================== ukuran halaman ==== */

/** Ukuran halaman A4 tegak dalam poin (PDF memakai poin: 72 = 1 inci). */
export const LAPORAN_PDF_WIDTH_PT = 595.28;
export const LAPORAN_PDF_HEIGHT_PT = 841.89;

/** Margin halaman (34 pt = 1,2 cm) — cukup untuk printer yang tidak presisi. */
export const LAPORAN_PDF_MARGIN_PT = 34;

/** Lebar yang bisa dipakai isi halaman. */
export const LAPORAN_PDF_LEBAR_KONTEN_PT = LAPORAN_PDF_WIDTH_PT - 2 * LAPORAN_PDF_MARGIN_PT;

/** Tinggi area kaki (garis + tulisan) yang dipesan di bawah tiap halaman. */
export const LAPORAN_PDF_TINGGI_KAKI_PT = 34;

/** Tinggi yang bisa dipakai kepala + isi satu halaman. */
export const LAPORAN_PDF_TINGGI_KONTEN_PT =
  LAPORAN_PDF_HEIGHT_PT - 2 * LAPORAN_PDF_MARGIN_PT - LAPORAN_PDF_TINGGI_KAKI_PT;

/** Huruf standar PDF yang bentuknya sama dengan huruf halaman aplikasi. */
export const LAPORAN_PDF_FONT = "Helvetica";
export const LAPORAN_PDF_FONT_BOLD = "Helvetica-Bold";

export const LAPORAN_PDF_PRODUCER = "MesinPOS";

/* ---------------------------------------------------------- tata letak --- */

/** Jarak isi kartu dari tepi kartunya (kiri & kanan). */
const PAD_KARTU = 16;
/** Jarak isi kartu dari tepi atas & bawah kartunya. */
const PAD_ATAS_KARTU = 13;
const PAD_BAWAH_KARTU = 13;
/** Jarak antar kartu (di dalam unit jarak yang ikut dihitung saat halaman dibagi). */
const JARAK_KARTU = 12;
/** Jari-jari sudut kartu, petak angka, dan pita tabel. */
const RADIUS_KARTU = 8;
/** Lebar isi di dalam kartu (dipakai tabel & pembungkusan kalimat). */
const LEBAR_DALAM_KARTU = LAPORAN_PDF_LEBAR_KONTEN_PT - 2 * PAD_KARTU;
/** Sumbu X awal isi kartu. */
const X_KARTU = LAPORAN_PDF_MARGIN_PT + PAD_KARTU;

/** Ukuran huruf yang dipakai berkas ini, semua dalam poin. */
const HURUF = {
  judulBerkas: 19,
  meta: 8.4,
  catatan: 7.6,
  kicker: 6.8,
  judulKartu: 12.5,
  ketKartu: 8,
  tabelKepala: 7.4,
  tabelIsi: 8.2,
  petakLabel: 7.2,
  petakNilai: 13.5,
  petakKet: 6.8,
  daftar: 8.2,
  temuan: 8.2,
  baganJudul: 10,
  baganBawah: 6.2,
  angkaBatang: 6.2,
  kaki: 7.4,
  chip: 7,
} as const;

/* ============================================================== warna ===== */

/**
 * Warna berkas laporan yang **tidak** bergantung bagian: kertas, huruf, garis
 * pemisah, dan warna merek di kepala berkas.
 *
 * Warna yang menandai bagian laporan (pita tepi kartu, kotak ikon, label, kepala
 * kolom, baris selang-seling, baris jumlah, batang bagan) **tidak** ada di sini —
 * semuanya datang dari `./laporanWarna`, satu keluarga warna per bagian, yang juga
 * dipakai halaman Laporan dan berkas Excel.
 */
export const LAPORAN_PDF_WARNA = {
  /** Warna kertas & isi kartu. */
  kartu: "FFFFFF",
  /** Huruf judul (paling tua). */
  judulTeks: "0F172A",
  /** Huruf isi. */
  teks: "1E293B",
  /** Huruf keterangan. */
  teksLembut: "475569",
  /** Huruf paling pudar (label petak, kepala kolom tabel, kaki halaman). */
  teksPudar: "64748B",
  /** Garis pemisah tipis. */
  garis: "E2E8F0",
  /** Garis yang perlu terlihat (sumbu bagan, bingkai tabel). */
  garisKuat: "CBD5E1",
  /** Huruf putih di atas pita bernada tua. */
  putih: "FFFFFF",
  /** Warna merek di kepala berkas (sama dengan pil “Laporan” di halaman). */
  merek: "065F46",
  /** Warna tingkat kedua merek (hijau kebiruan) untuk gradasi pita kepala. */
  merek2: "115E59",
} as const;

/** Hex → operator warna PDF (`r g b`). */
function pdfWarna(hex: string): string {
  return laporanWarnaPdf(hex);
}

/** Keluarga warna satu bagian laporan (dari id bagiannya). */
export function laporanPdfNadaBagian(bagianId: string): LaporanWarnaNama {
  return laporanWarnaNamaBagian(bagianId);
}

/* =============================================================== teks ==== */

/**
 * Huruf yang tidak ada di set huruf standar PDF (WinAnsi) diterjemahkan lebih dulu
 * ke padanan ASCII-nya, supaya kalimat berbahasa Indonesia tetap terbaca (tanda
 * pisah panjang, tanda kutip melengkung, “≥”) alih-alih berubah jadi tanda tanya.
 */
const TRANSLITERASI: Record<string, string> = {
  "\u2014": "-",
  "\u2013": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u2026": "...",
  "\u00b7": "-",
  "\u2022": "-",
  "\u00a0": " ",
  "\u00d7": "x",
  "\u2265": ">=",
  "\u2264": "<=",
  "\u2192": "->",
  "\u00b1": "+/-",
};

/** Teks → bentuk yang bisa ditulis di PDF (Latin-1, kendali dibuang). */
export function laporanPdfText(text: string): string {
  let out = "";
  for (const char of text) {
    const mapped = TRANSLITERASI[char] ?? char;
    for (const piece of mapped) {
      const code = piece.codePointAt(0) ?? 63;
      if (code < 32) continue;
      out += code <= 255 ? piece : "?";
    }
  }
  return out;
}

/**
 * Lebar teks dalam poin, diukur dari **lebar huruf Helvetica yang sebenarnya**.
 *
 * Ini yang menggantikan hitungan lama “jumlah huruf × 0,6 em” yang hanya benar
 * untuk Courier. Tanpa ini, kolom angka rata kanan akan meleset beberapa poin dan
 * teks yang “muat” menurut hitungan justru terpotong di kertas.
 */
export function laporanPdfTextWidth(text: string, ukuran: number, tebal = false): number {
  const tabel = tebal ? LAPORAN_PDF_LEBAR_TEBAL : LAPORAN_PDF_LEBAR_BIASA;
  let total = 0;
  for (const huruf of laporanPdfText(text)) {
    const kode = huruf.charCodeAt(0);
    const indeks = kode - LAPORAN_PDF_LEBAR_KODE_AWAL;
    total += indeks >= 0 && indeks < tabel.length ? tabel[indeks] : LAPORAN_PDF_LEBAR_CADANGAN;
  }
  return (total / 1000) * ukuran;
}

/**
 * Memotong teks supaya muat di lebar tertentu (poin), dengan tanda “...” kalau
 * memang dipotong. Dipotong **per huruf** karena lebar hurufnya tidak seragam.
 */
export function laporanPdfCut(text: string, lebarPt: number, ukuran: number, tebal = false): string {
  const bersih = laporanPdfText(text);
  if (lebarPt <= 0) return "";
  if (laporanPdfTextWidth(bersih, ukuran, tebal) <= lebarPt) return bersih;
  const elipsis = "...";
  const lebarElipsis = laporanPdfTextWidth(elipsis, ukuran, tebal);
  let hasil = "";
  let lebar = 0;
  for (const huruf of bersih) {
    const tambah = laporanPdfTextWidth(huruf, ukuran, tebal);
    if (lebar + tambah + lebarElipsis > lebarPt) break;
    hasil += huruf;
    lebar += tambah;
  }
  return `${hasil.trimEnd()}${elipsis}`;
}

/**
 * Membungkus kalimat jadi beberapa baris selebar `lebarPt` (poin).
 *
 * Satu kata yang lebih panjang dari lebar kolomnya **tidak** dibiarkan meluber: kata
 * itu dipotong dengan “...”, karena teks yang menembus kolom sebelahnya jauh lebih
 * buruk daripada kata yang dipotong.
 */
export function laporanPdfWrap(text: string, lebarPt: number, ukuran: number, tebal = false): string[] {
  const kata = laporanPdfText(text)
    .split(/\s+/)
    .filter((bagian) => bagian !== "");
  if (kata.length === 0) return [];
  const baris: string[] = [];
  let sekarang = "";
  for (const bagian of kata) {
    const gabung = sekarang === "" ? bagian : `${sekarang} ${bagian}`;
    if (laporanPdfTextWidth(gabung, ukuran, tebal) <= lebarPt) {
      sekarang = gabung;
      continue;
    }
    if (sekarang !== "") baris.push(sekarang);
    sekarang = laporanPdfTextWidth(bagian, ukuran, tebal) <= lebarPt
      ? bagian
      : laporanPdfCut(bagian, lebarPt, ukuran, tebal);
  }
  if (sekarang !== "") baris.push(sekarang);
  return baris;
}

/* ======================================================= operasi gambar === */

/**
 * Satu operasi gambar di **ruang halaman PDF** (titik nol di kiri-bawah, Y ke atas).
 *
 * Bentuknya data, bukan panggilan gambar langsung: halaman bisa dirakit, diukur, dan
 * diperiksa (mis. “apakah ada huruf yang tertimpa pita?”, “apakah tulisan putih ini
 * benar-benar di atas nada tua?”) tanpa membongkar byte berkas PDF-nya.
 */
export type LaporanPdfOp =
  | {
      t: "kotak";
      x: number;
      y: number;
      w: number;
      h: number;
      radius?: number;
      /** Sudut mana yang dibulatkan; kosong = keempatnya. */
      sudut?: { kiriAtas?: boolean; kananAtas?: boolean; kiriBawah?: boolean; kananBawah?: boolean };
      /**
       * Tandai kotak ini sebagai **pita tepi** sebuah kotak bersudut bulat berjari-jari
       * `radius` yang sudutnya dipotong mengikuti lengkung kotaknya; `sudut` tidak
       * dipakai kalau ini diisi.
       */
      sisi?: "atas" | "kiri";
      /** Warna isian (hex); kosong = tidak diisi. */
      isi?: string;
      /** Warna garis tepi (hex); kosong = tanpa garis. */
      garis?: string;
      lebarGaris?: number;
      /** Kepekatan 0–1; kosong = pekat. */
      alfa?: number;
    }
  | {
      t: "teks";
      x: number;
      /** Posisi **dasar** huruf (baseline). */
      y: number;
      teks: string;
      ukuran: number;
      tebal?: boolean;
      warna: string;
      alfa?: number;
      rata?: "kiri" | "kanan" | "tengah";
      /** Lebar kotak untuk perataan kanan/tengah. */
      lebar?: number;
      /** Jarak antar huruf (pt) — dipakai label huruf besar yang dijarangkan. */
      tc?: number;
    }
  | {
      t: "poli";
      titik: Array<[number, number]>;
      isi?: string;
      garis?: string;
      lebarGaris?: number;
      alfa?: number;
    };

/** Op dengan Y diukur **ke bawah** dari tepi atas unit (dipakai saat menyusun unit). */
type OpLokal =
  | (Omit<Extract<LaporanPdfOp, { t: "kotak" }>, "y"> & { y: number })
  | (Omit<Extract<LaporanPdfOp, { t: "teks" }>, "y"> & { y: number })
  | (Omit<Extract<LaporanPdfOp, { t: "poli" }>, "titik"> & { titik: Array<[number, number]> });

/** Kepekatan yang punya namanya sendiri di daftar `ExtGState` halaman. */
const ALFA_DAFTAR = [0.06, 0.1, 0.13, 0.2, 0.25, 0.35, 0.55, 0.6, 0.7, 0.85, 0.9] as const;

/** Nama `ExtGState` untuk satu kepekatan (dibulatkan ke daftar di atas). */
export function laporanPdfNamaAlfa(alfa: number): string {
  let pilih: number = ALFA_DAFTAR[0];
  for (const kandidat of ALFA_DAFTAR) {
    if (Math.abs(kandidat - alfa) < Math.abs(pilih - alfa)) pilih = kandidat;
  }
  return `A${String(Math.round(pilih * 100)).padStart(2, "0")}`;
}

/** Berapa operasi `ExtGState` yang harus didaftarkan di setiap halaman. */
export const LAPORAN_PDF_ALFA_DAFTAR: readonly number[] = ALFA_DAFTAR;

/* ============================================================== tabel ==== */

/** Jarak teks sel dari tepi kiri/kanan kolomnya (poin). */
const PAD_SEL = 6;

/** Tinggi satu baris isi tabel & tinggi baris jumlahnya. */
const TINGGI_BARIS = 15.5;
const TINGGI_BARIS_JUMLAH = 17.5;

/** Jarak dasar huruf dari tepi atas baris (poin). */
const DASAR_DALAM_BARIS = 10.6;

/**
 * Lebar tiap kolom tabel (poin).
 *
 * Diukur dari lebar teks **yang sebenarnya** (huruf Helvetica): kolom angka jadi
 * selebar angkanya, bukan selebar tebakan. Kalau jumlahnya melebihi lebar yang
 * tersedia, kolom **terlebar** yang menyusut lebih dulu sampai muat — kolom angka
 * yang menyusut pun tetap terbaca karena angkanya paling banyak 12 huruf.
 */
export function laporanPdfKolumTabel(
  headers: string[],
  rows: string[][],
  numeric: boolean[],
  total: string[] | null,
  lebarMaks: number,
): number[] {
  const semua = total ? [...rows, total] : rows;
  /** Lebar yang dibutuhkan angka satu kolom: batas bawah penyusutan kolom angka. */
  const lebarNilai: number[] = [];
  /** Lebar yang dibutuhkan **kata terpanjang di kepala kolomnya**. */
  const lebarKepala: number[] = [];
  const lebar: number[] = headers.map((header, index) => {
    const sel = semua.map((row) => row[index] ?? "");
    const terlebar = Math.max(
      0,
      ...sel.map((teks) => laporanPdfTextWidth(teks, HURUF.tabelIsi, false)),
    );
    lebarNilai.push(terlebar + 2 * PAD_SEL);
    // Kepala kolom boleh turun ke baris kedua, jadi lebarnya ditentukan kata
    // terpanjangnya, bukan seluruh judulnya — dan diukur dari bentuk **huruf besar**
    // yang benar-benar dicetak (`METODE`, bukan `Metode`), sebab huruf besar lebih
    // lebar. Mengukurnya dari judul apa adanya membuat kata yang tercetak terpotong
    // jadi “TRANSAKSI…”, dan kolom angkanya kehilangan namanya.
    const kataKepala = Math.max(
      0,
      ...laporanPdfText(header.toUpperCase())
        .split(/\s+/)
        .filter((bagian) => bagian !== "")
        .map((bagian) => laporanPdfTextWidth(bagian, HURUF.tabelKepala, true)),
    );
    lebarKepala.push(kataKepala + 2 * PAD_SEL + 2);
    return Math.max(terlebar, kataKepala) + 2 * PAD_SEL + 2;
  });

  const jumlah = () => lebar.reduce((total2, nilai) => total2 + nilai, 0);
  /**
   * Batas bawah penyusutan satu kolom.
   *
   * Kolom teks boleh menyusut sampai 30 pt dan kolom angka berhenti di lebar angkanya —
   * tetapi tidak ada kolom yang menyusut **di bawah kata terpanjang di kepala kolomnya**:
   * kepala kolom yang terpotong jadi “TRANSAKSI…” membuat kolom angkanya tak bernama,
   * dan itu lebih buruk daripada tabel yang sedikit lebih lebar (kepala kolomnya memang
   * dirancang boleh turun ke baris kedua). Kalau seluruh batas bawah itu ternyata tidak
   * muat di lebar yang tersedia, barulah batasnya diturunkan lagi — lebih baik judulnya
   * terpotong daripada tabelnya keluar dari kartunya.
   */
  const minimalDasar = (index: number) => (numeric[index] ? lebarNilai[index] : 30);
  const batasKepala = (index: number) => Math.max(minimalDasar(index), lebarKepala[index]);
  const muat = lebar.reduce((total2, _nilai, index) => total2 + batasKepala(index), 0) <= lebarMaks;
  const minimal = (index: number) => (muat ? batasKepala(index) : minimalDasar(index));
  while (jumlah() > lebarMaks) {
    let terlebar = -1;
    for (let index = 0; index < lebar.length; index += 1) {
      if (lebar[index] <= minimal(index)) continue;
      if (terlebar < 0 || lebar[index] > lebar[terlebar]) terlebar = index;
    }
    if (terlebar < 0) break;
    lebar[terlebar] -= 2;
  }
  return lebar;
}

/** Posisi X tepi kiri tiap kolom, dari lebar kolomnya. */
function kolomX(lebar: number[], x0: number): number[] {
  const x: number[] = [];
  let posisi = x0;
  for (const nilai of lebar) {
    x.push(posisi);
    posisi += nilai;
  }
  return x;
}

/* =============================================================== unit ==== */

/**
 * Satu bagian halaman yang tidak boleh terbelah — mis. satu baris tabel, satu petak
 * angka, satu gambar bagan, atau kepala kartu.
 *
 * Tingginya dihitung **sebelum** halaman dibagi, jadi letaknya tidak pernah dihitung
 * ulang saat menggambar: yang menentukan letak hanyalah tinggi unit-unit sebelumnya.
 * Karena itu berkasnya deterministik dan bisa diperiksa tanpa pembaca PDF.
 */
export interface LaporanPdfUnit {
  /** Peran unit — dipakai pemeriksaan (halaman, warna, dan kelengkapan). */
  peran: string;
  /** Id bagian laporan pemilik unit ini (kalau ada). */
  bagian?: string;
  /** Keluarga warna bagiannya. */
  nada?: LaporanWarnaNama;
  /** Tinggi unit dalam poin. */
  tinggi: number;
  /** Teks yang ditulis unit ini, urut menggambar (untuk pemeriksaan & pratinjau). */
  teks: string[];
  /** Id kartu pemilik unit ini — dipakai menggambar rangka kartunya. */
  kartu?: string;
  /** Unit yang isinya cuma jarak: boleh dibuang kalau jatuh di awal halaman. */
  spasi?: boolean;
  gambar(atas: number): LaporanPdfOp[];
}

/** Papan tulis kecil untuk menyusun satu unit: kursor Y ke bawah dari tepi atas. */
interface Papan {
  ops: OpLokal[];
  y: number;
  teks: string[];
}

function papan(): Papan {
  return { ops: [], y: 0, teks: [] };
}

/**
 * Kursor papan **maju sendiri** setiap kali ada isi yang digambar, jadi tinggi unit
 * tidak pernah lebih pendek dari isinya: `unitDari` memakai kursor itu sebagai tinggi.
 * Dulu tingginya ditulis satu per satu secara manual, dan yang terlupa membuat kartu
 * berikutnya naik menimpa isi kartu sebelumnya — kesalahan yang tidak terlihat di
 * daftar teks, tetapi jelas di berkasnya.
 */
function kotak(p: Papan, op: Omit<Extract<OpLokal, { t: "kotak" }>, "t">): void {
  p.ops.push({ ...op, t: "kotak" });
  p.y = Math.max(p.y, op.y + op.h);
}

function tulis(
  p: Papan,
  op: Omit<Extract<OpLokal, { t: "teks" }>, "t" | "teks"> & { teks: string },
): void {
  if (op.teks === "") return;
  p.ops.push({ ...op, t: "teks" });
  p.teks.push(op.teks);
  // Ditambah sedikit untuk ekor huruf (g, y, p) yang menggantung di bawah garis dasarnya.
  p.y = Math.max(p.y, op.y + op.ukuran * 0.25);
}

function poli(p: Papan, op: Omit<Extract<OpLokal, { t: "poli" }>, "t">): void {
  p.ops.push({ ...op, t: "poli" });
}

/** Op lokal (Y ke bawah) → op halaman (Y ke atas). */
function keHalaman(op: OpLokal, atas: number): LaporanPdfOp {
  if (op.t === "teks") return { ...op, y: atas - op.y };
  if (op.t === "poli") {
    return { ...op, titik: op.titik.map(([x, y]) => [x, atas - y] as [number, number]) };
  }
  return { ...op, y: atas - op.y - op.h };
}

/** Unit dari papan: tinggi = kursor + jarak bawah yang diminta. */
function unitDari(
  p: Papan,
  meta: Omit<LaporanPdfUnit, "gambar" | "teks" | "tinggi">,
  padBawah = 0,
): LaporanPdfUnit {
  const ops = p.ops;
  return {
    ...meta,
    tinggi: p.y + padBawah,
    teks: p.teks,
    gambar: (atas: number) => ops.map((op) => keHalaman(op, atas)),
  };
}

/** Unit jarak: ikut dihitung saat halaman dibagi, tapi tidak menggambar apa pun. */
function unitJarak(tinggi: number): LaporanPdfUnit {
  return { peran: "spasi", tinggi, teks: [], spasi: true, gambar: () => [] };
}

/* --------------------------------------------------------------- ikon ---- */

/** Jenis gambar kecil di kotak ikon kepala kartu. */
type IkonJenis = "kilau" | "kartu" | "pilar" | "batang" | "simpul" | "garis" | "tanda";

/** Ikon yang paling mendekati isi satu bagian laporan. */
function ikonBagian(bagianId: string): IkonJenis {
  if (bagianId.startsWith("metode")) return "kartu";
  if (bagianId.startsWith("pajak")) return "pilar";
  if (bagianId.startsWith("analitik-temuan")) return "tanda";
  if (bagianId.startsWith("analitik") || bagianId.startsWith("grafik")) return "garis";
  if (bagianId.startsWith("franchise")) return "simpul";
  if (bagianId.startsWith("ringkasan")) return "batang";
  return "kilau";
}

/** Menggambar satu ikon di dalam kotak `ukuran` × `ukuran` (kiri-atas di x, y). */
function gambarIkon(p: Papan, x: number, y: number, ukuran: number, jenis: IkonJenis, warna: string): void {
  const s = ukuran;
  const cx = x + s / 2;
  const cy = y + s / 2;
  switch (jenis) {
    case "kilau":
      poli(p, {
        titik: [
          [cx, y + s * 0.08],
          [cx + s * 0.3, cy],
          [cx, y + s * 0.92],
          [cx - s * 0.3, cy],
        ],
        isi: warna,
      });
      break;
    case "kartu":
      kotak(p, { x: x + s * 0.1, y: y + s * 0.16, w: s * 0.8, h: s * 0.6, radius: 1.6, garis: warna, lebarGaris: 0.9 });
      kotak(p, { x: x + s * 0.24, y: cy, w: s * 0.52, h: 1.1, isi: warna });
      break;
    case "pilar":
      poli(p, {
        titik: [
          [x + s * 0.06, y + s * 0.58],
          [cx, y + s * 0.14],
          [x + s * 0.94, y + s * 0.58],
        ],
        isi: warna,
      });
      for (const geser of [0.2, 0.46, 0.72]) {
        kotak(p, { x: x + s * geser, y: y + s * 0.62, w: s * 0.12, h: s * 0.26, isi: warna });
      }
      break;
    case "batang":
      for (const [geser, tinggi] of [
        [0.14, 0.4],
        [0.42, 0.62],
        [0.7, 0.82],
      ] as const) {
        kotak(p, { x: x + s * geser, y: y + s * (1 - tinggi) - s * 0.08, w: s * 0.16, h: s * tinggi, radius: 1, isi: warna });
      }
      break;
    case "simpul":
      kotak(p, { x: x + s * 0.08, y: cy - s * 0.3, w: s * 0.26, h: s * 0.26, radius: 1.5, isi: warna });
      kotak(p, { x: x + s * 0.66, y: cy - s * 0.02, w: s * 0.26, h: s * 0.26, radius: 1.5, isi: warna });
      kotak(p, { x: x + s * 0.3, y: cy - s * 0.13, w: s * 0.4, h: 1.1, isi: warna });
      break;
    case "garis":
      poli(p, {
        titik: [
          [x + s * 0.12, y + s * 0.78],
          [cx, y + s * 0.44],
          [x + s * 0.88, y + s * 0.84],
        ],
        garis: warna,
        lebarGaris: 1.1,
      });
      for (const [px, py] of [
        [0.12, 0.78],
        [0.5, 0.44],
        [0.88, 0.84],
      ] as const) {
        kotak(p, { x: x + s * px - 1.1, y: y + s * py - 1.1, w: 2.2, h: 2.2, radius: 1.1, isi: warna });
      }
      break;
    case "tanda":
      poli(p, {
        titik: [
          [x + s * 0.12, y + s * 0.26],
          [cx, y + s * 0.72],
          [x + s * 0.88, y + s * 0.26],
        ],
        garis: warna,
        lebarGaris: 1.1,
      });
      kotak(p, { x: x + s * 0.34, y: y + s * 0.14, w: s * 0.32, h: s * 0.32, radius: 1.6, isi: warna });
      break;
  }
}

/* ------------------------------------------------------------ kepala ----- */

/** Label kecil di atas judul kartu, mengikuti kalimat yang dipakai halaman. */
export function laporanPdfKickerBagian(bagianId: string): string {
  // Sama dengan label kartu di halaman: bagian “ringkasan” dokumen ini adalah kartu
  // “Angka utama” di halaman, sedangkan “Tanpa istilah pembukuan” milik kartu Ringkasan
  // singkat — kartu itu memberi kickernya sendiri supaya keduanya tidak tertukar.
  if (bagianId === "ringkasan") return "Angka utama periode ini";
  if (bagianId.startsWith("metode")) return "Dari mana uangnya masuk";
  if (bagianId.startsWith("pajak")) return "Setelan pajak workspace";
  if (bagianId === "analitik-temuan") return "Perlu dibaca";
  if (bagianId.startsWith("analitik")) return "Analitik lanjutan";
  if (bagianId.startsWith("franchise")) return "Lintas cabang";
  return "Laporan";
}

/** Judul pendek satu bagian untuk daftar isi. */
export function laporanPdfLabelBagian(bagian: LaporanSection): string {
  return bagian.title;
}

/* --------------------------------------------------------------- chip ---- */

interface LebarChip {
  teks: number;
  chip: number;
}

function ukurChip(teks: string): LebarChip {
  const lebar = laporanPdfTextWidth(teks, HURUF.chip, false);
  return { teks: lebar, chip: lebar + 16 };
}

/** Chip kecil (mis. tanggal & jumlah bagian) di kepala berkas. */
function gambarChip(p: Papan, x: number, y: number, teks: string, nada: LaporanWarnaNama): number {
  const { teks: lebarTeks, chip } = ukurChip(teks);
  const tinggi = 15;
  kotak(p, {
    x,
    y,
    w: chip,
    h: tinggi,
    radius: tinggi / 2,
    isi: LAPORAN_WARNA[nada].selang,
    alfa: 0.85,
    garis: LAPORAN_WARNA[nada].selang,
    lebarGaris: 0.6,
  });
  tulis(p, {
    x: x + 8,
    y: y + 10.2,
    teks,
    ukuran: HURUF.chip,
    warna: LAPORAN_WARNA[nada].bagian,
    rata: "kiri",
    lebar: lebarTeks,
  });
  return chip;
}

/* --------------------------------------------------- kepala berkas ------- */

/**
 * Kartu kepala berkas (halaman pertama): pil “Laporan” seperti di halaman, chip
 * tanggal & jumlah bagian, judul besar, ruang kerja/toko/periode, lalu catatan
 * jujur tentang apa yang ikut dan apa yang tidak.
 */
export function laporanPdfKepalaUnit(
  document: LaporanDocument,
  tanggal: string,
  jumlahBagian: number,
): LaporanPdfUnit {
  const p = papan();
  const x = LAPORAN_PDF_MARGIN_PT;
  const w = LAPORAN_PDF_LEBAR_KONTEN_PT;

  // Pita merek di tepi atas kartu (sama seperti pita tepi kartu di halaman).
  kotak(p, {
    x,
    y: 0,
    w,
    h: 5,
    radius: RADIUS_KARTU,
    sisi: "atas",
    isi: LAPORAN_PDF_WARNA.merek,
  });
  kotak(p, {
    x: x + w * 0.62,
    y: 0,
    w: w * 0.38,
    h: 5,
    radius: RADIUS_KARTU,
    sisi: "atas",
    isi: LAPORAN_PDF_WARNA.merek2,
    alfa: 0.55,
  });

  let y = 5 + 18;

  // Pil “LAPORAN” + chip pendamping.
  const lebarPil = 78;
  kotak(p, { x: x + PAD_KARTU, y, w: lebarPil, h: 16, radius: 8, isi: LAPORAN_PDF_WARNA.merek });
  gambarIkon(p, x + PAD_KARTU + 7, y + 3.4, 9, "batang", LAPORAN_PDF_WARNA.putih);
  tulis(p, {
    x: x + PAD_KARTU + 21,
    y: y + 11,
    teks: "LAPORAN",
    ukuran: HURUF.kicker,
    tebal: true,
    warna: LAPORAN_PDF_WARNA.putih,
    tc: 0.7,
  });

  let xChip = x + PAD_KARTU + lebarPil + 7;
  xChip += gambarChip(p, xChip, y, tanggal, "emerald") + 6;
  xChip += gambarChip(p, xChip, y, `${jumlahBagian} bagian`, "sky") + 6;
  gambarChip(p, xChip, y, document.period, "indigo");

  // Judul berkas.
  y += 16 + 22;
  tulis(p, {
    x: x + PAD_KARTU,
    y,
    teks: document.title,
    ukuran: HURUF.judulBerkas,
    tebal: true,
    warna: LAPORAN_PDF_WARNA.judulTeks,
  });

  // Ruang kerja, toko, dan periode — sama dengan daftar di kepala halaman.
  y += 15;
  const meta = [
    `Workspace ${document.workspace}`,
    `Toko ${document.store}`,
    `Periode ${document.period}`,
  ].join("   ·   ");
  tulis(p, {
    x: x + PAD_KARTU,
    y,
    teks: laporanPdfCut(meta, LEBAR_DALAM_KARTU, HURUF.meta, false),
    ukuran: HURUF.meta,
    warna: LAPORAN_PDF_WARNA.teksLembut,
  });

  y += 12;

  // Catatan berkas (sumber angka, bagian yang tidak disertakan): ditulis apa adanya.
  for (const catatan of document.notes) {
    const baris = laporanPdfWrap(catatan, LEBAR_DALAM_KARTU - 12, HURUF.catatan, false);
    kotak(p, {
      x: x + PAD_KARTU + 1,
      y: y - 5.2,
      w: 4,
      h: 4,
      radius: 1,
      isi: LAPORAN_PDF_WARNA.merek,
      alfa: 0.7,
    });
    baris.forEach((teks, index) => {
      tulis(p, {
        x: x + PAD_KARTU + 12,
        y: y - (index === 0 ? 0 : index * 9.6),
        teks,
        ukuran: HURUF.catatan,
        warna: LAPORAN_PDF_WARNA.teksPudar,
      });
    });
    y += Math.max(1, baris.length) * 9.6 + 2;
  }

  return unitDari(p, { peran: "kepala" }, PAD_BAWAH_KARTU);
}

/** Kepala ringkas untuk halaman lanjutan (judul berkas + periode). */
export function laporanPdfKepalaLanjutanUnit(document: LaporanDocument, page: number): LaporanPdfUnit {
  const p = papan();
  const x = LAPORAN_PDF_MARGIN_PT;
  const w = LAPORAN_PDF_LEBAR_KONTEN_PT;

  kotak(p, {
    x,
    y: 0,
    w,
    h: 4,
    radius: RADIUS_KARTU,
    sisi: "atas",
    isi: LAPORAN_PDF_WARNA.merek,
  });
  tulis(p, {
    x: x + PAD_KARTU,
    y: 4 + 16,
    teks: `${document.title} (lanjutan)`,
    ukuran: 10.5,
    tebal: true,
    warna: LAPORAN_PDF_WARNA.judulTeks,
  });
  tulis(p, {
    x: x + PAD_KARTU,
    y: 4 + 27,
    teks: `${document.store}   ·   Periode ${document.period}   ·   halaman ${page}`,
    ukuran: 7.6,
    warna: LAPORAN_PDF_WARNA.teksPudar,
  });
  p.y = 4 + 34;
  return unitDari(p, { peran: "kepalaLanjutan" }, PAD_BAWAH_KARTU);
}

/* ------------------------------------------------------------ daftar ----- */

/** Satu baris daftar isi: nomor, judul, warna bagian, dan halaman berapa. */
export interface LaporanIsiBaris {
  nomor: number;
  label: string;
  nada: LaporanWarnaNama;
  halaman: number;
}

/** Kepala kartu (ikon + label + judul + keterangan) — kerangka `SectionCard`. */
export function laporanPdfKartuJudulUnit(
  bagianId: string,
  nomor: number,
  judul: string,
  keterangan: string | undefined,
  nada: LaporanWarnaNama,
  options: { lanjutan?: boolean; kickerLain?: string } = {},
): LaporanPdfUnit {
  const p = papan();
  const x = LAPORAN_PDF_MARGIN_PT;
  const warna = LAPORAN_WARNA[nada];

  let y = PAD_ATAS_KARTU;
  kotak(p, { x: x + PAD_KARTU, y, w: 22, h: 22, radius: 6, isi: warna.selang, alfa: 0.9, garis: warna.selang, lebarGaris: 0.6 });
  gambarIkon(p, x + PAD_KARTU + 5, y + 5, 12, ikonBagian(bagianId), warna.bagian);

  const kicker = options.kickerLain ?? `BAGIAN ${nomor} · ${laporanPdfKickerBagian(bagianId)}`;
  tulis(p, {
    x: x + PAD_KARTU + 22 + 9,
    y: y + 8.4,
    teks: kicker.toUpperCase(),
    ukuran: HURUF.kicker,
    tebal: true,
    warna: warna.bagian,
    tc: 0.5,
  });
  tulis(p, {
    x: x + PAD_KARTU + 22 + 9,
    y: y + 20.4,
    teks: laporanPdfCut(judul, LEBAR_DALAM_KARTU - 31, HURUF.judulKartu, true),
    ukuran: HURUF.judulKartu,
    tebal: true,
    warna: LAPORAN_PDF_WARNA.judulTeks,
  });
  /*
    Batas bawah yang aman untuk baris berikutnya dihitung dari **ukuran huruf judulnya**,
    bukan dari tinggi kotak ikonnya. Judul 12,5 pt turun ±3 pt di bawah garis dasarnya,
    sedangkan kotak ikonnya hanya setinggi 22 pt — dulu kursornya cuma dimajukan setinggi
    ikon, jadi baris “(bersambung dari halaman sebelumnya)” yang digambar setelahnya
    menimpa judulnya (terbaca seperti judul yang dicoret).
  */
  y = Math.max(y + 22, y + 20.4 + HURUF.judulKartu * 0.25 + 4);

  if (options.lanjutan) {
    tulis(p, {
      x: x + PAD_KARTU + 22 + 9,
      y: y + 4,
      teks: "(bersambung dari halaman sebelumnya)",
      ukuran: 7.2,
      warna: LAPORAN_PDF_WARNA.teksPudar,
    });
    y += 16;
  }

  if (keterangan) {
    y += 11;
    for (const baris of laporanPdfWrap(keterangan, LEBAR_DALAM_KARTU, HURUF.ketKartu, false)) {
      tulis(p, { x: x + PAD_KARTU, y, teks: baris, ukuran: HURUF.ketKartu, warna: LAPORAN_PDF_WARNA.teksLembut });
      y += 10;
    }
  }

  y += 3;
  kotak(p, { x: x + PAD_KARTU, y, w: LEBAR_DALAM_KARTU, h: 0.7, isi: LAPORAN_PDF_WARNA.garisKuat, alfa: 0.6 });
  p.y = y + 9;
  return unitDari(p, { peran: "kartuJudul", bagian: bagianId, nada }, 0);
}

/** Isi kartu “Daftar isi”: semua bagian berkas beserta halamannya. */
export function laporanPdfDaftarIsiUnit(baris: LaporanIsiBaris[]): LaporanPdfUnit[] {
  const p = papan();
  const x = LAPORAN_PDF_MARGIN_PT;
  baris.forEach((item, index) => {
    const warna = LAPORAN_WARNA[item.nada];
    const y = index * 15.4;
    if (index % 2 === 1) {
      kotak(p, { x: x + PAD_KARTU - 4, y: y - 1.4, w: LEBAR_DALAM_KARTU + 8, h: 15, radius: 4, isi: warna.selang, alfa: 0.45 });
    }
    kotak(p, { x: x + PAD_KARTU + 1, y: y + 4.2, w: 8, h: 8, radius: 4, isi: warna.garis });
    tulis(p, {
      x: x + PAD_KARTU + 15,
      y: y + 10.6,
      teks: `${item.nomor}.`,
      ukuran: HURUF.daftar,
      tebal: true,
      warna: warna.bagian,
    });
    tulis(p, {
      x: x + PAD_KARTU + 32,
      y: y + 10.6,
      teks: laporanPdfCut(item.label, LEBAR_DALAM_KARTU - 110, HURUF.daftar, false),
      ukuran: HURUF.daftar,
      warna: LAPORAN_PDF_WARNA.teks,
    });
    tulis(p, {
      x: x + PAD_KARTU,
      y: y + 10.6,
      teks: `Hal. ${item.halaman}`,
      ukuran: HURUF.daftar,
      warna: LAPORAN_PDF_WARNA.teksPudar,
      rata: "kanan",
      lebar: LEBAR_DALAM_KARTU,
    });
  });
  p.y = baris.length * 15.4;
  return [unitDari(p, { peran: "daftarIsi", nada: "netral" }, 0), unitJarak(PAD_BAWAH_KARTU + JARAK_KARTU)];
}

/* ------------------------------------------------------------ petak ------ */

/**
 * Petak angka seperti `StatTile` di halaman: pita warna di tepi atas, label kecil,
 * angka besar, dan keterangan — **bukan** tabel dua kolom. Bentuk ini yang dibaca
 * orang lebih dulu di halaman, jadi bentuk yang sama dipakai di berkasnya.
 */
export function laporanPdfPetakUnits(rows: LaporanRow[], nada: LaporanWarnaNama, kolom = 2): LaporanPdfUnit[] {
  const warna = LAPORAN_WARNA[nada];
  const jarak = 10;
  const lebar = (LEBAR_DALAM_KARTU - jarak * (kolom - 1)) / kolom;
  const tinggi = 50;
  const units: LaporanPdfUnit[] = [];

  for (let start = 0; start < rows.length; start += kolom) {
    const p = papan();
    rows.slice(start, start + kolom).forEach((row, index) => {
      const x = X_KARTU + index * (lebar + jarak);
      kotak(p, { x, y: 0, w: lebar, h: tinggi, radius: 7, isi: warna.selang, alfa: 0.7, garis: warna.selang, lebarGaris: 0.7 });
      kotak(p, { x, y: 0, w: lebar, h: 2.6, radius: 7, sisi: "atas", isi: warna.garis });
      tulis(p, {
        x: x + 11,
        y: 16,
        teks: laporanPdfCut(cellDisplay(row.cells[0]), lebar - 22, HURUF.petakLabel, false),
        ukuran: HURUF.petakLabel,
        warna: LAPORAN_PDF_WARNA.teksPudar,
      });
      tulis(p, {
        x: x + 11,
        y: 33,
        teks: laporanPdfCut(cellDisplay(row.cells[1] ?? row.cells[0]), lebar - 22, HURUF.petakNilai, true),
        ukuran: HURUF.petakNilai,
        tebal: true,
        warna: LAPORAN_PDF_WARNA.judulTeks,
      });
      const ket = row.cells[2] ? cellDisplay(row.cells[2]) : "";
      if (ket !== "") {
        tulis(p, {
          x: x + 11,
          y: 44,
          teks: laporanPdfCut(ket, lebar - 22, HURUF.petakKet, false),
          ukuran: HURUF.petakKet,
          warna: LAPORAN_PDF_WARNA.teksPudar,
        });
      }
    });
    p.y = tinggi;
    units.push(unitDari(p, { peran: "petak", nada }, start + kolom < rows.length ? jarak : 0));
  }
  return units;
}

/* ------------------------------------------------------------ tabel ------ */

/**
 * Satu tabel: kepala kolom berpita nada tua, baris isi berselang-seling, dan baris
 * jumlah berpita aksen dengan garis tebal di atasnya — sama seperti tabel di halaman.
 *
 * Kepala kolomnya **unit tersendiri** supaya bisa diulang saat tabelnya menyambung ke
 * halaman berikutnya; barisnya satu unit per baris supaya tabel panjang tidak
 * melompati satu halaman.
 */
export function laporanPdfTabelUnits(
  headers: string[],
  rows: string[][],
  numeric: boolean[],
  total: string[] | null,
  nada: LaporanWarnaNama,
): { kepala: LaporanPdfUnit; baris: LaporanPdfUnit[]; jumlah: LaporanPdfUnit[]; akhir: LaporanPdfUnit } {
  const warna = LAPORAN_WARNA[nada];
  const lebar = laporanPdfKolumTabel(headers, rows, numeric, total, LEBAR_DALAM_KARTU);
  const totalLebar = lebar.reduce((jumlah2, nilai) => jumlah2 + nilai, 0);
  const xs = kolomX(lebar, X_KARTU);

  // Kepala kolom: huruf besar putih di atas pita nada tua bagiannya. Judul panjang
  // turun ke baris kedua, ketiga, sebanyak yang dibutuhkan — tingginya pitanya ikut
  // naik, dan tidak ada judul yang dipotong cuma supaya tingginya tetap dua baris:
  // kolom angka tanpa nama lebih buruk daripada kepala kolom yang tinggi.
  const kepalaBaris: string[][] = headers.map((header, index) => {
    const murni = laporanPdfText(header.toUpperCase());
    const kata = murni.split(/\s+/).filter((bagian) => bagian !== "");
    const dalamKolom = lebar[index] - 2 * PAD_SEL;
    const hasil: string[] = [];
    let sekarang = "";
    for (const bagian of kata) {
      const gabung = sekarang === "" ? bagian : `${sekarang} ${bagian}`;
      if (laporanPdfTextWidth(gabung, HURUF.tabelKepala, true) + 2 <= dalamKolom) {
        sekarang = gabung;
      } else {
        if (sekarang !== "") hasil.push(sekarang);
        sekarang = bagian;
      }
    }
    if (sekarang !== "") hasil.push(sekarang);
    // Jaring pengaman terakhir: satu kata yang tetap lebih lebar dari kolomnya dipotong
    // (lebarnya sendiri sudah dijaga muat oleh `laporanPdfKolumTabel`).
    return (hasil.length > 0 ? hasil : [""]).map((teks) =>
      laporanPdfCut(teks, dalamKolom, HURUF.tabelKepala, true),
    );
  });
  const tinggiKepala = 8 + Math.max(1, ...kepalaBaris.map((baris) => baris.length)) * 9 + 7;

  const pKepala = papan();
  kotak(pKepala, {
    x: X_KARTU,
    y: 0,
    w: totalLebar,
    h: tinggiKepala,
    radius: 7,
    sudut: { kiriBawah: false, kananBawah: false },
    isi: warna.kepala,
  });
  kepalaBaris.forEach((baris, index) => {
    baris.forEach((teks, nomorBaris) => {
      const lebarTeks = laporanPdfTextWidth(teks, HURUF.tabelKepala, true);
      tulis(pKepala, {
        x: rataX(xs[index], lebar[index], lebarTeks, numeric[index] ? "kanan" : "kiri"),
        y: 11 + nomorBaris * 9,
        teks,
        ukuran: HURUF.tabelKepala,
        tebal: true,
        warna: LAPORAN_PDF_WARNA.putih,
        tc: 0.35,
      });
    });
  });
  pKepala.y = tinggiKepala;
  const kepala = unitDari(pKepala, { peran: "tabelKepala", nada }, 0);

  // Baris isi: pita tipis berselang-seling, angkanya rata kanan.
  const barisUnits = rows.map((row, index) => {
    const p = papan();
    if (index % 2 === 1) {
      kotak(p, { x: X_KARTU, y: 0, w: totalLebar, h: TINGGI_BARIS, isi: warna.selang, alfa: 0.6 });
    }
    row.forEach((nilai, kolom) => {
      const teks = laporanPdfCut(nilai, lebar[kolom] - 2 * PAD_SEL, HURUF.tabelIsi, false);
      tulis(p, {
        x: rataX(xs[kolom], lebar[kolom], laporanPdfTextWidth(teks, HURUF.tabelIsi, false), numeric[kolom] ? "kanan" : "kiri"),
        y: DASAR_DALAM_BARIS,
        teks,
        ukuran: HURUF.tabelIsi,
        warna: LAPORAN_PDF_WARNA.teks,
      });
    });
    p.y = TINGGI_BARIS;
    return unitDari(p, { peran: "tabelBaris", nada }, 0);
  });

  // Baris jumlah: pita aksen + garis tebal 1,4 pt di tepi atasnya.
  const jumlahUnits: LaporanPdfUnit[] = [];
  if (total) {
    const p = papan();
    kotak(p, {
      x: X_KARTU,
      y: 0,
      w: totalLebar,
      h: TINGGI_BARIS_JUMLAH,
      radius: 7,
      sudut: { kiriAtas: false, kananAtas: false },
      isi: warna.jumlah,
    });
    kotak(p, { x: X_KARTU, y: 0, w: totalLebar, h: 1.4, isi: warna.garis });
    total.forEach((sel, kolom) => {
      const teks = laporanPdfCut(sel, lebar[kolom] - 2 * PAD_SEL, HURUF.tabelIsi, true);
      tulis(p, {
        x: rataX(xs[kolom], lebar[kolom], laporanPdfTextWidth(teks, HURUF.tabelIsi, true), numeric[kolom] ? "kanan" : "kiri"),
        y: DASAR_DALAM_BARIS + 1.2,
        teks,
        ukuran: HURUF.tabelIsi,
        tebal: true,
        warna: LAPORAN_PDF_WARNA.judulTeks,
      });
    });
    p.y = TINGGI_BARIS_JUMLAH;
    jumlahUnits.push(unitDari(p, { peran: "tabelJumlah", nada }, 0));
  }

  return { kepala, baris: barisUnits, jumlah: jumlahUnits, akhir: unitJarak(PAD_BAWAH_KARTU + JARAK_KARTU) };
}

/** Posisi X teks di dalam kolom menurut perataannya. */
function rataX(xKolom: number, lebarKolom: number, lebarTeks: number, rata: "kiri" | "kanan"): number {
  return rata === "kanan" ? xKolom + lebarKolom - PAD_SEL - lebarTeks : xKolom + PAD_SEL;
}

/* ------------------------------------------------- catatan & daftar ------ */

/** Kotak catatan (bagian yang isinya cuma satu keterangan, bukan tabel). */
export function laporanPdfCatatanUnits(teks: string, nada: LaporanWarnaNama): LaporanPdfUnit[] {
  const p = papan();
  const warna = LAPORAN_WARNA[nada];
  const baris = laporanPdfWrap(teks, LEBAR_DALAM_KARTU - 24, HURUF.daftar, false);
  const tinggi = 14 + baris.length * 11;
  kotak(p, { x: X_KARTU, y: 0, w: LEBAR_DALAM_KARTU, h: tinggi, radius: 7, isi: warna.selang, alfa: 0.55, garis: warna.selang, lebarGaris: 0.7 });
  kotak(p, { x: X_KARTU, y: 0, w: 3, h: tinggi, radius: 7, sisi: "kiri", isi: warna.garis });
  baris.forEach((teksBaris, index) => {
    tulis(p, {
      x: X_KARTU + 14,
      y: 17 + index * 11,
      teks: teksBaris,
      ukuran: HURUF.daftar,
      warna: LAPORAN_PDF_WARNA.teks,
    });
  });
  p.y = tinggi;
  return [unitDari(p, { peran: "catatan", nada }, 0), unitJarak(PAD_BAWAH_KARTU + JARAK_KARTU)];
}

/**
 * Daftar bernomor di dalam kotak bernada (dipakai “Ringkasan singkat”).
 *
 * Dua kolom seperti di halaman: kalimatnya panjang, jadi satu kolom penuh akan
 * membuat kartunya tinggi tanpa alasan. Nomornya diberi lencana bulat bernada.
 */
export function laporanPdfDaftarUnits(baris: string[], nada: LaporanWarnaNama, kolom = 2): LaporanPdfUnit[] {
  const warna = LAPORAN_WARNA[nada];
  const jarak = 10;
  const lebar = (LEBAR_DALAM_KARTU - jarak * (kolom - 1)) / kolom;
  const units: LaporanPdfUnit[] = [];

  for (let start = 0; start < baris.length; start += kolom) {
    const p = papan();
    const isi = baris.slice(start, start + kolom);
    const tinggiSel = isi.map((teks) => {
      const dibungkus = laporanPdfWrap(teks, lebar - 34, HURUF.daftar, false);
      return { dibungkus, tinggi: 10 + dibungkus.length * 11 };
    });
    const tinggi = Math.max(...tinggiSel.map((sel) => sel.tinggi));
    isi.forEach((_teks, index) => {
      const x = X_KARTU + index * (lebar + jarak);
      kotak(p, { x, y: 0, w: lebar, h: tinggi, radius: 7, isi: warna.selang, alfa: 0.5, garis: warna.selang, lebarGaris: 0.7 });
      kotak(p, { x: x + 8, y: 7, w: 12, h: 12, radius: 6, isi: warna.jumlah });
      const nomor = String(start + index + 1);
      tulis(p, {
        x: x + 14 - laporanPdfTextWidth(nomor, 6.4, true) / 2,
        y: 15.6,
        teks: nomor,
        ukuran: 6.4,
        tebal: true,
        warna: warna.bagian,
      });
      tinggiSel[index].dibungkus.forEach((barisTeks, nomorBaris) => {
        tulis(p, {
          x: x + 26,
          y: 15.6 + nomorBaris * 11,
          teks: barisTeks,
          ukuran: HURUF.daftar,
          warna: LAPORAN_PDF_WARNA.teks,
        });
      });
    });
    p.y = tinggi;
    units.push(unitDari(p, { peran: "daftarRingkasan", nada }, start + kolom < baris.length ? jarak : 0));
  }
  units.push(unitJarak(PAD_BAWAH_KARTU + JARAK_KARTU));
  return units;
}

/** Label & warna untuk temuan analitik — sama pembagiannya dengan halaman. */
export function laporanPdfTemuanGaya(level: string): { label: string; nada: LaporanWarnaNama } {
  if (level === "warn") return { label: "Perlu ditindak", nada: "amber" };
  if (level === "good") return { label: "Kabar baik", nada: "emerald" };
  return { label: "Keterangan", nada: "sky" };
}

/** Daftar temuan: tiap kalimat jadi kotak bernada menurut sifatnya. */
export function laporanPdfTemuanUnits(rows: LaporanRow[]): LaporanPdfUnit[] {
  const units: LaporanPdfUnit[] = rows.map((row) => {
    const level = cellDisplay(row.cells[0] ?? { text: "" });
    const gaya = laporanPdfTemuanGaya(level);
    const warna = LAPORAN_WARNA[gaya.nada];
    const p = papan();
    const teks = cellDisplay(row.cells[1] ?? { text: "" });
    const dibungkus = laporanPdfWrap(teks, LEBAR_DALAM_KARTU - 40, HURUF.temuan, false);
    const tinggi = 12 + dibungkus.length * 11;
    const lebarLabel = laporanPdfTextWidth(gaya.label.toUpperCase(), 6.4, true) + 12;
    kotak(p, { x: X_KARTU, y: 0, w: LEBAR_DALAM_KARTU, h: tinggi, radius: 7, isi: warna.selang, alfa: 0.55, garis: warna.selang, lebarGaris: 0.7 });
    kotak(p, { x: X_KARTU + 8, y: 6, w: lebarLabel, h: 13, radius: 6.5, isi: warna.jumlah });
    tulis(p, {
      x: X_KARTU + 14,
      y: 15,
      teks: gaya.label.toUpperCase(),
      ukuran: 6.4,
      tebal: true,
      warna: warna.bagian,
      tc: 0.3,
    });
    dibungkus.forEach((barisTeks, nomorBaris) => {
      tulis(p, {
        x: X_KARTU + 8 + lebarLabel + 8,
        y: 15.5 + nomorBaris * 11,
        teks: barisTeks,
        ukuran: HURUF.temuan,
        warna: LAPORAN_PDF_WARNA.teks,
      });
    });
    p.y = tinggi;
    return unitDari(p, { peran: "temuan", nada: gaya.nada }, 0);
  });
  if (units.length > 0) units.push(unitJarak(PAD_BAWAH_KARTU + JARAK_KARTU));
  return units;
}

/* ------------------------------------------------------------- bagan ----- */

/** Tinggi area gambar bagan (di dalam kartu bagan). */
export const LAPORAN_PDF_BAGAN_TINGGI_PT = 150;

/** Kepala kartu bagan: label “Grafik”, judul, dan keterangannya. */
export function laporanPdfBaganJudulUnit(chart: LaporanChart): LaporanPdfUnit {
  const nada = laporanWarnaNamaBagian(chart.sectionId);
  const warna = LAPORAN_WARNA[nada];
  const p = papan();
  const x = LAPORAN_PDF_MARGIN_PT;
  let y = PAD_ATAS_KARTU;
  kotak(p, { x: x + PAD_KARTU, y, w: 22, h: 22, radius: 6, isi: warna.selang, alfa: 0.9, garis: warna.selang, lebarGaris: 0.6 });
  gambarIkon(p, x + PAD_KARTU + 5, y + 5, 12, "garis", warna.bagian);
  tulis(p, {
    x: x + PAD_KARTU + 31,
    y: y + 8.4,
    teks: "GRAFIK · " + laporanPdfKickerBagian(chart.sectionId).toUpperCase(),
    ukuran: HURUF.kicker,
    tebal: true,
    warna: warna.bagian,
    tc: 0.5,
  });
  tulis(p, {
    x: x + PAD_KARTU + 31,
    y: y + 20.4,
    teks: laporanPdfCut(chart.title, LEBAR_DALAM_KARTU - 31, HURUF.baganJudul, true),
    ukuran: HURUF.baganJudul,
    tebal: true,
    warna: LAPORAN_PDF_WARNA.judulTeks,
  });
  y += 22 + 11;
  if (chart.note) {
    for (const barisTeks of laporanPdfWrap(chart.note, LEBAR_DALAM_KARTU, HURUF.ketKartu, false)) {
      tulis(p, { x: x + PAD_KARTU, y, teks: barisTeks, ukuran: HURUF.ketKartu, warna: LAPORAN_PDF_WARNA.teksLembut });
      y += 10;
    }
  }
  p.y = y + 6;
  return unitDari(p, { peran: "baganJudul", bagian: chart.sectionId, nada }, 0);
}

/**
 * Gambar bagannya sendiri: kotak bernada tipis, garis bantu, batang vektor berwarna
 * (makin tinggi nilainya makin tua nadanya), angka di atas batang selama muat, dan
 * label sumbunya.
 */
export function laporanPdfBaganUnit(chart: LaporanChart): LaporanPdfUnit {
  const nada = laporanWarnaNamaBagian(chart.sectionId);
  const warna = LAPORAN_WARNA[nada];
  const p = papan();
  const x = X_KARTU;
  const w = LEBAR_DALAM_KARTU;
  const h = LAPORAN_PDF_BAGAN_TINGGI_PT;
  const kiri = x + 12;
  const lebarPlot = w - 24;
  const dasarBatang = h - 24;
  const atasPlot = 20;
  const tinggiMaks = dasarBatang - atasPlot;

  kotak(p, { x, y: 0, w, h, radius: 7, isi: warna.selang, alfa: 0.4, garis: warna.selang, lebarGaris: 0.8 });
  for (const bagian of [0.25, 0.5, 0.75]) {
    const yGaris = dasarBatang - tinggiMaks * bagian;
    kotak(p, { x: kiri, y: yGaris, w: lebarPlot, h: 0.5, isi: LAPORAN_PDF_WARNA.garis, alfa: 0.9 });
  }
  kotak(p, { x: kiri, y: dasarBatang, w: lebarPlot, h: 0.7, isi: LAPORAN_PDF_WARNA.garisKuat });

  const values = laporanChartValues(chart);
  const tertinggi = Math.max(0, ...values);
  const n = chart.points.length;
  if (n > 0 && tertinggi > 0) {
    const langkah = lebarPlot / n;
    const lebarBatang = Math.max(0.9, langkah * 0.62);
    values.forEach((value, index) => {
      if (value <= 0) return;
      const tinggi = Math.max(0.9, (value / tertinggi) * tinggiMaks);
      const batangX = kiri + index * langkah + (langkah - lebarBatang) / 2;
      // Batangnya tumbuh **ke atas** dari garis dasarnya: di ruang lokal Y diukur ke
      // bawah, jadi tepi atas batangnya ada `tinggi` di atas dasar.
      kotak(p, {
        x: batangX,
        y: dasarBatang - tinggi,
        w: lebarBatang,
        h: tinggi,
        isi: laporanWarnaBatang(chart.sectionId, value, tertinggi),
      });
      const label = laporanChartValueText(chart, value);
      const lebarLabel = laporanPdfTextWidth(label, HURUF.angkaBatang, false);
      if (lebarLabel <= langkah - 2) {
        const geser = Math.min(
          Math.max(kiri + index * langkah - x + 0.5, batangX - x + (lebarBatang - lebarLabel) / 2),
          kiri + index * langkah - x + langkah - 0.5 - lebarLabel,
        );
        tulis(p, {
          x: x + geser,
          y: dasarBatang - tinggi - 2.6,
          teks: label,
          ukuran: HURUF.angkaBatang,
          warna: LAPORAN_PDF_WARNA.teksPudar,
        });
      }
    });
  }

  const labels = laporanChartAxisLabels(chart, LAPORAN_CHART_AXIS_LABELS_MAX);
  if (n > 0) {
    const langkah = lebarPlot / n;
    labels.forEach((label, index) => {
      if (label === "") return;
      const muat = Math.max(1, Math.floor((langkah * 3) / Math.max(0.1, laporanPdfTextWidth("0", HURUF.baganBawah, false))));
      const dipotong = laporanPdfCut(label, muat * laporanPdfTextWidth("0", HURUF.baganBawah, false), HURUF.baganBawah, false);
      tulis(p, {
        x: kiri + index * langkah,
        y: h - 8,
        teks: dipotong,
        ukuran: HURUF.baganBawah,
        warna: LAPORAN_PDF_WARNA.teksPudar,
      });
    });
  }

  p.y = h;
  return unitDari(p, { peran: "bagan", bagian: chart.sectionId, nada }, 0);
}

/** Kalimat keterangan bagan: jumlah titik & nilai tertinggi (bisa dibaca mesin). */
export function laporanPdfBaganKeteranganUnit(chart: LaporanChart): LaporanPdfUnit {
  const nada = laporanWarnaNamaBagian(chart.sectionId);
  const p = papan();
  const values = laporanChartValues(chart);
  const tertinggi = Math.max(0, ...values);
  const teks = `${chart.points.length} titik batang, tertinggi ${laporanChartValueText(chart, tertinggi)}.`;
  tulis(p, {
    x: X_KARTU,
    y: 8,
    teks,
    ukuran: 7.4,
    warna: LAPORAN_PDF_WARNA.teksPudar,
  });
  p.y = 11;
  return unitDari(p, { peran: "baganKeterangan", bagian: chart.sectionId, nada }, 0);
}

/* --------------------------------------------------------------- kaki ---- */

/** Kaki halaman: garis pemisah, nama berkas, dan nomor halaman. */
export function laporanPdfKakiUnit(document: LaporanDocument, page: number, totalPages: number): LaporanPdfUnit {
  const p = papan();
  const x = LAPORAN_PDF_MARGIN_PT;
  const w = LAPORAN_PDF_LEBAR_KONTEN_PT;
  kotak(p, { x, y: 0, w, h: 0.7, isi: LAPORAN_PDF_WARNA.garis });
  tulis(p, {
    x,
    y: 14,
    teks: `${LAPORAN_PDF_PRODUCER} - ${document.title} - ${document.store}`,
    ukuran: HURUF.kaki,
    warna: LAPORAN_PDF_WARNA.teksPudar,
  });
  tulis(p, {
    x,
    y: 14,
    teks: `halaman ${page} dari ${totalPages}`,
    ukuran: HURUF.kaki,
    warna: LAPORAN_PDF_WARNA.teksPudar,
    rata: "kanan",
    lebar: w,
  });
  p.y = LAPORAN_PDF_TINGGI_KAKI_PT;
  return unitDari(p, { peran: "kaki" }, 0);
}

/* ========================================================== perakitan ==== */

/**
 * Satu kartu = satu bagian laporan: kepala kartu (yang diulang kalau kartunya pecah
 * halaman) + unit isinya.
 */
interface Kartu {
  id: string;
  nada: LaporanWarnaNama;
  units: LaporanPdfUnit[];
  /** Kepala pengulangan saat kartu ini pecah halaman. */
  ulang: LaporanPdfUnit[];
}

/** Satu baris daftar isi berkas: nomor, judul, warna bagiannya, dan letaknya. */
interface EntriIsi {
  id: string;
  nomor: number;
  label: string;
  nada: LaporanWarnaNama;
}

/** Warna bagian untuk satu id bagian laporan. */
function nadaBagian(bagianId: string): LaporanWarnaNama {
  return laporanWarnaNamaBagian(bagianId);
}

/**
 * Kartu-kartu berkas, urut dari atas. Daftar isi membutuhkan nomor halaman yang baru
 * diketahui **setelah** halaman dibagi, jadi fungsi ini dipanggil dua kali: sekali
 * tanpa nomor halaman, sekali dengan nomor halaman hasil pembagian pertama. Bentuk
 * dan tinggi kartunya tidak berubah di antara kedua panggilan itu (nomor halaman
 * hanya mengubah teks di daftar isi), jadi hasil pembagiannya tetap sama —
 * itulah yang membuat berkasnya deterministik.
 */
function kartuBerkas(document: LaporanDocument, halamanIsi: Map<string, number>): Kartu[] {
  const kartu: Kartu[] = [];
  const entri: EntriIsi[] = [];
  /** Mendaftarkan satu bagian ke daftar isi; nomornya urut, jadi tidak pernah melompat. */
  const daftarIsi = (id: string, label: string, nada: LaporanWarnaNama): number => {
    entri.push({ id, nomor: entri.length + 1, label, nada });
    return entri.length;
  };

  // 1. Ringkasan singkat (kalimat bahasa awam) — bagian pertama, seperti di halaman.
  const nadaRingkas = nadaBagian("ringkasan");
  const nomorRingkas = daftarIsi("ringkasan-singkat", "Ringkasan singkat", nadaRingkas);
  kartu.push({
    id: "ringkasan-singkat",
    nada: nadaRingkas,
    units: [
      laporanPdfKartuJudulUnit(
        "ringkasan",
        nomorRingkas,
        "Ringkasan singkat",
        "Dibaca apa adanya - tidak perlu paham istilah pembukuan. Kalimatnya sama dengan yang tampil di halaman Laporan.",
        nadaRingkas,
        { kickerLain: "Tanpa istilah pembukuan" },
      ),
      ...laporanPdfDaftarUnits(document.summaryLines, nadaRingkas),
    ],
    ulang: [laporanPdfKartuJudulUnit("ringkasan", nomorRingkas, "Ringkasan singkat", undefined, nadaRingkas, { lanjutan: true })],
  });

  // 2. Bagian-bagian dokumen (ringkasan periode, metode bayar, pajak, analitik, cabang).
  document.sections.forEach((bagian) => {
    const nada = nadaBagian(bagian.id);
    const nomor = daftarIsi(`bagian:${bagian.id}`, bagian.title, nada);
    const judul = laporanPdfKartuJudulUnit(bagian.id, nomor, bagian.title, bagian.note, nada);
    const ulang = [laporanPdfKartuJudulUnit(bagian.id, nomor, bagian.title, undefined, nada, { lanjutan: true })];
    const units: LaporanPdfUnit[] = [judul];

    // Bentuk isi mengikuti isinya: angka utama jadi petak, temuan jadi kotak bernada,
    // satu kolom keterangan jadi kotak catatan, sisanya tabel — sama seperti halaman.
    const numeric = kolomAngka(bagian);
    if (bagian.id === "ringkasan" && bagian.rows.every((row) => row.cells.length === 2)) {
      units.push(...laporanPdfPetakUnits(bagian.rows, nada), unitJarak(PAD_BAWAH_KARTU + JARAK_KARTU));
    } else if (bagian.id === "analitik-temuan") {
      units.push(...laporanPdfTemuanUnits(bagian.rows));
    } else if (bagian.headers.length === 1) {
      units.push(...laporanPdfCatatanUnits(cellDisplay(bagian.rows[0]?.cells[0] ?? { text: "" }), nada));
    } else {
      const tabel = laporanPdfTabelUnits(
        bagian.headers,
        bagian.rows.map((row) => row.cells.map((cell) => cellDisplay(cell))),
        numeric,
        bagian.total ? bagian.total.cells.map((cell) => cellDisplay(cell)) : null,
        nada,
      );
      units.push(tabel.kepala, ...tabel.baris, ...tabel.jumlah, tabel.akhir);
      // Kepala tabel ikut diulang saat tabelnya menyambung ke halaman berikutnya.
      ulang.push(tabel.kepala);
    }

    kartu.push({ id: `bagian:${bagian.id}`, nada, units, ulang });

    // Grafik bagian ini diletakkan **tepat di bawah tabelnya** (bukan dikumpulkan di
    // akhir berkas): pembaca yang sedang melihat tabel omzet per jam tidak perlu
    // membalik ke belakang untuk grafiknya.
    for (const chart of document.charts.filter((row) => row.sectionId === bagian.id)) {
      const nadaBagan = nadaBagian(chart.sectionId);
      kartu.push({
        id: `bagan:${chart.id}`,
        nada: nadaBagan,
        units: [
          laporanPdfBaganJudulUnit(chart),
          laporanPdfBaganUnit(chart),
          laporanPdfBaganKeteranganUnit(chart),
        ],
        ulang: [laporanPdfBaganJudulUnit(chart)],
      });
    }
  });

  // 3. Daftar isi ditaruh langsung di bawah kepala berkas: pembaca yang mencari satu
  //    bagian tidak perlu menggulir seluruh laporan, dan tiap barisnya memakai warna
  //    bagiannya — sama dengan “peta bagian” di atas halaman Laporan.
  const pembuka: Kartu = {
    id: "daftar-isi",
    nada: "netral",
    units: [
      laporanPdfKartuJudulUnit(
        "daftar-isi",
        0,
        "Daftar isi",
        `Berkas ini terdiri dari ${entri.length} bagian bernomor; tiap baris menyebut halamannya.`,
        "netral",
        { kickerLain: "ISI BERKAS" },
      ),
      ...laporanPdfDaftarIsiUnit(
        entri.map((item) => ({
          nomor: item.nomor,
          label: item.label,
          nada: item.nada,
          halaman: halamanIsi.get(item.id) ?? 1,
        })),
      ),
    ],
    ulang: [],
  };

  /*
    Tiap unit ditandai kartu pemiliknya. Rangka kartunya (kotak putih bergaris nada
    bagiannya + pita di tepi atas) digambar dari penanda itu, jadi kartu yang unitnya
    tidak bertanda tidak akan punya rangka sama sekali — bagian dokumen tampak seperti
    tulisan lepas tanpa kartu di halaman.
  */
  return [pembuka, ...kartu].map((row) => {
    const units = tandai(row.units, row.id);
    /*
      Unit pengulangan yang **sama** dengan salah satu unit kartunya (kepala tabel)
      memakai objek hasil penandaan yang sama, bukan salinan kedua: pembagian halaman
      membandingkan unit lewat identitas untuk tahu sebuah unit sudah ditulis di
      halaman barunya lewat pengulangan. Tanpa itu, kepala tabel yang tidak sempat muat
      di halaman sebelumnya tercetak **dua kali** di puncak halaman baru — sekali dari
      daftar pengulangan, sekali dari daftar unitnya sendiri.
    */
    const ulang = row.ulang.map((unit) => {
      const sama = row.units.findIndex((kandidat) => kandidat === unit);
      return sama >= 0 ? units[sama] : tandai([unit], row.id)[0];
    });
    return { ...row, units, ulang };
  });
}

/** Kolom mana yang berisi angka (untuk perataan kanan). */
function kolomAngka(bagian: LaporanSection): boolean[] {
  const kolom = Math.max(0, ...bagian.rows.map((row) => row.cells.length), bagian.total?.cells.length ?? 0);
  const hasil: boolean[] = [];
  for (let index = 0; index < kolom; index += 1) {
    const sel = bagian.rows.map((row) => row.cells[index]).filter((cell) => cell !== undefined);
    hasil.push(sel.length > 0 && sel.every((cell) => !("text" in cell) || /^[\d.,\s-]*$/.test(cell.text)));
  }
  return hasil;
}

/** Hasil pembagian halaman: unit-unit tiap halaman + halaman awal tiap kartu. */
interface Pembagian {
  halaman: LaporanPdfUnit[][];
  /** id kartu → nomor halaman tempat kartunya mulai. */
  mulai: Map<string, number>;
}

/**
 * Membagi kartu-kartu jadi halaman.
 *
 * Kepala berkas di halaman pertama memakan tempat paling banyak, sedangkan halaman
 * lanjutannya memakai kepala ringkas — jadi tinggi yang tersedia dihitung **per
 * halaman** (`sisa`), bukan sekali untuk semuanya: halaman yang kepalanya lebih
 * tinggi otomatis menampung lebih sedikit isi. Kalau sebuah kartu terpotong, kepala
 * kartunya (dan kepala tabelnya) diulang di halaman baru supaya pembacanya tidak
 * perlu menebak kolom mana yang mana.
 */
function bagiHalaman(
  kartu: Kartu[],
  kepalaPertama: LaporanPdfUnit[],
  kepalaUlang: (page: number) => LaporanPdfUnit[],
): Pembagian {
  const halaman: LaporanPdfUnit[][] = [];
  const mulai = new Map<string, number>();
  const tinggiUnits = (units: LaporanPdfUnit[]) =>
    units.reduce((total, unit) => total + unit.tinggi, 0);
  /** Satu poin disisihkan supaya pembulatan tinggi tidak melewati batas halaman. */
  const sisaUntuk = (kepala: LaporanPdfUnit[]) =>
    LAPORAN_PDF_TINGGI_KONTEN_PT - 1 - tinggiUnits(kepala);

  let sekarang = [...kepalaPertama];
  let sisa = sisaUntuk(kepalaPertama);

  const tutup = () => {
    if (sekarang.length === 0) return;
    halaman.push(sekarang);
    sekarang = [];
    sisa = 0;
  };

  for (const item of kartu) {
    if (!mulai.has(item.id)) mulai.set(item.id, halaman.length + 1);
    let sudahMulai = false;
    for (const unit of item.units) {
      if (unit.tinggi > sisa && sekarang.length > 0) {
        // Tidak muat lagi: tutup halaman ini, buka halaman baru ber-kepala ringkas,
        // lalu ulangi kepala kartunya kalau kartunya memang sudah mulai di halaman
        // sebelumnya.
        const lanjut = sudahMulai;
        tutup();
        const kepala = kepalaUlang(halaman.length + 1);
        sekarang = [...kepala];
        sisa = sisaUntuk(kepala);
        sudahMulai = true;
        /*
          Unit yang sedang dicoba bisa jadi **sudah** ikut diulang: kepala tabel ada di
          daftar pengulangan kartunya. Kalau tetap ditulis setelah pengulangannya,
          kepala tabelnya tercetak dua kali bertumpuk di puncak halaman baru — terlihat
          sebagai baris judul kolom yang dobel tepat di bawah kepala berkas.
        */
        let sudahDiulang = false;
        if (lanjut) {
          for (const ulang of item.ulang) {
            sekarang.push(ulang);
            sisa -= ulang.tinggi;
            if (ulang === unit) sudahDiulang = true;
          }
        } else {
          // Kartunya baru mulai di halaman ini, jadi halaman awalnya berubah.
          mulai.set(item.id, halaman.length + 1);
        }
        if (unit.spasi || sudahDiulang) continue;
      }
      if (unit.spasi && sekarang.length === 0) continue;
      sekarang.push(unit);
      sisa -= unit.tinggi;
      sudahMulai = true;
    }
  }
  tutup();
  return { halaman, mulai };
}

/** Halaman berkas: unit-unitnya, ops gambarnya, dan teksnya (untuk pemeriksaan). */
export interface LaporanPdfHalaman {
  page: number;
  totalPages: number;
  units: LaporanPdfUnit[];
  ops: LaporanPdfOp[];
  text: string[];
}

/**
 * Rangka kartu: kotak putih bergaris nada bagiannya, pita warna di tepi atas, dan
 * rona tipis di belakang kepalanya — kerangka `SectionCard` di halaman Laporan.
 */
function rangkaKartu(atas: number, bawah: number, nada: LaporanWarnaNama): LaporanPdfOp[] {
  const warna = LAPORAN_WARNA[nada];
  const x = LAPORAN_PDF_MARGIN_PT;
  const w = LAPORAN_PDF_LEBAR_KONTEN_PT;
  const h = Math.max(24, atas - bawah);
  return [
    {
      t: "kotak",
      x,
      y: bawah,
      w,
      h,
      radius: RADIUS_KARTU,
      isi: LAPORAN_PDF_WARNA.kartu,
      garis: warna.selang,
      lebarGaris: 1,
    },
    {
      t: "kotak",
      x,
      y: atas - 2.6,
      w,
      h: 2.6,
      radius: RADIUS_KARTU,
      sisi: "atas",
      isi: warna.garis,
    },
  ];
}

/** Menandai unit-unit satu kartu supaya rangkanya bisa digambar per potongan halaman. */
function tandai(units: LaporanPdfUnit[], kartu: string): LaporanPdfUnit[] {
  return units.map((unit) => ({ ...unit, kartu }));
}

/**
 * Semua ops satu halaman: rangka tiap kartu dulu, baru isinya.
 *
 * Rangka digambar lebih dulu karena pita yang digambar setelah teks akan menutupi
 * hurufnya — kesalahan yang paling gampang terjadi saat menambahkan warna ke laporan
 * yang tadinya hitam-putih. Rangka satu kartu mengikuti potongan kartunya di halaman
 * ini: mulai dari unit pertama, dan berhenti 13 pt di bawah unit **isi** terakhirnya
 * (unit jarak tidak dihitung, supaya jarak antar kartu tetap di luar kartunya).
 */
function rangkaHalaman(units: LaporanPdfUnit[]): LaporanPdfOp[] {
  const ops: LaporanPdfOp[] = [];
  let index = 0;
  while (index < units.length) {
    const kartu = units[index].kartu;
    let akhir = index;
    if (kartu !== undefined) {
      while (akhir + 1 < units.length && units[akhir + 1].kartu === kartu) akhir += 1;
      let isiTerakhir = akhir;
      while (isiTerakhir > index && units[isiTerakhir].spasi) isiTerakhir -= 1;
      ops.push(
        ...rangkaKartu(
          posisiAtas(units, index),
          posisiBawah(units, isiTerakhir) - PAD_BAWAH_KARTU,
          units[index].nada ?? "netral",
        ),
      );
    }
    for (let nomor = index; nomor <= akhir; nomor += 1) {
      ops.push(...units[nomor].gambar(posisiAtas(units, nomor)));
    }
    index = akhir + 1;
  }
  return ops;
}

/** Berapa bagian yang didaftar di kepala berkas (pembuka + bagian dokumen). */
function jumlahBagianBerkas(document: LaporanDocument): number {
  return document.sections.length + 1;
}

/** Tanggal berkas (harian) dari `generatedAt` — bukan jam “sekarang”. */
function tanggalBerkas(document: LaporanDocument): string {
  const tanggal = new Date(document.generatedAt);
  const bulan = [
    "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
    "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
  ][tanggal.getUTCMonth()];
  return `${tanggal.getUTCDate()} ${bulan} ${tanggal.getUTCFullYear()}`;
}

/**
 * Menyusun unit tiap kartu, kartu-kartu berkas, dan akhirnya halaman-halaman berkas.
 *
 * Dipisahkan dari penulisan PDF-nya supaya tata letaknya bisa diperiksa (tinggi tiap
 * halaman, kepala yang diulang, warna tiap pita, dan tidak ada tulisan yang tertimpa)
 * tanpa membongkar byte berkasnya.
 */
export function laporanPdfPages(document: LaporanDocument): LaporanPdfHalaman[] {
  const kepalaPertama = () =>
    tandai(
      [laporanPdfKepalaUnit(document, tanggalBerkas(document), jumlahBagianBerkas(document))],
      "kepala",
    );
  const kepalaUlang = (page: number) =>
    tandai([laporanPdfKepalaLanjutanUnit(document, page)], "kepala");

  // Daftar isi memuat nomor halaman, dan nomor halaman baru diketahui setelah halaman
  // dibagi — jadi kartunya disusun dua kali. Tinggi kartunya tidak berubah di antara
  // kedua penyusunan itu (yang berubah cuma tulisan “Hal. n”), jadi hasil
  // pembagiannya tetap sama dan berkasnya tetap deterministik.
  const pertama = bagiHalaman(kartuBerkas(document, new Map()), kepalaPertama(), kepalaUlang);
  const kartu = kartuBerkas(document, pertama.mulai);
  const pembagian = bagiHalaman(kartu, kepalaPertama(), kepalaUlang);
  const totalPages = pembagian.halaman.length;

  return pembagian.halaman.map((isi, index) => {
    const units = [...isi, laporanPdfKakiUnit(document, index + 1, totalPages)];
    return {
      page: index + 1,
      totalPages,
      units,
      ops: rangkaHalaman(units),
      text: units.flatMap((unit) => unit.teks),
    };
  });
}

/** Posisi tepi atas unit ke-`index` di halamannya (Y ke atas). */
function posisiAtas(units: LaporanPdfUnit[], index: number): number {
  let y = LAPORAN_PDF_HEIGHT_PT - LAPORAN_PDF_MARGIN_PT;
  for (let i = 0; i < index; i += 1) y -= units[i].tinggi;
  return y;
}

/** Posisi tepi bawah unit ke-`index` di halamannya (Y ke atas). */
function posisiBawah(units: LaporanPdfUnit[], index: number): number {
  return posisiAtas(units, index) - units[index].tinggi;
}

/** Seluruh teks berkas, apa adanya (dipakai pemeriksaan & pratinjau). */
export function laporanPdfTextLaporan(document: LaporanDocument): string {
  return laporanPdfPages(document)
    .map((halaman) => halaman.text.join("\n"))
    .join("\n\n");
}

/* ============================================================== PDF ====== */

function pdfEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function num(value: number): string {
  return String(Number(value.toFixed(3)));
}

/**
 * Satu busur lingkaran sebagai kurva Bezier (`c`), dari sudut `dari` ke `sampai`
 * (radian, arah positif = berlawanan jarum jam) mengelilingi pusat (`cx`, `cy`).
 *
 * Titik kendalinya dihitung dari panjang busurnya (`k = 4/3 · tan(θ/4)`), dan busur
 * yang lebih dari seperempat lingkaran dipotong jadi beberapa ruas — supaya lengkungnya
 * tetap ikut lingkaran, bukan menebak.
 */
function busurC(cx: number, cy: number, r: number, dari: number, sampai: number): string {
  const bagian: string[] = [];
  const ruas = Math.max(1, Math.ceil(Math.abs(sampai - dari) / (Math.PI / 2)));
  const langkah = (sampai - dari) / ruas;
  const k = (4 / 3) * Math.tan(langkah / 4);
  for (let nomor = 0; nomor < ruas; nomor += 1) {
    const a0 = dari + langkah * nomor;
    const a1 = a0 + langkah;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    bagian.push(
      `${num(x0 - k * r * Math.sin(a0))} ${num(y0 + k * r * Math.cos(a0))} ` +
        `${num(x1 + k * r * Math.sin(a1))} ${num(y1 - k * r * Math.cos(a1))} ` +
        `${num(x1)} ${num(y1)} c`,
    );
  }
  return bagian.join("\n");
}

/**
 * Jalur **pita tepi**: potongan sisi **atas** (setinggi `h`) atau sisi **kiri** (selebar
 * `w`) dari sebuah kotak bersudut bulat berjari-jari `radius` — titik-titiknya persis
 * potongan lengkung kotak itu di dalam sabuk pitanya.
 *
 * Kenapa bukan kotak bersudut kecil saja: pita yang digambar sebagai kotak sendiri
 * dengan jari-jari **lebih kecil** dari jari-jari kotaknya menyembul keluar dari lengkung
 * sudut kotaknya (terlihat seperti garis warna yang keluar dari kartu), dan kalau
 * jari-jarinya **lebih besar** dari tingginya jalurnya malah melengkung ke luar kotaknya.
 * Di sini busur kotaknya dipotong tepat di tepi sabuk, jadi pitanya tidak pernah melewati
 * garis kotaknya — sama seperti pita yang dipotong `overflow-hidden` di halaman Laporan.
 */
function jalurPita(op: Extract<LaporanPdfOp, { t: "kotak" }>): string {
  const { x, y, w, h } = op;
  const bagian: string[] = [];

  if (op.sisi === "kiri") {
    const r = Math.min(op.radius ?? 0, h / 2);
    if (w >= r) {
      return jalurKotak({
        t: "kotak",
        x,
        y,
        w,
        h,
        radius: r,
        sudut: { kananAtas: false, kananBawah: false },
      });
    }
    const dx = r - w;
    const dy = Math.sqrt(Math.max(0, r * r - dx * dx));
    const theta = Math.atan2(dy, dx);
    bagian.push(`${num(x + w)} ${num(y + h - r + dy)} m`);
    bagian.push(`${num(x + w)} ${num(y + r - dy)} l`);
    bagian.push(busurC(x + r, y + r, r, -theta, -Math.PI));
    bagian.push(`${num(x)} ${num(y + h - r)} l`);
    bagian.push(busurC(x + r, y + h - r, r, Math.PI, theta));
    bagian.push("h");
    return bagian.join("\n");
  }

  const atas = y + h;
  const r = Math.min(op.radius ?? 0, w / 2);
  if (h >= r) {
    return jalurKotak({
      t: "kotak",
      x,
      y,
      w,
      h,
      radius: r,
      sudut: { kiriBawah: false, kananBawah: false },
    });
  }
  const dy = r - h;
  const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
  const phi = Math.atan2(dy, dx);
  bagian.push(`${num(x + r - dx)} ${num(y)} m`);
  bagian.push(`${num(x + w - r + dx)} ${num(y)} l`);
  bagian.push(busurC(x + w - r, atas - r, r, phi, Math.PI / 2));
  bagian.push(`${num(x + r)} ${num(atas)} l`);
  bagian.push(busurC(x + r, atas - r, r, Math.PI / 2, Math.PI - phi));
  bagian.push("h");
  return bagian.join("\n");
}

/**
 * Jalur kotak bersudut bulat — empat sudutnya bisa dibulatkan terpisah, jadi pita
 * kepala tabel bisa tumpul di atas dan tajam di bawah, dan sebaliknya untuk pita
 * baris jumlahnya. Kotak yang bertanda `sisi` digambar sebagai potongan tepi kotak
 * yang lebih besar (`jalurPita`).
 */
function jalurKotak(op: Extract<LaporanPdfOp, { t: "kotak" }>): string {
  if (op.sisi) return jalurPita(op);
  const r = op.radius ?? 0;
  const bentuk = op.sudut ?? {};
  const kiriAtas = bentuk.kiriAtas === false ? 0 : r;
  const kananAtas = bentuk.kananAtas === false ? 0 : r;
  const kiriBawah = bentuk.kiriBawah === false ? 0 : r;
  const kananBawah = bentuk.kananBawah === false ? 0 : r;
  const k = 0.5523;
  const { x, y, w, h } = op;
  const bagian: string[] = [];

  bagian.push(`${num(x + kiriBawah)} ${num(y)} m`);
  bagian.push(`${num(x + w - kananBawah)} ${num(y)} l`);
  if (kananBawah > 0) {
    bagian.push(
      `${num(x + w - kananBawah + k * kananBawah)} ${num(y)} ${num(x + w)} ${num(y + kananBawah - k * kananBawah)} ${num(x + w)} ${num(y + kananBawah)} c`,
    );
  }
  bagian.push(`${num(x + w)} ${num(y + h - kananAtas)} l`);
  if (kananAtas > 0) {
    bagian.push(
      `${num(x + w)} ${num(y + h - kananAtas + k * kananAtas)} ${num(x + w - kananAtas + k * kananAtas)} ${num(y + h)} ${num(x + w - kananAtas)} ${num(y + h)} c`,
    );
  }
  bagian.push(`${num(x + kiriAtas)} ${num(y + h)} l`);
  if (kiriAtas > 0) {
    bagian.push(
      `${num(x + kiriAtas - k * kiriAtas)} ${num(y + h)} ${num(x)} ${num(y + h - kiriAtas + k * kiriAtas)} ${num(x)} ${num(y + h - kiriAtas)} c`,
    );
  }
  bagian.push(`${num(x)} ${num(y + kiriBawah)} l`);
  if (kiriBawah > 0) {
    bagian.push(
      `${num(x)} ${num(y + kiriBawah - k * kiriBawah)} ${num(x + kiriBawah - k * kiriBawah)} ${num(y)} ${num(x + kiriBawah)} ${num(y)} c`,
    );
  }
  bagian.push("h");
  return bagian.join("\n");
}

function jalurPoli(op: Extract<LaporanPdfOp, { t: "poli" }>): string {
  const bagian: string[] = [];
  op.titik.forEach(([x, y], index) => {
    bagian.push(`${num(x)} ${num(y)} ${index === 0 ? "m" : "l"}`);
  });
  bagian.push("h");
  return bagian.join("\n");
}

/**
 * Isi aliran satu halaman.
 *
 * Urutannya per elemen: **isian & pita dulu, teksnya kemudian**. Kalau dibalik, teks
 * akan tertimpa pita dan hilang. Warnanya ditulis dengan `r g b rg` (isian) /
 * `r g b RG` (garis) dan kepekatannya lewat `ExtGState` (`/A08 gs`), jadi halamannya
 * tetap terang.
 */
function contentStream(halaman: LaporanPdfHalaman): string {
  const isi: string[] = [];
  type OpBentuk =
    | Extract<LaporanPdfOp, { t: "kotak" }>
    | Extract<LaporanPdfOp, { t: "poli" }>;
  const bungkus = (op: OpBentuk, dalam: string[], garis: boolean) => {
    isi.push("q");
    if (op.alfa !== undefined) isi.push(`/${laporanPdfNamaAlfa(op.alfa)} gs`);
    // Operand **sebelum** operator: `r g b rg`. Urutan terbalik (`rg r g b`) tetap
    // terbaca manusia, tetapi bagi pembaca PDF artinya “setel warna dari tumpukan
    // yang kosong” — semua pitanya kehilangan warnanya dan berkasnya tampak pucat.
    isi.push(`${pdfWarna(dalam[0])} ${garis ? "RG" : "rg"}`);
    if (garis) isi.push(`${num(op.lebarGaris ?? 0.8)} w`);
    isi.push(dalam[1]);
    isi.push(garis ? "S" : "f");
    isi.push("Q");
  };

  for (const op of halaman.ops) {
    switch (op.t) {
      case "kotak": {
        const jalur = jalurKotak(op);
        if (op.isi) bungkus(op, [op.isi, jalur], false);
        if (op.garis) bungkus(op, [op.garis, jalur], true);
        break;
      }
      case "poli": {
        const jalur = jalurPoli(op);
        if (op.isi) bungkus(op, [op.isi, jalur], false);
        if (op.garis) bungkus(op, [op.garis, jalur], true);
        break;
      }
      case "teks": {
        const lebar = laporanPdfTextWidth(op.teks, op.ukuran, op.tebal ?? false);
        const x =
          op.rata === "kanan"
            ? op.x + (op.lebar ?? 0) - lebar
            : op.rata === "tengah"
              ? op.x + ((op.lebar ?? 0) - lebar) / 2
              : op.x;
        isi.push("q");
        if (op.alfa !== undefined) isi.push(`/${laporanPdfNamaAlfa(op.alfa)} gs`);
        isi.push(`${pdfWarna(op.warna)} rg`);
        isi.push(
          `BT /${op.tebal ? "F2" : "F1"} ${num(op.ukuran)} Tf ${num(op.tc ?? 0)} Tc ` +
            `1 0 0 1 ${num(x)} ${num(op.y)} Tm (${pdfEscape(laporanPdfText(op.teks))}) Tj ET`,
        );
        isi.push("Q");
        break;
      }
    }
  }
  return isi.join("\n");
}

/** Byte berkas PDF siap diunduh. */
export function laporanPdfBytes(document: LaporanDocument): Uint8Array {
  const halaman = laporanPdfPages(document);
  // Objek 1 = katalog, 2 = halaman, 3 & 4 = huruf (biasa & tebal), lalu sepasang
  // objek per halaman (halaman + aliran isinya), dan terakhir info berkas.
  const fontObject = 3;
  const fontBoldObject = 4;
  const pageObjects = halaman.map((_halaman, index) => 5 + index * 2);
  const contentObjects = halaman.map((_halaman, index) => 6 + index * 2);
  const infoObject = 5 + halaman.length * 2;

  /** Daftar kepekatan yang dipakai halaman (satu `ExtGState` per kepekatan). */
  const extGState = LAPORAN_PDF_ALFA_DAFTAR.map(
    (alfa) => `/${laporanPdfNamaAlfa(alfa)} << /ca ${alfa} /CA ${alfa} >>`,
  ).join(" ");

  const bodies: string[] = [];
  bodies.push("<< /Type /Catalog /Pages 2 0 R >>");
  bodies.push(
    `<< /Type /Pages /Kids [${pageObjects
      .map((number) => `${number} 0 R`)
      .join(" ")}] /Count ${halaman.length} >>`,
  );
  bodies.push(
    `<< /Type /Font /Subtype /Type1 /BaseFont /${LAPORAN_PDF_FONT} /Encoding /WinAnsiEncoding >>`,
  );
  bodies.push(
    `<< /Type /Font /Subtype /Type1 /BaseFont /${LAPORAN_PDF_FONT_BOLD} /Encoding /WinAnsiEncoding >>`,
  );

  halaman.forEach((halamanIni, index) => {
    const content = contentStream(halamanIni);
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(LAPORAN_PDF_WIDTH_PT)} ${num(
        LAPORAN_PDF_HEIGHT_PT,
      )}] /Resources << /Font << /F1 ${fontObject} 0 R /F2 ${fontBoldObject} 0 R >> ` +
        `/ExtGState << ${extGState} >> >> /Contents ${contentObjects[index]} 0 R >>`,
    );
    bodies.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  const judul = laporanPdfText(`${document.title} - ${document.store}`);
  bodies.push(
    `<< /Producer (${pdfEscape(laporanPdfText(LAPORAN_PDF_PRODUCER))}) /Title (${pdfEscape(
      judul,
    )}) >>`,
  );

  let out = "%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n";
  const offsets: number[] = [];
  bodies.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const startxref = out.length;
  const size = bodies.length + 1;
  out += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${size} /Root 1 0 R /Info ${infoObject} 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let index = 0; index < out.length; index += 1) {
    bytes[index] = out.charCodeAt(index) & 0xff;
  }
  return bytes;
}

/* ---------------------------------------------- dipakai halaman & uji --- */

/** Keluarga warna satu bagian — dari id bagiannya. */
export function laporanPdfWarnaBagian(bagianId: string) {
  return laporanWarnaBagian(bagianId);
}

/** Gambar bagan satu bagian (batang bernada menurut tingginya). */
export function laporanPdfBatangBagian(bagianId: string): string[] {
  return [...laporanWarnaBagian(bagianId).batang];
}

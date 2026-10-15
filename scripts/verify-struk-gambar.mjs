/**
 * **Gambar** struk (PNG untuk WhatsApp), tanpa peramban & tanpa jaringan.
 *
 * Kenapa ada: `verify-struk-pdf.mjs` menjaga berkas PDF-nya, `verify-struk-browser.mjs`
 * membuktikan gambarnya benar-benar terbentuk di peramban sungguhan (pikselnya
 * diperiksa). Yang diuji di sini adalah **tata letaknya** — bagian yang paling mudah
 * rusak tanpa terlihat kalau halamannya berubah:
 *
 *   1. **Ukurannya masuk akal untuk dilihat orang.** Lebarnya mengikuti lebar kertas
 *      struknya (14 px per mm, dibatasi 1400 px), dan ukuran hurufnya dihitung dari
 *      jumlah kolom — bukan ditetapkan — supaya struk 32 kolom dan 80 kolom sama-sama
 *      memakai seluruh lebar kertasnya seperti di kertas yang sesungguhnya.
 *   2. **Rangkapnya terlihat.** Struk dua lembar jadi **dua lembar terpisah** di
 *      gambarnya, dengan tinggi yang mengikuti lembar terpanjang.
 *   3. **Logonya muat di kertas tersempit.** Logo rasio apa pun dimuatkan ke kotaknya
 *      tanpa mengubah rasionya, dan tidak boleh melebar sampai keluar kertas 58 mm.
 *   4. **Namanya berpasangan dengan berkas PDF-nya** (`struk-A-00042.png`), karena
 *      orang mencarinya lewat nomor nota — bukan nama berkas yang berbeda-beda.
 *
 * Semua yang diuji di sini tidak menyentuh kanvas maupun jaringan.
 *
 * Usage: bun scripts/verify-struk-gambar.mjs
 */
import { receiptDocument } from "../src/convex/lib/struk.ts";
import {
  RECEIPT_IMAGE_ADVANCE_RATIO,
  RECEIPT_IMAGE_GAP_PX,
  RECEIPT_IMAGE_LOGO_PX,
  RECEIPT_IMAGE_MAX_WIDTH_PX,
  RECEIPT_IMAGE_MIN_FONT_PX,
  RECEIPT_IMAGE_PX_PER_MM,
  receiptImageFileName,
  receiptImageLayout,
} from "../src/lib/receiptImage.ts";
import { receiptPdfFileName } from "../src/lib/receiptPdf.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const DRAFT = {
  business: "Warung Uji Struk",
  store: "Cabang Struk",
  number: "A-00042",
  when: "14/10/2026 09:15",
  cashier: "Rani",
  member: "Bu Sari Wulandari",
  items: [
    { name: "Kopi Susu Gula Aren Large", qty: 1, unitPrice: 17_550, amount: 17_550 },
    { name: "Roti Bakar", qty: 2, unitPrice: 9_000, amount: 18_000 },
  ],
  subtotal: 35_550,
  total: 35_550,
  paid: 50_000,
  change: 14_450,
};

const thermal58 = receiptDocument(
  { printerId: "thermal", paperWidthMm: 58, copies: 1, footerText: "Terima kasih" },
  DRAFT,
);
const thermal80 = receiptDocument(
  { printerId: "thermal", paperWidthMm: 80, copies: 1, footerText: "Terima kasih" },
  DRAFT,
);
const faktur241 = receiptDocument(
  { printerId: "dot_matrix", paperWidthMm: 241, copies: 2, footerText: "Terima kasih" },
  DRAFT,
);

/* ---------------------------------------------------------------- ukuran kertas */

const layout58 = receiptImageLayout(thermal58);
check(
  "lebar gambar mengikuti lebar kertas struknya (58 mm → 812 px, 14 px per mm)",
  layout58.widthPx === Math.round(58 * RECEIPT_IMAGE_PX_PER_MM) &&
    layout58.widthPx === 812,
  `${layout58.widthPx} px`,
);
check(
  "kertas 80 mm jadi gambar yang lebih lebar, dan faktur 241 mm dibatasi 1400 px",
  receiptImageLayout(thermal80).widthPx === 1120 &&
    receiptImageLayout(faktur241).widthPx === RECEIPT_IMAGE_MAX_WIDTH_PX,
  `${receiptImageLayout(thermal80).widthPx} px · ${receiptImageLayout(faktur241).widthPx} px`,
);

/* ------------------------------------------------------------------- ukuran huruf */

/** Apakah teks selebar `cols` kolom benar-benar muat di kertasnya. */
const muat = (layout) =>
  layout.cols * RECEIPT_IMAGE_ADVANCE_RATIO * layout.fontSizePx <=
  layout.usablePx + 0.001;

check(
  "hurufnya dihitung dari jumlah kolom: teks selebar kertasnya, tanpa terpotong (58 mm, 32 kolom)",
  muat(layout58) && layout58.fontSizePx > RECEIPT_IMAGE_MIN_FONT_PX,
  `${layout58.fontSizePx.toFixed(1)} px · ${layout58.cols} kolom · muat ${layout58.usablePx} px`,
);
check(
  "kertas faktur 80 kolom memakai huruf yang lebih kecil daripada kertas 32 kolom, dan tetap muat",
  muat(receiptImageLayout(faktur241)) &&
    receiptImageLayout(faktur241).fontSizePx <
      receiptImageLayout(thermal58).fontSizePx &&
    receiptImageLayout(thermal80).fontSizePx < layout58.fontSizePx,
  `${receiptImageLayout(faktur241).fontSizePx.toFixed(1)} px · ${receiptImageLayout(thermal80).fontSizePx.toFixed(1)} px · ${layout58.fontSizePx.toFixed(1)} px`,
);
check(
  "huruf yang lebih lebar di perangkat kasir (rasio terukur) mengecilkan hurufnya, bukan memotong barisnya",
  (() => {
    const terukur = receiptImageLayout(thermal58, { advanceRatio: 0.75 });
    return (
      muat(terukur) &&
      terukur.fontSizePx < layout58.fontSizePx &&
      terukur.widthPx === layout58.widthPx
    );
  })(),
  `${receiptImageLayout(thermal58, { advanceRatio: 0.75 }).fontSizePx.toFixed(1)} px vs ${layout58.fontSizePx.toFixed(1)} px`,
);

/* ------------------------------------------------------------------- tinggi & lembar */

const fakturLayout = receiptImageLayout(faktur241);
check(
  "rangkap dua digambar sebagai dua lembar terpisah, dengan tinggi rumusnya (tepinya + jarak antar lembar)",
  fakturLayout.sheetCount === 2 &&
    fakturLayout.heightPx ===
      2 * RECEIPT_IMAGE_GAP_PX +
        2 * fakturLayout.sheetHeightPx +
        RECEIPT_IMAGE_GAP_PX &&
    layout58.sheetCount === 1 &&
    layout58.heightPx === 2 * RECEIPT_IMAGE_GAP_PX + layout58.sheetHeightPx,
  `faktur ${fakturLayout.heightPx} px · struk ${layout58.heightPx} px`,
);
check(
  "tingginya angka bulat & positif, dan tingginya ikut baris terbanyak di antara lembarnya",
  Number.isInteger(fakturLayout.heightPx) &&
    fakturLayout.heightPx > 0 &&
    fakturLayout.lines ===
      Math.max(...faktur241.sheets.map((sheet) => sheet.lines.length)) &&
    Number.isInteger(fakturLayout.sheetHeightPx),
  `${fakturLayout.lines} baris · tinggi lembar ${fakturLayout.sheetHeightPx} px`,
);
check(
  "struk panjang (baris lebih banyak) menghasilkan gambar yang lebih tinggi",
  (() => {
    const panjang = receiptDocument(
      { printerId: "thermal", paperWidthMm: 58, copies: 1, footerText: "Terima kasih" },
      {
        ...DRAFT,
        items: Array.from({ length: 20 }, (_unused, index) => ({
          name: `Barang ${index + 1}`,
          qty: 1,
          amount: 1_000,
        })),
      },
    );
    const layout = receiptImageLayout(panjang);
    return layout.lines > layout58.lines && layout.heightPx > layout58.heightPx;
  })(),
  `${layout58.lines} baris → ${layout58.heightPx} px`,
);

/* ------------------------------------------------------------------------- logo */

check(
  "tanpa logo tidak ada pita kosong di atas nama usaha",
  layout58.logoBandPx === 0 && layout58.logoWidthPx === 0 && layout58.logoHeightPx === 0,
  `pita ${layout58.logoBandPx} px`,
);
const denganLogo = receiptImageLayout(thermal58, { logo: { width: 96, height: 48 } });
check(
  "logo memakai kotak 140 px, rasionya tetap (96×48 → 140×70), dan bandingnya pas satu kotak",
  denganLogo.logoBandPx === RECEIPT_IMAGE_LOGO_PX &&
    Math.abs(denganLogo.logoWidthPx - 140) < 0.001 &&
    Math.abs(denganLogo.logoHeightPx - 70) < 0.001 &&
    denganLogo.sheetHeightPx - layout58.sheetHeightPx === RECEIPT_IMAGE_LOGO_PX,
  `${denganLogo.logoWidthPx.toFixed(1)}×${denganLogo.logoHeightPx.toFixed(1)} px`,
);
const logoLebar = receiptImageLayout(thermal58, { logo: { width: 1200, height: 20 } });
check(
  "logo yang sangat lebar tetap muat di kertas 58 mm, bukan melebar keluar kertas",
  logoLebar.logoWidthPx <= logoLebar.usablePx + 0.001 &&
    Math.abs(logoLebar.logoWidthPx / logoLebar.logoHeightPx - 60) < 0.01,
  `logo 1200×20 → ${logoLebar.logoWidthPx.toFixed(1)} px (muat ${logoLebar.usablePx} px)`,
);
check(
  "ukuran logo yang tidak masuk akal (0 / bukan angka) diabaikan, bukan merusak gambarnya",
  [0, -5, Number.NaN].every((rusak) => {
    const layout = receiptImageLayout(thermal58, {
      logo: { width: rusak, height: 48 },
    });
    return layout.logoBandPx === 0 && layout.heightPx === layout58.heightPx;
  }),
  "logo rusak masih menambah pita",
);

/* ------------------------------------------------------------------ nama berkas */

check(
  "nama berkas gambarnya berpasangan dengan berkas PDF-nya: struk-A-00042.png / .pdf",
  receiptImageFileName({ number: "A-00042" }) === "struk-A-00042.png" &&
    receiptPdfFileName({ number: "A-00042" }) === "struk-A-00042.pdf",
  `${receiptImageFileName({ number: "A-00042" })} · ${receiptPdfFileName({ number: "A-00042" })}`,
);
const gambarSementara = receiptImageFileName({ number: "  " });
check(
  "nomor nota dengan spasi & simbol dibersihkan, dan struk sementara memakai cap waktu",
  receiptImageFileName({ number: "A 42/1" }) === "struk-A-42-1.png" &&
    /^struk-\d{8}-\d{4}\.png$/.test(gambarSementara) &&
    receiptImageFileName({ now: new Date(2026, 9, 14, 14, 30) }) ===
      "struk-20261014-1430.png",
  `${receiptImageFileName({ number: "A 42/1" })} · ${gambarSementara}`,
);

/* --------------------------------------------------------------------- laporan */

const gagal = results.filter((row) => !row.ok);
console.log(`${results.length - gagal.length}/${results.length} checks passed`);
if (gagal.length > 0) {
  for (const row of gagal) console.log(`- GAGAL: ${row.name}`);
  process.exit(1);
}

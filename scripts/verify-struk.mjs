/**
 * Uji aturan struk belanja tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/struk.ts` — modul murni yang dipakai halaman
 * Pengaturan (setelan & pratinjau), kasir (yang benar-benar mencetak), kedua store
 * (demo & Convex), `tenants.updateReceipt` di server, dan harness ini. Karena satu
 * modul, bentuk struk yang dilihat pemilik toko di pratinjau tidak mungkin berbeda
 * dari yang keluar di kertas.
 *
 * Yang dijaga di sini:
 *
 *   1. **Katalog tiga jenis printer** — thermal, dot matrix, portable — beserta
 *      keterangan cara kerja/kelebihan/kekurangan/cocok untuk/contoh produknya,
 *      lebar kertas yang benar-benar didukung, dan kemampuan rangkapnya.
 *   2. **Rangkap hanya di printer impact** — permintaan tembusan karbon di printer
 *      thermal/portable ditolak dengan alasan yang menyebut printer dot matrix,
 *      karena tidak ada pita karbon yang bisa ditembus di sana.
 *   3. **Lebar kertas menentukan kolom** — 58 mm = 32 kolom, 80 mm = 48 kolom,
 *      76 mm = 40 kolom, 241 mm = 80 kolom — dan setiap baris struk tidak pernah
 *      melebihi kolom itu.
 *   4. **Tata letaknya** — nama produk panjang dibungkus (bukan dipotong), nominal
 *      rata kanan, dan penanda `ASLI`/`TEMBUSAN n` hanya muncul saat memang ada
 *      rangkap.
 *   5. **Logo toko** — kotaknya tetap 110 px × 110 px (bukan lagi selebar kertas)
 *      dan dicetak hitam putih (`RECEIPT_LOGO_FILTER`), sedangkan URL yang kosong
 *      atau cuma berisi spasi dihitung “tanpa logo”.
 *   6. **Kertas yang menyesuaikan sendiri** — lebar kertas mengikuti printer yang
 *      dipilih (kertas **terdekat**, bukan yang pertama), ukuran kertas di dialog
 *      cetak ditulis dari setelannya (lebar × tinggi notanya — bukan `auto` yang
 *      dibuang peramban), dan saran setelan dari modul workspace (grosir tanpa F&B
 *      → dot matrix dua rangkap, F&B/ritel → thermal 80 mm).
 *
 * Usage: bun scripts/verify-struk.mjs
 */
import {
  DEFAULT_RECEIPT_SETTING,
  RECEIPT_COPIES_MAX,
  RECEIPT_FOOTER_DEFAULT,
  RECEIPT_FOOTER_LINE_MAX,
  RECEIPT_FOOTER_MAX_LINES,
  RECEIPT_LOGO_FILTER,
  RECEIPT_LOGO_SIZE_PX,
  RECEIPT_PRINT_FONT_MM,
  RECEIPT_PRINT_LINE_MM,
  RECEIPT_PRINT_LOGO_MM,
  RECEIPT_PRINT_MARGIN_NARROW_MM,
  RECEIPT_PRINT_MARGIN_WIDE_MM,
  RECEIPT_PRINT_SLACK_MM,
  RECEIPT_PRINTERS,
  RECEIPT_WALK_IN_NAME,
  clampReceiptCopies,
  nearestReceiptPaper,
  normalizeReceiptFooter,
  receiptBuyerName,
  receiptCenter,
  receiptCols,
  receiptCopiesHint,
  receiptCopiesLabel,
  receiptDocument,
  receiptFooterLines,
  receiptLogoUrl,
  receiptPaperLabel,
  receiptPaperOf,
  receiptPrintCss,
  receiptPrintHeightMm,
  receiptPrintMarginMm,
  receiptPrinterOf,
  receiptRow,
  receiptSeparator,
  receiptSettingOf,
  receiptSettingSentence,
  receiptSettingWithCopies,
  receiptSettingWithPaper,
  receiptSettingWithPrinter,
  receiptStaffName,
  receiptWidthHint,
  receiptWrap,
  sameReceiptPrinterChoice,
  sameReceiptSetting,
  suggestReceiptSetting,
  validateReceiptSetting,
} from "../src/convex/lib/struk.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

/** Setelan cepat: printer + kertas (+ rangkap & catatan kaki kalau perlu). */
function setting(printerId, paperWidthMm, copies = 1, footerText = RECEIPT_FOOTER_DEFAULT) {
  return { printerId, paperWidthMm, copies, footerText };
}

// ------------------------------------------------------------- katalog printer
check(
  "tiga jenis printer struk tersedia: thermal, dot matrix, portable",
  RECEIPT_PRINTERS.length === 3 &&
    ["thermal", "dot_matrix", "portable"].every((id) =>
      RECEIPT_PRINTERS.some((printer) => printer.id === id),
    ),
  RECEIPT_PRINTERS.map((printer) => printer.id).join(", "),
);

for (const printer of RECEIPT_PRINTERS) {
  check(
    `${printer.label}: keterangannya lengkap (cara kerja, kelebihan, kekurangan, cocok untuk, contoh produk)`,
    printer.how.length > 20 &&
      printer.pros.length > 0 &&
      printer.cons.length > 0 &&
      printer.fits.length > 10 &&
      printer.examples.length > 5 &&
      printer.papers.length > 0,
    JSON.stringify(printer),
  );
}

const thermal = receiptPrinterOf("thermal");
const dotMatrix = receiptPrinterOf("dot_matrix");
const portable = receiptPrinterOf("portable");

check(
  "thermal menjelaskan cara kerjanya (elemen pemanas) & contoh produknya",
  thermal.how.includes("pemanas") &&
    thermal.examples.includes("Epson TM-T82X") &&
    thermal.examples.includes("Sano P58B"),
  `${thermal.how} / ${thermal.examples}`,
);
check(
  "thermal menyebut kekurangannya (hasil bisa memudar)",
  thermal.cons.join(" ").includes("memudar"),
  thermal.cons.join(" · "),
);
check(
  "thermal cocok untuk kafe/restoran/minimarket/ritel/UMKM",
  ["Kafe", "restoran", "minimarket", "ritel", "UMKM"].every((kata) =>
    thermal.fits.includes(kata),
  ),
  thermal.fits,
);
check(
  "dot matrix menjelaskan cara kerjanya (jarum memukul pita karbon)",
  dotMatrix.how.includes("jarum") && dotMatrix.how.includes("pita karbon"),
  dotMatrix.how,
);
check(
  "dot matrix menyebut kelebihannya: bisa rangkap & tahan panas",
  dotMatrix.pros.join(" ").includes("rangkap") &&
    dotMatrix.pros.join(" ").includes("panas"),
  dotMatrix.pros.join(" · "),
);
check(
  "portable menjelaskan baterai isi ulang & Bluetooth",
  portable.how.includes("baterai") && portable.how.includes("Bluetooth"),
  portable.how,
);
check(
  "portable menyebut kekurangannya (gulungan kertas lebih kecil)",
  portable.cons.join(" ").includes("gulungan kertas"),
  portable.cons.join(" · "),
);

// Lebar kertas & kolomnya.
check(
  "thermal memakai 58 mm (32 kolom) & 80 mm (48 kolom)",
  thermal.papers.length === 2 &&
    thermal.papers[0].widthMm === 58 &&
    thermal.papers[0].cols === 32 &&
    thermal.papers[1].widthMm === 80 &&
    thermal.papers[1].cols === 48,
  JSON.stringify(thermal.papers),
);
check(
  "portable hanya 58 mm — gulungan kecilnya memang begitu",
  portable.papers.length === 1 && portable.papers[0].widthMm === 58,
  JSON.stringify(portable.papers),
);
check(
  "dot matrix memakai 76 mm (40 kolom) & faktur kontinu 241 mm (80 kolom)",
  dotMatrix.papers.length === 2 &&
    dotMatrix.papers[0].widthMm === 76 &&
    dotMatrix.papers[0].cols === 40 &&
    dotMatrix.papers[1].widthMm === 241 &&
    dotMatrix.papers[1].cols === 80,
  JSON.stringify(dotMatrix.papers),
);

// Kemampuan rangkap = yang membedakan printer impact dari yang lain.
check("thermal hanya satu lembar", thermal.maxCopies === 1, String(thermal.maxCopies));
check("portable hanya satu lembar", portable.maxCopies === 1, String(portable.maxCopies));
check(
  `dot matrix bisa sampai ${RECEIPT_COPIES_MAX} lembar (tembusan karbon)`,
  dotMatrix.maxCopies === RECEIPT_COPIES_MAX,
  String(dotMatrix.maxCopies),
);

// ------------------------------------------------------- bawaan & pembacaan
check(
  "bawaan = thermal 80 mm, satu lembar, dengan catatan kaki bawaan",
  DEFAULT_RECEIPT_SETTING.printerId === "thermal" &&
    DEFAULT_RECEIPT_SETTING.paperWidthMm === 80 &&
    DEFAULT_RECEIPT_SETTING.copies === 1 &&
    DEFAULT_RECEIPT_SETTING.footerText === RECEIPT_FOOTER_DEFAULT,
  JSON.stringify(DEFAULT_RECEIPT_SETTING),
);
check(
  "setelan kosong (tenant lama) dibaca sebagai bawaan",
  sameReceiptSetting(receiptSettingOf(undefined), DEFAULT_RECEIPT_SETTING) &&
    sameReceiptSetting(receiptSettingOf(null), DEFAULT_RECEIPT_SETTING),
  JSON.stringify(receiptSettingOf(null)),
);
check(
  "jenis printer tak dikenal jatuh ke thermal, bukan gagal dibaca",
  receiptSettingOf({ printerId: "laser", paperWidthMm: 80 }).printerId === "thermal",
  JSON.stringify(receiptSettingOf({ printerId: "laser" })),
);
check(
  "lebar kertas yang tidak didukung printernya jatuh ke kertasnya sendiri (portable 80 mm → 58 mm)",
  receiptSettingOf({ printerId: "portable", paperWidthMm: 80 }).paperWidthMm === 58,
  JSON.stringify(receiptSettingOf({ printerId: "portable", paperWidthMm: 80 })),
);
check(
  "rangkap di luar kemampuan dipangkas saat dibaca (thermal 5 → 1 lembar)",
  receiptSettingOf(setting("thermal", 80, 5)).copies === 1,
  String(receiptSettingOf(setting("thermal", 80, 5)).copies),
);
check(
  "rangkap 0 / rusak dibaca sebagai satu lembar",
  receiptSettingOf(setting("dot_matrix", 76, 0)).copies === 1 &&
    receiptSettingOf(setting("dot_matrix", 76, Number.NaN)).copies === 1,
  JSON.stringify(receiptSettingOf(setting("dot_matrix", 76, 0))),
);
check(
  "catatan kaki yang belum pernah diisi memakai kalimat bawaan",
  receiptSettingOf({ printerId: "thermal", paperWidthMm: 80 }).footerText ===
    RECEIPT_FOOTER_DEFAULT,
  receiptSettingOf({ printerId: "thermal", paperWidthMm: 80 }).footerText,
);
check(
  "catatan kaki yang dikosongkan tetap kosong (bukan kembali ke bawaan)",
  receiptSettingOf(setting("thermal", 80, 1, "")).footerText === "",
  JSON.stringify(receiptSettingOf(setting("thermal", 80, 1, ""))),
);

// Normalisasi catatan kaki: kendali terlihat, spasi ganda, batas baris & panjang.
check(
  "tab/kendali & spasi ganda dirapikan, baris kosong dibuang",
  normalizeReceiptFooter("  Terima\tkasih   ya  \n\n  ").includes("Terima kasih ya"),
  JSON.stringify(normalizeReceiptFooter("  Terima\tkasih   ya  \n\n  ")),
);
check(
  `catatan kaki dibatasi ${RECEIPT_FOOTER_MAX_LINES} baris`,
  normalizeReceiptFooter("baris satu\nbaris dua\nbaris tiga").split("\n").length ===
    RECEIPT_FOOTER_MAX_LINES,
  normalizeReceiptFooter("baris satu\nbaris dua\nbaris tiga"),
);
check(
  `satu baris catatan kaki dipotong di ${RECEIPT_FOOTER_LINE_MAX} karakter saat dibaca`,
  normalizeReceiptFooter("x".repeat(90)).length === RECEIPT_FOOTER_LINE_MAX,
  String(normalizeReceiptFooter("x".repeat(90)).length),
);
check(
  "catatan kaki dua baris dicetak sebagai dua baris",
  receiptFooterLines(setting("thermal", 80, 1, "Terima kasih\nSampai jumpa")).length === 2,
  JSON.stringify(receiptFooterLines(setting("thermal", 80, 1, "Terima kasih\nSampai jumpa"))),
);

// ---------------------------------------------------------------- validasi
const reject = (input) => {
  const decision = validateReceiptSetting(input);
  return decision.ok ? null : decision.reason;
};

check(
  "printer tak dikenal ditolak dengan daftar pilihannya",
  (reject({ printerId: "laser", paperWidthMm: 80, copies: 1, footerText: "" }) ?? "")
    .includes("Thermal"),
  reject({ printerId: "laser", paperWidthMm: 80, copies: 1, footerText: "" }),
);
check(
  "lebar kertas yang tidak didukung printernya ditolak (portable 80 mm)",
  (reject(setting("portable", 80)) ?? "").includes("58 mm"),
  reject(setting("portable", 80)),
);
check(
  "rangkap nol ditolak",
  (reject(setting("dot_matrix", 76, 0)) ?? "").includes("minimal satu lembar"),
  reject(setting("dot_matrix", 76, 0)),
);
check(
  "tembusan karbon di printer thermal ditolak dengan alasan yang menyebut dot matrix",
  (reject(setting("thermal", 80, 2)) ?? "").includes("Dot Matrix"),
  reject(setting("thermal", 80, 2)),
);
check(
  "tembusan karbon di printer portable ditolak juga",
  (reject(setting("portable", 58, 2)) ?? "").includes("Dot Matrix"),
  reject(setting("portable", 58, 2)),
);
check(
  `rangkap lebih dari ${RECEIPT_COPIES_MAX} di dot matrix ditolak (paling banyak ${RECEIPT_COPIES_MAX})`,
  (reject(setting("dot_matrix", 76, RECEIPT_COPIES_MAX + 1)) ?? "").includes(
    `paling banyak ${RECEIPT_COPIES_MAX}`,
  ),
  reject(setting("dot_matrix", 76, RECEIPT_COPIES_MAX + 1)),
);
check(
  "rangkap 2 dan 3 di printer dot matrix diterima",
  validateReceiptSetting(setting("dot_matrix", 76, 2)).ok === true &&
    validateReceiptSetting(setting("dot_matrix", 76, 3)).ok === true,
  JSON.stringify(validateReceiptSetting(setting("dot_matrix", 76, 2))),
);
check(
  `catatan kaki lebih dari ${RECEIPT_FOOTER_MAX_LINES} baris ditolak`,
  (reject(setting("thermal", 80, 1, "satu\ndua\ntiga")) ?? "").includes("baris"),
  reject(setting("thermal", 80, 1, "satu\ndua\ntiga")),
);
check(
  `catatan kaki lebih dari ${RECEIPT_FOOTER_LINE_MAX} karakter ditolak dengan alasan yang menyebut kertasnya`,
  (reject(setting("thermal", 80, 1, "x".repeat(RECEIPT_FOOTER_LINE_MAX + 1))) ?? "")
    .includes("80 mm"),
  reject(setting("thermal", 80, 1, "x".repeat(RECEIPT_FOOTER_LINE_MAX + 1))),
);
check(
  `catatan kaki tepat ${RECEIPT_FOOTER_LINE_MAX} karakter diterima`,
  validateReceiptSetting(setting("thermal", 80, 1, "x".repeat(RECEIPT_FOOTER_LINE_MAX))).ok ===
    true,
  JSON.stringify(
    validateReceiptSetting(setting("thermal", 80, 1, "x".repeat(RECEIPT_FOOTER_LINE_MAX))),
  ),
);
check(
  "setelan sah dikembalikan dalam bentuk yang sudah dirapikan (rangkap 2,4 → 2)",
  (() => {
    const decision = validateReceiptSetting(setting("dot_matrix", 76, 2.4, "  Terima kasih  "));
    return (
      decision.ok === true &&
      decision.value.copies === 2 &&
      decision.value.footerText === "Terima kasih"
    );
  })(),
  JSON.stringify(validateReceiptSetting(setting("dot_matrix", 76, 2.4, "  Terima kasih  "))),
);
check(
  "setelan yang bukan objek ditolak dengan alasan yang bisa dibaca",
  (reject(null) ?? "").includes("pilihan printer"),
  reject(null),
);

// ---------------------------------------------------------- kalimat & lencana
check(
  "label rangkap: satu lembar = asli, dua = asli + tembusan, tiga = asli + 2 tembusan",
  receiptCopiesLabel(setting("thermal", 80, 1)) === "1 lembar (asli)" &&
    receiptCopiesLabel(setting("dot_matrix", 76, 2)) === "2 lembar (asli + 1 tembusan)" &&
    receiptCopiesLabel(setting("dot_matrix", 76, 3)) === "3 lembar (asli + 2 tembusan)",
  [
    receiptCopiesLabel(setting("thermal", 80, 1)),
    receiptCopiesLabel(setting("dot_matrix", 76, 2)),
    receiptCopiesLabel(setting("dot_matrix", 76, 3)),
  ].join(" | "),
);
check(
  "label kertas menyebut lebar & jumlah kolomnya",
  receiptPaperLabel(setting("thermal", 80)) === "80 mm · 48 kolom" &&
    receiptPaperLabel(setting("portable", 58)) === "58 mm · 32 kolom",
  `${receiptPaperLabel(setting("thermal", 80))} | ${receiptPaperLabel(setting("portable", 58))}`,
);
check(
  "kalimat setelan menyebut printer, kertas, rangkap, dan catatan kakinya",
  (() => {
    const sentence = receiptSettingSentence(setting("dot_matrix", 76, 2, "Terima kasih"));
    return (
      sentence.includes("Dot matrix") &&
      sentence.includes("76 mm") &&
      sentence.includes("2 lembar (asli + 1 tembusan)") &&
      sentence.includes("Terima kasih")
    );
  })(),
  receiptSettingSentence(setting("dot_matrix", 76, 2, "Terima kasih")),
);
check(
  "kalimat tanpa catatan kaki tidak menyebut “catatan kaki”",
  !receiptSettingSentence(setting("thermal", 80, 1, "")).includes("catatan kaki"),
  receiptSettingSentence(setting("thermal", 80, 1, "")),
);
check(
  "penjelasan rangkap di printer thermal menyuruh pindah ke dot matrix",
  receiptCopiesHint(setting("thermal", 80)).includes("Dot Matrix"),
  receiptCopiesHint(setting("thermal", 80)),
);
check(
  "penjelasan rangkap di dot matrix menyebut penanda ASLI/TEMBUSAN",
  receiptCopiesHint(setting("dot_matrix", 76, 2)).includes("ASLI") &&
    receiptCopiesHint(setting("dot_matrix", 76, 2)).includes("TEMBUSAN"),
  receiptCopiesHint(setting("dot_matrix", 76, 2)),
);
check(
  "penjelasan lebar kertas menyebut jumlah kolom & pembungkusan nama produk",
  receiptWidthHint(setting("portable", 58)).includes("32") &&
    receiptWidthHint(setting("portable", 58)).includes("baris"),
  receiptWidthHint(setting("portable", 58)),
);

// ------------------------------------------------------------- tata letak
check(
  "kolom mengikuti lebar kertas",
  receiptCols(setting("portable", 58)) === 32 &&
    receiptCols(setting("thermal", 80)) === 48 &&
    receiptCols(setting("dot_matrix", 76)) === 40,
  String(receiptCols(setting("thermal", 80))),
);
check(
  "baris dua kolom: label di kiri, nominal rata kanan, panjangnya tepat selebar kertas",
  (() => {
    const line = receiptRow("Subtotal", "Rp 65.000", 32);
    return line.length === 32 && line.startsWith("Subtotal") && line.endsWith("Rp 65.000");
  })(),
  receiptRow("Subtotal", "Rp 65.000", 32),
);
check(
  "label panjang di baris dua kolom dipotong supaya nominalnya tetap utuh",
  (() => {
    const line = receiptRow("Biaya layanan 10%", "Rp 6.500", 20);
    return line.length === 20 && line.endsWith("Rp 6.500");
  })(),
  receiptRow("Biaya layanan 10%", "Rp 6.500", 20),
);
check(
  "teks di tengah muat dalam lebar kertasnya",
  receiptCenter("Kopi Senja", 10).length === 10 &&
    receiptCenter("Nama Toko Yang Sangat Panjang", 32).length <= 32,
  JSON.stringify([
    receiptCenter("Kopi Senja", 10),
    receiptCenter("Nama Toko Yang Sangat Panjang", 32),
  ]),
);
check(
  "garis pemisah selebar kertasnya",
  receiptSeparator(32).length === 32 && receiptSeparator(48, "=").length === 48,
  String(receiptSeparator(32).length),
);
check(
  "teks yang muat satu baris tidak dibungkus",
  receiptWrap("Kopi Susu", 32, 2).length === 1,
  JSON.stringify(receiptWrap("Kopi Susu", 32, 2)),
);
check(
  "nama panjang dibungkus di batas kata, bukan dipotong",
  (() => {
    const lines = receiptWrap("Kopi Susu Gula Aren Extra Large Spesial", 32, 2);
    return (
      lines.length === 2 &&
      lines[0] === "Kopi Susu Gula Aren Extra Large" &&
      lines[1] === "Spesial"
    );
  })(),
  JSON.stringify(receiptWrap("Kopi Susu Gula Aren Extra Large Spesial", 32, 2)),
);
check(
  "nama yang masih panjang setelah dua baris dipotong dengan “...” dan tidak melebihi kolom",
  (() => {
    const lines = receiptWrap(
      "Kopi Susu Gula Aren Extra Large Spesial Edisi Terbatas Akhir Tahun Ini",
      32,
      2,
    );
    return lines.length === 2 && lines[1].endsWith("...") && lines.every((l) => l.length <= 32);
  })(),
  JSON.stringify(
    receiptWrap(
      "Kopi Susu Gula Aren Extra Large Spesial Edisi Terbatas Akhir Tahun Ini",
      32,
      2,
    ),
  ),
);
check(
  "kata tunggal yang lebih panjang dari satu baris tetap tidak melewati kolomnya",
  receiptWrap("ProdukDenganNamaSangatPanjangSekali", 12, 2).every((l) => l.length <= 12),
  JSON.stringify(receiptWrap("ProdukDenganNamaSangatPanjangSekali", 12, 2)),
);

/** Isi struk contoh yang dipakai uji tata letak. */
const draft = {
  business: "Kopi Senja",
  store: "Cabang Utama",
  number: "A-00042",
  when: "13/10/2026 14:20",
  items: [
    { name: "Kopi Susu Gula Aren Large", qty: 2, unitPrice: 24_000, amount: 48_000 },
    { name: "Croissant Butter", qty: 1, unitPrice: 22_000, amount: 22_000 },
  ],
  subtotal: 70_000,
  discount: 5_000,
  taxLabel: "PPN 11%",
  taxAmount: 7_150,
  total: 72_150,
  paid: 100_000,
  change: 27_850,
};

const doc80 = receiptDocument(setting("thermal", 80), draft);
check(
  "setiap baris struk 80 mm paling panjang 48 karakter",
  doc80.sheets[0].lines.every((line) => line.length <= 48),
  String(Math.max(...doc80.sheets[0].lines.map((line) => line.length))),
);
check(
  "setiap baris struk 58 mm paling panjang 32 karakter",
  receiptDocument(setting("portable", 58), draft).sheets[0].lines.every(
    (line) => line.length <= 32,
  ),
  String(
    Math.max(
      ...receiptDocument(setting("portable", 58), draft).sheets[0].lines.map(
        (line) => line.length,
      ),
    ),
  ),
);
check(
  "dua baris teratas struk: nama usaha lalu namanya cabangnya, di tengah",
  doc80.sheets[0].lines[0].trim() === "Kopi Senja" &&
    doc80.sheets[0].lines[1].trim() === "Cabang Utama" &&
    doc80.sheets[0].lines[0].startsWith(" "),
  JSON.stringify(doc80.sheets[0].lines.slice(0, 3)),
);
check(
  "nomor & tanggal dokumen ikut tercetak",
  doc80.sheets[0].lines.some((line) => line.includes("A-00042")) &&
    doc80.sheets[0].lines.some((line) => line.includes("13/10/2026")),
  JSON.stringify(doc80.sheets[0].lines.slice(3, 6)),
);
check(
  "baris barang menampilkan jumlah, harga satuan, dan jumlah yang dibayar",
  doc80.sheets[0].lines.some(
    (line) => line.includes("2 x Rp 24.000") && line.trimEnd().endsWith("Rp 48.000"),
  ),
  JSON.stringify(doc80.sheets[0].lines.slice(5, 12)),
);
check(
  "diskon ditulis minus, dan pajak memakai label dari setelan workspace",
  doc80.sheets[0].lines.some((line) => line.includes("Diskon") && line.includes("-Rp 5.000")) &&
    doc80.sheets[0].lines.some(
      (line) => line.includes("PPN 11%") && line.includes("Rp 7.150"),
    ),
  JSON.stringify(doc80.sheets[0].lines.slice(-10)),
);
check(
  "baris TOTAL rata kanan dengan nominal yang benar",
  doc80.sheets[0].lines.some(
    (line) => line.startsWith("TOTAL") && line.endsWith("Rp 72.150") && line.length === 48,
  ),
  JSON.stringify(doc80.sheets[0].lines.filter((line) => line.includes("TOTAL"))),
);
check(
  "uang bayar & kembalian ikut tercetak",
  doc80.sheets[0].lines.some((line) => line.startsWith("Bayar")) &&
    doc80.sheets[0].lines.some((line) => line.startsWith("Kembali")),
  JSON.stringify(doc80.sheets[0].lines.slice(-6)),
);
check(
  "catatan kaki tercetak di baris terakhir",
  doc80.sheets[0].lines[doc80.sheets[0].lines.length - 1].trim() === RECEIPT_FOOTER_DEFAULT,
  doc80.sheets[0].lines[doc80.sheets[0].lines.length - 1],
);
check(
  "diskon & pajak yang nol tidak menghasilkan baris kosong",
  (() => {
    const lines = receiptDocument(setting("thermal", 80), {
      ...draft,
      discount: 0,
      taxLabel: "PPN 11%",
      taxAmount: 0,
      serviceLabel: undefined,
      serviceAmount: undefined,
      paid: undefined,
      change: undefined,
    }).sheets[0].lines;
    return (
      !lines.some((line) => line.startsWith("Diskon")) &&
      !lines.some((line) => line.includes("PPN 11%")) &&
      !lines.some((line) => line.startsWith("Bayar"))
    );
  })(),
  "ada baris nol",
);
check(
  "nama produk panjang memakai dua baris di struk 58 mm, tanpa kehilangan katanya",
  (() => {
    const lines = receiptDocument(setting("portable", 58), {
      ...draft,
      items: [
        { name: "Kopi Susu Gula Aren Extra Large Spesial", qty: 1, unitPrice: 30_000, amount: 30_000 },
      ],
    }).sheets[0].lines;
    const index = lines.findIndex((line) => line.startsWith("Kopi Susu Gula Aren"));
    return (
      lines[index] === "Kopi Susu Gula Aren Extra Large" &&
      lines[index + 1] === "Spesial" &&
      lines[index + 2].startsWith("1 x Rp 30.000")
    );
  })(),
  JSON.stringify(
    receiptDocument(setting("portable", 58), {
      ...draft,
      items: [
        { name: "Kopi Susu Gula Aren Extra Large Spesial", qty: 1, unitPrice: 30_000, amount: 30_000 },
      ],
    }).sheets[0].lines,
  ),
);

// ------------------------------------------------------------------ rangkap
check(
  "satu lembar: hanya satu bagian, tanpa penanda ASLI",
  doc80.sheets.length === 1 && doc80.sheets[0].copyLabel === "",
  JSON.stringify(doc80.sheets.map((sheet) => sheet.copyLabel)),
);
const doc3 = receiptDocument(setting("dot_matrix", 76, 3), draft);
check(
  "tiga rangkap: tiga bagian dengan penanda ASLI/TEMBUSAN 1/TEMBUSAN 2",
  doc3.sheets.length === 3 &&
    doc3.sheets[0].copyLabel === "ASLI" &&
    doc3.sheets[1].copyLabel === "TEMBUSAN 1" &&
    doc3.sheets[2].copyLabel === "TEMBUSAN 2",
  JSON.stringify(doc3.sheets.map((sheet) => sheet.copyLabel)),
);
check(
  "penanda rangkap benar-benar tercetak di bagian atas tiap lembar",
  doc3.sheets[1].lines[0].trim() === "TEMBUSAN 1" && doc3.sheets[0].lines[0].trim() === "ASLI",
  JSON.stringify(doc3.sheets.map((sheet) => sheet.lines.slice(0, 2))),
);
check(
  "semua lembar berisi isi struk yang sama (nomor, total, catatan kaki)",
  doc3.sheets.every(
    (sheet) =>
      sheet.lines.some((line) => line.includes("A-00042")) &&
      sheet.lines.some((line) => line.endsWith("Rp 72.150")) &&
      sheet.lines.some((line) => line.trim() === RECEIPT_FOOTER_DEFAULT),
  ),
  JSON.stringify(doc3.sheets[1].lines.slice(0, 3)),
);
check(
  "semua baris lembar rangkap tetap muat di 40 kolom (76 mm)",
  doc3.sheets.every((sheet) => sheet.lines.every((line) => line.length <= 40)),
  String(Math.max(...doc3.sheets[2].lines.map((line) => line.length))),
);
check(
  "catatan kaki yang diisi pemilik toko menggantikan kalimat bawaan",
  receiptDocument(setting("thermal", 80, 1, "Terima kasih\nWA 0812-3456"),
    draft).sheets[0].lines.slice(-2).map((line) => line.trim()).join("|") ===
    "Terima kasih|WA 0812-3456",
  JSON.stringify(
    receiptDocument(setting("thermal", 80, 1, "Terima kasih\nWA 0812-3456"), draft)
      .sheets[0].lines.slice(-2),
  ),
);
check(
  "pemberitahuan (mis. “belum dibayar”) tercetak mencolok di atas barangnya",
  receiptDocument(setting("thermal", 80), {
    ...draft,
    notice: "Belum dibayar — struk sementara",
  }).sheets[0].lines.some((line) => line.includes("Belum dibayar")),
  "tidak ada",
);

// ------------------------------------------------------------------ pembeli
// Baris `Member` selalu tercetak: nama member yang dipilih kasir, atau “Cash”
// untuk pembeli umum (tidak ada member dipilih).
const barisPembeli = (doc) =>
  doc.sheets[0].lines.find((line) => line.startsWith("Member :")) ?? "";
check(
  "kasir tidak memilih member: struk menyebut pembelinya “Cash”",
  barisPembeli(doc80) === `Member : ${RECEIPT_WALK_IN_NAME}` &&
    RECEIPT_WALK_IN_NAME === "Cash",
  JSON.stringify(doc80.sheets[0].lines.slice(3, 7)),
);
check(
  "member yang dipilih kasir tercetak dengan namanya, bukan “Cash”",
  (() => {
    const lines = receiptDocument(setting("thermal", 80), {
      ...draft,
      member: "Bu Sari Wulandari",
    }).sheets[0].lines;
    return (
      lines.includes("Member : Bu Sari Wulandari") &&
      !lines.some((line) => line.includes(RECEIPT_WALK_IN_NAME))
    );
  })(),
  JSON.stringify(
    receiptDocument(setting("thermal", 80), { ...draft, member: "Bu Sari Wulandari" })
      .sheets[0].lines.slice(3, 7),
  ),
);
check(
  "nama member yang kosong atau cuma spasi dihitung belum dipilih (tetap “Cash”)",
  receiptBuyerName(undefined) === RECEIPT_WALK_IN_NAME &&
    receiptBuyerName("") === RECEIPT_WALK_IN_NAME &&
    receiptBuyerName("   ") === RECEIPT_WALK_IN_NAME &&
    receiptBuyerName(null) === RECEIPT_WALK_IN_NAME &&
    receiptBuyerName("  Rina Kartika  ") === "Rina Kartika",
  JSON.stringify([
    receiptBuyerName(undefined),
    receiptBuyerName(""),
    receiptBuyerName("   "),
    receiptBuyerName("  Rina Kartika  "),
  ]),
);
check(
  "nama member panjang dipotong selebar kertas, barisnya tidak melebihi kolom",
  (() => {
    const doc = receiptDocument(setting("portable", 58), {
      ...draft,
      member: "Perkumpulan Keluarga Besar Wulandari Sejahtera Bersama",
    });
    const line = doc.sheets[0].lines.find((row) => row.startsWith("Member :")) ?? "";
    return line.length <= 32 && line.endsWith("...") && line.startsWith("Member : ");
  })(),
  JSON.stringify(
    receiptDocument(setting("portable", 58), {
      ...draft,
      member: "Perkumpulan Keluarga Besar Wulandari Sejahtera Bersama",
    }).sheets[0].lines.slice(3, 7),
  ),
);
check(
  "setiap lembar rangkap memuat nama pembeli yang sama",
  doc3.sheets.every((sheet) => sheet.lines.includes(`Member : ${RECEIPT_WALK_IN_NAME}`)),
  JSON.stringify(doc3.sheets.map((sheet) => sheet.lines.filter((row) => row.startsWith("Member")))),
);

// --------------------------------------------------------------------- kasir
check(
  "baris kasir tercetak di bawah pembeli, dengan nama kasir yang melayani",
  (() => {
    const lines = receiptDocument(setting("thermal", 80), {
      ...draft,
      cashier: "Sari Kasir",
    }).sheets[0].lines;
    const iMember = lines.indexOf(`Member : ${RECEIPT_WALK_IN_NAME}`);
    const iKasir = lines.indexOf("Kasir : Sari Kasir");
    return iMember >= 0 && iKasir === iMember + 1;
  })(),
  JSON.stringify(
    receiptDocument(setting("thermal", 80), { ...draft, cashier: "Sari Kasir" }).sheets[0]
      .lines.slice(3, 8),
  ),
);
check(
  "nama kasir kosong atau cuma spasi: barisnya dilewati, bukan dicetak sebagai tanda hubung",
  receiptStaffName("  ") === "" &&
    receiptStaffName(undefined) === "" &&
    receiptStaffName("  Sari  ") === "Sari" &&
    !receiptDocument(setting("thermal", 80), { ...draft, cashier: "   " }).sheets[0].lines.some(
      (line) => line.startsWith("Kasir"),
    ) &&
    !receiptDocument(setting("thermal", 80), draft).sheets[0].lines.some((line) =>
      line.startsWith("Kasir"),
    ),
  JSON.stringify(doc80.sheets[0].lines.filter((line) => line.startsWith("Kasir"))),
);
check(
  "setiap lembar rangkap menyebut kasir yang sama",
  (() => {
    const doc = receiptDocument(setting("dot_matrix", 76, 3), {
      ...draft,
      cashier: "Sari Kasir",
    });
    return (
      doc.sheets.length === 3 &&
      doc.sheets.every((sheet) => sheet.lines.includes("Kasir : Sari Kasir"))
    );
  })(),
  JSON.stringify(
    receiptDocument(setting("dot_matrix", 76, 3), { ...draft, cashier: "Sari Kasir" }).sheets.map(
      (sheet) => sheet.lines.filter((line) => line.startsWith("Kasir")),
    ),
  ),
);

// ---------------------------------------------------------------------- logo
check(
  "workspace tanpa logo: dokumen struk membawa `logoUrl: null` dan kotaknya tetap dihitung",
  doc80.logoUrl === null &&
    doc80.logoSizePx === RECEIPT_LOGO_SIZE_PX &&
    receiptLogoUrl("   ") === null,
  `${String(doc80.logoUrl)} · ${doc80.logoSizePx} px`,
);
const logoDipakai = "data:image/png;base64,AAA";
check(
  "logo yang dipasang dipakai apa adanya di dokumen struk",
  receiptDocument(setting("thermal", 80), { ...draft, logoUrl: logoDipakai }).logoUrl ===
    logoDipakai &&
    receiptDocument(setting("thermal", 80), { ...draft, logoUrl: "  " }).logoUrl === null,
  String(
    receiptDocument(setting("thermal", 80), { ...draft, logoUrl: logoDipakai }).logoUrl,
  ),
);
check(
  "ukuran logo tetap 110 px × 110 px di semua printer & lebar kertas (tidak lagi mengikuti kertasnya)",
  RECEIPT_PRINTERS.every((printer) =>
    printer.papers.every(
      (paper) =>
        receiptDocument(setting(printer.id, paper.widthMm), draft).logoSizePx ===
          RECEIPT_LOGO_SIZE_PX && RECEIPT_LOGO_SIZE_PX === 110,
    ),
  ) &&
    receiptDocument(setting("dot_matrix", 241, 2), draft).logoSizePx ===
      receiptDocument(setting("portable", 58), draft).logoSizePx,
  RECEIPT_PRINTERS.flatMap((printer) =>
    printer.papers.map(
      (paper) =>
        `${paper.widthMm}mm→${receiptDocument(setting(printer.id, paper.widthMm), draft).logoSizePx}px`,
    ),
  ).join(" · "),
);
check(
  "110 px masih muat di kertas tersempit (≈ 29 mm dari 58 mm) supaya logo tidak mendorong nama usaha",
  RECEIPT_PRINTERS.every((printer) =>
    printer.papers.every(
      (paper) => (RECEIPT_LOGO_SIZE_PX / 96) * 25.4 <= paper.widthMm - 8,
    ),
  ),
  RECEIPT_PRINTERS.flatMap((printer) =>
    printer.papers.map((paper) => `${paper.widthMm}mm: ${((RECEIPT_LOGO_SIZE_PX / 96) * 25.4).toFixed(1)}mm`),
  ).join(" · "),
);
check(
  "logo struk dicetak hitam putih: dokumen membawa saringan grayscale + kontras, sama di semua kertas",
  doc80.logoFilter === RECEIPT_LOGO_FILTER &&
    RECEIPT_LOGO_FILTER.includes("grayscale") &&
    receiptDocument(setting("dot_matrix", 241, 2), draft).logoFilter === RECEIPT_LOGO_FILTER,
  `${doc80.logoFilter} · ${receiptDocument(setting("dot_matrix", 241, 2), draft).logoFilter}`,
);

// --------------------------------------------------------- perubahan setelan
/*
  Ganti printer: lebar kertasnya menyesuaikan **sendiri** ke kertas terdekat yang
  didukung mesin barunya. Dulu aturannya “kertas pertama di daftarnya”, dan karena
  daftarnya urut dari yang tersempit, 76 mm dari printer dot matrix menyusut ke
  58 mm (32 kolom) di printer thermal — padahal 80 mm ada dan jauh lebih dekat.
*/
check(
  "ganti printer menyesuaikan lebar kertas & rangkapnya (76 mm 3 lembar → thermal jadi 80 mm 1 lembar)",
  (() => {
    const next = receiptSettingWithPrinter(setting("dot_matrix", 76, 3), "thermal");
    return next.printerId === "thermal" && next.paperWidthMm === 80 && next.copies === 1;
  })(),
  JSON.stringify(receiptSettingWithPrinter(setting("dot_matrix", 76, 3), "thermal")),
);
check(
  "ganti printer mempertahankan lebar kertas yang sama-sama didukung (58 mm tetap 58 mm)",
  receiptSettingWithPrinter(setting("portable", 58, 1), "thermal").paperWidthMm === 58,
  JSON.stringify(receiptSettingWithPrinter(setting("portable", 58, 1), "thermal")),
);
check(
  "ganti lebar kertas ke nilai yang tidak didukung printer ini diabaikan (tidak merusak setelan)",
  receiptSettingWithPaper(setting("portable", 58), 80).paperWidthMm === 58,
  JSON.stringify(receiptSettingWithPaper(setting("portable", 58), 80)),
);
check(
  "menambah rangkap lewat tombol tidak pernah melewati kemampuan printernya",
  receiptSettingWithCopies(setting("thermal", 80, 1), 3).copies === 1 &&
    receiptSettingWithCopies(setting("dot_matrix", 76, 1), 3).copies === 3,
  JSON.stringify([
    receiptSettingWithCopies(setting("thermal", 80, 1), 3).copies,
    receiptSettingWithCopies(setting("dot_matrix", 76, 1), 3).copies,
  ]),
);
check(
  "clampReceiptCopies menjaga batas 1..kemampuan printer",
  clampReceiptCopies(thermal, 0) === 1 &&
    clampReceiptCopies(dotMatrix, 9) === RECEIPT_COPIES_MAX &&
    clampReceiptCopies(dotMatrix, "2") === 2,
  String(clampReceiptCopies(dotMatrix, "2")),
);
check(
  "setelan yang sama dianggap sama (tanpa jejak audit kosong)",
  sameReceiptSetting(setting("thermal", 80, 1, "Terima kasih"), setting("thermal", 80, 1, " Terima  kasih ")) === true &&
    sameReceiptSetting(setting("thermal", 80), setting("thermal", 58)) === false &&
    sameReceiptSetting(setting("thermal", 80), setting("dot_matrix", 76)) === false &&
    sameReceiptSetting(setting("dot_matrix", 76, 2), setting("dot_matrix", 76, 3)) === false,
  "pembanding setelan salah",
);
check(
  "kertas yang tersedia dibaca dari printernya (bukan daftar global)",
  receiptPaperOf(portable, 80).widthMm === 58 &&
    receiptPaperOf(dotMatrix, 80).widthMm === 76,
  `${receiptPaperOf(portable, 80).widthMm} | ${receiptPaperOf(dotMatrix, 80).widthMm}`,
);

// ------------------------------------------------------------ kertas otomatis
/*
  Tiga hal yang bekerja **tanpa ditanya**, dan karena itu justru paling gampang
  salah: lebar kertas yang menyesuaikan printer yang dipilih
  (`nearestReceiptPaper`), ukuran kertas di dialog cetak (`receiptPrintCss`),
  dan saran setelan dari modul workspace (`suggestReceiptSetting`).
*/
check(
  "lebar yang tidak didukung menyesuaikan ke kertas terdekat (76 mm → 80 mm, bukan 58 mm)",
  nearestReceiptPaper(thermal, 76).widthMm === 80 &&
    nearestReceiptPaper(dotMatrix, 80).widthMm === 76 &&
    nearestReceiptPaper(thermal, 241).widthMm === 80 &&
    nearestReceiptPaper(portable, 80).widthMm === 58,
  [58, 76, 80, 241]
    .map((mm) => `${mm}→${nearestReceiptPaper(thermal, mm).widthMm}`)
    .join(" ") + ` | dot matrix 80→${nearestReceiptPaper(dotMatrix, 80).widthMm}`,
);
check(
  "lebar yang memang didukung dipakai apa adanya, beserta kolomnya",
  nearestReceiptPaper(thermal, 58).widthMm === 58 &&
    nearestReceiptPaper(thermal, 58).cols === 32 &&
    nearestReceiptPaper(thermal, 80).cols === 48 &&
    nearestReceiptPaper(dotMatrix, 241).widthMm === 241 &&
    receiptSettingOf({ printerId: "thermal", paperWidthMm: "80" }).paperWidthMm === 80,
  JSON.stringify(nearestReceiptPaper(thermal, 80)),
);
check(
  "lebar yang tidak bisa dibaca tetap punya jawaban: kertas pertama printer itu",
  nearestReceiptPaper(thermal, undefined).widthMm === 58 &&
    nearestReceiptPaper(thermal, Number.NaN).widthMm === 58 &&
    nearestReceiptPaper(thermal, "lebar").widthMm === 58,
  JSON.stringify(nearestReceiptPaper(thermal, undefined)),
);

const css80 = receiptPrintCss(receiptDocument(setting("thermal", 80), draft));
const css58 = receiptPrintCss(receiptDocument(setting("portable", 58), draft));
const css241 = receiptPrintCss(receiptDocument(setting("dot_matrix", 241, 2), draft));
check(
  "aturan cetak menulis ukuran kertas struknya sendiri (80 mm), bukan halaman A4",
  /@page \{ size: 80mm \d+(\.\d+)?mm; margin: 4mm; \}/.test(css80),
  css80.split("\n")[0],
);
check(
  "tingginya angka nyata, bukan `auto` — bentuk yang dibuang peramban tanpa pesan apa pun",
  !css80.includes("auto") &&
    /@page \{ size: \d+(\.\d+)?mm \d+(\.\d+)?mm; margin: \d+(\.\d+)?mm; \}/.test(css80) &&
    !/auto/.test(css58) &&
    !/auto/.test(css241),
  css80.split("\n")[0],
);
check(
  "lebar & marginnya mengikuti kertasnya: 58 mm → 58 mm & 2 mm, faktur 241 mm → 241 mm & 4 mm",
  css58.startsWith("@page { size: 58mm ") &&
    css58.includes("margin: 2mm; }") &&
    css241.startsWith("@page { size: 241mm ") &&
    css241.includes("margin: 4mm; }") &&
    receiptPrintMarginMm(58) === RECEIPT_PRINT_MARGIN_NARROW_MM &&
    receiptPrintMarginMm(76) === RECEIPT_PRINT_MARGIN_WIDE_MM,
  `${css58.split("\n")[0]} | ${css241.split("\n")[0]}`,
);
check(
  "tinggi kertas = dua margin + isi notanya + kelonggaran, dihitung dari barisnya sendiri",
  (() => {
    const doc = receiptDocument(setting("thermal", 80), draft);
    const baris = doc.sheets.reduce((total, sheet) => total + sheet.lines.length, 0);
    const harap =
      Math.round(
        (RECEIPT_PRINT_MARGIN_WIDE_MM * 2 +
          baris * RECEIPT_PRINT_LINE_MM +
          RECEIPT_PRINT_SLACK_MM) *
          100,
      ) / 100;
    return receiptPrintHeightMm(doc) === harap && receiptPrintHeightMm(doc) > 20;
  })(),
  `${receiptPrintHeightMm(doc80)} mm untuk ${doc80.sheets[0].lines.length} baris`,
);
check(
  "rangkap menambah tinggi kertasnya: dua lembar tidak dicetak di kertas yang cuma muat satu",
  (() => {
    const satu = receiptDocument(setting("dot_matrix", 76, 1), draft);
    const dua = receiptDocument(setting("dot_matrix", 76, 2), draft);
    const beda =
      Math.round((receiptPrintHeightMm(dua) - receiptPrintHeightMm(satu)) * 100) / 100;
    const barisSatu = satu.sheets.reduce((total, sheet) => total + sheet.lines.length, 0);
    const barisDua = dua.sheets.reduce((total, sheet) => total + sheet.lines.length, 0);
    const harapBeda =
      Math.round((barisDua - barisSatu) * RECEIPT_PRINT_LINE_MM * 100) / 100;
    return (
      dua.sheets.length === 2 &&
      barisDua > barisSatu &&
      beda === harapBeda &&
      beda > 20
    );
  })(),
  `${receiptPrintHeightMm(receiptDocument(setting("dot_matrix", 76, 1), draft))} → ${receiptPrintHeightMm(receiptDocument(setting("dot_matrix", 76, 2), draft))} mm`,
);
check(
  "setiap baris tambahan menambah tinggi kertas tepat satu tinggi baris",
  (() => {
    const pendek = receiptDocument(setting("thermal", 80), {
      ...draft,
      items: [draft.items[0]],
    });
    const beda =
      Math.round((receiptPrintHeightMm(doc80) - receiptPrintHeightMm(pendek)) * 100) / 100;
    const baris = doc80.sheets[0].lines.length - pendek.sheets[0].lines.length;
    return (
      baris > 0 && beda === Math.round(baris * RECEIPT_PRINT_LINE_MM * 100) / 100
    );
  })(),
  `${receiptPrintHeightMm(doc80)} − ${receiptPrintHeightMm(
    receiptDocument(setting("thermal", 80), { ...draft, items: [draft.items[0]] }),
  )} mm`,
);
check(
  "logo menambah tinggi kertas (bukan lebarnya) dan metrik barisnya satu sumber dengan tingginya",
  Math.abs(
    receiptPrintHeightMm(
      receiptDocument(setting("thermal", 80), {
        ...draft,
        logoUrl: "data:image/png;base64,AAA",
      }),
    ) -
      receiptPrintHeightMm(doc80) -
      RECEIPT_PRINT_LOGO_MM,
  ) < 0.01 &&
    css80.includes(`font-size: ${RECEIPT_PRINT_FONT_MM}mm`) &&
    css80.includes(`line-height: ${RECEIPT_PRINT_LINE_MM}mm`),
  css80.split("\n")[1],
);

// ------------------------------------------------------------ saran setelan
const saranGrosir = suggestReceiptSetting({ vertical: "wholesale", verticals: ["wholesale"] });
const saranCampur = suggestReceiptSetting({ verticals: ["umkm", "wholesale", "fnb"] });
const saranFnb = suggestReceiptSetting({ verticals: ["umkm", "fnb"] });
const saranUmkm = suggestReceiptSetting({ verticals: ["umkm"] });
const saranKosong = suggestReceiptSetting({});
check(
  "grosir tanpa F&B disarankan dot matrix 76 mm dua rangkap — nota tempo butuh tembusan",
  saranGrosir.setting.printerId === "dot_matrix" &&
    saranGrosir.setting.paperWidthMm === 76 &&
    saranGrosir.setting.copies === 2 &&
    saranGrosir.setting.footerText === RECEIPT_FOOTER_DEFAULT &&
    saranGrosir.basis === "Modul Grosir & Wholesale" &&
    saranGrosir.reason.includes("tembusan") &&
    saranGrosir.reason.includes("76 mm"),
  `${saranGrosir.basis}: ${saranGrosir.reason}`,
);
check(
  "F&B disarankan thermal 80 mm satu lembar (nama menu panjang, thermal tak bisa tembusan)",
  saranFnb.setting.printerId === "thermal" &&
    saranFnb.setting.paperWidthMm === 80 &&
    saranFnb.setting.copies === 1 &&
    saranFnb.basis === "Modul F&B" &&
    saranFnb.reason.includes("80 mm") &&
    saranFnb.reason.includes("thermal"),
  `${saranFnb.basis}: ${saranFnb.reason}`,
);
check(
  "kafe yang sekaligus grosir tetap disarankan jalur thermal, bukan jalur faktur",
  saranCampur.setting.printerId === "thermal" &&
    saranCampur.setting.paperWidthMm === 80 &&
    saranCampur.setting.copies === 1,
  JSON.stringify(saranCampur.setting),
);
check(
  "tanpa modul yang menuntut tembusan, sarannya thermal 80 mm sekali cetak — termasuk saat modulnya kosong",
  saranUmkm.setting.printerId === "thermal" &&
    saranUmkm.setting.paperWidthMm === 80 &&
    saranUmkm.setting.copies === 1 &&
    saranUmkm.basis === "UMKM & Retail Mikro" &&
    sameReceiptSetting(saranKosong.setting, saranUmkm.setting),
  `${saranUmkm.basis} · ${JSON.stringify(saranKosong.setting)}`,
);
check(
  "setiap saran adalah setelan yang sah — tidak akan ditolak server saat disimpan",
  [saranGrosir, saranCampur, saranFnb, saranUmkm, saranKosong].every(
    (saran) => validateReceiptSetting(saran.setting).ok === true,
  ) &&
    saranGrosir.setting.copies <=
      receiptPrinterOf(saranGrosir.setting.printerId).maxCopies,
  [saranGrosir, saranCampur, saranFnb, saranUmkm, saranKosong]
    .map((saran) => `${saran.setting.printerId}/${saran.setting.paperWidthMm}/${saran.setting.copies}`)
    .join(" "),
);
check(
  "pilihan mesin dibandingkan tanpa catatan kaki: “pakai saran” tidak menghapus kalimat yang sedang diketik",
  sameReceiptPrinterChoice(
    setting("thermal", 80, 1, "Halo"),
    setting("thermal", 80, 1, "Terima kasih telah berbelanja"),
  ) === true &&
    sameReceiptPrinterChoice(setting("thermal", 80), setting("thermal", 58)) === false &&
    sameReceiptPrinterChoice(setting("thermal", 80), setting("dot_matrix", 76)) === false &&
    sameReceiptPrinterChoice(setting("dot_matrix", 76, 3), setting("dot_matrix", 76, 2)) === false,
  "pembanding pilihan mesin salah",
);

console.log(`${results.length}/${results.length} checks passed`);

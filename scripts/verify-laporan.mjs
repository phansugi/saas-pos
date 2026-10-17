/**
 * Laporan yang bisa diunduh — **PDF, Excel (.xlsx), dan CSV** — tanpa peramban.
 *
 * Kenapa ada: tiga berkas ini adalah bentuk yang paling gampang "kelihatan benar
 * tapi rusak". CSV yang sel-nya salah dikutip berubah kolom begitu ada nama produk
 * bertanda titik koma; `.xlsx` yang arsip ZIP-nya salah tetap bisa diunduh tetapi
 * Excel menolaknya; PDF yang offset xref-nya meleset terbuka di sebagian pembaca
 * dan menganga di pembaca lain. Ketiganya baru ketahuan setelah berkasnya sampai di
 * tangan pemilik toko.
 *
 * Yang diperiksa di sini:
 *
 *   1. **Modelnya** — uang dibulatkan sekali, angka tetap angka (bukan teks
 *      "Rp1.234.567"), dan bagian yang tidak dimuat paketnya disebutkan di kepala
 *      berkas, bukan dihilangkan diam-diam.
 *   2. **CSV** — BOM UTF-8, pemisah titik koma, kutip ganda untuk sel yang memuat
 *      pemisah/kutip/baris baru, CRLF, dan angka yang bisa dibaca Excel Indonesia.
 *   3. **XLSX** — arsip ZIP-nya dibaca ulang dari byte-nya: setiap entri di direktori
 *      pusat dicocokkan dengan header lokalnya, CRC-32 dan panjangnya dihitung ulang,
 *      daftar bagian & nama lembarnya diperiksa, dan isi lembarnya harus memuat angka
 *      yang sama dengan modelnya. Excel tidak memberi toleransi pada bagian ini.
 *   4. **PDF** — offset xref menunjuk objek yang benar, `/Length` setiap aliran sama
 *      dengan byte-nya, `/Count` sama dengan jumlah halaman, ukuran halamannya A4,
 *      dan teksnya (angka ber-pemisah ribuan, judul, nomor halaman) benar-benar ada.
 *   5. **Paginasi** — masukan panjang menghasilkan banyak halaman, tiap halaman punya
 *      kepala & kakinya sendiri, dan tidak ada baris yang melewati lebar kertas.
 *
 * Semuanya murni: tidak ada peramban, tidak ada jaringan, tidak ada berkas yang
 * ditulis ke disk. Harness ini **tidak** membuktikan Excel benar-benar membuka
 * berkasnya — itu diperiksa terpisah dengan mengunduh berkasnya dari peramban
 * sungguhan (`scripts/verify-laporan-browser.mjs`).
 *
 * Usage: bun scripts/verify-laporan.mjs
 */
import {
  LAPORAN_CSV_BOM,
  LAPORAN_CSV_MIME,
  LAPORAN_CSV_NEWLINE,
  LAPORAN_CSV_SEPARATOR,
  LAPORAN_XLSX_MIME,
  cellCsvText,
  cellDisplay,
  cellValue,
  formatDesimal,
  formatRibuan,
  laporanChartAxisLabels,
  laporanCsv,
  laporanCsvCell,
  laporanDateLabel,
  laporanDeltaText,
  laporanDocument,
  laporanFileSlug,
  laporanRingkasanSingkat,
  laporanUang,
  laporanFileName,
  laporanStampLabel,
  moneyCell,
  numberCell,
  textCell,
} from "../src/convex/lib/laporan.ts";
import {
  LAPORAN_WARNA,
  LAPORAN_WARNA_DAFTAR,
  laporanWarnaArgb,
  laporanWarnaNamaBagian,
  laporanWarnaPdf,
} from "../src/convex/lib/laporanWarna.ts";
import {
  laporanCellStyleIndex,
  laporanCrc32,
  laporanSheets,
  laporanXmlEscape,
  laporanXlsx,
  laporanXlsxParts,
  laporanXlsxTextRows,
} from "../src/convex/lib/laporanXlsx.ts";
import {
  LAPORAN_PDF_BAGAN_TINGGI_PT,
  LAPORAN_PDF_HEIGHT_PT,
  LAPORAN_PDF_MARGIN_PT,
  LAPORAN_PDF_TINGGI_KONTEN_PT,
  LAPORAN_PDF_WARNA,
  LAPORAN_PDF_WIDTH_PT,
  laporanPdfBytes,
  laporanPdfKolumTabel,
  laporanPdfPages,
  laporanPdfText,
  laporanPdfTextLaporan,
  laporanPdfTextWidth,
  laporanPdfWrap,
} from "../src/convex/lib/laporanPdf.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const decoder = new TextDecoder("utf-8");
const encoder = new TextEncoder();

/* ------------------------------------------------------------- contoh ---- */

const GENERATED_AT = new Date(2026, 9, 16, 14, 30).getTime();

const BULAN_JULI = {
  row: {
    label: "Jul 2026",
    year: 2026,
    monthIndex: 6,
    recordedSales: 12,
    monthGrossIdr: 4500000,
    serviceChargeIdr: 150000,
  },
  regionalToPayIdr: 450000,
  ppnToPayIdr: 0,
  ownerObligationsIdr: 22500,
  umkm: { monthTaxIdr: 22500 },
  rent: { withheldIdr: 0 },
};

const BULAN_AGUSTUS = {
  row: {
    label: "Agu 2026",
    year: 2026,
    monthIndex: 7,
    recordedSales: 20,
    monthGrossIdr: 7250000,
    serviceChargeIdr: 250000,
  },
  regionalToPayIdr: 725000,
  ppnToPayIdr: 100000,
  ownerObligationsIdr: 36250,
  umkm: { monthTaxIdr: 36250 },
  rent: { withheldIdr: 1500000 },
};

/** Nama produk sengaja memuat titik koma, kutip, dan tanda pisah panjang. */
const INPUT = {
  workspace: "Pusat Bahan Bangunan",
  store: "Cabang Melati",
  period: laporanDateLabel(GENERATED_AT),
  generatedAt: GENERATED_AT,
  summary: {
    revenue: 12345678,
    tax: 1358024,
    discount: 250000,
    transactions: 42,
    itemCount: 317,
    averagePerTransaction: 293945,
  },
  methods: [
    { method: "Tunai", total: 7000000, share: 0.567 },
    { method: "QRIS", total: 5345678, share: 0.433 },
  ],
  fnb: {
    months: [BULAN_JULI, BULAN_AGUSTUS],
    totals: {
      recordedSales: 32,
      grossIdr: 11750000,
      regionalTaxIdr: 1175000,
      ppnTaxIdr: 100000,
      serviceChargeIdr: 400000,
      regionalSales: 12,
    },
    ownerTotal: 58750,
  },
  analytics: {
    range: { from: GENERATED_AT - 30 * 86400000, to: GENERATED_AT, days: 30 },
    totals: {
      revenue: 12345678,
      netRevenue: 11000000,
      tax: 1358024,
      discount: 250000,
      transactions: 42,
      itemCount: 317,
      averageBasket: 293945,
    },
    margin: {
      cost: 7000000,
      grossProfit: 4000000,
      marginPct: 36,
      uncostedRevenue: 500000,
    },
    comparison: {
      revenueDeltaPct: 12,
      transactionsDeltaPct: -5,
      averageBasketDeltaPct: null,
      marginPctDelta: 3,
    },
    topProducts: [
      {
        productId: "p1",
        name: 'Semen "Gresik" 40kg; khusus',
        category: "Bahan Bangunan",
        quantity: 120,
        revenue: 6600000,
        marginPct: 24,
        sharePct: 53,
      },
      {
        productId: "p2",
        name: "Cat Tembok — Putih",
        category: "Cat",
        quantity: 30,
        revenue: 2100000,
        marginPct: 41,
        sharePct: 17,
      },
    ],
    byCategory: [
      { category: "Bahan Bangunan", revenue: 6600000, sharePct: 53 },
      { category: "Cat", revenue: 2100000, sharePct: 17 },
    ],
    trend: [
      { key: "2026-10-14", label: "14 Okt", from: GENERATED_AT, revenue: 4200000, transactions: 15 },
      { key: "2026-10-15", label: "15 Okt", from: GENERATED_AT, revenue: 5100000, transactions: 18 },
      { key: "2026-10-16", label: "16 Okt", from: GENERATED_AT, revenue: 3050000, transactions: 9 },
    ],
    busyHours: [
      { hour: 9, revenue: 900000, transactions: 4 },
      { hour: 16, revenue: 2400000, transactions: 9 },
    ],
    weekday: [
      { weekday: 0, revenue: 0, transactions: 0 },
      { weekday: 1, revenue: 3100000, transactions: 11 },
      { weekday: 2, revenue: 2750000, transactions: 10 },
      { weekday: 3, revenue: 2200000, transactions: 8 },
      { weekday: 4, revenue: 2300000, transactions: 7 },
      { weekday: 5, revenue: 1400000, transactions: 4 },
      { weekday: 6, revenue: 600000, transactions: 2 },
    ],
    insights: [
      { level: "good", text: "Omzet naik 12% dibanding periode sebelumnya (30 hari)." },
      { level: "warn", text: "Margin “Cat Tembok — Putih” menipis." },
    ],
    forecast: {
      hasBasis: true,
      elapsedDays: 29,
      todayCounted: true,
      netRunRate: 380000,
      profitRunRate: 140000,
      completedNet: 10200000,
      todayNet: 640000,
      completedProfit: 3760000,
      todayProfit: 240000,
      projectedNet: 10840000,
      projectedProfit: 4000000,
      projectedTransactions: 45,
      previousSamePaceNet: 9500000,
      paceDeltaPct: 7,
    },
    basket: {
      receipts: 42,
      skippedReceipts: 1,
      items: 317,
      averageItems: 7.55,
      multiItemReceipts: 30,
      multiItemSharePct: 71,
      truncated: true,
      sizes: [
        { label: "1 barang", receipts: 12, sharePct: 29, revenue: 2100000 },
        { label: "2 barang", receipts: 9, sharePct: 21, revenue: 2600000 },
        { label: "3-5 barang", receipts: 14, sharePct: 33, revenue: 4200000 },
        { label: "6 barang atau lebih", receipts: 7, sharePct: 17, revenue: 365678 },
      ],
      pairs: [
        {
          aName: 'Semen "Gresik" 40kg; khusus',
          bName: "Semen Plester",
          together: 18,
          supportPct: 43,
          lift: 2.4,
          revenue: 5400000,
        },
        {
          aName: "Cat Tembok — Putih",
          bName: "Kuas 3 inci",
          together: 11,
          supportPct: 26,
          lift: 1.7,
          revenue: 1900000,
        },
      ],
    },
  },
  franchise: {
    days: 30,
    totals: {
      revenue: 20000000,
      transactions: 70,
      averageBasket: 285714,
      activeOutlets: 2,
      inactiveOutlets: 1,
    },
    outlets: [
      {
        storeId: "s1",
        name: "Cabang Melati",
        code: "MLT",
        revenue: 12345678,
        transactions: 42,
        averageBasket: 293945,
        sharePct: 62,
        truncated: false,
      },
      {
        storeId: "s2",
        name: "Cabang Kenanga",
        code: "KNG",
        revenue: 7654322,
        transactions: 28,
        averageBasket: 273368,
        sharePct: 38,
        truncated: true,
      },
    ],
    topSales: [
      { saleId: "x1", storeName: "Cabang Melati", number: "A-00042", total: 3450000 },
      { saleId: "x2", storeName: "Cabang Kenanga", number: "B-00007", total: 2100000 },
    ],
    truncated: true,
    skippedOutlets: 1,
    beyondWindow: 0,
  },
};

const KOSONG = {
  workspace: "Toko Baru",
  store: "Toko Pusat",
  period: "16 Okt 2026",
  generatedAt: GENERATED_AT,
  summary: {
    revenue: 0,
    tax: 0,
    discount: 0,
    transactions: 0,
    itemCount: 0,
    averagePerTransaction: 0,
  },
  methods: [],
  fnb: {
    months: [],
    totals: {
      recordedSales: 0,
      grossIdr: 0,
      regionalTaxIdr: 0,
      ppnTaxIdr: 0,
      serviceChargeIdr: 0,
      regionalSales: 0,
    },
    ownerTotal: 0,
  },
  analytics: null,
  franchise: null,
};

const dokumen = laporanDocument(INPUT);
const dokumenKosong = laporanDocument(KOSONG);

/* =========================================================== 1. model ==== */

check("uang dibulatkan sekali", cellValue(moneyCell(1234.6)) === 1235, cellValue(moneyCell(1234.6)));
check("uang negatif dibulatkan", cellValue(moneyCell(-99.4)) === -99, cellValue(moneyCell(-99.4)));
check("uang bukan angka jadi 0", cellValue(moneyCell(Number.NaN)) === 0, cellValue(moneyCell(Number.NaN)));
check(
  "angka desimal dipertahankan",
  cellValue(numberCell(36.5)) === 36.5,
  cellValue(numberCell(36.5)),
);
check("pemisah ribuan Indonesia", formatRibuan(1234567) === "1.234.567", formatRibuan(1234567));
check("desimal pakai koma", formatDesimal(12.5) === "12,5", formatDesimal(12.5));
check("nol berekor dibuang", formatDesimal(100) === "100", formatDesimal(100));
check("teks sel apa adanya", cellDisplay(textCell("Tunai")) === "Tunai", cellDisplay(textCell("Tunai")));
check(
  "uang jadi angka di CSV",
  cellCsvText(moneyCell(5345678)) === "5345678",
  cellCsvText(moneyCell(5345678)),
);
check(
  "desimal jadi koma di CSV",
  cellCsvText(numberCell(36.5)) === "36,5",
  cellCsvText(numberCell(36.5)),
);
check("sel kutip perlu kutip ganda", laporanCsvCell("Semen; khusus") === '"Semen; khusus"', laporanCsvCell("Semen; khusus"));
check(
  "kutip di dalam sel digandakan",
  laporanCsvCell('Semen "Gresik"') === '"Semen ""Gresik"""',
  laporanCsvCell('Semen "Gresik"'),
);
check("sel biasa tidak dibungkus", laporanCsvCell("Tunai") === "Tunai", laporanCsvCell("Tunai"));
check(
  "label perubahan tanpa pembanding",
  laporanDeltaText(null) === "tidak ada pembanding",
  laporanDeltaText(null),
);
check("label perubahan negatif", laporanDeltaText(-5) === "-5%", laporanDeltaText(-5));
check("slug nama berkas", laporanFileSlug("Pusat Bahan/Bangunan") === "pusat-bahan-bangunan", laporanFileSlug("Pusat Bahan/Bangunan"));
check("slug kosong punya cadangan", laporanFileSlug("///") === "toko", laporanFileSlug("///"));

check("judul dokumen tetap", dokumen.title === "Laporan penjualan", dokumen.title);check(
  "semua bagian rakitan hadir",
  dokumen.sections.length === 16,
  dokumen.sections.map((section) => section.id).join(", "),
);
check(
  "id bagian berurutan & unik",
  new Set(dokumen.sections.map((section) => section.id)).size === dokumen.sections.length,
  "ada id kembar",
);
check(
  "ringkasan memuat omzet sebagai angka",
  cellValue(dokumen.sections[0].rows[0].cells[1]) === 12345678,
  cellValue(dokumen.sections[0].rows[0].cells[1]),
);
const metode = dokumen.sections.find((section) => section.id === "metode-bayar");
check("baris jumlah metode bayar", metode.total !== undefined, "baris jumlah hilang");
check(
  "jumlah omzet metode = omzet periode",
  cellValue(metode.total.cells[1]) === 12345678,
  cellValue(metode.total.cells[1]),
);
const pajak = dokumen.sections.find((section) => section.id === "pajak-fnb");
check("pajak: satu baris per bulan", pajak.rows.length === 2, pajak.rows.length);
check("pajak: baris jumlah ada", pajak.total !== undefined, "tanpa baris jumlah");
check(
  "pajak: jumlah PPh sewa = penjumlahan bulan",
  cellValue(pajak.total.cells[7]) === 1500000,
  cellValue(pajak.total.cells[7]),
);
check(
  "pajak: keterangan menyebut perkiraan",
  /perkiraan/i.test(pajak.note ?? ""),
  pajak.note,
);
check(
  "catatan menyebut bagian yang tidak disertakan",
  dokumenKosong.notes.some((note) => /Analitik lanjutan tidak disertakan/.test(note)) &&
    dokumenKosong.notes.some((note) => /lintas cabang tidak disertakan/i.test(note)),
  dokumenKosong.notes.join(" | "),
);
check(
  "bagian yang tidak dimuat tetap ada penjelasannya",
  dokumenKosong.sections.find((section) => section.id === "pajak-fnb").rows[0].cells[0].text.includes(
    "Belum ada data",
  ),
  "bagian kosong tanpa keterangan",
);
check(
  "tanpa analitik tidak ada bagian analitik",
  !dokumenKosong.sections.some((section) => section.id.startsWith("analitik")),
  "bagian analitik muncul di dokumen kosong",
);
check(
  "catatan memuat sumber angka",
  dokumen.notes.some((note) => /data aplikasi MesinPOS/.test(note)),
  dokumen.notes.join(" | "),
);

/* ---- bagian enterprise: proyeksi akhir periode & analisis keranjang ---- */

const proyeksi = dokumen.sections.find((section) => section.id === "analitik-proyeksi");
check("proyeksi: bagiannya ada di dalam analitik", proyeksi !== undefined, "bagian proyeksi hilang");
check(
  "proyeksi: keterangannya menyebut laju hari penuh & hari yang belum penuh",
  /29 hari penuh/.test(proyeksi.note ?? "") && /hari ini belum dihitung penuh/.test(proyeksi.note ?? ""),
  proyeksi.note,
);
const barisProyeksi = new Map(
  proyeksi.rows.map((row) => [cellDisplay(row.cells[0]), row.cells[1]]),
);
check(
  "proyeksi: omzet & laba akhir periode tercetak sebagai angka (bukan teks)",
  cellValue(barisProyeksi.get("Proyeksi omzet bersih akhir periode")) === 10840000 &&
    cellValue(barisProyeksi.get("Proyeksi laba kotor akhir periode")) === 4000000 &&
    cellValue(barisProyeksi.get("Laju omzet bersih per hari")) === 380000,
  [...barisProyeksi].map(([label, cell]) => `${label}=${cellValue(cell)}`).join(" | "),
);
check(
  "proyeksi: yang sudah tercatat = hari penuh + hari yang berjalan",
  cellValue(barisProyeksi.get("Sudah tercatat: omzet bersih")) === 10840000 &&
    cellValue(barisProyeksi.get("Hari ini (bagian hari yang sudah lewat)")) === 640000,
  cellValue(barisProyeksi.get("Sudah tercatat: omzet bersih")),
);
check(
  "proyeksi: pembandingnya periode sebelumnya pada jumlah hari penuh yang sama",
  cellValue(barisProyeksi.get("Omzet bersih periode sebelumnya (jumlah hari penuh yang sama)")) ===
    9500000 &&
    cellValue(barisProyeksi.get("Perubahan laju hari penuh vs periode sebelumnya (%)")) === 7,
  cellValue(barisProyeksi.get("Omzet bersih periode sebelumnya (jumlah hari penuh yang sama)")),
);

const keranjang = dokumen.sections.find((section) => section.id === "analitik-keranjang");
check(
  "keranjang: satu baris per rentang ukuran & baris jumlahnya",
  keranjang.rows.length === 4 && keranjang.total !== undefined,
  String(keranjang.rows.length),
);
check(
  "keranjang: rata-rata barang per nota memakai koma desimal",
  /7,55 barang per nota/.test(keranjang.note ?? "") && /71% nota memuat dua jenis/.test(keranjang.note ?? ""),
  keranjang.note,
);
check(
  "keranjang: baris jumlah = seluruh nota & pangsa 100%",
  cellValue(keranjang.total.cells[1]) === 42 &&
    cellValue(keranjang.total.cells[2]) === 100 &&
    cellValue(keranjang.total.cells[3]) === 9265678,
  keranjang.total.cells.map((cell) => cellValue(cell)).join(" | "),
);

const pasangan = dokumen.sections.find((section) => section.id === "analitik-pasangan");
check(
  "keranjang: pasangan produk dicetak dengan nota, pangsa, kebiasaan berulang & omzet",
  pasangan.rows.length === 2 &&
    pasangan.rows[0].cells.map((cell) => cellValue(cell)).join("|") ===
      'Semen "Gresik" 40kg; khusus|Semen Plester|18|43|2.4|5400000',
  pasangan.rows[0].cells.map((cell) => cellValue(cell)).join("|"),
);
check(
  "keranjang: pemindaian yang terpotong disebutkan di keterangannya",
  /Sebagian pasangan belum dipindai/.test(pasangan.note ?? ""),
  pasangan.note,
);
check(
  "tanpa analitik tidak ada bagian proyeksi & keranjang",
  !dokumenKosong.sections.some((section) =>
    ["analitik-proyeksi", "analitik-keranjang", "analitik-pasangan"].includes(section.id),
  ),
  dokumenKosong.sections.map((section) => section.id).join(", "),
);
check(
  "dokumen lama tanpa masukan proyeksi tetap sah (bagiannya dilewati, bukan diisi nol)",
  (() => {
    const { forecast, basket, ...analyticsLama } = INPUT.analytics;
    const dokumenLama = laporanDocument({ ...INPUT, analytics: analyticsLama });
    return (
      forecast !== undefined &&
      basket !== undefined &&
      dokumenLama.sections.length === 13 &&
      !dokumenLama.sections.some((section) => section.id === "analitik-proyeksi")
    );
  })(),
);
check(
  "XLSX: lembar proyeksi & keranjang ikut dibuat",
  laporanSheets(dokumen).some((sheet) => sheet.name === "Proyeksi akhir periode") &&
    laporanSheets(dokumen).some((sheet) => sheet.name === "Ukuran keranjang") &&
    laporanSheets(dokumen).some((sheet) => sheet.name === "Produk sering dibeli bersama"),
  laporanSheets(dokumen).map((sheet) => sheet.name).join(" | "),
);
check(
  "nama berkas per format",
  laporanFileName(dokumen, "pdf") === "laporan-cabang-melati-20261016-1430.pdf" &&
    laporanFileName(dokumen, "xlsx") === "laporan-cabang-melati-20261016-1430.xlsx" &&
    laporanFileName(dokumen, "csv") === "laporan-cabang-melati-20261016-1430.csv",
  laporanFileName(dokumen, "pdf"),
);
check(
  "cap waktu bertulis Indonesia",
  laporanStampLabel(GENERATED_AT) === "16 Okt 2026 14:30",
  laporanStampLabel(GENERATED_AT),
);

/**
 * Pembaca CSV kecil (RFC 4180) dengan pemisah titik koma — dipakai untuk membaca
 * ulang berkasnya. Membandingkan teksnya saja tidak cukup: sel yang kutip gandanya
 * salah tetap “terlihat benar” sebagai teks, tetapi pecah jadi kolom berbeda begitu
 * Excel membukanya.
 */
function bacaCsv(text, separator = LAPORAN_CSV_SEPARATOR) {
  const rows = [];
  let row = [];
  let cell = "";
  let dalamKutip = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (dalamKutip) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          dalamKutip = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      dalamKutip = true;
    } else if (char === separator) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/* ============================================================= 2. CSV ==== */

const csv = laporanCsv(dokumen);
check("CSV diawali BOM UTF-8", csv.startsWith(LAPORAN_CSV_BOM), csv.slice(0, 4));
check("CSV memakai CRLF", csv.includes("\r\n"), "tanpa CRLF");
check("CSV MIME", LAPORAN_CSV_MIME.startsWith("text/csv"), LAPORAN_CSV_MIME);
const csvLines = csv.slice(LAPORAN_CSV_BOM.length).split(LAPORAN_CSV_NEWLINE);
check("CSV baris kepala", csvLines[0] === "Laporan penjualan", csvLines[0]);
check(
  "CSV menyebut ruang kerja & toko",
  csvLines[1] === "Ruang kerja;Pusat Bahan Bangunan" &&
    csvLines[2] === "Toko;Cabang Melati",
  csvLines.slice(1, 3).join(" / "),
);
check(
  "CSV angka uang tanpa pemisah ribuan",
  csvLines.includes("Tunai;7000000;57"),
  csvLines.find((line) => line.startsWith("Tunai")),
);
check(
  "CSV persen metode berjumlah 100",
  csvLines.some((line) => line.startsWith("Jumlah;12345678;100")),
  "baris jumlah metode bayar tidak ada",
);
check(
  "CSV mengutip nama produk bertitik koma",
  csv.includes('"Semen ""Gresik"" 40kg; khusus"'),
  "nama produk tidak dikutip dengan benar",
);
check(
  "CSV memuat judul tiap bagian",
  dokumen.sections.every((section) => csv.includes(`${section.title}${LAPORAN_CSV_NEWLINE}`)),
  "ada judul bagian yang hilang",
);
check(
  "CSV desimal memakai koma",
  csv.includes("Margin kotor (%);36"),
  "baris margin tidak memakai koma desimal",
);
check(
  "CSV baris jumlah pajak sewa",
  csvLines.some((line) => line === "Jumlah;11750000;32;1175000;100000;400000;58750;1500000;58750"),
  csvLines.filter((line) => line.startsWith("Jumlah;1175")).join(" | "),
);
check(
  "CSV memuat ringkasan bahasa awam di kepala berkas",
  csv.includes('Ringkasan;"Toko menerima Rp12.345.678') &&
    csvLines.filter((line) => line.startsWith("Ringkasan;")).length === dokumen.summaryLines.length,
  csvLines.filter((line) => line.startsWith("Ringkasan;")).join(" | ").slice(0, 200),
);
check(
  "CSV menentukan pemisahnya secara eksplisit",
  LAPORAN_CSV_SEPARATOR === ";" && csvLines[0].includes(";") === false,
  LAPORAN_CSV_SEPARATOR,
);

/* Dibaca ulang dengan pembaca CSV sungguhan: hasilnya harus persis sel-selnya. */
const csvRows = bacaCsv(csv.slice(LAPORAN_CSV_BOM.length));
check(
  "CSV dibaca ulang: kepala kolom utuh",
  csvRows.some(
    (row) =>
      row[0] === "Metode bayar" && row[1] === "Omzet (Rp)" && row[2] === "Pangsa (%)",
  ),
  "kepala kolom metode bayar tidak terbaca",
);
const barisProduk = csvRows.find((row) => row[0]?.startsWith("Semen"));
check(
  "CSV dibaca ulang: nama bertanda titik koma tetap satu sel",
  barisProduk !== undefined &&
    barisProduk[0] === 'Semen "Gresik" 40kg; khusus' &&
    barisProduk.length === 6,
  JSON.stringify(barisProduk),
);
check(
  "CSV dibaca ulang: angkanya jadi angka",
  barisProduk !== undefined &&
    Number(barisProduk[3]) === 6600000 &&
    Number(barisProduk[4]) === 53,
  JSON.stringify(barisProduk),
);
check(
  "CSV dibaca ulang: seluruh baris terbaca (akhir berkas diakhiri satu CRLF)",
  csvLines[csvLines.length - 1] === "" && csvRows.length === csvLines.length - 1,
  `${csvRows.length} baris terbaca vs ${csvLines.length} baris teks`,
);
check(
  "CSV dibaca ulang: tidak ada sel yang salah tempat di baris jumlah",
  csvRows.some(
    (row) => row[0] === "Jumlah" && Number(row[1]) === 12345678 && Number(row[2]) === 100,
  ),
  "baris jumlah tidak terbaca utuh",
);

/* ============================================================ 3. XLSX ==== */

const xlsx = laporanXlsx(dokumen);
check("XLSX MIME resmi", LAPORAN_XLSX_MIME.endsWith("spreadsheetml.sheet"), LAPORAN_XLSX_MIME);
check(
  "XLSX diawali header lokal ZIP",
  xlsx[0] === 0x50 && xlsx[1] === 0x4b && xlsx[2] === 0x03 && xlsx[3] === 0x04,
  `${xlsx[0]},${xlsx[1]},${xlsx[2]},${xlsx[3]}`,
);
check(
  "unduhan berulang identik byte-nya",
  decoder.decode(laporanXlsx(dokumen)) === decoder.decode(xlsx),
  "arsipnya berubah antar pemanggilan",
);

/** Membaca ulang arsip ZIP dari byte-nya: direktori pusat + header lokalnya. */
function bacaZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdCari = (() => {
    for (let index = bytes.length - 22; index >= 0; index -= 1) {
      if (view.getUint32(index, true) === 0x06054b50) return index;
    }
    return -1;
  })();
  if (eocdCari < 0) throw new Error("EOCD tidak ditemukan");
  const jumlah = view.getUint16(eocdCari + 10, true);
  const ukuranDirektori = view.getUint32(eocdCari + 12, true);
  const offsetDirektori = view.getUint32(eocdCari + 16, true);
  const entri = [];
  let cursor = offsetDirektori;
  for (let index = 0; index < jumlah; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("entri direktori rusak");
    const crc = view.getUint32(cursor + 16, true);
    const ukuran = view.getUint32(cursor + 24, true);
    const panjangNama = view.getUint16(cursor + 28, true);
    const panjangExtra = view.getUint16(cursor + 30, true);
    const panjangKomentar = view.getUint16(cursor + 32, true);
    const lokal = view.getUint32(cursor + 42, true);
    const nama = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + panjangNama));
    entri.push({ nama, crc, ukuran, lokal });
    cursor += 46 + panjangNama + panjangExtra + panjangKomentar;
  }
  return { jumlah, ukuranDirektori, offsetDirektori, entri, view };
}

const zip = bacaZip(xlsx);
/*
  Bagian wajib: 5 berkas dasar (`[Content_Types].xml`, relasi paket, buku kerja, relasi
  buku kerja, gaya) + satu lembar per sheet + untuk **tiap bagan** empat bagian lagi
  (relasi lembarnya, gambar, relasi gambar, dan bagannya sendiri).
*/
const jumlahBagan = dokumen.charts.length;
check(
  "ZIP: jumlah entri = berkas dasar + lembar + 4 × bagan",
  zip.jumlah === 5 + laporanSheets(dokumen).length + 4 * jumlahBagan,
  `${zip.jumlah} entri untuk ${laporanSheets(dokumen).length} lembar & ${jumlahBagan} bagan`,
);
check(
  "ZIP: direktori pusat diakhiri tepat di EOCD",
  zip.offsetDirektori + zip.ukuranDirektori <= xlsx.length,
  `${zip.offsetDirektori}+${zip.ukuranDirektori} vs ${xlsx.length}`,
);
for (const entri of zip.entri) {
  const offsetData = (() => {
    if (zip.view.getUint32(entri.lokal, true) !== 0x04034b50) throw new Error("header lokal rusak");
    const panjangNama = zip.view.getUint16(entri.lokal + 26, true);
    const panjangExtra = zip.view.getUint16(entri.lokal + 28, true);
    return entri.lokal + 30 + panjangNama + panjangExtra;
  })();
  const isi = xlsx.subarray(offsetData, offsetData + entri.ukuran);
  const metode = zip.view.getUint16(entri.lokal + 8, true);
  const panjangNamaLokal = zip.view.getUint16(entri.lokal + 26, true);
  const namaLokal = decoder.decode(
    xlsx.subarray(entri.lokal + 30, entri.lokal + 30 + panjangNamaLokal),
  );
  check(
    `ZIP: ${entri.nama} utuh (CRC & panjang)`,
    isi.length === entri.ukuran && laporanCrc32(isi) === entri.crc,
    `crc ${laporanCrc32(isi)} vs ${entri.crc}`,
  );
  check(
    `ZIP: ${entri.nama} tanpa pemadatan & namanya sama di dua header`,
    metode === 0 && namaLokal === entri.nama,
    `metode ${metode}, nama "${namaLokal}"`,
  );
}

const bagian = new Map(
  laporanXlsxParts(dokumen).map((part) => [part.name, decoder.decode(part.bytes)]),
);

/**
 * Isi XML satu lembar **berdasarkan namanya**, bukan nomor berkasnya: menambah satu
 * bagian baru di tengah laporan akan menggeser nomor `sheetN.xml`, dan uji yang
 * menempel pada nomor akan menuduh berkas yang salah.
 */
const lembarDari = (namaLembar) => {
  const daftar = laporanSheets(dokumen);
  const index = daftar.findIndex((sheet) => sheet.name === namaLembar);
  return index < 0 ? "" : (bagian.get(`xl/worksheets/sheet${index + 1}.xml`) ?? "");
};
check(
  "XLSX: daftar isi mencantumkan semua lembar",
  laporanSheets(dokumen).every((_sheet, index) =>
    bagian.get("[Content_Types].xml").includes(`/xl/worksheets/sheet${index + 1}.xml`),
  ),
  "ada lembar yang tidak terdaftar",
);
check(
  "XLSX: lembar gaya & relasi ada",
  bagian.has("xl/styles.xml") && bagian.get("xl/_rels/workbook.xml.rels").includes("styles.xml"),
  "styles.xml tidak terhubung",
);
const sheets = laporanSheets(dokumen);
check(
  "XLSX: nama lembar ≤ 31 huruf & unik",
  sheets.every((sheet) => sheet.name.length <= 31) &&
    new Set(sheets.map((sheet) => sheet.name.toLowerCase())).size === sheets.length,
  sheets.map((sheet) => sheet.name).join(" | "),
);
check(
  "XLSX: buku kerja memuat semua lembar",
  sheets.every((sheet) =>
    bagian.get("xl/workbook.xml").includes(`name="${laporanXmlEscape(sheet.name)}"`),
  ),
  "ada lembar yang tidak ada di workbook.xml",
);
/*
  Lembar tabel bertingkat tetap: baris 1 judul, baris 2 kepala kolom, baris 3+
  isinya. Angka uang ditulis sebagai angka (bukan teks “Rp1.234.567”) supaya kolom
  omzetnya bisa langsung dijumlahkan & dibuat pivot.
*/
check(
  "XLSX: angka ditulis sebagai angka (bisa dijumlahkan)",
  lembarDari("Ringkasan periode").includes(`<c r="B3" s="${laporanCellStyleIndex(
    "cell",
    "money",
    "emerald",
  )}"><v>12345678</v></c>`),
  lembarDari("Ringkasan periode").slice(0, 600),
);
check(
  "XLSX: kepala kolom dicetak tebal di atas pita berwarnanya",
  lembarDari("Ringkasan periode").includes(
    `<c r="A2" s="${laporanCellStyleIndex("header", "text", "emerald")}" t="inlineStr">`,
  ) && bagian.get("xl/styles.xml").includes(laporanWarnaArgb(LAPORAN_WARNA.emerald.kepala)),
  lembarDari("Ringkasan periode").slice(0, 300),
);
check(
  "XLSX: baris jumlah dicetak tebal dengan gaya jumlahnya sendiri",
  new RegExp(
    `<c r="A\\d+" s="${laporanCellStyleIndex(
      "total",
      "text",
      "teal",
    )}" t="inlineStr"><is><t xml:space="preserve">Jumlah<\\/t><\\/is><\\/c>`,
  ).test(lembarDari("Omzet per metode bayar")),
  lembarDari("Omzet per metode bayar").slice(0, 900),
);
check(
  "XLSX: baris isi berselang-seling memakai pita tipis",
  lembarDari("Omzet per metode bayar").includes(
    `<c r="A4" s="${laporanCellStyleIndex("band", "text", "teal")}" t="inlineStr">`,
  ) && bagian.get("xl/styles.xml").includes(laporanWarnaArgb(LAPORAN_WARNA.teal.selang)),
  lembarDari("Omzet per metode bayar").slice(0, 900),
);
check(
  "XLSX: baris jumlah diberi garis tebal & pita aksennya",
  bagian
    .get("xl/styles.xml")
    .includes(
      `<top style="medium"><color rgb="${laporanWarnaArgb(LAPORAN_WARNA.teal.garis)}"/>`,
    ) &&
    bagian.get("xl/styles.xml").includes(laporanWarnaArgb(LAPORAN_WARNA.teal.jumlah)) &&
    bagian.get("xl/styles.xml").includes(`count="${7 * 3 * LAPORAN_WARNA_DAFTAR.length}"`),
  bagian.get("xl/styles.xml").slice(0, 200),
);
/*
  Warna **per bagian**: berkas Excel-nya tidak boleh lagi satu warna rata. Yang
  diperiksa bukan “ada banyak warna di styles.xml”, melainkan bahwa tiap lembar
  memakai keluarga warnanya sendiri — pita kepala kolom tiap bagian dihitung ulang
  dari `laporanWarna.ts` (sumber yang sama dengan berkas PDF) lalu dicocokkan dengan
  warna yang benar-benar dipakai selnya di berkas.
*/
{
  const styles = bagian.get("xl/styles.xml");
  const isiXfs = (styles.match(/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/) ?? [])[1] ?? "";
  const xfs = [...isiXfs.matchAll(/<xf [^>]*\/>/g)].map((match) => match[0]);
  const pita = [...styles.matchAll(/<fgColor rgb="FF([0-9A-F]{6})"\/><bgColor indexed="64"\/>/g)].map(
    (match) => match[1],
  );
  // Dua `<fill>` pertama bukan warna (none & gray125), jadi pita ke-n mulai di indeks 0.
  const warnaPitaSel = (styleIndex) => {
    const fillId = Number((xfs[styleIndex]?.match(/fillId="(\d+)"/) ?? [])[1]);
    return pita[fillId - 2] ?? "";
  };
  const gayaKepala = (namaLembar) => {
    const index = sheets.findIndex((sheet) => sheet.name === namaLembar);
    const xml = bagian.get(`xl/worksheets/sheet${index + 1}.xml`) ?? "";
    return Number((xml.match(/<c r="A2" s="(\d+)"/) ?? [])[1]);
  };

  /*
    Cacah (`count="…"`) di `styles.xml` **wajib** sama dengan jumlah elemennya: Excel menolak
    berkas yang cacahnya meleset (atau menawarkan “perbaikan”). Cacah itu dihitung di kode dari
    daftar keluarga warna, jadi gampang meleset begitu keluarganya bertambah — dan melesetnya
    tidak terlihat dari daftar warna.
  */
  const hitungElemen = (wadah, isi) => {
    const dalam = (styles.match(new RegExp(`<${wadah}[^>]*>([\\s\\S]*?)</${wadah}>`)) ?? [])[1] ?? "";
    return [...dalam.matchAll(new RegExp(`<${isi}[ />]`, "g"))].length;
  };
  check(
    "XLSX: cacah bagian gaya cocok dengan isinya (fonts/fills/borders/cellXfs)",
    [
      ["fonts", "font"],
      ["fills", "fill"],
      ["borders", "border"],
      ["cellXfs", "xf"],
    ].every(([wadah, isi]) => {
      const deklarasi = Number(
        (styles.match(new RegExp(`<${wadah} count="(\\d+)"`)) ?? [])[1],
      );
      return deklarasi === hitungElemen(wadah, isi);
    }),
    ["fonts", "fills", "borders", "cellXfs"]
      .map((wadah) => `${wadah} count=${(styles.match(new RegExp(`<${wadah} count="(\\d+)"`)) ?? [])[1]}`)
      .join(", "),
  );
  check(
    "XLSX: setiap keluarga warna punya kepala, pita selang, pita jumlah, dan garis jumlahnya",
    LAPORAN_WARNA_DAFTAR.every((nama) =>
      [LAPORAN_WARNA[nama].kepala, LAPORAN_WARNA[nama].selang, LAPORAN_WARNA[nama].jumlah, LAPORAN_WARNA[nama].garis].every(
        (hex) => styles.includes(laporanWarnaArgb(hex)),
      ),
    ),
    "ada warna keluarga yang tidak ditulis di styles.xml",
  );

  // Lembar berurutan: “Info berkas” dulu, lalu satu lembar per bagian sesuai urutan
  // `dokumen.sections` (lembar grafik menyusul di belakangnya).
  const perBagian = dokumen.sections.map((section, index) => ({
    nama: sheets[index + 1].name,
    keluarga: laporanWarnaNamaBagian(section.id),
    pita: warnaPitaSel(gayaKepala(sheets[index + 1].name)),
  }));
  check(
    "XLSX: pita kepala kolom tiap bagian memakai warna bagiannya sendiri",
    perBagian.length >= 4 &&
      perBagian.every(
        (bagian) => bagian.pita === LAPORAN_WARNA[bagian.keluarga].kepala,
      ),
    perBagian.map((bagian) => `${bagian.nama}=${bagian.pita}`).join(" | "),
  );
  check(
    "XLSX: warnanya benar-benar berbeda antar bagian, bukan satu warna rata",
    new Set(perBagian.map((bagian) => bagian.pita)).size ===
      new Set(perBagian.map((bagian) => bagian.keluarga)).size &&
      new Set(perBagian.map((bagian) => bagian.pita)).size >= 5,
    perBagian.map((bagian) => bagian.pita).join(", "),
  );
}
check(
  "XLSX: kepala kolom dibekukan & tabelnya bisa disaring",
  lembarDari("Pajak & pungutan F&B per bulan").includes('<pane ySplit="2"') &&
    lembarDari("Omzet per metode bayar").includes('<autoFilter ref="A2:'),
  lembarDari("Omzet per metode bayar").slice(0, 400),
);
check(
  "XLSX: keterangan tabel ikut tertulis di bawahnya (di luar rentang saringan)",
  lembarDari("Omzet per metode bayar").includes("Pangsa dihitung dari omzet periode ini"),
  "keterangan bagian hilang",
);
check(
  "XLSX: lembar info memuat ringkasan bahasa awam",
  lembarDari("Info berkas").includes("Ringkasan singkat") &&
    lembarDari("Info berkas").includes("Toko menerima Rp12.345.678"),
  lembarDari("Info berkas").slice(0, 400),
);
check(
  "XLSX: teks di-escape (kutip & tanda pisah panjang aman)",
  lembarDari("Produk teratas").includes("Semen &quot;Gresik&quot; 40kg; khusus"),
  lembarDari("Produk teratas").slice(0, 800),
);
check(
  "XLSX: catatan kepala berkas ikut tertulis",
  lembarDari("Info berkas").includes("Semua angka berasal dari data aplikasi MesinPOS"),
  lembarDari("Info berkas").slice(0, 800),
);
check(
  "XLSX: XML setiap bagian berpasangan",
  [...bagian.values()].every(
    (xml) =>
      xml.startsWith("<?xml") &&
      (xml.match(/<row /g) ?? []).length === (xml.match(/<\/row>/g) ?? []).length,
  ),
  "ada XML yang tidak seimbang",
);
check(
  "XLSX: dokumen kosong tetap sah (tetap ada lembar)",
  bacaZip(laporanXlsx(dokumenKosong)).jumlah === 5 + laporanSheets(dokumenKosong).length,
  "arsip dokumen kosong salah",
);
check(
  "XLSX: berita “belum ada data” tertulis di lembarnya",
  decoder
    .decode(laporanXlsx(dokumenKosong))
    .includes("Belum ada data pada periode ini."),
  "kalimat “belum ada data” tidak ada",
);

/* ============================================================= 4. PDF ==== */

/**
 * Byte PDF → teks **Latin-1** (bukan UTF-8): setiap byte berkas PDF adalah satu
 * karakter, jadi offset xref-nya bisa dibandingkan langsung dengan panjang string.
 * Membacanya sebagai UTF-8 akan mengganti byte di atas 0x7f dengan tanda pengganti
 * dan menggeser semua offset — harness-nya yang salah, bukan berkasnya.
 */
function latin1(bytes) {
  let out = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return out;
}

const pdf = laporanPdfBytes(dokumen);
const pdfText = latin1(pdf);

/**
 * Teks PDF tanpa escape kurung/garis miring — untuk memeriksa **isi** bacaan.
 * Di dalam berkasnya, tanda kurung memang ditulis `\(` supaya tidak membingungkan
 * pembaca PDF; yang dicari orang tetap teks aslinya.
 */
const pdfPlain = pdfText.replace(/\\([()\\])/g, "$1");
check(
  "PDF: bagian proyeksi & keranjang benar-benar tercetak di berkasnya",
  (() => {
    const semua = laporanPdfPages(dokumen).flatMap((page) => page.text);
    return (
      semua.some((baris) => baris.includes("Proyeksi akhir periode")) &&
      semua.some((baris) => baris.includes("Ukuran keranjang")) &&
      semua.some((baris) => baris.includes("Produk sering dibeli bersama")) &&
      semua.some((baris) => baris.includes("Kebiasaan berulang"))
    );
  })(),
  "judul bagian enterprise tidak ada di aliran isi",
);
check("PDF punya header %PDF-", pdfText.startsWith("%PDF-1.4"), pdfText.slice(0, 8));
check("PDF diakhiri %%EOF", pdfText.trimEnd().endsWith("%%EOF"), pdfText.slice(-20));
check(
  "PDF: ukuran halaman A4 tegak",
  pdfText.includes(`/MediaBox [0 0 ${Number(LAPORAN_PDF_WIDTH_PT.toFixed(3))} ${Number(LAPORAN_PDF_HEIGHT_PT.toFixed(3))}]`),
  (pdfText.match(/MediaBox \[[^\]]+\]/) ?? []).join(" "),
);
check(
  "PDF: /Count sama dengan jumlah halaman",
  pdfText.includes(`/Count ${laporanPdfPages(dokumen).length}`),
  (pdfText.match(/\/Count \d+/) ?? []).join(" "),
);

/** Memeriksa tabel xref: tiap entri harus menunjuk “N 0 obj” yang benar. */
{
  const startxref = Number((pdfText.match(/startxref\n(\d+)/) ?? [])[1]);
  check("PDF: startxref menunjuk tabel xref", pdfText.startsWith("xref", startxref), pdfText.slice(startxref, startxref + 20));
  const baris = pdfText.slice(startxref).split("\n");
  // baris[0] = "xref", baris[1] = "0 <jumlah>", baris[2] = entri objek 0 (bebas),
  // jadi entri objek ke-i ada di baris[2 + i].
  const jumlah = Number(baris[1].split(" ")[1]);
  let cacat = 0;
  for (let index = 1; index < jumlah; index += 1) {
    const offset = Number(baris[2 + index].slice(0, 10));
    if (!pdfText.startsWith(`${index} 0 obj`, offset)) cacat += 1;
  }
  check("PDF: offset xref menunjuk objek yang benar", cacat === 0, `${cacat} entri meleset`);
}
{
  let salah = 0;
  const streamRe = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g;
  let match;
  while ((match = streamRe.exec(pdfText)) !== null) {
    if (Number(match[1]) !== match[2].length) salah += 1;
  }
  check("PDF: /Length sama dengan panjang aliran isinya", salah === 0, `${salah} aliran meleset`);
}
check(
  "PDF: angka uang ber-pemisah ribuan",
  pdfPlain.includes("12.345.678") && pdfPlain.includes("293.945"),
  "angka uang tidak berformat",
);
check(
  "PDF: judul, ruang kerja, toko, dan periode tertulis di kepala berkas",
  pdfPlain.includes("Laporan penjualan") &&
    pdfPlain.includes("Workspace Pusat Bahan Bangunan") &&
    pdfPlain.includes("Toko Cabang Melati") &&
    pdfPlain.includes("Periode 16 Okt 2026"),
  "kepala berkas tidak lengkap",
);
check("PDF: nomor halaman tertulis", pdfPlain.includes("halaman 1 dari"), "kaki halaman tidak ada");
check(
  "PDF: huruf di luar Latin-1 diterjemahkan, bukan jadi tanda tanya",
  pdfPlain.includes("Cat Tembok - Putih") && !pdfPlain.includes("Cat Tembok ? Putih"),
  "tanda pisah panjang tidak diterjemahkan",
);
/*
  Kepala kolom ditulis huruf besar, per **kata**: kolom yang sempit boleh menurunkan
  kata terakhirnya ke baris kedua (lebih baik daripada dipotong sampai tak bernama),
  jadi yang dicari bukan lagi satu kalimat utuh "METODE BAYAR" di aliran isi.
*/
check(
  "PDF: kepala kolom tabel memakai huruf besar, bukan huruf kecil",
  (() => {
    const kataKepala = [
      ...new Set(
        dokumen.sections
          .filter((section) => section.total)
          .flatMap((section) => section.headers)
          .flatMap((header) => laporanPdfText(header.toUpperCase()).split(/\s+/)),
      ),
    ].filter((kata) => kata.length >= 3);
    const hilang = kataKepala.filter((kata) => !pdfPlain.includes(kata));
    return kataKepala.length >= 4 && hilang.length === 0;
  })(),
  (() => {
    const kataKepala = [
      ...new Set(
        dokumen.sections
          .filter((section) => section.total)
          .flatMap((section) => section.headers)
          .flatMap((header) => laporanPdfText(header.toUpperCase()).split(/\s+/)),
      ),
    ].filter((kata) => kata.length >= 3);
    return `kepala kolom yang tidak muncul: ${kataKepala
      .filter((kata) => !pdfPlain.includes(kata))
      .join(", ")}`;
  })(),
);
/**
 * Membaca **aliran isi tiap halaman** sebagai deretan gambar: bentuk (isian `f` atau
 * garis tepi `S`) dan teks (`Tj`), urut menggambar. Dari situ tata letaknya bisa
 * diperiksa tanpa membuka berkasnya di pembaca PDF — apakah kartunya bersudut bulat,
 * apakah pitanya selebar tabelnya, apakah ada huruf yang tertimpa, dan apakah
 * warnanya cukup kontras.
 *
 * Kepekatan (`/A08 gs`) ikut dibaca: sejak warna bagiannya setengah tembus pandang
 * seperti di halaman (`bg-emerald-500/[0.08]`), latar yang terlihat bukan lagi warna
 * pitanya sendiri. Latar efektifnya dihitung dengan menumpuk semua pita di belakang
 * hurufnya di atas kertas putih — tanpa itu, huruf di atas rona tipis akan dinilai
 * tidak kontras padahal justru di situ kontrasnya paling baik.
 */
function bacaAliran(stream) {
  const bentuk = [];
  const teks = [];
  const tumpukan = [];
  let state = { isi: [0, 0, 0], garis: [0, 0, 0], lebar: 0.8, alfa: 1 };
  let jalur = null;
  let urutan = 0;
  /**
   * Bentuk yang selesai → kotak pembatasnya (lengkungan dihitung dari titik kendalinya),
   * beserta **perintah jalurnya** (`m`/`l`/`c`) supaya lengkungnya bisa ditelusuri titik
   * demi titik saat memeriksa apakah pita tepi masih di dalam lengkung kotaknya.
   */
  const tutup = (jenis) => {
    if (!jalur || jalur.titik.length === 0) return;
    const xs = jalur.titik.map((titik) => titik[0]);
    const ys = jalur.titik.map((titik) => titik[1]);
    bentuk.push({
      jenis,
      melengkung: jalur.melengkung,
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
      warna: jenis === "isi" ? [...state.isi] : [...state.garis],
      lebar: state.lebar,
      alfa: state.alfa,
      perintah: jalur.perintah,
      urutan: urutan++,
    });
  };
  for (const op of stream.split("\n")) {
    let m;
    if (op === "q") {
      tumpukan.push({ ...state, isi: [...state.isi], garis: [...state.garis] });
    } else if (op === "Q") {
      state = tumpukan.pop() ?? state;
    } else if ((m = /^\/(A\d+) gs$/.exec(op))) {
      state.alfa = Number(m[1].slice(1)) / 100;
    } else if ((m = /^([\d.]+) ([\d.]+) ([\d.]+) rg$/.exec(op))) {
      state.isi = [+m[1], +m[2], +m[3]];
    } else if ((m = /^([\d.]+) ([\d.]+) ([\d.]+) RG$/.exec(op))) {
      state.garis = [+m[1], +m[2], +m[3]];
    } else if ((m = /^([\d.]+) w$/.exec(op))) {
      state.lebar = +m[1];
    } else if ((m = /^(-?[\d.]+) (-?[\d.]+) m$/.exec(op))) {
      jalur = { titik: [[+m[1], +m[2]]], perintah: ["m", +m[1], +m[2]], melengkung: false };
    } else if ((m = /^(-?[\d.]+) (-?[\d.]+) l$/.exec(op))) {
      jalur?.titik.push([+m[1], +m[2]]);
      jalur?.perintah.push("l", +m[1], +m[2]);
    } else if (
      (m = /^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) c$/.exec(op))
    ) {
      if (jalur) {
        jalur.melengkung = true;
        jalur.titik.push([+m[1], +m[2]], [+m[3], +m[4]], [+m[5], +m[6]]);
        jalur.perintah.push("c", +m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
      }
    } else if (op === "f") {
      tutup("isi");
      jalur = null;
    } else if (op === "S") {
      tutup("garis");
      jalur = null;
    } else if (
      (m = /^BT \/(F\d) ([\d.]+) Tf ([\d.]+) Tc 1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm \((.*)\) Tj ET$/.exec(op))
    ) {
      const isi = m[6].replace(/\\([()\\])/g, "$1");
      teks.push({
        isi,
        ukuran: +m[2],
        tebal: m[1] === "F2",
        // Lebarnya diukur dengan tabel lebar huruf Helvetica yang sama dengan penulis
        // berkasnya (termasuk jarak antar huruf `Tc`), jadi pemeriksaan tumpang-tindih
        // dan kontras tidak menebak lebarnya.
        lebar:
          laporanPdfTextWidth(isi, +m[2], m[1] === "F2") + Math.max(0, isi.length - 1) * +m[3],
        x: +m[4],
        y: +m[5],
        warna: [...state.isi],
        alfa: state.alfa,
        urutan: urutan++,
      });
    }
  }
  return { bentuk, teks };
}

const streams = [...pdfText.matchAll(/<< \/Length \d+ >>\nstream\n([\s\S]*?)\nendstream/g)].map(
  (match) => match[1],
);
const gambar = streams.map((stream) => bacaAliran(stream));
/** Halaman (unit & teksnya) — dipakai pemeriksaan tata letak, tinta, dan gambar bagan. */
const halaman = laporanPdfPages(dokumen);
const semuaBentuk = gambar.flatMap((halamanAliran) => halamanAliran.bentuk);
const semuaTeks = gambar.flatMap((halamanAliran, halaman) =>
  halamanAliran.teks.map((teks) => ({ ...teks, halaman })),
);

check(
  "PDF: aliran isi terbaca sebagai gambar (bentuk & teks)",
  gambar.every(
    (halamanAliran) => halamanAliran.bentuk.length > 8 && halamanAliran.teks.length > 4,
  ) &&
    semuaBentuk.length > 60 &&
    semuaTeks.length > 80,
  gambar
    .map(
      (halamanAliran) =>
        `${halamanAliran.bentuk.length} bentuk/${halamanAliran.teks.length} teks`,
    )
    .join(", "),
);

/*
  Warna: yang diperiksa bukan “ada warna di berkasnya”, melainkan bahwa tiap bagian
  memakai warnanya sendiri. Nadanya dibandingkan sebagai **nilai** — operator PDF
  menyimpan hasil pembulatan tiga angka di belakang koma — bukan sebagai tulisan.
*/
const keRgb = (hex) =>
  [0, 2, 4].map((posisi) => Number.parseInt(hex.slice(posisi, posisi + 2), 16) / 255);
const warnaHeks = (warna, hex) =>
  warna.length === 3 &&
  warna.every((nilai, index) => Math.abs(nilai - keRgb(hex)[index]) < 0.003);
const nadaKeluarga = (warna, ambil) =>
  LAPORAN_WARNA_DAFTAR.some((nama) => warnaHeks(warna, ambil(LAPORAN_WARNA[nama])));

const keluargaBagian = [
  ...new Set(dokumen.sections.map((section) => laporanWarnaNamaBagian(section.id))),
];
const warnaAdaDiBerkas = (nama, peran) =>
  pdfText.includes(`${laporanWarnaPdf(LAPORAN_WARNA[nama][peran])} rg`);
check(
  "PDF: tiap bagian memakai pitanya sendiri (warna judul, rona, dan garis aksen), bukan satu warna rata",
  keluargaBagian.length >= 5 &&
    new Set(keluargaBagian.map((nama) => LAPORAN_WARNA[nama].kepala)).size ===
      keluargaBagian.length &&
    keluargaBagian.every(
      (nama) =>
        warnaAdaDiBerkas(nama, "bagian") &&
        warnaAdaDiBerkas(nama, "selang") &&
        warnaAdaDiBerkas(nama, "garis"),
    ),
  keluargaBagian
    .filter(
      (nama) =>
        !["bagian", "selang", "garis"].every((peran) => warnaAdaDiBerkas(nama, peran)),
    )
    .join(", "),
);
check(
  "PDF: tabel tiap bagian memakai pita kepala kolom & baris jumlah nadanya sendiri",
  (() => {
    const denganTabel = [
      ...new Set(
        dokumen.sections
          .filter((section) => section.total && section.headers.length > 1)
          .map((section) => laporanWarnaNamaBagian(section.id)),
      ),
    ];
    return (
      denganTabel.length >= 3 &&
      denganTabel.every(
        (nama) => warnaAdaDiBerkas(nama, "kepala") && warnaAdaDiBerkas(nama, "jumlah"),
      )
    );
  })(),
  "pita kepala kolom/baris jumlah tidak berbeda antar bagian",
);
check(
  "PDF: satu keluarga warna memakai lima nada berbeda untuk lima perannya",
  LAPORAN_WARNA_DAFTAR.every((nama) => {
    const warna = LAPORAN_WARNA[nama];
    return (
      new Set([warna.bagian, warna.kepala, warna.selang, warna.jumlah, warna.garis]).size === 5
    );
  }),
  "ada nada yang dipakai untuk dua peran sekaligus",
);

/* ---------- kartu & tabel ---------- */

/** Kartu: isian putih bersudut bulat yang selebar isi halaman (bukan selebar pitanya). */
const kartuDiHalaman = gambar.map((halamanAliran) =>
  halamanAliran.bentuk.filter(
    (bentuk) =>
      bentuk.jenis === "isi" &&
      bentuk.melengkung &&
      warnaHeks(bentuk.warna, LAPORAN_PDF_WARNA.kartu) &&
      bentuk.w >= LAPORAN_PDF_WIDTH_PT - 2 * LAPORAN_PDF_MARGIN_PT - 0.5 &&
      // Lebih tinggi dari pita selang-seling (15,5 pt): ini rangka kartu, bukan baris tabel.
      bentuk.h > 20,
  ),
);
check(
  "PDF: tiap halaman memuat kartu putih bersudut bulat selebar isi halaman",
  kartuDiHalaman.every((kartu) => kartu.length >= 1) &&
    kartuDiHalaman.flat().length >= laporanPdfPages(dokumen).length,
  kartuDiHalaman.map((kartu, halaman) => `h${halaman + 1}:${kartu.length}`).join(" "),
);
/**
 * Batang bagan, diambil dari **op gambarnya sendiri** (bukan dari aliran isi): hanya
 * unit bagan yang diperiksa, jadi 8×8 pt penanda daftar isi yang kebetulan memakai nada
 * yang sama tidak ikut terhitung sebagai batang. Tinggi tiap batang dan warnanya dibaca
 * dari op `kotak` yang digambar unit itu.
 */
const nadaBatang = new Set(
  LAPORAN_WARNA_DAFTAR.flatMap((nama) => LAPORAN_WARNA[nama].batang.map((hex) => hex.toUpperCase())),
);
const opsBagan = halaman.flatMap((page) => {
  const daftar = [];
  let atas = LAPORAN_PDF_HEIGHT_PT - LAPORAN_PDF_MARGIN_PT;
  for (const unit of page.units) {
    if (unit.peran === "bagan") daftar.push(...unit.gambar(atas));
    atas -= unit.tinggi;
  }
  return daftar;
});
const batangBentuk = opsBagan.filter(
  (op) =>
    op.t === "kotak" &&
    op.isi !== undefined &&
    nadaBatang.has(op.isi.toUpperCase()) &&
    op.h > 1 &&
    op.h < 200,
);
const tinggiBatang = new Set(batangBentuk.map((op) => Math.round(op.h)));

/**
 * Pita tabel: pita bernada yang tingginya masuk akal untuk sebuah baris (4–60 pt) —
 * jadi aksen 1,4–2,6 pt dan batang bagan tidak ikut terhitung sebagai “pita”.
 */
const pitaTabel = semuaBentuk.filter(
  (bentuk) =>
    bentuk.jenis === "isi" &&
    bentuk.h > 4 &&
    bentuk.h < 60 &&
    (nadaKeluarga(bentuk.warna, (keluarga) => keluarga.kepala) ||
      nadaKeluarga(bentuk.warna, (keluarga) => keluarga.jumlah) ||
      nadaKeluarga(bentuk.warna, (keluarga) => keluarga.selang)),
);
const lebarPitaTabel = [...new Set(pitaTabel.map((bentuk) => Math.round(bentuk.w * 10) / 10))];
check(
  "PDF: tiap unit isi tahu kartu pemiliknya (jadi tiap kartu benar-benar berangka)",
  halaman.every((page) =>
    page.units
      .filter((unit) => unit.peran !== "kaki")
      .every((unit) => unit.kartu !== undefined),
  ),
  halaman
    .map((page, index) => {
      const tanpaKartu = page.units.filter(
        (unit) => unit.peran !== "kaki" && unit.kartu === undefined,
      ).length;
      return `h${index + 1}: ${tanpaKartu} unit tanpa kartu`;
    })
    .join(" "),
);
check(
  "PDF: tiap unit tingginya cukup untuk isinya (isi tidak keluar dari kotak unitnya)",
  (() => {
    const keluar = [];
    halaman.forEach((page, halamanKe) => {
      let atas = LAPORAN_PDF_HEIGHT_PT - LAPORAN_PDF_MARGIN_PT;
      for (const unit of page.units) {
        const bawah = atas - unit.tinggi;
        for (const op of unit.gambar(atas)) {
          if (op.t === "poli") continue;
          const yAtas = op.t === "teks" ? op.y - op.ukuran : op.y + op.h;
          const yBawah = op.t === "teks" ? op.y + op.ukuran * 0.25 : op.y;
          if (yAtas > atas + 0.5 || yBawah < bawah - 0.5) {
            keluar.push(
              `${unit.peran} h${halamanKe + 1} (${yAtas.toFixed(1)}..${yBawah.toFixed(
                1,
              )} di kotak ${atas.toFixed(1)}..${bawah.toFixed(1)})`,
            );
            break;
          }
        }
        atas = bawah;
      }
    });
    return keluar.length === 0;
  })(),
  (() => {
    const keluar = [];
    halaman.forEach((page, halamanKe) => {
      let atas = LAPORAN_PDF_HEIGHT_PT - LAPORAN_PDF_MARGIN_PT;
      for (const unit of page.units) {
        const bawah = atas - unit.tinggi;
        for (const op of unit.gambar(atas)) {
          if (op.t === "poli") continue;
          const yAtas = op.t === "teks" ? op.y - op.ukuran : op.y + op.h;
          const yBawah = op.t === "teks" ? op.y + op.ukuran * 0.25 : op.y;
          if (yAtas > atas + 0.5 || yBawah < bawah - 0.5) {
            keluar.push(
              `${unit.peran} h${halamanKe + 1} (${yAtas.toFixed(1)}..${yBawah.toFixed(
                1,
              )} di kotak ${atas.toFixed(1)}..${bawah.toFixed(1)})`,
            );
            break;
          }
        }
        atas = bawah;
      }
    });
    return keluar.slice(0, 5).join(" | ");
  })(),
);
check(
  "PDF: pita tabel (kepala, selang-seling, jumlah) selebar tabelnya, bukan selebar halaman",
  pitaTabel.length >= 6 &&
    lebarPitaTabel.length >= 2 &&
    lebarPitaTabel.every(
      (lebar) => lebar < LAPORAN_PDF_WIDTH_PT - 2 * LAPORAN_PDF_MARGIN_PT - 0.5,
    ),
  `${pitaTabel.length} pita, lebar ${lebarPitaTabel.join("/")} (isi halaman ${
    LAPORAN_PDF_WIDTH_PT - 2 * LAPORAN_PDF_MARGIN_PT
  })`,
);
/*
  Pita tepi (pita warna di tepi atas kartu, petak angka, kotak temuan, dan kepala berkas)
  digambar sebagai **potongan tepi kotaknya**: lengkung sudut kotaknya dipotong tepat di
  tepi sabuk pitanya. Diperiksa dari jalur yang benar-benar ditulis ke aliran isi halaman,
  bukan dari niat penulisnya: tiap titik pita (termasuk titik di sepanjang kurvanya)
  harus berada di dalam lengkung kotak yang dipitanya.
*/

/** Titik-titik sepanjang satu jalur: titik ujungnya, dan kurvanya dijaraki. */
function titikJalur(perintah, langkah) {
  const titik = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < perintah.length; i += 1) {
    if (perintah[i] === "m" || perintah[i] === "l") {
      [x, y] = [perintah[i + 1], perintah[i + 2]];
      titik.push([x, y]);
      i += 2;
    } else if (perintah[i] === "c") {
      const [x1, y1, x2, y2, x3, y3] = perintah.slice(i + 1, i + 7);
      for (let nomor = 1; nomor <= langkah; nomor += 1) {
        const t = nomor / langkah;
        const s = 1 - t;
        titik.push([
          s ** 3 * x + 3 * s ** 2 * t * x1 + 3 * s * t ** 2 * x2 + t ** 3 * x3,
          s ** 3 * y + 3 * s ** 2 * t * y1 + 3 * s * t ** 2 * y2 + t ** 3 * y3,
        ]);
      }
      [x, y] = [x3, y3];
      i += 6;
    }
  }
  return titik;
}

/** Titik di dalam poligon (ray casting), atau paling jauh `toleransi` dari sisinya. */
function dalamPoligon(titik, poligon, toleransi) {
  const [px, py] = titik;
  let dalam = false;
  for (let i = 0, j = poligon.length - 1; i < poligon.length; j = i, i += 1) {
    const [xi, yi] = poligon[i];
    const [xj, yj] = poligon[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) dalam = !dalam;
    const dx = xj - xi;
    const dy = yj - yi;
    const panjang2 = dx * dx + dy * dy;
    const t = panjang2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - xi) * dx + (py - yi) * dy) / panjang2));
    if (Math.hypot(px - (xi + t * dx), py - (yi + t * dy)) <= toleransi) return true;
  }
  return dalam;
}

const pitaKeluar = [];
gambar.forEach((aliran, halamanKe) => {
  // Kotak bersudut bulat yang bisa dipitai: kartu, petak angka, kotak catatan/temuan,
  // kotak bagan, dan kepala tabel.
  const induk = aliran.bentuk.filter(
    (bentuk) => bentuk.jenis === "isi" && bentuk.melengkung && bentuk.h > 20 && bentuk.w > 100,
  );
  const poligon = induk.map((bentuk) => titikJalur(bentuk.perintah, 24));
  for (const bentuk of aliran.bentuk) {
    // Pita itu tipis: kalau lebarnya **dan** tingginya besar, itu kotak, bukan pita.
    if (bentuk.jenis !== "isi" || (bentuk.w > 8 && bentuk.h > 8)) continue;
    induk.forEach((kotak, nomor) => {
      const menempel =
        bentuk.x >= kotak.x - 6 &&
        bentuk.x + bentuk.w <= kotak.x + kotak.w + 6 &&
        bentuk.y >= kotak.y - 6 &&
        bentuk.y + bentuk.h <= kotak.y + kotak.h + 6;
      if (!menempel) return;
      const keluar = titikJalur(bentuk.perintah, 8).filter(
        (titik) => !dalamPoligon(titik, poligon[nomor], 0.15),
      );
      if (keluar.length > 0) {
        pitaKeluar.push(
          `halaman ${halamanKe + 1}: pita ${bentuk.w.toFixed(1)}x${bentuk.h.toFixed(1)} pt di ` +
            `(${bentuk.x.toFixed(1)},${bentuk.y.toFixed(1)}) keluar ${keluar.length} titik ` +
            `(mis. ${keluar[0].map((nilai) => nilai.toFixed(1)).join(",")}) dari kotak ` +
            `${kotak.w.toFixed(1)}x${kotak.h.toFixed(1)} pt di (${kotak.x.toFixed(1)},${kotak.y.toFixed(1)})`,
        );
      }
    });
  }
});
check(
  "PDF: pita tepi tidak keluar dari lengkung kotaknya (pita mengikuti sudut kotaknya)",
  pitaKeluar.length === 0,
  pitaKeluar.slice(0, 4).join(" | "),
);

check(
  "PDF: baris selang-seling memakai pita tipis setengah tembus pandang, bukan latar putih",
  semuaBentuk.filter(
    (bentuk) =>
      bentuk.jenis === "isi" &&
      bentuk.h <= 15.5 &&
      bentuk.alfa < 1 &&
      nadaKeluarga(bentuk.warna, (keluarga) => keluarga.selang),
  ).length >= 4,
  `${semuaBentuk.filter((bentuk) => bentuk.alfa < 1).length} bentuk setengah tembus pandang`,
);
check(
  "PDF: baris jumlah diberi garis tebal beraksen di tepi atas pitanya",
  semuaBentuk.filter(
    (bentuk) =>
      bentuk.jenis === "isi" &&
      bentuk.h <= 2 &&
      bentuk.w > 100 &&
      nadaKeluarga(bentuk.warna, (keluarga) => keluarga.garis),
  ).length >= 2,
  "garis tebal baris jumlah tidak digambar",
);
check(
  "PDF: halaman pertama memuat pil LAPORAN, daftar isi, dan ringkasan bahasa awam",
  (() => {
    const teksPertama = laporanPdfPages(dokumen)[0].text;
    return (
      teksPertama.includes("LAPORAN") &&
      teksPertama.includes("Daftar isi") &&
      teksPertama.some((baris) => baris.startsWith("Toko menerima Rp12.345.678")) &&
      teksPertama.some((baris) => baris.includes("Ringkasan singkat"))
    );
  })(),
  "kepala berkas tidak lengkap",
);
/* ---------- keterbacaan ---------- */

/**
 * Kotak huruf satu teks, mengikuti ukuran hurufnya yang sebenarnya: dari 0,25 em di
 * bawah garis dasarnya (ekor huruf `g`, `y`, `p`) sampai 0,75 em di atasnya (huruf besar
 * & batang huruf `b`, `d`, `k`). Model yang longgar — mis. menganggap hurufnya menempati
 * satu em penuh — membuat tulisan yang **benar-benar** bertumpuk lolos dari pemeriksaan,
 * dan jarak garis dasar saja tidak cukup: judul 12,5 pt dan baris kecil 7,2 pt bisa
 * tampak “berjarak” 7 pt padahal ekornya sudah saling menyentuh.
 */
const kotakTeks = (teks) => ({
  x: teks.x,
  y: teks.y - teks.ukuran * 0.25,
  w: teks.lebar,
  h: teks.ukuran,
});
const bertumpuk = (a, b) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.05 &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.05;
const lum = ([r, g, b]) => {
  const kanal = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
};
const kontras = (a, b) => {
  const [terang, gelap] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (terang + 0.05) / (gelap + 0.05);
};
/**
 * Latar efektif satu teks: semua isian yang menaungi hurufnya, ditumpuk urut
 * menggambar di atas kertas putih — kepekatannya ikut dihitung. Inilah warna yang
 * benar-benar dilihat mata, bukan warna pitanya sebelum ditumpuk.
 */
const latarEfektif = (teks) => {
  const kotak = kotakTeks(teks);
  let latar = [1, 1, 1];
  for (const bentuk of gambar[teks.halaman].bentuk) {
    if (bentuk.jenis !== "isi" || bentuk.urutan > teks.urutan) continue;
    if (
      bentuk.x - 0.5 > kotak.x ||
      kotak.x + kotak.w > bentuk.x + bentuk.w + 0.5 ||
      bentuk.y - 0.5 > kotak.y ||
      kotak.y + kotak.h > bentuk.y + bentuk.h + 0.5
    ) {
      continue;
    }
    latar = latar.map(
      (nilai, index) => nilai * (1 - bentuk.alfa) + bentuk.warna[index] * bentuk.alfa,
    );
  }
  return latar;
};

const tertimpa = semuaTeks.filter((teks) =>
  gambar[teks.halaman].bentuk.some(
    (bentuk) => bentuk.urutan > teks.urutan && bertumpuk(bentuk, kotakTeks(teks)),
  ),
);
check(
  "PDF: tidak ada huruf yang tertimpa bentuk yang digambar setelahnya",
  tertimpa.length === 0,
  tertimpa
    .slice(0, 4)
    .map((teks) => {
      const penutup = gambar[teks.halaman].bentuk.filter(
        (bentuk) => bentuk.urutan > teks.urutan && bertumpuk(bentuk, kotakTeks(teks)),
      );
      return (
        `${teks.isi} (halaman ${teks.halaman + 1}, ${teks.ukuran}pt, urutan ${teks.urutan}) ditimpa ` +
        penutup
          .slice(0, 2)
          .map(
            (bentuk) =>
              `${bentuk.jenis} ${bentuk.w.toFixed(1)}x${bentuk.h.toFixed(1)} di ` +
              `(${bentuk.x.toFixed(1)},${bentuk.y.toFixed(1)}) warna ${bentuk.warna
                .map((nilai) => nilai.toFixed(3))
                .join(",")} alfa ${bentuk.alfa}`,
          )
          .join(" + ")
      );
    })
    .join(" | "),
);
/**
 * Huruf yang saling menimpa — bukan cuma huruf yang tertimpa bentuk. Baris keterangan yang
 * digambar tepat di bawah judulnya (kursor cuma dimajukan setinggi kotak ikonnya) terbaca
 * sebagai judul yang dicoret, dan tidak terlihat sama sekali dari daftar baris teksnya.
 */
const teksBertumpuk = [];
halaman.forEach((page, halamanKe) => {
  const daftar = gambar[halamanKe].teks;
  for (let satu = 0; satu < daftar.length; satu += 1) {
    for (let dua = satu + 1; dua < daftar.length; dua += 1) {
      const a = kotakTeks(daftar[satu]);
      const b = kotakTeks(daftar[dua]);
      const lebarTumpang =
        Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const tinggiTumpang =
        Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (lebarTumpang > 0.5 && tinggiTumpang > 0.5) {
        teksBertumpuk.push(
          `“${daftar[satu].isi}” ↔ “${daftar[dua].isi}” (halaman ${halamanKe + 1}, ` +
            `${tinggiTumpang.toFixed(1)} pt)`,
        );
      }
    }
  }
});
check(
  "PDF: tidak ada dua tulisan yang saling menimpa",
  teksBertumpuk.length === 0,
  teksBertumpuk.slice(0, 4).join(" | "),
);

const kurangKontras = semuaTeks
  .map((teks) => ({ teks, latar: latarEfektif(teks) }))
  .map((row) => ({ ...row, rasio: kontras(row.teks.warna, row.latar) }))
  .filter((row) => row.rasio < 4.5);
check(
  "PDF: huruf terbaca di atas latarnya (kontras minimal 4,5:1)",
  kurangKontras.length === 0,
  kurangKontras
    .slice(0, 3)
    .map(
      (row) =>
        `${row.teks.isi} (${row.rasio.toFixed(2)}:1 di halaman ${row.teks.halaman + 1}, ` +
        `huruf ${row.teks.ukuran}, tinta ${row.teks.warna
          .map((nilai) => nilai.toFixed(2))
          .join("/")}, latar ${row.latar.map((nilai) => nilai.toFixed(2)).join("/")})`,
    )
    .join(" | "),
);
check(
  "PDF: tidak ada tulisan yang melewati tepi halaman",
  semuaTeks.every(
    (teks) =>
      teks.x >= LAPORAN_PDF_MARGIN_PT - 0.5 &&
      teks.x + teks.lebar <= LAPORAN_PDF_WIDTH_PT - LAPORAN_PDF_MARGIN_PT + 0.5,
  ),
  semuaTeks
    .filter(
      (teks) =>
        teks.x < LAPORAN_PDF_MARGIN_PT - 0.5 ||
        teks.x + teks.lebar > LAPORAN_PDF_WIDTH_PT - LAPORAN_PDF_MARGIN_PT + 0.5,
    )
    .slice(0, 3)
    .map((teks) => `${teks.isi} (${Math.round(teks.x)}..${Math.round(teks.x + teks.lebar)})`)
    .join(" | "),
);

check(
  "ringkasan bahasa awam diturunkan dari masukan yang sama",
  (() => {
    const ringkas = laporanRingkasanSingkat({
      summary: INPUT.summary,
      methods: INPUT.methods,
      fnb: INPUT.fnb,
      analytics: INPUT.analytics,
      franchise: INPUT.franchise,
    });
    const kosong = laporanRingkasanSingkat({ summary: KOSONG.summary, methods: [] });
    return (
      ringkas.length >= 4 &&
      dokumen.summaryLines.join(" ") === ringkas.join(" ") &&
      ringkas.some((line) => line.includes(laporanUang(INPUT.summary.revenue))) &&
      ringkas.some((line) => line.includes("Paling banyak dibayar lewat Tunai")) &&
      kosong.length === 1 &&
      kosong[0].startsWith("Belum ada penjualan")
    );
  })(),
  dokumen.summaryLines.join(" | ").slice(0, 240),
);

/* ======================================================= 5. paginasi ==== */

check("PDF banyak halaman: > 1 halaman untuk laporan lengkap", halaman.length > 1, halaman.length);
check(
  "PDF: tiap halaman dibuka kepalanya (pil LAPORAN di halaman pertama, “(lanjutan)” di berikutnya)",
  halaman.every((page, index) =>
    index === 0
      ? page.text[0] === "LAPORAN" && page.text.includes("Laporan penjualan")
      : page.text[0] === "Laporan penjualan (lanjutan)",
  ),
  halaman.map((page) => page.text[0]).join(" | "),
);
check(
  "PDF: tiap halaman punya kaki nomor halaman",
  halaman.every((page) => /halaman \d+ dari \d+$/.test(page.text[page.text.length - 1])),
  "ada halaman tanpa kaki",
);
/**
 * Tingginya, bukan panjang teksnya: tata letak berkas ini digambar dari koordinat,
 * jadi “muat atau tidak” ditentukan oleh jumlah tinggi unitnya. Satu unit yang tidak
 * muat akan ditulis di luar tepi bawah halaman — terlihat sebagai kartu yang terpotong
 * di pembaca PDF, tetapi tidak terlihat sama sekali dari daftar teksnya.
 */
const tinggiHalaman = halaman.map((page) =>
  page.units
    .filter((unit) => unit.peran !== "kaki")
    .reduce((total, unit) => total + unit.tinggi, 0),
);
check(
  "PDF: isi tiap halaman muat di tingginya (tidak ada kartu yang terpotong)",
  tinggiHalaman.every((tinggi) => tinggi <= LAPORAN_PDF_TINGGI_KONTEN_PT),
  tinggiHalaman
    .map((tinggi, index) => `h${index + 1}:${tinggi.toFixed(0)}/${LAPORAN_PDF_TINGGI_KONTEN_PT}`)
    .join(" "),
);
/** Tabel panjang: kepala kolomnya harus tetap ikut, bukan tertinggal sendiri. */
const panjang = laporanDocument({
  ...INPUT,
  analytics: {
    ...INPUT.analytics,
    topProducts: Array.from({ length: 120 }, (_value, index) => ({
      productId: `p${index}`,
      name: `Produk uji nomor ${index + 1}`,
      category: "Uji",
      quantity: index + 1,
      revenue: (index + 1) * 1000,
      marginPct: 20,
      sharePct: 1,
    })),
  },
});
const halamanPanjang = laporanPdfPages(panjang);
check("PDF panjang: lebih dari tiga halaman", halamanPanjang.length > 3, halamanPanjang.length);
check(
  "PDF panjang: setiap baris produk ada di suatu halaman",
  [1, 60, 120].every((nomor) =>
    halamanPanjang.some((page) =>
      page.text.some((line) => line.includes(`Produk uji nomor ${nomor}`)),
    ),
  ),
  "ada baris yang hilang",
);
check(
  "PDF panjang: kepala tabel muncul di setiap halaman yang berisi barisnya",
  halamanPanjang.filter((page) =>
    page.text.some((line) => line.startsWith("Produk uji nomor")),
  ).length > 1,
  "tabel panjang tidak menyambung antar halaman",
);
/**
 * Kepala tabel yang tercetak **dua kali** di satu halaman. Waktu kepala tabelnya tidak
 * sempat muat di halaman sebelumnya, halaman barunya menerima pengulangan kepala dari
 * kartunya — dan dulu unit kepala tabelnya tetap ditulis sekali lagi dari daftar unit
 * kartunya, jadi pembaca melihat dua baris judul kolom bertumpuk (kejadian di BAGIAN 5
 * halaman 4 dan BAGIAN 9 halaman 7 berkas contoh). Satu kartu = satu bagian = satu
 * tabel, jadi satu kepala tabel per kartu per halaman sudah benar.
 */
const kepalaTabelGanda = (daftarHalaman) => {
  const temuan = [];
  daftarHalaman.forEach((page, halamanKe) => {
    const perKartu = new Map();
    for (const unit of page.units) {
      if (unit.peran !== "tabelKepala") continue;
      perKartu.set(unit.kartu, (perKartu.get(unit.kartu) ?? 0) + 1);
    }
    for (const [kartu, jumlah] of perKartu) {
      if (jumlah > 1) {
        temuan.push(`${kartu} di halaman ${halamanKe + 1} (${jumlah} kepala)`);
      }
    }
  });
  return temuan;
};
const kepalaGanda = [...kepalaTabelGanda(halaman), ...kepalaTabelGanda(halamanPanjang)];
check(
  "PDF: kepala tabel dicetak sekali saja di tiap halaman (tidak dobel saat menyambung)",
  kepalaGanda.length === 0,
  kepalaGanda.slice(0, 4).join(" | "),
);

/* ========================================================= 6. grafik ===== */

const idBagian = new Set(dokumen.sections.map((section) => section.id));
check(
  "grafik: satu grafik per bagian yang punya angkanya (6 pada contoh)",
  dokumen.charts.length === 6,
  dokumen.charts.map((chart) => chart.id).join(","),
);
check(
  "grafik: setiap grafik menempel pada bagian yang ada",
  dokumen.charts.every((chart) => idBagian.has(chart.sectionId)),
  dokumen.charts.map((chart) => chart.sectionId).join(","),
);
check(
  "grafik: bagian yang datanya kosong tidak memaksa grafik muncul",
  dokumenKosong.charts.length === 0,
  dokumenKosong.charts.map((chart) => chart.id).join(","),
);
check(
  "grafik: angkanya sama dengan tabelnya (metode bayar)",
  (() => {
    const grafik = dokumen.charts.find((row) => row.id === "grafik-metode");
    const metode = dokumen.sections.find((section) => section.id === "metode-bayar");
    return (
      grafik !== undefined &&
      metode !== undefined &&
      grafik.points.length === metode.rows.length &&
      grafik.points.every(
        (point, index) =>
          point.label === cellValue(metode.rows[index].cells[0]) &&
          point.value === cellValue(metode.rows[index].cells[1]),
      )
    );
  })(),
  "grafik metode bayar tidak cocok dengan tabelnya",
);
check(
  "grafik: label sumbu dijarangkan (30 titik jadi maksimal 8 label)",
  (() => {
    const contoh = {
      id: "x",
      sectionId: "y",
      title: "t",
      unit: "money",
      points: Array.from({ length: 30 }, (_value, index) => ({
        label: `h${index}`,
        value: index,
      })),
    };
    const labels = laporanChartAxisLabels(contoh);
    const pendek = laporanChartAxisLabels({ ...contoh, points: contoh.points.slice(0, 10) });
    return (
      // 30 titik: labelnya dijarangkan, tidak pernah melewati batas 8.
      labels.filter((label) => label !== "").length <= 8 &&
      labels[0] === "h0" &&
      // 10 titik: titik terakhir tetap dilabeli karena masih ada tempat.
      pendek[pendek.length - 1] === "h9"
    );
  })(),
  "label sumbu tidak dijarangkan",
);
check(
  "grafik: teksnya menyebut jumlah titik & nilai tertinggi",
  laporanPdfTextLaporan(dokumen).includes("titik batang, tertinggi"),
  "keterangan grafik tidak ada di teks PDF",
);
check(
  "grafik PDF: batangnya digambar sebagai batang vektor bernada, tingginya berbeda menurut nilainya",
  batangBentuk.length >= dokumen.charts.length && tinggiBatang.size > 3,
  `${batangBentuk.length} batang (${tinggiBatang.size} tinggi berbeda) untuk ${dokumen.charts.length} bagan`,
);
/*
  Urutan unit berkasnya, lintas halaman: dipakai untuk memastikan tiap bagan benar-benar
  berada **setelah** isi bagiannya. Setiap unit tahu kartu pemiliknya (`kartu`) — bagian
  dokumen memakai `bagian:<id>`, bagan memakai `bagan:<id>`.
*/
const urutUnit = halaman.flatMap((page, halamanKe) =>
  page.units.map((unit) => ({ ...unit, halamanKe })),
);
const urutPeran = (predikat) => urutUnit.findIndex(predikat);
check(
  "grafik: tiap bagan ditaruh setelah isi bagiannya, bukan di depan berkas",
  dokumen.charts.every(
    (chart) =>
      urutPeran((unit) => unit.kartu === `bagan:${chart.id}`) >
      urutPeran((unit) => unit.kartu === `bagian:${chart.sectionId}`),
  ),
  dokumen.charts
    .map(
      (chart) =>
        `${chart.id}: bagian ${urutPeran((unit) => unit.kartu === `bagian:${chart.sectionId}`)} ` +
        `bagan ${urutPeran((unit) => unit.kartu === `bagan:${chart.id}`)}`,
    )
    .join(" | "),
);
check(
  "grafik: judul, gambarnya, dan keterangannya menyatu (tidak terpisah antar halaman)",
  halaman.every((page) => {
    const peran = page.units.map((unit) => unit.peran);
    const judulPunyaIsi = page.units
      .filter((unit) => unit.peran === "baganJudul")
      .every((unit) => unit.teks.length >= 2);
    return (
      judulPunyaIsi &&
      peran.every((nama, index) =>
        nama === "bagan"
          ? peran[index - 1] === "baganJudul" && peran[index + 1] === "baganKeterangan"
          : true,
      )
    );
  }),
  halaman
    .map((page, index) => `h${index + 1}: ${page.units.map((unit) => unit.peran).join(" ")}`)
    .join("\n"),
);
check(
  "grafik PDF: tingginya masuk akal untuk halaman A4",
  LAPORAN_PDF_BAGAN_TINGGI_PT > 20 && LAPORAN_PDF_BAGAN_TINGGI_PT < 200,
  LAPORAN_PDF_BAGAN_TINGGI_PT,
);

/* ---- bagan Excel: rantai lembar → gambar → bagan ---- */
check(
  "Excel: satu bagan per grafik laporan",
  jumlahBagan === dokumen.charts.length,
  jumlahBagan,
);
for (let nomor = 1; nomor <= jumlahBagan; nomor += 1) {
  check(
    `Excel: bagian bagan ${nomor} lengkap (bagan + gambar + relasinya)`,
    bagian.has(`xl/charts/chart${nomor}.xml`) &&
      bagian.has(`xl/drawings/drawing${nomor}.xml`) &&
      bagian.has(`xl/drawings/_rels/drawing${nomor}.xml.rels`),
    `bagan ${nomor} tidak lengkap`,
  );
}
check(
  "Excel: daftar isi mencantumkan bagan & gambarnya",
  bagian.get("[Content_Types].xml").includes("/xl/charts/chart1.xml") &&
    bagian.get("[Content_Types].xml").includes("/xl/drawings/drawing1.xml"),
  "bagan tidak terdaftar di daftar isi",
);
check(
  "Excel: gambar ditempel ke lembarnya lewat relasi lembar",
  [...bagian.entries()].some(
    ([name, xml]) =>
      name.includes("worksheets/_rels") && xml.includes("../drawings/drawing1.xml"),
  ) &&
    [...bagian.entries()].some(
      ([name, xml]) => name.includes("worksheets/sheet") && xml.includes("<drawing r:id="),
    ),
  "rantai lembar ke gambar tidak lengkap",
);
check(
  "Excel: relasi gambar menunjuk bagannya",
  [...bagian.entries()].some(
    ([name, xml]) => name.includes("drawings/_rels") && xml.includes("../charts/chart1.xml"),
  ),
  "rantai gambar ke bagan tidak lengkap",
);
check(
  "Excel: bagan menunjuk sel lembar datanya, bukan angka mati",
  bagian.get("xl/charts/chart1.xml").includes("!$B$3:$B$") &&
    bagian.get("xl/charts/chart1.xml").includes("<c:numCache>") &&
    bagian.get("xl/charts/chart1.xml").includes('<c:barDir val="col"/>'),
  bagian.get("xl/charts/chart1.xml").slice(0, 500),
);
check(
  "Excel: cache bagan memuat semua titiknya",
  (() => {
    const grafik = dokumen.charts[0];
    const xml = bagian.get("xl/charts/chart1.xml");
    return (
      xml.includes(`<c:ptCount val="${grafik.points.length}"/>`) &&
      xml.includes(`<c:cat>`) &&
      xml.includes(`<c:val>`)
    );
  })(),
  "cache bagan tidak lengkap",
);
check(
  "Excel: lembar data bagan memuat label & nilai yang sama",
  (() => {
    const grafik = dokumen.charts[0];
    const rows = laporanXlsxTextRows(dokumen);
    const sheet = rows.find((row) => row[0].startsWith("Grafik -"));
    return (
      sheet !== undefined &&
      // Baris 1 judul, baris 2 kepala kolom, jadi datanya mulai baris ke-3.
      sheet[2].includes("Label") &&
      grafik.points.every(
        (point, index) =>
          sheet[index + 3].includes(point.label) &&
          sheet[index + 3].includes(String(Math.round(point.value))),
      )
    );
  })(),
  "lembar data bagan tidak cocok dengan grafiknya",
);
check(
  "Excel: label bagan di-escape (kutip & tanda pisah panjang aman)",
  bagian.get("xl/charts/chart5.xml").includes("Semen &quot;Gresik&quot;"),
  bagian.get("xl/charts/chart5.xml").slice(0, 300),
);

/* --------------------------------------------------------------- akhir --- */

check(
  "pembungkus kalimat memotong di lebar yang diminta (diukur dari lebar hurufnya)",
  laporanPdfWrap("kata ".repeat(60).trim(), 120, 8.2).every(
    (baris) => laporanPdfTextWidth(baris, 8.2) <= 120,
  ),
  "ada baris lebih lebar dari 120 pt",
);
check(
  "kolom tabel lebar menyusut sampai muat, bukan meluber",
  (() => {
    const lebar = laporanPdfKolumTabel(
      [
        "Kolom satu yang panjang sekali",
        "Kolom dua yang panjang sekali",
        "Kolom tiga yang panjang",
        "Kolom empat",
      ],
      [["isi satu", "isi dua", "isi tiga", "isi empat"]],
      [false, false, false, false],
      null,
      200,
    );
    return lebar.length === 4 && lebar.reduce((total, nilai) => total + nilai, 0) <= 200;
  })(),
  "kolom tabel melebihi lebar yang tersedia",
);
check(
  "teks laporan PDF tersusun tanpa peramban",
  (() => {
    const teks = laporanPdfTextLaporan(dokumen);
    return (
      teks.includes("Pajak & pungutan F&B per bulan") &&
      // Label kartunya bernomor seperti di halaman: “BAGIAN 2 · …”. Teks unit masih
      // memakai titik tengahnya; di aliran PDF titik itu diterjemahkan ke tanda hubung
      // (`laporanPdfText`) karena huruf standar PDF tidak memuatnya — regex ini menerima
      // keduanya supaya yang diperiksa isinya, bukan tanda bacanya.
      /BAGIAN \d+ [·-] DARI MANA UANGNYA MASUK/.test(teks) &&
      /BAGIAN \d+ [·-] ANALITIK LANJUTAN/.test(teks) &&
      laporanPdfText("—") === "-"
    );
  })(),
  laporanPdfText("—"),
);
check(
  "XLSX: tiap peran sel punya gaya sendiri, dan tidak ada sel menunjuk gaya yang tidak ada",
  (() => {
    const jumlahGaya = Number(
      (bagian.get("xl/styles.xml").match(/<cellXfs count="(\d+)"/) ?? [])[1],
    );
    return (
      jumlahGaya === 7 * 3 * LAPORAN_WARNA_DAFTAR.length &&
      new Set([
        laporanCellStyleIndex("normal", "text"),
        laporanCellStyleIndex("title", "text"),
        laporanCellStyleIndex("note", "text"),
        laporanCellStyleIndex("header", "text"),
        laporanCellStyleIndex("cell", "text"),
        laporanCellStyleIndex("band", "text"),
        laporanCellStyleIndex("total", "text"),
      ]).size === 7 &&
      [...bagian.entries()]
        .filter(([name]) => name.startsWith("xl/worksheets/sheet"))
        .every(([, xml]) =>
          [...xml.matchAll(/<c r="[A-Z]+\d+" s="(\d+)"/g)].every(
            (match) => Number(match[1]) < jumlahGaya,
          ),
        )
    );
  })(),
  bagian.get("xl/styles.xml").slice(0, 200),
);
check(
  "entri ZIP tanpa pemadatan (method 0)",
  zip.entri.length > 0 &&
    laporanXlsxParts(dokumen).every((part) => encoder.encode(part.name).length > 0),
  "entri ZIP kosong",
);

/*
  Pemindaian tata letak yang sama diulang untuk **berkas panjang** (120 baris produk):
  di situlah kartu dan kepala tabel dipecah ke halaman berikutnya, dan "(bersambung dari
  halaman sebelumnya)" digambar ulang — persis tempat yang paling mudah tumpang-tindih.
*/
{
  const gambarPanjang = [...latin1(laporanPdfBytes(panjang)).matchAll(
    /<< \/Length \d+ >>\nstream\n([\s\S]*?)\nendstream/g,
  )].map((match) => bacaAliran(match[1]));
  const tumpangTeks = [];
  const tumpangBentuk = [];
  gambarPanjang.forEach((halamanAliran, halamanKe) => {
    const daftar = halamanAliran.teks;
    for (let satu = 0; satu < daftar.length; satu += 1) {
      for (let dua = satu + 1; dua < daftar.length; dua += 1) {
        const a = kotakTeks(daftar[satu]);
        const b = kotakTeks(daftar[dua]);
        if (
          Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 &&
          Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.5
        ) {
          tumpangTeks.push(`“${daftar[satu].isi}” ↔ “${daftar[dua].isi}” (halaman ${halamanKe + 1})`);
        }
      }
      for (const bentuk of halamanAliran.bentuk) {
        if (
          bentuk.urutan > daftar[satu].urutan &&
          bertumpuk(bentuk, kotakTeks(daftar[satu]))
        ) {
          tumpangBentuk.push(`${daftar[satu].isi} (halaman ${halamanKe + 1})`);
          break;
        }
      }
    }
  });
  check(
    "PDF panjang (120 baris): tiap halaman bebas dari tulisan yang saling menimpa",
    tumpangTeks.length === 0,
    tumpangTeks.slice(0, 3).join(" | "),
  );
  check(
    "PDF panjang (120 baris): tidak ada huruf yang tertimpa bentuk yang digambar setelahnya",
    tumpangBentuk.length === 0,
    tumpangBentuk.slice(0, 3).join(" | "),
  );
}

const total = results.length;
const gagal = results.filter((row) => !row.ok);
console.log(`${total - gagal.length}/${total} pemeriksaan lulus`);
if (gagal.length > 0) {
  console.log("Gagal:");
  for (const row of gagal) console.log(` - ${row.name}`);
  process.exit(1);
}

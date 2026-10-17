/**
 * Laporan yang bisa **diunduh**: satu model untuk tiga berkas — PDF, Excel, dan CSV.
 *
 * Kenapa ada: halaman Laporan bisa dibaca di layar, tetapi pemilik toko & pembukuan
 * bekerja dengan berkas — dikirim ke akuntan, dicetak, atau dibuka di Excel untuk
 * dijumlahkan lagi. Kalau setiap format menyusun angkanya sendiri, cepat atau lambat
 * ada berkas yang isinya berbeda dari layar (dan dari berkas lain). Karena itu di
 * sini ada **satu** dokumen: daftar bagian, tiap bagian punya judul, kepala kolom,
 * baris, dan baris jumlah. Ketiga penulis berkas (`laporanCsv` di sini,
 * `@/convex/lib/laporanXlsx`, `@/convex/lib/laporanPdf`) hanya menggambar dokumen
 * yang sama — tidak ada perhitungan angka di dalam mereka.
 *
 * Satu keputusan yang memengaruhi ketiga berkas: **sel membawa nilainya, bukan
 * teksnya**. Sel uang menyimpan rupiah bulat dan sel angka menyimpan angkanya;
 * teks "Rp1.234.567" hanya dipakai untuk PDF (yang memang untuk dibaca manusia).
 * Akibatnya angka di Excel & CSV tetap **angka** — bisa dijumlahkan, diurutkan, dan
 * dibuat pivot — bukan teks yang terlihat seperti angka.
 *
 * Berkas ini murni: tanpa DOM, tanpa jaringan, tanpa tanggal "sekarang" dari
 * jamnya sendiri (waktu dibuat selalu dikirim pemanggil sebagai `generatedAt`).
 * Jadi isinya bisa diuji apa adanya, dan dua unduhan dari data yang sama
 * menghasilkan berkas yang identik.
 */

/* --------------------------------------------------------------- sel ----- */

/** Sel teks: apa yang tertulis, apa adanya. */
export interface LaporanTextCell {
  text: string;
}

/** Sel uang: rupiah **bulat** (tanpa sen), disimpan sebagai angka. */
export interface LaporanMoneyCell {
  money: number;
}

/** Sel angka: bilangan biasa (boleh desimal), mis. pangsa persen atau jam. */
export interface LaporanNumberCell {
  number: number;
}

export type LaporanCell = LaporanTextCell | LaporanMoneyCell | LaporanNumberCell;

export function textCell(text: string): LaporanTextCell {
  return { text };
}

/** Angka uang dibulatkan di sini, sekali, supaya semua berkas memakai angka sama. */
export function moneyCell(value: number): LaporanMoneyCell {
  return { money: Math.round(finiteOrZero(value)) };
}

export function numberCell(value: number): LaporanNumberCell {
  return { number: finiteOrZero(value) };
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Sel yang harus ditulis sebagai **angka** di Excel & CSV. */
export function cellIsNumeric(cell: LaporanCell): boolean {
  return "money" in cell || "number" in cell;
}

/** Nilai mentah sel: angka untuk sel angka, teks untuk sel teks. */
export function cellValue(cell: LaporanCell): string | number {
  if ("money" in cell) return Math.round(finiteOrZero(cell.money));
  if ("number" in cell) return finiteOrZero(cell.number);
  return cell.text;
}

/** Pemisah ribuan gaya Indonesia: `1234567` → `1.234.567`. */
export function formatRibuan(value: number): string {
  const rounded = Math.round(finiteOrZero(value));
  const sign = rounded < 0 ? "-" : "";
  return (
    sign +
    String(Math.abs(rounded))
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  );
}

/** Desimal gaya Indonesia, tanpa nol berekor: `12.5` → `12,5`; `3` → `3`. */
export function formatDesimal(value: number, digits = 2): string {
  const rounded = Number(finiteOrZero(value).toFixed(digits));
  return String(rounded).replace(".", ",");
}

/**
 * Teks sel untuk dibaca manusia (dipakai PDF): uang diberi pemisah ribuan, angka
 * desimal memakai koma. **Tanpa** awalan "Rp" — kepala kolomnya yang menyebut
 * satuannya, supaya kolomnya tidak penuh kata berulang.
 */
export function cellDisplay(cell: LaporanCell): string {
  if ("money" in cell) return formatRibuan(cell.money);
  if ("number" in cell) return formatDesimal(cell.number);
  return cell.text;
}

/** Teks sel untuk CSV: angka ditulis apa adanya (titik desimal jadi koma). */
export function cellCsvText(cell: LaporanCell): string {
  if ("money" in cell) return String(cellValue(cell));
  if ("number" in cell) return formatDesimal(cell.number, 4);
  return cell.text;
}

/* ------------------------------------------------------------ dokumen ---- */

export interface LaporanRow {
  cells: LaporanCell[];
}

export interface LaporanSection {
  /** Id stabil (huruf kecil, tanda hubung) — dipakai sebagai nama lembar Excel. */
  id: string;
  title: string;
  /** Keterangan di bawah judul; boleh berisi batasan yang jujur. */
  note?: string;
  headers: string[];
  rows: LaporanRow[];
  /** Baris jumlah; dicetak tebal di Excel, dan dipisah garis di PDF. */
  total?: LaporanRow;
}

/**
 * Satu grafik batang di dalam laporan.
 *
 * Grafiknya **digambar dua kali** dari data yang sama: PDF menggambarnya sebagai
 * batang vektor (bisa dicetak & difotokopi), sedangkan Excel membuat bagan asli yang
 * terhubung ke sell di lembarnya sendiri — jadi pemilik toko bisa mengubah angkanya
 * dan bagannya ikut bergerak. Karena itu grafiknya disimpan sebagai **angkanya**,
 * bukan sebagai gambar: gambar tidak bisa dihitung ulang oleh Excel.
 */
export interface LaporanChart {
  /** Id stabil (huruf kecil, tanda hubung). */
  id: string;
  /** Id bagian yang tabelnya digambarkan grafik ini — grafiknya diletakkan di bawahnya. */
  sectionId: string;
  title: string;
  /** Keterangan singkat di bawah judul grafik. */
  note?: string;
  /** Satuan nilai: rupiah (diformat ribuan) atau angka biasa. */
  unit: "money" | "number";
  /** Titik grafik, urut dari kiri ke kanan. */
  points: { label: string; value: number }[];
}

export interface LaporanDocument {
  title: string;
  workspace: string;
  store: string;
  /** Label periode ringkasan harian, mis. `16 Okt 2026`. */
  period: string;
  /** Kapan berkas ini dibuat (ms); dikirim pemanggil supaya berkasnya bisa diuji. */
  generatedAt: number;
  /** Keterangan di kepala berkas: sumber angka & bagian yang tidak disertakan. */
  notes: string[];
  /**
   * Kalimat pembuka yang dibaca **sebelum** tabelnya: periode ini tokonya
   * menerima berapa, dari berapa transaksi, dibayar pakai apa, dan apa yang
   * menjadi kewajiban pemiliknya — ditulis tanpa istilah pembukuan, supaya orang
   * yang tidak biasa membaca laporan tetap paham angkanya bercerita apa.
   *
   * Isinya diturunkan dari masukan yang sama dengan tabelnya (lihat
   * `laporanRingkasanSingkat`), bukan tambahan yang ditulis manual: kalau angkanya
   * berubah, kalimatnya ikut berubah.
   */
  summaryLines: string[];
  sections: LaporanSection[];
  /** Grafik batang laporan; PDF menggambarnya, Excel membuat bagan aslinya. */
  charts: LaporanChart[];
}

/* -------------------------------------------------------------- masukan -- */

/**
 * Bentuk masukan yang dibutuhkan perakitan laporan. Sengaja **sempit** (hanya kolom
 * yang benar-benar dipakai): halaman boleh mengirim objek yang lebih kaya — hasil
 * aturan murni yang sama dengan yang digambarnya di layar — tanpa ada penyalinan
 * angka di sini. Yang tidak boleh terjadi adalah laporan menghitung ulang angkanya
 * sendiri, karena itu berarti ada dua kebenaran.
 */
export interface LaporanSummaryInput {
  revenue: number;
  tax: number;
  discount: number;
  transactions: number;
  itemCount: number;
  averagePerTransaction: number;
}

export interface LaporanMethodInput {
  method: string;
  total: number;
  share: number;
}

export interface LaporanMonthInput {
  row: {
    label: string;
    recordedSales: number;
    monthGrossIdr: number;
    serviceChargeIdr: number;
  };
  regionalToPayIdr: number;
  ppnToPayIdr: number;
  ownerObligationsIdr: number;
  umkm: { monthTaxIdr: number };
  rent: { withheldIdr: number };
}

export interface LaporanFnbTotalsInput {
  recordedSales: number;
  grossIdr: number;
  regionalTaxIdr: number;
  ppnTaxIdr: number;
  serviceChargeIdr: number;
}

export interface LaporanAnalyticsInput {
  range: { days: number };
  /** Tren harian: satu titik per hari, termasuk hari tanpa penjualan. */
  trend: { label: string; revenue: number; transactions: number }[];
  totals: {
    revenue: number;
    netRevenue: number;
    tax: number;
    discount: number;
    transactions: number;
    itemCount: number;
    averageBasket: number;
  };
  margin: {
    cost: number;
    grossProfit: number;
    marginPct: number;
    uncostedRevenue: number;
  };
  comparison: {
    revenueDeltaPct: number | null;
    transactionsDeltaPct: number | null;
    averageBasketDeltaPct: number | null;
    marginPctDelta: number;
  };
  topProducts: {
    productId: string;
    name: string;
    category: string;
    quantity: number;
    revenue: number;
    marginPct: number;
    sharePct: number;
  }[];
  byCategory: { category: string; revenue: number; sharePct: number }[];
  busyHours: { hour: number; revenue: number; transactions: number }[];
  weekday: { weekday: number; revenue: number; transactions: number }[];
  insights: { level: string; text: string }[];
  /**
   * Proyeksi akhir periode & analisis keranjang (bagian enterprise dari analitik
   * lanjutan). Opsional supaya dokumen yang dirakit dari masukan lama tetap sah —
   * bagiannya cuma tidak dimunculkan, bukan diisi angka tebakan.
   */
  forecast?: {
    hasBasis: boolean;
    elapsedDays: number;
    todayCounted: boolean;
    netRunRate: number;
    profitRunRate: number;
    completedNet: number;
    todayNet: number;
    completedProfit: number;
    todayProfit: number;
    projectedNet: number;
    projectedProfit: number;
    projectedTransactions: number;
    previousSamePaceNet: number;
    paceDeltaPct: number | null;
  };
  basket?: {
    receipts: number;
    skippedReceipts: number;
    items: number;
    averageItems: number;
    multiItemReceipts: number;
    multiItemSharePct: number;
    truncated: boolean;
    sizes: { label: string; receipts: number; sharePct: number; revenue: number }[];
    pairs: {
      aName: string;
      bName: string;
      together: number;
      supportPct: number;
      lift: number;
      revenue: number;
    }[];
  };
}

export interface LaporanOutletInput {
  storeId: string;
  name: string;
  code: string;
  revenue: number;
  transactions: number;
  averageBasket: number;
  sharePct: number;
  truncated: boolean;
}

export interface LaporanFranchiseInput {
  days: number;
  totals: {
    revenue: number;
    transactions: number;
    averageBasket: number;
    activeOutlets: number;
    inactiveOutlets: number;
  };
  outlets: LaporanOutletInput[];
  topSales: { saleId: string; storeName: string; number: string; total: number }[];
  truncated: boolean;
  skippedOutlets: number;
  beyondWindow: number;
}

export interface LaporanInput {
  workspace: string;
  store: string;
  period: string;
  generatedAt: number;
  summary: LaporanSummaryInput;
  methods: LaporanMethodInput[];
  /** Laporan pajak & pungutan F&B per bulan; `null` = tidak disertakan. */
  fnb?: {
    months: LaporanMonthInput[];
    totals: LaporanFnbTotalsInput;
    ownerTotal: number;
  } | null;
  /** Analitik lanjutan; `null` = paket/peran tidak memuatnya. */
  analytics?: LaporanAnalyticsInput | null;
  /** Laporan lintas cabang; `null` = paket/peran tidak memuatnya. */
  franchise?: LaporanFranchiseInput | null;
  /** Keterangan tambahan dari halaman (mis. angka dari data contoh). */
  extraNotes?: string[];
}

export const LAPORAN_TITLE = "Laporan penjualan";

/** Nama hari; indeks 0 = Minggu, sama dengan `weekday` di aturan analitik. */
export const LAPORAN_WEEKDAYS = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jumat",
  "Sabtu",
];

const BULAN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

/** `16 Okt 2026` — label tanggal berkas (waktu lokal perangkat pemanggil). */
export function laporanDateLabel(ts: number): string {
  const date = new Date(finiteOrZero(ts));
  return `${date.getDate()} ${BULAN[date.getMonth()]} ${date.getFullYear()}`;
}

/** `16 Okt 2026 14:30` — keterangan “Dibuat” di kepala berkas. */
export function laporanStampLabel(ts: number): string {
  const date = new Date(finiteOrZero(ts));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${laporanDateLabel(ts)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `20261016-1430` — cap waktu di nama berkas; urut abjad = urut waktu. */
export function laporanFileStamp(ts: number): string {
  const date = new Date(finiteOrZero(ts));
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

/** Teks bebas jadi bagian nama berkas yang aman: `Pusat Bahan/Bangunan` → `pusat-bahan-bangunan`. */
export function laporanFileSlug(text: string, fallback = "toko"): string {
  const slug = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? fallback : slug.slice(0, 40);
}

/** Perubahan periode sebelumnya: `+12%`, `tidak ada pembanding`. */
export function laporanDeltaText(value: number | null, suffix = "%"): string {
  if (value === null) return "tidak ada pembanding";
  if (value === 0) return `0${suffix}`;
  return `${value > 0 ? "+" : "-"}${formatDesimal(Math.abs(value))}${suffix}`;
}

/* ------------------------------------------------------- perakitan -------- */

const KOSONG_BARIS: LaporanRow = {
  cells: [textCell("Belum ada data pada periode ini.")],
};

function rowsOrEmpty(rows: LaporanRow[]): LaporanRow[] {
  return rows.length > 0 ? rows : [KOSONG_BARIS];
}

/**
 * Merakit dokumen laporan dari bagian-bagian yang sudah dihitung halaman.
 *
 * Bagian yang tidak berlaku **tidak dihilangkan diam-diam**: analitik lanjutan atau
 * laporan lintas cabang yang tidak dimuat paketnya disebutkan di `notes`, jadi
 * berkasnya tidak tampak lengkap padahal ada yang tidak ikut.
 */
/**
 * Batas jumlah label sumbu X yang ditulis di grafik. Deret 30 hari yang dilabeli
 * seluruhnya akan saling menumpuk dan tidak terbaca lagi.
 */
export const LAPORAN_CHART_AXIS_LABELS_MAX = 8;

/**
 * Grafik hanya ikut kalau ada **angkanya**: grafik batang kosong (semua nol) hanya
 * mengambil tempat dan membuat laporan tampak lebih lengkap daripada isinya.
 */
function chartAtauNull(chart: LaporanChart): LaporanChart | null {
  const adaNilai = chart.points.some((point) => point.value !== 0);
  return chart.points.length > 0 && adaNilai ? chart : null;
}

/** Label sumbu X untuk grafik; deret panjang dijarangkan supaya tetap terbaca. */
export function laporanChartAxisLabels(
  chart: LaporanChart,
  maxLabels = LAPORAN_CHART_AXIS_LABELS_MAX,
): string[] {
  const points = chart.points;
  if (points.length <= maxLabels) return points.map((point) => point.label);
  const step = Math.ceil(points.length / maxLabels);
  const labels = points.map((point, index) =>
    index % step === 0 ? point.label : "",
  );
  /*
    Titik terakhir selalu diberi label kalau masih ada tempat: pembaca perlu tahu
    periode ini berakhir kapan. Kalau menambahkannya justru melewati batasnya, yang
    dibuang adalah label terakhir — bukan batasnya, karena label yang menumpuk lebih
    buruk daripada satu label yang berkurang.
  */
  const terakhir = points.length - 1;
  if (labels.filter((label) => label !== "").length < maxLabels) {
    labels[terakhir] = points[terakhir].label;
  }
  return labels;
}

/** Nilai grafik dalam angka yang sudah dibulatkan (rupiah bulat untuk satuan uang). */
export function laporanChartValues(chart: LaporanChart): number[] {
  return chart.points.map((point) =>
    chart.unit === "money" ? Math.round(point.value) : finiteOrZero(point.value),
  );
}

/** Teks nilai grafik untuk dibaca manusia (dipakai label nilai tertinggi di PDF). */
export function laporanChartValueText(chart: LaporanChart, value: number): string {
  return chart.unit === "money" ? formatRibuan(value) : formatDesimal(value);
}

/** Rupiah untuk kalimat: `Rp1.234.567` (tanda minus di depan `Rp`). */
export function laporanUang(value: number): string {
  const angka = formatRibuan(Math.abs(value));
  return `${value < 0 ? "-" : ""}Rp${angka}`;
}

/**
 * Ringkasan bahasa sehari-hari untuk pembaca yang tidak terbiasa membaca laporan.
 *
 * Aturannya sengaja sederhana dan tetap: kalimatnya menjawab pertanyaan yang paling
 * dulu ditanyakan orang — “dapat berapa, dari mana, dan apa yang harus dibayar” —
 * lalu berhenti; rinciannya sudah ada di tabel bawahnya. Kalimat yang angkanya nol
 * tidak ditulis (kecuali kalau memang seluruh periode kosong), karena kalimat
 * “PPN terkumpul Rp0” hanya menambah panjang tanpa menambah pengertian.
 */
export function laporanRingkasanSingkat(input: {
  summary: LaporanSummaryInput;
  methods: LaporanMethodInput[];
  fnb?: LaporanInput["fnb"];
  analytics?: LaporanAnalyticsInput | null;
  franchise?: LaporanFranchiseInput | null;
}): string[] {
  const lines: string[] = [];
  const summary = input.summary;

  if (summary.transactions <= 0 && summary.revenue <= 0) {
    lines.push(
      "Belum ada penjualan yang tercatat pada periode ini, jadi seluruh angka di " +
        "bawah ini bernilai nol.",
    );
  } else {
    lines.push(
      `Toko menerima ${laporanUang(summary.revenue)} dari ${formatRibuan(
        summary.transactions,
      )} transaksi; rata-rata ${laporanUang(summary.averagePerTransaction)} per transaksi.`,
    );
    const potongan: string[] = [];
    if (summary.discount > 0) {
      potongan.push(`diskon yang diberikan ${laporanUang(summary.discount)}`);
    }
    if (summary.tax > 0) {
      potongan.push(
        `PPN yang ikut dipungut ${laporanUang(
          summary.tax,
        )} (uang ini bukan milik toko — nanti disetorkan ke negara)`,
      );
    }
    if (potongan.length > 0) lines.push(`Di dalam omzet itu: ${potongan.join("; ")}.`);
  }

  const metode = [...input.methods].sort((a, b) => b.total - a.total)[0];
  if (metode && metode.total > 0) {
    lines.push(
      `Paling banyak dibayar lewat ${metode.method}: ${laporanUang(metode.total)} (${Math.round(
        metode.share * 100,
      )}% dari omzet periode ini).`,
    );
  }

  const fnb = input.fnb;
  if (fnb && fnb.months.some((month) => month.row.recordedSales > 0)) {
    const dipungutPelanggan =
      fnb.totals.regionalTaxIdr + fnb.totals.ppnTaxIdr + fnb.totals.serviceChargeIdr;
    lines.push(
      `Tercatat ${fnb.months.length} bulan F&B: ${laporanUang(
        fnb.totals.grossIdr,
      )} omzet — pungutan pelanggan ${laporanUang(dipungutPelanggan)} (PBJT ${laporanUang(
        fnb.totals.regionalTaxIdr,
      )}, PPN ${laporanUang(fnb.totals.ppnTaxIdr)}, biaya layanan ${laporanUang(
        fnb.totals.serviceChargeIdr,
      )} yang bukan pajak).`,
    );
    if (fnb.ownerTotal > 0) {
      lines.push(
        `Kewajiban pemilik dari omzet itu (PPh final UMKM dan PPh sewa) ${laporanUang(
          fnb.ownerTotal,
        )} — bukan tambahan di struk pelanggan. Angka pajaknya perkiraan dari data aplikasi, bukan perhitungan pajak resmi.`,
      );
    }
  }

  const analytics = input.analytics;
  if (analytics) {
    const bagian: string[] = [];
    if (analytics.totals.revenue > 0) {
      bagian.push(
        `omzet bersih ${laporanUang(analytics.totals.netRevenue)} dari ${analytics.range.days} hari terakhir`,
      );
    }
    if (analytics.totals.revenue > 0 && analytics.margin.cost > 0) {
      bagian.push(
        `laba kotor setelah harga beli barang ${laporanUang(
          analytics.margin.grossProfit,
        )} (${analytics.margin.marginPct}% dari omzet bersih)`,
      );
    }
    if (analytics.comparison.revenueDeltaPct !== null && analytics.comparison.revenueDeltaPct !== 0) {
      bagian.push(
        analytics.comparison.revenueDeltaPct > 0
          ? `naik ${analytics.comparison.revenueDeltaPct}% dibanding periode sebelumnya yang sama panjang`
          : `turun ${Math.abs(analytics.comparison.revenueDeltaPct)}% dibanding periode sebelumnya yang sama panjang`,
      );
    }
    if (bagian.length > 0) lines.push(`Pandangan jauh ${analytics.range.days} hari: ${bagian.join("; ")}.`);
    const terlaris = [...analytics.topProducts].sort((a, b) => b.revenue - a.revenue)[0];
    if (terlaris && terlaris.revenue > 0) {
      lines.push(
        `Produk paling banyak menghasilkan: ${terlaris.name} — ${laporanUang(
          terlaris.revenue,
        )} (${terlaris.quantity} terjual, pangsa ${terlaris.sharePct}% dari omzet).`,
      );
    }
    if (analytics.margin.uncostedRevenue > 0) {
      lines.push(
        `Catatan: ${laporanUang(
          analytics.margin.uncostedRevenue,
        )} omzet belum punya harga beli, jadi laba kotornya baru dihitung dari sebagian barang.`,
      );
    }
  }

  const franchise = input.franchise;
  if (franchise && franchise.totals.revenue > 0) {
    lines.push(
      `Seluruh jaringan: ${laporanUang(franchise.totals.revenue)} dari ${
        franchise.totals.transactions
      } transaksi di ${franchise.totals.activeOutlets} cabang aktif (rata-rata ${laporanUang(
        franchise.totals.averageBasket,
      )} per transaksi).`,
    );
  }

  return lines;
}

export function laporanDocument(input: LaporanInput): LaporanDocument {
  const sections: LaporanSection[] = [];
  const charts: LaporanChart[] = [];

  const summary = input.summary;
  sections.push({
    id: "ringkasan",
    title: "Ringkasan periode",
    headers: ["Ukuran", "Nilai"],
    rows: [
      { cells: [textCell("Total omzet"), moneyCell(summary.revenue)] },
      { cells: [textCell("PPN terkumpul"), moneyCell(summary.tax)] },
      { cells: [textCell("Diskon diberikan"), moneyCell(summary.discount)] },
      { cells: [textCell("Jumlah transaksi"), numberCell(summary.transactions)] },
      { cells: [textCell("Jumlah barang terjual"), numberCell(summary.itemCount)] },
      {
        cells: [
          textCell("Rata-rata per transaksi"),
          moneyCell(summary.averagePerTransaction),
        ],
      },
    ],
  });

  const methodTotal = input.methods.reduce((sum, row) => sum + row.total, 0);
  const grafikMetode = chartAtauNull({
    id: "grafik-metode",
    sectionId: "metode-bayar",
    title: "Omzet per metode bayar",
    unit: "money",
    points: input.methods.map((row) => ({ label: row.method, value: row.total })),
  });
  if (grafikMetode) charts.push(grafikMetode);
  sections.push({
    id: "metode-bayar",
    title: "Omzet per metode bayar",
    note: "Pangsa dihitung dari omzet periode ini; baris berjumlah 100%.",
    headers: ["Metode bayar", "Omzet (Rp)", "Pangsa (%)"],
    rows: rowsOrEmpty(
      input.methods.map((row) => ({
        cells: [
          textCell(row.method),
          moneyCell(row.total),
          numberCell(Math.round(row.share * 100)),
        ],
      })),
    ),
    total:
      input.methods.length > 0
        ? {
            cells: [textCell("Jumlah"), moneyCell(methodTotal), numberCell(100)],
          }
        : undefined,
  });

  if (input.fnb) {
    const fnb = input.fnb;
    const sum = (pick: (month: LaporanMonthInput) => number) =>
      fnb.months.reduce((total, month) => total + pick(month), 0);
    const ownerTotal = fnb.months.reduce(
      (total, month) => total + month.ownerObligationsIdr,
      0,
    );
    const grafikBulan = chartAtauNull({
      id: "grafik-bulan",
      sectionId: "pajak-fnb",
      title: "Omzet tercatat per bulan",
      note: "Dasar penghitungan pajak & pungutan F&B; bulan tanpa penjualan tampak rata.",
      unit: "money",
      points: fnb.months.map((month) => ({
        label: month.row.label,
        value: month.row.monthGrossIdr,
      })),
    });
    if (grafikBulan) charts.push(grafikBulan);

    sections.push({
      id: "pajak-fnb",
      title: "Pajak & pungutan F&B per bulan",
      note:
        "Angka pungutan diambil dari yang tercatat di tiap struk (mengubah tarif " +
        "hari ini tidak menulis ulang bulan lalu); kewajiban pengusaha dihitung " +
        "dari setelan yang berlaku sekarang. Perkiraan dari data aplikasi, bukan " +
        "perhitungan pajak resmi.",
      headers: [
        "Bulan",
        "Omzet tercatat (Rp)",
        "Transaksi",
        "PBJT (Rp)",
        "PPN (Rp)",
        "Biaya layanan (Rp)",
        "PPh final UMKM (Rp)",
        "PPh sewa (Rp)",
        "Setoran pengusaha (Rp)",
      ],
      rows: rowsOrEmpty(
        fnb.months.map((month) => ({
          cells: [
            textCell(month.row.label),
            moneyCell(month.row.monthGrossIdr),
            numberCell(month.row.recordedSales),
            moneyCell(month.regionalToPayIdr),
            moneyCell(month.ppnToPayIdr),
            moneyCell(month.row.serviceChargeIdr),
            moneyCell(month.umkm.monthTaxIdr),
            moneyCell(month.rent.withheldIdr),
            moneyCell(month.ownerObligationsIdr),
          ],
        })),
      ),
      total:
        fnb.months.length > 0
          ? {
              cells: [
                textCell("Jumlah"),
                moneyCell(fnb.totals.grossIdr),
                numberCell(fnb.totals.recordedSales),
                moneyCell(fnb.totals.regionalTaxIdr),
                moneyCell(fnb.totals.ppnTaxIdr),
                moneyCell(fnb.totals.serviceChargeIdr),
                moneyCell(sum((month) => month.umkm.monthTaxIdr)),
                moneyCell(sum((month) => month.rent.withheldIdr)),
                moneyCell(ownerTotal),
              ],
            }
          : undefined,
    });
  } else {
    sections.push({
      id: "pajak-fnb",
      title: "Pajak & pungutan F&B per bulan",
      headers: ["Keterangan"],
      rows: [
        {
          cells: [
            textCell(
              "Tidak disertakan: laporan pajak & pungutan F&B tidak tersedia untuk paket/peran ini.",
            ),
          ],
        },
      ],
    });
  }

  if (input.analytics) {
    const report = input.analytics;
    const periodNote = `${report.range.days} hari terakhir, dibandingkan dengan periode sebelumnya yang sama panjang.`;

    sections.push({
      id: "analitik-ringkasan",
      title: "Analitik lanjutan — ringkasan",
      note: periodNote,
      headers: ["Ukuran", "Nilai", "Perubahan vs periode sebelumnya"],
      rows: [
        { cells: [textCell("Omzet kotor"), moneyCell(report.totals.revenue)] },
        { cells: [textCell("Omzet bersih (tanpa PPN)"), moneyCell(report.totals.netRevenue)] },
        { cells: [textCell("PPN"), moneyCell(report.totals.tax)] },
        { cells: [textCell("Diskon"), moneyCell(report.totals.discount)] },
        { cells: [textCell("Transaksi"), numberCell(report.totals.transactions)] },
        { cells: [textCell("Barang terjual"), numberCell(report.totals.itemCount)] },
        { cells: [textCell("Rata-rata keranjang"), moneyCell(report.totals.averageBasket)] },
        { cells: [textCell("Harga pokok (HPP)"), moneyCell(report.margin.cost)] },
        { cells: [textCell("Laba kotor"), moneyCell(report.margin.grossProfit)] },
        {
          cells: [
            textCell("Margin kotor (%)"),
            numberCell(report.margin.marginPct),
            textCell(laporanDeltaText(report.comparison.marginPctDelta, " poin")),
          ],
        },
        {
          cells: [
            textCell("Omzet belum ber-HPP"),
            moneyCell(report.margin.uncostedRevenue),
            textCell(
              report.margin.uncostedRevenue > 0
                ? "margin belum akurat untuk bagian ini"
                : "semua produk punya harga beli",
            ),
          ],
        },
      ],
      total: undefined,
    });

    // Perubahan periode-periode sebelumnya ditaruh sebagai baris sendiri supaya
    // kolom angkanya tetap angka (kalimat "+12%" bukan angka di Excel).
    sections.push({
      id: "analitik-perbandingan",
      title: "Analitik lanjutan — perbandingan periode",
      note: "Perubahan dihitung terhadap periode sebelumnya yang sama panjang; kosong = belum ada pembanding.",
      headers: ["Ukuran", "Perubahan (%)"],
      rows: [
        {
          cells: [
            textCell("Omzet"),
            report.comparison.revenueDeltaPct === null
              ? textCell("tidak ada pembanding")
              : numberCell(report.comparison.revenueDeltaPct),
          ],
        },
        {
          cells: [
            textCell("Transaksi"),
            report.comparison.transactionsDeltaPct === null
              ? textCell("tidak ada pembanding")
              : numberCell(report.comparison.transactionsDeltaPct),
          ],
        },
        {
          cells: [
            textCell("Rata-rata keranjang"),
            report.comparison.averageBasketDeltaPct === null
              ? textCell("tidak ada pembanding")
              : numberCell(report.comparison.averageBasketDeltaPct),
          ],
        },
        {
          cells: [
            textCell("Margin kotor (poin persen)"),
            numberCell(report.comparison.marginPctDelta),
          ],
        },
      ],
    });

    const tren = report.trend.map((point) => ({
      label: point.label,
      revenue: Math.round(point.revenue),
      transactions: point.transactions,
    }));
    sections.push({
      id: "analitik-tren",
      title: "Tren omzet harian",
      note: periodNote,
      headers: ["Tanggal", "Transaksi", "Omzet (Rp)"],
      rows: rowsOrEmpty(
        tren.map((point) => ({
          cells: [
            textCell(point.label),
            numberCell(point.transactions),
            moneyCell(point.revenue),
          ],
        })),
      ),
      total:
        tren.length > 0
          ? {
              cells: [
                textCell("Jumlah"),
                numberCell(tren.reduce((sum, point) => sum + point.transactions, 0)),
                moneyCell(tren.reduce((sum, point) => sum + point.revenue, 0)),
              ],
            }
          : undefined,
    });

    const grafikTren = chartAtauNull({
      id: "grafik-tren",
      sectionId: "analitik-tren",
      title: `Omzet harian (${report.range.days} hari terakhir)`,
      note: "Tinggi batang dibandingkan dengan hari tertinggi pada periode ini.",
      unit: "money",
      points: tren.map((point) => ({ label: point.label, value: point.revenue })),
    });
    if (grafikTren) charts.push(grafikTren);

    const grafikJam = chartAtauNull({
      id: "grafik-jam",
      sectionId: "analitik-jam",
      title: "Omzet per jam",
      note: "Jam lokal perangkat yang mencatat penjualannya.",
      unit: "money",
      points: report.busyHours.map((row) => ({
        label: `${String(row.hour).padStart(2, "0")}:00`,
        value: row.revenue,
      })),
    });
    if (grafikJam) charts.push(grafikJam);

    const grafikProduk = chartAtauNull({
      id: "grafik-produk",
      sectionId: "analitik-produk",
      title: "Produk teratas menurut omzet",
      note: `Produk ${report.topProducts.length > 8 ? "8" : report.topProducts.length} teratas pada periode ini.`,
      unit: "money",
      points: report.topProducts
        .slice(0, 8)
        .map((row) => ({ label: row.name, value: row.revenue })),
    });
    if (grafikProduk) charts.push(grafikProduk);

    sections.push({
      id: "analitik-produk",
      title: "Produk teratas",
      note: periodNote,
      headers: ["Produk", "Kategori", "Qty", "Omzet (Rp)", "Pangsa (%)", "Margin (%)"],
      rows: rowsOrEmpty(
        report.topProducts.map((row) => ({
          cells: [
            textCell(row.name),
            textCell(row.category),
            numberCell(row.quantity),
            moneyCell(row.revenue),
            numberCell(row.sharePct),
            numberCell(row.marginPct),
          ],
        })),
      ),
    });

    sections.push({
      id: "analitik-kategori",
      title: "Omzet per kategori",
      note: periodNote,
      headers: ["Kategori", "Omzet (Rp)", "Pangsa (%)"],
      rows: rowsOrEmpty(
        report.byCategory.map((row) => ({
          cells: [
            textCell(row.category),
            moneyCell(row.revenue),
            numberCell(row.sharePct),
          ],
        })),
      ),
    });

    sections.push({
      id: "analitik-jam",
      title: "Omzet per jam",
      note: "Jam lokal perangkat yang mencatat penjualannya.",
      headers: ["Jam", "Transaksi", "Omzet (Rp)"],
      rows: report.busyHours.map((row) => ({
        cells: [
          textCell(`${String(row.hour).padStart(2, "0")}:00`),
          numberCell(row.transactions),
          moneyCell(row.revenue),
        ],
      })),
    });

    sections.push({
      id: "analitik-hari",
      title: "Omzet per hari dalam sepekan",
      headers: ["Hari", "Transaksi", "Omzet (Rp)"],
      rows: report.weekday.map((row) => ({
        cells: [
          textCell(LAPORAN_WEEKDAYS[row.weekday] ?? `Hari ${row.weekday}`),
          numberCell(row.transactions),
          moneyCell(row.revenue),
        ],
      })),
    });

    sections.push({
      id: "analitik-temuan",
      title: "Temuan",
      note: "Kalimat yang sama dengan yang tampil di halaman Laporan.",
      headers: ["Sifat", "Temuan"],
      rows: rowsOrEmpty(
        report.insights.map((insight) => ({
          cells: [textCell(insight.level), textCell(insight.text)],
        })),
      ),
    });

    /*
      Bagian enterprise: **proyeksi** akhir periode & **analisis keranjang**.
      Keduanya opsional di masukan dokumen: kalau halaman tidak mengirimkannya
      (versi lama, atau laporan yang dirakit tanpa angkanya), bagiannya tidak
      dibuat sama sekali — dokumen lebih baik kekurangan bagian daripada memuat
      angka nol yang terbaca seperti kenyataan.
    */
    const forecast = report.forecast;
    if (forecast) {
      sections.push({
        id: "analitik-proyeksi",
        title: "Proyeksi akhir periode",
        note: forecast.hasBasis
          ? `Dihitung dari laju ${forecast.elapsedDays} hari penuh di dalam periode` +
            (forecast.todayCounted
              ? "; hari ini belum dihitung penuh, jadi perkiraannya memakai laju hariannya"
              : "; tidak ada hari yang sedang berjalan") +
            ". Omzet & laba dalam rupiah, transaksi dalam jumlah nota."
          : "Belum ada hari penuh di dalam periode ini, jadi angkanya baru yang sudah tercatat — belum layak disebut proyeksi.",
        headers: ["Ukuran", "Nilai"],
        rows: [
          { cells: [textCell("Hari penuh yang sudah lewat"), numberCell(forecast.elapsedDays)] },
          {
            cells: [
              textCell("Hari ini (bagian hari yang sudah lewat)"),
              moneyCell(forecast.todayNet),
            ],
          },
          { cells: [textCell("Laju omzet bersih per hari"), moneyCell(forecast.netRunRate)] },
          { cells: [textCell("Laju laba kotor per hari"), moneyCell(forecast.profitRunRate)] },
          {
            cells: [
              textCell("Sudah tercatat: omzet bersih"),
              moneyCell(forecast.completedNet + forecast.todayNet),
            ],
          },
          {
            cells: [
              textCell("Sudah tercatat: laba kotor"),
              moneyCell(forecast.completedProfit + forecast.todayProfit),
            ],
          },
          {
            cells: [
              textCell("Proyeksi omzet bersih akhir periode"),
              moneyCell(forecast.projectedNet),
            ],
          },
          {
            cells: [
              textCell("Proyeksi laba kotor akhir periode"),
              moneyCell(forecast.projectedProfit),
            ],
          },
          {
            cells: [
              textCell("Proyeksi transaksi akhir periode"),
              numberCell(forecast.projectedTransactions),
            ],
          },
          {
            cells: [
              textCell("Omzet bersih periode sebelumnya (jumlah hari penuh yang sama)"),
              moneyCell(forecast.previousSamePaceNet),
            ],
          },
          {
            cells: [
              textCell("Perubahan laju hari penuh vs periode sebelumnya (%)"),
              forecast.paceDeltaPct === null
                ? textCell("tidak ada pembanding")
                : numberCell(forecast.paceDeltaPct),
            ],
          },
        ],
      });
    }

    const basket = report.basket;
    if (basket) {
      const ukuranNote = [
        `Rata-rata ${formatDesimal(basket.averageItems)} barang per nota`,
        `${basket.multiItemSharePct}% nota memuat dua jenis barang atau lebih`,
        basket.skippedReceipts > 0
          ? `${basket.skippedReceipts} nota tanpa baris barang dilewati`
          : "semua nota punya baris barang",
      ].join("; ");

      sections.push({
        id: "analitik-keranjang",
        title: "Ukuran keranjang",
        note: `${ukuranNote}. Pangsa dihitung dari ${basket.receipts} nota pada periode ini.`,
        headers: ["Ukuran keranjang", "Nota", "Pangsa (%)", "Omzet bersih (Rp)"],
        rows: rowsOrEmpty(
          basket.sizes.map((row) => ({
            cells: [
              textCell(row.label),
              numberCell(row.receipts),
              numberCell(row.sharePct),
              moneyCell(row.revenue),
            ],
          })),
        ),
        total:
          basket.sizes.length > 0
            ? {
                cells: [
                  textCell("Jumlah"),
                  numberCell(basket.sizes.reduce((sum, row) => sum + row.receipts, 0)),
                  numberCell(100),
                  moneyCell(basket.sizes.reduce((sum, row) => sum + row.revenue, 0)),
                ],
              }
            : undefined,
      });

      sections.push({
        id: "analitik-pasangan",
        title: "Produk sering dibeli bersama",
        note:
          "Satu produk dihitung sekali per nota. “Kebiasaan berulang” = berapa kali lebih sering " +
          "keduanya muncul bersama dibanding kalau keduanya saling bebas (di atas 1 = saling menarik)." +
          (basket.truncated
            ? " Sebagian pasangan belum dipindai karena batas pemindaian."
            : ""),
        headers: [
          "Produk A",
          "Produk B",
          "Nota bersama",
          "Pangsa nota (%)",
          "Kebiasaan berulang (x)",
          "Omzet bersih (Rp)",
        ],
        rows: rowsOrEmpty(
          basket.pairs.map((row) => ({
            cells: [
              textCell(row.aName),
              textCell(row.bName),
              numberCell(row.together),
              numberCell(row.supportPct),
              numberCell(row.lift),
              moneyCell(row.revenue),
            ],
          })),
        ),
      });
    }
  }

  if (input.franchise) {
    const franchise = input.franchise;
    const catatanFranchise = [
      `Laporan lintas cabang ${franchise.days} hari terakhir.`,
      franchise.truncated
        ? `Sebagian angka dihitung dari jendela terbatas: ${franchise.skippedOutlets} cabang belum diagregasi` +
          (franchise.beyondWindow > 0
            ? ` dan ${franchise.beyondWindow} cabang di luar jendela global`
            : "") +
          "; cabang yang omzetnya terpotong ditandai “sebagian”."
        : "Seluruh cabang dalam jendela ikut diagregasi.",
    ].join(" ");

    const grafikCabang = chartAtauNull({
      id: "grafik-cabang",
      sectionId: "franchise-cabang",
      title: "Omzet per cabang",
      unit: "money",
      points: franchise.outlets.map((row) => ({
        label: row.code.trim() !== "" ? row.code : row.name,
        value: row.revenue,
      })),
    });
    if (grafikCabang) charts.push(grafikCabang);

    sections.push({
      id: "franchise-cabang",
      title: "Lintas cabang — omzet per cabang",
      note: catatanFranchise,
      headers: [
        "Cabang",
        "Kode",
        "Omzet (Rp)",
        "Transaksi",
        "Rata-rata (Rp)",
        "Pangsa (%)",
        "Catatan",
      ],
      rows: rowsOrEmpty(
        franchise.outlets.map((row) => ({
          cells: [
            textCell(row.name),
            textCell(row.code),
            moneyCell(row.revenue),
            numberCell(row.transactions),
            moneyCell(row.averageBasket),
            numberCell(row.sharePct),
            textCell(row.truncated ? "sebagian (mentok anggaran)" : ""),
          ],
        })),
      ),
      total:
        franchise.outlets.length > 0
          ? {
              cells: [
                textCell("Jumlah"),
                textCell(`${franchise.totals.activeOutlets} aktif`),
                moneyCell(franchise.totals.revenue),
                numberCell(franchise.totals.transactions),
                moneyCell(franchise.totals.averageBasket),
                numberCell(100),
                textCell(`${franchise.totals.inactiveOutlets} cabang nonaktif`),
              ],
            }
          : undefined,
    });

    sections.push({
      id: "franchise-transaksi",
      title: "Lintas cabang — transaksi terbesar",
      headers: ["Cabang", "Nota", "Omzet (Rp)"],
      rows: rowsOrEmpty(
        franchise.topSales.map((sale) => ({
          cells: [
            textCell(sale.storeName),
            textCell(sale.number),
            moneyCell(sale.total),
          ],
        })),
      ),
    });
  }

  const notes: string[] = [
    `Periode ringkasan: ${input.period}. Dibuat ${laporanStampLabel(input.generatedAt)}.`,
    "Semua angka berasal dari data aplikasi MesinPOS — sama dengan yang tampil di halaman Laporan.",
  ];
  if (!input.analytics) {
    notes.push(
      "Analitik lanjutan tidak disertakan: paket atau peran ini belum memuat laporan tersebut.",
    );
  }
  if (!input.franchise) {
    notes.push(
      "Laporan lintas cabang tidak disertakan: paket atau peran ini belum memuat laporan tersebut.",
    );
  }
  notes.push(...(input.extraNotes ?? []));

  return {
    title: LAPORAN_TITLE,
    workspace: input.workspace,
    store: input.store,
    period: input.period,
    generatedAt: input.generatedAt,
    notes,
    summaryLines: laporanRingkasanSingkat({
      summary: input.summary,
      methods: input.methods,
      fnb: input.fnb,
      analytics: input.analytics,
      franchise: input.franchise,
    }),
    sections,
    charts,
  };
}

/* --------------------------------------------------------------- CSV ---- */

/**
 * Pemisah CSV: **titik koma**.
 *
 * Excel di Indonesia memakai titik koma sebagai pemisah daftar (koma sudah dipakai
 * untuk desimal), jadi berkas dengan pemisah koma terbuka sebagai satu kolom di
 * sana. Pemilihannya disebutkan di halaman supaya tidak mengagetkan pemakai
 * aplikasi lain — dan karena itu desimalnya ditulis dengan koma (lihat
 * `cellCsvText`).
 */
export const LAPORAN_CSV_SEPARATOR = ";";

/** Nama berkas CSV resmi memakai CRLF (`RFC 4180`). */
export const LAPORAN_CSV_NEWLINE = "\r\n";

/**
 * Tanda BOM UTF-8 di awal berkas. Tanpa ini Excel di Windows membaca berkas sebagai
 * Latin-1 dan setiap huruf beraksen (mis. “é” di nama produk) berubah jadi sampah.
 */
export const LAPORAN_CSV_BOM = "\uFEFF";

/** Satu sel CSV: dibungkus kutip ganda hanya kalau memang perlu. */
export function laporanCsvCell(text: string): string {
  const perluKutip =
    text.includes(LAPORAN_CSV_SEPARATOR) ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r");
  if (!perluKutip) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvLine(cells: string[]): string {
  return cells.map(laporanCsvCell).join(LAPORAN_CSV_SEPARATOR);
}

function csvRow(row: LaporanRow): string {
  return csvLine(row.cells.map(cellCsvText));
}

/**
 * Berkas CSV: kepala berkas (label;nilai), catatan, lalu satu blok per bagian.
 *
 * Setiap bagian dipisahkan satu baris kosong dan dibuka baris judulnya; baris jumlah
 * diberi label “Jumlah” di kolom pertama. Bentuknya sengaja datar supaya bisa dibaca
 * apa saja — Excel, Google Sheets, atau skrip — tanpa perlu tahu bahwa berkasnya
 * berasal dari aplikasi ini.
 */
export function laporanCsv(document: LaporanDocument): string {
  const lines: string[] = [];
  lines.push(csvLine([document.title]));
  lines.push(csvLine(["Ruang kerja", document.workspace]));
  lines.push(csvLine(["Toko", document.store]));
  lines.push(csvLine(["Periode", document.period]));
  lines.push(csvLine(["Dibuat", laporanStampLabel(document.generatedAt)]));
  // Ringkasannya lebih dulu daripada catatan teknis: pembaca yang membuka berkasnya
  // di ponsel melihat kalimat yang bisa dimengerti sebelum istilah sumber datanya.
  for (const line of document.summaryLines) {
    lines.push(csvLine(["Ringkasan", line]));
  }
  for (const note of document.notes) {
    lines.push(csvLine(["Catatan", note]));
  }

  for (const section of document.sections) {
    lines.push("");
    lines.push(csvLine([section.title]));
    if (section.note) lines.push(csvLine(["Keterangan", section.note]));
    lines.push(csvLine(section.headers));
    for (const row of section.rows) lines.push(csvRow(row));
    if (section.total) lines.push(csvRow(section.total));
  }

  return `${LAPORAN_CSV_BOM}${lines.join(LAPORAN_CSV_NEWLINE)}${LAPORAN_CSV_NEWLINE}`;
}

/* ---------------------------------------------------- nama & jenis ------- */

export const LAPORAN_CSV_MIME = "text/csv;charset=utf-8";
export const LAPORAN_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const LAPORAN_PDF_MIME = "application/pdf";

export type LaporanFileKind = "pdf" | "xlsx" | "csv";

/** `laporan-cabang-melati-20261016-1430.xlsx` — nama berkas ketiga format sama akarnya. */
export function laporanFileName(
  document: LaporanDocument,
  kind: LaporanFileKind,
): string {
  const slug = laporanFileSlug(
    document.store.trim() !== "" ? document.store : document.workspace,
  );
  return `laporan-${slug}-${laporanFileStamp(document.generatedAt)}.${kind}`;
}

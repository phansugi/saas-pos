/**
 * Struk belanja: jenis printer, lebar kertas, rangkap (tembusan), catatan kaki,
 * dan tata letak barisnya.
 *
 * Kenapa ada: struk bukan satu-satunya keluaran aplikasi ini, tetapi ia satu-satunya
 * yang **keluar dari mesin yang dipilih pemilik toko**. Tiga keluarga printer struk
 * yang beredar di pasaran berperilaku berbeda — printer thermal (58/80 mm, sekali
 * cetak, tanpa tinta), printer dot matrix (pita karbon, bisa **rangkap** tembusan),
 * dan printer portable Bluetooth (gulungan kecil, dibawa kasir keliling). Perbedaan
 * itu bukan sekadar warna label: lebar kertas menentukan **berapa karakter muat per
 * baris**, rangkap menentukan **berapa lembar yang keluar**, dan keduanya mengubah
 * bentuk struk yang dibaca pelanggan.
 *
 * Karena itu setelannya hidup di satu berkas murni: kasir (yang mencetak), halaman
 * Pengaturan (yang mengatur), kedua store (demo & Convex), `tenants.updateReceipt`
 * (yang menyimpan), dan harness (yang menguji) harus menjawab hal yang sama — dan
 * Convex hanya membundel modul di bawah `src/convex`.
 *
 * Tujuh keputusan yang sengaja diambil:
 *
 * 1. **Rangkap mengikuti kemampuan printernya, bukan keinginan pengguna.** Printer
 *    thermal & portable **tidak bisa** tembusan karbon — mencetak “2 rangkap” di
 *    sana hanya menghasilkan dua lembar yang sama-sama berisi tinta thermal, bukan
 *    salinan karbon. Karena itu `maxCopies` thermal/portable = 1 dan permintaan
 *    lebih dari itu **ditolak** dengan alasan yang menyebut printer dot matrix.
 * 2. **Lebar kertas harus salah satu dari yang benar-benar didukung printer itu.**
 *    "80 mm" pada printer portable 58 mm akan membuat teksnya terpotong di kertas
 *    atau mengecil tak terbaca; pilihannya dibatasi per jenis printer.
 * 3. **Nama produk panjang dibungkus, bukan dipotong.** Struk 58 mm hanya memuat 32
 *    karakter per baris, dan "Kopi Susu Gula Aren Large" tidak boleh berubah jadi
 *    "Kopi Susu Gula Ar" — nama yang tidak selesai membuat pelanggan menebak apa
 *    yang ia bayar. Pembungkusan dibatasi 2 baris; lebih dari itu baru dipotong
 *    dengan penanda "..." supaya baris berikutnya tetap lurus.
 * 4. **Penanda rangkap hanya muncul kalau memang ada rangkap.** Satu lembar yang
 *    bertuliskan "ASLI" hanya menambah kebisingan; penanda "ASLI"/"TEMBUSAN n"
 *    dicetak saat `copies > 1`, karena justru itu gunanya bagi penerima arsip.
 * 5. **Setelan bawaan = perilaku lama.** Workspace yang belum pernah menyimpan
 *    setelan ini membaca bawaan (thermal 80 mm, 1 lembar, catatan kaki yang sama
 *    dengan yang sudah dipakai aplikasi), jadi struknya tidak berubah dengan
 *    sendirinya.
 * 6. **Logo struk berukuran tetap dan dicetak hitam putih.** Ukurannya tidak ikut
 *    lebar kertas: logo selebar kertas mendorong nama usaha & daftar barangnya ke
 *    halaman berikutnya, jadi kotaknya dipatok `RECEIPT_LOGO_SIZE_PX` (110 px ×
 *    110 px) di semua printer. Warnanya dipaksa abu-abu oleh `RECEIPT_LOGO_FILTER`
 *    supaya yang keluar dari printer — yang tintanya cuma satu warna — setara
 *    dengan teks di sekitarnya, bukan bercak berwarna yang mengotori struk.
 * 7. **Lebar kertas menyesuaikan sendiri saat jenis printernya berganti.** Yang
 *    tidak didukung mesin barunya jatuh ke kertas **terdekat**
 *    (`nearestReceiptPaper`): 76 mm berpindah ke printer thermal menjadi 80 mm,
 *    bukan 58 mm yang menyempitkan struk 18 mm.
 * 8. **Ukuran kertas di dialog cetak ditentukan aplikasi, bukan kasir.** Setelan
 *    struknya diterjemahkan menjadi aturan `@page` (`receiptPrintCss`) berisi
 *    lebar kertas & tinggi notanya, sehingga struk tidak lagi tercetak ke halaman
 *    A4 atau menunggu kasir memilih ukuran kertas sendiri tiap kali.
 *
 * Saran setelan dari modul workspace (`suggestReceiptSetting`) sengaja **bukan**
 * penentuan sendiri: peramban tidak punya API untuk mendeteksi printer yang
 * terpasang, dan salah menebak mesin berarti struknya tidak keluar sama sekali.
 */

import { formatIdrPlain } from "./fnbTax";

// -------------------------------------------------------------------- jenis

export type ReceiptPrinterId = "thermal" | "dot_matrix" | "portable";

/** Satu lebar kertas yang benar-benar didukung sebuah printer. */
export interface ReceiptPaper {
  widthMm: number;
  /**
   * Berapa karakter muat dalam satu baris. Angka inilah yang dipakai penata letak
   * struk: lebar 58 mm = 32 kolom, 80 mm = 48 kolom (font printer 12 cpi).
   */
  cols: number;
  /** Label untuk tombol pilihan: `80 mm`. */
  label: string;
}

export interface ReceiptPrinter {
  id: ReceiptPrinterId;
  /** Nama pendek untuk tombol & lencana: `Thermal`. */
  label: string;
  /** Nama lengkap seperti di katalog: `Printer Thermal (Thermal Printer)`. */
  title: string;
  /** Bagaimana ia mencetak — sebab di balik kelebihan & kekurangannya. */
  how: string;
  pros: string[];
  cons: string[];
  /** Siapa yang cocok memakainya. */
  fits: string;
  /** Contoh produknya di pasaran. */
  examples: string;
  /** Cara tersambungnya ke perangkat kasir. */
  connection: string;
  papers: ReceiptPaper[];
  /**
   * Berapa lembar sekaligus yang bisa keluar. Hanya printer **impact** (dot
   * matrix) yang bisa memukul pita karbon ke kertas tembusan, jadi hanya ia yang
   * lebih dari satu.
   */
  maxCopies: number;
}

/**
 * Tiga keluarga printer struk belanja, urut dari yang paling banyak dipakai UMKM.
 * Keterangannya sengaja menyebut **kekurangan** juga: pemilik toko yang memilih
 * printer dot matrix karena fakturnya butuh rangkap harus tahu bahwa mesinnya
 * bising dan lambat, bukan baru tahu setelah membelinya.
 */
export const RECEIPT_PRINTERS: ReceiptPrinter[] = [
  {
    id: "thermal",
    label: "Thermal",
    title: "Printer Thermal (Thermal Printer)",
    how: "Menggunakan elemen pemanas untuk membakar lapisan kimia pada kertas thermal.",
    pros: [
      "Proses cetak sangat cepat",
      "Tidak berisik",
      "Tidak butuh penggantian tinta atau pita",
    ],
    cons: ["Hasil cetak bisa memudar seiring waktu jika terkena panas atau minyak"],
    fits: "Kafe, restoran, minimarket, toko ritel, dan UMKM",
    examples: "Epson TM-T82X atau Sano P58B",
    connection: "USB, LAN, atau Bluetooth",
    papers: [
      { widthMm: 58, cols: 32, label: "58 mm" },
      { widthMm: 80, cols: 48, label: "80 mm" },
    ],
    maxCopies: 1,
  },
  {
    id: "dot_matrix",
    label: "Dot matrix",
    title: "Printer Dot Matrix (Impact Printer)",
    how: "Menggunakan jarum-jarum kecil (pinhead) yang memukul pita karbon ke kertas.",
    pros: [
      "Bisa mencetak rangkap (tembusan karbon, seperti faktur atau nota dobel)",
      "Tahan lama di lingkungan panas",
    ],
    cons: ["Suara mesin cukup bising", "Kecepatan cetak lebih lambat"],
    fits: "Supermarket besar, apotek, atau gudang yang butuh arsip fisik rangkap",
    examples: "Epson TM-U220 (gulungan 76 mm) atau LX-300 (faktur kontinu)",
    connection: "USB, LAN, atau serial (kabel)",
    papers: [
      { widthMm: 76, cols: 40, label: "76 mm" },
      { widthMm: 241, cols: 80, label: "241 mm" },
    ],
    maxCopies: 3,
  },
  {
    id: "portable",
    label: "Portable",
    title: "Printer Portable / Mobile (Bluetooth)",
    how: "Printer thermal berukuran kecil yang ditenagai baterai isi ulang dan terhubung via Bluetooth ke ponsel/tablet.",
    pros: ["Ringkas, bisa dibawa-bawa (mobile)", "Praktis untuk transaksi tanpa kabel"],
    cons: ["Kapasitas gulungan kertas lebih kecil"],
    fits: "Kasir keliling, layanan PPOB, atau restoran dengan sistem pesan meja (table ordering)",
    examples: "Printer struk Bluetooth 58 mm (mis. Sano P58B series)",
    connection: "Bluetooth, baterai isi ulang",
    papers: [{ widthMm: 58, cols: 32, label: "58 mm" }],
    maxCopies: 1,
  },
];

// ------------------------------------------------------------------- batasan

/** Paling banyak tiga lembar — lebih dari itu tidak ada yang membacanya. */
export const RECEIPT_COPIES_MAX = 3;

/** Catatan kaki struk: dua baris, masing-masing paling banyak 40 karakter. */
export const RECEIPT_FOOTER_MAX_LINES = 2;
export const RECEIPT_FOOTER_LINE_MAX = 40;

/** Catatan kaki bawaan — kalimat yang sudah dipakai aplikasi ini di struknya. */
export const RECEIPT_FOOTER_DEFAULT = "Terima kasih telah berbelanja";

/** Nama produk panjang dibungkus sampai dua baris, sisanya dipotong. */
export const RECEIPT_ITEM_NAME_MAX_LINES = 2;

/**
 * Nama pembeli yang tercetak di struk kalau kasir tidak memilih member.
 *
 * “Cash” dipakai karena baris pembeli **selalu** tercetak: struk tanpa nama
 * membuat kertas di tangan pelanggan tidak bisa ditelusuri lagi saat
 * transaksinya dipertanyakan, sedangkan label kosong hanya menyisakan tanda
 * tanya. Pembeli umum memang tidak punya member — namanya itu.
 */
export const RECEIPT_WALK_IN_NAME = "Cash";

// -------------------------------------------------------------------- bentuk

export interface ReceiptSetting {
  /** Jenis printernya (`RECEIPT_PRINTERS`). */
  printerId: ReceiptPrinterId;
  /** Lebar kertas yang dipakai, dalam milimeter (salah satu `printer.papers`). */
  paperWidthMm: number;
  /**
   * Berapa lembar yang keluar sekali cetak. Hanya printer dot matrix yang bisa
   * lebih dari satu; di printer lain nilainya selalu 1.
   */
  copies: number;
  /** Kalimat penutup di bawah struk; boleh berisi satu baris baru (maks dua baris). */
  footerText: string;
}

/** Bawaan: thermal 80 mm sekali cetak — perilaku yang sudah ada sebelum setelan ini. */
export const DEFAULT_RECEIPT_SETTING: ReceiptSetting = {
  printerId: "thermal",
  paperWidthMm: 80,
  copies: 1,
  footerText: RECEIPT_FOOTER_DEFAULT,
};

/** Kolom tenant boleh sebagian (dan boleh belum ada) — sisanya default. */
export type ReceiptSettingSource = Partial<ReceiptSetting> | null | undefined;

/** Printer berdasarkan id; id yang tidak dikenal jatuh ke printer pertama. */
export function receiptPrinterOf(printerId: unknown): ReceiptPrinter {
  return (
    RECEIPT_PRINTERS.find((printer) => printer.id === printerId) ?? RECEIPT_PRINTERS[0]
  );
}

/**
 * Kertas yang dipakai kalau lebar yang diminta tidak didukung printer ini:
 * yang **terdekat** dengan permintaannya, bukan yang pertama di daftar.
 *
 * `papers` diurutkan dari yang tersempit, jadi “kertas pertama” selalu yang
 * paling sempit — dan itu pilihan yang salah arah: pemilik toko yang memilih
 * kertas 76 mm lalu mengganti mesinnya ke printer thermal jelas tidak ingin
 * struknya menyusut ke 58 mm (32 kolom, nama produk gampang terpotong). Kertas
 * terdekat menjaga lebar yang dipilihnya sedekat mungkin; kalau jaraknya sama,
 * yang lebih lebar menang karena baris yang lebih lapang lebih jarang memotong
 * nama produk.
 */
export function nearestReceiptPaper(
  printer: ReceiptPrinter,
  widthMm: unknown,
): ReceiptPaper {
  // Angka yang dikirim sebagai teks (mis. dari baris tenant lama) tetap dibaca;
  // hanya yang benar-benar tidak bisa dibaca yang jatuh ke kertas pertama.
  const diminta = typeof widthMm === "string" ? Number(widthMm) : widthMm;
  if (typeof diminta !== "number" || !Number.isFinite(diminta)) {
    return printer.papers[0];
  }
  return printer.papers.reduce((best, paper) => {
    const selisihBest = Math.abs(best.widthMm - diminta);
    const selisihPaper = Math.abs(paper.widthMm - diminta);
    if (selisihPaper < selisihBest) return paper;
    if (selisihPaper === selisihBest && paper.widthMm > best.widthMm) return paper;
    return best;
  }, printer.papers[0]);
}

/**
 * Kertas yang sedang dipakai; lebar yang tidak didukung printer ini
 * menyesuaikan sendiri ke kertas terdekat yang benar-benar bisa dipakai mesinnya
 * (`nearestReceiptPaper`), jadi tidak ada kombinasi printer–kertas yang mustahil.
 */
export function receiptPaperOf(printer: ReceiptPrinter, widthMm: unknown): ReceiptPaper {
  return nearestReceiptPaper(printer, widthMm);
}

/** Berapa karakter muat per baris dengan setelan ini. */
export function receiptCols(setting: ReceiptSetting): number {
  return receiptPaperOf(receiptPrinterOf(setting.printerId), setting.paperWidthMm).cols;
}

/** Label lebar kertas + kolomnya: `80 mm · 48 kolom`. */
export function receiptPaperLabel(setting: ReceiptSetting): string {
  const printer = receiptPrinterOf(setting.printerId);
  const paper = receiptPaperOf(printer, setting.paperWidthMm);
  return `${paper.label} · ${paper.cols} kolom`;
}

/** Merapikan angka rangkap: bilangan bulat, 1..kemampuan printernya. */
export function clampReceiptCopies(printer: ReceiptPrinter, copies: unknown): number {
  const raw = typeof copies === "string" ? Number(copies) : copies;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
  const stepped = Math.round(raw);
  return Math.min(Math.min(printer.maxCopies, RECEIPT_COPIES_MAX), Math.max(1, stepped));
}

/**
 * Merapikan catatan kaki: kendali yang tidak terlihat dibuang, spasi pinggir dan
 * ganda dirapikan, tiap baris dipotong 40 karakter, dan paling banyak dua baris.
 * Kalimat yang tersisa kosong berarti **tanpa catatan kaki** (bukan kembali ke
 * bawaan): pemilik toko yang memang tidak ingin menulis apa-apa tidak boleh
 * dikirimi kalimat yang ia hapus sendiri.
 */
export function normalizeReceiptFooter(text: unknown): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/\r\n?/g, "\n")
    // Kendali tak terlihat (tab, bell) tidak punya arti di kertas struk.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim().slice(0, RECEIPT_FOOTER_LINE_MAX))
    .filter((line) => line !== "")
    .slice(0, RECEIPT_FOOTER_MAX_LINES)
    .join("\n");
}

/** Baris-baris catatan kaki yang benar-benar dicetak (boleh kosong). */
export function receiptFooterLines(setting: ReceiptSetting): string[] {
  return normalizeReceiptFooter(setting.footerText)
    .split("\n")
    .filter((line) => line !== "");
}

/**
 * Membaca setelan struk dari baris tenant/sesi. Nilai yang rusak/asing **tidak**
 * menggagalkan pembacaan: bidang itu kembali ke bawaannya, karena setelan printer
 * yang gagal dibaca tidak boleh membuat kasir tidak bisa mencetak struk.
 */
export function receiptSettingOf(source: ReceiptSettingSource): ReceiptSetting {
  if (!source) return { ...DEFAULT_RECEIPT_SETTING };

  const printer = receiptPrinterOf(source.printerId);
  const paper = receiptPaperOf(printer, source.paperWidthMm);
  const footer =
    source.footerText === undefined
      ? DEFAULT_RECEIPT_SETTING.footerText
      : normalizeReceiptFooter(source.footerText);

  return {
    printerId: printer.id,
    paperWidthMm: paper.widthMm,
    copies: clampReceiptCopies(printer, source.copies),
    footerText: footer,
  };
}

/** Dua setelan dianggap sama kalau hasil cetaknya sama persis. */
export function sameReceiptSetting(a: ReceiptSetting, b: ReceiptSetting): boolean {
  return (
    a.printerId === b.printerId &&
    a.paperWidthMm === b.paperWidthMm &&
    a.copies === b.copies &&
    normalizeReceiptFooter(a.footerText) === normalizeReceiptFooter(b.footerText)
  );
}

/**
 * Mengganti jenis printer tanpa membuat setelannya tidak sah: lebar kertas yang
 * tidak didukung printer baru jatuh ke lebar bawaannya, dan rangkap yang melebihi
 * kemampuannya dipangkas — supaya tombol printer bisa ditekan kapan saja tanpa
 * meninggalkan setelan yang akan ditolak server.
 */
export function receiptSettingWithPrinter(
  setting: ReceiptSetting,
  printerId: ReceiptPrinterId,
): ReceiptSetting {
  const printer = receiptPrinterOf(printerId);
  const paper = receiptPaperOf(printer, setting.paperWidthMm);
  return {
    ...setting,
    printerId: printer.id,
    paperWidthMm: paper.widthMm,
    copies: clampReceiptCopies(printer, setting.copies),
  };
}

/** Mengganti lebar kertas; lebar yang tidak didukung printer ini diabaikan. */
export function receiptSettingWithPaper(
  setting: ReceiptSetting,
  widthMm: number,
): ReceiptSetting {
  const printer = receiptPrinterOf(setting.printerId);
  const paper = printer.papers.find((p) => p.widthMm === widthMm);
  if (!paper) return setting;
  return { ...setting, paperWidthMm: paper.widthMm };
}

/** Mengganti jumlah rangkap (dipangkas ke kemampuan printer). */
export function receiptSettingWithCopies(
  setting: ReceiptSetting,
  copies: number,
): ReceiptSetting {
  const printer = receiptPrinterOf(setting.printerId);
  return { ...setting, copies: clampReceiptCopies(printer, copies) };
}

// ------------------------------------------------------------------ validasi

export type ReceiptDecision =
  | { ok: true; value: ReceiptSetting }
  | { ok: false; reason: string };

/** Daftar lebar kertas sebuah printer untuk kalimat penolakan: `58 mm atau 80 mm`. */
function paperList(printer: ReceiptPrinter): string {
  const labels = printer.papers.map((paper) => paper.label);
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} atau ${labels[labels.length - 1]}`;
}

/**
 * Memeriksa setelan struk sebelum disimpan. Setiap penolakan menyebut **akibatnya
 * di kertas**, bukan hanya aturannya: pemilik toko yang meminta dua rangkap di
 * printer thermal harus tahu kenapa tidak bisa, bukan sekadar "nilai tidak sah".
 */
export function validateReceiptSetting(input: unknown): ReceiptDecision {
  if (!input || typeof input !== "object") {
    return {
      ok: false,
      reason: "Setelan struk harus berupa pilihan printer, lebar kertas, dan rangkapnya.",
    };
  }
  const raw = input as Partial<ReceiptSetting>;

  const printer = RECEIPT_PRINTERS.find((item) => item.id === raw.printerId);
  if (!printer) {
    return {
      ok: false,
      reason:
        "Jenis printer struk hanya Thermal, Dot Matrix, atau Portable. Pilih salah satunya.",
    };
  }

  const paper = printer.papers.find((item) => item.widthMm === raw.paperWidthMm);
  if (!paper) {
    return {
      ok: false,
      reason:
        `Printer ${printer.label} memakai kertas ${paperList(printer)}. ` +
        `Lebar ${raw.paperWidthMm ?? "-"} mm tidak tersedia untuk printer ini.`,
    };
  }

  const copiesRaw = raw.copies;
  if (typeof copiesRaw !== "number" || !Number.isFinite(copiesRaw)) {
    return { ok: false, reason: "Jumlah rangkap struk harus berupa angka." };
  }
  const copies = Math.round(copiesRaw);
  if (copies < 1) {
    return {
      ok: false,
      reason: "Setiap penjualan mencetak minimal satu lembar struk — rangkapnya tidak bisa nol.",
    };
  }
  if (copies > printer.maxCopies) {
    if (printer.maxCopies === 1) {
      return {
        ok: false,
        reason:
          `Printer ${printer.label} tidak bisa mencetak tembusan karbon: yang keluar ` +
          `hanya lembaran thermal, bukan salinan karbon. Faktur rangkap butuh printer ` +
          `Dot Matrix.`,
      };
    }
    return {
      ok: false,
      reason: `Printer ${printer.label} paling banyak ${printer.maxCopies} lembar sekali cetak.`,
    };
  }

  const footerRaw = normalizeReceiptFooter(raw.footerText);
  if (typeof raw.footerText === "string") {
    const requested = raw.footerText
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .filter((line) => line.trim() !== "");
    if (requested.length > RECEIPT_FOOTER_MAX_LINES) {
      return {
        ok: false,
        reason: `Catatan kaki struk paling banyak ${RECEIPT_FOOTER_MAX_LINES} baris.`,
      };
    }
    const tooLong = requested.find(
      (line) => line.replace(/\s+/g, " ").trim().length > RECEIPT_FOOTER_LINE_MAX,
    );
    if (tooLong) {
      return {
        ok: false,
        reason:
          `Satu baris catatan kaki paling banyak ${RECEIPT_FOOTER_LINE_MAX} karakter ` +
          `supaya tidak terpotong di kertas ${paper.label}.`,
      };
    }
  }

  return {
    ok: true,
    value: {
      printerId: printer.id,
      paperWidthMm: paper.widthMm,
      copies,
      footerText: footerRaw,
    },
  };
}

// ------------------------------------------------------------------ kalimat

/** `1 lembar (asli)` … `3 lembar (asli + 2 tembusan)`. */
export function receiptCopiesLabel(setting: ReceiptSetting): string {
  const copies = clampReceiptCopies(receiptPrinterOf(setting.printerId), setting.copies);
  if (copies === 1) return "1 lembar (asli)";
  return `${copies} lembar (asli + ${copies - 1} tembusan)`;
}

/** Kalimat siap-baca untuk lencana & notis: apa yang akan keluar dari printernya. */
export function receiptSettingSentence(setting: ReceiptSetting): string {
  const printer = receiptPrinterOf(setting.printerId);
  const paper = receiptPaperOf(printer, setting.paperWidthMm);
  const parts = [
    `Struk dicetak printer ${printer.label} di kertas ${paper.label} (${paper.cols} kolom)`,
    receiptCopiesLabel(setting),
  ];
  const footer = receiptFooterLines(setting);
  if (footer.length > 0) parts.push(`catatan kaki “${footer.join(" / ")}”`);
  return `${parts.join(", ")}.`;
}

/**
 * Akibat lebar kertas bagi isi struk — disebut apa adanya, termasuk batasnya,
 * supaya pemilik toko tahu kenapa nama produk panjang tampil dua baris.
 */
export function receiptWidthHint(setting: ReceiptSetting): string {
  const printer = receiptPrinterOf(setting.printerId);
  const paper = receiptPaperOf(printer, setting.paperWidthMm);
  return (
    `Satu baris muat ${paper.cols} karakter. Nama produk yang lebih panjang ` +
    `dilanjutkan ke baris berikutnya (paling banyak ${RECEIPT_ITEM_NAME_MAX_LINES} baris, ` +
    `sisanya dipotong dengan “...”) supaya jumlah dan harganya tetap lurus di kolom kanan.`
  );
}

/** Kalimat untuk pilihan rangkap — kenapa printer ini terbatas. */
export function receiptCopiesHint(setting: ReceiptSetting): string {
  const printer = receiptPrinterOf(setting.printerId);
  if (printer.maxCopies === 1) {
    return (
      `${printer.label} hanya bisa satu lembar: tidak ada pita karbon yang bisa ` +
      `ditembus, jadi rangkap tidak mungkin di printer ini. Nota dobel butuh printer ` +
      `Dot Matrix.`
    );
  }
  return (
    `Sampai ${printer.maxCopies} lembar sekali cetak: lembar pertama ditandai “ASLI”, ` +
    `sisanya “TEMBUSAN 1…” untuk arsip. Tiap lembar memakai satu kertas tembusan, ` +
    `jadi biaya kertasnya ikut naik.`
  );
}

// ------------------------------------------------------------- saran otomatis

/**
 * Bentuk workspace yang menentukan saran setelan struknya.
 *
 * Dasarnya **modul** yang sedang hidup (`tenants.verticals`), bukan paket
 * langganannya: yang menentukan bentuk nota adalah apa yang dijual tokonya
 * (menyajikan makanan, menjual grosir, atau ritel biasa), bukan berapa yang
 * dibayarnya per bulan.
 */
export interface ReceiptSuggestionInput {
  /** Modul utama workspace (`tenants.vertical`). */
  vertical?: string | null;
  /** Modul yang sedang hidup. */
  verticals?: readonly string[] | null;
}

/** Saran setelan beserta alasan yang bisa dibaca pemilik toko. */
export interface ReceiptSuggestion {
  setting: ReceiptSetting;
  /** Dasar penentuannya, untuk lencana: `Modul Grosir & Wholesale`. */
  basis: string;
  /** Kenapa printer & kertas itu yang disarankan — menyebut akibatnya di kertas. */
  reason: string;
}

/**
 * Menyarankan setelan struk dari modul workspace.
 *
 * Kenapa saran, bukan penentuan sendiri: **peramban tidak bisa mendeteksi
 * printer yang terpasang** — tidak ada API-nya. Memilih “dot matrix” untuk toko
 * grosir lalu ternyata mesin di kasirnya thermal membuat struknya tidak keluar
 * sama sekali, dan itu kegagalan yang jauh lebih mahal daripada satu klik. Yang
 * bisa dipastikan mesin, hanya pemiliknya; karena itu aturan di sini memilih
 * **satu jawaban yang paling masuk akal beserta alasannya**, ditawarkan sebagai
 * satu klik di halaman Pengaturan — bukan ditulis diam-diam ke setelannya.
 *
 * Yang benar-benar otomatis tanpa bertanya adalah yang tidak menyangkut mesin
 * fisik: lebar kertas menyesuaikan jenis printer yang dipilih
 * (`nearestReceiptPaper`), rangkapnya dipangkas ke kemampuan printernya
 * (`clampReceiptCopies`), dan ukuran kertas di dialog cetak
 * (`receiptPrintCss`).
 */
export function suggestReceiptSetting(
  input: ReceiptSuggestionInput,
): ReceiptSuggestion {
  const modules = new Set<string>(
    [...(input.verticals ?? []), input.vertical ?? ""].filter((id) => id !== ""),
  );

  /*
    Grosir **tanpa** F&B: nota tempo ditandatangani & diarsipkan, jadi tembusan
    karbonnya bernilai. Kalau F&B-nya ikut hidup (kafe yang juga menjual grosir),
    meja kasirnya tetap melayani pembeli langsung, jadi jalur thermal yang dipilih
    — bukan jalur faktur.
  */
  if (modules.has("wholesale") && !modules.has("fnb")) {
    return {
      setting: {
        printerId: "dot_matrix",
        paperWidthMm: 76,
        copies: 2,
        footerText: RECEIPT_FOOTER_DEFAULT,
      },
      basis: "Modul Grosir & Wholesale",
      reason:
        "Penjualan grosir hampir selalu butuh arsip: gunakan printer dot matrix yang " +
        "mencetak asli + 1 tembusan sekaligus, di kertas 76 mm (40 kolom) yang " +
        "selebar gulungan printer impact. Tembusan karbon hanya bisa di printer " +
        "berpita, jadi printer thermal tidak bisa menggantikannya.",
    };
  }

  if (modules.has("fnb")) {
    return {
      setting: {
        printerId: "thermal",
        paperWidthMm: 80,
        copies: 1,
        footerText: RECEIPT_FOOTER_DEFAULT,
      },
      basis: "Modul F&B",
      reason:
        "Nama menu dan catatan pesanannya panjang, sehingga kertas 80 mm dipilih " +
        "(48 kolom per baris) supaya namanya tidak terpotong ke baris kedua. " +
        "Satu lembar sudah cukup: printer thermal tidak bisa tembusan karbon.",
    };
  }

  return {
    setting: {
      printerId: "thermal",
      paperWidthMm: 80,
      copies: 1,
      footerText: RECEIPT_FOOTER_DEFAULT,
    },
    basis: "UMKM & Retail Mikro",
    reason:
      "Kertas 80 mm (48 kolom per baris) adalah ukuran thermal yang paling banyak " +
      "dipakai kasir ritel dan cukup lebar untuk nama produk tanpa terpotong. " +
      "Satu lembar sudah cukup karena strukturnya tidak bertembusan.",
  };
}

/**
 * Apakah pilihan mesinnya (printer, kertas, rangkap) sudah sama dengan saran.
 *
 * Catatan kaki **tidak** ikut dibandingkan: ia kalimat milik pemilik toko, bukan
 * bagian dari pilihan mesin — menekan “pakai saran” tidak boleh menghapus kalimat
 * yang sedang ia ketik.
 */
export function sameReceiptPrinterChoice(
  a: ReceiptSetting,
  b: ReceiptSetting,
): boolean {
  return (
    a.printerId === b.printerId &&
    a.paperWidthMm === b.paperWidthMm &&
    clampReceiptCopies(receiptPrinterOf(a.printerId), a.copies) ===
      clampReceiptCopies(receiptPrinterOf(b.printerId), b.copies)
  );
}

// ----------------------------------------------------------------- tata letak

/** Memotong teks ke lebar kolom; yang dipotong diberi penanda `...`. */
function fit(text: string, cols: number): string {
  if (cols <= 0) return "";
  if (text.length <= cols) return text;
  if (cols <= 3) return text.slice(0, cols);
  return `${text.slice(0, cols - 3)}...`;
}

/**
 * Membungkus teks ke beberapa baris selebar `cols`, paling banyak `maxLines`.
 * Baris terakhir dipotong dengan `...` kalau masih ada sisa — supaya baris struk
 * berikutnya tidak bergeser.
 */
export function receiptWrap(text: string, cols: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return [""];

  // Semua baris dibungkus dulu tanpa batas, baru dipangkas ke `maxLines` — supaya
  // "apakah masih ada sisa?" dijawab oleh jumlah baris yang sebenarnya, bukan
  // perkiraan di tengah perulangan.
  const all: string[] = [];
  let current = "";
  for (const word of words) {
    if (current === "") {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length <= cols) {
      current = `${current} ${word}`;
      continue;
    }
    all.push(current);
    current = word;
  }
  all.push(current);

  const shown = all.slice(0, Math.max(1, maxLines));
  if (shown.length < all.length) {
    const last = shown[shown.length - 1];
    shown[shown.length - 1] =
      cols > 4 ? `${fit(last, cols - 4)} ...` : fit(last, cols);
  }
  return shown.map((line) => fit(line, cols));
}

/** Satu baris dua kolom: label di kiri, nominal di kanan, rata kanan. */
export function receiptRow(left: string, right: string, cols: number): string {
  const amount = right.trim();
  if (amount.length >= cols) return fit(left.trim(), cols);
  const room = cols - amount.length - 1;
  const label = fit(left.trim(), Math.max(0, room));
  const pad = " ".repeat(Math.max(1, cols - label.length - amount.length));
  return `${label}${pad}${amount}`;
}

/** Teks di tengah baris (dipakai nama toko & catatan kaki). */
export function receiptCenter(text: string, cols: number): string {
  const label = fit(text.trim(), cols);
  const pad = Math.max(0, Math.floor((cols - label.length) / 2));
  return `${" ".repeat(pad)}${label}`;
}

/** Garis pemisah selebar kertasnya. */
export function receiptSeparator(cols: number, char = "-"): string {
  return char.repeat(Math.max(1, cols));
}

/** Satu baris barang di struk. */
export interface ReceiptItemLine {
  name: string;
  qty: number;
  /** Harga satuan (opsional); kalau ada, ditulis `2 x Rp 14.000`. */
  unitPrice?: number;
  /** Jumlah yang dibayar untuk baris ini (sudah termasuk modifier & diskon). */
  amount: number;
}

/**
 * Nama kasir yang dicetak di baris `Kasir` — dipangkas dulu.
 *
 * Berbeda dengan nama pembeli, di sini **tidak ada** nama pengganti: kekosongan
 * berarti nama kasirnya memang tidak diketahui, dan baris “Kasir : -” hanya
 * menambah kebisingan di kertas. Baris itu dilewati saja (`receiptDocument`).
 */
export function receiptStaffName(name: unknown): string {
  return typeof name === "string" ? name.trim() : "";
}

/**
 * Nama pembeli yang dicetak di baris `Member`.
 *
 * Kosong (termasuk nama yang cuma berisi spasi) dihitung sebagai “tidak dipilih”
 * dan menjadi `RECEIPT_WALK_IN_NAME` — bukan baris kosong. Aturannya ada di sini,
 * bukan di halaman kasir, supaya pratinjau di halaman Pengaturan dan struk yang
 * benar-benar keluar dari printer tidak pernah berbeda soal nama pembelinya.
 */
export function receiptBuyerName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed === "" ? RECEIPT_WALK_IN_NAME : trimmed;
}

/**
 * URL logo yang benar-benar dipakai; kosong/berisi spasi dihitung tidak ada.
 *
 * Aturannya di sini supaya pratinjau di halaman Pengaturan dan struk yang dicetak
 * kasir sepakat soal “workspace ini punya logo atau tidak” dari sumber yang sama.
 */
export function receiptLogoUrl(url: unknown): string | null {
  const trimmed = typeof url === "string" ? url.trim() : "";
  return trimmed === "" ? null : trimmed;
}

/**
 * Sisi kotak logo di struk, dalam piksel CSS: **110 px × 110 px**.
 *
 * Ukurannya sengaja tetap, tidak mengikuti lebar kertas: logo yang melebar
 * bersama kertas (dulu separuh lebar kertas) mendorong nama usaha dan daftar
 * barangnya turun, bahkan ke halaman berikutnya di printer dot matrix. 110 px
 * (≈ 29 mm) cukup besar untuk dikenali di kertas 58 mm maupun faktur 241 mm.
 * Kotaknya persegi, jadi logo yang tidak persegi dipaskan dengan `object-contain`
 * — bukan diregangkan sampai gepeng.
 */
export const RECEIPT_LOGO_SIZE_PX = 110;

/**
 * Saringan warna logo di struk: **hitam putih, seperti teksnya**.
 *
 * Printer struk hanya punya satu warna tinta, dan printer kantor sering diatur
 * mode hitam putih — logo berwarna yang dibiarkan apa adanya keluar sebagai
 * bercak kelabu yang tidak menyerupai teks di bawahnya. `grayscale(1)` memaksa
 * seluruh warnanya jadi abu-abu (di layar pratinjau sekaligus di kertas, termasuk
 * kalau printernya berwarna), sedangkan `contrast(1.35)` memadatkan bagian
 * gelapnya supaya garis dan huruf logonya tetap tegas dibaca.
 */
export const RECEIPT_LOGO_FILTER = "grayscale(1) contrast(1.35)";

/** Isi struk yang mau dicetak, sudah dalam angka final. */
export interface ReceiptDraft {
  business: string;
  store?: string;
  /** Nomor dokumen, mis. `A-00042`. */
  number?: string;
  /** Tanggal siap-baca. */
  when?: string;
  /** Nama member yang dipilih kasir; kosong = pembeli umum, tercetak “Cash”. */
  member?: string;
  /** Nama kasir yang melayani; kosong = baris `Kasir` tidak dicetak. */
  cashier?: string;
  /**
   * Logo toko (data URL di mode demo, URL bertanda tangan di mode Convex).
   * Kosong = struk tanpa logo, sama seperti sebelum kolomnya ada.
   */
  logoUrl?: string;
  /** Catatan mencolok di bawah identitas, mis. “Belum dibayar — tagihan sementara”. */
  notice?: string;
  items: ReceiptItemLine[];
  subtotal?: number;
  discount?: number;
  taxLabel?: string;
  taxAmount?: number;
  serviceLabel?: string;
  serviceAmount?: number;
  total: number;
  paid?: number;
  change?: number;
}

/** Satu lembar yang keluar dari printer. */
export interface ReceiptSheet {
  /** 0 = lembar pertama. */
  copyIndex: number;
  /** `ASLI` / `TEMBUSAN 1`; kosong kalau struknya memang cuma satu lembar. */
  copyLabel: string;
  lines: string[];
}

export interface ReceiptDocument {
  printer: ReceiptPrinter;
  paper: ReceiptPaper;
  cols: number;
  copies: number;
  /** Logo yang dicetak di atas nama usaha; `null` = struk tanpa logo. */
  logoUrl: string | null;
  /**
   * Sisi kotak logo di kertas, dalam piksel CSS (`RECEIPT_LOGO_SIZE_PX`) — sama
   * untuk semua jenis printer & lebar kertas. Dibawa walaupun tidak ada logo,
   * supaya ukurannya satu tempat saja.
   */
  logoSizePx: number;
  /**
   * Saringan warna logo (`RECEIPT_LOGO_FILTER`): hitam putih, sama seperti teks
   * struknya.
   */
  logoFilter: string;
  /** Satu lembar per rangkap; `copies: 1` berarti satu lembar tanpa penanda. */
  sheets: ReceiptSheet[];
}

/**
 * Menyusun teks struk siap cetak dari setelan + isi penjualannya.
 *
 * Teksnya dikembalikan sebagai baris selebar `cols` (bukan HTML): itulah yang
 * benar-benar dikirim ke printer struk, jadi yang diuji di sini adalah karakter
 * yang sama dengan yang keluar di kertas — termasuk pembungkusan nama, kolom
 * nominal, penanda rangkap, dan catatan kaki.
 *
 * Logo toko adalah **satu-satunya bagian yang bukan teks**: ia dikembalikan
 * sebagai URL + ukuran kotak & saringan warnanya (`logoUrl`, `logoSizePx`,
 * `logoFilter`), lalu digambar elemen `<img>` di pratinjau & area cetak. Ukuran dan
 * warnanya ditetapkan di sini supaya pratinjau di halaman Pengaturan tidak pernah
 * berbeda dari kertas yang keluar di kasir — 110 px × 110 px dan hitam putih.
 */
export function receiptDocument(
  setting: ReceiptSetting,
  draft: ReceiptDraft,
): ReceiptDocument {
  const printer = receiptPrinterOf(setting.printerId);
  const paper = receiptPaperOf(printer, setting.paperWidthMm);
  const cols = paper.cols;
  const logoUrl = receiptLogoUrl(draft.logoUrl);

  const lines: string[] = [];
  lines.push(receiptCenter(draft.business, cols));
  if (draft.store) lines.push(receiptCenter(draft.store, cols));
  lines.push(receiptSeparator(cols, "="));
  if (draft.notice) lines.push(receiptCenter(draft.notice, cols));
  if (draft.number) lines.push(fit(`No. ${draft.number}`, cols));
  if (draft.when) lines.push(fit(`Tanggal ${draft.when}`, cols));
  // Selalu satu baris, juga untuk pembeli umum: kasir tidak perlu memilih apa pun
  // agar struknya tetap bisa ditelusuri (`receiptBuyerName`).
  lines.push(fit(`Member : ${receiptBuyerName(draft.member)}`, cols));
  // Baris kasir dilewati kalau namanya tidak diketahui — kasir yang sedang berdiri
  // di depan mesin selalu punya nama, jadi kekosongan berarti datanya memang tidak
  // ada, bukan sesuatu yang perlu dicetak sebagai tanda hubung.
  const cashier = receiptStaffName(draft.cashier);
  if (cashier !== "") lines.push(fit(`Kasir : ${cashier}`, cols));
  lines.push(receiptSeparator(cols));

  for (const item of draft.items) {
    for (const nameLine of receiptWrap(item.name, cols, RECEIPT_ITEM_NAME_MAX_LINES)) {
      if (nameLine !== "") lines.push(nameLine);
    }
    const left =
      item.unitPrice !== undefined && Number.isFinite(item.unitPrice)
        ? `${item.qty} x ${formatIdrPlain(item.unitPrice)}`
        : `${item.qty} item`;
    lines.push(receiptRow(left, formatIdrPlain(item.amount), cols));
  }

  lines.push(receiptSeparator(cols));
  if (draft.subtotal !== undefined) {
    lines.push(receiptRow("Subtotal", formatIdrPlain(draft.subtotal), cols));
  }
  if (draft.discount !== undefined && draft.discount > 0) {
    lines.push(receiptRow("Diskon", `-${formatIdrPlain(draft.discount)}`, cols));
  }
  if (draft.taxAmount !== undefined && draft.taxAmount > 0) {
    lines.push(
      receiptRow(draft.taxLabel ?? "Pajak", formatIdrPlain(draft.taxAmount), cols),
    );
  }
  if (draft.serviceAmount !== undefined && draft.serviceAmount > 0) {
    lines.push(
      receiptRow(
        draft.serviceLabel ?? "Biaya layanan",
        formatIdrPlain(draft.serviceAmount),
        cols,
      ),
    );
  }
  lines.push(receiptRow("TOTAL", formatIdrPlain(draft.total), cols));
  if (draft.paid !== undefined) {
    lines.push(receiptRow("Bayar", formatIdrPlain(draft.paid), cols));
  }
  if (draft.change !== undefined && draft.change > 0) {
    lines.push(receiptRow("Kembali", formatIdrPlain(draft.change), cols));
  }
  lines.push(receiptSeparator(cols));

  const footer = receiptFooterLines(setting);
  for (const footerLine of footer) lines.push(receiptCenter(footerLine, cols));

  const copies = clampReceiptCopies(printer, setting.copies);
  const sheets: ReceiptSheet[] =
    copies === 1
      ? [{ copyIndex: 0, copyLabel: "", lines }]
      : Array.from({ length: copies }, (_unused, index) => ({
          copyIndex: index,
          copyLabel: index === 0 ? "ASLI" : `TEMBUSAN ${index}`,
          lines: [
            receiptCenter(index === 0 ? "ASLI" : `TEMBUSAN ${index}`, cols),
            receiptSeparator(cols, "-"),
            ...lines,
          ],
        }));

  return {
    printer,
    paper,
    cols,
    copies,
    logoUrl,
    logoSizePx: RECEIPT_LOGO_SIZE_PX,
    logoFilter: RECEIPT_LOGO_FILTER,
    sheets,
  };
}

// ------------------------------------------------------------- kertas cetak

/**
 * Metrik satu baris struk saat dicetak, dalam milimeter: 11 px ≈ 2,91 mm dengan
 * jarak baris rapat (1,25 × 11 px ≈ 3,64 mm).
 *
 * Angka ini **satu sumber** untuk dua hal sekaligus: tinggi kertas yang dihitung
 * di bawah, dan ukuran huruf yang benar-benar dipakai lembar cetaknya
 * (`receiptPrintCss` menuliskannya ke `.struk-cetak pre`). Kalau keduanya bisa
 * berbeda, tinggi halamannya salah hitung — kertasnya terpotong atau malah
 * menyisakan halaman kosong.
 */
export const RECEIPT_PRINT_FONT_MM = 2.91;
export const RECEIPT_PRINT_LINE_MM = 3.64;

/**
 * Sisi kotak logo saat dicetak, dalam milimeter — sama dengan
 * `RECEIPT_LOGO_SIZE_PX` (110 px). Logo menambah tinggi kertas, **tidak** lebarnya.
 */
export const RECEIPT_PRINT_LOGO_MM = 29.11;

/**
 * Margin cetak: kertas sempit (≤ 60 mm) memakai 2 mm, selebihnya 4 mm.
 *
 * Kertas 58 mm hanya memuat 32 kolom, dan margin 4 mm di kiri-kanannya memakan
 * ruang yang tidak tergantikan — teksnya jadi lebih sempit dari kertasnya sendiri.
 */
export const RECEIPT_NARROW_PAPER_MM = 60;
export const RECEIPT_PRINT_MARGIN_NARROW_MM = 2;
export const RECEIPT_PRINT_MARGIN_WIDE_MM = 4;

/**
 * Kelonggaran tinggi, dalam milimeter: pembulatan tinggi baris di mesin cetak
 * tidak boleh membuat baris terakhir melimpah ke halaman berikutnya (yang di
 * printer struk berarti sepotong kertas kosong tambahan).
 */
export const RECEIPT_PRINT_SLACK_MM = 2;

/** Margin cetak untuk lebar kertas ini. */
export function receiptPrintMarginMm(widthMm: number): number {
  return widthMm <= RECEIPT_NARROW_PAPER_MM
    ? RECEIPT_PRINT_MARGIN_NARROW_MM
    : RECEIPT_PRINT_MARGIN_WIDE_MM;
}

/**
 * Tinggi kertas yang dibutuhkan sekali cetak, dalam milimeter.
 *
 * Dihitung dari isinya sendiri — **seluruh** lembar yang keluar (rangkap ikut
 * dihitung, karena lembar cetaknya memang menumpuk di bawah lembar pertama),
 * tinggi logonya masing-masing, dan dua kali marginnya. Struk tiga baris tidak
 * mendapat sepertiga halaman A4, dan tidak ada lembar rangkap yang terpotong
 * hanya karena tinggi halamannya dihitung dari lembar pertama saja.
 */
export function receiptPrintHeightMm(doc: ReceiptDocument): number {
  const isi = doc.sheets.reduce(
    (total, sheet) =>
      total +
      (doc.logoUrl ? RECEIPT_PRINT_LOGO_MM : 0) +
      sheet.lines.length * RECEIPT_PRINT_LINE_MM,
    0,
  );
  const tinggi =
    receiptPrintMarginMm(doc.paper.widthMm) * 2 + isi + RECEIPT_PRINT_SLACK_MM;
  return Math.round(tinggi * 100) / 100;
}

/**
 * Aturan cetak untuk setelan struk ini: **ukuran kertasnya dipilih otomatis**,
 * jadi kasir tidak perlu mengubah “Paper size” di dialog cetak peramban setiap
 * kali mencetak — dialognya terbuka dengan kertas selebar struknya
 * (58/76/80/241 mm) dan setinggi isi notanya.
 *
 * Dua hal yang sengaja ditulis begini:
 *
 * 1. **Tingginya angka, bukan `auto`.** Bentuk yang lazim dibaca orang —
 *    `size: 80mm auto` — **tidak sah** menurut CSS Paged Media, dan peramban
 *    membuangnya tanpa pesan apa pun: `document.styleSheets` hanya menyisakan
 *    `margin`, dan halamannya kembali ke ukuran bawaan (A4/Letter). Karena itu
 *    tingginya dihitung sendiri (`receiptPrintHeightMm`) dan ditulis sebagai
 *    pasangan dua angka.
 * 2. **Metrik barisnya ikut ditulis dari sini**, bukan dari kelas Tailwind di
 *    halaman kasir: angka yang dipakai menghitung tinggi kertas harus sama dengan
 *    angka yang dipakai mencetak barisnya, dan itu cuma bisa dijamin kalau
 *    keduanya datang dari konstanta yang sama.
 */
export function receiptPrintCss(doc: ReceiptDocument): string {
  const width = doc.paper.widthMm;
  const margin = receiptPrintMarginMm(width);
  return [
    `@page { size: ${width}mm ${receiptPrintHeightMm(doc)}mm; margin: ${margin}mm; }`,
    `.struk-cetak pre { font-size: ${RECEIPT_PRINT_FONT_MM}mm; line-height: ${RECEIPT_PRINT_LINE_MM}mm; }`,
  ].join("\n");
}

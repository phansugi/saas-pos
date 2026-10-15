/**
 * Berkas **PDF** struk dan **kiriman WhatsApp**-nya, tanpa peramban & tanpa jaringan.
 *
 * Kenapa ada: `verify-struk.mjs` menjaga teks struk yang keluar di kertas,
 * `verify-struk-browser.mjs` membuktikan unduhannya benar-benar terjadi di
 * peramban sungguhan. Yang belum terjaga di antara keduanya justru bagian yang
 * paling mudah rusak tanpa terlihat:
 *
 *   1. **Berkas PDF-nya structur benar.** Berkas yang xref-nya meleset atau
 *      `/Length` aliran isinya salah tetap “terbuka” di sebagian pembaca dan
 *      menganga di pembaca lain — jadi di sini offset-nya diperiksa satu per satu
 *      (setiap entri xref harus menunjuk objek yang benar), panjang aliran isinya
 *      dicocokkan dengan byte-nya, dan `/MediaBox`-nya dibandingkan dengan lebar
 *      kertas struk yang dipilih.
 *   2. **Badannya benar-benar siap dikirim ke WhatsApp.** Modul kirimnya murni —
 *      ia hanya menyusun badan multipart & JSON — sehingga bisa diperiksa di sini:
 *      batas multipart-nya, nama berkasnya, dan byte PDF-nya harus ada **utuh** di
 *      dalam badan itu. Unggahan yang badannya salah tidak akan pernah berhasil,
 *      dan kegagalannya baru terlihat di depan pelanggan.
 *
 * Semua yang diuji di sini tidak menyentuh jaringan: tidak ada nomor WhatsApp,
 * tidak ada token, dan tidak ada satu byte pun yang keluar dari mesin uji.
 *
 * Usage: bun scripts/verify-struk-pdf.mjs
 */
import { receiptDocument } from "../src/convex/lib/struk.ts";
import {
  RECEIPT_WA_CAPTION_MAX,
  RECEIPT_WA_ENV,
  RECEIPT_WA_TEXT_MAX,
  maskPhone,
  RECEIPT_WA_IMAGE_MAX_BYTES,
  receiptWhatsappCaption,
  receiptWhatsappConfig,
  receiptWhatsappFilename,
  receiptWhatsappImageMessageRequest,
  receiptWhatsappLink,
  receiptWhatsappMediaOutcome,
  receiptWhatsappMediaRequest,
  receiptWhatsappMessageOutcome,
  receiptWhatsappMessageRequest,
  receiptWhatsappReceiptMessage,
  receiptWhatsappReceiptText,
  receiptWhatsappRecipient,
} from "../src/convex/lib/receiptWhatsapp.ts";
import {
  RECEIPT_PDF_LOGO_PT,
  RECEIPT_PDF_LOGO_RASTER_PX,
  RECEIPT_PDF_MAX_FONT_PT,
  RECEIPT_PDF_MIN_FONT_PT,
  receiptPdfBytes,
  receiptPdfFileName,
  receiptPdfLayout,
} from "../src/lib/receiptPdf.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const PT_PER_MM = 72 / 25.4;
const close = (a, b, tolerance = 0.01) => Math.abs(a - b) < tolerance;

/* ---------------------------------------------------------------- contoh -- */

const DRAFT = {
  business: "Kopi (Senja)",
  store: "Cabang Melati",
  number: "A-00042",
  when: "13/10/2026, 14.30",
  member: "Bu Sari Wulandari",
  cashier: "Rani",
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
  { printerId: "thermal", paperWidthMm: 58, copies: 1, footerText: "Terima kasih telah berbelanja" },
  DRAFT,
);
const dotMatrix241 = receiptDocument(
  { printerId: "dot_matrix", paperWidthMm: 241, copies: 2, footerText: "Terima kasih" },
  DRAFT,
);

/** Byte berkas → teks Latin-1 (tiap karakter = satu byte, jadi offset = indeks). */
const asText = (bytes) => Buffer.from(bytes).toString("latin1");

/** Badan permintaan → teks, entah ia byte (unggah) atau JSON (pesan). */
const bodyText = (request) =>
  typeof request.body === "string" ? request.body : asText(request.body);

/** Semua objek PDF beserta nomornya, dibaca apa adanya dari berkasnya. */
function pdfObjects(text) {
  return [...text.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj\n/g)].map((row) => ({
    number: Number(row[1]),
    body: row[2],
  }));
}

/** Entri xref: nomor objek → offset yang ditulis di tabel. */
function xrefEntries(text) {
  const start = text.search(/^xref$/m);
  if (start < 0) return null;
  const rows = text.slice(start).split("\n");
  const size = Number(rows[1].split(" ")[1]);
  const entries = [];
  for (let index = 0; index < size; index += 1) {
    const row = rows[2 + index];
    entries.push({
      raw: row,
      length: row.length + 1,
      offset: Number(row.slice(0, 10)),
      generation: Number(row.slice(11, 16)),
      kind: row.slice(17, 18),
    });
  }
  return { size, entries, header: rows[1] };
}

/* ------------------------------------------------------- ukuran halaman -- */

const layout = receiptPdfLayout(thermal58);
check(
  "halaman PDF selebar kertas struknya (58 mm) dan setinggi barisnya, bukan A4",
  close(layout.widthPt, 58 * PT_PER_MM, 0.001) &&
    close(layout.marginPt, 6, 0.001) &&
    close(
      layout.heightPt,
      2 * layout.marginPt + thermal58.sheets[0].lines.length * layout.leadingPt,
      0.001,
    ) &&
    layout.heightPt < 400,
  JSON.stringify(layout),
);
check(
  "ukuran hurufnya membuat tepat `cols` karakter muat di dalam marginnya",
  close(layout.fontSizePt * 0.6 * thermal58.cols, layout.widthPt - 2 * layout.marginPt, 0.001) &&
    layout.fontSizePt <= RECEIPT_PDF_MAX_FONT_PT &&
    layout.fontSizePt >= RECEIPT_PDF_MIN_FONT_PT,
  `font ${layout.fontSizePt} pt · kolom ${thermal58.cols}`,
);
const layoutFaktur = receiptPdfLayout(dotMatrix241);
check(
  "kertas faktur 241 mm memakai huruf paling besar yang masih wajar (9 pt) dan tetap muat di kertasnya",
  layoutFaktur.fontSizePt === RECEIPT_PDF_MAX_FONT_PT &&
    layoutFaktur.cols === dotMatrix241.cols &&
    layoutFaktur.fontSizePt * 0.6 * layoutFaktur.cols <=
      layoutFaktur.widthPt - 2 * layoutFaktur.marginPt + 0.001,
  `${layoutFaktur.fontSizePt} pt · ${layoutFaktur.cols} kolom · lebar ${layoutFaktur.widthPt}`,
);
const strukPanjang = receiptDocument(
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
check(
  "halamannya memanjang mengikuti jumlah baris — struk 20 barang tidak dipotong",
  receiptPdfLayout(strukPanjang).heightPt > layout.heightPt &&
    receiptPdfLayout(strukPanjang).lines === strukPanjang.sheets[0].lines.length,
  `${receiptPdfLayout(strukPanjang).heightPt} vs ${layout.heightPt}`,
);

/* --------------------------------------------------------- berkas PDF -- */

const pdf = asText(receiptPdfBytes(thermal58, { title: "Struk A-00042" }));
check(
  "berkasnya PDF yang punya header, trailer, dan penutup yang benar",
  pdf.startsWith("%PDF-1.4\n") && pdf.trimEnd().endsWith("%%EOF") && pdf.includes("\nxref\n"),
  pdf.slice(0, 12),
);
const objects = pdfObjects(pdf);
check(
  "objeknya lengkap: katalog, daftar halaman, huruf, halaman+isinya, dan info berkas",
  objects.length === 6 &&
    objects[0].body.includes("/Type /Catalog /Pages 2 0 R") &&
    objects[1].body.includes("/Count 1") &&
    objects[2].body.includes("/BaseFont /Courier") &&
    objects[3].body.includes("/Type /Page /Parent 2 0 R") &&
    objects[4].body.includes("stream") &&
    objects[5].body.includes("/Producer (MesinPOS)"),
  `objek=${objects.length}`,
);
const xref = xrefEntries(pdf);
const offsetBenar = xref
  ? xref.entries.every(
      (entry, index) =>
        entry.length === 20 &&
        (index === 0
          ? entry.kind === "f" && entry.offset === 0 && entry.generation === 65535
          : entry.kind === "n" &&
            entry.generation === 0 &&
            pdf.startsWith(`${index} 0 obj`, entry.offset)),
    )
  : false;
check(
  "tabel xref-nya menunjuk objek yang benar — tiap entri 20 byte & offsetnya persis",
  offsetBenar,
  JSON.stringify(xref?.entries?.slice(0, 3) ?? null),
);
const startxref = Number((pdf.match(/startxref\n(\d+)/) ?? [])[1]);
check(
  "startxref menunjuk awal tabel xref, dan /Size-nya menghitung objeknya dengan benar",
  Number.isFinite(startxref) &&
    pdf.startsWith("xref\n", startxref) &&
    xref.size === objects.length + 1 &&
    pdf.includes(`/Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R`),
  `startxref=${startxref} · size=${xref.size}`,
);
const streamLengthBenar = [...pdf.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)].every(
  (row) => Buffer.byteLength(row[2], "latin1") === Number(row[1]),
);
check(
  "panjang tiap aliran isi (`/Length`) sama dengan byte yang benar-benar ditulis",
  streamLengthBenar && (pdf.match(/\/Length \d+ >>/g) ?? []).length === 1,
  `${(pdf.match(/\/Length \d+ >>/g) ?? []).length} aliran`,
);
check(
  "satu halaman per lembar: struk thermal satu halaman, dot matrix dua halaman",
  (asText(receiptPdfBytes(thermal58)).match(/\/Type \/Page \/Parent/g) ?? []).length === 1 &&
    (asText(receiptPdfBytes(dotMatrix241)).match(/\/Type \/Page \/Parent/g) ?? []).length === 2 &&
    (asText(receiptPdfBytes(dotMatrix241)).match(/\/MediaBox/g) ?? []).length === 2,
  `${(asText(receiptPdfBytes(dotMatrix241)).match(/\/Type \/Page \/Parent/g) ?? []).length} halaman`,
);
check(
  "MediaBox-nya selebar kertas & setinggi halaman yang dihitung tadi, bukan ukuran bawaan",
  pdf.includes(`/MediaBox [0 0 ${Number(layout.widthPt.toFixed(3))} ${Number(layout.heightPt.toFixed(3))}]`),
  (pdf.match(/\/MediaBox \[[^\]]*\]/) ?? [])[0],
);
check(
  "isi struknya ikut tercetak di dalam berkas: nama usaha, barang, total, pembayaran, dan catatan kaki",
  [
    "Kopi \\(Senja\\)",
    "Cabang Melati",
    "(No. A-00042)",
    "(Member : Bu Sari Wulandari)",
    "(Kasir : Rani)",
    "Kopi Susu Gula Aren Large",
    "(2 x Rp 9.000",
    "(TOTAL",
    "(Bayar",
    "(Kembali",
    "Terima kasih telah berbelanja",
  ].every((cuplikan) => pdf.includes(cuplikan)),
  (pdf.match(/\([^)]*\) Tj/g) ?? []).slice(0, 6).join(" · "),
);
check(
  "tanda kurung di nama usaha di-escape supaya berkasnya tidak rusak",
  pdf.includes("Kopi \\(Senja\\)") && !pdf.includes("(Kopi (Senja)"),
  (pdf.match(/\([^\n]*Kopi[^\n]*\) Tj/) ?? [])[0],
);
check(
  "penanda rangkap dot matrix ikut tercetak, dan tiap baris struk bergeser sendiri (`T*`), bukan menumpuk di satu titik",
  asText(receiptPdfBytes(dotMatrix241)).includes("ASLI") &&
    asText(receiptPdfBytes(dotMatrix241)).includes("TEMBUSAN 1") &&
    (pdf.match(/\nT\*\n/g) ?? []).length === thermal58.sheets[0].lines.length - 1,
  `${(pdf.match(/\nT\*\n/g) ?? []).length} pergeseran untuk ${thermal58.sheets[0].lines.length} baris`,
);
check(
  "huruf di luar Latin-1 diganti tanda tanya, bukan ditulis apa adanya",
  (() => {
    const aneh = receiptDocument(
      { printerId: "thermal", paperWidthMm: 58, copies: 1, footerText: "Terima kasih" },
      { ...DRAFT, business: "Kopi ✅ Senja", store: "Café Mélati" },
    );
    const teks = asText(receiptPdfBytes(aneh));
    return (
      teks.includes("Kopi ? Senja") &&
      teks.includes("Café Mélati") &&
      !teks.includes("✅")
    );
  })(),
  "harus ada '?' menggantikan emoji",
);
check(
  "baris yang lebih panjang dari kolomnya dipotong di batas kolom, tidak meluber ke luar kertas",
  (() => {
    const panjang = {
      ...thermal58,
      sheets: [{ copyIndex: 0, copyLabel: "", lines: ["x".repeat(80)] }],
    };
    const teks = asText(receiptPdfBytes(panjang));
    return teks.includes(`(${"x".repeat(thermal58.cols)}) Tj`) && !teks.includes("x".repeat(thermal58.cols + 1));
  })(),
  `kolom=${thermal58.cols}`,
);
check(
  "berkasnya deterministik: struk yang sama menghasilkan berkas yang sama",
  Buffer.from(receiptPdfBytes(thermal58, { title: "Struk A-00042" })).equals(
    Buffer.from(receiptPdfBytes(thermal58, { title: "Struk A-00042" })),
  ) &&
    !Buffer.from(receiptPdfBytes(dotMatrix241)).equals(Buffer.from(receiptPdfBytes(thermal58))),
  "dua berkas berbeda isinya",
);

/* --------------------------------------------------------------- logo -- */

/**
 * Logo uji: 12 × 8 piksel keabuan dengan nilai yang **berbeda tiap piksel**,
 * supaya byte yang tertanam di PDF bisa dicocokkan satu per satu (bukan cuma
 * “ada sesuatu di sana”).
 */
const LOGO = {
  width: 12,
  height: 8,
  gray: Uint8Array.from({ length: 96 }, (_nilai, index) => (index * 2) & 0xff),
};
const logoLatin1 = String.fromCharCode(...LOGO.gray);

/** PDF untuk logo apa pun (atau `null`) dengan judul yang tetap. */
const pdfDenganLogo = (logo) =>
  asText(receiptPdfBytes(thermal58, { title: "Struk A-00042", logo }));

const pdfTanpaLogo = pdfDenganLogo(null);
check(
  "struk tanpa logo tetap menghasilkan berkas seperti semula (tanpa objek gambar sama sekali)",
  pdfTanpaLogo === asText(receiptPdfBytes(thermal58, { title: "Struk A-00042" })) &&
    !pdfTanpaLogo.includes("/Subtype /Image") &&
    !pdfTanpaLogo.includes("/XObject"),
  `ada /Subtype /Image? ${pdfTanpaLogo.includes("/Subtype /Image")}`,
);
check(
  "logo yang byte/ukurannya tidak masuk akal diabaikan, bukan menggagalkan struk",
  pdfDenganLogo({ ...LOGO, gray: LOGO.gray.subarray(0, 5) }) === pdfTanpaLogo &&
    pdfDenganLogo({ width: 0, height: 0, gray: new Uint8Array(0) }) === pdfTanpaLogo &&
    pdfDenganLogo({ width: 3.5, height: 2, gray: new Uint8Array(7) }) === pdfTanpaLogo &&
    pdfDenganLogo(LOGO) !== pdfTanpaLogo,
  "logo rusak tidak diabaikan, atau sebaliknya logo yang sah ikut dibuang",
);

const layoutLogo = receiptPdfLayout(thermal58, { logo: LOGO });
check(
  "halaman bertambah setinggi pita logonya (29,11 mm), dan pita itu hanya bergantung pada ukuran cetaknya",
  close(layoutLogo.heightPt, layout.heightPt + RECEIPT_PDF_LOGO_PT, 0.001) &&
    close(layoutLogo.logoBandPt, RECEIPT_PDF_LOGO_PT, 0.001) &&
    close(
      receiptPdfLayout(thermal58, {
        logo: { width: 900, height: 300, gray: new Uint8Array(900 * 300) },
      }).heightPt,
      layoutLogo.heightPt,
      0.001,
    ),
  `${layoutLogo.heightPt} vs ${layout.heightPt} (+${RECEIPT_PDF_LOGO_PT})`,
);
check(
  "logonya dimuatkan ke pita dengan rasionya dipertahankan (`contain`) & ditaruh di tengah kertas",
  close(layoutLogo.logoWidthPt, RECEIPT_PDF_LOGO_PT, 0.001) &&
    close(layoutLogo.logoHeightPt, (RECEIPT_PDF_LOGO_PT * LOGO.height) / LOGO.width, 0.001) &&
    (() => {
      const pdfLogo = pdfDenganLogo(LOGO);
      // Angka di dalam PDF ditulis `num()`: tiga desimal, lalu nol berekornya
      // dibuang — jadi perbandingannya memakai aturan yang sama, bukan `toFixed`.
      const angka = (value) => String(Number(value.toFixed(3)));
      const x = (layoutLogo.widthPt - layoutLogo.logoWidthPt) / 2;
      const y =
        layoutLogo.heightPt -
        layoutLogo.marginPt -
        layoutLogo.logoBandPt +
        (layoutLogo.logoBandPt - layoutLogo.logoHeightPt) / 2;
      return pdfLogo.includes(
        `q\n${angka(layoutLogo.logoWidthPt)} 0 0 ${angka(layoutLogo.logoHeightPt)} ` +
          `${angka(x)} ${angka(y)} cm\n/Logo Do\nQ`,
      );
    })(),
  JSON.stringify({ w: layoutLogo.logoWidthPt, h: layoutLogo.logoHeightPt }),
);
check(
  "pitanya ditambahkan **di atas** baris pertama, bukan menimpanya: teksnya tetap di jarak yang sama dari dasar kertas",
  (() => {
    const yTanpa = layout.heightPt - layout.marginPt - layout.fontSizePt;
    const yLogo =
      layoutLogo.heightPt - layoutLogo.marginPt - layoutLogo.logoBandPt - layoutLogo.fontSizePt;
    const pdfLogo = pdfDenganLogo(LOGO);
    const angka = (value) => String(Number(value.toFixed(3)));
    const jarakDariAtasTanpa = layout.heightPt - yTanpa;
    const jarakDariAtasLogo = layoutLogo.heightPt - yLogo;
    return (
      pdfLogo.includes(`1 0 0 1 6 ${angka(yLogo)} Tm`) &&
      close(yLogo, yTanpa, 0.002) &&
      close(jarakDariAtasLogo - jarakDariAtasTanpa, RECEIPT_PDF_LOGO_PT, 0.002)
    );
  })(),
  "matriks teksnya bergeser dari tempat yang seharusnya",
);
check(
  "gambarnya masuk sebagai satu objek DeviceGray seukuran byte yang diberikan, dan isinya utuh",
  (() => {
    const pdfLogo = pdfDenganLogo(LOGO);
    const header = new RegExp(
      `<< /Type /XObject /Subtype /Image /Width ${LOGO.width} /Height ${LOGO.height}` +
        ` /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${LOGO.gray.length} >>\nstream\n`,
    );
    const cocok = header.exec(pdfLogo);
    if (!cocok) return false;
    const mulai = cocok.index + cocok[0].length;
    const isi = pdfLogo.slice(mulai, mulai + LOGO.gray.length);
    return (
      isi === logoLatin1 &&
      pdfLogo.slice(mulai + LOGO.gray.length, mulai + LOGO.gray.length + 10) ===
        "\nendstream"
    );
  })(),
  `header gambar tidak cocok (${LOGO.gray.length} byte)`,
);
check(
  "lembar rangkap cuma membawa **satu** salinan gambar, tetapi tiap halaman merujuknya",
  (() => {
    const pdfDua = asText(receiptPdfBytes(dotMatrix241, { logo: LOGO }));
    return (
      (pdfDua.match(/\/Subtype \/Image/g) ?? []).length === 1 &&
      (pdfDua.match(/\/XObject << \/Logo /g) ?? []).length === 2 &&
      (pdfDua.match(/\/Logo Do/g) ?? []).length === 2
    );
  })(),
  "gambar tergandakan atau tidak dirujuk lembar kedua",
);
check(
  "berkas berlogo tetap sah secara struktur: xref, startxref, /Size, dan objek gambarnya paling akhir",
  (() => {
    const pdfLogo = pdfDenganLogo(LOGO);
    const daftar = pdfObjects(pdfLogo);
    const xrefLogo = xrefEntries(pdfLogo);
    const start = Number((pdfLogo.match(/startxref\n(\d+)/) ?? [])[1]);
    const gambar = daftar.find((row) => row.body.includes("/Subtype /Image"));
    return (
      xrefLogo !== null &&
      xrefLogo.entries.every(
        (entry, index) =>
          entry.length === 20 &&
          (index === 0
            ? entry.kind === "f"
            : entry.kind === "n" && pdfLogo.startsWith(`${index} 0 obj`, entry.offset)),
      ) &&
      xrefLogo.size === daftar.length + 1 &&
      pdfLogo.startsWith("xref\n", start) &&
      gambar === daftar[daftar.length - 1] &&
      (pdfLogo.match(/\/Logo Do/g) ?? []).length === thermal58.sheets.length
    );
  })(),
  "offset xref atau penomoran objek berkas berlogo meleset",
);
check(
  "berkas berlogo pun deterministik, dan ukuran raster yang diminta masuk akal untuk cetaknya",
  Buffer.from(receiptPdfBytes(thermal58, { logo: LOGO })).equals(
    Buffer.from(receiptPdfBytes(thermal58, { logo: LOGO })),
  ) &&
    pdfDenganLogo(LOGO) !== pdfTanpaLogo &&
    RECEIPT_PDF_LOGO_RASTER_PX >= 2 * RECEIPT_PDF_LOGO_PT &&
    RECEIPT_PDF_LOGO_RASTER_PX <= 400,
  `raster ${RECEIPT_PDF_LOGO_RASTER_PX} px untuk pita ${RECEIPT_PDF_LOGO_PT.toFixed(1)} pt`,
);

/* -------------------------------------------------------- nama berkas -- */

check(
  "nama berkasnya memakai nomor notanya, dan waktu dibuat kalau nomornya belum ada",
  receiptPdfFileName({ number: "A-00042" }) === "struk-A-00042.pdf" &&
    receiptPdfFileName({ number: "B/12 2026" }) === "struk-B-12-2026.pdf" &&
    receiptPdfFileName({ number: null, now: new Date(2026, 9, 13, 14, 30) }) ===
      "struk-20261013-1430.pdf" &&
    /^struk-[\w.-]+\.pdf$/.test(receiptPdfFileName({ number: null })),
  `${receiptPdfFileName({ number: "B/12 2026" })} · ${receiptPdfFileName({
    number: null,
    now: new Date(2026, 9, 13, 14, 30),
  })}`,
);

/* ------------------------------------------------------- keadaan kanal -- */

const kosong = receiptWhatsappConfig({});
check(
  "kanal WhatsApp dianggap belum siap selama kunci wajibnya belum diisi, dan kuncinya disebut",
  kosong.configured === false &&
    kosong.missing.length === 2 &&
    kosong.missing.includes(RECEIPT_WA_ENV.token) &&
    kosong.missing.includes(RECEIPT_WA_ENV.phoneNumberId) &&
    kosong.graphVersion === "v21.0" &&
    kosong.token === null,
  JSON.stringify(kosong),
);
check(
  "token saja tidak cukup (id nomor pengirim juga wajib), dan versi Graph API bisa diatur",
  receiptWhatsappConfig({ WHATSAPP_ACCESS_TOKEN: "rahasia" }).configured === false &&
    receiptWhatsappConfig({ WHATSAPP_ACCESS_TOKEN: "rahasia" }).missing.length === 1 &&
    receiptWhatsappConfig({
      WHATSAPP_ACCESS_TOKEN: " rahasia ",
      WHATSAPP_PHONE_NUMBER_ID: "123456",
      WHATSAPP_GRAPH_VERSION: "v19.0",
    }).configured === true &&
    receiptWhatsappConfig({ WHATSAPP_ACCESS_TOKEN: "r", WHATSAPP_PHONE_NUMBER_ID: "1" })
      .graphVersion === "v21.0",
  JSON.stringify(receiptWhatsappConfig({ WHATSAPP_ACCESS_TOKEN: "rahasia" })),
);

/* ------------------------------------------------------------ pesannya -- */

const caption = receiptWhatsappCaption({
  business: "Kopi Senja",
  store: "Cabang Melati",
  number: "A-00042",
  when: "13/10/2026, 14.30",
  member: "Bu Sari Wulandari",
  total: 17_550,
});
check(
  "pesannya menyebut angka yang sama dengan struknya: nomor nota, tanggal, member, dan total",
  caption.includes("Kopi Senja") &&
    caption.includes("Cabang Melati") &&
    caption.includes("No. A-00042") &&
    caption.includes("Tanggal 13/10/2026, 14.30") &&
    caption.includes("Member Bu Sari Wulandari") &&
    /Total Rp\s?17\.550/.test(caption) &&
    caption.includes("PDF"),
  caption.replace(/\n/g, " / "),
);
const captionPanjang = receiptWhatsappCaption({
  business: "K".repeat(200),
  number: "A".repeat(2_000),
  total: 1_000,
});
check(
  `caption yang kepanjangan dipotong sendiri di ${RECEIPT_WA_CAPTION_MAX} karakter (WhatsApp menolaknya, bukan memotongnya)`,
  captionPanjang.length === RECEIPT_WA_CAPTION_MAX &&
    captionPanjang.endsWith("…") &&
    !captionPanjang.includes("undefined"),
  `${captionPanjang.length} karakter`,
);

/* ----------------------------------------------------------- tautan wa -- */

const tautan = receiptWhatsappLink("+62 812-3456-7890", "Struk A-00042\nTotal Rp 17.550");
check(
  "tautan `wa.me` memakai nomor yang sudah dinormalkan dan pesan yang sudah di-encode",
  tautan.ok === true &&
    tautan.url.startsWith("https://wa.me/6281234567890?text=") &&
    !tautan.url.includes(" ") &&
    decodeURIComponent(tautan.url.split("text=")[1]).includes("Total Rp 17.550"),
  tautan.ok ? tautan.url.slice(0, 60) : tautan.reason,
);
const tautanSalah = receiptWhatsappLink("123", "hai");
check(
  "nomor yang tidak masuk akal ditolak beserta alasannya, bukan jadi tautan yang tidak bisa dibuka",
  tautanSalah.ok === false && /8–15 digit/.test(tautanSalah.reason),
  tautanSalah.ok ? "ok" : tautanSalah.reason,
);

/* -------------------------------------------- isi struk sebagai teks pesan -- */

/*
  Jalur tanpa kunci WhatsApp: tautan `wa.me` dan lembar bagikan perangkat memang
  tidak mengirim berkas lewat kanal WhatsApp, jadi yang harus sampai ke pembeli
  adalah **isi struknya sendiri** — baris-baris yang sama dengan yang keluar di
  kertas, bukan ringkasan.
*/
const barisStruk = thermal58.sheets[0].lines;
const strukTeks = receiptWhatsappReceiptText(barisStruk);
check(
  "isi struk dikirim apa adanya sebagai teks: nomor nota, nama item, dan angka bayarnya ikut",
  strukTeks.includes("No. A-00042") &&
    strukTeks.includes("Kopi Susu Gula Aren") &&
    strukTeks.includes("TOTAL") &&
    strukTeks.includes("Bayar") &&
    strukTeks.includes("Kembali") &&
    !strukTeks.endsWith("\n"),
  `${strukTeks.split("\n").length} baris · ${strukTeks.length} karakter`,
);
check(
  "spasi selebar kertas dibuang hanya di ujung kanan — spasi penyejajar kolom nominal dibiarkan",
  strukTeks.split("\n").every((line) => !/[ \t]$/.test(line)) &&
    strukTeks.split("\n").some((line) => /\S {2,}\S/.test(line)),
  strukTeks.split("\n").find((line) => /\S {2,}\S/.test(line)) ?? "(tidak ada baris berkolom)",
);
check(
  "baris kosong di ekor — dan isi yang memang kosong — tidak jadi pesan berisi spasi",
  receiptWhatsappReceiptText([]) === "" &&
    receiptWhatsappReceiptText(["", "  ", "   "]) === "" &&
    receiptWhatsappReceiptText(["A", "", "", ""]) === "A",
  JSON.stringify(receiptWhatsappReceiptText(["A", "", "", ""])),
);

const pesanStruk = receiptWhatsappReceiptMessage(barisStruk);
check(
  "pesan WhatsApp membungkus struknya jadi blok monospace supaya bentuk kolomnya tetap terbaca",
  pesanStruk.startsWith("```\n") &&
    pesanStruk.endsWith("\n```") &&
    pesanStruk.includes("Kopi Susu Gula Aren") &&
    pesanStruk.includes(`\n${barisStruk[0].replace(/[ \t]+$/, "")}\n`),
  `${pesanStruk.split("\n")[0]} … ${pesanStruk.slice(-8)}`,
);
const pesanPanjang = receiptWhatsappReceiptMessage(
  Array.from({ length: 400 }, (_value, index) => `Baris ${index + 1} — ${"x".repeat(40)}`),
);
check(
  `struk yang kepanjangan dipotong sendiri di ${RECEIPT_WA_TEXT_MAX} karakter, bukan jadi tautan yang tak bisa dibuka`,
  pesanPanjang.length === RECEIPT_WA_TEXT_MAX &&
    pesanPanjang.endsWith("…") &&
    !pesanPanjang.startsWith("```"),
  `${pesanPanjang.length} karakter`,
);
check(
  "isi yang sudah memuat pagar blok dilewati pembungkusnya — blok yang rusak lebih buruk daripada teks rapi",
  receiptWhatsappReceiptMessage(["halo ``` dunia"]) === "halo ``` dunia",
  receiptWhatsappReceiptMessage(["halo ``` dunia"]),
);

const tautanIsiStruk = receiptWhatsappLink("0812 3456 7890", pesanStruk);
check(
  "tautan cadangan `wa.me` membawa isi struknya, bukan ringkasan",
  tautanIsiStruk.ok === true &&
    decodeURIComponent(tautanIsiStruk.url.split("text=")[1]).includes("Kopi Susu Gula Aren") &&
    decodeURIComponent(tautanIsiStruk.url.split("text=")[1]).includes("No. A-00042") &&
    !tautanIsiStruk.url.includes(" "),
  tautanIsiStruk.ok
    ? decodeURIComponent(tautanIsiStruk.url.split("text=")[1]).slice(0, 60).replace(/\n/g, " / ")
    : tautanIsiStruk.reason,
);
const sensor = maskPhone("6281234567890");
check(
  "nomor ditampilkan tersensor: awalnya terbaca, sisanya tidak lagi berupa digit",
  sensor === "6281" + "•".repeat(9) &&
    !/\d/.test(sensor.slice(4)) &&
    maskPhone("12") === "••" &&
    maskPhone("+62 812-3456-7890").slice(4) === "•".repeat(9),
  sensor,
);
check(
  "nama berkas yang dikirim tidak memuat garis miring atau tanda kutip yang merusak headernya",
  receiptWhatsappFilename('struk A/0001 "asli".pdf', "struk.pdf") === "struk-A-0001-asli.pdf" &&
    receiptWhatsappFilename("   ", "struk.pdf") === "struk.pdf" &&
    receiptWhatsappFilename("a".repeat(400), "struk.pdf").length <= 240,
  receiptWhatsappFilename('struk A/0001 "asli".pdf', "struk.pdf"),
);

/* ------------------------------------------- nomor tujuan (member/kasir) -- */
/*
  Member cash yang datanya belum lengkap boleh dikirimi struk lewat nomor yang
  diketik kasir, tetapi urutan prioritasnya tidak boleh kabur: nomor yang sudah
  tersimpan selalu menang, dan nomor ketikan tetap harus lolos validasi.
*/
const dariMember = receiptWhatsappRecipient("+62 812-3456-7890", "0812-0000-0000");
check(
  "nomor yang tersimpan di data member menang atas nomor yang diketik kasir",
  dariMember.ok === true &&
    dariMember.phone === "6281234567890" &&
    dariMember.source === "member" &&
    dariMember.buyer === "member",
  dariMember.ok
    ? `${dariMember.phone} · ${dariMember.source} · ${dariMember.buyer}`
    : dariMember.reason,
);
const dariKasir = receiptWhatsappRecipient("", "0812-3456-7890");
check(
  "member yang belum punya nomor memakai nomor yang diketik kasir, ditandai asalnya `kasir`",
  dariKasir.ok === true &&
    dariKasir.phone === "6281234567890" &&
    dariKasir.source === "kasir" &&
    dariKasir.buyer === "member",
  dariKasir.ok
    ? `${dariKasir.phone} · ${dariKasir.source} · ${dariKasir.buyer}`
    : dariKasir.reason,
);
const tanpaNomor = receiptWhatsappRecipient(null, "0812");
check(
  "tanpa nomor tersimpan & tanpa nomor ketikan yang sah, kiriman ditolak beserta alasannya",
  tanpaNomor.ok === false && /belum ada/.test(tanpaNomor.reason),
  tanpaNomor.ok ? "ok" : tanpaNomor.reason,
);
/*
  Pembeli **umum**: penjualan tanpa member sama sekali. Tidak ada data member yang
  bisa dibaca, jadi nomor yang diketik kasir bukan cadangan lagi melainkan
  satu-satunya tujuan — dan penolakannya harus menunjuk kolom yang benar di dialog
  struk, bukan menyuruh kasir melengkapi profil member yang tidak ada.
*/
const dariUmum = receiptWhatsappRecipient(null, "0812-3456-7890", "umum");
check(
  "pembeli umum memakai nomor yang diberikan pembelinya, ditandai `umum` untuk jejak audit",
  dariUmum.ok === true &&
    dariUmum.phone === "6281234567890" &&
    dariUmum.source === "kasir" &&
    dariUmum.buyer === "umum",
  dariUmum.ok
    ? `${dariUmum.phone} · ${dariUmum.source} · ${dariUmum.buyer}`
    : dariUmum.reason,
);
const umumTanpaNomor = receiptWhatsappRecipient(null, "0812", "umum");
check(
  "pembeli umum tanpa nomor yang sah ditolak dengan petunjuk mengisi kolomnya — bukan disamakan dengan member",
  umumTanpaNomor.ok === false &&
    /Nomor WhatsApp pembeli/.test(umumTanpaNomor.reason) &&
    !/member/i.test(umumTanpaNomor.reason),
  umumTanpaNomor.ok ? "ok" : umumTanpaNomor.reason,
);

/* -------------------------------------------------- permintaan Graph API -- */

const config = receiptWhatsappConfig({
  WHATSAPP_ACCESS_TOKEN: "token-uji",
  WHATSAPP_PHONE_NUMBER_ID: "998877",
});
const pdfBytes = receiptPdfBytes(thermal58);
const unggah = receiptWhatsappMediaRequest({
  config,
  bytes: pdfBytes,
  filename: "struk-A-00042.pdf",
  boundary: "----MesinPOSujicoba",
});
check(
  "unggahan berkasnya menuju `/{id-nomor}/media` dengan token di headernya",
  unggah.url === "https://graph.facebook.com/v21.0/998877/media" &&
    unggah.method === "POST" &&
    unggah.headers.Authorization === "Bearer token-uji" &&
    unggah.headers["Content-Type"] === "multipart/form-data; boundary=----MesinPOSujicoba",
  JSON.stringify({ url: unggah.url, headers: unggah.headers }),
);
const badanUnggah = bodyText(unggah);
check(
  "badan multipart-nya berisi jenis berkas & nama berkas yang benar, ditutup batas terakhirnya",
  badanUnggah.startsWith("------MesinPOSujicoba\r\n") &&
    badanUnggah.includes('name="messaging_product"\r\n\r\nwhatsapp') &&
    badanUnggah.includes('name="type"\r\n\r\ndocument') &&
    badanUnggah.includes('Content-Disposition: form-data; name="file"; filename="struk-A-00042.pdf"') &&
    badanUnggah.includes("Content-Type: application/pdf") &&
    badanUnggah.trimEnd().endsWith("------MesinPOSujicoba--"),
  badanUnggah.slice(0, 180).replace(/\r\n/g, " / "),
);
check(
  "byte PDF-nya ada utuh di dalam badan itu, dan Content-Length-nya tepat sepanjang badannya",
  Buffer.from(unggah.body).includes(Buffer.from(pdfBytes)) &&
    Number(unggah.headers["Content-Length"]) === unggah.body.length &&
    unggah.body.length > pdfBytes.length,
  `${unggah.body.length} byte badan · ${pdfBytes.length} byte PDF`,
);

const pesan = receiptWhatsappMessageRequest({
  config,
  to: "6281234567890",
  mediaId: "media-123",
  filename: "struk-A-00042.pdf",
  caption,
});
const badanPesan = JSON.parse(pesan.body);
check(
  "pesan dokumennya menuju `/{id-nomor}/messages` dengan jenis `document` dan id berkas hasil unggahan",
  pesan.url === "https://graph.facebook.com/v21.0/998877/messages" &&
    pesan.headers["Content-Type"] === "application/json" &&
    pesan.headers.Authorization === "Bearer token-uji" &&
    badanPesan.messaging_product === "whatsapp" &&
    badanPesan.to === "6281234567890" &&
    badanPesan.type === "document" &&
    badanPesan.document.id === "media-123" &&
    badanPesan.document.filename === "struk-A-00042.pdf" &&
    badanPesan.document.caption === caption,
  JSON.stringify(badanPesan).slice(0, 200),
);

/*
  **Gambar struk** yang menyusul dokumennya: logo toko ada di dalam PDF, tetapi
  lewat pesan dokumen saja penerimanya harus membuka berkasnya dulu untuk melihat
  identitas tokonya. Pesan gambar menampilkannya langsung di percakapan — dan itu
  butuh dua hal yang diuji di sini: unggahan yang mengaku **gambar** (bukan dokumen)
  dan pesan berjenis `image` tanpa kolom `filename`.
*/
const pngUji = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
  0x52, 0x00, 0x00, 0x03, 0xf4, 0x00, 0x00, 0x07, 0x22,
]);
const unggahGambar = receiptWhatsappMediaRequest({
  config,
  bytes: pngUji,
  filename: "struk-A-00042.png",
  kind: "image",
  mimeType: "image/png",
  boundary: "----MesinPOSujigambar",
});
const badanUnggahGambar = bodyText(unggahGambar);
check(
  "unggahan gambar mengaku `image` dengan `Content-Type: image/png` — bukan dokumen PDF",
  badanUnggahGambar.includes('name="type"\r\n\r\nimage') &&
    badanUnggahGambar.includes("Content-Type: image/png") &&
    !badanUnggahGambar.includes("application/pdf") &&
    badanUnggahGambar.includes(
      'name="file"; filename="struk-A-00042.png"',
    ),
  badanUnggahGambar.slice(0, 200).replace(/\r\n/g, " / "),
);
check(
  "byte PNG-nya ada utuh di badan unggahan gambarnya, dan Content-Length-nya tepat",
  Buffer.from(unggahGambar.body).includes(Buffer.from(pngUji)) &&
    Number(unggahGambar.headers["Content-Length"]) === unggahGambar.body.length,
  `${unggahGambar.body.length} byte badan · ${pngUji.length} byte gambar`,
);
check(
  "tanpa `kind`, unggahan tetap dokumen PDF seperti sebelumnya — gambar tidak mengubah jalur lamanya",
  badanUnggah.includes('name="type"\r\n\r\ndocument') &&
    badanUnggah.includes("Content-Type: application/pdf") &&
    !badanUnggah.includes("image/png"),
  badanUnggah.slice(0, 120).replace(/\r\n/g, " / "),
);

const pesanGambar = receiptWhatsappImageMessageRequest({
  config,
  to: "6281234567890",
  mediaId: "media-gambar-1",
  filename: "struk-A-00042.png",
  caption,
});
const badanPesanGambar = JSON.parse(pesanGambar.body);
check(
  "pesan gambarnya berjenis `image` dengan id berkasnya, tanpa kolom `filename` yang tidak dimiliki WhatsApp",
  pesanGambar.url === "https://graph.facebook.com/v21.0/998877/messages" &&
    badanPesanGambar.messaging_product === "whatsapp" &&
    badanPesanGambar.to === "6281234567890" &&
    badanPesanGambar.type === "image" &&
    badanPesanGambar.image.id === "media-gambar-1" &&
    badanPesanGambar.image.caption === caption &&
    badanPesanGambar.image.filename === undefined &&
    badanPesanGambar.document === undefined,
  JSON.stringify(badanPesanGambar).slice(0, 200),
);
check(
  "batas gambar yang mau diunggah masuk akal: 5 MB, jauh di atas gambar struk yang ratusan kilobyte",
  RECEIPT_WA_IMAGE_MAX_BYTES === 5 * 1024 * 1024,
  String(RECEIPT_WA_IMAGE_MAX_BYTES),
);

/* ------------------------------------------------------ pembacaan balasan -- */

check(
  "unggahan dianggap berhasil hanya kalau WhatsApp memberi id berkasnya",
  receiptWhatsappMediaOutcome(200, { id: "media-123" }).ok === true &&
    receiptWhatsappMediaOutcome(200, {}).ok === false &&
    receiptWhatsappMediaOutcome(200, {}).reason.includes("HTTP 200"),
  JSON.stringify(receiptWhatsappMediaOutcome(200, {})),
);
check(
  "penolakan WhatsApp diteruskan apa adanya, termasuk pesan galatnya",
  receiptWhatsappMediaOutcome(401, { error: { message: "Invalid OAuth access token" } }).reason.includes(
    "Invalid OAuth access token",
  ) &&
    receiptWhatsappMessageOutcome(400, { error: { message: "recipient not in allowed list" } }).reason.includes(
      "recipient not in allowed list",
    ),
  receiptWhatsappMediaOutcome(401, { error: { message: "Invalid OAuth access token" } }).reason,
);
check(
  "pesan dianggap terkirim hanya kalau WhatsApp memberi id pesannya",
  receiptWhatsappMessageOutcome(200, { messages: [{ id: "wamid.HBg=" }] }).ok === true &&
    receiptWhatsappMessageOutcome(200, { messages: [{ id: "wamid.HBg=" }] }).messageId === "wamid.HBg=" &&
    receiptWhatsappMessageOutcome(200, { messages: [] }).ok === false &&
    receiptWhatsappMessageOutcome(500, {}).ok === false,
  JSON.stringify(receiptWhatsappMessageOutcome(200, { messages: [] })),
);

console.log(`${results.length}/${results.length} checks passed`);

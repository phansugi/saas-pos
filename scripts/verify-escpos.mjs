/**
 * Uji **bahasa printer ESC/POS** tanpa peramban dan tanpa printer.
 *
 * Kenapa ada: `scripts/verify-struk.mjs` menjaga teks struknya (kolom, rangkap,
 * catatan kaki), tetapi teks itu belum berarti apa-apa di kertas kalau rangkaian
 * perintahnya salah. Berkas ini memeriksa byte yang benar-benar dikirim ke mesin:
 *
 *   1. **Urutan perintah** — inisialisasi, halaman kode, lebar cetak, teks per
 *      lembar, jarak antar lembar rangkap, umpan, lalu potong/pulsa laci.
 *   2. **Saringan teks ASCII** — huruf beraksen dibuang aksennya, tanda tipografi
 *      dipetakan (bukan jadi huruf acak di kertas), dan baris tetap selebar
 *      kertasnya setelah disaring.
 *   3. **Raster logo** — pemadatan 1 bit per piksel beserta pembulatan lebar ke
 *      kelipatan 8 (tanpa itu baris bitmap berikutnya bergeser dan logonya miring).
 *   4. **Kemampuan mesin** — hanya thermal yang dipotong, hanya thermal/portable
 *      yang menerima raster, dan laci kas hanya dibuka kalau diminta.
 *   5. **Transport** — pemecahan byte per jalur (USB 16 KiB, Bluetooth 100 byte),
 *      daftar profil GATT, dan terjemahan galat peramban jadi kalimat Indonesia.
 *
 * Usage: bun scripts/verify-escpos.mjs
 */
import {
  ESC,
  ESC_POS_BLE_CHUNK_BYTES,
  ESC_POS_BLE_OPTIONAL_SERVICES,
  ESC_POS_BLE_PROFILES,
  ESC_POS_CAPABILITY,
  ESC_POS_CODE_PAGE,
  ESC_POS_DOTS_PER_MM,
  ESC_POS_FEED_LINES,
  ESC_POS_FONT_DOTS,
  ESC_POS_LOGO_MARGIN_DOTS,
  ESC_POS_LOGO_MM,
  ESC_POS_TRANSPORTS,
  ESC_POS_USB_CHUNK_BYTES,
  ESC_POS_USB_FILTERS,
  GS,
  escposCapability,
  escposChunkBytes,
  escposChunks,
  escposErrorMessage,
  escposLine,
  escposLogoDots,
  escposPackBitmap,
  escposPrintWidthDots,
  escposRasterCommand,
  escposReceiptBytes,
  escposReceiptSteps,
  escposSafe,
  escposSupport,
  escposTransportLabel,
  escposTransportOf,
} from "../src/convex/lib/escpos.ts";
import { receiptDocument, receiptPrinterOf } from "../src/convex/lib/struk.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

/** Setelan cepat: printer + kertas (+ rangkap kalau perlu). */
function setting(printerId, paperWidthMm, copies = 1) {
  return { printerId, paperWidthMm, copies, footerText: "Terima kasih telah berbelanja" };
}

const draft = {
  business: "Warung Uji Struk",
  store: "Cabang Struk",
  number: "A-00042",
  when: "14/10/2026 09:15",
  member: "Budi",
  cashier: "Bu Sari",
  items: [
    { name: "Kopi Susu Gula Aren Large", qty: 2, unitPrice: 22000, amount: 44000 },
    { name: "Teh Manis Dingin", qty: 1, unitPrice: 8000, amount: 8000 },
  ],
  subtotal: 52000,
  taxLabel: "PPN 11%",
  taxAmount: 5720,
  total: 57720,
  paid: 60000,
  change: 2280,
};

const doc80 = receiptDocument(setting("thermal", 80), draft);
const doc58 = receiptDocument(setting("portable", 58), draft);
const docMatrix = receiptDocument(setting("dot_matrix", 76, 2), draft);
const docFaktur = receiptDocument(setting("dot_matrix", 241, 3), draft);

// ------------------------------------------------------------ saringan ASCII
check(
  "teks ASCII biasa dibiarkan apa adanya",
  escposSafe("Kopi Susu Gula Aren 22.000") === "Kopi Susu Gula Aren 22.000",
  escposSafe("Kopi Susu Gula Aren 22.000"),
);
check(
  "tanda tipografi dipetakan ke bentuk ASCII-nya, bukan jadi tanda tanya",
  escposSafe("Terima kasih \u2014 sampai jumpa") === "Terima kasih - sampai jumpa" &&
    escposSafe("\u201cPromo\u201d \u2013 \u00b7 \u2026") === '"Promo" - - ...',
  escposSafe("\u201cPromo\u201d \u2013 \u00b7 \u2026"),
);
check(
  "huruf beraksen dibuang aksennya (nama toko Eropa tetap terbaca)",
  escposSafe("Caf\u00e9 Na\u00efve M\u00fcnchen") === "Cafe Naive Munchen" &&
    escposSafe("Bendung\u00e9 \u00f6lsch\u00e4l") === "Bendunge olschal",
  escposSafe("Caf\u00e9 Na\u00efve M\u00fcnchen"),
);
check(
  "simbol matematis & satuan dipetakan ke ASCII",
  escposSafe("2 \u00d7 3 \u2264 5 \u2260 6 \u00b0C \u00b1 1") === "2 x 3 <= 5 != 6 oC +/- 1",
  escposSafe("2 \u00d7 3 \u2264 5 \u2260 6 \u00b0C \u00b1 1"),
);
check(
  "spasi tak-putus (nbsp) jadi spasi biasa",
  escposSafe("Rp 1.000\u00a0saja") === "Rp 1.000 saja",
  escposSafe("Rp 1.000\u00a0saja"),
);
check(
  "karakter kendali dibuang (bukan dicetak jadi kotak) dan tab jadi spasi",
  escposSafe("A\u0007B\tC\u0000D") === "AB CD" &&
    escposSafe("\u001b@reset") === "@reset",
  escposSafe("A\u0007B\tC\u0000D"),
);
check(
  "huruf di luar jangkauan printer menjadi tanda tanya",
  escposSafe("Harga \u4e2d\u6587 \u20ac5") === "Harga ?? EUR5",
  escposSafe("Harga \u4e2d\u6587 \u20ac5"),
);
check(
  "baris baru dipertahankan (di ESC/POS ia perintah sendiri)",
  escposSafe("baris satu\nbaris dua") === "baris satu\nbaris dua",
  JSON.stringify(escposSafe("baris satu\nbaris dua")),
);
check(
  "penyaringan idempoten: hasilnya tidak berubah kalau disaring dua kali",
  escposSafe(escposSafe("\u201cCaf\u00e9\u201d \u00b7 2 \u00d7 3")) ===
    escposSafe("\u201cCaf\u00e9\u201d \u00b7 2 \u00d7 3"),
  escposSafe("\u201cCaf\u00e9\u201d \u00b7 2 \u00d7 3"),
);
check(
  "baris dipotong selebar kertasnya setelah disaring (pemetaan bisa memanjangkan baris)",
  escposLine("\u2026".repeat(40), 32).length === 32 &&
    escposLine("1234567890", 4) === "1234" &&
    escposLine("abc", 0).length === 1,
  `${escposLine("\u2026".repeat(40), 32).length} | ${escposLine("1234567890", 4)}`,
);
check(
  "hasil saringan selalu ASCII: tidak ada byte di atas 0x7e",
  [...escposSafe("\u201cCaf\u00e9\u201d \u2014 \u4e2d\u6587 \u00b7 \u20ac")]
    .every((char) => char.charCodeAt(0) <= 0x7e),
  escposSafe("\u201cCaf\u00e9\u201d \u2014 \u4e2d\u6587 \u00b7 \u20ac"),
);

// ------------------------------------------------------------- lebar & logo
check(
  "lebar cetak = kolom kertas × 12 dot (58/80/76/241 mm)",
  escposPrintWidthDots(setting("thermal", 58)) === 384 &&
    escposPrintWidthDots(setting("thermal", 80)) === 576 &&
    escposPrintWidthDots(setting("dot_matrix", 76)) === 480 &&
    escposPrintWidthDots(setting("dot_matrix", 241)) === 960,
  [
    escposPrintWidthDots(setting("thermal", 58)),
    escposPrintWidthDots(setting("thermal", 80)),
    escposPrintWidthDots(setting("dot_matrix", 76)),
    escposPrintWidthDots(setting("dot_matrix", 241)),
  ].join(" "),
);
check(
  "lebar tak didukung dibaca sebagai kertas **terdekat** printer itu (999 mm → 80 mm, bukan 58 mm)",
  escposPrintWidthDots({ printerId: "thermal", paperWidthMm: 999 }) === 576 &&
    escposPrintWidthDots({ printerId: "portable", paperWidthMm: "80" }) ===
      escposPrintWidthDots(setting("portable", 58)),
  `999→${escposPrintWidthDots({ printerId: "thermal", paperWidthMm: 999 })} dot, portable 80→${escposPrintWidthDots({ printerId: "portable", paperWidthMm: "80" })} dot`,
);
check(
  "setelan tanpa lebar jatuh ke kertas pertama printer itu; setelan kosong ke bawaan thermal 80 mm",
  escposPrintWidthDots({ printerId: "thermal" }) === 384 &&
    escposPrintWidthDots(null) === 576,
  `${escposPrintWidthDots({ printerId: "thermal" })} dot tanpa lebar, ${escposPrintWidthDots(null)} dot untuk workspace yang belum mengatur`,
);
check(
  "lebar satu huruf font A = 12 dot (32/48/40/80 kolom)",
  ESC_POS_FONT_DOTS === 12 &&
    escposPrintWidthDots(setting("thermal", 58)) / ESC_POS_FONT_DOTS === 32 &&
    escposPrintWidthDots(setting("thermal", 80)) / ESC_POS_FONT_DOTS === 48 &&
    escposPrintWidthDots(setting("dot_matrix", 241)) / ESC_POS_FONT_DOTS === 80,
  String(ESC_POS_FONT_DOTS),
);
check(
  "logo dicetak sebesar di jalur cetak peramban, tidak ikut melebar di kertas faktur",
  escposLogoDots(setting("thermal", 58)) === Math.round(ESC_POS_LOGO_MM * ESC_POS_DOTS_PER_MM) &&
    escposLogoDots(setting("thermal", 80)) === escposLogoDots(setting("thermal", 58)) &&
    escposLogoDots(setting("dot_matrix", 241)) === escposLogoDots(setting("thermal", 58)),
  `${escposLogoDots(setting("thermal", 80))} dot di semua kertas`,
);
check(
  "logo tidak pernah lebih lebar dari area cetaknya",
  [58, 80].every(
    (mm) =>
      escposLogoDots(setting("thermal", mm)) <=
      escposPrintWidthDots(setting("thermal", mm)) - ESC_POS_LOGO_MARGIN_DOTS,
  ),
  `${escposLogoDots(setting("thermal", 58))} ≤ ${escposPrintWidthDots(setting("thermal", 58)) - ESC_POS_LOGO_MARGIN_DOTS}`,
);

// ----------------------------------------------------------------- raster
const bitmap = escposPackBitmap(10, 3, (x, y) => (y === 0 && (x === 0 || x === 7 || x === 8)) || (y === 1 && x === 9));
check(
  "bitmap dipadatkan 1 bit per piksel, lebarnya dibulatkan ke kelipatan 8",
  bitmap.widthPx === 16 && bitmap.heightPx === 3 && bitmap.data.length === 6,
  `${bitmap.widthPx}x${bitmap.heightPx} (${bitmap.data.length} byte)`,
);
check(
  "bit kiri = bit paling berarti, dan baris berikutnya mulai di byte berikutnya",
  Array.from(bitmap.data).join(",") === [0x81, 0x80, 0x00, 0x40, 0x00, 0x00].join(","),
  Array.from(bitmap.data).join(","),
);
check(
  "bitmap kosong tetap berbentuk sah (tidak melempar)",
  (() => {
    const kosong = escposPackBitmap(0, 0, () => true);
    return kosong.heightPx === 0 && kosong.data.length === 0;
  })(),
  "0x0",
);
const raster = escposRasterCommand(bitmap);
check(
  "perintah raster GS v 0 menulis lebar (byte) & tinggi (dot) pada header 8 byte",
  raster.length === 8 + bitmap.data.length &&
    raster[0] === GS &&
    raster[1] === 0x76 &&
    raster[2] === 0x30 &&
    raster[3] === 0x00 &&
    raster[4] === 2 &&
    raster[5] === 0 &&
    raster[6] === 3 &&
    raster[7] === 0,
  raster.slice(0, 8).join(","),
);
check(
  "lebar > 255 dot dikirim dua byte (logo 233 dot → 30 byte per baris)",
  (() => {
    const besar = escposPackBitmap(233, 2, (x, y) => x === 200 && y === 1);
    const perintah = escposRasterCommand(besar);
    return besar.widthPx === 240 && perintah[4] === 30 && perintah[5] === 0;
  })(),
  "233 dot → 240 (30 byte)",
);

// ------------------------------------------------------- rangkaian perintah
const steps80 = escposReceiptSteps(doc80);
check(
  "rangkaiannya dimulai inisialisasi, halaman kode, lalu lebar cetak (80 mm = 576 dot)",
  JSON.stringify(steps80[0].bytes) === JSON.stringify([ESC, 0x40]) &&
    JSON.stringify(steps80[1].bytes) === JSON.stringify([ESC, 0x74, ESC_POS_CODE_PAGE]) &&
    JSON.stringify(steps80[2].bytes) === JSON.stringify([GS, 0x57, 0x40, 0x02]),
  steps80.slice(0, 3).map((step) => step.label).join(" | "),
);
check(
  "urutan langkahnya: inisialisasi → halaman kode → lebar → teks → umpan → potong",
  steps80.map((step) => step.label).join(" ") ===
    `inisialisasi (ESC @) halaman kode CP437 (ESC t ${ESC_POS_CODE_PAGE}) ` +
      "lebar cetak 576 dot (GS W) " +
      `teks lembar 1 (${doc80.sheets[0].lines.length} baris) umpan ${ESC_POS_FEED_LINES} baris (ESC d) potong kertas (GS V 0)`,
  steps80.map((step) => step.label).join(" | "),
);
const teks80 = steps80.find((step) => step.label.startsWith("teks lembar 1"));
check(
  "teks yang dikirim sama persis dengan baris struknya (satu byte per huruf)",
  (() => {
    const harapan = `${doc80.sheets[0].lines.map((line) => escposLine(line, doc80.cols)).join("\n")}\n`;
    const byte = teks80.bytes;
    const ascii = byte.map((value) => String.fromCharCode(value)).join("");
    return ascii === harapan && byte.length === harapan.length;
  })(),
  `${teks80.bytes.length} byte`,
);
check(
  "setiap baris yang dikirim tidak lebih lebar dari kertasnya",
  [doc58, doc80, docMatrix, docFaktur].every((doc) =>
    doc.sheets.every((sheet) => sheet.lines.every((line) => escposLine(line, doc.cols).length <= doc.cols)),
  ) &&
    docFaktur.sheets.every((sheet) => sheet.lines.every((line) => line.length <= docFaktur.cols)),
  `80 mm = ${doc80.cols} kolom, faktur = ${docFaktur.cols} kolom`,
);
check(
  "struk thermal dipotong (GS V 0) dan laci kas tidak dibuka kalau tidak diminta",
  steps80.some((step) => JSON.stringify(step.bytes) === JSON.stringify([GS, 0x56, 0x00])) &&
    !steps80.some((step) => step.label.includes("laci")),
  steps80.at(-1).label,
);
check(
  "pulsa pembuka laci (ESC p 0 25 250) hanya dikirim kalau diminta — mis. pembayaran tunai",
  (() => {
    const denganLaci = escposReceiptSteps(doc80, { openDrawer: true });
    const langkah = denganLaci.at(-1);
    return (
      langkah.label.includes("laci") &&
      JSON.stringify(langkah.bytes) === JSON.stringify([ESC, 0x70, 0x00, 0x19, 0xfa])
    );
  })(),
  "ESC p 0 25 250",
);
check(
  "printer berpita tidak dipotong dan tidak dikirimi raster logo",
  (() => {
    const matrix = escposReceiptSteps(docMatrix);
    return (
      !matrix.some((step) => JSON.stringify(step.bytes) === JSON.stringify([GS, 0x56, 0x00])) &&
      matrix.some((step) => step.label.startsWith("tanpa potong")) &&
      !matrix.some((step) => step.label.startsWith("logo"))
    );
  })(),
  escposCapability("dot_matrix").note,
);
check(
  "logo ikut dikirim ke printer thermal (raster) sebagai langkah keempat",
  (() => {
    const denganLogo = escposReceiptSteps(doc80, { logo: bitmap });
    return denganLogo[3].label === "logo 16x3 dot (GS v 0)" && denganLogo[3].bytes.length === 8 + 6;
  })(),
  "GS v 0",
);
check(
  "logo tetap dikirim ke printer portabel (58 mm) tetapi tidak ke printer berpita",
  escposReceiptSteps(doc58, { logo: bitmap }).some((step) => step.label.startsWith("logo")) &&
    !escposReceiptSteps(docMatrix, { logo: bitmap }).some((step) => step.label.startsWith("logo")),
  "thermal/portable: ya · dot matrix: tidak",
);
check(
  "rangkap dot matrix: jarak antar lembar, tanpa potong di antara tembusannya",
  (() => {
    const matrix = escposReceiptSteps(docMatrix);
    const urutan = matrix.map((step) => step.label);
    return (
      urutan.filter((label) => label.startsWith("teks lembar")).length === 2 &&
      urutan.filter((label) => label.startsWith("jarak antar lembar")).length === 1 &&
      urutan.findIndex((label) => label.startsWith("jarak antar lembar")) <
        urutan.findIndex((label) => label.startsWith("teks lembar 2"))
    );
  })(),
  docMatrix.sheets.map((sheet) => sheet.copyLabel || "(asli)").join(" + "),
);
check(
  "tiga lembar faktur 80 kolom membawa tiga teks lembar beserta penanda ASLI/TEMBUSAN",
  (() => {
    const faktur = escposReceiptSteps(docFaktur);
    const teks = faktur.filter((step) => step.label.startsWith("teks lembar"));
    const isi = teks.map((step) => step.bytes.map((value) => String.fromCharCode(value)).join(""));
    return (
      teks.length === 3 &&
      isi[0].includes("ASLI") &&
      isi[1].includes("TEMBUSAN 1") &&
      isi[2].includes("TEMBUSAN 2") &&
      isi.every((teksSatu) => teksSatu.split("\n").every((line) => line.length <= 80))
    );
  })(),
  docFaktur.sheets.map((sheet) => sheet.copyLabel).join(" + "),
);

// -------------------------------------------------------------------- byte
const bytes80 = escposReceiptBytes(doc80);
check(
  "byte akhirnya gabungan langkah-langkahnya, bukan tumpukan kedua",
  bytes80.length === steps80.reduce((sum, step) => sum + step.bytes.length, 0) &&
    steps80
      .flatMap((step) => step.bytes)
      .every((value, index) => value === bytes80[index]),
  `${bytes80.length} byte`,
);
check(
  "struk yang sama menghasilkan byte yang sama (deterministik)",
  (() => {
    const a = escposReceiptBytes(doc80);
    const b = escposReceiptBytes(receiptDocument(setting("thermal", 80), draft));
    return a.length === b.length && a.every((value, index) => value === b[index]);
  })(),
  `${bytes80.length} byte dua kali`,
);
check(
  "dua lembar di printer berpita menghasilkan byte yang berbeda dari satu lembar thermal (tanpa potong & tanpa logo)",
  escposReceiptBytes(docMatrix).length > 0 &&
    escposReceiptBytes(docMatrix).length !== bytes80.length,
  `matrix=${escposReceiptBytes(docMatrix).length} thermal=${bytes80.length}`,
);
check(
  "byte struk tidak pernah memuat huruf non-ASCII",
  bytes80.every((value) => value < 0x80),
  `maks ${Math.max(...bytes80)}`,
);

// -------------------------------------------------------------- kemampuan
check(
  "kemampuan mesin berbeda per jenis: thermal memotong, berpita tidak, portabel tanpa pemotong",
  ESC_POS_CAPABILITY.thermal.cut === true &&
    ESC_POS_CAPABILITY.dot_matrix.cut === false &&
    ESC_POS_CAPABILITY.portable.cut === false &&
    ESC_POS_CAPABILITY.thermal.raster === true &&
    ESC_POS_CAPABILITY.dot_matrix.raster === false &&
    escposCapability("portable").raster === true,
  Object.entries(ESC_POS_CAPABILITY).map(([id, cap]) => `${id}:${cap.cut ? "potong" : "tanpa potong"}`).join(" "),
);
check(
  "jenis printer tak dikenal jatuh ke bawaan (thermal), bukan gagal",
  escposCapability("printer-misterius").cut === ESC_POS_CAPABILITY.thermal.cut &&
    escposCapability(undefined).raster === true,
  escposCapability(undefined).note,
);
check(
  "setiap keterangan kemampuan bisa dibaca kasir (bukan kosong)",
  Object.values(ESC_POS_CAPABILITY).every((cap) => cap.note.length > 12),
  Object.values(ESC_POS_CAPABILITY).map((cap) => cap.note).join(" | "),
);

// ----------------------------------------------------------------- transport
check(
  "dua jalur cetak langsung: USB & Bluetooth (LAN tidak bisa dari halaman web)",
  ESC_POS_TRANSPORTS.length === 2 &&
    ESC_POS_TRANSPORTS.map((jalur) => jalur.id).join(",") === "usb,bluetooth",
  ESC_POS_TRANSPORTS.map((jalur) => jalur.label).join(" + "),
);
check(
  "jalur tak dikenal dibaca sebagai USB, dan labelnya bisa ditampilkan",
  escposTransportOf("serial") === "usb" &&
    escposTransportOf("bluetooth") === "bluetooth" &&
    escposTransportLabel("bluetooth") === "Bluetooth" &&
    escposTransportLabel(undefined) === "USB",
  `${escposTransportOf("serial")} / ${escposTransportLabel("bluetooth")}`,
);
check(
  "sekali kirim: USB 16 KiB, Bluetooth 100 byte (MTU BLE kecil)",
  escposChunkBytes("usb") === ESC_POS_USB_CHUNK_BYTES &&
    escposChunkBytes("bluetooth") === ESC_POS_BLE_CHUNK_BYTES &&
    ESC_POS_USB_CHUNK_BYTES === 16384 &&
    ESC_POS_BLE_CHUNK_BYTES === 100,
  `${ESC_POS_USB_CHUNK_BYTES} / ${ESC_POS_BLE_CHUNK_BYTES}`,
);
check(
  "pemecahan byte tidak menghilangkan atau mengubah urutannya",
  (() => {
    const sumber = Uint8Array.from({ length: 250 }, (_unused, index) => index % 251);
    const potongan = escposChunks(sumber, 100);
    const gabung = new Uint8Array(potongan.flatMap((chunk) => Array.from(chunk)));
    return (
      potongan.length === 3 &&
      potongan[0].length === 100 &&
      potongan[1].length === 100 &&
      potongan[2].length === 50 &&
      gabung.length === sumber.length &&
      gabung.every((value, index) => value === sumber[index])
    );
  })(),
  "250 byte → 100+100+50",
);
check(
  "struk utuh masuk satu kirim USB, tetapi terpecah di Bluetooth",
  (() => {
    const struk = docFaktur.sheets.length === 3 ? escposReceiptBytes(docFaktur) : bytes80;
    return (
      escposChunks(struk, escposChunkBytes("usb")).length === 1 &&
      escposChunks(struk, escposChunkBytes("bluetooth")).length > 1
    );
  })(),
  `${escposReceiptBytes(docFaktur).length} byte struk faktur`,
);
check(
  "byte kosong tidak menjadi potongan kosong (printer tidak dikirimi sampah)",
  escposChunks(new Uint8Array(0), 100).length === 0 &&
    escposChunks(Uint8Array.from([1, 2, 3]), 0).length === 3,
  "0 byte → 0 kirim",
);

// ------------------------------------------------------------ profil BLE/USB
check(
  "profil Bluetooth yang dikenal ada lima (ISSC, 18F0, FF00, HM-10, NIIMBOT)",
  ESC_POS_BLE_PROFILES.length === 5 &&
    ESC_POS_BLE_PROFILES.map((profil) => profil.label).join(", ") ===
      "ISSC / Microchip UART, 18F0 / 2AF1, FF00 / FF02, HM-10 / CC254x UART, NIIMBOT",
  ESC_POS_BLE_PROFILES.map((profil) => profil.label).join(", "),
);
check(
  "semua UUID berbentuk sah (huruf kecil, 8-4-4-4-12)",
  ESC_POS_BLE_PROFILES.every((profil) =>
    [profil.service, profil.characteristic].every((uuid) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid),
    ),
  ),
  ESC_POS_BLE_PROFILES[1].service,
);
check(
  "izin service diminta sekali saja (tanpa duplikat), berisi semua profil",
  ESC_POS_BLE_OPTIONAL_SERVICES.length === ESC_POS_BLE_PROFILES.length &&
    new Set(ESC_POS_BLE_OPTIONAL_SERVICES).size === ESC_POS_BLE_OPTIONAL_SERVICES.length &&
    ESC_POS_BLE_PROFILES.every((profil) =>
      ESC_POS_BLE_OPTIONAL_SERVICES.includes(profil.service),
    ),
  `${ESC_POS_BLE_OPTIONAL_SERVICES.length} layanan`,
);
check(
  "tiap profil menjelaskan siapa yang memakainya (bukan daftar UUID tanpa keterangan)",
  ESC_POS_BLE_PROFILES.every((profil) => profil.note.length > 20),
  ESC_POS_BLE_PROFILES[0].note,
);
check(
  "saringan USB mencakup kelas printer (0x07) dan perangkat vendor-specific (0xff)",
  ESC_POS_USB_FILTERS.length === 2 &&
    ESC_POS_USB_FILTERS[0].classCode === 0x07 &&
    ESC_POS_USB_FILTERS[1].classCode === 0xff,
  ESC_POS_USB_FILTERS.map((filter) => `0x${filter.classCode.toString(16)}`).join(" "),
);

// -------------------------------------------------------------- dukungan web
check(
  "peramban dengan WebUSB saja tetap bisa mencetak langsung",
  escposSupport(true, false).supported === true &&
    escposSupport(true, false).usb === true &&
    escposSupport(true, false).bluetooth === false,
  "usb",
);
check(
  "peramban dengan Web Bluetooth saja (Chrome Android) tetap bisa mencetak langsung",
  escposSupport(false, true).supported === true && escposSupport(false, true).reason === "",
  "bluetooth",
);
check(
  "peramban tanpa keduanya (Firefox/Safari) menyebut Chrome/Edge dan tetap menawarkan dialog cetak",
  escposSupport(false, false).supported === false &&
    escposSupport(false, false).reason.includes("Chrome") &&
    escposSupport(false, false).reason.includes("dialog cetak peramban"),
  escposSupport(false, false).reason.slice(0, 60),
);
check(
  "alasan yang sama menyebut Android untuk Bluetooth (printer portabel di ponsel)",
  escposSupport(false, false).reason.includes("Android"),
  "Android",
);

// ------------------------------------------------------------------ galat
check(
  "galat peramban diterjemahkan jadi kalimat yang bisa ditindaklanjuti",
  escposErrorMessage("NotFoundError", "usb").includes("dipilih") &&
    escposErrorMessage("NotAllowedError", "usb").includes("Izin") &&
    escposErrorMessage("SecurityError", "bluetooth").includes("HTTPS") &&
    escposErrorMessage("NetworkError", "bluetooth").includes("tidak menjawab") &&
    escposErrorMessage("InvalidStateError", "usb").includes("sambungan lain") &&
    escposErrorMessage("NotSupportedError", "usb").includes("protokol vendornya sendiri"),
  escposErrorMessage("SecurityError", "usb"),
);
check(
  "galat yang tidak dikenal tetap menyebut jalurnya, bukan kosong",
  escposErrorMessage("WeirdError", "bluetooth") === "Gagal menyambung ke printer Bluetooth (WeirdError)." &&
    escposErrorMessage("", "usb") === "Gagal menyambung ke printer USB.",
  escposErrorMessage("WeirdError", "bluetooth"),
);

// ------------------------------------------------------ lebar struk vs kertas
check(
  "lebar cetak cocok dengan katalog printer (kolom × 12 dot)",
  ["thermal", "dot_matrix", "portable"].every((id) =>
    receiptPrinterOf(id).papers.every(
      (paper) =>
        escposPrintWidthDots({ printerId: id, paperWidthMm: paper.widthMm }) === paper.cols * 12,
    ),
  ),
  "58→384, 80→576, 76→480, 241→960",
);

console.log(`${results.length}/${results.length} checks passed`);

/**
 * Uji aturan murni pesanan QR meja (modul F&B) tanpa deployment.
 *
 * Kenapa ada: fitur ini punya tiga janji yang gampang sekali bocor diam-diam,
 * dan semuanya bisa diuji tanpa server:
 *
 *   1. **Tautan meja itu rahasia & bisa dipindai.** Tokennya berformat tetap
 *      (`mj_<32 hex>`), dan kode QR yang dicetak benar-benar berisi tautan itu —
 *      dibuktikan bolak-balik lewat pemindai QR sungguhan (`jsqr`).
 *   2. **Harga & jumlah pesanan tamu tidak dari ponsel.** Validasi keranjang
 *      menolak menu tak dikenal, menu nonaktif, menu habis, jumlah nol/pecahan,
 *      dan pesanan kebesaran — dan subtotalnya selalu dari harga katalog.
 *   3. **Total tamu = total kasir.** `guestOrderTotal` dibandingkan langsung
 *      dengan `orderTotal` untuk beberapa setelan pajak; dua rumus yang berbeda
 *      akan ketahuan di sini, bukan setelah tamu membayar angka yang lain.
 *   4. **Dua cara bayar tamu.** QRIS atau Virtual Account bank pilihan; pesanan
 *      tanpa pilihan tetap QRIS, VA wajib menyebut banknya, dan nomor VA-nya
 *      deterministik dari bank + urutan tagihan (nomor yang sama tidak pernah
 *      menunjuk dua tagihan).
 *   5. **Gambar QRIS untuk screenshot benar-benar bisa dipindai.** Geometrinya
 *      dihitung aturan murni (`@/lib/qrisImage`), lalu gambarnya **dibangun ulang
 *      piksel demi piksel** seperti kanvas peramban menggambarnya dan dibaca balik
 *      pemindai QR sungguhan — screenshot dari galeri harus tetap sah.
 *
 * Usage: bun scripts/verify-meja.mjs
 */
import jsQR from "jsqr";
import {
  GUEST_DEFAULT_PAY_METHOD,
  GUEST_MAX_LINES,
  GUEST_MAX_QTY_PER_ITEM,
  GUEST_MAX_UNITS,
  GUEST_NAME_MAX,
  GUEST_PAY_BANKS,
  GUEST_QRIS_SCREENSHOT_LABEL,
  guestBankOptions,
  guestCancelCheck,
  guestChargeReference,
  guestOrderTotal,
  guestPayOptions,
  guestPaymentInstruction,
  guestPaymentMethod,
  guestQrisFileName,
  guestTaxRulesFrom,
  isAwaitingPayment,
  isMejaMenuToken,
  isMejaWatchToken,
  mejaMenuPath,
  mejaMenuToken,
  mejaMenuUrl,
  mejaUnavailableReason,
  mejaWatchToken,
  normalizeGuestName,
  validateGuestCart,
  MEJA_ORDER_STATUS_LABELS,
} from "../src/convex/lib/meja.ts";
import { orderTotal } from "../src/convex/lib/fnbTax.ts";
import { entitlementFor } from "../src/convex/lib/billing/entitlements.ts";
import {
  DIGITAL_REFERENCE_MAX,
  VA_BANKS,
  VA_EXPIRY_MINUTES,
  expiryAtFor,
  qrPayload,
  virtualAccountNumber,
} from "../src/convex/lib/digitalPayment.ts";
import {
  QR_QUIET_ZONE,
  isPlausibleQrMatrix,
  qrMatrix,
} from "../src/lib/qr.ts";
import {
  QRIS_IMAGE_CAPTION_MAX,
  QRIS_IMAGE_MARGIN_PX,
  QRIS_IMAGE_MAX_SCALE,
  QRIS_IMAGE_MIN_SCALE,
  QRIS_IMAGE_SCALE,
  qrisImageCaption,
  qrisImageLayout,
} from "../src/lib/qrisImage.ts";

const results = [];
function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail}`);
}

// ------------------------------------------------------------------- token

const token = mejaMenuToken("3F2A9B77-4C1D-8E55-A1B2C3D4-E5F60718");
check(
  "token meja berbentuk `mj_` + 32 karakter hex",
  isMejaMenuToken(token) && token === "mj_3f2a9b774c1d8e55a1b2c3d4e5f60718",
  token,
);
check(
  "token yang lebih pendek dipadkan sampai 32 karakter (bentuknya tetap sah)",
  mejaMenuToken("abcd") === `mj_abcd${"0".repeat(28)}`,
  mejaMenuToken("abcd"),
);
check(
  "nilai acak apa pun menghasilkan token yang sah (uuid tanpa tanda hubung)",
  isMejaMenuToken(mejaMenuToken("9cf0c3d0f5f14c8ab1cd2ef3a4b5c6d7")),
  "token uuid tidak dikenali",
);
check(
  "token pendek/asing ditolak",
  !isMejaMenuToken("mj_123") &&
    !isMejaMenuToken("tbl_3f2a9b774c1d8e55a1b2c3d4e5f6") &&
    !isMejaMenuToken(""),
  "token asing diterima",
);
check(
  "token pemantau pesanan punya awalan sendiri (`mjo_`)",
  isMejaWatchToken(mejaWatchToken("ABCDEF")) &&
    !isMejaWatchToken(token) &&
    !isMejaMenuToken(mejaWatchToken("ABCDEF")),
  "token meja & token pemantau tertukar",
);

const path = mejaMenuPath(token);
check(
  "path halaman tamu memuat tokennya di belakang `/meja`",
  path === `/meja/${token}`,
  path,
);
check(
  "tautan absolut tidak menggandakan garis miring origin",
  mejaMenuUrl("https://mesinpos.test/", token) === `https://mesinpos.test${path}` &&
    mejaMenuUrl("https://mesinpos.test", token) === `https://mesinpos.test${path}`,
  mejaMenuUrl("https://mesinpos.test/", token),
);

// ------------------------------------------------------- kode QR bisa dipindai

const url = mejaMenuUrl("https://mesinpos.test", token);
const matrix = qrMatrix(url);
check("kode QR tautan meja berstruktur QR sah", isPlausibleQrMatrix(matrix), "bukan QR");

function rasterize(source, scale) {
  const size = source.size;
  const extent = (size + QR_QUIET_ZONE * 2) * scale;
  const data = new Uint8ClampedArray(extent * extent * 4);
  for (let y = 0; y < extent; y += 1) {
    for (let x = 0; x < extent; x += 1) {
      const col = Math.floor(x / scale) - QR_QUIET_ZONE;
      const row = Math.floor(y / scale) - QR_QUIET_ZONE;
      const dark =
        row >= 0 && row < size && col >= 0 && col < size && source.modules[row * size + col];
      const offset = (y * extent + x) * 4;
      const value = dark ? 0 : 255;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { data, extent };
}

const scanned = rasterize(matrix, 8);
const decoded = jsQR(scanned.data, scanned.extent, scanned.extent);
check(
  "pemindai QR membaca balik tautan menu meja yang sama",
  decoded?.data === url,
  `terbaca=${decoded?.data ?? "null"}`,
);
check(
  "dua meja berbeda tidak bertukar kode",
  JSON.stringify(qrMatrix(mejaMenuUrl("https://mesinpos.test", mejaMenuToken("1111"))).modules) !==
    JSON.stringify(matrix.modules),
  "kode dua meja sama",
);

// ------------------------------------------------------------ validasi keranjang

const catalog = [
  { id: "p-kopi", name: "Kopi Susu", price: 22_000, active: true, trackStock: true, stock: 12 },
  { id: "p-roti", name: "Roti Bakar", price: 18_500, active: true, trackStock: true, stock: 1 },
  { id: "p-air", name: "Air Mineral", price: 6_000, active: true, trackStock: false, stock: 0 },
  { id: "p-mati", name: "Menu Lama", price: 15_000, active: false, trackStock: false, stock: 9 },
  { id: "p-habis", name: "Es Kopi Habis", price: 25_000, active: true, trackStock: true, stock: 0 },
];

const ok = validateGuestCart(
  [
    { productId: "p-kopi", quantity: 2 },
    { productId: "p-air", quantity: 1 },
  ],
  catalog,
);
check(
  "keranjang sah dihitung dari harga katalog, bukan dari klien",
  ok.ok && ok.value.subtotal === 22_000 * 2 + 6_000 && ok.value.lines.length === 2,
  JSON.stringify(ok),
);
check(
  "produk tanpa lacak stok tetap boleh dipesan walau stoknya 0",
  ok.ok && ok.value.lines.some((line) => line.productId === "p-air"),
  "air mineral ditolak",
);

const rejected = (items) => {
  const outcome = validateGuestCart(items, catalog);
  return outcome.ok ? null : outcome.reason;
};

check(
  "keranjang kosong ditolak",
  (rejected([]) ?? "").includes("Belum ada menu"),
  rejected([]),
);
check(
  "menu tak dikenal ditolak dengan kalimat yang bisa dibaca tamu",
  (rejected([{ productId: "p-hantu", quantity: 1 }]) ?? "").includes("tidak dikenal"),
  rejected([{ productId: "p-hantu", quantity: 1 }]),
);
check(
  "menu nonaktif ditolak (bukan dijual diam-diam)",
  (rejected([{ productId: "p-mati", quantity: 1 }]) ?? "").includes("tidak dijual"),
  rejected([{ productId: "p-mati", quantity: 1 }]),
);
check(
  "menu habis ditolak",
  (rejected([{ productId: "p-habis", quantity: 1 }]) ?? "").includes("habis"),
  rejected([{ productId: "p-habis", quantity: 1 }]),
);
check(
  "jumlah 0 / negatif / pecahan ditolak",
  rejected([{ productId: "p-kopi", quantity: 0 }]) !== null &&
    rejected([{ productId: "p-kopi", quantity: -2 }]) !== null &&
    // 1,5 porsi dipotong jadi 1 — tidak boleh terkirim sebagai pecahan.
    validateGuestCart([{ productId: "p-kopi", quantity: 1.5 }], catalog).value.lines[0]
      .quantity === 1,
  "jumlah tidak sah lolos",
);
check(
  `jumlah per menu dibatasi ${GUEST_MAX_QTY_PER_ITEM} porsi`,
  (rejected([{ productId: "p-kopi", quantity: GUEST_MAX_QTY_PER_ITEM + 1 }]) ?? "").includes(
    "maksimal",
  ),
  rejected([{ productId: "p-kopi", quantity: GUEST_MAX_QTY_PER_ITEM + 1 }]),
);
check(
  "jumlah melebihi stok yang tersisa ditolak beserta angkanya",
  (rejected([{ productId: "p-roti", quantity: 2 }]) ?? "").includes("tinggal 1"),
  rejected([{ productId: "p-roti", quantity: 2 }]),
);
check(
  `satu pesanan maksimal ${GUEST_MAX_LINES} baris`,
  (() => {
    const many = Array.from({ length: GUEST_MAX_LINES + 1 }, () => ({
      productId: "p-kopi",
      quantity: 1,
    }));
    return (rejected(many) ?? "").includes("baris menu");
  })(),
  "batas baris tidak ditegakkan",
);
check(
  `satu pesanan maksimal ${GUEST_MAX_UNITS} item`,
  (() => {
    const unit = Math.min(GUEST_MAX_QTY_PER_ITEM, 10);
    const lines = Math.ceil(GUEST_MAX_UNITS / unit) + 1;
    const many = Array.from({ length: lines }, () => ({
      productId: "p-kopi",
      quantity: unit,
    }));
    return rejected(many) !== null;
  })(),
  "batas total item tidak ditegakkan",
);

check(
  "nama tamu dirapikan & dipotong pada batasnya",
  normalizeGuestName("  Rina   Kusuma  ") === "Rina Kusuma" &&
    normalizeGuestName("x".repeat(200)).length === GUEST_NAME_MAX &&
    normalizeGuestName(undefined) === "",
  normalizeGuestName("  Rina   Kusuma  "),
);

// ------------------------------------------------------- total tamu = total kasir

const settings = [
  {
    label: "tanpa pajak & tanpa biaya layanan",
    ppn: { active: false, ratePct: 11 },
    fnb: { serviceChargeActive: false, serviceChargePct: 5, serviceChargeInTaxBase: false },
  },
  {
    label: "PPN 11% saja",
    ppn: { active: true, ratePct: 11 },
    fnb: { serviceChargeActive: false, serviceChargePct: 5, serviceChargeInTaxBase: false },
  },
  {
    label: "PPN 11% + biaya layanan 5% di luar dasar pajak",
    ppn: { active: true, ratePct: 11 },
    fnb: { serviceChargeActive: true, serviceChargePct: 5, serviceChargeInTaxBase: false },
  },
  {
    label: "PPN 12% + biaya layanan 7% ikut dasar pajak",
    ppn: { active: true, ratePct: 12 },
    fnb: { serviceChargeActive: true, serviceChargePct: 7, serviceChargeInTaxBase: true },
  },
  {
    label: "PBJT daerah 10% menggantikan PPN",
    ppn: { active: true, ratePct: 11 },
    fnb: {
      serviceChargeActive: true,
      serviceChargePct: 5,
      serviceChargeInTaxBase: true,
      regionalActive: true,
      regionalRatePct: 10,
    },
  },
];

for (const setting of settings) {
  const net = 33_333;
  const server = orderTotal({ net, ppn: setting.ppn, fnb: setting.fnb });
  const guest = guestOrderTotal(net, guestTaxRulesFrom(setting.ppn, setting.fnb));
  check(
    `total tamu sama dengan total server (${setting.label})`,
    guest.total === server.total &&
      guest.tax === server.tax &&
      guest.serviceCharge === server.serviceCharge,
    `tamu=${JSON.stringify(guest)} server=${JSON.stringify({
      total: server.total,
      tax: server.tax,
      service: server.serviceCharge,
    })}`,
  );
  check(
    `rincian total tamu memakai label & tarif yang sama (${setting.label})`,
    JSON.stringify(guest.lines) === JSON.stringify(server.lines),
    `tamu=${JSON.stringify(guest.lines)} server=${JSON.stringify(server.lines)}`,
  );
}

check(
  "penerbitan tagihan memakai rumus yang sama dengan kasir (tanpa pajak)",
  orderTotal({
    net: 100_000,
    ppn: { active: false, ratePct: 11 },
    fnb: { serviceChargeActive: false, serviceChargePct: 5, serviceChargeInTaxBase: false },
  }).total === 100_000,
  "total tanpa pajak berubah",
);

// --------------------------------------------------------- keterangan tagihan

const reference = guestChargeReference("A2", [
  { name: "Kopi Susu", quantity: 2 },
  { name: "Roti Bakar", quantity: 1 },
]);
check(
  "keterangan tagihan tamu menyebut meja & isinya",
  reference.startsWith("Meja A2 · 3 item · 2× Kopi Susu") &&
    reference.length <= DIGITAL_REFERENCE_MAX,
  reference,
);
const longReference = guestChargeReference(
  "B12",
  Array.from({ length: 12 }, (_, index) => ({
    name: `Menu Dengan Nama Panjang ${index}`,
    quantity: 1,
  })),
);
check(
  "keterangan panjang dipotong pada batas kolom tagihan",
  longReference.length === DIGITAL_REFERENCE_MAX,
  `${longReference.length} karakter`,
);
check(
  "keterangan tanpa baris tetap menyebut mejanya",
  guestChargeReference("A6", []) === "Meja A6 · 0 item",
  guestChargeReference("A6", []),
);

// ----------------------------------------------------------------- gerbang

const fnbOn = ["umkm", "fnb"];
check(
  "workspace Enterprise + modul F&B: menu tamu hidup",
  mejaUnavailableReason(entitlementFor("enterprise"), fnbOn) === null,
  mejaUnavailableReason(entitlementFor("enterprise"), fnbOn) ?? "",
);
check(
  "modul F&B dimatikan: alasan menyarankan menyalakan modulnya",
  (
    mejaUnavailableReason(entitlementFor("enterprise"), ["umkm"]) ?? ""
  ).includes("memerlukan modul Food & Beverage"),
  mejaUnavailableReason(entitlementFor("enterprise"), ["umkm"]) ?? "",
);
check(
  "paket Starter: alasan menyarankan naik paket",
  (mejaUnavailableReason(entitlementFor("starter"), fnbOn) ?? "").includes("tidak termasuk paket"),
  mejaUnavailableReason(entitlementFor("starter"), fnbOn) ?? "",
);

// ----------------------------------------------------------------- status

check(
  "label status pesanan menjelaskan tahapnya ke pembaca",
  MEJA_ORDER_STATUS_LABELS.pending === "Menunggu pembayaran" &&
    MEJA_ORDER_STATUS_LABELS.paid.includes("dapur") &&
    MEJA_ORDER_STATUS_LABELS.cancelled === "Dibatalkan",
  JSON.stringify(MEJA_ORDER_STATUS_LABELS),
);
/*
  Dapur hanya melihat pesanan yang **sudah lunas**. Karena itu "masih menunggu
  pelunasan" bukan sekadar `status: "pending"`: tagihan yang sudah dibatalkan
  kasir dari halaman Pembayaran atau kedaluwarsa tidak lagi menunggu apa pun —
  melaporkannya sebagai menunggu akan menyuruh kasir membayar tagihan yang sudah
  mati, dan menahannya di pagar hapus meja akan mengunci denah.
*/
check(
  "pesanan dengan tagihan yang masih bisa dibayar masih menunggu pelunasan",
  isAwaitingPayment({ status: "pending", chargeStatus: "pending" }) === true,
  String(isAwaitingPayment({ status: "pending", chargeStatus: "pending" })),
);
check(
  "tagihan yang dibatalkan atau kedaluwarsa tidak lagi menunggu pelunasan",
  isAwaitingPayment({ status: "pending", chargeStatus: "cancelled" }) === false &&
    isAwaitingPayment({ status: "pending", chargeStatus: "expired" }) === false,
  `${isAwaitingPayment({ status: "pending", chargeStatus: "cancelled" })} / ${isAwaitingPayment({ status: "pending", chargeStatus: "expired" })}`,
);
check(
  "pesanan yang sudah lunas/dibatalkan tidak menunggu pelunasan",
  isAwaitingPayment({ status: "paid", chargeStatus: "paid" }) === false &&
    isAwaitingPayment({ status: "cancelled", chargeStatus: "pending" }) === false,
  `${isAwaitingPayment({ status: "paid", chargeStatus: "paid" })} / ${isAwaitingPayment({ status: "cancelled", chargeStatus: "pending" })}`,
);
check(
  "pesanan tanpa baris tagihan yang terbaca tidak dihitung menunggu",
  isAwaitingPayment({ status: "pending", chargeStatus: null }) === false,
  String(isAwaitingPayment({ status: "pending", chargeStatus: null })),
);
check(
  "tagihan QRIS pesanan tamu berumur seperti QRIS biasa (5 menit)",
  expiryAtFor("qris", 1_000_000) - 1_000_000 === 5 * 60 * 1000,
  String(expiryAtFor("qris", 1_000_000) - 1_000_000),
);
check(
  "payload QRIS tagihan tamu memuat nomor & nominalnya",
  qrPayload({ number: "DIG-2026-0009", amount: 47_000, merchantName: "Kopi Senja" }).includes(
    "DIG-2026-0009",
  ) &&
    qrPayload({ number: "DIG-2026-0009", amount: 47_000 }).includes("47000"),
  "payload tidak memuat nomor/nominal",
);

// ------------------------------------------------------ cara bayar tamu

check(
  "pesanan tanpa pilihan cara bayar tetap QRIS (tautan lama tidak pecah)",
  (() => {
    const kosong = guestPaymentMethod({});
    const qris = guestPaymentMethod({ method: "qris" });
    return (
      kosong.ok &&
      kosong.value.method === GUEST_DEFAULT_PAY_METHOD &&
      kosong.value.bank === null &&
      qris.ok &&
      qris.value.method === "qris" &&
      qris.value.bank === null
    );
  })(),
  JSON.stringify(guestPaymentMethod({})),
);
check(
  "Virtual Account wajib menyebut bank penerbitnya",
  (() => {
    const tanpaBank = guestPaymentMethod({ method: "va" });
    const salah = guestPaymentMethod({ method: "va", bank: "bank-asing" });
    return (
      !tanpaBank.ok &&
      tanpaBank.reason.includes("Pilih bank") &&
      !salah.ok &&
      guestPaymentMethod({ method: "va", bank: "bca" }).ok === true
    );
  })(),
  JSON.stringify(guestPaymentMethod({ method: "va" })),
);
check(
  "QRIS menolak bank penerbit (salah paham yang khas)",
  (() => {
    const hasil = guestPaymentMethod({ method: "qris", bank: "bca" });
    return !hasil.ok && hasil.reason.includes("tidak memakai bank");
  })(),
  JSON.stringify(guestPaymentMethod({ method: "qris", bank: "bca" })),
);
check(
  "cara bayar asing ditolak dengan kalimat yang bisa dibaca tamu",
  (() => {
    const hasil = guestPaymentMethod({ method: "ewallet" });
    return !hasil.ok && hasil.reason.includes("belum dikenal");
  })(),
  JSON.stringify(guestPaymentMethod({ method: "ewallet" })),
);
check(
  "pilihan cara bayar yang ditawarkan halaman: QRIS lalu Virtual Account",
  (() => {
    const opsi = guestPayOptions();
    return (
      opsi.length === 2 &&
      opsi[0].method === "qris" &&
      opsi[1].method === "va" &&
      opsi.every((option) => option.label.length > 0 && option.hint.length > 0)
    );
  })(),
  JSON.stringify(guestPayOptions()),
);
check(
  "bank Virtual Account tamu = bank yang sama dengan halaman Pembayaran",
  (() => {
    const banks = guestBankOptions();
    return (
      banks.length === GUEST_PAY_BANKS.length &&
      banks.every(
        (option) =>
          option.label === VA_BANKS[option.bank].label &&
          option.prefix === VA_BANKS[option.bank].prefix,
      ) &&
      banks.map((option) => option.prefix).join(",") === "8808,8810,8888,8907"
    );
  })(),
  JSON.stringify(guestBankOptions()),
);
check(
  "nomor Virtual Account deterministik dari bank + urutan tagihan",
  virtualAccountNumber("bca", 7) === "880800000007" &&
    virtualAccountNumber("mandiri", 1) === "890700000001" &&
    virtualAccountNumber("bca", 7) !== virtualAccountNumber("bni", 7),
  `${virtualAccountNumber("bca", 7)} / ${virtualAccountNumber("bni", 7)}`,
);
check(
  "tagihan Virtual Account tamu berumur sehari (bukan 5 menit seperti QRIS)",
  expiryAtFor("va", 1_000_000) - 1_000_000 === VA_EXPIRY_MINUTES * 60 * 1000 &&
    VA_EXPIRY_MINUTES === 24 * 60,
  String(expiryAtFor("va", 1_000_000) - 1_000_000),
);
check(
  "kalimat QRIS menyebut tombol screenshot-nya & nominal tagihannya",
  (() => {
    const kalimat = guestPaymentInstruction({
      method: "qris",
      bank: null,
      amount: 47_000,
      qrPayload: "payload",
    });
    return (
      kalimat.includes(GUEST_QRIS_SCREENSHOT_LABEL) &&
      kalimat.includes("47.000 rupiah") &&
      kalimat.includes("galeri")
    );
  })(),
  guestPaymentInstruction({ method: "qris", bank: null, amount: 47_000 }),
);
check(
  "kalimat Virtual Account menyebut bank & nomornya",
  (() => {
    const kalimat = guestPaymentInstruction({
      method: "va",
      bank: "bni",
      amount: 47_000,
      vaNumber: "881000000012",
    });
    return (
      kalimat.includes("Virtual Account BNI 881000000012") &&
      kalimat.includes("47.000 rupiah")
    );
  })(),
  guestPaymentInstruction({ method: "va", bank: "bni", amount: 47_000, vaNumber: "881000000012" }),
);
check(
  "nama berkas gambar QRIS memuat nomor tagihannya",
  guestQrisFileName("DIG-2026-0007") === "qris-dig-2026-0007.png" &&
    guestQrisFileName("  /DIG 2026/0007  ") === "qris-dig-2026-0007.png" &&
    guestQrisFileName("").endsWith(".png"),
  guestQrisFileName("  /DIG 2026/0007  "),
);

// -------------------------------------------------- gambar QRIS (screenshot)

const qrisCharge = { number: "DIG-2026-0011", amount: 47_000 };
const qrisPayloadValue = qrPayload({
  number: qrisCharge.number,
  amount: qrisCharge.amount,
  merchantName: "Kopi Senja",
});
const shotLayout = qrisImageLayout(qrisPayloadValue, {
  caption: qrisImageCaption({
    amount: qrisCharge.amount,
    chargeNumber: qrisCharge.number,
  }),
});

check(
  "gambar QRIS memakai zona tenang & tepi putih (pemindai butuh margin)",
  shotLayout.quietZonePx === QR_QUIET_ZONE * shotLayout.scale &&
    shotLayout.widthPx === shotLayout.codePx + QRIS_IMAGE_MARGIN_PX * 2 &&
    shotLayout.extent === shotLayout.size + QR_QUIET_ZONE * 2,
  JSON.stringify(shotLayout),
);
check(
  "gambar QRIS memuat keterangan nominal + nomor tagihan di bawah kode",
  shotLayout.caption === "Rp 47.000 · DIG-2026-0011" &&
    shotLayout.heightPx === shotLayout.widthPx + shotLayout.captionPx &&
    shotLayout.caption.length <= QRIS_IMAGE_CAPTION_MAX,
  JSON.stringify({ caption: shotLayout.caption, heightPx: shotLayout.heightPx }),
);
check(
  "skala gambar dibatasi (tidak buram, tidak boros) & bawaan 12 px per modul",
  qrisImageLayout(qrisPayloadValue).scale === QRIS_IMAGE_SCALE &&
    qrisImageLayout(qrisPayloadValue, { scale: 1 }).scale === QRIS_IMAGE_MIN_SCALE &&
    qrisImageLayout(qrisPayloadValue, { scale: 999 }).scale === QRIS_IMAGE_MAX_SCALE,
  `${QRIS_IMAGE_SCALE} / ${QRIS_IMAGE_MIN_SCALE} / ${QRIS_IMAGE_MAX_SCALE}`,
);
check(
  "keterangan panjang dipotong, bukan dibiarkan menembus gambar",
  qrisImageCaption({ amount: 47_000, chargeNumber: "DIG-2026-" + "9".repeat(80) }).length ===
    QRIS_IMAGE_CAPTION_MAX &&
    qrisImageLayout(qrisPayloadValue, { caption: "x".repeat(200) }).caption.length ===
      QRIS_IMAGE_CAPTION_MAX,
  "keterangan tidak dipotong",
);

/**
 * Membangun ulang gambar **persis seperti kanvas peramban** menggambarnya
 * (latar putih, modul hitam pada `marginPx + quietZonePx`, keterangan di bawah),
 * lalu memastikan pemindai QR sungguhan membacanya — itulah buktinya screenshot
 * dari galeri masih bisa dipakai membayar.
 */
function rasterizeShot(layout, source) {
  const data = new Uint8ClampedArray(layout.widthPx * layout.heightPx * 4);
  for (let index = 0; index < layout.widthPx * layout.heightPx; index += 1) {
    const offset = index * 4;
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    data[offset + 3] = 255;
  }
  const origin = layout.marginPx + layout.quietZonePx;
  for (let row = 0; row < source.size; row += 1) {
    for (let col = 0; col < source.size; col += 1) {
      if (!source.modules[row * source.size + col]) continue;
      for (let y = 0; y < layout.scale; y += 1) {
        for (let x = 0; x < layout.scale; x += 1) {
          const px = origin + col * layout.scale + x;
          const py = origin + row * layout.scale + y;
          const offset = (py * layout.widthPx + px) * 4;
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
          data[offset + 3] = 255;
        }
      }
    }
  }
  return data;
}

const shotMatrix = qrMatrix(qrisPayloadValue);
const shotScan = jsQR(
  rasterizeShot(shotLayout, shotMatrix),
  shotLayout.widthPx,
  shotLayout.heightPx,
);
check(
  "gambar QRIS yang digambar kanvas terbaca balik pemindai (screenshot sah)",
  shotScan?.data === qrisPayloadValue,
  `terbaca=${shotScan?.data ?? "null"}`,
);
check(
  "gambar QRIS tetap terbaca pada skala terkecil (ponsel berbagi gambar kecil)",
  (() => {
    const kecil = qrisImageLayout(qrisPayloadValue, { scale: QRIS_IMAGE_MIN_SCALE });
    const hasil = jsQR(
      rasterizeShot(kecil, shotMatrix),
      kecil.widthPx,
      kecil.heightPx,
    );
    return hasil?.data === qrisPayloadValue;
  })(),
  "gambar kecil tidak terbaca",
);

// ------------------------------------------------- pembatalan oleh tamu

{
  // Selama uangnya belum masuk, tamu boleh berubah pikiran — dan pembatalannya
  // tidak perlu menunggu kasir.
  const boleh = guestCancelCheck({ status: "pending", chargeStatus: "pending" });
  check("pesanan menunggu bayar boleh dibatalkan tamunya", boleh.ok === true, JSON.stringify(boleh));
}

{
  // Tagihan yang sudah kedaluwarsa tetap boleh dibereskan: pembatalannya cuma
  // merapikan niat pesanannya, bukan mengubah uang.
  const kedaluwarsa = guestCancelCheck({ status: "pending", chargeStatus: "expired" });
  check(
    "tagihan kedaluwarsa tetap boleh dibereskan tamunya",
    kedaluwarsa.ok === true,
    JSON.stringify(kedaluwarsa),
  );
}

{
  // Uang yang sudah masuk tidak dibalik oleh tombol di ponsel pembeli.
  const lunas = guestCancelCheck({
    status: "paid",
    chargeStatus: "paid",
    saleNumber: "A-00031",
  });
  check("pesanan lunas tidak bisa dibatalkan tamunya", lunas.ok === false, JSON.stringify(lunas));
  check(
    "penolakan pesanan lunas menyebut nomor penjualannya",
    (lunas.reason ?? "").includes("A-00031"),
    lunas.reason ?? "",
  );
  check(
    "penolakan pesanan lunas menyarankan bertanya ke pelayan",
    (lunas.reason ?? "").includes("tanyakan pelayan"),
    lunas.reason ?? "",
  );
}

{
  // Perlombaan yang nyata: tagihannya sudah lunas lewat `payments.act` sementara
  // baris pesanannya belum sempat berubah. Patokannya status tagihan juga.
  const tagihanLunas = guestCancelCheck({ status: "pending", chargeStatus: "paid" });
  check(
    "status tagihan lunas sudah cukup untuk menolak pembatalan",
    tagihanLunas.ok === false,
    JSON.stringify(tagihanLunas),
  );
  check(
    "tanpa nomor penjualan kalimatnya tetap utuh",
    (tagihanLunas.reason ?? "").includes("sudah dibayar") &&
      !(tagihanLunas.reason ?? "").includes("("),
    tagihanLunas.reason ?? "",
  );
}

{
  const sudahBatal = guestCancelCheck({ status: "cancelled", chargeStatus: "cancelled" });
  check("pesanan yang sudah dibatalkan tidak dibatalkan lagi", sudahBatal.ok === false, JSON.stringify(sudahBatal));
  check(
    "penolakan pembatalan ganda singkat",
    sudahBatal.reason === "Pesanan ini sudah dibatalkan.",
    sudahBatal.reason ?? "",
  );
}

if (results.length > 0 && results.every((result) => result.ok)) {
  console.log(`${results.length}/${results.length} checks passed`);
} else {
  for (const result of results) {
    console.log(`${result.ok ? "✓" : "✗"} ${result.name}`);
  }
  process.exitCode = 1;
}

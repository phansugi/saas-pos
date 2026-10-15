/**
 * Uji aturan pembayaran digital (`payment.digital`, Phase 6) tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/digitalPayment.ts` — modul murni yang dipakai
 * backend (`src/convex/payments.ts`), halaman Pembayaran, kedua store, dan
 * `convex/schema.ts`. Selain aturannya, harness ini menjaga tiga hal yang mudah
 * melenceng tanpa disadari:
 *
 *   - daftar izin di `schema.ts` (`permissionValidator`) harus memuat izin baru
 *     `payment.view`/`payment.manage` — izin yang lupa didaftarkan akan ditolak
 *     database dengan pesan yang membingungkan;
 *   - tabel `digitalCharges` harus menyimpan **tenggatnya sendiri**
 *     (`expiresAt`), bukan menghitungnya ulang dari kebijakan hari ini — itulah
 *     yang membuat perubahan kebijakan umur tidak mematikan tagihan lama;
 *   - hanya **pembuatan** tagihan yang digerbang fitur. Pelunasan & pembatalan
 *     harus tetap boleh, supaya penurunan paket tidak mengunci uang pelanggan.
 *
 * Usage: bun scripts/verify-payments.mjs
 */
import { readFileSync } from "node:fs";
import { FEATURE_LABELS, PLANS } from "../src/convex/lib/billing/catalog.ts";
import {
  applyChargeAction,
  chargeNumber,
  DIGITAL_METHOD_KEYS,
  DIGITAL_METHOD_LABELS,
  DIGITAL_MIN_AMOUNT,
  DIGITAL_MAX_AMOUNT,
  DIGITAL_REFERENCE_MAX,
  DIGITAL_REASON_MAX,
  DIGITAL_STATUS_LABELS,
  EXPIRING_SOON_SECONDS,
  expiryAtFor,
  expiryMinutesFor,
  isDigitalAmountValid,
  MINUTE_MS,
  cartChargeReference,
  chargeLikeFrom,
  checkCartMatchesCharge,
  checkSaleAgainstCharge,
  paymentInstruction,
  POS_CHARGE_METHOD,
  qrPayload,
  QRIS_EXPIRY_MINUTES,
  remainingSeconds,
  saleMethodMatchesCharge,
  statusOf,
  summariseCharges,
  validateCartCharge,
  validateChargeInput,
  VA_BANK_KEYS,
  VA_BANKS,
  VA_EXPIRY_MINUTES,
  virtualAccountNumber,
} from "../src/convex/lib/digitalPayment.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const NOW = 1_760_000_000_000;

/** Tagihan contoh; setiap uji hanya menimpa bagian yang sedang diperiksa. */
function charge(overrides = {}) {
  const base = {
    number: "DIG-2026-0001",
    method: "qris",
    amount: 47_000,
    status: "pending",
    createdAt: NOW,
    expiresAt: NOW + QRIS_EXPIRY_MINUTES * MINUTE_MS,
    paidAt: null,
    paidAmount: null,
    cancelledAt: null,
    cancelReason: null,
  };
  return { ...base, ...overrides };
}

function act(target, action, args = {}) {
  return applyChargeAction(target, action, { now: NOW, ...args });
}

// ---------------------------------------------------------------- metode & bank
check(
  "setiap metode pembayaran punya label yang terbaca",
  DIGITAL_METHOD_KEYS.every((key) => DIGITAL_METHOD_LABELS[key].trim().length > 3),
  JSON.stringify(DIGITAL_METHOD_LABELS),
);
check(
  "daftar metode tidak punya duplikat",
  new Set(DIGITAL_METHOD_KEYS).size === DIGITAL_METHOD_KEYS.length,
  DIGITAL_METHOD_KEYS.join(", "),
);
check(
  "setiap bank VA punya awalan yang unik",
  VA_BANK_KEYS.length > 0 &&
    new Set(VA_BANK_KEYS.map((bank) => VA_BANKS[bank].prefix)).size === VA_BANK_KEYS.length,
  JSON.stringify(VA_BANK_KEYS.map((bank) => VA_BANKS[bank].prefix)),
);

// ----------------------------------------------------------------------- umur
check(
  "QRIS berumur lebih pendek dari Virtual Account",
  expiryMinutesFor("qris") < expiryMinutesFor("va"),
  JSON.stringify([expiryMinutesFor("qris"), expiryMinutesFor("va")]),
);
check(
  "jam kedaluwarsa dihitung dari waktu dibuat",
  expiryAtFor("qris", NOW) === NOW + QRIS_EXPIRY_MINUTES * MINUTE_MS &&
    expiryAtFor("va", NOW) === NOW + VA_EXPIRY_MINUTES * MINUTE_MS,
  JSON.stringify([expiryAtFor("qris", NOW), expiryAtFor("va", NOW)]),
);
check(
  "setiap status punya label yang terbaca",
  Object.values(DIGITAL_STATUS_LABELS).every((label) => label.trim().length > 3),
  JSON.stringify(DIGITAL_STATUS_LABELS),
);

// ------------------------------------------------------------------- nominal
check(
  "nominal harus bilangan bulat di dalam batas",
  isDigitalAmountValid(DIGITAL_MIN_AMOUNT) &&
    isDigitalAmountValid(DIGITAL_MAX_AMOUNT) &&
    !isDigitalAmountValid(0) &&
    !isDigitalAmountValid(-1000) &&
    !isDigitalAmountValid(DIGITAL_MIN_AMOUNT + 0.5) &&
    !isDigitalAmountValid(DIGITAL_MAX_AMOUNT + 1) &&
    !isDigitalAmountValid(Number.NaN),
  JSON.stringify([DIGITAL_MIN_AMOUNT, DIGITAL_MAX_AMOUNT]),
);

// --------------------------------------------------------------------- nomor
check(
  "nomor tagihan berurut & berpadding",
  chargeNumber(7, 2026) === "DIG-2026-0007" &&
    chargeNumber(1234, 2026) === "DIG-2026-1234" &&
    chargeNumber(0, 2026) === "DIG-2026-0001",
  [chargeNumber(7, 2026), chargeNumber(1234, 2026), chargeNumber(0, 2026)].join(", "),
);
check(
  "nomor Virtual Account memakai awalan bank & 8 digit urut",
  virtualAccountNumber("bca", 2) === `${VA_BANKS.bca.prefix}00000002` &&
    virtualAccountNumber("mandiri", 2) === `${VA_BANKS.mandiri.prefix}00000002`,
  JSON.stringify([virtualAccountNumber("bca", 2), virtualAccountNumber("mandiri", 2)]),
);
check(
  "nomor Virtual Account berbeda untuk urutan berbeda",
  virtualAccountNumber("bca", 2) !== virtualAccountNumber("bca", 3),
  `${virtualAccountNumber("bca", 2)} vs ${virtualAccountNumber("bca", 3)}`,
);
{
  const payload = qrPayload({ number: "DIG-2026-0007", amount: 47_000 });
  check(
    "payload QRIS deterministik & memuat nominal + nomor tagihan",
    qrPayload({ number: "DIG-2026-0007", amount: 47_000 }) === payload &&
      payload.includes("47000") &&
      payload.includes("DIG-2026-0007"),
    payload,
  );
  check(
    "payload QRIS berbeda untuk tagihan berbeda",
    qrPayload({ number: "DIG-2026-0007", amount: 47_000 }) !==
      qrPayload({ number: "DIG-2026-0008", amount: 47_000 }) &&
      qrPayload({ number: "DIG-2026-0007", amount: 47_000 }) !==
        qrPayload({ number: "DIG-2026-0007", amount: 48_000 }),
    "DITERIMA — kode tagihan berbeda bertukar payload",
  );
}

// ---------------------------------------------------------------- validasi
{
  const ok = validateChargeInput(
    { amount: 47_000, method: "qris" },
    { digital: true },
  );
  check("tagihan QRIS valid diterima", ok.ok === true, JSON.stringify(ok));
  check(
    "QRIS tidak menyimpan bank penerbit",
    ok.ok && ok.value.bank === null,
    ok.ok ? JSON.stringify(ok.value) : ok.reason,
  );
}
{
  const ok = validateChargeInput(
    { amount: 1_250_000, method: "va", bank: "bca", reference: "  PO   2026-0007  " },
    { digital: true },
  );
  check("tagihan VA valid diterima", ok.ok === true, JSON.stringify(ok));
  check(
    "keterangan dirapikan (spasi pinggir & ganda dibuang)",
    ok.ok && ok.value.reference === "PO 2026-0007",
    ok.ok ? String(ok.value.reference) : ok.reason,
  );
}
check(
  "QRIS dengan bank penerbit ditolak (bukan diam-diam diabaikan)",
  validateChargeInput({ amount: 47_000, method: "qris", bank: "bca" }, { digital: true })
    .ok === false,
  "DITERIMA — bank diterima untuk QRIS",
);
check(
  "VA tanpa bank / bank tak dikenal ditolak",
  validateChargeInput({ amount: 47_000, method: "va" }, { digital: true }).ok === false &&
    validateChargeInput({ amount: 47_000, method: "va", bank: "entah" }, { digital: true })
      .ok === false,
  "DITERIMA — VA bisa dibuat tanpa bank yang sah",
);
check(
  "metode tak dikenal & nominal di luar batas ditolak",
  validateChargeInput({ amount: 47_000, method: "ewallet" }, { digital: true }).ok === false &&
    validateChargeInput({ amount: 0, method: "qris" }, { digital: true }).ok === false &&
    validateChargeInput({ amount: DIGITAL_MAX_AMOUNT + 1, method: "qris" }, { digital: true })
      .ok === false,
  "DITERIMA — nilai tak sah lolos",
);
check(
  "keterangan yang terlalu panjang ditolak",
  validateChargeInput(
    { amount: 47_000, method: "qris", reference: "x".repeat(DIGITAL_REFERENCE_MAX + 1) },
    { digital: true },
  ).ok === false,
  "DITERIMA — batas keterangan bocor",
);
{
  const rejected = validateChargeInput({ amount: 47_000, method: "qris" }, { digital: false });
  check(
    "membuat tagihan ditolak tanpa fitur, dengan pesan yang menyebut fiturnya",
    rejected.ok === false && rejected.reason.includes(FEATURE_LABELS["payment.digital"]),
    rejected.ok ? "DITERIMA" : rejected.reason,
  );
}

// ------------------------------------------------------------------- status
check(
  "tagihan yang belum lewat tenggat tetap menunggu",
  statusOf(charge(), NOW) === "pending",
  statusOf(charge(), NOW),
);
check(
  "kedaluwarsa diturunkan dari tenggat, bukan dari status tersimpan",
  statusOf(charge(), NOW + QRIS_EXPIRY_MINUTES * MINUTE_MS) === "expired",
  statusOf(charge(), NOW + QRIS_EXPIRY_MINUTES * MINUTE_MS),
);
check(
  "status tersimpan yang terminal tidak pernah diubah oleh umur",
  ["paid", "cancelled"].every(
    (status) => statusOf(charge({ status }), NOW + 999 * MINUTE_MS) === status,
  ),
  "DITERIMA — status terminal tertimpa umur",
);
check(
  "status tersimpan `paid`/`cancelled`/`expired` dihormati apa adanya",
  statusOf(charge({ status: "paid" }), NOW) === "paid" &&
    statusOf(charge({ status: "cancelled" }), NOW) === "cancelled" &&
    statusOf(charge({ status: "expired" }), NOW) === "expired",
  "DITERIMA — status tersimpan diabaikan",
);
check(
  "sisa waktu menjadi nol setelah tenggat lewat",
  remainingSeconds(charge(), NOW) === QRIS_EXPIRY_MINUTES * 60 &&
    remainingSeconds(charge(), NOW + 999 * MINUTE_MS) === 0,
  String(remainingSeconds(charge(), NOW)),
);

// ------------------------------------------------------------------ transisi
{
  const settled = act(charge(), "settle");
  check(
    "tagihan menunggu bisa dilunasi dengan nominal yang pas",
    settled.ok && settled.value.status === "paid" && settled.value.paidAmount === 47_000,
    JSON.stringify(settled),
  );
}
check(
  "pelunasan dengan nominal berbeda ditolak, dan menyebut angkanya",
  (() => {
    const rejected = act(charge(), "settle", { amount: 40_000 });
    return rejected.ok === false && rejected.reason.includes("47.000");
  })(),
  "DITERIMA — nominal berbeda lolos",
);
check(
  "pelunasan disertakan nominal yang sama tetap diterima",
  act(charge(), "settle", { amount: 47_000 }).ok === true,
  "DITERIMA — nominal yang sama malah ditolak",
);
check(
  "tagihan yang sudah kedaluwarsa tidak bisa dilunasi",
  applyChargeAction(charge(), "settle", {
    now: NOW + (QRIS_EXPIRY_MINUTES + 1) * MINUTE_MS,
    amount: 47_000,
  }).ok === false &&
    act({ ...charge(), expiresAt: NOW - MINUTE_MS }, "settle").ok === false,
  "DITERIMA — tagihan kedaluwarsa masih bisa dibayar",
);
check(
  "tagihan yang sudah lunas / dibatalkan tidak bisa dilunasi lagi",
  act(charge({ status: "paid" }), "settle").ok === false &&
    act(charge({ status: "cancelled" }), "settle").ok === false,
  "DITERIMA — pelunasan ganda",
);
{
  const cancelled = act(charge(), "cancel", { reason: "  pelanggan pindah ke tunai " });
  check(
    "tagihan menunggu bisa dibatalkan beserta alasannya",
    cancelled.ok &&
      cancelled.value.status === "cancelled" &&
      cancelled.value.cancelReason === "pelanggan pindah ke tunai",
    JSON.stringify(cancelled),
  );
}
check(
  "tagihan yang sudah lunas tidak bisa dibatalkan (uang yang masuk tidak dibalik)",
  act(charge({ status: "paid" }), "cancel").ok === false,
  "DITERIMA — tagihan lunas bisa dibatalkan",
);
check(
  "tagihan kedaluwarsa / sudah dibatalkan tidak perlu dibatalkan lagi",
  act({ ...charge(), expiresAt: NOW - MINUTE_MS }, "cancel").ok === false &&
    act(charge({ status: "cancelled" }), "cancel").ok === false,
  "DITERIMA — pembatalan ganda",
);
check(
  "alasan pembatalan yang terlalu panjang ditolak",
  act(charge(), "cancel", { reason: "x".repeat(DIGITAL_REASON_MAX + 1) }).ok === false,
  "DITERIMA — batas alasan bocor",
);

// ------------------------------------------------------------------ ringkasan
{
  const charges = [
    charge({ number: "DIG-2026-0001", amount: 47_000, createdAt: NOW - 4.5 * MINUTE_MS, expiresAt: NOW + 30_000 }),
    charge({ number: "DIG-2026-0002", method: "va", amount: 1_250_000, status: "paid", paidAmount: 1_250_000, expiresAt: NOW + MINUTE_MS }),
    charge({ number: "DIG-2026-0003", amount: 89_000, createdAt: NOW - 30 * MINUTE_MS, expiresAt: NOW - 25 * MINUTE_MS }),
    charge({ number: "DIG-2026-0004", amount: 10_000, status: "cancelled" }),
  ];
  const summary = summariseCharges(charges, NOW);
  check(
    "ringkasan menghitung tagihan per status efektif",
    summary.pending === 1 &&
      summary.paid === 1 &&
      summary.expired === 1 &&
      summary.cancelled === 1,
    JSON.stringify(summary),
  );
  check(
    "ringkasan memisahkan nominal menunggu dari nominal yang sudah masuk",
    summary.pendingAmount === 47_000 && summary.paidAmount === 1_250_000,
    JSON.stringify(summary),
  );
  check(
    "ringkasan menandai tagihan yang segera kedaluwarsa & tenggat terdekatnya",
    summary.expiringSoon === 1 && summary.nextExpiryAt === NOW + 30_000,
    JSON.stringify({ expiringSoon: summary.expiringSoon, next: summary.nextExpiryAt }),
  );
}
check(
  "ringkasan tanpa tagihan menunggu tidak punya tenggat",
  summariseCharges([charge({ status: "paid" })], NOW).nextExpiryAt === null,
  "DITERIMA — tenggat muncul dari tagihan selesai",
);
check(
  "ambang segera kedaluwarsa lebih pendek dari umur QRIS",
  EXPIRING_SOON_SECONDS < QRIS_EXPIRY_MINUTES * 60,
  String(EXPIRING_SOON_SECONDS),
);
check(
  "instruksi pelunasan menyebut kanal yang benar",
  paymentInstruction({ method: "qris", bank: null, amount: 47_000 }).toLowerCase().includes("qris") &&
    paymentInstruction({
      method: "va",
      bank: "bca",
      amount: 47_000,
      vaNumber: virtualAccountNumber("bca", 2),
    }).includes(virtualAccountNumber("bca", 2)),
  paymentInstruction({ method: "qris", bank: null, amount: 47_000 }),
);

// ---------------------------------------------------------- sinkronisasi kode
{
  const schema = readFileSync(new URL("../src/convex/schema.ts", import.meta.url), "utf8");
  check(
    "izin pembayaran terdaftar di validator schema",
    schema.includes('v.literal("payment.view")') &&
      schema.includes('v.literal("payment.manage")'),
    "izin baru tidak ada di permissionValidator",
  );
  check(
    "tabel tagihan menyimpan tenggat & statusnya sendiri",
    schema.includes("digitalCharges: defineTable") &&
      /digitalCharges: defineTable\(\{[\s\S]*?expiresAt: v\.number\(\)/.test(schema) &&
      /digitalCharges: defineTable\(\{[\s\S]*?status: digitalStatusValidator/.test(schema),
    "expiresAt/status tidak tersimpan di baris tagihan",
  );
  check(
    "validator status tagihan mengenal keempat keadaan",
    /digitalStatusValidator = v\.union\([\s\S]*?"pending"[\s\S]*?"paid"[\s\S]*?"expired"[\s\S]*?"cancelled"[\s\S]*?\)/.test(
      schema,
    ) &&
      schema.includes("vaBankValidator") &&
      schema.includes("digitalMethodValidator"),
    "validator status/metode/bank tidak lengkap",
  );
}
check(
  "fitur pembayaran digital ada di katalog & tidak termasuk paket Starter",
  typeof FEATURE_LABELS["payment.digital"] === "string" &&
    PLANS.professional.features.includes("payment.digital") &&
    PLANS.enterprise.features.includes("payment.digital") &&
    !PLANS.starter.features.includes("payment.digital"),
  JSON.stringify({
    label: FEATURE_LABELS["payment.digital"],
    professional: PLANS.professional.features.includes("payment.digital"),
  }),
);
{
  const source = readFileSync(new URL("../src/convex/payments.ts", import.meta.url), "utf8");
  const createStart = source.indexOf("export const create = mutation({");
  const actStart = source.indexOf("export const act = mutation({");
  check(
    "fungsi create & act ada di payments.ts",
    createStart > 0 && actStart > createStart,
    "tidak ditemukan",
  );
  const createBody = source.slice(createStart, actStart);
  const actBody = source.slice(actStart);
  check(
    "pembuatan tagihan digerbang fitur payment.digital",
    createBody.includes('"payment.digital"') && createBody.includes("requireFeature("),
    "gerbang fitur tidak ada di create",
  );
  check(
    "pelunasan & pembatalan TIDAK digerbang fitur (uang yang masuk tetap bisa dicatat)",
    !actBody.includes("requireFeature(") && !actBody.includes('"payment.digital"'),
    "act ikut terkunci fitur",
  );
  check(
    "daftar tagihan memakai izin payment.view",
    source.slice(0, createStart).includes('"payment.view"'),
    "izin daftar tidak sesuai",
  );
  check(
    "nomor tagihan, nomor VA, payload QRIS & tenggat ditetapkan server",
    createBody.includes("chargeNumber(") &&
      createBody.includes("virtualAccountNumber(") &&
      createBody.includes("qrPayload(") &&
      createBody.includes("expiryAtFor("),
    "ada nilai tagihan yang tidak ditetapkan server",
  );
}

// ------------------------------------------- tagih dari keranjang kasir (POS)
//
// Jalur kasir memakai aturan yang sama dengan tagihan biasa, plus dua pagar:
// nominalnya **total keranjang**, dan penjualannya hanya boleh menunjuk tagihan
// yang lunas dengan nominal yang sama.
check(
  "metode tagih dari keranjang adalah QRIS (yang dipindai di depan kasir)",
  POS_CHARGE_METHOD === "qris" && isDigitalAmountValid(DIGITAL_MIN_AMOUNT),
  POS_CHARGE_METHOD,
);

const CART = [
  { name: "Kopi Susu", quantity: 2 },
  { name: "Roti Bakar", quantity: 1 },
];

check(
  "keterangan tagihan kasir meringkas isi keranjang",
  cartChargeReference(CART) === "POS · 2 baris · 3 item · 2× Kopi Susu, 1× Roti Bakar",
  cartChargeReference(CART),
);
check(
  "keranjang kosong tetap punya keterangan yang jujur",
  cartChargeReference([]) === "POS · 0 baris · 0 item",
  cartChargeReference([]),
);
check(
  "keterangan tagihan tidak melebihi batas kolom walau nama produknya panjang",
  cartChargeReference([{ name: "x".repeat(200), quantity: 1 }]).length ===
    DIGITAL_REFERENCE_MAX,
  String(cartChargeReference([{ name: "x".repeat(200), quantity: 1 }]).length),
);

const cartDraft = validateCartCharge(
  { total: 47_000, lines: CART },
  { digital: true, planName: "Professional" },
);
check(
  "tagihan kasir bernominal total keranjang & metode QRIS",
  cartDraft.ok &&
    cartDraft.value.amount === 47_000 &&
    cartDraft.value.method === "qris" &&
    cartDraft.value.bank === null &&
    cartDraft.value.reference === cartChargeReference(CART),
  JSON.stringify(cartDraft),
);
{
  const small = validateCartCharge(
    { total: DIGITAL_MIN_AMOUNT - 1, lines: CART },
    { digital: true, planName: "Professional" },
  );
  check(
    "keranjang di bawah nominal minimum ditolak dengan batasnya",
    !small.ok && small.reason.includes("1.000") && small.reason.includes("50.000.000"),
    small.ok ? "diterima" : small.reason,
  );

  const locked = validateCartCharge(
    { total: 47_000, lines: CART },
    { digital: false, planName: "Starter" },
  );
  check(
    "paket tanpa fiturnya menolak dengan menyebut paketnya",
    !locked.ok && locked.reason.includes("Starter") && locked.reason.includes("naikkan paket"),
    locked.ok ? "diterima" : locked.reason,
  );
}

check(
  "pelunasan keranjang yang nilainya masih sama diterima",
  checkCartMatchesCharge(charge(), 47_000).ok,
  JSON.stringify(checkCartMatchesCharge(charge(), 47_000)),
);
{
  const changed = checkCartMatchesCharge(charge(), 52_000);
  check(
    "keranjang yang berubah setelah tagihan terbit ditolak & menyebut kedua angka",
    !changed.ok &&
      changed.reason.includes("52.000") &&
      changed.reason.includes("47.000") &&
      changed.reason.includes("DIG-2026-0001"),
    changed.ok ? "diterima" : changed.reason,
  );
}

check(
  "metode tagihan menentukan metode pembayaran penjualannya",
  saleMethodMatchesCharge("qris", "qris") &&
    !saleMethodMatchesCharge("cash", "qris") &&
    saleMethodMatchesCharge("transfer", "va") &&
    !saleMethodMatchesCharge("qris", "va"),
  JSON.stringify({
    qris: saleMethodMatchesCharge("qris", "qris"),
    cash: saleMethodMatchesCharge("cash", "qris"),
    transfer: saleMethodMatchesCharge("transfer", "va"),
  }),
);
check(
  "penjualan boleh menunjuk tagihan yang sudah lunas & senilai",
  checkSaleAgainstCharge(charge({ status: "paid", paidAt: NOW, paidAmount: 47_000 }), {
    saleTotal: 47_000,
    saleMethod: "qris",
    now: NOW,
  }).ok,
  "tagihan lunas ditolak",
);
{
  const unpaid = checkSaleAgainstCharge(charge(), {
    saleTotal: 47_000,
    saleMethod: "qris",
    now: NOW,
  });
  check(
    "tagihan yang belum lunas tidak boleh menanggung penjualan",
    !unpaid.ok &&
      unpaid.reason.includes(DIGITAL_STATUS_LABELS.pending) &&
      unpaid.reason.includes("sudah lunas"),
    unpaid.ok ? "diterima" : unpaid.reason,
  );

  const late = checkSaleAgainstCharge(charge(), {
    saleTotal: 47_000,
    saleMethod: "qris",
    now: NOW + QRIS_EXPIRY_MINUTES * MINUTE_MS + 1,
  });
  check(
    "tagihan yang sudah kedaluwarsa tidak bisa dipakai menutup penjualan",
    !late.ok && late.reason.includes("Kedaluwarsa"),
    late.ok ? "diterima" : late.reason,
  );

  const mismatch = checkSaleAgainstCharge(
    charge({ status: "paid", paidAt: NOW, paidAmount: 47_000 }),
    { saleTotal: 52_000, saleMethod: "qris", now: NOW },
  );
  check(
    "nominal penjualan harus sama dengan tagihannya",
    !mismatch.ok &&
      mismatch.reason.includes("52.000") &&
      mismatch.reason.includes("47.000"),
    mismatch.ok ? "diterima" : mismatch.reason,
  );

  const wrongMethod = checkSaleAgainstCharge(
    charge({ status: "paid", paidAt: NOW, paidAmount: 47_000 }),
    { saleTotal: 47_000, saleMethod: "cash", now: NOW },
  );
  check(
    "metode pembayaran penjualan harus cocok dengan metode tagihannya",
    !wrongMethod.ok && wrongMethod.reason.includes("cash"),
    wrongMethod.ok ? "diterima" : wrongMethod.reason,
  );
}
check(
  "tagihan Virtual Account ditutup penjualan transfer",
  checkSaleAgainstCharge(
    charge({
      method: "va",
      status: "paid",
      paidAt: NOW,
      paidAmount: 47_000,
      expiresAt: NOW + VA_EXPIRY_MINUTES * MINUTE_MS,
    }),
    { saleTotal: 47_000, saleMethod: "transfer", now: NOW },
  ).ok,
  "VA + transfer ditolak",
);
{
  // Baris tanpa medan opsional (tagihan baru dibuat) tetap bisa dibaca aturan.
  const shaped = chargeLikeFrom({
    number: "DIG-2026-0009",
    method: "qris",
    amount: 10_000,
    status: "pending",
    createdAt: NOW,
    expiresAt: NOW + 1,
  });
  check(
    "bentuk longgar baris tagihan mengisi medan opsional dengan null",
    shaped.paidAt === null &&
      shaped.paidAmount === null &&
      shaped.cancelledAt === null &&
      shaped.cancelReason === null &&
      shaped.number === "DIG-2026-0009" &&
      shaped.amount === 10_000,
    JSON.stringify(shaped),
  );
}

// ------------------------------------ sinkronisasi jalur kasir di kode nyata
{
  const schema = readFileSync(new URL("../src/convex/schema.ts", import.meta.url), "utf8");
  check(
    "penjualan menyimpan tagihan digital yang melunasinya",
    /sales: defineTable\(\{[\s\S]*?digitalChargeId: v\.optional\(v\.id\("digitalCharges"\)\)/.test(
      schema,
    ),
    "sales.digitalChargeId tidak ada",
  );
  check(
    "tagihan menunjuk balik ke penjualan yang dilunasinya",
    /digitalCharges: defineTable\(\{[\s\S]*?saleId: v\.optional\(v\.id\("sales"\)\)[\s\S]*?saleNumber: v\.optional\(v\.string\(\)\)/.test(
      schema,
    ),
    "digitalCharges.saleId/saleNumber tidak ada",
  );
}
{
  const source = readFileSync(new URL("../src/convex/pos.ts", import.meta.url), "utf8");
  check(
    "pos.createSale menerima & memakai digitalChargeId",
    source.includes("digitalChargeId: v.optional(v.id(\"digitalCharges\"))") &&
      source.includes("checkSaleAgainstCharge(chargeLikeFrom(") &&
      source.includes("digitalChargeId: args.digitalChargeId,") &&
      source.includes("saleId, saleNumber: number"),
    "sambungan tagihan tidak terpasang di pos.ts",
  );
}
{
  const page = readFileSync(new URL("../src/pages/PosPage.tsx", import.meta.url), "utf8");
  check(
    "kasir memakai aturan tagih bersama, bukan aturan sendiri",
    page.includes("validateCartCharge(") &&
      page.includes("checkCartMatchesCharge(") &&
      page.includes("createDigitalCharge(") &&
      page.includes("actDigitalCharge(") &&
      page.includes("digitalChargeId: cartCharge.id"),
    "halaman kasir tidak memakai aturan tagih bersama",
  );
}
{
  const demo = readFileSync(new URL("../src/lib/store/demo.tsx", import.meta.url), "utf8");
  check(
    "store demo menegakkan aturan yang sama dengan server",
    demo.includes("checkSaleAgainstCharge(chargeLikeFrom(") &&
      demo.includes("saleNumber: number"),
    "store demo tidak menegakkan sambungan tagihan",
  );
}

console.log(`${results.length}/${results.length} checks passed`);

/**
 * Uji aturan hutang usaha (AP) tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/payables.ts` — modul murni yang dipakai
 * server (hutang otomatis saat GRN, penolakan PO ke supplier menunggak,
 * pembayaran), halaman Pembelian (umur hutang & sisa), dan store demo (aksi yang
 * sama tanpa backend). Karena aturannya satu, hasilnya berlaku untuk ketiganya.
 *
 * Usage: bun scripts/verify-payables.mjs
 */
import {
  applyPayablePayment,
  buildPayableForReceipt,
  describePayableSource,
  isDueSoon,
  MAX_BILL_AMOUNT,
  MAX_PAYABLE_NOTE,
  payableAging,
  payableBalance,
  payablePosition,
  resolveBillInput,
  supplierBlockedReason,
  summarisePayables,
} from "../src/convex/lib/payables.ts";
import { AGING_BUCKETS } from "../src/convex/lib/ar.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0); // 2026-10-11 12:00Z

/** Tagihan terbuka dengan jumlah & jatuh tempo relatif terhadap `NOW`. */
const bill = (amount, dueInDays, paidAmount = 0, status = "open") => ({
  amount,
  paidAmount,
  dueDate: NOW + dueInDays * DAY,
  status,
});

// ------------------------------------------- hutang lahir dari penerimaan (GRN)
{
  const result = buildPayableForReceipt({
    supplier: { name: "PT Sumber Rejeki", paymentTermDays: 30 },
    total: 1_450_000,
    receivedAt: NOW,
  });
  check("penerimaan supplier bertempo menghasilkan hutang", result.ok && Boolean(result.value), result.reason);
  check(
    "jatuh tempo = tanggal terima + tempo supplier (30 hari)",
    result.value.dueDate === NOW + 30 * DAY,
    new Date(result.value.dueDate).toISOString(),
  );
  check(
    "tempo disimpan di hutangnya, bukan cuma di supplier",
    result.value.paymentTermDays === 30 && result.value.amount === 1_450_000,
    JSON.stringify(result.value),
  );

  const cash = buildPayableForReceipt({
    supplier: { name: "Supplier Tunai", paymentTermDays: 0 },
    total: 750_000,
    receivedAt: NOW,
  });
  check(
    "supplier tanpa tempo (bayar langsung) TIDAK menghasilkan hutang",
    cash.ok && cash.value === null,
    JSON.stringify(cash),
  );

  const free = buildPayableForReceipt({
    supplier: { name: "PT Sumber Rejeki", paymentTermDays: 30 },
    total: 0,
    receivedAt: NOW,
  });
  check("penerimaan bernilai 0 tidak menagih apa pun", free.ok && free.value === null, JSON.stringify(free));

  const absurd = buildPayableForReceipt({
    supplier: { name: "PT Tempo Aneh", paymentTermDays: 400 },
    total: 100_000,
    receivedAt: NOW,
  });
  check("tempo supplier di luar batas ditolak", !absurd.ok && absurd.reason.includes("tidak wajar"), absurd.reason);
}

// --------------------------------------------------------- umur & sisa hutang
{
  check("sisa hutang = jumlah - dibayar", payableBalance(bill(500_000, 10, 125_000)) === 375_000);
  check("hutang lunas bersisa 0", payableBalance(bill(500_000, 10, 500_000, "paid")) === 0);
  check(
    "hutang yang dibatalkan bersisa 0 walau belum dibayar",
    payableBalance(bill(500_000, 10, 0, "void")) === 0,
  );

  check(
    "belum jatuh tempo masuk keranjang `current`",
    payableAging(bill(100_000, 3), NOW).bucket === "current",
  );
  check(
    "lewat 5 hari masuk `1-30`",
    payableAging(bill(100_000, -5), NOW).bucket === "1-30",
  );
  check(
    "hari penuh dipakai, bukan pembulatan ke atas",
    payableAging(bill(100_000, -30), NOW).daysPastDue === 30 &&
      payableAging(bill(100_000, -30), NOW).bucket === "1-30",
    JSON.stringify(payableAging(bill(100_000, -30), NOW)),
  );
  check(
    "lewat 31 hari masuk `31-60`",
    payableAging(bill(100_000, -31), NOW).bucket === "31-60",
  );
  check("lewat 61 hari masuk `>60`", payableAging(bill(100_000, -61), NOW).bucket === ">60");
  check(
    "hutang lunas tidak pernah dianggap jatuh tempo",
    payableAging(bill(100_000, -10, 100_000, "paid"), NOW).overdue === false,
  );

  check("jatuh tempo 3 hari lagi = segera jatuh tempo", isDueSoon(bill(100_000, 3), NOW));
  check("jatuh tempo 30 hari lagi bukan segera", !isDueSoon(bill(100_000, 30), NOW));
  check("hutang lunas tidak pernah segera jatuh tempo", !isDueSoon(bill(100_000, -2, 100_000, "paid"), NOW));
}

// ------------------------------------------------------- posisi per supplier
{
  const position = payablePosition(
    [
      bill(1_000_000, -5),
      bill(400_000, 7),
      bill(300_000, 40, 100_000),
      bill(999_000, -3, 999_000, "paid"),
      bill(50_000, -2, 0, "void"),
    ],
    NOW,
  );
  check(
    "posisi menghitung total, lewat jatuh tempo, dan yang segera jatuh tempo",
    position.outstanding === 1_600_000 &&
      position.overdueAmount === 1_000_000 &&
      position.overdueCount === 1 &&
      position.dueSoonAmount === 400_000 &&
      position.openCount === 3,
    JSON.stringify(position),
  );

  const summary = summarisePayables([bill(1_000_000, -5), bill(400_000, -40), bill(250_000, 10)], NOW);
  check(
    "ringkasan mengisi semua keranjang umur",
    AGING_BUCKETS.length === 4 &&
      summary.byBucket["1-30"] === 1_000_000 &&
      summary.byBucket["31-60"] === 400_000 &&
      summary.byBucket.current === 250_000 &&
      summary.byBucket[">60"] === 0,
    JSON.stringify(summary.byBucket),
  );
  check(
    "ringkasan kosong tetap sah",
    summarisePayables([], NOW).outstanding === 0 &&
      summarisePayables([], NOW).openCount === 0 &&
      Object.values(summarisePayables([], NOW).byBucket).every((value) => value === 0),
  );
}

// ----------------------------------------------------- tagihan manual di luar PO
{
  const valid = resolveBillInput(
    { reference: " INV/2026/0912 ", amount: 1_250_000, dueDate: NOW + 14 * DAY, note: " jasa angkut " },
    { now: NOW, supplierName: "PT Sumber Rejeki" },
  );
  check("tagihan manual valid diterima", valid.ok, valid.reason);
  check(
    "nomor tagihan & catatan dirapikan",
    valid.value.reference === "INV/2026/0912" && valid.value.note === "jasa angkut",
    JSON.stringify(valid.value),
  );

  const past = resolveBillInput(
    { amount: 300_000, dueDate: NOW - 60 * DAY },
    { now: NOW, supplierName: "PT Sumber Rejeki" },
  );
  check(
    "tagihan lama boleh dicatat dengan jatuh tempo di masa lalu",
    past.ok && past.value.dueDate === NOW - 60 * DAY,
    past.reason,
  );

  for (const [label, input, expected] of [
    ["nilai nol", { amount: 0, dueDate: NOW }, "lebih dari 0"],
    ["nilai negatif", { amount: -5_000, dueDate: NOW }, "lebih dari 0"],
    ["nilai melebihi batas wajar", { amount: MAX_BILL_AMOUNT + 1, dueDate: NOW }, "batas wajar"],
    ["jatuh tempo tidak ada", { amount: 10_000, dueDate: 0 }, "tidak valid"],
    [
      "jatuh tempo terlalu jauh",
      { amount: 10_000, dueDate: NOW + 5 * 365 * DAY },
      "terlalu jauh",
    ],
    [
      "nomor tagihan terlalu panjang",
      { amount: 10_000, dueDate: NOW, reference: "X".repeat(41) },
      "maksimal",
    ],
    [
      "catatan terlalu panjang",
      { amount: 10_000, dueDate: NOW, note: "N".repeat(MAX_PAYABLE_NOTE + 1) },
      "maksimal",
    ],
  ]) {
    const result = resolveBillInput(input, { now: NOW, supplierName: "PT Sumber Rejeki" });
    check(
      `tagihan manual ditolak: ${label}`,
      !result.ok && result.reason.includes(expected),
      result.reason ?? "DITERIMA — validasi tagihan bocor",
    );
  }
}

// --------------------------------------------------------------- pembayaran
{
  const partial = applyPayablePayment(bill(1_000_000, 10), 250_000);
  check(
    "pembayaran sebagian diterima dan sisanya dihitung",
    partial.ok && partial.accepted === 250_000 && partial.remaining === 750_000 && !partial.fullyPaid,
    JSON.stringify(partial),
  );

  const full = applyPayablePayment(bill(1_000_000, 10, 400_000), 600_000);
  check(
    "pembayaran terakhir menandai lunas",
    full.ok && full.remaining === 0 && full.fullyPaid,
    JSON.stringify(full),
  );

  const over = applyPayablePayment(bill(1_000_000, 10), 1_000_001);
  check(
    "kelebihan bayar DITOLAK, bukan dipangkas diam-diam",
    !over.ok && over.remaining === 1_000_000 && over.reason.includes("melebihi sisa hutang"),
    over.reason,
  );

  const zero = applyPayablePayment(bill(1_000_000, 10), 0);
  check("pembayaran nol ditolak", !zero.ok && zero.reason.includes("lebih dari 0"), zero.reason);

  const paid = applyPayablePayment(bill(1_000_000, 10, 1_000_000, "paid"), 10_000);
  check("hutang lunas tidak bisa dibayar lagi", !paid.ok && paid.reason.includes("sudah lunas"), paid.reason);

  const voided = applyPayablePayment(bill(1_000_000, 10, 0, "void"), 10_000);
  check(
    "hutang yang dibatalkan tidak bisa dibayar",
    !voided.ok && voided.reason.includes("dibatalkan"),
    voided.reason,
  );
}

// ------------------------------------------------- supplier yang menunggak
{
  const supplier = { name: "PT Sumber Rejeki" };
  check(
    "supplier tanpa hutang lewat jatuh tempo boleh dipesan",
    supplierBlockedReason([bill(500_000, 10)], supplier, NOW) === null,
  );
  check(
    "supplier dengan hutang lewat jatuh tempo diblokir dengan alasannya",
    (() => {
      const reason = supplierBlockedReason([bill(1_450_000, -4)], supplier, NOW);
      return (
        typeof reason === "string" &&
        reason.includes("PT Sumber Rejeki") &&
        reason.includes("Rp 1.450.000") &&
        reason.includes("bayar dulu")
      );
    })(),
    supplierBlockedReason([bill(1_450_000, -4)], supplier, NOW),
  );
  check(
    "hutang yang sudah dibayar lunas tidak memblokir",
    supplierBlockedReason([bill(1_450_000, -40, 1_450_000, "paid")], supplier, NOW) === null,
  );
  check(
    "jatuh tempo hari ini belum menunggak",
    supplierBlockedReason([bill(200_000, 0)], supplier, NOW) === null,
  );
}

// -------------------------------------------------------------- label sumber
{
  check(
    "sumber hutang dari PO/GRN dibaca sebagai dokumennya",
    describePayableSource({ orderNumber: "PO-00001", receiptNumber: "GRN-00002" }) ===
      "PO PO-00001 · GRN-00002",
  );
  check(
    "tanpa PO, nomor tagihan supplier yang dipakai",
    describePayableSource({ reference: "INV/2026/1" }) === "INV/2026/1",
  );
  check(
    "tanpa keduanya disebut tagihan manual",
    describePayableSource({}) === "Tagihan manual",
  );
}

console.log(`${results.length}/${results.length} checks passed`);

/**
 * Uji aturan piutang B2B & credit limit (`ar.creditlimit`) tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/ar.ts` — modul murni yang dipakai server
 * (validasi limit saat menjual, pelunasan), kasir (pratinjau sisa limit), dan
 * halaman Piutang. Karena aturannya satu, hasilnya berlaku untuk ketiganya.
 *
 * Usage: bun scripts/verify-ar.mjs
 */
import {
  AGING_BUCKETS,
  agingOf,
  applyReceivablePayment,
  creditFromPayment,
  creditPosition,
  decideCredit,
  DEFAULT_TERM_DAYS,
  dueDateFrom,
  MAX_CREDIT_LIMIT,
  MAX_TERM_DAYS,
  receivableBalance,
  resolveCustomerInput,
  rupiah,
  suggestCustomerCode,
  summariseReceivables,
} from "../src/convex/lib/ar.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0); // 2026-10-11 12:00Z

/** Nota terbuka dengan jumlah & jatuh tempo relatif terhadap `NOW`. */
const note = (amount, dueInDays, paidAmount = 0, status = "open") => ({
  amount,
  paidAmount,
  dueDate: NOW + dueInDays * DAY,
  status,
});

// ------------------------------------------------------------ data pelanggan
{
  const result = resolveCustomerInput({
    name: "  Toko   Berkah   Jaya ",
    phone: "+62 812-3456-7890",
    creditLimit: 5_000_000,
    paymentTermDays: 30,
  });
  check("data pelanggan valid diterima", result.ok, result.reason);
  check(
    "nama & telepon dinormalkan",
    result.value.name === "Toko Berkah Jaya" && result.value.phone === "+6281234567890",
    JSON.stringify(result.value),
  );
  check(
    "kode pelanggan diusulkan dari nama",
    result.value.code === "TBJ",
    result.value.code,
  );
  check(
    "tempo default dipakai saat limit aktif",
    resolveCustomerInput({ name: "Toko A", creditLimit: 1000 }).value.paymentTermDays ===
      DEFAULT_TERM_DAYS,
    String(resolveCustomerInput({ name: "Toko B", creditLimit: 1000 }).value.paymentTermDays),
  );
}

const rejections = [
  ["nama terlalu pendek", { name: "A" }, "2–60 karakter"],
  ["nama terlalu panjang", { name: "Toko ".repeat(20) }, "2–60 karakter"],
  ["kode tidak valid", { name: "Toko A", code: "9X" }, "tidak valid"],
  ["telepon tidak valid", { name: "Toko A", phone: "abc" }, "telepon"],
  ["limit negatif", { name: "Toko A", creditLimit: -1 }, "tidak boleh negatif"],
  [
    "limit melebihi batas wajar",
    { name: "Toko A", creditLimit: MAX_CREDIT_LIMIT + 1 },
    "batas wajar",
  ],
  ["tempo negatif", { name: "Toko A", paymentTermDays: -3 }, `0–${MAX_TERM_DAYS} hari`],
  ["tempo terlalu panjang", { name: "Toko A", paymentTermDays: MAX_TERM_DAYS + 1 }, "hari"],
  [
    "limit kredit tanpa tempo",
    { name: "Toko A", creditLimit: 1000, paymentTermDays: 0 },
    "harus punya tempo",
  ],
];

for (const [label, input, expected] of rejections) {
  const result = resolveCustomerInput(input);
  check(
    `pelanggan ditolak: ${label}`,
    !result.ok && (result.reason ?? "").includes(expected),
    result.ok ? "DITERIMA — validasi bocor" : result.reason,
  );
}

check(
  "pelanggan tunai (limit 0, tempo 0) tetap boleh",
  resolveCustomerInput({ name: "Walk In", creditLimit: 0, paymentTermDays: 0 }).ok,
  "ditolak",
);
check(
  "usulan kode menghindari kode yang sudah dipakai",
  suggestCustomerCode("Toko Berkah Jaya", ["TBJ"]) === "TBJ-2",
  suggestCustomerCode("Toko Berkah Jaya", ["TBJ"]),
);
check(
  "nama tanpa huruf tetap mendapat kode cadangan",
  /^[A-Z][A-Z0-9-]{1,9}$/.test(suggestCustomerCode("123", [])),
  suggestCustomerCode("123", []),
);

// ----------------------------------------------------------------- umur piutang
{
  const current = agingOf(note(1_000_000, 5), NOW);
  const justLate = agingOf(note(1_000_000, -1), NOW);
  const thirty = agingOf(note(1_000_000, -30), NOW);
  const sixtyOne = agingOf(note(1_000_000, -61), NOW);

  check("jatuh tempo 5 hari lagi → belum jatuh tempo", current.bucket === "current" && !current.overdue, JSON.stringify(current));
  check("lewat 1 hari → bucket 1–30 & jatuh tempo", justLate.bucket === "1-30" && justLate.overdue, JSON.stringify(justLate));
  check("lewat 30 hari masih bucket 1–30", thirty.bucket === "1-30", JSON.stringify(thirty));
  check("lewat 61 hari → bucket > 60", sixtyOne.bucket === ">60", JSON.stringify(sixtyOne));
  check("hari lewat tempo dihitung", sixtyOne.daysPastDue === 61, String(sixtyOne.daysPastDue));
  check(
    "nota lunas bukan piutang jatuh tempo",
    !agingOf(note(1_000_000, -10, 1_000_000, "paid"), NOW).overdue,
    "lunas tapi dihitung jatuh tempo",
  );
  check(
    "umur memakai hari penuh: 30 hari 20 jam masih 1–30 hari",
    (() => {
      const late = agingOf(
        { amount: 1, paidAmount: 0, dueDate: NOW - (30 * DAY + 20 * 3600 * 1000), status: "open" },
        NOW,
      );
      return late.daysPastDue === 30 && late.bucket === "1-30";
    })(),
    JSON.stringify(agingOf({ amount: 1, paidAmount: 0, dueDate: NOW - (30 * DAY + 20 * 3600 * 1000), status: "open" }, NOW)),
  );
  check(
    "tepat 61 hari penuh masuk bucket > 60",
    agingOf(note(1_000_000, -61), NOW).bucket === ">60",
    JSON.stringify(agingOf(note(1_000_000, -61), NOW)),
  );
  check(
    "sisa piutang nota lunas 0",
    receivableBalance(note(1_000_000, -10, 1_000_000, "paid")) === 0,
    String(receivableBalance(note(1_000_000, -10, 1_000_000, "paid"))),
  );
}

check(
  "jatuh tempo dihitung dari tempo hari",
  dueDateFrom(NOW, 30) - NOW === 30 * DAY,
  String((dueDateFrom(NOW, 30) - NOW) / DAY),
);

// -------------------------------------------------- posisi kredit & keputusan
const customer = { name: "Toko Berkah", creditLimit: 5_000_000, active: true };

{
  const position = creditPosition(customer, [note(2_000_000, 10), note(1_000_000, -5)], NOW);
  check(
    "posisi kredit: outstanding 3 juta, 1 juta jatuh tempo",
    position.outstanding === 3_000_000 && position.overdueAmount === 1_000_000,
    JSON.stringify(position),
  );
  check(
    "sisa limit = limit − outstanding",
    position.availableCredit === 2_000_000,
    String(position.availableCredit),
  );
  check("posisi diblokir saat ada yang jatuh tempo", position.blocked, JSON.stringify(position));
}

check(
  "penjualan tunai (tanpa piutang baru) selalu boleh",
  decideCredit({ customer, receivables: [], newDebt: 0 }).ok,
  "transaksi tunai ditolak",
);
check(
  "tempo dengan limit kosong ditolak",
  (() => {
    const decision = decideCredit({
      customer: { name: "Walk In", creditLimit: 0 },
      receivables: [],
      newDebt: 1,
    });
    return !decision.ok && decision.reason.includes("belum punya limit kredit");
  })(),
  "limit 0 tapi tempo diterima",
);
check(
  "tempo melebihi sisa limit ditolak dengan angka sisa",
  (() => {
    const decision = decideCredit({
      customer,
      receivables: [note(4_500_000, 10)],
      newDebt: 600_000,
      now: NOW,
    });
    return (
      !decision.ok &&
      decision.reason.includes("Rp 500.000") &&
      decision.reason.includes("Rp 600.000")
    );
  })(),
  "kelebihan limit diterima",
);
check(
  "tempo tepat di sisa limit diterima",
  decideCredit({ customer, receivables: [note(4_500_000, 10)], newDebt: 500_000, now: NOW }).ok,
  "tempo tepat limit ditolak",
);
check(
  "piutang jatuh tempo memblokir tempo baru",
  (() => {
    const decision = decideCredit({
      customer,
      receivables: [note(100_000, -2)],
      newDebt: 50_000,
      now: NOW,
    });
    return !decision.ok && decision.reason.includes("jatuh tempo");
  })(),
  "pelanggan menunggak tetap dilayani tempo",
);
check(
  "pelanggan nonaktif tidak bisa tempo",
  (() => {
    const decision = decideCredit({
      customer: { ...customer, active: false },
      receivables: [],
      newDebt: 1,
    });
    return !decision.ok && decision.reason.includes("tidak aktif");
  })(),
  "pelanggan nonaktif diterima",
);
check(
  "proyeksi piutang dihitung untuk pratinjau kasir",
  decideCredit({ customer, receivables: [note(1_000_000, 10)], newDebt: 2_000_000, now: NOW })
    .projectedOutstanding === 3_000_000,
  "proyeksi salah",
);

// ----------------------------------------------------------------- pelunasan
{
  const open = note(1_000_000, 10);
  const partial = applyReceivablePayment(open, 400_000);
  check(
    "pelunasan sebagian diterima & sisa dihitung",
    partial.ok && partial.remaining === 600_000 && !partial.fullyPaid,
    JSON.stringify(partial),
  );
  const full = applyReceivablePayment(open, 1_000_000);
  check("pelunasan penuh menandai lunas", full.ok && full.fullyPaid && full.remaining === 0, JSON.stringify(full));

  for (const [label, amount, expected] of [
    ["nol", 0, "harus lebih dari 0"],
    ["negatif", -5000, "harus lebih dari 0"],
    ["melebihi sisa piutang", 1_500_000, "melebihi sisa piutang"],
  ]) {
    const result = applyReceivablePayment(open, amount);
    check(
      `pelunasan ditolak: ${label}`,
      !result.ok && (result.reason ?? "").includes(expected),
      result.reason ?? "DITERIMA",
    );
  }

  const afterPartial = applyReceivablePayment(
    { ...open, paidAmount: 600_000 },
    400_000,
  );
  check(
    "pelunasan sisa setelah cicilan diterima",
    afterPartial.ok && afterPartial.fullyPaid,
    JSON.stringify(afterPartial),
  );
  check(
    "nota yang sudah lunas tidak bisa dibayar lagi",
    (() => {
      const result = applyReceivablePayment(note(500_000, 10, 500_000, "paid"), 1);
      return !result.ok && result.reason.includes("sudah lunas");
    })(),
    "nota lunas masih menerima pembayaran",
  );
  check(
    "nota yang dibatalkan tidak bisa dibayar",
    (() => {
      const result = applyReceivablePayment({ ...note(500_000, 10), status: "void" }, 1);
      return !result.ok && result.reason.includes("dibatalkan");
    })(),
    "nota void masih menerima pembayaran",
  );
}

// ----------------------------------------------------------------- ringkasan
{
  const summary = summariseReceivables(
    [note(1_000_000, 10), note(2_000_000, -10), note(500_000, -70), note(999, -5, 999, "paid")],
    NOW,
  );
  check(
    "ringkasan menghitung nota terbuka saja",
    summary.openCount === 3 && summary.outstanding === 3_500_000,
    JSON.stringify(summary),
  );
  check(
    "ringkasan memisahkan yang jatuh tempo",
    summary.overdueAmount === 2_500_000 && summary.overdueCount === 2,
    JSON.stringify(summary),
  );
  check(
    "umur piutang terbagi ke semua bucket",
    summary.byBucket.current === 1_000_000 &&
      summary.byBucket["1-30"] === 2_000_000 &&
      summary.byBucket[">60"] === 500_000,
    JSON.stringify(summary.byBucket),
  );
  check(
    "total per bucket sama dengan outstanding",
    AGING_BUCKETS.reduce((sum, bucket) => sum + summary.byBucket[bucket], 0) ===
      summary.outstanding,
    JSON.stringify(summary.byBucket),
  );
  check(
    "pelanggan tanpa piutang punya ringkasan nol",
    summariseReceivables([], NOW).outstanding === 0,
    "ringkasan tidak nol",
  );
}

// --------------------------------------------- sisa tagihan menjadi piutang
check("bayar penuh tidak membuat piutang", creditFromPayment(71_040, 71_040) === 0, String(creditFromPayment(71_040, 71_040)));
check(
  "bayar sebagian → sisa menjadi piutang",
  creditFromPayment(71_040, 50_000) === 21_040,
  String(creditFromPayment(71_040, 50_000)),
);
check(
  "kelebihan bayar bukan piutang negatif",
  creditFromPayment(71_040, 100_000) === 0,
  String(creditFromPayment(71_040, 100_000)),
);

// ------------------------------------------------------------------ format IDR
check("rupiah memakai titik ribuan", rupiah(1_250_000) === "Rp 1.250.000", rupiah(1_250_000));
check("rupiah menangani nol", rupiah(0) === "Rp 0", rupiah(0));

console.log(`${results.length}/${results.length} checks passed`);

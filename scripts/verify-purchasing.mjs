/**
 * Uji aturan purchasing (PR · PO · GRN, fitur `purchasing.basic`) tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/purchasing.ts` — modul murni yang dipakai
 * server (saat mengajukan, menyetujui, memesan, dan menerima barang), kedua
 * store, halaman Pembelian, dan harness ini.
 *
 * Usage: bun scripts/verify-purchasing.mjs
 */
import {
  MAX_PURCHASE_LINES,
  canCancelOrder,
  canDecideRequisition,
  canOrderFromRequisition,
  canReceiveOrder,
  describeOrderProgress,
  describeSupplier,
  isValidPaymentTerm,
  lineRemaining,
  orderLineTotal,
  orderProgressPct,
  orderRemaining,
  orderStatusFromLines,
  orderTotal,
  planReceipt,
  resolveOrderInput,
  resolveRequisitionInput,
  resolveSupplierInput,
  suggestSupplierCode,
  suggestUnitCost,
  summarisePurchasing,
} from "../src/convex/lib/purchasing.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const PRODUCTS = [
  { id: "p1", name: "Kopi Susu Gula Aren", active: true },
  { id: "p2", name: "Es Teh Manis", active: true },
  { id: "p3", name: "Produk Lama", active: false },
];

// ------------------------------------------------------------------ supplier
{
  const result = resolveSupplierInput({
    name: "  PT   Sumber   Rejeki ",
    phone: "+62 21 5550123",
    address: "Kawasan Industri Pulogadung",
  });
  check("supplier valid diterima", result.ok, result.reason);
  check(
    "nama dinormalkan, kode diusulkan, tempo default 30 hari",
    result.value.name === "PT Sumber Rejeki" &&
      result.value.code === "PSR" &&
      result.value.paymentTermDays === 30 &&
      result.value.active === true,
    JSON.stringify(result.value),
  );
}

check(
  "usulan kode supplier menghindari kode yang sudah dipakai",
  suggestSupplierCode("PT Sumber Rejeki", ["PSR"]) === "PSR-2",
  suggestSupplierCode("PT Sumber Rejeki", ["PSR"]),
);

for (const [label, input, expected] of [
  ["nama terlalu pendek", { name: "A" }, "2–60 karakter"],
  ["kode tidak valid", { name: "PT Sumber", code: "P!" }, "tidak valid"],
  ["tempo negatif", { name: "PT Sumber", paymentTermDays: -1 }, "0–365 hari"],
  ["tempo terlalu panjang", { name: "PT Sumber", paymentTermDays: 400 }, "0–365 hari"],
]) {
  const result = resolveSupplierInput(input);
  check(
    `supplier ditolak: ${label}`,
    !result.ok && (result.reason ?? "").includes(expected),
    result.ok ? "DITERIMA — validasi bocor" : result.reason,
  );
}

check(
  "kode supplier duplikat ditolak",
  resolveSupplierInput({ name: "PT Sumber Rejeki", code: "psr" }, ["PSR"]).ok === false,
  "PSR vs psr",
);
check("label supplier untuk daftar", describeSupplier({ code: "PSR", name: "PT Sumber Rejeki" }) === "PSR · PT Sumber Rejeki");
check("tempo pembayaran valid 0 hari", isValidPaymentTerm(0) === true, "0");
check("tempo pembayaran 366 hari tidak valid", isValidPaymentTerm(366) === false, "366");

// ------------------------------------------------------------------ PR
{
  const result = resolveRequisitionInput(
    [
      { productId: "p1", quantity: 24, note: "  rak depan " },
      { productId: "p2", quantity: 48 },
    ],
    PRODUCTS,
  );
  check("PR valid diterima", result.ok, result.reason);
  check(
    "baris PR memakai nama produk & catatan dinormalkan",
    result.value.length === 2 &&
      result.value[0].name === "Kopi Susu Gula Aren" &&
      result.value[0].note === "rak depan" &&
      result.value[1].quantity === 48,
    JSON.stringify(result.value),
  );
}

for (const [label, lines, expected] of [
  ["tanpa baris", [], "minimal satu baris"],
  ["produk tidak dikenal", [{ productId: "p9", quantity: 1 }], "tidak valid"],
  ["produk nonaktif", [{ productId: "p3", quantity: 1 }], "nonaktif"],
  ["jumlah nol", [{ productId: "p1", quantity: 0 }], "lebih dari 0"],
  ["jumlah pecahan", [{ productId: "p1", quantity: 2.5 }], "lebih dari 0"],
  [
    "produk yang sama dua kali",
    [
      { productId: "p1", quantity: 1 },
      { productId: "p1", quantity: 2 },
    ],
    "dua kali",
  ],
  [
    "terlalu banyak baris",
    Array.from({ length: MAX_PURCHASE_LINES + 1 }, (_, index) => ({
      productId: `x${index}`,
      quantity: 1,
    })),
    `Maksimal ${MAX_PURCHASE_LINES} baris`,
  ],
]) {
  const result = resolveRequisitionInput(lines, PRODUCTS);
  check(
    `PR ditolak: ${label}`,
    !result.ok && (result.reason ?? "").includes(expected),
    result.ok ? "DITERIMA — validasi PR bocor" : result.reason,
  );
}

// ------------------------------------------------------------- keputusan PR
check("PR baru menunggu keputusan", canDecideRequisition("submitted") === true);
check("PR yang sudah diputuskan tidak bisa diputuskan lagi", canDecideRequisition("approved") === false);
check(
  "PO hanya dari PR yang disetujui",
  canOrderFromRequisition("approved", false).ok === true &&
    canOrderFromRequisition("submitted", false).ok === false,
  "submitted vs approved",
);
check(
  "PR yang sudah punya PO tidak bisa dipesan dua kali",
  (() => {
    const result = canOrderFromRequisition("approved", true);
    return !result.ok && (result.reason ?? "").includes("sudah punya PO");
  })(),
  "dua kali",
);
check(
  "alasan PR yang belum disetujui menyebut statusnya",
  (canOrderFromRequisition("rejected", false).reason ?? "").includes("Ditolak"),
  canOrderFromRequisition("rejected", false).reason,
);

// ------------------------------------------------------------------ PO
{
  const result = resolveOrderInput(
    [
      { productId: "p1", quantity: 24, unitCost: 13_200.4 },
      { productId: "p2", quantity: 48, unitCost: 0 },
    ],
    PRODUCTS,
  );
  check("PO valid diterima", result.ok, result.reason);
  check(
    "harga beli dibulatkan & sisa terima mulai dari nol",
    result.value[0].unitCost === 13_200 && result.value[0].receivedQty === 0,
    JSON.stringify(result.value),
  );
  check("nilai satu baris PO", orderLineTotal(result.value[0]) === 316_800, String(orderLineTotal(result.value[0])));
  check("nilai seluruh PO", orderTotal(result.value) === 316_800, String(orderTotal(result.value)));
}

for (const [label, lines, expected] of [
  ["tanpa baris", [], "minimal satu baris"],
  ["jumlah nol", [{ productId: "p1", quantity: 0, unitCost: 1 }], "lebih dari 0"],
  ["harga negatif", [{ productId: "p1", quantity: 1, unitCost: -1 }], "tidak boleh negatif"],
  ["produk tidak valid", [{ productId: "zz", quantity: 1, unitCost: 1 }], "tidak valid"],
]) {
  const result = resolveOrderInput(lines, PRODUCTS);
  check(
    `PO ditolak: ${label}`,
    !result.ok && (result.reason ?? "").includes(expected),
    result.ok ? "DITERIMA — validasi PO bocor" : result.reason,
  );
}

// ------------------------------------------------------------- progres PO
{
  const lines = [
    { quantity: 24, unitCost: 13_200, receivedQty: 10 },
    { quantity: 48, unitCost: 4_000, receivedQty: 48 },
  ];
  check("sisa per baris dihitung", lineRemaining(lines[0]) === 14, String(lineRemaining(lines[0])));
  check("sisa PO = jumlah sisa baris", orderRemaining(lines) === 14, String(orderRemaining(lines)));
  check("progres PO dalam persen", orderProgressPct(lines) === 81, String(orderProgressPct(lines)));
  check(
    "label progres PO",
    describeOrderProgress(lines) === "58/72 unit",
    describeOrderProgress(lines),
  );
  check(
    "status PO diturunkan dari barisnya",
    orderStatusFromLines("open", lines) === "partial" &&
      orderStatusFromLines("partial", [
        { quantity: 1, receivedQty: 1 },
      ]) === "received" &&
      orderStatusFromLines("open", [{ quantity: 5, receivedQty: 0 }]) === "open",
    "open/partial/received",
  );
  check(
    "status cancelled tidak dihitung ulang",
    orderStatusFromLines("cancelled", [{ quantity: 5, receivedQty: 0 }]) === "cancelled",
    "cancelled",
  );
  check(
    "PO selesai/dibatalkan tidak menerima barang lagi",
    canReceiveOrder("received").ok === false && canReceiveOrder("cancelled").ok === false,
    "received/cancelled",
  );
}

// ------------------------------------------------------------ pembatalan PO
{
  const kosong = [{ quantity: 10, receivedQty: 0 }];
  const sebagian = [{ quantity: 10, receivedQty: 4 }];
  check("PO kosong boleh dibatalkan", canCancelOrder(kosong, "open").ok === true, "open");
  check(
    "PO yang sudah menerima barang tidak boleh dibatalkan",
    (canCancelOrder(sebagian, "partial").reason ?? "").includes("Sudah ada barang diterima"),
    canCancelOrder(sebagian, "partial").reason,
  );
  check(
    "PO selesai tidak boleh dibatalkan",
    canCancelOrder(kosong, "received").ok === false,
    "received",
  );
}

// ---------------------------------------------------------------- GRN
function orderLines() {
  return [
    { productId: "p1", name: "Kopi Susu Gula Aren", quantity: 24, unitCost: 13_200, receivedQty: 0 },
    { productId: "p2", name: "Es Teh Manis", quantity: 48, unitCost: 4_000, receivedQty: 0 },
  ];
}

{
  const plan = planReceipt({
    status: "open",
    lines: orderLines(),
    requests: [
      { productId: "p1", quantity: 24 },
      { productId: "p2", quantity: 10 },
    ],
  });
  check("rencana penerimaan valid", plan.ok, plan.reason);
  check(
    "nilai penerimaan = jumlah (jumlah × harga beli)",
    plan.value.total === 24 * 13_200 + 10 * 4_000,
    String(plan.value.total),
  );
  check(
    "PO jadi `partial` dengan sisa 38 unit",
    plan.value.status === "partial" && plan.value.remaining === 38,
    JSON.stringify({ status: plan.value.status, sisa: plan.value.remaining }),
  );
}

{
  const plan = planReceipt({
    status: "open",
    lines: orderLines(),
    requests: [
      { productId: "p1", quantity: 24 },
      { productId: "p2", quantity: 48 },
    ],
  });
  check(
    "penerimaan penuh menutup PO",
    plan.value.status === "received" && plan.value.remaining === 0,
    JSON.stringify({ status: plan.value.status, sisa: plan.value.remaining }),
  );
}

{
  const partial = orderLines().map((line) => ({ ...line, receivedQty: 5 }));
  const plan = planReceipt({
    status: "partial",
    lines: partial,
    requests: [{ productId: "p2", quantity: 10 }],
  });
  check(
    "penerimaan kedua menghitung dari sisa, bukan dari jumlah awal",
    plan.value.remaining === (24 - 5) + (48 - 15),
    String(plan.value.remaining),
  );
}

for (const [label, args, expected] of [
  [
    "tanpa baris",
    { status: "open", lines: orderLines(), requests: [] },
    "Pilih dulu barang",
  ],
  [
    "melebihi sisa PO",
    { status: "open", lines: orderLines(), requests: [{ productId: "p1", quantity: 25 }] },
    "hanya tersisa 24",
  ],
  [
    "baris yang bukan bagian PO",
    { status: "open", lines: orderLines(), requests: [{ productId: "p9", quantity: 1 }] },
    "bukan bagian dari PO",
  ],
  [
    "jumlah nol",
    { status: "open", lines: orderLines(), requests: [{ productId: "p1", quantity: 0 }] },
    "lebih dari 0",
  ],
  [
    "baris yang sama dua kali",
    {
      status: "open",
      lines: orderLines(),
      requests: [
        { productId: "p1", quantity: 1 },
        { productId: "p1", quantity: 1 },
      ],
    },
    "dua kali",
  ],
  [
    "PO yang sudah selesai",
    { status: "received", lines: orderLines(), requests: [{ productId: "p1", quantity: 1 }] },
    "sudah diterima lengkap",
  ],
  [
    "PO yang dibatalkan",
    { status: "cancelled", lines: orderLines(), requests: [{ productId: "p1", quantity: 1 }] },
    "sudah dibatalkan",
  ],
]) {
  const plan = planReceipt(args);
  check(
    `penerimaan ditolak: ${label}`,
    !plan.ok && (plan.reason ?? "").includes(expected),
    plan.ok ? "DITERIMA — aturan penerimaan bocor" : plan.reason,
  );
}

// ------------------------------------------------------------- ringkasan
{
  const summary = summarisePurchasing({
    requisitions: [{ status: "submitted" }, { status: "approved" }],
    orders: [
      {
        status: "partial",
        lines: [
          { quantity: 24, unitCost: 13_200, receivedQty: 24 },
          { quantity: 48, unitCost: 4_000, receivedQty: 0 },
        ],
      },
      { status: "received", lines: [{ quantity: 5, unitCost: 1_000, receivedQty: 5 }] },
    ],
    receipts: [{ total: 500_000, createdAt: Date.now() }],
  });
  check(
    "ringkasan menghitung PR menunggu & PO terbuka",
    summary.pendingRequisitions === 1 && summary.openOrders === 1,
    JSON.stringify(summary),
  );
  check(
    "nilai PO terbuka hanya menghitung baris yang belum datang",
    summary.openOrderValue === 48 * 4_000 && summary.openOrderUnits === 48,
    JSON.stringify(summary),
  );
  check(
    "penerimaan bulan ini dijumlahkan",
    summary.receivedThisMonth === 500_000,
    String(summary.receivedThisMonth),
  );
  check("PO yang sudah selesai tidak dihitung terbuka", summary.awaitingReceipt === 1, String(summary.awaitingReceipt));
}

check(
  "saran harga beli memakai harga terakhir kalau ada",
  suggestUnitCost(13_200, 9_000) === 13_200 && suggestUnitCost(0, 9_000) === 9_000,
  `${suggestUnitCost(13_200, 9_000)} / ${suggestUnitCost(0, 9_000)}`,
);

console.log(`${results.length}/${results.length} checks passed`);

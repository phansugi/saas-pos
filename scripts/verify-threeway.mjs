/**
 * Uji aturan pencocokan 3 arah & pembayaran batch (`purchasing.threeway`).
 *
 * Yang diuji adalah `src/convex/lib/threeway.ts` — modul murni yang dipakai
 * server (`payables.list`/`recordInvoice`/`resolveMatch`/`payBatch`), kedua store
 * (demo & Convex), halaman Pembelian, dan harness ini. Karena aturannya satu,
 * angka selisih yang dilihat pemilik adalah angka yang ditegakkan server.
 *
 * Empat aturan yang paling mudah salah dan karena itu diuji ketat:
 *
 * 1. **Total tagihan dihitung dari barisnya**, bukan diterima dari input — jadi
 *    baris dan total tidak pernah bertentangan.
 * 2. **Pencocokan tidak pernah disimpan**, selalu dihitung ulang dari PO + GRN +
 *    dokumen supplier.
 * 3. **Menerima selisih mengubah nilai hutang; menyengketakan menahan bayar** —
 *    baik bayar satuan maupun bayar sekaligus.
 * 4. **Satu kali bayar, satu nomor (`PAY-…`)**, tetap satu baris pembayaran per
 *    tagihan supaya jejak auditnya sama seperti bayar satuan.
 *
 * Usage: bun scripts/verify-threeway.mjs
 */
import {
  amountAfterDecision,
  batchPaymentNumber,
  BATCH_NUMBER_PREFIX,
  buildInvoiceDraft,
  canPayPayable,
  canRecordInvoice,
  describeMatch,
  matchPayable,
  MATCH_DECISION_LABELS,
  MATCH_STATUS_LABELS,
  MATCH_TOLERANCE,
  MAX_BATCH_BILLS,
  MAX_INVOICE_LINES,
  planBatchPayment,
  resolveInvoiceInput,
  resolveMatchDecision,
  summariseThreeway,
} from "../src/convex/lib/threeway.ts";
import { MAX_BILL_REFERENCE, MAX_PAYABLE_NOTE } from "../src/convex/lib/payables.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// Baris PO: yang dipesan + berapa yang sudah datang.
const orderLine = (productId, name, quantity, unitCost, receivedQty) => ({
  productId,
  name,
  quantity,
  unitCost,
  receivedQty,
});

// Baris GRN: yang benar-benar datang.
const receiptLine = (productId, name, quantity, unitCost) => ({
  productId,
  name,
  quantity,
  unitCost,
});

// Baris dokumen supplier: yang ditagih.
const billLine = (productId, name, quantity, unitCost) => ({
  productId,
  name,
  quantity,
  unitCost,
});

const invoice = (lines, extra = {}) => ({
  reference: "INV/2026/0912",
  total: lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
  lines,
  recordedAt: Date.UTC(2026, 9, 11, 9, 0, 0),
  ...extra,
});

// ------------------------------------------------------------------ label & batas
check(
  "label status 3 arah lengkap",
  MATCH_STATUS_LABELS.no_reference === "Tanpa PO/GRN" &&
    MATCH_STATUS_LABELS.waiting_invoice.includes("belum dicatat") &&
    MATCH_STATUS_LABELS.matched === "Cocok" &&
    MATCH_STATUS_LABELS.variance === "Ada selisih",
  JSON.stringify(MATCH_STATUS_LABELS),
);
check(
  "label keputusan selisih",
  MATCH_DECISION_LABELS.accepted === "Selisih diterima" &&
    MATCH_DECISION_LABELS.disputed === "Disengketakan",
);
check("toleransi selisih 1 rupiah", MATCH_TOLERANCE === 1, String(MATCH_TOLERANCE));
check(
  "batas baris dokumen supplier & jumlah tagihan sekali bayar masuk akal",
  MAX_INVOICE_LINES === 50 && MAX_BATCH_BILLS === 30,
  `${MAX_INVOICE_LINES}/${MAX_BATCH_BILLS}`,
);
check("nomor batch memakai awalan PAY", BATCH_NUMBER_PREFIX === "PAY", BATCH_NUMBER_PREFIX);

// ------------------------------------------------------- status tanpa dokumen
{
  const order = [orderLine("p1", "Kopi Susu", 10, 5_000, 10)];
  const receipt = [receiptLine("p1", "Kopi Susu", 10, 5_000)];

  const belum = matchPayable({ orderLines: order, receiptLines: receipt });
  check(
    "dokumen supplier belum dicatat → `waiting_invoice`, belum ditandai",
    belum.status === "waiting_invoice" && belum.flagged === false,
    JSON.stringify(belum),
  );
  check(
    "nilai yang sudah dipesan & diterima tetap dihitung walau belum ada tagihan",
    belum.orderedValue === 50_000 && belum.receivedValue === 50_000,
    JSON.stringify([belum.orderedValue, belum.receivedValue]),
  );
  check(
    "`billedValue` kosong (bukan 0) selagi belum ada tagihan",
    belum.billedValue === undefined && belum.valueVariance === undefined,
    JSON.stringify(belum),
  );

  const none = matchPayable({});
  check(
    "tagihan tanpa PO/GRN → `no_reference`, bukan `waiting_invoice`",
    none.status === "no_reference" && none.reasons[0].includes("tidak berasal dari PO/GRN"),
    JSON.stringify(none),
  );
}

// --------------------------------------------------------------------- cocok
{
  const order = [
    orderLine("p1", "Kopi Susu", 10, 5_000, 10),
    orderLine("p2", "Roti Bakar", 5, 8_000, 5),
  ];
  const receipt = [
    receiptLine("p1", "Kopi Susu", 10, 5_000),
    receiptLine("p2", "Roti Bakar", 5, 8_000),
  ];
  const match = matchPayable({
    orderLines: order,
    receiptLines: receipt,
    invoice: invoice([
      billLine("p1", "Kopi Susu", 10, 5_000),
      billLine("p2", "Roti Bakar", 5, 8_000),
    ]),
  });

  check(
    "tagihan yang sama dengan PO & penerimaan berstatus `matched`",
    match.status === "matched" && match.flagged === false,
    JSON.stringify(match),
  );
  check(
    "selisih 0 dan alasan berbunyi cocok",
    match.valueVariance === 0 &&
      match.qtyVarianceUnits === 0 &&
      match.priceVarianceValue === 0 &&
      match.reasons.length === 1 &&
      match.reasons[0].includes("Cocok dengan PO dan penerimaan"),
    JSON.stringify(match.reasons),
  );
  check(
    "satu baris perbandingan per produk, lengkap pesan/datang/ditagih",
    match.lines.length === 2 &&
      match.lines[0].orderedQty === 10 &&
      match.lines[0].receivedQty === 10 &&
      match.lines[0].billedQty === 10 &&
      match.lines[0].billedUnitCost === 5_000,
    JSON.stringify(match.lines),
  );
}

// --------------------------------------------------------- selisih kuantitas
{
  const order = [orderLine("p1", "Es Teh Manis", 100, 4_000, 100)];
  const receipt = [receiptLine("p1", "Es Teh Manis", 10, 5_000)];
  const match = matchPayable({
    orderLines: order,
    receiptLines: receipt,
    invoice: invoice([billLine("p1", "Es Teh Manis", 12, 5_000)]),
  });

  check(
    "ditagih 12 padahal diterima 10 → `variance` dengan selisih 2 unit",
    match.status === "variance" &&
      match.flagged &&
      match.lines[0].qtyVariance === 2 &&
      match.qtyVarianceUnits === 2,
    JSON.stringify(match.lines[0]),
  );
  check(
    "nilai selisih = 2 × harga terima (10.000)",
    match.valueVariance === 10_000 && match.priceVarianceValue === 0,
    JSON.stringify({ variance: match.valueVariance, harga: match.priceVarianceValue }),
  );
  check(
    "alasan menyebut angka ditagih & diterima, bukan cuma \"ada selisih\"",
    match.reasons.some((reason) => reason.includes("ditagih 12 unit") && reason.includes("diterima 10 unit")),
    JSON.stringify(match.reasons),
  );
}

// --------------------------------------------------------------- selisih harga
{
  const order = [orderLine("p1", "Kopi Susu", 10, 5_000, 10)];
  const receipt = [receiptLine("p1", "Kopi Susu", 10, 5_000)];
  const match = matchPayable({
    orderLines: order,
    receiptLines: receipt,
    invoice: invoice([billLine("p1", "Kopi Susu", 10, 5_200)]),
  });

  check(
    "harga tagihan lebih mahal 200/unit ditandai walau jumlahnya sama",
    match.flagged &&
      match.lines[0].qtyVariance === 0 &&
      match.lines[0].priceVariance === 200 &&
      match.qtyVarianceUnits === 0,
    JSON.stringify(match.lines[0]),
  );
  check(
    "selisih harga dipisah dari selisih kuantitas (2.000 dari harga saja)",
    match.valueVariance === 2_000 && match.priceVarianceValue === 2_000,
    JSON.stringify({ nilai: match.valueVariance, harga: match.priceVarianceValue }),
  );
  check(
    "alasan selisih harga menyebut kedua harga & per unit",
    match.reasons.some(
      (reason) => reason.includes("harga tagihan") && reason.includes("/unit"),
    ),
    JSON.stringify(match.reasons),
  );

  const satuRupiah = matchPayable({
    orderLines: order,
    receiptLines: receipt,
    invoice: invoice([billLine("p1", "Kopi Susu", 10, 5_001)]),
  });
  check(
    "selisih harga 1 rupiah tetap ditandai, tidak dianggap pembulatan",
    satuRupiah.flagged && satuRupiah.valueVariance === 10,
    JSON.stringify({ flagged: satuRupiah.flagged, variance: satuRupiah.valueVariance }),
  );
}

// ------------------------------------- selisih yang hanya terlihat di totalnya
{
  const order = [
    orderLine("p1", "Kopi Susu", 10, 5_000, 10),
    orderLine("p2", "Roti Bakar", 5, 8_000, 5),
  ];
  const receipt = [
    receiptLine("p1", "Kopi Susu", 10, 5_000),
    receiptLine("p2", "Roti Bakar", 5, 8_000),
  ];
  const match = matchPayable({
    orderLines: order,
    receiptLines: receipt,
    // Baris Roti Bakar tidak ditagih sama sekali: jumlah & harganya tidak
    // berselisih, tetapi nilainya kurang — ini yang ketahuan dari total.
    invoice: invoice([billLine("p1", "Kopi Susu", 10, 5_000)]),
  });

  check(
    "baris yang diterima tetapi tidak ditagih tetap dianggap berselisih",
    match.flagged && match.valueVariance === -40_000,
    JSON.stringify({ flagged: match.flagged, variance: match.valueVariance }),
  );
  check(
    "selisih yang hanya terlihat di total dijelaskan lewat nilai barang diterima",
    match.reasons.some(
      (reason) => reason.includes("Nilai tagihan") && reason.includes("90.000"),
    ),
    JSON.stringify(match.reasons),
  );

  const lebih = matchPayable({
    orderLines: order,
    receiptLines: receipt,
    invoice: invoice([
      billLine("p1", "Kopi Susu", 10, 5_000),
      billLine("p2", "Roti Bakar", 5, 8_000),
      billLine("p9", "Barang Tak Dipesan", 1, 1_000),
    ]),
  });
  check(
    "barang yang ditagih tanpa penerimaan tercatat sebagai selisih kuantitas",
    lebih.flagged && lebih.qtyVarianceUnits === 1 && lebih.valueVariance === 1_000,
    JSON.stringify({ unit: lebih.qtyVarianceUnits, nilai: lebih.valueVariance }),
  );
  check(
    "baris tanpa PO memakai nama dari dokumen supplier",
    lebih.lines.find((line) => line.productId === "p9")?.name === "Barang Tak Dipesan",
    JSON.stringify(lebih.lines.map((line) => line.name)),
  );
}

// -------------------------------------------------- dokumen supplier (input)
{
  const options = {
    orderLines: [orderLine("p1", "Kopi Susu", 10, 5_000, 10)],
    receiptLines: [receiptLine("p1", "Kopi Susu", 10, 5_000)],
  };

  const valid = resolveInvoiceInput(
    {
      reference: "  INV/2026/0912  ",
      note: "  dikirim   lewat ekspedisi  ",
      lines: [{ productId: "p1", quantity: 10, unitCost: 5_000 }],
    },
    options,
  );
  check("dokumen supplier valid diterima", valid.ok, valid.reason);
  check(
    "nomor & catatan dirapikan, total dihitung dari barisnya",
    valid.value.reference === "INV/2026/0912" &&
      valid.value.note === "dikirim lewat ekspedisi" &&
      valid.value.total === 50_000,
    JSON.stringify(valid.value),
  );
  check(
    "baris dokumen menyimpan nama dari penerimaan",
    valid.value.lines[0].name === "Kopi Susu",
    JSON.stringify(valid.value.lines),
  );

  const gratis = resolveInvoiceInput(
    { lines: [{ productId: "p1", quantity: 2, unitCost: 0 }] },
    options,
  );
  check(
    "harga satuan 0 (bonus/nota koreksi) diterima",
    gratis.ok && gratis.value.total === 0,
    gratis.reason ?? JSON.stringify(gratis.value),
  );

  const tanpaNomor = resolveInvoiceInput(
    { reference: "   ", lines: [{ productId: "p1", quantity: 1, unitCost: 1 }] },
    options,
  );
  check(
    "nomor tagihan kosong disimpan sebagai kosong, bukan spasi",
    tanpaNomor.ok && tanpaNomor.value.reference === undefined,
    JSON.stringify(tanpaNomor.value),
  );

  for (const [label, input, expected] of [
    ["tanpa baris", { lines: [] }, "Isi dulu baris barang"],
    [
      "barang di luar PO/penerimaan",
      { lines: [{ productId: "p9", quantity: 1, unitCost: 1_000 }] },
      "bukan bagian dari PO/penerimaan",
    ],
    [
      "barang muncul dua kali",
      {
        lines: [
          { productId: "p1", quantity: 1, unitCost: 1_000 },
          { productId: "p1", quantity: 1, unitCost: 1_000 },
        ],
      },
      "muncul dua kali",
    ],
    [
      "jumlah nol",
      { lines: [{ productId: "p1", quantity: 0, unitCost: 1_000 }] },
      "lebih dari 0",
    ],
    [
      "jumlah pecahan",
      { lines: [{ productId: "p1", quantity: 1.5, unitCost: 1_000 }] },
      "bilangan bulat",
    ],
    [
      "harga satuan negatif",
      { lines: [{ productId: "p1", quantity: 1, unitCost: -100 }] },
      "0 atau lebih",
    ],
    [
      "harga satuan pecahan",
      { lines: [{ productId: "p1", quantity: 1, unitCost: 1_000.5 }] },
      "bilangan bulat",
    ],
    [
      "nomor tagihan terlalu panjang",
      {
        reference: "X".repeat(MAX_BILL_REFERENCE + 1),
        lines: [{ productId: "p1", quantity: 1, unitCost: 1_000 }],
      },
      "maksimal",
    ],
    [
      "catatan terlalu panjang",
      {
        note: "N".repeat(MAX_PAYABLE_NOTE + 1),
        lines: [{ productId: "p1", quantity: 1, unitCost: 1_000 }],
      },
      "maksimal",
    ],
    [
      "baris melebihi batas",
      {
        lines: Array.from({ length: MAX_INVOICE_LINES + 1 }, () => ({
          productId: "p1",
          quantity: 1,
          unitCost: 1_000,
        })),
      },
      "maksimal 50 baris",
    ],
  ]) {
    const result = resolveInvoiceInput(input, options);
    check(
      `dokumen supplier ditolak: ${label}`,
      !result.ok && result.reason.includes(expected),
      result.reason ?? "DITERIMA — validasi dokumen supplier bocor",
    );
  }
}

// --------------------------------------------- satu tagihan satu dokumen supplier
{
  const ok = canRecordInvoice({ status: "open", hasInvoice: false, hasReceipt: true });
  check("tagihan terbuka dengan GRN boleh dicatat dokumennya", ok.ok, ok.reason);

  const paid = canRecordInvoice({ status: "paid", hasInvoice: false, hasReceipt: true });
  check(
    "tagihan yang sudah lunas masih boleh diselesaikan dokumennya",
    paid.ok,
    paid.reason,
  );

  for (const [label, args, expected] of [
    [
      "tagihan dibatalkan",
      { status: "void", hasInvoice: false, hasReceipt: true },
      "sudah dibatalkan",
    ],
    [
      "tanpa penerimaan barang",
      { status: "open", hasInvoice: false, hasReceipt: false },
      "tidak menunjuk penerimaan barang",
    ],
    [
      "dokumennya sudah pernah dicatat",
      { status: "open", hasInvoice: true, hasReceipt: true },
      "sudah dicatat",
    ],
  ]) {
    const result = canRecordInvoice(args);
    check(
      `pencatatan dokumen ditolak: ${label}`,
      !result.ok && result.reason.includes(expected),
      result.reason ?? "DITERIMA — penjagaan dokumen bocor",
    );
  }
}

// -------------------------------------------------------------- keputusan selisih
{
  const accepted = resolveMatchDecision(
    { kind: "accepted", note: "harga naik disetujui pemilik" },
    { current: null, hasVariance: true },
  );
  check(
    "selisih boleh diterima kalau memang ada selisih",
    accepted.ok && accepted.value.kind === "accepted" && Boolean(accepted.value.decidedAt),
    JSON.stringify(accepted),
  );

  const acceptedTanpaSelisih = resolveMatchDecision(
    { kind: "accepted" },
    { current: null, hasVariance: false },
  );
  check(
    "menerima selisih tanpa selisih ditolak",
    !acceptedTanpaSelisih.ok && acceptedTanpaSelisih.reason.includes("tidak punya selisih"),
    acceptedTanpaSelisih.reason,
  );

  const disputed = resolveMatchDecision(
    { kind: "disputed", note: "  jumlah kurang 2 unit  " },
    { current: null, hasVariance: true },
  );
  check(
    "sengketa menyimpan alasannya (dan dirapikan)",
    disputed.ok && disputed.value.note === "jumlah kurang 2 unit",
    JSON.stringify(disputed),
  );

  const disputedTanpaAlasan = resolveMatchDecision(
    { kind: "disputed", note: "  " },
    { current: null, hasVariance: true },
  );
  check(
    "sengketa tanpa alasan ditolak",
    !disputedTanpaAlasan.ok && disputedTanpaAlasan.reason.includes("alasan sengketa"),
    disputedTanpaAlasan.reason,
  );

  const catatanPanjang = resolveMatchDecision(
    { kind: "disputed", note: "N".repeat(MAX_PAYABLE_NOTE + 1) },
    { current: null, hasVariance: true },
  );
  check(
    "catatan selisih terlalu panjang ditolak",
    !catatanPanjang.ok && catatanPanjang.reason.includes("maksimal"),
    catatanPanjang.reason,
  );

  const batalin = resolveMatchDecision(
    { kind: "none" },
    { current: { kind: "disputed", note: "jumlah kurang", decidedAt: 1 }, hasVariance: true },
  );
  check("sengketa boleh dicabut", batalin.ok && batalin.value === null, JSON.stringify(batalin));

  const batalinAccept = resolveMatchDecision(
    { kind: "none" },
    { current: { kind: "accepted", decidedAt: 1 }, hasVariance: true },
  );
  check(
    "menerima selisih tidak bisa dibatalkan diam-diam",
    !batalinAccept.ok && batalinAccept.reason.includes("tidak bisa dibatalkan"),
    batalinAccept.reason,
  );

  const tanpaKeputusan = resolveMatchDecision(
    { kind: "none" },
    { current: null, hasVariance: true },
  );
  check(
    "mencabut keputusan yang tidak ada ditolak",
    !tanpaKeputusan.ok && tanpaKeputusan.reason.includes("belum punya keputusan"),
    tanpaKeputusan.reason,
  );
}

// ------------------------------------------------- nilai hutang setelah keputusan
{
  const receipt = [receiptLine("p1", "Kopi Susu", 10, 5_000)];
  const match = matchPayable({
    orderLines: [orderLine("p1", "Kopi Susu", 10, 5_000, 10)],
    receiptLines: receipt,
    invoice: invoice([billLine("p1", "Kopi Susu", 12, 5_000)]),
  });
  check(
    "hutang awal = nilai barang diterima (50.000), tagihannya 60.000",
    match.receivedValue === 50_000 && match.valueVariance === 10_000,
    JSON.stringify({ diterima: match.receivedValue, selisih: match.valueVariance }),
  );

  const tanpaKeputusan = amountAfterDecision({
    currentAmount: match.receivedValue,
    paidAmount: 0,
    match,
    decision: null,
  });
  check("tanpa keputusan nilai hutang tidak berubah", tanpaKeputusan === 50_000, String(tanpaKeputusan));

  const diterima = amountAfterDecision({
    currentAmount: match.receivedValue,
    paidAmount: 0,
    match,
    decision: { kind: "accepted", decidedAt: 1 },
  });
  check(
    "menerima selisih menyesuaikan hutang ke total tagihan supplier (60.000)",
    diterima === 60_000,
    String(diterima),
  );

  const disengketakan = amountAfterDecision({
    currentAmount: match.receivedValue,
    paidAmount: 0,
    match,
    decision: { kind: "disputed", note: "lebih 2 unit", decidedAt: 1 },
  });
  check(
    "sengketa TIDAK mengubah nilai hutang",
    disengketakan === 50_000,
    String(disengketakan),
  );

  const sudahDibayar = amountAfterDecision({
    currentAmount: match.receivedValue,
    paidAmount: 65_000,
    match,
    decision: { kind: "accepted", decidedAt: 1 },
  });
  check(
    "nilai hutang tidak pernah lebih kecil dari yang sudah dibayar (65.000)",
    sudahDibayar === 65_000,
    String(sudahDibayar),
  );
}

// ------------------------------------------------- tagihan bersengketa menahan bayar
{
  const boleh = canPayPayable(null);
  check("tagihan tanpa sengketa boleh dibayar", boleh.ok, boleh.reason);
  check("selisih yang sudah diterima boleh dibayar", canPayPayable({ kind: "accepted", decidedAt: 1 }).ok);

  const ditahan = canPayPayable({ kind: "disputed", note: "harga naik", decidedAt: 1 });
  check(
    "tagihan bersengketa ditolak dibayar, alasannya ikut dibawa",
    !ditahan.ok && ditahan.reason.includes("disengketakan") && ditahan.reason.includes("harga naik"),
    ditahan.reason,
  );
}

// --------------------------------------------------------- pembayaran sekaligus
const payable = (id, number, amount, paidAmount = 0, decision = null) => ({
  id,
  number,
  supplierName: "PT Sumber Rejeki",
  amount,
  paidAmount,
  dueDate: Date.UTC(2026, 10, 1),
  status: "open",
  decision,
});

{
  const plan = planBatchPayment({
    payables: [
      payable("a", "AP-00001", 1_000_000),
      payable("b", "AP-00002", 500_000, 200_000),
    ],
    requests: [
      { payableId: "a", amount: 1_000_000 },
      { payableId: "b", amount: 300_000 },
    ],
  });
  check(
    "dua tagihan dibayar sekali jalan, total dijumlahkan",
    plan.ok &&
      plan.value.rows.length === 2 &&
      plan.value.total === 1_300_000 &&
      plan.value.fullyPaidCount === 2,
    JSON.stringify(plan.value),
  );
  check(
    "setiap baris membawa sisa setelah pembayaran",
    plan.value.rows[0].remaining === 0 &&
      plan.value.rows[0].fullyPaid &&
      plan.value.rows[1].remaining === 0 &&
      plan.value.rows[1].fullyPaid,
    JSON.stringify(plan.value.rows),
  );

  const sebagian = planBatchPayment({
    payables: [payable("a", "AP-00001", 1_000_000)],
    requests: [{ payableId: "a", amount: 250_000 }],
  });
  check(
    "pembayaran sebagian dalam batch tetap menyisakan hutang",
    sebagian.ok &&
      sebagian.value.total === 250_000 &&
      sebagian.value.fullyPaidCount === 0 &&
      sebagian.value.rows[0].remaining === 750_000,
    JSON.stringify(sebagian.value),
  );

  const ditahan = planBatchPayment({
    payables: [
      payable("a", "AP-00001", 1_000_000),
      payable("b", "AP-00002", 500_000, 0, {
        kind: "disputed",
        note: "harga naik",
        decidedAt: 1,
      }),
    ],
    requests: [
      { payableId: "a", amount: 1_000_000 },
      { payableId: "b", amount: 500_000 },
    ],
  });
  check(
    "satu tagihan bersengketa membatalkan seluruh batch",
    !ditahan.ok && ditahan.reason.includes("disengketakan") && ditahan.reason.includes("harga naik"),
    ditahan.reason,
  );

  for (const [label, args, expected] of [
    ["tanpa pilihan", { payables: [payable("a", "AP-00001", 1_000_000)], requests: [] }, "Pilih dulu tagihan"],
    [
      "tagihan tidak ditemukan",
      { payables: [], requests: [{ payableId: "z", amount: 1_000 }] },
      "tidak ditemukan",
    ],
    [
      "tagihan muncul dua kali",
      {
        payables: [payable("a", "AP-00001", 1_000_000)],
        requests: [
          { payableId: "a", amount: 100_000 },
          { payableId: "a", amount: 100_000 },
        ],
      },
      "muncul dua kali",
    ],
    [
      "kelebihan bayar",
      {
        payables: [payable("a", "AP-00001", 1_000_000)],
        requests: [{ payableId: "a", amount: 1_500_000 }],
      },
      "melebihi sisa hutang",
    ],
    [
      "jumlah nol",
      {
        payables: [payable("a", "AP-00001", 1_000_000)],
        requests: [{ payableId: "a", amount: 0 }],
      },
      "lebih dari 0",
    ],
    [
      "melebihi batas jumlah tagihan",
      {
        payables: [payable("a", "AP-00001", 1_000_000)],
        requests: Array.from({ length: MAX_BATCH_BILLS + 1 }, () => ({
          payableId: "a",
          amount: 1_000,
        })),
      },
      `maksimal ${MAX_BATCH_BILLS} tagihan`,
    ],
  ]) {
    const result = planBatchPayment(args);
    check(
      `pembayaran batch ditolak: ${label}`,
      !result.ok && result.reason.includes(expected),
      result.reason ?? "DITERIMA — aturan pembayaran batch bocor",
    );
  }

  const kelebihan = planBatchPayment({
    payables: [payable("a", "AP-00001", 1_000_000)],
    requests: [{ payableId: "a", amount: 1_000_001 }],
  });
  check(
    "pesan penolakan menyebut nomor tagihannya",
    !kelebihan.ok && kelebihan.reason.startsWith("AP-00001:"),
    kelebihan.reason,
  );
}

// -------------------------------------------------------------------- nomor batch
check("nomor batch pertama PAY-00001", batchPaymentNumber(1) === "PAY-00001", batchPaymentNumber(1));
check("nomor batch ke-4321 tetap 5 digit", batchPaymentNumber(4321) === "PAY-04321", batchPaymentNumber(4321));
check(
  "urutan tidak masuk akal tidak pernah menghasilkan PAY-00NaN",
  batchPaymentNumber(Number.NaN) === "PAY-00001" && batchPaymentNumber(0) === "PAY-00001",
  `${batchPaymentNumber(Number.NaN)} / ${batchPaymentNumber(0)}`,
);

// ---------------------------------------------------------------------- ringkasan
{
  const receipt = [receiptLine("p1", "Kopi Susu", 10, 5_000)];
  const order = [orderLine("p1", "Kopi Susu", 10, 5_000, 10)];
  const waiting = matchPayable({ orderLines: order, receiptLines: receipt });
  const variance = matchPayable({
    orderLines: order,
    receiptLines: receipt,
    invoice: invoice([billLine("p1", "Kopi Susu", 12, 5_000)]),
  });
  const matched = matchPayable({
    orderLines: order,
    receiptLines: receipt,
    invoice: invoice([billLine("p1", "Kopi Susu", 10, 5_000)]),
  });
  const tanpaReferensi = matchPayable({});

  const summary = summariseThreeway([
    { match: waiting, decision: null, balance: 50_000 },
    { match: variance, decision: null, balance: 50_000 },
    { match: variance, decision: { kind: "disputed", note: "x", decidedAt: 1 }, balance: 50_000 },
    { match: variance, decision: { kind: "accepted", decidedAt: 1 }, balance: 50_000 },
    { match: matched, decision: null, balance: 50_000 },
    { match: tanpaReferensi, decision: null, balance: 240_000 },
    { match: variance, decision: null, balance: 0 },
  ]);

  check(
    "ringkasan memisahkan yang menunggu dokumen, perlu ditinjau, dan cocok",
    summary.waitingInvoice === 1 && summary.needsReview === 2 && summary.matched === 1,
    JSON.stringify(summary),
  );
  check(
    "sengketa & selisih yang sudah diterima dihitung terpisah",
    summary.disputed === 1 && summary.accepted === 1,
    JSON.stringify(summary),
  );
  check(
    "nilai selisih yang belum selesai dijumlahkan absolut (20.000)",
    summary.openVarianceValue === 20_000,
    JSON.stringify(summary),
  );

  check(
    "tagihan yang tidak punya PO/GRN tidak mengotori ringkasan",
    summariseThreeway([{ match: tanpaReferensi, decision: null, balance: 100 }]).matched === 0 &&
      summariseThreeway([{ match: tanpaReferensi, decision: null, balance: 100 }]).waitingInvoice === 0,
    JSON.stringify(summariseThreeway([{ match: tanpaReferensi, decision: null, balance: 100 }])),
  );
  check(
    "ringkasan kosong tetap sah",
    Object.values(summariseThreeway([])).every((value) => value === 0),
    JSON.stringify(summariseThreeway([])),
  );
}

// ------------------------------------------------------- pratinjau baris tagihan
{
  const draft = buildInvoiceDraft({
    orderLines: [orderLine("p1", "Kopi Susu", 10, 5_000, 10)],
    receiptLines: [
      receiptLine("p1", "Kopi Susu", 10, 5_000),
      receiptLine("p2", "Roti Bakar", 3, 8_000),
    ],
  });
  check(
    "pratinjau mengambil kuantitas & harga dari penerimaan (GRN)",
    draft.length === 2 &&
      draft[0].quantity === 10 &&
      draft[0].unitCost === 5_000 &&
      draft[0].receivedQty === 10,
    JSON.stringify(draft),
  );
  check(
    "kuantitas pesanan ikut ditampilkan, 0 kalau tak ada PO-nya",
    draft[0].orderedQty === 10 && draft[1].orderedQty === 0,
    JSON.stringify(draft.map((line) => line.orderedQty)),
  );
}

// -------------------------------------------------------------------- kalimat
{
  const order = [orderLine("p1", "Kopi Susu", 10, 5_000, 10)];
  const receipt = [receiptLine("p1", "Kopi Susu", 10, 5_000)];
  check(
    "kalimat tagihan tanpa PO/GRN jelas",
    describeMatch(matchPayable({})) === "Tanpa PO/GRN — tidak ada yang dicocokkan",
    describeMatch(matchPayable({})),
  );
  check(
    "kalimat menunggu dokumen menyebut nilai barang diterima",
    describeMatch(matchPayable({ orderLines: order, receiptLines: receipt })).includes(
      "dokumen supplier belum dicatat",
    ) &&
      describeMatch(matchPayable({ orderLines: order, receiptLines: receipt })).includes("50.000"),
    describeMatch(matchPayable({ orderLines: order, receiptLines: receipt })),
  );
  check(
    "kalimat cocok menyebut nilainya",
    describeMatch(
      matchPayable({
        orderLines: order,
        receiptLines: receipt,
        invoice: invoice([billLine("p1", "Kopi Susu", 10, 5_000)]),
      }),
    ).startsWith("Cocok dengan PO & penerimaan"),
  );
  check(
    "kalimat selisih memakai tanda +/−",
    describeMatch(
      matchPayable({
        orderLines: order,
        receiptLines: receipt,
        invoice: invoice([billLine("p1", "Kopi Susu", 8, 5_000)]),
      }),
    ).startsWith("Selisih −"),
    describeMatch(
      matchPayable({
        orderLines: order,
        receiptLines: receipt,
        invoice: invoice([billLine("p1", "Kopi Susu", 8, 5_000)]),
      }),
    ),
  );
}

console.log(`${results.length}/${results.length} checks passed`);

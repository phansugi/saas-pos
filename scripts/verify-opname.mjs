/**
 * Uji aturan stock opname (`inventory.opname`) tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/opname.ts` — modul murni yang dipakai server
 * (mulai sesi, simpan hitungan, posting), kedua store (demo & Convex), halaman
 * Opname, dan harness ini. Karena aturannya satu, hasilnya berlaku untuk
 * semuanya.
 *
 * Dua aturan yang paling sering salah dan karena itu diuji ketat:
 *
 * 1. Posting memakai **saldo terbaru** (`currentQty`) sebagai titik awal, bukan
 *    snapshot — jadi penjualan yang terjadi di tengah penghitungan tidak
 *    terhitung dua kali.
 * 2. Baris yang **belum dihitung bukan nol** — posting tidak boleh menyentuhnya.
 *
 * Usage: bun scripts/verify-opname.mjs
 */
import {
  buildOpnameLines,
  canCancelOpname,
  canEditOpname,
  canPostOpname,
  countProgress,
  countedLines,
  lineVariance,
  MAX_COUNT_QTY,
  MAX_OPNAME_NOTE,
  opnameNumber,
  OPNAME_STATUS_LABELS,
  planOpnamePost,
  resolveCountValue,
  resolveLineNote,
  resolveOpnameNote,
  resolveOpnameStart,
  setCountedQty,
  summariseOpnameSessions,
  summariseVariance,
  uncountedLines,
} from "../src/convex/lib/opname.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

/** Baris sesi: snapshot `systemQty`, hasil hitung opsional. */
const line = (productId, systemQty, countedQty, extra = {}) => ({
  productId,
  name: `Produk ${productId}`,
  sku: `SKU-${productId}`,
  unit: "PCS",
  systemQty,
  ...(countedQty === undefined ? {} : { countedQty }),
  ...extra,
});

// ------------------------------------------------------------- nomor & status
check("nomor opname berurutan", opnameNumber(1) === "OPN-00001", opnameNumber(1));
check("nomor opname besar tetap 5 digit", opnameNumber(4321) === "OPN-04321", opnameNumber(4321));
check(
  "nomor opname aman untuk input aneh",
  opnameNumber(0) === "OPN-00001" && opnameNumber(NaN) === "OPN-00001",
  `${opnameNumber(0)} / ${opnameNumber(NaN)}`,
);
check(
  "label status Bahasa Indonesia",
  OPNAME_STATUS_LABELS.draft === "Berjalan" &&
    OPNAME_STATUS_LABELS.posted === "Selesai" &&
    OPNAME_STATUS_LABELS.cancelled === "Dibatalkan",
  JSON.stringify(OPNAME_STATUS_LABELS),
);

// ------------------------------------------------------------ selisih per baris
check("baris belum dihitung tidak punya selisih", lineVariance(line("a", 10)) === undefined, "ada nilai");
check("selisih = hitung − snapshot", lineVariance(line("a", 10, 7)) === -3, String(lineVariance(line("a", 10, 7))));
check("hasil hitung sama dengan catatan = selisih 0", lineVariance(line("a", 10, 10)) === 0, "bukan 0");

const mixed = [line("a", 10, 10), line("b", 5, 8), line("c", 4, 1), line("d", 2)];
check("baris terhitung dipisah dari yang belum", countedLines(mixed).length === 3 && uncountedLines(mixed).length === 1, `${countedLines(mixed).length}/${uncountedLines(mixed).length}`);

// ----------------------------------------------------------------- progres
{
  const progress = countProgress(mixed);
  check(
    "progres menghitung sisa & persen",
    progress.total === 4 && progress.counted === 3 && progress.remaining === 1 && progress.percent === 75,
    JSON.stringify(progress),
  );
  const empty = countProgress([]);
  check(
    "sesi tanpa baris tidak membagi nol",
    empty.percent === 0 && empty.total === 0,
    JSON.stringify(empty),
  );
}

// -------------------------------------------------------------- ringkasan selisih
{
  const variance = summariseVariance(mixed);
  check(
    "ringkasan selisih memisahkan cocok / lebih / kurang",
    variance.counted === 3 &&
      variance.uncounted === 1 &&
      variance.matched === 1 &&
      variance.surplusLines === 1 &&
      variance.shortageLines === 1 &&
      variance.surplusUnits === 3 &&
      variance.shortageUnits === 3 &&
      variance.netUnits === 0,
    JSON.stringify(variance),
  );
}

// --------------------------------------------------- validasi hasil hitungan
check("hasil hitung bulat diterima", resolveCountValue(0).ok && resolveCountValue(17).value === 17, JSON.stringify(resolveCountValue(17)));
check("hasil hitung pecahan ditolak", !resolveCountValue(2.5).ok, resolveCountValue(2.5).reason);
check("hasil hitung negatif ditolak", !resolveCountValue(-1).ok, resolveCountValue(-1).reason);
check(
  "hasil hitung di atas batas wajar ditolak",
  !resolveCountValue(MAX_COUNT_QTY + 1).ok,
  resolveCountValue(MAX_COUNT_QTY + 1).reason,
);
check(
  "pesan batas menyebut nama produknya",
  (resolveCountValue(MAX_COUNT_QTY + 1, { productName: "Kopi Susu" }).reason ?? "").includes("Kopi Susu"),
  resolveCountValue(MAX_COUNT_QTY + 1, { productName: "Kopi Susu" }).reason,
);
check("catatan kosong menjadi tanpa catatan", resolveLineNote("   ").value === undefined, String(resolveLineNote("   ").value));
check(
  "catatan dinormalkan spasinya",
  resolveLineNote("  rusak   satu  ").value === "rusak satu",
  resolveLineNote("  rusak   satu  ").value,
);
check(
  "catatan kepanjangan ditolak",
  !resolveOpnameNote("x".repeat(MAX_OPNAME_NOTE + 1)).ok,
  resolveOpnameNote("x".repeat(MAX_OPNAME_NOTE + 1)).reason,
);

// ---------------------------------------------------------- tulis satu baris
{
  const lines = [line("a", 10), line("b", 5)];
  const written = setCountedQty(lines, { productId: "b", countedQty: 3 });
  check("hitung satu baris tersimpan", written.ok && written.value[1].countedQty === 3, JSON.stringify(written.value));
  check(
    "baris lain tidak ikut berubah",
    written.value[0].countedQty === undefined && lines[1].countedQty === undefined,
    "asli ikut berubah",
  );

  const cleared = setCountedQty(written.value, { productId: "b" });
  check(
    "mengosongkan hitungan mengembalikan baris ke belum dihitung",
    cleared.ok && cleared.value[1].countedQty === undefined,
    JSON.stringify(cleared.value[1]),
  );

  check(
    "produk di luar sesi ditolak",
    !setCountedQty(lines, { productId: "zz", countedQty: 1 }).ok,
    setCountedQty(lines, { productId: "zz", countedQty: 1 }).reason,
  );
  check(
    "hitung negatif tidak masuk ke sesi",
    !setCountedQty(lines, { productId: "a", countedQty: -2 }).ok,
    setCountedQty(lines, { productId: "a", countedQty: -2 }).reason,
  );
}

// ---------------------------------------------------- aturan edit / posting
check("sesi berjalan masih bisa diubah", canEditOpname("draft").ok, canEditOpname("draft").reason);
check("sesi selesai terkunci", !canEditOpname("posted").ok, canEditOpname("posted").reason);
check("sesi batal terkunci", !canEditOpname("cancelled").ok, canEditOpname("cancelled").reason);
check(
  "sesi tanpa baris dihitung tidak bisa diposting",
  !canPostOpname({ status: "draft", lines: [line("a", 1)] }).ok,
  canPostOpname({ status: "draft", lines: [line("a", 1)] }).reason,
);
check(
  "hitung sebagian boleh diposting",
  canPostOpname({ status: "draft", lines: [line("a", 1, 1), line("b", 4)] }).ok,
  canPostOpname({ status: "draft", lines: [line("a", 1, 1), line("b", 4)] }).reason,
);
check(
  "sesi selesai tidak bisa diposting dua kali",
  !canPostOpname({ status: "posted", lines: [line("a", 1, 1)] }).ok,
  canPostOpname({ status: "posted", lines: [line("a", 1, 1)] }).reason,
);
check("sesi selesai tidak bisa dibatalkan", !canCancelOpname("posted").ok, canCancelOpname("posted").reason);

// --------------------------------------------------------------- rencana posting
{
  // Snapshot 10, tapi ada penjualan 4 selama menghitung: saldo terbaru 6.
  const lines = [line("a", 10, 9), line("b", 5, 5), line("c", 4), line("d", 7, 7), line("e", 10, 4)];
  const current = { a: 6, b: 5, c: 4, d: 7, e: 10 };
  const plan = planOpnamePost(lines, current);

  check(
    "selisih dihitung dari saldo terbaru, bukan snapshot",
    plan.movements.length === 2 && plan.movements[0].delta === 3 && plan.movements[0].currentQty === 6,
    JSON.stringify(plan.movements),
  );
  check(
    "penjualan di tengah sesi tidak dihitung dua kali",
    plan.movements[0].countedQty === 9 && plan.movements[0].systemQty === 10,
    JSON.stringify(plan.movements[0]),
  );
  check("baris yang sudah cocok tidak menghasilkan gerakan", plan.unchanged === 2, String(plan.unchanged));
  check(
    "baris belum dihitung tidak disentuh",
    !plan.movements.some((movement) => movement.productId === "c"),
    JSON.stringify(plan.movements.map((movement) => movement.productId)),
  );
  check(
    "total tambah/kurang & netto",
    plan.addedUnits === 3 && plan.removedUnits === 6 && plan.netUnits === -3,
    `${plan.addedUnits}/${plan.removedUnits}/${plan.netUnits}`,
  );
  check(
    "posting menerima Map maupun objek saldo",
    planOpnamePost([line("a", 10, 9)], new Map([["a", 6]])).movements[0].delta === 3,
    "Map gagal",
  );
  check(
    "saldo hilang dianggap 0 tanpa NaN",
    planOpnamePost([line("a", 2, 2)], {}).movements[0].delta === 2,
    JSON.stringify(planOpnamePost([line("a", 2, 2)], {}).movements),
  );
  check(
    "sesi kosong menghasilkan rencana kosong",
    planOpnamePost([], {}).movements.length === 0,
    "ada gerakan",
  );
}

// -------------------------------------------------------------- mulai sesi
{
  const snapshot = [line("a", 3), line("b", 0)];
  const ok = resolveOpnameStart({
    location: { id: "w1", name: "Gudang Utama" },
    openSessions: [],
    lines: snapshot,
  });
  check("sesi baru boleh dimulai", ok.ok, ok.reason);
  check(
    "baris sesi adalah salinan, bukan referensi",
    ok.value.lines[0] !== snapshot[0] && ok.value.lines[0].systemQty === 3,
    "referensi bocor",
  );

  const clash = resolveOpnameStart({
    location: { id: "w1", name: "Gudang Utama" },
    openSessions: [{ number: "OPN-00007", locationId: "w1" }],
    lines: snapshot,
  });
  check(
    "lokasi dengan sesi berjalan ditolak & nomornya disebut",
    !clash.ok && (clash.reason ?? "").includes("OPN-00007"),
    clash.reason,
  );

  const other = resolveOpnameStart({
    location: { id: "w1", name: "Gudang Utama" },
    openSessions: [{ number: "OPN-00007", locationId: "w2" }],
    lines: snapshot,
  });
  check("sesi lokasi lain tidak menghalangi", other.ok, other.reason);

  const empty = resolveOpnameStart({
    location: { id: "w1", name: "Gudang Utama" },
    openSessions: [],
    lines: [],
  });
  check("lokasi tanpa produk berstok ditolak", !empty.ok, "diterima");
}

// ------------------------------------------------------------- snapshot baris
{
  const built = buildOpnameLines(
    [
      { id: "a", name: "Kopi", sku: "KOPI-1", unit: "CUP" },
      { id: "b", name: "Gula", sku: "GULA-1" },
    ],
    (productId) => (productId === "a" ? 12.9 : 0),
  );
  check(
    "snapshot memakai saldo lokasi & satuan default",
    built[0].systemQty === 12 && built[0].unit === "CUP" && built[1].unit === "PCS",
    JSON.stringify(built),
  );
  check(
    "snapshot tidak pernah membawa hasil hitung",
    built.every((row) => row.countedQty === undefined),
    JSON.stringify(built),
  );
}

// --------------------------------------------------------- ringkasan sesi
{
  const summary = summariseOpnameSessions([
    { status: "draft", lines: [line("a", 10, 12), line("b", 5)] },
    { status: "draft", lines: [line("c", 1, 1)] },
    { status: "posted", lines: [line("d", 4, 7)] },
    { status: "cancelled", lines: [line("e", 2, 2)] },
  ]);
  check(
    "ringkasan sesi memisahkan status & baris tersisa",
    summary.openCount === 2 &&
      summary.postedCount === 1 &&
      summary.cancelledCount === 1 &&
      summary.remainingLines === 1 &&
      summary.runningNetUnits === 2,
    JSON.stringify(summary),
  );
  check(
    "selisih sesi selesai tidak dihitung sebagai selisih berjalan",
    summariseOpnameSessions([{ status: "posted", lines: [line("d", 4, 9)] }]).runningNetUnits === 0,
    "ikut terhitung",
  );
}

console.log(`${results.length}/${results.length} checks passed`);

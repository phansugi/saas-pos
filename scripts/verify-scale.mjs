/**
 * Uji aturan optimasi beban skala franchise (`scale.franchise`, Phase 5).
 *
 * Dua bagian:
 *
 *  1. **Kebenaran** aturan murni `src/convex/lib/scale.ts` — anggaran query,
 *     paging, penggabungan top-N, dan rollup lintas cabang (termasuk cabang
 *     nonaktif, cabang di luar anggaran, dan pangsa yang harus berjumlah 100).
 *  2. **Pengukuran** pada masukan besar: berapa lama satu giliran halaman dari
 *     200.000 baris dibanding memindai seluruhnya, dan berapa lama penggabungan
 *     top-N berbatas dibandingkan menggabungkan semua baris lalu mengurutkannya.
 *     Angkanya dicetak apa adanya (bukan klaim "lebih cepat") dan hanya dijaga
 *     supaya algoritme berbatas tidak diam-diam berubah jadi pemindaian penuh.
 *
 * Bagian ketiga menjaga bentuk query di `src/convex/reports.ts`: laporan
 * lintas cabang wajib membaca per cabang dengan `.take(...)` berindeks dan
 * **tidak boleh** memakai `.collect()` — itulah bedanya laporan ini dengan
 * laporan biasa, dan itu yang mudah hilang saat seseorang menyuntingnya.
 *
 * Usage: bun scripts/verify-scale.mjs
 */
import { readFileSync } from "node:fs";
import { FEATURE_LABELS, PLANS } from "../src/convex/lib/billing/catalog.ts";
import {
  describeBudget,
  FRANCHISE_TOP_SALES,
  franchiseRollup,
  MAX_OUTLET_WINDOW,
  MAX_PAGE_SIZE,
  mergeTopN,
  outletReadLimit,
  pageWindow,
  PAGE_SIZE,
  queryBudgetFor,
  resolvePageSize,
  trimOutletRows,
} from "../src/convex/lib/scale.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

function measure(fn) {
  const start = performance.now();
  const value = fn();
  return { ms: performance.now() - start, value };
}

const NOW = 1_760_000_000_000;
const MINUTE = 60 * 1000;

// ------------------------------------------------------------------ anggaran
check(
  "jendela cabang tidak pernah melewati batas global",
  [1, 3, 10, 26, 100, 500].every((count) => queryBudgetFor(count).stores <= MAX_OUTLET_WINDOW),
  JSON.stringify([1, 3, 10, 26, 100, 500].map((c) => queryBudgetFor(c).stores)),
);
check(
  "baris per cabang mengecil saat jumlah cabang bertambah",
  queryBudgetFor(3).rowsPerStore === 600 &&
    queryBudgetFor(4).rowsPerStore === 300 &&
    queryBudgetFor(10).rowsPerStore === 300 &&
    queryBudgetFor(11).rowsPerStore === 200 &&
    queryBudgetFor(26).rowsPerStore === 150 &&
    queryBudgetFor(50).rowsPerStore === 150,
  JSON.stringify([3, 4, 10, 11, 26, 50].map((c) => queryBudgetFor(c).rowsPerStore)),
);
check(
  "batas dokumen satu permintaan = cabang × baris per cabang",
  [1, 5, 20, 100].every((count) => {
    const budget = queryBudgetFor(count);
    return budget.maxRows === budget.stores * budget.rowsPerStore;
  }),
  JSON.stringify([1, 5, 20, 100].map((c) => queryBudgetFor(c))),
);
check(
  "jumlah cabang nol / negatif tetap menghasilkan anggaran yang sah",
  queryBudgetFor(0).stores === 1 && queryBudgetFor(-5).rowsPerStore > 0,
  JSON.stringify([queryBudgetFor(0), queryBudgetFor(-5)]),
);
check(
  "query meminta satu baris lebih banyak dari anggaran (agar pemotongan diketahui)",
  [1, 12, 60].every((count) => outletReadLimit(queryBudgetFor(count)) === queryBudgetFor(count).rowsPerStore + 1),
  String(outletReadLimit(queryBudgetFor(12))),
);
check(
  "penjelasan anggaran menyebut angka cabang, baris per cabang & total dokumennya",
  (() => {
    const budget = queryBudgetFor(12);
    const text = describeBudget(budget);
    return (
      text.includes(String(budget.stores)) &&
      text.includes(budget.rowsPerStore.toLocaleString("id-ID")) &&
      text.includes(budget.maxRows.toLocaleString("id-ID"))
    );
  })(),
  describeBudget(queryBudgetFor(12)),
);

// ----------------------------------------------------------- pemotongan baris
{
  const budget = queryBudgetFor(2);
  const within = trimOutletRows(
    Array.from({ length: budget.rowsPerStore }, (_, i) => ({ total: i, createdAt: NOW })),
    budget,
  );
  const over = trimOutletRows(
    Array.from({ length: budget.rowsPerStore + 50 }, (_, i) => ({ total: i, createdAt: NOW })),
    budget,
  );
  check(
    "baris di dalam anggaran tidak ditandai terpotong",
    within.truncated === false && within.sales.length === budget.rowsPerStore,
    JSON.stringify({ truncated: within.truncated, length: within.sales.length }),
  );
  check(
    "baris di luar anggaran dipotong & ditandai terpotong",
    over.truncated === true && over.sales.length === budget.rowsPerStore,
    JSON.stringify({ truncated: over.truncated, length: over.sales.length }),
  );
}

// ------------------------------------------------------------------- halaman
check(
  "ukuran halaman dibatasi ke rentang yang sah",
  resolvePageSize() === PAGE_SIZE &&
    resolvePageSize(0) === 1 &&
    resolvePageSize(99999) === MAX_PAGE_SIZE &&
    resolvePageSize(Number.NaN) === PAGE_SIZE,
  JSON.stringify([resolvePageSize(), resolvePageSize(0), resolvePageSize(99999)]),
);
{
  const rows = Array.from({ length: 450 }, (_, i) => i);
  const first = pageWindow(rows, 0, 200);
  const second = pageWindow(rows, 200, 200);
  const third = pageWindow(rows, 400, 200);
  check(
    "halaman pertama mengambil tepat satu jendela dan menunjuk cursor berikutnya",
    first.items.length === 200 && first.nextCursor === 200 && first.hasMore === true,
    JSON.stringify({ length: first.items.length, next: first.nextCursor }),
  );
  check(
    "halaman terakhir mengembalikan sisa tanpa cursor",
    third.items.length === 50 && third.nextCursor === null && third.hasMore === false,
    JSON.stringify({ length: third.items.length, next: third.nextCursor }),
  );
  check(
    "cursor di luar koleksi menghasilkan halaman kosong, bukan error",
    pageWindow(rows, 10_000, 200).items.length === 0 &&
      pageWindow(rows, 10_000, 200).hasMore === false,
    "DITERIMA — cursor di luar koleksi melempar/mengembalikan data",
  );
  check(
    "giliran halaman kedua melanjutkan tepat setelah giliran pertama",
    second.items[0] === rows[200] && second.items.length === 200,
    String(second.items[0]),
  );
}

// -------------------------------------------------------------- top-N berbatas
{
  const lists = Array.from({ length: 6 }, (_, listIndex) =>
    Array.from({ length: 40 }, (_, rowIndex) => ({
      id: `${listIndex}-${rowIndex}`,
      total: (listIndex + 1) * 1000 - rowIndex,
    })),
  );
  const merged = mergeTopN(lists, 8, (row) => row.total);
  const naive = lists
    .flat()
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  check(
    "gabungan top-N sama dengan mengurutkan seluruh baris",
    JSON.stringify(merged.map((row) => row.id)) === JSON.stringify(naive.map((row) => row.id)),
    JSON.stringify({ merged: merged.map((r) => r.id), naive: naive.map((r) => r.id) }),
  );
  check(
    "gabungan top-N hanya menyimpan sebanyak yang diminta",
    merged.length === 8,
    String(merged.length),
  );
  check(
    "gabungan top-N terurut menurun",
    merged.every((row, index) => index === 0 || row.total <= merged[index - 1].total),
    JSON.stringify(merged.map((row) => row.total)),
  );
  check(
    "permintaan nol / daftar kosong aman",
    mergeTopN(lists, 0, (row) => row.total).length === 0 &&
      mergeTopN([], 5, (row) => row.total).length === 0 &&
      mergeTopN([[]], 5, (row) => row.total).length === 0,
    "DITERIMA — masukan kosong melempar",
  );
  check(
    "daftar yang lebih pendek dari n dikembalikan seluruhnya",
    mergeTopN([[{ total: 3 }, { total: 1 }]], 5, (row) => row.total).length === 2,
    "DITERIMA — isi hilang",
  );
}

// ------------------------------------------------------------- rollup cabang
function outlet(id, revenue, transactions, options = {}) {
  const average = transactions > 0 ? revenue / transactions : 0;
  return {
    storeId: id,
    name: `Cabang ${id}`,
    code: id.toUpperCase(),
    active: true,
    sales: Array.from({ length: transactions }, (_, index) => ({
      total: Math.round(average) + (index === 0 ? revenue - Math.round(average) * transactions : 0),
      createdAt: NOW - index * MINUTE,
    })),
    ...options,
  };
}

{
  const budget = queryBudgetFor(4);
  const report = franchiseRollup({
    outlets: [
      outlet("satu", 5_000_000, 50),
      outlet("dua", 9_000_000, 60),
      outlet("tiga", 3_000_000, 30),
      outlet("tutup", 0, 0, { active: false }),
    ],
    budget,
    from: NOW - MINUTE * 60,
    to: NOW,
  });

  check(
    "cabang nonaktif tidak diagregasi tetapi tetap dilaporkan jumlahnya",
    report.outlets.length === 3 &&
      report.totals.inactiveOutlets === 1 &&
      report.totals.outlets === 4 &&
      report.totals.activeOutlets === 3,
    JSON.stringify(report.totals),
  );
  check(
    "cabang diurutkan menurut omzet menurun",
    report.outlets.map((row) => row.storeId).join(",") === "dua,satu,tiga",
    report.outlets.map((row) => row.storeId).join(","),
  );
  check(
    "total jaringan = jumlah omzet cabang yang diagregasi",
    report.totals.revenue === 17_000_000 && report.totals.transactions === 140,
    JSON.stringify(report.totals),
  );
  check(
    "rata-rata keranjang jaringan dihitung dari total, bukan rata-rata rata-rata",
    report.totals.averageBasket === Math.round(17_000_000 / 140),
    String(report.totals.averageBasket),
  );
  check(
    "pangsa omzet berjumlah tepat 100%",
    report.outlets.reduce((sum, row) => sum + row.sharePct, 0) === 100,
    JSON.stringify(report.outlets.map((row) => row.sharePct)),
  );
  check(
    "pangsa mengikuti omzet terbesar",
    report.outlets[0].sharePct > report.outlets[1].sharePct &&
      report.outlets[1].sharePct > report.outlets[2].sharePct,
    JSON.stringify(report.outlets.map((row) => row.sharePct)),
  );
  check(
    "laporan menyebut anggaran & jendela yang dipakai",
    report.budget.stores === budget.stores &&
      report.window.from === NOW - MINUTE * 60 &&
      report.window.to === NOW &&
      report.truncated === false,
    JSON.stringify({ budget: report.budget, window: report.window }),
  );
}
{
  const budget = queryBudgetFor(12);
  // 6 cabang aktif sementara anggaran hanya menampung 12: tidak ada yang dibuang.
  const small = franchiseRollup({
    outlets: Array.from({ length: 6 }, (_, i) => outlet(`c${i}`, 1_000_000 * (i + 1), 10)),
    budget,
    from: NOW - MINUTE,
    to: NOW,
  });
  check(
    "cabang yang muat di anggaran tidak dilaporkan terpotong",
    small.truncated === false && small.skippedOutlets === 0,
    JSON.stringify({ truncated: small.truncated, skipped: small.skippedOutlets }),
  );
}
{
  // Anggaran dipersempit sengaja: inilah yang terjadi saat jumlah cabang
  // bertambah lebih cepat dari yang bisa dibaca satu permintaan.
  const tightBudget = { ...queryBudgetFor(30), stores: 2 };
  const report = franchiseRollup({
    outlets: Array.from({ length: 5 }, (_, i) => outlet(`c${i}`, 1_000_000 * (i + 1), 10)),
    budget: tightBudget,
    from: NOW - MINUTE,
    to: NOW,
  });
  check(
    "cabang di luar anggaran tidak diagregasi tetapi dicatat sebagai terlewat",
    report.outlets.length === 2 && report.skippedOutlets === 3 && report.truncated === true,
    JSON.stringify({ outlets: report.outlets.length, skipped: report.skippedOutlets }),
  );
  check(
    "omzet total hanya jumlah cabang yang benar-benar diagregasi",
    report.totals.revenue === report.outlets.reduce((sum, row) => sum + row.revenue, 0),
    String(report.totals.revenue),
  );
}
check(
  "cabang yang barisnya terpotong menandai laporannya terpotong",
  franchiseRollup({
    outlets: [outlet("satu", 1_000_000, 10, { truncated: true })],
    budget: queryBudgetFor(1),
    from: NOW - MINUTE,
    to: NOW,
  }).truncated === true,
  "DITERIMA — pemotongan per cabang hilang",
);
check(
  "laporan tanpa penjualan tidak membagi nol & pangsa nol",
  (() => {
    const report = franchiseRollup({
      outlets: [outlet("kosong", 0, 0)],
      budget: queryBudgetFor(1),
      from: NOW - MINUTE,
      to: NOW,
    });
    return (
      report.totals.averageBasket === 0 &&
      report.outlets[0].sharePct === 0 &&
      Number.isFinite(report.totals.revenue)
    );
  })(),
  "DITERIMA — pembagian nol",
);
check(
  "laporan tanpa cabang tetap berbentuk sah",
  franchiseRollup({ outlets: [], budget: queryBudgetFor(1), from: NOW, to: NOW }).outlets
    .length === 0,
  "DITERIMA — laporan kosong melempar",
);

// ---------------------------------------------------------------- pengukuran
const HUGE_ROWS = 200_000;
const hugeRows = Array.from({ length: HUGE_ROWS }, (_, index) => ({
  id: index,
  total: (index * 7919) % 100_000,
}));

const pageTiming = measure(() => pageWindow(hugeRows, HUGE_ROWS - PAGE_SIZE, PAGE_SIZE));
const fullScanTiming = measure(() => {
  let sum = 0;
  for (const row of hugeRows) sum += row.total;
  return sum;
});
check(
  "satu giliran halaman mengambil tepat satu jendela dari koleksi besar",
  pageTiming.value.items.length === PAGE_SIZE && pageTiming.value.hasMore === false,
  JSON.stringify({ length: pageTiming.value.items.length, hasMore: pageTiming.value.hasMore }),
);

const MERGE_LISTS = 40;
const MERGE_ROWS = 500;
const mergeLists = Array.from({ length: MERGE_LISTS }, (_, listIndex) =>
  Array.from({ length: MERGE_ROWS }, (_, rowIndex) => ({
    id: `${listIndex}-${rowIndex}`,
    total: (listIndex + 1) * 1_000_000 - rowIndex,
  })),
);
const mergeTiming = measure(() => mergeTopN(mergeLists, FRANCHISE_TOP_SALES, (row) => row.total));
const naiveTiming = measure(() =>
  mergeLists
    .flat()
    .sort((a, b) => b.total - a.total)
    .slice(0, FRANCHISE_TOP_SALES),
);
check(
  "penggabungan berbatas hasilnya sama dengan pengurutan penuh pada masukan besar",
  JSON.stringify(mergeTiming.value.map((row) => row.id)) ===
    JSON.stringify(naiveTiming.value.map((row) => row.id)),
  JSON.stringify(mergeTiming.value.map((row) => row.id)),
);  check(
    "penggabungan berbatas tidak lebih lambat dari pengurutan penuh (penjaga regresi)",
    mergeTiming.ms <= naiveTiming.ms + 5,
    `merge=${mergeTiming.ms.toFixed(3)}ms naive=${naiveTiming.ms.toFixed(3)}ms`,
  );
  check(
    "kedua pemanggil mengurutkan daftar per cabang sebelum menggabung (prasyarat mergeTopN)",
    (() => {
      const reports = readFileSync(new URL("../src/convex/reports.ts", import.meta.url), "utf8");
      const demo = readFileSync(new URL("../src/lib/store/demo.tsx", import.meta.url), "utf8");
      const sorted = /sort\(\(a, b\) => b\.total - a\.total\)/;
      const franchiseRegion = reports.slice(reports.indexOf("export const franchise = query({"));
      return sorted.test(franchiseRegion) && sorted.test(demo);
    })(),
    "ada pemanggil yang menggabung daftar tanpa mengurutkannya lebih dulu",
  );

console.log(
  `→ pengukuran: satu halaman ${PAGE_SIZE} baris dari ${HUGE_ROWS.toLocaleString("id-ID")} baris = ${pageTiming.ms.toFixed(3)} ms; ` +
    `memindai seluruhnya = ${fullScanTiming.ms.toFixed(3)} ms`,
);
console.log(
  `→ pengukuran: gabung ${MERGE_LISTS}×${MERGE_ROWS} baris jadi ${FRANCHISE_TOP_SALES} teratas = ${mergeTiming.ms.toFixed(3)} ms; ` +
    `gabung-semuanya lalu urutkan = ${naiveTiming.ms.toFixed(3)} ms`,
);

// --------------------------------------------------------- bentuk query backend
{
  const source = readFileSync(new URL("../src/convex/reports.ts", import.meta.url), "utf8");
  const start = source.indexOf("export const franchise = query({");
  check("fungsi laporan lintas cabang ada di reports.ts", start > 0, "tidak ditemukan");
  const body = source.slice(start);

  check(
    "laporan lintas cabang membaca per cabang dengan batas anggaran (bukan collect)",
    body.includes(".take(readLimit)") &&
      body.includes("outletReadLimit(budget)") &&
      !body.includes(".collect("),
    `take=${body.includes(".take(readLimit)")} collect=${body.includes(".collect(")}`,
  );
  check(
    "pembacaan baris memakai indeks (tenant, cabang, waktu) & urut terbaru dulu",
    body.includes('withIndex("by_tenant_store_created"') && body.includes('.order("desc")'),
    "indeks/urutan tidak sesuai",
  );
  check(
    "jendela cabang dibatasi satu dokumen lebih untuk mengetahui sisanya",
    body.includes("MAX_OUTLET_WINDOW + 1") && body.includes("beyondWindow"),
    "jendela cabang tidak dibatasi",
  );
  check(
    "laporan lintas cabang digerbang fitur & izin yang sama dengan laporan lain",
    body.includes('"scale.franchise"') && body.includes('"report.view"') && body.includes("requireFeature("),
    "gerbang fitur/izin tidak ada",
  );
  check(
    "pemotongan dilaporkan, bukan disembunyikan",
    body.includes("truncated: trimmed.truncated") &&
      body.includes("...report") &&
      body.includes("beyondWindow"),
    "tanda pemotongan tidak diteruskan",
  );
}

// -------------------------------------------------------- sinkronisasi katalog
check(
  "fitur skala franchise ada di katalog & hanya paket Enterprise yang memuatnya",
  typeof FEATURE_LABELS["scale.franchise"] === "string" &&
    PLANS.enterprise.features.includes("scale.franchise") &&
    !PLANS.professional.features.includes("scale.franchise") &&
    !PLANS.starter.features.includes("scale.franchise"),
  JSON.stringify({
    label: FEATURE_LABELS["scale.franchise"],
    enterprise: PLANS.enterprise.features.includes("scale.franchise"),
  }),
);

console.log(`${results.length}/${results.length} checks passed`);

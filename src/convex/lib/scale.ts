/**
 * Optimasi beban skala franchise (`scale.franchise`, Phase 5 / Dukungan khusus
 * & skala franchise) — aturan murni.
 *
 * Modul ini menjawab satu masalah nyata: laporan lintas cabang adalah satu-
 * satunya permintaan yang **tumbuh mengikuti ukuran pelanggan**, bukan mengikuti
 * ukuran halaman. Tenant satu toko bisa membaca seluruh riwayatnya tanpa
 * terasa; jaringan dengan 40 cabang akan menggandakan biaya baca 40 kali kalau
 * ditulis dengan cara yang sama.
 *
 * Tiga aturan di sini:
 *
 * 1. **Anggaran dibagi per cabang, bukan per tenant.** `queryBudgetFor()`
 *    menentukan berapa cabang yang diagregasi dan berapa baris terbaru yang
 *    dibaca **per cabang**; baris yang di luar anggaran tidak pernah dibaca dari
 *    database (di Convex lewat `.take(budget.rowsPerStore + 1)`), jadi biaya satu
 *    laporan tetap sama saat tenant tumbuh dari 3 ke 30 cabang.
 * 2. **Batasnya jujur, bukan diam-diam.** Setiap pemotongan meninggalkan tanda:
 *    `truncated` di laporan dan `truncated` di tiap cabang, plus
 *    `skippedOutlets` untuk cabang yang tidak diagregasi. Laporan yang menyembunyikan
 *    potongannya lebih berbahaya daripada laporan yang bilang "sebagian".
 * 3. **Gabungan produk teratas dibatasi `n`, bukan total.** `mergeTopN()`
 *    menggabungkan daftar terurut milik tiap cabang dengan penyisipan berbatas
 *    (memori O(n)), bukan dengan menggabungkan semua baris lalu mengurutkannya
 *    (memori O(total)) — jadi daftar "produk terlaris jaringan" tidak menahan
 *    ratusan ribu baris di memori hanya untuk mengambil delapan teratas.
 *
 * Angka-angka di sini **bukan janji performa**: yang bisa dibuktikan harness
 * adalah bentuk perhitungannya (O(n) memori, satu halaman per gilir, anggaran
 * dokumen) dan bahwa laporan tetap benar saat anggarannya tidak cukup.
 */

import type { PlanKey } from "./billing";

/** Banyak baris penjualan terbaru yang dibaca per cabang. */
export interface QueryBudget {
  /** Jumlah cabang yang diagregasi dalam satu laporan. */
  stores: number;
  /**
   * Baris penjualan **terbaru** yang dibaca per cabang. Query-nya meminta
   * `rowsPerStore + 1` supaya pemotongan bisa **diketahui**, bukan ditebak.
   */
  rowsPerStore: number;
  /** Baris terbaru untuk menghitung produk teratas, per cabang. */
  itemsPerStore: number;
  /** Produk teratas yang dibawa pulang laporan. */
  topProducts: number;
  /** Batas dokumen satu permintaan (`stores × rowsPerStore`). */
  maxRows: number;
}

/** Cabang maksimum yang pernah diagregasi, berapa pun besar jaringannya. */
export const MAX_OUTLET_WINDOW = 50;

/** Jendela baca per cabang mengecil saat jumlah cabang bertambah. */
export const ROWS_PER_STORE_TIERS: { maxStores: number; rows: number }[] = [
  { maxStores: 3, rows: 600 },
  { maxStores: 10, rows: 300 },
  { maxStores: 25, rows: 200 },
];

/** Baris per cabang untuk jaringan yang lebih besar dari tier terakhir. */
export const ROWS_PER_STORE_FLOOR = 150;

export const FRANCHISE_TOP_PRODUCTS = 8;
export const FRANCHISE_ITEMS_PER_STORE = 200;
/** Transaksi terbesar yang dibawa laporan lintas cabang. */
export const FRANCHISE_TOP_SALES = 5;

/** Anggaran halaman untuk daftar biasa (bukan laporan lintas cabang). */
export const PAGE_SIZE = 200;
export const MAX_PAGE_SIZE = 500;

export function queryBudgetFor(storeCount: number): QueryBudget {
  const count = Math.max(1, Math.trunc(storeCount));
  const tier = ROWS_PER_STORE_TIERS.find((row) => count <= row.maxStores);
  const rowsPerStore = tier ? tier.rows : ROWS_PER_STORE_FLOOR;
  const stores = Math.min(MAX_OUTLET_WINDOW, count);

  return {
    stores,
    rowsPerStore,
    itemsPerStore: FRANCHISE_ITEMS_PER_STORE,
    topProducts: FRANCHISE_TOP_PRODUCTS,
    maxRows: stores * rowsPerStore,
  };
}

/** Kalimat untuk halaman: "12 cabang × 300 baris = 3.600 dokumen per laporan". */
export function describeBudget(budget: QueryBudget): string {
  const rows = budget.maxRows.toLocaleString("id-ID");
  const perStore = budget.rowsPerStore.toLocaleString("id-ID");
  return `${budget.stores} cabang × ${perStore} baris terbaru = ${rows} dokumen maksimum per laporan.`;
}

// ------------------------------------------------------------------- halaman

export interface Page<T> {
  items: T[];
  /** Cursor giliran berikutnya, atau `null` kalau sudah habis. */
  nextCursor: number | null;
  hasMore: boolean;
}

export function resolvePageSize(value?: number): number {
  if (value === undefined || !Number.isFinite(value)) return PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(value)));
}

/**
 * Satu giliran halaman dari koleksi yang **sudah terurut**. Hanya `limit` baris
 * yang disentuh, jadi biayanya tidak bergantung pada panjang koleksi.
 */
export function pageWindow<T>(
  rows: readonly T[],
  cursor = 0,
  limit = PAGE_SIZE,
): Page<T> {
  const size = resolvePageSize(limit);
  const start = Math.max(0, Math.trunc(cursor));
  const items = rows.slice(start, start + size);
  const next = start + items.length;
  const hasMore = next < rows.length;
  return { items, nextCursor: hasMore ? next : null, hasMore };
}

// -------------------------------------------------------------- gabungan top-N

/**
 * Gabungkan daftar-daftar yang **masing-masing sudah terurut menurun** menurut
 * `score`, ambil `n` teratas.
 *
 * **Prasyarat (dan itu sebabnya cepat):** tiap daftar datang sudah terurut
 * menurun. Gabungannya lalu cukup mengambil kepala terbesar dari posisi yang
 * sedang menunjuk di tiap daftar, `n` kali. Kerjanya karenanya
 * `n × jumlah daftar`, **bukan** sebanyak seluruh baris: 40 cabang × 500 baris
 * yang digabung jadi 8 teratas hanya menyentuh ~320 baris, bukan 20.000 — dan
 * memorinya hanya `n` baris, bukan seluruh baris. Pemanggil (laporan lintas
 * cabang & store demo) mengurutkan daftar per cabang dulu; itulah kontraknya,
 * dan harness memeriksa kedua pemanggil memenuhinya.
 */
export function mergeTopN<T>(
  lists: readonly (readonly T[])[],
  n: number,
  score: (item: T) => number,
): T[] {
  const limit = Math.max(0, Math.trunc(n));
  if (limit === 0) return [];

  const sources = lists.filter((list) => list.length > 0);
  if (sources.length === 0) return [];

  const cursors = sources.map(() => 0);
  const out: T[] = [];

  while (out.length < limit) {
    let best = -1;
    for (let index = 0; index < sources.length; index += 1) {
      if (cursors[index] >= sources[index].length) continue;
      if (
        best === -1 ||
        score(sources[index][cursors[index]]) >
          score(sources[best][cursors[best]])
      ) {
        best = index;
      }
    }
    if (best === -1) break;
    out.push(sources[best][cursors[best]]);
    cursors[best] += 1;
  }

  return out;
}

// --------------------------------------------------------- rollup franchise

export interface FranchiseSaleRow {
  total: number;
  createdAt: number;
}

export interface FranchiseOutletInput {
  storeId: string;
  name: string;
  code: string;
  active: boolean;
  /** Baris penjualan **selesai** cabang ini pada jendela laporan. */
  sales: readonly FranchiseSaleRow[];
  /** Cabang ini masih punya baris di luar anggaran. */
  truncated?: boolean;
}

export interface FranchiseOutletRow {
  storeId: string;
  name: string;
  code: string;
  revenue: number;
  transactions: number;
  averageBasket: number;
  /** Pangsa omzet dalam persen bulat; seluruh baris berjumlah 100. */
  sharePct: number;
  /** Omzet cabang ini dihitung dari sebagian barisnya. */
  truncated: boolean;
}

export interface FranchiseTotals {
  revenue: number;
  transactions: number;
  averageBasket: number;
  outlets: number;
  activeOutlets: number;
  inactiveOutlets: number;
}

export interface FranchiseReport {
  outlets: FranchiseOutletRow[];
  totals: FranchiseTotals;
  /** Ada cabang yang datanya terpotong anggaran. */
  truncated: boolean;
  /** Cabang yang tidak diagregasi karena melewati `budget.stores`. */
  skippedOutlets: number;
  budget: QueryBudget;
  window: { from: number; to: number };
}

/**
 * Pangsa bulat yang **berjumlah 100** (metode sisa terbesar). Pembulatan
 * masing-masing baris menghasilkan 99% atau 101% secara rutin, dan laporan yang
 * jumlahnya tidak bulat membuat orang meragukan seluruh angkanya.
 */
function largestRemainderShares(values: readonly number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);

  const exact = values.map((value) => (value / total) * 100);
  const floors = exact.map((value) => Math.floor(value));
  let remaining = 100 - floors.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);

  for (const entry of order) {
    if (remaining <= 0) break;
    floors[entry.index] += 1;
    remaining -= 1;
  }
  return floors;
}

export function franchiseRollup(args: {
  outlets: readonly FranchiseOutletInput[];
  budget: QueryBudget;
  from: number;
  to: number;
}): FranchiseReport {
  const active = args.outlets.filter((outlet) => outlet.active);
  const inactive = args.outlets.length - active.length;

  // Cabang di luar anggaran tidak diagregasi — dan jumlahnya dilaporkan apa
  // adanya, bukan dibuang tanpa jejak.
  const withinBudget = active.slice(0, Math.max(0, args.budget.stores));
  const skippedOutlets = Math.max(0, active.length - withinBudget.length);

  const rows = withinBudget.map((outlet) => {
    const revenue = outlet.sales.reduce((sum, sale) => sum + sale.total, 0);
    const transactions = outlet.sales.length;
    return {
      storeId: outlet.storeId,
      name: outlet.name,
      code: outlet.code,
      revenue,
      transactions,
      averageBasket: transactions > 0 ? Math.round(revenue / transactions) : 0,
      truncated: outlet.truncated === true,
    };
  });

  const sorted = [...rows].sort(
    (a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "id"),
  );
  const shares = largestRemainderShares(sorted.map((row) => row.revenue));

  const outlets: FranchiseOutletRow[] = sorted.map((row, index) => ({
    ...row,
    sharePct: shares[index] ?? 0,
  }));

  const revenue = outlets.reduce((sum, row) => sum + row.revenue, 0);
  const transactions = outlets.reduce((sum, row) => sum + row.transactions, 0);

  return {
    outlets,
    totals: {
      revenue,
      transactions,
      averageBasket: transactions > 0 ? Math.round(revenue / transactions) : 0,
      outlets: args.outlets.length,
      activeOutlets: active.length,
      inactiveOutlets: inactive,
    },
    truncated: skippedOutlets > 0 || outlets.some((row) => row.truncated),
    skippedOutlets,
    budget: args.budget,
    window: { from: args.from, to: args.to },
  };
}

/**
 * Jendela baca untuk satu cabang: meminta satu baris lebih banyak dari anggaran
 * supaya pemotongan bisa **diketahui** (`truncated`), bukan ditebak dari
 * "jumlah baris == anggaran".
 */
export function outletReadLimit(budget: QueryBudget): number {
  return rowsForBudget(budget) + 1;
}

/** Baris per cabang, sudah dijaga minimal 1. */
function rowsForBudget(budget: QueryBudget): number {
  return Math.max(1, Math.trunc(budget.rowsPerStore));
}

/**
 * Bentuk data laporan untuk satu cabang dari baris yang dibaca server.
 * `truncated` benar kalau server menerima lebih banyak baris daripada anggaran —
 * kelebihannya dibuang di sini supaya angkanya tetap konsisten dengan anggaran.
 */
export function trimOutletRows(
  sales: readonly FranchiseSaleRow[],
  budget: QueryBudget,
): { sales: FranchiseSaleRow[]; truncated: boolean } {
  const limit = rowsForBudget(budget);
  if (sales.length <= limit) return { sales: [...sales], truncated: false };
  return { sales: sales.slice(0, limit), truncated: true };
}

/** Nama fitur yang digerbang — dipakai pesan galat supaya seragam. */
export const FRANCHISE_FEATURE_HINT = (planName: string): string =>
  `Laporan lintas cabang adalah bagian dari optimasi skala franchise (paket ${planName}).`;

/** Rencana agregasi yang dipakai halaman untuk menjelaskan batas bebannya. */
export function franchisePlanNote(
  planKey: PlanKey,
  storeCount: number,
): string {
  const budget = queryBudgetFor(storeCount);
  const suffix =
    budget.stores >= storeCount
      ? ""
      : ` Hanya ${budget.stores} cabang pertama yang diagregasi; sisanya dihitung pada giliran berikutnya.`;
  return `${planKey.toUpperCase()} · ${describeBudget(budget)}${suffix}`;
}

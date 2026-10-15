/**
 * Stock opname & audit selisih (`inventory.opname`, Phase 3).
 *
 * Gudang tanpa opname adalah gudang yang stoknya hanya dipercaya dari catatan.
 * Fitur ini menghitung ulang stok fisik per **lokasi** dan menyimpan selisihnya
 * sebagai bukti, dengan aturan yang dijaga di satu tempat:
 *
 * 1. **Hasil hitung yang menang, bukan catatan.** Saat posting, stok lokasi
 *    dibuat **sama persis** dengan hasil hitung (`delta = counted − saldo terbaru`),
 *    bukan ditambah selisih terhadap snapshot. Kalau ada penjualan di tengah
 *    penghitungan, angka fisik tetap benar dan tidak ada penjualan yang dihitung
 *    dua kali.
 * 2. **Snapshot dipakai sebagai patokan selisih**, bukan sebagai nilai yang
 *    ditulis: baris sesi menyimpan `systemQty` saat sesi dimulai, dan selisih yang
 *    ditampilkan adalah `counted − systemQty`. Itulah yang dibaca audit.
 * 3. **Baris yang belum dihitung tidak pernah dianggap nol.** Posting hanya
 *    menerapkan baris yang sudah dihitung; sisanya dibiarkan apa adanya. Menulis 0
 *    untuk baris yang belum dihitung akan menghapus stok hanya karena lupa mengisi.
 * 4. **Satu sesi terbuka per lokasi.** Dua orang menghitung lokasi yang sama
 *    dengan dua snapshot berbeda hanya menghasilkan selisih palsu.
 * 5. **Sesi selesai tidak bisa diubah lagi** — kalau salah, buat sesi baru.
 * 6. **Membuat sesi baru yang dibayar; menghitung & mempostingnya tidak.** Fisik
 *    sudah dihitung di rak: paket yang turun tidak boleh membuat hasil hitungan
 *    itu hilang.
 *
 * Semua jumlah integer, dan aturan ini murni (tanpa dependensi Convex) supaya
 * server, kedua store, halaman, dan harness memakai perhitungan yang sama.
 */

export const MAX_OPNAME_NOTE = 120;
/** Batas atas yang masuk akal untuk satu baris hitungan. */
export const MAX_COUNT_QTY = 1_000_000;
export const OPNAME_NUMBER_PREFIX = "OPN";

export type OpnameStatus = "draft" | "posted" | "cancelled";

export const OPNAME_STATUS_LABELS: Record<OpnameStatus, string> = {
  draft: "Berjalan",
  posted: "Selesai",
  cancelled: "Dibatalkan",
};

export interface Result<T> {
  ok: boolean;
  value?: T;
  reason?: string;
}

/** Bentuk minimal satu baris sesi opname yang dibutuhkan aturan murni. */
export interface OpnameLineLike {
  productId: string;
  name: string;
  sku?: string;
  unit?: string;
  /** Saldo sistem saat sesi dimulai — patokan selisih. */
  systemQty: number;
  /** Kosong = **belum dihitung** (bukan nol). */
  countedQty?: number;
  note?: string;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function opnameNumber(sequence: number): string {
  // Nomor dokumen tidak boleh berisi "NaN": urutan yang tidak masuk akal jatuh
  // ke 1 (nomor dokumen tetap terbaca, dan tabrakan nomor dijaga indeks ledger).
  const safe = Number.isFinite(sequence) ? Math.trunc(sequence) : 1;
  return `${OPNAME_NUMBER_PREFIX}-${String(Math.max(1, safe)).padStart(5, "0")}`;
}

/** Selisih satu baris, atau `undefined` kalau baris itu belum dihitung. */
export function lineVariance(line: OpnameLineLike): number | undefined {
  if (line.countedQty === undefined) return undefined;
  return line.countedQty - line.systemQty;
}

export function countedLines(lines: readonly OpnameLineLike[]): OpnameLineLike[] {
  return lines.filter((line) => line.countedQty !== undefined);
}

export function uncountedLines(lines: readonly OpnameLineLike[]): OpnameLineLike[] {
  return lines.filter((line) => line.countedQty === undefined);
}

export interface CountProgress {
  total: number;
  counted: number;
  remaining: number;
  percent: number;
}

export function countProgress(lines: readonly OpnameLineLike[]): CountProgress {
  const total = lines.length;
  const counted = countedLines(lines).length;
  return {
    total,
    counted,
    remaining: total - counted,
    percent: total === 0 ? 0 : Math.round((counted / total) * 100),
  };
}

export interface OpnameVariance {
  /** Baris yang sudah dihitung (satu-satunya yang diposting). */
  counted: number;
  /** Baris yang belum dihitung — sengaja tidak diubah saat posting. */
  uncounted: number;
  /** Baris yang hasil hitungnya sama dengan catatan. */
  matched: number;
  surplusLines: number;
  shortageLines: number;
  /** Unit berlebih (selisih positif) dan unit kurang (selisih negatif, positif). */
  surplusUnits: number;
  shortageUnits: number;
  /** Selisih bersih: positif = stok fisik lebih banyak dari catatan. */
  netUnits: number;
}

/** Ringkasan selisih dari snapshot — inilah angka yang dibaca audit. */
export function summariseVariance(lines: readonly OpnameLineLike[]): OpnameVariance {
  let counted = 0;
  let uncounted = 0;
  let matched = 0;
  let surplusLines = 0;
  let shortageLines = 0;
  let surplusUnits = 0;
  let shortageUnits = 0;

  for (const line of lines) {
    const variance = lineVariance(line);
    if (variance === undefined) {
      uncounted += 1;
      continue;
    }
    counted += 1;
    if (variance === 0) {
      matched += 1;
    } else if (variance > 0) {
      surplusLines += 1;
      surplusUnits += variance;
    } else {
      shortageLines += 1;
      shortageUnits += Math.abs(variance);
    }
  }

  return {
    counted,
    uncounted,
    matched,
    surplusLines,
    shortageLines,
    surplusUnits,
    shortageUnits,
    netUnits: surplusUnits - shortageUnits,
  };
}

/** Jumlah hasil hitung: integer, tidak negatif, dan tidak melebihi batas wajar. */
export function resolveCountValue(
  raw: number,
  options: { productName?: string } = {},
): Result<number> {
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.trunc(value) !== value) {
    return { ok: false, reason: "Jumlah hitungan harus bilangan bulat." };
  }
  if (value < 0) {
    return { ok: false, reason: "Jumlah hitungan tidak boleh negatif." };
  }
  if (value > MAX_COUNT_QTY) {
    return {
      ok: false,
      reason: `Jumlah hitungan${options.productName ? ` untuk ${options.productName}` : ""} melebihi batas wajar (${MAX_COUNT_QTY.toLocaleString("id-ID")}).`,
    };
  }
  return { ok: true, value };
}

export function resolveLineNote(raw?: string): Result<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  const note = collapse(raw);
  if (note.length > MAX_OPNAME_NOTE) {
    return { ok: false, reason: `Catatan baris maksimal ${MAX_OPNAME_NOTE} karakter.` };
  }
  return { ok: true, value: note === "" ? undefined : note };
}

export function resolveOpnameNote(raw?: string): Result<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  const note = collapse(raw);
  if (note.length > MAX_OPNAME_NOTE) {
    return { ok: false, reason: `Catatan sesi maksimal ${MAX_OPNAME_NOTE} karakter.` };
  }
  return { ok: true, value: note === "" ? undefined : note };
}

/**
 * Menulis hasil hitung satu baris. Baris yang bukan bagian sesi ini ditolak —
 * supaya hasil hitung tidak bisa "nyasar" ke sesi lokasi lain.
 */
export function setCountedQty(
  lines: readonly OpnameLineLike[],
  input: { productId: string; countedQty?: number; note?: string },
): Result<OpnameLineLike[]> {
  const target = lines.find((line) => line.productId === input.productId);
  if (!target) {
    return {
      ok: false,
      reason: "Produk itu bukan bagian dari sesi opname ini.",
    };
  }

  const note = resolveLineNote(input.note);
  if (!note.ok) return { ok: false, reason: note.reason };

  if (input.countedQty === undefined) {
    // Menghapus hasil hitung: baris kembali "belum dihitung".
    return {
      ok: true,
      value: lines.map((line) =>
        line.productId === input.productId
          ? { ...line, countedQty: undefined, note: note.value }
          : line,
      ),
    };
  }

  const resolved = resolveCountValue(input.countedQty, { productName: target.name });
  if (!resolved.ok || resolved.value === undefined) {
    return { ok: false, reason: resolved.reason };
  }

  return {
    ok: true,
    value: lines.map((line) =>
      line.productId === input.productId
        ? { ...line, countedQty: resolved.value, note: note.value }
        : line,
    ),
  };
}

export function canEditOpname(status: OpnameStatus): Result<true> {
  if (status === "posted") {
    return { ok: false, reason: "Sesi opname ini sudah selesai; buat sesi baru untuk menghitung ulang." };
  }
  if (status === "cancelled") {
    return { ok: false, reason: "Sesi opname ini sudah dibatalkan." };
  }
  return { ok: true, value: true };
}

/**
 * Sesi bisa diposting kalau masih berjalan dan **ada** baris yang sudah dihitung.
 * Baris yang belum dihitung tidak pernah dianggap nol, jadi tidak ada syarat
 * "semua baris harus dihitung" — itu yang membuat hitung sebagian (cycle count)
 * tetap berguna.
 */
export function canPostOpname(session: {
  status: OpnameStatus;
  lines: readonly OpnameLineLike[];
}): Result<true> {
  const editable = canEditOpname(session.status);
  if (!editable.ok) return editable;
  if (session.lines.length === 0) {
    return { ok: false, reason: "Sesi opname ini tidak punya baris untuk dihitung." };
  }
  if (countedLines(session.lines).length === 0) {
    return {
      ok: false,
      reason: "Belum ada satu baris pun yang dihitung; isi hasil hitung dulu.",
    };
  }
  return { ok: true, value: true };
}

export function canCancelOpname(status: OpnameStatus): Result<true> {
  const editable = canEditOpname(status);
  if (!editable.ok) return editable;
  return { ok: true, value: true };
}

export interface OpnameMovement {
  productId: string;
  name: string;
  systemQty: number;
  /** Saldo lokasi saat posting — dipakai untuk menghitung delta. */
  currentQty: number;
  countedQty: number;
  /** `countedQty − currentQty`; 0 berarti tidak ada gerakan yang dicatat. */
  delta: number;
}

export interface OpnamePostPlan {
  movements: OpnameMovement[];
  /** Baris yang dihitung dan stoknya sudah sama dengan catatan (tanpa gerakan). */
  unchanged: number;
  /** Total unit yang bertambah (selisih positif terhadap saldo saat posting). */
  addedUnits: number;
  /** Total unit yang berkurang (selisih negatif). */
  removedUnits: number;
  /** Selisih bersih terhadap saldo saat posting. */
  netUnits: number;
}

/**
 * Rencana posting: untuk setiap baris yang sudah dihitung, hitung delta terhadap
 * **saldo terbaru** lokasi itu (bukan terhadap snapshot), sehingga stok lokasi
 * berakhir sama persis dengan hasil hitung fisik.
 */
export function planOpnamePost(
  lines: readonly OpnameLineLike[],
  currentQtyByProduct: Record<string, number> | Map<string, number>,
): OpnamePostPlan {
  const current = (productId: string): number => {
    const value =
      currentQtyByProduct instanceof Map
        ? currentQtyByProduct.get(productId)
        : currentQtyByProduct[productId];
    return Math.trunc(Number(value ?? 0)) || 0;
  };

  const movements: OpnameMovement[] = [];
  let unchanged = 0;
  let addedUnits = 0;
  let removedUnits = 0;

  for (const line of countedLines(lines)) {
    const countedQty = line.countedQty as number;
    const currentQty = current(line.productId);
    const delta = countedQty - currentQty;
    if (delta === 0) {
      unchanged += 1;
      continue;
    }
    movements.push({
      productId: line.productId,
      name: line.name,
      systemQty: line.systemQty,
      currentQty,
      countedQty,
      delta,
    });
    if (delta > 0) addedUnits += delta;
    else removedUnits += Math.abs(delta);
  }

  return {
    movements,
    unchanged,
    addedUnits,
    removedUnits,
    netUnits: addedUnits - removedUnits,
  };
}

export interface OpnameLocationLike {
  id: string;
  name: string;
}

/**
 * Memulai sesi baru. Dua hal yang dijaga: lokasi tidak boleh sedang punya sesi
 * terbuka, dan lokasinya harus punya sesuatu untuk dihitung.
 */
export function resolveOpnameStart(args: {
  location: OpnameLocationLike;
  /** Sesi berstatus `draft` yang sudah ada (lokasi mana saja). */
  openSessions: { number: string; locationId: string }[];
  lines: readonly OpnameLineLike[];
}): Result<{ lines: OpnameLineLike[] }> {
  const clash = args.openSessions.find((session) => session.locationId === args.location.id);
  if (clash) {
    return {
      ok: false,
      reason: `Lokasi ${args.location.name} masih punya sesi opname ${clash.number} yang belum selesai; selesaikan atau batalkan dulu.`,
    };
  }
  if (args.lines.length === 0) {
    return {
      ok: false,
      reason: `Belum ada produk berstok untuk dihitung di ${args.location.name}.`,
    };
  }
  return { ok: true, value: { lines: args.lines.map((line) => ({ ...line })) } };
}

/** Snapshot baris sesi dari daftar produk + saldo lokasinya. */
export function buildOpnameLines(
  products: readonly { id: string; name: string; sku: string; unit?: string }[],
  qtyFor: (productId: string) => number,
): OpnameLineLike[] {
  return products.map((product) => ({
    productId: product.id,
    name: product.name,
    sku: product.sku,
    unit: product.unit ?? "PCS",
    systemQty: Math.trunc(Number(qtyFor(product.id)) || 0),
  }));
}

export interface OpnameSessionSummary {
  openCount: number;
  postedCount: number;
  cancelledCount: number;
  /** Baris yang belum dihitung pada sesi yang masih berjalan. */
  remainingLines: number;
  /** Selisih bersih (unit) dari sesi berjalan, dihitung dari snapshot. */
  runningNetUnits: number;
}

export function summariseOpnameSessions(
  sessions: readonly { status: OpnameStatus; lines: readonly OpnameLineLike[] }[],
): OpnameSessionSummary {
  let openCount = 0;
  let postedCount = 0;
  let cancelledCount = 0;
  let remainingLines = 0;
  let runningNetUnits = 0;

  for (const session of sessions) {
    if (session.status === "draft") {
      openCount += 1;
      const variance = summariseVariance(session.lines);
      remainingLines += variance.uncounted;
      runningNetUnits += variance.netUnits;
    } else if (session.status === "posted") {
      postedCount += 1;
    } else {
      cancelledCount += 1;
    }
  }

  return { openCount, postedCount, cancelledCount, remainingLines, runningNetUnits };
}

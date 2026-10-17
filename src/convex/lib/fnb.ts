/**
 * Aturan alur F&B (Phase 2): denah meja (`pos.table`) dan antrean dapur
 * (`pos.kds`).
 *
 * Murni dan tanpa dependensi Convex, supaya backend, klien, dan harness memakai
 * aturan yang sama — denah meja tidak boleh "benar" di UI dan salah di server.
 *
 * Keputusan model yang penting: **status meja tidak disimpan**. Meja terisi
 * kalau ada **tiket dapur** yang menunjuk meja itu (`isKitchenTicket`) — yaitu
 * pesanan tertahan yang dikirim lebih dulu, dan penjualan yang **sudah lunas**
 * tetapi tiketnya belum ditandai beres oleh dapur. Dengan begitu tidak ada dua
 * sumber kebenaran yang bisa berbeda: begitu dapur menekan **Selesai** (atau
 * pesanannya dibatalkan), mejanya otomatis kosong lagi — tanpa patch tambahan
 * yang bisa terlewat.
 *
 * Akibatnya memang disengaja: **meja yang pesanannya sudah dibayar tetap
 * terkunci** sampai dapur selesai. Meja itu masih dipakai tamunya — makanannya
 * belum datang — jadi menempatkan pesanan lain di situ akan mencampur dua
 * tagihan di satu meja. Yang menyatukan aturan itu di server (`pos.createSale`),
 * denah kasir, dan denah layar dapur adalah `tableHolders` di bawah.
 *
 * Antrean dapur punya **dua sumber tiket**, dan keduanya sama-sama "pesanan yang
 * harus disiapkan dapur":
 *
 *  1. pesanan tertahan (`status: "held"`) — dikirim kasir lebih dulu, uangnya
 *     menyusul (`finalizeHeldSale`), dan termasuk pesanan QR meja yang sudah
 *     lunas,
 *  2. penjualan yang **sudah lunas** (`status: "completed"`) dengan
 *     `kitchenFiredAt` terisi — tiket yang lahir **pada momen pembayarannya**,
 *     supaya kasir tidak perlu menekan tombol kedua setelah uangnya masuk.
 *
 * Bedanya hanya di tombol **Selesai**-nya: tiket tertahan diselesaikan (stok
 * bergerak di situ), sedangkan tiket lunas hanya ditandai selesai
 * (`kitchenDoneAt`) karena stoknya sudah bergerak saat penjualannya dicatat.
 * Penandanya `settled` di `KdsTicket`, jadi layar dapur tidak perlu menebak.
 */

import {
  vaBankLabel,
  type DigitalMethod,
  type VaBank,
} from "./digitalPayment";

export const DEFAULT_TABLE_ZONE = "Utama";
export const DEFAULT_TABLE_SEATS = 4;
export const MIN_TABLE_SEATS = 1;
export const MAX_TABLE_SEATS = 24;
export const MAX_TABLE_NAME_LENGTH = 16;
export const MAX_TABLE_ZONE_LENGTH = 24;

/** Batas satu kali impor denah: cukup untuk satu cabang, tidak untuk spam. */
export const MAX_TABLE_IMPORT_ROWS = 40;

/** Contoh yang dipakai UI & dokumentasi supaya bentuk barisnya satu versi. */
export const TABLE_IMPORT_EXAMPLE = "A1, 4, Utama\nA2, 2, Utama\nB1, 6, Teras";

/** Menit tunggu yang layak ditandai "lama" di layar dapur. */
export const KDS_ATTENTION_MINUTES = 15;

export interface TableRef {
  id: string;
  name: string;
  zone: string;
  seats: number;
  active: boolean;
  /**
   * Token kode QR meja (`mj_…`), kalau kartu menunya sudah pernah dicetak.
   * Kosong = meja ini belum punya kartu QR yang bisa dipindai tamu.
   */
  menuToken?: string;
  /**
   * Urutan tampil meja di denah (1 = paling depan). Diisi saat meja dibuat,
   * digeser, atau diimpor; meja lama yang belum punya urutan diperlakukan
   * seperti meja yang belum pernah diurutkan (`sortTablesByOrder`).
   */
  sortOrder?: number;
}

/** Satu tiket dapur yang sedang menempati sebuah meja. */
export interface OpenOrderRef {
  id: string;
  number: string;
  createdAt: number;
  tableId?: string;
  /**
   * `true` = penjualannya **sudah lunas** dan tiketnya hanya menunggu dapur
   * menekan Selesai. Dipakai memilih kalimat penolakan yang benar di
   * `seatTable`: "tunggu dapur" bukan "batalkan dulu".
   */
  settled?: boolean;
}

export interface TableInput {
  name: string;
  seats: number;
  zone?: string;
}

export interface TableInputResult {
  ok: boolean;
  name: string;
  seats: number;
  zone: string;
  reason?: string;
}

/**
 * Nama meja dinormalkan (spasi rapat, tanpa spasi di ujung) alih-alih ditolak,
 * karena kasir biasanya mengetik "  A1  " atau "meja 2" — yang penting hasilnya
 * satu bentuk kanonik sehingga pencarian duplikat bekerja.
 */
export function normalizeTableName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function normalizeZone(raw?: string | null): string {
  const value = (raw ?? "").trim().replace(/\s+/g, " ");
  return value.length > 0 ? value : DEFAULT_TABLE_ZONE;
}

/** Huruf, angka, spasi, dan tanda `- . /` — cukup untuk "A1", "Teras 2", "B-03". */
const TABLE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 \-./]*$/;

export function resolveTableInput(input: TableInput): TableInputResult {
  const name = normalizeTableName(input.name ?? "");
  const zone = normalizeZone(input.zone);
  const seats = Math.trunc(Number(input.seats));

  const fail = (reason: string): TableInputResult => ({
    ok: false,
    name,
    seats: Number.isFinite(seats) ? seats : 0,
    zone,
    reason,
  });

  if (name.length === 0) return fail("Nama meja wajib diisi.");
  if (name.length > MAX_TABLE_NAME_LENGTH) {
    return fail(`Nama meja maksimal ${MAX_TABLE_NAME_LENGTH} karakter.`);
  }
  if (!TABLE_NAME_PATTERN.test(name)) {
    return fail("Nama meja hanya boleh huruf, angka, spasi, dan tanda - . /");
  }
  if (!Number.isFinite(seats) || seats < MIN_TABLE_SEATS || seats > MAX_TABLE_SEATS) {
    return fail(`Jumlah kursi harus bilangan bulat ${MIN_TABLE_SEATS}–${MAX_TABLE_SEATS}.`);
  }
  if (zone.length > MAX_TABLE_ZONE_LENGTH) {
    return fail(`Zona maksimal ${MAX_TABLE_ZONE_LENGTH} karakter.`);
  }

  return { ok: true, name, seats, zone };
}

/**
 * Nama meja harus unik per toko (perbandingan tanpa peka huruf besar-kecil),
 * supaya dua meja tidak tampil sama di denah. `exceptId` untuk penggantian nama.
 */
export function tableNameTaken(
  tables: readonly TableRef[],
  name: string,
  exceptId?: string,
): boolean {
  const target = normalizeTableName(name).toLowerCase();
  return tables.some(
    (table) => table.id !== exceptId && table.name.toLowerCase() === target,
  );
}

export type TableStatus = "free" | "occupied" | "inactive";

export interface TableState extends TableRef {
  status: TableStatus;
  /** Pesanan yang menempati meja ini, kalau ada. */
  orderId?: string;
  orderNumber?: string;
  waitingMinutes?: number;
  /**
   * `true` = yang menempati meja ini sudah dibayar dan tinggal menunggu dapur.
   * Denah memakainya untuk menyebut apa yang sedang ditunggu (dan kenapa
   * mejanya belum boleh dipakai lagi).
   */
  paid?: boolean;
}

export function waitingMinutes(createdAt: number, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - createdAt) / 60_000));
}

export function isTicketLate(minutes: number): boolean {
  return minutes >= KDS_ATTENTION_MINUTES;
}

/**
 * Denah meja: setiap meja aktif yang punya **tiket dapur** berstatus terisi.
 * Daftar tiketnya disiapkan pemanggil (`ticketTableHolders` untuk antrean dapur,
 * `tableHolders` untuk penjualan tersimpan), jadi denah kasir dan layar dapur
 * tidak mungkin memakai daftar yang berbeda. Meja nonaktif tetap dilaporkan
 * (dengan status `inactive`) supaya denah tidak berbohong saat meja sedang
 * diperbaiki; UI tinggal memfilternya.
 */
export function tableStates(
  tables: readonly TableRef[],
  orders: readonly OpenOrderRef[],
  now: number = Date.now(),
): TableState[] {
  const byTable = new Map<string, OpenOrderRef>();
  for (const order of orders) {
    if (!order.tableId) continue;
    const current = byTable.get(order.tableId);
    // Pesanan paling lama yang menang, kalau sampai ada dua (data lama).
    if (!current || order.createdAt < current.createdAt) byTable.set(order.tableId, order);
  }

  return tables.map((table) => {
    if (!table.active) return { ...table, status: "inactive" as TableStatus };
    const order = byTable.get(table.id);
    if (!order) return { ...table, status: "free" as TableStatus };
    return {
      ...table,
      status: "occupied" as TableStatus,
      orderId: order.id,
      orderNumber: order.number,
      waitingMinutes: waitingMinutes(order.createdAt, now),
      paid: order.settled === true,
    };
  });
}

/** Penjualan yang bisa menempati sebuah meja — seperlunya untuk `tableHolders`. */
export interface TableHolderSale extends KitchenSaleRef {
  id: string;
  number: string;
  createdAt: number;
  tableId?: string;
}

/**
 * Meja mana yang sedang ditempati, dari **penjualan** yang tersimpan.
 *
 * Satu tempat untuk seluruh pemakaian, supaya "meja terisi" tidak pernah punya
 * dua arti: pesanan tertahan (uang belum masuk) dan penjualan lunas yang masih
 * di dapur (`isKitchenTicket`) sama-sama menahan mejanya, sedangkan penjualan
 * yang **belum** pernah sampai ke dapur (workspace tanpa layar dapur) tidak.
 * Dipakai `pos.createSale` (menolak meja yang masih terisi) dan store demo.
 */
export function tableHolders(sales: readonly TableHolderSale[]): OpenOrderRef[] {
  return sales
    .filter((sale) => Boolean(sale.tableId) && isKitchenTicket(sale))
    .map((sale) => ({
      id: sale.id,
      number: sale.number,
      createdAt: sale.createdAt,
      tableId: sale.tableId,
      settled: sale.status !== "held",
    }));
}

/**
 * Versi yang sama untuk **tiket dapur** yang sudah dihitung (`kdsTickets`):
 * denah kasir dan denah layar dapur membacanya dari antrean yang sama, jadi
 * meja yang terkunci di kasir tidak mungkin tampak kosong di dapur (dan
 * sebaliknya).
 */
export function ticketTableHolders(tickets: readonly KdsTicket[]): OpenOrderRef[] {
  return tickets
    .filter((ticket) => Boolean(ticket.tableId))
    .map((ticket) => ({
      id: ticket.saleId,
      number: ticket.number,
      createdAt: ticket.createdAt,
      tableId: ticket.tableId,
      settled: ticket.settled,
    }));
}

export type SeatResult =
  | { ok: true; table: TableRef }
  | { ok: false; reason: string };

/**
 * Satu kalimat penolakan untuk semua jalan yang menemukan meja masih terisi:
 * menempatkan pesanan baru (`seatTable`), menonaktifkan meja, dan menamai ulang
 * meja yang sedang dipakai.
 *
 * Dua keadaannya berbeda dan kalimatnya harus berbeda juga: tiket yang **sudah
 * dibayar** tinggal menunggu dapur (tidak ada yang perlu dibatalkan kasir),
 * sedangkan pesanan tertahan memang masih bisa diselesaikan atau dibatalkan.
 * Satu tempat supaya denah kasir, layar dapur, dan kalimat penolakan server tidak
 * pernah berbeda.
 */
export function tableOccupiedReason(tableName: string, open: OpenOrderRef): string {
  return open.settled
    ? `Meja ${tableName} masih terisi pesanan ${open.number} yang sudah dibayar. Tunggu dapur menekan Selesai dulu — meja itu dipakai tamunya sampai pesanannya beres.`
    : `Meja ${tableName} masih terisi pesanan ${open.number}. Selesaikan atau batalkan dulu.`;
}

/**
 * Boleh tidaknya menempatkan pesanan baru di sebuah meja. Satu meja hanya boleh
 * punya satu pesanan terbuka — tanpa aturan ini, dua kasir bisa mengirim dua
 * pesanan ke meja yang sama dan tagihannya mustahil dipisahkan lagi.
 */
export function seatTable(
  tables: readonly TableRef[],
  orders: readonly OpenOrderRef[],
  tableId: string,
): SeatResult {
  const table = tables.find((candidate) => candidate.id === tableId);
  if (!table) return { ok: false, reason: "Meja tidak dikenal untuk toko ini." };
  if (!table.active) return { ok: false, reason: `Meja ${table.name} sedang tidak aktif.` };

  const open = orders.find((order) => order.tableId === tableId);
  if (open) return { ok: false, reason: tableOccupiedReason(table.name, open) };
  return { ok: true, table };
}

/**
 * Pemakaian sebuah meja — dibaca **sebelum** menghapusnya.
 *
 * Meja adalah konfigurasi lantai, tetapi begitu ia dipakai ia menjadi bagian
 * riwayat: penjualan menempel ke mejanya, dan tamu bisa masih memegang tagihan
 * yang belum dibayar. Yang dipakai memutuskan bukan "ada datanya atau tidak",
 * melainkan "meja ini masih dipakai atau sudah jadi riwayat".
 */
export interface TableUsage {
  /** Pesanan tertahan (belum selesai) yang menempati meja ini. */
  openOrders: number;
  /** Nomor pesanan terbuka pertama, untuk kalimat penolakan. */
  openOrderNumber?: string;
  /** Penjualan yang pernah menunjuk meja ini — riwayat yang harus tetap terbaca. */
  sales: number;
  /** Pesanan QR tamu yang masih menunggu pembayaran (masih bisa dibayar). */
  pendingGuestOrders: number;
}

export interface TableDeletionCheck {
  canDelete: boolean;
  /** Semua hal yang menghalangi, satu kalimat per hal. */
  blockers: string[];
  /** Satu kalimat ringkas untuk dialog/hasil. */
  sentence: string;
}

/**
 * Boleh tidaknya sebuah meja dihapus dari denah.
 *
 * Tiga pagar yang sengaja, dan semuanya **bukan** soal jumlah kursi:
 *
 *  1. **Masih terisi** — pesanan terbuka kehilangan mejanya di layar dapur.
 *  2. **Masih ada tagihan tamu yang menunggu dibayar** — tamu bisa membayar
 *     kapan saja; menghapus mejanya akan membuat uang masuk tanpa meja.
 *  3. **Sudah punya riwayat penjualan** — jawabannya menonaktifkan, bukan
 *     menghapus riwayat orang lain (pola yang sama dengan hapus produk).
 *
 * Meja yang memang belum pernah dipakai aman dihapus — itulah satu-satunya yang
 * layak dihapus, mis. meja yang barusan salah ditambahkan.
 */
export function tableDeletionCheck(
  tableName: string,
  usage: TableUsage,
): TableDeletionCheck {
  const blockers: string[] = [];

  if (usage.openOrders > 0) {
    blockers.push(
      `Meja ${tableName} masih terisi pesanan ${
        usage.openOrderNumber ?? "(tanpa nomor)"
      }. Selesaikan atau batalkan dulu.`,
    );
  }
  if (usage.pendingGuestOrders > 0) {
    blockers.push(
      `Meja ${tableName} masih punya pesanan QR yang menunggu pembayaran. Batalkan pesanannya dulu — tamunya juga bisa membatalkannya sendiri dari ponselnya.`,
    );
  }
  if (usage.sales > 0) {
    blockers.push(
      `Meja ${tableName} sudah dipakai ${usage.sales} penjualan; riwayatnya harus tetap terbaca, jadi nonaktifkan saja meja ini alih-alih menghapusnya.`,
    );
  }

  return {
    canDelete: blockers.length === 0,
    blockers,
    sentence:
      blockers.length === 0
        ? `Meja ${tableName} belum pernah dipakai — aman dihapus dari denah.`
        : blockers[0],
  };
}

// ------------------------------------------------------- urutan denah meja

/**
 * Urutan tampil denah meja.
 *
 * Meja punya **satu urutan eksplisit** (`sortOrder`), bukan urutan yang lahir
 * dari nama atau zona: "A1, A2, B1" tidak selalu urutan yang diinginkan pemilik
 * (mis. meja teras yang ingin ditampilkan paling depan), dan urutan yang
 * diturunkan dari nama akan berubah sendiri setiap kali ada meja baru dinamai di
 * antara dua meja lama. Meja yang belum punya urutan (data lama) tetap
 * ditampilkan dengan aturan lama — zona dulu, lalu nama — dan begitu denahnya
 * digeser atau diimpor, urutannya menjadi eksplisit untuk seluruh toko.
 */
export function sortTablesByOrder<T extends TableRef>(tables: readonly T[]): T[] {
  return [...tables].sort((a, b) => {
    const orderA = a.sortOrder ?? Number.POSITIVE_INFINITY;
    const orderB = b.sortOrder ?? Number.POSITIVE_INFINITY;
    if (orderA !== orderB) return orderA - orderB;
    return (
      a.zone.localeCompare(b.zone, "id") || a.name.localeCompare(b.name, "id")
    );
  });
}

/** Urutan yang diberikan ke meja yang baru ditambahkan: selalu di paling akhir. */
export function nextTableSortOrder(tables: readonly TableRef[]): number {
  const highest = tables.reduce(
    (max, table) => Math.max(max, table.sortOrder ?? 0),
    0,
  );
  return highest + 1;
}

/** Satu baris urutan yang perlu disimpan: `{ id, sortOrder }`. */
export interface TableOrderMove {
  id: string;
  sortOrder: number;
}

export type TableMoveResult =
  | { ok: true; moves: TableOrderMove[] }
  | { ok: false; reason: string };

/**
 * Menggeser satu meja **satu langkah** ke depan/belakang di denah.
 *
 * Hasilnya adalah urutan baru untuk **seluruh** meja (dinomori ulang 1…n), bukan
 * hanya dua baris yang bertukar: denah yang urutannya berlubang (`1, 2, 5, 7`)
 * akan terus bercelah kalau hanya ditukar, dan urutan yang rapat membuat "geser
 * satu langkah" punya arti yang sama untuk semua orang. Pemanggil tinggal
 * menyimpan baris yang nilainya benar-benar berubah.
 */
export function planTableMove(
  tables: readonly TableRef[],
  tableId: string,
  step: -1 | 1,
): TableMoveResult {
  const ordered = sortTablesByOrder(tables);
  const index = ordered.findIndex((table) => table.id === tableId);
  if (index < 0) return { ok: false, reason: "Meja tidak ditemukan di denah ini." };

  const target = index + step;
  const table = ordered[index];
  if (target < 0) {
    return { ok: false, reason: `Meja ${table.name} sudah paling awal di denah.` };
  }
  if (target >= ordered.length) {
    return { ok: false, reason: `Meja ${table.name} sudah paling akhir di denah.` };
  }

  const next = [...ordered];
  next[index] = ordered[target];
  next[target] = table;

  return {
    ok: true,
    moves: next.map((row, position) => ({ id: row.id, sortOrder: position + 1 })),
  };
}

// ------------------------------------------------------------- impor denah

export interface TableImportPlan {
  ok: true;
  /** Meja yang akan dibuat, **dalam urutan penulisannya** di teks impor. */
  tables: TableInput[];
  /** Baris yang benar-benar dibaca (komentar & baris kosong tidak dihitung). */
  rows: number;
}

export type TableImportResult = TableImportPlan | { ok: false; reason: string };

/**
 * Memisahkan satu baris impor menjadi kolomnya.
 *
 * Pemisahnya koma, titik koma, atau tab — **bukan spasi**, karena nama meja boleh
 * memuat spasi ("Teras 2"). Baris yang tidak punya pemisah sama sekali dibaca
 * sebagai nama saja (`A1`).
 */
export function splitTableImportRow(row: string): string[] {
  return row
    .split(/[,;\t]/)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

/**
 * Rencana impor denah dari teks: satu meja per baris (`Nama, kursi, zona`).
 *
 * **Semua atau tidak sama sekali.** Satu baris yang salah membatalkan seluruh
 * impor dan menyebut nomor barisnya, karena denah yang keburu terisi separuh
 * jauh lebih membingungkan daripada perintah yang ditolak: pemilik tidak bisa
 * menebak baris mana yang sudah masuk. Yang diperiksa per baris adalah aturan
 * yang sama dengan `tables.create` (`resolveTableInput`), ditambah dua pagar
 * yang khas impor: **nama tidak boleh kembar di dalam batch**, dan nama yang
 * sudah ada di denah ditolak lebih awal — bukan setelah separuh meja dibuat.
 *
 * Kolom kursi boleh dilewati (`A1` saja = 4 kursi), dan kolom kedua yang bukan
 * angka dibaca sebagai zona (`A1, Teras`), supaya bentuk yang paling wajar
 * diketik orang tetap bekerja tanpa harus menghafal urutan kolomnya.
 */
export function planTableImport(
  existing: readonly TableRef[],
  text: string,
): TableImportResult {
  const lines = (text ?? "").split(/\r?\n/);
  const rows: { line: number; cells: string[] }[] = [];

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) return;
    rows.push({ line: index + 1, cells: splitTableImportRow(line) });
  });

  if (rows.length === 0) {
    return { ok: false, reason: "Belum ada baris meja yang bisa dibaca." };
  }
  if (rows.length > MAX_TABLE_IMPORT_ROWS) {
    return {
      ok: false,
      reason: `Sekali impor maksimal ${MAX_TABLE_IMPORT_ROWS} meja (terbaca ${rows.length} baris).`,
    };
  }

  const parsed: TableInput[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const [name = "", second = "", third = ""] = row.cells;
    const secondIsSeats = second.length > 0 && /^\d+([.,]\d+)?$/.test(second);
    const resolved = resolveTableInput({
      name,
      seats: secondIsSeats ? Number(second.replace(",", ".")) : DEFAULT_TABLE_SEATS,
      zone: secondIsSeats ? third : second || third,
    });
    if (!resolved.ok) {
      return { ok: false, reason: `Baris ${row.line}: ${resolved.reason}` };
    }

    const key = resolved.name.toLowerCase();
    if (seen.has(key)) {
      return {
        ok: false,
        reason: `Baris ${row.line}: meja ${resolved.name} ditulis dua kali di impor ini.`,
      };
    }
    if (tableNameTaken(existing, resolved.name)) {
      return {
        ok: false,
        reason: `Baris ${row.line}: meja ${resolved.name} sudah ada di denah ini.`,
      };
    }

    seen.add(key);
    parsed.push({
      name: resolved.name,
      seats: resolved.seats,
      zone: resolved.zone,
    });
  }

  return { ok: true, tables: parsed, rows: parsed.length };
}

export interface KdsTicketItem {
  name: string;
  quantity: number;
  /**
   * Label modifier item (`pos.modifier`), mis. `["Pedas: 3", "Topping: Telur"]`.
   * Dapur perlu melihatnya di kartu tiket, bukan hanya di struk.
   */
  modifiers?: string[];
}

export interface KdsTicket {
  saleId: string;
  number: string;
  tableId?: string;
  /** Nama meja, kalau pesanannya memang menempel ke meja. */
  tableName?: string;
  createdAt: number;
  waitingMinutes: number;
  late: boolean;
  itemCount: number;
  items: KdsTicketItem[];
  /**
   * `true` = penjualannya **sudah lunas** (tiket lahir dari pembayaran di kasir),
   * jadi menekan **Selesai** hanya menandai tiketnya beres. `false` = pesanan
   * tertahan: menekan Selesai yang menyelesaikan penjualannya (stok bergerak).
   */
  settled: boolean;
  /**
   * Penanda pembayaran tiket lunas: `Lunas Tunai · diterima dapur pukul 13:42`.
   * `null` untuk pesanan tertahan — uangnya belum masuk di situ.
   */
  paidLabel: string | null;
}

/** Satu pesanan yang masuk antrean dapur, apa pun sumber tiketnya. */
export interface KdsOrderRef extends OpenOrderRef {
  items: readonly KdsTicketItem[];
  /** Penjualannya sudah lunas (`status: "completed"`), bukan pesanan tertahan. */
  settled?: boolean;
  /** Label pembayarannya, dihitung `ticketPaidLabel` untuk tiket yang lunas. */
  paidLabel?: string | null;
}

/**
 * Antrean dapur: pesanan terbuka, **paling lama menunggu di depan** — urutan itu
 * yang penting bagi dapur, bukan urutan nomor struk. Nama meja disalin ke tiket
 * supaya layar dapur tetap terbaca kalau mejanya kemudian diubah namanya.
 */
export function kdsQueue(
  orders: readonly KdsOrderRef[],
  tables: readonly TableRef[],
  now: number = Date.now(),
): KdsTicket[] {
  const nameById = new Map(tables.map((table) => [table.id, table.name]));

  return [...orders]
    .sort((a, b) => a.createdAt - b.createdAt || a.number.localeCompare(b.number))
    .map((order) => {
      const minutes = waitingMinutes(order.createdAt, now);
      const settled = order.settled ?? false;
      return {
        saleId: order.id,
        number: order.number,
        tableId: order.tableId,
        tableName: order.tableId ? nameById.get(order.tableId) : undefined,
        createdAt: order.createdAt,
        waitingMinutes: minutes,
        late: isTicketLate(minutes),
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        items: [...order.items],
        settled,
        paidLabel: settled ? (order.paidLabel ?? null) : null,
      };
    });
}

/**
 * Bentuk penjualan yang menentukan apakah ia sedang menunggu di dapur. Dipakai
 * server **dan** store demo supaya daftar tiketnya tidak pernah berbeda.
 */
export interface KitchenSaleRef {
  status: "completed" | "held" | "void";
  /** Momen penjualan lunas ini dikirim ke dapur (`createSale` yang mengisinya). */
  kitchenFiredAt?: number | null;
  /** Momen dapur menyatakan pesanannya beres. */
  kitchenDoneAt?: number | null;
}

/**
 * Sedang menunggu di dapur? Dua sumbernya: pesanan tertahan, dan penjualan lunas
 * yang sudah dikirim ke dapur tetapi belum ditandai selesai oleh dapur. Penjualan
 * yang dibatalkan (`void`) tidak pernah muncul lagi di antrean.
 */
export function isKitchenTicket(sale: KitchenSaleRef): boolean {
  if (sale.status === "held") return true;
  if (sale.status !== "completed") return false;
  return Boolean(sale.kitchenFiredAt) && !sale.kitchenDoneAt;
}

/**
 * Apakah penjualan yang baru tersimpan langsung dikirim ke dapur?
 *
 * Hanya alur F&B: penjualan biasa tidak punya dapur yang perlu diberi tahu, dan
 * layar dapur sendiri hanya ada kalau fitur `pos.kds` hidup di paket workspace
 * itu — jadi menyalakannya bukan keputusan per transaksi, melainkan setelan
 * workspace. Pesanan tertahan tidak lewat sini karena ia **sudah** tiket dapur
 * sejak pertama disimpan.
 */
export function fireKitchenOnSale(input: {
  kdsFeatureOn: boolean;
  status: "completed" | "held";
}): boolean {
  return input.kdsFeatureOn && input.status === "completed";
}

/**
 * Ringkasan satu baris untuk kartu dapur:
 * `2× Nasi Goreng (Pedas: 3, Topping: Telur) · 1× Es Teh`.
 */
export function ticketSummary(ticket: KdsTicket): string {
  return ticket.items
    .map((item) =>
      item.modifiers && item.modifiers.length > 0
        ? `${item.quantity}× ${item.name} (${item.modifiers.join(", ")})`
        : `${item.quantity}× ${item.name}`,
    )
    .join(" · ");
}

/** Label meja untuk UI: "A1 · Teras" (zona default tidak diulang). */
export function tableLabel(table: Pick<TableRef, "name" | "zone">): string {
  return table.zone && table.zone !== DEFAULT_TABLE_ZONE
    ? `${table.name} · ${table.zone}`
    : table.name;
}

// --------------------------------------------- tiket dapur & momen pelunasan

/**
 * Dapur hanya bekerja atas pesanan yang **sudah lunas**: pesanan QR meja yang
 * tagihannya masih menunggu tidak pernah menjadi tiket. Karena tiketnya lahir
 * tepat pada momen pelunasannya (`meja.guestOrderPaid` memakai `now` yang sama
 * untuk penjualan dan untuk baris pesanannya), momen itu dicatat di tiketnya —
 * supaya dapur bisa melihat bahwa pesanan ini memang diterima **bersamaan**
 * dengan uangnya masuk, bukan pesanan lama yang baru dilunasi belakangan.
 */
export interface TicketPayment {
  /** Cara bayar yang dipilih tamu saat memesan. */
  method: DigitalMethod;
  /** Bank penerbit Virtual Account; kosong untuk QRIS. */
  bank?: VaBank | null;
  /** Momen tagihannya ditandai lunas. `null` = data lama tanpa momen pelunasan. */
  paidAt?: number | null;
}

/** Jam:menit lokal dari sebuah momen (`13:42`); detik tidak berguna di dapur. */
export function clockOfDay(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

/** Awalan penanda momen pelunasan di kartu tiket dapur. */
export const TICKET_RECEIVED_PREFIX = "diterima dapur pukul";

/** Nama metode pembayaran backend dalam Bahasa Indonesia (`cash` → "Tunai"). */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Tunai",
  qris: "QRIS",
  card: "Kartu",
  transfer: "Transfer",
};

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

/** Pembayaran penjualan lunas, seperlunya untuk penanda di kartu tiket dapur. */
export interface TicketSettlement {
  /** `cash` | `qris` | `card` | `transfer`. */
  method: string;
  /** Momen penjualan itu dikirim ke dapur (`kitchenFiredAt`). */
  firedAt?: number | null;
}

/**
 * Penanda pembayaran tiket dapur yang **lunas di kasir**: `Lunas Tunai ·
 * diterima dapur pukul 13:42`. `null` = bukan tiket penjualan lunas (pesanan
 * tertahan belum dibayar siapa pun, jadi tidak ada yang bisa ditandai).
 */
export function ticketPaidLabel(
  payment: TicketSettlement | null | undefined,
): string | null {
  if (!payment) return null;
  const channel = `Lunas ${paymentMethodLabel(payment.method)}`;
  return payment.firedAt
    ? `${channel} · ${TICKET_RECEIVED_PREFIX} ${clockOfDay(payment.firedAt)}`
    : channel;
}

/**
 * Penanda kanal & momen pelunasan sebuah tiket dapur: `Lunas QRIS dari meja ·
 * diterima dapur pukul 13:42`. `null` = tiket itu bukan pesanan QR meja yang
 * sudah lunas (mis. pesanan tertahan yang dikirim kasir sendiri), jadi tidak
 * ada yang perlu ditandai.
 */
export function ticketPaymentLabel(
  payment: TicketPayment | null | undefined,
): string | null {
  if (!payment || payment.paidAt === null || payment.paidAt === undefined) {
    return null;
  }
  const channel =
    payment.method === "va"
      ? `Lunas VA${payment.bank ? ` ${vaBankLabel(payment.bank)}` : ""} dari meja`
      : "Lunas QRIS dari meja";
  return `${channel} · ${TICKET_RECEIVED_PREFIX} ${clockOfDay(payment.paidAt)}`;
}

// ---------------------------------------- notifikasi kartu antrean dapur

/**
 * Berapa lama kartu antrean dapur **berkilat** setelah tagihan QR baru masuk.
 *
 * Kilatnya sengaja panjang (6 detik) tetapi tidak kekal: layar dapur sering
 * ditinggal sebentar, jadi tanda “ada yang baru” harus tetap terbaca sesaat
 * setelah kasir menoleh, tanpa berubah jadi warna permanen yang lama-lama tidak
 * berarti apa-apa lagi.
 */
export const KDS_ALERT_FLASH_MS = 6000;

/**
 * Umur maksimal sebuah tagihan agar masih disebut “baru”.
 *
 * Tagihan yang sudah menunggu lama (mis. layar baru dibuka di tengah hari) tidak
 * boleh memicu bunyi & kilat: yang diberitahukan adalah **kedatangan** tagihan,
 * bukan keadaan lama yang sudah ada sebelum layarnya dilihat. Batasnya sengaja
 * lebih longgar dari kedaluwarsa tagihan QRIS (5 menit), supaya layar yang baru
 * dibuka sedetik setelah tamu memesan tetap memberitahukannya.
 */
export const KDS_ALERT_WINDOW_MS = 30_000;

/** Satu tagihan QR yang masih menunggu pelunasan, sekadarnya untuk notifikasi. */
export interface PendingQrBill {
  /** Id pesanan tamunya — dipakai sebagai penanda “sudah pernah diberitahukan”. */
  id: string;
  /** Momen pesanannya dibuat (dipakai menilai masih “baru” atau tidak). */
  createdAt: number;
}

export interface KdsAlertPlan {
  /**
   * Tagihan yang layak diberitahukan **saat ini juga**: belum pernah dilihat
   * layar ini dan umurnya masih di dalam `KDS_ALERT_WINDOW_MS`. Urut dari yang
   * paling lama menunggu, seperti antrean dapurnya sendiri.
   */
  freshIds: string[];
  /**
   * Seluruh id yang menunggu sekarang — patokan “sudah dilihat” untuk
   * pemeriksaan berikutnya. Dihitung dari keadaan sekarang, bukan dari id lama:
   * tagihan yang sudah lunas/dibatalkan tidak perlu diingat lagi.
   */
  seenIds: string[];
}

/**
 * Mana tagihan QR yang perlu diberitahukan ke dapur.
 *
 * Dua syarat sekaligus, dan keduanya perlu:
 *
 *  - **belum pernah dilihat** — supaya satu tagihan tidak berbunyi berulang kali
 *    hanya karena layarnya dirender ulang (React merender sesering apa pun,
 *    bip-nya tetap satu kali per tagihan);
 *  - **masih baru** (`KDS_ALERT_WINDOW_MS`) — supaya membuka layar dapur tidak
 *    membunyikan alarm untuk tagihan yang sudah lama menunggu.
 */
export function planKdsAlert(
  seen: Iterable<string>,
  pending: readonly PendingQrBill[],
  now: number = Date.now(),
): KdsAlertPlan {
  const known = seen instanceof Set ? seen : new Set(seen);
  const freshIds = pending
    .filter((bill) => !known.has(bill.id) && now - bill.createdAt <= KDS_ALERT_WINDOW_MS)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((bill) => bill.id);
  return { freshIds, seenIds: pending.map((bill) => bill.id) };
}

/**
 * Apakah kilat notifikasinya **masih menyala** pada momen `now`. `null`/belum
 * pernah ada notifikasi berarti tidak menyala; momen yang datang dari masa depan
 * (jam perangkat mundur) juga tidak dianggap menyala, bukan menyala selamanya.
 */
export function isKdsAlertFlashing(
  alertedAt: number | null | undefined,
  now: number = Date.now(),
): boolean {
  if (alertedAt === null || alertedAt === undefined) return false;
  const age = now - alertedAt;
  return age >= 0 && age < KDS_ALERT_FLASH_MS;
}

/** Kalimat tanda di kartu antrean dapur: `1 tagihan QR baru masuk`. */
export function kdsAlertLabel(count: number): string {
  const value = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return `${value} tagihan QR baru masuk`;
}

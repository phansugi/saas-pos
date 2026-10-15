/**
 * Aturan gudang & perpindahan stok (`inventory.multiwarehouse`) — Phase 3.
 *
 * Modul murni: dipakai server (`src/convex/inventory.ts`, `lib/access.ts`),
 * store klien, halaman Gudang & Stok, dan harness. Tidak ada satu pun aturan
 * yang ditulis dua kali, jadi angka yang dilihat di layar adalah angka yang
 * ditegakkan backend.
 *
 * Model yang dipakai (satu keputusan yang perlu diketahui):
 *
 * - **Stok dijual berasal dari lokasi jual.** Setiap toko punya satu lokasi jual
 *   (`DEFAULT_WAREHOUSE_ID`) yang **tidak** disimpan sebagai baris tabel: ia
 *   adalah bucket stok lama (`stockLevels` tanpa `warehouseId`). Karena itu
 *   penjualan menggerakkan stok yang sudah ada tanpa migrasi, dan kasir tidak
 *   bisa diam-diam menjual barang yang masih di gudang.
 * - **Gudang adalah lokasi penyimpanan tambahan.** Barang harus dipindahkan
 *   dulu dari gudang ke lokasi jual sebelum bisa dijual — itu perilaku yang
 *   memang diinginkan gudang: stok fisik berpindah lebih dulu, baru tercatat
 *   bisa dijual.
 * - **Mengosongkan/mengembalikan stok selalu boleh.** Menambah gudang butuh
 *   fitur `inventory.multiwarehouse`, tetapi memindahkan stok tidak — kalau
 *   paketnya turun, gudang lama harus tetap bisa dikosongkan, bukan jadi
 *   stok yang terkunci.
 */

export const DEFAULT_WAREHOUSE_ID = "default";
export const DEFAULT_WAREHOUSE_CODE = "TOKO";
export const DEFAULT_WAREHOUSE_NAME = "Lokasi jual (toko)";

export const MAX_WAREHOUSE_NAME = 40;
export const MAX_WAREHOUSE_CODE = 8;
export const MAX_WAREHOUSE_ADDRESS = 120;
export const MAX_TRANSFER_NOTE = 120;

export interface Result<T> {
  ok: boolean;
  value?: T;
  reason?: string;
}

/** Bentuk minimal sebuah lokasi stok — cukup untuk aturan di berkas ini. */
export interface WarehouseLike {
  id: string;
  code: string;
  name: string;
  address?: string;
  active: boolean;
  /** Lokasi jual toko; selalu ada walau tidak punya baris tabel. */
  isDefault?: boolean;
}

export interface WarehouseInput {
  name: string;
  code?: string;
  address?: string;
}

export interface ResolvedWarehouse {
  code: string;
  name: string;
  address?: string;
  active: boolean;
}

function collapse(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** Lokasi jual sebuah toko, dalam bentuk yang sama dengan gudang biasa. */
export function defaultWarehouse(): WarehouseLike {
  return {
    id: DEFAULT_WAREHOUSE_ID,
    code: DEFAULT_WAREHOUSE_CODE,
    name: DEFAULT_WAREHOUSE_NAME,
    active: true,
    isDefault: true,
  };
}

export function isDefaultWarehouse(id: string | null | undefined): boolean {
  return id === null || id === undefined || id === DEFAULT_WAREHOUSE_ID;
}

/** Kode gudang selalu huruf besar, tanpa spasi: "Gudang Utama" → "GU". */
export function normalizeWarehouseCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

export function isValidWarehouseCode(code: string): boolean {
  return /^[A-Z0-9][A-Z0-9-]{1,7}$/.test(code);
}

/**
 * Usulan kode dari nama: singkatan setiap kata (maks 4 huruf), lalu diberi
 * nomor kalau sudah dipakai — sama seperti usulan kode member & pelanggan.
 */
export function suggestWarehouseCode(name: string, existing: string[] = []): string {
  const words = collapse(name)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .split(" ")
    .filter((word) => word.length > 0);

  const initials = words
    .map((word) => word[0])
    .join("")
    .slice(0, 4);
  const base = (initials.length >= 2 ? initials : words[0]?.slice(0, 4) ?? "GD") || "GD";

  const taken = new Set(existing.map((code) => code.toUpperCase()));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`.slice(0, MAX_WAREHOUSE_CODE);
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-X`.slice(0, MAX_WAREHOUSE_CODE);
}

export function warehouseCodeTaken(
  warehouses: { id: string; code: string }[],
  code: string,
  exceptId?: string,
): boolean {
  const target = normalizeWarehouseCode(code);
  return warehouses.some(
    (warehouse) =>
      warehouse.id !== exceptId &&
      normalizeWarehouseCode(warehouse.code) === target,
  );
}

/** Validasi satu gudang baru; pesannya menyebut angka/batas yang dilanggar. */
export function resolveWarehouseInput(
  input: WarehouseInput,
  existingCodes: string[] = [],
): Result<ResolvedWarehouse> {
  const name = collapse(input.name ?? "");
  if (name.length < 2 || name.length > MAX_WAREHOUSE_NAME) {
    return { ok: false, reason: `Nama gudang harus 2–${MAX_WAREHOUSE_NAME} karakter.` };
  }

  const code = input.code ? normalizeWarehouseCode(input.code) : suggestWarehouseCode(name, existingCodes);
  if (!isValidWarehouseCode(code)) {
    return {
      ok: false,
      reason: `Kode gudang ${input.code} tidak valid — pakai 2–${MAX_WAREHOUSE_CODE} huruf/angka (mis. GD-A).`,
    };
  }
  const taken = new Set(existingCodes.map((row) => normalizeWarehouseCode(row)));
  if (taken.has(code)) {
    return { ok: false, reason: `Kode gudang ${code} sudah dipakai.` };
  }

  const address = input.address ? collapse(input.address) : "";
  if (address.length > MAX_WAREHOUSE_ADDRESS) {
    return { ok: false, reason: `Alamat gudang maksimal ${MAX_WAREHOUSE_ADDRESS} karakter.` };
  }

  return {
    ok: true,
    value: {
      code,
      name,
      address: address === "" ? undefined : address,
      active: true,
    },
  };
}

/**
 * Berapa gudang yang boleh ada menurut paket. Lokasi jual dihitung satu slot:
 * paket dengan `warehouses: 1` berarti "hanya lokasi jual", jadi gudang
 * tambahan pertama sudah melebihi batas. `unlimited` (Enterprise) tak terbatas.
 */
export function warehouseCapacity(
  limit: number | "unlimited",
  namedCount: number,
): { used: number; limit: number | "unlimited"; remaining: number; full: boolean } {
  const used = namedCount + 1;
  if (limit === "unlimited") {
    return { used, limit, remaining: Number.POSITIVE_INFINITY, full: false };
  }
  const remaining = Math.max(0, limit - used);
  return { used, limit, remaining, full: used >= limit };
}

export function describeWarehouseLimit(limit: number | "unlimited"): string {
  return limit === "unlimited" ? "tanpa batas" : `${limit} lokasi`;
}

/** Satu baris stok pada satu lokasi (lokasi jual memakai id `default`). */
export interface StockLevelLike {
  warehouseId: string;
  quantity: number;
}

export function bucketQuantities(
  levels: StockLevelLike[],
  warehouseId: string = DEFAULT_WAREHOUSE_ID,
): number {
  const row = levels.find((level) => level.warehouseId === warehouseId);
  return row ? row.quantity : 0;
}

export function totalQuantity(levels: StockLevelLike[]): number {
  return levels.reduce((sum, level) => sum + level.quantity, 0);
}

export interface TransferPlan {
  quantity: number;
}

export interface TransferRequest {
  from: string;
  to: string;
  quantity: number;
  /** Berapa yang benar-benar ada di gudang asal. */
  available: number;
  fromName: string;
  toName: string;
  /** Gudang asal/tujuan nonaktif tidak boleh dipakai sampai diaktifkan lagi. */
  fromActive?: boolean;
  toActive?: boolean;
}

/**
 * Memeriksa satu perpindahan stok. Dipakai halaman (pesan langsung di layar)
 * dan server (penolakan sebenarnya) — satu aturan, dua tempat.
 */
export function planTransfer(request: TransferRequest): Result<TransferPlan> {
  const quantity = request.quantity;
  if (!Number.isFinite(quantity) || Math.trunc(quantity) !== quantity || quantity <= 0) {
    return { ok: false, reason: "Jumlah pindah harus bilangan bulat lebih dari 0." };
  }
  if (request.from === request.to) {
    return { ok: false, reason: "Gudang asal dan tujuan tidak boleh sama." };
  }
  if (request.fromActive === false) {
    return { ok: false, reason: `${request.fromName} sedang nonaktif; aktifkan dulu sebelum dipakai.` };
  }
  if (request.toActive === false) {
    return { ok: false, reason: `${request.toName} sedang nonaktif; aktifkan dulu sebelum dipakai.` };
  }
  if (request.available < quantity) {
    return {
      ok: false,
      reason: `Stok di ${request.fromName} hanya ${request.available}; tidak cukup untuk memindahkan ${quantity}.`,
    };
  }
  return { ok: true, value: { quantity } };
}

/** "GD-A · Gudang Utama" untuk daftar & catatan audit. */
export function describeWarehouse(warehouse: { code: string; name: string }): string {
  return `${warehouse.code} · ${warehouse.name}`;
}

export function activeWarehouses<T extends { active: boolean }>(warehouses: T[]): T[] {
  return warehouses.filter((warehouse) => warehouse.active);
}

/**
 * Ambang stok kritis bawaan (stok `<=` ambang dianggap menipis).
 *
 * Satu angka untuk dua pemakai: daftar stok menipis di halaman Produk (boleh
 * ditimpa paket/argumen) dan pemicu webhook `stock.low`. Kalau keduanya memakai
 * angka sendiri-sendiri, notifikasi dan layar bisa berbeda pendapat tentang
 * produk mana yang kritis — dan itu jenis kebingungan yang paling mahal di POS.
 */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

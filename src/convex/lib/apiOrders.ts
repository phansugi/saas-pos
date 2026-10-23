/**
 * Pesanan masuk dari sistem luar (`POST /api/v1/sales`) — aturan murni.
 *
 * Endpoint tulis pertama di API publik. Bentuknya sengaja **berbeda** dari
 * `pos.createSale` yang dipakai antarmuka kasir, dan perbedaannya disengaja:
 *
 * 1. **Produk ditunjuk dengan SKU, bukan id Convex.** Sistem luar tidak pernah
 *    melihat id internal; yang mereka tahu adalah SKU yang muncul di
 *    `GET /api/v1/products`. Menerjemahkan SKU → produk adalah tugas server.
 * 2. **Harga tidak pernah dikirim klien.** Harga, harga bertingkat, diskon
 *    member, dan PPN dihitung server. Karena itu `payment.amount` boleh
 *    **dihilangkan** — artinya “tagih tepat sebesar total yang kamu hitung”
 *    (`payExactTotal` di `pos.createSale`). Kiriman yang mengisi jumlah sendiri
 *    tetap diizinkan, dan sisa yang belum dibayar hanya boleh menjadi piutang
 *    kalau pelanggannya disebut (`customerCode`).
 * 3. **`idempotencyKey` wajib.** Sistem luar mengirim ulang saat jaringan
 *    gagal; tanpa kunci idempotensi, kiriman ulang menjadi penjualan kedua.
 *    Server menamainya per tenant (`api:<tenantId>:<kunci>`), jadi kunci yang
 *    sama dari tenant berbeda tidak saling menabrak.
 *
 * Modul ini hanya memeriksa **bentuk** (400). Keputusan bisnis — stok kurang,
 * modul Grosir/F&B mati, limit kredit habis — diambil `pos.createSale` dan
 * dilaporkan sebagai 409, apa adanya, supaya tidak ada dua tempat yang
 * memutuskan hal yang sama dengan aturan berbeda.
 */

import {
  MAX_GROUP_SELECT,
  MAX_MODIFIER_GROUPS,
  normaliseGroupCode,
  normaliseOptionCode,
} from "./modifiers";

/** Metode pembayaran yang dikenal — dijaga sama dengan `paymentMethodValidator`. */
export const PAYMENT_METHODS = ["cash", "qris", "card", "transfer"] as const;

export type ExternalPaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ORDER_LINES_MAX = 50;
export const ORDER_QUANTITY_MAX = 100_000;
export const ORDER_IDEMPOTENCY_MIN = 8;
export const ORDER_IDEMPOTENCY_MAX = 64;
export const ORDER_CODE_MAX = 32;
export const ORDER_UNIT_CODE_MAX = 8;
/** Panjang maksimum nama produk pada satu baris (dipakai sebagai cadangan SKU). */
export const ORDER_NAME_MAX = 200;
export const ORDER_PROVIDER_MAX = 40;

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]+$/;

const ORDER_FIELDS = new Set([
  "idempotencyKey",
  "lines",
  "payment",
  "discount",
  "customerCode",
  "memberCode",
]);

const LINE_FIELDS = new Set(["sku", "name", "quantity", "unitCode", "modifiers"]);
const MODIFIER_FIELDS = new Set(["groupCode", "optionCodes"]);

const PAYMENT_FIELDS = new Set(["method", "amount", "provider", "providerRef"]);

/** Pilihan modifier pada satu baris: grup + opsi, dalam bentuk kode. */
export interface ExternalOrderModifier {
  groupCode: string;
  optionCodes: string[];
}

export interface ExternalOrderLine {
  /** SKU dalam huruf besar; pencocokan produk dilakukan server. */
  sku: string;
  /**
   * Nama produk, **hanya** dipakai kalau SKU tidak ditemukan. Berguna kalau
   * katalog sumber sempat mengganti nomor SKU (mis. marketplace yang
   * mengurutkan ulang SKU) sementara namanya tetap sama: pesanan yang sudah
   * lunas tidak perlu tertahan hanya karena kodenya bergeser. Nama harus
   * menunjuk **tepat satu** produk; nama kembar tetap ditolak agar tidak
   * menebak produk yang salah.
   */
  name?: string;
  quantity: number;
  /** Satuan besar (modul Grosir, mis. `DUS`); kosong = satuan dasar produk. */
  unitCode?: string;
  /**
   * Modifier item (modul F&B), mis. `{ groupCode: "LEVEL", optionCodes: ["3"] }`
   * dan `{ groupCode: "TOPPING", optionCodes: ["TELUR"] }`. Kode, bukan nama:
   * nama boleh berubah tanpa mengubah riwayat struk. Aturan wajib/batas pilihan
   * ditegakkan `pos.createSale` lewat `applyModifiers` yang sama dengan kasir.
   */
  modifiers?: ExternalOrderModifier[];
}

export interface ExternalOrderPayment {
  method: ExternalPaymentMethod;
  /**
   * `undefined` = bayar tepat sebesar total yang dihitung server. Angka yang
   * diisi klien dipakai apa adanya (dan sisanya bisa jadi piutang bila ada
   * `customerCode`).
   */
  amount?: number;
  provider?: string;
  providerRef?: string;
}

export interface ExternalOrder {
  idempotencyKey: string;
  lines: ExternalOrderLine[];
  payment: ExternalOrderPayment;
  /** Diskon manual dalam rupiah; diskon member dihitung server dari data member. */
  discount: number;
  customerCode: string | null;
  memberCode: string | null;
}

export type ExternalOrderParse =
  | { ok: true; value: ExternalOrder }
  | { ok: false; reason: string };

/**
 * Bentuk kunci idempotensi yang diterima `pos.createSale`. Dipakai juga oleh
 * jalur marketplace supaya kunci yang disusun dari id pesanan mereka tidak
 * ditolak hanya karena bentuknya.
 */
export function isOrderIdempotencyKey(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length >= ORDER_IDEMPOTENCY_MIN &&
    value.length <= ORDER_IDEMPOTENCY_MAX &&
    IDEMPOTENCY_PATTERN.test(value)
  );
}

/** Kode (SKU/pelanggan/member) dinormalkan supaya “kopi-susu” = “KOPI-SUSU”. */
export function normalizeOrderCode(value: string): string {
  return value.trim().toUpperCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCode(
  source: Record<string, unknown>,
  field: string,
  label: string,
): { ok: true; value: string | null } | { ok: false; reason: string } {
  const raw = source[field];
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, reason: `${label} harus berupa teks yang tidak kosong.` };
  }
  const code = normalizeOrderCode(raw);
  if (code.length > ORDER_CODE_MAX || !CODE_PATTERN.test(code)) {
    return {
      ok: false,
      reason: `${label} "${raw}" tidak valid: maksimal ${ORDER_CODE_MAX} karakter huruf besar/angka (boleh . _ -).`,
    };
  }
  return { ok: true, value: code };
}

/**
 * Tanda tangan baris: SKU + satuan + modifier terurut. Dipakai hanya untuk
 * menolak baris kembar, jadi bentuknya tidak disimpan dan tidak mengikat
 * kontrak API.
 */
function modifierSignature(modifiers: readonly ExternalOrderModifier[]): string {
  return modifiers
    .map((entry) => `${entry.groupCode}:${[...entry.optionCodes].sort().join("+")}`)
    .sort()
    .join(",");
}

/**
 * Modifier satu baris. Yang diperiksa di sini hanya **bentuk**: kode grup/opsi
 * ada, jumlah pilihan masuk akal, dan grup tidak tertulis dua kali. Apakah grup
 * wajib sudah dipilih dan opsinya benar-benar milik produk itu dijawab
 * `applyModifiers` di jalur kasir — satu tempat untuk aturan bisnis.
 */
function readModifiers(
  raw: unknown,
  lineIndex: number,
): { ok: true; value: ExternalOrderModifier[] } | { ok: false; reason: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, reason: `Baris ke-${lineIndex}: modifiers harus berupa array.` };
  }
  if (raw.length > MAX_MODIFIER_GROUPS) {
    return {
      ok: false,
      reason: `Baris ke-${lineIndex}: maksimal ${MAX_MODIFIER_GROUPS} grup modifier per baris.`,
    };
  }

  const seenGroups = new Set<string>();
  const modifiers: ExternalOrderModifier[] = [];
  for (const [index, entry] of raw.entries()) {
    if (!isPlainObject(entry)) {
      return {
        ok: false,
        reason: `Baris ke-${lineIndex}: modifier ke-${index + 1} harus berupa objek { groupCode, optionCodes }.`,
      };
    }
    const stray = Object.keys(entry).find((key) => !MODIFIER_FIELDS.has(key));
    if (stray) {
      return {
        ok: false,
        reason: `Baris ke-${lineIndex}: modifier ke-${index + 1} punya field "${stray}"; yang diterima groupCode & optionCodes.`,
      };
    }
    if (typeof entry.groupCode !== "string" || entry.groupCode.trim().length === 0) {
      return {
        ok: false,
        reason: `Baris ke-${lineIndex}: modifier ke-${index + 1} harus punya groupCode (mis. LEVEL).`,
      };
    }
    const groupCode = normaliseGroupCode(entry.groupCode);
    if (seenGroups.has(groupCode)) {
      return {
        ok: false,
        reason: `Baris ke-${lineIndex}: grup modifier ${groupCode} tertulis dua kali.`,
      };
    }
    seenGroups.add(groupCode);

    if (!Array.isArray(entry.optionCodes) || entry.optionCodes.length === 0) {
      return {
        ok: false,
        reason: `Baris ke-${lineIndex}: ${groupCode} wajib punya minimal satu optionCodes, atau grupnya dihilangkan.`,
      };
    }
    if (entry.optionCodes.length > MAX_GROUP_SELECT) {
      return {
        ok: false,
        reason: `Baris ke-${lineIndex}: ${groupCode} maksimal ${MAX_GROUP_SELECT} pilihan.`,
      };
    }

    const optionCodes: string[] = [];
    for (const option of entry.optionCodes) {
      if (typeof option !== "string" || option.trim().length === 0) {
        return {
          ok: false,
          reason: `Baris ke-${lineIndex}: ${groupCode} berisi kode opsi yang bukan teks.`,
        };
      }
      const code = normaliseOptionCode(option);
      if (!optionCodes.includes(code)) optionCodes.push(code);
    }
    modifiers.push({ groupCode, optionCodes });
  }
  return { ok: true, value: modifiers };
}

/**
 * Memeriksa satu pesanan dari sistem luar. Mengembalikan bentuk yang sudah
 * dinormalkan, atau alasan yang bisa dibaca operator (bukan kode galat).
 */
export function parseExternalOrder(body: unknown): ExternalOrderParse {
  if (!isPlainObject(body)) {
    return { ok: false, reason: "Body harus berupa objek JSON." };
  }

  const unknownField = Object.keys(body).find((key) => !ORDER_FIELDS.has(key));
  if (unknownField) {
    return {
      ok: false,
      reason: `Field "${unknownField}" tidak dikenal. Field yang diterima: ${[...ORDER_FIELDS].join(", ")}.`,
    };
  }

  const rawKey = body.idempotencyKey;
  if (typeof rawKey !== "string" || rawKey.trim().length === 0) {
    return { ok: false, reason: "idempotencyKey wajib diisi." };
  }
  const idempotencyKey = rawKey.trim();
  if (!isOrderIdempotencyKey(idempotencyKey)) {
    return {
      ok: false,
      reason: `idempotencyKey harus ${ORDER_IDEMPOTENCY_MIN}–${ORDER_IDEMPOTENCY_MAX} karakter huruf, angka, atau . _ : - (dipakai untuk menolak kiriman ulang).`,
    };
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return { ok: false, reason: "lines wajib berisi minimal satu baris pesanan." };
  }
  if (body.lines.length > ORDER_LINES_MAX) {
    return { ok: false, reason: `Maksimal ${ORDER_LINES_MAX} baris per pesanan.` };
  }

  const lines: ExternalOrderLine[] = [];
  const seen = new Set<string>();
  for (const [index, rawLine] of body.lines.entries()) {
    const at = index + 1;
    if (!isPlainObject(rawLine)) {
      return { ok: false, reason: `Baris ke-${at} harus berupa objek.` };
    }
    const unknownLineField = Object.keys(rawLine).find((key) => !LINE_FIELDS.has(key));
    if (unknownLineField) {
      return {
        ok: false,
        reason: `Baris ke-${at}: field "${unknownLineField}" tidak dikenal. Field yang diterima: sku, name, quantity, unitCode, modifiers.`,
      };
    }

    const rawSku = rawLine.sku;
    if (typeof rawSku !== "string" || rawSku.trim().length === 0) {
      return { ok: false, reason: `Baris ke-${at}: sku wajib diisi.` };
    }
    const sku = normalizeOrderCode(rawSku);
    if (sku.length > ORDER_CODE_MAX || !CODE_PATTERN.test(sku)) {
      return {
        ok: false,
        reason: `Baris ke-${at}: sku "${rawSku}" tidak valid (maksimal ${ORDER_CODE_MAX} karakter huruf besar/angka, boleh . _ -).`,
      };
    }

    let name: string | undefined;
    if (rawLine.name !== undefined && rawLine.name !== null) {
      if (typeof rawLine.name !== "string" || rawLine.name.trim().length === 0) {
        return { ok: false, reason: `Baris ke-${at}: name harus berupa teks yang tidak kosong.` };
      }
      const trimmed = rawLine.name.trim();
      if (trimmed.length > ORDER_NAME_MAX) {
        return { ok: false, reason: `Baris ke-${at}: name maksimal ${ORDER_NAME_MAX} karakter.` };
      }
      name = trimmed;
    }

    const quantity = rawLine.quantity;
    if (
      typeof quantity !== "number" ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > ORDER_QUANTITY_MAX
    ) {
      return {
        ok: false,
        reason: `Baris ke-${at}: quantity harus angka lebih dari 0 (maksimal ${ORDER_QUANTITY_MAX}).`,
      };
    }

    let unitCode: string | undefined;
    if (rawLine.unitCode !== undefined && rawLine.unitCode !== null) {
      if (typeof rawLine.unitCode !== "string") {
        return { ok: false, reason: `Baris ke-${at}: unitCode harus berupa teks.` };
      }
      const normalized = normalizeOrderCode(rawLine.unitCode);
      if (normalized.length === 0 || normalized.length > ORDER_UNIT_CODE_MAX) {
        return {
          ok: false,
          reason: `Baris ke-${at}: unitCode maksimal ${ORDER_UNIT_CODE_MAX} karakter huruf/angka.`,
        };
      }
      unitCode = normalized;
    }

    const modifiers = readModifiers(rawLine.modifiers, at);
    if (!modifiers.ok) return modifiers;

    // Dua baris dengan SKU, satuan, **dan modifier** sama hampir selalu kiriman
    // ganda; menolaknya lebih baik daripada menebak mana yang dimaksud
    // pengirim. Modifier berbeda (mis. pedas level 1 vs level 3) adalah dua
    // baris yang sah, jadi ikut masuk tanda tangan baris.
    const signature = `${sku}@${unitCode ?? ""}@${modifierSignature(modifiers.value)}`;
    if (seen.has(signature)) {
      return {
        ok: false,
        reason: `Baris ke-${at}: ${sku} dengan satuan & modifier yang sama muncul lebih dari sekali; gabungkan kuantitasnya dalam satu baris.`,
      };
    }
    seen.add(signature);

    const line: ExternalOrderLine = unitCode ? { sku, quantity, unitCode } : { sku, quantity };
    if (name) line.name = name;
    if (modifiers.value.length > 0) line.modifiers = modifiers.value;
    lines.push(line);
  }

  if (!isPlainObject(body.payment)) {
    return { ok: false, reason: "payment wajib diisi (mis. { \"method\": \"qris\" })." };
  }
  const unknownPaymentField = Object.keys(body.payment).find(
    (key) => !PAYMENT_FIELDS.has(key),
  );
  if (unknownPaymentField) {
    return {
      ok: false,
      reason: `payment.${unknownPaymentField} tidak dikenal. Field yang diterima: method, amount, provider, providerRef.`,
    };
  }
  const method = body.payment.method;
  if (typeof method !== "string" || !PAYMENT_METHODS.includes(method as ExternalPaymentMethod)) {
    return {
      ok: false,
      reason: `payment.method "${String(method)}" tidak dikenal; pakai salah satu dari ${PAYMENT_METHODS.join(", ")}.`,
    };
  }

  const payment: ExternalOrderPayment = { method: method as ExternalPaymentMethod };
  if (body.payment.amount !== undefined && body.payment.amount !== null) {
    const amount = body.payment.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      return {
        ok: false,
        reason:
          "payment.amount harus angka ≥ 0, atau dihilangkan supaya server menagih tepat sebesar total.",
      };
    }
    payment.amount = amount;
  }
  for (const field of ["provider", "providerRef"] as const) {
    const raw = body.payment[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return { ok: false, reason: `payment.${field} harus berupa teks yang tidak kosong.` };
    }
    if (raw.trim().length > ORDER_PROVIDER_MAX) {
      return {
        ok: false,
        reason: `payment.${field} maksimal ${ORDER_PROVIDER_MAX} karakter.`,
      };
    }
    payment[field] = raw.trim();
  }

  let discount = 0;
  if (body.discount !== undefined && body.discount !== null) {
    const raw = body.discount;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
      return { ok: false, reason: "discount harus angka ≥ 0 (rupiah)." };
    }
    discount = raw;
  }

  const customer = readCode(body, "customerCode", "customerCode");
  if (!customer.ok) return customer;
  const member = readCode(body, "memberCode", "memberCode");
  if (!member.ok) return member;

  return {
    ok: true,
    value: {
      idempotencyKey,
      lines,
      payment,
      discount,
      customerCode: customer.value,
      memberCode: member.value,
    },
  };
}

/**
 * True kalau klien menentukan sendiri jumlah yang dibayar. Kalau `false`,
 * pemanggil memakai `payExactTotal` supaya `pos.createSale` yang menghitung
 * totalnya — satu tempat, bukan dua.
 */
export function hasExplicitPaymentAmount(order: ExternalOrder): boolean {
  return order.payment.amount !== undefined;
}

/** Ringkas untuk halaman & log: “2 baris · qris · tepat total”. */
export function describeExternalOrder(order: ExternalOrder): string {
  const paid = hasExplicitPaymentAmount(order)
    ? `dibayar ${order.payment.amount}`
    : "tepat total";
  const customer = order.customerCode ? ` · ${order.customerCode}` : "";
  const member = order.memberCode ? ` · ${order.memberCode}` : "";
  return `${order.lines.length} baris · ${order.payment.method} · ${paid}${customer}${member}`;
}

/**
 * Contoh body untuk dokumentasi & tombol “lihat contoh” di halaman. Dikirim
 * tanpa `amount` supaya contohnya menunjukkan cara yang aman: harga dihitung
 * server, bukan disalin dari sistem luar.
 */
export function sampleExternalOrderBody(): ExternalOrder {
  return {
    idempotencyKey: "web-order-2026-0001",
    lines: [{ sku: "KOPI-SUSU", quantity: 2 }],
    payment: { method: "qris" },
    discount: 0,
    customerCode: null,
    memberCode: null,
  };
}

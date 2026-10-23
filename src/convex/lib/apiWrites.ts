/**
 * Badan permintaan endpoint **tulis** API v1 — aturan murni.
 *
 * Semua pemeriksaan bentuk ada di sini (400), sedangkan keputusan bisnis tetap
 * di jalur aplikasi yang sama dengan kasir (409): `products.setPricing`,
 * `products.adjustStock`, `ar.createCustomer`, `loyalty.create`,
 * `pos.voidSale`. Pemisahan itu disengaja — fungsi ini tidak boleh tahu stok,
 * limit kredit, atau modul mana yang menyala.
 *
 * Aturan yang berlaku untuk semua parser:
 *
 * 1. **Field asing ditolak**, bukan diabaikan. Salah ketik `"Price"` yang
 *    diterima diam-diam adalah cara termudah mengubah harga yang salah.
 * 2. **Tipe diperiksa, isi tidak ditebak**: angka harus angka, teks harus teks.
 *    Kode (SKU, kode pelanggan/member, nomor struk) dinormalkan ke huruf besar
 *    karena itulah bentuk yang disimpan workspace.
 * 3. **Alasan penolakan menyebut field-nya** supaya operator bisa memperbaiki
 *    kiriman tanpa membaca kode sumber.
 */

import { ORDER_CODE_MAX, normalizeOrderCode } from "./apiOrders";
import { MAX_CREDIT_LIMIT } from "./ar";
import {
  INBOUND_EVENT_KEYS,
  INBOUND_NAME_MAX,
  INBOUND_NAME_MIN,
  sanitizeInboundEvents,
} from "./inboundWebhooks";
import { MAX_MEMBER_CODE_LENGTH } from "./loyalty";

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;
const UNIT_PATTERN = /^[A-Z][A-Z0-9]{0,7}$/;

export const PRODUCT_NAME_MAX = 80;
export const STOCK_NOTE_MAX = 200;
export const VOID_REASON_MAX = 200;
export const CUSTOMER_NAME_MAX = 60;
export const MEMBER_NAME_MAX = 60;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Field yang tidak dikenal → alasan 400 yang menyebut field & daftar yang sah. */
function unknownField(
  body: Record<string, unknown>,
  allowed: readonly string[],
  scope = "",
): string | null {
  const known = new Set(allowed);
  const found = Object.keys(body).find((key) => !known.has(key));
  if (!found) return null;
  return `${scope}Field "${found}" tidak dikenal. Field yang diterima: ${allowed.join(", ")}.`;
}

function readSku(body: Record<string, unknown>, label = "sku"): { ok: true; value: string } | { ok: false; reason: string } {
  const raw = body[label];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, reason: `${label} wajib diisi (SKU produk di workspace ini).` };
  }
  const sku = normalizeOrderCode(raw);
  if (sku.length > ORDER_CODE_MAX || !CODE_PATTERN.test(sku)) {
    return {
      ok: false,
      reason: `${label} "${raw}" tidak valid: maksimal ${ORDER_CODE_MAX} karakter huruf besar/angka (boleh . _ -).`,
    };
  }
  return { ok: true, value: sku };
}

function optionalText(
  body: Record<string, unknown>,
  field: string,
  max: number,
): { ok: true; value: string | undefined } | { ok: false; reason: string } {
  const raw = body[field];
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (typeof raw !== "string") {
    return { ok: false, reason: `${field} harus berupa teks.` };
  }
  const text = raw.trim();
  if (text.length === 0) return { ok: true, value: undefined };
  if (text.length > max) {
    return { ok: false, reason: `${field} maksimal ${max} karakter.` };
  }
  return { ok: true, value: text };
}

/* ------------------------------------------------------------------ produk */

export interface ProductPatch {
  sku: string;
  name?: string;
  price?: number;
  unit?: string;
  active?: boolean;
  cost?: number;
}

const PRODUCT_PATCH_FIELDS = ["sku", "name", "price", "unit", "active", "cost"];

/**
 * `PATCH /api/v1/products` — mengubah sebagian produk yang ditunjuk SKU.
 *
 * Nama, harga, satuan, modal, dan status aktif boleh diubah bersamaan; yang
 * **tidak** berlaku lewat sini adalah stok (endpoint sendiri, `stock.adjust`).
 * Minimal satu field perubahan harus ada — kiriman yang hanya menyebut SKU
 * hampir selalu kesalahan pemanggil, bukan permintaan yang sah.
 */
export function parseProductPatch(body: unknown): { ok: true; value: ProductPatch } | { ok: false; reason: string } {
  if (!isPlainObject(body)) return { ok: false, reason: "Body harus berupa objek JSON." };
  const stray = unknownField(body, PRODUCT_PATCH_FIELDS);
  if (stray) return { ok: false, reason: stray };

  const sku = readSku(body);
  if (!sku.ok) return sku;

  const value: ProductPatch = { sku: sku.value };
  let changes = 0;

  if (body.name !== undefined) {
    if (typeof body.name !== "string") return { ok: false, reason: "name harus berupa teks." };
    const name = body.name.replace(/\s+/g, " ").trim();
    if (name.length === 0 || name.length > PRODUCT_NAME_MAX) {
      return { ok: false, reason: `name wajib diisi, maksimal ${PRODUCT_NAME_MAX} karakter.` };
    }
    value.name = name;
    changes += 1;
  }

  if (body.price !== undefined) {
    if (typeof body.price !== "number" || !Number.isFinite(body.price) || body.price < 0) {
      return { ok: false, reason: "price harus angka rupiah ≥ 0 (tanpa desimal)." };
    }
    if (!Number.isInteger(body.price)) {
      return { ok: false, reason: "price harus bilangan bulat rupiah (tanpa desimal)." };
    }
    value.price = body.price;
    changes += 1;
  }

  if (body.cost !== undefined) {
    if (typeof body.cost !== "number" || !Number.isFinite(body.cost) || body.cost < 0 || !Number.isInteger(body.cost)) {
      return { ok: false, reason: "cost harus bilangan bulat rupiah ≥ 0." };
    }
    value.cost = body.cost;
    changes += 1;
  }

  if (body.unit !== undefined) {
    if (typeof body.unit !== "string") return { ok: false, reason: "unit harus berupa teks (mis. PCS, SAK, DUS)." };
    const unit = normalizeOrderCode(body.unit);
    if (!UNIT_PATTERN.test(unit)) {
      return { ok: false, reason: `unit "${body.unit}" tidak valid: 1–8 karakter huruf/angka, diawali huruf.` };
    }
    value.unit = unit;
    changes += 1;
  }

  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      return { ok: false, reason: "active harus true atau false (nonaktif = berhenti dijual, bukan dihapus)." };
    }
    value.active = body.active;
    changes += 1;
  }

  if (changes === 0) {
    return {
      ok: false,
      reason: `Tidak ada yang diubah. Sertakan minimal satu dari ${PRODUCT_PATCH_FIELDS.filter((field) => field !== "sku").join(", ")}.`,
    };
  }
  return { ok: true, value };
}

/** `DELETE /api/v1/products` — SKU produk yang akan dihapus. */
export function parseProductDelete(body: unknown): { ok: true; value: { sku: string } } | { ok: false; reason: string } {
  if (!isPlainObject(body)) return { ok: false, reason: "Body harus berupa objek JSON." };
  const stray = unknownField(body, ["sku"]);
  if (stray) return { ok: false, reason: stray };
  const sku = readSku(body);
  if (!sku.ok) return sku;
  return { ok: true, value: { sku: sku.value } };
}

/* -------------------------------------------------------------------- stok */

export interface StockAdjust {
  sku: string;
  /** Perubahan bertanda (mis. -3 untuk barang rusak). */
  delta?: number;
  /** Angka stok baru; mengalahkan delta kalau dua-duanya dikirim. */
  quantity?: number;
  note?: string;
}

/**
 * `POST /api/v1/stock/adjust` — satu produk, satu lokasi (lokasi jual toko).
 *
 * `delta` untuk koreksi relatif (barang rusak, selisih hitung), `quantity`
 * untuk menetapkan angka mutlak. Keduanya boleh pecahan karena ada produk yang
 * dijual per kilogram; yang tidak boleh adalah keduanya sekaligus — dua niat
 * dalam satu kiriman membuat hasilnya tidak bisa ditebak.
 */
export function parseStockAdjust(body: unknown): { ok: true; value: StockAdjust } | { ok: false; reason: string } {
  if (!isPlainObject(body)) return { ok: false, reason: "Body harus berupa objek JSON." };
  const stray = unknownField(body, ["sku", "delta", "quantity", "note"]);
  if (stray) return { ok: false, reason: stray };
  const sku = readSku(body);
  if (!sku.ok) return sku;

  const hasDelta = body.delta !== undefined && body.delta !== null;
  const hasQuantity = body.quantity !== undefined && body.quantity !== null;
  if (hasDelta && hasQuantity) {
    return { ok: false, reason: "Isi salah satu: delta (perubahan) atau quantity (angka baru), jangan dua-duanya." };
  }
  if (!hasDelta && !hasQuantity) {
    return { ok: false, reason: "Isi delta (mis. -2) atau quantity (angka stok baru)." };
  }

  const value: StockAdjust = { sku: sku.value };
  if (hasDelta) {
    if (typeof body.delta !== "number" || !Number.isFinite(body.delta)) {
      return { ok: false, reason: "delta harus angka (boleh negatif, boleh pecahan)." };
    }
    if (body.delta === 0) {
      return { ok: false, reason: "delta 0 tidak mengubah apa pun; hilangkan kirimannya kalau tidak ada koreksi." };
    }
    value.delta = body.delta;
  }
  if (hasQuantity) {
    if (typeof body.quantity !== "number" || !Number.isFinite(body.quantity) || body.quantity < 0) {
      return { ok: false, reason: "quantity harus angka ≥ 0." };
    }
    value.quantity = body.quantity;
  }

  const note = optionalText(body, "note", STOCK_NOTE_MAX);
  if (!note.ok) return note;
  if (note.value !== undefined) value.note = note.value;
  return { ok: true, value };
}

/* --------------------------------------------------------------- pelanggan */

export interface CustomerCreate {
  name: string;
  code?: string;
  phone?: string;
  creditLimit?: number;
  paymentTermDays?: number;
}

/**
 * `POST /api/v1/customers` — pelanggan B2B baru.
 *
 * `code` boleh dihilangkan: workspace membuat kode dari namanya (aturan
 * `lib/ar.ts`), lalu kode itu dikembalikan di balasan dan dipakai pada
 * `customerCode` pesanan berikutnya. Yang dikirim eksplisit tetap dihormati
 * supaya platform bisa mempertahankan kode pelanggannya sendiri.
 */
export function parseCustomerCreate(body: unknown): { ok: true; value: CustomerCreate } | { ok: false; reason: string } {
  if (!isPlainObject(body)) return { ok: false, reason: "Body harus berupa objek JSON." };
  const stray = unknownField(body, ["name", "code", "phone", "creditLimit", "paymentTermDays"]);
  if (stray) return { ok: false, reason: stray };

  if (typeof body.name !== "string") return { ok: false, reason: "name wajib diisi (nama pelanggan)." };
  const name = body.name.replace(/\s+/g, " ").trim();
  if (name.length === 0 || name.length > CUSTOMER_NAME_MAX) {
    return { ok: false, reason: `name wajib diisi, maksimal ${CUSTOMER_NAME_MAX} karakter.` };
  }
  const value: CustomerCreate = { name };

  if (body.code !== undefined && body.code !== null) {
    if (typeof body.code !== "string" || body.code.trim().length === 0) {
      return { ok: false, reason: "code harus berupa teks yang tidak kosong, atau dihilangkan agar dibuat server." };
    }
    value.code = body.code.trim();
  }
  const phone = optionalText(body, "phone", 24);
  if (!phone.ok) return phone;
  if (phone.value !== undefined) value.phone = phone.value;

  if (body.creditLimit !== undefined && body.creditLimit !== null) {
    if (
      typeof body.creditLimit !== "number" ||
      !Number.isFinite(body.creditLimit) ||
      body.creditLimit < 0 ||
      body.creditLimit > MAX_CREDIT_LIMIT ||
      !Number.isInteger(body.creditLimit)
    ) {
      return { ok: false, reason: `creditLimit harus bilangan bulat rupiah 0–${MAX_CREDIT_LIMIT}.` };
    }
    value.creditLimit = body.creditLimit;
  }
  if (body.paymentTermDays !== undefined && body.paymentTermDays !== null) {
    if (
      typeof body.paymentTermDays !== "number" ||
      !Number.isFinite(body.paymentTermDays) ||
      body.paymentTermDays < 0 ||
      !Number.isInteger(body.paymentTermDays)
    ) {
      return { ok: false, reason: "paymentTermDays harus bilangan bulat hari ≥ 0." };
    }
    value.paymentTermDays = body.paymentTermDays;
  }
  return { ok: true, value };
}

/* ------------------------------------------------------------------ member */

export interface MemberCreate {
  name: string;
  code?: string;
  phone?: string;
  discountPct?: number;
}

/** `POST /api/v1/members` — member pelanggan baru; kode dibuat kalau kosong. */
export function parseMemberCreate(body: unknown): { ok: true; value: MemberCreate } | { ok: false; reason: string } {
  if (!isPlainObject(body)) return { ok: false, reason: "Body harus berupa objek JSON." };
  const stray = unknownField(body, ["name", "code", "phone", "discountPct"]);
  if (stray) return { ok: false, reason: stray };

  if (typeof body.name !== "string") return { ok: false, reason: "name wajib diisi (nama member)." };
  const name = body.name.replace(/\s+/g, " ").trim();
  if (name.length === 0 || name.length > MEMBER_NAME_MAX) {
    return { ok: false, reason: `name wajib diisi, maksimal ${MEMBER_NAME_MAX} karakter.` };
  }
  const value: MemberCreate = { name };

  if (body.code !== undefined && body.code !== null) {
    if (typeof body.code !== "string" || body.code.trim().length === 0) {
      return { ok: false, reason: "code harus berupa teks yang tidak kosong, atau dihilangkan agar dibuat server." };
    }
    if (body.code.trim().length > MAX_MEMBER_CODE_LENGTH) {
      return { ok: false, reason: `code maksimal ${MAX_MEMBER_CODE_LENGTH} karakter.` };
    }
    value.code = body.code.trim();
  }
  const phone = optionalText(body, "phone", 24);
  if (!phone.ok) return phone;
  if (phone.value !== undefined) value.phone = phone.value;

  if (body.discountPct !== undefined && body.discountPct !== null) {
    if (typeof body.discountPct !== "number" || !Number.isFinite(body.discountPct) || body.discountPct < 0) {
      return { ok: false, reason: "discountPct harus angka ≥ 0 (persen)." };
    }
    value.discountPct = body.discountPct;
  }
  return { ok: true, value };
}

/* ------------------------------------------------------------------- void */

export interface VoidSaleInput {
  number: string;
  reason?: string;
}

const SALE_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,23}$/;

/**
 * `POST /api/v1/sales/void` — pembatalan lewat nomor struk.
 *
 * Nomor struk dipakai, bukan id internal, karena itulah yang dipegang platform
 * (dari `POST /api/v1/sales`). Pembatalan yang sudah pernah dilakukan dijawab
 * sukses (`alreadyVoided`) — sifatnya idempoten.
 */
export function parseVoidSale(body: unknown): { ok: true; value: VoidSaleInput } | { ok: false; reason: string } {
  if (!isPlainObject(body)) return { ok: false, reason: "Body harus berupa objek JSON." };
  const stray = unknownField(body, ["number", "reason"]);
  if (stray) return { ok: false, reason: stray };
  if (typeof body.number !== "string" || body.number.trim().length === 0) {
    return { ok: false, reason: "number wajib diisi (nomor struk penjualan, mis. A-00043)." };
  }
  const number = normalizeOrderCode(body.number);
  if (!SALE_NUMBER_PATTERN.test(number)) {
    return { ok: false, reason: `number "${body.number}" tidak valid; salin dari data.number pada penjualan.` };
  }
  const value: VoidSaleInput = { number };
  const reason = optionalText(body, "reason", VOID_REASON_MAX);
  if (!reason.ok) return reason;
  if (reason.value !== undefined) value.reason = reason.value;
  return { ok: true, value };
}

/* -------------------------------------------------------- webhook masuk */

export interface InboundEndpointCreate {
  name: string;
  events: string[];
  secret?: string;
  storeCode?: string;
}

const INBOUND_CREATE_FIELDS = ["name", "events", "secret", "storeCode"];

/**
 * `POST /api/v1/webhooks` — mendaftarkan endpoint webhook masuk.
 *
 * `secret` boleh dikirim (nilai yang sama dengan yang disimpan platform mitra)
 * atau dihilangkan supaya server membuatnya. Rahasianya dikembalikan **sekali**
 * pada balasan pembuatan.
 */
export function parseInboundEndpointCreate(
  body: unknown,
): { ok: true; value: InboundEndpointCreate } | { ok: false; reason: string } {
  if (!isPlainObject(body)) return { ok: false, reason: "Body harus berupa objek JSON." };
  const stray = unknownField(body, INBOUND_CREATE_FIELDS);
  if (stray) return { ok: false, reason: stray };

  if (typeof body.name !== "string") return { ok: false, reason: "name wajib diisi (nama endpoint)." };
  const name = body.name.replace(/\s+/g, " ").trim();
  if (name.length < INBOUND_NAME_MIN || name.length > INBOUND_NAME_MAX) {
    return { ok: false, reason: `name harus ${INBOUND_NAME_MIN}–${INBOUND_NAME_MAX} karakter.` };
  }

  if (!Array.isArray(body.events) || body.events.length === 0) {
    return { ok: false, reason: "events wajib berisi minimal satu nama event." };
  }
  if (body.events.some((event) => typeof event !== "string")) {
    return { ok: false, reason: "Setiap events harus berupa teks." };
  }
  const events = sanitizeInboundEvents(body.events as string[]);
  if (events.length === 0) {
    return {
      ok: false,
      reason: `Tidak ada event yang dikenal. Yang tersedia: ${INBOUND_EVENT_KEYS.join(", ")}.`,
    };
  }

  const value: InboundEndpointCreate = { name, events };
  if (body.secret !== undefined && body.secret !== null) {
    if (typeof body.secret !== "string") {
      return { ok: false, reason: "secret harus berupa teks." };
    }
    value.secret = body.secret;
  }
  if (body.storeCode !== undefined && body.storeCode !== null) {
    if (typeof body.storeCode !== "string" || body.storeCode.trim().length === 0) {
      return { ok: false, reason: "storeCode harus berupa teks yang tidak kosong, atau dihilangkan." };
    }
    value.storeCode = body.storeCode.trim();
  }
  return { ok: true, value };
}

/** `DELETE /api/v1/webhooks` — id endpoint yang dihapus. */
export function parseInboundEndpointDelete(body: unknown): { ok: true; value: { id: string } } | { ok: false; reason: string } {
  if (!isPlainObject(body)) return { ok: false, reason: "Body harus berupa objek JSON." };
  const stray = unknownField(body, ["id"]);
  if (stray) return { ok: false, reason: stray };
  if (typeof body.id !== "string" || body.id.trim().length === 0) {
    return { ok: false, reason: "id wajib diisi (id endpoint dari GET /api/v1/webhooks)." };
  }
  return { ok: true, value: { id: body.id.trim() } };
}

/* ------------------------------------------------- data peristiwa masuk */

/**
 * Membaca `storeCode` dari `data` sebuah peristiwa masuk. Dikembalikan `null`
 * kalau tidak disebut, sehingga endpoint memakai tokonya sendiri.
 */
export function inboundStoreCode(data: Record<string, unknown>): string | null {
  const raw = data.storeCode;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return null;
  const code = raw.trim();
  return code.length === 0 ? null : code.toUpperCase();
}

/** Batas panjang pesan penerima yang disimpan untuk riwayat. */
export const INBOUND_MESSAGE_MAX = 300;

/** Ringkas pesan galat agar riwayat tidak tumbuh mengikuti pesan internal. */
export function trimInboundMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, INBOUND_MESSAGE_MAX);
}

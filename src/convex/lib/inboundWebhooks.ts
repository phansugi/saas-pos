/**
 * Webhook **masuk** dari platform mitra (`api.access`) — aturan murni.
 *
 * `lib/webhooks.ts` mengatur arah keluar (MesinPOS → platform). Berkas ini
 * mengatur arah sebaliknya: platform mitra mengirim satu peristiwa, MesinPOS
 * memverifikasinya lalu menjalankan operasi yang sama dengan endpoint tulis
 * biasa. Tidak ada jalur logika kedua: pesanan masuk lewat `pos.createSale`,
 * penyesuaian stok lewat `products.adjustStock`, dan seterusnya.
 *
 * Tiga keputusan yang perlu diketahui:
 *
 * 1. **URL bukan rahasia.** Token di URL (`/api/v1/webhooks/incoming/<token>`)
 *    hanya menunjuk endpoint mana yang dituju. Yang membuktikan kiriman itu
 *    benar dari mitra adalah tanda tangan HMAC atas `timestamp.body` memakai
 *    `secret` endpoint — skema yang sama dengan webhook keluar, jadi satu
 *    contoh verifikasi berlaku untuk dua arah.
 * 2. **`id` dari mitra adalah kunci idempotensi.** Kiriman ulang setelah
 *    timeout tidak boleh menjadi dua penjualan atau dua penyesuaian stok. Id
 *    yang sama pada endpoint yang sama dijawab `duplicate`.
 * 3. **Event di luar langganan ditolak.** Endpoint memilih event yang boleh
 *    dikirim; event lain dijawab 400 dengan daftar yang dilanggan, bukan
 *    diabaikan diam-diam — mitra perlu tahu kirimannya tidak diproses.
 */

import { verifyWebhookSignature, WEBHOOK_TOLERANCE_MS } from "./webhooks";

export interface InboundEventDefinition {
  key: string;
  label: string;
  description: string;
  /** Bentuk `data` yang diharapkan, untuk dokumentasi & pesan galat. */
  dataShape: string;
}

/**
 * Peristiwa yang boleh dikirim platform mitra. Kuncinya stabil; mengganti nama
 * lama akan memutus integrasi yang sudah berjalan.
 */
export const INBOUND_WEBHOOK_EVENTS: InboundEventDefinition[] = [
  {
    key: "order.created",
    label: "Pesanan baru dari platform",
    description:
      "Pesanan platform dicatat sebagai penjualan MesinPOS — harga, PPN, dan stok tetap dihitung server.",
    dataShape:
      "{ lines: [{ sku, quantity, unitCode?, modifiers? }], payment: { method, amount?, provider?, providerRef? }, discount?, customerCode?, memberCode?, storeCode? }",
  },
  {
    key: "stock.adjusted",
    label: "Stok disesuaikan",
    description:
      "Satu produk disesuaikan stoknya di lokasi jual (delta) atau ditetapkan ke angka tertentu (quantity).",
    dataShape: "{ sku, delta? , quantity?, note?, storeCode? }",
  },
  {
    key: "product.updated",
    label: "Produk/harga berubah",
    description:
      "Harga, nama, satuan, atau status aktif satu produk diubah dari sisi mitra — dipakai saat platform memegang keputusan harga.",
    dataShape: "{ sku, name?, price?, unit?, active?, cost?, storeCode? }",
  },
  {
    key: "sale.voided",
    label: "Penjualan dibatalkan",
    description:
      "Penjualan MesinPOS dibatalkan lewat nomornya; stok kembali dan piutang yang belum dibayar ikut dibatalkan.",
    dataShape: "{ number, reason? }",
  },
];

export const INBOUND_EVENT_KEYS: string[] = INBOUND_WEBHOOK_EVENTS.map(
  (event) => event.key,
);

export function isInboundEvent(value: string): boolean {
  return INBOUND_EVENT_KEYS.includes(value);
}

/** Buang event tak dikenal & duplikat, kembalikan urutan katalog. */
export function sanitizeInboundEvents(
  events: readonly string[] | null | undefined,
): string[] {
  const wanted = new Set(events ?? []);
  return INBOUND_EVENT_KEYS.filter((key) => wanted.has(key));
}

export const INBOUND_TOKEN_PREFIX = "whi_";
export const INBOUND_TOKEN_LENGTH = 20;
export const INBOUND_TOKEN_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const INBOUND_SECRET_LENGTH = 40;
export const INBOUND_SECRET_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const MAX_INBOUND_ENDPOINTS = 5;
export const INBOUND_NAME_MIN = 3;
export const INBOUND_NAME_MAX = 40;
/** `id` peristiwa dari mitra; dipakai sebagai kunci idempotensi. */
export const INBOUND_EVENT_ID_MAX = 80;
export const INBOUND_PAYLOAD_MAX = 64_000;

/** Alfabet token membuang 0/O/1/l/I supaya tidak salah baca saat ditempel. */
export function isInboundToken(value: string): boolean {
  return (
    typeof value === "string" &&
    value.startsWith(INBOUND_TOKEN_PREFIX) &&
    value.length === INBOUND_TOKEN_PREFIX.length + INBOUND_TOKEN_LENGTH &&
    new RegExp(`^[${INBOUND_TOKEN_ALPHABET}]+$`).test(
      value.slice(INBOUND_TOKEN_PREFIX.length),
    )
  );
}

/** Empat karakter terakhir rahasia; cukup untuk membedakan dua endpoint. */
export function maskInboundSecret(secret: string): string {
  return `••••${secret.slice(-4)}`;
}

export interface InboundEndpointInput {
  name: string;
  events: readonly string[];
}

export interface InboundEndpointDraft {
  name: string;
  events: string[];
}

export type InboundValidation =
  | { ok: true; value: InboundEndpointDraft }
  | { ok: false; reason: string };

/**
 * Memeriksa konfigurasi endpoint masuk. `existingNames` & `activeCount`
 * mencegah dua endpoint bernama sama (sulit dibedakan saat mitra bertanya) dan
 * jumlah endpoint yang tak terkendali.
 */
export function validateInboundEndpointInput(
  input: InboundEndpointInput,
  options: { existingNames?: readonly string[]; activeCount?: number } = {},
): InboundValidation {
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < INBOUND_NAME_MIN || name.length > INBOUND_NAME_MAX) {
    return {
      ok: false,
      reason: `Nama endpoint harus ${INBOUND_NAME_MIN}–${INBOUND_NAME_MAX} karakter.`,
    };
  }
  const used = new Set(
    (options.existingNames ?? []).map((value) => value.trim().toLowerCase()),
  );
  if (used.has(name.toLowerCase())) {
    return {
      ok: false,
      reason: `Endpoint "${name}" sudah ada; pakai nama lain supaya kiriman mitra bisa dibedakan.`,
    };
  }
  if ((options.activeCount ?? 0) >= MAX_INBOUND_ENDPOINTS) {
    return {
      ok: false,
      reason: `Maksimal ${MAX_INBOUND_ENDPOINTS} endpoint webhook masuk per workspace; hapus yang tidak dipakai dulu.`,
    };
  }
  const events = sanitizeInboundEvents(input.events);
  if (events.length === 0) {
    return {
      ok: false,
      reason: `Pilih minimal satu event; yang tersedia: ${INBOUND_EVENT_KEYS.join(", ")}.`,
    };
  }
  return { ok: true, value: { name, events } };
}

/** Alamat yang ditempel mitra: `<base>/api/v1/webhooks/incoming/<token>`. */
export const INBOUND_WEBHOOK_PATH = "/api/v1/webhooks/incoming";

export function inboundWebhookUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${INBOUND_WEBHOOK_PATH}/${token}`;
}

export interface InboundHeaders {
  timestamp: string | null;
  signature: string | null;
  event: string | null;
  eventId: string | null;
}

export const INBOUND_HEADERS = {
  timestamp: "x-mesinpos-timestamp",
  signature: "x-mesinpos-signature",
  event: "x-mesinpos-event",
  eventId: "x-mesinpos-event-id",
} as const;

/**
 * Alasan kiriman mitra ditolak, atau `null` kalau tanda tangannya sah.
 *
 * Urutannya disengaja: header yang hilang dilaporkan lebih dulu (murah dan
 * bisa langsung diperbaiki mitra), baru tanda tangan dihitung. Pesannya tidak
 * pernah membocorkan rahasia — hanya menyebut header mana yang salah.
 */
export function inboundSignatureProblem(input: {
  secret: string;
  body: string;
  headers: InboundHeaders;
  now: number;
}): string | null {
  const timestamp = Number(input.headers.timestamp);
  if (!input.headers.timestamp || !Number.isFinite(timestamp)) {
    return `Header ${INBOUND_HEADERS.timestamp} wajib berisi milidetik epoch.`;
  }
  if (!input.headers.signature) {
    return `Header ${INBOUND_HEADERS.signature} wajib berisi sha256=<hex>.`;
  }
  const fresh = Math.abs(input.now - timestamp) <= WEBHOOK_TOLERANCE_MS;
  if (!fresh) {
    return `Kiriman basi: selisih waktu melebihi ${Math.round(
      WEBHOOK_TOLERANCE_MS / 60000,
    )} menit. Kirim ulang dengan timestamp sekarang.`;
  }
  const valid = verifyWebhookSignature({
    secret: input.secret,
    timestamp,
    body: input.body,
    signature: input.headers.signature,
    now: input.now,
  });
  if (!valid) {
    return "Tanda tangan tidak cocok. Hitung HMAC-SHA256(secret, `${timestamp}.${body}`) persis seperti badan yang dikirim.";
  }
  return null;
}

export interface InboundEnvelope {
  id: string;
  event: string;
  data: Record<string, unknown>;
}

export type InboundEnvelopeParse =
  | { ok: true; value: InboundEnvelope }
  | { ok: false; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Mengurai badan kiriman mitra: `{ id, event, data }`. `id` wajib karena
 * idempotensi bergantung padanya; event boleh datang dari header (dipakai kalau
 * badan tidak menyebutnya) dan keduanya harus sepakat bila dua-duanya ada.
 */
export function parseInboundEnvelope(
  raw: string,
  headers: InboundHeaders,
): InboundEnvelopeParse {
  if (raw.length === 0) return { ok: false, reason: "Badan kiriman kosong." };
  if (raw.length > INBOUND_PAYLOAD_MAX) {
    return {
      ok: false,
      reason: `Badan kiriman melebihi ${INBOUND_PAYLOAD_MAX} karakter.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "Badan kiriman bukan JSON valid." };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, reason: "Badan kiriman harus berupa objek JSON." };
  }

  const rawId = parsed.id ?? headers.eventId;
  if (typeof rawId !== "string" || rawId.trim().length === 0) {
    return {
      ok: false,
      reason: `id peristiwa wajib diisi (badan "id" atau header ${INBOUND_HEADERS.eventId}).`,
    };
  }
  const id = rawId.trim();
  if (id.length > INBOUND_EVENT_ID_MAX) {
    return {
      ok: false,
      reason: `id peristiwa maksimal ${INBOUND_EVENT_ID_MAX} karakter.`,
    };
  }

  const bodyEvent = typeof parsed.event === "string" ? parsed.event.trim() : "";
  const headerEvent = (headers.event ?? "").trim();
  if (bodyEvent && headerEvent && bodyEvent !== headerEvent) {
    return {
      ok: false,
      reason: `Event di badan ("${bodyEvent}") berbeda dengan header ${INBOUND_HEADERS.event} ("${headerEvent}").`,
    };
  }
  const event = bodyEvent || headerEvent;
  if (!event) {
    return {
      ok: false,
      reason: `event wajib diisi (badan "event" atau header ${INBOUND_HEADERS.event}).`,
    };
  }
  if (!isInboundEvent(event)) {
    return {
      ok: false,
      reason: `Event "${event}" tidak dikenal. Yang tersedia: ${INBOUND_EVENT_KEYS.join(", ")}.`,
    };
  }

  const data = parsed.data;
  if (!isPlainObject(data)) {
    return { ok: false, reason: "data wajib berupa objek JSON." };
  }

  return { ok: true, value: { id, event, data } };
}

/** Ringkas untuk halaman/riwayat: “order.created · applied · A-00043”. */
export function describeInboundEvent(event: {
  event: string;
  status: string;
  message?: string | null;
}): string {
  return [event.event, event.status, event.message]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(" · ");
}

/**
 * Catatan aturan yang ditampilkan di dokumentasi & halaman — satu tempat supaya
 * dokumentasi tidak menjanjikan perilaku yang berbeda dari penerimanya.
 */
export const INBOUND_WEBHOOK_NOTES: string[] = [
  "URL endpoint memuat token penunjuk; tanda tangan HMAC tetap wajib, jadi bocornya URL saja tidak cukup untuk menulis data.",
  "Tanda tangan memakai skema yang sama dengan webhook keluar: `sha256=HMAC(secret, timestamp + \".\" + badan)`, toleransi 5 menit.",
  "`id` peristiwa dari mitra adalah kunci idempotensi: kiriman ulang dijawab `duplicate` tanpa menjalankan operasinya dua kali.",
  "Operasi dijalankan sebagai pembuat endpoint, jadi izinnya sama dengan orang yang memasang endpoint (mis. `pos.sell` untuk pesanan).",
  "Event di luar langganan endpoint ditolak dengan daftar event yang dilanggan — bukan diabaikan diam-diam.",
  "Mitra yang tidak menerima balasan 2xx dianjurkan mengirim ulang dengan `id` yang sama; MesinPOS tidak menyimpan antrean kiriman masuk.",
];

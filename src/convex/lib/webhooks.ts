/**
 * Webhook keluar (`api.access`, Phase 4) — aturan murni.
 *
 * Ini sisi **keluar**: notifikasi yang kita kirim ke server tenant saat sesuatu
 * terjadi di MesinPOS. Berbeda dari `src/convex/http.ts` yang menerima callback
 * dari provider pembayaran, di sini kita yang menjadi pengirim.
 *
 * Empat hal yang diatur modul ini, semuanya murni supaya bisa diuji tanpa
 * jaringan:
 *
 * 1. **Katalog event.** Hanya event yang dikenal yang bisa dilanggan, ditulis
 *    sebagai `objek.aksi` (`sale.completed`) supaya nama event stabil walau
 *    labelnya berubah.
 * 2. **Validasi endpoint.** URL wajib HTTPS dan menunjuk host publik — webhook
 *    ke `http://` atau ke alamat dalam jaringan adalah cara termudah
 *    membocorkan data penjualan, jadi ditolak dengan alasan yang terbaca.
 * 3. **Tanda tangan payload** (HMAC-SHA256 atas `timestamp.body`) supaya
 *    penerima bisa membuktikan kiriman kita, bukan kiriman orang lain; ditambah
 *    toleransi jam agar penerima bisa menolak kiriman basi.
 * 4. **Jadwal percobaan ulang** yang menaik lalu menyerah — 5 percobaan dalam
 *    ± 14 jam; kegagalan permanen harus berakhir sebagai `failed` yang kelihatan
 *    di halaman, bukan antrean tak berujung. Yang **menjalankan** jadwal itu
 *    `src/convex/crons.ts` lewat `apiAccess.retryDueDeliveries`, dan aturan
 *    pekerja (batas per putaran, kapan berhenti) juga murni di sini supaya
 *    bisa diuji tanpa jaringan.
 */

import { hmacSha256Hex, timingSafeEqualHex } from "./hash";

export interface WebhookEventDefinition {
  key: string;
  label: string;
  description: string;
}

/**
 * Event yang boleh dilanggan. Kuncinya memakai bentuk `objek.aksi` dan
 * **tidak** boleh diubah setelah dipakai tenant: itu yang tertulis di endpoint
 * mereka. Menambah event baru selalu aman; mengganti nama lama tidak.
 */
export const WEBHOOK_EVENTS: WebhookEventDefinition[] = [
  {
    key: "sale.completed",
    label: "Penjualan selesai",
    description: "Satu transaksi selesai dibayar, lengkap dengan nomor struk dan totalnya.",
  },
  {
    key: "sale.voided",
    label: "Penjualan dibatalkan",
    description: "Transaksi dibatalkan; stok dikembalikan dan uangnya tidak dihitung.",
  },
  {
    key: "stock.low",
    label: "Stok menipis",
    description: "Stok sebuah produk menyentuh batas minimum yang ditetapkan.",
  },
  {
    key: "opname.posted",
    label: "Opname diposting",
    description: "Hasil hitung fisik diposting; selisihnya menjadi riwayat audit.",
  },
  {
    key: "support.created",
    label: "Tiket dukungan dibuka",
    description: "Tiket dukungan baru dibuat, lengkap dengan prioritas & janji tanggapnya.",
  },
  {
    key: "support.escalated",
    label: "Tiket dieskalasi",
    description: "Tiket diteruskan ke manajer akun (jalur dukungan khusus).",
  },
  {
    key: "support.resolved",
    label: "Tiket dukungan ditutup",
    description: "Tiket selesai; disebutkan apakah janji tanggapnya terpenuhi.",
  },
  {
    key: "support.due",
    label: "Janji tanggap dekat / terlewat",
    description: "Tiket berjalan hampir — atau sudah — melewati janji tanggapnya.",
  },
  {
    key: "payable.due",
    label: "Hutang usaha jatuh tempo",
    description: "Tagihan supplier sudah waktunya dibayar.",
  },
  {
    key: "receivable.overdue",
    label: "Piutang lewat tempo",
    description: "Piutang B2B melewati jatuh temponya dan belum lunas.",
  },
  {
    key: "shift.alert",
    label: "Kas belum dibuka / shift belum ditutup",
    description:
      "Kas belum dibuka padahal toko sudah buka, atau shift belum ditutup padahal toko sudah tutup.",
  },
  {
    key: "product.created",
    label: "Produk baru dibuat",
    description:
      "Satu produk masuk ke katalog untuk pertama kalinya — lengkap dengan SKU, harga, satuan, dan kategorinya.",
  },
  {
    key: "product.updated",
    label: "Produk berubah",
    description:
      "Nama, SKU, harga, satuan, kategori/subkategori, atau status produk berubah — termasuk harga & katalog baru yang harus dipakai platform.",
  },
  {
    key: "stock.changed",
    label: "Stok berubah",
    description:
      "Satu pergerakan stok tercatat: penjualan, pembelian, opname, penyesuaian, atau perpindahan gudang.",
  },
  {
    key: "purchase.received",
    label: "Barang dari supplier diterima",
    description:
      "Penerimaan barang (GRN) tercatat — stok bertambah dan hutang supplier lahir pada transaksi yang sama.",
  },
];

export const WEBHOOK_EVENT_KEYS: string[] = WEBHOOK_EVENTS.map((event) => event.key);

export const WEBHOOK_URL_MAX = 300;
export const WEBHOOK_DESCRIPTION_MAX = 120;
export const MAX_WEBHOOK_ENDPOINTS = 10;
/** Batas jumlah event per endpoint (katalognya sendiri 11). */
export const MAX_WEBHOOK_EVENTS = WEBHOOK_EVENTS.length;

/** Berapa lama tanda tangan masih dianggap segar. */
export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

export const MAX_DELIVERY_ATTEMPTS = 5;
/** Jeda antar-percobaan (menit): 1, 5, 30, 120, 720 — total ± 14,6 jam. */
export const DELIVERY_BACKOFF_MINUTES = [1, 5, 30, 120, 720];

/**
 * Seberapa sering pekerja terjadwal (`src/convex/crons.ts`) memeriksa kiriman
 * yang jatuh tempo, dalam menit. Jeda percobaan terkecil juga 1 menit, jadi
 * memeriksa lebih sering tidak mempercepat apa pun — hanya membebani database.
 */
export const RETRY_WORKER_INTERVAL_MINUTES = 1;

/**
 * Batas kiriman per putaran pekerja. Satu putaran mengerjakan paling banyak
 * sebanyak ini; sisanya menunggu putaran berikutnya, supaya lonjakan kegagalan
 * (mis. satu penerima mati untuk banyak endpoint) tidak menguras kuota dalam
 * satu tarikan napas dan tidak menahan penerima lain.
 */
export const MAX_RETRY_BATCH = 20;

export function isWebhookEvent(value: string): boolean {
  return WEBHOOK_EVENT_KEYS.includes(value);
}

/** Buang event tak dikenal & duplikat, kembalikan urutan katalog. */
export function sanitizeWebhookEvents(events: readonly string[] | null | undefined): string[] {
  const wanted = new Set(events ?? []);
  return WEBHOOK_EVENT_KEYS.filter((key) => wanted.has(key));
}

export interface WebhookEndpointInput {
  url: string;
  description?: string;
  events: readonly string[];
}

export interface WebhookEndpointDraft {
  url: string;
  description?: string;
  events: string[];
}

export type WebhookValidation =
  | { ok: true; value: WebhookEndpointDraft }
  | { ok: false; reason: string };

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /\.local$/i,
  /\.internal$/i,
  /^0\./,
];

/**
 * Host yang tidak boleh dituju webhook. Dipisah dari validator supaya halaman
 * dan harness bisa menyebut **alasan** yang sama persis dengan server.
 */
export function webhookHostError(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "URL endpoint tidak valid.";
  }
  if (parsed.protocol !== "https:") {
    return "Webhook wajib memakai HTTPS; HTTP biasa akan membocorkan data penjualan.";
  }
  if (parsed.username || parsed.password) {
    return "URL tidak boleh memuat kredensial.";
  }
  const host = parsed.hostname;
  if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    return "Host tujuan harus publik — alamat lokal/jaringan dalam tidak dilayani.";
  }
  if (!host.includes(".")) {
    return "Host tujuan harus berupa domain, bukan nama mesin tunggal.";
  }
  return null;
}

export function validateWebhookEndpoint(
  input: WebhookEndpointInput,
  options: { existingUrls?: readonly string[] } = {},
): WebhookValidation {
  const url = (input.url ?? "").trim();
  if (url.length === 0) return { ok: false, reason: "URL endpoint wajib diisi." };
  if (url.length > WEBHOOK_URL_MAX) {
    return { ok: false, reason: `URL maksimal ${WEBHOOK_URL_MAX} karakter.` };
  }
  const hostError = webhookHostError(url);
  if (hostError) return { ok: false, reason: hostError };

  const normalized = new URL(url).toString();
  const used = new Set((options.existingUrls ?? []).map((value) => value.trim()));
  if (used.has(normalized)) {
    return { ok: false, reason: "Endpoint dengan URL ini sudah terdaftar." };
  }

  const events = sanitizeWebhookEvents(input.events);
  if (events.length === 0) {
    return { ok: false, reason: "Pilih minimal satu event yang mau dikirim." };
  }

  const description = (input.description ?? "").trim().slice(0, WEBHOOK_DESCRIPTION_MAX);

  return {
    ok: true,
    value: {
      url: normalized,
      description: description.length > 0 ? description : undefined,
      events,
    },
  };
}

/**
 * Penanda kejadian yang dipakai di dalam `id` kiriman (nomor struk, SKU, nomor
 * opname).
 *
 * Dibersihkan ke huruf/angka/`-`/`_` dan dipotong 40 karakter: id kiriman
 * dipakai penerima untuk mengenali kiriman yang sama, jadi ia harus aman
 * disisipkan ke JSON (tanpa kutip/spasi) dan tidak boleh tumbuh mengikuti isi
 * dokumen. Nilai yang seluruhnya terbuang (mis. hanya tanda baca) jatuh ke id
 * tanpa penanda. Nilai yang sama selalu menghasilkan id yang sama.
 */
export function sanitizeEventSubject(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Payload yang dikirim: bentuknya stabil supaya penerima bisa menyimpan apa
 * adanya.
 *
 * `subject` (opsional) menandai **kejadian** yang menghasilkannya. Tanpa itu,
 * dua penjualan pada milidetik yang sama akan berbagi `id` yang sama — dan
 * penerima yang memakai `id` untuk menolak kiriman kembar justru membuang
 * penjualan yang sah. Kiriman percobaan tidak memakainya.
 */
export function webhookPayload(input: {
  event: string;
  data: unknown;
  at: number;
  subject?: string;
}): string {
  const subject = sanitizeEventSubject(input.subject);
  return JSON.stringify({
    id: `evt_${input.at}_${input.event}${subject ? `_${subject}` : ""}`,
    event: input.event,
    createdAt: new Date(input.at).toISOString(),
    data: input.data,
  });
}

/**
 * Tanda tangan kiriman: `sha256=<hmac>` atas `timestamp.body` (pola yang sama
 * dengan provider pembayaran umum), sehingga isi dan waktu kirimnya sama-sama
 * terlindungi — payload yang diubah atau dikirim ulang akan gagal diverifikasi.
 */
export function signWebhookPayload(
  secret: string,
  timestamp: number,
  body: string,
): string {
  return `sha256=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

/** Verifikasi tanda tangan penerima, sekaligus menolak kiriman basi. */
export function verifyWebhookSignature(input: {
  secret: string;
  timestamp: number;
  body: string;
  signature: string;
  now: number;
  toleranceMs?: number;
}): boolean {
  const tolerance = input.toleranceMs ?? WEBHOOK_TOLERANCE_MS;
  if (Math.abs(input.now - input.timestamp) > tolerance) return false;
  return timingSafeEqualHex(
    input.signature,
    signWebhookPayload(input.secret, input.timestamp, input.body),
  );
}

/** Jeda sebelum percobaan ke-`attempts + 1` (menit), atau null kalau menyerah. */
export function deliveryBackoffMinutes(attempts: number): number | null {
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return null;
  const index = Math.max(0, attempts - 1);
  return DELIVERY_BACKOFF_MINUTES[Math.min(index, DELIVERY_BACKOFF_MINUTES.length - 1)];
}

/** Kapan percobaan berikutnya dijalankan; null = tidak ada lagi percobaan. */
export function nextDeliveryAttemptAt(attempts: number, now: number): number | null {
  const minutes = deliveryBackoffMinutes(attempts);
  if (minutes === null) return null;
  return now + minutes * 60 * 1000;
}

export type DeliveryOutcome = "pending" | "failed";

/** Status setelah percobaan ke-`attempts`: masih akan dicoba, atau sudah menyerah. */
export function deliveryOutcome(attempts: number): DeliveryOutcome {
  return deliveryBackoffMinutes(attempts) === null ? "failed" : "pending";
}

/**
 * Batas kiriman per putaran untuk sebuah permintaan pekerja.
 *
 * Nilai di luar akal (negatif, nol, pecahan, bukan angka, tidak dikirim)
 * dijatuhkan ke `MAX_RETRY_BATCH`; yang masuk akal dijepit — jadi pekerja tidak
 * pernah berjalan tanpa batas hanya karena salah argumen.
 */
export function retryBatchLimit(requested?: number): number {
  if (requested === undefined || Number.isNaN(requested)) return MAX_RETRY_BATCH;
  return Math.min(MAX_RETRY_BATCH, Math.max(1, Math.trunc(requested)));
}

/**
 * Alasan pekerja **berhenti** mengirim ulang, atau `null` kalau kiriman masih
 * boleh dicoba.
 *
 * Mematikan atau menghapus endpoint adalah cara tenant bilang “jangan kirim
 * lagi”. Pekerja menghormatinya dengan menutup kiriman yang menggantung sebagai
 * `failed` — bukan mengirimkannya diam-diam, dan bukan pula membiarkannya
 * `pending` selamanya sampai seolah-olah masih dalam proses.
 */
export function retryStopReason(endpoint: { active: boolean } | null): string | null {
  if (!endpoint) return "Endpoint webhook sudah dihapus; kiriman dihentikan.";
  if (!endpoint.active) return "Endpoint webhook dinonaktifkan; percobaan ulang dihentikan.";
  return null;
}

/** Panjang rahasia penanda tangan yang boleh dipakai. */
export const WEBHOOK_SECRET_MIN = 16;
export const WEBHOOK_SECRET_MAX = 128;

/**
 * Memeriksa rahasia yang **diketik pemilik** — biasanya nilai yang sama dengan
 * yang disimpan penerimanya (mis. kolom rahasia MesinPOS di Pengaturan
 * marketplace).
 *
 * Tanpa jalur ini, satu-satunya cara menyamakan rahasia adalah memutar rahasia
 * di MesinPOS lalu menyalinnya ke penerima — dan kalau penerimanya yang lebih
 * dulu punya rahasia, pemilik tidak punya cara apa pun (itulah yang membuat
 * kiriman stok berhenti di 401).
 *
 * Aturannya ketat karena nilai ini masuk ke header HTTP dan HMAC: tanpa spasi,
 * karakter kontrol, atau huruf non-ASCII (tanda hubung tipografi dan koma
 * “pintar” dari salin-tempel dokumen sering lolos dari pemeriksaan mata).
 */
export function validateWebhookSecret(
  value: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  const secret = (value ?? "").trim();
  if (secret.length === 0) {
    return { ok: false, reason: "Rahasia penanda tangan wajib diisi." };
  }
  if (secret.length < WEBHOOK_SECRET_MIN) {
    return {
      ok: false,
      reason: `Rahasia minimal ${WEBHOOK_SECRET_MIN} karakter; nilai yang lebih pendek terlalu mudah ditebak.`,
    };
  }
  if (secret.length > WEBHOOK_SECRET_MAX) {
    return { ok: false, reason: `Rahasia maksimal ${WEBHOOK_SECRET_MAX} karakter.` };
  }
  if (!/^[\x21-\x7E]+$/.test(secret)) {
    return {
      ok: false,
      reason:
        "Rahasia tidak boleh memuat spasi, karakter kontrol, atau huruf non-ASCII (mis. tanda hubung tipografi hasil salin-tempel).",
    };
  }
  return { ok: true, value: secret };
}

/** Batas panjang pesan penerima yang disimpan dari balasan gagal. */
export const RECEIVER_FAILURE_MESSAGE_MAX = 200;

/**
 * Keterangan kegagalan yang **menyebut pesan penerimanya**, bukan hanya status.
 *
 * Banyak penerima menolak kiriman dengan alasan yang bisa langsung ditindaklanjuti
 * — mis. “Tanda tangan tidak cocok — pastikan rahasia endpoint … sama dengan yang
 * diisi di Pengaturan.” Tanpa pesan itu, riwayat kiriman hanya berbunyi “Penerima
 * menjawab 401”, dan pemilik tidak tahu apa yang harus diperbaiki. Penerima yang
 * tidak menjawab apa-apa (atau menjawab bukan JSON) tetap ditulis apa adanya
 * sebagai “Penerima menjawab <status>.”
 *
 * Fungsi murni: dipakai jalur kirim, riwayat, dan harness.
 */
export function describeReceiverFailure(statusCode: number, bodyText: string): string {
  const base = `Penerima menjawab ${statusCode}.`;
  const text = (bodyText ?? "").replace(/\s+/g, " ").trim();
  if (text === "") return base;

  let detail = text;
  try {
    const parsed: unknown = JSON.parse(text);
    const record =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    const message = record
      ? [record.error, record.message, record.detail].find(
          (value) => typeof value === "string" && value.trim() !== "",
        )
      : undefined;
    if (typeof message === "string") detail = message.trim();
  } catch {
    // Bukan JSON: teks balasannya tetap dipakai, hanya dirapatkan spasinya.
  }

  return `${base} Pesan penerima: ${detail.slice(0, RECEIVER_FAILURE_MESSAGE_MAX)}`;
}

/**
 * Header satu kiriman webhook — **satu-satunya** tempat yang menandatangani
 * badan kiriman, jadi jalur kirim uji dan jalur percobaan ulang tidak mungkin
 * memakai skema tanda tangan yang berbeda.
 *
 * `x-mesinpos-attempt` menyebut ini percobaan ke berapa, sehingga penerima bisa
 * membedakan kiriman pertama dari percobaan ulang; badan kiriman sendiri tidak
 * berubah antar-percobaan, jadi id di dalam badan tetap nilai yang sama untuk
 * dikenali penerima sebagai kiriman yang sama (bukan penjualan kedua).
 */
export function webhookDeliveryHeaders(input: {
  secret: string;
  timestamp: number;
  event: string;
  attempt: number;
  body: string;
}): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-mesinpos-event": input.event,
    "x-mesinpos-attempt": String(input.attempt),
    "x-mesinpos-timestamp": String(input.timestamp),
    "x-mesinpos-signature": signWebhookPayload(
      input.secret,
      input.timestamp,
      input.body,
    ),
  };
}

export function describeWebhookEndpoint(endpoint: {
  url: string;
  events: readonly string[];
}): string {
  let host = endpoint.url;
  try {
    host = new URL(endpoint.url).host;
  } catch {
    /* URL rusak: tampilkan apa adanya, halaman tetap bisa dibaca */
  }
  return `${host} · ${sanitizeWebhookEvents(endpoint.events).length} event`;
}

/** Isi contoh untuk uji kirim; dipakai halaman & tombol “Kirim uji”. */
export function sampleDeliveryEvent(events: readonly string[]): string {
  const clean = sanitizeWebhookEvents(events);
  return clean[0] ?? "sale.completed";
}

export function sampleDeliveryPayload(event: string, now: number): string {
  return webhookPayload({
    event,
    at: now,
    data: {
      store: "Contoh",
      number: "A-00001",
      total: 0,
      note: "Kiriman uji dari halaman API & Webhook.",
    },
  });
}

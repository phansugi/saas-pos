/**
 * Sinkronisasi real-time multi-perangkat (`sync.realtime`, Phase 6) — aturan
 * murni.
 *
 * Modul ini dipakai bersama oleh backend (`src/convex/sync.ts`), halaman
 * Sinkronisasi, kedua store, dan harness, jadi semua keputusan ada di sini
 * (Convex hanya membundel modul di bawah `src/convex`).
 *
 * Lima prinsipnya:
 *
 * 1. **Kehadiran perangkat dihitung dari detak terakhir, bukan disimpan.**
 *    Perangkat tidak pernah "menyalakan" status online-nya; yang ada hanya
 *    `lastSeenAt`, dan online/idle/offline diturunkan dari jaraknya ke sekarang.
 *    Jadi perangkat yang baterainya mati langsung terlihat offline tanpa perlu
 *    apa pun membersihkannya.
 * 2. **Setiap perubahan punya revisi yang naik satu-satu.** Revisi adalah urutan
 *    global per tenant, sehingga "apa yang belum saya lihat" selalu bisa
 *    dijawab dengan satu angka (`pullWindow`), bukan dengan membandingkan
 *    seluruh riwayat.
 * 3. **Konflik diselesaikan dengan aturan yang bisa diuji, bukan tebak-tebakan.**
 *    Kalau perangkat mendorong perubahan di atas basis yang sudah basi, yang
 *    menang adalah `updatedAt` terbaru; kalau seri, `deviceId` yang lebih besar
 *    yang menang — deterministik, jadi dua pelanggan tidak melihat hasil berbeda.
 * 4. **Jam yang melenceng ditolak, bukan dipakai.** Perangkat dengan `updatedAt`
 *    jauh di masa depan tidak boleh "menang" selamanya hanya karena jamnya salah;
 *    perubahannya ditolak dengan alasan yang menyebut selisihnya.
 * 5. **Mendorong perubahan baru butuh fitur `sync.realtime`; menarik, menandai
 *    konflik selesai, dan detak selalu boleh.** Kalau paket turun, perangkat
 *    tetap bisa mengosongkan perubahan terakhirnya dan menyelesaikan konflik
 *    yang sudah terbuka.
 */

// ------------------------------------------------------------- platform

export type SyncPlatform = "web" | "android" | "ios" | "desktop";

export const SYNC_PLATFORM_LABELS: Record<SyncPlatform, string> = {
  web: "Kasir web",
  android: "Tablet Android",
  ios: "iPad / iOS",
  desktop: "Aplikasi desktop",
};

export const SYNC_PLATFORM_KEYS = Object.keys(
  SYNC_PLATFORM_LABELS,
) as SyncPlatform[];

export function isSyncPlatform(value: string): value is SyncPlatform {
  return (SYNC_PLATFORM_KEYS as string[]).includes(value);
}

// ------------------------------------------------------------- kehadiran

export const ONLINE_WINDOW_MS = 60 * 1000;
export const IDLE_WINDOW_MS = 5 * 60 * 1000;

export type PresenceState = "online" | "idle" | "offline";

export const PRESENCE_LABELS: Record<PresenceState, string> = {
  online: "Online",
  idle: "Menganggur",
  offline: "Offline",
};

/**
 * Kehadiran sebuah perangkat: online ≤ 1 menit sejak detak terakhir, idle ≤ 5
 * menit, selebihnya offline. Ambangnya sengaja pendek supaya kasir yang
 * menutup laptopnya langsung terlihat, bukan menunggu menit-menitan.
 */
export function presenceState(lastSeenAt: number, now: number): PresenceState {
  const age = now - lastSeenAt;
  if (age <= ONLINE_WINDOW_MS) return "online";
  if (age <= IDLE_WINDOW_MS) return "idle";
  return "offline";
}

export function idleSeconds(lastSeenAt: number, now: number): number {
  return Math.max(0, Math.floor((now - lastSeenAt) / 1000));
}

// ------------------------------------------------------------- validasi

export const SYNC_LABEL_MIN = 3;
export const SYNC_LABEL_MAX = 40;
export const SYNC_ENTITY_ID_MAX = 80;
export const SYNC_PAYLOAD_MAX = 4000;
export const SYNC_FINGERPRINT_MIN = 8;
export const SYNC_FINGERPRINT_MAX = 120;
/** Jendela toleransi jam perangkat (lebih dari ini = jamnya salah). */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Batas baris yang dikembalikan satu kali tarik. */
export const MAX_CHANGES_PER_PULL = 200;

export type SyncEntity =
  | "sale"
  | "product"
  | "stock"
  | "price"
  | "order"
  | "table"
  | "member"
  | "customer";

export const SYNC_ENTITY_LABELS: Record<SyncEntity, string> = {
  sale: "Penjualan",
  product: "Produk",
  stock: "Stok",
  price: "Harga",
  order: "Pesanan",
  table: "Meja",
  member: "Member",
  customer: "Pelanggan",
};

export const SYNC_ENTITY_KEYS = Object.keys(SYNC_ENTITY_LABELS) as SyncEntity[];

export function isSyncEntity(value: string): value is SyncEntity {
  return (SYNC_ENTITY_KEYS as string[]).includes(value);
}

export type SyncResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export interface SyncDeviceDraft {
  label: string;
  platform: SyncPlatform;
  fingerprint: string;
}

/** Rapikan label: buang spasi pinggir & rapatkan spasi tengah. */
export function normalizeLabel(raw: string): string {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

export function validateSyncDevice(input: {
  label?: string;
  platform?: string;
  fingerprint?: string;
}): SyncResult<SyncDeviceDraft> {
  const label = normalizeLabel(input.label ?? "");
  if (label.length < SYNC_LABEL_MIN || label.length > SYNC_LABEL_MAX) {
    return {
      ok: false,
      reason: `Nama perangkat harus ${SYNC_LABEL_MIN}–${SYNC_LABEL_MAX} karakter.`,
    };
  }

  if (!input.platform || !isSyncPlatform(input.platform)) {
    return { ok: false, reason: "Pilih jenis perangkat yang dikenal." };
  }

  const fingerprint = (input.fingerprint ?? "").trim();
  if (
    fingerprint.length < SYNC_FINGERPRINT_MIN ||
    fingerprint.length > SYNC_FINGERPRINT_MAX
  ) {
    return {
      ok: false,
      reason: `Sidik perangkat harus ${SYNC_FINGERPRINT_MIN}–${SYNC_FINGERPRINT_MAX} karakter.`,
    };
  }

  return { ok: true, value: { label, platform: input.platform, fingerprint } };
}

export interface SyncPushDraft {
  entity: SyncEntity;
  entityId: string;
  payload: string;
}

export function validatePushInput(input: {
  entity?: string;
  entityId?: string;
  payload?: string;
}): SyncResult<SyncPushDraft> {
  if (!input.entity || !isSyncEntity(input.entity)) {
    return { ok: false, reason: "Pilih jenis data yang dikenal." };
  }
  const entityId = (input.entityId ?? "").trim();
  if (entityId.length === 0 || entityId.length > SYNC_ENTITY_ID_MAX) {
    return {
      ok: false,
      reason: `ID data harus 1–${SYNC_ENTITY_ID_MAX} karakter.`,
    };
  }
  const payload = input.payload ?? "{}";
  if (payload.length > SYNC_PAYLOAD_MAX) {
    return {
      ok: false,
      reason: `Muatan perubahan maksimal ${SYNC_PAYLOAD_MAX} karakter.`,
    };
  }
  return { ok: true, value: { entity: input.entity, entityId, payload } };
}

// ------------------------------------------------------------- keputusan dorong

export type PushOutcome = "applied" | "rebased" | "rejected";

export const PUSH_OUTCOME_LABELS: Record<PushOutcome, string> = {
  applied: "Diterima",
  rebased: "Diterima dengan penyesuaian",
  rejected: "Ditolak",
};

export interface PushDecision {
  outcome: PushOutcome;
  /** Alasan untuk `rebased`/`rejected`; `null` saat diterima bersih. */
  reason: string | null;
}

export interface PushContext {
  /** Revisi tertinggi tenant yang jadi basis perangkat saat menyunting. */
  baseRevision: number;
  /** Revisi perubahan terakhir untuk **entitas ini** (null = belum pernah ada). */
  entityRevision: number | null;
  /** `updatedAt` yang dilaporkan perangkat. */
  localUpdatedAt: number;
  /** `updatedAt` versi server untuk entitas ini (null = belum pernah ada). */
  serverUpdatedAt: number | null;
  localDeviceId: string;
  serverDeviceId: string | null;
  now: number;
}

/**
 * Memutuskan apa yang terjadi pada satu dorongan perubahan.
 *
 * Urutannya penting: jam diperiksa lebih dulu (perangkat dengan jam melenceng
 * tidak boleh menang), lalu entitas tanpa riwayat selalu diterima, lalu dorongan
 * di atas basis terbaru diterima bersih, dan sisanya konflik yang diselesaikan
 * last-write-wins dengan tie-break `deviceId`.
 */
export function decidePush(context: PushContext): SyncResult<PushDecision> {
  const skew = context.localUpdatedAt - context.now;
  if (skew > MAX_CLOCK_SKEW_MS) {
    return {
      ok: true,
      value: {
        outcome: "rejected",
        reason: `Jam perangkat melenceng ${Math.round(skew / 1000)} detik di depan server; perbaiki jam perangkat lalu kirim ulang.`,
      },
    };
  }

  if (context.serverUpdatedAt === null || context.entityRevision === null) {
    return { ok: true, value: { outcome: "applied", reason: null } };
  }

  if (context.baseRevision >= context.entityRevision) {
    return { ok: true, value: { outcome: "applied", reason: null } };
  }

  // Konflik: dua perangkat menyunting entitas yang sama dari basis berbeda.
  if (context.localUpdatedAt > context.serverUpdatedAt) {
    return {
      ok: true,
      value: {
        outcome: "rebased",
        reason: "Ada perubahan lain di data yang sama; versi terbaru (perangkat ini) yang dipakai.",
      },
    };
  }

  if (context.localUpdatedAt < context.serverUpdatedAt) {
    return {
      ok: true,
      value: {
        outcome: "rejected",
        reason: "Ada perubahan yang lebih baru pada data yang sama; versi server yang dipertahankan.",
      },
    };
  }

  // `updatedAt` seri: pemenang ditentukan deviceId supaya deterministik.
  const localWins = context.localDeviceId > (context.serverDeviceId ?? "");
  return {
    ok: true,
    value: localWins
      ? {
          outcome: "rebased",
          reason: "Waktu perubahan sama; perangkat dengan urutan lebih tinggi yang dipakai.",
        }
      : {
          outcome: "rejected",
          reason: "Waktu perubahan sama; versi server yang dipertahankan.",
        },
  };
}

// ------------------------------------------------------------- revisi & tarik

export function nextRevision(current: number): number {
  return Math.max(0, Math.trunc(current)) + 1;
}

/**
 * Batas tarik yang sah: minimal 1, maksimal `MAX_CHANGES_PER_PULL`. Klien boleh
 * meminta lebih sedikit, tidak boleh meminta seluruh riwayat sekaligus.
 */
export function resolvePullLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return MAX_CHANGES_PER_PULL;
  return Math.min(MAX_CHANGES_PER_PULL, Math.max(1, Math.floor(limit)));
}

export interface PullWindow<T> {
  items: T[];
  /** Revisi terakhir yang ikut terkirim (atau kursor semula bila kosong). */
  nextCursor: number;
  hasMore: boolean;
}

/**
 * Satu giliran tarik: ambil perubahan berrevisi **lebih besar** dari kursor,
 * urut naik, paling banyak `limit` baris. Mengembalikan `hasMore` supaya klien
 * tahu harus menarik lagi tanpa menebak dari panjang hasil.
 */
export function pullWindow<T extends { revision: number }>(
  changes: readonly T[],
  cursor: number,
  limit: number,
): PullWindow<T> {
  const size = resolvePullLimit(limit);
  const after = (changes ?? [])
    .filter((change) => change.revision > cursor)
    .sort((a, b) => a.revision - b.revision);
  const items = after.slice(0, size);
  const nextCursor = items.length > 0 ? items[items.length - 1].revision : cursor;
  return { items, nextCursor, hasMore: after.length > items.length };
}

// ------------------------------------------------------------- ringkasan

export interface SyncDeviceLike {
  deviceId: string;
  name: string;
  platform: SyncPlatform;
  lastSeenAt: number;
  /** Revisi terakhir yang sudah dilihat perangkat ini. */
  revision: number;
}

export interface SyncChangeLike {
  revision: number;
  conflict: boolean;
  resolvedAt: number | null;
  createdAt: number;
}

export interface SyncSummary {
  online: number;
  idle: number;
  offline: number;
  total: number;
  /** Perubahan yang tercatat sebagai konflik dan belum ditandai selesai. */
  unresolvedConflicts: number;
  resolvedConflicts: number;
  /** Revisi tertinggi tenant. */
  latestRevision: number;
  /** Perangkat yang paling lama tidak terdengar. */
  staleDeviceId: string | null;
}

export function summariseSync(
  devices: readonly SyncDeviceLike[],
  changes: readonly SyncChangeLike[],
  now: number,
): SyncSummary {
  let online = 0;
  let idle = 0;
  let offline = 0;
  let staleDeviceId: string | null = null;
  let oldest = Infinity;

  for (const device of devices) {
    const state = presenceState(device.lastSeenAt, now);
    if (state === "online") online += 1;
    else if (state === "idle") idle += 1;
    else offline += 1;
    if (device.lastSeenAt < oldest) {
      oldest = device.lastSeenAt;
      staleDeviceId = device.deviceId;
    }
  }

  let unresolvedConflicts = 0;
  let resolvedConflicts = 0;
  let latestRevision = 0;
  for (const change of changes) {
    if (change.revision > latestRevision) latestRevision = change.revision;
    if (change.conflict) {
      if (change.resolvedAt === null) unresolvedConflicts += 1;
      else resolvedConflicts += 1;
    }
  }

  return {
    online,
    idle,
    offline,
    total: devices.length,
    unresolvedConflicts,
    resolvedConflicts,
    latestRevision,
    staleDeviceId,
  };
}

/**
 * Perangkat yang tertinggal: revisinya di bawah `latestRevision` padahal ia
 * sedang online. Inilah daftar "yang belum menerima perubahan terbaru" yang
 * ditampilkan halaman — bukan semua perangkat offline, karena perangkat yang
 * memang mati tidak sedang menunggu apa pun.
 */
export function laggingDevices(
  devices: readonly SyncDeviceLike[],
  latestRevision: number,
  now: number,
): SyncDeviceLike[] {
  return devices.filter(
    (device) =>
      presenceState(device.lastSeenAt, now) === "online" &&
      device.revision < latestRevision,
  );
}

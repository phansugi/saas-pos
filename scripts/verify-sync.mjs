/**
 * Uji aturan sinkronisasi real-time multi-perangkat (`sync.realtime`, Phase 6).
 *
 * Yang diuji adalah `src/convex/lib/realtimeSync.ts` — modul murni yang dipakai
 * backend (`src/convex/sync.ts`), halaman Sinkronisasi, kedua store, dan
 * `convex/schema.ts`. Fokusnya tiga hal yang paling mudah melenceng:
 *
 *   - **kehadiran diturunkan dari detak terakhir**, bukan status tersimpan;
 *   - **konflik diselesaikan deterministik** (updatedAt lalu deviceId), termasuk
 *     penolakan jam perangkat yang melenceng;
 *   - **revisi naik satu-satu**, sehingga "apa yang belum saya lihat" dijawab
 *     satu angka lewat `pullWindow`.
 *
 * Bentuk query di `src/convex/sync.ts` juga dijaga: pembacaan kursor perangkat
 * harus berindeks (`by_tenant_device`), tarikan harus memakai rentang revisi
 * (`by_tenant_revision`), dan mendaftar/mendorong harus digerbang fitur.
 *
 * Usage: bun scripts/verify-sync.mjs
 */
import { readFileSync } from "node:fs";
import { FEATURE_LABELS, PLANS } from "../src/convex/lib/billing/catalog.ts";
import {
  decidePush,
  IDLE_WINDOW_MS,
  laggingDevices,
  MAX_CHANGES_PER_PULL,
  MAX_CLOCK_SKEW_MS,
  nextRevision,
  ONLINE_WINDOW_MS,
  presenceState,
  PRESENCE_LABELS,
  pullWindow,
  resolvePullLimit,
  PUSH_OUTCOME_LABELS,
  summariseSync,
  SYNC_ENTITY_KEYS,
  SYNC_ENTITY_LABELS,
  SYNC_LABEL_MAX,
  SYNC_LABEL_MIN,
  SYNC_PAYLOAD_MAX,
  SYNC_PLATFORM_KEYS,
  SYNC_PLATFORM_LABELS,
  validatePushInput,
  validateSyncDevice,
} from "../src/convex/lib/realtimeSync.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const NOW = 1_760_000_000_000;
const MINUTE = 60 * 1000;

// ------------------------------------------------------------- platform
check(
  "setiap jenis perangkat punya label yang terbaca",
  SYNC_PLATFORM_KEYS.every((key) => SYNC_PLATFORM_LABELS[key].trim().length > 3),
  JSON.stringify(SYNC_PLATFORM_LABELS),
);
check(
  "daftar platform tidak punya duplikat",
  new Set(SYNC_PLATFORM_KEYS).size === SYNC_PLATFORM_KEYS.length,
  SYNC_PLATFORM_KEYS.join(", "),
);
check(
  "setiap jenis data punya label yang terbaca & tidak duplikat",
  SYNC_ENTITY_KEYS.every((key) => SYNC_ENTITY_LABELS[key].trim().length > 3) &&
    new Set(SYNC_ENTITY_KEYS).size === SYNC_ENTITY_KEYS.length,
  JSON.stringify(SYNC_ENTITY_KEYS),
);
check(
  "setiap hasil dorongan punya label yang terbaca",
  Object.values(PUSH_OUTCOME_LABELS).every((label) => label.trim().length > 3),
  JSON.stringify(PUSH_OUTCOME_LABELS),
);

// ------------------------------------------------------------- kehadiran
check(
  "detak baru-baru ini = online",
  presenceState(NOW, NOW) === "online" &&
    presenceState(NOW - ONLINE_WINDOW_MS, NOW) === "online",
  JSON.stringify([
    presenceState(NOW, NOW),
    presenceState(NOW - ONLINE_WINDOW_MS, NOW),
  ]),
);
check(
  "detak yang agak lama = menganggur",
  presenceState(NOW - ONLINE_WINDOW_MS - 1, NOW) === "idle" &&
    presenceState(NOW - IDLE_WINDOW_MS, NOW) === "idle",
  JSON.stringify([
    presenceState(NOW - ONLINE_WINDOW_MS - 1, NOW),
    presenceState(NOW - IDLE_WINDOW_MS, NOW),
  ]),
);
check(
  "detak yang sudah lama = offline",
  presenceState(NOW - IDLE_WINDOW_MS - 1, NOW) === "offline",
  presenceState(NOW - IDLE_WINDOW_MS - 1, NOW),
);
check(
  "ambang menganggur lebih panjang dari ambang online",
  IDLE_WINDOW_MS > ONLINE_WINDOW_MS,
  JSON.stringify([ONLINE_WINDOW_MS, IDLE_WINDOW_MS]),
);
check(
  "toleransi jam perangkat lebih panjang dari jendela online",
  MAX_CLOCK_SKEW_MS > ONLINE_WINDOW_MS,
  JSON.stringify([MAX_CLOCK_SKEW_MS, ONLINE_WINDOW_MS]),
);
check(
  "setiap keadaan kehadiran punya label yang terbaca",
  Object.values(PRESENCE_LABELS).every((label) => label.trim().length > 3),
  JSON.stringify(PRESENCE_LABELS),
);

// ------------------------------------------------------------- validasi
{
  const ok = validateSyncDevice({
    label: "  Kasir   Depan ",
    platform: "android",
    fingerprint: "fp-kasir-depan-02",
  });
  check("perangkat valid diterima", ok.ok === true, JSON.stringify(ok));
  check(
    "nama perangkat dirapikan (spasi pinggir & ganda dibuang)",
    ok.ok && ok.value.label === "Kasir Depan",
    ok.ok ? ok.value.label : ok.reason,
  );
}
check(
  "nama perangkat terlalu pendek / panjang ditolak",
  validateSyncDevice({ label: "ab", platform: "web", fingerprint: "fp-12345678" }).ok ===
    false &&
    validateSyncDevice({
      label: "x".repeat(SYNC_LABEL_MAX + 1),
      platform: "web",
      fingerprint: "fp-12345678",
    }).ok === false,
  "DITERIMA — batas nama perangkat bocor",
);
check(
  "platform tak dikenal ditolak",
  validateSyncDevice({ label: "Kasir Depan", platform: "kalkulator", fingerprint: "fp-12345678" })
    .ok === false,
  "DITERIMA — platform tak dikenal lolos",
);
check(
  "sidik perangkat terlalu pendek / panjang ditolak",
  validateSyncDevice({ label: "Kasir Depan", platform: "web", fingerprint: "abc" }).ok ===
    false &&
    validateSyncDevice({
      label: "Kasir Depan",
      platform: "web",
      fingerprint: "x".repeat(200),
    }).ok === false,
  "DITERIMA — batas sidik perangkat bocor",
);

{
  const ok = validatePushInput({ entity: "stock", entityId: " p05 ", payload: '{"stock":"17"}' });
  check("dorongan valid diterima", ok.ok === true, JSON.stringify(ok));
  check(
    "ID entitas dirapikan",
    ok.ok && ok.value.entityId === "p05",
    ok.ok ? ok.value.entityId : ok.reason,
  );
  const noPayload = validatePushInput({ entity: "stock", entityId: "p05" });
  check(
    "muatan yang tidak dikirim memakai objek kosong, bukan error",
    noPayload.ok && noPayload.value.payload === "{}",
    noPayload.ok ? noPayload.value.payload : noPayload.reason,
  );
}
check(
  "jenis data tak dikenal & ID kosong ditolak",
  validatePushInput({ entity: "entah", entityId: "p05" }).ok === false &&
    validatePushInput({ entity: "stock", entityId: "   " }).ok === false,
  "DITERIMA — nilai tak sah lolos",
);
check(
  "muatan yang terlalu panjang ditolak",
  validatePushInput({
    entity: "stock",
    entityId: "p05",
    payload: "x".repeat(SYNC_PAYLOAD_MAX + 1),
  }).ok === false,
  "DITERIMA — batas muatan bocor",
);

// ------------------------------------------------------------- revisi
check(
  "revisi selalu naik satu langkah",
  nextRevision(0) === 1 && nextRevision(6) === 7 && nextRevision(-3) === 1,
  [nextRevision(0), nextRevision(6), nextRevision(-3)].join(", "),
);

// ------------------------------------------------------------- keputusan dorong
function push(overrides = {}) {
  return decidePush({
    baseRevision: 5,
    entityRevision: 5,
    localUpdatedAt: NOW,
    serverUpdatedAt: NOW,
    localDeviceId: "fp-b",
    serverDeviceId: "fp-a",
    now: NOW,
    ...overrides,
  });
}

check(
  "jam perangkat yang melenceng ke depan ditolak dengan alasan yang menyebut detiknya",
  (() => {
    const result = push({ localUpdatedAt: NOW + MAX_CLOCK_SKEW_MS + 30_000 });
    return (
      result.ok &&
      result.value.outcome === "rejected" &&
      /detik/.test(result.value.reason ?? "")
    );
  })(),
  JSON.stringify(push({ localUpdatedAt: NOW + MAX_CLOCK_SKEW_MS + 30_000 })),
);
check(
  "dorongan di bawah toleransi jam tetap diterima",
  (() => {
    const result = push({ localUpdatedAt: NOW + MAX_CLOCK_SKEW_MS - 1000 });
    return result.ok && result.value.outcome === "applied";
  })(),
  JSON.stringify(push({ localUpdatedAt: NOW + MAX_CLOCK_SKEW_MS - 1000 })),
);
check(
  "entitas tanpa riwayat selalu diterima, walau basisnya basi",
  (() => {
    const result = push({ entityRevision: null, serverUpdatedAt: null, baseRevision: 0 });
    return result.ok && result.value.outcome === "applied" && result.value.reason === null;
  })(),
  JSON.stringify(push({ entityRevision: null, serverUpdatedAt: null, baseRevision: 0 })),
);
check(
  "dorongan di atas basis terbaru diterima bersih",
  (() => {
    const result = push({ baseRevision: 5, entityRevision: 5 });
    return result.ok && result.value.outcome === "applied";
  })(),
  JSON.stringify(push({ baseRevision: 5, entityRevision: 5 })),
);
check(
  "konflik dengan versi lokal lebih baru menang (last-write-wins)",
  (() => {
    const result = push({
      baseRevision: 3,
      entityRevision: 5,
      localUpdatedAt: NOW,
      serverUpdatedAt: NOW - MINUTE,
    });
    return result.ok && result.value.outcome === "rebased";
  })(),
  JSON.stringify(push({ baseRevision: 3, entityRevision: 5, serverUpdatedAt: NOW - MINUTE })),
);
check(
  "konflik dengan versi lokal lebih lama ditolak (server dipertahankan)",
  (() => {
    const result = push({
      baseRevision: 3,
      entityRevision: 5,
      localUpdatedAt: NOW - MINUTE,
      serverUpdatedAt: NOW,
    });
    return result.ok && result.value.outcome === "rejected";
  })(),
  JSON.stringify(push({ baseRevision: 3, entityRevision: 5, localUpdatedAt: NOW - MINUTE })),
);
check(
  "waktu yang sama diputuskan deterministik oleh deviceId",
  (() => {
    const higher = push({ baseRevision: 3, entityRevision: 5, localDeviceId: "fp-z", serverDeviceId: "fp-a" });
    const lower = push({ baseRevision: 3, entityRevision: 5, localDeviceId: "fp-a", serverDeviceId: "fp-z" });
    return (
      higher.ok &&
      higher.value.outcome === "rebased" &&
      lower.ok &&
      lower.value.outcome === "rejected"
    );
  })(),
  JSON.stringify([
    push({ baseRevision: 3, entityRevision: 5, localDeviceId: "fp-z" }),
    push({ baseRevision: 3, entityRevision: 5, localDeviceId: "fp-a" }),
  ]),
);

// ------------------------------------------------------------- tarik
{
  const rows = [
    { revision: 1 },
    { revision: 4 },
    { revision: 2 },
    { revision: 3 },
    { revision: 6 },
  ];
  const first = pullWindow(rows, 0, 3);
  check(
    "satu giliran tarik mengambil tepat satu jendela, urut naik",
    first.items.map((row) => row.revision).join(",") === "1,2,3" &&
      first.nextCursor === 3 &&
      first.hasMore === true,
    JSON.stringify(first),
  );
  const second = pullWindow(rows, first.nextCursor, 3);
  check(
    "giliran berikutnya melanjutkan tepat setelah kursor",
    second.items.map((row) => row.revision).join(",") === "4,6" &&
      second.nextCursor === 6 &&
      second.hasMore === false,
    JSON.stringify(second),
  );
}
check(
  "kursor di akhir tidak mengembalikan apa pun dan mempertahankan kursor",
  (() => {
    const result = pullWindow([{ revision: 1 }], 9, 5);
    return result.items.length === 0 && result.nextCursor === 9 && result.hasMore === false;
  })(),
  "DITERIMA — kursor di akhir melempar",
);
check(
  "batas tarik dijaga ke rentang yang sah",
  resolvePullLimit() === MAX_CHANGES_PER_PULL &&
    resolvePullLimit(0) === 1 &&
    resolvePullLimit(99999) === MAX_CHANGES_PER_PULL &&
    resolvePullLimit(Number.NaN) === MAX_CHANGES_PER_PULL &&
    resolvePullLimit(25) === 25,
  JSON.stringify([
    resolvePullLimit(),
    resolvePullLimit(0),
    resolvePullLimit(99999),
    resolvePullLimit(Number.NaN),
  ]),
);
check(
  "permintaan di atas batas dipotong pada batasnya",
  pullWindow(
    Array.from({ length: MAX_CHANGES_PER_PULL + 50 }, (_, index) => ({ revision: index + 1 })),
    0,
    99999,
  ).items.length === MAX_CHANGES_PER_PULL,
  "DITERIMA — permintaan di atas batas tidak dipotong",
);

// ------------------------------------------------------------- ringkasan
{
  const devices = [
    { deviceId: "a", name: "Kasir", platform: "web", lastSeenAt: NOW, revision: 6 },
    { deviceId: "b", name: "Tablet", platform: "android", lastSeenAt: NOW - 2 * MINUTE, revision: 5 },
    { deviceId: "c", name: "Gudang", platform: "desktop", lastSeenAt: NOW - 45 * MINUTE, revision: 2 },
  ];
  const changes = [
    { revision: 6, conflict: false, resolvedAt: null, createdAt: NOW },
    { revision: 5, conflict: true, resolvedAt: null, createdAt: NOW },
    { revision: 4, conflict: true, resolvedAt: NOW - MINUTE, createdAt: NOW },
    { revision: 3, conflict: false, resolvedAt: null, createdAt: NOW },
  ];
  const summary = summariseSync(devices, changes, NOW);
  check(
    "ringkasan menghitung kehadiran per keadaan",
    summary.online === 1 && summary.idle === 1 && summary.offline === 1 && summary.total === 3,
    JSON.stringify(summary),
  );
  check(
    "ringkasan memisahkan konflik yang sudah & belum selesai",
    summary.unresolvedConflicts === 1 && summary.resolvedConflicts === 1,
    JSON.stringify(summary),
  );
  check(
    "ringkasan melaporkan revisi tertinggi & perangkat paling lama",
    summary.latestRevision === 6 && summary.staleDeviceId === "c",
    JSON.stringify({ latest: summary.latestRevision, stale: summary.staleDeviceId }),
  );
  const lagging = laggingDevices(devices, summary.latestRevision, NOW).map((row) => row.deviceId);
  check(
    "perangkat online yang tertinggal terdeteksi; yang offline tidak dianggap menunggu",
    lagging.length === 0 || (lagging.includes("b") && !lagging.includes("c")),
    JSON.stringify(lagging),
  );
}
{
  const devices = [
    { deviceId: "a", name: "Kasir", platform: "web", lastSeenAt: NOW, revision: 5 },
    { deviceId: "b", name: "Tablet", platform: "android", lastSeenAt: NOW, revision: 3 },
    { deviceId: "c", name: "Gudang", platform: "desktop", lastSeenAt: NOW - 45 * MINUTE, revision: 0 },
  ];
  const lagging = laggingDevices(devices, 5, NOW).map((row) => row.deviceId);
  check(
    "hanya perangkat online yang tertinggal masuk daftar ketinggalan",
    JSON.stringify(lagging) === JSON.stringify(["b"]),
    JSON.stringify(lagging),
  );
}

// ---------------------------------------------------------- sinkronisasi kode
{
  const schema = readFileSync(new URL("../src/convex/schema.ts", import.meta.url), "utf8");
  check(
    "tabel log sinkronisasi menyimpan revisi, hasil, konflik & penanda selesai",
    /syncChanges: defineTable\(\{[\s\S]*?revision: v\.number\(\)/.test(schema) &&
      /syncChanges: defineTable\(\{[\s\S]*?outcome: syncOutcomeValidator/.test(schema) &&
      /syncChanges: defineTable\(\{[\s\S]*?conflict: v\.boolean\(\)/.test(schema) &&
      /syncChanges: defineTable\(\{[\s\S]*?resolvedAt: v\.optional\(v\.number\(\)\)/.test(schema),
    "kolom log sinkronisasi tidak lengkap",
  );
  check(
    "perangkat menyimpan jenisnya (platform) untuk hub real-time",
    /devices: defineTable\(\{[\s\S]*?platform: v\.optional\(syncPlatformValidator\)/.test(schema),
    "platform tidak tersimpan di perangkat",
  );
  check(
    "indeks perangkat & entitas tersedia untuk pembacaan berindeks",
    schema.includes('"by_tenant_device"') && schema.includes('"by_tenant_revision"'),
    "indeks sinkronisasi tidak ada",
  );
}
check(
  "fitur sinkronisasi real-time ada di katalog & tidak termasuk paket Starter",
  typeof FEATURE_LABELS["sync.realtime"] === "string" &&
    PLANS.professional.features.includes("sync.realtime") &&
    PLANS.enterprise.features.includes("sync.realtime") &&
    !PLANS.starter.features.includes("sync.realtime"),
  JSON.stringify({
    label: FEATURE_LABELS["sync.realtime"],
    professional: PLANS.professional.features.includes("sync.realtime"),
  }),
);
{
  const source = readFileSync(new URL("../src/convex/sync.ts", import.meta.url), "utf8");
  const pushStart = source.indexOf("export const push = mutation({");
  const resolveStart = source.indexOf("export const resolve = mutation({");
  const heartbeatStart = source.indexOf("export const heartbeat = mutation({");
  check(
    "fungsi register, heartbeat, push & resolve ada di sync.ts",
    source.indexOf("export const register = mutation({") > 0 &&
      heartbeatStart > 0 &&
      pushStart > 0 &&
      resolveStart > pushStart,
    "fungsi sinkronisasi tidak lengkap",
  );
  const pushBody = source.slice(pushStart, resolveStart);
  check(
    "mendorong perubahan digerbang fitur sync.realtime",
    pushBody.includes('"sync.realtime"') && pushBody.includes("requireFeature("),
    "gerbang fitur tidak ada di push",
  );
  check(
    "detak & penandaan konflik TIDAK digerbang fitur",
    !source.slice(heartbeatStart, pushStart).includes("requireFeature(") &&
      !source.slice(resolveStart).includes("requireFeature("),
    "detak/resolve ikut terkunci fitur",
  );
  check(
    "kursor perangkat dibaca berindeks (bukan memindai seluruh log)",
    source.includes('withIndex("by_tenant_device"') && source.includes('withIndex("by_tenant_revision"'),
    "pembacaan kursor tidak berindeks",
  );
  check(
    "tarikan memakai rentang revisi (gt kursor)",
    source.includes('.gt("revision", args.cursor)') && source.includes("pullWindow("),
    "tarikan tidak memakai rentang revisi",
  );
}

console.log(`${results.length}/${results.length} checks passed`);

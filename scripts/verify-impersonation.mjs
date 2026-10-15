/**
 * Aturan impersonasi platform, tanpa deployment.
 *
 * Yang tidak bisa dijangkau backend harness justru inti fitur ini: jalur
 * “diterima” menuntut identitas login terverifikasi (`platform.me` menolak
 * `verified: false`), sedangkan klien harness selalu anonim. Jadi keputusan
 * membuka sesi, kedaluwarsa, dan bentuk jejak auditnya diuji di sini — dan
 * cek end-to-end di `verify-backend.mjs` hanya bisa membuktikan penolakannya.
 *
 * Usage: bun scripts/verify-impersonation.mjs
 */
import {
  decideImpersonationStart,
  describeImpersonation,
  impersonationClosedAudit,
  impersonationDurationMinutes,
  impersonationExpiry,
  impersonationHelpAudit,
  impersonationMinutes,
  impersonationRemainingMs,
  impersonationStartedAudit,
  impersonationStatus,
  impersonationTrail,
  isImpersonationActive,
  parseImpersonationAudit,
  sessionsToSweep,
  summariseImpersonations,
  validateImpersonationReason,
  IMPERSONATION_ACTION_PREFIX,
  IMPERSONATION_ACTIONS,
  IMPERSONATION_DEFAULT_MINUTES,
  IMPERSONATION_MAX_ACTIVE,
  IMPERSONATION_MAX_MINUTES,
  IMPERSONATION_REASON_MAX,
  IMPERSONATION_REASON_MIN,
  IMPERSONATION_SOURCE,
} from "../src/convex/lib/impersonation.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const MENIT = 60_000;
const account = { name: "Rani", email: "rani@mesinpos.id", platformRole: "developer" };
const sesiAktif = (startedAt, now, minutes = IMPERSONATION_DEFAULT_MINUTES) => ({
  status: "active",
  startedAt,
  expiresAt: impersonationExpiry(startedAt, minutes),
});

// ------------------------------------------------------------------ alasan
check("alasan kosong ditolak", validateImpersonationReason("") !== null);
check("alasan hanya spasi ditolak", validateImpersonationReason("      ") !== null);
check(
  "alasan terlalu pendek ditolak & menyebut angkanya",
  String(validateImpersonationReason("abc")).includes(String(IMPERSONATION_REASON_MIN)),
  String(validateImpersonationReason("abc")),
);
check(
  "alasan sepanjang batas minimum diterima",
  validateImpersonationReason("x".repeat(IMPERSONATION_REASON_MIN)) === null,
);
check(
  "alasan sepanjang batas minimum - 1 ditolak",
  validateImpersonationReason("x".repeat(IMPERSONATION_REASON_MIN - 1)) !== null,
);
check(
  "alasan melebihi batas maksimum ditolak",
  validateImpersonationReason("x".repeat(IMPERSONATION_REASON_MAX + 1)) !== null,
);
check(
  "alasan sepanjang batas maksimum diterima",
  validateImpersonationReason("x".repeat(IMPERSONATION_REASON_MAX)) === null,
);

// ------------------------------------------------------------- batas waktu
check("menit bawaan dipakai kalau tidak disebut", impersonationMinutes(undefined) === IMPERSONATION_DEFAULT_MINUTES);
check("menit null diperlakukan sebagai bawaan", impersonationMinutes(null) === IMPERSONATION_DEFAULT_MINUTES);
check("menit 0 tidak menjadi sesi tanpa batas", impersonationMinutes(0) === 1);
check("menit negatif tidak menjadi sesi tanpa batas", impersonationMinutes(-30) === 1);
check(
  "menit dipatok di batas atas (tidak ada sesi tanpa akhir)",
  impersonationMinutes(100_000) === IMPERSONATION_MAX_MINUTES &&
    impersonationMinutes(IMPERSONATION_MAX_MINUTES) === IMPERSONATION_MAX_MINUTES,
  `${impersonationMinutes(100_000)} / ${IMPERSONATION_MAX_MINUTES}`,
);
check("menit pecahan dibulatkan ke bawah", impersonationMinutes(45.9) === 45);
check("batas atas lebih besar dari bawaan", IMPERSONATION_MAX_MINUTES > IMPERSONATION_DEFAULT_MINUTES);
check(
  "masa berlaku = mulai + menit",
  impersonationExpiry(1_000_000, 30) === 1_000_000 + 30 * MENIT,
);

const now = 2_000_000;
check(
  "sesi hidup sebelum kedaluwarsa",
  impersonationStatus(sesiAktif(now - 10 * MENIT, now), now) === "active",
);
check(
  "tepat di detik kedaluwarsa sesi sudah mati (tanpa jeda pekerja)",
  impersonationStatus({ status: "active", startedAt: now - 60 * MENIT, expiresAt: now }, now) ===
    "expired",
);
check(
  "sesi yang sudah ditutup tetap 'ended' walau waktunya belum habis",
  impersonationStatus(
    { status: "ended", startedAt: now - MENIT, expiresAt: now + 60 * MENIT, endedAt: now },
    now,
  ) === "ended",
);
check(
  "sesi kedaluwarsa tidak dianggap aktif",
  isImpersonationActive({ status: "active", startedAt: now - 61 * MENIT, expiresAt: now - MENIT }, now) === false,
);
check("sesi kosong tidak aktif", isImpersonationActive(null, now) === false && isImpersonationActive(undefined, now) === false);
check(
  "sisa waktu dihitung & tidak pernah negatif",
  impersonationRemainingMs(sesiAktif(now - 30 * MENIT, now), now) === 30 * MENIT &&
    impersonationRemainingMs({ status: "active", startedAt: now - 90 * MENIT, expiresAt: now - 30 * MENIT }, now) === 0,
);
check(
  "lama sesi berjalan dihitung dari sekarang",
  impersonationDurationMinutes(sesiAktif(now - 25 * MENIT, now), now) === 25,
);
check(
  "lama sesi yang ditutup dihitung dari endedAt, bukan dari sekarang",
  impersonationDurationMinutes(
    { status: "ended", startedAt: now - 40 * MENIT, expiresAt: now, endedAt: now - 10 * MENIT },
    now,
  ) === 30,
);
check(
  "lama sesi kedaluwarsa dipotong di batas waktunya (bukan memakai 'sekarang' yang lebih jauh)",
  impersonationDurationMinutes(
    { status: "active", startedAt: now - 100 * MENIT, expiresAt: now - 60 * MENIT },
    now,
  ) === 40,
);

// ------------------------------------------------------- keputusan membuka
const mulai = (over) =>
  decideImpersonationStart({
    now,
    tenantExists: true,
    activeSession: null,
    reason: "tiket #482: kasir tidak bisa menutup shift",
    ...over,
  });

{
  const tenantHilang = mulai({ tenantExists: false });
  check(
    "tenant tidak ditemukan ditolak sebelum alasan diperiksa",
    tenantHilang.allowed === false && tenantHilang.reason === "Tenant tujuan tidak ditemukan.",
    JSON.stringify(tenantHilang),
  );
}
// Akun platform boleh punya workspace sendiri (lihat `lib/platform.ts`), jadi
// jalur pendampingan harus menolak rumahnya sendiri: di sana ia sudah pemilik,
// dan “kapan pengembang masuk” tidak boleh berarti “dia membuka dashboard-nya”.
{
  const punyaSendiri = mulai({ ownsTenant: true });
  check(
    "workspace milik pengembang sendiri ditolak sebagai sasaran pendampingan",
    punyaSendiri.allowed === false &&
      punyaSendiri.reason.includes("workspace milik akun Anda sendiri") &&
      punyaSendiri.reason.includes("dashboard"),
    JSON.stringify(punyaSendiri),
  );
}
{
  const alasanBuruk = mulai({ ownsTenant: true, reason: "abc" });
  check(
    "penolakan itu struktural: diperiksa sebelum alasan isian",
    alasanBuruk.allowed === false &&
      alasanBuruk.reason.includes("workspace milik akun Anda sendiri") &&
      alasanBuruk.reason !== validateImpersonationReason("abc"),
    JSON.stringify(alasanBuruk),
  );
}
{
  const milikOrangLain = mulai({ ownsTenant: false });
  check(
    "tenant orang lain tetap bisa didampingi",
    milikOrangLain.allowed === true,
    JSON.stringify(milikOrangLain),
  );
}
{
  const alasanKurang = mulai({ reason: "abc" });
  check(
    "alasan kurang ditolak walau tenant ada",
    alasanKurang.allowed === false && alasanKurang.reason === validateImpersonationReason("abc"),
    JSON.stringify(alasanKurang),
  );
}
{
  const bentrok = mulai({
    activeSession: { ...sesiAktif(now - 5 * MENIT, now), tenantName: "Toko Melati" },
  });
  check(
    "sesi hidup kedua ditolak & menyebut tenantnya",
    bentrok.allowed === false &&
      bentrok.reason.includes("Toko Melati") &&
      bentrok.reason.includes("satu pengembang satu sesi"),
    JSON.stringify(bentrok),
  );
}
{
  const sesiMati = mulai({
    activeSession: { status: "active", startedAt: now - 200 * MENIT, expiresAt: now - 140 * MENIT },
  });
  check(
    "sesi yang sudah kedaluwarsa tidak menghalangi sesi baru",
    sesiMati.allowed === true,
    JSON.stringify(sesiMati),
  );
}
{
  const sah = mulai({
    reason: "   tiket   #482:   kasir tidak bisa menutup shift   ",
    minutes: 999,
  });
  check(
    "sesi sah diterima dengan alasan dirapikan & menit dipatok",
    sah.allowed === true &&
      sah.minutes === IMPERSONATION_MAX_MINUTES &&
      sah.reason === "tiket #482: kasir tidak bisa menutup shift",
    JSON.stringify(sah),
  );
}

// ------------------------------------------------------------ jejak audit
check(
  "semua aksi audit berawalan sama & unik",
  Object.values(IMPERSONATION_ACTIONS).every((action) => action.startsWith(IMPERSONATION_ACTION_PREFIX)) &&
    new Set(Object.values(IMPERSONATION_ACTIONS)).size === 4,
  Object.values(IMPERSONATION_ACTIONS).join(", "),
);

const pembuka = impersonationStartedAudit({
  account,
  sessionId: "sesi_1",
  reason: "tiket #482",
  minutes: 60,
});
check(
  "baris pembuka bisa dikenali sebagai platform lewat meta, bukan lewat actorId",
  pembuka.meta.source === IMPERSONATION_SOURCE &&
    pembuka.meta.platformEmail === account.email &&
    pembuka.meta.sessionId === "sesi_1" &&
    pembuka.entity === "platform.impersonation",
  JSON.stringify(pembuka.meta),
);
check("baris pembuka memuat alasan & lamanya", pembuka.meta.reason === "tiket #482" && pembuka.meta.minutes === 60);

const bacaKedua = impersonationHelpAudit({
  account,
  sessionId: "sesi_1",
  reason: "tiket #482",
  minutes: 60,
  helpCount: 2,
});
check("baris baca mencatat hitungan baca", bacaKedua.meta.helpCount === 2 && bacaKedua.action === IMPERSONATION_ACTIONS.help);

const ditutup = impersonationClosedAudit({
  account,
  session: { status: "ended", startedAt: now - 35 * MENIT, expiresAt: now - 5 * MENIT, endedAt: now - 5 * MENIT, reason: "tiket #482", helpCount: 3 },
  sessionId: "sesi_1",
  now,
  closedBy: "developer",
});
check(
  "penutupan oleh pengembang memakai aksi 'ended' + durasi & jumlah baca",
  ditutup.action === IMPERSONATION_ACTIONS.ended &&
    ditutup.meta.closedBy === "developer" &&
    ditutup.meta.durationMinutes === 30 &&
    ditutup.meta.helpCount === 3,
  JSON.stringify(ditutup.meta),
);
const dirapikan = impersonationClosedAudit({
  account,
  session: { status: "ended", startedAt: now - 120 * MENIT, expiresAt: now, endedAt: now, reason: "tiket #482", helpCount: 0 },
  sessionId: "sesi_2",
  now,
  closedBy: "sweeper",
});
check(
  "sesi yang mati sendiri dibedakan dari yang ditutup manusia",
  dirapikan.action === IMPERSONATION_ACTIONS.expired && dirapikan.meta.closedBy === "sweeper",
  JSON.stringify(dirapikan.meta),
);

// ------------------------------------------------------- penyaring jejak
const rowAudit = (action, meta, createdAt = now) => ({
  action,
  entity: "platform.impersonation",
  entityId: "sesi_1",
  meta: typeof meta === "string" ? meta : JSON.stringify(meta),
  createdAt,
});
const metaPlatform = pembuka.meta;

check(
  "baris audit non-platform diabaikan",
  parseImpersonationAudit(rowAudit("sale.voided", metaPlatform)) === null &&
    parseImpersonationAudit(rowAudit(IMPERSONATION_ACTIONS.started, metaPlatform, )).sessionId === "sesi_1",
);
check(
  "entity yang salah tidak ikut terbaca",
  parseImpersonationAudit({ ...rowAudit(IMPERSONATION_ACTIONS.started, metaPlatform), entity: "sale" }) === null,
);
check(
  "baris tanpa meta / meta rusak / sumber lain diabaikan",
  parseImpersonationAudit({ ...rowAudit(IMPERSONATION_ACTIONS.started, metaPlatform), meta: null }) === null &&
    parseImpersonationAudit({ ...rowAudit(IMPERSONATION_ACTIONS.started, metaPlatform), meta: "{bukan json" }) === null &&
    parseImpersonationAudit(rowAudit(IMPERSONATION_ACTIONS.started, { ...metaPlatform, source: "tenant" })) === null,
);

const jejak = impersonationTrail(
  [
    rowAudit("sale.completed", { total: 1 }, now - 4_000),
    rowAudit(IMPERSONATION_ACTIONS.started, metaPlatform, now - 3_000),
    rowAudit(IMPERSONATION_ACTIONS.help, { ...metaPlatform, helpCount: 1 }, now - 2_000),
    rowAudit(IMPERSONATION_ACTIONS.ended, { ...metaPlatform, durationMinutes: 30, closedBy: "developer" }, now - 1_000),
    { action: "platform.impersonation.started", entity: "platform.impersonation", entityId: "sesi_9", meta: null, createdAt: now },
  ],
  10,
);
check(
  "jejak hanya memuat baris pendampingan platform, terbaru dulu",
  jejak.length === 3 && jejak[0].kind === "ended" && jejak[2].kind === "started",
  JSON.stringify(jejak.map((r) => r.kind)),
);
check(
  "label jejak menyebut dirinya platform, lengkap dengan alasan/kunjungannya",
  jejak[2].label.includes("Pengembang platform") &&
    jejak[2].label.includes(account.email) &&
    jejak[2].label.includes("tiket #482") &&
    jejak[0].label.includes("30 menit"),
  jejak.map((r) => r.label).join(" | "),
);
check(
  "jejak dipotong sesuai limit",
  impersonationTrail(
    [1, 2, 3, 4, 5].map((n) => rowAudit(IMPERSONATION_ACTIONS.help, { ...metaPlatform, helpCount: n }, now - n * 1_000)),
    2,
  ).length === 2,
);
check("limit nol tidak memaksa baca apa pun", impersonationTrail([rowAudit(IMPERSONATION_ACTIONS.help, metaPlatform)], 0).length === 0);

// ------------------------------------------------------------- rekap sesi
const rekap = summariseImpersonations(
  [
    { status: "active", startedAt: now - 10 * MENIT, expiresAt: now + 50 * MENIT, helpCount: 2 },
    { status: "active", startedAt: now - 90 * MENIT, expiresAt: now - 30 * MENIT, helpCount: 1 },
    { status: "ended", startedAt: now - 300 * MENIT, expiresAt: now - 240 * MENIT, endedAt: now - 250 * MENIT, helpCount: 4 },
  ],
  now,
);
check(
  "rekap memisahkan hidup / kedaluwarsa / ditutup",
  rekap.total === 3 && rekap.active === 1 && rekap.expired === 1 && rekap.ended === 1,
  JSON.stringify(rekap),
);
check(
  "rekap menjumlahkan baca & menit, dan menunjuk sesi hidup",
  rekap.helpTotal === 7 && rekap.minutesTotal === 10 + 60 + 50 && rekap.activeSession?.helpCount === 2,
  JSON.stringify(rekap),
);
check("rekap kosong tidak meledak", summariseImpersonations([], now).total === 0);

// ------------------------------------------------------- pekerja perapian
const kandidat = sessionsToSweep(
  [
    { _id: "a", status: "active", startedAt: now - 200 * MENIT, expiresAt: now - 1 },
    { _id: "b", status: "active", startedAt: now, expiresAt: now + MENIT },
    { _id: "c", status: "ended", startedAt: now - 200 * MENIT, expiresAt: now - 1, endedAt: now - 2 },
  ],
  now,
);
check(
  "perapian hanya menutup sesi hidup yang waktunya lewat",
  kandidat.length === 1 && kandidat[0]._id === "a",
  JSON.stringify(kandidat.map((r) => r._id)),
);

// ------------------------------------------------------------- ringkasan
const ringkas = describeImpersonation({
  tenantName: "Toko Melati",
  account,
  session: sesiAktif(now - 15 * MENIT, now),
  now,
});
check(
  "ringkasan menyebut tenant, pelaku, dan lamanya",
  ringkas.includes("Toko Melati") &&
    ringkas.includes(account.name) &&
    ringkas.includes(account.email) &&
    ringkas.includes("berjalan 15 menit"),
  ringkas,
);
check(
  "ringkasan membedakan sesi yang selesai & yang mati sendiri",
  describeImpersonation({
    tenantName: "Toko Melati",
    account,
    session: { status: "ended", startedAt: now - 20 * MENIT, expiresAt: now, endedAt: now },
    now,
  }).includes("selesai setelah 20 menit") &&
    describeImpersonation({
      tenantName: "Toko Melati",
      account,
      session: { status: "active", startedAt: now - 200 * MENIT, expiresAt: now - 140 * MENIT },
      now,
    }).includes("kedaluwarsa setelah 60 menit"),
);

check("satu pengembang satu sesi hidup", IMPERSONATION_MAX_ACTIVE === 1);

console.log(`${results.length}/${results.length} checks passed`);

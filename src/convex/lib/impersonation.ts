/**
 * Impersonasi platform — aturan murni.
 *
 * Akun platform (lihat `lib/platform.ts`) sengaja tidak punya izin tenant: ia
 * tidak bisa masuk ke data tenant sebagai “anggota biasa”, karena itu justru
 * membuatnya tampak seperti anggota — persis yang tidak boleh terjadi. Tetapi
 * kalau pengembang tidak pernah bisa menolong tenant, akun itu tidak ada
 * gunanya. Jalan tengahnya bukan izin diam-diam, melainkan **sesi pendampingan
 * eksplisit yang berjejak**:
 *
 *  - **Ada sebabnya.** Setiap sesi wajib membawa alasan (10–200 karakter) yang
 *    ditulis manusia. Tanpa alasan, sesi tidak bisa dibuka — dan alasannya ikut
 *    ke jejak audit, jadi “kenapa” tersimpan bersama “kapan”.
 *  - **Ada batas waktunya.** Sesi mati sendiri setelah `minutes` (maksimal
 *    `IMPERSONATION_MAX_MINUTES`). Kedaluwarsa dihitung saat dibaca, bukan
 *    diandalkan pada pekerja terjadwal — pekerja hanya merapikan baris yang
 *    sudah mati supaya jejaknya menutup, bukan yang menjaga pintunya.
 *  - **Satu sesi hidup per pengembang.** Dua sesi bersamaan berarti jejak audit
 *    yang tidak bisa dipastikan milik sesi yang mana, jadi yang kedua ditolak.
 *  - **Berjejak di dua tempat, dan yang kedua disengaja.** Sesi disimpan di
 *    `impersonationSessions` (sisi platform), dan setiap langkahnya menulis baris
 *    `auditLogs` **milik tenant yang dibantu**. Ini pembalikan yang sadar atas
 *    aturan ketak-terlihatan: selama tidak menolong, akun platform tidak bisa
 *    ditemukan; begitu ia menolong, tenant berhak tahu siapa yang masuk. Yang
 *    disembunyikan adalah keberadaannya, bukan kunjungannya.
 *  - **Yang ditulis hanya membaca.** `helpTenant` mengembalikan ringkasan
 *    (identitas tenant, anggota, toko) dan hanya itu; sesi ini tidak memberi izin
 *    menulis apa pun di dalam tenant.
 *  - **Bukan untuk rumah sendiri.** Tenant yang **ia dirikan sendiri** ditolak
 *    (`ownsTenant`): di sana ia sudah pemilik, jadi pendampingan bukan bantuan —
 *    dan “kapan pengembang masuk” kehilangan artinya kalau rumahnya sendiri ikut
 *    dicatat sebagai kunjungan.
 *
 * Semua keputusan di bawah tanpa Convex, jadi diuji langsung di
 * `scripts/verify-impersonation.mjs`.
 */

/** Penanda asal baris audit; satu-satunya nilai yang sah. */
export const IMPERSONATION_SOURCE = "platform";

/** Aksi audit yang ditulis sesi pendampingan. */
export const IMPERSONATION_ACTIONS = {
  started: "platform.impersonation.started",
  help: "platform.impersonation.help",
  ended: "platform.impersonation.ended",
  expired: "platform.impersonation.expired",
} as const;

export type ImpersonationAction =
  (typeof IMPERSONATION_ACTIONS)[keyof typeof IMPERSONATION_ACTIONS];

/** Semua aksi di atas diawali ini, jadi penyaring jejak tidak perlu mencocokkan daftar. */
export const IMPERSONATION_ACTION_PREFIX = "platform.impersonation.";

export const IMPERSONATION_REASON_MIN = 10;
export const IMPERSONATION_REASON_MAX = 200;

/** Lama sesi bawaan & batas atasnya (menit). */
export const IMPERSONATION_DEFAULT_MINUTES = 60;
export const IMPERSONATION_MAX_MINUTES = 120;

/** Satu pengembang hanya boleh punya satu sesi hidup. */
export const IMPERSONATION_MAX_ACTIVE = 1;

/** Batas baca ringkasan bantuan (agar satu sesi tidak memindai seluruh tenant). */
export const IMPERSONATION_MEMBERS_LIMIT = 20;
export const IMPERSONATION_STORES_LIMIT = 10;
export const IMPERSONATION_TRAIL_LIMIT = 20;
export const IMPERSONATION_SESSION_LIMIT = 20;

/** Jeda pekerja perapian sesi kedaluwarsa (menit). */
export const IMPERSONATION_SWEEP_INTERVAL_MINUTES = 30;
export const IMPERSONATION_SWEEP_BATCH = 50;

/** Lama sesi yang dipakai: dibulatkan ke menit utuh lalu dipatok di rentang sah. */
export function impersonationMinutes(minutes?: number | null): number {
  if (minutes === undefined || minutes === null || !Number.isFinite(minutes)) {
    return IMPERSONATION_DEFAULT_MINUTES;
  }
  const whole = Math.floor(minutes);
  if (whole < 1) return 1;
  return Math.min(whole, IMPERSONATION_MAX_MINUTES);
}

/** Akhir masa hidup sesi: `startedAt` + menit yang sah. */
export function impersonationExpiry(startedAt: number, minutes?: number | null): number {
  return startedAt + impersonationMinutes(minutes) * 60_000;
}

/**
 * Alasan sesi: dirapikan (spasi dirapatkan) lalu diperiksa panjangnya.
 *
 * Mengembalikan `null` kalau sah — pesannya Bahasa Indonesia supaya bisa langsung
 * ditampilkan, sama seperti validator lain di repo ini.
 */
export function validateImpersonationReason(
  reason: string | null | undefined,
): string | null {
  const text = normalizeImpersonationReason(reason ?? "");
  if (text.length === 0) return "Alasan pendampingan wajib diisi.";
  if (text.length < IMPERSONATION_REASON_MIN) {
    return `Alasan pendampingan minimal ${IMPERSONATION_REASON_MIN} karakter — tulis apa yang mau dibantu.`;
  }
  if (text.length > IMPERSONATION_REASON_MAX) {
    return `Alasan pendampingan maksimal ${IMPERSONATION_REASON_MAX} karakter.`;
  }
  return null;
}

/** Spasi berlebih dibuang supaya alasan tersimpan rapi dan mudah dicari. */
export function normalizeImpersonationReason(reason: string): string {
  return reason.replace(/\s+/g, " ").trim();
}

export type ImpersonationStatus = "active" | "ended" | "expired";

/** Bentuk minimum yang dibutuhkan aturan-aturan di bawah. */
export interface ImpersonationSessionShape {
  status: "active" | "ended";
  startedAt: number;
  expiresAt: number;
  endedAt?: number | null;
}

/**
 * Status sesi **pada saat dibaca**.
 *
 * `expired` adalah status turunan, bukan yang tersimpan: sesi yang waktunya habis
 * tetapi belum dirapikan pekerja tetap harus dianggap mati. Kalau kedaluwarsa
 * hanya mengandalkan pekerja, jeda antarputaran menjadi jendela akses.
 */
export function impersonationStatus(
  session: ImpersonationSessionShape,
  now: number,
): ImpersonationStatus {
  if (session.status === "ended") return "ended";
  return now >= session.expiresAt ? "expired" : "active";
}

export function isImpersonationActive(
  session: ImpersonationSessionShape | null | undefined,
  now: number,
): boolean {
  if (!session) return false;
  return impersonationStatus(session, now) === "active";
}

/** Detik tersisa sampai sesi mati; 0 kalau sudah lewat/berakhir. */
export function impersonationRemainingMs(
  session: ImpersonationSessionShape,
  now: number,
): number {
  if (!isImpersonationActive(session, now)) return 0;
  return Math.max(0, session.expiresAt - now);
}

/** Lama sesi berjalan (dipakai ringkasan & jejak audit). */
export function impersonationDurationMinutes(
  session: ImpersonationSessionShape,
  now: number,
): number {
  const end =
    session.status === "ended" && typeof session.endedAt === "number"
      ? session.endedAt
      : Math.min(now, session.expiresAt);
  return Math.max(0, Math.round((end - session.startedAt) / 60_000));
}

export interface ImpersonationStartInput {
  /** Waktu keputusan; diberikan pemanggil supaya fungsinya tetap murni. */
  now: number;
  /** Apakah tenant tujuan benar-benar ada di deployment ini. */
  tenantExists: boolean;
  /**
   * Apakah tenant tujuan adalah **workspace milik pengembang itu sendiri**.
   *
   * Akun platform boleh mendirikan workspace sendiri (lihat `lib/platform.ts`),
   * dan justru karena itu jalur pendampingan harus menolaknya: di sana ia sudah
   * pemilik, sehingga masuknya lewat keanggotaan — bukan lewat bantuan berjejak
   * yang membuat tiap kunjungannya tercatat di audit tenant itu.
   */
  ownsTenant?: boolean;
  /** Sesi hidup milik pengembang yang sama, kalau ada. */
  activeSession: (ImpersonationSessionShape & { tenantName?: string }) | null;
  reason: string | null | undefined;
  minutes?: number | null;
}

export type ImpersonationStartDecision =
  | { allowed: true; reason: string; minutes: number }
  | { allowed: false; reason: string };

/**
 * Boleh-tidaknya membuka sesi baru.
 *
 * Urutannya penting: tenant diperiksa lebih dulu, lalu alasan, lalu sesi yang
 * masih hidup. Dengan begitu pengembang yang salah mengetik id tenant tidak
 * diberi tahu “alasanmu kurang panjang” — pesannya memang harus menunjuk masalah
 * yang sebenarnya.
 */
export function decideImpersonationStart(
  input: ImpersonationStartInput,
): ImpersonationStartDecision {
  if (!input.tenantExists) {
    return { allowed: false, reason: "Tenant tujuan tidak ditemukan." };
  }

  // Diperiksa sebelum alasan & sesi hidup: ini penolakan struktural, bukan soal
  // kelengkapan isian, jadi pesannya pun harus menunjuk sebab yang sebenarnya.
  if (input.ownsTenant === true) {
    return {
      allowed: false,
      reason:
        "Tenant ini workspace milik akun Anda sendiri — buka dashboard-nya lewat aplikasi, bukan lewat sesi pendampingan.",
    };
  }

  const masalahAlasan = validateImpersonationReason(input.reason);
  if (masalahAlasan) return { allowed: false, reason: masalahAlasan };

  if (input.activeSession && isImpersonationActive(input.activeSession, input.now)) {
    const tujuan = input.activeSession.tenantName
      ? `ke ${input.activeSession.tenantName}`
      : "ke tenant lain";
    return {
      allowed: false,
      reason: `Masih ada pendampingan aktif ${tujuan}. Akhiri dulu sebelum membuka yang baru — satu pengembang satu sesi, supaya jejak auditnya tidak tertukar.`,
    };
  }

  return {
    allowed: true,
    reason: normalizeImpersonationReason(String(input.reason ?? "")),
    minutes: impersonationMinutes(input.minutes),
  };
}

/** Data akun platform yang ikut ditulis ke jejak audit tenant. */
export interface ImpersonationAccount {
  email: string;
  name: string;
  platformRole: string;
}

export interface ImpersonationAuditMeta {
  source: typeof IMPERSONATION_SOURCE;
  sessionId: string;
  platformEmail: string;
  platformName: string;
  platformRole: string;
  reason: string;
  minutes: number;
  helpCount?: number;
  durationMinutes?: number;
  /** Siapa yang mengakhiri: pengembang (`ended`) atau pekerja perapian (`expired`). */
  closedBy?: "developer" | "sweeper";
}

/** Meta audit satu langkah sesi. Bentuknya satu supaya penyaring jejak konsisten. */
export function impersonationAuditMeta(input: {
  account: ImpersonationAccount;
  sessionId: string;
  reason: string;
  minutes: number;
  helpCount?: number;
  durationMinutes?: number;
  closedBy?: "developer" | "sweeper";
}): ImpersonationAuditMeta {
  return {
    source: IMPERSONATION_SOURCE,
    sessionId: input.sessionId,
    platformEmail: input.account.email,
    platformName: input.account.name,
    platformRole: input.account.platformRole,
    reason: input.reason,
    minutes: input.minutes,
    ...(input.helpCount === undefined ? {} : { helpCount: input.helpCount }),
    ...(input.durationMinutes === undefined
      ? {}
      : { durationMinutes: input.durationMinutes }),
    ...(input.closedBy === undefined ? {} : { closedBy: input.closedBy }),
  };
}

/**
 * Baris audit pembuka: kalimatnya **menyebut dirinya platform**, jadi tenant yang
 * membaca jejaknya tahu ini bukan anggota timnya.
 */
export function impersonationStartedAudit(input: {
  account: ImpersonationAccount;
  sessionId: string;
  reason: string;
  minutes: number;
}): { action: ImpersonationAction; entity: string; entityId: string; meta: ImpersonationAuditMeta } {
  return {
    action: IMPERSONATION_ACTIONS.started,
    entity: "platform.impersonation",
    entityId: input.sessionId,
    meta: impersonationAuditMeta(input),
  };
}

/** Baris audit tiap kali ringkasan bantuan dibaca (jumlah baca ikut dicatat). */
export function impersonationHelpAudit(input: {
  account: ImpersonationAccount;
  sessionId: string;
  reason: string;
  minutes: number;
  helpCount: number;
}): { action: ImpersonationAction; entity: string; entityId: string; meta: ImpersonationAuditMeta } {
  return {
    action: IMPERSONATION_ACTIONS.help,
    entity: "platform.impersonation",
    entityId: input.sessionId,
    meta: impersonationAuditMeta(input),
  };
}

/** Baris audit penutup, memuat lama sesi & berapa kali tenant dibaca. */
export function impersonationClosedAudit(input: {
  account: ImpersonationAccount;
  session: ImpersonationSessionShape & { _id?: string; reason: string; helpCount?: number };
  sessionId: string;
  now: number;
  closedBy: "developer" | "sweeper";
}): { action: ImpersonationAction; entity: string; entityId: string; meta: ImpersonationAuditMeta } {
  return {
    action:
      input.closedBy === "sweeper"
        ? IMPERSONATION_ACTIONS.expired
        : IMPERSONATION_ACTIONS.ended,
    entity: "platform.impersonation",
    entityId: input.sessionId,
    meta: impersonationAuditMeta({
      account: input.account,
      sessionId: input.sessionId,
      reason: input.session.reason,
      minutes: impersonationMinutes(
        Math.round((input.session.expiresAt - input.session.startedAt) / 60_000),
      ),
      helpCount: input.session.helpCount ?? 0,
      durationMinutes: impersonationDurationMinutes(input.session, input.now),
      closedBy: input.closedBy,
    }),
  };
}

/** Ringkasan satu baris untuk log/pesan. */
export function describeImpersonation(input: {
  tenantName: string;
  account: ImpersonationAccount;
  session: ImpersonationSessionShape;
  now: number;
}): string {
  const status = impersonationStatus(input.session, input.now);
  const menit = impersonationDurationMinutes(input.session, input.now);
  const label =
    status === "active"
      ? `berjalan ${menit} menit`
      : status === "expired"
        ? `kedaluwarsa setelah ${menit} menit`
        : `selesai setelah ${menit} menit`;
  return `Pendampingan platform ${input.tenantName} oleh ${input.account.name} <${input.account.email}> · ${label}`;
}

export interface ImpersonationSummaryRow {
  status: "active" | "ended";
  startedAt: number;
  expiresAt: number;
  endedAt?: number | null;
  helpCount: number;
}

/** Rekap sesi untuk halaman backstage: berapa hidup, berapa yang mati sendiri. */
export function summariseImpersonations(
  rows: ImpersonationSummaryRow[],
  now: number,
): {
  total: number;
  active: number;
  expired: number;
  ended: number;
  helpTotal: number;
  minutesTotal: number;
  activeSession: ImpersonationSummaryRow | null;
} {
  let active = 0;
  let expired = 0;
  let ended = 0;
  let helpTotal = 0;
  let minutesTotal = 0;
  let activeSession: ImpersonationSummaryRow | null = null;

  for (const row of rows) {
    const status = impersonationStatus(row, now);
    if (status === "active") {
      active += 1;
      if (!activeSession) activeSession = row;
    } else if (status === "expired") {
      expired += 1;
    } else {
      ended += 1;
    }
    helpTotal += row.helpCount ?? 0;
    minutesTotal += impersonationDurationMinutes(row, now);
  }

  return {
    total: rows.length,
    active,
    expired,
    ended,
    helpTotal,
    minutesTotal,
    activeSession,
  };
}

/** Baris `auditLogs` mentah seperlunya untuk penyaring jejak. */
export interface RawAuditRow {
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: string | null;
  createdAt: number;
}

export interface ImpersonationTrailRow {
  id: string;
  kind: "started" | "help" | "ended" | "expired";
  at: number;
  platformEmail: string;
  platformName: string;
  reason: string;
  helpCount: number;
  durationMinutes: number | null;
  label: string;
}

const KIND_BY_ACTION: Record<string, ImpersonationTrailRow["kind"]> = {
  [IMPERSONATION_ACTIONS.started]: "started",
  [IMPERSONATION_ACTIONS.help]: "help",
  [IMPERSONATION_ACTIONS.ended]: "ended",
  [IMPERSONATION_ACTIONS.expired]: "expired",
};

/**
 * Apakah baris audit ini milik sesi pendampingan platform.
 *
 * Penandanya **isi meta**, bukan `actorId`: pelakunya memang akun platform, dan
 * baris yang hanya kebetulan punya actor itu tidak boleh ikut terbaca sebagai
 * kunjungan. Baris tanpa meta yang sah diabaikan, bukan ditebak.
 */
export function parseImpersonationAudit(row: RawAuditRow): ImpersonationAuditMeta | null {
  if (!row.action.startsWith(IMPERSONATION_ACTION_PREFIX)) return null;
  if (row.entity !== "platform.impersonation") return null;
  if (!row.meta) return null;
  try {
    const parsed = JSON.parse(row.meta) as Partial<ImpersonationAuditMeta>;
    if (parsed.source !== IMPERSONATION_SOURCE) return null;
    if (typeof parsed.platformEmail !== "string") return null;
    if (typeof parsed.sessionId !== "string") return null;
    return {
      source: IMPERSONATION_SOURCE,
      sessionId: parsed.sessionId,
      platformEmail: parsed.platformEmail,
      platformName: typeof parsed.platformName === "string" ? parsed.platformName : "",
      platformRole: typeof parsed.platformRole === "string" ? parsed.platformRole : "",
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      minutes: typeof parsed.minutes === "number" ? parsed.minutes : 0,
      helpCount: typeof parsed.helpCount === "number" ? parsed.helpCount : undefined,
      durationMinutes:
        typeof parsed.durationMinutes === "number" ? parsed.durationMinutes : undefined,
      closedBy: parsed.closedBy,
    };
  } catch {
    return null;
  }
}

/** Jejak siap tampil untuk tenant yang dibantu (terbaru dulu). */
export function impersonationTrail(
  rows: RawAuditRow[],
  limit: number = IMPERSONATION_TRAIL_LIMIT,
): ImpersonationTrailRow[] {
  const out: ImpersonationTrailRow[] = [];
  for (const row of rows) {
    const meta = parseImpersonationAudit(row);
    if (!meta) continue;
    const kind = KIND_BY_ACTION[row.action];
    if (!kind) continue;
    out.push({
      id: `${meta.sessionId}:${kind}:${row.createdAt}`,
      kind,
      at: row.createdAt,
      platformEmail: meta.platformEmail,
      platformName: meta.platformName,
      reason: meta.reason,
      helpCount: meta.helpCount ?? 0,
      durationMinutes: meta.durationMinutes ?? null,
      label: trailLabel(kind, meta),
    });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, Math.max(0, limit));
}

function trailLabel(kind: ImpersonationTrailRow["kind"], meta: ImpersonationAuditMeta): string {
  const siapa = meta.platformName
    ? `${meta.platformName} (${meta.platformEmail})`
    : meta.platformEmail;
  switch (kind) {
    case "started":
      return `Pengembang platform ${siapa} membuka pendampingan: ${meta.reason}`;
    case "help":
      return `Pengembang platform ${siapa} membuka ringkasan bantuan (ke-${meta.helpCount ?? 1})`;
    case "ended":
      return `Pendampingan oleh ${siapa} ditutup setelah ${meta.durationMinutes ?? 0} menit`;
    case "expired":
      return `Pendampingan oleh ${siapa} kedaluwarsa setelah ${meta.durationMinutes ?? 0} menit`;
  }
}

/**
 * Baris-baris yang harus ditutup pekerja perapian: sesi yang **tertulis masih
 * hidup** tetapi waktunya sudah lewat. Sesi yang sudah `ended` tidak disentuh, dan
 * sesi yang belum lewat tidak dipercepat.
 */
export function sessionsToSweep<T extends ImpersonationSessionShape & { _id: string }>(
  rows: T[],
  now: number,
): T[] {
  return rows.filter((row) => row.status === "active" && now >= row.expiresAt);
}

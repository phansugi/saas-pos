/**
 * Dukungan khusus (`support.dedicated`, Phase 5 / Dukungan khusus & skala
 * franchise) — aturan murni.
 *
 * Modul ini dipakai bersama oleh backend (`src/convex/support.ts`), halaman
 * Dukungan, kedua store, dan harness, jadi semua keputusan ada di sini (Convex
 * hanya membundel modul di bawah `src/convex`).
 *
 * Empat prinsipnya:
 *
 * 1. **Membuka tiket itu hak semua paket; yang dijual adalah jalur cepatnya.**
 *    Fitur `support.dedicated` tidak mengunci tiket — ia menentukan prioritas
 *    yang boleh dipakai (Tinggi/Mendesak) dan boleh-tidaknya tiket dieskalasi ke
 *    manajer akun. Kalau fiturnya mati sementara, tiket lama tetap bisa
 *    dicatat, ditutup, dan dibuka ulang.
 * 2. **SLA dipatok saat tiket dibuat, bukan dihitung ulang dari paket hari ini.**
 *    Paket yang naik/turun tidak boleh mengubah janji tanggap untuk tiket yang
 *    sudah masuk: penerima janji adalah pelanggan, bukan sistem.
 * 3. **Status hanya berubah lewat jalur yang sah.** `open → in_progress →
 *    resolved`, dan `resolved → open` (buka ulang), tidak ada lompatan lain.
 *    Menutup tikét wajib menyebut penyelesaiannya — tiket "selesai" tanpa
 *    keterangan tidak menolong siapa pun yang membacanya enam bulan lagi.
 * 4. **Riwayatnya append-only dan terbatas.** Setiap aksi menambah satu baris
 *    catatan (`kind: "note" | "status"`), dan tiket yang catatannya sudah penuh
 *    ditolak — bukan dipangkas diam-diam, karena memangkas di tengah justru
 *    membuang bagian yang paling baru.
 */

import { PLANS, type PlanKey } from "./billing";

export const HOUR_MS = 60 * 60 * 1000;

// ------------------------------------------------------------------ kategori

export type SupportCategory = "bug" | "payment" | "data" | "howto" | "other";

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  bug: "Gangguan / error aplikasi",
  payment: "Tagihan & langganan",
  data: "Data tidak sesuai",
  howto: "Cara memakai fitur",
  other: "Lain-lain",
};

export const SUPPORT_CATEGORY_KEYS = Object.keys(
  SUPPORT_CATEGORY_LABELS,
) as SupportCategory[];

// ----------------------------------------------------------------- prioritas

export type SupportPriority = "low" | "normal" | "high" | "urgent";

export const SUPPORT_PRIORITY_LABELS: Record<SupportPriority, string> = {
  low: "Rendah",
  normal: "Normal",
  high: "Tinggi",
  urgent: "Mendesak",
};

export const SUPPORT_PRIORITY_KEYS = Object.keys(
  SUPPORT_PRIORITY_LABELS,
) as SupportPriority[];

/**
 * Prioritas yang memakai jalur tanggap cepat — inilah yang dijual fitur
 * `support.dedicated`. Prioritas di bawahnya selalu boleh.
 */
export const DEDICATED_PRIORITIES: SupportPriority[] = ["high", "urgent"];

/** Pengali target tanggap per prioritas (Mendesak paling cepat). */
export const SUPPORT_PRIORITY_FACTOR: Record<SupportPriority, number> = {
  urgent: 0.25,
  high: 0.5,
  normal: 1,
  low: 2,
};

// -------------------------------------------------------------------- status

export type SupportStatus = "open" | "in_progress" | "resolved";

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  open: "Menunggu ditangani",
  in_progress: "Sedang ditangani",
  resolved: "Selesai",
};

// ----------------------------------------------------------------------- SLA

export interface SupportPlanProfile {
  /** Kanal dukungan yang tersedia di paket ini. */
  channel: string;
  /** Target tanggap dasar untuk prioritas Normal, dalam jam. */
  responseHours: number;
  /** Paket ini menyediakan jalur eskalasi ke manajer akun. */
  accountManager: boolean;
}

/**
 * Janji dukungan per paket. `support.dedicated` (Enterprise) memakai jalur
 * cepat & manajer akun; dua paket di bawahnya tetap punya kanal dan target
 * tanggap yang jelas, hanya lebih panjang.
 */
export const PLAN_SUPPORT: Record<PlanKey, SupportPlanProfile> = {
  starter: { channel: "Email dukungan", responseHours: 48, accountManager: false },
  professional: {
    channel: "Email prioritas",
    responseHours: 24,
    accountManager: false,
  },
  enterprise: {
    channel: "Kanal langsung + manajer akun",
    responseHours: 8,
    accountManager: true,
  },
};

export function supportPlanFor(planKey: PlanKey): SupportPlanProfile {
  return PLAN_SUPPORT[planKey] ?? PLAN_SUPPORT.starter;
}

/**
 * Target tanggap (jam) untuk satu paket + prioritas. Selalu ≥ 1 jam — janji
 * "tanggap dalam 0 jam" tidak bisa ditepati siapa pun.
 */
export function responseHoursFor(
  planKey: PlanKey,
  priority: SupportPriority,
): number {
  const base = supportPlanFor(planKey).responseHours;
  const factor = SUPPORT_PRIORITY_FACTOR[priority] ?? 1;
  return Math.max(1, Math.round(base * factor));
}

/** Label ringkas untuk kartu SLA: "Normal: 24 jam · Mendesak: 6 jam". */
export function slaLabel(planKey: PlanKey, priority: SupportPriority): string {
  return `${SUPPORT_PRIORITY_LABELS[priority]} ${responseHoursFor(planKey, priority)} jam`;
}

// ------------------------------------------------------------------ validasi

export const SUPPORT_SUBJECT_MIN = 5;
export const SUPPORT_SUBJECT_MAX = 120;
export const SUPPORT_BODY_MIN = 10;
export const SUPPORT_BODY_MAX = 4000;
export const SUPPORT_NOTE_MIN = 3;
export const SUPPORT_NOTE_MAX = 1000;
export const SUPPORT_RESOLUTION_MIN = 5;
/** Batas catatan per tiket; tiket yang penuh harus diselesaikan lalu dibuat baru. */
export const MAX_TICKET_LOG = 60;
/** Batas tiket yang masih berjalan (bukan `resolved`) per tenant. */
export const MAX_OPEN_TICKETS = 25;

export type SupportResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

/** Rapikan subjek/kategori: buang spasi pinggir dan rapatkan spasi tengah. */
export function normalizeSubject(raw: string): string {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

/** Uraian boleh berbaris, jadi hanya spasi pinggir yang dibuang. */
export function normalizeBody(raw: string): string {
  return (raw ?? "").trim();
}

export function isSupportCategory(value: string): value is SupportCategory {
  return (SUPPORT_CATEGORY_KEYS as string[]).includes(value);
}

export function isSupportPriority(value: string): value is SupportPriority {
  return (SUPPORT_PRIORITY_KEYS as string[]).includes(value);
}

export function isSupportStatus(value: string): value is SupportStatus {
  return value === "open" || value === "in_progress" || value === "resolved";
}

export interface SupportTicketDraft {
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  body: string;
}

export interface SupportTicketOptions {
  /**
   * Fitur `support.dedicated` sedang hidup. Tanpa itu, prioritas Tinggi &
   * Mendesak ditolak dengan pesan yang menyuruh naik paket — bukan diam-diam
   * diturunkan ke Normal, karena pelanggan akan mengira janjinya lebih cepat.
   */
  dedicated: boolean;
  /** Jumlah tiket yang masih berjalan saat ini. */
  openCount?: number;
}

export function validateTicketInput(
  input: {
    subject?: string;
    category?: string;
    priority?: string;
    body?: string;
  },
  options: SupportTicketOptions,
): SupportResult<SupportTicketDraft> {
  const subject = normalizeSubject(input.subject ?? "");
  if (subject.length < SUPPORT_SUBJECT_MIN || subject.length > SUPPORT_SUBJECT_MAX) {
    return {
      ok: false,
      reason: `Subjek harus ${SUPPORT_SUBJECT_MIN}–${SUPPORT_SUBJECT_MAX} karakter.`,
    };
  }

  const body = normalizeBody(input.body ?? "");
  if (body.length < SUPPORT_BODY_MIN || body.length > SUPPORT_BODY_MAX) {
    return {
      ok: false,
      reason: `Uraian harus ${SUPPORT_BODY_MIN}–${SUPPORT_BODY_MAX} karakter; jelaskan apa yang terjadi dan langkah yang sudah dicoba.`,
    };
  }

  if (!input.category || !isSupportCategory(input.category)) {
    return { ok: false, reason: "Pilih kategori tiket yang dikenal." };
  }
  if (!input.priority || !isSupportPriority(input.priority)) {
    return { ok: false, reason: "Pilih prioritas tiket yang dikenal." };
  }

  if (DEDICATED_PRIORITIES.includes(input.priority) && !options.dedicated) {
    return {
      ok: false,
      reason: `Prioritas ${SUPPORT_PRIORITY_LABELS[input.priority]} memakai jalur dukungan khusus (${PLANS.enterprise.name}); tanpa itu pakai prioritas Normal atau Rendah.`,
    };
  }

  if ((options.openCount ?? 0) >= MAX_OPEN_TICKETS) {
    return {
      ok: false,
      reason: `Maksimal ${MAX_OPEN_TICKETS} tiket berjalan sekaligus; selesaikan dulu yang sudah terjawab.`,
    };
  }

  return {
    ok: true,
    value: { subject, category: input.category, priority: input.priority, body },
  };
}

export function validateNote(raw: string): SupportResult<string> {
  const note = normalizeBody(raw);
  if (note.length < SUPPORT_NOTE_MIN || note.length > SUPPORT_NOTE_MAX) {
    return {
      ok: false,
      reason: `Catatan harus ${SUPPORT_NOTE_MIN}–${SUPPORT_NOTE_MAX} karakter.`,
    };
  }
  return { ok: true, value: note };
}

export function validateResolution(raw: string): SupportResult<string> {
  const note = normalizeBody(raw);
  if (note.length < SUPPORT_RESOLUTION_MIN || note.length > SUPPORT_NOTE_MAX) {
    return {
      ok: false,
      reason: `Sebutkan penyelesaiannya (${SUPPORT_RESOLUTION_MIN}–${SUPPORT_NOTE_MAX} karakter) sebelum menutup tiket.`,
    };
  }
  return { ok: true, value: note };
}

/** Nomor tiket: `TKT-2026-0007`, urut per tenant. */
export function ticketNumber(sequence: number, year: number): string {
  return `TKT-${year}-${String(Math.max(1, Math.trunc(sequence))).padStart(4, "0")}`;
}

// ------------------------------------------------------------------ transisi

export const SUPPORT_ACTIONS = [
  "note",
  "start",
  "resolve",
  "reopen",
  "escalate",
] as const;

export type SupportAction = (typeof SUPPORT_ACTIONS)[number];

export const SUPPORT_ACTION_LABELS: Record<SupportAction, string> = {
  note: "Tambah catatan",
  start: "Mulai ditangani",
  resolve: "Selesaikan",
  reopen: "Buka ulang",
  escalate: "Eskalasi ke manajer akun",
};

/** Bagian tiket yang dibutuhkan aturan transisi (bukan seluruh baris DB). */
export interface SupportTicketLike {
  number: string;
  status: SupportStatus;
  createdAt: number;
  /** Jam tanggap yang dipatok saat tiket dibuat. */
  slaHours: number;
  escalated: boolean;
  resolvedAt: number | null;
  logCount: number;
}

/**
 * Hasil satu aksi: status baru, waktu selesai, penanda eskalasi, dan baris
 * catatan yang harus ditulis. `kind` membedakan catatan biasa dari perubahan
 * status supaya riwayat di halaman bisa membaca mana yang mengubah keadaan.
 */
export interface SupportActionPatch {
  status: SupportStatus;
  resolvedAt: number | null;
  escalated: boolean;
  note: string | null;
  kind: "note" | "status";
}

export function applySupportAction(
  ticket: SupportTicketLike,
  action: SupportAction,
  args: { now: number; note?: string },
): SupportResult<SupportActionPatch> {
  if (ticket.logCount >= MAX_TICKET_LOG) {
    return {
      ok: false,
      reason: `Riwayat tiket ${ticket.number} sudah penuh (${MAX_TICKET_LOG} catatan); selesaikan dan buka tiket baru.`,
    };
  }

  const unchanged = {
    status: ticket.status,
    resolvedAt: ticket.resolvedAt,
    escalated: ticket.escalated,
  };

  if (action === "note") {
    const note = validateNote(args.note ?? "");
    if (!note.ok) return note;
    return { ok: true, value: { ...unchanged, note: note.value, kind: "note" } };
  }

  if (action === "start") {
    if (ticket.status !== "open") {
      return {
        ok: false,
        reason:
          ticket.status === "in_progress"
            ? `Tiket ${ticket.number} sudah dalam penanganan.`
            : `Tiket ${ticket.number} sudah selesai; buka ulang dulu kalau masih bermasalah.`,
      };
    }
    return {
      ok: true,
      value: {
        status: "in_progress",
        resolvedAt: null,
        escalated: ticket.escalated,
        note: args.note === undefined ? null : normalizeBody(args.note),
        kind: "status",
      },
    };
  }

  if (action === "resolve") {
    if (ticket.status === "resolved") {
      return { ok: false, reason: `Tiket ${ticket.number} sudah selesai.` };
    }
    const note = validateResolution(args.note ?? "");
    if (!note.ok) return note;
    return {
      ok: true,
      value: {
        status: "resolved",
        resolvedAt: args.now,
        escalated: ticket.escalated,
        note: note.value,
        kind: "status",
      },
    };
  }

  if (action === "reopen") {
    if (ticket.status !== "resolved") {
      return {
        ok: false,
        reason: `Hanya tiket yang sudah selesai yang bisa dibuka ulang (${ticket.number} berstatus ${SUPPORT_STATUS_LABELS[ticket.status]}).`,
      };
    }
    const note = args.note === undefined ? null : normalizeBody(args.note);
    if (note !== null && note.length > 0) {
      const checked = validateNote(note);
      if (!checked.ok) return checked;
    }
    return {
      ok: true,
      value: {
        status: "open",
        resolvedAt: null,
        escalated: ticket.escalated,
        note: note && note.length > 0 ? note : null,
        kind: "status",
      },
    };
  }

  // escalate
  if (ticket.status === "resolved") {
    return {
      ok: false,
      reason: `Tiket ${ticket.number} sudah selesai; buka ulang dulu sebelum dieskalasi.`,
    };
  }
  if (ticket.escalated) {
    return { ok: false, reason: `Tiket ${ticket.number} sudah dieskalasi.` };
  }
  return {
    ok: true,
    value: {
      status: ticket.status,
      resolvedAt: null,
      escalated: true,
      note: args.note === undefined ? null : normalizeBody(args.note),
      kind: "status",
    },
  };
}

/**
 * Isi satu baris riwayat untuk hasil sebuah aksi.
 *
 * Catatan yang ditulis pengguna dipakai apa adanya; aksi tanpa catatan tetap
 * meninggalkan kalimat standar, karena baris "status" tanpa penjelasan membuat
 * riwayat tidak bisa dibaca ulang. Kalimatnya ada di aturan murni (bukan di
 * backend atau halaman) supaya riwayat demo dan riwayat backend berbunyi sama.
 */
export function logBodyFor(
  action: SupportAction,
  patch: SupportActionPatch,
): string {
  if (patch.note && patch.note.length > 0) return patch.note;
  if (action === "start") return "Mulai ditangani.";
  if (action === "reopen") return "Dibuka ulang.";
  if (action === "escalate") return "Dieskalasi ke manajer akun.";
  return `Status diubah ke ${SUPPORT_STATUS_LABELS[patch.status]}.`;
}

// ----------------------------------------------------------------------- SLA

export function dueAt(ticket: SupportTicketLike): number {
  return ticket.createdAt + ticket.slaHours * HOUR_MS;
}

/** Jam menuju tenggat; 0 kalau sudah lewat. */
export function remainingHours(ticket: SupportTicketLike, now: number): number {
  const left = dueAt(ticket) - now;
  return left <= 0 ? 0 : Math.ceil(left / HOUR_MS);
}

export type SupportSlaState =
  | "on_track"
  | "due_soon"
  | "overdue"
  | "met"
  | "missed";

export const SUPPORT_SLA_LABELS: Record<SupportSlaState, string> = {
  on_track: "Dalam jadwal",
  due_soon: "Segera jatuh tempo",
  overdue: "Lewat janji",
  met: "Tepat waktu",
  missed: "Lewat janji saat ditutup",
};

/** Ambang bawaan "segera jatuh tempo": seperempat jendela. */
export const DUE_SOON_MIN_MS = 30 * 60 * 1000;
export const DUE_SOON_MAX_MS = 2 * HOUR_MS;

/**
 * Ambang "segera jatuh tempo": seperempat jendela, dijaga di antara 30 menit
 * dan 2 jam, dan **selalu lebih pendek dari jendelanya sendiri**.
 *
 * Versi pertama aturan ini (minimal 2 jam, tanpa batas atas) membuat tiket baru
 * berjanji 2 jam langsung berstatus "segera jatuh tempo" pada detik pembuatannya
 * — jendelanya memang 2 jam. Batas atas `jendela - 1 ms` memperbaiki akarnya:
 * tiket yang baru dibuat tidak boleh terlihat hampir lewat.
 */
export function dueSoonWindowMs(slaHours: number): number {
  const window = Math.max(HOUR_MS, slaHours * HOUR_MS);
  const quarter = window / 4;
  return Math.min(
    Math.max(quarter, DUE_SOON_MIN_MS),
    DUE_SOON_MAX_MS,
    Math.max(1, window - 1),
  );
}

export function slaState(ticket: SupportTicketLike, now: number): SupportSlaState {
  const due = dueAt(ticket);
  // Tiket yang baru dibuat tidak boleh langsung dianggap hampir lewat.
  if (ticket.status !== "resolved" && now <= ticket.createdAt) return "on_track";
  if (ticket.status === "resolved") {
    const closedAt = ticket.resolvedAt ?? now;
    return closedAt <= due ? "met" : "missed";
  }
  if (now > due) return "overdue";
  if (due - now <= dueSoonWindowMs(ticket.slaHours)) return "due_soon";
  return "on_track";
}

/** Jeda antar-putaran pengingat janji tanggap (menit). */
export const SLA_REMINDER_INTERVAL_MINUTES = 30;
/** Batas tiket yang diperiksa satu putaran pengingat. */
export const SLA_REMINDER_BATCH = 50;

/**
 * Apakah tiket ini perlu diingatkan sekarang: masih berjalan, **belum pernah**
 * diingatkan, dan janji tanggapnya sudah masuk jendela “segera jatuh tempo” atau
 * sudah terlewat. Ambangnya memakai `dueSoonWindowMs` yang sama dengan halaman,
 * jadi pengingat dan warna badge tidak pernah berbeda pendapat; dan karena
 * pengingatnya sekali per tiket, satu tiket tidak diberitakan setiap putaran.
 */
export function needsSlaReminder(
  ticket: SupportTicketLike & { slaNotified?: boolean },
  now: number,
): boolean {
  if (ticket.status === "resolved") return false;
  if (ticket.slaNotified) return false;
  const state = slaState(ticket, now);
  return state === "due_soon" || state === "overdue";
}

export interface SupportSummary {
  open: number;
  inProgress: number;
  resolved: number;
  escalated: number;
  /** Tiket berjalan yang sudah melewati janji tanggap. */
  overdue: number;
  /** Tiket berjalan yang tenggatnya tinggal ≤ seperempat jendela. */
  dueSoon: number;
  /** Tenggat terdekat dari tiket yang belum selesai. */
  nextDueAt: number | null;
}

export function supportSummary(
  tickets: readonly SupportTicketLike[],
  now: number,
): SupportSummary {
  let open = 0;
  let inProgress = 0;
  let resolved = 0;
  let escalated = 0;
  let overdue = 0;
  let dueSoon = 0;
  let nextDueAt: number | null = null;

  for (const ticket of tickets) {
    if (ticket.status === "open") open += 1;
    else if (ticket.status === "in_progress") inProgress += 1;
    else resolved += 1;
    if (ticket.escalated) escalated += 1;

    if (ticket.status === "resolved") continue;
    const state = slaState(ticket, now);
    if (state === "overdue") overdue += 1;
    else if (state === "due_soon") dueSoon += 1;
    const due = dueAt(ticket);
    if (nextDueAt === null || due < nextDueAt) nextDueAt = due;
  }

  return { open, inProgress, resolved, escalated, overdue, dueSoon, nextDueAt };
}

/** Tiket yang masih berjalan — angka yang dibandingkan dengan `MAX_OPEN_TICKETS`. */
export function openTicketCount(tickets: readonly SupportTicketLike[]): number {
  return tickets.filter((ticket) => ticket.status !== "resolved").length;
}

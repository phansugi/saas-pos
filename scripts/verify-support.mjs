/**
 * Uji aturan dukungan khusus (`support.dedicated`, Phase 5) tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/support.ts` — modul murni yang dipakai
 * backend (`src/convex/support.ts`), halaman Dukungan, kedua store, dan
 * `convex/schema.ts`. Selain aturannya, harness ini menjaga dua hal yang mudah
 * melenceng tanpa disadari:
 *
 *   - daftar izin di `schema.ts` (`permissionValidator`) harus memuat izin baru
 *     `support.view`/`support.manage` — izin yang lupa didaftarkan akan ditolak
 *     database dengan pesan yang membingungkan;
 *   - tabel `supportTickets` harus menyimpan janji tanggapnya **sendiri**
 *     (`slaHours`), bukan menghitungnya ulang dari paket saat dibaca — itulah
 *     yang membuat paket berubah tidak menulis ulang janji tiket lama.
 *
 * Usage: bun scripts/verify-support.mjs
 */
import { readFileSync } from "node:fs";
import { PLANS, FEATURE_LABELS } from "../src/convex/lib/billing/catalog.ts";
import {
  applySupportAction,
  DEDICATED_PRIORITIES,
  dueAt,
  dueSoonWindowMs,
  HOUR_MS,
  logBodyFor,
  MAX_OPEN_TICKETS,
  MAX_TICKET_LOG,
  needsSlaReminder,
  openTicketCount,
  PLAN_SUPPORT,
  remainingHours,
  responseHoursFor,
  slaState,
  SUPPORT_CATEGORY_KEYS,
  SUPPORT_PRIORITY_KEYS,
  supportPlanFor,
  supportSummary,
  ticketNumber,
  validateNote,
  validateResolution,
  validateTicketInput,
} from "../src/convex/lib/support.ts";
import {
  supportTicketCreatedEventData,
  supportTicketDueEventData,
  supportTicketEscalatedEventData,
  supportTicketResolvedEventData,
} from "../src/convex/lib/webhookEvents.ts";
import {
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_KEYS,
} from "../src/convex/lib/webhooks.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const NOW = 1_760_000_000_000;
const PLAN_KEYS = ["starter", "professional", "enterprise"];

/** Tiket contoh; setiap uji hanya menimpa bagian yang sedang diperiksa. */
function ticket(overrides = {}) {
  return {
    number: "TKT-2026-0001",
    status: "open",
    createdAt: NOW,
    slaHours: 24,
    escalated: false,
    resolvedAt: null,
    logCount: 0,
    ...overrides,
  };
}

/** Bungkus `applySupportAction` supaya uji bisa membaca nilai/hasil gagalnya. */
function act(t, action, args = {}) {
  return applySupportAction(t, action, { now: NOW, ...args });
}

// ---------------------------------------------------------------- janji paket
check(
  "setiap paket punya kanal dukungan & jam dasar yang wajar",
  PLAN_KEYS.every((key) => {
    const profile = supportPlanFor(key);
    return profile.channel.trim().length > 3 && profile.responseHours > 0;
  }),
  JSON.stringify(PLAN_KEYS.map((key) => supportPlanFor(key))),
);
check(
  "hanya paket Enterprise yang menyediakan manajer akun",
  supportPlanFor("enterprise").accountManager === true &&
    supportPlanFor("professional").accountManager === false &&
    supportPlanFor("starter").accountManager === false,
  JSON.stringify(PLAN_SUPPORT),
);
check(
  "paket yang tidak dikenal jatuh ke profil yang sah, bukan error",
  supportPlanFor("entah").channel === supportPlanFor("starter").channel,
  JSON.stringify(supportPlanFor("entah")),
);
check(
  "target tanggap memendek seiring naiknya prioritas",
  PLAN_KEYS.every((key) => {
    const hours = SUPPORT_PRIORITY_KEYS.map((priority) => responseHoursFor(key, priority));
    return hours.every((value, index) => index === 0 || value <= hours[index - 1]);
  }),
  JSON.stringify(
    PLAN_KEYS.map((key) => SUPPORT_PRIORITY_KEYS.map((p) => responseHoursFor(key, p))),
  ),
);
check(
  "target tanggap tidak pernah nol jam",
  PLAN_KEYS.every((key) =>
    SUPPORT_PRIORITY_KEYS.every((priority) => responseHoursFor(key, priority) >= 1),
  ),
  JSON.stringify(PLAN_KEYS.map((key) => responseHoursFor(key, "urgent"))),
);
check(
  "paket Enterprise lebih cepat dari Professional pada prioritas yang sama",
  SUPPORT_PRIORITY_KEYS.every(
    (priority) =>
      responseHoursFor("enterprise", priority) < responseHoursFor("professional", priority),
  ),
  JSON.stringify(
    SUPPORT_PRIORITY_KEYS.map((p) => [
      p,
      responseHoursFor("professional", p),
      responseHoursFor("enterprise", p),
    ]),
  ),
);

// ------------------------------------------------------------------- validasi
{
  const ok = validateTicketInput(
    { subject: "Struk tidak keluar", category: "bug", priority: "normal", body: "Sudah dicoba tiga kali, tetap tidak keluar struk." },
    { dedicated: false },
  );
  check("tiket valid diterima & dinormalkan", ok.ok === true, JSON.stringify(ok));
  check(
    "subjek dirapikan (spasi pinggir & ganda dibuang)",
    ok.ok && ok.value.subject === "Struk tidak keluar",
    ok.ok ? ok.value.subject : "",
  );
}
check(
  "subjek terlalu pendek / terlalu panjang ditolak",
  validateTicketInput({ subject: "abc", category: "bug", priority: "normal", body: "cukup panjang isinya" }, { dedicated: true }).ok === false &&
    validateTicketInput({ subject: "x".repeat(121), category: "bug", priority: "normal", body: "cukup panjang isinya" }, { dedicated: true }).ok === false,
  "DITERIMA — batas subjek bocor",
);
check(
  "uraian terlalu pendek / terlalu panjang ditolak",
  validateTicketInput({ subject: "Struk tidak keluar", category: "bug", priority: "normal", body: "pendek" }, { dedicated: true }).ok === false &&
    validateTicketInput({ subject: "Struk tidak keluar", category: "bug", priority: "normal", body: "x".repeat(4001) }, { dedicated: true }).ok === false,
  "DITERIMA — batas uraian bocor",
);
check(
  "kategori & prioritas tak dikenal ditolak",
  validateTicketInput({ subject: "Struk tidak keluar", category: "hack", priority: "normal", body: "cukup panjang isinya" }, { dedicated: true }).ok === false &&
    validateTicketInput({ subject: "Struk tidak keluar", category: "bug", priority: "super", body: "cukup panjang isinya" }, { dedicated: true }).ok === false,
  "DITERIMA — nilai tak dikenal lolos",
);
check(
  "prioritas jalur cepat ditolak tanpa fitur dukungan khusus",
  DEDICATED_PRIORITIES.every(
    (priority) =>
      validateTicketInput(
        { subject: "Struk tidak keluar", category: "bug", priority, body: "cukup panjang isinya" },
        { dedicated: false },
      ).ok === false,
  ),
  "DITERIMA — jalur cepat bisa dipakai tanpa fiturnya",
);
{
  const rejected = validateTicketInput(
    { subject: "Struk tidak keluar", category: "bug", priority: "urgent", body: "cukup panjang isinya" },
    { dedicated: false },
  );
  check(
    "penolakan prioritas tinggi menyebut paket Enterprise (naik paket, bukan diam-diam diturunkan)",
    rejected.ok === false && rejected.reason.includes(PLANS.enterprise.name),
    rejected.ok ? "DITERIMA" : rejected.reason,
  );
}
check(
  "prioritas jalur cepat diterima saat fiturnya hidup",
  DEDICATED_PRIORITIES.every(
    (priority) =>
      validateTicketInput(
        { subject: "Struk tidak keluar", category: "bug", priority, body: "cukup panjang isinya" },
        { dedicated: true },
      ).ok === true,
  ),
  "DITERIMA — prioritas tinggi malah ditolak",
);
check(
  "prioritas Rendah & Normal boleh tanpa fiturnya",
  ["low", "normal"].every(
    (priority) =>
      validateTicketInput(
        { subject: "Struk tidak keluar", category: "bug", priority, body: "cukup panjang isinya" },
        { dedicated: false },
      ).ok === true,
  ),
  "DITERIMA — jalur biasa ikut terkunci",
);
check(
  "batas tiket berjalan ditegakkan",
  validateTicketInput(
    { subject: "Struk tidak keluar", category: "bug", priority: "normal", body: "cukup panjang isinya" },
    { dedicated: true, openCount: MAX_OPEN_TICKETS },
  ).ok === false,
  "DITERIMA — tiket berjalan tak terbatas",
);
check(
  "daftar kategori & prioritas tidak punya duplikat",
  new Set(SUPPORT_CATEGORY_KEYS).size === SUPPORT_CATEGORY_KEYS.length &&
    new Set(SUPPORT_PRIORITY_KEYS).size === SUPPORT_PRIORITY_KEYS.length,
  JSON.stringify({ categories: SUPPORT_CATEGORY_KEYS, priorities: SUPPORT_PRIORITY_KEYS }),
);
check(
  "catatan & keterangan penyelesaian punya batas yang berbeda",
  validateNote("ab").ok === false &&
    validateNote("sudah dicoba").ok === true &&
    validateResolution("ok").ok === false &&
    validateResolution("kartu diganti").ok === true,
  "DITERIMA — batas catatan/penyelesaian bocor",
);
check(
  "nomor tiket berurut dan berpadding",
  ticketNumber(7, 2026) === "TKT-2026-0007" &&
    ticketNumber(1234, 2026) === "TKT-2026-1234" &&
    ticketNumber(0, 2026) === "TKT-2026-0001",
  [ticketNumber(7, 2026), ticketNumber(1234, 2026), ticketNumber(0, 2026)].join(", "),
);

// ------------------------------------------------------------------ transisi
{
  const started = act(ticket(), "start");
  check(
    "tiket baru bisa mulai ditangani",
    started.ok && started.value.status === "in_progress" && started.value.kind === "status",
    JSON.stringify(started),
  );
}
check(
  "tiket yang sudah ditangani tidak bisa dimulai dua kali",
  act(ticket({ status: "in_progress" }), "start").ok === false,
  "DITERIMA — mulai dua kali",
);
check(
  "tiket selesai tidak bisa dimulai lagi (harus dibuka ulang)",
  act(ticket({ status: "resolved", resolvedAt: NOW - HOUR_MS }), "start").ok === false,
  "DITERIMA — tiket selesai bisa dimulai",
);
check(
  "menutup tiket mewajibkan keterangan penyelesaian",
  act(ticket({ status: "in_progress" }), "resolve").ok === false &&
    act(ticket({ status: "in_progress" }), "resolve", { note: "ok" }).ok === false,
  "DITERIMA — tiket bisa ditutup tanpa keterangan",
);
{
  const closed = act(ticket({ status: "in_progress" }), "resolve", {
    note: "Kabel printer diganti, sudah diuji 5 transaksi.",
  });
  check(
    "menutup tiket menyimpan waktu selesai & keterangannya",
    closed.ok &&
      closed.value.status === "resolved" &&
      closed.value.resolvedAt === NOW &&
      closed.value.note === "Kabel printer diganti, sudah diuji 5 transaksi.",
    JSON.stringify(closed),
  );
}
check(
  "tiket yang sudah selesai tidak bisa ditutup lagi",
  act(ticket({ status: "resolved", resolvedAt: NOW }), "resolve", { note: "selesai lagi" }).ok ===
    false,
  "DITERIMA — tutup dua kali",
);
check(
  "buka ulang hanya untuk tiket yang sudah selesai",
  act(ticket({ status: "resolved", resolvedAt: NOW }), "reopen", { note: "masih bermasalah" }).ok ===
    true &&
    act(ticket({ status: "open" }), "reopen").ok === false &&
    act(ticket({ status: "in_progress" }), "reopen").ok === false,
  "DITERIMA — buka ulang dari status yang salah",
);
{
  const reopened = act(ticket({ status: "resolved", resolvedAt: NOW - HOUR_MS }), "reopen");
  check(
    "buka ulang mengembalikan tiket ke antrean",
    reopened.ok && reopened.value.status === "open" && reopened.value.resolvedAt === null,
    JSON.stringify(reopened),
  );
}
check(
  "eskalasi hanya sekali dan tidak untuk tiket yang sudah selesai",
  act(ticket({ status: "in_progress" }), "escalate").ok === true &&
    act(ticket({ status: "in_progress", escalated: true }), "escalate").ok === false &&
    act(ticket({ status: "resolved", resolvedAt: NOW }), "escalate").ok === false,
  "DITERIMA — eskalasi bisa diulang atau dari tiket selesai",
);
check(
  "catatan tidak mengubah status, termasuk pada tiket selesai",
  (() => {
    const resolvedTicket = ticket({ status: "resolved", resolvedAt: NOW - HOUR_MS });
    const noted = act(resolvedTicket, "note", { note: "Terima kasih, sudah jalan." });
    return (
      noted.ok &&
      noted.value.status === "resolved" &&
      noted.value.resolvedAt === resolvedTicket.resolvedAt &&
      noted.value.kind === "note"
    );
  })(),
  "DITERIMA — catatan menulis ulang status",
);
check(
  "riwayat yang sudah penuh menolak semua aksi (termasuk catatan)",
  act(ticket({ logCount: MAX_TICKET_LOG }), "note", { note: "catatan terakhir" }).ok === false &&
    act(ticket({ logCount: MAX_TICKET_LOG }), "resolve", { note: "selesai sekalian" }).ok ===
      false,
  "DITERIMA — riwayat penuh masih bisa ditulis",
);
check(
  "penolakan riwayat penuh menyebut nomor tiketnya",
  (() => {
    const rejected = act(ticket({ logCount: MAX_TICKET_LOG }), "note", { note: "catatan" });
    return rejected.ok === false && rejected.reason.includes("TKT-2026-0001");
  })(),
  "DITERIMA — pesan tidak menyebut tiket",
);
check(
  "isi riwayat memakai catatan pengguna apa adanya",
  logBodyFor("note", {
    status: "open",
    resolvedAt: null,
    escalated: false,
    note: "Sudah dicoba ulang.",
    kind: "note",
  }) === "Sudah dicoba ulang.",
  "DITERIMA — catatan tidak dipakai",
);
check(
  "aksi tanpa catatan tetap meninggalkan kalimat yang bisa dibaca",
  ["start", "reopen", "escalate"].every((action) => {
    const body = logBodyFor(action, {
      status: "open",
      resolvedAt: null,
      escalated: false,
      note: null,
      kind: "status",
    });
    return body.trim().length > 5 && body.endsWith(".");
  }),
  JSON.stringify(
    ["start", "reopen", "escalate"].map((action) =>
      logBodyFor(action, {
        status: "open",
        resolvedAt: null,
        escalated: false,
        note: null,
        kind: "status",
      }),
    ),
  ),
);

// ----------------------------------------------------------------------- SLA
check(
  "tenggat dihitung dari janji yang dipatok saat tiket dibuat",
  dueAt(ticket({ createdAt: NOW, slaHours: 8 })) === NOW + 8 * HOUR_MS,
  String(dueAt(ticket({ createdAt: NOW, slaHours: 8 }))),
);
check(
  "tiket yang masih jauh dari tenggat berstatus dalam jadwal",
  slaState(ticket({ createdAt: NOW - HOUR_MS, slaHours: 24 }), NOW) === "on_track",
  slaState(ticket({ createdAt: NOW - HOUR_MS, slaHours: 24 }), NOW),
);
check(
  "tiket yang tenggatnya tinggal seperempat jendela berstatus segera jatuh tempo",
  slaState(ticket({ createdAt: NOW - 23 * HOUR_MS, slaHours: 24 }), NOW) === "due_soon" &&
    slaState(ticket({ createdAt: NOW - 7 * HOUR_MS, slaHours: 8 }), NOW) === "due_soon",
  JSON.stringify([
    slaState(ticket({ createdAt: NOW - 23 * HOUR_MS, slaHours: 24 }), NOW),
    slaState(ticket({ createdAt: NOW - 7 * HOUR_MS, slaHours: 8 }), NOW),
  ]),
);
check(
  "tiket yang lewat tenggat berstatus lewat janji",
  slaState(ticket({ createdAt: NOW - 25 * HOUR_MS, slaHours: 24 }), NOW) === "overdue",
  slaState(ticket({ createdAt: NOW - 25 * HOUR_MS, slaHours: 24 }), NOW),
);
check(
  "ambang “segera” selalu lebih pendek dari jendela janjinya",
  [1, 2, 4, 8, 16, 24, 48].every((hours) => dueSoonWindowMs(hours) < hours * HOUR_MS),
  JSON.stringify([1, 2, 8, 24].map((hours) => [hours, dueSoonWindowMs(hours) / HOUR_MS])),
);
check(
  "ambang “segera” dijaga antara 30 menit dan 2 jam",
  dueSoonWindowMs(2) === 30 * 60 * 1000 &&
    dueSoonWindowMs(8) === 2 * HOUR_MS &&
    dueSoonWindowMs(48) === 2 * HOUR_MS,
  JSON.stringify([2, 8, 48].map((hours) => dueSoonWindowMs(hours) / 60000)),
);
check(
  // Regresi: versi pertama aturan ini membuat tiket baru berjanji 2 jam
  // langsung berstatus “segera jatuh tempo” pada detik pembuatannya.
  "tiket yang baru dibuat tidak langsung dianggap hampir jatuh tempo",
  slaState(ticket({ createdAt: NOW, slaHours: 2 }), NOW) === "on_track" &&
    slaState(ticket({ createdAt: NOW, slaHours: 8 }), NOW) === "on_track",
  JSON.stringify([
    slaState(ticket({ createdAt: NOW, slaHours: 2 }), NOW),
    slaState(ticket({ createdAt: NOW, slaHours: 8 }), NOW),
  ]),
);
check(
  "tiket yang selesai tepat waktu berstatus tepat waktu",
  slaState(
    ticket({ status: "resolved", createdAt: NOW - 10 * HOUR_MS, slaHours: 24, resolvedAt: NOW - HOUR_MS }),
    NOW,
  ) === "met",
  "DITERIMA — selesai dalam janji disebut lewat",
);
check(
  "tiket yang selesai setelah tenggat berstatus lewat janji saat ditutup",
  slaState(
    ticket({ status: "resolved", createdAt: NOW - 40 * HOUR_MS, slaHours: 24, resolvedAt: NOW - HOUR_MS }),
    NOW,
  ) === "missed",
  "DITERIMA — keterlambatan hilang setelah ditutup",
);
check(
  "sisa waktu jadi nol setelah tenggat lewat",
  remainingHours(ticket({ createdAt: NOW - 30 * HOUR_MS, slaHours: 8 }), NOW) === 0 &&
    remainingHours(ticket({ createdAt: NOW, slaHours: 8 }), NOW) === 8,
  String(remainingHours(ticket({ createdAt: NOW - 30 * HOUR_MS, slaHours: 8 }), NOW)),
);

// ------------------------------------------------------------------ ringkasan
{
  const tickets = [
    ticket({ number: "TKT-2026-0001", status: "open", createdAt: NOW - 25 * HOUR_MS, slaHours: 8 }),
    ticket({
      number: "TKT-2026-0002",
      status: "in_progress",
      escalated: true,
      createdAt: NOW - 7 * HOUR_MS,
      slaHours: 8,
    }),
    ticket({
      number: "TKT-2026-0003",
      status: "resolved",
      createdAt: NOW - 40 * HOUR_MS,
      slaHours: 8,
      resolvedAt: NOW - 30 * HOUR_MS,
    }),
  ];
  const summary = supportSummary(tickets, NOW);
  check(
    "ringkasan menghitung tiket per status & eskalasi",
    summary.open === 1 && summary.inProgress === 1 && summary.resolved === 1 && summary.escalated === 1,
    JSON.stringify(summary),
  );
  check(
    "ringkasan SLA hanya menghitung tiket yang masih berjalan",
    summary.overdue === 1 && summary.dueSoon === 1,
    JSON.stringify(summary),
  );
  check(
    // Tiket pertama sudah lewat tenggat 17 jam, tiket kedua tinggal 1 jam:
    // yang dilaporkan adalah tenggat **terawal** dari tiket yang belum selesai,
    // termasuk yang sudah lewat — itu justru tiket yang paling mendesak.
    "tenggat terdekat diambil dari tenggat terawal tiket yang belum selesai",
    summary.nextDueAt === NOW - 17 * HOUR_MS,
    String(summary.nextDueAt),
  );
  check(
    "tiket berjalan dihitung tanpa yang sudah selesai",
    openTicketCount(tickets) === 2,
    String(openTicketCount(tickets)),
  );
}
check(
  "ringkasan tanpa tiket berjalan tidak punya tenggat",
  supportSummary(
    [ticket({ status: "resolved", resolvedAt: NOW - HOUR_MS, createdAt: NOW - 10 * HOUR_MS })],
    NOW,
  ).nextDueAt === null,
  "DITERIMA — tenggat muncul dari tiket selesai",
);

// ---------------------------------------------------------- sinkronisasi kode
{
  const schema = readFileSync(new URL("../src/convex/schema.ts", import.meta.url), "utf8");
  check(
    "izin dukungan terdaftar di validator schema",
    schema.includes('v.literal("support.view")') && schema.includes('v.literal("support.manage")'),
    "izin baru tidak ada di permissionValidator",
  );
  check(
    "tabel tiket menyimpan janji tanggap & riwayatnya sendiri",
    schema.includes("supportTickets: defineTable") &&
      /supportTickets: defineTable\(\{[\s\S]*?slaHours: v\.number\(\)/.test(schema) &&
      /supportTickets: defineTable\(\{[\s\S]*?log: v\.array\(supportLogEntryValidator\)/.test(schema),
    "slaHours/log tidak tersimpan di baris tiket",
  );
  check(
    "fitur dukungan khusus ada di katalog & hanya paket Enterprise yang memuatnya",
    typeof FEATURE_LABELS["support.dedicated"] === "string" &&
      PLANS.enterprise.features.includes("support.dedicated") &&
      !PLANS.starter.features.includes("support.dedicated") &&
      !PLANS.professional.features.includes("support.dedicated"),
    JSON.stringify({
      label: FEATURE_LABELS["support.dedicated"],
      enterprise: PLANS.enterprise.features.includes("support.dedicated"),
    }),
  );
}

// ------------------------------------------- kanal keluar (event webhook)
// Dukungan khusus sebelumnya “tanpa kanal keluar”: tiket hanya hidup di dalam
// aplikasi. Bagian ini menjaga kabelnya ke `api.access` — event yang terdaftar,
// isi kiriman yang murni, dan pengingat terjadwal yang benar-benar dijadwalkan.
{
  const schema = readFileSync(
    new URL("../src/convex/schema.ts", import.meta.url),
    "utf8",
  );
  check(
    "peristiwa siklus tiket terdaftar di katalog webhook",
    ["created", "escalated", "resolved", "due"].every((action) =>
      WEBHOOK_EVENT_KEYS.includes(`support.${action}`),
    ) &&
      WEBHOOK_EVENTS.every((event) => /^[a-z]+\.[a-z]+$/.test(event.key)) &&
      new Set(WEBHOOK_EVENT_KEYS).size === WEBHOOK_EVENTS.length,
    JSON.stringify(WEBHOOK_EVENT_KEYS),
  );

  const created = supportTicketCreatedEventData({
    number: "TKT-2026-0007",
    subject: "Struk tidak keluar",
    category: "bug",
    priority: "urgent",
    slaHours: 2,
    planKey: "enterprise",
    dueAt: NOW + 2 * HOUR_MS,
  });
  check(
    "isi `support.created` memuat janji tanggap absolutnya",
    created.number === "TKT-2026-0007" &&
      created.priority === "urgent" &&
      created.slaHours === 2 &&
      created.planKey === "enterprise" &&
      created.dueAt === NOW + 2 * HOUR_MS,
    JSON.stringify(created),
  );
  check(
    "isi `support.escalated` menandai eskalasinya",
    supportTicketEscalatedEventData({
      number: "TKT-2026-0007",
      priority: "urgent",
      slaHours: 2,
    }).escalated === true,
    JSON.stringify(
      supportTicketEscalatedEventData({ number: "TKT-2026-0007", priority: "urgent", slaHours: 2 }),
    ),
  );
  check(
    "isi `support.resolved` menyebut janjinya terpenuhi atau tidak",
    supportTicketResolvedEventData({
      number: "TKT-2026-0007",
      slaHours: 2,
      slaState: "met",
    }).metSla === true &&
      supportTicketResolvedEventData({
        number: "TKT-2026-0007",
        slaHours: 2,
        slaState: "missed",
      }).metSla === false,
    "metSla tidak mengikuti slaState",
  );
  check(
    "isi `support.due` memuat sisa jam & penanda lewat",
    supportTicketDueEventData({
      number: "TKT-2026-0007",
      priority: "urgent",
      slaHours: 2,
      remainingHours: 0,
      overdue: true,
    }).overdue === true,
    "overdue tidak diteruskan ke isi kiriman",
  );

  // Pengingat hanya untuk tiket berjalan yang **belum** pernah diingatkan dan
  // sudah masuk jendela “segera jatuh tempo” atau terlewat.
  check(
    "pengingat menyalak saat janji tinggal seperempat jendela",
    needsSlaReminder(ticket({ slaHours: 24 }), NOW + 23 * HOUR_MS) === true &&
      needsSlaReminder(ticket({ slaHours: 24 }), NOW + HOUR_MS) === false,
    "ambang pengingat tidak mengikuti jendela tiket",
  );
  check(
    "pengingat menyalak untuk tiket yang sudah lewat janji",
    needsSlaReminder(ticket({ slaHours: 24 }), NOW + 25 * HOUR_MS) === true,
    "tiket lewat janji tidak diingatkan",
  );
  check(
    "pengingat tidak diulang & tidak berlaku untuk tiket selesai",
    needsSlaReminder(
      { ...ticket({ slaHours: 24 }), slaNotified: true },
      NOW + 25 * HOUR_MS,
    ) === false &&
      needsSlaReminder(
        ticket({ status: "resolved", resolvedAt: NOW + HOUR_MS }),
        NOW + 25 * HOUR_MS,
      ) === false,
    "pengingat berulang atau menyentuh tiket selesai",
  );

  check(
    "tiket menyimpan tenggat absolut + penanda pengingat, berindeks",
    /supportTickets: defineTable\(\{[\s\S]*?dueAt: v\.optional\(v\.number\(\)\)/.test(schema) &&
      /supportTickets: defineTable\(\{[\s\S]*?slaNotified: v\.optional\(v\.boolean\(\)\)/.test(schema) &&
      schema.includes('.index("by_sla", ["slaNotified", "dueAt"])'),
    "kolom/index pengingat tidak ada di schema",
  );

  const crons = readFileSync(new URL("../src/convex/crons.ts", import.meta.url), "utf8");
  check(
    "pengingat janji tanggap benar-benar dijadwalkan",
    crons.includes("internal.support.notifyDueTickets") &&
      crons.includes("internal.apiAccess.retryDueDeliveries"),
    "crons.ts tidak menjadwalkan pengingat dukungan",
  );
}

console.log(`${results.length}/${results.length} checks passed`);

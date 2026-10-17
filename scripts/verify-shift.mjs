/**
 * Uji aturan shift kas & pengingat tutup shift tanpa deployment.
 *
 * Kenapa ada: halaman Kasir dan halaman Shift & Kas memakai modul yang sama untuk
 * memutuskan kapan kasir diingatkan menutup shift — dan pemilik repo memang minta
 * pengingat “jangan lupa tutup shift sebelum hari berakhir / tutup toko”. Kalau
 * ambangnya (jam pengingat, shift lintas hari, shift berjalan lama) atau kalimatnya
 * salah, kasir baru tahu setelah uangnya tidak cocok.
 *
 * Modulnya diimpor dari `src/convex/lib/shift.ts` — implementasinya, bukan shim
 * `src/lib/shift.ts` — karena `bun` tidak mengenal alias `@/…` yang dipakai shim
 * itu; Vite (dan karena itu halaman) memakai berkas yang sama lewat shim tersebut.
 *
 * Usage: bun scripts/verify-shift.mjs
 */
import {
  DEFAULT_SHIFT_CLOSE_HOUR,
  DEFAULT_SHIFT_LONG_HOURS,
  DEFAULT_SHIFT_NOTIFY_OWNER,
  DEFAULT_SHIFT_OPEN_HOUR,
  DEFAULT_SHIFT_REMINDER_HOUR,
  DEFAULT_SHIFT_SETTING,
  EMPTY_SHIFT_STATE,
  SHIFT_LONG_HOURS_MAX,
  SHIFT_LONG_HOURS_MIN,
  SHIFT_REMINDER_HOUR_MAX,
  SHIFT_REMINDER_HOUR_MIN,
  SHIFT_STORAGE_KEY,
  SHIFT_TILL_GRACE_MINUTES,
  clampCloseHour,
  clampLongShiftHours,
  clampOpenHour,
  clampReminderHour,
  isShiftDayKey,
  parseShiftState,
  posShiftGate,
  sameShiftSetting,
  serializeShiftState,
  shiftClockLabel,
  shiftClockText,
  shiftDayKey,
  shiftDurationLabel,
  shiftHourLabel,
  shiftAlertDelivered,
  shiftAlertDeliveryText,
  shiftAlertEmailContent,
  shiftAlertOwnerRecipients,
  shiftAlertReportNotice,
  shiftLocalClock,
  shiftOpenedAt,
  shiftOperatingLabel,
  shiftOwnerAlert,
  shiftOwnerAlertHint,
  shiftReminder,
  shiftSettingHint,
  shiftSettingOf,
  shiftSettingSentence,
  shiftShopState,
  shiftWithinOperatingHours,
  validateShiftSetting,
} from "../src/convex/lib/shift.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const JAM = 3_600_000;

/** Waktu lokal (bukan UTC), karena “hari ini” dan “jam tutup” diputuskan di tempat kasir. */
const lokal = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();

function record(overrides = {}) {
  return {
    id: "shift-1",
    openedAt: new Date(lokal(2026, 10, 15, 8)).toISOString(),
    openingCash: 300000,
    cashSales: 1250000,
    totalSales: 1500000,
    saleCount: 24,
    closedAt: null,
    countedCash: null,
    expectedCash: null,
    variance: null,
    ...overrides,
  };
}

// ------------------------------------------------------------ kunci penyimpanan
check(
  "kunci penyimpanan tetap sama (data shift kasir lama tidak hilang)",
  SHIFT_STORAGE_KEY === "mesinpos.shifts.v1",
  SHIFT_STORAGE_KEY,
);

// ------------------------------------------------------------ baca yang tahan rusak
check(
  "tanpa isi apa pun, keadaannya “kas tertutup” (bukan undefined)",
  JSON.stringify(parseShiftState(null)) === JSON.stringify(EMPTY_SHIFT_STATE) &&
    JSON.stringify(parseShiftState(undefined)) === JSON.stringify(EMPTY_SHIFT_STATE) &&
    parseShiftState("").current === null,
  JSON.stringify(parseShiftState(null)),
);
check(
  "JSON rusak tidak membuat kasir melihat “buka NaN”",
  parseShiftState("{bukan json").current === null &&
    parseShiftState("[]").current === null &&
    parseShiftState("\"shift\"").current === null,
  JSON.stringify(parseShiftState("{bukan json")),
);
check(
  "shift tanpa waktu buka dibuang (tidak bisa dipakai menghitung apa pun)",
  parseShiftState(JSON.stringify({ current: { id: "x" } })).current === null,
  JSON.stringify(parseShiftState(JSON.stringify({ current: { id: "x" } }))),
);
check(
  "shift yang sah dibaca apa adanya",
  parseShiftState(JSON.stringify({ current: record(), history: [] })).current?.openingCash === 300000,
  JSON.stringify(parseShiftState(JSON.stringify({ current: record(), history: [] }))),
);
check(
  "angka yang hilang/bukan angka tidak menjadi NaN di layar kasir",
  (() => {
    const rusak = parseShiftState(
      JSON.stringify({
        current: { id: "x", openedAt: record().openedAt, openingCash: "300000" },
        history: [{ id: "y", openedAt: record().openedAt, countedCash: null }],
      }),
    );
    return (
      rusak.current?.openingCash === 0 &&
      rusak.current?.countedCash === null &&
      rusak.history.length === 1 &&
      Number.isFinite(rusak.history[0].cashSales)
    );
  })(),
  JSON.stringify(parseShiftState(JSON.stringify({ current: { id: "x", openedAt: "x", openingCash: "300000" } }))),
);
check(
  "riwayat yang bukan daftar tidak menjatuhkan halaman",
  parseShiftState(JSON.stringify({ current: record(), history: "kemarin" })).history.length === 0,
  JSON.stringify(parseShiftState(JSON.stringify({ current: record(), history: "kemarin" }))),
);
check(
  "tulis → baca kembali menghasilkan data yang sama",
  (() => {
    const state = {
      current: record(),
      history: [record({ id: "shift-0", closedAt: record().openedAt, countedCash: 300000 })],
    };
    const kembali = parseShiftState(serializeShiftState(state));
    return kembali.current?.id === "shift-1" && kembali.history[0]?.id === "shift-0";
  })(),
);

// ------------------------------------------------------------ label waktu & lama
check(
  "waktu buka hari ini ditulis jam-menit (nol di depan, tanpa locale perangkat)",
  shiftClockLabel(lokal(2026, 10, 15, 8), lokal(2026, 10, 15, 14)) === "08:00" &&
    shiftClockLabel(lokal(2026, 10, 15, 21, 10), lokal(2026, 10, 15, 22)) === "21:10",
  shiftClockLabel(lokal(2026, 10, 15, 21, 10), lokal(2026, 10, 15, 22)),
);
check(
  "shift hari kemarin disebut “kemarin”, bukan tanggal yang harus diterjemahkan kasir",
  shiftClockLabel(lokal(2026, 10, 14, 21, 10), lokal(2026, 10, 15, 7)) === "kemarin 21:10",
  shiftClockLabel(lokal(2026, 10, 14, 21, 10), lokal(2026, 10, 15, 7)),
);
check(
  "hari yang lebih jauh ditulis tanggal + bulan singkat Indonesia",
  shiftClockLabel(lokal(2026, 10, 12, 8), lokal(2026, 10, 15, 7)) === "12 Okt 08:00",
  shiftClockLabel(lokal(2026, 10, 12, 8), lokal(2026, 10, 15, 7)),
);
check(
  "waktu buka yang tidak bisa dibaca tidak menghasilkan “NaN:NaN”",
  shiftClockLabel("bukan tanggal", lokal(2026, 10, 15, 8)) === "—" &&
    !Number.isFinite(shiftOpenedAt({ openedAt: "bukan tanggal" })),
  shiftClockLabel("bukan tanggal", lokal(2026, 10, 15, 8)),
);
check(
  "lama shift dibaca dalam jam & menit",
  shiftDurationLabel(9 * JAM + 20 * 60_000) === "9 jam 20 menit" &&
    shiftDurationLabel(45 * 60_000) === "45 menit" &&
    shiftDurationLabel(30_000) === "kurang dari 1 menit",
  `${shiftDurationLabel(9 * JAM + 20 * 60_000)} · ${shiftDurationLabel(45 * 60_000)}`,
);
check(
  "shift lintas hari diringkas jadi hari + jam",
  shiftDurationLabel(27 * JAM) === "1 hari 3 jam",
  shiftDurationLabel(27 * JAM),
);

// ------------------------------------------------------------ kapan pengingatnya muncul
check(
  "siang hari dengan shift baru: kasir tidak diganggu",
  shiftReminder({ openedAt: lokal(2026, 10, 15, 8), now: lokal(2026, 10, 15, 14) }) === null,
  JSON.stringify(shiftReminder({ openedAt: lokal(2026, 10, 15, 8), now: lokal(2026, 10, 15, 14) })),
);
check(
  "tepat sebelum jam tutup masih tenang, satu menit sesudahnya sudah diingatkan",
  shiftReminder({ openedAt: lokal(2026, 10, 15, 8),    now: lokal(2026, 10, 15, DEFAULT_SHIFT_REMINDER_HOUR - 1, 59) }) === null &&
    shiftReminder({ openedAt: lokal(2026, 10, 15, 8), now: lokal(2026, 10, 15, DEFAULT_SHIFT_REMINDER_HOUR) })?.reason ===
      "closing-hour",
  JSON.stringify(
    shiftReminder({ openedAt: lokal(2026, 10, 15, 8), now: lokal(2026, 10, 15, DEFAULT_SHIFT_REMINDER_HOUR) }),
  ),
);
check(
  "pengingat jam tutup: level ringan, kalimatnya menyebut “tutup shift” & akibatnya",
  (() => {
    const pesan = shiftReminder({ openedAt: lokal(2026, 10, 15, 8), now: lokal(2026, 10, 15, 21, 30) });
    return (
      pesan?.level === "closing" &&
      pesan.title === "Jangan lupa tutup shift" &&
      pesan.message.includes("pukul 21:30") &&
      pesan.message.includes("tutup shift") &&
      pesan.message.includes("uang fisik") &&
      pesan.message.includes("Z-report") &&
      pesan.message.includes("toko tutup") &&
      pesan.cta === "Tutup shift"
    );
  })(),
  JSON.stringify(shiftReminder({ openedAt: lokal(2026, 10, 15, 8), now: lokal(2026, 10, 15, 21, 30) })),
);
check(
  "shift yang berjalan terlalu lama dinaikkan ke level keras",
  (() => {
    const pesan = shiftReminder({
      openedAt: lokal(2026, 10, 15, 6),
      now: lokal(2026, 10, 15, 6 + DEFAULT_SHIFT_LONG_HOURS),
    });
    return (
      pesan?.level === "late" &&
      pesan.reason === "long-shift" &&
      pesan.title.includes(`${DEFAULT_SHIFT_LONG_HOURS} jam`)
    );
  })(),
  JSON.stringify(
    shiftReminder({ openedAt: lokal(2026, 10, 15, 6), now: lokal(2026, 10, 15, 6 + DEFAULT_SHIFT_LONG_HOURS) }),
  ),
);
check(
  "shift yang dibuka kemarin dan belum ditutup: peringatan paling keras, jam bukanya disebut",
  (() => {
    const pesan = shiftReminder({ openedAt: lokal(2026, 10, 14, 21, 10), now: lokal(2026, 10, 15, 7) });
    return (
      pesan?.level === "late" &&
      pesan.reason === "cross-day" &&
      pesan.title === "Shift kemarin belum ditutup" &&
      pesan.message.includes("kemarin 21:10") &&
      pesan.message.includes("9 jam 50 menit") &&
      pesan.message.includes("uang fisik")
    );
  })(),
  JSON.stringify(shiftReminder({ openedAt: lokal(2026, 10, 14, 21, 10), now: lokal(2026, 10, 15, 7) })),
);
check(
  "shift yang dibuka lewat tengah malam dan masih wajar (8,5 jam) belum diingatkan",
  shiftReminder({ openedAt: lokal(2026, 10, 15, 0, 30), now: lokal(2026, 10, 15, 9) }) === null,
  JSON.stringify(shiftReminder({ openedAt: lokal(2026, 10, 15, 0, 30), now: lokal(2026, 10, 15, 9) })),
);
check(
  "shift yang melewati tengah malam dianggap lewat hari begitu pergantian hari lewat",
  shiftReminder({ openedAt: lokal(2026, 10, 14, 23, 30), now: lokal(2026, 10, 15, 1) })?.reason === "cross-day",
  JSON.stringify(shiftReminder({ openedAt: lokal(2026, 10, 14, 23, 30), now: lokal(2026, 10, 15, 1) })),
);
check(
  "waktu buka yang tidak masuk akal tidak menghasilkan pengingat",
  shiftReminder({ openedAt: Number.NaN, now: lokal(2026, 10, 15, 23) }) === null &&
    shiftReminder({ openedAt: 0, now: lokal(2026, 10, 15, 23) }) === null &&
    // Jam perangkat mundur: jangan menuduh kasir membuka shift “di masa depan”.
    shiftReminder({ openedAt: lokal(2026, 10, 15, 22), now: lokal(2026, 10, 15, 21) }) === null,
  JSON.stringify(shiftReminder({ openedAt: lokal(2026, 10, 15, 22), now: lokal(2026, 10, 15, 21) })),
);
check(
  "shift yang ditutup malam sebelumnya tidak lagi mengingatkan (keadaannya sudah bersih)",
  parseShiftState(
    serializeShiftState({
      current: null,
      history: [record({ closedAt: new Date(lokal(2026, 10, 15, 21, 45)).toISOString() })],
    }),
  ).current === null,
);

// ------------------------------------------------------- setelan workspace
check(
  "setelan bawaan sama dengan perilaku sebelum bisa diatur (aktif, 21:00, 14 jam)",
  DEFAULT_SHIFT_SETTING.active === true &&
    DEFAULT_SHIFT_SETTING.reminderHour === DEFAULT_SHIFT_REMINDER_HOUR &&
    DEFAULT_SHIFT_SETTING.longShiftHours === DEFAULT_SHIFT_LONG_HOURS &&
    DEFAULT_SHIFT_REMINDER_HOUR === 21 &&
    DEFAULT_SHIFT_LONG_HOURS === 14,
  JSON.stringify(DEFAULT_SHIFT_SETTING),
);
check(
  "workspace yang belum mengatur dibaca sebagai bawaan",
  JSON.stringify(shiftSettingOf(null)) === JSON.stringify(DEFAULT_SHIFT_SETTING) &&
    JSON.stringify(shiftSettingOf(undefined)) === JSON.stringify(DEFAULT_SHIFT_SETTING) &&
    JSON.stringify(shiftSettingOf({})) === JSON.stringify(DEFAULT_SHIFT_SETTING),
  JSON.stringify(shiftSettingOf({})),
);
check(
  "bidang yang rusak dikembalikan ke bawaannya, bukan membuat pengingat aneh",
  (() => {
    const dibaca = shiftSettingOf({ active: "ya", reminderHour: "21", longShiftHours: Number.NaN });
    return (
      dibaca.active === false &&
      dibaca.reminderHour === DEFAULT_SHIFT_REMINDER_HOUR &&
      dibaca.longShiftHours === DEFAULT_SHIFT_LONG_HOURS
    );
  })(),
  JSON.stringify(shiftSettingOf({ active: "ya", reminderHour: "21", longShiftHours: Number.NaN })),
);
check(
  "jam & ambang yang di luar batas dirapikan ke batasnya",
  clampReminderHour(-3) === SHIFT_REMINDER_HOUR_MIN &&
    clampReminderHour(99) === SHIFT_REMINDER_HOUR_MAX &&
    clampLongShiftHours(0) === SHIFT_LONG_HOURS_MIN &&
    clampLongShiftHours(1000) === SHIFT_LONG_HOURS_MAX,
  `${clampReminderHour(-3)} · ${clampReminderHour(99)} · ${clampLongShiftHours(0)} · ${clampLongShiftHours(1000)}`,
);
check(
  "jam ditulis dua digit (07:00, bukan 7:00) dan angka janggal dirapikan",
  shiftHourLabel(7) === "07:00" && shiftHourLabel(21) === "21:00" && shiftHourLabel("bukan angka") === "21:00",
  `${shiftHourLabel(7)} · ${shiftHourLabel("bukan angka")}`,
);
check(
  "setelan yang sah diterima apa adanya",
  (() => {
    const hasil = validateShiftSetting({
      active: false,
      reminderHour: 22,
      longShiftHours: 8,
      openHour: 9,
      closeHour: 21,
      notifyOwner: true,
    });
    return (
      hasil.ok === true &&
      hasil.value.active === false &&
      hasil.value.reminderHour === 22 &&
      hasil.value.longShiftHours === 8 &&
      hasil.value.openHour === 9 &&
      hasil.value.closeHour === 21 &&
      hasil.value.notifyOwner === true
    );
  })(),
  JSON.stringify(
    validateShiftSetting({
      active: false,
      reminderHour: 22,
      longShiftHours: 8,
      openHour: 9,
      closeHour: 21,
      notifyOwner: true,
    }),
  ),
);
check(
  "setelan janggal DITOLAK dengan alasan yang bisa dibaca (bukan diam-diam dirapikan)",
  (() => {
    const jam = validateShiftSetting({ active: true, reminderHour: 24, longShiftHours: 14 });
    const ambang = validateShiftSetting({ active: true, reminderHour: 21, longShiftHours: 0 });
    const kosong = validateShiftSetting({ active: true, reminderHour: Number.NaN, longShiftHours: 14 });
    const pecahan = validateShiftSetting({ active: true, reminderHour: 21.5, longShiftHours: 14 });
    const saklar = validateShiftSetting({ active: "aktif", reminderHour: 21, longShiftHours: 14 });
    return (
      jam.ok === false &&
      jam.reason.includes("0") &&
      ambang.ok === false &&
      ambang.reason.includes(`${SHIFT_LONG_HOURS_MIN}`) &&
      kosong.ok === false &&
      kosong.reason.includes("Jam pengingat") &&
      pecahan.ok === false &&
      saklar.ok === false
    );
  })(),
  JSON.stringify([
    validateShiftSetting({ active: true, reminderHour: 24, longShiftHours: 14 }),
    validateShiftSetting({ active: true, reminderHour: 21, longShiftHours: 0 }),
    validateShiftSetting({ active: "aktif", reminderHour: 21, longShiftHours: 14 }),
  ]),
);
check(
  "dua setelan dianggap sama hanya kalau seluruh bidangnya sama (termasuk jam operasional & saklar pemilik)",
  sameShiftSetting({ ...DEFAULT_SHIFT_SETTING }, { ...DEFAULT_SHIFT_SETTING }) === true &&
    sameShiftSetting({ ...DEFAULT_SHIFT_SETTING }, { ...DEFAULT_SHIFT_SETTING, reminderHour: 22 }) === false &&
    sameShiftSetting({ ...DEFAULT_SHIFT_SETTING }, { ...DEFAULT_SHIFT_SETTING, openHour: 7 }) === false &&
    sameShiftSetting({ ...DEFAULT_SHIFT_SETTING }, { ...DEFAULT_SHIFT_SETTING, closeHour: 21 }) === false &&
    sameShiftSetting({ ...DEFAULT_SHIFT_SETTING }, { ...DEFAULT_SHIFT_SETTING, notifyOwner: false }) === false,
  "perbandingan setelan",
);
check(
  "kalimat setelan menyebut jam, ambangnya, jam operasional & pemberitahuan pemilik — dan keadaan mati dibilang mati",
  (() => {
    const hidup = shiftSettingSentence({
      ...DEFAULT_SHIFT_SETTING,
      active: true,
      reminderHour: 22,
      longShiftHours: 8,
    });
    const matiKasir = shiftSettingSentence({ ...DEFAULT_SHIFT_SETTING, active: false });
    const matiPemilik = shiftSettingSentence({ ...DEFAULT_SHIFT_SETTING, notifyOwner: false });
    return (
      hidup.includes("22:00") &&
      hidup.includes("8 jam") &&
      hidup.includes("08:00–22:00") &&
      hidup.includes("Pemilik toko diberi tahu") &&
      matiKasir.includes("Pengingat tutup shift dimatikan") &&
      matiKasir.includes("Pemilik toko diberi tahu") &&
      matiPemilik.includes("Pemberitahuan ke pemilik toko dimatikan")
    );
  })(),
  shiftSettingSentence({ ...DEFAULT_SHIFT_SETTING, active: false }),
);
check(
  "petunjuk di halaman Pengaturan menyebut jam & ambangnya, dan menjelaskan saat mati",
  shiftSettingHint({ active: true, reminderHour: 7, longShiftHours: 3 }).includes("07:00") &&
    shiftSettingHint({ active: true, reminderHour: 7, longShiftHours: 3 }).includes("3 jam") &&
    shiftSettingHint({ active: false, reminderHour: 7, longShiftHours: 3 }).includes("tidak akan diberi tahu"),
  shiftSettingHint({ active: false, reminderHour: 7, longShiftHours: 3 }),
);

// ------------------------------------------------- pengingat menurut setelan
check(
  "jam pengingat dari setelan dipakai: 21:00 tenang kalau jamnya dimundurkan ke 23:00",
  // Ambangnya dinaikkan supaya yang diuji memang jalur “jam pengingat”, bukan
  // jalur “shift sudah terlalu lama” yang memang lebih dulu menang.
  shiftReminder({
    openedAt: lokal(2026, 10, 15, 8),
    now: lokal(2026, 10, 15, 21),
    setting: { active: true, reminderHour: 23, longShiftHours: 20 },
  }) === null &&
    shiftReminder({
      openedAt: lokal(2026, 10, 15, 8),
      now: lokal(2026, 10, 15, 23),
      setting: { active: true, reminderHour: 23, longShiftHours: 20 },
    })?.reason === "closing-hour",
  JSON.stringify(
    shiftReminder({
      openedAt: lokal(2026, 10, 15, 8),
      now: lokal(2026, 10, 15, 21),
      setting: { active: true, reminderHour: 23, longShiftHours: 20 },
    }),
  ),
);
check(
  "saklar mati berarti tidak ada pengingat sama sekali — walau shift kemarin belum ditutup",
  shiftReminder({
    openedAt: lokal(2026, 10, 14, 8),
    now: lokal(2026, 10, 15, 22),
    setting: { active: false, reminderHour: 21, longShiftHours: 14 },
  }) === null,
  JSON.stringify(
    shiftReminder({
      openedAt: lokal(2026, 10, 14, 8),
      now: lokal(2026, 10, 15, 22),
      setting: { active: false, reminderHour: 21, longShiftHours: 14 },
    }),
  ),
);
check(
  "ambang shift lama dari setelan dipakai: 2 jam sudah keras kalau ambangnya 2 jam",
  shiftReminder({
    openedAt: lokal(2026, 10, 15, 14),
    now: lokal(2026, 10, 15, 16),
    setting: { active: true, reminderHour: 21, longShiftHours: 2 },
  })?.reason === "long-shift" &&
    shiftReminder({
      openedAt: lokal(2026, 10, 15, 14),
      now: lokal(2026, 10, 15, 16),
      setting: { active: true, reminderHour: 21, longShiftHours: 14 },
    }) === null,
  JSON.stringify(
    shiftReminder({
      openedAt: lokal(2026, 10, 15, 14),
      now: lokal(2026, 10, 15, 16),
      setting: { active: true, reminderHour: 21, longShiftHours: 2 },
    }),
  ),
);
check(
  "aturan “shift kemarin” tidak bisa dimatikan angkanya — ia tetap yang paling keras",
  shiftReminder({
    openedAt: lokal(2026, 10, 14, 22),
    now: lokal(2026, 10, 15, 1),
    setting: { active: true, reminderHour: 23, longShiftHours: 24 },
  })?.reason === "cross-day",
  JSON.stringify(
    shiftReminder({
      openedAt: lokal(2026, 10, 14, 22),
      now: lokal(2026, 10, 15, 1),
      setting: { active: true, reminderHour: 23, longShiftHours: 24 },
    }),
  ),
);
check(
  "setelan yang cuma sebagian (mis. jam saja) tidak menghilangkan bawaannya",
  (() => {
    const pesan = shiftReminder({
      openedAt: lokal(2026, 10, 15, 16),
      now: lokal(2026, 10, 15, 22),
      setting: { reminderHour: 22 },
    });
    return pesan?.reason === "closing-hour" && pesan.level === "closing";
  })(),
  JSON.stringify(
    shiftReminder({
      openedAt: lokal(2026, 10, 15, 16),
      now: lokal(2026, 10, 15, 22),
      setting: { reminderHour: 22 },
    }),
  ),
);
// ------------------------------------------------------------- gerbang kasir
check(
  "kas yang belum pernah dibuka mengunci kasir, dan pesannya menyuruh membuka shift dulu",
  (() => {
    const gerbang = posShiftGate(null);
    return (
      gerbang.locked === true &&
      gerbang.title.includes("belum dibuka") &&
      gerbang.message.includes("Buka shift (kas) terlebih dahulu") &&
      gerbang.message.includes("kas awal") &&
      gerbang.message.includes("penjualan tidak bisa disimpan") &&
      gerbang.cta === "Buka shift sekarang" &&
      gerbang.hint.includes("terkunci")
    );
  })(),
  JSON.stringify(posShiftGate(null)),
);
check(
  "shift yang sedang terbuka membuka gerbangnya — walau dibuka kemarin",
  posShiftGate(record()).locked === false &&
    posShiftGate({ openedAt: new Date(lokal(2026, 10, 14, 8)).toISOString() }).locked === false,
  JSON.stringify([posShiftGate(record()), posShiftGate({ openedAt: new Date(lokal(2026, 10, 14, 8)).toISOString() })]),
);
check(
  "kas toko dari server (waktu buka milidetik) juga membuka gerbangnya",
  posShiftGate({ openedAt: lokal(2026, 10, 14, 8) }).locked === false &&
    posShiftGate({ openedAt: 0 }).locked === true &&
    posShiftGate({ openedAt: Number.NaN }).locked === true,
  JSON.stringify([
    posShiftGate({ openedAt: lokal(2026, 10, 14, 8) }),
    posShiftGate({ openedAt: 0 }),
    posShiftGate({ openedAt: Number.NaN }),
  ]),
);
check(
  "shift tanpa waktu buka yang bisa dibaca tetap mengunci (jamnya tidak bisa dipertanggungjawabkan)",
  posShiftGate({ openedAt: "bukan tanggal" }).locked === true &&
    posShiftGate({ openedAt: "" }).locked === true,
  JSON.stringify([
    posShiftGate({ openedAt: "bukan tanggal" }),
    posShiftGate({ openedAt: "" }),
  ]),
);
check(
  "gerbang yang terbuka tidak meninggalkan kalimat sisa untuk dibaca kasir",
  (() => {
    const gerbang = posShiftGate(record());
    return (
      gerbang.title === "" &&
      gerbang.message === "" &&
      gerbang.cta === "" &&
      gerbang.hint === ""
    );
  })(),
  JSON.stringify(posShiftGate(record())),
);

// ------------------------------------------- jam operasional & pemberitahuan pemilik
//
// Yang diuji di bawah ini bukan pengingat untuk kasir, melainkan **kabar ke pemilik
// toko**: kas yang belum dibuka padahal toko sudah buka, dan shift yang belum
// ditutup padahal toko sudah tutup (atau shiftnya terlalu lama / lintas hari).
// Semua keputusannya memakai jam **lokal perangkat** yang dilaporkan, jadi jamnya
// masuk sebagai argumen — bukan dibaca dari jam proses (server Convex berjalan di
// UTC, dan “sekarang jam 09:00” di sana bukan berarti tokonya sudah buka).

/** Jam lokal perangkat tiruan untuk satu hari uji. */
const clockUji = (hour, minute = 0, dayKey = "2026-10-16") => ({ hour, minute, dayKey });

check(
  "setelan bawaan punya jam operasional & pemberitahuan pemilik yang bisa diprediksi",
  DEFAULT_SHIFT_OPEN_HOUR === 8 &&
    DEFAULT_SHIFT_CLOSE_HOUR === 22 &&
    DEFAULT_SHIFT_NOTIFY_OWNER === true &&
    DEFAULT_SHIFT_SETTING.openHour === 8 &&
    DEFAULT_SHIFT_SETTING.closeHour === 22 &&
    DEFAULT_SHIFT_SETTING.notifyOwner === true &&
    SHIFT_TILL_GRACE_MINUTES === 30,
  JSON.stringify(DEFAULT_SHIFT_SETTING),
);
check(
  "setelan lama (tanpa jam operasional) dibaca sebagai bawaan 08:00–22:00 yang memberitahu pemilik",
  (() => {
    const dibaca = shiftSettingOf({ active: true, reminderHour: 21, longShiftHours: 14 });
    return dibaca.openHour === 8 && dibaca.closeHour === 22 && dibaca.notifyOwner === true;
  })(),
  JSON.stringify(shiftSettingOf({ active: true, reminderHour: 21, longShiftHours: 14 })),
);
check(
  "jam operasional yang di luar batas dirapikan, bukan diterima apa adanya",
  shiftSettingOf({ openHour: 99 }).openHour === 23 &&
    shiftSettingOf({ closeHour: -5 }).closeHour === 0 &&
    shiftSettingOf({ openHour: "08" }).openHour === 8 &&
    clampOpenHour(99) === 23 &&
    clampCloseHour("a") === DEFAULT_SHIFT_CLOSE_HOUR,
  JSON.stringify([shiftSettingOf({ openHour: 99 }), shiftSettingOf({ closeHour: -5 })]),
);
check(
  "saklar pemberitahuan pemilik hanya hidup kalau benar-benar `true`",
  shiftSettingOf({ notifyOwner: "ya" }).notifyOwner === false &&
    shiftSettingOf({ notifyOwner: true }).notifyOwner === true,
  JSON.stringify(shiftSettingOf({ notifyOwner: "ya" })),
);
check(
  "mengubah jam operasional atau saklar pemilik terdeteksi sebagai perubahan setelan",
  sameShiftSetting(
    { ...DEFAULT_SHIFT_SETTING, openHour: 9 },
    { ...DEFAULT_SHIFT_SETTING, openHour: 8 },
  ) === false &&
    sameShiftSetting(
      { ...DEFAULT_SHIFT_SETTING, notifyOwner: false },
      { ...DEFAULT_SHIFT_SETTING, notifyOwner: true },
    ) === false &&
    sameShiftSetting(DEFAULT_SHIFT_SETTING, { ...DEFAULT_SHIFT_SETTING }) === true,
  JSON.stringify(DEFAULT_SHIFT_SETTING),
);
check(
  "jam operasional janggal ditolak dengan alasan yang bisa dibaca pemilik toko",
  (() => {
    const dasar = { active: true, reminderHour: 21, longShiftHours: 14, notifyOwner: true };
    const buka24 = validateShiftSetting({ ...dasar, openHour: 24, closeHour: 22 });
    const tutupNegatif = validateShiftSetting({ ...dasar, openHour: 8, closeHour: -1 });
    const bukaPecahan = validateShiftSetting({ ...dasar, openHour: 8.5, closeHour: 22 });
    const saklarRusak = validateShiftSetting({ ...dasar, openHour: 8, closeHour: 22, notifyOwner: "ya" });
    return (
      buka24.ok === false &&
      buka24.reason.includes("Jam buka") &&
      tutupNegatif.ok === false &&
      tutupNegatif.reason.includes("Jam tutup") &&
      bukaPecahan.ok === false &&
      saklarRusak.ok === false &&
      saklarRusak.reason.includes("pemilik")
    );
  })(),
  JSON.stringify(
    validateShiftSetting({ active: true, reminderHour: 21, longShiftHours: 14, openHour: 24, closeHour: 22, notifyOwner: true }),
  ),
);
check(
  "setelan lengkap yang sah tersimpan utuh, termasuk jam operasional & saklar pemilik",
  (() => {
    const hasil = validateShiftSetting({
      active: false,
      reminderHour: 20,
      longShiftHours: 12,
      openHour: 9,
      closeHour: 2,
      notifyOwner: false,
    });
    return (
      hasil.ok === true &&
      hasil.value.openHour === 9 &&
      hasil.value.closeHour === 2 &&
      hasil.value.notifyOwner === false &&
      hasil.value.active === false
    );
  })(),
  JSON.stringify(
    validateShiftSetting({ active: false, reminderHour: 20, longShiftHours: 12, openHour: 9, closeHour: 2, notifyOwner: false }),
  ),
);

check(
  "setelan sebagian tetap diterima: bidang yang tidak dikirim dibaca sebagai bawaan, bukan ditolak",
  (() => {
    const hasil = validateShiftSetting({ active: true, reminderHour: 22, longShiftHours: 8 });
    return (
      hasil.ok === true &&
      hasil.value.openHour === DEFAULT_SHIFT_SETTING.openHour &&
      hasil.value.closeHour === DEFAULT_SHIFT_SETTING.closeHour &&
      hasil.value.notifyOwner === DEFAULT_SHIFT_SETTING.notifyOwner &&
      hasil.value.reminderHour === 22
    );
  })(),
  JSON.stringify(validateShiftSetting({ active: true, reminderHour: 22, longShiftHours: 8 })),
);

// ---- keadaan jam operasional
check(
  "toko 08:00–22:00: sebelum buka, sedang buka, dan setelah tutup dibedakan",
  shiftShopState({ openHour: 8, closeHour: 22 }, 7) === "before-open" &&
    shiftShopState({ openHour: 8, closeHour: 22 }, 8) === "open" &&
    shiftShopState({ openHour: 8, closeHour: 22 }, 21) === "open" &&
    shiftShopState({ openHour: 8, closeHour: 22 }, 22) === "after-close" &&
    shiftShopState({ openHour: 8, closeHour: 22 }, 23) === "after-close",
  JSON.stringify([7, 8, 21, 22, 23].map((h) => shiftShopState({ openHour: 8, closeHour: 22 }, h))),
);
check(
  "toko yang buka lintas malam (20:00 → 02:00): jam 01:00 masih buka, jam 12:00 sudah tutup",
  shiftShopState({ openHour: 20, closeHour: 2 }, 1) === "open" &&
    shiftShopState({ openHour: 20, closeHour: 2 }, 23) === "open" &&
    shiftShopState({ openHour: 20, closeHour: 2 }, 12) === "after-close" &&
    shiftWithinOperatingHours({ openHour: 20, closeHour: 2 }, 1) === true &&
    shiftWithinOperatingHours({ openHour: 20, closeHour: 2 }, 12) === false,
  JSON.stringify([1, 12, 23].map((h) => shiftShopState({ openHour: 20, closeHour: 2 }, h))),
);
check(
  "dua jam yang sama berarti buka 24 jam — bukan tutup sepanjang hari",
  shiftShopState({ openHour: 8, closeHour: 8 }, 3) === "always-open" &&
    shiftShopState({ openHour: 0, closeHour: 0 }, 23) === "always-open" &&
    shiftWithinOperatingHours({ openHour: 8, closeHour: 8 }, 3) === true,
  JSON.stringify([shiftShopState({ openHour: 8, closeHour: 8 }, 3), shiftShopState({ openHour: 0, closeHour: 0 }, 23)]),
);
check(
  "label jam operasional bisa dibaca, termasuk lintas malam & 24 jam",
  shiftOperatingLabel({ openHour: 8, closeHour: 22 }) === "08:00–22:00" &&
    shiftOperatingLabel({ openHour: 20, closeHour: 2 }) === "20:00–02:00 keesokan harinya" &&
    shiftOperatingLabel({ openHour: 9, closeHour: 9 }) === "buka 24 jam",
  JSON.stringify([
    shiftOperatingLabel({ openHour: 8, closeHour: 22 }),
    shiftOperatingLabel({ openHour: 20, closeHour: 2 }),
    shiftOperatingLabel({ openHour: 9, closeHour: 9 }),
  ]),
);

// ---- hari kalender lokal & jam yang dilaporkan
check(
  "hari kalender lokal bisa dibaca dari waktu buka maupun dari jam perangkat",
  shiftDayKey(lokal(2026, 10, 16, 0, 5)) === "2026-10-16" &&
    shiftDayKey(lokal(2026, 1, 2, 23, 59)) === "2026-01-02" &&
    shiftLocalClock(lokal(2026, 10, 16, 9, 5)).dayKey === "2026-10-16" &&
    shiftLocalClock(lokal(2026, 10, 16, 9, 5)).hour === 9 &&
    shiftLocalClock(lokal(2026, 10, 16, 9, 5)).minute === 5 &&
    shiftClockText(clockUji(9, 5)) === "09:05" &&
    shiftClockText(clockUji(0, 0)) === "00:00",
  JSON.stringify([shiftDayKey(lokal(2026, 10, 16, 0, 5)), shiftLocalClock(lokal(2026, 10, 16, 9, 5))]),
);
check(
  "bentuk hari kalender yang rusak ditolak, bukan diterima sebagai hari apa pun",
  isShiftDayKey("2026-10-16") === true &&
    isShiftDayKey("16-10-2026") === false &&
    isShiftDayKey("2026-13-01") === false &&
    isShiftDayKey("2026-10") === false &&
    isShiftDayKey(undefined) === false,
  JSON.stringify(["2026-10-16", "16-10-2026", "2026-13-01"].map((v) => isShiftDayKey(v))),
);

// ---- kas belum dibuka di jam operasional
check(
  "kas belum dibuka padahal toko sudah buka: pemilik diberi tahu (setelah jeda 30 menit)",
  (() => {
    const pesan = shiftOwnerAlert({
      current: null,
      setting: { openHour: 8, closeHour: 22 },
      clock: clockUji(9, 5),
      now: lokal(2026, 10, 16, 9, 5),
    });
    return (
      pesan?.kind === "till-closed" &&
      pesan.reason === "opening-grace" &&
      pesan.dayKey === "2026-10-16" &&
      pesan.title.includes("Kas belum dibuka") &&
      pesan.message.includes("08:00–22:00") &&
      pesan.message.includes("pemilik") &&
      pesan.message.toLowerCase().includes("pemilik toko")
    );
  })(),
  JSON.stringify(
    shiftOwnerAlert({ current: null, setting: { openHour: 8, closeHour: 22 }, clock: clockUji(9, 5), now: lokal(2026, 10, 16, 9, 5) }),
  ),
);
check(
  "setengah jam pertama setelah jam buka belum dikabarkan (kasirnya masih menghitung uang kembalian)",
  shiftOwnerAlert({ current: null, setting: { openHour: 8, closeHour: 22 }, clock: clockUji(8, 20), now: lokal(2026, 10, 16, 8, 20) }) === null &&
    shiftOwnerAlert({ current: null, setting: { openHour: 8, closeHour: 22 }, clock: clockUji(7, 59), now: lokal(2026, 10, 16, 7, 59) }) === null,
  JSON.stringify(
    shiftOwnerAlert({ current: null, setting: { openHour: 8, closeHour: 22 }, clock: clockUji(8, 20), now: lokal(2026, 10, 16, 8, 20) }),
  ),
);
check(
  "di luar jam operasional, “kas belum dibuka” tidak pernah dikabarkan",
  shiftOwnerAlert({ current: null, setting: { openHour: 8, closeHour: 22 }, clock: clockUji(23, 0), now: lokal(2026, 10, 16, 23) }) === null &&
    shiftOwnerAlert({ current: null, setting: { openHour: 8, closeHour: 22 }, clock: clockUji(5, 0), now: lokal(2026, 10, 16, 5) }) === null,
  JSON.stringify(
    shiftOwnerAlert({ current: null, setting: { openHour: 8, closeHour: 22 }, clock: clockUji(23, 0), now: lokal(2026, 10, 16, 23) }),
  ),
);
check(
  "toko lintas malam juga dikabari di menit ke-300 setelah buka (01:00 untuk buka 20:00)",
  shiftOwnerAlert({
    current: null,
    setting: { openHour: 20, closeHour: 2 },
    clock: clockUji(1, 0),
    now: lokal(2026, 10, 17, 1, 0),
  })?.kind === "till-closed",
  JSON.stringify(
    shiftOwnerAlert({ current: null, setting: { openHour: 20, closeHour: 2 }, clock: clockUji(1, 0), now: lokal(2026, 10, 17, 1, 0) }),
  ),
);
check(
  "toko yang buka 24 jam tidak pernah dikabari soal kas yang “belum dibuka”",
  shiftOwnerAlert({ current: null, setting: { openHour: 8, closeHour: 8 }, clock: clockUji(9, 0), now: lokal(2026, 10, 16, 9) }) === null &&
    shiftOwnerAlert({ current: null, setting: { openHour: 0, closeHour: 0 }, clock: clockUji(3, 0), now: lokal(2026, 10, 16, 3) }) === null,
  JSON.stringify(
    shiftOwnerAlert({ current: null, setting: { openHour: 8, closeHour: 8 }, clock: clockUji(9, 0), now: lokal(2026, 10, 16, 9) }),
  ),
);

// ---- shift belum ditutup
check(
  "shift kemarin yang belum ditutup dikabarkan ke pemilik toko (paling keras)",
  (() => {
    const pesan = shiftOwnerAlert({
      current: { openedAt: new Date(lokal(2026, 10, 15, 20)).toISOString() },
      setting: { openHour: 8, closeHour: 22 },
      clock: clockUji(9, 0),
      now: lokal(2026, 10, 16, 9, 0),
    });
    return (
      pesan?.kind === "shift-open" &&
      pesan.reason === "cross-day" &&
      pesan.message.includes("Z-report") &&
      pesan.message.includes("kemarin 20:00") &&
      pesan.dayKey === "2026-10-16"
    );
  })(),
  JSON.stringify(
    shiftOwnerAlert({
      current: { openedAt: new Date(lokal(2026, 10, 15, 20)).toISOString() },
      setting: { openHour: 8, closeHour: 22 },
      clock: clockUji(9, 0),
      now: lokal(2026, 10, 16, 9, 0),
    }),
  ),
);
check(
  "toko sudah tutup tetapi shift masih terbuka: dikabarkan dengan alasan after-close",
  (() => {
    const pesan = shiftOwnerAlert({
      current: { openedAt: new Date(lokal(2026, 10, 16, 8)).toISOString() },
      setting: { openHour: 8, closeHour: 22 },
      clock: clockUji(23, 0),
      now: lokal(2026, 10, 16, 23, 0),
    });
    return (
      pesan?.kind === "shift-open" &&
      pesan.reason === "after-close" &&
      pesan.title.includes("Toko sudah tutup") &&
      pesan.message.includes("uang fisik")
    );
  })(),
  JSON.stringify(
    shiftOwnerAlert({
      current: { openedAt: new Date(lokal(2026, 10, 16, 8)).toISOString() },
      setting: { openHour: 8, closeHour: 22 },
      clock: clockUji(23, 0),
      now: lokal(2026, 10, 16, 23, 0),
    }),
  ),
);
check(
  "shift yang sudah berjalan lebih lama dari ambangnya dikabarkan walau tokonya masih buka",
  shiftOwnerAlert({
    current: { openedAt: new Date(lokal(2026, 10, 16, 6)).toISOString() },
    setting: { openHour: 8, closeHour: 22, longShiftHours: 14 },
    clock: clockUji(21, 0),
    now: lokal(2026, 10, 16, 21, 0),
  })?.reason === "long-shift" &&
    shiftOwnerAlert({
      current: { openedAt: new Date(lokal(2026, 10, 16, 10)).toISOString() },
      setting: { openHour: 8, closeHour: 22, longShiftHours: 14 },
      clock: clockUji(12, 0),
      now: lokal(2026, 10, 16, 12, 0),
    }) === null,
  JSON.stringify(
    shiftOwnerAlert({
      current: { openedAt: new Date(lokal(2026, 10, 16, 6)).toISOString() },
      setting: { openHour: 8, closeHour: 22, longShiftHours: 14 },
      clock: clockUji(21, 0),
      now: lokal(2026, 10, 16, 21, 0),
    }),
  ),
);
check(
  "saklar pemberitahuan pemilik yang mati mematikan kedua kabar — tanpa menyentuh pengingat kasir",
  shiftOwnerAlert({
    current: { openedAt: new Date(lokal(2026, 10, 15, 20)).toISOString() },
    setting: { openHour: 8, closeHour: 22, notifyOwner: false },
    clock: clockUji(9, 0),
    now: lokal(2026, 10, 16, 9, 0),
  }) === null &&
    shiftOwnerAlert({
      current: null,
      setting: { openHour: 8, closeHour: 22, notifyOwner: false },
      clock: clockUji(9, 30),
      now: lokal(2026, 10, 16, 9, 30),
    }) === null &&
    shiftOwnerAlert({
      current: null,
      setting: { active: false, reminderHour: 21, longShiftHours: 14, openHour: 8, closeHour: 22 },
      clock: clockUji(9, 30),
      now: lokal(2026, 10, 16, 9, 30),
    })?.kind === "till-closed",
  JSON.stringify(
    shiftOwnerAlert({
      current: null,
      setting: { openHour: 8, closeHour: 22, notifyOwner: false },
      clock: clockUji(9, 30),
      now: lokal(2026, 10, 16, 9, 30),
    }),
  ),
);
check(
  "laporan dengan hari yang tidak terbaca tidak dipakai untuk mengabari siapa pun",
  shiftOwnerAlert({
    current: null,
    setting: { openHour: 8, closeHour: 22 },
    clock: { hour: 9, minute: 30, dayKey: "16-10-2026" },
    now: lokal(2026, 10, 16, 9, 30),
  }) === null &&
    shiftOwnerAlert({
      current: null,
      setting: { openHour: 8, closeHour: 22 },
      clock: { hour: 9, minute: 30, dayKey: "" },
      now: lokal(2026, 10, 16, 9, 30),
    }) === null,
  "(hari rusak)",
);
check(
  "waktu buka yang tidak bisa dibaca diperlakukan sebagai kas yang belum dibuka — bukan sebagai shift terbuka",
  shiftOwnerAlert({
    current: { openedAt: "bukan tanggal" },
    setting: { openHour: 8, closeHour: 22 },
    clock: clockUji(9, 30),
    now: lokal(2026, 10, 16, 9, 30),
  })?.kind === "till-closed",
  JSON.stringify(
    shiftOwnerAlert({
      current: { openedAt: "bukan tanggal" },
      setting: { openHour: 8, closeHour: 22 },
      clock: clockUji(9, 30),
      now: lokal(2026, 10, 16, 9, 30),
    }),
  ),
);
check(
  "kalimat petunjuk halaman Pengaturan menyebut kapan pemilik dikabari — dan menyebutnya saat dimatikan",
  (() => {
    const hidup = shiftOwnerAlertHint({ ...DEFAULT_SHIFT_SETTING, openHour: 9, closeHour: 21 });
    const mati = shiftOwnerAlertHint({ ...DEFAULT_SHIFT_SETTING, notifyOwner: false });
    return (
      hidup.includes("09:00–21:00") &&
      hidup.includes("30 menit") &&
      hidup.includes("shift.alert") &&
      mati.includes("dimatikan")
    );
  })(),
  shiftOwnerAlertHint(DEFAULT_SHIFT_SETTING),
);
check(
  "kalimat setelan menyebut jam operasional & pemberitahuan pemilik, bukan cuma pengingat kasir",
  shiftSettingSentence({ ...DEFAULT_SHIFT_SETTING, openHour: 9, closeHour: 21 }).includes("09:00–21:00") &&
    shiftSettingSentence({ ...DEFAULT_SHIFT_SETTING, openHour: 9, closeHour: 21 }).includes("Pemilik toko diberi tahu") &&
    shiftSettingSentence({ ...DEFAULT_SHIFT_SETTING, notifyOwner: false }).includes("dimatikan") &&
    shiftSettingHint({ ...DEFAULT_SHIFT_SETTING, notifyOwner: false }).includes("dimatikan"),
  shiftSettingSentence(DEFAULT_SHIFT_SETTING),
);

// -------------------------------------- kanal email pemilik toko (jalur kabar)
//
// Kabar ke pemilik toko pergi lewat **email**, bukan cuma lewat langganan
// webhook: yang berlangganan cuma workspace yang memasang endpointnya sendiri,
// sedangkan yang dituju kabar ini pemilik toko — hampir selalu tanpa endpoint.
// Yang diuji di sini aturan murninya: siapa penerimanya, apa isi emailnya, dan
// kalimat “apa yang benar-benar terjadi” yang dibaca halaman Shift & Kas.

check(
  "penerima email pemilik = pemilik tenant + anggota berperan owner (kembar & nonaktif dibuang)",
  (() => {
    const penerima = shiftAlertOwnerRecipients({
      ownerEmail: " Pemilik@Toko.id ",
      members: [
        { email: "pemilik@toko.id", role: "owner", active: true },
        { email: "manajer@toko.id", role: "manager", active: true },
        { email: "istri@toko.id", role: "owner", active: true },
        { email: "mantan@toko.id", role: "owner", active: false },
      ],
    });
    return (
      penerima.all.join(",") === "istri@toko.id,pemilik@toko.id" &&
      penerima.deliverable.length === 2 &&
      penerima.testOnly === false
    );
  })(),
  JSON.stringify(
    shiftAlertOwnerRecipients({
      ownerEmail: " Pemilik@Toko.id ",
      members: [
        { email: "pemilik@toko.id", role: "owner", active: true },
        { email: "manajer@toko.id", role: "manager", active: true },
        { email: "istri@toko.id", role: "owner", active: true },
        { email: "mantan@toko.id", role: "owner", active: false },
      ],
    }),
  ),
);
check(
  "alamat uji `.test` tidak dihitung sebagai penerima yang bisa dikirimi email",
  (() => {
    const uji = shiftAlertOwnerRecipients({
      ownerEmail: "pemilik@mesinpos.test",
      members: [{ email: "budi@tokoku.test", role: "owner" }],
    });
    const kosong = shiftAlertOwnerRecipients({ ownerEmail: "", members: [] });
    return uji.testOnly === true && uji.deliverable.length === 0 && kosong.all.length === 0;
  })(),
  JSON.stringify(
    shiftAlertOwnerRecipients({ ownerEmail: "pemilik@mesinpos.test", members: [] }),
  ),
);
check(
  "isi email menyebut judul, pesannya, workspace, jam operasional, hari & jam lokal perangkat",
  (() => {
    const email = shiftAlertEmailContent({
      workspace: "Toko Uji",
      title: "Kas belum dibuka padahal toko sudah buka",
      message: "Jam operasional 08:00–22:00 sudah berjalan, tetapi belum ada shift yang dibuka.",
      day: "2026-10-16",
      localClock: "09:05",
      operatingHours: "08:00–22:00",
      shiftUrl: "https://mesinpos.test/app/shift",
    });
    return (
      email.subject.includes("Kas belum dibuka") &&
      email.subject.includes("Toko Uji") &&
      email.text.includes("belum ada shift yang dibuka") &&
      email.text.includes("08:00–22:00") &&
      email.text.includes("2026-10-16 pukul 09:05") &&
      email.text.includes("https://mesinpos.test/app/shift")
    );
  })(),
  shiftAlertEmailContent({
    workspace: "Toko Uji",
    title: "Kas belum dibuka padahal toko sudah buka",
    message: "Jam operasional 08:00–22:00 sudah berjalan.",
    day: "2026-10-16",
    localClock: "09:05",
    operatingHours: "08:00–22:00",
  }).text,
);
check(
  "tanpa SITE_URL emailnya tidak mengarang alamat, cuma menyebut tempat menanganinya",
  (() => {
    const email = shiftAlertEmailContent({
      workspace: "Toko Uji",
      title: "Kas belum dibuka",
      message: "Belum ada shift yang dibuka.",
      day: "2026-10-16",
      localClock: "09:05",
      operatingHours: "08:00–22:00",
      shiftUrl: null,
    });
    return (
      email.text.includes("halaman Shift & Kas di aplikasi MesinPOS") &&
      !email.text.includes("http")
    );
  })(),
  shiftAlertEmailContent({
    workspace: "Toko Uji",
    title: "Kas belum dibuka",
    message: "Belum ada shift yang dibuka.",
    day: "2026-10-16",
    localClock: "09:05",
    operatingHours: "08:00–22:00",
    shiftUrl: null,
  }).text,
);
check(
  "balikan ke kasir: email dijadwalkan ke alamat pemilik, dan keadaan webhook disebut apa adanya",
  (() => {
    const penerima = shiftAlertOwnerRecipients({ ownerEmail: "pemilik@toko.id" });
    const ada = shiftAlertReportNotice({
      title: "Kas belum dibuka padahal toko sudah buka",
      recipients: penerima,
      emailChannel: { kind: "resend" },
      notifiedEndpoints: 1,
    });
    const tanpaWebhook = shiftAlertReportNotice({
      title: "Kas belum dibuka padahal toko sudah buka",
      recipients: penerima,
      emailChannel: { kind: "resend" },
      notifiedEndpoints: 0,
    });
    return (
      ada.includes("dijadwalkan ke pemilik toko") &&
      ada.includes("pemilik@toko.id") &&
      ada.includes("1 endpoint webhook") &&
      tanpaWebhook.includes("Belum ada endpoint webhook")
    );
  })(),
  shiftAlertReportNotice({
    title: "Kas belum dibuka padahal toko sudah buka",
    recipients: shiftAlertOwnerRecipients({ ownerEmail: "pemilik@toko.id" }),
    emailChannel: { kind: "resend" },
    notifiedEndpoints: 0,
  }),
);
check(
  "kanal email yang belum dikonfigurasi, alamat uji, dan workspace tanpa alamat masing-masing dibedakan",
  (() => {
    const penerima = shiftAlertOwnerRecipients({ ownerEmail: "pemilik@toko.id" });
    const belum = shiftAlertReportNotice({
      title: "Kas belum dibuka",
      recipients: penerima,
      emailChannel: {
        kind: "unconfigured",
        reason: "Pengiriman email belum dikonfigurasi di server (RESEND_API_KEY belum diset).",
      },
      notifiedEndpoints: 0,
    });
    const uji = shiftAlertReportNotice({
      title: "Kas belum dibuka",
      recipients: shiftAlertOwnerRecipients({ ownerEmail: "pemilik@mesinpos.test" }),
      emailChannel: { kind: "resend" },
      notifiedEndpoints: 0,
    });
    const kosong = shiftAlertReportNotice({
      title: "Kas belum dibuka",
      recipients: shiftAlertOwnerRecipients({ ownerEmail: "" }),
      emailChannel: { kind: "resend" },
      notifiedEndpoints: 0,
    });
    return (
      belum.includes("RESEND_API_KEY") &&
      belum.includes("belum menerima kabarnya") &&
      uji.includes("alamat uji") &&
      kosong.includes("belum punya alamat email pemilik")
    );
  })(),
  shiftAlertReportNotice({
    title: "Kas belum dibuka",
    recipients: shiftAlertOwnerRecipients({ ownerEmail: "pemilik@mesinpos.test" }),
    emailChannel: { kind: "resend" },
    notifiedEndpoints: 0,
  }),
);
check(
  "kalimat riwayat di kartu: email terkirim / gagal / alamat uji / sedang dikirim / mode demo",
  (() => {
    const dasar = { emailRecipients: ["pemilik@toko.id"], notifiedEndpoints: 0 };
    const terkirim = shiftAlertDeliveryText({
      ...dasar,
      emailVia: "resend",
      emailDeliveredAt: 1_770_000_000_000,
    });
    const gagal = shiftAlertDeliveryText({
      ...dasar,
      emailError: "Resend membalas 422: domain belum terverifikasi",
    });
    const uji = shiftAlertDeliveryText({ ...dasar, emailRecipients: ["pemilik@mesinpos.test"], emailVia: "uji" });
    const jalan = shiftAlertDeliveryText(dasar);
    const demo = shiftAlertDeliveryText({ emailRecipients: [], emailVia: "demo", notifiedEndpoints: 0 });
    return (
      terkirim.includes("Email terkirim ke pemilik toko (pemilik@toko.id)") &&
      gagal.includes("gagal") &&
      gagal.includes("422") &&
      uji.includes("alamat uji") &&
      jalan.includes("sedang dikirim") &&
      demo.includes("Mode demo") &&
      terkirim.includes("Belum ada endpoint webhook")
    );
  })(),
  shiftAlertDeliveryText({ emailRecipients: [], emailVia: "demo", notifiedEndpoints: 0 }),
);
check(
  "“sudah sampai ke pemilik” hanya benar kalau emailnya berangkat atau webhooknya menerima",
  shiftAlertDelivered({ emailRecipients: ["a@b.id"], emailVia: "resend", emailDeliveredAt: 1 }) === true &&
    shiftAlertDelivered({ emailRecipients: ["a@b.id"], notifiedEndpoints: 2 }) === true &&
    shiftAlertDelivered({ emailRecipients: [], emailVia: "demo", notifiedEndpoints: 0 }) === false &&
    shiftAlertDelivered({ emailRecipients: ["a@b.id"], emailVia: "uji", notifiedEndpoints: 0 }) === false,
  JSON.stringify([
    shiftAlertDelivered({ emailRecipients: [], emailVia: "demo", notifiedEndpoints: 0 }),
    shiftAlertDelivered({ emailRecipients: ["a@b.id"], emailVia: "uji", notifiedEndpoints: 0 }),
  ]),
);

console.log(`${results.length}/${results.length} checks passed`);

/**
 * Aturan shift kas & pengingat tutup shift.
 *
 * Kenapa ada: kas yang masih terbuka padahal hari sudah berakhir cuma ketahuan
 * besok pagi — saat selisih uangnya sudah bercampur dengan penjualan hari
 * berikutnya. Aturan **kapan** kasir diingatkan hidup di sini, di satu tempat,
 * karena tiga pihak harus menjawab hal yang sama: halaman Kasir (banner di atas
 * katalog produk), halaman Shift & Kas (kartu pengingat di tempat kasir
 * menutupnya), dan server (menyimpan setelannya di `tenants.shift`).
 *
 * Setelannya **bisa diubah pemilik toko** dari halaman Pengaturan
 * (`tenants.updateShift`): jam pengingatnya (bawaan 21:00), ambang “shift sudah
 * terlalu lama” (bawaan 14 jam), **jam operasional toko** (bawaan 08:00–22:00),
 * dan dua saklar — pengingat kasir serta **pemberitahuan ke pemilik toko**.
 * Karena itu modul ini juga memuat pembaca setelan yang tahan nilai rusak
 * (`shiftSettingOf`), pemeriksa yang menolak nilai janggal sebelum tersimpan
 * (`validateShiftSetting`), dan kalimat siap-baca untuk lencana di halaman
 * Pengaturan (`shiftSettingSentence`).
 *
 * Ambangnya sendiri sederhana dan bisa diprediksi kasir:
 *
 *   - **jam pengingat** (`setting.reminderHour`) — waktu lokal perangkat kasir;
 *     setelah lewat, kasir diingatkan menutup shift sebelum pulang;
 *   - **shift terlalu lama** (`setting.longShiftHours`) — shift yang sudah
 *     berjalan selama itu pasti melewati satu pergantian jam kerja dan uang
 *     fisiknya belum dicocokkan seharian;
 *   - **shift yang dibuka hari sebelumnya** dinaikkan ke level paling keras:
 *     selisih kasnya sudah menumpuk ke hari berikutnya. Ini tidak diatur angka
 *     — “hari” di sini artinya hari kalender, bukan jumlah jam.
 *
 * Dua hal terakhir adalah **pemberitahuan ke pemilik toko** (`shiftOwnerAlert`),
 * bukan lagi ke kasir yang sedang berdiri di depan kasnya: kas yang belum dibuka
 * padahal toko sudah buka, dan shift yang belum ditutup padahal toko sudah tutup
 * (atau masih terbuka sejak hari sebelumnya). Pemilik yang memutuskan kapan toko
 * buka & tutup, jadi jam operasionalnya (`openHour`/`closeHour`) ikut di setelan
 * yang sama; `closeHour <= openHour` berarti toko buka **lintas malam**, dan dua
 * jam yang sama berarti buka 24 jam (tidak punya “jam buka”, jadi tidak pernah
 * diingatkan soal kas yang belum dibuka). Saklar `notifyOwner` memisahkan
 * pemberitahuan ini dari pengingat kasir (`active`): kafe 24 jam boleh mematikan
 * pengingat tutup shift tanpa ikut mematikan kabar “kas belum dibuka” ke pemilik.
 *
 * Semua keputusan memakai kalender **lokal** perangkat (bukan UTC), karena yang
 * dibicarakan adalah “hari ini” dan “tutup toko” di tempat kasir berdiri. Karena
 * itu aturan pemberitahuan menerima **jam lokal perangkat** sebagai argumen
 * (`ShiftLocalClock`), bukan membaca jam proses: server Convex berjalan di UTC,
 * dan “sekarang jam 09:00” di sana bukan berarti tokonya sudah buka. Shift di
 * aplikasi ini hidup di perangkat (`mesinpos.shifts.v1`); setelannya hidup di
 * workspace supaya seluruh kasir memakai jam yang sama.
 */

/*
  Kanal email pemilik toko memakai aturan email yang sama dengan jalur masuk & kirim
  undangan (`isTestEmail`/`normalizeEmail`) dan tipe saluran yang sama
  (`resolveEmailTransport`) supaya tidak ada dua kebenaran tentang alamat mana yang
  tidak boleh dikirimi email. Modul itu murni, jadi aman dipakai halaman juga.
*/
import { isTestEmail, normalizeEmail, type EmailTransport } from "./otp";

/** Kunci penyimpanan shift per perangkat (dipakai halaman Kasir & Shift). */
export const SHIFT_STORAGE_KEY = "mesinpos.shifts.v1";

/**
 * Bentuk data shift di perangkat, sejajar dengan model shift di
 * `src/convex/pos.ts`: uang yang seharusnya ada = kas awal + penjualan tunai, dan
 * selisihnya adalah uang yang dihitung kasir dikurangi angka itu.
 */
export interface ShiftRecord {
  id: string;
  openedAt: string;
  openingCash: number;
  cashSales: number;
  totalSales: number;
  saleCount: number;
  closedAt: string | null;
  countedCash: number | null;
  expectedCash: number | null;
  variance: number | null;
}

export interface ShiftState {
  current: ShiftRecord | null;
  history: ShiftRecord[];
}

export const EMPTY_SHIFT_STATE: ShiftState = { current: null, history: [] };

/** Jam pengingat bawaan (waktu lokal perangkat) — 21:00. */
export const DEFAULT_SHIFT_REMINDER_HOUR = 21;

/** Ambang bawaan “shift sudah terlalu lama”, dalam jam. */
export const DEFAULT_SHIFT_LONG_HOURS = 14;

/** Jam operasional bawaan: toko buka pukul 08:00 (waktu lokal perangkat). */
export const DEFAULT_SHIFT_OPEN_HOUR = 8;

/** Jam operasional bawaan: toko tutup pukul 22:00. */
export const DEFAULT_SHIFT_CLOSE_HOUR = 22;

/** Bawaan pemberitahuan ke pemilik toko: hidup. */
export const DEFAULT_SHIFT_NOTIFY_OWNER = true;

/** Batas jam operasional yang bisa dipilih: 00:00 sampai 23:00. */
export const SHIFT_OPERATING_HOUR_MIN = 0;
export const SHIFT_OPERATING_HOUR_MAX = 23;

/**
 * Toleransi setelah jam buka sebelum pemilik toko diberi tahu bahwa kasnya belum
 * dibuka, dalam menit.
 *
 * Tanpa jeda ini, pemberitahuannya datang tepat saat toko membuka pintu — saat
 * kasirnya masih meletakkan tas dan belum sempat menghitung uang kembalian.
 * Setengah jam cukup untuk itu, tetapi masih jauh sebelum pembeli pertama
 * biasanya menuntut dilayani.
 */
export const SHIFT_TILL_GRACE_MINUTES = 30;

/** Batas jam pengingat yang bisa dipilih: 00:00 sampai 23:00. */
export const SHIFT_REMINDER_HOUR_MIN = 0;
export const SHIFT_REMINDER_HOUR_MAX = 23;

/**
 * Batas ambang shift lama: 1 jam (lebih kecil dari itu hanya berisik) sampai
 * 24 jam (lebih lama dari itu sudah lintas hari, dan aturan lintas hari yang
 * mengambil alih).
 */
export const SHIFT_LONG_HOURS_MIN = 1;
export const SHIFT_LONG_HOURS_MAX = 24;

/**
 * Setelan pengingat tutup shift milik workspace (`tenants.shift`).
 *
 * `active: false` mematikannya sama sekali — dipakai kafe/toko yang memang tidak
 * pernah “tutup” dalam sehari, supaya pengingatnya tidak jadi kebisingan yang
 * akhirnya diabaikan kasir.
 */
export interface ShiftSetting {
  active: boolean;
  /** Jam pengingat (0..23), waktu lokal perangkat kasir. */
  reminderHour: number;
  /** Shift yang sudah berjalan selama ini (jam) dianggap harus segera ditutup. */
  longShiftHours: number;
  /** Jam operasional mulai (0..23) — acuan “kas belum dibuka”. */
  openHour: number;
  /**
   * Jam operasional selesai (0..23). Lebih kecil dari `openHour` = toko buka
   * **lintas malam** (mis. 20 → 02); sama dengan `openHour` = buka 24 jam.
   */
  closeHour: number;
  /** Saklar pemberitahuan ke **pemilik toko** (terpisah dari `active`). */
  notifyOwner: boolean;
}

/** Setelan bawaan — sama dengan perilaku sebelum setelannya bisa diatur. */
export const DEFAULT_SHIFT_SETTING: ShiftSetting = {
  active: true,
  reminderHour: DEFAULT_SHIFT_REMINDER_HOUR,
  longShiftHours: DEFAULT_SHIFT_LONG_HOURS,
  openHour: DEFAULT_SHIFT_OPEN_HOUR,
  closeHour: DEFAULT_SHIFT_CLOSE_HOUR,
  notifyOwner: DEFAULT_SHIFT_NOTIFY_OWNER,
};

/**
 * `late`   — shift sudah lewat batas (lintas hari atau sudah sangat lama);
 * `closing` — pengingat jam tutup, belum ada yang salah.
 */
export type ShiftReminderLevel = "late" | "closing";

export type ShiftReminderReason = "cross-day" | "long-shift" | "closing-hour";

export interface ShiftReminder {
  level: ShiftReminderLevel;
  reason: ShiftReminderReason;
  title: string;
  message: string;
  cta: string;
}

const NAMA_HARI_SINGKAT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

const JAM_MS = 3_600_000;
const HARI_MS = 24 * JAM_MS;

function angka(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function angkaAtauNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Satu baris shift yang sah: punya id dan waktu buka; sisanya dirapikan. */
function normalizeShiftRecord(value: unknown): ShiftRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ShiftRecord>;
  if (typeof record.id !== "string" || typeof record.openedAt !== "string") return null;
  if (!record.id || !record.openedAt) return null;
  return {
    id: record.id,
    openedAt: record.openedAt,
    openingCash: angka(record.openingCash),
    cashSales: angka(record.cashSales),
    totalSales: angka(record.totalSales),
    saleCount: angka(record.saleCount),
    closedAt: typeof record.closedAt === "string" ? record.closedAt : null,
    countedCash: angkaAtauNull(record.countedCash),
    expectedCash: angkaAtauNull(record.expectedCash),
    variance: angkaAtauNull(record.variance),
  };
}

/**
 * Baca isi `localStorage` menjadi state shift. Nilai yang rusak (JSON tidak sah,
 * shift tanpa `openedAt`, isian dari versi lama) **dibuang**, bukan dipercaya:
 * kalau dipaksakan, halaman Kasir akan menampilkan “buka NaN” atau pengingat yang
 * tidak masuk akal.
 */
export function parseShiftState(raw: string | null | undefined): ShiftState {
  if (!raw) return EMPTY_SHIFT_STATE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_SHIFT_STATE;
  }
  if (!parsed || typeof parsed !== "object") return EMPTY_SHIFT_STATE;
  const value = parsed as Partial<ShiftState>;
  const history = Array.isArray(value.history)
    ? value.history.map(normalizeShiftRecord).filter((row): row is ShiftRecord => row !== null)
    : [];
  return { current: normalizeShiftRecord(value.current), history };
}

export function serializeShiftState(state: ShiftState): string {
  return JSON.stringify({ current: state.current, history: state.history });
}

/** Waktu buka shift dalam milidetik; `NaN` kalau tidak bisa dibaca. */
export function shiftOpenedAt(record: Pick<ShiftRecord, "openedAt">): number {
  return Date.parse(record.openedAt);
}

/**
 * Bentuk paling kecil dari sebuah shift terbuka: kapan ia dibuka. Dipakai aturan
 * pemberitahuan ke pemilik toko, karena lapornya bisa datang dari dua sisi —
 * perangkat mengirim waktu ISO (`ShiftRecord.openedAt`), sedangkan laporan yang
 * sudah tersimpan di server membawa milidetik. Aturannya sama, jadi bentuknya
 * tidak boleh memaksa salah satu sisi menebak.
 */
export interface ShiftOpenedLike {
  openedAt: string | number;
}

/** Waktu buka dari `ShiftOpenedLike`, dalam milidetik (`NaN` kalau tak terbaca). */
export function shiftOpenedMs(shift: ShiftOpenedLike): number {
  return typeof shift.openedAt === "number" ? shift.openedAt : Date.parse(shift.openedAt);
}

function jamLokal(at: Date): string {
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/** `21` → `21:00`; jam di luar 0..23 dirapikan dulu. */
export function shiftHourLabel(hour: unknown): string {
  return `${String(clampReminderHour(hour)).padStart(2, "0")}:00`;
}

/** Selisih hari kalender lokal antara dua waktu (bukan selisih 24 jam). */
function selisihHari(at: Date, sekarang: Date): number {
  const satu = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const dua = new Date(
    sekarang.getFullYear(),
    sekarang.getMonth(),
    sekarang.getDate(),
  ).getTime();
  return Math.round((dua - satu) / HARI_MS);
}

/**
 * Label waktu buka yang bisa dibaca kasir: `08:00` hari ini, `kemarin 21:10`, atau
 * `12 Okt 08:00` untuk hari yang lebih jauh. Dirakit sendiri (bukan `toLocaleString`)
 * supaya hasilnya sama di semua perangkat — dan bisa diuji.
 */
export function shiftClockLabel(value: string | number, now: number = Date.now()): string {
  const waktu = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(waktu)) return "—";
  const at = new Date(waktu);
  const sekarang = new Date(now);
  const selisih = selisihHari(at, sekarang);
  if (selisih <= 0) return jamLokal(at);
  if (selisih === 1) return `kemarin ${jamLokal(at)}`;
  return `${at.getDate()} ${NAMA_HARI_SINGKAT[at.getMonth()]} ${jamLokal(at)}`;
}

/** Lama shift berjalan, mis. `9 jam 20 menit` atau `1 hari 3 jam`. */
export function shiftDurationLabel(ms: number): string {
  const totalMenit = Math.max(0, Math.floor(ms / 60_000));
  const hari = Math.floor(totalMenit / 1440);
  const jam = Math.floor((totalMenit % 1440) / 60);
  const menit = totalMenit % 60;
  const bagian: string[] = [];
  if (hari > 0) bagian.push(`${hari} hari`);
  if (jam > 0) bagian.push(`${jam} jam`);
  // Menit tidak lagi penting begitu shiftnya sudah lintas hari.
  if (menit > 0 && hari === 0) bagian.push(`${menit} menit`);
  return bagian.length > 0 ? bagian.join(" ") : "kurang dari 1 menit";
}

// ------------------------------------------------------------- setelan workspace

/** Jam pengingat dirapikan ke bilangan bulat 0..23. */
export function clampReminderHour(value: unknown): number {
  const raw = typeof value === "string" ? Number(value) : value;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_SHIFT_REMINDER_HOUR;
  return Math.min(SHIFT_REMINDER_HOUR_MAX, Math.max(SHIFT_REMINDER_HOUR_MIN, Math.round(raw)));
}

/** Ambang shift lama dirapikan ke bilangan bulat 1..24 jam. */
export function clampLongShiftHours(value: unknown): number {
  const raw = typeof value === "string" ? Number(value) : value;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_SHIFT_LONG_HOURS;
  return Math.min(SHIFT_LONG_HOURS_MAX, Math.max(SHIFT_LONG_HOURS_MIN, Math.round(raw)));
}

/** Jam operasional dirapikan ke bilangan bulat 0..23; rusak → bawaan bidangnya. */
export function clampOperatingHour(value: unknown, fallback: number): number {
  const raw = typeof value === "string" ? Number(value) : value;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(SHIFT_OPERATING_HOUR_MAX, Math.max(SHIFT_OPERATING_HOUR_MIN, Math.round(raw)));
}

export function clampOpenHour(value: unknown): number {
  return clampOperatingHour(value, DEFAULT_SHIFT_OPEN_HOUR);
}

export function clampCloseHour(value: unknown): number {
  return clampOperatingHour(value, DEFAULT_SHIFT_CLOSE_HOUR);
}

/**
 * Membaca setelan pengingat dari baris tenant/sesi. Setelan yang belum pernah
 * diatur, atau bidang yang rusak, kembali ke bawaannya — **tidak** menggagalkan
 * pembacaan: pengingat yang salah baca lebih buruk daripada pengingat bawaan.
 *
 * Jam operasional ikut di sini karena pemberitahuan ke pemilik (“kas belum
 * dibuka”, “shift belum ditutup”) memakai setelan yang sama dengan pengingat
 * kasir — satu baris tenant, bukan dua tempat yang bisa berbeda pendapat.
 */
export function shiftSettingOf(source: Partial<ShiftSetting> | null | undefined): ShiftSetting {
  if (!source || typeof source !== "object") return { ...DEFAULT_SHIFT_SETTING };
  return {
    active: source.active === undefined ? DEFAULT_SHIFT_SETTING.active : source.active === true,
    reminderHour:
      source.reminderHour === undefined
        ? DEFAULT_SHIFT_SETTING.reminderHour
        : clampReminderHour(source.reminderHour),
    longShiftHours:
      source.longShiftHours === undefined
        ? DEFAULT_SHIFT_SETTING.longShiftHours
        : clampLongShiftHours(source.longShiftHours),
    openHour:
      source.openHour === undefined
        ? DEFAULT_SHIFT_SETTING.openHour
        : clampOpenHour(source.openHour),
    closeHour:
      source.closeHour === undefined
        ? DEFAULT_SHIFT_SETTING.closeHour
        : clampCloseHour(source.closeHour),
    notifyOwner:
      source.notifyOwner === undefined
        ? DEFAULT_SHIFT_SETTING.notifyOwner
        : source.notifyOwner === true,
  };
}

export function sameShiftSetting(a: ShiftSetting, b: ShiftSetting): boolean {
  return (
    a.active === b.active &&
    a.reminderHour === b.reminderHour &&
    a.longShiftHours === b.longShiftHours &&
    a.openHour === b.openHour &&
    a.closeHour === b.closeHour &&
    a.notifyOwner === b.notifyOwner
  );
}

/**
 * Memeriksa setelan sebelum disimpan: nilai janggal **ditolak** dengan alasan yang
 * bisa dibaca pemilik toko, bukan diam-diam dirapikan. Halaman Pengaturan tetap
 * memakai `shiftSettingOf` untuk menggambar, jadi tidak ada layar yang menampilkan
 * setelan yang tidak mungkin tersimpan.
 */
export function validateShiftSetting(
  input: Partial<ShiftSetting> | null | undefined,
): { ok: true; value: ShiftSetting } | { ok: false; reason: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, reason: "Setelan pengingat tutup shift tidak terbaca." };
  }

  /*
    Bidang yang **tidak dikirim** dibaca sebagai bawaan, bukan sebagai kesalahan:
    baris tenant lama memang dibaca begitu (`shiftSettingOf`), dan setelan ini
    disimpan sebagai satu baris utuh — jadi pemanggil yang hanya mengubah jam
    pengingatnya tidak perlu mengirim ulang jam operasionalnya. Yang diperiksa
    ketat hanya bidang yang benar-benar dikirim: nilai janggal **ditolak**
    beralasan, bukan dirapikan diam-diam.
  */
  const nilai: ShiftSetting = {
    active: input.active ?? DEFAULT_SHIFT_SETTING.active,
    reminderHour: input.reminderHour ?? DEFAULT_SHIFT_SETTING.reminderHour,
    longShiftHours: input.longShiftHours ?? DEFAULT_SHIFT_SETTING.longShiftHours,
    openHour: input.openHour ?? DEFAULT_SHIFT_SETTING.openHour,
    closeHour: input.closeHour ?? DEFAULT_SHIFT_SETTING.closeHour,
    notifyOwner: input.notifyOwner ?? DEFAULT_SHIFT_SETTING.notifyOwner,
  };

  const jam = nilai.reminderHour;
  if (typeof jam !== "number" || !Number.isInteger(jam)) {
    return { ok: false, reason: "Jam pengingat harus bilangan bulat 0–23." };
  }
  if (jam < SHIFT_REMINDER_HOUR_MIN || jam > SHIFT_REMINDER_HOUR_MAX) {
    return {
      ok: false,
      reason: `Jam pengingat harus antara ${shiftHourLabel(SHIFT_REMINDER_HOUR_MIN)} dan ${shiftHourLabel(SHIFT_REMINDER_HOUR_MAX)}.`,
    };
  }

  const ambang = nilai.longShiftHours;
  if (typeof ambang !== "number" || !Number.isInteger(ambang)) {
    return {
      ok: false,
      reason: `Ambang shift lama harus bilangan bulat ${SHIFT_LONG_HOURS_MIN}–${SHIFT_LONG_HOURS_MAX} jam.`,
    };
  }
  if (ambang < SHIFT_LONG_HOURS_MIN || ambang > SHIFT_LONG_HOURS_MAX) {
    return {
      ok: false,
      reason: `Ambang shift lama harus antara ${SHIFT_LONG_HOURS_MIN} dan ${SHIFT_LONG_HOURS_MAX} jam.`,
    };
  }

  if (nilai.active !== true && nilai.active !== false) {
    return { ok: false, reason: "Saklar pengingat tutup shift harus hidup atau mati." };
  }

  const buka = nilai.openHour;
  if (typeof buka !== "number" || !Number.isInteger(buka)) {
    return {
      ok: false,
      reason: `Jam buka toko harus bilangan bulat ${SHIFT_OPERATING_HOUR_MIN}–${SHIFT_OPERATING_HOUR_MAX}.`,
    };
  }
  if (buka < SHIFT_OPERATING_HOUR_MIN || buka > SHIFT_OPERATING_HOUR_MAX) {
    return {
      ok: false,
      reason: `Jam buka toko harus antara ${shiftHourLabel(SHIFT_OPERATING_HOUR_MIN)} dan ${shiftHourLabel(SHIFT_OPERATING_HOUR_MAX)}.`,
    };
  }

  const tutup = nilai.closeHour;
  if (typeof tutup !== "number" || !Number.isInteger(tutup)) {
    return {
      ok: false,
      reason: `Jam tutup toko harus bilangan bulat ${SHIFT_OPERATING_HOUR_MIN}–${SHIFT_OPERATING_HOUR_MAX}.`,
    };
  }
  if (tutup < SHIFT_OPERATING_HOUR_MIN || tutup > SHIFT_OPERATING_HOUR_MAX) {
    return {
      ok: false,
      reason: `Jam tutup toko harus antara ${shiftHourLabel(SHIFT_OPERATING_HOUR_MIN)} dan ${shiftHourLabel(SHIFT_OPERATING_HOUR_MAX)}.`,
    };
  }

  if (nilai.notifyOwner !== true && nilai.notifyOwner !== false) {
    return { ok: false, reason: "Saklar pemberitahuan ke pemilik toko harus hidup atau mati." };
  }

  return {
    ok: true,
    value: {
      active: nilai.active,
      reminderHour: jam,
      longShiftHours: ambang,
      openHour: buka,
      closeHour: tutup,
      notifyOwner: nilai.notifyOwner,
    },
  };
}

/** Kalimat siap-baca untuk lencana & notis di halaman Pengaturan. */
export function shiftSettingSentence(setting: ShiftSetting): string {
  const pengingat = setting.active
    ? `Kasir diingatkan menutup shift mulai pukul ${shiftHourLabel(setting.reminderHour)}` +
      `, dan shift yang sudah berjalan ${setting.longShiftHours} jam atau dibuka hari sebelumnya ` +
      `diberi peringatan keras.`
    : "Pengingat tutup shift dimatikan: kasir tidak diberi tahu walau kasnya belum ditutup.";
  const pemilik = setting.notifyOwner
    ? ` Pemilik toko diberi tahu kalau kas belum dibuka setelah ${SHIFT_TILL_GRACE_MINUTES} menit` +
      ` dari jam buka (${shiftOperatingLabel(setting)}) atau shift belum ditutup saat toko sudah tutup.`
    : " Pemberitahuan ke pemilik toko dimatikan.";
  return `${pengingat}${pemilik}`;
}

// ------------------------------------------------------------------ pengingat

/**
 * Pengingat tutup shift untuk satu shift yang masih terbuka — `null` kalau belum
 * waktunya (atau kalau pengingatnya dimatikan workspace). Kalimatnya ditulis di
 * sini, bukan di halaman, supaya halaman Kasir dan halaman Shift & Kas
 * menyampaikan hal yang sama persis, dan bisa diuji tanpa peramban.
 */
export function shiftReminder({
  openedAt,
  now = Date.now(),
  setting = DEFAULT_SHIFT_SETTING,
}: {
  openedAt: number;
  now?: number;
  setting?: Partial<ShiftSetting> | null;
}): ShiftReminder | null {
  if (!Number.isFinite(openedAt) || openedAt <= 0 || openedAt > now) return null;
  const dipakai = shiftSettingOf(setting);
  if (!dipakai.active) return null;

  const sekarang = new Date(now);
  const durasi = shiftDurationLabel(now - openedAt);
  const jamSekarang = jamLokal(sekarang);

  if (selisihHari(new Date(openedAt), sekarang) > 0) {
    return {
      level: "late",
      reason: "cross-day",
      title: "Shift kemarin belum ditutup",
      message: `Kas masih terbuka sejak ${shiftClockLabel(openedAt, now)} (${durasi}). Tutup shift dulu sebelum mulai berjualan hari ini: uang fisiknya belum dicocokkan dan Z-report hari itu belum tercatat.`,
      cta: "Tutup shift sekarang",
    };
  }

  if (now - openedAt >= dipakai.longShiftHours * JAM_MS) {
    return {
      level: "late",
      reason: "long-shift",
      title: `Shift sudah berjalan ${durasi}`,
      message: `Kas dibuka pukul ${jamLokal(new Date(openedAt))} dan belum ditutup. Sebaiknya tutup shift & cocokkan uang fisiknya sekarang supaya selisih kas tidak menumpuk sampai tutup toko.`,
      cta: "Tutup shift sekarang",
    };
  }

  if (sekarang.getHours() >= dipakai.reminderHour) {
    return {
      level: "closing",
      reason: "closing-hour",
      title: "Jangan lupa tutup shift",
      message: `Sekarang pukul ${jamSekarang}. Sebelum hari berakhir atau toko tutup, tutup shift di halaman Shift & Kas: uang fisik dicocokkan, selisih kas tercatat, dan Z-report hari ini tersimpan.`,
      cta: "Tutup shift",
    };
  }

  return null;
}

/**
 * Satu kalimat yang menjelaskan kapan pengingat akan muncul — dipakai halaman
 * Pengaturan di bawah kolomnya supaya pemilik toko tahu akibat angka yang diketik
 * **sebelum** menyimpan.
 */
export function shiftSettingHint(setting: ShiftSetting): string {
  const kasir = setting.active
    ? `Pengingat pertama muncul pukul ${shiftHourLabel(setting.reminderHour)} (waktu perangkat kasir). ` +
      `Shift yang sudah berjalan ${setting.longShiftHours} jam, atau dibuka hari sebelumnya, ` +
      `langsung diberi peringatan keras walaupun jam pengingatnya belum lewat.`
    : "Pengingatnya mati: kasir tidak akan diberi tahu kalau kasnya belum ditutup, di halaman Kasir maupun Shift & Kas.";
  const pemilik = setting.notifyOwner
    ? ` Pemilik toko diberi tahu saat toko sudah buka (${shiftOperatingLabel(setting)}) tetapi kasnya belum dibuka, ` +
      `atau saat shift belum ditutup.`
    : " Pemberitahuan ke pemilik toko dimatikan: tidak ada kabar yang dikirim walau kasnya belum dibuka atau shiftnya belum ditutup.";
  return `${kasir}${pemilik}`;
}

// ------------------------------------------------------------- jam operasional

/**
 * Jam lokal **perangkat yang melaporkan** — bukan jam proses. Server Convex
 * berjalan di UTC, sedangkan “toko sudah buka” diputuskan di tempat kasir
 * berdiri, jadi jamnya ikut dikirim bersama laporannya dan diperiksa di sini.
 */
export interface ShiftLocalClock {
  /** Jam 0..23 menurut perangkat. */
  hour: number;
  /** Menit 0..59 menurut perangkat. */
  minute: number;
  /** Hari kalender lokal perangkat, `YYYY-MM-DD`. */
  dayKey: string;
}

/** Hari kalender **lokal** (`2026-10-16`), bukan hari UTC. */
export function shiftDayKey(value: number | string | Date = Date.now()): string {
  const at =
    value instanceof Date
      ? value
      : new Date(typeof value === "number" ? value : Date.parse(value));
  if (!Number.isFinite(at.getTime())) return "";
  const bulan = String(at.getMonth() + 1).padStart(2, "0");
  const tanggal = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${bulan}-${tanggal}`;
}

/** Apakah teks ini berbentuk hari kalender `YYYY-MM-DD` yang masuk akal. */
export function isShiftDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const bulan = Number(value.slice(5, 7));
  const tanggal = Number(value.slice(8, 10));
  return bulan >= 1 && bulan <= 12 && tanggal >= 1 && tanggal <= 31;
}

/** Baca jam lokal perangkat pada momen `now` (bawaan: sekarang). */
export function shiftLocalClock(now: number = Date.now()): ShiftLocalClock {
  const at = new Date(now);
  return { hour: at.getHours(), minute: at.getMinutes(), dayKey: shiftDayKey(at) };
}

/** `09:05` dari jam & menit yang sudah dipisah; nilai liar dirapikan dulu. */
export function shiftClockText(clock: Pick<ShiftLocalClock, "hour" | "minute">): string {
  const jam = clampOperatingHour(clock.hour, 0);
  const menitRaw = typeof clock.minute === "number" && Number.isFinite(clock.minute)
    ? Math.round(clock.minute)
    : 0;
  const menit = Math.min(59, Math.max(0, menitRaw));
  return `${String(jam).padStart(2, "0")}:${String(menit).padStart(2, "0")}`;
}

/**
 * Keadaan jam operasional pada jam `hour`: toko sedang buka, belum buka, sudah
 * tutup, atau tidak punya jam buka/tutup sama sekali (buka 24 jam).
 *
 * `closeHour` yang lebih kecil dari `openHour` berarti tokonya buka **lintas
 * malam** (mis. 20:00 → 02:00), jadi jam 01:00 masih “buka” dan 12:00 justru
 * “sudah tutup”. Dua jam yang sama dibaca sebagai buka 24 jam — bukan tutup
 * sepanjang hari.
 */
export type ShiftShopState = "open" | "before-open" | "after-close" | "always-open";

export function shiftShopState(
  setting: Partial<ShiftSetting> | null | undefined,
  hour: number,
): ShiftShopState {
  const dipakai = shiftSettingOf(setting);
  const jam = clampOperatingHour(hour, 0);
  if (dipakai.openHour === dipakai.closeHour) return "always-open";
  if (dipakai.openHour < dipakai.closeHour) {
    if (jam < dipakai.openHour) return "before-open";
    if (jam >= dipakai.closeHour) return "after-close";
    return "open";
  }
  // Lintas malam: buka dari `openHour` sampai lewat tengah malam.
  if (jam >= dipakai.openHour || jam < dipakai.closeHour) return "open";
  return "after-close";
}

/** Apakah toko sedang di jam operasionalnya (buka 24 jam dihitung selalu). */
export function shiftWithinOperatingHours(
  setting: Partial<ShiftSetting> | null | undefined,
  hour: number,
): boolean {
  const state = shiftShopState(setting, hour);
  return state === "open" || state === "always-open";
}

/** `08:00–22:00`, `20:00–02:00 keesokan harinya`, atau `buka 24 jam`. */
export function shiftOperatingLabel(setting: Partial<ShiftSetting> | null | undefined): string {
  const dipakai = shiftSettingOf(setting);
  if (dipakai.openHour === dipakai.closeHour) return "buka 24 jam";
  const jam = `${shiftHourLabel(dipakai.openHour)}–${shiftHourLabel(dipakai.closeHour)}`;
  return dipakai.openHour < dipakai.closeHour ? jam : `${jam} keesokan harinya`;
}

// --------------------------------------------------- pemberitahuan ke pemilik

/**
 * `till-closed` — toko sudah buka, tetapi belum ada kas (shift) yang dibuka;
 * `shift-open`  — shift masih terbuka padahal seharusnya sudah ditutup.
 */
export type ShiftOwnerAlertKind = "till-closed" | "shift-open";

export type ShiftOwnerAlertReason =
  | "opening-grace"
  | "after-close"
  | "cross-day"
  | "long-shift";

export interface ShiftOwnerAlert {
  kind: ShiftOwnerAlertKind;
  reason: ShiftOwnerAlertReason;
  title: string;
  message: string;
  /** Hari kalender lokal perangkat — kunci “sekali per hari per jenis”. */
  dayKey: string;
}

/**
 * Apakah pemilik toko perlu diberi tahu **sekarang** atas keadaan kas ini —
 * `null` kalau tidak ada yang perlu dikabarkan.
 *
 * Bedanya dengan `shiftReminder` di atas: yang diingatkan di sana adalah kasir
 * yang sedang berdiri di depan kasnya (dan ia bisa langsung menutupnya),
 * sedangkan di sini pemilik toko yang mungkin tidak sedang di toko. Karena itu
 * syaratnya pun berbeda:
 *
 *   - **kas belum dibuka** hanya dikabarkan di **dalam** jam operasional, setelah
 *     jeda `SHIFT_TILL_GRACE_MINUTES` menit dari jam buka — sebelum itu kasirnya
 *     masih menghitung uang kembalian, dan di luar jam operasional toko memang
 *     belum/tidak berjualan;
 *   - **shift belum ditutup** dikabarkan begitu salah satu ini benar: shiftnya
 *     dibuka **hari sebelumnya** (uangnya sudah bercampur ke hari berikutnya),
 *     toko **sudah tutup** menurut jam operasional (kasnya seharusnya sudah
 *     dikunci), atau shiftnya sudah berjalan lebih lama dari ambang
 *     `longShiftHours`.
 *
 * `notifyOwner` yang mati mematikan keduanya tanpa menyentuh pengingat kasir.
 * Toko yang buka 24 jam tidak pernah menerima kabar “kas belum dibuka”: tanpa
 * jam buka, tidak ada “terlambat buka” — tetapi kabar “shift belum ditutup”
 * tetap berjalan.
 */
export function shiftOwnerAlert({
  current,
  setting = DEFAULT_SHIFT_SETTING,
  clock,
  now = Date.now(),
}: {
  current: ShiftOpenedLike | null | undefined;
  setting?: Partial<ShiftSetting> | null;
  clock: ShiftLocalClock;
  now?: number;
}): ShiftOwnerAlert | null {
  const dipakai = shiftSettingOf(setting);
  if (!dipakai.notifyOwner) return null;
  if (!isShiftDayKey(clock.dayKey)) return null;

  const openedAt = current ? shiftOpenedMs(current) : Number.NaN;
  const adaShift = Boolean(current) && Number.isFinite(openedAt) && openedAt > 0;
  const jamSekarang = shiftClockText(clock);

  if (adaShift) {
    const durasi = Number.isFinite(now) ? shiftDurationLabel(now - openedAt) : "—";
    const hariBuka = shiftDayKey(openedAt);

    if (isShiftDayKey(hariBuka) && hariBuka < clock.dayKey) {
      return {
        kind: "shift-open",
        reason: "cross-day",
        dayKey: clock.dayKey,
        title: "Shift kemarin belum ditutup",
        message:
          `Kas masih terbuka sejak ${shiftClockLabel(openedAt, now)} (${durasi}) dan shiftnya belum ditutup.` +
          ` Uang fisiknya belum dicocokkan dan Z-report hari itu belum tercatat — pemilik toko diberi tahu` +
          ` supaya penutupannya bisa ditagih hari ini juga.`,
      };
    }

    if (shiftShopState(dipakai, clock.hour) === "after-close") {
      return {
        kind: "shift-open",
        reason: "after-close",
        dayKey: clock.dayKey,
        title: "Toko sudah tutup, shift belum ditutup",
        message:
          `Jam operasional (${shiftOperatingLabel(dipakai)}) sudah lewat, tetapi shift yang dibuka pukul` +
          ` ${jamLokal(new Date(openedAt))} (${durasi}) masih terbuka. Pemilik toko diberi tahu supaya kasnya` +
          ` ditutup dan uang fisiknya dicocokkan sebelum bercampur dengan penjualan besok.`,
      };
    }

    if (Number.isFinite(now) && now - openedAt >= dipakai.longShiftHours * JAM_MS) {
      return {
        kind: "shift-open",
        reason: "long-shift",
        dayKey: clock.dayKey,
        title: `Shift sudah berjalan ${durasi}`,
        message:
          `Kas dibuka pukul ${jamLokal(new Date(openedAt))} dan belum ditutup sampai ${jamSekarang}` +
          ` (ambang ${dipakai.longShiftHours} jam). Pemilik toko diberi tahu supaya selisih kasnya tidak menumpuk.`,
      };
    }

    return null;
  }

  if (shiftShopState(dipakai, clock.hour) !== "open") return null;
  /*
    Selisihnya dihitung melingkar 24 jam, bukan sekadar dikurangi: toko yang buka
    lintas malam (20:00 → 02:00) sedang di menit ke-300 pada pukul 01:00, dan
    pengurangan biasa akan menghasilkan angka negatif — pemberitahuannya tidak
    pernah muncul padahal justru saat itu kasirnya paling mungkin lupa membuka kas.
  */
  const menitSejakBuka =
    (((clock.hour - dipakai.openHour + 24) % 24) * 60 + clock.minute) % 1440;
  if (menitSejakBuka < SHIFT_TILL_GRACE_MINUTES) return null;

  return {
    kind: "till-closed",
    reason: "opening-grace",
    dayKey: clock.dayKey,
    title: "Kas belum dibuka padahal toko sudah buka",
    message:
      `Jam operasional ${shiftOperatingLabel(dipakai)} sudah berjalan (sekarang pukul ${jamSekarang}),` +
      ` tetapi belum ada shift (kas) yang dibuka di perangkat ini. Pemilik toko diberi tahu supaya kas` +
      ` awalnya diisi dan penjualan hari ini punya pemilik kas yang bisa dicocokkan.`,
  };
}

/**
 * Satu kalimat tentang kapan pemilik toko diberi tahu — dipakai halaman
 * Pengaturan di bawah kolom jam operasionalnya.
 */
export function shiftOwnerAlertHint(setting: ShiftSetting): string {
  const dasar =
    `Pemilik toko diberi tahu saat toko sudah buka (${shiftOperatingLabel(setting)}) tetapi kasnya belum` +
    ` dibuka — setelah ${SHIFT_TILL_GRACE_MINUTES} menit dari jam buka — dan saat shift belum ditutup` +
    ` (toko sudah tutup, shift masih berjalan lebih lama dari ambangnya, atau shift dibuka hari sebelumnya).`;
  return setting.notifyOwner
    ? `${dasar} Kabarnya dikirim ke alamat email pemilik workspace ini, dan ikut masuk ke langganan` +
      ` webhook workspace (event \`shift.alert\`).`
    : "Pemberitahuan ke pemilik toko dimatikan: tidak ada kabar yang dikirim walau kasnya belum dibuka atau shiftnya belum ditutup.";
}

// ------------------------------------------------- kanal email pemilik toko

/**
 * Pemilik toko yang bisa dikabari, beserta alamat emailnya.
 *
 * Kenapa email, bukan cuma webhook: yang disebut “pemilik toko” di sini adalah
 * pemilik usaha di workspace itu — hampir selalu orang yang tidak memasang
 * endpoint webhook apa pun. Pemberitahuan yang hanya tersedia lewat langganan
 * webhook karena itu berhenti di tabelnya sendiri: kabarnya tercatat, tetapi
 * tidak pernah sampai ke orang yang dituju. Email dipilih karena jalurnya sudah
 * ada di deployment ini (Resend, kunci yang sama dengan kode masuk & undangan).
 */
export interface ShiftAlertRecipients {
  /** Semua alamat pemilik (unik, bentuk ternormalisasi), urut abjad. */
  all: string[];
  /** Alamat yang benar-benar bisa dikirimi email (bukan alamat uji `.test`). */
  deliverable: string[];
  /** Pemiliknya punya alamat, tetapi semuanya alamat uji `.test`. */
  testOnly: boolean;
}

/**
 * Susun daftar penerima: `tenants.ownerId` **dan** setiap anggota aktif berperan
 * `owner` (workspace bisa punya lebih dari satu pemilik). Kembar dibuang setelah
 * dinormalkan, karena “Pemilik@Toko.id” dan “pemilik@toko.id” adalah orang yang
 * sama — mengiriminya dua email hanya membuat kabarnya diabaikan.
 */
export function shiftAlertOwnerRecipients(input: {
  /** Email `tenants.ownerId` (`users.email`); kosong kalau barisnya hilang. */
  ownerEmail?: string | null;
  /** Baris `memberships` tenant ini. */
  members?: { email?: string | null; role?: string | null; active?: boolean }[] | null;
}): ShiftAlertRecipients {
  const kumpulan = new Set<string>();
  const tambah = (raw?: string | null) => {
    const email = normalizeEmail(raw ?? "");
    if (email) kumpulan.add(email);
  };

  tambah(input.ownerEmail);
  for (const anggota of input.members ?? []) {
    if (anggota?.role !== "owner") continue;
    if (anggota.active === false) continue;
    tambah(anggota.email);
  }

  const all = [...kumpulan].sort();
  const deliverable = all.filter((email) => !isTestEmail(email));
  return { all, deliverable, testOnly: all.length > 0 && deliverable.length === 0 };
}

/** Isi email pemberitahuan shift — dipakai aksi pengirim dan diperiksa harness. */
export function shiftAlertEmailContent(input: {
  workspace: string;
  title: string;
  message: string;
  /** Hari kalender lokal perangkat, `YYYY-MM-DD`. */
  day: string;
  /** Jam lokal perangkat saat keadaannya dilaporkan (`08:15`). */
  localClock: string;
  /** Jam operasional yang berlaku (`08:00–22:00`). */
  operatingHours: string;
  /** Tautan halaman Shift & Kas; kosong kalau `SITE_URL` belum diset. */
  shiftUrl?: string | null;
  appName?: string;
}): { subject: string; text: string } {
  const appName = input.appName ?? "MesinPOS";
  const tautan = (input.shiftUrl ?? "").trim();
  return {
    subject: `[${appName}] ${input.title} — ${input.workspace}`,
    text: [
      input.title,
      "",
      input.message,
      "",
      `Workspace: ${input.workspace}`,
      `Jam operasional: ${input.operatingHours}`,
      `Dilaporkan dari perangkat kasir: ${input.day} pukul ${input.localClock}`,
      "",
      tautan
        ? `Buka halaman Shift & Kas untuk menandainya sudah ditangani: ${tautan}`
        : "Buka halaman Shift & Kas di aplikasi MesinPOS untuk menandainya sudah ditangani.",
      "",
      "Email ini dikirim karena pemberitahuan ke pemilik toko hidup di halaman",
      "Pengaturan workspace Anda. Kabar yang sama juga bisa dibaca ulang di",
      "halaman Shift & Kas.",
    ].join("\n"),
  };
}

/**
 * Kalimat “apa yang benar-benar terjadi” dengan satu kabar shift — dipakai kartu
 * Shift & Kas **dan** daftar di mode demo supaya keduanya tidak menjawab berbeda.
 *
 * Yang dikatakan adalah keadaan yang tersimpan, bukan harapan: email yang sedang
 * berjalan tetap “sedang dikirim”, email yang gagal menyebut pesan penyedianya,
 * dan alamat uji `.test` dibedakan dari email yang benar-benar berangkat.
 */
export interface ShiftAlertDelivery {
  emailRecipients?: string[] | null;
  /** `resend` = lewat penyedia email, `uji` = alamat `.test`, `demo` = mode demo. */
  emailVia?: string | null;
  emailDeliveredAt?: number | null;
  emailError?: string | null;
  notifiedEndpoints: number;
}

/** `true` kalau kabar ini benar-benar sampai ke pemilik (email dan/atau webhook). */
export function shiftAlertDelivered(row: ShiftAlertDelivery): boolean {
  return Boolean(row.emailDeliveredAt) || row.notifiedEndpoints > 0;
}

export function shiftAlertDeliveryText(row: ShiftAlertDelivery): string {
  const alamat = (row.emailRecipients ?? []).join(", ");
  let email: string;
  if (row.emailError) {
    email = `Email ke pemilik toko gagal: ${row.emailError}`;
  } else if (row.emailDeliveredAt) {
    email = `Email terkirim ke pemilik toko (${alamat}).`;
  } else if (row.emailVia === "uji") {
    email =
      `Alamat email pemilik toko di workspace ini alamat uji, jadi tidak ada email yang berangkat` +
      (alamat ? ` (${alamat}).` : ".");
  } else if (row.emailVia === "demo") {
    email = "Mode demo tidak punya kanal email server, jadi email ke pemilik toko tidak dikirim dari sini.";
  } else if (alamat) {
    email = `Email ke pemilik toko (${alamat}) sedang dikirim.`;
  } else {
    email = "Workspace ini belum punya alamat email pemilik toko yang bisa dikabari.";
  }

  const webhook =
    row.notifiedEndpoints > 0
      ? `Kabarnya juga masuk ke ${row.notifiedEndpoints} endpoint webhook.`
      : "Belum ada endpoint webhook yang melanggan `shift.alert`.";
  return `${email} ${webhook}`;
}

/**
 * Kalimat balikan `shiftAlerts.report` untuk layar kasir — apa yang terjadi dengan
 * laporannya, termasuk saat emailnya belum bisa berangkat.
 */
export function shiftAlertReportNotice(input: {
  title: string;
  recipients: ShiftAlertRecipients;
  /** Saluran email yang benar-benar terpasang di deployment ini. */
  emailChannel: EmailTransport;
  notifiedEndpoints: number;
}): string {
  const webhook =
    input.notifiedEndpoints > 0
      ? ` Kabarnya juga masuk ke ${input.notifiedEndpoints} endpoint webhook.`
      : " Belum ada endpoint webhook yang melanggan `shift.alert`.";

  if (input.recipients.deliverable.length > 0) {
    if (input.emailChannel.kind === "resend") {
      return (
        `Email “${input.title}” dijadwalkan ke pemilik toko` +
        ` (${input.recipients.deliverable.join(", ")}).${webhook}`
      );
    }
    return (
      "Pemberitahuan tercatat, tetapi kanal email server belum dikonfigurasi" +
      ` (${input.emailChannel.reason ?? "RESEND_API_KEY belum diset"}) — pemilik toko belum menerima kabarnya.${webhook}`
    );
  }

  if (input.recipients.testOnly) {
    return (
      "Pemberitahuan tercatat, tetapi alamat email pemilik toko di workspace ini semuanya alamat uji" +
      ` — tidak ada email yang berangkat.${webhook}`
    );
  }

  return `Pemberitahuan tercatat, tetapi workspace ini belum punya alamat email pemilik toko yang bisa dikabari.${webhook}`;
}

// ------------------------------------------------------------- gerbang kasir

/**
 * Gerbang kasir: halaman Kasir hanya bisa menjual kalau ada shift yang **sedang
 * terbuka di perangkat ini**.
 *
 * Kenapa: penjualan yang tercatat tanpa shift tidak punya pemilik kas. Uang
 * kembalian awalnya tidak diketahui, dan selisih kasnya tidak bisa dicocokkan ke
 * orang maupun jam — jadi gerbangnya dipasang di depan, sebelum keranjang diisi,
 * bukan sebagai peringatan setelah uangnya masuk.
 *
 * Yang dikunci adalah **pekerjaan menjual**: menambah produk, memilih meja,
 * menahan/melanjutkan transaksi, dan membuka pembayaran. Yang tetap bisa dipakai
 * adalah hal yang tidak menjual apa pun — mencari produk, membaca riwayat
 * transaksi shift yang lalu, dan halaman lain.
 *
 * Keadaannya hidup di perangkat (`mesinpos.shifts.v1`), jadi keputusannya pun
 * diputuskan di perangkat — server tidak bisa menanyakan shift yang tidak pernah
 * dilihatnya. Karena itu aturannya ditulis di sini, satu kali, supaya halaman
 * Kasir, kedua store, dan harness tidak menjawab berbeda.
 */
export interface PosShiftGate {
  /** `true` = kasir terkunci sampai ada shift yang dibuka. */
  locked: boolean;
  title: string;
  message: string;
  cta: string;
  /** Kalimat pendek untuk `title` tombol yang dimatikan gerbang ini. */
  hint: string;
}

const POS_SHIFT_OPEN: PosShiftGate = {
  locked: false,
  title: "",
  message: "",
  cta: "",
  hint: "",
};

/**
 * Putuskan apakah kasir boleh menjual. Argumennya baris shift yang sedang
 * berjalan (`state.current`), bukan seluruh state: riwayat shift yang sudah
 * ditutup tidak pernah membuka gerbang.
 *
 * Waktu buka yang tidak terbaca (mis. data lama yang rusak) **ikut mengunci**:
 * shift yang tidak bisa dipertanggungjawabkan jamnya sama saja dengan kas yang
 * belum dibuka, dan membiarkannya menjual justru membuat selisihnya tak terjejak.
 */
export function posShiftGate(
  current: ShiftOpenedLike | null | undefined,
): PosShiftGate {
  /*
    Waktu bukanya boleh ISO (shift perangkat) atau milidetik (`shifts.openedAt`
    dari server, yang dibaca `pos.till`): kas yang sama dibaca dari dua sisi, jadi
    gerbangnya tidak boleh menebak bentuk salah satunya. Lihat `shiftOpenedMs`.
  */
  const openedAt = current ? shiftOpenedMs(current) : Number.NaN;
  if (current && Number.isFinite(openedAt) && openedAt > 0) return POS_SHIFT_OPEN;

  return {
    locked: true,
    title: "Kasir terkunci — shift (kas) belum dibuka",
    message:
      "Buka shift (kas) terlebih dahulu di halaman Shift & Kas: isi kas awal (uang kembalian), " +
      "lalu keranjang, pembayaran, dan cetak struk aktif kembali. Selama belum ada shift terbuka, " +
      "penjualan tidak bisa disimpan dan uang harinya tidak bisa dicocokkan.",
    cta: "Buka shift sekarang",
    hint: "Kasir terkunci: buka shift (kas) dulu di halaman Shift & Kas sebelum melayani penjualan.",
  };
}

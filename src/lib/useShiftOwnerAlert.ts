/**
 * Pelaporan keadaan kas ke **pemilik toko** dari perangkat kasir.
 *
 * Kenapa ada: halaman Kasir sudah memperingatkan kasirnya sendiri
 * (`shiftReminder`), tetapi pemilik toko sering tidak sedang berdiri di depan kas
 * itu. Dua keadaan yang perlu sampai ke dia cuma bisa dilihat dari perangkat yang
 * memegang shiftnya:
 *
 *   - **kas belum dibuka** padahal toko sudah buka (`shiftOwnerAlert` →
 *     `till-closed`), dan
 *   - **shift belum ditutup** padahal toko sudah tutup, shiftnya sudah berjalan
 *     terlalu lama, atau masih terbuka sejak hari sebelumnya (`shift-open`).
 *
 * Yang diputuskan hook ini **hanya satu**: keadaan mana yang sedang berlaku di
 * perangkat ini, dan apakah sudah pernah dilaporkan. Aturan kapan pemilik perlu
 * diberi tahu hidup di `@/lib/shift` (dipakai hook ini, halaman, mode demo, dan
 * server), sedangkan “sekali per hari per jenis” ditegakkan dua lapis: penanda
 * perangkat di sini (supaya halaman yang dimuat ulang tidak menembak laporan yang
 * sama berulang kali) dan `shiftAlerts.report` di server (supaya dua perangkat
 * yang melihat keadaan yang sama tidak mengirim dua kabar).
 *
 * Laporannya tidak pernah dipaksa “berhasil”: balikan server yang berbunyi “tidak
 * perlu” atau “sudah pernah” diteruskan apa adanya ke layar — termasuk saat kanal
 * email server belum dikonfigurasi atau belum ada endpoint webhook yang melanggan
 * `shift.alert`. Kalau itu disembunyikan, pemilik toko akan mengira dirinya sudah
 * dikabari padahal belum.
 */

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import type { ShiftAlertReportResult } from "@/lib/store/types";
import {
  shiftLocalClock,
  shiftOpenedMs,
  shiftOwnerAlert,
  type ShiftOpenedLike,
  type ShiftOwnerAlert,
  type ShiftSetting,
  type ShiftShopState,
} from "@/lib/shift";

/** Kunci penanda “sudah dilaporkan dari perangkat ini” (bukan data shift). */
export const SHIFT_ALERT_SENT_KEY = "mesinpos.shift-alerts.v1";

/** Berapa penanda terakhir yang disimpan; sisanya memang sudah tidak relevan. */
export const SHIFT_ALERT_SENT_KEEP = 20;

/**
 * Seberapa sering keadaan kasnya diperiksa ulang selama halamannya terbuka, dalam
 * milidetik. Halaman Kasir sering dibiarkan terbuka berjam-jam, jadi perlintasan
 * jam tutup (dan shift yang melewati ambangnya) harus ketahuan tanpa memuat ulang.
 * Satu menit cukup rapat untuk pengingat harian dan tidak menjadi pekerjaan tetap.
 */
export const SHIFT_ALERT_CHECK_MS = 60_000;

export type ShiftOwnerAlertStatus =
  | "idle"
  /** Kabarnya sedang dikirim ke server. */
  | "sending"
  /** Benar-benar tercatat (dijadwalkan sebagai email & diteruskan ke pelanggan webhook). */
  | "sent"
  /** Hari itu keadaannya sudah diberitahukan — dari perangkat lain atau sesi lalu. */
  | "duplicate"
  /** Server menjawab tidak ada yang perlu dikabarkan (mis. saklarnya mati). */
  | "skipped"
  /** Pengirimannya gagal; alasannya diteruskan apa adanya. */
  | "failed";

export interface ShiftOwnerAlertState {
  /** Keadaan yang **sedang** berlaku menurut aturan; `null` = tidak ada. */
  alert: ShiftOwnerAlert | null;
  status: ShiftOwnerAlertStatus;
  /** Kalimat untuk kasir: apa yang terjadi dengan laporannya. */
  notice: string | null;
}

export const EMPTY_SHIFT_OWNER_ALERT: ShiftOwnerAlertState = {
  alert: null,
  status: "idle",
  notice: null,
};

/**
 * Label status pelaporan untuk layar kasir: apa yang benar-benar terjadi dengan
 * kabarnya. “Sudah diberi tahu” dan “belum sampai” sengaja dibedakan — kalau
 * keduanya berbunyi sama, pemilik toko akan mengira dirinya dikabari padahal
 * kanal emailnya belum berangkat (atau endpoint webhooknya belum ada).
 */
export function shiftOwnerAlertStatusLabel(status: ShiftOwnerAlertStatus): string {
  switch (status) {
    case "sending":
      return "Memberi tahu pemilik toko…";
    case "sent":
      return "Pemilik toko diberi tahu";
    case "duplicate":
      return "Pemilik toko sudah diberi tahu hari ini";
    case "skipped":
      return "Belum ada kabar yang dikirim ke pemilik toko";
    case "failed":
      return "Pemberitahuan ke pemilik toko gagal dikirim";
    default:
      return "Tidak ada yang perlu dikabarkan";
  }
}

/** Daftar penanda yang sudah dilaporkan dari perangkat ini (tahan nilai rusak). */
export function readShiftAlertSent(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
  } catch {
    return [];
  }
}

/** Penanda satu kabar: jenisnya + hari kalender lokal perangkat. */
export function shiftAlertSentKey(alert: Pick<ShiftOwnerAlert, "kind" | "dayKey">): string {
  return `${alert.kind}:${alert.dayKey}`;
}

function sentKeys(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return readShiftAlertSent(window.localStorage.getItem(SHIFT_ALERT_SENT_KEY));
  } catch {
    return [];
  }
}

function rememberSent(key: string) {
  if (typeof window === "undefined") return;
  try {
    const next = [key, ...sentKeys().filter((value) => value !== key)].slice(
      0,
      SHIFT_ALERT_SENT_KEEP,
    );
    window.localStorage.setItem(SHIFT_ALERT_SENT_KEY, JSON.stringify(next));
  } catch {
    /* penyimpanan tidak tersedia — server masih punya penjaganya sendiri */
  }
}

/** Apakah keadaan yang sedang berlaku ini sudah dilaporkan dari perangkat ini. */
export function shiftAlertAlreadySent(alert: Pick<ShiftOwnerAlert, "kind" | "dayKey">): boolean {
  return sentKeys().includes(shiftAlertSentKey(alert));
}

export interface UseShiftOwnerAlertInput {
  /**
   * Kas yang sedang terbuka untuk toko ini; `null` = kasnya belum dibuka.
   *
   * Waktu bukanya boleh ISO (shift perangkat, `ShiftRecord.openedAt`) atau
   * milidetik (`shifts.openedAt` dari server) — kedua sisi melihat keadaan yang
   * sama, jadi bentuknya tidak boleh memaksa salah satu menebak.
   */
  current: ShiftOpenedLike | null | undefined;
  /** Setelan workspace (`tenants.shift`): jam operasional & saklar pemberitahuan. */
  setting: ShiftSetting;
  /** Matikan pelaporan (mis. halaman tidak boleh melapor). Bawaan: hidup. */
  enabled?: boolean;
}

/**
 * Menghitung keadaan yang perlu dikabarkan ke pemilik toko lalu melaporkannya
 * sekali per hari per jenis. Halaman Kasir & halaman Shift & Kas memakai hook yang
 * sama supaya keduanya melaporkan hal yang persis sama.
 */
export function useShiftOwnerAlert({
  current,
  setting,
  enabled = true,
}: UseShiftOwnerAlertInput): ShiftOwnerAlertState {
  const { reportShiftAlert } = useStore();
  const [state, setState] = useState<ShiftOwnerAlertState>(EMPTY_SHIFT_OWNER_ALERT);
  const [tick, setTick] = useState(0);
  /**
   * Laporan yang sedang berjalan — supaya render ulang tidak menembak dua kali.
   * Janjinya disimpan (bukan cuma kuncinya) karena render ulang akan melepas
   * penangan hasil milik jalannya yang lama: tanpa janji itu, kabar yang sudah
   * terkirim tidak pernah sampai ke layar.
   */
  const inFlight = useRef<{ key: string; promise: Promise<ShiftAlertReportResult> } | null>(null);
  /**
   * Hasil terakhir untuk kabar yang sedang berlaku di sesi ini. Render ulang
   * sering terjadi setelah pelaporan (datanya baru bertambah, penanda perangkat
   * baru ditulis), dan hasil yang sudah final itu tidak boleh turun kembali
   * menjadi “sedang mengirim” atau “sudah pernah”.
   */
  const lastReport = useRef<{
    key: string;
    status: ShiftOwnerAlertStatus;
    notice: string | null;
  } | null>(null);

  // Pemeriksaan berkala: keadaan yang berubah karena **waktu** (jam tutup lewat,
  // shift makin lama) tidak memicu apa pun sendiri kalau kasirnya tidak menyentuh
  // layar. Hanya hidup selama halamannya terbuka.
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setTick((value) => value + 1), SHIFT_ALERT_CHECK_MS);
    return () => window.clearInterval(id);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      inFlight.current = null;
      lastReport.current = null;
      setState(EMPTY_SHIFT_OWNER_ALERT);
      return;
    }

    const now = Date.now();
    const clock = shiftLocalClock(now);
    const alert = shiftOwnerAlert({ current: current ?? null, setting, clock, now });

    if (!alert) {
      inFlight.current = null;
      lastReport.current = null;
      setState(EMPTY_SHIFT_OWNER_ALERT);
      return;
    }

    const key = shiftAlertSentKey(alert);

    // Kabar yang sudah berakhir di sesi ini dipertahankan apa adanya; kalau
    // tidak, hasil “terkirim” akan tertimpa “sudah pernah” (penanda perangkat
    // yang baru ditulis) atau “sedang mengirim” (render ulang dari halaman).
    const akhir = lastReport.current;
    if (akhir && akhir.key === key) {
      setState({ alert, status: akhir.status, notice: akhir.notice });
      return;
    }

    if (shiftAlertAlreadySent(alert)) {
      setState({
        alert,
        status: "duplicate",
        notice: `Pemilik toko sudah diberitahukan soal ini dari perangkat ini (${alert.dayKey}).`,
      });
      return;
    }

    let hidup = true;
    const lapor = (result: ShiftAlertReportResult) => {
      if (!hidup) return;
      const status: ShiftOwnerAlertStatus = result.recorded
        ? "sent"
        : result.duplicate
          ? "duplicate"
          : "skipped";
      if (result.recorded) rememberSent(key);
      lastReport.current = { key, status, notice: result.notice };
      setState({ alert, status, notice: result.notice });
    };
    const gagal = (cause: unknown) => {
      if (!hidup) return;
      const notice = cause instanceof Error ? cause.message : String(cause);
      lastReport.current = { key, status: "failed", notice };
      setState({ alert, status: "failed", notice });
    };

    setState({ alert, status: "sending", notice: null });

    // Laporan yang sama sedang berjalan: ikut menunggu janji yang sama, jangan
    // menembak laporan kedua. Jalannya yang lama sudah dilepas pembersihannya,
    // jadi jalan terbaru inilah yang melaporkan hasilnya ke layar.
    const sedang = inFlight.current;
    if (sedang && sedang.key === key) {
      void sedang.promise.then(lapor).catch(gagal);
      return () => {
        hidup = false;
      };
    }

    const promise = reportShiftAlert({
      kind: alert.kind,
      clock,
      openedAt: current ? shiftOpenedMs(current) : undefined,
    });
    inFlight.current = { key, promise };

    void promise
      .then(lapor)
      .catch(gagal)
      .finally(() => {
        if (inFlight.current?.key === key) inFlight.current = null;
      });

    return () => {
      hidup = false;
    };
  }, [
    enabled,
    current,
    // Bidang setelannya dibaca satu per satu, bukan lewat objek `setting`:
    // sebagian store mengembalikan objek setelan yang baru tiap render, dan
    // pelaporan yang terpicu render ulang akan mengirim kabar yang sama berkali-kali.
    setting.openHour,
    setting.closeHour,
    setting.notifyOwner,
    setting.longShiftHours,
    reportShiftAlert,
    tick,
  ]);

  return state;
}

/**
 * Ringkasan satu baris untuk lencana di layar kasir: keadaan jam operasional
 * sekarang, dipakai bersama halaman Kasir & Shift & Kas supaya labelnya sama.
 */
export function shiftOperatingStatusLabel(setting: ShiftSetting, state: ShiftShopState): string {
  const label = `${String(setting.openHour).padStart(2, "0")}:00–${String(setting.closeHour).padStart(2, "0")}:00`;
  switch (state) {
    case "open":
      return `jam operasional ${label}`;
    case "before-open":
      return `toko belum buka (jam operasional ${label})`;
    case "after-close":
      return `toko sudah tutup (jam operasional ${label})`;
    default:
      return "buka 24 jam";
  }
}

/** Dipakai uji: lupakan penanda perangkat (tanpa itu, uji kedua tidak melapor). */
export function resetShiftAlertSentStorage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SHIFT_ALERT_SENT_KEY);
  } catch {
    /* tidak apa-apa */
  }
}

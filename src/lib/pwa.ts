/**
 * PWA: ajakan pemasangan (install) dan aturan pendampingnya.
 *
 * Cakupannya sengaja dipisah dua:
 *
 *  - **Kapan ajakan muncul** — kunjungan pertama, 10 detik setelah aplikasi
 *    dibuka, sekali saja; setelah itu yang tersisa hanyalah tombol di header.
 *    Itu aturan murni, jadi ada di berkas ini dan diuji harness.
 *  - **Bagaimana aplikasinya terpasang** — manifest `display: fullscreen` dan
 *    service worker `public/sw.js`. Berkas-berkas itu tidak bisa mengimpor
 *    modul ini (sw.js disajikan apa adanya, bukan dibundel), jadi harness-nya
 *    mengeksekusi `sw.js` yang asli, bukan salinan aturan di sini.
 */

import { THEME_COLORS } from "./theme";

/** Kunci catatan pemasangan (per perangkat). */
export const INSTALL_STORAGE_KEY = "mesinpos.install.v1";

/**
 * Jeda ajakan: 10 detik setelah aplikasi dibuka pada kunjungan pertama.
 * Cukup lama untuk pengguna melihat produknya dulu, cukup pendek untuk tidak
 * kehilangan momen.
 */
export const INSTALL_PROMPT_DELAY_MS = 10_000;

export const SERVICE_WORKER_URL = "/sw.js";
export const MANIFEST_URL = "/manifest.webmanifest";
export const APPLE_TOUCH_ICON_URL = "/apple-touch-icon.png";

/** Warna yang dipakai manifest & meta tema (satu keluarga dengan tema gelap). */
export const PWA_THEME_COLOR = "#20C589";
export const PWA_BACKGROUND_COLOR = THEME_COLORS.dark;

export interface InstallRecord {
  /** Kunjungan pertama yang mencatat catatan ini. */
  firstSeenAt: string;
  /** Kapan ajakan benar-benar tampil; `null` = belum pernah. */
  invitedAt: string | null;
  /** Kapan pengguna menutup ajakan tanpa memasang; `null` = belum ditutup. */
  dismissedAt: string | null;
}

/** Catatan rusak/asing diperlakukan sebagai "pengunjung baru", bukan dipecaya. */
export function readInstallRecord(raw: string | null | undefined): InstallRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<InstallRecord>;
    if (typeof parsed?.firstSeenAt !== "string") return null;
    return {
      firstSeenAt: parsed.firstSeenAt,
      invitedAt: typeof parsed.invitedAt === "string" ? parsed.invitedAt : null,
      dismissedAt: typeof parsed.dismissedAt === "string" ? parsed.dismissedAt : null,
    };
  } catch {
    return null;
  }
}

export function serializeInstallRecord(record: InstallRecord): string {
  return JSON.stringify(record);
}

export function startInstallRecord(now: Date): InstallRecord {
  return { firstSeenAt: now.toISOString(), invitedAt: null, dismissedAt: null };
}

export function markInvited(record: InstallRecord, now: Date): InstallRecord {
  return { ...record, invitedAt: record.invitedAt ?? now.toISOString() };
}

export function markDismissed(record: InstallRecord, now: Date): InstallRecord {
  return { ...record, dismissedAt: record.dismissedAt ?? now.toISOString() };
}

/**
 * Ajakan hanya untuk kunjungan **pertama** dan hanya kalau aplikasinya belum
 * terpasang. Setelah pernah tampil, ajakan tidak diulang — pengguna tidak
 * boleh diburu-buru oleh produk yang sama.
 */
export function shouldOfferInvite(record: InstallRecord | null, installed: boolean): boolean {
  return !installed && record !== null && record.invitedAt === null;
}

/**
 * Tombol di header: muncul setelah ajakan pernah tampil (ditutup atau tidak)
 * dan aplikasinya masih belum terpasang. Selama ajakannya masih terbuka,
 * tombolnya disembunyikan supaya tidak ada dua ajakan sekaligus.
 */
export function shouldShowInstallButton(
  record: InstallRecord | null,
  options: { installed: boolean; inviteOpen: boolean },
): boolean {
  if (options.installed || options.inviteOpen) return false;
  return record?.invitedAt != null;
}

/**
 * Sudah terpasang? Diperiksa dari tampilan (mode layar penuh/standalone) dan
 * penanda iOS, karena `appinstalled` tidak selalu sempat terdengar saat
 * aplikasi dibuka langsung dari ikonnya.
 */
export function isInstalled(display: {
  fullscreen: boolean;
  standalone: boolean;
  iosStandalone: boolean;
}): boolean {
  return display.fullscreen || display.standalone || display.iosStandalone;
}

/** Service worker hanya didaftarkan kalau browsernya memang mendukung. */
export function supportsServiceWorker(input: unknown): boolean {
  return typeof input === "object" && input !== null && "serviceWorker" in input;
}

/**
 * Peramban yang **tidak** memberi `beforeinstallprompt` (mis. Safari iOS) tetap
 * perlu jalan keluar: tombolnya membuka petunjuk pemasangan manual. Langkahnya
 * berbeda antara iOS dan Android/desktop, jadi teksnya dibuat di sini supaya UI
 * tidak mengarang sendiri.
 */
export function manualInstallSteps(ios: boolean): string[] {
  if (ios) {
    return [
      "Buka menu Bagikan (ikon kotak dengan panah ke atas) di Safari.",
      "Pilih “Tambah ke Layar Utama”.",
      "Tekan Tambah — MesinPOS terbuka penuh tanpa bilah browser.",
    ];
  }
  return [
    "Buka menu browser (ikon ⋮ atau ⋯ di kanan atas).",
    "Pilih “Pasang aplikasi” / “Tambahkan ke layar utama”.",
    "Konfirmasi — MesinPOS terbuka penuh tanpa bilah browser.",
  ];
}

/**
 * iOS tidak pernah memberi `beforeinstallprompt`, jadi tombolnya harus tahu
 * kapan menampilkan langkah Safari. iPad modern melaporkan dirinya sebagai Mac
 * — karena itu jumlah titik sentuh ikut diperiksa.
 */
export function looksLikeIos(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

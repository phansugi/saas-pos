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

/**
 * Alamat **tetap** untuk memasang aplikasinya — yang masih hidup setelah sesi
 * pengembangan berakhir. Dipakai sebagai rujukan peringatan di bawah.
 */
export const STABLE_INSTALL_ORIGIN = "https://mesinpos.freebuff.app";

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
  /**
   * Kapan **perangkat ini** terbukti sudah memasang aplikasinya; `null` = belum
   * (atau batal dipasang).
   *
   * Kenapa dicatat di perangkat, bukan disimpan di memori saja: `appinstalled`
   * hanya berbunyi di tab yang sedang terbuka, dan mode tampilan hanya cocok saat
   * aplikasinya **dibuka dari ikonnya**. Tanpa catatan ini, pemakainya memasang
   * aplikasi lalu tetap ditawari tombol “Pasang” setiap kali membuka alamatnya di
   * tab browser — persis keluhan yang membuat catatan ini ada.
   */
  installedAt: string | null;
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
      // Catatan dari versi sebelum kolom ini ada tetap sah: yang kosong berarti
      // “belum terbukti terpasang”, bukan catatan rusak.
      installedAt: typeof parsed.installedAt === "string" ? parsed.installedAt : null,
    };
  } catch {
    return null;
  }
}

export function serializeInstallRecord(record: InstallRecord): string {
  return JSON.stringify(record);
}

export function startInstallRecord(now: Date): InstallRecord {
  return {
    firstSeenAt: now.toISOString(),
    invitedAt: null,
    dismissedAt: null,
    installedAt: null,
  };
}

/** Bukti bahwa perangkat ini sudah memasang aplikasinya. Sekali tercatat, cukup. */
export function markInstalled(record: InstallRecord, now: Date): InstallRecord {
  if (record.installedAt !== null) return record;
  return { ...record, installedAt: now.toISOString() };
}

/**
 * Batal dipasang (atau catatan lama yang ternyata keliru): browser menawarkan
 * pemasangan lagi — itu artinya aplikasinya **tidak** terpasang di perangkat ini,
 * jadi catatan “sudah terpasang” harus dibuang supaya tombolnya bisa kembali.
 */
export function markNotInstalled(record: InstallRecord): InstallRecord {
  if (record.installedAt === null) return record;
  return { ...record, installedAt: null };
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
  if (installed || record === null) return false;
  if (record.installedAt !== null) return false;
  return record.invitedAt === null;
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
  // Perangkat ini sudah memasang aplikasinya — sekali pun sekarang dibuka di tab
  // browser biasa (mode tampilan `browser`), tombol “Pasang” tidak ditawarkan lagi.
  if (record?.installedAt != null) return false;
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
  /** Jendela aplikasi bergaya minimal-ui (beberapa peramban memilih ini). */
  minimalUi?: boolean;
  /** Jendela dengan bilah judul overlay (Chrome desktop). */
  windowControlsOverlay?: boolean;
}): boolean {
  return (
    display.fullscreen ||
    display.standalone ||
    display.iosStandalone ||
    display.minimalUi === true ||
    display.windowControlsOverlay === true
  );
}

/**
 * Mode tampilan yang menandakan halaman dibuka dari aplikasi yang **terpasang**.
 * Manifest workspace meminta `fullscreen` dengan cadangan `standalone`, tetapi
 * peramban boleh memilih mode lain yang didukungnya — jadi keempatnya diperiksa,
 * bukan hanya yang diminta.
 */
export const INSTALLED_DISPLAY_MODES = [
  "fullscreen",
  "standalone",
  "minimal-ui",
  "window-controls-overlay",
] as const;

/**
 * Bukti pemasangan dari `navigator.getInstalledRelatedApps()` — satu-satunya cara
 * tahu bahwa aplikasinya terpasang **dari tab browser biasa**, dan hanya peramban
 * berbasis Chromium yang menyediakannya (Safari iOS tidak, di tab biasa maupun
 * tidak). Daftar berisi entri = aplikasi ini ada di daftar terpasang.
 */
export function installedFromRelatedApps(apps: unknown): boolean {
  return Array.isArray(apps) && apps.length > 0;
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
 * Alamat yang sedang dibuka **tidak akan lama hidup** (pratinjau sandbox, localhost)?
 *
 * Ini bukan detail teknis yang bisa dibiarkan: aplikasi PWA yang dipasang dari
 * alamat sementara **benar-benar dipasang** — ikonnya muncul di layar utama — tetapi
 * menunjuk ke tempat yang mati begitu sesinya berakhir, jadi membukanya berakhir
 * “tidak bisa dibuka”. Aplikasi memperingatkan itu sebelum orang memasangnya.
 *
 * Sengaja **hanya** mengenali alamat yang jelas sementara (localhost, IP loopback,
 * dan domain pratinjau `*.e2b.app`); domain lain — termasuk domain sendiri — tidak
 * dituduh apa-apa.
 */
export function isEphemeralOrigin(origin: string, stableOrigin = STABLE_INSTALL_ORIGIN): boolean {
  let host = "";
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "[::1]") return true;
  // Pratinjau sandbox Freebuff/e2b: hidup selama sesi berjalan saja.
  if (host === "e2b.app" || host.endsWith(".e2b.app")) return true;
  try {
    if (host === new URL(stableOrigin).hostname.toLowerCase()) return false;
  } catch {
    // Alamat tetap yang rusak jangan sampai membuat domain lain ikut dicurigai.
  }
  return false;
}

/** Kalimat peringatan saat aplikasi sedang dibuka dari alamat sementara. */
export function temporaryAddressNotice(stableOrigin = STABLE_INSTALL_ORIGIN): string {
  return `Alamat ini hanya sementara. Pasang aplikasinya dari ${stableOrigin} supaya ikonnya tetap bisa dibuka nanti.`;
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

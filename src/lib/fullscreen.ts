/**
 * Mode layar penuh backstage: sidebar disembunyikan, header tetap ada.
 *
 * Aturannya hidup di satu berkas **murni** karena ada tiga pemakai yang harus
 * menjawab hal yang sama: tombol di `AppLayout`, penyelarasan saat pengguna keluar
 * lewat Esc/F11 (`fullscreenchange`), dan harness.
 *
 * Dua hal yang sengaja dipisahkan:
 *
 * 1. **“Tanpa sidebar” tidak boleh bergantung pada API peramban.** Fullscreen API
 *    bisa ditolak (mis. halaman dibuka di dalam `<iframe>` tanpa
 *    `allow="fullscreen"`) atau tidak ada sama sekali. Karena itu tombolnya
 *    **selalu** menyembunyikan sidebar — itulah yang diminta layar jual — lalu
 *    meminta layar penuh sungguhan sebagai tambahan kalau peramban mendukung.
 * 2. **Header tidak ikut disembunyikan.** Tombol keluar ada di sana; kalau header
 *    ikut hilang, satu-satunya jalan keluar adalah menekan Esc, dan pemakai ponsel
 *    tidak punya tombol itu.
 */

/** Label tombol: menyebut apa yang akan terjadi, bukan keadaan yang sekarang. */
export function fullscreenLabel(active: boolean): string {
  return active ? "Keluar dari layar penuh" : "Layar penuh";
}

export interface FullscreenHintOptions {
  /**
   * Apakah halaman ini punya sidebar yang ikut disembunyikan. Backstage `true`;
   * beranda dan halaman masuk `false` — di sana tombolnya hanya meminta layar
   * penuh peramban, jadi kalimatnya tidak boleh menjanjikan sidebar.
   */
  hasSidebar?: boolean;
}

/** Penjelasan singkat di balik tombol (dipakai `title`). */
export function fullscreenHint(
  active: boolean,
  options: FullscreenHintOptions = {},
): string {
  const hasSidebar = options.hasSidebar ?? true;
  if (active) {
    return hasSidebar
      ? "Sidebar disembunyikan. Tekan tombol ini lagi (atau Esc) untuk memunculkannya kembali."
      : "Mode layar penuh aktif. Tekan tombol ini lagi (atau Esc) untuk keluar.";
  }
  return hasSidebar
    ? "Sembunyikan sidebar dan pakai seluruh lebar layar — cocok untuk kasir & dapur."
    : "Buka halaman ini layar penuh — pas untuk demo atau layar pajang.";
}

/**
 * Sidebar disembunyikan hanya saat mode ini aktif. Dipisah jadi fungsi supaya
 * halaman tidak menebak-nebak: satu nilai menentukan tampilan dan teksnya.
 */
export function sidebarHidden(active: boolean): boolean {
  return active;
}

interface RootLike {
  requestFullscreen?: () => Promise<void> | void;
}

/**
 * Bagian `document` yang dipakai modul ini. Semuanya **opsional**: peramban lama,
 * lingkungan uji, dan dokumen tiruan tidak selalu punya API-nya.
 */
export interface FullscreenDocumentLike {
  fullscreenElement?: unknown;
  exitFullscreen?: () => Promise<void> | void;
  documentElement?: RootLike | null;
}

/**
 * Apakah peramban sedang berada di layar penuh **elemen** (bukan sekadar mode
 * aplikasi). Dipakai untuk menyelaraskan tombol saat pengguna keluar lewat Esc.
 */
export function fullscreenActiveFor(
  doc: FullscreenDocumentLike | null | undefined,
): boolean {
  return Boolean(doc?.fullscreenElement);
}

/**
 * Meminta/mengakhiri layar penuh sungguhan. Mengembalikan `true` kalau permintaan
 * itu diterima peramban.
 *
 * Kegagalan **tidak** dilempar ke pemanggil: yang berarti bagi pemakai adalah
 * sidebar-nya sudah disembunyikan (mode aplikasi), dan itu urusan pemanggil.
 * `exitFullscreen` dipanggil hanya kalau memang ada elemen yang sedang penuh,
 * karena memanggilnya tanpa itu ditolak peramban dan hanya menghasilkan
 * penolakan promise di konsol.
 */
export async function applyFullscreen(
  active: boolean,
  doc: FullscreenDocumentLike | null | undefined,
): Promise<boolean> {
  if (!doc) return false;
  try {
    if (active) {
      const request = doc.documentElement?.requestFullscreen;
      if (typeof request !== "function") return false;
      await request.call(doc.documentElement);
      return true;
    }
    if (!fullscreenActiveFor(doc)) return false;
    const exit = doc.exitFullscreen;
    if (typeof exit !== "function") return false;
    await exit.call(doc);
    return true;
  } catch {
    // Ditolak (izin, iframe, atau tidak didukung): mode aplikasi tetap jalan.
    return false;
  }
}

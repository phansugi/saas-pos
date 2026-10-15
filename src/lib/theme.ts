/**
 * Tema terang/gelap.
 *
 * Aturannya hidup di satu berkas **murni** karena ada tiga pemakai yang harus
 * menjawab hal yang sama: tombol ganti tema di UI, bootstrap di `index.html`
 * (yang berjalan sebelum React demi menghindari kedipan tema), dan harness.
 * Bootstrap itu memang salinan kecil dari aturan ini — harness mengeksekusinya
 * di DOM tiruan lalu membandingkan hasilnya dengan `resolveTheme` di sini,
 * jadi keduanya tidak bisa menyimpang diam-diam.
 *
 * Temanya sendiri hanya satu kelas pada `<html>` (`dark`), sama seperti yang
 * dibaca `tailwind.config.js` (`darkMode: ["class"]`). Palet terang ada di
 * `:root`, palet gelap di `.dark` — jadi "mode terang" = melepas kelas itu.
 */

export type Theme = "light" | "dark";

/** Kunci pilihan pengguna (per perangkat, seperti sesi). */
export const THEME_STORAGE_KEY = "mesinpos.theme.v1";

/** Kelas yang dilekatkan ke `<html>` saat tema gelap aktif. */
export const DARK_CLASS = "dark";

/** Warna bilah browser per tema (`<meta name="theme-color">`). */
export const THEME_COLORS: Record<Theme, string> = {
  dark: "#070A13",
  light: "#FFFFFF",
};

export const THEME_LABELS: Record<Theme, string> = {
  light: "Terang",
  dark: "Gelap",
};

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * Pilihan tersimpan menang; kalau pengguna belum pernah memilih, ikuti
 * preferensi sistem. Bawaannya tetap **gelap** supaya pengunjung baru melihat
 * tampilan yang sama dengan beranda publik yang sudah dikenal.
 */
export function resolveTheme(stored: unknown, prefersLight: boolean): Theme {
  if (isTheme(stored)) return stored;
  return prefersLight ? "light" : "dark";
}

export function nextTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/** Apakah sistem pengguna meminta tema terang? (`false` kalau tidak diketahui.) */
export function systemPrefersLight(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Baca pilihan tersimpan; nilai asing/rusak diperlakukan sebagai "belum memilih". */
export function readStoredTheme(storage: StorageLike | null | undefined): Theme | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    // Mode privat bisa melempar saat membaca; tema tetap jalan tanpa simpanan.
    return null;
  }
}

export function writeStoredTheme(
  storage: StorageLike | null | undefined,
  theme: Theme,
): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Penyimpanan penuh/diblokir: pilihan tetap berlaku untuk sesi ini.
  }
}

interface RootLike {
  classList: {
    add(...tokens: string[]): void;
    remove(...tokens: string[]): void;
  };
}

interface MetaLike {
  setAttribute(name: string, value: string): void;
}

export interface ThemeTargets {
  root: RootLike;
  /** `<meta name="theme-color">`, kalau ada — bilah browser ikut berubah. */
  meta?: MetaLike | null;
}

/** Melekatkan tema ke `<html>` dan menyelaraskan warna bilah browser. */
export function applyTheme(theme: Theme, targets: ThemeTargets): void {
  if (theme === "dark") {
    targets.root.classList.add(DARK_CLASS);
  } else {
    targets.root.classList.remove(DARK_CLASS);
  }
  targets.meta?.setAttribute("content", THEME_COLORS[theme]);
}

/** Label tombol: menyebut tema yang akan **dituju**, bukan yang sedang aktif. */
export function toggleLabel(current: Theme): string {
  return current === "dark" ? "Ganti ke tema terang" : "Ganti ke tema gelap";
}

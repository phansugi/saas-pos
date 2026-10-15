/**
 * Tombol menu (burger) di header backstage: kapan ia harus muncul, dan apa yang
 * terjadi pada sidebar saat ditekan.
 *
 * Aturannya hidup di berkas **murni** karena satu tombol harus melayani **dua
 * sebab** yang berbeda, dan keduanya harus dijawab dengan cara yang sama oleh
 * header, sidebar, dan harness:
 *
 *   1. **Mode layar penuh** (`@/lib/fullscreen`). Sidebar memang disembunyikan di
 *      semua lebar layar — kalau tombolnya tidak ada di situ, satu-satunya jalan
 *      memunculkan menu adalah keluar dari layar penuh dulu.
 *   2. **Layar kecil.** Sidebar hanya tampil mulai breakpoint `lg`, jadi di bawah
 *      itu menu tidak punya jalan masuk sama sekali. Ini **tidak bisa** ditanya
 *      ke JavaScript (lebar viewport ≠ lebar layout saat bilah alamat muncul),
 *      jadi jejaknya kelas Tailwind `lg:hidden` yang dipasang hanya saat layar
 *      penuh tidak aktif — bukan `window.innerWidth` yang bisa salah menebak.
 *
 * Sidebar-nya sendiri punya tiga keadaan, bukan dua: statik (di layar lebar),
 * panel melayang di atas isi (dibuka dari tombol menu), atau sembunyi total.
 * Yang ketiga itulah mode layar penuh tanpa tombol ditekan.
 */

// Impor relatif (bukan alias `@/`) supaya modul murni ini juga bisa dimuat
// langsung oleh harness tanpa bundler.
import { sidebarHidden } from "./fullscreen";

/** Apakah tombol menu muncul di semua lebar layar atau hanya di layar kecil. */
export type SidebarMenuReach = "always" | "small-screens";

/**
 * Layar penuh → tombolnya harus ada di lebar mana pun (sidebar memang mati di
 * sana). Selain itu cukup di bawah breakpoint `lg`, tempat sidebar statiknya
 * hilang.
 */
export function sidebarMenuReach(fullscreen: boolean): SidebarMenuReach {
  return fullscreen ? "always" : "small-screens";
}

/**
 * Kelas tombolnya. `lg:hidden` di sini **bukan** gaya: itu satu-satunya cara
 * tombolnya tahu bahwa sidebar statiknya sudah tampil kembali di layar lebar.
 */
export function sidebarMenuButtonClass(fullscreen: boolean): string {
  return sidebarMenuReach(fullscreen) === "always"
    ? "inline-flex"
    : "inline-flex lg:hidden";
}

/** Tiga keadaan sidebar backstage. */
export type SidebarMode = "static" | "drawer" | "hidden";

/**
 * Keadaan sidebar: dibuka dari tombol menu → panel melayang; kalau tidak, ia
 * mengikuti mode layar penuh (sembunyi) atau tampil normal seperti sebelumnya.
 */
export function sidebarMode(input: { fullscreen: boolean; open: boolean }): SidebarMode {
  if (input.open) return "drawer";
  return sidebarHidden(input.fullscreen) ? "hidden" : "static";
}

/**
 * Panel melayang dimulai **di bawah header** (`top-16` = tinggi header `h-16`),
 * bukan dari tepi atas layar. Itu bukan soal selera: tombol menu yang membukanya
 * ada di header, dan panel setinggi layar akan **menutupi tombolnya sendiri** —
 * di peramban sungguhan, klik kedua pada tombol itu tertelan panelnya (terbukti
 * lewat `verify-browser-menu.mjs`: “aside subtree intercepts pointer events”).
 * Dengan dimulai di bawah header, panelnya tetap bisa ditutup dengan tombol,
 * latar, atau Esc — tiga cara, bukan cuma satu.
 */
const DRAWER_BASE = "flex fixed left-0 top-16 bottom-0 z-40 w-64 shadow-2xl";

/**
 * Kelas display & posisi sidebar untuk keadaannya. Sengaja bercabang — **satu**
 * kelas display per keadaan — karena dua kelas display di layer yang sama
 * membuat pemenangnya bergantung urutan CSS, bukan urutan penulisannya (catatan
 * yang sama dengan `sidebar-surface` di `AppLayout`).
 *
 * Di layar penuh panelnya tetap melayang di semua lebar (sidebar statiknya
 * memang sedang dimatikan), sedangkan di luar layar penuh ia kembali menjadi
 * sidebar biasa begitu lebarnya cukup: pengguna yang memperbesar jendela tidak
 * terjebak dengan panel melayang dan halaman yang tertutup.
 */
export function sidebarClass(input: { fullscreen: boolean; open: boolean }): string {
  const mode = sidebarMode(input);
  if (mode === "hidden") return "hidden";
  if (mode === "static") return "hidden lg:flex";
  return input.fullscreen ? DRAWER_BASE : `${DRAWER_BASE} lg:static lg:z-auto lg:shadow-none`;
}

/**
 * Latar gelap yang menutup halaman saat panelnya terbuka. Ia ikut hilang di
 * layar lebar (di luar layar penuh) karena di sana sidebar-nya sudah menjadi
 * statik lagi — tanpa itu, lapisan ini justru memblokir halaman yang sedang
 * dipakai.
 *
 * Latarnya menutupi seluruh layar (termasuk di belakang header), jadi header-nya
 * harus berada **di atas** latar ini supaya tombol menu — satu-satunya jalan
 * menutup panel di HP — tidak ikut tertutup. Itu sebabnya `AppLayout` memasang
 * `relative z-40` di header-nya (`z-30` di sini, panelnya `z-40`).
 */
export function sidebarBackdropClass(fullscreen: boolean): string {
  return fullscreen
    ? "fixed inset-0 z-30 bg-foreground/40 backdrop-blur-sm"
    : "fixed inset-0 z-30 bg-foreground/40 backdrop-blur-sm lg:hidden";
}

/** Label tombol: menyebut apa yang akan terjadi, bukan keadaan sekarang. */
export function sidebarMenuLabel(open: boolean): string {
  return open ? "Tutup menu" : "Buka menu";
}

/** Penjelasan singkat di balik tombol (dipakai `title`). */
export function sidebarMenuHint(open: boolean): string {
  return open
    ? "Tutup menu navigasi. Bisa juga dengan Esc atau menekan halaman di sebelahnya."
    : "Buka menu navigasi — sidebar disembunyikan di layar kecil dan di mode layar penuh.";
}

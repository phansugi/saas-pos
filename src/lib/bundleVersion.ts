/**
 * Bundel situs: mana yang **sedang berjalan**, mana yang **sudah disajikan**.
 *
 * Kenapa ada: aplikasi ini SPA sekaligus PWA, jadi tab yang sudah terbuka tetap
 * menjalankan JavaScript lama setelah deploy berikutnya — dan service worker
 * (`public/sw.js`) bahkan menyimpan `/assets/*`, sehingga halaman lama bisa
 * hidup terus walau situsnya sudah berganti. Gejalanya pernah nyata di produksi:
 * `[CONVEX Q(products:listAll)] Akses ditolak: peran cashier …` datang dari
 * klien yang belum memuat perbaikan (lihat README). SPA hanya berpindah versi
 * lewat **muat ulang halaman**, jadi pengguna perlu diberi tahu kapan saatnya.
 *
 * Isinya sengaja murni — tanpa DOM, `fetch`, atau timer — karena bagian yang
 * paling mudah salah bukan pemanggilannya, melainkan keputusannya: berkas mana
 * yang dihitung sebagai “bundel”, kapan perbedaannya berarti “deploy baru”, dan
 * kapan ajakannya **tidak boleh** muncul (mode dev, luring, sudah ditutup
 * pengguna). Komponen `src/components/NewVersionNotice.tsx` yang menyambungkannya
 * ke halaman, dan `scripts/verify-version.mjs` menguji keduanya.
 */

/** Dokumen yang dibandingkan. Penanda waktu `?v=…` ditambahkan saat memeriksa. */
export const INDEX_URL = "/index.html";

/** Pemeriksaan pertama — beri ruang supaya render & data awal tidak berebut. */
export const VERSION_FIRST_CHECK_MS = 45_000;

/** Selang pemeriksaan berikutnya; deploy baru tidak perlu diketahui seketika. */
export const VERSION_CHECK_INTERVAL_MS = 5 * 60_000;

/**
 * Kunci catatan “Nanti” — per **tab** (`sessionStorage`), bukan per perangkat:
 * yang ditolak adalah pemuatan ulang di tab ini, bukan di seluruh perangkat.
 */
export const VERSION_DISMISS_KEY = "mesinpos.versi.v1";

/**
 * Nama berkas entry yang diberikan Vite ke bundel aplikasi: `index-<hash>.js`.
 *
 * Bentuk lain sengaja **bukan** bundel: `/src/main.tsx` (mode dev) dan berkas
 * CSS. Akibatnya mode dev tidak pernah menampilkan ajakan — memang tidak ada
 * versi yang bisa basi di sana, karena setiap berkas disajikan ulang.
 */
const ENTRY_BUNDLE_NAME = /^index-[A-Za-z0-9_-]+\.js$/;

const SCRIPT_WITH_SRC = /<script\b[^>]*\bsrc=["']([^"']+)["']/gi;

/** `assets/index-BRNyf2qd.js` → `index-BRNyf2qd.js`; bentuk lain → `null`. */
export function bundleFileName(src: string | null | undefined): string | null {
  if (typeof src !== "string" || src.length === 0) return null;
  const path = src.split("?")[0].split("#")[0];
  const name = path.slice(path.lastIndexOf("/") + 1);
  return ENTRY_BUNDLE_NAME.test(name) ? name : null;
}

/** Bundel yang **sedang berjalan**: script modul di dokumen yang memuat aplikasi. */
export function runningBundleFile(doc: Document | null | undefined): string | null {
  if (!doc || typeof doc.querySelectorAll !== "function") return null;
  for (const element of doc.querySelectorAll('script[type="module"][src]')) {
    const file = bundleFileName(element.getAttribute("src"));
    if (file) return file;
  }
  return null;
}

/** Bundel yang **sudah disajikan** situs, dibaca dari HTML `index.html` terbaru. */
export function bundleFileFromHtml(html: string | null | undefined): string | null {
  if (typeof html !== "string" || html.length === 0) return null;
  for (const match of html.matchAll(SCRIPT_WITH_SRC)) {
    const file = bundleFileName(match[1]);
    if (file) return file;
  }
  return null;
}

/**
 * Dokumen ini tertinggal satu versi? Kedua sisinya harus terbaca lebih dulu:
 * tanpa nama pembanding, perbedaan tidak bisa disimpulkan — dan menebak di sini
 * berarti menampilkan ajakan yang salah.
 */
export function isOlderBundle(running: string | null, latest: string | null): boolean {
  return running !== null && latest !== null && running !== latest;
}

/**
 * Ajakan tampil? “Nanti” menyimpan **nama bundel** yang ditolak, jadi menolak
 * satu versi tidak membungkam versi berikutnya.
 */
export function shouldAnnounceVersion(input: {
  running: string | null;
  latest: string | null;
  dismissed: string | null;
}): boolean {
  return isOlderBundle(input.running, input.latest) && input.dismissed !== input.latest;
}

/** Catatan “Nanti” dipercaya hanya kalau bentuknya memang nama bundel. */
export function readDismissedBundle(raw: string | null | undefined): string | null {
  return typeof raw === "string" && ENTRY_BUNDLE_NAME.test(raw) ? raw : null;
}

/**
 * Kata-kata ajakan. Kalimatnya menyuruh **menyelesaikan transaksi yang sedang
 * terbuka** lebih dulu karena itulah kerugian nyata memuat ulang mendadak di
 * aplikasi kasir: keranjang yang belum disimpan ikut hilang.
 */
export const NEW_VERSION_TEXT = {
  title: "Versi baru tersedia — muat ulang",
  body: "Tab ini masih menjalankan kode lama dari halaman yang dibuka sebelumnya. Selesaikan dulu transaksi yang sedang terbuka, lalu muat ulang supaya perbaikan dan fitur terbaru ikut terpakai.",
  confirm: "Muat ulang sekarang",
  later: "Nanti",
  label: "Kabar versi aplikasi",
} as const;

/**
 * Baris rincian: bundel mana yang berjalan, bundel mana yang sudah disajikan.
 * Ditampilkan di layar supaya laporan pengguna bisa menyebut berkasnya — sama
 * seperti yang diminta README saat menelusuri error dari klien lama.
 */
export function versionDetail(running: string | null, latest: string | null): string {
  return `Sedang berjalan: ${running ?? "—"} · Terbaru di situs: ${latest ?? "—"}`;
}

/**
 * Memuat ulang halaman — satu-satunya cara SPA berpindah bundel. Ditaruh di sini
 * supaya ada **satu** tempat yang tahu caranya, dan harness bisa menggantinya.
 */
export function reloadPage(target: { reload(): void } | null | undefined): void {
  target?.reload();
}

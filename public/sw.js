/**
 * Service worker MesinPOS — yang membuat aplikasi bisa dipasang dan tetap
 * terbuka saat offline.
 *
 * Kebijakannya sengaja **sempit**, karena berkas ini juga hidup di deployment
 * pengembangan (Vite dev server) dan di preview:
 *
 *  - Navigasi (`request.mode === "navigate"`) → **network-first**, dengan
 *    cadangan `/index.html` yang tersimpan supaya aplikasi tetap terbuka saat
 *    offline. Network-first berarti kode terbaru selalu menang — tidak ada
 *    halaman dev yang basi.
 *  - Aset statis hasil build (`/assets/`, ikon, manifest, favicon) →
 *    cache dulu lalu perbarui di belakang (stale-while-revalidate).
 *  - **Semua sisanya lewat begitu saja**: `/src/…`, `/@vite/…`, `/node_modules/…`
 *    (modul dev), permintaan tulis (POST), dan seluruh permintaan lintas origin
 *    (Convex). Yang tidak pernah dicache tidak bisa menjadi basi — inilah yang
 *    menjaga pengembangan dan sinkronisasi tetap jujur.
 *
 * Berkas ini disajikan apa adanya (bukan dibundel), jadi ia berdiri sendiri:
 * tidak ada impor dari `src/`. Harness `scripts/verify-pwa.mjs` mengeksekusi
 * berkas ini dengan `caches`/`fetch` tiruan untuk membuktikan keempat aturan di
 * atas, bukan sekadar membacanya.
 */

const CACHE_VERSION = "mesinpos-shell-v1";
const SHELL_URL = "/index.html";
const STATIC_PREFIXES = [
  "/assets/",
  "/icon",
  "/manifest",
  "/apple-touch-icon",
  "/favicon",
];

function isShellAsset(url) {
  if (url.origin !== self.location.origin) return false;
  return STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Cangkang aplikasi disimpan lebih dulu; kalau salah satu gagal (mis.
      // deployment belum punya berkasnya), instalasi tetap lanjut — service
      // worker yang gagal total justru mematikan pemasangan PWA-nya.
      for (const url of [SHELL_URL, "/manifest.webmanifest"]) {
        try {
          await cache.add(url);
        } catch {
          // Diabaikan dengan sengaja: dicoba lagi saat navigasi berikutnya.
        }
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Navigasi: jaringan dulu, cangkang tersimpan sebagai cadangan saat offline. */
async function handleNavigation(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response && response.ok) await cache.put(SHELL_URL, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(SHELL_URL);
    if (cached) return cached;
    throw error;
  }
}

/** Aset build: salinan tersimpan dipakai lebih dulu, lalu diperbarui diam-diam. */
async function handleStatic(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response && response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Tulis apa pun (POST/PUT) tidak pernah disentuh — data transaksi tidak boleh
  // dilayani dari cache.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (isShellAsset(url)) {
    event.respondWith(handleStatic(request));
  }
});

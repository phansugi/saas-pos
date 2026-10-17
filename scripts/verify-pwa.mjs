/**
 * PWA: manifest layar penuh, ikon, service worker, dan ajakan pemasangan.
 *
 * Kenapa ada: hampir semua bagian PWA "kelihatan benar" tanpa benar-benar
 * bekerja — manifest yang tidak dipasang di `index.html`, ikon yang ukurannya
 * tidak sesuai, service worker yang mencuri modul dev sampai aplikasinya basi,
 * atau ajakan yang muncul di kunjungan kesepuluh alih-alih pertama. Karena itu
 * harness ini **menjalankan** yang biasanya cuma dibaca:
 *
 *   1. aturan murni ajakan (jeda 10 detik, sekali tampil, tombol setelah itu),
 *   2. manifest: `display: fullscreen`, ikon 192/512 + maskable, warna yang sama
 *      dengan `src/lib/theme.ts`, dan setiap berkas ikonnya benar-benar ada,
 *   3. ikon PNG diperiksa sampai isinya (CRC chunk, jumlah baris, piksel sudut, dan
 *      warna mark brand-nya: hijau merek di atas bidang gelap aplikasi),
 *   4. `public/sw.js` **dieksekusi** dengan `caches`/`fetch` tiruan — navigasi
 *      network-first, aset build tersimpan, `/src/…` & lintas origin & POST tidak
 *      pernah disentuh,
 *   5. perilaku di DOM: ajakan muncul tepat setelah jeda pada kunjungan pertama,
 *      tombol pemasangan muncul di header beranda setelah ajakan ditutup, dan
 *      tidak ada keduanya saat aplikasinya sudah terpasang.
 *
 * Usage: bun scripts/verify-pwa.mjs
 */
import "./happy-dom-setup.mjs";
import { readFileSync, statSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { createServer } from "vite";

const window = globalThis.window;
const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router-dom");

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// Animasi beranda (framer-motion) dibatalkan saat pohonnya dilepas; happy-dom
// melaporkan pembatalan itu sebagai rejection tanpa penangkap. Itu bagian normal
// dari membongkar render — bukan kegagalan uji — jadi AbortError diabaikan,
// sementara rejection lain tetap dilempar supaya tidak ada galat yang diam.
process.on("unhandledRejection", (reason) => {
  if (reason?.name === "AbortError") return;
  throw reason;
});

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}
function bytes(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url));
}
function exists(path) {
  try {
    return statSync(new URL(`../${path}`, import.meta.url)).isFile();
  } catch {
    return false;
  }
}

const ORIGIN = "https://mesinpos.test";

// ── Pembaca PNG: cukup untuk membuktikan berkasnya sah & isinya benar ────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function readPng(path) {
  const data = bytes(path);
  check(`${path}: punya signature PNG`, data.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ), data.subarray(0, 8).toString("hex"));
  let pos = 8;
  let width = 0;
  let height = 0;
  let idat = Buffer.alloc(0);
  const types = [];
  while (pos < data.length) {
    const length = data.readUInt32BE(pos);
    const type = data.subarray(pos + 4, pos + 8).toString("ascii");
    const body = data.subarray(pos + 8, pos + 8 + length);
    const crc = data.readUInt32BE(pos + 8 + length);
    check(`${path}: CRC chunk ${type} sah`, crc32(data.subarray(pos + 4, pos + 8 + length)) === crc, type);
    types.push(type);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      check(`${path}: kedalaman & tipe warna RGBA 8-bit`, body[8] === 8 && body[9] === 6, `${body[8]}/${body[9]}`);
    }
    if (type === "IDAT") idat = Buffer.concat([idat, body]);
    pos += 12 + length;
  }
  check(`${path}: chunk lengkap (IHDR…IEND)`, types[0] === "IHDR" && types.at(-1) === "IEND", types.join(","));
  const raw = inflateSync(idat);
  const stride = width * 4;
  check(`${path}: jumlah baris gambar sesuai`, raw.length === height * (stride + 1), `${raw.length} vs ${height * (stride + 1)}`);
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    check(`${path}: baris ${y} tanpa filter`, raw[y * (stride + 1)] === 0, String(raw[y * (stride + 1)]));
    rows.push(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
  }
  return {
    width,
    height,
    pixel: (x, y) => [...rows[y].subarray(x * 4, x * 4 + 4)],
  };
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

let failure = null;

try {
  const pwa = await server.ssrLoadModule("/src/lib/pwa.ts");
  const theme = await server.ssrLoadModule("/src/lib/theme.ts");

  // ── 1. Aturan murni ajakan ───────────────────────────────────────────────
  check(
    "jeda ajakan tepat 10 detik",
    pwa.INSTALL_PROMPT_DELAY_MS === 10_000,
    `${pwa.INSTALL_PROMPT_DELAY_MS} ms`,
  );
  check(
    "kunci catatan pemasangan dipakai konsisten",
    pwa.INSTALL_STORAGE_KEY === "mesinpos.install.v1",
    pwa.INSTALL_STORAGE_KEY,
  );

  const first = pwa.startInstallRecord(new Date("2026-10-12T09:00:00.000Z"));
  check(
    "kunjungan pertama: belum pernah diundang & belum ditutup",
    first.invitedAt === null && first.dismissedAt === null && first.firstSeenAt === "2026-10-12T09:00:00.000Z",
    JSON.stringify(first),
  );
  check(
    "ajakan berhak tampil pada kunjungan pertama",
    pwa.shouldOfferInvite(first, false) && !pwa.shouldOfferInvite(first, true),
    "shouldOfferInvite",
  );
  const invited = pwa.markInvited(first, new Date("2026-10-12T09:00:10.000Z"));
  check(
    "ajakan tidak diulang setelah pernah tampil",
    invited.invitedAt === "2026-10-12T09:00:10.000Z" && !pwa.shouldOfferInvite(invited, false),
    JSON.stringify(invited),
  );
  check(
    "waktu tampil pertama tidak ditimpa panggilan berikutnya",
    pwa.markInvited(invited, new Date("2026-10-12T10:00:00.000Z")).invitedAt === invited.invitedAt,
    "invitedAt stabil",
  );
  check(
    "tanpa catatan tidak ada ajakan (halaman yang belum mencatat kunjungan)",
    !pwa.shouldOfferInvite(null, false),
    "record null",
  );

  const dismissed = pwa.markDismissed(invited, new Date("2026-10-12T09:00:20.000Z"));
  check(
    "penutupan ajakan dicatat",
    dismissed.dismissedAt === "2026-10-12T09:00:20.000Z",
    JSON.stringify(dismissed),
  );
  check(
    "tombol header muncul setelah ajakan pernah tampil",
    !pwa.shouldShowInstallButton(first, { installed: false, inviteOpen: false }) &&
      pwa.shouldShowInstallButton(invited, { installed: false, inviteOpen: false }) &&
      pwa.shouldShowInstallButton(dismissed, { installed: false, inviteOpen: false }),
    "shouldShowInstallButton",
  );
  check(
    "tombol header disembunyikan saat ajakan terbuka atau sudah terpasang",
    !pwa.shouldShowInstallButton(dismissed, { installed: false, inviteOpen: true }) &&
      !pwa.shouldShowInstallButton(dismissed, { installed: true, inviteOpen: false }),
    "shouldShowInstallButton",
  );

  const serialized = pwa.serializeInstallRecord(dismissed);
  check(
    "catatan bertahan setelah ditulis & dibaca lagi",
    JSON.stringify(pwa.readInstallRecord(serialized)) === JSON.stringify(dismissed),
    serialized,
  );
  check(
    "catatan rusak diperlakukan sebagai pengunjung baru",
    pwa.readInstallRecord("bukan json") === null &&
      pwa.readInstallRecord('{"invitedAt":"2026-10-12T09:00:10.000Z"}') === null &&
      pwa.readInstallRecord(null) === null,
    "readInstallRecord",
  );

  check(
    "deteksi terpasang: layar penuh, standalone, atau penanda iOS",
    pwa.isInstalled({ fullscreen: true, standalone: false, iosStandalone: false }) &&
      pwa.isInstalled({ fullscreen: false, standalone: true, iosStandalone: false }) &&
      pwa.isInstalled({ fullscreen: false, standalone: false, iosStandalone: true }) &&
      !pwa.isInstalled({ fullscreen: false, standalone: false, iosStandalone: false }),
    "isInstalled",
  );
  check(
    "deteksi terpasang juga menangkap mode cadangan peramban (minimal-ui & overlay)",
    pwa.isInstalled({
      fullscreen: false,
      standalone: false,
      iosStandalone: false,
      minimalUi: true,
    }) &&
      pwa.isInstalled({
        fullscreen: false,
        standalone: false,
        iosStandalone: false,
        windowControlsOverlay: true,
      }),
    "isInstalled (mode cadangan)",
  );
  check(
    "mode tampilan yang diperiksa satu daftar dengan yang divalidasi manifest",
    pwa.INSTALLED_DISPLAY_MODES.includes("fullscreen") &&
      pwa.INSTALLED_DISPLAY_MODES.includes("standalone") &&
      pwa.INSTALLED_DISPLAY_MODES.length === 4,
    pwa.INSTALLED_DISPLAY_MODES.join(","),
  );
  const installPromptSource = read("src/components/InstallPrompt.tsx");
  check(
    "komponen benar-benar memeriksa setiap mode tampilan di daftar itu",
    pwa.INSTALLED_DISPLAY_MODES.every((mode) =>
      installPromptSource.includes(`media("${mode}")`),
    ),
    pwa.INSTALLED_DISPLAY_MODES.join(","),
  );

  // ── Catatan “perangkat ini sudah memasang” ───────────────────────────────
  const terpasang = pwa.markInstalled(dismissed, new Date("2026-10-12T09:05:00.000Z"));
  check(
    "bukti pemasangan dicatat di catatan perangkat",
    terpasang.installedAt === "2026-10-12T09:05:00.000Z",
    JSON.stringify(terpasang),
  );
  check(
    "waktu pemasangan tidak ditimpa panggilan berikutnya",
    pwa.markInstalled(terpasang, new Date("2026-10-12T11:00:00.000Z")).installedAt ===
      terpasang.installedAt,
    "installedAt stabil",
  );
  check(
    "perangkat yang sudah memasang tidak ditawari lagi (ajakan maupun tombol)",
    !pwa.shouldOfferInvite(terpasang, false) &&
      !pwa.shouldShowInstallButton(terpasang, { installed: false, inviteOpen: false }),
    JSON.stringify(terpasang),
  );
  check(
    "catatan lama (sebelum kolom pemasangan ada) tetap sah & tidak menyembunyikan tombol",
    pwa.readInstallRecord(JSON.stringify(dismissed))?.installedAt === null &&
      pwa.shouldShowInstallButton(dismissed, { installed: false, inviteOpen: false }),
    JSON.stringify(pwa.readInstallRecord(JSON.stringify(dismissed))),
  );
  check(
    "catatan pemasangan bertahan setelah ditulis & dibaca lagi",
    pwa.readInstallRecord(pwa.serializeInstallRecord(terpasang))?.installedAt ===
      "2026-10-12T09:05:00.000Z",
    pwa.serializeInstallRecord(terpasang),
  );
  check(
    "batal dipasang membuang bukti itu supaya tombolnya bisa kembali",
    pwa.markNotInstalled(terpasang).installedAt === null &&
      pwa.shouldShowInstallButton(pwa.markNotInstalled(terpasang), {
        installed: false,
        inviteOpen: false,
      }),
    JSON.stringify(pwa.markNotInstalled(terpasang)),
  );
  check(
    "jawaban getInstalledRelatedApps dibaca: daftar berisi = terpasang",
    pwa.installedFromRelatedApps([{ id: "/", platform: "webapp" }]) &&
      !pwa.installedFromRelatedApps([]) &&
      !pwa.installedFromRelatedApps(null) &&
      !pwa.installedFromRelatedApps(undefined),
    "installedFromRelatedApps",
  );
  check(
    "alamat tetap untuk memasang aplikasinya disebut apa adanya",
    pwa.STABLE_INSTALL_ORIGIN === "https://mesinpos.freebuff.app",
    pwa.STABLE_INSTALL_ORIGIN,
  );
  check(
    "alamat sementara dikenali: localhost, IP loopback, dan pratinjau *.e2b.app",
    pwa.isEphemeralOrigin("http://localhost:5173") &&
      pwa.isEphemeralOrigin("https://5173-abc123.e2b.app") &&
      pwa.isEphemeralOrigin("http://127.0.0.1:4173"),
    [
      pwa.isEphemeralOrigin("http://localhost:5173"),
      pwa.isEphemeralOrigin("https://5173-abc123.e2b.app"),
      pwa.isEphemeralOrigin("http://127.0.0.1:4173"),
    ].join(","),
  );
  check(
    "alamat tetap, domain biasa, & alamat rusak tidak dituduh sementara",
    !pwa.isEphemeralOrigin(pwa.STABLE_INSTALL_ORIGIN) &&
      !pwa.isEphemeralOrigin("https://tokosaya.id") &&
      !pwa.isEphemeralOrigin("bukan-alamat"),
    [
      pwa.isEphemeralOrigin(pwa.STABLE_INSTALL_ORIGIN),
      pwa.isEphemeralOrigin("https://tokosaya.id"),
      pwa.isEphemeralOrigin("bukan-alamat"),
    ].join(","),
  );
  check(
    "peringatan alamat sementara menyebut alamat tetap yang harus dipakai",
    pwa.temporaryAddressNotice().includes(pwa.STABLE_INSTALL_ORIGIN) &&
      pwa.temporaryAddressNotice("https://contoh.test").includes("https://contoh.test"),
    pwa.temporaryAddressNotice(),
  );
  check(
    "service worker hanya didaftarkan kalau browsernya mendukung",
    pwa.supportsServiceWorker({ serviceWorker: {} }) &&
      !pwa.supportsServiceWorker({}) &&
      !pwa.supportsServiceWorker(null),
    "supportsServiceWorker",
  );
  check(
    "iOS dikenali (termasuk iPad yang menyamar sebagai Mac)",
    pwa.looksLikeIos("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5) &&
      pwa.looksLikeIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5) &&
      !pwa.looksLikeIos("Mozilla/5.0 (Linux; Android 14; Pixel 8)", 5),
    "looksLikeIos",
  );
  check(
    "petunjuk manual berbeda untuk iOS dan Android",
    pwa.manualInstallSteps(true).join(" ").includes("Layar Utama") &&
      pwa.manualInstallSteps(false).join(" ").includes("Pasang aplikasi"),
    `${pwa.manualInstallSteps(true)[1]} / ${pwa.manualInstallSteps(false)[1]}`,
  );

  // ── 2. Manifest ──────────────────────────────────────────────────────────
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  check(
    "manifest terbuka penuh (fullscreen) dengan cadangan standalone",
    manifest.display === "fullscreen" && manifest.display_override?.includes("fullscreen"),
    `${manifest.display} / ${manifest.display_override}`,
  );
  check(
    "manifest merujuk dirinya sendiri supaya peramban bisa ditanya “sudah terpasang?”",
    Array.isArray(manifest.related_applications) &&
      manifest.related_applications.length === 1 &&
      manifest.related_applications[0].platform === "webapp" &&
      manifest.related_applications[0].url === "/manifest.webmanifest" &&
      manifest.related_applications[0].id === "/",
    JSON.stringify(manifest.related_applications),
  );
  check(
    "rujukan diri itu tidak mematikan pemasangan aplikasi ini sendiri",
    manifest.prefer_related_applications !== true,
    String(manifest.prefer_related_applications),
  );
  check(
    "manifest berlingkup satu aplikasi (start_url & scope)",
    manifest.start_url === "/" && manifest.scope === "/" && manifest.id === "/",
    `${manifest.start_url} · ${manifest.scope}`,
  );
  check(
    "nama & bahasa manifest jelas",
    manifest.name.includes("MesinPOS") &&
      manifest.short_name === "MesinPOS" &&
      manifest.lang === "id",
    `${manifest.short_name} (${manifest.lang})`,
  );
  check(
    "warna manifest sama dengan tema aplikasi",
    manifest.theme_color.toUpperCase() === pwa.PWA_THEME_COLOR.toUpperCase() &&
      manifest.background_color.toUpperCase() === pwa.PWA_BACKGROUND_COLOR.toUpperCase() &&
      manifest.background_color.toUpperCase() === theme.THEME_COLORS.dark.toUpperCase(),
    `${manifest.theme_color} / ${manifest.background_color}`,
  );

  const iconSizes = (manifest.icons ?? []).map((icon) => `${icon.sizes}:${icon.purpose ?? "any"}`);
  check(
    "manifest memuat ikon 192, 512, dan maskable 512",
    iconSizes.includes("192x192:any") &&
      iconSizes.includes("512x512:any") &&
      iconSizes.includes("512x512:maskable"),
    iconSizes.join(" · "),
  );
  check(
    "manifest memuat ikon vektor untuk layar apa pun",
    (manifest.icons ?? []).some(
      (icon) => icon.type === "image/svg+xml" && icon.sizes === "any",
    ),
    iconSizes.join(" · "),
  );
  check(
    "ikon raster didahulukan & SVG di belakang — Android membuat aplikasinya dari PNG",
    manifest.icons?.[0]?.type === "image/png" &&
      manifest.icons?.at(-1)?.type === "image/svg+xml",
    (manifest.icons ?? []).map((icon) => icon.type).join(" → "),
  );
  for (const icon of manifest.icons ?? []) {
    check(`berkas ikon manifest ada: ${icon.src}`, exists(`public${icon.src}`), icon.src);
  }
  check(
    "pintasan manifest menuju rute aplikasi yang ada",
    (manifest.shortcuts ?? []).length >= 3 &&
      manifest.shortcuts.every((shortcut) => shortcut.url.startsWith("/app/")),
    (manifest.shortcuts ?? []).map((shortcut) => shortcut.url).join(" · "),
  );

  const icon192 = readPng("public/icon-192.png");
  const icon512 = readPng("public/icon-512.png");
  const maskable = readPng("public/icon-maskable-512.png");
  const apple = readPng("public/apple-touch-icon.png");
  check(
    "ukuran berkas ikon sesuai yang dijanjikan manifest",
    icon192.width === 192 && icon192.height === 192 &&
      icon512.width === 512 && icon512.height === 512 &&
      maskable.width === 512 && maskable.height === 512,
    `${icon192.width} · ${icon512.width} · ${maskable.width}`,
  );
  check(
    "ikon sudut membulat transparan (siap dipasang di layar utama)",
    icon192.pixel(1, 1)[3] === 0 && icon512.pixel(1, 1)[3] === 0,
    `alpha=${icon192.pixel(1, 1)[3]}`,
  );
  // Ikonnya adalah **mark brand aplikasi**: mark `store` (sumber yang sama dengan
  // sidebar/beranda) digambar hijau merek di atas bidang gelap aplikasi. Keduanya
  // diperiksa dari pikselnya, bukan dari komentar di generatornya.
  const INK = [7, 10, 19];
  const BRAND = [32, 197, 137];
  const countPixels = (png, color) => {
    let total = 0;
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const pixel = png.pixel(x, y);
        if (pixel[3] === 255 && pixel.slice(0, 3).join() === color.join()) total += 1;
      }
    }
    return total;
  };
  const icons = [icon192, icon512, maskable, apple];
  const markPixels = icons.map((png) => countPixels(png, BRAND));
  check(
    "ikon maskable terisi penuh dengan bidang gelap aplikasi (tidak ada sudut kosong yang dipotong Android)",
    maskable.pixel(1, 1)[3] === 255 &&
      maskable.pixel(1, 1).slice(0, 3).join() === INK.join(),
    maskable.pixel(1, 1).join(),
  );
  check(
    "ikon Apple memakai latar penuh & ukuran 180",
    apple.width === 180 &&
      apple.pixel(1, 1)[3] === 255 &&
      apple.pixel(1, 1).slice(0, 3).join() === INK.join(),
    `${apple.width} ${apple.pixel(1, 1).join()}`,
  );
  check(
    "mark brand tergambar hijau merek di setiap ikon (bukan bidang kosong)",
    markPixels.every((total) => total > 0),
    icons.map((png, index) => `${png.width}px:${markPixels[index]} piksel mark`).join(" · "),
  );
  check(
    "ikon vektor memakai mark & warna merek yang sama, di kanvas 512",
    read("public/icon.svg").includes("#20C589") &&
      read("public/icon.svg").includes('viewBox="0 0 512 512"') &&
      read("public/icon.svg").includes("#070A13") &&
      // Jalur pintu mark `store` (lucide): bukti favicon-nya memakai mark yang
      // sama dengan `scripts/gen-icons.mjs`, bukan bentuk lain.
      read("public/icon.svg").includes("M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"),
    "icon.svg",
  );

  // ── 3. index.html & main.tsx: PWA benar-benar dipasang ───────────────────
  const html = read("index.html");
  check(
    "index.html menautkan manifest",
    /<link rel="manifest" href="\/manifest\.webmanifest" \/>/.test(html),
    "index.html",
  );
  check(
    "index.html membawa meta pemasangan iOS (layar penuh)",
    html.includes('name="apple-mobile-web-app-capable"') &&
      html.includes('name="apple-mobile-web-app-title"') &&
      html.includes('name="mobile-web-app-capable"') &&
      html.includes('rel="apple-touch-icon"'),
    "meta Apple",
  );
  check(
    "index.html memakai ikon vektor sebagai favicon",
    html.includes('rel="icon" type="image/svg+xml" href="/icon.svg"'),
    "favicon",
  );
  const mainSource = read("src/main.tsx");
  check(
    "main.tsx mendaftarkan service worker setelah halaman dimuat",
    mainSource.includes("navigator.serviceWorker.register(SERVICE_WORKER_URL)") &&
      mainSource.includes('addEventListener("load"'),
    "main.tsx",
  );
  check(
    "pendaftaran service worker dijaga & kegagalannya tidak mematikan aplikasi",
    mainSource.includes("supportsServiceWorker(navigator)") && mainSource.includes(".catch("),
    "main.tsx",
  );

  // ── 4. Service worker dijalankan dengan caches/fetch tiruan ──────────────
  const swSource = read("public/sw.js");
  const stores = new Map();
  const keyOf = (request) =>
    typeof request === "string" ? new URL(request, ORIGIN).toString() : request.url;
  const cacheStore = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  const cachesFake = {
    async open(name) {
      const store = cacheStore(name);
      return {
        async add(url) {
          const response = await fetchFake({ url: keyOf(url), method: "GET", mode: "no-cors" });
          if (!response.ok) throw new Error("gagal menyimpan " + url);
          store.set(keyOf(url), response);
        },
        async match(request) {
          return store.get(keyOf(request))?.clone();
        },
        async put(request, response) {
          store.set(keyOf(request), response);
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
  };
  const swCalls = { skipWaiting: 0, claim: 0 };
  const swHandlers = new Map();
  const selfFake = {
    location: { origin: ORIGIN },
    addEventListener: (type, handler) => swHandlers.set(type, handler),
    skipWaiting: async () => {
      swCalls.skipWaiting += 1;
    },
    clients: {
      claim: async () => {
        swCalls.claim += 1;
      },
    },
  };
  let networkDown = false;
  const fetchLog = [];
  const fetchFake = async (request) => {
    const url = keyOf(request);
    fetchLog.push(url);
    if (networkDown) throw new TypeError("offline");
    return new Response(`isi ${url}`, { status: 200 });
  };
  // Dijalankan sebagai script biasa (bukan modul) — persis seperti di browser.
  new Function("self", "caches", "fetch", "URL", swSource)(selfFake, cachesFake, fetchFake, URL);

  async function dispatchLifecycle(type) {
    const promises = [];
    await swHandlers.get(type)({ waitUntil: (promise) => promises.push(promise) });
    await Promise.all(promises);
  }
  async function dispatchFetch(request) {
    let responded = null;
    swHandlers.get("fetch")({
      request,
      respondWith: (promise) => {
        responded = promise;
      },
    });
    return responded;
  }

  check("service worker menyimak install/activate/fetch", ["install", "activate", "fetch"].every((type) => swHandlers.has(type)), [...swHandlers.keys()].join(","));

  await dispatchLifecycle("install");
  check(
    "install: cangkang aplikasi & manifest disimpan, lalu skipWaiting",
    cacheStore("mesinpos-shell-v1").has(`${ORIGIN}/index.html`) &&
      cacheStore("mesinpos-shell-v1").has(`${ORIGIN}/manifest.webmanifest`) &&
      swCalls.skipWaiting === 1,
    [...cacheStore("mesinpos-shell-v1").keys()].join(","),
  );
  stores.set("mesinpos-shell-v0", new Map([["lama", "x"]]));
  await dispatchLifecycle("activate");
  check(
    "activate: cache versi lama dibuang & klien diambil alih",
    !stores.has("mesinpos-shell-v0") && swCalls.claim === 1,
    `ada=${[...stores.keys()].join(",")}`,
  );

  networkDown = true;
  const shell = await dispatchFetch({ url: `${ORIGIN}/app/pos`, method: "GET", mode: "navigate" });
  check(
    "navigasi saat offline dilayani cangkang yang tersimpan",
    shell !== null && (await shell).status === 200 && (await (await shell).text()).includes("/index.html"),
    "respondWith cangkang",
  );
  const passthrough = await dispatchFetch({ url: `${ORIGIN}/src/main.tsx`, method: "GET", mode: "cors" });
  check(
    "modul dev /src/… tidak pernah dilayani service worker",
    passthrough === null,
    "respondWith tidak dipanggil",
  );
  networkDown = false;

  const devModule = await dispatchFetch({ url: `${ORIGIN}/@vite/client`, method: "GET", mode: "cors" });
  check("berkas dev /@vite tidak disentuh", devModule === null, "respondWith tidak dipanggil");
  const apiCall = await dispatchFetch({
    url: "https://mellow-narwhal-477.convex.cloud/api/query",
    method: "GET",
    mode: "cors",
  });
  check("permintaan lintas origin (Convex) tidak disentuh", apiCall === null, "respondWith tidak dipanggil");
  const write = await dispatchFetch({ url: `${ORIGIN}/api/v1/orders`, method: "POST", mode: "cors" });
  check("permintaan tulis tidak pernah dilayani cache", write === null, "respondWith tidak dipanggil");

  const asset = await dispatchFetch({
    url: `${ORIGIN}/assets/index-abc123.js`,
    method: "GET",
    mode: "no-cors",
  });
  const assetResponse = asset === null ? null : await asset;
  check(
    "aset build dilayani & disimpan untuk pemakaian berikutnya",
    assetResponse?.status === 200 &&
      cacheStore("mesinpos-shell-v1").has(`${ORIGIN}/assets/index-abc123.js`),
    [...cacheStore("mesinpos-shell-v1").keys()].join(","),
  );

  networkDown = true;
  const cachedAsset = await dispatchFetch({
    url: `${ORIGIN}/assets/index-abc123.js`,
    method: "GET",
    mode: "no-cors",
  });
  check(
    "aset yang sudah tersimpan tetap terlayani saat offline",
    cachedAsset !== null && (await (await cachedAsset).text()).includes("index-abc123.js"),
    "isi cache",
  );
  networkDown = false;

  const navigation = await dispatchFetch({ url: `${ORIGIN}/`, method: "GET", mode: "navigate" });
  const navigationResponse = navigation === null ? null : await navigation;
  check(
    "navigasi saat online tetap mengambil versi terbaru",
    navigationResponse?.status === 200 &&
      (await navigationResponse.text()) === `isi ${ORIGIN}/`,
    "isi jaringan",
  );

  // ── 5. Perilaku ajakan & tombol di DOM ──────────────────────────────────
  const { InstallButton, InstallPrompt, InstallProvider } = await server.ssrLoadModule(
    "/src/components/InstallPrompt.tsx",
  );
  const { App } = await server.ssrLoadModule("/src/App.tsx");

  const realSetTimeout = window.setTimeout;
  const realMatchMedia = window.matchMedia;
  /**
   * Menahan timer aplikasi: jadwalnya dicatat, panggilannya dijalankan segera.
   * Jadi harness tidak perlu menunggu 10 detik sungguhan — tetapi **nilai**
   * jedanya tetap diperiksa, karena justru itu yang diminta.
   */
  function stubTimers() {
    const scheduled = [];
    window.setTimeout = (fn, delay, ...rest) => {
      scheduled.push(delay);
      return realSetTimeout(fn, 0, ...rest);
    };
    return {
      scheduled,
      restore: () => {
        window.setTimeout = realSetTimeout;
      },
    };
  }
  function stubDisplayMode(mode) {
    window.matchMedia = (query) => ({
      matches: query.includes("display-mode") && mode !== null && query.includes(mode),
      addEventListener() {},
      removeEventListener() {},
    });
  }
  async function flush(ms = 5) {
    await React.act(async () => {
      await new Promise((resolve) => realSetTimeout(resolve, ms));
    });
  }
  async function renderTree(element) {
    const container = window.document.createElement("div");
    window.document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(element);
    });
    return {
      text: () => container.textContent.replace(/\s+/g, " ").trim(),
      button: (label) =>
        [...container.querySelectorAll("button")].find(
          (row) =>
            row.getAttribute("aria-label") === label ||
            (row.textContent ?? "").trim().includes(label),
        ) ?? null,
      container,
      async click(label) {
        const target = this.button(label);
        if (!target) throw new Error(`tombol "${label}" tidak ada`);
        await React.act(async () => {
          target.click();
        });
      },
      async close() {
        await React.act(async () => {
          root.unmount();
        });
        container.remove();
      },
    };
  }
  const providers = (node) =>
    React.createElement(InstallProvider, null, node);

  // Skenario A — kunjungan pertama, tanpa janji pemasangan dari browser.
  {
    window.localStorage.clear();
    stubDisplayMode(null);
    const timers = stubTimers();
    const view = await renderTree(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(InstallPrompt, null),
          React.createElement(InstallButton, null),
        ),
      ),
    );
    check(
      "detik pertama kunjungan pertama: belum ada ajakan",
      !view.text().includes("Pasang MesinPOS di perangkat ini"),
      view.text().slice(0, 120),
    );
    await flush();
    check(
      "ajakan dijadwalkan pada 10 detik",
      timers.scheduled.includes(pwa.INSTALL_PROMPT_DELAY_MS),
      `jadwal=[${timers.scheduled}]`,
    );
    check(
      "ajakan muncul setelah jeda kunjungan pertama",
      view.text().includes("Pasang MesinPOS di perangkat ini") &&
        view.text().includes("Nanti saja"),
      view.text().slice(0, 200),
    );
    const stored = pwa.readInstallRecord(window.localStorage.getItem(pwa.INSTALL_STORAGE_KEY));
    check(
      "kunjungan pertama & waktu tampil dicatat di perangkat",
      Boolean(stored?.firstSeenAt) && Boolean(stored?.invitedAt),
      JSON.stringify(stored),
    );
    check(
      "belum ada tombol header selama ajakannya masih terbuka",
      view.button("Pasang aplikasi") === null,
      view.text().slice(0, 200),
    );

    await view.click("Pasang sekarang");
    check(
      "tanpa janji browser, ajakan berubah jadi petunjuk pemasangan manual",
      !view.text().includes("Pasang MesinPOS di perangkat ini") &&
        view.text().includes("Pasang lewat menu browser"),
      view.text().slice(0, 220),
    );
    await view.click("Tutup petunjuk pemasangan");
    check(
      "setelah ajakan ditutup, tombol pemasangan ada di layar",
      view.button("Pasang aplikasi") !== null && !view.text().includes("Pasang lewat menu browser"),
      view.text().slice(0, 200),
    );
    await view.click("Pasang aplikasi");
    check(
      "tombol membuka petunjuk saat browser tidak menawarkan pemasangan",
      view.text().includes("Pasang lewat menu browser"),
      view.text().slice(0, 220),
    );
    await view.close();
    timers.restore();
  }

  // Skenario B — janji pemasangan dari browser dipakai, bukan petunjuk manual.
  {
    window.localStorage.clear();
    stubDisplayMode(null);
    const timers = stubTimers();
    const calls = { prompt: 0, prevented: false };
    const view = await renderTree(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(InstallPrompt, null),
          React.createElement(InstallButton, null),
        ),
      ),
    );
    const event = new window.Event("beforeinstallprompt");
    event.preventDefault = () => {
      calls.prevented = true;
    };
    event.prompt = async () => {
      calls.prompt += 1;
    };
    event.userChoice = Promise.resolve({ outcome: "accepted" });
    await React.act(async () => {
      window.dispatchEvent(event);
    });
    await flush();
    check(
      "janji pemasangan browser ditahan aplikasi (bukan dipakai browser sendiri)",
      calls.prevented,
      "preventDefault",
    );
    await view.click("Pasang sekarang");
    check(
      "“Pasang sekarang” memakai janji browser",
      calls.prompt === 1 && !view.text().includes("Pasang lewat menu browser"),
      `prompt=${calls.prompt}`,
    );
    check(
      "setelah diterima, ajakan & tombol hilang",
      !view.text().includes("Pasang MesinPOS di perangkat ini") &&
        view.button("Pasang aplikasi") === null,
      view.text().slice(0, 160),
    );
    await view.close();
    timers.restore();
  }

  // Skenario C — kunjungan berikutnya: ajakan tidak diulang, tombol tetap ada.
  {
    const record = {
      firstSeenAt: "2026-10-12T09:00:00.000Z",
      invitedAt: "2026-10-12T09:00:10.000Z",
      dismissedAt: "2026-10-12T09:00:25.000Z",
    };
    window.localStorage.setItem(pwa.INSTALL_STORAGE_KEY, JSON.stringify(record));
    stubDisplayMode(null);
    const view = await renderTree(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(InstallPrompt, null),
          React.createElement(InstallButton, null),
        ),
      ),
    );
    await flush();
    check(
      "kunjungan berikutnya tidak diundang lagi",
      !view.text().includes("Pasang MesinPOS di perangkat ini"),
      view.text().slice(0, 160),
    );
    check(
      "tombol pemasangan langsung tersedia di kunjungan berikutnya",
      view.button("Pasang aplikasi") !== null,
      view.text().slice(0, 160),
    );
    check(
      "catatan kunjungan lama tidak ditulis ulang",
      window.localStorage.getItem(pwa.INSTALL_STORAGE_KEY) === JSON.stringify(record),
      window.localStorage.getItem(pwa.INSTALL_STORAGE_KEY),
    );
    await view.close();
  }

  // Skenario D — sudah terpasang: tidak ada ajakan, tidak ada tombol.
  {
    window.localStorage.clear();
    stubDisplayMode("fullscreen");
    const view = await renderTree(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(InstallPrompt, null),
          React.createElement(InstallButton, null),
        ),
      ),
    );
    await flush();
    check(
      "aplikasi yang sudah terpasang tidak diundang lagi",
      !view.text().includes("Pasang MesinPOS di perangkat ini") &&
        view.button("Pasang aplikasi") === null,
      view.text().slice(0, 160),
    );
    await view.close();
    window.matchMedia = realMatchMedia;
  }

  // Skenario E — acara `appinstalled` menutup ajakan yang sedang terbuka.
  {
    window.localStorage.clear();
    stubDisplayMode(null);
    const timers = stubTimers();
    const view = await renderTree(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(InstallPrompt, null),
          React.createElement(InstallButton, null),
        ),
      ),
    );
    await flush();
    check("ajakan terbuka sebelum pemasangan", view.text().includes("Pasang MesinPOS di perangkat ini"), view.text().slice(0, 120));
    await React.act(async () => {
      window.dispatchEvent(new window.Event("appinstalled"));
    });
    check(
      "setelah dipasang, ajakan langsung hilang",
      !view.text().includes("Pasang MesinPOS di perangkat ini"),
      view.text().slice(0, 160),
    );
    await view.close();
    timers.restore();
    window.matchMedia = realMatchMedia;
  }

  // Skenario F — perangkat ini **sudah memasang** aplikasinya (bukti dari kunjungan
  // sebelumnya), lalu alamatnya dibuka di tab browser biasa. Tidak boleh ada ajakan
  // maupun tombol “Pasang” lagi — inilah keluhan yang membuat catatan ini ada.
  {
    window.localStorage.setItem(
      pwa.INSTALL_STORAGE_KEY,
      JSON.stringify({
        firstSeenAt: "2026-10-12T09:00:00.000Z",
        invitedAt: "2026-10-12T09:00:10.000Z",
        dismissedAt: "2026-10-12T09:00:25.000Z",
        installedAt: "2026-10-12T09:05:00.000Z",
      }),
    );
    stubDisplayMode(null); // tab browser biasa, bukan jendela aplikasi
    const timers = stubTimers();
    const view = await renderTree(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(InstallPrompt, null),
          React.createElement(InstallButton, null),
        ),
      ),
    );
    await flush();
    check(
      "perangkat yang sudah memasang tidak diundang memasang lagi",
      !view.text().includes("Pasang MesinPOS di perangkat ini"),
      view.text().slice(0, 160),
    );
    check(
      "perangkat yang sudah memasang tidak lagi melihat tombol “Pasang” (walau di tab browser)",
      view.button("Pasang aplikasi") === null,
      view.text().slice(0, 200),
    );
    check(
      "catatan pemasangannya tidak ditulis ulang",
      JSON.parse(window.localStorage.getItem(pwa.INSTALL_STORAGE_KEY)).installedAt ===
        "2026-10-12T09:05:00.000Z",
      window.localStorage.getItem(pwa.INSTALL_STORAGE_KEY),
    );
    await view.close();
    timers.restore();
  }

  // Skenario G — peramban yang bisa ditanya (Chromium) menjawab “sudah terpasang”
  // dari tab biasa: ajakan dibatalkan dan buktinya dicatat di perangkat.
  {
    window.localStorage.clear();
    stubDisplayMode(null);
    const realRelatedApps = window.navigator.getInstalledRelatedApps;
    window.navigator.getInstalledRelatedApps = async () => [
      { id: "/", platform: "webapp", url: "https://mesinpos.test/manifest.webmanifest" },
    ];
    const timers = stubTimers();
    const view = await renderTree(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(InstallPrompt, null),
          React.createElement(InstallButton, null),
        ),
      ),
    );
    await flush(20);
    check(
      "jawaban “sudah terpasang” dari peramban membatalkan ajakannya",
      !view.text().includes("Pasang MesinPOS di perangkat ini"),
      view.text().slice(0, 160),
    );
    check(
      "jawaban “sudah terpasang” menyembunyikan tombol “Pasang”",
      view.button("Pasang aplikasi") === null,
      view.text().slice(0, 160),
    );
    check(
      "bukti pemasangan dari peramban dicatat di perangkat",
      Boolean(
        pwa.readInstallRecord(window.localStorage.getItem(pwa.INSTALL_STORAGE_KEY))
          ?.installedAt,
      ),
      window.localStorage.getItem(pwa.INSTALL_STORAGE_KEY),
    );
    await view.close();
    timers.restore();
    if (realRelatedApps === undefined) {
      delete window.navigator.getInstalledRelatedApps;
    } else {
      window.navigator.getInstalledRelatedApps = realRelatedApps;
    }
  }

  // Skenario H — `appinstalled` lalu halaman dimuat ulang: tombol tetap tidak muncul
  // (peramban memanggil event itu juga saat pemasangan lewat menunya sendiri).
  {
    window.localStorage.clear();
    stubDisplayMode(null);
    const timers = stubTimers();
    const view = await renderTree(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(InstallPrompt, null),
          React.createElement(InstallButton, null),
        ),
      ),
    );
    await flush();
    await React.act(async () => {
      window.dispatchEvent(new window.Event("appinstalled"));
    });
    check(
      "`appinstalled` dicatat sebagai bukti pemasangan di perangkat",
      Boolean(
        pwa.readInstallRecord(window.localStorage.getItem(pwa.INSTALL_STORAGE_KEY))
          ?.installedAt,
      ),
      window.localStorage.getItem(pwa.INSTALL_STORAGE_KEY),
    );
    await view.close();

    const reload = await renderTree(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(InstallPrompt, null),
          React.createElement(InstallButton, null),
        ),
      ),
    );
    await flush();
    check(
      "setelah dimuat ulang di tab browser, ajakan & tombol tetap tidak ada",
      !reload.text().includes("Pasang MesinPOS di perangkat ini") &&
        reload.button("Pasang aplikasi") === null,
      reload.text().slice(0, 200),
    );
    await reload.close();
    timers.restore();
  }

  // Skenario I — aplikasinya dicopot: browser menawarkan pemasangan lagi, dan
  // catatan “sudah terpasang” harus dibuang supaya tombolnya tidak hilang selamanya.
  {
    window.localStorage.setItem(
      pwa.INSTALL_STORAGE_KEY,
      JSON.stringify({
        firstSeenAt: "2026-10-12T09:00:00.000Z",
        invitedAt: "2026-10-12T09:00:10.000Z",
        dismissedAt: "2026-10-12T09:00:25.000Z",
        installedAt: "2026-10-12T09:05:00.000Z",
      }),
    );
    stubDisplayMode(null);
    const view = await renderTree(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(InstallPrompt, null),
          React.createElement(InstallButton, null),
        ),
      ),
    );
    await flush();
    check(
      "sebelum sinyal browser: tombol masih disembunyikan",
      view.button("Pasang aplikasi") === null,
      view.text().slice(0, 160),
    );
    const event = new window.Event("beforeinstallprompt");
    event.preventDefault = () => {};
    event.prompt = async () => {};
    event.userChoice = Promise.resolve({ outcome: "dismissed" });
    await React.act(async () => {
      window.dispatchEvent(event);
    });
    check(
      "sinyal “masih bisa dipasang” membuang catatan terpasang",
      pwa.readInstallRecord(window.localStorage.getItem(pwa.INSTALL_STORAGE_KEY))
        ?.installedAt === null,
      window.localStorage.getItem(pwa.INSTALL_STORAGE_KEY),
    );
    check(
      "tombol “Pasang” kembali muncul setelah aplikasinya dicopot",
      view.button("Pasang aplikasi") !== null,
      view.text().slice(0, 200),
    );
    await view.close();
  }

  // Skenario J — dibuka dari ikon aplikasi (mode jendela aplikasi): bukti pemasangan
  // dicatat, sehingga kunjungan berikutnya di tab browser juga tanpa tombol.
  {
    window.localStorage.clear();
    stubDisplayMode("standalone");
    const view = await renderTree(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(InstallPrompt, null),
          React.createElement(InstallButton, null),
        ),
      ),
    );
    await flush();
    check(
      "dibuka dari ikon aplikasi: tanpa ajakan & tanpa tombol",
      !view.text().includes("Pasang MesinPOS di perangkat ini") &&
        view.button("Pasang aplikasi") === null,
      view.text().slice(0, 160),
    );
    check(
      "dibukanya dari ikon dicatat sebagai bukti pemasangan di perangkat",
      Boolean(
        pwa.readInstallRecord(window.localStorage.getItem(pwa.INSTALL_STORAGE_KEY))
          ?.installedAt,
      ),
      window.localStorage.getItem(pwa.INSTALL_STORAGE_KEY),
    );
    await view.close();

    stubDisplayMode(null);
    const tab = await renderTree(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(InstallPrompt, null),
          React.createElement(InstallButton, null),
        ),
      ),
    );
    await flush();
    check(
      "kunjungan berikutnya di tab browser: tetap tanpa tombol “Pasang”",
      tab.button("Pasang aplikasi") === null,
      tab.text().slice(0, 160),
    );
    await tab.close();
    window.matchMedia = realMatchMedia;
  }

  // Skenario K — dibuka dari alamat **sementara** (pratinjau sandbox / lokal):
  // ajakannya harus jujur bahwa ikon yang dipasang dari sini nanti tidak bisa
  // dibuka, lalu di alamat tetap peringatan itu tidak boleh muncul.
  {
    window.localStorage.clear();
    stubDisplayMode(null);
    const timers = stubTimers();
    window.happyDOM.setURL("http://localhost:5173/");
    const view = await renderTree(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(InstallPrompt, null),
          React.createElement(InstallButton, null),
        ),
      ),
    );
    await flush();
    check(
      "alamat sementara: ajakan memperingatkan bahwa ikonnya nanti tidak bisa dibuka",
      view.container.querySelector('[data-notis="alamat-sementara"]') !== null &&
        view.text().includes(pwa.STABLE_INSTALL_ORIGIN),
      view.text().slice(0, 240),
    );
    await view.click("Nanti saja");
    await view.click("Pasang aplikasi");
    check(
      "alamat sementara: petunjuk pasang juga menyebut alamat tetapnya",
      view.container.querySelector('[data-notis="alamat-sementara"]') !== null &&
        view.text().includes("Pasang lewat menu browser"),
      view.text().slice(0, 260),
    );
    await view.close();

    window.happyDOM.setURL(`${pwa.STABLE_INSTALL_ORIGIN}/`);
    window.localStorage.setItem(
      pwa.INSTALL_STORAGE_KEY,
      JSON.stringify({
        firstSeenAt: "2026-10-12T09:00:00.000Z",
        invitedAt: "2026-10-12T09:00:10.000Z",
        dismissedAt: "2026-10-12T09:00:25.000Z",
      }),
    );
    const tetap = await renderTree(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(InstallPrompt, null),
          React.createElement(InstallButton, null),
        ),
      ),
    );
    await flush();
    await tetap.click("Pasang aplikasi");
    check(
      "di alamat tetap, peringatan alamat sementara tidak muncul",
      tetap.container.querySelector('[data-notis="alamat-sementara"]') === null &&
        tetap.text().includes("Pasang lewat menu browser"),
      tetap.text().slice(0, 240),
    );
    await tetap.close();
    timers.restore();
    window.happyDOM.setURL("https://mesinpos.test/");
  }

  // ── 6. Penempatan tombol: di header beranda, tepat sebelum "Masuk" ───────
  {
    window.localStorage.setItem(
      pwa.INSTALL_STORAGE_KEY,
      JSON.stringify({
        firstSeenAt: "2026-10-12T09:00:00.000Z",
        invitedAt: "2026-10-12T09:00:10.000Z",
        dismissedAt: "2026-10-12T09:00:25.000Z",
      }),
    );
    stubDisplayMode(null);
    const container = window.document.createElement("div");
    window.document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/"] },
          React.createElement(App, null),
        ),
      );
    });
    const install = [...container.querySelectorAll("button")].find(
      (row) => row.getAttribute("aria-label") === "Pasang aplikasi MesinPOS",
    );
    check(
      "beranda menampilkan tombol pemasangan di header",
      Boolean(install) && Boolean(install.closest("header")),
      install ? "ada di header" : "tidak ada",
    );
    const header = install?.closest("header");
    const order = header
      ? [...header.querySelectorAll("a, button")].map((row) =>
          row.getAttribute("aria-label") ?? (row.textContent ?? "").trim(),
        )
      : [];
    check(
      "tombol pemasangan duduk tepat di sebelah tombol masuk",
      order.includes("Pasang aplikasi MesinPOS") &&
        order[order.indexOf("Pasang aplikasi MesinPOS") + 1] === "Masuk",
      order.join(" → "),
    );
    check(
      "tombol ganti tema tersedia di header beranda",
      order.some((label) => label === "Ganti ke tema terang" || label === "Ganti ke tema gelap"),
      order.join(" → "),
    );
    await React.act(async () => {
      root.unmount();
    });
    container.remove();
    window.matchMedia = realMatchMedia;
  }
} catch (error) {
  failure = error;
} finally {
  await server.close();
  await window.happyDOM?.close?.();
}

if (failure) {
  for (const result of results) {
    console.log(`${result.ok ? "✓" : "✗"} ${result.name}`);
  }
  console.error(`\n✗ ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`${results.length}/${results.length} checks passed`);
  process.exit(0);
}

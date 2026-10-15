/**
 * Uji aturan mode layar penuh backstage tanpa deployment.
 *
 * Yang diuji adalah `src/lib/fullscreen.ts` — modul murni yang dipakai tombol
 * **Layar penuh** di `AppLayout`, penyelarasan saat pengguna keluar lewat Esc, dan
 * harness render.
 *
 * Dua janji yang dijaga di sini:
 *  1. **“Tanpa sidebar” selalu bisa dilakukan.** Peramban boleh tidak punya
 *     Fullscreen API, atau menolaknya (mis. halaman di dalam `<iframe>` tanpa
 *     `allow="fullscreen"`); permintaan yang gagal **tidak** melempar dan tidak
 *     membatalkan keputusan pemanggil untuk menyembunyikan sidebar.
 *  2. **Keluar dari layar penuh dikenali.** `fullscreenActiveFor` membaca
 *     `fullscreenElement`, jadi tombolnya bisa kembali ke keadaan semula saat
 *     pengguna menekan Esc — dan `exitFullscreen` hanya dipanggil kalau memang ada
 *     elemen yang sedang penuh.
 *
 * Usage: bun scripts/verify-fullscreen.mjs
 */
import {
  applyFullscreen,
  fullscreenActiveFor,
  fullscreenHint,
  fullscreenLabel,
  sidebarHidden,
} from "../src/lib/fullscreen.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

/** Dokumen tiruan: mencatat panggilan, dan bisa disuruh menerima atau menolak. */
function fakeDocument(options = {}) {
  const calls = { request: 0, exit: 0 };
  const doc = {
    calls,
    fullscreenElement: options.fullscreenElement ?? null,
    documentElement: {},
    exitFullscreen: null,
  };
  if (options.withRequest !== false) {
    doc.documentElement.requestFullscreen = () => {
      calls.request += 1;
      if (options.rejectRequest) return Promise.reject(new Error("ditolak"));
      doc.fullscreenElement = doc.documentElement;
      return Promise.resolve();
    };
  }
  if (options.withExit !== false) {
    doc.exitFullscreen = () => {
      calls.exit += 1;
      if (options.rejectExit) return Promise.reject(new Error("ditolak"));
      doc.fullscreenElement = null;
      return Promise.resolve();
    };
  }
  return doc;
}

// ------------------------------------------------------------- label & hint
check(
  "label tombol menyebut tindakan yang akan terjadi",
  fullscreenLabel(false) === "Layar penuh" &&
    fullscreenLabel(true) === "Keluar dari layar penuh",
  `${fullscreenLabel(false)} / ${fullscreenLabel(true)}`,
);
check(
  "hint menyebut sidebar & cara keluarnya",
  fullscreenHint(false).includes("Sembunyikan sidebar") &&
    fullscreenHint(true).includes("Sidebar disembunyikan") &&
    fullscreenHint(true).includes("Esc"),
  fullscreenHint(true),
);
check(
  "hint di halaman tanpa sidebar (beranda & masuk) tidak menjanjikan sidebar",
  !fullscreenHint(false, { hasSidebar: false }).includes("sidebar") &&
    !fullscreenHint(true, { hasSidebar: false }).includes("sidebar") &&
    fullscreenHint(false, { hasSidebar: false }).includes("layar penuh") &&
    fullscreenHint(true, { hasSidebar: false }).includes("Esc"),
  `${fullscreenHint(false, { hasSidebar: false })} | ${fullscreenHint(true, { hasSidebar: false })}`,
);
check(
  "sidebar hanya disembunyikan saat mode aktif",
  sidebarHidden(true) === true && sidebarHidden(false) === false,
  `${sidebarHidden(true)} / ${sidebarHidden(false)}`,
);

// --------------------------------------------------- membaca keadaan peramban
check(
  "mode browser tidak aktif kalau tidak ada elemen yang penuh",
  fullscreenActiveFor(null) === false &&
    fullscreenActiveFor(undefined) === false &&
    fullscreenActiveFor({}) === false &&
    fullscreenActiveFor({ fullscreenElement: null }) === false,
  "salah satu dianggap aktif",
);
check(
  "mode browser aktif begitu ada elemen yang penuh (itulah yang dibaca setelah Esc)",
  fullscreenActiveFor({ fullscreenElement: {} }) === true,
  "-",
);

// --------------------------------------------------------- masuk layar penuh
{
  const doc = fakeDocument();
  const hasil = await applyFullscreen(true, doc);
  check(
    "permintaan layar penuh diteruskan ke peramban dan diterima",
    hasil === true && doc.calls.request === 1 && fullscreenActiveFor(doc) === true,
    JSON.stringify({ hasil, calls: doc.calls, aktif: fullscreenActiveFor(doc) }),
  );
}
{
  const doc = fakeDocument();
  await applyFullscreen(false, doc);
  check(
    "permintaan keluar tidak pernah diterjemahkan menjadi minta masuk",
    doc.calls.request === 0 && doc.calls.exit === 0,
    JSON.stringify(doc.calls),
  );
}
{
  const doc = fakeDocument({ withRequest: false });
  const hasil = await applyFullscreen(true, doc);
  check(
    "peramban tanpa Fullscreen API tidak melempar, dan mode aplikasi tetap jalan",
    hasil === false && doc.calls.exit === 0,
    JSON.stringify({ hasil }),
  );
}
{
  const doc = fakeDocument({ rejectRequest: true });
  const hasil = await applyFullscreen(true, doc);
  check(
    "permintaan yang ditolak peramban (mis. iframe) tidak melempar ke pemanggil",
    hasil === false && doc.calls.request === 1,
    JSON.stringify({ hasil, calls: doc.calls }),
  );
}
{
  const hasil = await applyFullscreen(true, null);
  check("tanpa dokumen (mode tanpa DOM) tidak melempar", hasil === false, String(hasil));
}

// -------------------------------------------------------- keluar layar penuh
{
  const doc = fakeDocument({ fullscreenElement: {} });
  const hasil = await applyFullscreen(false, doc);
  check(
    "keluar memanggil exitFullscreen hanya kalau memang ada elemen yang penuh",
    hasil === true && doc.calls.exit === 1 && fullscreenActiveFor(doc) === false,
    JSON.stringify({ hasil, calls: doc.calls }),
  );
}
{
  const doc = fakeDocument();
  const hasil = await applyFullscreen(false, doc);
  check(
    "keluar tanpa layar penuh tidak memanggil peramban sama sekali",
    hasil === false && doc.calls.exit === 0,
    JSON.stringify({ hasil, calls: doc.calls }),
  );
}
{
  const doc = fakeDocument({ fullscreenElement: {}, rejectExit: true });
  const hasil = await applyFullscreen(false, doc);
  check(
    "penolakan saat keluar tidak melempar — halaman tetap bisa memunculkan sidebar",
    hasil === false && doc.calls.exit === 1,
    JSON.stringify({ hasil, calls: doc.calls }),
  );
}

console.log(`${results.length}/${results.length} checks passed`);

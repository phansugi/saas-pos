/**
 * Versi bundel: kapan ajakan “Versi baru tersedia — muat ulang” muncul,
 * dan kapan ia justru harus diam.
 *
 * Kenapa ada: ajakan ini lahir dari kejadian nyata — produksi sudah memuat
 * perbaikan, tetapi tab yang masih terbuka menjalankan bundel lama dan
 * melaporkan `[CONVEX Q(products:listAll)] Akses ditolak: peran cashier …`
 * (lihat README). Bedanya “kode sekarang” dan “berkas yang sedang berjalan”
 * tidak terlihat dari dalam kode, jadi harness ini **menjalankan** pemeriksaan
 * yang biasanya hanya dibaca:
 *
 *   1. aturan murni `src/lib/bundleVersion.ts`: berkas mana yang dihitung
 *      sebagai bundel, kapan perbedaannya berarti deploy baru, dan kapan
 *      ajakannya ditahan;
 *   2. perilaku di DOM: ajakan baru muncul setelah pemeriksaan (bukan begitu
 *      halaman dibuka), tombolnya benar-benar memuat ulang, “Nanti” diingat per
 *      tab, dan bundel yang lebih baru lagi membuatnya kembali;
 *   3. jalur diam: luring, jawaban galat, HTML tanpa bundel, mode dev, dan tab
 *      tersembunyi tidak boleh pernah memunculkan ajakan;
 *   4. tempatnya di aplikasi: shell `/app/pos` yang **asli** menampilkan ajakan
 *      di luar area halaman, dan halaman kasirnya tetap terbaca.
 *
 * Usage: bun scripts/verify-version.mjs
 */
import "./happy-dom-setup.mjs";
import { readFileSync } from "node:fs";
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

const errors = [];
const originalError = console.error;
console.error = (...args) => {
  errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  originalError(...args);
};

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

const ORIGIN = "https://mesinpos.test";

let failure = null;

try {
  const version = await server.ssrLoadModule("/src/lib/bundleVersion.ts");
  const { NewVersionNotice } = await server.ssrLoadModule(
    "/src/components/NewVersionNotice.tsx",
  );

  // ── 1. Aturan murni: apa yang dihitung “bundel” ──────────────────────────
  check(
    "bundleFileName membaca nama bundel dari jalur biasa",
    version.bundleFileName("/assets/index-BRNyf2qd.js") === "index-BRNyf2qd.js",
    String(version.bundleFileName("/assets/index-BRNyf2qd.js")),
  );
  check(
    "bundleFileName menerima jalur relatif, URL absolut, query, dan hash",
    version.bundleFileName("assets/index-abc_1-x.js") === "index-abc_1-x.js" &&
      version.bundleFileName("https://situs.test/assets/index-abc12345.js?v=1#x") ===
        "index-abc12345.js",
    [
      version.bundleFileName("assets/index-abc_1-x.js"),
      version.bundleFileName("https://situs.test/assets/index-abc12345.js?v=1#x"),
    ].join(" | "),
  );
  check(
    "bundleFileName menolak berkas yang bukan bundel aplikasi",
    [
      "/src/main.tsx",
      "/assets/index-ChP7W5AB.css",
      "/assets/vendor-abc12345.js",
      "index.js",
      "",
      null,
      undefined,
    ].every((value) => version.bundleFileName(value) === null),
    "salah satu bentuk asing diterima",
  );

  const htmlProduksi = (bundel) =>
    `<!doctype html><html lang="id" class="dark"><head><meta charset="UTF-8">` +
    `<script>/* tema-bootstrap */</script>` +
    `<link rel="stylesheet" crossorigin href="/assets/index-ChP7W5AB.css">` +
    `<script type="module" crossorigin src="/assets/${bundel}"></script>` +
    `</head><body><div id="root"></div></body></html>`;

  check(
    "bundleFileFromHtml memilih script modul (mengabaikan script inline & CSS)",
    version.bundleFileFromHtml(htmlProduksi("index-BRNyf2qd.js")) === "index-BRNyf2qd.js",
    String(version.bundleFileFromHtml(htmlProduksi("index-BRNyf2qd.js"))),
  );
  check(
    "HTML tanpa script modul tidak dipaksa punya bundel",
    version.bundleFileFromHtml("<html><body>halaman galat</body></html>") === null &&
      version.bundleFileFromHtml("") === null &&
      version.bundleFileFromHtml(null) === null,
    "HTML tanpa bundel malah menghasilkan nama",
  );
  check(
    "index.html repo (mode dev) tidak dianggap bundel",
    version.bundleFileFromHtml(read("index.html")) === null,
    String(version.bundleFileFromHtml(read("index.html"))),
  );

  // ── 2. Aturan murni: kapan ajakannya muncul ─────────────────────────────
  check(
    "isOlderBundle hanya benar kalau kedua nama terbaca & berbeda",
    version.isOlderBundle("index-AAAA1111.js", "index-BBBB2222.js") === true &&
      version.isOlderBundle("index-AAAA1111.js", "index-AAAA1111.js") === false &&
      version.isOlderBundle(null, "index-BBBB2222.js") === false &&
      version.isOlderBundle("index-AAAA1111.js", null) === false,
    "perbandingan tidak sesuai aturan",
  );
  check(
    "shouldAnnounceVersion menahan ajakan untuk versi yang sudah ditolak",
    version.shouldAnnounceVersion({
      running: "index-AAAA1111.js",
      latest: "index-BBBB2222.js",
      dismissed: null,
    }) === true &&
      version.shouldAnnounceVersion({
        running: "index-AAAA1111.js",
        latest: "index-BBBB2222.js",
        dismissed: "index-BBBB2222.js",
      }) === false &&
      version.shouldAnnounceVersion({
        running: "index-AAAA1111.js",
        latest: "index-CCCC3333.js",
        dismissed: "index-BBBB2222.js",
      }) === true,
    "aturan tutup/ingat tidak konsisten",
  );
  check(
    "shouldAnnounceVersion tidak menebak saat salah satu nama tidak terbaca",
    version.shouldAnnounceVersion({ running: null, latest: "index-BBBB2222.js", dismissed: null }) ===
      false &&
      version.shouldAnnounceVersion({ running: "index-AAAA1111.js", latest: null, dismissed: null }) ===
        false,
    "ajakan muncul tanpa pembanding",
  );
  check(
    "readDismissedBundle hanya mempercayai bentuk nama bundel",
    version.readDismissedBundle("index-BBBB2222.js") === "index-BBBB2222.js" &&
      version.readDismissedBundle("index.js") === null &&
      version.readDismissedBundle("") === null &&
      version.readDismissedBundle(null) === null,
    "catatan asing dipercaya",
  );
  check(
    "versionDetail menyebut bundel yang berjalan & yang terbaru",
    version
      .versionDetail("index-AAAA1111.js", "index-BBBB2222.js")
      .includes("index-AAAA1111.js") &&
      version
        .versionDetail("index-AAAA1111.js", "index-BBBB2222.js")
        .includes("index-BBBB2222.js"),
    version.versionDetail("index-AAAA1111.js", "index-BBBB2222.js"),
  );

  let muatUlang = 0;
  version.reloadPage({ reload: () => (muatUlang += 1) });
  version.reloadPage(null);
  check("reloadPage memanggil muat ulang (dan aman tanpa target)", muatUlang === 1, String(muatUlang));

  check(
    "irama pemeriksaan: tidak menyergap render awal (≥ 10 detik)",
    version.VERSION_FIRST_CHECK_MS >= 10_000,
    String(version.VERSION_FIRST_CHECK_MS),
  );
  check(
    "irama pemeriksaan: tidak lebih rapat dari satu menit",
    version.VERSION_CHECK_INTERVAL_MS >= 60_000,
    String(version.VERSION_CHECK_INTERVAL_MS),
  );
  check(
    "pemeriksaan pertama datang sebelum putaran berkala",
    version.VERSION_FIRST_CHECK_MS <= version.VERSION_CHECK_INTERVAL_MS,
    `${version.VERSION_FIRST_CHECK_MS} vs ${version.VERSION_CHECK_INTERVAL_MS}`,
  );

  // ── 3. Perlengkapan DOM: jam tiruan, jawaban situs tiruan, reload palsu ──
  const realSetTimeout = window.setTimeout;
  const realSetInterval = window.setInterval;
  const realClearTimeout = window.clearTimeout;
  const realClearInterval = window.clearInterval;

  /**
   * Jam tiruan: jadwalnya dicatat, tetapi **tidak** dijalankan sendiri — supaya
   * harness bisa membuktikan “belum ada pemeriksaan sebelum waktunya”, lalu
   * menjalankan callback-nya sendiri untuk membuktikan jadwal itu benar-benar
   * terpasang.
   */
  function jamTiruan() {
    const timeout = [];
    const interval = [];
    const dibatalkan = [];
    window.setTimeout = (fn, delay) => {
      const entry = { fn, delay };
      timeout.push(entry);
      return entry;
    };
    window.clearTimeout = (entry) => {
      if (entry) dibatalkan.push(entry);
    };
    window.setInterval = (fn, delay) => {
      const entry = { fn, delay };
      interval.push(entry);
      return entry;
    };
    window.clearInterval = (entry) => {
      if (entry) dibatalkan.push(entry);
    };
    return {
      timeout,
      interval,
      dibatalkan,
      pulih() {
        window.setTimeout = realSetTimeout;
        window.setInterval = realSetInterval;
        window.clearTimeout = realClearTimeout;
        window.clearInterval = realClearInterval;
      },
    };
  }

  const asal = { bundel: "index-BBBB2222.js", status: 200, luring: false, html: null };
  const fetchLog = [];
  async function fetchTiruan(input, init) {
    fetchLog.push({ url: String(input), init });
    if (asal.luring) throw new TypeError("offline");
    return new Response(asal.html ?? htmlProduksi(asal.bundel), { status: asal.status });
  }
  globalThis.fetch = fetchTiruan;
  window.fetch = fetchTiruan;

  let reloadHits = 0;
  Object.defineProperty(window.location, "reload", {
    configurable: true,
    value: () => {
      reloadHits += 1;
    },
  });

  /** Dokumen tiruan “hasil build”: satu script modul, seperti HTML produksi. */
  function pasangBundelDokumen(bundel) {
    const script = window.document.createElement("script");
    script.setAttribute("type", "module");
    script.setAttribute("crossorigin", "");
    script.setAttribute("src", `/assets/${bundel}`);
    window.document.head.appendChild(script);
    return () => script.remove();
  }

  function aturTerlihat(nilai) {
    Object.defineProperty(window.document, "visibilityState", {
      configurable: true,
      get: () => nilai,
    });
    return () => delete window.document.visibilityState;
  }

  async function flush(ms = 5) {
    await React.act(async () => {
      await new Promise((resolve) => realSetTimeout(resolve, ms));
    });
  }

  async function renderAjak() {
    const container = window.document.createElement("div");
    window.document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(React.createElement(NewVersionNotice, null));
    });
    const tombol = () =>
      [...container.querySelectorAll("button")].find((row) =>
        (row.textContent ?? "").trim().includes("Muat ulang sekarang"),
      ) ?? null;
    return {
      teks: () => container.textContent.replace(/\s+/g, " ").trim(),
      tombol,
      cari: (selector) => container.querySelector(selector),
      async klik(label) {
        const target = [...container.querySelectorAll("button")].find((row) =>
          (row.textContent ?? "").trim().includes(label),
        );
        if (!target) throw new Error(`tombol "${label}" tidak ada`);
        await React.act(async () => {
          target.click();
        });
      },
      async kembaliTerlihat() {
        await React.act(async () => {
          window.document.dispatchEvent(new window.Event("visibilitychange"));
          await new Promise((resolve) => realSetTimeout(resolve, 0));
        });
      },
      async jalankan(entry) {
        if (!entry) throw new Error("jadwal yang diminta tidak ada");
        await React.act(async () => {
          entry.fn();
          await new Promise((resolve) => realSetTimeout(resolve, 0));
        });
      },
      async tutup() {
        await React.act(async () => {
          root.unmount();
        });
        container.remove();
      },
    };
  }

  // ── 4. Komponen: muncul setelah diperiksa, bukan saat halaman dibuka ──────
  {
    window.sessionStorage.clear();
    const lepasSkrip = pasangBundelDokumen("index-AAAA1111.js");
    asal.bundel = "index-BBBB2222.js";
    asal.status = 200;
    asal.luring = false;
    asal.html = null;
    fetchLog.length = 0;
    reloadHits = 0;
    const jam = jamTiruan();
    const view = await renderAjak();
    await flush();

    check(
      "sebelum ada pemeriksaan, ajakannya belum tampil",
      !view.teks().includes(version.NEW_VERSION_TEXT.title),
      view.teks().slice(0, 160),
    );
    check(
      "pemeriksaan pertama & berkala dijadwalkan dengan jeda yang benar",
      jam.timeout.some((entry) => entry.delay === version.VERSION_FIRST_CHECK_MS) &&
        jam.interval.some((entry) => entry.delay === version.VERSION_CHECK_INTERVAL_MS),
      `timeout=[${jam.timeout.map((e) => e.delay)}] interval=[${jam.interval
        .map((e) => e.delay)
        .join(",")}]`,
    );

    await view.kembaliTerlihat();
    check(
      "saat tab kembali terlihat, situs diperiksa & ajakan tampil",
      view.teks().includes(version.NEW_VERSION_TEXT.title),
      view.teks().slice(0, 200),
    );
    check(
      "pemeriksaan membaca dokumen situs dengan penanda waktu & tanpa cache",
      fetchLog.length === 1 &&
        fetchLog[0].url.startsWith(`${version.INDEX_URL}?v=`) &&
        fetchLog[0].init?.cache === "no-store",
      JSON.stringify(fetchLog[0] ?? null),
    );
    check(
      "ajakan menyebut judul, kedua berkas, dan tindakannya",
      view.teks().includes("index-AAAA1111.js") &&
        view.teks().includes("index-BBBB2222.js") &&
        view.teks().includes(version.NEW_VERSION_TEXT.confirm) &&
        view.teks().includes(version.NEW_VERSION_TEXT.later),
      view.teks().slice(0, 300),
    );
    check(
      "ajakan bisa dibaca pembaca layar (role=status + label)",
      view.cari('[role="status"]')?.getAttribute("aria-label") ===
        version.NEW_VERSION_TEXT.label,
      String(view.cari('[role="status"]')?.getAttribute("aria-label")),
    );
    check(
      "kalimatnya menyuruh menyelesaikan transaksi dulu sebelum muat ulang",
      view.teks().includes("transaksi yang sedang terbuka"),
      view.teks().slice(0, 200),
    );

    await view.klik(version.NEW_VERSION_TEXT.confirm);
    check(
      "tombol “Muat ulang sekarang” benar-benar memuat ulang halaman",
      reloadHits === 1,
      String(reloadHits),
    );

    await view.klik(version.NEW_VERSION_TEXT.later);
    check(
      "“Nanti” menutup ajakan & mencatatnya untuk tab ini",
      !view.teks().includes(version.NEW_VERSION_TEXT.title) &&
        window.sessionStorage.getItem(version.VERSION_DISMISS_KEY) === "index-BBBB2222.js",
      String(window.sessionStorage.getItem(version.VERSION_DISMISS_KEY)),
    );
    await view.tutup();
    check(
      "penjadwalan dibatalkan saat komponen dilepas",
      jam.dibatalkan.length >= 2,
      `dibatalkan=${jam.dibatalkan.length}`,
    );
    jam.pulih();

    // Catatan “Nanti” bertahan untuk tab ini — tetapi bukan untuk versi berikutnya.
    const jamKedua = jamTiruan();
    const ulang = await renderAjak();
    await ulang.kembaliTerlihat();
    check(
      "versi yang sudah ditolak tidak ditagih lagi di tab yang sama",
      !ulang.teks().includes(version.NEW_VERSION_TEXT.title),
      ulang.teks().slice(0, 160),
    );
    asal.bundel = "index-CCCC3333.js";
    await ulang.kembaliTerlihat();
    check(
      "bundel yang lebih baru lagi membuat ajakan kembali",
      ulang.teks().includes(version.NEW_VERSION_TEXT.title) &&
        ulang.teks().includes("index-CCCC3333.js"),
      ulang.teks().slice(0, 220),
    );
    await ulang.tutup();
    jamKedua.pulih();
    window.sessionStorage.clear();
    lepasSkrip();
  }

  // ── 5. Kedua jalur penjadwalan benar-benar menjalankan pemeriksaan ───────
  {
    const lepasSkrip = pasangBundelDokumen("index-AAAA1111.js");
    asal.bundel = "index-BBBB2222.js";
    asal.status = 200;
    asal.luring = false;
    asal.html = null;

    const setelahPertama = jamTiruan();
    const view = await renderAjak();
    await flush();
    await view.jalankan(setelahPertama.timeout.find((e) => e.delay === version.VERSION_FIRST_CHECK_MS));
    check(
      "jadwal pemeriksaan pertama benar-benar menjalankan pemeriksaan versi",
      view.teks().includes(version.NEW_VERSION_TEXT.title),
      view.teks().slice(0, 160),
    );
    await view.tutup();
    setelahPertama.pulih();

    const berkala = jamTiruan();
    const view2 = await renderAjak();
    await flush();
    await view2.jalankan(berkala.interval.find((e) => e.delay === version.VERSION_CHECK_INTERVAL_MS));
    check(
      "jadwal pemeriksaan berkala juga menjalankan pemeriksaan versi",
      view2.teks().includes(version.NEW_VERSION_TEXT.title),
      view2.teks().slice(0, 160),
    );
    await view2.tutup();
    berkala.pulih();
    lepasSkrip();
  }

  // ── 6. Jalur yang harus diam: luring, galat, HTML tanpa bundel, dev, sembunyi
  {
    const lepasSkrip = pasangBundelDokumen("index-AAAA1111.js");
    /** Menjalankan satu keadaan “harus diam” lengkap dengan ketiga jalur periksa. */
    const diam = async (nama, atur, detail) => {
      window.sessionStorage.clear();
      atur();
      fetchLog.length = 0;
      const galatSebelum = errors.length;
      const jam = jamTiruan();
      const view = await renderAjak();
      await flush();
      await view.kembaliTerlihat();
      await view.jalankan(jam.timeout.find((e) => e.delay === version.VERSION_FIRST_CHECK_MS));
      await view.jalankan(jam.interval.find((e) => e.delay === version.VERSION_CHECK_INTERVAL_MS));
      const teks = view.teks();
      const baru = errors.slice(galatSebelum);
      await view.tutup();
      jam.pulih();
      check(
        nama,
        !teks.includes(version.NEW_VERSION_TEXT.title) && baru.length === 0,
        `${detail} — teks=${teks.slice(0, 120)} galat=${baru.join(" | ")}`,
      );
    };

    await diam(
      "luring (fetch gagal): tidak ada ajakan & tidak ada galat",
      () => {
        asal.luring = true;
      },
      "fetch menolak",
    );
    check(
      "percobaan luring tetap dihitung sebagai pemeriksaan",
      fetchLog.length >= 1,
      String(fetchLog.length),
    );

    await diam(
      "jawaban galat server: tidak ada ajakan",
      () => {
        asal.luring = false;
        asal.status = 500;
      },
      "respons 500",
    );

    await diam(
      "HTML tanpa bundel (mis. halaman galat): tidak ada ajakan",
      () => {
        asal.status = 200;
        asal.html = "<html><body>404</body></html>";
      },
      "HTML tanpa script modul",
    );

    await diam(
      "bundel yang sama (belum ada deploy): tidak ada ajakan",
      () => {
        asal.html = null;
        asal.bundel = "index-AAAA1111.js";
      },
      "nama bundel sama",
    );

    const sembunyi = aturTerlihat("hidden");
    window.sessionStorage.clear();
    asal.bundel = "index-BBBB2222.js";
    fetchLog.length = 0;
    const jamSembunyi = jamTiruan();
    const viewSembunyi = await renderAjak();
    await flush();
    await viewSembunyi.jalankan(
      jamSembunyi.timeout.find((e) => e.delay === version.VERSION_FIRST_CHECK_MS),
    );
    check(
      "tab yang sedang tersembunyi tidak memeriksa apa pun",
      fetchLog.length === 0 && !viewSembunyi.teks().includes(version.NEW_VERSION_TEXT.title),
      `fetch=${fetchLog.length}`,
    );
    sembunyi();
    await viewSembunyi.kembaliTerlihat();
    check(
      "begitu tabnya terlihat lagi, pemeriksaan langsung berjalan",
      fetchLog.length === 1 && viewSembunyi.teks().includes(version.NEW_VERSION_TEXT.title),
      `fetch=${fetchLog.length}`,
    );
    await viewSembunyi.tutup();
    jamSembunyi.pulih();
    lepasSkrip();

    // Mode dev: dokumen tidak memuat bundel hasil build (`/src/main.tsx`).
    window.sessionStorage.clear();
    fetchLog.length = 0;
    const jamDev = jamTiruan();
    const viewDev = await renderAjak();
    await flush();
    await viewDev.kembaliTerlihat();
    check(
      "mode dev: tidak ada pemeriksaan sama sekali (tidak ada versi yang bisa basi)",
      fetchLog.length === 0 &&
        jamDev.timeout.length === 0 &&
        jamDev.interval.length === 0 &&
        !viewDev.teks().includes(version.NEW_VERSION_TEXT.title),
      `fetch=${fetchLog.length} jadwal=${jamDev.timeout.length + jamDev.interval.length}`,
    );
    await viewDev.tutup();
    jamDev.pulih();
  }

  // ── 7. Tempatnya di aplikasi: shell `/app/pos` yang asli ────────────────
  {
    const { App } = await server.ssrLoadModule("/src/App.tsx");
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        user: { name: "Uji Versi", email: "versi@mesinpos.test" },
        tenant: {
          name: "Toko Uji Versi",
          slug: "toko-uji-versi",
          storeName: "Pusat",
          vertical: "umkm",
          verticals: ["umkm"],
          planKey: "enterprise",
          role: "owner",
          createdAt: new Date().toISOString(),
          trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
        },
      }),
    );

    const bukaShell = async () => {
      const container = window.document.createElement("div");
      window.document.body.appendChild(container);
      const root = createRoot(container);
      await React.act(async () => {
        root.render(
          React.createElement(
            MemoryRouter,
            { initialEntries: ["/app/pos"] },
            React.createElement(App, null),
          ),
        );
      });
      await flush();
      await React.act(async () => {
        window.document.dispatchEvent(new window.Event("visibilitychange"));
        await new Promise((resolve) => realSetTimeout(resolve, 0));
      });
      await flush();
      return {
        teks: () => container.textContent.replace(/\s+/g, " ").trim(),
        cari: (selector) => container.querySelector(selector),
        semua: (selector) => [...container.querySelectorAll(selector)],
        async klik(label) {
          const target = [...container.querySelectorAll("button")].find((row) =>
            (row.textContent ?? "").trim().includes(label),
          );
          if (!target) throw new Error(`tombol "${label}" tidak ada`);
          await React.act(async () => {
            target.click();
          });
        },
        async tutup() {
          await React.act(async () => {
            root.unmount();
          });
          container.remove();
        },
      };
    };

    window.sessionStorage.clear();
    asal.luring = false;
    asal.status = 200;
    asal.html = null;
    asal.bundel = "index-BBBB2222.js";
    fetchLog.length = 0;
    reloadHits = 0;

    // 7a. Mode dev: dokumen tanpa bundel hasil build — shell tampil tanpa ajakan.
    const dev = await bukaShell();
    check(
      "shell /app/pos terbuka seperti biasa (halaman kasir ada)",
      dev.cari("aside") !== null && dev.teks().includes("Kasir"),
      dev.teks().slice(0, 160),
    );
    check(
      "mode dev: shell tidak menampilkan ajakan versi",
      dev.cari(`[aria-label="${version.NEW_VERSION_TEXT.label}"]`) === null,
      dev.teks().slice(0, 200),
    );
    await dev.tutup();

    // 7b. Hasil build: dokumen memuat bundel, situs sudah menyajikan yang baru.
    const lepasSkrip = pasangBundelDokumen("index-AAAA1111.js");
    const prod = await bukaShell();
    const ajakan = prod.cari(`[aria-label="${version.NEW_VERSION_TEXT.label}"]`);
    check(
      "hasil build: ajakan versi tampil di dalam shell /app",
      ajakan !== null && prod.teks().includes(version.NEW_VERSION_TEXT.title),
      prod.teks().slice(0, 240),
    );
    check(
      "ajakan berdiri di luar area halaman (bukan di dalam main)",
      ajakan !== null && ajakan.closest("main") === null,
      ajakan?.closest("main") ? "di dalam main" : "di luar main",
    );
    check(
      "hanya satu ajakan untuk satu halaman",
      prod.semua(`[aria-label="${version.NEW_VERSION_TEXT.label}"]`).length === 1,
      String(prod.semua(`[aria-label="${version.NEW_VERSION_TEXT.label}"]`).length),
    );
    check(
      "halaman kasir tetap terbaca di bawah ajakan",
      prod.teks().includes("Kasir") && prod.teks().includes("index-BBBB2222.js"),
      prod.teks().slice(0, 240),
    );
    await prod.klik(version.NEW_VERSION_TEXT.confirm);
    check(
      "tombol muat ulang di dalam shell bekerja",
      reloadHits === 1,
      String(reloadHits),
    );
    await prod.tutup();
    lepasSkrip();
    window.localStorage.removeItem("mesinpos.session.v1");
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

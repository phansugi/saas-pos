/**
 * Uji render sisi klien (happy-dom + Vite + react-dom/client).
 *
 * Kenapa ada: `tsc` dan SSR tidak bisa menangkap error yang muncul hanya saat
 * React benar-benar dirender di klien — penyebab "layar putih" yang hanya
 * terlihat di browser produksi. Skrip ini merender pohon aplikasi yang asli di
 * DOM tiruan, menjalankan efeknya, lalu memeriksa bahwa:
 *
 *   1. halaman beranda, halaman Modul, Produk, dan POS menghasilkan teks,
 *   2. tidak ada error yang dilempar ke root (React mengosongkan pohon),
 *   3. `ErrorBoundary` menangkap error render dan menampilkan pesannya.
 *
 * Usage: bun scripts/verify-render.mjs
 */
// DOM tiruan dipasang lebih dulu, lalu React **diimpor setelahnya**: `react-dom`
// memutuskan cara menangani event form saat modulnya dievaluasi, jadi urutannya
// menentukan apakah event `input` sampai ke `onChange` (lihat happy-dom-setup.mjs).
// Import dinamis dipakai karena `react-dom` (paket CJS) dimuat saat graf modul
// di-link, bukan saat badan berkas dieksekusi.
import "./happy-dom-setup.mjs";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const window = globalThis.window;
const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, Routes, Route, useNavigate } = await import("react-router-dom");

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// `window` (beserta global lain yang dipakai modul aplikasi: sesi, outbox,
// tema) sudah dipasang oleh `./happy-dom-setup.mjs` di atas.

// React 19 melaporkan error yang sudah ditangkap error boundary lewat
// `reportError`. Tanpa stub ini, error uji boundary yang memang disengaja akan
// membunuh proses dan membuat skrip keluar dengan kode 1 padahal semua cek lulus.
globalThis.reportError = (error) => {
  errors.push(`reportError: ${error?.message ?? String(error)}`);
};
window.reportError = globalThis.reportError;

const errors = [];
const originalError = console.error;
console.error = (...args) => {
  errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  originalError(...args);
};

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

let failure = null;

/** Render pohon ke DOM tiruan, jalankan efek, kembalikan teks yang terlihat. */
async function renderTree(element) {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container);
  const before = errors.length;
  await React.act(async () => {
    root.render(element);
  });
  const text = container.textContent.replace(/\s+/g, " ").trim();
  await React.act(async () => {
    root.unmount();
  });
  container.remove();
  return { text, newErrors: errors.slice(before) };
}

/**
 * Render seperti `renderTree`, tapi menyerahkan DOM-nya supaya uji bisa menekan
 * tombol yang benar-benar dipakai kasir. Dipakai untuk alur yang hanya hidup di
 * dalam dialog (mis. menerbitkan tagihan QRIS dari keranjang): teksnya saja tidak
 * membuktikan tombolnya bekerja.
 */
async function renderInteractive(element) {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container);
  const before = errors.length;
  await React.act(async () => {
    root.render(element);
  });

  const buttons = () => [...container.querySelectorAll("button")];

  return {
    text: () => container.textContent.replace(/\s+/g, " ").trim(),
    // Akses DOM, bukan hanya teksnya: dialog kasir sekarang menggambar kode QR
    // (SVG), jadi harness harus bisa memeriksa elemen yang benar-benar dirender.
    query: (selector) => container.querySelector(selector),
    queryAll: (selector) => [...container.querySelectorAll(selector)],
    click: async (label) => {
      const button = buttons().find((row) =>
        (row.textContent ?? "").trim().includes(label),
      );
      if (!button) throw new Error(`tombol "${label}" tidak ada di DOM`);
      if (button.disabled) throw new Error(`tombol "${label}" sedang nonaktif`);
      await React.act(async () => {
        button.click();
      });
    },
    /**
     * Mengklik elemen tertentu, bukan mencari lewat tulisannya: tombol berikon
     * (mis. volume − / +) tidak punya teks sama sekali, dan yang dibaca pengguna
     * maupun pembaca layar adalah `aria-label`-nya — jadi itulah alamatnya.
     */
    clickOn: async (selector) => {
      const element = container.querySelector(selector);
      if (!element) throw new Error(`elemen "${selector}" tidak ada di DOM`);
      if (element.disabled) throw new Error(`elemen "${selector}" sedang nonaktif`);
      await React.act(async () => {
        element.click();
      });
    },
    /**
     * Mengetik ke input seperti pengguna: nilai diisi lewat setter asli DOM lalu
     * event `input` dikirim, supaya React yang mengendalikan nilai itu benar-benar
     * ikut berubah (menulis `.value` langsung akan diabaikan React).
     */
    fill: async (selector, value) => {
      const input = container.querySelector(selector);
      if (!input) throw new Error(`input "${selector}" tidak ada di DOM`);
      // `textarea` punya prototype sendiri; memakai setter `HTMLInputElement`
      // padanya hanya melempar "Illegal invocation".
      const prototype =
        input instanceof window.HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
      await React.act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
    },
    /**
     * Memilih satu nilai pada `<select>` seperti pengguna memilihnya. React
     * memantau peristiwa `change` untuk select, jadi nilai barunya diset lewat
     * setter aslinya lalu diikuti peristiwa itu — bukan `element.value = …`.
     */
    select: async (selector, value) => {
      const element = container.querySelector(selector);
      if (!element) throw new Error(`select \"${selector}\" tidak ada di DOM`);
      const prototype = window.HTMLSelectElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      await React.act(async () => {
        if (setter) setter.call(element, value);
        else element.value = value;
        element.dispatchEvent(new window.Event("change", { bubbles: true }));
      });
    },
    /** Mengirim form yang sedang tampil (tombol submit dipakai jalur yang sama). */
    submit: async () => {
      const form = container.querySelector("form");
      if (!form) throw new Error("form tidak ada di DOM");
      await React.act(async () => {
        form.dispatchEvent(
          new window.Event("submit", { bubbles: true, cancelable: true }),
        );
      });
    },
    newErrors: () => errors.slice(before),
    unmount: async () => {
      await React.act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

try {
  const { App } = await server.ssrLoadModule("/src/App.tsx");
  const { SessionProvider } = await server.ssrLoadModule("/src/lib/session.tsx");
  const { BackendProvider, StoreProvider } = await server.ssrLoadModule(
    "/src/lib/store/index.tsx",
  );
  const { ErrorBoundary } = await server.ssrLoadModule(
    "/src/components/ErrorBoundary.tsx",
  );

  function providers(page) {
    return React.createElement(
      MemoryRouter,
      { initialEntries: ["/app"] },
      React.createElement(
        SessionProvider,
        null,
        React.createElement(
          BackendProvider,
          null,
          React.createElement(StoreProvider, null, page),
        ),
      ),
    );
  }

  // 1. Beranda publik.
  {
    const { text } = await renderTree(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        React.createElement(ErrorBoundary, null, React.createElement(App, null)),
      ),
    );
    check("beranda merender teks", text.length > 200, `panjang=${text.length}`);
    check(
      "beranda memuat navigasi produk",
      text.includes("MesinPOS") || text.includes("Mesin POS"),
      text.slice(0, 80),
    );
    // Roadmap di beranda harus mengikuti keadaan kode — dan lencananya harus
    // dibaca **per kartu**, bukan sekadar "ada kata Berjalan di suatu tempat":
    // Phase 1–4 sedang dikerjakan (**Berjalan**), sedangkan Phase 5 & 6 sudah
    // selesai seluruh klausanya — punya kode, gerbang paket, dan harness
    // (**Selesai**) — jadi tidak ada lagi label “Rencana”.
    //
    const STATUS_ROADMAP = ["Berjalan", "Selesai", "Rencana"];
    // Urutan di dalam satu kartu: nomor fase → lencana status → judul → lingkup,
    // jadi pola `Phase N … status` mengikat status ke kartunya, dan tidak bisa
    // lolos hanya karena fase lain memakai kata yang sama.
    const statusPerFase = (phase) => {
      const at = text.indexOf(phase);
      if (at < 0) return "-";
      const around = text.slice(at, at + 200);
      return STATUS_ROADMAP.find((status) => around.includes(status)) ?? "-";
    };
    check(
      "beranda menandai Phase 1–4 berjalan dan Phase 5–6 selesai",
      text.includes("Advanced Supply Chain") &&
        text.includes("Enterprise Intelligence") &&
        text.includes("Dedicated Support & Franchise Scale") &&
        text.includes("Realtime Sync & Digital Payment") &&
        statusPerFase("Phase 1") === "Berjalan" &&
        statusPerFase("Phase 2") === "Berjalan" &&
        statusPerFase("Phase 3") === "Berjalan" &&
        statusPerFase("Phase 4") === "Berjalan" &&
        statusPerFase("Phase 5") === "Selesai" &&
        statusPerFase("Phase 6") === "Selesai" &&
        (text.match(/Rencana/g) ?? []).length === 0,
      ["Phase 1", "Phase 2", "Phase 3", "Phase 4", "Phase 5", "Phase 6"]
        .map((phase) => `${phase}=${statusPerFase(phase)}`)
        .join(" "),
    );
    check(
      "beranda menyebut lingkup Phase 3 yang benar-benar jalan",
      text.includes("multi-gudang") &&
        text.includes("stock opname berjejak audit") &&
        text.includes("PR → PO → GRN") &&
        text.includes("bayar sekaligus"),
      text.slice(0, 200),
    );
    check(
      "beranda menyebut lingkup Phase 4 yang benar-benar jalan",
      text.includes("tren omzet") &&
        text.includes("margin kotor") &&
        text.includes("temuan otomatis") &&
        text.includes("proyeksi akhir periode dari laju hari penuh") &&
        text.includes("produk yang sering dibeli bersama") &&
        text.includes("peran kustom") &&
        text.includes("API & webhook") &&
        text.includes("kunci API") &&
        text.includes("HMAC") &&
        // Tiga klausa Phase 4 sudah berjalan: tidak boleh ada lagi janji
        // "menyusul" di lingkup fase ini.
        !text.includes("menyusul"),
      text.slice(0, 200),
    );
    check(
      "beranda menyebut lingkup Phase 5 yang benar-benar jalan",
      text.includes("tiket dukungan dengan janji tanggap") &&
        text.includes("eskalasi ke manajer akun") &&
        text.includes("laporan lintas cabang beranggaran per cabang") &&
        text.includes("tidak tumbuh mengikuti jumlah cabang"),
      text.slice(0, 400),
    );
  }

  // 1b. Header beranda menempel di atas saat halaman digulir.
  //
  //     Layout tidak bisa dihitung di DOM tiruan, jadi yang diperiksa adalah
  //     syarat yang membuat `sticky` benar-benar bekerja — dan penyebab paling
  //     sering ia diam-diam mati: leluhur dengan `overflow` selain `clip`
  //     (mis. `overflow-x-hidden`) menjadi **wadah gulir** sendiri, sehingga
  //     header menempel ke wadah itu alih-alih ke layar.
  {
    const view = await renderInteractive(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        React.createElement(ErrorBoundary, null, React.createElement(App, null)),
      ),
    );
    const header = view.query("header");
    check("beranda punya header", Boolean(header), "header");
    const headerClasses = (header?.getAttribute("class") ?? "").split(/\s+/);
    check(
      "header beranda menempel di atas (sticky + top-0)",
      headerClasses.includes("sticky") && headerClasses.includes("top-0"),
      headerClasses.join(" "),
    );
    check(
      "header beranda berada di atas konten saat digulir (z-50)",
      headerClasses.some((name) => /^z-\d+$/.test(name)) &&
        Number((headerClasses.find((name) => /^z-\d+$/.test(name)) ?? "z-0").slice(2)) >= 40,
      headerClasses.join(" "),
    );

    const ancestors = [];
    let node = header?.parentElement ?? null;
    while (node && node !== window.document.body) {
      ancestors.push(node.getAttribute("class") ?? "");
      node = node.parentElement;
    }
    const scrollContainers = ancestors.filter((value) =>
      /\boverflow(-[xy])?-(hidden|auto|scroll)\b/.test(value),
    );
    check(
      "tidak ada leluhur header yang menjadi wadah gulir sendiri",
      scrollContainers.length === 0,
      scrollContainers.join(" | ") || ancestors.join(" | "),
    );
    /*
      Tombol layar penuh sudah tersedia **sebelum** masuk: beranda tidak punya
      sidebar, jadi tombolnya hanya meminta layar penuh peramban — dan kalimat
      penjelasnya tidak boleh menjanjikan sidebar yang tidak ada di sana.
    */
    const tombolBeranda = view.query('[aria-label="Layar penuh"]');
    check(
      "header beranda punya tombol layar penuh",
      Boolean(tombolBeranda) &&
        tombolBeranda?.getAttribute("aria-pressed") === "false" &&
        (tombolBeranda?.getAttribute("title") ?? "").includes("layar penuh") &&
        !(tombolBeranda?.getAttribute("title") ?? "").includes("sidebar"),
      `tombol=${Boolean(tombolBeranda)} title="${tombolBeranda?.getAttribute("title") ?? ""}"`,
    );
    await React.act(async () => {
      tombolBeranda?.click();
    });
    check(
      "menekan tombol di beranda menandainya aktif tanpa mengubah header",
      view.query('[aria-label="Keluar dari layar penuh"]')?.getAttribute("aria-pressed") ===
        "true" &&
        Boolean(view.query("header")) &&
        (view.query("header")?.getAttribute("class") ?? "").includes("sticky"),
      `pressed=${view.query('[aria-label="Keluar dari layar penuh"]')?.getAttribute("aria-pressed")}`,
    );
    await React.act(async () => {
      view.query('[aria-label="Keluar dari layar penuh"]')?.click();
    });
    check(
      "menekan sekali lagi mengembalikan tombol beranda ke keadaan semula",
      Boolean(view.query('[aria-label="Layar penuh"]')) &&
        view.query('[aria-label="Keluar dari layar penuh"]') === null,
      `aktif=${Boolean(view.query('[aria-label="Keluar dari layar penuh"]'))}`,
    );

    check(
      "header beranda tanpa error konsol",
      view.newErrors().length === 0,
      view.newErrors().join(" | ").slice(0, 200),
    );
    await view.unmount();
  }

  // 1c. Notis kegagalan penyambungan workspace (isi `store.error`).
  //
  //     Sebelum ada komponen ini, penolakan provisioning tidak pernah sampai ke
  //     layar: setiap aksi hanya menjawab “Tenant belum siap. Coba lagi sebentar
  //     lagi.” — pesan yang menyuruh menunggu, padahal penolakan seperti akun
  //     platform tidak berubah dengan menunggu. Karena itu yang diuji di sini
  //     adalah janji komponennya: kalimat server apa adanya, petunjuk yang
  //     berbeda untuk penolakan akun platform, dan tidak ada notis saat tidak ada
  //     galat.
  {
    const { ProvisioningNotice } = await server.ssrLoadModule(
      "/src/components/ProvisioningNotice.tsx",
    );
    // Kalimat penolakannya diambil dari aturan yang sama dengan yang dipakai
    // server, jadi cek ini tidak bisa lolos hanya karena teksnya disalin ulang.
    const { PLATFORM_MEMBERSHIP_REFUSAL } = await server.ssrLoadModule(
      "/src/convex/lib/platform.ts",
    );

    const platformCase = await renderInteractive(
      React.createElement(ProvisioningNotice, {
        error: `Uncaught Error: ${PLATFORM_MEMBERSHIP_REFUSAL}`,
      }),
    );
    const platformText = platformCase.text();
    check(
      "kegagalan sambung-tenant tampil sebagai peringatan, bukan hilang",
      Boolean(platformCase.query('[role="alert"]')) &&
        platformText.includes("Workspace belum tersambung ke server"),
      platformText.slice(0, 160),
    );
    check(
      "notis menyebut kalimat server apa adanya (tanpa diringkas klien)",
      platformText.includes(PLATFORM_MEMBERSHIP_REFUSAL),
      platformText.slice(0, 240),
    );
    check(
      "penolakan akun platform diberi petunjuk sesuai aturannya (bukan ‘pakai email lain’)",
      platformText.includes("boleh punya workspace miliknya sendiri") &&
        platformText.includes("tidak bisa menjadi anggota workspace orang lain") &&
        !platformText.includes("masuk dengan email lain") &&
        !platformText.includes("Muat ulang halaman"),
      platformText.slice(0, 320),
    );
    check(
      "notis akun platform tanpa error konsol",
      platformCase.newErrors().length === 0,
      platformCase.newErrors().join(" | ").slice(0, 200),
    );
    await platformCase.unmount();

    const genericCase = await renderInteractive(
      React.createElement(ProvisioningNotice, { error: "Server Error" }),
    );
    const genericText = genericCase.text();
    check(
      "galat lain memakai petunjuk umum, bukan petunjuk akun platform",
      genericText.includes("Server Error") &&
        genericText.includes("Muat ulang halaman") &&
        !genericText.includes("masuk dengan email lain"),
      genericText.slice(0, 240),
    );
    await genericCase.unmount();

    // Keanggotaan yang dinonaktifkan pemiliknya: keadaan ini dulu menjatuhkan
    // render (setiap langganan dijawab “bukan anggota aktif”), jadi yang dilihat
    // pengguna adalah “Halaman ini gagal dimuat”. Sekarang kalimatnya tampil di
    // notis, dan petunjuknya menyebut tindakan yang benar-benar menolong —
    // mengaktifkan kembali keanggotaannya, bukan memuat ulang halaman.
    const { MEMBERSHIP_SUSPENDED_NOTE } = await server.ssrLoadModule(
      "/src/convex/lib/team.ts",
    );
    const suspendedCase = await renderInteractive(
      React.createElement(ProvisioningNotice, {
        error: `Uncaught Error: ${MEMBERSHIP_SUSPENDED_NOTE}`,
      }),
    );
    const suspendedText = suspendedCase.text();
    check(
      "keanggotaan yang dinonaktifkan dijelaskan sebagai peringatan, bukan halaman gagal",
      Boolean(suspendedCase.query('[role="alert"]')) &&
        suspendedText.includes(MEMBERSHIP_SUSPENDED_NOTE),
      suspendedText.slice(0, 240),
    );
    check(
      "petunjuknya menyuruh menghubungi pemilik, bukan memuat ulang halaman",
      suspendedText.includes("Minta pemilik bisnis mengaktifkan kembali") &&
        !suspendedText.includes("Muat ulang halaman"),
      suspendedText.slice(0, 320),
    );
    check(
      "notis keanggotaan nonaktif tanpa error konsol",
      suspendedCase.newErrors().length === 0,
      suspendedCase.newErrors().join(" | ").slice(0, 200),
    );
    await suspendedCase.unmount();

    const emptyCase = await renderInteractive(
      React.createElement(ProvisioningNotice, { error: null }),
    );
    check(
      "tanpa galat notis tidak muncul sama sekali",
      emptyCase.query('[role="alert"]') === null &&
        emptyCase.text().length === 0,
      emptyCase.text().slice(0, 120),
    );
    await emptyCase.unmount();

    // Yang menentukan kegagalan provisioning terlihat atau tidak bukan
    // komponennya sendiri, melainkan apakah `store.error` benar-benar sampai ke
    // shell `/app`. Nilainya karena itu diambil dari store demo yang **asli**
    // (bentuk `StoreApi` yang diuji tetap yang sebenarnya), lalu hanya `error`-nya
    // yang diganti.
    {
      const { AppLayout } = await server.ssrLoadModule("/src/layouts/AppLayout.tsx");
      const { StoreContext, useStore } = await server.ssrLoadModule(
        "/src/lib/store/context.ts",
      );

      window.localStorage.setItem(
        "mesinpos.session.v1",
        JSON.stringify({
          user: { name: "Uji Sambung", email: "sambung@mesinpos.test" },
          tenant: {
            name: "Toko Uji Sambung",
            slug: "toko-uji-sambung",
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

      let captured = null;
      const Probe = () => {
        captured = useStore();
        return null;
      };
      await renderTree(providers(React.createElement(Probe, null)));
      check(
        "store demo bisa dibaca sebagai sumber nilai untuk uji shell",
        Boolean(
          captured &&
            (captured.error === null || typeof captured.error === "string"),
        ),
        String(captured?.error),
      );

      const shell = (error) =>
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/app"] },
          React.createElement(
            SessionProvider,
            null,
            React.createElement(
              StoreContext.Provider,
              { value: { ...captured, error } },
              React.createElement(AppLayout, null),
            ),
          ),
        );

      const broken = await renderInteractive(shell(PLATFORM_MEMBERSHIP_REFUSAL));
      const brokenText = broken.text();
      check(
        "shell /app menampilkan kegagalan sambung-tenant dari store",
        Boolean(broken.query('[role="alert"]')) &&
          brokenText.includes("Workspace belum tersambung ke server") &&
          brokenText.includes(PLATFORM_MEMBERSHIP_REFUSAL),
        brokenText.slice(0, 240),
      );
      check(
        "shell tetap terpakai (sidebar & header ada) walau workspace belum tersambung",
        brokenText.includes("Dashboard") && brokenText.includes("Pusat"),
        brokenText.slice(0, 240),
      );
      await broken.unmount();

      const healthy = await renderInteractive(shell(null));
      check(
        "shell tanpa galat tidak menampilkan notis",
        healthy.query('[role="alert"]') === null &&
          !healthy.text().includes("Workspace belum tersambung ke server"),
        healthy.text().slice(0, 160),
      );
      await healthy.unmount();

      window.localStorage.removeItem("mesinpos.session.v1");
    }
  }

  // 1d. Sidebar & header backstage diam saat halaman digulir.
  //
  //     Jaminannya **bukan** `sticky`: posisi menempel tidak bisa dihitung di DOM
  //     tiruan, dan bergantung padanya pernah membuat dua-duanya tetap ikut
  //     terangkat saat digulir. Yang diperiksa karena itu susunan shell-nya —
  //     shell setinggi layar yang tidak bergulir sendiri, dengan satu area gulir
  //     (`main`), dan header serta sidebar berada **di luar** area gulir itu.
  //     Dengan begitu keduanya tidak punya cara untuk ikut bergerak.
  {
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        user: { name: "Uji Gulir", email: "gulir@mesinpos.test" },
        tenant: {
          name: "Toko Uji Gulir",
          slug: "toko-uji-gulir",
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

    // Dijalankan lewat `App` yang asli — bukan `AppLayout` sendirian — supaya yang
    // diuji jalur yang benar-benar dipakai pengguna: rute `/app/pos` → gerbang sesi
    // & tenant → shell → halaman kasir. Halaman POS dipilih karena isinya paling
    // panjang (di situlah gulir nyata), jadi shell-nya sekaligus terbukti memuat
    // halaman sungguhan di dalam satu-satunya area gulirnya.
    const view = await renderInteractive(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/app/pos"] },
        React.createElement(ErrorBoundary, null, React.createElement(App, null)),
      ),
    );

    const aside = view.query("aside");
    check(
      "shell /app/pos benar-benar terbuka (sidebar & halaman kasir ada)",
      Boolean(aside) && view.text().includes("Kasir"),
      `aside=${Boolean(aside)} teks=${view.text().slice(0, 120)}`,
    );
    const asideClasses = (aside?.getAttribute("class") ?? "").split(/\s+/);
    check(
      "sidebar memakai permukaan gelapnya sendiri, bukan latar halaman",
      asideClasses.includes("sidebar-surface") &&
        asideClasses.includes("text-sidebar-foreground"),
      asideClasses.join(" "),
    );

    const header = view.query("header");
    check("backstage punya header", Boolean(header), "header");
    const headerClasses = (header?.getAttribute("class") ?? "").split(/\s+/);
    check(
      "header backstage berlatar sendiri supaya isi tidak tembus saat digulir",
      headerClasses.includes("glass"),
      headerClasses.join(" "),
    );

    // Shell setinggi layar yang tidak bergulir sendiri — inilah yang membuat
    // header & sidebar diam, tanpa bergantung pada `sticky`.
    const shellClasses = (aside?.parentElement?.getAttribute("class") ?? "").split(/\s+/);
    check(
      "shell backstage setinggi layar lewat kelas khusus, bukan h-screen/h-dvh",
      shellClasses.includes("app-shell-height") &&
        !shellClasses.some((name) => /^h-(screen|dvh|svh|lvh)$/.test(name)),
      shellClasses.join(" "),
    );
    check(
      "shell backstage sendiri tidak bergulir (overflow-hidden)",
      shellClasses.includes("overflow-hidden"),
      shellClasses.join(" "),
    );
    // Kelas itu harus benar-benar ada di CSS, dengan cadangan 100vh **dan**
    // penggantinya 100dvh — kalau salah satu hilang, tingginya salah di salah
    // satu jenis browser (lihat catatan di `src/index.css`).
    const appCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    check(
      "app-shell-height punya 100vh sebagai cadangan dan 100dvh sebagai pengganti",
      /\.app-shell-height\s*\{[^}]*height:\s*100vh;/.test(appCss) &&
        /@supports\s*\(height:\s*100dvh\)\s*\{[^}]*\.app-shell-height\s*\{[^}]*height:\s*100dvh;/.test(
          appCss,
        ),
      appCss.slice(appCss.indexOf(".app-shell-height"), appCss.indexOf(".app-shell-height") + 200),
    );

    const main = view.query("main");
    check("backstage punya kolom isi", Boolean(main), "main");
    const mainClasses = (main?.getAttribute("class") ?? "").split(/\s+/);
    check(
      "kolom isi yang punya gulirannya sendiri (overflow-y-auto)",
      mainClasses.includes("overflow-y-auto"),
      mainClasses.join(" "),
    );
    /*
      Laporan pengguna: “di halaman Pengaturan, setelah sampai paling bawah halaman
      tetap bisa di-scroll ke atas — sidebar, header, dan halaman naik semua”.
      Sebabnya elemen `sr-only` (position: absolute tanpa leluhur ber-posisi) di
      dalam halaman: containing block-nya di luar area gulir ini, jadi klip
      `overflow` di sini tidak berlaku untuk mereka dan tinggi **dokumen** ikut
      memanjang. `relative` di kolom isi mengembalikan mereka ke dalam klip ini;
      perilakunya dibuktikan di peramban sungguhan oleh `verify-browser-scroll.mjs`.
    */
    check(
      "kolom isi jadi acuan posisi elemen absolut halaman (teks sr-only ikut terklip di sini)",
      mainClasses.includes("relative") &&
        mainClasses.includes("overflow-y-auto") &&
        mainClasses.includes("overflow-x-hidden"),
      mainClasses.join(" "),
    );
    check(
      "header & sidebar berada di luar area gulir itu",
      Boolean(main && header && aside) &&
        !main.contains(header) &&
        !main.contains(aside),
      `header di dalam main=${main?.contains(header)} · sidebar di dalam main=${main?.contains(aside)}`,
    );
    check(
      "shell backstage tanpa error konsol",
      view.newErrors().length === 0,
      view.newErrors().join(" | ").slice(0, 200),
    );

    /*
      Tombol **Layar penuh**: sidebar disembunyikan, header tetap ada. Header
      sengaja tidak ikut hilang — di situlah tombol keluarnya, dan pemakai ponsel
      tidak punya tombol Esc. Harness ini berjalan di DOM tiruan yang tidak punya
      Fullscreen API, jadi yang terbukti di sini justru janji terpentingnya:
      “tanpa sidebar” tidak bergantung pada izin peramban.
    */
    const tombolLayarPenuh = () => view.query('[aria-label="Layar penuh"]');
    check(
      "header backstage punya tombol layar penuh yang belum aktif",
      Boolean(tombolLayarPenuh()) &&
        tombolLayarPenuh()?.getAttribute("aria-pressed") === "false" &&
        Boolean(view.query("aside")),
      `tombol=${Boolean(tombolLayarPenuh())} pressed=${tombolLayarPenuh()?.getAttribute("aria-pressed")}`,
    );

    /** Kelas sidebar menentukan apakah ia bisa tampil di breakpoint mana pun. */
    const kelasSidebar = () =>
      (view.query("aside")?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

    await React.act(async () => {
      tombolLayarPenuh()?.click();
    });
    check(
      "menekan layar penuh menyembunyikan sidebar (tidak pernah bisa tampil)",
      kelasSidebar().includes("hidden") &&
        !kelasSidebar().includes("lg:flex") &&
        // Sidebar tetap di DOM (nav tidak dibongkar-pasang) tetapi tidak punya
        // satu pun kelas display yang bisa memunculkannya lagi.
        !kelasSidebar().some((name) => /^(flex|block|grid|lg:(flex|block|grid))$/.test(name)),
      kelasSidebar().join(" "),
    );
    const keluarLayarPenuh = () => view.query('[aria-label="Keluar dari layar penuh"]');
    check(
      "header, halaman kasir, dan tombol keluarnya tetap ada tanpa sidebar",
      Boolean(keluarLayarPenuh()) &&
        keluarLayarPenuh()?.getAttribute("aria-pressed") === "true" &&
        Boolean(view.query("header")) &&
        view
          .queryAll("header button")
          .some((button) => (button.textContent ?? "").includes("Keluar")) &&
        view.text().includes("Kasir"),
      `header=${Boolean(view.query("header"))} keluar=${Boolean(keluarLayarPenuh())}`,
    );
    check(
      "kolom isi tetap satu-satunya area gulir saat sidebar disembunyikan",
      Boolean(view.query("main")) &&
        view.query("main")?.getAttribute("class")?.includes("overflow-y-auto") === true,
      view.query("main")?.getAttribute("class") ?? "main tidak ada",
    );

    await React.act(async () => {
      keluarLayarPenuh()?.click();
    });
    check(
      "menekan sekali lagi memunculkan kembali sidebar dengan permukaannya",
      kelasSidebar().includes("sidebar-surface") &&
        kelasSidebar().includes("lg:flex") &&
        Boolean(tombolLayarPenuh()) &&
        tombolLayarPenuh()?.getAttribute("aria-pressed") === "false",
      kelasSidebar().join(" "),
    );
    check(
      "mode layar penuh tidak memunculkan error konsol",
      view.newErrors().length === 0,
      view.newErrors().join(" | ").slice(0, 200),
    );

    await view.unmount();
    window.localStorage.removeItem("mesinpos.session.v1");
  }

  // 1d-bis. Tombol **menu (burger)** di header backstage. Permintaannya: kalau
  //         layar sedang mode layar penuh **atau** dilihat dari HP/layar kecil,
  //         tombol menu muncul di kiri atas header. Yang diperiksa di sini
  //         perilakunya, bukan hanya kelasnya: membuka panel, memilih menu,
  //         menutup lewat Esc & latar, dan kekhususan tiap keadaan (panel di luar
  //         layar penuh kembali statik di layar lebar; di layar penuh tetap
  //         melayang).
  {
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        user: { name: "Uji Menu Ponsel", email: "menu@mesinpos.test" },
        tenant: {
          name: "Toko Uji Menu",
          slug: "toko-uji-menu",
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

    const view = await renderInteractive(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/app/pos"] },
        React.createElement(ErrorBoundary, null, React.createElement(App, null)),
      ),
    );

    const tombolMenu = () => view.query('[data-testid="sidebar-menu-button"]');
    const tombolLayarPenuh = () => view.query('[aria-label="Layar penuh"]');
    const tombolKeluarPenuh = () => view.query('[aria-label="Keluar dari layar penuh"]');
    const latarPanel = () => view.query('[data-testid="sidebar-backdrop"]');
    const kelasTombol = () =>
      (tombolMenu()?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    const kelasAside = () =>
      (view.query("aside")?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    const tekan = async (element) => {
      await React.act(async () => {
        element?.click();
      });
    };

    check(
      "tombol menu ada di paling kiri header, dalam keadaan tertutup",
      Boolean(tombolMenu()) &&
        view.query("header")?.firstElementChild?.firstElementChild === tombolMenu() &&
        tombolMenu()?.getAttribute("aria-label") === "Buka menu" &&
        tombolMenu()?.getAttribute("aria-expanded") === "false" &&
        tombolMenu()?.getAttribute("aria-controls") === "app-sidebar",
      `label=${tombolMenu()?.getAttribute("aria-label")} expanded=${tombolMenu()?.getAttribute("aria-expanded")}`,
    );
    check(
      "di layar kecil tombolnya tampil dan panelnya masih tertutup",
      kelasTombol().includes("inline-flex") &&
        kelasTombol().includes("lg:hidden") &&
        !latarPanel() &&
        kelasAside().includes("lg:flex") &&
        !kelasAside().includes("fixed"),
      `tombol=${kelasTombol().join(" ")} · sidebar=${kelasAside().join(" ")}`,
    );

    await tekan(tombolMenu());
    check(
      "menekan tombol menu membuka panel navigasi di atas halaman",
      Boolean(latarPanel()) &&
        kelasAside().includes("fixed") &&
        kelasAside().includes("left-0") &&
        kelasAside().includes("z-40") &&
        // Panelnya mulai di bawah header, jadi tombol yang membukanya tidak
        // pernah tertutup panelnya sendiri (di peramban sungguhan itu membuat
        // klik kedua tertelan — lihat `verify-browser-menu.mjs`).
        kelasAside().includes("top-16") &&
        // Di luar layar penuh panelnya kembali statik begitu layarnya lebar.
        kelasAside().includes("lg:static") &&
        tombolMenu()?.getAttribute("aria-expanded") === "true" &&
        tombolMenu()?.getAttribute("aria-label") === "Tutup menu",
      `latar=${Boolean(latarPanel())} · sidebar=${kelasAside().join(" ")}`,
    );
    check(
      "header tetap di atas latar & panel, jadi tombolnya tidak ikut tertutup",
      (view.query("header")?.getAttribute("class") ?? "").split(/\s+/).includes("z-40") &&
        (view.query("header")?.getAttribute("class") ?? "").split(/\s+/).includes("relative"),
      view.query("header")?.getAttribute("class") ?? "header tidak ada",
    );

    // Bug yang ditemukan uji peramban: panelnya dulu setinggi layar sehingga
    // menutupi tombol yang membukanya — klik kedua tertelan panelnya sendiri.
    await tekan(tombolMenu());
    check(
      "menekan tombolnya lagi menutup panelnya (tombolnya tidak pernah tertutup panel)",
      !latarPanel() &&
        !kelasAside().includes("fixed") &&
        tombolMenu()?.getAttribute("aria-expanded") === "false",
      `latar=${Boolean(latarPanel())} · sidebar=${kelasAside().join(" ")}`,
    );
    await tekan(tombolMenu());

    await tekan(latarPanel());
    check(
      "menekan latar penutup menutup panelnya, sidebar kembali statik",
      !latarPanel() &&
        kelasAside().includes("lg:flex") &&
        !kelasAside().includes("fixed") &&
        tombolMenu()?.getAttribute("aria-expanded") === "false",
      `latar=${Boolean(latarPanel())} · sidebar=${kelasAside().join(" ")}`,
    );

    await tekan(tombolMenu());
    await React.act(async () => {
      document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    });
    check(
      "Esc menutup panelnya tanpa harus mengklik latarnya",
      !latarPanel() && !kelasAside().includes("fixed") && kelasAside().includes("lg:flex"),
      `latar=${Boolean(latarPanel())} · sidebar=${kelasAside().join(" ")}`,
    );

    await tekan(tombolMenu());
    const menuLaporan = view
      .queryAll("aside a")
      .find((link) => (link.textContent ?? "").trim() === "Laporan");
    await tekan(menuLaporan);
    check(
      "memilih menu menutup panelnya dan halaman tujuannya benar-benar terbuka",
      Boolean(menuLaporan) &&
        !latarPanel() &&
        !kelasAside().includes("fixed") &&
        view.text().includes("Omzet per metode bayar"),
      `latar=${Boolean(latarPanel())} · teks=${view.text().slice(0, 160)}`,
    );

    // Layar penuh: tombol menu harus tetap ada di lebar mana pun, dan panelnya
    // tetap melayang (sidebar statiknya memang dimatikan di mode itu).
    await tekan(tombolMenu());
    await tekan(tombolLayarPenuh());
    check(
      "menekan layar penuh menutup panel menunya lebih dulu",
      !latarPanel() &&
        Boolean(tombolKeluarPenuh()) &&
        kelasAside().includes("hidden") &&
        !kelasAside().some((name) => /^(flex|block|grid|lg:flex)$/.test(name)),
      `latar=${Boolean(latarPanel())} · sidebar=${kelasAside().join(" ")}`,
    );
    check(
      "di layar penuh tombol menu tampil di lebar mana pun (tanpa lg:hidden)",
      Boolean(tombolMenu()) &&
        kelasTombol().includes("inline-flex") &&
        !kelasTombol().includes("lg:hidden"),
      kelasTombol().join(" "),
    );

    await tekan(tombolMenu());
    check(
      "di layar penuh panelnya tetap melayang, tidak kembali statik di layar lebar",
      Boolean(latarPanel()) &&
        kelasAside().includes("fixed") &&
        !kelasAside().includes("lg:static") &&
        !(latarPanel()?.getAttribute("class") ?? "").includes("lg:hidden"),
      `latar=${latarPanel()?.getAttribute("class")} · sidebar=${kelasAside().join(" ")}`,
    );

    await tekan(tombolMenu());
    await tekan(tombolKeluarPenuh());
    check(
      "keluar dari layar penuh mengembalikan tombol menu ke layar kecil saja",
      kelasTombol().includes("lg:hidden") &&
        Boolean(tombolLayarPenuh()) &&
        kelasAside().includes("lg:flex"),
      `tombol=${kelasTombol().join(" ")} · sidebar=${kelasAside().join(" ")}`,
    );
    check(
      "alur tombol menu tanpa error konsol",
      view.newErrors().length === 0,
      view.newErrors().join(" | ").slice(0, 200),
    );

    await view.unmount();
    window.localStorage.removeItem("mesinpos.session.v1");
  }

  // 1e. Penanda sumber data di header backstage (“Terhubung ke server” / “Data
  //     demo”). Yang diperiksa adalah **kalimat yang dilihat pengguna**, bukan
  //     nilai di store: badge ini dulu menulis merek backend-nya (“Terhubung
  //     Convex”), padahal yang perlu diketahui pengguna hanya tersambung atau
  //     tidak — dan itu juga yang menjelaskan arti warnanya.
  {
    const { AppLayout } = await server.ssrLoadModule("/src/layouts/AppLayout.tsx");
    const { StoreContext, useStore } = await server.ssrLoadModule(
      "/src/lib/store/context.ts",
    );

    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        user: { name: "Uji Sumber", email: "sumber@mesinpos.test" },
        tenant: {
          name: "Toko Uji Sumber",
          slug: "toko-uji-sumber",
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

    // Nilai store diambil dari store yang benar-benar dipakai aplikasi; hanya
    // `source`-nya yang diganti, supaya kedua keadaan badge bisa diperiksa tanpa
    // bergantung env workspace.
    let store = null;
    const Probe = () => {
      store = useStore();
      return null;
    };
    await renderTree(providers(React.createElement(Probe, null)));
    check("store bisa dibaca untuk uji penanda sumber data", Boolean(store), String(store));

    async function shellWithSource(source) {
      const view = await renderInteractive(
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/app"] },
          React.createElement(
            SessionProvider,
            null,
            React.createElement(
              StoreContext.Provider,
              { value: { ...store, source } },
              React.createElement(AppLayout, null),
            ),
          ),
        ),
      );
      const summary = {
        text: view.text(),
        // Dituju ke lencananya sendiri, bukan “elemen pertama yang punya title”:
        // header kini juga memuat tombol menu yang punya title, dan cek ini soal
        // penanda sumber datanya.
        title:
          view.query('[data-testid="data-source-badge"]')?.getAttribute("title") ?? "",
      };
      await view.unmount();
      return summary;
    }

    const terhubung = await shellWithSource("convex");
    check(
      "penanda sumber data menyebut “server”, bukan merek backend-nya",
      terhubung.text.includes("Terhubung ke server") &&
        !terhubung.text.includes("Convex"),
      terhubung.text.slice(0, 160),
    );
    check(
      "penanda sumber data menjelaskan artinya lewat tooltip",
      terhubung.title.includes("server aplikasi"),
      terhubung.title || "tanpa title",
    );

    const demo = await shellWithSource("demo");
    check(
      "tanpa server, penandanya tetap jujur bilang data demo",
      demo.text.includes("Data demo") && demo.title.includes("data contoh"),
      demo.title || demo.text.slice(0, 160),
    );

    window.localStorage.removeItem("mesinpos.session.v1");
  }

  // 2. Halaman di balik gerbang sesi, dirender langsung dengan provider yang sama.
  const pages = [
    ["ModulesPage", "/src/pages/ModulesPage.tsx", "Modul plug-in"],
    // Pengaturan workspace (PPN): halaman yang setelannya mengubah angka di
    // setiap struk dan di tagihan langganan.
    ["SettingsPage", "/src/pages/SettingsPage.tsx", "Setelan PPN"],
    ["ProductsPage", "/src/pages/ProductsPage.tsx", "Atur harga"],
    ["PosPage", "/src/pages/PosPage.tsx", "Keranjang kosong"],
    ["DashboardPage", "/src/pages/DashboardPage.tsx", null],
    ["SubscriptionPage", "/src/pages/SubscriptionPage.tsx", null],
    ["ShiftPage", "/src/pages/ShiftPage.tsx", null],
    ["ReportsPage", "/src/pages/ReportsPage.tsx", null],
    ["KdsPage", "/src/pages/KdsPage.tsx", null],
    ["ReceivablesPage", "/src/pages/ReceivablesPage.tsx", "Piutang & Limit Kredit"],
    ["MembersPage", "/src/pages/MembersPage.tsx", "Member & Diskon"],
    ["InventoryPage", "/src/pages/InventoryPage.tsx", "Gudang & Stok"],
    ["OpnamePage", "/src/pages/OpnamePage.tsx", "Stock Opname"],
    ["PurchasingPage", "/src/pages/PurchasingPage.tsx", "Pembelian"],
    ["TeamPage", "/src/pages/TeamPage.tsx", "Tim & Peran"],
    ["ApiPage", "/src/pages/ApiPage.tsx", "API & Webhook"],
    ["PaymentsPage", "/src/pages/PaymentsPage.tsx", "Pembayaran digital"],
    ["SyncPage", "/src/pages/SyncPage.tsx", "Sinkronisasi real-time"],
    // Panduan operasional dirender di sini juga: yang diperiksa bukan isi PDF-nya
    // (itu tugas scripts/verify-panduan.mjs), melainkan halaman yang menyajikan
    // berkasnya - termasuk tautan unduhannya.
    ["PanduanPage", "/src/pages/PanduanPage.tsx", "Panduan MesinPOS"],
    // Backstage platform sengaja ikut daftar ini walau di mode demo ia hanya
    // menampilkan keadaan terkuncinya — justru itu yang harus terbukti: halaman
    // akun platform tidak pernah menampilkan kontrol apa pun sebelum identitas
    // platform diperiksa server.
    ["PlatformPage", "/src/pages/PlatformPage.tsx", "Backstage platform"],
    // Halaman masuk berdiri di luar `/app` (tidak butuh sesi), tetapi tetap
    // dirender di sini supaya "layar putih" di halaman pertama produk tertangkap.
    ["AuthPage", "/src/pages/AuthPage.tsx", "Masuk atau daftar"],
  ];

  // Halaman yang catatannya dibaca pemilik toko: di situ nama backend tidak perlu
  // muncul. Backstage platform & halaman API tidak masuk daftar ini — keduanya
  // memang dokumentasi teknis, dan di sana domain layanannya harus disebut apa
  // adanya (mis. `<deployment>.convex.site`).
  const TANPA_MEREK_BACKEND = ["DashboardPage", "ReportsPage", "ShiftPage", "AuthPage"];

  for (const [name, path, marker] of pages) {
    const module = await server.ssrLoadModule(path);
    const Page = module[name];
    const { text, newErrors } = await renderTree(
      providers(React.createElement(Page, null)),
    );
    check(`${name} merender teks`, text.length > 40, `panjang=${text.length}`);
    if (marker) {
      check(
        `${name} memuat penanda "${marker}"`,
        text.includes(marker),
        text.slice(0, 120),
      );
    }
    check(
      `${name} tanpa error konsol`,
      newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200),
    );
    // Halaman yang bicara langsung ke pemilik toko tidak menyebut merek backend:
    // yang perlu diketahui pengguna hanya “tersambung ke server atau belum”
    // (sebelum perbaikan, kalimat catatan di halaman-halaman ini menulis nama
    // backend yang dipakai).
    if (TANPA_MEREK_BACKEND.includes(name)) {
      check(
        `${name} tidak menyebut merek backend ke pengguna`,
        !text.includes("Convex"),
        text.slice(-240),
      );
    }
  }

  // 2c. Onboarding menahan formulirnya sampai identitas bisnis akun ini pasti.
  //
  //     Satu akun = satu bisnis. Kalau perangkat baru (sesi kosong) langsung
  //     disuguhi formulir “Nama bisnis”, pemilik toko yang bisnisnya sudah berdiri
  //     di server justru mendirikan bisnis kedua. Yang diuji di sini adalah janji
  //     `store.workspacePending`: selama identitas belum pasti formulirnya tidak
  //     ada, dan begitu server memastikan akun ini belum punya workspace,
  //     formulirnya muncul kembali — pengguna baru tidak boleh tertahan selamanya.
  {
    const { OnboardingPage } = await server.ssrLoadModule(
      "/src/pages/OnboardingPage.tsx",
    );
    const { StoreContext, useStore } = await server.ssrLoadModule(
      "/src/lib/store/context.ts",
    );

    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        user: { name: "Pemilik Baru", email: "baru@mesinpos.test" },
        tenant: null,
      }),
    );

    // Nilai store diambil dari store demo yang **asli**, lalu hanya status
    // pemulihan workspace-nya yang diganti — bentuk `StoreApi` yang diuji tetap
    // yang sebenarnya, bukan objek karangan uji.
    let captured = null;
    const Probe = () => {
      captured = useStore();
      return null;
    };
    await renderTree(providers(React.createElement(Probe, null)));
    check(
      "store demo bisa dibaca sebagai sumber nilai untuk uji onboarding",
      Boolean(captured) && typeof captured.workspacePending === "boolean",
      String(captured?.workspacePending),
    );

    const onboarding = (workspacePending, platformDeveloper = false) =>
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/onboarding"] },
        React.createElement(
          SessionProvider,
          null,
          React.createElement(
            StoreContext.Provider,
            { value: { ...captured, workspacePending, platformDeveloper } },
            React.createElement(OnboardingPage, null),
          ),
        ),
      );

    const menunggu = await renderTree(onboarding(true));
    check(
      "onboarding menahan formulir bisnis selama workspace dipulihkan",
      menunggu.text.includes("Memuat workspace Anda") &&
        !menunggu.text.includes("Nama bisnis"),
      menunggu.text.slice(0, 200),
    );
    check(
      "keadaan menunggu menjelaskan alasannya, bukan layar kosong",
      menunggu.text.includes("memeriksa apakah bisnis Anda sudah terdaftar") &&
        menunggu.text.includes("satu akun"),
      menunggu.text.slice(0, 300),
    );
    check(
      "onboarding yang menunggu tanpa error konsol",
      menunggu.newErrors.length === 0,
      menunggu.newErrors.join(" | ").slice(0, 200),
    );

    const siap = await renderTree(onboarding(false));
    check(
      "onboarding menampilkan formulir begitu server memastikan belum ada workspace",
      siap.text.includes("Nama bisnis") &&
        siap.text.includes("Siapkan bisnis Anda") &&
        !siap.text.includes("Memuat workspace Anda"),
      siap.text.slice(0, 200),
    );
    check(
      "onboarding yang siap tanpa error konsol",
      siap.newErrors.length === 0,
      siap.newErrors.join(" | ").slice(0, 200),
    );

    /*
      Jalan masuk backstage. Halaman `/platform` tidak punya menu di mana pun
      sebelum ini, jadi pemilik platform harus mengetik alamatnya sendiri — dan
      itulah keluhan “Backstage platform tidak ketemu”. Akun platform yang belum
      punya workspace hanya melihat halaman onboarding, jadi tautannya ada di
      sini juga. Akun biasa tetap tidak ditawari apa pun.
    */
    const pengembangOnboarding = await renderInteractive(onboarding(false, true));
    const tautanBackstage = pengembangOnboarding.query(
      '[data-testid="onboarding-backstage"]',
    );
    check(
      "akun platform developer melihat jalan masuk backstage dari onboarding",
      tautanBackstage?.getAttribute("href") === "/platform" &&
        (tautanBackstage.textContent ?? "").includes("Backstage platform"),
      `href=${tautanBackstage?.getAttribute("href")} teks=${tautanBackstage?.textContent}`,
    );
    check(
      "onboarding pengguna biasa tidak menawarkan backstage",
      !siap.text.includes("Backstage platform"),
      siap.text.slice(0, 200),
    );
    await pengembangOnboarding.unmount();

    // Tautan “Batalkan”: pendaftaran yang belum jadi **dihapus**, bukan hanya
    // ditinggalkan. Yang diuji di sini bukan tulisannya saja — tombolnya benar-
    // benar ditekan, store dipanggil, sesi perangkat dilepas, dan pengguna
    // mendarat kembali di beranda.
    check(
      "onboarding menawarkan tautan “Batalkan” beserta email yang dipakai",
      siap.text.includes("Batalkan") &&
        siap.text.includes("baru@mesinpos.test") &&
        siap.text.includes("dihapus dari sistem"),
      siap.text.slice(-320),
    );
    {
      let cancelled = 0;
      const storeDenganPelacak = {
        ...captured,
        cancelRegistration: async () => {
          cancelled += 1;
          return {
            email: "baru@mesinpos.test",
            sentence:
              "Pendaftaran dengan baru@mesinpos.test dibatalkan: email itu sudah dihapus dan bisa dipakai mendaftar lagi kapan saja.",
          };
        },
      };
      const halaman = await renderInteractive(
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/onboarding"] },
          React.createElement(
            SessionProvider,
            null,
            React.createElement(
              StoreContext.Provider,
              { value: storeDenganPelacak },
              React.createElement(
                Routes,
                null,
                React.createElement(Route, {
                  path: "/onboarding",
                  element: React.createElement(OnboardingPage, null),
                }),
                React.createElement(Route, {
                  path: "/",
                  element: React.createElement("div", null, "BERANDA PEMASARAN"),
                }),
                React.createElement(Route, {
                  path: "/auth",
                  element: React.createElement("div", null, "HALAMAN MASUK"),
                }),
              ),
            ),
          ),
        ),
      );
      await halaman.clickOn('[data-testid="batalkan-pendaftaran"]');
      // Penghapusan akun berjalan asinkron (server dihubungi lebih dulu), jadi
      // janjinya diberi kesempatan selesai **di dalam act** — tanpa itu React
      // belum memasang hasil perpindahan halaman saat teksnya dibaca.
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      check(
        "menekan “Batalkan” meminta server menghapus email pendaftaran",
        cancelled === 1,
        `cancelled=${cancelled}`,
      );
      check(
        "“Batalkan” mengembalikan pengguna ke beranda",
        halaman.text().includes("BERANDA PEMASARAN") &&
          !halaman.text().includes("Siapkan bisnis Anda"),
        halaman.text().slice(0, 200),
      );
      check(
        "sesi perangkat dilepas setelah pendaftaran dibatalkan",
        window.localStorage.getItem("mesinpos.session.v1") === null,
        String(window.localStorage.getItem("mesinpos.session.v1")).slice(0, 120),
      );
      check(
        "alur “Batalkan” tanpa error konsol",
        halaman.newErrors().length === 0,
        halaman.newErrors().join(" | ").slice(0, 200),
      );
      await halaman.unmount();
    }

    // Penolakan server (mis. akun ternyata sudah punya workspace) harus terbaca
    // sebagai pesan, dan sesinya **tidak** dilepas: pengguna masih bisa
    // melanjutkan pendaftaran, bukan terlempar ke halaman masuk tanpa penjelasan.
    {
      window.localStorage.setItem(
        "mesinpos.session.v1",
        JSON.stringify({
          user: { name: "Pemilik Baru", email: "baru@mesinpos.test" },
          tenant: null,
        }),
      );
      const pesanTolak =
        "Akun ini sudah punya workspace, jadi pendaftarannya tidak bisa dibatalkan.";
      const storeMenolak = {
        ...captured,
        cancelRegistration: async () => {
          throw new Error(pesanTolak);
        },
      };
      const ditolak = await renderInteractive(
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/onboarding"] },
          React.createElement(
            SessionProvider,
            null,
            React.createElement(
              StoreContext.Provider,
              { value: storeMenolak },
              React.createElement(OnboardingPage, null),
            ),
          ),
        ),
      );
      await ditolak.clickOn('[data-testid="batalkan-pendaftaran"]');
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      check(
        "penolakan pembatalan ditampilkan apa adanya, bukan ditelan",
        ditolak.text().includes("sudah punya workspace") &&
          ditolak.query('[data-testid="batalkan-galat"]') !== null,
        ditolak.text().slice(-240),
      );
      check(
        "pendaftaran tetap bisa dilanjutkan saat pembatalan ditolak",
        ditolak.text().includes("Siapkan bisnis Anda") &&
          window.localStorage.getItem("mesinpos.session.v1") !== null,
        ditolak.text().slice(0, 160),
      );
      await ditolak.unmount();
    }

    // Alur kategori utama: wajib dipilih sebelum trial bisa dimulai, dan pasangan
    // yang dipilih benar-benar ikut tersimpan terkunci — bukan hanya tampil di
    // layar lalu hilang.
    {
      window.localStorage.setItem(
        "mesinpos.session.v1",
        JSON.stringify({
          user: { name: "Pemilik Baru", email: "baru@mesinpos.test" },
          tenant: null,
        }),
      );
      const alur = await renderInteractive(onboarding(false));
      await alur.fill('[id="business"]', "Toko Kategori");
      await alur.fill('[id="store"]', "Cabang Kategori");
      await alur.click("Lanjut");

      check(
        "langkah modul menampilkan kategori utama beserta janji penguncian",
        Boolean(alur.query('[data-testid="onboarding-kategori-utama"]')) &&
          alur.text().includes("Dikunci permanen") &&
          alur.text().includes("tidak bisa diubah, termasuk oleh pemilik"),
        alur.text().slice(0, 600),
      );
      const tombolLanjut = () =>
        [...alur.queryAll("button")].find((row) =>
          (row.textContent ?? "").includes("Lanjut"),
        );
      check(
        "tombol Lanjut terkunci sampai kategori & subkategori dipilih",
        tombolLanjut()?.disabled === true &&
          alur.query('[data-testid="onboarding-subkategori"]').disabled === true,
        `lanjut=${tombolLanjut()?.disabled}, sub=${alur.query('[data-testid="onboarding-subkategori"]').disabled}`,
      );

      await alur.select('[data-testid="onboarding-kategori"]', "fnb");
      const opsiSub = alur.queryAll('[data-testid="onboarding-subkategori"] option');
      check(
        "subkategori yang ditawarkan hanya milik kategori terpilih",
        opsiSub.map((row) => row.value).join(",") === ",kafe,restoran,warung,bakery,katering",
        opsiSub.map((row) => row.value).join(","),
      );
      await alur.select('[data-testid="onboarding-subkategori"]', "kafe");
      check(
        "setelah pasangan lengkap, tombol Lanjut hidup",
        tombolLanjut()?.disabled === false,
        `lanjut=${tombolLanjut()?.disabled}`,
      );

      await alur.click("Lanjut");
      check(
        "langkah paket muncul setelah kategori dipilih",
        alur.text().includes("Mulai trial") && alur.text().includes("Belum ada tagihan sekarang"),
        alur.text().slice(0, 300),
      );
      await alur.click("Mulai trial");
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const sesiBaru = JSON.parse(
        window.localStorage.getItem("mesinpos.session.v1") ?? "null",
      );
      check(
        "trial dimulai dengan kategori utama terkunci di sesi workspace",
        sesiBaru?.tenant?.businessCategory?.category === "fnb" &&
          sesiBaru?.tenant?.businessCategory?.subcategory === "kafe" &&
          sesiBaru?.tenant?.businessCategory?.categoryLabel === "Makanan & Minuman" &&
          typeof sesiBaru?.tenant?.businessCategory?.lockedAt === "number",
        JSON.stringify(sesiBaru?.tenant?.businessCategory),
      );
      check(
        "alur kategori utama tanpa error konsol",
        alur.newErrors().length === 0,
        alur.newErrors().join(" | ").slice(0, 200),
      );
      await alur.unmount();
    }
    withoutSession();
  }

  // 2c-bis. Jalan masuk backstage di sidebar aplikasi.
  //
  //         Sidebar adalah pintu sehari-hari pemilik platform: dari workspace-nya
  //         sendiri ia bisa membuka `/platform`. Yang diuji: tautannya muncul
  //         **hanya** saat server menandai akun ini sebagai akun platform
  //         (`users.platformRole` → `store.platformDeveloper`), menunjuk ke
  //         `/platform`, dan tidak pernah muncul untuk pemilik bisnis biasa.
  {
    const { AppLayout } = await server.ssrLoadModule("/src/layouts/AppLayout.tsx");
    const { StoreContext, useStore } = await server.ssrLoadModule(
      "/src/lib/store/context.ts",
    );

    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        user: { name: "Pemilik Platform", email: "platform@mesinpos.test" },
        tenant: {
          name: "Workspace Platform",
          slug: "workspace-platform",
          storeName: "Pusat",
          vertical: "umkm",
          verticals: ["umkm"],
          planKey: "starter",
          role: "owner",
          createdAt: new Date().toISOString(),
          trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
        },
      }),
    );

    let captured = null;
    const Probe = () => {
      captured = useStore();
      return null;
    };
    await renderTree(providers(React.createElement(Probe, null)));

    const shell = (platformDeveloper) =>
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/app"] },
        React.createElement(
          SessionProvider,
          null,
          React.createElement(
            StoreContext.Provider,
            { value: { ...captured, platformDeveloper } },
            React.createElement(
              Routes,
              null,
              React.createElement(Route, {
                path: "/app",
                element: React.createElement(AppLayout, null),
              }),
            ),
          ),
        ),
      );

    const pemilikBisnis = await renderInteractive(shell(false));
    check(
      "sidebar pemilik bisnis biasa tidak menampilkan Backstage platform",
      !pemilikBisnis.text().includes("Backstage platform") &&
        pemilikBisnis.query('[data-testid="sidebar-backstage"]') === null,
      pemilikBisnis.text().slice(0, 300),
    );
    await pemilikBisnis.unmount();

    const akunPlatform = await renderInteractive(shell(true));
    const tautanSidebar = akunPlatform.query('[data-testid="sidebar-backstage"]');
    check(
      "sidebar akun platform developer menautkan ke /platform",
      tautanSidebar?.getAttribute("href") === "/platform" &&
        (tautanSidebar.textContent ?? "").includes("Backstage platform"),
      `href=${tautanSidebar?.getAttribute("href")} teks=${tautanSidebar?.textContent}`,
    );
    check(
      "menu backstage di sidebar tidak memunculkan error konsol",
      akunPlatform.newErrors().length === 0,
      akunPlatform.newErrors().join(" | ").slice(0, 200),
    );
    await akunPlatform.unmount();
    withoutSession();
  }

  // 2b. Halaman Langganan: tombol upgrade harus menunjuk **paket berikutnya di
  //     atas** milik tenant dan harus benar-benar bekerja. Tombol yang namanya
  //     ditulis tetap — “Upgrade ke Professional” yang ikut tampil di paket
  //     Enterprise — menawarkan paket yang lebih rendah sebagai “upgrade”, dan
  //     tanpa penangan klik ia tidak melakukan apa pun.
  {
    const { SubscriptionPage } = await server.ssrLoadModule(
      "/src/pages/SubscriptionPage.tsx",
    );

    const paketSession = (planKey) => ({
      user: { name: "Uji Langganan", email: "langganan@mesinpos.test" },
      tenant: {
        name: "Toko Uji Langganan",
        slug: "toko-uji-langganan",
        storeName: "Pusat",
        vertical: "umkm",
        verticals: ["umkm"],
        planKey,
        role: "owner",
        createdAt: new Date().toISOString(),
        trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
      },
    });

    // (a) Paket tertinggi: tidak ada paket di atasnya, jadi tidak boleh ada tombol
    //     “upgrade” sama sekali — apalagi yang menunjuk paket lebih rendah.
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify(paketSession("enterprise")),
    );
    const tertinggi = await renderInteractive(
      providers(React.createElement(SubscriptionPage, null)),
    );
    const tertinggiText = tertinggi.text();
    check(
      "di paket tertinggi tidak ada tombol upgrade ke paket yang lebih rendah",
      !tertinggiText.includes("Upgrade ke") &&
        !tertinggiText.includes("dengan Professional") &&
        tertinggiText.includes("Paket tertinggi"),
      tertinggiText.slice(0, 400),
    );
    check(
      "paket tertinggi menjelaskan kenapa tidak ada yang bisa dinaikkan",
      tertinggiText.includes("tidak ada paket di atasnya") &&
        tertinggiText.includes("semua fitur katalog sudah aktif"),
      tertinggiText.slice(0, 400),
    );
    await tertinggi.unmount();

    // (b) Starter: tombolnya menuju Professional, dan kliknya benar-benar pindah
    //     paket — sesi (yang dibaca seluruh gerbang fitur) ikut berubah.
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify(paketSession("starter")),
    );
    const starter = await renderInteractive(
      providers(React.createElement(SubscriptionPage, null)),
    );
    check(
      "di paket Starter tombolnya menawarkan paket berikutnya (Professional)",
      starter.text().includes("Upgrade ke Professional") &&
        starter.text().includes("Yang Anda dapat dengan Professional"),
      starter.text().slice(0, 400),
    );
    await starter.click("Upgrade ke Professional");
    const sesudahKlik = JSON.parse(
      window.localStorage.getItem("mesinpos.session.v1") ?? "null",
    );
    check(
      "kliknya benar-benar memindahkan paket, bukan tombol mati",
      sesudahKlik?.tenant?.planKey === "professional" &&
        // Label kartunya memakai `capitalize` di CSS, jadi teks DOM-nya tetap
        // huruf kecil — dibandingkan tanpa peka huruf besar-kecil.
        starter.text().toLowerCase().includes("paket professional") &&
        // Modul ikut diselaraskan paket baru, bukan dibiarkan seperti sebelumnya.
        Array.isArray(sesudahKlik?.tenant?.verticals) &&
        sesudahKlik.tenant.verticals.every((v) => v === "umkm"),
      `planKey=${sesudahKlik?.tenant?.planKey} · ${starter.text().slice(0, 200)}`,
    );
    check(
      "hasilnya diberitahukan ke pengguna, bukan senyap",
      starter.text().includes("Paket diubah ke Professional"),
      starter.text().slice(0, 400),
    );
    check(
      "setelah naik paket, tombolnya menawarkan paket berikutnya lagi (Enterprise)",
      starter.text().includes("Upgrade ke Enterprise"),
      starter.text().slice(0, 400),
    );
    check(
      "halaman langganan tanpa error konsol",
      starter.newErrors().length === 0,
      starter.newErrors().join(" | ").slice(0, 200),
    );
    await starter.unmount();
    withoutSession();
  }

  // 3. Alur F&B (Phase 2): denah meja + antrean dapur. Demo store memakai aturan
  //    yang sama dengan backend, jadi urutan "kirim ke dapur → selesai" di sini
  //    adalah perilaku yang sama yang akan dijalankan di produksi.
  const FNB_SESSION = {
    user: { name: "Uji F&B", email: "fnb@mesinpos.test" },
    tenant: {
      name: "Kafe Uji",
      slug: "kafe-uji",
      storeName: "Cabang Uji",
      vertical: "fnb",
      verticals: ["fnb"],
      planKey: "professional",
      role: "owner",
      /*
        Pengingat tutup shift dimatikan di sesi uji umum: blok yang memakainya
        menjalankan alur kasir yang tidak sedang menguji pengingatnya, dan
        hasilnya tidak boleh berubah tergantung jam berapa harness dijalankan
        (pengingat jam tutup menyala setelah pukul 21:00). Blok yang memang
        menguji pengingat menyalakannya sendiri lewat `withShiftReminderOn()`.
      */
      shift: { active: false, reminderHour: 21, longShiftHours: 14 },
      createdAt: new Date().toISOString(),
      trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
    },
  };

  function withFnbSession() {
    window.localStorage.setItem("mesinpos.session.v1", JSON.stringify(FNB_SESSION));
    withOpenShift();
  }

  function withoutSession() {
    window.localStorage.removeItem("mesinpos.session.v1");
  }

  /**
   * Gerbang kasir: halaman Kasir hanya bisa menjual kalau ada shift yang terbuka
   * (`posShiftGate` di `@/lib/shift`) — jadi sesi uji yang menekan tombol kasir
   * membuka shiftnya lebih dulu, persis seperti kasir sungguhan yang membukanya
   * di halaman Shift & Kas. Blok yang justru menguji gerbangnya (3d) menghapus
   * atau mengganti isi kunci ini sendiri.
   */
  function withOpenShift() {
    window.localStorage.setItem(
      "mesinpos.shifts.v1",
      JSON.stringify({
        current: {
          id: "shift-uji-umum",
          openedAt: new Date().toISOString(),
          openingCash: 300000,
          cashSales: 0,
          totalSales: 0,
          saleCount: 0,
          closedAt: null,
          countedCash: null,
          expectedCash: null,
          variance: null,
        },
        history: [],
      }),
    );
  }

  /** Menyalakan kembali pengingat tutup shift untuk blok yang mengujinya. */
  function withShiftReminderOn() {
    const raw = window.localStorage.getItem("mesinpos.session.v1");
    if (!raw) return;
    const sesi = JSON.parse(raw);
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        ...sesi,
        tenant: {
          ...sesi.tenant,
          shift: { active: true, reminderHour: 21, longShiftHours: 14 },
        },
      }),
    );
  }

  const { KdsPage } = await server.ssrLoadModule("/src/pages/KdsPage.tsx");
  const { PosPage } = await server.ssrLoadModule("/src/pages/PosPage.tsx");
  const { useStore } = await server.ssrLoadModule("/src/lib/store/context.ts");
  const { tableStates } = await server.ssrLoadModule("/src/lib/fnb.ts");

  /** Pesanan terbuka dari antrean dapur, dalam bentuk yang dipakai aturan. */
  const openOrders = (store) =>
    store.kdsTickets.map((ticket) => ({
      id: ticket.saleId,
      number: ticket.number,
      createdAt: ticket.createdAt,
      tableId: ticket.tableId,
    }));

  // 3a. Modul F&B mati: halaman menjelaskan keadaannya, bukan gagal senyap.
  {
    withoutSession();
    const { text } = await renderTree(providers(React.createElement(KdsPage, null)));
    check(
      "Dapur & Meja menjelaskan modul F&B yang belum aktif",
      text.includes("belum aktif") && text.includes("Kelola modul"),
      text.slice(0, 200),
    );
  }

  // 3b. Modul F&B aktif: denah meja contoh + antrean kosong dirender.
  {
    withFnbSession();
    const { text, newErrors } = await renderTree(
      providers(React.createElement(KdsPage, null)),
    );
    check("antrean dapur dirender", text.includes("Antrean dapur"), text.slice(0, 160));
    check(
      "denah meja menampilkan meja contoh",
      text.includes("Denah meja") && text.includes("A1") && text.includes("Kosong"),
      text.slice(0, 240),
    );
    check(
      "layar dapur tanpa error konsol",
      newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200),
    );
  }

  // 3c. POS dengan modul F&B: pemilih meja + tombol kirim ke dapur.
  {
    withFnbSession();
    const { text } = await renderTree(
      providers(React.createElement(PosPage, null)),
    );
    check(
      "POS menampilkan tombol Hold (bukan lagi Ke dapur)",
      text.includes("Hold") && !text.includes("Ke dapur"),
      text.slice(0, 200),
    );
    check(
      "POS menampilkan pemilih meja",
      text.includes("Tanpa meja") && text.includes("A1"),
      text.slice(0, 240),
    );
    check("POS menampilkan antrean dapur", text.includes("Pesanan di dapur"), text.slice(0, 160));
    check(
      "POS menandai produk yang punya modifier",
      text.includes("grup pilihan"),
      text.slice(0, 240),
    );
  }

  /*
    3e. Kategori utama ikut menentukan alur meja/dapur/modifier — bukan hanya
    modul. Sesi di sini **sama** dengan kafe di 3c (produk bermodifier, meja
    contoh “A1”, modul F&B menyala, paket Enterprise yang memuat semuanya),
    hanya kategori terkuncinya yang diganti. Jadi kalau yang hilang di layar
    memang denah meja, antrean dapur, dan modifier, penyebabnya kategorinya —
    bukan data contoh yang kebetulan kosong.
  */
  {
    const withBusinessCategory = (
      category,
      categoryLabel,
      subcategory,
      subcategoryLabel,
    ) =>
      window.localStorage.setItem(
        "mesinpos.session.v1",
        JSON.stringify({
          ...FNB_SESSION,
          tenant: {
            ...FNB_SESSION.tenant,
            businessCategory: {
              category,
              categoryLabel,
              subcategory,
              subcategoryLabel,
              lockedAt: Date.now(),
              lockedBy: "uji@mesinpos.test",
            },
          },
        }),
      );

    // Jalur yang benar-benar dipakai pengguna: `/app/pos` → sesi & tenant → shell
    // → halaman. Sidebar ikut terbaca, jadi satu render menjawab dua permukaan.
    const renderAppAt = (path) =>
      renderInteractive(
        React.createElement(
          MemoryRouter,
          { initialEntries: [path] },
          React.createElement(ErrorBoundary, null, React.createElement(App, null)),
        ),
      );

    withBusinessCategory(
      "retail",
      "Perdagangan Eceran",
      "bangunan",
      "Toko Bangunan & Material",
    );
    withOpenShift();

    const bangunan = await renderAppAt("/app/pos");
    const bangunanText = bangunan.text();
    check(
      "kasir toko bangunan benar-benar terbuka (halaman & tombol bayar ada)",
      bangunanText.includes("Kasir") && bangunan.query('[data-testid="pos-bayar"]') !== null,
      bangunanText.slice(0, 200),
    );
    check(
      "kasir toko bangunan tidak menawarkan pemilih meja",
      !bangunanText.includes("Tanpa meja"),
      bangunanText.slice(0, 240),
    );
    check(
      "kasir toko bangunan tidak menampilkan antrean dapur",
      !bangunanText.includes("Pesanan di dapur"),
      bangunanText.slice(0, 240),
    );
    check(
      "kasir toko bangunan tidak menawarkan modifier pada produknya",
      !bangunanText.includes("grup pilihan"),
      bangunanText.slice(0, 240),
    );
    check(
      "sidebar toko bangunan tidak memuat menu Dapur & Meja",
      !bangunanText.includes("Dapur & Meja"),
      bangunanText.slice(0, 240),
    );
    check(
      "kasir toko bangunan tetap bisa dipakai berjualan tanpa error konsol",
      bangunanText.includes("Bayar") && bangunan.newErrors().length === 0,
      bangunan.newErrors().join(" | ").slice(0, 200),
    );
    await bangunan.unmount();

    // Alamat langsung `/app/kds` pun tidak lagi menampilkan pengaturan meja —
    // menu sidebar sudah tidak ada, jadi halaman yang terbuka dari tautan lama
    // harus menjelaskan keadaannya sendiri, bukan diam-diam menampilkan denah.
    const kdsBangunan = await renderAppAt("/app/kds");
    const kdsBangunanText = kdsBangunan.text();
    check(
      "halaman dapur menjelaskan alasan kategorinya, bukan menyalahkan modul",
      kdsBangunanText.includes("tidak dipakai kategori") &&
        kdsBangunanText.includes("Toko Bangunan & Material") &&
        !kdsBangunanText.includes("Kelola modul"),
      kdsBangunanText.slice(0, 300),
    );
    /*
      Kalimat penjelasnya sendiri menyebut “Denah meja & antrean dapur”, jadi yang
      diperiksa bukan kata itu — melainkan isi alurnya: judul kartu denah, form
      tambah meja, dan meja contohnya. Kalau ketiganya tidak ada, pengaturannya
      memang tidak dirender.
    */
    check(
      "halaman dapur untuk toko bangunan tidak menampilkan pengaturan & denah mejanya",
      !kdsBangunanText.includes("Tambah meja") && !kdsBangunanText.includes("A1"),
      kdsBangunanText.slice(0, 300),
    );
    check(
      "lencana halaman dapur menyebut sebab yang benar (kategori, bukan modul)",
      kdsBangunanText.includes("Bukan layanan meja") &&
        !kdsBangunanText.includes("Butuh modul F&B"),
      kdsBangunanText.slice(0, 300),
    );
    await kdsBangunan.unmount();

    // Pembanding: kafe dengan modul yang sama tetap mendapat semuanya. Ini yang
    // mencegah “sembunyikan kalau ragu” lolos sebagai perbaikan.
    withBusinessCategory("fnb", "Makanan & Minuman", "kafe", "Kafe & Coffee Shop");
    const kafe = await renderAppAt("/app/pos");
    const kafeText = kafe.text();
    check(
      "kasir kafe tetap menawarkan meja, dapur, dan modifier",
      kafeText.includes("Tanpa meja") &&
        kafeText.includes("Pesanan di dapur") &&
        kafeText.includes("grup pilihan"),
      kafeText.slice(0, 240),
    );
    check(
      "sidebar kafe tetap memuat menu Dapur & Meja",
      kafeText.includes("Dapur & Meja"),
      kafeText.slice(0, 240),
    );
    await kafe.unmount();
  }

  // 3d. Gerbang kasir & pengingat tutup shift di halaman Kasir. Shift hidup di
  //     **perangkat** (`mesinpos.shifts.v1`, ditulis halaman Shift & Kas), jadi
  //     harness menyemai isinya sendiri — persis data yang dihasilkan halaman itu.
  //     Gerbangnya (`posShiftGate`) berarti: tanpa shift yang terbuka, pekerjaan
  //     menjual mati dan kasir diarahkan membuka shiftnya lebih dulu.
  {
    const SHIFT_KEY = "mesinpos.shifts.v1";
    const shiftTerbuka = {
      id: "shift-uji",
      // 26 jam lalu: pasti jatuh di hari kalender sebelumnya, kapan pun tesnya jalan.
      openedAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
      openingCash: 300000,
      cashSales: 1250000,
      totalSales: 1500000,
      saleCount: 24,
      closedAt: null,
      countedCash: null,
      expectedCash: null,
      variance: null,
    };
    const seedShift = (current) =>
      window.localStorage.setItem(
        SHIFT_KEY,
        JSON.stringify({ current, history: current ? [] : [shiftTerbuka] }),
      );

    // a) Kas belum pernah dibuka: keadaannya dikatakan apa adanya — badge
    //    “Shift terbuka · Kasir: Rani · buka 08:00” yang dulu selalu tampil itu
    //    tulisan tetap, bukan keadaan kas yang sebenarnya — dan seluruh
    //    pekerjaan menjualnya terkunci.
    withFnbSession();
    withShiftReminderOn();
    window.localStorage.removeItem(SHIFT_KEY);
    const kosong = await renderInteractive(providers(React.createElement(PosPage, null)));
    check(
      "kasir tanpa shift menyebut kasnya belum dibuka, bukan mengklaim shift terbuka",
      kosong.text().includes("Kas belum dibuka") && !kosong.text().includes("Shift terbuka"),
      kosong.text().slice(0, 320),
    );
    check(
      "kasir tanpa shift mengarahkan kasir membuka shift di halaman Shift & Kas",
      kosong.text().includes("Buka shift di halaman Shift & Kas"),
      kosong.text().slice(0, 320),
    );
    const gerbang = kosong.query('[data-testid="pos-gerbang-shift"]');
    check(
      "kasir terkunci saat shift belum dibuka, dan pesannya menyuruh membukanya dulu",
      gerbang !== null &&
        (gerbang.textContent ?? "").includes("Kasir terkunci") &&
        (gerbang.textContent ?? "").includes("Buka shift (kas) terlebih dahulu") &&
        (gerbang.textContent ?? "").includes("shift (kas) belum dibuka"),
      gerbang?.textContent ?? "(tidak ada gerbang)",
    );
    check(
      "gerbangnya menawarkan jalan keluarnya: tautan ke halaman Shift & Kas",
      gerbang?.querySelector("a")?.getAttribute("href") === "/app/shift",
      gerbang?.querySelector("a")?.getAttribute("href") ?? "(tidak ada tautan)",
    );
    check(
      "kasir terkunci benar-benar mati: produk & Bayar nonaktif, dan catatannya ikut tampil",
      (() => {
        const produk = kosong
          .queryAll("button")
          .filter((tombol) => /stok \d+|Habis/.test(tombol.textContent ?? ""));
        const bayar = kosong.query('[data-testid="pos-bayar"]');
        const catatan = kosong.query('[data-testid="pos-gerbang-shift-catatan"]');
        return (
          produk.length > 0 &&
          produk.every((tombol) => tombol.disabled) &&
          bayar?.disabled === true &&
          catatan !== null
        );
      })(),
      `produk_nonaktif=${kosong.queryAll("button").filter((t) => /stok \d+|Habis/.test(t.textContent ?? "")).filter((t) => t.disabled).length} bayar.disabled=${kosong.query('[data-testid="pos-bayar"]')?.disabled}`,
    );
    check(
      "menekan kartu produk yang mati tidak memasukkan apa pun ke keranjang",
      await (async () => {
        const tombol = kosong
          .queryAll("button")
          .find((t) => /stok \d+/.test(t.textContent ?? ""));
        if (!tombol) return false;
        await React.act(async () => {
          tombol.click();
        });
        const jumlah = kosong.query('[data-testid="keranjang-jumlah-item"]')?.textContent ?? "";
        return jumlah.includes("0 item");
      })(),
      `jumlah=${kosong.query('[data-testid="keranjang-jumlah-item"]')?.textContent}`,
    );
    check(
      "kasir tanpa shift tidak menampilkan peringatan tutup shift",
      kosong.query('[data-testid="kasir-ingat-tutup-shift"]') === null,
      kosong.text().slice(0, 320),
    );
    check(
      "kasir tanpa shift tidak mengejutkan kasir dengan error konsol",
      kosong.newErrors().length === 0,
      kosong.newErrors().join(" | ").slice(0, 200),
    );
    await kosong.unmount();

    // b) Shift kemarin belum ditutup: kasir diberi tahu, beserta jalan menutupnya.
    seedShift(shiftTerbuka);
    const kemarin = await renderInteractive(providers(React.createElement(PosPage, null)));
    const banner = kemarin.query('[data-testid="kasir-ingat-tutup-shift"]');
    check(
      "kasir menampilkan badge shift terbuka dari keadaan perangkat yang sebenarnya",
      kemarin.text().includes("Shift terbuka") && kemarin.text().includes("kemarin"),
      kemarin.text().slice(0, 320),
    );
    check(
      "kasir memperingatkan shift kemarin belum ditutup",
      (banner?.textContent ?? "").includes("Shift kemarin belum ditutup"),
      banner?.textContent ?? "(tidak ada banner)",
    );
    check(
      "peringatan diberi levelnya (bukan warna tanpa arti) dan menyebut akibatnya",
      banner?.getAttribute("data-level") === "late" &&
        (banner?.textContent ?? "").includes("uang fisik") &&
        (banner?.textContent ?? "").includes("Z-report"),
      `${banner?.getAttribute("data-level")} · ${banner?.textContent ?? "(tidak ada banner)"}`,
    );
    const tautanShift = kemarin.query('[data-testid="kasir-ingat-tutup-shift"] a');
    check(
      "peringatan menautkan kasir ke halaman Shift & Kas",
      tautanShift?.getAttribute("href") === "/app/shift",
      tautanShift?.getAttribute("href") ?? "(tidak ada tautan)",
    );
    // Shift yang terbuka membuka gerbangnya lagi: produk bisa masuk keranjang dan
    // tombol Bayar hidup — peringatan tutup shift bukan pengganti gerbangnya.
    const produkSiapJual = kemarin
      .queryAll("button")
      .find(
        (tombol) =>
          /stok \d+/.test(tombol.textContent ?? "") &&
          !(tombol.textContent ?? "").includes("grup pilihan"),
      );
    check(
      "ada produk tanpa modifier untuk membuktikan gerbangnya benar-benar terbuka",
      produkSiapJual !== undefined,
      kemarin.text().slice(0, 200),
    );
    await React.act(async () => {
      produkSiapJual.click();
    });
    check(
      "shift yang terbuka membuka gerbang kasir: produk masuk keranjang & Bayar hidup",
      kemarin.query('[data-testid="pos-gerbang-shift"]') === null &&
        (kemarin.query('[data-testid="keranjang-jumlah-item"]')?.textContent ?? "").includes("1 item") &&
        kemarin.query('[data-testid="pos-bayar"]')?.disabled === false,
      `jumlah=${kemarin.query('[data-testid="keranjang-jumlah-item"]')?.textContent} bayar.disabled=${kemarin.query('[data-testid="pos-bayar"]')?.disabled}`,
    );
    check(
      "kasir dengan shift kemarin tidak menghasilkan error konsol",
      kemarin.newErrors().length === 0,
      kemarin.newErrors().join(" | ").slice(0, 200),
    );
    await kemarin.unmount();

    // c) Shift sudah ditutup (riwayatnya masih ada): peringatannya ikut hilang.
    seedShift(null);
    const tertutup = await renderInteractive(providers(React.createElement(PosPage, null)));
    check(
      "shift yang sudah ditutup tidak lagi diingatkan (walau riwayatnya masih tersimpan)",
      tertutup.query('[data-testid="kasir-ingat-tutup-shift"]') === null &&
        tertutup.text().includes("Kas belum dibuka"),
      tertutup.text().slice(0, 320),
    );
    await tertutup.unmount();
    window.localStorage.removeItem(SHIFT_KEY);
  }

  // 3e. Pengingat tutup shift di halaman Shift & Kas (tempat kasir menutupnya):
  //     kalimatnya sama dengan yang di halaman Kasir, karena satu modul.
  {
    const SHIFT_KEY = "mesinpos.shifts.v1";
    const { ShiftPage } = await server.ssrLoadModule("/src/pages/ShiftPage.tsx");
    withFnbSession();
    // Blok ini justru menguji pengingatnya, jadi pengingat sesi uji umum dinyalakan.
    withShiftReminderOn();
    window.localStorage.setItem(
      SHIFT_KEY,
      JSON.stringify({
        current: {
          id: "shift-uji",
          openedAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
          openingCash: 300000,
          cashSales: 1250000,
          totalSales: 1500000,
          saleCount: 24,
          closedAt: null,
          countedCash: null,
          expectedCash: null,
          variance: null,
        },
        history: [],
      }),
    );
    const halaman = await renderInteractive(providers(React.createElement(ShiftPage, null)));
    const kartu = halaman.query('[data-testid="shift-ingat-tutup"]');
    check(
      "halaman Shift & Kas ikut mengingatkan shift yang belum ditutup",
      (kartu?.textContent ?? "").includes("Shift kemarin belum ditutup"),
      kartu?.textContent ?? "(tidak ada kartu)",
    );
    check(
      "halaman Shift & Kas menyebut lama shift berjalan",
      halaman.text().includes("Dibuka kemarin"),
      halaman.text().slice(0, 320),
    );
    check(
      "halaman Shift & Kas dengan shift terbuka tanpa error konsol",
      halaman.newErrors().length === 0,
      halaman.newErrors().join(" | ").slice(0, 200),
    );
    await halaman.unmount();
    window.localStorage.removeItem(SHIFT_KEY);
  }

  // 3f. Setelan pengingat tutup shift (`tenants.shift`, halaman Pengaturan):
  //     jamnya, ambangnya, dan saklarnya bisa diatur pemilik toko — bukan lagi
  //     konstanta di kode — dan halaman Kasir mengikuti setelan itu.
  {
    const SHIFT_KEY = "mesinpos.shifts.v1";
    const { SettingsPage } = await server.ssrLoadModule("/src/pages/SettingsPage.tsx");

    /** Sesi F&B dengan setelan pengingat tertentu (kolom `tenants.shift`). */
    function withShiftSetting(setting) {
      window.localStorage.setItem(
        "mesinpos.session.v1",
        JSON.stringify({
          ...FNB_SESSION,
          tenant: { ...FNB_SESSION.tenant, shift: setting },
        }),
      );
    }
    const shiftSejak = (jam) => new Date(Date.now() - jam * 3600 * 1000).toISOString();
    const stateShift = (openedAt) =>
      JSON.stringify({
        current: {
          id: "shift-uji-setelan",
          openedAt,
          openingCash: 300000,
          cashSales: 0,
          totalSales: 0,
          saleCount: 0,
          closedAt: null,
          countedCash: null,
          expectedCash: null,
          variance: null,
        },
        history: [],
      });

    // a) Saklar mati: peringatannya benar-benar berhenti, walaupun kasnya belum
    //    ditutup sejak kemarin. Badge-nya tetap jujur — yang mati memang
    //    pengingatnya, bukan keadaannya.
    withShiftSetting({ active: false, reminderHour: 21, longShiftHours: 14 });
    window.localStorage.setItem(SHIFT_KEY, stateShift(shiftSejak(26)));
    const saklarMati = await renderInteractive(providers(React.createElement(PosPage, null)));
    check(
      "setelan “pengingat mati” benar-benar mematikan peringatan di kasir",
      saklarMati.query('[data-testid="kasir-ingat-tutup-shift"]') === null &&
        saklarMati.text().includes("Shift terbuka"),
      saklarMati.text().slice(0, 300),
    );
    await saklarMati.unmount();

    // b) Ambang dari setelan dipakai: ambang 1 jam + shift 2 jam → sudah keras.
    //    (Bukan konstanta 14 jam di kode.)
    withShiftSetting({ active: true, reminderHour: 21, longShiftHours: 1 });
    window.localStorage.setItem(SHIFT_KEY, stateShift(shiftSejak(2)));
    const ambangPendek = await renderInteractive(providers(React.createElement(PosPage, null)));
    const bannerPendek = ambangPendek.query('[data-testid="kasir-ingat-tutup-shift"]');
    check(
      "ambang shift lama dari halaman Pengaturan benar-benar dipakai kasir (2 jam ≥ ambang 1 jam)",
      bannerPendek !== null && (bannerPendek.textContent ?? "").includes("Tutup shift"),
      bannerPendek?.textContent ?? "(tidak ada banner)",
    );
    check(
      "kasir dengan ambang setelan sendiri tidak menghasilkan error konsol",
      ambangPendek.newErrors().length === 0,
      ambangPendek.newErrors().join(" | ").slice(0, 200),
    );
    await ambangPendek.unmount();

    // c) Halaman Pengaturan: kartunya menampilkan nilai tersimpan, menolak angka
    //    janggal, dan menyimpan nilai baru sampai ke sesi/store.
    withShiftSetting({ active: true, reminderHour: 22, longShiftHours: 8 });
    window.localStorage.removeItem(SHIFT_KEY);
    const setelan = await renderInteractive(providers(React.createElement(SettingsPage, null)));
    check(
      "halaman Pengaturan punya kartu pengingat tutup shift",
      setelan.query('[data-testid="setelan-pengingat-shift"]') !== null &&
        setelan.text().includes("Pengingat tutup shift"),
      setelan.text().slice(0, 240),
    );
    check(
      "kartunya menampilkan nilai yang tersimpan (lencana 22:00 · 8 jam, kolomnya terisi)",
      (setelan.query('[data-testid="shift-lencana"]')?.textContent ?? "").includes("22:00") &&
        setelan.query('[data-testid="shift-jam"]')?.value === "22" &&
        setelan.query('[data-testid="shift-ambang"]')?.value === "8",
      `${setelan.query('[data-testid="shift-lencana"]')?.textContent} · ${setelan.query('[data-testid="shift-jam"]')?.value} · ${setelan.query('[data-testid="shift-ambang"]')?.value}`,
    );
    check(
      "petunjuknya menyebut akibat angka itu sebelum disimpan",
      (setelan.query('[data-testid="shift-petunjuk"]')?.textContent ?? "").includes("22:00"),
      setelan.query('[data-testid="shift-petunjuk"]')?.textContent ?? "(tidak ada petunjuk)",
    );

    await setelan.fill('[data-testid="shift-jam"]', "99");
    check(
      "jam di luar 0–23 ditolak dengan alasannya, dan tombol simpannya terkunci",
      (setelan.query('[data-testid="shift-petunjuk"]')?.textContent ?? "").includes("Jam pengingat") &&
        setelan.query('[data-testid="shift-simpan"]')?.disabled === true,
      `${setelan.query('[data-testid="shift-petunjuk"]')?.textContent} · disabled=${setelan.query('[data-testid="shift-simpan"]')?.disabled}`,
    );

    await setelan.fill('[data-testid="shift-jam"]', "20");
    await setelan.clickOn('[data-testid="shift-simpan"]');
    check(
      "menyimpan setelan memberi tahu jam & ambang barunya",
      setelan.text().includes("20:00") && setelan.text().includes("8 jam"),
      setelan.text().slice(0, 300),
    );
    const tersimpan = (() => {
      try {
        return JSON.parse(window.localStorage.getItem("mesinpos.session.v1") ?? "null")?.tenant?.shift ?? null;
      } catch {
        return null;
      }
    })();
    check(
      "setelan barunya benar-benar tersimpan (bukan hanya tampil di layar)",
      tersimpan?.reminderHour === 20 && tersimpan?.longShiftHours === 8 && tersimpan?.active === true,
      JSON.stringify(tersimpan),
    );
    check(
      "halaman Pengaturan dengan setelan pengingat tanpa error konsol",
      setelan.newErrors().length === 0,
      setelan.newErrors().join(" | ").slice(0, 200),
    );
    await setelan.unmount();

    // d) Saklarnya bisa dimatikan dari halaman yang sama, dan keadaannya ikut
    //    tersimpan — kafe 24 jam tidak perlu memilih jam yang “benar”.
    withShiftSetting({ active: true, reminderHour: 20, longShiftHours: 8 });
    const saklar = await renderInteractive(providers(React.createElement(SettingsPage, null)));
    await saklar.clickOn('[data-testid="shift-saklar"]');
    await saklar.clickOn('[data-testid="shift-simpan"]');
    const tersimpanMati = (() => {
      try {
        return JSON.parse(window.localStorage.getItem("mesinpos.session.v1") ?? "null")?.tenant?.shift ?? null;
      } catch {
        return null;
      }
    })();
    check(
      "saklar pengingat bisa dimatikan dari halaman Pengaturan dan tersimpan",
      tersimpanMati?.active === false && tersimpanMati?.reminderHour === 20,
      JSON.stringify(tersimpanMati),
    );
    await saklar.unmount();

    window.localStorage.removeItem(SHIFT_KEY);
  }

  // 3g. Pemberitahuan ke **pemilik toko** (kas belum dibuka di jam operasional /
  //     shift belum ditutup). Yang diperiksa bukan kalimatnya saja, melainkan dua
  //     hal yang mudah diklaim tanpa bukti: apakah kabarnya **benar-benar dibuat**
  //     (tercatat di store, bukan cuma tampil), dan apakah kasir melihat keadaan
  //     laporannya apa adanya (terkirim / sudah pernah / belum sampai).
  //
  //     Jam operasionalnya dihitung dari jam perangkat yang menjalankan tes ini
  //     (toko “baru buka satu jam lalu”), supaya blok ini tidak bergantung pada
  //     pukul berapa suite-nya dijalankan.
  {
    const SHIFT_KEY = "mesinpos.shifts.v1";
    const SENT_KEY = "mesinpos.shift-alerts.v1";
    const { PosPage } = await server.ssrLoadModule("/src/pages/PosPage.tsx");
    const { ShiftPage: HalamanShift } = await server.ssrLoadModule("/src/pages/ShiftPage.tsx");
    const { SettingsPage: HalamanSetelan } = await server.ssrLoadModule(
      "/src/pages/SettingsPage.tsx",
    );
    const jamSekarang = new Date().getHours();
    const jamBuka = (jamSekarang + 23) % 24;
    const jamTutup = (jamSekarang + 2) % 24;

    /** Sesi F&B dengan jam operasional yang pasti memuat jam sekarang. */
    function withOwnerAlertSetting(extra = {}) {
      window.localStorage.setItem(
        "mesinpos.session.v1",
        JSON.stringify({
          ...FNB_SESSION,
          tenant: {
            ...FNB_SESSION.tenant,
            shift: {
              active: true,
              reminderHour: 21,
              longShiftHours: 14,
              openHour: jamBuka,
              closeHour: jamTutup,
              notifyOwner: true,
              ...extra,
            },
          },
        }),
      );
    }

    /** Menunggu janji di dalam efek selesai (laporan shift dikirim asinkron). */
    const tungguLaporan = () =>
      React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

    // a) Kas belum dibuka padahal toko sudah buka.
    withOwnerAlertSetting();
    window.localStorage.removeItem(SHIFT_KEY);
    window.localStorage.removeItem(SENT_KEY);
    let posStore = null;
    function PantauStore() {
      posStore = useStore();
      return null;
    }
    const pos = await renderInteractive(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(PosPage, null),
          React.createElement(PantauStore, null),
        ),
      ),
    );
    await tungguLaporan();
    const kabar = pos.query('[data-testid="pos-pemberitahuan-pemilik"]');
    check(
      "kasir melihat kabar ke pemilik toko saat kasnya belum dibuka di jam operasional",
      kabar !== null &&
        (kabar.textContent ?? "").includes("Kas belum dibuka") &&
        kabar.getAttribute("data-status") === "sent",
      `${kabar?.getAttribute("data-status")} · ${kabar?.textContent ?? "(tidak ada kabar)"}`,
    );
    const jendelaJam = `${String(jamBuka).padStart(2, "0")}:00–${String(jamTutup).padStart(2, "0")}:00`;
    check(
      "kabarnya menyebut pemilik toko & jam operasional yang berlaku, bukan cuma menyuruh kasir",
      (kabar?.textContent ?? "").includes("Pemilik toko diberi tahu") &&
        (kabar?.textContent ?? "").includes("shift (kas)") &&
        (kabar?.textContent ?? "").includes(jendelaJam),
      `${jendelaJam} · ${kabar?.textContent ?? "(tidak ada kabar)"}`,
    );
    check(
      "laporannya benar-benar tercatat di store (bukan hanya tampil di layar)",
      posStore?.shiftAlerts?.length === 1 &&
        posStore?.shiftAlerts?.[0]?.kind === "till-closed" &&
        posStore?.shiftAlerts?.[0]?.reason === "opening-grace" &&
        (posStore?.shiftAlerts?.[0]?.dayKey ?? "").length === 10 &&
        posStore?.shiftAlerts?.[0]?.emailVia === "demo" &&
        posStore?.shiftAlerts?.[0]?.emailDeliveredAt === null,
      JSON.stringify(posStore?.shiftAlerts ?? null),
    );
    check(
      "kasir diberi tahu bahwa mode demo tidak punya kanal email/webhook (tidak diklaim terkirim)",
      (kabar?.textContent ?? "").includes("belum menerima kabarnya") &&
        (kabar?.textContent ?? "").includes("kanal email") &&
        (kabar?.textContent ?? "").includes("webhook"),
      kabar?.textContent ?? "(tidak ada kabar)",
    );
    check(
      "kasir dengan kabar ke pemilik tanpa error konsol",
      pos.newErrors().length === 0,
      pos.newErrors().join(" | ").slice(0, 200),
    );
    await pos.unmount();

    // b) Saklar pemberitahuan pemilik dimatikan: tidak ada kabar, dan tidak ada
    //    laporan yang dibuat — pengingat kasirnya tetap berjalan.
    withOwnerAlertSetting({ notifyOwner: false });
    window.localStorage.removeItem(SENT_KEY);
    let storeSaklarMati = null;
    function PantauSaklarMati() {
      storeSaklarMati = useStore();
      return null;
    }
    const posMati = await renderInteractive(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(PosPage, null),
          React.createElement(PantauSaklarMati, null),
        ),
      ),
    );
    await tungguLaporan();
    check(
      "saklar pemberitahuan pemilik yang mati benar-benar menghentikan kabarnya",
      posMati.query('[data-testid="pos-pemberitahuan-pemilik"]') === null &&
        (storeSaklarMati?.shiftAlerts?.length ?? 0) === 0,
      `${storeSaklarMati?.shiftAlerts?.length ?? "?"} laporan · ${posMati.query('[data-testid="pos-pemberitahuan-pemilik"]')?.textContent ?? "(tidak ada kabar)"}`,
    );
    await posMati.unmount();

    // c) Halaman Shift & Kas: kabar yang sudah terkirim bisa dibaca ulang —
    //    termasuk kalimat yang jujur saat belum ada endpoint webhook yang
    //    melanggannya — lalu ditandai sudah ditangani.
    withOwnerAlertSetting();
    window.localStorage.removeItem(SENT_KEY);
    const shift = await renderInteractive(providers(React.createElement(HalamanShift, null)));
    await tungguLaporan();
    check(
      "halaman Shift & Kas punya kartu pemberitahuan ke pemilik toko",
      shift.query('[data-testid="setelan-pemberitahuan-pemilik"]') !== null &&
        shift.text().includes("Pemberitahuan ke pemilik toko"),
      shift.text().slice(0, 240),
    );
    const kabarHalaman = shift.query('[data-testid="pemberitahuan-pemilik-till-closed"]');
    check(
      "kabar yang baru dibuat muncul sebagai riwayat yang bisa diperiksa",
      kabarHalaman !== null &&
        (kabarHalaman.textContent ?? "").includes("Kas belum dibuka") &&
        (kabarHalaman.textContent ?? "").includes("kas belum dibuka"),
      kabarHalaman?.textContent ?? "(tidak ada riwayat)",
    );
    check(
      "riwayatnya menyebut mode demo tidak mengirim email & belum ada endpoint webhook, bukan mengaku sudah sampai",
      (kabarHalaman?.textContent ?? "").includes("Mode demo tidak punya kanal email server") &&
        (kabarHalaman?.textContent ?? "").includes("Belum ada endpoint webhook") &&
        kabarHalaman?.getAttribute("data-terkirim") === "false",
      `${kabarHalaman?.getAttribute("data-terkirim")} · ${kabarHalaman?.textContent ?? "(tidak ada)"}`,
    );
    await shift.clickOn('[data-testid="pemberitahuan-pemilik-tangani"]');
    await tungguLaporan();
    check(
      "kabar bisa ditandai sudah ditangani (dan tombolnya hilang, bukan menumpuk)",
      shift.text().includes("Ditangani") &&
        shift.query('[data-testid="pemberitahuan-pemilik-tangani"]') === null,
      shift.text().slice(0, 320),
    );
    check(
      "halaman Shift & Kas dengan pemberitahuan pemilik tanpa error konsol",
      shift.newErrors().length === 0,
      shift.newErrors().join(" | ").slice(0, 200),
    );
    await shift.unmount();

    // d) Halaman Pengaturan: jam operasional & saklar pemberitahuan pemilik.
    withOwnerAlertSetting({ openHour: 8, closeHour: 22 });
    window.localStorage.removeItem(SHIFT_KEY);
    const setelanJam = await renderInteractive(
      providers(React.createElement(HalamanSetelan, null)),
    );
    check(
      "halaman Pengaturan punya kolom jam operasional & saklar pemberitahuan pemilik",
      setelanJam.query('[data-testid="shift-buka"]') !== null &&
        setelanJam.query('[data-testid="shift-tutup"]') !== null &&
        setelanJam.query('[data-testid="shift-pemberitahuan-saklar"]') !== null,
      setelanJam.text().slice(0, 200),
    );
    check(
      "kolomnya menampilkan jam operasional yang tersimpan, dan lencananya ikut menyebutnya",
      setelanJam.query('[data-testid="shift-buka"]')?.value === "8" &&
        setelanJam.query('[data-testid="shift-tutup"]')?.value === "22" &&
        (setelanJam.query('[data-testid="shift-lencana"]')?.textContent ?? "").includes(
          "08:00–22:00",
        ),
      `${setelanJam.query('[data-testid="shift-buka"]')?.value} · ${setelanJam.query('[data-testid="shift-tutup"]')?.value} · ${setelanJam.query('[data-testid="shift-lencana"]')?.textContent}`,
    );
    check(
      "petunjuknya menyebut kapan pemilik dikabari sebelum disimpan",
      (setelanJam.query('[data-testid="shift-petunjuk-pemilik"]')?.textContent ?? "").includes(
        "30 menit",
      ) &&
        (setelanJam.query('[data-testid="shift-petunjuk-pemilik"]')?.textContent ?? "").includes(
          "shift.alert",
        ),
      setelanJam.query('[data-testid="shift-petunjuk-pemilik"]')?.textContent ?? "(tidak ada)",
    );
    await setelanJam.fill('[data-testid="shift-buka"]', "24");
    check(
      "jam buka di luar 0–23 ditolak, dan tombol simpannya terkunci",
      (setelanJam.query('[data-testid="shift-petunjuk"]')?.textContent ?? "").includes(
        "Jam buka",
      ) && setelanJam.query('[data-testid="shift-simpan"]')?.disabled === true,
      `${setelanJam.query('[data-testid="shift-petunjuk"]')?.textContent} · disabled=${setelanJam.query('[data-testid="shift-simpan"]')?.disabled}`,
    );
    await setelanJam.fill('[data-testid="shift-buka"]', "6");
    await setelanJam.fill('[data-testid="shift-tutup"]', "23");
    await setelanJam.clickOn('[data-testid="shift-pemberitahuan-saklar"]');
    await setelanJam.clickOn('[data-testid="shift-pemberitahuan-saklar"]');
    await setelanJam.clickOn('[data-testid="shift-simpan"]');
    const setelanTersimpan = (() => {
      try {
        return (
          JSON.parse(window.localStorage.getItem("mesinpos.session.v1") ?? "null")?.tenant
            ?.shift ?? null
        );
      } catch {
        return null;
      }
    })();
    check(
      "jam operasional & saklar pemilik baru benar-benar tersimpan (bukan hanya tampil)",
      setelanTersimpan?.openHour === 6 &&
        setelanTersimpan?.closeHour === 23 &&
        setelanTersimpan?.notifyOwner === true,
      JSON.stringify(setelanTersimpan),
    );
    check(
      "halaman Pengaturan dengan jam operasional tanpa error konsol",
      setelanJam.newErrors().length === 0,
      setelanJam.newErrors().join(" | ").slice(0, 200),
    );
    await setelanJam.unmount();

    window.localStorage.removeItem(SHIFT_KEY);
    window.localStorage.removeItem(SENT_KEY);
  }

  // 3c-2. Modifier item (`pos.modifier`) di klien: pilihan wajib ditegakkan,
  //       tambahan harga dihitung per unit, dan labelnya sampai ke tiket dapur.
  {
    withFnbSession();

    function ModifierProbe() {
      const store = useStore();
      const step = React.useRef(0);
      const facts = React.useRef({});

      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;
        const product = store.products.find((p) => (p.modifiers?.length ?? 0) > 0);
        facts.current.productId = product?.id;
        facts.current.price = product?.price;

        void (async () => {
          // 1. Grup wajib tidak dipilih → harus ditolak dengan pesan jelas.
          try {
            await store.holdSale({
              items: [{ productId: product.id, quantity: 1 }],
              discount: 0,
              method: "Tunai",
            });
            facts.current.requiredError = "DITERIMA";
          } catch (error) {
            facts.current.requiredError = error.message;
          }

          // 2. Pilihan lengkap → tiket dapur memuat label dan totalnya memuat
          //    tambahan per unit.
          try {
            const held = await store.holdSale({
              items: [
                {
                  productId: product.id,
                  quantity: 2,
                  modifiers: [
                    { groupCode: "PEDAS", optionCodes: ["3"] },
                    { groupCode: "TOPPING", optionCodes: ["TELUR"] },
                  ],
                },
              ],
              discount: 0,
              method: "Tunai",
            });
            facts.current.total = held.total;
            facts.current.number = held.number;
          } catch (error) {
            facts.current.error = error.message;
          }
        })();
      }, [store]);

      const ticket = store.kdsTickets[0];
      return React.createElement(
        "div",
        null,
        `tiket=${store.kdsTickets.length}` +
          ` wajib=${facts.current.requiredError ?? "-"}` +
          ` labels=${JSON.stringify(ticket?.items?.[0]?.modifiers ?? null)}` +
          ` total=${facts.current.total ?? "?"}` +
          ` error=${facts.current.error ?? "-"}`,
      );
    }

    const { text } = await renderTree(
      providers(React.createElement(ModifierProbe, null)),
    );
    // Label modifier memuat spasi, jadi tiap medan dipotong dengan pembatasnya.
    const pick = (pattern) => text.match(pattern)?.[1] ?? "";
    const wajibMessage = pick(/wajib=(.*?) labels=/);
    const labels = pick(/labels=(.*?) total=/);
    const total = pick(/total=(\S+)/);
    const error = pick(/error=(\S+)/);

    check(
      "modifier tanpa grup wajib ditolak di klien",
      wajibMessage.includes("wajib dipilih"),
      text,
    );
    check("modifier tanpa error lain", error === "-", text);
    check(
      "label modifier tampil di tiket dapur",
      labels.includes("Level pedas: Pedas 3") && labels.includes("Topping: Telur"),
      text,
    );
    // 2 × 27.000 + 2 × 5.000 = 64.000, PPN 11% → 71.040
    check("tambahan modifier dihitung per unit di klien", total === "71040", text);
    withoutSession();
  }

  // 3d. Perilaku alur F&B di klien: stok belum bergerak saat dikirim ke dapur,
  //     bergerak saat selesai; meja terisi lalu kosong lagi.
  {
    withFnbSession();

    function FnbProbe() {
      const store = useStore();
      const step = React.useRef(0);
      const facts = React.useRef({});

      // Langkah 1: kirim satu pesanan ke meja aktif pertama.
      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;
        const product = store.products.find((p) => p.stock > 4);
        const table = store.tables.find((t) => t.active);
        facts.current.productId = product?.id;
        facts.current.tableId = table?.id;
        facts.current.stockBefore = product?.stock;
        void store
          .holdSale({
            items: [{ productId: product.id, quantity: 2 }],
            discount: 0,
            method: "Tunai",
            tableId: table.id,
          })
          .catch((error) => {
            facts.current.error = error.message;
            step.current = 9;
          });
      }, [store]);

      // Langkah 2: tiket sudah ada — catat stok & status meja, lalu selesaikan.
      React.useEffect(() => {
        if (step.current !== 1 || store.kdsTickets.length === 0) return;
        step.current = 2;
        const { productId, tableId } = facts.current;
        facts.current.stockAfterHold = store.products.find(
          (p) => p.id === productId,
        )?.stock;
        facts.current.tableAfterHold = tableStates(store.tables, openOrders(store)).find(
          (state) => state.id === tableId,
        )?.status;
        void store.completeHeld(store.kdsTickets[0].saleId).catch((error) => {
          facts.current.error = error.message;
        });
      }, [store]);

      const { productId, tableId } = facts.current;
      const stockNow = store.products.find((p) => p.id === productId)?.stock ?? "?";
      const statusNow =
        tableStates(store.tables, openOrders(store)).find((s) => s.id === tableId)
          ?.status ?? "?";

      return React.createElement(
        "div",
        null,
        `tiket=${store.kdsTickets.length}` +
          ` stok_awal=${facts.current.stockBefore ?? "?"}` +
          ` stok_stlh_kirim=${facts.current.stockAfterHold ?? "?"}` +
          ` stok_akhir=${stockNow}` +
          ` meja_stlh_kirim=${facts.current.tableAfterHold ?? "?"}` +
          ` meja_akhir=${statusNow}` +
          ` error=${facts.current.error ?? "-"}`,
      );
    }

    const { text } = await renderTree(providers(React.createElement(FnbProbe, null)));
    const facts = Object.fromEntries(
      [...text.matchAll(/([a-z_]+)=([^ ]+)/g)].map((match) => [match[1], match[2]]),
    );
    check("alur F&B tanpa error", facts.error === "-", text);
    check(
      "kirim ke dapur tidak menggerakkan stok",
      facts.stok_stlh_kirim === facts.stok_awal && facts.stok_awal !== "?",
      text,
    );
    check("kirim ke dapur membuat meja terisi", facts.meja_stlh_kirim === "occupied", text);
    check(
      "pesanan selesai menggerakkan stok 2 satuan dasar",
      Number(facts.stok_akhir) === Number(facts.stok_awal) - 2,
      text,
    );
    check("pesanan selesai mengosongkan meja", facts.meja_akhir === "free", text);
    check("tiket hilang dari antrean setelah selesai", facts.tiket === "0", text);
    withoutSession();
  }

  // 3d-2. Bayar di kasir (modul F&B): pesanannya berangkat ke dapur pada momen
  //       pembayarannya, dan kasirnya diberi tahu di dialog struk yang terbuka
  //       otomatis. Diuji lewat **layar kasir yang diklik**, bukan lewat store:
  //       inilah yang dilihat kasir di depan antrean.
  {
    withFnbSession();
    // Pembersih spasi yang sama dengan blok struk lain (`"/src/index.css"`-nya
    // sama): teks yang dibaca harness harus teks yang dibaca kasir.
    const rapi = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

    const kas = {};
    function FnbKasProbe() {
      const store = useStore();
      kas.tickets = () => store.kdsTickets;
      kas.stock = (name) => store.products.find((p) => p.name === name)?.stock;
      kas.products = store.products
        .filter((p) => p.stock > 0 && !(p.modifiers?.length > 0))
        .map((p) => ({ name: p.name, price: p.price, stock: p.stock }));
      return null;
    }

    const ui = await renderInteractive(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(PosPage, null),
          React.createElement(FnbKasProbe, null),
        ),
      ),
    );

    const pilihan = (kas.products ?? [])
      .filter((product) => product.price > 0 && product.price < 100_000)
      .sort((a, b) => a.price - b.price)[0];
    check("ada produk F&B untuk diuji di kasir", Boolean(pilihan), JSON.stringify(kas.products).slice(0, 200));

    const stokAwal = kas.stock(pilihan.name);
    await ui.click(pilihan.name);
    await ui.click("Bayar");
    await ui.clickOn('[data-testid="cash-cepat-100000"]');
    await ui.click("Selesaikan pembayaran");

    const dapurLine = ui.query('[data-testid="struk-dapur"]');
    check(
      "dialog struk memberi tahu kasir bahwa pesanannya sudah ke dapur",
      dapurLine !== null && rapi(dapurLine.textContent).includes("dikirim ke dapur"),
      rapi(dapurLine && dapurLine.textContent),
    );
    check(
      "stok bergerak saat uangnya diterima (bukan saat dapur menyelesaikan)",
      kas.stock(pilihan.name) === stokAwal - 1,
      `${stokAwal} → ${kas.stock(pilihan.name)}`,
    );

    const tiket = (kas.tickets?.() ?? []).at(-1);
    check(
      "pesanan lunas masuk antrean dapur sebagai tiket",
      Boolean(tiket) && typeof tiket.number === "string",
      JSON.stringify((kas.tickets?.() ?? []).map((row) => [row.number, row.settled])),
    );
    check(
      "tiketnya ditandai sudah lunas dengan metode bayarnya",
      tiket?.settled === true && String(tiket.paidLabel).startsWith("Lunas Tunai"),
      String(tiket?.paidLabel),
    );
    check(
      "daftar pesanan di kasir menandai tiket yang sudah lunas",
      ui.query(`[data-testid="pos-dapur-lunas-${tiket?.saleId}"]`) !== null,
      ui
        .queryAll("[data-testid^='pos-dapur-lunas-']")
        .map((row) => row.getAttribute("data-testid"))
        .join(","),
    );
    await ui.unmount();
    withoutSession();
  }

  // 3d-3. Dapur menekan Selesai pada tiket yang sudah lunas: tiketnya keluar dari
  //       antrean dan stoknya **tidak** bergerak untuk kedua kalinya.
  {
    withFnbSession();

    function SelesaiProbe() {
      const store = useStore();
      const step = React.useRef(0);
      const facts = React.useRef({});

      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;
        const product = store.products.find((p) => p.stock > 4);
        facts.current.name = product?.name;
        void store
          .createSale({
            items: [{ productId: product.id, quantity: 1 }],
            discount: 0,
            method: "Tunai",
          })
          .then((receipt) => {
            facts.current.kitchenFired = String(receipt.kitchenFired);
            step.current = 2;
          })
          .catch((error) => {
            facts.current.error = error.message;
            step.current = 9;
          });
      }, [store]);

      React.useEffect(() => {
        if (step.current !== 2) return;
        const ticket = store.kdsTickets.at(-1);
        if (!ticket) return;
        step.current = 3;
        facts.current.tiket = String(store.kdsTickets.length);
        facts.current.settled = String(ticket.settled);
        facts.current.stokSebelumSelesai = store.products.find(
          (p) => p.name === facts.current.name,
        )?.stock;
        void store.finishKitchenTicket(ticket.saleId).catch((error) => {
          facts.current.error = error.message;
        });
      }, [store]);

      const stockNow = store.products.find((p) => p.name === facts.current.name)?.stock;
      return React.createElement(
        "div",
        null,
        `kirim=${facts.current.kitchenFired ?? "?"}` +
          ` tiket_lunas=${facts.current.settled ?? "?"}` +
          ` tiket_sisa=${store.kdsTickets.length}` +
          ` stok_sebelum=${facts.current.stokSebelumSelesai ?? "?"}` +
          ` stok_sesudah=${stockNow ?? "?"}` +
          ` error=${facts.current.error ?? "-"}`,
      );
    }

    const { text } = await renderTree(providers(React.createElement(SelesaiProbe, null)));
    const facts = Object.fromEntries(
      [...text.matchAll(/([a-z_]+)=([^ ]+)/g)].map((match) => [match[1], match[2]]),
    );
    check("alur tiket lunas tanpa error", facts.error === "-", text);
    check("penjualan lunas melaporkan dirinya ke dapur", facts.kirim === "true", text);
    check("tiketnya bertanda sudah lunas", facts.tiket_lunas === "true", text);
    check("tiket lunas keluar dari antrean setelah Selesai", facts.tiket_sisa === "0", text);
    check(
      "menandai selesai tidak mengurangi stok lagi",
      facts.stok_sesudah === facts.stok_sebelum && facts.stok_sebelum !== "?",
      text,
    );
    withoutSession();
  }

  // 3d-4. Tombol **Hold**: transaksi yang sedang berjalan ditahan sementara
  //       (tanpa menyentuh uang, stok, atau antrean dapur) supaya pembeli
  //       berikutnya dilayani lebih dulu, lalu transaksinya dilanjutkan dari
  //       daftar Transaksi ditahan. Diuji lewat layar kasir yang diklik.
  {
    withFnbSession();

    const kas = {};
    function HoldProbe() {
      const store = useStore();
      kas.products = store.products
        .filter((p) => p.stock > 0 && p.price > 0 && !(p.modifiers?.length > 0))
        .map((p) => ({ name: p.name, price: p.price }));
      kas.tickets = () => store.kdsTickets.length;
      kas.stock = (name) => store.products.find((p) => p.name === name)?.stock;
      return null;
    }

    const ui = await renderInteractive(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(PosPage, null),
          React.createElement(HoldProbe, null),
        ),
      ),
    );

    const [pertama, kedua] = kas.products ?? [];
    check(
      "ada dua produk untuk menguji tombol Hold",
      Boolean(pertama && kedua),
      JSON.stringify(kas.products).slice(0, 200),
    );

    // Rupiah ditulis dengan spasi tak-putus oleh `Intl.NumberFormat`, jadi kedua
    // sisi dibaca dengan pengrapat spasi yang sama sebelum dibandingkan.
    const rapi = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const jumlahItem = () =>
      ui.query('[data-testid="keranjang-jumlah-item"]')?.textContent ?? "";
    const totalKeranjang = () =>
      rapi(ui.query('[data-testid="keranjang-total"]')?.textContent);
    const barisDitahan = () => ui.queryAll('[data-testid^="pos-lanjutkan-"]');
    const teksBaris = (tombol) => rapi(tombol.closest("li")?.textContent);

    await ui.click(pertama.name);
    check("produk pertama masuk keranjang", jumlahItem().includes("1 item"), jumlahItem());
    const totalSaatDitahan = totalKeranjang();
    const stokAwal = kas.stock(pertama.name);

    await ui.clickOn('[data-testid="pos-hold"]');
    check(
      "Hold mengosongkan keranjang untuk pembeli berikutnya",
      jumlahItem().includes("0 item"),
      jumlahItem(),
    );
    check(
      "Hold tidak mengirim tiket ke dapur & tidak menggerakkan stok",
      kas.tickets() === 0 && kas.stock(pertama.name) === stokAwal,
      `tiket=${kas.tickets()} stok=${stokAwal}→${kas.stock(pertama.name)}`,
    );
    check(
      "daftar Transaksi ditahan muncul dengan isinya",
      barisDitahan().length === 1 &&
        teksBaris(barisDitahan()[0]).includes("1 item") &&
        teksBaris(barisDitahan()[0]).includes(totalSaatDitahan),
      teksBaris(barisDitahan()[0] ?? { closest: () => null }),
    );
    check(
      "kasir diberi tahu ke mana transaksinya pergi",
      ui.text().includes("ditahan tadi pukul"),
      ui.text().slice(-200),
    );

    // Pembeli berikutnya dilayani lebih dulu — transaksi kedua jalan seperti biasa.
    await ui.click(kedua.name);
    check(
      "pembeli berikutnya bisa dilayani setelah Hold",
      jumlahItem().includes("1 item"),
      jumlahItem(),
    );
    check(
      "Lanjutkan tidak bisa ditekan selama keranjang yang sekarang masih berisi",
      barisDitahan()[0].disabled === true,
      "tombolnya masih aktif",
    );

    // Transaksi kedua juga ditahan, lalu yang pertama dilanjutkan kembali.
    await ui.clickOn('[data-testid="pos-hold"]');
    check(
      "dua transaksi bisa ditahan sekaligus",
      barisDitahan().length === 2,
      String(barisDitahan().length),
    );
    await ui.clickOn('[data-testid^="pos-lanjutkan-"]');
    check(
      "transaksi yang dilanjutkan kembali ke keranjang",
      jumlahItem().includes("1 item") && barisDitahan().length === 1,
      `${jumlahItem()} · baris=${barisDitahan().length}`,
    );
    check(
      "isinya kembali utuh — nominalnya sama dengan saat ditahan",
      totalKeranjang() === totalSaatDitahan,
      `${totalSaatDitahan} → ${totalKeranjang()}`,
    );
    check(
      "notis melanjutkan menyebut transaksinya",
      ui.text().includes("dilanjutkan"),
      ui.text().slice(-200),
    );

    await ui.clickOn('[data-testid^="pos-buang-"]');
    check(
      "Buang menghapus tahanan yang tersisa",
      ui.query('[data-testid="pos-ditahan"]') === null && barisDitahan().length === 0,
      String(barisDitahan().length),
    );
    await ui.unmount();
    withoutSession();
  }

  // 3d-5. Meja yang pesanannya sudah dibayar tetap terkunci untuk kasir sampai
  //       dapur menekan **Selesai** — dibuktikan pada dua layar yang dipakai
  //       bersamaan (kasir & dapur berbagi store yang sama).
  {
    withFnbSession();

    const kas = {};
    function MejaProbe() {
      const store = useStore();
      kas.products = store.products
        .filter((p) => p.stock > 2 && p.price > 0 && !(p.modifiers?.length > 0))
        .map((p) => ({ name: p.name, price: p.price }));
      kas.tables = store.tables
        .filter((t) => t.active)
        .map((t) => ({ id: t.id, name: t.name }));
      kas.tickets = () => store.kdsTickets;
      return null;
    }

    const ui = await renderInteractive(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(PosPage, null),
          React.createElement(KdsPage, null),
          React.createElement(MejaProbe, null),
        ),
      ),
    );

    const produk = (kas.products ?? [])[0];
    const meja = (kas.tables ?? [])[0];
    check(
      "ada produk & meja aktif untuk menguji kunci meja",
      Boolean(produk && meja),
      JSON.stringify(kas).slice(0, 200),
    );

    const chip = () => ui.query(`[data-testid="pos-meja-${meja.id}"]`);
    const kartuDapur = () =>
      (ui.query(`[data-testid="meja-kartu-${meja.id}"]`)?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
    const jumlahItem = () =>
      ui.query('[data-testid="keranjang-jumlah-item"]')?.textContent ?? "";

    check(
      "meja awal masih bebas dipilih kasir",
      chip() !== null && chip().disabled === false,
      String(chip()?.getAttribute("title")),
    );
    check(
      "meja belum terisi di layar dapur",
      kartuDapur().includes("Kosong"),
      kartuDapur(),
    );

    await ui.clickOn(`[data-testid="pos-meja-${meja.id}"]`);
    check(
      "meja yang dipilih tercatat di keranjang",
      jumlahItem().includes(`Meja ${meja.name}`),
      jumlahItem(),
    );
    await ui.click(produk.name);
    await ui.click("Bayar");
    await ui.clickOn('[data-testid="cash-cepat-100000"]');
    await ui.click("Selesaikan pembayaran");
    await ui.clickOn('[aria-label="Tutup struk"]');

    const tiket = (kas.tickets?.() ?? []).at(-1);
    check(
      "penjualan lunas masuk antrean dapur dengan mejanya",
      Boolean(tiket) && tiket.tableName === meja.name && tiket.settled === true,
      JSON.stringify((kas.tickets?.() ?? []).map((row) => [row.number, row.tableName, row.settled])),
    );
    check(
      "meja terkunci untuk kasir begitu uangnya diterima",
      chip().disabled === true && chip().getAttribute("data-meja-terkunci") === "true",
      String(chip()?.getAttribute("title")),
    );
    check(
      "alasannya disebutkan: sudah dibayar, tunggu dapur",
      String(chip()?.getAttribute("title")).includes("sudah dibayar") &&
        String(chip()?.getAttribute("title")).includes("Selesai"),
      String(chip()?.getAttribute("title")),
    );
    check(
      "kartu meja di layar dapur menandainya terisi",
      kartuDapur().includes(`Terisi ${tiket?.number}`),
      kartuDapur(),
    );
    let klikTerkunci = "berhasil";
    try {
      await ui.clickOn(`[data-testid="pos-meja-${meja.id}"]`);
    } catch (error) {
      klikTerkunci = error.message;
    }
    check(
      "kasir tidak bisa memilih meja yang sudah dibayar",
      klikTerkunci.includes("nonaktif"),
      klikTerkunci,
    );

    await ui.clickOn(`[data-testid="kds-selesai-${tiket?.saleId}"]`);
    check(
      "dapur menekan Selesai: tiketnya keluar dari antrean",
      !(kas.tickets?.() ?? []).some((row) => row.saleId === tiket?.saleId),
      JSON.stringify((kas.tickets?.() ?? []).map((row) => row.number)),
    );
    check(
      "meja terbuka lagi untuk kasir setelah dapur selesai",
      chip().disabled === false && chip().getAttribute("data-meja-terkunci") === "false",
      String(chip()?.getAttribute("title")),
    );
    check(
      "kartu meja di layar dapur kembali kosong",
      kartuDapur().includes("Kosong"),
      kartuDapur(),
    );
    await ui.clickOn(`[data-testid="pos-meja-${meja.id}"]`);
    check(
      "meja itu benar-benar bisa dipakai kasir lagi",
      jumlahItem().includes(`Meja ${meja.name}`),
      jumlahItem(),
    );
    await ui.unmount();
    withoutSession();
  }

  // 3e. Piutang B2B & credit limit (`ar.creditlimit`, modul Grosir) di klien:
  //     pelanggan menunggak dan pelanggan tanpa limit ditolak dengan pesan yang
  //     sama seperti server, sementara tempo yang sah membuat nota piutang baru
  //     dan menurunkan sisa limit pelanggannya.
  const WS_SESSION = {
    user: { name: "Uji Grosir", email: "grosir@mesinpos.test" },
    tenant: {
      name: "Grosir Uji",
      slug: "grosir-uji",
      storeName: "Cabang Uji",
      vertical: "wholesale",
      verticals: ["wholesale"],
      planKey: "professional",
      role: "owner",
      createdAt: new Date().toISOString(),
      trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
    },
  };

  function withWholesaleSession() {
    window.localStorage.setItem("mesinpos.session.v1", JSON.stringify(WS_SESSION));
    withOpenShift();
  }

  const { ReceivablesPage } = await server.ssrLoadModule(
    "/src/pages/ReceivablesPage.tsx",
  );

  {
    withWholesaleSession();

    function ArProbe() {
      const store = useStore();
      const step = React.useRef(0);
      const facts = React.useRef({});

      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;
        const overdue = store.customers.find((c) => c.overdueAmount > 0);
        const cash = store.customers.find((c) => c.creditLimit === 0);
        const clean = store.customers.find(
          (c) => c.creditLimit > 0 && c.overdueAmount === 0,
        );
        const product = store.products.find((p) => p.stock > 2);

        facts.current.overdueName = overdue?.name;
        facts.current.overdueAmount = overdue?.overdueAmount;
        facts.current.cleanId = clean?.id;
        facts.current.cleanName = clean?.name;
        facts.current.availableBefore = clean?.availableCredit;

        void (async () => {
          // a. Pelanggan menunggak → tempo baru ditolak.
          try {
            await store.createSale({
              items: [{ productId: product.id, quantity: 1 }],
              discount: 0,
              method: "Transfer",
              customerId: overdue.id,
              paidAmount: 0,
            });
            facts.current.overdueBlock = "DITERIMA";
          } catch (error) {
            facts.current.overdueBlock = error.message;
          }

          // b. Pelanggan tanpa limit → tempo ditolak.
          try {
            await store.createSale({
              items: [{ productId: product.id, quantity: 1 }],
              discount: 0,
              method: "Transfer",
              customerId: cash.id,
              paidAmount: 0,
            });
            facts.current.noLimitBlock = "DITERIMA";
          } catch (error) {
            facts.current.noLimitBlock = error.message;
          }

          // c. Tempo sah: belum dibayar sama sekali → seluruh total jadi piutang.
          try {
            const receipt = await store.createSale({
              items: [{ productId: product.id, quantity: 1 }],
              discount: 0,
              method: "Transfer",
              customerId: clean.id,
              paidAmount: 0,
            });
            facts.current.receipt = receipt.number ?? "(offline)";
          } catch (error) {
            facts.current.error = error.message;
          }
        })();
      }, [store]);

      const clean = store.customers.find((c) => c.id === facts.current.cleanId);
      const fresh = store.receivables.find(
        (row) => row.customerId === facts.current.cleanId && row.number !== "AR-00002",
      );

      return React.createElement(
        "div",
        null,
        `jatuh_tempo=${facts.current.overdueAmount ?? "?"}` +
          ` blok_tempo=${String(facts.current.overdueBlock ?? "-").replace(/\s+/g, "_")}` +
          ` blok_tanpa_limit=${String(facts.current.noLimitBlock ?? "-").replace(/\s+/g, "_")}` +
          ` sisa_sebelum=${facts.current.availableBefore ?? "?"}` +
          ` sisa_sesudah=${clean?.availableCredit ?? "?"}` +
          ` nota_baru=${fresh ? `${fresh.number}:${fresh.balance}` : "tidak_ada"}` +
          ` nota_umur=${fresh ? fresh.bucket : "-"}` +
          ` piutang_total=${store.arSummary.outstanding}` +
          ` error=${facts.current.error ?? "-"}`,
      );
    }

    const { text, newErrors } = await renderTree(providers(React.createElement(ArProbe, null)));
    const facts = Object.fromEntries(
      [...text.matchAll(/([a-z_]+)=([^ ]+)/g)].map((match) => [match[1], match[2]]),
    );

    check("pelanggan contoh punya piutang jatuh tempo", Number(facts.jatuh_tempo) > 0, text);
    check(
      "pelanggan menunggak diblokir untuk tempo baru",
      facts.blok_tempo.includes("Toko_Berkah_Jaya"),
      text,
    );
    check(
      "tempo ditolak untuk pelanggan menunggak",
      facts.blok_tempo.includes("jatuh_tempo"),
      text,
    );
    check(
      "tempo ditolak untuk pelanggan tanpa limit",
      facts.blok_tanpa_limit.includes("belum_punya_limit_kredit"),
      text,
    );
    check("tempo sah tanpa error", facts.error === "-", text);
    // Harga 22.000 × 1 + PPN 11% = 24.420, dibayar 0 → seluruhnya jadi piutang.
    check("nota piutang baru dibuat di klien", facts.nota_baru.endsWith(":24420"), text);
    check("nota baru belum jatuh tempo", facts.nota_umur === "current", text);
    check(
      "sisa limit pelanggan turun sebesar piutang baru",
      Number(facts.sisa_sebelum) - Number(facts.sisa_sesudah) === 24420,
      text,
    );
    check(
      "piutang total naik & tanpa error konsol",
      Number(facts.piutang_total) > 24420 && newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200) || text,
    );
  }

  // 3e-2. Penagihan: pelunasan sebagian dihitung benar, kelebihan bayar ditolak,
  //       dan nota hilang dari daftar terbuka setelah lunas.
  {
    withWholesaleSession();

    function CollectionProbe() {
      const store = useStore();
      const step = React.useRef(0);
      const facts = React.useRef({});

      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;
        const open = store.receivables.find((row) => row.balance === 450000);
        facts.current.id = open?.id;

        void (async () => {
          try {
            await store.recordPayment({
              receivableId: open.id,
              amount: 200000,
              method: "Transfer",
            });
            facts.current.partial = "diterima";
          } catch (error) {
            facts.current.partial = error.message;
          }

          try {
            await store.recordPayment({
              receivableId: open.id,
              amount: 999999,
              method: "Tunai",
            });
            facts.current.over = "DITERIMA";
          } catch (error) {
            facts.current.over = error.message;
          }

          try {
            await store.recordPayment({
              receivableId: open.id,
              amount: 250000,
              method: "Tunai",
            });
            facts.current.settle = "diterima";
          } catch (error) {
            facts.current.settle = error.message;
          }
        })();
      }, [store]);

      const row = store.receivables.find((r) => r.id === facts.current.id);
      return React.createElement(
        "div",
        null,
        `sebagian=${facts.current.partial ?? "-"}` +
          ` kelebihan=${String(facts.current.over ?? "-").replace(/\s+/g, "_")}` +
          ` lunas=${facts.current.settle ?? "-"}` +
          ` dibayar=${row?.paidAmount ?? "?"}` +
          ` sisa=${row?.balance ?? "?"}` +
          ` status=${row?.status ?? "?"}` +
          ` nota_terbuka=${store.arSummary.openCount}` +
          ` jatuh_tempo=${store.arSummary.overdueCount}`,
      );
    }

    const { text } = await renderTree(
      providers(React.createElement(CollectionProbe, null)),
    );
    const facts = Object.fromEntries(
      [...text.matchAll(/([a-z_]+)=([^ ]+)/g)].map((match) => [match[1], match[2]]),
    );

    check("pelunasan sebagian diterima", facts.sebagian === "diterima", text);
    check(
      "kelebihan bayar ditolak",
      facts.kelebihan.includes("melebihi_sisa_piutang"),
      text,
    );
    check("pelunasan sisa diterima", facts.lunas === "diterima", text);
    check("nota menjadi lunas", facts.dibayar === "450000" && facts.sisa === "0" && facts.status === "paid", text);
    check("nota lunas tidak lagi dihitung piutang terbuka", facts.nota_terbuka === "1", text);
  }

  // 3e-3. Halaman Piutang: modul Grosir aktif menampilkan limit, umur piutang,
  //       dan menarik tempo baru untuk pelanggan yang menunggak.
  {
    withWholesaleSession();
    const { text, newErrors } = await renderTree(
      providers(React.createElement(ReceivablesPage, null)),
    );
    check("halaman Piutang merender ringkasan", text.includes("Piutang & Limit Kredit"), text.slice(0, 200));
    check("halaman Piutang menampilkan umur piutang", text.includes("Umur piutang"), text.slice(0, 200));
    check(
      "halaman Piutang memuat pelanggan contoh & sisanya",
      text.includes("Toko Berkah Jaya") && text.includes("Warung Sederhana"),
      text.slice(0, 300),
    );
    check("halaman Piutang tanpa error konsol", newErrors.length === 0, newErrors.join(" | ").slice(0, 200));
  }

  // 3e-4. Tanpa modul Grosir: halaman menjelaskan bahwa tempo terkunci, bukan gagal.
  {
    withoutSession();
    const { text } = await renderTree(
      providers(React.createElement(ReceivablesPage, null)),
    );
    /*
      Halaman modul tanpa langganan hanya bisa dibaca: datanya tetap terlihat,
      tetapi halaman mengatakannya apa adanya — bukan menjanjikan aksi yang akan
      ditolak server (dan bukan pula menyembunyikan isinya).
    */
    check(
      "halaman Piutang menjelaskan modul Grosir yang belum aktif & menyatakan dirinya hanya bisa dibaca",
      text.includes("belum aktif") &&
        text.includes("hanya bisa dibaca") &&
        text.includes("nota lama tetap") &&
        text.includes("tidak bisa ditagih"),
      text.slice(0, 300),
    );
  }

  // 3e-4b. Member & diskon member (`member.discount`, modul UMKM).
  const UMKM_SESSION = {
    user: { name: "Uji Member", email: "member@mesinpos.test" },
    tenant: {
      name: "Toko Uji",
      slug: "toko-uji",
      storeName: "Cabang Uji",
      vertical: "umkm",
      verticals: ["umkm"],
      planKey: "professional",
      role: "owner",
      createdAt: new Date().toISOString(),
      trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
    },
  };

  function withUmkmSession() {
    window.localStorage.setItem("mesinpos.session.v1", JSON.stringify(UMKM_SESSION));
    withOpenShift();
  }

  const { MembersPage } = await server.ssrLoadModule("/src/pages/MembersPage.tsx");
  {
    withUmkmSession();

    function MemberProbe() {
      const store = useStore();
      const step = React.useRef(0);
      const facts = React.useRef({});

      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;
        const member = store.members.find((m) => m.active && m.discountPct === 5);
        const inactive = store.members.find((m) => !m.active);
        const product = store.products.find((p) => p.price === 22000);

        facts.current.member = member?.name;
        facts.current.inactive = inactive?.name;
        facts.current.count = store.members.length;

        void (async () => {
          // 1. Diskon member 5% dari 22.000 → 1.100; total 23.199 (PPN 11%).
          try {
            const sale = await store.createSale({
              items: [{ productId: product.id, quantity: 1 }],
              discount: 0,
              method: "Tunai",
              memberId: member.id,
            });
            facts.current.total = sale.total;
            facts.current.memberDiscount = sale.memberDiscount ?? 0;
          } catch (error) {
            facts.current.error = error.message;
          }

          // 2. Member nonaktif tidak mendapat diskon — bahkan tidak bisa dipakai.
          try {
            await store.createSale({
              items: [{ productId: product.id, quantity: 1 }],
              discount: 0,
              method: "Tunai",
              memberId: inactive.id,
            });
            facts.current.inactiveBlock = "DITERIMA";
          } catch (error) {
            facts.current.inactiveBlock = error.message;
          }

          // 3. Diskon member + diskon manual digabung, dipatok di subtotal.
          try {
            const combined = await store.createSale({
              items: [{ productId: product.id, quantity: 1 }],
              discount: 1000,
              method: "Tunai",
              memberId: member.id,
            });
            facts.current.combined = combined.total;
          } catch (error) {
            facts.current.combinedError = error.message;
          }
        })();
      }, [store]);

      return React.createElement(
        "div",
        null,
        `anggota=${facts.current.count ?? "?"}` +
          ` member=${String(facts.current.member ?? "?").replace(/\s+/g, "_")}` +
          ` diskon_member=${facts.current.memberDiscount ?? "?"}` +
          ` total=${facts.current.total ?? "?"}` +
          ` total_gabungan=${facts.current.combined ?? "?"}` +
          ` blok_nonaktif=${String(facts.current.inactiveBlock ?? "-").replace(/\s+/g, "_")}` +
          ` error=${facts.current.error ?? "-"}` +
          ` error_gabungan=${facts.current.combinedError ?? "-"}`,
      );
    }

    const { text, newErrors } = await renderTree(
      providers(React.createElement(MemberProbe, null)),
    );
    const facts = Object.fromEntries(
      [...text.matchAll(/([a-z_]+)=([^ ]+)/g)].map((match) => [match[1], match[2]]),
    );

    check("daftar member contoh tersedia di store", Number(facts.anggota) >= 4, text);
    check(
      "diskon member 5% dihitung (1.100 dari 22.000)",
      facts.diskon_member === "1100",
      text,
    );
    check("total memakai subtotal setelah diskon member (23.199)", facts.total === "23199", text);
    check(
      "diskon member + manual digabung (22.089)",
      facts.total_gabungan === "22089",
      text,
    );
    check(
      "member nonaktif ditolak dengan penjelasan",
      facts.blok_nonaktif.includes("tidak_aktif"),
      text,
    );
    check(
      "alur member tanpa error lain",
      facts.error === "-" && facts.error_gabungan === "-",
      text,
    );
    check("alur member tanpa error konsol", newErrors.length === 0, newErrors.join(" | ").slice(0, 200));
  }

  // 3e-4c. Halaman Member: daftar + penjelasan modul/paket yang tepat.
  {
    withUmkmSession();
    const { text, newErrors } = await renderTree(
      providers(React.createElement(MembersPage, null)),
    );
    check("halaman Member merender daftar", text.includes("Member & Diskon"), text.slice(0, 200));
    check(
      "halaman Member memuat member contoh & ringkasannya",
      text.includes("Bu Sari Wulandari") &&
        text.includes("Agus Setiawan") &&
        text.includes("Diskon terbesar"),
      text.slice(0, 300),
    );
    check("halaman Member tanpa error konsol", newErrors.length === 0, newErrors.join(" | ").slice(0, 200));

    // Paket Starter tidak memuat `member.discount`: halaman harus menyebut
    // **paket**, bukan menyuruh menyalakan modul yang sudah aktif.
    withoutSession();
    const starter = await renderTree(providers(React.createElement(MembersPage, null)));
    check(
      "halaman Member menyebut paket Starter sebagai penyebab",
      starter.text.includes("tidak termasuk paket Starter"),
      starter.text.slice(0, 300),
    );
    check(
      "halaman Member tetap bisa dibaca walau fiturnya mati",
      starter.text.includes("Bu Sari Wulandari"),
      starter.text.slice(0, 300),
    );
  }

  // 3e-4d. POS: pemilih member hanya muncul saat diskon member benar-benar hidup,
  //        dan tidak muncul untuk tenant yang modul UMKM-nya mati.
  {
    withUmkmSession();
    const { text } = await renderTree(providers(React.createElement(PosPage, null)));
    check(
      "POS menampilkan pemilih member saat modul UMKM aktif",
      text.includes("Pilih member untuk memakai diskonnya"),
      text.slice(0, 300),
    );

    withFnbSession();
    const fnbOnly = await renderTree(providers(React.createElement(PosPage, null)));
    check(
      "POS tanpa modul UMKM tidak menawarkan diskon member",
      !fnbOnly.text.includes("Pilih member"),
      fnbOnly.text.slice(0, 300),
    );
    withoutSession();
  }

  // 3e-4e. Gudang & stok per lokasi (`inventory.multiwarehouse`, Phase 3).
  const ENTERPRISE_SESSION = {
    user: { name: "Uji Gudang", email: "gudang@mesinpos.test" },
    tenant: {
      name: "Distribusi Uji",
      slug: "distribusi-uji",
      storeName: "Cabang Uji",
      vertical: "wholesale",
      verticals: ["umkm", "fnb", "wholesale"],
      planKey: "enterprise",
      role: "owner",
      createdAt: new Date().toISOString(),
      trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
    },
  };

  function withEnterpriseSession(planKey = "enterprise") {
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        ...ENTERPRISE_SESSION,
        tenant: { ...ENTERPRISE_SESSION.tenant, planKey },
      }),
    );
    withOpenShift();
  }

  const { InventoryPage } = await server.ssrLoadModule("/src/pages/InventoryPage.tsx");
  const { DEFAULT_WAREHOUSE_ID } = await server.ssrLoadModule("/src/lib/inventory.ts");
  const { PurchasingPage } = await server.ssrLoadModule("/src/pages/PurchasingPage.tsx");

  // 3e-4e-1. Halaman: lokasi contoh terlihat, dan paket tanpa fiturnya menyebut
  //          penyebab yang tepat tanpa menyembunyikan stok yang sudah ada.
  {
    withEnterpriseSession();
    const { text, newErrors } = await renderTree(
      providers(React.createElement(InventoryPage, null)),
    );
    check(
      "halaman Gudang & Stok memuat lokasi contoh",
      text.includes("Gudang Utama") && text.includes("GD-A") && text.includes("Gudang Cabang"),
      text.slice(0, 300),
    );
    check(
      "lokasi jual ditandai sebagai lokasi jual",
      text.includes("Lokasi jual"),
      text.slice(0, 300),
    );
    check(
      "tabel stok per lokasi tampil beserta totalnya",
      text.includes("Stok per lokasi") && text.includes("Kopi Susu Gula Aren"),
      text.slice(0, 400),
    );
    check(
      "paket Enterprise menawarkan form tambah gudang",
      text.includes("Tambah gudang") && !text.includes("tidak termasuk paket"),
      text.slice(0, 300),
    );
    check(
      "halaman gudang tanpa error konsol",
      newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200),
    );

    // Starter tidak memuat `inventory.multiwarehouse`: yang hilang paketnya,
    // bukan modulnya — dan stok yang sudah ada tetap harus terbaca.
    withoutSession();
    const starter = await renderTree(
      providers(React.createElement(InventoryPage, null)),
    );
    check(
      "halaman gudang menyebut paket Starter sebagai penyebab",
      starter.text.includes("tidak termasuk paket Starter"),
      starter.text.slice(0, 300),
    );
    check(
      "stok per lokasi tetap bisa dibaca walau fiturnya mati",
      starter.text.includes("Gudang Utama") && starter.text.includes("Stok per lokasi"),
      starter.text.slice(0, 300),
    );
  }

  // 3e-4e-2. Alur perpindahan stok lewat store demo (aturan yang sama dengan
  //          backend): total tidak berubah, sumber tidak boleh kebablasan, dan
  //          gudang berisi stok tidak boleh dinonaktifkan.
  {
    withEnterpriseSession();

    function InventoryAct() {
      const store = useStore();
      const step = React.useRef(0);
      const facts = React.useRef({});

      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;

        void (async () => {
          const gudang = store.warehouses.find((w) => w.code === "GD-A");
          const before = store.stock.find((row) => row.productId === "p01");
          facts.current.sebelum = before?.sellable ?? "?";
          facts.current.total_sebelum = before?.total ?? "?";
          facts.current.gudang_sebelum =
            before?.levels.find((level) => level.warehouseId === gudang?.id)?.quantity ?? "?";

          try {
            const moved = await store.transferStock({
              productId: "p01",
              from: gudang.id,
              to: DEFAULT_WAREHOUSE_ID,
              quantity: 20,
            });
            facts.current.nomor = moved.number;
          } catch (error) {
            facts.current.error = error.message;
          }

          // Sumber tidak punya cukup stok setelah perpindahan pertama.
          try {
            await store.transferStock({
              productId: "p01",
              from: gudang.id,
              to: DEFAULT_WAREHOUSE_ID,
              quantity: 9999,
            });
            facts.current.lebih = "DITERIMA";
          } catch (error) {
            facts.current.lebih = error.message;
          }

          // Gudang yang masih berisi stok tidak boleh dinonaktifkan.
          try {
            await store.setWarehouseActive(gudang.id, false);
            facts.current.nonaktif_berisi = "DITERIMA";
          } catch (error) {
            facts.current.nonaktif_berisi = error.message;
          }

          // Gudang baru (Enterprise) tanpa stok boleh dibuat lalu dimatikan.
          try {
            const created = await store.createWarehouse({
              name: "Gudang Transit",
              code: "GD-T",
            });
            facts.current.gudang_baru = created.code;
            await store.setWarehouseActive(created.id, false);
            facts.current.nonaktif_kosong = "boleh";
          } catch (error) {
            facts.current.buat_error = error.message;
          }
        })();
      }, [store]);

      const product = store.stock.find((row) => row.productId === "p01");
      const gudang = store.warehouses.find((w) => w.code === "GD-A");

      return React.createElement(
        "div",
        null,
        `sebelum=${facts.current.sebelum ?? "?"}` +
          ` total_sebelum=${facts.current.total_sebelum ?? "?"}` +
          ` gudang_sebelum=${facts.current.gudang_sebelum ?? "?"}` +
          ` nomor=${String(facts.current.nomor ?? "?")}` +
          ` sesudah=${product?.sellable ?? "?"}` +
          ` total_sesudah=${product?.total ?? "?"}` +
          ` gudang_sesudah=${
            product?.levels.find((level) => level.warehouseId === gudang?.id)?.quantity ?? "?"
          }` +
          ` lebih=${String(facts.current.lebih ?? "-").replace(/\s+/g, "_")}` +
          ` nonaktif_berisi=${
            String(facts.current.nonaktif_berisi ?? "-").replace(/\s+/g, "_")
          }` +
          ` gudang_baru=${String(facts.current.gudang_baru ?? "-")}` +
          ` nonaktif_kosong=${String(facts.current.nonaktif_kosong ?? "-")}` +
          ` lokasi=${store.warehouses.length}` +
          ` riwayat=${store.transfers.length}` +
          ` penuh=${store.warehouseCapacity.full}` +
          ` gagal_kosong=${String(facts.current.buat_error ?? "-").replace(/\s+/g, "_")}`,
      );
    }

    const { text, newErrors } = await renderTree(
      providers(React.createElement(InventoryAct, null)),
    );
    const facts = Object.fromEntries(
      [...text.matchAll(/([a-z_]+)=([^ ]+)/g)].map((match) => [match[1], match[2]]),
    );

    check(
      "stok gudang contoh tersedia (GD-A 120, lokasi jual 48)",
      facts.gudang_sebelum === "120" && facts.sebelum === "48" && facts.total_sebelum === "192",
      text,
    );
    check(
      "perpindahan memberi nomor TRF dan memindahkan 20 unit",
      facts.nomor === "TRF-00001" &&
        facts.sesudah === "68" &&
        facts.gudang_sesudah === "100",
      text,
    );
    check(
      "total stok tidak berubah karena perpindahan",
      facts.total_sesudah === facts.total_sebelum,
      text,
    );
    check(
      "perpindahan melebihi stok sumber ditolak dengan angka",
      facts.lebih.includes("hanya_100"),
      text,
    );
    check(
      "gudang yang masih berisi stok tidak bisa dinonaktifkan",
      facts.nonaktif_berisi.includes("masih_menyimpan"),
      text,
    );
    check(
      "gudang baru tanpa stok boleh dibuat lalu dinonaktifkan",
      facts.gudang_baru === "GD-T" && facts.nonaktif_kosong === "boleh",
      text,
    );
    check(
      "riwayat perpindahan tercatat & paket Enterprise belum penuh",
      facts.riwayat === "1" && facts.penuh === "false" && facts.lokasi === "5",
      text,
    );
    check(
      "alur gudang tanpa error lain",
      facts.error === undefined && facts.gagal_kosong === "-",
      text,
    );
    check(
      "alur gudang tanpa error konsol",
      newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200),
    );

    // Paket tanpa fitur: klien menolak lebih dulu dengan pesan yang sama seperti
    // server, jadi pemilik tidak mengira gudangnya sudah tersimpan.
    withEnterpriseSession("professional");
    function WarehouseGateProbe() {
      const store = useStore();
      const step = React.useRef(0);
      const facts = React.useRef({});

      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;
        void (async () => {
          try {
            await store.createWarehouse({ name: "Gudang Uji", code: "GD-U" });
            facts.current.blokir = "DITERIMA";
          } catch (error) {
            facts.current.blokir = error.message;
          }
        })();
      }, [store]);

      return React.createElement(
        "div",
        null,
        `blokir=${String(facts.current.blokir ?? "?").replace(/\s+/g, "_")}` +
          ` lokasi=${store.warehouses.length}`,
      );
    }

    const gate = await renderTree(
      providers(React.createElement(WarehouseGateProbe, null)),
    );
    check(
      "menambah gudang ditolak paket yang tidak memuat fiturnya",
      gate.text.includes("tidak_termasuk_paket") && gate.text.includes("lokasi=4"),
      gate.text,
    );
    withoutSession();
  }

  // 3e-4e-3. Stock opname (Phase 3, `inventory.opname`): sesi contoh di halaman,
  //          dan alur hitung → posting di store demo memakai aturan yang sama
  //          dengan server (saldo terbaru saat posting, baris belum dihitung
  //          tidak disentuh).
  {
    withEnterpriseSession();
    const { OpnamePage } = await server.ssrLoadModule("/src/pages/OpnamePage.tsx");

    {
      const { text, newErrors } = await renderTree(
        providers(React.createElement(OpnamePage, null)),
      );
      check(
        "halaman Opname memuat sesi contoh berjalan & selesai",
        text.includes("Stock Opname") &&
          text.includes("OPN-00001") &&
          text.includes("OPN-00002") &&
          text.includes("Opname bulanan gudang"),
        text.slice(0, 400),
      );
      check(
        "progres sesi contoh terbaca (3 dari 4 baris gudang)",
        text.includes("3/4 dihitung"),
        text.slice(0, 400),
      );
      check(
        "baris yang belum dihitung ditampilkan sebagai belum dihitung, bukan nol",
        text.includes("belum dihitung"),
        text.slice(0, 600),
      );
      check(
        "pemilik melihat aksi posting & pembatalan",
        text.includes("Posting hasil hitung") && text.includes("Batalkan sesi"),
        text.slice(0, 400),
      );
      check(
        "halaman Opname tanpa error konsol",
        newErrors.length === 0,
        newErrors.join(" | ").slice(0, 200),
      );

      // Starter tidak memuat `inventory.opname`: yang hilang paketnya, bukan
      // datanya — sesi yang sudah berjalan tetap harus terbaca.
      withoutSession();
      const starter = await renderTree(
        providers(React.createElement(OpnamePage, null)),
      );
      check(
        "halaman Opname menyebut paket Starter sebagai penyebab sesi baru ditolak",
        starter.text.includes("tidak termasuk paket Starter"),
        starter.text.slice(0, 400),
      );
      check(
        "sesi opname lama tetap terbaca walau fiturnya mati",
        starter.text.includes("OPN-00002") && starter.text.includes("Stock Opname"),
        starter.text.slice(0, 400),
      );
    }

    // Alur penuh di store demo: hitung satu produk, posting, lalu sesi kedua yang
    // hanya menghitung satu baris dari banyak — sisanya harus utuh.
    withEnterpriseSession();

    function OpnameAct() {
      const store = useStore();
      const step = React.useRef(0);
      const facts = React.useRef({});
      const lain = React.useRef(0);

      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;

        void (async () => {
          const awal = store.products.find((row) => row.id === "p01")?.stock ?? 0;
          facts.current.awal = awal;
          lain.current = store.products.find((row) => row.id === "p02")?.stock ?? 0;

          try {
            const dibuat = await store.startOpname({
              productIds: ["p01"],
              note: "Hitung rak depan",
            });
            facts.current.nomor = dibuat.number;

            // Satu lokasi hanya boleh punya satu sesi berjalan.
            facts.current.ganda = await store
              .startOpname({ productIds: ["p01"] })
              .then(
                () => "DITERIMA",
                (error) => error.message,
              );

            await store.setOpnameCount({
              sessionId: dibuat.id,
              productId: "p01",
              countedQty: awal - 3,
            });
            const posted = await store.postOpname(dibuat.id);
            facts.current.gerakan = posted.movements;
            facts.current.netto = posted.netUnits;

            // Sesi selesai tidak bisa diubah lagi.
            facts.current.terkunci = await store
              .setOpnameCount({ sessionId: dibuat.id, productId: "p01", countedQty: 1 })
              .then(
                () => "DITERIMA",
                (error) => error.message,
              );

            // Sesi kedua menghitung semua produk tetapi hanya satu baris diisi.
            const kedua = await store.startOpname({ note: "Hitung sebagian" });
            await store.setOpnameCount({
              sessionId: kedua.id,
              productId: "p01",
              countedQty: awal + 5,
            });
            const sebagian = await store.postOpname(kedua.id);
            facts.current.gerakan2 = sebagian.movements;
            facts.current.netto2 = sebagian.netUnits;

            // Sesi yang dibatalkan juga terkunci.
            const ketiga = await store.startOpname({ note: "Salah hari" });
            await store.cancelOpname(ketiga.id, "Salah hari");
            facts.current.batal = await store
              .setOpnameCount({ sessionId: ketiga.id, productId: "p01", countedQty: 1 })
              .then(
                () => "DITERIMA",
                (error) => error.message,
              );
          } catch (error) {
            facts.current.error = error.message;
          }
        })();
      }, [store]);

      const p01 = store.products.find((row) => row.id === "p01")?.stock ?? 0;
      const p02 = store.products.find((row) => row.id === "p02")?.stock ?? 0;

      return React.createElement(
        "div",
        null,
        `awal=${facts.current.awal ?? "?"}` +
          ` nomor=${String(facts.current.nomor ?? "?")}` +
          ` ganda=${String(facts.current.ganda ?? "-").replace(/\s+/g, "_")}` +
          ` gerakan=${String(facts.current.gerakan ?? "?")}` +
          ` netto=${String(facts.current.netto ?? "?")}` +
          ` terkunci=${String(facts.current.terkunci ?? "-").replace(/\s+/g, "_")}` +
          ` gerakan2=${String(facts.current.gerakan2 ?? "?")}` +
          ` netto2=${String(facts.current.netto2 ?? "?")}` +
          ` stok=${p01}` +
          ` lain_sebelum=${lain.current}` +
          ` lain_sesudah=${p02}` +
          ` batal=${String(facts.current.batal ?? "-").replace(/\s+/g, "_")}` +
          ` sesi=${store.opnameSessions.length}` +
          ` error=${String(facts.current.error ?? "-").replace(/\s+/g, "_")}`,
      );
    }

    const act = await renderTree(providers(React.createElement(OpnameAct, null)));
    const acted = Object.fromEntries(
      [...act.text.matchAll(/([a-z0-9_]+)=([^ ]+)/g)].map((match) => [match[1], match[2]]),
    );

    check(
      "hitung satu produk: sesi baru memakai nomor lanjut (OPN-00003)",
      acted.awal === "48" && acted.nomor === "OPN-00003",
      act.text,
    );
    check(
      "lokasi yang masih punya sesi berjalan menolak sesi kedua",
      acted.ganda.includes("masih_punya_sesi_opname"),
      act.text,
    );
    check(
      "posting menerapkan selisih fisik (satu gerakan −3)",
      acted.gerakan === "1" && acted.netto === "-3",
      act.text,
    );
    check(
      "sesi yang sudah selesai tidak bisa diubah lagi",
      acted.terkunci.includes("sudah_selesai"),
      act.text,
    );
    // Sesi kedua menulis 53 sementara saldo saat itu 45 (48 − 3 dari posting
    // pertama): delta +8, bukan +5 dari snapshot. Inilah buktinya posting selalu
    // memakai saldo terbaru, bukan angka saat sesi dimulai.
    check(
      "hitung sebagian memakai saldo terbaru (45 → 53 = +8, satu gerakan)",
      acted.gerakan2 === "1" && acted.netto2 === "8" && acted.stok === "53",
      act.text,
    );
    check(
      "baris yang belum dihitung tidak dianggap nol (stok produk lain utuh)",
      acted.lain_sebelum === acted.lain_sesudah,
      act.text,
    );
    check(
      "sesi yang dibatalkan terkunci",
      acted.batal.includes("sudah_dibatalkan"),
      act.text,
    );
    check(
      "tiga sesi uji tercatat di store demo",
      acted.sesi === "5",
      act.text,
    );
    check(
      "alur opname tanpa error lain",
      acted.error === "-" && act.newErrors.length === 0,
      `${act.text} | ${act.newErrors.join(" | ")}`,
    );
    withoutSession();
  }

  // 3e-4f. Pembelian (Phase 3, `purchasing.basic`): PR → PO → GRN.
  //        Satu alur penuh dari data contoh, memakai aturan yang sama dengan server.
  {
    withEnterpriseSession();

    function PurchasingProbe() {
      const store = useStore();
      const step = React.useRef(0);
      const facts = React.useRef({});

      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;

        void (async () => {
          const pr = store.requisitions.find((row) => row.number === "PR-00001");
          facts.current.pr = pr?.number;
          facts.current.pr_status_awal = pr?.status;
          facts.current.pr_baris = pr?.lines.length;
          // Id dikumpulkan dari hasil mutasi, bukan dari snapshot render — dua
          // aksi berurutan dalam satu tick melihat hasil aksi sebelumnya.
          let orderId = "";

          // 1. Yang meminta bukan yang menyetujui: PR disetujui dulu.
          try {
            await store.decideRequisition({ requisitionId: pr.id, approve: true });
            facts.current.setuju = "ok";
          } catch (error) {
            facts.current.setuju = error.message;
          }

          // 2. PO dari PR, harga beli dari data produk (harga jual × 60%).
          try {
            const created = await store.createOrder({
              supplierId: "sup01",
              requisitionId: pr.id,
              lines: [
                { productId: "p01", quantity: 24, unitCost: 13_200 },
                { productId: "p11", quantity: 48, unitCost: 4_800 },
              ],
            });
            facts.current.po = created.number;
            facts.current.po_id = created.id;
            orderId = created.id;
          } catch (error) {
            facts.current.po_error = error.message;
          }

          // 3. Terima sebagian ke lokasi jual: stok naik, PO jadi `partial`.
          try {
            const receipt = await store.receiveGoods({
              orderId,
              warehouseId: DEFAULT_WAREHOUSE_ID,
              lines: [
                { productId: "p01", quantity: 24 },
                { productId: "p11", quantity: 10 },
              ],
            });
            facts.current.grn = receipt.number;
            facts.current.grn_total = receipt.total;
          } catch (error) {
            facts.current.grn_error = error.message;
          }

          // 4. Terima sisanya ke gudang: jalur lokasi non-jual.
          try {
            const receipt = await store.receiveGoods({
              orderId,
              warehouseId: "w01",
              lines: [{ productId: "p11", quantity: 5 }],
            });
            facts.current.grn2 = receipt.number;
          } catch (error) {
            facts.current.grn2_error = error.message;
          }

          // 5. Melebihi sisa PO harus ditolak dengan angka sisanya.
          try {
            await store.receiveGoods({
              orderId,
              warehouseId: "w01",
              lines: [{ productId: "p11", quantity: 999 }],
            });
            facts.current.lebih = "DITERIMA";
          } catch (error) {
            facts.current.lebih = error.message;
          }

          // 6. PR baru sesudahnya tetap bisa diajukan (nomor lanjut).
          try {
            const created = await store.createRequisition({
              lines: [{ productId: "p13", quantity: 10 }],
            });
            facts.current.pr_baru = created.number;
          } catch (error) {
            facts.current.pr_baru_error = error.message;
          }
        })();
      }, [store]);

      const product = store.products.find((row) => row.id === "p11");
      const gudang = store.warehouses.find((row) => row.code === "GD-A");
      // PO yang baru dibuat, bukan PO contoh — nomor dokumennya ikut data demo
      // (PO-00001 & PO-00002 sudah ada sebagai rujukan pencocokan 3 arah).
      const order = store.orders.find((row) => row.id === facts.current.po_id);
      const pr = store.requisitions.find((row) => row.number === "PR-00001");

      return React.createElement(
        "div",
        null,
        `pr=${facts.current.pr ?? "?"}` +
          ` pr_status_awal=${facts.current.pr_status_awal ?? "?"}` +
          ` pr_status=${pr?.status ?? "?"}` +
          ` pr_baris=${facts.current.pr_baris ?? "?"}` +
          ` pr_po=${pr?.orderNumber ?? "-"}` +
          ` setuju=${String(facts.current.setuju ?? "-").replace(/\s+/g, "_")}` +
          ` po=${facts.current.po ?? "-"}` +
          ` po_total=${order?.total ?? "?"}` +
          ` po_status=${order?.status ?? "?"}` +
          ` po_sisa=${order ? order.lines.reduce((sum, line) => sum + (line.quantity - line.receivedQty), 0) : "?"}` +
          ` grn=${facts.current.grn ?? "-"}` +
          ` grn_total=${facts.current.grn_total ?? "?"}` +
          ` grn2=${facts.current.grn2 ?? "-"}` +
          ` lebih=${String(facts.current.lebih ?? "-").replace(/\s+/g, "_")}` +
          ` stok_esteh=${product?.stock ?? "?"}` +
          ` cost_esteh=${product?.cost ?? "?"}` +
          ` gudang_esteh=${
            store.stock
              .find((row) => row.productId === "p11")
              ?.levels.find((level) => level.warehouseId === gudang?.id)?.quantity ?? "?"
          }` +
          ` pr_baru=${facts.current.pr_baru ?? "-"}` +
          ` grn_count=${store.receipts.length}` +
          ` pending=${store.purchasingSummary.pendingRequisitions}` +
          ` error=${String(
            facts.current.po_error ?? facts.current.grn_error ?? "-",
          ).replace(/\s+/g, "_")}` +
          ` error_grn2=${String(facts.current.grn2_error ?? "-").replace(/\s+/g, "_")}` +
          ` error2=${String(facts.current.pr_baru_error ?? "-").replace(/\s+/g, "_")}`,
      );
    }

    const { text, newErrors } = await renderTree(
      providers(React.createElement(PurchasingProbe, null)),
    );
    const facts = Object.fromEntries(
      [...text.matchAll(/([a-z_0-9]+)=([^ ]+)/g)].map((match) => [match[1], match[2]]),
    );

    check(
      "PR contoh tersedia dan menunggu persetujuan",
      facts.pr === "PR-00001" &&
        facts.pr_status_awal === "submitted" &&
        facts.pr_baris === "2",
      text,
    );
    check("PR disetujui lalu berstatus approved", facts.setuju === "ok" && facts.pr_status === "approved", text);
    check(
      "PO dibuat dari PR dengan nomor lanjut dari data contoh (PO-00003)",
      facts.po === "PO-00003" && facts.pr_po === "PO-00003",
      text,
    );
    check(
      "nilai PO = 24×13.200 + 48×4.800 (547.200)",
      facts.po_total === "547200",
      text,
    );
    check(
      "GRN pertama 24 unit masuk lokasi jual (364.800)",
      facts.grn === "GRN-00003" && facts.grn_total === "364800",
      text,
    );
    check(
      "stok lokasi jual naik 60 → 70 dan GRN kedua ke gudang",
      facts.stok_esteh === "70" && facts.grn2 === "GRN-00004",
      text,
    );
    check(
      "stok gudang GD-A naik 240 → 245",
      facts.gudang_esteh === "245",
      text,
    );
    check("harga beli terakhir tersimpan di produk (4.800)", facts.cost_esteh === "4800", text);
    check(
      "PO jadi partial dengan sisa 33 unit",
      facts.po_status === "partial" && facts.po_sisa === "33",
      text,
    );
    check(
      "penerimaan melebihi sisa ditolak dengan angkanya",
      facts.lebih.includes("hanya_tersisa_33"),
      text,
    );
    check("PR berikutnya bernomor lanjut (PR-00002)", facts.pr_baru === "PR-00002", text);
    check(
      "ringkasan pembelian ikut segar (PR baru menunggu = 1, 4 GRN)",
      facts.pending === "1" && facts.grn_count === "4",
      text,
    );
    check("alur pembelian tanpa error lain", facts.error === "-" && facts.error2 === "-", text);
    check(
      "alur pembelian tanpa error konsol",
      newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200),
    );
  }

  // 3e-4f-2. Halaman Pembelian: dokumen contoh terbaca, dan paket tanpa fiturnya
  //          menyebut penyebab yang tepat (bukan menyuruh menyalakan modul).
  {
    withEnterpriseSession();
    const { text, newErrors } = await renderTree(
      providers(React.createElement(PurchasingPage, null)),
    );
    check(
      "halaman Pembelian memuat PR contoh",
      text.includes("PR-00001") && text.includes("Menunggu persetujuan"),
      text.slice(0, 300),
    );
    check(
      "halaman Pembelian menjelaskan alur PR → PO → GRN",
      text.includes("Permintaan pembelian (PR)") &&
        text.includes("Pesanan pembelian (PO)") &&
        text.includes("Penerimaan barang (GRN)"),
      text.slice(0, 400),
    );
    check(
      "halaman Pembelian merender supplier contoh",
      text.includes("PT Sumber Rejeki"),
      text.slice(0, 400),
    );
    check(
      "halaman Pembelian memuat bagian hutang usaha",
      text.includes("Hutang usaha (AP)") &&
        text.includes("Total hutang terbuka") &&
        text.includes("Jatuh tempo ≤ 7 hari") &&
        text.includes("AP-00001"),
      text.slice(0, 500),
    );
    check(
      "tagihan yang lewat jatuh tempo ditandai di daftar supplier",
      text.includes("lewat jatuh tempo"),
      text.slice(0, 500),
    );
    check(
      "halaman Pembelian memuat bagian pencocokan 3 arah beserta antreannya",
      text.includes("Pencocokan 3 arah (PO ↔ GRN ↔ tagihan)") &&
        text.includes("Perlu ditinjau") &&
        text.includes("Menunggu dokumen") &&
        text.includes("Sengketa"),
      text.slice(0, 600),
    );
    check(
      "antrean kerja 3 arah menyebut tagihan yang harus ditinjau lebih dulu",
      text.includes("tagihan perlu ditinjau lebih dulu") &&
        text.includes("Dokumen supplier belum dicatat") &&
        text.includes("Ada selisih"),
      text.slice(0, 800),
    );
    check(
      "tagihan yang dokumennya belum dicatat bisa langsung diisi dari barisnya",
      text.includes("Catat dokumen"),
      text.slice(0, 800),
    );
    check(
      "halaman Pembelian tanpa error konsol",
      newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200),
    );

    withoutSession();
    const starter = await renderTree(
      providers(React.createElement(PurchasingPage, null)),
    );
    check(
      "halaman Pembelian menyebut paket Starter sebagai penyebab",
      starter.text.includes("tidak termasuk paket Starter"),
      starter.text.slice(0, 300),
    );
    check(
      "dokumen pembelian tetap terbaca walau fiturnya mati",
      starter.text.includes("PR-00001") && starter.text.includes("Penerimaan barang (GRN)"),
      starter.text.slice(0, 300),
    );
  }

  // 3e-4g. Hutang usaha (`purchasing.basic`, Phase 3) di store demo: tempo
  //        supplier berubah jadi tagihan berjatuh tempo, pembayaran sebagian,
  //        tagihan manual, dan konsekuensinya — supplier menunggak tidak
  //        dilayani PO baru sampai tagihannya dibayar.
  {
    withEnterpriseSession();

    function PayablesProbe() {
      const store = useStore();
      const step = React.useRef(0);
      const facts = React.useRef({});

      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;

        void (async () => {
          facts.current.awal = store.payables.length;
          facts.current.terbuka = store.payableSummary.outstanding;
          facts.current.lewat = store.payableSummary.overdueAmount;
          facts.current.segera = store.payableSummary.dueSoonAmount;
          facts.current.tempo_lama = String(
            store.payables.find((row) => row.number === "AP-00004")?.paymentTermDays ?? "?",
          );

          const first = store.payables.find((row) => row.number === "AP-00001");

          // 1. Bayar sebagian: sisanya harus ikut turun, bukan hilang.
          try {
            await store.recordPayablePayment({
              payableId: first.id,
              amount: 450_000,
              method: "Transfer",
            });
            facts.current.sebagian = "ok";
          } catch (error) {
            facts.current.sebagian = error.message;
          }

          // 2. Kelebihan bayar ditolak dengan sisa yang benar — bukan dipangkas.
          try {
            await store.recordPayablePayment({
              payableId: first.id,
              amount: 9_999_999,
              method: "Transfer",
            });
            facts.current.lebih = "DITERIMA";
          } catch (error) {
            facts.current.lebih = error.message;
          }

          // 3. Lunasi sisanya.
          try {
            await store.recordPayablePayment({
              payableId: first.id,
              amount: 1_000_000,
              method: "Tunai",
            });
            facts.current.lunas = "ok";
          } catch (error) {
            facts.current.lunas = error.message;
          }

          // 4. Tagihan supplier di luar PO, jatuh temponya sudah lewat.
          try {
            const bill = await store.createBill({
              supplierId: "sup03",
              reference: "LAMA/2026/9",
              amount: 90_000,
              dueDate: Date.now() - 10 * 24 * 60 * 60 * 1000,
            });
            facts.current.tagihan = bill.number;
          } catch (error) {
            facts.current.tagihan_error = error.message;
          }

          // 5. PO ke supplier menunggak (sup02 punya AP-00003 lewat 45 hari).
          let prId = "";
          try {
            const pr = await store.createRequisition({
              lines: [{ productId: "p11", quantity: 5 }],
            });
            prId = pr.id;
            await store.decideRequisition({ requisitionId: pr.id, approve: true });
          } catch (error) {
            facts.current.pr_error = error.message;
          }

          const orderForSup02 = () => ({
            supplierId: "sup02",
            requisitionId: prId,
            lines: [{ productId: "p11", quantity: 5, unitCost: 4_000 }],
          });

          try {
            await store.createOrder(orderForSup02());
            facts.current.po_menunggak = "DITERIMA";
          } catch (error) {
            facts.current.po_menunggak = error.message;
          }

          // 6. Bayar tagihan yang lewat jatuh tempo, lalu PO-nya boleh lagi.
          for (const row of store.payables.filter(
            (entry) => entry.supplierId === "sup02" && entry.overdue,
          )) {
            try {
              await store.recordPayablePayment({
                payableId: row.id,
                amount: row.balance,
                method: "Transfer",
              });
            } catch (error) {
              facts.current.lunas_lewat = error.message;
            }
          }
          try {
            const created = await store.createOrder(orderForSup02());
            facts.current.po_setelah_bayar = created.number;
          } catch (error) {
            facts.current.po_setelah_bayar = error.message;
          }

          // 7. Tempo supplier diubah ke 0 (bayar langsung).
          try {
            await store.updateSupplier({ supplierId: "sup02", paymentTermDays: 0 });
            facts.current.ubah = "ok";
          } catch (error) {
            facts.current.ubah = error.message;
          }
        })();
      }, [store]);

      const first = store.payables.find((row) => row.number === "AP-00001");
      const old = store.payables.find((row) => row.number === "AP-00004");
      const supplier = store.suppliers.find((row) => row.id === "sup02");
      const supplierLama = store.suppliers.find((row) => row.id === "sup03");

      return React.createElement(
        "div",
        null,
        `awal=${facts.current.awal ?? "?"}` +
          ` terbuka=${facts.current.terbuka ?? "?"}` +
          ` lewat=${facts.current.lewat ?? "?"}` +
          ` segera=${facts.current.segera ?? "?"}` +
          ` tempo_lama=${facts.current.tempo_lama ?? "?"}` +
          ` sebagian=${facts.current.sebagian ?? "-"}` +
          ` lebih=${String(facts.current.lebih ?? "-").replace(/\s+/g, "_")}` +
          ` lunas=${facts.current.lunas ?? "-"}` +
          ` sisa_ap1=${first?.balance ?? "?"}` +
          ` status_ap1=${first?.status ?? "?"}` +
          ` tagihan=${facts.current.tagihan ?? "-"}` +
          ` tagihan_lewat=${String(
            store.payables.find((row) => row.reference === "LAMA/2026/9")?.overdue ?? "?",
          )}` +
          ` po_menunggak=${String(facts.current.po_menunggak ?? "-").replace(/\s+/g, "_")}` +
          ` po_setelah_bayar=${String(facts.current.po_setelah_bayar ?? "-").replace(/\s+/g, "_")}` +
          ` ubah=${facts.current.ubah ?? "-"}` +
          ` tempo_sup02=${supplier?.paymentTermDays ?? "?"}` +
          ` tempo_tagihan_lama=${old?.paymentTermDays ?? "?"}` +
          ` hutang_sup03=${supplierLama?.outstanding ?? "?"}` +
          ` status_hutang_sup03=${supplierLama?.overdueCount ?? "?"}` +
          ` terbuka_akhir=${store.payableSummary.outstanding}` +
          ` lewat_akhir=${store.payableSummary.overdueAmount}` +
          ` bayar_count=${store.payablePayments.length}` +
          ` error=${String(facts.current.tagihan_error ?? facts.current.pr_error ?? "-").replace(/\s+/g, "_")}` +
          ` error2=${String(facts.current.lunas_lewat ?? "-").replace(/\s+/g, "_")}`,
      );
    }

    const { text, newErrors } = await renderTree(
      providers(React.createElement(PayablesProbe, null)),
    );
    const facts = Object.fromEntries(
      [...text.matchAll(/([a-z_0-9]+)=([^ ]+)/g)].map((match) => [match[1], match[2]]),
    );

    check(
      "hutang contoh siap: 4 tagihan, 2,425 juta terbuka, 415 ribu lewat jatuh tempo",
      facts.awal === "4" &&
        facts.terbuka === "2425000" &&
        facts.lewat === "415000" &&
        facts.segera === "560000",
      text,
    );
    check(
      "pembayaran sebagian mengurangi sisa dan menambah riwayat",
      facts.sebagian === "ok" && facts.lunas === "ok" && facts.status_ap1 === "paid",
      text,
    );
    check(
      "kelebihan bayar ditolak dengan sisa hutangnya (Rp 1.000.000)",
      facts.lebih.includes("melebihi_sisa_hutang") && facts.lebih.includes("1.000.000"),
      text,
    );
    check("hutang yang dilunasi bersisa 0", facts.sisa_ap1 === "0", text);
    check(
      "tagihan manual lanjut nomornya (AP-00005) dan langsung lewat jatuh tempo",
      facts.tagihan === "AP-00005" && facts.tagihan_lewat === "true",
      text,
    );
    check(
      "PO ke supplier menunggak ditolak dengan jumlah hutangnya",
      facts.po_menunggak.includes("punya_hutang_jatuh_tempo") &&
        facts.po_menunggak.includes("240.000"),
      text,
    );
    check(
      "setelah tagihannya dibayar, PO ke supplier itu boleh lagi (PO-00003)",
      facts.po_setelah_bayar === "PO-00003",
      text,
    );
    check(
      "mengubah tempo supplier tidak menulis ulang tagihan lama (7 hari)",
      facts.ubah === "ok" && facts.tempo_sup02 === "0" && facts.tempo_tagihan_lama === "7",
      text,
    );
    check(
      "posisi hutang supplier ikut segar (sup03: 175.000 lewat jatuh tempo)",
      facts.hutang_sup03 === "265000" && facts.status_hutang_sup03 === "2",
      text,
    );
    check(
      "ringkasan hutang setelah semua aksi = 825.000 terbuka / 265.000 lewat",
      facts.terbuka_akhir === "825000" && facts.lewat_akhir === "265000",
      text,
    );
    check(
      "empat pembayaran tercatat di riwayat (satu contoh + tiga aksi uji)",
      facts.bayar_count === "4",
      text,
    );
    check(
      "alur hutang usaha tanpa error",
      facts.error === "-" && facts.error2 === "-",
      text,
    );
    check(
      "alur hutang usaha tanpa error konsol",
      newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200),
    );
  }

  // 3e-4g-2. Pencocokan 3 arah (`purchasing.threeway`) di store demo: dokumen
  //          supplier dicocokkan dengan PO & penerimaan, selisihnya diputuskan,
  //          dan tagihan bersengketa menahan pembayaran — termasuk di batch.
  {
    withEnterpriseSession();

    function ThreewayProbe() {
      const store = useStore();
      const step = React.useRef(0);
      const facts = React.useRef({});

      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;
        void (async () => {
          const awal = store.payables.find((row) => row.number === "AP-00001");
          const menunggu = store.payables.find((row) => row.number === "AP-00002");

          facts.current.awal_status = awal?.match.status ?? "?";
          facts.current.awal_selisih = awal?.match.valueVariance ?? "?";
          facts.current.awal_unit = awal?.match.qtyVarianceUnits ?? "?";
          facts.current.ringkas_menunggu = store.threewaySummary.waitingInvoice;
          facts.current.ringkas_tinjau = store.threewaySummary.needsReview;
          facts.current.ringkas_cocok = store.threewaySummary.matched;
          facts.current.ringkas_nilai = store.threewaySummary.openVarianceValue;

          // 1. Dokumen supplier yang barisnya diambil dari penerimaan (GRN).
          try {
            const hasil = await store.recordInvoice({
              payableId: menunggu.id,
              reference: "INV/SDR/2026/0042",
              lines: menunggu.match.lines
                .filter((line) => line.receivedQty > 0)
                .map((line) => ({
                  productId: line.productId,
                  quantity: line.receivedQty,
                  unitCost: line.receivedUnitCost,
                })),
            });
            facts.current.catat_total = hasil.total;
            facts.current.catat_flagged = String(hasil.flagged);
          } catch (error) {
            facts.current.catat_error = error.message;
          }

          // 2. Selisih AP-00001 (ditagih 12, diterima 10): sengketa menahan bayar.
          try {
            const hasil = await store.resolvePayableMatch({
              payableId: awal.id,
              kind: "disputed",
              note: "Jumlah kurang 2 unit",
            });
            facts.current.sengketa = hasil.kind ?? "null";
            facts.current.sengketa_amount = hasil.amount;
          } catch (error) {
            facts.current.sengketa_error = error.message;
          }
          try {
            await store.recordPayablePayment({
              payableId: awal.id,
              amount: 10_000,
              method: "Transfer",
            });
            facts.current.bayar_sengketa = "DITERIMA";
          } catch (error) {
            facts.current.bayar_sengketa = error.message;
          }

          // 3. Menerima selisih: nilai hutang ikut total tagihan supplier.
          try {
            const hasil = await store.resolvePayableMatch({
              payableId: awal.id,
              kind: "accepted",
              note: "Disetujui pemilik",
            });
            facts.current.diterima_jenis = hasil.kind ?? "null";
            facts.current.diterima_amount = hasil.amount;
          } catch (error) {
            facts.current.diterima_error = error.message;
          }

          // 4. Bayar dua tagihan sekaligus: satu nomor `PAY-…`, dua baris.
          try {
            const batch = await store.payPayables({
              method: "Transfer",
              payments: [
                { payableId: awal.id, amount: 5_000 },
                { payableId: menunggu.id, amount: 7_000 },
              ],
            });
            facts.current.batch_nomor = batch.batchNumber;
            facts.current.batch_total = batch.total;
            facts.current.batch_bills = batch.bills;
          } catch (error) {
            facts.current.batch_error = error.message;
          }
        })();
      }, [store]);

      const first = store.payables.find((row) => row.number === "AP-00001");
      const second = store.payables.find((row) => row.number === "AP-00002");
      const grup = store.paymentBatches[0];

      return React.createElement(
        "div",
        null,
        `awal_status=${facts.current.awal_status ?? "?"}` +
          ` awal_selisih=${facts.current.awal_selisih ?? "?"}` +
          ` awal_unit=${facts.current.awal_unit ?? "?"}` +
          ` ringkas_menunggu=${facts.current.ringkas_menunggu ?? "?"}` +
          ` ringkas_tinjau=${facts.current.ringkas_tinjau ?? "?"}` +
          ` ringkas_cocok=${facts.current.ringkas_cocok ?? "?"}` +
          ` ringkas_nilai=${facts.current.ringkas_nilai ?? "?"}` +
          ` catat_total=${facts.current.catat_total ?? "-"}` +
          ` catat_flagged=${facts.current.catat_flagged ?? "-"}` +
          ` catat_error=${String(facts.current.catat_error ?? "-").replace(/\s+/g, "_")}` +
          ` sengketa=${facts.current.sengketa ?? "-"}` +
          ` sengketa_amount=${facts.current.sengketa_amount ?? "?"}` +
          ` sengketa_error=${String(facts.current.sengketa_error ?? "-").replace(/\s+/g, "_")}` +
          ` bayar_sengketa=${String(facts.current.bayar_sengketa ?? "-").replace(/\s+/g, "_")}` +
          ` diterima_jenis=${facts.current.diterima_jenis ?? "-"}` +
          ` diterima_amount=${facts.current.diterima_amount ?? "?"}` +
          ` diterima_error=${String(facts.current.diterima_error ?? "-").replace(/\s+/g, "_")}` +
          ` batch_nomor=${facts.current.batch_nomor ?? "-"}` +
          ` batch_total=${facts.current.batch_total ?? "?"}` +
          ` batch_bills=${facts.current.batch_bills ?? "?"}` +
          ` batch_error=${String(facts.current.batch_error ?? "-").replace(/\s+/g, "_")}` +
          ` grup_nomor=${grup?.number ?? "-"}` +
          ` grup_count=${grup?.count ?? "?"}` +
          ` grup_total=${grup?.total ?? "?"}` +
          ` grup_tagihan=${grup?.bills.length ?? "?"}` +
          ` sisa_ap1=${first?.balance ?? "?"}` +
          ` sisa_ap2=${second?.balance ?? "?"}` +
          ` status_ap2=${second?.match.status ?? "?"}` +
          ` akhir_cocok=${store.threewaySummary.matched}` +
          ` akhir_diterima=${store.threewaySummary.accepted}` +
          ` akhir_sengketa=${store.threewaySummary.disputed}` +
          ` akhir_menunggu=${store.threewaySummary.waitingInvoice}` +
          ` akhir_tinjau=${store.threewaySummary.needsReview}` +
          ` akhir_nilai=${store.threewaySummary.openVarianceValue}`,
      );
    }

    const { text, newErrors } = await renderTree(
      providers(React.createElement(ThreewayProbe, null)),
    );
    const facts = Object.fromEntries(
      [...text.matchAll(/([a-z_0-9]+)=([^ ]+)/g)].map((match) => [match[1], match[2]]),
    );

    check(
      "tagihan contoh AP-00001 berstatus selisih (+10.000, 2 unit)",
      facts.awal_status === "variance" &&
        facts.awal_selisih === "10000" &&
        facts.awal_unit === "2",
      text,
    );
    check(
      "ringkasan 3 arah awal: 1 menunggu dokumen, 1 perlu ditinjau, belum ada yang cocok",
      facts.ringkas_menunggu === "1" &&
        facts.ringkas_tinjau === "1" &&
        facts.ringkas_cocok === "0" &&
        facts.ringkas_nilai === "10000",
      text,
    );
    check(
      "dokumen supplier yang diambil dari penerimaan cocok tanpa selisih (860.000)",
      facts.catat_total === "860000" &&
        facts.catat_flagged === "false" &&
        facts.catat_error === "-",
      text,
    );
    check(
      "menyengketakan selisih tidak mengubah nilai hutang (1.450.000)",
      facts.sengketa === "disputed" &&
        facts.sengketa_amount === "1450000" &&
        facts.sengketa_error === "-",
      text,
    );
    check(
      "tagihan bersengketa ditolak dibayar, alasannya ikut dibawa",
      facts.bayar_sengketa.includes("disengketakan") &&
        facts.bayar_sengketa.includes("Jumlah_kurang_2_unit"),
      text,
    );
    check(
      "menerima selisih menyesuaikan hutang ke total tagihan supplier (1.460.000)",
      facts.diterima_jenis === "accepted" &&
        facts.diterima_amount === "1460000" &&
        facts.diterima_error === "-",
      text,
    );
    check(
      "bayar sekaligus: satu nomor lanjut dari data contoh untuk dua tagihan (12.000)",
      facts.batch_nomor === "PAY-00002" &&
        facts.batch_total === "12000" &&
        facts.batch_bills === "2" &&
        facts.batch_error === "-",
      text,
    );
    check(
      "pembayaran batch terbaca sebagai satu grup berisi dua tagihan",
      facts.grup_nomor === "PAY-00002" &&
        facts.grup_count === "2" &&
        facts.grup_total === "12000" &&
        facts.grup_tagihan === "2",
      text,
    );
    check(
      "sisa hutang berkurang per tagihan setelahnya (1.455.000 & 553.000 dari 300.000 yang sudah dibayar)",
      facts.sisa_ap1 === "1455000" && facts.sisa_ap2 === "553000",
      text,
    );
    check(
      "ringkasan 3 arah bersih setelah diputuskan: 1 cocok, 1 diterima, tanpa sengketa",
      facts.status_ap2 === "matched" &&
        facts.akhir_cocok === "1" &&
        facts.akhir_diterima === "1" &&
        facts.akhir_sengketa === "0" &&
        facts.akhir_menunggu === "0" &&
        facts.akhir_tinjau === "0" &&
        facts.akhir_nilai === "0",
      text,
    );
    check(
      "alur 3 arah tanpa error konsol",
      newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200),
    );
  }

  // 3e-4f-3. Paket tanpa `purchasing.basic`: klien menolak lebih dulu dengan
  //          pesan yang sama seperti server untuk PR/PO baru.
  {
    withEnterpriseSession("professional");

    function PurchaseGateProbe() {
      const store = useStore();
      const step = React.useRef(0);
      const facts = React.useRef({});

      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;
        void (async () => {
          try {
            await store.createRequisition({ lines: [{ productId: "p13", quantity: 1 }] });
            facts.current.blokir = "DITERIMA";
          } catch (error) {
            facts.current.blokir = error.message;
          }

          const pr = store.requisitions.find((row) => row.number === "PR-00001");
          try {
            await store.createOrder({
              supplierId: "sup01",
              requisitionId: pr.id,
              lines: [{ productId: "p01", quantity: 24, unitCost: 13_200 }],
            });
            facts.current.blokir_po = "DITERIMA";
          } catch (error) {
            facts.current.blokir_po = error.message;
          }
        })();
      }, [store]);

      return React.createElement(
        "div",
        null,
        `blokir_pr=${String(facts.current.blokir ?? "?").replace(/\s+/g, "_")}` +
          ` blokir_po=${String(facts.current.blokir_po ?? "-").replace(/\s+/g, "_")}` +
          ` pr_count=${store.requisitions.length}` +
          ` po_count=${store.orders.length}`,
      );
    }

    const gate = await renderTree(
      providers(React.createElement(PurchaseGateProbe, null)),
    );
    check(
      "PR & PO baru ditolak paket tanpa fiturnya (tanpa menambah dokumen)",
      gate.text.includes("tidak_termasuk_paket") &&
        gate.text.includes("blokir_po") &&
        gate.text.includes("pr_count=1") &&
        // Data contoh sudah memuat 2 PO sebagai rujukan pencocokan 3 arah.
        gate.text.includes("po_count=2"),
      gate.text,
    );
    withoutSession();
  }

  // 3e-5. Dashboard: total piutang + daftar pelanggan menunggak (hanya untuk
  //       peran yang boleh melihat piutang).
  {
    const { DashboardPage } = await server.ssrLoadModule("/src/pages/DashboardPage.tsx");

    withWholesaleSession();
    const { text, newErrors } = await renderTree(
      providers(React.createElement(DashboardPage, null)),
    );
    check(
      "dashboard menampilkan total piutang B2B",
      text.includes("Piutang B2B") && text.includes("900.000"),
      text.slice(0, 300),
    );
    check(
      "dashboard mendaftar pelanggan menunggak beserta umurnya",
      text.includes("Pelanggan menunggak") &&
        text.includes("Toko Berkah Jaya") &&
        text.includes("1 nota · 1–30 hari") &&
        text.includes("lewat 6 hari"),
      text.slice(0, 400),
    );
    check(
      "dashboard memecah piutang per umur",
      text.includes("1–30 hari") &&
        text.includes("31–60 hari") &&
        text.includes("lebih dari 60 hari"),
      text.slice(0, 400),
    );
    check(
      "dashboard menautkan ke halaman Piutang",
      text.includes("Kelola piutang") && text.includes("Tagih sekarang"),
      text.slice(0, 400),
    );
    check("dashboard piutang tanpa error konsol", newErrors.length === 0, newErrors.join(" | ").slice(0, 200));

    // Hutang usaha (Phase 3): total, tunggakan, dan jatuh tempo terdekat — angka
    // yang sama dengan halaman Pembelian karena dihitung aturan `@/lib/payables`.
    check(
      "dashboard menampilkan total hutang usaha beserta tunggakannya",
      text.includes("Hutang usaha") &&
        text.includes("Rp 2.425.000") &&
        text.includes("Rp 415.000 lewat jatuh tempo") &&
        text.includes("4 tagihan supplier belum lunas"),
      text.slice(0, 500),
    );
    check(
      "dashboard menyebut tagihan yang jatuh tempo dalam 7 hari",
      text.includes("Rp 560.000 jatuh tempo dalam 7 hari ke depan"),
      text.slice(0, 600),
    );
    check(
      "dashboard memecah hutang per umur (240.000 di 31–60, 175.000 di >60)",
      text.includes("Rp 240.000") && text.includes("Rp 175.000"),
      text.slice(0, 800),
    );
    check(
      "dashboard mendaftar jatuh tempo terdekat dengan umurnya",
      text.includes("Jatuh tempo terdekat") &&
        text.includes("Koperasi Bahan Baku") &&
        text.includes("lewat 120 hari") &&
        text.includes("lewat 45 hari") &&
        text.includes("5 hari lagi") &&
        text.includes("20 hari lagi"),
      text.slice(0, 900),
    );
    check(
      "dashboard menautkan ke halaman Pembelian untuk membayar",
      text.includes("Bayar di Pembelian") && text.includes("Catat pembayaran"),
      text.slice(0, 900),
    );
    check(
      "dashboard menampilkan riwayat pembayaran batch beserta tagihannya",
      text.includes("Pembayaran supplier terakhir") &&
        text.includes("PAY-00001") &&
        text.includes("Transfer") &&
        text.includes("1 tagihan") &&
        text.includes("AP-00002") &&
        text.includes("Rp 300.000"),
      text.slice(0, 1200),
    );
    check(
      "riwayat pembayaran batch menautkan ke halaman Pembelian",
      text.includes("Lihat semua pembayaran"),
      text.slice(0, 1200),
    );
    check(
      "dashboard hutang usaha tanpa error konsol",
      newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200),
    );

    // Gudang tidak punya izin `ar.view`: bagian piutang harus hilang, bukan
    // menampilkan "Rp 0" yang menyesatkan.
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        ...WS_SESSION,
        tenant: { ...WS_SESSION.tenant, role: "inventory" },
      }),
    );
    const gudang = await renderTree(providers(React.createElement(DashboardPage, null)));
    check(
      "dashboard menyembunyikan piutang & hutang dari peran tanpa izinnya",
      !gudang.text.includes("Pelanggan menunggak") &&
        !gudang.text.includes("Piutang B2B") &&
        !gudang.text.includes("Hutang usaha") &&
        !gudang.text.includes("Jatuh tempo terdekat") &&
        gudang.text.includes("Stok kritis"),
      gudang.text.slice(0, 300),
    );
    withoutSession();
  }

  // 3e-5b. Warna empat kartu ringkasan dashboard.
  //
  //        Yang diminta adalah kartu yang "menarik perhatian", dan itu hanya
  //        berguna kalau **tiap** kartu bisa dibedakan tanpa membaca labelnya.
  //        Karena itu yang diperiksa bukan "ada kata emerald di suatu tempat",
  //        melainkan per kartu: nadanya berbeda satu sama lain, dan kartu stok
  //        menyalakan nada bahaya **hanya** saat memang ada barang menipis.
  {
    const { DashboardPage: Dashboard } = await server.ssrLoadModule(
      "/src/pages/DashboardPage.tsx",
    );
    const { StoreContext, useStore } = await server.ssrLoadModule(
      "/src/lib/store/context.ts",
    );
    const HUE = /(emerald|sky|violet|amber|rose)/;

    withWholesaleSession();

    let captured = null;
    const Capturing = () => {
      captured = useStore();
      return null;
    };
    await renderTree(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Dashboard, null),
          React.createElement(Capturing, null),
        ),
      ),
    );
    check(
      "store demo bisa dibaca sebagai sumber nilai untuk uji warna kartu",
      Boolean(captured && Array.isArray(captured.products)),
      String(captured?.products?.length),
    );

    /** Nada warna yang benar-benar dilekatkan ke kartu `data-summary` itu. */
    const toneOf = (view, key) => {
      const card = view.query(`[data-summary="${key}"]`);
      if (!card) return "tidak ada";
      return (card.getAttribute("class") ?? "").match(HUE)?.[1] ?? "tanpa warna";
    };

    const view = await renderInteractive(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/app"] },
        React.createElement(
          SessionProvider,
          null,
          React.createElement(
            StoreContext.Provider,
            { value: captured },
            React.createElement(Dashboard, null),
          ),
        ),
      ),
    );

    const nada = ["omzet", "transaksi", "item", "stok"].map((key) => toneOf(view, key));
    check(
      "empat kartu ringkasan dashboard ada semuanya",
      nada.every((tone) => tone !== "tidak ada"),
      JSON.stringify(nada),
    );
    check(
      "tiap kartu ringkasan punya nada warnanya sendiri (tidak ada yang kembar)",
      new Set(nada).size === 4 && nada.every((tone) => tone !== "tanpa warna"),
      JSON.stringify(nada),
    );
    check(
      "omzet hijau, transaksi biru, item terjual ungu",
      nada[0] === "emerald" && nada[1] === "sky" && nada[2] === "violet",
      JSON.stringify(nada),
    );
    check(
      "stok kritis menyala bahaya saat memang ada barang menipis",
      nada[3] === "rose" &&
        view.query('[data-summary="stok"] .animate-ping') !== null,
      `${nada[3]} | denyut=${Boolean(view.query('[data-summary="stok"] .animate-ping'))}`,
    );
    check(
      "kartu berwarna tetap menampilkan label dan angkanya",
      view.text().includes("Omzet") &&
        view.text().includes("Transaksi") &&
        view.text().includes("Item terjual") &&
        view.text().includes("Stok kritis"),
      view.text().slice(0, 240),
    );
    check(
      "kartu ringkasan berwarna tanpa error konsol",
      view.newErrors().length === 0,
      view.newErrors().join(" | ").slice(0, 200),
    );
    await view.unmount();

    // Tanpa satu pun barang menipis, kartu stok kembali tenang: nada peringatan
    // yang menyala terus-menerus lama-lama tidak dibaca lagi.
    const aman = await renderInteractive(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/app"] },
        React.createElement(
          SessionProvider,
          null,
          React.createElement(
            StoreContext.Provider,
            {
              value: {
                ...captured,
                products: captured.products.map((product) => ({ ...product, stock: 99 })),
              },
            },
            React.createElement(Dashboard, null),
          ),
        ),
      ),
    );
    check(
      "kartu stok tenang (tanpa denyut) saat tidak ada barang menipis",
      toneOf(aman, "stok") === "amber" &&
        aman.query('[data-summary="stok"] .animate-ping') === null &&
        aman.text().includes("0 item"),
      `nada=${toneOf(aman, "stok")} teks=${aman.text().slice(0, 160)}`,
    );
    check(
      "kartu stok tenang tetap tanpa error konsol",
      aman.newErrors().length === 0,
      aman.newErrors().join(" | ").slice(0, 200),
    );
    await aman.unmount();
    withoutSession();
  }

  // 3e-6. Analitik lanjutan (`report.advanced`, Phase 4) di halaman Laporan:
  //       Enterprise melihat laporan lengkapnya, paket lain melihat alasannya.
  {
    const { ReportsPage } = await server.ssrLoadModule("/src/pages/ReportsPage.tsx");

    withEnterpriseSession();
    const { text, newErrors } = await renderTree(
      providers(React.createElement(ReportsPage, null)),
    );
    check(
      "halaman Laporan memuat bagian analitik lanjutan",
      text.includes("Analitik lanjutan (Enterprise)") &&
        text.includes("Tren omzet harian") &&
        text.includes("Produk teratas") &&
        text.includes("Per kategori") &&
        text.includes("Jam tersibuk") &&
        text.includes("Pola hari") &&
        text.includes("Temuan"),
      text.slice(0, 600),
    );
    check(
      "analitik menampilkan KPI dengan pembanding periode sebelumnya",
      text.includes("Omzet bersih") &&
        text.includes("Rata-rata keranjang") &&
        text.includes("Margin kotor") &&
        text.includes("vs periode sebelumnya"),
      text.slice(0, 800),
    );
    check(
      "pemilih periode analitik tersedia (7 / 30 / 90 hari)",
      text.includes("7 hari") && text.includes("30 hari") && text.includes("90 hari") &&
        text.includes("30 hari terakhir"),
      text.slice(0, 600),
    );
    // Bagian enterprise dari analitik (`report.advanced`): proyeksi akhir periode
    // & analisis keranjang. Yang diperiksa bukan cuma judulnya — proyeksinya harus
    // menyebut laju hari penuh, dan keranjangnya harus mencetak pasangan produk
    // beserta pangsa & kebiasaan berulangnya.
    check(
      "analitik enterprise: proyeksi akhir periode tampil dengan lajunya",
      text.includes("Proyeksi akhir periode") &&
        /Laju Rp\s?[\d.]+\/hari dari \d+ hari penuh/.test(text) &&
        text.includes("hari penuh ini vs"),
      JSON.stringify({
        proyeksi: text.indexOf("Proyeksi akhir periode"),
        laju: /Laju Rp\s?[\d.]+[^.]*/.exec(text)?.[0] ?? null,
        hariPenuh: text.includes("hari penuh ini vs"),
        cuplikan: text.slice(
          Math.max(0, text.indexOf("Proyeksi akhir periode") - 40),
          text.indexOf("Proyeksi akhir periode") + 420,
        ),
      }),
    );
    check(
      "analitik enterprise: keranjang & pasangan produk yang sering dibeli bersama",
      text.includes("Keranjang & pasangan produk") &&
        /Rata-rata [\d.,]+ barang per nota/.test(text) &&
        text.includes("Sering dibeli bersama") &&
        text.includes("Lift (×)") &&
        /di atas 1 berarti saling menarik/.test(text),
      text.slice(
        Math.max(0, text.indexOf("Keranjang & pasangan produk") - 40),
        text.indexOf("Keranjang & pasangan produk") + 700,
      ),
    );
    check(
      "halaman Laporan tanpa error konsol",
      newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200),
    );

    // Skala franchise (`scale.franchise`, Phase 5): laporan lintas cabang yang
    // dibaca dengan anggaran per cabang. Yang diperiksa bukan cuma judulnya:
    // cabang contoh harus terdaftar, pangsa harus tampil, dan anggaran query-nya
    // harus disebut apa adanya — termasuk cabang nonaktif yang tidak diagregasi.
    check(
      "halaman Laporan memuat bagian skala franchise (lintas cabang)",
      text.includes("Skala franchise") &&
        text.includes("Cabang Sudirman") &&
        text.includes("Cabang Kemang") &&
        text.includes("Pangsa") &&
        text.includes("Transaksi terbesar jaringan"),
      text.slice(0, 800),
    );
    check(
      "laporan lintas cabang menjelaskan anggaran query per cabang",
      text.includes("anggaran per cabang") &&
        text.includes("dokumen maksimum per laporan"),
      text.slice(0, 400),
    );
    check(
      "cabang nonaktif dihitung tanpa ikut diagregasi",
      text.includes("3 aktif") &&
        text.includes("1 nonaktif") &&
        !text.includes("Cabang Lama (tutup)"),
      text.slice(0, 800),
    );
    check(
      "cabang diurutkan menurut omzet menurun di halaman",
      (() => {
        const order = ["Cabang Sudirman", "Cabang Kemang", "Cabang Bandung"].map((name) =>
          text.indexOf(name),
        );
        return order.every((index) => index >= 0) && order[0] < order[1] && order[1] < order[2];
      })(),
      text.slice(0, 800),
    );

    withoutSession();
    const starter = await renderTree(
      providers(React.createElement(ReportsPage, null)),
    );
    check(
      "paket Starter melihat alasan analitik lanjutan tidak hidup",
      starter.text.includes("Analitik lanjutan (Enterprise)") &&
        starter.text.includes("tidak termasuk paket Starter") &&
        !starter.text.includes("Tren omzet harian"),
      starter.text.slice(0, 400),
    );
    check(
      "paket Starter melihat alasan laporan lintas cabang tidak hidup",
      starter.text.includes("Skala franchise") &&
        starter.text.includes("tidak termasuk paket Starter") &&
        !starter.text.includes("Cabang Sudirman"),
      starter.text.slice(0, 400),
    );
    check(
      "laporan harian tetap terbaca walau analitik lanjutannya mati",
      starter.text.includes("Omzet per metode bayar") && starter.text.includes("Total omzet"),
      starter.text.slice(0, 300),
    );
    check(
      "paket Starter juga tidak melihat proyeksi & keranjang (satu gerbang, bukan dua)",
      !starter.text.includes("Proyeksi akhir periode") &&
        !starter.text.includes("Keranjang & pasangan produk"),
      starter.text.slice(0, 400),
    );
  }

  // 3e-6b. Analitik lanjutan di store demo: laporan dihitung dari riwayat nyata
  //        dan ikut berubah saat kasir menjual.
  {
    withEnterpriseSession();

    function AnalyticsProbe() {
      const store = useStore();
      const step = React.useRef(0);
      const facts = React.useRef({});

      // Tiga tahap, karena angka yang diperiksa memang berubah antar-render:
      // (0) keadaan awal 30 hari, (1) setelah satu penjualan baru, (2) setelah
      // periode diganti ke 7 hari — semua dibaca dari store yang sama.
      React.useEffect(() => {
        if (step.current === 0) {
          step.current = 1;
          const before = store.analyticsReport;
          facts.current.tren = before.trend.length;
          facts.current.jam = before.busyHours.length;
          facts.current.hari = before.weekday.length;
          facts.current.transaksi = before.totals.transactions;
          facts.current.item = before.totals.itemCount;
          facts.current.omzet = before.totals.netRevenue;
          facts.current.margin = before.margin.marginPct;
          facts.current.arah = before.comparison.revenueDeltaPct;
          facts.current.produk = before.topProducts.length;
          facts.current.kategori = before.byCategory.length;
          facts.current.temuan = before.insights.length;
          facts.current.tak_berhpp = before.margin.uncostedRevenue;
          facts.current.puncak = before.trend.reduce(
            (max, point) => (point.revenue > max ? point.revenue : max),
            0,
          );

          // Penjualan baru harus ikut menambah laporan periode ini.
          void (async () => {
            try {
              await store.createSale({
                items: [{ productId: "p01", quantity: 2 }],
                discount: 0,
                method: "Tunai",
              });
              facts.current.jual = "ok";
            } catch (error) {
              facts.current.jual = error.message;
            }
          })();
          return;
        }

        if (step.current === 1 && facts.current.jual !== undefined) {
          step.current = 2;
          const afterSale = store.analyticsReport;
          facts.current.pasca_transaksi = afterSale.totals.transactions;
          facts.current.pasca_omzet = afterSale.totals.netRevenue;
          facts.current.pasca_item = afterSale.totals.itemCount;
          facts.current.pasca_tren = afterSale.trend.length;

          try {
            store.setAnalyticsDays(7);
            facts.current.tren7 = "dipanggil";
          } catch (error) {
            facts.current.tren7 = error.message;
          }
        }
      }, [store]);

      const after = store.analyticsReport;
      return React.createElement(
        "div",
        null,
        `tren=${facts.current.tren ?? "?"}` +
          ` jam=${facts.current.jam ?? "?"}` +
          ` hari=${facts.current.hari ?? "?"}` +
          ` transaksi=${facts.current.transaksi ?? "?"}` +
          ` item=${facts.current.item ?? "?"}` +
          ` omzet=${facts.current.omzet ?? "?"}` +
          ` margin=${facts.current.margin ?? "?"}` +
          ` arah=${facts.current.arah ?? "?"}` +
          ` produk=${facts.current.produk ?? "?"}` +
          ` kategori=${facts.current.kategori ?? "?"}` +
          ` temuan=${facts.current.temuan ?? "?"}` +
          ` tak_berhpp=${facts.current.tak_berhpp ?? "?"}` +
          ` puncak=${facts.current.puncak ?? "?"}` +
          ` jual=${String(facts.current.jual ?? "-").replace(/\s+/g, "_")}` +
          ` tren7=${facts.current.tren7 ?? "-"}` +
          ` akhir_tren=${after.trend.length}` +
          ` periode=${store.analyticsDays}` +
          ` akhir_transaksi=${after.totals.transactions}` +
          ` akhir_omzet=${after.totals.netRevenue}` +
          ` akhir_item=${after.totals.itemCount}` +
          ` pasca_transaksi=${facts.current.pasca_transaksi ?? "?"}` +
          ` pasca_omzet=${facts.current.pasca_omzet ?? "?"}` +
          ` pasca_item=${facts.current.pasca_item ?? "?"}` +
          ` pasca_tren=${facts.current.pasca_tren ?? "?"}` +
          ` total_titik=${after.trend.reduce((sum, point) => sum + point.transactions, 0)}`,
      );
    }

    const { text, newErrors } = await renderTree(
      providers(React.createElement(AnalyticsProbe, null)),
    );
    const facts = Object.fromEntries(
      [...text.matchAll(/([a-z_0-9]+)=([^ ]+)/g)].map((match) => [match[1], match[2]]),
    );

    check(
      "laporan contoh terisi dari riwayat penjualan 30 hari",
      facts.tren === "30" &&
        Number(facts.transaksi) > 50 &&
        Number(facts.omzet) > 0 &&
        Number(facts.item) >= Number(facts.transaksi),
      text,
    );
    check(
      "jam, hari, produk, dan kategori terisi lengkap",
      facts.jam === "24" &&
        facts.hari === "7" &&
        Number(facts.produk) > 1 &&
        Number(facts.kategori) > 1 &&
        Number(facts.temuan) > 0,
      text,
    );
    check(
      "margin kotor contoh masuk akal (harga jual 60% di atas harga beli)",
      Number(facts.margin) >= 30 && Number(facts.margin) <= 45,
      text,
    );
    check(
      "periode ini dibandingkan dengan periode sebelumnya yang nyata",
      Number(facts.arah) > 0 && Number(facts.puncak) > 0,
      text,
    );
    check(
      "penjualan baru ikut masuk laporan (transaksi, omzet, item bertambah)",
      facts.jual === "ok" &&
        Number(facts.pasca_transaksi) === Number(facts.transaksi) + 1 &&
        Number(facts.pasca_omzet) > Number(facts.omzet) &&
        Number(facts.pasca_item) === Number(facts.item) + 2 &&
        facts.pasca_tren === "30",
      text,
    );
    check(
      "periode laporan bisa diganti ke 7 hari dan trennya ikut memendek",
      facts.tren7 === "dipanggil" &&
        facts.periode === "7" &&
        facts.akhir_tren === "7" &&
        Number(facts.akhir_transaksi) > 0 &&
        Number(facts.akhir_transaksi) < Number(facts.pasca_transaksi),
      text,
    );
    check(
      "jumlah transaksi di tren sama dengan jumlah transaksi laporan",
      Number(facts.total_titik) === Number(facts.akhir_transaksi),
      text,
    );
    check(
      "store demo tanpa harga beli tidak ada, jadi margin bisa dipercaya",
      facts.tak_berhpp === "0",
      text,
    );
    check(
      "alur analitik tanpa error konsol",
      newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200),
    );
  }

  // 3e-6c. Laporan pajak & pungutan F&B per bulan di halaman Laporan: angkanya
  //        dibaca dari struk tiap bulan (PPN ≠ PBJT ≠ biaya layanan), kewajiban
  //        pengusaha dihitung per bulan, dan satu penjualan baru dengan PBJT
  //        langsung masuk ke baris bulan berjalan.
  {
    const {
      fnbCurrentMonthSummary,
      fnbTaxMonthReport,
      fnbTaxReportTotals,
    } = await server.ssrLoadModule("/src/convex/lib/fnbTax.ts");
    const { ReportsPage } = await server.ssrLoadModule("/src/pages/ReportsPage.tsx");
    const { useStore } = await server.ssrLoadModule("/src/lib/store/context.ts");

    // PBJT 10% + biaya layanan 5% + PPh sewa Rp 10 juta/bulan: pajak pelanggan
    // dibaca dari struknya, sedangkan kewajiban pengusaha dihitung tiap bulan.
    const PROFILE_LAPORAN = {
      regionalActive: true,
      regionalRatePct: 10,
      serviceChargeActive: true,
      serviceChargePct: 5,
      umkmFinalActive: true,
      umkmEntityType: "perorangan",
      umkmStartYear: 2024,
      rentTaxActive: true,
      rentMonthlyIdr: 10_000_000,
      rentRatePct: 10,
    };
    const FNB_LAPORAN_SESSION = {
      user: { name: "Uji Laporan F&B", email: "laporan-fnb@mesinpos.test" },
      tenant: {
        name: "Kafe Laporan",
        slug: "kafe-laporan-fnb",
        storeName: "Pusat",
        vertical: "fnb",
        verticals: ["fnb"],
        planKey: "professional",
        role: "owner",
        taxActive: true,
        taxRatePct: 12,
        fnbTaxProfile: PROFILE_LAPORAN,
        createdAt: new Date().toISOString(),
        trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
      },
    };
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify(FNB_LAPORAN_SESSION),
    );

    function FnbTaxProbe() {
      const store = useStore();
      const step = React.useRef(0);
      const facts = React.useRef({});
      // Penjualan diselesaikan di luar siklus render, jadi setelahnya perlu satu
      // render lagi untuk membaca store yang **sudah** memuat penjualan itu.
      const [tick, setTick] = React.useState(0);

      React.useEffect(() => {
        const rows = store.fnbTaxMonths;
        const bulanTerakhir = rows[rows.length - 1];

        if (step.current === 0) {
          step.current = 1;
          const reports = rows.map((row) =>
            fnbTaxMonthReport({ row, profile: store.fnbTax, ppn: store.tax }),
          );
          const totals = fnbTaxReportTotals(rows);
          const ringkasSendiri = fnbCurrentMonthSummary(rows);

          facts.current.bulan = rows.length;
          facts.current.urut = rows.every(
            (row, index) => index === 0 || rows[index - 1].from < row.from,
          )
            ? "naik"
            : "kacau";
          facts.current.bulan_berjalan = bulanTerakhir?.monthGrossIdr ?? -1;
          facts.current.transaksi_berjalan = bulanTerakhir?.recordedSales ?? -1;
          facts.current.ppn = totals.ppnTaxIdr;
          facts.current.pbjt_awal = totals.regionalTaxIdr;
          facts.current.layanan_awal = totals.serviceChargeIdr;
          // 12 bulan × PPh 4 ayat (2) 10% dari sewa Rp 10 juta.
          facts.current.kewajiban = reports.reduce(
            (sum, month) => sum + month.ownerObligationsIdr,
            0,
          );
          facts.current.ringkas_omzet =
            store.fnbTaxMonth.monthGrossIdr === ringkasSendiri.monthGrossIdr &&
            store.fnbTaxMonth.beforeMonthGrossIdr === ringkasSendiri.beforeMonthGrossIdr &&
            store.fnbTaxMonth.recordedSales === ringkasSendiri.recordedSales &&
            store.fnbTaxMonth.year === ringkasSendiri.year
              ? "sama"
              : "beda";

          // Penjualan baru dengan PBJT & biaya layanan harus masuk baris bulan itu.
          void (async () => {
            try {
              await store.createSale({
                items: [{ productId: "p01", quantity: 1 }],
                discount: 0,
                method: "Tunai",
              });
              facts.current.jual = "ok";
            } catch (error) {
              facts.current.jual = error.message;
            }
            setTick((value) => value + 1);
          })();
          return;
        }

        if (step.current === 1) {
          step.current = 2;
          const terakhir = store.sales[0];
          const setelah = store.fnbTaxMonths[store.fnbTaxMonths.length - 1];
          facts.current.struk_pajak = terakhir?.tax ?? -1;
          facts.current.struk_layanan = terakhir?.serviceCharge ?? -1;
          facts.current.struk_total = terakhir?.total ?? -1;
          facts.current.pbjt_pasca = setelah?.regionalTaxIdr ?? -1;
          facts.current.layanan_pasca = setelah?.serviceChargeIdr ?? -1;
          facts.current.omzet_pasca = setelah?.monthGrossIdr ?? -1;
          facts.current.transaksi_pasca = setelah?.recordedSales ?? -1;
        }
      }, [store, tick]);

      const { ppnTaxIdr: ppnSekarang } = fnbTaxReportTotals(store.fnbTaxMonths);

      return React.createElement(
        "div",
        null,
        Object.entries(facts.current)
          .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, "_")}`)
          .join(" ") + ` ppn_pasca=${ppnSekarang}`,
      );
    }

    const { text, newErrors } = await renderTree(
      providers(React.createElement(FnbTaxProbe, null)),
    );
    const fakta = Object.fromEntries(
      [...text.matchAll(/([a-z_0-9]+)=([^ ]+)/g)].map((match) => [match[1], match[2]]),
    );

    check(
      "laporan pajak F&B berisi 12 bulan berurutan (tertua dulu)",
      fakta.bulan === "12" && fakta.urut === "naik" && Number(fakta.bulan_berjalan) >= 0,
      text,
    );
    check(
      "ringkasan bulan berjalan di store sama dengan turunan dari tabel laporan",
      fakta.ringkas_omzet === "sama",
      text,
    );
    check(
      "PPN dari penjualan contoh terjumlah, PBJT & biaya layanan belum ada",
      Number(fakta.ppn) > 0 && fakta.pbjt_awal === "0" && fakta.layanan_awal === "0",
      text,
    );
    check(
      "kewajiban pengusaha dihitung untuk tiap bulan (12 × Rp 1.000.000)",
      fakta.kewajiban === String(12 * 1_000_000),
      text,
    );
    check(
      "penjualan baru masuk baris bulan berjalan: omzet, PBJT, biaya layanan, transaksi",
      fakta.jual === "ok" &&
        Number(fakta.struk_pajak) > 0 &&
        Number(fakta.pbjt_pasca) === Number(fakta.pbjt_awal) + Number(fakta.struk_pajak) &&
        Number(fakta.layanan_pasca) ===
          Number(fakta.layanan_awal) + Number(fakta.struk_layanan) &&
        Number(fakta.omzet_pasca) === Number(fakta.bulan_berjalan) + Number(fakta.struk_total) &&
        Number(fakta.transaksi_pasca) === Number(fakta.transaksi_berjalan) + 1,
      text,
    );
    check(
      "PPN yang sudah dipungut tidak ikut berubah oleh penjualan ber-PBJT",
      fakta.ppn_pasca === fakta.ppn,
      text,
    );
    check(
      "alur laporan pajak F&B tanpa error konsol",
      newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200),
    );

    // Tampilannya: kartu laporan benar-benar ada di halaman, dengan 12 baris
    // bulan, kolomnya lengkap, dan kalimat “perkiraan” tidak hilang.
    const laporan = await renderInteractive(
      providers(React.createElement(ReportsPage, null)),
    );
    const teksLaporan = laporan.text();
    const bulanSekarang = new Date();
    const NAMA_BULAN = [
      "Januari",
      "Februari",
      "Maret",
      "April",
      "Mei",
      "Juni",
      "Juli",
      "Agustus",
      "September",
      "Oktober",
      "November",
      "Desember",
    ];

    check(
      "halaman Laporan memuat kartu pajak & pungutan F&B per bulan",
      teksLaporan.includes("Pajak & pungutan F&B per bulan") &&
        teksLaporan.includes("Omzet tercatat") &&
        teksLaporan.includes("PBJT") &&
        teksLaporan.includes("Biaya layanan — bukan pajak") &&
        teksLaporan.includes("PPh final UMKM") &&
        teksLaporan.includes("PPh sewa") &&
        teksLaporan.includes("Setoran pengusaha") &&
        teksLaporan.includes("Jumlah"),
      teksLaporan.slice(0, 700),
    );
    check(
      "tabelnya punya satu baris untuk tiap bulan, termasuk bulan berjalan",
      laporan.queryAll('[data-testid^="fnb-tax-month-"]').length === 12 &&
        Boolean(
          laporan.query(
            `[data-testid="fnb-tax-month-${bulanSekarang.getFullYear()}-${bulanSekarang.getMonth()}"]`,
          ),
        ) &&
        teksLaporan.includes(
          `${NAMA_BULAN[bulanSekarang.getMonth()]} ${bulanSekarang.getFullYear()}`,
        ),
      teksLaporan.slice(0, 700),
    );
    check(
      "catatan menyebut PPN lewat jalur pusat, bukan kas daerah",
      teksLaporan.includes("bukan kas daerah"),
      teksLaporan.slice(0, 900),
    );
    check(
      "angka di halaman disebut perkiraan, bukan perhitungan pajak resmi",
      teksLaporan.includes("perkiraan dari data aplikasi") &&
        teksLaporan.includes("bukan perhitungan pajak resmi"),
      teksLaporan.slice(-600),
    );
    check(
      "halaman Laporan dengan laporan F&B tanpa error konsol",
      laporan.newErrors().length === 0,
      laporan.newErrors().join(" | ").slice(0, 200),
    );
    await laporan.unmount();
    withoutSession();
  }

  // 3e-6d. Unduhan laporan dari halaman Laporan — PDF, Excel (.xlsx), dan CSV.
  //        Harness murni (`verify-laporan.mjs`) menjaga byte berkasnya dan
  //        peramban sungguhan (`verify-laporan-browser.mjs`) membuktikan unduhannya
  //        benar-benar terjadi. Yang belum dijaga keduanya: tombolnya benar-benar
  //        menyerahkan **dokumen laporan** (bukan berkas kosong) ke peramban, dan
  //        hasilnya diberitahukan ke pengguna. Itu yang diperiksa di sini — tanpa
  //        peramban sungguhan, cukup dengan mengamati berkas yang lewat.
  {
    const { ReportsPage } = await server.ssrLoadModule("/src/pages/ReportsPage.tsx");
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        user: { name: "Uji Unduh Laporan", email: "unduh-laporan@mesinpos.test" },
        tenant: {
          name: "Pusat Bahan Bangunan",
          slug: "pusat-bahan-bangunan",
          storeName: "Pusat",
          vertical: "umkm",
          verticals: ["umkm", "fnb", "wholesale"],
          planKey: "enterprise",
          role: "owner",
          shift: { active: false, reminderHour: 21, longShiftHours: 14 },
          createdAt: new Date().toISOString(),
          trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
        },
      }),
    );

    /*
      Berkas yang “diunduh” ditangkap di `URL.createObjectURL`: happy-dom tidak
      menulis apa pun ke folder unduhan, jadi yang diamati adalah berkas yang
      diserahkan halaman ke peramban — lengkap dengan ukuran, jenis, dan isinya.

      Dua hal harus dipasang lebih dulu: `Blob` milik happy-dom (Blob milik Bun
      ditolak oleh `URL.createObjectURL` — “expects a Blob object”, sehingga tanpa
      ini halamannya seolah-olah gagal menyusun berkas), dan `createObjectURL`-nya
      sendiri, yang di sini mencatat berkasnya lalu mengembalikan alamat palsu.
    */
    const asliBlob = globalThis.Blob;
    const asliCreate = URL.createObjectURL;
    const asliRevoke = URL.revokeObjectURL;
    const unduhan = [];
    globalThis.Blob = window.Blob;
    URL.createObjectURL = (blob) => {
      unduhan.push({ blob, type: blob.type, size: blob.size });
      return `blob:mesinpos-uji/${unduhan.length}`;
    };
    URL.revokeObjectURL = () => {};

    try {
      const halaman = await renderInteractive(
        providers(React.createElement(ReportsPage, null)),
      );
      check(
        "halaman Laporan menawarkan unduhan PDF, Excel, dan CSV",
        Boolean(halaman.query('[data-testid="laporan-unduh"]')) &&
          Boolean(halaman.query('[data-testid="laporan-unduh-pdf"]')) &&
          Boolean(halaman.query('[data-testid="laporan-unduh-excel"]')) &&
          Boolean(halaman.query('[data-testid="laporan-unduh-csv"]')),
        halaman.text().slice(0, 300),
      );

      const KASUS = [
        {
          testid: "laporan-unduh-pdf",
          ext: "pdf",
          mime: "application/pdf",
          periksa: async (blob) =>
            new TextDecoder().decode(
              new Uint8Array(await blob.arrayBuffer()).subarray(0, 5),
            ) === "%PDF-",
        },
        {
          testid: "laporan-unduh-excel",
          ext: "xlsx",
          mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          periksa: async (blob) => {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
          },
        },
        {
          testid: "laporan-unduh-csv",
          ext: "csv",
          mime: "text/csv;charset=utf-8",
          periksa: async (blob) => {
            const teks = await blob.text();
            return teks.startsWith("\uFEFF") && teks.includes("Metode bayar");
          },
        },
      ];

      /** Berkas yang lewat per tombol: dipakai lagi untuk memeriksa isinya. */
      const berkasTersimpan = {};

      for (const kasus of KASUS) {
        unduhan.length = 0;
        await halaman.clickOn(`[data-testid="${kasus.testid}"]`);
        check(
          `tombol ${kasus.ext}: tepat satu berkas diserahkan ke peramban`, 
          unduhan.length === 1,
          `${unduhan.length} berkas`,
        );
        const berkas = unduhan[0];
        berkasTersimpan[kasus.ext] = berkas.blob;
        check(
          `tombol ${kasus.ext}: ukurannya wajar (bukan berkas kosong)`,
          berkas.size > 200,
          `${berkas.size} byte`,
        );
        check(
          `tombol ${kasus.ext}: jenis berkasnya sesuai`, 
          berkas.type === kasus.mime,
          berkas.type,
        );
        check(
          `tombol ${kasus.ext}: isinya benar-benar berkas laporan`, 
          await kasus.periksa(berkas.blob),
          "tanda awal berkas tidak sesuai",
        );
        const pesan = halaman.query('[data-testid="laporan-unduh-hasil"]');
        check(
          `tombol ${kasus.ext}: pengguna diberi tahu nama berkas yang disimpan`,
          new RegExp(`laporan-[a-z0-9-]+-\\d{8}-\\d{4}\\.${kasus.ext}`).test(
            pesan?.textContent ?? "",
          ) && /disimpan di perangkat ini/.test(pesan?.textContent ?? ""),
          pesan?.textContent ?? "(pesan tidak ada)",
        );
      }

      /*
        Daftar “Berkas yang sudah diunduh”: yang diperiksa bukan hanya barisnya ada,
        melainkan bahwa jenis, nama, ukuran, dan **tanggal unduhnya** benar-benar
        terbaca — itu yang diminta pemilik toko.
      */
      const barisUnduhan = halaman.queryAll('[data-testid="laporan-unduhan-baris"]');
      const jenis = barisUnduhan.map((row) => row.getAttribute("data-jenis"));
      check(
        "daftar unduhan berisi tiga baris (PDF, Excel, CSV) dengan jenisnya",
        barisUnduhan.length === 3 &&
          ["pdf", "xlsx", "csv"].every((kind) => jenis.includes(kind)),
        jenis.join(","),
      );
      check(
        "daftar unduhan menampilkan nama berkas, ukuran, dan tanggal unduhnya",
        barisUnduhan.every((row) => {
          const teks = (row.textContent ?? "").replace(/\s+/g, " ");
          const waktu = row.getAttribute("data-waktu") ?? "";
          return (
            /laporan-[a-z0-9-]+-\d{8}-\d{4}\.(pdf|xlsx|csv)/.test(teks) &&
            /\d+([,.]\d+)? KB/.test(teks) &&
            /^\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$/.test(waktu) &&
            teks.includes(waktu)
          );
        }),
        barisUnduhan.map((row) => row.textContent).join(" || ").slice(0, 300),
      );
      check(
        "daftar unduhan urut dari yang terbaru (CSV paling atas)",
        jenis[0] === "csv",
        jenis.join(","),
      );
      check(
        "daftar unduhan menyediakan tautan unduh ulang ke berkasnya",
        barisUnduhan.every(
          (row) => row.querySelector('a[download]')?.getAttribute("href") !== null,
        ),
        "ada baris tanpa tautan unduh ulang",
      );

      /* Grafiknya harus ikut ke dalam berkas, bukan cuma tampil di halaman. */
      const adaTeks = (blob, teks) =>
        blob.arrayBuffer().then((buffer) => {
          const bytes = new Uint8Array(buffer);
          const pola = new TextEncoder().encode(teks);
          for (let index = 0; index + pola.length <= bytes.length; index += 1) {
            let cocok = true;
            for (let j = 0; j < pola.length; j += 1) {
              if (bytes[index + j] !== pola[j]) {
                cocok = false;
                break;
              }
            }
            if (cocok) return true;
          }
          return false;
        });
      /*
        Berkasnya dibaca sebagai teks (latin1) supaya tata letak barunya ikut diperiksa:
        rangka kartu putih (`1 1 1 rg`), pita bernada per bagian (beberapa warna `rg`
        berbeda), batang bagan yang digambar sebagai jalur vektor (`f`), dan judul
        bagannya yang benar-benar tercetak.
      */
      const teksBlob = (blob) =>
        blob.arrayBuffer().then((buffer) =>
          new TextDecoder("windows-1252").decode(new Uint8Array(buffer)),
        );
      const pdfTeks = await teksBlob(berkasTersimpan.pdf);
      const warnaPita = new Set(pdfTeks.match(/[\d.]+ [\d.]+ [\d.]+ rg/g) ?? []);
      const bentukTerisi = (pdfTeks.match(/\nf\n/g) ?? []).length;
      check(
        "berkas PDF memuat desain barunya: kartu, pita bernada per bagian, dan bagan batang vektor",
        pdfTeks.includes("1 1 1 rg") &&
          pdfTeks.includes("GRAFIK - ") &&
          warnaPita.size >= 6 &&
          bentukTerisi >= 40,
        `${warnaPita.size} warna pita, ${bentukTerisi} bentuk terisi`,
      );
      check(
        "berkas Excel memuat lembar bagan & gambarnya",
        (await adaTeks(berkasTersimpan.xlsx, "xl/charts/chart1.xml")) &&
          (await adaTeks(berkasTersimpan.xlsx, "xl/drawings/drawing1.xml")),
        "arsip xlsx tanpa bagian bagan",
      );
      check(
        "unduhan laporan tanpa error konsol",
        halaman.newErrors().length === 0,
        halaman.newErrors().join(" | ").slice(0, 200),
      );
      await halaman.unmount();
    } finally {
      globalThis.Blob = asliBlob;
      URL.createObjectURL = asliCreate;
      URL.revokeObjectURL = asliRevoke;
    }
    withoutSession();
  }

  // 4. Penyimpanan yang melempar — persis yang terjadi di HP dengan mode privat
  //    atau storage diblokir. Penulisan localStorage di dalam efek sesi dulu
  //    tidak dijaga, dan satu lemparan di efek membuat React melepas seluruh
  //    pohon komponen: layarnya jadi putih semua.
  {
    const DashboardModule = await server.ssrLoadModule("/src/pages/DashboardPage.tsx");
    const realLocalStorage = globalThis.localStorage;
    // happy-dom mengekspos `localStorage` sebagai properti hanya-baca, jadi harus
    // ditimpa lewat defineProperty (di browser asli pun begitu).
    const override = (value) => {
      Object.defineProperty(window, "localStorage", {
        value,
        configurable: true,
        writable: true,
      });
      globalThis.localStorage = value;
    };
    const throwing = {
      getItem() {
        throw new Error("storage diblokir");
      },
      setItem() {
        throw new Error("storage diblokir");
      },
      removeItem() {
        throw new Error("storage diblokir");
      },
    };

    override(throwing);
    try {
      const { text, newErrors } = await renderTree(
        providers(React.createElement(DashboardModule.DashboardPage, null)),
      );
      check(
        "tetap merender saat localStorage melempar di HP",
        text.length > 40,
        `panjang=${text.length} (layar putih)`,
      );
      check(
        "error penyimpanan tidak sampai ke React",
        !newErrors.some((message) => message.includes("storage diblokir")),
        newErrors.join(" | ").slice(0, 200),
      );
    } finally {
      override(realLocalStorage);
    }
  }

  /*
    3e-6b. Halaman modul tanpa langganan = **hanya bisa dibaca**. Gerbangnya
    dipasang sekali di tingkat rute (`ModuleRoute` di `App.tsx`), jadi yang diuji
    di sini jalur yang benar-benar dipakai pengguna: alamat rutenya dibuka dengan
    sesi paket Starter, dan seluruh isi halaman harus berada di dalam wadah
    read-only — abu-abu, `inert`, `aria-disabled` — beserta alasan yang terbaca.
    Sesi Enterprise jadi pembanding: tidak boleh ada wadah itu, dan halaman
    **dasar** (Kasir, Produk & Stok) tidak boleh ikut terkunci di paket Starter.
  */
  {
    const { App: AppRoot } = await server.ssrLoadModule("/src/App.tsx");
    const renderAt = (path) =>
      renderInteractive(
        React.createElement(
          MemoryRouter,
          { initialEntries: [path] },
          React.createElement(ErrorBoundary, null, React.createElement(AppRoot, null)),
        ),
      );

    /** [rute, label fitur yang harus disebut di alasannya]. */
    const ruteModul = [
      ["/app/kds", "Kitchen Display System & KOT terpisah"],
      ["/app/opname", "Stock opname & audit selisih"],
      ["/app/purchasing", "Purchasing (PR · PO · GRN)"],
      ["/app/receivables", "Piutang B2B & credit limit"],
      ["/app/members", "Manajemen diskon & member"],
      ["/app/payments", "Pembayaran digital QRIS / VA"],
      ["/app/sync", "Sinkronisasi real-time multi-perangkat"],
      ["/app/support", "Dedicated support"],
      ["/app/api", "API akses penuh & webhook"],
    ];

    withEnterpriseSession("starter");
    for (const [rute, label] of ruteModul) {
      const view = await renderAt(rute);
      const wadah = view.query('[data-testid="modul-baca-saja"]');
      const isi = view.query('[data-testid="modul-baca-saja-isi"]');
      const kelas = (isi?.getAttribute("class") ?? "").split(/\s+/);
      check(
        `${rute}: isinya terkunci read-only (inert, aria-disabled, dan abu-abu)`,
        wadah !== null &&
          wadah.getAttribute("data-readonly") === "true" &&
          isi !== null &&
          isi.hasAttribute("inert") &&
          isi.getAttribute("aria-disabled") === "true" &&
          kelas.includes("text-muted-foreground") &&
          kelas.includes("opacity-60") &&
          kelas.includes("grayscale") &&
          kelas.includes("pointer-events-none"),
        `${rute} wadah=${wadah !== null} inert=${isi?.hasAttribute("inert")} kelas=${kelas.join(" ")}`,
      );
      check(
        `${rute}: alasannya menyebut fitur yang kurang & menyatakan hanya bisa dibaca`,
        view.text().includes(label) &&
          view.text().includes("hanya bisa dibaca") &&
          view.text().includes("tidak termasuk") ,
        view.text().slice(0, 300),
      );
      check(
        `${rute}: isi halamannya tetap terlihat (tidak disembunyikan) dan tanpa error konsol`,
        isi !== null &&
          (isi.textContent ?? "").trim().length > 0 &&
          view.newErrors().length === 0,
        `panjang_isi=${(isi?.textContent ?? "").trim().length} error=${view.newErrors().join(" | ").slice(0, 120)}`,
      );
      await view.unmount();
    }

    /*
      Dua halaman yang hanya **sebagian** milik modul: yang dikunci adalah
      permukaan modulnya, sedangkan bagian yang dibayar semua paket tetap hidup.
      Tanpa cek ini, “read-only tanpa kecuali” bisa berubah jadi “seluruh halaman
      dibekukan”, dan anggota tim/stok dasar ikut mati tanpa sebab.
    */
    for (const [rute, label] of [
      ["/app/inventory", "Multi-warehouse & lokasi rak"],
      ["/app/team", "Custom role (RBAC)"],
    ]) {
      const view = await renderAt(rute);
      const isi = view.query('[data-testid="modul-baca-saja-isi"]');
      check(
        `${rute}: bagian modulnya terkunci read-only`,
        isi !== null &&
          isi.hasAttribute("inert") &&
          isi.getAttribute("aria-disabled") === "true",
        `inert=${isi?.hasAttribute("inert")} aria=${isi?.getAttribute("aria-disabled")}`,
      );
      check(
        `${rute}: alasannya menyebut fitur yang kurang & menyatakan hanya bisa dibaca`,
        view.text().includes(label) && view.text().includes("hanya bisa dibaca"),
        view.text().slice(0, 240),
      );
      // Bagian yang bukan milik modul harus berada **di luar** wadah `inert`.
      const bebas =
        rute === "/app/team"
          ? (() => {
              const input = view.query('input[placeholder="sari@bisnis.id"]');
              return input !== null && input.closest("[inert]") === null;
            })()
          : view.queryAll("table").some((table) => table.closest("[inert]") === null);
      check(
        `${rute}: bagian yang bukan milik modul tetap bisa dipakai`,
        bebas,
        rute === "/app/team" ? "kolom undangan anggota" : "tabel stok per lokasi",
      );
      check(`${rute}: tanpa error konsol`, view.newErrors().length === 0, view.newErrors().join(" | ").slice(0, 120));
      await view.unmount();
    }

    // Halaman dasar tidak boleh ikut terkunci: Kasir & Produk hidup di semua paket.
    for (const rute of ["/app/pos", "/app/products"]) {
      const view = await renderAt(rute);
      check(
        `${rute}: halaman dasar tidak dikunci di paket Starter`,
        view.query('[data-testid="modul-baca-saja"]') === null,
        view.text().slice(0, 200),
      );
      await view.unmount();
    }

    // Pembanding: paket Enterprise memuat semuanya — tidak ada wadah read-only.
    withEnterpriseSession();
    for (const rute of ["/app/opname", "/app/api", "/app/support"]) {
      const view = await renderAt(rute);
      check(
        `${rute}: paket Enterprise tidak dikunci read-only`,
        view.query('[data-testid="modul-baca-saja"]') === null,
        view.text().slice(0, 200),
      );
      await view.unmount();
    }
  }

  // 3e-7. Peran kustom (`rbac.custom`, Phase 4): halaman Tim & Peran, dan yang
  //       lebih penting — gerbang klien mengikuti **izin peran kustom**, bukan
  //       peran bawaan, karena server pun begitu.
  {
    const { TeamPage } = await server.ssrLoadModule("/src/pages/TeamPage.tsx");
    const { App: AppRoot } = await server.ssrLoadModule("/src/App.tsx");

    withEnterpriseSession();
    const { text, newErrors } = await renderTree(
      providers(React.createElement(TeamPage, null)),
    );
    check(
      "halaman Tim & Peran memuat peran kustom contoh",
      text.includes("Tim & Peran") &&
        text.includes("Kasir Shift Malam") &&
        text.includes("Admin Harga"),
      text.slice(0, 400),
    );
    check(
      "halaman Tim & Peran memuat anggota beserta izin efektifnya",
      text.includes("Sari Wulandari") &&
        text.includes("Budi Santoso") &&
        text.includes("Izin efektif") &&
        text.includes("Peran bawaan"),
      text.slice(0, 600),
    );
    check(
      "checklist izin memuat seluruh kelompok izin",
      text.includes("Kasir, dapur & kas") &&
        text.includes("Bekerja di layar dapur (KDS)") &&
        text.includes("Membuka & menutup shift kas") &&
        text.includes("Produk & stok") &&
        text.includes("Pembelian") &&
        text.includes("Uang, piutang & hutang") &&
        text.includes("Laporan & langganan") &&
        text.includes("Tim & pelanggan") &&
        text.includes("Merawat katalog & harga") &&
        text.includes("Menjual dan menerima pembayaran"),
      text.slice(0, 800),
    );
    check(
      "peran kustom yang masih dipakai menampilkan jumlah anggotanya",
      text.includes("anggota memakai peran kustom") && text.includes("1 anggota"),
      text.slice(0, 400),
    );
    check(
      "pemilik dijelaskan selalu memegang seluruh izin",
      text.includes("Selalu seluruh izin"),
      text.slice(0, 600),
    );
    check(
      "halaman Tim & Peran tanpa error konsol",
      newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200),
    );

    // ---- Mendaftarkan anggota tim baru ke bisnis yang sama ---------------
    //      Undangannya diikat ke **email**, bukan perangkat. Yang diperiksa di
    //      sini bukan "ada form", melainkan bahwa form itu benar-benar menambah
    //      anggota ke daftar dan mengatakan langkah berikutnya kepada pengundang.
    {
      const ui = await renderInteractive(
        providers(React.createElement(TeamPage, null)),
      );
      const before = ui.queryAll("tbody tr").length;
      const inviteButton = () =>
        ui
          .queryAll("button")
          .find((row) => (row.textContent ?? "").trim().includes("Daftarkan ke tim"));

      check(
        "halaman Tim & Peran menyediakan form pendaftaran anggota tim",
        ui.text().includes("Daftarkan anggota tim") &&
          Boolean(ui.query("#member-email")) &&
          Boolean(ui.query("#member-role")) &&
          Boolean(inviteButton()),
        ui.text().slice(0, 300),
      );
      const ownerOptions = [
        ...(ui.query("#member-role")?.querySelectorAll("option") ?? []),
      ].map((row) => row.value);
      check(
        "pemilik ditawari seluruh peran bawaan, termasuk Pemilik",
        ["owner", "manager", "cashier", "inventory", "finance"].every((role) =>
          ownerOptions.includes(role),
        ),
        ownerOptions.join(","),
      );
      /*
        Laporan pemilik toko: peran kustom yang sudah dibuat **tidak muncul** di
        pilihan saat mendaftarkan anggota baru — peran itu dulu hanya bisa
        ditugaskan setelah orangnya masuk tim. Sekarang ada pilihannya di form
        yang sama, dan daftarnya peran kustom yang **aktif**.
      */
      /*
        **Satu pemilih peran**, bukan dua: peran tambahan (kustom) ikut di daftar
        yang sama dengan peran bawaan, dan tidak ada pemilih kedua di formulir.
        Nilai peran tambahan memakai awalan `custom:` (`roleChoiceValue`).
      */
      const roleSelect = ui.query("#member-role");
      const roleSelectLabels = [
        ...(roleSelect?.querySelectorAll("option") ?? []),
      ].map((row) => (row.textContent ?? "").trim());
      const roleGroups = [
        ...(roleSelect?.querySelectorAll("optgroup") ?? []),
      ].map((row) => row.getAttribute("label"));
      check(
        "peran tambahan muncul di pemilih peran yang sama dengan peran bawaan",
        roleSelect !== null &&
          roleSelectLabels.includes("Kasir Shift Malam") &&
          roleSelectLabels.includes("Admin Harga") &&
          roleSelectLabels.includes("Kasir") &&
          roleGroups.join("|") === "Peran bawaan|Peran tambahan",
        `${roleGroups.join(" | ")} :: ${roleSelectLabels.join(" | ")}`,
      );
      check(
        "formulir undangan tidak lagi menanyakan peran dua kali",
        ui.query("#member-custom-role") === null &&
          ui.queryAll('select[id="member-role"]').length === 1,
        `${ui.query("#member-custom-role") ? "pemilih kedua masih ada" : "tidak ada pemilih kedua"}`,
      );
      check(
        "catatan pemilih peran menjelaskan peran tambahan berdiri sendiri",
        (ui.query('[data-testid="member-role-catatan"]')?.textContent ?? "").includes(
          "Peran tambahan berdiri sendiri",
        ),
        ui.query('[data-testid="member-role-catatan"]')?.textContent ?? "(tidak ada)",
      );

      // Email yang tidak bisa menerima kode (domainnya tanpa titik) ditolak sebelum
      // dikirim — kalimatnya sama dengan halaman Masuk, bukan pesan karangan.
      await ui.fill("#member-email", "staf@toko");
      check(
        "email yang tidak bisa menerima kode ditolak sebelum dikirim",
        Boolean(inviteButton()?.disabled) &&
          ui.text().includes("Domain email harus punya titik"),
        `${inviteButton()?.disabled} | ${ui.text().slice(0, 240)}`,
      );

      await ui.fill("#member-email", "staf.baru@kopi-nusantara.id");
      await ui.fill("#member-name", "Staf Baru");
      await ui.click("Daftarkan ke tim");
      check(
        "anggota tim baru benar-benar masuk daftar anggota",
        ui.queryAll("tbody tr").length === before + 1 &&
          ui.text().includes("Staf Baru") &&
          ui.text().includes("staf.baru@kopi-nusantara.id"),
        `${before} → ${ui.queryAll("tbody tr").length} | ${ui.text().slice(0, 300)}`,
      );
      check(
        "pengundang diberi tahu langkah berikutnya bagi orang yang diundang",
        ui.text().includes("terdaftar sebagai") &&
          ui.text().includes("Minta staf.baru@kopi-nusantara.id masuk di halaman Masuk"),
        ui.text().slice(0, 500),
      );
      // Undangan yang dikirim lewat email tidak boleh diklaim terkirim di mode
      // demo: yang tampil justru pengakuan bahwa tidak ada email yang berangkat.
      check(
        "kolom Undangan menyebut keadaan kirim yang sebenarnya (demo tidak mengirim)",
        ui.text().includes("Undangan") &&
          ui.text().includes(
            "Mode demo: undangan tidak benar-benar dikirim lewat email",
          ) &&
          ui.text().includes("Percobaan kirim: 1"),
        ui.text().slice(0, 600),
      );

      // Kirim ulang: tombolnya ada di baris anggota itu, dan jejak percobaannya
      // bertambah — bukti bahwa yang ditekan bukan tombol mati.
      const barisBaru = ui
        .queryAll("tbody tr")
        .find((row) =>
          (row.textContent ?? "").includes("staf.baru@kopi-nusantara.id"),
        );
      const tombolKirimUlang = [
        ...(barisBaru?.querySelectorAll("button") ?? []),
      ].find((row) => (row.textContent ?? "").includes("Kirim ulang"));
      check(
        "baris anggota punya tombol kirim ulang undangan",
        Boolean(tombolKirimUlang) && tombolKirimUlang.disabled === false,
        barisBaru?.textContent?.slice(0, 200) ?? "baris tidak ditemukan",
      );
      await React.act(async () => {
        tombolKirimUlang.click();
      });
      check(
        "kirim ulang undangan bekerja dan menambah jejak percobaan",
        ui.text().includes("dijadwalkan ulang") &&
          ui.text().includes("Percobaan kirim: 2"),
        ui.text().slice(0, 700),
      );

      /*
        Mendaftarkan anggota baru **langsung dengan peran kustom**: pilihan yang
        sama dipakai saat mengirim, dan baris anggotanya benar-benar memakai
        peran itu (bukan cuma bisa dipilih di formulirnya).
      */
      await ui.fill("#member-email", "kasir.malam@kopi-nusantara.id");
      await ui.fill("#member-name", "Kasir Malam");
      await ui.select("#member-role", "custom:role-malam");
      check(
        "pilihan peran yang dipilih terbaca sebelum dikirim",
        (ui.query('[data-testid="member-role-catatan"]')?.textContent ?? "").includes(
          "Kasir Shift Malam",
        ),
        ui.query('[data-testid="member-role-catatan"]')?.textContent ?? "(tidak ada)",
      );
      await ui.click("Daftarkan ke tim");
      const barisMalam = ui
        .queryAll("tbody tr")
        .find((row) => (row.textContent ?? "").includes("kasir.malam@kopi-nusantara.id"));
      check(
        "anggota baru benar-benar memakai peran yang dipilih di formulir",
        barisMalam !== undefined &&
          barisMalam.querySelector('[aria-label="Peran Kasir Malam"]')?.value ===
            "custom:role-malam",
        barisMalam?.textContent?.slice(0, 200) ?? "baris tidak ditemukan",
      );
      check(
        "daftar anggota punya satu kolom Peran, bukan dua",
        [...ui.queryAll("thead th")].filter((row) =>
          (row.textContent ?? "").trim() === "Peran",
        ).length === 1 &&
          !ui.text().includes("Peran bawaan (Kasir)"),
        [...ui.queryAll("thead th")].map((row) => (row.textContent ?? "").trim()).join(" | "),
      );
      check(
        "notisnya menyebut satu peran saja untuk anggota baru itu",
        ui.text().includes("terdaftar sebagai Kasir Shift Malam") &&
          !ui.text().includes("peran kustom Kasir Shift Malam"),
        ui.text().slice(0, 500),
      );

      // Undangan ulang untuk email yang sudah jadi anggota = perubahan peran,
      // bukan baris kedua di daftar (aturan yang sama dengan `members.add`).
      await ui.fill("#member-email", "sari@kopi-nusantara.id");
      await ui.fill("#member-name", "");
      check(
        "undangan ulang dikenali sebagai perubahan peran, bukan anggota baru",
        ui.text().includes("sudah anggota tim — perannya akan diperbarui"),
        ui.text().slice(0, 300),
      );
      await ui.click("Daftarkan ke tim");
      check(
        "daftar anggota tidak bertambah saat email yang sama diundang lagi",
        ui.queryAll("tbody tr").length === before + 2 &&
          ui.text().includes("sudah anggota tim — perannya diperbarui menjadi"),
        `${ui.queryAll("tbody tr").length} | ${ui.text().slice(0, 400)}`,
      );
      await ui.unmount();
    }

    // ---- Tombol undangan mati selama workspace belum tersambung ke server ---
    //      Sebelum ini, undangan yang dikirim pada saat itu dijawab store dengan
    //      “Tenant belum siap. Coba lagi sebentar lagi.” — benar, tetapi tidak
    //      menjelaskan apa pun kepada orang yang baru masuk di perangkat baru.
    //      Keputusannya satu tempat (`resolveTeamInviteForm`), dan di sini
    //      dibuktikan lewat DOM: nilainya diambil dari store demo yang **asli**,
    //      hanya `workspacePending`-nya yang diganti — pola yang sama dengan uji
    //      shell `/app` di atas.
    {
      withEnterpriseSession();
      const { TeamPage } = await server.ssrLoadModule("/src/pages/TeamPage.tsx");
      const { StoreContext, useStore } = await server.ssrLoadModule(
        "/src/lib/store/context.ts",
      );
      const { MEMBERSHIP_SUSPENDED_NOTE, WORKSPACE_PENDING_INVITE_NOTE } =
        await server.ssrLoadModule("/src/lib/team.ts");

      let captured = null;
      const Probe = () => {
        captured = useStore();
        return null;
      };
      await renderTree(providers(React.createElement(Probe, null)));
      check(
        "store demo bisa dibaca sebagai sumber nilai untuk uji tombol undangan",
        Boolean(captured) && captured.workspacePending === false,
        String(captured?.workspacePending),
      );

      const halamanTim = (storeValue) =>
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/app"] },
          React.createElement(
            SessionProvider,
            null,
            React.createElement(
              StoreContext.Provider,
              { value: storeValue },
              React.createElement(TeamPage, null),
            ),
          ),
        );
      const tombolUndang = (ui) =>
        ui
          .queryAll("button")
          .find((row) => (row.textContent ?? "").trim().includes("Daftarkan ke tim"));

      const tertahan = await renderInteractive(
        halamanTim({ ...captured, workspacePending: true }),
      );
      check(
        "tombol undangan mati selama workspace belum tersambung ke server",
        tombolUndang(tertahan)?.disabled === true,
        `${tombolUndang(tertahan)?.disabled} | ${tertahan.text().slice(0, 200)}`,
      );
      check(
        "alasan tombol undangan mati terbaca di halaman, bukan galat setelah ditekan",
        tertahan.text().includes(WORKSPACE_PENDING_INVITE_NOTE) &&
          !tertahan.text().includes("Tenant belum siap"),
        tertahan.text().slice(0, 300),
      );
      await tertahan.unmount();

      const siap = await renderInteractive(
        halamanTim({ ...captured, workspacePending: false }),
      );
      await siap.fill("#member-email", "staf.siap@kopi-nusantara.id");
      check(
        "setelah workspace tersambung, tombol undangan hidup lagi",
        tombolUndang(siap)?.disabled === false &&
          !siap.text().includes(WORKSPACE_PENDING_INVITE_NOTE),
        `${tombolUndang(siap)?.disabled} | ${siap.text().slice(0, 200)}`,
      );
      await siap.unmount();

      // Keanggotaan nonaktif: store sudah punya kalimatnya, dan kalimat itu yang
      // dipakai tombolnya apa adanya — bukan pesan teknis “Tenant belum siap”.
      const tidakBisaDipakai = await renderInteractive(
        halamanTim({ ...captured, error: MEMBERSHIP_SUSPENDED_NOTE }),
      );
      await tidakBisaDipakai.fill("#member-email", "staf.gagal@kopi-nusantara.id");
      check(
        "workspace yang tidak bisa dipakai juga mematikan tombol undangan beserta alasannya",
        tombolUndang(tidakBisaDipakai)?.disabled === true &&
          tidakBisaDipakai.text().includes("Undangan belum bisa dikirim") &&
          tidakBisaDipakai.text().includes(MEMBERSHIP_SUSPENDED_NOTE),
        `${tombolUndang(tidakBisaDipakai)?.disabled} | ${tidakBisaDipakai.text().slice(0, 260)}`,
      );
      await tidakBisaDipakai.unmount();
    }

    // ---- Undangan WhatsApp langsung + kelola anggota (ubah, aktif/nonaktif,
    //      hapus) untuk semua akun tim --------------------------------------
    //      Yang diperiksa bukan “ada tombolnya”, melainkan bahwa tombolnya
    //      bekerja: tautan `wa.me` yang dibuka memakai nomor ternormalisasi dan
    //      pesan yang benar, jejak bukanya dicatat, perubahan benar-benar
    //      tersimpan di baris anggota, dan pagar “akun sendiri” berlaku.
    {
      withEnterpriseSession();
      const ui = await renderInteractive(
        providers(React.createElement(TeamPage, null)),
      );

      const baris = (email) =>
        ui
          .queryAll("tbody tr")
          .find((row) => (row.textContent ?? "").includes(email)) ?? null;
      const tombolDi = (row, label) =>
        [...(row?.querySelectorAll("button") ?? [])].find((button) =>
          (button.textContent ?? "").trim().includes(label),
        ) ?? null;
      const klikDi = async (row, label) => {
        const tombol = tombolDi(row, label);
        if (!tombol) throw new Error(`tombol "${label}" tidak ada di baris itu`);
        if (tombol.disabled) throw new Error(`tombol "${label}" sedang nonaktif`);
        await React.act(async () => {
          tombol.click();
        });
        // Aksi store selesai di microtask; beri kesempatan React menuliskannya.
        await React.act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
      };
      /** Badge status di baris anggota (`aktif` / `nonaktif`), bukan teks bebas. */
      const badgeStatus = (row) =>
        [...(row?.querySelectorAll("div, span") ?? [])]
          .map((element) => (element.textContent ?? "").trim())
          .find((label) => label === "aktif" || label === "nonaktif") ?? null;
      const tombolGlobal = (label) =>
        ui
          .queryAll("button")
          .find((button) => (button.textContent ?? "").includes(label)) ?? null;

      // Kolom WhatsApp: nomor, keadaan nominalnya, dan tombol di baris yang tepat.
      const barisSari = () => baris("sari@kopi-nusantara.id");
      const barisDewi = () => baris("dewi@kopi-nusantara.id");
      check(
        "kolom WhatsApp menampilkan nomor anggota beserta jejak undangannya",
        (barisSari()?.textContent ?? "").includes("+6281234567890") &&
          (barisSari()?.textContent ?? "").includes("Tautan WhatsApp dibuka 1×") &&
          (barisDewi()?.textContent ?? "").includes("Belum ada nomor") &&
          (barisDewi()?.textContent ?? "").includes(
            "Belum ada undangan WhatsApp dikirim",
          ),
        barisSari()?.textContent?.slice(0, 240) ?? "baris tidak ditemukan",
      );
      check(
        "tombol kirim via WA hidup untuk anggota bernomor dan mati tanpa nomor",
        tombolDi(barisSari(), "Kirim via WA")?.disabled === false &&
          tombolDi(barisDewi(), "Kirim via WA")?.disabled === true,
        `sari: ${tombolDi(barisSari(), "Kirim via WA")?.disabled} | dewi: ${tombolDi(barisDewi(), "Kirim via WA")?.disabled}`,
      );

      // `window.open` diganti supaya tautan yang benar-benar dibuka bisa diperiksa:
      // tanpa itu, “undangan WA” cuma tombol yang tidak membuka apa pun.
      const terbuka = [];
      const openAsli = window.open;
      window.open = (url) => {
        terbuka.push(String(url));
        return null;
      };
      await klikDi(barisSari(), "Kirim via WA");
      window.open = openAsli;

      const tautanWa = terbuka[0] ?? null;
      const isiWa = tautanWa
        ? decodeURIComponent(tautanWa.slice(tautanWa.indexOf("?text=") + 6))
        : "";
      check(
        "tombol kirim via WA membuka percakapan wa.me ke nomor anggota",
        terbuka.length === 1 &&
          Boolean(tautanWa?.startsWith("https://wa.me/6281234567890?text=")),
        tautanWa ?? "tidak ada tautan yang dibuka",
      );
      check(
        "pesan WhatsApp menyebut workspace, email, peran, pengundang, dan cara masuknya",
        isiWa.includes("Distribusi Uji") &&
          isiWa.includes("sari@kopi-nusantara.id") &&
          isiWa.includes("Kasir") &&
          isiWa.includes("Uji Gudang") &&
          isiWa.includes("/auth") &&
          isiWa.includes("kode 6 digit"),
        isiWa.slice(0, 300),
      );
      check(
        "membuka tautan WA dicatat di kolom WhatsApp, bukan diklaim terkirim",
        ui.text().includes("dibuka di nomor 6281234567890") &&
          (barisSari()?.textContent ?? "").includes("Tautan WhatsApp dibuka 2×"),
        ui.text().slice(0, 300),
      );

      // ------------------------------- ubah anggota --------------------------
      await klikDi(baris("rizal@kopi-nusantara.id"), "Ubah");
      check(
        "tombol Ubah membuka form yang sudah terisi data anggota itu",
        ui.text().includes("Ubah anggota: Rizal Pratama") &&
          ui.query("#edit-name")?.value === "Rizal Pratama" &&
          ui.query("#edit-email")?.value === "rizal@kopi-nusantara.id" &&
          ui.query("#edit-phone")?.value === "628551234567" &&
          (ui.query('[data-testid="edit-peran-catatan"]')?.textContent ?? "").includes(
            "peran bawaan Staf Gudang",
          ),
        ui.text().slice(0, 240),
      );
      await ui.fill("#edit-name", "Rizal P.");
      await ui.fill("#edit-phone", "0813-1111-2222");
      check(
        "pratinjau menyebut apa saja yang berubah sebelum disimpan",
        ui.text().includes("Yang berubah: nama, nomor WhatsApp."),
        ui.text().slice(0, 400),
      );
      await ui.click("Simpan perubahan");
      check(
        "perubahan nama dan nomor WhatsApp tersimpan ke baris anggota",
        ui.text().includes("Rizal P.: nama, nomor WhatsApp diperbarui.") &&
          (baris("rizal@kopi-nusantara.id")?.textContent ?? "").includes("Rizal P.") &&
          (baris("rizal@kopi-nusantara.id")?.textContent ?? "").includes(
            "+6281311112222",
          ) &&
          ui.query("#edit-name") === null,
        ui.text().slice(0, 400),
      );

      // --------------------------- aktif / nonaktif ---------------------------
      await klikDi(baris("rizal@kopi-nusantara.id"), "Nonaktifkan");
      check(
        "tombol Nonaktifkan mengubah status anggota di barisnya",
        badgeStatus(baris("rizal@kopi-nusantara.id")) === "nonaktif" &&
          ui
            .text()
            .includes(
              "Rizal P. dinonaktifkan — ia tidak bisa memakai workspace ini sampai diaktifkan lagi.",
            ),
        badgeStatus(baris("rizal@kopi-nusantara.id")) ?? "badge tidak ada",
      );
      await klikDi(baris("rizal@kopi-nusantara.id"), "Aktifkan");
      check(
        "tombol Aktifkan mengembalikan akses anggota",
        badgeStatus(baris("rizal@kopi-nusantara.id")) === "aktif" &&
          ui.text().includes("Rizal P. diaktifkan kembali."),
        badgeStatus(baris("rizal@kopi-nusantara.id")) ?? "badge tidak ada",
      );

      // ------------------------------- hapus ----------------------------------
      const jumlahSebelumHapus = ui.queryAll("tbody tr").length;
      await klikDi(baris("rizal@kopi-nusantara.id"), "Hapus");
      check(
        "tombol Hapus menahan dulu: penghapusan harus dikonfirmasi",
        Boolean(tombolDi(baris("rizal@kopi-nusantara.id"), "Yakin hapus?")) &&
          baris("rizal@kopi-nusantara.id") !== null,
        baris("rizal@kopi-nusantara.id")?.textContent?.slice(0, 200) ?? "baris hilang",
      );
      await klikDi(baris("rizal@kopi-nusantara.id"), "Yakin hapus?");
      check(
        "anggota benar-benar hilang dari daftar setelah dikonfirmasi",
        ui.queryAll("tbody tr").length === jumlahSebelumHapus - 1 &&
          baris("rizal@kopi-nusantara.id") === null &&
          ui
            .text()
            .includes("Rizal P. dihapus dari tim ini. Akunnya sendiri tetap ada"),
        `${jumlahSebelumHapus} → ${ui.queryAll("tbody tr").length}`,
      );

      // ------------------ pemilik mengangkat pemilik kedua --------------------
      //      Dua pemilik **aktif** diperlukan supaya pagar “akun sendiri” bisa
      //      diuji terpisah dari pagar “pemilik terakhir” (urutan pagarnya memang
      //      begitu di `lib/team.ts`, dan server memutuskan hal yang sama).
      //      Peran diganti dari kolom **Peran** di daftar anggota — satu tempat
      //      untuk peran bawaan & peran tambahan; formulir Ubah hanya identitas.
      await klikDi(baris("sari@kopi-nusantara.id"), "Ubah");
      check(
        "form Ubah tidak lagi menanyakan peran kedua kalinya",
        ui.query("#edit-role") === null &&
          (ui.query('[data-testid="edit-peran-catatan"]')?.textContent ?? "").includes(
            "peran tambahan Kasir Shift Malam",
          ) &&
          (ui.query('[data-testid="edit-peran-catatan"]')?.textContent ?? "").includes(
            "kolom Peran",
          ),
        ui.query('[data-testid="edit-peran-catatan"]')?.textContent ?? "(tidak ada)",
      );
      await ui.click("Batal");
      /*
        Sari di data contoh memakai peran tambahan `role-malam`. Mengangkatnya
        menjadi Pemilik harus **melepas** peran tambahan itu — pemilik selalu
        memegang seluruh izin, dan peran tambahan yang masih menempel berarti
        pemiliknya tidak lagi punya `billing.manage`.
      */
      await React.act(async () => {
        const pilihPeran = baris("sari@kopi-nusantara.id").querySelector(
          '[aria-label="Peran Sari Wulandari"]',
        );
        check(
          "kolom Peran menampilkan peran tambahan yang sedang dipakai",
          pilihPeran?.value === "custom:role-malam",
          `nilai kolom Peran: ${pilihPeran?.value ?? "(tidak ada)"}`,
        );
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLSelectElement.prototype,
          "value",
        ).set;
        setter.call(pilihPeran, "owner");
        pilihPeran.dispatchEvent(new window.Event("change", { bubbles: true }));
      });
      check(
        "pemilik bisa mengangkat anggota lain menjadi pemilik dari kolom Peran",
        (baris("sari@kopi-nusantara.id")?.textContent ?? "").includes("Pemilik") &&
          ui.text().includes("Sari Wulandari sekarang Pemilik."),
        ui.text().slice(0, 300),
      );
      check(
        "pemilik baru tidak lagi memakai peran tambahan",
        (baris("sari@kopi-nusantara.id")?.textContent ?? "").includes(
          "Selalu seluruh izin",
        ),
        baris("sari@kopi-nusantara.id")?.textContent?.slice(0, 200) ?? "baris hilang",
      );

      // ------------------- pagar “akun sendiri” di halaman --------------------
      await klikDi(baris("budi@kopi-nusantara.id"), "Ubah");
      check(
        "form Ubah juga bisa dibuka untuk akun sendiri",
        ui.text().includes("Ubah anggota: Budi Santoso") &&
          ui.query("#edit-active")?.checked === true,
        ui.text().slice(0, 240),
      );
      await React.act(async () => {
        ui.query("#edit-active").click();
      });
      check(
        "akun sendiri tidak bisa dinonaktifkan dari halaman ini",
        ui.query("#edit-active")?.checked === false &&
          tombolGlobal("Simpan perubahan")?.disabled === true &&
          ui.text().includes("Akun Anda sendiri tidak bisa dinonaktifkan dari sini."),
        JSON.stringify({
          checked: ui.query("#edit-active")?.checked,
          disabled: tombolGlobal("Simpan perubahan")?.disabled,
          alasan: ui.text().includes(
            "Akun Anda sendiri tidak bisa dinonaktifkan dari sini.",
          ),
          cuplikan: ui.text().slice(0, 200),
        }),
      );
      await ui.click("Batal");
      check(
        "tombol Batal menutup form tanpa mengubah anggota",
        ui.query("#edit-name") === null &&
          baris("budi@kopi-nusantara.id") !== null &&
          ui.text().includes("Ubah anggota: Budi Santoso") === false,
        ui.text().slice(0, 200),
      );
      check(
        "halaman Tim & Peran dengan aksi baru tanpa error konsol",
        ui.newErrors().length === 0,
        ui.newErrors().join(" | ").slice(0, 200),
      );
      await ui.unmount();

      // Kasir (tanpa `team.manage`) tidak boleh melihat satu pun tombol
      // pengelolaan anggota: yang tidak berizin tidak ditawari aksi.
      window.localStorage.setItem(
        "mesinpos.session.v1",
        JSON.stringify({
          ...ENTERPRISE_SESSION,
          tenant: { ...ENTERPRISE_SESSION.tenant, role: "cashier" },
        }),
      );
      const kasir = await renderInteractive(
        providers(React.createElement(TeamPage, null)),
      );
      const tombolBaris = kasir
        .queryAll("tbody tr")
        .flatMap((row) =>
          [...row.querySelectorAll("button")].map((button) =>
            (button.textContent ?? "").trim(),
          ),
        );
      check(
        "kasir tidak ditawari ubah, aktif/nonaktif, hapus, maupun kirim via WA",
        tombolBaris.length === 0 &&
          kasir.text().includes("Anggota tim") &&
          !kasir.text().includes("Daftarkan anggota tim"),
        tombolBaris.join(" | ") || "tidak ada tombol pengelolaan",
      );
      await kasir.unmount();
    }

    // Manajer boleh mendaftarkan anggota, tetapi tidak ditawari peran Pemilik:
    // server menolaknya (`Hanya pemilik dapat menetapkan peran pemilik`), jadi
    // halaman tidak boleh menawarkan pilihan yang akan ditolak.
    {
      window.localStorage.setItem(
        "mesinpos.session.v1",
        JSON.stringify({
          ...ENTERPRISE_SESSION,
          tenant: { ...ENTERPRISE_SESSION.tenant, role: "manager" },
        }),
      );
      const manajer = await renderInteractive(
        providers(React.createElement(TeamPage, null)),
      );
      const select = manajer.query("#member-role");
      const options = select
        ? [...select.querySelectorAll("option")].map((row) => row.value)
        : [];
      check(
        "manajer tidak ditawari peran Pemilik saat mendaftarkan anggota",
        !options.includes("owner") &&
          options.includes("cashier") &&
          // Peran tambahan ikut di daftar yang sama; yang penting Pemilik tidak ada.
          options.some((value) => value.startsWith("custom:")) &&
          manajer
            .text()
            .includes("hanya pemilik tenant yang boleh menetapkan pemilik lain"),
        options.join(","),
      );
      await manajer.unmount();
    }

    withoutSession();
    const starter = await renderTree(
      providers(React.createElement(TeamPage, null)),
    );
    check(
      "paket Starter melihat alasan peran kustom terkunci",
      starter.text.includes("Peran kustom terkunci") &&
        starter.text.includes("tidak termasuk paket Starter"),
      starter.text.slice(0, 400),
    );

    // Sesi dengan peran kustom yang hanya memuat `pos.sell`: rute dashboard
    // (butuh `report.view`) harus ditolak, dan menu Tim & Peran ikut hilang.
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        ...ENTERPRISE_SESSION,
        tenant: {
          ...ENTERPRISE_SESSION.tenant,
          role: "cashier",
          customRole: {
            id: "role-malam",
            name: "Kasir Shift Malam",
            permissions: ["pos.sell"],
          },
        },
      }),
    );
    const gated = await renderTree(providers(React.createElement(AppRoot, null)));
    check(
      "rute memakai izin peran kustom, bukan peran bawaan",
      gated.text.includes("Akses ditolak") &&
        gated.text.includes("Peran kustom Kasir Shift Malam"),
      gated.text.slice(0, 300),
    );
    check(
      "menu mengikuti izin peran kustom",
      gated.text.includes("Kasir (POS)") && !gated.text.includes("Tim & Peran"),
      gated.text.slice(0, 400),
    );
    withoutSession();
  }

  // 3e-7b. **Pengaturan peran bawaan** (`roleSettings`): izinnya bisa disesuaikan,
  //       perannya bisa dinonaktifkan/dihapus, dan semuanya benar-benar **diklik**
  //       di DOM — bukan hanya diperiksa teksnya. Yang diuji juga bahwa peran yang
  //       dinonaktifkan hilang dari pilihan undangan, dan bahwa izin peran bawaan
  //       yang dipersempit workspace ikut mempersempit rute klien.
  {
    const { TeamPage } = await server.ssrLoadModule("/src/pages/TeamPage.tsx");
    const { App: AppRoot } = await server.ssrLoadModule("/src/App.tsx");

    withEnterpriseSession();
    const { text, newErrors } = await renderTree(
      providers(React.createElement(TeamPage, null)),
    );
    check(
      "halaman menampilkan kartu peran bawaan",
      text.includes("Peran bawaan") &&
        text.includes("Izin peran bawaan bisa disesuaikan"),
      text.slice(0, 400),
    );
    check(
      "kelima peran bawaan tampil",
      ["Pemilik", "Manajer", "Kasir", "Staf Gudang", "Keuangan"].every((label) =>
        text.includes(label),
      ),
      text.slice(0, 600),
    );
    check(
      "pemilik dijelaskan terkunci (seluruh izin, tidak bisa diubah)",
      text.includes("Peran Pemilik selalu memegang seluruh izin"),
      text.slice(0, 800),
    );
    check(
      "ringkasan peran bawaan tampil",
      text.includes("5 peran bawaan") && text.includes("dari 5 masih bisa ditugaskan"),
      text.slice(0, 400),
    );
    check(
      "halaman peran bawaan tanpa error konsol",
      newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200),
    );

    const ui = await renderInteractive(
      providers(React.createElement(TeamPage, null)),
    );
    const baris = (role) => {
      const row = ui.query(`[data-testid="peran-bawaan-${role}"]`);
      return row ? (row.textContent ?? "").replace(/\s+/g, " ").trim() : "";
    };
    const opsiPeran = () => [
      ...(ui.query("#member-role")?.querySelectorAll("option") ?? []),
    ].map((row) => row.value);

    check(
      "baris Kasir menampilkan izin bawaan (8 izin)",
      baris("cashier").includes("8 izin (bawaan)") &&
        baris("cashier").includes("Melihat laporan") &&
        // Dapur & kas tidak lagi menumpang `pos.sell`: keduanya izin sendiri.
        baris("cashier").includes("Bekerja di layar dapur (KDS)") &&
        baris("cashier").includes("Membuka & menutup shift kas"),
      baris("cashier"),
    );
    check(
      "pemilik tidak menawarkan tombol apa pun",
      !ui.query('[aria-label="Ubah izin peran Pemilik"]') &&
        !ui.query('[aria-label="Hapus peran Pemilik"]') &&
        !ui.query('[aria-label="Nonaktifkan peran Pemilik"]'),
      baris("owner"),
    );
    check(
      "Hapus peran yang masih dipakai mati (Kasir: 2 anggota)",
      ui.query('[aria-label="Hapus peran Kasir"]')?.disabled === true,
      baris("cashier"),
    );
    check(
      "Hapus peran yang belum dipakai hidup (Keuangan: 0 anggota)",
      ui.query('[aria-label="Hapus peran Keuangan"]')?.disabled === false,
      baris("finance"),
    );

    // --- 1) Menyunting izin Kasir: `report.view` dilepas, lalu dikembalikan ---
    await ui.clickOn('[aria-label="Ubah izin peran Kasir"]');
    check(
      "editor menyebut peran bawaan yang sedang disunting",
      ui.text().includes("Ubah izin peran Kasir") &&
        Boolean(ui.query('[data-testid="editor-peran-bawaan"]')) &&
        // Nama & keterangan hanya untuk peran kustom — peran bawaan tidak punya
        // kolom itu di editornya.
        !ui.query("#role-name"),
      ui.text().slice(0, 400),
    );
    const izinReport = () =>
      ui
        .queryAll("button[aria-pressed]")
        .find((row) => (row.textContent ?? "").trim() === "Melihat laporan");
    check(
      "izin yang sedang berlaku tampil tercentang di editor",
      izinReport()?.getAttribute("aria-pressed") === "true",
      String(izinReport()?.getAttribute("aria-pressed")),
    );
    await React.act(async () => {
      izinReport().click();
    });
    await ui.click("Simpan izin");
    check(
      "izin Kasir tersimpan & ditandai disesuaikan",
      baris("cashier").includes("izin disesuaikan") &&
        baris("cashier").includes("7 izin (disesuaikan)") &&
        !baris("cashier").includes("Melihat laporan"),
      baris("cashier"),
    );
    check(
      "notis menyebut peran & jumlah izinnya",
      ui.text().includes("Izin peran Kasir disimpan (7 izin)"),
      ui.text().slice(0, 200),
    );
    check(
      "tombol Kembalikan izin bawaan muncul setelah izin disesuaikan",
      Boolean(ui.query('[aria-label="Kembalikan izin bawaan Kasir"]')),
      baris("cashier"),
    );

    // --- 2) Menonaktifkan Kasir: hilang dari pilihan undangan ---
    await ui.clickOn('[aria-label="Nonaktifkan peran Kasir"]');
    check(
      "peran dinonaktifkan tampil nonaktif beserta akibatnya",
      baris("cashier").includes("nonaktif") &&
        baris("cashier").includes("tidak ditawarkan lagi saat mengundang"),
      baris("cashier"),
    );
    check(
      "peran nonaktif hilang dari pilihan peran undangan",
      !opsiPeran().includes("cashier") &&
        opsiPeran().includes("manager") &&
        opsiPeran().includes("finance"),
      opsiPeran().join(","),
    );
    await ui.clickOn('[aria-label="Aktifkan peran Kasir"]');
    check(
      "peran bisa diaktifkan kembali dan muncul lagi di pilihan undangan",
      baris("cashier").includes("aktif") && opsiPeran().includes("cashier"),
      `${baris("cashier").slice(0, 120)} | ${opsiPeran().join(",")}`,
    );

    // --- 3) Kembalikan izin bawaan: jejak “disesuaikan” hilang ---
    await ui.clickOn('[aria-label="Kembalikan izin bawaan Kasir"]');
    check(
      "Kembalikan izin bawaan mengembalikan izin asli peran itu",
      baris("cashier").includes("8 izin (bawaan)") &&
        baris("cashier").includes("Melihat laporan") &&
        !ui.query('[aria-label="Kembalikan izin bawaan Kasir"]'),
      baris("cashier"),
    );

    // --- 4) Menghapus peran Keuangan, lalu memulihkannya ---
    await ui.clickOn('[aria-label="Hapus peran Keuangan"]');
    check(
      "menghapus peran menuntut konfirmasi lebih dulu",
      Boolean(ui.query('[aria-label="Yakin hapus peran Keuangan"]')) &&
        baris("finance").includes("Keuangan"),
      baris("finance"),
    );
    await ui.clickOn('[aria-label="Yakin hapus peran Keuangan"]');
    check(
      "peran dihapus: statusnya dihapus & tombol Pulihkan tersedia",
      baris("finance").includes("dihapus") &&
        Boolean(ui.query('[aria-label="Pulihkan peran Keuangan"]')) &&
        !opsiPeran().includes("finance"),
      `${baris("finance")} | ${opsiPeran().join(",")}`,
    );
    await ui.clickOn('[aria-label="Pulihkan peran Keuangan"]');
    check(
      "peran yang dihapus bisa dipulihkan kembali",
      baris("finance").includes("aktif") &&
        !ui.query('[aria-label="Pulihkan peran Keuangan"]') &&
        opsiPeran().includes("finance"),
      `${baris("finance")} | ${opsiPeran().join(",")}`,
    );
    check(
      "aksi peran bawaan tidak melempar error",
      ui.newErrors().length === 0,
      ui.newErrors().join(" | ").slice(0, 200),
    );
    await ui.unmount();

    /*
      --- 4b) Paket **Starter**: menyunting izin peran bawaan ditolak server
      (`roles.setBuiltin` → `requireFeature("rbac.custom")`). Dulu tombolnya
      hidup di paket itu, jadi pengguna baru tahu setelah server menjawab
      “Fitur Custom role (RBAC) tidak termasuk paket Starter.” Yang diperiksa di
      sini: tombolnya tetap terlihat tetapi mati, sebabnya terbaca, dan halaman
      mengatakannya sebelum ada request dikirim.
    */
    {
      withEnterpriseSession("starter");
      const starter = await renderInteractive(
        providers(React.createElement(TeamPage, null)),
      );
      const ubahIzin = starter.query('[aria-label="Ubah izin peran Kasir terkunci"]');
      check(
        "paket Starter: tombol Ubah izin peran bawaan tampil tetapi mati",
        ubahIzin !== null && ubahIzin.disabled === true,
        `ada=${ubahIzin !== null} disabled=${ubahIzin?.disabled}`,
      );
      check(
        "paket Starter: sebab tombolnya mati terbaca (kalimat yang sama dengan server)",
        (ubahIzin?.getAttribute("title") ?? "").includes(
          "tidak termasuk paket Starter",
        ),
        ubahIzin?.getAttribute("title") ?? "(tanpa title)",
      );
      check(
        "paket Starter: menekan tombolnya tidak membuka editor izin",
        starter.query('[data-testid="editor-peran-bawaan"]') === null,
        starter.text().slice(0, 200),
      );
      check(
        "paket Starter: catatan halaman menyebut bagian Peran hanya bisa dibaca (anggota tetap bisa diurus)",
        starter.text().includes("Bagian Peran") &&
          starter.text().includes("hanya bisa dibaca") &&
          starter.text().includes("Mengelola anggota"),
        starter.text().slice(0, 400),
      );
      /*
        Menugaskan **peran bawaan** tidak butuh `rbac.custom` (server hanya
        menuntutnya saat `customRoleId` diisi), jadi pemilih peran di formulir
        undangan harus tetap bisa dipakai di paket Starter — yang hilang hanya
        kelompok peran tambahannya.
      */
      const pemilihPeran = starter.query("#member-role");
      const grupPeran = [
        ...(pemilihPeran?.querySelectorAll("optgroup") ?? []),
      ].map((row) => row.getAttribute("label"));
      check(
        "paket Starter: pemilih peran undangan tetap bisa dipakai untuk peran bawaan",
        pemilihPeran !== null &&
          pemilihPeran.disabled === false &&
          grupPeran.join("|") === "Peran bawaan",
        `disabled=${pemilihPeran?.disabled} grup=${grupPeran.join("|")}`,
      );
      check(
        "paket Starter: catatan pemilih peran menyebut peran bawaan tetap bisa ditugaskan",
        (starter.query('[data-testid="member-role-catatan"]')?.textContent ?? "").includes(
          "Peran bawaan tetap bisa ditugaskan",
        ),
        starter.query('[data-testid="member-role-catatan"]')?.textContent ??
          "(tidak ada)",
      );
      check(
        "paket Starter: menonaktifkan & menghapus peran tetap bisa ditekan",
        starter.query('[aria-label="Nonaktifkan peran Kasir"]')?.disabled === false &&
          starter.query('[aria-label="Hapus peran Keuangan"]')?.disabled === false,
        starter.text().slice(0, 200),
      );
      check(
        "paket Starter: halaman Tim & Peran tanpa error konsol",
        starter.newErrors().length === 0,
        starter.newErrors().join(" | ").slice(0, 200),
      );
      await starter.unmount();
    }

    // --- 5) Sesi kasir yang izinnya dipersempit workspace ---
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        ...ENTERPRISE_SESSION,
        tenant: {
          ...ENTERPRISE_SESSION.tenant,
          role: "cashier",
          customRole: null,
          rolePermissions: ["pos.sell"],
        },
      }),
    );
    const sempit = await renderTree(providers(React.createElement(AppRoot, null)));
    check(
      "rute mengikuti izin peran bawaan yang disesuaikan",
      sempit.text.includes("Akses ditolak") &&
        sempit.text.includes("Peran Kasir tidak memiliki izin"),
      sempit.text.slice(0, 300),
    );
    check(
      "menu ikut menyempit saat izin peran bawaan dipersempit",
      sempit.text.includes("Kasir (POS)") && !sempit.text.includes("Tim & Peran"),
      sempit.text.slice(0, 400),
    );
    withoutSession();
  }

  // 3e-8. Akses API & webhook (`api.access`, Phase 4): halaman API & Webhook.
  //       Yang diuji bukan cuma teksnya: kunci yang dibuat lewat store harus
  //       benar-benar tercatat (dan rahasianya tidak bisa dibaca lagi), URL
  //       webhook yang tidak HTTPS harus ditolak sebelum disimpan, dan kiriman
  //       uji harus muncul di riwayat.
  {
    const { ApiPage } = await server.ssrLoadModule("/src/pages/ApiPage.tsx");
    const { App: AppRoot } = await server.ssrLoadModule("/src/App.tsx");

    withEnterpriseSession();
    const { text, newErrors } = await renderTree(
      providers(React.createElement(ApiPage, null)),
    );
    check(
      "halaman API & Webhook memuat kunci contoh",
      text.includes("Kunci API") &&
        text.includes("Server produksi") &&
        text.includes("mp_a9jcbf2jd6_"),
      text.slice(0, 400),
    );
    check(
      "kunci contoh ditampilkan dengan scope & statusnya",
      text.includes("Melihat laporan") &&
        text.includes("Melihat hutang usaha") &&
        text.includes("aktif") &&
        text.includes("dicabut") &&
        text.includes("tanpa kedaluwarsa"),
      text.slice(0, 600),
    );
    check(
      "endpoint webhook contoh tampil beserta langganan event-nya",
      text.includes("hooks.mesinpos.test") &&
        text.includes("rahasia penanda tangan") &&
        text.includes("Penjualan selesai") &&
        text.includes("Stok menipis") &&
        text.includes("Gudang pusat"),
      text.slice(0, 600),
    );
    check(
      "endpoint baca API didokumentasikan di halaman",
      text.includes("/api/v1/ping") &&
        text.includes("/api/v1/sales") &&
        text.includes("Authorization: Bearer") &&
        text.includes(".convex.site"),
      text.slice(0, 400),
    );
    check(
      "endpoint tulis POST /api/v1/sales didokumentasikan beserta scope tulisnya",
      text.includes("POST /api/v1/sales") &&
        text.includes("Pesanan masuk dari sistem luar") &&
        text.includes("Melakukan penjualan") &&
        text.includes("idempotencyKey") &&
        text.includes("tepat total"),
      text.slice(0, 600),
    );
    check(
      "contoh kiriman tulis memakai SKU dari contoh yang sah",
      // Contohnya datang dari aturan murni `lib/apiOrders.ts`, jadi halaman
      // tidak pernah mendokumentasikan bentuk yang ditolak servernya sendiri.
      text.includes('"sku": "KOPI-SUSU"') &&
        !text.includes('"amount"') &&
        text.includes("HTTP 200"),
      text.slice(0, 800),
    );
    check(
      "riwayat kiriman memuat status, percobaan, dan jadwal berikutnya",
      text.includes("Riwayat kiriman") &&
        text.includes("menunggu") &&
        text.includes("menyerah") &&
        text.includes("terkirim") &&
        text.includes("Penerima menjawab 503."),
      text.slice(0, 600),
    );
    check(
      "ringkasan menyebut kunci aktif & endpoint aktif",
      text.includes("2 kunci aktif") && text.includes("1 endpoint"),
      text.slice(0, 300),
    );
    check(
      "halaman API & Webhook tanpa error konsol",
      newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200),
    );

    // Aksi nyata lewat store: membuat kunci, menolak URL tidak HTTPS, mendaftar
    // endpoint, dan mengirim uji.
    function ApiAct() {
      const store = useStore();
      const step = React.useRef(0);
      const facts = React.useRef({});

      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;

        void (async () => {
          try {
            const created = await store.createApiKey({
              name: "Server Uji",
              scopes: ["payable.view", "payable.view"],
              expiresInDays: 30,
            });
            facts.current.kunci = created.plaintext.startsWith("mp_") ? "mp_" : "?";
            facts.current.scope = created.scopes.length;
            facts.current.keyId = created.id;
          } catch (error) {
            facts.current.kunci_error = error.message;
          }

          // Scope di luar izin pembuat tidak boleh lolos, walau namanya sah.
          try {
            await store.createApiKey({
              name: "Kunci Naik Kelas",
              scopes: ["billing.manage"],
              expiresInDays: 30,
            });
            facts.current.naik = "DITERIMA";
          } catch (error) {
            facts.current.naik = error.message;
          }

          try {
            await store.createApiKey({
              name: "Server Uji",
              scopes: ["report.view"],
              expiresInDays: 30,
            });
            facts.current.ganda = "DITERIMA";
          } catch (error) {
            facts.current.ganda = error.message;
          }

          try {
            await store.createWebhookEndpoint({
              url: "http://gudang.example.com/hook",
              events: ["sale.completed"],
            });
            facts.current.http = "DITERIMA";
          } catch (error) {
            facts.current.http = error.message;
          }

          let endpointId = null;
          try {
            const endpoint = await store.createWebhookEndpoint({
              url: "https://gudang.example.com/hook",
              events: ["stock.low", "sale.completed"],
            });
            endpointId = endpoint.id;
            facts.current.endpointId = endpoint.id;
            facts.current.ekor = endpoint.secret.slice(-4);
          } catch (error) {
            facts.current.endpoint_error = error.message;
          }

          if (endpointId) {
            try {
              const result = await store.testWebhookEndpoint(endpointId);
              facts.current.uji = result.status;

              // Endpoint nonaktif tidak boleh dikirimi uji, tetapi mematikannya
              // selalu boleh — itu cara menghentikan kiriman bermasalah.
              await store.updateWebhookEndpoint({ endpointId, active: false });
              try {
                await store.testWebhookEndpoint(endpointId);
                facts.current.nonaktif = "DITERIMA";
              } catch (error) {
                facts.current.nonaktif = error.message;
              }

              // Endpoint contoh dihapus beserta seluruh riwayat kirimannya.
              await store.removeWebhookEndpoint("wh-gudang");
            } catch (error) {
              facts.current.uji_error = error.message;
            }
          }

          // Mencabut kunci selalu boleh, dan kunci mati tidak bisa dicabut dua kali.
          if (facts.current.keyId) {
            try {
              await store.revokeApiKey(facts.current.keyId);
              try {
                await store.revokeApiKey(facts.current.keyId);
                facts.current.dobbel = "DITERIMA";
              } catch (error) {
                facts.current.dobbel = error.message;
              }
            } catch (error) {
              facts.current.cabut_error = error.message;
            }
          }
        })();
      }, [store]);

      // Angka yang berasal dari store dibaca saat render — setelah aksi di atas
      // — karena closure efek masih memegang state sebelum aksinya.
      const endpoint = store.webhookEndpoints.find(
        (row) => row.id === facts.current.endpointId,
      );
      const key = store.apiKeys.find((row) => row.id === facts.current.keyId);

      return React.createElement(
        "div",
        null,
        `kunci=${String(facts.current.kunci ?? "?")}` +
          ` scope=${String(facts.current.scope ?? "?")}` +
          ` kunci_error=${String(facts.current.kunci_error ?? "-").replace(/\s+/g, "_")}` +
          ` naik=${String(facts.current.naik ?? "-").replace(/\s+/g, "_")}` +
          ` ganda=${String(facts.current.ganda ?? "-").replace(/\s+/g, "_")}` +
          ` http=${String(facts.current.http ?? "-").replace(/\s+/g, "_")}` +
          ` endpoint_error=${String(facts.current.endpoint_error ?? "-").replace(/\s+/g, "_")}` +
          ` endpoint=${store.webhookEndpoints.length}` +
          ` terdaftar=${endpoint ? "ya" : "tidak"}` +
          ` rahasia=${
            endpoint && endpoint.secretLastFour === facts.current.ekor ? "cocok" : "beda"
          }` +
          ` dilanggan=${endpoint ? endpoint.events.length : "?"}` +
          ` aktif=${String(endpoint?.active ?? "?")}` +
          ` uji=${String(facts.current.uji ?? "?")}` +
          ` uji_error=${String(facts.current.uji_error ?? "-").replace(/\s+/g, "_")}` +
          ` nonaktif=${String(facts.current.nonaktif ?? "-").replace(/\s+/g, "_")}` +
          ` total_kunci=${store.apiKeys.length}` +
          ` status_kunci=${String(key?.status ?? "?")}` +
          ` pembuat=${String(key?.creatorRole ?? "?")}` +
          ` dobbel=${String(facts.current.dobbel ?? "-").replace(/\s+/g, "_")}` +
          ` riwayat=${store.webhookDeliveries.length}`,
      );
    }

    const act = await renderTree(providers(React.createElement(ApiAct, null)));
    const apiFacts = Object.fromEntries(
      [...act.text.matchAll(/([a-z_]+)=([^ ]+)/g)].map((match) => [match[1], match[2]]),
    );
    check(
      "kunci baru dibuat, rahasianya sekali tampil & scope ganda dibuang",
      apiFacts.kunci === "mp_" && apiFacts.scope === "1" && apiFacts.total_kunci === "4",
      JSON.stringify(apiFacts),
    );
    check(
      "scope di luar daftar API ditolak (billing.manage bukan scope kunci)",
      (apiFacts.naik ?? "").includes("di_luar_daftar_API"),
      apiFacts.naik,
    );
    check("nama kunci kembar ditolak", (apiFacts.ganda ?? "").includes("sudah_ada"), apiFacts.ganda);
    check(
      "endpoint HTTP biasa ditolak",
      (apiFacts.http ?? "").includes("HTTPS"),
      apiFacts.http,
    );
    check(
      "endpoint HTTPS terdaftar & rahasianya hanya tampil 4 karakter akhir",
      apiFacts.endpoint === "1" &&
        apiFacts.terdaftar === "ya" &&
        apiFacts.rahasia === "cocok" &&
        apiFacts.dilanggan === "2",
      JSON.stringify(apiFacts),
    );
    check(
      "kiriman uji tercatat & endpoint nonaktif menolak kiriman",
      apiFacts.uji === "delivered" &&
        apiFacts.aktif === "false" &&
        (apiFacts.nonaktif ?? "").includes("nonaktif"),
      JSON.stringify(apiFacts),
    );
    check(
      "hapus endpoint membuang riwayatnya, cabut kunci selalu boleh (sekali)",
      apiFacts.riwayat === "1" &&
        apiFacts.status_kunci === "revoked" &&
        apiFacts.pembuat === "owner" &&
        (apiFacts.dobbel ?? "").includes("sudah_dicabut") &&
        act.newErrors.length === 0,
      JSON.stringify(apiFacts),
    );

    // Paket Starter tidak memuat `api.access`: alasan yang tampil harus menyebut
    // paketnya, bukan menyuruh membuka halaman Modul.
    withEnterpriseSession("starter");
    const starter = await renderTree(providers(React.createElement(ApiPage, null)));
    check(
      "paket Starter melihat alasan API terkunci",
      starter.text.includes("API akses terkunci") &&
        starter.text.includes("tidak termasuk paket Starter"),
      starter.text.slice(0, 400),
    );

    // Kasir tidak memegang `api.manage`: rutenya ditolak dan menunya hilang.
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        ...ENTERPRISE_SESSION,
        tenant: { ...ENTERPRISE_SESSION.tenant, role: "cashier" },
      }),
    );
    // Rute `/app/api` sendiri yang dibuka: `providers` selalu mulai di `/app`,
    // jadi pohonnya disusun ulang dengan entri awal yang benar.
    const gated = await renderTree(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/app/api"] },
        React.createElement(
          SessionProvider,
          null,
          React.createElement(
            BackendProvider,
            null,
            React.createElement(StoreProvider, null, React.createElement(AppRoot, null)),
          ),
        ),
      ),
    );
    check(
      "kasir ditolak di rute API & menunya hilang",
      gated.text.includes("Akses ditolak") && !gated.text.includes("API & Webhook"),
      gated.text.slice(0, 300),
    );
    withoutSession();
  }

  // 3e-9. Dukungan khusus (`support.dedicated`, Phase 5): halaman Dukungan.
  //       Yang diuji bukan cuma teksnya: status SLA tiap tiket contoh harus
  //       terbaca berbeda (satu lewat janji, satu segera jatuh tempo, satu
  //       selesai tepat waktu), dan alur lewat store harus benar-benar membuat
  //       tiket, memindahkannya, menutupnya, lalu membukanya ulang.
  {
    const { SupportPage } = await server.ssrLoadModule("/src/pages/SupportPage.tsx");

    withEnterpriseSession();
    const { text, newErrors } = await renderTree(
      providers(React.createElement(SupportPage, null)),
    );
    check(
      "halaman Dukungan memuat janji SLA paket ini",
      text.includes("Dukungan khusus (Enterprise)") &&
        text.includes("Kanal langsung + manajer akun") &&
        text.includes("jalur cepat") &&
        text.includes("Eskalasi ke manajer akun aktif"),
      text.slice(0, 600),
    );
    check(
      "tiket contoh tampil beserta status & riwayatnya",
      text.includes("TKT-2026-0003") &&
        text.includes("Sedang ditangani") &&
        text.includes("Struk Bluetooth terputus") &&
        text.includes("Dieskalasi ke manajer akun."),
      text.slice(0, 800),
    );
    check(
      "status SLA dibedakan per tiket (lewat janji, segera jatuh tempo, tepat waktu)",
      text.includes("Lewat janji") &&
        text.includes("Segera jatuh tempo") &&
        text.includes("Tepat waktu") &&
        text.includes("Selesai dalam janji"),
      text.slice(0, 900),
    );
    check(
      "ringkasan menyebut tiket berjalan, lewat janji, dan yang pernah dieskalasi",
      text.includes("Tiket berjalan") &&
        text.includes("pernah dieskalasi") &&
        text.includes("Tenggat terdekat"),
      text.slice(0, 500),
    );
    check(
      "halaman Dukungan tanpa error konsol",
      newErrors.length === 0,
      newErrors.join(" | ").slice(0, 200),
    );

    withoutSession();
    const starter = await renderTree(
      providers(React.createElement(SupportPage, null)),
    );
    check(
      "paket tanpa fiturnya menjelaskan bahwa halaman Dukungan hanya bisa dibaca",
      starter.text.includes("tidak termasuk paket Starter") &&
        starter.text.includes("hanya bisa dibaca") &&
        starter.text.includes("membuka tiket baru") &&
        starter.text.includes("Tiket tenant ini"),
      starter.text.slice(0, 500),
    );
  }

  // 3e-9-1. Aksi tiket lewat store (`support.dedicated`, Phase 5): alur nyata
  //          — buat, mulai ditangani, catat, tutup, buka ulang — plus penolakan
  //          yang seharusnya memang ditolak.
  {
    function SupportAct() {
      const store = useStore();
      const facts = React.useRef({});
      const step = React.useRef(0);

      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;

        void (async () => {
          try {
            const created = await store.createSupportTicket({
              subject: "Uji tiket dari harness render",
              category: "bug",
              priority: "urgent",
              body: "Dibuat harness render untuk memeriksa alur tiket dukungan.",
            });
            facts.current.created = `${created.number}/${created.slaHours}`;
            facts.current.ticketId = created.id;
          } catch (error) {
            facts.current.createdError = error.message;
          }

          try {
            await store.createSupportTicket({
              subject: "ak",
              category: "bug",
              priority: "normal",
              body: "Dibuat harness render untuk memeriksa validasi subjek.",
            });
            facts.current.subject = "DITERIMA";
          } catch (error) {
            facts.current.subject = error.message;
          }

          if (!facts.current.ticketId) return;

          try {
            await store.actSupportTicket({ ticketId: facts.current.ticketId, action: "start" });
            await store.actSupportTicket({
              ticketId: facts.current.ticketId,
              action: "note",
              note: "Sudah dicek bersama tim kasir cabang.",
            });
            await store.actSupportTicket({
              ticketId: facts.current.ticketId,
              action: "resolve",
              note: "Printer diganti dan diuji 10 transaksi.",
            });
            await store.actSupportTicket({
              ticketId: facts.current.ticketId,
              action: "reopen",
              note: "Muncul lagi setelah 10 menit.",
            });
          } catch (error) {
            facts.current.actError = error.message;
          }

          // Catatan yang tidak memenuhi panjang minimum ditolak aturan murni.
          try {
            await store.actSupportTicket({
              ticketId: facts.current.ticketId,
              action: "note",
              note: "x",
            });
            facts.current.note = "DITERIMA";
          } catch (error) {
            facts.current.note = error.message;
          }
        })();
      }, [store]);

      const ticket = store.supportTickets.find((row) => row.id === facts.current.ticketId);
      const clean = (value) => String(value ?? "-").replace(/\s+/g, "_");

      return React.createElement(
        "div",
        null,
        `created=${clean(facts.current.created)}` +
          ` createdError=${clean(facts.current.createdError)}` +
          ` subject=${clean(facts.current.subject)}` +
          ` note=${clean(facts.current.note)}` +
          ` actError=${clean(facts.current.actError)}` +
          ` status=${clean(ticket?.status)}` +
          ` log=${String(ticket?.log.length ?? "-")}` +
          ` escalated=${String(ticket?.escalated ?? "-")}`,
      );
    }

    // Fitur jalur cepat harus hidup: nomor tiket, SLA prioritas, dan eskalasi
    // semuanya mengikuti paket + fitur tenant ini.
    withEnterpriseSession();
    const act = await renderTree(providers(React.createElement(SupportAct, null)));
    withoutSession();
    check(
      "membuat tiket lewat store menetapkan nomor & janji tanggap prioritasnya",
      /created=TKT-\d{4}-\d{4}\/2/.test(act.text),
      act.text.slice(0, 200),
    );
    check(
      "subjek yang terlalu pendek ditolak dengan alasan yang terbaca",
      act.text.includes("subject=Subjek_harus"),
      act.text.slice(0, 300),
    );
    check(
      "tiket bisa ditangani, dicatat, ditutup, lalu dibuka ulang",
      act.text.includes("status=open") &&
        act.text.includes("actError=-") &&
        /log=[4-9]/.test(act.text),
      act.text.slice(0, 300),
    );
    check(
      "catatan yang tidak memenuhi panjang minimum ditolak",
      act.text.includes("note=Catatan_harus"),
      act.text.slice(0, 300),
    );
  }

  // 3e-10. Pembayaran digital (`payment.digital`, Phase 6): halaman Pembayaran.
  //        Yang diuji bukan cuma teksnya: status tiap tagihan contoh harus
  //        terbaca berbeda (satu menunggu, satu lunas, satu kedaluwarsa), dan
  //        alur lewat store harus benar-benar membuat, menolak nominal yang
  //        salah, melunasi, lalu menolak pembatalan tagihan yang sudah lunas.
  {
    const { PaymentsPage } = await server.ssrLoadModule("/src/pages/PaymentsPage.tsx");

    withEnterpriseSession("professional");
    // Halaman ini diuji lewat DOM (bukan hanya teksnya): daftar tagihan menggambar
    // kode QR untuk tagihan QRIS yang menunggu, jadi harness harus bisa memeriksa
    // elemen SVG yang benar-benar dirender.
    const page = await renderInteractive(
      providers(React.createElement(PaymentsPage, null)),
    );
    const text = page.text();
    check(
      "halaman Pembayaran memuat kanal QRIS/VA beserta umurnya",
      text.includes("Pembayaran digital (QRIS / VA)") &&
        text.includes("QRIS berumur 5 menit") &&
        text.includes("24 jam"),
      text.slice(0, 600),
    );
    check(
      "tagihan contoh tampil beserta status efektifnya",
      text.includes("DIG-2026-0002") &&
        text.includes("Lunas") &&
        text.includes("Kedaluwarsa") &&
        text.includes("Virtual Account"),
      text.slice(0, 900),
    );
    check(
      "ringkasan memisahkan nominal menunggu dari yang sudah masuk",
      text.includes("Menunggu dibayar") &&
        text.includes("Segera kedaluwarsa") &&
        text.includes("Kanal tagih digital aktif"),
      text.slice(0, 600),
    );
    // Kode QR harus muncul untuk tagihan QRIS yang **menunggu** (DIG-2026-0003),
    // lengkap dengan payload-nya di DOM, dan **tidak** untuk tagihan yang sudah
    // kedaluwarsa (DIG-2026-0001) — kode kedaluwarsa hanya menyesatkan pemindai.
    const qrNodes = page.queryAll("svg[data-qr-value]");
    check(
      "halaman Pembayaran menggambar kode QR tagihan QRIS yang menunggu",
      qrNodes.length === 1 &&
        (qrNodes[0].getAttribute("data-qr-value") ?? "").includes("DIG-2026-0003") &&
        qrNodes[0].querySelector("path")?.getAttribute("d")?.startsWith("M") === true,
      `${qrNodes.length} svg · ${qrNodes.map((n) => n.getAttribute("data-qr-value")).join(" | ")}`,
    );
    check(
      "tagihan QRIS yang sudah kedaluwarsa tidak digambari kode QR",
      !qrNodes.some((node) =>
        (node.getAttribute("data-qr-value") ?? "").includes("DIG-2026-0001"),
      ),
      qrNodes.map((n) => n.getAttribute("data-qr-value")).join(" | "),
    );
    check(
      "halaman Pembayaran tanpa error konsol",
      page.newErrors().length === 0,
      page.newErrors().join(" | ").slice(0, 200),
    );
    await page.unmount();

    withoutSession();
    const starter = await renderTree(
      providers(React.createElement(PaymentsPage, null)),
    );
    check(
      "paket tanpa fiturnya menjelaskan halaman Pembayaran hanya bisa dibaca",
      starter.text.includes("tidak termasuk paket Starter") &&
        starter.text.includes("hanya bisa dibaca") &&
        starter.text.includes("melunasi") &&
        starter.text.includes("Tagihan tenant ini"),
      starter.text.slice(0, 500),
    );
  }

  // 3e-10-1. Aksi tagihan lewat store (`payment.digital`, Phase 6): buat, tolak
  //           nominal yang tidak pas, lunasi, lalu tolak pembatalannya.
  {
    function PaymentsAct() {
      const store = useStore();
      const facts = React.useRef({});
      const step = React.useRef(0);

      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;

        void (async () => {
          try {
            const created = await store.createDigitalCharge({
              amount: 47_000,
              method: "qris",
              reference: "Uji harness render",
            });
            facts.current.created = created.number;
            facts.current.chargeId = created.id;
          } catch (error) {
            facts.current.createdError = error.message;
          }

          if (!facts.current.chargeId) return;

          try {
            await store.actDigitalCharge({
              chargeId: facts.current.chargeId,
              action: "settle",
              amount: 40_000,
            });
            facts.current.mismatch = "DITERIMA";
          } catch (error) {
            facts.current.mismatch = error.message;
          }

          try {
            await store.actDigitalCharge({
              chargeId: facts.current.chargeId,
              action: "settle",
              amount: 47_000,
            });
            facts.current.settled = "ok";
          } catch (error) {
            facts.current.settled = error.message;
          }

          try {
            await store.actDigitalCharge({
              chargeId: facts.current.chargeId,
              action: "cancel",
            });
            facts.current.cancelPaid = "DITERIMA";
          } catch (error) {
            facts.current.cancelPaid = error.message;
          }

          try {
            await store.createDigitalCharge({ amount: 47_000, method: "qris", bank: "bca" });
            facts.current.bank = "DITERIMA";
          } catch (error) {
            facts.current.bank = error.message;
          }
        })();
      }, [store]);

      const charge = store.digitalCharges.find(
        (row) => row.id === facts.current.chargeId,
      );
      const clean = (value) => String(value ?? "-").replace(/\s+/g, "_");

      return React.createElement(
        "div",
        null,
        `created=${clean(facts.current.created)}` +
          ` createdError=${clean(facts.current.createdError)}` +
          ` mismatch=${clean(facts.current.mismatch)}` +
          ` settled=${clean(facts.current.settled)}` +
          ` cancelPaid=${clean(facts.current.cancelPaid)}` +
          ` bank=${clean(facts.current.bank)}` +
          ` status=${clean(charge?.status)}`,
      );
    }

    withEnterpriseSession("professional");
    const act = await renderTree(providers(React.createElement(PaymentsAct, null)));
    withoutSession();
    check(
      "membuat tagihan lewat store menetapkan nomor DIG-…",
      /created=DIG-\d{4}-\d{4}/.test(act.text),
      act.text.slice(0, 200),
    );
    check(
      "pelunasan dengan nominal berbeda ditolak & menyebut angkanya",
      act.text.includes("mismatch=Pelunasan_harus"),
      act.text.slice(0, 300),
    );
    check(
      "tagihan bisa dilunasi lalu tidak bisa dibatalkan",
      act.text.includes("settled=ok") &&
        act.text.includes("status=paid") &&
        act.text.includes("cancelPaid=Tagihan"),
      act.text.slice(0, 400),
    );
    check(
      "QRIS dengan bank penerbit ditolak",
      act.text.includes("bank=QRIS_tidak"),
      act.text.slice(0, 400),
    );
  }

  // 3e-10-2. Kasir menagih QRIS **langsung dari keranjang** (`payment.digital`).
  //           Ini diuji lewat tombol yang benar-benar ditekan kasir — pilih
  //           produk → Bayar → QRIS → terbitkan tagihan → "Pembayaran diterima" —
  //           karena justru penyambungannya yang diperiksa: selama tagihannya
  //           menunggu, **belum ada** penjualan yang tercatat; setelah lunas, satu
  //           penjualan tercatat dan menunjuk tagihan yang sama (dan tagihannya
  //           menunjuk balik ke nota itu).
  {
    const facts = {};

    function CartProbe() {
      const store = useStore();
      facts.store = store;
      facts.products = store.products.map((product) => ({
        id: product.id,
        name: product.name,
        stock: product.stock,
        modifiers: product.modifiers?.length ?? 0,
      }));
      facts.sales = store.sales.length;
      facts.lastSale = store.sales[0];
      facts.charges = store.digitalCharges;
      return null;
    }

    withEnterpriseSession("professional");
    const ui = await renderInteractive(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(PosPage, null),
          React.createElement(CartProbe, null),
        ),
      ),
    );

    const sellable = (facts.products ?? []).find(
      (product) => product.modifiers === 0 && product.stock > 0,
    );
    check(
      "ada produk tanpa modifier untuk menguji keranjang",
      Boolean(sellable),
      JSON.stringify(facts.products).slice(0, 200),
    );

    await ui.click(sellable.name);
    await ui.click("Bayar");
    await ui.click("QRIS");
    check(
      "memilih QRIS memunculkan jalur tagih dari keranjang",
      ui.text().includes("Tagih QRIS dari keranjang") &&
        ui.text().includes("Terbitkan tagihan"),
      ui.text().slice(-600),
    );

    const salesBefore = facts.sales;
    await ui.click("Terbitkan tagihan");
    const issued = facts.charges[0];
    check(
      "tagihan QRIS terbit bernomor dan tercatat di store",
      /DIG-\d{4}-\d{4}/.test(ui.text()) &&
        issued?.method === "qris" &&
        issued?.status === "pending" &&
        issued?.amount > 0,
      `${ui.text().slice(-400)} | ${JSON.stringify(issued)}`,
    );
    check(
      "tagihan menyebut keterangan keranjangnya",
      typeof issued?.reference === "string" && issued.reference.startsWith("POS · "),
      String(issued?.reference),
    );
    // Dialog kasir harus menggambar kode QR sungguhan (SVG dari matriks QR),
    // bukan sekadar menempelkan payload teksnya: yang dipindai pelanggan adalah
    // gambarnya, jadi inilah artefak yang diperiksa.
    const qrSvg = ui.query("svg[data-qr-value]");
    check(
      "dialog kasir menggambar kode QR tagihan (bukan cuma payload teks)",
      Boolean(qrSvg) &&
        qrSvg.getAttribute("data-qr-value") === issued.qrPayload &&
        qrSvg.querySelector("path")?.getAttribute("d")?.startsWith("M") === true,
      qrSvg ? qrSvg.getAttribute("data-qr-value") : "svg[data-qr-value] tidak ada",
    );
    check(
      "penjualan belum tercatat selama tagihannya menunggu",
      facts.sales === salesBefore && ui.text().includes("Pembayaran diterima"),
      `sales=${facts.sales} sebelum=${salesBefore}`,
    );

    await ui.click("Pembayaran diterima");
    check(
      "setelah lunas, satu penjualan QRIS tercatat sebesar tagihannya",
      facts.sales === salesBefore + 1 &&
        facts.lastSale?.method === "QRIS" &&
        facts.lastSale?.total === issued.amount,
      JSON.stringify(facts.lastSale),
    );
    check(
      "tagihan dan penjualan menunjuk satu sama lain",
      facts.charges[0]?.status === "paid" &&
        facts.charges[0]?.saleNumber === facts.lastSale?.number &&
        ui.text().includes(`QRIS ${issued.number}`),
      `${JSON.stringify(facts.charges[0])} | ${String(facts.lastSale?.number)}`,
    );

    // Store demo menegakkan aturan yang sama dengan server: penjualan yang
    // menunjuk tagihan belum lunas — atau tagihan yang nominalnya lain — ditolak.
    let unpaid = "-";
    let mismatch = "-";
    await React.act(async () => {
      const big = await facts.store.createDigitalCharge({
        amount: 500_000,
        method: "qris",
      });
      try {
        await facts.store.createSale({
          items: [{ productId: sellable.id, quantity: 1 }],
          discount: 0,
          method: "QRIS",
          digitalChargeId: big.id,
        });
        unpaid = "DITERIMA";
      } catch (error) {
        unpaid = error.message;
      }
      await facts.store.actDigitalCharge({
        chargeId: big.id,
        action: "settle",
        amount: 500_000,
      });
      try {
        await facts.store.createSale({
          items: [{ productId: sellable.id, quantity: 1 }],
          discount: 0,
          method: "QRIS",
          digitalChargeId: big.id,
        });
        mismatch = "DITERIMA";
      } catch (error) {
        mismatch = error.message;
      }
    });
    check(
      "penjualan yang menunjuk tagihan belum lunas ditolak",
      unpaid.includes("Menunggu pembayaran"),
      unpaid,
    );
    check(
      "penjualan dengan total berbeda dari tagihannya ditolak & menyebut keduanya",
      mismatch.includes("500.000") && mismatch.includes("tidak sama"),
      mismatch,
    );

    check(
      "POS tanpa error konsol sepanjang alur tagih",
      ui.newErrors().length === 0,
      ui.newErrors().join(" | ").slice(0, 300),
    );
    await ui.unmount();
  }

  // 3e-10-2b. Tombol pecahan uang di pembayaran tunai: kasir menekan nominal yang
  //           diserahkan pembeli — Rp 10.000, 20.000, 50.000, 100.000, 500.000 —
  //           alih-alih mengetiknya. Yang diperiksa adalah akibat nyatanya: kolom
  //           “Uang diterima”, baris “Kembalian”, struk yang sedang disusun, dan
  //           tombol simpan yang baru terbuka saat uangnya cukup. Produk termurah
  //           di atas Rp 10.000 sengaja dipakai supaya Rp 10.000 pasti **kurang**
  //           dan Rp 100.000 pasti **cukup** — justru kedua batas itu yang diuji.
  {
    const { formatIDR } = await server.ssrLoadModule("/src/lib/utils.ts");
    const PECAHAN = [10_000, 20_000, 50_000, 100_000, 500_000];
    const rapi = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const angka = (value) => Number(String(value ?? "").replace(/[^\d]/g, ""));
    const titik = (value) => value.toLocaleString("id-ID");

    /*
      Dialog cetak peramban tidak ada di DOM tiruan; yang diuji adalah **kapan**
      halaman memanggil `window.print()` — otomatis sesudah pembayaran lunas dan
      saat tombol Cetak ditekan — sama polanya dengan pemutar bip kasir yang
      ditukar di uji lain.
    */
    const cetakan = [];
    const printAsli = window.print;
    Object.defineProperty(window, "print", {
      configurable: true,
      writable: true,
      value: () => cetakan.push(Date.now()),
    });

    const kas = {};
    function CashProbe() {
      const store = useStore();
      kas.products = store.products.map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        stock: product.stock,
        modifiers: product.modifiers?.length ?? 0,
      }));
      kas.sales = store.sales.length;
      kas.lastSale = store.sales[0];
      return null;
    }

    withEnterpriseSession("professional");
    const ui = await renderInteractive(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(PosPage, null),
          React.createElement(CashProbe, null),
        ),
      ),
    );

    const pilihan = (kas.products ?? [])
      .filter(
        (product) =>
          product.modifiers === 0 &&
          product.stock > 0 &&
          product.price > 10_000 &&
          product.price < 100_000,
      )
      .sort((a, b) => a.price - b.price)[0];
    check(
      "ada produk untuk menguji tombol pecahan uang",
      Boolean(pilihan),
      JSON.stringify(kas.products).slice(0, 240),
    );

    await ui.click(pilihan.name);
    /*
      Gerbang alur struk: cetak & kirim hanya milik penjualan yang **sudah
      lunas**. Sebelum pembayarannya, panel keranjang tidak menawarkan keduanya —
      yang tersedia cuma jalan menuju pembayaran.
    */
    check(
      "keranjang yang belum dibayar belum menawarkan Cetak / Struk & kirim",
      !ui.query('button[aria-label="Cetak struk"]') &&
        !ui.query('button[aria-label="Struk & kirim"]') &&
        !ui.query('[data-testid="struk-lunas-catatan"]'),
      ui
        .queryAll("button")
        .map((row) => rapi(row.getAttribute("aria-label")) || rapi(row.textContent))
        .join(" | ")
        .slice(0, 200),
    );
    await ui.click("Bayar");

    const chip = (amount) => ui.query(`[data-testid="cash-cepat-${amount}"]`);
    const tombolPecahan = ui.queryAll('[data-testid^="cash-cepat-"]');
    const tombolSimpan = () =>
      ui.queryAll("button").find((row) => rapi(row.textContent).includes("Selesaikan pembayaran"));
    const nilaiUang = () => Number(ui.query("#cash")?.value ?? "0");
    const kembalian = () => {
      const baris = ui.queryAll("div").find((row) =>
        rapi(row.textContent).startsWith("Kembalian"),
      );
      const kolom = baris ? [...baris.querySelectorAll("span")] : [];
      return rapi(kolom[kolom.length - 1]?.textContent);
    };

    check(
      "dialog tunai menawarkan lima pecahan uang: Rp 10.000, 20.000, 50.000, 100.000, 500.000",
      tombolPecahan.length === PECAHAN.length &&
        PECAHAN.every(
          (amount, index) =>
            tombolPecahan[index].getAttribute("data-testid") === `cash-cepat-${amount}` &&
            rapi(tombolPecahan[index].textContent) === rapi(formatIDR(amount)),
        ),
      `${tombolPecahan.length} tombol: ${tombolPecahan.map((row) => rapi(row.textContent)).join(" · ")}`,
    );
    check(
      "belum ada pecahan yang aktif selama kasir belum menekan apa pun",
      tombolPecahan.every((row) => row.getAttribute("aria-pressed") === "false"),
      tombolPecahan.map((row) => row.getAttribute("aria-pressed")).join(","),
    );

    await ui.clickOn('[data-testid="cash-cepat-10000"]');
    check(
      "menekan Rp 10.000 mengisi kolom Uang diterima dan menandai pilihannya aktif",
      nilaiUang() === 10_000 &&
        chip(10_000)?.getAttribute("aria-pressed") === "true" &&
        PECAHAN.filter((amount) => amount !== 10_000).every(
          (amount) => chip(amount)?.getAttribute("aria-pressed") === "false",
        ),
      `${nilaiUang()} · ${PECAHAN.map((amount) => chip(amount)?.getAttribute("aria-pressed")).join(",")}`,
    );
    check(
      "uang Rp 10.000 belum cukup: kembalian Rp 0 dan tombol simpan masih terkunci",
      kembalian() === rapi(formatIDR(0)) && tombolSimpan()?.disabled === true,
      `${kembalian()} · disabled=${String(tombolSimpan()?.disabled)}`,
    );

    await ui.clickOn('[data-testid="cash-cepat-100000"]');
    const kembali = angka(kembalian());
    const total = 100_000 - kembali;
    check(
      "menekan Rp 100.000 (di atas total) membuka tombol simpan dengan kembalian 100.000 - total",
      nilaiUang() === 100_000 &&
        kembali > 0 &&
        kembali < 100_000 &&
        tombolSimpan()?.disabled === false,
      `kembalian=${kembali} · total=${total} · disabled=${String(tombolSimpan()?.disabled)}`,
    );

    const struk = rapi(ui.query('[data-testid="struk-cetak-lembar-1"]')?.textContent);
    check(
      "struk yang sedang disusun memakai pilihan itu: TOTAL, Bayar 100.000, dan kembaliannya",
      struk.includes("TOTAL") &&
        struk.includes("Bayar") &&
        struk.includes("Kembali") &&
        struk.includes(titik(100_000)) &&
        struk.includes(titik(kembali)) &&
        struk.includes(titik(total)),
      struk.split("\n").filter((line) => /TOTAL|Bayar|Kembali/.test(line)).join(" | "),
    );

    await ui.fill("#cash", "55000");
    check(
      "kolom Uang diterima tetap bisa diketik sendiri (tombol hanya mengisi, bukan mengunci)",
      nilaiUang() === 55_000 &&
        kembalian() === rapi(formatIDR(Math.max(0, 55_000 - total))),
      `${nilaiUang()} · ${kembalian()}`,
    );

    const penjualanSebelum = kas.sales;
    await ui.clickOn('[data-testid="cash-cepat-100000"]');
    await ui.click("Selesaikan pembayaran");
    check(
      "menyelesaikan pembayaran tunai mencatat satu penjualan Tunai sebesar totalnya",
      kas.sales === penjualanSebelum + 1 &&
        kas.lastSale?.method === "Tunai" &&
        kas.lastSale?.total === total,
      `${penjualanSebelum} → ${kas.sales} · ${JSON.stringify(kas.lastSale)}`,
    );
    /*
      Sesudah lunas yang terbuka adalah **dialog struk**, bukan dialog cetak: di
      sana kasir memilih cetak, unduh PDF, atau kirim ke WhatsApp member. Karena
      itu `window.print()` **belum** boleh terpanggil sampai tombol Cetak ditekan.
    */
    const dialog = () => ui.query('[data-testid="struk-dialog"]');
    check(
      "pembayaran lunas membuka dialog struk dengan pilihan cetak, unduh PDF, dan kirim WhatsApp",
      Boolean(dialog()) &&
        cetakan.length === 0 &&
        rapi(dialog()?.textContent).includes("Cetak lewat dialog peramban") &&
        Boolean(ui.query('[data-testid="struk-unduh-pdf"]')) &&
        Boolean(ui.query('[data-testid="struk-kirim-wa"]')),
      `dialog=${Boolean(dialog())} cetakan=${cetakan.length} · ${rapi(dialog()?.textContent).slice(0, 120)}`,
    );
    /*
      DOM tiruan (happy-dom) tidak punya WebUSB maupun Web Bluetooth, jadi di sini
      yang benar-benar terjadi adalah keadaan peramban tanpa jalur cetak langsung:
      kasir diberi tahu sebabnya dan tetap bisa mencetak lewat dialog peramban.
      Jalur langsungnya sendiri diuji di Chromium (`verify-escpos-browser.mjs`).
    */
    check(
      "tanpa WebUSB/Web Bluetooth, dialog struk menjelaskan sebabnya & menyebut Chrome/Edge",
      rapi(ui.query('[data-testid="struk-tanpa-escpos"]')?.textContent).includes("Chrome") &&
        !ui.query('[data-testid="struk-cetak-langsung"]') &&
        !ui.query('[data-testid="struk-printer"]'),
      rapi(ui.query('[data-testid="struk-tanpa-escpos"]')?.textContent).slice(0, 120),
    );
    check(
      "pembayaran lunas memunculkan Cetak & Struk & kirim di panel, beserta catatan nota yang dibayar",
      Boolean(ui.query('button[aria-label="Cetak struk"]')) &&
        Boolean(ui.query('button[aria-label="Struk & kirim"]')) &&
        rapi(ui.query('[data-testid="struk-lunas-catatan"]')?.textContent).includes(
          String(kas.lastSale?.number),
        ),
      rapi(ui.query('[data-testid="struk-lunas-catatan"]')?.textContent),
    );

    const strukSetelahBayar = rapi(
      ui.query('[data-testid="struk-cetak-lembar-1"]')?.textContent,
    );
    check(
      "dialognya menyebut struk penjualan yang baru lunas, bukan keranjang kosong",
      rapi(dialog()?.textContent).includes(String(kas.lastSale?.number)) &&
        strukSetelahBayar.includes(String(kas.lastSale?.number)) &&
        strukSetelahBayar.includes(pilihan.name) &&
        strukSetelahBayar.includes("TOTAL") &&
        strukSetelahBayar.includes("Bayar") &&
        strukSetelahBayar.includes(titik(100_000)) &&
        !strukSetelahBayar.includes("Belum dibayar"),
      strukSetelahBayar.slice(0, 160),
    );

    /*
      Unduh PDF: berkasnya dibuat di halaman ini (aturan murni `@/lib/receiptPdf`),
      lalu diserahkan ke peramban sebagai unduhan. DOM tiruan tidak punya folder
      unduhan, jadi yang diperiksa adalah laporan hasilnya — nama berkasnya memakai
      nomor notanya — sedangkan isi berkasnya diperiksa `verify-receipt-pdf.mjs`.
    */
    await ui.clickOn('[data-testid="struk-unduh-pdf"]');
    const laporanUnduh = rapi(ui.query('[data-testid="struk-notice"]')?.textContent);
    check(
      "menekan Unduh PDF membuat berkas struk bernama nomor notanya dan melaporkan ukurannya",
      laporanUnduh.includes(`struk-${kas.lastSale?.number}.pdf`) &&
        /KB/.test(laporanUnduh) &&
        !ui.query('[data-testid="struk-error"]'),
      laporanUnduh,
    );

    /*
      Daftar PDF: berkas yang barusan diunduh harus **bisa dibuka lagi** dari
      dialog, bukan cuma tersimpan di folder unduhan peramban yang tidak dijangkau
      halaman. Tombolnya tertutup dulu, lalu membuka daftar berisi satu berkas
      dengan tautan `blob:` yang masih hidup — bukan sekadar namanya.
    */
    const tombolDaftarPdf = () => ui.query('[data-testid="struk-daftar-pdf-tombol"]');
    check(
      "dialog struk menyediakan tombol daftar PDF, dan daftarnya masih tertutup",
      Boolean(tombolDaftarPdf()) &&
        tombolDaftarPdf()?.getAttribute("aria-expanded") === "false" &&
        !ui.query('[data-testid="struk-daftar-pdf-lembar"]') &&
        rapi(tombolDaftarPdf()?.textContent).includes("Daftar PDF struk (1)"),
      rapi(tombolDaftarPdf()?.textContent),
    );
    await ui.clickOn('[data-testid="struk-daftar-pdf-tombol"]');
    const itemPdf = ui.queryAll('[data-testid="struk-daftar-pdf-item"]');
    check(
      "membuka daftarnya memperlihatkan berkas PDF yang dibuat, lengkap dengan tautan blob-nya",
      Boolean(ui.query('[data-testid="struk-daftar-pdf-lembar"]')) &&
        itemPdf.length === 1 &&
        rapi(itemPdf[0]?.textContent).includes(`struk-${kas.lastSale?.number}.pdf`) &&
        String(itemPdf[0]?.getAttribute("href") ?? "").startsWith("blob:"),
      `${itemPdf.length} berkas · ${itemPdf[0]?.getAttribute("href")}`,
    );
    await ui.clickOn('[data-testid="struk-daftar-pdf-tombol"]');
    check(
      "menekan tombolnya sekali lagi menutup daftarnya kembali",
      tombolDaftarPdf()?.getAttribute("aria-expanded") === "false" &&
        !ui.query('[data-testid="struk-daftar-pdf-lembar"]'),
      `aria-expanded=${tombolDaftarPdf()?.getAttribute("aria-expanded")}`,
    );

    /*
      Kirim struk **pembeli umum** (penjualan tanpa member sama sekali): dulu ini
      jalan buntu karena tidak ada data member yang bisa dibaca. Sekarang dialog
      struknya menawarkan **kolom nomor pembeli** — nomor yang belum sah ditolak
      beserta sebabnya, dan mengirim tanpa mengisi nomornya ditahan dengan
      petunjuk yang menyebut kolomnya, bukan dicoba ke nomor tebakan.
    */
    check(
      "struk pembeli umum diberi kolom nomor WA untuk pembelinya, bukan cuma diberi tahu bahwa tak ada tujuan",
      Boolean(ui.query('[data-testid="struk-nomor-wa"]')) &&
        rapi(ui.query('[data-testid="struk-nomor-wa-kotak"]')?.textContent).includes(
          "Nomor WhatsApp pembeli",
        ) &&
        !ui.query('[data-testid="struk-dialog-member"]') &&
        rapi(ui.query('[data-testid="struk-pembeli-umum"]')?.textContent).includes(
          "pembeli umum",
        ),
      rapi(ui.query('[data-testid="struk-nomor-wa-kotak"]')?.textContent).slice(0, 140),
    );
    await ui.clickOn('[data-testid="struk-kirim-wa"]');
    const galatTanpaNomorUmum = rapi(ui.query('[data-testid="struk-error"]')?.textContent);
    check(
      "mengirim struk pembeli umum tanpa nomor ditolak dengan petunjuk mengisi kolomnya",
      galatTanpaNomorUmum.includes("pembeli umum") &&
        galatTanpaNomorUmum.includes("Nomor WhatsApp pembeli"),
      galatTanpaNomorUmum,
    );
    await ui.fill('[data-testid="struk-nomor-wa"]', "0821");
    await ui.clickOn('[data-testid="struk-kirim-wa"]');
    check(
      "nomor pembeli umum yang belum lengkap ditolak dengan alasannya, bukan dipakai apa adanya",
      rapi(ui.query('[data-testid="struk-nomor-wa-galat"]')?.textContent).includes(
        "8–15 digit",
      ) &&
        !rapi(ui.query('[data-testid="struk-notice"]')?.textContent).includes("terkirim"),
      rapi(ui.query('[data-testid="struk-nomor-wa-galat"]')?.textContent),
    );
    await ui.fill('[data-testid="struk-nomor-wa"]', "0821-1111-2222");
    await ui.clickOn('[data-testid="struk-kirim-wa"]');
    const kirimPembeliUmum = rapi(ui.query('[data-testid="struk-notice"]')?.textContent);
    /*
      Nomor pembeli umum yang sah sudah lolos semua pemeriksaan halaman, jadi yang
      tersisa di DOM tiruan ini hanya ketiadaan kanvas — dan itu harus dikatakan apa
      adanya, bukan berubah menjadi klaim terkirim. Kiriman yang benar terjadi
      diperiksa di Chromium (`verify-struk-browser.mjs`) dan di `verify-backend.mjs`.
    */
    check(
      "nomor pembeli umum yang sah tidak lagi ditolak soal penerimanya: sebabnya kini ketiadaan kanvas, dan itu disebut",
      kirimPembeliUmum.includes("tidak bisa menggambar struk jadi gambar") &&
        kirimPembeliUmum.includes("Unduh PDF") &&
        !kirimPembeliUmum.includes("terkirim") &&
        !ui.query('[data-testid="struk-error"]'),
      kirimPembeliUmum,
    );

    await ui.clickOn('[data-testid="struk-cetak-dialog"]');
    check(
      "menekan Cetak lewat dialog peramban memanggil dialog cetak peramban sekali",
      cetakan.length === 1,
      `cetakan=${cetakan.length}`,
    );

    await ui.click("Tutup");
    check(
      "menutup dialog struk tidak menghapus struk penjualan terakhir",
      !dialog() &&
        rapi(ui.query('[data-testid="struk-cetak-lembar-1"]')?.textContent).includes(
          String(kas.lastSale?.number),
        ),
      `dialog=${Boolean(dialog())}`,
    );

    await ui.clickOn('button[aria-label="Cetak struk"]');
    check(
      "tombol Cetak struk tetap hidup sesudah dibayar & mencetak ulang struk yang sama",
      cetakan.length === 2,
      `cetakan=${cetakan.length}`,
    );

    await ui.click(pilihan.name);
    const strukKeranjangBaru = rapi(
      ui.query('[data-testid="struk-cetak-lembar-1"]')?.textContent,
    );
    check(
      "keranjang berikutnya yang belum dibayar tidak menggantikan struknya: yang tersisa tetap nota yang sudah lunas",
      strukKeranjangBaru.includes(String(kas.lastSale?.number)) &&
        !strukKeranjangBaru.includes("Belum dibayar") &&
        (ui.query('button[aria-label="Cetak struk"]')?.title ?? "").includes(
          String(kas.lastSale?.number),
        ) &&
        cetakan.length === 2,
      `${strukKeranjangBaru.slice(0, 120)} · ${ui.query('button[aria-label="Cetak struk"]')?.title ?? "(tanpa tombol)"}`,
    );

    /*
      Kirim struk ke WhatsApp member, lengkap dengan dua keadaannya: member yang
      belum mengisi nomor (ditahan beserta alasannya) dan member yang sudah punya
      nomor (mode demo menyimulasikannya, dan menyebutkan nomornya tersensor).
    */
    async function bayarUntukMember(nama) {
      await ui.fill('[aria-label="Cari member"]', nama);
      await ui.click(nama);
      await ui.click(pilihan.name);
      await ui.click("Bayar");
      await ui.clickOn('[data-testid="cash-cepat-100000"]');
      await ui.click("Selesaikan pembayaran");
    }

    await bayarUntukMember("Rina Kartika");
    check(
      "member tanpa nomor WA: dialog struk memperingatkan & tombol kirim menyebut alasannya",
      rapi(ui.query('[data-testid="struk-tanpa-nomor"]')?.textContent).includes(
        "belum mengisi nomor WhatsApp",
      ),
      rapi(ui.query('[data-testid="struk-tanpa-nomor"]')?.textContent),
    );
    await ui.clickOn('[data-testid="struk-kirim-wa"]');
    check(
      "mengirim struk member tanpa nomor ditolak dengan sebab yang bisa dibetulkan",
      rapi(ui.query('[data-testid="struk-error"]')?.textContent).includes(
        "belum mengisi nomor WhatsApp",
      ),
      rapi(ui.query('[data-testid="struk-error"]')?.textContent),
    );

    /*
      Member cash yang datanya belum lengkap: nomornya belum tersimpan di data
      member, jadi dialog struk menawarkan **kolom nomor** supaya kasir bisa
      mengirim sekarang tanpa membuka halaman Member lebih dulu. Nomor yang ditolak
      dibiarkan menampilkan sebabnya; nomor yang benar dipakai untuk mengirim.
    */
    check(
      "member tanpa nomor WA diberi kolom untuk menampung nomornya di dialog struk",
      Boolean(ui.query('[data-testid="struk-nomor-wa"]')) &&
        rapi(ui.query('[data-testid="struk-nomor-wa-kotak"]')?.textContent).includes(
          "Rina Kartika",
        ),
      rapi(ui.query('[data-testid="struk-nomor-wa-kotak"]')?.textContent).slice(0, 140),
    );
    await ui.fill('[data-testid="struk-nomor-wa"]', "0812");
    await ui.clickOn('[data-testid="struk-kirim-wa"]');
    check(
      "nomor yang belum lengkap ditolak dengan alasannya, bukan memakai nomor tebakan",
      rapi(ui.query('[data-testid="struk-nomor-wa-galat"]')?.textContent).includes(
        "8–15 digit",
      ) &&
        !rapi(ui.query('[data-testid="struk-notice"]')?.textContent).includes("terkirim"),
      rapi(ui.query('[data-testid="struk-nomor-wa-galat"]')?.textContent),
    );
    await ui.fill('[data-testid="struk-nomor-wa"]', "0812-3456-7890");
    await ui.clickOn('[data-testid="struk-kirim-wa"]');
    const kirimDenganNomorKasir = rapi(ui.query('[data-testid="struk-notice"]')?.textContent);
    /*
      Kirimannya **gambarnya**, sedangkan DOM tiruan ini tidak punya kanvas
      (`getContext("2d")` → `null`). Yang benar diperiksa di sini: sebabnya disebut,
      arah yang tetap bekerja ditunjuk, dan tidak ada klaim terkirim.
    */
    check(
      "nomor yang sah tidak lagi ditolak soal penerimanya: sebabnya kini ketiadaan kanvas, dan itu disebut",
      kirimDenganNomorKasir.includes("tidak bisa menggambar struk jadi gambar") &&
        kirimDenganNomorKasir.includes("Unduh PDF") &&
        !kirimDenganNomorKasir.includes("terkirim") &&
        !ui.query('[data-testid="struk-error"]'),
      kirimDenganNomorKasir,
    );
    await ui.click("Tutup");

    await bayarUntukMember("Bu Sari Wulandari");
    check(
      "dialog struk member yang punya nomor menyebut nama penerimanya, bukan nomor penuhnya",
      rapi(ui.query('[data-testid="struk-dialog-member"]')?.textContent).includes(
        "Bu Sari Wulandari",
      ) &&
        rapi(ui.query('[data-testid="struk-dialog-member"]')?.textContent).includes("•") &&
        !rapi(ui.query('[data-testid="struk-dialog-member"]')?.textContent).includes(
          "281234567890",
        ),
      rapi(ui.query('[data-testid="struk-dialog-member"]')?.textContent),
    );
    await ui.clickOn('[data-testid="struk-kirim-wa"]');
    const laporanKirim = rapi(ui.query('[data-testid="struk-notice"]')?.textContent);
    /*
      Member yang punya nomor pun berhenti di titik yang sama di DOM tiruan ini:
      struk yang dikirim ke WhatsApp memang **gambarnya**, dan kanvasnya tidak ada.
      Yang diperiksa: laporan yang jujur — sebabnya disebut dan Nota-nya tidak
      diklaim terkirim. Gambar yang benar-benar terbentuk & terkirim diperiksa di
      Chromium (`verify-struk-browser.mjs`).
    */
    check(
      "member yang punya nomor pun tidak diklaim terkirim saat gambarnya tidak bisa dibuat — sebabnya disebut",
      laporanKirim.includes("tidak bisa menggambar struk jadi gambar") &&
        laporanKirim.includes("Unduh PDF") &&
        !laporanKirim.includes("terkirim") &&
        !ui.query('[data-testid="struk-error"]'),
      laporanKirim,
    );
    await ui.click("Tutup");

    /*
      Berbagi struk lewat **lembar bagikan perangkat** (Web Share API) sekarang satu
      jalur saja: **satu berkas gambar** (PNG) yang logonya sudah tergambar di
      dalamnya — pasangan PDF + logo dihapus karena di Android diserahkan sebagai
      intent bertipe umum dan WhatsApp bisa mengambil berkas pertamanya saja.
      DOM tiruan ini tidak punya kanvas, jadi gambarnya memang tidak bisa dibuat di
      sini; yang diperiksa: dialognya menawarkan satu jalur (bukan dua), jawabannya
      apa adanya, dan **tidak ada berkas kosong** yang diserahkan walaupun lembar
      bagikannya terpasang. Gambar berlogonya sendiri diperiksa piksel per piksel di
      Chromium (`verify-struk-browser.mjs`).
    */
    await ui.clickOn('button[aria-label="Struk & kirim"]');
    check(
      "tombol Struk & kirim membuka lagi dialog struk penjualan yang sudah lunas",
      Boolean(dialog()) &&
        rapi(dialog()?.textContent).includes(String(kas.lastSale?.number)),
      rapi(dialog()?.textContent).slice(0, 120),
    );
    check(
      "dialog struk menawarkan satu jalur berbagi — “Bagikan gambar struk” — di samping Unduh PDF & Kirim ke WhatsApp",
      Boolean(ui.query('[data-testid="struk-unduh-pdf"]')) &&
        Boolean(ui.query('[data-testid="struk-bagikan-gambar"]')) &&
        !ui.query('[data-testid="struk-bagikan-pdf"]') &&
        Boolean(ui.query('[data-testid="struk-kirim-wa"]')),
      rapi(dialog()?.textContent).slice(0, 160),
    );
    await ui.clickOn('[data-testid="struk-bagikan-gambar"]');
    const laporanTanpaBagikan = rapi(ui.query('[data-testid="struk-notice"]')?.textContent);
    check(
      "tanpa kanvas, tombol bagikan menjawab apa adanya & mengarahkan ke Unduh PDF — bukan gagal diam-diam",
      laporanTanpaBagikan.includes("belum bisa menggambar struk jadi gambar") &&
        laporanTanpaBagikan.includes("Unduh PDF") &&
        !ui.query('[data-testid="struk-error"]'),
      laporanTanpaBagikan,
    );

    /*
      Lembar bagikan yang **ada** pun tidak bisa menolong kalau gambarnya tidak bisa
      dibuat: yang benar adalah **tidak ada berkas yang diserahkan** — bukan
      menyerahkan berkas kosong atau mengklaim sudah diserahkan.
    */
    const dibagikan = [];
    Object.defineProperty(window.navigator, "share", {
      value: async (payload) => {
        dibagikan.push(payload);
      },
      configurable: true,
    });
    Object.defineProperty(window.navigator, "canShare", {
      value: (payload) => Array.isArray(payload?.files) && payload.files.length > 0,
      configurable: true,
    });
    await ui.clickOn('[data-testid="struk-bagikan-gambar"]');
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const laporanBagikan = rapi(ui.query('[data-testid="struk-notice"]')?.textContent);
    check(
      "dengan lembar bagikan terpasang pun tidak ada berkas kosong yang diserahkan, dan laporannya tidak mengklaim “diserahkan”",
      dibagikan.length === 0 &&
        laporanBagikan.includes("belum bisa menggambar struk jadi gambar") &&
        !laporanBagikan.includes("diserahkan") &&
        !ui.query('[data-testid="struk-error"]'),
      `${dibagikan.length} pembagian · ${laporanBagikan}`,
    );
    delete window.navigator.share;
    delete window.navigator.canShare;
    await ui.click("Tutup");

    /*
      Lembar “Transaksi terakhir (shift ini)”: dulu tabel yang selalu terbuka,
      sekarang satu tombol yang membuka daftar dari bawah layar. Di DOM tiruan yang
      diperiksa adalah keadaannya (tertutup → terbuka → tertutup) dan isi daftarnya;
      lintasan animasi naiknya diperiksa `verify-pos-transaksi-browser.mjs` di
      Chromium sungguhan, karena itu urusan mesin render.
    */
    const tombolTransaksi = () => ui.query('[data-testid="transaksi-terakhir-tombol"]');
    const lembarTransaksi = () => ui.query('[data-testid="transaksi-terakhir-lembar"]');
    const angkaDiTombol = () =>
      Number(
        (rapi(tombolTransaksi()?.textContent).match(/(\d+) transaksi/) ?? [])[1] ?? "0",
      );

    /** Keadaan tertutup: tombolnya menyatakan tertutup **dan** lembarnya tidak ada. */
    function lembarTertutup() {
      return (
        tombolTransaksi()?.getAttribute("aria-expanded") === "false" &&
        !lembarTransaksi()
      );
    }

    check(
      "“Transaksi terakhir (shift ini)” jadi satu tombol bersimbol jumlah transaksinya — bukan tabel yang selalu terbuka",
      Boolean(tombolTransaksi()) &&
        lembarTertutup() &&
        angkaDiTombol() > 0 &&
        rapi(tombolTransaksi()?.textContent).includes("Lihat daftar"),
      rapi(tombolTransaksi()?.textContent),
    );

    await ui.clickOn('[data-testid="transaksi-terakhir-tombol"]');
    const barisTransaksi = ui.queryAll('[data-testid="transaksi-terakhir-daftar"] li');
    check(
      "menekan tombolnya membuka lembar transaksi dari bawah, lengkap dengan seluruh penjualan shift ini",
      Boolean(lembarTransaksi()) &&
        lembarTransaksi()?.getAttribute("role") === "dialog" &&
        lembarTransaksi()?.getAttribute("aria-modal") === "true" &&
        lembarTransaksi()?.getAttribute("aria-label") === "Transaksi terakhir (shift ini)" &&
        barisTransaksi.length === angkaDiTombol(),
      `${barisTransaksi.length} baris vs ${angkaDiTombol()} di tombol`,
    );
    check(
      "barisnya menyebut nomor nota, jam, jumlah item, metode bayar, dan nominal di tombol Total daftar ini",
      /^[A-Z]+-\d+/.test(rapi(barisTransaksi[0]?.textContent)) &&
        /\d{2}[:.]\d{2}/.test(rapi(barisTransaksi[0]?.textContent)) &&
        /item/.test(rapi(barisTransaksi[0]?.textContent)) &&
        /Rp/.test(rapi(barisTransaksi[0]?.textContent)) &&
        rapi(lembarTransaksi()?.textContent).includes("Total daftar ini"),
      rapi(barisTransaksi[0]?.textContent),
    );

    // Dikirim lewat `act` supaya perubahan state-nya tidak dihitung sebagai galat
    // konsol oleh harness ini (React mengeluh kalau update terjadi di luar act).
    await React.act(async () => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    });
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    check(
      "Escape menutup lembarnya kembali menjadi tombol",
      tombolTransaksi()?.getAttribute("aria-expanded") === "false",
      `aria-expanded=${tombolTransaksi()?.getAttribute("aria-expanded")} · lembar=${Boolean(lembarTransaksi())}`,
    );

    Object.defineProperty(window, "print", {
      configurable: true,
      writable: true,
      value: printAsli,
    });
    check(
      "kasir tanpa galat konsol di alur pecahan uang & cetak otomatis",
      ui.newErrors().length === 0,
      ui.newErrors().join(" | ").slice(0, 300),
    );
    await ui.unmount();
  }

  // 3e-10-3. Bunyi bip kasir: kapan berbunyi, dan setelan aktif/matinya.
  //
  //           Yang diperiksa bukan "bunyi terdengar" (mustahil di DOM tiruan),
  //           melainkan **kapan** halaman kasir memanggilnya dan **apakah setelan
  //           matinya benar-benar membungkamnya**: satu bip untuk tiap ketukan
  //           produk yang diterima, satu ketukan = satu bip (menyimpan pilihan
  //           modifier tidak membunyikan bip kedua), dan begitu bipnya dimatikan,
  //           pemutar tidak dipanggil sama sekali — bukan sekadar tidak terdengar.
  {
    const scanBeep = await server.ssrLoadModule("/src/lib/scanBeep.ts");
    const { SettingsPage } = await server.ssrLoadModule("/src/pages/SettingsPage.tsx");
    // Nada yang benar-benar diminta pemutar tiruan dicatat **utuh** (bukan hanya
    // frekuensinya): setelan volume bekerja dengan mengubah kekuatan puncaknya,
    // jadi `peakGain`-nya yang membedakan “bipnya dimatikan” dari “bipnya pelan”.
    const beeps = [];
    scanBeep.setScanBeepPlayer({
      play(tone) {
        beeps.push(tone ?? null);
        return true;
      },
    });
    // Setelan yang tersisa dari jalan sebelumnya (atau dari blok lain) tidak boleh
    // membuat blok ini menguji keadaan yang salah.
    scanBeep.setScanBeepEnabled(true);
    scanBeep.setScanBeepVolume(scanBeep.SCAN_BEEP_VOLUME_DEFAULT);
    window.localStorage.removeItem(scanBeep.SCAN_BEEP_STORAGE_KEY);
    window.localStorage.removeItem(scanBeep.SCAN_BEEP_VOLUME_STORAGE_KEY);

    try {
      withEnterpriseSession("professional");

      let products = [];
      const CartProbe = () => {
        products = useStore().products.map((product) => ({
          id: product.id,
          name: product.name,
          stock: product.stock,
          modifiers: product.modifiers?.length ?? 0,
        }));
        return null;
      };

      const ui = await renderInteractive(
        providers(
          React.createElement(
            React.Fragment,
            null,
            React.createElement(PosPage, null),
            React.createElement(CartProbe, null),
          ),
        ),
      );

      const tanpaModifier = products.find((p) => p.modifiers === 0 && p.stock > 1);
      const bermodifier = products.find((p) => p.modifiers > 0 && p.stock > 0);
      check(
        "ada produk berstok untuk menguji bip kasir",
        Boolean(tanpaModifier && bermodifier),
        JSON.stringify(products).slice(0, 200),
      );

      await ui.click(tanpaModifier.name);
      check(
        "produk yang diklik berbunyi bip satu kali, seperti mesin kasir",
        beeps.length === 1 && beeps[0]?.frequencyHz === scanBeep.SCAN_BEEP.frequencyHz,
        `bip=${beeps.length} nada=${beeps[0]?.frequencyHz} (harap ${scanBeep.SCAN_BEEP.frequencyHz})`,
      );

      await ui.click(tanpaModifier.name);
      check(
        "menekan produk lagi berbunyi lagi (tiap ketukan terdengar)",
        beeps.length === 2,
        `bip=${beeps.length}`,
      );

      // Ketukan pada produk bermodifier membuka dialog; bipnya sudah berbunyi di
      // ketukan itu (dari sisi kasir "produk ini tercatat" sudah terjadi), dan
      // menyimpan pilihannya tidak menambah bip kedua.
      await ui.click(bermodifier.name);
      check(
        "ketukan yang membuka dialog modifier sudah berbunyi",
        ui.text().includes("Atur modifier") && beeps.length === 3,
        `dialog=${ui.text().includes("Atur modifier")} bip=${beeps.length}`,
      );
      await ui.click("Pedas 1");
      await ui.click("Tambahkan");
      check(
        "menyimpan pilihan modifier tidak membunyikan bip kedua",
        beeps.length === 3 && ui.text().includes("Nasi Goreng Spesial"),
        `bip=${beeps.length} teks=${ui.text().slice(0, 160)}`,
      );

      // ── Setelan di header kasir ──────────────────────────────────────────
      const tombolBip = '[role="switch"][aria-label="Bunyi bip saat produk diklik"]';
      const switchBip = () => ui.query(tombolBip);
      check(
        "kasir punya tombol bip kasir yang menyala sejak awal",
        switchBip()?.getAttribute("aria-checked") === "true" &&
          ui.text().includes("Bip kasir aktif"),
        `checked=${switchBip()?.getAttribute("aria-checked")}`,
      );

      await ui.click("Bip kasir aktif");
      check(
        "mematikan bip langsung terlihat di tombolnya",
        switchBip()?.getAttribute("aria-checked") === "false" &&
          ui.text().includes("Bip kasir mati"),
        `checked=${switchBip()?.getAttribute("aria-checked")}`,
      );
      check(
        "pilihan bip disimpan di perangkat ini (bukan ke server)",
        window.localStorage.getItem(scanBeep.SCAN_BEEP_STORAGE_KEY) === "off",
        String(window.localStorage.getItem(scanBeep.SCAN_BEEP_STORAGE_KEY)),
      );
      check(
        "kontrol volume disembunyikan saat bipnya mati (yang senyap tidak punya keras)",
        ui.query('[data-testid="pos-beep-volume"]') === null &&
          ui.text().includes("Bip kasir mati"),
        `ada=${Boolean(ui.query('[data-testid="pos-beep-volume"]'))}`,
      );

      const sebelumDimatikan = beeps.length;
      /*
        Penghitung “N item” di header panel pesanan: pembuktian bahwa ketukan yang
        tidak berbunyi tetap benar-benar menambah barang. Dibaca dari elemennya
        sendiri, bukan dari seluruh teks halaman — halaman kasir punya tempat lain
        yang juga menyebut “n item” (ringkasan & daftar transaksi), dan pembacaan
        yang longgar hanya menangkap angka terbesar di antara semuanya.
      */
      const jumlahItem = () =>
        Number(
          (
            ui.query('[data-testid="keranjang-jumlah-item"]')?.textContent ?? ""
          ).match(/(\d+) item/)?.[1] ?? "0",
        );
      const itemSebelumMati = jumlahItem();
      await ui.click(tanpaModifier.name);
      check(
        "bip yang dimatikan tidak sampai ke pemutar, tetapi barangnya tetap masuk keranjang",
        beeps.length === sebelumDimatikan && jumlahItem() === itemSebelumMati + 1,
        `bip=${beeps.length} sebelum=${sebelumDimatikan} item=${itemSebelumMati} → ${jumlahItem()}`,
      );

      await ui.click("Bip kasir mati");
      check(
        "menyalakan lagi membunyikan contoh nada tanpa perlu menjual",
        switchBip()?.getAttribute("aria-checked") === "true" &&
          beeps.length === sebelumDimatikan + 1,
        `checked=${switchBip()?.getAttribute("aria-checked")} bip=${beeps.length}`,
      );
      const sebelumNyalakan = beeps.length;
      await ui.click(tanpaModifier.name);
      check(
        "menyalakan lagi membuat ketukan produk berbunyi seperti semula",
        beeps.length === sebelumNyalakan + 1 && ui.text().includes(tanpaModifier.name),
        `bip=${beeps.length} sebelum=${sebelumNyalakan}`,
      );

      // ── Volume bip dari kasir: naik/turun satu tingkat (10 %) ──────────────
      const nilaiVolumeKasir = () =>
        ui.query('[data-testid="pos-beep-volume"]')?.textContent?.trim() ?? "";
      check(
        "kontrol volume muncul lagi begitu bipnya menyala, dengan angka yang berlaku",
        nilaiVolumeKasir() === scanBeep.scanBeepVolumeLabel(scanBeep.SCAN_BEEP_VOLUME_DEFAULT),
        `volume=${nilaiVolumeKasir()}`,
      );

      const sebelumNaik = beeps.length;
      await ui.clickOn('[aria-label="Besarkan volume bip"]');
      check(
        "menaikkan volume dari kasir bergerak satu langkah, tersimpan, & langsung diperdengarkan",
        nilaiVolumeKasir() === "80 %" &&
          window.localStorage.getItem(scanBeep.SCAN_BEEP_VOLUME_STORAGE_KEY) === "80" &&
          beeps.length === sebelumNaik + 1,
        `volume=${nilaiVolumeKasir()} tersimpan=${window.localStorage.getItem(scanBeep.SCAN_BEEP_VOLUME_STORAGE_KEY)} bip=${beeps.length}`,
      );

      const sebelumTurun = beeps.length;
      await ui.clickOn('[aria-label="Kecilkan volume bip"]');
      await ui.clickOn('[aria-label="Kecilkan volume bip"]');
      check(
        "menurunkan volume dua langkah terlihat di angkanya & tersimpan",
        nilaiVolumeKasir() === "60 %" &&
          window.localStorage.getItem(scanBeep.SCAN_BEEP_VOLUME_STORAGE_KEY) === "60" &&
          beeps.length === sebelumTurun + 2,
        `volume=${nilaiVolumeKasir()} tersimpan=${window.localStorage.getItem(scanBeep.SCAN_BEEP_VOLUME_STORAGE_KEY)}`,
      );

      await ui.click(tanpaModifier.name);
      check(
        "ketukan produk dijadwalkan dengan kekuatan sesuai volume (bukan kekuatan penuh)",
        Math.abs((beeps.at(-1)?.peakGain ?? 0) - 0.15) < 1e-9 &&
          beeps.at(-1)?.frequencyHz === scanBeep.SCAN_BEEP.frequencyHz,
        `peak=${beeps.at(-1)?.peakGain} (harap 0,15) nada=${beeps.at(-1)?.frequencyHz}`,
      );
      check(
        "kasir dengan tombol bip tetap tanpa error konsol",
        ui.newErrors().length === 0,
        ui.newErrors().join(" | ").slice(0, 200),
      );
      await ui.unmount();

      // ── Setelan yang sama di halaman Pengaturan ──────────────────────────
      const atur = await renderInteractive(
        providers(React.createElement(SettingsPage, null)),
      );
      const switchSetelan = '[role="switch"][aria-label="Aktifkan bunyi bip kasir"]';
      check(
        "Pengaturan menampilkan kartu bunyi bip yang ikut keadaan tombol di kasir",
        Boolean(atur.query(switchSetelan)) &&
          atur.query(switchSetelan)?.getAttribute("aria-checked") === "true" &&
          atur.text().includes("Bunyi bip kasir"),
        `checked=${atur.query(switchSetelan)?.getAttribute("aria-checked")}`,
      );

      await atur.click("Matikan bunyi");
      const sesudahMatikan = beeps.length;
      check(
        "mematikannya dari Pengaturan menulis setelan yang sama",
        atur.query(switchSetelan)?.getAttribute("aria-checked") === "false" &&
          window.localStorage.getItem(scanBeep.SCAN_BEEP_STORAGE_KEY) === "off" &&
          atur.text().includes("Bip dimatikan"),
        String(window.localStorage.getItem(scanBeep.SCAN_BEEP_STORAGE_KEY)),
      );
      await atur.click("Coba bunyikan");
      check(
        "tombol “Coba bunyikan” berbunyi walau bipnya sedang mati",
        beeps.length === sesudahMatikan + 1,
        `bip=${beeps.length} sebelum=${sesudahMatikan}`,
      );

      // ── Kontrol volume di halaman Pengaturan ─────────────────────────────
      const nilaiVolumeAtur = () =>
        atur.query('[data-testid="beep-volume-value"]')?.textContent?.trim() ?? "";
      check(
        "Pengaturan menampilkan volume perangkat yang sama dengan yang diatur di kasir",
        nilaiVolumeAtur() === "60 %",
        `volume=${nilaiVolumeAtur()}`,
      );

      const sebelumNaikAtur = beeps.length;
      await atur.clickOn('[aria-label="Besarkan volume bip"]');
      check(
        "volume bisa dinaikkan dari Pengaturan walau bipnya sedang mati, & terdengar",
        nilaiVolumeAtur() === "70 %" &&
          window.localStorage.getItem(scanBeep.SCAN_BEEP_VOLUME_STORAGE_KEY) === "70" &&
          beeps.length === sebelumNaikAtur + 1,
        `volume=${nilaiVolumeAtur()} tersimpan=${window.localStorage.getItem(scanBeep.SCAN_BEEP_VOLUME_STORAGE_KEY)}`,
      );

      await atur.clickOn('[aria-label="Besarkan volume bip"]');
      await atur.clickOn('[aria-label="Besarkan volume bip"]');
      await atur.clickOn('[aria-label="Besarkan volume bip"]');
      check(
        "di volume paling keras angkanya 100 %, tombol + mati, & kalimatnya menyebut batasnya",
        nilaiVolumeAtur() === "100 %" &&
          Boolean(atur.query('[aria-label="Besarkan volume bip"]')?.disabled) &&
          atur.text().includes("Paling keras"),
        `volume=${nilaiVolumeAtur()} disabled=${Boolean(atur.query('[aria-label="Besarkan volume bip"]')?.disabled)}`,
      );

      for (let tekan = 0; tekan < 9; tekan += 1) {
        await atur.clickOn('[aria-label="Kecilkan volume bip"]');
      }
      check(
        "di volume paling pelan angkanya 10 % (bukan 0 %) & tombol − mati",
        nilaiVolumeAtur() === "10 %" &&
          Boolean(atur.query('[aria-label="Kecilkan volume bip"]')?.disabled) &&
          atur.text().includes("Paling pelan") &&
          beeps.at(-1)?.peakGain !== undefined &&
          Math.abs(beeps.at(-1).peakGain - 0.025) < 1e-9,
        `volume=${nilaiVolumeAtur()} peak=${beeps.at(-1)?.peakGain}`,
      );
      check(
        "setelah diturunkan, tombol + hidup lagi (bukan terkunci di ujung)",
        !atur.query('[aria-label="Besarkan volume bip"]')?.disabled,
        String(atur.query('[aria-label="Besarkan volume bip"]')?.disabled),
      );
      check(
        "halaman Pengaturan tanpa error konsol",
        atur.newErrors().length === 0,
        atur.newErrors().join(" | ").slice(0, 200),
      );
      await atur.unmount();
    } finally {
      // Pemutar & setelan dikembalikan ke bawaan supaya blok uji berikutnya tidak
      // diam-diam memakai pemutar tiruan, bip yang mati, atau volume 10 %.
      scanBeep.setScanBeepPlayer(null);
      scanBeep.setScanBeepEnabled(true);
      scanBeep.setScanBeepVolume(scanBeep.SCAN_BEEP_VOLUME_DEFAULT);
    }
  }

  // 3e-11. Sinkronisasi real-time (`sync.realtime`, Phase 6): halaman
  //        Sinkronisasi. Kehadiran tiap perangkat contoh harus terbaca berbeda,
  //        dan log harus memuat konflik yang terbuka maupun yang sudah selesai.
  {
    const { SyncPage } = await server.ssrLoadModule("/src/pages/SyncPage.tsx");

    withEnterpriseSession("professional");
    const page = await renderInteractive(
      providers(React.createElement(SyncPage, null)),
    );
    const text = page.text();
    check(
      "halaman Sinkronisasi memuat hub & perangkat beserta kehadirannya",
      text.includes("Sinkronisasi real-time multi-perangkat") &&
        text.includes("Kasir Depan") &&
        text.includes("Online") &&
        text.includes("Menganggur") &&
        text.includes("Offline"),
      text.slice(0, 800),
    );
    check(
      "ringkasan bercerita tentang konflik yang belum dibereskan",
      text.includes("Konflik belum selesai") &&
        text.includes("Hub real-time aktif"),
      text.slice(0, 600),
    );
    check(
      "log perubahan menampilkan konflik terbuka & selesai",
      text.includes("konflik terbuka") &&
        text.includes("konflik selesai") &&
        text.includes("Diterima dengan penyesuaian") &&
        text.includes("Ditolak"),
      text.slice(0, 1200),
    );
    // Tarik perubahan: sisi **menarik** dari kontrak sync harus benar-benar bisa
    // dipakai, bukan hanya ada di server. Panelnya ditekan lewat tombol yang
    // benar-benar diklik kasir, lalu hasilnya diperiksa.
    check(
      "halaman Sinkronisasi menyediakan tarikan perubahan",
      text.includes("Tarik perubahan") && text.includes("Kursor revisi"),
      text.slice(0, 400),
    );
    await page.click("Tarik");
    check(
      "tarikan dari kursor 0 mengembalikan seluruh jendela contoh",
      page.text().includes("6 perubahan") &&
        page.text().includes("kursor berikutnya r6") &&
        page.text().includes("sudah yang terbaru") &&
        page.text().includes("revisi tertinggi r6"),
      page.text().slice(-500),
    );
    check(
      "halaman Sinkronisasi tanpa error konsol",
      page.newErrors().length === 0,
      page.newErrors().join(" | ").slice(0, 200),
    );
    await page.unmount();

    withoutSession();
    const starter = await renderTree(providers(React.createElement(SyncPage, null)));
    check(
      "paket tanpa fiturnya menjelaskan halaman Sinkronisasi hanya bisa dibaca",
      starter.text.includes("tidak termasuk paket Starter") &&
        starter.text.includes("hanya bisa dibaca"),
      starter.text.slice(0, 500),
    );
  }

  // 3e-11-1. Aksi sinkronisasi lewat store (`sync.realtime`, Phase 6): daftarkan
  //           perangkat, tolak nama yang terlalu pendek, dorong perubahan di atas
  //           basis basi (jadi disesuaikan), tolak jam yang melenceng, lalu
  //           tandai konflik contoh selesai.
  {
    function SyncAct() {
      const store = useStore();
      const facts = React.useRef({});
      const step = React.useRef(0);

      React.useEffect(() => {
        if (step.current !== 0) return;
        step.current = 1;

        void (async () => {
          try {
            const created = await store.registerSyncDevice({
              label: "Kasir Uji",
              platform: "android",
              fingerprint: "fp-kasir-uji-09",
            });
            facts.current.registered = created.name;
          } catch (error) {
            facts.current.registerError = error.message;
          }

          try {
            await store.registerSyncDevice({
              label: "ab",
              platform: "web",
              fingerprint: "fp-kasir-uji-09",
            });
            facts.current.label = "DITERIMA";
          } catch (error) {
            facts.current.label = error.message;
          }

          try {
            const pushed = await store.pushSync({
              deviceFingerprint: "fp-kasir-uji-09",
              deviceName: "Kasir Uji",
              platform: "android",
              entity: "stock",
              entityId: "p05",
              baseRevision: 1,
              updatedAt: Date.now(),
              payload: '{"stock":"16"}',
            });
            facts.current.outcome = `${pushed.outcome}@${pushed.revision}`;
          } catch (error) {
            facts.current.pushError = error.message;
          }

          try {
            const skewed = await store.pushSync({
              deviceFingerprint: "fp-kasir-uji-09",
              deviceName: "Kasir Uji",
              platform: "android",
              entity: "stock",
              entityId: "p05",
              baseRevision: 0,
              updatedAt: Date.now() + 60 * 60 * 1000,
              payload: "{}",
            });
            facts.current.skew = skewed.outcome;
          } catch (error) {
            facts.current.skew = error.message;
          }

          const conflict = store.syncChanges.find(
            (row) => row.conflict && row.resolvedAt === null,
          );
          if (conflict) {
            try {
              await store.resolveSyncChange(conflict.id);
              facts.current.resolved = "ok";
            } catch (error) {
              facts.current.resolved = error.message;
            }
          }

          // Sisi **menarik**: satu jendela per giliran, kursor menunjuk baris
          // terakhir yang terkirim, dan `hasMore` memberi tahu masih ada lagi.
          try {
            const first = await store.pullSync({ cursor: 6, limit: 1 });
            facts.current.pull1 = `${first.items.length}|${first.items[0]?.revision}|${first.nextCursor}|${first.hasMore ? "more" : "end"}|${first.latestRevision}`;
            const second = await store.pullSync({
              cursor: first.nextCursor,
              limit: 5,
            });
            facts.current.pull2 = `${second.items.length}|${second.items[0]?.revision}|${second.nextCursor}|${second.hasMore ? "more" : "end"}`;
            const end = await store.pullSync({ cursor: second.nextCursor });
            facts.current.pull3 = `${end.items.length}|${end.nextCursor}|${end.hasMore ? "more" : "end"}`;
          } catch (error) {
            facts.current.pullError = error.message;
          }
        })();
      }, [store]);

      const clean = (value) => String(value ?? "-").replace(/\s+/g, "_");

      return React.createElement(
        "div",
        null,
        `registered=${clean(facts.current.registered)}` +
          ` registerError=${clean(facts.current.registerError)}` +
          ` label=${clean(facts.current.label)}` +
          ` outcome=${clean(facts.current.outcome)}` +
          ` pushError=${clean(facts.current.pushError)}` +
          ` skew=${clean(facts.current.skew)}` +
          ` resolved=${clean(facts.current.resolved)}` +
          ` pull1=${clean(facts.current.pull1)}` +
          ` pull2=${clean(facts.current.pull2)}` +
          ` pull3=${clean(facts.current.pull3)}` +
          ` pullError=${clean(facts.current.pullError)}`,
      );
    }

    withEnterpriseSession("professional");
    const act = await renderTree(providers(React.createElement(SyncAct, null)));
    withoutSession();
    check(
      "mendaftarkan perangkat lewat store berhasil",
      act.text.includes("registered=Kasir_Uji") && act.text.includes("registerError=-"),
      act.text.slice(0, 200),
    );
    check(
      "nama perangkat yang terlalu pendek ditolak dengan alasan yang terbaca",
      act.text.includes("label=Nama_perangkat_harus"),
      act.text.slice(0, 300),
    );
    check(
      "dorongan di atas basis basi diselesaikan last-write-wins",
      /outcome=rebased@\d+/.test(act.text) && act.text.includes("pushError=-"),
      act.text.slice(0, 300),
    );
    check(
      "jam perangkat yang melenceng ditolak",
      act.text.includes("skew=rejected"),
      act.text.slice(0, 300),
    );
    check(
      "konflik contoh bisa ditandai selesai",
      act.text.includes("resolved=ok"),
      act.text.slice(0, 300),
    );
    check(
      "tarikan mengambil tepat satu jendela di atas kursor",
      act.text.includes("pull1=1|7|7|more|8") && act.text.includes("pullError=-"),
      act.text.slice(0, 400),
    );
    check(
      "tarikan berikutnya melanjutkan tepat setelah kursor",
      act.text.includes("pull2=1|8|8|end"),
      act.text.slice(0, 400),
    );
    check(
      "tarikan di ujung kursor tidak mengembalikan apa pun",
      act.text.includes("pull3=0|8|end"),
      act.text.slice(0, 400),
    );
  }

  // 3f. Masuk tanpa kata sandi (`otp.auth`): halaman masuk sekarang **satu**
  //     jalur untuk masuk dan daftar, dan yang dipakai adalah kode yang dikirim
  //     ke email — bukan kata sandi. Alur ini ditempuh lewat interaksi sungguhan
  //     (ketik email → kirim kode → ketik kode salah → ketik kode benar) supaya
  //     terbukti bahwa sesinya benar-benar terbentuk dari kode itu, bukan dari
  //     tombol yang hanya terlihat jalan.
  {
    const { AuthPage } = await server.ssrLoadModule("/src/pages/AuthPage.tsx");
    const { dataSource } = await server.ssrLoadModule("/src/lib/store/config.ts");
    const { isOtpCodeShape, OTP_CODE_LENGTH } = await server.ssrLoadModule(
      "/src/lib/otp.ts",
    );

    window.localStorage.clear();
    const ui = await renderInteractive(
      providers(React.createElement(AuthPage, null)),
    );

    check(
      "halaman masuk tidak punya kolom kata sandi",
      ui.query('input[type="password"]') === null &&
        !ui.text().includes("Kata sandi"),
      ui.text().slice(0, 200),
    );
    check(
      "halaman masuk menawarkan jalur kirim kode",
      ui.text().includes("Masuk atau daftar") &&
        ui.text().includes("Kirim kode masuk"),
      ui.text().slice(0, 200),
    );
    check(
      "halaman masuk menyebut `Masuk` sebagai tombol jalur yang sama (tanpa tab Daftar)",
      !(ui.queryAll("button") ?? []).some(
        (button) => (button.textContent ?? "").trim() === "Daftar",
      ),
      ui.text().slice(0, 300),
    );

    // Tombol layar penuh harus sudah ada **sebelum** sesi terbentuk: halaman masuk
    // berdiri di luar `/app`, jadi ia tidak bisa menumpang header backstage.
    const tombolMasuk = ui.query('[aria-label="Layar penuh"]');
    check(
      "halaman masuk punya tombol layar penuh sebelum sesi terbentuk",
      Boolean(tombolMasuk) &&
        tombolMasuk?.getAttribute("aria-pressed") === "false" &&
        !(tombolMasuk?.getAttribute("title") ?? "").includes("sidebar"),
      `tombol=${Boolean(tombolMasuk)} title="${tombolMasuk?.getAttribute("title") ?? ""}"`,
    );
    await React.act(async () => {
      tombolMasuk?.click();
    });
    check(
      "tombol layar penuh di halaman masuk bekerja tanpa menyentuh formulir",
      ui.query('[aria-label="Keluar dari layar penuh"]')?.getAttribute("aria-pressed") ===
        "true" &&
        Boolean(ui.query("#email")) &&
        ui.text().includes("Masuk atau daftar"),
      `pressed=${ui.query('[aria-label="Keluar dari layar penuh"]')?.getAttribute("aria-pressed")}`,
    );
    await React.act(async () => {
      ui.query('[aria-label="Keluar dari layar penuh"]')?.click();
    });
    check(
      "keluar dari layar penuh di halaman masuk mengembalikan keadaannya",
      Boolean(ui.query('[aria-label="Layar penuh"]')) &&
        ui.query('[aria-label="Keluar dari layar penuh"]') === null,
      `aktif=${Boolean(ui.query('[aria-label="Keluar dari layar penuh"]'))}`,
    );

    // Email tidak valid harus ditolak di layar, sebelum ada kode yang dikirim.
    await ui.fill("#email", "bukan-email");
    await ui.submit();
    check(
      "email tidak valid ditolak dengan penjelasan",
      ui.text().includes("nama@domain") &&
        ui.query('[role="alert"]') !== null,
      ui.text().slice(-400),
    );

    if (dataSource !== "demo") {
      // Mode Convex: kodenya benar-benar berangkat lewat email, jadi tidak ada
      // yang bisa dibaca dari layar. Alur minta-kode & verifikasinya diuji penuh
      // terhadap deployment di scripts/verify-backend.mjs; yang tetap diperiksa
      // di sini adalah hal yang berlaku di kedua mode (tanpa kata sandi, satu
      // jalur, email tidak valid ditolak).
      console.log(`· alur OTP interaktif dilewati: mode data = ${dataSource}`);
      check(
        "mode non-demo tetap menampilkan jalur email tanpa kata sandi",
        ui.query("#email") !== null,
        ui.text().slice(0, 200),
      );
      check(
        "halaman masuk tanpa error konsol",
        ui.newErrors().length === 0,
        ui.newErrors().join(" | ").slice(0, 300),
      );
      await ui.unmount();
      window.localStorage.clear();
    } else {
      const EMAIL = "pemilik@mesinpos.test";
      await ui.fill("#email", EMAIL);
      await ui.submit();

      const kode = ui
        .query("[data-otp-dev-inbox]")
        ?.getAttribute("data-otp-dev-inbox");
      check(
        `langkah kode aktif dan kotak surat pengembangan berisi kode ${OTP_CODE_LENGTH} digit`,
        isOtpCodeShape(kode ?? "") && ui.text().includes("Ganti email"),
        `kode=${kode} · ${ui.text().slice(0, 200)}`,
      );
      check(
        "kode yang dibuat diberitahukan sebatas email yang disamarkan",
        ui.text().includes("p***@mesinpos.test") && !ui.text().includes(EMAIL),
        ui.text().slice(0, 300),
      );
      check(
        "kotak surat pengembangan menjelaskan sebabnya dengan kata “server”",
        ui.text().includes("Server belum tersambung") &&
          !ui.text().includes("Convex"),
        ui.text().slice(0, 240),
      );
      check(
        "kirim ulang ditahan selama jeda 60 detik",
        /Kirim ulang dalam \d+s/.test(ui.text()),
        ui.text().slice(-200),
      );

      // Kode salah: ditolak, dan sisa percobaannya dihitung (bukan pesan generik).
      const salah = kode === "000000" ? "111111" : "000000";
      await ui.fill("#otp", salah);
      await ui.submit();
      check(
        "kode salah ditolak beserta sisa percobaan",
        ui.text().includes("Kode tidak sesuai") &&
          ui.text().includes("Sisa 4 percobaan") &&
          ui.query('[role="alert"]') !== null,
        ui.text().slice(-300),
      );

      // Kode benar: sesi terbentuk untuk email itu, dengan nama yang wajar.
      await ui.fill("#otp", kode);
      await ui.submit();
      const session = JSON.parse(
        window.localStorage.getItem("mesinpos.session.v1") ?? "null",
      );
      check(
        "kode benar membentuk sesi untuk email itu",
        session?.user?.email === EMAIL,
        window.localStorage.getItem("mesinpos.session.v1") ?? "(kosong)",
      );
      check(
        "akun baru mendapat nama wajar dari emailnya (tanpa formulir daftar)",
        session?.user?.name === "pemilik" && session?.tenant === null,
        JSON.stringify(session?.user),
      );
      check(
        "halaman masuk tanpa error konsol sepanjang alur OTP",
        ui.newErrors().length === 0,
        ui.newErrors().join(" | ").slice(0, 300),
      );
      await ui.unmount();
      window.localStorage.clear();

      // Sisa aturan (kedaluwarsa, terkunci, sekali pakai) adalah keputusan murni
      // dan diperiksa tuntas di scripts/verify-otp.mjs; di sini yang dibuktikan
      // adalah halaman yang dipakai pengguna benar-benar menempuh jalur itu.
    }
  }

  // 4b. Backstage platform (`/platform`): akun di luar RBAC tenant.
  //     Tiga hal yang dibuktikan di sini, dan ketiganya tentang **pintu**, bukan
  //     tentang tampilan: halaman ini tidak butuh keanggotaan tenant (akun
  //     platform memang tidak punya), ia terkunci di mode demo alih-alih memanggil
  //     Convex tanpa provider, dan tidak ada satu pun kontrol pendampingan yang
  //     muncul sebelum gerbang identitas dilewati.
  {
    const { PlatformPage } = await server.ssrLoadModule("/src/pages/PlatformPage.tsx");
    const { App: AppRoot } = await server.ssrLoadModule("/src/App.tsx");

    withoutSession();
    const tamu = await renderTree(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/platform"] },
        React.createElement(
          SessionProvider,
          null,
          React.createElement(
            BackendProvider,
            null,
            React.createElement(StoreProvider, null, React.createElement(AppRoot, null)),
          ),
        ),
      ),
    );
    check(
      "backstage platform menuntut sesi: tamu diarahkan ke halaman masuk",
      !tamu.text.includes("Backstage platform") &&
        tamu.text.toLowerCase().includes("masuk"),
      tamu.text.slice(0, 300),
    );

    // Sesi **tanpa tenant**: inilah bentuk akun platform. Kalau rutenya memakai
    // `RequireTenant`, ia akan dilempar ke onboarding dan backstage tidak pernah
    // bisa dibuka oleh satu-satunya orang yang berhak membukanya.
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        user: { name: "Rani", email: "rani@mesinpos.id" },
        tenant: null,
      }),
    );
    const backstage = await renderTree(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/platform"] },
        React.createElement(
          SessionProvider,
          null,
          React.createElement(
            BackendProvider,
            null,
            React.createElement(StoreProvider, null, React.createElement(AppRoot, null)),
          ),
        ),
      ),
    );
    check(
      "rute backstage terbuka untuk akun tanpa keanggotaan tenant",
      backstage.text.includes("Backstage platform") &&
        backstage.text.includes("Di luar RBAC tenant"),
      backstage.text.slice(0, 300),
    );
    check(
      "backstage menjelaskan kenapa ia terkunci di mode demo",
      backstage.text.includes("Backstage butuh Convex dan identitas terverifikasi") &&
        backstage.text.includes("VITE_DATA_SOURCE=convex"),
      backstage.text.slice(0, 400),
    );
    check(
      "backstage menegaskan gerbangnya lebih ketat daripada gerbang tenant",
      backstage.text.includes("lebih ketat daripada gerbang tenant"),
      backstage.text.slice(0, 400),
    );
    check(
      "tidak ada kontrol pendampingan sebelum identitas platform diperiksa",
      !backstage.text.includes("Mulai pendampingan") &&
        !backstage.text.includes("Cari tenant") &&
        !backstage.text.includes("Buka ringkasan bantuan"),
      backstage.text.slice(0, 600),
    );
    check(
      "pengelolaan kategori bisnis juga tersembunyi selama gerbang platform tertutup",
      !backstage.text.includes("Kategori & subkategori bisnis") &&
        !backstage.text.includes("Tambah kategori"),
      backstage.text.slice(0, 600),
    );
    check(
      "pengelolaan akun bisnis juga tersembunyi selama gerbang platform tertutup",
      !backstage.text.includes("Akun bisnis") &&
        !backstage.text.includes("Nonaktifkan") &&
        !backstage.text.includes("Hapus permanen") &&
        !backstage.text.includes("Tindakan pengelola terakhir"),
      backstage.text.slice(0, 600),
    );
    check(
      "backstage menerangkan jejak auditnya sejak keadaan terkunci",
      backstage.text.includes("jejak audit tenant"),
      backstage.text.slice(0, 600),
    );
    check(
      "backstage terkunci tanpa error konsol",
      backstage.newErrors.length === 0,
      backstage.newErrors.join(" | ").slice(0, 200),
    );

    // Halaman juga harus tetap utuh saat dirender langsung dengan provider biasa.
    const langsung = await renderTree(
      providers(React.createElement(PlatformPage, null)),
    );
    check(
      "backstage merender penanda terkuncinya saat dipanggil langsung",
      langsung.text.includes("Backstage platform") &&
        langsung.text.includes("Backstage butuh Convex dan identitas terverifikasi"),
      langsung.text.slice(0, 300),
    );

    // Baris “Workspace saya”. Akun platform boleh punya workspace sendiri, jadi
    // backstage harus menawarkan jalan ke dashboard-nya — dan ke onboarding kalau
    // perangkat ini belum punya tenant (bukan ke `/app`, yang akan melempar balik
    // ke sana).
    const backstageView = () =>
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/platform"] },
        React.createElement(
          SessionProvider,
          null,
          React.createElement(
            BackendProvider,
            null,
            React.createElement(StoreProvider, null, React.createElement(AppRoot, null)),
          ),
        ),
      );
    const hrefs = (view) =>
      view
        .queryAll("a")
        .map((anchor) => anchor.getAttribute("href") ?? "");

    const belumPunya = await renderInteractive(backstageView());
    check(
      "backstage menawarkan onboarding saat perangkat ini belum punya workspace",
      belumPunya.text().includes("Workspace saya") &&
        belumPunya.text().includes("Belum ada workspace di perangkat ini") &&
        hrefs(belumPunya).some((href) => href.includes("/auth?returnTo=/onboarding")) &&
        !hrefs(belumPunya).includes("/app"),
      `${belumPunya.text().slice(0, 200)} | ${hrefs(belumPunya).join(", ")}`,
    );
    await belumPunya.unmount();

    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        user: { name: "Rani", email: "rani@mesinpos.id" },
        tenant: {
          name: "Workspace Uji Platform",
          slug: "workspace-uji-platform",
          storeName: "Cabang Uji",
          vertical: "umkm",
          verticals: ["umkm"],
          planKey: "starter",
          role: "owner",
          createdAt: new Date().toISOString(),
          trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
        },
      }),
    );
    const sudahPunya = await renderInteractive(backstageView());
    check(
      "backstage menautkan dashboard `/app` saat workspace-nya sudah ada",
      sudahPunya.text().includes("Workspace Uji Platform") &&
        sudahPunya.text().includes("Buka dashboard") &&
        hrefs(sudahPunya).includes("/app"),
      `${sudahPunya.text().slice(0, 200)} | ${hrefs(sudahPunya).join(", ")}`,
    );
    check(
      "baris workspace sendiri tanpa error konsol",
      sudahPunya.newErrors().length === 0,
      sudahPunya.newErrors().join(" | ").slice(0, 200),
    );
    await sudahPunya.unmount();
    withoutSession();
  }

  // 4c. Isi stok dari halaman Produk & Stok: **Tambah produk** (stok awal) dan
  //     **Sesuaikan stok**. Keduanya pernah ada di backend tanpa jalan masuk dari
  //     UI, jadi yang diperiksa di sini bukan tampilannya melainkan alurnya:
  //     produk benar-benar lahir dengan stok awal yang diketik, lalu stok benar-
  //     benar berubah saat disesuaikan - lewat tombol yang sama dengan yang
  //     dipakai pemilik toko.
  {
    withEnterpriseSession();
    const { ProductsPage } = await server.ssrLoadModule("/src/pages/ProductsPage.tsx");
    const stockFacts = {};

    function StockProbe() {
      const store = useStore();
      stockFacts.store = store;
      stockFacts.products = store.products.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        // Kategori ikut dipantau: menggantinya harus mengubah kode di SKU.
        category: product.category,
        // Subkategori juga: ia tersimpan di produk tanpa mengubah SKU.
        subcategory: product.subcategory,
        stock: product.stock,
        images: (product.images ?? []).map((image) => image.url),
        imageIds: (product.images ?? []).map((image) => image.id),
      }));
      return null;
    }

    const ui = await renderInteractive(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ProductsPage, null),
          React.createElement(StockProbe, null),
        ),
      ),
    );

    /** Klik satu elemen lewat selektornya (mis. tombol yang punya `aria-label`). */
    async function clickSelector(selector) {
      const element = ui.query(selector);
      if (!element) throw new Error(`elemen "${selector}" tidak ada di DOM`);
      await React.act(async () => {
        element.click();
      });
    }

    const beforeCount = stockFacts.products.length;
    await ui.click("Tambah produk");
    check(
      "tombol Tambah produk membuka form produk baru (dengan kolom stok awal)",
      ui.text().includes("Produk baru") &&
        ui.text().includes("Stok awal") &&
        Boolean(ui.query('[aria-label="Stok awal produk baru"]')),
      ui.text().slice(0, 240),
    );

    await ui.fill('[aria-label="Nama produk baru"]', "Kopi Uji Stok");
    await ui.fill('[aria-label="SKU produk baru"]', "KOPIUJI");
    await ui.fill('[aria-label="Harga jual produk baru"]', "18000");
    await ui.fill('[aria-label="Stok awal produk baru"]', "50");
    check(
      "form Produk baru punya opsi unggah gambar",
      Boolean(ui.query('[aria-label="Tambah gambar produk baru"]')) &&
        ui.text().includes("Belum ada gambar dipilih"),
      ui.text().slice(-260),
    );

    /**
     * Tunggu sampai UI menyusul. Gambar diperkecil & dibaca lewat FileReader
     * (asinkron), jadi DOM-nya baru berubah beberapa langkah setelah event dikirim.
     */
    async function tungguSampai(predicate, pesan) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (predicate()) return;
        await React.act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
      }
      throw new Error(`waktu tunggu habis: ${pesan}`);
    }

    /** Pilih berkas lewat input berkas yang sama dengan yang dipakai pengguna. */
    async function pilihBerkasPada(selector, names) {
      const input = ui.query(selector);
      if (!input) throw new Error(`input berkas "${selector}" tidak ada di DOM`);
      const files = names.map(
        (name) =>
          new window.File([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])], name, {
            type: "image/jpeg",
          }),
      );
      Object.defineProperty(input, "files", { value: files, configurable: true });
      await React.act(async () => {
        input.dispatchEvent(new window.Event("change", { bubbles: true }));
      });
      await tungguSampai(
        () => !ui.text().includes("Menyiapkan…"),
        `berkas untuk "${selector}" selesai disiapkan`,
      );
    }

    await pilihBerkasPada('[aria-label="Tambah gambar produk baru"]', [
      "kopi-depan.jpg",
      "kopi-belakang.jpg",
    ]);
    check(
      "gambar yang dipilih tampil di kartu Produk baru sebelum disimpan",
      Boolean(ui.query('img[alt="Gambar 1 produk baru"]')) &&
        Boolean(ui.query('img[alt="Gambar 2 produk baru"]')) &&
        ui.text().includes("Gambar yang dipilih ikut tersimpan begitu produknya disimpan."),
      ui.text().slice(-240),
    );
    await clickSelector('[aria-label="Hapus gambar 2 produk baru"]');
    await tungguSampai(
      () =>
        Boolean(ui.query('img[alt="Gambar 1 produk baru"]')) &&
        !ui.query('img[alt="Gambar 2 produk baru"]'),
      "gambar tertunda yang dibatalkan hilang dari kartu",
    );
    check(
      "gambar yang menunggu bisa dibatalkan sebelum produknya disimpan",
      !ui.query('img[alt="Gambar 2 produk baru"]') && ui.text().includes("Sisa 7 dari 8"),
      ui.text().slice(-200),
    );
    await pilihBerkasPada('[aria-label="Tambah gambar produk baru"]', ["kopi-belakang.jpg"]);

    await ui.click("Simpan produk");
    // Produk disimpan lalu gambarnya diunggah satu per satu (FileReader +
    // unggahan), jadi tunggu sampai formnya benar-benar selesai.
    await tungguSampai(
      () =>
        !ui.text().includes("Menyimpan…") &&
        stockFacts.products.some((product) => product.sku === "KOPIUJI"),
      "produk baru beserta gambarnya selesai disimpan",
    );

    const created = stockFacts.products.find((product) => product.sku === "KOPIUJI");
    check(
      "produk baru tersimpan dengan stok awal yang diketik",
      stockFacts.products.length === beforeCount + 1 &&
        created?.name === "Kopi Uji Stok" &&
        created?.stock === 50,
      JSON.stringify(created),
    );
    check(
      "notis menyebut stok awalnya, bukan cuma nama produk",
      ui.text().includes("ditambahkan dengan stok awal 50"),
      ui.text().slice(-260),
    );
    check(
      "gambar yang dipilih di kartu Produk baru ikut tersimpan bersama produknya",
      created?.images?.length === 2 && ui.text().includes("2 gambar ikut tersimpan (2/8)"),
      `${JSON.stringify(created?.images)} | ${ui.text().slice(-200)}`,
    );
    check(
      "thumbnail gambar produk baru dirender di kolom gambar",
      Boolean(ui.query('img[alt="Gambar utama Kopi Uji Stok"]')),
      "-",
    );

    // Baris produknya harus muncul di tabel sebelum bisa disesuaikan.
    await clickSelector('[aria-label="Sesuaikan stok Kopi Uji Stok"]');
    check(
      "tombol Sesuaikan stok membuka panel penyesuaian untuk baris itu",
      ui.text().includes("Jumlah penyesuaian") && ui.text().includes("Stok jadi 50"),
      ui.text().slice(-300),
    );

    await ui.fill('[aria-label="Jumlah penyesuaian stok Kopi Uji Stok"]', "-3");
    await ui.fill('[aria-label="Catatan penyesuaian stok Kopi Uji Stok"]', "Rusak saat pengiriman");
    check(
      "pratinjau stok menghitung hasil sebelum disimpan",
      ui.text().includes("Stok jadi 47"),
      ui.text().slice(-200),
    );

    /** Tombol simpan di dalam panel: labelnya sama dengan toggle barisnya. */
    function tombolSimpanPanel() {
      return ui
        .queryAll("button")
        .filter((button) => (button.textContent ?? "").trim() === "Sesuaikan stok")
        .at(-1);
    }

    const simpan = tombolSimpanPanel();
    check("tombol simpan penyesuaian ada di DOM", Boolean(simpan), "-");
    if (simpan) {
      await React.act(async () => {
        simpan.click();
      });
    }

    const adjusted = stockFacts.products.find((product) => product.sku === "KOPIUJI");
    check(
      "stok turun sesuai penyesuaian dan panelnya tertutup",
      adjusted?.stock === 47 &&
        !ui.text().includes("Jumlah penyesuaian") &&
        ui.text().includes("Stok Kopi Uji Stok kini 47"),
      `${JSON.stringify(adjusted)} | ${ui.text().slice(-200)}`,
    );

    // Aturan yang sama dengan server: saldo negatif ditolak, dan tombolnya mati
    // sebelum itu - jadi angka mustahil tidak bisa dikirim.
    await clickSelector('[aria-label="Sesuaikan stok Kopi Uji Stok"]');
    await ui.fill('[aria-label="Jumlah penyesuaian stok Kopi Uji Stok"]', "-100");
    const tombolMati = tombolSimpanPanel();
    check(
      "penyesuaian yang membuat stok negatif tidak bisa disimpan",
      Boolean(tombolMati) && tombolMati.disabled === true,
      `disabled=${tombolMati?.disabled}`,
    );

    // 4d. Gambar produk dari kartu **edit**: unggah sampai penuh (8), coba paksa
    //     berkas ke-9, lalu hapus satu dan pakai lagi slot yang bebas. Semua lewat
    //     elemen yang sama dengan yang dipakai pemilik toko — bukan dengan
    //     memanggil store langsung. Kartu **tambah** sudah diuji di atas.
    await clickSelector('[aria-label="Sesuaikan stok Kopi Uji Stok"]');
    await clickSelector('[aria-label="Atur harga Kopi Uji Stok"]');
    const kopiGambar = () => stockFacts.products.find((product) => product.sku === "KOPIUJI");
    check(
      "kartu edit produk memuat bagian gambar dengan dua gambar yang tadi dipilih",
      ui.text().includes("Gambar produk Kopi Uji Stok") &&
        ui.text().includes("Maksimal 8 gambar per produk") &&
        ui.text().includes("2/8") &&
        Boolean(ui.query('img[alt="Gambar 1 produk Kopi Uji Stok"]')),
      ui.text().slice(-300),
    );

    await pilihBerkasPada('[aria-label="Tambah gambar produk Kopi Uji Stok"]', [
      "foto-3.jpg",
      "foto-4.jpg",
      "foto-5.jpg",
      "foto-6.jpg",
      "foto-7.jpg",
      "foto-8.jpg",
    ]);
    check(
      "enam berkas sekaligus mengisi produk sampai penuh (8 gambar)",
      kopiGambar()?.images.length === 8,
      String(kopiGambar()?.images.length),
    );
    check(
      "saat penuh, kartunya menyebut penuh dan input-nya mati",
      ui.text().includes("Penuh (8 gambar)") &&
        ui.query('[aria-label="Tambah gambar produk Kopi Uji Stok"]')?.disabled === true,
      `disabled=${ui.query('[aria-label="Tambah gambar produk Kopi Uji Stok"]')?.disabled}`,
    );

    // Dipaksa pun (event `change` dikirim ke input yang sedang mati), aturan yang
    // sama menolaknya: batas 8 bukan hanya soal tombolnya.
    await pilihBerkasPada('[aria-label="Tambah gambar produk Kopi Uji Stok"]', ["foto-9.jpg"]);
    check(
      "berkas ke-9 tidak menambah gambar",
      kopiGambar()?.images.length === 8,
      String(kopiGambar()?.images.length),
    );
    check(
      "penolakan gambar ke-9 dijelaskan ke pengguna",
      ui.text().includes("Gambar produk maksimal 8"),
      ui.text().slice(-200),
    );

    await clickSelector('[aria-label="Hapus gambar 2 produk Kopi Uji Stok"]');
    await tungguSampai(() => kopiGambar()?.images.length === 7, "gambar terhapus");
    check(
      "gambar bisa dihapus satu per satu dari kartu edit",
      kopiGambar()?.images.length === 7 && ui.text().includes("kini 7/8"),
      `${kopiGambar()?.images.length} | ${ui.text().slice(-160)}`,
    );

    await pilihBerkasPada('[aria-label="Tambah gambar produk Kopi Uji Stok"]', ["foto-10.jpg"]);
    check(
      "slot yang dibebaskan bisa dipakai gambar baru",
      kopiGambar()?.images.length === 8,
      String(kopiGambar()?.images.length),
    );

    // 4e. SKU otomatis `PBB-<KATEGORI>-<nomor urut>`: kolom SKU boleh dibiarkan
    //     kosong — yang membuat nomornya store/server — dan tombol di sebelahnya
    //     mengisi kolom dari daftar SKU yang sudah ada supaya pemilik toko bisa
    //     melihatnya sebelum menyimpan. Keduanya diklik lewat elemen yang sama
    //     dengan yang dipakai pemilik toko.
    await ui.click("Tambah produk");
    const kolomSku = () => ui.query('[aria-label="SKU produk baru"]');
    const tombolSku = () => ui.query('[aria-label="Buat SKU otomatis"]');
    check(
      "form Produk baru punya tombol Buat SKU otomatis di samping kolom SKU",
      Boolean(kolomSku()) &&
        Boolean(tombolSku()) &&
        ui.text().includes("dibuat otomatis & unik") &&
        ui.text().includes("PBB-<KATEGORI>-<nomor urut>"),
      ui.text().slice(-300),
    );
    check(
      "kolom SKU boleh dikosongkan, dan tombolnya hidup selama kolomnya kosong",
      kolomSku()?.value === "" && tombolSku()?.disabled === false,
      `value="${kolomSku()?.value}" disabled=${tombolSku()?.disabled}`,
    );

    await clickSelector('[aria-label="Buat SKU otomatis"]');
    const skuSaran = kolomSku()?.value ?? "";
    check(
      "tombol mengisi kolom dengan SKU berseri PBB-<KATEGORI>-<nomor urut>",
      // Nilainya dibaca dari kolomnya: isi `<input>` tidak ikut `textContent`.
      /^PBB-[A-Z0-9]{3}-\d{6}$/.test(skuSaran),
      `value="${skuSaran}"`,
    );
    check(
      "tombolnya mati setelah kolom terisi — SKU yang diketik tidak ditimpa",
      tombolSku()?.disabled === true,
      `disabled=${tombolSku()?.disabled}`,
    );

    await ui.fill('[aria-label="SKU produk baru"]', "");
    check(
      "mengosongkan kembali kolom menghidupkan tombolnya lagi",
      tombolSku()?.disabled === false,
      `disabled=${tombolSku()?.disabled}`,
    );

    const skuSebelum = stockFacts.products.map((product) => product.sku);
    await ui.fill('[aria-label="Nama produk baru"]', "Produk SKU Otomatis");
    await ui.fill('[aria-label="Harga jual produk baru"]', "5000");
    await ui.click("Simpan produk");
    await tungguSampai(
      () =>
        !ui.text().includes("Menyimpan…") &&
        stockFacts.products.some((product) => product.name === "Produk SKU Otomatis"),
      "produk dengan kolom SKU kosong selesai disimpan",
    );

    const otomatis = stockFacts.products.find(
      (product) => product.name === "Produk SKU Otomatis",
    );
    check(
      "menyimpan dengan kolom SKU kosong membuat SKU otomatis yang unik",
      /^PBB-UMU-\d{6}$/.test(otomatis?.sku ?? "") &&
        !skuSebelum.includes(otomatis?.sku ?? "") &&
        new Set(stockFacts.products.map((product) => product.sku)).size ===
          stockFacts.products.length,
      JSON.stringify({ sku: otomatis?.sku, produk: stockFacts.products.length }),
    );
    check(
      "notis menyebut SKU yang benar-benar dipakai, bukan tebakan klien",
      ui.text().includes(`Produk ${otomatis?.sku} ditambahkan`),
      ui.text().slice(-260),
    );
    check(
      "dugaan tombol sama dengan nomor yang benar-benar dipakai saat kolomnya kosong",
      skuSaran === otomatis?.sku,
      `${skuSaran} vs ${otomatis?.sku}`,
    );

    // 4f. Kategori menentukan **kode di tengah** SKU, jadi mengubahnya harus ikut
    //     mengubah SKU: selama isi kolom berasal dari tombol Buat otomatis, SKU-nya
    //     mengikuti kategori baru (nomornya dipertahankan). SKU yang diketik pemilik
    //     toko berhenti mengikuti dan tidak pernah ditimpa.
    const { productSkuCategoryCode } = await server.ssrLoadModule(
      "/src/convex/lib/productSku.ts",
    );

    /** Memilih opsi `<select>` seperti pengguna (React mendengarkan event `change`). */
    async function pilihOpsi(selector, value) {
      const select = ui.query(selector);
      if (!select) throw new Error(`select "${selector}" tidak ada di DOM`);
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value",
      ).set;
      await React.act(async () => {
        setter.call(select, value);
        select.dispatchEvent(new window.Event("change", { bubbles: true }));
      });
    }

    await ui.click("Tambah produk");
    const opsiKategori = () =>
      [...ui.query('[aria-label="Kategori produk baru"]').querySelectorAll("option")]
        .map((option) => option.value)
        .filter((value) => value.length > 0 && value !== "Tanpa kategori");
    const kategoriA = opsiKategori()[0];
    const kategoriB = opsiKategori()[1];
    check(
      "form Produk baru menyediakan pilihan kategori untuk diuji",
      Boolean(kategoriA) && Boolean(kategoriB),
      JSON.stringify({ kategoriA, kategoriB }),
    );

    await clickSelector('[aria-label="Buat SKU otomatis"]');
    const skuTanpaKategori = kolomSku()?.value ?? "";
    await pilihOpsi('[aria-label="Kategori produk baru"]', kategoriA);
    const skuIkutKategori = kolomSku()?.value ?? "";
    check(
      "mengganti kategori membuat SKU ikut kategori barunya, nomor urutnya tetap",
      skuTanpaKategori.startsWith("PBB-UMU-") &&
        skuIkutKategori ===
          `PBB-${productSkuCategoryCode(kategoriA)}-${skuTanpaKategori.slice(-6)}`,
      `${skuTanpaKategori} → ${skuIkutKategori} (kategori ${kategoriA})`,
    );

    await ui.fill('[aria-label="SKU produk baru"]', "KOPI-MANUAL-01");
    await pilihOpsi('[aria-label="Kategori produk baru"]', kategoriB);
    check(
      "SKU yang diketik sendiri berhenti mengikuti kategori & tidak ditimpa",
      kolomSku()?.value === "KOPI-MANUAL-01",
      `value="${kolomSku()?.value}" (kategori ${kategoriB})`,
    );

    // Disimpan dengan kategori A dulu supaya penggantian kategori dari kartu edit
    // di bawah benar-benar perubahan — bukan memilih nilai yang sudah sama.
    await pilihOpsi('[aria-label="Kategori produk baru"]', kategoriA);
    check(
      "SKU manual tetap utuh walau kategorinya dipilih ulang",
      kolomSku()?.value === "KOPI-MANUAL-01",
      `value="${kolomSku()?.value}" (kategori ${kategoriA})`,
    );

    await ui.fill('[aria-label="Nama produk baru"]', "Produk SKU Manual Kategori");
    await ui.fill('[aria-label="Harga jual produk baru"]', "7000");
    await ui.click("Simpan produk");
    await tungguSampai(
      () => stockFacts.products.some((product) => product.name === "Produk SKU Manual Kategori"),
      "produk dengan SKU manual tersimpan",
    );

    // 4g. Kategori juga bisa diubah dari kartu **Atur harga**; di situlah aturan
    //     SKU-nya benar-benar berlaku (nilai finalnya datang dari store).
    const produkManual = () =>
      stockFacts.products.find((product) => product.name === "Produk SKU Manual Kategori");
    await clickSelector('[aria-label="Atur harga Produk SKU Manual Kategori"]');
    check(
      "kartu edit menyediakan pilihan Kategori beserta SKU saat ini",
      Boolean(ui.query('[aria-label="Kategori produk Produk SKU Manual Kategori"]')) &&
        ui.text().includes("KOPI-MANUAL-01"),
      ui.text().slice(-300),
    );

    await pilihOpsi('[aria-label="Kategori produk Produk SKU Manual Kategori"]', kategoriB);
    check(
      "pilihan kategori di kartu edit benar-benar berubah",
      ui.query('[aria-label="Kategori produk Produk SKU Manual Kategori"]')?.value === kategoriB,
      `value="${ui.query('[aria-label="Kategori produk Produk SKU Manual Kategori"]')?.value}"`,
    );

    /** Klik Simpan harga lalu tunggu store menyusul; teks UI dikembalikan untuk jejak gagal. */
    async function simpanHarga(predicate) {
      await ui.click("Simpan harga");
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (predicate()) break;
        await React.act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
      }
      return ui.text();
    }

    const teksManual = await simpanHarga(() => produkManual()?.category === kategoriB);
    check(
      "kategori produk tersimpan dari kartu edit",
      produkManual()?.category === kategoriB,
      `kategori=${produkManual()?.category} | ${teksManual.slice(-260)}`,
    );
    check(
      "SKU yang diketik sendiri TIDAK ikut berubah saat kategori diganti dari kartu edit",
      produkManual()?.sku === "KOPI-MANUAL-01" &&
        teksManual.includes("diketik sendiri, jadi tidak ikut berubah"),
      `${JSON.stringify(produkManual())} | ${teksManual.slice(-220)}`,
    );

    const otomatisLama = () =>
      stockFacts.products.find((product) => product.name === "Produk SKU Otomatis");
    const nomorOtomatis = otomatisLama()?.sku.slice(-6);
    await clickSelector('[aria-label="Atur harga Produk SKU Otomatis"]');
    await pilihOpsi('[aria-label="Kategori produk Produk SKU Otomatis"]', kategoriB);
    const teksOtomatis = await simpanHarga(
      () => otomatisLama()?.sku === `PBB-${productSkuCategoryCode(kategoriB)}-${nomorOtomatis}`,
    );
    check(
      "SKU buatan sistem ikut kategori baru dari kartu edit (nomor dipertahankan)",
      otomatisLama()?.category === kategoriB &&
        otomatisLama()?.sku === `PBB-${productSkuCategoryCode(kategoriB)}-${nomorOtomatis}` &&
        teksOtomatis.includes("SKU ikut menyesuaikan dari"),
      `${JSON.stringify(otomatisLama())} | ${teksOtomatis.slice(-260)}`,
    );
    check(
      "mengganti kategori tidak membuat SKU kembar di katalog",
      new Set(stockFacts.products.map((product) => product.sku)).size ===
        stockFacts.products.length,
      JSON.stringify(stockFacts.products.map((product) => product.sku)),
    );

    // 4h. Kategori produk dikelola dari halaman ini: **tambah**, **ganti nama**,
    //     **nonaktifkan/aktifkan**, dan **hapus** — lewat tombol yang sama dengan
    //     yang dipakai pemilik toko. Yang diperiksa bukan tampilannya, melainkan
    //     bahwa perubahannya benar-benar sampai ke store, dampaknya dijelaskan apa
    //     adanya (kode SKU, jumlah produk yang dilepas), dan pagar aturannya tetap
    //     berlaku (nama terlarang, nama kembar).
    {
      const { categorySkuCode } = await server.ssrLoadModule("/src/lib/categories.ts");
      const kategoriStore = () => stockFacts.store.categories;
      const cariKategori = (nama) => kategoriStore().find((c) => c.name === nama);
      /**
       * Sel-sel satu baris tabel kategori. Barisnya dikenali dari **isi selnya**:
       * sel pertama memuat nama kategori (sejak subkategori bisa dibuat di bawah
       * kategori, sel ini juga memuat tombol pengelola subkategorinya), sel kedua
       * kode SKU-nya. Jadi cek “baris menampilkan kode SKU” tidak bergantung pada
       * apa pun yang kebetulan berada di sel pertama.
       */
      const barisKategori = (nama) =>
        ui
          .queryAll("tbody tr")
          .map((row) =>
            [...row.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim()),
          )
          .find(
            (cells) =>
              (cells[0] ?? "").startsWith(nama) && cells[1] === categorySkuCode(nama),
          );
      const opsiKategoriSekarang = () =>
        [...ui.query('[aria-label="Kategori produk baru"]').querySelectorAll("option")]
          .map((option) => option.value);

      await ui.click("Tambah produk");
      check(
        "kartu Kategori produk menyediakan pengelolaan bagi pemilik/manajer",
        ui.text().includes("Kategori produk") &&
          ui.text().includes("dan susunan tab di kasir") &&
          Boolean(ui.query('[aria-label="Nama kategori baru"]')),
        ui.text().slice(0, 300),
      );

      /*
        4h-bis. Master kategori **bisnis**: kalau workspace belum memilih kategori
        bisnis, halamannya harus mengatakannya terang-terangan — lengkap dengan
        jalan keluarnya (halaman Profil) dan alasan kenapa katalognya masih daftar
        bawaan lama. Sebelum ini yang tampil hanya kalimat kecil abu-abu, dan
        pemilik menyimpulkan “master kategori bisnis saya hilang”.
      */
      const master = ui.query('[data-testid="kategori-master-kurang"]');
      check(
        "kartu kategori menyebut status master bisnis, bukan hanya tombol",
        Boolean(master) && master.getAttribute("data-state") === "tanpa-bisnis",
        master?.getAttribute("data-state") ?? "tanpa elemen",
      );
      check(
        "alasannya jelas: pilihan bisnis belum ada dan katalog masih daftar bawaan lama",
        (master?.textContent ?? "").includes("belum memilih kategori utama bisnis") &&
          (master?.textContent ?? "").includes("Kopi, Makanan, Snack, Minuman") &&
          (master?.textContent ?? "").includes("disemai"),
        (master?.textContent ?? "").slice(0, 260),
      );
      check(
        "jalan keluarnya satu klik: tautan ke halaman Profil",
        ui.query('[data-testid="kategori-pilih-bisnis"]')?.getAttribute("href") ===
          "/app/profile",
        ui.query('[data-testid="kategori-pilih-bisnis"]')?.getAttribute("href") ?? "tanpa tautan",
      );
      check(
        "tombol sinkronisasi tetap mati selama pilihan bisnis belum ada",
        ui.query('[data-testid="kategori-sinkron-bisnis"]').disabled === true,
        "status tombol sinkronisasi",
      );
      {
        const barisKopi = barisKategori("Kopi");
        check(
          "baris kategori menampilkan kode SKU-nya, bukan hanya namanya",
          barisKopi !== undefined &&
            barisKopi[1] === categorySkuCode("Kopi") &&
            barisKopi[0].startsWith("Kopi"),
          `${JSON.stringify(barisKopi)} (kode ${categorySkuCode("Kopi")})`,
        );
      }

      // --- tambah kategori -------------------------------------------------
      await ui.fill('[aria-label="Nama kategori baru"]', "Sanitasi");
      await clickSelector('[aria-label="Simpan kategori baru"]');
      await tungguSampai(() => Boolean(cariKategori("Sanitasi")), "kategori Sanitasi tersimpan");
      check(
        "kategori baru tersimpan beserta kode SKU-nya, dan bisa dipilih untuk produk baru",
        cariKategori("Sanitasi")?.active === true &&
          cariKategori("Sanitasi")?.productCount === 0 &&
          ui.text().includes(
            `Kategori Sanitasi ditambahkan — kode SKU-nya ${categorySkuCode("Sanitasi")}`,
          ) &&
          opsiKategoriSekarang().includes("Sanitasi"),
        JSON.stringify({ kategori: cariKategori("Sanitasi"), opsi: opsiKategoriSekarang() }),
      );

      // --- pagar nama ------------------------------------------------------
      await ui.fill('[aria-label="Nama kategori baru"]', "sanitasi");
      await clickSelector('[aria-label="Simpan kategori baru"]');
      check(
        "nama kategori kembar ditolak sebelum dikirim ke store",
        ui.text().includes("sudah ada di workspace ini") &&
          kategoriStore().filter((c) => c.name.toLowerCase() === "sanitasi").length === 1,
        ui.text().slice(-260),
      );
      await ui.fill('[aria-label="Nama kategori baru"]', "Tanpa kategori");
      await clickSelector('[aria-label="Simpan kategori baru"]');
      check(
        "nama “Tanpa kategori” ditolak karena berarti “produk tanpa kategori”",
        ui.text().includes("dipakai sistem untuk produk tanpa kategori") &&
          !kategoriStore().some((c) => c.name === "Tanpa kategori"),
        ui.text().slice(-260),
      );

      // --- ganti nama: SKU lama tidak ditulis ulang ------------------------
      const skuSebelumGantiNama = stockFacts.products
        .filter((product) => product.category === "Kopi")
        .map((product) => ({ id: product.id, sku: product.sku }));
      check(
        "ada produk di kategori Kopi untuk menguji ganti nama",
        skuSebelumGantiNama.length > 0,
        JSON.stringify(skuSebelumGantiNama),
      );

      await clickSelector('[aria-label="Ubah nama kategori Kopi"]');
      await ui.fill('[aria-label="Nama baru kategori Kopi"]', "Pangan");
      await clickSelector('[aria-label="Simpan nama kategori Kopi"]');
      await tungguSampai(() => Boolean(cariKategori("Pangan")), "kategori Kopi berganti nama");
      const skuSesudahGantiNama = stockFacts.products
        .filter((product) => product.category === "Pangan")
        .map((product) => ({ id: product.id, sku: product.sku }));
      check(
        "ganti nama kategori memindahkan namanya, bukan produknya",
        skuSesudahGantiNama.length === skuSebelumGantiNama.length &&
          skuSesudahGantiNama.every((row, index) =>
            row.id === skuSebelumGantiNama[index].id && row.sku === skuSebelumGantiNama[index].sku,
          ),
        JSON.stringify({ sebelum: skuSebelumGantiNama, sesudah: skuSesudahGantiNama }),
      );
      check(
        "halaman mengatakan kode SKU lama TIDAK ditulis ulang",
        ui.text().includes(`${categorySkuCode("Kopi")} → ${categorySkuCode("Pangan")}`) &&
          ui.text().includes("SKU yang sudah ada tidak ditulis ulang"),
        ui.text().slice(-320),
      );
      await clickSelector('[aria-label="Ubah nama kategori Sanitasi"]');
      await ui.fill('[aria-label="Nama baru kategori Sanitasi"]', "Sanitasi & Kebersihan");
      await clickSelector('[aria-label="Simpan nama kategori Sanitasi"]');
      await tungguSampai(
        () => Boolean(cariKategori("Sanitasi & Kebersihan")),
        "kategori Sanitasi berganti nama panjang",
      );
      check(
        "ganti nama yang kodenya tetap dijelaskan sebagai tidak berubah",
        ui.text().includes(
          `Kode SKU-nya tidak berubah (${categorySkuCode("Sanitasi & Kebersihan")})`,
        ),
        ui.text().slice(-260),
      );

      // --- nonaktifkan & aktifkan kembali ----------------------------------
      await clickSelector('[aria-label="Nonaktifkan kategori Pangan"]');
      await tungguSampai(() => cariKategori("Pangan")?.active === false, "kategori Pangan nonaktif");
      check(
        "kategori nonaktif hilang dari pemilih produk baru",
        !opsiKategoriSekarang().includes("Pangan"),
        opsiKategoriSekarang().join(", "),
      );
      check(
        "produk yang sudah memakai kategori nonaktif tetap ada & ditandai",
        skuSesudahGantiNama.length > 0 &&
          stockFacts.products.filter((product) => product.category === "Pangan").length ===
            skuSesudahGantiNama.length &&
          ui.text().includes("kategori nonaktif"),
        ui.text().slice(-320),
      );
      check(
        "notis menyebut produk lama tetap dijual, bukan ikut mati",
        ui.text().includes("yang sudah memakainya tetap dijual"),
        ui.text().slice(-320),
      );
      // Produk contoh “Kopi Susu Gula Aren” ikut berpindah nama kategorinya, jadi
      // kartu Atur harga-nya yang dipakai membuktikan kategori nonaktif tetap
      // terpilih (tidak diam-diam berpindah ke “Tanpa kategori”).
      const produkDiPangan = stockFacts.products.find(
        (product) => product.category === "Pangan" && product.name === "Kopi Susu Gula Aren",
      );
      await clickSelector('[aria-label="Atur harga Kopi Susu Gula Aren"]');
      check(
        "produk di kategori nonaktif masih menampilkan kategorinya (ditandai nonaktif)",
        Boolean(produkDiPangan) &&
          [
            ...ui
              .query('[aria-label="Kategori produk Kopi Susu Gula Aren"]')
              .querySelectorAll("option"),
          ]
            .map((option) => (option.textContent ?? "").trim())
            .includes("Pangan (nonaktif)"),
        ui.text().slice(-260),
      );
      await clickSelector('[aria-label="Aktifkan kategori Pangan"]');
      await tungguSampai(() => cariKategori("Pangan")?.active === true, "kategori Pangan aktif lagi");
      check(
        "kategori bisa diaktifkan kembali dan muncul lagi di pemilih",
        opsiKategoriSekarang().includes("Pangan") &&
          ui.text().includes("diaktifkan kembali dan bisa dipakai produk baru"),
        ui.text().slice(-260),
      );

      // --- kode SKU yang bentrok diberitahukan -----------------------------
      await ui.fill('[aria-label="Nama kategori baru"]', "Makmur");
      await clickSelector('[aria-label="Simpan kategori baru"]');
      await tungguSampai(() => Boolean(cariKategori("Makmur")), "kategori Makmur tersimpan");
      check(
        "kategori dengan kode SKU yang sama diberitahukan (bukan dilarang)",
        categorySkuCode("Makmur") === categorySkuCode("Makanan") &&
          ui.text().includes(
            `Kode SKU ${categorySkuCode("Makmur")} dipakai Makanan & Makmur`,
          ),
        ui.text().slice(0, 400),
      );

      // --- subkategori: dibuat di bawah kategori, dipilih di form produk ---
      {
        const subkategoriStore = () => stockFacts.store.subcategories;
        const cariSub = (nama) => subkategoriStore().find((row) => row.name === nama);

        // Kategori ujinya sudah berganti nama di atas, jadi label tombolnya ikut
        // memakai nama panjang — sekaligus membuktikan panel ini mengikuti nama
        // kategori terbaru, bukan nama lama.
        const INDUK = "Sanitasi & Kebersihan";
        await clickSelector(`[aria-label="Atur subkategori kategori ${INDUK}"]`);
        check(
          "panel subkategori terbuka di bawah kategorinya",
          ui.text().includes(`Subkategori di bawah ${INDUK}`) &&
            Boolean(ui.query(`[aria-label="Nama subkategori baru di bawah ${INDUK}"]`)),
          ui.text().slice(-400),
        );

        await ui.fill(`[aria-label="Nama subkategori baru di bawah ${INDUK}"]`, "  Sabun   Cair ");
        await clickSelector(`[aria-label="Simpan subkategori baru di bawah ${INDUK}"]`);
        await tungguSampai(() => Boolean(cariSub("Sabun Cair")), "subkategori Sabun Cair tersimpan");
        check(
          "subkategori tersimpan di bawah kategori induknya (namanya dirapikan)",
          cariSub("Sabun Cair")?.categoryId === cariKategori(INDUK)?.id &&
            cariSub("Sabun Cair")?.active === true &&
            cariSub("Sabun Cair")?.productCount === 0,
          JSON.stringify(cariSub("Sabun Cair")),
        );

        // Nama kembar di kategori yang sama ditolak aturan yang sama dengan kategori.
        await ui.fill(`[aria-label="Nama subkategori baru di bawah ${INDUK}"]`, "sabun cair");
        await clickSelector(`[aria-label="Simpan subkategori baru di bawah ${INDUK}"]`);
        check(
          "subkategori kembar di kategori yang sama ditolak dengan pesannya",
          ui.text().includes("sudah ada di kategori ini") &&
            subkategoriStore().filter((row) => row.name === "Sabun Cair").length === 1,
          ui.text().slice(-260),
        );

        // Form Produk baru: subkategorinya muncul setelah kategori induknya dipilih.
        await pilihOpsi('[aria-label="Kategori produk baru"]', INDUK);
        // Opsi “Tanpa subkategori” bernilai kosong, jadi labelnya yang dibaca.
        const opsiSub = () =>
          [...ui.query('[aria-label="Subkategori produk baru"]').querySelectorAll("option")].map(
            (option) => (option.textContent ?? "").trim(),
          );
        await tungguSampai(
          () => opsiSub().includes("Sabun Cair"),
          "pilihan subkategori muncul di form produk",
        );
        check(
          "form produk menawarkan subkategori di bawah kategori yang dipilih",
          opsiSub().some((label) => label.startsWith("Tanpa subkategori")) &&
            opsiSub().includes("Sabun Cair"),
          JSON.stringify(opsiSub()),
        );
        await pilihOpsi('[aria-label="Kategori produk baru"]', "Makmur");
        check(
          "subkategori kategori lain tidak ikut ditawarkan",
          !opsiSub().includes("Sabun Cair"),
          JSON.stringify(opsiSub()),
        );

        await pilihOpsi('[aria-label="Kategori produk baru"]', INDUK);
        await ui.fill('[aria-label="Nama produk baru"]', "Produk Bersubkategori");
        await ui.fill('[aria-label="Harga jual produk baru"]', "9000");
        await pilihOpsi('[aria-label="Subkategori produk baru"]', "Sabun Cair");
        await ui.click("Simpan produk");
        await tungguSampai(
          () => stockFacts.products.some((product) => product.name === "Produk Bersubkategori"),
          "produk bersubkategori tersimpan",
        );
        const produkSub = () =>
          stockFacts.products.find((product) => product.name === "Produk Bersubkategori");
        check(
          "produk menyimpan subkategori di bawah kategorinya",
          produkSub()?.category === INDUK && produkSub()?.subcategory === "Sabun Cair",
          JSON.stringify(produkSub()),
        );
        check(
          "jumlah produk per subkategori dihitung dari produk yang memakainya",
          cariSub("Sabun Cair")?.productCount === 1,
          JSON.stringify(cariSub("Sabun Cair")),
        );
      }

      // --- hapus kategori --------------------------------------------------
      await clickSelector('[aria-label="Hapus kategori Makmur"]');
      check(
        "konfirmasi hapus kategori kosong menyebut tidak ada produk",
        ui.text().includes("tidak dipakai produk mana pun") &&
          Boolean(ui.query('[aria-label="Konfirmasi hapus kategori Makmur"]')),
        ui.text().slice(-260),
      );
      await clickSelector('[aria-label="Batal hapus kategori Makmur"]');
      check(
        "membatalkan hapus membiarkan kategorinya utuh",
        Boolean(cariKategori("Makmur")) &&
          !ui.query('[aria-label="Konfirmasi hapus kategori Makmur"]'),
        JSON.stringify(cariKategori("Makmur")),
      );

      const jumlahPangan = stockFacts.products.filter((product) => product.category === "Pangan").length;
      await clickSelector('[aria-label="Hapus kategori Pangan"]');
      check(
        "konfirmasi hapus menyebut jumlah produk yang akan dilepas",
        ui.text().includes(`${jumlahPangan} produk`) &&
          ui.text().includes("SKU-nya tidak ditulis ulang"),
        ui.text().slice(-320),
      );
      await clickSelector('[aria-label="Konfirmasi hapus kategori Pangan"]');
      await tungguSampai(() => !cariKategori("Pangan"), "kategori Pangan terhapus");
      check(
        "hapus kategori melepas produknya tanpa menghapus produk atau SKU-nya",
        stockFacts.products.length > jumlahPangan &&
          stockFacts.products
            .filter((product) => skuSesudahGantiNama.some((row) => row.id === product.id))
            .every(
              (product) =>
                product.category === "Tanpa kategori" &&
                skuSesudahGantiNama.some((row) => row.id === product.id && row.sku === product.sku),
            ) &&
          ui.text().includes(`${jumlahPangan} produk menjadi`),
        JSON.stringify({ pangan: jumlahPangan, dilepas: stockFacts.products.filter((p) => p.category === "Tanpa kategori").length }),
      );
      check(
        "pengelolaan kategori tidak memunculkan error konsol",
        ui.newErrors().length === 0,
        ui.newErrors().join(" | ").slice(0, 200),
      );
    }

    await ui.unmount();
    withoutSession();
  }

  // 4h-bis. Master kategori produk bisa **disesuaikan dengan kategori bisnis**
  //         dari halaman ini: tombolnya menyemai preset bisnis itu (kafe → Kopi,
  //         Non-Kopi, Makanan Ringan, Makanan Utama, Bahan Baku) tanpa mengubah
  //         kategori yang sudah ada, dan tekanan kedua mengaku katalognya sudah
  //         sesuai — bukan menambah baris lagi.
  {
    const { ProductsPage } = await server.ssrLoadModule("/src/pages/ProductsPage.tsx");
    const { useStore } = await server.ssrLoadModule("/src/lib/store/context.ts");

    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        user: { name: "Pemilik Kafe", email: "kafe@mesinpos.test" },
        tenant: {
          name: "Kafe Uji Preset",
          slug: "kafe-uji-preset",
          storeName: "Pusat",
          vertical: "fnb",
          verticals: ["fnb"],
          planKey: "professional",
          role: "owner",
          createdAt: new Date().toISOString(),
          trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
          businessCategory: {
            category: "fnb",
            categoryLabel: "Makanan & Minuman",
            subcategory: "kafe",
            subcategoryLabel: "Kafe & Kedai Kopi",
            lockedAt: Date.now(),
            lockedBy: "kafe@mesinpos.test",
          },
        },
      }),
    );

    const presetFacts = {};
    function PresetProbe() {
      presetFacts.store = useStore();
      presetFacts.categories = presetFacts.store.categories.map((row) => ({ ...row }));
      presetFacts.subcategories = presetFacts.store.subcategories.map((row) => ({ ...row }));
      return null;
    }

    const ui = await renderInteractive(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ProductsPage, null),
          React.createElement(PresetProbe, null),
        ),
      ),
    );

    const sebelum = presetFacts.categories.map((row) => row.name);
    const tombolSinkron = () => ui.query('[data-testid="kategori-sinkron-bisnis"]');
    check(
      "kartu kategori menawarkan penyesuaian dengan kategori bisnis (dengan label pilihannya)",
      Boolean(tombolSinkron()) &&
        tombolSinkron()?.disabled === false &&
        ui.text().includes("Makanan & Minuman — Kafe & Kedai Kopi"),
      ui.text().slice(0, 400),
    );

    await React.act(async () => {
      tombolSinkron()?.click();
    });
    const sesudah = presetFacts.categories.map((row) => row.name);
    check(
      "penyesuaian menyemai kategori preset kafe tanpa menyentuh kategori lama",
      ["Kopi", "Non-Kopi", "Makanan Ringan", "Makanan Utama", "Bahan Baku"].every((name) =>
        sesudah.includes(name),
      ) && sebelum.every((name) => sesudah.includes(name)),
      JSON.stringify({ sebelum, sesudah }),
    );
    check(
      "subkategori preset ikut lahir (di kategori lama maupun baru)",
      ["Kopi Susu", "Manual Brew", "Teh"].every((name) =>
        presetFacts.subcategories.some((row) => row.name === name),
      ),
      JSON.stringify(presetFacts.subcategories.map((row) => row.name)),
    );
    check(
      "hasilnya dijelaskan apa adanya, termasuk jumlah & kategori bisnisnya",
      (ui.query('[data-testid="kategori-sinkron-pesan"]')?.textContent ?? "").includes(
        "dibuat mengikuti kategori bisnis Makanan & Minuman — Kafe & Kedai Kopi",
      ),
      ui.query('[data-testid="kategori-sinkron-pesan"]')?.textContent ?? "(tidak ada pesan)",
    );
    check(
      "kategori tidak digandakan oleh penyesuaian",
      new Set(sesudah).size === sesudah.length,
      JSON.stringify(sesudah),
    );

    await React.act(async () => {
      tombolSinkron()?.click();
    });
    const sesudahKedua = presetFacts.categories.map((row) => row.name);
    check(
      "tekanan kedua mengaku katalog sudah sesuai dan tidak menambah baris",
      sesudahKedua.length === sesudah.length &&
        (ui.query('[data-testid="kategori-sinkron-pesan"]')?.textContent ?? "").includes(
          "sudah sesuai",
        ),
      ui.query('[data-testid="kategori-sinkron-pesan"]')?.textContent ?? "(tidak ada pesan)",
    );
    check(
      "penyesuaian kategori bisnis tanpa error konsol",
      ui.newErrors().length === 0,
      ui.newErrors().join(" | ").slice(0, 200),
    );
    await ui.unmount();
    withoutSession();
  }

  // 4i. Tab kategori di POS memakai aturan yang sama dengan pengelolaannya:
  //     kategori aktif tampil, kategori nonaktif yang **masih dipakai** produk
  //     tetap punya tabnya (produknya tetap dijual), dan kategori nonaktif tanpa
  //     produk hilang dari tab.
  {
    withEnterpriseSession();
    const { PosPage } = await server.ssrLoadModule("/src/pages/PosPage.tsx");
    const posFacts = {};

    function PosProbe() {
      posFacts.store = useStore();
      posFacts.products = posFacts.store.products.map((product) => product.category);
      return null;
    }

    const pos = await renderInteractive(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(PosPage, null),
          React.createElement(PosProbe, null),
        ),
      ),
    );
    const tabPos = () =>
      [...pos.queryAll("button")]
        .map((button) => (button.textContent ?? "").trim())
        .filter((label) => posFacts.store.categories.some((c) => c.name === label));

    const terpakai = posFacts.store.categories.find((c) => c.productCount > 0);
    await React.act(async () => {
      await posFacts.store.createCategory({ name: "Sanitasi Kosong" });
    });
    const kosong = posFacts.store.categories.find((c) => c.name === "Sanitasi Kosong");
    check(
      "kategori baru tampil sebagai tab di POS",
      Boolean(terpakai) && Boolean(kosong) && tabPos().includes("Sanitasi Kosong"),
      JSON.stringify({ terpakai, kosong, tab: tabPos() }),
    );

    await React.act(async () => {
      await posFacts.store.setCategoryActive(terpakai.id, false);
      await posFacts.store.setCategoryActive(kosong.id, false);
    });
    check(
      "kategori nonaktif yang masih dipakai produk tetap punya tab",
      tabPos().includes(terpakai.name),
      `${terpakai.name} · tab=${tabPos().join(", ")}`,
    );
    check(
      "kategori nonaktif tanpa produk hilang dari tab",
      !tabPos().includes("Sanitasi Kosong"),
      tabPos().join(", "),
    );
    check(
      "memilih produk tetap bisa dilakukan dari tab kategori lama",
      posFacts.products.some((category) => category === terpakai.name),
      posFacts.products.join(", "),
    );
    check(
      "halaman POS tanpa error konsol setelah kategori dinonaktifkan",
      pos.newErrors().length === 0,
      pos.newErrors().join(" | ").slice(0, 200),
    );
    await pos.unmount();
    withoutSession();
  }

  // 4j. Tanpa izin `category.manage`, halaman tetap bisa dipakai tetapi
  //     kategorinya hanya bisa dilihat: staf gudang mengurus produk, bukan
  //     strukturnya.
  {
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        ...ENTERPRISE_SESSION,
        tenant: { ...ENTERPRISE_SESSION.tenant, role: "inventory" },
      }),
    );
    const { ProductsPage } = await server.ssrLoadModule("/src/pages/ProductsPage.tsx");
    const gudang = await renderInteractive(providers(React.createElement(ProductsPage, null)));
    const tombolGudang = [...gudang.queryAll("button")].map((button) => button.textContent ?? "");
    const aksiKategoriGudang = gudang
      .queryAll("button")
      .map((button) => button.getAttribute("aria-label") ?? "")
      .filter((label) => label.includes("kategori"));
    check(
      "staf gudang tidak ditawari aksi kategori apa pun",
      !gudang.query('[aria-label="Nama kategori baru"]') && aksiKategoriGudang.length === 0,
      `aksi kategori: ${aksiKategoriGudang.join(" | ") || "(tidak ada)"} | ${tombolGudang.join(" | ").slice(0, 200)}`,
    );
    const aksiProdukGudang = gudang
      .queryAll("button")
      .map((button) => button.getAttribute("aria-label") ?? "")
      .filter((label) => /^(Nonaktifkan|Aktifkan|Hapus) produk /.test(label));
    check(
      "staf gudang tetap boleh mengurus produk tersimpan (nonaktifkan/aktifkan/hapus)",
      aksiProdukGudang.length > 0,
      aksiProdukGudang.join(" | ").slice(0, 200),
    );
    check(
      "staf gudang tetap bisa melihat kategori & membuat produk",
      gudang.text().includes("Kategori produk") &&
        gudang.text().includes("butuh peran manajer/pemilik") &&
        tombolGudang.some((label) => label.includes("Tambah produk")),
      gudang.text().slice(0, 260),
    );
    check(
      "halaman Produk untuk staf gudang tanpa error konsol",
      gudang.newErrors().length === 0,
      gudang.newErrors().join(" | ").slice(0, 200),
    );
    await gudang.unmount();
    withoutSession();
  }

  // 4k. Produk yang **sudah tersimpan** bisa dirapikan dari halaman yang sama:
  //     ubah identitas (nama/SKU/harga beli), **nonaktifkan/aktifkan**, dan
  //     **hapus** — lewat tombol yang benar-benar diklik pemilik toko. Yang
  //     diperiksa: perubahannya sampai ke store, produk nonaktif hilang dari
  //     katalog penjualan (kasir) tetapi tetap ada di tabel pengelolaan, dan pagar
  //     hapus membuat produk yang masih dipakai ditawari **nonaktifkan**, bukan
  //     gagal setelah tombol Hapus ditekan.
  {
    withEnterpriseSession();
    const { ProductsPage } = await server.ssrLoadModule("/src/pages/ProductsPage.tsx");
    const kelolaFacts = {};

    function KelolaProbe() {
      const store = useStore();
      kelolaFacts.store = store;
      kelolaFacts.catalog = store.catalogProducts.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        cost: product.cost,
        active: product.active,
        stock: product.stock,
      }));
      // Katalog penjualan = yang benar-benar ditawarkan kasir.
      kelolaFacts.dijual = store.products.map((product) => product.id);
      return null;
    }

    const ui = await renderInteractive(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ProductsPage, null),
          React.createElement(KelolaProbe, null),
        ),
      ),
    );

    async function klikKelola(selector) {
      const element = ui.query(selector);
      if (!element) throw new Error(`elemen "${selector}" tidak ada di DOM`);
      await React.act(async () => {
        element.click();
      });
    }

    async function tungguKelola(predicate, pesan) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (predicate()) return;
        await React.act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
      }
      throw new Error(`waktu tunggu habis: ${pesan}`);
    }

    /** Baris tabel satu produk (teks sel-selnya melekat tanpa spasi). */
    const barisProduk = (produk) =>
      ui
        .queryAll("tbody tr")
        .map((row) => (row.textContent ?? "").trim())
        .find((teks) => teks.startsWith(`${produk.sku}${produk.name}`));
    const produkKelola = (sku) => kelolaFacts.catalog.find((product) => product.sku === sku);

    const target = kelolaFacts.catalog.find((product) => product.stock > 0 && product.active);
    check(
      "tabel Produk memuat seluruh katalog dan menyebut mana yang aktif",
      Boolean(target) &&
        ui.text().includes(
          `${kelolaFacts.catalog.length} produk (${kelolaFacts.dijual.length} aktif)`,
        ) &&
        Boolean(ui.query(`[aria-label="Hapus produk ${target.name}"]`)),
      `${kelolaFacts.catalog.length} produk / ${kelolaFacts.dijual.length} aktif | ${ui.text().slice(0, 200)}`,
    );
    check(
      "baris produk menyebut status jualnya, bukan hanya stoknya",
      (barisProduk(target) ?? "").includes("Dijual di kasir"),
      barisProduk(target),
    );

    // --- nonaktifkan & aktifkan kembali ------------------------------------
    await klikKelola(`[aria-label="Nonaktifkan produk ${target.name}"]`);
    await tungguKelola(() => produkKelola(target.sku)?.active === false, "produk dinonaktifkan");
    check(
      "nonaktif menghilangkan produk dari katalog kasir tanpa menghapusnya dari tabel",
      Boolean(produkKelola(target.sku)) &&
        !kelolaFacts.dijual.includes(target.id) &&
        (barisProduk(target) ?? "").includes("Nonaktif"),
      `${JSON.stringify(produkKelola(target.sku))} | dijual=${kelolaFacts.dijual.length}`,
    );
    check(
      "notis menyebut produknya hilang dari kasir dan datanya tetap ada",
      ui.text().includes("hilang dari kasir") && ui.text().includes("tetap memuatnya"),
      ui.text().slice(-320),
    );

    await klikKelola(`[aria-label="Aktifkan produk ${target.name}"]`);
    await tungguKelola(() => produkKelola(target.sku)?.active === true, "produk aktif kembali");
    check(
      "produk bisa diaktifkan kembali dan langsung kembali ke kasir",
      kelolaFacts.dijual.includes(target.id) &&
        (barisProduk(target) ?? "").includes("Dijual di kasir") &&
        ui.text().includes("diaktifkan kembali dan bisa dijual lagi"),
      ui.text().slice(-260),
    );

    // --- ubah identitas: nama, SKU, harga beli ------------------------------
    await klikKelola(`[aria-label="Atur harga ${target.name}"]`);
    check(
      "kartu produk tersimpan menyediakan kolom nama, SKU, dan harga beli",
      Boolean(ui.query(`[aria-label="Nama produk ${target.name}"]`)) &&
        Boolean(ui.query(`[aria-label="SKU produk ${target.name}"]`)) &&
        Boolean(ui.query(`[aria-label="Harga beli ${target.name}"]`)),
      ui.text().slice(-320),
    );

    await ui.fill(`[aria-label="Nama produk ${target.name}"]`, "Kopi Uji Kelola");
    await ui.fill(`[aria-label="SKU produk ${target.name}"]`, "KELOLA-01");
    await ui.fill(`[aria-label="Harga beli ${target.name}"]`, "9000");
    await ui.click("Simpan harga");
    await tungguKelola(() => Boolean(produkKelola("KELOLA-01")), "identitas produk tersimpan");
    check(
      "nama, SKU, dan harga beli benar-benar tersimpan (harga jual tidak ikut berubah)",
      produkKelola("KELOLA-01")?.name === "Kopi Uji Kelola" &&
        produkKelola("KELOLA-01")?.cost === 9000 &&
        !produkKelola(target.sku),
      JSON.stringify(produkKelola("KELOLA-01")),
    );
    check(
      "notis menyebut kolom yang benar-benar berubah beserta SKU barunya",
      ui.text().includes("Nama produk kini “Kopi Uji Kelola”") &&
        ui.text().includes("SKU kini KELOLA-01") &&
        ui.text().includes("Perubahan tersimpan"),
      ui.text().slice(-360),
    );

    // SKU tetap unik: memakai SKU produk lain ditolak sebelum apa pun tersimpan.
    const lain = kelolaFacts.catalog.find((product) => product.sku !== "KELOLA-01");
    await klikKelola(`[aria-label="Atur harga Kopi Uji Kelola"]`);
    await ui.fill(`[aria-label="SKU produk Kopi Uji Kelola"]`, lain.sku.toLowerCase());
    await ui.click("Simpan harga");
    await tungguKelola(
      () => ui.text().includes("sudah dipakai produk lain"),
      "SKU kembar ditolak",
    );
    check(
      "SKU kembar ditolak tanpa mengubah produknya (huruf besar-kecil pun dihitung kembar)",
      produkKelola("KELOLA-01")?.sku === "KELOLA-01" &&
        kelolaFacts.catalog.filter((product) => product.sku === lain.sku).length === 1 &&
        ui.text().includes("sudah dipakai produk lain"),
      `${produkKelola("KELOLA-01")?.sku} | ${ui.text().slice(-240)}`,
    );
    await ui.fill(`[aria-label="SKU produk Kopi Uji Kelola"]`, "KELOLA-01");
    await klikKelola(`[aria-label="Atur harga Kopi Uji Kelola"]`);

    // --- pagar hapus: produk yang sudah dipakai ----------------------------
    await klikKelola(`[aria-label="Hapus produk Kopi Uji Kelola"]`);
    await tungguKelola(
      () => ui.text().includes("tidak bisa dihapus karena"),
      "pagar hapus produk terpakai tampil",
    );
    check(
      "produk yang masih ada stoknya tidak bisa dihapus, dan alasannya disebut",
      produkKelola("KELOLA-01") !== undefined &&
        ui.text().includes("tidak bisa dihapus karena") &&
        ui.text().includes("sesuaikan stoknya ke 0 dulu") &&
        ui.text().includes("Nonaktifkan saja"),
      ui.text().slice(-420),
    );
    check(
      "tombol Hapus produk mati selama produknya masih dipakai",
      ui.query('[aria-label="Konfirmasi hapus produk Kopi Uji Kelola"]')?.disabled === true &&
        Boolean(ui.query('[aria-label="Nonaktifkan saja Kopi Uji Kelola"]')),
      `disabled=${ui.query('[aria-label="Konfirmasi hapus produk Kopi Uji Kelola"]')?.disabled}`,
    );

    // Tombol “Nonaktifkan saja” di dialog menjalankan jalur pembersihan yang aman.
    await klikKelola('[aria-label="Nonaktifkan saja Kopi Uji Kelola"]');
    await tungguKelola(
      () => produkKelola("KELOLA-01")?.active === false,
      "produk dinonaktifkan dari dialog hapus",
    );
    check(
      "dialog menutup setelah nonaktifkan dan produknya hilang dari kasir",
      !ui.query('[aria-label="Konfirmasi hapus produk Kopi Uji Kelola"]') &&
        !kelolaFacts.dijual.includes(target.id) &&
        ui.text().includes("hilang dari kasir"),
      ui.text().slice(-260),
    );

    // --- hapus produk yang memang belum dipakai ----------------------------
    await ui.click("Tambah produk");
    await ui.fill('[aria-label="Nama produk baru"]', "Produk Uji Hapus");
    await ui.fill('[aria-label="SKU produk baru"]', "UJIHAPUS");
    await ui.fill('[aria-label="Harga jual produk baru"]', "4000");
    await ui.fill('[aria-label="Stok awal produk baru"]', "0");
    await ui.click("Simpan produk");
    await tungguKelola(() => Boolean(produkKelola("UJIHAPUS")), "produk baru tanpa stok tersimpan");
    check(
      "produk uji dibuat tanpa stok (jadi pagar hapusnya hanya soal pemakaian)",
      produkKelola("UJIHAPUS")?.stock === 0 && ui.text().includes("ditambahkan tanpa stok awal"),
      `${JSON.stringify(produkKelola("UJIHAPUS"))} | ${ui.text().slice(-200)}`,
    );

    await klikKelola('[aria-label="Hapus produk Produk Uji Hapus"]');
    await tungguKelola(
      () => ui.text().includes("belum pernah terjual"),
      "pagar hapus produk bersih tampil",
    );
    check(
      "produk yang belum pernah dipakai boleh dihapus, dan tombolnya hidup",
      ui.query('[aria-label="Konfirmasi hapus produk Produk Uji Hapus"]')?.disabled === false &&
        !ui.query('[aria-label="Nonaktifkan saja Produk Uji Hapus"]'),
      `disabled=${ui.query('[aria-label="Konfirmasi hapus produk Produk Uji Hapus"]')?.disabled}`,
    );

    await klikKelola('[aria-label="Konfirmasi hapus produk Produk Uji Hapus"]');
    await tungguKelola(
      () => !produkKelola("UJIHAPUS") && !ui.text().includes("belum pernah terjual"),
      "produk bersih terhapus",
    );
    check(
      "produk yang layak dihapus benar-benar hilang dari katalog",
      !produkKelola("UJIHAPUS") &&
        !kelolaFacts.catalog.some((product) => product.name === "Produk Uji Hapus") &&
        ui.text().includes("UJIHAPUS) dihapus"),
      ui.text().slice(-320),
    );
    check(
      "pengelolaan produk tersimpan tidak memunculkan error konsol",
      ui.newErrors().length === 0,
      ui.newErrors().join(" | ").slice(0, 200),
    );

    await ui.unmount();
    withoutSession();
  }

  // 4l. Gambar produk di halaman kasir. Yang diperiksa: foto produk benar-benar
  //     dirender sebagai gambar di kartu produk (bukan cuma disimpan di store),
  //     produk yang belum punya foto memakai penanda “belum ada gambar” alih-alih
  //     kotak kosong, baris keranjang ikut menampilkan thumbnail produknya, dan
  //     katalog yang sama sekali belum punya gambar tetap memakai kartu ringkas
  //     seperti semula (tidak ada kotak gambar kosong di semua kartu).
  {
    withEnterpriseSession();
    const kasirGambarFacts = {};

    function KasirGambarProbe() {
      const store = useStore();
      kasirGambarFacts.store = store;
      kasirGambarFacts.produk = store.products.map((product) => ({
        id: product.id,
        name: product.name,
        images: (product.images ?? []).map((image) => image.url),
      }));
      return null;
    }

    const kasir = await renderInteractive(
      providers(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(PosPage, null),
          React.createElement(KasirGambarProbe, null),
        ),
      ),
    );

    check(
      "kasir tanpa gambar produk tidak menggambar kotak gambar kosong",
      kasir.queryAll('img[alt^="Gambar produk "]').length === 0 &&
        !kasir.text().includes("Belum ada gambar"),
      `${kasir.queryAll('img[alt^="Gambar produk "]').length} gambar di kartu produk`,
    );

    const sasaran = kasirGambarFacts.produk[0];
    await React.act(async () => {
      await kasirGambarFacts.store.addProductImage(
        sasaran.id,
        new window.File([new Uint8Array([137, 80, 78, 71, 9, 9, 9, 9])], "kasir.jpg", {
          type: "image/jpeg",
        }),
      );
    });

    check(
      "foto produk dirender sebagai gambar di kartu kasir",
      Boolean(kasir.query(`img[alt="Gambar produk ${sasaran.name}"]`)),
      kasir.text().slice(0, 240),
    );
    check(
      "produk yang belum punya foto ditandai, bukan dibiarkan kosong",
      kasir.queryAll('img[alt^="Gambar produk "]').length === 1 &&
        Boolean(kasir.query(`[aria-label="Belum ada gambar ${kasirGambarFacts.produk[1]?.name}"]`)),
      `${kasir.queryAll('img[alt^="Gambar produk "]').length} gambar · ${kasir.queryAll('[aria-label^="Belum ada gambar "]').length} penanda`,
    );

    // Kartu produknya tetap tombol yang sama: mengkliknya menambah ke keranjang,
    // dan baris keranjangnya ikut menampilkan thumbnail produk itu.
    const kartuSasaran = kasir
      .queryAll("button")
      .find((button) => (button.textContent ?? "").includes(sasaran.name));
    check("kartu produk dengan gambar masih bisa diklik", Boolean(kartuSasaran), sasaran.name);
    if (kartuSasaran) {
      await React.act(async () => {
        kartuSasaran.click();
      });
    }
    check(
      "baris keranjang menampilkan thumbnail produk yang ditambahkan",
      kasir.text().includes("Keranjang kosong") === false &&
        Boolean(kasir.query(`img[alt="Gambar produk ${sasaran.name}"]`)),
      kasir.text().slice(-260),
    );
    check(
      "halaman kasir dengan gambar produk tanpa error konsol",
      kasir.newErrors().length === 0,
      kasir.newErrors().join(" | ").slice(0, 200),
    );
    await kasir.unmount();
    withoutSession();
  }

  // 4f. Setelan PPN (`billing.manage`): tarifnya bisa diubah besar/kecil dan
  //     PPN-nya bisa dimatikan — dan setelan itu benar-benar menggerakkan angka
  //     di kasir serta tagihan langganan, bukan sekadar label di halaman.
  {
    const { formatIDR } = await server.ssrLoadModule("/src/lib/utils.ts");
    // Teks DOM dirapikan (`\s+` → spasi biasa), sedangkan `Intl` menulis “Rp”
    // dengan spasi tak-terpisah — disamakan dulu supaya yang dibandingkan benar.
    const money = (value) => formatIDR(value).replace(/\s+/g, " ");
    const { SettingsPage } = await server.ssrLoadModule("/src/pages/SettingsPage.tsx");
    const { SubscriptionPage } = await server.ssrLoadModule(
      "/src/pages/SubscriptionPage.tsx",
    );
    const { PLANS, computeTax } = await server.ssrLoadModule("/src/lib/billing/index.ts");

    const taxSession = (taxActive, taxRatePct) => ({
      user: { name: "Uji PPN", email: "ppn@mesinpos.test" },
      tenant: {
        name: "Toko Uji PPN",
        slug: "toko-uji-ppn",
        storeName: "Pusat",
        vertical: "umkm",
        verticals: ["umkm"],
        planKey: "professional",
        role: "owner",
        taxActive,
        taxRatePct,
        createdAt: new Date().toISOString(),
        trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
      },
    });
    const withTaxSession = (taxActive, taxRatePct) =>
      window.localStorage.setItem(
        "mesinpos.session.v1",
        JSON.stringify(taxSession(taxActive, taxRatePct)),
      );
    const savedTax = () =>
      JSON.parse(window.localStorage.getItem("mesinpos.session.v1") ?? "null")?.tenant ?? {};

    // (a) Setelan yang tersimpan tampil apa adanya, berikut contoh perhitungannya.
    withTaxSession(true, 11);
    const pengaturan = await renderInteractive(
      providers(React.createElement(SettingsPage, null)),
    );
    check(
      "halaman Pengaturan menampilkan setelan PPN yang sedang berlaku",
      pengaturan.text().includes("Setelan PPN") &&
        pengaturan.text().includes("PPN 11%") &&
        pengaturan.text().includes("PPN dipungut"),
      pengaturan.text().slice(0, 320),
    );
    check(
      "contoh perhitungan memakai tarif tersimpan (100.000 → pajak 11.000)",
      pengaturan.text().includes(money(11_000)) &&
        pengaturan.text().includes(money(111_000)),
      pengaturan.text().slice(0, 420),
    );
    check(
      "tarif PPN terisi dari setelan, bukan angka karangan halaman",
      pengaturan.query("#tax-rate")?.value === "11",
      pengaturan.query("#tax-rate")?.value ?? "(tanpa kolom)",
    );

    // (b) Tarif diubah — angka Indonesia dengan koma — lalu disimpan.
    await pengaturan.fill("#tax-rate", "12,5");
    check(
      "pratinjau ikut berubah sebelum disimpan",
      pengaturan.text().includes("12,5%") &&
        pengaturan.text().includes(money(12_500)),
      pengaturan.text().slice(0, 420),
    );
    await pengaturan.click("Simpan setelan PPN");
    check(
      "tarif baru benar-benar tersimpan (12,5%)",
      savedTax().taxRatePct === 12.5 && savedTax().taxActive === true,
      JSON.stringify(savedTax()),
    );
    check(
      "perubahan setelan diberitahukan, bukan senyap",
      pengaturan.text().includes("PPN aktif dengan tarif 12,5%"),
      pengaturan.text().slice(0, 300),
    );

    // (c) Aktif dengan tarif 0% ditolak — dan penolakannya tidak menyentuh
    //     setelan yang sudah tersimpan.
    await pengaturan.fill("#tax-rate", "0");
    await pengaturan.click("Simpan setelan PPN");
    check(
      "aktif dengan tarif 0% ditolak dengan alasan yang menyebut solusinya",
      pengaturan.text().includes("tidak bisa 0% selama PPN-nya aktif"),
      pengaturan.text().slice(0, 420),
    );
    check(
      "penolakan tidak mengubah setelan yang tersimpan",
      savedTax().taxRatePct === 12.5 && savedTax().taxActive === true,
      JSON.stringify(savedTax()),
    );

    // (d) PPN dimatikan: tarifnya tetap tersimpan, tapi tidak lagi dipungut.
    await pengaturan.click("Matikan PPN");
    await pengaturan.click("Simpan setelan PPN");
    check(
      "PPN bisa dimatikan dari halaman Pengaturan",
      savedTax().taxActive === false && savedTax().taxRatePct === 12.5,
      JSON.stringify(savedTax()),
    );
    check(
      "kalimat nonaktif menyebut penjualan lama tidak berubah",
      pengaturan.text().includes("Penjualan lama tidak berubah"),
      pengaturan.text().slice(0, 320),
    );
    check(
      "halaman Pengaturan tanpa error konsol",
      pengaturan.newErrors().length === 0,
      pengaturan.newErrors().join(" | ").slice(0, 200),
    );
    await pengaturan.unmount();

    // (e) Kasir dengan PPN dimatikan: tidak ada baris pajak, dan totalnya utuh.
    const kasirMati = await renderInteractive(
      providers(React.createElement(PosPage, null)),
    );
    await kasirMati.click("Cappuccino");
    check(
      "kasir tanpa PPN: baris PPN hilang, bukan menampilkan 0",
      kasirMati.text().includes("PPN tidak dipungut") &&
        !kasirMati.text().includes("PPN 12") &&
        !kasirMati.text().includes("PPN 11"),
      kasirMati.text().slice(-320),
    );
    check(
      "kasir tanpa PPN: total sama dengan harga barangnya",
      kasirMati.text().includes(money(28_000)),
      kasirMati.text().slice(-320),
    );
    check(
      "kasir tanpa PPN tanpa error konsol",
      kasirMati.newErrors().length === 0,
      kasirMati.newErrors().join(" | ").slice(0, 200),
    );
    await kasirMati.unmount();

    // (f) Kasir dengan PPN aktif: tarifnya yang dihitung, dan berubah tanpa muat
    //     ulang — karena kasir membaca setelan yang sama dengan halaman Pengaturan.
    withTaxSession(true, 12);
    const kasirHidup = await renderInteractive(
      providers(React.createElement(PosPage, null)),
    );
    await kasirHidup.click("Cappuccino");
    check(
      "kasir memakai tarif setelan (12%), bukan tarif bawaan 11%",
      kasirHidup.text().includes("PPN 12%") &&
        kasirHidup.text().includes(money(3_360)) &&
        kasirHidup.text().includes(money(31_360)) &&
        !kasirHidup.text().includes("PPN 11%"),
      kasirHidup.text().slice(-320),
    );
    check(
      "kasir dengan PPN aktif tanpa error konsol",
      kasirHidup.newErrors().length === 0,
      kasirHidup.newErrors().join(" | ").slice(0, 200),
    );
    await kasirHidup.unmount();

    // (g) Tagihan langganan ikut satu setelan yang sama — satu workspace tidak
    //     menampilkan dua angka PPN yang berbeda (lihat `billing.createInvoice`).
    withTaxSession(false, 12.5);
    const tagihanMati = await renderInteractive(
      providers(React.createElement(SubscriptionPage, null)),
    );
    check(
      "tagihan langganan tanpa PPN saat setelannya dimatikan",
      tagihanMati.text().includes(`+ PPN ${money(0)}`),
      tagihanMati.text().slice(0, 420),
    );
    await tagihanMati.unmount();

    withTaxSession(true, 12);
    const monthly = PLANS.professional.price?.monthly ?? 0;
    const tagihanHidup = await renderInteractive(
      providers(React.createElement(SubscriptionPage, null)),
    );
    check(
      "PPN tagihan langganan memakai tarif setelan workspace",
      tagihanHidup.text().includes(`+ PPN ${money(computeTax(monthly, 12).tax)}`),
      tagihanHidup.text().slice(0, 420),
    );
    check(
      "halaman langganan tanpa error konsol",
      tagihanHidup.newErrors().length === 0,
      tagihanHidup.newErrors().join(" | ").slice(0, 200),
    );
    await tagihanHidup.unmount();
    withoutSession();
  }

  // 4g. Pajak & pungutan F&B: PBJT (pajak daerah) menggantikan PPN di struk,
  //     biaya layanan berdiri sebagai barisnya sendiri, pengecualian usaha mikro
  //     membebaskan PBJT, dan ringkasan setoran bulanan dihitung dari omzet yang
  //     benar-benar tercatat di aplikasi. Setelannya benar-benar tersimpan di
  //     sesi workspace yang sama dengan yang dibaca kasir — bukan label halaman.
  {
    const { PosPage } = await server.ssrLoadModule("/src/pages/PosPage.tsx");
    const { SettingsPage } = await server.ssrLoadModule("/src/pages/SettingsPage.tsx");
    const { formatIDR } = await server.ssrLoadModule("/src/lib/utils.ts");
    // Teks DOM dirapikan (`\s+` → spasi biasa), sedangkan `Intl` menulis “Rp”
    // dengan spasi tak-terpisah — disamakan dulu supaya yang dibandingkan benar.
    const money = (value) => formatIDR(value).replace(/\s+/g, " ");

    const fnbSession = (profile, taxActive = true, taxRatePct = 12) => ({
      user: { name: "Uji F&B", email: "fnb@mesinpos.test" },
      tenant: {
        name: "Kafe Uji F&B",
        slug: "kafe-uji-fnb",
        storeName: "Pusat",
        vertical: "fnb",
        verticals: ["fnb"],
        planKey: "professional",
        role: "owner",
        taxActive,
        taxRatePct,
        fnbTaxProfile: profile,
        createdAt: new Date().toISOString(),
        trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
      },
    });
    const withFnbSession = (profile, taxActive, taxRatePct) =>
      window.localStorage.setItem(
        "mesinpos.session.v1",
        JSON.stringify(fnbSession(profile, taxActive, taxRatePct)),
      );
    const savedFnb = () =>
      JSON.parse(window.localStorage.getItem("mesinpos.session.v1") ?? "null")?.tenant
        ?.fnbTaxProfile ?? null;

    // (a) Belum dipungut → PBJT & biaya layanan dinyalakan, lalu disimpan.
    withFnbSession(null);
    const fnbSettings = await renderInteractive(
      providers(React.createElement(SettingsPage, null)),
    );
    check(
      "kartu pajak F&B tampil dengan keadaan awal “belum dipungut”",
      fnbSettings.text().includes("Pajak & pungutan F&B") &&
        fnbSettings.text().includes("PBJT belum dipungut"),
      fnbSettings.text().slice(0, 320),
    );
    await fnbSettings.click("Nyalakan PBJT");
    check(
      "kolom tarif PBJT muncul beserta batas 10% dari Perda",
      Boolean(fnbSettings.query("#fnb-regional-rate")) &&
        fnbSettings.text().includes("maksimal 10%"),
      fnbSettings.text().slice(0, 420),
    );
    await fnbSettings.fill("#fnb-regional-rate", "10");
    await fnbSettings.click("Nyalakan biaya layanan");
    await fnbSettings.fill("#fnb-service-rate", "7");
    check(
      "pratinjau struk mengikuti setelan yang diketik (100.000 + 7.000 + 10.000)",
      fnbSettings.text().includes(money(117_000)) &&
        fnbSettings.text().includes("PBJT") &&
        fnbSettings.text().includes("biaya layanan"),
      fnbSettings.text().slice(0, 420),
    );
    await fnbSettings.click("Simpan setelan pajak F&B");
    check(
      "setelan PBJT 10% & biaya layanan 7% benar-benar tersimpan",
      savedFnb()?.regionalActive === true &&
        savedFnb()?.regionalRatePct === 10 &&
        savedFnb()?.serviceChargeActive === true &&
        savedFnb()?.serviceChargePct === 7,
      JSON.stringify(savedFnb()),
    );
    check(
      "perubahan setelan F&B diberitahukan, termasuk bahwa biaya layanan bukan pajak",
      fnbSettings.text().includes("PBJT 10% dipungut dari pelanggan di struk") &&
        fnbSettings.text().includes("insentif karyawan (bukan pajak)"),
      fnbSettings.text().slice(0, 420),
    );

    // Ringkasan setoran: PBJT-nya 10% dari omzet bulan yang tertulis di kartu itu.
    const omzetTeks = fnbSettings.text().match(/omzet\s+Rp ([\d.]+)/);
    const omzetBulan = omzetTeks ? Number(omzetTeks[1].replace(/\./g, "")) : 0;
    check(
      "ringkasan setoran bulan ini memakai omzet yang tercatat",
      omzetBulan > 0 && fnbSettings.text().includes("Ringkasan setoran bulan ini"),
      `${omzetBulan} · ${fnbSettings.text().slice(0, 240)}`,
    );
    check(
      "PBJT di ringkasan = 10% dari omzet bulan ini",
      omzetBulan > 0 && fnbSettings.text().includes(money(Math.round(omzetBulan * 0.1))),
      `${money(Math.round(omzetBulan * 0.1))} tidak ada di ringkasan`,
    );
    check(
      "ringkasan memisahkan biaya layanan (bukan pajak) dari setoran pajak",
      fnbSettings.text().includes("Biaya layanan (bukan pajak)") &&
        fnbSettings.text().includes("SE-04/BW/1999"),
      fnbSettings.text().slice(0, 420),
    );
    check(
      "halaman Pengaturan dengan pajak F&B tanpa error konsol",
      fnbSettings.newErrors().length === 0,
      fnbSettings.newErrors().join(" | ").slice(0, 200),
    );
    await fnbSettings.unmount();

    // (b) Kasir: PBJT menggantikan PPN, dan biaya layanan terpisah dari pajak.
    const kasirFnb = await renderInteractive(
      providers(React.createElement(PosPage, null)),
    );
    await kasirFnb.click("Cappuccino");
    check(
      "kasir memungut PBJT 10%, bukan PPN 12%",
      kasirFnb.text().includes("PBJT 10%") &&
        !kasirFnb.text().includes("PPN 12%") &&
        kasirFnb.text().includes(money(2_800)),
      kasirFnb.text().slice(-320),
    );
    check(
      "biaya layanan 7% jadi barisnya sendiri di kasir",
      kasirFnb.text().includes("Biaya layanan 7%") &&
        kasirFnb.text().includes(money(1_960)),
      kasirFnb.text().slice(-320),
    );
    check(
      "total kasir = barang 28.000 + biaya layanan 1.960 + PBJT 2.800",
      kasirFnb.text().includes(money(32_760)),
      kasirFnb.text().slice(-320),
    );
    check(
      "kasir menjelaskan PPN pusat tidak dipungut untuk makanan/minuman",
      kasirFnb.text().includes("PPN pusat tidak dipungut"),
      kasirFnb.text().slice(-420),
    );
    check(
      "kasir dengan PBJT tanpa error konsol",
      kasirFnb.newErrors().length === 0,
      kasirFnb.newErrors().join(" | ").slice(0, 200),
    );
    await kasirFnb.unmount();

    // (c) “Aktif 0%” ditolak: setelan yang tersimpan tidak ikut berubah.
    withFnbSession({
      regionalActive: true,
      regionalRatePct: 10,
      serviceChargeActive: true,
      serviceChargePct: 7,
    });
    const fnbTolak = await renderInteractive(
      providers(React.createElement(SettingsPage, null)),
    );
    await fnbTolak.fill("#fnb-regional-rate", "0");
    check(
      "PBJT aktif dengan tarif 0% ditolak dengan alasan yang menyebut solusinya",
      fnbTolak.text().includes("tidak bisa 0% selama pajak daerahnya aktif"),
      fnbTolak.text().slice(0, 420),
    );
    check(
      "tombol simpan mati selama setelannya tidak sah",
      fnbTolak
        .queryAll("button")
        .filter((button) => (button.textContent ?? "").includes("Simpan setelan pajak F&B"))
        .every((button) => button.disabled === true),
      "tombol simpan masih hidup",
    );
    check(
      "setelan yang tersimpan tidak berubah oleh setelan tidak sah",
      savedFnb()?.regionalRatePct === 10 && savedFnb()?.serviceChargePct === 7,
      JSON.stringify(savedFnb()),
    );
    await fnbTolak.unmount();

    // (d) Pengecualian usaha mikro: PBJT berhenti dipungut, dan peringatannya
    //     muncul begitu omzet bulan ini melewati batas yang disetel. Biaya
    //     layanannya sengaja dimatikan di sini supaya total kasir murni
    //     membuktikan PPN-nya kembali dipungut.
    withFnbSession({
      regionalActive: true,
      regionalRatePct: 10,
      serviceChargeActive: false,
      serviceChargePct: 7,
    });
    const fnbMikro = await renderInteractive(
      providers(React.createElement(SettingsPage, null)),
    );
    await React.act(async () => {
      fnbMikro.query("#fnb-micro-exempt").click();
    });
    await fnbMikro.fill("#fnb-micro-below", "1000000");
    await fnbMikro.click("Simpan setelan pajak F&B");
    check(
      "pengecualian usaha mikro tersimpan beserta batas omzetnya",
      savedFnb()?.microExemptActive === true && savedFnb()?.microExemptBelowIdr === 1_000_000,
      JSON.stringify(savedFnb()),
    );
    check(
      "omzet di atas batas diperingatkan, bukan didiamkan",
      fnbMikro.text().includes("sudah melewati batas Rp 1.000.000"),
      fnbMikro.text().slice(0, 420),
    );
    await fnbMikro.unmount();

    const kasirMikro = await renderInteractive(
      providers(React.createElement(PosPage, null)),
    );
    await kasirMikro.click("Cappuccino");
    check(
      "kasir menyebut alasan PBJT tidak dipungut saat pengecualian usaha mikro menyala",
      kasirMikro.text().includes("PBJT tidak dipungut karena pengecualian usaha mikro"),
      kasirMikro.text().slice(-320),
    );
    check(
      "PPN kembali dipungut selama PBJT tidak berlaku (28.000 + 12%)",
      kasirMikro.text().includes("PPN 12%") && kasirMikro.text().includes(money(31_360)),
      kasirMikro.text().slice(-320),
    );
    check(
      "kasir dengan pengecualian mikro tanpa error konsol",
      kasirMikro.newErrors().length === 0,
      kasirMikro.newErrors().join(" | ").slice(0, 200),
    );
    await kasirMikro.unmount();
    withoutSession();
  }

  // 4h. Setelan struk belanja: jenis printer (thermal / dot matrix / portable),
  //     lebar kertas, rangkap, dan catatan kakinya diatur di halaman Pengaturan,
  //     lalu **dipakai kasir saat mencetak** — bukan label di halaman saja.
  {
    const { PosPage } = await server.ssrLoadModule("/src/pages/PosPage.tsx");
    const { SettingsPage } = await server.ssrLoadModule("/src/pages/SettingsPage.tsx");
    const { formatIDR } = await server.ssrLoadModule("/src/lib/utils.ts");
    const money = (value) => formatIDR(value).replace(/\s+/g, " ");

    const strukSession = (receipt, logoUrl, verticals = ["umkm"]) => ({
      user: { name: "Uji Struk", email: "struk@mesinpos.test" },
      tenant: {
        name: "Warung Uji Struk",
        slug: "warung-uji-struk",
        storeName: "Cabang Struk",
        vertical: verticals[0],
        verticals,
        planKey: "professional",
        role: "owner",
        taxActive: true,
        taxRatePct: 11,
        ...(receipt ? { receipt } : {}),
        ...(logoUrl ? { logoUrl } : {}),
        createdAt: new Date().toISOString(),
        trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
      },
    });
    const withStrukSession = (receipt, logoUrl, verticals = ["umkm"]) =>
      window.localStorage.setItem(
        "mesinpos.session.v1",
        JSON.stringify(strukSession(receipt, logoUrl, verticals)),
      );
    const savedStruk = () =>
      JSON.parse(window.localStorage.getItem("mesinpos.session.v1") ?? "null")?.tenant
        ?.receipt ?? null;
    /** Logo toko yang tersimpan di sesi (mode demo menyimpannya sebagai data URL). */
    const savedLogo = () =>
      JSON.parse(window.localStorage.getItem("mesinpos.session.v1") ?? "null")?.tenant
        ?.logoUrl ?? null;

    /**
     * Tunggu sampai UI menyusul. Logo diperkecil & dibaca lewat FileReader
     * (asinkron), jadi DOM-nya baru berubah beberapa langkah setelah event dikirim.
     */
    async function tungguSampai(predicate, pesan) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (predicate()) return;
        await React.act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
      }
      throw new Error(`waktu tunggu habis: ${pesan}`);
    }

    /** Pilih berkas logo lewat input berkas yang sama dengan yang dipakai pengguna. */
    async function pilihBerkasLogo(names) {
      const input = strukSettings.query('[aria-label="Pilih berkas logo toko"]');
      if (!input) throw new Error('input berkas logo tidak ada di DOM');
      const files = names.map(
        (name) =>
          new window.File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, {
            type: "image/png",
          }),
      );
      Object.defineProperty(input, "files", { value: files, configurable: true });
      await React.act(async () => {
        input.dispatchEvent(new window.Event("change", { bubbles: true }));
      });
      await tungguSampai(
        () => !strukSettings.text().includes("Menyiapkan…"),
        "berkas logo selesai disiapkan",
      );
    }
    /** Baris-baris teks di dalam sebuah `<pre>` (satu baris = satu baris struk). */
    const linesOf = (element) => (element?.textContent ?? "").split("\n");

    // (a) Bawaan: thermal 80 mm sekali cetak, dengan katalog tiga jenis printer
    //     beserta keterangannya. Pratinjaunya benar-benar selebar 80 mm.
    withStrukSession(null);
    const strukSettings = await renderInteractive(
      providers(React.createElement(SettingsPage, null)),
    );
    check(
      "halaman Pengaturan menampilkan kartu struk belanja dengan bawaan thermal 80 mm",
      strukSettings.text().includes("Struk belanja") &&
        strukSettings.text().includes("80 mm · 48 kolom"),
      strukSettings.text().slice(0, 320),
    );
    check(
      "tiga jenis printer ditawarkan beserta cara kerja, kelebihan, kekurangan, dan contoh produknya",
      ["Thermal", "Dot matrix", "Portable", "Cara kerja", "Kelebihan", "Kekurangan", "Cocok untuk", "Contoh produk"].every(
        (label) => strukSettings.text().includes(label),
      ) &&
        strukSettings.text().includes("elemen pemanas") &&
        strukSettings.text().includes("jarum-jarum kecil") &&
        strukSettings.text().includes("Epson TM-T82X") &&
        strukSettings.text().includes("Sano P58B"),
      strukSettings.text().slice(0, 420),
    );
    check(
      "pratinjau struk bawaan memakai nama usaha & cabang dari workspace-nya",
      (() => {
        const preview = strukSettings.query('[data-testid="struk-preview"]');
        return Boolean(preview) && linesOf(preview)[0].trim() === "Warung Uji Struk";
      })(),
      linesOf(strukSettings.query('[data-testid="struk-preview"]'))[0] ?? "(tanpa pratinjau)",
    );
    check(
      "pratinjau struk mencetak pembeli umum “Cash” beserta keterangannya",
      linesOf(strukSettings.query('[data-testid="struk-preview"]')).some(
        (line) => line.trim() === "Member : Cash",
      ) &&
        strukSettings.text().includes("nama member yang dipilih kasir saat bayar") &&
        strukSettings.text().includes("pembeli umum tetap punya nama di kertasnya"),
      linesOf(strukSettings.query('[data-testid="struk-preview"]'))
        .slice(3, 7)
        .join(" | "),
    );
    check(
      "setiap baris pratinjau 80 mm paling panjang 48 karakter",
      linesOf(strukSettings.query('[data-testid="struk-preview"]')).every(
        (line) => line.length <= 48,
      ),
      String(
        Math.max(
          ...linesOf(strukSettings.query('[data-testid="struk-preview"]')).map(
            (line) => line.length,
          ),
        ),
      ),
    );

    // (a2) Logo toko: diunggah dari kartu struk, tampil di pratinjau selebar kertas
    //      yang dipilih, dan benar-benar dipakai struk kasir.
    check(
      "kartu struk menawarkan logo toko beserta batasnya, dan struk bawaan tanpa logo",
      strukSettings.text().includes("Logo toko") &&
        strukSettings.text().includes("maksimal 1 MB") &&
        strukSettings.text().includes("Belum ada logo") &&
        !strukSettings.query('[data-testid="struk-preview-logo"]'),
      strukSettings.text().slice(0, 320),
    );
    await pilihBerkasLogo(["logo-toko.png"]);
    const logoGambar = strukSettings.query('[data-testid="logo-toko-gambar"]');
    const logoSebelumSimpan = savedLogo();
    check(
      "memilih berkas logo menyimpannya sebagai data URL dan menampilkannya di kartu",
      Boolean(logoGambar) &&
        (logoGambar.src ?? "").startsWith("data:image") &&
        typeof logoSebelumSimpan === "string" &&
        logoSebelumSimpan.startsWith("data:image") &&
        strukSettings.text().includes("Logo terpasang") &&
        strukSettings.text().includes("Logo tersimpan"),
      `${(logoGambar?.src ?? "(tanpa gambar)").slice(0, 40)} · ${String(logoSebelumSimpan).slice(0, 24)}`,
    );
    check(
      "pratinjau struk menggambar logo kecil (110 px × 110 px) dan hitam putih di atas nama usaha",
      (() => {
        const preview = strukSettings.query('[data-testid="struk-preview-logo"]');
        return (
          Boolean(preview) &&
          (preview.src ?? "").startsWith("data:image") &&
          (preview.style?.width ?? "") === "110px" &&
          (preview.style?.height ?? "") === "110px" &&
          String(preview.style?.filter ?? "").includes("grayscale") &&
          (preview.alt ?? "").includes("Logo toko")
        );
      })(),
      `${strukSettings.query('[data-testid="struk-preview-logo"]')?.style?.width ?? "-"} × ${strukSettings.query('[data-testid="struk-preview-logo"]')?.style?.height ?? "-"} · ${String(strukSettings.query('[data-testid="struk-preview-logo"]')?.style?.filter ?? "-")} · ${(strukSettings.query('[data-testid="struk-preview-logo"]')?.src ?? "-").slice(0, 32)}`,
    );
    check(
      "pratinjau memuat barang, diskon, PPN dari setelan workspace, dan catatan kaki",
      strukSettings.text().includes(money(48_000)) &&
        strukSettings.text().includes("PPN 11%") &&
        strukSettings.text().includes("Diskon") &&
        strukSettings.text().includes("Terima kasih telah berbelanja"),
      strukSettings.text().slice(0, 420),
    );

    // (b) Pindah ke dot matrix: lebarnya ikut berubah (76/241 mm), dan rangkap
    //     barulah mungkin — pratinjaunya menampilkan dua lembar.
    await strukSettings.clickOn('[data-testid="struk-printer-dot_matrix"]');
    check(
      "memilih dot matrix menawarkan kertas 76 mm & 241 mm, dan pratinjaunya ikut selebar 76 mm",
      Boolean(strukSettings.query('[data-testid="struk-kertas-76"]')) &&
        Boolean(strukSettings.query('[data-testid="struk-kertas-241"]')) &&
        strukSettings.text().includes("76 mm · 40 kolom") &&
        (strukSettings.query('[data-testid="struk-preview"]')?.style?.width ?? "") === "76mm",
      JSON.stringify({
        kertas76: Boolean(strukSettings.query('[data-testid="struk-kertas-76"]')),
        kertas241: Boolean(strukSettings.query('[data-testid="struk-kertas-241"]')),
        label: strukSettings.text().includes("76 mm · 40 kolom"),
        lebar: strukSettings.query('[data-testid="struk-preview"]')?.style?.width ?? "-",
      }),
    );
    check(
      "setiap baris pratinjau 76 mm paling panjang 40 karakter",
      linesOf(strukSettings.query('[data-testid="struk-preview"]')).every(
        (line) => line.length <= 40,
      ),
      String(
        Math.max(
          ...linesOf(strukSettings.query('[data-testid="struk-preview"]')).map(
            (line) => line.length,
          ),
        ),
      ),
    );
    await strukSettings.clickOn('button[aria-label="Tambah rangkap struk"]');
    check(
      "tombol + menaikkan rangkap jadi dua lembar dan tabel pratinjaunya menampilkan lembar kedua",
      (strukSettings.query('[data-testid="struk-rangkap"]')?.textContent ?? "").includes(
        "2 lembar (asli + 1 tembusan)",
      ) &&
        (strukSettings.query('[data-testid="struk-preview-2"]')?.textContent ?? "").includes(
          "TEMBUSAN 1",
        ) &&
        (strukSettings.query('[data-testid="struk-preview"]')?.textContent ?? "").includes(
          "ASLI",
        ),
      strukSettings.text().slice(0, 320),
    );

    // (c) Kertas faktur 241 mm: kolomnya 80, jadi nama produk panjang muat satu baris.
    await strukSettings.clickOn('[data-testid="struk-kertas-241"]');
    check(
      "logo tidak ikut melebar saat kertasnya jadi 241 mm (tetap 110 px)",
      (strukSettings.query('[data-testid="struk-preview-logo"]')?.style?.width ?? "") ===
        "110px",
      strukSettings.query('[data-testid="struk-preview-logo"]')?.style?.width ?? "-",
    );
    check(
      "kertas 241 mm memakai 80 kolom dan nama panjang muat satu baris",
      linesOf(strukSettings.query('[data-testid="struk-preview"]')).every(
        (line) => line.length <= 80,
      ) &&
        linesOf(strukSettings.query('[data-testid="struk-preview"]')).includes(
          "Kopi Susu Gula Aren Large",
        ),
      linesOf(strukSettings.query('[data-testid="struk-preview"]'))
        .slice(5, 9)
        .join(" | "),
    );

    // (d) Catatan kaki diketik pemilik toko, lalu semuanya disimpan.
    await strukSettings.fill('[data-testid="struk-footer"]', "WA 0812-3456 · Terima kasih");
    check(
      "catatan kaki yang diketik langsung tampil di baris terakhir pratinjau",
      linesOf(strukSettings.query('[data-testid="struk-preview"]'))
        .slice(-1)[0]
        .trim() === "WA 0812-3456 · Terima kasih",
      linesOf(strukSettings.query('[data-testid="struk-preview"]')).slice(-1)[0] ?? "-",
    );
    await strukSettings.click("Simpan setelan struk");
    check(
      "setelan struk benar-benar tersimpan di workspace (dot matrix 241 mm, 2 lembar, catatan kaki baru)",
      savedStruk()?.printerId === "dot_matrix" &&
        savedStruk()?.paperWidthMm === 241 &&
        savedStruk()?.copies === 2 &&
        savedStruk()?.footerText === "WA 0812-3456 · Terima kasih",
      JSON.stringify(savedStruk()),
    );
    check(
      "perubahan setelan struk diberitahukan dengan kalimat yang menyebut akibatnya",
      strukSettings.text().includes("printer Dot matrix") &&
        strukSettings.text().includes("2 lembar (asli + 1 tembusan)") &&
        strukSettings.text().includes("241 mm"),
      strukSettings.text().slice(0, 320),
    );

    // (e) Balik ke thermal: rangkap mustahil, jadi kontrolnya menutup sendiri dan
    //     alasannya menyebut printer yang bisa tembusan karbon.
    await strukSettings.clickOn('[data-testid="struk-printer-thermal"]');
    check(
      "memilih thermal memangkas rangkap kembali jadi satu lembar dan menjelaskan kenapa",
      (strukSettings.query('[data-testid="struk-rangkap"]')?.textContent ?? "").includes(
        "1 lembar (asli)",
      ) &&
        strukSettings.query('button[aria-label="Tambah rangkap struk"]')?.disabled === true &&
        strukSettings.text().includes("tidak ada pita karbon") &&
        strukSettings.text().includes("Dot Matrix"),
      strukSettings.text().slice(0, 420),
    );
    check(
      "halaman Pengaturan dengan setelan struk tanpa error konsol",
      strukSettings.newErrors().length === 0,
      strukSettings.newErrors().join(" | ").slice(0, 200),
    );
    await strukSettings.unmount();

    /*
      (e2) Saran setelan otomatis: dasarnya modul yang hidup, dan jawabannya
      ditawarkan sebagai satu klik. Toko grosir **tanpa** F&B disarankan jalur
      faktur (dot matrix dua rangkap) karena nota temponya diarsipkan, sedangkan
      yang memutuskan tetap pemilik toko — peramban tidak bisa melihat printer
      yang benar-benar terpasang. Menekan saran itu hanya mengubah pilihan
      mesinnya: kalimat catatan kaki yang sedang diketik tidak ikut terhapus.
    */
    // Logonya dibawa serta: sesi ini menggantikan sesi yang sedang dipakai, dan
    // bagian sesudahnya masih memakai logo yang sudah diunggah tadi.
    withStrukSession(null, savedLogo(), ["wholesale"]);
    const strukGrosir = await renderInteractive(
      providers(React.createElement(SettingsPage, null)),
    );
    check(
      "kartu saran otomatis menyebut dasar penentuannya (modul grosir) beserta alasannya",
      (strukGrosir.query('[data-testid="struk-saran-otomatis"]')?.textContent ?? "").includes(
        "Modul Grosir & Wholesale",
      ) &&
        (strukGrosir.query('[data-testid="struk-saran-alasan"]')?.textContent ?? "").includes(
          "tembusan",
        ) &&
        (strukGrosir.query('[data-testid="struk-saran-otomatis"]')?.textContent ?? "").includes(
          "Dot matrix",
        ) &&
        (strukGrosir.query('[data-testid="struk-pakai-saran"]')?.textContent ?? "").includes(
          "Pakai saran ini",
        ),
      (strukGrosir.query('[data-testid="struk-saran-otomatis"]')?.textContent ?? "").slice(0, 240),
    );
    check(
      "kartu kertas menjelaskan lebarnya menyesuaikan sendiri saat printer diganti",
      (strukGrosir.query('[data-testid="struk-kertas-otomatis"]')?.textContent ?? "").includes(
        "76 mm",
      ) &&
        (strukGrosir.query('[data-testid="struk-kertas-otomatis"]')?.textContent ?? "").includes(
          "80 mm",
        ),
      strukGrosir.query('[data-testid="struk-kertas-otomatis"]')?.textContent ?? "-",
    );
    await strukGrosir.fill('[data-testid="struk-footer"]', "Hormat kami, Toko Uji");
    await strukGrosir.clickOn('[data-testid="struk-pakai-saran"]');
    check(
      "menekan “Pakai saran ini” memindahkan mesinnya ke dot matrix 76 mm dua rangkap",
      Boolean(strukGrosir.query('[data-testid="struk-kertas-76"]')) &&
        (strukGrosir.query('[data-testid="struk-rangkap"]')?.textContent ?? "").includes(
          "2 lembar (asli + 1 tembusan)",
        ) &&
        (strukGrosir.query('[data-testid="struk-preview"]')?.style?.width ?? "") === "76mm" &&
        (strukGrosir.query('[data-testid="struk-preview-2"]')?.textContent ?? "").includes(
          "TEMBUSAN 1",
        ) &&
        (strukGrosir.query('[data-testid="struk-pakai-saran"]')?.textContent ?? "").includes(
          "Sudah sesuai",
        ),
      JSON.stringify({
        kertas76: Boolean(strukGrosir.query('[data-testid="struk-kertas-76"]')),
        rangkap: strukGrosir.query('[data-testid="struk-rangkap"]')?.textContent ?? "-",
        lebar: strukGrosir.query('[data-testid="struk-preview"]')?.style?.width ?? "-",
        tombol: strukGrosir.query('[data-testid="struk-pakai-saran"]')?.textContent ?? "-",
      }),
    );
    check(
      "saran itu tidak menghapus catatan kaki yang sedang diketik pemilik toko",
      (strukGrosir.query('[data-testid="struk-footer"]')?.value ?? "") ===
        "Hormat kami, Toko Uji" &&
        (strukGrosir.query('[data-testid="struk-preview"]')?.textContent ?? "").includes(
          "Hormat kami, Toko Uji",
        ),
      strukGrosir.query('[data-testid="struk-footer"]')?.value ?? "-",
    );
    check(
      "halaman Pengaturan dengan saran otomatis tanpa error konsol",
      strukGrosir.newErrors().length === 0,
      strukGrosir.newErrors().join(" | ").slice(0, 200),
    );
    await strukGrosir.unmount();

    // (f) Kasir mencetak bentuk yang sama: batas kolom, penanda rangkap, dan
    //     catatan kaki mengikuti setelan yang tersimpan di workspace.
    // Logo yang baru diunggah ikut dibawa: di mode demo ia tersimpan di sesi, jadi
    // langkah ini sekaligus membuktikan logonya masih ada setelah sesi dibaca ulang.
    withStrukSession(
      {
        printerId: "dot_matrix",
        paperWidthMm: 76,
        copies: 2,
        footerText: "WA 0812-3456",
      },
      savedLogo(),
    );
    const kasirStruk = await renderInteractive(
      providers(React.createElement(PosPage, null)),
    );
    await kasirStruk.click("Cappuccino");
    const cetak = kasirStruk.query('[data-testid="struk-cetak"]');
    check(
      "kasir memuat area cetak struk yang tersembunyi di layar",
      Boolean(cetak) && (cetak.className ?? "").includes("struk-cetak"),
      cetak?.className ?? "(tanpa area cetak)",
    );
    /*
      Ukuran kertas di dialog cetak datang dari setelan workspace, bukan dari
      halaman A4 bawaan peramban: halaman kasir menulis aturan `@page` sendiri
      (lebar kertas × tinggi notanya + metrik baris cetaknya). `auto` tidak boleh
      muncul di sana — bentuk itu tidak sah dan dibuang peramban tanpa pesan.
    */
    const kertasCss = kasirStruk.query('[data-testid="struk-kertas-css"]')?.textContent ?? "";
    check(
      "kasir menulis ukuran kertas struknya ke aturan @page (76 mm × tinggi notanya)",
      /@page \{ size: 76mm \d+(\.\d+)?mm; margin: 4mm; \}/.test(kertasCss),
      kertasCss.split("\n")[0] ?? "(tanpa aturan cetak)",
    );
    check(
      "tinggi kertasnya angka, bukan `auto` — dan metrik baris cetaknya ikut dari sana",
      !kertasCss.includes("auto") &&
        /\.struk-cetak pre \{ font-size: \d+(\.\d+)?mm; line-height: \d+(\.\d+)?mm; \}/.test(
          kertasCss,
        ),
      kertasCss,
    );
    check(
      "struk yang dicetak memakai nama usaha, cabang, dan catatan kaki dari setelan",
      (cetak?.textContent ?? "").includes("Warung Uji Struk") &&
        (cetak?.textContent ?? "").includes("Cabang Struk") &&
        (cetak?.textContent ?? "").includes("WA 0812-3456"),
      (cetak?.textContent ?? "").slice(0, 200),
    );
    check(
      "printer dot matrix mencetak dua lembar sekali cetak, masing-masing bertanda ASLI & TEMBUSAN 1",
      (cetak?.textContent ?? "").includes("ASLI") &&
        (cetak?.textContent ?? "").includes("TEMBUSAN 1") &&
        Boolean(kasirStruk.query('[data-testid="struk-cetak-lembar-2"]')),
      (cetak?.textContent ?? "").slice(0, 200),
    );
    // Baris diperiksa **per lembar**: pembacaan teks seluruh area cetak akan
    // menyambung baris terakhir lembar pertama dengan baris pertama lembar kedua
    // (tidak ada pemisah antar-`<pre>`), padahal di kertas keduanya terpisah.
    const lembarSatu = kasirStruk.query('[data-testid="struk-cetak-lembar-1"]');
    const lembarDua = kasirStruk.query('[data-testid="struk-cetak-lembar-2"]');
    check(
      "setiap baris struk yang dicetak paling panjang 40 karakter (kertas 76 mm)",
      [lembarSatu, lembarDua].every((sheet) =>
        linesOf(sheet).every((line) => line.length <= 40),
      ),
      String(
        Math.max(
          ...[...(linesOf(lembarSatu)), ...(linesOf(lembarDua))].map((line) => line.length),
        ),
      ),
    );
    check(
      "struk memuat barang yang diklik kasir & totalnya, dengan nominal rata kanan",
      (cetak?.textContent ?? "").includes("Cappuccino") &&
        linesOf(lembarSatu).some(
          (line) => line.startsWith("TOTAL") && line.endsWith(money(31_080)) && line.length === 40,
        ),
      linesOf(lembarSatu)
        .filter((line) => line.includes("TOTAL") || line.includes("Cappuccino"))
        .join(" | "),
    );
    check(
      "struk kasir memuat baris kasir yang melayani dan logo toko 110 px hitam putih di setiap lembarnya",
      [lembarSatu, lembarDua].every((sheet) =>
        linesOf(sheet).some((line) => line.trim() === "Kasir : Uji Struk"),
      ) &&
        [lembarSatu, lembarDua].every((sheet) =>
          linesOf(sheet).some((line) => line.trim().startsWith("Kasir :")),
        ) &&
        Boolean(kasirStruk.query('[data-testid="struk-cetak-logo-1"]')) &&
        Boolean(kasirStruk.query('[data-testid="struk-cetak-logo-2"]')) &&
        (kasirStruk.query('[data-testid="struk-cetak-logo-1"]')?.src ?? "").startsWith(
          "data:image",
        ) &&
        (kasirStruk.query('[data-testid="struk-cetak-logo-1"]')?.style?.width ?? "") ===
          "110px" &&
        (kasirStruk.query('[data-testid="struk-cetak-logo-1"]')?.style?.height ?? "") ===
          "110px" &&
        String(kasirStruk.query('[data-testid="struk-cetak-logo-1"]')?.style?.filter ?? "").includes(
          "grayscale",
        ),
      `${linesOf(lembarSatu).slice(3, 8).join(" | ")} · ${kasirStruk.query('[data-testid="struk-cetak-logo-1"]')?.style?.width ?? "-"} × ${kasirStruk.query('[data-testid="struk-cetak-logo-1"]')?.style?.height ?? "-"} · ${String(kasirStruk.query('[data-testid="struk-cetak-logo-1"]')?.style?.filter ?? "-")}`,
    );
    check(
      "kasir tidak memilih member: struk menyebut pembelinya “Cash” di kedua lembarnya",
      [lembarSatu, lembarDua].every((sheet) =>
        linesOf(sheet).some((line) => line.trim() === "Member : Cash"),
      ),
      linesOf(lembarSatu).slice(3, 7).join(" | "),
    );
    // Member dengan diskon 0 % dipilih supaya totalnya tidak berubah: yang diuji di
    // sini baris pembelinya, bukan hitungan diskonnya.
    await kasirStruk.fill('[aria-label="Cari member"]', "Rina");
    await kasirStruk.click("Rina Kartika");
    check(
      "memilih member mengganti nama pembeli di struk dengan namanya, bukan “Cash”",
      [lembarSatu, lembarDua].every((sheet) =>
        linesOf(sheet).some((line) => line.trim() === "Member : Rina Kartika"),
      ) &&
        [lembarSatu, lembarDua].every(
          (sheet) => !linesOf(sheet).some((line) => line.includes("Cash")),
        ) &&
        linesOf(lembarSatu).some(
          (line) => line.startsWith("TOTAL") && line.endsWith(money(31_080)),
        ),
      linesOf(lembarSatu).slice(3, 7).join(" | "),
    );
    /*
      Alur struk di kasir: panel keranjang baru menawarkan cetak & kirim sesudah
      pembayarannya lunas, dan tombol cetaknya lalu menyebut printer, lebar kertas,
      serta jumlah lembar dari setelan workspace di atas.
    */
    await kasirStruk.click("Bayar");
    await kasirStruk.clickOn('[data-testid="cash-cepat-100000"]');
    await kasirStruk.click("Selesaikan pembayaran");
    /*
      Logo toko ada di blok ini (data URL yang diunggah lewat input berkas di bagian
      setelan struk), sedangkan jalur bagikan memakai **satu gambar PNG** yang
      logonya sudah tergambar di dalamnya — dan DOM tiruan ini tidak punya kanvas.
      Jadi yang benar diperiksa di sini: tidak ada berkas kosong yang diserahkan,
      tidak ada klaim “diserahkan”, dan sebabnya disebut. Gambar berlogonya sendiri
      diperiksa piksel per piksel di Chromium (`verify-struk-browser.mjs`).
    */
    const dibagikanLogo = [];
    Object.defineProperty(window.navigator, "share", {
      value: async (payload) => {
        dibagikanLogo.push(payload);
      },
      configurable: true,
    });
    Object.defineProperty(window.navigator, "canShare", {
      value: (payload) => Array.isArray(payload?.files) && payload.files.length > 0,
      configurable: true,
    });
    await kasirStruk.clickOn('[data-testid="struk-bagikan-gambar"]');
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const laporanBerlogo = String(
      kasirStruk.query('[data-testid="struk-notice"]')?.textContent ?? "",
    )
      .replace(/\s+/g, " ")
      .trim();
    check(
      "tanpa kanvas, workspace berlogo pun tidak menyerahkan berkas kosong & tidak mengaku logonya ikut",
      dibagikanLogo.length === 0 &&
        laporanBerlogo.includes("belum bisa menggambar struk jadi gambar") &&
        !laporanBerlogo.includes("diserahkan") &&
        !laporanBerlogo.includes("Logo tokonya ada di dalam gambarnya") &&
        !kasirStruk.query('[data-testid="struk-error"]'),
      `${dibagikanLogo.length} pembagian · ${laporanBerlogo}`,
    );
    delete window.navigator.share;
    delete window.navigator.canShare;
    await kasirStruk.clickOn('[aria-label="Tutup struk"]');
    const judulCetak = kasirStruk.query('button[aria-label="Cetak struk"]')?.title ?? "";
    check(
      "sesudah lunas, tombol cetak di panel menyebut printer, lebar kertas, dan jumlah lembarnya",
      judulCetak.includes("Dot matrix") &&
        judulCetak.includes("76 mm") &&
        judulCetak.includes("2 lembar"),
      judulCetak || "(tanpa tombol)",
    );
    check(
      "kasir dengan struk dot matrix tanpa error konsol",
      kasirStruk.newErrors().length === 0,
      kasirStruk.newErrors().join(" | ").slice(0, 200),
    );
    await kasirStruk.unmount();

    /*
      (f1b) Logo **ada** tetapi berkasnya tidak terbaca — gambar rusak, berkasnya
      tidak terjangkau, atau URL bertanda tangan yang sudah kedaluwarsa (yang wajar
      terjadi kalau struk baru dikirim beberapa jam sesudah penjualannya). Sebelum
      ini logo seperti itu hilang tanpa sepatah kata; yang diperiksa di sini: struknya
      tetap terkirim utuh sebagai satu berkas PDF, dan laporannya menyebut sebabnya.
      URL-nya memakai skema yang tidak bisa diambil peramban maupun Node (`ftp:`),
      jadi berkasnya gagal terbaca di kedua lingkungan, bukan cuma di harness.
    */
    withStrukSession(
      {
        printerId: "dot_matrix",
        paperWidthMm: 76,
        copies: 2,
        footerText: "WA 0812-3456",
      },
      "ftp://logonya-tidak-terjangkau/logo.png",
    );
    const kasirLogoRusak = await renderInteractive(
      providers(React.createElement(PosPage, null)),
    );
    await kasirLogoRusak.click("Cappuccino");
    await kasirLogoRusak.click("Bayar");
    await kasirLogoRusak.clickOn('[data-testid="cash-cepat-100000"]');
    await kasirLogoRusak.click("Selesaikan pembayaran");
    const bagikanRusak = [];
    Object.defineProperty(window.navigator, "share", {
      value: async (payload) => {
        bagikanRusak.push(payload);
      },
      configurable: true,
    });
    Object.defineProperty(window.navigator, "canShare", {
      value: (payload) => Array.isArray(payload?.files) && payload.files.length > 0,
      configurable: true,
    });
    await kasirLogoRusak.clickOn('[data-testid="struk-bagikan-gambar"]');
    // Membaca logo yang gagal butuh beberapa giliran (bacaannya ditolak, bukan
    // langsung selesai), jadi antrean mikro-tugasnya dikuras beberapa kali.
    for (let giliran = 0; giliran < 6; giliran += 1) {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    const laporanLogoRusak = String(
      kasirLogoRusak.query('[data-testid="struk-notice"]')?.textContent ?? "",
    )
      .replace(/\s+/g, " ")
      .trim();
    check(
      "logo yang tidak terbaca tidak hilang diam-diam: tidak ada berkas kosong yang diserahkan dan sebabnya disebut",
      bagikanRusak.length === 0 &&
        laporanLogoRusak.includes("belum bisa menggambar struk jadi gambar") &&
        laporanLogoRusak.includes("Unduh PDF") &&
        !kasirLogoRusak.query('[data-testid="struk-error"]'),
      `${bagikanRusak.length} pembagian · ${laporanLogoRusak}`,
    );
    check(
      "kasir dengan logo yang tidak terbaca tanpa error konsol",
      kasirLogoRusak.newErrors().length === 0,
      kasirLogoRusak.newErrors().join(" | ").slice(0, 200),
    );
    /*
      Jalur **satu berkas gambar** (tombol “Bagikan gambar struk”): di Android,
      pasangan PDF + logo diserahkan dengan tipe intent umum dan WhatsApp bisa
      mengambil berkas pertamanya saja — satu PNG adalah jalur yang paling mungkin
      menampilkan logo, dan itulah satu-satunya jalur yang tersisa. Yang bisa diuji
      di DOM tiruan ini adalah apa yang terjadi kalau kanvasnya **tidak ada** —
      perangkatnya harus menjawab apa adanya (mengarahkan ke jalur lain), bukan
      menggantung atau menyerahkan berkas kosong — sementara gambarnya sendiri
      diperiksa di Chromium (`verify-struk-browser.mjs`).
    */
    const tombolGambar = kasirLogoRusak.query('[data-testid="struk-bagikan-gambar"]');
    check(
      "dialog struk menawarkan “Bagikan gambar struk” — satu berkas PNG, bukan pasangan berkas uji",
      Boolean(tombolGambar) &&
        (tombolGambar.title ?? "").includes("satu gambar PNG") &&
        (tombolGambar.textContent ?? "").includes("Bagikan gambar struk") &&
        !kasirLogoRusak.query('[data-testid="struk-bagikan-pdf"]'),
      tombolGambar?.title ?? "(tombolnya tidak ada)",
    );
    await kasirLogoRusak.clickOn('[data-testid="struk-bagikan-gambar"]');
    for (let giliran = 0; giliran < 4; giliran += 1) {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    const laporanTanpaKanvas = String(
      kasirLogoRusak.query('[data-testid="struk-notice"]')?.textContent ?? "",
    )
      .replace(/\s+/g, " ")
      .trim();
    check(
      "tanpa kanvas di perangkatnya, tombol gambarnya menjawab apa adanya dan tidak menyerahkan berkas apa pun",
      laporanTanpaKanvas.includes("belum bisa menggambar struk jadi gambar") &&
        laporanTanpaKanvas.includes("Unduh PDF") &&
        bagikanRusak.length === 0 &&
        !kasirLogoRusak.query('[data-testid="struk-error"]'),
      laporanTanpaKanvas,
    );
    check(
      "kasir setelah mencoba gambar struk tetap tanpa error konsol",
      kasirLogoRusak.newErrors().length === 0,
      kasirLogoRusak.newErrors().join(" | ").slice(0, 200),
    );
    delete window.navigator.share;
    delete window.navigator.canShare;
    await kasirLogoRusak.unmount();

    // (f2) Logo bisa dilepas lagi: struknya kembali dicetak tanpa logo, dan sesi
    //      mode demo tidak lagi menyimpan data URL-nya.
    const logoHalaman = await renderInteractive(
      providers(React.createElement(SettingsPage, null)),
    );
    await logoHalaman.clickOn('button[aria-label="Hapus logo toko"]');
    check(
      "tombol Hapus logo melepas logonya dari struk dan dari sesi",
      logoHalaman.text().includes("Belum ada logo") &&
        !logoHalaman.query('[data-testid="logo-toko-gambar"]') &&
        !logoHalaman.query('[data-testid="struk-preview-logo"]') &&
        savedLogo() === null &&
        logoHalaman.text().includes("Struk kembali dicetak tanpa logo"),
      logoHalaman.text().slice(0, 240),
    );
    check(
      "halaman Pengaturan setelah logo dihapus tanpa error konsol",
      logoHalaman.newErrors().length === 0,
      logoHalaman.newErrors().join(" | ").slice(0, 200),
    );
    await logoHalaman.unmount();

    // (g) Lembar gayanya benar-benar ada: di layar struk disembunyikan, dan saat
    //     mencetak hanya struknya yang terlihat.
    const css = readFileSync("src/index.css", "utf8");
    check(
      "lembar gaya menyembunyikan struk di layar dan mencetak hanya struknya",
      /\.struk-cetak\s*\{[^}]*display:\s*none/.test(css) &&
        /@media print/.test(css) &&
        /body \*\s*\{[^}]*visibility:\s*hidden/.test(css),
      "aturan cetak struk tidak ditemukan di src/index.css",
    );
    withoutSession();
  }

  // 4i. Logo toko dipakai bersama sidebar & halaman Panduan. Keduanya membaca
  //     satu sumber yang sama (store), jadi tidak boleh ada tempat yang menampilkan
  //     logo berbeda — atau diam-diam menampilkan ikon bawaan saat logonya ada.
  {
    const { AppLayout } = await server.ssrLoadModule("/src/layouts/AppLayout.tsx");
    const { PanduanPage } = await server.ssrLoadModule("/src/pages/PanduanPage.tsx");
    const logoDataUrl = "data:image/png;base64,LOGOUJI";

    const withLogoSession = (logoUrl) => {
      window.localStorage.setItem(
        "mesinpos.session.v1",
        JSON.stringify({
          user: { name: "Uji Logo", email: "logo@mesinpos.test" },
          tenant: {
            name: "Warung Uji Logo",
            slug: "warung-uji-logo",
            storeName: "Cabang Logo",
            vertical: "umkm",
            verticals: ["umkm"],
            planKey: "professional",
            role: "owner",
            ...(logoUrl ? { logoUrl } : {}),
            createdAt: new Date().toISOString(),
            trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
          },
        }),
      );
    };
    // `providers` sudah memasang router + provider sesi & store, jadi shell-nya
    // cukup halaman AppLayout-nya — merangkai router kedua kali akan ditolak React.
    const shell = () => providers(React.createElement(AppLayout, null));

    withLogoSession(logoDataUrl);
    const shellBerlogo = await renderInteractive(shell());
    const logoSidebar = shellBerlogo.query('[data-testid="sidebar-logo"]');
    check(
      "sidebar memakai logo toko sebagai penanda workspace",
      Boolean(logoSidebar) &&
        (logoSidebar.src ?? "") === logoDataUrl &&
        !shellBerlogo.query('[data-testid="sidebar-logo-kosong"]'),
      logoSidebar?.src ?? "(tidak ada logo di sidebar)",
    );
    check(
      "nama & alamat alternatif logo sidebar menyebut workspace-nya",
      (logoSidebar?.alt ?? "") === "Logo Warung Uji Logo" &&
        shellBerlogo.text().includes("Warung Uji Logo") &&
        shellBerlogo.text().includes("MesinPOS"),
      `${logoSidebar?.alt ?? "-"} · ${shellBerlogo.text().slice(0, 120)}`,
    );
    const panduanBerlogo = await renderInteractive(
      providers(React.createElement(PanduanPage, null)),
    );
    check(
      "halaman Panduan menampilkan logo workspace yang sama dengan sidebar",
      (panduanBerlogo.query('[data-testid="panduan-logo"]')?.src ?? "") === logoDataUrl &&
        panduanBerlogo.text().includes("Identitas workspace di struk & sidebar") &&
        panduanBerlogo.text().includes("Atur logo toko"),
      panduanBerlogo.query('[data-testid="panduan-logo"]')?.src ?? "(tidak ada logo)",
    );
    check(
      "sidebar & halaman Panduan dengan logo tanpa error konsol",
      shellBerlogo.newErrors().length === 0 && panduanBerlogo.newErrors().length === 0,
      [...shellBerlogo.newErrors(), ...panduanBerlogo.newErrors()].join(" | ").slice(0, 200),
    );
    await shellBerlogo.unmount();
    await panduanBerlogo.unmount();

    withLogoSession(null);
    const shellTanpaLogo = await renderInteractive(shell());
    check(
      "workspace tanpa logo memakai ikon bawaan di sidebar, bukan gambar kosong",
      Boolean(shellTanpaLogo.query('[data-testid="sidebar-logo-kosong"]')) &&
        !shellTanpaLogo.query('[data-testid="sidebar-logo"]'),
      shellTanpaLogo.query('[data-testid="sidebar-logo-kosong"]')?.className ?? "(tidak ada)",
    );
    const panduanTanpaLogo = await renderInteractive(
      providers(React.createElement(PanduanPage, null)),
    );
    check(
      "halaman Panduan menjelaskan cara memasang logo saat workspace belum punya",
      panduanTanpaLogo.text().includes("belum punya logo") &&
        panduanTanpaLogo.text().includes("Struk belanja") &&
        panduanTanpaLogo.text().includes("19 bagian · 12 gambar"),
      panduanTanpaLogo.text().slice(0, 260),
    );
    check(
      "halaman Panduan menyebut bagian printer & kertas struk di daftar isinya",
      panduanTanpaLogo
        .text()
        .replace(/\s+/g, " ")
        .includes("printer & kertas struk"),
      panduanTanpaLogo.text().replace(/\s+/g, " ").slice(0, 260),
    );
    /*
      Panduan singkat **kirim struk ke WhatsApp pembeli** ada di halaman ini
      (bukan cuma di berkas PDF): kasir membukanya dari sidebar, dan pratinjau
      PDF-nya sering tidak tampil di ponsel. Isinya harus mengikuti perilaku yang
      benar-benar ada di layar kasir — satu **gambar struk berlogo** sebagai pesan
      gambar — beserta syarat kanalnya, bukan sekadar nama tombolnya.
    */
    const panduanStruk = (panduanTanpaLogo.query('[data-testid="panduan-kirim-struk"]')
      ?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
    check(
      "halaman Panduan memuat panduan singkat kirim struk ke WhatsApp pembeli, langkah demi langkah",
      panduanStruk.includes("Kirim struk ke WhatsApp pembeli") &&
        panduanStruk.includes("gambar struk PNG berlogo") &&
        panduanStruk.includes("Nomor WhatsApp pembeli") &&
        panduanStruk.includes("disimulasikan") &&
        panduanStruk.includes("pos.sell") &&
        // Kartunya menunjuk bagian PDF tempat ringkasan yang sama hidup.
        panduanStruk.includes("bagian 18"),
      panduanStruk.slice(0, 220),
    );
    check(
      "panduan struk itu menyebut yang perlu disiapkan & jalan lain saat kanalnya belum tersambung, plus tautan ke kasir dan pengaturan",
      panduanStruk.includes("WHATSAPP_ACCESS_TOKEN") &&
        panduanStruk.includes("WHATSAPP_PHONE_NUMBER_ID") &&
        panduanStruk.includes("wa.me") &&
        panduanStruk.includes("Bagikan gambar struk") &&
        panduanStruk.includes("Unduh PDF") &&
        Boolean(
          panduanTanpaLogo.query('[data-testid="panduan-kirim-struk"] a[href="/app/pos"]'),
        ) &&
        Boolean(
          panduanTanpaLogo.query(
            '[data-testid="panduan-kirim-struk"] a[href="/app/settings"]',
          ),
        ),
      panduanStruk.slice(-220),
    );
    check(
      "sidebar & halaman Panduan tanpa logo tanpa error konsol",
      shellTanpaLogo.newErrors().length === 0 && panduanTanpaLogo.newErrors().length === 0,
      [...shellTanpaLogo.newErrors(), ...panduanTanpaLogo.newErrors()].join(" | ").slice(0, 200),
    );
    await shellTanpaLogo.unmount();
    await panduanTanpaLogo.unmount();
    withoutSession();
  }

  // 4e. Pesanan QR meja (modul F&B): kartu QR di denah meja, lalu halaman tamu
  //     yang dibuka dari tautan di kartu itu. Yang diuji di sini adalah hal yang
  //     tidak bisa dibuktikan aturan murni: tombolnya benar-benar menerbitkan
  //     tautan `/meja/<token>`, dan halaman tamu yang dirender dari tautan itu
  //     memuat menu meja tersebut sampai terbit tagihan QRIS.
  {
    const { MejaPage } = await server.ssrLoadModule("/src/pages/MejaPage.tsx");
    const { qrMatrix, isPlausibleQrMatrix } = await server.ssrLoadModule("/src/lib/qr.ts");

    withEnterpriseSession();
    const denah = await renderInteractive(providers(React.createElement(KdsPage, null)));
    const qrButtons = denah.queryAll('[data-testid^="meja-qr-"]');
    check(
      "denah meja menawarkan kartu QR untuk tiap meja aktif",
      qrButtons.length >= 5,
      `tombol QR = ${qrButtons.length}`,
    );
    check(
      "layar dapur tidak menawarkan pelunasan pesanan QR (dapur hanya melihat yang lunas)",
      denah.queryAll('[data-testid^="meja-lunasi-"]').length === 0 &&
        denah.queryAll('[data-testid^="meja-pesanan-"]').length === 0 &&
        denah.query('[data-testid^="kds-lunas-meja-"]') === null &&
        denah.query('[data-testid="meja-qr-menunggu-bayar"]') === null &&
        denah.text().includes("Pesanan QR meja masuk ke antrean ini begitu tagihannya lunas"),
      denah.text().slice(0, 240),
    );

    await denah.clickOn('[data-testid="meja-qr-t01"]');
    const url =
      denah
        .query('[data-testid="meja-qr-kartu"] svg[data-qr-value]')
        ?.getAttribute("data-qr-value") ?? "";
    // Yang diperiksa di sini bentuk **path**-nya; originnya datang dari
    // `window.location.origin` peramban yang mencetak kartunya, dan di DOM tiruan
    // origin itu tidak ada — harness browser (`verify-meja-browser.mjs`) yang
    // memeriksa tautan absolutnya.
    check(
      "kartu QR meja mengodekan tautan /meja/<token> yang sah",
      /\/meja\/mj_[0-9a-f]{32}$/.test(url),
      url,
    );
    check(
      "kode QR yang digambar benar-benar berstruktur QR",
      isPlausibleQrMatrix(qrMatrix(url)),
      "matriks bukan QR",
    );
    check(
      "kartu QR menyebut nama meja & cara pakainya",
      (denah.query('[data-testid="meja-qr-kartu"]')?.textContent ?? "").includes("QR menu meja A1"),
      denah.query('[data-testid="meja-qr-kartu"]')?.textContent?.slice(0, 120),
    );
    check(
      "denah meja & kartu QR tanpa error konsol",
      denah.newErrors().length === 0,
      denah.newErrors().join(" | ").slice(0, 200),
    );

    // Halaman tamu dibuka dari tautan di kartunya — jalur yang sama dengan
    // ponsel pembeli, hanya saja dirender di DOM tiruan.
    const token = url.split("/meja/")[1];
    const tamu = await renderInteractive(
      React.createElement(
        MemoryRouter,
        { initialEntries: [`/meja/${token}`] },
        React.createElement(
          SessionProvider,
          null,
          React.createElement(
            BackendProvider,
            null,
            React.createElement(
              StoreProvider,
              null,
              React.createElement(
                Routes,
                null,
                React.createElement(Route, {
                  path: "/meja/:token",
                  element: React.createElement(MejaPage, null),
                }),
              ),
            ),
          ),
        ),
      ),
    );

    const menuText = tamu.text();
    check(
      "halaman tamu menyapa dengan meja & menu tokonya",
      menuText.includes("Meja A1") && menuText.includes("Menu digital"),
      menuText.slice(0, 160),
    );
    check(
      "halaman tamu memuat menu dari katalog toko",
      tamu.query('[data-testid="meja-menu"]') !== null &&
        tamu.queryAll('[data-testid="meja-menu"] li').length >= 3,
      `baris menu = ${tamu.queryAll('[data-testid="meja-menu"] li').length}`,
    );

    /*
      Header sticky halaman tamu: identitas merchant harus tetap terbaca saat
      tamu menggulir menunya. Di DOM tiruan yang bisa diperiksa adalah apa yang
      ditulis elemennya — posisi `sticky`, latar tembus pandang ber-`backdrop-blur`,
      dan siapa yang tampil sebagai logonya; gaya yang benar-benar dihitung
      peramban diuji di `verify-meja-browser.mjs`.
    */
    const headerTamu = tamu.query('[data-testid="meja-header"]');
    check(
      "halaman tamu punya header sticky bertuliskan merchant, toko, & mejanya",
      headerTamu !== null &&
        (headerTamu.className ?? "").includes("sticky") &&
        (headerTamu.className ?? "").includes("backdrop-blur") &&
        (headerTamu.textContent ?? "").includes("Distribusi Uji") &&
        (headerTamu.textContent ?? "").includes("Cabang Uji") &&
        (headerTamu.textContent ?? "").includes("Meja A1") &&
        (headerTamu.textContent ?? "").includes("Menu digital"),
      (headerTamu?.textContent ?? "tidak ada header").slice(0, 160),
    );
    check(
      "tanpa logo yang diunggah, header memakai inisial nama usahanya",
      tamu.query('[data-testid="meja-header-logo-huruf"]')?.textContent === "D" &&
        tamu.query('[data-testid="meja-header-logo"]') === null,
      tamu.query('[data-testid="meja-header-logo-huruf"]')?.textContent ?? "tidak ada inisial",
    );

    // Logo merchant yang benar-benar diunggah workspace tampil di header yang sama.
    window.localStorage.setItem(
      "mesinpos.session.v1",
      JSON.stringify({
        ...ENTERPRISE_SESSION,
        tenant: {
          ...ENTERPRISE_SESSION.tenant,
          logoUrl: "https://contoh.test/logo-kopi.png",
        },
      }),
    );
    const tamuBerlogo = await renderInteractive(
      React.createElement(
        MemoryRouter,
        { initialEntries: [`/meja/${token}`] },
        React.createElement(
          SessionProvider,
          null,
          React.createElement(
            BackendProvider,
            null,
            React.createElement(
              StoreProvider,
              null,
              React.createElement(
                Routes,
                null,
                React.createElement(Route, {
                  path: "/meja/:token",
                  element: React.createElement(MejaPage, null),
                }),
              ),
            ),
          ),
        ),
      ),
    );
    check(
      "logo merchant yang diunggah tampil di header halaman tamu",
      tamuBerlogo.query('[data-testid="meja-header-logo"]')?.getAttribute("src") ===
        "https://contoh.test/logo-kopi.png" &&
        tamuBerlogo.query('[data-testid="meja-header-logo-huruf"]') === null,
      tamuBerlogo
        .query('[data-testid="meja-header-logo"]')
        ?.getAttribute("src") ?? "tidak ada logo",
    );
    await tamuBerlogo.unmount();
    // Sesi perusahaan tanpa logo dikembalikan untuk sisa blok ini.
    withEnterpriseSession();

    await tamu.clickOn('button[aria-label^="Tambah "]:not([disabled])');
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(
      "memilih menu memunculkan ringkasan keranjang bertotal",
      (tamu.query('[data-testid="meja-total-keranjang"]')?.textContent ?? "").includes(
        "Rp",
      ),
      tamu.query('[data-testid="meja-total-keranjang"]')?.textContent ?? "tidak ada total",
    );

    await tamu.clickOn('[data-testid="meja-lanjut-bayar"]');
    check(
      "lembar pesanan menawarkan dua cara bayar (QRIS & Virtual Account)",
      tamu.query('[data-testid="meja-cara-bayar"]') !== null &&
        tamu.query('[data-testid="meja-bayar-qris"]') !== null &&
        tamu.query('[data-testid="meja-bayar-va"]') !== null,
      (tamu.query('[data-testid="meja-cara-bayar"]')?.textContent ?? "tidak ada pilihan").slice(
        0,
        160,
      ),
    );
    await tamu.clickOn('[data-testid="meja-bayar-va"]');
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(
      "memilih Virtual Account memunculkan pilihan bank penerbitnya",
      (tamu.query('[data-testid="meja-bank-va"]')?.textContent ?? "").includes("BCA") &&
        tamu.query('[data-testid="meja-bank-bri"]') !== null,
      tamu.query('[data-testid="meja-bank-va"]')?.textContent ?? "tidak ada bank",
    );
    // Kembali ke QRIS: jalur pertama yang diuji di sini adalah kode terpindai.
    await tamu.clickOn('[data-testid="meja-bayar-qris"]');
    await tamu.clickOn('[data-testid="meja-kirim-pesanan"]');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const bayar = tamu.query('[data-testid="meja-pembayaran"]')?.textContent ?? "";
    check(
      "pesanan tamu menerbitkan tagihan QRIS bernomor",
      /DIG-\d{4}-\d{4}/.test(bayar) && bayar.includes("Menunggu pembayaran"),
      bayar.slice(0, 160),
    );
    const tagihan = tamu.query('[data-testid="meja-total-tagihan"]')?.textContent ?? "";
    check(
      "tamu melihat kode QRIS, nominal, dan tenggat tagihannya",
      tamu.query('[data-testid="meja-pembayaran"] svg[data-qr-value]') !== null &&
        /Rp\s*[\d.]+/.test(tagihan) &&
        bayar.includes("Berlaku"),
      `${tagihan} — ${bayar.slice(0, 120)}`,
    );
    check(
      "tombol screenshot QRIS tersedia untuk tagihan yang menunggu",
      tamu.query('[data-testid="meja-qris-screenshot"]') !== null,
      "tombol screenshot tidak ada",
    );
    await tamu.clickOn('[data-testid="meja-qris-screenshot"]');
    await new Promise((resolve) => setTimeout(resolve, 20));
    check(
      "tanpa kanvas tamu diberi tahu jalur yang tetap bekerja (bukan berkas kosong)",
      (tamu.query('[data-testid="meja-bayar-notis"]')?.textContent ?? "").includes(
        "belum bisa menggambar",
      ),
      tamu.query('[data-testid="meja-bayar-notis"]')?.textContent ?? "tidak ada notis",
    );
    /*
      Tamu yang berubah pikiran: pembatalan pesanannya sendiri harus benar-benar
      bisa dilakukan dari halaman ini (bukan lewat pelayan), tetap meminta
      konfirmasi, dan sesudahnya kode bayarnya hilang — kalau tidak, kode itu
      masih bisa dipakai membayar pesanan yang sudah dibatalkan.
    */
    check(
      "tagihan tamu menawarkan pembatalan selama uangnya belum masuk",
      tamu.query('[data-testid="meja-batal-pesanan"]') !== null,
      "tombol batalkan pesanan tidak ada",
    );
    await tamu.clickOn('[data-testid="meja-batal-pesanan"]');
    check(
      "membatalkan pesanan meminta konfirmasi & menjelaskan akibatnya",
      (tamu.query('[data-testid="meja-batal-area"]')?.textContent ?? "").includes(
        "tidak diteruskan ke dapur",
      ) && tamu.query('[data-testid="meja-batal-konfirmasi"]') !== null,
      tamu.query('[data-testid="meja-batal-area"]')?.textContent ?? "tidak ada area batal",
    );
    await tamu.clickOn('[data-testid="meja-batal-tidak"]');
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(
      "menolak konfirmasi mengembalikan pesanannya (belum dibatalkan)",
      tamu.query('[data-testid="meja-batal-konfirmasi"]') === null &&
        tamu.query('[data-testid="meja-batal-pesanan"]') !== null &&
        (tamu.query('[data-testid="meja-pembayaran"]')?.textContent ?? "").includes(
          "Menunggu pembayaran",
        ),
      tamu.query('[data-testid="meja-pembayaran"]')?.textContent?.slice(0, 160),
    );
    await tamu.clickOn('[data-testid="meja-batal-pesanan"]');
    await tamu.clickOn('[data-testid="meja-batal-konfirmasi"]');
    await new Promise((resolve) => setTimeout(resolve, 20));
    check(
      "membatalkan pesanan mengubah status & menghilangkan kode bayarnya",
      (tamu.query('[data-testid="meja-batal-notis"]')?.textContent ?? "").includes(
        "sudah dibatalkan",
      ) &&
        (tamu.query('[data-testid="meja-pembayaran"]')?.textContent ?? "").includes(
          "Pesanan dibatalkan",
        ) &&
        tamu.query('[data-testid="meja-pembayaran"] svg[data-qr-value]') === null,
      tamu.query('[data-testid="meja-pembayaran"]')?.textContent?.slice(0, 200),
    );
    check(
      "pesanan yang sudah dibatalkan tidak menawarkan pembatalan lagi",
      tamu.query('[data-testid="meja-batal-pesanan"]') === null,
      "tombol pembatalan masih ada",
    );
    check(
      "halaman tamu tanpa error konsol",
      tamu.newErrors().length === 0,
      tamu.newErrors().join(" | ").slice(0, 200),
    );
    await tamu.unmount();

    /*
      Jalur kedua: tamu memilih **Virtual Account**. Nomornya diterbitkan store
      dari bank + urutan tagihan, jadi yang tampil di ponselnya adalah nomor
      transfer bank itu — bukan kode QR — beserta tombol salinnya.
    */
    await denah.clickOn('[data-testid="meja-qr-t02"]');
    const urlVa =
      denah
        .query('[data-testid="meja-qr-kartu"] svg[data-qr-value]')
        ?.getAttribute("data-qr-value") ?? "";
    const tokenVa = urlVa.split("/meja/")[1] ?? "";
    check(
      "meja kedua menerbitkan tautan tamunya sendiri",
      /^mj_[0-9a-f]{32}$/.test(tokenVa),
      urlVa,
    );

    const tamuVa = await renderInteractive(
      React.createElement(
        MemoryRouter,
        { initialEntries: [`/meja/${tokenVa}`] },
        React.createElement(
          SessionProvider,
          null,
          React.createElement(
            BackendProvider,
            null,
            React.createElement(
              StoreProvider,
              null,
              React.createElement(
                Routes,
                null,
                React.createElement(Route, {
                  path: "/meja/:token",
                  element: React.createElement(MejaPage, null),
                }),
              ),
            ),
          ),
        ),
      ),
    );
    await tamuVa.clickOn('button[aria-label^="Tambah "]:not([disabled])');
    await tamuVa.clickOn('[data-testid="meja-lanjut-bayar"]');
    await tamuVa.clickOn('[data-testid="meja-bayar-va"]');
    await tamuVa.clickOn('[data-testid="meja-bank-bni"]');
    await tamuVa.clickOn('[data-testid="meja-kirim-pesanan"]');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const nomorVa = tamuVa.query('[data-testid="meja-va-nomor"]')?.textContent ?? "";
    const kalimatVa = tamuVa.query('[data-testid="meja-cara-bayar-kalimat"]')?.textContent ?? "";
    check(
      "tamu Virtual Account menerima nomor VA bank yang dipilihnya",
      /^8810\d{8}$/.test(nomorVa.trim()),
      nomorVa || "tidak ada nomor VA",
    );
    check(
      "kartu VA menawarkan salin nomor & tidak menggambar kode QRIS",
      tamuVa.query('[data-testid="meja-va-salin"]') !== null &&
        tamuVa.query('[data-testid="meja-pembayaran"] svg[data-qr-value]') === null &&
        tamuVa.query('[data-testid="meja-qris-screenshot"]') === null,
      tamuVa.query('[data-testid="meja-pembayaran"]')?.textContent?.slice(0, 160),
    );
    check(
      "kalimat cara bayar VA menyebut bank, nomornya, & nominalnya",
      kalimatVa.includes("Virtual Account BNI") &&
        kalimatVa.includes(nomorVa.trim()) &&
        kalimatVa.includes("rupiah"),
      kalimatVa || "tidak ada kalimat",
    );
    /*
      Sisi lain pagar pembatalan: begitu tagihannya lunas, tombol batalnya hilang
      dari halaman tamu. Uang yang sudah masuk tidak dibalik oleh tombol di ponsel
      pembeli — keputusan itu diuji aturannya di `verify-meja.mjs`, di sini yang
      dibuktikan tombolnya memang tidak ditawarkan lagi.
    */
    await tamuVa.clickOn('[data-testid="meja-simulasi-bayar"]');
    await new Promise((resolve) => setTimeout(resolve, 20));
    check(
      "pesanan yang sudah lunas tidak lagi menawarkan pembatalan",
      tamuVa.query('[data-testid="meja-batal-area"]') === null &&
        (tamuVa.query('[data-testid="meja-pembayaran"]')?.textContent ?? "").includes(
          "Pembayaran diterima",
        ),
      tamuVa.query('[data-testid="meja-pembayaran"]')?.textContent?.slice(0, 160),
    );
    check(
      "halaman tamu Virtual Account tanpa error konsol",
      tamuVa.newErrors().length === 0,
      tamuVa.newErrors().join(" | ").slice(0, 200),
    );

    /*
      Denah meja di layar dapur: meja bisa **diubah** (nama, kursi, zona) dan
      **dihapus** — tetapi hapus selalu lewat pagar hapusnya lebih dulu.
    */
    const jumlahMeja = () => denah.queryAll('[data-testid^="meja-kartu-"]').length;
    const sebelum = jumlahMeja();

    await denah.clickOn('[data-testid="meja-ubah-t01"]');
    check(
      "tombol Ubah membuka meja itu beserta nilai yang sekarang",
      (denah.query('[data-testid="meja-dialog"]')?.textContent ?? "").includes(
        "Ubah meja A1",
      ) && denah.query('[data-testid="meja-ubah-nama"]')?.value === "A1",
      denah.query('[data-testid="meja-dialog"]')?.textContent?.slice(0, 120),
    );
    await denah.fill('[data-testid="meja-ubah-nama"]', "A1 Baru");
    await denah.fill('[data-testid="meja-ubah-kursi"]', "6");
    await denah.fill('[data-testid="meja-ubah-zona"]', "Teras Depan");
    await denah.clickOn('[data-testid="meja-dialog-simpan"]');
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(
      "menyimpan perubahan mengganti nama, kursi, dan zona mejanya",
      denah.query('[data-testid="meja-dialog"]') === null &&
        (denah.query('[data-testid="meja-kartu-t01"]')?.textContent ?? "").includes(
          "A1 Baru",
        ) &&
        (denah.query('[data-testid="meja-kartu-t01"]')?.textContent ?? "").includes(
          "6 kursi",
        ) &&
        (denah.query('[data-testid="meja-kartu-t01"]')?.textContent ?? "").includes(
          "Teras Depan",
        ),
      denah.query('[data-testid="meja-kartu-t01"]')?.textContent ?? "tidak ada kartu",
    );

    // Nama meja tetap unik: mengubah meja lain meniru nama baru itu ditolak server.
    await denah.clickOn('[data-testid="meja-ubah-t02"]');
    await denah.fill('[data-testid="meja-ubah-nama"]', "A1 Baru");
    await denah.clickOn('[data-testid="meja-dialog-simpan"]');
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(
      "mengubah nama meja menjadi nama yang sudah dipakai ditolak",
      (denah.query('[data-testid="meja-galat"]')?.textContent ?? "").includes(
        "sudah ada di denah ini",
      ) && denah.query('[data-testid="meja-dialog"]') !== null,
      denah.query('[data-testid="meja-galat"]')?.textContent ?? "tidak ada galat",
    );
    await denah.clickOn('[data-testid="meja-dialog-batal"]');

    // Meja yang belum pernah dipakai: satu-satunya yang layak dihapus.
    await denah.fill('input[aria-label="Nama meja"]', "UJI-1");
    await denah.fill('input[aria-label="Jumlah kursi"]', "2");
    await denah.clickOn('[data-testid="meja-tambah"]');
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(
      "meja baru muncul di denah",
      jumlahMeja() === sebelum + 1 &&
        (denah.text().includes("UJI-1")),
      `${sebelum} → ${jumlahMeja()}`,
    );

    const tombolHapus = denah.queryAll('[data-testid^="meja-hapus-"]');
    const tombolMejaUji = tombolHapus.find((tombol) =>
      (
        tombol.closest('[data-testid^="meja-kartu-"]')?.textContent ?? ""
      ).includes("UJI-1"),
    );
    const idMejaUji = (tombolMejaUji?.getAttribute("data-testid") ?? "").replace(
      "meja-hapus-",
      "",
    );
    check("tombol Hapus ada di kartu meja baru", idMejaUji.length > 0, idMejaUji);

    await denah.clickOn(`[data-testid="meja-hapus-${idMejaUji}"]`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(
      "dialog hapus membaca pagar hapusnya sebelum tombol Hapus hidup",
      denah.query('[data-testid="meja-dialog-kalimat"]')?.getAttribute("data-can-delete") ===
        "yes" &&
        (denah.query('[data-testid="meja-dialog-kalimat"]')?.textContent ?? "").includes(
          "belum pernah dipakai",
        ) &&
        denah.query('[data-testid="meja-dialog-hapus"]')?.disabled === false,
      denah.query('[data-testid="meja-dialog-kalimat"]')?.textContent ?? "tidak ada kalimat",
    );
    await denah.clickOn('[data-testid="meja-dialog-hapus"]');
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(
      "meja yang belum pernah dipakai benar-benar hilang dari denah",
      jumlahMeja() === sebelum && !denah.text().includes("UJI-1"),
      `${jumlahMeja()} meja, teks UJI-1 = ${denah.text().includes("UJI-1")}`,
    );

    /*
      Urutan denah: meja bisa digeser satu langkah, dan tombolnya mati di ujung
      denah (tidak ada pergeseran yang tidak mengubah apa pun).
    */
    const urutanKartu = () =>
      denah
        .queryAll('[data-testid^="meja-kartu-"]')
        .map((element) => element.getAttribute("data-testid"));
    const urutSebelum = urutanKartu();
    const idAwal = (urutSebelum[0] ?? "").replace("meja-kartu-", "");
    const idAkhir = (urutSebelum[urutSebelum.length - 1] ?? "").replace(
      "meja-kartu-",
      "",
    );
    check(
      "meja paling awal tidak bisa digeser ke kiri",
      denah.query(`[data-testid="meja-geser-kiri-${idAwal}"]`)?.disabled === true,
      "tombol geser kiri di meja pertama masih hidup",
    );
    check(
      "meja paling akhir tidak bisa digeser ke kanan",
      denah.query(`[data-testid="meja-geser-kanan-${idAkhir}"]`)?.disabled === true,
      "tombol geser kanan di meja terakhir masih hidup",
    );
    await denah.clickOn(`[data-testid="meja-geser-kanan-${idAwal}"]`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const urutSetelahGeser = urutanKartu();
    check(
      "menekan Geser memindahkan meja satu langkah & menyisakan urutan lainnya",
      urutSetelahGeser[0] === urutSebelum[1] &&
        urutSetelahGeser[1] === urutSebelum[0] &&
        urutSetelahGeser.slice(2).join(",") === urutSebelum.slice(2).join(","),
      `${urutSebelum.slice(0, 3).join(" ")} → ${urutSetelahGeser.slice(0, 3).join(" ")}`,
    );
    await denah.clickOn(`[data-testid="meja-geser-kiri-${idAwal}"]`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(
      "menggeser balik mengembalikan denah ke urutan semula",
      urutanKartu().join(",") === urutSebelum.join(","),
      urutanKartu().slice(0, 3).join(" "),
    );

    /*
      Impor sekaligus: pratinjaunya dihitung aturan yang sama dengan server, jadi
      yang terbaca sebelum menekan tombol persis yang akan dijawab backend —
      termasuk penolakan yang menyebut nomor barisnya.
    */
    await denah.fill(
      '[data-testid="meja-impor-teks"]',
      "UJI-IMP-1, 4, Teras\nUJI-IMP-2, 2",
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pratinjau = denah.query('[data-testid="meja-impor-pratinjau"]')?.textContent ?? "";
    check(
      "pratinjau impor menyebut jumlah meja & kolom tiap barisnya",
      pratinjau.includes("2 meja siap ditambahkan") &&
        pratinjau.includes("UJI-IMP-1 · Teras") &&
        pratinjau.includes("4 kursi") &&
        pratinjau.includes("UJI-IMP-2") &&
        denah.query('[data-testid="meja-impor"]')?.disabled === false,
      pratinjau || "tidak ada pratinjau",
    );

    await denah.fill('[data-testid="meja-impor-teks"]', "UJI-IMP-1, 4\nA1 Baru, 2");
    await new Promise((resolve) => setTimeout(resolve, 10));
    check(
      "impor yang salah ditolak sebelum dikirim, beserta nomor barisnya",
      (denah.query('[data-testid="meja-impor-galat"]')?.textContent ?? "").includes(
        "Baris 2",
      ) &&
        (denah.query('[data-testid="meja-impor-galat"]')?.textContent ?? "").includes(
          "sudah ada di denah ini",
        ) &&
        denah.query('[data-testid="meja-impor"]')?.disabled === true,
      denah.query('[data-testid="meja-impor-galat"]')?.textContent ?? "tidak ada galat",
    );

    await denah.fill(
      '[data-testid="meja-impor-teks"]',
      "UJI-IMP-1, 4, Teras\nUJI-IMP-2, 2",
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await denah.clickOn('[data-testid="meja-impor"]');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const notisImpor = denah.query('[data-testid="meja-impor-notis"]')?.textContent ?? "";
    check(
      "impor menambah beberapa meja sekaligus & melaporkan hasilnya",
      jumlahMeja() === sebelum + 2 &&
        notisImpor.includes("2 meja ditambahkan") &&
        notisImpor.includes("UJI-IMP-1") &&
        notisImpor.includes("UJI-IMP-2"),
      notisImpor || `${jumlahMeja()} meja`,
    );
    check(
      "meja hasil impor masuk di akhir denah, urut teksnya",
      (() => {
        const terakhir = urutanKartu().slice(-2);
        const teks = terakhir.map(
          (id) => denah.query(`[data-testid="${id}"]`)?.textContent ?? "",
        );
        return teks[0].includes("UJI-IMP-1") && teks[1].includes("UJI-IMP-2");
      })(),
      urutanKartu().slice(-2).join(" "),
    );
    check(
      "impor mengosongkan kolom teksnya supaya tidak terkirim dua kali",
      denah.query('[data-testid="meja-impor-teks"]')?.value === "",
      denah.query('[data-testid="meja-impor-teks"]')?.value ?? "(kosong)",
    );

    check(
      "denah meja & dialognya tanpa error konsol",
      denah.newErrors().length === 0,
      denah.newErrors().join(" | ").slice(0, 200),
    );

    await tamuVa.unmount();
    await denah.unmount();
    withoutSession();
  }

  /*
    4f. Dapur hanya bekerja atas pesanan yang **sudah lunas** — dan tiket yang
        lahir dari QR meja ditandai kanal + momen pelunasannya.

    Satu store, tiga halaman lewat router yang sama: tamu memindai kartu mejanya
    dan membayar dari ponselnya, dapur menerima tiketnya **setelah** uangnya
    masuk, dan pesanan QR yang belum dibayar tidak pernah tampil sebagai antrean
    — layar dapur hanya menyebut jumlahnya lalu mengarahkan kasir ke halaman
    Pembayaran untuk melunasi/membatalkannya. Satu router dipakai supaya ketiga
    halaman benar-benar membaca store yang sama (pohon terpisah punya store
    sendiri, jadi alurnya tidak akan tersambung).
  */
  {
    const { MejaPage: HalamanTamuRute } = await server.ssrLoadModule(
      "/src/pages/MejaPage.tsx",
    );
    const { PaymentsPage: HalamanBayarRute } = await server.ssrLoadModule(
      "/src/pages/PaymentsPage.tsx",
    );

    /** Tombol pindah halaman di dalam router yang sama (satu store bersama). */
    function Pindah(props) {
      const ganti = useNavigate();
      return React.createElement(
        "button",
        {
          type: "button",
          "data-testid": props.testid,
          onClick: () => ganti(props.ke),
        },
        props.label,
      );
    }

    const tombolPindah = (testid, ke, label) =>
      React.createElement(Pindah, { key: testid, testid, ke, label });

    const pohonAlur = (awal, tujuan) =>
      React.createElement(
        MemoryRouter,
        { initialEntries: [awal] },
        React.createElement(
          SessionProvider,
          null,
          React.createElement(
            BackendProvider,
            null,
            React.createElement(
              StoreProvider,
              null,
              ...tujuan.map(([testid, ke, label]) => tombolPindah(testid, ke, label)),
              React.createElement(
                Routes,
                null,
                React.createElement(Route, {
                  path: "/app/kds",
                  element: React.createElement(KdsPage, null),
                }),
                React.createElement(Route, {
                  path: "/app/payments",
                  element: React.createElement(HalamanBayarRute, null),
                }),
                React.createElement(Route, {
                  path: "/meja/:token",
                  element: React.createElement(HalamanTamuRute, null),
                }),
              ),
            ),
          ),
        ),
      );

    withEnterpriseSession();

    /*
      Token tiap meja dibaca dari kartu QR-nya (jalur yang sama dengan tamu
      memindai): tokennya bagian dari data contoh per meja, jadi pohon berikutnya
      melihat meja yang sama. Tiga meja: satu tamu membayar sendiri (QRIS), satu
      tagihannya dibatalkan kasir, satu dilunasi kasir.
    */
    const kodeMeja = [];
    {
      const denahKode = await renderInteractive(providers(React.createElement(KdsPage, null)));
      for (const id of ["t01", "t02", "t03"]) {
        await denahKode.clickOn(`[data-testid="meja-qr-${id}"]`);
        const tautan =
          denahKode
            .query('[data-testid="meja-qr-kartu"] svg[data-qr-value]')
            ?.getAttribute("data-qr-value") ?? "";
        kodeMeja.push(tautan.split("/meja/")[1] ?? "");
      }
      await denahKode.unmount();
    }
    check(
      "denah memberi tiap meja tautan tamunya sendiri",
      kodeMeja.length === 3 && kodeMeja.every((kode) => /^mj_[0-9a-f]{32}$/.test(kode)),
      kodeMeja.join(" | "),
    );

    const navigasi = [
      ["pindah-dapur", "/app/kds", "Ke dapur"],
      ["pindah-bayar", "/app/payments", "Ke Pembayaran"],
      ["pindah-tamu-1", `/meja/${kodeMeja[0]}`, "Tamu meja A1"],
      ["pindah-tamu-2", `/meja/${kodeMeja[1]}`, "Tamu meja A2"],
      ["pindah-tamu-3", `/meja/${kodeMeja[2]}`, "Tamu meja A3"],
    ];
    const alur = await renderInteractive(pohonAlur(`/meja/${kodeMeja[0]}`, navigasi));
    const pindahKe = async (testid) => {
      await alur.clickOn(`[data-testid="${testid}"]`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    };

    /*
      Notifikasi tagihan QR baru: nada yang benar-benar diminta pemutar tiruan
      dicatat utuh (frekuensi & panjangnya), jadi “dapur berbunyi” tidak berhenti
      jadi klaim — termasuk bahwa nadanya **bukan** nada bip kasir, bahwa satu
      tagihan hanya berbunyi sekali, dan bahwa Matikan bunyi benar-benar
      membisukannya sementara kilatnya tetap berjalan.
    */
    const scanBeep = await server.ssrLoadModule("/src/lib/scanBeep.ts");
    const nadaDapur = [];
    scanBeep.setScanBeepPlayer({
      play(tone) {
        nadaDapur.push(tone ?? null);
        return true;
      },
    });
    scanBeep.setScanBeepEnabled(true);

    /** Satu pesanan tamu dari halaman mejanya (QRIS, langsung dari ponsel). */
    const pesanDariTamu = async (nama) => {
      await alur.clickOn('button[aria-label^="Tambah "]:not([disabled])');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await alur.clickOn('[data-testid="meja-lanjut-bayar"]');
      if (nama) await alur.fill('input[aria-label="Nama tamu"]', nama);
      await alur.clickOn('[data-testid="meja-kirim-pesanan"]');
      await new Promise((resolve) => setTimeout(resolve, 20));
      const kartu = alur.query('[data-testid="meja-pembayaran"]')?.textContent ?? "";
      return { kartu, nomor: (kartu.match(/DIG-\d{4}-\d{4}/) ?? [])[0] ?? "" };
    };

    // ---- Tamu meja A1 memesan & membayar QRIS dari ponselnya sendiri.
    const pesananA1 = await pesanDariTamu("Rina");
    check(
      "pesanan tamu menerbitkan tagihan QRIS yang menunggu pembayaran",
      /DIG-\d{4}-\d{4}/.test(pesananA1.kartu) && pesananA1.kartu.includes("Menunggu pembayaran"),
      pesananA1.kartu.slice(0, 160),
    );
    const sebelumBayar = Date.now();
    await alur.clickOn('[data-testid="meja-simulasi-bayar"]');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const nomorTiketA1 =
      ((alur.query('[data-testid="meja-pembayaran"]')?.textContent ?? "").match(/A-\d{5}/) ??
        [])[0] ?? "";
    check(
      "tamu yang lunas melihat pesanannya masuk dapur beserta nomor tiketnya",
      Boolean(nomorTiketA1),
      alur.query('[data-testid="meja-pembayaran"]')?.textContent ?? "tidak ada tiket",
    );

    await pindahKe("pindah-dapur");
    const penandaLunas = alur.query('[data-testid^="kds-lunas-meja-"]');
    check(
      "tiket dapur menandai kanal & momen pelunasan tamu (QRIS)",
      /^Lunas QRIS dari meja · diterima dapur pukul \d{2}:\d{2}$/.test(
        (penandaLunas?.textContent ?? "").trim(),
      ),
      penandaLunas?.textContent ?? "tidak ada penanda",
    );
    const momenLunas = Number(penandaLunas?.getAttribute("data-paid-at") ?? NaN);
    check(
      "momen di tiket adalah momen pelunasannya, bukan saat pesanan dibuat",
      Number.isFinite(momenLunas) && momenLunas >= sebelumBayar && momenLunas <= Date.now(),
      `${momenLunas} (bayar sejak ${sebelumBayar})`,
    );
    check(
      "tiket itu memuat nomor pesanan tamunya",
      (penandaLunas?.closest("article")?.textContent ?? "").includes(nomorTiketA1),
      penandaLunas?.closest("article")?.textContent?.slice(0, 160),
    );
    check(
      "tidak ada pesanan QR yang menunggu, jadi layar dapur bersih dari notis",
      alur.query('[data-testid="meja-qr-menunggu-bayar"]') === null &&
        alur.queryAll('[data-testid^="meja-lunasi-"]').length === 0,
      alur.text().slice(0, 200),
    );

    // ---- Tamu meja A2 memesan tetapi belum membayar: tidak masuk dapur.
    await pindahKe("pindah-tamu-2");
    const pesananA2 = await pesanDariTamu("TUNGGU-2");
    check(
      "pesanan tamu kedua menunggu pembayaran",
      pesananA2.kartu.includes("Menunggu pembayaran"),
      pesananA2.kartu.slice(0, 160),
    );

    await pindahKe("pindah-dapur");
    const notisTunggu = alur.query('[data-testid="meja-qr-menunggu-bayar"]');
    check(
      "pesanan QR yang belum dibayar tidak tampil sebagai antrean dapur",
      alur.queryAll('[data-testid^="meja-lunasi-"]').length === 0 &&
        alur.queryAll('[data-testid^="kds-lunas-meja-"]').length === 1 &&
        !alur.text().includes(pesananA2.nomor) &&
        !alur.text().includes("TUNGGU-2") &&
        !/\(tidak ada nomor\)/.test(alur.text()),
      alur.text().slice(0, 240),
    );
    check(
      "layar dapur menyebut jumlah pesanan QR yang menunggu pelunasan",
      (notisTunggu?.textContent ?? "").includes("1 pesanan QR meja menunggu pelunasan") &&
        (notisTunggu?.textContent ?? "").includes(
          "Dapur hanya menerima pesanan yang sudah lunas",
        ),
      notisTunggu?.textContent ?? "tidak ada notis",
    );
    check(
      "notis itu menautkan kasir ke halaman Pembayaran",
      alur.query('[data-testid="meja-qr-ke-pembayaran"]')?.getAttribute("href") ===
        "/app/payments",
      alur.query('[data-testid="meja-qr-ke-pembayaran"]')?.getAttribute("href") ??
        "tidak ada tautan",
    );
    // Penghitung & tombolnya harus duduk di **kartu antrean dapur** (kolom kiri
    // tempat tiket dapur berada), bukan di kolom denah meja — itu yang membuat
    // kasir tidak perlu membuka/mencari halaman lain untuk membacanya.
    const panelAntrean = notisTunggu?.closest("section");
    check(
      "penghitung & tombolnya menempel di kartu antrean dapur, bukan di kolom denah",
      (panelAntrean?.textContent ?? "").includes("Antrean dapur") &&
        panelAntrean?.querySelector('[data-testid="meja-qr-menunggu-jumlah"]')
          ?.textContent?.includes("1 pesanan QR meja menunggu pelunasan") === true &&
        (panelAntrean?.textContent ?? "").includes("Ke halaman Pembayaran"),
      panelAntrean?.textContent?.slice(0, 200) ?? "tidak ada panel antrean",
    );
    check(
      "penghitungnya lencana terpisah yang menyebut jumlah pesanannya",
      (alur.query('[data-testid="meja-qr-menunggu-jumlah"]')?.textContent ?? "")
        .trim()
        .startsWith("1 "),
      alur.query('[data-testid="meja-qr-menunggu-jumlah"]')?.textContent ??
        "tidak ada penghitung",
    );
    check(
      "tombolnya berupa tombol bertaut, bukan tautan teks di tengah kalimat",
      (alur.query('[data-testid="meja-qr-ke-pembayaran"]')?.getAttribute("class") ?? "")
        .includes("bg-accent") &&
        (alur.query('[data-testid="meja-qr-ke-pembayaran"]')?.textContent ?? "").includes(
          "Ke halaman Pembayaran",
        ),
      alur.query('[data-testid="meja-qr-ke-pembayaran"]')?.getAttribute("class") ??
        "tidak ada tombol",
    );

    // ---- Notifikasi: tagihan QR baru membunyikan nada dapur & mengkilatkan
    //      kartu antreannya. Bunyinya harus terdengar **sekali** per tagihan.
    check(
      "tagihan QR baru membunyikan nada notifikasi dapur (bukan nada bip kasir)",
      nadaDapur.length === 1 &&
        nadaDapur[0]?.frequencyHz === scanBeep.KDS_ALERT_BEEP.frequencyHz &&
        nadaDapur[0]?.frequencyHz !== scanBeep.SCAN_BEEP.frequencyHz &&
        nadaDapur[0]?.durationMs === scanBeep.KDS_ALERT_BEEP.durationMs,
      JSON.stringify(nadaDapur),
    );
    check(
      "kartu antrean dapur berkilat begitu tagihannya baru masuk",
      notisTunggu?.getAttribute("data-kilat") === "1" &&
        (notisTunggu?.getAttribute("class") ?? "").includes("animate-kilat") &&
        (alur.query('[data-testid="meja-qr-kilat"]')?.textContent ?? "").includes(
          "1 tagihan QR baru masuk",
        ) &&
        alur.query('[data-testid="meja-qr-kilat"]')?.getAttribute("data-kilat-jumlah") ===
          "1",
      `${notisTunggu?.getAttribute("class")} · ${alur.query('[data-testid="meja-qr-kilat"]')?.textContent}`,
    );
    check(
      "bunyinya satu saklar dengan kasir: langsir dapur ↔ Pembayaran tidak mengulangnya",
      (alur.query('[data-testid="meja-qr-bip"]')?.getAttribute("aria-checked") ?? "") ===
        "true" &&
        (alur.query('[data-testid="meja-qr-bip"]')?.textContent ?? "").includes(
          "Bip tagihan aktif",
        ),
      alur.query('[data-testid="meja-qr-bip"]')?.textContent ?? "tidak ada saklar",
    );

    // ---- Melihat tagihan yang sama dari layar yang baru dibuka tidak
    //      membunyikannya lagi: yang diberitahukan adalah kedatangannya.
    await pindahKe("pindah-bayar");
    await pindahKe("pindah-dapur");
    check(
      "membuka ulang layar dapur tidak mengulang bunyi & kilat untuk tagihan yang sama",
      nadaDapur.length === 1 &&
        alur.query('[data-testid="meja-qr-kilat"]') === null &&
        alur.query('[data-testid="meja-qr-menunggu-bayar"]')?.getAttribute("data-kilat") ===
          "0" &&
        (alur.query('[data-testid="meja-qr-menunggu-bayar"]')?.textContent ?? "").includes(
          "1 pesanan QR meja menunggu pelunasan",
        ),
      `${JSON.stringify(nadaDapur)} · kilat=${alur.query('[data-testid="meja-qr-menunggu-bayar"]')?.getAttribute("data-kilat")}`,
    );

    // ---- Kasir mematikan bunyi tagihan dari kartu antreannya sendiri, supaya
    //      tagihan berikutnya (meja A3) bisa dibuktikan benar-benar senyap.
    await alur.clickOn('[data-testid="meja-qr-bip"]');
    check(
      "saklar bunyi tagihan duduk di kartu antrean dapur & mematikannya tidak membunyikan nada",
      alur.query('[data-testid="meja-qr-bip"]')?.getAttribute("aria-checked") === "false" &&
        (alur.query('[data-testid="meja-qr-bip"]')?.textContent ?? "").includes(
          "Bip tagihan mati",
        ) &&
        nadaDapur.length === 1,
      `${alur.query('[data-testid="meja-qr-bip"]')?.textContent} · nada=${nadaDapur.length}`,
    );

    // ---- Kasir membatalkan tagihan meja A2 dari halaman Pembayaran.
    await pindahKe("pindah-bayar");
    const barisA2 = alur.query('[data-testid^="tagihan-meja-"]');
    check(
      "halaman Pembayaran mengenali tagihan pesanan QR beserta meja & tamunya",
      (barisA2?.textContent ?? "").includes("Pesanan QR meja A2") &&
        (barisA2?.textContent ?? "").includes("TUNGGU-2") &&
        (barisA2?.textContent ?? "").includes(
          "dapur baru menerima pesanannya setelah tagihan ini lunas",
        ),
      barisA2?.textContent ?? "tidak ada baris pesanan QR",
    );
    const idTagihanA2 = (barisA2?.getAttribute("data-testid") ?? "").replace(
      "tagihan-meja-",
      "",
    );
    check(
      "tombol pelunasan di halaman Pembayaran menyebut akan mengirim ke dapur",
      (alur.query(`[data-testid="tagihan-lunasi-${idTagihanA2}"]`)?.textContent ?? "").includes(
        "Lunasi & kirim ke dapur",
      ),
      alur.query(`[data-testid="tagihan-lunasi-${idTagihanA2}"]`)?.textContent ??
        "tidak ada tombol",
    );
    await alur.clickOn(`[data-testid="tagihan-batal-${idTagihanA2}"]`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    check(
      "kasir bisa membatalkan tagihan pesanan QR dari halaman Pembayaran",
      alur.text().includes("dibatalkan"),
      alur.text().slice(0, 200),
    );

    await pindahKe("pindah-dapur");
    check(
      "pesanan yang dibatalkan berhenti menunggu & tidak menjadi tiket dapur",
      alur.query('[data-testid="meja-qr-menunggu-bayar"]') === null &&
        alur.queryAll('[data-testid^="kds-lunas-meja-"]').length === 1 &&
        !alur.text().includes(pesananA2.nomor),
      alur.text().slice(0, 200),
    );

    // ---- Tamu meja A3 memesan; kasir melunasi tagihannya dari Pembayaran.
    await pindahKe("pindah-tamu-3");
    const pesananA3 = await pesanDariTamu("Bayar Di Kasir");
    await pindahKe("pindah-dapur");
    check(
      "pesanan QR meja A3 tidak tampil di dapur sebelum dilunasi",
      !alur.text().includes(pesananA3.nomor) &&
        (alur.query('[data-testid="meja-qr-menunggu-bayar"]')?.textContent ?? "").includes(
          "1 pesanan QR meja menunggu pelunasan",
        ) &&
        alur.queryAll('[data-testid^="kds-lunas-meja-"]').length === 1,
      alur.text().slice(0, 240),
    );
    check(
      "bunyi yang dimatikan benar-benar senyap, tetapi kilatnya tetap berjalan",
      nadaDapur.length === 1 &&
        alur.query('[data-testid="meja-qr-menunggu-bayar"]')?.getAttribute("data-kilat") ===
          "1" &&
        (alur.query('[data-testid="meja-qr-kilat"]')?.textContent ?? "").includes(
          "1 tagihan QR baru masuk",
        ),
      `nada=${nadaDapur.length} · kilat=${alur.query('[data-testid="meja-qr-menunggu-bayar"]')?.getAttribute("data-kilat")}`,
    );
    await alur.clickOn('[data-testid="meja-qr-bip"]');
    check(
      "menyalakan bunyinya lagi langsung memperdengarkan nada dapur (bukan nada kasir)",
      alur.query('[data-testid="meja-qr-bip"]')?.getAttribute("aria-checked") === "true" &&
        nadaDapur.length === 2 &&
        nadaDapur[1]?.frequencyHz === scanBeep.KDS_ALERT_BEEP.frequencyHz,
      `${alur.query('[data-testid="meja-qr-bip"]')?.textContent} · ${JSON.stringify(nadaDapur)}`,
    );

    await pindahKe("pindah-bayar");
    const barisA3 = alur.query('[data-testid^="tagihan-meja-"]');
    check(
      "tagihan pesanan QR meja A3 dikenali di halaman Pembayaran",
      (barisA3?.textContent ?? "").includes("Pesanan QR meja A3") &&
        (barisA3?.textContent ?? "").includes("Bayar Di Kasir"),
      barisA3?.textContent ?? "tidak ada baris pesanan QR",
    );
    const idTagihanA3 = (barisA3?.getAttribute("data-testid") ?? "").replace(
      "tagihan-meja-",
      "",
    );
    await alur.clickOn(`[data-testid="tagihan-lunasi-${idTagihanA3}"]`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    check(
      "pelunasan dari halaman Pembayaran melaporkan tagihannya lunas",
      alur.text().includes("ditandai lunas"),
      alur.text().slice(0, 200),
    );

    await pindahKe("pindah-dapur");
    const penandaAkhir = alur.queryAll('[data-testid^="kds-lunas-meja-"]');
    const kartuA3 = alur.query('[data-testid="meja-kartu-t03"]')?.textContent ?? "";
    const nomorTiketA3 = (kartuA3.match(/A-\d{5}/) ?? [])[0] ?? "";
    check(
      "melunasi dari halaman Pembayaran langsung mencetak tiket dapurnya",
      penandaAkhir.length === 2 &&
        Boolean(nomorTiketA3) &&
        penandaAkhir.some((node) =>
          (node.closest("article")?.textContent ?? "").includes(nomorTiketA3),
        ) &&
        penandaAkhir.every((node) =>
          /^Lunas .+ dari meja · diterima dapur pukul \d{2}:\d{2}$/.test(
            (node.textContent ?? "").trim(),
          ),
        ) &&
        alur.query('[data-testid="meja-qr-menunggu-bayar"]') === null,
      `${penandaAkhir.map((node) => node.textContent).join(" | ")} · meja A3: ${kartuA3}`,
    );
    check(
      "meja yang pesanannya sudah lunas tampil terisi di denah dapur",
      (alur.query('[data-testid="meja-kartu-t01"]')?.textContent ?? "").includes("Terisi") &&
        kartuA3.includes("Terisi"),
      `${alur.query('[data-testid="meja-kartu-t01"]')?.textContent} | ${kartuA3}`,
    );
    check(
      "alur tamu → dapur → Pembayaran tanpa error konsol",
      alur.newErrors().length === 0,
      alur.newErrors().join(" | ").slice(0, 200),
    );

    await alur.unmount();
    // Pemutar & setelan dikembalikan supaya blok uji berikutnya tidak memakai
    // pemutar tiruan atau bunyi yang tidak sengaja dimatikan.
    scanBeep.setScanBeepPlayer(null);
    scanBeep.setScanBeepEnabled(true);
    withoutSession();
  }

  // 5. ErrorBoundary benar-benar menangkap error render (uji di klien, karena
  //    SSR tidak menjalankan error boundary).
  {
    function Boom() {
      throw new Error("kesalahan uji boundary");
    }
    const { text } = await renderTree(
      React.createElement(
        ErrorBoundary,
        null,
        React.createElement(Boom, null),
      ),
    );
    check("ErrorBoundary menampilkan pesan gagal dimuat", text.includes("gagal dimuat"), text.slice(0, 120));
    check("ErrorBoundary menampilkan pesan errornya", text.includes("kesalahan uji boundary"), text.slice(0, 120));
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
  // React sengaja melempar ulang error yang sudah ditangani ErrorBoundary ke
  // platform (di browser: `window.onerror`). Pelemparan itu datang setelah semua
  // cek selesai — termasuk cek boundary yang memang sengaja memicu error — jadi
  // bukan kegagalan tes. Keluar sendiri supaya kode keluar mencerminkan hasilnya.
  process.exit(0);
}

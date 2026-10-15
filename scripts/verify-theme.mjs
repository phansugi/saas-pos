/**
 * Tema terang/gelap: aturan, palet, bootstrap, dan tombolnya.
 *
 * Kenapa ada: "mode terang" gampang terlihat benar padahal separuh jalan — palet
 * terangnya kurang satu variabel, atau bootstrap di `index.html` menyimpang dari
 * aturan di `src/lib/theme.ts` sehingga halaman berkedip (atau salah tema) pada
 * kunjungan berikutnya. Karena itu yang diperiksa di sini:
 *
 *   1. aturan murni `resolveTheme`/`nextTheme`/penyimpanan,
 *   2. paritas palet: setiap variabel di `.dark` ada juga di `:root`, dan kedua
 *      tema benar-benar berbeda,
 *   3. script bootstrap di `index.html` **dieksekusi** di DOM tiruan untuk lima
 *      keadaan, lalu hasilnya dibandingkan dengan `resolveTheme`,
 *   4. tombol `ThemeToggle` benar-benar mengubah `<html>`, menyimpan pilihan, dan
 *      menyelaraskan warna bilah browser.
 *
 * Usage: bun scripts/verify-theme.mjs
 */
import "./happy-dom-setup.mjs";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const window = globalThis.window;
const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

let failure = null;

try {
  const theme = await server.ssrLoadModule("/src/lib/theme.ts");

  // ── 1. Aturan murni ──────────────────────────────────────────────────────
  check(
    "pilihan tersimpan menang atas preferensi sistem",
    theme.resolveTheme("light", false) === "light" &&
      theme.resolveTheme("dark", true) === "dark",
    `${theme.resolveTheme("light", false)} / ${theme.resolveTheme("dark", true)}`,
  );
  check(
    "tanpa pilihan tersimpan, tema mengikuti sistem",
    theme.resolveTheme(null, true) === "light" &&
      theme.resolveTheme(null, false) === "dark",
    `${theme.resolveTheme(null, true)} / ${theme.resolveTheme(null, false)}`,
  );
  check(
    "bawaan produk tetap gelap",
    theme.resolveTheme(undefined, false) === "dark",
    String(theme.resolveTheme(undefined, false)),
  );
  check(
    "nilai asing tidak dipercaya",
    theme.resolveTheme("ungu", false) === "dark" &&
      theme.resolveTheme(42, true) === "light" &&
      !theme.isTheme("terang") &&
      theme.isTheme("light"),
    String(theme.resolveTheme("ungu", false)),
  );
  check(
    "tombol membalik tema",
    theme.nextTheme("dark") === "light" && theme.nextTheme("light") === "dark",
    `${theme.nextTheme("dark")} / ${theme.nextTheme("light")}`,
  );
  check(
    "label tombol menyebut tema tujuan",
    theme.toggleLabel("dark") === "Ganti ke tema terang" &&
      theme.toggleLabel("light") === "Ganti ke tema gelap",
    `${theme.toggleLabel("dark")} / ${theme.toggleLabel("light")}`,
  );

  // Penyimpanan: rusak/diblokir diperlakukan sebagai "belum memilih".
  const memory = new Map();
  const storage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
  };
  check(
    "baca simpanan mengabaikan nilai asing",
    theme.readStoredTheme(storage) === null,
    String(theme.readStoredTheme(storage)),
  );
  theme.writeStoredTheme(storage, "light");
  check(
    "simpanan ditulis di kunci tema",
    storage.getItem(theme.THEME_STORAGE_KEY) === "light" &&
      theme.readStoredTheme(storage) === "light",
    String(storage.getItem(theme.THEME_STORAGE_KEY)),
  );
  const hostileStorage = {
    getItem: () => {
      throw new Error("mode privat");
    },
    setItem: () => {
      throw new Error("mode privat");
    },
  };
  check(
    "penyimpanan yang melempar tidak mematikan tema",
    theme.readStoredTheme(hostileStorage) === null &&
      (theme.writeStoredTheme(hostileStorage, "dark"), true),
    "read/write tahan lemparan",
  );

  // applyTheme: kelas `<html>` + warna bilah browser.
  const classes = new Set([theme.DARK_CLASS]);
  const root = {
    classList: {
      add: (...tokens) => tokens.forEach((token) => classes.add(token)),
      remove: (...tokens) => tokens.forEach((token) => classes.delete(token)),
    },
  };
  const metaValues = [];
  const meta = { setAttribute: (name, value) => metaValues.push(`${name}=${value}`) };
  theme.applyTheme("light", { root, meta });
  check(
    "tema terang melepas kelas gelap",
    !classes.has(theme.DARK_CLASS) &&
      metaValues.at(-1) === `content=${theme.THEME_COLORS.light}`,
    [...classes].join(","),
  );
  theme.applyTheme("dark", { root, meta });
  check(
    "tema gelap memasang kelas dan warnanya",
    classes.has(theme.DARK_CLASS) &&
      metaValues.at(-1) === `content=${theme.THEME_COLORS.dark}`,
    [...classes].join(","),
  );
  check(
    "target tanpa meta tetap aman",
    (theme.applyTheme("dark", { root }), true),
    "applyTheme tanpa meta",
  );

  // ── 2. Palet CSS: paritas terang vs gelap ────────────────────────────────
  const css = read("src/index.css");
  function variablesIn(selector) {
    const start = css.indexOf(selector);
    check(`blok ${selector} ada di index.css`, start >= 0, selector);
    const block = css.slice(start, css.indexOf("}", start));
    return [...block.matchAll(/--([\w-]+):/g)].map((match) => match[1]).sort();
  }
  const lightTokens = variablesIn(":root {");
  const darkTokens = variablesIn(".dark {");
  check(
    "palet gelap tidak punya variabel yang hilang di terang",
    darkTokens.every((token) => lightTokens.includes(token)),
    `gelap:[${darkTokens}] terang:[${lightTokens}]`,
  );
  /*
    Token *warna* (nilainya tiga angka HSL) wajib sama persis di kedua tema —
    warna yang hanya ada di satu tema akan memakai nilai tema lain secara
    diam-diam. Token non-warna seperti `--radius` memang boleh hanya di `:root`,
    jadi yang dibandingkan adalah daftar warnanya, bukan semua variabel.
  */
  const hsl = /^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/;
  const colorTokens = (selector) => {
    const start = css.indexOf(selector);
    const block = css.slice(start, css.indexOf("}", start));
    return [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)]
      .filter(([, , value]) => hsl.test(value.trim()))
      .map(([, name]) => name)
      .sort();
  };
  const lightColors = colorTokens(":root {");
  const darkColors = colorTokens(".dark {");
  check(
    "kedua tema mendefinisikan daftar warna yang sama persis",
    lightColors.join() === darkColors.join(),
    `terang=[${lightColors}] gelap=[${darkColors}]`,
  );
  check(
    "palet warna itu tidak sepele",
    lightColors.length >= 12,
    `jumlah=${lightColors.length}`,
  );
  const token = (selector, name) => {
    const block = css.slice(css.indexOf(selector), css.indexOf("}", css.indexOf(selector)));
    return /--background:\s*([^;]+);/.exec(block)?.[1]?.trim();
  };
  check(
    "latar terang dan gelap benar-benar berbeda",
    token(":root {", "background") !== token(".dark {", "background") &&
      token(":root {", "background") === "0 0% 100%",
    `terang=${token(":root {", "background")} gelap=${token(".dark {", "background")}`,
  );
  check(
    "Tailwind memakai mode gelap berbasis kelas",
    /darkMode:\s*\[\s*"class"\s*\]/.test(read("tailwind.config.js")),
    "tailwind.config.js",
  );
  /*
    Sidebar backstage. Permintaannya “berwarna lebih gelap, jangan polos”, dan itu
    diukur dari komponen lightness HSL-nya — bukan dari nama kelas yang dipakai
    halaman.

    “Lebih gelap dari halaman” **tidak** bisa jadi patokan di kedua tema: di tema
    gelap halaman sudah nyaris hitam (5%), sehingga sidebar 3% justru menyatu
    dengan latarnya (itu keluhan “belum ada warnanya”). Tokoh yang benar-benar
    dijaga adalah: permukaannya tetap gelap, tetapi **berbeda nyata** dari latar
    halaman (selisih lightness minimal 4 poin), gradiennya tidak rata, dan
    teksnya terang — karena sidebar gelap dengan tulisan gelap hanya berarti tidak
    terbaca.
  */
  const tokenValue = (selector, name) => {
    const block = css.slice(css.indexOf(selector), css.indexOf("}", css.indexOf(selector)));
    return new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
  };
  const lightness = (value) =>
    hsl.test(value ?? "") ? Number(value.split(" ")[2].replace("%", "")) : Number.NaN;
  for (const [label, selector] of [
    ["terang", ":root {"],
    ["gelap", ".dark {"],
  ]) {
    const sidebar = tokenValue(selector, "sidebar");
    const deep = tokenValue(selector, "sidebar-deep");
    const background = tokenValue(selector, "background");
    check(
      `sidebar backstage adalah permukaan gelap, bukan latar terang (tema ${label})`,
      lightness(sidebar) <= 20,
      `sidebar=${sidebar} (L=${lightness(sidebar)})`,
    );
    check(
      `sidebar backstage berbeda nyata dari latar halaman (tema ${label})`,
      Math.abs(lightness(sidebar) - lightness(background)) >= 4,
      `sidebar=${sidebar} (L=${lightness(sidebar)}) latar=${background} (L=${lightness(background)})`,
    );
    check(
      `gradien sidebar tidak rata (tema ${label})`,
      lightness(deep) <= lightness(sidebar) - 3,
      `sidebar=${sidebar} deep=${deep}`,
    );
    check(
      `teks sidebar terang di atas permukaannya (tema ${label})`,
      lightness(tokenValue(selector, "sidebar-foreground")) >= 80,
      `sidebar-foreground=${tokenValue(selector, "sidebar-foreground")}`,
    );
    check(
      `sidebar punya warna batas & aksen sendiri (tema ${label})`,
      ["sidebar-muted", "sidebar-border", "sidebar-active"].every((name) =>
        hsl.test(tokenValue(selector, name) ?? ""),
      ),
      ["sidebar-muted", "sidebar-border", "sidebar-active"]
        .map((name) => `${name}=${tokenValue(selector, name)}`)
        .join(" "),
    );
  }
  check(
    "permukaan sidebar (gradien + pendar aksen) didefinisikan di index.css",
    /\.sidebar-surface\s*\{/.test(css) &&
      css.includes("hsl(var(--sidebar-active) /") &&
      css.includes("hsl(var(--sidebar-deep) /"),
    "index.css",
  );

  // ── 3. Bootstrap di index.html benar-benar dijalankan ───────────────────
  const html = read("index.html");
  check(
    "html memuat kelas gelap sebagai bawaan tanpa JavaScript",
    /<html lang="id" class="dark">/.test(html),
    html.slice(0, 60),
  );
  const bootstrapBlock = /<!-- tema-bootstrap:mulai -->([\s\S]*?)<!-- tema-bootstrap:selesai -->/.exec(
    html,
  )?.[1];
  check("blok bootstrap tema ditandai di index.html", Boolean(bootstrapBlock), "index.html");
  const bootstrapScript = /<script>([\s\S]*?)<\/script>/.exec(bootstrapBlock)?.[1];
  check("bootstrap tema berisi script", Boolean(bootstrapScript), bootstrapBlock ?? "");
  check(
    "bootstrap memakai kunci simpanan yang sama",
    bootstrapScript.includes(theme.THEME_STORAGE_KEY),
    "kunci simpanan",
  );

  // DOM tiruan: skenario dijalankan pada elemen yang benar-benar ada.
  window.document.head.innerHTML = '<meta name="theme-color" content="#070A13" />';
  const metaElement = window.document.querySelector('meta[name="theme-color"]');
  const realMatchMedia = window.matchMedia;
  const realGetItem = window.localStorage.getItem;
  function runBootstrap({ stored, prefersLight, storageThrows = false }) {
    window.document.documentElement.className = "dark";
    metaElement.setAttribute("content", theme.THEME_COLORS.dark);
    window.localStorage.clear();
    if (stored) window.localStorage.setItem(theme.THEME_STORAGE_KEY, stored);
    window.matchMedia = () => ({ matches: prefersLight, addEventListener() {}, removeEventListener() {} });
    if (storageThrows) {
      window.localStorage.getItem = () => {
        throw new Error("mode privat");
      };
    }
    try {
      new Function(bootstrapScript)();
    } finally {
      // Dipulihkan dengan menugaskan lagi, bukan `delete`: properti bawaan
      // happy-dom tidak bisa dihapus dan pelemparannya menutupi hasil uji.
      window.localStorage.getItem = realGetItem;
      window.matchMedia = realMatchMedia;
    }
    return {
      dark: window.document.documentElement.classList.contains(theme.DARK_CLASS),
      meta: metaElement.getAttribute("content"),
    };
  }

  const scenarios = [
    { name: "simpanan terang + sistem gelap", stored: "light", prefersLight: false, expect: "light" },
    { name: "simpanan gelap + sistem terang", stored: "dark", prefersLight: true, expect: "dark" },
    { name: "belum memilih + sistem terang", stored: null, prefersLight: true, expect: "light" },
    { name: "belum memilih + sistem gelap", stored: null, prefersLight: false, expect: "dark" },
    { name: "simpanan tak terbaca", stored: null, prefersLight: false, storageThrows: true, expect: "dark" },
  ];
  for (const scenario of scenarios) {
    const outcome = runBootstrap(scenario);
    const expected = theme.resolveTheme(scenario.stored, scenario.prefersLight);
    check(
      `bootstrap index.html: ${scenario.name}`,
      expected === scenario.expect && outcome.dark === (expected === "dark"),
      `dapat=${outcome.dark ? "dark" : "light"} harap=${expected}`,
    );
    check(
      `bootstrap index.html: warna bilah browser ${scenario.name}`,
      outcome.meta === theme.THEME_COLORS[expected],
      `meta=${outcome.meta}`,
    );
  }

  // ── 4. Tombol ganti tema di DOM ─────────────────────────────────────────
  const { ThemeToggle } = await server.ssrLoadModule("/src/components/ThemeToggle.tsx");
  async function render(element) {
    const container = window.document.createElement("div");
    window.document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(element);
    });
    return {
      text: () => container.textContent.replace(/\s+/g, " ").trim(),
      button: () => container.querySelector("button"),
      async click() {
        await React.act(async () => {
          container.querySelector("button").click();
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

  {
    window.document.head.innerHTML = '<meta name="theme-color" content="#070A13" />';
    const metaEl = window.document.querySelector('meta[name="theme-color"]');
    window.document.documentElement.className = "dark";
    window.localStorage.clear();
    const view = await render(React.createElement(ThemeToggle, null));
    check(
      "tombol tema membawa label yang benar sejak awal",
      view.button()?.getAttribute("aria-label") === "Ganti ke tema terang",
      view.button()?.getAttribute("aria-label") ?? "tanpa tombol",
    );
    await view.click();
    check(
      "sekali klik beralih ke tema terang",
      !window.document.documentElement.classList.contains(theme.DARK_CLASS) &&
        metaEl.getAttribute("content") === theme.THEME_COLORS.light,
      `class=${window.document.documentElement.className} meta=${metaEl.getAttribute("content")}`,
    );
    check(
      "pilihan tema disimpan",
      window.localStorage.getItem(theme.THEME_STORAGE_KEY) === "light",
      String(window.localStorage.getItem(theme.THEME_STORAGE_KEY)),
    );
    check(
      "label tombol ikut berubah",
      view.button()?.getAttribute("aria-label") === "Ganti ke tema gelap",
      view.button()?.getAttribute("aria-label") ?? "tanpa tombol",
    );
    await view.click();
    check(
      "klik kedua kembali ke tema gelap",
      window.document.documentElement.classList.contains(theme.DARK_CLASS) &&
        window.localStorage.getItem(theme.THEME_STORAGE_KEY) === "dark",
      `class=${window.document.documentElement.className}`,
    );
    await view.close();
  }

  {
    // Tema yang sudah terang di DOM: tombol harus membacanya, bukan menebak.
    window.document.documentElement.className = "";
    window.localStorage.clear();
    const view = await render(React.createElement(ThemeToggle, null));
    check(
      "tombol mengikuti tema yang sudah aktif di DOM",
      view.button()?.getAttribute("aria-label") === "Ganti ke tema gelap",
      view.button()?.getAttribute("aria-label") ?? "tanpa tombol",
    );
    await view.close();
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

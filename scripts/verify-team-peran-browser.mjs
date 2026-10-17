/**
 * Uji **peramban sungguhan** (Chromium): halaman Tim & Peran benar-benar diklik
 * untuk **peran bawaan** — lima kartu tampil, Pemilik terkunci, dan alur
 * ubah izin → kembalikan izin bawaan → nonaktifkan → hapus → pulihkan.
 *
 * Kenapa harness ini ada: `verify-render.mjs` menguji hal yang sama di DOM tiruan
 * (happy-dom), tetapi happy-dom tidak menghitung tata letak dan tidak menjalankan
 * satu pun berkas CSS — kartu peran yang tombolnya bertumpuk, terpotong, atau
 * tidak bisa ditekan di layar nyata tidak akan ketahuan dari sana. Skrip ini
 * memakai peramban asli, jadi yang diperiksa adalah apa yang benar-benar dilihat
 * pengguna. Data sisanya tetap demo (`localStorage`), jadi tidak ada data siapa
 * pun yang disentuh dan tidak butuh login.
 *
 * Prasyarat — paket peramban dipasang di luar repo (sama seperti
 * `verify-mobile-overflow.mjs`):
 *
 *   mkdir -p /tmp/pw && cd /tmp/pw && bun init -y && bun add playwright
 *   bunx playwright install --with-deps chromium --only-shell
 *
 * Usage:
 *   PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-team-peran-browser.mjs [baseUrl]
 *
 * Default: `http://localhost:5173`.
 */
import { createRequire } from "node:module";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/+$/, "");
const playwrightDir = process.env.PLAYWRIGHT_DIR;
const requireFrom = playwrightDir
  ? createRequire(`${playwrightDir.replace(/\/+$/, "")}/`)
  : createRequire(import.meta.url);
const { chromium } = requireFrom("playwright");

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const SESSION_KEY = "mesinpos.session.v1";
const SESSION = {
  user: { name: "Uji Peran Bawaan", email: "peran-bawaan@mesinpos.test" },
  tenant: {
    name: "Pusat Bahan Bangunan",
    slug: "pusat-bahan-bangunan",
    storeName: "Pusat",
    vertical: "umkm",
    verticals: ["umkm", "fnb", "wholesale"],
    planKey: "enterprise",
    role: "owner",
    customRole: null,
    // Pengingat tutup shift dimatikan: yang diuji izin peran, dan bannernya tidak
    // boleh muncul-hilang tergantung jam berapa skripnya dijalankan.
    shift: { active: false, reminderHour: 21, longShiftHours: 14 },
    createdAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  },
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(
  ([key, session]) => {
    window.localStorage.setItem(key, JSON.stringify(session));
  },
  [SESSION_KEY, SESSION],
);
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));

const card = (role) => page.locator(`[data-testid="peran-bawaan-${role}"]`);

try {
  await page.goto(`${BASE}/app/team`, { waitUntil: "domcontentloaded" });
  await card("owner").waitFor({ state: "visible", timeout: 20000 });

  // 1. Kelima peran bawaan tampil, dan hanya Pemilik yang tanpa tombol.
  for (const role of ["owner", "manager", "cashier", "inventory", "finance"]) {
    check(`kartu peran bawaan ${role} tampil`, await card(role).isVisible());
  }
  check(
    "kartu Pemilik tidak menawarkan satu pun tombol pengaturan",
    (await card("owner").locator("button").count()) === 0,
    `tombol: ${await card("owner").locator("button").count()}`,
  );
  const tombolKasir = await card("cashier")
    .locator("button")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
  check(
    "kartu Kasir menawarkan Ubah izin + Hapus",
    tombolKasir.includes("Ubah izin peran Kasir") &&
      tombolKasir.includes("Hapus peran Kasir"),
    JSON.stringify(tombolKasir),
  );

  // 2. Ubah izin: buang “Melihat laporan”, simpan, lencana “izin disesuaikan” muncul.
  check(
    "kasir mulai dengan izin laporan bawaan",
    await page.locator('[data-testid="peran-bawaan-izin-cashier-report.view"]').isVisible(),
  );
  await card("cashier").getByRole("button", { name: "Ubah izin peran Kasir" }).click();
  await page.getByText("Ubah izin peran Kasir", { exact: true }).waitFor({ timeout: 10000 });
  check(
    "editor menyebut izin bawaan peran itu",
    await page.locator('[data-testid="editor-peran-bawaan"]').isVisible(),
  );
  const laporan = page.getByRole("button", { name: "Melihat laporan", exact: true });
  check(
    "izin bawaan yang berlaku tampil tercentang",
    (await laporan.getAttribute("aria-pressed")) === "true",
    await laporan.getAttribute("aria-pressed"),
  );
  await laporan.click();
  await page.getByRole("button", { name: "Simpan izin" }).click();
  await card("cashier").getByText("izin disesuaikan").waitFor({ timeout: 10000 });
  check(
    "izin yang dilepas hilang dari kartu Kasir",
    (await page.locator('[data-testid="peran-bawaan-izin-cashier-report.view"]').count()) === 0,
  );

  // 3. Kembalikan izin bawaan.
  await card("cashier").getByRole("button", { name: "Kembalikan izin bawaan Kasir" }).click();
  await page
    .locator('[data-testid="peran-bawaan-izin-cashier-report.view"]')
    .waitFor({ timeout: 10000 });
  check(
    "lencana “izin disesuaikan” hilang setelah izinnya dikembalikan",
    (await card("cashier").getByText("izin disesuaikan").count()) === 0,
  );

  // 4. Nonaktifkan lalu aktifkan lagi.
  await card("cashier").getByRole("button", { name: "Nonaktifkan peran Kasir" }).click();
  await card("cashier").getByText("nonaktif", { exact: true }).waitFor({ timeout: 10000 });
  check("peran yang dinonaktifkan berlabel nonaktif", true);
  await card("cashier").getByRole("button", { name: "Aktifkan peran Kasir" }).click();
  await card("cashier").getByText("aktif", { exact: true }).waitFor({ timeout: 10000 });
  check("peran bisa diaktifkan kembali", true);

  // 5. Peran yang masih dipakai anggota menolak dihapus — alasannya terbaca.
  const hapusKasir = card("cashier").getByRole("button", { name: "Hapus peran Kasir" });
  check(
    "peran yang masih dipakai anggota tidak bisa dihapus",
    await hapusKasir.isDisabled(),
  );
  check(
    "alasannya terbaca di tombolnya",
    ((await hapusKasir.getAttribute("title")) ?? "").includes("Masih dipakai"),
    await hapusKasir.getAttribute("title"),
  );

  // 6. Hapus (konfirmasi dua langkah) lalu pulihkan — di peran yang tidak dipakai
  //    siapa pun (Keuangan), karena hapus memang ditolak selama masih ada anggota.
  await card("finance").getByRole("button", { name: "Hapus peran Keuangan" }).click();
  await card("finance").getByRole("button", { name: "Yakin hapus peran Keuangan" }).click();
  await card("finance").getByText("dihapus", { exact: true }).waitFor({ timeout: 10000 });
  check("peran yang dihapus berlabel dihapus", true);
  await card("finance").getByRole("button", { name: "Pulihkan peran Keuangan" }).click();
  await card("finance").getByText("aktif", { exact: true }).waitFor({ timeout: 10000 });
  check(
    "Pulihkan mengembalikan peran ke daftar penugasan",
    (await card("finance").getByText("dihapus", { exact: true }).count()) === 0,
  );

  check(
    "halaman tidak melaporkan galat runtime di konsol",
    consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(" | "),
  );
} finally {
  await browser.close();
}

const gagal = results.filter((row) => !row.ok);
console.log(`${results.length - gagal.length}/${results.length} checks passed against ${BASE}`);
if (gagal.length > 0) process.exit(1);

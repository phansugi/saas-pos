/**
 * Uji **kartu Akun bisnis** di DOM tiruan: tombol Edit, formulirnya, dan
 * mutation yang benar-benar dikirim saat “Simpan perubahan” ditekan.
 *
 * Kenapa harness sendiri, bukan tambahan di `verify-render.mjs`: kartu ini hanya
 * dirender setelah identitas platform terverifikasi, dan identitas itu terbit
 * dari kode email ke kotak surat pengembang — sesuatu yang tidak bisa (dan tidak
 * boleh) dipalsukan harness. Jadi `convex/react` diganti stub
 * (`happy-dom-convex-stub.mjs`) yang mengembalikan data akun dan merekam
 * mutation; yang diuji adalah perilaku kartunya, bukan gerbang servernya (gerbang
 * itu diuji aturan murni di `verify-platform-tenants.mjs` dan lewat CLI).
 *
 * Usage: bun scripts/verify-platform-edit-ui.mjs
 */
import "./happy-dom-setup.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import {
  normaliseTenantSearch,
  summariseTenantAccounts,
  TENANT_SEARCH_SCAN,
  tenantAccountMatches,
} from "../src/convex/lib/platformTenants.ts";

const window = globalThis.window;
const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const slug = "toko-uji";
const actorId = "kx7ax4ckpm1mnk9n0za0xz6p8s8g45ss";
const tenantId = "ks799j2wjsb5x7vnh25vz806gn8ggp25";

const rows = [
  {
    id: tenantId,
    name: "Toko Uji",
    slug,
    planKey: "starter",
    status: "trialing",
    suspendedAt: null,
    suspendedNote: null,
    suspendLabel: null,
    deleting: false,
    ownerName: "Sugianto",
    ownerEmail: "phansugisoft@gmail.com",
    members: 1,
    activeMembers: 1,
    stores: 1,
    products: 0,
    createdAt: 1792313838864,
    accountStatus: "aktif",
    summary: "Toko Uji · paket starter · aktif · 1 anggota · 1 toko",
  },
];

const history = [
  {
    id: "log_1",
    action: "update",
    actionLabel: "Diubah",
    tenantId,
    tenantName: "Toko Uji",
    tenantSlug: slug,
    actorEmail: "phansugisoft@gmail.com",
    note: "uji kartu",
    detail: 'nama "Toko Lama" → "Toko Uji"',
    at: 1792313873505,
  },
];

const calls = [];
/**
 * Galat yang akan dilempar mutation **berikutnya**: harness perlu membuktikan
 * apa yang dibaca operator saat server menolak, tanpa deployment sungguhan.
 */
let failNext = null;
const stubRoot = path.dirname(fileURLToPath(import.meta.url));
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
  // Hanya kartu ini yang dimuat; pemindaian dependensi tidak perlu dan justru
  // ikut membaca `@convex-dev/auth/react` yang meminta ekspor stub lebih banyak.
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: {
    alias: {
      "convex/react": path.join(stubRoot, "happy-dom-convex-stub.mjs"),
    },
  },
});

const { PlatformTenantAccountsCard } = await server.ssrLoadModule(
  "/src/components/PlatformTenantAccountsCard.tsx",
);

/**
 * Nama fungsi dibaca dari `convex/server` di stub, bukan dari `api`: `api` di
 * klien adalah proxy yang membuat referensi baru setiap akses.
 */
/**
 * Keadaan yang ditirukan server: pencarian menyapu seluruh akun (di sini 1086)
 * dan hanya mengembalikan yang cocok — memakai aturan murni yang sama dengan
 * server, jadi harness ikut membuktikan kalimat “diperiksa … akun” yang dibaca
 * pengguna tidak bisa berbohong.
 */
const stubState = { scanned: 1086, scanCapped: false, truncated: true, limit: 100 };
const queries = [];

globalThis.__convexStub = {
  query(name, args) {
    if (name === "platform:tenantAccounts") {
      queries.push({ name, args });
      const needle = normaliseTenantSearch(args?.search);
      const found = needle ? rows.filter((row) => tenantAccountMatches(row, needle)) : rows;
      return {
        rows: found,
        summary: summariseTenantAccounts(found),
        limit: stubState.limit,
        search: needle,
        scanned: stubState.scanned,
        truncated: stubState.truncated,
        scanCapped: stubState.scanCapped,
        countsCapped: false,
      };
    }
    if (name === "platform:platformActions") return { rows: history, limit: 20 };
    throw new Error("query tak terduga di stub");
  },
  async mutate(name, args) {
    calls.push({ name, args });
    if (failNext) {
      const error = failNext;
      failNext = null;
      throw error;
    }
    return {
      changed: true,
      tenantId: args.tenantId,
      tenantName: args.name,
      planKey: args.planKey,
      detail: `nama "Toko Uji" → "${String(args.name).trim()}"; paket starter → ${args.planKey}`,
      summary: `${String(args.name).trim()} diubah: nama "Toko Uji" → "${String(args.name).trim()}"; paket starter → ${args.planKey}.`,
    };
  },
};

const errors = [];
const originalError = console.error;
console.error = (...args) => {
  errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  originalError(...args);
};

const container = window.document.createElement("div");
window.document.body.appendChild(container);
const root = createRoot(container);
await React.act(async () => {
  root.render(React.createElement(PlatformTenantAccountsCard, { actorId }));
});

const byTestId = (id) => container.querySelector(`[data-testid="${id}"]`);
const text = () => container.textContent.replace(/\s+/g, " ");
const click = (element) =>
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));

/** Mengisi kolom seperti pengguna mengetik (React mendengar `input`/`change`). */
function type(element, value) {
  const proto =
    element instanceof window.HTMLSelectElement
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value);
  element.dispatchEvent(
    new window.Event(element instanceof window.HTMLSelectElement ? "change" : "input", {
      bubbles: true,
    }),
  );
}

check("kartu akun bisnis dirender", Boolean(byTestId("platform-akun")), text().slice(0, 200));
check("baris akun tampil sesuai slugnya", Boolean(byTestId(`platform-akun-${slug}`)));
check(
  "riwayat menampilkan rincian perubahan",
  text().includes('nama "Toko Lama" → "Toko Uji"'),
  text().slice(0, 400),
);

// Formulir belum terbuka sebelum Edit ditekan.
check("formulir belum tampil sebelum Edit ditekan", !byTestId(`platform-akun-form-${slug}`));

await React.act(async () => {
  click(byTestId(`platform-akun-edit-${slug}`));
});
check("tombol Edit membuka formulir", Boolean(byTestId(`platform-akun-form-${slug}`)));

const nameInput = byTestId(`platform-akun-nama-${slug}`);
const planSelect = byTestId(`platform-akun-paket-${slug}`);
const noteInput = byTestId(`platform-akun-edit-catatan-${slug}`);
const saveButton = byTestId(`platform-akun-simpan-${slug}`);

check("formulir terisi nama bisnis sekarang", nameInput.value === "Toko Uji", nameInput.value);
check("formulir terisi paket sekarang", planSelect.value === "starter", planSelect.value);
check(
  "pilihan paket datang dari katalog (tiga paket)",
  [...planSelect.options].map((option) => option.value).join(",") ===
    "starter,professional,enterprise",
  [...planSelect.options].map((option) => option.value).join(","),
);
check(
  "keterangan menyebut nama singkat tidak berubah",
  text().includes("tidak\n                    berubah") || text().includes("tidak berubah"),
);

// Nama terlalu pendek: tombol simpan mati, sama seperti aturan server.
await React.act(async () => {
  type(nameInput, "a");
});
check("tombol simpan mati saat nama terlalu pendek", saveButton.disabled === true);

await React.act(async () => {
  type(nameInput, "  Toko   Uji Baru ");
  type(planSelect, "professional");
  type(noteInput, "uji kartu");
});
check("tombol simpan hidup lagi setelah nama cukup", saveButton.disabled === false);

await React.act(async () => {
  byTestId(`platform-akun-form-${slug}`).dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
});
await React.act(async () => {});

check("simpan mengirim tepat satu mutation", calls.length === 1, `jumlah=${calls.length}`);
const call = calls[0];
check(
  "mutation yang dikirim adalah platform.updateTenant",
  call?.name === "platform:updateTenant",
  call?.name,
);
check(
  "kiriman memuat aktor, tenant, nama, paket, dan catatan",
  call?.args.actorId === actorId &&
    call?.args.tenantId === tenantId &&
    call?.args.name === "  Toko   Uji Baru " &&
    call?.args.planKey === "professional" &&
    call?.args.note === "uji kartu",
  JSON.stringify(call?.args),
);
check(
  "sesudah simpan formulir tertutup lagi",
  !byTestId(`platform-akun-form-${slug}`),
);
check(
  "pemberitahuan menyebut perubahan yang disimpan",
  (byTestId("platform-akun-notice")?.textContent ?? "").includes("diubah: nama"),
  byTestId("platform-akun-notice")?.textContent,
);
check("tidak ada error konsol", errors.length === 0, errors.slice(0, 3).join(" | "));

// ------------------------------- pencarian: cakupan & kejujuran kalimatnya
const cari = byTestId("platform-akun-cari");
check(
  "cakupan pencarian disebut saat belum ada kata kunci",
  (byTestId("platform-akun-cakupan")?.textContent ?? "").includes("bukan hanya 100 yang tampil"),
  byTestId("platform-akun-cakupan")?.textContent,
);
check(
  "daftar yang dipotong menjelaskan pencariannya menjangkau seluruh akun",
  (byTestId("platform-akun-dipotong")?.textContent ?? "").includes("pencariannya memeriksa seluruh akun"),
  byTestId("platform-akun-dipotong")?.textContent,
);

const tungguJeda = () => new Promise((resolve) => setTimeout(resolve, 400));

await React.act(async () => {
  type(cari, "toko");
});
await React.act(async () => {
  await tungguJeda();
});
check(
  "kata kunci dikirim ke server setelah ketikan berhenti",
  queries.at(-1)?.args?.search === "toko",
  JSON.stringify(queries.at(-1)?.args ?? null),
);
check(
  "cakupan menyebut jumlah akun yang diperiksa, bukan yang tampil",
  (byTestId("platform-akun-cakupan")?.textContent ?? "").includes(
    `${stubState.scanned} akun (seluruh deployment)`,
  ),
  byTestId("platform-akun-cakupan")?.textContent,
);
check(
  "akun yang cocok tetap tampil walau di luar 100 baris pertama",
  Boolean(byTestId(`platform-akun-${slug}`)),
  text().slice(0, 200),
);

await React.act(async () => {
  type(cari, "zzz");
});
await React.act(async () => {
  await tungguJeda();
});
const kosong = byTestId("platform-akun-kosong")?.textContent ?? "";
check(
  "hasil kosong mengaku seluruh akun sudah diperiksa, bukan “tidak ada” tanpa keterangan",
  kosong.includes(`seluruh ${stubState.scanned} akun`) && kosong.includes("bukan hanya yang tampil"),
  kosong,
);

stubState.scanCapped = true;
await React.act(async () => {
  type(cari, "zzzz");
});
await React.act(async () => {
  await tungguJeda();
});
const kosongBatas = byTestId("platform-akun-kosong")?.textContent ?? "";
check(
  "kalau batas penyapuan yang menghentikan, itu disebut apa adanya",
  kosongBatas.includes(`batasnya ${TENANT_SEARCH_SCAN}`) && kosongBatas.includes("belum diperiksa"),
  kosongBatas,
);
check(
  "cakupan saat kena batas tidak mengaku “seluruh deployment”",
  (byTestId("platform-akun-cakupan")?.textContent ?? "").includes("masih ada akun lain di luar batas"),
  byTestId("platform-akun-cakupan")?.textContent,
);
stubState.scanCapped = false;

/*
  ------------------------------- galat server: kalimat, bukan bungkusan

  Keluhan aslinya persis begini: menekan Hapus pada workspace sendiri menjawab
  dengan `[CONVEX M(platform:deleteTenant)] [Request ID: …] Server Error Uncaught
  Error: … at handler (../src/convex/platform.ts:1295:27) Called by client`.
  Operator tidak perlu id permintaan dan nomor baris di mukanya — yang perlu
  terbaca hanya alasannya, dengan bungkusan itu tetap bisa dibuka saat melapor.
*/
const tolakSendiri =
  "Ini workspace Anda sendiri. Menghapusnya akan menghapus akun yang sedang Anda pakai — keluarkan dulu kepemilikannya dari akun lain.";
const requestId = "3393af0945f63028";

// Pencarian dikosongkan lagi supaya baris akunnya kembali tampil.
await React.act(async () => {
  type(cari, "");
});
await React.act(async () => {
  await tungguJeda();
});

async function jalankanHapus(galat) {
  await React.act(async () => {
    click(byTestId(`platform-akun-hapus-${slug}`));
  });
  const konfirmasi = byTestId(`platform-akun-konfirmasi-${slug}`);
  await React.act(async () => {
    type(konfirmasi, slug);
  });
  failNext = galat;
  await React.act(async () => {
    click(byTestId(`platform-akun-lanjut-${slug}`));
  });
  await React.act(async () => {});
  return { kotak: byTestId("platform-akun-error") };
}

// ConvexError: kalimatnya ada di `data`, jadi itu yang wajib terbaca.
const { kotak } = await jalankanHapus(
  Object.assign(
    new Error(
      `[CONVEX M(platform:deleteTenant)] [Request ID: ${requestId}] Server Error\n` +
        `Uncaught ConvexError: ${tolakSendiri}\n` +
        "at handler (../src/convex/platform.ts:1295:27)\nCalled by client",
    ),
    { name: "ConvexError", data: tolakSendiri },
  ),
);
const pesan = (byTestId("platform-akun-error-pesan")?.textContent ?? "").trim();
const detail = kotak?.querySelector("pre")?.textContent ?? "";
check("penolakan server tampil sebagai kotak peringatan", Boolean(kotak));
check(
  "kotak galat menampilkan kalimat server apa adanya",
  pesan === tolakSendiri,
  pesan,
);
check(
  "bungkusan Convex tidak bocor ke kalimat utama",
  !/[\[\]]|Request ID|at handler|Called by client|Uncaught/.test(pesan),
  pesan,
);
check(
  "detail teknis tetap bisa dibuka operator (id permintaan utuh)",
  (kotak?.querySelector("summary")?.textContent ?? "").includes("Detail teknis") &&
    detail.includes(`Request ID: ${requestId}`),
  detail.slice(0, 160),
);

// Galat lama tanpa `data` (mis. Error biasa): bungkusannya dibersihkan klien.
const legacy = await jalankanHapus(
  new Error(
    `[CONVEX M(platform:deleteTenant)] [Request ID: ${requestId}] Server Error\n` +
      "Uncaught Error: Akun bisnis ini sedang dihapus oleh pengelola platform, " +
      "jadi sesi pendampingan tidak bisa dibuka.\n" +
      "at handler (../src/convex/platform.ts:1301:5)\nCalled by client",
  ),
);
const pesanLegacy = (byTestId("platform-akun-error-pesan")?.textContent ?? "").trim();
check(
  "galat tanpa data pun dibersihkan dari id permintaan & jejak berkas",
  pesanLegacy ===
    "Akun bisnis ini sedang dihapus oleh pengelola platform, jadi sesi pendampingan tidak bisa dibuka." &&
    Boolean(legacy.kotak),
  pesanLegacy,
);
check(
  "kegagalan menolak tidak memunculkan error konsol",
  errors.length === 0,
  errors.slice(0, 3).join(" | "),
);

await React.act(async () => {
  root.unmount();
});
container.remove();
await server.close();

const gagal = results.filter((row) => !row.ok);
console.log(`${results.length - gagal.length}/${results.length} checks passed`);
if (gagal.length > 0) process.exit(1);

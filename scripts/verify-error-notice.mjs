/**
 * Uji **kotak galat bersama** (`components/ErrorNotice.tsx`) dan aturan
 * kalimatnya (`lib/errors.ts`) — tanpa deployment.
 *
 * Kenapa harness sendiri: kotak ini kini dipakai halaman tenant (kasir, produk,
 * pembelian) **dan** backstage, jadi satu-satunya cara memastikan semuanya
 * seragam adalah merendernya dari data galat yang bentuknya sama dengan yang
 * dikirim Convex:
 *
 *  - `ConvexError` (punya `data`): yang tampil kalimat di `data`, dan bungkusan
 *    `[CONVEX …]` + `[Request ID: …]` hanya ada di balik “Detail teknis”.
 *  - `Error` biasa yang sudah dibungkus Convex: bungkusannya dibersihkan klien.
 *  - **string** dari validasi formulir: tampil apa adanya (tidak dianggap galat
 *    server, tidak diberi “Detail teknis” palsu).
 *  - galat tanpa isi yang bisa dibaca: kalimat pengganti, bukan “Server Error”.
 *
 * Usage: bun scripts/verify-error-notice.mjs
 */
import "./happy-dom-setup.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const window = globalThis.window;
const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const stubRoot = path.dirname(fileURLToPath(import.meta.url));
const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: {
    // Komponen memakai tombol shadcn (`@radix-ui/react-slot`); pemindaian
    // dependensi tidak perlu dan memperlambat harness.
    alias: { "@": path.resolve(stubRoot, "../src") },
  },
});

const { ErrorNotice } = await server.ssrLoadModule("/src/components/ErrorNotice.tsx");
const {
  ERROR_FALLBACK,
  ERROR_TITLE,
  errorTechnicalNote,
  readableErrorMessage,
} = await server.ssrLoadModule("/src/lib/errors.ts");

// ------------------------------- aturan murni

const kalimat = "Stok tidak cukup untuk produk Kopi Susu (tersedia 3).";
const requestId = "c3f1a2b9d4e5f60718";

/** Bentuk galat seperti yang sampai ke klien: bungkusan Convex + `data`. */
function convexRefusal(message) {
  return Object.assign(
    new Error(
      `[CONVEX M(products:update)] [Request ID: ${requestId}] Server Error\n` +
        `Uncaught ConvexError: ${message}\n` +
        "at handler (../src/convex/products.ts:412:11)\nCalled by client",
    ),
    { name: "ConvexError", data: message },
  );
}

check(
  "ConvexError: yang dibaca kalimat di `data`, bukan bungkusannya",
  readableErrorMessage(convexRefusal(kalimat)) === kalimat,
  readableErrorMessage(convexRefusal(kalimat)),
);
check(
  "Error biasa yang dibungkus Convex dibersihkan dari id permintaan & jejak berkas",
  readableErrorMessage(
    new Error(
      `[CONVEX M(purchasing:receive)] [Request ID: ${requestId}] Server Error\n` +
        "Uncaught Error: Jumlah penerimaan melebihi sisa pesanan.\n" +
        "at handler (../src/convex/purchasing.ts:88:5)\nCalled by client",
    ),
  ) === "Jumlah penerimaan melebihi sisa pesanan.",
);
check(
  "string validasi klien dikembalikan apa adanya",
  readableErrorMessage("Jumlah permintaan harus bilangan bulat lebih dari 0.") ===
    "Jumlah permintaan harus bilangan bulat lebih dari 0.",
);
check(
  "galat tanpa isi terbaca memakai kalimat pengganti, bukan “Server Error”",
  readableErrorMessage(new Error("Server Error")) === ERROR_FALLBACK &&
    readableErrorMessage("[CONVEX Q(products:list)] Server Error") === ERROR_FALLBACK,
  readableErrorMessage(new Error("Server Error")),
);
check(
  "string validasi tidak diberi “Detail teknis” palsu",
  errorTechnicalNote("Isi tanggal jatuh tempo tagihan.") === null,
  String(errorTechnicalNote("Isi tanggal jatuh tempo tagihan.")),
);
check(
  "galat terbungkus menyimpan detail teknis untuk disalin",
  (errorTechnicalNote(convexRefusal(kalimat)) ?? "").includes(`Request ID: ${requestId}`),
);

// ------------------------------- halaman tenant memakai kotak yang sama
//
// Komponen yang benar tidak menolong kalau halamannya masih menulis sendiri
// kotak galatnya. Dicek dari sumber: halaman yang disebut pemilik repo wajib
// mengimpor `ErrorNotice` **dan** tidak lagi menyusun kotak galat destruktif
// sendiri (pola kelas lama yang dulu dipakai tiga halaman sekaligus).
const POLA_LAMA =
  "rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive";

for (const [nama, berkas] of [
  ["kasir", "src/pages/PosPage.tsx"],
  ["produk", "src/pages/ProductsPage.tsx"],
  ["pembelian", "src/pages/PurchasingPage.tsx"],
]) {
  const isi = readFileSync(path.resolve(stubRoot, "..", berkas), "utf8");
  check(
    `halaman ${nama} merender kotak galat bersama`,
    isi.includes('import { ErrorNotice } from "@/components/ErrorNotice"') &&
      isi.includes("<ErrorNotice"),
  );
  check(
    `halaman ${nama} tidak lagi menyusun kotak galat sendiri`,
    !isi.includes(POLA_LAMA),
  );
}

// ------------------------------- render: satu bentuk untuk semua halaman

const container = window.document.createElement("div");
window.document.body.appendChild(container);
const root = createRoot(container);
const render = async (error, props = {}) => {
  await React.act(async () => {
    root.render(React.createElement(ErrorNotice, { error, testId: "uji-galat", ...props }));
  });
};
const byTestId = (id) => container.querySelector(`[data-testid="${id}"]`);
const pesan = () => (byTestId("uji-galat-pesan")?.textContent ?? "").trim();

await render(convexRefusal(kalimat));
check("kotak galat memakai role=alert", byTestId("uji-galat")?.getAttribute("role") === "alert");
check("judulnya kalimat pendek yang sama di semua halaman", container.textContent.includes(ERROR_TITLE));
check("kalimat server tampil apa adanya", pesan() === kalimat, pesan());
check(
  "id permintaan & jejak berkas tidak muncul di kalimat utama",
  !/[\[\]]|Request ID|at handler|Called by client|Uncaught/.test(pesan()),
  pesan(),
);
check(
  "detail teknis tersedia di balik lipatan",
  (container.querySelector("summary")?.textContent ?? "").includes("Detail teknis") &&
    (container.querySelector("pre")?.textContent ?? "").includes(`Request ID: ${requestId}`),
);
check(
  "detail teknis tertutup secara default (tidak mengganggu pembaca)",
  container.querySelector("details")?.hasAttribute("open") === false,
);

await render("Jumlah pembayaran harus lebih dari 0.");
check("string validasi tampil apa adanya tanpa judul galat server", pesan() === "Jumlah pembayaran harus lebih dari 0.", pesan());
check("string validasi tanpa lipatan detail teknis", !container.querySelector("details"));

await render(null);
check("tanpa galat kotaknya tidak dirender", container.querySelector('[role="alert"]') === null);
check("tanpa galat tidak ada teks sisa", (container.textContent ?? "").trim() === "");

// Petunjuk tindakan hanya muncul kalau halaman memang punya sesuatu yang menolong.
await render(convexRefusal(kalimat), { hint: "Keranjang tetap utuh selama pembayaran gagal." });
check(
  "petunjuk tindakan ikut tampil saat diberikan",
  (container.textContent ?? "").includes("Keranjang tetap utuh selama pembayaran gagal."),
);

await React.act(async () => {
  root.unmount();
});
container.remove();
await server.close();

const gagal = results.filter((row) => !row.ok);
console.log(`${results.length - gagal.length}/${results.length} checks passed`);
if (gagal.length > 0) process.exit(1);

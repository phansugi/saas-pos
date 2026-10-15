/**
 * Uji kode QR tagihan digital (`payment.digital`, Phase 6) tanpa deployment.
 *
 * Kenapa ada: aplikasi sebelumnya hanya menampilkan **teks** payload QRIS, dan
 * teks yang benar tidak menjamin gambar yang benar. Harness ini menutup celah itu
 * dengan **bolak-balik**: payload → matriks QR (`src/lib/qr.ts`) → jalur SVG yang
 * digambar `@/components/QrCode` → dirapikan kembali menjadi piksel → **dibaca
 * lagi dengan pemindai QR sungguhan** (`jsqr`). Kalau matriksnya melenceng,
 * pembacaan gagal atau mengembalikan teks yang berbeda.
 *
 * Yang dijaga:
 *
 *   - payload yang sama selalu menghasilkan kode yang sama (tagihan bisa dicetak
 *     ulang), dan tagihan berbeda tidak bertukar kode;
 *   - jalur SVG benar-benar mewakili matriksnya (jumlah modul & koordinat cocok);
 *   - hasilnya **bisa dipindai**: pemindai membaca balik payload yang sama.
 *
 * Usage: bun scripts/verify-qr.mjs
 */
import jsQR from "jsqr";
import {
  isPlausibleQrMatrix,
  QR_QUIET_ZONE,
  qrExtent,
  qrMatrix,
  qrSvgPath,
} from "../src/lib/qr.ts";
import { qrPayload } from "../src/convex/lib/digitalPayment.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const payload = qrPayload({
  number: "DIG-2026-0007",
  amount: 47_000,
  merchantName: "Kopi Senja",
});

// ---------------------------------------------------------------- matriks

const matrix = qrMatrix(payload);
check(
  "matriks QR berbentuk persegi berukuran sah (ganjil, ≥ 21)",
  matrix.size >= 21 && matrix.size % 2 === 1 && matrix.modules.length === matrix.size * matrix.size,
  `size=${matrix.size} modules=${matrix.modules.length}`,
);
check(
  "matriks memuat pola pencari & pola waktu QR",
  isPlausibleQrMatrix(matrix),
  "pola pencari 7×7 atau pola waktu tidak sesuai",
);
check(
  "payload yang sama menghasilkan matriks yang sama (bisa dicetak ulang)",
  JSON.stringify(qrMatrix(payload).modules) === JSON.stringify(matrix.modules),
  "matriks berubah untuk payload yang sama",
);
check(
  "tagihan berbeda menghasilkan matriks berbeda",
  JSON.stringify(
    qrMatrix(qrPayload({ number: "DIG-2026-0008", amount: 47_000 })).modules,
  ) !== JSON.stringify(matrix.modules),
  "dua tagihan berbeda bertukar kode",
);
check(
  "payload kosong ditolak, bukan digambar jadi kotak kosong",
  (() => {
    try {
      qrMatrix("   ");
      return false;
    } catch {
      return true;
    }
  })(),
  "qrMatrix kosong tidak melempar",
);

const darkCount = matrix.modules.filter(Boolean).length;
check(
  "matriks tidak seragam (ada modul gelap maupun terang)",
  darkCount > 0 && darkCount < matrix.modules.length,
  `gelap=${darkCount} total=${matrix.modules.length}`,
);

// ------------------------------------------------------------- jalur SVG

const path = qrSvgPath(matrix);
check(
  "jalur SVG punya satu perintah per modul gelap",
  (path.match(/M/g) ?? []).length === darkCount,
  `M=${(path.match(/M/g) ?? []).length} gelap=${darkCount}`,
);

// Bangun ulang matriks dari jalur SVG yang benar-benar digambar komponen, lalu
// pastikan sama persis dengan matriks aslinya.
const rebuilt = new Array(matrix.size * matrix.size).fill(false);
let inRange = true;
for (const match of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
  const col = Number(match[1]);
  const row = Number(match[2]);
  if (col >= matrix.size || row >= matrix.size) {
    inRange = false;
    continue;
  }
  rebuilt[row * matrix.size + col] = true;
}
check(
  "koordinat jalur SVG berada di dalam matriks",
  inRange,
  "ada modul di luar ukuran matriks",
);
check(
  "matriks hasil bangun-ulang sama dengan matriks aslinya",
  JSON.stringify(rebuilt) === JSON.stringify(matrix.modules),
  "jalur SVG tidak mewakili matriksnya",
);

// ------------------------------------------------------- bisa dipindai?

/**
 * Rapikan matriks jadi piksel: tiap modul satu blok persegi, ditambah zona tenang
 * di sekelilingnya — persis seperti yang dilihat kamera saat memindai layar.
 */
function rasterize(matrix, scale) {
  const size = matrix.size;
  const extent = (size + QR_QUIET_ZONE * 2) * scale;
  const data = new Uint8ClampedArray(extent * extent * 4);
  for (let y = 0; y < extent; y += 1) {
    for (let x = 0; x < extent; x += 1) {
      const col = Math.floor(x / scale) - QR_QUIET_ZONE;
      const row = Math.floor(y / scale) - QR_QUIET_ZONE;
      const dark =
        row >= 0 && row < size && col >= 0 && col < size && matrix.modules[row * size + col];
      const offset = (y * extent + x) * 4;
      const value = dark ? 0 : 255;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { data, extent };
}

const rendered = rasterize({ size: matrix.size, modules: rebuilt }, 8);
const decoded = jsQR(rendered.data, rendered.extent, rendered.extent);
check(
  "pemindai QR membaca balik payload yang sama",
  decoded?.data === payload,
  `terbaca=${decoded?.data ?? "null"}`,
);
check(
  "viewBox SVG memakai zona tenang empat modul",
  qrExtent(matrix) === matrix.size + QR_QUIET_ZONE * 2 && QR_QUIET_ZONE === 4,
  `extent=${qrExtent(matrix)}`,
);

if (results.length > 0 && results.every((result) => result.ok)) {
  console.log(`${results.length}/${results.length} checks passed`);
} else {
  for (const result of results) {
    console.log(`${result.ok ? "✓" : "✗"} ${result.name}`);
  }
  process.exitCode = 1;
}

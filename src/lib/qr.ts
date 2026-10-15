/**
 * Kode QR untuk tagihan digital.
 *
 * `qrPayload` (di `src/convex/lib/digitalPayment.ts`) hanya menghasilkan **teks**
 * payload; pelanggan tidak bisa memindainya. Modul ini menutup jarak itu: payload
 * yang sama diubah menjadi matriks modul gelap/terang yang digambar sebagai SVG
 * oleh `@/components/QrCode`.
 *
 * Dua hal yang dijaga di sini:
 *
 *  - **deterministik** — payload yang sama selalu menghasilkan matriks yang sama,
 *    sehingga tagihan yang dicetak ulang tidak berubah kodenya;
 *  - **matriks, bukan gambar** — yang dikembalikan adalah modul (bukan data URL
 *    canvas), jadi komponen bisa merendernya sebagai SVG tajam yang juga dipakai
 *    harness untuk memastikan kodenya benar-benar bisa dipindai.
 */

import QRCode from "qrcode";

/** Tingkat koreksi galat QR. `M` adalah baku untuk tagihan QRIS. */
export type QrErrorCorrection = "L" | "M" | "Q" | "H";

export interface QrMatrix {
  /** Jumlah modul per sisi; selalu ganjil dan setidaknya 21 (versi 1). */
  size: number;
  /** `true` berarti modul gelap. Panjangnya `size * size`, urut baris demi baris. */
  modules: boolean[];
}

/**
 * Bikin matriks QR dari payload. Melempar kalau payload kosong — tagihan tanpa
 * kode bukan kode yang bisa dipindai, dan lebih baik gagal daripada menggambar
 * kotak kosong yang menyesatkan.
 */
export function qrMatrix(
  payload: string,
  options?: { errorCorrectionLevel?: QrErrorCorrection },
): QrMatrix {
  if (typeof payload !== "string" || payload.trim().length === 0) {
    throw new Error("Payload QR kosong tidak bisa dijadikan kode.");
  }

  const created = QRCode.create(payload, {
    errorCorrectionLevel: options?.errorCorrectionLevel ?? "M",
  });
  const size = created.modules.size;
  const data = created.modules.data;
  const modules: boolean[] = new Array(size * size);
  for (let index = 0; index < modules.length; index += 1) {
    modules[index] = data[index] === 1;
  }
  return { size, modules };
}

/**
 * Ubah matriks jadi satu jalur SVG (`d`). Satu `<path>` jauh lebih ringan daripada
 * ratusan `<rect>` dan tetap tajam karena `shapeRendering="crispEdges"`.
 */
export function qrSvgPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (matrix.modules[row * matrix.size + col]) {
        parts.push(`M${col} ${row}h1v1h-1z`);
      }
    }
  }
  return parts.join("");
}

/** Zona tenang minimal menurut spesifikasi QRIS/QR: 4 modul di tiap sisi. */
export const QR_QUIET_ZONE = 4;

/**
 * Ukuran petak gambar (modul + zona tenang) untuk `viewBox` SVG. Dipisah supaya
 * komponen dan harness memakai angka yang sama.
 */
export function qrExtent(matrix: QrMatrix): number {
  return matrix.size + QR_QUIET_ZONE * 2;
}

/**
 * Cek struktur minimal matriks QR: ukuran ganjil ≥ 21, pola pencari (finder
 * pattern) di tiga sudut, dan pola waktu (timing pattern) yang bergantian. Ini
 * pemeriksaan cepat yang gagal kalau matriksnya bukan QR sama sekali.
 */
export function isPlausibleQrMatrix(matrix: QrMatrix): boolean {
  const { size, modules } = matrix;
  if (size < 21 || size % 2 === 0 || modules.length !== size * size) {
    return false;
  }
  const dark = (row: number, col: number) => modules[row * size + col] === true;

  // Tiga pola pencari 7×7: baris/kolom tepi gelap, inti 3×3 gelap, dan cincin
  // terang di antara keduanya.
  const finderAt = (top: number, left: number) => {
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        const edge = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        if (dark(top + r, left + c) !== (edge || core)) return false;
      }
    }
    return true;
  };
  if (!finderAt(0, 0) || !finderAt(0, size - 7) || !finderAt(size - 7, 0)) {
    return false;
  }

  // Pola waktu: modul pada baris/kolom ke-6 berselang-seling mulai dari gelap.
  for (let index = 8; index < size - 8; index += 1) {
    const expected = index % 2 === 0;
    if (dark(6, index) !== expected || dark(index, 6) !== expected) {
      return false;
    }
  }
  return true;
}

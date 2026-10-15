/**
 * Gambar QRIS (PNG) untuk **screenshot tamu** — aturan murni.
 *
 * Kenapa ada: ponsel yang menampilkan kode QRIS tidak bisa memindainya sendiri,
 * jadi jalur yang benar-benar bekerja untuk pembeli jarak jauh adalah **menyimpan
 * gambarnya**, lalu di aplikasi bank/e-wallet memilih “bayar dari galeri”. Yang
 * menentukan gambar itu masih bisa dipindai bukan warna temanya, melainkan
 * geometrinya — dan itulah yang dihitung di sini:
 *
 *  - **modul gelap di atas putih**, tanpa gradasi atau bayangan;
 *  - **zona tenang** empat modul (zona yang sama dengan `@/lib/qr`) plus tepi
 *    putih tambahan, karena pemindai butuh margin dan galeri sering memangkas
 *    tepinya;
 *  - **skala bilangan bulat** px per modul, dibatasi supaya gambar tidak buram
 *    (terlalu kecil) maupun boros (terlalu besar) untuk dikirim lewat obrolan.
 *
 * Berkasnya sendiri digambar di peramban (`@/lib/qrisImageRaster`); modul ini
 * tidak menyentuh DOM supaya batas ukurannya bisa diuji tanpa peramban.
 */

import { QR_QUIET_ZONE, qrExtent, qrMatrix, type QrMatrix } from "./qr";

/** Skala bawaan: 12 px per modul — kode ± 350 px, tajam di layar & cukup untuk galeri. */
export const QRIS_IMAGE_SCALE = 12;

/** Batas skala: di bawah 4 px pemindai mulai kesulitan, di atas 24 px berkasnya boros. */
export const QRIS_IMAGE_MIN_SCALE = 4;
export const QRIS_IMAGE_MAX_SCALE = 24;

/** Tepi putih di luar zona tenang, dalam px. */
export const QRIS_IMAGE_MARGIN_PX = 16;

/** Tinggi baris keterangan di bawah kode (0 = tanpa keterangan). */
export const QRIS_IMAGE_CAPTION_PX = 26;

/** Keterangan dipotong di sini; kolomnya bukan tempat menulis kalimat panjang. */
export const QRIS_IMAGE_CAPTION_MAX = 48;

/** Warna gambar; satu sumber untuk rasterizer & harness. */
export const QRIS_IMAGE_BG = "#ffffff";
export const QRIS_IMAGE_INK = "#000000";
export const QRIS_IMAGE_CAPTION_INK = "#111827";

export interface QrisImageLayout {
  /** Jumlah modul per sisi. */
  size: number;
  /** Modul + zona tenang (sisi, dalam modul). */
  extent: number;
  /** Piksel per modul. */
  scale: number;
  /** Zona tenang dalam px (4 modul). */
  quietZonePx: number;
  /** Sisi kode berikut zona tenangnya, dalam px. */
  codePx: number;
  marginPx: number;
  captionPx: number;
  caption: string | null;
  widthPx: number;
  heightPx: number;
}

function clampScale(scale: number | undefined): number {
  if (typeof scale !== "number" || !Number.isFinite(scale)) return QRIS_IMAGE_SCALE;
  return Math.min(
    QRIS_IMAGE_MAX_SCALE,
    Math.max(QRIS_IMAGE_MIN_SCALE, Math.round(scale)),
  );
}

/**
 * Tata letak gambar QRIS dari payload tagihan. Payload kosong melempar dari
 * `qrMatrix` — tagihan tanpa kode lebih baik gagal daripada menghasilkan gambar
 * kosong yang bikin tamu menunggu.
 */
export function qrisImageLayout(
  payload: string,
  options: { scale?: number; caption?: string | null } = {},
): QrisImageLayout {
  const matrix: QrMatrix = qrMatrix(payload);
  const scale = clampScale(options.scale);
  const extent = qrExtent(matrix);
  const codePx = extent * scale;
  const caption = (options.caption ?? "").trim().slice(0, QRIS_IMAGE_CAPTION_MAX);
  const captionPx = caption.length > 0 ? QRIS_IMAGE_CAPTION_PX : 0;
  const widthPx = codePx + QRIS_IMAGE_MARGIN_PX * 2;

  return {
    size: matrix.size,
    extent,
    scale,
    quietZonePx: QR_QUIET_ZONE * scale,
    codePx,
    marginPx: QRIS_IMAGE_MARGIN_PX,
    captionPx,
    caption: caption.length > 0 ? caption : null,
    widthPx,
    heightPx: widthPx + captionPx,
  };
}

/**
 * Keterangan di bawah kode: nominal + nomor tagihannya. Fungsinya bukan untuk
 * dipindai, melainkan supaya gambar yang tersimpan di galeri masih bisa
 * dicocokkan dengan tagihan yang sedang dibuka kasir.
 */
export function qrisImageCaption(input: {
  amount: number;
  chargeNumber: string;
}): string {
  const nominal = `Rp ${Math.round(input.amount).toLocaleString("id-ID")}`;
  return `${nominal} · ${(input.chargeNumber ?? "").trim()}`.slice(
    0,
    QRIS_IMAGE_CAPTION_MAX,
  );
}

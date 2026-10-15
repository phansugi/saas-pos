/**
 * Gambar QRIS → **satu PNG** untuk tombol “Screenshot QRIS” di halaman tamu.
 *
 * Jalurnya sama dengan gambar struk (`@/lib/receiptImageRaster`): digambar di
 * perangkat tamu, tidak ada unggahan ke mana pun, dan berkasnya siap begitu
 * tombolnya ditekan. Yang berbeda hanya isinya: kode QRIS apa adanya — modul
 * gelap di atas putih — plus satu baris keterangan (nominal + nomor tagihan)
 * supaya gambar yang tersimpan di galeri masih bisa dicocokkan dengan tagihan.
 *
 * Semua kegagalan (tanpa kanvas, `toBlob` tidak ada, payload kosong) menjawab
 * `null`: pemanggilnya yang memutuskan apa yang dikatakan ke tamu, dan tagihannya
 * tetap bisa dibayar dengan memindai layar.
 */

import { qrMatrix } from "@/lib/qr";
import { RECEIPT_IMAGE_FONT } from "@/lib/receiptImage";
import {
  QRIS_IMAGE_BG,
  QRIS_IMAGE_CAPTION_INK,
  QRIS_IMAGE_CAPTION_PX,
  QRIS_IMAGE_INK,
  qrisImageLayout,
  type QrisImageLayout,
} from "@/lib/qrisImage";

export interface QrisImageFile {
  bytes: Uint8Array;
  widthPx: number;
  heightPx: number;
  /** Tata letaknya dikembalikan supaya pemanggil tidak menghitung ulang. */
  layout: QrisImageLayout;
}

/**
 * Menggambar kode QRIS jadi PNG. `caption` dipotong oleh aturan murninya
 * (`qrisImageCaption`), jadi berkas & harness memakai kalimat yang sama.
 */
export async function qrisImagePng(
  payload: string,
  options: { caption?: string | null; scale?: number } = {},
): Promise<QrisImageFile | null> {
  if (typeof document === "undefined") return null;
  try {
    const layout = qrisImageLayout(payload, {
      caption: options.caption,
      scale: options.scale,
    });
    const matrix = qrMatrix(payload);

    const kanvas = document.createElement("canvas");
    const ctx = kanvas.getContext("2d");
    if (!ctx || typeof kanvas.toBlob !== "function") return null;

    /*
      Ukuran kanvas ditetapkan **sebelum** menggambar: mengubahnya sesudahnya
      menghapus isinya dan menyetel ulang semua gaya gambarnya.
    */
    kanvas.width = layout.widthPx;
    kanvas.height = layout.heightPx;

    ctx.fillStyle = QRIS_IMAGE_BG;
    ctx.fillRect(0, 0, layout.widthPx, layout.heightPx);

    ctx.fillStyle = QRIS_IMAGE_INK;
    const origin = layout.marginPx + layout.quietZonePx;
    for (let row = 0; row < matrix.size; row += 1) {
      for (let col = 0; col < matrix.size; col += 1) {
        if (matrix.modules[row * matrix.size + col]) {
          ctx.fillRect(
            origin + col * layout.scale,
            origin + row * layout.scale,
            layout.scale,
            layout.scale,
          );
        }
      }
    }

    if (layout.caption) {
      const fontSizePx = Math.max(11, Math.round(QRIS_IMAGE_CAPTION_PX * 0.55));
      ctx.fillStyle = QRIS_IMAGE_CAPTION_INK;
      ctx.font = `${fontSizePx}px ${RECEIPT_IMAGE_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(
        layout.caption,
        layout.widthPx / 2,
        layout.marginPx + layout.codePx + Math.round((layout.captionPx - fontSizePx) / 2),
      );
    }

    const blob = await new Promise<Blob | null>((selesai) =>
      kanvas.toBlob((hasil) => selesai(hasil), "image/png"),
    );
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length === 0) return null;

    return {
      bytes,
      widthPx: layout.widthPx,
      heightPx: layout.heightPx,
      layout,
    };
  } catch {
    // Kanvas yang menolak menggambar bukan alasan untuk menahan pembayaran.
    return null;
  }
}

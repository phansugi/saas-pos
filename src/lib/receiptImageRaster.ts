/**
 * Struk → **satu gambar PNG** untuk dibagikan ke WhatsApp (`@/lib/receiptImage`
 * yang menentukan tata letaknya).
 *
 * Kenapa di peramban, bukan di server: gambar struk dibuat di perangkat kasir yang
 * sedang memakainya — tidak ada unggahan ke mana pun, tidak ada antrean, dan
 * berkasnya siap saat tombolnya ditekan. Isinya sama dengan yang keluar di kertas:
 * teks monospace yang sama (kolom nominal tetap rata kanan), lembar rangkap yang
 * sama, dan logo toko di atas nama usaha.
 *
 * Dua hal yang membuat gambarnya bukan sekadar “tangkapan layar”:
 *
 * 1. **Logonya berwarna.** Di kertas & PDF logonya hitam putih (printernya begitu),
 *    sedangkan di percakapan WhatsApp gambar ini dilihat sebagai foto — jadi
 *    logonya digambar apa adanya, seperti di sidebar.
 * 2. **Ukuran hurufnya diukur, bukan ditebak.** Rasio lebar huruf monospace
 *    diambil dari kanvas perangkat ini (`measureText`), dan tata letaknya dihitung
 *    ulang kalau huruf di sini lebih lebar daripada perkiraan modul murni — tidak
 *    ada baris struk yang terpotong di tepi kanan hanya karena perangkatnya memakai
 *    huruf pengganti.
 *
 * Semua kegagalan (tanpa kanvas, `toBlob` tidak ada, fontnya rusak, gambarnya
 * keluar kosong) mengembalikan `null`: pemanggilnya yang memutuskan apa yang
 * dikatakan ke kasir, dan struknya sendiri tetap bisa dikirim lewat jalur lain.
 */

import type { ReceiptDocument } from "@/convex/lib/struk";
import { loadImage } from "@/lib/escposDevice";
import { withImageTimeout } from "@/lib/receiptLogoRaster";
import {
  RECEIPT_IMAGE_ADVANCE_RATIO,
  RECEIPT_IMAGE_BG,
  RECEIPT_IMAGE_FONT,
  RECEIPT_IMAGE_INK,
  receiptImageLayout,
  type ReceiptImageLayout,
} from "@/lib/receiptImage";

/** Batas kesabaran menunggu logo: sama dengan jalur PDF & lembar bagikan. */
const RECEIPT_IMAGE_LOGO_TIMEOUT_MS = 8000;

/** Garis tepi kertas di dalam gambarnya — pemisah putih kertas dengan latar abu-abu. */
const RECEIPT_IMAGE_SHEET_BORDER = "#d8dde5";

export interface ReceiptImageFile {
  bytes: Uint8Array;
  widthPx: number;
  heightPx: number;
  /** Tata letaknya dikembalikan supaya pemanggil tidak perlu menghitung ulang. */
  layout: ReceiptImageLayout;
  /**
   * Logo toko benar-benar tergambar di dalamnya. `false` = workspace belum
   * memasang logo **atau** gambarnya tidak terbaca dari perangkat ini — pemanggil
   * yang membedakan keduanya lewat `struk.logoUrl`.
   */
  logoDrawn: boolean;
}

/**
 * Menggambar struk jadi PNG.
 *
 * `logoUrls` diisi lebih dari satu kalau pemanggil punya URL logo yang lebih segar
 * daripada yang tersimpan di struknya (URL berkas Convex bertanda tangan & punya
 * masa berlaku); yang pertama berhasil dipakai, yang gagal dilewati tanpa
 * menggagalkan gambarnya.
 */
export async function receiptImagePng(
  struk: ReceiptDocument,
  options: { logoUrls?: Array<string | null | undefined> } = {},
): Promise<ReceiptImageFile | null> {
  if (typeof document === "undefined") return null;
  try {
    const kanvas = document.createElement("canvas");
    const ctx = kanvas.getContext("2d");
    if (!ctx || typeof kanvas.toBlob !== "function") return null;

    const logo = await muatLogo(
      options.logoUrls && options.logoUrls.length > 0
        ? options.logoUrls
        : [struk.logoUrl],
    );
    // Hanya dipakai kalau huruf di perangkat ini **lebih lebar** dari perkiraan:
    // huruf yang lebih sempit tidak boleh membuat teksnya membesar sendiri.
    const lebarHuruf = ukurLebarHuruf(ctx);
    const layout = receiptImageLayout(struk, {
      logo: logo
        ? {
            width: logo.naturalWidth || logo.width,
            height: logo.naturalHeight || logo.height,
          }
        : null,
      advanceRatio:
        lebarHuruf > RECEIPT_IMAGE_ADVANCE_RATIO ? lebarHuruf : undefined,
    });

    /*
      Ukuran kanvas ditetapkan **sebelum** menggambar: mengubahnya sesudahnya
      menghapus isinya dan menyetel ulang semua gaya gambarnya.
    */
    kanvas.width = layout.widthPx;
    kanvas.height = layout.heightPx;

    ctx.fillStyle = RECEIPT_IMAGE_BG;
    ctx.fillRect(0, 0, layout.widthPx, layout.heightPx);
    ctx.textBaseline = "top";
    ctx.font = `${layout.fontSizePx}px ${RECEIPT_IMAGE_FONT}`;
    ctx.lineWidth = 1;
    ctx.strokeStyle = RECEIPT_IMAGE_SHEET_BORDER;

    const logoDrawn = Boolean(logo && layout.logoBandPx > 0);
    for (let lembar = 0; lembar < layout.sheetCount; lembar += 1) {
      const atas = layout.gapPx + lembar * (layout.sheetHeightPx + layout.gapPx);
      const kiri = layout.gapPx + layout.padPx;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(layout.gapPx, atas, layout.sheetWidthPx, layout.sheetHeightPx);
      // Garis tepinya digambar setengah piksel masuk supaya tidak jadi 2 px kabur.
      ctx.strokeRect(layout.gapPx + 0.5, atas + 0.5, layout.sheetWidthPx - 1, layout.sheetHeightPx - 1);

      if (logoDrawn && logo) {
        const x = kiri + (layout.usablePx - layout.logoWidthPx) / 2;
        const y = atas + layout.padPx + (layout.logoBandPx - layout.logoHeightPx) / 2;
        ctx.drawImage(logo, x, y, layout.logoWidthPx, layout.logoHeightPx);
      }

      ctx.fillStyle = RECEIPT_IMAGE_INK;
      const baris = struk.sheets[lembar]?.lines ?? [];
      for (let index = 0; index < baris.length; index += 1) {
        ctx.fillText(
          baris[index],
          kiri,
          atas + layout.padPx + layout.logoBandPx + index * layout.lineHeightPx,
        );
      }
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
      logoDrawn,
    };
  } catch {
    // Kanvas yang menolak menggambar (mis. gambar dari origin lain tanpa CORS)
    // bukan alasan untuk menahan struknya.
    return null;
  }
}

/**
 * Lebar satu karakter relatif terhadap ukuran hurufnya, diukur dari kanvas
 * perangkat ini pada huruf yang **sama** dengan yang akan dipakai menggambar.
 */
function ukurLebarHuruf(ctx: CanvasRenderingContext2D): number {
  const contoh = 100;
  ctx.font = `${contoh}px ${RECEIPT_IMAGE_FONT}`;
  const lebar = ctx.measureText("0".repeat(10)).width;
  return lebar > 0 ? lebar / (contoh * 10) : 0;
}

/** Logo pertama yang berhasil dimuat; `null` kalau tidak ada satu pun yang bisa. */
async function muatLogo(
  urls: Array<string | null | undefined>,
): Promise<HTMLImageElement | null> {
  for (const url of urls) {
    if (!url) continue;
    try {
      const gambar = await withImageTimeout(
        loadImage(url),
        RECEIPT_IMAGE_LOGO_TIMEOUT_MS,
      );
      const lebar = gambar.naturalWidth || gambar.width;
      const tinggi = gambar.naturalHeight || gambar.height;
      if (lebar > 0 && tinggi > 0) return gambar;
    } catch {
      // URL yang satu ini gagal (kedaluwarsa, rusak, tidak terjangkau): coba
      // berikutnya, dan kalau semuanya gagal gambarnya dibuat tanpa logo.
    }
  }
  return null;
}

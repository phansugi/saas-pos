/**
 * Logo toko → byte **keabuan** untuk berkas PDF struk (`@/lib/receiptPdf`).
 *
 * Kenapa modulnya terpisah: penulis PDF-nya sengaja murni (tanpa `canvas`,
 * `Image`, atau jaringan) supaya bisa diuji tanpa peramban dan hasilnya
 * deterministik. Yang boleh menyentuh peramban cuma modul ini, dan itu
 * dikembalikan sebagai angka: `{ width, height, gray }`.
 *
 * Tiga keputusan yang diambil di sini:
 *
 * 1. **Gagal = tanpa logo, bukan gagal unduh.** Berkas dari penyimpanan Convex
 *    datang dari origin lain, dan lingkungan tanpa kanvas (DOM tiruan, peramban
 *    lawas) tidak bisa membaca piksel sama sekali. Semua kegagalan itu
 *    mengembalikan `null`, dan struknya tetap bisa diunduh/dikirim seperti
 *    sebelumnya — struk yang hilang gara-gara logonya jauh lebih buruk daripada
 *    struk tanpa logo.
 * 2. **Ukurannya tidak dinaikkan, rasionya tidak diubah.** Sisi panjangnya
 *    dipangkas ke `RECEIPT_PDF_LOGO_RASTER_PX` (± 2× ukuran cetaknya: 82,5 pt ≈
 *    110 px), dan logo yang lebih kecil dari itu dipakai apa adanya. Di PDF
 *    gambarnya dimuatkan ke pita setinggi logo di kertas (29,11 mm) dengan
 *    `contain`, jadi yang dilihat di layar ponsel sama dengan yang di kertas.
 * 3. **Keabuannya memakai bobot yang sama dengan jalur ESC/POS** (0,299 R +
 *    0,587 G + 0,114 B) dan piksel tembus pandang dihitung kertas (putih) —
 *    logo di PDF dan di printer struk tampak sama, bukan dua versi berbeda.
 *    Tidak ada filter kontras tambahan: yang menajamkan logo di kertas adalah
 *    ambang 50 % di jalur ESC/POS, dan di PDF tidak ada ambang.
 *
 * Hasilnya disimpan per URL: mengunduh & mengirim ulang struk yang sama tidak
 * memuat gambar yang sama berulang kali.
 */

import { RECEIPT_PDF_LOGO_RASTER_PX, type ReceiptPdfLogo } from "@/lib/receiptPdf";
import { loadImage } from "@/lib/escposDevice";

/** Batas kesabaran menunggu gambar: peramban yang tidak pernah memuat gambar tidak boleh menahan unduhan. */
const RECEIPT_PDF_LOGO_TIMEOUT_MS = 8000;

/** Berapa logo yang disimpan di memori; lebih dari ini, yang lama dilupakan. */
const RECEIPT_PDF_LOGO_CACHE = 4;

const cache = new Map<string, Promise<ReceiptPdfLogo | null>>();

/** Apakah lingkungan ini benar-benar bisa membaca piksel (kanvas 2D ada). */
let kanvasTersedia: boolean | null = null;
function bisaBacaPiksel(): boolean {
  if (kanvasTersedia !== null) return kanvasTersedia;
  try {
    const canvas = document.createElement("canvas");
    kanvasTersedia = Boolean(canvas.getContext && canvas.getContext("2d"));
  } catch {
    kanvasTersedia = false;
  }
  return kanvasTersedia;
}

/**
 * Byte keabuan untuk `url`, atau `null` kalau logonya tidak bisa dibaca di
 * lingkungan ini (tanpa kanvas, izin CORS tidak ada, gambarnya rusak, atau
 * memuatnya terlalu lama).
 */
export function rasteriseReceiptLogo(
  url: string | null | undefined,
  maxPx: number = RECEIPT_PDF_LOGO_RASTER_PX,
): Promise<ReceiptPdfLogo | null> {
  if (!url || maxPx <= 0) return Promise.resolve(null);
  const kunci = `${maxPx}|${url}`;
  const tersimpan = cache.get(kunci);
  if (tersimpan) return tersimpan;

  const janji = rasterise(url, maxPx).catch(() => null);
  cache.set(kunci, janji);
  // Batas jumlah: kunci berisi URL (bisa data URL sepanjang puluhan KB), jadi
  // membiarkannya tumbuh tanpa batas bukan pilihan di perangkat kasir.
  while (cache.size > RECEIPT_PDF_LOGO_CACHE) {
    const tertua = cache.keys().next();
    if (tertua.done) break;
    cache.delete(tertua.value);
  }
  return janji;
}

async function rasterise(url: string, maxPx: number): Promise<ReceiptPdfLogo | null> {
  if (typeof document === "undefined" || !bisaBacaPiksel()) return null;

  const image = await withImageTimeout(loadImage(url), RECEIPT_PDF_LOGO_TIMEOUT_MS);
  const lebarGambar = image.naturalWidth || image.width;
  const tinggiGambar = image.naturalHeight || image.height;
  if (lebarGambar <= 0 || tinggiGambar <= 0) return null;

  const skala = Math.min(1, maxPx / Math.max(lebarGambar, tinggiGambar));
  const lebar = Math.max(1, Math.round(lebarGambar * skala));
  const tinggi = Math.max(1, Math.round(tinggiGambar * skala));

  const canvas = document.createElement("canvas");
  canvas.width = lebar;
  canvas.height = tinggi;
  const context = canvas.getContext("2d");
  if (!context) return null;

  // Latar putih dulu: PNG tembus pandang tidak menjadi kotak hitam di PDF.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, lebar, tinggi);
  context.drawImage(image, 0, 0, lebar, tinggi);

  const piksel = context.getImageData(0, 0, lebar, tinggi).data;
  const gray = new Uint8Array(lebar * tinggi);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    if (piksel[offset + 3] < 128) {
      gray[index] = 255;
      continue;
    }
    gray[index] = Math.round(
      0.299 * piksel[offset] + 0.587 * piksel[offset + 1] + 0.114 * piksel[offset + 2],
    );
  }
  return { width: lebar, height: tinggi, gray };
}

/**
 * Janji yang tidak pernah selesai tidak boleh menahan unduhan struk.
 *
 * Dipakai bersama oleh modul ini dan `@/lib/receiptImageRaster` — keduanya
 * memuat gambar dari URL yang bisa saja tidak pernah menjawab (penyimpanan
 * lambat, berkas hilang), dan keduanya harus menyerah pada batas yang sama.
 */
export function withImageTimeout<T>(janji: Promise<T>, batasMs: number): Promise<T> {
  return new Promise<T>((selesai, gagal) => {
    const jam = setTimeout(
      () => gagal(new Error("Logo terlalu lama dimuat")),
      batasMs,
    );
    janji.then(
      (nilai) => {
        clearTimeout(jam);
        selesai(nilai);
      },
      (error) => {
        clearTimeout(jam);
        gagal(error);
      },
    );
  });
}

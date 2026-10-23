/**
 * Membaca **barcode / QR dari sebuah foto** (galeri atau kamera) memakai
 * `BarcodeDetector` bawaan peramban.
 *
 * Dipakai dua tempat: kolom Barcode / QR Code di form produk (memotret label
 * kemasan) dan tombol **Galeri / tangkapan layar** di dialog pemindai — jalur
 * untuk barcode yang hanya tampil di layar dan terlalu kecil untuk kamera.
 * Tidak ada pustaka pengenal kode tambahan — kalau peramban belum punya
 * `BarcodeDetector` (mis. Safari/Firefox saat ini), kodenya tetap bisa diketik
 * manual di kolom yang selalu tersedia.
 */
import type { ProductBarcodeType } from "@/lib/productBarcode";

interface DetectedBarcodeLike {
  rawValue: string;
  format?: string;
}

interface BarcodeDetectorLike {
  detect(source: ImageBitmap): Promise<DetectedBarcodeLike[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

/** Format yang sama dengan pemindai kamera, supaya hasilnya tidak berbeda. */
const IMAGE_FORMATS = [
  "qr_code",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "code_93",
  "itf",
  "codabar",
  "data_matrix",
  "pdf417",
  "aztec",
];

function barcodeDetectorConstructor(): BarcodeDetectorConstructor | null {
  if (typeof globalThis === "undefined") return null;
  const candidate = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  return typeof candidate === "function"
    ? (candidate as BarcodeDetectorConstructor)
    : null;
}

export type BarcodeImageResult =
  | { ok: true; code: string; barcodeType: ProductBarcodeType }
  | { ok: false; reason: string };

/** QR dan kode dua dimensi lain masuk ke pilihan QR; sisanya barcode 1D. */
function typeForFormat(format: string | undefined): ProductBarcodeType {
  return format === "qr_code" ||
    format === "data_matrix" ||
    format === "pdf417" ||
    format === "aztec"
    ? "qr"
    : "barcode";
}

/**
 * Membaca kode pertama dari berkas gambar. Hasilnya **teks mentah**, belum
 * dinormalkan atau divalidasi — pemanggil memakai `validateProductBarcode`.
 */
export async function readBarcodeFromImage(file: Blob): Promise<BarcodeImageResult> {
  if (typeof createImageBitmap !== "function") {
    return {
      ok: false,
      reason:
        "Peramban ini tidak bisa membaca gambar. Ketik kodenya secara manual.",
    };
  }

  const Detector = barcodeDetectorConstructor();
  if (!Detector) {
    return {
      ok: false,
      reason:
        "Peramban ini belum punya pembaca kode dari foto (BarcodeDetector). Ketik kodenya secara manual.",
    };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, reason: "Gambar tidak bisa dibuka. Coba foto lain dari galeri atau kamera." };
  }

  try {
    let formats = IMAGE_FORMATS;
    if (Detector.getSupportedFormats) {
      try {
        const didukung = new Set(await Detector.getSupportedFormats());
        const cocok = IMAGE_FORMATS.filter((format) => didukung.has(format));
        if (cocok.length > 0) formats = cocok;
      } catch {
        formats = IMAGE_FORMATS;
      }
    }

    let detector: BarcodeDetectorLike;
    try {
      detector = new Detector({ formats });
    } catch {
      try {
        detector = new Detector();
      } catch {
        return {
          ok: false,
          reason:
            "Pembaca kode di peramban ini tidak bisa dinyalakan. Ketik kodenya di kolom manual.",
        };
      }
    }

    const hasil = await detector.detect(bitmap);
    const terbaca = hasil.find((row) => row.rawValue.trim().length > 0);
    if (!terbaca) {
      return {
        ok: false,
        reason:
          "Kode tidak terbaca dari gambar itu. Pastikan barcode/QR terlihat utuh dan tajam, lalu coba lagi — atau ketik kodenya secara manual.",
      };
    }
    return {
      ok: true,
      code: terbaca.rawValue,
      barcodeType: typeForFormat(terbaca.format),
    };
  } catch {
    return {
      ok: false,
      reason: "Gagal membaca gambar. Coba gambar lain, atau ketik kodenya secara manual.",
    };
  } finally {
    bitmap.close?.();
  }
}

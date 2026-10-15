/**
 * Sisi klien dari gambar produk.
 *
 * Aturan batasnya (maksimal 8 gambar, 2 MB, tipe berkas) ada di
 * `@/convex/lib/productImages` dan dipakai bersama server — berkas ini hanya
 * menambah hal yang butuh peramban: memperkecil gambar sebelum dikirim, dan
 * membaca berkas menjadi data URL untuk mode demo.
 *
 * Gambar **selalu** diperkecil dulu di klien. Fotonya biasanya datang dari
 * kamera ponsel (3–8 MB, 4000 px); mengirimnya utuh berarti unggahan lambat,
 * kuota Convex terpakai untuk hal yang tidak terlihat (thumbnail-nya cuma
 * beberapa puluh piksel), dan mode demo menyimpan gambar itu sebagai data URL di
 * memori. Setelah diperkecil, tiap gambar biasanya tinggal ratusan KB.
 *
 * Kalau peramban tidak bisa memproses gambar (`createImageBitmap` tidak ada,
 * mis. di DOM tiruan harness) berkas aslinya dikembalikan apa adanya — bukan
 * diam-diam gagal, dan bukan juga memaksa lewat jalur yang tidak ada.
 */
import { MAX_PRODUCT_IMAGE_BYTES } from "@/convex/lib/productImages";

export * from "@/convex/lib/productImages";

/** Sisi terpanjang gambar setelah diperkecil (piksel). */
export const PRODUCT_IMAGE_MAX_EDGE = 1200;

/** Mutu JPEG hasil perkecilan; 0,82 masih terlihat tajam untuk foto produk. */
const PRODUCT_IMAGE_QUALITY = 0.82;

export interface PreparedProductImage {
  /** Berkas yang benar-benar dikirim/disimpan. */
  blob: Blob;
  /** Ukuran berkas asli pilihan pengguna (byte). */
  originalBytes: number;
  /** Ukuran berkas yang akan dikirim (byte). */
  bytes: number;
  /** Lebar/panjang hasil, terisi kalau gambarnya benar-benar diperkecil. */
  width?: number;
  height?: number;
  /** `true` kalau gambar diperkecil ulang oleh klien. */
  compressed: boolean;
}

/**
 * Perkecil gambar supaya aman dikirim: sisi terpanjang `PRODUCT_IMAGE_MAX_EDGE`,
 * di-encode ulang sebagai JPEG. PNG yang punya bagian transparan diratakan ke
 * latar putih (JPEG tidak menyimpan transparansi) — itu pilihan yang lebih jujur
 * daripada hasil berlatarkan hitam.
 */
export async function prepareProductImage(file: File): Promise<PreparedProductImage> {
  const asIs: PreparedProductImage = {
    blob: file,
    originalBytes: file.size,
    bytes: file.size,
    compressed: false,
  };

  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return asIs;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > 0 ? Math.min(1, PRODUCT_IMAGE_MAX_EDGE / longest) : 1;
    if (scale === 1 && file.size <= MAX_PRODUCT_IMAGE_BYTES) {
      bitmap.close?.();
      return asIs;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close?.();
      return asIs;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", PRODUCT_IMAGE_QUALITY);
    });
    if (!encoded || encoded.size === 0) return asIs;
    // Kalau hasilnya justru lebih besar (mis. gambar kecil yang sudah optimal),
    // berkas aslinya yang dipakai — perkecilan tidak boleh merugikan.
    if (encoded.size >= file.size) return asIs;

    return {
      blob: encoded,
      originalBytes: file.size,
      bytes: encoded.size,
      width: canvas.width,
      height: canvas.height,
      compressed: true,
    };
  } catch {
    return asIs;
  }
}

/**
 * Baca berkas menjadi data URL. Dipakai mode demo, yang tidak punya penyimpanan
 * berkas di server: gambarnya hidup di memori sebagai data URL, sama seperti
 * state demo lainnya (`localStorage` tidak ikut memuat gambar produk).
 */
export async function readImageAsDataUrl(blob: Blob): Promise<string> {
  const Reader = typeof FileReader === "function" ? FileReader : undefined;
  if (!Reader) {
    throw new Error("Peramban ini tidak bisa membaca berkas gambar.");
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new Reader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Berkas gambar tidak bisa dibaca."));
    reader.readAsDataURL(blob);
  });
}

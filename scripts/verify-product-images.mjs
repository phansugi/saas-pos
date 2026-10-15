/**
 * Uji aturan gambar produk tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/productImages.ts` — modul murni yang dipakai
 * halaman Produk & Stok (mengunci tombol + menghitung sisa slot), store demo
 * (menolak sebelum berkas "diunggah"), dan `products.addImage` di server (batas
 * terakhir yang tidak bisa dilewati request langsung). Karena aturannya satu,
 * hasilnya berlaku untuk ketiganya.
 *
 * Usage: bun scripts/verify-product-images.mjs
 */
import {
  canAddProductImage,
  describeProductImages,
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_IMAGES,
  normaliseImageType,
  productImageSlots,
  remainingProductImageSlots,
  validateProductImage,
} from "../src/convex/lib/productImages.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// ------------------------------------------------------------ batas jumlah
check("batas gambar per produk 8", MAX_PRODUCT_IMAGES === 8, String(MAX_PRODUCT_IMAGES));

for (let count = 0; count < MAX_PRODUCT_IMAGES; count += 1) {
  const room = canAddProductImage(count);
  check(`produk dengan ${count} gambar masih boleh ditambah`, room.ok, room.reason);
}

const full = canAddProductImage(MAX_PRODUCT_IMAGES);
check("gambar ke-9 ditolak", full.ok === false, String(full.ok));
check(
  "penolakan menyebut angka batas & jalan keluarnya",
  full.reason?.includes("8") === true && full.reason?.includes("Hapus") === true,
  full.reason,
);
check(
  "jumlah gambar negatif ditolak, bukan dianggap kosong",
  canAddProductImage(-1).ok === false,
  canAddProductImage(-1).reason,
);
check(
  "slot yang tersisa dihitung dari batas yang sama",
  remainingProductImageSlots(0) === 8 &&
    remainingProductImageSlots(5) === 3 &&
    remainingProductImageSlots(8) === 0 &&
    remainingProductImageSlots(99) === 0,
  `${remainingProductImageSlots(0)} ${remainingProductImageSlots(5)} ${remainingProductImageSlots(8)} ${remainingProductImageSlots(99)}`,
);
check(
  "label slot untuk UI",
  productImageSlots(0) === "0/8" && productImageSlots(3) === "3/8" && productImageSlots(8) === "8/8",
  `${productImageSlots(0)} ${productImageSlots(3)} ${productImageSlots(8)}`,
);
check(
  "ringkasan kolom tabel",
  describeProductImages(0) === "Belum ada gambar" &&
    describeProductImages(1) === "1/8 gambar" &&
    describeProductImages(8) === "8/8 gambar",
  `${describeProductImages(0)} | ${describeProductImages(1)} | ${describeProductImages(8)}`,
);

// -------------------------------------------------------------- tipe berkas
check("jpeg diterima", validateProductImage({ contentType: "image/jpeg", size: 1024 }).ok, "ditolak");
check("png diterima", validateProductImage({ contentType: "image/png", size: 1024 }).ok, "ditolak");
check("webp diterima", validateProductImage({ contentType: "image/webp", size: 1024 }).ok, "ditolak");
check(
  "tipe dengan parameter & huruf besar tetap diterima",
  validateProductImage({ contentType: "IMAGE/JPEG; charset=binary", size: 1024 }).ok,
  "ditolak",
);
check(
  "tipe yang tidak didukung ditolak dengan daftar formatnya",
  validateProductImage({ contentType: "image/gif", size: 1024 }).ok === false &&
    validateProductImage({ contentType: "application/pdf", size: 1024 }).reason?.includes(
      "JPG, PNG, atau WebP",
    ) === true,
  validateProductImage({ contentType: "application/pdf", size: 1024 }).reason,
);
check(
  "tanpa content type pun ditolak",
  validateProductImage({ contentType: null, size: 1024 }).ok === false,
  "diterima",
);
check(
  "normalisasi tipe berkas",
  normaliseImageType("image/png; charset=utf-8") === "image/png" &&
    normaliseImageType(undefined) === "" &&
    normaliseImageType("IMAGE/WEBP") === "image/webp",
  `${normaliseImageType("image/png; charset=utf-8")} | ${normaliseImageType(undefined)}`,
);

// ------------------------------------------------------------- batas ukuran
check(
  "berkas kosong ditolak",
  validateProductImage({ contentType: "image/jpeg", size: 0 }).ok === false &&
    validateProductImage({ contentType: "image/jpeg", size: Number.NaN }).ok === false,
  "diterima",
);
check(
  "tepat 2 MB masih diterima",
  validateProductImage({ contentType: "image/jpeg", size: MAX_PRODUCT_IMAGE_BYTES }).ok,
  "ditolak",
);
check(
  "satu byte di atas 2 MB ditolak dengan angka batasnya",
  validateProductImage({ contentType: "image/jpeg", size: MAX_PRODUCT_IMAGE_BYTES + 1 }).ok === false &&
    validateProductImage({ contentType: "image/jpeg", size: MAX_PRODUCT_IMAGE_BYTES + 1 }).reason?.includes(
      "2 MB",
    ) === true,
  validateProductImage({ contentType: "image/jpeg", size: MAX_PRODUCT_IMAGE_BYTES + 1 }).reason,
);

console.log(`${results.length}/${results.length} checks passed`);

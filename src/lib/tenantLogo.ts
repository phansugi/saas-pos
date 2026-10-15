/**
 * Sisi klien dari logo toko yang tercetak di struk.
 *
 * Aturan batasnya (satu berkas, maksimal 1 MB, tipe JPG/PNG/WebP) ada di
 * `@/convex/lib/tenantLogo` dan dipakai bersama server. Berkas ini hanya menambah
 * hal yang butuh peramban: memperkecil logo sebelum dikirim.
 *
 * Perkecilannya memakai jalur yang sama dengan gambar produk
 * (`prepareProductImage`): foto logo yang datang dari kamera ponsel bisa 3–8 MB
 * dan 4000 px, sedangkan yang tercetak di struk hanya selebar beberapa sentimeter.
 * Satu jalur perkecilan berarti tidak ada dua janji berbeda soal hasilnya.
 */
export * from "@/convex/lib/tenantLogo";

export {
  prepareProductImage as prepareTenantLogo,
  readImageAsDataUrl,
  type PreparedProductImage as PreparedTenantLogo,
} from "@/lib/productImages";

/**
 * Aturan logo toko.
 *
 * Satu workspace punya **satu** logo (bukan galeri seperti produk), dan berkasnya
 * maksimal 1 MB. Daftar tipe berkasnya sengaja memakai `PRODUCT_IMAGE_TYPES` —
 * aturan gambar produk — supaya tidak ada dua daftar format yang bisa berbeda
 * pendapat tentang apa yang boleh diunggah.
 *
 * Aturannya murni dan dipakai bersama, jadi batasnya sama di tiga tempat:
 *
 *  - halaman Pengaturan mematikan tombolnya lebih dulu,
 *  - store demo memakainya untuk menolak di klien,
 *  - `tenants.setLogo` memakainya **lagi** di server, dibaca dari metadata
 *    `_storage` — request langsung ke fungsi Convex tidak bisa melewati batas
 *    yang hanya dijaga UI.
 *
 * Logonya disimpan sebagai id berkas (`_storage`), bukan URL: URL bertanda tangan
 * punya masa berlaku, jadi URL yang ditulis ke DB akan menjadi logo mati.
 */

import {
  PRODUCT_IMAGE_TYPES,
  normaliseImageType,
  type ProductImageType,
  type Result,
} from "./productImages";

/** Batas ukuran satu berkas logo toko (setelah diperkecil di klien). */
export const MAX_TENANT_LOGO_BYTES = 1 * 1024 * 1024;

/**
 * Batas ukuran dalam MB, dibulatkan dari byte — dipakai kalimat bantuan supaya
 * angkanya tidak ditulis ulang (dan tidak bisa berbeda) di UI.
 */
export const MAX_TENANT_LOGO_MB = MAX_TENANT_LOGO_BYTES / (1024 * 1024);

/**
 * Tipe berkas yang diterima, untuk atribut `accept` pada input berkas. Isinya
 * sama dengan yang diperiksa `validateTenantLogo` — satu daftar, bukan dua.
 */
export const TENANT_LOGO_TYPES = PRODUCT_IMAGE_TYPES;

/** Kalimat bantuan untuk kolom unggah logo di halaman Pengaturan. */
export function tenantLogoHint(): string {
  return `Satu logo per workspace, maksimal ${MAX_TENANT_LOGO_MB} MB (JPG, PNG, atau WebP). Gambar besar diperkecil otomatis sebelum dikirim, dan logonya tercetak di atas nama usaha pada setiap struk.`;
}

/**
 * Periksa satu berkas logo: tipe, ukuran, dan tidak kosong. Dipakai store demo
 * (di klien, sebelum berkas "diunggah") dan server (dari metadata `_storage`).
 *
 * Pesannya menyebut angka & formatnya sendiri, karena yang membacanya bisa
 * pemilik toko di halaman Pengaturan maupun jawaban galat dari server.
 */
export function validateTenantLogo(input: {
  contentType?: string | null;
  size: number;
}): Result<true> {
  const type = normaliseImageType(input.contentType);
  if (!PRODUCT_IMAGE_TYPES.includes(type as ProductImageType)) {
    return {
      ok: false,
      reason: "Logo harus berformat JPG, PNG, atau WebP.",
    };
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, reason: "Berkas logo kosong; pilih berkas lain." };
  }
  if (input.size > MAX_TENANT_LOGO_BYTES) {
    return {
      ok: false,
      reason: `Ukuran logo maksimal ${MAX_TENANT_LOGO_MB} MB.`,
    };
  }
  return { ok: true, value: true };
}

/** Ringkasan keadaan logo untuk lencana di halaman Pengaturan. */
export function describeTenantLogo(installed: boolean): string {
  return installed ? "Logo terpasang" : "Belum ada logo";
}

/**
 * Kartu setelan workspace mana yang tampil di halaman Pengaturan, menurut paket
 * & modul yang benar-benar hidup untuk workspace itu.
 *
 * Alasannya bukan tata letak: setiap kartu mengubah angka yang keluar ke
 * pelanggan, dan menawarkan setelan yang fiturnya tidak ada di paket membuat
 * pemilik toko mengira ia sudah membayar sesuatu yang tidak ia miliki. Kartu
 * yang fiturnya tidak hidup **tidak ditampilkan** — bukan ditampilkan lalu
 * dikunci.
 *
 * Dua keputusan yang disengaja:
 *
 * 1. **Pajak & pungutan F&B** mengikuti modul F&B yang hidup (paket harus
 *    memuatnya **dan** tenant menyalakannya). Kartu ini tetap tampil kalau
 *    profilnya masih memungut sesuatu walau modulnya sudah mati — menyembunyikan
 *    kartu itu berarti workspace yang turun paket tidak punya jalan
 *    menghentikan PBJT/biaya layanan yang masih ditambahkan ke setiap struk.
 * 2. **Setelan struk belanja** mengikuti `peripheral.escpos`. Saat ini semua
 *    paket memuatnya, tetapi gerbangnya tetap ditulis supaya paket baru tanpa
 *    cetak struk tidak diam-diam menampilkan setelan printer.
 *
 * Halaman Pengaturan, kedua store, dan harness membaca aturan yang sama; jadi
 * yang tidak tampil di layar juga tidak "dianggap ada" oleh uji.
 */

import { hasFeature, type EntitlementSnapshot, type Vertical } from "@/lib/billing";

export interface SettingsSectionInput {
  /** Paket efektif workspace (dari `entitlementFor(planKey)`). */
  entitlements: EntitlementSnapshot;
  /** Modul yang hidup — sudah diiris dengan paket oleh kedua store. */
  activeVerticals: readonly Vertical[];
  /**
   * Profil pajak F&B yang tersimpan sedang memungut sesuatu (PBJT, biaya
   * layanan, atau kewajiban pusat). Dipakai supaya setelan yang masih berlaku
   * tidak hilang dari layar saat modul/ paketnya berubah.
   */
  fnbTaxInUse: boolean;
}

export interface SettingsSectionVisibility {
  /** Kartu “Pajak & pungutan F&B”. */
  fnbTax: boolean;
  /** Kartu “Struk belanja” (printer, kertas, rangkap, catatan kaki, logo). */
  receipt: boolean;
}

export function settingsSectionVisibility(
  input: SettingsSectionInput,
): SettingsSectionVisibility {
  return {
    fnbTax: input.activeVerticals.includes("fnb") || input.fnbTaxInUse,
    receipt: hasFeature(input.entitlements, "peripheral.escpos"),
  };
}

export interface MarketplacePairingVisibilityInput {
  /** Akun ini pemilik yang boleh memasang/melepas vendor (`ownerOnlyReason`). */
  canPair: boolean;
  /** Perannya memang boleh mengatur workspace (`billing.manage`). */
  canManageWorkspace: boolean;
  /** Jumlah kunci API aktif — tanda integrasi API workspace sudah diatur. */
  activeApiKeys: number;
}

/**
 * Kartu **Pairing vendor marketplace** hanya untuk satu keadaan yang utuh:
 *
 * 1. akunnya **pemilik** (hanya pemilik yang boleh memasang/melepas vendor —
 *    server menolak peran lain lewat `ownerOnlyReason`),
 * 2. perannya memang **mengatur workspace** (`billing.manage`, izin yang sama
 *    dengan halaman Pengaturan), dan
 * 3. workspace-nya **sudah mengatur API** — setidaknya satu kunci API aktif,
 *    yang dipakai integrasi marketplace untuk mengirim pesanan & menarik data.
 *
 * Tanpa ketiganya kartunya tidak ditampilkan sama sekali: bisnis yang belum
 * menyiapkan integrasi API tidak perlu ditawari pairing, dan akun yang bukan
 * pengelola workspace tidak perlu melihat setelan milik seluruh dokumen.
 */
export function marketplacePairingVisible(
  input: MarketplacePairingVisibilityInput,
): boolean {
  return (
    input.canPair && input.canManageWorkspace && input.activeApiKeys > 0
  );
}

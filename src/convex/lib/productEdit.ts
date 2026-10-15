/**
 * Produk yang **sudah tersimpan**: ubah identitas, aktif/nonaktifkan, hapus.
 *
 * Aturan murni di sini dipakai bersama server (`src/convex/products.ts`), kedua
 * store (demo & Convex), halaman Produk & Stok, dan harness. Tiga hal yang
 * sengaja dipisahkan dari `setPricing`/`setCategory` yang sudah ada:
 *
 * 1. **Identitas produk** (nama, SKU, harga beli) bisa diperbaiki tanpa menyentuh
 *    harga jual, konversi satuan, atau modifier. SKU tetap dipakai **apa adanya**
 *    (hurufnya tidak dipaksa besar) — sama dengan aturan saat produk dibuat —
 *    tetapi duplikatnya dibandingkan tanpa peduli huruf besar-kecil, karena
 *    `kopi-01` dan `KOPI-01` di satu katalog hanya menyesatkan pembaca.
 * 2. **Nonaktif ≠ hapus.** Produk nonaktif hilang dari kasir & katalog penjualan
 *    (`products.listByStore` hanya mengembalikan yang aktif), tetapi datanya tetap
 *    ada sehingga bisa diaktifkan kembali dan riwayatnya tetap bisa dibuka.
 * 3. **Hapus hanya untuk produk yang belum “dipakai”.** Begitu sebuah produk
 *    pernah terjual, pernah bergerak stoknya, ada di dokumen pembelian, atau ikut
 *    sesi opname, menghapusnya akan meninggalkan riwayat yang menggantung:
 *    baris penjualan, buku besar stok, dan dokumen supplier kehilangan produknya.
 *    Untuk produk seperti itu jawabannya **nonaktifkan**, bukan hapus — dan
 *    alasannya disebut satu per satu, bukan “tidak bisa dihapus”.
 */

export const PRODUCT_NAME_MIN = 2;
export const PRODUCT_NAME_MAX = 60;
export const PRODUCT_SKU_MAX = 40;

/**
 * Pola SKU: satu karakter alfanumerik di depan, sisanya boleh huruf, angka, dan
 * pemisah yang lazim dipakai katalog (`KOPI-01`, `PBB-SAN-000042`, `AB/12`).
 * Spasi ditolak — SKU yang ada spasinya tidak bisa dipindai/diketik ulang dengan
 * yakin, dan itu satu-satunya alasan SKU ada.
 */
const PRODUCT_SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export interface ProductIdentitySnapshot {
  name: string;
  sku: string;
  cost: number;
}

export interface ProductIdentityPatch {
  name?: string;
  sku?: string;
  cost?: number;
}

export type ProductIdentityResult =
  | { ok: true; value: ProductIdentitySnapshot; changed: string[] }
  | { ok: false; reason: string };

/** Rapikan nama produk: buang spasi pinggir dan rapatkan spasi tengah. */
export function normalizeProductName(raw: string): string {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Rapikan SKU: hanya spasi pinggir yang dibuang. Hurufnya **tidak** diubah, supaya
 * SKU yang sudah beredar (label, catatan supplier) tetap cocok.
 */
export function normalizeProductSku(raw: string): string {
  return (raw ?? "").trim();
}

/**
 * Validasi perubahan identitas produk. `changed` menyebut kolom yang benar-benar
 * berubah (kosong = tidak ada yang perlu disimpan), supaya server tidak menulis
 * audit untuk perubahan kosong dan halaman bisa mengatakannya apa adanya.
 */
export function validateProductIdentity(
  current: ProductIdentitySnapshot,
  patch: ProductIdentityPatch,
  options: { otherSkus?: readonly string[] } = {},
): ProductIdentityResult {
  const changed: string[] = [];
  const value: ProductIdentitySnapshot = {
    name: current.name,
    sku: current.sku,
    cost: Math.max(0, Math.round(current.cost)),
  };

  if (patch.name !== undefined) {
    const name = normalizeProductName(patch.name);
    if (name.length < PRODUCT_NAME_MIN || name.length > PRODUCT_NAME_MAX) {
      return {
        ok: false,
        reason: `Nama produk harus ${PRODUCT_NAME_MIN}–${PRODUCT_NAME_MAX} karakter.`,
      };
    }
    if (name !== current.name) {
      value.name = name;
      changed.push("name");
    }
  }

  if (patch.sku !== undefined) {
    const sku = normalizeProductSku(patch.sku);
    if (sku.length === 0) {
      return { ok: false, reason: "SKU tidak boleh kosong." };
    }
    if (sku.length > PRODUCT_SKU_MAX) {
      return { ok: false, reason: `SKU maksimal ${PRODUCT_SKU_MAX} karakter.` };
    }
    if (!PRODUCT_SKU_PATTERN.test(sku)) {
      return {
        ok: false,
        reason: "SKU hanya boleh huruf, angka, dan . _ - / tanpa spasi.",
      };
    }
    const key = sku.toUpperCase();
    const duplicate = (options.otherSkus ?? []).some(
      (other) => normalizeProductSku(other).toUpperCase() === key,
    );
    if (duplicate) {
      return { ok: false, reason: `SKU ${sku} sudah dipakai produk lain.` };
    }
    if (sku !== current.sku) {
      value.sku = sku;
      changed.push("sku");
    }
  }

  if (patch.cost !== undefined) {
    if (!Number.isFinite(patch.cost)) {
      return { ok: false, reason: "Harga beli harus berupa angka." };
    }
    if (patch.cost < 0) {
      return { ok: false, reason: "Harga beli tidak boleh negatif." };
    }
    const cost = Math.round(patch.cost);
    if (cost !== value.cost) {
      value.cost = cost;
      changed.push("cost");
    }
  }

  return { ok: true, value, changed };
}

/**
 * Seberapa “terpakai” sebuah produk — angka yang dipakai untuk memutuskan boleh
 * dihapus atau tidak. Semuanya dihitung di server dari data yang sebenarnya.
 */
export interface ProductUsage {
  /** Stok yang masih tercatat di semua lokasi (toko + gudang). */
  stock: number;
  /** Baris penjualan yang menunjuk produk ini (alat bukti transaksi). */
  sales: number;
  /** Catatan pergerakan stok (buku besar stok). */
  movements: number;
  /** Dokumen pembelian: permintaan, PO, penerimaan, dan tagihan supplier. */
  purchases: number;
  /** Sesi opname yang memuat produk ini. */
  opname: number;
}

export const EMPTY_PRODUCT_USAGE: ProductUsage = {
  stock: 0,
  sales: 0,
  movements: 0,
  purchases: 0,
  opname: 0,
};

/** Alasan produk tidak boleh dihapus; kosong berarti aman dihapus. */
export function productDeletionBlockers(usage: ProductUsage): string[] {
  const blockers: string[] = [];
  if (usage.stock > 0) {
    blockers.push(
      `masih ada ${usage.stock} di stok — sesuaikan stoknya ke 0 dulu kalau memang barangnya sudah habis`,
    );
  }
  if (usage.sales > 0) {
    blockers.push(
      `sudah terjual di ${usage.sales} baris transaksi — struk & laporan lamanya harus tetap bisa dibuka`,
    );
  }
  if (usage.movements > 0) {
    blockers.push(`punya ${usage.movements} catatan pergerakan stok`);
  }
  if (usage.purchases > 0) {
    blockers.push(
      `dipakai di ${usage.purchases} dokumen pembelian (permintaan, PO, penerimaan, atau tagihan supplier)`,
    );
  }
  if (usage.opname > 0) {
    blockers.push(`ikut di ${usage.opname} sesi opname`);
  }
  return blockers;
}

export interface ProductDeletionCheck {
  canDelete: boolean;
  blockers: string[];
  /** Kalimat siap-baca: kenapa bisa/ tidak bisa dihapus. */
  sentence: string;
}

/** Keputusan hapus produk + kalimatnya, satu tempat untuk server & halaman. */
export function productDeletionCheck(
  name: string,
  usage: ProductUsage,
): ProductDeletionCheck {
  const blockers = productDeletionBlockers(usage);
  if (blockers.length > 0) {
    return {
      canDelete: false,
      blockers,
      sentence: `Produk ${name} tidak bisa dihapus karena ${blockers.join("; ")}. Nonaktifkan saja: produknya hilang dari kasir, tetapi riwayatnya tetap utuh.`,
    };
  }
  return {
    canDelete: true,
    blockers,
    sentence: `Produk ${name} belum pernah terjual, stoknya kosong, dan tidak dipakai dokumen mana pun — menghapusnya hanya membuang data produknya.`,
  };
}

/** Kalimat sesudah produk dinyalakan/dimatikan. */
export function productStatusSentence(name: string, active: boolean, stock: number): string {
  if (active) {
    return `Produk ${name} diaktifkan kembali dan bisa dijual lagi${stock > 0 ? "" : " (stoknya masih 0, isi lewat Sesuaikan stok atau penerimaan barang)"}.`;
  }
  return `Produk ${name} dinonaktifkan — hilang dari kasir & katalog penjualan, tetapi datanya, riwayat penjualan, dan tabel Produk tetap memuatnya${stock > 0 ? ` (stoknya ${stock} tetap tercatat di gudang)` : ""}.`;
}

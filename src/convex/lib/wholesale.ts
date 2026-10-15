/**
 * Aturan modul Grosir (Phase 2): harga bertingkat (`pricing.multitier`) dan
 * konversi satuan multi-level (`uom.multilevel`).
 *
 * Murni dan tanpa dependensi Convex, supaya backend, klien, dan harness memakai
 * perhitungan yang sama. Aturan duit tidak boleh hidup dua kali.
 *
 * Model yang dipakai:
 * - stok dan `price` selalu dalam **satuan dasar** (default `PCS`),
 * - `tiers` menyatakan harga per satuan dasar untuk kuantitas dasar minimum,
 * - `units` menyatakan satuan besar (Dus/Pak) beserta faktornya terhadap satuan
 *   dasar, jadi harga per Dus = harga efektif per satuan dasar × faktor.
 */

export interface PriceTier {
  /** Kuantitas minimum (dalam satuan dasar) agar harga ini berlaku. */
  minQty: number;
  /** Harga per satuan dasar pada tier ini. */
  price: number;
}

export interface UnitConversion {
  /** Kode satuan besar, mis. "DUS" — selalu huruf besar. */
  code: string;
  /** Berapa satuan dasar dalam satu satuan ini (Dus = 24 Pcs → 24). */
  factor: number;
}

export interface WholesaleProduct {
  price: number;
  tiers?: PriceTier[];
  unit?: string;
  units?: UnitConversion[];
}

export const BASE_UNIT = "PCS";

/**
 * Kode satuan: huruf besar diawali huruf, 2–10 karakter (DUS, PAK, LUSIN, BOX1).
 * Satu huruf ditolak supaya tidak bertabrakan dengan singkatan acak di struk.
 */
const UNIT_CODE_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

export function normaliseUnitCode(value: string): string {
  return value.trim().toUpperCase();
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

/**
 * Tier harus unik per kuantitas, harganya tidak negatif, dan tidak lebih mahal
 * dari harga dasar — supaya "bertingkat" selalu berarti lebih murah untuk
 * pembelian besar, bukan sebaliknya.
 */
export function validateTiers(
  basePrice: number,
  tiers: PriceTier[],
): ValidationResult {
  if (tiers.length === 0) return { ok: true };

  const seen = new Set<number>();
  for (const tier of tiers) {
    if (!Number.isInteger(tier.minQty) || tier.minQty < 2) {
      return {
        ok: false,
        reason: `Kuantitas tier harus bilangan bulat minimal 2 (ditemukan ${tier.minQty}).`,
      };
    }
    if (seen.has(tier.minQty)) {
      return { ok: false, reason: `Kuantitas tier ${tier.minQty} ditulis dua kali.` };
    }
    seen.add(tier.minQty);
    if (!Number.isInteger(tier.price) || tier.price < 0) {
      return {
        ok: false,
        reason: `Harga tier untuk ${tier.minQty} harus bilangan bulat tidak negatif.`,
      };
    }
    if (tier.price > basePrice) {
      return {
        ok: false,
        reason: `Harga tier ${tier.minQty} (${tier.price}) lebih mahal dari harga dasar ${basePrice}.`,
      };
    }
  }
  return { ok: true };
}

/** Tier terurut menaik — bentuk kanonik yang disimpan dan ditampilkan. */
export function sortTiers(tiers: PriceTier[]): PriceTier[] {
  return [...tiers].sort((a, b) => a.minQty - b.minQty);
}

/**
 * Satuan besar harus punya kode sah, berbeda satu sama lain, bukan sama dengan
 * satuan dasar, dan faktornya bilangan bulat minimal 2.
 */
export function validateUnits(
  units: UnitConversion[],
  baseUnit: string = BASE_UNIT,
): ValidationResult {
  if (units.length === 0) return { ok: true };

  const base = normaliseUnitCode(baseUnit);
  const seen = new Set<string>([base]);
  for (const unit of units) {
    const code = normaliseUnitCode(unit.code);
    if (!UNIT_CODE_PATTERN.test(code)) {
      return {
        ok: false,
        reason: `Kode satuan "${unit.code}" tidak valid (contoh: DUS, PAK, LUSIN).`,
      };
    }
    if (seen.has(code)) {
      return { ok: false, reason: `Satuan ${code} ditulis dua kali.` };
    }
    seen.add(code);
    if (!Number.isInteger(unit.factor) || unit.factor < 2) {
      return {
        ok: false,
        reason: `Faktor satuan ${code} harus bilangan bulat minimal 2.`,
      };
    }
  }
  return { ok: true };
}

/** Faktor satuan terhadap satuan dasar; null kalau kodenya tidak dikenal. */
export function unitFactor(
  units: UnitConversion[] | undefined,
  code: string | undefined,
  baseUnit: string = BASE_UNIT,
): number | null {
  const base = normaliseUnitCode(baseUnit || BASE_UNIT);
  const wanted = normaliseUnitCode(code ?? "") || base;
  if (wanted === base) return 1;
  const match = (units ?? []).find(
    (unit) => normaliseUnitCode(unit.code) === wanted,
  );
  return match ? match.factor : null;
}

/** Tier yang berlaku untuk kuantitas dasar ini; null berarti pakai harga dasar. */
export function tierFor(
  tiers: PriceTier[] | undefined,
  baseQty: number,
): PriceTier | null {
  if (!tiers || tiers.length === 0) return null;
  let match: PriceTier | null = null;
  for (const tier of sortTiers(tiers)) {
    if (baseQty >= tier.minQty) match = tier;
  }
  return match;
}

export interface PricedLine {
  /** Kuantitas dalam satuan dasar — inilah yang memotong stok. */
  baseQty: number;
  /** Faktor satuan yang dipakai (1 = satuan dasar). */
  factor: number;
  /** Kode satuan yang dipakai, sudah dinormalkan. */
  unitCode: string;
  /** Harga per satuan yang dipilih (per Dus bila satuannya Dus). */
  unitPrice: number;
  /** Harga efektif per satuan dasar setelah tier. */
  baseUnitPrice: number;
  lineTotal: number;
  tier: PriceTier | null;
}

/**
 * Harga satu baris penjualan: konversi satuan dulu, lalu tier atas kuantitas
 * dasar. Satu fungsi supaya klien dan server tidak pernah berbeda angka.
 */
export function priceLine(input: {
  product: WholesaleProduct;
  quantity: number;
  unitCode?: string;
}): PricedLine {
  const { product, quantity } = input;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Kuantitas setiap item harus lebih dari 0.");
  }

  const baseUnit = product.unit || BASE_UNIT;
  const factor = unitFactor(product.units, input.unitCode, baseUnit);
  if (factor === null) {
    throw new Error(
      `Satuan ${input.unitCode} tidak dikenal untuk produk ini (satuan dasar ${normaliseUnitCode(baseUnit)}).`,
    );
  }

  const baseQty = quantity * factor;
  const tier = tierFor(product.tiers, baseQty);
  const baseUnitPrice = tier ? tier.price : product.price;

  return {
    baseQty,
    factor,
    unitCode: normaliseUnitCode(input.unitCode ?? baseUnit),
    unitPrice: baseUnitPrice * factor,
    baseUnitPrice,
    lineTotal: baseUnitPrice * baseQty,
    tier,
  };
}

/** True kalau produk memakai fitur modul Grosir, jadi modulnya wajib aktif. */
export function usesWholesale(product: WholesaleProduct): boolean {
  return (product.tiers?.length ?? 0) > 0 || (product.units?.length ?? 0) > 0;
}

/** Ringkasan siap-tampil untuk tabel produk. */
export function describeTiers(tiers: PriceTier[] | undefined): string {
  const list = sortTiers(tiers ?? []);
  if (list.length === 0) return "—";
  return list.map((tier) => `${tier.minQty}+ @${tier.price}`).join(" · ");
}

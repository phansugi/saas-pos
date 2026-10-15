/**
 * Modifier item (`pos.modifier`) — fitur modul F&B, Phase 2.
 *
 * Modifier adalah pilihan yang menempel pada satu baris pesanan: level pedas,
 * ukuran gelas, topping berbayar. Contoh nyata yang membuat fitur ini wajib di
 * F&B: "Nasi Goreng, pedas level 3, tambah telur" — tanpa modifier, kasir
 * menuliskannya di catatan dan dapur menebak.
 *
 * Murni dan tanpa dependensi Convex, supaya backend, klien, dan harness memakai
 * aturan yang sama. Tiga keputusan model yang penting:
 *
 * 1. **Harga modifier ditambahkan per unit yang dijual**, bukan per satuan
 *    dasar. Satu baris "2× Nasi Goreng + Telur 5.000" berarti 10.000, dan
 *    "1 DUS + Telur 5.000" tetap 5.000 (konsekuensi ini dijelaskan juga di
 *    POS dan di `docs` ringkas README). Kalau ditambahkan per satuan dasar,
 *    satu Dus 24 Pcs akan mengalikan topping 24×.
 * 2. **Pilihan disimpan sebagai kode**, bukan nama, supaya mengganti tulisan
 *    "Telur" → "Telur Ayam" tidak mengubah riwayat struk lama. Label untuk
 *    struk/dapur dibentuk dari konfigurasi saat transaksi dibuat.
 * 3. **`minSelect > 0` berarti wajib**. Itu yang membuat "level pedas wajib
 *    dipilih" bisa ditegakkan di server, bukan hanya di UI kasir.
 */

export const MAX_MODIFIER_GROUPS = 6;
export const MAX_MODIFIER_OPTIONS = 12;
export const MAX_GROUP_SELECT = 6;
export const MAX_LABEL_LENGTH = 24;

/** Kode grup memakai huruf besar (`LEVEL`, `TOPPING`, `UKURAN`). */
const GROUP_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,9}$/;
/** Kode opsi boleh angka pendek: `1`, `2`, `BOBA`, `LARGE`. */
const OPTION_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_]{0,9}$/;

export interface ModifierOption {
  code: string;
  name: string;
  /** Tambahan harga per unit, integer rupiah, tidak boleh negatif. */
  price: number;
}

export interface ModifierGroup {
  code: string;
  name: string;
  /** Jumlah pilihan minimum; `> 0` berarti grup ini wajib. */
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
}

export interface ModifierProduct {
  modifiers?: ModifierGroup[];
}

export function normaliseGroupCode(value: string): string {
  return value.trim().toUpperCase();
}

export function normaliseOptionCode(value: string): string {
  return value.trim().toUpperCase();
}

export function hasModifiers(product: ModifierProduct | null | undefined): boolean {
  return (product?.modifiers?.length ?? 0) > 0;
}

export interface ConfigResult {
  ok: boolean;
  groups: ModifierGroup[];
  reason?: string;
}

/**
 * Menormalkan sekaligus memvalidasi konfigurasi modifier sebuah produk. Dipakai
 * jalur tulis (server) dan harness; klien boleh memanggilnya untuk memberi tahu
 * kesalahan lebih awal, tetapi server tetap memvalidasi ulang.
 */
export function resolveModifierConfig(rawGroups: readonly ModifierGroup[]): ConfigResult {
  if (rawGroups.length > MAX_MODIFIER_GROUPS) {
    return {
      ok: false,
      groups: [],
      reason: `Maksimal ${MAX_MODIFIER_GROUPS} grup modifier per produk.`,
    };
  }

  const groups: ModifierGroup[] = [];
  const seenGroups = new Set<string>();

  for (const raw of rawGroups) {
    const code = normaliseGroupCode(raw.code ?? "");
    const name = (raw.name ?? "").trim();

    if (!GROUP_CODE_PATTERN.test(code)) {
      return {
        ok: false,
        groups: [],
        reason: `Kode grup modifier "${raw.code ?? ""}" tidak valid (2–10 karakter huruf/angka/_, diawali huruf).`,
      };
    }
    if (seenGroups.has(code)) {
      return { ok: false, groups: [], reason: `Grup modifier ${code} tertulis dua kali.` };
    }
    seenGroups.add(code);

    if (name.length === 0 || name.length > MAX_LABEL_LENGTH) {
      return {
        ok: false,
        groups: [],
        reason: `Nama grup modifier wajib diisi, maksimal ${MAX_LABEL_LENGTH} karakter.`,
      };
    }

    const maxSelect = Math.trunc(Number(raw.maxSelect));
    const minSelect = Math.trunc(Number(raw.minSelect));
    if (!Number.isFinite(maxSelect) || maxSelect < 1 || maxSelect > MAX_GROUP_SELECT) {
      return {
        ok: false,
        groups: [],
        reason: `Grup ${name}: jumlah pilihan maksimum harus 1–${MAX_GROUP_SELECT}.`,
      };
    }
    if (!Number.isFinite(minSelect) || minSelect < 0 || minSelect > maxSelect) {
      return {
        ok: false,
        groups: [],
        reason: `Grup ${name}: jumlah pilihan minimum harus 0–${maxSelect}.`,
      };
    }
    if (raw.options.length === 0) {
      return { ok: false, groups: [], reason: `Grup ${name} belum punya pilihan.` };
    }
    if (raw.options.length > MAX_MODIFIER_OPTIONS) {
      return {
        ok: false,
        groups: [],
        reason: `Grup ${name}: maksimal ${MAX_MODIFIER_OPTIONS} pilihan.`,
      };
    }

    const options: ModifierOption[] = [];
    const seenOptions = new Set<string>();
    for (const rawOption of raw.options) {
      const optionCode = normaliseOptionCode(rawOption.code ?? "");
      const optionName = (rawOption.name ?? "").trim();
      const price = Math.trunc(Number(rawOption.price));

      if (!OPTION_CODE_PATTERN.test(optionCode)) {
        return {
          ok: false,
          groups: [],
          reason: `Kode pilihan "${rawOption.code ?? ""}" tidak valid (huruf/angka/_, maksimal 10).`,
        };
      }
      if (seenOptions.has(optionCode)) {
        return {
          ok: false,
          groups: [],
          reason: `Pilihan ${optionCode} tertulis dua kali di grup ${name}.`,
        };
      }
      seenOptions.add(optionCode);

      if (optionName.length === 0 || optionName.length > MAX_LABEL_LENGTH) {
        return {
          ok: false,
          groups: [],
          reason: `Nama pilihan wajib diisi, maksimal ${MAX_LABEL_LENGTH} karakter.`,
        };
      }
      if (!Number.isFinite(price) || price < 0) {
        return {
          ok: false,
          groups: [],
          reason: `Tambahan harga ${optionName} tidak boleh negatif.`,
        };
      }

      options.push({ code: optionCode, name: optionName, price });
    }

    groups.push({ code, name, minSelect, maxSelect, options });
  }

  return { ok: true, groups };
}

export interface ModifierSelection {
  groupCode: string;
  optionCodes: string[];
}

export interface AppliedModifier {
  groupCode: string;
  groupName: string;
  optionCode: string;
  optionName: string;
  /** Tambahan harga per unit yang dijual. */
  price: number;
}

export interface ApplyResult {
  ok: boolean;
  reason?: string;
  applied: AppliedModifier[];
  /** Tambahan harga per unit (dijumlahkan dari semua opsi terpilih). */
  surcharge: number;
  /** Label siap tampil untuk struk/dapur: "Pedas: 3". */
  labels: string[];
}

const NO_MODIFIERS: ApplyResult = { ok: true, applied: [], surcharge: 0, labels: [] };

/**
 * Memvalidasi pilihan modifier seorang kasir untuk satu baris pesanan.
 *
 * Semua penolakan memakai bahasa yang bisa ditindaklanjuti kasir, karena
 * pesannya muncul di layar POS — bukan hanya di log.
 */
export function applyModifiers(
  product: ModifierProduct | null | undefined,
  selections: readonly ModifierSelection[] = [],
): ApplyResult {
  const groups = product?.modifiers ?? [];
  const chosen = selections.filter(
    (selection) => (selection.optionCodes ?? []).length > 0,
  );

  if (chosen.length === 0) {
    // Grup wajib tetap harus ditegakkan walaupun kasir tidak memilih apa pun.
    const required = groups.filter((group) => group.minSelect > 0);
    if (required.length > 0) {
      return {
        ok: false,
        applied: [],
        surcharge: 0,
        labels: [],
        reason: `${required[0].name} wajib dipilih untuk produk ini.`,
      };
    }
    return NO_MODIFIERS;
  }

  if (groups.length === 0) {
    return {
      ok: false,
      applied: [],
      surcharge: 0,
      labels: [],
      reason: "Produk ini tidak punya modifier.",
    };
  }

  const byCode = new Map(groups.map((group) => [group.code, group]));
  const applied: AppliedModifier[] = [];
  const pickedGroups = new Set<string>();

  for (const selection of chosen) {
    const groupCode = normaliseGroupCode(selection.groupCode ?? "");
    const group = byCode.get(groupCode);
    if (!group) {
      return {
        ok: false,
        applied: [],
        surcharge: 0,
        labels: [],
        reason: `Modifier ${selection.groupCode ?? ""} tidak dikenal untuk produk ini.`,
      };
    }
    if (pickedGroups.has(groupCode)) {
      return {
        ok: false,
        applied: [],
        surcharge: 0,
        labels: [],
        reason: `Grup ${group.name} dipilih dua kali.`,
      };
    }
    pickedGroups.add(groupCode);

    // Kode duplikat dalam satu pilihan diabaikan, bukan dihitung dua kali.
    const optionCodes = Array.from(new Set(selection.optionCodes.map(normaliseOptionCode)));
    if (optionCodes.length < group.minSelect) {
      return {
        ok: false,
        applied: [],
        surcharge: 0,
        labels: [],
        reason: `Pilih minimal ${group.minSelect} opsi untuk ${group.name}.`,
      };
    }
    if (optionCodes.length > group.maxSelect) {
      return {
        ok: false,
        applied: [],
        surcharge: 0,
        labels: [],
        reason: `Maksimal ${group.maxSelect} opsi untuk ${group.name}.`,
      };
    }

    const optionByCode = new Map(group.options.map((option) => [option.code, option]));
    for (const optionCode of optionCodes) {
      const option = optionByCode.get(optionCode);
      if (!option) {
        return {
          ok: false,
          applied: [],
          surcharge: 0,
          labels: [],
          reason: `Opsi ${optionCode} tidak ada di grup ${group.name}.`,
        };
      }
      applied.push({
        groupCode: group.code,
        groupName: group.name,
        optionCode: option.code,
        optionName: option.name,
        price: option.price,
      });
    }
  }

  for (const group of groups) {
    if (group.minSelect > 0 && !pickedGroups.has(group.code)) {
      return {
        ok: false,
        applied: [],
        surcharge: 0,
        labels: [],
        reason: `${group.name} wajib dipilih untuk produk ini.`,
      };
    }
  }

  // Urutan mengikuti konfigurasi produk (bukan urutan klik) supaya label dan
  // struk selalu sama untuk pilihan yang sama.
  const order = new Map(groups.map((group, index) => [group.code, index]));
  applied.sort(
    (a, b) =>
      (order.get(a.groupCode) ?? 0) - (order.get(b.groupCode) ?? 0) ||
      a.optionCode.localeCompare(b.optionCode),
  );

  return {
    ok: true,
    applied,
    surcharge: applied.reduce((sum, modifier) => sum + modifier.price, 0),
    labels: applied.map((modifier) => `${modifier.groupName}: ${modifier.optionName}`),
  };
}

/**
 * Total satu baris: harga (sudah termasuk tier/konversi satuan) **plus** tambahan
 * modifier dikalikan jumlah unit yang dijual.
 */
export function lineTotalWithModifiers(
  pricedLineTotal: number,
  quantity: number,
  surchargePerUnit: number,
): number {
  return pricedLineTotal + surchargePerUnit * quantity;
}

/** Ringkasan satu baris untuk struk/layar: "Pedas: 3 · Topping: Telur". */
export function modifierSummary(labels: readonly string[]): string {
  return labels.join(" · ");
}

/**
 * Usulan kode dari nama yang diketik pengguna — dipakai halaman Produk supaya
 * pemilik toko tidak perlu mengarang kode. Kode tetap divalidasi server, jadi ini
 * kenyamanan UI, bukan aturan harga.
 */
function suggestCode(
  name: string,
  taken: readonly string[],
  pattern: RegExp,
  fallback: string,
): string {
  const base = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 10);

  let candidate = pattern.test(base) ? base : fallback;
  if (!pattern.test(candidate)) candidate = fallback;

  let attempt = 2;
  while (taken.includes(candidate)) {
    const suffix = `_${attempt}`;
    candidate = `${candidate.slice(0, 10 - suffix.length)}${suffix}`;
    attempt += 1;
  }
  return candidate;
}

export function suggestGroupCode(name: string, taken: readonly string[] = []): string {
  return suggestCode(name, taken, GROUP_CODE_PATTERN, "GRUP");
}

export function suggestOptionCode(name: string, taken: readonly string[] = []): string {
  return suggestCode(name, taken, OPTION_CODE_PATTERN, "OPSI");
}

/** Ringkasan konfigurasi untuk halaman Produk: "Pedas (wajib 1), Topping (0–2)". */
export function describeModifierGroups(groups: readonly ModifierGroup[] | undefined): string {
  if (!groups || groups.length === 0) return "Tanpa modifier";
  return groups
    .map((group) =>
      group.minSelect > 0
        ? `${group.name} (wajib ${group.minSelect}–${group.maxSelect})`
        : `${group.name} (0–${group.maxSelect})`,
    )
    .join(" · ");
}

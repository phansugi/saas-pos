/**
 * Vertical plug-in modules — Phase 2.
 *
 * A *module* is a vertical product pack (UMKM, F&B, Grosir) that a tenant can
 * switch on, and it is what makes the plan matter: the plan decides which
 * modules are **available** and how many may run at once (`verticalLimit`),
 * while the tenant record (`tenants.verticals`) decides which of them are
 * **active** right now.
 *
 * Two consequences are deliberate:
 *
 * 1. A feature owned by a module (`FEATURE_OWNER`) is only usable while that
 *    module is active. The plan may already include the feature — Starter has
 *    `pos.quickgrid`, Professional has `pos.kds` — but a tenant that has not
 *    switched the module on does not get it yet.
 * 2. The rules live here, in one pure module shared by the web app, the Convex
 *    backend and the test harnesses, so the UI can only offer what the server
 *    will accept. Never gate a module solely in the client.
 */

import {
  PLANS,
  VERTICAL_LABELS,
  type FeatureKey,
  type Vertical,
} from "./catalog";
import {
  hasFeature,
  isUnlimited,
  validateVerticalSelection,
  type EntitlementSnapshot,
} from "./entitlements";

export interface ModuleDefinition {
  vertical: Vertical;
  /** Nama modul yang tampil di UI. */
  name: string;
  /** Satu baris untuk kartu modul. */
  tagline: string;
  description: string;
  /**
   * Fitur yang hanya hidup selama modul ini aktif. Fitur yang tidak dimiliki
   * modul mana pun tetap murni ditentukan paket (mis. inventori, laporan).
   */
  features: FeatureKey[];
}

export const MODULES: Record<Vertical, ModuleDefinition> = {
  umkm: {
    vertical: "umkm",
    name: VERTICAL_LABELS.umkm,
    tagline: "Kasir cepat, member, dan stok sederhana",
    description:
      "Paket dasar untuk toko, kedai, dan retail mikro: grid produk cepat, diskon member, dan pencatatan stok harian.",
    features: ["pos.quickgrid", "member.discount"],
  },
  fnb: {
    vertical: "fnb",
    name: VERTICAL_LABELS.fnb,
    tagline: "Meja, dapur, dan modifier menu",
    description:
      "Untuk kafe dan restoran: denah meja, Kitchen Display System, serta pesanan yang ditahan lalu dikirim ke dapur.",
    features: ["pos.table", "pos.kds", "pos.modifier"],
  },
  wholesale: {
    vertical: "wholesale",
    name: VERTICAL_LABELS.wholesale,
    tagline: "Harga bertingkat, satuan, dan piutang B2B",
    description:
      "Untuk distributor dan grosir: harga per kuantitas, konversi satuan Dus/Pak/Pcs, serta credit limit pelanggan B2B.",
    features: ["pricing.multitier", "uom.multilevel", "ar.creditlimit"],
  },
};

/** Urutan kanonik untuk UI dan untuk hasil seleksi yang deterministik. */
export const MODULE_LIST: ModuleDefinition[] = [
  MODULES.umkm,
  MODULES.fnb,
  MODULES.wholesale,
];

export function moduleFor(vertical: Vertical): ModuleDefinition {
  return MODULES[vertical];
}

export function isVertical(value: string): value is Vertical {
  return Object.prototype.hasOwnProperty.call(MODULES, value);
}

/** Modul yang "memiliki" sebuah fitur; null berarti fitur murni milik paket. */
export const FEATURE_OWNER: Record<FeatureKey, Vertical | null> = (() => {
  const owner = {} as Record<FeatureKey, Vertical | null>;
  for (const module of MODULE_LIST) {
    for (const feature of module.features) owner[feature] = module.vertical;
  }
  return owner;
})();

export function featureOwner(feature: FeatureKey): Vertical | null {
  return FEATURE_OWNER[feature] ?? null;
}

/** Modul yang boleh diaktifkan paket ini (tanpa memperhatikan pilihan tenant). */
export function availableModules(
  entitlements: EntitlementSnapshot,
): ModuleDefinition[] {
  const allowed = new Set(entitlements.verticals);
  return MODULE_LIST.filter((module) => allowed.has(module.vertical));
}

/** Modul yang ada di katalog tapi tidak termasuk paket ini. */
export function lockedModules(
  entitlements: EntitlementSnapshot,
): ModuleDefinition[] {
  const allowed = new Set(entitlements.verticals);
  return MODULE_LIST.filter((module) => !allowed.has(module.vertical));
}

/**
 * Modul yang benar-benar aktif: pilihan tenant yang **juga** diizinkan paket.
 * Irisan ini yang dipakai untuk gerbang fitur, sehingga turun paket langsung
 * mematikan fitur modul yang tidak lagi tersedia.
 */
export function activeModules(
  entitlements: EntitlementSnapshot,
  active: Vertical[],
): ModuleDefinition[] {
  const allowed = new Set(entitlements.verticals);
  const chosen = new Set(active);
  return MODULE_LIST.filter(
    (module) => chosen.has(module.vertical) && allowed.has(module.vertical),
  );
}

export function activeVerticals(
  entitlements: EntitlementSnapshot,
  active: Vertical[],
): Vertical[] {
  return activeModules(entitlements, active).map((module) => module.vertical);
}

export function isModuleActive(
  entitlements: EntitlementSnapshot,
  active: Vertical[],
  vertical: Vertical,
): boolean {
  return activeVerticals(entitlements, active).includes(vertical);
}

/**
 * Fitur efektif: harus ada di paket **dan** modul pemiliknya harus aktif.
 * Fitur tanpa pemilik hanya bergantung pada paket.
 */
export function isFeatureEnabled(
  entitlements: EntitlementSnapshot,
  active: Vertical[],
  feature: FeatureKey,
): boolean {
  if (!hasFeature(entitlements, feature)) return false;
  const owner = featureOwner(feature);
  return owner === null || isModuleActive(entitlements, active, owner);
}

export interface BlockedFeature {
  feature: FeatureKey;
  module: ModuleDefinition;
}

/**
 * Fitur yang sudah dibayar paket tapi belum bisa dipakai karena modulnya mati —
 * bahan untuk "aktifkan modul X untuk memakai Y".
 */
export function blockedFeatures(
  entitlements: EntitlementSnapshot,
  active: Vertical[],
): BlockedFeature[] {
  const activeSet = new Set(activeVerticals(entitlements, active));
  const blocked: BlockedFeature[] = [];
  for (const module of availableModules(entitlements)) {
    if (activeSet.has(module.vertical)) continue;
    for (const feature of module.features) {
      if (hasFeature(entitlements, feature)) {
        blocked.push({ feature, module });
      }
    }
  }
  return blocked;
}

export interface ModuleSelectionResult {
  ok: boolean;
  /** Seleksi yang sudah dinormalkan (unikan + urutan katalog). */
  selected: Vertical[];
  reason?: string;
}

/**
 * Memvalidasi pilihan modul dari klien. Aturan paket (modul diizinkan +
 * `verticalLimit`) didelegasikan ke `validateVerticalSelection` supaya hanya ada
 * satu sumber kebijakan; di sini ditambah dua aturan khusus modul: nama modul
 * harus dikenal, dan minimal satu modul harus tetap aktif.
 */
export function resolveModuleSelection(
  entitlements: EntitlementSnapshot,
  requested: readonly string[],
): ModuleSelectionResult {
  const unknown = requested.filter((value) => !isVertical(value));
  if (unknown.length > 0) {
    return { ok: false, selected: [], reason: `Modul tidak dikenal: ${unknown.join(", ")}.` };
  }

  const unique = Array.from(new Set(requested)) as Vertical[];
  if (unique.length === 0) {
    return {
      ok: false,
      selected: [],
      reason: "Minimal satu modul harus tetap aktif.",
    };
  }

  const ordered = MODULE_LIST.map((m) => m.vertical).filter((v) => unique.includes(v));
  const rule = validateVerticalSelection(entitlements, ordered);
  if (!rule.ok) {
    return { ok: false, selected: ordered, reason: rule.reason };
  }
  return { ok: true, selected: ordered };
}

export interface ModuleSummary {
  /** Modul aktif, sudah diiris dengan paket. */
  active: ModuleDefinition[];
  /** Modul yang boleh diaktifkan paket ini. */
  available: ModuleDefinition[];
  /** Modul yang terkunci di paket ini. */
  locked: ModuleDefinition[];
  /** Fitur yang menunggu modulnya dinyalakan. */
  blocked: BlockedFeature[];
  /** `unlimited` atau jumlah modul maksimum. */
  limit: number | "unlimited";
  planKey: EntitlementSnapshot["planKey"];
  planName: string;
}

/** Ringkasan tunggal untuk halaman Modul, dashboard, maupun auditor. */
export function moduleSummary(
  entitlements: EntitlementSnapshot,
  active: Vertical[],
): ModuleSummary {
  return {
    active: activeModules(entitlements, active),
    available: availableModules(entitlements),
    locked: lockedModules(entitlements),
    blocked: blockedFeatures(entitlements, active),
    limit: isUnlimited(entitlements.verticalLimit)
      ? "unlimited"
      : entitlements.verticalLimit,
    planKey: entitlements.planKey,
    planName: PLANS[entitlements.planKey].name,
  };
}

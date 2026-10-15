/**
 * Ringkasan modul plug-in (Phase 2) untuk UI.
 *
 * Satu perhitungan untuk kedua store (demo dan Convex): paket + daftar modul
 * aktif masuk, kartu modul keluar. Aturan aktivasi diambil dari
 * `src/convex/lib/billing/modules.ts` — modul yang sama yang dipakai backend —
 * sehingga UI tidak mungkin menawarkan modul yang akan ditolak server.
 */

import {
  entitlementFor,
  FEATURE_LABELS,
  featureOwner,
  isFeatureEnabled,
  moduleSummary,
  PLANS,
  VERTICAL_LABELS,
  type FeatureKey,
  type ModuleDefinition,
  type PlanKey,
  type Vertical,
} from "@/lib/billing";

export interface StoreModuleFeature {
  key: FeatureKey;
  label: string;
}

export interface StoreModuleCard {
  vertical: Vertical;
  name: string;
  tagline: string;
  description: string;
  features: StoreModuleFeature[];
}

export interface StoreBlockedFeature {
  feature: FeatureKey;
  label: string;
  vertical: Vertical;
  moduleName: string;
}

export interface StoreModules {
  planKey: PlanKey;
  planName: string;
  /** `unlimited` pada Enterprise, atau jumlah modul maksimum paket ini. */
  limit: number | "unlimited";
  /** Modul yang sedang hidup (irisan pilihan tenant dengan paket). */
  active: StoreModuleCard[];
  activeVerticals: Vertical[];
  /** Modul yang boleh diaktifkan paket ini. */
  available: StoreModuleCard[];
  /** Modul yang terkunci di paket ini, lengkap dengan alasannya. */
  locked: (StoreModuleCard & { reason: string })[];
  /** Fitur yang sudah dibayar paket tapi menunggu modulnya dinyalakan. */
  blocked: StoreBlockedFeature[];
}

function toCard(module: ModuleDefinition): StoreModuleCard {
  return {
    vertical: module.vertical,
    name: module.name,
    tagline: module.tagline,
    description: module.description,
    features: module.features.map((key) => ({ key, label: FEATURE_LABELS[key] })),
  };
}

export function modulesFor(planKey: PlanKey, active: Vertical[]): StoreModules {
  const entitlements = entitlementFor(planKey);
  const summary = moduleSummary(entitlements, active);

  return {
    planKey: summary.planKey,
    planName: summary.planName,
    limit: summary.limit,
    active: summary.active.map(toCard),
    activeVerticals: summary.active.map((module) => module.vertical),
    available: summary.available.map(toCard),
    locked: summary.locked.map((module) => ({
      ...toCard(module),
      reason: `Tidak termasuk paket ${summary.planName}.`,
    })),
    blocked: summary.blocked.map((entry) => ({
      feature: entry.feature,
      label: FEATURE_LABELS[entry.feature],
      vertical: entry.module.vertical,
      moduleName: entry.module.name,
    })),
  };
}

/** Dipakai halaman untuk menyembunyikan/menonaktifkan fitur modul. */
export function moduleFeatureEnabled(
  planKey: PlanKey,
  active: Vertical[],
  feature: FeatureKey,
): boolean {
  return isFeatureEnabled(entitlementFor(planKey), active, feature);
}

/**
 * Kalimat yang menjelaskan **kenapa** sebuah fitur modul tidak hidup, memakai
 * dua sebab yang berbeda dan butuh tindakan berbeda pula:
 *
 * - modulnya belum dinyalakan → suruh ke halaman Modul;
 * - paketnya belum memuat fitur itu → suruh naik paket.
 *
 * `null` berarti fiturnya hidup.
 *
 * Sebelumnya halaman hanya menulis “modul belum aktif” untuk kedua kasus, dan
 * itu menyesatkan tenant Starter: modulnya sudah aktif, yang kurang paket — dan
 * membuka halaman Modul tidak akan menolongnya.
 */
export function featureUnavailableReason(
  planKey: PlanKey,
  active: Vertical[],
  feature: FeatureKey,
): string | null {
  const entitlements = entitlementFor(planKey);
  if (isFeatureEnabled(entitlements, active, feature)) return null;

  const label = FEATURE_LABELS[feature];
  const owner = featureOwner(feature);

  if (owner && !active.includes(owner)) {
    return `Fitur ${label} memerlukan modul ${VERTICAL_LABELS[owner]} yang belum aktif — nyalakan di halaman Modul.`;
  }

  const planName = PLANS[entitlements.planKey].name;
  return owner
    ? `Fitur ${label} tidak termasuk paket ${planName}; naikkan paket untuk memakainya.`
    : `Fitur ${label} tidak termasuk paket ${planName}.`;
}

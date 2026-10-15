/**
 * Entitlement engine — resolves a tenant's effective capabilities from its
 * plan (plus add-ons/overrides) and answers feature & limit questions.
 *
 * This is deliberately the ONLY place where "what is allowed" is decided, so
 * the same answer can be returned to the web app, the mobile POS and the
 * Convex backend. Never gate a feature solely in the client.
 */

import {
  PLANS,
  UNLIMITED,
  type FeatureKey,
  type LimitKey,
  type LimitValue,
  type Limits,
  type PlanKey,
  type Vertical,
} from "./catalog";

export interface EntitlementSnapshot {
  planKey: PlanKey;
  planVersion: number;
  features: ReadonlySet<FeatureKey>;
  limits: Limits;
  verticals: Vertical[];
  verticalLimit: LimitValue;
}

export interface EntitlementOptions {
  /** Add-on features granted on top of the plan (e.g. trial unlocks). */
  addons?: FeatureKey[];
  /** Per-tenant limit overrides negotiated on Enterprise deals. */
  limitOverrides?: Partial<Limits>;
}

export function entitlementFor(
  planKey: PlanKey,
  options: EntitlementOptions = {},
): EntitlementSnapshot {
  const plan = PLANS[planKey];
  const features = new Set<FeatureKey>(plan.features);
  for (const addon of options.addons ?? []) {
    features.add(addon);
  }

  return {
    planKey,
    planVersion: plan.version,
    features,
    limits: { ...plan.limits, ...options.limitOverrides },
    verticals: [...plan.verticals],
    verticalLimit: plan.verticalLimit,
  };
}

export function hasFeature(
  entitlements: EntitlementSnapshot,
  feature: FeatureKey,
): boolean {
  return entitlements.features.has(feature);
}

export function getLimit(
  entitlements: EntitlementSnapshot,
  key: LimitKey,
): LimitValue {
  return entitlements.limits[key];
}

export function isUnlimited(value: LimitValue): value is typeof UNLIMITED {
  return value === UNLIMITED;
}

/** True when `current` seats/resources can grow by one more. */
export function isWithinLimit(
  entitlements: EntitlementSnapshot,
  key: LimitKey,
  current: number,
): boolean {
  const limit = entitlements.limits[key];
  return isUnlimited(limit) ? true : current < limit;
}

export function remainingQuota(
  entitlements: EntitlementSnapshot,
  key: LimitKey,
  current: number,
): LimitValue {
  const limit = entitlements.limits[key];
  return isUnlimited(limit) ? UNLIMITED : Math.max(0, limit - current);
}

export interface VerticalSelectionResult {
  ok: boolean;
  selected: Vertical[];
  reason?: string;
}

/**
 * Professional lets a tenant pick a subset of verticals (e.g. F&B *or*
 * Grosir), Enterprise unlocks all. This validates a requested selection.
 */
export function validateVerticalSelection(
  entitlements: EntitlementSnapshot,
  requested: Vertical[],
): VerticalSelectionResult {
  const selected = Array.from(new Set(requested));
  const allowed = new Set(entitlements.verticals);

  const invalid = selected.filter((v) => !allowed.has(v));
  if (invalid.length > 0) {
    return {
      ok: false,
      selected,
      reason: `Modul tidak tersedia di paket ini: ${invalid.join(", ")}`,
    };
  }

  if (!isUnlimited(entitlements.verticalLimit) && selected.length > entitlements.verticalLimit) {
    return {
      ok: false,
      selected,
      reason: `Paket ini hanya mengizinkan ${entitlements.verticalLimit} modul aktif sekaligus.`,
    };
  }

  return { ok: true, selected };
}

/**
 * Diff of two entitlement snapshots — use to build upgrade prompts and to
 * persist an audit trail when a tenant changes plan.
 */
export function entitlementsDelta(
  from: EntitlementSnapshot,
  to: EntitlementSnapshot,
): { gained: FeatureKey[]; lost: FeatureKey[] } {
  const gained: FeatureKey[] = [];
  const lost: FeatureKey[] = [];
  for (const feature of to.features) {
    if (!from.features.has(feature)) gained.push(feature);
  }
  for (const feature of from.features) {
    if (!to.features.has(feature)) lost.push(feature);
  }
  return { gained: gained.sort(), lost: lost.sort() };
}

/**
 * Modul yang tersisa setelah pindah paket: yang tidak ada di paket baru dibuang,
 * lalu dipotong sampai `verticalLimit`.
 *
 * Satu aturan untuk dua sisi — `billing.changePlan` di server dan aksi store di
 * klien — supaya sesi tidak pernah menampilkan modul yang sudah dibuang server,
 * atau sebaliknya menyembunyikan modul yang masih aktif. Urutan asli dipertahankan
 * (bukan diurutkan ulang), karena modul pertama menentukan label paket di sidebar.
 */
export function trimVerticalsForPlan(
  planKey: PlanKey,
  verticals: readonly Vertical[],
): Vertical[] {
  const entitlements = entitlementFor(planKey);
  const allowed = new Set(entitlements.verticals);
  const kept = verticals.filter((vertical) => allowed.has(vertical));
  if (isUnlimited(entitlements.verticalLimit)) return kept;
  return kept.slice(0, entitlements.verticalLimit);
}

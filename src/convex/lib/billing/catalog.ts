/**
 * Plan catalog — the single source of truth for subscription tiers,
 * feature entitlements and hard limits.
 *
 * Prices are stored as integer rupiah (IDR has no minor unit) and plans are
 * versioned so existing tenants keep the entitlements they signed up for when
 * the catalog changes.
 */

export type Money = number; // integer rupiah

export type Vertical = "umkm" | "fnb" | "wholesale";

export const VERTICAL_LABELS: Record<Vertical, string> = {
  umkm: "UMKM & Retail Mikro",
  fnb: "Food & Beverage",
  wholesale: "Grosir & Wholesale",
};

export type FeatureKey =
  // POS terminal
  | "pos.quickgrid"
  | "pos.table"
  | "pos.kds"
  | "pos.modifier"
  | "peripheral.escpos"
  | "sync.realtime"
  // Reporting
  | "report.daily"
  | "report.advanced"
  // Inventory
  | "inventory.basic"
  | "inventory.multiwarehouse"
  | "inventory.opname"
  // Purchasing
  | "purchasing.basic"
  | "purchasing.threeway"
  // Wholesale
  | "pricing.multitier"
  | "uom.multilevel"
  | "ar.creditlimit"
  // Growth
  | "member.discount"
  | "payment.digital"
  // Platform / enterprise
  | "api.access"
  | "rbac.custom"
  | "support.dedicated"
  // Skala franchise
  | "scale.franchise";

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  "pos.quickgrid": "Grid menu cepat (Quick Grid)",
  "pos.table": "Visual table management & denah meja",
  "pos.kds": "Kitchen Display System & KOT terpisah",
  "pos.modifier": "Modifier item (level pedas, topping)",
  "peripheral.escpos": "Cetak struk ESC/POS Bluetooth & USB",
  "sync.realtime": "Sinkronisasi real-time multi-perangkat",
  "report.daily": "Laporan omzet harian",
  "report.advanced": "Advanced BI & analitik",
  "inventory.basic": "Manajemen stok sederhana",
  "inventory.multiwarehouse": "Multi-warehouse & lokasi rak",
  "inventory.opname": "Stock opname & audit selisih",
  "purchasing.basic": "Purchasing (PR · PO · GRN)",
  "purchasing.threeway": "3-way matching & AP",
  "pricing.multitier": "Multi-tier pricing per kuantitas",
  "uom.multilevel": "Konversi satuan multi-level (Dus/Pak/Pcs)",
  "ar.creditlimit": "Piutang B2B & credit limit",
  "member.discount": "Manajemen diskon & member",
  "payment.digital": "Pembayaran digital QRIS / VA",
  "api.access": "API akses penuh & webhook",
  "rbac.custom": "Custom role (RBAC)",
  "support.dedicated": "Dedicated support",
  "scale.franchise": "Optimasi beban skala franchise",
};

export const ALL_FEATURES: FeatureKey[] = Object.keys(
  FEATURE_LABELS,
) as FeatureKey[];

export type PlanKey = "starter" | "professional" | "enterprise";

export type LimitKey =
  | "devices"
  | "stores"
  | "warehouses"
  | "products"
  | "users";

export type LimitValue = number | "unlimited";
export type Limits = Record<LimitKey, LimitValue>;

export const UNLIMITED = "unlimited" as const;

export interface PlanPricing {
  monthly: Money;
  yearly: Money;
}

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  /** Bump when entitlements/pricing change so tenants keep their version. */
  version: number;
  subtitle: string;
  description: string;
  /** Vertical modules this plan can activate. */
  verticals: Vertical[];
  /** How many verticals may be active at once. */
  verticalLimit: LimitValue;
  features: FeatureKey[];
  limits: Limits;
  /** null = custom / sales-led pricing. */
  price: PlanPricing | null;
  highlight: boolean;
  cta: string;
}

const UNLIMITED_LIMITS: Limits = {
  devices: UNLIMITED,
  stores: UNLIMITED,
  warehouses: UNLIMITED,
  products: UNLIMITED,
  users: UNLIMITED,
};

export const PLANS: Record<PlanKey, PlanDefinition> = {
  starter: {
    key: "starter",
    name: "Starter",
    version: 1,
    subtitle: "UMKM & kedai kecil",
    description: "Untuk bisnis mikro single-store yang baru mulai digital.",
    verticals: ["umkm"],
    verticalLimit: 1,
    features: [
      "pos.quickgrid",
      "peripheral.escpos",
      "report.daily",
      "inventory.basic",
    ],
    limits: {
      devices: 1,
      stores: 1,
      warehouses: 1,
      products: 500,
      users: 2,
    },
    price: { monthly: 149000, yearly: 1490000 },
    highlight: false,
    cta: "Mulai gratis",
  },

  professional: {
    key: "professional",
    name: "Professional",
    version: 1,
    subtitle: "Retail & F&B aktif",
    description:
      "Untuk toko retail menengah dan F&B dengan operasional harian aktif.",
    verticals: ["umkm", "fnb", "wholesale"],
    verticalLimit: 2,
    features: [
      "pos.quickgrid",
      "pos.table",
      "pos.kds",
      "pos.modifier",
      "peripheral.escpos",
      "sync.realtime",
      "report.daily",
      "inventory.basic",
      "pricing.multitier",
      "uom.multilevel",
      "ar.creditlimit",
      "member.discount",
      "payment.digital",
    ],
    limits: {
      devices: 5,
      stores: 3,
      warehouses: 1,
      products: 10000,
      users: 15,
    },
    price: { monthly: 399000, yearly: 3990000 },
    highlight: true,
    cta: "Pilih paket",
  },

  enterprise: {
    key: "enterprise",
    name: "Enterprise",
    version: 1,
    subtitle: "Franchise & multi-cabang",
    description:
      "Untuk jaringan franchise, grosir besar, dan operasi multi-cabang.",
    verticals: ["umkm", "fnb", "wholesale"],
    verticalLimit: UNLIMITED,
    features: ALL_FEATURES,
    limits: UNLIMITED_LIMITS,
    price: null,
    highlight: false,
    cta: "Hubungi sales",
  },
};

export const PLAN_LIST: PlanDefinition[] = [
  PLANS.starter,
  PLANS.professional,
  PLANS.enterprise,
];

export function getPlan(key: PlanKey): PlanDefinition {
  return PLANS[key];
}

/**
 * Peringkat paket menurut `PLAN_LIST` (murah → lengkap); `-1` kalau tak dikenal.
 *
 * Dipakai halaman Langganan untuk mencari **paket berikutnya di atas** milik
 * tenant. Tombol yang namanya ditulis tetap — seperti “Upgrade ke Professional”
 * yang ikut tampil di paket Enterprise — bukan sekadar salah label: ia
 * menawarkan paket yang lebih rendah sebagai “upgrade”.
 */
export function planRank(key: PlanKey): number {
  return PLAN_LIST.findIndex((plan) => plan.key === key);
}

/**
 * Paket berikutnya di atas `key` — `null` kalau sudah yang tertinggi (tidak ada
 * “di atasnya” yang bisa ditawarkan) atau kalau `key` tidak dikenal.
 */
export function nextPlanUp(key: PlanKey): PlanDefinition | null {
  const at = planRank(key);
  if (at < 0 || at >= PLAN_LIST.length - 1) return null;
  return PLAN_LIST[at + 1];
}

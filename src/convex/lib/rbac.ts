/**
 * Peran kustom (`rbac.custom`, Phase 4 / Enterprise Intelligence) — aturan murni.
 *
 * Modul ini dipakai bersama oleh backend (`src/convex/roles.ts` lewat
 * `requirePermission`), sesi klien (`src/lib/session.tsx`), halaman Tim & Peran,
 * kedua store, dan harness. Karena itu semua keputusan ada di sini: Convex hanya
 * membundel modul di bawah `src/convex`.
 *
 * Tiga prinsipnya:
 *
 * 1. **Peran kustom menggantikan, bukan menambah.** Anggota yang ditugaskan ke
 *    sebuah peran kustom memakai daftar izin peran itu persis — sama seperti
 *    peran bawaan. Kalau hanya menambah, "kasir yang tidak boleh membatalkan
 *    transaksi" tidak bisa dibuat: peran bawaannya sudah punya izin itu.
 * 2. **Tidak ada eskalasi lewat nama baru.** Pembuat peran tidak bisa memberi
 *    izin yang dia sendiri tidak punya; peran bawaan yang dipakai untuk
 *    memeriksa itu adalah peran dasar anggota yang membuat, bukan peran
 *    kustomnya. Tanpa pagar ini, manajer bisa membuat peran berisi
 *    `billing.manage` lalu menugaskannya ke dirinya sendiri.
 * 3. **Peran kustom tidak boleh menyamar jadi peran bawaan.** Nama seperti
 *    "Kasir" atau "cashier" ditolak supaya daftar anggota tidak pernah punya dua
 *    peran berbeda dengan nama yang sama — orang akan salah membaca izinnya.
 *
 * Peran pemilik tenant sengaja **tidak bisa** ditugaskan ke peran kustom: pemilik
 * harus selalu memegang seluruh izin, termasuk `billing.manage`, supaya tidak ada
 * tenant yang terkunci dari langganannya sendiri.
 */

import {
  can,
  PERMISSION_LABELS,
  permissionsFor,
  ROLE_LABELS,
  ROLES,
  type Permission,
  type Role,
} from "./authz";

/**
 * Semua izin yang dikenal, dalam urutan deklarasi `PERMISSION_LABELS`.
 * Urutan ini **stabil** dan dipakai di mana-mana (checklist halaman, penyimpanan,
 * audit), supaya dua peran dengan izin yang sama selalu tercatat sama persis.
 */
export const KNOWN_PERMISSIONS: Permission[] = Object.keys(
  PERMISSION_LABELS,
) as Permission[];

/** Batas panjang nama peran kustom. */
export const CUSTOM_ROLE_NAME_MIN = 3;
export const CUSTOM_ROLE_NAME_MAX = 40;
/** Batas jumlah peran kustom per tenant. */
export const MAX_CUSTOM_ROLES = 20;
/** Batas panjang keterangan. */
export const CUSTOM_ROLE_DESC_MAX = 200;

export interface CustomRoleInput {
  name: string;
  description?: string;
  /**
   * Izin yang diminta. Bertipe `string[]` karena datang dari UI/DB: entri yang
   * tidak dikenal dijaring di sini, bukan dipercaya.
   */
  permissions: readonly string[];
}

export interface CustomRoleDraft {
  name: string;
  description?: string;
  permissions: Permission[];
}

export type CustomRoleValidation =
  | { ok: true; value: CustomRoleDraft }
  | { ok: false; reason: string };

export interface CustomRoleLike {
  name: string;
  permissions: readonly Permission[];
}

/** Nama bawaan yang tidak boleh dipakai ulang oleh peran kustom. */
const RESERVED_ROLE_NAMES = new Set(
  [...ROLES, ...ROLES.map((role) => ROLE_LABELS[role])].map((value) =>
    value.trim().toLowerCase(),
  ),
);

/** Rapikan nama peran: buang spasi pinggir dan rapatkan spasi tengah. */
export function normalizeRoleName(raw: string): string {
  return (raw ?? "").trim().replace(/\s+/g, " ");
}

export function isReservedRoleName(raw: string): boolean {
  return RESERVED_ROLE_NAMES.has(normalizeRoleName(raw).toLowerCase());
}

export function isPermission(value: string): value is Permission {
  return (KNOWN_PERMISSIONS as string[]).includes(value);
}

/**
 * Buang izin tak dikenal & duplikat, lalu kembalikan dalam urutan kanonik.
 * Dipakai saat menyimpan **dan** saat membaca, sehingga baris lama yang isinya
 * berubah bentuk tetap menghasilkan daftar yang sama dengan yang ditampilkan.
 */
export function sanitizePermissions(
  values: readonly string[] | undefined | null,
): Permission[] {
  const wanted = new Set((values ?? []).filter(isPermission));
  return KNOWN_PERMISSIONS.filter((permission) => wanted.has(permission));
}

/** Izin yang diminta tetapi **tidak** dimiliki peran pembuatnya. */
export function lackingPermissions(
  actingRole: Role,
  permissions: readonly Permission[],
): Permission[] {
  return sanitizePermissions(permissions).filter(
    (permission) => !can(actingRole, permission),
  );
}

/**
 * Izin efektif seorang anggota: peran kustom (kalau ada) **menggantikan** peran
 * bawaan; tanpa peran kustom, peran bawaan yang berlaku.
 *
 * Daftar kosong dari peran kustom yang rusak diperlakukan sebagai "tidak ada
 * peran kustom" supaya anggota tidak mendadak kehilangan seluruh akses karena
 * satu baris data yang salah bentuk.
 */
export function effectivePermissions(
  role: Role,
  customPermissions?: readonly Permission[] | null,
): Permission[] {
  const custom = sanitizePermissions(customPermissions);
  if (custom.length > 0) return custom;
  return sanitizePermissions(permissionsFor(role));
}

/** Apakah anggota dengan peran ini boleh melakukan `permission`? */
export function memberCan(
  role: Role,
  customPermissions: readonly Permission[] | null | undefined,
  permission: Permission,
): boolean {
  return effectivePermissions(role, customPermissions).includes(permission);
}

/** Selisih dua daftar izin — dipakai UI (pratinjau) dan audit. */
export function permissionDelta(
  from: readonly Permission[],
  to: readonly Permission[],
): { added: Permission[]; removed: Permission[] } {
  const before = new Set(sanitizePermissions(from));
  const after = new Set(sanitizePermissions(to));
  return {
    added: KNOWN_PERMISSIONS.filter(
      (permission) => after.has(permission) && !before.has(permission),
    ),
    removed: KNOWN_PERMISSIONS.filter(
      (permission) => before.has(permission) && !after.has(permission),
    ),
  };
}

/**
 * Kenapa sebuah keanggotaan tidak boleh ditugaskan ke peran kustom.
 * `null` berarti boleh.
 */
export function assignmentError(targetRole: Role): string | null {
  if (targetRole === "owner") {
    return "Pemilik tenant selalu memegang seluruh izin; peran kustom tidak bisa ditugaskan kepadanya.";
  }
  return null;
}

/** Kalimat ringkas sebuah peran kustom untuk daftar. */
export function describeCustomRole(role: CustomRoleLike): string {
  return `${normalizeRoleName(role.name)} · ${sanitizePermissions(role.permissions).length} izin`;
}

/**
 * Validasi lengkap satu peran kustom. `existingNames` boleh memuat nama peran
 * yang sedang diubah sendiri; itu urusan pemanggil (kecualikan dirinya).
 */
export function validateCustomRole(
  input: CustomRoleInput,
  options: {
    /** Peran dasar pembuat, untuk pagar eskalasi. */
    actingRole: Role;
    /** Nama peran kustom lain di tenant ini. */
    existingNames?: readonly string[];
    /** Jumlah peran kustom yang sudah ada (untuk batas paket). */
    count?: number;
  },
): CustomRoleValidation {
  const name = normalizeRoleName(input.name ?? "");
  if (name.length < CUSTOM_ROLE_NAME_MIN || name.length > CUSTOM_ROLE_NAME_MAX) {
    return {
      ok: false,
      reason: `Nama peran harus ${CUSTOM_ROLE_NAME_MIN}–${CUSTOM_ROLE_NAME_MAX} karakter.`,
    };
  }
  if (isReservedRoleName(name)) {
    return {
      ok: false,
      reason: `"${name}" sudah dipakai peran bawaan; pakai nama lain supaya izinnya tidak tertukar.`,
    };
  }

  const used = new Set(
    (options.existingNames ?? []).map((value) =>
      normalizeRoleName(value).toLowerCase(),
    ),
  );
  if (used.has(name.toLowerCase())) {
    return { ok: false, reason: `Peran "${name}" sudah ada di tenant ini.` };
  }

  if ((options.count ?? 0) >= MAX_CUSTOM_ROLES) {
    return {
      ok: false,
      reason: `Maksimal ${MAX_CUSTOM_ROLES} peran kustom per tenant.`,
    };
  }

  const requested = [...(input.permissions ?? [])];
  const unknown = [...new Set(requested.filter((value) => !isPermission(value)))];
  if (unknown.length > 0) {
    return { ok: false, reason: `Izin tidak dikenal: ${unknown.join(", ")}.` };
  }

  const permissions = sanitizePermissions(requested);
  if (permissions.length === 0) {
    return {
      ok: false,
      reason: "Pilih minimal satu izin — peran tanpa izin hanya membuka menu kosong.",
    };
  }

  const lacking = lackingPermissions(options.actingRole, permissions);
  if (lacking.length > 0) {
    return {
      ok: false,
      reason: `Anda tidak bisa memberi izin yang Anda sendiri tidak punya: ${lacking
        .map((permission) => PERMISSION_LABELS[permission])
        .join(", ")}.`,
    };
  }

  const description = (input.description ?? "").trim().slice(0, CUSTOM_ROLE_DESC_MAX);

  return {
    ok: true,
    value: {
      name,
      description: description.length > 0 ? description : undefined,
      permissions,
    },
  };
}

/**
 * Pengelompokan izin untuk checklist di halaman Tim & Peran. Urutannya dibaca
 * manusia, jadi sengaja bukan urutan deklarasi tabel. Harness memeriksa bahwa
 * gabungan semua grup **sama persis** dengan `KNOWN_PERMISSIONS`, sehingga izin
 * baru tidak bisa lolos tanpa masuk ke UI.
 */
export interface PermissionGroup {
  label: string;
  permissions: Permission[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    label: "Kasir & meja",
    permissions: ["pos.sell", "pos.void", "table.manage"],
  },
  {
    label: "Produk & stok",
    permissions: [
      "product.manage",
      // Kategori = struktur katalog (menentukan kode SKU & tab POS), jadi izinnya
      // terpisah dari `product.manage` yang juga dipegang staf gudang.
      "category.manage",
      "stock.adjust",
      "inventory.view",
      "inventory.manage",
    ],
  },
  {
    label: "Pembelian",
    permissions: [
      "purchase.view",
      "purchase.request",
      "purchase.approve",
      "purchase.receive",
    ],
  },
  {
    label: "Uang, piutang & hutang",
    permissions: [
      "payable.view",
      "payable.manage",
      "ar.view",
      "ar.manage",
    ],
  },
  {
    label: "Laporan & langganan",
    permissions: ["report.view", "billing.manage", "device.manage"],
  },
  {
    label: "Tim & pelanggan",
    permissions: ["team.manage", "member.view", "member.manage"],
  },
  {
    label: "Integrasi & API",
    permissions: ["api.manage"],
  },
  {
    // Dukungan khusus (Phase 5): dilihat keuangan (banyak tiket soal tagihan),
    // dibuka & ditutup pemilik/manajer.
    label: "Dukungan",
    permissions: ["support.view", "support.manage"],
  },
  {
    // Pembayaran digital (Phase 6): kasir & keuangan menagih di meja (membuat
    // tagihan QRIS/VA dan menandai lunas); aturan transisi yang mencegah uang
    // yang sudah masuk dibatalkan. Staf gudang tidak memegangnya.
    label: "Pembayaran digital",
    permissions: ["payment.view", "payment.manage"],
  },
];

/** Semua izin seperti yang tampil di checklist, dalam urutan grup. */
export function groupedPermissions(): Permission[] {
  return PERMISSION_GROUPS.flatMap((group) => group.permissions);
}

/** Keanggotaan yang masih menunjuk sebuah peran kustom (untuk larangan hapus). */
export function roleAssignments(
  roleId: string,
  memberships: readonly {
    customRoleId?: string | null;
    active?: boolean;
  }[],
): number {
  return memberships.filter((row) => (row.customRoleId ?? null) === roleId).length;
}

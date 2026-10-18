/**
 * Pengaturan **peran bawaan** per workspace — aturan murni.
 *
 * Peran bawaan (Pemilik, Manajer, Kasir, Staf Gudang, Keuangan) selama ini
 * adalah kontrak produk yang tidak bisa disentuh tenant. Modul ini menambahkan
 * satu lapis **penyesuaian** di atasnya, tanpa membongkar kontraknya:
 *
 *   - **izinya bisa disesuaikan** (`permissions`) — mis. kasir di toko ini tidak
 *     boleh membatalkan transaksi;
 *   - **perannya bisa dinonaktifkan** (`active: false`) — tidak bisa ditugaskan
 *     lagi ke anggota yang belum memakainya;
 *   - **perannya bisa dihapus** (`removed: true`) — hilang dari daftar penugasan,
 *     dan hanya boleh setelah tidak ada anggota yang memakainya.
 *
 * Empat hal yang sengaja dipertahankan, karena tanpa itu penyesuaian ini jadi
 * jebakan:
 *
 * 1. **Nama peran bawaan tidak diubah.** `ROLE_LABELS` dipakai di struk, sidebar,
 *    pesan penolakan, dan jejak audit; nama yang berubah per workspace membuat
 *    satu laporan tidak lagi berarti sama di dua toko. Yang bisa diatur adalah
 *    izinnya.
 * 2. **Pemilik selalu memegang seluruh izin.** Izin pemilik tidak bisa diubah,
 *    dan perannya tidak bisa dinonaktifkan atau dihapus — kalau bisa, satu klik
 *    mengunci tenant dari langganannya sendiri.
 * 3. **Baris kosong = bawaan.** Tidak ada penyesuaian berarti izin bawaannya
 *    berlaku persis (`permissionsFor`), jadi workspace yang belum pernah membuka
 *    halaman ini berjalan seperti sebelumnya.
 * 4. **Tidak ada eskalasi.** Penyunting peran tidak bisa memberi izin yang dia
 *    sendiri tidak punya — pagar yang sama dengan peran kustom (`lib/rbac.ts`).
 *
 * Baris `roleSettings` yang **rusak** (izin kosong/tak dikenal) juga jatuh kembali
 * ke izin bawaan, jadi data yang salah bentuk tidak pernah mengunci orang.
 *
 * Modul ini dipakai backend (`roles.*`), kedua store, halaman Tim & Peran, sesi
 * klien, dan harness — persis seperti `lib/rbac.ts`.
 */

import {
  isRole,
  PERMISSION_LABELS,
  permissionsFor,
  ROLE_LABELS,
  ROLES,
  type Permission,
  type Role,
} from "./authz";
import { isPermission, sanitizePermissions } from "./rbac";

/** Penyesuaian satu peran bawaan seperti yang disimpan di tabel. */
export interface RoleSettingInput {
  /** Izin pengganti; `undefined` = jangan diubah. Daftar kosong ditolak. */
  permissions?: readonly string[];
  /** `false` = tidak bisa ditugaskan lagi (bawaan: aktif). */
  active?: boolean;
  /** `true` = dihapus dari daftar penugasan (bawaan: tidak). */
  removed?: boolean;
}

/** Penyesuaian yang sudah tersaring — bentuk yang boleh disimpan. */
export interface RoleSettingValues {
  permissions?: Permission[];
  active?: boolean;
  removed?: boolean;
}

/** Baris penyesuaian apa adanya (boleh datang dari database/memori demo). */
export interface RoleSettingLike {
  role: string;
  permissions?: readonly string[] | null;
  active?: boolean | null;
  removed?: boolean | null;
}

export type RoleSettingValidation =
  | { ok: true; value: RoleSettingValues }
  | { ok: false; reason: string };

/** Tiga keadaan sebuah peran bawaan di satu workspace. */
export type RoleState = "aktif" | "nonaktif" | "dihapus";

export const ROLE_STATE_LABELS: Record<RoleState, string> = {
  aktif: "aktif",
  nonaktif: "nonaktif",
  dihapus: "dihapus",
};

/**
 * Kalimat yang dipakai di mana-mana saat pemilik mencoba menyentuh perannya
 * sendiri. Satu sumber kalimat supaya halaman, server, dan README tidak
 * menjanjikan hal yang berbeda.
 */
export const OWNER_ROLE_LOCK_REASON =
  "Peran Pemilik selalu memegang seluruh izin; izinnya tidak bisa diubah dan perannya tidak bisa dinonaktifkan atau dihapus.";

/**
 * Peran terkunci = Pemilik. Peran lain bebas diatur.
 */
export function isLockedRole(role: string): boolean {
  return role === "owner";
}

/** Keadaan satu peran bawaan dari baris penyesuaiannya (kosong = aktif). */
export function roleState(setting?: RoleSettingLike | null): RoleState {
  // Pemilik selalu aktif, walaupun ada baris yang (karena kesalahan) menonaktifkannya:
  // tenant tidak boleh kehilangan satu-satunya peran yang memegang seluruh izin.
  if (setting && isLockedRole(setting.role)) return "aktif";
  if (setting?.removed === true) return "dihapus";
  if (setting?.active === false) return "nonaktif";
  return "aktif";
}

export function roleStateLabel(setting?: RoleSettingLike | null): string {
  return ROLE_STATE_LABELS[roleState(setting)];
}

/** Apakah penyesuaiannya benar-benar menyimpan izin pengganti? */
export function rolePermissionsCustomized(
  setting?: RoleSettingLike | null,
): boolean {
  return sanitizePermissions(setting?.permissions).length > 0;
}

/** Apakah baris ini punya penyesuaian apa pun (izin/status)? */
export function roleIsCustomized(setting?: RoleSettingLike | null): boolean {
  if (!setting) return false;
  return (
    rolePermissionsCustomized(setting) ||
    setting.active === false ||
    setting.removed === true
  );
}

/**
 * Izin yang berlaku untuk sebuah peran bawaan: izin pengganti kalau ada,
 * sebaliknya izin bawaan. Izin pengganti yang kosong/rusak **diabaikan** —
 * peran tidak pernah jadi "tanpa izin" karena satu baris yang salah bentuk.
 */
export function rolePermissions(
  role: Role,
  setting?: RoleSettingLike | null,
): Permission[] {
  // Pagar kedua untuk pemilik: walau barisnya ada, izinnya tetap izin penuh.
  // Server menolak tulisannya (`validateRoleSetting`), tetapi data yang sudah
  // salah bentuk pun tidak boleh membuat tenant terkunci dari langganannya.
  if (isLockedRole(role)) return sanitizePermissions(permissionsFor(role));
  const override = sanitizePermissions(setting?.permissions);
  if (override.length > 0) return override;
  return sanitizePermissions(permissionsFor(role));
}

/** Apakah peran ini boleh ditugaskan (masih aktif dan belum dihapus)? */
export function roleAssignable(setting?: RoleSettingLike | null): boolean {
  return roleState(setting) === "aktif";
}

/**
 * Peran bawaan yang boleh ditugaskan kepada anggota, untuk satu daftar
 * penyesuaian. Peran yang masih dipakai anggota **tidak** ikut hilang dari
 * daftar ini — halaman menyaring ulang dengan `roleChoicesForMember` supaya
 * anggota lama tidak kehilangan perannya sendiri.
 */
export function assignableBuiltinRoles(
  settings: readonly RoleSettingLike[],
): Role[] {
  return ROLES.filter((role) =>
    roleAssignable(settings.find((row) => row.role === role)),
  );
}

/**
 * Peran yang boleh dipilih untuk seorang anggota: peran yang ditawarkan
 * pengundang **atau** peran yang sedang dipakainya (walaupun peran itu sudah
 * dinonaktifkan/dihapus — anggota lama harus tetap bisa dibiarkan seperti apa
 * adanya, bukan dipaksa berpindah oleh dropdown).
 */
export function roleChoicesForMember(
  offered: readonly Role[],
  current: Role | null | undefined,
): Role[] {
  if (!current) return [...offered];
  return offered.includes(current) ? [...offered] : [...offered, current];
}

/**
 * Validasi penyuntingan satu peran bawaan.
 *
 * `actingPermissions` adalah izin **efektif** penyunting, bukan hanya peran
 * bawaannya: seorang manajer yang perannya sendiri sudah dipersempit memang
 * tidak boleh memberi izin yang sudah tidak dia punya.
 */
export function validateRoleSetting(
  input: RoleSettingInput,
  options: { role: string; actingPermissions: readonly Permission[] },
): RoleSettingValidation {
  if (!isRole(options.role)) {
    return { ok: false, reason: "Peran tidak dikenal." };
  }
  const role = options.role;

  const changingPermissions = input.permissions !== undefined;
  const deactivating = input.active === false;
  const removing = input.removed === true;
  if (isLockedRole(role) && (changingPermissions || deactivating || removing)) {
    return { ok: false, reason: OWNER_ROLE_LOCK_REASON };
  }

  const value: RoleSettingValues = {};
  if (input.removed !== undefined) value.removed = removing;
  if (input.active !== undefined) value.active = input.active;

  if (changingPermissions) {
    const requested = [...(input.permissions ?? [])];
    const unknown = [
      ...new Set(requested.filter((permission) => !isPermission(permission))),
    ];
    if (unknown.length > 0) {
      return { ok: false, reason: `Izin tidak dikenal: ${unknown.join(", ")}.` };
    }

    const permissions = sanitizePermissions(requested);
    if (permissions.length === 0) {
      return {
        ok: false,
        reason:
          "Pilih minimal satu izin — peran tanpa izin hanya membuka menu kosong.",
      };
    }

    const lacking = permissions.filter(
      (permission) => !options.actingPermissions.includes(permission),
    );
    if (lacking.length > 0) {
      return {
        ok: false,
        reason: `Anda tidak bisa memberi izin yang Anda sendiri tidak punya: ${lacking
          .map((permission) => PERMISSION_LABELS[permission])
          .join(", ")}.`,
      };
    }

    value.permissions = permissions;
  }

  return { ok: true, value };
}

/** Selisih penyesuaian — dipakai notis halaman dan jejak audit. */
export function roleSettingDiff(
  before: RoleSettingLike | null | undefined,
  after: RoleSettingLike | null | undefined,
): { permissionsAdded: Permission[]; permissionsRemoved: Permission[] } {
  const role = (after?.role ?? before?.role ?? "owner") as Role;
  const from = rolePermissions(role, before);
  const to = rolePermissions(role, after);
  const beforeSet = new Set(from);
  const afterSet = new Set(to);
  return {
    permissionsAdded: to.filter((permission) => !beforeSet.has(permission)),
    permissionsRemoved: from.filter((permission) => !afterSet.has(permission)),
  };
}

/**
 * Tombol mana yang boleh ditekan untuk satu peran — satu keputusan untuk tombol,
 * kalimat alasannya, dan pagar di handler, supaya tidak ada tombol mati tanpa
 * sebab yang terbaca.
 */
export interface RoleActions {
  /** Menyunting izin (butuh izin `team.manage` + fitur `rbac.custom`). */
  edit: boolean;
  toggle: boolean;
  remove: boolean;
  restore: boolean;
  /** Mengembalikan izin bawaan (membatalkan penyesuaian izin). */
  reset: boolean;
  /** Kenapa tombol Hapus mati — `null` saat tombolnya hidup. */
  removeReason: string | null;
  /**
   * Kenapa tombol “Ubah izin”/“Kembalikan izin bawaan” mati — `null` saat
   * tombolnya hidup. Alasannya datang dari `featureUnavailableReason` supaya
   * kalimatnya sama dengan yang dijawab server.
   */
  editReason: string | null;
}

export function roleActions(input: {
  role: string;
  active: boolean;
  removed: boolean;
  customized: boolean;
  memberCount: number;
  canManage: boolean;
  /**
   * Ketersediaan fitur `rbac.custom` untuk workspace ini — `null` berarti
   * tersedia.
   *
   * Menyunting izin peran bawaan **membuka akses baru**, jadi server menuntut
   * fitur itu (`roles.setBuiltin`/`roles.resetBuiltin` → `requireFeature`). Kalau
   * keputusan ini tidak sampai ke halaman, tombol “Ubah izin” hidup di paket
   * Starter dan pengguna baru tahu setelah server menolak:
   * “Fitur Custom role (RBAC) tidak termasuk paket Starter.” Tombol yang mati
   * beserta alasannya lebih baik daripada request yang pasti ditolak.
   */
  editGateReason: string | null;
}): RoleActions {
  const locked = isLockedRole(input.role) || !input.canManage;
  if (locked) {
    const reason = isLockedRole(input.role)
      ? "Pemilik tenant selalu memegang seluruh izin."
      : "Butuh izin team.manage.";
    return {
      edit: false,
      toggle: false,
      remove: false,
      restore: false,
      reset: false,
      removeReason: reason,
      editReason: reason,
    };
  }
  const removeReason = input.removed
    ? "Peran ini sudah dihapus."
    : input.memberCount > 0
      ? `Masih dipakai ${input.memberCount} anggota; pindahkan mereka ke peran lain dulu.`
      : null;
  const canEditPermissions = input.editGateReason === null;
  return {
    edit: canEditPermissions,
    toggle: !input.removed,
    remove: removeReason === null,
    restore: input.removed,
    // “Kembalikan izin bawaan” juga bisa **menambah** izin orang lain (izin
    // bawaan diperiksa pagar eskalasi yang sama), jadi ia tunduk pada gerbang
    // fitur yang sama — tombolnya disembunyikan, bukan dipasang lalu ditolak.
    reset: canEditPermissions && input.customized,
    removeReason,
    editReason: input.editGateReason,
  };
}

/**
 * Kenapa sebuah peran bawaan tidak bisa dipakai untuk pengaturan anggota baru.
 * Dipakai undangan (`validateTeamInvite`) dan perubahan anggota
 * (`validateTeamMemberEdit`) supaya halaman menolaknya **lebih dulu** dengan
 * kalimat yang sama seperti server.
 */
export function roleUnavailableReason(role: Role, state: RoleState): string {
  if (state === "dihapus") {
    return `Peran ${builtinRoleLabel(role)} sudah dihapus di workspace ini; pilih peran lain atau pulihkan dulu.`;
  }
  if (state === "nonaktif") {
    return `Peran ${builtinRoleLabel(role)} sedang nonaktif; aktifkan dulu sebelum ditugaskan.`;
  }
  return `Peran ${builtinRoleLabel(role)} tidak ditawarkan di sini.`;
}

/**
 * Apakah peran ini masih boleh dipakai untuk menugaskan anggota (status saja)?
 *
 * Peran yang sedang dipakai anggota selalu lolos (`currentRole`), supaya anggota
 * lama tidak dipaksa berpindah peran oleh dropdown yang menyempit.
 */
export function roleStateCheck(
  role: Role,
  settings?: readonly RoleSettingLike[],
  currentRole?: Role | null,
): { ok: true } | { ok: false; reason: string } {
  if (currentRole === role) return { ok: true };
  const setting = (settings ?? []).find((row) => row.role === role);
  const state = roleState(setting);
  if (state !== "aktif") return { ok: false, reason: roleUnavailableReason(role, state) };
  return { ok: true };
}

/**
 * Satu keputusan untuk “boleh tidak peran ini ditugaskan ke anggota ini?”.
 *
 * Dua pengecualian yang disengaja:
 *
 *  - **pemilik** hanya boleh ditetapkan pemilik (aturan lama, tidak berubah);
 *  - **peran yang sedang dipakai anggota** selalu boleh dipertahankan, walaupun
 *    peran itu sudah dinonaktifkan/dihapus — anggota lama tidak boleh dipaksa
 *    berpindah peran oleh dropdown yang menyempit.
 */
export function roleAssignmentCheck(
  role: Role,
  options: {
    /**
     * Peran **bawaan** penugasi; `null` = penugasinya sendiri memakai peran
     * tambahan (berdiri sendiri), jadi ia bukan pemilik dan tidak boleh
     * menetapkan pemilik.
     */
    actingRole: Role | null;
    /** Penyesuaian peran bawaan workspace ini; kosong = semua bawaan. */
    settings?: readonly RoleSettingLike[];
    /** Peran yang sedang dipakai anggota ini (kalau ada). */
    currentRole?: Role | null;
  },
): { ok: true } | { ok: false; reason: string } {
  if (role === "owner" && options.actingRole !== "owner") {
    return { ok: false, reason: "Hanya pemilik dapat menetapkan peran pemilik." };
  }
  return roleStateCheck(role, options.settings, options.currentRole);
}

/** Kalimat ringkas satu peran bawaan untuk daftar. */
export function describeBuiltinRole(input: {
  label: string;
  permissions: readonly Permission[];
  customized: boolean;
}): string {
  const izin = sanitizePermissions(input.permissions).length;
  return `${input.label} · ${izin} izin${input.customized ? " (disesuaikan)" : " (bawaan)"}`;
}

/** Ringkasan halaman: berapa peran bawaan yang sudah disesuaikan/disembunyikan. */
export function summarizeRoleSettings(
  settings: readonly RoleSettingLike[],
): {
  customized: number;
  disabled: number;
  removed: number;
  assignable: number;
} {
  const known = settings.filter((row) => isRole(row.role));
  return {
    customized: known.filter((row) => rolePermissionsCustomized(row)).length,
    disabled: known.filter((row) => roleState(row) === "nonaktif").length,
    removed: known.filter((row) => roleState(row) === "dihapus").length,
    assignable: assignableBuiltinRoles(known).length,
  };
}

/** Nama label peran — satu tempat, supaya tidak ada peran tanpa nama. */
export function builtinRoleLabel(role: Role): string {
  return ROLE_LABELS[role];
}

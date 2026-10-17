import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  requireFeature,
  requireMembership,
  requirePermission,
  resolveMembershipPermissions,
  roleSettingFor,
  writeAuditLog,
} from "./lib/access";
import {
  assignmentError,
  lackingFromPermissions,
  MAX_CUSTOM_ROLES,
  normalizeRoleName,
  roleAssignments,
  sanitizePermissions,
  validateCustomRole,
} from "./lib/rbac";
import {
  isLockedRole,
  OWNER_ROLE_LOCK_REASON,
  rolePermissions,
  rolePermissionsCustomized,
  roleSettingDiff,
  roleState,
  summarizeRoleSettings,
  validateRoleSetting,
  type RoleSettingLike,
} from "./lib/roleSettings";
import {
  permissionsFor,
  ROLE_LABELS,
  ROLES,
  type Permission,
  type Role,
} from "./lib/authz";
import { permissionValidator, roleValidator } from "./schema";

/**
 * Peran (`rbac.custom`, Phase 4 / Enterprise Intelligence) — **peran kustom** dan
 * **pengaturan peran bawaan**.
 *
 * Satu tempat yang mengubah tabel `customRoles`, tabel `roleSettings` (izin/status
 * peran bawaan per workspace), dan penugasan `memberships.customRoleId`.
 * Aturannya sendiri ada di lib/rbac.ts & lib/roleSettings.ts (dipakai klien &
 * harness), jadi yang di sini hanya tiga hal yang butuh database: membaca baris
 * tenant, menjaga gerbang fitur/izin, dan menulis audit.
 *
 * Gerbang fiturnya sengaja tidak seragam — sama pola dengan opname dan
 * multi-warehouse: **membuat/mengubah peran** (kustom maupun izin peran bawaan)
 * dan **menugaskan** peran butuh fitur `rbac.custom` (tindakan yang membuka akses
 * baru), sedangkan **melepas penugasan**, **melihat**, dan **menonaktifkan atau
 * menghapus peran yang tidak dipakai** selalu boleh. Kalau paket turun, tenant
 * tidak boleh terkunci dari timnya sendiri — termasuk dari kemampuannya mencabut
 * izin.
 *
 * Nama peran bawaan **tidak** bisa diubah di sini: `ROLE_LABELS` dipakai struk,
 * sidebar, pesan penolakan, dan jejak audit. Yang bisa diatur tenant adalah
 * izinnya, status pemakaiannya, dan apakah perannya dihapus dari daftar penugasan.
 */

interface RoleRow {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  active: boolean;
  memberCount: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Satu **peran bawaan** beserta penyesuaian workspace-nya.
 *
 * `permissions` adalah izin yang benar-benar berlaku (sudah termasuk penyesuaian),
 * `basePermissions` izin bawaannya — halaman memakai keduanya untuk menandai
 * “disesuaikan” dan untuk tombol “Kembalikan izin bawaan”.
 */
interface BuiltinRoleRow {
  role: Role;
  label: string;
  permissions: Permission[];
  basePermissions: Permission[];
  active: boolean;
  removed: boolean;
  customized: boolean;
  memberCount: number;
}

function toRow(role: Doc<"customRoles">, memberCount: number): RoleRow {
  return {
    id: role._id as string,
    name: role.name,
    description: role.description,
    permissions: role.permissions as string[],
    active: role.active,
    memberCount,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

function toBuiltinRow(
  role: Role,
  setting: Doc<"roleSettings"> | undefined,
  memberCount: number,
): BuiltinRoleRow {
  const state = roleState(setting);
  return {
    role,
    label: ROLE_LABELS[role],
    permissions: rolePermissions(role, setting),
    basePermissions: sanitizePermissions(permissionsFor(role)),
    active: state === "aktif",
    removed: state === "dihapus",
    customized: rolePermissionsCustomized(setting),
    memberCount,
  };
}

/**
 * Daftar **seluruh peran** workspace: peran bawaan (beserta penyesuaiannya) dan
 * peran kustom, dengan jumlah anggota yang memakainya. Izin `team.manage` — sama
 * dengan halaman Tim & Peran.
 */
export const list = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "team.manage");

    const [roles, memberships, settings] = await Promise.all([
      ctx.db
        .query("customRoles")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
      ctx.db
        .query("memberships")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
      ctx.db
        .query("roleSettings")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
    ]);

    const rows = roles
      .map((role) =>
        toRow(
          role,
          roleAssignments(role._id as string, memberships),
        ),
      )
      .sort((a, b) => a.name.localeCompare(b.name, "id"));

    const builtin = ROLES.map((role) =>
      toBuiltinRow(
        role,
        settings.find((row) => row.role === role),
        memberships.filter((membership) => membership.role === role).length,
      ),
    );

    const settingRows: RoleSettingLike[] = settings.map((row) => ({
      role: row.role,
      permissions: row.permissions,
      active: row.active,
      removed: row.removed,
    }));
    const builtinSummary = summarizeRoleSettings(settingRows);

    return {
      roles: rows,
      builtin,
      summary: {
        total: rows.length,
        active: rows.filter((row) => row.active).length,
        assignedMembers: rows.reduce((sum, row) => sum + row.memberCount, 0),
        limit: MAX_CUSTOM_ROLES,
        /** Paket yang tidak memuat `rbac.custom` tetap boleh membersihkan data. */
        canCreate: roles.length < MAX_CUSTOM_ROLES,
        /** Ringkasan peran bawaan: berapa yang disesuaikan/dinonaktifkan/dihapus. */
        builtin: { ...builtinSummary, total: ROLES.length },
      },
    };
  },
});

/**
 * Izin efektif pengguna yang sedang aktif — dipakai klien supaya menu & rute
 * mengikuti peran kustom yang ditugaskan server, bukan tebakan dari `role`.
 */
export const myAccess = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx, args.tenantId, args.actorId);
    const { permissions, customRole, rolePermissions: base } =
      await resolveMembershipPermissions(ctx, membership);

    return {
      /**
       * Peran **bawaan** anggota ini; `null` berarti ia memakai peran tambahan
       * yang berdiri sendiri (tidak ada peran dasar yang ditulis).
       */
      role: membership.role ?? null,
      permissions: permissions as string[],
      /**
       * Izin **peran bawaan** anggota ini setelah penyesuaian workspace. Menu & rute
       * klien memakai ini juga, supaya peran bawaan yang izinnya diatur tidak
       * menampilkan halaman yang akan ditolak server.
       */
      rolePermissions: base as string[],
      customRole: customRole
        ? {
            id: customRole._id as string,
            name: customRole.name,
            permissions: customRole.permissions as string[],
          }
        : null,
    };
  },
});

export const create = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    permissions: v.array(permissionValidator),
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, args.tenantId, args.actorId, "rbac.custom", "team.manage");
    const membership = await requireMembership(ctx, args.tenantId, args.actorId);

    const existing = await ctx.db
      .query("customRoles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const { permissions: actorPermissions } = await resolveMembershipPermissions(
      ctx,
      membership,
    );

    const validation = validateCustomRole(
      { name: args.name, description: args.description, permissions: args.permissions },
      {
        actingRole: membership.role ?? null,
        actingPermissions: actorPermissions,
        existingNames: existing.map((row) => row.name),
        count: existing.length,
      },
    );
    if (!validation.ok) throw new Error(validation.reason);
    const draft = validation.value;

    const now = Date.now();
    const roleId = await ctx.db.insert("customRoles", {
      tenantId: args.tenantId,
      name: draft.name,
      description: draft.description,
      permissions: draft.permissions,
      active: true,
      createdById: args.actorId,
      createdAt: now,
      updatedAt: now,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "role.create",
      entity: "customRoles",
      entityId: roleId,
      meta: { name: draft.name, permissions: draft.permissions },
    });

    return { roleId, name: draft.name, permissions: draft.permissions };
  },
});

export const update = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    roleId: v.id("customRoles"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    permissions: v.optional(v.array(permissionValidator)),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireFeature(ctx, args.tenantId, args.actorId, "rbac.custom", "team.manage");
    const membership = await requireMembership(ctx, args.tenantId, args.actorId);

    const role = await ctx.db.get(args.roleId);
    if (!role || role.tenantId !== args.tenantId) {
      throw new Error("Peran kustom tidak ditemukan untuk tenant ini.");
    }

    // Menonaktifkan peran selalu boleh (tanpa validasi izin): itu justru cara
    // mencabut akses yang tidak diinginkan setelah paket berubah.
    if (args.active === false && args.name === undefined && args.permissions === undefined) {
      await ctx.db.patch(role._id, { active: false, updatedAt: Date.now() });
      await writeAuditLog(ctx, {
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: "role.deactivate",
        entity: "customRoles",
        entityId: role._id,
        meta: { name: role.name },
      });
      return { roleId: role._id, active: false };
    }

    const others = await ctx.db
      .query("customRoles")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const { permissions: actorPermissions } = await resolveMembershipPermissions(
      ctx,
      membership,
    );

    const validation = validateCustomRole(
      {
        name: args.name ?? role.name,
        description: args.description ?? role.description,
        permissions: args.permissions ?? (role.permissions as string[]),
      },
      {
        actingRole: membership.role ?? null,
        actingPermissions: actorPermissions,
        existingNames: others
          .filter((row) => row._id !== role._id)
          .map((row) => row.name),
      },
    );
    if (!validation.ok) throw new Error(validation.reason);
    const draft = validation.value;

    const active = args.active ?? role.active;
    await ctx.db.patch(role._id, {
      name: draft.name,
      description: draft.description,
      permissions: draft.permissions,
      active,
      updatedAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "role.update",
      entity: "customRoles",
      entityId: role._id,
      meta: {
        name: draft.name,
        permissions: draft.permissions,
        active,
        before: {
          name: role.name,
          permissions: role.permissions,
        },
      },
    });

    return { roleId: role._id, name: draft.name, active };
  },
});

export const remove = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    roleId: v.id("customRoles"),
  },
  handler: async (ctx, args) => {
    // Tanpa gerbang fitur: membersihkan peran lama harus selalu mungkin.
    await requirePermission(ctx, args.tenantId, args.actorId, "team.manage");

    const role = await ctx.db.get(args.roleId);
    if (!role || role.tenantId !== args.tenantId) {
      throw new Error("Peran kustom tidak ditemukan untuk tenant ini.");
    }

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const used = roleAssignments(role._id as string, memberships);
    if (used > 0) {
      throw new Error(
        `Peran "${role.name}" masih dipakai ${used} anggota; pindahkan mereka ke peran lain dulu.`,
      );
    }

    await ctx.db.delete(role._id);
    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "role.delete",
      entity: "customRoles",
      entityId: role._id,
      meta: { name: role.name, permissions: role.permissions },
    });

    return { roleId: role._id };
  },
});

/**
 * Menugaskan (atau melepas, dengan `customRoleId: null`) sebuah peran kustom
 * kepada satu keanggotaan.
 *
 * Dua pagar yang bukan formalitas:
 *  - **pemilik tenant** tidak bisa dipindah ke peran kustom — pemilik harus
 *    selalu memegang `billing.manage`;
 *  - **eskalasi** dicegah lagi di sini: manajer tidak boleh menugaskan peran
 *    yang berisi izin yang dia sendiri tidak punya, walaupun peran itu dibuat
 *    oleh pemilik.
 */
export const assign = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    membershipId: v.id("memberships"),
    customRoleId: v.union(v.null(), v.id("customRoles")),
  },
  handler: async (ctx, args) => {
    const actor = await requirePermission(
      ctx,
      args.tenantId,
      args.actorId,
      "team.manage",
    );

    const target = await ctx.db.get(args.membershipId);
    if (!target || target.tenantId !== args.tenantId) {
      throw new Error("Anggota tidak ditemukan untuk tenant ini.");
    }

    const blocked = assignmentError(target.role);
    if (blocked) throw new Error(blocked);

    if (args.customRoleId === null) {
      await ctx.db.patch(target._id, { customRoleId: undefined });
      await writeAuditLog(ctx, {
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: "role.unassign",
        entity: "memberships",
        entityId: target._id,
        meta: { role: target.role },
      });
      return { membershipId: target._id, customRoleId: null };
    }

    // Menugaskan peran itu membuka akses baru → butuh fiturnya.
    await requireFeature(ctx, args.tenantId, args.actorId, "rbac.custom");

    const role = await ctx.db.get(args.customRoleId);
    if (!role || role.tenantId !== args.tenantId) {
      throw new Error("Peran kustom tidak ditemukan untuk tenant ini.");
    }
    if (!role.active) {
      throw new Error(
        `Peran "${role.name}" sedang nonaktif; aktifkan dulu sebelum ditugaskan.`,
      );
    }

    // Pagar eskalasi memakai izin **efektif** penugasnya — sudah termasuk
    // penyesuaian peran bawaan workspace — bukan izin peran bawaannya saja.
    const { permissions: actorPermissions } = await resolveMembershipPermissions(
      ctx,
      actor,
    );
    const lacking = lackingFromPermissions(
      actorPermissions,
      role.permissions as Permission[],
    );
    if (lacking.length > 0) {
      throw new Error(
        `Anda tidak bisa menugaskan peran yang punya izin di luar wewenang Anda (${lacking.join(", ")}).`,
      );
    }

    /*
      Peran tambahan **menggantikan** peran yang sedang dipakai, bukan menumpang
      di atasnya: peran bawaan yang tersimpan dilepas (`role: undefined`) supaya
      anggota itu benar-benar hanya memakai peran ini. Tanpa ini, peran baru
      tampak “berdiri di atas” Kasir — termasuk untuk pagar izin, audit, dan
      tampilan daftar anggota.
    */
    await ctx.db.patch(target._id, {
      customRoleId: role._id,
      role: undefined,
    });
    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "role.assign",
      entity: "memberships",
      entityId: target._id,
      meta: {
        role: target.role ?? null,
        customRole: role.name,
        permissions: role.permissions,
      },
    });

    return { membershipId: target._id, customRoleId: role._id as string };
  },
});

/* ----------------------------- Peran bawaan ------------------------------- */

/** Bentuk balikan mutation peran bawaan (dipakai notis halaman & harness). */
interface BuiltinRoleResult {
  role: Role;
  permissions: string[];
  active: boolean;
  removed: boolean;
  customized: boolean;
}

function toBuiltinResult(
  role: Role,
  setting: RoleSettingLike | null,
): BuiltinRoleResult {
  const state = roleState(setting);
  return {
    role,
    permissions: rolePermissions(role, setting) as string[],
    active: state === "aktif",
    removed: state === "dihapus",
    customized: rolePermissionsCustomized(setting),
  };
}

function toSettingLike(
  setting: Doc<"roleSettings"> | null,
): RoleSettingLike | null {
  if (!setting) return null;
  return {
    role: setting.role,
    permissions: setting.permissions,
    active: setting.active,
    removed: setting.removed,
  };
}

/**
 * Menulis (atau membersihkan) baris penyesuaian satu peran bawaan.
 *
 * Baris yang tidak menyimpan apa-apa **dihapus**, bukan dibiarkan kosong: “tanpa
 * baris” berarti bawaan, dan itu satu-satunya keadaan yang membuat workspace baru
 * berjalan persis seperti sebelum fitur ini ada.
 */
async function applyRoleSetting(
  ctx: MutationCtx,
  args: {
    tenantId: Id<"tenants">;
    actorId: Id<"users">;
    role: Role;
    before: Doc<"roleSettings"> | null;
    permissions: Permission[] | undefined;
    active: boolean | undefined;
    removed: boolean | undefined;
  },
): Promise<void> {
  const kosong =
    args.permissions === undefined &&
    args.active === undefined &&
    args.removed === undefined;
  const now = Date.now();

  if (args.before) {
    if (kosong) {
      await ctx.db.delete(args.before._id);
      return;
    }
    await ctx.db.patch(args.before._id, {
      permissions: args.permissions,
      active: args.active,
      removed: args.removed,
      updatedById: args.actorId,
      updatedAt: now,
    });
    return;
  }

  if (kosong) return;
  await ctx.db.insert("roleSettings", {
    tenantId: args.tenantId,
    role: args.role,
    permissions: args.permissions,
    active: args.active,
    removed: args.removed,
    updatedById: args.actorId,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Mengubah **izin** dan/atau **status** satu peran bawaan.
 *
 * Dua gerbang yang berbeda, dan bedanya disengaja (sama pola dengan peran kustom):
 *
 *  - menyunting **izin** membuka akses baru → butuh izin `team.manage` **dan** fitur
 *    `rbac.custom`, plus pagar eskalasi (`validateRoleSetting`) supaya penyunting
 *    tidak bisa memberi izin yang dia sendiri tidak punya;
 *  - **menonaktifkan/mengaktifkan** selalu boleh — itu justru cara mencabut akses
 *    setelah paket berubah, dan tenant tidak boleh terkunci dari timnya sendiri.
 *
 * Peran Pemilik ditolak oleh aturan murni (`OWNER_ROLE_LOCK_REASON`).
 */
export const setBuiltin = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    role: roleValidator,
    permissions: v.optional(v.array(permissionValidator)),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const membership = await requirePermission(
      ctx,
      args.tenantId,
      args.actorId,
      "team.manage",
    );
    const before = await roleSettingFor(ctx, args.tenantId, args.role);
    const editingPermissions = args.permissions !== undefined;

    if (editingPermissions) {
      await requireFeature(ctx, args.tenantId, args.actorId, "rbac.custom");
    }

    const { permissions: actingPermissions } =
      await resolveMembershipPermissions(ctx, membership);
    const validation = validateRoleSetting(
      { permissions: args.permissions, active: args.active },
      { role: args.role, actingPermissions },
    );
    if (!validation.ok) throw new Error(validation.reason);
    const draft = validation.value;

    const existingPermissions = before?.permissions as Permission[] | undefined;
    const nextPermissions = draft.permissions ?? existingPermissions;
    const nextActive = draft.active ?? before?.active;
    const nextRemoved = before?.removed;
    const after: RoleSettingLike = {
      role: args.role,
      permissions: nextPermissions,
      active: nextActive,
      removed: nextRemoved,
    };

    await applyRoleSetting(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      role: args.role,
      before,
      permissions: nextPermissions,
      active: nextActive,
      removed: nextRemoved,
    });

    const diff = roleSettingDiff(toSettingLike(before), after);
    const state = roleState(after);
    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: editingPermissions
        ? "role.builtin.permissions"
        : state === "aktif"
          ? "role.builtin.activate"
          : "role.builtin.deactivate",
      entity: "roleSettings",
      entityId: args.role,
      meta: {
        label: ROLE_LABELS[args.role],
        permissions: after.permissions,
        active: state !== "nonaktif",
        added: diff.permissionsAdded,
        removed: diff.permissionsRemoved,
      },
    });

    return toBuiltinResult(args.role, after);
  },
});

/**
 * Menghapus satu peran bawaan dari daftar penugasan workspace ini.
 *
 * Tanpa gerbang fitur (membersihkan peran harus selalu mungkin), tetapi **tidak
 * boleh** selama masih ada anggota yang memakainya — sama seperti peran kustom:
 * menghapusnya diam-diam berarti anggota itu kehilangan peran tanpa jejak.
 * Peran Pemilik ditolak: tenant tidak pernah boleh kehilangan pemiliknya.
 */
export const removeBuiltin = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "team.manage");
    if (isLockedRole(args.role)) throw new Error(OWNER_ROLE_LOCK_REASON);

    const before = await roleSettingFor(ctx, args.tenantId, args.role);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    const used = memberships.filter((row) => row.role === args.role).length;
    if (used > 0) {
      throw new Error(
        `Peran "${ROLE_LABELS[args.role]}" masih dipakai ${used} anggota; pindahkan mereka ke peran lain dulu.`,
      );
    }

    const after: RoleSettingLike = {
      role: args.role,
      permissions: before?.permissions,
      active: before?.active,
      removed: true,
    };
    await applyRoleSetting(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      role: args.role,
      before,
      permissions: before?.permissions as Permission[] | undefined,
      active: before?.active,
      removed: true,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "role.builtin.remove",
      entity: "roleSettings",
      entityId: args.role,
      meta: {
        label: ROLE_LABELS[args.role],
        permissions: after.permissions,
      },
    });

    return toBuiltinResult(args.role, after);
  },
});

/**
 * Memulihkan peran bawaan yang **dihapus** ke daftar penugasan (izin & statusnya
 * tetap seperti yang tersimpan). Kebalikan `removeBuiltin`, jadi selalu boleh.
 */
export const restoreBuiltin = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "team.manage");
    if (isLockedRole(args.role)) throw new Error(OWNER_ROLE_LOCK_REASON);

    const before = await roleSettingFor(ctx, args.tenantId, args.role);
    const setelah: RoleSettingLike = {
      role: args.role,
      permissions: before?.permissions,
      active: before?.active,
      removed: undefined,
    };

    await applyRoleSetting(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      role: args.role,
      before,
      permissions: before?.permissions as Permission[] | undefined,
      active: before?.active,
      removed: undefined,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "role.builtin.restore",
      entity: "roleSettings",
      entityId: args.role,
      meta: { label: ROLE_LABELS[args.role] },
    });

    return toBuiltinResult(args.role, setelah);
  },
});

/**
 * Mengembalikan **izin bawaan** satu peran (membatalkan penyesuaian izinnya)
 * tanpa menyentuh status aktif/dihapusnya.
 *
 * Izin bawaan tetap diperiksa pagar eskalasi lebih dulu: “kembalikan ke bawaan”
 * juga bisa menambah izin orang lain, jadi yang tidak memegang izin itu tidak
 * boleh melakukannya — kalau bukan, jalur ini menjadi pintu belakang untuk
 * memberi izin yang sama. Karena itu ia butuh fitur `rbac.custom`, seperti
 * menyunting izin.
 */
export const resetBuiltin = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    const membership = await requirePermission(
      ctx,
      args.tenantId,
      args.actorId,
      "team.manage",
    );
    if (isLockedRole(args.role)) throw new Error(OWNER_ROLE_LOCK_REASON);
    await requireFeature(ctx, args.tenantId, args.actorId, "rbac.custom");

    const { permissions: actingPermissions } =
      await resolveMembershipPermissions(ctx, membership);
    const validation = validateRoleSetting(
      { permissions: permissionsFor(args.role) },
      { role: args.role, actingPermissions },
    );
    if (!validation.ok) throw new Error(validation.reason);

    const before = await roleSettingFor(ctx, args.tenantId, args.role);
    const sebelum: RoleSettingLike | null = toSettingLike(before);
    const setelah: RoleSettingLike = {
      role: args.role,
      permissions: undefined,
      active: before?.active,
      removed: before?.removed,
    };

    await applyRoleSetting(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      role: args.role,
      before,
      permissions: undefined,
      active: before?.active,
      removed: before?.removed,
    });

    const diff = roleSettingDiff(sebelum, setelah);
    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "role.builtin.reset",
      entity: "roleSettings",
      entityId: args.role,
      meta: {
        label: ROLE_LABELS[args.role],
        permissions: permissionsFor(args.role),
        added: diff.permissionsAdded,
        removed: diff.permissionsRemoved,
      },
    });

    return toBuiltinResult(args.role, setelah);
  },
});

/**
 * Izin efektif satu anggota — dipakai halaman Tim & Peran untuk menampilkan apa
 * yang benar-benar bisa dilakukan orang itu (peran bawaan atau peran kustom).
 */
export const effective = query({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    membershipId: v.id("memberships"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "team.manage");

    const target = await ctx.db.get(args.membershipId);
    if (!target || target.tenantId !== args.tenantId) {
      throw new Error("Anggota tidak ditemukan untuk tenant ini.");
    }

    const { permissions, customRole, rolePermissions: base } =
      await resolveMembershipPermissions(ctx, target);
    const sanitized = sanitizePermissions(permissions);

    return {
      membershipId: target._id as string,
      /** `null` = anggota itu memakai peran tambahan (berdiri sendiri). */
      role: target.role ?? null,
      customRoleName: customRole ? normalizeRoleName(customRole.name) : null,
      permissions: sanitized as string[],
      basePermissions: base as string[],
      customRoleId: (customRole?._id as Id<"customRoles"> | undefined) ?? null,
    };
  },
});

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  requireFeature,
  requireMembership,
  requirePermission,
  resolveMembershipPermissions,
  writeAuditLog,
} from "./lib/access";
import {
  assignmentError,
  effectivePermissions,
  lackingPermissions,
  MAX_CUSTOM_ROLES,
  normalizeRoleName,
  roleAssignments,
  sanitizePermissions,
  validateCustomRole,
} from "./lib/rbac";
import { permissionValidator } from "./schema";

/**
 * Peran kustom (`rbac.custom`, Phase 4 / Enterprise Intelligence).
 *
 * Satu tempat yang mengubah tabel `customRoles` dan penugasan
 * `memberships.customRoleId`. Aturannya sendiri ada di lib/rbac.ts (dipakai
 * klien & harness), jadi yang di sini hanya tiga hal yang butuh database:
 * membaca baris tenant, menjaga gerbang fitur/izin, dan menulis audit.
 *
 * Gerbang fiturnya sengaja tidak seragam — sama pola dengan opname dan
 * multi-warehouse: **membuat/mengubah peran** dan **menugaskan** peran butuh
 * fitur `rbac.custom` (tindakan yang membuka akses baru), sedangkan
 * **melepas penugasan**, **melihat**, dan **menghapus peran yang tidak dipakai**
 * selalu boleh. Kalau paket turun, tenant tidak boleh terkunci dari timnya
 * sendiri — termasuk dari kemampuannya mencabut izin.
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

/**
 * Daftar peran kustom beserta berapa anggota aktif yang memakainya.
 * Izin `team.manage` — sama dengan halaman Tim & Peran.
 */
export const list = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "team.manage");

    const [roles, memberships] = await Promise.all([
      ctx.db
        .query("customRoles")
        .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
        .collect(),
      ctx.db
        .query("memberships")
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

    return {
      roles: rows,
      summary: {
        total: rows.length,
        active: rows.filter((row) => row.active).length,
        assignedMembers: rows.reduce((sum, row) => sum + row.memberCount, 0),
        limit: MAX_CUSTOM_ROLES,
        /** Paket yang tidak memuat `rbac.custom` tetap boleh membersihkan data. */
        canCreate: roles.length < MAX_CUSTOM_ROLES,
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
    const { permissions, customRole } = await resolveMembershipPermissions(
      ctx,
      membership,
    );

    return {
      role: membership.role,
      permissions: permissions as string[],
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

    const validation = validateCustomRole(
      { name: args.name, description: args.description, permissions: args.permissions },
      {
        actingRole: membership.role,
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

    const validation = validateCustomRole(
      {
        name: args.name ?? role.name,
        description: args.description ?? role.description,
        permissions: args.permissions ?? (role.permissions as string[]),
      },
      {
        actingRole: membership.role,
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

    const lacking = lackingPermissions(actor.role, role.permissions);
    if (lacking.length > 0) {
      throw new Error(
        `Anda tidak bisa menugaskan peran yang punya izin di luar wewenang Anda (${lacking.join(", ")}).`,
      );
    }

    await ctx.db.patch(target._id, { customRoleId: role._id });
    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "role.assign",
      entity: "memberships",
      entityId: target._id,
      meta: {
        role: target.role,
        customRole: role.name,
        permissions: role.permissions,
      },
    });

    return { membershipId: target._id, customRoleId: role._id as string };
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

    const { permissions, customRole } = await resolveMembershipPermissions(
      ctx,
      target,
    );
    const base = effectivePermissions(target.role);
    const sanitized = sanitizePermissions(permissions);

    return {
      membershipId: target._id as string,
      role: target.role,
      customRoleName: customRole ? normalizeRoleName(customRole.name) : null,
      permissions: sanitized as string[],
      basePermissions: base as string[],
      customRoleId: (customRole?._id as Id<"customRoles"> | undefined) ?? null,
    };
  },
});

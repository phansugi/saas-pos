import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { Role } from "./lib/authz";
import {
  getTenantOrThrow,
  requirePermission,
  writeAuditLog,
} from "./lib/access";
import { membershipAssignmentError } from "./lib/platform";
import {
  normalizePhone,
  validateTeamInvite,
  validateTeamMemberEdit,
  validateTeamMemberRemoval,
  WA_INVITE_VIA_LINK,
} from "./lib/team";
import { roleValidator } from "./schema";

/**
 * Team / membership management.
 *
 * This is the only way a role other than "owner" ever enters a tenant, which is
 * what makes the permission table in ./lib/authz.ts meaningful: a cashier can
 * only exist because an owner or manager invited them.
 */

export const add = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    email: v.string(),
    name: v.optional(v.string()),
    /** Nomor WhatsApp opsional untuk undangan lewat `wa.me`. */
    phone: v.optional(v.string()),
    role: roleValidator,
    storeIds: v.optional(v.array(v.id("stores"))),
  },
  handler: async (ctx, args) => {
    // Inviting people is itself a privileged action.
    const actor = await requirePermission(
      ctx,
      args.tenantId,
      args.actorId,
      "team.manage",
    );

    // Email & pagar eskalasi memakai aturan murni yang sama dengan halaman
    // (`validateTeamInvite`): undangan hanya untuk email yang benar-benar bisa
    // menerima kode masuk, dan hanya pemilik yang boleh mencetak pemilik kedua.
    const invitation = validateTeamInvite(
      { email: args.email, name: args.name, role: args.role },
      { actingRole: actor.role },
    );
    if (!invitation.ok) throw new Error(invitation.reason);
    const { email, name } = invitation.value;

    // Nomor WhatsApp opsional; kalau diisi harus benar-benar bisa dipakai
    // membuka percakapan (`wa.me`), bukan sekadar disimpan apa adanya.
    let phone: string | undefined;
    if (args.phone !== undefined && args.phone.trim() !== "") {
      const nomor = normalizePhone(args.phone);
      if (!nomor.valid || !nomor.value) {
        throw new Error(nomor.reason ?? "Nomor WhatsApp tidak valid.");
      }
      phone = nomor.value;
    }

    if (args.storeIds) {
      for (const storeId of args.storeIds) {
        const store = await ctx.db.get(storeId);
        if (!store || store.tenantId !== args.tenantId) {
          throw new Error("Toko tidak valid untuk tenant ini.");
        }
      }
    }

    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();

    // Akun platform tidak boleh masuk **tenant orang lain**: undangan adalah
    // satu-satunya jalur yang bisa membuatnya terlihat di tim yang bukan
    // miliknya. Workspace miliknya sendiri tidak lewat sini — ia lahir dari
    // `tenants.create`. Pagarnya di server, bukan di disiplin operator.
    const blocked = membershipAssignmentError(existingUser?.platformRole);
    if (blocked) throw new Error(blocked);

    const userId =
      existingUser?._id ??
      (await ctx.db.insert("users", {
        name,
        email,
        createdAt: Date.now(),
      }));

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_tenant_user", (q) =>
        q.eq("tenantId", args.tenantId).eq("userId", userId),
      )
      .unique();

    if (membership) {
      // Re-adding someone is a role change / reactivation, not a duplicate row.
      await ctx.db.patch(membership._id, {
        role: args.role,
        active: true,
        storeIds: args.storeIds ?? membership.storeIds,
        // Nomor yang dikirim menimpa; yang kosong membiarkan nomor lama.
        phone: phone ?? membership.phone,
      });
      await writeAuditLog(ctx, {
        tenantId: args.tenantId,
        actorId: args.actorId,
        action: "member.update",
        entity: "memberships",
        entityId: membership._id,
        meta: { email, role: args.role },
      });
      return { userId, membershipId: membership._id, created: false };
    }

    const stores =
      args.storeIds ??
      (
        await ctx.db
          .query("stores")
          .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
          .collect()
      ).map((s) => s._id);

    const membershipId = await ctx.db.insert("memberships", {
      tenantId: args.tenantId,
      userId,
      role: args.role,
      storeIds: stores,
      active: true,
      createdAt: Date.now(),
      phone,
    });

    // Undangan lewat email dijadwalkan untuk anggota **baru**: mutation tidak
    // boleh menunggu jaringan, dan kegagalan penyedia email tidak boleh
    // membatalkan keanggotaan yang sudah tercatat. Hasilnya ditulis kembali ke
    // baris keanggotaan (terkirim / gagal), jadi pengundang melihat yang sebenarnya.
    await scheduleInviteEmail(ctx, {
      membershipId,
      tenantId: args.tenantId,
      email,
      name,
      role: args.role,
      invitedByName: await actorName(ctx, args.actorId),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "member.add",
      entity: "memberships",
      entityId: membershipId,
      meta: { email, role: args.role },
    });

    return { userId, membershipId, created: true };
  },
});

/**
 * Kirim ulang undangan ke anggota yang sudah ada.
 *
 * Dipakai saat undangan pertama gagal (mis. saluran email baru diset) atau saat
 * orangnya kehilangan emailnya. Sama seperti undangan pertama: hasil kirimnya
 * ditulis balik ke baris keanggotaan, bukan diklaim di sini.
 */
export const resendInvite = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    membershipId: v.id("memberships"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "team.manage");

    const { membership, user } = await loadMember(
      ctx,
      args.tenantId,
      args.membershipId,
    );

    await scheduleInviteEmail(ctx, {
      membershipId: membership._id,
      tenantId: args.tenantId,
      email: user.email,
      name: user.name,
      role: membership.role,
      invitedByName: await actorName(ctx, args.actorId),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "member.invite",
      entity: "memberships",
      entityId: membership._id,
      meta: { email: user.email, role: membership.role, resend: true },
    });

    return { queued: true as const, email: user.email };
  },
});

/** Keanggotaan + akun anggotanya, atau galat yang jelas untuk pemanggil. */
async function loadMember(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  membershipId: Id<"memberships">,
) {
  const membership = await ctx.db.get(membershipId);
  if (!membership || membership.tenantId !== tenantId) {
    throw new Error("Anggota tidak ditemukan untuk tenant ini.");
  }
  const user = await ctx.db.get(membership.userId);
  if (!user) throw new Error("Akun anggota ini tidak ditemukan.");
  return { membership, user };
}

/**
 * Berapa pemilik **aktif** yang dimiliki workspace ini.
 *
 * Dipakai pagar “pemilik terakhir”: menurunkan, menonaktifkan, atau menghapus
 * pemilik terakhir ditolak, karena tidak akan ada lagi yang bisa mengelola
 * langganan, peran, dan tagihan workspace itu.
 */
async function countActiveOwners(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
): Promise<number> {
  const rows = await ctx.db
    .query("memberships")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  return rows.filter((row) => row.role === "owner" && row.active).length;
}

/** Email anggota **lain** di workspace ini (huruf kecil) — pendeteksi bentrok. */
async function otherMemberEmails(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  exceptUserId: Id<"users">,
): Promise<string[]> {
  const rows = await ctx.db
    .query("memberships")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  const emails: string[] = [];
  for (const row of rows) {
    if (row.userId === exceptUserId) continue;
    const user = await ctx.db.get(row.userId);
    if (user?.email) emails.push(user.email.trim().toLowerCase());
  }
  return emails;
}

/** Nama pengundang untuk email; alamat emailnya dipakai kalau namanya kosong. */
async function actorName(ctx: MutationCtx, actorId: Id<"users">): Promise<string> {
  const actor = await ctx.db.get(actorId);
  return actor?.name?.trim() || actor?.email || "Rekan tim";
}

/** Menjadwalkan satu email undangan; satu tempat, dipakai tambah & kirim ulang. */
async function scheduleInviteEmail(
  ctx: MutationCtx,
  input: {
    membershipId: Id<"memberships">;
    tenantId: Id<"tenants">;
    email: string;
    name?: string;
    role: Role;
    invitedByName: string;
  },
): Promise<void> {
  const tenant = await getTenantOrThrow(ctx, input.tenantId);
  await ctx.scheduler.runAfter(0, internal.inviteEmail.send, {
    membershipId: input.membershipId,
    email: input.email,
    name: input.name,
    role: input.role,
    workspace: tenant.name,
    invitedBy: input.invitedByName,
  });
}

/**
 * Email undangan benar-benar berangkat (atau alamat uji `.test` sengaja dilewati).
 * `inviteError` dibersihkan supaya barisnya tidak memperlihatkan kegagalan lama.
 */
export const markInviteDelivered = internalMutation({
  args: { membershipId: v.id("memberships"), via: v.string() },
  handler: async (ctx, args) => {
    const membership = await ctx.db.get(args.membershipId);
    if (!membership) return;
    await ctx.db.patch(args.membershipId, {
      inviteSentAt: Date.now(),
      inviteSentVia: args.via,
      inviteError: undefined,
      inviteAttempts: (membership.inviteAttempts ?? 0) + 1,
    });
  },
});

/** Pengiriman undangan gagal — dicatat apa adanya, bukan dianggap terkirim. */
export const markInviteFailed = internalMutation({
  args: { membershipId: v.id("memberships"), error: v.string() },
  handler: async (ctx, args) => {
    const membership = await ctx.db.get(args.membershipId);
    if (!membership) return;
    await ctx.db.patch(args.membershipId, {
      inviteSentAt: undefined,
      inviteSentVia: undefined,
      inviteError: args.error,
      inviteAttempts: (membership.inviteAttempts ?? 0) + 1,
    });
  },
});

/**
 * Mengubah satu anggota tim: nama, email, peran, nomor WhatsApp, aktif/nonaktif.
 *
 * Satu mutation untuk semuanya supaya aturannya satu tempat: perubahannya divalidasi
 * `validateTeamMemberEdit` (aturan yang sama dengan pratinjau di halaman), termasuk
 * pagar “pemilik terakhir” dan “hanya pemilik yang menyentuh peran pemilik”.
 * Email & nama hidup di baris `users` — akun itulah yang dipakai orangnya untuk
 * masuk — jadi mengubahnya berarti memperbaiki identitas masuk orang itu.
 */
export const update = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    membershipId: v.id("memberships"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    role: v.optional(roleValidator),
    phone: v.optional(v.union(v.string(), v.null())),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePermission(
      ctx,
      args.tenantId,
      args.actorId,
      "team.manage",
    );
    const { membership, user } = await loadMember(
      ctx,
      args.tenantId,
      args.membershipId,
    );

    const decision = validateTeamMemberEdit(
      {
        membershipId: membership._id,
        name: user.name,
        email: user.email,
        role: membership.role,
        phone: membership.phone ?? null,
        active: membership.active,
      },
      {
        name: args.name,
        email: args.email,
        role: args.role,
        phone: args.phone,
        active: args.active,
      },
      {
        actingRole: actor.role,
        actorMembershipId: actor._id,
        activeOwners: await countActiveOwners(ctx, args.tenantId),
        otherEmails: await otherMemberEmails(ctx, args.tenantId, membership.userId),
      },
    );
    if (!decision.ok) throw new Error(decision.reason);

    if (decision.changed.length === 0) {
      return { membershipId: membership._id, changed: [] as string[], email: user.email };
    }

    if (
      decision.changed.includes("name") ||
      decision.changed.includes("email")
    ) {
      await ctx.db.patch(membership.userId, {
        name: decision.value.name,
        email: decision.value.email,
      });
    }

    await ctx.db.patch(membership._id, {
      role: decision.value.role,
      active: decision.value.active,
      // Nomor kosong berarti dihapus, bukan disimpan sebagai string kosong.
      phone: decision.value.phone ?? undefined,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "member.update",
      entity: "memberships",
      entityId: membership._id,
      meta: {
        email: decision.value.email,
        changed: decision.changed,
        role: decision.value.role,
        active: decision.value.active,
      },
    });

    return {
      membershipId: membership._id,
      changed: decision.changed,
      email: decision.value.email,
    };
  },
});

/**
 * Menghapus anggota dari tim.
 *
 * Yang dihapus hanya keanggotaannya di workspace ini — baris `users` tetap ada,
 * karena orangnya bisa jadi anggota workspace lain atau diundang lagi nanti.
 * Pagar `validateTeamMemberRemoval` menahan penghapusan diri sendiri dan
 * hilangnya pemilik aktif terakhir.
 */
export const remove = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    membershipId: v.id("memberships"),
  },
  handler: async (ctx, args) => {
    const actor = await requirePermission(
      ctx,
      args.tenantId,
      args.actorId,
      "team.manage",
    );
    const { membership, user } = await loadMember(
      ctx,
      args.tenantId,
      args.membershipId,
    );

    const decision = validateTeamMemberRemoval(
      {
        membershipId: membership._id,
        role: membership.role,
        active: membership.active,
      },
      {
        actingRole: actor.role,
        actorMembershipId: actor._id,
        activeOwners: await countActiveOwners(ctx, args.tenantId),
      },
    );
    if (!decision.ok) throw new Error(decision.reason);

    await ctx.db.delete(membership._id);

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "member.remove",
      entity: "memberships",
      entityId: membership._id,
      meta: { email: user.email, role: membership.role },
    });

    return { removed: true as const, email: user.email };
  },
});

/**
 * Mencatat bahwa undangan WhatsApp dibuka pengundang untuk anggota ini.
 *
 * Yang dicatat hanya **tautan dibuka** (dan berapa kali), bukan “terkirim”:
 * pesannya dikirim dari aplikasi WhatsApp pengundang, dan aplikasi ini tidak
 * menerima konfirmasi pengiriman dari sana. Klien tidak boleh melaporkan galat
 * ke sini — kalau nanti ada jalur API, hasilnya ditulis server di sana.
 */
export const recordWaInvite = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    membershipId: v.id("memberships"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "team.manage");
    const { membership, user } = await loadMember(
      ctx,
      args.tenantId,
      args.membershipId,
    );
    if (!membership.phone) {
      throw new Error("Anggota ini belum punya nomor WhatsApp.");
    }

    await ctx.db.patch(membership._id, {
      waInviteAt: Date.now(),
      waInviteCount: (membership.waInviteCount ?? 0) + 1,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "member.invite",
      entity: "memberships",
      entityId: membership._id,
      meta: {
        email: user.email,
        phone: membership.phone,
        channel: "whatsapp",
        via: WA_INVITE_VIA_LINK,
      },
    });

    return { recorded: true as const };
  },
});

export const list = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "team.manage");

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const rows = await Promise.all(
      memberships.map(async (membership) => {
        const user = await ctx.db.get(membership.userId);
        return user ? { membership, user } : null;
      }),
    );

    return rows
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => a.user.name.localeCompare(b.user.name));
  },
});

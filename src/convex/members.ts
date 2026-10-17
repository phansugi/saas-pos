import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { Permission, Role } from "./lib/authz";
import {
  getTenantOrThrow,
  requireFeature,
  requirePermission,
  resolveMembershipPermissions,
  writeAuditLog,
} from "./lib/access";
import { assignmentError, lackingFromPermissions } from "./lib/rbac";
import { membershipAssignmentError } from "./lib/platform";
import {
  legacyRoleCleanupDecision,
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

/**
 * Penyesuaian peran bawaan workspace ini — dibaca sekali per permintaan supaya
 * undangan & perubahan anggota memakai aturan yang sama dengan halaman.
 *
 * Hanya peran bawaan yang **tersimpan** di `roleSettings`; peran yang belum
 * pernah diatur tidak punya baris dan berarti bawaan (aktif, izin bawaan).
 */
async function roleSettingsOf(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"roleSettings">[]> {
  return ctx.db
    .query("roleSettings")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
}

export const add = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    email: v.string(),
    name: v.optional(v.string()),
    /** Nomor WhatsApp opsional untuk undangan lewat `wa.me`. */
    phone: v.optional(v.string()),
    /**
     * Peran **bawaan**. Kosong hanya sah kalau `customRoleId` diisi — peran
     * tambahan berdiri sendiri dan tidak menumpang peran bawaan tertentu.
     */
    role: v.optional(roleValidator),
    storeIds: v.optional(v.array(v.id("stores"))),
    /*
      Peran kustom yang **langsung dipakai** anggota ini saat didaftarkan.
      Sebelumnya peran kustom hanya bisa ditugaskan setelah orangnya ada di tim
      (kolom “Peran kustom” di daftar anggota) — itulah yang dikeluhkan pemilik
      toko. `null` = lepas peran kustomnya, `undefined` = jangan diubah.
    */
    customRoleId: v.optional(v.union(v.null(), v.id("customRoles"))),
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
    // menerima kode masuk, hanya pemilik yang boleh mencetak pemilik kedua, dan
    // peran yang sudah dinonaktifkan/dihapus tidak ditawarkan lagi.
    /*
      Peran tambahan berdiri sendiri: kalau undangan membawa `customRoleId`, tidak
      ada peran bawaan yang ikut ditulis, jadi status peran bawaan mana pun tidak
      dipakai sebagai pagar — pagar sebenarnya adalah peran tambahannya (aktif,
      fitur `rbac.custom`, tidak melebihi wewenang pengundang) yang diperiksa di
      bawah.
    */
    const invitation = validateTeamInvite(
      { email: args.email, name: args.name, role: args.role ?? null },
      {
        actingRole: actor.role ?? null,
        roleSettings: args.customRoleId
          ? []
          : await roleSettingsOf(ctx, args.tenantId),
        standaloneCustomRole: Boolean(args.customRoleId),
      },
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

    /*
      Peran kustom (kalau dipilih) diperiksa **sebelum** keanggotaan ditulis:
      fitur `rbac.custom` harus dimuat paketnya (membukanya berarti menambah
      akses), perannya harus milik tenant ini & sedang aktif, dan pagar
      eskalasinya memakai izin **efektif** pengundang — aturan yang sama persis
      dengan `roles.assign`, karena menugaskan lewat undangan sama saja dengan
      menugaskannya setelah orangnya masuk.
    */
    let customRoleId: Id<"customRoles"> | undefined;
    if (args.customRoleId) {
      const blockedAssignment = assignmentError(args.role ?? null);
      if (blockedAssignment) throw new Error(blockedAssignment);

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
      customRoleId = role._id;
    }

    /*
      Satu anggota = satu peran. Undangan dengan peran tambahan tidak menyimpan
      peran bawaan sama sekali, jadi peran itu benar-benar berdiri sendiri;
      undangan tanpa peran tambahan membawa peran bawaan seperti biasa.
    */
    const roleBawaan: Role | null = invitation.value.role ?? null;

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
      /*
        Re-adding someone is a role change / reactivation, not a duplicate row.

        Peran yang dikirim **menggantikan** peran lama seutuhnya — tidak ada dua
        peran yang menumpuk di satu baris. Undangan yang **tidak** menyebut
        peran tambahan sama sekali (`customRoleId` tidak dikirim) tidak menyentuh
        penugasan yang sedang berlaku: anggota berperan tambahan tetap memakai
        peran tambahannya, bukan diam-diam jatuh ke peran bawaan yang dikirim
        formulir. Yang benar-benar melepas peran tambahan adalah `null` eksplisit.
      */
      const peranTambahanBerlaku: Id<"customRoles"> | null =
        args.customRoleId === undefined
          ? (membership.customRoleId ?? null)
          : (customRoleId ?? null);
      const roleBaris: Role | null =
        peranTambahanBerlaku === null ? roleBawaan : null;

      await ctx.db.patch(membership._id, {
        role: roleBaris ?? undefined,
        customRoleId: peranTambahanBerlaku ?? undefined,
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
        meta: {
          email,
          role: roleBaris,
          customRoleId: peranTambahanBerlaku,
        },
      });
      return { userId, membershipId: membership._id, created: false };
    }

    /*
      Keanggotaan baru: peran tambahan berdiri sendiri (`role` tidak ditulis),
      peran bawaan wajib ada — `validateTeamInvite` sudah memastikannya, dan
      pagar ini menahan bentuk data yang tidak sah sebelum barisnya dibuat.
    */
    const role: Role | null = customRoleId ? null : roleBawaan;
    if (!role && !customRoleId) {
      throw new Error("Pilih satu peran untuk anggota ini.");
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
      role: role ?? undefined,
      storeIds: stores,
      active: true,
      createdAt: Date.now(),
      phone,
      customRoleId,
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
      role,
      customRoleName: await customRoleNameOf(ctx, args.tenantId, customRoleId),
      invitedByName: await actorName(ctx, args.actorId),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "member.add",
      entity: "memberships",
      entityId: membershipId,
      meta: { email, role, customRoleId: customRoleId ?? null },
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
      role: membership.role ?? null,
      customRoleName: await customRoleNameOf(
        ctx,
        args.tenantId,
        membership.customRoleId,
      ),
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
    /** `null` = anggota itu hanya memakai peran tambahan (berdiri sendiri). */
    role: Role | null;
    invitedByName: string;
    /** Nama peran kustom yang dipakai anggota ini, kalau ada. */
    customRoleName?: string;
  },
): Promise<void> {
  const tenant = await getTenantOrThrow(ctx, input.tenantId);
  await ctx.scheduler.runAfter(0, internal.inviteEmail.send, {
    membershipId: input.membershipId,
    email: input.email,
    name: input.name,
    role: input.role ?? undefined,
    customRoleName: input.customRoleName,
    workspace: tenant.name,
    invitedBy: input.invitedByName,
  });
}

/**
 * Nama peran kustom sebuah keanggotaan — untuk undangan (email) dan audit.
 *
 * Dibaca dari id-nya, bukan dari salinan di keanggotaan: nama peran bisa diubah
 * pemilik toko, dan undangan harus menyebut nama yang berlaku sekarang.
 */
async function customRoleNameOf(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  customRoleId: Id<"customRoles"> | undefined,
): Promise<string | undefined> {
  if (!customRoleId) return undefined;
  const role = await ctx.db.get(customRoleId);
  if (!role || role.tenantId !== tenantId) return undefined;
  return role.name;
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
        role: membership.role ?? null,
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
        actingRole: actor.role ?? null,
        actorMembershipId: actor._id,
        activeOwners: await countActiveOwners(ctx, args.tenantId),
        otherEmails: await otherMemberEmails(ctx, args.tenantId, membership.userId),
        roleSettings: await roleSettingsOf(ctx, args.tenantId),
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

    /*
      Peran Pemilik selalu memegang seluruh izin, jadi peran tambahan yang masih
      menempel dilepas saat seseorang diangkat menjadi pemilik. Tanpa ini, pemilik
      itu akan memakai izin peran tambahannya — termasuk kehilangan
      `billing.manage` — dan tenant bisa terkunci dari langganannya sendiri.
    */
    /*
      Satu anggota = satu peran. Begitu peran bawaan dikirim secara eksplisit,
      peran tambahan yang menempel dilepas — tanpa ini anggota akan menyimpan dua
      peran sekaligus dan peran barunya terasa “menumpang” peran lama.
    */
    const lepasPeranTambahan =
      args.role !== undefined && membership.customRoleId !== undefined;

    await ctx.db.patch(membership._id, {
      role: decision.value.role ?? undefined,
      active: decision.value.active,
      // Nomor kosong berarti dihapus, bukan disimpan sebagai string kosong.
      phone: decision.value.phone ?? undefined,
      ...(lepasPeranTambahan ? { customRoleId: undefined } : {}),
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
        customRoleId: lepasPeranTambahan ? null : undefined,
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
        role: membership.role ?? null,
        active: membership.active,
      },
      {
        actingRole: actor.role ?? null,
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

/**
 * Merapikan baris keanggotaan **lama** yang masih menyimpan peran bawaan bersama
 * peran tambahannya.
 *
 * Baris seperti itu ditulis sebelum 2026-10-17, waktu peran tambahan masih
 * “menumpang” peran bawaan (`cashier` sebagai peran dasar tersembunyi). Sejak
 * aturan “satu anggota = satu peran” berlaku, tidak ada jalur tulis yang
 * menghasilkannya lagi — tetapi baris yang sudah ada di database tidak berubah
 * sendiri, jadi perlu dirapikan sekali di sini.
 *
 * Sifatnya:
 *  - **tidak mencabut akses** — yang dilepas selalu peran yang **tidak berlaku**
 *    sekarang, mengikuti `legacyRoleCleanupDecision`;
 *  - **idempoten** — baris yang sudah hanya punya satu peran dilewati, jadi aman
 *    dijalankan berkali-kali;
 *  - **bertahap** — satu panggilan membaca `batchSize` baris, lalu menjadwalkan
 *    batch berikutnya sampai habis (batas baca/tulis satu transaksi Convex tidak
 *    pernah tersentuh walaupun anggotanya ribuan);
 *  - **bisa diuji tanpa menulis** — `dryRun` hanya melaporkan keputusannya.
 *
 * Jalankan dari terminal deployment:
 *
 *   bunx convex run members:cleanupLegacyRoles '{"dryRun":true}'   # lihat dulu
 *   bunx convex run members:cleanupLegacyRoles                     # rapikan
 */
export const cleanupLegacyRoles = internalMutation({
  args: {
    /** Kursor batch sebelumnya; kosongkan untuk mulai dari awal. */
    cursor: v.optional(v.union(v.null(), v.string())),
    /** Jumlah baris per batch (1–200, bawaan 100). */
    batchSize: v.optional(v.number()),
    /** Hanya laporkan, jangan menulis apa pun. */
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun === true;
    const batchSize = Math.min(
      Math.max(Math.trunc(args.batchSize ?? 100), 1),
      200,
    );

    const page = await ctx.db.query("memberships").paginate({
      numItems: batchSize,
      cursor: args.cursor ?? null,
    });

    const rows: {
      membershipId: Id<"memberships">;
      tenantId: Id<"tenants">;
      role: Role;
      customRoleId: Id<"customRoles">;
      action: "drop-base-role" | "drop-custom-role";
      reason: string;
    }[] = [];
    let droppedBaseRole = 0;
    let droppedCustomRole = 0;
    let skipped = 0;

    for (const membership of page.page) {
      const customRole = membership.customRoleId
        ? await ctx.db.get(membership.customRoleId)
        : null;
      const decision = legacyRoleCleanupDecision({
        role: membership.role ?? null,
        customRoleId: membership.customRoleId ?? null,
        tenantId: membership.tenantId,
        customRole,
      });

      if (decision.action === "none") {
        skipped += 1;
        continue;
      }

      // Baris ini pasti punya kedua peran; `legacyRoleCleanupDecision` hanya
      // memutuskan melepas yang mana.
      const role = membership.role as Role;
      const customRoleId = membership.customRoleId as Id<"customRoles">;

      if (!dryRun) {
        await ctx.db.patch(
          membership._id,
          decision.action === "drop-base-role"
            ? { role: undefined }
            : { customRoleId: undefined },
        );
      }

      if (decision.action === "drop-base-role") droppedBaseRole += 1;
      else droppedCustomRole += 1;

      rows.push({
        membershipId: membership._id,
        tenantId: membership.tenantId,
        role,
        customRoleId,
        action: decision.action,
        reason: decision.reason,
      });
    }

    if (!dryRun && !page.isDone) {
      await ctx.scheduler.runAfter(0, internal.members.cleanupLegacyRoles, {
        cursor: page.continueCursor,
        batchSize,
      });
    }

    return {
      dryRun,
      scanned: page.page.length,
      cleaned: rows.length,
      droppedBaseRole,
      droppedCustomRole,
      skipped,
      done: page.isDone,
      rows,
    };
  },
});

/**
 * Laporan baca-saja: baris keanggotaan mana yang **masih** menyimpan peran
 * bawaan bersama peran tambahannya, beserta keputusan pembersihannya.
 *
 * Dipakai untuk memastikan pembersihan benar-benar habis (`legacyCount: 0`) dan
 * untuk melihat keputusan `dryRun` per baris tanpa menulis apa pun.
 */
export const legacyRoleReport = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Batas baca satu query Convex 4096 dokumen; jumlah anggota satu deployment
    // jauh di bawahnya. `truncated` tetap dilaporkan apa adanya kalau tidak.
    const memberships = await ctx.db.query("memberships").take(4096);

    const rows: {
      membershipId: Id<"memberships">;
      tenantId: Id<"tenants">;
      role: Role;
      customRoleId: Id<"customRoles">;
      customRoleName: string | null;
      action: "none" | "drop-base-role" | "drop-custom-role";
      reason: string;
    }[] = [];

    for (const membership of memberships) {
      const customRole = membership.customRoleId
        ? await ctx.db.get(membership.customRoleId)
        : null;
      const decision = legacyRoleCleanupDecision({
        role: membership.role ?? null,
        customRoleId: membership.customRoleId ?? null,
        tenantId: membership.tenantId,
        customRole,
      });
      if (decision.action === "none") continue;
      rows.push({
        membershipId: membership._id,
        tenantId: membership.tenantId,
        role: membership.role as Role,
        customRoleId: membership.customRoleId as Id<"customRoles">,
        customRoleName: customRole?.name ?? null,
        action: decision.action,
        reason: decision.reason,
      });
    }

    return {
      scanned: memberships.length,
      legacyCount: rows.length,
      truncated: memberships.length === 4096,
      rows,
    };
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

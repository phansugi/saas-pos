import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireFeature, requirePermission, writeAuditLog } from "./lib/access";
import { resolveMemberInput } from "./lib/loyalty";

/**
 * Member pelanggan & diskonnya (`member.discount`) — modul UMKM, Phase 2.
 *
 * Namespace API-nya `loyalty` karena `src/convex/members.ts` sudah dipakai untuk
 * **anggota tim** (undangan & peran). Ini pelanggan, bukan staf.
 *
 * Gerbangnya seperti fitur modul lain:
 * - **membaca** daftar member butuh izin `member.view` saja, supaya data member
 *   tetap bisa dirapikan walau modul UMKM sedang dimatikan;
 * - **memberi diskon > 0** butuh fitur `member.discount` (modul UMKM) — mematikan
 *   modul berarti berhenti memberi diskon baru, bukan menghapus yang lama;
 * - menurunkan diskon ke 0 (atau menonaktifkan member) selalu boleh, itu jalur
 *   pembersihan konfigurasi.
 *
 * Yang **tidak** dilakukan di sini: menghitung diskon transaksi. Itu ada di
 * `pos.createSale` memakai aturan murni `lib/loyalty.ts`, supaya angka yang
 * dicatat selalu dihitung server dari data member, bukan dari input kasir.
 */

export const list = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "member.view");

    const members = await ctx.db
      .query("members")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    return members
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "id-ID"))
      .map((member) => ({
        id: member._id,
        code: member.code,
        name: member.name,
        phone: member.phone,
        discountPct: member.discountPct,
        active: member.active,
        createdAt: member.createdAt,
      }));
  },
});

export const create = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    name: v.string(),
    code: v.optional(v.string()),
    phone: v.optional(v.string()),
    discountPct: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "member.manage");

    const existing = await ctx.db
      .query("members")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();

    const resolved = resolveMemberInput(
      {
        name: args.name,
        code: args.code,
        phone: args.phone,
        discountPct: args.discountPct,
      },
      existing.map((member) => member.code),
    );
    if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
    const member = resolved.value;

    if (member.discountPct > 0) {
      await requireFeature(
        ctx,
        args.tenantId,
        args.actorId,
        "member.discount",
        "member.manage",
      );
    }

    const duplicate = existing.find((row) => row.code === member.code);
    if (duplicate) throw new Error(`Kode member ${member.code} sudah dipakai.`);

    const memberId = await ctx.db.insert("members", {
      tenantId: args.tenantId,
      code: member.code,
      name: member.name,
      phone: member.phone,
      discountPct: member.discountPct,
      active: member.active,
      createdAt: Date.now(),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "member.create",
      entity: "members",
      entityId: memberId,
      meta: { code: member.code, name: member.name, discountPct: member.discountPct },
    });

    return { memberId, code: member.code, name: member.name };
  },
});

/** Mengubah nama/telepon/diskon/status member. Kode member tidak berubah. */
export const update = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    memberId: v.id("members"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    discountPct: v.optional(v.number()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "member.manage");

    const existing = await ctx.db.get(args.memberId);
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new Error("Member tidak ditemukan untuk tenant ini.");
    }

    const discountPct = Math.trunc(args.discountPct ?? existing.discountPct);
    if (discountPct > 0) {
      await requireFeature(
        ctx,
        args.tenantId,
        args.actorId,
        "member.discount",
        "member.manage",
      );
    }

    const resolved = resolveMemberInput({
      name: args.name ?? existing.name,
      code: existing.code,
      phone: args.phone ?? existing.phone,
      discountPct,
      active: args.active ?? existing.active,
    });
    if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
    const member = resolved.value;

    await ctx.db.patch(args.memberId, {
      name: member.name,
      phone: member.phone,
      discountPct: member.discountPct,
      active: member.active,
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "member.update",
      entity: "members",
      entityId: args.memberId,
      meta: {
        code: member.code,
        from: existing.discountPct,
        to: member.discountPct,
        active: member.active,
      },
    });

    return {
      code: member.code,
      name: member.name,
      discountPct: member.discountPct,
      active: member.active,
    };
  },
});

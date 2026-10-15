/**
 * Akun platform (mis. pengembang) — di luar RBAC tenant.
 *
 * Berkas ini dibagi dua bagian yang sengaja tidak dicampur:
 *
 *  **A. Akun platform itu sendiri**
 *  - `me` — satu-satunya bacaan backstage: “apakah saya benar-benar akun platform
 *    yang terverifikasi?”.
 *  - `grant`/`revoke` — **internalMutation**, jadi hanya bisa dijalankan dengan
 *    akses deployment (`bun convex run platform:grant …` atau dashboard), bukan
 *    dari klien aplikasi. Tidak ada jalan bagi siapa pun di dalam tenant untuk
 *    memberi dirinya penanda ini, atau bahkan mengetahui bahwa akun semacam ini ada.
 *
 *  **B. Sesi pendampingan (impersonasi) — `lib/impersonation.ts`**
 *
 *  Akun platform tidak pernah mendapat izin tenant, dan itu tetap berlaku: yang
 *  dibuka `impersonate` bukan keanggotaan, melainkan **sesi berjejak** dengan
 *  alasan tertulis dan batas waktu. Yang perlu diperhatikan:
 *
 *  - `impersonate`, `helpTenant`, dan `endImpersonation` semuanya lewat
 *    `requirePlatformDeveloper`/`requireImpersonation`, jadi **identitas login
 *    terverifikasi wajib** — lebih ketat daripada gate tenant yang masih boleh
 *    longgar selama `ALLOW_UNVERIFIED_ACTOR` transisi.
 *  - Sesinya **hanya membaca**: `helpTenant` mengembalikan ringkasan bantuan dan
 *    tidak ada `Permission` tenant yang ikut menyala, supaya bantuan platform
 *    tidak pernah tampak seperti tindakan anggota. Setiap pembacaan dicatat
 *    (`helpCount` + baris audit), jadi jejaknya bukan sekadar “pernah masuk”.
 *  - Jejaknya ditulis **ke dalam `auditLogs` milik tenant yang dibantu**, dan itu
 *    pembalikan yang sadar atas aturan ketak-terlihatan: selama tidak menolong,
 *    akun platform tidak bisa ditemukan; begitu menolong, tenant berhak tahu
 *    siapa yang masuk. `impersonationTrail` adalah kanal baca untuk tenant itu.
 *  - Tidak ada keanggotaan yang dibuat di mana pun. Setelah sesi ditutup,
 *    permukaan tenant tertutup lagi — bantuannya sementara, jejaknya permanen.
 */

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import {
  requireImpersonation,
  requirePermission,
  requirePlatformDeveloper,
  writeAuditLog,
} from "./lib/access";
import {
  decideImpersonationStart,
  describeImpersonation,
  impersonationClosedAudit,
  impersonationDurationMinutes,
  impersonationExpiry,
  impersonationHelpAudit,
  impersonationMinutes,
  impersonationRemainingMs,
  impersonationStartedAudit,
  impersonationStatus,
  impersonationTrail as buildImpersonationTrail,
  IMPERSONATION_DEFAULT_MINUTES,
  IMPERSONATION_MAX_ACTIVE,
  IMPERSONATION_MAX_MINUTES,
  IMPERSONATION_MEMBERS_LIMIT,
  IMPERSONATION_SESSION_LIMIT,
  IMPERSONATION_SOURCE,
  IMPERSONATION_STORES_LIMIT,
  IMPERSONATION_SWEEP_BATCH,
  IMPERSONATION_TRAIL_LIMIT,
  summariseImpersonations,
  type ImpersonationAccount,
} from "./lib/impersonation";
import {
  describePlatformAccount,
  PLATFORM_ROLE_LABELS,
  visibleInTenantSurfaces,
  type PlatformRole,
} from "./lib/platform";

/** Satu baris anggota di ringkasan bantuan (tanpa akun platform, lihat di bawah). */
interface HelpMemberRow {
  userId: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
}

/** Satu sesi di daftar milik pengembang. */
interface MySessionRow {
  id: string;
  tenantId: string;
  tenantName: string;
  reason: string;
  status: "active" | "ended" | "expired";
  startedAt: number;
  expiresAt: number;
  endedAt: number | null;
  closedBy: string | null;
  helpCount: number;
  durationMinutes: number;
  remainingMs: number;
}

/** Berapa tenant yang ditampilkan di daftar backstage (bukan seluruh deployment). */
const TENANT_DIRECTORY_LIMIT = 50;

/** Bentuk akun platform yang dipakai aturan murni. */
function accountOf(user: {
  name: string;
  email: string;
  platformRole?: string | null;
}): ImpersonationAccount {
  return {
    name: user.name,
    email: user.email,
    platformRole: String(user.platformRole ?? ""),
  };
}

/**
 * Profil akun platform untuk halaman backstage.
 *
 * Ini satu-satunya query yang menerima penanda platform, dan ia tetap tidak
 * membocorkan keberadaan akun: pemanggil yang bukan dirinya akan ditolak sebelum
 * perannya dibaca (lihat `decidePlatformAccess`).
 */
export const me = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await requirePlatformDeveloper(ctx, args.userId);
    return {
      id: user._id as string,
      name: user.name,
      email: user.email,
      role: user.platformRole as PlatformRole,
      roleLabel: PLATFORM_ROLE_LABELS[user.platformRole as PlatformRole],
      /** Ringkasan untuk log/pesan; tidak memuat rahasia apa pun. */
      label: describePlatformAccount({
        name: user.name,
        email: user.email,
        platformRole: user.platformRole,
      }),
    };
  },
});

/**
 * Memberi penanda akun platform pada sebuah email — membuat baris `users` kalau
 * belum ada. **Internal**: hanya akses deployment yang bisa memanggilnya.
 *
 * Akun yang lahir di sini tidak punya keanggotaan apa pun, dan satu-satunya
 * keanggotaan yang bisa ia dapat adalah workspace yang ia dirikan sendiri
 * (`tenants.create`). Ia **tidak** bisa diundang masuk tenant orang lain
 * (`members.add` menolak, lihat `membershipAssignmentError`), dan tenant yang ia
 * dirikan sendiri tidak bisa ia dampingi lewat sesi platform — jadi di tenant
 * orang lain ia tetap tidak punya baris yang bisa ditemukan.
 */
export const grant = internalMutation({
  args: { email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("Email tidak valid.");

    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { platformRole: "developer" });
      return { userId: existing._id, created: false };
    }

    const userId = await ctx.db.insert("users", {
      name: args.name?.trim() || email.split("@")[0] || "Pengembang",
      email,
      platformRole: "developer",
      createdAt: Date.now(),
    });
    return { userId, created: true };
  },
});

/**
 * Mencabut penanda akun platform. Akunnya **tidak dihapus** — baris `users` bisa
 * saja sudah dirujuk data lain — dan setelah dicabut ia menjadi akun biasa.
 *
 * Yang sengaja **tidak** ikut dicabut: workspace yang sudah ia dirikan. Keanggotaan
 * pemilik di workspace sendiri adalah keanggotaan yang sah, jadi mencabut peran
 * platform tidak boleh menghilangkan dashboard yang sudah ia pakai — ia hanya
 * berhenti menjadi akun platform, bukan berhenti menjadi pemilik.
 */
export const revoke = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (!user) throw new Error("Akun dengan email itu tidak ditemukan.");
    await ctx.db.patch(user._id, { platformRole: undefined });
    return { userId: user._id, revoked: user.platformRole !== undefined };
  },
});

/**
 * Daftar tenant untuk pemilih di backstage.
 *
 * Ini satu-satunya bacaan lintas-tenant di seluruh backend, dan gerbangnya akun
 * platform terverifikasi — bukan anggota tenant mana pun. Karena itu isinya
 * sengaja tipis (identitas & paket, bukan data operasional): yang dibutuhkan
 * pengembang untuk memilih tujuan pendampingan, bukan untuk bekerja tanpa sesi.
 */
export const tenantDirectory = query({
  args: { actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requirePlatformDeveloper(ctx, args.actorId);

    const rows = await ctx.db.query("tenants").order("desc").take(TENANT_DIRECTORY_LIMIT);
    return {
      tenants: rows.map((tenant) => ({
        id: tenant._id as string,
        name: tenant.name,
        slug: tenant.slug,
        planKey: tenant.planKey,
        status: tenant.status,
        verticals: tenant.verticals,
        createdAt: tenant.createdAt,
      })),
      limit: TENANT_DIRECTORY_LIMIT,
      truncated: rows.length === TENANT_DIRECTORY_LIMIT,
    };
  },
});

/**
 * Membuka sesi pendampingan untuk satu tenant. Butuh **identitas terverifikasi**
 * dan **alasan tertulis**; sesinya dibatasi waktu, satu hidup per pengembang, dan
 * langsung menulis baris audit milik tenant yang dibantu.
 */
export const impersonate = mutation({
  args: {
    actorId: v.id("users"),
    tenantId: v.id("tenants"),
    reason: v.string(),
    minutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requirePlatformDeveloper(ctx, args.actorId);
    const now = Date.now();

    const tenant = await ctx.db.get(args.tenantId);
    const activeRows = await ctx.db
      .query("impersonationSessions")
      .withIndex("by_actor_status", (q) =>
        q.eq("actorId", user._id).eq("status", "active"),
      )
      .take(IMPERSONATION_SESSION_LIMIT);
    const liveRow = activeRows.find((row) => impersonationStatus(row, now) === "active");
    const liveTenant = liveRow ? await ctx.db.get(liveRow.tenantId) : null;

    const decision = decideImpersonationStart({
      now,
      tenantExists: tenant !== null,
      // Workspace milik pengembang sendiri bukan sasaran pendampingan: di sana ia
      // sudah pemilik, jadi masuknya lewat dashboard aplikasi.
      ownsTenant: tenant !== null && tenant.ownerId === user._id,
      activeSession: liveRow
        ? { ...liveRow, tenantName: liveTenant?.name ?? undefined }
        : null,
      reason: args.reason,
      minutes: args.minutes,
    });
    if (!decision.allowed) throw new Error(decision.reason);
    if (!tenant) throw new Error("Tenant tujuan tidak ditemukan.");

    const minutes = decision.minutes;
    const sessionId = await ctx.db.insert("impersonationSessions", {
      actorId: user._id,
      tenantId: tenant._id,
      reason: decision.reason,
      source: IMPERSONATION_SOURCE,
      status: "active",
      startedAt: now,
      expiresAt: impersonationExpiry(now, minutes),
      helpCount: 0,
    });

    // Jejak pertama ditulis ke audit **tenant**, bukan ke log platform: yang
    // dibantu berhak tahu kapan bantuannya dimulai dan atas alasan apa.
    const started = impersonationStartedAudit({
      account: accountOf(user),
      sessionId: sessionId as string,
      reason: decision.reason,
      minutes,
    });
    await writeAuditLog(ctx, {
      tenantId: tenant._id,
      actorId: user._id,
      action: started.action,
      entity: started.entity,
      entityId: started.entityId,
      meta: started.meta,
    });

    return {
      sessionId: sessionId as string,
      tenantId: tenant._id as string,
      tenantName: tenant.name,
      reason: decision.reason,
      minutes,
      startedAt: now,
      expiresAt: now + minutes * 60_000,
      platformLabel: describePlatformAccount({
        name: user.name,
        email: user.email,
        platformRole: user.platformRole,
      }),
      summary: describeImpersonation({
        tenantName: tenant.name,
        account: accountOf(user),
        session: { status: "active", startedAt: now, expiresAt: now + minutes * 60_000 },
        now,
      }),
    };
  },
});

/**
 * Ringkasan bantuan untuk satu tenant — **satu-satunya** bacaan isi tenant yang
 * bisa dilakukan akun platform, dan ia tetap harus lewat sesi hidup.
 *
 * Sengaja `mutation`, bukan `query`: bacaan ini mencatat dirinya sendiri
 * (`helpCount` + baris audit), dan di Convex hanya mutation yang boleh menulis.
 * Bacaan teraudit memang bukan bacaan biasa — itu intinya.
 */
export const helpTenant = mutation({
  args: { actorId: v.id("users"), sessionId: v.id("impersonationSessions") },
  handler: async (ctx, args) => {
    const { user, session, tenant } = await requireImpersonation(
      ctx,
      args.actorId,
      args.sessionId,
    );
    const now = Date.now();

    const membershipRows = await ctx.db
      .query("memberships")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
      .take(IMPERSONATION_MEMBERS_LIMIT + 1);

    const members: HelpMemberRow[] = [];
    for (const membership of membershipRows.slice(0, IMPERSONATION_MEMBERS_LIMIT)) {
      const member = await ctx.db.get(membership.userId);
      if (!member) continue;
      // Akun platform tetap tidak pernah muncul di permukaan tenant — termasuk
      // di ringkasan bantuan yang dibaca sesama pengembang.
      if (!visibleInTenantSurfaces({ platformRole: member.platformRole ?? null })) continue;
      members.push({
        userId: member._id as string,
        name: member.name,
        email: member.email,
        role: membership.role as string,
        active: membership.active,
      });
    }

    const storeRows = await ctx.db
      .query("stores")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
      .take(IMPERSONATION_STORES_LIMIT + 1);

    const helpCount = session.helpCount + 1;
    await ctx.db.patch(session._id, { helpCount, lastHelpAt: now });

    const help = impersonationHelpAudit({
      account: accountOf(user),
      sessionId: session._id as string,
      reason: session.reason,
      minutes: impersonationMinutes(
        Math.round((session.expiresAt - session.startedAt) / 60_000),
      ),
      helpCount,
    });
    await writeAuditLog(ctx, {
      tenantId: tenant._id,
      actorId: user._id,
      action: help.action,
      entity: help.entity,
      entityId: help.entityId,
      meta: help.meta,
    });

    return {
      sessionId: session._id as string,
      reason: session.reason,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      remainingMs: impersonationRemainingMs(session, now),
      helpCount,
      /** Sesi ini hanya membaca — tidak ada izin tulis yang menyertainya. */
      readOnly: true as const,
      platformLabel: describePlatformAccount({
        name: user.name,
        email: user.email,
        platformRole: user.platformRole,
      }),
      tenant: {
        id: tenant._id as string,
        name: tenant.name,
        slug: tenant.slug,
        planKey: tenant.planKey,
        planVersion: tenant.planVersion,
        status: tenant.status,
        verticals: tenant.verticals,
        currency: tenant.currency,
        taxRatePct: tenant.taxRatePct,
        createdAt: tenant.createdAt,
      },
      members,
      membersTruncated: membershipRows.length > IMPERSONATION_MEMBERS_LIMIT,
      stores: storeRows.slice(0, IMPERSONATION_STORES_LIMIT).map((store) => ({
        id: store._id as string,
        name: store.name,
        code: store.code,
        active: store.active,
      })),
      storesTruncated: storeRows.length > IMPERSONATION_STORES_LIMIT,
      counts: {
        members: members.length,
        activeMembers: members.filter((row) => row.active).length,
        stores: Math.min(storeRows.length, IMPERSONATION_STORES_LIMIT),
      },
    };
  },
});

/**
 * Menutup sesi lebih awal. Sesi yang sudah mati tidak bisa ditutup dua kali, dan
 * yang bukan milik pemanggil tidak bisa ditutup sama sekali.
 */
export const endImpersonation = mutation({
  args: {
    actorId: v.id("users"),
    sessionId: v.id("impersonationSessions"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, session, tenant } = await requireImpersonation(
      ctx,
      args.actorId,
      args.sessionId,
    );
    const now = Date.now();
    const note =
      args.note === undefined ? undefined : args.note.trim().slice(0, 200) || undefined;

    await ctx.db.patch(session._id, {
      status: "ended",
      endedAt: now,
      closedBy: "developer",
    });

    const closed = impersonationClosedAudit({
      account: accountOf(user),
      session: { ...session, status: "ended", endedAt: now },
      sessionId: session._id as string,
      now,
      closedBy: "developer",
    });
    await writeAuditLog(ctx, {
      tenantId: tenant._id,
      actorId: user._id,
      action: closed.action,
      entity: closed.entity,
      entityId: closed.entityId,
      meta: closed.meta,
    });

    return {
      sessionId: session._id as string,
      tenantId: tenant._id as string,
      tenantName: tenant.name,
      endedAt: now,
      durationMinutes: impersonationDurationMinutes(
        { ...session, status: "ended", endedAt: now },
        now,
      ),
      helpCount: session.helpCount,
      note: note ?? null,
      summary: describeImpersonation({
        tenantName: tenant.name,
        account: accountOf(user),
        session: { ...session, status: "ended", endedAt: now },
        now,
      }),
    };
  },
});

/**
 * Sesi milik pengembang yang sedang login — termasuk rekapnya.
 *
 * Ini sisi **platform** dari jejak audit: pengembang melihat apa yang sudah ia
 * lakukan, tenant melihat kunjungan ke datanya lewat `impersonationTrail`.
 */
export const myImpersonations = query({
  args: { actorId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await requirePlatformDeveloper(ctx, args.actorId);
    const now = Date.now();

    const rows = [
      ...(await ctx.db
        .query("impersonationSessions")
        .withIndex("by_actor_status", (q) =>
          q.eq("actorId", user._id).eq("status", "active"),
        )
        .take(IMPERSONATION_SESSION_LIMIT)),
      ...(await ctx.db
        .query("impersonationSessions")
        .withIndex("by_actor_status", (q) =>
          q.eq("actorId", user._id).eq("status", "ended"),
        )
        .take(IMPERSONATION_SESSION_LIMIT)),
    ].sort((a, b) => b.startedAt - a.startedAt);

    const sessions: MySessionRow[] = [];
    for (const row of rows.slice(0, IMPERSONATION_SESSION_LIMIT)) {
      const tenant = await ctx.db.get(row.tenantId);
      sessions.push({
        id: row._id as string,
        tenantId: row.tenantId as string,
        tenantName: tenant?.name ?? "(tenant dihapus)",
        reason: row.reason,
        status: impersonationStatus(row, now),
        startedAt: row.startedAt,
        expiresAt: row.expiresAt,
        endedAt: row.endedAt ?? null,
        closedBy: row.closedBy ?? null,
        helpCount: row.helpCount,
        durationMinutes: impersonationDurationMinutes(row, now),
        remainingMs: impersonationRemainingMs(row, now),
      });
    }

    return {
      sessions,
      summary: summariseImpersonations(rows, now),
      limits: {
        maxActive: IMPERSONATION_MAX_ACTIVE,
        maxMinutes: IMPERSONATION_MAX_MINUTES,
        defaultMinutes: IMPERSONATION_DEFAULT_MINUTES,
      },
    };
  },
});

/**
 * Jejak pendampingan **untuk tenant yang dibantu** — kanal baca kedua setelah
 * baris audit itu sendiri.
 *
 * Gerbangnya izin tenant biasa (`team.manage`, yaitu pemilik/manajer), bukan akun
 * platform: yang membaca di sini adalah tenant-nya, dan yang ia baca adalah
 * kunjungan ke datanya sendiri. Pemilik/manajer yang tahu berarti tenant punya
 * jalan untuk mengawasi, bukan sekadar percaya.
 */
export const impersonationTrail = query({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "team.manage");

    const limit = Math.min(
      Math.max(1, Math.floor(args.limit ?? IMPERSONATION_TRAIL_LIMIT)),
      IMPERSONATION_TRAIL_LIMIT,
    );
    // Ambil lebih banyak dari yang diminta karena penyaring jejak membuang baris
    // audit non-platform; sisanya dipotong oleh aturan murni.
    const auditRows = await ctx.db
      .query("auditLogs")
      .withIndex("by_tenant_created", (q) => q.eq("tenantId", args.tenantId))
      .order("desc")
      .take(limit * 3);

    const rows = buildImpersonationTrail(
      auditRows.map((row) => ({
        action: row.action,
        entity: row.entity,
        entityId: row.entityId ?? null,
        meta: row.meta ?? null,
        createdAt: row.createdAt,
      })),
      limit,
    );

    return {
      rows,
      activeCount: rows.filter((row) => row.kind === "started").length,
      scanned: auditRows.length,
    };
  },
});

/**
 * Menutup sesi yang **waktunya sudah lewat** supaya jejaknya berakhir rapi.
 *
 * Ini bukan penjaga pintu — pintunya dijaga `impersonationStatus` saat dibaca —
 * melainkan perapian: baris yang masih tertulis `active` padahal sudah mati
 * ditutup, dan tenant menerima baris audit terakhirnya (“kedaluwarsa setelah N
 * menit”), sehingga tidak ada sesi yang menggantung tanpa akhir yang jelas.
 */
export const sweepExpiredImpersonations = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.min(
      Math.max(1, Math.floor(args.limit ?? IMPERSONATION_SWEEP_BATCH)),
      IMPERSONATION_SWEEP_BATCH,
    );

    const rows = await ctx.db
      .query("impersonationSessions")
      .withIndex("by_status_expires", (q) =>
        q.eq("status", "active").lte("expiresAt", now),
      )
      .take(limit);

    let closed = 0;
    const tenantIds: string[] = [];

    for (const session of rows) {
      const actor = await ctx.db.get(session.actorId);
      const tenant = await ctx.db.get(session.tenantId);

      await ctx.db.patch(session._id, {
        status: "ended",
        endedAt: now,
        closedBy: "sweeper",
      });
      closed += 1;

      // Akun yang sudah dicabut penandanya tidak lagi punya label platform, jadi
      // barisnya tetap ditulis dengan nama apa adanya — jejaknya tidak boleh
      // hilang hanya karena penandanya dicabut belakangan.
      if (tenant) {
        tenantIds.push(tenant._id as string);
        const closed_ = impersonationClosedAudit({
          account: accountOf(
            actor ?? { name: "(akun dihapus)", email: "(akun dihapus)", platformRole: null },
          ),
          session: { ...session, status: "ended", endedAt: now },
          sessionId: session._id as string,
          now,
          closedBy: "sweeper",
        });
        await writeAuditLog(ctx, {
          tenantId: tenant._id,
          actorId: actor?._id,
          action: closed_.action,
          entity: closed_.entity,
          entityId: closed_.entityId,
          meta: closed_.meta,
        });
      }
    }

    return {
      checked: rows.length,
      closed,
      tenants: tenantIds,
      at: now,
    };
  },
});


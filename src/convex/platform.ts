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

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  requireImpersonation,
  requirePermission,
  requirePlatformDeveloper,
  writeAuditLog,
} from "./lib/access";
import { allowUnverifiedActors, resolveIdentityActor } from "./lib/auth";

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
  decidePlatformAccess,
  describePlatformAccount,
  PLATFORM_ROLE_LABELS,
  visibleInTenantSurfaces,
  type PlatformRole,
} from "./lib/platform";
import {
  decideFixturePurge,
  decideFixtureUserPurge,
  decideTenantDeletion,
  isFixtureOwnerEmail,
  decideTenantSuspension,
  decideTenantUpdate,
  FIXTURE_OWNER_DOMAINS,
  normaliseTenantSearch,
  TENANT_PURGE_BATCH,
  TENANT_PURGE_SCAN,
  PLATFORM_ACTION_LIMIT,
  PLATFORM_TENANT_ACTION_LABELS,
  summariseTenantAccounts,
  TENANT_ACCOUNT_LIMIT,
  TENANT_DELETE_BATCH,
  TENANT_SEARCH_SCAN,
  TENANT_TABLES,
  USER_PURGE_BATCH,
  USER_PURGE_SCAN,
  tenantAccountMatches,
  tenantAccountStatus,
  tenantAccountSummary,
  type PlatformTenantAction,
  type TenantAccount,
} from "./lib/platformTenants";
import { PLANS, PLAN_LIST, trimVerticalsForPlan } from "./lib/billing";
import { planKeyValidator } from "./schema";

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
/**
 * Profil akun platform yang **dicari dari identitas login**, bukan dari id yang
 * dikirim klien.
 *
 * Ini jalur yang dipakai halaman backstage setelah identitasnya terverifikasi:
 * klien tidak perlu tahu id baris `users` mana pun, dan tidak ada email sesi
 * perangkat yang harus dicocokkan. `null` berarti belum ada identitas (atau
 * identitasnya bukan akun mana pun) — halaman lalu kembali ke jalur lama
 * (resolve id lewat email sesi), yang tetap berguna selama masa transisi tanpa
 * provider autentikasi.
 */
export const meByIdentity = query({
  args: {},
  handler: async (ctx) => {
    const user = await resolveIdentityActor(ctx);
    if (!user) return null;

    // Gerbang yang sama dengan `me`: penolakan berarti `null` di sini, bukan
    // lemparan — halaman menampilkan alasannya sendiri lewat jalur lama.
    const access = decidePlatformAccess({
      platformRole: user.platformRole ?? null,
      verified: true,
      allowUnverified: allowUnverifiedActors(),
    });
    if (!access.allowed) return null;

    return {
      id: user._id as string,
      actorId: user._id as string,
      name: user.name,
      email: user.email,
      role: user.platformRole as PlatformRole,
      roleLabel: PLATFORM_ROLE_LABELS[user.platformRole as PlatformRole],
      label: describePlatformAccount({
        name: user.name,
        email: user.email,
        platformRole: user.platformRole,
      }),
    };
  },
});

export const grant = internalMutation({
  args: { email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email.includes("@")) throw new ConvexError("Email tidak valid.");

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
    if (!user) throw new ConvexError("Akun dengan email itu tidak ditemukan.");
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
    if (!decision.allowed) throw new ConvexError(decision.reason);
    if (!tenant) throw new ConvexError("Tenant tujuan tidak ditemukan.");
    // Tenant yang sedang dihapus tidak bisa didampingi: datanya sedang disapu,
    // jadi ringkasan bantuannya hanya akan menampilkan sisa yang menyesatkan.
    if (tenant.deletion) {
      throw new ConvexError(
        "Akun bisnis ini sedang dihapus oleh pengelola platform, jadi sesi pendampingan tidak bisa dibuka.",
      );
    }

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

/* ------------------------------------------------------------------ *
 * Pengelolaan akun bisnis: lihat, nonaktifkan/aktifkan, hapus.
 *
 * Semua gerbangnya `requirePlatformDeveloper` — identitas login terverifikasi,
 * lebih ketat daripada permukaan tenant. Yang dilakukan di sini bukan
 * pendampingan (itu sesi berjejak di atas), melainkan tindakan atas **akun
 * bisnis** itu sendiri, jadi jejaknya ditulis ke `platformAuditLogs`: tabel milik
 * platform, bukan milik tenant yang sedang dihapus.
 * ------------------------------------------------------------------ */

/** Berapa anggota/toko/produk yang dihitung per akun (sisanya dilaporkan dipotong). */
const ACCOUNT_SAMPLE = 50;

/**
 * Satu baris akun bisnis dari baris `tenants` — identitas, keadaan, dan jumlah
 * isinya.
 *
 * Dipisah dari querynya supaya penyapu pencarian hanya membangun baris untuk akun
 * yang **benar-benar cocok**: saat mencari, 1086 akun dibaca tetapi barisnya (yang
 * masing-masing menuntut tiga hitungan per tabel) hanya dibuat untuk hasilnya.
 */
async function accountRowOf(
  ctx: QueryCtx,
  tenant: Doc<"tenants">,
  owner: Doc<"users"> | null,
): Promise<{ row: TenantAccount; countsCapped: boolean }> {
  const [membershipRows, storeRows, productRows] = await Promise.all([
    ctx.db
      .query("memberships")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
      .take(ACCOUNT_SAMPLE + 1),
    ctx.db
      .query("stores")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
      .take(ACCOUNT_SAMPLE + 1),
    ctx.db
      .query("products")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
      .take(ACCOUNT_SAMPLE + 1),
  ]);

  const countsCapped =
    membershipRows.length > ACCOUNT_SAMPLE ||
    storeRows.length > ACCOUNT_SAMPLE ||
    productRows.length > ACCOUNT_SAMPLE;

  const members = Math.min(membershipRows.length, ACCOUNT_SAMPLE);
  const stores = Math.min(storeRows.length, ACCOUNT_SAMPLE);
  const products = Math.min(productRows.length, ACCOUNT_SAMPLE);
  const suspendedAt = tenant.platformSuspended?.at ?? null;
  const deleting = tenant.deletion !== undefined;

  return {
    countsCapped,
    row: {
      id: tenant._id as string,
      name: tenant.name,
      slug: tenant.slug,
      planKey: tenant.planKey,
      status: tenant.status,
      suspendedAt,
      suspendedNote: tenant.platformSuspended?.note ?? null,
      suspendLabel:
        suspendedAt === null
          ? null
          : `sejak ${new Date(suspendedAt).toLocaleDateString("id-ID")}`,
      deleting,
      ownerName: owner?.name ?? "(akun pemilik tidak ditemukan)",
      ownerEmail: owner?.email ?? "",
      members,
      activeMembers: membershipRows.slice(0, members).filter((row) => row.active).length,
      stores,
      products,
      createdAt: tenant.createdAt,
      accountStatus: tenantAccountStatus({ suspendedAt, deleting }),
      summary: tenantAccountSummary({
        name: tenant.name,
        planKey: tenant.planKey,
        suspendedAt,
        deleting,
        members,
        stores,
      }),
    },
  };
}

/**
 * Daftar akun bisnis untuk halaman backstage.
 *
 * Isinya identitas & keadaan akun — bukan data operasional: nama, slug, pemilik,
 * paket, status langganan, penonaktifan, dan jumlah isinya. Jumlah anggota/toko/
 * produk dihitung dengan sampel `ACCOUNT_SAMPLE` baris, dan kolom `countsCapped`
 * mengatakan apa adanya kalau ada yang lebih besar dari sampel itu.
 *
 * **Tanpa kata kunci**: yang dibaca `limit` akun terbaru (bawaan 100) — murah dan
 * itu memang yang ditampilkan.
 *
 * **Dengan kata kunci**: penyapuannya **tidak** terbatas pada 100 baris yang
 * tampil. Sebelum ini, pencarian hanya menyaring akun yang kebetulan sudah dibaca,
 * sehingga mencari bisnis lama (mis. akun ke-1000 dari 1086) selalu dijawab “tidak
 * ada yang cocok” — padahal akunnya ada. Sekarang daftarnya dibaca sampai
 * `TENANT_SEARCH_SCAN` akun terbaru dalam satu kali sapuan, dan yang dikembalikan
 * hanya akun yang cocok (maksimum `limit`). Kalau batas itu yang menghentikan,
 * `scanCapped: true` — halaman menyebutnya apa adanya alih-alih berpura-pura
 * “tidak ada”.
 *
 * Sapuannya sengaja **satu kali baca**, bukan `paginate()` berulang: Convex hanya
 * mengizinkan satu query berhalaman per fungsi (“This query or mutation function
 * ran multiple paginated queries”), dan batas itu ditemukan justru saat rilis ini
 * diuji ke deployment.
 */
export const tenantAccounts = query({
  args: {
    actorId: v.id("users"),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePlatformDeveloper(ctx, args.actorId);

    const limit = Math.min(
      Math.max(1, Math.floor(args.limit ?? TENANT_ACCOUNT_LIMIT)),
      TENANT_ACCOUNT_LIMIT,
    );
    const needle = normaliseTenantSearch(args.search);
    const searching = needle.length > 0;

    // Satu kali baca: tanpa kata kunci cukup sebatas yang tampil, saat mencari
    // dibaca sampai batas penyapuan (lihat catatan “satu kali baca” di atas).
    const scanCap = searching ? TENANT_SEARCH_SCAN : limit;
    const tenantRows = await ctx.db.query("tenants").order("desc").take(scanCap);
    const scanned = tenantRows.length;
    // Batas yang tercapai berarti masih ada akun di luar yang diperiksa.
    const scanCapped = searching && scanned >= TENANT_SEARCH_SCAN;

    const rows: TenantAccount[] = [];
    let countsCapped = false;

    for (const tenant of tenantRows) {
      const owner = await ctx.db.get(tenant.ownerId);
      if (
        searching &&
        !tenantAccountMatches(
          {
            name: tenant.name,
            slug: tenant.slug,
            planKey: tenant.planKey,
            ownerEmail: owner?.email ?? "",
          },
          needle,
        )
      ) {
        continue;
      }

      const built = await accountRowOf(ctx, tenant, owner);
      countsCapped = countsCapped || built.countsCapped;
      rows.push(built.row);
      if (rows.length >= limit) break;
    }

    return {
      rows,
      summary: summariseTenantAccounts(rows),
      limit,
      /** Kata kunci yang benar-benar dipakai (kosong = daftar biasa). */
      search: needle,
      /** Berapa akun yang diperiksa — bukan berapa yang tampil. */
      scanned,
      /** Hasilnya penuh (atau sapuannya terbatas) sehingga masih ada yang lain. */
      truncated: searching ? rows.length >= limit || scanCapped : scanned >= limit,
      scanCapped,
      countsCapped,
    };
  },
});

/**
 * Menonaktifkan atau mengaktifkan kembali sebuah akun bisnis.
 *
 * Penonaktifan **tidak** menyentuh `status` langganan (lihat `platformSuspended`
 * di skema): yang berubah hanya `platformSuspended`, sehingga penjualan baru
 * berhenti dan mengaktifkannya kembali tidak menebak keadaan billing yang lama.
 * Setiap tindakan ditulis ke `platformAuditLogs` beserta catatan pengelolanya.
 */
export const setTenantSuspended = mutation({
  args: {
    actorId: v.id("users"),
    tenantId: v.id("tenants"),
    suspended: v.boolean(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requirePlatformDeveloper(ctx, args.actorId);
    const tenant = await ctx.db.get(args.tenantId);

    const decision = decideTenantSuspension({
      tenantExists: tenant !== null,
      ownsTenant: tenant !== null && tenant.ownerId === user._id,
      deleting: tenant?.deletion !== undefined,
      suspended: args.suspended,
      note: args.note,
    });
    if (!decision.allowed) throw new ConvexError(decision.reason);
    if (!tenant) throw new ConvexError("Akun bisnis itu tidak ditemukan.");

    const now = Date.now();
    await ctx.db.patch(tenant._id, {
      platformSuspended: args.suspended
        ? { at: now, by: user._id, note: decision.note }
        : undefined,
    });
    await ctx.db.insert("platformAuditLogs", {
      actorId: user._id,
      actorEmail: user.email,
      action: args.suspended ? "suspend" : "activate",
      tenantId: tenant._id as string,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      note: decision.note,
      at: now,
    });

    return {
      tenantId: tenant._id as string,
      tenantName: tenant.name,
      suspended: args.suspended,
      note: decision.note ?? null,
      at: now,
      summary: `${tenant.name} ${args.suspended ? "dinonaktifkan" : "diaktifkan kembali"}.`,
    };
  },
});

/**
 * Mengubah **nama bisnis** dan/atau **paket langganan** sebuah akun bisnis.
 *
 * Sengaja hanya dua kolom itu. Slug dipakai untuk masuk & alamat, dan isi
 * operasional (produk, harga, anggota) milik pemilik bisnis — bukan wewenang
 * pengelola platform. Mengganti paket memakai aturan yang sama dengan
 * `billing.changePlan` (`trimVerticalsForPlan`), jadi modul yang tidak ada di
 * paket baru ikut mati alih-alih menyala di luar paket; status langganan tidak
 * disentuh, sama seperti penonaktifan.
 *
 * Perubahannya tercatat di dua tempat: `platformAuditLogs` (riwayat pengelola,
 * tetap ada walau tenant dihapus) dan `auditLogs` milik tenant (pemilik bisnis
 * berhak tahu nama/paketnya diubah dan oleh siapa).
 */
export const updateTenant = mutation({
  args: {
    actorId: v.id("users"),
    tenantId: v.id("tenants"),
    name: v.optional(v.string()),
    planKey: v.optional(planKeyValidator),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requirePlatformDeveloper(ctx, args.actorId);
    const tenant = await ctx.db.get(args.tenantId);

    const decision = decideTenantUpdate({
      tenantExists: tenant !== null,
      deleting: tenant?.deletion !== undefined,
      name: args.name ?? null,
      planKey: args.planKey ?? null,
      planKeys: PLAN_LIST.map((plan) => plan.key),
      note: args.note,
    });
    if (!decision.allowed) throw new ConvexError(decision.reason);
    if (!tenant) throw new ConvexError("Akun bisnis itu tidak ditemukan.");

    const now = Date.now();
    const changes: string[] = [];

    if (decision.name !== null && decision.name !== tenant.name) {
      changes.push(`nama "${tenant.name}" → "${decision.name}"`);
      await ctx.db.patch(tenant._id, { name: decision.name });
    }

    if (decision.planKey !== null && decision.planKey !== tenant.planKey) {
      const plan = PLANS[decision.planKey];
      const nextVerticals = trimVerticalsForPlan(plan.key, tenant.verticals);
      changes.push(`paket ${tenant.planKey} → ${plan.key}`);
      await ctx.db.patch(tenant._id, {
        planKey: plan.key,
        planVersion: plan.version,
        verticals: nextVerticals,
      });
    }

    if (changes.length === 0) {
      return {
        changed: false,
        tenantId: tenant._id as string,
        tenantName: tenant.name,
        planKey: tenant.planKey as string,
        detail: "Tidak ada yang berubah.",
        summary: `${tenant.name} tidak berubah: isinya sudah sama.`,
      };
    }

    const detail = changes.join("; ");
    const nextName = decision.name ?? tenant.name;
    const nextPlanKey = decision.planKey ?? tenant.planKey;

    await writeAuditLog(ctx, {
      tenantId: tenant._id,
      actorId: user._id,
      action: "platform.tenantUpdate",
      entity: "tenants",
      entityId: tenant._id as string,
      meta: {
        by: user.email,
        before: { name: tenant.name, planKey: tenant.planKey },
        after: { name: nextName, planKey: nextPlanKey },
        note: decision.note ?? null,
      },
    });

    await ctx.db.insert("platformAuditLogs", {
      actorId: user._id,
      actorEmail: user.email,
      action: "update",
      tenantId: tenant._id as string,
      tenantName: nextName,
      tenantSlug: tenant.slug,
      note: decision.note,
      detail,
      at: now,
    });

    return {
      changed: true,
      tenantId: tenant._id as string,
      tenantName: nextName,
      planKey: nextPlanKey as string,
      detail,
      summary: `${nextName} diubah: ${detail}.`,
    };
  },
});

/**
 * Membersihkan **akun uji/sampah** secara massal — jalur yang dipakai setelah
 * backstage penuh fixture dari harness (`@mesinpos.test`, `@mesinpos.id`).
 *
 * Kenapa **internalMutation**: ini alat pemeliharaan deployment, bukan tombol
 * sehari-hari di halaman; hanya akses deployment (`bunx convex run`) yang bisa
 * memanggilnya. Jejaknya tetap ditulis ke `platformAuditLogs` atas nama
 * `actorId` — pengembang platform yang benar-benar menjalankannya.
 *
 * Kenapa **tidak** memanggil `deleteTenant` berulang: jalur itu menerima id satu
 * per satu dari klien dan menuntut slug diketik, jadi seribu akun berarti seribu
 * panggilan. Di sini yang dipilih adalah **aturan**, bukan daftar id: akun yang
 * pemiliknya berdomain uji (`decideFixturePurge`) ditandai lalu dijadwalkan ke
 * pekerja `deleteTenantChunk` yang sama — penghapusan per tabel, batch 200 baris,
 * progres tersimpan di baris tenant.
 *
 * Penjagaan yang membuat ini tidak berbahaya bagi pendaftar nyata:
 *
 * - **Domain saja tidak cukup.** Akun yang sedang dihapus dilewati, dan workspace
 *   milik pengelola sendiri **tidak pernah** ikut walau domainnya sama.
 * - **Yang tidak jelas disisakan.** Email kosong, domain lain, atau subdomain
 *   `mesinpos.test` bukan target; hasilnya dilaporkan, bukan ditebak.
 * - **Bertahap & bisa berhenti sendiri.** Satu kali jalan menandai `batch` akun
 *   (bawaan 200) lalu menjadwalkan dirinya lagi **hanya kalau masih menemukan**
 *   kandidat; kalau sudah tidak ada, rangkaiannya berhenti dengan sendirinya.
 * - **`dryRun`** melaporkan siapa yang akan kena tanpa menandai apa pun.
 */
export const purgeFixtureTenants = internalMutation({
  args: {
    actorId: v.id("users"),
    batch: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    domains: v.optional(v.array(v.string())),
    /**
     * Mode cron: yang dilindungi adalah workspace **pengelola sungguhan**
     * (platform developer beremail non-uji), bukan hanya milik aktor.
     *
     * Mode CLI biasa melindungi “workspace pengelola sendiri” karena aktornya
     * manusia yang mengetik perintah. Cron tidak punya manusia, jadi kalau
     * aktornya kebetulan akun developer **uji** (dibuat harness), melindungi
     * “milik aktor” justru menyisakan workspace `dev-*` buatan harness itu
     * sendiri. Di mode ini perlindungannya dipindah ke pemilik yang benar-benar
     * pengelola: akun platform beremail non-uji.
     */
    actorless: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.actorId);
    if (!user || user.platformRole !== "developer") {
      throw new ConvexError("Aktor bukan pengembang platform.");
    }

    const domains = args.domains ?? [...FIXTURE_OWNER_DOMAINS];
    const batch = Math.min(
      Math.max(1, Math.floor(args.batch ?? TENANT_PURGE_BATCH)),
      TENANT_PURGE_SCAN,
    );
    const tenantRows = await ctx.db
      .query("tenants")
      .order("desc")
      .take(TENANT_PURGE_SCAN);

    const targets: { id: Id<"tenants">; name: string; slug: string; email: string }[] = [];
    let skipped = 0;
    for (const tenant of tenantRows) {
      const owner = await ctx.db.get(tenant.ownerId);
      const decision = decideFixturePurge({
        tenantExists: true,
        deleting: tenant.deletion !== undefined,
        ownsTenant: args.actorless
          ? Boolean(owner?.platformRole) && !isFixtureOwnerEmail(owner?.email, domains)
          : tenant.ownerId === user._id,
        ownerEmail: owner?.email ?? "",
        domains,
      });
      if (!decision.allowed) {
        // Akun yang sudah dihapus/di luar daftar domain tidak dihitung sebagai sisa.
        if (tenant.deletion === undefined) skipped += 1;
        continue;
      }
      targets.push({
        id: tenant._id,
        name: tenant.name,
        slug: tenant.slug,
        email: owner?.email ?? "",
      });
      if (targets.length >= batch) break;
    }

    if (args.dryRun) {
      return {
        dryRun: true,
        scanned: tenantRows.length,
        skipped,
        targets: targets.length,
        names: targets.slice(0, 20).map((row) => `${row.slug} · ${row.email}`),
        domains,
      };
    }

    const now = Date.now();
    for (const target of targets) {
      // Sesi pendampingan yang masih hidup ditutup lebih dulu, sama seperti
      // penghapusan satu akun: tenant yang sedang disapu tidak boleh didampingi.
      const liveSessions = await ctx.db
        .query("impersonationSessions")
        .withIndex("by_tenant", (q) => q.eq("tenantId", target.id))
        .take(IMPERSONATION_SESSION_LIMIT);
      for (const session of liveSessions) {
        if (session.status !== "active") continue;
        await ctx.db.patch(session._id, {
          status: "ended",
          endedAt: now,
          closedBy: "platform-purge",
        });
      }

      await ctx.db.patch(target.id, {
        platformSuspended: {
          at: now,
          by: user._id,
          note: "Akun sedang dihapus oleh pembersihan akun uji.",
        },
        deletion: {
          startedAt: now,
          by: user._id,
          note: `bersih-bersih akun uji (${target.email})`,
          table: 0,
        },
      });
      await ctx.db.insert("platformAuditLogs", {
        actorId: user._id,
        actorEmail: user.email,
        action: "delete",
        tenantId: target.id as string,
        tenantName: target.name,
        tenantSlug: target.slug,
        note: `bersih-bersih akun uji (${target.email})`,
        at: now,
      });
      await ctx.scheduler.runAfter(0, internal.platform.deleteTenantChunk, {
        tenantId: target.id,
        table: 0,
      });
    }

    // Masih ada kandidat lain? Ulangi sekali lagi nanti — akun yang baru ditandai
    // otomatis dilewati karena `deletion`-nya sudah terisi.
    //
    // Jeda 60 detik, bukan 2 detik: mutation ini **membaca** banyak baris `tenants`
    // sekaligus, sementara pekerja `deleteTenantChunk` dari gelombang sebelumnya
    // masih menulis ke baris-baris itu (progres `deletion.table`). Convex memakai
    // kendali konkurensi optimistik: kalau baris yang dibaca berubah, mutation-nya
    // diulang dan gagal setelah beberapa percobaan
    // (“OptimisticConcurrencyControlFailure” — pernah terjadi saat jedanya 2 detik).
    // Jeda yang lebih panjang memberi antrean sebelumnya waktu mengering.
    const lanjut = targets.length >= batch;
    if (lanjut) {
      await ctx.scheduler.runAfter(60_000, internal.platform.purgeFixtureTenants, args);
    }

    return {
      dryRun: false,
      scanned: tenantRows.length,
      skipped,
      purged: targets.length,
      remainingScan: lanjut,
      domains,
      samples: targets.slice(0, 5).map((row) => row.slug),
    };
  },
});

/**
 * Pembersihan akun uji **otomatis** — dipanggil cron, tanpa aktor dari CLI.
 *
 * `purgeFixtureTenants` menuntut `actorId` pengembang platform supaya setiap
 * penghapusan punya jejak orang. Cron tidak punya aktor, jadi ia mencari pemilik
 * platform yang terdaftar di deployment ini lalu menjalankannya atas namanya —
 * jejak audit tetap menunjuk akun sungguhan, bukan “sistem” yang tidak bisa
 * ditanyai. Kalau deployment belum punya akun pengembang (mis. instalasi baru),
 * pembersihan dilewati tanpa melempar galat: cron harian tidak boleh berisik
 * hanya karena belum ada yang bisa dicatat sebagai pelakunya.
 */
export const purgeFixtureTenantsAuto = internalMutation({
  args: { batch: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const developers = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("platformRole"), "developer"))
      .take(20);
    // Utamakan pengelola sungguhan supaya jejak audit menunjuk orang yang bisa
    // ditanya; akun developer buatan harness hanya cadangan.
    const developer =
      developers.find((row) => !isFixtureOwnerEmail(row.email)) ?? developers[0];
    if (!developer) {
      return {
        ran: false,
        reason: "Belum ada akun pengembang platform; pembersihan akun uji dilewati.",
      };
    }

    await ctx.runMutation(internal.platform.purgeFixtureTenants, {
      actorId: developer._id,
      batch: args.batch,
      actorless: true,
    });
    return { ran: true, actorEmail: developer.email };
  },
});

/**
 * Menghapus **baris akun pengguna** uji yang sudah tidak menempel di mana pun.
 *
 * Akun bisnis uji yang disapu meninggalkan baris `users` — pemilik dan anggota
 * undangan — plus sesi login serta kode OTP-nya. Baris-baris itu tidak muncul di
 * daftar akun bisnis, tetapi tetap memenuhi tabel setiap kali harness berjalan.
 * Pekerja ini menghapusnya **hanya** kalau sudah benar-benar yatim: bukan akun
 * platform, tidak memiliki tenant, dan tidak tercatat sebagai anggota workspace
 * mana pun (aturan murni `decideFixtureUserPurge`). Yang belum yatim dibiarkan
 * untuk putaran berikutnya, karena penghapusan tenant berjalan bertahap.
 *
 * Urutan hapusnya penting: sesi & token dulu, lalu akun auth, lalu kode OTP,
 * terakhir baris `users` — supaya tidak ada token yang masih menunjuk sesi yang
 * sudah hilang.
 */
export const purgeFixtureUsers = internalMutation({
  args: {
    batch: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    domains: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const domains = args.domains ?? [...FIXTURE_OWNER_DOMAINS];
    const batch = Math.min(
      Math.max(1, Math.floor(args.batch ?? USER_PURGE_BATCH)),
      USER_PURGE_SCAN,
    );
    const userRows = await ctx.db.query("users").order("desc").take(USER_PURGE_SCAN);
    // Pengembang beremail non-uji = jalan masuk backstage yang harus tersisa;
    // selama satu saja ada, akun developer uji boleh ikut disapu.
    const otherOperator = userRows.some(
      (user) => Boolean(user.platformRole) && !isFixtureOwnerEmail(user.email, domains),
    );

    const targets: Doc<"users">[] = [];
    let skipped = 0;
    for (const user of userRows) {
      const owned = await ctx.db
        .query("tenants")
        .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
        .first();
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();
      const decision = decideFixtureUserPurge({
        platformRole: user.platformRole,
        ownsTenant: owned !== null,
        memberOf: membership !== null,
        email: user.email,
        otherOperator,
        domains,
      });
      if (!decision.allowed) {
        skipped += 1;
        continue;
      }
      targets.push(user);
      if (targets.length >= batch) break;
    }

    if (args.dryRun) {
      return {
        dryRun: true,
        scanned: userRows.length,
        skipped,
        targets: targets.length,
        names: targets.slice(0, 20).map((user) => user.email),
        domains,
      };
    }

    for (const user of targets) {
      const sessions = await ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", user._id))
        .collect();
      for (const session of sessions) {
        const tokens = await ctx.db
          .query("authRefreshTokens")
          .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
          .collect();
        for (const token of tokens) await ctx.db.delete(token._id);
        await ctx.db.delete(session._id);
      }

      const accounts = await ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) => q.eq("userId", user._id))
        .collect();
      for (const account of accounts) {
        const codes = await ctx.db
          .query("authVerificationCodes")
          .withIndex("accountId", (q) => q.eq("accountId", account._id))
          .collect();
        for (const code of codes) await ctx.db.delete(code._id);
        await ctx.db.delete(account._id);
      }

      const otps = await ctx.db
        .query("emailOtps")
        .withIndex("by_email", (q) => q.eq("email", user.email))
        .collect();
      for (const otp of otps) await ctx.db.delete(otp._id);

      await ctx.db.delete(user._id);
    }

    // Masih ada kandidat di luar batas? Ulangi nanti — akun yang baru saja
    // kehilangan tenant-nya baru terlihat yatim pada putaran berikutnya.
    if (targets.length >= batch) {
      await ctx.scheduler.runAfter(60_000, internal.platform.purgeFixtureUsers, args);
    }

    return {
      dryRun: false,
      scanned: userRows.length,
      skipped,
      purged: targets.length,
      remainingScan: targets.length >= batch,
      domains,
      samples: targets.slice(0, 5).map((user) => user.email),
    };
  },
});

/**
 * Menghapus satu akun bisnis **beserta seluruh isinya**.
 *
 * Penghapusan dilakukan bertahap karena satu mutation tidak boleh menyapu ribuan
 * baris sekaligus: di sini baris tenant ditandai `deletion`, sesi pendampingan
 * yang masih hidup ditutup, tindakannya dicatat di `platformAuditLogs`, lalu
 * pekerja `deleteTenantChunk` menyapu tabel milik tenant satu per satu sampai
 * baris tenant itu sendiri hilang.
 *
 * Akun **pengguna** tidak ikut dihapus: orangnya bisa saja masih memakai akun
 * yang sama di workspace lain, dan kehilangan akun login bukan bagian dari
 * “menghapus akun bisnis”.
 */
export const deleteTenant = mutation({
  args: {
    actorId: v.id("users"),
    tenantId: v.id("tenants"),
    confirmSlug: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requirePlatformDeveloper(ctx, args.actorId);
    const tenant = await ctx.db.get(args.tenantId);

    const decision = decideTenantDeletion({
      tenantExists: tenant !== null,
      ownsTenant: tenant !== null && tenant.ownerId === user._id,
      deleting: tenant?.deletion !== undefined,
      slug: tenant?.slug ?? "",
      typedSlug: args.confirmSlug,
      note: args.note,
    });
    if (!decision.allowed) throw new ConvexError(decision.reason);
    if (!tenant) throw new ConvexError("Akun bisnis itu tidak ditemukan.");

    const now = Date.now();

    // Sesi pendampingan yang masih hidup ditutup lebih dulu: tenant yang sedang
    // dihapus tidak boleh lagi dibantu lewat sesi yang dibuka sebelum ini.
    const liveSessions = await ctx.db
      .query("impersonationSessions")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
      .take(IMPERSONATION_SESSION_LIMIT);
    for (const session of liveSessions) {
      if (session.status !== "active") continue;
      await ctx.db.patch(session._id, {
        status: "ended",
        endedAt: now,
        closedBy: "platform-delete",
      });
    }

    await ctx.db.patch(tenant._id, {
      // Akun yang sedang dihapus tidak boleh menerima transaksi baru lagi.
      platformSuspended: {
        at: now,
        by: user._id,
        note: "Akun sedang dihapus oleh pengelola platform.",
      },
      deletion: { startedAt: now, by: user._id, note: decision.note, table: 0 },
    });
    await ctx.db.insert("platformAuditLogs", {
      actorId: user._id,
      actorEmail: user.email,
      action: "delete",
      tenantId: tenant._id as string,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      note: decision.note,
      at: now,
    });

    await ctx.scheduler.runAfter(0, internal.platform.deleteTenantChunk, {
      tenantId: tenant._id,
      table: 0,
    });

    return {
      tenantId: tenant._id as string,
      tenantName: tenant.name,
      tables: TENANT_TABLES.length,
      closedSessions: liveSessions.filter((row) => row.status === "active").length,
      at: now,
      summary: `${tenant.name} dijadwalkan dihapus. Isinya disapu bertahap; baris akun bisnisnya hilang paling akhir.`,
    };
  },
});

/**
 * Menyapu isi satu tenant: tabel demi tabel, `TENANT_DELETE_BATCH` baris sekali
 * jalan, sampai tabel terakhir bersih — lalu baris tenant + berkas logonya dihapus.
 *
 * Setiap panggilan **melompati tabel yang kosong** dalam satu kali eksekusi
 * (bukan satu langkah terjadwal per tabel). Aturan itu lahir dari pembersihan
 * massal: 1096 akun uji × 38 tabel berarti ~41 ribu pekerjaan terjadwal, padahal
 * hampir semua tabel akun uji kosong — antrenya berjalan berjam-jam kalau setiap
 * tabel kosong menuntut satu langkah. Sekarang yang menuntut langkah tambahan
 * hanya tabel yang **benar-benar berisi**, dan total baris yang dihapus per
 * panggilan tetap dibatasi `TENANT_DELETE_BATCH`, jadi tidak ada satu mutation
 * yang menyapu ribuan baris.
 *
 * Progresnya disimpan di baris tenant (`deletion.table`), jadi pekerjaan tetap
 * bisa dilanjutkan walau deployment sempat berhenti di tengah.
 */
export const deleteTenantChunk = internalMutation({
  args: { tenantId: v.id("tenants"), table: v.number() },
  handler: async (ctx, args) => {
    const tenant = await ctx.db.get(args.tenantId);
    if (!tenant) return { done: true, table: args.table, deleted: 0 };

    let step = Math.max(
      Math.min(args.table, TENANT_TABLES.length),
      tenant.deletion?.table ?? 0,
    );
    let deleted = 0;

    // Satu lompatan = satu tabel yang diperiksa/dibersihkan. Batas lompatannya
    // jumlah tabel itu sendiri (tidak mungkin lebih jauh dari itu).
    for (let hop = 0; hop < TENANT_TABLES.length && step < TENANT_TABLES.length; hop += 1) {
      const rows = await drainTenantTable(ctx, step, tenant._id);
      deleted += rows;
      if (rows >= TENANT_DELETE_BATCH) {
        // Tabel ini masih bersisa — panggilan berikutnya melanjutkan tabel yang sama.
        break;
      }
      step += 1;
      if (deleted >= TENANT_DELETE_BATCH) break;
    }

    if (step >= TENANT_TABLES.length) {
      if (tenant.logo) await ctx.storage.delete(tenant.logo);
      await ctx.db.delete(tenant._id);
      return { done: true, table: step, deleted };
    }

    await ctx.db.patch(tenant._id, {
      deletion: {
        startedAt: tenant.deletion?.startedAt ?? Date.now(),
        by: tenant.deletion?.by ?? tenant.ownerId,
        note: tenant.deletion?.note,
        table: step,
      },
    });
    await ctx.scheduler.runAfter(0, internal.platform.deleteTenantChunk, {
      tenantId: tenant._id,
      table: step,
    });

    return { done: false, table: step, deleted };
  },
});

/**
 * Menghapus satu batch dari tabel ke-`step`. Ditulis sebagai `switch` eksplisit,
 * bukan nama tabel dinamis, supaya nama tabel & indeksnya type-checked: tabel
 * baru yang ditambahkan ke `TENANT_TABLES` tanpa cabang di sini akan gagal
 * dikompilasi, bukan diam-diam meninggalkan baris yatim.
 */
async function drainTenantTable(
  ctx: MutationCtx,
  step: number,
  tenantId: Id<"tenants">,
): Promise<number> {
  switch (step) {
    case 0: {
      const rows = await ctx.db
        .query("memberships")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 1: {
      const rows = await ctx.db
        .query("apiKeys")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 2: {
      const rows = await ctx.db
        .query("webhookEndpoints")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 3: {
      const rows = await ctx.db
        .query("webhookDeliveries")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 4: {
      const rows = await ctx.db
        .query("customRoles")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 5: {
      const rows = await ctx.db
        .query("roleSettings")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 6: {
      const rows = await ctx.db
        .query("supportTickets")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 7: {
      const rows = await ctx.db
        .query("digitalCharges")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 8: {
      const rows = await ctx.db
        .query("syncChanges")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 9: {
      const rows = await ctx.db
        .query("stores")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 10: {
      const rows = await ctx.db
        .query("categories")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 11: {
      const rows = await ctx.db
        .query("subcategories")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 12: {
      const rows = await ctx.db
        .query("tables")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 13: {
      const rows = await ctx.db
        .query("mejaOrders")
        .withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 14: {
      const rows = await ctx.db
        .query("products")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 15: {
      const rows = await ctx.db
        .query("customers")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 16: {
      const rows = await ctx.db
        .query("members")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 17: {
      const rows = await ctx.db
        .query("receivables")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 18: {
      const rows = await ctx.db
        .query("receivablePayments")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 19: {
      const rows = await ctx.db
        .query("warehouses")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 20: {
      const rows = await ctx.db
        .query("suppliers")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 21: {
      const rows = await ctx.db
        .query("purchaseRequisitions")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 22: {
      const rows = await ctx.db
        .query("purchaseOrders")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 23: {
      const rows = await ctx.db
        .query("goodsReceipts")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 24: {
      const rows = await ctx.db
        .query("opnameSessions")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 25: {
      const rows = await ctx.db
        .query("payables")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 26: {
      const rows = await ctx.db
        .query("payablePayments")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 27: {
      const rows = await ctx.db
        .query("stockLevels")
        .withIndex("by_tenant_store", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 28: {
      const rows = await ctx.db
        .query("stockMovements")
        .withIndex("by_tenant_created", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 29: {
      const rows = await ctx.db
        .query("shifts")
        .withIndex("by_tenant_store", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 30: {
      const rows = await ctx.db
        .query("shiftAlerts")
        .withIndex("by_tenant_kind_day", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 31: {
      const rows = await ctx.db
        .query("sales")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 32: {
      const rows = await ctx.db
        .query("saleItems")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 33: {
      const rows = await ctx.db
        .query("devices")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 34: {
      const rows = await ctx.db
        .query("subscriptionInvoices")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 35: {
      const rows = await ctx.db
        .query("auditLogs")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 36: {
      const rows = await ctx.db
        .query("impersonationSessions")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    case 37: {
      const rows = await ctx.db
        .query("counters")
        .withIndex("by_tenant_key", (q) => q.eq("tenantId", tenantId))
        .take(TENANT_DELETE_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      return rows.length;
    }
    default:
      return 0;
  }
}

/** Riwayat tindakan pengelola platform — termasuk terhadap tenant yang sudah dihapus. */
export const platformActions = query({
  args: { actorId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requirePlatformDeveloper(ctx, args.actorId);
    const limit = Math.min(
      Math.max(1, Math.floor(args.limit ?? PLATFORM_ACTION_LIMIT)),
      PLATFORM_ACTION_LIMIT,
    );
    const rows = await ctx.db
      .query("platformAuditLogs")
      .withIndex("by_at")
      .order("desc")
      .take(limit);
    return {
      rows: rows.map((row) => ({
        id: row._id as string,
        action: row.action as PlatformTenantAction,
        actionLabel: PLATFORM_TENANT_ACTION_LABELS[row.action],
        tenantId: row.tenantId,
        tenantName: row.tenantName,
        tenantSlug: row.tenantSlug,
        actorEmail: row.actorEmail,
        note: row.note ?? null,
        detail: row.detail ?? null,
        at: row.at,
      })),
      limit,
    };
  },
});


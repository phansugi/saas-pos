import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  evaluateAccess,
  entitlementFor,
  FEATURE_LABELS,
  featureOwner,
  isFeatureEnabled,
  VERTICAL_LABELS,
  type AccessDecision,
  type EntitlementSnapshot,
  type FeatureKey,
} from "./billing/index";
import { allowUnverifiedActors, verifyActor } from "./auth";
import { impersonationStatus } from "./impersonation";
import { decidePlatformAccess } from "./platform";
import { sanitizePermissions } from "./rbac";
import { rolePermissions } from "./roleSettings";
import { type Permission } from "./authz";
import { enqueueWebhookEvent } from "./webhookOutbox";
import { stockChangedEventData } from "./webhookEvents";

/**
 * Convex enforces no row-level security, so EVERY tenant-scoped function must
 * go through these helpers — reads included. They centralise:
 *   - verifying the claimed actor against the platform identity,
 *   - loading a tenant and validating membership,
 *   - resolving entitlements from the plan catalog,
 *   - evaluating the subscription access mode.
 *
 * `requireMembership` is the isolation boundary: it both proves who is calling
 * and proves they belong to the tenant. Anything that reads or writes tenant
 * data must reach it (directly, or via `requirePermission`).
 */

type Ctx = QueryCtx | MutationCtx;

export async function getTenantOrThrow(
  ctx: Ctx,
  tenantId: Id<"tenants">,
): Promise<Doc<"tenants">> {
  const tenant = await ctx.db.get(tenantId);
  if (!tenant) throw new Error("Tenant tidak ditemukan.");
  return tenant;
}

/**
 * Ensures the caller really is `userId` and is an active member of the tenant.
 *
 * This is the single place where read isolation and the identity check live, so
 * every query and mutation that reaches it — or `requirePermission` — inherits
 * both.
 */
export async function requireMembership(
  ctx: Ctx,
  tenantId: Id<"tenants">,
  userId: Id<"users">,
): Promise<Doc<"memberships">> {
  await verifyActor(ctx, userId);

  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_tenant_user", (q) =>
      q.eq("tenantId", tenantId).eq("userId", userId),
    )
    .unique();
  if (!membership || !membership.active) {
    throw new Error("Akses ditolak: Anda bukan anggota aktif tenant ini.");
  }
  return membership;
}

/**
 * Gate **akun platform** — satu-satunya pagar yang lebih ketat daripada gate
 * tenant.
 *
 * Bedanya disengaja dan menjadi inti modelnya:
 *
 *  - `requirePermission` berangkat dari **keanggotaan tenant**. Akun platform
 *    hanya bisa punya keanggotaan di workspace yang ia dirikan sendiri, jadi
 *    seluruh permukaan tenant **orang lain** tertutup baginya tanpa penyaringan
 *    tambahan — sementara workspace-nya sendiri tetap bisa ia pakai sebagai
 *    pemilik, lengkap dengan dashboard-nya.
 *  - Di sini identitas diperiksa **lebih dulu** dan hasil `verified: false`
 *    tidak pernah diloloskan, walaupun `ALLOW_UNVERIFIED_ACTOR` masih `true`
 *    (keadaan deployment tanpa provider auth). Pasangan gate tenant boleh
 *    longgar selama transisi; akun tersembunyi tidak boleh, karena kalau boleh
 *    ia hanya berarti “akun yang bisa dipakai siapa pun yang menebak satu id”.
 *
 * Urutan itu juga menutup enumerasi akun: pemanggil anonim mendapat penolakan
 * identitas sebelum peran platformnya pernah dibaca.
 */
export async function requirePlatformDeveloper(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<Doc<"users">> {
  const decision = await verifyActor(ctx, userId);
  const user = await ctx.db.get(userId);

  const access = decidePlatformAccess({
    platformRole: user?.platformRole ?? null,
    verified: decision.verified,
    allowUnverified: allowUnverifiedActors(),
  });
  if (!access.allowed) {
    throw new Error(`Akses ditolak: ${access.reason}`);
  }

  // `allowed` hanya mungkin saat identitas terverifikasi dan pengguna ada.
  if (!user) throw new Error("Akses ditolak: akun pengguna tidak ditemukan.");
  return user;
}

/**
 * Gerbang **sesi pendampingan platform** (`lib/impersonation.ts`).
 *
 * Ini satu-satunya jalan bagi akun platform untuk menyentuh data tenant, dan
 * sengaja bukan jalan pintas: yang diperiksa bukan “apakah dia akun platform”
 * saja, melainkan apakah **sesi yang dia sebut benar-benar miliknya, masih hidup,
 * dan menunjuk tenant yang sama**. Empat penolakan yang berurutan:
 *
 *  1. identitas/platform — lewat `requirePlatformDeveloper` (lebih ketat daripada
 *     gate tenant, lihat catatan di sana),
 *  2. baris sesinya ada (id yang salah tidak pernah jadi sesi),
 *  3. sesinya **milik aktor ini** — sesi orang lain, walaupun sama-sama
 *     pengembang, ditolak; tanpa ini penebakan satu id sesi cukup untuk memakai
 *     sesi orang lain,
 *  4. sesinya masih hidup. Kedaluwarsa dihitung di sini, jadi sesi mati tidak
 *     bisa dipakai walaupun pekerja perapian belum sempat menutupnya.
 *
 * Yang **tidak** diberikan gerbang ini: izin tulis di dalam tenant. Sesi
 * pendampingan hanya membuka bacaan ringkasan bantuan; tidak ada `Permission`
 * tenant yang ikut menyala, supaya bantuan platform tidak pernah tampak seperti
 * tindakan anggota.
 */
export async function requireImpersonation(
  ctx: Ctx,
  actorId: Id<"users">,
  sessionId: Id<"impersonationSessions">,
): Promise<{
  user: Doc<"users">;
  session: Doc<"impersonationSessions">;
  tenant: Doc<"tenants">;
}> {
  const user = await requirePlatformDeveloper(ctx, actorId);

  const session = await ctx.db.get(sessionId);
  if (!session || session.source !== "platform") {
    throw new Error("Akses ditolak: sesi pendampingan tidak ditemukan.");
  }
  if (session.actorId !== user._id) {
    throw new Error("Akses ditolak: sesi pendampingan ini bukan milik Anda.");
  }

  const status = impersonationStatus(session, Date.now());
  if (status !== "active") {
    throw new Error(
      status === "expired"
        ? "Akses ditolak: sesi pendampingan sudah kedaluwarsa. Buka sesi baru dengan alasan baru."
        : "Akses ditolak: sesi pendampingan sudah ditutup.",
    );
  }

  const tenant = await ctx.db.get(session.tenantId);
  if (!tenant) throw new Error("Tenant tujuan sesi pendampingan tidak ditemukan.");

  return { user, session, tenant };
}

/** Izin efektif seorang anggota beserta peran kustom yang berlakunya. */
export interface ResolvedPermissions {
  permissions: Permission[];
  customRole: Doc<"customRoles"> | null;
  /**
   * Izin yang berlaku untuk **peran bawaan** anggota ini, sudah termasuk
   * penyesuaian workspace (`roleSettings`) — dipakai sesi klien supaya menu & rute
   * tidak menebak dari peran bawaan mentah. Kosong kalau anggota itu memakai
   * peran tambahan: tidak ada peran bawaan yang menemaninya.
   */
  rolePermissions: Permission[];
  /**
   * Keadaan peran keanggotaan ini: `bawaan` (memakai `memberships.role`),
   * `tambahan` (peran tambahan yang sah), atau `tanpa-peran` (peran tambahannya
   * hilang/nonaktif dan tidak ada peran dasar yang menggantikannya — orangnya
   * tidak punya izin sampai pemilik menugaskan peran lagi).
   */
  state: "bawaan" | "tambahan" | "tanpa-peran";
}

/**
 * Baris penyesuaian peran bawaan satu workspace (`roleSettings`).
 *
 * Ini satu-satunya cara izin peran bawaan dibaca backend: setiap gate izin
 * melewati `resolveMembershipPermissions`, jadi penyesuaian yang disimpan di sini
 * berlaku untuk seluruh permukaan tenant tanpa perlu dijaga satu per satu.
 */
export async function roleSettingFor(
  ctx: Ctx,
  tenantId: Id<"tenants">,
  role: Doc<"memberships">["role"] | null | undefined,
): Promise<Doc<"roleSettings"> | null> {
  // Tanpa peran bawaan tidak ada penyesuaian yang bisa dibaca — anggota itu
  // memakai peran tambahan, yang berdiri sendiri.
  if (!role) return null;
  return ctx.db
    .query("roleSettings")
    .withIndex("by_tenant_role", (q) =>
      q.eq("tenantId", tenantId).eq("role", role),
    )
    .unique();
}

/**
 * Resolusi izin efektif untuk satu keanggotaan (`rbac.custom`, Phase 4).
 *
 * Satu keanggotaan memakai **salah satu**:
 *
 *  1. **peran bawaan** `memberships.role`, dengan izin yang sudah disesuaikan
 *     workspace kalau ada (`roleSettings`); atau
 *  2. **peran tambahan** (`customRoleId`) yang **berdiri sendiri** — tidak ada
 *     peran dasar di baliknya, jadi izinnya persis daftar izin peran itu.
 *
 * Peran tambahan yang sudah **hilang/nonaktif/milik tenant lain** tidak dijatuhkan
 * ke peran bawaan mana pun: anggotanya `tanpa-peran` (tidak punya izin) sampai
 * pemilik menugaskan peran lagi. Itu harga dari peran yang berdiri sendiri, dan
 * halaman Tim & Peran menyebut keadaan itu apa adanya di kolom Peran.
 */
export async function resolveMembershipPermissions(
  ctx: Ctx,
  membership: Doc<"memberships">,
): Promise<ResolvedPermissions> {
  const role = membership.role ?? null;
  const setting = await roleSettingFor(ctx, membership.tenantId, role);
  const base = role ? rolePermissions(role, setting) : [];

  const customRoleId = membership.customRoleId;
  if (!customRoleId) {
    return {
      // Tanpa peran tambahan, yang berlaku adalah izin peran bawaan **setelah**
      // penyesuaian workspace (`base`) — bukan izin bawaannya yang mentah.
      permissions: base,
      customRole: null,
      rolePermissions: base,
      state: role ? "bawaan" : "tanpa-peran",
    };
  }

  const customRole = await ctx.db.get(customRoleId);
  if (
    !customRole ||
    !customRole.active ||
    customRole.tenantId !== membership.tenantId
  ) {
    /*
      Peran tambahan yang hilang/nonaktif **tidak** dijatuhkan ke peran bawaan
      mana pun untuk baris yang memang hanya memakai peran tambahan: anggotanya
      tanpa izin sampai pemilik menugaskan peran lagi. Cabang `base` di bawah
      hanya tersisa untuk baris lama (sebelum 2026-10-17) yang lolos dari
      pembersihan `members.cleanupLegacyRoles` — mis. deployment yang datanya
      dipulihkan dari cadangan lama. Baris seperti itu tidak dicabut aksesnya
      diam-diam di sini; ia memakai peran tersimpan apa adanya sampai pembersihan
      dijalankan lagi.
    */
    return {
      permissions: base,
      customRole: null,
      rolePermissions: base,
      state: role ? "bawaan" : "tanpa-peran",
    };
  }

  /*
    Peran tambahan **menggantikan**: izinnya yang berlaku, persis daftar izinnya,
    tanpa ditambah izin peran bawaan mana pun. Daftar yang rusak/kosong tidak
    menjatuhkan anggota ke peran bawaan (`base` adalah peran yang tersimpan), dan
    itu hanya terjadi pada data yang salah bentuk — penulisan peran menolaknya.
  */
  const custom = sanitizePermissions(customRole.permissions);
  return {
    permissions: custom.length > 0 ? custom : base,
    customRole,
    rolePermissions: base,
    state: "tambahan",
  };
}

/**
 * Authorization gate. The caller must be an active member AND their effective
 * permissions (peran bawaan atau peran kustom yang ditugaskan) must include the
 * permission. Convex has no row-level security, so every sensitive mutation
 * funnels through here — membership alone is not enough.
 */
export async function requirePermission(
  ctx: Ctx,
  tenantId: Id<"tenants">,
  userId: Id<"users">,
  permission: Permission,
): Promise<Doc<"memberships">> {
  const membership = await requireMembership(ctx, tenantId, userId);
  const { permissions, customRole } = await resolveMembershipPermissions(
    ctx,
    membership,
  );
  if (!permissions.includes(permission)) {
    const actor = customRole
      ? `peran kustom "${customRole.name}"`
      : membership.role
        ? `peran ${membership.role}`
        : "anggota tanpa peran";
    throw new Error(`Akses ditolak: ${actor} tidak memiliki izin ${permission}.`);
  }
  return membership;
}

export function entitlementsForTenant(
  tenant: Doc<"tenants">,
): EntitlementSnapshot {
  return entitlementFor(tenant.planKey);
}

export function accessForTenant(
  tenant: Doc<"tenants">,
  now: Date = new Date(),
): AccessDecision {
  return evaluateAccess({
    status: tenant.status,
    now,
    trialEndsAt: tenant.trialEndsAt ? new Date(tenant.trialEndsAt) : null,
    currentPeriodEnd: tenant.currentPeriodEnd
      ? new Date(tenant.currentPeriodEnd)
      : null,
    graceDays: tenant.graceDays,
  });
}

/**
 * Feature gate that also respects the vertical plug-in modules (Phase 2).
 *
 * One rule, enforced server-side: a feature owned by a module is unusable while
 * that module is off, even when the plan already includes it. The plan decides
 * what a tenant *may* activate; `tenants.verticals` decides what is live now.
 *
 * Pass `permission` when the caller also needs a role grant — the check then
 * replaces a separate `requirePermission` call instead of doubling it.
 */
export async function requireFeature(
  ctx: Ctx,
  tenantId: Id<"tenants">,
  userId: Id<"users">,
  feature: FeatureKey,
  permission?: Permission,
): Promise<Doc<"tenants">> {
  if (permission) {
    await requirePermission(ctx, tenantId, userId, permission);
  } else {
    await requireMembership(ctx, tenantId, userId);
  }

  const tenant = await getTenantOrThrow(ctx, tenantId);
  const entitlements = entitlementsForTenant(tenant);
  if (isFeatureEnabled(entitlements, tenant.verticals, feature)) return tenant;

  const owner = featureOwner(feature);
  if (owner) {
    throw new Error(
      `Fitur ${FEATURE_LABELS[feature]} memerlukan modul ${VERTICAL_LABELS[owner]} yang belum aktif.`,
    );
  }
  throw new Error(
    `Fitur ${FEATURE_LABELS[feature]} tidak termasuk paket ${entitlements.planKey}.`,
  );
}

/**
 * Guard for any write that creates a sale. Read-only / blocked tenants may
 * still settle existing bills (handled separately) but cannot start new sales.
 */
export async function requireSalesAllowed(
  ctx: Ctx,
  tenantId: Id<"tenants">,
): Promise<Doc<"tenants">> {
  const tenant = await getTenantOrThrow(ctx, tenantId);
  const access = accessForTenant(tenant);
  if (!access.canCreateSales) {
    throw new Error(`Transaksi baru diblokir: ${access.reason}`);
  }
  return tenant;
}

/** Next value of a per-tenant monotonic counter (transactional). */
export async function nextSequence(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  key: string,
): Promise<number> {
  const existing = await ctx.db
    .query("counters")
    .withIndex("by_tenant_key", (q) =>
      q.eq("tenantId", tenantId).eq("key", key),
    )
    .unique();

  if (!existing) {
    await ctx.db.insert("counters", { tenantId, key, value: 1 });
    return 1;
  }

  const next = existing.value + 1;
  await ctx.db.patch(existing._id, { value: next });
  return next;
}

export async function writeAuditLog(
  ctx: MutationCtx,
  entry: {
    tenantId: Id<"tenants">;
    actorId?: Id<"users">;
    action: string;
    entity: string;
    entityId?: string;
    meta?: unknown;
  },
): Promise<void> {
  await ctx.db.insert("auditLogs", {
    tenantId: entry.tenantId,
    actorId: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    meta: entry.meta === undefined ? undefined : JSON.stringify(entry.meta),
    createdAt: Date.now(),
  });
}

/**
 * Baris stok untuk satu (produk, toko, lokasi).
 *
 * `warehouseId` kosong = **lokasi jual toko** — bucket stok lama, tempat kasir
 * menjual. Sengaja bukan `.unique()`: sejak Phase 3 satu produk bisa punya
 * beberapa baris stok, satu per lokasi (`inventory.multiwarehouse`).
 */
export async function findStockLevel(
  ctx: Ctx,
  args: {
    productId: Id<"products">;
    storeId: Id<"stores">;
    warehouseId?: Id<"warehouses">;
  },
): Promise<Doc<"stockLevels"> | null> {
  const rows = await ctx.db
    .query("stockLevels")
    .withIndex("by_product_store", (q) =>
      q.eq("productId", args.productId).eq("storeId", args.storeId),
    )
    .collect();

  const target = args.warehouseId ?? null;
  return rows.find((row) => (row.warehouseId ?? null) === target) ?? null;
}

/**
 * Applies a signed stock delta and maintains the level + ledger atomically.
 *
 * `warehouseId` memilih lokasi: kosong = lokasi jual toko (perilaku lama), diisi
 * = gudang tambahan. Satu fungsi untuk semua lokasi supaya ledger tetap satu
 * sumber kebenaran.
 */
export async function applyStockChange(
  ctx: MutationCtx,
  args: {
    tenantId: Id<"tenants">;
    storeId: Id<"stores">;
    productId: Id<"products">;
    delta: number;
    reason: Doc<"stockMovements">["reason"];
    refType?: string;
    refId?: string;
    note?: string;
    actorId?: Id<"users">;
    allowNegative?: boolean;
    /** Lokasi stok; kosong = lokasi jual toko (`inventory.multiwarehouse`). */
    warehouseId?: Id<"warehouses">;
  },
): Promise<number> {
  const level = await findStockLevel(ctx, {
    productId: args.productId,
    storeId: args.storeId,
    warehouseId: args.warehouseId,
  });

  const current = level?.quantity ?? 0;
  const next = current + args.delta;

  if (next < 0 && !args.allowNegative) {
    throw new Error(
      `Stok tidak cukup untuk produk ${args.productId} (tersedia ${current}).`,
    );
  }

  if (level) {
    await ctx.db.patch(level._id, {
      quantity: next,
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.insert("stockLevels", {
      tenantId: args.tenantId,
      productId: args.productId,
      storeId: args.storeId,
      warehouseId: args.warehouseId,
      quantity: next,
      updatedAt: Date.now(),
    });
  }

  await ctx.db.insert("stockMovements", {
    tenantId: args.tenantId,
    productId: args.productId,
    storeId: args.storeId,
    warehouseId: args.warehouseId,
    delta: args.delta,
    balanceAfter: next,
    reason: args.reason,
    refType: args.refType,
    refId: args.refId,
    note: args.note,
    actorId: args.actorId,
    createdAt: Date.now(),
  });

  // Setiap pergerakan stok adalah kejadian yang harus terlihat oleh platform
  // mitra (`stock.changed`), bukan hanya saldo akhirnya. Diletakkan di sini —
  // bukan di tiap pemanggil — supaya penjualan, pembelian, opname, penyesuaian,
  // dan perpindahan gudang memakai bentuk kiriman yang sama persis.
  //
  // Penjadwalan pekerja **tidak** dilakukan di sini: satu mutasi bisa
  // mencatat puluhan baris, dan menjadwalkan satu putaran per baris justru
  // membuat putaran-putaran itu berebut baris antrean yang sama. Pemanggil yang
  // sudah punya beberapa event (penjualan, penerimaan barang) menjadwalkan satu
  // putaran; sisanya diambil pekerja cron dalam ≤ 1 menit.
  const product = await ctx.db.get(args.productId);
  if (product) {
    await enqueueWebhookEvent(ctx, {
      tenantId: args.tenantId,
      storeId: args.storeId,
      event: "stock.changed",
      subject: product.sku,
      data: stockChangedEventData({
        sku: product.sku,
        name: product.name,
        delta: args.delta,
        balance: next,
        reason: args.reason,
        refType: args.refType,
        refId: args.refId,
      }),
    });
  }

  return next;
}

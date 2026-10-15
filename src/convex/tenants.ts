import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
  getTenantOrThrow,
  requireMembership,
  requirePermission,
  writeAuditLog,
} from "./lib/access";
import { verifyActor } from "./lib/auth";
import { PLANS } from "./lib/billing/index";
import {
  normalizeTaxRatePct,
  sameTaxSetting,
  taxSettingOf,
  taxSettingSentence,
  validateTaxRatePct,
} from "./lib/tax";
import { planKeyValidator, verticalValidator, fnbTaxProfileValidator, receiptSettingValidator } from "./schema";
import {
  fnbTaxProfileOf,
  fnbTaxProfileSentence,
  sameFnbTaxProfile,
  validateFnbTaxProfile,
} from "./lib/fnbTax";
import {
  receiptSettingOf,
  receiptSettingSentence,
  sameReceiptSetting,
  validateReceiptSetting,
} from "./lib/struk";
import { validateTenantLogo } from "./lib/tenantLogo";

const MS_PER_DAY = 86_400_000;
const TRIAL_DAYS = 14;

const DEFAULT_CATEGORIES = ["Kopi", "Makanan", "Snack", "Minuman"];

const planKeyArg = v.optional(planKeyValidator);

/** Berapa kali slug dicoba dicarikan versi bebasnya (`toko`, `toko-2`, …). */
const SLUG_ATTEMPTS = 50;

/**
 * Slug bebas untuk tenant baru.
 *
 * Nama bisnis **bukan** kunci unik: dua pemilik toko boleh sama-sama menamai
 * bisnisnya “Toko Berkah”. Yang kedua tidak boleh ditolak, dan lebih penting lagi
 * tidak boleh dilempar ke workspace milik orang lain. Jadi slug pertama dipakai
 * apa adanya, lalu `-2`, `-3`, … sampai ketemu yang benar-benar bebas — dua
 * bisnis dengan nama sama punya workspace masing-masing.
 */
async function uniqueSlug(ctx: MutationCtx, desired: string): Promise<string> {
  for (let attempt = 2; attempt <= SLUG_ATTEMPTS; attempt += 1) {
    const candidate = `${desired}-${attempt}`;
    const clash = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .unique();
    if (!clash) return candidate;
  }
  throw new Error(
    `Tidak bisa membuat alamat unik untuk “${desired}”. Coba nama bisnis yang lain.`,
  );
}

/**
 * Self-service onboarding: creates the tenant, its first store, the owner
 * membership, default categories, and starts the trial clock.
 *
 * Satu panggilan = satu bisnis. Nama bisnis yang sama dengan milik orang lain
 * **tidak** membuat keduanya berbagi workspace: tenant barunya mendapat slug
 * bebas (lihat `uniqueSlug`). Yang dikembalikan sebagai tenant lama hanyalah
 * tenant tempat pemanggil **sudah menjadi anggota** — mis. onboarding ulang di
 * perangkat baru — supaya mendaftar ulang tidak menumpuk workspace kedua.
 */
export const create = mutation({
  args: {
    ownerId: v.id("users"),
    name: v.string(),
    slug: v.string(),
    planKey: planKeyArg,
    storeName: v.optional(v.string()),
    taxRatePct: v.optional(v.number()),
    verticals: v.optional(v.array(verticalValidator)),
  },
  handler: async (ctx, args) => {
    // Onboarding creates an owner membership, so the claim must be the caller's.
    await verifyActor(ctx, args.ownerId);

    // Akun platform **boleh** mendirikan workspace sendiri: keanggotaan pemilik
    // yang lahir di sini adalah satu-satunya keanggotaan yang sah baginya, dan di
    // workspace itulah ia memang pemiliknya. Yang ditutup untuk akun platform
    // adalah jalur undangan (`members.add`), bukan kemampuan punya dashboard
    // sendiri — kalau itu ditutup, satu-satunya cara memakai produk ini adalah
    // melepas peran platformnya lebih dulu.

    const desired = args.slug.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(desired)) {
      throw new Error("Slug hanya boleh huruf kecil, angka, dan tanda hubung.");
    }

    const existing = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", desired))
      .unique();

    if (existing) {
      // Pemanggil sudah jadi anggota tenant itu: itu workspace-nya sendiri, bukan
      // workspace orang lain — jadi tidak perlu dibuat yang kedua.
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_tenant_user", (q) =>
          q.eq("tenantId", existing._id).eq("userId", args.ownerId),
        )
        .unique();
      if (membership) {
        const store = await ctx.db
          .query("stores")
          .withIndex("by_tenant", (q) => q.eq("tenantId", existing._id))
          .first();
        return {
          tenantId: existing._id,
          storeId: store?._id ?? null,
          trialDays: TRIAL_DAYS,
          slug: existing.slug,
          name: existing.name,
          reused: true,
        };
      }
    }

    // Slug itu milik bisnis lain (atau belum ada): tenant baru tetap dibuat, dengan
    // slug bebas supaya kedua bisnis berdiri sendiri.
    const slug = existing ? await uniqueSlug(ctx, desired) : desired;

    const planKey = args.planKey ?? "starter";
    const now = Date.now();

    const tenantId = await ctx.db.insert("tenants", {
      name: args.name,
      slug,
      ownerId: args.ownerId,
      planKey,
      planVersion: PLANS[planKey].version,
      status: "trialing",
      trialEndsAt: now + TRIAL_DAYS * MS_PER_DAY,
      graceDays: 7,
      currency: "IDR",
      taxRatePct: args.taxRatePct ?? 11,
      verticals: args.verticals ?? ["umkm"],
      createdAt: now,
    });

    const storeId = await ctx.db.insert("stores", {
      tenantId,
      name: args.storeName ?? "Toko Utama",
      code: "MAIN",
      active: true,
      createdAt: now,
    });

    await ctx.db.insert("memberships", {
      tenantId,
      userId: args.ownerId,
      role: "owner",
      storeIds: [storeId],
      active: true,
      createdAt: now,
    });

    for (let i = 0; i < DEFAULT_CATEGORIES.length; i += 1) {
      await ctx.db.insert("categories", {
        tenantId,
        name: DEFAULT_CATEGORIES[i],
        sortOrder: i,
        // Bawaan selalu mulai aktif; mengaturnya (tambah/ubah/nonaktifkan/hapus)
        // ada di halaman Produk & Stok dengan izin `category.manage`.
        active: true,
        createdAt: now,
      });
    }

    // Counters are created lazily by nextSequence, so the first receipt is
    // A-00001. Reserving one here would burn sequence 1 on every new tenant.

    await writeAuditLog(ctx, {
      tenantId,
      actorId: args.ownerId,
      action: "tenant.create",
      entity: "tenants",
      entityId: tenantId,
      meta: { planKey, slug },
    });

    return {
      tenantId,
      storeId,
      trialDays: TRIAL_DAYS,
      slug,
      name: args.name,
      reused: false,
    };
  },
});

/**
 * Onboarding lookup: "does this workspace slug exist yet?".
 *
 * Deliberately returns only identity fields. Plan, status, trial clock and tax
 * rate are business data — a stranger must not be able to read a competitor's
 * subscription state by guessing a slug. Members get the full picture from
 * `entitlements.getForTenant`.
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug.trim().toLowerCase()))
      .unique();
    if (!tenant) return null;
    return { _id: tenant._id, name: tenant.name, slug: tenant.slug };
  },
});

/**
 * The full tenant record — plan, status, trial clock, tax rate, verticals.
 * Members only; this is what made `getBySlug` leak-proof, since onboarding only
 * ever needed the slug and the name.
 */
export const getMine = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.tenantId, args.actorId);
    return await getTenantOrThrow(ctx, args.tenantId);
  },
});

/**
 * Workspace yang diikuti pemanggil, lengkap dengan status keanggotaannya.
 *
 * Dua hal yang disengaja:
 *
 * 1. **Bacanya lewat keanggotaan `userId` yang bersangkutan**, bukan pencarian
 *    slug, supaya tidak ada cara masuk ke workspace orang lain dengan menebak
 *    nama bisnisnya.
 * 2. **Keanggotaan nonaktif tetap dilaporkan** (`active: false`), bukan
 *    disembunyikan. Klien memakai penanda itu untuk berhenti berlangganan data
 *    workspace **sebelum** server sempat menolak — kalau barisnya dihilangkan,
 *    anggota yang dinonaktifkan tampak seperti akun yang belum punya workspace
 *    sama sekali, dan justru dibuatkan bisnis baru dari sisa sesi perangkatnya
 *    (lihat `ConvexStoreProvider`).
 */
export const listMine = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await verifyActor(ctx, args.userId);

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    /*
      Logo toko ikut dikirim sebagai URL siap pakai, bukan hanya id berkasnya:
      yang perlu menggambarnya (`/app/settings` dan struk kasir) tidak boleh
      menyentuh penyimpanan sendiri, dan URL bertanda tangan memang harus dibuat
      baru setiap kali dibaca. `logoUrl` kosong = workspace itu belum punya logo.
    */
    const rows = await Promise.all(
      memberships.map(async (m) => {
        const tenant = await ctx.db.get(m.tenantId);
        if (!tenant) return null;
        return {
          tenant,
          role: m.role,
          active: m.active,
          logoUrl: tenant.logo ? await ctx.storage.getUrl(tenant.logo) : null,
        };
      }),
    );

    return rows.filter((row): row is NonNullable<typeof row> => row !== null);
  },
});

/**
 * Mengatur PPN workspace: tarifnya (besar/kecil) dan aktif/nonaktifnya.
 *
 * Izinnya `billing.manage` — setelan yang sama dengan pengelola langganan, karena
 * ia mengubah angka di setiap struk dan di tagihan langganan workspace ini:
 * pemilik, manajer, dan keuangan. Kasir & staf gudang tidak ditawari mengubahnya.
 *
 * Tarifnya divalidasi aturan murni `lib/tax.ts` (0–100%, dua desimal, dan “aktif
 * dengan tarif 0%” ditolak supaya “PPN 0%” tidak pernah bercampur dengan “PPN
 * tidak aktif”). Setelan yang tidak mengubah apa pun tidak menulis jejak audit.
 */
export const updateTax = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    active: v.boolean(),
    ratePct: v.number(),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "billing.manage");

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    const decision = validateTaxRatePct(args.ratePct, { active: args.active });
    if (!decision.ok) throw new Error(decision.reason);

    const before = taxSettingOf(tenant);
    const after = { active: args.active, ratePct: decision.value };

    if (sameTaxSetting(before, after)) {
      return { changed: false, ...after, sentence: taxSettingSentence(after) };
    }

    await ctx.db.patch(args.tenantId, {
      taxActive: after.active,
      taxRatePct: normalizeTaxRatePct(after.ratePct),
    });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "tenant.tax",
      entity: "tenants",
      entityId: args.tenantId,
      meta: { before, after },
    });

    return { changed: true, ...after, sentence: taxSettingSentence(after) };
  },
});

/**
 * Mengatur pajak & pungutan khas F&B: PBJT (pajak daerah), biaya layanan, dan
 * kewajiban pusat pengusaha (PPh final UMKM, PPh 21, PPh 4 ayat (2)).
 *
 * Izinnya sama dengan setelan PPN & langganan (`billing.manage`): yang mengubah
 * angka di struk dan kewajiban bulanan workspace ini adalah pemilik, manajer, dan
 * keuangan — kasir & staf gudang tidak ditawari mengubahnya, dan server tetap
 * menolak kalau aksinya dipaksakan.
 *
 * Seluruh profil divalidasi lebih dulu oleh aturan murni `lib/fnbTax.ts` (batas
 * PBJT & biaya layanan, “aktif 0%” ditolak, tahun mulai PPh final UMKM tidak di
 * masa depan); setelan yang tidak lolos **tidak** disimpan sebagian. Setelan yang
 * tidak mengubah apa pun juga tidak menulis jejak audit.
 */
export const updateFnbTax = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    profile: fnbTaxProfileValidator,
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "billing.manage");

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    const decision = validateFnbTaxProfile(args.profile);
    if (!decision.ok) throw new Error(decision.reason);

    const before = fnbTaxProfileOf(tenant.fnbTaxProfile);
    const after = decision.value;

    if (sameFnbTaxProfile(before, after)) {
      return { changed: false, profile: after, sentence: fnbTaxProfileSentence(after) };
    }

    await ctx.db.patch(args.tenantId, { fnbTaxProfile: after });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "tenant.fnb_tax",
      entity: "tenants",
      entityId: args.tenantId,
      meta: { before, after },
    });

    return { changed: true, profile: after, sentence: fnbTaxProfileSentence(after) };
  },
});

/**
 * Mengatur struk belanja: jenis printer struknya, lebar kertas, jumlah rangkap,
 * dan catatan kakinya.
 *
 * Izinnya sama dengan setelan PPN & pajak F&B (`billing.manage`) — bukan karena
 * struk itu soal uang, melainkan karena **dokumen yang keluar ke pelanggan**
 * berubah karenanya, dan kartunya hidup di halaman Pengaturan yang memang dijaga
 * izin itu: tidak ada tombol yang ditawarkan kepada orang yang akan ditolak
 * server.
 *
 * Seluruh setelan divalidasi lebih dulu oleh aturan murni `lib/struk.ts`: lebar
 * kertas harus salah satu yang benar-benar didukung printernya, dan **rangkap
 * lebih dari satu ditolak di printer yang tidak bisa tembusan karbon** (thermal &
 * portable) — supaya tidak ada setelan yang menjanjikan lembaran kedua yang tidak
 * mungkin keluar. Setelan yang tidak mengubah apa pun juga tidak menulis jejak
 * audit.
 */
export const updateReceipt = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    setting: receiptSettingValidator,
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "billing.manage");

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    const decision = validateReceiptSetting(args.setting);
    if (!decision.ok) throw new Error(decision.reason);

    const before = receiptSettingOf(tenant.receipt);
    const after = decision.value;

    if (sameReceiptSetting(before, after)) {
      return { changed: false, setting: after, sentence: receiptSettingSentence(after) };
    }

    await ctx.db.patch(args.tenantId, { receipt: after });

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "tenant.receipt",
      entity: "tenants",
      entityId: args.tenantId,
      meta: { before, after },
    });

    return { changed: true, setting: after, sentence: receiptSettingSentence(after) };
  },
});

/**
 * URL unggah sekali pakai untuk logo toko.
 *
 * Izinnya `billing.manage` — sama dengan setelan struk yang memuatnya, karena
 * logo itu bagian dari dokumen yang keluar ke pelanggan. Klien memakai URL ini
 * untuk mengirim berkasnya langsung ke penyimpanan, lalu menautkannya lewat
 * `setLogo` (pola tiga langkah Convex: minta URL → POST berkas → simpan id-nya).
 */
export const generateLogoUploadUrl = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "billing.manage");
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Memasang logo toko dari berkas yang sudah diunggah ke penyimpanan.
 *
 * Dua hal dijaga di sini, bukan hanya di UI: berkasnya benar-benar gambar yang
 * ukurannya wajar (dibaca dari metadata `_storage`), dan hanya ada **satu** logo
 * per workspace — logo lama dihapus begitu yang baru tersimpan, supaya kuota
 * penyimpanan tidak terisi logo yang sudah tidak dipakai siapa pun. Berkas baru
 * yang ditolak juga langsung dihapus, bukan dibiarkan menumpuk sebagai sampah.
 */
export const setLogo = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "billing.manage");

    const tenant = await getTenantOrThrow(ctx, args.tenantId);

    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata) {
      throw new Error("Berkas logo tidak ditemukan di penyimpanan.");
    }
    const size = Number(metadata.size ?? 0);
    const valid = validateTenantLogo({ contentType: metadata.contentType, size });
    if (!valid.ok) {
      await ctx.storage.delete(args.storageId);
      throw new Error(valid.reason);
    }

    // Berkas yang sama diunggah ulang: tidak ada yang berubah, jadi tidak ada yang
    // ditulis dan tidak ada jejak audit — termasuk berkas lamanya (yang tidak ada).
    if (tenant.logo === args.storageId) {
      return {
        changed: false,
        logoUrl: await ctx.storage.getUrl(args.storageId),
      };
    }

    const previous = tenant.logo;
    await ctx.db.patch(args.tenantId, { logo: args.storageId });
    if (previous) await ctx.storage.delete(previous);

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "tenant.logo.set",
      entity: "tenants",
      entityId: args.tenantId,
      meta: { bytes: size, contentType: metadata.contentType, replaced: Boolean(previous) },
    });

    return { changed: true, logoUrl: await ctx.storage.getUrl(args.storageId) };
  },
});

/**
 * Melepas logo toko sekaligus menghapus berkasnya, supaya kuota penyimpanan tidak
 * terisi logo yang tidak dipakai lagi. Struknya kembali dicetak tanpa logo.
 */
export const removeLogo = mutation({
  args: {
    tenantId: v.id("tenants"),
    actorId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requirePermission(ctx, args.tenantId, args.actorId, "billing.manage");

    const tenant = await getTenantOrThrow(ctx, args.tenantId);
    if (!tenant.logo) {
      return { changed: false, logoUrl: null };
    }

    await ctx.db.patch(args.tenantId, { logo: undefined });
    await ctx.storage.delete(tenant.logo);

    await writeAuditLog(ctx, {
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: "tenant.logo.remove",
      entity: "tenants",
      entityId: args.tenantId,
    });

    return { changed: true, logoUrl: null };
  },
});

export const listStores = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.tenantId, args.actorId);
    return await ctx.db
      .query("stores")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
  },
});

export const listCategories = query({
  args: { tenantId: v.id("tenants"), actorId: v.id("users") },
  handler: async (ctx, args) => {
    await requireMembership(ctx, args.tenantId, args.actorId);

    const rows = await ctx.db
      .query("categories")
      .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
      .collect();
    return rows.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

/**
 * Actor resolution — the bridge between "who is logged in" and "who is allowed
 * to do this".
 *
 * RBAC alone is not authorization. Every guarded function takes an `actorId`
 * from the caller, and a client that simply sends someone else's id would look
 * exactly like that person. So before any permission is evaluated the claimed
 * actor is checked against the identity the *platform* reports through
 * `ctx.auth.getUserIdentity()`:
 *
 *   - an identity is present and maps to some other user  → refused
 *   - an identity is present and maps to the claimed actor → allowed, verified
 *   - no identity is present                              → only allowed while
 *     `ALLOW_UNVERIFIED_ACTOR` permits it, and it is reported as unverified
 *
 * The last case exists because this deployment has no auth provider wired yet;
 * it is a *configuration* state, not a design choice. Set
 * `ALLOW_UNVERIFIED_ACTOR=false` on the deployment and unauthenticated calls
 * are refused outright — no code change needed. The moment a provider is
 * enabled, every guarded function requires a matching identity automatically.
 *
 * The policy itself (`decideActor`) is pure, so it is unit-tested in
 * scripts/verify-authz.mjs without a deployment.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

export interface Identity {
  email: string | null;
  subject: string | null;
}

export interface ActorDecision {
  allowed: boolean;
  /** True only when a real identity was checked and matched the claimed actor. */
  verified: boolean;
  reason?: string;
}

const FALSY = ["false", "0", "no", "off"];

/**
 * Whether an unauthenticated caller may still name an actor.
 *
 * Defaults to `true` so an unconfigured deployment keeps working; configure the
 * variable to `false` to make a verified identity mandatory.
 */
export function allowUnverifiedActors(): boolean {
  try {
    const raw =
      typeof process !== "undefined" ? process.env?.ALLOW_UNVERIFIED_ACTOR : undefined;
    if (raw === undefined || raw === null || raw === "") return true;
    return !FALSY.includes(String(raw).trim().toLowerCase());
  } catch {
    return true;
  }
}

/**
 * The policy, with no database or platform dependencies.
 *
 * An identity that cannot be mapped onto a `users` row is deliberately treated
 * as a mismatch rather than as "unknown, so allow".
 */
export function decideActor(input: {
  claimedActorId: string | null | undefined;
  /** The `users` row the platform identity resolves to, if any. */
  identityUserId: string | null;
  hasIdentity: boolean;
  allowUnverified: boolean;
}): ActorDecision {
  if (!input.claimedActorId) {
    return { allowed: false, verified: false, reason: "Aktor tidak disebutkan." };
  }

  if (input.hasIdentity) {
    if (input.identityUserId && input.identityUserId === input.claimedActorId) {
      return { allowed: true, verified: true };
    }
    return {
      allowed: false,
      verified: true,
      reason: "Identitas login tidak cocok dengan aktor yang disebutkan.",
    };
  }

  if (input.allowUnverified) {
    return { allowed: true, verified: false };
  }
  return {
    allowed: false,
    verified: false,
    reason:
      "Deployment ini mewajibkan identitas terverifikasi (ALLOW_UNVERIFIED_ACTOR=false).",
  };
}

async function readIdentity(ctx: Ctx): Promise<Identity | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return {
    email:
      typeof identity.email === "string"
        ? identity.email.trim().toLowerCase()
        : null,
    subject: typeof identity.subject === "string" ? identity.subject : null,
  };
}

/**
 * Pemisah `sub` token Convex Auth: `sub` = `id_pengguna|id_sesi`.
 *
 * Sumbernya paket `@convex-dev/auth` (`TOKEN_SUB_CLAIM_DIVIDER`), bukan konvensi
 * karangan sendiri — helper `getAuthUserId` di paket itu memotongnya dengan cara
 * yang sama. Diringkas di sini supaya lapisan identitas proyek ini tidak perlu
 * bergantung pada paket auth pada setiap pemanggilan.
 */
const SUBJECT_DIVIDER = "|";

/**
 * Maps a platform identity onto a `users` row — by auth subject, then email.
 *
 * Tiga bentuk `sub` yang mungkin datang, dan semuanya harus tetap bekerja:
 *
 *  - `id_pengguna|id_sesi` (Convex Auth) → bagian pertama adalah id baris
 *    `users`,
 *  - id baris `users` apa adanya (penyedia yang memakai id kita sebagai subject),
 *  - id buram milik penyedia luar (Clerk/Auth0) → tidak dipetakan, jatuh ke email.
 *
 * Kalau tidak ada yang cocok, identitas yang sudah diverifikasi **tidak**
 * dianggap sebagai aktor mana pun: `decideActor` menolak klaim yang tidak cocok,
 * jadi pemetaan yang gagal berarti penolakan, bukan pelonggaran.
 */
async function identityUser(
  ctx: Ctx,
  identity: Identity,
): Promise<Id<"users"> | null> {
  const candidates = [
    identity.subject?.split(SUBJECT_DIVIDER)[0],
    identity.subject,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const candidate of candidates) {
    try {
      const row = await ctx.db.get(candidate as Id<"users">);
      if (row) return row._id;
    } catch {
      // Bukan id baris `users` (bentuk id penyedia lain) — bukan galat di sini;
      // kandidat berikutnya atau email yang menentukan.
    }
  }

  if (identity.email) {
    const row = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", identity.email as string))
      .unique();
    if (row) return row._id;
  }

  return null;
}

/**
 * Akun `users` milik **identitas login yang sedang dipakai**, tanpa perlu klien
 * menyebutkan id-nya.
 *
 * Kenapa ini ada: beberapa permukaan backstage dulu menebak aktornya dari email
 * sesi aplikasi (yang hidup di `localStorage` per perangkat), lalu mencocokkannya
 * dengan identitas login. Kalau keduanya berbeda — mis. perangkat ini masih
 * memegang sesi akun bisnis sementara yang diverifikasi adalah akun pengembang —
 * gerbangnya menolak, dan yang terlihat pengguna hanyalah “backstage tidak mau
 * terbuka”. Dengan resolusi dari identitas, aktornya adalah orang yang benar-benar
 * memegang kotak masuknya; tidak ada lagi email yang perlu dicocokkan.
 *
 * `null` berarti tidak ada identitas (mode tanpa provider, atau belum masuk) atau
 * identitasnya tidak memetakan ke baris `users` mana pun — pemanggil yang
 * memutuskan apa artinya, bukan fungsi ini.
 */
export async function resolveIdentityActor(
  ctx: Ctx,
): Promise<Doc<"users"> | null> {
  const identity = await readIdentity(ctx);
  if (!identity) return null;
  const userId = await identityUser(ctx, identity);
  if (!userId) return null;
  return ctx.db.get(userId);
}

/** Resolves and enforces the claimed actor. Throws when the claim is not theirs. */
export async function verifyActor(
  ctx: Ctx,
  claimedActorId: Id<"users"> | null | undefined,
): Promise<ActorDecision> {
  const identity = await readIdentity(ctx);
  const identityUserId = identity ? await identityUser(ctx, identity) : null;

  const decision = decideActor({
    claimedActorId: claimedActorId ?? null,
    identityUserId,
    hasIdentity: identity !== null,
    allowUnverified: allowUnverifiedActors(),
  });

  if (!decision.allowed) {
    throw new Error(`Akses ditolak: ${decision.reason}`);
  }
  return decision;
}

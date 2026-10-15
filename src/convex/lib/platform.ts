/**
 * Akun platform developer — aturan murni.
 *
 * Akun ini **bukan peran tenant**. Seluruh peran di aplikasi ini hidup di
 * `memberships` dan selalu terikat satu tenant (`owner`…`finance`), jadi apa pun
 * yang ditambahkan ke `ROLES`/`ROLE_LABELS` otomatis terlihat: dropdown peran di
 * halaman Tim, label peran di sidebar & halaman API, sampai cek harness. Karena
 * itu akun platform tinggal di tempat lain: penanda di baris `users`
 * (`platformRole`).
 *
 * Akun platform **boleh punya workspace sendiri**: ia pemilik di sana, punya
 * dashboard, dan bisa memakai aplikasi seperti pemilik bisnis biasa. Yang dijaga
 * adalah satu hal saja — **di tenant orang lain ia tidak pernah ada**. Tiga
 * konsekuensi yang membuatnya tetap begitu, dan semuanya struktural:
 *
 * 1. **Keanggotaannya hanya bisa lahir dari `tenants.create` untuk dirinya
 *    sendiri.** Jalur undangan ditutup di server (`membershipAssignmentError`),
 *    jadi satu kali `members.add` tidak cukup untuk membuatnya muncul di tim
 *    orang lain.
 * 2. **Di tenant yang bukan miliknya tidak ada baris yang bisa menemukannya.**
 *    `members.list` membaca `memberships` per tenant, `tenants.listMine` membaca
 *    membership milik pemanggil, dan seluruh gate izin berangkat dari
 *    `requireMembership` — akun yang bukan anggota memang tidak pernah muncul,
 *    tanpa perlu menyaring siapa pun lewat penanda `platformRole`.
 * 3. **Workspace sendiri tidak bisa "dititipi" bantuan platform.**
 *    `platform.impersonate` menolak tenant yang ia dirikan sendiri: masuk ke
 *    sana lewat keanggotaan pemilik, bukan lewat jalur pendampingan (lihat
 *    `lib/impersonation.ts`).
 *
 * Pagar identitasnya sengaja **lebih ketat** daripada gate tenant: akun platform
 * hanya hidup kalau identitas login benar-benar dicocokkan
 * (`decidePlatformAccess` menolak `verified: false`). Pasangan gate tenant boleh
 * longgar selama `ALLOW_UNVERIFIED_ACTOR` masih `true`; akun platform tidak.
 * Tanpa itu, "akun tak terlihat" hanya berarti "akun yang bisa dipakai siapa pun
 * dengan menebak satu id".
 */

/** Peran platform yang dikenal. Selalu **di luar** `Role` tenant. */
export const PLATFORM_ROLES = ["developer"] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  developer: "Pengembang platform",
};

export function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

/**
 * Kalimat penolakan akun platform — ditulis satu kali di sini.
 *
 * Dipakai dua sisi sekaligus: server menolak dengannya (`tenants.create`,
 * `members.add`), dan klien mengenalinya dengannya pula (`@/lib/platform`) untuk
 * memilih petunjuk yang tepat — "akun platform tidak boleh punya workspace"
 * menuntut tindakan yang berbeda dari kegagalan jaringan biasa.
 */
export const PLATFORM_MEMBERSHIP_REFUSAL =
  "Akun platform tidak boleh menjadi anggota tenant milik orang lain: keanggotaannya hanya boleh lahir dari workspace yang ia dirikan sendiri.";

/**
 * Akun platform tidak boleh diundang masuk tenant orang lain.
 *
 * Dipakai `members.add`: satu kali undangan sudah cukup untuk membuatnya terlihat
 * sebagai bagian dari tim orang lain. Jalur yang sah baginya cuma satu —
 * mendirikan workspace sendiri (`tenants.create` membuat keanggotaan pemilik), dan
 * di situ memang ia pemiliknya.
 */
export function membershipAssignmentError(
  platformRole: string | null | undefined,
): string | null {
  if (platformRole === undefined || platformRole === null) return null;
  if (!isPlatformRole(platformRole)) return null;
  return PLATFORM_MEMBERSHIP_REFUSAL;
}

/**
 * Apakah pesan galat ini penolakan karena akun platform?
 *
 * Sengaja `includes`, bukan kesamaan persis: yang sampai ke klien adalah pesan
 * yang sudah dibungkus lapisan Convex (mis. berawalan `Uncaught Error: …`),
 * sedangkan penolakan aslinya harus tetap dikenali di dalamnya. Galat lain —
 * jaringan, slug terpakai, atau penolakan validasi — mengembalikan `false` supaya
 * klien memakai petunjuk umum, bukan petunjuk akun platform.
 */
export function isPlatformMembershipRefusal(
  message: string | null | undefined,
): boolean {
  return (
    typeof message === "string" && message.includes(PLATFORM_MEMBERSHIP_REFUSAL)
  );
}

/**
 * Boleh-tidaknya sebuah akun muncul sebagai **baris** di permukaan tenant (daftar
 * anggota, pemilih anggota, ringkasan bantuan).
 *
 * Akun platform muncul **hanya** di workspace miliknya sendiri (`ownsTenant`):
 * di situ ia pemiliknya, dan menyembunyikannya justru membuat workspace tanpa
 * pemilik yang bisa mengatur timnya. Di tenant orang lain ia tetap tidak pernah
 * muncul — dan itu bukan hasil penyaringan di tiap halaman, melainkan asal
 * keanggotaannya (hanya `tenants.create` untuk dirinya sendiri).
 *
 * Satu hal yang sengaja di luar cakupan fungsi ini: jejak pendampingan. Saat akun
 * platform benar-benar menolong tenant, tenant memang harus tahu — barisnya ditulis
 * ke `auditLogs` dengan penanda `source: "platform"` dan dibaca lewat
 * `platform.impersonationTrail` (lihat `lib/impersonation.ts`). Yang di sini dijaga
 * adalah ia tidak muncul di daftar orang yang seolah-olah bagian dari tim.
 */
export function visibleInTenantSurfaces(account: {
  platformRole?: string | null;
  /** True kalau tenant yang sedang dilihat adalah workspace milik akun ini. */
  ownsTenant?: boolean;
}): boolean {
  if (!isPlatformRole(account.platformRole ?? "")) return true;
  return account.ownsTenant === true;
}

export interface PlatformAccessInput {
  /** Penanda akun; `null`/kosong berarti akun biasa. */
  platformRole: string | null | undefined;
  /** Hasil `verifyActor`: true hanya kalau identitas login cocok dengan aktor. */
  verified: boolean;
  /**
   * Keadaan deployment (`allowUnverifiedActors()`). Hanya dipakai untuk menyusun
   * kalimat penolakan yang bisa ditindaklanjuti — **bukan** untuk melonggarkan.
   */
  allowUnverified?: boolean;
}

export type PlatformAccessDecision =
  | { allowed: true; role: PlatformRole }
  | { allowed: false; reason: string };

/**
 * Kebijakan akses backstage, tanpa Convex.
 *
 * Urutannya sengaja: identitas diperiksa **lebih dulu**, sebelum peran platform
 * dibaca. Pemanggil anonim yang menebak id akun platform karena itu mendapat
 * penolakan yang sama dengan pemanggil yang menebak id akun biasa — ia tidak
 * bisa memakai pesan galat untuk menebak akun mana yang ada.
 */
export function decidePlatformAccess(
  input: PlatformAccessInput,
): PlatformAccessDecision {
  if (input.verified !== true) {
    const reason = input.allowUnverified
      ? "akun platform menuntut identitas login yang terverifikasi; setel ALLOW_UNVERIFIED_ACTOR=false dan pasang provider autentikasi."
      : "identitas login yang terverifikasi tidak disertakan.";
    return { allowed: false, reason };
  }

  const role = input.platformRole ?? "";
  if (!isPlatformRole(role)) {
    return { allowed: false, reason: "akun ini bukan akun platform." };
  }

  return { allowed: true, role };
}

/** Ringkasan satu baris akun platform untuk pesan/log (tanpa data sensitif). */
export function describePlatformAccount(account: {
  name: string;
  email: string;
  platformRole: string | null | undefined;
}): string {
  if (!isPlatformRole(account.platformRole ?? "")) {
    return `${account.name} <${account.email}>`;
  }
  return `${account.name} <${account.email}> · ${PLATFORM_ROLE_LABELS[account.platformRole as PlatformRole]}`;
}

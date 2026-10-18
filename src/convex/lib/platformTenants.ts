/**
 * Aturan murni **pengelolaan akun bisnis dari backstage platform**: daftar
 * tenant, menonaktifkan/mengaktifkan, dan menghapus.
 *
 * Kenapa aturannya dipisah dari `platform.ts`: halaman backstage, mutation, dan
 * harness harus menjawab pertanyaan yang sama — “boleh/tidak, dan kenapa” — tanpa
 * menyalakan deployment. Di sini juga tinggal **daftar tabel milik tenant** yang
 * disapu saat penghapusan; daftar itu satu-satunya tempat yang tahu urutannya,
 * dan harness memeriksanya terhadap `schema.ts` supaya tabel baru tidak lolos
 * dari sapuan.
 *
 * Batas yang disengaja:
 *
 * - **Workspace sendiri tidak bisa dinonaktifkan/dihapus** dari sini. Pemilik
 *   platform yang mengunci workspace-nya sendiri akan kehilangan satu-satunya
 *   jalan masuk `/app` yang ia punya, dan tidak ada tombol “urungkan” di halaman
 *   yang tidak bisa ia buka.
 * - **Menghapus butuh nama bisnis yang benar-benar diketik**, bukan sekadar satu
 *   klik konfirmasi: kerusakannya permanen dan tidak ada tombol urungkan.
 * - Menonaktifkan **tidak** menyentuh `status` langganan. Dua hal itu berbeda:
 *   status adalah siklus billing, penonaktifan adalah keputusan pengelola.
 * - **Mengubah** hanya menyentuh dua hal yang memang milik pengelola platform:
 *   nama bisnis dan paket langganan. Slug (identitas untuk masuk & URL) dan isi
 *   operasional akun tidak ikut berubah, karena keduanya milik pemilik bisnis.
 *   Turun paket memakai aturan modul yang sama dengan `billing.changePlan`
 *   (`trimVerticalsForPlan`), supaya tidak ada modul yang menyala di luar paket.
 */

import type { PlanKey } from "./billing/catalog";
import { PROFILE_NAME_MAX, PROFILE_NAME_MIN } from "./profile";

/** Tindakan pengelola atas akun bisnis; dipakai skema & label. */
export type PlatformTenantAction = "suspend" | "activate" | "delete" | "update";

export const PLATFORM_TENANT_ACTION_LABELS: Record<PlatformTenantAction, string> = {
  suspend: "Dinonaktifkan",
  activate: "Diaktifkan kembali",
  delete: "Dihapus",
  update: "Diubah",
};

/** Panjang maksimum catatan pengelola — sama untuk ketiga tindakan. */
export const PLATFORM_NOTE_MAX = 200;

/**
 * Tabel yang **seluruh barisnya milik satu tenant**, beserta indeks yang dipakai
 * untuk menyapunya. Urutannya tidak penting untuk Convex (tidak ada foreign key),
 * dan setiap nama di sini wajib punya kolom `tenantId` di `schema.ts` — harness
 * memeriksa keduanya supaya tabel baru tidak tertinggal saat tenant dihapus.
 *
 * `tenants` sendiri **tidak** ada di daftar ini: barisnya dihapus paling akhir,
 * setelah seluruh tabel di bawahnya bersih.
 */
export const TENANT_TABLES: { table: string; index: string }[] = [
  { table: "memberships", index: "by_tenant" },
  { table: "apiKeys", index: "by_tenant" },
  { table: "webhookEndpoints", index: "by_tenant" },
  { table: "webhookDeliveries", index: "by_tenant" },
  { table: "customRoles", index: "by_tenant" },
  { table: "roleSettings", index: "by_tenant" },
  { table: "supportTickets", index: "by_tenant" },
  { table: "digitalCharges", index: "by_tenant" },
  { table: "syncChanges", index: "by_tenant" },
  { table: "stores", index: "by_tenant" },
  { table: "categories", index: "by_tenant" },
  { table: "subcategories", index: "by_tenant" },
  { table: "tables", index: "by_tenant" },
  { table: "mejaOrders", index: "by_tenant_created" },
  { table: "products", index: "by_tenant" },
  { table: "customers", index: "by_tenant" },
  { table: "members", index: "by_tenant" },
  { table: "receivables", index: "by_tenant" },
  { table: "receivablePayments", index: "by_tenant" },
  { table: "warehouses", index: "by_tenant" },
  { table: "suppliers", index: "by_tenant" },
  { table: "purchaseRequisitions", index: "by_tenant" },
  { table: "purchaseOrders", index: "by_tenant" },
  { table: "goodsReceipts", index: "by_tenant" },
  { table: "opnameSessions", index: "by_tenant" },
  { table: "payables", index: "by_tenant" },
  { table: "payablePayments", index: "by_tenant" },
  { table: "stockLevels", index: "by_tenant_store" },
  { table: "stockMovements", index: "by_tenant_created" },
  { table: "shifts", index: "by_tenant_store" },
  { table: "shiftAlerts", index: "by_tenant_kind_day" },
  { table: "sales", index: "by_tenant" },
  { table: "saleItems", index: "by_tenant" },
  { table: "devices", index: "by_tenant" },
  { table: "subscriptionInvoices", index: "by_tenant" },
  { table: "auditLogs", index: "by_tenant" },
  { table: "impersonationSessions", index: "by_tenant" },
  { table: "counters", index: "by_tenant_key" },
];

/** Berapa baris yang dihapus per langkah pekerja sapuan. */
export const TENANT_DELETE_BATCH = 200;

/** Batas jumlah akun yang ditampilkan sekali baca di backstage. */
export const TENANT_ACCOUNT_LIMIT = 100;

/** Batas baris log tindakan platform yang ditampilkan. */
export const PLATFORM_ACTION_LIMIT = 20;

/**
 * Berapa akun yang **diperiksa** sekali pencarian, dari yang terbaru.
 *
 * Ini yang membuat pencarian tidak lagi buta: daftar yang tampil tetap dibatasi
 * `TENANT_ACCOUNT_LIMIT` (100) supaya halaman tidak berat, tetapi pencariannya
 * menyapu seluruh deployment — 1086 akun saat aturan ini ditulis — sampai batas
 * ini. Batasnya ada supaya biaya membacanya tetap terukur saat deployment punya
 * puluhan ribu akun; kalau kena batas, halaman mengatakannya apa adanya
 * (`scanCapped`) alih-alih menjawab “tidak ada” padahal akunnya ada.
 *
 * Sapuannya satu kali baca, bukan berhalaman: Convex hanya mengizinkan satu query
 * `paginate()` per fungsi, dan batas itu terbukti nyata saat rilis ini diuji ke
 * deployment (“This query or mutation function ran multiple paginated queries”).
 */
export const TENANT_SEARCH_SCAN = 2000;

/** Kata kunci pencarian yang sudah dirapikan — satu-satunya bentuk yang dipakai aturan. */
export function normaliseTenantSearch(query: string | null | undefined): string {
  return (query ?? "").trim().toLowerCase();
}

/**
 * Cocokkah satu akun dengan kata kunci pencarian?
 *
 * Dicocokkan pada **nama bisnis, slug, paket, dan email pemilik** — sama seperti
 * yang dijanjikan kolom pencariannya. Dipakai dua tempat dengan maksud yang
 * berbeda: di server untuk **menyaring saat menyapu** (jadi pencarian tidak ikut
 * buta di 100 baris yang tampil), dan di harness untuk memeriksa hasilnya.
 */
export function tenantAccountMatches(
  row: { name: string; slug: string; ownerEmail?: string; planKey?: string },
  query: string,
): boolean {
  const needle = normaliseTenantSearch(query);
  if (!needle) return true;
  return [row.name, row.slug, row.ownerEmail ?? "", row.planKey ?? ""]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

/** Satu akun bisnis seperti yang dibaca halaman backstage. */
export interface TenantAccount {
  id: string;
  name: string;
  slug: string;
  planKey: string;
  /** Status **langganan** (`active`, `trialing`, …) — bukan status penonaktifan. */
  status: string;
  suspendedAt: number | null;
  suspendedNote: string | null;
  suspendLabel: string | null;
  deleting: boolean;
  ownerName: string;
  ownerEmail: string;
  members: number;
  activeMembers: number;
  stores: number;
  products: number;
  createdAt: number;
  /** Siap dikelola: `aktif` atau `nonaktif`. */
  accountStatus: "aktif" | "nonaktif";
  /** Kalimat satu baris untuk daftar (dipakai harness & halaman). */
  summary: string;
}

/** Catatan pengelola: dipangkas, kosong berarti tidak ada. */
export function normalisePlatformNote(note: string | null | undefined): string | undefined {
  if (note === null || note === undefined) return undefined;
  const trimmed = note.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;
  return trimmed.slice(0, PLATFORM_NOTE_MAX);
}

/**
 * Konfirmasi hapus: nama **slug** bisnis harus diketik sama. Perbandingan tidak
 * peka huruf besar/kecil dan spasi tepi, karena yang diuji manusia yang mengetik —
 * bukan mesin yang menyalin.
 */
export function slugConfirmationMatches(input: {
  typed: string;
  slug: string;
}): boolean {
  const typed = input.typed.trim().toLowerCase();
  return typed.length > 0 && typed === input.slug.trim().toLowerCase();
}

/** Label status akun yang dibaca pengelola — “aktif”/“nonaktif”, bukan status billing. */
export function tenantAccountStatus(input: {
  suspendedAt: number | null;
  deleting?: boolean;
}): "aktif" | "nonaktif" {
  if (input.deleting) return "nonaktif";
  return input.suspendedAt === null ? "aktif" : "nonaktif";
}

/** Ringkasan satu baris: nama, paket, status akun, dan jumlah isinya. */
export function tenantAccountSummary(input: {
  name: string;
  planKey: string;
  suspendedAt: number | null;
  deleting?: boolean;
  members: number;
  stores: number;
}): string {
  const status = tenantAccountStatus(input);
  const statusLabel = input.deleting ? "sedang dihapus" : status;
  return `${input.name} · paket ${input.planKey} · ${statusLabel} · ${input.members} anggota · ${input.stores} toko`;
}

export type PlatformDecision =
  | { allowed: true; note: string | undefined }
  | { allowed: false; reason: string };

/**
 * Bolehkah akun bisnis ini dinonaktifkan/diaktifkan oleh pengelola?
 *
 * Yang ditolak bukan soal izin (gerbangnya `requirePlatformDeveloper` di server),
 * melainkan keadaan yang membuat tindakannya salah: workspace sendiri, tenant
 * yang sudah tidak ada, dan tenant yang sedang dihapus.
 */
export function decideTenantSuspension(input: {
  tenantExists: boolean;
  ownsTenant: boolean;
  deleting: boolean;
  suspended: boolean;
  note?: string | null;
}): PlatformDecision {
  if (!input.tenantExists) {
    return { allowed: false, reason: "Akun bisnis itu tidak ditemukan." };
  }
  if (input.deleting) {
    return {
      allowed: false,
      reason: "Akun bisnis ini sedang dihapus, jadi statusnya tidak bisa diubah lagi.",
    };
  }
  if (input.ownsTenant) {
    return {
      allowed: false,
      reason:
        "Ini workspace Anda sendiri. Menonaktifkannya akan menutup satu-satunya dashboard yang Anda punya, jadi lakukan dari workspace lain.",
    };
  }
  if (input.suspended) {
    return { allowed: true, note: normalisePlatformNote(input.note) };
  }
  return { allowed: true, note: normalisePlatformNote(input.note) };
}

/**
 * Domain email yang dianggap **akun uji/harness**, bukan pendaftar nyata.
 *
 * Dipakai pembersihan massal (`platform.purgeFixtureTenants`) sebagai daftar
 * bawaan: hanya pemilik berdomain ini yang boleh disapu, dan daftar itu sengaja
 * ditulis di satu tempat supaya aturan “siapa yang sampah” bisa ditinjau mata
 * manusia, bukan tersebar di beberapa berkas.
 */
export const FIXTURE_OWNER_DOMAINS = ["mesinpos.test", "mesinpos.id"] as const;

/** Berapa akun uji yang ditandai hapus sekali jalan oleh pembersihan massal. */
export const TENANT_PURGE_BATCH = 200;

/** Berapa akun diperiksa sekali jalan saat membersihkan (batas penyapuan). */
export const TENANT_PURGE_SCAN = 2000;

/** Berapa **akun pengguna** uji yang dihapus sekali jalan (tanpa workspace-nya). */
export const USER_PURGE_BATCH = 100;

/** Berapa akun pengguna diperiksa sekali jalan saat membersihkan sisa akun uji. */
export const USER_PURGE_SCAN = 1000;

/**
 * Apakah email ini milik **akun uji**, bukan pendaftar sungguhan?
 *
 * Hanya domain yang **sama persis** yang dihitung (subdomain seperti
 * `mail.mesinpos.test` tidak ikut), dan email kosong/aneh dijawab `false` —
 * pembersihan massal harus berhenti di apa pun yang belum jelas.
 */
export function isFixtureOwnerEmail(
  email: string | null | undefined,
  domains: readonly string[] = FIXTURE_OWNER_DOMAINS,
): boolean {
  const value = (email ?? "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return false;
  const domain = value.slice(at + 1);
  return domains.some((candidate) => candidate.trim().toLowerCase() === domain);
}

/**
 * Bolehkah akun ini ikut dibersihkan secara massal?
 *
 * Tiga penjagaan, dan ketiganya harus lolos: akunnya ada, penghapusannya belum
 * berjalan, pemiliknya **bukan** akun uji kalau itu workspace pengelola sendiri
 * (workspace pengelola tidak pernah disapu, walau domainnya kebetulan sama), dan
 * pemiliknya benar-benar berdomain uji. Semua yang tidak jelas dijawab **tidak**
 * — lebih baik menyisakan satu akun sampah daripada menghapus satu pendaftar nyata.
 */
export type FixturePurgeDecision = { allowed: true } | { allowed: false; reason: string };

export function decideFixturePurge(input: {
  tenantExists: boolean;
  deleting: boolean;
  ownsTenant: boolean;
  ownerEmail: string | null | undefined;
  domains?: readonly string[];
}): FixturePurgeDecision {
  if (!input.tenantExists) {
    return { allowed: false, reason: "Akun bisnis itu tidak ditemukan." };
  }
  if (input.deleting) {
    return { allowed: false, reason: "Penghapusan akun ini sudah berjalan." };
  }
  if (input.ownsTenant) {
    return {
      allowed: false,
      reason: "Ini workspace pengelola sendiri — tidak pernah ikut dibersihkan.",
    };
  }
  if (!isFixtureOwnerEmail(input.ownerEmail, input.domains)) {
    return {
      allowed: false,
      reason: `Pemiliknya bukan akun uji (${input.ownerEmail || "tanpa email"}) — tidak ikut dibersihkan.`,
    };
  }
  return { allowed: true };
}

/**
 * Bolehkah **akun pengguna** uji dihapus?
 *
 * Akun bisnis yang disapu meninggalkan baris `users` pemiliknya (dan anggota
 * undangan uji). Kalau dibiarkan, harness yang berjalan berkali-kali tetap
 * menumpuk baris login tanpa workspace — sampah yang tidak terlihat di daftar
 * akun bisnis, tetapi tetap memenuhi tabel.
 *
 * Yang dijaga, dan semuanya harus lolos:
 *
 *  - **akun platform sungguhan** tidak pernah dihapus. Akun developer **beremail
 *    uji** boleh ikut disapu, tetapi hanya kalau masih ada pengembang lain
 *    beremail non-uji — deployment tidak boleh kehilangan satu-satunya jalan
 *    masuk backstage hanya karena pembersihan;
 *  - **tidak memiliki satu pun tenant** — termasuk tenant yang sedang dihapus,
 *    karena penghapusannya belum tentu selesai; putaran berikutnya yang mengambilnya;
 *  - **tidak menjadi anggota di mana pun**, aktif maupun nonaktif — orang yang
 *    masih tercatat di sebuah workspace bukan sampah, walau emailnya berdomain uji;
 *  - emailnya benar-benar berdomain uji (aturan yang sama dengan akun bisnis).
 *
 * Semua yang tidak jelas dijawab **tidak**.
 */
export type FixtureUserPurgeDecision = { allowed: true } | { allowed: false; reason: string };

export function decideFixtureUserPurge(input: {
  platformRole: string | null | undefined;
  ownsTenant: boolean;
  memberOf: boolean;
  email: string | null | undefined;
  /**
   * Masih ada pengembang platform **beremail non-uji** setelah akun ini?
   * Tanpa ini, deployment bisa kehilangan satu-satunya jalan masuk backstage
   * hanya karena pembersihan akun uji.
   */
  otherOperator: boolean;
  domains?: readonly string[];
}): FixtureUserPurgeDecision {
  if (input.platformRole) {
    if (!isFixtureOwnerEmail(input.email, input.domains)) {
      return {
        allowed: false,
        reason: "Akun platform sungguhan — tidak pernah ikut dibersihkan.",
      };
    }
    if (!input.otherOperator) {
      return {
        allowed: false,
        reason:
          "Akun pengembang uji, tetapi satu-satunya yang tersisa — jalan masuk backstage tidak boleh hilang.",
      };
    }
  }
  if (input.ownsTenant) {
    return {
      allowed: false,
      reason: "Masih memiliki akun bisnis — tunggu akun bisnisnya disapu lebih dulu.",
    };
  }
  if (input.memberOf) {
    return {
      allowed: false,
      reason: "Masih tercatat sebagai anggota sebuah workspace — bukan sampah.",
    };
  }
  if (!isFixtureOwnerEmail(input.email, input.domains)) {
    return {
      allowed: false,
      reason: `Bukan akun uji (${input.email || "tanpa email"}) — tidak ikut dibersihkan.`,
    };
  }
  return { allowed: true };
}

/**
 * Bolehkah nama/paket akun bisnis ini diubah pengelola platform?
 *
 * Yang dijaga: tenant harus ada, bukan yang sedang dihapus, minimal satu kolom
 * benar-benar dikirim, nama bisnis mengikuti batas yang sama dengan halaman
 * Profil (`PROFILE_NAME_MIN`/`PROFILE_NAME_MAX` — satu sumber, bukan dua), dan
 * paketnya harus paket yang dikenal katalog. Paket diuji terhadap daftar yang
 * dikirim pemanggil supaya aturan ini tetap murni dan bisa dipakai harness.
 */
export type TenantUpdateDecision =
  | {
      allowed: true;
      /** Nama baru yang sudah dirapikan, atau `null` kalau tidak diubah. */
      name: string | null;
      planKey: PlanKey | null;
      note: string | undefined;
    }
  | { allowed: false; reason: string };

export function decideTenantUpdate(input: {
  tenantExists: boolean;
  deleting: boolean;
  name: string | null;
  planKey: PlanKey | null;
  planKeys: readonly PlanKey[];
  note?: string | null;
}): TenantUpdateDecision {
  if (!input.tenantExists) {
    return { allowed: false, reason: "Akun bisnis itu tidak ditemukan." };
  }
  if (input.deleting) {
    return {
      allowed: false,
      reason: "Akun bisnis ini sedang dihapus, jadi datanya tidak bisa diubah lagi.",
    };
  }
  if (input.name === null && input.planKey === null) {
    return {
      allowed: false,
      reason: "Tidak ada yang diubah: kirim nama bisnis atau paket yang baru.",
    };
  }

  let name: string | null = null;
  if (input.name !== null) {
    name = input.name.trim().replace(/\s+/g, " ");
    if (name.length < PROFILE_NAME_MIN) {
      return {
        allowed: false,
        reason: `Nama bisnis minimal ${PROFILE_NAME_MIN} karakter.`,
      };
    }
    if (name.length > PROFILE_NAME_MAX) {
      return {
        allowed: false,
        reason: `Nama bisnis maksimal ${PROFILE_NAME_MAX} karakter.`,
      };
    }
  }

  if (input.planKey !== null && !input.planKeys.includes(input.planKey)) {
    return {
      allowed: false,
      reason: `Paket tidak dikenal: ${input.planKey}. Pilih salah satu: ${input.planKeys.join(", ")}.`,
    };
  }

  return {
    allowed: true,
    name,
    planKey: input.planKey,
    note: normalisePlatformNote(input.note),
  };
}

/**
 * Bolehkah akun bisnis ini dihapus?
 *
 * Tiga hal yang dijaga: tenant harus ada, bukan workspace pengelola sendiri, dan
 * slug-nya diketik persis. Penghapusan yang sudah berjalan tidak bisa dimulai dua
 * kali — pekerjanya akan bentrok menghapus baris yang sama.
 */
export function decideTenantDeletion(input: {
  tenantExists: boolean;
  ownsTenant: boolean;
  deleting: boolean;
  slug: string;
  typedSlug: string;
  note?: string | null;
}): PlatformDecision {
  if (!input.tenantExists) {
    return { allowed: false, reason: "Akun bisnis itu tidak ditemukan." };
  }
  if (input.ownsTenant) {
    return {
      allowed: false,
      reason:
        "Ini workspace Anda sendiri. Menghapusnya akan menghapus akun yang sedang Anda pakai — keluarkan dulu kepemilikannya dari akun lain.",
    };
  }
  if (input.deleting) {
    return {
      allowed: false,
      reason: "Penghapusan akun bisnis ini sudah berjalan dan tidak perlu dimulai ulang.",
    };
  }
  if (!slugConfirmationMatches({ typed: input.typedSlug, slug: input.slug })) {
    return {
      allowed: false,
      reason: `Ketik nama singkat bisnisnya (${input.slug}) untuk memastikan penghapusan ini disengaja.`,
    };
  }
  return { allowed: true, note: normalisePlatformNote(input.note) };
}

/**
 * Penyaring daftar akun: nama, slug, email pemilik, dan paket. Pencarian kosong
 * berarti semua akun — dan yang **sedang dihapus** tetap tampil supaya pengelola
 * bisa melihat prosesnya, bukan menghilang diam-diam.
 */
/** Rekap daftar: berapa yang aktif, nonaktif, dan sedang dihapus. */
export function summariseTenantAccounts(
  rows: { suspendedAt: number | null; deleting?: boolean }[],
): { total: number; active: number; suspended: number; deleting: number } {
  let active = 0;
  let suspended = 0;
  let deleting = 0;
  for (const row of rows) {
    if (row.deleting) deleting += 1;
    else if (row.suspendedAt !== null) suspended += 1;
    else active += 1;
  }
  return { total: rows.length, active, suspended, deleting };
}

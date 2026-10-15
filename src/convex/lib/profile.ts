/**
 * Aturan profil — **murni**, dipakai bersama oleh halaman Profil, kedua store
 * (demo & Convex), backend (`users:updateProfile` + `tenants:updateProfile`), dan
 * harness.
 *
 * Ada dua profil di satu halaman, dan keduanya diatur di sini karena batasnya
 * harus sama di mana pun:
 *
 *   1. **Profil pengguna** (`users.name`, `users.phone`) — nama yang tampil dan
 *      nomor WhatsApp orang yang sedang masuk. Ini satu-satunya profil yang boleh
 *      diubah siapa saja, karena ia milik orangnya sendiri (`verifyActor`).
 *   2. **Profil usaha** (`tenants.name`, `tenants.address`, `tenants.email`,
 *      `tenants.phone`) — identitas bisnis yang dipakai aplikasi. Izinnya
 *      `billing.manage`, sama dengan setelan workspace lain di halaman Pengaturan.
 *
 * Dua aturan yang diambil dari tempat lain, bukan ditulis ulang:
 *
 *  - **Email** memakai `checkEmail` dari `lib/otp.ts` — validator yang sama yang
 *    dipakai undangan tim dan pengiriman kode masuk, jadi email yang lolos di sini
 *    adalah email yang benar-benar bisa dikirimi kode.
 *  - **Nomor WhatsApp** memakai `normalizePhone` dari `lib/team.ts` — aturan yang
 *    sama dengan undangan tim lewat `wa.me`: `08…`/`8…` menjadi `62…`, hanya
 *    digit, 8–15 angka. Satu aturan, bukan dua yang bisa berbeda.
 *
 * Kolom yang boleh kosong sengaja dibedakan dari yang tidak: nama usaha dan nama
 * pengguna **wajib** berisi, sedangkan alamat, email, dan nomor WA boleh kosong
 * (`null`) — workspace baru belum tentu sudah mengisinya, dan mengosongkan kembali
 * kolom itu harus bisa. Profil yang tidak lolos **tidak** disimpan sebagian.
 */

import { checkEmail, normalizeEmail } from "./otp";
import { normalizePhone } from "./team";

/** Panjang nama (pengguna & usaha) yang diterima. */
export const PROFILE_NAME_MIN = 2;
export const PROFILE_NAME_MAX = 60;
/** Batas alamat usaha. Alamat satu baris — bukan pidato. */
export const PROFILE_ADDRESS_MAX = 160;

/** Profil usaha seperti yang disimpan (`null` = belum diisi). */
export interface TenantProfile {
  name: string;
  address: string | null;
  email: string | null;
  phone: string | null;
}

/** Profil pengguna seperti yang disimpan. */
export interface UserProfile {
  name: string;
  phone: string | null;
}

/** Isian yang datang dari halaman — kolom yang tidak dikirim berarti “jangan diubah”. */
export interface TenantProfileDraft {
  name?: string;
  address?: string;
  email?: string;
  phone?: string;
}

export interface UserProfileDraft {
  name?: string;
  phone?: string;
}

export type ProfileCheck<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Spasi pinggir & ganda dirapikan — “Toko  Berkah ” dan “Toko Berkah” itu sama. */
function collapse(value: string): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Nama wajib: 2–60 karakter setelah spasi dirapikan. */
export function checkProfileName(raw: string, label = "Nama"): ProfileCheck<string> {
  const value = collapse(raw);
  if (!value) return { ok: false, reason: `${label} tidak boleh kosong.` };
  if (value.length < PROFILE_NAME_MIN) {
    return { ok: false, reason: `${label} minimal ${PROFILE_NAME_MIN} karakter.` };
  }
  if (value.length > PROFILE_NAME_MAX) {
    return { ok: false, reason: `${label} maksimal ${PROFILE_NAME_MAX} karakter.` };
  }
  return { ok: true, value };
}

/** Kolom teks bebas yang boleh kosong: kosong berarti `null`, bukan string kosong. */
export function checkOptionalText(
  raw: string,
  max: number,
  label: string,
): ProfileCheck<string | null> {
  const value = collapse(raw);
  if (!value) return { ok: true, value: null };
  if (value.length > max) {
    return { ok: false, reason: `${label} maksimal ${max} karakter.` };
  }
  return { ok: true, value };
}

/** Alamat usaha (boleh kosong). */
export function checkProfileAddress(raw: string): ProfileCheck<string | null> {
  return checkOptionalText(raw, PROFILE_ADDRESS_MAX, "Alamat");
}

/**
 * Email kontak (boleh kosong). Validatornya milik `lib/otp.ts` supaya email yang
 * diterima di sini sama dengan email yang bisa dikirimi kode.
 */
export function checkProfileEmail(raw: string): ProfileCheck<string | null> {
  const value = normalizeEmail(raw);
  if (!value) return { ok: true, value: null };
  const decision = checkEmail(value);
  if (!decision.valid) {
    return { ok: false, reason: decision.reason ?? "Email tidak valid." };
  }
  return { ok: true, value };
}

/**
 * Nomor WhatsApp (boleh kosong), disimpan dalam bentuk yang dituntut `wa.me`
 * (`6281234567890`). Aturannya milik `lib/team.ts` — sama dengan undangan tim.
 */
export function checkProfilePhone(raw: string): ProfileCheck<string | null> {
  const value = (raw ?? "").trim();
  if (!value) return { ok: true, value: null };
  const decision = normalizePhone(value);
  if (!decision.valid || !decision.value) {
    // `normalizePhone` menjawab “Nomor WhatsApp kosong.” untuk isian yang tidak
    // punya satu digit pun (mis. “abc”). Kalimat itu menyesatkan ketika kolomnya
    // jelas-jelas diisi, jadi sebabnya disebut apa adanya di sini.
    const reason = /\d/.test(value)
      ? decision.reason ?? "Nomor WhatsApp tidak valid."
      : "Nomor WhatsApp harus berisi angka, mis. 0812-3456-7890.";
    return { ok: false, reason };
  }
  return { ok: true, value: decision.value };
}

/** Profil usaha dari baris tenant; kolomnya opsional untuk tenant lama. */
export function tenantProfileOf(row: {
  name: string;
  address?: string;
  email?: string;
  phone?: string;
}): TenantProfile {
  return {
    name: row.name,
    address: row.address ? collapse(row.address) : null,
    email: row.email ? normalizeEmail(row.email) : null,
    phone: row.phone ? normalizePhone(row.phone).value ?? null : null,
  };
}

/** Profil pengguna dari baris `users`. */
export function userProfileOf(row: { name: string; phone?: string }): UserProfile {
  return {
    name: collapse(row.name),
    phone: row.phone ? normalizePhone(row.phone).value ?? null : null,
  };
}

/**
 * Profil usaha setelah isian halaman diterapkan. Seluruh kolom diperiksa lebih
 * dulu; satu kolom yang tidak lolos membatalkan **seluruh** penyimpanan — setelan
 * separuh tersimpan lebih membingungkan daripada tidak tersimpan sama sekali.
 */
export function applyTenantProfileDraft(
  current: TenantProfile,
  draft: TenantProfileDraft,
): ProfileCheck<TenantProfile> {
  const name =
    draft.name === undefined ? { ok: true as const, value: current.name } : checkProfileName(draft.name, "Nama usaha");
  if (!name.ok) return name;

  const address =
    draft.address === undefined
      ? { ok: true as const, value: current.address }
      : checkProfileAddress(draft.address);
  if (!address.ok) return address;

  const email =
    draft.email === undefined ? { ok: true as const, value: current.email } : checkProfileEmail(draft.email);
  if (!email.ok) return email;

  const phone =
    draft.phone === undefined ? { ok: true as const, value: current.phone } : checkProfilePhone(draft.phone);
  if (!phone.ok) return phone;

  return {
    ok: true,
    value: { name: name.value, address: address.value, email: email.value, phone: phone.value },
  };
}

/** Profil pengguna setelah isian halaman diterapkan (aturan yang sama). */
export function applyUserProfileDraft(
  current: UserProfile,
  draft: UserProfileDraft,
): ProfileCheck<UserProfile> {
  const name =
    draft.name === undefined ? { ok: true as const, value: current.name } : checkProfileName(draft.name);
  if (!name.ok) return name;

  const phone =
    draft.phone === undefined ? { ok: true as const, value: current.phone } : checkProfilePhone(draft.phone);
  if (!phone.ok) return phone;

  return { ok: true, value: { name: name.value, phone: phone.value } };
}

/** Apakah dua profil usaha sama persis (untuk tidak menulis perubahan kosong). */
export function sameTenantProfile(a: TenantProfile, b: TenantProfile): boolean {
  return a.name === b.name && a.address === b.address && a.email === b.email && a.phone === b.phone;
}

export function sameUserProfile(a: UserProfile, b: UserProfile): boolean {
  return a.name === b.name && a.phone === b.phone;
}

/**
 * Kolom profil usaha yang **belum** diisi, dalam urutan tampilannya. Dipakai
 * lencana “belum lengkap” dan kalimat notis setelah menyimpan — jadi halaman tidak
 * mengarang sendiri apa yang kurang.
 */
export function tenantProfileGaps(profile: TenantProfile): string[] {
  const gaps: string[] = [];
  if (!profile.address) gaps.push("alamat");
  if (!profile.email) gaps.push("email");
  if (!profile.phone) gaps.push("nomor WA");
  return gaps;
}

export function userProfileGaps(profile: UserProfile): string[] {
  return profile.phone ? [] : ["nomor WA"];
}

/** Kalimat ringkas untuk lencana di halaman. */
export function describeTenantProfile(profile: TenantProfile): string {
  const gaps = tenantProfileGaps(profile);
  return gaps.length === 0 ? "Profil lengkap" : `Belum ada: ${gaps.join(", ")}`;
}

export function describeUserProfile(profile: UserProfile): string {
  const gaps = userProfileGaps(profile);
  return gaps.length === 0 ? "Profil lengkap" : `Belum ada: ${gaps.join(", ")}`;
}

/**
 * Kalimat notis setelah menyimpan profil usaha. Menyebut apa yang tersimpan dan
 * apa yang masih kurang, supaya pemilik toko tahu kelanjutannya tanpa menebak.
 */
export function tenantProfileSentence(profile: TenantProfile): string {
  const gaps = tenantProfileGaps(profile);
  if (gaps.length === 0) {
    return `Profil usaha “${profile.name}” tersimpan lengkap.`;
  }
  return `Profil usaha “${profile.name}” tersimpan. Belum diisi: ${gaps.join(", ")}.`;
}

export function userProfileSentence(profile: UserProfile): string {
  const gaps = userProfileGaps(profile);
  if (gaps.length === 0) {
    return `Profil ${profile.name} tersimpan lengkap.`;
  }
  return `Profil ${profile.name} tersimpan. Belum diisi: ${gaps.join(", ")}.`;
}

/**
 * Nomor untuk ditampilkan: `+62 8123-4567-890`. Nomor yang tersimpan selalu
 * berbentuk digit + kode negara (`wa.me`), dan bentuk itulah yang jelek dibaca
 * orang — jadi tampilannya dirapikan di sini, bukan di tiap halaman.
 */
export function formatWhatsapp(phone: string | null): string {
  if (!phone) return "—";
  const rest = phone.slice(2);
  const groups = rest.match(/.{1,4}/g) ?? [];
  return `+${phone.slice(0, 2)} ${groups.join("-")}`;
}

/**
 * Tautan `wa.me` untuk nomor yang tersimpan (`null` kalau kosong). Dipakai tombol
 * “Chat WhatsApp” di halaman Profil: pemilik toko bisa mencoba nomornya sendiri
 * tanpa mengetik ulang.
 */
export function whatsappHref(phone: string | null): string | null {
  if (!phone) return null;
  const decision = normalizePhone(phone);
  return decision.valid && decision.value ? `https://wa.me/${decision.value}` : null;
}

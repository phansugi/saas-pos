/**
 * Keanggotaan tim — aturan murni.
 *
 * Dipakai bersama oleh server (`members.add`), halaman Tim & Peran, kedua store,
 * dan harness: satu undangan = satu baris `memberships` yang mengikat **email** ke
 * workspace, bukan perangkat. Karena itu "mendaftarkan akun tim baru dalam bisnis
 * yang sama" tidak butuh kata sandi bersama atau undangan perangkat — pemilik
 * menuliskan emailnya di sini, dan orang itu masuk sendiri lewat kode OTP ke email
 * tersebut (`otp.auth`), lalu mendarat di workspace yang sama karena
 * `tenants.listMine` menemukan keanggotaannya.
 *
 * Dua prinsipnya:
 *
 * 1. **Email yang diundang harus email yang bisa menerima kode.** Aturannya sama
 *    dengan halaman masuk (`checkEmail`) — kalau undangan menerima email yang
 *    ditolak jalur masuk, undangannya jadi janji yang tidak bisa ditepati.
 * 2. **Tidak ada eskalasi lewat undangan.** Hanya pemilik tenant yang boleh
 *    menetapkan peran `owner`; peran lain tidak bisa mencetak pemilik kedua untuk
 *    dirinya. Pagar ini ada di server (`members.add`), dan aturan yang sama dipakai
 *    halaman supaya tidak menawarkan pilihan yang akan ditolak.
 */

import { ROLE_LABELS, ROLES, isRole, type Role } from "./authz";
import { checkEmail, normalizeEmail } from "./otp";
import {
  roleAssignmentCheck,
  roleStateCheck,
  type RoleSettingLike,
} from "./roleSettings";

/** Awalan nilai pilihan peran tambahan di satu pemilih peran (`custom:<id>`). */
export const ROLE_CHOICE_CUSTOM_PREFIX = "custom:";

/**
 * Satu nilai untuk satu pemilih peran: peran bawaan apa adanya (`kasir`, …) atau
 * peran tambahan dengan awalan (`custom:<id>`).
 *
 * Dipakai formulir undangan **dan** kolom Peran di daftar anggota, supaya satu
 * orang tidak pernah ditanya dua kali (peran bawaan + peran kustom).
 */
export function roleChoiceValue(
  role: Role | null | undefined,
  customRoleId?: string | null,
): string {
  if (customRoleId) return `${ROLE_CHOICE_CUSTOM_PREFIX}${customRoleId}`;
  return role ?? "";
}

/**
 * Kebalikan `roleChoiceValue`. `null` = nilai tidak dikenal (jangan dikirim ke
 * server).
 *
 * Peran tambahan **berdiri sendiri**: pilihannya tidak membawa peran bawaan
 * mana pun — `role` bernilai `null`, dan anggota itu tidak punya peran dasar yang
 * tersimpan (bandingkan `parseRoleChoice` sebelum 2026-10-17 yang diam-diam
 * menuliskan Kasir sebagai peran dasar).
 */
export function parseRoleChoice(
  value: string,
): { role: Role | null; customRoleId: string | null } | null {
  const raw = (value ?? "").trim();
  if (raw.startsWith(ROLE_CHOICE_CUSTOM_PREFIX)) {
    const id = raw.slice(ROLE_CHOICE_CUSTOM_PREFIX.length).trim();
    return id.length > 0 ? { role: null, customRoleId: id } : null;
  }
  return isRole(raw) ? { role: raw, customRoleId: null } : null;
}

export interface TeamInviteInput {
  email: string;
  /** Nama tampil; kosong berarti diambil dari bagian sebelum `@`. */
  name?: string;
  /**
   * Peran **bawaan**. `null` hanya sah kalau undangan itu memakai peran tambahan
   * (`standaloneCustomRole`): peran tambahan berdiri sendiri, jadi tidak ada
   * peran dasar yang ikut dituliskan.
   */
  role: string | null;
}

export interface TeamInvite {
  email: string;
  name: string;
  /** `null` = anggota itu hanya memakai peran tambahan (berdiri sendiri). */
  role: Role | null;
}

export type TeamInviteValidation =
  | { ok: true; value: TeamInvite }
  | { ok: false; reason: string };

/** Batas panjang nama tampil anggota tim. */
export const MEMBER_NAME_MAX = 80;

/**
 * Memeriksa satu undangan sebelum dikirim ke server (atau sebelum ditulis store
 * demo). Nama kosong diisi dari email supaya daftar anggota tidak pernah kosong.
 */
export function validateTeamInvite(
  input: TeamInviteInput,
  options: {
    /**
     * Peran **bawaan** pengundang; `null` = pengundangnya sendiri memakai peran
     * tambahan. Pagar “hanya pemilik menetapkan pemilik” tetap berlaku.
     */
    actingRole: Role | null;
    /**
     * Penyesuaian peran bawaan workspace ini (`roleSettings`). Peran yang
     * dinonaktifkan/dihapus tidak ditawarkan — sama seperti yang dijawab server.
     * Kosong = semua peran bawaan seperti bawaannya.
     */
    roleSettings?: readonly RoleSettingLike[];
    /**
     * Undangan memakai **peran tambahan**, bukan peran bawaan.
     *
     * Peran tambahan berdiri sendiri: tidak ada peran bawaan yang ikut dikirim,
     * jadi tidak ada status peran bawaan yang perlu diperiksa. Pagar yang berlaku
     * tetap pagar peran tambahannya sendiri (aktif, fitur `rbac.custom`, dan tidak
     * melebihi wewenang pengundang).
     */
    standaloneCustomRole?: boolean;
  },
): TeamInviteValidation {
  const email = normalizeEmail(input.email);
  const shape = checkEmail(email);
  if (!shape.valid) {
    return { ok: false, reason: shape.reason ?? "Email tidak valid." };
  }

  /*
    Peran tambahan berdiri sendiri: tidak ada peran bawaan yang dituliskan, jadi
    yang diperiksa di sini bukan status peran bawaan mana pun — pagar peran
    tambahannya sendiri diperiksa pemanggil (`members.add`/store) sebelum barisnya
    ditulis.
  */
  const diminta = (input.role ?? "").trim();
  let role: Role | null = null;
  if (diminta === "") {
    if (!options.standaloneCustomRole) {
      return {
        ok: false,
        reason: `Pilih peran untuk anggota ini — ${ROLES.map((value) => ROLE_LABELS[value]).join(", ")}, atau satu peran tambahan.`,
      };
    }
  } else if (!isRole(diminta)) {
    return {
      ok: false,
      reason: `Peran tidak dikenal. Pilih salah satu: ${ROLES.map((value) => ROLE_LABELS[value]).join(", ")}.`,
    };
  } else {
    const allowed = roleAssignmentCheck(diminta, {
      actingRole: options.actingRole,
      settings: options.standaloneCustomRole ? [] : options.roleSettings,
    });
    if (!allowed.ok) return { ok: false, reason: allowed.reason };
    role = diminta;
  }

  const typed = (input.name ?? "").replace(/\s+/g, " ").trim();
  if (typed.length > MEMBER_NAME_MAX) {
    return { ok: false, reason: `Nama anggota maksimal ${MEMBER_NAME_MAX} karakter.` };
  }

  return {
    ok: true,
    value: {
      email,
      name: typed.length > 0 ? typed : (email.split("@")[0] || "Anggota"),
      role,
    },
  };
}

/**
 * Kalimat yang dipakai halaman Tim & Peran selama **identitas bisnis pengguna
 * aktif belum pasti** (store: `workspacePending`) — yaitu selama daftar
 * keanggotaan masih dibaca server, atau sesi perangkat ini masih memuat workspace
 * yang berbeda dari miliknya sendiri.
 *
 * Dalam keadaan itu mutation undangan belum punya tenant yang bisa dituju, jadi
 * store menolaknya dengan “Tenant belum siap. Coba lagi sebentar lagi.”.
 * Kalimat itu benar tetapi tidak menjelaskan apa pun kepada pemilik toko yang
 * baru masuk, karena itu tombolnya **dimatikan** dan yang tampil adalah alasan di
 * bawah ini — bukan galat setelah ditekan.
 */
export const WORKSPACE_PENDING_INVITE_NOTE =
  "Workspace belum tersambung ke server — tunggu sebentar, undangan belum bisa dikirim.";

export interface TeamInviteFormInput {
  /** Dari store: identitas bisnis pengguna aktif belum selesai dibaca server. */
  workspacePending: boolean;
  /**
   * `store.error`: alasan workspace belum tersambung — keanggotaan dinonaktifkan
   * pemilik, akun platform tidak boleh masuk tim ini, atau bisnisnya gagal
   * didaftarkan. Ketiganya keadaan yang sama bagi tombol ini: mutation-nya tidak
   * punya tenant yang bisa dituju.
   */
  error: string | null;
  /** Hasil `validateTeamInvite` atas isi formulir. */
  preview: TeamInviteValidation;
  /** Hasil `normalizePhone`; `null` kalau kolom nomornya memang kosong. */
  phoneCheck: PhoneCheck | null;
}

export type TeamInviteFormDecision =
  | { ok: true; value: TeamInvite }
  | { ok: false; reason: string };

/**
 * Satu tempat yang memutuskan tombol **Daftarkan ke tim** bisa ditekan atau tidak,
 * beserta kalimat alasannya.
 *
 * Urutannya disengaja: keadaan workspace diperiksa **lebih dulu**, karena selama
 * itu belum pasti tidak ada isi formulir yang bisa dikirim — pesan “email tidak
 * valid” pada saat itu hanya menyembunyikan sebab sebenarnya. Halaman memakai
 * keputusan ini untuk tiga hal sekaligus (tombol, kalimat di bawahnya, dan pagar
 * di `submitInvite`), jadi tidak ada tombol yang bisa ditekan tanpa alasannya
 * ikut terlihat.
 */
export function resolveTeamInviteForm(
  input: TeamInviteFormInput,
): TeamInviteFormDecision {
  if (input.workspacePending) {
    return { ok: false, reason: WORKSPACE_PENDING_INVITE_NOTE };
  }
  if (input.error) {
    return { ok: false, reason: `Undangan belum bisa dikirim — ${input.error}` };
  }
  if (!input.preview.ok) return { ok: false, reason: input.preview.reason };
  if (input.phoneCheck && !input.phoneCheck.valid) {
    return {
      ok: false,
      reason: input.phoneCheck.reason ?? "Nomor WhatsApp tidak valid.",
    };
  }
  return { ok: true, value: input.preview.value };
}

/**
 * Peran yang boleh ditawarkan pengundang. Pemilik boleh semuanya; peran lain tidak
 * boleh menawarkan `owner` (server tetap yang memutuskan).
 */
export function assignableRoles(actingRole: Role | null | undefined): Role[] {
  return actingRole === "owner"
    ? [...ROLES]
    : ROLES.filter((role) => role !== "owner");
}

/**
 * Kalimat untuk orang yang diundang: apa yang harus ia lakukan setelah namanya
 * dicatat. Ditulis di sini supaya halaman dan store demo tidak menjanjikan hal
 * yang berbeda dari yang benar-benar terjadi.
 */
export function inviteNextStep(invite: { email: string }): string {
  return `Minta ${invite.email} masuk di halaman Masuk dengan kode OTP ke email itu — ia akan langsung berada di workspace ini.`;
}

/** Nama aplikasi yang dipakai di subjek & isi email undangan. */
export const APP_NAME = "MesinPOS";

/**
 * Alamat halaman Masuk untuk email undangan.
 *
 * Diambil dari `SITE_URL` deployment — alamat yang sama dengan yang dipakai
 * Convex Auth untuk tautannya. Kalau variabelnya belum diset, `null` dikembalikan
 * dan emailnya menyebut "halaman Masuk MesinPOS" tanpa mengarang alamat: tautan
 * yang salah lebih buruk daripada tidak ada tautan.
 */
export function inviteLoginUrl(siteUrl?: string | null): string | null {
  const base = (siteUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/auth`;
}

/**
 * Isi email undangan anggota tim.
 *
 * Undangannya **tidak** membawa kata sandi atau tautan bertoken: jalan masuk
 * aplikasi ini adalah kode OTP ke email, dan kode itu hanya terbit kalau orangnya
 * sendiri memintanya di halaman Masuk. Jadi email ini hanya memberi tahu siapa
 * yang mengundang, ke workspace apa, sebagai peran apa, dan ke mana harus pergi —
 * tanpa satu pun rahasia yang bisa dipakai orang lain kalau emailnya salah kirim.
 */
export function inviteEmailContent(input: {
  workspace: string;
  email: string;
  name?: string;
  /** `null` = anggota itu hanya memakai peran tambahan (wajib sebut namanya). */
  role: Role | null;
  /**
   * Nama peran tambahan (kustom) yang dipakai anggota ini, kalau ia didaftarkan
   * dengan salah satunya. Tanpa ini, undangan yang memakai peran tambahan
   * berbunyi seolah izinnya izin peran bawaan — dan orang yang masuk jadi bingung
   * kenapa menunya berbeda dari yang tertulis di emailnya.
   */
  customRoleName?: string;
  /** Nama pengundang; kosong berarti tidak disebutkan. */
  invitedBy?: string;
  /** Alamat halaman Masuk; `null` = sebut halamannya tanpa alamat. */
  loginUrl?: string | null;
  appName?: string;
}): { subject: string; text: string } {
  const appName = input.appName ?? APP_NAME;
  const customRole = input.customRoleName?.trim();
  /*
    Peran tambahan **berdiri sendiri**: yang disebut hanya namanya, bukan
    "Kasir (peran kustom: …)" — peran dasar Kasir itu keterangan tersembunyi,
    dan penerima email tidak boleh mengira ia memegang dua peran sekaligus.
  */
  const roleLabel = customRole
    ? customRole
    : input.role
      ? ROLE_LABELS[input.role]
      : "anggota tim";
  const salam = input.name ? `Halo ${input.name},` : "Halo,";
  const pengundang = input.invitedBy
    ? `${input.invitedBy} mendaftarkan Anda`
    : "Anda didaftarkan";
  const tujuan = input.loginUrl ?? `halaman Masuk ${appName}`;

  return {
    subject: `Undangan masuk ke workspace ${input.workspace} (${appName})`,
    text: [
      salam,
      "",
      `${pengundang} sebagai ${roleLabel} di workspace "${input.workspace}" pada ${appName},`,
      "sebuah aplikasi kasir (POS) berbasis cloud.",
      "",
      "Cara masuknya tanpa kata sandi:",
      `1. Buka ${tujuan}`,
      `2. Isi email ini: ${input.email}`,
      "3. Masukkan kode 6 digit yang dikirim ke email ini.",
      "",
      `Setelah kode itu benar, Anda langsung berada di workspace ${input.workspace}`,
      `dengan peran ${roleLabel}. Tidak ada kata sandi yang perlu dibuat atau dibagikan.`,
      "",
      `Kalau Anda tidak mengenal pengundangnya, abaikan email ini: tanpa kode yang`,
      "Anda minta sendiri di halaman Masuk, tidak ada yang bisa masuk ke akun ini.",
    ].join("\n"),
  };
}

/** Keadaan pengiriman undangan yang tersimpan di keanggotaan. */
export interface TeamInviteDelivery {
  /** Kapan email benar-benar berangkat; `null` = belum tercatat terkirim. */
  sentAt: number | null;
  /** Saluran yang dipakai (`resend`, `uji`, `demo`); `null` = belum ada. */
  via: string | null;
  /** Pesan kegagalan pengiriman terakhir, kalau ada. */
  error: string | null;
  /** Berapa kali dicoba dikirim (termasuk kirim ulang manual). */
  attempts: number;
}

/** Bentuk yang dikembalikan server untuk satu keanggotaan. */
export const EMPTY_INVITE_DELIVERY: TeamInviteDelivery = {
  sentAt: null,
  via: null,
  error: null,
  attempts: 0,
};

/**
 * Kalimat status kirim undangan untuk pengundang.
 *
 * Dipakai halaman **dan** store demo supaya tidak ada dua cerita: pengiriman yang
 * gagal tidak pernah ditulis sebagai "terkirim", dan alamat uji atau mode demo
 * yang memang tidak mengirim email mengatakan hal itu apa adanya.
 */
export function inviteDeliverySentence(state: TeamInviteDelivery): string {
  if (state.error) {
    return `Undangan belum terkirim: ${state.error} Kirim ulang dari kolom Undangan.`;
  }
  if (state.via === "demo") {
    return "Mode demo: undangan tidak benar-benar dikirim lewat email, hanya tercatat di layar.";
  }
  if (state.via === "uji") {
    return "Alamat uji: undangan tidak dikirim lewat email (tercatat sebagai “uji”).";
  }
  if (state.sentAt) {
    return `Undangan terkirim lewat email${state.attempts > 1 ? ` (kirim ke-${state.attempts})` : ""}.`;
  }
  return "Belum ada undangan lewat email yang tercatat untuk anggota ini — pakai Kirim ulang untuk mengirimkannya.";
}

/* ---------------------------- WhatsApp ------------------------------- */

/**
 * Undangan lewat **WhatsApp** (`wa.me`).
 *
 * Nomor WA bukan jalur masuk: masuknya tetap kode OTP ke **email** yang diundang,
 * dan kode itu hanya terbit kalau orangnya memintanya sendiri. Jadi pesan WA di
 * sini adalah pemberitahuan + tautan halaman Masuk — bukan tautan bertoken, dan
 * bukan cara masuk kedua. Kalau nomornya salah, tidak ada yang bisa dipakai orang
 * lain dari pesan itu.
 */
export const WA_INVITE_VIA_LINK = "tautan";

export interface PhoneCheck {
  valid: boolean;
  /** Nomor dalam bentuk digit + kode negara (mis. `6281234567890`). */
  value?: string;
  reason?: string;
}

/**
 * Menormalkan nomor telepon Indonesia untuk WhatsApp.
 *
 * Aturan yang dipakai: buang semua pemisah, ubah awalan `0` atau `8` menjadi `62`,
 * dan tolak panjang di luar batas E.164 (8–15 digit). Bentuk inilah yang dituntut
 * `wa.me` — nomor bertanda `+` atau berspasi tidak dikenali tautannya.
 */
export function normalizePhone(raw: string): PhoneCheck {
  let digits = (raw ?? "").replace(/[^\d+]/g, "");
  digits = digits.replace(/\+/g, "");
  if (!digits) return { valid: false, reason: "Nomor WhatsApp kosong." };
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith("8")) digits = `62${digits}`;

  if (digits.length < 8 || digits.length > 15) {
    return {
      valid: false,
      reason: `Nomor WhatsApp harus 8–15 digit (termasuk kode negara), mis. 0812-3456-7890.`,
    };
  }
  return { valid: true, value: digits };
}

/**
 * Isi pesan undangan WhatsApp.
 *
 * Lebih pendek dari email, tetapi menyebut hal yang sama: siapa yang mengundang,
 * workspace mana, peran apa, dan bahwa masuknya memakai **email itu** dengan kode
 * OTP — supaya penerima tidak menunggu kode di WhatsApp.
 */
export function whatsappInviteText(input: {
  workspace: string;
  email: string;
  name?: string;
  /** `null` = anggota itu hanya memakai peran tambahan (wajib sebut namanya). */
  role: Role | null;
  /** Nama peran tambahan; kalau ada, **hanya** nama itu yang disebut. */
  customRoleName?: string;
  invitedBy?: string;
  loginUrl?: string | null;
  appName?: string;
}): string {
  const appName = input.appName ?? APP_NAME;
  const customRole = input.customRoleName?.trim();
  const roleLabel = customRole
    ? customRole
    : input.role
      ? ROLE_LABELS[input.role]
      : "anggota tim";
  const pengundang = input.invitedBy ? ` oleh ${input.invitedBy}` : "";
  const tujuan = input.loginUrl ?? `halaman Masuk ${appName}`;
  return [
    `Halo${input.name ? ` ${input.name}` : ""}! Anda didaftarkan${pengundang} sebagai ${roleLabel} di workspace "${input.workspace}" (${appName}).`,
    "",
    "Cara masuk tanpa kata sandi:",
    `1. Buka ${tujuan}`,
    `2. Isi email ini: ${input.email}`,
    "3. Masukkan kode 6 digit yang dikirim ke email tersebut.",
    "",
    `Setelah masuk, Anda langsung berada di workspace ${input.workspace}.`,
  ].join("\n");
}

export type WhatsappLinkResult =
  | { ok: true; url: string; phone: string }
  | { ok: false; reason: string };

/**
 * Tautan `wa.me` yang membuka percakapan WhatsApp dengan pesan sudah terisi.
 *
 * Dipakai halaman Tim & Peran: pengundang menekan tombol, WhatsApp terbuka di
 * percakapan orang itu, dan pesannya terkirim dari aplikasi milik pengundang.
 * Karena itu aplikasi **tidak** bisa mengklaim pesannya terkirim — yang dicatat
 * hanya bahwa tautannya dibuka dan berapa kali (lihat `waInviteSentence`).
 */
export function whatsappInviteUrl(input: {
  phone: string;
  text: string;
}): WhatsappLinkResult {
  const phone = normalizePhone(input.phone);
  if (!phone.valid || !phone.value) {
    return { ok: false, reason: phone.reason ?? "Nomor WhatsApp tidak valid." };
  }
  return {
    ok: true,
    phone: phone.value,
    url: `https://wa.me/${phone.value}?text=${encodeURIComponent(input.text)}`,
  };
}

/** Keadaan undangan WhatsApp untuk satu anggota. */
export interface TeamWaInvite {
  /** Kapan tautan undangan terakhir dibuka pengundang; `null` = belum pernah. */
  at: number | null;
  /** Berapa kali tautannya dibuka. */
  count: number;
}

export const EMPTY_WA_INVITE: TeamWaInvite = { at: null, count: 0 };

/** Kalimat status undangan WhatsApp untuk kolom di halaman Tim & Peran. */
export function waInviteSentence(state: TeamWaInvite): string {
  if (state.count === 0) return "Belum ada undangan WhatsApp dikirim.";
  return `Tautan WhatsApp dibuka ${state.count}× — pesannya dikirim dari aplikasi WhatsApp pengundang.`;
}

/* --------------------- ubah, aktif/nonaktif, hapus -------------------- */

/** Perubahan yang diminta untuk satu anggota tim; yang kosong tidak diubah. */
export interface TeamMemberDraft {
  name?: string;
  email?: string;
  /**
   * Peran bawaan yang baru. `null` melepas peran bawaan (anggota itu hanya
   * memakai peran tambahannya); `undefined` tidak mengubah peran.
   */
  role?: string | null;
  /** Kosong/`null` berarti nomor WhatsApp dihapus. */
  phone?: string | null;
  active?: boolean;
}

/** Bentuk akhir satu anggota tim setelah perubahan divalidasi. */
export interface TeamMemberEdit {
  name: string;
  email: string;
  /** `null` = anggota itu memakai peran tambahan (berdiri sendiri). */
  role: Role | null;
  phone: string | null;
  active: boolean;
}

export type TeamMemberEditValidation =
  | { ok: true; value: TeamMemberEdit; changed: string[] }
  | { ok: false; reason: string };

/** Label perubahan untuk notis & audit. */
export const MEMBER_CHANGE_LABELS: Record<string, string> = {
  name: "nama",
  email: "email",
  role: "peran",
  phone: "nomor WhatsApp",
  active: "status",
};

function tidyName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Memeriksa satu perubahan anggota tim (nama, email, peran, nomor WA, status).
 *
 * Dipakai halaman (pratinjau) **dan** server (`members.update`), jadi apa yang
 * ditawarkan halaman sama dengan apa yang diterima server. Tiga pagar yang penting
 * dan tidak boleh hilang:
 *
 *  1. **Workspace tidak boleh kehilangan pemilik terakhir** — menurunkan atau
 *     menonaktifkan pemilik terakhir ditolak, karena tidak ada lagi yang bisa
 *     mengelola langganan & tagihannya.
 *  2. **Hanya pemilik yang menyentuh peran pemilik** — pemilik menaikkan atau
 *     menurunkan pemilik lain; peran lain tidak bisa.
 *  3. **Status akun sendiri tidak dikunci dari sini** — akun yang sedang dipakai
 *     tidak bisa menonaktifkan dirinya sendiri (bisa menonaktifkan perannya
 *     sendiri sebagai pemilik, selama masih ada pemilik aktif lain).
 */
export function validateTeamMemberEdit(
  current: {
    membershipId: string;
    name: string;
    email: string;
    role: Role | null;
    phone: string | null;
    active: boolean;
  },
  draft: TeamMemberDraft,
  options: {
    /** Peran **bawaan** pengubah; peran tambahan tidak bisa menetapkan pemilik. */
    actingRole: Role | null;
    /** Keanggotaan pemakai yang sedang mengubah (untuk pagar diri sendiri). */
    actorMembershipId?: string | null;
    /** Jumlah pemilik **aktif** di workspace ini, termasuk anggota ini. */
    activeOwners: number;
    /** Email anggota lain di workspace ini (huruf kecil) — mendeteksi bentrok. */
    otherEmails?: string[];
    /**
     * Penyesuaian peran bawaan workspace ini (`roleSettings`): peran yang
     * dinonaktifkan/dihapus tidak boleh dipilih lagi untuk anggota ini.
     */
    roleSettings?: readonly RoleSettingLike[];
  },
): TeamMemberEditValidation {
  const name = draft.name === undefined ? current.name : tidyName(draft.name);
  if (name.length < 2 || name.length > MEMBER_NAME_MAX) {
    return { ok: false, reason: `Nama anggota harus 2–${MEMBER_NAME_MAX} karakter.` };
  }

  const email =
    draft.email === undefined ? current.email : normalizeEmail(draft.email);
  const emailCheck = checkEmail(email);
  if (!emailCheck.valid) {
    return { ok: false, reason: emailCheck.reason ?? "Email tidak valid." };
  }
  if ((options.otherEmails ?? []).includes(email)) {
    return {
      ok: false,
      reason: "Email itu sudah dipakai anggota lain di workspace ini.",
    };
  }

  const role = draft.role === undefined ? current.role : draft.role;
  if (role !== null && !isRole(role)) {
    return { ok: false, reason: "Peran tidak dikenal." };
  }
  const peranBawaan: Role | null = role === null ? null : role;

  /*
    Peran yang dinonaktifkan/dihapus workspace tidak boleh **dipilih**; peran yang
    sedang dipakai anggota ini tetap boleh dipertahankan (`currentRole`). Aturan
    “hanya pemilik menyentuh peran pemilik” diperiksa di bawah, dengan kalimatnya
    sendiri — halaman ini sudah lama membedakan keduanya.

    `role` yang `null` berarti anggota itu memakai peran tambahan: tidak ada peran
    bawaan yang perlu diperiksa statusnya di sini (pagar peran tambahannya ada di
    `roles.assign`/`members.add`).
  */
  if (role !== null) {
    const stateOk = roleStateCheck(role, options.roleSettings, current.role);
    if (!stateOk.ok) return { ok: false, reason: stateOk.reason };
  }

  let phone = current.phone;
  if (draft.phone !== undefined) {
    const raw = (draft.phone ?? "").trim();
    if (!raw) {
      phone = null;
    } else {
      const nomor = normalizePhone(raw);
      if (!nomor.valid || !nomor.value) {
        return { ok: false, reason: nomor.reason ?? "Nomor WhatsApp tidak valid." };
      }
      phone = nomor.value;
    }
  }

  const active = draft.active === undefined ? current.active : draft.active;

  // Peran pemilik hanya boleh disentuh sesama pemilik: mengangkat pemilik baru
  // maupun menurunkan pemilik yang ada.
  if (
    role !== current.role &&
    (role === "owner" || current.role === "owner") &&
    options.actingRole !== "owner"
  ) {
    return { ok: false, reason: "Hanya pemilik dapat mengubah peran pemilik." };
  }

  // Menonaktifkan pemilik juga urusan pemilik: kalau tidak, manajer bisa
  // mematikan akses pemilik workspace-nya sendiri.
  if (current.role === "owner" && !active && options.actingRole !== "owner") {
    return { ok: false, reason: "Hanya pemilik dapat menonaktifkan pemilik." };
  }

  const melepasPemilik =
    current.role === "owner" &&
    current.active &&
    (role !== "owner" || !active);
  if (melepasPemilik && options.activeOwners <= 1) {
    return {
      ok: false,
      reason:
        "Workspace harus punya minimal satu pemilik aktif. Angkat anggota lain menjadi pemilik dulu.",
    };
  }

  if (
    options.actorMembershipId &&
    options.actorMembershipId === current.membershipId &&
    current.active &&
    !active
  ) {
    return {
      ok: false,
      reason: "Akun Anda sendiri tidak bisa dinonaktifkan dari sini.",
    };
  }

  const changed = (
    [
      ["name", name !== current.name],
      ["email", email !== current.email],
      ["role", peranBawaan !== current.role],
      ["phone", phone !== current.phone],
      ["active", active !== current.active],
    ] as const
  )
    .filter(([, berubah]) => berubah)
    .map(([field]) => field);

  return { ok: true, value: { name, email, role: peranBawaan, phone, active }, changed };
}

/* ------------------- perapian baris anggota lama (satu peran) ------------------- */

/**
 * Apa yang harus dilakukan pada satu baris keanggotaan lama.
 *
 *  - `none` — barisnya sudah benar (peran bawaan **atau** peran tambahan).
 *  - `drop-base-role` — peran tambahan yang sah menjadi satu-satunya peran.
 *  - `drop-custom-role` — peran bawaan yang tersimpan yang menjadi satu-satunya
 *    peran (peran tambahannya hilang/nonaktif, atau anggotanya Pemilik).
 */
export type LegacyRoleCleanupAction =
  | "none"
  | "drop-base-role"
  | "drop-custom-role";

/**
 * Sebab keputusan di atas, ditulis dalam bentuk yang bisa dibaca operator CLI.
 *
 *  - `sudah-satu-peran` — tidak ada dua peran tersimpan; tidak disentuh.
 *  - `pemilik-tetap-pemilik` — Pemilik harus memegang seluruh izin, jadi peran
 *    tambahannya yang dilepas (bukan peran Pemiliknya).
 *  - `peran-tambahan-hilang` / `peran-tambahan-nonaktif` /
 *    `peran-tambahan-tenant-lain` — peran tambahannya tidak berlaku, dan yang
 *    berlaku sekarang adalah peran bawaan tersimpan; yang dilepas peran
 *    tambahannya supaya aksesnya tidak berubah.
 *  - `peran-tambahan-berdiri-sendiri` — peran tambahannya sah; peran bawaan yang
 *    menumpang di belakangnya dilepas.
 */
export type LegacyRoleCleanupReason =
  | "sudah-satu-peran"
  | "pemilik-tetap-pemilik"
  | "peran-tambahan-hilang"
  | "peran-tambahan-nonaktif"
  | "peran-tambahan-tenant-lain"
  | "peran-tambahan-berdiri-sendiri";

export interface LegacyRoleCleanupDecision {
  action: LegacyRoleCleanupAction;
  reason: LegacyRoleCleanupReason;
}

/**
 * Memutuskan perapian satu baris keanggotaan yang masih menyimpan **peran bawaan
 * bersama peran tambahannya** (baris yang ditulis sebelum 2026-10-17).
 *
 * Aturan yang dijaga: **akses orangnya tidak berubah** karena pembersihan ini.
 * Karena itu yang dilepas adalah peran yang **tidak berlaku** sekarang:
 *
 *  - peran tambahan yang sah (aktif, milik tenant yang sama) → peran bawaan yang
 *    dilepas, sebab `resolveMembershipPermissions` sudah memakai peran tambahan itu
 *    persis;
 *  - peran tambahan yang hilang/nonaktif/milik tenant lain → peran tambahannya yang
 *    dilepas, sebab izin yang berlaku sekarang adalah peran bawaan tersimpan;
 *  - anggotanya **Pemilik** → peran tambahannya yang dilepas. Pemilik harus selalu
 *    memegang seluruh izin (termasuk `billing.manage`); membiarkan peran tambahan
 *    menang membuat workspace bisa terkunci dari langganannya sendiri, sedangkan
 *    melepas peran Pemiliknya bisa menghilangkan pemilik aktif terakhir.
 *
 * Baris yang sudah hanya punya satu peran tidak disentuh — termasuk baris “tanpa
 * peran” (tidak punya keduanya), yang memang keadaan sah setelah peran tambahan
 * dilepas dan bukan urusan pembersihan ini.
 */
export function legacyRoleCleanupDecision(input: {
  role?: Role | null;
  customRoleId?: string | null;
  /** Tenant pemilik baris keanggotaan ini. */
  tenantId?: string;
  /**
   * Peran tambahan yang ditunjuk `customRoleId`; `null` = tidak ditemukan
   * (sudah dihapus). Kosong = tidak perlu diperiksa karena tidak ada peran
   * tambahan.
   */
  customRole?: { tenantId?: string; active?: boolean } | null;
}): LegacyRoleCleanupDecision {
  const role = input.role ?? null;
  const customRoleId = input.customRoleId ?? null;
  if (!role || !customRoleId) {
    return { action: "none", reason: "sudah-satu-peran" };
  }

  if (role === "owner") {
    return { action: "drop-custom-role", reason: "pemilik-tetap-pemilik" };
  }

  const customRole = input.customRole;
  if (!customRole) {
    return { action: "drop-custom-role", reason: "peran-tambahan-hilang" };
  }
  if (customRole.active === false) {
    return { action: "drop-custom-role", reason: "peran-tambahan-nonaktif" };
  }
  if (
    input.tenantId !== undefined &&
    customRole.tenantId !== undefined &&
    customRole.tenantId !== input.tenantId
  ) {
    return { action: "drop-custom-role", reason: "peran-tambahan-tenant-lain" };
  }

  return { action: "drop-base-role", reason: "peran-tambahan-berdiri-sendiri" };
}

/* ------------------------ keanggotaan yang dinonaktifkan ------------------------ */

/**
 * Kalimat yang dibaca anggota yang keanggotaannya dinonaktifkan pemiliknya.
 *
 * Kenapa ada di modul aturan bersama: keadaan ini dulu **menjatuhkan render**.
 * Keanggotaan nonaktif membuat setiap langganan Convex menjawab “Akses ditolak:
 * Anda bukan anggota aktif tenant ini”, dan galat langganan menggagalkan halaman
 * yang memuatnya — anggota yang dinonaktifkan melihat “Halaman ini gagal dimuat”
 * beserta ajakan “hubungi dukungan”, padahal yang terjadi hanya aksesnya ditutup.
 * Sekarang klien mengenali keanggotaan nonaktif dari penanda `active` di
 * `tenants.listMine` **sebelum** berlangganan, lalu menampilkan kalimat ini apa
 * adanya lewat notis “Workspace belum tersambung ke server”.
 */
export const MEMBERSHIP_SUSPENDED_NOTE =
  "Keanggotaan Anda di workspace ini dinonaktifkan oleh pemilik bisnis. Data workspace ditutup sampai pemilik mengaktifkannya lagi.";

/** Apakah pesan ini soal keanggotaan yang dinonaktifkan? */
export function isMembershipSuspended(
  message: string | null | undefined,
): boolean {
  return (message ?? "").includes(MEMBERSHIP_SUSPENDED_NOTE);
}

/**
 * Apakah baris keanggotaan ini masih bisa dipakai untuk membuka workspace?
 *
 * `active` yang tidak ada dianggap aktif: klien bisa saja lebih baru daripada
 * deployment yang menjawabnya, dan menerjemahkan “field belum ada” sebagai
 * “dinonaktifkan” akan mengunci semua orang dari workspace-nya sendiri.
 */
export function isActiveMembership(
  row: { active?: boolean } | null | undefined,
): boolean {
  return row?.active !== false;
}

/**
 * Bolehkah anggota ini dihapus dari tim?
 *
 * Menghapus keanggotaan **bukan** menghapus akun: baris `users` tetap ada (orangnya
 * mungkin anggota workspace lain), yang hilang hanya aksesnya ke workspace ini.
 * Pagarnya sama dengan pengubahan status: jangan sampai workspace kehilangan
 * pemilik aktifnya, dan jangan biarkan seseorang menghapus aksesnya sendiri.
 */
export function validateTeamMemberRemoval(
  target: { membershipId: string; role: Role | null; active: boolean },
  options: {
    /** Peran **bawaan** penghapus; `null` = ia memakai peran tambahan. */
    actingRole: Role | null;
    actorMembershipId?: string | null;
    activeOwners: number;
  },
): { ok: true } | { ok: false; reason: string } {
  if (options.actorMembershipId && options.actorMembershipId === target.membershipId) {
    return {
      ok: false,
      reason: "Akun Anda sendiri tidak bisa dihapus dari tim. Minta pemilik lain melakukannya.",
    };
  }
  if (target.role === "owner") {
    if (options.actingRole !== "owner") {
      return { ok: false, reason: "Hanya pemilik dapat menghapus pemilik." };
    }
    if (target.active && options.activeOwners <= 1) {
      return {
        ok: false,
        reason:
          "Workspace harus punya minimal satu pemilik aktif. Angkat anggota lain menjadi pemilik dulu.",
      };
    }
  }
  return { ok: true };
}

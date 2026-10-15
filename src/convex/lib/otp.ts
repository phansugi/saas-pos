/**
 * Aturan **kode OTP sekali pakai** untuk masuk tanpa kata sandi.
 *
 * Login dan daftar sengaja jadi **satu** jalur: yang membedakan akun baru dan
 * akun lama hanya apakah `users` sudah punya baris untuk email itu — pengguna
 * tidak perlu memilih "Masuk" atau "Daftar", dan tidak ada kata sandi yang
 * harus dibuat, diingat, atau disimpan. Satu-satunya bukti kepemilikan akun
 * adalah **kode yang tiba di email itu**.
 *
 * Modul ini murni (tanpa database, tanpa jaringan) supaya aturan yang sama
 * dipakai backend (`src/convex/otp.ts`), store demo di klien, dan harness
 * `scripts/verify-otp.mjs` — termasuk jalur yang sulit diuji lewat deployment:
 * kode kedaluwarsa, kode terpakai, kode terkunci setelah percobaan salah, dan
 * batas kirim ulang.
 *
 * Empat pagar yang membuat kode 6 digit tetap layak dipercaya:
 *
 * 1. **Disimpan sebagai hash**, bukan teksnya (`hashOtpCode`), jadi membaca
 *    tabel `emailOtps` tidak langsung memberi kode yang masih hidup.
 * 2. **Berbatas waktu** (`OTP_TTL_MS`) — kode mati sendiri tanpa perlu pekerja
 *    terjadwal, karena kedaluwarsanya dihitung saat dibaca.
 * 3. **Berbatas percobaan** (`OTP_MAX_ATTEMPTS`) — menebak 6 digit tidak bisa
 *    diulang tanpa batas; kode yang salah terus akan terkunci.
 * 4. **Sekali pakai + satu kode hidup per email** (`OTP_RESEND_COOLDOWN_MS`),
 *    jadi kode lama tidak bisa dipakai setelah kode baru diminta.
 */

import { sha256Hex, timingSafeEqualHex } from "./hash";

/** Panjang kode yang dikirim ke email. */
export const OTP_CODE_LENGTH = 6;
/** Masa hidup kode: cukup untuk membuka email, tidak cukup untuk ditebak. */
export const OTP_TTL_MS = 10 * 60 * 1000;
/** Jeda minimum antarpermintaan kode untuk satu email. */
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
/** Berapa kali kode yang sama boleh salah sebelum dikunci. */
export const OTP_MAX_ATTEMPTS = 5;
/** Batas jumlah kode per email per jam — pagar terhadap penyalahgunaan kirim. */
export const OTP_MAX_PER_HOUR = 5;
/** Nama domain email yang dicadangkan untuk pengujian (RFC 2606). */
export const TEST_EMAIL_DOMAIN = "test";

export interface EmailCheck {
  valid: boolean;
  /** Alasan dalam Bahasa Indonesia; dipakai apa adanya oleh UI. */
  reason?: string;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const EMAIL_MAX_LENGTH = 254;
const LOCAL_MAX_LENGTH = 64;

/** Email selalu dibandingkan dalam bentuk ternormalisasi. */
export function normalizeEmail(raw: string): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Memeriksa **email valid** secara sengaja ketat: bentuk `nama@domain.tld`,
 * tanpa spasi, dengan panjang yang wajar. Email yang lolos di sini adalah
 * email yang benar-benar bisa menerima kode.
 */
export function checkEmail(raw: string): EmailCheck {
  const email = normalizeEmail(raw);
  if (!email) return { valid: false, reason: "Masukkan email Anda." };
  if (email.length > EMAIL_MAX_LENGTH) {
    return { valid: false, reason: "Email terlalu panjang." };
  }
  if (/\s/.test(email)) {
    return { valid: false, reason: "Email tidak boleh mengandung spasi." };
  }

  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) {
    return {
      valid: false,
      reason: "Email harus berbentuk nama@domain, mis. nama@bisnis.id.",
    };
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > LOCAL_MAX_LENGTH) {
    return { valid: false, reason: "Bagian sebelum @ terlalu panjang." };
  }
  if (local.startsWith(".") || local.endsWith(".")) {
    return { valid: false, reason: "Email tidak boleh diawali atau diakhiri titik." };
  }
  if (!domain.includes(".")) {
    return {
      valid: false,
      reason: "Domain email harus punya titik, mis. nama@bisnis.id.",
    };
  }
  if (!EMAIL_SHAPE.test(email)) {
    return {
      valid: false,
      reason: "Format email tidak valid. Contoh yang benar: nama@bisnis.id.",
    };
  }
  return { valid: true };
}

/** Menyembunyikan sebagian email untuk ditampilkan: `budi@toko.id` → `b***@toko.id`. */
export function maskEmail(raw: string): string {
  const email = normalizeEmail(raw);
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 1)}${"*".repeat(Math.min(3, Math.max(1, local.length - 1)))}@${domain}`;
}

/** Sumber acak: `crypto.getRandomValues` kalau ada, kalau tidak `Math.random`. */
export function randomSource(): () => number {
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } })
    .crypto;
  if (cryptoApi?.getRandomValues) {
    return () => {
      const buffer = new Uint8Array(1);
      cryptoApi.getRandomValues!(buffer);
      return buffer[0] / 256;
    };
  }
  return () => Math.random();
}

/** Kode 6 digit dari nol, mis. `"014287"`. Tidak pernah mulai dari spasi/kosong. */
export function generateOtpCode(random: () => number = randomSource()): string {
  let code = "";
  for (let index = 0; index < OTP_CODE_LENGTH; index += 1) {
    const digit = Math.min(9, Math.max(0, Math.floor(random() * 10)));
    code += String(digit);
  }
  return code;
}

/** Apakah kode berbentuk tepat 6 digit angka? */
export function isOtpCodeShape(code: string): boolean {
  return new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`).test((code ?? "").trim());
}

/**
 * Nama provider Convex Auth untuk jalur masuk beridentitas.
 *
 * Ditaruh di sini (bukan di `convex/authEmail.ts`) supaya **satu** string dipakai
 * baik oleh konfigurasi provider di server maupun klien (`signIn(...)` di halaman
 * backstage) — dua tempat yang harus sepakat, dan berkas ini satu-satunya yang
 * bisa dibaca keduanya. Lihat `convex/authEmail.ts` untuk providernya.
 */
export const AUTH_EMAIL_PROVIDER_ID = "resend-otp";

/** Email uji berdomain `.test` — domain yang tidak bisa didaftarkan siapa pun. */
export function isTestEmail(raw: string): boolean {
  const email = normalizeEmail(raw);
  return email.endsWith(`.${TEST_EMAIL_DOMAIN}`);
}

/**
 * Apakah email uji boleh masuk memakai kode tetap `OTP_DEV_CODE`.
 *
 * Syaratnya dua-duanya: deployment memasang kodenya, **dan** alamatnya berdomain
 * `.test` yang tidak bisa didaftarkan siapa pun. Karena itu email nyata tidak
 * pernah bisa memakai jalur ini, sedangkan pengujian otomatis (`@…test`) bisa
 * menempuh jalur "kode → masuk" yang lengkap tanpa penyedia email.
 */
export function isTestLoginEnabled(
  email: string,
  devCode?: string | null,
): boolean {
  const code = (devCode ?? "").trim();
  return isOtpCodeShape(code) && isTestEmail(email);
}

/**
 * Kode yang benar-benar dipakai server untuk satu permintaan.
 *
 * `devCode` adalah **kait pengujian yang sengaja dibuat sempit**: kode tetap
 * hanya berlaku kalau (a) deployment menyetel variabelnya, **dan** (b) email
 * tujuannya berdomain `.test` yang tidak bisa didaftarkan siapa pun. Jadi ia
 * tidak pernah bisa dipakai untuk masuk ke akun nyata, dan tanpa variabel itu
 * ia sepenuhnya tidak berpengaruh.
 */
export function resolveOtpCode(input: {
  email: string;
  devCode?: string | null;
  random?: () => number;
}): string {
  if (isTestLoginEnabled(input.email, input.devCode)) {
    return (input.devCode ?? "").trim();
  }
  return generateOtpCode(input.random);
}

/**
 * Hash kode yang disimpan. Email ikut di-hash supaya hash satu kode tidak sama
 * antar-email, dan `pepper` (variabel deployment) menutup celah tebak-hash
 * offline 6 digit kalau isi tabel bocor.
 */
export function hashOtpCode(code: string, email: string, pepper = ""): string {
  return sha256Hex(`${normalizeEmail(email)}:${(code ?? "").trim()}:${pepper}`);
}

/** Bandingkan kode yang diketik dengan hash tersimpan, tanpa bocor lewat waktu. */
export function otpCodeMatches(input: {
  code: string;
  email: string;
  codeHash: string;
  pepper?: string;
}): boolean {
  return timingSafeEqualHex(
    hashOtpCode(input.code, input.email, input.pepper ?? ""),
    input.codeHash,
  );
}

export function otpExpiresAt(now: number): number {
  return now + OTP_TTL_MS;
}

/** Kapan email yang sama boleh meminta kode lagi. */
export function otpResendAt(now: number): number {
  return now + OTP_RESEND_COOLDOWN_MS;
}

/** Baris `emailOtps` yang sudah ada (hanya field yang dipakai aturan). */
export interface OtpRow {
  email: string;
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  consumedAt?: number | null;
}

export type OtpStatus = "aktif" | "kedaluwarsa" | "terpakai" | "terkunci";

/** Keadaan kode **saat dibaca**; tidak ada status yang perlu dirapikan lebih dulu. */
export function otpStatus(
  row: Pick<OtpRow, "attempts" | "expiresAt" | "consumedAt">,
  now: number,
  maxAttempts: number = OTP_MAX_ATTEMPTS,
): OtpStatus {
  if (row.consumedAt) return "terpakai";
  if (row.attempts >= maxAttempts) return "terkunci";
  if (now > row.expiresAt) return "kedaluwarsa";
  return "aktif";
}

const STATUS_REASON: Record<Exclude<OtpStatus, "aktif">, string> = {
  kedaluwarsa: "Kode sudah kedaluwarsa. Minta kode baru.",
  terpakai: "Kode ini sudah dipakai. Minta kode baru.",
  terkunci: "Terlalu banyak kode yang salah. Minta kode baru.",
};

export interface RequestDecision {
  allowed: boolean;
  /** 0 kalau boleh; kalau tidak, berapa lama lagi harus menunggu. */
  retryAfterMs: number;
  reason?: string;
}

/**
 * Bolehkah email ini meminta kode sekarang?
 *
 * Dua pagar sekaligus: **jeda kirim ulang** (satu kode hidup per email — kode
 * lama tidak boleh bercampur dengan kode baru) dan **batas per jam** (alamat
 * yang dibombardir tidak boleh menghabiskan kuota kirim). `recent` adalah baris
 * emailOtps dalam satu jam terakhir untuk email itu.
 */
export function evaluateOtpRequest(input: {
  now: number;
  recent: Pick<OtpRow, "createdAt" | "consumedAt">[];
  cooldownMs?: number;
  maxPerHour?: number;
}): RequestDecision {
  const cooldownMs = input.cooldownMs ?? OTP_RESEND_COOLDOWN_MS;
  const maxPerHour = input.maxPerHour ?? OTP_MAX_PER_HOUR;

  const live = input.recent.filter(
    (row) => !row.consumedAt && row.createdAt + cooldownMs > input.now,
  );
  if (live.length > 0) {
    const youngest = Math.max(...live.map((row) => row.createdAt));
    const retryAfterMs = youngest + cooldownMs - input.now;
    return {
      allowed: false,
      retryAfterMs,
      reason: `Kode sudah dikirim. Tunggu ${Math.ceil(retryAfterMs / 1000)} detik sebelum minta kode lagi.`,
    };
  }

  if (input.recent.length >= maxPerHour) {
    const oldest = Math.min(...input.recent.map((row) => row.createdAt));
    const retryAfterMs = Math.max(0, oldest + 60 * 60 * 1000 - input.now);
    return {
      allowed: false,
      retryAfterMs,
      reason: `Terlalu banyak permintaan kode untuk email ini. Coba lagi dalam ${Math.max(1, Math.ceil(retryAfterMs / 60000))} menit.`,
    };
  }

  return { allowed: true, retryAfterMs: 0 };
}

export interface VerifyDecision {
  ok: boolean;
  /** Alasan penolakan dalam Bahasa Indonesia; kosong kalau `ok`. */
  reason?: string;
  status: OtpStatus;
  /** Sisa percobaan setelah pengecekan ini (0 kalau sudah terkunci). */
  remainingAttempts: number;
  /** Percobaan yang perlu disimpan ulang ke database (sudah termasuk ini). */
  attempts: number;
}

/**
 * Memutuskan satu percobaan masuk.
 *
 * Kode yang salah **selalu** menambah hitungan percobaan — termasuk saat kode
 * sudah kedaluwarsa, supaya mencoba kode acak tidak pernah gratis. Kode yang
 * benar hanya diterima kalau statusnya masih `aktif`, dan keputusan ini yang
 * dipakai backend untuk menandai baris terpakai (sekali pakai).
 */
export function verifyOtpCode(input: {
  row: Pick<OtpRow, "attempts" | "expiresAt" | "consumedAt"> | null;
  code: string;
  email: string;
  codeHash?: string | null;
  now: number;
  pepper?: string;
  maxAttempts?: number;
}): VerifyDecision {
  // Email tanpa kode sama sekali dibedakan dari kode yang sudah mati: "belum
  // minta kode" bukan "kode Anda kedaluwarsa", dan pengguna tidak boleh dibuat
  // mencari kode yang tidak pernah ada.
  if (!input.row) {
    return {
      ok: false,
      reason: "Belum ada kode untuk email ini. Minta kode baru dulu.",
      status: "kedaluwarsa",
      remainingAttempts: 0,
      attempts: 0,
    };
  }

  const maxAttempts = input.maxAttempts ?? OTP_MAX_ATTEMPTS;
  const row = input.row;
  const status = otpStatus(row, input.now, maxAttempts);
  const attempts = row.attempts + 1;
  const remainingAttempts = Math.max(0, maxAttempts - attempts);

  if (status !== "aktif") {
    // Kode yang sudah mati tidak menambah hitungan: statusnya sudah menolak
    // percobaan berikutnya dengan sendirinya, jadi angkanya tidak ikut membengkak.
    return {
      ok: false,
      reason: STATUS_REASON[status],
      status,
      remainingAttempts: Math.max(0, maxAttempts - row.attempts),
      attempts: row.attempts,
    };
  }

  const codeShapeOk = isOtpCodeShape(input.code);
  const codeMatches =
    codeShapeOk &&
    typeof input.codeHash === "string" &&
    otpCodeMatches({
      code: input.code,
      email: input.email,
      codeHash: input.codeHash,
      pepper: input.pepper,
    });

  if (!codeMatches) {
    return {
      ok: false,
      reason:
        remainingAttempts > 0
          ? `Kode tidak sesuai. Sisa ${remainingAttempts} percobaan.`
          : "Terlalu banyak kode yang salah. Minta kode baru.",
      status: remainingAttempts > 0 ? "aktif" : "terkunci",
      remainingAttempts,
      attempts,
    };
  }

  return { ok: true, status: "terpakai", remainingAttempts, attempts };
}

/** Nama awal yang wajar dari email, dipakai saat akun dibuat pertama kali. */
export function defaultNameFromEmail(email: string): string {
  const local = normalizeEmail(email).split("@")[0] ?? "";
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  return cleaned.length >= 2 ? cleaned : "Pemilik";
}

export interface EmailTransport {
  kind: "resend" | "unconfigured";
  /** Diisi kalau `unconfigured`, untuk ditampilkan ke pengguna. */
  reason?: string;
}

/**
 * Saluran pengiriman kode. Tanpa kunci penyedia email, permintaan kode
 * **ditolak dengan jujur** — tidak ada kode yang "terkirim" padahal tidak.
 * Aplikasi tetap bisa dipakai penuh di mode demo (kode tampil di kotak surat
 * pengembangan klien), dan begitu `RESEND_API_KEY` diisi, jalur email hidup.
 */
export function resolveEmailTransport(env: {
  resendApiKey?: string | null;
  from?: string | null;
}): EmailTransport {
  const key = (env.resendApiKey ?? "").trim();
  const from = (env.from ?? "").trim();
  if (!key) {
    return {
      kind: "unconfigured",
      reason:
        "Pengiriman email belum dikonfigurasi di server (RESEND_API_KEY belum diset).",
    };
  }
  if (!from) {
    return {
      kind: "unconfigured",
      reason:
        "Alamat pengirim email belum dikonfigurasi (OTP_EMAIL_FROM belum diset).",
    };
  }
  return { kind: "resend" };
}

/** Pengirim email yang dipakai: `OTP_EMAIL_FROM` atau alamat bawaan MesinPOS. */
export function otpEmailFrom(configured?: string | null): string {
  const from = (configured ?? "").trim();
  return from || "MesinPOS <otp@mesinpos.id>";
}

/** Isi email kode masuk — dipakai aksi pengirim dan diperiksa harness. */
export function otpEmailContent(input: {
  code: string;
  ttlMinutes?: number;
  appName?: string;
}): { subject: string; text: string } {
  const appName = input.appName ?? "MesinPOS";
  const ttlMinutes = input.ttlMinutes ?? Math.round(OTP_TTL_MS / 60000);
  return {
    subject: `${input.code} adalah kode masuk ${appName} Anda`,
    text: [
      `Kode masuk ${appName} Anda: ${input.code}`,
      "",
      `Kode ini berlaku ${ttlMinutes} menit dan hanya bisa dipakai sekali.`,
      "Jangan bagikan kode ini kepada siapa pun, termasuk yang mengaku dari",
      `${appName}.`,
      "",
      "Kalau Anda tidak meminta kode ini, abaikan saja email ini — akun Anda",
      "tidak berubah dan tidak ada kata sandi yang perlu diganti.",
    ].join("\n"),
  };
}

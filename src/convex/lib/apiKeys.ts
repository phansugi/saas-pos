/**
 * Kunci API (`api.access`, Phase 4 / Enterprise Intelligence) — aturan murni.
 *
 * Dipakai oleh `src/convex/apiAccess.ts` (membuat, mencabut, dan memverifikasi
 * kunci di endpoint HTTP), halaman API & Webhook, kedua store, dan harness.
 *
 * Bentuk kuncinya sengaja dua bagian:
 *
 * ```
 * mp_<publicId>_<secret>
 * ```
 *
 * `publicId` adalah **indeks pencarian**: boleh disimpan apa adanya, boleh
 * tampil di daftar kunci, dan tidak rahasia. `secret` **tidak pernah disimpan**
 * — yang tersimpan hanya `sha256(publicId + ":" + secret)`, jadi bocornya isi
 * tabel tidak langsung memberi orang kunci yang bisa dipakai. Memasukkan
 * `publicId` ke dalam hash berfungsi sebagai salt: dua kunci dengan secret yang
 * kebetulan sama tetap punya hash berbeda, dan hash satu baris tidak bisa
 * dipindah ke baris lain.
 *
 * Izin (scope) sebuah kunci **tidak boleh melebihi izin pembuatnya** — pagar
 * yang sama seperti peran kustom (`lib/rbac.ts`), karena kunci API adalah bentuk
 * lain dari "bertindak sebagai seseorang": kunci buatan manajer tidak boleh
 * membaca langganan hanya karena pemilik punya izin itu.
 */

import { can, PERMISSION_LABELS, type Permission, type Role } from "./authz";
import { sanitizePermissions } from "./rbac";
import { sha256Hex, timingSafeEqualHex } from "./hash";

export const API_KEY_PREFIX = "mp_";
/** Panjang `publicId` (indeks pencarian, bukan rahasia). */
export const API_KEY_LOOKUP_LENGTH = 10;
/** Panjang `secret`; 32 karakter base62 ≈ 190 bit entropi. */
export const API_KEY_SECRET_LENGTH = 32;
export const API_KEY_NAME_MIN = 3;
export const API_KEY_NAME_MAX = 40;
/** Batas jumlah kunci hidup per tenant (yang sudah dicabut tidak dihitung). */
export const MAX_ACTIVE_API_KEYS = 20;

/**
 * Alfabet `publicId` membuang karakter yang mudah tertukar saat dibaca manusia
 * (0/O, 1/l/I) karena id ini muncul di daftar dan di pesan dukungan.
 */
export const API_KEY_LOOKUP_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
/** Alfabet `secret`, case-sensitive. */
export const API_KEY_SECRET_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Endpoint HTTP yang benar-benar dilayani (`src/convex/http.ts`).
 *
 * Tabel ini adalah sumber kebenaran untuk dua hal sekaligus: scope yang bisa
 * dipilih saat membuat kunci, dan pemeriksaan scope di endpoint. Jadi tidak
 * mungkin ada scope yang ditawarkan di halaman tapi tidak dipakai endpoint mana
 * pun, atau endpoint tanpa scope yang jelas. `scope: null` = hanya butuh kunci
 * yang sah.
 */
export interface ApiResource {
  resource: string;
  /** `GET` membaca, `POST` menulis. Satu path boleh punya keduanya. */
  method: "GET" | "POST";
  path: string;
  scope: Permission | null;
  label: string;
  /**
   * True untuk endpoint tulis. Diturunkan dari `method` supaya tidak ada dua
   * daftar yang bisa berbeda; dipakai halaman (menandai scope tulis), harness,
   * dan `http.ts` saat memilih jalur baca/tulis.
   */
  write: boolean;
}

export const API_RESOURCES: ApiResource[] = [
  {
    resource: "ping",
    method: "GET",
    path: "/api/v1/ping",
    scope: null,
    label: "Cek kunci & identitas tenant",
    write: false,
  },
  {
    resource: "sales",
    method: "GET",
    path: "/api/v1/sales",
    scope: "report.view",
    label: "Penjualan selesai terbaru",
    write: false,
  },
  {
    // Satu-satunya endpoint tulis (Phase 4 lanjutan): pesanan masuk dari sistem
    // luar. Scope-nya izin domain yang sudah ada (`pos.sell`), bukan scope tulis
    // khusus API — supaya kunci tidak bisa menulis hal yang perannya sendiri
    // tidak boleh lakukan (lihat `scopeAllowed`).
    resource: "sales.create",
    method: "POST",
    path: "/api/v1/sales",
    scope: "pos.sell",
    label: "Membuat penjualan dari sistem luar (pesanan masuk)",
    write: true,
  },
  {
    resource: "products",
    method: "GET",
    path: "/api/v1/products",
    scope: "inventory.view",
    label: "Katalog beserta stok yang bisa dijual",
    write: false,
  },
  {
    resource: "payables",
    method: "GET",
    path: "/api/v1/payables",
    scope: "payable.view",
    label: "Hutang usaha yang masih terbuka",
    write: false,
  },
];

/** Endpoint tulis; dipakai halaman untuk menandai & mendokumentasikan. */
export const API_WRITE_RESOURCES: ApiResource[] = API_RESOURCES.filter(
  (resource) => resource.write,
);

/** Resource untuk sebuah `method` + `path`; null kalau tidak ada yang cocok. */
export function findApiResource(
  method: string,
  path: string,
): ApiResource | null {
  return (
    API_RESOURCES.find(
      (resource) => resource.method === method && resource.path === path,
    ) ?? null
  );
}

/** Scope sebuah resource; `null` kalau tidak butuh scope, `undefined` kalau asing. */
export function resourceScope(resource: string): Permission | null | undefined {
  const found = API_RESOURCES.find((row) => row.resource === resource);
  return found ? found.scope : undefined;
}

/** True kalau resource ini endpoint tulis; `undefined` kalau resource asing. */
export function isWriteResource(resource: string): boolean | undefined {
  const found = API_RESOURCES.find((row) => row.resource === resource);
  return found ? found.write : undefined;
}

/**
 * Scope yang boleh dibawa sebuah kunci — diturunkan dari endpoint di atas,
 * jadi daftarnya tidak pernah lebih panjang daripada yang benar-benar dilayani.
 */
export interface ApiScopeOption {
  permission: Permission;
  label: string;
  /** Endpoint yang memakai scope ini, untuk ditampilkan di halaman. */
  endpoint: string;
  /** Benar untuk scope yang membuka endpoint tulis (`POST`). */
  write: boolean;
}

export const API_SCOPE_OPTIONS: ApiScopeOption[] = API_RESOURCES.filter(
  (row): row is ApiResource & { scope: Permission } => row.scope !== null,
).map((row) => ({
  permission: row.scope,
  label: PERMISSION_LABELS[row.scope],
  endpoint: `${row.method} ${row.path}`,
  /** Tulis = endpoint ini mengubah data, jadi scope-nya perlu diperhatikan. */
  write: row.write,
}));

export const API_SCOPES: Permission[] = API_SCOPE_OPTIONS.map(
  (option) => option.permission,
);

/** Masa berlaku yang boleh dipilih; 0 = tidak kedaluwarsa. */
export const API_KEY_EXPIRY_OPTIONS: { days: number; label: string }[] = [
  { days: 30, label: "30 hari" },
  { days: 90, label: "90 hari" },
  { days: 365, label: "1 tahun" },
  { days: 0, label: "Tanpa kedaluwarsa" },
];

export interface ApiKeyRecord {
  publicId: string;
  secretHash: string;
  active: boolean;
  revokedAt?: number | null;
  expiresAt?: number | null;
}

export interface ApiKeyStatusInput {
  active: boolean;
  revokedAt?: number | null;
  expiresAt?: number | null;
}

export type ApiKeyStatus = "active" | "revoked" | "expired" | "disabled";

/** Sumber byte acak. Dapat diganti di uji supaya kuncinya deterministik. */
export type RandomBytes = (length: number) => Uint8Array;

/** RNG bawaan: Web Crypto (`crypto.getRandomValues`) — tersedia di Convex & Bun. */
export function defaultRandomBytes(length: number): Uint8Array {
  const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => Uint8Array } })
    .crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error(
      "Sumber acak kriptografis tidak tersedia; kunci API tidak boleh dibuat tanpa itu.",
    );
  }
  const bytes = new Uint8Array(length);
  cryptoApi.getRandomValues(bytes);
  return bytes;
}

/** Token acak dari alfabet: setiap byte diambil modulo panjang alfabet. */
export function randomToken(
  length: number,
  alphabet: string,
  randomBytes: RandomBytes = defaultRandomBytes,
): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += alphabet[bytes[index] % alphabet.length];
  }
  return out;
}

/** `sha256(publicId + ":" + secret)` — yang disimpan, bukan rahasianya. */
export function hashApiSecret(publicId: string, secret: string): string {
  return sha256Hex(`${publicId}:${secret}`);
}

export interface MintedApiKey {
  plaintext: string;
  publicId: string;
  secret: string;
  secretHash: string;
}

/**
 * Membuat kunci baru. `randomBytes` bisa diganti di uji; produksi memakai Web
 * Crypto. Rahasianya hanya ada di nilai kembalian ini — sekali ditampilkan.
 */
export function mintApiKey(options: { randomBytes?: RandomBytes } = {}): MintedApiKey {
  const rng = options.randomBytes ?? defaultRandomBytes;
  const publicId = randomToken(API_KEY_LOOKUP_LENGTH, API_KEY_LOOKUP_ALPHABET, rng);
  const secret = randomToken(API_KEY_SECRET_LENGTH, API_KEY_SECRET_ALPHABET, rng);
  return {
    plaintext: `${API_KEY_PREFIX}${publicId}_${secret}`,
    publicId,
    secret,
    secretHash: hashApiSecret(publicId, secret),
  };
}

/** Memecah kunci yang dikirim klien menjadi `publicId` + `secret`, atau null. */
export function parseApiKey(
  plaintext: string,
): { publicId: string; secret: string } | null {
  if (typeof plaintext !== "string" || !plaintext.startsWith(API_KEY_PREFIX)) {
    return null;
  }
  const body = plaintext.slice(API_KEY_PREFIX.length);
  const separator = body.indexOf("_");
  if (separator <= 0) return null;
  const publicId = body.slice(0, separator);
  const secret = body.slice(separator + 1);
  if (publicId.length !== API_KEY_LOOKUP_LENGTH) return null;
  if (secret.length !== API_KEY_SECRET_LENGTH) return null;
  const allowedLookup = new RegExp(`^[${API_KEY_LOOKUP_ALPHABET}]+$`);
  const allowedSecret = new RegExp(
    `^[A-Za-z0-9]+$`,
  );
  if (!allowedLookup.test(publicId) || !allowedSecret.test(secret)) return null;
  return { publicId, secret };
}

/** Bentuk aman untuk ditampilkan & disimpan di kolom: rahasianya tidak ada. */
export function maskApiKey(publicId: string): string {
  return `${API_KEY_PREFIX}${publicId}_••••••••`;
}

export function keyStatus(key: ApiKeyStatusInput, now: number): ApiKeyStatus {
  if (!key.active || key.revokedAt) return "revoked";
  if (key.expiresAt && key.expiresAt <= now) return "expired";
  return "active";
}

export type ApiKeyVerification =
  | { ok: true; publicId: string }
  | { ok: false; reason: string };

/**
 * Verifikasi kunci yang datang dari jaringan terhadap baris yang tersimpan.
 *
 * Urutannya penting untuk keamanan maupun pesan: bentuk kunci diperiksa dulu
 * (murah), lalu status (dicabut/kedaluwarsa) dengan pesan yang bisa
 * ditindaklanjuti, dan **baru** sesudah itu rahasianya dibandingkan — sehingga
 * kunci yang salah bentuk tidak pernah menyentuh hash.
 */
export function verifyApiKey(
  plaintext: string,
  record: ApiKeyRecord | null,
  now: number,
): ApiKeyVerification {
  const parsed = parseApiKey(plaintext);
  if (!parsed) return { ok: false, reason: "Format kunci API tidak dikenal." };
  if (!record || record.publicId !== parsed.publicId) {
    return { ok: false, reason: "Kunci API tidak dikenal." };
  }
  if (!timingSafeEqualHex(record.secretHash, hashApiSecret(parsed.publicId, parsed.secret))) {
    return { ok: false, reason: "Kunci API tidak valid." };
  }
  const status = keyStatus(record, now);
  if (status === "revoked") return { ok: false, reason: "Kunci API sudah dicabut." };
  if (status === "expired") return { ok: false, reason: "Kunci API sudah kedaluwarsa." };
  if (status === "disabled") return { ok: false, reason: "Kunci API sedang nonaktif." };
  return { ok: true, publicId: parsed.publicId };
}

/** Buang scope tak dikenal & duplikat, kembalikan urutan kanonik. */
export function sanitizeApiScopes(scopes: readonly string[] | null | undefined): Permission[] {
  const allowed = new Set(API_SCOPES as string[]);
  return sanitizePermissions(scopes ?? []).filter((scope) => allowed.has(scope));
}

export interface ApiKeyInput {
  name: string;
  scopes: readonly string[];
  /** 0 = tanpa kedaluwarsa. */
  expiresInDays?: number;
}

export interface ApiKeyDraft {
  name: string;
  scopes: Permission[];
  expiresAt: number | null;
}

export type ApiKeyValidation =
  | { ok: true; value: ApiKeyDraft }
  | { ok: false; reason: string };

/**
 * Validasi permintaan pembuatan kunci. `activeCount` menjaga batas jumlah kunci
 * hidup; kunci yang sudah dicabut tidak ikut dihitung karena tidak lagi bisa
 * dipakai.
 */
export function validateApiKeyInput(
  input: ApiKeyInput,
  options: {
    /**
     * Izin **efektif** pembuat saat ini (peran bawaan atau peran kustom yang
     * berlaku) — bukan hanya `role`, supaya anggota berperan kustom juga tidak
     * bisa memberi scope di luar izinnya.
     */
    permissions: readonly Permission[];
    existingNames?: readonly string[];
    activeCount?: number;
    now?: number;
  },
): ApiKeyValidation {
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < API_KEY_NAME_MIN || name.length > API_KEY_NAME_MAX) {
    return {
      ok: false,
      reason: `Nama kunci harus ${API_KEY_NAME_MIN}–${API_KEY_NAME_MAX} karakter.`,
    };
  }
  const used = new Set(
    (options.existingNames ?? []).map((value) => value.trim().toLowerCase()),
  );
  if (used.has(name.toLowerCase())) {
    return { ok: false, reason: `Kunci "${name}" sudah ada; pakai nama lain supaya bisa dibedakan.` };
  }

  if ((options.activeCount ?? 0) >= MAX_ACTIVE_API_KEYS) {
    return {
      ok: false,
      reason: `Maksimal ${MAX_ACTIVE_API_KEYS} kunci hidup per tenant; cabut yang tidak dipakai dulu.`,
    };
  }

  const requested = [...(input.scopes ?? [])];
  const unknown = [...new Set(requested.filter((scope) => !API_SCOPES.includes(scope as Permission)))];
  if (unknown.length > 0) {
    return {
      ok: false,
      reason: `Scope di luar daftar API: ${unknown.join(", ")}.`,
    };
  }
  const scopes = sanitizeApiScopes(requested);
  if (scopes.length === 0) {
    return { ok: false, reason: "Pilih minimal satu scope — kunci tanpa scope tidak bisa memanggil apa pun." };
  }

  const allowed = new Set(options.permissions);
  const lacking = scopes.filter((scope) => !allowed.has(scope));
  if (lacking.length > 0) {
    return {
      ok: false,
      reason: `Anda tidak bisa memberi kunci dengan izin yang Anda sendiri tidak punya: ${lacking
        .map((scope) => PERMISSION_LABELS[scope])
        .join(", ")}.`,
    };
  }

  const days = input.expiresInDays ?? 90;
  if (days < 0) {
    return { ok: false, reason: "Masa berlaku tidak boleh negatif." };
  }
  if (days > 3650) {
    return { ok: false, reason: "Masa berlaku maksimal 10 tahun; pakai “tanpa kedaluwarsa” kalau perlu." };
  }
  const now = options.now ?? Date.now();
  const expiresAt = days === 0 ? null : now + days * 24 * 60 * 60 * 1000;

  return { ok: true, value: { name, scopes, expiresAt } };
}

/**
 * Apakah kunci ini boleh memakai `scope`, **dilihat dari peran pembuatnya saat
 * ini**?
 *
 * Dua syarat, dan keduanya harus benar: scope-nya memang ada di kunci itu, dan
 * peran pembuatnya masih memegang izin tersebut. Syarat kedua membuat peran yang
 * diturunkan (atau ditugaskan ke peran kustom yang lebih sempit) langsung
 * mempersempit kunci-kunci yang pernah dibuatnya — tanpa perlu mencabut kunci
 * satu per satu. Pemilik tidak butuh pengecualian: `can("owner", …)` selalu
 * benar. Peran tak dikenal otomatis gagal karena `can` mengembalikan `false`.
 */
export function scopeAllowed(
  creatorRole: Role,
  keyScopes: readonly Permission[],
  scope: Permission,
): boolean {
  return sanitizeApiScopes(keyScopes).includes(scope) && can(creatorRole, scope);
}

/** Ringkas sebuah kunci untuk daftar. */
export function describeApiKey(key: {
  name: string;
  scopes: readonly string[];
}): string {
  return `${key.name.trim()} · ${sanitizeApiScopes(key.scopes).length} scope`;
}

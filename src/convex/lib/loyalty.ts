/**
 * Member & diskon member (`member.discount`) — fitur modul UMKM, Phase 2.
 *
 * Toko retail mikro hidup dari pelanggan langganan: "Bu Sari, member, diskon
 * 5%". Tanpa fitur ini kasir menghitung diskon di kepala dan mengetiknya manual
 * di kolom diskon — angka yang tidak bisa diaudit dan gampang salah.
 *
 * Yang dijaga di sini:
 *
 * 1. **Diskon dihitung dari data member, bukan dari input kasir.** Kasir memilih
 *    member; persentasenya datang dari catatan member di server. Klien boleh
 *    menampilkan pratinjau dengan aturan yang sama, tetapi yang dicatat adalah
 *    hitungan server.
 * 2. **Diskon member dan diskon manual digabung dengan batas yang jelas**:
 *    totalnya tidak pernah melebihi subtotal, dan PPN dihitung setelah keduanya
 *    (lihat `discountBreakdown`).
 * 3. **Member nonaktif tidak mendapat diskon** — dinonaktifkan berarti berhenti.
 * 4. Murni, tanpa dependensi Convex, supaya backend, kasir, dan harness memakai
 *    perhitungan yang sama.
 *
 * Nama berkas/namespace memakai kata "loyalty" karena `src/convex/members.ts`
 * sudah dipakai untuk **anggota tim** (undangan, peran) — ini pelanggan, bukan
 * staf.
 */

export const MIN_MEMBER_NAME_LENGTH = 2;
export const MAX_MEMBER_NAME_LENGTH = 60;
/** Batas diskon member yang masuk akal; di atas ini bukan lagi diskon retail. */
export const MAX_DISCOUNT_PCT = 50;
export const MAX_MEMBER_CODE_LENGTH = 10;

/** Kode member dipakai kasir untuk mencari: huruf besar, angka, dan `-`. */
const MEMBER_CODE_PATTERN = /^[A-Z][A-Z0-9-]{1,9}$/;

export interface MemberInput {
  name: string;
  code?: string;
  phone?: string;
  /** Persen diskon per transaksi; 0 berarti member tanpa diskon. */
  discountPct?: number;
  active?: boolean;
}

export interface Member {
  code: string;
  name: string;
  phone?: string;
  discountPct: number;
  active: boolean;
}

export interface MemberConfigResult {
  ok: boolean;
  value?: Member;
  reason?: string;
}

export function normaliseMemberCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Nomor telepon: digit saja setelah pemisah dirapikan (`+62 812-3456-7890`). */
export function normalisePhone(value: string): string {
  return value.trim().replace(/[\s().-]/g, "");
}

/**
 * Usulan kode member dari namanya, dipakai halaman Member supaya pemilik toko
 * tidak perlu mengarang kode sendiri. Kode tetap divalidasi server.
 */
export function suggestMemberCode(name: string, taken: readonly string[] = []): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("");
  const base = initials
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, MAX_MEMBER_CODE_LENGTH);

  let candidate = MEMBER_CODE_PATTERN.test(base) ? base : "MBR";
  let attempt = 2;
  while (taken.includes(candidate)) {
    const suffix = `-${attempt}`;
    candidate = `${candidate.slice(0, MAX_MEMBER_CODE_LENGTH - suffix.length)}${suffix}`;
    attempt += 1;
  }
  return candidate;
}

/**
 * Menormalkan sekaligus memvalidasi data member. Dipakai jalur tulis server dan
 * harness; klien boleh memanggilnya untuk memberi tahu kesalahan lebih awal.
 */
export function resolveMemberInput(
  input: MemberInput,
  takenCodes: readonly string[] = [],
): MemberConfigResult {
  const name = (input.name ?? "").replace(/\s+/g, " ").trim();
  if (name.length < MIN_MEMBER_NAME_LENGTH || name.length > MAX_MEMBER_NAME_LENGTH) {
    return {
      ok: false,
      reason: `Nama member wajib diisi, ${MIN_MEMBER_NAME_LENGTH}–${MAX_MEMBER_NAME_LENGTH} karakter.`,
    };
  }

  const code = normaliseMemberCode(input.code ?? "") || suggestMemberCode(name, takenCodes);
  if (!MEMBER_CODE_PATTERN.test(code) || code.length > MAX_MEMBER_CODE_LENGTH) {
    return {
      ok: false,
      reason: `Kode member "${input.code ?? ""}" tidak valid (2–${MAX_MEMBER_CODE_LENGTH} karakter huruf/angka/-, diawali huruf).`,
    };
  }

  let phone: string | undefined;
  if (input.phone !== undefined && input.phone.trim() !== "") {
    phone = normalisePhone(input.phone);
    if (!/^\+?\d{8,15}$/.test(phone)) {
      return { ok: false, reason: "Nomor telepon member tidak valid (8–15 digit)." };
    }
  }

  const discountPct = Math.trunc(Number(input.discountPct ?? 0));
  if (!Number.isFinite(discountPct) || discountPct < 0) {
    return { ok: false, reason: "Diskon member tidak boleh negatif." };
  }
  if (discountPct > MAX_DISCOUNT_PCT) {
    return { ok: false, reason: `Diskon member maksimal ${MAX_DISCOUNT_PCT}%.` };
  }

  return {
    ok: true,
    value: { code, name, phone, discountPct, active: input.active ?? true },
  };
}

/** Diskon member dalam rupiah bulat; tidak pernah melebihi subtotal. */
export function memberDiscount(subtotal: number, discountPct: number): number {
  const base = Math.max(0, Math.trunc(Number(subtotal) || 0));
  const pct = Math.max(0, Math.min(MAX_DISCOUNT_PCT, Math.trunc(Number(discountPct) || 0)));
  return Math.min(base, Math.round((base * pct) / 100));
}

export interface SaleDiscountInput {
  subtotal: number;
  /** Member yang dipilih kasir; kosong berarti transaksi tanpa member. */
  member?: { name: string; discountPct: number; active?: boolean } | null;
  /** Diskon manual yang diketik kasir (rupiah). */
  manualDiscount?: number;
}

export interface SaleDiscountBreakdown {
  subtotal: number;
  memberDiscount: number;
  manualDiscount: number;
  /** Diskon yang benar-benar dipakai; selalu ≤ subtotal. */
  totalDiscount: number;
  /** Dasar pengenaan PPN: subtotal − total diskon. */
  net: number;
  /** Alasan diskon member tidak diberikan (member nonaktif, dsb.). */
  reason?: string;
}

/**
 * Satu-satunya tempat diskon member dan diskon manual digabung. Dipakai
 * `pos.createSale` (server), kasir (pratinjau), dan harness.
 *
 * Member nonaktif tidak diberi diskon **dan tidak menggagalkan transaksinya**:
 * kasir tetap bisa menjual, diskonnya saja yang tidak berlaku, dan alasannya
 * dikembalikan supaya UI bisa menjelaskannya.
 */
export function discountBreakdown(input: SaleDiscountInput): SaleDiscountBreakdown {
  const subtotal = Math.max(0, Math.trunc(Number(input.subtotal) || 0));

  let memberDiscountValue = 0;
  let reason: string | undefined;

  if (input.member) {
    if (input.member.active === false) {
      reason = `Member ${input.member.name} tidak aktif, jadi diskonnya tidak dipakai.`;
    } else if (input.member.discountPct > 0) {
      memberDiscountValue = memberDiscount(subtotal, input.member.discountPct);
    }
  }

  const manualDiscount = Math.max(
    0,
    Math.min(subtotal, Math.trunc(Number(input.manualDiscount) || 0)),
  );
  const totalDiscount = Math.min(subtotal, memberDiscountValue + manualDiscount);

  return {
    subtotal,
    memberDiscount: memberDiscountValue,
    manualDiscount,
    totalDiscount,
    net: subtotal - totalDiscount,
    reason,
  };
}

/** Ringkasan untuk kartu daftar: "MBR · 5%". */
export function describeMember(member: Pick<Member, "code" | "discountPct">): string {
  return member.discountPct > 0 ? `${member.code} · ${member.discountPct}%` : `${member.code} · tanpa diskon`;
}

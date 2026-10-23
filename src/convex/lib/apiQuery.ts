/**
 * Parameter kueri API v1 yang dipakai bersama — aturan murni.
 *
 * Dua hal yang dulu tidak ada di `/api/v1` tapi dibutuhkan platform mitra:
 *
 * 1. **Rentang tanggal eksplisit** (`from`/`to`) alih-alih hanya `days`/`since`
 *    yang bergeser sendiri. `from` inklusif, `to` eksklusif — batas setengah
 *    terbuka ini membuat dua tarikan berurutan (`…&to=X` lalu `from=X&…`) tidak
 *    pernah menghitung baris yang sama dua kali.
 * 2. **Paginasi berbasis kursor** yang stabil di antara tarikan: kursor
 *    menyebut baris terakhir yang sudah dikirim (`waktu|kunci`), bukan offset
 *    yang bergeser ketika ada baris baru masuk di depan.
 *
 * Keduanya menerima nilai epoch milidetik **atau** tanggal ISO 8601, karena
 * platform sering menyimpan waktu sebagai string ISO. Nilai yang tidak bisa
 * diurai ditolak (400) dengan alasan yang menyebut parameternya — lebih baik
 * daripada diam-diam memakai jendela bawaan yang salah.
 */

export interface BoundaryParse {
  ok: true;
  /** `null` kalau parameternya tidak dikirim. */
  value: number | null;
}

export type BoundaryResult = BoundaryParse | { ok: false; reason: string };

/** Titik waktu dari epoch milidetik (`1770000000000`) atau ISO 8601. */
export function parseDateBoundary(
  raw: string | null | undefined,
  label: string,
): BoundaryResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const text = raw.trim();
  if (text.length === 0) {
    return { ok: false, reason: `\`${label}\` tidak boleh kosong; hilangkan parameternya kalau tidak dipakai.` };
  }
  const numeric = /^-?\d+$/.test(text) ? Number(text) : NaN;
  const value = Number.isFinite(numeric) ? numeric : Date.parse(text);
  if (!Number.isFinite(value)) {
    return {
      ok: false,
      reason: `\`${label}\` harus epoch milidetik (mis. 1770000000000) atau tanggal ISO 8601 (mis. 2026-10-01T00:00:00Z).`,
    };
  }
  return { ok: true, value };
}

export type RangeResult =
  | { ok: true; from: number | null; to: number | null }
  | { ok: false; reason: string };

/** Rentang `from`/`to` yang sudah diperiksa urutannya. */
export function parseDateRange(
  fromRaw: string | null | undefined,
  toRaw: string | null | undefined,
): RangeResult {
  const from = parseDateBoundary(fromRaw, "from");
  if (!from.ok) return from;
  const to = parseDateBoundary(toRaw, "to");
  if (!to.ok) return to;
  if (from.value !== null && to.value !== null && from.value >= to.value) {
    return {
      ok: false,
      reason:
        "`from` harus lebih awal dari `to` (from inklusif, to eksklusif). Untuk satu titik waktu, longgarkan salah satunya.",
    };
  }
  return { ok: true, from: from.value, to: to.value };
}

/** Pemisah kursor: waktu & kunci tidak boleh mengandung karakter ini. */
const CURSOR_SEPARATOR = "|";

/**
 * Kursor halaman = baris terakhir yang sudah dikirim, ditulis `waktu|kunci`.
 *
 * `waktu` membuat batas bawah/atas bisa dihitung server tanpa memindai ulang,
 * sedangkan `kunci` (nomor struk, nomor GRN, kode pelanggan) memecah baris yang
 * lahir pada milidetik yang sama — tanpa itu, dua baris serempak bisa terlewat
 * atau terkirim dua kali di perbatasan halaman.
 */
export function encodeCursor(at: number, key: string): string {
  return `${at}${CURSOR_SEPARATOR}${key}`;
}

export interface DecodedCursor {
  at: number;
  key: string;
}

export type CursorParse =
  | { ok: true; value: DecodedCursor | null }
  | { ok: false; reason: string };

export function decodeCursor(raw: string | null | undefined): CursorParse {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const text = raw.trim();
  if (text.length === 0) return { ok: true, value: null };
  const separator = text.indexOf(CURSOR_SEPARATOR);
  if (separator <= 0 || separator === text.length - 1) {
    return {
      ok: false,
      reason:
        "`cursor` tidak dikenal; salin nilai `nextCursor` dari balasan sebelumnya apa adanya.",
    };
  }
  const at = Number(text.slice(0, separator));
  const key = text.slice(separator + 1);
  if (!Number.isFinite(at) || at < 0) {
    return {
      ok: false,
      reason:
        "`cursor` tidak dikenal; salin nilai `nextCursor` dari balasan sebelumnya apa adanya.",
    };
  }
  return { ok: true, value: { at, key } };
}

/** Status penjualan yang boleh disaring; `all` = tanpa saringan. */
export const SALE_STATUS_FILTERS = ["completed", "void", "all"] as const;
export type SaleStatusFilter = (typeof SALE_STATUS_FILTERS)[number];

export function parseSaleStatus(
  raw: string | null | undefined,
): { ok: true; value: SaleStatusFilter } | { ok: false; reason: string } {
  const text = (raw ?? "").trim().toLowerCase();
  if (text.length === 0) return { ok: true, value: "completed" };
  if ((SALE_STATUS_FILTERS as readonly string[]).includes(text)) {
    return { ok: true, value: text as SaleStatusFilter };
  }
  return {
    ok: false,
    reason: `\`status\` hanya boleh ${SALE_STATUS_FILTERS.join(", ")}.`,
  };
}

/**
 * Kode toko dinormalkan ke huruf besar; pemilihan toko tidak peka huruf besar.
 * Nilai kosong berarti “toko pertama workspace” (perilaku lama).
 */
export function normalizeStoreCodeParam(
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) return null;
  const code = raw.trim();
  return code.length === 0 ? null : code.toUpperCase();
}

/**
 * Pesan galat yang dibaca manusia — satu tempat yang mengubah apa pun yang
 * dilempar server menjadi kalimat, untuk **halaman tenant maupun backstage**.
 *
 * Kenapa ada: yang sampai ke layar pengguna dulu adalah bungkusan mentah Convex,
 * persis seperti yang dilaporkan pemilik repo —
 *
 *   [CONVEX M(platform:deleteTenant)] [Request ID: 3393af0945f63028] Server Error
 *   Uncaught Error: Ini workspace Anda sendiri. Menghapusnya akan menghapus akun
 *   yang sedang Anda pakai — … at handler (../src/convex/platform.ts:1295:27)
 *   Called by client
 *
 * Itu bukan pesan, itu jejak teknis: id permintaan, nama fungsi internal, nama
 * berkas + nomor baris, dan kalimat “Called by client”. Yang dikerjakan modul ini:
 *
 * 1. **Galat domain lewat `ConvexError`** — server mengirim alasan yang memang
 *    ditulis untuk dibaca (`error.data`), bukan pesan yang disensor jadi “Server
 *    Error”. `readableErrorMessage` mengambil `data` itu lebih dulu.
 * 2. **Bungkusan teknis dibersihkan** sebagai cadangan untuk galat lain, supaya
 *    layar tidak pernah menampilkan `[Request ID: …]`, `at handler (…)`, atau
 *    “Called by client”.
 * 3. **Selalu ada kalimat pengganti.** Kalau tidak ada isi yang bisa dibaca, yang
 *    tampil bukan string kosong atau “Server Error”, melainkan penjelasan singkat
 *    bahwa gangguan datang dari server + apa yang bisa dicoba.
 *
 * Kalimat yang **ditulis klien** (validasi formulir, mis. “Jumlah permintaan harus
 * bilangan bulat lebih dari 0.”) juga lewat modul ini: masuk sebagai string dan
 * keluar apa adanya, jadi satu kotak galat bisa menampung keduanya tanpa merusak
 * kalimat yang sudah baik.
 *
 * Aturannya murni (tanpa Convex, DOM, atau jaringan) supaya bisa diuji harness
 * tanpa deployment — dan supaya setiap halaman memakai kalimat yang sama.
 */

/** Kalimat pengganti saat isi galat tidak bisa dibaca sama sekali. */
export const ERROR_FALLBACK =
  "Server menolak permintaan ini tanpa alasan yang bisa dibaca. Coba lagi sebentar; kalau berulang, salin detail teknisnya untuk diperiksa.";

/** Judul pendek di atas kalimat galat. */
export const ERROR_TITLE = "Tidak bisa dilanjutkan";

/** Penanda awal pesan asli di dalam bungkusan Convex. */
const MESSAGE_PREFIXES = ["ConvexError: ", "Uncaught Error: ", "Uncaught ConvexError: "];

/** Baris teknis yang tidak pernah perlu dibaca pengguna. */
function isTechnicalLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return (
    /^\[CONVEX [A-Z]\(/.test(trimmed) ||
    /^\[Request ID:/.test(trimmed) ||
    /^at\s/.test(trimmed) ||
    /^Called by client/.test(trimmed) ||
    /^Server Error$/.test(trimmed) ||
    /^Uncaught (Error|ConvexError)/.test(trimmed)
  );
}

/**
 * Mencari kalimat manusia di dalam teks galat sedetail apa pun bentuknya:
 * bungkusan `[CONVEX …]`, beberapa baris jejak, atau awalan `Uncaught Error:`.
 * `null` berarti tidak ada yang bisa dibaca.
 */
function messageInside(raw: string): string | null {
  let rest = raw;
  for (const prefix of MESSAGE_PREFIXES) {
    const at = rest.lastIndexOf(prefix);
    if (at >= 0) {
      rest = rest.slice(at + prefix.length);
      break;
    }
  }

  const lines = rest
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isTechnicalLine(line));
  if (lines.length === 0) return null;

  // Kalimat aslinya ada di baris pertama yang bukan baris teknis; sisanya
  // (kalau ada) dibuang di sini dan hanya dipakai sebagai “detail teknis”.
  const sentence = lines[0].replace(/\s+/g, " ").trim();
  return sentence.length > 0 ? sentence : null;
}

/**
 * Apakah objek ini membawa muatan `ConvexError`?
 *
 * Sengaja diperiksa berdasarkan bentuk (`data` string), bukan `instanceof`:
 * galat bisa datang dari bundel Convex yang berbeda (klien vs harness), dan yang
 * penting bagi tampilan hanya “ada kalimat yang memang ditulis server”.
 */
function convexErrorData(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const data = (error as { data?: unknown }).data;
  if (typeof data === "string" && data.trim().length > 0) return data.trim();
  if (typeof data === "object" && data !== null) {
    const nested = (data as { message?: unknown }).message;
    if (typeof nested === "string" && nested.trim().length > 0) return nested.trim();
  }
  return null;
}

/** Teks mentah galat apa pun — untuk disalin pengguna saat melapor. */
export function errorDetailForCopy(error: unknown): string | null {
  const raw =
    error instanceof Error
      ? [error.name, error.message, error.stack ?? ""].filter(Boolean).join("\n")
      : typeof error === "string"
        ? error
        : JSON.stringify(error ?? null, null, 2);
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Kalimat galat yang ditampilkan ke pengguna.
 *
 * Urutan pilihan: muatan `ConvexError` (paling bersih, memang ditulis server) →
 * kalimat yang disaring dari bungkusan teknis → kalimat pengganti. String biasa
 * (validasi di klien) kembali apa adanya.
 */
export function readableErrorMessage(error: unknown): string {
  const fromData = convexErrorData(error);
  if (fromData) return fromData;

  const raw =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const inside = messageInside(raw);
  if (inside) return inside;
  return ERROR_FALLBACK;
}

/**
 * Detail teknis yang layak ditampilkan **di balik lipatan**: hanya kalau isinya
 * menambah sesuatu di luar kalimat yang sudah tampil (mis. id permintaan supaya
 * bisa dicari di log deployment). `null` berarti tidak perlu.
 */
export function errorTechnicalNote(error: unknown): string | null {
  const detail = errorDetailForCopy(error);
  if (!detail) return null;
  const readable = readableErrorMessage(error);
  if (detail === readable) return null;
  if (detail.replace(readable, "").trim().length === 0) return null;
  return detail;
}

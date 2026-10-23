/**
 * Primitif hash untuk `api.access` (Phase 4): SHA-256 dan HMAC-SHA256, murni.
 *
 * Kenapa implementasi sendiri dan bukan `crypto.subtle`? Tiga alasan yang
 * semuanya praktis:
 *
 * 1. **Harus sinkron.** Kunci API diverifikasi di dalam mutation/query Convex;
 *    `crypto.subtle.digest` asinkron dan tidak dipakai untuk keputusan yang
 *    harus deterministik.
 * 2. **Harus murni.** Aturan yang sama dipakai backend, harness, dan (untuk
 *    tampilan) klien; modul murni bisa diuji tanpa deployment.
 * 3. **Harus terverifikasi.** Implementasi kripto tanpa uji vektor resmi tidak
 *    bisa dipercaya, jadi harness-nya menguji vektor NIST SHA-256 dan vektor
 *    RFC 4231 HMAC — bukan sekadar “hash berubah kalau isinya berubah”.
 *
 * Yang di-hash: rahasia kunci API (`sha256`) dan payload webhook keluar (`HMAC`)
 * — dua tempat yang memang butuh SHA-256. Ini bukan pengganti TLS.
 */

/** Konstanta pembulatan SHA-256 (akar kubik 64 bilangan prima pertama). */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_H = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
]);

/**
 * UTF-8 encoder sendiri, bukan `TextEncoder`: modul ini harus berperilaku sama
 * di V8 Convex, Bun (harness), dan browser tanpa bergantung pada global.
 */
export function utf8Bytes(input: string): Uint8Array {
  const out: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    let code = input.charCodeAt(index);
    // Pasangan surrogate digabung dulu supaya emoji tidak jadi dua karakter.
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

/** SHA-256 dari byte mentah, dikembalikan sebagai 32 byte. */
export function sha256(bytes: Uint8Array): Uint8Array {
  const h = SHA256_H.slice();
  const bitLength = bytes.length * 8;
  // Padding: 0x80, lalu nol sampai panjang ≡ 56 (mod 64), lalu panjang 64-bit BE.
  //
  // Panjang blok dibulatkan **ke atas** (`ceil`), bukan `floor + 1`: untuk
  // `bytes.length + 9` yang tepat kelipatan 64, `floor + 1` menambah satu blok
  // nol penuh sehingga digest-nya salah. Kasus itu bukan teori — HMAC atas
  // `timestamp.body` untuk badan kiriman 41 mod 64 pernah menghasilkan tanda
  // tangan yang ditolak penerima (HTTP 401 “Tanda tangan tidak cocok”) padahal
  // rahasianya benar, dan `sha256Hex` untuk rahasia sepanjang 55 mod 64 juga
  // menyimpang dari SHA-256 standar.
  const paddedLength = ((bytes.length + 9 + 63) >> 6) << 6;
  const block = new Uint8Array(paddedLength);
  block.set(bytes);
  block[bytes.length] = 0x80;

  // Panjang pesan > 4 GiB tidak realistis di sini, jadi 32 bit tinggi = 0 —
  // tetapi tetap ditulis supaya format bloknya benar.
  const highBits = Math.floor(bitLength / 0x100000000);
  const lowBits = bitLength >>> 0;
  const tail = paddedLength - 8;
  block[tail] = (highBits >>> 24) & 0xff;
  block[tail + 1] = (highBits >>> 16) & 0xff;
  block[tail + 2] = (highBits >>> 8) & 0xff;
  block[tail + 3] = highBits & 0xff;
  block[tail + 4] = (lowBits >>> 24) & 0xff;
  block[tail + 5] = (lowBits >>> 16) & 0xff;
  block[tail + 6] = (lowBits >>> 8) & 0xff;
  block[tail + 7] = lowBits & 0xff;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const at = offset + index * 4;
      w[index] =
        ((block[at] << 24) | (block[at + 1] << 16) | (block[at + 2] << 8) | block[at + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        (rotl(w[index - 15], 25) ^ rotl(w[index - 15], 14) ^ (w[index - 15] >>> 3)) >>> 0;
      const s1 =
        (rotl(w[index - 2], 15) ^ rotl(w[index - 2], 13) ^ (w[index - 2] >>> 10)) >>> 0;
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let index = 0; index < 64; index += 1) {
      const s1 = (rotl(e, 26) ^ rotl(e, 21) ^ rotl(e, 7)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (hh + s1 + ch + SHA256_K[index] + w[index]) >>> 0;
      const s0 = (rotl(a, 30) ^ rotl(a, 19) ^ rotl(a, 10)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const digest = new Uint8Array(32);
  for (let index = 0; index < 8; index += 1) {
    digest[index * 4] = (h[index] >>> 24) & 0xff;
    digest[index * 4 + 1] = (h[index] >>> 16) & 0xff;
    digest[index * 4 + 2] = (h[index] >>> 8) & 0xff;
    digest[index * 4 + 3] = h[index] & 0xff;
  }
  return digest;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) {
    throw new Error("Hex tidak valid.");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

/** `sha256Hex("abc")` → hash SHA-256 dalam huruf kecil heksadesimal. */
export function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8Bytes(input)));
}

const HMAC_BLOCK_BYTES = 64;

/**
 * HMAC-SHA256 atas teks (kunci dan pesan di-encode UTF-8).
 * Kunci lebih panjang dari blok di-hash dulu — aturan RFC 2104.
 */
export function hmacSha256Hex(key: string, message: string): string {
  let keyBytes = utf8Bytes(key);
  if (keyBytes.length > HMAC_BLOCK_BYTES) keyBytes = sha256(keyBytes);

  const inner = new Uint8Array(HMAC_BLOCK_BYTES + utf8Bytes(message).length);
  const outer = new Uint8Array(HMAC_BLOCK_BYTES + 32);
  for (let index = 0; index < HMAC_BLOCK_BYTES; index += 1) {
    const byte = index < keyBytes.length ? keyBytes[index] : 0;
    inner[index] = byte ^ 0x36;
    outer[index] = byte ^ 0x5c;
  }
  inner.set(utf8Bytes(message), HMAC_BLOCK_BYTES);
  outer.set(sha256(inner), HMAC_BLOCK_BYTES);
  return bytesToHex(sha256(outer));
}

/**
 * Perbandingan dua hash heksadesimal tanpa bocor lewat waktu eksekusi.
 * Panjang yang berbeda langsung dianggap tidak cocok (panjang hash bukan
 * rahasia), isinya dibandingkan byte demi byte sampai selesai.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

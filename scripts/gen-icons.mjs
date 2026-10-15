/**
 * Membuat ikon PWA (`public/icon-*.png`, `public/apple-touch-icon.png`).
 *
 * Ikonnya adalah **mark brand aplikasi**, bukan bentuk yang dikira-kira: mark itu
 * ikon `store` dari `lucide-react` yang dipakai di sidebar (`AppLayout`), beranda,
 * halaman masuk, dan onboarding — `<Store className="size-5" />` di dalam kotak
 * `rounded-lg`. Warnanya pun dari tema: hijau merek (`#20C589`, `--primary` &
 * `theme_color`) di atas bidang gelap aplikasi (`#070A13`, `--background` tema
 * gelap & `background_color` manifest).
 *
 * Kenapa ada skripnya, bukan berkas biner yang ditempel begitu saja: ikon harus
 * bisa dibuat ulang kalau mark-nya bergerak, dan bentuknya harus sama dengan
 * `public/icon.svg` yang dipakai favicon. Jalur ikon di bawah adalah **salinan
 * apa adanya** dari `lucide-react` v1.55.0 (lisensi ISC) — jadi ikon PWA ini
 * mengikuti mark di aplikasi, bukan salinan tangan yang bisa menyimpang.
 *
 * PNG-nya ditulis dengan encoder kecil di bawah (zlib bawaan Node) supaya tidak
 * ada dependensi gambar yang perlu dipasang. Mark-nya digambar sebagai **garis
 * tebal berujung bulat**: tiap kurva dibelah jadi garis lurus halus, lalu tiap
 * piksel di dalam radius tebalnya diwarnai dengan pinggiran ber-anti-alias —
 * jadi tidak perlu pustaka penggambar SVG.
 *
 * Usage: node scripts/gen-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "public");

/** Hijau merek — sama dengan `--primary` gelap: hsl(158 72% 45%). */
const BRAND = [0x20, 0xc5, 0x89];
/** Latar gelap aplikasi — sama dengan `--background` tema gelap. */
const INK = [0x07, 0x0a, 0x13];

/**
 * Jalur ikon `store` dari `lucide-react` v1.55.0 (kotak 24×24, tebal garis 2) —
 * **salinan apa adanya**, sumber yang sama dengan mark di aplikasi.
 */
const STORE_ICON_SIZE = 24;
const STORE_ICON_STROKE = 2;
const STORE_ICON_PATHS = [
  "M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5",
  "M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244",
  "M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05",
];

// ── Encoder PNG minimal (RGBA 8-bit, satu IDAT) ───────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolor + alpha
  // Setiap baris diawali byte filter 0 (tanpa filter).
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * size * 4, size * 4).copy(
      raw,
      y * (size * 4 + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Membaca jalur SVG jadi garis-garis lurus ─────────────────────────────────
/** Jumlah parameter tiap perintah jalur yang dipakai mark ini. */
const PATH_PARAMS = { M: 2, L: 2, H: 1, V: 1, A: 7, Z: 0 };

/**
 * Titik-titik busur elips (`A`/`a`) dari titik sekarang ke titik akhir, sesuai
 * parameterisasi SVG (konversi pusat, lampiran F.6.5) — kurvanya dibelah jadi
 * potongan pendek supaya bisa digambar sebagai garis tebal.
 */
function arcPoints(x0, y0, rx, ry, phiDeg, largeArc, sweep, x1, y1) {
  if (x0 === x1 && y0 === y1) return [];
  if (rx === 0 || ry === 0) return [{ x: x1, y: y1 }];

  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;

  let rxAbs = Math.abs(rx);
  let ryAbs = Math.abs(ry);
  const lambda = (xp * xp) / (rxAbs * rxAbs) + (yp * yp) / (ryAbs * ryAbs);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rxAbs *= scale;
    ryAbs *= scale;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rxAbs * rxAbs * ryAbs * ryAbs - rxAbs * rxAbs * yp * yp - ryAbs * ryAbs * xp * xp;
  const denominator = rxAbs * rxAbs * yp * yp + ryAbs * ryAbs * xp * xp;
  const coefficient = sign * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (coefficient * rxAbs * yp) / ryAbs;
  const cyp = (-coefficient * ryAbs * xp) / rxAbs;
  const cx = cos * cxp - sin * cyp + (x0 + x1) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + y1) / 2;

  const start = Math.atan2((yp - cyp) / ryAbs, (xp - cxp) / rxAbs);
  const end = Math.atan2((-yp - cyp) / ryAbs, (-xp - cxp) / rxAbs);
  let delta = end - start;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;

  const steps = Math.max(4, Math.ceil(Math.abs(delta) / (Math.PI / 24)));
  const points = [];
  for (let step = 1; step <= steps; step += 1) {
    const angle = start + (delta * step) / steps;
    const px = rxAbs * Math.cos(angle);
    const py = ryAbs * Math.sin(angle);
    points.push({ x: cx + cos * px - sin * py, y: cy + sin * px + cos * py });
  }
  return points;
}

/**
 * Ubah satu atribut `d` jadi daftar polyline (tiap elemen satu sub-jalur).
 * Perintahnya lengkap untuk mark ini: M, L, H, V, A, Z (huruf kecil = relatif),
 * termasuk pengulangan implisit tanpa menulis ulang huruf perintahnya.
 */
function flattenPath(d) {
  const tokens = [...d.matchAll(/([A-Za-z])|([+-]?(?:\d*\.\d+|\d+\.?))/g)].map((match) =>
    match[1] ? { cmd: match[1] } : { num: Number(match[2]) },
  );

  const lines = [];
  let current = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let command = null;
  let index = 0;

  while (index < tokens.length) {
    if (tokens[index].cmd) {
      command = tokens[index].cmd;
      index += 1;
      if (command.toUpperCase() === "Z") {
        if (current) {
          current.push({ x: startX, y: startY });
          lines.push(current);
          current = null;
        }
        x = startX;
        y = startY;
      }
      continue;
    }

    const upper = command?.toUpperCase();
    const relative = command === command?.toLowerCase();
    const count = PATH_PARAMS[upper];
    if (count === undefined) throw new Error(`Perintah jalur belum didukung: ${command}`);
    const args = [];
    for (let step = 0; step < count; step += 1) {
      const token = tokens[index];
      if (!token || !("num" in token)) throw new Error(`Parameter kurang di "${command}": ${d}`);
      args.push(token.num);
      index += 1;
    }

    const empty = { x: 0, y: 0 };
    switch (upper) {
      case "M": {
        const nx = relative ? x + args[0] : args[0];
        const ny = relative ? y + args[1] : args[1];
        current = [{ x: nx, y: ny }];
        lines.push(current);
        x = nx;
        y = ny;
        startX = nx;
        startY = ny;
        break;
      }
      case "L": {
        const nx = relative ? x + args[0] : args[0];
        const ny = relative ? y + args[1] : args[1];
        (current ?? (current = [empty])).push({ x: nx, y: ny });
        x = nx;
        y = ny;
        break;
      }
      case "H": {
        x = relative ? x + args[0] : args[0];
        (current ?? (current = [empty])).push({ x, y });
        break;
      }
      case "V": {
        y = relative ? y + args[0] : args[0];
        (current ?? (current = [empty])).push({ x, y });
        break;
      }
      case "A": {
        const nx = relative ? x + args[5] : args[5];
        const ny = relative ? y + args[6] : args[6];
        const points = arcPoints(x, y, args[0], args[1], args[2], args[3] === 1, args[4] === 1, nx, ny);
        for (const point of points) (current ?? (current = [empty])).push(point);
        x = nx;
        y = ny;
        break;
      }
      default:
        throw new Error(`Perintah jalur belum digambar: ${command}`);
    }
  }

  return lines.filter((line) => line.length > 1);
}

// ── Menggambar ───────────────────────────────────────────────────────────────
function setPixel(pixels, size, x, y, color) {
  const offset = (y * size + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = 255;
}

function fillRect(pixels, size, box, color) {
  const x0 = Math.max(0, Math.round(box.x0 * size));
  const y0 = Math.max(0, Math.round(box.y0 * size));
  const x1 = Math.min(size, Math.round(box.x1 * size));
  const y1 = Math.min(size, Math.round(box.y1 * size));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) setPixel(pixels, size, x, y, color);
  }
}

function fillRounded(pixels, size, radius, color) {
  const r = radius * size;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Piksel di luar lengkungan sudut dilewati; piksel pusat lengkungan jadi
      // patokan jaraknya.
      const cx = x + 0.5;
      const cy = y + 0.5;
      const nx = cx < r ? r - cx : cx > size - r ? cx - (size - r) : 0;
      const ny = cy < r ? r - cy : cy > size - r ? cy - (size - r) : 0;
      if (nx > 0 && ny > 0 && nx * nx + ny * ny > r * r) continue;
      setPixel(pixels, size, x, y, color);
    }
  }
}

function distanceToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lengthSquared));
  const cx = x0 + t * dx;
  const cy = y0 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Goreskan polyline sebagai garis tebal berujung & bersambung bulat ke buffer
 * cakupan (`Float32Array`, 0..1 per piksel). Tiap potongan hanya menyentuh
 * piksel di dalam kotak pembatasnya sendiri, jadi biayanya sebanding dengan
 * panjang mark — bukan dengan seluruh kanvas.
 */
function strokePolyline(coverage, size, points, radius) {
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius - 1));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(a.x, b.x) + radius + 1));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius - 1));
    const y1 = Math.min(size - 1, Math.ceil(Math.max(a.y, b.y) + radius + 1));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const distance = distanceToSegment(x + 0.5, y + 0.5, a.x, a.y, b.x, b.y);
        const cover = Math.max(0, Math.min(1, radius + 0.5 - distance));
        if (cover <= 0) continue;
        const offset = y * size + x;
        if (cover > coverage[offset]) coverage[offset] = cover;
      }
    }
  }
}

/** Warna mark ditumpuk sekali ke latar memakai cakupan tiap piksel. */
function blendCoverage(pixels, size, coverage, color) {
  for (let offset = 0; offset < coverage.length; offset += 1) {
    const alpha = coverage[offset];
    if (alpha <= 0) continue;
    const pixel = offset * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      pixels[pixel + channel] = Math.round(pixels[pixel + channel] * (1 - alpha) + color[channel] * alpha);
    }
    pixels[pixel + 3] = Math.max(pixels[pixel + 3], Math.round(255 * alpha));
  }
}

/**
 * Mark brand di dalam kotak `size` px.
 *
 * `glyphScale` adalah bagian sisi kanvas yang dipakai kotak 24×24 mark-nya:
 * `1` berarti kotak itu menyentuh tepi (isinya sendiri 20/24 dari sisi, karena
 * `store` lucide memakai area 2..22). Ikon maskable & Apple disusutkan karena
 * bentuknya dipotong sistem (lingkaran area aman Android, sudut iOS).
 */
function icon(size, { rounded = true, glyphScale = 0.84 } = {}) {
  const pixels = new Uint8Array(size * size * 4);
  if (rounded) {
    fillRounded(pixels, size, 0.22, INK);
  } else {
    fillRect(pixels, size, { x0: 0, y0: 0, x1: 1, y1: 1 }, INK);
  }

  const box = glyphScale * size;
  const unit = box / STORE_ICON_SIZE;
  const offset = (size - box) / 2;
  const radius = (STORE_ICON_STROKE / 2) * unit;
  const coverage = new Float32Array(size * size);
  for (const path of STORE_ICON_PATHS) {
    for (const line of flattenPath(path)) {
      strokePolyline(
        coverage,
        size,
        line.map((point) => ({ x: offset + point.x * unit, y: offset + point.y * unit })),
        radius,
      );
    }
  }
  blendCoverage(pixels, size, coverage, BRAND);
  return encodePng(size, pixels);
}

mkdirSync(OUT_DIR, { recursive: true });
const files = [
  ["icon-192.png", icon(192)],
  ["icon-512.png", icon(512)],
  ["icon-maskable-512.png", icon(512, { rounded: false, glyphScale: 0.62 })],
  ["apple-touch-icon.png", icon(180, { rounded: false, glyphScale: 0.72 })],
];
for (const [name, data] of files) {
  writeFileSync(resolve(OUT_DIR, name), data);
  console.log(`DIAG ikon ${name} ${data.length} byte`);
}
console.log(
  `DIAG mark brand: ikon "store" lucide (3 jalur, tebal ${STORE_ICON_STROKE}/${STORE_ICON_SIZE})` +
    ` · hijau merek #${BRAND.map((c) => c.toString(16).padStart(2, "0")).join("")}` +
    ` · bidang gelap #${INK.map((c) => c.toString(16).padStart(2, "0")).join("")}`,
);

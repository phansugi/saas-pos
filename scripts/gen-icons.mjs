/**
 * Membuat ikon PWA (`public/icon-*.png`, `public/apple-touch-icon.png`).
 *
 * Kenapa ada skripnya, bukan berkas biner yang ditempel begitu saja: ikon harus
 * bisa dibuat ulang kalau warnanya berubah, dan bentuknya harus sama dengan
 * `public/icon.svg` yang dipakai favicon. Angkanya di bawah ini adalah
 * koordinat yang sama dengan SVG itu (dibagi 512), jadi keduanya tidak bisa
 * berbeda tanpa ketahuan.
 *
 * PNG-nya ditulis dengan encoder kecil di bawah (zlib bawaan Node) supaya tidak
 * ada dependensi gambar yang perlu dipasang — dan supaya harness bisa memeriksa
 * hasilnya sendiri: signature, CRC tiap chunk, dan jumlah baris gambar.
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
const WHITE = [0xff, 0xff, 0xff];

/**
 * Bentuk "toko" dalam koordinat 0..1 — identik dengan `public/icon.svg`
 * (72/512, 112/512, …). Kanopi dengan tiga celah, badan, lalu pintu.
 */
const GLYPH = {
  awning: { x0: 72 / 512, y0: 112 / 512, x1: 440 / 512, y1: 194 / 512 },
  body: { x0: 112 / 512, y0: 194 / 512, x1: 400 / 512, y1: 390 / 512 },
  slits: [150 / 512, 234 / 512, 318 / 512].map((x) => ({ x0: x, x1: x + 12 / 512 })),
  door: { x0: 222 / 512, y0: 286 / 512, x1: 290 / 512, y1: 390 / 512 },
};

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

// ── Menggambar ───────────────────────────────────────────────────────────────
function fillRect(pixels, size, box, color) {
  const x0 = Math.max(0, Math.round(box.x0 * size));
  const y0 = Math.max(0, Math.round(box.y0 * size));
  const x1 = Math.min(size, Math.round(box.x1 * size));
  const y1 = Math.min(size, Math.round(box.y1 * size));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * size + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
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
      const offset = (y * size + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }
}

/** Bentuk toko di dalam kotak `box` (0..1) — warna badan & warna celah. */
function paintGlyph(pixels, size, box, body, cut) {
  const mapX = (value) => box.x0 + value * (box.x1 - box.x0);
  const mapY = (value) => box.y0 + value * (box.y1 - box.y0);
  const shape = (target) => ({
    x0: mapX(target.x0),
    y0: mapY(target.y0),
    x1: mapX(target.x1),
    y1: mapY(target.y1),
  });

  fillRect(pixels, size, shape(GLYPH.awning), body);
  fillRect(pixels, size, shape(GLYPH.body), body);
  for (const slit of GLYPH.slits) {
    fillRect(
      pixels,
      size,
      shape({ x0: slit.x0, x1: slit.x1, y0: GLYPH.awning.y0, y1: GLYPH.awning.y1 }),
      cut,
    );
  }
  fillRect(pixels, size, shape(GLYPH.door), cut);
}

function icon(size, { rounded = true, glyphScale = 1, background = BRAND } = {}) {
  const pixels = new Uint8Array(size * size * 4);
  if (rounded) {
    fillRounded(pixels, size, 0.22, background);
  } else {
    fillRect(pixels, size, { x0: 0, y0: 0, x1: 1, y1: 1 }, background);
  }
  // Ikon maskable disusutkan supaya bentuknya tetap utuh di dalam area aman
  // Android (lingkaran tengah ~80%); begitu pula ikon Apple yang dipotong
  // sudutnya oleh iOS.
  const inset = (1 - glyphScale) / 2;
  paintGlyph(
    pixels,
    size,
    { x0: inset, y0: inset, x1: 1 - inset, y1: 1 - inset },
    WHITE,
    background,
  );
  return encodePng(size, pixels);
}

mkdirSync(OUT_DIR, { recursive: true });
const files = [
  ["icon-192.png", icon(192)],
  ["icon-512.png", icon(512)],
  ["icon-maskable-512.png", icon(512, { rounded: false, glyphScale: 0.6 })],
  ["apple-touch-icon.png", icon(180, { rounded: false, glyphScale: 0.7 })],
];
for (const [name, data] of files) {
  writeFileSync(resolve(OUT_DIR, name), data);
  console.log(`DIAG ikon ${name} ${data.length} byte`);
}
console.log(
  `DIAG warna merek #${BRAND.map((c) => c.toString(16).padStart(2, "0")).join("")}` +
    ` · latar gelap #${INK.map((c) => c.toString(16).padStart(2, "0")).join("")}`,
);

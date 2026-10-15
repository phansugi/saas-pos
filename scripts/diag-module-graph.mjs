/**
 * Diagnostik layar putih: menyusuri graf modul Vite dev server mulai dari
 * `/src/main.tsx` dan melaporkannya kalau ada modul yang gagal ditransformasi.
 *
 * Bedanya dengan membuka satu berkas: menyusuri graf berarti setiap impor yang
 * benar-benar dipakai aplikasi ikut diperiksa, jadi "layar putih karena kode
 * gagal dikompilasi" bisa dipisahkan dari "layar putih karena error runtime di
 * browser" (semua 200 -> masalahnya di runtime, bukan transformasi).
 *
 * Usage: bun scripts/diag-module-graph.mjs [http://localhost:5173]
 */
const BASE = process.argv[2] ?? "http://localhost:5173";
const ENTRY = "/src/main.tsx";
const MAX = 500;

const seen = new Set();
const failures = [];
const queue = [ENTRY];

/** Hanya impor relatif/absolut di dalam /src yang disusuri; bare import dilewati. */
const SPECIFIER = /(?:from|import)\s*["']([^"']+)["']/g;

function resolve(spec, from) {
  if (spec.startsWith("/")) return spec;
  if (!spec.startsWith(".")) return null;
  const base = from.slice(0, from.lastIndexOf("/"));
  const out = [];
  for (const part of `${base}/${spec}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

while (queue.length > 0 && seen.size < MAX) {
  const path = queue.shift();
  if (seen.has(path)) continue;
  seen.add(path);

  let res;
  let body;
  try {
    res = await fetch(`${BASE}${path}`);
    body = await res.text();
  } catch (error) {
    failures.push({ path, status: "koneksi", head: String(error) });
    continue;
  }

  // Modul yang gagal dikompilasi dijawab Vite dengan 500 + pesan galat.
  if (res.status !== 200 || body.includes("Internal server error")) {
    failures.push({
      path,
      status: res.status,
      head: body.slice(0, 400).replace(/\s+/g, " "),
    });
    continue;
  }

  for (const match of body.matchAll(SPECIFIER)) {
    const next = resolve(match[1], path);
    if (!next) continue;
    if (next.startsWith("/node_modules/") || next.startsWith("/@")) continue;
    if (next.includes("/_generated/")) continue;
    if (!/\.[a-z]+x?$/.test(next)) continue;
    if (!seen.has(next)) queue.push(next);
  }
}

console.log(`DIAG modul_diperiksa=${seen.size}`);
if (failures.length === 0) {
  console.log("DIAG gagal_transform=0 (semua modul tersaji; layar putih bukan karena transformasi)");
} else {
  console.log(`DIAG gagal_transform=${failures.length}`);
  for (const failure of failures) {
    console.log(`- ${failure.path} (HTTP ${failure.status}): ${failure.head}`);
  }
  process.exitCode = 1;
}

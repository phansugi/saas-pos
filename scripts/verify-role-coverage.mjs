/**
 * Audit **cakupan peran**: apakah setiap menu, izin, dan fitur modul yang ada di
 * aplikasi sudah masuk ke sistem peran yang bisa diatur pemilik bisnis?
 *
 * `verify-menus.mjs` membuktikan menu dan rute memakai izin yang sama, dan
 * `verify-rbac.mjs` membuktikan katalog izin utuh. Yang belum dibuktikan di mana
 * pun adalah pertanyaan pemilik bisnis: “semua yang saya lihat di aplikasi ini
 * bisa saya atur untuk staf saya, atau ada yang tidak punya tombolnya?”
 *
 * Yang diperiksa di sini:
 *
 *   1. setiap menu punya izin yang **dikenal** dan **tampil di checklist** Tim &
 *      Peran (satu-satunya pengecualian: Profil — profil orangnya sendiri);
 *   2. setiap izin di katalog benar-benar dipakai gerbang (tidak ada izin hantu
 *      yang tampil di checklist tetapi tidak mengatur apa pun);
 *   3. setiap token izin di rute, tombol (`can(...)`), dan server
 *      (`requirePermission` / `requireFeature`) ada di katalog — salah ketik
 *      tidak boleh lolos sebagai “izin yang tidak mengatur apa-apa”;
 *   4. pemilik memegang seluruh izin, jadi tidak ada menu yang terkunci dari
 *      pemiliknya sendiri;
 *   5. fitur modul yang menjadi gerbang menu dikenal katalog paket dan modul;
 *   6. izin yang dipakai **lebih dari satu menu** dicatat apa adanya — itulah
 *      daftar pekerjaan yang belum bisa dipisah oleh merchant (mis. Pengaturan
 *      workspace masih ikut `billing.manage`).
 *
 * Usage: bun scripts/verify-role-coverage.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  KNOWN_PERMISSIONS,
  PERMISSION_GROUPS,
  groupedPermissions,
} from "../src/convex/lib/rbac.ts";
import {
  PERMISSION_LABELS,
  ROLE_PERMISSIONS,
  ROLE_LABELS,
  ROLES,
} from "../src/convex/lib/authz.ts";
import { ALL_FEATURES } from "../src/convex/lib/billing/catalog.ts";
import { FEATURE_OWNER, MODULES } from "../src/convex/lib/billing/modules.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const dir = new URL("../", import.meta.url);
function read(path) {
  return readFileSync(new URL(path, dir), "utf8");
}

/**
 * Komentar dibuang sebelum token dibaca: dokumentasi di repo ini banyak
 * menyebut nama izin (“izin `report.view`”) dan tanpa langkah ini kalimat
 * dokumentasi akan dihitung sebagai gerbang.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(path, out = []) {
  for (const entry of readdirSync(new URL(path, dir))) {
    const relative = `${path}${entry}`;
    const stat = statSync(new URL(relative, dir));
    if (stat.isDirectory()) {
      if (entry === "_generated" || entry === "node_modules") continue;
      walk(`${relative}/`, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(relative);
    }
  }
  return out;
}

/** Menu sidebar, dibaca dari sumbernya — bukan salinan di harness. */
function parseNav(text) {
  const start = text.indexOf("const nav: NavItem[] = [");
  const end = text.indexOf("\n];", start);
  if (start < 0 || end < 0) throw new Error("blok `const nav` tidak ditemukan di AppLayout");
  return text
    .slice(start, end)
    .split(/(?=to:\s*")/)
    .slice(1)
    .map((part) => ({
      to: /to:\s*"([^"]+)"/.exec(part)?.[1] ?? null,
      label: /label:\s*"([^"]+)"/.exec(part)?.[1] ?? null,
      permission: /permission:\s*"([^"]+)"/.exec(part)?.[1] ?? null,
      feature: /feature:\s*"([^"]+)"/.exec(part)?.[1] ?? null,
    }));
}

/** Rute anak `/app` beserta izin yang dipasang `RequirePermission`. */
function parseRoutes(text) {
  return text
    .split(/<Route\b/)
    .slice(1)
    .map((chunk) => {
      const permission = /permission="([^"]+)"/.exec(chunk)?.[1] ?? null;
      const path = /path="([^"]+)"/.exec(chunk)?.[1];
      if (!path) return /\bindex\b/.test(chunk) ? { to: "/app", permission } : null;
      if (path === "*" || path.startsWith("/")) return null;
      return { to: `/app/${path}`, permission };
    })
    .filter(Boolean);
}

const appLayout = stripComments(read("src/layouts/AppLayout.tsx"));
const appRoutes = stripComments(read("src/App.tsx"));
const menu = parseNav(appLayout);
const routes = parseRoutes(appRoutes);

// ------------------------------------------------------------- 1. menu ↔ izin
check("menu sidebar terbaca dari sumbernya", menu.length > 0, `jumlah=${menu.length}`);
check(
  "setiap menu punya tujuan & label",
  menu.every((item) => item.to && item.label),
  JSON.stringify(menu.filter((item) => !item.to || !item.label)),
);
check(
  "setiap menu selain Profil punya izin",
  menu
    .filter((item) => !item.permission)
    .every((item) => item.to === "/app/profil"),
  menu.filter((item) => !item.permission).map((item) => item.to).join(", "),
);
check(
  "hanya Profil yang tanpa izin (profil orangnya sendiri, bukan fitur bisnis)",
  menu.filter((item) => !item.permission).map((item) => item.to).join(",") === "/app/profil",
  menu.filter((item) => !item.permission).map((item) => item.to).join(","),
);

const known = new Set(KNOWN_PERMISSIONS);
const grouped = groupedPermissions();
const menuPermissions = menu
  .map((item) => item.permission)
  .filter((permission) => permission !== null);

check(
  "setiap izin menu ada di katalog izin",
  menuPermissions.every((permission) => known.has(permission)),
  menuPermissions.filter((permission) => !known.has(permission)).join(", "),
);
check(
  "setiap izin menu tampil di checklist Tim & Peran",
  menuPermissions.every((permission) => grouped.includes(permission)),
  menuPermissions.filter((permission) => !grouped.includes(permission)).join(", "),
);
check(
  "checklist memuat setiap izin yang dikenal, tanpa duplikat",
  grouped.length === KNOWN_PERMISSIONS.length &&
    new Set(grouped).size === grouped.length &&
    KNOWN_PERMISSIONS.every((permission) => grouped.includes(permission)),
  `checklist=${grouped.length} dikenal=${KNOWN_PERMISSIONS.length} unik=${new Set(grouped).size}`,
);

// --------------------------------------------- 2. menu ↔ rute (satu kebijakan)
check(
  "jumlah menu sama dengan jumlah rute anak /app",
  menu.length === routes.length,
  `menu=${menu.length} rute=${routes.length}`,
);
for (const item of menu) {
  const route = routes.find((row) => row.to === item.to);
  check(`${item.label}: punya rute di App.tsx`, Boolean(route), item.to);
  check(
    `${item.label}: izin menu = izin rute`,
    route.permission === item.permission,
    `menu=${item.permission} rute=${route.permission}`,
  );
}

// ---------------------------------------------------------- 3. token di kode
const sources = [
  ...walk("src/pages/"),
  ...walk("src/components/"),
  ...walk("src/layouts/"),
  ...walk("src/convex/"),
];
const pageSources = sources.filter((path) => !path.startsWith("src/convex/"));
const serverSources = sources.filter((path) => path.startsWith("src/convex/"));

/** Token izin dari `can("...")` di klien. */
const clientPermissions = new Set();
for (const path of pageSources) {
  for (const match of stripComments(read(path)).matchAll(/\bcan\(\s*"([^"]+)"/g)) {
    clientPermissions.add(match[1]);
  }
}

/**
 * Gerbang server: izin dari `requirePermission(...)` dan izin opsional dari
 * `requireFeature(..., "fitur", "izin")`. Argumen fitur **tidak** dihitung
 * sebagai izin — keduanya string dan mudah tertukar, jadi dipisah di sini.
 */
const serverPermissions = new Set();
const serverFeatures = new Set();
for (const path of serverSources) {
  const text = stripComments(read(path));
  for (const match of text.matchAll(
    /requirePermission\(\s*ctx,\s*[^,]+,\s*[^,]+,\s*"([^"]+)"/g,
  )) {
    serverPermissions.add(match[1]);
  }
  for (const match of text.matchAll(
    /requireFeature\(\s*ctx,\s*[^,]+,\s*[^,]+,\s*"([^"]+)"(?:\s*,\s*"([^"]+)")?/g,
  )) {
    serverFeatures.add(match[1]);
    if (match[2]) serverPermissions.add(match[2]);
  }
}

const allTokens = [
  ...menuPermissions,
  ...clientPermissions,
  ...serverPermissions,
];
check(
  "tidak ada token izin asing di menu, tombol, atau server",
  allTokens.every((permission) => known.has(permission)),
  [...new Set(allTokens.filter((permission) => !known.has(permission)))].join(", "),
);
check(
  "setiap izin dikenal punya gerbang di server (bukan izin hantu)",
  KNOWN_PERMISSIONS.every((permission) => serverPermissions.has(permission)),
  KNOWN_PERMISSIONS.filter((permission) => !serverPermissions.has(permission)).join(", "),
);
check(
  "pemilik memegang seluruh izin, jadi tidak ada menu yang terkunci darinya",
  KNOWN_PERMISSIONS.every((permission) =>
    ROLE_PERMISSIONS.owner.includes(permission),
  ),
  KNOWN_PERMISSIONS.filter(
    (permission) => !ROLE_PERMISSIONS.owner.includes(permission),
  ).join(", "),
);
check(
  "setiap peran bawaan punya nama & setidaknya satu izin",
  ROLES.length === 5 &&
    ROLES.every(
      (role) => ROLE_LABELS[role].trim().length > 2 && ROLE_PERMISSIONS[role].length > 0,
    ),
  JSON.stringify(ROLES.map((role) => [role, ROLE_PERMISSIONS[role].length])),
);

// ------------------------------------- 4. izin yang dipakai lebih dari 1 menu
/**
 * Daftar **diketahui** izin yang menaungi beberapa menu. Isinya bukan
 * persetujuan: ia sengaja ditulis di sini supaya penambahan menu baru ke izin
 * yang sudah dipakai bersama gagal di harness dan harus diputuskan sadar —
 * apakah menu baru itu memang satu pekerjaan, atau butuh izin sendiri.
 */
const SHARED_MENU_GATES = {
  "report.view": ["/app", "/app/panduan", "/app/reports"],
  "inventory.view": ["/app/inventory", "/app/opname"],
  "billing.manage": ["/app/modules", "/app/settings", "/app/subscription"],
};

/**
 * Dua menu yang izinnya **sengaja** dipisah dari `pos.sell`: dapur bekerja di
 * antreannya sendiri, dan kas meja dibuka/ditutup lewat izinnya sendiri. Kalau
 * salah satunya kembali menumpang `pos.sell`, cek di bawah gagal — bukan cuma
 * ikut pindah ke daftar izin lintas-menu.
 */
for (const [to, permission] of [
  ["/app/kds", "kds.manage"],
  ["/app/shift", "shift.manage"],
]) {
  check(
    `menu ${to} memakai izinnya sendiri (${permission})`,
    menu.find((item) => item.to === to)?.permission === permission,
    String(menu.find((item) => item.to === to)?.permission),
  );
}

const byPermission = new Map();
for (const item of menu) {
  if (!item.permission) continue;
  const list = byPermission.get(item.permission) ?? [];
  list.push(item.to);
  byPermission.set(item.permission, list);
}
const shared = Object.fromEntries(
  [...byPermission.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([permission, list]) => [permission, [...list].sort()]),
);
check(
  "izin yang menaungi beberapa menu persis seperti daftar yang dicatat",
  JSON.stringify(shared) ===
    JSON.stringify(
      Object.fromEntries(
        Object.entries(SHARED_MENU_GATES).map(([permission, list]) => [
          permission,
          [...list].sort(),
        ]),
      ),
    ),
  JSON.stringify(shared),
);

// --------------------------------------------------- 5. fitur modul & paket
const knownFeatures = new Set(ALL_FEATURES);
const navFeatures = menu
  .map((item) => item.feature)
  .filter((feature) => feature !== null);
check(
  "fitur yang menjadi gerbang menu dikenal katalog paket",
  navFeatures.every((feature) => knownFeatures.has(feature)),
  navFeatures.filter((feature) => !knownFeatures.has(feature)).join(", "),
);
check(
  "fitur yang dipakai server dikenal katalog paket",
  [...serverFeatures].every((feature) => knownFeatures.has(feature)),
  [...serverFeatures].filter((feature) => !knownFeatures.has(feature)).join(", "),
);
check(
  "setiap fitur yang dimiliki modul ada di katalog fitur",
  Object.values(MODULES).every((module) =>
    module.features.every((feature) => knownFeatures.has(feature)),
  ),
  Object.values(MODULES)
    .flatMap((module) => module.features)
    .filter((feature) => !knownFeatures.has(feature))
    .join(", "),
);
check(
  "setiap fitur yang dimiliki modul punya pemilik modul yang terbaca",
  Object.values(MODULES).every((module) =>
    module.features.every((feature) => FEATURE_OWNER[feature] === module.vertical),
  ),
  JSON.stringify(FEATURE_OWNER),
);

// ------------------------------------------------------------- ringkasan
const actionOnly = KNOWN_PERMISSIONS.filter(
  (permission) => !menuPermissions.includes(permission),
);
const featuresWithoutServerGate = ALL_FEATURES.filter(
  (feature) => !serverFeatures.has(feature),
);

const failed = results.filter((result) => !result.ok).length;
console.log(`\nCakupan peran MesinPOS`);
console.log(
  `  menu ${menu.length} · berizin ${menuPermissions.length} · tanpa izin ${menu.length - menuPermissions.length} (Profil)`,
);
console.log(
  `  izin ${KNOWN_PERMISSIONS.length} · grup checklist ${PERMISSION_GROUPS.length} · punya gerbang server ${serverPermissions.size}`,
);
console.log(
  `  izin yang hanya menjaga aksi (tanpa menu): ${actionOnly.length} — ${actionOnly
    .map((permission) => permission)
    .join(", ")}`,
);
console.log(
  `  izin dipakai >1 menu (belum bisa dipisah merchant): ${Object.keys(shared).length}`,
);
for (const [permission, list] of Object.entries(shared)) {
  console.log(`    ${PERMISSION_LABELS[permission]} (${permission}) → ${list.join(", ")}`);
}
console.log(
  `  fitur modul tanpa gerbang server (murni paket/UI): ${
    featuresWithoutServerGate.length
  } — ${featuresWithoutServerGate.map((feature) => feature).join(", ")}`,
);
console.log(`\n${results.length - failed}/${results.length} cek lulus`);
if (failed > 0) process.exitCode = 1;

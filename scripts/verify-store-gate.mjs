/**
 * Uji gerbang langganan store Convex (`src/lib/store/convex.tsx`) tanpa deployment.
 *
 * Kenapa harness ini ada: **langganan Convex yang ditolak server menjatuhkan
 * render**, jadi klien tidak boleh membuka langganan yang izinnya belum pasti
 * dipegang pengguna. Itu pernah terjadi — kasir yang diundang masuk di perangkat
 * baru, sesinya belum selaras, `products.listAll` (`product.manage`) tetap
 * dilanggan, dan yang muncul di layar adalah “Halaman ini gagal dimuat” dengan
 * pesan `Akses ditolak: peran cashier tidak memiliki izin product.manage`.
 *
 * Yang diperiksa karena itu dua sisi sekaligus:
 *
 *   1. **Sisi server**: izin apa yang benar-benar dituntut setiap `query` di
 *      `src/convex/*.ts` (`requirePermission` / `requireFeature(... , izin)`).
 *   2. **Sisi klien**: setiap langganan ke query berizin itu harus berada di
 *      balik gerbang izin (`canView*`/`canManage*` = `has("<izin>")`), dan
 *      `has` itu sendiri harus bersumber dari **server** (`api.roles.myAccess`),
 *      bukan dari peran di sesi perangkat — sumber sesi-lah yang membuat kasir
 *      memperoleh gerbang milik pemilik.
 *
 * Ditambah dua pagar lain yang satu kelas dengan bug itu: setiap langganan wajib
 * punya jalan `"skip"` (supaya tenant yang belum diketahui tidak pernah ditanyakan
 * ke server), dan klien tidak boleh memakai `actingPermissions`/`actingRole`
 * untuk memutuskan langganan.
 *
 * Sifatnya membaca sumber, bukan menjalankan React: harness render (happy-dom)
 * berjalan di mode demo, sehingga jalur Convex tidak pernah tersentuh di sana.
 *
 * Usage: bun scripts/verify-store-gate.mjs
 */
import { readFileSync } from "node:fs";
import { KNOWN_PERMISSIONS } from "../src/convex/lib/rbac.ts";
import {
  isActiveMembership,
  isMembershipSuspended,
  MEMBERSHIP_SUSPENDED_NOTE,
} from "../src/convex/lib/team.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const storePath = new URL("../src/lib/store/convex.tsx", import.meta.url);

/**
 * Sumber tanpa komentar (isi string dipertahankan).
 *
 * Wajib: berkas ini penuh komentar penjelasan yang menyebut `useQuery(` dan
 * `query(`, dan pembaca sumber yang tidak melewatinya akan melaporkan langganan
 * yang tidak pernah ada — sekaligus kehilangan langganan yang sebenarnya.
 */
function stripComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\"" || ch === "'" || ch === "`") {
      const end = skipString(source, i);
      out += source.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);
      const stop = newline === -1 ? source.length : newline;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i);
      const stop = close === -1 ? source.length : close + 1;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Indeks penutup sebuah string yang mulai di `start` (escape diabaikan). */
function skipString(source, start) {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i += 1) {
    if (source[i] === "\\") {
      i += 1;
      continue;
    }
    if (source[i] === quote) return i;
  }
  return source.length - 1;
}

/** Indeks tanda kurung penutup untuk `(` di posisi `open`; `-1` kalau tidak ada. */
function matchingParen(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\"" || ch === "'" || ch === "`") {
      i = skipString(source, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Isi tanda kurung sebuah pemanggilan `callee(...)`, untuk setiap kemunculan. */
function callTexts(source, callee) {
  const found = [];
  let at = source.indexOf(callee);
  while (at !== -1) {
    const open = at + callee.length - 1;
    const close = matchingParen(source, open);
    if (close === -1) break;
    found.push(source.slice(open + 1, close));
    at = source.indexOf(callee, close);
  }
  return found;
}

const storeSource = stripComments(readFileSync(storePath, "utf8"));

/** Argumen tingkat atas sebuah pemanggilan (koma di dalam tanda kurung diabaikan). */
function topLevelArgs(text) {
  const args = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      args.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  args.push(current);
  return args.map((arg) => arg.trim()).filter((arg) => arg.length > 0);
}

/** Harfiah teks yang tampak seperti string JavaScript, tanpa menghapus isinya. */
function stringLiterals(text) {
  return [...text.matchAll(/"([^"\\]*)"/g)].map((match) => match[1]);
}

const knownPermissions = new Set(KNOWN_PERMISSIONS);

/**
 * Izin yang dituntut sebuah `query` di backend.
 *
 * `requirePermission(ctx, tenant, actor, "izin")` → izin itu. `requireFeature(
 * …, "fitur", "izin")` → izin opsionalnya; `requireFeature` tanpa izin hanya
 * digerbang fitur paket, dan itu urusan `useStore().modules`, bukan izin.
 */
function requiredPermissions(moduleName, fnName) {
  let source;
  try {
    source = stripComments(
      readFileSync(new URL(`../src/convex/${moduleName}.ts`, import.meta.url), "utf8"),
    );
  } catch {
    return null;
  }
  const marker = `export const ${fnName} = query(`;
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const body = callTexts(source.slice(start), "query(")[0] ?? "";
  const permissions = new Set();
  for (const callee of ["requirePermission(", "requireFeature("]) {
    for (const call of callTexts(body, callee)) {
      for (const literal of stringLiterals(call)) {
        if (knownPermissions.has(literal)) permissions.add(literal);
      }
    }
  }
  return permissions;
}

// ------------------------------------------------------------ sisi klien
const flagPermission = new Map();
for (const match of storeSource.matchAll(
  /const\s+([A-Za-z0-9_]+)\s*=\s*has\("([^"]+)"\);/g,
)) {
  flagPermission.set(match[1], match[2]);
}
check(
  "gerbang izin klien terbaca dari sumbernya",
  flagPermission.size >= 10,
  `jumlah=${flagPermission.size}`,
);

const subscriptions = [];
for (const text of callTexts(storeSource, "useQuery(")) {
  const header = /^\s*api\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*,/.exec(text);
  if (!header) continue;
  const args = topLevelArgs(text);
  subscriptions.push({
    module: header[1],
    fn: header[2],
    label: `api.${header[1]}.${header[2]}`,
    guard: args.slice(1).join(", "),
  });
}
check(
  "langganan store terbaca dari sumbernya",
  subscriptions.length >= 25,
  `jumlah=${subscriptions.length}`,
);
check(
  "nama langganan store tidak ada yang dobel",
  new Set(subscriptions.map((sub) => sub.label)).size === subscriptions.length,
  subscriptions.map((sub) => sub.label).join(", "),
);

// Setiap langganan wajib punya jalan "skip": tenant/actor yang belum diketahui
// tidak boleh ditanyakan ke server, karena jawabannya bisa berupa penolakan yang
// menjatuhkan render.
check(
  "setiap langganan punya jalan \"skip\"",
  subscriptions.every((sub) => sub.guard.includes("\"skip\"")),
  subscriptions
    .filter((sub) => !sub.guard.includes("\"skip\""))
    .map((sub) => sub.label)
    .join(", ") || "semua punya",
);

// Izin pembuka langganan harus datang dari server, bukan dari sesi perangkat.
check(
  "izin gerbang bersumber dari server (roles.myAccess)",
  storeSource.includes("api.roles.myAccess"),
  "roles.myAccess tidak dilanggan",
);
check(
  "izin gerbang kosong selama server belum menjawab",
  /sanitizePermissions\(\s*myAccess\?\.permissions\s*\?\?\s*\[\]\s*\)/.test(
    storeSource.match(/const permissions = useMemo\([\s\S]{0,200}?\n\s*\);/)?.[0] ??
      "",
  ),
  "izin klien tidak lagi jatuh ke daftar kosong saat myAccess belum ada",
);
check(
  "izin gerbang tidak dibaca dari sesi perangkat",
  !/const permissions = useMemo\([\s\S]{0,300}?session[\s\S]{0,300}?\)/.test(
    storeSource,
  ) && !storeSource.includes("actingPermissions"),
  "memo izin klien masih menyentuh nilai sesi",
);
{
  const flagPattern = /\bcan(?:View|Manage)[A-Za-z0-9_]*\b/g;
  const flags = [
    ...storeSource.matchAll(
      /const\s+(can(?:View|Manage)[A-Za-z0-9_]*)\s*=\s*([^\n;]+);/g,
    ),
  ];
  check(
    "setiap gerbang izin bernama can* berasal dari has(...)",
    flags.length >= 10 && flags.every(([, , right]) => right.includes("has(")),
    flags
      .filter(([, , right]) => !right.includes("has("))
      .map(([name, , right]) => `${name} = ${right.trim()}`)
      .join(" | ") || `jumlah=${flags.length}`,
  );

  // Gerbang yang benar-benar dipakai langganan harus salah satu dari daftar itu:
  // nama baru yang dibaca dari tempat lain (mis. langsung dari sesi) langsung
  // ketahuan di sini.
  const usedFlags = new Set();
  for (const sub of subscriptions) {
    for (const match of sub.guard.matchAll(flagPattern)) usedFlags.add(match[0]);
  }
  check(
    "setiap gerbang yang dipakai langganan berasal dari has(...)",
    usedFlags.size >= 8 && [...usedFlags].every((flag) => flagPermission.has(flag)),
    [...usedFlags].filter((flag) => !flagPermission.has(flag)).join(", ") ||
      `jumlah=${usedFlags.size}`,
  );
  check(
    "izin yang dihitung has() hanya dari daftar server",
    storeSource.includes("sanitizePermissions(myAccess?.permissions ?? [])") &&
      !storeSource.includes("effectivePermissions(actingRole"),
    "daftar izin klien tidak berasal dari roles.myAccess",
  );
}

// ------------------------------------------------------------ gerbang per izin
const gated = [];
const ungated = [];
for (const sub of subscriptions) {
  const permissions = requiredPermissions(sub.module, sub.fn);
  if (permissions === null) {
    check(
      `langganan ${sub.label} bisa dilacak ke berkas backend`,
      false,
      "query tidak ditemukan di src/convex",
    );
  }
  if (permissions.size === 0) continue;

  const named = [...flagPermission.entries()].filter(([, permission]) =>
    permissions.has(permission),
  );
  const passes = named.some(
    ([flag, permission]) =>
      new RegExp(`\\b${flag}\\b`).test(sub.guard) ||
      sub.guard.includes(`has("${permission}")`),
  );

  (passes ? gated : ungated).push({
    ...sub,
    permissions: [...permissions],
  });
}

check(
  "setiap langganan berizin berada di balik gerbang izin server",
  ungated.length === 0,
  ungated
    .map((sub) => `${sub.label} butuh ${sub.permissions.join("/")}`)
    .join(" | "),
);
check(
  "langganan berizin benar-benar terbaca (bukan daftar kosong)",
  gated.length >= 8,
  `jumlah=${gated.length}`,
);

// Kasus yang dilaporkan: katalog pengelolaan (`products.listAll`) dituntut
// `product.manage` di server, jadi langganannya harus digerbang izin yang sama.
{
  const katalog = gated.find((sub) => sub.label === "api.products.listAll");
  check(
    "products.listAll bergerbang product.manage (kasus halaman gagal dimuat)",
    katalog !== undefined && katalog.permissions.includes("product.manage"),
    JSON.stringify(katalog ?? "tidak ditemukan"),
  );
}

// ------------------------------------------------- keanggotaan yang nonaktif
check(
  "keanggotaan nonaktif dikenali dari penanda servernya",
  isActiveMembership({ active: true }) &&
    isActiveMembership({}) &&
    isActiveMembership(null) &&
    !isActiveMembership({ active: false }),
  JSON.stringify({
    aktif: isActiveMembership({ active: true }),
    kosong: isActiveMembership({}),
    nonaktif: isActiveMembership({ active: false }),
  }),
);
check(
  "kalimat keanggotaan nonaktif dikenali dari pesannya",
  isMembershipSuspended(MEMBERSHIP_SUSPENDED_NOTE) &&
    isMembershipSuspended(`Uncaught Error: ${MEMBERSHIP_SUSPENDED_NOTE}`) &&
    !isMembershipSuspended("gagal menyambung jaringan"),
  MEMBERSHIP_SUSPENDED_NOTE,
);
check(
  "store memakai penanda keanggotaan aktif dari server",
  storeSource.includes("isActiveMembership") &&
    storeSource.includes("MEMBERSHIP_SUSPENDED_NOTE"),
  "convex.tsx tidak mengenali keanggotaan nonaktif",
);
check(
  "provisioning hanya untuk akun tanpa keanggotaan sama sekali",
  /if \(myWorkspaces === undefined \|\| myWorkspaces\.length > 0\) return;/.test(
    storeSource,
  ),
  "anggota yang dinonaktifkan bisa dibuatkan workspace baru",
);

if (process.exitCode && process.exitCode !== 0) {
  console.log(`${results.filter((r) => !r.ok).length} gagal`);
} else {
  console.log(`${results.length}/${results.length} checks passed`);
  console.log(
    `langganan: ${subscriptions.length} total · ${gated.length} bergerbang izin · ` +
      `${subscriptions.length - gated.length} cukup keanggotaan`,
  );
}

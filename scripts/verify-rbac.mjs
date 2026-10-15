/**
 * Uji aturan peran kustom (`rbac.custom`, Phase 4) tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/rbac.ts` — modul murni yang dipakai backend
 * (`requirePermission` di lib/access.ts), halaman Tim & Peran, kedua store, dan
 * sesi klien. Selain aturannya, harness ini juga menjaga dua hal yang mudah
 * melenceng tanpa disadari:
 *
 *   - daftar izin di `schema.ts` (`permissionValidator`) harus memuat **semua**
 *     izin yang dikenal — izin baru yang lupa didaftarkan akan ditolak database
 *     dengan pesan yang membingungkan;
 *   - grup izin yang tampil di halaman harus menutupi seluruh izin tepat sekali,
 *     supaya tidak ada izin yang bisa diberikan tapi tak pernah bisa dicentang.
 *
 * Usage: bun scripts/verify-rbac.mjs
 */
import { readFileSync } from "node:fs";
import { PERMISSION_LABELS } from "../src/convex/lib/authz.ts";
import {
  assignmentError,
  CUSTOM_ROLE_NAME_MAX,
  describeCustomRole,
  effectivePermissions,
  groupedPermissions,
  isReservedRoleName,
  KNOWN_PERMISSIONS,
  lackingPermissions,
  MAX_CUSTOM_ROLES,
  memberCan,
  normalizeRoleName,
  permissionDelta,
  PERMISSION_GROUPS,
  roleAssignments,
  sanitizePermissions,
  validateCustomRole,
} from "../src/convex/lib/rbac.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// ------------------------------------------------------- daftar izin & grup
// Dibandingkan dengan tabel izin itu sendiri, bukan angka tetap: menambah izin
// baru (mis. `api.manage` di Phase 4) tidak boleh memaksa harness ini diedit,
// tetapi izin yang hilang dari daftar rbac harus langsung ketahuan.
check(
  "daftar izin rbac sama dengan tabel izin authz",
  KNOWN_PERMISSIONS.length === Object.keys(PERMISSION_LABELS).length &&
    Object.keys(PERMISSION_LABELS).every((permission) =>
      KNOWN_PERMISSIONS.includes(permission),
    ),
  `${KNOWN_PERMISSIONS.length} vs ${Object.keys(PERMISSION_LABELS).length}`,
);
check(
  "daftar izin tidak punya duplikat",
  new Set(KNOWN_PERMISSIONS).size === KNOWN_PERMISSIONS.length,
  KNOWN_PERMISSIONS.join(", "),
);

{
  const grouped = groupedPermissions();
  check(
    "grup izin menutupi setiap izin tepat sekali",
    grouped.length === KNOWN_PERMISSIONS.length &&
      new Set(grouped).size === grouped.length &&
      KNOWN_PERMISSIONS.every((permission) => grouped.includes(permission)),
    `grup=${grouped.length} dikenal=${KNOWN_PERMISSIONS.length}`,
  );
  check(
    "grup izin diberi judul yang terbaca",
    PERMISSION_GROUPS.every((group) => group.label.trim().length > 2),
    JSON.stringify(PERMISSION_GROUPS.map((group) => group.label)),
  );

  // Kategori produk (`category.manage`) menempel di grup “Produk & stok” —
  // pengelompokan checklist mengikuti tempat kerja orangnya, bukan jumlah izin.
  const grupProduk = PERMISSION_GROUPS.find((group) =>
    group.permissions.includes("category.manage"),
  );
  check(
    "izin kategori produk masuk grup Produk & stok",
    grupProduk?.label === "Produk & stok",
    JSON.stringify(PERMISSION_GROUPS.map((group) => group.label)),
  );
}

// Pagar eskalasi juga berlaku untuk izin baru: peran kustom berbasis manajer
// boleh memuat `category.manage`, sedangkan peran dasar staf gudang tidak bisa
// memberikannya (dia sendiri tidak punya).
check(
  "manajer boleh menurunkan izin kategori produk ke peran kustom",
  lackingPermissions("manager", ["category.manage"]).length === 0,
  JSON.stringify(lackingPermissions("manager", ["category.manage"])),
);
check(
  "staf gudang tidak bisa memberi izin kategori produk yang tidak dia punya",
  JSON.stringify(lackingPermissions("inventory", ["category.manage"])) ===
    JSON.stringify(["category.manage"]),
  JSON.stringify(lackingPermissions("inventory", ["category.manage"])),
);

{
  // Validator schema harus memuat seluruh izin — izin yang lolos dari daftar
  // akan ditolak database dengan pesan yang tidak menolong siapa pun.
  const schema = readFileSync(new URL("../src/convex/schema.ts", import.meta.url), "utf8");
  const start = schema.indexOf("export const permissionValidator");
  // Potong tepat di `);` penutup validator, bukan di komentar berikutnya —
  // kalau tidak, validator lain (planKey, status langganan) ikut terhitung.
  const end = schema.indexOf("\n);", start);
  const block = schema.slice(start, end === -1 ? start + 2000 : end);
  const literals = [...block.matchAll(/v\.literal\("([^"]+)"\)/g)].map((m) => m[1]);
  check(
    "schema permissionValidator memuat seluruh izin yang dikenal",
    KNOWN_PERMISSIONS.every((permission) => literals.includes(permission)),
    JSON.stringify(KNOWN_PERMISSIONS.filter((p) => !literals.includes(p))),
  );
  check(
    "schema permissionValidator tidak punya izin berlebih",
    literals.length === KNOWN_PERMISSIONS.length,
    JSON.stringify(literals.filter((p) => !KNOWN_PERMISSIONS.includes(p))),
  );
}

// -------------------------------------------------------------- nama peran
check(
  "nama peran dirapikan (spasi pinggir & ganda)",
  normalizeRoleName("  Kasir   Shift  Malam ") === "Kasir Shift Malam",
  normalizeRoleName("  Kasir   Shift  Malam "),
);

for (const reserved of ["kasir", "KASIR", "Kasir", "Manajer", "Staf Gudang", "owner", "finance"]) {
  check(
    `nama peran bawaan ditolak: ${reserved}`,
    isReservedRoleName(reserved),
    "DITERIMA — peran bawaan bisa ditimpa",
  );
}
check(
  "nama yang hanya mirip peran bawaan tetap boleh",
  !isReservedRoleName("Kasir Malam") && !isReservedRoleName("Manajer Cabang"),
  "DITOLAK — nama sah ikut terblokir",
);

// --------------------------------------------------------------- validasi
{
  const ok = validateCustomRole(
    {
      name: "  Kasir   Malam ",
      description: "  Menjual tanpa bisa membatalkan transaksi  ",
      permissions: ["pos.sell", "report.view", "pos.sell"],
    },
    { actingRole: "manager" },
  );
  check("peran valid diterima", ok.ok, ok.reason);
  check("nama dinormalkan & duplikat izin dibuang", ok.ok &&
    ok.value.name === "Kasir Malam" && ok.value.permissions.length === 2,
    JSON.stringify(ok.ok ? ok.value : ok.reason));
  check("keterangan dirapikan", ok.ok && ok.value.description === "Menjual tanpa bisa membatalkan transaksi",
    ok.ok ? ok.value.description : ok.reason);
  check("izin disimpan dalam urutan kanonik", ok.ok &&
    ok.value.permissions[0] === "pos.sell" && ok.value.permissions[1] === "report.view",
    JSON.stringify(ok.ok ? ok.value.permissions : ok.reason));
}

for (const [label, input, actingRole, expected] of [
  ["nama terlalu pendek", { name: "ab", permissions: ["pos.sell"] }, "owner", "3–40 karakter"],
  [
    "nama terlalu panjang",
    { name: "x".repeat(CUSTOM_ROLE_NAME_MAX + 1), permissions: ["pos.sell"] },
    "owner",
    "3–40 karakter",
  ],
  ["nama peran bawaan", { name: "Manajer", permissions: ["pos.sell"] }, "owner", "peran bawaan"],
  ["tanpa izin", { name: "Peran Kosong", permissions: [] }, "owner", "minimal satu izin"],
  [
    "izin tidak dikenal",
    { name: "Peran Aneh", permissions: ["pos.sell", "hack.semua"] },
    "owner",
    "Izin tidak dikenal",
  ],
]) {
  const result = validateCustomRole(input, { actingRole });
  check(
    `peran ditolak: ${label}`,
    !result.ok && (result.reason ?? "").includes(expected),
    result.ok ? "DITERIMA — validasi bocor" : result.reason,
  );
}

check(
  "nama yang sudah dipakai ditolak (tanpa peka huruf besar-kecil)",
  (() => {
    const result = validateCustomRole(
      { name: " kasir   malam ", permissions: ["pos.sell"] },
      { actingRole: "owner", existingNames: ["Kasir Malam"] },
    );
    return !result.ok && result.reason.includes("sudah ada");
  })(),
  JSON.stringify(
    validateCustomRole(
      { name: "Kasir Malam", permissions: ["pos.sell"] },
      { actingRole: "owner", existingNames: ["kasir malam"] },
    ),
  ),
);

check(
  "mengubah peran sendiri boleh memakai namanya (dikecualikan pemanggil)",
  validateCustomRole(
    { name: "Kasir Malam", permissions: ["pos.sell"] },
    { actingRole: "owner", existingNames: [] },
  ).ok,
  "DITOLAK — peran tidak bisa disimpan tanpa mengubah nama",
);

check(
  `batas ${MAX_CUSTOM_ROLES} peran dijaga`,
  (() => {
    const result = validateCustomRole(
      { name: "Peran ke-21", permissions: ["pos.sell"] },
      { actingRole: "owner", count: MAX_CUSTOM_ROLES },
    );
    return !result.ok && result.reason.includes(String(MAX_CUSTOM_ROLES));
  })(),
  "DITERIMA — batas jumlah peran bocor",
);

{
  const trimmed = validateCustomRole(
    { name: "Peran Panjang", description: "k".repeat(400), permissions: ["pos.sell"] },
    { actingRole: "owner" },
  );
  check(
    "keterangan dipotong ke 200 karakter",
    trimmed.ok && trimmed.value.description.length === 200,
    trimmed.ok ? String(trimmed.value.description.length) : trimmed.reason,
  );
  const blank = validateCustomRole(
    { name: "Peran Bersih", description: "   ", permissions: ["pos.sell"] },
    { actingRole: "owner" },
  );
  check(
    "keterangan kosong disimpan sebagai kosong, bukan spasi",
    blank.ok && blank.value.description === undefined,
    blank.ok ? JSON.stringify(blank.value.description) : blank.reason,
  );
}

// ------------------------------------------------------- pagar eskalasi
check(
  "manajer tidak bisa memberi izin di luar wewenangnya",
  (() => {
    const result = validateCustomRole(
      { name: "Admin Tagihan", permissions: ["pos.sell", "billing.manage"] },
      { actingRole: "manager" },
    );
    return !result.ok && result.reason.includes("tidak punya");
  })(),
  JSON.stringify(
    validateCustomRole(
      { name: "Admin Tagihan", permissions: ["billing.manage"] },
      { actingRole: "manager" },
    ),
  ),
);
check(
  "pemilik bisa memberi izin apa pun",
  validateCustomRole(
    { name: "Admin Tagihan", permissions: ["billing.manage", "payable.manage"] },
    { actingRole: "owner" },
  ).ok,
  "DITOLAK — pemilik kehilangan wewenangnya",
);
check(
  "staf gudang tidak bisa menyetujui pembelian lewat peran kustom",
  (() => {
    const result = validateCustomRole(
      { name: "Pengadaan Kilat", permissions: ["purchase.approve"] },
      { actingRole: "inventory" },
    );
    return !result.ok && result.reason.includes("tidak punya");
  })(),
  "DITERIMA — eskalasi wewenang bocor",
);
check(
  "manajer bisa membuat peran di dalam wewenangnya",
  validateCustomRole(
    { name: "Pengawas Kasir", permissions: ["pos.sell", "pos.void", "report.view"] },
    { actingRole: "manager" },
  ).ok,
  "DITOLAK — izin yang dimiliki sendiri tidak bisa diberikan",
);
check(
  "lackingPermissions menyebut izin yang kurang",
  JSON.stringify(lackingPermissions("cashier", ["pos.sell", "pos.void", "billing.manage"])) ===
    JSON.stringify(["pos.void", "billing.manage"]),
  JSON.stringify(lackingPermissions("cashier", ["pos.sell", "pos.void", "billing.manage"])),
);

// ------------------------------------------------------ sanitize & efektif
check(
  "sanitizePermissions membuang izin tak dikenal dan mengurutkan",
  JSON.stringify(sanitizePermissions(["payable.manage", "pos.sell", "nope", "pos.sell"])) ===
    JSON.stringify(["pos.sell", "payable.manage"]),
  JSON.stringify(sanitizePermissions(["payable.manage", "pos.sell", "nope", "pos.sell"])),
);
check(
  "sanitizePermissions menerima nilai kosong sebagai daftar kosong",
  sanitizePermissions(undefined).length === 0 && sanitizePermissions(null).length === 0,
  "DITERIMA — nilai kosong melempar",
);

{
  const cashier = effectivePermissions("cashier");
  check(
    "tanpa peran kustom, izin peran bawaan yang berlaku",
    cashier.includes("pos.sell") && cashier.includes("report.view") && !cashier.includes("pos.void"),
    JSON.stringify(cashier),
  );
  const custom = effectivePermissions("cashier", ["pos.void", "stock.adjust"]);
  check(
    "peran kustom menggantikan peran bawaan, bukan menambahinya",
    JSON.stringify(custom) === JSON.stringify(["pos.void", "stock.adjust"]),
    JSON.stringify(custom),
  );
  check(
    "peran kustom tanpa izin sah jatuh kembali ke peran bawaan",
    effectivePermissions("cashier", ["hack.semua"]).includes("pos.sell"),
    JSON.stringify(effectivePermissions("cashier", ["hack.semua"])),
  );
  check(
    "anggota tanpa peran kustom memakai izin bawaannya",
    memberCan("cashier", null, "pos.sell") && !memberCan("cashier", null, "pos.void"),
    "DITERIMA — izin bawaan bocor",
  );
  check(
    "anggota dengan peran kustom hanya memakai izin peran itu",
    memberCan("cashier", ["pos.void"], "pos.void") &&
      !memberCan("cashier", ["pos.void"], "pos.sell"),
    "DITERIMA — peran kustom hanya menambah",
  );
}

check(
  "selisih izin melaporkan yang bertambah & hilang",
  (() => {
    const delta = permissionDelta(["pos.sell", "report.view"], ["pos.sell", "pos.void"]);
    return (
      JSON.stringify(delta.added) === JSON.stringify(["pos.void"]) &&
      JSON.stringify(delta.removed) === JSON.stringify(["report.view"])
    );
  })(),
  JSON.stringify(permissionDelta(["pos.sell", "report.view"], ["pos.sell", "pos.void"])),
);

check(
  "pemilik tidak bisa dipindah ke peran kustom",
  (assignmentError("owner") ?? "").includes("Pemilik") &&
    assignmentError("cashier") === null &&
    assignmentError("finance") === null,
  JSON.stringify({ owner: assignmentError("owner"), cashier: assignmentError("cashier") }),
);

check(
  "hitung pemakaian peran hanya untuk yang menunjuk peran itu",
  roleAssignments("role-1", [
    { customRoleId: "role-1", active: true },
    { customRoleId: "role-1", active: false },
    { customRoleId: "role-2", active: true },
    { active: true },
  ]) === 2,
  "DITERIMA — pemakaian peran salah dihitung",
);

check(
  "ringkasan peran menyebut jumlah izin yang sah",
  describeCustomRole({ name: "  Kasir  Malam ", permissions: ["pos.sell", "nope"] }) ===
    "Kasir Malam · 1 izin",
  describeCustomRole({ name: "  Kasir  Malam ", permissions: ["pos.sell", "nope"] }),
);

console.log(`${results.length}/${results.length} checks passed`);

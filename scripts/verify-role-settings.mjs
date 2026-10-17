/**
 * Uji aturan **pengaturan peran bawaan** (`src/convex/lib/roleSettings.ts`) tanpa
 * deployment.
 *
 * Yang diuji adalah modul murni yang dipakai backend (`roles.setBuiltin` /
 * `removeBuiltin` / `restoreBuiltin` / `resetBuiltin`, dan resolusi izin di
 * `resolveMembershipPermissions`), halaman Tim & Peran, kedua store, dan sesi
 * klien. Lima hal yang dijaga di sini:
 *
 *   - **tanpa baris = bawaan.** Workspace yang belum pernah membuka pengaturan ini
 *     harus berjalan persis seperti sebelum fitur ini ada;
 *   - **baris rusak tidak mengunci orang.** Izin kosong/tak dikenal diabaikan;
 *   - **pemilik selalu memegang seluruh izin**, bahkan kalau barisnya salah bentuk;
 *   - **tidak ada eskalasi**: penyunting tidak bisa memberi izin yang dia sendiri
 *     tidak punya, dan pagar itu dihitung dari izin **efektif**nya;
 *   - **tombol & penugasan mengikuti keadaan peran**, bukan sebaliknya.
 *
 * Usage: bun scripts/verify-role-settings.mjs
 */
import { readFileSync } from "node:fs";
import { PERMISSION_LABELS, ROLES, ROLE_LABELS, permissionsFor } from "../src/convex/lib/authz.ts";
import { sanitizePermissions } from "../src/convex/lib/rbac.ts";
import {
  assignableBuiltinRoles,
  builtinRoleLabel,
  describeBuiltinRole,
  isLockedRole,
  OWNER_ROLE_LOCK_REASON,
  roleActions,
  roleAssignmentCheck,
  roleChoicesForMember,
  roleIsCustomized,
  rolePermissions,
  rolePermissionsCustomized,
  roleSettingDiff,
  roleState,
  roleStateCheck,
  roleStateLabel,
  roleUnavailableReason,
  summarizeRoleSettings,
  validateRoleSetting,
} from "../src/convex/lib/roleSettings.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

/** Izin sebagai daftar yang bisa dibandingkan apa adanya. */
const izin = (list) => JSON.stringify(list);

// ------------------------------------------------------- bentuk dasar
check(
  "lima peran bawaan, label unik",
  ROLES.length === 5 && new Set(ROLES.map((role) => ROLE_LABELS[role])).size === 5,
  JSON.stringify(ROLES.map((role) => ROLE_LABELS[role])),
);
check(
  "setiap peran bawaan punya izin bawaan yang tidak kosong",
  ROLES.every((role) => permissionsFor(role).length > 0),
  JSON.stringify(ROLES.map((role) => [role, permissionsFor(role).length])),
);
check(
  "pemilik memegang seluruh izin yang dikenal",
  permissionsFor("owner").length === Object.keys(PERMISSION_LABELS).length,
  `${permissionsFor("owner").length} vs ${Object.keys(PERMISSION_LABELS).length}`,
);
check(
  "nama peran terbaca",
  ROLES.every((role) => builtinRoleLabel(role).trim().length > 2),
  JSON.stringify(ROLES.map((role) => builtinRoleLabel(role))),
);

// --------------------------------------------------- resolusi izin
for (const role of ROLES) {
  check(
    `tanpa penyesuaian, izin ${role} = izin bawaannya`,
    izin(rolePermissions(role, null)) === izin(sanitizePermissions(permissionsFor(role))),
    izin(rolePermissions(role, null)),
  );
}
check(
  "izin penyesuaian menggantikan izin bawaan",
  izin(rolePermissions("cashier", { role: "cashier", permissions: ["pos.void"] })) ===
    izin(["pos.void"]),
  izin(rolePermissions("cashier", { role: "cashier", permissions: ["pos.void"] })),
);
check(
  "izin penyesuaian disaring & diurutkan kanonik",
  izin(
    rolePermissions("cashier", {
      role: "cashier",
      permissions: ["report.view", "pos.sell", "pos.sell", "hack.semua"],
    }),
  ) === izin(["pos.sell", "report.view"]),
  izin(
    rolePermissions("cashier", {
      role: "cashier",
      permissions: ["report.view", "pos.sell", "pos.sell", "hack.semua"],
    }),
  ),
);
check(
  "izin penyesuaian yang kosong/rusak diabaikan (kembali ke bawaan)",
  izin(rolePermissions("cashier", { role: "cashier", permissions: [] })) ===
    izin(sanitizePermissions(permissionsFor("cashier"))) &&
    izin(rolePermissions("cashier", { role: "cashier", permissions: ["hack.semua"] })) ===
      izin(sanitizePermissions(permissionsFor("cashier"))),
  izin(rolePermissions("cashier", { role: "cashier", permissions: ["hack.semua"] })),
);
check(
  "pemilik tetap memegang seluruh izin walau barisnya menyesuaikan",
  izin(rolePermissions("owner", { role: "owner", permissions: ["pos.sell"] })) ===
    izin(sanitizePermissions(permissionsFor("owner"))),
  izin(rolePermissions("owner", { role: "owner", permissions: ["pos.sell"] })),
);

// --------------------------------------------------- keadaan & status
check(
  "tanpa baris berarti aktif",
  roleState(null) === "aktif" && roleStateLabel(null) === "aktif",
  roleState(null),
);
check(
  "active: false berarti nonaktif",
  roleState({ role: "cashier", active: false }) === "nonaktif",
  roleState({ role: "cashier", active: false }),
);
check(
  "removed: true berarti dihapus (menang atas nonaktif)",
  roleState({ role: "cashier", active: false, removed: true }) === "dihapus" &&
    roleStateLabel({ role: "cashier", removed: true }) === "dihapus",
  roleState({ role: "cashier", active: false, removed: true }),
);
check(
  "pemilik selalu terbaca aktif",
  roleState({ role: "owner", active: false, removed: true }) === "aktif",
  roleState({ role: "owner", active: false, removed: true }),
);
check(
  "rolePermissionsCustomized hanya saat ada izin pengganti yang sah",
  rolePermissionsCustomized({ role: "cashier", permissions: ["pos.sell"] }) === true &&
    rolePermissionsCustomized({ role: "cashier", permissions: [] }) === false &&
    rolePermissionsCustomized({ role: "cashier", active: false }) === false,
  JSON.stringify([
    rolePermissionsCustomized({ role: "cashier", permissions: ["pos.sell"] }),
    rolePermissionsCustomized({ role: "cashier", permissions: [] }),
  ]),
);
check(
  "roleIsCustomized mencakup izin & status",
  roleIsCustomized({ role: "cashier", active: false }) === true &&
    roleIsCustomized({ role: "cashier", removed: true }) === true &&
    roleIsCustomized({ role: "cashier", active: true }) === false &&
    roleIsCustomized(null) === false,
  JSON.stringify([
    roleIsCustomized({ role: "cashier", active: false }),
    roleIsCustomized({ role: "cashier", active: true }),
  ]),
);

// ------------------------------------------------------ daftar & pilihan
check(
  "peran yang dinonaktifkan/dihapus tidak bisa ditugaskan",
  izin(assignableBuiltinRoles([{ role: "cashier", active: false }])) ===
    izin(["owner", "manager", "inventory", "finance"]) &&
    izin(assignableBuiltinRoles([{ role: "finance", removed: true }])) ===
      izin(["owner", "manager", "cashier", "inventory"]),
  izin(assignableBuiltinRoles([{ role: "cashier", active: false }])),
);
check(
  "peran yang sedang dipakai anggota tetap boleh dipertahankan",
  roleStateCheck("cashier", [{ role: "cashier", active: false }], "cashier").ok === true,
  JSON.stringify(roleStateCheck("cashier", [{ role: "cashier", active: false }], "cashier")),
);
check(
  "peran nonaktif ditolak untuk anggota lain, dengan alasan yang menyebutnya",
  (() => {
    const hasil = roleStateCheck("cashier", [{ role: "cashier", active: false }], null);
    return !hasil.ok && hasil.reason.includes("sedang nonaktif");
  })(),
  JSON.stringify(roleStateCheck("cashier", [{ role: "cashier", active: false }], null)),
);
check(
  "peran yang dihapus ditolak untuk anggota baru",
  (() => {
    const hasil = roleStateCheck("cashier", [{ role: "cashier", removed: true }], null);
    return !hasil.ok && hasil.reason.includes("sudah dihapus");
  })(),
  JSON.stringify(roleStateCheck("cashier", [{ role: "cashier", removed: true }], null)),
);
check(
  "kalimat alasan peran bawaan tersedia untuk kedua keadaan",
  roleUnavailableReason("cashier", "nonaktif").includes("Kasir") &&
    roleUnavailableReason("cashier", "dihapus").includes("Kasir"),
  roleUnavailableReason("cashier", "dihapus"),
);
check(
  "hanya pemilik yang boleh menetapkan peran pemilik",
  roleAssignmentCheck("owner", { actingRole: "cashier" }).ok === false &&
    roleAssignmentCheck("owner", { actingRole: "owner" }).ok === true,
  JSON.stringify(roleAssignmentCheck("owner", { actingRole: "cashier" })),
);
check(
  "peran aktif boleh ditugaskan siapa saja yang berhak mengundang",
  roleAssignmentCheck("cashier", { actingRole: "manager" }).ok === true &&
    roleAssignmentCheck("cashier", { actingRole: "manager" }).ok &&
    roleAssignmentCheck("cashier", {
      actingRole: "manager",
      settings: [{ role: "cashier" }],
    }).ok,
  JSON.stringify(roleAssignmentCheck("cashier", { actingRole: "manager" })),
);
check(
  "pilihan peran anggota tidak menggandakan peran lama, dan tidak menghilangkannya",
  izin(roleChoicesForMember(["cashier", "manager"], "cashier")) ===
    izin(["cashier", "manager"]) &&
    izin(roleChoicesForMember(["cashier", "manager"], "finance")) ===
      izin(["cashier", "manager", "finance"]),
  izin(roleChoicesForMember(["cashier", "manager"], "finance")),
);
check(
  "ringkasan menghitung yang disesuaikan, dinonaktifkan, dihapus, dan tersedia",
  (() => {
    const ringkas = summarizeRoleSettings([
      { role: "cashier", permissions: ["pos.sell"] },
      { role: "inventory", active: false },
      { role: "finance", removed: true },
    ]);
    return (
      ringkas.customized === 1 &&
      ringkas.disabled === 1 &&
      ringkas.removed === 1 &&
      ringkas.assignable === 3
    );
  })(),
  JSON.stringify(
    summarizeRoleSettings([
      { role: "cashier", permissions: ["pos.sell"] },
      { role: "inventory", active: false },
      { role: "finance", removed: true },
    ]),
  ),
);
check(
  "ringkasan mengabaikan baris dengan peran tak dikenal",
  summarizeRoleSettings([{ role: "superadmin", permissions: ["pos.sell"] }]).customized === 0,
  JSON.stringify(summarizeRoleSettings([{ role: "superadmin", permissions: ["pos.sell"] }])),
);
check(
  "ringkasan peran menyebut izinnya disesuaikan atau tidak",
  describeBuiltinRole({ label: "Kasir", permissions: ["pos.sell"], customized: true }) ===
    "Kasir · 1 izin (disesuaikan)" &&
    describeBuiltinRole({ label: "Kasir", permissions: ["pos.sell"], customized: false }) ===
      "Kasir · 1 izin (bawaan)",
  describeBuiltinRole({ label: "Kasir", permissions: ["pos.sell"], customized: true }),
);

// ------------------------------------------------------------ validasi
check(
  "peran tak dikenal ditolak",
  (() => {
    const hasil = validateRoleSetting(
      { permissions: ["pos.sell"] },
      { role: "superadmin", actingPermissions: permissionsFor("owner") },
    );
    return !hasil.ok && hasil.reason.includes("tidak dikenal");
  })(),
  JSON.stringify(
    validateRoleSetting(
      { permissions: ["pos.sell"] },
      { role: "superadmin", actingPermissions: permissionsFor("owner") },
    ),
  ),
);
check(
  "izin tak dikenal ditolak",
  (() => {
    const hasil = validateRoleSetting(
      { permissions: ["pos.sell", "hack.semua"] },
      { role: "cashier", actingPermissions: permissionsFor("owner") },
    );
    return !hasil.ok && hasil.reason.includes("Izin tidak dikenal");
  })(),
  JSON.stringify(
    validateRoleSetting(
      { permissions: ["pos.sell", "hack.semua"] },
      { role: "cashier", actingPermissions: permissionsFor("owner") },
    ),
  ),
);
check(
  "peran tanpa izin ditolak",
  (() => {
    const hasil = validateRoleSetting(
      { permissions: [] },
      { role: "cashier", actingPermissions: permissionsFor("owner") },
    );
    return !hasil.ok && hasil.reason.includes("minimal satu izin");
  })(),
  JSON.stringify(
    validateRoleSetting(
      { permissions: [] },
      { role: "cashier", actingPermissions: permissionsFor("owner") },
    ),
  ),
);
{
  const hasil = validateRoleSetting(
    { permissions: ["report.view", "pos.sell", "pos.sell"] },
    { role: "cashier", actingPermissions: permissionsFor("owner") },
  );
  check(
    "izin yang disimpan sudah tersaring & terurut kanonik",
    hasil.ok && izin(hasil.value.permissions) === izin(["pos.sell", "report.view"]),
    JSON.stringify(hasil.ok ? hasil.value.permissions : hasil.reason),
  );
}
check(
  "kasir tidak bisa memberi izin di luar wewenangnya",
  (() => {
    const hasil = validateRoleSetting(
      { permissions: ["pos.sell", "billing.manage"] },
      { role: "cashier", actingPermissions: permissionsFor("cashier") },
    );
    return !hasil.ok && hasil.reason.includes("tidak punya");
  })(),
  JSON.stringify(
    validateRoleSetting(
      { permissions: ["pos.sell", "billing.manage"] },
      { role: "cashier", actingPermissions: permissionsFor("cashier") },
    ),
  ),
);
check(
  "pagar eskalasi memakai izin efektif, bukan izin bawaan peran",
  (() => {
    // Manajer yang izinnya sudah dipersempit workspace: izin bawaan peran manajer
    // memuat `billing.manage`, tetapi izin efektifnya tidak.
    const efektif = sanitizePermissions(permissionsFor("manager")).filter(
      (permission) => permission !== "billing.manage",
    );
    return validateRoleSetting(
      { permissions: ["billing.manage"] },
      { role: "finance", actingPermissions: efektif },
    ).ok === false;
  })(),
  JSON.stringify(
    validateRoleSetting(
      { permissions: ["billing.manage"] },
      { role: "finance", actingPermissions: sanitizePermissions(permissionsFor("manager")) },
    ),
  ),
);
check(
  "menonaktifkan peran selalu boleh, walau tanpa izin apa pun",
  validateRoleSetting(
    { active: false },
    { role: "manager", actingPermissions: [] },
  ).ok === true &&
    validateRoleSetting(
      { active: true },
      { role: "manager", actingPermissions: [] },
    ).ok === true,
  JSON.stringify(
    validateRoleSetting({ active: false }, { role: "manager", actingPermissions: [] }),
  ),
);
for (const [label, input] of [
  ["izin", { permissions: ["pos.sell"] }],
  ["nonaktif", { active: false }],
  ["hapus", { removed: true }],
]) {
  check(
    `pemilik tidak bisa diubah lewat jalur ${label}`,
    (() => {
      const hasil = validateRoleSetting(input, {
        role: "owner",
        actingPermissions: permissionsFor("owner"),
      });
      return !hasil.ok && hasil.reason === OWNER_ROLE_LOCK_REASON;
    })(),
    JSON.stringify(
      validateRoleSetting(input, { role: "owner", actingPermissions: permissionsFor("owner") }),
    ),
  );
}
check(
  "pemilik dikenali sebagai peran terkunci",
  isLockedRole("owner") && !isLockedRole("manager") && !isLockedRole("cashier"),
  JSON.stringify(ROLES.filter(isLockedRole)),
);
check(
  "penyuntingan peran lain lewat pagar eskalasi yang sama, bukan aturan khusus",
  validateRoleSetting(
    { permissions: ["pos.sell", "report.view"] },
    { role: "cashier", actingPermissions: permissionsFor("manager") },
  ).ok === true &&
    validateRoleSetting(
      { permissions: ["billing.manage"] },
      { role: "cashier", actingPermissions: permissionsFor("manager") },
    ).ok === false,
  "DITERIMA — manajer bisa melewati pagar eskalasi",
);

// ------------------------------------------------------------- tombol
{
  const pemilik = roleActions({
    role: "owner",
    active: true,
    removed: false,
    customized: false,
    memberCount: 1,
    canManage: true,
  });
  check(
    "pemilik tidak punya tombol apa pun",
    !pemilik.edit && !pemilik.toggle && !pemilik.remove && !pemilik.restore && !pemilik.reset,
    JSON.stringify(pemilik),
  );
  check(
    "alasan tombol pemilik yang mati menyebut pemiliknya",
    (pemilik.removeReason ?? "").includes("Pemilik tenant"),
    String(pemilik.removeReason),
  );
}
{
  const tanpaIzin = roleActions({
    role: "cashier",
    active: true,
    removed: false,
    customized: false,
    memberCount: 0,
    canManage: false,
  });
  check(
    "tanpa izin team.manage, semua tombol mati dengan alasannya",
    !tanpaIzin.edit &&
      !tanpaIzin.toggle &&
      !tanpaIzin.remove &&
      (tanpaIzin.removeReason ?? "").includes("team.manage"),
    JSON.stringify(tanpaIzin),
  );
}
{
  const terpakai = roleActions({
    role: "cashier",
    active: true,
    removed: false,
    customized: true,
    memberCount: 3,
    canManage: true,
  });
  check(
    "peran yang masih dipakai: Hapus mati, alasannya menyebut jumlah anggota",
    terpakai.edit &&
      terpakai.toggle &&
      !terpakai.remove &&
      terpakai.reset &&
      (terpakai.removeReason ?? "").includes("3 anggota"),
    JSON.stringify(terpakai),
  );
}
{
  const dihapus = roleActions({
    role: "finance",
    active: true,
    removed: true,
    customized: false,
    memberCount: 0,
    canManage: true,
  });
  check(
    "peran yang dihapus: hanya Pulihkan (dan Ubah izin) yang hidup",
    dihapus.edit && !dihapus.toggle && !dihapus.remove && dihapus.restore && !dihapus.reset,
    JSON.stringify(dihapus),
  );
  const kosong = roleActions({
    role: "finance",
    active: true,
    removed: false,
    customized: false,
    memberCount: 0,
    canManage: true,
  });
  check(
    "peran bawaan yang belum disesuaikan: Kembalikan izin bawaan mati",
    kosong.remove && !kosong.reset && !kosong.restore,
    JSON.stringify(kosong),
  );
}

// ------------------------------------------------------------- selisih
check(
  "selisih penyesuaian melaporkan izin yang bertambah & hilang",
  (() => {
    const selisih = roleSettingDiff(
      { role: "cashier", permissions: ["pos.sell", "report.view"] },
      { role: "cashier", permissions: ["pos.sell", "pos.void"] },
    );
    return (
      izin(selisih.permissionsAdded) === izin(["pos.void"]) &&
      izin(selisih.permissionsRemoved) === izin(["report.view"])
    );
  })(),
  JSON.stringify(
    roleSettingDiff(
      { role: "cashier", permissions: ["pos.sell", "report.view"] },
      { role: "cashier", permissions: ["pos.sell", "pos.void"] },
    ),
  ),
);
check(
  "selisih dari bawaan melaporkan seluruh izin yang hilang",
  (() => {
    const selisih = roleSettingDiff(null, { role: "cashier", permissions: ["pos.sell"] });
    return selisih.permissionsRemoved.length === permissionsFor("cashier").length - 1;
  })(),
  JSON.stringify(roleSettingDiff(null, { role: "cashier", permissions: ["pos.sell"] })),
);

// ------------------------------------------- sinkron dengan skema & halaman
{
  const schema = readFileSync(new URL("../src/convex/schema.ts", import.meta.url), "utf8");
  const start = schema.indexOf("roleSettings: defineTable(");
  check("tabel roleSettings ada di skema", start !== -1, "tidak ditemukan");
  const blok = schema.slice(start, start + 900);
  check(
    "kolom roleSettings lengkap (role, permissions, active, removed)",
    blok.includes('role: roleValidator') &&
      blok.includes("permissions: v.optional(v.array(permissionValidator))") &&
      blok.includes("active: v.optional(v.boolean())") &&
      blok.includes("removed: v.optional(v.boolean())"),
    blok.slice(0, 400),
  );
  check(
    "indeks (tenantId, role) tersedia untuk pembacaan per peran",
    blok.includes('.index("by_tenant_role", ["tenantId", "role"])'),
    blok.slice(-300),
  );
  check(
    "izin peranSettings memakai validator izin yang sama",
    blok.includes("v.array(permissionValidator)"),
    blok.slice(0, 300),
  );
}

{
  // Halaman harus benar-benar memakai aksi peran bawaan & aturan murninya, bukan
  // memutuskan sendiri di JSX.
  const page = readFileSync(new URL("../src/pages/TeamPage.tsx", import.meta.url), "utf8");
  for (const panggilan of [
    "updateBuiltinRole",
    "deleteBuiltinRole",
    "restoreBuiltinRole",
    "resetBuiltinRole",
    "validateRoleSetting",
    "roleActions",
    "describeBuiltinRole",
  ]) {
    check(
      `halaman Tim & Peran memakai ${panggilan}`,
      page.includes(panggilan),
      "tidak dipakai di halaman",
    );
  }
  check(
    "halaman menampilkan kartu peran bawaan beserta testid-nya",
    page.includes("Peran bawaan") && page.includes("peran-bawaan-"),
    "kartu peran bawaan tidak ditemukan",
  );
}

console.log(`${results.length}/${results.length} checks passed`);

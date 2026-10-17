/**
 * Uji aturan keanggotaan tim (`src/convex/lib/team.ts`) tanpa deployment.
 *
 * Yang diuji: normalisasi nomor WhatsApp, tautan & isi pesan undangan WhatsApp,
 * pagar perubahan anggota — “pemilik terakhir”, “hanya pemilik yang
 * menyentuh peran pemilik”, dan “akun sendiri tidak dikunci dari sini” — serta
 * keputusan **tombol undangan** (`resolveTeamInviteForm`): kapan tombolnya boleh
 * ditekan, dan kalimat apa yang terbaca saat belum boleh. Aturan yang sama dipakai
 * server (`members.add`/`update`/`remove`), halaman Tim & Peran, dan kedua store.
 *
 * Usage: bun scripts/verify-team.mjs
 */
import {
  assignableRoles,
  inviteEmailContent,
  inviteLoginUrl,
  legacyRoleCleanupDecision,
  MEMBER_CHANGE_LABELS,
  MEMBERSHIP_SUSPENDED_NOTE,
  MEMBER_NAME_MAX,
  normalizePhone,
  parseRoleChoice,
  resolveTeamInviteForm,
  ROLE_CHOICE_CUSTOM_PREFIX,
  roleChoiceValue,
  validateTeamInvite,
  validateTeamMemberEdit,
  validateTeamMemberRemoval,
  waInviteSentence,
  whatsappInviteText,
  whatsappInviteUrl,
  WORKSPACE_PENDING_INVITE_NOTE,
} from "../src/convex/lib/team.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// --------------------------------------------------------- nomor WhatsApp
check(
  "nomor Indonesia dengan pemisah dinormalkan ke kode negara 62",
  normalizePhone("0812-3456-7890").value === "6281234567890",
  JSON.stringify(normalizePhone("0812-3456-7890")),
);
check(
  "nomor bertanda + dan berspasi juga dinormalkan",
  normalizePhone("+62 812 3456 7890").value === "6281234567890",
  JSON.stringify(normalizePhone("+62 812 3456 7890")),
);
check(
  "nomor yang diawali 8 diberi kode negara",
  normalizePhone("8123456789").value === "628123456789",
  JSON.stringify(normalizePhone("8123456789")),
);
check(
  "awalan panggilan internasional 00 dibuang",
  normalizePhone("0062 812 3456 7890").value === "6281234567890",
  JSON.stringify(normalizePhone("0062 812 3456 7890")),
);
for (const [label, raw] of [
  ["kosong", ""],
  ["terlalu pendek", "0812"],
  ["terlalu panjang", "0812345678901234567"],
]) {
  const hasil = normalizePhone(raw);
  check(`nomor ${label} ditolak`, hasil.valid === false, JSON.stringify(hasil));
}

// ----------------------------------------------------------- tautan wa.me
const teks = whatsappInviteText({
  workspace: "Kopi Senja",
  email: "sari@bisnis.id",
  name: "Sari",
  role: "cashier",
  invitedBy: "Budi",
  loginUrl: "https://mesinpos.id/auth",
});
check(
  "pesan WhatsApp menyebut workspace, peran, email, dan cara masuknya",
  teks.includes("Kopi Senja") &&
    teks.includes("Kasir") &&
    teks.includes("sari@bisnis.id") &&
    teks.includes("https://mesinpos.id/auth") &&
    teks.includes("kode 6 digit yang dikirim ke email"),
  teks,
);
check(
  "pesan WhatsApp menyebut siapa yang mengundang",
  teks.includes("oleh Budi"),
  teks,
);
check(
  "pesan WhatsApp menegaskan yang dikirim ke WhatsApp bukan kodenya",
  teks.includes("kode 6 digit yang dikirim ke email"),
  teks.slice(0, 200),
);

const tautan = whatsappInviteUrl({ phone: "0812-3456-7890", text: teks });
check(
  "tautan wa.me memakai nomor ternormalisasi",
  tautan.ok && tautan.url.startsWith("https://wa.me/6281234567890?text="),
  tautan.ok ? tautan.url.slice(0, 80) : tautan.reason,
);
check(
  "isi pesan di tautan di-encode, bukan ditempel mentah",
  tautan.ok &&
    !tautan.url.includes(" ") &&
    tautan.url.includes(encodeURIComponent("Kopi Senja")),
  tautan.ok ? tautan.url.slice(0, 160) : tautan.reason,
);
const tautanSalah = whatsappInviteUrl({ phone: "0812", text: "hai" });
check(
  "nomor tidak valid ditolak sebelum tautan dibuat",
  tautanSalah.ok === false && typeof tautanSalah.reason === "string",
  JSON.stringify(tautanSalah),
);
check(
  "tautan halaman Masuk memakai SITE_URL, dan kosong berarti tanpa alamat",
  inviteLoginUrl("https://mesinpos.id/") === "https://mesinpos.id/auth" &&
    inviteLoginUrl(null) === null,
  `${inviteLoginUrl("https://mesinpos.id/")} / ${inviteLoginUrl(null)}`,
);

// ------------------------------------------------- status undangan WhatsApp
check(
  "status WA kosong dikatakan belum ada, bukan terkirim",
  waInviteSentence({ at: null, count: 0 }).includes("Belum ada") &&
    !waInviteSentence({ at: null, count: 0 }).includes("terkirim lewat"),
  waInviteSentence({ at: null, count: 0 }),
);
check(
  "status WA mengaku tautan dibuka, bukan pesan terkirim",
  waInviteSentence({ at: Date.now(), count: 2 }).includes("dibuka 2×") &&
    waInviteSentence({ at: Date.now(), count: 2 }).includes(
      "dikirim dari aplikasi WhatsApp pengundang",
    ),
  waInviteSentence({ at: Date.now(), count: 2 }),
);

// ------------------------------------------------------- undangan email (WA tidak menghapus jalur email)
check(
  "email undangan tetap ada dan menyebut email itu sendiri",
  inviteEmailContent({
    workspace: "Kopi Senja",
    email: "sari@bisnis.id",
    role: "cashier",
    loginUrl: inviteLoginUrl("https://mesinpos.id"),
  }).text.includes("sari@bisnis.id"),
  "email undangan",
);
/*
  Peran tambahan berdiri sendiri: undangan yang memakainya tidak membawa peran
  bawaan apa pun (`role: null`), dan emailnya hanya menyebut **satu** peran — nama
  peran tambahannya — bukan “Kasir (peran kustom: …)”.
*/
check(
  "email undangan menyebut satu peran saja saat memakai peran tambahan",
  inviteEmailContent({
    workspace: "Kopi Senja",
    email: "malam@bisnis.id",
    role: null,
    customRoleName: "Kasir Shift Malam",
    loginUrl: inviteLoginUrl("https://mesinpos.id"),
  }).text.includes("sebagai Kasir Shift Malam di workspace") &&
    !inviteEmailContent({
      workspace: "Kopi Senja",
      email: "malam@bisnis.id",
      role: null,
      customRoleName: "Kasir Shift Malam",
      loginUrl: inviteLoginUrl("https://mesinpos.id"),
    }).text.includes("peran kustom:") &&
    !inviteEmailContent({
      workspace: "Kopi Senja",
      email: "malam@bisnis.id",
      role: null,
      loginUrl: inviteLoginUrl("https://mesinpos.id"),
    }).text.includes("peran kustom"),
  inviteEmailContent({
    workspace: "Kopi Senja",
    email: "malam@bisnis.id",
    role: null,
    customRoleName: "Kasir Shift Malam",
    loginUrl: inviteLoginUrl("https://mesinpos.id"),
  })
    .text.split("\n")
    .slice(0, 6)
    .join(" / "),
);
check(
  "undangan tanpa peran bawaan & tanpa peran tambahan ditolak",
  validateTeamInvite({ email: "sari@bisnis.id", role: null }, { actingRole: "owner" })
    .ok === false,
  JSON.stringify(
    validateTeamInvite({ email: "sari@bisnis.id", role: null }, { actingRole: "owner" }),
  ),
);
check(
  "peran pemilik hanya ditawarkan kepada pemilik",
  assignableRoles("owner").includes("owner") &&
    !assignableRoles("manager").includes("owner") &&
    assignableRoles("cashier").length === 4,
  `${assignableRoles("owner").join(",")} | ${assignableRoles("manager").join(",")}`,
);

// ------------------------------------------------------- undangan tim (email)
check(
  "email undangan tanpa titik ditolak",
  validateTeamInvite({ email: "sari@toko", role: "cashier" }, { actingRole: "owner" })
    .ok === false,
  "email tanpa titik",
);

/*
  **Satu nilai untuk satu pemilih peran.** Formulir undangan dan kolom Peran di
  daftar anggota memakai fungsi yang sama: peran bawaan apa adanya, peran tambahan
  dengan awalan `custom:<id>` yang **berdiri sendiri** — nilainya tidak membawa
  peran bawaan mana pun (`role: null`).
*/
check(
  "peran bawaan & peran tambahan punya satu bentuk nilai yang bisa dibaca balik",
  roleChoiceValue("manager", null) === "manager" &&
    roleChoiceValue(null, "role-malam") === `${ROLE_CHOICE_CUSTOM_PREFIX}role-malam` &&
    JSON.stringify(parseRoleChoice("manager")) ===
      JSON.stringify({ role: "manager", customRoleId: null }) &&
    JSON.stringify(parseRoleChoice(`${ROLE_CHOICE_CUSTOM_PREFIX}role-malam`)) ===
      JSON.stringify({ role: null, customRoleId: "role-malam" }) &&
    parseRoleChoice(`${ROLE_CHOICE_CUSTOM_PREFIX}`) === null &&
    parseRoleChoice("peran-asing") === null,
  `${roleChoiceValue("manager", null)} | ${roleChoiceValue(null, "role-malam")} | ${JSON.stringify(parseRoleChoice(`${ROLE_CHOICE_CUSTOM_PREFIX}role-malam`))}`,
);
check(
  "peran tambahan tidak menuliskan peran bawaan apa pun",
  parseRoleChoice(`${ROLE_CHOICE_CUSTOM_PREFIX}role-malam`).role === null,
  JSON.stringify(parseRoleChoice(`${ROLE_CHOICE_CUSTOM_PREFIX}role-malam`)),
);
/*
  Peran tambahan berdiri sendiri: Kasir yang dinonaktifkan/dihapus tidak boleh
  memblokir penugasan peran tambahan, sedangkan undangan yang memakai peran
  bawaan biasa tetap mengikuti status peran itu.
*/
check(
  "status peran bawaan tidak memblokir undangan berperan tambahan",
  validateTeamInvite(
    { email: "malam@bisnis.id", role: null },
    {
      actingRole: "owner",
      standaloneCustomRole: true,
      roleSettings: [{ role: "cashier", active: false, removed: false }],
    },
  ).ok === true &&
    validateTeamInvite(
      { email: "biasa@bisnis.id", role: "cashier" },
      {
        actingRole: "owner",
        roleSettings: [{ role: "cashier", active: false, removed: false }],
      },
    ).ok === false,
  "undangan peran tambahan ditolak oleh status Kasir",
);

// ------------------------------------------------------------ ubah anggota
const sari = {
  membershipId: "mem-sari",
  name: "Sari Wulandari",
  email: "sari@bisnis.id",
  role: "cashier",
  phone: "6281234567890",
  active: true,
};
const konteks = {
  actingRole: "owner",
  activeOwners: 2,
  otherEmails: ["budi@bisnis.id"],
};

check(
  "tanpa perubahan tidak ada field yang berubah",
  validateTeamMemberEdit(sari, {}, konteks).changed.length === 0,
  JSON.stringify(validateTeamMemberEdit(sari, {}, konteks)),
);
{
  const hasil = validateTeamMemberEdit(
    sari,
    { name: "  Sari   Wulandari  ", phone: "0812-3456-7891", active: false },
    konteks,
  );
  check(
    "perubahan nama, nomor WA, dan status terdeteksi",
    hasil.ok &&
      hasil.value.name === "Sari Wulandari" &&
      hasil.value.phone === "6281234567891" &&
      hasil.value.active === false &&
      hasil.changed.join(",") === "phone,active",
    JSON.stringify(hasil),
  );
}
{
  const hasil = validateTeamMemberEdit(sari, { phone: "" }, konteks);
  check(
    "nomor WhatsApp dikosongkan berarti dihapus",
    hasil.ok && hasil.value.phone === null && hasil.changed.includes("phone"),
    JSON.stringify(hasil),
  );
}
check(
  "nomor WhatsApp salah bentuk ditolak",
  validateTeamMemberEdit(sari, { phone: "0812" }, konteks).ok === false,
  "nomor terlalu pendek",
);
check(
  `nama di luar batas 2–${MEMBER_NAME_MAX} ditolak`,
  validateTeamMemberEdit(sari, { name: "A" }, konteks).ok === false,
  "nama terlalu pendek",
);
check(
  "email yang sudah dipakai anggota lain ditolak",
  validateTeamMemberEdit(sari, { email: "budi@bisnis.id" }, konteks).ok === false,
  "email bentrok",
);
check(
  "email salah bentuk ditolak saat diubah",
  validateTeamMemberEdit(sari, { email: "sari@toko" }, konteks).ok === false,
  "email tanpa titik",
);

// Pagar peran pemilik.
{
  const manajer = { actingRole: "manager", activeOwners: 2, otherEmails: [] };
  check(
    "manajer tidak bisa mengangkat pemilik",
    validateTeamMemberEdit(sari, { role: "owner" }, manajer).ok === false,
    "eskalasi pemilik",
  );
  const pemilik = { membershipId: "mem-budi", name: "Budi", email: "budi@bisnis.id", role: "owner", phone: null, active: true };
  check(
    "manajer tidak bisa menurunkan peran pemilik",
    validateTeamMemberEdit(pemilik, { role: "cashier" }, manajer).ok === false,
    "penurunan pemilik",
  );
  check(
    "manajer tidak bisa menonaktifkan pemilik",
    validateTeamMemberEdit(pemilik, { active: false }, manajer).ok === false,
    "nonaktifkan pemilik",
  );
  check(
    "manajer tetap boleh mengubah nama anggota biasa",
    validateTeamMemberEdit(sari, { name: "Sari W." }, manajer).ok === true,
    "ubah nama",
  );
}

// Pagar pemilik terakhir.
{
  const pemilik = { membershipId: "mem-budi", name: "Budi", email: "budi@bisnis.id", role: "owner", phone: null, active: true };
  const satuPemilik = { actingRole: "owner", activeOwners: 1, otherEmails: [] };
  const hasilTurun = validateTeamMemberEdit(pemilik, { role: "manager" }, satuPemilik);
  check(
    "pemilik terakhir tidak bisa diturunkan",
    hasilTurun.ok === false && hasilTurun.reason.includes("minimal satu pemilik aktif"),
    JSON.stringify(hasilTurun),
  );
  const hasilNonaktif = validateTeamMemberEdit(pemilik, { active: false }, satuPemilik);
  check(
    "pemilik terakhir tidak bisa dinonaktifkan",
    hasilNonaktif.ok === false,
    JSON.stringify(hasilNonaktif),
  );
  const hasilBoleh = validateTeamMemberEdit(pemilik, { role: "manager" }, { ...satuPemilik, activeOwners: 2 });
  check(
    "pemilik boleh turun saat masih ada pemilik aktif lain",
    hasilBoleh.ok === true && hasilBoleh.changed.includes("role"),
    JSON.stringify(hasilBoleh),
  );
}

// Pagar akun sendiri.
check(
  "akun sendiri tidak bisa dinonaktifkan dari halaman ini",
  validateTeamMemberEdit(sari, { active: false }, { ...konteks, actorMembershipId: "mem-sari" }).ok === false,
  "nonaktifkan diri sendiri",
);
check(
  "akun sendiri tetap boleh diubah namanya",
  validateTeamMemberEdit(sari, { name: "Sari W." }, { ...konteks, actorMembershipId: "mem-sari" }).ok === true,
  "ubah nama sendiri",
);

// ------------------------------------------------------------ hapus anggota
check(
  "akun sendiri tidak bisa dihapus dari tim",
  validateTeamMemberRemoval(
    { membershipId: "mem-sari", role: "cashier", active: true },
    { actingRole: "owner", actorMembershipId: "mem-sari", activeOwners: 2 },
  ).ok === false,
  "hapus diri sendiri",
);
check(
  "anggota biasa boleh dihapus oleh manajer",
  validateTeamMemberRemoval(
    { membershipId: "mem-sari", role: "cashier", active: true },
    { actingRole: "manager", actorMembershipId: "mem-manajer", activeOwners: 1 },
  ).ok === true,
  "hapus anggota biasa",
);
check(
  "pemilik tidak bisa dihapus oleh manajer",
  validateTeamMemberRemoval(
    { membershipId: "mem-budi", role: "owner", active: true },
    { actingRole: "manager", actorMembershipId: "mem-manajer", activeOwners: 2 },
  ).ok === false,
  "hapus pemilik oleh manajer",
);
check(
  "pemilik aktif terakhir tidak bisa dihapus",
  validateTeamMemberRemoval(
    { membershipId: "mem-budi", role: "owner", active: true },
    { actingRole: "owner", actorMembershipId: "mem-lain", activeOwners: 1 },
  ).ok === false,
  "hapus pemilik terakhir",
);
check(
  "pemilik aktif boleh dihapus pemilik lain saat masih ada pengganti",
  validateTeamMemberRemoval(
    { membershipId: "mem-budi", role: "owner", active: true },
    { actingRole: "owner", actorMembershipId: "mem-lain", activeOwners: 2 },
  ).ok === true,
  "hapus pemilik kedua",
);

check(
  "label perubahan tersedia untuk semua field",
  ["name", "email", "role", "phone", "active"].every((field) => MEMBER_CHANGE_LABELS[field]),
  JSON.stringify(MEMBER_CHANGE_LABELS),
);

// ------------------------------------- tombol undangan: kapan boleh ditekan
// Satu keputusan untuk tombol, kalimat di bawahnya, dan pagar `submitInvite`.
{
  const sah = validateTeamInvite(
    { email: "sari@bisnis.id", name: "Sari", role: "cashier" },
    { actingRole: "owner" },
  );
  const emailSalah = validateTeamInvite(
    { email: "sari@bisnis", name: "Sari", role: "cashier" },
    { actingRole: "owner" },
  );

  const siap = resolveTeamInviteForm({
    workspacePending: false,
    error: null,
    preview: sah,
    phoneCheck: null,
  });
  check(
    "undangan siap dikirim saat workspace sudah tersambung & formulirnya sah",
    siap.ok === true && siap.value.email === "sari@bisnis.id",
    JSON.stringify(siap),
  );

  const tertahan = resolveTeamInviteForm({
    workspacePending: true,
    // Email & nomornya sengaja salah juga: alasan yang tampil harus soal
    // workspace, bukan soal kolom isian — sebab sebenarnya adalah workspace-nya.
    error: MEMBERSHIP_SUSPENDED_NOTE,
    preview: emailSalah,
    phoneCheck: { valid: false, reason: "Nomor WhatsApp harus 8–15 digit." },
  });
  check(
    "selama workspace belum tersambung, tombol undangan tertahan dengan alasan workspace",
    tertahan.ok === false && tertahan.reason === WORKSPACE_PENDING_INVITE_NOTE,
    JSON.stringify(tertahan),
  );
  check(
    "alasan workspace menyebut sebabnya dan langkah menunggunya",
    WORKSPACE_PENDING_INVITE_NOTE.includes("belum tersambung ke server") &&
      WORKSPACE_PENDING_INVITE_NOTE.includes("tunggu"),
    WORKSPACE_PENDING_INVITE_NOTE,
  );

  const emailTertahan = resolveTeamInviteForm({
    workspacePending: false,
    error: null,
    preview: emailSalah,
    phoneCheck: null,
  });
  check(
    "email yang tidak bisa menerima kode tetap menahan tombol beserta alasannya",
    emailTertahan.ok === false &&
      emailTertahan.reason.includes("Domain email harus punya titik"),
    JSON.stringify(emailTertahan),
  );

  const nomorTertahan = resolveTeamInviteForm({
    workspacePending: false,
    error: null,
    preview: sah,
    phoneCheck: { valid: false, reason: "Nomor WhatsApp harus 8–15 digit." },
  });
  check(
    "nomor WhatsApp yang tidak sah menahan tombol beserta alasannya",
    nomorTertahan.ok === false &&
      nomorTertahan.reason.includes("Nomor WhatsApp harus 8–15 digit"),
    JSON.stringify(nomorTertahan),
  );

  // Keanggotaan nonaktif / akun platform / bisnis gagal didaftarkan: store sudah
  // punya kalimatnya (`store.error`), dan tombol undangan memakai kalimat itu apa
  // adanya — bukan pesan teknis “Tenant belum siap”.
  const galat = resolveTeamInviteForm({
    workspacePending: false,
    error: MEMBERSHIP_SUSPENDED_NOTE,
    preview: emailSalah,
    phoneCheck: null,
  });
  check(
    "workspace yang tidak bisa dipakai menahan tombol dengan alasan dari store",
    galat.ok === false &&
      galat.reason.startsWith("Undangan belum bisa dikirim") &&
      galat.reason.includes(MEMBERSHIP_SUSPENDED_NOTE),
    JSON.stringify(galat),
  );
}

// ------------------- perapian baris anggota lama: peran bawaan + peran tambahan
// Baris yang ditulis sebelum 2026-10-17 menyimpan keduanya. Yang dilepas harus
// peran yang **tidak berlaku** sekarang, supaya akses orangnya tidak berubah.
{
  const tenant = "tenant-a";
  const roleSah = { tenantId: tenant, active: true };

  for (const [label, input] of [
    ["hanya peran bawaan", { role: "cashier", tenantId: tenant }],
    ["hanya peran tambahan", { role: null, customRoleId: "role-1", tenantId: tenant }],
    ["tanpa peran sama sekali", { tenantId: tenant }],
  ]) {
    const hasil = legacyRoleCleanupDecision(input);
    check(
      `baris ${label} tidak disentuh pembersihan`,
      hasil.action === "none" && hasil.reason === "sudah-satu-peran",
      JSON.stringify(hasil),
    );
  }

  const berdiriSendiri = legacyRoleCleanupDecision({
    role: "cashier",
    customRoleId: "role-1",
    tenantId: tenant,
    customRole: roleSah,
  });
  check(
    "peran tambahan yang sah melepas peran bawaan yang menumpang di belakangnya",
    berdiriSendiri.action === "drop-base-role" &&
      berdiriSendiri.reason === "peran-tambahan-berdiri-sendiri",
    JSON.stringify(berdiriSendiri),
  );

  for (const [label, customRole, reason] of [
    ["sudah dihapus", null, "peran-tambahan-hilang"],
    ["dinonaktifkan", { tenantId: tenant, active: false }, "peran-tambahan-nonaktif"],
    ["milik tenant lain", { tenantId: "tenant-b", active: true }, "peran-tambahan-tenant-lain"],
  ]) {
    const hasil = legacyRoleCleanupDecision({
      role: "cashier",
      customRoleId: "role-1",
      tenantId: tenant,
      customRole,
    });
    check(
      `peran tambahan yang ${label} dilepas, peran bawaan tetap berlaku`,
      hasil.action === "drop-custom-role" && hasil.reason === reason,
      JSON.stringify(hasil),
    );
  }

  // Pemilik harus selalu memegang seluruh izin; yang dilepas peran tambahannya,
  // bukan peran Pemiliknya — kalau tidak, workspace bisa kehilangan pemilik aktif
  // terakhir sekaligus terkunci dari langganannya sendiri.
  const pemilik = legacyRoleCleanupDecision({
    role: "owner",
    customRoleId: "role-1",
    tenantId: tenant,
    customRole: roleSah,
  });
  check(
    "anggotanya Pemilik: peran tambahan yang dilepas, peran Pemilik dipertahankan",
    pemilik.action === "drop-custom-role" && pemilik.reason === "pemilik-tetap-pemilik",
    JSON.stringify(pemilik),
  );
  const pemilikTanpaPeranTambahan = legacyRoleCleanupDecision({
    role: "owner",
    customRoleId: "role-1",
    tenantId: tenant,
    customRole: null,
  });
  check(
    "Pemilik dengan peran tambahan yang sudah hilang juga tetap Pemilik",
    pemilikTanpaPeranTambahan.action === "drop-custom-role" &&
      pemilikTanpaPeranTambahan.reason === "pemilik-tetap-pemilik",
    JSON.stringify(pemilikTanpaPeranTambahan),
  );
}

for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}`);
console.log(`\n${results.length}/${results.length} checks passed`);

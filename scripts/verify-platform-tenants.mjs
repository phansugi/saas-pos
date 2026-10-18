/**
 * Aturan pengelolaan **akun bisnis** dari backstage platform — tanpa deployment.
 *
 * Yang tidak bisa dijangkau harness biasa justru intinya: jalur “diterima”
 * menuntut identitas login terverifikasi, sedangkan klien harness selalu anonim.
 * Jadi keputusan menonaktifkan/menghapus, penyaring daftar, rekapnya, dan efek
 * penonaktifan pada akses tenant diuji di sini — langsung dari aturan murni yang
 * dipakai server dan halaman.
 *
 * Dua cek yang sengaja “meta” menjaga agar penghapusan tidak pernah meninggalkan
 * baris yatim saat ada tabel baru: daftar `TENANT_TABLES` dibandingkan dengan
 * `schema.ts` (setiap tabel ber-`tenantId` harus tersapu, dan setiap nama di daftar
 * harus benar-benar punya kolom itu + indeks yang disebut), serta `switch` di
 * `drainTenantTable` harus punya satu cabang untuk tiap langkah.
 *
 * Usage: bun scripts/verify-platform-tenants.mjs
 */
import {
  decideFixturePurge,
  decideFixtureUserPurge,
  FIXTURE_OWNER_DOMAINS,
  isFixtureOwnerEmail,
  USER_PURGE_BATCH,
  USER_PURGE_SCAN,
  TENANT_PURGE_BATCH,
  TENANT_PURGE_SCAN,
} from "../src/convex/lib/platformTenants.ts";
import {
  decideTenantDeletion,
  decideTenantSuspension,
  decideTenantUpdate,
  normaliseTenantSearch,
  TENANT_SEARCH_SCAN,
  tenantAccountMatches,
  normalisePlatformNote,
  PLATFORM_NOTE_MAX,
  PLATFORM_TENANT_ACTION_LABELS,
  slugConfirmationMatches,
  summariseTenantAccounts,
  TENANT_DELETE_BATCH,
  TENANT_TABLES,
  tenantAccountStatus,
  tenantAccountSummary,
} from "../src/convex/lib/platformTenants.ts";
import { accessForTenant } from "../src/convex/lib/access.ts";
import { PLAN_LIST, trimVerticalsForPlan } from "../src/convex/lib/billing/index.ts";
import { PROFILE_NAME_MAX, PROFILE_NAME_MIN } from "../src/convex/lib/profile.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const now = Date.now();
const tenant = (extra = {}) => ({
  name: "Toko Uji",
  slug: "toko-uji",
  planKey: "starter",
  suspendedAt: null,
  members: 3,
  stores: 1,
  ...extra,
});

// ------------------------------------------------------ status akun
check("akun tanpa penonaktifan berstatus aktif", tenantAccountStatus({ suspendedAt: null }) === "aktif");
check(
  "akun bertanda `suspendedAt` berstatus nonaktif",
  tenantAccountStatus({ suspendedAt: now }) === "nonaktif",
);
check(
  "akun yang sedang dihapus dibaca nonaktif walau belum ditandai suspend",
  tenantAccountStatus({ suspendedAt: null, deleting: true }) === "nonaktif",
);
check(
  "ringkasan menyebut paket, status, anggota, dan toko",
  tenantAccountSummary(tenant()) === "Toko Uji · paket starter · aktif · 3 anggota · 1 toko",
  tenantAccountSummary(tenant()),
);
check(
  "ringkasan akun yang dihapus menyebut “sedang dihapus”, bukan “nonaktif”",
  tenantAccountSummary(tenant({ deleting: true })).includes("sedang dihapus"),
  tenantAccountSummary(tenant({ deleting: true })),
);

// ------------------------------------------------------ catatan
check("catatan kosong menjadi tidak ada", normalisePlatformNote("   ") === undefined);
check("catatan null menjadi tidak ada", normalisePlatformNote(null) === undefined);
check(
  "catatan dirapikan spasinya",
  normalisePlatformNote("  laporan   #118 ") === "laporan #118",
  normalisePlatformNote("  laporan   #118 "),
);
check(
  "catatan dipotong di batas maksimum",
  normalisePlatformNote("x".repeat(PLATFORM_NOTE_MAX + 40)).length === PLATFORM_NOTE_MAX,
);

// ------------------------------------------------------ konfirmasi slug
check("slug yang diketik sama diterima", slugConfirmationMatches({ typed: "toko-uji", slug: "toko-uji" }));
check(
  "huruf besar/kecil dan spasi tepi tidak membedakan",
  slugConfirmationMatches({ typed: "  TOKO-UJI ", slug: "toko-uji" }),
);
check("slug kosong ditolak", !slugConfirmationMatches({ typed: "   ", slug: "toko-uji" }));
check(
  "slug yang berbeda satu huruf ditolak",
  !slugConfirmationMatches({ typed: "toko-uj", slug: "toko-uji" }),
);

// ------------------------------------------------------ menonaktifkan
const suspendOk = decideTenantSuspension({
  tenantExists: true,
  ownsTenant: false,
  deleting: false,
  suspended: true,
  note: "tagihan menunggak",
});
check("penonaktifan akun orang lain diizinkan", suspendOk.allowed === true);
check("catatan penonaktifan ikut disimpan", suspendOk.note === "tagihan menunggak", suspendOk.note);
check(
  "tenant yang tidak ada ditolak",
  decideTenantSuspension({ tenantExists: false, ownsTenant: false, deleting: false, suspended: true })
    .allowed === false,
);
const ownSuspend = decideTenantSuspension({
  tenantExists: true,
  ownsTenant: true,
  deleting: false,
  suspended: true,
});
check("workspace sendiri tidak bisa dinonaktifkan", ownSuspend.allowed === false);
check(
  "alasan penolakan workspace sendiri menjelaskan akibatnya",
  String(ownSuspend.reason).includes("workspace Anda sendiri"),
  ownSuspend.reason,
);
const deletingSuspend = decideTenantSuspension({
  tenantExists: true,
  ownsTenant: false,
  deleting: true,
  suspended: true,
});
check("akun yang sedang dihapus tidak bisa diubah statusnya", deletingSuspend.allowed === false);
check(
  "alasan penolakan menyebut penghapusan yang sedang berjalan",
  String(deletingSuspend.reason).includes("sedang dihapus"),
  deletingSuspend.reason,
);
check(
  "mengaktifkan kembali akun nonaktif diizinkan",
  decideTenantSuspension({ tenantExists: true, ownsTenant: false, deleting: false, suspended: false })
    .allowed === true,
);

// ------------------------------------------------------ menghapus
const hapusOk = decideTenantDeletion({
  tenantExists: true,
  ownsTenant: false,
  deleting: false,
  slug: "toko-uji",
  typedSlug: "toko-uji",
  note: "permintaan pemilik",
});
check("penghapusan dengan slug yang benar diizinkan", hapusOk.allowed === true);
check("catatan penghapusan ikut disimpan", hapusOk.note === "permintaan pemilik");
const hapusSalah = decideTenantDeletion({
  tenantExists: true,
  ownsTenant: false,
  deleting: false,
  slug: "toko-uji",
  typedSlug: "toko-lain",
});
check("slug yang salah menolak penghapusan", hapusSalah.allowed === false);
check(
  "alasan penolakan menyebut slug yang harus diketik",
  String(hapusSalah.reason).includes("toko-uji"),
  hapusSalah.reason,
);
check(
  "workspace sendiri tidak bisa dihapus",
  decideTenantDeletion({
    tenantExists: true,
    ownsTenant: true,
    deleting: false,
    slug: "toko-uji",
    typedSlug: "toko-uji",
  }).allowed === false,
);
check(
  "penghapusan yang sudah berjalan tidak bisa dimulai dua kali",
  decideTenantDeletion({
    tenantExists: true,
    ownsTenant: false,
    deleting: true,
    slug: "toko-uji",
    typedSlug: "toko-uji",
  }).allowed === false,
);
check(
  "tenant yang tidak ada ditolak sebelum slug diperiksa",
  decideTenantDeletion({
    tenantExists: false,
    ownsTenant: false,
    deleting: false,
    slug: "",
    typedSlug: "apa saja",
  }).allowed === false,
);

// ------------------------------------------------------ daftar
const rows = [
  tenant({ name: "Toko Uji", slug: "toko-uji", ownerEmail: "a@b.id", planKey: "starter" }),
  tenant({
    name: "Kafe Senja",
    slug: "kafe-senja",
    ownerEmail: "senja@kafe.id",
    planKey: "professional",
    suspendedAt: now,
  }),
  tenant({ name: "Gudang Besi", slug: "gudang-besi", ownerEmail: "besi@toko.id", planKey: "enterprise" }),
];
const cocok = (query) => rows.filter((row) => tenantAccountMatches(row, query));
check("pencarian kosong menerima semua akun", cocok("").length === 3);
check(
  "pencarian nama tidak peka huruf besar/kecil",
  cocok("KAFE").map((row) => row.slug).join(",") === "kafe-senja",
  cocok("KAFE").map((row) => row.slug).join(","),
);
check("pencarian slug menemukan akunnya", cocok("gudang").length === 1);
check(
  "pencarian email pemilik ikut dicari",
  cocok("besi@toko.id")[0]?.slug === "gudang-besi",
);
check("pencarian email sebagian tetap cocok", cocok("senja@").length === 1);
check("pencarian paket ikut dicari", cocok("professional").length === 1);
check("pencarian tanpa hasil mengembalikan daftar kosong", cocok("zzz").length === 0);
check(
  "akun yang sedang dihapus tetap tampil di daftar",
  tenantAccountMatches(tenant({ deleting: true }), ""),
);
check(
  "kata kunci dirapikan sebelum dicocokkan (spasi & huruf besar)",
  normaliseTenantSearch("  KaFe  ") === "kafe" && tenantAccountMatches(rows[1], "  KaFe  "),
  normaliseTenantSearch("  KaFe  "),
);

// Batas penyapuan: pencarian harus menjangkau jauh lebih banyak akun daripada
// daftar yang tampil, dan penyapuannya dibaca bertahap supaya tiap query murah.
check(
  "batas penyapuan pencarian jauh di atas batas daftar yang tampil",
  TENANT_SEARCH_SCAN >= 1000,
  `scan=${TENANT_SEARCH_SCAN}`,
);

const rekap = summariseTenantAccounts([
  { suspendedAt: null },
  { suspendedAt: null },
  { suspendedAt: now },
  { suspendedAt: null, deleting: true },
]);
check(
  "rekap memisahkan aktif, nonaktif, dan sedang dihapus",
  rekap.total === 4 && rekap.active === 2 && rekap.suspended === 1 && rekap.deleting === 1,
  JSON.stringify(rekap),
);

// ------------------------------------------------------ pembersihan akun uji (massal)
check(
  "domain uji dikenali (harness & akun uji platform)",
  isFixtureOwnerEmail("owner+1@mesinpos.test") && isFixtureOwnerEmail("platform-1@mesinpos.id"),
);
check(
  "pendaftar nyata tidak dianggap akun uji",
  !isFixtureOwnerEmail("otnaigus753@gmail.com") && !isFixtureOwnerEmail("phansugisoft@gmail.com"),
);
check(
  "domain yang hanya mirip tidak dianggap akun uji",
  !isFixtureOwnerEmail("a@mail.mesinpos.test") &&
    !isFixtureOwnerEmail("a@mesinpos.test.evil.com") &&
    !isFixtureOwnerEmail("a@notmesinpos.test") &&
    !isFixtureOwnerEmail("") &&
    !isFixtureOwnerEmail(null) &&
    !isFixtureOwnerEmail("tanpa-at"),
);
check(
  "daftar domain boleh diganti pemanggil",
  isFixtureOwnerEmail("a@contoh.id", ["contoh.id"]) &&
    !isFixtureOwnerEmail("a@contoh.id", ["lain.id"]),
);
check(
  "daftar bawaan hanya dua domain uji",
  FIXTURE_OWNER_DOMAINS.join(",") === "mesinpos.test,mesinpos.id",
  FIXTURE_OWNER_DOMAINS.join(","),
);
check(
  "akun uji boleh dibersihkan",
  decideFixturePurge({
    tenantExists: true,
    deleting: false,
    ownsTenant: false,
    ownerEmail: "owner+1@mesinpos.test",
  }).allowed === true,
);
const purgeSendiri = decideFixturePurge({
  tenantExists: true,
  deleting: false,
  ownsTenant: true,
  ownerEmail: "platform-dev@mesinpos.id",
});
check("workspace pengelola sendiri tidak pernah ikut dibersihkan", purgeSendiri.allowed === false);
check(
  "alasannya menyebut workspace pengelola",
  String(purgeSendiri.reason).includes("pengelola sendiri"),
  purgeSendiri.reason,
);
check(
  "akun yang sudah ditandai hapus dilewati",
  decideFixturePurge({
    tenantExists: true,
    deleting: true,
    ownsTenant: false,
    ownerEmail: "owner+1@mesinpos.test",
  }).allowed === false,
);
const purgeNyata = decideFixturePurge({
  tenantExists: true,
  deleting: false,
  ownsTenant: false,
  ownerEmail: "otnaigus753@gmail.com",
});
check("pemilik non-uji disisakan", purgeNyata.allowed === false);
check(
  "alasannya menyebut pemiliknya bukan akun uji",
  String(purgeNyata.reason).includes("bukan akun uji"),
  purgeNyata.reason,
);
check(
  "batas pembersihan masuk akal (satu kali jalan lebih kecil dari penyapuan)",
  TENANT_PURGE_BATCH > 0 && TENANT_PURGE_BATCH < TENANT_PURGE_SCAN,
  `batch=${TENANT_PURGE_BATCH} scan=${TENANT_PURGE_SCAN}`,
);

// ------------------------------- sisa baris pengguna uji (setelah tenant hilang)
/*
  Menghapus akun bisnis tidak menghapus baris `users` pemiliknya. Tanpa aturan
  ini, harness yang dijalankan berkali-kali tetap menumpuk baris login tanpa
  workspace — tidak terlihat di daftar akun bisnis, tetapi tetap memenuhi tabel.
*/
check(
  "pengguna uji yang sudah yatim boleh dihapus",
  decideFixtureUserPurge({
    platformRole: undefined,
    ownsTenant: false,
    memberOf: false,
    email: "owner+1@mesinpos.test",
    otherOperator: true,
  }).allowed === true,
);
check(
  "akun platform sungguhan tidak pernah dihapus",
  decideFixtureUserPurge({
    platformRole: "developer",
    ownsTenant: false,
    memberOf: false,
    email: "phansugisoft@gmail.com",
    otherOperator: true,
  }).allowed === false,
);
check(
  "akun pengembang uji boleh disapu kalau masih ada pengembang sungguhan",
  decideFixtureUserPurge({
    platformRole: "developer",
    ownsTenant: false,
    memberOf: false,
    email: "platform-1@mesinpos.id",
    otherOperator: true,
  }).allowed === true,
);
const jalanMasukTerakhir = decideFixtureUserPurge({
  platformRole: "developer",
  ownsTenant: false,
  memberOf: false,
  email: "platform-1@mesinpos.id",
  otherOperator: false,
});
check(
  "akun pengembang uji yang satu-satunya disisakan (jalan masuk backstage tidak hilang)",
  jalanMasukTerakhir.allowed === false &&
    String(jalanMasukTerakhir.reason).includes("jalan masuk backstage"),
  jalanMasukTerakhir.reason,
);
check(
  "pemilik tenant tidak dihapus sebelum tenant-nya benar-benar hilang",
  decideFixtureUserPurge({
    platformRole: undefined,
    ownsTenant: true,
    memberOf: false,
    email: "owner+1@mesinpos.test",
    otherOperator: true,
  }).allowed === false,
);
check(
  "anggota workspace mana pun tidak dihapus walau emailnya berdomain uji",
  decideFixtureUserPurge({
    platformRole: undefined,
    ownsTenant: false,
    memberOf: true,
    email: "kasir+1@mesinpos.test",
    otherOperator: true,
  }).allowed === false,
);
check(
  "pendaftar nyata tidak dihapus",
  decideFixtureUserPurge({
    platformRole: undefined,
    ownsTenant: false,
    memberOf: false,
    email: "otnaigus753@gmail.com",
    otherOperator: true,
  }).allowed === false,
);
check(
  "batas pembersihan pengguna masuk akal",
  USER_PURGE_BATCH > 0 && USER_PURGE_BATCH < USER_PURGE_SCAN,
  `batch=${USER_PURGE_BATCH} scan=${USER_PURGE_SCAN}`,
);

// ------------------------------------------------------ efek ke akses tenant
const suspendedAccess = accessForTenant({
  status: "active",
  graceDays: 7,
  platformSuspended: { at: now, by: "u1" },
});
check("akun yang dinonaktifkan tidak boleh membuat penjualan baru", suspendedAccess.canCreateSales === false);
check("akun yang dinonaktifkan tetap boleh melunasi tagihan", suspendedAccess.canSettlePayments === true);
check("mode akses akun nonaktif `blocked`", suspendedAccess.mode === "blocked", suspendedAccess.mode);
check(
  "alasannya menyebut pengelola platform, bukan pembayaran",
  suspendedAccess.reason.includes("pengelola platform") &&
    !suspendedAccess.reason.toLowerCase().includes("menunggu penyelesaian pembayaran"),
  suspendedAccess.reason,
);
const normalAccess = accessForTenant({ status: "active", graceDays: 7 });
check("akun tanpa penonaktifan tetap bisa menjual", normalAccess.canCreateSales === true);
check(
  "penonaktifan tidak mengubah status langganan yang tersimpan",
  normalAccess.mode === "full" && normalAccess.reason === "Langganan aktif.",
  normalAccess.reason,
);

// ------------------------------------------------------ mengubah nama & paket
const planKeys = PLAN_LIST.map((plan) => plan.key);
check(
  "paket yang dikenal katalog ada tiga",
  planKeys.join(",") === "starter,professional,enterprise",
  planKeys.join(","),
);

const ubahNama = decideTenantUpdate({
  tenantExists: true,
  deleting: false,
  name: "  Toko   Baru ",
  planKey: null,
  planKeys,
  note: "  permintaan   pemilik ",
});
check("mengubah nama diizinkan", ubahNama.allowed === true);
check("nama dirapikan spasinya", ubahNama.name === "Toko Baru", ubahNama.name);
check("catatan perubahan ikut disimpan", ubahNama.note === "permintaan pemilik", ubahNama.note);
check("paket yang tidak dikirim tetap tidak berubah", ubahNama.planKey === null);

const ubahPaket = decideTenantUpdate({
  tenantExists: true,
  deleting: false,
  name: null,
  planKey: "professional",
  planKeys,
});
check("mengubah paket saja diizinkan", ubahPaket.allowed === true);
check("paket baru ikut dikembalikan", ubahPaket.planKey === "professional");
check("nama yang tidak dikirim tetap tidak berubah", ubahPaket.name === null);

const kosong = decideTenantUpdate({
  tenantExists: true,
  deleting: false,
  name: null,
  planKey: null,
  planKeys,
});
check("mengubah tanpa satu kolom pun ditolak", kosong.allowed === false);
check(
  "alasan penolakan kosong menyuruh mengirim nama atau paket",
  String(kosong.reason).includes("nama bisnis atau paket"),
  kosong.reason,
);

const namaPendek = decideTenantUpdate({
  tenantExists: true,
  deleting: false,
  name: "a",
  planKey: null,
  planKeys,
});
check("nama lebih pendek dari batas profil ditolak", namaPendek.allowed === false);
check(
  "alasan nama pendek menyebut batasnya",
  String(namaPendek.reason).includes(String(PROFILE_NAME_MIN)),
  namaPendek.reason,
);
const namaPanjang = decideTenantUpdate({
  tenantExists: true,
  deleting: false,
  name: "x".repeat(PROFILE_NAME_MAX + 1),
  planKey: null,
  planKeys,
});
check("nama lebih panjang dari batas profil ditolak", namaPanjang.allowed === false);
check(
  "alasan nama panjang menyebut batasnya",
  String(namaPanjang.reason).includes(String(PROFILE_NAME_MAX)),
  namaPanjang.reason,
);
check(
  "nama tepat di batas maksimum masih diterima",
  decideTenantUpdate({
    tenantExists: true,
    deleting: false,
    name: "x".repeat(PROFILE_NAME_MAX),
    planKey: null,
    planKeys,
  }).allowed === true,
);

const paketAsing = decideTenantUpdate({
  tenantExists: true,
  deleting: false,
  name: null,
  planKey: "platinum",
  planKeys,
});
check("paket di luar katalog ditolak", paketAsing.allowed === false);
check(
  "alasan paket asing menyebut pilihan yang sah",
  String(paketAsing.reason).includes("starter, professional, enterprise"),
  paketAsing.reason,
);
check(
  "akun yang sedang dihapus tidak bisa diubah",
  decideTenantUpdate({ tenantExists: true, deleting: true, name: "Toko", planKey: null, planKeys })
    .allowed === false,
);
check(
  "tenant yang tidak ada ditolak sebelum nama diperiksa",
  decideTenantUpdate({ tenantExists: false, deleting: false, name: "a", planKey: null, planKeys })
    .allowed === false,
);

// Turun paket memakai aturan modul yang sama dengan halaman Langganan.
check(
  "turun ke Starter membuang modul yang tidak ada di paket itu",
  trimVerticalsForPlan("starter", ["fnb", "umkm"]).join(",") === "umkm",
  trimVerticalsForPlan("starter", ["fnb", "umkm"]).join(","),
);
check(
  "naik ke Enterprise mempertahankan seluruh modul",
  trimVerticalsForPlan("enterprise", ["fnb", "umkm", "wholesale"]).join(",") ===
    "fnb,umkm,wholesale",
);

// ------------------------------------------------------ label tindakan
check(
  "keempat tindakan punya label Indonesia",
  PLATFORM_TENANT_ACTION_LABELS.suspend === "Dinonaktifkan" &&
    PLATFORM_TENANT_ACTION_LABELS.activate === "Diaktifkan kembali" &&
    PLATFORM_TENANT_ACTION_LABELS.delete === "Dihapus" &&
    PLATFORM_TENANT_ACTION_LABELS.update === "Diubah",
  JSON.stringify(PLATFORM_TENANT_ACTION_LABELS),
);

// ------------------------------------------------------ daftar tabel vs skema
const schemaText = await Bun.file(new URL("../src/convex/schema.ts", import.meta.url)).text();
const platformText = await Bun.file(new URL("../src/convex/platform.ts", import.meta.url)).text();

/**
 * Nama tabel + seluruh isi definisinya (termasuk rantai `.index(...)` **di bawah**
 * `})`), dari schema.ts: bloknya diambil sampai tabel berikutnya dimulai, bukan
 * sampai penutup `})` yang pertama karena indeks ditulis setelah penutup itu.
 */
const schemaTables = new Map();
{
  const starts = [...schemaText.matchAll(/^ {2}([a-zA-Z]+): defineTable\(/gm)];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const from = start.index;
    const to = index + 1 < starts.length ? starts[index + 1].index : schemaText.length;
    schemaTables.set(start[1], schemaText.slice(from, to));
  }
}

const tenantOwned = [...schemaTables.entries()]
  .filter(([, body]) => body.includes('tenantId: v.id("tenants")'))
  .map(([table]) => table);
const listed = TENANT_TABLES.map((row) => row.table);

check(
  "setiap tabel di TENANT_TABLES benar-benar punya kolom tenantId",
  listed.every((table) => tenantOwned.includes(table)),
  listed.filter((table) => !tenantOwned.includes(table)).join(", "),
);
check(
  "setiap tabel ber-tenantId di schema ikut disapu",
  tenantOwned.every((table) => listed.includes(table)),
  tenantOwned.filter((table) => !listed.includes(table)).join(", "),
);
check(
  "tidak ada tabel ganda di daftar sapuan",
  new Set(listed).size === listed.length,
);
check(
  "setiap indeks yang dipakai benar-benar terpasang di tabelnya",
  TENANT_TABLES.every((row) => schemaTables.get(row.table)?.includes(`.index("${row.index}"`)),
  TENANT_TABLES.filter((row) => !schemaTables.get(row.table)?.includes(`.index("${row.index}"`))
    .map((row) => `${row.table}.${row.index}`)
    .join(", "),
);
check(
  "switch sapuan punya satu cabang untuk tiap tabel",
  ["case 0:", `case ${TENANT_TABLES.length - 1}:`].every((mark) => platformText.includes(mark)) &&
    platformText.split(/\n {4}case \d+: \{/).length - 1 === TENANT_TABLES.length,
  `cabang=${platformText.split(/\n {4}case \d+: \{/).length - 1} tabel=${TENANT_TABLES.length}`,
);
check(
  "setiap langkah sapuan memakai indeks yang tercatat di TENANT_TABLES",
  TENANT_TABLES.every((row) => platformText.includes(`.query("${row.table}")`)) &&
    TENANT_TABLES.every((row) => platformText.includes(`.withIndex("${row.index}"`)),
);
check("batch sapuan masuk akal sebagai batas mutation", TENANT_DELETE_BATCH > 0 && TENANT_DELETE_BATCH <= 500);

// ------------------------------------------------- jalur tulis mengubah di server & halaman
const actionValidator = schemaText.slice(
  schemaText.indexOf("export const platformActionValidator"),
  schemaText.indexOf("/** Kategori tiket dukungan"),
);
check(
  "validator tindakan platform mengenal `update`",
  ["suspend", "activate", "delete", "update"].every((action) =>
    actionValidator.includes(`v.literal("${action}")`),
  ),
  actionValidator.trim(),
);
check(
  "log tindakan platform punya kolom rincian perubahan",
  schemaText.includes("detail: v.optional(v.string())"),
);

const updateTenantSource = platformText.slice(
  platformText.indexOf("export const updateTenant = mutation"),
  platformText.indexOf("export const purgeFixtureTenants = internalMutation("),
);
check("mutation updateTenant terdaftar", updateTenantSource.length > 0);
check(
  "updateTenant tetap lewat gerbang akun platform",
  updateTenantSource.includes("requirePlatformDeveloper(ctx, args.actorId)"),
);
check(
  "updateTenant memakai aturan murni yang diuji di atas",
  updateTenantSource.includes("decideTenantUpdate({"),
);
check(
  "updateTenant memakai aturan modul yang sama saat paket diturunkan",
  updateTenantSource.includes("trimVerticalsForPlan("),
);
check(
  "updateTenant tidak menyentuh slug maupun status langganan",
  !updateTenantSource.includes("slug:") && !updateTenantSource.includes("status:"),
);
check(
  "updateTenant mencatat jejak untuk pengelola dan untuk tenant",
  updateTenantSource.includes('action: "update"') &&
    updateTenantSource.includes('action: "platform.tenantUpdate"'),
);
check(
  "riwayat tindakan mengirim rincian perubahan ke halaman",
  platformText.includes("detail: row.detail ?? null"),
);

// ------------------------------- pembersihan akun uji: jalur tulis di server
const purgeSource = platformText.slice(
  platformText.indexOf("export const purgeFixtureTenants = internalMutation("),
  platformText.indexOf("export const purgeFixtureTenantsAuto = internalMutation("),
);
check("mutation pembersihan terdaftar", purgeSource.length > 0);
check(
  "pembersihan hanya bisa dijalankan lewat akses deployment (internalMutation)",
  platformText.includes("export const purgeFixtureTenants = internalMutation("),
);
check(
  "pembersihan menuntut aktor yang benar-benar pengembang platform",
  purgeSource.includes('user.platformRole !== "developer"'),
);
check(
  "pembersihan memakai aturan murni yang diuji di atas",
  purgeSource.includes("decideFixturePurge({"),
);
check(
  "pembersihan memakai pekerja penghapusan yang sama dengan hapus satu akun",
  purgeSource.includes("internal.platform.deleteTenantChunk"),
);
check(
  "jejaknya ditulis ke log tindakan pengelola",
  purgeSource.includes('action: "delete"') && purgeSource.includes("platformAuditLogs"),
);
check(
  "bisa diuji kering tanpa menandai apa pun",
  purgeSource.includes("if (args.dryRun)") &&
    purgeSource.indexOf("if (args.dryRun)") < purgeSource.indexOf("ctx.scheduler.runAfter(0"),
);
check(
  "berhenti sendiri kalau sudah tidak ada kandidat",
  purgeSource.includes("if (lanjut)") &&
    purgeSource.includes("internal.platform.purgeFixtureTenants, args"),
);
check(
  "pembersihan akun bisnis tidak menghapus baris pengguna",
  !purgeSource.includes("ctx.db.delete("),
);

// ------------------------------- sisa akun pengguna uji: jalur tulis & jadwalnya
const userPurgeSource = platformText.slice(
  platformText.indexOf("export const purgeFixtureUsers = internalMutation("),
  platformText.indexOf("export const deleteTenant = mutation("),
);
check("mutation pembersihan pengguna terdaftar", userPurgeSource.length > 0);
check(
  "pembersihan pengguna memakai aturan murni yang diuji di atas",
  userPurgeSource.includes("decideFixtureUserPurge({"),
);
check(
  "pembersihan pengguna menghapus sesi & token sebelum baris akunnya",
  userPurgeSource.indexOf('query("authRefreshTokens")') > 0 &&
    userPurgeSource.indexOf('query("authSessions")') < userPurgeSource.indexOf("ctx.db.delete(user._id)"),
);
check(
  "pembersihan pengguna ikut menghapus kode OTP lama",
  userPurgeSource.includes('query("emailOtps")'),
);
check(
  "pembersihan pengguna bisa diuji kering dan berhenti sendiri",
  userPurgeSource.includes("if (args.dryRun)") &&
    userPurgeSource.includes("internal.platform.purgeFixtureUsers, args"),
);

const cronsText = await Bun.file(new URL("../src/convex/crons.ts", import.meta.url)).text();
check(
  "pembersihan akun uji berjalan sendiri tiap hari (tanpa mengandalkan ingatan manusia)",
  cronsText.includes("internal.platform.purgeFixtureTenantsAuto") &&
    cronsText.includes("internal.platform.purgeFixtureUsers"),
);
check(
  "pembersihan otomatis memakai jalur tanpa aktor yang memilih pengelola sungguhan",
  platformText.includes("export const purgeFixtureTenantsAuto = internalMutation(") &&
    platformText.includes("!isFixtureOwnerEmail(row.email)"),
);

// ------------------------------- pencarian menjangkau seluruh akun, bukan hanya yang tampil
const tenantAccountsSource = platformText.slice(
  platformText.indexOf("export const tenantAccounts = query("),
  platformText.indexOf("export const setTenantSuspended = mutation("),
);
check("query tenantAccounts terdaftar", tenantAccountsSource.length > 0);
check(
  "pencarian menyapu jauh melewati baris yang tampil (satu kali baca berbatas)",
  tenantAccountsSource.includes("const scanCap = searching ? TENANT_SEARCH_SCAN : limit") &&
    tenantAccountsSource.includes('.order("desc").take(scanCap)'),
);
check(
  "jalur ini tidak memakai paginate — Convex hanya mengizinkan satu query berhalaman per fungsi",
  !tenantAccountsSource.includes(".paginate("),
);
check(
  "penyapuan berhenti di batas penyapuan dan mengatakannya (`scanCapped`)",
  tenantAccountsSource.includes("const scanCapped = searching && scanned >= TENANT_SEARCH_SCAN") &&
    tenantAccountsSource.includes("scanCapped,"),
);
check(
  "kata kunci dirapikan lewat aturan murni yang diuji di atas",
  tenantAccountsSource.includes("normaliseTenantSearch(args.search)") &&
    tenantAccountsSource.includes("tenantAccountMatches("),
);
check(
  "halaman tahu berapa akun yang diperiksa dan apakah hasilnya masih ada lagi",
  tenantAccountsSource.includes("const scanned = tenantRows.length") &&
    tenantAccountsSource.includes(
      "truncated: searching ? rows.length >= limit || scanCapped : scanned >= limit",
    ) &&
    tenantAccountsSource.includes("scanned,"),
);
check(
  "pembacaan sebatas baris yang tampil sudah tidak ada lagi di jalur ini",
  !platformText.includes("filterTenantAccounts") &&
    !tenantAccountsSource.includes(".take(limit)"),
);
check(
  "baris akun tetap dibangun dari fungsi yang sama (identitas, pemilik, jumlah isi)",
  platformText.includes("async function accountRowOf(") &&
    platformText.includes("accountRowOf(ctx, tenant, owner)"),
);

const cardText = await Bun.file(
  new URL("../src/components/PlatformTenantAccountsCard.tsx", import.meta.url),
).text();
check(
  "halaman memanggil mutation updateTenant",
  cardText.includes("api.platform.updateTenant"),
);
check(
  "tiap baris akun punya tombol Edit, form nama, pemilih paket, dan tombol simpan",
  ["platform-akun-edit-", "platform-akun-nama-", "platform-akun-paket-", "platform-akun-simpan-"].every(
    (mark) => cardText.includes(mark),
  ),
);
check(
  "paket di form berasal dari katalog, bukan daftar tulisan tangan",
  cardText.includes("PLAN_LIST.map("),
);
check(
  "aksi ubah tidak bisa ditekan pada akun yang sedang dihapus",
  /platform-akun-edit-\$\{row.slug\}`[\s\S]{0,200}?row\.deleting/.test(cardText),
);

const gagal = results.filter((row) => !row.ok);
console.log(`${results.length - gagal.length}/${results.length} checks passed`);
if (gagal.length > 0) process.exit(1);

/**
 * Tests the authorization model without a deployment.
 *
 * Two things are covered here that the backend harness cannot reach:
 *
 * 1. The role/permission table (src/convex/lib/authz.ts) — pure logic.
 * 2. The actor-identity policy (src/convex/lib/auth.ts `decideActor`). The
 *    harness can only ever present "no identity", because the local anonymous
 *    deployment issues no tokens; impersonation attempts are exactly the case
 *    that must be proven, so they are asserted here directly.
 *
 * Usage: bun scripts/verify-authz.mjs
 */
import {
  can,
  isRole,
  PERMISSION_LABELS,
  permissionsFor,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLES,
} from "../src/convex/lib/authz.ts";
import { allowUnverifiedActors, decideActor } from "../src/convex/lib/auth.ts";
import {
  CANCEL_HAS_WORKSPACE_REASON,
  CANCEL_NOT_FOUND_REASON,
  CANCEL_PLATFORM_REASON,
  cancelRegistrationRefusal,
  cancelledRegistrationSentence,
} from "../src/convex/lib/account.ts";
import {
  decidePlatformAccess,
  describePlatformAccount,
  isPlatformMembershipRefusal,
  isPlatformRole,
  membershipAssignmentError,
  PLATFORM_MEMBERSHIP_REFUSAL,
  PLATFORM_ROLE_LABELS,
  PLATFORM_ROLES,
  visibleInTenantSurfaces,
} from "../src/convex/lib/platform.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// --------------------------------------------------------------- role table
check("5 peran terdefinisi", ROLES.length === 5, ROLES.join(", "));
check(
  "setiap peran punya label",
  ROLES.every((r) => typeof ROLE_LABELS[r] === "string" && ROLE_LABELS[r].length > 0),
);
check("isRole menolak nilai asing", !isRole("superadmin") && isRole("cashier"));

// Dibandingkan dengan tabel izin itu sendiri, bukan angka tetap: menambah izin
// baru tanpa memberikannya ke pemilik langsung gagal di sini.
check(
  "owner punya semua izin",
  permissionsFor("owner").length === Object.keys(PERMISSION_LABELS).length,
  `${permissionsFor("owner").length} vs ${Object.keys(PERMISSION_LABELS).length}`,
);

// The separation of duty that the whole POS depends on.
check("kasir boleh menjual", can("cashier", "pos.sell"));
check("kasir TIDAK boleh void", !can("cashier", "pos.void"));
check("kasir TIDAK boleh kelola produk", !can("cashier", "product.manage"));
check("kasir TIDAK boleh ubah stok", !can("cashier", "stock.adjust"));
check("kasir TIDAK boleh kelola langganan", !can("cashier", "billing.manage"));
check("kasir boleh lihat laporan", can("cashier", "report.view"));

// Dapur & kas punya izinnya sendiri sejak dipisah dari `pos.sell` (2026-10-17):
// kasir & manajer memegang keduanya supaya tidak ada kemampuan yang hilang,
// sedangkan staf gudang dan keuangan tidak — keduanya bukan pekerja dapur
// maupun pemegang kas fisik.
check("kasir boleh bekerja di layar dapur", can("cashier", "kds.manage"));
check("kasir boleh membuka & menutup shift kas", can("cashier", "shift.manage"));
check("manajer boleh bekerja di layar dapur", can("manager", "kds.manage"));
check("manajer boleh membuka & menutup shift kas", can("manager", "shift.manage"));
check("gudang TIDAK boleh bekerja di layar dapur", !can("inventory", "kds.manage"));
check("gudang TIDAK boleh membuka & menutup shift kas", !can("inventory", "shift.manage"));
check("keuangan TIDAK boleh bekerja di layar dapur", !can("finance", "kds.manage"));
check("keuangan TIDAK boleh membuka & menutup shift kas", !can("finance", "shift.manage"));

check("gudang boleh ubah stok", can("inventory", "stock.adjust"));
check("gudang TIDAK boleh menjual", !can("inventory", "pos.sell"));

check("keuangan boleh kelola langganan", can("finance", "billing.manage"));
check("keuangan TIDAK boleh ubah stok", !can("finance", "stock.adjust"));

check("manajer boleh void", can("manager", "pos.void"));
check("manajer TIDAK boleh kelola langganan", !can("manager", "billing.manage"));

// Denah meja (modul F&B) adalah konfigurasi lantai toko: kasir memakai meja,
// tetapi tidak mendesain ulang denahnya.
check("manajer boleh kelola denah meja", can("manager", "table.manage"));
check("kasir TIDAK boleh kelola denah meja", !can("cashier", "table.manage"));
check("gudang TIDAK boleh kelola denah meja", !can("inventory", "table.manage"));

// Piutang B2B (modul Grosir) dipisah dua: kasir boleh melihat sisa limit
// (supaya tidak menjual melebihi limit), tetapi tidak boleh mengubah limit atau
// mencatat pelunasan — yang menjual bukan yang memberi kredit.
check("kasir boleh melihat piutang & sisa limit", can("cashier", "ar.view"));
check("kasir TIDAK boleh kelola limit kredit", !can("cashier", "ar.manage"));
check("keuangan boleh kelola piutang", can("finance", "ar.manage"));
check("manajer boleh kelola piutang", can("manager", "ar.manage"));
check("gudang TIDAK boleh melihat piutang", !can("inventory", "ar.view"));
check("gudang TIDAK boleh kelola piutang", !can("inventory", "ar.manage"));

// Diskon member (modul UMKM) juga dipisah: kasir memakai diskon yang sudah
// ditetapkan, tetapi besarnya diskon ditentukan manajer/pemilik.
check("kasir boleh melihat daftar member", can("cashier", "member.view"));
check("kasir TIDAK boleh mengubah member & diskon", !can("cashier", "member.manage"));
check("manajer boleh mengelola member", can("manager", "member.manage"));
check("keuangan boleh melihat member", can("finance", "member.view"));
check("keuangan TIDAK boleh mengubah diskon member", !can("finance", "member.manage"));
check("gudang TIDAK boleh melihat member", !can("inventory", "member.view"));

// Kategori produk adalah **struktur katalog**, bukan isi rak: staf gudang memang
// mengelola produk (`product.manage`), tetapi yang menyusun kategorinya adalah
// pemilik/manajer — sebab nama kategori menentukan kode tengah SKU
// (`PBB-<KATEGORI>-<nomor>`) dan susunan tab di kasir.
check("pemilik boleh mengelola kategori produk", can("owner", "category.manage"));
check("manajer boleh mengelola kategori produk", can("manager", "category.manage"));
check("gudang TIDAK boleh mengelola kategori produk", !can("inventory", "category.manage"));
check("kasir TIDAK boleh mengelola kategori produk", !can("cashier", "category.manage"));
check("keuangan TIDAK boleh mengelola kategori produk", !can("finance", "category.manage"));
check(
  "gudang tetap boleh mengelola produk walau kategorinya bukan haknya",
  can("inventory", "product.manage"),
);

// Gudang & stok per lokasi (Phase 3) hanya untuk yang bekerja dengan stok:
// staf gudang memindahkan barang, kasir menjualnya, keuangan mencatat uangnya.
check("gudang boleh melihat stok per lokasi", can("inventory", "inventory.view"));
check("gudang boleh memindahkan stok", can("inventory", "inventory.manage"));
check("manajer boleh mengelola gudang", can("manager", "inventory.manage"));
check("pemilik boleh mengelola gudang", can("owner", "inventory.manage"));
check("kasir TIDAK boleh melihat gudang", !can("cashier", "inventory.view"));
check("kasir TIDAK boleh memindahkan stok", !can("cashier", "inventory.manage"));
check("keuangan TIDAK boleh memindahkan stok", !can("finance", "inventory.manage"));

// Pembelian (Phase 3) dipisah tiga peran: staf gudang **meminta**, pemilik/manajer
// **menyetujui & memesan**, dan penerimaan barang kembali ke gudang — tidak ada
// satu orang yang memesan, menyetujui, sekaligus menerima barangnya sendiri.
check("gudang boleh mengajukan permintaan pembelian", can("inventory", "purchase.request"));
check("gudang boleh menerima barang", can("inventory", "purchase.receive"));
check("gudang TIDAK boleh menyetujui PR", !can("inventory", "purchase.approve"));
check("manajer boleh menyetujui PR & membuat PO", can("manager", "purchase.approve"));
check("pemilik boleh menyetujui PR & membuat PO", can("owner", "purchase.approve"));
check("keuangan boleh melihat dokumen pembelian", can("finance", "purchase.view"));
check("keuangan TIDAK boleh mengajukan PR", !can("finance", "purchase.request"));
check("keuangan TIDAK boleh menyetujui PR", !can("finance", "purchase.approve"));
check("keuangan TIDAK boleh menerima barang", !can("finance", "purchase.receive"));
check("kasir TIDAK boleh melihat pembelian", !can("cashier", "purchase.view"));
check("kasir TIDAK boleh menerima barang", !can("cashier", "purchase.receive"));

// Hutang usaha (Phase 3) adalah urusan uang, bukan rak: yang menerima barang
// (staf gudang) bukan yang membayar tagihannya, dan kasir tidak melihat hutang
// supplier sama sekali.
check("keuangan boleh melihat hutang usaha", can("finance", "payable.view"));
check("keuangan boleh membayar hutang supplier", can("finance", "payable.manage"));
check("manajer boleh membayar hutang supplier", can("manager", "payable.manage"));
check("pemilik boleh membayar hutang supplier", can("owner", "payable.manage"));
check("gudang TIDAK boleh melihat hutang usaha", !can("inventory", "payable.view"));
check("gudang TIDAK boleh membayar hutang supplier", !can("inventory", "payable.manage"));
check("kasir TIDAK boleh melihat hutang usaha", !can("cashier", "payable.view"));
check("kasir TIDAK boleh membayar hutang supplier", !can("cashier", "payable.manage"));

// An unknown role must grant nothing rather than blow up mid-request.
check("peran tak dikenal tidak punya izin", can("superadmin", "pos.sell") === false);

// The table must not be mutable through the accessor.
const leaked = permissionsFor("cashier");
leaked.push("pos.void");
check("permissionsFor mengembalikan salinan", !can("cashier", "pos.void"));
check(
  "ROLE_PERMISSIONS tidak ikut berubah",
  !ROLE_PERMISSIONS.cashier.includes("pos.void"),
);

// ------------------------------------------------------------ actor identity
const claim = (claimed, identityUserId, hasIdentity, allowUnverified) =>
  decideActor({ claimedActorId: claimed, identityUserId, hasIdentity, allowUnverified });

let decision = claim(null, null, false, true);
check("tanpa aktor ditolak", !decision.allowed, JSON.stringify(decision));

decision = claim("user_a", null, false, true);
check("tanpa identitas + diizinkan → boleh, tidak terverifikasi", decision.allowed && decision.verified === false, JSON.stringify(decision));

decision = claim("user_a", null, false, false);
check("tanpa identitas + wajib verifikasi → ditolak", !decision.allowed, JSON.stringify(decision));

decision = claim("user_a", "user_a", true, true);
check("identitas cocok → boleh & terverifikasi", decision.allowed && decision.verified === true, JSON.stringify(decision));

decision = claim("user_owner", "user_cashier", true, true);
check(
  "identitas milik orang lain → ditolak (tidak bisa menyamar)",
  !decision.allowed && decision.verified === true,
  JSON.stringify(decision),
);

decision = claim("user_a", null, true, true);
check(
  "identitas tidak dikenal → ditolak walau unverified diizinkan",
  !decision.allowed,
  JSON.stringify(decision),
);

decision = claim("user_a", "user_a", true, false);
check("identitas cocok tetap boleh saat verifikasi diwajibkan", decision.allowed, JSON.stringify(decision));

// The escape hatch: default permissive, and strictly falsy values close it.
delete process.env.ALLOW_UNVERIFIED_ACTOR;
check("default mengizinkan aktor belum terverifikasi", allowUnverifiedActors() === true);
for (const value of ["false", "FALSE", "0", "no", "off"]) {
  process.env.ALLOW_UNVERIFIED_ACTOR = value;
  check(`ALLOW_UNVERIFIED_ACTOR=${value} menutup akses`, allowUnverifiedActors() === false);
}
process.env.ALLOW_UNVERIFIED_ACTOR = "true";
check("ALLOW_UNVERIFIED_ACTOR=true membuka", allowUnverifiedActors() === true);
delete process.env.ALLOW_UNVERIFIED_ACTOR;

// ------------------------------------------------------ akun platform
// Akun platform sengaja **bukan** peran tenant: apa pun yang masuk ROLES otomatis
// terlihat (dropdown peran, label sidebar, pemilih anggota), jadi kalau ia jadi
// salah satu "peran", ketentuan "tidak terlihat role mana pun" gugur dengan
// sendirinya.
check(
  "akun platform bukan peran tenant",
  PLATFORM_ROLES.every((role) => !ROLES.includes(role)) &&
    PLATFORM_ROLES.every((role) => !(role in ROLE_LABELS)) &&
    !isRole("developer"),
  `platform=${PLATFORM_ROLES.join(",")} · tenant=${ROLES.join(",")}`,
);
check(
  "setiap peran platform punya label",
  PLATFORM_ROLES.every(
    (role) => typeof PLATFORM_ROLE_LABELS[role] === "string" && PLATFORM_ROLE_LABELS[role].length > 0,
  ),
);
check("isPlatformRole menolak peran tenant & nilai asing", isPlatformRole("developer") && !isPlatformRole("owner") && !isPlatformRole("superadmin"));

// Kebijakan akses backstage: identitas diperiksa lebih dulu, jadi pemanggil
// anonim tidak bisa memakai pesan galat untuk menebak akun platform mana yang ada.
{
  const anon = decidePlatformAccess({ platformRole: "developer", verified: false, allowUnverified: true });
  check(
    "akun platform ditolak tanpa identitas terverifikasi, walaupun ALLOW_UNVERIFIED_ACTOR longgar",
    anon.allowed === false && anon.reason.includes("ALLOW_UNVERIFIED_ACTOR"),
    JSON.stringify(anon),
  );
  const anonBiasa = decidePlatformAccess({ platformRole: null, verified: false, allowUnverified: true });
  check(
    "penolakan anonim sama untuk akun biasa & akun platform (tidak bisa dipakai menebak)",
    anonBiasa.allowed === false && anonBiasa.reason === anon.reason,
    `${anon.reason} | ${anonBiasa.reason}`,
  );
  check(
    "akun biasa yang terverifikasi tetap bukan akun platform",
    decidePlatformAccess({ platformRole: null, verified: true }).allowed === false &&
      decidePlatformAccess({ platformRole: "manager", verified: true }).allowed === false &&
      decidePlatformAccess({ platformRole: "owner", verified: true, allowUnverified: false }).allowed === false,
  );
  const dev = decidePlatformAccess({ platformRole: "developer", verified: true, allowUnverified: false });
  check(
    "akun platform yang terverifikasi diterima dengan perannya",
    dev.allowed === true && dev.role === "developer",
    JSON.stringify(dev),
  );
}

// Ketak-terlihatan dijaga struktural, bukan oleh pengecualian yang bisa lupa
// dipasang: tanpa keanggotaan ia tidak punya baris untuk ditemukan.
// Akun platform boleh punya workspace sendiri: di situ ia memang pemiliknya, dan
// menyembunyikannya justru membuat workspace tanpa pemilik. Di tenant orang lain
// ia tetap tidak pernah muncul — `ownsTenant` adalah pembeda tunggalnya.
check(
  "akun platform terlihat hanya di workspace miliknya sendiri",
  visibleInTenantSurfaces({ platformRole: "developer", ownsTenant: true }) === true &&
    visibleInTenantSurfaces({ platformRole: "developer", ownsTenant: false }) === false &&
    visibleInTenantSurfaces({ platformRole: "developer" }) === false &&
    visibleInTenantSurfaces({ platformRole: null }) === true &&
    visibleInTenantSurfaces({ platformRole: null, ownsTenant: false }) === true &&
    visibleInTenantSurfaces({}) === true,
);
// Yang ditutup hanya jalur undangan: pesannya sendiri harus menyebut batas itu,
// supaya “akun platform tidak boleh…” tidak dibaca sebagai “tidak boleh punya
// apa-apa”.
check(
  "penolakan akun platform berlaku pada undangan, bukan pada workspace sendiri",
  typeof membershipAssignmentError("developer") === "string" &&
    membershipAssignmentError("developer").includes("tidak boleh menjadi anggota") &&
    membershipAssignmentError("developer").includes("tenant milik orang lain") &&
    membershipAssignmentError("developer").includes("ia dirikan sendiri") &&
    membershipAssignmentError(null) === null &&
    membershipAssignmentError(undefined) === null &&
    membershipAssignmentError("manager") === null,
  String(membershipAssignmentError("developer")),
);
// Penolakan akun platform harus tetap dikenali klien walau kalimatnya sudah
// dibungkus lapisan Convex, karena justru dari pengenalan itu klien memilih
// petunjuk tindakan yang benar (“pakai email lain”, bukan “muat ulang”).
check(
  "penolakan akun platform dikenali dari kalimatnya sendiri, walau dibungkus",
  isPlatformMembershipRefusal(PLATFORM_MEMBERSHIP_REFUSAL) &&
    isPlatformMembershipRefusal(`Uncaught Error: ${PLATFORM_MEMBERSHIP_REFUSAL}`) &&
    isPlatformMembershipRefusal(String(membershipAssignmentError("developer"))) &&
    // Kalimatnya memang satu sumber: penolakan & pengenalan tidak bisa berbeda.
    String(membershipAssignmentError("developer")) === PLATFORM_MEMBERSHIP_REFUSAL,
  PLATFORM_MEMBERSHIP_REFUSAL,
);
check(
  "galat lain tidak dianggap penolakan akun platform",
  !isPlatformMembershipRefusal("Slug sudah dipakai, pilih yang lain.") &&
    !isPlatformMembershipRefusal("Server Error") &&
    !isPlatformMembershipRefusal("") &&
    !isPlatformMembershipRefusal(null) &&
    !isPlatformMembershipRefusal(undefined),
  "Slug sudah dipakai, pilih yang lain.",
);
check(
  "ringkasan akun platform tidak menyembunyikan perannya",
  describePlatformAccount({ name: "Dev", email: "dev@mesinpos.id", platformRole: "developer" }).includes("Pengembang platform") &&
    describePlatformAccount({ name: "Budi", email: "budi@toko.id", platformRole: null }) === "Budi <budi@toko.id>",
);

// ------------------------------------------------ pembatalan pendaftaran
// Hanya pendaftaran yang **belum menjadi bisnis** yang boleh dihapus. Kalau
// pagar ini longgar, tautan “Batalkan” di onboarding bisa meninggalkan workspace
// tanpa pemilik — jadi aturannya diuji langsung, bukan hanya dipakai.
check(
  "pendaftaran baru tanpa workspace boleh dibatalkan",
  cancelRegistrationRefusal({ hasMemberships: false }) === null &&
    cancelRegistrationRefusal({ hasMemberships: false, platformRole: null }) === null,
  String(cancelRegistrationRefusal({ hasMemberships: false })),
);
check(
  "akun yang sudah punya workspace tidak boleh dibatalkan",
  cancelRegistrationRefusal({ hasMemberships: true }) === CANCEL_HAS_WORKSPACE_REASON &&
    CANCEL_HAS_WORKSPACE_REASON.includes("sudah punya workspace") &&
    CANCEL_HAS_WORKSPACE_REASON.includes("dukungan"),
  String(cancelRegistrationRefusal({ hasMemberships: true })),
);
check(
  "akun platform ditolak lebih dulu, walau belum punya workspace",
  cancelRegistrationRefusal({ hasMemberships: false, platformRole: "developer" }) ===
    CANCEL_PLATFORM_REASON &&
    cancelRegistrationRefusal({ hasMemberships: true, platformRole: "developer" }) ===
      CANCEL_PLATFORM_REASON &&
    CANCEL_PLATFORM_REASON.includes("akses deployment"),
  String(cancelRegistrationRefusal({ hasMemberships: false, platformRole: "developer" })),
);
check(
  "penolakan akun yang sudah hilang punya kalimatnya sendiri",
  CANCEL_NOT_FOUND_REASON.includes("sudah tidak ada") &&
    CANCEL_NOT_FOUND_REASON.includes("masuk lagi"),
  CANCEL_NOT_FOUND_REASON,
);
check(
  "kalimat pembatalan menyebut email yang benar-benar dihapus",
  cancelledRegistrationSentence("baru@toko.id").includes("baru@toko.id") &&
    cancelledRegistrationSentence("baru@toko.id").includes("dihapus") &&
    cancelledRegistrationSentence("baru@toko.id").includes("mendaftar lagi") &&
    !cancelledRegistrationSentence("a@b.id").includes("baru@toko.id"),
  cancelledRegistrationSentence("baru@toko.id"),
);

console.log(`${results.length}/${results.length} checks passed`);

/**
 * Tes murni untuk modul plug-in vertikal (Phase 2).
 *
 * Yang diuji tanpa deployment: katalog modul, kepemilikan fitur per modul,
 * aturan aktivasi (modul harus ada di paket, `verticalLimit`, minimal satu
 * modul), irisan paket × pilihan tenant, dan gerbang fitur berbasis modul.
 *
 * Ini penting karena gerbang yang sama dipakai backend (`requireFeature`):
 * kalau aturannya salah di sini, halaman Modul akan menawarkan sesuatu yang
 * ditolak server (atau sebaliknya, menyembunyikan fitur yang sudah dibayar).
 *
 * Usage: bun scripts/verify-modules.mjs
 */
import {
  activeVerticals,
  availableModules,
  blockedFeatures,
  entitlementFor,
  FEATURE_OWNER,
  featureOwner,
  isFeatureEnabled,
  lockedModules,
  MODULE_LIST,
  moduleFor,
  moduleSummary,
  nextPlanUp,
  PLAN_LIST,
  planRank,
  resolveModuleSelection,
  trimVerticalsForPlan,
} from "../src/convex/lib/billing/index.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// -------------------------------------------------------------- katalog modul
check("3 modul terdaftar", MODULE_LIST.length === 3, String(MODULE_LIST.length));
check(
  "setiap modul punya nama, tagline, deskripsi, dan fitur",
  MODULE_LIST.every(
    (m) =>
      m.name.length > 0 &&
      m.tagline.length > 0 &&
      m.description.length > 0 &&
      m.features.length > 0,
  ),
  JSON.stringify(MODULE_LIST.map((m) => [m.vertical, m.features.length])),
);
check(
  "tiap modul bisa diambil lewat moduleFor",
  moduleFor("fnb").vertical === "fnb" && moduleFor("wholesale").vertical === "wholesale",
);

// ----------------------------------------------------------- kepemilikan fitur
check("pos.kds dimiliki modul F&B", featureOwner("pos.kds") === "fnb", String(featureOwner("pos.kds")));
check(
  "pricing.multitier dimiliki modul grosir",
  featureOwner("pricing.multitier") === "wholesale",
  String(featureOwner("pricing.multitier")),
);
check("pos.quickgrid dimiliki modul UMKM", featureOwner("pos.quickgrid") === "umkm");
check(
  "fitur non-modul tidak punya pemilik",
  featureOwner("report.daily") === null && featureOwner("inventory.basic") === null,
  JSON.stringify({ report: FEATURE_OWNER["report.daily"], inv: FEATURE_OWNER["inventory.basic"] }),
);

// ------------------------------------------------------------- izin per paket
const starter = entitlementFor("starter");
const professional = entitlementFor("professional");
const enterprise = entitlementFor("enterprise");

check("starter hanya boleh modul UMKM", availableModules(starter).length === 1 && availableModules(starter)[0].vertical === "umkm");
check(
  "starter mengunci F&B dan grosir",
  lockedModules(starter).map((m) => m.vertical).join(",") === "fnb,wholesale",
  lockedModules(starter).map((m) => m.vertical).join(","),
);
check("starter: batas 1 modul", moduleSummary(starter, ["umkm"]).limit === 1);
check("professional: 3 modul tersedia, batas 2", availableModules(professional).length === 3 && moduleSummary(professional, ["umkm"]).limit === 2);
check("enterprise: tanpa kunci dan tanpa batas", lockedModules(enterprise).length === 0 && moduleSummary(enterprise, ["umkm"]).limit === "unlimited");

// ---------------------------------------------------------- validasi seleksi
{
  const unknown = resolveModuleSelection(professional, ["fnb", "pos"]);
  check("modul tak dikenal ditolak", !unknown.ok && unknown.reason.includes("tidak dikenal"), unknown.reason);
}
{
  const kosong = resolveModuleSelection(professional, []);
  check("seleksi kosong ditolak", !kosong.ok && kosong.reason.includes("Minimal satu modul"), kosong.reason);
}
{
  const terlarang = resolveModuleSelection(starter, ["fnb"]);
  check("modul di luar paket ditolak", !terlarang.ok && terlarang.reason.includes("tidak tersedia di paket ini"), terlarang.reason);
}
{
  const kelebihan = resolveModuleSelection(professional, ["umkm", "fnb", "wholesale"]);
  check("melebihi batas paket ditolak", !kelebihan.ok && kelebihan.reason.includes("hanya mengizinkan 2 modul"), kelebihan.reason);
}
{
  const rapih = resolveModuleSelection(professional, ["wholesale", "umkm"]);
  check(
    "seleksi sah dinormalkan ke urutan katalog",
    rapih.ok && rapih.selected.join(",") === "umkm,wholesale",
    JSON.stringify(rapih),
  );
}
{
  const duplikat = resolveModuleSelection(professional, ["fnb", "fnb"]);
  check("duplikat diunikan", duplikat.ok && duplikat.selected.join(",") === "fnb", JSON.stringify(duplikat));
}

// ------------------------------------------------------ gerbang fitur per modul
check(
  "professional + modul UMKM: pos.quickgrid hidup, pos.kds belum",
  isFeatureEnabled(professional, ["umkm"], "pos.quickgrid") === true &&
    isFeatureEnabled(professional, ["umkm"], "pos.kds") === false,
);
check(
  "professional + modul F&B: pos.kds hidup",
  isFeatureEnabled(professional, ["umkm", "fnb"], "pos.kds") === true,
);
check(
  "fitur non-modul tetap hidup tanpa modul pemiliknya",
  isFeatureEnabled(professional, ["umkm"], "report.daily") === true,
);
check(
  "paket tidak punya fiturnya: tetap mati walau modul aktif",
  isFeatureEnabled(starter, ["umkm"], "pos.kds") === false,
);

// ------------------------------------- irisan paket: turun paket mematikan modul
{
  // Tenant enterprise memakai 2 modul, lalu turun ke starter: hanya modul yang
  // masih diizinkan paket baru yang boleh hidup.
  const aktif = activeVerticals(starter, ["umkm", "fnb"]);
  check("modul yang tidak lagi ada di paket tidak aktif", aktif.join(",") === "umkm", aktif.join(","));
}

// ----------------------------------------------------- fitur yang menunggu modul
{
  const menunggu = blockedFeatures(professional, ["umkm"]);
  const keys = menunggu.map((b) => b.feature);
  check(
    "fitur modul yang belum aktif dilaporkan menunggu",
    keys.includes("pos.kds") && keys.includes("pricing.multitier") && !keys.includes("report.daily"),
    JSON.stringify(keys),
  );
  check(
    "fitur yang sudah aktif tidak ikut dilaporkan",
    !keys.includes("pos.quickgrid"),
    JSON.stringify(keys),
  );
  check("setelah modul F&B aktif, pos.kds keluar dari daftar tunggu", !blockedFeatures(professional, ["umkm", "fnb"]).some((b) => b.feature === "pos.kds"));
}
{
  const ringkas = moduleSummary(professional, ["wholesale"]);
  check(
    "ringkasan modul konsisten",
    ringkas.active.map((m) => m.vertical).join(",") === "wholesale" &&
      ringkas.available.length === 3 &&
      ringkas.planName === "Professional",
    JSON.stringify({ active: ringkas.active.map((m) => m.vertical), plan: ringkas.planName }),
  );
}

// ------------------------------------------------ urutan paket & naik paket
// Halaman Langganan memakai urutan ini untuk menawarkan **paket berikutnya di
// atas** milik tenant. Salah urutan berarti menawarkan paket yang lebih rendah
// sebagai “upgrade” — persis yang terjadi saat tombolnya masih menulis nama
// paket tetap “Professional” di paket Enterprise.
check(
  "urutan paket naik: starter → professional → enterprise",
  PLAN_LIST.map((p) => p.key).join(",") === "starter,professional,enterprise" &&
    planRank("starter") === 0 &&
    planRank("professional") === 1 &&
    planRank("enterprise") === PLAN_LIST.length - 1,
  PLAN_LIST.map((p) => p.key).join(","),
);
check(
  "paket berikutnya di atas starter adalah professional",
  nextPlanUp("starter")?.key === "professional",
  nextPlanUp("starter")?.key ?? "(tidak ada)",
);
check(
  "professional naik ke enterprise, enterprise tidak punya paket di atasnya",
  nextPlanUp("professional")?.key === "enterprise" && nextPlanUp("enterprise") === null,
  `${nextPlanUp("professional")?.key ?? "(tidak ada)"} / ${nextPlanUp("enterprise")?.key ?? "null"}`,
);
check(
  "paket tak dikenal tidak dianggap punya paket di atasnya",
  planRank("gratis") === -1 && nextPlanUp("gratis") === null,
  `${planRank("gratis")} / ${JSON.stringify(nextPlanUp("gratis"))}`,
);

// Aturan pindah paket: modul di luar paket baru dibuang, lalu dipotong sampai
// batas paket itu — dipakai server (`billing.changePlan`) **dan** klien saat
// menyelaraskan sesi, jadi keduanya tidak bisa berbeda.
check(
  "pindah paket memangkas modul di luar paket baru (starter: hanya UMKM)",
  trimVerticalsForPlan("starter", ["fnb", "umkm", "wholesale"]).join(",") === "umkm",
  trimVerticalsForPlan("starter", ["fnb", "umkm", "wholesale"]).join(","),
);
check(
  "batas modul paket baru ditegakkan saat memangkas (professional: 2)",
  trimVerticalsForPlan("professional", ["umkm", "fnb", "wholesale"]).join(",") ===
    "umkm,fnb",
  trimVerticalsForPlan("professional", ["umkm", "fnb", "wholesale"]).join(","),
);
check(
  "enterprise tidak memangkas apa pun, urutan aslinya dipertahankan",
  trimVerticalsForPlan("enterprise", ["fnb", "umkm", "wholesale"]).join(",") ===
    "fnb,umkm,wholesale",
  trimVerticalsForPlan("enterprise", ["fnb", "umkm", "wholesale"]).join(","),
);

console.log(`${results.length}/${results.length} checks passed`);

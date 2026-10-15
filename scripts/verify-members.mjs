/**
 * Uji aturan member & diskon member (`member.discount`) tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/loyalty.ts` — modul murni yang dipakai
 * server (saat menjual), kasir (pratinjau), dan halaman Member.
 *
 * Usage: bun scripts/verify-members.mjs
 */
import {
  describeMember,
  discountBreakdown,
  MAX_DISCOUNT_PCT,
  memberDiscount,
  resolveMemberInput,
  suggestMemberCode,
} from "../src/convex/lib/loyalty.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// --------------------------------------------------------------- data member
{
  const result = resolveMemberInput({
    name: "  Bu   Sari   Wulandari ",
    phone: "+62 812-3456-7890",
    discountPct: 5,
  });
  check("data member valid diterima", result.ok, result.reason);
  check(
    "nama & telepon dinormalkan",
    result.value.name === "Bu Sari Wulandari" && result.value.phone === "+6281234567890",
    JSON.stringify(result.value),
  );
  check("kode member diusulkan dari nama", result.value.code === "BSW", result.value.code);
  check("member aktif secara default", result.value.active === true, String(result.value.active));
}

check(
  "member tanpa diskon tetap boleh (0%)",
  resolveMemberInput({ name: "Pelanggan Umum" }).value?.discountPct === 0,
  JSON.stringify(resolveMemberInput({ name: "Pelanggan Umum" })),
);

for (const [label, input, expected] of [
  ["nama terlalu pendek", { name: "A" }, "2–60 karakter"],
  ["nama terlalu panjang", { name: "Sari ".repeat(20) }, "2–60 karakter"],
  ["kode tidak valid", { name: "Bu Sari", code: "9X" }, "tidak valid"],
  ["telepon tidak valid", { name: "Bu Sari", phone: "0812" }, "telepon"],
  ["diskon negatif", { name: "Bu Sari", discountPct: -1 }, "tidak boleh negatif"],
  [
    "diskon di atas batas",
    { name: "Bu Sari", discountPct: MAX_DISCOUNT_PCT + 1 },
    `maksimal ${MAX_DISCOUNT_PCT}%`,
  ],
]) {
  const result = resolveMemberInput(input);
  check(
    `member ditolak: ${label}`,
    !result.ok && (result.reason ?? "").includes(expected),
    result.ok ? "DITERIMA — validasi bocor" : result.reason,
  );
}

check(
  "usulan kode menghindari kode yang sudah dipakai",
  suggestMemberCode("Bu Sari Wulandari", ["BSW"]) === "BSW-2",
  suggestMemberCode("Bu Sari Wulandari", ["BSW"]),
);
check(
  "nama tanpa huruf tetap mendapat kode cadangan",
  /^[A-Z][A-Z0-9-]{1,9}$/.test(suggestMemberCode("123", [])),
  suggestMemberCode("123", []),
);

// --------------------------------------------------------------- perhitungan
check("diskon 5% dari 22.000", memberDiscount(22_000, 5) === 1_100, String(memberDiscount(22_000, 5)));
check("diskon 0% tidak mengurangi apa pun", memberDiscount(22_000, 0) === 0, String(memberDiscount(22_000, 0)));
check(
  "diskon dibulatkan ke rupiah terdekat",
  memberDiscount(12_345, 3) === 370,
  String(memberDiscount(12_345, 3)),
);
check(
  "diskon tidak pernah melebihi subtotal",
  memberDiscount(1, 50) === 1 && memberDiscount(0, 50) === 0,
  `${memberDiscount(1, 50)} / ${memberDiscount(0, 50)}`,
);
check(
  "persen di luar batas dirapikan ke batasnya",
  memberDiscount(1_000_000, 99) === memberDiscount(1_000_000, MAX_DISCOUNT_PCT),
  String(memberDiscount(1_000_000, 99)),
);

// --------------------------------------------------------- gabungan diskon
{
  const withMember = discountBreakdown({
    subtotal: 100_000,
    member: { name: "Bu Sari", discountPct: 5 },
  });
  check(
    "member 5% → diskon 5.000, net 95.000",
    withMember.memberDiscount === 5_000 && withMember.net === 95_000,
    JSON.stringify(withMember),
  );
  check("tanpa diskon manual, manualnya nol", withMember.manualDiscount === 0, JSON.stringify(withMember));
}

{
  const combined = discountBreakdown({
    subtotal: 100_000,
    member: { name: "Bu Sari", discountPct: 5 },
    manualDiscount: 20_000,
  });
  check(
    "diskon member & manual dijumlahkan",
    combined.totalDiscount === 25_000 && combined.net === 75_000,
    JSON.stringify(combined),
  );
}

{
  const capped = discountBreakdown({
    subtotal: 100_000,
    member: { name: "Bu Sari", discountPct: 50 },
    manualDiscount: 90_000,
  });
  check(
    "total diskon dipatok di subtotal (net tidak negatif)",
    capped.totalDiscount === 100_000 && capped.net === 0,
    JSON.stringify(capped),
  );
}

{
  const inactive = discountBreakdown({
    subtotal: 100_000,
    member: { name: "Bu Sari", discountPct: 5, active: false },
  });
  check(
    "member nonaktif tidak mendapat diskon",
    inactive.memberDiscount === 0 && inactive.net === 100_000,
    JSON.stringify(inactive),
  );
  check(
    "alasan member nonaktif dijelaskan, transaksi tetap jalan",
    (inactive.reason ?? "").includes("tidak aktif"),
    inactive.reason ?? "tanpa alasan",
  );
}

{
  const noMember = discountBreakdown({ subtotal: 50_000 });
  check(
    "tanpa member hanya diskon manual yang berlaku",
    noMember.memberDiscount === 0 && noMember.totalDiscount === 0 && noMember.net === 50_000,
    JSON.stringify(noMember),
  );
}

{
  const memberNoDiscount = discountBreakdown({
    subtotal: 50_000,
    member: { name: "Pelanggan Umum", discountPct: 0 },
    manualDiscount: 5_000,
  });
  check(
    "member tanpa diskon tidak menambah/mengurangi apa pun",
    memberNoDiscount.memberDiscount === 0 && memberNoDiscount.totalDiscount === 5_000,
    JSON.stringify(memberNoDiscount),
  );
  check(
    "member tanpa diskon tidak memberi alasan galat",
    memberNoDiscount.reason === undefined,
    memberNoDiscount.reason ?? "-",
  );
}

check(
  "diskon manual negatif dirapikan ke 0",
  discountBreakdown({ subtotal: 10_000, manualDiscount: -500 }).totalDiscount === 0,
  JSON.stringify(discountBreakdown({ subtotal: 10_000, manualDiscount: -500 })),
);

check(
  "ringkasan member untuk daftar",
  describeMember({ code: "BSW", discountPct: 5 }) === "BSW · 5%",
  describeMember({ code: "BSW", discountPct: 5 }),
);
check(
  "ringkasan member tanpa diskon",
  describeMember({ code: "MBR", discountPct: 0 }) === "MBR · tanpa diskon",
  describeMember({ code: "MBR", discountPct: 0 }),
);

console.log(`${results.length}/${results.length} checks passed`);

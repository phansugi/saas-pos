/**
 * Uji aturan modifier item (`pos.modifier`) tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/modifiers.ts` — modul murni yang dipakai
 * server (validasi + harga), kasir (dialog modifier), dan halaman Produk
 * (editor). Karena aturannya satu, hasilnya berlaku untuk ketiganya.
 *
 * Usage: bun scripts/verify-modifiers.mjs
 */
import {
  applyModifiers,
  describeModifierGroups,
  hasModifiers,
  lineTotalWithModifiers,
  MAX_GROUP_SELECT,
  MAX_MODIFIER_GROUPS,
  MAX_MODIFIER_OPTIONS,
  modifierSummary,
  resolveModifierConfig,
  suggestGroupCode,
  suggestOptionCode,
} from "../src/convex/lib/modifiers.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const group = (overrides = {}) => ({
  code: "PEDAS",
  name: "Level pedas",
  minSelect: 1,
  maxSelect: 1,
  options: [
    { code: "1", name: "Pedas 1", price: 0 },
    { code: "2", name: "Pedas 2", price: 0 },
  ],
  ...overrides,
});

const topping = {
  code: "TOPPING",
  name: "Topping",
  minSelect: 0,
  maxSelect: 2,
  options: [
    { code: "TELUR", name: "Telur", price: 5000 },
    { code: "KEJU", name: "Keju", price: 7000 },
  ],
};

// ------------------------------------------------------ konfigurasi produk
{
  const config = resolveModifierConfig([
    { ...group(), code: "pedas" },
    { ...topping, code: "topping", options: [{ code: "telur", name: "Telur", price: 5000 }] },
  ]);
  check("konfigurasi valid diterima", config.ok, config.reason);
  check(
    "kode grup & opsi dinormalkan ke huruf besar",
    config.groups[0].code === "PEDAS" && config.groups[1].options[0].code === "TELUR",
    JSON.stringify(config.groups.map((g) => g.code)),
  );
}

const rejections = [
  [
    "lebih dari batas grup",
    Array.from({ length: MAX_MODIFIER_GROUPS + 1 }, (_, i) => ({
      ...group(),
      code: `G${i}`,
      options: [{ code: "A", name: "A", price: 0 }],
    })),
    "Maksimal",
  ],
  ["kode grup tidak valid", [group({ code: "1PEDAS" })], "tidak valid"],
  ["grup tertulis dua kali", [group(), group({ name: "Pedas lagi" })], "dua kali"],
  ["nama grup kosong", [group({ name: "   " })], "wajib diisi"],
  [
    "nama grup kepanjangan",
    [group({ name: "Level pedas yang sangat panjang sekali" })],
    "maksimal",
  ],
  ["maksimum pilihan 0", [group({ maxSelect: 0 })], "maksimum harus"],
  [
    "maksimum pilihan di atas batas",
    [group({ maxSelect: MAX_GROUP_SELECT + 1 })],
    "maksimum harus",
  ],
  ["minimum lebih besar dari maksimum", [group({ minSelect: 2, maxSelect: 1 })], "minimum harus"],
  ["grup tanpa pilihan", [group({ options: [] })], "belum punya pilihan"],
  [
    "opsi kebanyakan",
    [
      group({
        options: Array.from({ length: MAX_MODIFIER_OPTIONS + 1 }, (_, i) => ({
          code: `O${i}`,
          name: `Opsi ${i}`,
          price: 0,
        })),
      }),
    ],
    "maksimal",
  ],
  ["kode opsi tidak valid", [group({ options: [{ code: "TELUR!", name: "Telur", price: 0 }] })], "tidak valid"],
  [
    "opsi tertulis dua kali",
    [
      group({
        options: [
          { code: "A", name: "Satu", price: 0 },
          { code: "A", name: "Dua", price: 0 },
        ],
      }),
    ],
    "dua kali",
  ],
  ["nama opsi kosong", [group({ options: [{ code: "A", name: "", price: 0 }] })], "wajib diisi"],
  [
    "harga opsi negatif",
    [group({ options: [{ code: "A", name: "Diskon", price: -1 }] })],
    "tidak boleh negatif",
  ],
];

for (const [label, groups, expected] of rejections) {
  const config = resolveModifierConfig(groups);
  check(
    `konfigurasi ditolak: ${label}`,
    config.ok === false && (config.reason ?? "").includes(expected),
    config.reason ?? "DITERIMA",
  );
}

{
  const config = resolveModifierConfig([
    group({ options: [{ code: "1", name: "Pedas 1", price: 2500.7 }] }),
  ]);
  check("harga opsi dipotong ke rupiah bulat", config.groups[0].options[0].price === 2500, String(config.groups[0].options[0].price));
}
check("daftar kosong = produk tanpa modifier", resolveModifierConfig([]).ok, "ditolak");

// ------------------------------------------------------------- usul kode
check("usul kode grup dari nama", suggestGroupCode("Level pedas") === "LEVEL_PEDA", suggestGroupCode("Level pedas"));
check("usul kode grup dari nama non-latin jatuh ke cadangan", suggestGroupCode("é") === "GRUP", suggestGroupCode("é"));
check("usul kode grup unik", suggestGroupCode("Pedas", ["PEDAS"]) === "PEDAS_2", suggestGroupCode("Pedas", ["PEDAS"]));
check("usul kode opsi boleh angka", suggestOptionCode("3") === "3", suggestOptionCode("3"));
check("usul kode opsi dari nama", suggestOptionCode("Telur Ayam") === "TELUR_AYAM".slice(0, 10), suggestOptionCode("Telur Ayam"));
check("usul kode opsi unik", suggestOptionCode("Telur", ["TELUR"]) === "TELUR_2", suggestOptionCode("Telur", ["TELUR"]));
check(
  "kode cadangan tetap < 10 karakter",
  suggestGroupCode("", ["GRUP", "GRUP_2", "GRUP_3"]).length <= 10,
  suggestGroupCode("", ["GRUP", "GRUP_2", "GRUP_3"]),
);

// ------------------------------------------------------- pilihan kasir
const menu = { modifiers: [group(), topping] };

check("produk tanpa modifier dikenali", hasModifiers({}) === false && hasModifiers(menu) === true);

{
  const applied = applyModifiers(menu, []);
  check("produk bermodifier wajib: pilihan kosong ditolak", applied.ok === false, "DITERIMA");
  check(
    "pesan wajib menyebut nama grupnya",
    (applied.reason ?? "").includes("Level pedas"),
    applied.reason,
  );
}

{
  const applied = applyModifiers(
    menu,
    [
      { groupCode: "TOPPING", optionCodes: ["TELUR", "KEJU"] },
      { groupCode: "PEDAS", optionCodes: ["2"] },
    ],
  );
  check("pilihan lengkap diterima", applied.ok, applied.reason);
  check("tambahan harga dijumlahkan", applied.surcharge === 12000, String(applied.surcharge));
  check(
    "urutan mengikuti konfigurasi produk, bukan urutan klik",
    applied.labels[0].startsWith("Level pedas") && applied.labels[1].startsWith("Topping"),
    applied.labels.join(" | "),
  );
  check(
    // Opsi di dalam satu grup diurutkan berdasarkan kode, jadi hasilnya selalu
    // sama untuk pilihan yang sama (bukan mengikuti urutan klik kasir).
    "label siap tampil dan stabil urutannya",
    applied.labels.join(" · ") === "Level pedas: Pedas 2 · Topping: Keju · Topping: Telur",
    applied.labels.join(" · "),
  );
  check(
    "ringkasan label",
    modifierSummary(applied.labels) === applied.labels.join(" · "),
    modifierSummary(applied.labels),
  );
}

{
  const applied = applyModifiers(menu, [
    { groupCode: "PEDAS", optionCodes: ["2"] },
    { groupCode: "TOPPING", optionCodes: [] },
  ]);
  check(
    "grup opsional dengan pilihan kosong diabaikan",
    applied.ok && applied.surcharge === 0 && applied.labels.length === 1,
    JSON.stringify(applied),
  );
}

const selectionRejections = [
  ["produk tanpa modifier tidak menerima pilihan", {}, [{ groupCode: "PEDAS", optionCodes: ["1"] }], "tidak punya modifier"],
  ["grup tidak dikenal", menu, [{ groupCode: "SAUS", optionCodes: ["A"] }], "tidak dikenal"],
  ["opsi tidak ada di grup", menu, [{ groupCode: "PEDAS", optionCodes: ["9"] }], "tidak ada di grup"],
  [
    "pilihan melebihi batas grup",
    menu,
    [
      { groupCode: "PEDAS", optionCodes: ["1"] },
      { groupCode: "TOPPING", optionCodes: ["TELUR", "KEJU", "BAKSO"] },
    ],
    "Maksimal 2",
  ],
  [
    "grup dikirim dua kali",
    menu,
    [
      { groupCode: "PEDAS", optionCodes: ["1"] },
      { groupCode: "PEDAS", optionCodes: ["2"] },
    ],
    "dipilih dua kali",
  ],
];

for (const [label, product, selections, expected] of selectionRejections) {
  const applied = applyModifiers(product, selections);
  check(
    `pilihan ditolak: ${label}`,
    applied.ok === false && (applied.reason ?? "").includes(expected),
    applied.reason ?? "DITERIMA",
  );
}

{
  const applied = applyModifiers(menu, [
    { groupCode: "PEDAS", optionCodes: ["1", "1"] },
  ]);
  check(
    "opsi yang sama dua kali dihitung sekali",
    applied.ok && applied.surcharge === 0 && applied.applied.length === 1,
    JSON.stringify(applied.applied),
  );
}

check("produk kosong aman", applyModifiers(null, []).ok, "gagal");

// --------------------------------------------------------- harga & label
check(
  "tanpa tambahan, total baris tidak berubah",
  lineTotalWithModifiers(54000, 2, 0) === 54000,
  String(lineTotalWithModifiers(54000, 2, 0)),
);
check(
  "tambahan dihitung per unit yang dijual",
  lineTotalWithModifiers(54000, 2, 5000) === 64000,
  String(lineTotalWithModifiers(54000, 2, 5000)),
);
check(
  "satu Dus tidak mengalikan topping 24×",
  lineTotalWithModifiers(96000, 1, 5000) === 101000,
  String(lineTotalWithModifiers(96000, 1, 5000)),
);

check(
  "ringkasan konfigurasi untuk halaman Produk",
  describeModifierGroups([group(), topping]) ===
    "Level pedas (wajib 1–1) · Topping (0–2)",
  describeModifierGroups([group(), topping]),
);
check("ringkasan produk tanpa modifier", describeModifierGroups([]) === "Tanpa modifier", describeModifierGroups([]));

console.log(`${results.length}/${results.length} checks passed`);

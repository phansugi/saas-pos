/**
 * Uji aturan gudang & perpindahan stok (`inventory.multiwarehouse`) tanpa
 * deployment.
 *
 * Yang diuji adalah `src/convex/lib/inventory.ts` — modul murni yang dipakai
 * server (saat menambah gudang & memindahkan stok), store klien, halaman
 * Gudang & Stok, dan ledger stok.
 *
 * Usage: bun scripts/verify-inventory.mjs
 */
import {
  DEFAULT_WAREHOUSE_ID,
  MAX_WAREHOUSE_ADDRESS,
  MAX_WAREHOUSE_NAME,
  activeWarehouses,
  bucketQuantities,
  defaultWarehouse,
  describeWarehouse,
  describeWarehouseLimit,
  isDefaultWarehouse,
  isValidWarehouseCode,
  normalizeWarehouseCode,
  planTransfer,
  resolveWarehouseInput,
  suggestWarehouseCode,
  totalQuantity,
  warehouseCapacity,
  warehouseCodeTaken,
} from "../src/convex/lib/inventory.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// ------------------------------------------------------------ lokasi jual
{
  const location = defaultWarehouse();
  check(
    "lokasi jual selalu ada dengan id `default`",
    location.id === DEFAULT_WAREHOUSE_ID && location.isDefault === true,
    JSON.stringify(location),
  );
  check("lokasi jual selalu aktif", location.active === true, String(location.active));
}

check(
  "id kosong berarti lokasi jual",
  isDefaultWarehouse(undefined) && isDefaultWarehouse(null) && isDefaultWarehouse("default"),
  `${isDefaultWarehouse(undefined)} / ${isDefaultWarehouse(null)} / ${isDefaultWarehouse("default")}`,
);
check("id gudang biasa bukan lokasi jual", isDefaultWarehouse("w01") === false, String(isDefaultWarehouse("w01")));

// ---------------------------------------------------------------- kode
check(
  "kode gudang dinormalkan (huruf besar, tanpa spasi)",
  normalizeWarehouseCode(" gd-a ") === "GD-A",
  normalizeWarehouseCode(" gd-a "),
);
check(
  "karakter aneh dibuang dari kode",
  normalizeWarehouseCode("g*d@#a") === "GDA",
  normalizeWarehouseCode("g*d@#a"),
);
check("kode 2–8 huruf/angka valid", isValidWarehouseCode("GD-A") === true, "GD-A");
check("kode satu karakter ditolak", isValidWarehouseCode("G") === false, "G");
check("kode panjang ditolak", isValidWarehouseCode("GUDANG-UTAMA") === false, "GUDANG-UTAMA");

check(
  "usulan kode dari nama memakai singkatan kata",
  suggestWarehouseCode("Gudang Utama") === "GU",
  suggestWarehouseCode("Gudang Utama"),
);
check(
  "usulan kode menghindari kode yang sudah dipakai",
  suggestWarehouseCode("Gudang Utama", ["GU"]) === "GU-2",
  suggestWarehouseCode("Gudang Utama", ["GU"]),
);
check(
  "nama satu kata tetap mendapat kode",
  /^[A-Z0-9-]{2,8}$/.test(suggestWarehouseCode("Gudang", [])),
  suggestWarehouseCode("Gudang", []),
);

check(
  "kode yang sudah dipakai terdeteksi (tanpa peka huruf besar/kecil)",
  warehouseCodeTaken([{ id: "w1", code: "gd-a" }], "GD-A") === true,
  "gd-a vs GD-A",
);
check(
  "gudang yang sedang diubah tidak dianggap duplikat",
  warehouseCodeTaken([{ id: "w1", code: "GD-A" }], "GD-A", "w1") === false,
  "kecuali dirinya sendiri",
);

// ------------------------------------------------------------- validasi
{
  const result = resolveWarehouseInput({
    name: "  Gudang   Utama ",
    address: "Jl. Sudirman 12",
  });
  check("gudang valid diterima", result.ok, result.reason);
  check(
    "nama & alamat dinormalkan, kode diusulkan",
    result.value.name === "Gudang Utama" &&
      result.value.address === "Jl. Sudirman 12" &&
      result.value.code === "GU" &&
      result.value.active === true,
    JSON.stringify(result.value),
  );
}

check(
  "alamat kosong tidak disimpan sebagai string kosong",
  resolveWarehouseInput({ name: "Gudang Cadangan", address: "  " }).value?.address === undefined,
  JSON.stringify(resolveWarehouseInput({ name: "Gudang Cadangan", address: "  " }).value),
);

for (const [label, input, expected] of [
  ["nama terlalu pendek", { name: "A" }, `2–${MAX_WAREHOUSE_NAME} karakter`],
  ["nama terlalu panjang", { name: "Gudang ".repeat(10) }, `2–${MAX_WAREHOUSE_NAME} karakter`],
  ["kode tidak valid", { name: "Gudang Utama", code: "G!" }, "tidak valid"],
  [
    "alamat terlalu panjang",
    { name: "Gudang Utama", address: "x".repeat(MAX_WAREHOUSE_ADDRESS + 1) },
    `maksimal ${MAX_WAREHOUSE_ADDRESS} karakter`,
  ],
]) {
  const result = resolveWarehouseInput(input);
  check(
    `gudang ditolak: ${label}`,
    !result.ok && (result.reason ?? "").includes(expected),
    result.ok ? "DITERIMA — validasi bocor" : result.reason,
  );
}

{
  const duplicate = resolveWarehouseInput({ name: "Gudang Utama", code: "GD-A" }, ["gd-a"]);
  check(
    "kode gudang duplikat ditolak",
    !duplicate.ok && (duplicate.reason ?? "").includes("sudah dipakai"),
    duplicate.reason,
  );
}

// --------------------------------------------------------- batas paket
{
  const starter = warehouseCapacity(1, 0);
  check(
    "paket 1 lokasi: hanya lokasi jual, tanpa sisa slot",
    starter.used === 1 && starter.remaining === 0 && starter.full === true,
    JSON.stringify(starter),
  );
  const pro = warehouseCapacity(3, 1);
  check(
    "paket 3 lokasi: satu gudang terpakai, satu slot sisa",
    pro.used === 2 && pro.remaining === 1 && pro.full === false,
    JSON.stringify(pro),
  );
  const enterprise = warehouseCapacity("unlimited", 5);
  check(
    "paket tanpa batas tidak pernah penuh",
    enterprise.full === false && enterprise.remaining === Number.POSITIVE_INFINITY,
    JSON.stringify(enterprise),
  );
}

check("label batas lokasi", describeWarehouseLimit(1) === "1 lokasi", describeWarehouseLimit(1));
check(
  "label batas tanpa batas",
  describeWarehouseLimit("unlimited") === "tanpa batas",
  describeWarehouseLimit("unlimited"),
);

// ----------------------------------------------------------- pindah stok
{
  const ok = planTransfer({
    from: "w01",
    to: DEFAULT_WAREHOUSE_ID,
    quantity: 12,
    available: 120,
    fromName: "GD-A · Gudang Utama",
    toName: "Lokasi jual (toko)",
  });
  check("perpindahan valid diterima", ok.ok && ok.value.quantity === 12, JSON.stringify(ok));
}

for (const [label, request, expected] of [
  [
    "jumlah nol",
    { from: "w01", to: "default", quantity: 0, available: 10, fromName: "GD-A", toName: "TOKO" },
    "bilangan bulat lebih dari 0",
  ],
  [
    "jumlah negatif",
    { from: "w01", to: "default", quantity: -3, available: 10, fromName: "GD-A", toName: "TOKO" },
    "bilangan bulat lebih dari 0",
  ],
  [
    "jumlah pecahan",
    { from: "w01", to: "default", quantity: 1.5, available: 10, fromName: "GD-A", toName: "TOKO" },
    "bilangan bulat lebih dari 0",
  ],
  [
    "lokasi asal sama dengan tujuan",
    { from: "w01", to: "w01", quantity: 1, available: 10, fromName: "GD-A", toName: "GD-A" },
    "tidak boleh sama",
  ],
  [
    "stok asal tidak cukup",
    { from: "w01", to: "default", quantity: 50, available: 12, fromName: "GD-A · Gudang Utama", toName: "TOKO" },
    "hanya 12",
  ],
  [
    "gudang asal nonaktif",
    {
      from: "w03",
      to: "default",
      quantity: 1,
      available: 10,
      fromName: "GD-LAMA · Gudang Lama",
      toName: "TOKO",
      fromActive: false,
    },
    "nonaktif",
  ],
  [
    "gudang tujuan nonaktif",
    {
      from: "default",
      to: "w03",
      quantity: 1,
      available: 10,
      fromName: "TOKO",
      toName: "GD-LAMA · Gudang Lama",
      toActive: false,
    },
    "nonaktif",
  ],
]) {
  const result = planTransfer(request);
  check(
    `perpindahan ditolak: ${label}`,
    !result.ok && (result.reason ?? "").includes(expected),
    result.ok ? "DITERIMA — aturan pindah bocor" : result.reason,
  );
}

// Pindah dari lokasi jual ke gudang juga harus bisa (stok kembali ke rak).
check(
  "arah sebaliknya (toko → gudang) juga boleh",
  planTransfer({
    from: DEFAULT_WAREHOUSE_ID,
    to: "w01",
    quantity: 5,
    available: 5,
    fromName: "Lokasi jual (toko)",
    toName: "GD-A · Gudang Utama",
  }).ok === true,
  "toko → gudang",
);

// ------------------------------------------------------- ringkasan stok
{
  const levels = [
    { warehouseId: DEFAULT_WAREHOUSE_ID, quantity: 30 },
    { warehouseId: "w01", quantity: 120 },
    { warehouseId: "w02", quantity: 24 },
  ];
  check(
    "stok per lokasi dibaca dengan benar",
    bucketQuantities(levels) === 30 && bucketQuantities(levels, "w01") === 120,
    `${bucketQuantities(levels)} / ${bucketQuantities(levels, "w01")}`,
  );
  check("lokasi yang tidak ada berarti nol", bucketQuantities(levels, "w99") === 0, String(bucketQuantities(levels, "w99")));
  check("total stok = jumlah semua lokasi", totalQuantity(levels) === 174, String(totalQuantity(levels)));
  check(
    "total stok tidak berubah oleh perpindahan",
    (() => {
      const moved = levels.map((level) =>
        level.warehouseId === "w01"
          ? { ...level, quantity: level.quantity - 20 }
          : level.warehouseId === DEFAULT_WAREHOUSE_ID
            ? { ...level, quantity: level.quantity + 20 }
            : level,
      );
      return totalQuantity(moved) === totalQuantity(levels);
    })(),
    "120 + 30 → 100 + 50",
  );
}

check(
  "label gudang untuk daftar & audit",
  describeWarehouse({ code: "GD-A", name: "Gudang Utama" }) === "GD-A · Gudang Utama",
  describeWarehouse({ code: "GD-A", name: "Gudang Utama" }),
);
check(
  "hanya gudang aktif yang ditawarkan",
  activeWarehouses([
    { id: "w1", active: true },
    { id: "w2", active: false },
  ]).length === 1,
  "1 dari 2",
);

console.log(`${results.length}/${results.length} checks passed`);

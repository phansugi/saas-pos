/**
 * Uji aturan alur F&B (denah meja + antrean dapur) tanpa deployment.
 *
 * Yang diuji adalah `src/convex/lib/fnb.ts` — modul murni yang dipakai backend,
 * klien, dan halaman Dapur & Meja. Karena aturannya tidak boleh hidup dua kali,
 * hasil uji di sini berlaku untuk ketiganya.
 *
 * Usage: bun scripts/verify-fnb.mjs
 */
import {
  clockOfDay,
  fireKitchenOnSale,
  isKdsAlertFlashing,
  isKitchenTicket,
  isTicketLate,
  kdsAlertLabel,
  kdsQueue,
  KDS_ALERT_FLASH_MS,
  KDS_ALERT_WINDOW_MS,
  KDS_ATTENTION_MINUTES,
  MAX_TABLE_IMPORT_ROWS,
  MAX_TABLE_SEATS,
  nextTableSortOrder,
  planKdsAlert,
  planTableImport,
  planTableMove,
  resolveTableInput,
  seatTable,
  sortTablesByOrder,
  splitTableImportRow,
  tableDeletionCheck,
  tableHolders,
  tableLabel,
  tableNameTaken,
  tableOccupiedReason,
  tableStates,
  ticketPaidLabel,
  ticketPaymentLabel,
  ticketSummary,
  ticketTableHolders,
  waitingMinutes,
} from "../src/convex/lib/fnb.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const MINUTE = 60_000;
const NOW = 1_800_000_000_000;

const tables = [
  { id: "t1", name: "A1", zone: "Utama", seats: 4, active: true },
  { id: "t2", name: "A2", zone: "Utama", seats: 2, active: true },
  { id: "t3", name: "B1", zone: "Teras", seats: 6, active: true },
  { id: "t4", name: "VIP", zone: "Lantai 2", seats: 10, active: false },
];

// ------------------------------------------------------------ input meja
{
  const parsed = resolveTableInput({ name: "  A1  ", seats: 4 });
  check("nama meja dinormalkan (spasi dirapatkan)", parsed.ok && parsed.name === "A1", JSON.stringify(parsed));
  check("zona default Utama", parsed.ok && parsed.zone === "Utama", parsed.zone);
}

check(
  "nama meja wajib diisi",
  resolveTableInput({ name: "   ", seats: 4 }).reason === "Nama meja wajib diisi.",
  resolveTableInput({ name: "   ", seats: 4 }).reason,
);
check(
  "nama meja maksimal 16 karakter",
  resolveTableInput({ name: "Meja Teras Nomor Tujuh Belas", seats: 4 }).ok === false,
  "diterima",
);
check(
  "nama meja menolak karakter aneh",
  resolveTableInput({ name: "A1;DROP", seats: 4 }).ok === false,
  "diterima",
);
check(
  "kursi 0 ditolak",
  resolveTableInput({ name: "A1", seats: 0 }).ok === false,
  "diterima",
);
check(
  `kursi di atas ${MAX_TABLE_SEATS} ditolak`,
  resolveTableInput({ name: "A1", seats: MAX_TABLE_SEATS + 1 }).ok === false,
  "diterima",
);
check(
  "kursi pecahan dipotong ke bilangan bulat",
  resolveTableInput({ name: "A1", seats: 4.9 }).seats === 4,
  "tidak dipotong",
);
check(
  "kursi bukan angka ditolak",
  resolveTableInput({ name: "A1", seats: "banyak" }).ok === false,
  "diterima",
);
check(
  "zona kosong kembali ke Utama",
  resolveTableInput({ name: "A1", seats: 4, zone: "  " }).zone === "Utama",
  "tidak kembali",
);
check(
  "zona terlalu panjang ditolak",
  resolveTableInput({ name: "A1", seats: 4, zone: "Zona Sangat Panjang Sekali Di Sini" }).ok === false,
  "diterima",
);

// --------------------------------------------------------- nama duplikat
check("nama meja unik tanpa peka huruf besar-kecil", tableNameTaken(tables, "a1"), "a1 diterima");
check("nama meja baru tidak dianggap duplikat", !tableNameTaken(tables, "C1"), "C1 ditolak");
check(
  "meja yang sedang diubah tidak menghalangi namanya sendiri",
  !tableNameTaken(tables, "A1", "t1"),
  "t1 dianggap duplikat",
);

// ------------------------------------------------------------ denah meja
{
  const orders = [
    { id: "s1", number: "A-00001", createdAt: NOW - 20 * MINUTE, tableId: "t1" },
    { id: "s2", number: "A-00002", createdAt: NOW - 5 * MINUTE, tableId: "t3" },
  ];
  const states = tableStates(tables, orders, NOW);
  const byId = new Map(states.map((state) => [state.id, state]));

  check("meja tanpa pesanan kosong", byId.get("t2").status === "free", JSON.stringify(byId.get("t2")));
  check(
    "meja dengan pesanan tertahan jadi terisi",
    byId.get("t1").status === "occupied" && byId.get("t1").orderNumber === "A-00001",
    JSON.stringify(byId.get("t1")),
  );
  check(
    "menit tunggu meja dihitung dari pesanannya",
    byId.get("t1").waitingMinutes === 20,
    String(byId.get("t1").waitingMinutes),
  );
  check(
    "meja nonaktif tidak pernah dianggap terisi",
    byId.get("t4").status === "inactive",
    JSON.stringify(byId.get("t4")),
  );
  check("semua meja dilaporkan", states.length === tables.length, String(states.length));
}

{
  // Data lama yang meninggalkan dua pesanan di satu meja: yang paling lama menang,
  // supaya denah tidak menampilkan waktu tunggu yang terlalu muda.
  const states = tableStates(
    tables,
    [
      { id: "s2", number: "A-00002", createdAt: NOW - 2 * MINUTE, tableId: "t1" },
      { id: "s1", number: "A-00001", createdAt: NOW - 30 * MINUTE, tableId: "t1" },
    ],
    NOW,
  );
  const a1 = states.find((state) => state.id === "t1");
  check("dua pesanan di satu meja: yang terlama dipakai", a1.orderNumber === "A-00001", a1.orderNumber);
}

// ------------------------------------------------------------- seatTable
check(
  "meja tidak dikenal ditolak",
  seatTable(tables, [], "t9").ok === false,
  "diterima",
);
{
  const blocked = seatTable(tables, [], "t4");
  check(
    "meja nonaktif tidak boleh ditempati",
    blocked.ok === false && blocked.reason.includes("tidak aktif"),
    JSON.stringify(blocked),
  );
}
{
  const orders = [{ id: "s1", number: "A-00007", createdAt: NOW - MINUTE, tableId: "t1" }];
  const blocked = seatTable(tables, orders, "t1");
  check(
    "meja terisi menolak pesanan kedua dengan nomor pesanannya",
    blocked.ok === false && blocked.reason.includes("A-00007"),
    JSON.stringify(blocked),
  );
  check("meja lain tetap boleh ditempati", seatTable(tables, orders, "t2").ok === true, "ditolak");
}

// ------------------------------- meja terkunci sampai dapur menekan Selesai
{
  /*
    Meja tamu yang uangnya sudah masuk **tetap** milik tamunya: makanannya belum
    datang, jadi kasir tidak boleh menempatkan pesanan lain di situ. Yang
    menentukan adalah tiket dapurnya (`tableHolders`), bukan status bayarnya.
  */
  const lunas = {
    id: "s-lunas",
    number: "A-00042",
    createdAt: NOW - 4 * MINUTE,
    tableId: "t1",
    status: "completed",
    kitchenFiredAt: NOW - 4 * MINUTE,
    kitchenDoneAt: null,
  };
  const tertahan = {
    id: "s-tahan",
    number: "A-00043",
    createdAt: NOW - 9 * MINUTE,
    tableId: "t2",
    status: "held",
  };
  const sudahBeres = { ...lunas, id: "s-beres", number: "A-00044", kitchenDoneAt: NOW - MINUTE };
  const punyaMeja = (id, tableId) => ({
    id,
    number: `A-${id}`,
    createdAt: NOW - MINUTE,
    tableId,
    status: "completed",
  });

  const holders = tableHolders([
    lunas,
    tertahan,
    sudahBeres,
    punyaMeja("00045", "t3"),
    { ...punyaMeja("00046", "t3"), status: "void" },
    { ...tertahan, id: "s-bungkus", tableId: undefined },
  ]);
  check(
    "meja ditempati tiket dapur: tertahan + lunas yang belum ditandai selesai",
    holders.map((row) => row.id).join(",") === "s-lunas,s-tahan",
    JSON.stringify(holders),
  );
  check(
    "tiket lunas ditandai `settled` saat menempati meja",
    holders[0].settled === true && holders[1].settled === false,
    JSON.stringify(holders),
  );
  check(
    "tiket yang sudah ditandai selesai melepas mejanya",
    !holders.some((row) => row.id === "s-beres"),
    JSON.stringify(holders.map((row) => row.id)),
  );
  check(
    "penjualan yang tidak pernah ke dapur & yang dibatalkan tidak menahan meja",
    holders.length === 2,
    JSON.stringify(holders.map((row) => row.id)),
  );

  const ditolak = seatTable(tables, holders, "t1");
  check(
    "meja yang sudah dibayar menolak kasir dengan alasan menunggu dapur",
    ditolak.ok === false &&
      ditolak.reason.includes("sudah dibayar") &&
      ditolak.reason.includes("Selesai"),
    JSON.stringify(ditolak),
  );
  const ditolakTertahan = seatTable(tables, holders, "t2");
  check(
    "pesanan tertahan tetap dijawab selesaikan/batalkan",
    ditolakTertahan.ok === false &&
      ditolakTertahan.reason.includes("Selesaikan atau batalkan"),
    JSON.stringify(ditolakTertahan),
  );
  check("meja yang tidak ditempati tetap boleh dipakai", seatTable(tables, holders, "t3").ok === true, "ditolak");

  const states = tableStates(tables, holders, NOW);
  const a1 = states.find((state) => state.id === "t1");
  const a2 = states.find((state) => state.id === "t2");
  check(
    "denah menandai meja tiket lunas terisi & sudah dibayar",
    a1.status === "occupied" && a1.paid === true && a1.orderNumber === "A-00042",
    JSON.stringify(a1),
  );
  check(
    "denah membedakan pesanan tertahan (belum dibayar)",
    a2.status === "occupied" && a2.paid === false,
    JSON.stringify(a2),
  );
  check(
    "kalimat penolakan menyebut nomor pesanannya",
    tableOccupiedReason("A1", holders[0]).includes("A-00042"),
    tableOccupiedReason("A1", holders[0]),
  );
}

{
  /*
    Denah kasir & layar dapur membacanya dari **antrean dapur** yang sama, jadi
    tiket lunas yang masih menunggu pun terkunci di kedua layar itu.
  */
  const antrean = [
    { saleId: "s1", number: "A-00001", createdAt: NOW - 3 * MINUTE, tableId: "t1", settled: true },
    { saleId: "s2", number: "A-00002", createdAt: NOW - MINUTE, tableId: undefined, settled: true },
  ];
  const holders = ticketTableHolders(antrean);
  check(
    "tiket lunas di antrean menahan mejanya",
    holders.length === 1 && holders[0].id === "s1" && holders[0].settled === true,
    JSON.stringify(holders),
  );
  check("tiket bungkus tidak menahan meja", seatTable(tables, holders, "t2").ok === true, "ditolak");
  check(
    "antrean kosong mengosongkan semua meja",
    tableStates(tables, ticketTableHolders([])).filter((state) => state.status === "occupied")
      .length === 0,
    "masih ada meja terisi",
  );
}

// ------------------------------------------------------- waktu & antrean
check("menit tunggu tidak negatif", waitingMinutes(NOW + 10 * MINUTE, NOW) === 0, "tidak dijepit");
check(
  `ambang tanda lama = ${KDS_ATTENTION_MINUTES} menit`,
  isTicketLate(KDS_ATTENTION_MINUTES) && !isTicketLate(KDS_ATTENTION_MINUTES - 1),
  "ambang salah",
);

{
  const tickets = kdsQueue(
    [
      {
        id: "s2",
        number: "A-00002",
        createdAt: NOW - 3 * MINUTE,
        tableId: "t3",
        items: [{ name: "Es Teh Manis", quantity: 2 }],
      },
      {
        id: "s1",
        number: "A-00001",
        createdAt: NOW - 20 * MINUTE,
        items: [{ name: "Nasi Goreng Spesial", quantity: 1 }, { name: "Kopi Susu", quantity: 2 }],
      },
    ],
    tables,
    NOW,
  );

  check("antrean paling lama menunggu di depan", tickets[0].number === "A-00001", tickets.map((t) => t.number).join(","));
  check("jumlah item dihitung", tickets[0].itemCount === 3, String(tickets[0].itemCount));
  check("meja tersalin ke tiket", tickets[1].tableName === "B1", String(tickets[1].tableName));
  check(
    "pesanan tanpa meja tetap masuk antrean (bungkus)",
    tickets[0].tableName === undefined && tickets[0].tableId === undefined,
    String(tickets[0].tableName),
  );
  check("tiket lama ditandai", tickets[0].late === true, String(tickets[0].late));
  check("tiket baru belum ditandai", tickets[1].late === false, String(tickets[1].late));
  check(
    "menit tunggu tiket dihitung",
    tickets[1].waitingMinutes === 3,
    String(tickets[1].waitingMinutes),
  );
  check(
    "ringkasan tiket untuk kartu dapur",
    ticketSummary(tickets[0]) === "1× Nasi Goreng Spesial · 2× Kopi Susu",
    ticketSummary(tickets[0]),
  );
}

{
  // Modifier item (`pos.modifier`) ikut ke tiket dapur: dapur harus membaca
  // "pedas level 3" di kartunya, bukan hanya di struk.
  const tickets = kdsQueue(
    [
      {
        id: "s9",
        number: "A-00009",
        createdAt: NOW,
        tableId: "t1",
        items: [
          {
            name: "Nasi Goreng Spesial",
            quantity: 1,
            modifiers: ["Level pedas: Pedas 3", "Topping: Telur"],
          },
        ],
      },
    ],
    tables,
    NOW,
  );
  check(
    "modifier tersalin ke tiket dapur",
    tickets[0].items[0].modifiers?.length === 2,
    JSON.stringify(tickets[0].items[0]),
  );
  check(
    "ringkasan tiket menampilkan modifier",
    ticketSummary(tickets[0]) ===
      "1× Nasi Goreng Spesial (Level pedas: Pedas 3, Topping: Telur)",
    ticketSummary(tickets[0]),
  );
}

{
  // Meja yang sudah dihapus dari denah: tiketnya tetap tampil, tanpa nama meja.
  const tickets = kdsQueue(
    [{ id: "s1", number: "A-00001", createdAt: NOW, tableId: "t-hilang", items: [] }],
    tables,
    NOW,
  );
  check("tiket tanpa meja dikenal tetap aman", tickets[0].tableName === undefined, String(tickets[0].tableName));
}

// --------------------------------------------------- pagar hapus meja
{
  // Meja yang belum pernah dipakai: satu-satunya yang layak dihapus — mis. meja
  // yang barusan salah ditambahkan. Kursinya boleh besar; itu bukan alasannya.
  const bebas = tableDeletionCheck("C9", {
    openOrders: 0,
    sales: 0,
    pendingGuestOrders: 0,
  });
  check("meja tanpa pemakaian boleh dihapus", bebas.canDelete === true, JSON.stringify(bebas));
  check("tanpa penghalang tidak ada blockers", bebas.blockers.length === 0, JSON.stringify(bebas.blockers));
  check(
    "kalimat meja bebas menyebut belum pernah dipakai",
    bebas.sentence.includes("belum pernah dipakai"),
    bebas.sentence,
  );
  check(
    "kalimat meja bebas menyebut namanya",
    bebas.sentence.includes("C9"),
    bebas.sentence,
  );
}

{
  // Meja yang masih terisi pesanan terbuka: pesanannya akan kehilangan mejanya
  // di layar dapur, jadi nomor pesanannya disebut supaya bisa dibereskan.
  const terisi = tableDeletionCheck("A1", {
    openOrders: 1,
    openOrderNumber: "A-00007",
    sales: 0,
    pendingGuestOrders: 0,
  });
  check("meja terisi tidak boleh dihapus", terisi.canDelete === false, JSON.stringify(terisi));
  check(
    "penolakan meja terisi menyebut nomor pesanannya",
    terisi.sentence.includes("A-00007"),
    terisi.sentence,
  );
  check(
    "penolakan meja terisi memakai kalimat yang sama dengan nonaktifkan",
    terisi.sentence.includes("Selesaikan atau batalkan dulu"),
    terisi.sentence,
  );
  check("satu penghalang = satu kalimat", terisi.blockers.length === 1, JSON.stringify(terisi.blockers));
}

{
  const nomorHilang = tableDeletionCheck("A2", {
    openOrders: 1,
    sales: 0,
    pendingGuestOrders: 0,
  });
  check(
    "pesanan terbuka tanpa nomor tetap terbaca",
    nomorHilang.sentence.includes("(tanpa nomor)"),
    nomorHilang.sentence,
  );
}

{
  // Tagihan QR tamu yang masih menunggu: tamu bisa membayarnya kapan saja, jadi
  // penghapusan mejanya akan membuat uang masuk tanpa meja.
  const tunggu = tableDeletionCheck("B1", {
    openOrders: 0,
    sales: 0,
    pendingGuestOrders: 2,
  });
  check("meja dengan tagihan tamu menunggu tidak boleh dihapus", tunggu.canDelete === false, JSON.stringify(tunggu));
  check(
    "penolakan tagihan tamu menunjuk tombol batal tamunya",
    tunggu.sentence.includes("tamunya juga bisa membatalkannya sendiri"),
    tunggu.sentence,
  );
}

{
  // Meja yang sudah punya riwayat penjualan: jawabannya menonaktifkan, bukan
  // menghapus riwayat orang lain — pola yang sama dengan hapus produk.
  const beriwayat = tableDeletionCheck("VIP", {
    openOrders: 0,
    sales: 3,
    pendingGuestOrders: 0,
  });
  check("meja beriwayat penjualan tidak boleh dihapus", beriwayat.canDelete === false, JSON.stringify(beriwayat));
  check(
    "penolakan meja beriwayat menyebut jumlah penjualannya",
    beriwayat.sentence.includes("3 penjualan"),
    beriwayat.sentence,
  );
  check(
    "penolakan meja beriwayat menyarankan nonaktifkan",
    beriwayat.sentence.includes("nonaktifkan saja meja ini"),
    beriwayat.sentence,
  );
}

{
  const ganda = tableDeletionCheck("A1", {
    openOrders: 1,
    openOrderNumber: "A-00007",
    sales: 2,
    pendingGuestOrders: 1,
  });
  check("tiga penghalang dilaporkan semua", ganda.blockers.length === 3, JSON.stringify(ganda.blockers));
  check(
    "kalimat ringkas = penghalang pertama (pesanan terisi lebih dulu)",
    ganda.sentence === ganda.blockers[0] && ganda.sentence.includes("A-00007"),
    ganda.sentence,
  );
}

// ----------------------------------------------------- urutan denah meja
{
  // Data lama tanpa urutan tampil dengan aturan lama (zona dulu, lalu nama),
  // jadi tabel yang belum pernah ditata tidak berubah begitu fitur ini masuk.
  const lama = [
    { id: "t2", name: "A2", zone: "Utama", seats: 2, active: true },
    { id: "t1", name: "A1", zone: "Utama", seats: 4, active: true },
    { id: "t3", name: "B1", zone: "Teras", seats: 6, active: true },
  ];
  check(
    "meja tanpa urutan tersimpan dibaca zona dulu lalu nama (aturan lama)",
    sortTablesByOrder(lama).map((t) => t.name).join(",") === "B1,A1,A2",
    sortTablesByOrder(lama).map((t) => t.name).join(","),
  );
  check(
    "urutan tersimpan menang atas nama & zona",
    sortTablesByOrder([
      { id: "t3", name: "B1", zone: "Teras", seats: 6, active: true, sortOrder: 1 },
      { id: "t1", name: "A1", zone: "Utama", seats: 4, active: true, sortOrder: 2 },
    ])
      .map((t) => t.name)
      .join(",") === "B1,A1",
    "urutan tersimpan diabaikan",
  );
  check(
    "sortTablesByOrder tidak mengubah larik masukannya",
    lama.map((t) => t.name).join(",") === "A2,A1,B1",
    lama.map((t) => t.name).join(","),
  );
  check(
    "meja baru selalu dapat urutan paling akhir",
    nextTableSortOrder([
      { id: "t1", name: "A1", zone: "Utama", seats: 4, active: true, sortOrder: 7 },
      { id: "t2", name: "A2", zone: "Utama", seats: 2, active: true },
    ]) === 8,
    String(
      nextTableSortOrder([
        { id: "t1", name: "A1", zone: "Utama", seats: 4, active: true, sortOrder: 7 },
      ]),
    ),
  );
  check(
    "denah yang belum punya urutan apa pun: meja pertama dapat urutan 1",
    nextTableSortOrder(lama) === 1,
    String(nextTableSortOrder(lama)),
  );
}

{
  // Menggeser meja: yang berpindah satu langkah, tetapi **seluruh** denah
  // dinomori ulang 1…n supaya urutannya tidak berlubang.
  const denah = [
    { id: "t1", name: "A1", zone: "Utama", seats: 4, active: true, sortOrder: 1 },
    { id: "t2", name: "A2", zone: "Utama", seats: 2, active: true, sortOrder: 2 },
    { id: "t3", name: "B1", zone: "Teras", seats: 6, active: true, sortOrder: 3 },
  ];
  const maju = planTableMove(denah, "t1", 1);
  check(
    "geser maju menukar meja dengan tetangga kanannya",
    maju.ok === true &&
      maju.moves.map((m) => m.id).join(",") === "t2,t1,t3" &&
      maju.moves.map((m) => m.sortOrder).join(",") === "1,2,3",
    JSON.stringify(maju),
  );
  const mundur = planTableMove(denah, "t3", -1);
  check(
    "geser mundur menukar meja dengan tetangga kirinya",
    mundur.ok === true && mundur.moves.map((m) => m.id).join(",") === "t1,t3,t2",
    JSON.stringify(mundur),
  );
  check(
    "denah dengan urutan berlubang tetap dirapikan",
    (() => {
      const berlubang = [
        { id: "t1", name: "A1", zone: "Utama", seats: 4, active: true, sortOrder: 1 },
        { id: "t2", name: "A2", zone: "Utama", seats: 2, active: true, sortOrder: 5 },
        { id: "t3", name: "B1", zone: "Teras", seats: 6, active: true, sortOrder: 9 },
      ];
      const plan = planTableMove(berlubang, "t1", 1);
      return (
        plan.ok === true &&
        plan.moves.map((m) => `${m.id}:${m.sortOrder}`).join(",") ===
          "t2:1,t1:2,t3:3"
      );
    })(),
    JSON.stringify(planTableMove(denah, "t1", 1)),
  );
  const awal = planTableMove(denah, "t1", -1);
  check(
    "meja paling awal tidak bisa digeser mundur",
    awal.ok === false && awal.reason.includes("paling awal"),
    JSON.stringify(awal),
  );
  const akhir = planTableMove(denah, "t3", 1);
  check(
    "meja paling akhir tidak bisa digeser maju",
    akhir.ok === false && akhir.reason.includes("paling akhir"),
    JSON.stringify(akhir),
  );
  const hantu = planTableMove(denah, "t99", 1);
  check(
    "meja asing ditolak saat digeser",
    hantu.ok === false && hantu.reason.includes("tidak ditemukan"),
    JSON.stringify(hantu),
  );
}

// ----------------------------------------------------------- impor meja
{
  check(
    "pemisah baris impor: koma, titik koma, atau tab (bukan spasi)",
    splitTableImportRow("A1, 4, Utama").join("|") === "A1|4|Utama" &&
      splitTableImportRow("A2; 2; Teras").join("|") === "A2|2|Teras" &&
      splitTableImportRow("B1\t6").join("|") === "B1|6" &&
      splitTableImportRow("Teras 2").join("|") === "Teras 2",
    splitTableImportRow("Teras 2").join("|"),
  );

  const kosong = planTableImport(tables, "   \n# catatan saja\n");
  check(
    "impor tanpa satu baris pun ditolak dengan kalimatnya",
    kosong.ok === false && kosong.reason === "Belum ada baris meja yang bisa dibaca.",
    JSON.stringify(kosong),
  );

  const plan = planTableImport(
    tables,
    "C1, 4, Utama\nC2, 2\nTeras 2, 6, Teras\nC3",
  );
  check(
    "impor membaca nama, kursi, dan zona (kolom yang dilewati memakai bawaan)",
    plan.ok === true &&
      plan.tables.map((t) => `${t.name}/${t.seats}/${t.zone}`).join(",") ===
        "C1/4/Utama,C2/2/Utama,Teras 2/6/Teras,C3/4/Utama",
    JSON.stringify(plan),
  );
  check(
    "impor mempertahankan urutan penulisannya",
    plan.ok === true && plan.tables[0].name === "C1" && plan.tables[3].name === "C3",
    JSON.stringify(plan.ok ? plan.tables : plan),
  );
  check(
    "kolom kedua yang bukan angka dibaca sebagai zona",
    (() => {
      const hasil = planTableImport(tables, "C7, Teras");
      return hasil.ok === true && hasil.tables[0].zone === "Teras" && hasil.tables[0].seats === 4;
    })(),
    JSON.stringify(planTableImport(tables, "C7, Teras")),
  );

  const duplikatBatch = planTableImport(tables, "C1, 4\nc1, 6");
  check(
    "nama yang ditulis dua kali di satu impor ditolak beserta nomor barisnya",
    duplikatBatch.ok === false && duplikatBatch.reason.includes("Baris 2") &&
      duplikatBatch.reason.includes("dua kali"),
    duplikatBatch.reason,
  );
  const duplikatDenah = planTableImport(tables, "C1, 4\nA1, 2");
  check(
    "nama yang sudah ada di denah ditolak beserta nomor barisnya",
    duplikatDenah.ok === false && duplikatDenah.reason.includes("Baris 2") &&
      duplikatDenah.reason.includes("sudah ada di denah ini"),
    duplikatDenah.reason,
  );
  const kursiSalah = planTableImport(tables, "C1, 4\nC2, 99");
  check(
    "satu baris yang salah membatalkan seluruh impor (semua atau tidak sama sekali)",
    kursiSalah.ok === false && kursiSalah.reason.startsWith("Baris 2: ") &&
      kursiSalah.reason.includes("Jumlah kursi"),
    kursiSalah.reason,
  );
  const namaPanjang = planTableImport(tables, "Meja Teras Nomor Tujuh Belas");
  check(
    "aturan nama meja yang sama tetap berlaku pada impor",
    namaPanjang.ok === false && namaPanjang.reason.includes("maksimal"),
    namaPanjang.reason,
  );
  const kebanyakan = planTableImport(
    tables,
    Array.from({ length: MAX_TABLE_IMPORT_ROWS + 1 }, (_, i) => `Z${i + 1}`).join("\n"),
  );
  check(
    `impor dibatasi ${MAX_TABLE_IMPORT_ROWS} baris sekali jalan`,
    kebanyakan.ok === false && kebanyakan.reason.includes(String(MAX_TABLE_IMPORT_ROWS)),
    kebanyakan.reason,
  );
  check(
    "impor tidak menulis apa pun ke denah yang sudah ada",
    tables.length === 4 && tables[0].name === "A1",
    tables.map((t) => t.name).join(","),
  );
}

// --------------------------------------------------------------- label
check("zona default tidak diulang di label", tableLabel({ name: "A1", zone: "Utama" }) === "A1", tableLabel({ name: "A1", zone: "Utama" }));
check("zona lain tampil di label", tableLabel({ name: "B1", zone: "Teras" }) === "B1 · Teras", tableLabel({ name: "B1", zone: "Teras" }));

// --------------------------------------- penanda momen & kanal pelunasan
//
// Tiket dapur hanya lahir dari pesanan yang **sudah lunas**, dan penandanya
// menyebut kanal sekaligus momen pelunasannya supaya terlihat bahwa tiket itu
// memang diterima bersamaan dengan uangnya masuk. Waktu lokal dipakai (bukan
// UTC), jadi momennya dibaca sebagai `13:42` oleh orang yang melihat layarnya.
{
  const siang = new Date(2026, 9, 14, 13, 42, 30).getTime();
  check(
    "tiket QRIS menandai kanal & momen pelunasannya",
    ticketPaymentLabel({ method: "qris", bank: null, paidAt: siang }) ===
      "Lunas QRIS dari meja · diterima dapur pukul 13:42",
    ticketPaymentLabel({ method: "qris", bank: null, paidAt: siang }),
  );
  check(
    "tiket Virtual Account menyebut bank penerbitnya",
    ticketPaymentLabel({ method: "va", bank: "bri", paidAt: siang }) ===
      "Lunas VA BRI dari meja · diterima dapur pukul 13:42",
    ticketPaymentLabel({ method: "va", bank: "bri", paidAt: siang }),
  );
  check(
    "VA tanpa bank tetap terbaca sebagai pesanan dari meja",
    ticketPaymentLabel({ method: "va", bank: null, paidAt: siang }) ===
      "Lunas VA dari meja · diterima dapur pukul 13:42",
    ticketPaymentLabel({ method: "va", bank: null, paidAt: siang }),
  );
  check(
    "jam & menit selalu dua digit (pukul 09:05)",
    clockOfDay(new Date(2026, 9, 14, 9, 5).getTime()) === "09:05",
    clockOfDay(new Date(2026, 9, 14, 9, 5).getTime()),
  );
  check(
    "tiket tanpa momen pelunasan tidak diberi penanda (data lama)",
    ticketPaymentLabel({ method: "qris", bank: null, paidAt: null }) === null &&
      ticketPaymentLabel(undefined) === null &&
      ticketPaymentLabel(null) === null,
    String(ticketPaymentLabel({ method: "qris", paidAt: null })),
  );
}

// ------------------------ tiket dari penjualan yang sudah lunas di kasir
//
// Dua sumber tiket, dan aturannya satu tempat (`isKitchenTicket`): pesanan
// tertahan, dan penjualan lunas yang sudah dikirim ke dapur tetapi belum
// ditandai selesai. Yang menentukan bukan tombolnya, melainkan data penjualannya —
// jadi tiket lunas tidak pernah "diselesaikan" dua kali (stok bergerak sekali).
{
  const tertahan = { status: "held" };
  check("pesanan tertahan selalu tiket dapur", isKitchenTicket(tertahan) === true, "bukan tiket");
  check(
    "penjualan lunas yang sudah dikirim ke dapur jadi tiket",
    isKitchenTicket({ status: "completed", kitchenFiredAt: NOW }) === true,
    "bukan tiket",
  );
  check(
    "penjualan lunas tanpa kiriman ke dapur bukan tiket",
    isKitchenTicket({ status: "completed" }) === false,
    "dianggap tiket",
  );
  check(
    "tiket yang sudah ditandai selesai keluar dari antrean",
    isKitchenTicket({ status: "completed", kitchenFiredAt: NOW, kitchenDoneAt: NOW + 1000 }) ===
      false,
    "masih dianggap tiket",
  );
  check(
    "penjualan yang dibatalkan tidak pernah menunggu di dapur",
    isKitchenTicket({
      status: "void",
      kitchenFiredAt: NOW,
      kitchenDoneAt: null,
    }) === false,
    "dianggap tiket",
  );

  check(
    "penjualan lunas langsung dikirim ke dapur saat dapurnya ada",
    fireKitchenOnSale({ kdsFeatureOn: true, status: "completed" }) === true,
    "tidak dikirim",
  );
  check(
    "tanpa layar dapur tidak ada yang menerima tiketnya",
    fireKitchenOnSale({ kdsFeatureOn: false, status: "completed" }) === false,
    "dikirim",
  );
  check(
    "pesanan tertahan tidak dikirim dua kali (sudah tiket sejak disimpan)",
    fireKitchenOnSale({ kdsFeatureOn: true, status: "held" }) === false,
    "dikirim",
  );
}

{
  const siang = new Date(2026, 9, 14, 13, 42, 30).getTime();
  check(
    "tiket dari kasir menyebut metode bayarnya & momen kirimnya",
    ticketPaidLabel({ method: "cash", firedAt: siang }) ===
      "Lunas Tunai · diterima dapur pukul 13:42",
    ticketPaidLabel({ method: "cash", firedAt: siang }),
  );
  check(
    "QRIS & VA terbaca sebagai metode yang memang dipakai",
    ticketPaidLabel({ method: "qris", firedAt: siang }) ===
      "Lunas QRIS · diterima dapur pukul 13:42" &&
      ticketPaidLabel({ method: "transfer", firedAt: siang }) ===
        "Lunas Transfer · diterima dapur pukul 13:42",
    String(ticketPaidLabel({ method: "qris", firedAt: siang })),
  );
  check(
    "tiket lunas tanpa momen kirim tetap punya penanda metode",
    ticketPaidLabel({ method: "card", firedAt: null }) === "Lunas Kartu",
    String(ticketPaidLabel({ method: "card", firedAt: null })),
  );
  check(
    "metode yang belum dikenal tidak dihilangkan diam-diam",
    ticketPaidLabel({ method: "ewallet", firedAt: null }) === "Lunas ewallet",
    String(ticketPaidLabel({ method: "ewallet", firedAt: null })),
  );
  check(
    "tanpa pembayaran tidak ada penanda (pesanan tertahan)",
    ticketPaidLabel(null) === null && ticketPaidLabel(undefined) === null,
    String(ticketPaidLabel(null)),
  );
}

{
  // Satu antrean berisi kedua jenis tiket: yang tertahan (uangnya belum masuk)
  // dan yang lunas (uangnya sudah masuk). Penandanya ikut ke kartu dapur.
  const tickets = kdsQueue(
    [
      {
        id: "s1",
        number: "A-00001",
        createdAt: NOW - 10 * MINUTE,
        items: [{ name: "Kopi Susu", quantity: 1 }],
      },
      {
        id: "s2",
        number: "A-00002",
        createdAt: NOW - 2 * MINUTE,
        tableId: "t1",
        settled: true,
        paidLabel: "Lunas Tunai · diterima dapur pukul 13:42",
        items: [{ name: "Nasi Goreng Spesial", quantity: 2 }],
      },
    ],
    tables,
    NOW,
  );
  check(
    "pesanan tertahan tidak diklaim sudah lunas",
    tickets[0].settled === false && tickets[0].paidLabel === null,
    JSON.stringify(tickets[0]),
  );
  check(
    "tiket lunas membawa penanda pembayarannya",
    tickets[1].settled === true &&
      tickets[1].paidLabel === "Lunas Tunai · diterima dapur pukul 13:42",
    JSON.stringify(tickets[1]),
  );
  check(
    "tiket lunas tetap membawa meja & itemnya",
    tickets[1].tableName === "A1" && tickets[1].itemCount === 2,
    JSON.stringify(tickets[1]),
  );
}

// ------------------- notifikasi tagihan QR baru di kartu antrean dapur
//
// Yang diuji di sini adalah **kapan** dapur boleh diberi tahu: sekali per
// tagihan, hanya untuk yang baru datang, dan tidak untuk keadaan lama yang sudah
// ada sebelum layarnya dilihat. Bunyinya sendiri diuji di
// `verify-scan-beep.mjs`, dan tampilannya di `verify-render.mjs`.
{
  check(
    "kilatnya lebih pendek dari batas “masih baru” — tanda sesaat, bukan keadaan permanen",
    KDS_ALERT_FLASH_MS > 0 && KDS_ALERT_WINDOW_MS > KDS_ALERT_FLASH_MS,
    `kilat ${KDS_ALERT_FLASH_MS} ms · baru ${KDS_ALERT_WINDOW_MS} ms`,
  );

  const baru = { id: "meja-1", createdAt: NOW - 1000 };
  const lama = { id: "meja-0", createdAt: NOW - KDS_ALERT_WINDOW_MS - 1 };
  const pesanKedua = { id: "meja-2", createdAt: NOW - 500 };

  const rencanaPertama = planKdsAlert([], [baru, pesanKedua], NOW);
  check(
    "tagihan yang belum pernah dilihat & masih baru diberitahukan",
    rencanaPertama.freshIds.length === 2 &&
      rencanaPertama.freshIds[0] === "meja-1" &&
      rencanaPertama.freshIds[1] === "meja-2",
    JSON.stringify(rencanaPertama),
  );
  check(
    "tagihan yang sudah menunggu lama tidak membunyikan alarm saat layar dibuka",
    planKdsAlert([], [lama], NOW).freshIds.length === 0,
    JSON.stringify(planKdsAlert([], [lama], NOW)),
  );
  check(
    "tagihan yang sudah dilihat tidak diberitahukan lagi walau masih menunggu",
    planKdsAlert(["meja-1", "meja-2"], [baru, pesanKedua], NOW).freshIds.length === 0,
    JSON.stringify(planKdsAlert(["meja-1", "meja-2"], [baru, pesanKedua], NOW)),
  );
  check(
    "daftar “sudah dilihat” datang dari keadaan sekarang, bukan dari id lama",
    planKdsAlert(["meja-1", "meja-2"], [pesanKedua], NOW).seenIds.join(",") === "meja-2",
    JSON.stringify(planKdsAlert(["meja-1", "meja-2"], [pesanKedua], NOW)),
  );
  check(
    "“sudah dilihat” boleh Set maupun larik — hasilnya sama",
    JSON.stringify(planKdsAlert(new Set(["meja-1"]), [baru, pesanKedua], NOW)) ===
      JSON.stringify(planKdsAlert(["meja-1"], [baru, pesanKedua], NOW)),
    JSON.stringify(planKdsAlert(new Set(["meja-1"]), [baru, pesanKedua], NOW)),
  );
  check(
    "tanpa tagihan menunggu tidak ada yang diberitahukan",
    planKdsAlert(["meja-1"], [], NOW).freshIds.length === 0 &&
      planKdsAlert(["meja-1"], [], NOW).seenIds.length === 0,
    JSON.stringify(planKdsAlert(["meja-1"], [], NOW)),
  );
  check(
    "urutan pemberitahuannya dari yang paling lama menunggu",
    planKdsAlert([], [pesanKedua, baru], NOW).freshIds[0] === "meja-1",
    JSON.stringify(planKdsAlert([], [pesanKedua, baru], NOW)),
  );
  check(
    "tepat di batas umurnya tagihan masih disebut baru",
    planKdsAlert([], [{ id: "meja-3", createdAt: NOW - KDS_ALERT_WINDOW_MS }], NOW)
      .freshIds.length === 1,
    JSON.stringify(
      planKdsAlert([], [{ id: "meja-3", createdAt: NOW - KDS_ALERT_WINDOW_MS }], NOW),
    ),
  );

  check(
    "kilat menyala hanya selama jendelanya, lalu padam sendiri",
    isKdsAlertFlashing(NOW, NOW) === true &&
      isKdsAlertFlashing(NOW, NOW + KDS_ALERT_FLASH_MS - 1) === true &&
      isKdsAlertFlashing(NOW, NOW + KDS_ALERT_FLASH_MS) === false,
    `${isKdsAlertFlashing(NOW, NOW)} / ${isKdsAlertFlashing(NOW, NOW + KDS_ALERT_FLASH_MS)}`,
  );
  check(
    "tanpa notifikasi (atau jam perangkat mundur) kilatnya tidak menyala",
    isKdsAlertFlashing(null, NOW) === false &&
      isKdsAlertFlashing(undefined, NOW) === false &&
      isKdsAlertFlashing(NOW + 5000, NOW) === false,
    `${isKdsAlertFlashing(null, NOW)} / ${isKdsAlertFlashing(NOW + 5000, NOW)}`,
  );
  check(
    "kalimat tandanya menyebut jumlahnya, tetap terbaca di angka satu",
    kdsAlertLabel(1) === "1 tagihan QR baru masuk" &&
      kdsAlertLabel(3) === "3 tagihan QR baru masuk",
    `${kdsAlertLabel(1)} · ${kdsAlertLabel(3)}`,
  );
  check(
    "jumlah yang tidak masuk akal tidak menghasilkan kalimat aneh",
    kdsAlertLabel(0) === "0 tagihan QR baru masuk" &&
      kdsAlertLabel(-2) === "0 tagihan QR baru masuk" &&
      kdsAlertLabel(Number.NaN) === "0 tagihan QR baru masuk",
    `${kdsAlertLabel(0)} · ${kdsAlertLabel(-2)} · ${kdsAlertLabel(Number.NaN)}`,
  );
}

console.log(`${results.length}/${results.length} checks passed`);

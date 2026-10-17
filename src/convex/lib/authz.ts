/**
 * Authorization model — the single definition of what each role may do.
 *
 * It lives inside the functions directory because Convex only bundles modules
 * under `src/convex` (see convex.json), and the backend must be able to import
 * exactly the same table the UI gates on. `src/lib/authz.ts` re-exports it so
 * app code imports a stable path.
 *
 * Roles match the `memberships.role` union in schema.ts.
 */

export type Role = "owner" | "manager" | "cashier" | "inventory" | "finance";

export type Permission =
  | "pos.sell"
  | "pos.void"
  /** Bekerja di layar dapur (KDS): membaca antrean & menandai tiket selesai. */
  | "kds.manage"
  /** Membuka & menutup shift kas (kas awal, setoran, Z-report) dan kabarnya. */
  | "shift.manage"
  | "product.manage"
  /** Mengelola kategori produk: struktur katalog, bukan isi rak. */
  | "category.manage"
  | "stock.adjust"
  | "report.view"
  | "billing.manage"
  | "device.manage"
  | "team.manage"
  | "table.manage"
  /** Melihat piutang & sisa limit kredit pelanggan (modul Grosir). */
  | "ar.view"
  /** Mengelola pelanggan, limit kredit, dan penerimaan piutang. */
  | "ar.manage"
  /** Melihat daftar member (modul UMKM). */
  | "member.view"
  /** Mengelola member beserta persentase diskonnya. */
  | "member.manage"
  /** Melihat stok per gudang & daftar lokasi (Phase 3). */
  | "inventory.view"
  /** Mengelola gudang dan memindahkan stok antar lokasi. */
  | "inventory.manage"
  /** Melihat dokumen pembelian: supplier, PR, PO, GRN (Phase 3). */
  | "purchase.view"
  /** Mengajukan permintaan pembelian (PR). */
  | "purchase.request"
  /** Menyetujui PR, membuat PO, dan membatalkan PO. */
  | "purchase.approve"
  /** Menerima barang (GRN) — satu-satunya jalur yang menggerakkan stok masuk. */
  | "purchase.receive"
  /** Melihat hutang usaha (tagihan supplier) beserta umurnya. */
  | "payable.view"
  /** Mencatat tagihan supplier dan membayar hutang usaha. */
  | "payable.manage"
  /** Mengelola kunci API tenant & langganan webhook (`api.access`, Phase 4). */
  | "api.manage"
  /** Melihat tiket dukungan beserta status SLA-nya (`support.dedicated`). */
  | "support.view"
  /** Membuka, mencatat, dan menutup tiket dukungan (`support.dedicated`). */
  | "support.manage"
  /** Melihat tagihan pembayaran digital QRIS/VA (`payment.digital`, Phase 6). */
  | "payment.view"
  /** Membuat tagihan digital, menandai lunas, dan membatalkannya. */
  | "payment.manage";

export const ROLES: Role[] = ["owner", "manager", "cashier", "inventory", "finance"];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Pemilik",
  manager: "Manajer",
  cashier: "Kasir",
  inventory: "Staf Gudang",
  finance: "Keuangan",
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  "pos.sell": "Melakukan penjualan",
  "pos.void": "Membatalkan transaksi",
  "kds.manage": "Bekerja di layar dapur (KDS)",
  "shift.manage": "Membuka & menutup shift kas",
  "product.manage": "Mengelola produk",
  "category.manage": "Mengelola kategori produk",
  "stock.adjust": "Menyesuaikan stok",
  "report.view": "Melihat laporan",
  "billing.manage": "Mengelola langganan",
  "device.manage": "Mengelola perangkat",
  "team.manage": "Mengelola tim",
  "table.manage": "Mengelola denah meja",
  "ar.view": "Melihat piutang & limit kredit",
  "ar.manage": "Mengelola pelanggan, limit kredit & penerimaan piutang",
  "member.view": "Melihat data member",
  "member.manage": "Mengelola member & diskon",
  "inventory.view": "Melihat stok per gudang",
  "inventory.manage": "Mengelola gudang & memindahkan stok",
  "purchase.view": "Melihat pembelian (PR · PO · GRN)",
  "purchase.request": "Mengajukan permintaan pembelian",
  "purchase.approve": "Menyetujui PR & membuat PO",
  "purchase.receive": "Menerima barang (GRN)",
  "payable.view": "Melihat hutang usaha",
  "payable.manage": "Mencatat tagihan & membayar hutang supplier",
  "api.manage": "Mengelola kunci API & webhook",
  "support.view": "Melihat tiket dukungan & status SLA",
  "support.manage": "Membuka & menutup tiket dukungan",
  "payment.view": "Melihat tagihan pembayaran digital",
  "payment.manage": "Menagih & melunasi pembayaran digital",
};

const ALL_PERMISSIONS: Permission[] = [
  "pos.sell",
  "pos.void",
  "kds.manage",
  "shift.manage",
  "product.manage",
  "category.manage",
  "stock.adjust",
  "report.view",
  "billing.manage",
  "device.manage",
  "team.manage",
  "table.manage",
  "ar.view",
  "ar.manage",
  "member.view",
  "member.manage",
  "inventory.view",
  "inventory.manage",
  "purchase.view",
  "purchase.request",
  "purchase.approve",
  "purchase.receive",
  "payable.view",
  "payable.manage",
  "api.manage",
  "support.view",
  "support.manage",
  "payment.view",
  "payment.manage",
];

/**
 * Deliberate separations of duty:
 *  - a cashier can sell but NOT void: reversing a sale silently is how till
 *    fraud happens, so it needs a manager's approval.
 *  - inventory staff can move stock but cannot sell or see money.
 *  - finance sees money and the subscription but cannot touch stock.
 *  - a cashier sells and seats guests, but does not redesign the floor plan.
 *  - piutang B2B is split in two: a cashier may *see* a customer's remaining
 *    credit limit (otherwise they would oversell on credit), but only a
 *    manager/owner/finance may change the limit or record a collection — the
 *    same person who sells does not get to extend credit.
 *  - diskon member mengikuti pemisahan yang sama: kasir memakai diskon yang
 *    sudah ditetapkan (`member.view`), tetapi yang menentukan besarnya diskon
 *    adalah pemilik/manajer (`member.manage`) — diskon adalah keputusan margin,
 *    bukan keputusan meja kasir.
 *  - gudang (Phase 3) hanya untuk yang memang bekerja dengan stok: kasir
 *    **menjual** barang, bukan memindahkan stok antar gudang, dan keuangan
 *    melihat uang, bukan rak — keduanya tidak memegang izin `inventory.*`.
 *  - pembelian (Phase 3) dipisah tiga: staf gudang **meminta** (`purchase.request`),
 *    pemilik/manajer **menyetujui & memesan** (`purchase.approve`), dan staf gudang
 *    **menerima** barangnya (`purchase.receive`). Yang meminta bukan yang menyetujui —
 *    itu inti dari adanya PR; keuangan hanya melihat dokumennya (`purchase.view`).
 *  - hutang usaha (Phase 3) adalah urusan uang, bukan rak: yang **membayar** supplier
 *    adalah keuangan/pemilik/manajer (`payable.manage`), sementara staf gudang yang
 *    menerima barang **tidak** memegangnya — menerima barang dan membayarnya adalah
 *    dua hal berbeda, dan pencocokan tagihan (3-way matching) menyusul.
 *  - akses API (Phase 4) adalah urusan **integrasi**, bukan kasir: kasir tidak
 *    membutuhkannya, keuangan tidak memegangnya (dia memakai aplikasi, bukan
 *    membuat kunci), dan yang memegangnya adalah pemilik/manajer (`api.manage`).
 *    Kunci API sendiri tetap dibatasi: scope-nya tidak boleh melebihi izin
 *    pembuatnya, dan peran pembuat yang diturunkan langsung mempersempit kunci
 *    yang pernah dibuatnya (lihat lib/apiKeys.ts).
 *  - dukungan khusus (Phase 5) dipisah supaya jawaban pelanggan tidak menunggu
 *    kasir: keuangan **melihat** tiket (banyak tiket soal tagihan & pembayaran),
 *    tetapi yang **membuka & menutup** tiket adalah pemilik/manajer
 *    (`support.manage`). Kasir dan staf gudang menyampaikan masalah lewat
 *    orang yang memegangnya, bukan lewat antrean janji SLA.
 *  - kategori produk (struktur katalog) bukan pekerjaan rak: staf gudang memang
 *    mengelola **produk** (`product.manage`), tetapi kategori menentukan kode di
 *    tengah SKU & susunan tab POS, jadi yang mengaturnya adalah pemilik/manajer
 *    (`category.manage`). Menonaktifkan kategori pun tidak menghapus data, ia
 *    hanya menutup pemakaiannya untuk produk baru.
 *  - pembayaran digital (Phase 6) dipisah dari **void**, bukan dari kasir: kasir
 *    memang menagih di meja — membuat tagihan QRIS/VA dan menandai lunas — sebab
 *    itu memang pekerjaannya, dan keuangan ikut memegangnya karena rekonsiliasi
 *    bank adalah pekerjaannya. Yang menjaga uang bukan izinnya, melainkan aturan
 *    transisi: tagihan yang **sudah lunas atau kedaluwarsa tidak bisa dibatalkan**
 *    atau dibalik oleh satu tombol di halaman.
 *  - dapur (KDS) dan shift kas punya izinnya sendiri, tidak lagi menumpang
 *    `pos.sell`: yang bekerja di antrean dapur adalah `kds.manage`, dan yang
 *    membuka/menutup kas adalah `shift.manage`. Dua hal yang perlu diketahui
 *    merchant: (a) dapur tidak perlu bisa menjual untuk bekerja — peran “dapur
 *    saja” cukup `kds.manage`; (b) **penjualan menuntut shift terbuka**, jadi
 *    siapa pun yang menjual (kasir) harus memegang keduanya — itulah mengapa
 *    peran bawaan Kasir & Manajer memuat `pos.sell` + `shift.manage`. Yang tetap
 *    **tidak** ikut: staf gudang dan keuangan (keduanya memang tidak melihat
 *    antrean dapur maupun memegang kas fisik).
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [...ALL_PERMISSIONS],
  manager: [
    "pos.sell",
    "pos.void",
    "kds.manage",
    "shift.manage",
    "product.manage",
    "category.manage",
    "stock.adjust",
    "report.view",
    "device.manage",
    "team.manage",
    "table.manage",
    "ar.view",
    "ar.manage",
    "member.view",
    "member.manage",
    "inventory.view",
    "inventory.manage",
    "purchase.view",
    "purchase.request",
    "purchase.approve",
    "purchase.receive",
    "payable.view",
    "payable.manage",
    "api.manage",
    "support.view",
    "support.manage",
    "payment.view",
    "payment.manage",
  ],
  cashier: [
    "pos.sell",
    // Antrean dapur & kas meja memang pekerjaan kasir di toko kecil: dapur
    // perlu bisa ditandai selesai, dan kasnya dipegang kasir sendiri. Peran
    // “dapur saja” atau “kas saja” dibuat lewat peran kustom bila toko
    // memisahkannya.
    "kds.manage",
    "shift.manage",
    "report.view",
    "ar.view",
    "member.view",
    // Menagih di meja: membuat tagihan QRIS/VA dan menandai lunas. Membatalkan
    // tagihan yang sudah lunas tetap ditolak aturan transisi, bukan izinnya.
    "payment.view",
    "payment.manage",
  ],
  inventory: [
    "product.manage",
    "stock.adjust",
    "report.view",
    "inventory.view",
    "inventory.manage",
    "purchase.view",
    "purchase.request",
    "purchase.receive",
  ],
  finance: [
    "report.view",
    "billing.manage",
    "ar.view",
    "ar.manage",
    "member.view",
    "purchase.view",
    "payable.view",
    "payable.manage",
    // Melihat tiket — bukan membukanya: banyak tiket soal tagihan memang
    // urusan keuangan, tetapi janji SLA tetap dipegang pemilik/manajer.
    "support.view",
    // Rekonsiliasi bank memang pekerjaan keuangan: tagihan digital yang masuk
    // harus bisa dicocokkan dan ditandai lunas dari sini.
    "payment.view",
    "payment.manage",
  ],
};

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function can(role: Role, permission: Permission): boolean {
  // Defensive: an unknown role (stale session, hand-written row) grants nothing
  // rather than throwing halfway through a request.
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

export function isRole(value: string): value is Role {
  return (ROLES as string[]).includes(value);
}

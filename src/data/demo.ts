/**
 * Demo dataset for the un-wired UI. Replaced by Convex queries once the
 * deployment is connected — shapes intentionally mirror the planned schema
 * (integer rupiah, product.stock as a derived level).
 */

import type { Permission, Role } from "@/lib/authz";
import type {
  DigitalMethod,
  DigitalStatus,
  VaBank,
} from "@/lib/payments";
import type {
  PushOutcome,
  SyncEntity,
  SyncPlatform,
} from "@/lib/sync";
import type {
  SupportCategory,
  SupportPriority,
  SupportStatus,
} from "@/lib/support";

export interface DemoModifierGroup {
  code: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: { code: string; name: string; price: number }[];
}

export interface DemoProduct {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
  /** Satuan dasar + konversi satuan besar (modul Grosir). */
  unit?: string;
  units?: { code: string; factor: number }[];
  /** Harga bertingkat per satuan dasar (modul Grosir). */
  tiers?: { minQty: number; price: number }[];
  /** Modifier item (modul F&B): level pedas, topping, ukuran. */
  modifiers?: DemoModifierGroup[];
}

export const CATEGORIES = [
  "Semua",
  "Kopi",
  "Makanan",
  "Snack",
  "Minuman",
] as const;

export const PRODUCTS: DemoProduct[] = [
  { id: "p01", name: "Kopi Susu Gula Aren", price: 22000, category: "Kopi", stock: 48 },
  { id: "p03", name: "Cappuccino", price: 28000, category: "Kopi", stock: 22 },
  { id: "p04", name: "Kopi Hitam", price: 18000, category: "Kopi", stock: 40 },
  {
    // Contoh modifier F&B: level pedas **wajib** dipilih, topping opsional
    // berbayar — dipakai untuk mencoba fitur `pos.modifier` di demo.
    id: "p05",
    name: "Nasi Goreng Spesial",
    price: 27000,
    category: "Makanan",
    stock: 18,
    modifiers: [
      {
        code: "PEDAS",
        name: "Level pedas",
        minSelect: 1,
        maxSelect: 1,
        options: [
          { code: "1", name: "Pedas 1", price: 0 },
          { code: "2", name: "Pedas 2", price: 0 },
          { code: "3", name: "Pedas 3", price: 0 },
        ],
      },
      {
        code: "TOPPING",
        name: "Topping",
        minSelect: 0,
        maxSelect: 2,
        options: [
          { code: "TELUR", name: "Telur", price: 5000 },
          { code: "KEJU", name: "Keju", price: 7000 },
          { code: "BAKSO", name: "Bakso", price: 6000 },
        ],
      },
    ],
  },
  { id: "p06", name: "Mie Ayam", price: 25000, category: "Makanan", stock: 15 },
  { id: "p07", name: "Ayam Geprek", price: 26000, category: "Makanan", stock: 12 },
  {
    // Modifier tanpa tambahan harga: ukuran gelas (pilihan tunggal).
    id: "p02",
    name: "Es Kopi Susu",
    price: 24000,
    category: "Kopi",
    stock: 36,
    modifiers: [
      {
        code: "UKURAN",
        name: "Ukuran",
        minSelect: 1,
        maxSelect: 1,
        options: [
          { code: "REG", name: "Regular", price: 0 },
          { code: "LARGE", name: "Large", price: 4000 },
        ],
      },
    ],
  },
  { id: "p08", name: "Roti Bakar", price: 15000, category: "Makanan", stock: 20 },
  { id: "p09", name: "Croissant", price: 18000, category: "Snack", stock: 4 },
  { id: "p10", name: "Kentang Goreng", price: 17000, category: "Snack", stock: 16 },
  { id: "p11", name: "Es Teh Manis", price: 8000, category: "Minuman", stock: 60 },
  {
    // Contoh produk grosir: dijual per Pcs atau per Dus (24 Pcs), dan mulai 24
    // Pcs harganya turun ke 4.500 — dipakai untuk mencoba modul Grosir di demo.
    id: "p12",
    name: "Air Mineral",
    price: 5000,
    category: "Minuman",
    stock: 72,
    unit: "PCS",
    units: [{ code: "DUS", factor: 24 }],
    tiers: [{ minQty: 24, price: 4500 }],
  },
  { id: "p13", name: "Matcha Latte", price: 30000, category: "Minuman", stock: 0 },
];

/** Denah meja contoh untuk modul F&B (satu meja sengaja nonaktif). */
export interface DemoTable {
  id: string;
  name: string;
  zone: string;
  seats: number;
  active: boolean;
}

export const TABLES: DemoTable[] = [
  { id: "t01", name: "A1", zone: "Utama", seats: 4, active: true },
  { id: "t02", name: "A2", zone: "Utama", seats: 4, active: true },
  { id: "t03", name: "A3", zone: "Utama", seats: 2, active: true },
  { id: "t04", name: "B1", zone: "Teras", seats: 6, active: true },
  { id: "t05", name: "B2", zone: "Teras", seats: 4, active: true },
  { id: "t06", name: "VIP", zone: "Lantai 2", seats: 10, active: false },
];

/**
 * Pelanggan B2B contoh (modul Grosir). `creditLimit` 0 = tunai saja; limit > 0
 * memakai tempo `paymentTermDays` hari.
 */
export interface DemoCustomer {
  id: string;
  code: string;
  name: string;
  phone?: string;
  creditLimit: number;
  paymentTermDays: number;
  active: boolean;
}

export const CUSTOMERS: DemoCustomer[] = [
  {
    id: "c01",
    code: "TBJ",
    name: "Toko Berkah Jaya",
    phone: "+6281234567890",
    creditLimit: 5_000_000,
    paymentTermDays: 30,
    active: true,
  },
  {
    id: "c02",
    code: "WSM",
    name: "Warung Sederhana",
    phone: "+6281298765432",
    creditLimit: 2_000_000,
    paymentTermDays: 14,
    active: true,
  },
  { id: "c03", code: "UMUM", name: "Pelanggan Umum", creditLimit: 0, paymentTermDays: 0, active: true },
];

/**
 * Nota piutang contoh. Jatuh tempo disimpan sebagai **selisih hari dari hari
 * ini** supaya demo selalu punya contoh yang jatuh tempo tanpa tanggal basi.
 */
export interface DemoReceivable {
  id: string;
  number: string;
  customerId: string;
  saleNumber?: string;
  amount: number;
  paidAmount: number;
  /** Negatif berarti sudah lewat jatuh tempo. */
  dueOffsetDays: number;
  status: "open" | "paid" | "void";
}

export const RECEIVABLES: DemoReceivable[] = [
  {
    id: "ar01",
    number: "AR-00001",
    customerId: "c01",
    saleNumber: "A-1038",
    amount: 1_200_000,
    paidAmount: 300_000,
    dueOffsetDays: -6,
    status: "open",
  },
  {
    id: "ar02",
    number: "AR-00002",
    customerId: "c02",
    saleNumber: "A-1040",
    amount: 450_000,
    paidAmount: 0,
    dueOffsetDays: 20,
    status: "open",
  },
];

/**
 * Member pelanggan contoh (modul UMKM, fitur `member.discount`). `discountPct`
 * adalah diskon tetap per transaksi; satu member sengaja nonaktif untuk menguji
 * aturan "member nonaktif tidak mendapat diskon".
 */
export interface DemoMember {
  id: string;
  code: string;
  name: string;
  phone?: string;
  discountPct: number;
  active: boolean;
}

export const MEMBERS: DemoMember[] = [
  {
    id: "m01",
    code: "BSW",
    name: "Bu Sari Wulandari",
    phone: "+6281234567890",
    discountPct: 5,
    active: true,
  },
  { id: "m02", code: "AG", name: "Agus Setiawan", phone: "+6281298765432", discountPct: 10, active: true },
  { id: "m03", code: "RINA", name: "Rina Kartika", discountPct: 0, active: true },
  { id: "m04", code: "LAMA", name: "Member Lama", phone: "+628110000000", discountPct: 15, active: false },
];

/**
 * Supplier contoh (Phase 3, `purchasing.basic`). Satu sengaja nonaktif untuk
 * menguji aturan "supplier nonaktif tidak bisa dipakai membuat PO".
 */
export interface DemoSupplier {
  id: string;
  code: string;
  name: string;
  phone?: string;
  address?: string;
  paymentTermDays: number;
  active: boolean;
}

export const SUPPLIERS: DemoSupplier[] = [
  {
    id: "sup01",
    code: "PSR",
    name: "PT Sumber Rejeki",
    phone: "+62215550123",
    address: "Kawasan Industri Pulogadung",
    paymentTermDays: 30,
    active: true,
  },
  {
    id: "sup02",
    code: "KAB",
    name: "Koperasi Bahan Baku",
    phone: "+62215550888",
    paymentTermDays: 14,
    active: true,
  },
  { id: "sup03", code: "LAMA", name: "Supplier Lama", paymentTermDays: 7, active: false },
];

/**
 * Tagihan supplier contoh (hutang usaha). Jatuh tempo disimpan sebagai
 * **selisih hari dari hari ini** (negatif = sudah lewat) supaya demo selalu punya
 * contoh yang jatuh tempo tanpa tanggal basi — sama seperti nota piutang.
 *
 * Satu tagihan sengaja sudah lewat jatuh tempo: halaman Pembelian harus
 * menunjukkannya, dan supplier itu memang tidak boleh diberi PO baru.
 */
export interface DemoPayable {
  id: string;
  number: string;
  supplierId: string;
  reference?: string;
  orderNumber?: string;
  receiptNumber?: string;
  amount: number;
  paidAmount: number;
  dueOffsetDays: number;
  paymentTermDays: number;
  status: "open" | "paid" | "void";
  note?: string;
  /**
   * Dokumen supplier yang dicocokkan dengan PO & penerimaan (3-way matching).
   * Barisnya adalah yang **ditagih supplier** — sengaja boleh berbeda dari
   * penerimaan, karena justru selisih itu yang dicari.
   */
  invoice?: {
    reference: string;
    note?: string;
    recordedDaysAgo: number;
    lines: { productId: string; quantity: number; unitCost: number }[];
  };
}

export const PAYABLES: DemoPayable[] = [
  {
    id: "ap01",
    number: "AP-00001",
    supplierId: "sup01",
    reference: "INV/PSR/2026/0912",
    orderNumber: "PO-00001",
    receiptNumber: "GRN-00001",
    amount: 1_450_000,
    paidAmount: 0,
    dueOffsetDays: 20,
    paymentTermDays: 30,
    status: "open",
    note: "Bahan baku kering",
    // Supplier menagih 12 Es Teh Manis padahal yang diterima 10 — contoh selisih
    // yang harus diputuskan pemilik/keuangan sebelum tagihannya dibayar.
    invoice: {
      reference: "INV/PSR/2026/0912",
      note: "Selisih 2 Es Teh Manis",
      recordedDaysAgo: 25,
      lines: [
        { productId: "p01", quantity: 100, unitCost: 14_000 },
        { productId: "p11", quantity: 12, unitCost: 5_000 },
      ],
    },
  },
  {
    id: "ap02",
    number: "AP-00002",
    supplierId: "sup02",
    orderNumber: "PO-00002",
    receiptNumber: "GRN-00002",
    amount: 860_000,
    paidAmount: 300_000,
    dueOffsetDays: 5,
    paymentTermDays: 14,
    status: "open",
  },
  {
    id: "ap03",
    number: "AP-00003",
    supplierId: "sup02",
    reference: "KB/2026/118",
    amount: 240_000,
    paidAmount: 0,
    dueOffsetDays: -45,
    paymentTermDays: 0,
    status: "open",
    note: "Tagihan jasa angkut",
  },
  {
    id: "ap04",
    number: "AP-00004",
    supplierId: "sup03",
    reference: "LAMA/2025/77",
    amount: 175_000,
    paidAmount: 0,
    dueOffsetDays: -120,
    paymentTermDays: 7,
    status: "open",
    note: "Sisa tagihan supplier lama",
  },
];

/**
 * Pesanan pembelian contoh: dua PO yang barangnya sudah sebagian datang.
 *
 * Dokumen ini ada di demo karena **pencocokan 3 arah butuh ketiganya**: tanpa PO
 * dan GRN, tagihan supplier tidak punya pembanding dan halaman Pembelian hanya
 * bisa bilang "tidak ada yang dicocokkan".
 */
export interface DemoOrder {
  id: string;
  number: string;
  supplierId: string;
  status: "open" | "partial" | "received" | "cancelled";
  note?: string;
  /** Berapa hari yang lalu PO dibuat. */
  createdDaysAgo: number;
  lines: { productId: string; quantity: number; unitCost: number; receivedQty: number }[];
}

export const ORDERS: DemoOrder[] = [
  {
    id: "po01",
    number: "PO-00001",
    supplierId: "sup01",
    status: "partial",
    note: "Bahan baku kering",
    createdDaysAgo: 32,
    lines: [
      { productId: "p01", quantity: 120, unitCost: 14_000, receivedQty: 100 },
      { productId: "p11", quantity: 40, unitCost: 5_000, receivedQty: 10 },
    ],
  },
  {
    id: "po02",
    number: "PO-00002",
    supplierId: "sup02",
    status: "partial",
    createdDaysAgo: 12,
    lines: [{ productId: "p04", quantity: 60, unitCost: 21_500, receivedQty: 40 }],
  },
];

/** Penerimaan barang (GRN) contoh — nilai masuk yang jadi pembanding tagihan. */
export interface DemoReceipt {
  id: string;
  number: string;
  orderId: string;
  orderNumber: string;
  note?: string;
  total: number;
  createdDaysAgo: number;
  lines: { productId: string; quantity: number; unitCost: number }[];
}

export const RECEIPTS: DemoReceipt[] = [
  {
    id: "grn01",
    number: "GRN-00001",
    orderId: "po01",
    orderNumber: "PO-00001",
    note: "Surat jalan 1",
    total: 1_450_000,
    createdDaysAgo: 30,
    lines: [
      { productId: "p01", quantity: 100, unitCost: 14_000 },
      { productId: "p11", quantity: 10, unitCost: 5_000 },
    ],
  },
  {
    id: "grn02",
    number: "GRN-00002",
    orderId: "po02",
    orderNumber: "PO-00002",
    note: "Kedatangan pertama",
    total: 860_000,
    createdDaysAgo: 10,
    lines: [{ productId: "p04", quantity: 40, unitCost: 21_500 }],
  },
];

/**
 * Permintaan pembelian contoh: satu masih menunggu keputusan, supaya halaman
 * Pembelian tidak kosong saat dilihat pertama kali.
 */
export interface DemoRequisition {
  id: string;
  number: string;
  status: "submitted" | "approved" | "rejected";
  note?: string;
  lines: { productId: string; quantity: number; note?: string }[];
  /** Berapa jam yang lalu dibuat. */
  createdHoursAgo: number;
}

export const REQUISITIONS: DemoRequisition[] = [
  {
    id: "pr01",
    number: "PR-00001",
    status: "submitted",
    note: "Stok rak depan menipis",
    lines: [
      { productId: "p01", quantity: 24 },
      { productId: "p11", quantity: 48, note: "untuk shift pagi" },
    ],
    createdHoursAgo: 3,
  },
];

/**
 * Lokasi stok contoh (Phase 3, `inventory.multiwarehouse`). Lokasi jual toko
 * tidak didaftarkan di sini karena selalu ada secara implisit.
 */
export interface DemoWarehouse {
  id: string;
  code: string;
  name: string;
  address?: string;
  active: boolean;
}

export const WAREHOUSES: DemoWarehouse[] = [
  { id: "w01", code: "GD-A", name: "Gudang Utama", address: "Jl. Sudirman 12", active: true },
  { id: "w02", code: "GD-B", name: "Gudang Cabang", active: true },
  { id: "w03", code: "GD-LAMA", name: "Gudang Lama", active: false },
];

/**
 * Stok yang disimpan di gudang (bukan lokasi jual), bentuknya
 * productId → warehouseId → jumlah. Produk yang tidak ada di sini berarti
 * stok gudangnya nol.
 */
export const WAREHOUSE_STOCK: Record<string, Record<string, number>> = {
  p01: { w01: 120, w02: 24 },
  p04: { w01: 60 },
  p11: { w01: 240 },
  p12: { w01: 480, w02: 96 },
};

/**
 * Sesi stock opname contoh (Phase 3, `inventory.opname`).
 *
 * Satu sesi masih **berjalan** di gudang (dengan satu baris sengaja belum
 * dihitung, supaya halaman menunjukkan bahwa baris yang belum dihitung bukan
 * nol), dan satu sesi sudah **selesai** di lokasi jual sebagai riwayat.
 */
export interface DemoOpnameLine {
  productId: string;
  /** Saldo sistem saat sesi dimulai. */
  systemQty: number;
  /** Kosong = belum dihitung. */
  countedQty?: number;
  note?: string;
}

export interface DemoOpnameSession {
  id: string;
  number: string;
  /** `default` = lokasi jual toko. */
  locationId: string;
  status: "draft" | "posted" | "cancelled";
  note?: string;
  lines: DemoOpnameLine[];
  /** Berapa jam yang lalu sesi dimulai. */
  startedHoursAgo: number;
}

export const OPNAME_SESSIONS: DemoOpnameSession[] = [
  {
    id: "op01",
    number: "OPN-00001",
    locationId: "default",
    status: "posted",
    note: "Cek harian rak depan",
    lines: [
      { productId: "p09", systemQty: 4, countedQty: 3, note: "1 rusak" },
      { productId: "p13", systemQty: 0, countedQty: 0 },
    ],
    startedHoursAgo: 30,
  },
  {
    id: "op02",
    number: "OPN-00002",
    locationId: "w01",
    status: "draft",
    note: "Opname bulanan gudang",
    lines: [
      { productId: "p01", systemQty: 120, countedQty: 118 },
      { productId: "p04", systemQty: 60, countedQty: 60 },
      { productId: "p11", systemQty: 240 },
      { productId: "p12", systemQty: 480, countedQty: 470, note: "2 dus penyok" },
    ],
    startedHoursAgo: 5,
  },
];

export type PaymentMethod = "Tunai" | "QRIS" | "Kartu";

export interface DemoSale {
  id: string;
  number: string;
  at: string;
  method: PaymentMethod;
  itemCount: number;
  total: number;
}

export const RECENT_SALES: DemoSale[] = [
  { id: "s1", number: "A-1042", at: "13:42", method: "QRIS", itemCount: 3, total: 62000 },
  { id: "s2", number: "A-1041", at: "13:28", method: "Tunai", itemCount: 2, total: 40000 },
  { id: "s3", number: "A-1040", at: "13:05", method: "QRIS", itemCount: 5, total: 118000 },
  { id: "s4", number: "A-1039", at: "12:51", method: "Tunai", itemCount: 1, total: 22000 },
  { id: "s5", number: "A-1038", at: "12:34", method: "Kartu", itemCount: 4, total: 96000 },
  { id: "s6", number: "A-1037", at: "12:10", method: "QRIS", itemCount: 2, total: 52000 },
];

/**
 * Peran kustom contoh (`rbac.custom`, Phase 4). Dua contoh sengaja berlawanan
 * sifat dengan peran bawaan: "Kasir shift malam" boleh menjual tetapi tidak
 * boleh membatalkan transaksi, dan "Admin harga" hanya menyentuh katalog.
 */
export interface DemoCustomRole {
  id: string;
  name: string;
  description?: string;
  permissions: Permission[];
  active: boolean;
}

export const CUSTOM_ROLES: DemoCustomRole[] = [
  {
    id: "role-malam",
    name: "Kasir Shift Malam",
    description: "Menjual dan menerima pembayaran tanpa bisa membatalkan transaksi.",
    permissions: ["pos.sell", "report.view"],
    active: true,
  },
  {
    id: "role-harga",
    name: "Admin Harga",
    description: "Merawat katalog & harga tanpa menyentuh uang kasir.",
    permissions: ["product.manage", "stock.adjust", "inventory.view"],
    active: true,
  },
];

/** Anggota tim contoh; `customRoleId` kosong = memakai peran bawaan. */
export interface DemoTeamMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  customRoleId?: string | null;
  active: boolean;
  /**
   * Jejak kirim undangan lewat email untuk anggota ini. Anggota contoh tidak
   * punya jejaknya (mereka “sudah ada” sebelum undangan tercatat), dan anggota
   * yang didaftarkan dari halaman mendapat `via: "demo"` — mode demo tidak
   * benar-benar mengirim email, dan itu dikatakan apa adanya di layar.
   */
  invite?: {
    sentAt: number;
    via: string;
    error: string | null;
    attempts: number;
  };
  /**
   * Nomor WhatsApp anggota (digit + kode negara) untuk undangan `wa.me`.
   * Bukan jalur masuk — masuknya tetap kode OTP ke email.
   */
  phone?: string | null;
  /** Berapa kali tautan undangan WhatsApp dibuka pengundang. */
  waInvite?: { at: number; count: number };
}

export const TEAM_MEMBERS: DemoTeamMember[] = [
  {
    membershipId: "mem-owner",
    userId: "u-owner",
    name: "Budi Santoso",
    email: "budi@kopi-nusantara.id",
    role: "owner",
    customRoleId: null,
    active: true,
  },
  {
    membershipId: "mem-sari",
    userId: "u-sari",
    name: "Sari Wulandari",
    email: "sari@kopi-nusantara.id",
    role: "cashier",
    customRoleId: "role-malam",
    active: true,
    phone: "6281234567890",
    waInvite: { at: Date.parse("2026-10-11T02:15:00Z"), count: 1 },
  },
  {
    membershipId: "mem-rizal",
    userId: "u-rizal",
    name: "Rizal Pratama",
    email: "rizal@kopi-nusantara.id",
    role: "inventory",
    customRoleId: null,
    active: true,
    phone: "628551234567",
  },
  {
    membershipId: "mem-dewi",
    userId: "u-dewi",
    name: "Dewi Lestari",
    email: "dewi@kopi-nusantara.id",
    role: "cashier",
    customRoleId: null,
    active: false,
  },
];

/**
 * Kunci API contoh (`api.access`, Phase 4).
 *
 * Yang disimpan di sini hanya `publicId` — bagian yang memang boleh tampil.
 * Rahasianya tidak pernah ada di data contoh, sama seperti di backend yang
 * hanya menyimpan hash-nya. Waktu disimpan sebagai offset supaya data contoh
 * tidak pernah "basi" (kunci yang kedaluwarsa tetap kedaluwarsa).
 */
export interface DemoApiKey {
  id: string;
  name: string;
  publicId: string;
  scopes: Permission[];
  creatorRole: Role;
  active: boolean;
  /** 0 = tanpa kedaluwarsa. */
  expiresInDays: number;
  /** null = belum pernah dipakai. */
  lastUsedDaysAgo: number | null;
  createdDaysAgo: number;
}

export const API_KEYS: DemoApiKey[] = [
  {
    id: "key-server",
    name: "Server produksi",
    publicId: "a9jcbf2jd6",
    scopes: ["report.view", "inventory.view", "payable.view"],
    creatorRole: "owner",
    active: true,
    expiresInDays: 90,
    lastUsedDaysAgo: 0,
    createdDaysAgo: 12,
  },
  {
    id: "key-dashboard",
    name: "Dashboard kasir lama",
    publicId: "k4mn7ptxze",
    scopes: ["report.view"],
    creatorRole: "manager",
    active: true,
    expiresInDays: 14,
    lastUsedDaysAgo: 3,
    createdDaysAgo: 70,
  },
  {
    id: "key-lama",
    name: "Integrasi toko lama",
    publicId: "r8wq2vhbmn",
    scopes: ["report.view", "inventory.view"],
    creatorRole: "owner",
    active: false,
    expiresInDays: 0,
    lastUsedDaysAgo: 40,
    createdDaysAgo: 120,
  },
];

/**
 * Endpoint webhook contoh. Rahasia penanda tangannya dibangkitkan saat store
 * dimuat (bukan disimpan di data contoh), dan hanya 4 karakter terakhirnya yang
 * ditampilkan — sama seperti baris `webhookEndpoints` di backend.
 */
export interface DemoWebhookEndpoint {
  id: string;
  url: string;
  description?: string;
  events: string[];
  active: boolean;
  createdDaysAgo: number;
}

export const WEBHOOK_ENDPOINTS: DemoWebhookEndpoint[] = [
  {
    id: "wh-gudang",
    url: "https://hooks.mesinpos.test/pos",
    description: "Gudang pusat: penjualan & stok menipis.",
    events: ["sale.completed", "stock.low", "opname.posted"],
    active: true,
    createdDaysAgo: 9,
  },
];

/** Riwayat kiriman contoh; satu menunggu, satu berhasil, satu menyerah. */
export interface DemoWebhookDelivery {
  id: string;
  endpointId: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  /** Menit dari sekarang sampai percobaan berikutnya; null = tidak ada lagi. */
  nextAttemptMinutes: number | null;
  createdMinutesAgo: number;
}

export const WEBHOOK_DELIVERIES: DemoWebhookDelivery[] = [
  {
    id: "whd-1",
    endpointId: "wh-gudang",
    event: "sale.completed",
    status: "delivered",
    attempts: 1,
    lastStatusCode: 200,
    lastError: null,
    nextAttemptMinutes: null,
    createdMinutesAgo: 18,
  },
  {
    id: "whd-2",
    endpointId: "wh-gudang",
    event: "stock.low",
    status: "pending",
    attempts: 2,
    lastStatusCode: 503,
    lastError: "Penerima menjawab 503.",
    nextAttemptMinutes: 12,
    createdMinutesAgo: 26,
  },
  {
    id: "whd-3",
    endpointId: "wh-gudang",
    event: "opname.posted",
    status: "failed",
    attempts: 5,
    lastStatusCode: null,
    lastError: "Host tujuan tidak bisa dihubungi.",
    nextAttemptMinutes: null,
    createdMinutesAgo: 600,
  },
];

/**
 * Tiket dukungan contoh (`support.dedicated`, Phase 5).
 *
 * Ketiganya sengaja mewakili tiga keadaan SLA yang berbeda: satu masih dalam
 * janji tanggap, satu **segera** jatuh tempo, dan satu sudah selesai **tepat
 * waktu** — supaya halaman tidak pernah hanya menampilkan satu warna status.
 * Waktu disimpan sebagai offset supaya data contoh tidak pernah basi.
 */
export interface DemoSupportTicket {
  id: string;
  number: string;
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  /** Jam tanggap yang dipatok saat tiket dibuat. */
  slaHours: number;
  escalated: boolean;
  body: string;
  log: { atMinutesAgo: number; kind: "note" | "status"; body: string }[];
  createdMinutesAgo: number;
  resolvedMinutesAgo?: number;
}

export const SUPPORT_TICKETS: DemoSupportTicket[] = [
  {
    id: "tkt-3",
    number: "TKT-2026-0003",
    subject: "Struk Bluetooth terputus di tengah transaksi",
    category: "bug",
    priority: "urgent",
    status: "in_progress",
    slaHours: 2,
    escalated: true,
    body:
      "Pencetak Bluetooth memutus sambungan saat transaksi ke-12 dan struk keluar setengah. Sudah dicoba mengganti kertas dan menyambung ulang perangkat.",
    log: [
      { atMinutesAgo: 100, kind: "status", body: "Tiket dibuat." },
      { atMinutesAgo: 84, kind: "status", body: "Mulai ditangani." },
      {
        atMinutesAgo: 80,
        kind: "status",
        body: "Dieskalasi ke manajer akun.",
      },
      {
        atMinutesAgo: 40,
        kind: "note",
        body:      "Menunggu hasil pengecekan log perangkat dari tim kasir.",
      },
    ],
    createdMinutesAgo: 100,
  },
  {
    id: "tkt-2",
    number: "TKT-2026-0002",
    subject: "Tagihan langganan bulan ini terlihat dobel",
    category: "payment",
    priority: "normal",
    status: "open",
    slaHours: 8,
    escalated: false,
    body:
      "Di halaman Langganan ada dua baris periode yang sama dengan nomor berbeda. Mohon diperiksa sebelum jatuh tempo tanggal 20.",
    log: [{ atMinutesAgo: 600, kind: "status", body: "Tiket dibuat." }],
    createdMinutesAgo: 600,
  },
  {
    id: "tkt-1",
    number: "TKT-2026-0001",
    subject: "Cara mengatur harga bertingkat untuk penjualan grosir",
    category: "howto",
    priority: "low",
    status: "resolved",
    slaHours: 16,
    escalated: false,
    body:
      "Kami ingin harga per kuantitas untuk pembeli grosir. Sudah mencoba menu Produk tetapi belum menemukan kolomnya.",
    log: [
      { atMinutesAgo: 3000, kind: "status", body: "Tiket dibuat." },
      { atMinutesAgo: 2700, kind: "status", body: "Mulai ditangani." },
      {
        atMinutesAgo: 2600,
        kind: "status",
        body: "Kolom harga bertingkat ada di Produk → Atur harga, dan menunya muncul saat modul Grosir aktif.",
      },
    ],
    createdMinutesAgo: 3000,
    resolvedMinutesAgo: 2600,
  },
];

/**
 * Cabang contoh untuk laporan lintas cabang (`scale.franchise`, Phase 5).
 *
 * Data contoh menyimpan baris penjualannya, bukan angka jadinya, supaya laporan
 * demo dihitung memakai aturan murni `@/lib/scale` yang sama dengan backend —
 * termasuk urutan, pangsa, dan penanda pemotongan. Satu cabang sengaja sudah
 * nonaktif: laporan harus melaporkan jumlahnya, bukan menghilangkannya.
 */
export interface DemoFranchiseSale {
  total: number;
  minutesAgo: number;
}

export interface DemoFranchiseOutlet {
  id: string;
  name: string;
  code: string;
  active: boolean;
  sales: DemoFranchiseSale[];
}

/** Baris contoh yang deterministik — bukan acak, supaya angka demo stabil. */
function franchiseSales(
  count: number,
  average: number,
  step: number,
): DemoFranchiseSale[] {
  return Array.from({ length: count }, (_, index) => ({
    total: average + ((index * step) % 9) * 4_500,
    minutesAgo: 25 + index * 37,
  }));
}

export const FRANCHISE_OUTLETS: DemoFranchiseOutlet[] = [
  {
    id: "st-sudirman",
    name: "Cabang Sudirman",
    code: "SDM",
    active: true,
    sales: franchiseSales(42, 68_000, 7),
  },
  {
    id: "st-kemang",
    name: "Cabang Kemang",
    code: "KMG",
    active: true,
    sales: franchiseSales(31, 74_000, 5),
  },
  {
    id: "st-bandung",
    name: "Cabang Bandung",
    code: "BDG",
    active: true,
    sales: franchiseSales(18, 59_000, 3),
  },
  {
    id: "st-lama",
    name: "Cabang Lama (tutup)",
    code: "LMA",
    active: false,
    sales: [],
  },
];

/**
 * Tagihan pembayaran digital contoh (`payment.digital`, Phase 6).
 *
 * Ketiganya sengaja mewakili tiga keadaan yang berbeda: satu QRIS yang tinggal
 * hitungan detik sebelum kedaluwarsa, satu VA yang sudah lunas tepat waktu, dan
 * satu QRIS yang sudah lewat tenggat. Waktu disimpan sebagai offset supaya data
 * contoh tidak pernah basi, dan `expiryMinutes` adalah janji yang dipatok saat
 * tagihan dibuat (bukan dihitung dari kebijakan hari ini).
 */
export interface DemoDigitalCharge {
  id: string;
  number: string;
  method: DigitalMethod;
  bank?: VaBank;
  amount: number;
  reference?: string;
  vaNumber?: string;
  qrPayload?: string;
  status: DigitalStatus;
  /** Janji umur tagihan ini, dalam menit, dipatok saat dibuat. */
  expiryMinutes: number;
  paidAmount?: number;
  paidMinutesAgo?: number;
  cancelReason?: string;
  cancelledMinutesAgo?: number;
  createdMinutesAgo: number;
}

export const DIGITAL_CHARGES: DemoDigitalCharge[] = [
  {
    id: "dig-3",
    number: "DIG-2026-0003",
    method: "qris",
    amount: 47_000,
    reference: "Meja 4",
    status: "pending",
    expiryMinutes: 5,
    createdMinutesAgo: 4.5,
  },
  {
    id: "dig-2",
    number: "DIG-2026-0002",
    method: "va",
    bank: "bca",
    amount: 1_250_000,
    reference: "PO-2026-0007 supplier beras",
    vaNumber: "880800000002",
    status: "paid",
    expiryMinutes: 1440,
    paidAmount: 1_250_000,
    paidMinutesAgo: 120,
    createdMinutesAgo: 180,
  },
  {
    id: "dig-1",
    number: "DIG-2026-0001",
    method: "qris",
    amount: 89_000,
    status: "pending",
    expiryMinutes: 5,
    createdMinutesAgo: 30,
  },
];

/**
 * Perangkat contoh hub sinkronisasi (`sync.realtime`, Phase 6): satu kasir yang
 * sedang online, satu tablet yang menganggur, dan satu desktop yang sudah lama
 * mati — supaya halaman tidak hanya menampilkan satu keadaan kehadiran.
 */
export interface DemoSyncDevice {
  id: string;
  name: string;
  fingerprint: string;
  platform: SyncPlatform;
  lastSeenMinutesAgo: number;
}

export const SYNC_DEVICES: DemoSyncDevice[] = [
  {
    id: "dev-kasir-1",
    name: "Kasir Depan",
    fingerprint: "fp-kasir-depan-01",
    platform: "web",
    lastSeenMinutesAgo: 0.2,
  },
  {
    id: "dev-tablet-2",
    name: "Tablet Pelayan",
    fingerprint: "fp-tablet-pelayan-02",
    platform: "android",
    lastSeenMinutesAgo: 2,
  },
  {
    id: "dev-desktop-3",
    name: "Desktop Gudang",
    fingerprint: "fp-desktop-gudang-03",
    platform: "desktop",
    lastSeenMinutesAgo: 45,
  },
];

/**
 * Log perubahan contoh. Dua barisnya sengaja konflik — yang belum ditandai
 * selesai dan yang sudah — supaya ringkasan konflik tidak pernah nol di demo.
 */
export interface DemoSyncChange {
  revision: number;
  deviceFingerprint: string;
  deviceName: string;
  platform: SyncPlatform;
  entity: SyncEntity;
  entityId: string;
  baseRevision: number;
  outcome: PushOutcome;
  reason?: string;
  payload: string;
  updatedMinutesAgo: number;
  resolvedMinutesAgo?: number;
}

export const SYNC_CHANGES: DemoSyncChange[] = [
  {
    revision: 6,
    deviceFingerprint: "fp-kasir-depan-01",
    deviceName: "Kasir Depan",
    platform: "web",
    entity: "sale",
    entityId: "sale-1042",
    baseRevision: 6,
    outcome: "applied",
    payload: '{"total":"47000","method":"qris"}',
    updatedMinutesAgo: 0.5,
  },
  {
    revision: 5,
    deviceFingerprint: "fp-tablet-pelayan-02",
    deviceName: "Tablet Pelayan",
    platform: "android",
    entity: "stock",
    entityId: "p05",
    baseRevision: 3,
    outcome: "rebased",
    reason: "Ada perubahan lain di data yang sama; versi terbaru (perangkat ini) yang dipakai.",
    payload: '{"stock":"17"}',
    updatedMinutesAgo: 2,
  },
  {
    revision: 4,
    deviceFingerprint: "fp-kasir-depan-01",
    deviceName: "Kasir Depan",
    platform: "web",
    entity: "stock",
    entityId: "p05",
    baseRevision: 3,
    outcome: "applied",
    payload: '{"stock":"18"}',
    updatedMinutesAgo: 3,
  },
  {
    revision: 3,
    deviceFingerprint: "fp-desktop-gudang-03",
    deviceName: "Desktop Gudang",
    platform: "desktop",
    entity: "product",
    entityId: "p03",
    baseRevision: 1,
    outcome: "rejected",
    reason: "Ada perubahan yang lebih baru pada data yang sama; versi server yang dipertahankan.",
    payload: '{"price":"29000"}',
    updatedMinutesAgo: 44,
    resolvedMinutesAgo: 40,
  },
  {
    revision: 2,
    deviceFingerprint: "fp-kasir-depan-01",
    deviceName: "Kasir Depan",
    platform: "web",
    entity: "product",
    entityId: "p03",
    baseRevision: 1,
    outcome: "applied",
    payload: '{"price":"28000"}',
    updatedMinutesAgo: 45,
  },
  {
    revision: 1,
    deviceFingerprint: "fp-kasir-depan-01",
    deviceName: "Kasir Depan",
    platform: "web",
    entity: "sale",
    entityId: "sale-1041",
    baseRevision: 0,
    outcome: "applied",
    payload: '{"total":"31000","method":"cash"}',
    updatedMinutesAgo: 60,
  },
];

export const DEMO_TENANT = {
  name: "Kedai Kopi Nusantara",
  slug: "kopi-nusantara",
  store: "Cabang Sudirman",
  /** Trial tenant on the Starter plan. */
  planKey: "starter" as const,
  devicesUsed: 1,
  storesUsed: 1,
  productsUsed: 13,
  usersUsed: 1,
};

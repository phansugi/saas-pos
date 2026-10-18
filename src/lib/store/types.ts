/**
 * The data contract the app codes against.
 *
 * Two implementations satisfy it — `demo.tsx` (seeded from src/data/demo.ts)
 * and `convex.tsx` (real queries/mutations). Pages never import demo data or
 * Convex directly; they go through `useStore()`, so switching the backend is a
 * configuration change rather than a UI rewrite.
 *
 * Shapes are display-oriented on purpose: Convex documents are mapped into
 * these before they reach a component.
 */

import type { AdvancedReport } from "@/lib/analytics";
import type { AgingBucket } from "@/lib/ar";
import type { Permission, Role } from "@/lib/authz";
import type { TeamInviteDelivery, TeamWaInvite } from "@/lib/team";
import type { FeatureKey, PlanKey, Vertical } from "@/lib/billing";
import type { TableDeletionCheck, TableUsage } from "@/lib/fnb";
import type {
  DigitalAction,
  DigitalMethod,
  DigitalStatus,
  DigitalSummary,
  VaBank,
} from "@/lib/payments";
import type {
  PresenceState,
  PushOutcome,
  SyncEntity,
  SyncPlatform,
  SyncSummary,
} from "@/lib/sync";
import type { CountProgress, OpnameVariance } from "@/lib/opname";
import type { ReceiptWhatsappSendResult } from "@/lib/receiptWhatsapp";
import type {
  GuestBankOption,
  GuestPayOption,
  GuestTaxRules,
  MejaOrderStatus,
} from "@/lib/meja";
import type { OrderTotalLine } from "@/lib/fnbTax";
import type { FnbMonthSummary, FnbMonthTaxRow, FnbTaxProfile } from "@/lib/fnbTax";
import { queryBudgetFor, type FranchiseReport } from "@/lib/scale";
import type {
  SupportAction,
  SupportCategory,
  SupportPriority,
  SupportSlaState,
  SupportStatus,
  SupportSummary,
} from "@/lib/support";
import type {
  InvoiceLine,
  MatchDecision,
  MatchDecisionKind,
  MatchStatus,
  ThreewayMatch,
  ThreewaySummary,
} from "@/lib/threeway";
import type { ProductDeletionCheck, ProductUsage } from "@/lib/productEdit";
import type {
  ShiftLocalClock,
  ShiftOwnerAlertKind,
  ShiftOwnerAlertReason,
  ShiftSetting,
} from "@/lib/shift";
import type { ReceiptSetting } from "@/lib/struk";
import type { TaxSetting } from "@/lib/tax";
import type {
  BusinessCategoryChoice,
  BusinessCategoryOption,
  LockedBusinessCategory,
} from "@/lib/businessCategory";
import type { StoreModules } from "./modules";

export type PaymentLabel = "Tunai" | "QRIS" | "Kartu" | "Transfer";

/** Canonical label order for reports. */
export const PAYMENT_LABELS: PaymentLabel[] = ["Tunai", "QRIS", "Kartu", "Transfer"];

/** Maps the backend's payment literals onto display labels. */
export const PAYMENT_LABEL_BY_METHOD: Record<string, PaymentLabel> = {
  cash: "Tunai",
  qris: "QRIS",
  card: "Kartu",
  transfer: "Transfer",
};

export interface StoreUnitConversion {
  code: string;
  factor: number;
}

export interface StorePriceTier {
  minQty: number;
  price: number;
}

export interface StoreModifierOption {
  code: string;
  name: string;
  /** Tambahan harga per unit yang dijual. */
  price: number;
}

/**
 * Grup modifier item (`pos.modifier`, modul F&B). `minSelect > 0` berarti grup
 * itu wajib dipilih; `maxSelect` membatasi berapa opsi boleh diambil.
 */
export interface StoreModifierGroup {
  code: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: StoreModifierOption[];
}

/** Pilihan kasir untuk satu grup: kode grup + kode opsi yang dipilih. */
export interface StoreModifierSelection {
  groupCode: string;
  optionCodes: string[];
}

/**
 * Satu gambar produk. `id` dipakai untuk menghapus gambar itu, `url` untuk
 * `<img src>`. Bentuknya sengaja dua kolom, bukan satu string URL: di mode Convex
 * yang dipakai untuk menghapus adalah id berkas di penyimpanan, sedangkan URL-nya
 * dibuat ulang setiap kali data dibaca.
 */
export interface StoreProductImage {
  id: string;
  url: string;
}

/**
 * Logo toko yang tercetak di atas nama usaha pada struk. Bentuknya sama dengan
 * gambar produk — `id` untuk melepasnya, `url` untuk `<img src>` — karena di mode
 * Convex yang dipakai melepas adalah id berkas di penyimpanan, sedangkan URL-nya
 * dibuat ulang setiap kali data dibaca (URL bertanda tangan punya masa berlaku).
 * Satu workspace hanya punya satu logo, jadi `null` = belum ada logo.
 */
export interface StoreLogo {
  id: string;
  url: string;
}

/**
 * Profil **pengguna aktif** (halaman Profil → kartu “Profil saya”): nama yang
 * tampil dan nomor WhatsApp-nya. Emailnya **tidak** ada di sini karena ia
 * identitas masuk (kode OTP dikirim ke sana) dan tidak diubah dari aplikasi.
 *
 * Nomor WhatsAppnya tersimpan dalam bentuk digit + kode negara (`62812…`) —
 * bentuk yang dituntut `wa.me` — jadi `null` berarti belum diisi.
 */
export interface StoreUserProfile {
  name: string;
  whatsapp: string | null;
}

/**
 * Identitas **usaha** (halaman Profil → kartu “Profil usaha”): nama usaha beserta
 * alamat, email kontak, dan nomor WA-nya.
 *
 * Ketiganya boleh kosong (`null` = belum diisi), dan itulah yang dibaca lencana
 * “belum lengkap” di halaman itu. `name` selalu ada karena nama usaha sudah ada
 * sejak workspace dibuat.
 */
export interface StoreTenantProfile {
  name: string;
  address: string | null;
  email: string | null;
  whatsapp: string | null;
}

/** Isian halaman Profil; kolom yang tidak dikirim berarti “jangan diubah”. */
export interface UpdateUserProfileInput {
  name?: string;
  whatsapp?: string;
}

export interface UpdateTenantProfileInput {
  name?: string;
  address?: string;
  email?: string;
  whatsapp?: string;
}

/** Hasil penyimpanan profil: nilai final dari yang menyimpan + kalimatnya. */
export interface UpdatedUserProfile extends StoreUserProfile {
  changed: boolean;
  sentence: string;
}

export interface UpdatedTenantProfile extends StoreTenantProfile {
  changed: boolean;
  sentence: string;
}

/**
 * Hasil penyimpanan kategori utama bisnis. `businessCategory` adalah nilai yang
 * **tersimpan** (bukan draft): di mode demo hasil aturan murni, di mode Convex
 * balikan `tenants.setBusinessCategory`. `changed: false` berarti pilihan yang
 * sama dikirim ulang dan tidak ada yang ditulis.
 */
export interface UpdatedBusinessCategory {
  businessCategory: LockedBusinessCategory;
  changed: boolean;
  sentence: string;
  /**
   * Apa yang ikut berubah di **katalog produk** saat pilihan itu dikunci —
   * master kategori & subkategori produk yang dibuat mengikuti kategori bisnisnya
   * (mis. Kafe → Kopi, Non-Kopi, Makanan Ringan, Bahan Baku beserta subkategori).
   * Tidak diisi di mode demo lama/balikan yang belum memuatnya.
   */
  productCatalogSentence?: string;
}

/**
 * Hasil penyamaan katalog produk dengan kategori bisnis workspace
 * (`syncProductCategories`). Hanya **menambah**: kategori yang sudah ada tidak
 * diganti namanya, dinonaktifkan, atau dihapus, dan produk tidak tersentuh.
 */
export interface SyncedProductCategories {
  /** `false` = tidak ada yang perlu ditambahkan (katalog sudah sesuai). */
  changed: boolean;
  businessCategoryLabel: string;
  /** Nama kategori produk yang baru dibuat, urut sesuai preset. */
  createdCategories: string[];
  /** Jumlah subkategori yang baru dibuat, termasuk di kategori yang sudah ada. */
  createdSubcategories: number;
  /** Preset kategori yang dilewati karena batas jumlah kategori workspace. */
  skippedCategories: string[];
  sentence: string;
}

/**
 * Kategori produk (`category.manage`) — struktur katalog.
 *
 * Kategorinya sendiri hidup **terpisah** dari produk (beda dengan mode demo lama
 * yang menurunkannya dari katalog), karena kategori tanpa produk pun harus bisa
 * diatur: ditambah lebih dulu, dinonaktifkan tanpa menghapus produknya, atau
 * dihapus walaupun masih dipakai.
 */
export interface StoreCategory {
  id: string;
  name: string;
  /** `false` = tidak bisa dipakai produk baru; produk lama tetap memakainya. */
  active: boolean;
  /** Jumlah produk di katalog yang sekarang memakai kategori ini. */
  productCount: number;
}

export interface CreateCategoryInput {
  name: string;
}

export interface RenameCategoryInput {
  categoryId: string;
  name: string;
}

/**
 * Balikan ganti nama kategori. `skuCodeChanged` benar kalau kode di tengah SKU
 * ikut berubah untuk produk **berikutnya** — SKU yang sudah ada tidak ditulis
 * ulang, jadi halaman mengatakannya apa adanya.
 */
export interface RenamedCategory {
  name: string;
  previousName: string;
  skuCodeChanged: boolean;
}

/**
 * Balikan hapus kategori: berapa produk yang dilepas menjadi “Tanpa kategori”
 * beserta berapa subkategori di bawahnya yang ikut terhapus.
 */
export interface RemovedCategory {
  name: string;
  detachedProducts: number;
  removedSubcategories: number;
}

/**
 * Subkategori katalog — dibuat **di bawah** sebuah kategori, bukan berdiri sendiri.
 *
 * Kategori menentukan kode SKU & tab POS; subkategori tidak menyentuh keduanya,
 * ia bagian katalog yang ikut dikirim ke platform (API & webhook). Produk menunjuk
 * **id** subkategorinya, jadi ganti nama subkategori tidak menulis ulang produk
 * mana pun.
 */
export interface StoreSubcategory {
  id: string;
  /** Kategori induknya — subkategori tidak pernah lepas dari kategorinya. */
  categoryId: string;
  name: string;
  /** `false` = tidak bisa dipilih produk baru; produk lama tetap memakainya. */
  active: boolean;
  /** Jumlah produk yang sekarang memakai subkategori ini. */
  productCount: number;
}

export interface CreateSubcategoryInput {
  /** Kategori induk tempat subkategori ini dibuat. */
  categoryId: string;
  name: string;
}

export interface RenameSubcategoryInput {
  subcategoryId: string;
  name: string;
}

/** Balikan ganti nama subkategori; tidak ada SKU yang ikut berubah. */
export interface RenamedSubcategory {
  name: string;
  previousName: string;
}

/** Balikan hapus subkategori: berapa produk yang kehilangan subkategorinya. */
export interface RemovedSubcategory {
  name: string;
  detachedProducts: number;
}

export interface StoreProduct {
  id: string;
  sku: string;
  name: string;
  /**
   * Nonaktif = tidak dijual lagi. `products` (katalog penjualan) hanya memuat yang
   * aktif; `catalogProducts` memuat semuanya supaya bisa dikelola & diaktifkan
   * kembali dari halaman Produk & Stok
   */
  active: boolean;
  price: number;
  /** Harga beli terakhir (rupiah); dipakai sebagai saran harga di PO. */
  cost: number;
  category: string;
  /**
   * Nama subkategori katalog, kosong bila produk tidak punya. Subkategorinya
   * dibuat **di bawah** kategori produk ini di halaman Produk & Stok; berbeda
   * dengan `category`, ia tidak menentukan SKU maupun tab POS — ia ikut dikirim di
   * API & webhook supaya platform mitra bisa menyusun katalog dua tingkat.
   */
  subcategory?: string;
  stock: number;
  /** Satuan dasar stok & harga (default "PCS"). */
  unit?: string;
  /** Konversi satuan besar (Dus/Pak) — modul Grosir. */
  units?: StoreUnitConversion[];
  /** Harga bertingkat per satuan dasar — modul Grosir. */
  tiers?: StorePriceTier[];
  /** Modifier item (level pedas, topping) — modul F&B. */
  modifiers?: StoreModifierGroup[];
  /**
   * Gambar produk, maksimal 8 (`MAX_PRODUCT_IMAGES`). Urutannya urutan unggah:
   * gambar pertama adalah yang dipakai sebagai thumbnail di daftar produk.
   */
  images?: StoreProductImage[];
}

export interface StoreSale {
  id: string;
  number: string;
  /** Clock time for the day's list, e.g. "13:42". */
  at: string;
  method: PaymentLabel;
  itemCount: number;
  total: number;
  /**
   * Pajak yang **benar-benar dipungut** saat penjualan itu terjadi (setelan PPN
   * workspace saat itu; 0 kalau PPN-nya sedang dimatikan).
   *
   * Opsional karena baris penjualan contoh (seed) tidak menyimpannya; ringkasan
   * di mode demo memakai `reverseTax` tarif bawaan hanya untuk baris lama itu.
   * Baris buatan store **selalu** mengisinya, jadi “PPN terkumpul” di demo tidak
   * lagi menebak dari total. Di server angka ini ada di kolom `sales.tax`.
   */
  tax?: number;
  /**
   * Biaya layanan yang dipungut penjualan ini (bukan pajak, dipisah dari `tax`).
   * Opsional karena baris contoh (seed) tidak menyimpannya; di server angka ini
   * ada di kolom `sales.serviceCharge`.
   */
  serviceCharge?: number;
}

export interface StoreSummary {
  revenue: number;
  tax: number;
  discount: number;
  transactions: number;
  itemCount: number;
  averagePerTransaction: number;
  byMethod: Record<PaymentLabel, number>;
}

/**
 * Laporan analitik lanjutan (`report.advanced`, Phase 4). Bentuknya sama persis
 * dengan hasil aturan murni `@/lib/analytics`, jadi halaman Laporan tidak
 * menghitung ulang apa pun — ia hanya menggambar.
 */
export type StoreAdvancedReport = AdvancedReport;

export interface CartItemInput {
  productId: string;
  quantity: number;
  /** Diisi hanya kalau kasir memakai satuan besar (mis. "DUS"); modul Grosir. */
  unitCode?: string;
  /** Pilihan modifier item (`pos.modifier`); modul F&B. */
  modifiers?: StoreModifierSelection[];
}

export interface CreateSaleInput {
  items: CartItemInput[];
  discount: number;
  method: PaymentLabel;
  /**
   * Member yang memakai diskonnya (modul UMKM, `member.discount`). Persentasenya
   * diambil server dari data member, bukan dari klien.
   */
  memberId?: string;
  /** Meja yang ditempati (modul F&B); server memvalidasi ulang. */
  tableId?: string;
  /** Pelanggan B2B penanggung tagihan (modul Grosir). */
  customerId?: string;
  /**
   * Jumlah yang benar-benar dibayar. Kalau lebih kecil dari total, sisanya
   * menjadi **piutang** pelanggan (`ar.creditlimit`); server mengevaluasi ulang
   * sisa limit kreditnya sebelum menerima.
   */
  paidAmount?: number;
  /**
   * Tagihan digital yang melunasi penjualan ini (`payment.digital`), kalau kasir
   * menagih QRIS langsung dari keranjang. Server hanya menerima tagihan yang
   * sudah lunas dan bernominal sama dengan total penjualannya.
   */
  digitalChargeId?: string;
}

/** Pelanggan B2B + posisi kreditnya (modul Grosir, fitur `ar.creditlimit`). */
export interface StoreCustomer {
  id: string;
  code: string;
  name: string;
  phone?: string;
  /** 0 berarti tunai saja. */
  creditLimit: number;
  paymentTermDays: number;
  active: boolean;
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
  openCount: number;
  availableCredit: number;
  /** Limit habis atau ada piutang jatuh tempo. */
  blocked: boolean;
}

/** Satu nota piutang (per penjualan tempo). */
export interface StoreReceivable {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  /** Nomor struk penjualannya, kalau masih tertaut. */
  saleNumber?: string | null;
  amount: number;
  paidAmount: number;
  balance: number;
  dueDate: number;
  status: "open" | "paid" | "void";
  daysPastDue: number;
  bucket: AgingBucket;
  overdue: boolean;
}

/** Ringkasan piutang untuk kartu di halaman Piutang. */
export interface StoreArSummary {
  openCount: number;
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
  byBucket: Record<AgingBucket, number>;
}

export const EMPTY_AR_SUMMARY: StoreArSummary = {
  openCount: 0,
  outstanding: 0,
  overdueAmount: 0,
  overdueCount: 0,
  byBucket: { current: 0, "1-30": 0, "31-60": 0, ">60": 0 },
};

export interface CreateCustomerInput {
  name: string;
  code?: string;
  phone?: string;
  creditLimit?: number;
  paymentTermDays?: number;
}

export interface SetCreditInput {
  customerId: string;
  creditLimit?: number;
  paymentTermDays?: number;
  active?: boolean;
}

export interface RecordPaymentInput {
  receivableId: string;
  amount: number;
  method: PaymentLabel;
  note?: string;
}

/** Satu meja di denah (modul F&B). Status terisi tidak disimpan di sini. */
export interface StoreTable {
  id: string;
  name: string;
  zone: string;
  seats: number;
  active: boolean;
  /**
   * Token kode QR meja (`mj_…`) yang membuka halaman menu tamu. Kosong = meja
   * ini belum punya kartu QR; diterbitkan `issueTableMenuQr` (izin
   * `table.manage`), bukan dibuat halaman.
   */
  menuToken?: string;
  /** Urutan tampil di denah (1 = paling depan); `undefined` = belum diurutkan. */
  sortOrder?: number;
}

export interface CreateTableInput {
  name: string;
  seats: number;
  zone?: string;
}

/** Mengubah identitas meja yang **sudah ada** di denah. */
export interface UpdateTableInput extends CreateTableInput {
  tableId: string;
}

/**
 * Pagar hapus sebuah meja seperti yang dibaca dialog konfirmasi: nama, pemakaian
 * (pesanan terbuka, riwayat penjualan, tagihan tamu yang menunggu), dan keputusan
 * beserta kalimatnya — bentuk yang sama dengan jawaban `tables.deletionCheck`.
 */
export interface StoreTableDeletionCheck
  extends TableDeletionCheck {
  name: string;
  active: boolean;
  usage: TableUsage;
}

/** Satu baris pesanan QR meja seperti yang dilihat kasir. */
export interface StoreMejaLine {
  name: string;
  quantity: number;
  lineTotal: number;
}

/**
 * Satu pesanan QR meja (`pos.table` + `payment.digital`): pesanan yang dikirim
 * tamu dari ponselnya sendiri.
 *
 * `status` adalah status **pesanan**; uangnya dicatat `chargeStatus` di tagihan
 * digitalnya — pesanan baru menjadi penjualan (tiket dapur) saat tagihannya
 * lunas, jadi `saleNumber` sengaja kosong selama masih menunggu bayar.
 */
export interface StoreMejaOrder {
  id: string;
  tableId: string;
  tableName: string;
  guestName: string | null;
  lines: StoreMejaLine[];
  subtotal: number;
  tax: number;
  serviceCharge: number;
  total: number;
  status: MejaOrderStatus;
  chargeId: string;
  chargeNumber: string;
  chargeStatus: DigitalStatus | null;
  /** Cara bayar yang dipilih tamu (QRIS bawaan untuk pesanan lama). */
  method: DigitalMethod;
  /** Bank penerbit Virtual Account; `null` untuk QRIS. */
  bank: VaBank | null;
  /** Nomor Virtual Account yang ditunjukkan ke tamu (hanya VA). */
  vaNumber: string | null;
  expiresAt: number | null;
  remainingSeconds: number;
  saleId: string | null;
  saleNumber: string | null;
  paidAt: number | null;
  createdAt: number;
}

/** Satu menu yang dilihat tamu di ponselnya (harga dari katalog server). */
export interface StoreGuestMenuItem {
  id: string;
  name: string;
  price: number;
  available: boolean;
  /** Sisa porsi kalau stoknya dilacak; `null` = tidak dilacak. */
  stock: number | null;
  imageUrl: string | null;
}

export interface StoreGuestMenuGroup {
  name: string;
  items: StoreGuestMenuItem[];
}

/** Menu satu meja seperti yang dibaca halaman tamu. */
export interface StoreGuestMenu {
  business: string;
  storeName: string;
  tableLabel: string;
  /**
   * Logo merchant untuk header halaman tamu (`null` = belum diunggah, header
   * memakai inisial namanya). Dibaca dari berkas yang sama dengan logo struk,
   * dan **hanya** dikirim ke halaman tamu lewat token meja — tamu perlu mengenali
   * tempatnya sedang memesan, bukan berkas internal workspace.
   */
  logoUrl: string | null;
  groups: StoreGuestMenuGroup[];
  tax: GuestTaxRules;
  /** Cara bayar yang ditawarkan ke tamu beserta bank Virtual Account-nya. */
  payment: {
    methods: GuestPayOption[];
    banks: GuestBankOption[];
  };
  limits: {
    maxLines: number;
    maxQtyPerItem: number;
    maxUnits: number;
    nameMax: number;
  };
}

/**
 * Hasil pembacaan menu tamu. Bukan lemparan: halaman tamu harus bisa
 * menjelaskan **kenapa** menunya tidak hidup (token salah, modul F&B mati, meja
 * nonaktif) dengan kalimat yang bisa dibaca pembeli.
 */
export type StoreGuestMenuResult =
  | { ok: true; menu: StoreGuestMenu }
  | { ok: false; reason: string };

export interface GuestOrderInput {
  token: string;
  items: { productId: string; quantity: number }[];
  guestName?: string;
  /** Cara bayar pilihan tamu; kosong = QRIS (bawaan). */
  method?: DigitalMethod;
  /** Bank penerbit VA; wajib kalau `method` = `va`. */
  bank?: VaBank | null;
}

/** Tanda terima satu pesanan tamu: nomor tagihan + rahasia pemantau statusnya. */
export interface GuestOrderReceipt {
  orderId: string;
  /** Token ponsel tamu (`mjo_…`) untuk menanyakan status pesanannya. */
  watchToken: string;
  business: string;
  tableLabel: string;
  guestName: string | null;
  subtotal: number;
  total: number;
  /** Rincian total (nilai jual, biaya layanan, pajak) dari aturan yang sama dengan kasir. */
  lines: OrderTotalLine[];
  charge: {
    id: string;
    number: string;
    method: DigitalMethod;
    /** Bank penerbit VA; `null` untuk QRIS. */
    bank: VaBank | null;
    /** Nomor Virtual Account (VA saja); `null` untuk QRIS. */
    vaNumber: string | null;
    /** Payload QRIS (QRIS saja); `null` untuk VA. */
    qrPayload: string | null;
    expiresAt: number;
    expiryMinutes: number;
    /** Kalimat cara bayar yang bisa dibaca tamu. */
    instruction: string;
  };
}

export type GuestOrderResult =
  | { ok: true; receipt: GuestOrderReceipt }
  | { ok: false; reason: string };

/** Status satu pesanan tamu di ponselnya (dibaca lewat token pemantau). */
export interface StoreGuestOrderStatus {
  status: MejaOrderStatus;
  chargeStatus: DigitalStatus;
  chargeNumber: string;
  tableLabel: string;
  guestName: string | null;
  subtotal: number;
  tax: number;
  serviceCharge: number;
  total: number;
  lines: StoreMejaLine[];
  saleNumber: string | null;
  paidAt: number | null;
  expiresAt: number | null;
  remainingSeconds: number;
  method: DigitalMethod;
  bank: VaBank | null;
  vaNumber: string | null;
  qrPayload: string | null;
  /** Kalimat cara bayar untuk kartu status tamu. */
  instruction: string;
}

/** Satu tiket di antrean dapur (modul F&B, `pos.kds`). */
export interface StoreKdsTicket {
  saleId: string;
  number: string;
  tableId?: string;
  tableName?: string;
  createdAt: number;
  waitingMinutes: number;
  /** Sudah menunggu lebih lama dari ambang; dapur perlu didahulukan. */
  late: boolean;
  itemCount: number;
  items: { name: string; quantity: number; modifiers?: string[] }[];
  /**
   * Tiket yang penjualannya **sudah lunas** (dikirim ke dapur pada momen
   * pembayarannya). Tombol Selesai pada tiket begini hanya menandai antreannya
   * beres — stoknya sudah bergerak saat penjualannya dicatat.
   */
  settled: boolean;
  /** Penanda pembayarannya, mis. `Lunas Tunai · diterima dapur pukul 13:42`. */
  paidLabel: string | null;
}

/**
 * Pesanan yang dikirim ke dapur: stok belum bergerak dan mejanya jadi terisi.
 * Metode pembayaran ikut dicatat (schema penjualan selalu menyimpan payments);
 * menyelesaikan pesanan di dapur menggerakkan stok, bukan uang.
 */
export interface HoldSaleInput {
  items: CartItemInput[];
  discount: number;
  method: PaymentLabel;
  tableId?: string;
  /** Member yang memakai diskonnya (modul UMKM, `member.discount`). */
  memberId?: string;
}

/**
 * Mengubah identitas produk yang **sudah tersimpan**. Harga jual, satuan, dan
 * kategori tetap lewat jalurnya masing-masing (`SetPricingInput`,
 * `SetProductCategoryInput`) supaya tiap perubahan punya satu jejak audit.
 */
export interface UpdateProductInput {
  productId: string;
  name?: string;
  sku?: string;
  /** Harga beli per satuan dasar; dipakai sebagai saran harga di PO. */
  cost?: number;
}

/**
 * Hasil perubahan identitas produk: nilai final + kolom yang benar-benar berubah
 * (`changed` kosong kalau tidak ada yang perlu disimpan).
 */
export interface UpdatedProduct {
  name: string;
  sku: string;
  cost: number;
  changed: string[];
}

/** Masukan setelan PPN dari halaman Pengaturan. */
export interface UpdateTaxInput {
  active: boolean;
  ratePct: number;
}

/** Hasil menulis setelan PPN: apa yang tersimpan + kalimat siap-baca. */
export interface UpdatedTax extends TaxSetting {
  /** `false` kalau setelannya memang sudah seperti itu (tidak ada audit kosong). */
  changed: boolean;
  sentence: string;
}

/**
 * Masukan setelan struk belanja dari halaman Pengaturan — satu setelan utuh
 * (jenis printer, lebar kertas, rangkap, catatan kaki), bukan sepotong-sepotong,
 * supaya server bisa menolak gabungan yang tidak mungkin dicetak sebelum satu
 * bidang pun tersimpan.
 */
export type UpdateReceiptInput = ReceiptSetting;

/** Hasil menulis setelan struk: yang tersimpan + kalimat siap-baca. */
export interface UpdatedReceipt {
  changed: boolean;
  setting: ReceiptSetting;
  sentence: string;
}

/**
 * Masukan setelan pengingat tutup shift dari halaman Pengaturan — satu setelan
 * utuh (saklar, jam pengingat, ambang shift lama), bukan sepotong-sepotong,
 * supaya server bisa menolak gabungan yang tidak masuk akal sebelum satu bidang
 * pun tersimpan.
 */
export type UpdateShiftInput = ShiftSetting;

/** Hasil menulis setelan pengingat tutup shift: yang tersimpan + kalimatnya. */
export interface UpdatedShift {
  changed: boolean;
  setting: ShiftSetting;
  sentence: string;
}

/**
 * Shift kas yang **sedang berjalan untuk toko ini** — bukan untuk perangkat yang
 * sedang dipakai.
 *
 * Bedanya penting: kas dibuka pemilik di ponselnya, lalu kasir melayani pembeli
 * dari ponsel lain. Kalau keadaannya hanya hidup di perangkat yang membukanya,
 * kasir itu melihat “Kas belum dibuka” dan tidak bisa menjual walau kas tokonya
 * jelas terbuka. Karena itu keadaannya dibaca dari tabel `shifts` di server
 * (`pos.till`), dan semua perangkat melihat kas yang sama.
 */
export interface StoreTillShift {
  id: string;
  /** Waktu buka dalam milidetik (epoch), sama seperti `shifts.openedAt`. */
  openedAt: number;
  openingCash: number;
}

/** Satu Z-report yang sudah ditutup, untuk tabel riwayat di halaman Shift & Kas. */
export interface StoreTillHistoryRow {
  id: string;
  openedAt: number;
  closedAt: number;
  openingCash: number;
  /** Uang yang dihitung kasir saat menutup kas. */
  countedCash: number;
  /** Kas awal + penjualan tunai shift itu. */
  expectedCash: number;
  /** `countedCash - expectedCash`; positif = lebih. */
  variance: number;
}

/** Keadaan kas toko: shift yang berjalan + riwayat penutupannya. */
export interface StoreTill {
  current: StoreTillShift | null;
  history: StoreTillHistoryRow[];
}

/**
 * Keadaan kas yang dilaporkan perangkat ke server untuk dikabarkan ke pemilik
 * toko. Yang dikirim **keadaannya**, bukan kalimatnya: jenis dan jam lokal
 * diperiksa ulang server dengan aturan yang sama (`shiftOwnerAlert`), jadi
 * laporan yang tidak cocok dengan jam operasionalnya ditolak — bukan diteruskan
 * menjadi pemberitahuan palsu.
 */
export interface ShiftAlertReportInput {
  kind: ShiftOwnerAlertKind;
  /** Jam lokal perangkat saat ini (`shiftLocalClock`). */
  clock: ShiftLocalClock;
  /** Waktu buka shift yang masih terbuka; kosong = tidak ada shift. */
  openedAt?: number;
}

/** Jawaban server atas satu laporan: terkirim / tidak perlu / sudah pernah. */
export interface ShiftAlertReportResult {
  /** `true` kalau kabarnya benar-benar tercatat (dan dikirim ke pelanggan webhook). */
  recorded: boolean;
  /** `true` kalau hari itu kabar yang sama sudah pernah dikirim. */
  duplicate: boolean;
  alertId: string | null;
  kind: ShiftOwnerAlertKind | null;
  /** Alasan aturannya, mis. `opening-grace` atau `after-close`. */
  reason: ShiftOwnerAlertReason | null;
  dayKey: string | null;
  /** Jumlah endpoint webhook yang ikut dikirimi (0 = belum ada pelanggan). */
  notifiedEndpoints: number;
  /** Alamat email pemilik toko yang kabarnya dijadwalkan ke sana. */
  emailRecipients: string[];
  /** Kalimat siap-baca untuk kasir — apa yang terjadi dengan laporannya. */
  notice: string;
}

/**
 * Satu kabar shift yang **sudah dikirim ke pemilik toko** (`shiftAlerts`), seperti
 * yang dibaca halaman Shift & Kas.
 *
 * Kabarnya pergi lewat dua jalur dan keduanya dibaca dari baris yang sama:
 * **email** ke pemilik workspace (`emailRecipients`, hasilnya di `emailVia` /
 * `emailDeliveredAt` / `emailError`) dan **langganan webhook** workspace
 * (`notifiedEndpoints`). Jadi “pemilik sudah dikabari” bisa diperiksa ulang — dan
 * saat emailnya belum berangkat atau webhooknya belum ada pelanggan, halaman
 * mengatakannya apa adanya, bukan mengaku sudah sampai.
 */
export interface StoreShiftAlert {
  id: string;
  kind: ShiftOwnerAlertKind;
  reason: string;
  /** Hari kalender lokal perangkat, `YYYY-MM-DD`. */
  dayKey: string;
  title: string;
  message: string;
  /** Jam lokal perangkat saat laporan dibuat (`08:15`). */
  localClock: string;
  openedAt: number | null;
  notifiedEndpoints: number;
  /** Alamat email pemilik toko yang dikabari (kosong = belum ada alamatnya). */
  emailRecipients: string[];
  /** Saluran yang dipakai untuk email itu (`resend`, `uji`, `demo`). */
  emailVia: string | null;
  /** Waktu email benar-benar berangkat; kosong = belum/gagal. */
  emailDeliveredAt: number | null;
  /** Pesan kegagalan pengiriman email terakhir, kalau ada. */
  emailError: string | null;
  reportedAt: number;
  resolvedAt: number | null;
}

/**
 * Masukan setelan pajak & pungutan F&B dari halaman Pengaturan — satu profil
 * utuh, bukan sepotong-sepotong, supaya server bisa menolak setelan yang saling
 * bertentangan sebelum satu bidang pun tersimpan.
 */
export type UpdateFnbTaxInput = FnbTaxProfile;

/** Hasil menulis profil pajak F&B: yang tersimpan + kalimat siap-baca. */
export interface UpdatedFnbTax {
  changed: boolean;
  profile: FnbTaxProfile;
  sentence: string;
}

/**
 * Satu bulan laporan pajak & pungutan F&B: omzet yang tercatat beserta pajak
 * (PBJT/PPN) dan biaya layanan yang benar-benar dipungut di bulan itu — dihitung
 * aturan murni `monthlyTaxRows` di `@/lib/fnbTax`, dipakai bersama laporan
 * bulanan di halaman Laporan dan ringkasan setoran di halaman Pengaturan.
 */
export type StoreFnbTaxMonth = FnbMonthTaxRow;

/**
 * Ringkasan **bulan berjalan** dari laporan itu (bulan terakhirnya). Dipakai
 * ringkasan setoran di halaman Pengaturan, supaya angka di sana persis sama
 * dengan baris terakhir tabel di halaman Laporan.
 */
export type StoreFnbTaxMonthSummary = FnbMonthSummary;

/**
 * Boleh tidaknya sebuah produk dihapus, beserta alasannya — dihitung server dari
 * data yang sebenarnya (stok, penjualan, pergerakan stok, dokumen pembelian,
 * opname), bukan diperkirakan klien.
 */
export type ProductDeletionInfo = ProductDeletionCheck & {
  name: string;
  sku: string;
  usage: ProductUsage;
};

export interface SetPricingInput {
  productId: string;
  price: number;
  unit?: string;
  units?: StoreUnitConversion[];
  tiers?: StorePriceTier[];
}

export interface SetModifiersInput {
  productId: string;
  modifiers: StoreModifierGroup[];
}

/**
 * Mengatur penempatan katalog produk: kategori dan subkategorinya.
 *
 * Kosongkan `category` untuk melepas kategorinya (subkategori otomatis ikut
 * dilepas — label tanpa induk tidak boleh ada). SKU yang **dibuat sistem**
 * (`PBB-<KATEGORI>-<nomor urut>`) ikut berganti kodenya saat kategorinya berganti,
 * sedangkan SKU yang diketik pemilik toko tidak disentuh. Subkategori sendiri
 * tidak pernah mengubah SKU.
 */
export interface SetProductCategoryInput {
  productId: string;
  category?: string;
  /** Subkategori di bawah kategori itu; kosong = tanpa subkategori. */
  subcategory?: string;
}

/**
 * Produk baru beserta stok awalnya.
 *
 * `openingStock` sengaja satu paket dengan pembuatan produk: server menulisnya
 * sebagai pergerakan stok beralasan `adjustment` (catatan "Stok awal"), jadi
 * angka stok pertama tidak pernah muncul tanpa jejak ledger.
 */
export interface CreateProductInput {
  name: string;
  /**
   * Kosongkan (atau jangan isi) untuk meminta SKU otomatis: server membuat
   * `PBB-<KATEGORI>-<nomor urut>` yang unik, dan nomor yang benar-benar dipakai
   * dikembalikan di `sku` hasil `createProduct`.
   */
  sku?: string;
  price: number;
  /** Harga beli; dipakai sebagai saran harga di PO. */
  cost?: number;
  /** Nama kategori (bukan id) — dicocokkan dengan kategori tenant. */
  category?: string;
  /** Nama subkategori di bawah kategori itu (opsional); butuh `category`. */
  subcategory?: string;
  /** Satuan dasar (default PCS). */
  unit?: string;
  openingStock?: number;
}

export interface CreateSaleResult {
  /** Receipt number when known immediately; null when assigned on sync. */
  number: string | null;
  /** Locally computed; the server's total is authoritative once synced. */
  total: number;
  /** True when the sale is queued offline rather than confirmed by the server. */
  queued: boolean;
  /** Bagian diskon yang berasal dari member, kalau ada. */
  memberDiscount?: number;
  /**
   * Penjualan ini langsung masuk antrean dapur pada momen pembayarannya (modul
   * F&B dengan fitur `pos.kds` hidup). Kosong untuk workspace tanpa dapur, dan
   * kosong juga saat penjualannya masih menunggu sinkronisasi — tiketnya baru
   * lahir saat server menyimpannya.
   */
  kitchenFired?: boolean;
}

/** Member pelanggan & diskon tetapnya (modul UMKM, `member.discount`). */
export interface StoreMember {
  id: string;
  code: string;
  name: string;
  phone?: string;
  /** Diskon per transaksi dalam persen (0–50); 0 = member tanpa diskon. */
  discountPct: number;
  active: boolean;
}

export interface CreateMemberInput {
  name: string;
  code?: string;
  phone?: string;
  discountPct?: number;
}

export interface UpdateMemberInput {
  memberId: string;
  name?: string;
  phone?: string;
  discountPct?: number;
  active?: boolean;
}

/**
 * Permintaan kirim PDF struk lewat WhatsApp member.
 *
 * Berkasnya dibuat di perangkat kasir (aturan murni `@/lib/receiptPdf`), jadi
 * yang dikirim ke server adalah PDF-nya sudah jadi — bukan gambar struk yang
 * dirender ulang di sana.
 *
 * Nomor penerimanya **diutamakan** dari data member (server yang mengambilnya),
 * tetapi `phone` boleh ikut diisi sebagai cadangan untuk member yang belum
 * melengkapi profilnya — mis. member cash yang didaftarkan cepat di kasir.
 * Nomor cadangan itu tetap divalidasi server (`normalizePhone`) sebelum dipakai,
 * dan pengirimannya dicatat di jejak audit; nomor yang sudah tersimpan di halaman
 * Member selalu menang atas nomor yang diketik kasir.
 */
export interface SendReceiptWhatsappInput {
  /**
   * Member penerima. **Kosong** = penjualan tanpa member sama sekali (pembeli
   * umum): tidak ada data member yang bisa dibaca, jadi nomornya wajib datang
   * dari `phone`.
   */
  memberId?: string;
  /**
   * Nomor nota penjualannya (mis. `A-00042`). Dipakai server sebagai rujukan
   * jejak audit untuk struk pembeli umum, yang tidak punya baris member.
   */
  saleNumber?: string;
  /** Nama berkas gambarnya, mis. `struk-A-00042.png` (dipakai di unggahan & audit). */
  filename: string;
  /** Isi pesan yang menemani gambarnya (keterangan pesan gambar). */
  caption: string;
  /**
   * Gambar struk (PNG berlogo) dalam base64, tanpa awalan data URL — **inilah yang
   * dikirim**. PDF struknya tidak lagi ikut ke WhatsApp: logo tokonya tidak terlihat
   * lewat pesan dokumen, sedangkan gambar tampil langsung di percakapan. PDF-nya tetap
   * bisa diunduh kasir dari dialog struk.
   */
  imageBase64: string;
  /**
   * Nomor WhatsApp yang **diketik kasir** di dialog struk. Dipakai kalau
   * membernya belum punya nomor tersimpan (cadangan), dan menjadi satu-satunya
   * tujuan untuk struk pembeli umum. Divalidasi ulang di server.
   */
  phone?: string;
}

/**
 * Supplier (Phase 3, `purchasing.basic`) beserta posisi hutangnya.
 *
 * Angka hutang dihitung dari tagihan terbuka supplier ini (aturan murni
 * `@/lib/payables`), bukan kolom tersimpan yang bisa basi — sama seperti limit
 * kredit pelanggan di halaman Piutang. Nol untuk peran yang tidak berhak
 * melihat uang (`payable.view`).
 */
export interface StoreSupplier {
  id: string;
  code: string;
  name: string;
  phone?: string;
  address?: string;
  /** Tempo pembayaran ke supplier (hari); 0 = bayar langsung. */
  paymentTermDays: number;
  active: boolean;
  /** Total tagihan supplier ini yang belum dibayar. */
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
  openCount: number;
  /** Bagian yang jatuh tempo ≤ 7 hari lagi. */
  dueSoonAmount: number;
}

/**
 * Satu tagihan supplier (hutang usaha). Hutang lahir dari penerimaan barang
 * (GRN) atau dicatat manual untuk tagihan di luar PO.
 */
export interface StorePayable {
  id: string;
  /** Nomor internal kita: `AP-00001`. */
  number: string;
  supplierId: string;
  supplierName: string;
  /** Nomor tagihan dari supplier, kalau sudah ada. */
  reference?: string;
  orderNumber?: string | null;
  receiptNumber?: string | null;
  /** Kalimat asal tagihan, mis. `PO PO-00001 · GRN-00001` atau nomor invoice. */
  source: string;
  amount: number;
  paidAmount: number;
  balance: number;
  dueDate: number;
  paymentTermDays: number;
  status: "open" | "paid" | "void";
  daysPastDue: number;
  bucket: AgingBucket;
  overdue: boolean;
  note?: string;
  /**
   * Dokumen supplier yang dicocokkan (3-way matching), `null` kalau belum
   * dicatat. Barisnya adalah yang **ditagih**, bisa berbeda dari PO/penerimaan.
   */
  invoice: StoreInvoice | null;
  /** Keputusan manusia atas selisihnya, `null` kalau belum diputuskan. */
  decision: MatchDecision | null;
  /** Status pencocokan PO ↔ GRN ↔ tagihan — selalu dihitung, tidak disimpan. */
  match: ThreewayMatch;
  createdAt: number;
}

/** Dokumen supplier (tagihan yang dikirim) untuk satu hutang usaha. */
export interface StoreInvoice {
  reference: string | null;
  /** Total tagihan supplier, selalu jumlah barisnya. */
  total: number;
  lines: InvoiceLine[];
  note: string | null;
  recordedAt: number;
}

/** Satu pembayaran yang lahir dari satu kali “bayar sekaligus”. */
export interface StorePaymentBatch {
  number: string;
  at: number;
  total: number;
  count: number;
  method: PaymentLabel;
  bills: {
    payableId: string;
    payableNumber: string;
    supplierName: string;
    amount: number;
  }[];
}

/** Ringkasan pencocokan 3 arah; dipakai kartu ringkasan & halaman Pembelian. */
export type StoreThreewaySummary = ThreewaySummary;

export const EMPTY_THREEWAY_SUMMARY: StoreThreewaySummary = {
  waitingInvoice: 0,
  needsReview: 0,
  matched: 0,
  accepted: 0,
  disputed: 0,
  openVarianceValue: 0,
};

export interface RecordInvoiceInput {
  payableId: string;
  reference?: string;
  /** Jatuh tempo menurut dokumen supplier; kosong = pakai jatuh tempo hutangnya. */
  dueDate?: number;
  note?: string;
  lines: { productId: string; quantity: number; unitCost: number }[];
}

export interface ResolveMatchInput {
  payableId: string;
  kind: MatchDecisionKind | "none";
  note?: string;
}

export interface PayBatchInput {
  payments: { payableId: string; amount: number }[];
  method: PaymentLabel;
  note?: string;
}

export type { MatchDecision, MatchDecisionKind, MatchStatus, ThreewayMatch, ThreewaySummary };

/** Satu pembayaran hutang supplier (boleh sebagian). */
export interface StorePayablePayment {
  id: string;
  payableId: string;
  payableNumber: string;
  supplierName: string;
  amount: number;
  method: PaymentLabel;
  note?: string;
  /** Nomor `PAY-…` kalau pembayaran ini bagian dari bayar sekaligus. */
  batchNumber?: string;
  createdAt: number;
}

/** Ringkasan hutang usaha: total terbuka, yang jatuh tempo, dan umurnya. */
export interface StorePayableSummary {
  openCount: number;
  outstanding: number;
  overdueAmount: number;
  overdueCount: number;
  dueSoonAmount: number;
  byBucket: Record<AgingBucket, number>;
}

export const EMPTY_PAYABLE_SUMMARY: StorePayableSummary = {
  openCount: 0,
  outstanding: 0,
  overdueAmount: 0,
  overdueCount: 0,
  dueSoonAmount: 0,
  byBucket: { current: 0, "1-30": 0, "31-60": 0, ">60": 0 },
};

export interface UpdateSupplierInput {
  supplierId: string;
  name?: string;
  phone?: string;
  address?: string;
  paymentTermDays?: number;
  active?: boolean;
}

export interface CreateBillInput {
  supplierId: string;
  /** Nomor tagihan supplier (opsional). */
  reference?: string;
  amount: number;
  /** Tanggal jatuh tempo; boleh sudah lewat untuk tagihan lama. */
  dueDate: number;
  note?: string;
}

export interface RecordPayablePaymentInput {
  payableId: string;
  amount: number;
  method: PaymentLabel;
  note?: string;
}

export interface StoreRequisitionLine {
  productId: string;
  name: string;
  quantity: number;
  note?: string;
}

/** Permintaan pembelian (PR) beserta keputusannya. */
export interface StoreRequisition {
  id: string;
  number: string;
  status: "submitted" | "approved" | "rejected";
  note?: string;
  decisionNote?: string;
  createdAt: number;
  lines: StoreRequisitionLine[];
  /** Nomor PO yang lahir dari PR ini, kalau sudah ada. */
  orderNumber?: string | null;
}

export interface StoreOrderLine {
  productId: string;
  name: string;
  quantity: number;
  unitCost: number;
  receivedQty: number;
  lineTotal: number;
}

/** Pesanan pembelian (PO) dengan progres penerimaannya. */
export interface StoreOrder {
  id: string;
  number: string;
  status: "open" | "partial" | "received" | "cancelled";
  supplierId: string;
  supplierName: string;
  requisitionNumber?: string | null;
  expectedAt?: number;
  note?: string;
  createdAt: number;
  total: number;
  receivedValue: number;
  lines: StoreOrderLine[];
}

export interface StoreReceiptLine {
  productId: string;
  name: string;
  quantity: number;
  unitCost: number;
}

/** Penerimaan barang (GRN) — satu peristiwa stok masuk. */
export interface StoreReceipt {
  id: string;
  number: string;
  orderId: string;
  orderNumber: string;
  /** `default` = lokasi jual toko. */
  warehouseId: string;
  locationName: string;
  note?: string;
  total: number;
  createdAt: number;
  lines: StoreReceiptLine[];
}

export interface StorePurchasingSummary {
  pendingRequisitions: number;
  openOrders: number;
  openOrderValue: number;
  openOrderUnits: number;
  awaitingReceipt: number;
  receivedThisMonth: number;
}

export const EMPTY_PURCHASING_SUMMARY: StorePurchasingSummary = {
  pendingRequisitions: 0,
  openOrders: 0,
  openOrderValue: 0,
  openOrderUnits: 0,
  awaitingReceipt: 0,
  receivedThisMonth: 0,
};

export interface CreateSupplierInput {
  name: string;
  code?: string;
  phone?: string;
  address?: string;
  paymentTermDays?: number;
}

export interface CreateRequisitionInput {
  lines: { productId: string; quantity: number; note?: string }[];
  note?: string;
}

export interface DecideRequisitionInput {
  requisitionId: string;
  approve: boolean;
  note?: string;
}

export interface CreateOrderInput {
  supplierId: string;
  requisitionId: string;
  lines: { productId: string; quantity: number; unitCost: number }[];
  expectedAt?: number;
  note?: string;
}

export interface ReceiveGoodsInput {
  orderId: string;
  /** Kosong = lokasi jual toko. */
  warehouseId?: string;
  lines: { productId: string; quantity: number }[];
  note?: string;
}

/**
 * Satu lokasi stok (Phase 3, `inventory.multiwarehouse`). Lokasi jual toko
 * selalu ada dengan id `default` — lihat `@/lib/inventory`.
 */
export interface StoreWarehouse {
  id: string;
  code: string;
  name: string;
  address?: string;
  active: boolean;
  /** Lokasi jual toko (bucket stok lama); tidak bisa dihapus/dinonaktifkan. */
  isDefault?: boolean;
}

/** Jumlah stok pada satu lokasi. */
export interface StoreStockLevel {
  warehouseId: string;
  quantity: number;
}

/** Satu produk beserta stoknya di setiap lokasi + totalnya. */
export interface StoreStockRow {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  levels: StoreStockLevel[];
  /** Stok di lokasi jual — angka yang dipakai kasir. */
  sellable: number;
  total: number;
}

/** Berapa lokasi stok yang boleh ada menurut paket (lokasi jual ikut dihitung). */
export interface StoreWarehouseCapacity {
  used: number;
  limit: number | "unlimited";
  remaining: number;
  full: boolean;
}

/**
 * Satu baris sesi stock opname (`inventory.opname`, Phase 3).
 *
 * `systemQty` adalah **snapshot** saldo lokasi saat sesi dimulai (patokan
 * selisih yang dibaca audit), sedangkan `currentQty` adalah saldo lokasi saat ini
 * — dasar perhitungan saat posting, karena waktu penghitungan bisa ada penjualan.
 */
export interface StoreOpnameLine {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  systemQty: number;
  /** Kosong = **belum dihitung** (bukan nol). */
  countedQty?: number;
  /** Saldo lokasi saat baris ini dibaca. */
  currentQty: number;
  /** `countedQty − systemQty`; kosong selama baris belum dihitung. */
  variance?: number;
  note?: string;
}

export interface StoreOpnameSession {
  id: string;
  number: string;
  /** `default` = lokasi jual toko. */
  locationId: string;
  locationName: string;
  status: "draft" | "posted" | "cancelled";
  note?: string;
  createdAt: number;
  postedAt?: number;
  cancelledAt?: number;
  progress: CountProgress;
  variance: OpnameVariance;
  lines: StoreOpnameLine[];
}

/** Lokasi yang bisa dihitung (lokasi jual atau gudang). */
export interface StoreOpnameLocation {
  id: string;
  name: string;
  active: boolean;
}

export interface StoreOpnameSummary {
  openCount: number;
  postedCount: number;
  cancelledCount: number;
  remainingLines: number;
  runningNetUnits: number;
}

export const EMPTY_OPNAME_SUMMARY: StoreOpnameSummary = {
  openCount: 0,
  postedCount: 0,
  cancelledCount: 0,
  remainingLines: 0,
  runningNetUnits: 0,
};

export interface StartOpnameInput {
  /** Kosong = lokasi jual toko. */
  warehouseId?: string;
  /** Hitung sebagian (cycle count); kosong = semua produk aktif ber-stok. */
  productIds?: string[];
  note?: string;
}

export interface SetOpnameCountInput {
  sessionId: string;
  productId: string;
  /** Kosong = kembalikan baris ke "belum dihitung". */
  countedQty?: number;
  note?: string;
}

/** Satu perpindahan stok antar lokasi, dibaca dari ledger. */
export interface StoreTransfer {
  number: string;
  at: number;
  productName: string;
  fromName: string;
  toName: string;
  quantity: number;
  note?: string;
}

export interface CreateWarehouseInput {
  name: string;
  code?: string;
  address?: string;
}

export interface TransferStockInput {
  productId: string;
  /** `default` = lokasi jual toko. */
  from: string;
  to: string;
  quantity: number;
  note?: string;
}

/** Default sebelum data pertama tiba: paket terkecil hanya punya lokasi jual. */
export const EMPTY_WAREHOUSE_CAPACITY: StoreWarehouseCapacity = {
  used: 1,
  limit: 1,
  remaining: 0,
  full: true,
};

/** Satu peran kustom tenant (`rbac.custom`, Phase 4). */
export interface StoreCustomRole {
  id: string;
  name: string;
  description?: string;
  /**
   * Izin yang diberikan peran ini. Keanggotaan yang ditugaskan ke peran ini
   * memakai daftar ini **persis**, menggantikan izin peran bawaannya.
   */
  permissions: Permission[];
  active: boolean;
  /** Keanggotaan (termasuk yang nonaktif) yang menunjuk peran ini. */
  memberCount: number;
}

/**
 * Satu **peran bawaan** yang bisa diatur workspace (izin, status, dihapus).
 *
 * Nama perannya tidak di sini karena tidak bisa diubah: `label` datang dari
 * `ROLE_LABELS` supaya struk, sidebar, dan audit tetap memakai nama yang sama di
 * semua workspace.
 */
export interface StoreBuiltinRole {
  role: Role;
  label: string;
  /** Izin yang benar-benar berlaku (sudah termasuk penyesuaian workspace). */
  permissions: Permission[];
  /** Izin bawaan peran ini, untuk tombol “Kembalikan izin bawaan”. */
  basePermissions: Permission[];
  /** `false` = tidak bisa ditugaskan lagi ke anggota baru. */
  active: boolean;
  /** `true` = dihapus dari daftar penugasan (bisa dipulihkan). */
  removed: boolean;
  /** Izinnya memang disesuaikan workspace ini (bukan bawaan). */
  customized: boolean;
  /** Keanggotaan (termasuk yang nonaktif) yang memakai peran ini. */
  memberCount: number;
}

/** Ringkasan daftar peran kustom untuk kartu di halaman Tim & Peran. */
export interface StoreRoleSummary {
  total: number;
  active: number;
  assignedMembers: number;
  limit: number;
  /** Batas jumlah peran belum tercapai. */
  canCreate: boolean;
  /** Ringkasan peran bawaan: berapa yang disesuaikan/dinonaktifkan/dihapus. */
  builtin: StoreBuiltinRoleSummary;
}

/** Ringkasan pengaturan peran bawaan workspace ini. */
export interface StoreBuiltinRoleSummary {
  total: number;
  customized: number;
  disabled: number;
  removed: number;
  /** Peran bawaan yang masih bisa ditugaskan. */
  assignable: number;
}

export const EMPTY_BUILTIN_ROLE_SUMMARY: StoreBuiltinRoleSummary = {
  total: 0,
  customized: 0,
  disabled: 0,
  removed: 0,
  assignable: 0,
};

export const EMPTY_ROLE_SUMMARY: StoreRoleSummary = {
  total: 0,
  active: 0,
  assignedMembers: 0,
  limit: 0,
  canCreate: true,
  builtin: EMPTY_BUILTIN_ROLE_SUMMARY,
};

/** Satu anggota tim beserta izin efektifnya (`rbac.custom`, Phase 4). */
export interface StoreTeamMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  /**
   * Peran **bawaan** anggota ini; `null` = ia memakai peran tambahan dan peran
   * tambahan itu berdiri sendiri (tidak ada peran dasar yang tersimpan).
   */
  role: Role | null;
  customRoleId: string | null;
  customRoleName: string | null;
  /** Izin efektif: dari peran kustom kalau ada, kalau tidak dari peran bawaan. */
  permissions: Permission[];
  active: boolean;
  /**
   * Keadaan pengiriman undangan lewat email untuk anggota ini: kapan berangkat,
   * lewat saluran apa, atau pesan kegagalannya. `EMPTY_INVITE_DELIVERY` berarti
   * belum pernah ada pengiriman yang tercatat — bukan berarti "terkirim".
   */
  invite: TeamInviteDelivery;
  /**
   * Nomor WhatsApp anggota (digit + kode negara) atau `null`. Dipakai undangan
   * `wa.me`; **bukan** jalur masuk — masuknya tetap kode OTP ke email.
   */
  phone: string | null;
  /** Berapa kali tautan undangan WhatsApp dibuka pengundang (bukan "terkirim"). */
  waInvite: TeamWaInvite;
}

/** Perubahan satu anggota tim; field yang tidak dikirim tidak diubah. */
export interface UpdateTeamMemberInput {
  membershipId: string;
  name?: string;
  email?: string;
  /**
   * Peran bawaan yang baru. `null` melepas peran bawaan (anggota hanya memakai
   * peran tambahan); `undefined` tidak mengubah peran.
   */
  role?: Role | null;
  /** Kosong/`null` menghapus nomor WhatsApp. */
  phone?: string | null;
  active?: boolean;
}

/**
 * Undangan anggota tim baru (`members.add`).
 *
 * Undangan diikat ke **email**, bukan perangkat: orang yang diundang masuk sendiri
 * lewat kode OTP ke email itu, lalu berada di workspace yang sama karena
 * keanggotaannya ada di server. Karena itu email yang salah bentuk ditolak sebelum
 * dikirim — undangan untuk email yang tidak bisa menerima kode adalah janji yang
 * tidak bisa ditepati (`validateTeamInvite`).
 */
export interface InviteTeamMemberInput {
  email: string;
  /** Nama tampil; kosong berarti store/server memakai bagian sebelum `@`. */
  name?: string;
  /** Nomor WhatsApp opsional; kalau diisi, undangan `wa.me` bisa langsung dikirim. */
  phone?: string;
  /**
   * Peran **bawaan** anggota baru. Wajib kecuali `customRoleId` diisi — peran
   * tambahan berdiri sendiri, jadi anggotanya tidak punya peran dasar apa pun.
   */
  role?: Role | null;
  /**
   * Peran tambahan yang **langsung dipakai** anggota ini saat didaftarkan —
   * pilihan yang dulu baru bisa ditetapkan sesudah orangnya masuk tim.
   *
   * Kalau diisi, anggota itu **hanya** memakai peran ini (`role` tidak ditulis).
   * Penugasannya butuh fitur `rbac.custom` dan melewati pagar eskalasi yang sama
   * dengan `roles.assign`: peran yang memuat izin di luar wewenang pengundang
   * ditolak, dan pemilik tenant tidak boleh diberi peran tambahan.
   */
  customRoleId?: string | null;
}

/** Hasil satu undangan: keanggotaan mana, dan apakah baru dibuat atau diperbarui. */
export interface InvitedTeamMember {
  membershipId: string;
  userId: string;
  email: string;
  /** `null` = anggota itu hanya memakai peran tambahan (berdiri sendiri). */
  role: Role | null;
  /** `true` = anggota baru; `false` = email itu sudah anggota dan perannya diperbarui. */
  created: boolean;
  /**
   * Keadaan kirim undangannya saat ini. Server mengirim **setelah** mutation-nya
   * selesai (aksi terjadwal), jadi di mode Convex ini biasanya masih kosong;
   * nilai sebenarnya muncul di `teamMembers[].invite` begitu aksinya selesai.
   */
  invite: TeamInviteDelivery;
}

/**
 * Satu kunci API tenant (`api.access`, Phase 4).
 *
 * `mask` adalah bentuk aman untuk ditampilkan (`mp_<publicId>_••••••••`);
 * rahasianya hanya ada sekali di nilai kembalian `createApiKey`, persis seperti
 * di backend yang hanya menyimpan hash-nya.
 */
export interface StoreApiKey {
  id: string;
  name: string;
  mask: string;
  publicId: string;
  scopes: Permission[];
  /** `null` = kunci dibuat anggota yang memakai peran tambahan (tanpa peran bawaan). */
  creatorRole: Role | null;
  status: "active" | "revoked" | "expired" | "disabled";
  expiresAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
}

export interface StoreApiKeySummary {
  active: number;
  revoked: number;
  /** Kunci aktif yang kedaluwarsa dalam 14 hari. */
  expiringSoon: number;
}

export const EMPTY_API_KEY_SUMMARY: StoreApiKeySummary = {
  active: 0,
  revoked: 0,
  expiringSoon: 0,
};

/** Satu endpoint webhook keluar beserta langganan event-nya. */
export interface StoreWebhookEndpoint {
  id: string;
  url: string;
  description?: string;
  events: string[];
  active: boolean;
  /** Empat karakter terakhir rahasia penanda tangan; rahasianya sendiri tidak dibaca lagi. */
  secretLastFour: string;
  createdAt: number;
  updatedAt: number;
}

/** Satu percobaan kiriman webhook; `nextAttemptAt` hanya ada selama masih dicoba. */
export interface StoreWebhookDelivery {
  id: string;
  endpointId: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: number | null;
  deliveredAt: number | null;
  createdAt: number;
}

export interface StoreWebhookSummary {
  endpoints: number;
  activeEndpoints: number;
  pendingDeliveries: number;
  failedDeliveries: number;
}

export const EMPTY_WEBHOOK_SUMMARY: StoreWebhookSummary = {
  endpoints: 0,
  activeEndpoints: 0,
  pendingDeliveries: 0,
  failedDeliveries: 0,
};

export interface CreateApiKeyInput {
  name: string;
  scopes: Permission[];
  /** 0 = tanpa kedaluwarsa. */
  expiresInDays: number;
}

export interface CreateWebhookEndpointInput {
  url: string;
  description?: string;
  events: string[];
}

export interface UpdateWebhookEndpointInput {
  endpointId: string;
  /** Menyalakan/mematikan endpoint selalu boleh — ini cara menghentikan kiriman. */
  active?: boolean;
  description?: string;
  events?: string[];
  rotateSecret?: boolean;
}

/** Hasil satu kiriman uji; `error` berisi pesan penerima kalau gagal. */
export interface WebhookTestResult {
  status: "delivered" | "pending" | "failed";
  attempts: number;
  event: string;
  error: string | null;
}

export interface CreateCustomRoleInput {
  name: string;
  description?: string;
  permissions: Permission[];
}

export interface UpdateCustomRoleInput {
  roleId: string;
  name?: string;
  description?: string;
  permissions?: Permission[];
  active?: boolean;
}

/**
 * Mengubah izin dan/atau status satu **peran bawaan**.
 *
 * `permissions` yang diisi berarti “izin pengganti” (butuh fitur `rbac.custom`);
 * `active` boleh diubah tanpa fitur — menonaktifkan peran justru mencabut akses.
 */
export interface UpdateBuiltinRoleInput {
  role: Role;
  permissions?: Permission[];
  active?: boolean;
}

/**
 * Satu tiket dukungan (`support.dedicated`, Phase 5).
 *
 * `dueAt`, `slaState`, dan `remainingHours` dihitung aturan murni `@/lib/support`
 * dari `createdAt` + `slaHours` yang **dipatok saat tiket dibuat** — jadi paket
 * yang berubah tidak menulis ulang janji tanggap untuk tiket yang sudah masuk.
 */
export interface StoreSupportTicket {
  id: string;
  number: string;
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  status: SupportStatus;
  slaHours: number;
  escalated: boolean;
  body: string;
  log: { at: number; kind: "note" | "status"; body: string }[];
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  dueAt: number;
  slaState: SupportSlaState;
  remainingHours: number;
}

export type StoreSupportSummary = SupportSummary;

/** Janji dukungan paket ini, dari `slaForPlan` yang sama dengan server. */
export interface StoreSupportPlan {
  planKey: PlanKey;
  /** Fitur `support.dedicated` sedang hidup di paket + modul tenant ini. */
  dedicated: boolean;
  channel: string;
  responseHours: number;
  accountManager: boolean;
}

export interface StoreSupportLimits {
  maxOpenTickets: number;
  maxLog: number;
}

export const EMPTY_SUPPORT_SUMMARY: StoreSupportSummary = {
  open: 0,
  inProgress: 0,
  resolved: 0,
  escalated: 0,
  overdue: 0,
  dueSoon: 0,
  nextDueAt: null,
};

export interface CreateSupportTicketInput {
  subject: string;
  category: SupportCategory;
  priority: SupportPriority;
  body: string;
}

/**
 * Satu tagihan pembayaran digital (`payment.digital`, Phase 6).
 *
 * `status` di sini adalah **status efektif**: aturan murni `@/lib/payments`
 * menurunkan `expired` dari `expiresAt` saat dibaca, jadi tagihan yang lewat
 * tenggat tidak pernah menggantung sebagai "menunggu" walau tak ada yang
 * menyapunya.
 */
export interface StoreDigitalCharge {
  id: string;
  number: string;
  method: DigitalMethod;
  /** Bank penerbit VA; `null` untuk QRIS. */
  bank: VaBank | null;
  amount: number;
  reference: string | null;
  vaNumber: string | null;
  qrPayload: string | null;
  status: DigitalStatus;
  expiresAt: number;
  /** Penjualan yang dilunasi tagihan ini (kasir menagih dari keranjang). */
  saleId: string | null;
  saleNumber: string | null;
  paidAmount: number | null;
  paidAt: number | null;
  cancelReason: string | null;
  cancelledAt: number | null;
  createdAt: number;
  updatedAt: number;
  remainingSeconds: number;
}

export type StoreDigitalSummary = DigitalSummary;

/** Apakah kanal tagih digital hidup untuk paket + modul tenant ini. */
export interface StoreDigitalPlan {
  planKey: PlanKey;
  digital: boolean;
  planName: string;
}

export interface StoreDigitalLimits {
  minAmount: number;
  maxAmount: number;
  referenceMax: number;
  reasonMax: number;
  expiringSoonSeconds: number;
  qrisExpiryMinutes: number;
  vaExpiryMinutes: number;
}

export const EMPTY_DIGITAL_SUMMARY: StoreDigitalSummary = {
  pending: 0,
  paid: 0,
  expired: 0,
  cancelled: 0,
  pendingAmount: 0,
  paidAmount: 0,
  expiringSoon: 0,
  nextExpiryAt: null,
};

export interface CreateDigitalChargeInput {
  amount: number;
  method: DigitalMethod;
  /** Wajib untuk `va`; kosongkan untuk `qris`. */
  bank?: VaBank | null;
  reference?: string;
}

export interface ActDigitalChargeInput {
  chargeId: string;
  action: DigitalAction;
  /** Wajib sama dengan nominal tagihan saat `settle`. */
  amount?: number;
  reason?: string;
}

/**
 * Satu perangkat pada hub sinkronisasi (`sync.realtime`, Phase 6). Kehadiran
 * (`presence`) diturunkan dari `lastSeenAt`, bukan disimpan; `revision` adalah
 * revisi terakhir yang sudah dilihat perangkat ini.
 */
export interface StoreSyncDevice {
  deviceId: string;
  name: string;
  fingerprint: string;
  platform: SyncPlatform;
  lastSeenAt: number;
  revoked: boolean;
  presence: PresenceState;
  idleSeconds: number;
  revision: number;
}

/** Satu baris log perubahan hub sinkronisasi. */
export interface StoreSyncChange {
  id: string;
  revision: number;
  deviceId: string;
  deviceName: string;
  platform: SyncPlatform;
  entity: SyncEntity;
  entityId: string;
  baseRevision: number;
  outcome: PushOutcome;
  reason: string | null;
  payload: string;
  updatedAt: number;
  conflict: boolean;
  resolvedAt: number | null;
  createdAt: number;
}

export type StoreSyncSummary = SyncSummary;

export interface StoreSyncPlan {
  planKey: PlanKey;
  realtime: boolean;
  planName: string;
}

export interface StoreSyncLimits {
  maxChangesPerPull: number;
  maxBoardChanges: number;
  maxPayload: number;
  maxClockSkewMs: number;
  onlineWindowMs: number;
  idleWindowMs: number;
  maxLabel: number;
  maxFingerprint: number;
}

export interface StoreSyncEntityOption {
  key: SyncEntity;
  label: string;
}

export interface StoreSyncPlatformOption {
  key: SyncPlatform;
  label: string;
}

export const EMPTY_SYNC_SUMMARY: StoreSyncSummary = {
  online: 0,
  idle: 0,
  offline: 0,
  total: 0,
  unresolvedConflicts: 0,
  resolvedConflicts: 0,
  latestRevision: 0,
  staleDeviceId: null,
};

export interface RegisterSyncDeviceInput {
  label: string;
  platform: SyncPlatform;
  fingerprint: string;
}

export interface PushSyncInput {
  deviceFingerprint: string;
  deviceName: string;
  platform: SyncPlatform;
  entity: SyncEntity;
  entityId: string;
  baseRevision: number;
  updatedAt: number;
  payload?: string;
}

/** Satu giliran tarik perubahan hub sinkronisasi (`sync.realtime`, Phase 6). */
export interface PullSyncInput {
  /** Revisi terakhir yang sudah dilihat klien; hanya revisi di atas ini yang ditarik. */
  cursor: number;
  /** Batas baris satu giliran; dinormalkan ke `maxChangesPerPull`. */
  limit?: number;
}

export interface PullSyncResult {
  /** Perubahan di atas kursor, urut revisi menaik. */
  items: StoreSyncChange[];
  /** Kursor berikutnya; sama dengan `cursor` bila tidak ada baris baru. */
  nextCursor: number;
  /** Masih ada baris di atas `nextCursor` yang belum ikut terkirim. */
  hasMore: boolean;
  /** Revisi tertinggi tenant saat tarikan ini dibaca. */
  latestRevision: number;
}

export interface ActSupportTicketInput {
  ticketId: string;
  action: SupportAction;
  note?: string;
}

/** Satu transaksi terbesar jaringan di laporan lintas cabang. */
export interface StoreFranchiseTopSale {
  saleId: string;
  storeId: string;
  storeName: string;
  number: string;
  total: number;
  createdAt: number;
}

/**
 * Laporan lintas cabang (`scale.franchise`, Phase 5): bentuknya sama persis
 * dengan hasil aturan murni `@/lib/scale` plus informasi jendela & anggaran,
 * sehingga halaman tidak pernah menghitung ulang angka yang berbeda.
 */
export type StoreFranchiseReport = FranchiseReport & {
  days: number;
  generatedAt: number;
  topSales: StoreFranchiseTopSale[];
  /** Cabang di luar jendela global; tidak dibaca sama sekali. */
  beyondWindow: number;
};

/**
 * Laporan kosong yang **sah** — dipakai peran tanpa izin `report.view` dan paket
 * yang tidak memuat `scale.franchise`, supaya halaman tidak perlu tahu backend
 * mana yang aktif maupun kenapa laporannya kosong.
 */
export const EMPTY_FRANCHISE_REPORT: StoreFranchiseReport = {
  outlets: [],
  totals: {
    revenue: 0,
    transactions: 0,
    averageBasket: 0,
    outlets: 0,
    activeOutlets: 0,
    inactiveOutlets: 0,
  },
  truncated: false,
  skippedOutlets: 0,
  budget: queryBudgetFor(1),
  window: { from: 0, to: 0 },
  days: 0,
  generatedAt: 0,
  topSales: [],
  beyondWindow: 0,
};

export interface StoreApi {
  /** Which implementation is live — surfaced in the UI so demo data is obvious. */
  source: "demo" | "convex";
  /** False while the first payload is still loading. */
  ready: boolean;
  /**
   * Pemulihan workspace dari server masih berjalan.
   *
   * `ready` menjawab “data sudah boleh ditampilkan?”; ini menjawab pertanyaan
   * yang berbeda: “identitas bisnis pengguna aktif sudah pasti?”. Dua keadaan
   * membuatnya `true`: daftar keanggotaan belum dimuat, dan sesi perangkat masih
   * memuat identitas yang berbeda dari workspace miliknya (perangkat baru).
   *
   * Onboarding memakainya supaya pemilik toko yang masuk di perangkat baru tidak
   * ditawari membuat bisnis kedua — formulirnya ditahan sampai server menjawab
   * bahwa ia memang belum punya workspace. Di mode demo tidak ada server, jadi
   * pemulihan tidak pernah berjalan (`false`).
   */
  workspacePending: boolean;
  /**
   * Membatalkan pendaftaran akun yang baru dibuat: **email yang dipakai mendaftar
   * dihapus** dari server (baris `users` beserta jejak masuknya), lalu pemanggil
   * keluar dari sesi dan kembali ke beranda.
   *
   * Server menolak kalau akun sudah punya workspace atau berperan platform (lihat
   * `@/lib/account`), jadi halaman hanya perlu menampilkan penolakannya apa adanya.
   * Mode demo tidak punya akun di server: yang dikembalikan hanya email sesi, dan
   * data demo di perangkat ini tetap ada.
   */
  cancelRegistration(): Promise<{ email: string; sentence: string }>;
  error: string | null;
  products: StoreProduct[];
  /**
   * Semua produk tenant, **termasuk yang nonaktif**, untuk halaman Produk & Stok.
   * Katalog penjualan (`products`) sengaja hanya berisi yang aktif, jadi kasir,
   * KDS, dan laporan tidak pernah menawarkan produk yang sudah dimatikan.
   */
  catalogProducts: StoreProduct[];
  sales: StoreSale[];
  summary: StoreSummary;
  /**
   * Kategori katalog tenant, terurut seperti yang diatur (`sortOrder`). Dipakai
   * tab filter POS, pemilih kategori di halaman Produk, dan kartu pengelolaan
   * kategori di halaman yang sama. Tidak pernah kosong di tenant yang baru dibuat
   * karena kategori bawaan dibuat bersama workspace-nya.
   */
  categories: StoreCategory[];
  /**
   * Subkategori katalog tenant, terurut seperti yang diatur — tiap barisnya
   * terikat pada satu `categoryId`. Dipakai pemilih subkategori di form produk dan
   * pengelolaan “di bawah kategori” di halaman Produk & Stok.
   */
  subcategories: StoreSubcategory[];
  /** Menambah kategori; namanya divalidasi aturan yang sama dengan server. */
  createCategory(input: CreateCategoryInput): Promise<{ id: string; name: string }>;
  /** Ganti nama kategori; SKU yang sudah ada tidak ikut ditulis ulang. */
  renameCategory(input: RenameCategoryInput): Promise<RenamedCategory>;
  /** Mengaktifkan/menonaktifkan kategori; kategori nonaktif tidak dipakai produk baru. */
  setCategoryActive(categoryId: string, active: boolean): Promise<void>;
  /**
   * Menghapus kategori; produknya menjadi “Tanpa kategori” dan subkategori di
   * bawahnya ikut terhapus — tidak ada produk yang ikut terhapus.
   */
  removeCategory(categoryId: string): Promise<RemovedCategory>;
  /**
   * Menyamakan katalog produk dengan **kategori bisnis** workspace ini: master
   * kategori & subkategori produk yang relevan ditambahkan kalau belum ada.
   *
   * Dipakai tombol di halaman Produk & Stok, terutama untuk workspace yang sudah
   * berdiri sebelum presets-nya ada. Sifatnya sama dengan penyemaian saat
   * onboarding — **hanya menambah** dan idempoten — dan workspace yang belum
   * memilih kategori bisnis akan ditolak server dengan alasan yang menyebut jalan
   * keluarnya (pilih dulu di halaman Profil).
   */
  syncProductCategories(): Promise<SyncedProductCategories>;
  /** Menambah subkategori **di bawah** `categoryId`; namanya dijaga seperti kategori. */
  createSubcategory(input: CreateSubcategoryInput): Promise<{ id: string; name: string }>;
  /** Ganti nama subkategori; tidak ada SKU yang ikut berubah. */
  renameSubcategory(input: RenameSubcategoryInput): Promise<RenamedSubcategory>;
  /** Mengaktifkan/menonaktifkan subkategori; yang nonaktif tidak dipakai produk baru. */
  setSubcategoryActive(subcategoryId: string, active: boolean): Promise<void>;
  /** Menghapus subkategori; produknya kehilangan subkategorinya, tidak ikut terhapus. */
  removeSubcategory(subcategoryId: string): Promise<RemovedSubcategory>;
  /**
   * Modul plug-in (Phase 2): apa yang aktif, apa yang masih bisa dinyalakan,
   * dan fitur mana yang menunggu modulnya. Dihitung dari aturan yang sama
   * dengan backend, jadi UI tidak menawarkan sesuatu yang akan ditolak.
   */
  modules: StoreModules;
  /** Menyalakan/mematikan modul; server tetap memvalidasi pilihan ini. */
  setModules(verticals: Vertical[]): Promise<void>;
  /**
   * Setelan PPN workspace: tarifnya (besar/kecil) dan aktif/nonaktifnya.
   *
   * Kasir, halaman Produk, dan halaman Pengaturan membacanya dari sini — jadi
   * tidak ada tarif PPN yang ditulis di dalam komponen. Angka yang dipungut adalah
   * `effectiveTaxRatePct(tax)` (nol saat dimatikan): pada tenant lama yang belum
   * punya kolom `taxActive`, nilainya tetap aktif seperti sebelumnya.
   */
  tax: TaxSetting;
  /** Mengubah setelan PPN; aturannya sama dengan `tenants.updateTax` di server. */
  setTax(input: UpdateTaxInput): Promise<UpdatedTax>;
  /**
   * Pajak & pungutan khas F&B: PBJT (pajak daerah pengganti PPN untuk
   * makanan/minuman yang disajikan langsung), biaya layanan, dan kewajiban pusat
   * pengusaha (PPh final UMKM, PPh 21, PPh 4 ayat (2)).
   *
   * Selalu dalam bentuk lengkap: workspace yang belum pernah menyimpannya dibaca
   * sebagai bawaan tanpa pungutan F&B, jadi perilaku lamanya tidak berubah.
   */
  fnbTax: FnbTaxProfile;
  /** Menyimpan profil pajak F&B; divalidasi ulang di server (`tenants.updateFnbTax`). */
  setFnbTax(input: UpdateFnbTaxInput): Promise<UpdatedFnbTax>;
  /**
   * Setelan struk belanja workspace: jenis printer struknya (thermal, dot matrix,
   * portable), lebar kertas, jumlah rangkap, dan catatan kakinya.
   *
   * Kasir membaca setelan yang sama saat mencetak dan halaman Pengaturan saat
   * menampilkan pratinjaunya — jadi bentuk struk yang dilihat pemilik toko di
   * halaman Pengaturan tidak pernah berbeda dari yang keluar di kasir. Workspace
   * yang belum pernah mengaturnya dibaca sebagai bawaan (thermal 80 mm, satu
   * lembar), yaitu perilaku sebelum setelan ini ada.
   */
  receipt: ReceiptSetting;
  /** Menyimpan setelan struk; aturannya sama dengan `tenants.updateReceipt`. */
  setReceipt(input: UpdateReceiptInput): Promise<UpdatedReceipt>;
  /**
   * Setelan pengingat tutup shift workspace: jam pengingatnya, ambang “shift
   * sudah terlalu lama”, dan saklar hidup/matinya.
   *
   * Halaman Kasir (banner di atas katalog produk) dan halaman Shift & Kas (kartu
   * pengingat) membaca setelan yang sama, jadi pengingat yang dilihat kasir tidak
   * pernah berbeda dari yang diatur pemilik toko. Workspace yang belum pernah
   * mengaturnya dibaca sebagai bawaan (aktif, 21:00, 14 jam), yaitu perilaku
   * sebelum setelan ini ada.
   */
  shift: ShiftSetting;
  /** Menyimpan setelan pengingat; aturannya sama dengan `tenants.updateShift`. */
  setShift(input: UpdateShiftInput): Promise<UpdatedShift>;
  /**
   * Kabar shift yang sudah pernah dikirim ke pemilik toko (kas belum dibuka di
   * jam operasional / shift belum ditutup), terbaru dulu.
   *
   * Isinya sama dengan yang dibaca halaman Shift & Kas dari `shiftAlerts.list`:
   * “pemilik sudah diberi tahu” harus bisa diperiksa ulang, bukan cuma klaim di
   * layar kasir. Di mode demo daftarnya hidup di memori sesi, karena tidak ada
   * tabel yang menyimpannya.
   */
  shiftAlerts: StoreShiftAlert[];
  /**
   * Melaporkan keadaan kas perangkat ini supaya pemilik toko diberi tahu kalau
   * memang perlu (`shiftAlerts.report`). Server memutuskan ulang dengan aturan
   * yang sama, jadi balikannya selalu menjelaskan: terkirim, tidak perlu, atau
   * hari itu sudah pernah.
   */
  reportShiftAlert(input: ShiftAlertReportInput): Promise<ShiftAlertReportResult>;
  /** Menandai satu kabar sudah ditangani (`shiftAlerts.resolve`). */
  resolveShiftAlert(alertId: string): Promise<void>;
  /**
   * Keadaan kas **toko** (bukan perangkat): shift yang berjalan + riwayat
   * Z-report-nya. Di mode Convex isinya dibaca dari tabel `shifts` lewat
   * `pos.till`; di mode demo dari penyimpanan perangkat yang sama dengan yang
   * dibaca halaman Kasir.
   *
   * Halaman Kasir memakainya sebagai gerbangnya: kas yang dibuka pemilik di
   * perangkat lain membuka kasir di semua perangkat, dan kasir yang menjual tidak
   * perlu memegang izin `shift.manage` untuk itu.
   */
  till: StoreTill;
  /**
   * Membuka kas toko (`pos.openShift`) — kas awal adalah uang kembalian di laci.
   * Butuh izin `shift.manage`; server menolak shift kedua untuk kasir yang sama.
   */
  openTill(input: { openingCash: number }): Promise<void>;
  /**
   * Menutup kas toko (`pos.closeShift`): uang fisik yang dihitung dibandingkan
   * dengan kas awal + penjualan tunai, lalu selisihnya disimpan sebagai Z-report.
   * Butuh izin `shift.manage`.
   */
  closeTill(input: { countedCash: number }): Promise<void>;
  /**
   * Logo toko (`tenants.logo`) yang tercetak di atas nama usaha pada setiap struk;
   * `null` = workspace itu belum punya logo, dan struknya dicetak seperti sebelum
   * fitur ini ada.
   */
  logo: StoreLogo | null;
  /**
   * Memasang (atau mengganti) logo toko. Berkasnya sudah diperkecil klien
   * (`prepareTenantLogo`); batas 1 MB dan tipe berkasnya ditegakkan lagi di server
   * (`tenants.setLogo`), jadi request langsung tidak bisa melewatinya.
   */
  setLogo(file: Blob): Promise<void>;
  /** Melepas logo toko sekaligus menghapus berkasnya di mode Convex. */
  removeLogo(): Promise<void>;
  /**
   * Profil pengguna aktif (nama & nomor WA) — `users.name`/`users.phone` di
   * server. Nama itu yang tercetak sebagai baris `Kasir` di struk dan yang
   * tampil di daftar anggota Tim & Peran.
   */
  myProfile: StoreUserProfile;
  /**
   * Menyimpan profil pengguna lewat `users.updateProfile`: siapa saja boleh
   * mengubah **profilnya sendiri** (server memeriksanya dengan `verifyActor`),
   * jadi tidak ada izin peran yang dibutuhkan. Aturannya sama di kedua store
   * (nama 2–60 karakter, nomor WA dinormalkan ke bentuk `wa.me`).
   */
  setMyProfile(input: UpdateUserProfileInput): Promise<UpdatedUserProfile>;
  /**
   * Identitas usaha (`tenants.name`/`address`/`email`/`phone`) yang diatur dari
   * halaman Profil. Kosong = belum diisi, bukan salah.
   */
  tenantProfile: StoreTenantProfile;
  /**
   * Menyimpan identitas usaha lewat `tenants.updateProfile` — izinnya
   * `billing.manage`, sama dengan setelan workspace lain. Peran tanpa izin itu
   * tetap **melihat** isinya di halaman Profil; server menolak kalau aksinya
   * dipaksakan dari luar halaman.
   */
  setTenantProfile(input: UpdateTenantProfileInput): Promise<UpdatedTenantProfile>;
  /**
   * Kategori utama bisnis yang dipilih pemilik — **terkunci permanen** setelah
   * tersimpan. `null` = workspace lama yang belum pernah memilih; halaman Profil
   * menawarkan pilihan itu sekali kepada pemiliknya.
   */
  businessCategory: LockedBusinessCategory | null;
  /**
   * Katalog kategori utama yang **boleh dipilih** (hanya yang aktif, diatur
   * pemilik platform di backstage) — dipakai pemilih di onboarding & halaman
   * Profil. Kategori/subkategori yang dinonaktifkan atau dihapus tidak muncul di
   * sini, dan server menolaknya walau dipaksa dari luar halaman.
   */
  businessCategories: BusinessCategoryOption[];
  /**
   * Apakah pengguna aktif adalah **akun platform developer** (`users.platformRole`),
   * yaitu pemilik backstage — bukan peran tenant mana pun.
   *
   * Dipakai hanya untuk menampilkan jalan masuk ke `/platform` di sidebar & halaman
   * onboarding. Backstage tetap memeriksa ulang identitas dan perannya di server
   * (`platform.me`), jadi nilai ini tidak pernah menjadi gerbang. Mode demo selalu
   * `false`: penanda itu hidup di baris pengguna server, dan backstage menolak
   * berjalan dengan data demo.
   */
  platformDeveloper: boolean;
  /**
   * Memilih kategori utama + subkategori untuk pertama kalinya lewat
   * `tenants.setBusinessCategory`. Hanya pemilik yang berhak (server memeriksa
   * peran, bukan hanya izin); pilihan berikutnya dengan pasangan berbeda ditolak
   * selamanya, dan pasangan yang sama tidak menulis apa pun.
   */
  setBusinessCategory(input: BusinessCategoryChoice): Promise<UpdatedBusinessCategory>;
  /**
   * Omzet tercatat per bulan (semua toko workspace ini), **tertua dulu**, 12
   * bulan terakhir termasuk bulan berjalan.
   *
   * Angkanya datang dari baris penjualan yang benar-benar tersimpan — bukan
   * perkiraan klien. Dipakai laporan pajak & pungutan F&B di halaman Laporan,
   * dan bulan terakhirnya dipakai ringkasan setoran di halaman Pengaturan.
   */
  fnbTaxMonths: StoreFnbTaxMonth[];
  /**
   * Ringkasan bulan berjalan (`fnbCurrentMonthSummary` atas `fnbTaxMonths`):
   * bulan mana, omzet yang tercatat, omzet tahun berjalan sebelumnya, dan
   * berapa transaksi yang ikut dihitung.
   */
  fnbTaxMonth: StoreFnbTaxMonthSummary;
  /**
   * Pindah paket (naik atau turun) lewat `billing.changePlan`: server menghitung
   * prorata, memangkas modul yang tidak termasuk paket baru, dan menulis jejak
   * audit. `gained`/`lost` dipakai halaman Langganan untuk menjelaskan apa yang
   * berubah; sesi ikut diselaraskan supaya gerbang fitur memakai paket baru.
   */
  changePlan(planKey: PlanKey): Promise<{
    changed: boolean;
    planKey: PlanKey;
    gained: FeatureKey[];
    lost: FeatureKey[];
  }>;
  /** Denah meja (modul F&B). Kosong selama modulnya belum aktif. */
  tables: StoreTable[];
  /**
   * Antrean dapur: pesanan tertahan, **paling lama menunggu di depan**.
   * Urutan dan penandaan "lama" dihitung aturan yang sama dengan server.
   */
  kdsTickets: StoreKdsTicket[];
  /** Menambah meja ke denah; divalidasi ulang di server. */
  createTable(input: CreateTableInput): Promise<void>;
  /** Mengaktifkan/menonaktifkan meja; meja terisi tidak boleh dimatikan. */
  setTableActive(tableId: string, active: boolean): Promise<void>;
  /** Mengubah nama, jumlah kursi, dan zona sebuah meja (divalidasi ulang server). */
  updateTable(input: UpdateTableInput): Promise<void>;
  /**
   * Menghapus meja dari denah. Hanya berhasil kalau pagar hapusnya mengizinkan:
   * meja yang masih terisi, masih menunggu pembayaran tamu, atau sudah punya
   * riwayat penjualan ditolak dengan kalimatnya (untuk yang beriwayat: jawabannya
   * menonaktifkan).
   */
  deleteTable(tableId: string): Promise<void>;
  /**
   * Pagar hapus sebuah meja tanpa menghapus apa pun — dibaca dialog konfirmasi
   * supaya kalimatnya sama dengan yang akan dijawab server (pola yang sama dengan
   * `checkProductDeletion`: satu aturan untuk keputusan dan penolakannya).
   */
  tableDeletionCheck(tableId: string): Promise<StoreTableDeletionCheck>;
  /**
   * Menggeser satu meja satu langkah di denah (`step` -1 = mundur, 1 = maju).
   * Urutannya dihitung server dari data yang tersimpan, jadi dua perangkat yang
   * menata bersamaan tidak saling menimpa dengan urutan yang salah.
   */
  moveTable(tableId: string, step: -1 | 1): Promise<void>;
  /**
   * Menambah beberapa meja sekaligus dari teks (satu meja per baris). Semua atau
   * tidak sama sekali: satu baris yang salah membatalkan seluruh impor dengan
   * kalimat yang menyebut nomor barisnya (`planTableImport`).
   */
  importTables(text: string): Promise<{ created: number; names: string[] }>;
  /**
   * Menerbitkan token kode QR meja — kode yang ditempel di meja supaya tamu bisa
   * memindai menunya sendiri. Idempoten: menekan "Tampilkan QR" berkali-kali
   * tidak mengganti kartu yang sudah tercetak; penggantian harus diminta dengan
   * `rotate` (kartu lama langsung tidak berlaku).
   */
  issueTableMenuQr(
    tableId: string,
    options?: { rotate?: boolean },
  ): Promise<{ token: string; rotated: boolean }>;
  /**
   * Pesanan QR meja: yang masih menunggu bayar (berapa pun umurnya) plus yang
   * sudah lunas dalam 12 jam terakhir. Dipakai halaman **Pembayaran** untuk
   * mengenali tagihan pesanan QR (kasirlah yang melunasi/membatalkannya di sana),
   * sementara layar Dapur & Meja hanya membacanya sebagai penanda kanal & momen
   * pelunasan tiket — pesanan yang belum lunas sengaja tidak tampil di sana.
   */
  mejaOrders: StoreMejaOrder[];
  /**
   * Melunasi tagihan sebuah pesanan QR meja lewat jalur tagihan digital yang sama
   * (`actDigitalCharge`) dengan nominal pesanannya, supaya aturan transisi status
   * dan pencatatan penjualannya cuma ada satu: begitu lunas, pesanannya menjadi
   * tiket dapur di antrean. Dipakai halaman tamu (mode demo) & harness — kasir
   * melunasi dari halaman Pembayaran.
   */
  settleMejaOrder(orderId: string): Promise<void>;
  /** Membatalkan niat pesanan QR meja (tidak mengubah tagihannya). */
  cancelMejaOrder(orderId: string): Promise<void>;
  /**
   * Membatalkan pesanan **dari ponsel tamunya sendiri** lewat token pemantau
   * (`mjo_…`). Aturannya `guestCancelCheck`: hanya selama tagihannya belum lunas;
   * tagihan yang masih menunggu ikut dimatikan supaya kodenya tidak bisa dipakai
   * membayar pesanan yang sudah dibatalkan.
   */
  cancelGuestOrder?(
    watchToken: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }>;
  /**
   * Menu satu meja untuk halaman tamu (`/meja/:token`). Hanya ada di **mode
   * demo**: di mode Convex halaman tamu tidak punya sesi, jadi ia membaca
   * `api.meja.menu` langsung (lihat `MejaPage`). Bentuk datanya sengaja sama,
   * supaya tampilan tamunya cuma ditulis sekali.
   */
  guestMenu?(token: string): StoreGuestMenuResult;
  /** Membuat pesanan tamu (mode demo; mode Convex lewat `api.meja.order`). */
  placeGuestOrder?(input: GuestOrderInput): Promise<GuestOrderResult>;
  /** Status pesanan tamu untuk ponselnya (mode demo). */
  guestOrderStatus?(watchToken: string): StoreGuestOrderStatus | null;
  /**   * Kirim pesanan ke dapur (status `held`): stok belum bergerak, dan mejanya
   * menjadi terisi. Butuh koneksi — antrean offline sengaja tidak dipakai di
   * sini, karena dapur harus melihat pesanan yang benar-benar diterima server.
   */
  holdSale(input: HoldSaleInput): Promise<{ number: string | null; total: number }>;
  /** Selesaikan pesanan tertahan: stok bergerak dan mejanya kosong lagi. */
  completeHeld(saleId: string): Promise<void>;
  /**
   * Tombol **Selesai** di layar dapur, satu jalan untuk kedua jenis tiket: pesanan
   * tertahan diselesaikan (stok bergerak), sedangkan tiket yang sudah lunas hanya
   * ditandai beres. Mana yang berlaku ditentukan server dari data penjualannya,
   * bukan dari tombol yang ditekan — jadi stok tidak pernah bergerak dua kali.
   */
  finishKitchenTicket(saleId: string): Promise<void>;
  /**
   * Menyimpan harga dasar + konfigurasi grosir (harga bertingkat, konversi
   * satuan). Divalidasi ulang di server dan butuh modul Grosir aktif.
   */
  /**
   * Membuat produk baru (`products.create`). Stok awalnya ikut di sini — inilah
   * cara pertama mengisi stok sebelum ada penerimaan barang dari supplier.
   * `sku` yang dikembalikan adalah SKU final: kalau inputnya kosong, server (atau
   * store demo) yang membuatnya otomatis, jadi perhatikan nilai balikannya, bukan
   * inputnya.
   */
  createProduct(input: CreateProductInput): Promise<{ id: string; sku: string }>;
  /**
   * Menambahkan satu gambar ke sebuah produk. Berkasnya sudah diperkecil klien
   * (`prepareProductImage`); batas 8 gambar dan 2 MB per berkas ditegakkan lagi
   * di server, jadi request langsung tidak bisa melewatinya.
   */
  addProductImage(productId: string, file: Blob): Promise<void>;
  /** Melepas gambar dari produk (dan menghapus berkasnya di mode Convex). */
  removeProductImage(productId: string, imageId: string): Promise<void>;
  setPricing(input: SetPricingInput): Promise<void>;
  /**
   * Ubah nama/SKU/harga beli produk yang sudah tersimpan (`products.update`).
   * SKU tetap dipakai apa adanya tetapi dijaga unik; kolom yang tidak dikirim
   * dibiarkan seperti semula.
   */
  updateProduct(input: UpdateProductInput): Promise<UpdatedProduct>;
  /**
   * Aktifkan/nonaktifkan produk (`products.setActive`). Nonaktif menyembunyikannya
   * dari kasir & katalog penjualan tanpa menghapus data atau riwayatnya.
   */
  setProductActive(productId: string, active: boolean): Promise<void>;
  /**
   * Boleh tidaknya produk dihapus + alasannya (`products.deletionCheck`). Dipanggil
   * halaman sebelum menekan Hapus, supaya konfirmasinya memuat hitungan server.
   */
  checkProductDeletion(productId: string): Promise<ProductDeletionInfo>;
  /**
   * Menghapus produk yang belum dipakai apa pun (`products.remove`). Produk yang
   * sudah terjual, masih berstok, atau muncul di dokumen pembelian/opname ditolak
   * server dengan alasannya — jalur untuk produk itu adalah menonaktifkannya.
   */
  removeProduct(productId: string): Promise<{ name: string; sku: string }>;
  /**
   * Mengubah kategori produk (`products.setCategory`). SKU buatan sistem ikut
   * mengikuti kategori barunya — nomornya dipertahankan selama masih bebas —
   * sedangkan SKU yang diketik pemilik toko dibiarkan apa adanya. Balikannya
   * menyebut SKU sebelum & sesudah, jadi halaman bisa memberi tahu perubahan yang
   * benar-benar terjadi, bukan menebaknya.
   */
  setCategory(
    input: SetProductCategoryInput,
  ): Promise<{
    sku: string;
    previousSku: string;
    category: string | null;
    subcategory: string | null;
  }>;
  /**
   * Menyimpan modifier item sebuah produk (level pedas, topping). Kosongkan
   * daftarnya untuk menghapus; butuh modul F&B aktif saat diisi.
   */
  setModifiers(input: SetModifiersInput): Promise<void>;
  /**
   * Pelanggan B2B beserta posisi kreditnya (modul Grosir). Selalu berbentuk
   * daftar kosong di tenant yang belum memakai tempo — bukan error.
   */
  customers: StoreCustomer[];
  /** Nota piutang, diurutkan paling dekat jatuh tempo. */
  receivables: StoreReceivable[];
  arSummary: StoreArSummary;
  /** Menambah pelanggan B2B; limit > 0 butuh modul Grosir aktif. */
  createCustomer(input: CreateCustomerInput): Promise<{ id: string; code: string }>;
  /** Mengubah limit/tempo/status pelanggan; menutup kredit (limit 0) selalu boleh. */
  setCredit(input: SetCreditInput): Promise<void>;
  /** Menerima pembayaran piutang (boleh sebagian). */
  recordPayment(input: RecordPaymentInput): Promise<{ remaining: number }>;
  /**
   * Daftar member (modul UMKM). Kosong kalau perannya tidak punya izin
   * `member.view`, bukan error.
   */
  members: StoreMember[];
  /** Menambah member; diskon > 0 butuh modul UMKM aktif. */
  createMember(input: CreateMemberInput): Promise<{ id: string; code: string }>;
  /** Mengubah nama/telepon/diskon/status member; menutup diskon selalu boleh. */
  updateMember(input: UpdateMemberInput): Promise<void>;
  /**
   * Kirim **gambar struk** ke WhatsApp pembeli (`receiptWa.send` di server) — member
   * yang dipilih di keranjang, atau pembeli umum (tanpa member) lewat nomor yang
   * diketik kasir di dialog struk. Yang dikirim gambarnya saja (PNG berlogo), karena
   * itu yang membuat logo tokonya terlihat di percakapan.
   *
   * Hasilnya selalu berupa nilai, bukan lemparan, karena tiga penolakan yang
   * paling sering terjadi (membernya tidak ada, nomor tujuannya belum ada, atau
   * kanal WhatsApp belum tersambung) justru yang perlu dibaca kasir — bukan
   * sesuatu yang bisa diperbaiki dengan mengulang tombolnya.
   */
  sendReceiptWhatsapp(
    input: SendReceiptWhatsappInput,
  ): Promise<ReceiptWhatsappSendResult>;
  /**
   * Lokasi stok (Phase 3): lokasi jual toko + gudang tambahan. Selalu berisi
   * minimal lokasi jual, jadi halaman Gudang & Stok tidak pernah kosong.
   */
  warehouses: StoreWarehouse[];
  /** Stok per lokasi untuk setiap produk aktif. */
  stock: StoreStockRow[];
  warehouseCapacity: StoreWarehouseCapacity;
  /** Riwayat perpindahan terbaru (dari ledger), terbaru dulu. */
  transfers: StoreTransfer[];
  /** Menambah gudang; butuh fitur `inventory.multiwarehouse` dan sisa slot paket. */
  createWarehouse(input: CreateWarehouseInput): Promise<{ id: string; code: string }>;
  /** Mengaktifkan/menonaktifkan gudang; gudang yang masih berisi stok ditolak. */
  setWarehouseActive(warehouseId: string, active: boolean): Promise<void>;
  /** Memindahkan stok antar lokasi; total stok tidak pernah berubah. */
  transferStock(input: TransferStockInput): Promise<{ number: string; quantity: number }>;
  /**
   * Stock opname (Phase 3, `inventory.opname`): sesi hitung fisik per lokasi.
   * Selalu berbentuk daftar kosong untuk peran tanpa izin `inventory.view`.
   */
  opnameSessions: StoreOpnameSession[];
  opnameLocations: StoreOpnameLocation[];
  opnameSummary: StoreOpnameSummary;
  /** Sesi berjalan per lokasi — satu lokasi hanya boleh punya satu. */
  opnameOpenByLocation: { number: string; locationId: string }[];
  /** Memulai sesi baru; butuh fitur `inventory.opname` (paket Enterprise). */
  startOpname(input: StartOpnameInput): Promise<{ id: string; number: string }>;
  /** Menulis hasil hitung satu baris (kosongkan `countedQty` untuk membatalkannya). */
  setOpnameCount(input: SetOpnameCountInput): Promise<void>;
  /** Memposting sesi: stok lokasi menjadi sama persis dengan hasil hitung. */
  postOpname(
    sessionId: string,
  ): Promise<{ number: string; movements: number; netUnits: number }>;
  /** Membatalkan sesi yang masih berjalan. */
  cancelOpname(sessionId: string, reason?: string): Promise<void>;
  /**
   * Pembelian (Phase 3, `purchasing.basic`): supplier, PR, PO, dan GRN.
   * Selalu berbentuk daftar kosong untuk peran tanpa izin `purchase.view`.
   */
  suppliers: StoreSupplier[];
  requisitions: StoreRequisition[];
  orders: StoreOrder[];
  receipts: StoreReceipt[];
  purchasingSummary: StorePurchasingSummary;
  /** Menambah supplier (izin `purchase.approve`). */
  createSupplier(input: CreateSupplierInput): Promise<{ id: string; code: string }>;
  /** Mengubah supplier: kontak, tempo, dan status aktif (izin `purchase.approve`). */
  updateSupplier(input: UpdateSupplierInput): Promise<void>;
  /** Mengajukan PR; butuh fitur `purchasing.basic` + izin `purchase.request`. */
  createRequisition(input: CreateRequisitionInput): Promise<{ id: string; number: string }>;
  /** Menyetujui/menolak PR — pemisahan tugas dari pengaju. */
  decideRequisition(input: DecideRequisitionInput): Promise<void>;
  /** Membuat PO dari PR yang disetujui. */
  createOrder(input: CreateOrderInput): Promise<{ id: string; number: string }>;
  /** Membatalkan PO selagi belum ada barang diterima. */
  cancelOrder(orderId: string, reason?: string): Promise<void>;
  /** Menerima barang (GRN): stok masuk ke lokasi yang dipilih. */
  receiveGoods(input: ReceiveGoodsInput): Promise<{ number: string; total: number }>;
  /**
   * Hutang usaha: tagihan supplier beserta umur & pelunasannya.
   * Selalu berbentuk daftar kosong untuk peran tanpa izin `payable.view`.
   */
  payables: StorePayable[];
  payablePayments: StorePayablePayment[];
  payableSummary: StorePayableSummary;
  /**
   * Pencocokan 3 arah (`purchasing.threeway`): dokumen supplier dicocokkan dengan
   * PO & penerimaan, dan selisihnya harus diputuskan sebelum dibayar.
   */
  threewaySummary: StoreThreewaySummary;
  /** Pembayaran yang lahir dari satu kali bayar, dikelompokkan per `PAY-…`. */
  paymentBatches: StorePaymentBatch[];
  /** Mencatat tagihan supplier di luar PO (butuh fitur `purchasing.basic`). */
  createBill(input: CreateBillInput): Promise<{ id: string; number: string }>;
  /** Mencatat dokumen supplier & mencocokkannya (fitur `purchasing.threeway`). */
  recordInvoice(input: RecordInvoiceInput): Promise<{
    reference: string | null;
    total: number;
    flagged: boolean;
    reasons: string[];
  }>;
  /** Menerima selisih / menyengketakannya / mencabut sengketa (fitur yang sama). */
  resolvePayableMatch(
    input: ResolveMatchInput,
  ): Promise<{ kind: MatchDecisionKind | null; amount: number }>;
  /** Membayar hutang supplier, boleh sebagian (izin `payable.manage`). */
  recordPayablePayment(
    input: RecordPayablePaymentInput,
  ): Promise<{ remaining: number }>;
  /** Membayar beberapa tagihan sekaligus dalam satu nomor `PAY-…`. */
  payPayables(
    input: PayBatchInput,
  ): Promise<{ batchNumber: string; total: number; bills: number }>;
  /**
   * Analitik lanjutan (`report.advanced`, paket Enterprise). Selalu berbentuk
   * laporan kosong yang sah untuk peran tanpa izin `report.view` atau paket yang
   * tidak memuat fiturnya — jadi halaman tidak perlu tahu backend mana yang
   * aktif maupun apakah laporannya dihitung di server atau di klien.
   */
  analyticsReport: StoreAdvancedReport;
  /** Panjang periode yang sedang dipakai laporan analitik (7 / 30 / 90 hari). */
  analyticsDays: number;
  setAnalyticsDays(days: number): void;
  /**
   * Peran kustom (`rbac.custom`, Phase 4): daftar peran bernama beserta izinnya,
   * dan anggota tim beserta izin efektifnya. Kosong untuk peran tanpa izin
   * `team.manage`, bukan error.
   */
  customRoles: StoreCustomRole[];
  /**
   * Peran bawaan beserta penyesuaiannya (`roleSettings`) — selalu berisi kelima
   * peran, termasuk yang dinonaktifkan/dihapus, karena halaman harus bisa
   * mengaktifkan & memulihkannya kembali.
   */
  builtinRoles: StoreBuiltinRole[];
  roleSummary: StoreRoleSummary;
  teamMembers: StoreTeamMember[];
  /**
   * Mendaftarkan anggota tim baru ke workspace ini; butuh izin `team.manage`
   * (server tetap yang memutuskan). Email yang sudah jadi anggota tidak
   * digandakan — perannya diperbarui, ditandai `created: false`.
   */
  addTeamMember(input: InviteTeamMemberInput): Promise<InvitedTeamMember>;
  /**
   * Menjadwalkan ulang pengiriman email undangan untuk anggota yang sudah ada
   * (mis. undangan pertama gagal, atau alamat uji yang tidak dikirimi email).
   * Hasil kirimnya tetap ditulis server ke `teamMembers[].invite`.
   */
  resendInvite(membershipId: string): Promise<{ email: string }>;
  /**
   * Mengubah satu anggota tim: nama, email, peran, nomor WhatsApp, atau
   * aktif/nonaktifkan. Aturannya sama dengan server (`validateTeamMemberEdit`),
   * termasuk pagar “pemilik terakhir” dan “hanya pemilik yang menyentuh peran
   * pemilik”. `changed` berisi field yang benar-benar berubah.
   */
  updateTeamMember(input: UpdateTeamMemberInput): Promise<{
    email: string;
    changed: string[];
  }>;
  /**
   * Menghapus anggota dari tim ini. Akunnya (`users`) tetap ada — yang hilang
   * hanya aksesnya ke workspace ini; pagar server menahan penghapusan diri
   * sendiri dan hilangnya pemilik aktif terakhir.
   */
  removeTeamMember(membershipId: string): Promise<{ email: string }>;
  /** Mencatat bahwa tautan undangan WhatsApp dibuka pengundang untuk anggota itu. */
  recordWaInvite(membershipId: string): Promise<void>;
  /** Membuat peran kustom; butuh fitur `rbac.custom` + izin `team.manage`. */
  createCustomRole(input: CreateCustomRoleInput): Promise<{ id: string; name: string }>;
  /** Mengubah nama/keterangan/izin/nonaktifkan sebuah peran kustom. */
  updateCustomRole(input: UpdateCustomRoleInput): Promise<void>;
  /** Menghapus peran yang tidak dipakai; peran yang masih ditugaskan ditolak. */
  deleteCustomRole(roleId: string): Promise<void>;
  /** Menugaskan peran kustom; `null` mengembalikan anggota ke peran bawaannya. */
  assignCustomRole(membershipId: string, roleId: string | null): Promise<void>;
  /** Menyunting izin dan/atau menonaktifkan sebuah peran bawaan. */
  updateBuiltinRole(
    input: UpdateBuiltinRoleInput,
  ): Promise<{ role: Role; permissions: Permission[]; active: boolean }>;
  /** Menghapus peran bawaan dari daftar penugasan; ditolak kalau masih dipakai. */
  deleteBuiltinRole(role: Role): Promise<void>;
  /** Memulihkan peran bawaan yang dihapus (izin & statusnya tetap). */
  restoreBuiltinRole(role: Role): Promise<void>;
  /** Mengembalikan izin bawaan sebuah peran (membatalkan penyesuaian izinnya). */
  resetBuiltinRole(role: Role): Promise<void>;
  /**
   * Akses API & webhook (`api.access`, Phase 4): kunci API tenant beserta
   * endpoint webhook dan riwayat kirimannya. Selalu berbentuk daftar kosong
   * untuk peran tanpa izin `api.manage`, dan membuat kunci/endpoint baru butuh
   * fitur `api.access` (paket Enterprise) — sementara **mencabut kunci** dan
   * **mematikan/menghapus endpoint** selalu boleh, supaya mematikan akses tidak
   * pernah terkunci oleh perubahan paket.
   */
  apiKeys: StoreApiKey[];
  apiKeySummary: StoreApiKeySummary;
  webhookEndpoints: StoreWebhookEndpoint[];
  webhookDeliveries: StoreWebhookDelivery[];
  webhookSummary: StoreWebhookSummary;
  /**
   * Membuat kunci API; rahasia (`plaintext`) hanya ada di kembalian ini dan
   * tidak bisa dibaca lagi sesudahnya — sama seperti di server.
   */
  createApiKey(
    input: CreateApiKeyInput,
  ): Promise<{ id: string; name: string; plaintext: string; mask: string; scopes: Permission[] }>;
  /** Mencabut kunci: selalu boleh, tanpa gerbang fitur. */
  revokeApiKey(keyId: string): Promise<void>;
  /** Mendaftarkan endpoint webhook; rahasia penanda tangan hanya tampil sekali. */
  createWebhookEndpoint(
    input: CreateWebhookEndpointInput,
  ): Promise<{ id: string; secret: string }>;
  /** Mengubah langganan/putar rahasia (butuh fitur) atau mematikan endpoint (selalu boleh). */
  updateWebhookEndpoint(input: UpdateWebhookEndpointInput): Promise<{ secret: string | null }>;
  /** Menghapus endpoint beserta riwayat kirimannya; selalu boleh. */
  removeWebhookEndpoint(endpointId: string): Promise<void>;
  /**
   * Mengirim satu payload uji bertanda tangan HMAC ke endpoint. Percobaannya
   * selalu tercatat, jadi kegagalan tidak hilang begitu saja.
   */
  testWebhookEndpoint(endpointId: string): Promise<WebhookTestResult>;
  /**
   * Dukungan khusus (`support.dedicated`, Phase 5): tiket tenant beserta janji
   * SLA paket ini. Selalu berbentuk daftar kosong untuk peran tanpa izin
   * `support.view`; membuka tiket berprioritas Tinggi/Mendesak dan melakukan
   * eskalasi butuh fitur `support.dedicated`, sementara menambah catatan,
   * menutup, dan membuka ulang tiket selalu boleh.
   */
  supportTickets: StoreSupportTicket[];
  supportSummary: StoreSupportSummary;
  supportPlan: StoreSupportPlan;
  supportLimits: StoreSupportLimits;
  /** Membuka tiket baru; prioritas tinggi butuh fitur `support.dedicated`. */
  createSupportTicket(
    input: CreateSupportTicketInput,
  ): Promise<{ id: string; number: string; slaHours: number }>;
  /** Menjalankan satu aksi tiket (catatan/mulai/selesai/buka ulang/eskalasi). */
  actSupportTicket(input: ActSupportTicketInput): Promise<void>;
  /**
   * Pembayaran digital (`payment.digital`, Phase 6): tagihan QRIS/VA tenant.
   * Selalu berbentuk daftar kosong untuk peran tanpa izin `payment.view`;
   * membuat tagihan baru butuh fitur `payment.digital`, sementara menandai lunas
   * dan membatalkannya selalu boleh — uang pelanggan tidak boleh terkunci oleh
   * perubahan paket. Kasir juga bisa menerbitkannya **langsung dari keranjang**
   * (`validateCartCharge` di `@/lib/payments`), dan penjualannya menunjuk tagihan
   * yang sudah lunas lewat `saleNumber` di sini.
   */
  digitalCharges: StoreDigitalCharge[];
  digitalSummary: StoreDigitalSummary;
  digitalPlan: StoreDigitalPlan;
  digitalLimits: StoreDigitalLimits;
  /** Membuat tagihan; nominal, metode, dan tenggatnya ditetapkan server. */
  createDigitalCharge(
    input: CreateDigitalChargeInput,
  ): Promise<{ id: string; number: string; expiresAt: number }>;
  /** Menandai lunas atau membatalkan tagihan (aturan transisi murni). */
  actDigitalCharge(input: ActDigitalChargeInput): Promise<void>;
  /**
   * Sinkronisasi real-time multi-perangkat (`sync.realtime`, Phase 6): perangkat
   * beserta kehadirannya, log perubahan, dan konfliknya. Selalu berbentuk daftar
   * kosong untuk peran tanpa izin `device.manage`; mendaftarkan perangkat & baru
   * mendorong perubahan butuh fitur `sync.realtime`, sementara detak, menarik,
   * dan menandai konflik selesai selalu boleh.
   */
  syncDevices: StoreSyncDevice[];
  syncChanges: StoreSyncChange[];
  syncSummary: StoreSyncSummary;
  syncLagging: string[];
  syncPlan: StoreSyncPlan;
  syncLimits: StoreSyncLimits;
  syncEntities: StoreSyncEntityOption[];
  syncPlatforms: StoreSyncPlatformOption[];
  /** Mendaftarkan perangkat ke hub real-time (butuh fitur `sync.realtime`). */
  registerSyncDevice(
    input: RegisterSyncDeviceInput,
  ): Promise<{ deviceId: string; name: string }>;
  /** Detak kehadiran satu perangkat; selalu boleh. */
  heartbeatSyncDevice(deviceId: string): Promise<void>;
  /** Mendorong perubahan dengan penyelesaian konflik last-write-wins. */
  pushSync(
    input: PushSyncInput,
  ): Promise<{ revision: number; outcome: PushOutcome; reason: string | null }>;
  /**
   * Menarik perubahan di atas kursor dalam satu jendela. Selalu boleh (tanpa
   * gerbang fitur) — perangkat yang kehilangan fiturnya tetap harus bisa
   * menyusul ketinggalannya.
   */
  pullSync(input: PullSyncInput): Promise<PullSyncResult>;
  /** Menandai konflik selesai; selalu boleh. */
  resolveSyncChange(changeId: string): Promise<void>;
  /**
   * Laporan lintas cabang (`scale.franchise`, Phase 5). Selalu berbentuk laporan
   * kosong yang sah untuk peran tanpa izin `report.view` atau paket yang tidak
   * memuat fiturnya — jadi halaman Laporan tidak pernah menampilkan angka yang
   * server tidak akan menghitungnya.
   */
  franchiseReport: StoreFranchiseReport;
  createSale(input: CreateSaleInput): Promise<CreateSaleResult>;
  adjustStock(productId: string, delta: number, note?: string): Promise<number>;
  /** Offline state, surfaced in the POS so a cashier knows what is unsynced. */
  offline: {
    online: boolean;
    pending: number;
    blocked: number;
    sync(): Promise<void>;
    retryBlocked(): void;
  };
}

export const EMPTY_SUMMARY: StoreSummary = {
  revenue: 0,
  tax: 0,
  discount: 0,
  transactions: 0,
  itemCount: 0,
  averagePerTransaction: 0,
  byMethod: { Tunai: 0, QRIS: 0, Kartu: 0, Transfer: 0 },
};

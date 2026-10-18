/**
 * Isi **dokumentasi API publik** MesinPOS (`/dokumentasi-api`) — satu tempat.
 *
 * Halaman publik, pengujian (`scripts/verify-api-docs.mjs`), dan tautan dari
 * halaman API & Webhook membaca berkas ini. Daftar endpoint, method, path, dan
 * scope-nya **tidak ditulis ulang** di sini: semuanya diambil dari
 * `API_RESOURCES` (`src/convex/lib/apiKeys.ts`), tabel yang juga dipakai
 * endpoint HTTP untuk memeriksa scope. Jadi dokumentasi tidak bisa menawarkan
 * endpoint yang tidak dilayani, atau melewatkan endpoint yang baru ditambahkan.
 *
 * Yang ditulis tangan di sini hanya hal yang memang tidak bisa diturunkan dari
 * kode: penjelasan, contoh permintaan/balasan, arti kode status, dan catatan
 * integrasi. Contoh balasannya disalin dari bentuk yang benar-benar dikembalikan
 * `apiAccess.readResource` / `recordOrder`.
 *
 * Dokumentasi ini **publik dan tanpa sesi**: pembacanya adalah pengembang
 * platform mitra (mis. pusatbahanbangunan.com) yang belum punya akun MesinPOS.
 * Tidak ada rahasia di sini — kunci API hanya dibuat pemilik workspace sendiri.
 */

//
// Impor relatif (bukan alias `@/…`) karena berkas ini juga dijalankan langsung
// oleh `scripts/verify-api-docs.mjs` lewat Bun, yang tidak memakai alias
// tsconfig di luar bundler Vite.
import { API_RESOURCES } from "../convex/lib/apiKeys";
import { PERMISSION_LABELS, type Permission } from "../convex/lib/authz";
import { WEBHOOK_EVENTS } from "../convex/lib/webhooks";

/** Versi kontrak yang sedang dilayani. Naikkan kalau bentuknya berubah. */
export const API_DOC_VERSION = "v1";
export const API_DOC_UPDATED = "17 Oktober 2026";

/** Alamat pengganti kalau deployment belum diketahui (mis. saat build statis). */
export const API_BASE_PLACEHOLDER = "https://<deployment>.convex.site";

/**
 * Alamat dasar HTTP action Convex.
 *
 * Aplikasi menyimpan `VITE_CONVEX_URL` (domain `.convex.cloud`), sedangkan
 * HTTP action — termasuk `/api/v1/*` — dilayani di domain `.convex.site`.
 * Konversinya satu arah dan tidak rahasia, jadi halaman publik boleh
 * menampilkannya apa adanya supaya pembaca tidak perlu menebak.
 */
export function apiSiteUrl(convexUrl?: string | null): string {
  const envUrl = (import.meta as { env?: Record<string, string | undefined> }).env
    ?.VITE_CONVEX_URL;
  const raw = (convexUrl ?? envUrl ?? "").trim().replace(/\/+$/, "");
  if (raw.length === 0) return API_BASE_PLACEHOLDER;
  if (raw.endsWith(".convex.cloud")) {
    return `${raw.slice(0, -".convex.cloud".length)}.convex.site`;
  }
  return raw;
}

export interface ApiDocEndpoint {
  /** Kunci resource di `API_RESOURCES`; juga `resource` di balasan. */
  resource: string;
  method: "GET" | "POST";
  path: string;
  title: string;
  summary: string;
  /** Izin yang harus ada di kunci; `null` = cukup kunci yang sah. */
  scope: Permission | null;
  scopeLabel: string;
  /** Parameter query yang dikenal (hanya jalur baca). */
  parameters: { name: string; example: string; description: string }[];
  /** Arti field di balasan, dalam urutan yang muncul. */
  fields: { name: string; type: string; description: string }[];
  /** Contoh badan permintaan (JSON rapi), kalau endpoint menulis. */
  requestExample?: string;
  /** Contoh balasan sukses (JSON rapi). */
  responseExample: string;
  notes: string[];
}

/**
 * Melengkapi penjelasan dengan method/path/scope dari tabel server.
 * Kalau sebuah resource tidak ada di `API_RESOURCES`, modul ini **gagal**
 * saat dimuat — lebih baik halaman rusak kelihatan daripada dokumentasi
 * diam-diam menunjuk endpoint yang tidak dilayani.
 */
function docEndpoint(
  resource: string,
  doc: Omit<
    ApiDocEndpoint,
    "resource" | "method" | "path" | "scope" | "scopeLabel"
  >,
): ApiDocEndpoint {
  const found = API_RESOURCES.find((row) => row.resource === resource);
  if (!found) {
    throw new Error(
      `Dokumentasi API menunjuk resource "${resource}" yang tidak ada di API_RESOURCES.`,
    );
  }
  return {
    ...doc,
    resource,
    method: found.method,
    path: found.path,
    scope: found.scope,
    scopeLabel: found.scope ? PERMISSION_LABELS[found.scope] : "Cukup kunci yang sah",
  };
}

/** Contoh pesanan masuk yang dipakai halaman & harness. */
export const SAMPLE_ORDER_BODY = {
  idempotencyKey: "pusatbahanbangunan-order-2026-000128",
  lines: [
    { sku: "PBB-SEM-000001", quantity: 3, unitCode: "SAK" },
    { sku: "PBB-BSI-000014", quantity: 12 },
  ],
  payment: { method: "transfer" },
  discount: 0,
  customerCode: "B2B-0001",
  memberCode: null,
};

export const API_DOC_ENDPOINTS: ApiDocEndpoint[] = [
  docEndpoint("ping", {
    title: "Cek kunci & identitas workspace",
    summary:
      "Endpoint paling murah untuk memastikan kunci masih sah dan menampilkan workspace mana yang sedang dihubungi.",
    parameters: [],
    fields: [
      {
        name: "data.tenant",
        type: "string | null",
        description: "Nama workspace (tenant) pemilik kunci.",
      },
      { name: "data.planKey", type: "string | null", description: "Paket langganan yang aktif." },
      {
        name: "data.modules",
        type: "string[]",
        description: "Modul vertikal yang menyala (mis. `retail`, `grosir`, `fnb`).",
      },
      { name: "data.serverTime", type: "string (ISO 8601)", description: "Waktu server saat dijawab." },
    ],
    responseExample: `{
  "ok": true,
  "resource": "ping",
  "key": "Pusat Bahan Bangunan",
  "scopes": ["report.view", "inventory.view"],
  "data": {
    "tenant": "Toko Bangunan Sejahtera",
    "planKey": "professional",
    "modules": ["retail", "grosir"],
    "serverTime": "2026-10-17T03:24:11.482Z"
  }
}`,
    notes: [
      "Tidak butuh scope apa pun — cukup kunci yang sah dan belum dicabut.",
      "Cocok dipakai sebagai health check saat platform mitra mulai menyala.",
    ],
  }),
  docEndpoint("sales", {
    title: "Penjualan selesai terbaru",
    summary:
      "Membaca transaksi berstatus selesai dari toko utama workspace, terbaru lebih dulu.",
    parameters: [
      {
        name: "days",
        example: "7",
        description: "Jendela waktu mundur dalam hari, 1–30 (bawaan 7).",
      },
      {
        name: "since",
        example: "1770000000000",
        description:
          "Hanya transaksi yang lebih baru dari milidetik ini; mengalahkan `days` (paling lama 366 hari).",
      },
      {
        name: "limit",
        example: "20",
        description: "Jumlah baris maksimal, 1–100 (bawaan 20).",
      },
    ],
    fields: [
      { name: "number", type: "string", description: "Nomor struk, mis. `A-00042`." },
      { name: "total", type: "number", description: "Total akhir dalam rupiah bulat, sesudah PPN & diskon." },
      { name: "tax", type: "number", description: "PPN yang dipungut pada transaksi itu." },
      { name: "discount", type: "number", description: "Diskon yang diberikan (rupiah)." },
      { name: "method", type: "string | null", description: "Metode pembayaran pertama: `cash`, `qris`, `card`, `transfer`." },
      { name: "createdAt", type: "string (ISO 8601)", description: "Waktu transaksi selesai." },
      { name: "data.total", type: "number", description: "Jumlah baris yang benar-benar dikirim (sesudah saringan status)." },
      { name: "data.days", type: "number", description: "Jendela waktu yang dipakai server (sudah dijepit); tidak dikirim saat `since` dipakai." },
      { name: "data.from", type: "string (ISO 8601)", description: "Batas bawah waktu yang benar-benar dipakai server." },
    ],
    responseExample: `{
  "ok": true,
  "resource": "sales",
  "key": "Pusat Bahan Bangunan",
  "scopes": ["report.view"],
  "data": {
    "sales": [
      {
        "number": "A-00042",
        "total": 734500,
        "tax": 72800,
        "discount": 0,
        "method": "transfer",
        "createdAt": "2026-10-17T02:11:05.900Z"
      }
    ],
    "total": 1,
    "days": 7,
    "from": "2026-10-10T02:11:05.900Z"
  }
}`,
    notes: [
      "Hanya transaksi `completed`: penjualan yang dibatalkan tidak pernah muncul di sini.",
      "Untuk sinkronisasi bertahap, simpan `serverTime` sebelum menarik lalu kirim sebagai `since` pada tarikan berikutnya — jangan memakai `createdAt` baris terakhir (baris yang tersimpan saat tarikan berjalan bisa terlewat).",
      "Nilai `days`/`limit` di luar batas dijepit server, bukan ditolak; angka yang dipakai ikut di balasan (`data.days`).",
      "Rincian baris produk tidak ada di endpoint ini — yang tersedia nomor, total, pajak, diskon, metode, dan waktu.",
    ],
  }),
  docEndpoint("sales.create", {
    title: "Membuat penjualan dari sistem luar",
    summary:
      "Mencatat pesanan yang masuk dari platform mitra sebagai penjualan MesinPOS — lewat jalur yang sama persis dengan kasir.",
    parameters: [],
    fields: [
      { name: "data.id", type: "string", description: "Id penjualan di MesinPOS; simpan untuk rujukan." },
      { name: "data.number", type: "string", description: "Nomor struk yang tercetak di kasir." },
      { name: "data.total", type: "number", description: "Total yang dihitung server (rupiah), termasuk PPN." },
      { name: "data.creditAmount", type: "number", description: "Bagian yang menjadi piutang (0 kalau lunas)." },
      { name: "data.memberDiscount", type: "number", description: "Diskon member yang dihitung server dari data member." },
      { name: "data.deduplicated", type: "boolean", description: "`true` = kiriman ulang `idempotencyKey` yang sama; penjualan tidak dibuat dua kali." },
    ],
    requestExample: JSON.stringify(SAMPLE_ORDER_BODY, null, 2),
    responseExample: `{
  "ok": true,
  "resource": "sales.create",
  "key": "Pusat Bahan Bangunan",
  "data": {
    "id": "j57c9x2m1q8p3d4k6n0r5t7w",
    "number": "A-00043",
    "total": 764500,
    "creditAmount": 764500,
    "memberDiscount": 0,
    "deduplicated": false
  }
}`,
    notes: [
      "Harga **tidak pernah** dikirim klien: harga satuan, harga bertingkat, diskon member, dan PPN dihitung server dari katalog workspace.",
      "`idempotencyKey` wajib, 8–64 karakter (`A-Z a-z 0-9 . _ : -`). Kiriman ulang dengan kunci yang sama dijawab HTTP 200 dengan penjualan yang sama; penjualan baru dijawab HTTP 201.",
      "`payment.amount` boleh dihilangkan — artinya “tagih tepat sebesar total yang dihitung server”. Kalau diisi dan kurang dari total, selisihnya menjadi piutang hanya bila `customerCode` disebut.",
      "Metode pembayaran: `cash`, `qris`, `card`, `transfer`. `provider` & `providerRef` opsional (maks. 40 karakter).",
      "Maksimal 50 baris per pesanan, `quantity` > 0 dan ≤ 100000. Satu SKU + satuan tidak boleh muncul dua kali; gabungkan kuantitasnya.",
      "`unitCode` dipakai untuk satuan besar (mis. `SAK`, `DUS`) bila modul Grosir aktif; tanpa `unitCode` dipakai satuan dasar produk.",
      "Modifier (level pedas, topping) belum didukung lewat API — kirim pesanan tanpa `modifiers`.",
      "Penolakan aturan bisnis (stok kurang, modul mati, limit kredit habis) dijawab HTTP 409 dengan pesan apa adanya dari jalur kasir.",
    ],
  }),
  docEndpoint("products", {
    title: "Katalog beserta stok yang bisa dijual",
    summary:
      "Daftar produk workspace beserta harga jual dan stok yang bisa dijual di toko utama.",
    parameters: [
      { name: "limit", example: "100", description: "Jumlah produk per halaman, 1–100 (bawaan 20)." },
      {
        name: "cursor",
        example: "PBB-SEM-000001",
        description:
          "SKU terakhir halaman sebelumnya; kosongkan untuk mulai dari awal. Lanjutkan sampai `nextCursor` bernilai `null`.",
      },
    ],
    fields: [
      { name: "sku", type: "string", description: "SKU produk — nilai yang dipakai untuk memesan (`lines[].sku`)." },
      { name: "name", type: "string", description: "Nama produk." },
      { name: "category", type: "string | null", description: "Nama kategori katalog, atau `null` kalau produk belum dikategorikan." },
      { name: "subcategory", type: "string | null", description: "Nama subkategori di dalam kategori, atau `null` kalau tidak ada." },
      { name: "price", type: "number", description: "Harga jual satuan dasar (rupiah)." },
      { name: "unit", type: "string", description: "Satuan dasar, mis. `PCS`, `SAK`." },
      { name: "active", type: "boolean", description: "`false` = produk nonaktif dan ditolak saat dipesan." },
      { name: "trackStock", type: "boolean", description: "`false` = stok tidak dilacak (produk jasa)." },
      { name: "sellable", type: "number", description: "Stok yang bisa dijual di toko utama (stok gudang tidak dihitung)." },
      { name: "data.total", type: "number", description: "Jumlah produk yang dikirim pada halaman ini." },
      { name: "data.nextCursor", type: "string | null", description: "SKU terakhir halaman ini, atau `null` kalau katalognya sudah habis." },
    ],
    responseExample: `{
  "ok": true,
  "resource": "products",
  "key": "Pusat Bahan Bangunan",
  "scopes": ["inventory.view"],
  "data": {
    "products": [
      {
        "sku": "PBB-SEM-000001",
        "name": "Semen Portland 40 kg",
        "category": "Semen & Mortar",
        "subcategory": "Semen Portland",
        "price": 68000,
        "unit": "SAK",
        "active": true,
        "trackStock": true,
        "sellable": 240
      }
    ],
    "total": 1,
    "nextCursor": null
  }
}`,
    notes: [
      "`sellable` hanya menjumlahkan stok lokasi jual (bukan gudang), yaitu angka yang dipakai kasir.",
      "`category` & `subcategory` dikirim sebagai **nama**, bukan id internal — pakai keduanya untuk menyusun katalog dua tingkat di platform. Keduanya `null` bila produk tidak punya kategori/subkategori.",
      "Subkategori hanya label katalog: mengubahnya **tidak** mengubah SKU maupun tab kasir, berbeda dengan kategori yang ikut menentukan kode tengah SKU.",
      "Katalog dibaca berurutan menurut SKU dan **berhalaman**: kirim `cursor` dari `nextCursor` sampai bernilai `null`. Tanpa itu, platform hanya menerima halaman pertama.",
      "Perubahan harga yang terjadi setelah salinan awal dikirim lewat webhook `product.updated`, jadi tarikan penuh hanya untuk rekonsiliasi berkala.",
    ],
  }),
  docEndpoint("payables", {
    title: "Hutang usaha yang masih terbuka",
    summary:
      "Tagihan supplier yang belum lunas, diurutkan dari jatuh tempo terdekat — berguna untuk portal supplier atau rekap kewajiban.",
    parameters: [
      { name: "limit", example: "50", description: "Jumlah tagihan maksimal, 1–100 (bawaan 20)." },
    ],
    fields: [
      { name: "number", type: "string", description: "Nomor tagihan." },
      { name: "supplier", type: "string | null", description: "Nama supplier, kalau barisnya masih ada." },
      { name: "balance", type: "number", description: "Sisa yang harus dibayar (rupiah)." },
      { name: "dueDate", type: "string (ISO 8601)", description: "Jatuh tempo." },
      { name: "overdue", type: "boolean", description: "`true` = sudah melewati jatuh tempo." },
      { name: "data.outstanding", type: "number", description: "Jumlah sisa seluruh tagihan yang dikirim." },
    ],
    responseExample: `{
  "ok": true,
  "resource": "payables",
  "key": "Pusat Bahan Bangunan",
  "scopes": ["payable.view"],
  "data": {
    "payables": [
      {
        "number": "PB-00017",
        "supplier": "CV Sumber Semen",
        "balance": 4500000,
        "dueDate": "2026-10-25T00:00:00.000Z",
        "overdue": false
      }
    ],
    "total": 1,
    "outstanding": 4500000
  }
}`,
    notes: [
      "Hanya tagihan berstatus `open`; yang sudah lunas atau dibatalkan tidak dikirim.",
      "`outstanding` adalah jumlah `balance` baris yang dikirim, bukan seluruh hutang workspace kalau `limit` memotong daftarnya.",
    ],
  }),
  docEndpoint("purchases", {
    title: "Penerimaan barang (GRN) terbaru",
    summary:
      "Barang yang sudah diterima dari supplier, lengkap dengan nomor PO, supplier, dan harga beli per baris — dipakai platform untuk mencocokkan pembelian & stok.",
    parameters: [
      {
        name: "days",
        example: "30",
        description: "Jendela waktu mundur dalam hari, 1–90 (bawaan 30).",
      },
      {
        name: "since",
        example: "1770000000000",
        description:
          "Hanya penerimaan yang lebih baru dari milidetik ini; mengalahkan `days` (paling lama 366 hari).",
      },
      {
        name: "limit",
        example: "20",
        description: "Jumlah penerimaan maksimal, 1–100 (bawaan 20).",
      },
    ],
    fields: [
      { name: "number", type: "string", description: "Nomor GRN, mis. `GRN-00012`." },
      { name: "order", type: "string | null", description: "Nomor PO asal barang." },
      { name: "supplier", type: "string | null", description: "Nama supplier penerima barang." },
      { name: "total", type: "number", description: "Nilai barang yang masuk (rupiah)." },
      { name: "receivedAt", type: "string (ISO 8601)", description: "Waktu penerimaan dicatat." },
      { name: "lines[].sku", type: "string | null", description: "SKU produk yang diterima." },
      { name: "lines[].quantity", type: "number", description: "Jumlah yang diterima (satuan dasar)." },
      { name: "lines[].unitCost", type: "number", description: "Harga beli per satuan dasar pada PO." },
      { name: "data.days", type: "number", description: "Jendela waktu yang dipakai server; tidak dikirim saat `since` dipakai." },
      { name: "data.from", type: "string (ISO 8601)", description: "Batas bawah waktu yang benar-benar dipakai server." },
    ],
    responseExample: `{
  "ok": true,
  "resource": "purchases",
  "key": "Pusat Bahan Bangunan",
  "scopes": ["purchase.view"],
  "data": {
    "purchases": [
      {
        "number": "GRN-00012",
        "order": "PO-00008",
        "supplier": "CV Sumber Semen",
        "total": 4500000,
        "receivedAt": "2026-10-16T08:15:00.000Z",
        "lines": [
          { "sku": "PBB-SEM-000001", "name": "Semen Portland 40 kg", "quantity": 60, "unitCost": 75000 }
        ]
      }
    ],
    "total": 1,
    "days": 30,
    "from": "2026-09-16T03:24:11.482Z"
  }
}`,
    notes: [
      "Hanya penerimaan barang (GRN) yang sudah tercatat; PO yang belum datang tidak muncul di sini.",
      "Penerimaan yang baru terjadi juga dikirim realtime lewat webhook `purchase.received`.",
      "Stok yang bertambah karena penerimaan tetap dikirim sebagai `stock.changed` per baris, jadi platform bisa memilih memakai event atau menarik ulang katalog.",
    ],
  }),
];

export interface ApiDocError {
  status: number;
  meaning: string;
  causes: string[];
}

export const API_DOC_ERRORS: ApiDocError[] = [
  {
    status: 200,
    meaning: "Berhasil",
    causes: ["Bacaan berhasil.", "Endpoint tulis: kiriman ulang dengan `idempotencyKey` yang sama."],
  },
  {
    status: 201,
    meaning: "Penjualan baru tercatat",
    causes: ["Hanya untuk `POST /api/v1/sales` dengan `idempotencyKey` yang belum pernah dipakai."],
  },
  {
    status: 400,
    meaning: "Bentuk permintaan salah",
    causes: [
      "Body bukan JSON, atau ada field yang tidak dikenal.",
      "`idempotencyKey`, `lines`, atau `payment` tidak lengkap.",
      "SKU, `customerCode`, atau `memberCode` tidak ada di workspace ini.",
    ],
  },
  {
    status: 401,
    meaning: "Kunci tidak sah",
    causes: [
      "Header `Authorization` tidak dikirim.",
      "Format kunci bukan `mp_<publicId>_<secret>`.",
      "Kunci dicabut, kedaluwarsa, atau rahasianya salah.",
    ],
  },
  {
    status: 403,
    meaning: "Kunci sah, tetapi tidak berhak",
    causes: [
      "Kunci tidak punya scope endpoint itu.",
      "Izin pembuat kunci sudah menyempit (peran diturunkan / peran kustomnya diganti).",
      "Pembuat kunci sudah tidak aktif di workspace; minta pemilik membuat kunci baru.",
    ],
  },
  {
    status: 404,
    meaning: "Resource tidak dikenal",
    causes: ["Path di luar `/api/v1/*` yang dilayani."],
  },
  {
    status: 409,
    meaning: "Keadaan menolak, bukan bentuknya",
    causes: [
      "Stok tidak cukup, produk nonaktif, modul (Grosir/F&B) mati, atau limit kredit habis.",
      "Workspace belum punya toko.",
      "Kunci dibuat sebelum ada jejak pembuat; buat kunci baru.",
    ],
  },
];

export const API_DOC_LIMITS: { label: string; value: string; note: string }[] = [
  {
    label: "`limit`",
    value: "1–100 (bawaan 20)",
    note: "Berlaku untuk `sales`, `products`, dan `payables`.",
  },
  {
    label: "`days`",
    value: "1–30 (bawaan 7) · pembelian 1–90 (bawaan 30)",
    note: "Berlaku untuk `sales` & `purchases`; nilai di luar batas dijepit, bukan ditolak.",
  },
  {
    label: "`since`",
    value: "paling lama 366 hari ke belakang",
    note: "Mengalahkan `days`; nilai di masa depan atau terlalu tua dijepit, bukan ditolak.",
  },
  {
    label: "Katalog per halaman",
    value: "1–100 + `cursor`",
    note: "Lanjutkan dengan `nextCursor` sampai bernilai `null`.",
  },
  {
    label: "Panjang kunci rahasia",
    value: "`mp_` + 10 + `_` + 32",
    note: "Rahasia ditampilkan sekali saat dibuat; yang tersimpan hanya hash-nya.",
  },
  {
    label: "Kunci hidup per workspace",
    value: "maksimal 20",
    note: "Kunci yang sudah dicabut tidak dihitung.",
  },
  {
    label: "Masa berlaku kunci",
    value: "30 / 90 / 365 hari, atau tanpa kedaluwarsa",
    note: "Bawaan 90 hari. Setelah lewat, kunci otomatis ditolak.",
  },
  {
    label: "Baris per pesanan",
    value: "1–50",
    note: "Satu SKU + satuan hanya boleh muncul sekali per pesanan.",
  },
  {
    label: "Kuantitas per baris",
    value: "> 0 dan ≤ 100.000",
    note: "Boleh pecahan bila produknya memang dijual per satuan pecahan.",
  },
  {
    label: "`idempotencyKey`",
    value: "8–64 karakter",
    note: "Huruf, angka, dan `.` `_` `:` `-`. Ditamani per workspace oleh server.",
  },
  {
    label: "Toko yang dipakai",
    value: "toko pertama workspace",
    note: "API v1 belum punya pemilih toko; satu kunci bekerja pada satu toko utama.",
  },
];

export const API_DOC_INTEGRATION_STEPS: { title: string; body: string }[] = [
  {
    title: "1. Siapkan workspace & kunci untuk tiap merchant",
    body:
      "Satu workspace MesinPOS mewakili satu merchant/toko. Pemilik workspace membuat kunci di halaman API & Webhook (`/app/api`, izin `api.manage`, fitur `api.access`) dengan scope sesuai kebutuhan integrasi: `report.view`, `inventory.view`, `payable.view`, dan/atau `pos.sell`. Salin rahasianya saat itu juga — sesudahnya tidak bisa dibaca lagi.",
  },
  {
    title: "2. Tarik katalog untuk platform",
    body:
      "Tarik `GET /api/v1/products?limit=100` berurutan memakai `cursor` sampai `nextCursor` bernilai `null`, lalu simpan `sku`, `name`, `category`, `subcategory`, `price`, `unit`, `active`, `trackStock`, dan `sellable` di sisi platform. Susun katalog dua tingkat dari pasangan kategori/subkategori itu (subkategori boleh `null`). Sesudah salinan awal, perubahan harga maupun katalog cukup diikuti dari webhook `product.updated`. SKU adalah kunci pemetaan produk — jangan memakai id internal MesinPOS.",
  },
  {
    title: "3. Kirim pesanan dari pusatbahanbangunan.com",
    body:
      "Setiap pesanan platform menjadi satu `POST /api/v1/sales`. Pakai ID pesanan platform sebagai `idempotencyKey` (mis. `pusatbahanbangunan-order-2026-000128`) supaya kiriman ulang saat jaringan gagal tidak menjadi penjualan kedua. Simpan `data.id` dan `data.number` untuk rujukan struk.",
  },
  {
    title: "4. Dengar perubahan lewat webhook",
    body:
      "Daftarkan endpoint HTTPS di halaman API & Webhook dan langgani `sale.completed`, `sale.voided`, `product.updated`, `stock.changed`, `purchase.received`, dan `payable.due`. Verifikasi header `x-mesinpos-signature` sebelum memproses, dan pakai `id` di badan kiriman untuk menolak kiriman kembar. Event hanya memberi tahu **apa** yang berubah; angka lengkapnya tetap diambil dari endpoint tarik.",
  },
  {
    title: "5. Rekonsiliasi hutang & omzet",
    body:
      "`GET /api/v1/purchases`, `GET /api/v1/payables`, dan `GET /api/v1/sales` menyamakan pembelian, hutang supplier, dan omzet harian. Semuanya hanya membaca; satu-satunya jalur tulis dari platform adalah pembuatan pesanan (`POST /api/v1/sales`).",
  },
  {
    title: "6. Uji kesehatan sambungan",
    body:
      "Panggil `GET /api/v1/ping` saat platform mulai menyala atau saat kunci dirotasi. Kalau dijawab 401/403, tampilkan pesan dari `error` apa adanya — pesannya sudah menyebut langkah perbaikannya.",
  },
];

export const API_DOC_NOT_YET: string[] = [
  "Mengubah atau menghapus produk, harga, dan stok lewat API.",
  "Membuat pelanggan/member baru; `customerCode` & `memberCode` harus sudah ada di workspace.",
  "Memilih toko selain toko pertama workspace.",
  "Modifier produk (level pedas, topping) pada pesanan masuk.",
  "Paginasi berbasis kursor dan penyaringan per tanggal eksplisit (`from`/`to`).",
  "Webhook masuk dari platform mitra; webhook yang ada adalah **keluar** (MesinPOS → platform).",
  "Endpoint pembatalan/penyesuaian penjualan; pembatalan tetap dilakukan di aplikasi kasir.",
];

/**
 * Model sinkronisasi untuk platform mitra (pusatbahanbangunan.com).
 *
 * MesinPOS adalah **sumber utama**: semua data operasional lahir di sini dan
 * platform menerima salinannya. Satu-satunya jalur tulis dari platform adalah
 * pesanan (`POST /api/v1/sales`), jadi tidak ada dua sisi yang saling menimpa
 * harga atau stok — dan tidak ada loop event yang tak berujung.
 */
export const SYNC_DOC = {
  ownership: [
    {
      entity: "Penjualan",
      direction: "MesinPOS → platform",
      pull: "GET /api/v1/sales?since=…",
      event: "sale.completed · sale.voided",
    },
    {
      entity: "Pembelian (GRN)",
      direction: "MesinPOS → platform",
      pull: "GET /api/v1/purchases?since=…",
      event: "purchase.received",
    },
    {
      entity: "Stok",
      direction: "MesinPOS → platform",
      pull: "GET /api/v1/products (sellable)",
      event: "stock.changed",
    },
    {
      entity: "Harga & katalog",
      direction: "MesinPOS → platform",
      pull: "GET /api/v1/products?cursor=…",
      event: "product.updated",
    },
    {
      entity: "Hutang supplier",
      direction: "MesinPOS → platform",
      pull: "GET /api/v1/payables",
      event: "payable.due",
    },
    {
      entity: "Pesanan dari platform",
      direction: "platform → MesinPOS",
      pull: "—",
      event: "POST /api/v1/sales",
    },
  ],
  steps: [
    {
      title: "1. Salinan awal",
      body:
        "Tarik katalog berhalaman (`cursor` → `nextCursor`), lalu `sales`, `purchases`, dan `payables` dengan `since` satu tahun ke belakang. Simpan `serverTime` dari respons pertama sebagai posisi awal. Catat `serverTime` **sebelum** menarik, bukan sesudahnya.",
    },
    {
      title: "2. Realtime lewat webhook",
      body:
        "Setiap perubahan sesudahnya dikirim sebagai webhook bertanda tangan: penjualan, pembatalan, perubahan harga/katalog, pergerakan stok, penerimaan barang, dan hutang jatuh tempo. Simpan `id` kiriman yang sudah diproses untuk menolak kiriman kembar (percobaan ulang memakai `id` yang sama).",
    },
    {
      title: "3. Rekonsiliasi berkala",
      body:
        "Webhook bisa hilang (penerima mati lebih dari ±14 jam). Setiap 15–60 menit, tarik ulang dengan `since` = waktu rekonsiliasi terakhir yang sudah selesai, dan bandingkan dengan salinan platform. Tarikan penuh katalog cukup sekali sehari.",
    },
    {
      title: "4. Pesanan dari platform",
      body:
        "Kirim pesanan lewat `POST /api/v1/sales` dengan `idempotencyKey` = ID pesanan platform. MesinPOS menjawab 201 untuk pesanan baru dan 200 untuk kiriman ulang; harga, PPN, dan stok tetap dihitung server.",
    },
  ],
  rules: [
    "MesinPOS menang untuk semua data operasional (harga, stok, penjualan, pembelian). Platform tidak mengirim balik perubahan yang berasal dari MesinPOS.",
    "Katalog dua tingkat dibaca dari `category` & `subcategory` pada `GET /api/v1/products`; keduanya nama, bukan id. Subkategori tidak mengubah SKU.",
    "Webhook adalah pemberitahuan, bukan sumber angka: ambil nominal & stok terbaru dari endpoint tarik setelah menerima event.",
    "Pakai `id` kiriman sebagai kunci idempotensi penerima, dan `refType`/`refId` pada `stock.changed` untuk menolak pergerakan yang sama dua kali.",
    "`since` dijepit ke 366 hari; untuk data lebih lama, tarik per periode dengan `days` maksimum 90 hari.",
    "Kalau dua sistem sempat berbeda, rekonsiliasi mengikuti MesinPOS — jangan menimpa harga/stok dari platform.",
    "`product.updated` membawa `changed` (termasuk `deleted`), `category`/`subcategory` terkini, serta `previousSku`/`previousPrice` saat nilainya berubah — pakai itu untuk memetakan ulang produk di platform, bukan menebak dari nama.",
  ],
};

/** Kiriman webhook: header, tanda tangan, dan jadwal percobaan ulang. */
export const WEBHOOK_DOC = {
  headers: [
    { name: "content-type", value: "application/json", note: "Selalu JSON." },
    { name: "x-mesinpos-event", value: "sale.completed", note: "Nama event yang dilanggan." },
    { name: "x-mesinpos-attempt", value: "1", note: "Percobaan ke berapa; badan kiriman tidak berubah." },
    { name: "x-mesinpos-timestamp", value: "1770000000000", note: "Milidetik epoch saat tanda tangan dibuat." },
    {
      name: "x-mesinpos-signature",
      value: "sha256=<hex>",
      note: "HMAC-SHA256(rahasia, `${timestamp}.${body}`).",
    },
  ],
  payloadExample: `{
  "id": "evt_1770000000000_sale.completed_A-00043",
  "event": "sale.completed",
  "createdAt": "2026-10-17T02:11:05.900Z",
  "data": {
    "number": "A-00043",
    "total": 764500,
    "tax": 72800,
    "discount": 0,
    "creditAmount": 764500,
    "itemCount": 2,
    "method": "transfer",
    "paid": 0
  }
}`,
  verifyExample: `import { createHmac, timingSafeEqual } from "node:crypto";

// rahasia endpoint dari halaman API & Webhook (ditampilkan sekali)
const secret = process.env.MESINPOS_WEBHOOK_SECRET;
const timestamp = Number(req.headers["x-mesinpos-timestamp"]);
const signature = req.headers["x-mesinpos-signature"];
const body = rawBody; // string persis seperti diterima, jangan di-JSON-parse dulu

// tolak kiriman basi (toleransi resmi 5 menit)
if (Math.abs(Date.now() - timestamp) > 5 * 60 * 1000) return res.sendStatus(400);

const expected = "sha256=" + createHmac("sha256", secret)
  .update(timestamp + "." + body)
  .digest("hex");

if (signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
  return res.sendStatus(401);
}`,
  retries: "1 · 5 · 30 · 120 · 720 menit (5 percobaan, ± 14,6 jam)",
  notes: [
    "Endpoint wajib HTTPS dan menunjuk host publik; alamat lokal/jaringan dalam ditolak.",
    "Maksimal 10 endpoint per workspace, dan tiap endpoint bisa memilih beberapa event.",
    "Balasan 2xx dianggap terkirim. Selain itu kiriman dicoba ulang sesuai jadwal di atas, lalu berstatus `failed`.",
    "Mematikan atau menghapus endpoint menghentikan percobaan ulang; riwayat kiriman tetap terlihat di halaman API & Webhook.",
    "Rahasia yang hilang bisa diputar (rotate) tanpa mengganti URL endpoint.",
  ],
  /** Katalog event memakai daftar yang sama dengan backend. */
  events: WEBHOOK_EVENTS,
};

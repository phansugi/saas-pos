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
import {
  INBOUND_HEADERS,
  INBOUND_WEBHOOK_EVENTS,
  INBOUND_WEBHOOK_NOTES,
  INBOUND_WEBHOOK_PATH,
} from "../convex/lib/inboundWebhooks";

/** Versi kontrak yang sedang dilayani. Naikkan kalau bentuknya berubah. */
export const API_DOC_VERSION = "v1";
export const API_DOC_UPDATED = "20 Oktober 2026";

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
  method: "GET" | "POST" | "PATCH" | "DELETE";
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
      { name: "data.apiVersion", type: "string", description: "Versi kontrak yang dilayani (`v1`)." },
      {
        name: "data.stores[].code",
        type: "string",
        description: "Kode toko yang dipakai sebagai `storeCode` di endpoint lain.",
      },
      { name: "data.stores[].name", type: "string", description: "Nama toko untuk ditampilkan." },
      { name: "data.stores[].active", type: "boolean", description: "`false` = toko tidak dipakai lagi." },
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
      "`stores` adalah daftar toko workspace; pakai `?storeCode=` (bukan id internal) untuk memilih toko selain toko pertama.",
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
        name: "from",
        example: "2026-10-01T00:00:00Z",
        description:
          "Batas bawah **eksplisit** (inklusif); epoch milidetik atau ISO 8601. Mengalahkan `since`/`days`.",
      },
      {
        name: "to",
        example: "2026-10-20T00:00:00Z",
        description:
          "Batas atas **eksplisit** (eksklusif). `from` + `to` membuat tarikan per periode tidak menghitung baris dua kali.",
      },
      {
        name: "status",
        example: "completed",
        description: "`completed` (bawaan), `void` (pembatalan), atau `all`.",
      },
      {
        name: "cursor",
        example: "1770000000000|A-00042",
        description:
          "Kursor halaman: salin `nextCursor` balasan sebelumnya. Kosongkan untuk mulai dari yang terbaru.",
      },
      {
        name: "limit",
        example: "20",
        description: "Jumlah baris maksimal, 1–100 (bawaan 20).",
      },
      {
        name: "storeCode",
        example: "PUSAT",
        description: "Kode toko (dari `GET /api/v1/ping`); kosong = toko pertama workspace.",
      },
    ],
    fields: [
      { name: "number", type: "string", description: "Nomor struk, mis. `A-00042`." },
      {
        name: "status",
        type: "string",
        description: "`completed` atau `void`. Dengan `status=completed` field ini selalu `completed`.",
      },
      { name: "total", type: "number", description: "Total akhir dalam rupiah bulat, sesudah PPN & diskon." },
      { name: "tax", type: "number", description: "PPN yang dipungut pada transaksi itu." },
      { name: "discount", type: "number", description: "Diskon yang diberikan (rupiah)." },
      { name: "method", type: "string | null", description: "Metode pembayaran pertama: `cash`, `qris`, `card`, `transfer`." },
      { name: "createdAt", type: "string (ISO 8601)", description: "Waktu transaksi selesai." },
      { name: "data.total", type: "number", description: "Jumlah baris yang benar-benar dikirim (sesudah saringan status)." },
      { name: "data.days", type: "number", description: "Jendela waktu yang dipakai server (sudah dijepit); tidak dikirim saat `since` dipakai." },
      { name: "data.from", type: "string (ISO 8601)", description: "Batas bawah waktu yang benar-benar dipakai server." },
      { name: "data.to", type: "string (ISO 8601) | null", description: "Batas atas eksklusif, atau `null` kalau tidak dibatasi." },
      {
        name: "data.nextCursor",
        type: "string | null",
        description: "Kursor halaman berikutnya; `null` = sudah habis.",
      },
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
      "Rincian baris produk tidak ada di endpoint ini — yang tersedia nomor, total, pajak, diskon, metode, status, dan waktu.",
      "Paginasi memakai `nextCursor`: kirim sebagai `cursor` sampai bernilai `null`. Jangan memakai offset — baris baru di depan akan menggesernya.",
      "`from` inklusif dan `to` eksklusif, jadi dua tarikan berurutan (`to=X`, lalu `from=X`) tidak tumpang tindih. Keduanya menerima epoch milidetik atau ISO 8601.",
      "Penjualan yang dibatalkan lewat API maupun kasir muncul dengan `status=void` bila diminta; default tetap hanya penjualan selesai.",
    ],
  }),
  docEndpoint("sales.create", {
    title: "Membuat penjualan dari sistem luar",
    summary:
      "Mencatat pesanan yang masuk dari platform mitra sebagai penjualan MesinPOS — lewat jalur yang sama persis dengan kasir.",
    parameters: [
      {
        name: "storeCode",
        example: "PUSAT",
        description:
          "Toko tempat penjualan dicatat (dari `GET /api/v1/ping`); kosong = toko pertama workspace.",
      },
    ],
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
      "Maksimal 50 baris per pesanan, `quantity` > 0 dan ≤ 100000. Satu SKU + satuan + modifier tidak boleh muncul dua kali; gabungkan kuantitasnya — sedangkan baris dengan modifier berbeda (mis. pedas level 1 vs level 3) memang dua baris.",
      "`lines[].name` opsional: dipakai **hanya** kalau `sku` tidak ditemukan, sebagai cadangan pencocokan. Nama harus persis sama dan menunjuk tepat satu produk; nama kembar tetap ditolak 400 supaya produk yang salah tidak ditebak. Berguna saat katalog sumber mengganti nomor SKU sementara nama produknya tetap.",
      "`unitCode` dipakai untuk satuan besar (mis. `SAK`, `DUS`) bila modul Grosir aktif; tanpa `unitCode` dipakai satuan dasar produk.",
      "`lines[].modifiers` menerima kode grup & opsi (modul F&B), mis. `[{ \"groupCode\": \"LEVEL\", \"optionCodes\": [\"3\"] }, { \"groupCode\": \"TOPPING\", \"optionCodes\": [\"TELUR\"] }]`. Kode itu ada di `modifiers` pada `GET /api/v1/products`, jadi platform tidak perlu menebak.",
      "Grup modifier dengan `minSelect > 0` wajib dipilih; grup/opsi yang tidak dikenal, atau pilihan melebihi `maxSelect`, ditolak 409 dengan pesan dari jalur kasir.",
      "`storeCode` di query memilih toko selain toko pertama workspace. Kode yang tidak dikenal dijawab 404 — bukan diam-diam memakai toko pertama.",
      "Penolakan aturan bisnis (stok kurang, modul mati, limit kredit habis) dijawab HTTP 409 dengan pesan apa adanya dari jalur kasir.",
    ],
  }),
  docEndpoint("products", {
    title: "Katalog beserta stok yang bisa dijual",
    summary:
      "Daftar produk workspace beserta harga jual dan stok yang bisa dijual di toko terpilih.",
    parameters: [
      { name: "limit", example: "100", description: "Jumlah produk per halaman, 1–100 (bawaan 20)." },
      {
        name: "storeCode",
        example: "CABANG",
        description: "Toko yang stok jualnya dibaca; kosong = toko pertama workspace.",
      },
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
      { name: "sellable", type: "number", description: "Stok yang bisa dijual di toko terpilih (stok gudang tidak dihitung)." },
      { name: "data.total", type: "number", description: "Jumlah produk yang dikirim pada halaman ini." },
      {
        name: "modifiers[].groupCode",
        type: "string",
        description: "Kode grup modifier (mis. `LEVEL`, `TOPPING`) — dipakai di `lines[].modifiers[].groupCode`.",
      },
      {
        name: "modifiers[].options[].optionCode",
        type: "string",
        description: "Kode opsi yang dipakai di `lines[].modifiers[].optionCodes`.",
      },
      {
        name: "modifiers[].minSelect",
        type: "number",
        description: "`> 0` = grup wajib dipilih saat memesan.",
      },
      { name: "modifiers[].options[].price", type: "number", description: "Tambahan harga per unit (rupiah)." },
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
      "Subkategori hanya label katalog: mengubahnya **tidak** mengubah SKU maupun tab kasir. Kategori hanya menentukan tab kasir — SKU otomatis berformat `PBB-<nomor urut>` tanpa kode kategori, jadi mengganti kategori juga tidak menulis ulang SKU.",
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
        name: "from",
        example: "2026-09-01T00:00:00Z",
        description:
          "Batas bawah eksplisit (inklusif); epoch milidetik atau ISO 8601. Mengalahkan `since`/`days`.",
      },
      {
        name: "to",
        example: "2026-10-01T00:00:00Z",
        description: "Batas atas eksplisit (eksklusif).",
      },
      {
        name: "cursor",
        example: "1770000000000|GRN-00012",
        description: "Kursor halaman: salin `nextCursor` balasan sebelumnya.",
      },
      {
        name: "limit",
        example: "20",
        description: "Jumlah penerimaan maksimal, 1–100 (bawaan 20).",
      },
      {
        name: "storeCode",
        example: "PUSAT",
        description: "Toko yang penerimaannya dibaca; kosong = toko pertama workspace.",
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
      { name: "data.days", type: "number", description: "Jendela waktu yang dipakai server; tidak dikirim saat `since`/`from` dipakai." },
      { name: "data.from", type: "string (ISO 8601)", description: "Batas bawah waktu yang benar-benar dipakai server." },
      { name: "data.to", type: "string (ISO 8601) | null", description: "Batas atas eksklusif, atau `null`." },
      { name: "data.nextCursor", type: "string | null", description: "Kursor halaman berikutnya; `null` = sudah habis." },
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
  docEndpoint("products.update", {
    title: "Mengubah produk & harga",
    summary:
      "Mengubah nama, harga, satuan, modal, atau status aktif satu produk yang ditunjuk SKU — lewat jalur yang sama dengan halaman Produk.",
    parameters: [],
    fields: [
      { name: "data.sku", type: "string", description: "SKU produk (tidak berubah lewat endpoint ini)." },
      { name: "data.name", type: "string", description: "Nama produk setelah perubahan." },
      { name: "data.price", type: "number", description: "Harga jual satuan dasar setelah perubahan." },
      { name: "data.unit", type: "string", description: "Satuan dasar setelah perubahan." },
      { name: "data.active", type: "boolean", description: "Status aktif setelah perubahan." },
      { name: "data.changed", type: "string[]", description: "Field yang benar-benar berubah (`name`, `price`, `unit`, `active`, `cost`)." },
    ],
    requestExample: `{
  "sku": "PBB-SEM-000001",
  "price": 69000,
  "unit": "SAK",
  "active": true
}`,
    responseExample: `{
  "ok": true,
  "resource": "products.update",
  "key": "Pusat Bahan Bangunan",
  "data": {
    "sku": "PBB-SEM-000001",
    "name": "Semen Portland 40 kg",
    "price": 69000,
    "unit": "SAK",
    "active": true,
    "changed": ["price"]
  }
}`,
    notes: [
      "Kirim minimal satu field perubahan; badan yang hanya berisi `sku` ditolak agar salah kirim tidak dianggap berhasil.",
      "Field asing ditolak 400 — mis. `Price` (huruf besar) tidak diterima diam-diam.",
      "Harga & satuan mengikuti aturan halaman Produk, termasuk modul Grosir untuk harga bertingkat; harga **stok** tidak diubah di sini (pakai `POST /api/v1/stock/adjust`).",
      "Setiap perubahan mengirim webhook `product.updated` ke platform, jadi salinan platform bisa mengikuti tanpa menarik ulang katalog.",
      "SKU tidak bisa diganti lewat API: itu kunci pemetaan produk di platform. Ganti SKU lewat halaman Produk bila memang perlu.",
    ],
  }),
  docEndpoint("products.delete", {
    title: "Menghapus produk",
    summary:
      "Menghapus satu produk yang belum dipakai transaksi, stok, atau dokumen pembelian — pagar yang sama dengan tombol hapus di halaman Produk.",
    parameters: [],
    fields: [
      { name: "data.removed", type: "boolean", description: "Selalu `true` pada balasan sukses." },
      { name: "data.sku", type: "string", description: "SKU produk yang dihapus." },
      { name: "data.name", type: "string", description: "Nama produk yang dihapus." },
    ],
    requestExample: `{
  "sku": "PBB-SEM-000099"
}`,
    responseExample: `{
  "ok": true,
  "resource": "products.delete",
  "key": "Pusat Bahan Bangunan",
  "data": { "removed": true, "sku": "PBB-SEM-000099", "name": "Semen Uji" }
}`,
    notes: [
      "Produk yang sudah pernah terjual, masih berstok, punya pergerakan stok, atau muncul di PO/opname **ditolak 409** dengan alasan per bagian; nonaktifkan (`active: false`) produk seperti itu.",
      "Penghapusan mengirim `product.updated` dengan `changed: [\"deleted\"]` supaya platform bisa melepas pemetaannya.",
      "`DELETE` menerima badan JSON `{ \"sku\" }`; pakai klien HTTP yang memang mengirim badan pada DELETE.",
    ],
  }),
  docEndpoint("stock.adjust", {
    title: "Menyesuaikan stok",
    summary:
      "Menambah/mengurangi stok lokasi jual satu produk (delta), atau menetapkannya ke angka tertentu (quantity).",
    parameters: [
      {
        name: "storeCode",
        example: "CABANG",
        description: "Toko yang stoknya disesuaikan; kosong = toko pertama workspace.",
      },
    ],
    fields: [
      { name: "data.sku", type: "string", description: "SKU produk yang disesuaikan." },
      { name: "data.delta", type: "number", description: "Perubahan yang benar-benar diterapkan (0 bila angka sudah sama)." },
      { name: "data.balance", type: "number", description: "Saldo stok lokasi jual setelah penyesuaian." },
      { name: "data.changed", type: "boolean", description: "`false` = kiriman tidak mengubah apa pun (quantity sama dengan saldo)." },
    ],
    requestExample: `{
  "sku": "PBB-SEM-000001",
  "delta": -3,
  "note": "Kemasan rusak saat bongkar"
}`,
    responseExample: `{
  "ok": true,
  "resource": "stock.adjust",
  "key": "Pusat Bahan Bangunan",
  "data": { "sku": "PBB-SEM-000001", "delta": -3, "balance": 237, "changed": true }
}`,
    notes: [
      "Isi **salah satu**: `delta` (perubahan bertanda, boleh pecahan) atau `quantity` (angka stok baru). Keduanya sekaligus ditolak 400.",
      "Yang disesuaikan hanya **lokasi jual** (angka yang dipakai kasir); stok gudang dipindahkan lewat aplikasi.",
      "Produk yang tidak melacak stok (jasa) ditolak 409.",
      "Setiap penyesuaian tercatat di ledger stok dan dikirim sebagai webhook `stock.changed` dengan `refType: \"adjustment\"`.",
    ],
  }),
  docEndpoint("customers", {
    title: "Pelanggan B2B",
    summary:
      "Daftar pelanggan B2B beserta kode, limit kredit, dan temponya — kode inilah yang dipakai sebagai `customerCode` pada pesanan.",
    parameters: [
      { name: "limit", example: "50", description: "Jumlah pelanggan per halaman, 1–100 (bawaan 20)." },
      { name: "cursor", example: "1770000000000|B2B-0001", description: "Salin `nextCursor` balasan sebelumnya." },
      { name: "from", example: "2026-01-01T00:00:00Z", description: "Hanya pelanggan yang terdaftar sejak waktu ini (inklusif)." },
      { name: "to", example: "2026-10-01T00:00:00Z", description: "Hanya pelanggan yang terdaftar sebelum waktu ini (eksklusif)." },
    ],
    fields: [
      { name: "code", type: "string", description: "Kode pelanggan yang dipakai di pesanan." },
      { name: "name", type: "string", description: "Nama pelanggan." },
      { name: "phone", type: "string | null", description: "Nomor telepon, kalau ada." },
      { name: "creditLimit", type: "number", description: "Limit kredit rupiah; 0 = tunai saja." },
      { name: "paymentTermDays", type: "number", description: "Tempo pembayaran dalam hari." },
      { name: "active", type: "boolean", description: "`false` = pelanggan tidak dipakai lagi." },
      { name: "createdAt", type: "string (ISO 8601)", description: "Waktu pelanggan dibuat." },
      { name: "data.nextCursor", type: "string | null", description: "Kursor halaman berikutnya; `null` = sudah habis." },
    ],
    responseExample: `{
  "ok": true,
  "resource": "customers",
  "key": "Pusat Bahan Bangunan",
  "scopes": ["ar.view"],
  "data": {
    "customers": [
      {
        "code": "B2B-0001",
        "name": "CV Bangun Jaya",
        "phone": "+628123456789",
        "creditLimit": 5000000,
        "paymentTermDays": 14,
        "active": true,
        "createdAt": "2026-09-02T04:10:00.000Z"
      }
    ],
    "total": 1,
    "from": "1970-01-01T00:00:00.000Z",
    "to": null,
    "nextCursor": null
  }
}`,
    notes: [
      "Tanpa `from`/`to`, daftar dimulai dari pelanggan terbaru dan dibatasi `limit`; pakai `nextCursor` untuk melanjutkan.",
      "Saldo piutang tidak dikirim di sini — ia dihitung dari nota yang masih terbuka, bukan disimpan di baris pelanggan.",
    ],
  }),
  docEndpoint("customers.create", {
    title: "Membuat pelanggan B2B",
    summary:
      "Mendaftarkan pelanggan baru dan mengembalikan kodenya, sehingga pesanan berikutnya bisa memakai `customerCode` tanpa membuat pelanggan lewat aplikasi.",
    parameters: [],
    fields: [
      { name: "data.id", type: "string", description: "Id pelanggan di MesinPOS." },
      { name: "data.code", type: "string", description: "Kode pelanggan — pakai ini di `customerCode`." },
      { name: "data.name", type: "string", description: "Nama pelanggan yang tersimpan." },
    ],
    requestExample: `{
  "name": "CV Bangun Jaya",
  "code": "B2B-0001",
  "phone": "08123456789",
  "creditLimit": 5000000,
  "paymentTermDays": 14
}`,
    responseExample: `{
  "ok": true,
  "resource": "customers.create",
  "key": "Pusat Bahan Bangunan",
  "data": { "id": "k57c9x2m1q8p3d4k6n0r5t7w", "code": "B2B-0001", "name": "CV Bangun Jaya" }
}`,
    notes: [
      "`code` boleh dihilangkan: server membuat kode dari nama (mis. `CVBJ`) lalu mengembalikannya. Kode yang dikirim dihormati selama belum dipakai.",
      "`creditLimit` > 0 butuh modul Grosir aktif; tanpa modul, buat pelanggan dengan limit 0 (daftar nama untuk struk) atau aktifkan modulnya dulu.",
      "Pelanggan dengan limit > 0 wajib punya tempo 1–120 hari; `paymentTermDays: 0` ditolak.",
      "Balasan 201 untuk pelanggan baru; kode yang sudah dipakai dijawab 409.",
    ],
  }),
  docEndpoint("members", {
    title: "Member pelanggan",
    summary:
      "Daftar member beserta kode dan diskonnya — kode ini dipakai sebagai `memberCode` pada pesanan.",
    parameters: [
      { name: "limit", example: "50", description: "Jumlah member per halaman, 1–100 (bawaan 20)." },
      { name: "cursor", example: "1770000000000|MBR-0001", description: "Salin `nextCursor` balasan sebelumnya." },
      { name: "from", example: "2026-01-01T00:00:00Z", description: "Hanya member yang terdaftar sejak waktu ini (inklusif)." },
      { name: "to", example: "2026-10-01T00:00:00Z", description: "Hanya member yang terdaftar sebelum waktu ini (eksklusif)." },
    ],
    fields: [
      { name: "code", type: "string", description: "Kode member yang dipakai di pesanan." },
      { name: "name", type: "string", description: "Nama member." },
      { name: "phone", type: "string | null", description: "Nomor telepon, kalau ada." },
      { name: "discountPct", type: "number", description: "Diskon member dalam persen (0–50); dihitung server saat menjual." },
      { name: "active", type: "boolean", description: "`false` = member tidak dipakai lagi." },
      { name: "createdAt", type: "string (ISO 8601)", description: "Waktu member dibuat." },
      { name: "data.nextCursor", type: "string | null", description: "Kursor halaman berikutnya; `null` = sudah habis." },
    ],
    responseExample: `{
  "ok": true,
  "resource": "members",
  "key": "Pusat Bahan Bangunan",
  "scopes": ["member.view"],
  "data": {
    "members": [
      { "code": "MBR-0001", "name": "Siti", "phone": "+628111222333", "discountPct": 5, "active": true, "createdAt": "2026-08-11T02:00:00.000Z" }
    ],
    "total": 1,
    "from": "1970-01-01T00:00:00.000Z",
    "to": null,
    "nextCursor": null
  }
}`,
    notes: [
      "Member dan pelanggan B2B adalah dua hal berbeda: member memberi diskon, pelanggan B2B memberi tempo & limit kredit.",
      "Diskon yang tercatat selalu dihitung ulang dari `discountPct` di server saat penjualan, bukan dari kiriman platform.",
    ],
  }),
  docEndpoint("members.create", {
    title: "Membuat member",
    summary:
      "Mendaftarkan member baru dan mengembalikan kodenya, sehingga pesanan berikutnya bisa memakai `memberCode` tanpa membuatnya lewat aplikasi.",
    parameters: [],
    fields: [
      { name: "data.id", type: "string", description: "Id member di MesinPOS." },
      { name: "data.code", type: "string", description: "Kode member — pakai ini di `memberCode`." },
      { name: "data.name", type: "string", description: "Nama member yang tersimpan." },
    ],
    requestExample: `{
  "name": "Siti",
  "phone": "08111222333",
  "discountPct": 5
}`,
    responseExample: `{
  "ok": true,
  "resource": "members.create",
  "key": "Pusat Bahan Bangunan",
  "data": { "id": "m57c9x2m1q8p3d4k6n0r5t7w", "code": "SITI", "name": "Siti" }
}`,
    notes: [
      "`code` boleh dihilangkan: server membuatnya dari nama lalu mengembalikannya.",
      "`discountPct` > 0 butuh modul UMKM (`member.discount`) aktif; diskon maksimal 50%.",
      "Balasan 201 untuk member baru; kode yang sudah dipakai dijawab 409.",
    ],
  }),
  docEndpoint("sales.void", {
    title: "Membatalkan penjualan",
    summary:
      "Membatalkan penjualan lewat nomor struk — jalur yang sama dengan tombol batal di aplikasi kasir: stok kembali dan piutang yang belum dibayar ikut batal.",
    parameters: [
      {
        name: "storeCode",
        example: "PUSAT",
        description: "Kalau diisi, penjualan harus milik toko itu; kosong = toko pertama workspace.",
      },
    ],
    fields: [
      { name: "data.number", type: "string", description: "Nomor struk yang dibatalkan." },
      { name: "data.status", type: "string", description: "Selalu `void`." },
      { name: "data.alreadyVoided", type: "boolean", description: "`true` = penjualan memang sudah batal sebelumnya (idempoten)." },
      { name: "data.restocked", type: "boolean", description: "`true` = stok dikembalikan oleh permintaan ini." },
    ],
    requestExample: `{
  "number": "A-00043",
  "reason": "Pesanan platform dibatalkan pembeli"
}`,
    responseExample: `{
  "ok": true,
  "resource": "sales.void",
  "key": "Pusat Bahan Bangunan",
  "data": { "number": "A-00043", "status": "void", "alreadyVoided": false, "restocked": true }
}`,
    notes: [
      "Butuh scope `pos.void` — izin yang memang memisahkan pembatalan dari penjualan, juga di aplikasi kasir.",
      "Pembatalan tetap bisa dilakukan di aplikasi kasir; endpoint ini hanya jalur lain ke aturan yang sama, bukan cara menghindari pagarnya.",
      "Piutang yang **sudah menerima pembayaran** tidak bisa dihapus dengan pembatalan: selesaikan piutangnya dulu (ditolak 409 dengan nominalnya).",
      "Penjualan yang sudah batal dijawab 200 dengan `alreadyVoided: true` — kiriman ulang aman.",
      "Webhook `sale.voided` dikirim ke semua endpoint yang melanggannya.",
    ],
  }),
  docEndpoint("inboundWebhooks", {
    title: "Daftar webhook masuk",
    summary:
      "Endpoint webhook masuk yang terdaftar (arah platform → MesinPOS) beserta peristiwa terakhir yang diterima.",
    parameters: [
      { name: "limit", example: "20", description: "Jumlah peristiwa terakhir yang dikirim, 1–100 (bawaan 20)." },
    ],
    fields: [
      { name: "endpoints[].id", type: "string", description: "Id endpoint; dipakai saat menghapus." },
      { name: "endpoints[].name", type: "string", description: "Nama endpoint." },
      { name: "endpoints[].path", type: "string", description: "Path penerima; tempel ke alamat `.convex.site` deployment." },
      { name: "endpoints[].events", type: "string[]", description: "Event yang dilanggan endpoint ini." },
      { name: "endpoints[].secretLastFour", type: "string", description: "Empat karakter terakhir rahasia penanda tangan." },
      { name: "events[].status", type: "string", description: "`applied`, `rejected`, atau `duplicate`." },
      { name: "events[].message", type: "string | null", description: "Alasan penolakan, kalau ada." },
    ],
    responseExample: `{
  "ok": true,
  "resource": "inboundWebhooks",
  "key": "Integrasi Marketplace",
  "scopes": ["api.manage"],
  "data": {
    "endpoints": [
      {
        "id": "j57c9x2m1q8p3d4k6n0r5t7w",
        "name": "Marketplace Pusat",
        "path": "/api/v1/webhooks/incoming/whi_8k2m4q7x9p1s3v5z6b8n",
        "events": ["order.created", "stock.adjusted"],
        "active": true,
        "secretLastFour": "a1b2",
        "storeCode": "PUSAT",
        "createdAt": "2026-10-20T02:00:00.000Z",
        "updatedAt": "2026-10-20T02:00:00.000Z"
      }
    ],
    "total": 1,
    "events": [
      {
        "eventId": "ord-2026-000128",
        "event": "order.created",
        "status": "applied",
        "message": null,
        "receivedAt": "2026-10-20T02:05:11.000Z"
      }
    ],
    "nextCursor": null
  }
}`,
    notes: [
      "Daftar ini untuk pemilik integrasi; rahasianya hanya dikembalikan sekali saat endpoint dibuat.",
      "Peristiwa yang ditolak tetap dicatat beserta alasannya, jadi mitra bisa ditunjukkan apa yang salah tanpa membuka log server.",
    ],
  }),
  docEndpoint("inboundWebhooks.create", {
    title: "Membuat webhook masuk",
    summary:
      "Mendaftarkan endpoint yang boleh dikirimi peristiwa oleh platform mitra, lengkap dengan rahasia penanda tangan.",
    parameters: [
      {
        name: "storeCode",
        example: "PUSAT",
        description: "Toko bawaan endpoint (boleh juga dikirim di badan); kosong = toko pertama workspace.",
      },
    ],
    fields: [
      { name: "data.id", type: "string", description: "Id endpoint." },
      { name: "data.url", type: "string", description: "Alamat lengkap yang ditempel mitra; memuat token endpoint." },
      { name: "data.secret", type: "string", description: "Rahasia HMAC — hanya tampil sekali di balasan ini." },
      { name: "data.events", type: "string[]", description: "Event yang dilanggan." },
      { name: "data.storeId", type: "string | null", description: "Toko bawaan endpoint." },
    ],
    requestExample: `{
  "name": "Marketplace Pusat",
  "events": ["order.created", "stock.adjusted"],
  "storeCode": "PUSAT"
}`,
    responseExample: `{
  "ok": true,
  "resource": "inboundWebhooks.create",
  "key": "Integrasi Marketplace",
  "data": {
    "id": "j57c9x2m1q8p3d4k6n0r5t7w",
    "name": "Marketplace Pusat",
    "url": "https://<deployment>.convex.site/api/v1/webhooks/incoming/whi_8k2m4q7x9p1s3v5z6b8n",
    "secret": "Xn3q...ditampilkan sekali",
    "events": ["order.created", "stock.adjusted"],
    "storeId": "k17c9x2m1q8p3d4k6n0r5t7w"
  }
}`,
    notes: [
      "Event yang tersedia: `order.created`, `stock.adjusted`, `product.updated`, `sale.voided` — lihat bagian **Webhook masuk** di bawah.",
      "`secret` boleh dikirim (nilai yang sama dengan yang disimpan platform mitra) atau dihilangkan agar server membuatnya. Panjang 16–128 karakter tanpa spasi/non-ASCII.",
      "Maksimal 5 endpoint aktif per workspace; nama endpoint harus berbeda.",
      "Membuat endpoint butuh fitur `api.access` dan izin `api.manage` milik pembuat kunci.",
    ],
  }),
  docEndpoint("inboundWebhooks.delete", {
    title: "Menghapus webhook masuk",
    summary: "Menghapus endpoint webhook masuk; kiriman berikutnya ke URL itu dijawab 404.",
    parameters: [],
    fields: [
      { name: "data.removed", type: "boolean", description: "Selalu `true`." },
      { name: "data.id", type: "string", description: "Id endpoint yang dihapus." },
      { name: "data.name", type: "string", description: "Nama endpoint yang dihapus." },
    ],
    requestExample: `{
  "id": "j57c9x2m1q8p3d4k6n0r5t7w"
}`,
    responseExample: `{
  "ok": true,
  "resource": "inboundWebhooks.delete",
  "key": "Integrasi Marketplace",
  "data": { "removed": true, "id": "j57c9x2m1q8p3d4k6n0r5t7w", "name": "Marketplace Pusat" }
}`,
    notes: [
      "Riwayat peristiwa yang sudah diterima tetap tersimpan untuk pemeriksaan.",
      "Tidak ada rahasia yang bisa dipulihkan dari endpoint yang dihapus; buat endpoint baru bila mitra perlu mengirim lagi.",
    ],
  }),
  docEndpoint("inboundWebhooks.receive", {
    title: "Menerima peristiwa mitra",
    summary:
      "Endpoint yang dipanggil **platform mitra** untuk mengirim peristiwa ke MesinPOS. Diverifikasi tanda tangan HMAC endpoint, bukan kunci API.",
    parameters: [
      {
        name: "token (di path)",
        example: "whi_8k2m4q7x9p1s3v5z6b8n",
        description: "Bagian terakhir URL dari `POST /api/v1/webhooks`.",
      },
    ],
    fields: [
      { name: "duplicate", type: "boolean", description: "`true` = `id` peristiwa ini sudah pernah diproses; operasinya tidak dijalankan lagi." },
      { name: "event", type: "string", description: "Event yang diterima." },
      { name: "data", type: "object", description: "Hasil operasi (mis. `number`, `total` untuk pesanan)." },
    ],
    requestExample: `{
  "id": "ord-2026-000128",
  "event": "order.created",
  "data": {
    "storeCode": "PUSAT",
    "lines": [{ "sku": "PBB-SEM-000001", "quantity": 2, "unitCode": "SAK" }],
    "payment": { "method": "transfer" }
  }
}`,
    responseExample: `{
  "ok": true,
  "resource": "inboundWebhooks.receive",
  "event": "order.created",
  "duplicate": false,
  "data": { "id": "j57c9x2m1q8p3d4k6n0r5t7w", "number": "A-00044", "total": 138000, "duplicate": false }
}`,
    notes: [
      "Header: `x-mesinpos-timestamp`, `x-mesinpos-signature` (`sha256=HMAC(secret, timestamp + \".\" + body)`), `x-mesinpos-event`, dan opsional `x-mesinpos-event-id`.",
      "`id` peristiwa wajib (badan atau header `x-mesinpos-event-id`) dan menjadi kunci idempotensi: kiriman ulang dijawab 200 dengan `duplicate: true`.",
      "Balasan 202 = peristiwa baru diterapkan; 200 = kiriman ulang; 400 = bentuk/aturan ditolak; 401 = tanda tangan salah/basi; 410 = endpoint dinonaktifkan.",
      "Operasi dijalankan sebagai pembuat endpoint, jadi izin yang berlaku adalah izin orang itu (mis. `pos.sell` untuk `order.created`).",
      "Tidak ada antrean ulang di sisi MesinPOS: mitra yang tidak menerima 2xx dianjurkan mengirim ulang dengan `id` yang sama.",
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
    causes: [
      "Bacaan berhasil.",
      "Endpoint tulis: kiriman ulang dengan `idempotencyKey` yang sama, pembatalan yang sudah batal, atau peristiwa webhook masuk yang sudah pernah diterima.",
    ],
  },
  {
    status: 201,
    meaning: "Resource baru tercatat",
    causes: [
      "Penjualan (`POST /api/v1/sales`), pelanggan, member, atau endpoint webhook masuk yang baru dibuat.",
    ],
  },
  {
    status: 202,
    meaning: "Peristiwa mitra diterima",
    causes: ["Hanya `POST /api/v1/webhooks/incoming/<token>` untuk peristiwa yang baru diterapkan."],
  },
  {
    status: 400,
    meaning: "Bentuk permintaan salah",
    causes: [
      "Body bukan JSON, atau ada field yang tidak dikenal.",
      "`idempotencyKey`, `lines`, atau `payment` tidak lengkap; `delta` dan `quantity` dikirim bersamaan; `price` bukan bilangan bulat.",
      "SKU, `customerCode`, atau `memberCode` tidak ada di workspace ini.",
      "`from`/`to`/`cursor` tidak bisa diurai, atau `from` tidak lebih awal dari `to`.",
      "Tanda tangan webhook masuk sah tetapi event/badan peristiwanya tidak dikenal.",
    ],
  },
  {
    status: 401,
    meaning: "Kunci atau tanda tangan tidak sah",
    causes: [
      "Header `Authorization` tidak dikirim.",
      "Format kunci bukan `mp_<publicId>_<secret>`.",
      "Kunci tidak dikenal (sudah dicabut & dihapus), kedaluwarsa, atau rahasianya salah.",
      "Webhook masuk: `x-mesinpos-signature` salah atau `x-mesinpos-timestamp` lebih dari 5 menit dari waktu server.",
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
    causes: [
      "Path di luar `/api/v1/*` yang dilayani.",
      "`storeCode` tidak ada di workspace ini (kode yang tersedia dikirim di pesan galat).",
      "SKU, nomor struk, atau id endpoint webhook masuk tidak ditemukan di workspace/toko ini.",
    ],
  },
  {
    status: 409,
    meaning: "Keadaan menolak, bukan bentuknya",
    causes: [
      "Stok tidak cukup, produk nonaktif, modul (Grosir/F&B) mati, atau limit kredit habis.",
      "Workspace belum punya toko.",
      "Kunci dibuat sebelum ada jejak pembuat; buat kunci baru.",
      "Produk yang masih dipakai transaksi/stok diminta dihapus; nonaktifkan saja.",
      "Pembatalan penjualan yang piutangnya sudah menerima pembayaran.",
    ],
  },
  {
    status: 410,
    meaning: "Endpoint webhook masuk sudah dinonaktifkan",
    causes: ["Endpoint dihapus atau dimatikan pemilik workspace; mitra harus memakai endpoint baru."],
  },
  {
    status: 413,
    meaning: "Badan kiriman terlalu besar",
    causes: ["Peristiwa webhook masuk melebihi 64.000 karakter."],
  },
];

export const API_DOC_LIMITS: { label: string; value: string; note: string }[] = [
  {
    label: "`limit`",
    value: "1–100 (bawaan 20)",
    note: "Berlaku untuk `sales`, `products`, `payables`, `customers`, `members`, dan daftar webhook masuk.",
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
    label: "`from` / `to`",
    value: "epoch milidetik atau ISO 8601",
    note: "`from` inklusif, `to` eksklusif, dan `from` harus lebih awal. Nilai yang tidak bisa diurai ditolak 400 (bukan dijepit).",
  },
  {
    label: "Halaman bertanggal",
    value: "1–100 + `cursor` (`waktu|kunci`)",
    note: "Berlaku untuk `sales`, `purchases`, `customers`, `members`. Lanjutkan dengan `nextCursor` sampai `null`; kursor memecah baris yang lahir pada milidetik yang sama.",
  },
  {
    label: "Katalog per halaman",
    value: "1–100 + `cursor` (SKU)",
    note: "Berlaku untuk `products`; lanjutkan dengan `nextCursor` sampai bernilai `null`.",
  },
  {
    label: "`storeCode`",
    value: "kode toko dari `GET /api/v1/ping`",
    note: "Kosong = toko pertama workspace. Kode yang tidak dikenal dijawab 404, bukan diam-diam memakai toko pertama.",
  },
  {
    label: "Modifier per baris",
    value: "maksimal 6 grup, 6 pilihan per grup",
    note: "Sama dengan batas di aplikasi kasir; grup dengan `minSelect > 0` wajib dipilih.",
  },
  {
    label: "Endpoint webhook masuk",
    value: "maksimal 5 endpoint aktif",
    note: "Nama harus berbeda; rahasia 16–128 karakter dan hanya ditampilkan sekali.",
  },
  {
    label: "Badan peristiwa masuk",
    value: "maksimal 64.000 karakter",
    note: "Lebih dari itu ditolak 413 sebelum tanda tangan dihitung.",
  },
  {
    label: "`price` / `cost` lewat API",
    value: "bilangan bulat rupiah ≥ 0",
    note: "Pecahan ditolak 400 supaya tidak ada pembulatan diam-diam di harga.",
  },
  {
    label: "Panjang kunci rahasia",
    value: "`mp_` + 10 + `_` + 32",
    note: "Rahasia ditampilkan sekali saat dibuat; yang tersimpan hanya hash-nya.",
  },
  {
    label: "Kunci hidup per workspace",
    value: "maksimal 20",
    note: "Kunci yang sudah dicabut dihapus, jadi tidak dihitung.",
  },
  {
    label: "Masa berlaku kunci",
    value: "30 / 90 / 365 hari, atau tanpa kedaluwarsa",
    note: "Bawaan 90 hari. Setelah lewat, kunci otomatis ditolak.",
  },
  {
    label: "Baris per pesanan",
    value: "1–50",
    note: "Satu SKU + satuan + modifier hanya boleh muncul sekali per pesanan.",
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
];

export const API_DOC_INTEGRATION_STEPS: { title: string; body: string }[] = [
  {
    title: "1. Siapkan workspace, toko & kunci untuk tiap merchant",
    body:
      "Satu workspace MesinPOS mewakili satu merchant. Pemilik membuat kunci di halaman API & Webhook (`/app/api`, izin `api.manage`, fitur `api.access`) dengan scope sesuai kebutuhan: `report.view`, `inventory.view`, `payable.view`, `purchase.view`, `ar.manage`, `member.manage`, `product.manage`, `stock.adjust`, `pos.sell`, dan/atau `pos.void`. Panggil `GET /api/v1/ping` untuk membaca daftar `stores[].code`; kode itulah yang dikirim sebagai `storeCode` bila merchant punya lebih dari satu toko.",
  },
  {
    title: "2. Tarik katalog untuk platform",
    body:
      "Tarik `GET /api/v1/products?limit=100` berurutan memakai `cursor` sampai `nextCursor` bernilai `null`, lalu simpan `sku`, `name`, `category`, `subcategory`, `price`, `unit`, `active`, `trackStock`, `sellable`, dan `modifiers`. Susun katalog dua tingkat dari pasangan kategori/subkategori itu (subkategori boleh `null`). Sesudah salinan awal, perubahan harga maupun katalog cukup diikuti dari webhook `product.updated`. SKU adalah kunci pemetaan produk — jangan memakai id internal MesinPOS.",
  },
  {
    title: "3. Ubah harga, produk & stok dari platform",
    body:
      "`PATCH /api/v1/products` (scope `product.manage`) mengubah nama, harga, satuan, modal, atau status aktif satu SKU; `DELETE /api/v1/products` menghapus produk yang belum dipakai transaksi; `POST /api/v1/stock/adjust` (scope `stock.adjust`) mengoreksi stok lokasi jual dengan `delta` atau `quantity`. Semua jalur memakai aturan aplikasi yang sama, mengirim webhook (`product.updated`/`stock.changed`), dan menulis audit atas nama pembuat kunci.",
  },
  {
    title: "4. Kirim pesanan dari pusatbahanbangunan.com",
    body:
      "Setiap pesanan platform menjadi satu `POST /api/v1/sales`. Pakai ID pesanan platform sebagai `idempotencyKey` (mis. `pusatbahanbangunan-order-2026-000128`) supaya kiriman ulang saat jaringan gagal tidak menjadi penjualan kedua, dan `?storeCode=` bila pesanan itu milik cabang tertentu. Baris bisa membawa `modifiers` (kode grup/opsi dari `GET /api/v1/products`) untuk level pedas atau topping. Simpan `data.id` dan `data.number` untuk rujukan struk.",
  },
  {
    title: "5. Batalkan pesanan yang gagal",
    body:
      "`POST /api/v1/sales/void` (scope `pos.void`) membatalkan penjualan lewat nomor struk: stok kembali, piutang yang belum dibayar batal, dan webhook `sale.voided` terkirim. Pembatalan dengan piutang yang sudah menerima uang tetap ditolak — uang yang sudah masuk harus diselesaikan dulu, bukan dihapus. Aplikasi kasir memakai aturan yang sama.",
  },
  {
    title: "6. Dengar perubahan lewat webhook keluar",
    body:
      "Daftarkan endpoint HTTPS di halaman API & Webhook dan langgani `sale.completed`, `sale.voided`, `product.updated`, `stock.changed`, `purchase.received`, dan `payable.due`. Verifikasi header `x-mesinpos-signature` sebelum memproses, dan pakai `id` di badan kiriman untuk menolak kiriman kembar. Event hanya memberi tahu **apa** yang berubah; angka lengkapnya tetap diambil dari endpoint tarik.",
  },
  {
    title: "7. Kirim peristiwa balik lewat webhook masuk",
    body:
      "Kalau platform perlu mendorong perubahan tanpa menunggu tarikan (mis. pesanan marketplace, koreksi stok), daftarkan endpoint masuk lewat `POST /api/v1/webhooks` (scope `api.manage`) dengan event `order.created`, `stock.adjusted`, `product.updated`, atau `sale.voided`. Mitra mengirim `POST /api/v1/webhooks/incoming/<token>` bertanda tangan HMAC, dengan `id` peristiwa sebagai kunci idempotensi. Riwayat dan alasan penolakan bisa dibaca di `GET /api/v1/webhooks`.",
  },
  {
    title: "8. Rekonsiliasi & uji kesehatan",
    body:
      "`GET /api/v1/purchases`, `GET /api/v1/payables`, dan `GET /api/v1/sales` menyamakan pembelian, hutang, dan omzet; gunakan `from`/`to` per periode dan `nextCursor` untuk halaman berikutnya. Panggil `GET /api/v1/ping` saat platform mulai menyala atau kunci dirotasi. Kalau dijawab 401/403/404, tampilkan pesan dari `error` apa adanya — pesannya sudah menyebut langkah perbaikannya.",
  },
];

export const API_DOC_NOT_YET: string[] = [
  "Membuat produk baru lewat API; produk & kategori masih dibuat di aplikasi.",
  "Mengubah nominal penjualan yang sudah tercatat (hanya pembatalan utuh); koreksi dilakukan dengan pembatalan lalu penjualan baru.",
  "Menghapus pelanggan/member lewat API; yang tersedia baru membuat & membaca.",
  "Antrean ulang peristiwa webhook masuk di sisi MesinPOS — mitra yang mengirim ulang dengan `id` yang sama.",
];

/**
 * Model sinkronisasi untuk platform mitra (pusatbahanbangunan.com).
 *
 * MesinPOS adalah **sumber utama** data operasional: penjualan, pembelian, dan
 * saldo stok lahir di sini dan platform menerima salinannya. Platform boleh
 * menulis lewat API, tetapi hanya pada jalur yang disepakati — pesanan
 * (`POST /api/v1/sales`), harga/katalog (`PATCH`/`DELETE /api/v1/products`),
 * koreksi stok (`POST /api/v1/stock/adjust`), dan peristiwa webhook masuk yang
 * dilanggan. Setiap tulisan tetap melewati aturan aplikasi dan mengirim event
 * balik, jadi tidak ada dua sisi yang diam-diam saling menimpa.
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
      event: "POST /api/v1/sales · webhook masuk `order.created`",
    },
    {
      entity: "Harga, produk & stok dari platform",
      direction: "platform → MesinPOS",
      pull: "—",
      event: "PATCH/DELETE /api/v1/products · /api/v1/stock/adjust · webhook masuk `product.updated` / `stock.adjusted`",
    },
    {
      entity: "Pembatalan dari platform",
      direction: "platform → MesinPOS",
      pull: "—",
      event: "POST /api/v1/sales/void · webhook masuk `sale.voided`",
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
        "Webhook bisa hilang (penerima mati lebih dari ±14 jam). Setiap 15–60 menit, tarik ulang dengan `from` = waktu rekonsiliasi terakhir dan `to` = sekarang, halaman demi halaman lewat `nextCursor`, lalu bandingkan dengan salinan platform. Tarikan penuh katalog cukup sekali sehari.",
    },
    {
      title: "4. Pesanan dari platform",
      body:
        "Kirim pesanan lewat `POST /api/v1/sales` dengan `idempotencyKey` = ID pesanan platform, atau lewat webhook masuk `order.created` bila platform memakai dorongan peristiwa. MesinPOS menjawab 201/202 untuk pesanan baru dan 200 untuk kiriman ulang; harga, PPN, dan stok tetap dihitung server.",
    },
    {
      title: "5. Peristiwa masuk (platform → MesinPOS)",
      body:
        "Webhook masuk memakai URL bertoken dan tanda tangan HMAC per endpoint. `id` peristiwa adalah kunci idempotensi; event di luar langganan ditolak dengan daftar yang dilanggan, dan alasan penolakan terlihat di `GET /api/v1/webhooks`. Tidak ada antrean ulang di sisi MesinPOS — mitra yang mengirim ulang dengan `id` yang sama.",
    },
  ],
  rules: [
    "MesinPOS memegang data operasional (penjualan, pembelian, saldo stok). Platform boleh menulis lewat endpoint & peristiwa yang disepakati di atas — bukan dengan menimpa angka secara langsung.",
    "Katalog dua tingkat dibaca dari `category` & `subcategory` pada `GET /api/v1/products`; keduanya nama, bukan id. Subkategori tidak mengubah SKU.",
    "Webhook adalah pemberitahuan, bukan sumber angka: ambil nominal & stok terbaru dari endpoint tarik setelah menerima event.",
    "Pakai `id` kiriman sebagai kunci idempotensi penerima, dan `refType`/`refId` pada `stock.changed` untuk menolak pergerakan yang sama dua kali.",
    "`since` dijepit ke 366 hari; untuk data lebih lama, tarik per periode dengan `from`/`to` (maksimum 90 hari per tarikan pembelian).",
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

/**
 * Webhook **masuk** (platform mitra → MesinPOS): alamat, header, dan event.
 *
 * Semua nama diambil dari aturan backend (`lib/inboundWebhooks.ts`), jadi
 * dokumentasi tidak bisa menyebut header atau event yang tidak diterima.
 */
export const INBOUND_WEBHOOK_DOC = {
  path: `${INBOUND_WEBHOOK_PATH}/<token>`,
  headers: [
    { name: INBOUND_HEADERS.timestamp, value: "1770000000000", note: "Milidetik epoch; selisih maksimal 5 menit." },
    { name: INBOUND_HEADERS.signature, value: "sha256=<hex>", note: "HMAC-SHA256(rahasia endpoint, `${timestamp}.${body}`)." },
    { name: INBOUND_HEADERS.event, value: "order.created", note: "Nama event; boleh juga di badan kiriman, tetapi keduanya harus sama." },
    { name: INBOUND_HEADERS.eventId, value: "ord-2026-000128", note: "Opsional; `id` di badan lebih diutamakan. Dipakai sebagai kunci idempotensi." },
  ],
  payloadExample: `{
  "id": "ord-2026-000128",
  "event": "order.created",
  "data": {
    "storeCode": "PUSAT",
    "lines": [
      { "sku": "PBB-SEM-000001", "quantity": 2, "unitCode": "SAK" },
      { "sku": "KOPI-SUSU", "quantity": 1, "modifiers": [{ "groupCode": "LEVEL", "optionCodes": ["3"] }] }
    ],
    "payment": { "method": "transfer" },
    "customerCode": "B2B-0001"
  }
}`,
  events: INBOUND_WEBHOOK_EVENTS,
  notes: INBOUND_WEBHOOK_NOTES,
};


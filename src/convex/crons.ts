/**
 * Pekerjaan terjadwal MesinPOS.
 *
 * Satu tempat untuk melihat **apa yang jalan otomatis** di backend. Sebelas
 * jadwal: percobaan ulang webhook keluar (`api.access`), pengingat janji tanggap
 * tiket dukungan (`support.dedicated`), pengingat **hutang jatuh tempo** dan
 * **piutang lewat tempo** yang keadaannya berubah karena waktu, bukan karena
 * transaksi, **perapian sesi pendampingan platform** yang sudah kedaluwarsa,
 * **penyapu antrean stok marketplace** yang tertinggal, **rekonsiliasi selisih
 * stok harian** terhadap marketplace, **sinkron barcode/QR otomatis** (hanya
 * kolom barcode), serta **pembersihan akun
 * uji** (akun bisnis lalu baris pengguna yatim) supaya deployment dev tidak
 * menumpuk data dari harness yang dijalankan berulang.
 *
 * Kiriman yang gagal sudah disimpan oleh `apiAccess.finishDelivery` sebagai
 * `pending` dengan `nextAttemptAt` (aturan murni `lib/webhooks.ts`:
 * 1 → 5 → 30 → 120 → 720 menit, lima percobaan). Pekerja ini yang benar-benar
 * menjalankan jadwal itu: setiap `RETRY_WORKER_INTERVAL_MINUTES` menit ia
 * mengambil kiriman yang jatuh tempo — lewat indeks `by_status_next_attempt`,
 * bukan memindai riwayat — lalu mengirim ulang dengan tanda tangan yang sama
 * seperti kiriman biasa. Setelah percobaan kelima, `finishDelivery` menutupnya
 * sebagai `failed` sehingga berhenti sebagai baris yang terlihat di halaman,
 * bukan antrean tak berujung.
 */
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { OVERDUE_REMINDER_BATCH } from "./lib/ar";
import { DUE_REMINDER_BATCH } from "./lib/payables";
import {
  SLA_REMINDER_BATCH,
  SLA_REMINDER_INTERVAL_MINUTES,
} from "./lib/support";
import {
  IMPERSONATION_SWEEP_BATCH,
  IMPERSONATION_SWEEP_INTERVAL_MINUTES,
} from "./lib/impersonation";
import { USER_PURGE_BATCH } from "./lib/platformTenants";
import { MAX_RETRY_BATCH, RETRY_WORKER_INTERVAL_MINUTES } from "./lib/webhooks";
import {
  MARKETPLACE_BARCODE_SYNC_BATCH,
  MARKETPLACE_BARCODE_SYNC_HOUR_UTC,
  MARKETPLACE_RECONCILE_BATCH,
  MARKETPLACE_RECONCILE_HOUR_UTC,
  MARKETPLACE_SALES_SWEEP_BATCH,
  MARKETPLACE_STOCK_SWEEP_BATCH,
  MARKETPLACE_STOCK_SWEEP_INTERVAL_MINUTES,
} from "./lib/marketplace";

const crons = cronJobs();

crons.interval(
  "percobaan ulang webhook yang gagal",
  { minutes: RETRY_WORKER_INTERVAL_MINUTES },
  internal.apiAccess.retryDueDeliveries,
  { limit: MAX_RETRY_BATCH },
);

// Pengingat janji tanggap dukungan: tiket yang hidup di dalam aplikasi hanya
// terlihat kalau ada yang membuka halamannya, jadi tiket yang janji tanggapnya
// hampir lewat harus mengabarkan dirinya sendiri.
crons.interval(
  "pengingat janji tanggap dukungan",
  { minutes: SLA_REMINDER_INTERVAL_MINUTES },
  internal.support.notifyDueTickets,
  { limit: SLA_REMINDER_BATCH },
);

// Dua keadaan yang berubah karena **waktu**, bukan karena transaksi: tagihan
// supplier yang jatuh tempo dan piutang yang menunggak. Karena itu jadwalnya
// harian — tidak ada kejadian yang bisa memicunya — dan tiap dokumen membawa
// penanda “sudah pernah diberitahukan” supaya satu dokumen tidak dikabarkan
// setiap hari. Kiriman yang ditulis di sini langsung diserahkan ke pekerja
// percobaan ulang oleh `scheduleWebhookDeliveryPass`, jadi pengirimannya tidak
// menunggu putaran berikutnya.
crons.daily(
  "pengingat hutang jatuh tempo",
  { hourUTC: 1, minuteUTC: 0 },
  internal.payables.notifyDuePayables,
  { limit: DUE_REMINDER_BATCH },
);

crons.daily(
  "pengingat piutang lewat tempo",
  { hourUTC: 1, minuteUTC: 15 },
  internal.ar.notifyOverdueReceivables,
  { limit: OVERDUE_REMINDER_BATCH },
);

// Sesi pendampingan platform berbatas waktu, dan batasnya **bukan** bergantung
// pada pekerja ini: pintunya dijaga `impersonationStatus` saat dibaca. Perapian
// ini hanya menutup baris yang sudah mati supaya jejaknya berakhir rapi — tenant
// menerima baris audit terakhir (“kedaluwarsa setelah N menit”) dan tidak ada sesi
// yang menggantung tanpa ujung.
// Stok yang baru bergerak dikirim ke marketplace oleh action yang dijadwalkan
// transaksinya sendiri (± 2 detik). Kalau action itu sempat mati di tengah jalan
// (mis. deployment baru masuk), antreannya tidak boleh menggantung: sapuan ini
// mengirim ulang baris yang lebih tua dari satu menit, satu kali per workspace.
crons.interval(
  "mengirim antrean stok marketplace yang tertinggal",
  { minutes: MARKETPLACE_STOCK_SWEEP_INTERVAL_MINUTES },
  internal.marketplace.sweepStockQueues,
  { limit: MARKETPLACE_STOCK_SWEEP_BATCH },
);

// Penjualan otomatis memakai pola yang sama: action dijadwalkan nota yang baru
// tersimpan, dan sapuan ini menutup antrean yang tertinggal karena action-nya
// mati. Tanpa ini, nota terakhir sebelum deployment baru bisa tidak pernah
// sampai ke marketplace.
crons.interval(
  "mengirim antrean penjualan marketplace yang tertinggal",
  { minutes: MARKETPLACE_STOCK_SWEEP_INTERVAL_MINUTES },
  internal.marketplace.sweepSaleQueues,
  { limit: MARKETPLACE_SALES_SWEEP_BATCH },
);

// **Rekonsiliasi stok harian**: dua arah dorongan di atas bisa saja tidak
// lengkap — marketplace yang menjual sendiri, SKU yang berganti nama, atau
// kiriman yang ditolak penerima. Pemeriksaan ini membaca katalog marketplace
// sekali sehari, membandingkannya dengan saldo **lokasi jual** POS, dan menyimpan
// daftar SKU yang selisih beserta angkanya. Ia **tidak menimpa** stok siapa pun:
// keputusan arah (impor vs dorong) tetap milik pemilik, karena menimpa otomatis
// bisa menghapus penjualan yang baru terjadi di sisi lain.
crons.daily(
  "memeriksa selisih stok marketplace",
  { hourUTC: MARKETPLACE_RECONCILE_HOUR_UTC, minuteUTC: 30 },
  internal.marketplace.reconcileAllStocks,
  { limit: MARKETPLACE_RECONCILE_BATCH },
);

// **Sinkron barcode/QR otomatis**: marketplace adalah sumber label, jadi kode
// yang tersimpan di sana boleh disalin sendiri ke POS. Pekerja ini **hanya**
// menulis `products.barcode`/`barcodeType` — nama, harga, stok, kategori, dan
// gambar tidak disentuh, dan produk baru tidak dibuat (itu tugas tombol Impor
// katalog yang memang diperintahkan pemilik). Jamnya 03:00 UTC, sesudah
// rekonsiliasi stok, supaya dua pekerja tidak membaca katalog marketplace
// berbarengan untuk workspace yang sama.
crons.daily(
  "menyinkronkan barcode marketplace",
  { hourUTC: MARKETPLACE_BARCODE_SYNC_HOUR_UTC, minuteUTC: 0 },
  internal.marketplace.syncAllBarcodes,
  { limit: MARKETPLACE_BARCODE_SYNC_BATCH },
);

crons.interval(
  "menutup sesi pendampingan platform yang kedaluwarsa",
  { minutes: IMPERSONATION_SWEEP_INTERVAL_MINUTES },
  internal.platform.sweepExpiredImpersonations,
  { limit: IMPERSONATION_SWEEP_BATCH },
);

/*
  **Pembersihan akun uji** — kebersihan data, bukan fitur aplikasi.

  Harness (`verify-backend.mjs` dan kawan-kawan) mendirikan workspace sungguhan
  di deployment dev setiap kali dijalankan. Itu perlu untuk menguji gerbang izin
  dan isolasi tenant, tetapi hasilnya menumpuk: dulu 1096 akun uji harus
  dibersihkan manual sekali jalan. Dua jadwal ini yang membuatnya tidak terulang:

  1. pukul 19:00 UTC — akun bisnis milik email domain uji ditandai hapus (pekerja
     `deleteTenantChunk` menyapunya bertahap; `purgeFixtureTenants` menjadwalkan
     dirinya lagi selama masih ada kandidat), lalu
  2. pukul 19:30 UTC — baris `users` yang sudah yatim (tanpa tenant, tanpa
     keanggotaan) ikut dihapus bersama sesi dan kode OTP-nya.

  Jarak 30 menit itu sengaja: penghapusan tenant berjalan bertahap, jadi baris
  pengguna baru terlihat yatim setelah tenant-nya benar-benar hilang. Akun
  pengembang platform dan siapa pun yang masih tercatat di sebuah workspace tidak
  pernah ikut disapu.
*/
crons.daily(
  "membersihkan akun bisnis uji",
  { hourUTC: 19, minuteUTC: 0 },
  internal.platform.purgeFixtureTenantsAuto,
  {},
);

crons.daily(
  "membersihkan akun pengguna uji yang yatim",
  { hourUTC: 19, minuteUTC: 30 },
  internal.platform.purgeFixtureUsers,
  { batch: USER_PURGE_BATCH },
);

export default crons;

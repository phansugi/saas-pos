/**
 * Pekerjaan terjadwal MesinPOS.
 *
 * Satu tempat untuk melihat **apa yang jalan otomatis** di backend. Lima jadwal:
 * percobaan ulang webhook keluar (`api.access`), pengingat janji tanggap tiket
 * dukungan (`support.dedicated`), pengingat **hutang jatuh tempo** dan **piutang
 * lewat tempo** yang keadaannya berubah karena waktu, bukan karena transaksi,
 * serta **perapian sesi pendampingan platform** yang sudah kedaluwarsa.
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
import { MAX_RETRY_BATCH, RETRY_WORKER_INTERVAL_MINUTES } from "./lib/webhooks";

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
crons.interval(
  "menutup sesi pendampingan platform yang kedaluwarsa",
  { minutes: IMPERSONATION_SWEEP_INTERVAL_MINUTES },
  internal.platform.sweepExpiredImpersonations,
  { limit: IMPERSONATION_SWEEP_BATCH },
);

export default crons;

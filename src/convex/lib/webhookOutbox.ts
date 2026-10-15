/**
 * Kotak keluar webhook (`api.access`): menulis kiriman `pending` **saat
 * peristiwanya benar-benar terjadi**.
 *
 * Sampai di sini `webhookDeliveries` hanya terisi oleh tombol **Kirim uji**,
 * sehingga pekerja percobaan ulang (`crons.ts`) tidak punya apa-apa untuk
 * dikerjakan pada kejadian nyata. Fungsi di berkas ini menutup jarak itu: ia
 * dipanggil dari jalur transaksi (penjualan, pembatalan, opname) dan menulis
 * satu baris kiriman per endpoint yang memang melanggan event tersebut.
 *
 * Tiga keputusan yang disengaja:
 *
 * 1. **Datanya sama dengan yang dikirim pekerja.** Baris `pending` di sini dan
 *    baris `pending` hasil percobaan ulang tidak bisa dibedakan bentuknya —
 *    penerima melihat satu jenis kiriman saja.
 * 2. **Tanpa gerbang fitur.** Endpoint hanya bisa ada kalau `api.access` pernah
 *    dibeli; menghitung ulang paketnya di setiap penjualan hanya akan mematikan
 *    integrasi yang sedang berjalan tanpa memberi tahu siapa pun. Tenant yang
 *    tidak ingin dikirimi lagi mematikan endpoint-nya (dan pekerja ulang
 *    menutup kiriman yang menggantung).
 * 3. **Tidak melempar saat tidak ada pelanggan.** Kalau tidak ada endpoint yang
 *    melanggan, fungsi ini berhenti lebih awal — penjualan tanpa integrasi tidak
 *    membayar biaya apa pun selain satu kueri berindeks.
 */

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { retryBatchLimit, sanitizeWebhookEvents, webhookPayload } from "./webhooks";

export interface WebhookEventInput {
  tenantId: Id<"tenants">;
  /** Kalau diisi, id & nama tokonya ikut masuk ke isi kiriman. */
  storeId?: Id<"stores">;
  event: string;
  data: Record<string, unknown>;
  /** Penanda kejadian untuk `id` kiriman (nomor struk/SKU/nomor opname). */
  subject?: string;
  /** Waktu kejadian; bawaan sekarang. */
  at?: number;
}

/**
 * Menulis kiriman untuk satu kejadian ke semua endpoint yang melanggannya.
 * Mengembalikan jumlah endpoint yang dikirimi (0 kalau tidak ada yang
 * melanggan), sehingga pemanggilnya bisa memastikan peristiwanya memang
 * menghasilkan kiriman tanpa membaca tabel lagi.
 */
export async function enqueueWebhookEvent(
  ctx: MutationCtx,
  input: WebhookEventInput,
): Promise<number> {
  const endpoints = await ctx.db
    .query("webhookEndpoints")
    .withIndex("by_tenant", (q) => q.eq("tenantId", input.tenantId))
    .collect();

  const subscribers = endpoints.filter(
    (endpoint) =>
      endpoint.active && sanitizeWebhookEvents(endpoint.events).includes(input.event),
  );
  if (subscribers.length === 0) return 0;

  const at = input.at ?? Date.now();
  const store = input.storeId ? await ctx.db.get(input.storeId) : null;
  const data: Record<string, unknown> = { ...input.data };
  if (store) {
    data.storeId = store._id as string;
    data.store = store.name;
  }

  const payload = webhookPayload({
    event: input.event,
    data,
    at,
    subject: input.subject,
  });

  for (const endpoint of subscribers) {
    await ctx.db.insert("webhookDeliveries", {
      tenantId: input.tenantId,
      endpointId: endpoint._id,
      event: input.event,
      payload,
      status: "pending",
      attempts: 0,
      nextAttemptAt: at,
      createdAt: at,
    });
  }

  return subscribers.length;
}

/**
 * Meminta **satu** putaran pekerja setelah transaksinya tersimpan.
 *
 * Kiriman tidak dikirim di dalam transaksi penjualan: jaringan penerima tidak
 * boleh menahan kasir. Sebagai gantinya pekerja yang sama dipanggil segera
 * setelah transaksinya tersimpan; penjadwalannya ikut transaksi, jadi penjualan
 * yang batal tidak meninggalkan kiriman.
 *
 * Dipanggil **sekali per mutation**, dengan `limit` sejumlah kiriman yang baru
 * ditulis. Satu penjualan bisa menghasilkan dua event (`sale.completed` +
 * `stock.low`); kalau tiap event menjadwalkan putarannya sendiri, dua putaran
 * bersamaan akan mengambil baris antrean yang sama dan mengirim kiriman yang
 * sama dua kali, sementara baris lain menunggu putaran cron berikutnya — ini
 * bukan teori: perilakunya terukur saat dua penjadwalan itu terjadi.
 */
export async function scheduleWebhookDeliveryPass(
  ctx: MutationCtx,
  limit: number,
): Promise<void> {
  if (limit <= 0) return;
  await ctx.scheduler.runAfter(0, internal.apiAccess.retryDueDeliveries, {
    limit: retryBatchLimit(limit),
  });
}

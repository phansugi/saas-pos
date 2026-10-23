/**
 * Antrean **penjualan otomatis** ke marketplace.
 *
 * `marketplaceStockQueue` hanya mengabarkan stok. Marketplace juga perlu tahu
 * **nota**-nya: nomor, item, total, metode bayar, dan pembatalan. Fungsi di
 * berkas ini menitipkan nota yang baru selesai/dibatalkan ke antrean, lalu satu
 * action mengirim nota + stok terbaru SKU yang tersentuh dalam satu permintaan.
 *
 * Empat keputusan yang disengaja:
 *
 * 1. **Ditulis di dalam transaksi penjualan.** Penjualan yang gagal tidak
 *    meninggalkan antrean; pembatalan yang datang sesudahnya menggabung ke nota
 *    yang sama, bukan menjadi kiriman kedua.
 * 2. **Jaringan tidak menahan kasir.** Hanya satu baris antrean + jadwal action;
 *    pengiriman terjadi di luar transaksi.
 * 3. **Hanya workspace yang dipasangkan.** Tanpa baris pairing, fungsi berhenti
 *    setelah satu kueri berindeks — tidak ada antrean untuk workspace biasa.
 * 4. **Tetap antre walau endpoint belum diisi.** Berbeda dari antrean stok yang
 *    diam-diam berhenti, di sini action mencatat kegagalan yang bisa dibaca
 *    pemilik (“endpoint dorong belum diisi”) — supaya “belum tersinkron” punya
 *    sebab, bukan hanya keadaan kosong.
 */

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  MARKETPLACE_SALES_DEBOUNCE_MS,
  mergeMarketplaceSaleQueue,
} from "./marketplace";

/**
 * Menitipkan satu nota ke antrean marketplace.
 *
 * Mengembalikan `true` hanya kalau pemanggil ini yang **menjadwalkan** action
 * (antrean sebelumnya kosong); penggabungan mengembalikan `false` karena
 * jadwalnya sudah terpasang.
 */
export async function queueMarketplaceSalePush(
  ctx: MutationCtx,
  args: { tenantId: Id<"tenants">; saleId: Id<"sales"> },
): Promise<boolean> {
  const pairing = await ctx.db
    .query("marketplacePairings")
    .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
    .unique();
  if (!pairing) return false;

  const rows = await ctx.db
    .query("marketplaceSaleQueue")
    .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
    .collect();
  const queued = rows[0];
  if (queued) {
    if (queued.saleIds.includes(args.saleId)) return false;
    const merged = mergeMarketplaceSaleQueue({
      saleIds: queued.saleIds.map((id) => id as string),
      incoming: [args.saleId as string],
    });
    await ctx.db.patch(queued._id, {
      saleIds: merged.saleIds as Id<"sales">[],
    });
    return false;
  }

  await ctx.db.insert("marketplaceSaleQueue", {
    tenantId: args.tenantId,
    saleIds: [args.saleId],
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(
    MARKETPLACE_SALES_DEBOUNCE_MS,
    internal.marketplace.pushQueuedSales,
    { tenantId: args.tenantId },
  );
  return true;
}

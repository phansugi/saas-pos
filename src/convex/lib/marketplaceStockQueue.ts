/**
 * Antrean **stok otomatis** ke marketplace.
 *
 * Sampai di sini stok baru sampai ke marketplace kalau ada orang menekan
 * “Sinkronkan produk”. Fungsi di berkas ini menutup jarak itu: setiap pergerakan
 * stok yang benar-benar tersimpan (penjualan, pembatalan, penerimaan barang,
 * opname, penyesuaian) menitipkan produknya ke antrean, dan satu action
 * mengirimkannya sesudah jeda singkat.
 *
 * Empat keputusan yang disengaja:
 *
 * 1. **Dibuat di dalam transaksi yang mengubah stok.** Antreannya ikut batal
 *    kalau penjualannya gagal — tidak ada kiriman untuk perubahan yang tidak
 *    pernah terjadi.
 * 2. **Jaringan tidak pernah menahan kasir.** Pergerakan stok hanya menulis
 *    baris antrean dan menjadwalkan action; pengirimannya terjadi di luar
 *    transaksi.
 * 3. **Digabung, bukan satu kiriman per baris.** Satu nota dengan sepuluh barang
 *    menjadi satu kiriman berisi sepuluh SKU, bukan sepuluh permintaan.
 * 4. **Tanpa endpoint, tanpa biaya.** Kalau marketplace belum punya endpoint
 *    dorong (dan workspace belum dipasangkan), fungsi ini berhenti setelah satu
 *    pemeriksaan kunci lingkungan — tidak ada baris antrean yang menumpuk.
 */

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  MARKETPLACE_STOCK_DEBOUNCE_MS,
  marketplaceCatalogPushUrl,
  mergeMarketplaceStockQueue,
  marketplaceStockPushUrl,
} from "./marketplace";

/**
 * Menitipkan satu produk yang stoknya baru bergerak ke antrean marketplace.
 *
 * Mengembalikan `true` hanya kalau pemanggil inilah yang **menjadwalkan** kiriman
 * (yaitu saat antrean sebelumnya kosong); penggabungan ke antrean yang sudah ada
 * mengembalikan `false` karena jadwalnya sudah terpasang — informasi ini dipakai
 * harness, bukan untuk mengubah perilaku.
 */
export async function queueMarketplaceStockPush(
  ctx: MutationCtx,
  args: { tenantId: Id<"tenants">; productId: Id<"products"> },
): Promise<boolean> {
  if (marketplaceStockPushUrl(process.env) === "") return false;

  // Cuma workspace yang benar-benar dipasangkan ke vendor yang dikabari. Satu
  // kueri berindeks; workspace tanpa pairing tidak membayar apa pun selain itu.
  const pairing = await ctx.db
    .query("marketplacePairings")
    .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
    .unique();
  if (!pairing) return false;

  const rows = await ctx.db
    .query("marketplaceStockQueue")
    .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
    .collect();
  const queued = rows[0];
  if (queued) {
    if (queued.pushAll || queued.productIds.includes(args.productId)) return false;
    const merged = mergeMarketplaceStockQueue({
      productIds: queued.productIds.map((id) => id as string),
      incoming: [args.productId as string],
    });
    await ctx.db.patch(queued._id, {
      productIds: merged.productIds as Id<"products">[],
      pushAll: merged.pushAll,
    });
    return false;
  }

  await ctx.db.insert("marketplaceStockQueue", {
    tenantId: args.tenantId,
    productIds: [args.productId],
    pushAll: false,
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(
    MARKETPLACE_STOCK_DEBOUNCE_MS,
    internal.marketplace.pushQueuedStock,
    { tenantId: args.tenantId },
  );
  return true;
}

/**
 * Menitipkan **pohon kategori** ke antrean katalog marketplace.
 *
 * Kategori & subkategori tidak berdiri sendiri di sisi marketplace: produk
 * membawa nama keduanya, dan penerima membuat kategori yang belum ada saat
 * katalog di-upsert. Karena itu perubahan kategori dikirim sebagai **katalog
 * penuh** (bukan kiriman kecil berisi nama kategori saja) dengan event
 * `product.updated` — jalur yang sudah diterima marketplace untuk upsert
 * produk/kategori. Antrean stok dipakai bersama supaya perubahan stok dan
 * kategori yang datang berdekatan menjadi satu kiriman, bukan dua.
 *
 * Mengembalikan `true` hanya kalau pemanggil inilah yang menjadwalkan kiriman
 * (antrean sebelumnya kosong), sama seperti `queueMarketplaceStockPush`.
 */
export async function queueMarketplaceCategoryPush(
  ctx: MutationCtx,
  args: { tenantId: Id<"tenants"> },
): Promise<boolean> {
  // Tanpa endpoint katalog, tidak ada yang bisa dikirim — jangan menumpuk
  // antrean yang hanya akan gagal berulang kali.
  if (marketplaceCatalogPushUrl(process.env) === "") return false;

  const pairing = await ctx.db
    .query("marketplacePairings")
    .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
    .unique();
  if (!pairing) return false;

  const rows = await ctx.db
    .query("marketplaceStockQueue")
    .withIndex("by_tenant", (q) => q.eq("tenantId", args.tenantId))
    .collect();
  const queued = rows[0];
  if (queued) {
    // Katalog penuh menutup semua perubahan yang mungkin sudah menunggu, jadi
    // daftar SKU lama boleh dilepas: `pushAll` mengirim seluruh katalog.
    if (!queued.pushAll || queued.catalog !== true) {
      await ctx.db.patch(queued._id, { pushAll: true, catalog: true });
    }
    return false;
  }

  await ctx.db.insert("marketplaceStockQueue", {
    tenantId: args.tenantId,
    productIds: [],
    pushAll: true,
    catalog: true,
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(
    MARKETPLACE_STOCK_DEBOUNCE_MS,
    internal.marketplace.pushQueuedStock,
    { tenantId: args.tenantId },
  );
  return true;
}

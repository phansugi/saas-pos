/**
 * Entry point sisi aplikasi untuk aturan PPN (tarif + aktif/nonaktif).
 *
 * Implementasinya ada di `src/convex/lib/tax.ts` supaya halaman Pengaturan,
 * kasir, kedua store (demo & Convex), `pos.createSale`, `billing.createInvoice`,
 * dan harness memakai aturan yang sama persis — termasuk pagar “aktif dengan
 * tarif 0% ditolak” dan pembulatan dua desimalnya (Convex hanya membundel modul
 * di bawah `src/convex`).
 */
export * from "@/convex/lib/tax";

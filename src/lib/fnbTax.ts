/**
 * Entry point sisi aplikasi untuk aturan pajak & pungutan F&B (PBJT, biaya
 * layanan, PPh final UMKM, PPh 21, PPh 4 ayat (2)).
 *
 * Implementasinya ada di `src/convex/lib/fnbTax.ts` supaya halaman Pengaturan,
 * kasir, kedua store, backend (`pos.createSale`, `tenants.updateTaxProfile`), dan
 * harness memakai aturan yang sama persis (Convex hanya membundel modul di bawah
 * `src/convex`).
 */
export * from "@/convex/lib/fnbTax";

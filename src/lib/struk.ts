/**
 * Entry point sisi aplikasi untuk aturan struk belanja (jenis printer, lebar
 * kertas, rangkap, catatan kaki, dan tata letak barisnya).
 *
 * Implementasinya ada di `src/convex/lib/struk.ts` supaya halaman Pengaturan,
 * kasir, kedua store (demo & Convex), `tenants.updateReceipt`, dan harness
 * memakai aturan yang sama persis — Convex hanya membundel modul di bawah
 * `src/convex`.
 */
export * from "@/convex/lib/struk";

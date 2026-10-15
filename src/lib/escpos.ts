/**
 * Entry point sisi aplikasi untuk aturan **ESC/POS** (perintah printer, saringan
 * teks ASCII, bitmap logo, profil Bluetooth, dan pemecahan byte per kirim).
 *
 * Implementasinya ada di `src/convex/lib/escpos.ts` supaya halaman kasir, jalur
 * perangkat (`src/lib/escposDevice.ts`), dan harness memakai aturan yang sama
 * persis — Convex hanya membundel modul di bawah `src/convex`.
 */
export * from "@/convex/lib/escpos";

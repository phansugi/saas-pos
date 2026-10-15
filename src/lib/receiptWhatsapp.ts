/**
 * Entry point sisi aplikasi untuk aturan kirim struk lewat WhatsApp (isi pesan,
 * tautan `wa.me`, badan permintaan Graph API, dan pembacaan hasilnya).
 *
 * Implementasinya ada di `src/convex/lib/receiptWhatsapp.ts` supaya aksi server
 * (`receiptWa.send`), halaman kasir, dan harness memakai aturan yang sama persis —
 * termasuk nama kunci lingkungannya.
 */
export * from "@/convex/lib/receiptWhatsapp";

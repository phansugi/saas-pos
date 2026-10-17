/**
 * Sisi klien dari aturan shift kas & pengingat tutup shift.
 *
 * Implementasinya ada di `@/convex/lib/shift` — bukan karena peramban punya jalur
 * khusus, melainkan karena aturan yang sama dipakai **server** juga: setelan
 * pengingatnya hidup di baris tenant (`tenants.shift`) dan disimpan lewat
 * `tenants.updateShift`, sementara Convex hanya membundel modul di dalam direktori
 * fungsinya. Halaman Kasir, halaman Shift & Kas, kedua store, halaman Pengaturan,
 * dan harness semuanya lewat berkas ini supaya tidak ada aturan yang hidup dua
 * kali.
 */
export * from "@/convex/lib/shift";

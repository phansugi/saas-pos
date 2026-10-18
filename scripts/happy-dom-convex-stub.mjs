/**
 * Pengganti `convex/react` untuk harness kartu backstage.
 *
 * Kenapa perlu: kartu **Akun bisnis** hanya hidup di dalam provider Convex yang
 * sudah punya identitas terverifikasi. Identitas itu terbit dari kode email, jadi
 * harness tidak bisa (dan tidak boleh) memalsukannya — yang bisa diuji tanpa
 * kotak surat adalah **perilaku kartunya**: tombol Edit, isi formulir, dan
 * mutation yang benar-benar dikirim saat “Simpan perubahan” ditekan.
 *
 * Nama fungsi Convex-nya dibaca dengan `getFunctionName` (ekspor resmi
 * `convex/server`), bukan dengan membandingkan objek referensi: `api` adalah
 * proxy yang membuat objek baru di setiap akses, jadi perbandingan identitas
 * selalu meleset.
 *
 * Modul ini hanya meneruskan panggilan ke `globalThis.__convexStub`, yang diisi
 * harness lewat `scripts/verify-platform-edit-ui.mjs`. Tidak ada berkas produksi
 * yang mengimpornya; ia dipasang sebagai alias `convex/react` di harness.
 */
import { getFunctionName } from "convex/server";

export function useQuery(fn, args) {
  return globalThis.__convexStub.query(getFunctionName(fn), args);
}

export function useConvex() {
  return {
    mutation: (fn, args) => globalThis.__convexStub.mutate(getFunctionName(fn), args),
    query: (fn, args) => globalThis.__convexStub.query(getFunctionName(fn), args),
  };
}

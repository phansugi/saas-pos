/**
 * Palet warna berkas laporan — **satu sumber** untuk PDF & Excel.
 *
 * Kenapa dipisah: dua berkas yang diunduh dari laporan yang sama harus terbaca
 * sebagai laporan yang sama. Sebelumnya warna PDF ditulis di `laporanPdf.ts` dan
 * warna Excel ditulis lagi di `laporanXlsx.ts`; nilainya kebetulan sama, tetapi tidak
 * ada yang memaksa keduanya tetap sama. Di sini nilai warnanya ditulis **sekali**
 * sebagai hex, lalu diturunkan ke bentuk yang dipakai masing-masing berkas:
 * operator `rg` untuk PDF dan ARGB untuk `styles.xml`/bagan Excel.
 *
 * Warna dipakai untuk **menuntun mata**, bukan menghias: tiap bagian laporan punya
 * satu keluarga warna (mis. pajak & pungutan = amber), dan di dalam bagian itu warna
 * yang lebih tua selalu berarti kepala/judul, warna sangat tipis berarti baris
 * selang-seling, dan garis aksen berarti baris jumlah. Jadi pembaca yang melihat
 * halaman berwarna kuning tahu itu bagian pajak tanpa membaca judulnya lagi.
 *
 * Keluarga warnanya sengaja disamakan dengan halaman Laporan di aplikasi
 * (`TONES` di `src/pages/ReportsPage.tsx`), supaya layar dan berkas yang diunduh
 * memakai bahasa warna yang sama.
 *
 * Dua aturan yang dipegang di semua warna di bawah:
 *
 * 1. **Tingkat 700 dipakai untuk pita bertulisan putih.** Putih di atas nada 500/600
 *    hanya ± 3,2:1 — di bawah batas 4,5:1 untuk teks sekecil itu. Semua `kepala` &
 *    `bagian` di bawah sudah ≥ 4,5:1 terhadap putih (diperiksa harness).
 * 2. **Nada tipis memakai tingkat 50/100**, dan hurufnya tetap hitam — pita baris
 *    selang-seling yang terlalu pekat akan menutupi angkanya saat difotokopi
 *    hitam-putih.
 */

/** Nama keluarga warna satu bagian laporan. */
export type LaporanWarnaNama =
  | "netral"
  | "emerald"
  | "teal"
  | "sky"
  | "indigo"
  | "amber"
  | "violet"
  | "rose";

/**
 * Satu keluarga warna, ditulis sebagai hex enam huruf (tanpa `#`).
 *
 * `batang` berisi **empat** nada dari paling terang ke paling gelap: grafik batangnya
 * memakai nada yang berbeda menurut tingginya, jadi tinggi batangnya terbaca dari
 * warnanya juga, bukan hanya dari panjangnya.
 */
export interface LaporanWarna {
  nama: LaporanWarnaNama;
  /** Nama warna dalam bahasa Indonesia — dipakai keterangan & pesan gagal harness. */
  label: string;
  /** Pita judul bagian laporan (paling tua). */
  bagian: string;
  /** Pita kepala kolom tabel (bertulisan putih). */
  kepala: string;
  /** Pita baris selang-seling (sangat tipis). */
  selang: string;
  /** Pita baris jumlah. */
  jumlah: string;
  /** Garis tebal di tepi atas pita baris jumlah. */
  garis: string;
  /** Batang grafik: [terang, sedang, tua, paling tua]. */
  batang: [string, string, string, string];
}

/**
 * Urutan tetap keluarga warna. Urutannya dipakai sebagai indeks gaya Excel, jadi
 * menambah keluarga baru cukup ditambahkan **di akhir** supaya gaya yang sudah ada
 * tidak bergeser.
 */
export const LAPORAN_WARNA_DAFTAR: LaporanWarnaNama[] = [
  "netral",
  "emerald",
  "teal",
  "sky",
  "indigo",
  "amber",
  "violet",
  "rose",
];

export const LAPORAN_WARNA: Record<LaporanWarnaNama, LaporanWarna> = {
  /** Tanpa bagian: kepala/kaki halaman, lembar info, dan bagian yang belum dipetakan. */
  netral: {
    nama: "netral",
    label: "netral (abu tua)",
    bagian: "0F172A",
    kepala: "1E293B",
    selang: "F1F5F9",
    jumlah: "E2E8F0",
    garis: "64748B",
    batang: ["94A3B8", "64748B", "475569", "334155"],
  },
  emerald: {
    nama: "emerald",
    label: "hijau zamrud",
    bagian: "065F46",
    kepala: "047857",
    selang: "ECFDF5",
    jumlah: "D1FAE5",
    garis: "10B981",
    batang: ["34D399", "10B981", "059669", "047857"],
  },
  teal: {
    nama: "teal",
    label: "hijau kebiruan",
    bagian: "115E59",
    kepala: "0F766E",
    selang: "F0FDFA",
    jumlah: "CCFBF1",
    garis: "14B8A6",
    batang: ["2DD4BF", "14B8A6", "0D9488", "0F766E"],
  },
  sky: {
    nama: "sky",
    label: "biru langit",
    bagian: "075985",
    kepala: "0369A1",
    selang: "F0F9FF",
    jumlah: "E0F2FE",
    garis: "0EA5E9",
    batang: ["38BDF8", "0EA5E9", "0284C7", "0369A1"],
  },
  indigo: {
    nama: "indigo",
    label: "biru nila",
    bagian: "3730A3",
    kepala: "4338CA",
    selang: "EEF2FF",
    jumlah: "E0E7FF",
    garis: "6366F1",
    batang: ["818CF8", "6366F1", "4F46E5", "4338CA"],
  },
  amber: {
    nama: "amber",
    label: "kuning madu",
    bagian: "92400E",
    kepala: "B45309",
    selang: "FFFBEB",
    jumlah: "FEF3C7",
    garis: "F59E0B",
    batang: ["FBBF24", "F59E0B", "D97706", "B45309"],
  },
  violet: {
    nama: "violet",
    label: "ungu",
    bagian: "5B21B6",
    kepala: "6D28D9",
    selang: "F5F3FF",
    jumlah: "EDE9FE",
    garis: "8B5CF6",
    batang: ["A78BFA", "8B5CF6", "7C3AED", "6D28D9"],
  },
  rose: {
    nama: "rose",
    label: "merah muda",
    bagian: "9F1239",
    kepala: "BE123C",
    selang: "FFF1F2",
    jumlah: "FFE4E6",
    garis: "F43F5E",
    batang: ["FB7185", "F43F5E", "E11D48", "BE123C"],
  },
};

/**
 * Peta bagian → keluarga warna, dari **id** bagiannya.
 *
 * Id-nya yang dipetakan (bukan judulnya) karena id stabil dan sudah dipakai sebagai
 * nama lembar Excel; mengganti judul bagian tidak boleh diam-diam memindahkan
 * warnanya.
 */
const PETA_BAGIAN: Record<string, LaporanWarnaNama> = {
  ringkasan: "emerald",
  "metode-bayar": "teal",
  "pajak-fnb": "amber",
  "analitik-ringkasan": "indigo",
  "analitik-perbandingan": "indigo",
  "analitik-temuan": "indigo",
  "analitik-tren": "violet",
  "analitik-jam": "violet",
  "analitik-hari": "violet",
  "analitik-produk": "sky",
  "analitik-kategori": "sky",
  "franchise-cabang": "rose",
  "franchise-transaksi": "rose",
  "grafik-metode": "teal",
  "grafik-bulan": "amber",
  "grafik-tren": "violet",
  "grafik-jam": "violet",
  "grafik-produk": "sky",
  "grafik-cabang": "rose",
};

/**
 * Keluarga warna satu bagian. Bagian baru yang belum terdaftar tetap dapat warna
 * yang masuk akal dari awalan id-nya (mis. bagian `analitik-…` yang ditambahkan
 * nanti ikut ungu), dan yang sama sekali tidak dikenal memakai `netral` — bukan
 * warna acak yang membuat laporannya terlihat rusak.
 */
export function laporanWarnaNamaBagian(sectionId: string): LaporanWarnaNama {
  const langsung = PETA_BAGIAN[sectionId];
  if (langsung) return langsung;
  if (sectionId.startsWith("analitik")) return "violet";
  if (sectionId.startsWith("franchise")) return "rose";
  if (sectionId.startsWith("pajak")) return "amber";
  if (sectionId.startsWith("metode")) return "teal";
  if (sectionId.startsWith("ringkasan")) return "emerald";
  return "netral";
}

/** Keluarga warna lengkap satu bagian. */
export function laporanWarnaBagian(sectionId: string): LaporanWarna {
  return LAPORAN_WARNA[laporanWarnaNamaBagian(sectionId)];
}

/** Hex → operator warna PDF (`r g b`, 0–1). Nilainya sama dengan hex-nya. */
export function laporanWarnaPdf(hex: string): string {
  const angka = [0, 2, 4].map((posisi) =>
    Number((Number.parseInt(hex.slice(posisi, posisi + 2), 16) / 255).toFixed(3)),
  );
  return angka.join(" ");
}

/** Hex → ARGB yang dipakai `styles.xml` & bagan Excel (`FF` = tanpa transparansi). */
export function laporanWarnaArgb(hex: string): string {
  return `FF${hex.toUpperCase()}`;
}

/**
 * Warna batang grafik menurut **tingginya**: makin tinggi nilainya, makin tua
 * warnanya. Batang yang tinggi jadi menonjol tanpa perlu dibaca angkanya, dan
 * gradasinya tetap satu keluarga warna dengan tabel di atasnya.
 */
export function laporanWarnaBatang(
  sectionId: string,
  nilai: number,
  tertinggi: number,
): string {
  const warna = laporanWarnaBagian(sectionId);
  if (tertinggi <= 0 || nilai <= 0) return warna.batang[0];
  const rasio = nilai / tertinggi;
  const nada = rasio >= 0.75 ? 3 : rasio >= 0.5 ? 2 : rasio >= 0.25 ? 1 : 0;
  return warna.batang[nada];
}

/** Daftar warna batang satu bagian (untuk dipakai bagan Excel & keterangan). */
export function laporanWarnaBatangSemua(sectionId: string): string[] {
  return [...laporanWarnaBagian(sectionId).batang];
}

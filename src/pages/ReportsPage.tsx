import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarDays,
  Clock,
  CreditCard,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  History,
  Info,
  Landmark,
  Lightbulb,
  ListOrdered,
  Lock,
  PieChart,
  Receipt,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ANALYTICS_PERIODS, type InsightLevel } from "@/lib/analytics";
import {
  fnbCurrentMonthSummary,
  fnbTaxMonthReport,
  fnbTaxReportTotals,
  formatPctPlain,
  microExemptWarning,
  UMKM_FINAL_RATE_PCT,
} from "@/lib/fnbTax";
import {
  formatDesimal,
  LAPORAN_CSV_MIME,
  LAPORAN_PDF_MIME,
  LAPORAN_XLSX_MIME,
  laporanCsv,
  laporanDateLabel,
  laporanDocument,
  laporanFileName,
  laporanRingkasanSingkat,
  laporanStampLabel,
  type LaporanFileKind,
} from "@/lib/laporan";
import { laporanPdfBytes } from "@/lib/laporanPdf";
import { laporanXlsx } from "@/lib/laporanXlsx";
import { describeBudget } from "@/lib/scale";
import { useSession } from "@/lib/session";
import { PAYMENT_LABELS, useStore } from "@/lib/store";
import { featureUnavailableReason } from "@/lib/store/modules";
import { formatIDR, cn } from "@/lib/utils";

/** Tinggi grafik tren harian; bar-nya relatif terhadap omzet tertinggi. */
const TREND_HEIGHT_PX = 96;

/**
 * Kunci & batas riwayat unduhan. Riwayatnya disimpan di perangkat ini (bukan di
 * server): berkasnya dibuat di peramban, jadi tidak ada alasan daftarnya ikut naik ke
 * server — dan daftar yang tinggal di server berarti isi laporan tiap toko tersimpan
 * di sana. Batas 8 berkas supaya daftarnya tetap satu layar.
 */
const UNDUHAN_KEY = "mesinpos.laporan.unduhan.v1";
const UNDUHAN_MAKS = 8;

/** Ukuran berkas siap baca, mis. `4,2 KB`. */
function fileSizeLabel(bytes: number): string {
  return `${(bytes / 1024).toLocaleString("id-ID", {
    maximumFractionDigits: 1,
  })} KB`;
}

/**
 * Menyimpan byte/teks sebagai berkas di perangkat pengguna lewat tautan `blob:`.
 *
 * Sama seperti unduhan PDF struk di halaman Kasir: berkasnya dibuat di peramban yang
 * sedang dipakai, jadi tidak ada satu byte pun yang dikirim ke server mana pun.
 *
 * URL-nya **dikembalikan**, bukan langsung dilepas: daftar “Berkas yang sudah
 * diunduh” di bawah memakai URL yang sama supaya berkasnya bisa dibuka lagi atau
 * diunduh ulang tanpa disusun ulang. Pelepasannya dilakukan sekaligus saat halaman
 * ditutup (lihat efek pembersihnya).
 */
function saveFile(data: Uint8Array | string, filename: string, type: string): string {
  const blob = new Blob([data as unknown as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  return url;
}

/**
 * Satu berkas laporan yang pernah diunduh.
 *
 * `url` **tidak** ikut disimpan: URL `blob:` mati begitu halamannya dimuat ulang, jadi
 * membacanya kembali dari penyimpanan hanya akan menghasilkan tautan yang rusak.
 * Baris yang url-nya sudah hilang tetap bisa diunduh ulang — berkasnya disusun lagi
 * dari angka yang sedang tampil (lihat `unduhUlang`).
 */
interface UnduhanBerkas {
  id: string;
  filename: string;
  kind: LaporanFileKind;
  mime: string;
  size: number;
  /** Waktu unduh (ms) — yang ditampilkan sebagai tanggal & jam unduhnya. */
  at: number;
  /** URL `blob:` yang masih hidup; dipakai tautan “Unduh ulang” & “Buka”. */
  url?: string;
}

const JENIS_TERSIMPAN: LaporanFileKind[] = ["pdf", "xlsx", "csv"];

/**
 * Membaca riwayat unduhan dari perangkat. Isinya diperiksa satu per satu: catatan
 * yang rusak (mis. sisa versi lama) dibuang, bukan membuat halaman gagal dibuka.
 */
function bacaRiwayatUnduhan(): UnduhanBerkas[] {
  if (typeof window === "undefined") return [];
  try {
    const mentah = window.localStorage.getItem(UNDUHAN_KEY);
    if (!mentah) return [];
    const data: unknown = JSON.parse(mentah);
    if (!Array.isArray(data)) return [];
    return data
      .filter((baris): baris is UnduhanBerkas => {
        const row = baris as Partial<UnduhanBerkas>;
        return (
          typeof row?.id === "string" &&
          typeof row.filename === "string" &&
          typeof row.size === "number" &&
          typeof row.at === "number" &&
          JENIS_TERSIMPAN.includes(row.kind as LaporanFileKind)
        );
      })
      .slice(0, UNDUHAN_MAKS);
  } catch {
    return [];
  }
}

/** Menyimpan riwayat tanpa URL blob-nya (URL itu tidak hidup setelah dimuat ulang). */
function simpanRiwayatUnduhan(list: UnduhanBerkas[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      UNDUHAN_KEY,
      JSON.stringify(
        list.map(({ id, filename, kind, size, at }) => ({ id, filename, kind, size, at })),
      ),
    );
  } catch {
    // Penyimpanan penuh atau dimatikan pengguna: daftarnya tetap jalan selama
    // halaman ini terbuka, dan itu bukan alasan menggagalkan unduhannya.
  }
}

/** Jenis berkas seperti yang dibaca pemilik toko, bukan singkatan teknisnya. */
const JENIS_BERKAS: Record<LaporanFileKind, string> = {
  pdf: "PDF",
  xlsx: "Excel (.xlsx)",
  csv: "CSV",
};

/**
 * Nada warna tiap jenis berkas: PDF merah (seperti ikon berkasnya di mana-mana),
 * Excel hijau, CSV biru. Lencananya tetap menyebut jenis berkas dalam huruf, jadi
 * warnanya hanya membantu membedakan — bukan satu-satunya penanda.
 */
const JENIS_NADA: Record<LaporanFileKind, string> = {
  pdf: "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300",
  xlsx: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  csv: "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300",
};

const INSIGHT_ICONS: Record<InsightLevel, typeof Info> = {
  warn: AlertTriangle,
  good: ArrowUpRight,
  info: Info,
};

/*
  Warna temuan: peringatan kuning, kabar baik hijau, keterangan biru. Sebelumnya
  ketiganya memakai token tema yang sama, jadi “ada yang perlu ditindak” dan
  “semuanya aman” terlihat nyaris identik — padahal justru bedanya yang dibaca.
*/
const INSIGHT_CLASSES: Record<InsightLevel, string> = {
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  good: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200",
};

/**
 * Nada warna satu **bagian** laporan.
 *
 * Halaman Laporan panjang — tujuh bagian bertumpuk. Sebelumnya semuanya kartu putih
 * dengan judul abu-abu, jadi mata tidak punya pegangan: bagian mana yang pajak,
 * mana yang omzet, hanya terbaca dengan membaca judulnya satu per satu. Di sini tiap
 * bagian punya **satu warna** yang dipakai konsisten di seluruh bagiannya: pita tepi
 * kartu, kotak ikon, label kecil, kepala kolom tabel, baris selang-seling, sampai
 * baris jumlahnya. Warna datang dari palet baku Tailwind dan punya pasangan tema
 * gelapnya sendiri, jadi tetap enak dibaca di kedua tema.
 */
interface SectionTone {
  /**
   * Rona permukaan kartu bagian: gradien tipis yang dipasang sebagai **lapisan
   * sendiri** di atas `bg-card` kartu, bukan sebagai kelas latar kartunya.
   *
   * Kalau ronanya ditulis sebagai kelas latar di elemen yang sama, `cn()`
   * (tailwind-merge) membuang `bg-card`-nya dan sebagian permukaan kartu jadi
   * transparan — terlihat sebagai kotak yang tembus warna halaman, berbeda di tema
   * terang dan gelap. Dipisah begini, kartunya tetap punya warna kartu yang pekat
   * dan ronanya cuma menimpa.
   */
  glow: string;
  /** Permukaan petak angka: warna solid transparan, aman dari pembuangan `cn()`. */
  tile: string;
  /** Pita warna di tepi atas kartu dan titik penanda di pil peta bagian. */
  strip: string;
  /** Kotak ikon di kepala bagian. */
  icon: string;
  /** Label kecil di atas judul bagian. */
  kicker: string;
  /** Lencana angka kecil bernada bagian ini. */
  badge: string;
  /**
   * Pita kepala kolom tabel: **warna latar solid bertulisan putih**.
   *
   * Sengaja bukan kombinasi warna + gradien: kelasnya lewat `cn()` (tailwind-merge),
   * dan `bg-gradient-to-r` di situ **menghapus** warna latar solidnya — pita yang
   * tinggal gradien tidak punya `background-color` sama sekali, jadi tabelnya kembali
   * tampak putih polos. Itu bukan dugaan: pemeriksaan di peramban sungguhan membaca
   * `getComputedStyle(thead).backgroundColor`, dan versi gradiennya terbaca
   * `rgba(0, 0, 0, 0)`.
   */
  head: string;
  /** Baris isi tabel selang-seling. */
  zebra: string;
  /** Baris jumlah di kaki tabel. */
  total: string;
  /** Garis tepi tabel beserta wadah gesernya. */
  border: string;
  /** Pil bagian di peta bagian (dapat diklik). */
  pill: string;
}

const TONES: Record<
  "emerald" | "sky" | "teal" | "indigo" | "amber" | "violet" | "rose",
  SectionTone
> = {
  emerald: {
    glow: "from-emerald-500/[0.16] via-emerald-500/[0.04] to-transparent",
    tile: "border-emerald-500/30 bg-emerald-500/[0.08]",
    strip: "from-emerald-400 to-teal-500",
    icon: "bg-emerald-500/15 text-emerald-600 ring-emerald-500/30 dark:text-emerald-400",
    kicker: "text-emerald-700 dark:text-emerald-300",
    badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    head: "bg-emerald-700 text-white",
    zebra: "even:bg-emerald-500/[0.08]",
    total: "bg-emerald-500/15",
    border: "border-emerald-500/25",
    pill: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:border-emerald-500/70 hover:bg-emerald-500/20 dark:text-emerald-300",
  },
  sky: {
    glow: "from-sky-500/[0.16] via-sky-500/[0.04] to-transparent",
    tile: "border-sky-500/30 bg-sky-500/[0.08]",
    strip: "from-sky-400 to-blue-500",
    icon: "bg-sky-500/15 text-sky-600 ring-sky-500/30 dark:text-sky-400",
    kicker: "text-sky-700 dark:text-sky-300",
    badge: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    head: "bg-sky-700 text-white",
    zebra: "even:bg-sky-500/[0.08]",
    total: "bg-sky-500/15",
    border: "border-sky-500/25",
    pill: "border-sky-500/40 bg-sky-500/10 text-sky-700 hover:border-sky-500/70 hover:bg-sky-500/20 dark:text-sky-300",
  },
  teal: {
    glow: "from-teal-500/[0.16] via-teal-500/[0.04] to-transparent",
    tile: "border-teal-500/30 bg-teal-500/[0.08]",
    strip: "from-teal-400 to-cyan-500",
    icon: "bg-teal-500/15 text-teal-600 ring-teal-500/30 dark:text-teal-400",
    kicker: "text-teal-700 dark:text-teal-300",
    badge: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
    head: "bg-teal-700 text-white",
    zebra: "even:bg-teal-500/[0.08]",
    total: "bg-teal-500/15",
    border: "border-teal-500/25",
    pill: "border-teal-500/40 bg-teal-500/10 text-teal-700 hover:border-teal-500/70 hover:bg-teal-500/20 dark:text-teal-300",
  },
  indigo: {
    glow: "from-indigo-500/[0.16] via-indigo-500/[0.04] to-transparent",
    tile: "border-indigo-500/30 bg-indigo-500/[0.08]",
    strip: "from-indigo-400 to-blue-500",
    icon: "bg-indigo-500/15 text-indigo-600 ring-indigo-500/30 dark:text-indigo-400",
    kicker: "text-indigo-700 dark:text-indigo-300",
    badge: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
    head: "bg-indigo-700 text-white",
    zebra: "even:bg-indigo-500/[0.08]",
    total: "bg-indigo-500/15",
    border: "border-indigo-500/25",
    pill: "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 hover:border-indigo-500/70 hover:bg-indigo-500/20 dark:text-indigo-300",
  },
  amber: {
    glow: "from-amber-500/[0.18] via-amber-500/[0.04] to-transparent",
    tile: "border-amber-500/30 bg-amber-500/[0.08]",
    strip: "from-amber-400 to-orange-500",
    icon: "bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-400",
    kicker: "text-amber-700 dark:text-amber-300",
    badge: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    head: "bg-amber-700 text-white",
    zebra: "even:bg-amber-500/[0.10]",
    total: "bg-amber-500/20",
    border: "border-amber-500/25",
    pill: "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:border-amber-500/70 hover:bg-amber-500/20 dark:text-amber-300",
  },
  violet: {
    glow: "from-violet-500/[0.16] via-violet-500/[0.04] to-transparent",
    tile: "border-violet-500/30 bg-violet-500/[0.08]",
    strip: "from-violet-400 to-fuchsia-500",
    icon: "bg-violet-500/15 text-violet-600 ring-violet-500/30 dark:text-violet-400",
    kicker: "text-violet-700 dark:text-violet-300",
    badge: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    head: "bg-violet-700 text-white",
    zebra: "even:bg-violet-500/[0.08]",
    total: "bg-violet-500/15",
    border: "border-violet-500/25",
    pill: "border-violet-500/40 bg-violet-500/10 text-violet-700 hover:border-violet-500/70 hover:bg-violet-500/20 dark:text-violet-300",
  },
  rose: {
    glow: "from-rose-500/[0.16] via-rose-500/[0.04] to-transparent",
    tile: "border-rose-500/30 bg-rose-500/[0.08]",
    strip: "from-rose-400 to-red-500",
    icon: "bg-rose-500/15 text-rose-600 ring-rose-500/30 dark:text-rose-400",
    kicker: "text-rose-700 dark:text-rose-300",
    badge: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    head: "bg-rose-700 text-white",
    zebra: "even:bg-rose-500/[0.08]",
    total: "bg-rose-500/15",
    border: "border-rose-500/25",
    pill: "border-rose-500/40 bg-rose-500/10 text-rose-700 hover:border-rose-500/70 hover:bg-rose-500/20 dark:text-rose-300",
  },
};

/**
 * Palet batang & kategori: satu warna per baris, berulang kalau barisnya lebih
 * banyak. Dipakai untuk batang metode bayar dan kategori produk supaya baris yang
 * berbeda benar-benar terlihat berbeda, bukan tujuh batang hijau yang sama.
 */
const BAR_PALETTE = [
  "from-emerald-400 to-teal-500",
  "from-sky-400 to-blue-500",
  "from-violet-400 to-fuchsia-500",
  "from-amber-300 to-orange-500",
  "from-rose-400 to-red-500",
  "from-teal-400 to-cyan-500",
] as const;

/** Urutan bagian laporan beserta warnanya — dipakai peta bagian di atas halaman. */
const BAGIAN: Array<{ id: string; label: string; tone: SectionTone }> = [
  { id: "ringkasan", label: "Ringkasan singkat", tone: TONES.emerald },
  { id: "angka-utama", label: "Angka utama", tone: TONES.sky },
  { id: "omzet-metode", label: "Metode bayar", tone: TONES.teal },
  { id: "unduh-laporan", label: "Unduh berkas", tone: TONES.indigo },
  { id: "pajak-fnb", label: "Pajak & pungutan", tone: TONES.amber },
  { id: "analitik", label: "Analitik", tone: TONES.violet },
  { id: "franchise", label: "Lintas cabang", tone: TONES.rose },
];

/**
 * Kartu satu bagian laporan: pita warna di tepi atas, ikon bernada, label bagian,
 * judul, keterangan, lalu isinya. Semua bagian memakai kerangka yang sama supaya
 * halamannya terbaca sebagai satu dokumen, bukan tujuh kartu yang dirakit berbeda.
 */
function SectionCard({
  id,
  testId,
  tone,
  icon: Icon,
  kicker,
  title,
  description,
  children,
  className,
  contentClassName,
}: {
  id?: string;
  testId?: string;
  tone: SectionTone;
  icon: typeof Info;
  kicker: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card
      id={id}
      data-testid={testId}
      className={cn(
        "relative animate-fade-up scroll-mt-24 overflow-hidden border",
        tone.border,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", tone.glow)}
      />
      <span
        aria-hidden
        className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", tone.strip)}
      />
      {/* Isi kartu dibungkus `relative` supaya menimpa lapisan rona di atasnya:
          elemen berposisi yang datang belakangan digambar paling akhir. */}
      <div className="relative">
        <CardHeader className="gap-1.5 pb-3">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset",
                tone.icon,
              )}
            >
              <Icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-[11px] font-semibold uppercase tracking-[0.16em]",
                  tone.kicker,
                )}
              >
                {kicker}
              </p>
              <CardTitle className="mt-0.5 text-base">{title}</CardTitle>
            </div>
          </div>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className={contentClassName}>{children}</CardContent>
      </div>
    </Card>
  );
}

/**
 * Satu petak angka: label, angka, keterangan kecil, dan kotak ikon — semuanya
 * bernada sama dengan bagiannya. Dipakai puluhan kali di halaman ini, jadi
 * bentuknya disatukan: angkanya selalu `font-mono` agar digitnya lurus ke bawah.
 */
function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  extra,
  delay = 0,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: typeof Info;
  tone: SectionTone;
  /** Isi tambahan di bawah angkanya (mis. pembanding periode sebelumnya). */
  extra?: ReactNode;
  delay?: number;
}) {
  return (
    <div
      className={cn(
        "relative animate-fade-up overflow-hidden rounded-lg border px-4 py-3",
        tone.tile,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span
        aria-hidden
        className={cn("absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r", tone.strip)}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className="mt-1 font-mono text-lg font-bold tracking-tight">{value}</div>
          {hint ? (
            <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
          ) : null}
          {extra ? <div className="mt-1">{extra}</div> : null}
        </div>
        {Icon ? (
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset",
              tone.icon,
            )}
          >
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Judul kelompok bagian yang berdiri sendiri (bukan kartu), mis. “Angka utama”. */
function BagianLabel({
  id,
  tone,
  children,
}: {
  id: string;
  tone: SectionTone;
  children: ReactNode;
}) {
  return (
    <div id={id} className="flex scroll-mt-24 items-center gap-2">
      <span aria-hidden className={cn("h-5 w-1.5 rounded-full bg-gradient-to-b", tone.strip)} />
      <h2 className={cn("text-xs font-semibold uppercase tracking-[0.16em]", tone.kicker)}>
        {children}
      </h2>
    </div>
  );
}


/** "+12%" / "−5%" / "—" kalau tidak ada pembandingnya. */
function formatDelta(value: number | null, suffix = "%"): string {
  if (value === null) return "—";
  if (value === 0) return `0${suffix}`;
  return `${value > 0 ? "+" : "−"}${Math.abs(value)}${suffix}`;
}

function DeltaBadge({ value, suffix = "%" }: { value: number | null; suffix?: string }) {
  const tone =
    value === null || value === 0
      ? "text-muted-foreground"
      : value > 0
        ? "text-primary"
        : "text-destructive";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", tone)}>
      {value !== null && value !== 0 && (
        value > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />
      )}
      {formatDelta(value, suffix)}
      <span className="text-muted-foreground">vs periode sebelumnya</span>
    </span>
  );
}

export function ReportsPage() {
  const {
    summary,
    source,
    analyticsReport,
    analyticsDays,
    setAnalyticsDays,
    franchiseReport,
    modules,
    tax,
    fnbTax,
    fnbTaxMonths,
  } = useStore();
  const { session } = useSession();
  const planKey = session?.tenant?.planKey ?? "starter";

  /** Hasil unduhan terakhir (atau kegagalannya) — ditampilkan apa adanya. */
  const [unduhHasil, setUnduhHasil] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  /**
   * Berkas yang sudah diunduh di sesi ini, terbaru dulu. Isinya nama berkas, jenis,
   * ukuran, dan **waktu unduhnya**, plus URL `blob:` yang masih hidup supaya berkasnya
   * bisa dibuka lagi atau diunduh ulang dari daftar ini — di ponsel, folder unduhan
   * peramban tidak selalu gampang ditemukan kembali.
   */
  const [unduhan, setUnduhan] = useState<UnduhanBerkas[]>(bacaRiwayatUnduhan);
  const unduhanRef = useRef<UnduhanBerkas[]>([]);
  const unduhanSeq = useRef(0);

  useEffect(() => {
    unduhanRef.current = unduhan;
    simpanRiwayatUnduhan(unduhan);
  }, [unduhan]);

  useEffect(
    () => () => {
      // URL blob daftar ini dilepas saat halaman ditutup: kalau tidak, tiap unduhan
      // menahan berkasnya di memori sampai halaman dimuat ulang.
      for (const berkas of unduhanRef.current) {
        if (berkas.url) URL.revokeObjectURL(berkas.url);
      }
    },
    [],
  );

  /**
   * Gerbang fiturnya memakai kalimat yang sama dengan server
   * (`featureUnavailableReason`), jadi halaman tidak pernah menjanjikan laporan
   * yang akan ditolak backend.
   */
  const gateReason = featureUnavailableReason(
    planKey,
    modules.activeVerticals,
    "report.advanced",
  );
  /** Gerbang laporan lintas cabang (`scale.franchise`) — kalimat yang sama
   * dengan server, jadi tidak ada kartu yang menampilkan laporan yang akan
   * ditolak backend. */
  const franchiseGateReason = featureUnavailableReason(
    planKey,
    modules.activeVerticals,
    "scale.franchise",
  );

  const rows = PAYMENT_LABELS.map((method) => {
    const total = summary.byMethod[method];
    return {
      method,
      total,
      share: summary.revenue > 0 ? total / summary.revenue : 0,
    };
  }).filter((row) => row.total > 0);

  /**
   * Empat angka utama periode ini. Tiap petak punya ikon dan warnanya sendiri:
   * kartu yang semuanya putih membuat pemilik toko harus membaca labelnya dulu
   * untuk tahu angka mana yang omzet dan mana yang PPN.
   */
  const cards = [
    {
      key: "omzet",
      label: "Total omzet",
      value: formatIDR(summary.revenue),
      hint: "seluruh transaksi pada periode ini",
      icon: Wallet,
      tone: TONES.emerald,
    },
    {
      key: "ppn",
      label: "PPN terkumpul",
      value: formatIDR(summary.tax),
      hint: "dipungut dari pelanggan, bukan milik toko",
      icon: Landmark,
      tone: TONES.amber,
    },
    {
      key: "rata",
      label: "Rata-rata / transaksi",
      value: formatIDR(summary.averagePerTransaction),
      hint: "nilai belanja rata-rata satu nota",
      icon: Receipt,
      tone: TONES.sky,
    },
    {
      key: "jumlah",
      label: "Jumlah transaksi",
      value: String(summary.transactions),
      hint: "nota yang tercatat",
      icon: ListOrdered,
      tone: TONES.violet,
    },
  ];

  /*
    Laporan pajak & pungutan F&B: rinciannya dihitung aturan murni yang sama
    dengan halaman Pengaturan (`fnbTaxMonthReport`), dari baris penjualan yang
    benar-benar tersimpan. Yang dipungut dari pelanggan (PBJT, PPN, biaya
    layanan) dibaca dari struk masing-masing bulan, sedangkan kewajiban pengusaha
    (PPh final UMKM & PPh sewa) dihitung dari setelan yang berlaku sekarang —
    itu sebabnya barisnya diberi keterangan sendiri, bukan dicampur.
  */
  const fnbMonths = fnbTaxMonths.map((row) =>
    fnbTaxMonthReport({ row, profile: fnbTax, ppn: tax }),
  );
  const fnbTotals = fnbTaxReportTotals(fnbTaxMonths);
  const fnbOwnerTotal = fnbMonths.reduce(
    (sum, month) => sum + month.ownerObligationsIdr,
    0,
  );
  const fnbCurrent = fnbCurrentMonthSummary(fnbTaxMonths);
  const fnbMicroWarning = microExemptWarning({
    profile: fnbTax,
    monthGrossIdr: fnbCurrent.monthGrossIdr,
  });
  /** Bulan yang benar-benar ada penjualannya — dasar kalimat di bawah tabel. */
  const fnbActiveMonths = fnbMonths.filter((month) => month.row.recordedSales > 0);
  const fnbNotes = fnbActiveMonths.flatMap((month) =>
    month.notes.map((note) => ({ label: month.row.label, note })),
  );

  const report = analyticsReport;
  const peakRevenue = report.trend.reduce(
    (max, point) => (point.revenue > max ? point.revenue : max),
    0,
  );
  const peakHour = report.busyHours.reduce(
    (max, row) => (row.revenue > max ? row.revenue : max),
    0,
  );
  const peakWeekday = report.weekday.reduce(
    (max, row) => (row.revenue > max ? row.revenue : max),
    0,
  );

  /**
   * Dokumen laporan yang diunduh: bagiannya dirakit dari angka yang **sama** dengan
   * yang tampil di halaman ini (hasil aturan murni di store, bukan hitungan ulang),
   * jadi berkasnya tidak bisa berbeda dari layar. Bagian yang tidak dimuat paket atau
   * peran disebutkan di kepala berkas, bukan dihilangkan diam-diam.
   */
  function laporanBerkas() {
    const now = Date.now();
    return laporanDocument({
      workspace: session?.tenant?.name ?? "Workspace",
      store: session?.tenant?.storeName ?? "Toko",
      period: laporanDateLabel(now),
      generatedAt: now,
      summary,
      methods: rows.map((row) => ({
        method: row.method,
        total: row.total,
        share: row.share,
      })),
      fnb: { months: fnbMonths, totals: fnbTotals, ownerTotal: fnbOwnerTotal },
      analytics: gateReason ? null : report,
      franchise: franchiseGateReason ? null : franchiseReport,
      extraNotes: [
        source === "convex"
          ? "Angka dihitung dari transaksi tenant Anda."
          : "Angka berasal dari data contoh (mode demo), bukan transaksi nyata.",
      ],
    });
  }

  /**
   * Menyusun byte satu berkas laporan (tanpa menyimpannya). Dipakai tombol unduh dan
   * tombol “Unduh ulang” di daftar — supaya keduanya tidak pernah menghasilkan berkas
   * dengan isi yang berbeda.
   */
  function susunBerkas(kind: LaporanFileKind) {
    const doc = laporanBerkas();
    const filename = laporanFileName(doc, kind);
    let data: Uint8Array | string;
    let mime: string;
    if (kind === "pdf") {
      data = laporanPdfBytes(doc);
      mime = LAPORAN_PDF_MIME;
    } else if (kind === "xlsx") {
      data = laporanXlsx(doc);
      mime = LAPORAN_XLSX_MIME;
    } else {
      data = laporanCsv(doc);
      mime = LAPORAN_CSV_MIME;
    }
    const size = typeof data === "string" ? new Blob([data]).size : data.length;
    return { doc, filename, data, mime, size };
  }

  /** Pesan kegagalan penyusunan berkas — apa adanya, bukan “terjadi kesalahan”. */
  function pesanGagal(error: unknown): string {
    return `Berkas laporan gagal disusun: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }

  /**
   * Menyusun & menyimpan satu berkas laporan.
   *
   * Kegagalannya **diberitahukan**, bukan didiamkan: tombol yang ditekan lalu tidak
   * menghasilkan berkas apa pun tanpa penjelasan adalah hal yang paling membuat
   * orang mengira fiturnya rusak.
   */
  function unduhLaporan(kind: LaporanFileKind) {
    try {
      const berkas = susunBerkas(kind);
      const url = saveFile(berkas.data, berkas.filename, berkas.mime);
      unduhanSeq.current += 1;
      setUnduhan((list) =>
        [
          {
            id: `unduhan-${unduhanSeq.current}`,
            filename: berkas.filename,
            kind,
            mime: berkas.mime,
            size: berkas.size,
            at: Date.now(),
            url,
          },
          ...list,
        ].slice(0, UNDUHAN_MAKS),
      );
      setUnduhHasil({
        tone: "ok",
        text: `${berkas.filename} (${fileSizeLabel(berkas.size)}) disimpan di perangkat ini — ${berkas.doc.sections.length} bagian laporan, ${berkas.doc.charts.length} grafik, dari ${berkas.doc.period}.`,
      });
    } catch (error) {
      setUnduhHasil({ tone: "error", text: pesanGagal(error) });
    }
  }

  /**
   * Mengunduh ulang satu baris daftar.
   *
   * Untuk baris yang baru saja diunduh, berkasnya disusun lagi dari angka yang
   * **sedang tampil** — kalau ada penjualan baru sesudah unduhan pertama, berkas yang
   * tersimpan ikut memuatnya. Itu sebabnya waktunya diperbarui: barisnya memang
   * menjadi unduhan yang terbaru.
   */
  function unduhUlang(berkas: UnduhanBerkas) {
    try {
      const ulang = susunBerkas(berkas.kind);
      const url = saveFile(ulang.data, berkas.filename, berkas.mime);
      setUnduhan((list) =>
        list.map((row) =>
          row.id === berkas.id
            ? { ...row, url, size: ulang.size, at: Date.now() }
            : row,
        ),
      );
      setUnduhHasil({
        tone: "ok",
        text: `${berkas.filename} (${fileSizeLabel(
          ulang.size,
        )}) disimpan lagi dari angka yang tampil sekarang.`,
      });
    } catch (error) {
      setUnduhHasil({ tone: "error", text: pesanGagal(error) });
    }
  }

  /**
   * Ringkasan bahasa sehari-hari untuk pembaca awam.
   *
   * Diturunkan dari angka yang sama dengan tabel di bawah halaman ini — fungsi yang
   * juga menulis `summaryLines` ke dalam berkas PDF/Excel/CSV — jadi layar dan berkas
   * yang diunduh tidak bisa bercerita berbeda. Angka pasarnya dihitung di sini, bukan
   * diambil dari `rows`, supaya nilai yang di-memo tidak ikut berubah setiap render
   * hanya karena array barisnya dibuat ulang.
   */
  const ringkasanSingkat = useMemo(() => {
    const metode = PAYMENT_LABELS.map((method) => {
      const total = summary.byMethod[method];
      return {
        method: method as string,
        total,
        share: summary.revenue > 0 ? total / summary.revenue : 0,
      };
    }).filter((row) => row.total > 0);
    return laporanRingkasanSingkat({
      summary,
      methods: metode,
      fnb: { months: fnbMonths, totals: fnbTotals, ownerTotal: fnbOwnerTotal },
      analytics: gateReason ? null : report,
      franchise: franchiseGateReason ? null : franchiseReport,
    });
  }, [
    summary,
    fnbMonths,
    fnbTotals,
    fnbOwnerTotal,
    gateReason,
    report,
    franchiseGateReason,
    franchiseReport,
  ]);

  /** Bagian yang benar-benar ikut ke dalam berkas, disebutkan sebelum diunduh. */
  const bagianLaporan = [
    "Ringkasan periode",
    "Omzet per metode bayar",
    "Pajak & pungutan F&B per bulan",
    ...(gateReason ? [] : ["Analitik lanjutan"]),
    ...(franchiseGateReason ? [] : ["Lintas cabang"]),
  ];

  return (
    <div className="space-y-6">
      {/* ------------------------- Kepala halaman laporan -------------------- */}
      <section
        data-testid="laporan-kepala"
        className="relative animate-fade-up overflow-hidden rounded-xl border border-emerald-500/30 bg-card bg-gradient-to-br from-emerald-500/[0.12] via-card to-card p-5 shadow-sm sm:p-6"
      >
        <span aria-hidden className="bg-radial-glow pointer-events-none absolute inset-0" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {/*
                Warna pita judul dipilih pada tingkat 700, bukan 500/600: tulisan
                putih di atas nada terang punya kontras di bawah 4,5:1, dan pita
                yang “berwarna” tapi tulisannya samar bukan tampilan yang lebih baik.
              */}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-emerald-700 to-teal-700 px-3 py-1 text-xs font-semibold text-white shadow-sm">
                <BarChart3 className="size-3.5" />
                Laporan
              </span>
              <Badge
                variant="outline"
                className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              >
                <CalendarDays className="mr-1 size-3" />
                {laporanDateLabel(Date.now())}
              </Badge>
              <Badge variant="secondary">{bagianLaporan.length} bagian</Badge>
              <Badge variant="secondary">{laporanStampLabel(Date.now())}</Badge>
            </div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Laporan penjualan &amp; pajak
            </h2>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Satu halaman untuk seluruh angka toko — dari ringkasan yang bisa dibaca
              tanpa istilah pembukuan sampai pajak, analitik, dan lintas cabang. Tiap
              bagian punya warnanya sendiri supaya cepat ditemukan, dan berkas
              PDF/Excel/CSV yang diunduh memuat isi yang sama persis dengan yang tampil
              di sini — PDF &amp; Excel-nya bahkan memakai warna bagian yang sama.
            </p>
            <dl className="flex flex-wrap gap-x-8 gap-y-2 pt-1">
              {[
                { label: "Workspace", value: session?.tenant?.name ?? "Workspace" },
                { label: "Toko", value: session?.tenant?.storeName ?? "Toko" },
                {
                  label: "Sumber angka",
                  value: source === "convex" ? "Transaksi tenant" : "Data contoh (mode demo)",
                },
              ].map((item) => (
                <div key={item.label}>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {item.label}
                  </dt>
                  <dd className="text-sm font-semibold">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <a
              href="#unduh-laporan"
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-sky-700 to-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
            >
              <Download className="size-4" />
              Unduh laporan
            </a>
            <a
              href="#ringkasan"
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-card px-4 py-2.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-300"
            >
              <Sparkles className="size-4" />
              Ringkasan singkat
            </a>
          </div>
        </div>
      </section>

      {/*
        Peta bagian: halaman ini panjang, jadi bagiannya bisa dilompati langsung.
        Tiap pil memakai warna bagiannya sendiri — sama dengan warna kartunya di
        bawah — supaya mata bisa mengikuti warna, bukan membaca tujuh judul.
      */}
      <nav
        data-testid="laporan-peta-bagian"
        aria-label="Bagian laporan"
        className="flex flex-wrap gap-2"
      >
        {BAGIAN.map((bagian) => (
          <a
            key={bagian.id}
            href={`#${bagian.id}`}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              bagian.tone.pill,
            )}
          >
            <span
              aria-hidden
              className={cn("size-2 rounded-full bg-gradient-to-br", bagian.tone.strip)}
            />
            {bagian.label}
          </a>
        ))}
      </nav>

      {/* ------------------- Ringkasan singkat (pembaca awam) ----------------- */}
      <SectionCard
        id="ringkasan"
        testId="laporan-ringkasan"
        tone={TONES.emerald}
        icon={Sparkles}
        kicker="Bagian 1 · Tanpa istilah pembukuan"
        title="Ringkasan singkat"
        description="Dibaca apa adanya — tidak perlu paham istilah pembukuan. Angkanya sama dengan tabel di bawah, dan kalimat yang sama juga ikut tertulis di berkas yang diunduh."
      >
        <ul data-testid="laporan-ringkasan-daftar" className="grid gap-2 sm:grid-cols-2">
          {ringkasanSingkat.map((line, index) => (
            <li
              key={line}
              className={cn(
                "flex items-start gap-3 rounded-lg border bg-card/70 px-3 py-2.5 text-sm leading-relaxed",
                TONES.emerald.border,
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                  TONES.emerald.badge,
                )}
              >
                {index + 1}
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* ----------------------------- Angka utama ---------------------------- */}
      <section className="space-y-3">
        <BagianLabel id="angka-utama" tone={TONES.sky}>
          Bagian 2 · Angka utama periode ini
        </BagianLabel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((c, index) => (
            <StatTile
              key={c.key}
              label={c.label}
              value={c.value}
              hint={c.hint}
              icon={c.icon}
              tone={c.tone}
              delay={index * 60}
            />
          ))}
        </div>
      </section>

      {/* ------------------- Omzet per metode bayar (kategori) ---------------- */}
      <SectionCard
        id="omzet-metode"
        tone={TONES.teal}
        icon={CreditCard}
        kicker="Bagian 3 · Dari mana uangnya masuk"
        title="Omzet per metode bayar"
        description="Satu warna untuk satu alat bayar: yang paling sering dipakai terlihat paling panjang batangnya, dan pangsanya ditulis apa adanya."
      >
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Belum ada transaksi pada periode ini.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((m, index) => {
              const nada = BAR_PALETTE[index % BAR_PALETTE.length];
              return (
                <li
                  key={m.method}
                  className={cn("rounded-lg border bg-card/70 px-3 py-3", TONES.teal.border)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span
                        aria-hidden
                        className={cn("size-2.5 rounded-full bg-gradient-to-br", nada)}
                      />
                      {m.method}
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-semibold">
                        {formatIDR(m.total)}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          TONES.teal.badge,
                        )}
                      >
                        {Math.round(m.share * 100)}%
                      </span>
                    </span>
                  </div>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn("h-full rounded-full bg-gradient-to-r", nada)}
                      style={{ width: `${Math.max(3, Math.round(m.share * 100))}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* ---------------------- Unduhan laporan (PDF/Excel/CSV) --------------- */}
      <SectionCard
        id="unduh-laporan"
        testId="laporan-unduh"
        tone={TONES.indigo}
        icon={Download}
        kicker="Bagian 4 · Berkas dibuat di perangkat ini"
        title="Unduh laporan"
        description={
          <>
            Berkasnya dibuat di perangkat ini dari angka yang sama dengan yang tampil di
            halaman — tidak ada yang diunggah ke mana pun. Isinya <strong>tabel dan
            grafik</strong>: <strong>PDF</strong> untuk dicetak &amp; dikirim (grafiknya
            digambar sebagai batang vektor), <strong>Excel</strong> (.xlsx) supaya angkanya
            tetap bisa dijumlahkan &amp; dibuat pivot — bagannya bagan Excel asli yang ikut
            bergerak kalau selnya diubah — dan <strong>CSV</strong> (pemisah titik koma,
            desimal koma) berupa tabel untuk dibuka aplikasi lain. <strong>Tabel PDF &amp;
            Excel-nya berwarna, dan warnanya mengikuti bagiannya</strong> di halaman ini —
            ringkasan hijau, metode bayar hijau kebiruan, pajak kuning, analitik biru/ungu,
            lintas cabang merah muda — jadi bagian yang sama bisa dikenali dari warnanya
            saja, di layar maupun di berkas yang diunduh (berkas CSV memang tidak bisa
            memuat warna maupun grafik).
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Button
            data-testid="laporan-unduh-pdf"
            onClick={() => unduhLaporan("pdf")}
            className="h-auto justify-start gap-3 bg-gradient-to-br from-rose-600 to-red-600 p-4 text-left text-white shadow-sm hover:from-rose-600/90 hover:to-red-700/90"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/20">
              <FileText className="size-5" />
            </span>
            <span className="min-w-0 whitespace-normal">
              <span className="block text-sm font-semibold">Unduh PDF</span>
              <span className="block text-[11px] font-normal leading-snug opacity-90">
                Untuk dicetak &amp; dikirim: tabel berwarna per bagian, grafiknya batang
                vektor, bukan gambar.
              </span>
            </span>
          </Button>
          <Button
            variant="outline"
            data-testid="laporan-unduh-excel"
            onClick={() => unduhLaporan("xlsx")}
            className="h-auto justify-start gap-3 border-emerald-500/40 bg-card p-4 text-left hover:bg-emerald-500/10"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-600 ring-1 ring-inset ring-emerald-500/30 dark:text-emerald-400">
              <FileSpreadsheet className="size-5" />
            </span>
            <span className="min-w-0 whitespace-normal">
              <span className="block text-sm font-semibold">Unduh Excel (.xlsx)</span>
              <span className="block text-[11px] font-normal leading-snug text-muted-foreground">
                Tabel berwarna per bagian; angkanya bisa dijumlahkan &amp; dibuat pivot,
                bagannya ikut bergerak.
              </span>
            </span>
          </Button>
          <Button
            variant="outline"
            data-testid="laporan-unduh-csv"
            onClick={() => unduhLaporan("csv")}
            className="h-auto justify-start gap-3 border-sky-500/40 bg-card p-4 text-left hover:bg-sky-500/10"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-sky-500/15 text-sky-600 ring-1 ring-inset ring-sky-500/30 dark:text-sky-400">
              <FileSpreadsheet className="size-5" />
            </span>
            <span className="min-w-0 whitespace-normal">
              <span className="block text-sm font-semibold">Unduh CSV</span>
              <span className="block text-[11px] font-normal leading-snug text-muted-foreground">
                Tabel teks untuk aplikasi lain; grafiknya tidak ikut.
              </span>
            </span>
          </Button>
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0 text-indigo-500" />
          Isinya: {bagianLaporan.join(" · ")}.
          {gateReason || franchiseGateReason
            ? " Bagian yang tidak dimuat paket ini tidak disertakan, dan alasan itu tertulis di kepala berkasnya."
            : " Satu berkas memuat seluruh laporan di halaman ini."}
        </p>
        {unduhHasil && (
          <p
            data-testid="laporan-unduh-hasil"
            className={cn(
              "mt-3 rounded-lg border px-3 py-2 text-xs",
              unduhHasil.tone === "ok"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
                : "border-destructive/50 bg-destructive/10 text-destructive",
            )}
          >
            {unduhHasil.text}
          </p>
        )}

        <p className="mt-3 text-xs text-muted-foreground">
          Grafik batang ikut untuk omzet per metode bayar, tren harian, omzet per jam,
          produk teratas, omzet per bulan (pajak &amp; pungutan F&amp;B), dan omzet per
          cabang. Grafik yang datanya masih kosong tidak dipaksakan muncul — grafik
          rata tanpa batang hanya membuat berkasnya tampak lebih lengkap daripada
          isinya.
        </p>

        {/* ------------------- Daftar berkas yang sudah diunduh ---------------- */}
        <div className="mt-5 space-y-2 rounded-xl border border-indigo-500/25 bg-card/60 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="grid size-7 place-items-center rounded-lg bg-indigo-500/15 text-indigo-600 ring-1 ring-inset ring-indigo-500/30 dark:text-indigo-400">
                <History className="size-4" />
              </span>
              Berkas yang sudah diunduh ({unduhan.length})
            </div>
            {unduhan.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                data-testid="laporan-unduhan-bersihkan"
                onClick={() => setUnduhan([])}
              >
                Bersihkan daftar
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Daftar ini disimpan di perangkat ini, jadi tetap ada setelah halaman dimuat
            ulang atau ditutup. Menekan “Unduh ulang” menyusun berkasnya lagi dari angka
            yang tampil sekarang — kalau ada penjualan baru, berkas barunya ikut memuatnya.
          </p>
          {unduhan.length === 0 ? (
            <p
              data-testid="laporan-unduhan-kosong"
              className="rounded-lg border border-dashed border-indigo-500/40 bg-indigo-500/[0.05] px-3 py-2 text-xs text-muted-foreground"
            >
              Belum ada berkas yang diunduh. Setelah salah satu tombol di atas ditekan,
              berkasnya muncul di daftar ini beserta jenis, ukuran, dan tanggal unduhnya
              — dan bisa disusun ulang dari sini tanpa mencari berkasnya di folder
              unduhan.
            </p>
          ) : (
            /* Empat kolom + dua aksi; di layar 320 px isinya melebihi layar tanpa
               wadah geser (pola yang sama dengan tabel pajak & lintas cabang). */
            <div className="overflow-x-auto rounded-lg border border-indigo-500/25">
              <table
                data-testid="laporan-unduhan-daftar"
                className="w-full min-w-[34rem] text-sm"
              >
                <caption className="sr-only">
                  Berkas laporan yang pernah diunduh dari perangkat ini
                </caption>
                <thead
                  className={cn(
                    "text-left text-xs uppercase tracking-wide",
                    TONES.indigo.head,
                  )}
                >
                  <tr>
                    <th className="px-3 py-2 font-semibold">Jenis berkas</th>
                    <th className="px-3 py-2 font-semibold">Nama berkas</th>
                    <th className="px-3 py-2 text-right font-semibold">Ukuran</th>
                    <th className="px-3 py-2 font-semibold">Tanggal unduh</th>
                    <th className="px-3 py-2 text-right font-semibold">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {unduhan.map((berkas) => (
                    <tr
                      key={berkas.id}
                      data-testid="laporan-unduhan-baris"
                      data-jenis={berkas.kind}
                      data-waktu={laporanStampLabel(berkas.at)}
                      className={cn("border-t", TONES.indigo.border, TONES.indigo.zebra)}
                    >
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={JENIS_NADA[berkas.kind]}>
                          {JENIS_BERKAS[berkas.kind]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs">{berkas.filename}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fileSizeLabel(berkas.size)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {laporanStampLabel(berkas.at)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {berkas.url ? (
                          <>
                            <a
                              href={berkas.url}
                              download={berkas.filename}
                              className="font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
                              data-testid="laporan-unduhan-ulang"
                            >
                              Unduh ulang
                            </a>
                            {" · "}
                            <a
                              href={berkas.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
                            >
                              <ExternalLink className="size-3" /> Buka
                            </a>
                          </>
                        ) : (
                          /* Baris dari kunjungan sebelumnya: URL blob-nya sudah mati,
                             jadi berkasnya disusun ulang saat tombolnya ditekan. */
                          <button
                            type="button"
                            data-testid="laporan-unduhan-ulang"
                            onClick={() => unduhUlang(berkas)}
                            title="Berkas disusun ulang dari angka yang tampil sekarang"
                            className="font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
                          >
                            Unduh ulang
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SectionCard>

      {/* ------- Pajak & pungutan F&B per bulan (setelan workspace) ---------- */}
      <SectionCard
        id="pajak-fnb"
        testId="fnb-tax-report"
        tone={TONES.amber}
        icon={Landmark}
        kicker="Bagian 5 · Setelan pajak workspace"
        title="Pajak &amp; pungutan F&amp;B per bulan"
        description={
          <>
            {fnbTaxMonths.length} bulan terakhir <strong className="text-foreground">seluruh
            toko</strong> workspace ini — setelan PBJT, biaya layanan, dan PPh final
            adalah setelan workspace, jadi omzet semua cabang ikut dihitung. Angka
            pajaknya diambil dari yang tercatat di tiap struk: mengubah tarif hari ini
            tidak menulis ulang bulan lalu.
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label={`PBJT dipungut (${fnbTaxMonths.length} bulan)`}
            value={formatIDR(fnbTotals.regionalTaxIdr)}
            hint={`dari ${fnbTotals.regionalSales} transaksi ber-PBJT`}
            icon={Landmark}
            tone={TONES.amber}
          />
          <StatTile
            label={`PPN dipungut (${fnbTaxMonths.length} bulan)`}
            value={formatIDR(fnbTotals.ppnTaxIdr)}
            hint="setoran PPN pusat"
            icon={Receipt}
            tone={TONES.violet}
          />
          <StatTile
            label="Biaya layanan — bukan pajak"
            value={formatIDR(fnbTotals.serviceChargeIdr)}
            hint="dibagikan internal, bukan setoran negara"
            icon={CreditCard}
            tone={TONES.sky}
          />
          <StatTile
            label="Kewajiban pengusaha"
            value={formatIDR(fnbOwnerTotal)}
            hint="PPh final UMKM + PPh sewa, bukan dari pelanggan"
            icon={Wallet}
            tone={TONES.rose}
          />
        </div>

        <div className={cn("mt-4 overflow-x-auto rounded-lg border", TONES.amber.border)}>
          <table className="w-full min-w-[46rem] text-sm">
            <caption className="sr-only">
              Laporan pajak &amp; pungutan F&amp;B per bulan
            </caption>
            <thead
              className={cn("text-left text-xs uppercase tracking-wide", TONES.amber.head)}
            >
              <tr>
                <th className="px-3 py-2.5 font-semibold">Bulan</th>
                <th className="px-3 py-2.5 text-right font-semibold">Omzet tercatat</th>
                <th className="px-3 py-2.5 text-right font-semibold">PBJT</th>
                <th className="px-3 py-2.5 text-right font-semibold">PPN</th>
                <th className="px-3 py-2.5 text-right font-semibold">Biaya layanan</th>
                <th className="px-3 py-2.5 text-right font-semibold">PPh final UMKM</th>
                <th className="px-3 py-2.5 text-right font-semibold">PPh sewa</th>
                <th className="px-3 py-2.5 text-right font-semibold">Setoran pengusaha</th>
              </tr>
            </thead>
            <tbody>
              {fnbMonths.map((month) => (
                <tr
                  key={month.row.label}
                  data-testid={`fnb-tax-month-${month.row.year}-${month.row.monthIndex}`}
                  className={cn("border-t", TONES.amber.border, TONES.amber.zebra)}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{month.row.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {month.row.recordedSales} transaksi · omzet setahun berjalan{" "}
                      {formatIDR(month.row.yearToDateGrossIdr)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatIDR(month.row.monthGrossIdr)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {month.regionalToPayIdr > 0
                      ? formatIDR(month.regionalToPayIdr)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {month.ppnToPayIdr > 0 ? formatIDR(month.ppnToPayIdr) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {month.row.serviceChargeIdr > 0
                      ? formatIDR(month.row.serviceChargeIdr)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {month.umkm.monthTaxIdr > 0
                      ? formatIDR(month.umkm.monthTaxIdr)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {month.rent.withheldIdr > 0
                      ? formatIDR(month.rent.withheldIdr)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {month.ownerObligationsIdr > 0
                      ? formatIDR(month.ownerObligationsIdr)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot data-testid="fnb-tax-total">
              <tr
                className={cn(
                  "border-t-2 border-amber-500/60 font-semibold",
                  TONES.amber.total,
                )}
              >
                <td className="px-3 py-2 font-semibold">
                  Jumlah
                  <div className="text-[11px] font-normal text-muted-foreground">
                    dari {fnbTotals.recordedSales} transaksi yang tercatat
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {formatIDR(fnbTotals.grossIdr)}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {formatIDR(fnbTotals.regionalTaxIdr)}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {formatIDR(fnbTotals.ppnTaxIdr)}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {formatIDR(fnbTotals.serviceChargeIdr)}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {formatIDR(
                    fnbMonths.reduce((sum, month) => sum + month.umkm.monthTaxIdr, 0),
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {formatIDR(
                    fnbMonths.reduce((sum, month) => sum + month.rent.withheldIdr, 0),
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold">
                  {formatIDR(fnbOwnerTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {fnbActiveMonths.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Belum ada penjualan yang tercatat pada {fnbTaxMonths.length} bulan terakhir.
            Setelah kasir mencatat penjualan, bulan-bulannya terisi sendiri — penjualan
            yang dibatalkan (void) dan pesanan tertahan tidak pernah ikut dihitung.
          </p>
        )}

        {fnbMicroWarning && (
          <p
            data-testid="fnb-tax-micro-warning"
            className="mt-3 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
          >
            {fnbMicroWarning}
          </p>
        )}

        {fnbNotes.length > 0 && (
          <div data-testid="fnb-tax-notes" className="mt-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Info className="size-4 text-amber-500" />
              Catatan per bulan
            </div>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {fnbNotes.map((entry, index) => (
                <li
                  key={`${entry.label}-${index}`}
                  className={cn(
                    "flex items-start gap-2 rounded-lg border bg-card/70 px-3 py-1.5",
                    TONES.amber.border,
                  )}
                >
                  <span className="shrink-0 font-medium text-foreground">{entry.label}</span>
                  <span>{entry.note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-xs text-muted-foreground">
          Dipungut dari pelanggan: <strong className="text-foreground">PBJT</strong> disetor ke kas
          daerah (Bapenda), <strong className="text-foreground">PPN</strong> lewat jalur pajak
          pusat, dan <strong className="text-foreground">biaya layanan</strong> bukan pajak sama
          sekali. Kewajiban pengusaha (PPh final UMKM {formatPctPlain(UMKM_FINAL_RATE_PCT)}
          {fnbTax.rentTaxActive ? " + PPh sewa" : ""}) dihitung dari omzet tercatat dan tidak
          pernah ditambahkan ke struk pelanggan. Tarif, batas omzet mikro, dan dasar pengenaan
          pajak berbeda per Perda — semuanya bisa diubah di halaman Pengaturan, dan angka di sini
          tetap <strong className="text-foreground">perkiraan dari data aplikasi</strong>, bukan
          perhitungan pajak resmi.
        </p>
      </SectionCard>

      {/* --------------- Analitik lanjutan (`report.advanced`) ---------------- */}
      <SectionCard
        id="analitik"
        tone={TONES.violet}
        icon={TrendingUp}
        kicker="Bagian 6 · Enterprise"
        title="Analitik lanjutan (Enterprise)"
        description="Arah omzet, margin kotor, produk & kategori yang benar-benar menghasilkan, plus jam dan hari tersibuk — dari data penjualan nyata, bukan perkiraan."
      >
        {gateReason ? (
          <p className="flex items-start gap-2 rounded-lg border border-violet-500/30 bg-violet-500/[0.06] px-3 py-2 text-sm text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            {gateReason}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              {/* Pemilih periode: satu kelompok pil, jadi yang aktif terbaca sebagai
                  pilihan yang sedang dipakai — bukan tiga tombol terpisah. */}
              <div className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 p-1">
                {ANALYTICS_PERIODS.map((days) => (
                  <Button
                    key={days}
                    size="sm"
                    variant={analyticsDays === days ? "default" : "ghost"}
                    className={cn(
                      "h-7 rounded-full px-3 text-xs",
                      analyticsDays === days
                        ? "bg-violet-600 text-white hover:bg-violet-600/90"
                        : "text-violet-700 hover:bg-violet-500/15 dark:text-violet-300",
                    )}
                    onClick={() => setAnalyticsDays(days)}
                  >
                    {days} hari
                  </Button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                {report.range.days} hari terakhir · dibandingkan dengan periode
                sebelumnya yang sama panjang
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label="Omzet bersih"
                value={formatIDR(report.totals.netRevenue)}
                icon={TrendingUp}
                tone={TONES.emerald}
                extra={<DeltaBadge value={report.comparison.revenueDeltaPct} />}
              />
              <StatTile
                label="Transaksi"
                value={report.totals.transactions}
                icon={Receipt}
                tone={TONES.sky}
                extra={<DeltaBadge value={report.comparison.transactionsDeltaPct} />}
              />
              <StatTile
                label="Rata-rata keranjang"
                value={formatIDR(report.totals.averageBasket)}
                icon={Wallet}
                tone={TONES.teal}
                extra={<DeltaBadge value={report.comparison.averageBasketDeltaPct} />}
              />
              <StatTile
                label="Margin kotor"
                value={
                  <>
                    {formatIDR(report.margin.grossProfit)}{" "}
                    <span className="text-sm text-muted-foreground">
                      ({report.margin.marginPct}%)
                    </span>
                  </>
                }
                icon={PieChart}
                tone={TONES.violet}
                extra={
                  <DeltaBadge value={report.comparison.marginPctDelta} suffix=" poin" />
                }
              />
            </div>

            {/* Tren harian: satu bar per hari, termasuk hari tanpa penjualan. */}
            <div className="mt-5 rounded-xl border border-violet-500/25 bg-card/60 p-4">
              <div className="flex items-center justify-between gap-2 text-sm font-semibold">
                <span>Tren omzet harian</span>
                <span className="font-mono text-xs text-muted-foreground">
                  tertinggi {formatIDR(peakRevenue)}
                </span>
              </div>
              <div
                className="mt-3 flex items-end gap-[3px]"
                style={{ height: TREND_HEIGHT_PX }}
                role="img"
                aria-label={`Tren omzet ${report.range.days} hari terakhir`}
              >
                {report.trend.map((point) => (
                  <div
                    key={point.key}
                    className="group relative flex-1 rounded-t bg-gradient-to-t from-violet-600 to-fuchsia-400 opacity-80 transition-opacity hover:opacity-100"
                    style={{
                      height:
                        peakRevenue > 0
                          ? `${Math.max(2, Math.round((point.revenue / peakRevenue) * TREND_HEIGHT_PX))}px`
                          : "2px",
                    }}
                    title={`${point.label}: ${formatIDR(point.revenue)} · ${point.transactions} transaksi`}
                  >
                    <span className="sr-only">
                      {point.label} {formatIDR(point.revenue)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                <span>{report.trend[0]?.label}</span>
                <span>{report.trend[report.trend.length - 1]?.label}</span>
              </div>
            </div>

            {/* Temuan: angka yang sudah diterjemahkan jadi kalimat. */}
            {report.insights.length > 0 && (
              <div className="mt-5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Lightbulb className="size-4 text-violet-500" />
                  Temuan
                </div>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {report.insights.map((insight) => {
                    const Icon = INSIGHT_ICONS[insight.level];
                    return (
                      <li
                        key={insight.text}
                        className={cn(
                          "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
                          INSIGHT_CLASSES[insight.level],
                        )}
                      >
                        <Icon className="mt-0.5 size-3.5 shrink-0" />
                        <span>{insight.text}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="rounded-xl border border-violet-500/25 bg-card/60 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <TrendingUp className="size-4 text-violet-500" />
                  Produk teratas
                </div>
                {report.topProducts.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Belum ada penjualan pada periode ini.
                  </p>
                ) : (
                  /* Empat kolom angka; di layar 320 px kolom “Margin” terpotong
                     tanpa wadah geser. */
                  <div className="mt-3 overflow-x-auto rounded-lg border border-violet-500/25">
                    <table className="w-full text-sm">
                      <thead
                        className={cn(
                          "text-left text-xs uppercase tracking-wide",
                          TONES.violet.head,
                        )}
                      >
                        <tr>
                          <th className="px-3 py-2 font-semibold">Produk</th>
                          <th className="px-3 py-2 text-right font-semibold">Qty</th>
                          <th className="px-3 py-2 text-right font-semibold">Omzet</th>
                          <th className="px-3 py-2 text-right font-semibold">Margin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.topProducts.map((row) => (
                          <tr
                            key={row.productId}
                            className={cn(
                              "border-t",
                              TONES.violet.border,
                              TONES.violet.zebra,
                            )}
                          >
                            <td className="px-3 py-2">
                              <div className="truncate font-medium">{row.name}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {row.category} · {row.sharePct}% omzet
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {row.quantity}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {formatIDR(row.revenue)}
                            </td>
                            <td
                              className={cn(
                                "px-3 py-2 text-right font-mono font-semibold",
                                row.marginPct < 0
                                  ? "text-destructive"
                                  : row.marginPct < 20
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-emerald-600 dark:text-emerald-400",
                              )}
                            >
                              {row.marginPct}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="mt-4 flex items-center gap-2 text-sm font-semibold">
                  <PieChart className="size-4 text-violet-500" />
                  Per kategori
                </div>
                <div className="mt-3 space-y-2">
                  {report.byCategory.map((row, index) => {
                    const nada = BAR_PALETTE[index % BAR_PALETTE.length];
                    return (
                      <div
                        key={row.category}
                        className={cn(
                          "rounded-lg border bg-card/70 px-3 py-2",
                          TONES.violet.border,
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="flex items-center gap-2 font-medium">
                            <span
                              aria-hidden
                              className={cn(
                                "size-2.5 rounded-full bg-gradient-to-br",
                                nada,
                              )}
                            />
                            {row.category}
                          </span>
                          <span className="font-mono">
                            {formatIDR(row.revenue)}{" "}
                            <span className="text-muted-foreground">({row.sharePct}%)</span>
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={cn("h-full rounded-full bg-gradient-to-r", nada)}
                            style={{ width: `${Math.max(3, Math.round(row.sharePct))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-violet-500/25 bg-card/60 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Clock className="size-4 text-violet-500" />
                    Jam tersibuk
                  </div>
                  <div className="mt-3 flex items-end gap-[2px]" style={{ height: 64 }}>
                    {report.busyHours.map((row) => (
                      <div
                        key={row.hour}
                        className="flex-1 rounded-t bg-gradient-to-t from-violet-600 to-sky-400 opacity-85 transition-opacity hover:opacity-100"
                        style={{
                          height:
                            peakHour > 0
                              ? `${Math.max(2, Math.round((row.revenue / peakHour) * 64))}px`
                              : "2px",
                        }}
                        title={`${String(row.hour).padStart(2, "0")}:00 · ${formatIDR(row.revenue)} · ${row.transactions} transaksi`}
                      />
                    ))}
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                    <span>00:00</span>
                    <span>12:00</span>
                    <span>23:00</span>
                  </div>
                </div>

                <div className="rounded-xl border border-violet-500/25 bg-card/60 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <CalendarDays className="size-4 text-violet-500" />
                    Pola hari
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {report.weekday.map((row) => (
                      <div key={row.weekday} className="flex items-center gap-2 text-xs">
                        <span className="w-16 shrink-0 text-muted-foreground">
                          {["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][
                            row.weekday
                          ]}
                        </span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400"
                            style={{
                              width:
                                peakWeekday > 0
                                  ? `${Math.max(2, Math.round((row.revenue / peakWeekday) * 100))}%`
                                  : "0%",
                            }}
                          />
                        </div>
                        <span className="w-24 shrink-0 text-right font-mono">
                          {formatIDR(row.revenue)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge
                    variant="outline"
                    className={
                      report.margin.uncostedRevenue > 0
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    }
                  >
                    <Sparkles className="mr-1 size-3" />
                    {report.margin.uncostedRevenue > 0
                      ? `Sebagian omzet belum ber-HPP (${formatIDR(report.margin.uncostedRevenue)})`
                      : "Semua produk punya harga beli"}
                  </Badge>
                  <span>
                    Margin dihitung dari omzet bersih (tanpa PPN) − harga pokok.
                  </span>
                </div>
              </div>
            </div>

            {/*
              Bagian enterprise dari analitik: **proyeksi** akhir periode (bukan
              hanya “berapa yang sudah masuk”) dan **analisis keranjang** — produk
              mana yang benar-benar dibeli bersama. Keduanya dari angka yang sama
              dengan yang dikirim ke berkas yang diunduh.
            */}
            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div
                data-testid="analitik-proyeksi"
                className="rounded-xl border border-violet-500/25 bg-card/60 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Target className="size-4 text-violet-500" />
                    Proyeksi akhir periode
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {report.forecast.hasBasis
                      ? `${report.forecast.elapsedDays} hari penuh`
                      : "belum ada hari penuh"}
                  </span>
                </div>

                {report.forecast.hasBasis ? (
                  <>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <StatTile
                        label="Omzet bersih"
                        value={formatIDR(report.forecast.projectedNet)}
                        icon={TrendingUp}
                        tone={TONES.emerald}
                      />
                      <StatTile
                        label="Laba kotor"
                        value={formatIDR(report.forecast.projectedProfit)}
                        icon={PieChart}
                        tone={TONES.violet}
                      />
                      <StatTile
                        label="Transaksi"
                        value={report.forecast.projectedTransactions}
                        icon={Receipt}
                        tone={TONES.sky}
                      />
                    </div>
                    <p
                      data-testid="analitik-proyeksi-laju"
                      className="mt-3 text-xs text-muted-foreground"
                    >
                      Laju {formatIDR(report.forecast.netRunRate)}/hari dari{" "}
                      {report.forecast.elapsedDays} hari penuh.{" "}
                      {report.forecast.todayCounted
                        ? `Hari ini sudah ${formatIDR(report.forecast.todayNet)} dan belum dihitung penuh.`
                        : ""}{" "}
                      {report.forecast.previousDays} hari penuh ini vs{" "}
                      {report.forecast.previousDays} hari pertama periode sebelumnya:{" "}
                      {formatIDR(report.forecast.previousSamePaceNet)}
                      {report.forecast.paceDeltaPct === null
                        ? " (belum ada pembanding)"
                        : ` (${report.forecast.paceDeltaPct > 0 ? "+" : ""}${report.forecast.paceDeltaPct}%)`}
                      .
                    </p>
                  </>
                ) : (
                  <p
                    data-testid="analitik-proyeksi-laju"
                    className="mt-2 text-sm text-muted-foreground"
                  >
                    Belum ada hari penuh di dalam periode ini, jadi lajunya belum bisa
                    diproyeksikan. Yang sudah tercatat sejauh ini:{" "}
                    {formatIDR(
                      report.forecast.completedNet + report.forecast.todayNet,
                    )}{" "}
                    omzet bersih.
                  </p>
                )}
              </div>

              <div
                data-testid="analitik-keranjang"
                className="rounded-xl border border-violet-500/25 bg-card/60 p-4"
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ShoppingCart className="size-4 text-violet-500" />
                  Keranjang & pasangan produk
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Rata-rata {formatDesimal(report.basket.averageItems)} barang per nota ·{" "}
                  {report.basket.multiItemSharePct}% nota memuat dua jenis barang atau lebih
                  {report.basket.skippedReceipts > 0
                    ? ` · ${report.basket.skippedReceipts} nota tanpa baris barang dilewati`
                    : ""}
                  .
                </p>

                <div className="mt-3 space-y-2">
                  {report.basket.sizes.map((row, index) => {
                    const nada = BAR_PALETTE[index % BAR_PALETTE.length];
                    return (
                      <div key={row.label} className="text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{row.label}</span>
                          <span className="font-mono">
                            {row.receipts} nota{" "}
                            <span className="text-muted-foreground">({row.sharePct}%)</span>
                          </span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={cn("h-full rounded-full bg-gradient-to-r", nada)}
                            style={{ width: `${Math.max(3, Math.round(row.sharePct))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 text-sm font-semibold">Sering dibeli bersama</div>
                {report.basket.pairs.length === 0 ? (
                  <p
                    data-testid="analitik-pasangan-kosong"
                    className="mt-2 text-xs text-muted-foreground"
                  >
                    Belum ada nota dengan dua produk berbeda pada periode ini.
                  </p>
                ) : (
                  /* Enam kolom angka; di layar 320 px tabelnya perlu wadah geser. */
                  <div className="mt-2 overflow-x-auto rounded-lg border border-violet-500/25">
                    <table className="w-full text-sm">
                      <thead
                        className={cn(
                          "text-left text-xs uppercase tracking-wide",
                          TONES.violet.head,
                        )}
                      >
                        <tr>
                          <th className="px-3 py-2 font-semibold">Pasangan</th>
                          <th className="px-3 py-2 text-right font-semibold">Nota</th>
                          <th className="px-3 py-2 text-right font-semibold">Pangsa</th>
                          <th className="px-3 py-2 text-right font-semibold">Lift (×)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.basket.pairs.map((row) => (
                          <tr
                            key={`${row.aId}:${row.bId}`}
                            className={cn(
                              "border-t",
                              TONES.violet.border,
                              TONES.violet.zebra,
                            )}
                          >
                            <td className="px-3 py-2">
                              <div className="font-medium">{row.aName}</div>
                              <div className="text-[11px] text-muted-foreground">
                                + {row.bName} · {formatIDR(row.revenue)} omzet
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {row.together}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {row.supportPct}%
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold">
                              {formatDesimal(row.lift)}×
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p
                  data-testid="analitik-pasangan-catatan"
                  className="mt-2 text-[11px] text-muted-foreground"
                >
                  Satu produk dihitung sekali per nota. Angka <em>lift</em> menyatakan berapa
                  kali lebih sering keduanya dibeli bersama dibanding kalau keduanya saling
                  bebas — di atas 1 berarti saling menarik.
                  {report.basket.truncated
                    ? " Sebagian pasangan belum dipindai karena batas pemindaian."
                    : ""}
                </p>
              </div>
            </div>
          </>
        )}
      </SectionCard>

      {/* ---------- Skala franchise (`scale.franchise`): lintas cabang -------- */}
      <SectionCard
        id="franchise"
        tone={TONES.rose}
        icon={Building2}
        kicker="Bagian 7 · Jaringan"
        title="Skala franchise · lintas cabang"
        description={
          <>
            Satu laporan untuk seluruh cabang, dibaca dengan anggaran per cabang —
            bukan dengan memindai seluruh riwayat tenant. Anggarannya:{" "}
            {describeBudget(franchiseReport.budget)}
          </>
        }
      >
        {franchiseGateReason ? (
          <p className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-sm text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            {franchiseGateReason}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label={`Omzet jaringan (${franchiseReport.days} hari)`}
                value={formatIDR(franchiseReport.totals.revenue)}
                icon={TrendingUp}
                tone={TONES.rose}
              />
              <StatTile
                label="Transaksi"
                value={franchiseReport.totals.transactions}
                icon={Receipt}
                tone={TONES.sky}
              />
              <StatTile
                label="Rata-rata keranjang"
                value={formatIDR(franchiseReport.totals.averageBasket)}
                icon={Wallet}
                tone={TONES.teal}
              />
              <StatTile
                label="Cabang"
                value={`${franchiseReport.totals.activeOutlets} aktif`}
                hint={`${franchiseReport.totals.inactiveOutlets} nonaktif`}
                icon={Building2}
                tone={TONES.emerald}
              />
            </div>

            {franchiseReport.truncated && (
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Sebagian angka dihitung dari jendela terbatas:{" "}
                {franchiseReport.skippedOutlets} cabang belum diagregasi
                {franchiseReport.beyondWindow > 0
                  ? ` dan ${franchiseReport.beyondWindow} cabang di luar jendela global`
                  : ""}
                ; cabang yang omzetnya terpotong ditandai “sebagian”.
              </p>
            )}

            {franchiseReport.outlets.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Belum ada cabang aktif dengan penjualan pada periode ini.
              </p>
            ) : (
              /*
                Laporan lintas cabang punya lima kolom angka dan lebih lebar
                dari layar HP; tanpa wadah geser, kolom “Pangsa” terpotong di
                tepi kanan. Tabel F&B di atasnya sudah memakai cara yang sama.
              */
              <div className={cn("mt-3 overflow-x-auto rounded-lg border", TONES.rose.border)}>
                <table className="w-full text-sm">
                  <thead
                    className={cn("text-left text-xs uppercase tracking-wide", TONES.rose.head)}
                  >
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">Cabang</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Omzet</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Transaksi</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Rata-rata</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Pangsa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {franchiseReport.outlets.map((row) => (
                      <tr
                        key={row.storeId}
                        className={cn("border-t", TONES.rose.border, TONES.rose.zebra)}
                      >
                        <td className="px-3 py-2">
                          <div className="truncate font-medium">{row.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {row.code}
                            {row.truncated ? " · sebagian (mentok anggaran)" : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatIDR(row.revenue)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {row.transactions}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {formatIDR(row.averageBasket)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {row.sharePct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {franchiseReport.topSales.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Receipt className="size-4 text-rose-500" />
                  Transaksi terbesar jaringan
                </div>
                <ul className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2">
                  {franchiseReport.topSales.map((sale) => (
                    <li
                      key={sale.saleId}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card/70 px-3 py-2",
                        TONES.rose.border,
                      )}
                    >
                      <span className="font-medium">
                        {sale.storeName} · {sale.number}
                      </span>
                      <span className="font-mono font-semibold">{formatIDR(sale.total)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </SectionCard>

      <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-secondary/20 px-4 py-3">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-xs text-muted-foreground">
          {source === "convex"
            ? "Dihitung dari transaksi tenant Anda pada hari ini."
            : "Angka ini berasal dari data contoh. Setelah server tersambung, nilainya dihitung dari transaksi nyata per tenant."}
          {!gateReason &&
            ` Analitik lanjutan memakai ${report.range.days} hari terakhir dan membandingkannya dengan periode sebelumnya yang sama panjang.`}
        </p>
      </div>
    </div>
  );
}

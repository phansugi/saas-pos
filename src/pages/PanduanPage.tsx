import { BookOpen, Download, ExternalLink, FileText, ImageUp, MessageCircle, PackagePlus, Truck, Warehouse } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSession } from "@/lib/session";
import { useStore } from "@/lib/store";

/** Berkas panduan yang disajikan dari `public/panduan/`. */
const PDF_URL = "/panduan/panduan-mesinpos.pdf";

/**
 * Jalur mengisi stok, disalin dari panduan PDF supaya halaman ini tetap berguna
 * di perangkat yang tidak bisa menampilkan pratinjau PDF (banyak peramban mobile
 * hanya mengunduhnya).
 */
const STOCK_ROUTES = [
  {
    icon: PackagePlus,
    title: "Stok awal saat produk dibuat",
    where: "Produk & Stok - tombol Tambah produk",
    when: "Barang yang sudah ada di rak saat pertama kali didata.",
    to: "/app/products",
    cta: "Buka Produk & Stok",
  },
  {
    icon: Warehouse,
    title: "Sesuaikan stok manual",
    where: "Produk & Stok - tombol Sesuaikan stok",
    when: "Barang datang tanpa PO, rusak, hilang, atau selisih hitung.",
    to: "/app/products",
    cta: "Sesuaikan stok",
  },
  {
    icon: Truck,
    title: "Penerimaan barang (GRN)",
    where: "Pembelian - kartu Penerimaan barang (GRN)",
    when: "Barang datang dari supplier lengkap dengan dokumen pesanan.",
    to: "/app/purchasing",
    cta: "Buka Pembelian",
  },
];

/**
 * Panduan singkat kirim struk ke WhatsApp pembeli.
 *
 * Ditulis di halaman ini karena kasir membukanya dari sidebar saat baru memakai
 * aplikasinya, dan pratinjau PDF-nya sering tidak tampil di ponsel. Isinya
 * mengikuti perilaku yang benar-benar ada di layar kasir: **satu gambar struk
 * PNG berlogo** yang dikirim sebagai pesan gambar (tampil sebagai foto), bukan
 * PDF lagi — dan apa yang terjadi kalau kanalnya belum tersambung.
 */
const WA_STEPS = [
  "Selesaikan pembayarannya: dialog struk terbuka sendiri, dan tombol Kirim ke WhatsApp pembeli ada di dalamnya (tombol cetak tidak lagi muncul lebih dulu).",
  "Tentukan nomornya: member yang sudah mengisi nomor dikirim ke nomor tersimpannya, sedangkan pembeli umum (tanpa member) memakai kolom Nomor WhatsApp pembeli yang diisi kasir.",
  "Tekan Kirim ke WhatsApp pembeli, lalu baca laporannya: nomor tujuan, ukuran gambar, dan kata “disimulasikan” di mode demo — bukan klaim terkirim tanpa bukti.",
];

export function PanduanPage() {
  const { logo } = useStore();
  const { session } = useSession();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-primary/12 text-primary">
            <BookOpen className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Panduan MesinPOS</h2>
            <p className="text-sm text-muted-foreground">
              Cara mengisi stok dan menjalankan toko, langkah demi langkah.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1.5">
            <FileText className="size-3" />
            18 bagian · 12 gambar
          </Badge>
          <Button asChild>
            <a href={PDF_URL} download="panduan-mesinpos.pdf">
              <Download className="size-4" />
              Unduh PDF
            </a>
          </Button>
        </div>
      </header>

      {/*
        Identitas workspace: logo yang dipakai bersama oleh sidebar dan struk.
        Halaman ini dibuka semua peran (`report.view`), jadi yang ditampilkan adalah
        keadaannya apa adanya — kasir melihat logo mana yang sedang tercetak di
        struknya, dan yang memegang `billing.manage` bisa langsung menggantinya.
      */}
      <Card data-testid="panduan-identitas">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Identitas workspace di struk &amp; sidebar</CardTitle>
          <CardDescription>
            Logo toko yang sama tampil di sidebar aplikasi dan tercetak di atas nama
            usaha pada setiap lembar struk belanja.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {logo ? (
              <img
                src={logo.url}
                alt={`Logo ${session?.tenant?.name ?? "workspace"}`}
                data-testid="panduan-logo"
                className="h-16 w-auto max-w-48 rounded-lg border border-border bg-background object-contain p-2"
              />
            ) : (
              <span
                data-testid="panduan-logo-kosong"
                className="grid size-16 shrink-0 place-items-center rounded-lg border border-dashed border-border text-muted-foreground"
              >
                <ImageUp className="size-5" />
              </span>
            )}
            <p className="min-w-0 text-sm text-muted-foreground">
              {logo
                ? "Logo ini juga jadi penanda workspace di sidebar kiri, dan di struk dicetak kecil (110 px × 110 px) serta hitam putih — sama seperti teks di sekitarnya."
                : "Workspace ini belum punya logo, jadi struknya dicetak tanpa logo dan sidebar memakai ikon bawaan. Pasang lewat Pengaturan → kartu Struk belanja (butuh izin billing.manage)."}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/app/settings">
              <ImageUp className="size-4" />
              Atur logo toko
            </Link>
          </Button>
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-3">
        {STOCK_ROUTES.map((route) => (
          <Card key={route.title}>
            <CardHeader className="pb-2">
              <span className="grid size-9 place-items-center rounded-lg bg-primary/12 text-primary">
                <route.icon className="size-4" />
              </span>
              <CardTitle className="mt-2 text-base">{route.title}</CardTitle>
              <CardDescription>{route.where}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{route.when}</p>
              <Link
                to={route.to}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                {route.cta}
                <ExternalLink className="size-3.5" />
              </Link>
            </CardContent>
          </Card>
        ))}
      </section>

      <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
        Kasir hanya menjual stok yang ada di <strong>lokasi jual</strong>. Barang yang
        masih tersimpan di gudang harus dipindahkan dulu di halaman Gudang &amp; Stok.
      </p>

      {/*
        Panduan singkat kirim struk ke WhatsApp pembeli (lihat `WA_STEPS`): yang
        dijelaskan adalah perilaku yang benar-benar ada di layar kasir sekarang —
        satu gambar struk berlogo, bukan PDF — beserta jalur lain & syarat kanalnya.
      */}
      <Card data-testid="panduan-kirim-struk">
        <CardHeader className="pb-3">
          <span className="grid size-9 place-items-center rounded-lg bg-primary/12 text-primary">
            <MessageCircle className="size-4" />
          </span>
          <CardTitle className="mt-2 text-base">
            Kirim struk ke WhatsApp pembeli
          </CardTitle>
          <CardDescription>
            Satu tombol di dialog struk sesudah pembayarannya lunas. Yang sampai ke
            pembeli adalah <strong>gambar struk PNG berlogo</strong> — tampil sebagai
            foto di percakapan WhatsApp, jadi identitas tokonya terlihat tanpa dibuka
            dulu.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-3 text-sm text-muted-foreground">
            {WA_STEPS.map((langkah, index) => (
              <li key={langkah} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <span>{langkah}</span>
              </li>
            ))}
          </ol>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-secondary/30 px-3 py-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Kalau kanalnya belum tersambung</p>
              <p className="mt-1">
                Jawabannya menyebutkan sebabnya beserta kuncinya
                (<code className="text-xs">WHATSAPP_ACCESS_TOKEN</code> +{" "}
                <code className="text-xs">WHATSAPP_PHONE_NUMBER_ID</code>), dan kunci itu hidup di
                lingkungan <strong>deployment</strong> (Settings → Environment, atau{" "}
                <code className="text-xs">bunx convex env set …</code>) — bukan di berkas env mesin kasir.
                Struknya tetap bisa sampai lewat tautan <code className="text-xs">wa.me</code>{" "}
                yang membawa <strong>isi struknya</strong> sebagai teks, atau lewat tombol{" "}
                <strong>Bagikan gambar struk</strong> (lembar bagikan perangkat) dan{" "}
                <strong>Unduh PDF</strong> lalu dilampirkan sendiri.
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-secondary/30 px-3 py-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Yang perlu disiapkan</p>
              <p className="mt-1">
                Nomor WhatsApp pembeli (nomor member, atau nomor yang diketik kasir
                untuk pembeli umum — tidak disimpan sebagai member), izin{" "}
                <code className="text-xs">pos.sell</code> untuk mengirim, dan kunci
                kanal WhatsApp di lingkungan <strong>deployment</strong> supaya
                pesannya benar-benar keluar. Nomor yang tampil di layar selalu
                tersensor sebagian.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              to="/app/pos"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Buka Kasir untuk mencobanya
              <ExternalLink className="size-3.5" />
            </Link>
            <Link
              to="/app/settings"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Setelan struk &amp; logo di Pengaturan
              <ExternalLink className="size-3.5" />
            </Link>
          </div>

          <p className="text-xs text-muted-foreground">
            Ringkasan yang sama juga ada di berkas PDF panduan sebagai{" "}
            <strong>bagian 18</strong>, lengkap dengan langkah, syarat kanalnya, dan
            apa yang tercatat di jejak audit.
          </p>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pratinjau panduan</CardTitle>
          <CardDescription>
            Berkas PDF 18 bagian: masuk &amp; menyiapkan workspace, tiga cara mengisi
            stok, <strong>pembelian lengkap</strong> (supplier, PR, PO, penerimaan
            bertahap, tagihan supplier, pencocokan 3 arah &amp; pembayaran hutang),
            memindahkan stok, <strong>opname lengkap</strong> (hitung fisik, selisih,
            posting), penjualan di kasir, <strong>merapikan produk yang sudah
            tersimpan</strong> (ubah nama/SKU/harga beli, nonaktifkan, hapus),
            <strong>setelan PPN</strong> (ubah tarif &amp; mematikannya),
            <strong>logo toko</strong> (dipakai sidebar &amp; setiap struk),{" "}
            <strong>printer &amp; kertas struk</strong> (jenis mesin, lebar kertas &
            ukuran cetak yang mengatur dirinya sendiri), dan{" "}
            <strong>kirim struk ke WhatsApp pembeli</strong> (gambar berlogo yang
            tampil sebagai foto, syarat kanalnya, dan jalan lain saat kanalnya belum
            tersambung), sampai pemecahan masalah stok. Kalau
            perangkat Anda tidak menampilkan pratinjau, pakai tombol{" "}
            <strong>Unduh PDF</strong> di atas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[70vh] min-h-[420px] overflow-hidden rounded-lg border border-border bg-secondary/20">
            <iframe
              src={PDF_URL}
              title="Pratinjau panduan MesinPOS (PDF)"
              className="size-full"
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Berkas yang sama juga bisa dibuka langsung di{" "}
            <a href={PDF_URL} target="_blank" rel="noreferrer" className="text-primary underline">
              /panduan/panduan-mesinpos.pdf
            </a>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

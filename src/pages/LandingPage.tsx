import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Building2,
  Check,
  ChefHat,
  Clock,
  CreditCard,
  FileCheck2,
  LayoutGrid,
  Lock,
  Network,
  Printer,
  QrCode,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  Users,
  Warehouse,
  WifiOff,
} from "lucide-react";
import { FullscreenToggle } from "@/components/FullscreenToggle";
import { InstallButton } from "@/components/InstallPrompt";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFullscreen } from "@/lib/useFullscreen";
import { formatIDR } from "@/lib/utils";
import { FEATURE_LABELS, PLAN_LIST } from "@/lib/billing";

const features = [
  {
    icon: WifiOff,
    title: "Offline-first resilience",
    body: "Kasir tetap jalan penuh saat internet mati. Transaksi masuk antrean lokal lalu tersinkron otomatis begitu online.",
  },
  {
    icon: BarChart3,
    title: "Real-time reporting",
    body: "Omzet, transaksi, dan stok kritis ter-update langsung lintas perangkat tanpa refresh maupun polling.",
  },
  {
    icon: ShieldCheck,
    title: "RBAC granular",
    body: "Super Admin, Store Manager, Cashier, Inventory Staff, Finance — hak akses atomik per role & per cabang.",
  },
  {
    icon: Printer,
    title: "Peripheral siap pakai",
    body: "Printer ESC/POS Bluetooth & USB, scanner barcode, dan laci uang terintegrasi langsung ke terminal.",
  },
  {
    icon: QrCode,
    title: "Pembayaran digital",
    body: "QRIS dinamis, kartu, dan virtual account lewat Xendit & GDCPay dengan rekonsiliasi otomatis.",
  },
  {
    icon: Network,
    title: "Multi-tenant by design",
    body: "Setiap merchant terisolasi: data, pengguna, cabang, dan langganan terpisah penuh sejak hari pertama.",
  },
];

const modules = [
  {
    icon: ChefHat,
    name: "Modul F&B",
    tag: "Professional",
    points: [
      "Visual table management & denah meja interaktif",
      "Kitchen Display System + KOT terpisah dapur/bar",
      "Pesanan QR meja — tamu pesan & bayar sendiri dari ponselnya",
      "Modifier item (level pedas, extra topping)",
    ],
  },
  {
    icon: Truck,
    name: "Modul Grosir & Retail",
    tag: "Professional",
    points: [
      "Multi-tier pricing berdasarkan kuantitas",
      "Konversi satuan multi-level (Dus, Pak, Pcs)",
      "Piutang B2B & credit limit pelanggan",
    ],
  },
  {
    icon: LayoutGrid,
    name: "Modul UMKM",
    tag: "Starter",
    points: [
      "Grid menu cepat untuk kasir",
      "Buka/tutup kasir harian (shift & Z-report)",
      "Struk Bluetooth & laporan omzet harian",
    ],
  },
];

/**
 * Warna lencana status roadmap.
 *
 * Dipisah jadi fungsi karena statusnya kini bermacam-macam: fase yang seluruh
 * klausanya sudah punya kode, gerbang, dan harness berstatus **Selesai** (warna
 * utama, bukan abu-abu "belum jadi"), fase yang sedang dikerjakan berstatus
 * **Berjalan**, dan sisanya netral.
 */
function roadmapBadgeVariant(status: string): "default" | "accent" | "outline" {
  if (status === "Selesai") return "default";
  if (status === "Berjalan") return "accent";
  return "outline";
}

const roadmap = [
  {
    phase: "Phase 1",
    title: "Core SaaS Infrastructure",
    body: "Multi-tenant database, billing & entitlement engine, auth RBAC, dan offline-first POS engine.",
    status: "Berjalan",
  },
  {
    phase: "Phase 2",
    title: "Vertical Plug-in Modules",
    body: "Modul F&B, Grosir, dan UMKM sebagai plugin yang aktif mengikuti paket langganan — bisa dinyalakan dan dimatikan sendiri dari halaman Modul.",
    status: "Berjalan",
  },
  {
    phase: "Phase 3",
    title: "Advanced Supply Chain",
    body: "Inventory multi-gudang & perpindahan stok, stock opname berjejak audit, dan purchasing end-to-end: PR → PO → GRN, hutang usaha berjatuh tempo, pencocokan 3 arah, dan bayar sekaligus.",
    status: "Berjalan",
  },
  {
    phase: "Phase 4",
    title: "Enterprise Intelligence",
    body: "Advanced BI analytics, peran kustom, dan API & webhook sudah jalan: tren omzet, margin kotor, produk & kategori teratas, jam tersibuk, dan temuan otomatis di halaman Laporan — plus peran bernama dengan izin yang bisa dirancang sendiri di halaman Tim & Peran, serta kunci API bercakupan (termasuk endpoint tulis untuk pesanan dari sistem luar) dan webhook bertanda tangan HMAC di halaman API & Webhook.",
    status: "Berjalan",
  },
  {
    phase: "Phase 5",
    title: "Dedicated Support & Franchise Scale",
    body: "Dukungan khusus dan skala franchise sudah jalan: tiket dukungan dengan janji tanggap yang terukur per paket dan prioritas di halaman Dukungan — lengkap dengan jalur cepat dan eskalasi ke manajer akun — serta laporan lintas cabang beranggaran per cabang, satu laporan untuk seluruh jaringan yang bebannya tidak tumbuh mengikuti jumlah cabang.",
    status: "Selesai",
  },
  {
    phase: "Phase 6",
    title: "Realtime Sync & Digital Payment",
    body: "Sinkronisasi real-time multi-perangkat dan pembayaran digital sudah jalan: hub perangkat dengan kehadiran yang dihitung dari detak terakhir dan penyelesaian konflik last-write-wins di halaman Sinkronisasi, serta kanal tagih QRIS/VA berumur terukur — QRIS 5 menit dan Virtual Account sehari, dengan pelunasan yang harus pas — di halaman Pembayaran.",
    status: "Selesai",
  },
];

export function LandingPage() {
  return (
    /*
      `overflow-x-clip`, bukan `overflow-x-hidden`: keduanya sama-sama memotong
      luapan horizontal, tetapi `hidden` menjadikan div ini **wadah gulir**
      sendiri — dan leluhur yang jadi wadah gulir membuat `sticky` di dalamnya
      menempel ke div itu, bukan ke layar. Akibatnya header beranda ikut
      tergulir pergi (harness `verify-render` menjaga hal ini).
    */
    <div className="min-h-screen overflow-x-clip bg-background">
      <SiteHeader />
      <main>
        <Hero />
        <TrustStrip />
        <FeatureSection />
        <ModulesSection />
        <PricingSection />
        <RoadmapSection />
        <CtaSection />
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  // Beranda tidak punya sidebar, jadi tombolnya hanya meminta layar penuh
  // peramban (`hasSidebar={false}` di bawah).
  const { active: layarPenuh, toggle: toggleLayarPenuh } = useFullscreen();
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 glass">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-primary/15 text-primary">
            <Store className="size-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">
            Mesin<span className="text-primary">POS</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <a className="transition-colors hover:text-foreground" href="#fitur">
            Fitur
          </a>
          <a className="transition-colors hover:text-foreground" href="#modul">
            Modul
          </a>
          <a className="transition-colors hover:text-foreground" href="#harga">
            Harga
          </a>
          <a className="transition-colors hover:text-foreground" href="#roadmap">
            Roadmap
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <FullscreenToggle
            active={layarPenuh}
            onToggle={toggleLayarPenuh}
            hasSidebar={false}
          />
          <ThemeToggle />
          {/*
            Tombol pemasangan duduk tepat di sebelah tombol masuk: ia muncul
            sendiri setelah ajakan 10 detik ditutup tanpa memasang, dan hilang
            begitu aplikasinya sudah terpasang.
          */}
          <InstallButton />
          {/*
            Masuk dan daftar memakai jalur yang sama (kode OTP ke email), jadi
            keduanya menuju `/auth` yang sama — yang membedakan hanya tujuan
            setelah masuk: beranda aplikasi atau onboarding tenant baru.
          */}
          <Button asChild variant="ghost" size="sm">
            <Link to="/auth?returnTo=/app">Masuk</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/auth?returnTo=/onboarding">
              Coba Gratis
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative isolate bg-radial-glow">
      <div className="absolute inset-0 -z-10 bg-grid opacity-[0.4]" />
      <div className="container grid gap-14 py-20 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:py-28">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <Badge className="mb-5 gap-1.5">
            <Sparkles className="size-3.5" />
            Multi-tenant SaaS · Offline-first POS
          </Badge>
          <h1 className="text-balance text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            Kasir enterprise untuk{" "}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              setiap cabang
            </span>
            , online maupun offline.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            MesinPOS menggabungkan POS, inventory, dan pembelian dalam satu
            platform SaaS. Kelola UMKM, retail grosir, sampai jaringan franchise
            — lengkap dengan billing langganan otomatis.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link to="/auth?mode=signup&returnTo=/onboarding">
                Mulai gratis 14 hari
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#modul">Lihat modul</a>
            </Button>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Check className="size-4 text-primary" /> Tanpa kartu kredit
            </span>
            <span className="inline-flex items-center gap-2">
              <Check className="size-4 text-primary" /> Setup 5 menit
            </span>
            <span className="inline-flex items-center gap-2">
              <Check className="size-4 text-primary" /> QRIS & ESC/POS siap
            </span>
          </div>
        </motion.div>

        <PosMockup />
      </div>
    </section>
  );
}

function PosMockup() {
  const tiles = [
    { name: "Kopi Susu", price: 22000 },
    { name: "Croissant", price: 18000 },
    { name: "Nasi Goreng", price: 27000 },
    { name: "Es Teh", price: 8000 },
    { name: "Mie Ayam", price: 25000 },
    { name: "Air Mineral", price: 5000 },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, ease: "easeOut", delay: 0.1 }}
      className="relative"
    >
      <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-br from-primary/20 to-accent/10 blur-2xl" />
      <Card className="overflow-hidden border-border/70 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/70 bg-secondary/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShoppingCart className="size-4 text-primary" />
            Kasir · Cabang Sudirman
          </div>
          <Badge variant="outline" className="gap-1.5">
            <span className="size-1.5 rounded-full bg-primary" />
            Online
          </Badge>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-[1.4fr_1fr]">
          <div className="grid grid-cols-2 gap-3">
            {tiles.map((t) => (
              <div
                key={t.name}
                className="rounded-lg border border-border/70 bg-background/60 p-3 transition-colors hover:border-primary/50"
              >
                <div className="text-sm font-medium">{t.name}</div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  {formatIDR(t.price)}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border/70 bg-secondary/30 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pesanan #A-1042
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              <li className="flex justify-between">
                <span>Kopi Susu ×2</span>
                <span className="font-mono">{formatIDR(44000)}</span>
              </li>
              <li className="flex justify-between">
                <span>Croissant ×1</span>
                <span className="font-mono">{formatIDR(18000)}</span>
              </li>
            </ul>
            <div className="my-3 border-t border-dashed border-border" />
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="font-mono text-xl font-bold text-primary">
                {formatIDR(62000)}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-md bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground">
                Bayar
              </div>
              <div className="rounded-md border border-border px-3 py-2 text-center text-sm font-medium">
                Hold
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 divide-x divide-border/70 border-t border-border/70">
          <Kpi label="Omzet hari ini" value={formatIDR(3175000)} />
          <Kpi label="Transaksi" value="184" />
          <Kpi label="Stok kritis" value="7 item" tone="accent" />
        </div>
      </Card>
    </motion.div>
  );
}

function Kpi({
  label,
  value,
  tone = "primary",
}: {
  label: string;
  value: string;
  tone?: "primary" | "accent";
}) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={
          "mt-0.5 font-mono text-base font-semibold " +
          (tone === "accent" ? "text-accent" : "text-foreground")
        }
      >
        {value}
      </div>
    </div>
  );
}

function TrustStrip() {
  const items = [
    "Kedai Kopi Nusantara",
    "Grosir Berkah Jaya",
    "Franchise Ayam Bakar 88",
    "Toko Bangunan Sinar",
    "Minimarket Sembako Prima",
  ];
  return (
    <section className="border-y border-border/60 bg-secondary/20 py-8">
      <div className="container">
        <p className="text-center text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Dipercaya oleh merchant retail, F&B, dan grosir
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {items.map((name) => (
            <span
              key={name}
              className="text-sm font-semibold text-muted-foreground/70"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureSection() {
  return (
    <section id="fitur" className="container py-20 lg:py-28">
      <SectionHeading
        eyebrow="Fondasi platform"
        title="Dibangun untuk operasional yang tidak boleh berhenti"
        description="Setiap komponen inti dirancang untuk skala enterprise: multi-tenant, resilience offline, dan kontrol akses super granular."
      />
      <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <Card
            key={f.title}
            className="group transition-colors hover:border-primary/40"
          >
            <CardHeader>
              <span className="mb-2 grid size-11 place-items-center rounded-lg bg-primary/12 text-primary transition-transform group-hover:-translate-y-0.5">
                <f.icon className="size-5" />
              </span>
              <CardTitle>{f.title}</CardTitle>
              <CardDescription className="pt-1 leading-relaxed">
                {f.body}
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </section>
  );
}

function ModulesSection() {
  return (
    <section id="modul" className="border-y border-border/60 bg-secondary/20 py-20 lg:py-28">
      <div className="container">
        <SectionHeading
          eyebrow="Vertical plug-and-play"
          title="Aktifkan modul sesuai jenis bisnis Anda"
          description="Modul menyala otomatis mengikuti paket langganan tenant — tanpa instalasi ulang, tanpa migrasi manual."
        />
        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {modules.map((m) => (
            <Card key={m.name} className="flex flex-col">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <span className="grid size-11 place-items-center rounded-lg bg-accent/12 text-accent">
                    <m.icon className="size-5" />
                  </span>
                  <Badge variant="outline">{m.tag}</Badge>
                </div>
                <CardTitle className="pt-3">{m.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-3 text-sm text-muted-foreground">
                  {m.points.map((p) => (
                    <li key={p} className="flex gap-2.5">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section id="harga" className="container py-20 lg:py-28">
      <SectionHeading
        eyebrow="Paket langganan"
        title="Bayar sesuai skala bisnis Anda"
        description="Semua paket termasuk pembaruan berkala, hosting terkelola, dan dukungan onboarding. Harga belum termasuk PPN."
      />
      <div className="mt-14 grid items-start gap-6 lg:grid-cols-3">
        {PLAN_LIST.map((plan) => (
          <Card
            key={plan.key}
            className={
              "relative flex flex-col " +
              (plan.highlight
                ? "border-primary/60 shadow-lg ring-1 ring-primary/30"
                : "")
            }
          >
            {plan.highlight && (
              <Badge className="absolute -top-3 left-6">Paling populer</Badge>
            )}
            <CardHeader>
              <CardTitle className="text-xl">{plan.name}</CardTitle>
              <CardDescription>{plan.subtitle}</CardDescription>
              <div className="pt-4">
                {plan.price === null ? (
                  <span className="text-3xl font-bold">Custom</span>
                ) : (
                  <span className="flex items-baseline gap-1">
                    <span className="font-mono text-3xl font-bold">
                      {formatIDR(plan.price.monthly)}
                    </span>
                    <span className="text-sm text-muted-foreground">/bulan</span>
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <ul className="flex-1 space-y-3 text-sm">
                {plan.features.map((featureKey) => (
                  <li key={featureKey} className="flex gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span className="text-muted-foreground">
                      {FEATURE_LABELS[featureKey]}
                    </span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                className="mt-6 w-full"
                variant={plan.highlight ? "default" : "outline"}
              >
                <Link to="/auth?mode=signup&returnTo=/onboarding">
                  {plan.price === null ? "Hubungi sales" : "Pilih paket"}
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function RoadmapSection() {
  return (
    <section id="roadmap" className="border-y border-border/60 bg-secondary/20 py-20 lg:py-28">
      <div className="container">
        <SectionHeading
          eyebrow="Roadmap produk"
          title="Enam fase menuju ekosistem enterprise penuh"
          description="Kami membangun fondasi SaaS lebih dulu, lalu memperluas ke supply chain, intelligence, skala jaringan, dan pembayaran sungguhan."
        />
        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {roadmap.map((r) => (
            <Card key={r.phase} className="flex flex-col">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold uppercase tracking-wide text-primary">
                    {r.phase}
                  </span>
                  <Badge variant={roadmapBadgeVariant(r.status)}>
                    {r.status}
                  </Badge>
                </div>
                <CardTitle className="pt-3 text-base">{r.title}</CardTitle>
                <CardDescription className="pt-1 leading-relaxed">
                  {r.body}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  return (
    <section className="container py-20 lg:py-28">
      <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-background to-accent/10 p-10 text-center lg:p-16">
        <div className="absolute inset-0 -z-10 bg-grid opacity-30" />
        <h2 className="mx-auto max-w-2xl text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Siap memindahkan operasional toko ke cloud?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Daftar sekarang, pilih paket, dan mulai berjualan dalam hitungan
          menit. Upgrade kapan pun tanpa kehilangan data.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/auth?mode=signup&returnTo=/onboarding">
              Buat akun gratis
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/auth?returnTo=/app">Masuk ke dashboard</Link>
          </Button>
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5" /> Enkripsi data tenant
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3.5" /> Sinkronisasi real-time
          </span>
          <span className="inline-flex items-center gap-1.5">
            <FileCheck2 className="size-3.5" /> Audit log lengkap
          </span>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  const columns = [
    {
      title: "Produk",
      links: ["Fitur", "Modul", "Harga", "Roadmap"],
    },
    {
      title: "Solusi",
      links: ["UMKM", "Retail Grosir", "F&B", "Franchise"],
    },
    {
      title: "Perusahaan",
      links: ["Tentang", "Kontak", "Karier", "Blog"],
    },
  ];
  return (
    <footer className="border-t border-border/60 bg-secondary/20">
      <div className="container py-14">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-lg bg-primary/15 text-primary">
                <Store className="size-5" />
              </span>
              <span className="text-lg font-bold tracking-tight">
                Mesin<span className="text-primary">POS</span>
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm text-muted-foreground">
              Platform POS & Inventory SaaS multi-tenant untuk UMKM, retail,
              grosir, dan jaringan franchise di Indonesia.
            </p>
            <div className="mt-5 flex gap-3 text-muted-foreground">
              <Boxes className="size-5" />
              <Users className="size-5" />
              <CreditCard className="size-5" />
              <Warehouse className="size-5" />
            </div>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <div className="text-sm font-semibold">{col.title}</div>
              <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                {col.links.map((link) => (
                  <li key={link}>
                    <a className="transition-colors hover:text-foreground" href="#">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} MesinPOS. Seluruh hak cipta dilindungi.</span>
          <span className="inline-flex items-center gap-2">
            <Building2 className="size-3.5" /> Dibuat untuk merchant Indonesia
          </span>
        </div>
      </div>
    </footer>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="text-xs font-semibold uppercase tracking-widest text-primary">
        {eyebrow}
      </div>
      <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-muted-foreground">{description}</p>
    </div>
  );
}

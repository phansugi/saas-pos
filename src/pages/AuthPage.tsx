import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  Info,
  KeyRound,
  ShieldCheck,
  Store,
  WifiOff,
} from "lucide-react";
import { FullscreenToggle } from "@/components/FullscreenToggle";
import { OtpForm } from "@/components/OtpForm";
import { OTP_CODE_LENGTH, OTP_TTL_MS } from "@/lib/otp";
import { useFullscreen } from "@/lib/useFullscreen";
import { useSession } from "@/lib/session";
import { dataSource } from "@/lib/store/config";

const TTL_MINUTES = Math.round(OTP_TTL_MS / 60000);
const DEMO = dataSource !== "convex";

export function AuthPage() {
  const { session, ready, signInWithOtp } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Halaman masuk tidak punya sidebar; tombolnya hanya meminta layar penuh
  // peramban, dan tetap tersedia sebelum pengguna masuk.
  const { active: layarPenuh, toggle: toggleLayarPenuh } = useFullscreen();

  const returnTo = params.get("returnTo") || "/app";

  // Sudah masuk: ikuti tujuan yang diminta, jangan berputar balik ke beranda.
  if (ready && session) {
    return <Navigate to={returnTo} replace />;
  }

  return (
    <div className="relative grid min-h-screen lg:grid-cols-2">
      {/*
        Tombol layar penuh duduk di pojok kanan atas: halaman masuk bisa dibuka
        sebelum ada sesi, jadi ia tidak bisa menumpang header backstage.
      */}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <FullscreenToggle
          active={layarPenuh}
          onToggle={toggleLayarPenuh}
          hasSidebar={false}
        />
      </div>
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-border/60 bg-secondary/20 p-12 lg:flex">
        <div className="absolute inset-0 -z-10 bg-radial-glow" />
        <div className="absolute inset-0 -z-10 bg-grid opacity-30" />

        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-primary/15 text-primary">
            <Store className="size-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">
            Mesin<span className="text-primary">POS</span>
          </span>
        </Link>

        <div>
          <h2 className="max-w-md text-3xl font-bold leading-tight tracking-tight">
            Satu platform untuk kasir, stok, dan langganan bisnis Anda.
          </h2>
          <ul className="mt-8 space-y-4 text-sm">
            {[
              {
                icon: KeyRound,
                text: "Masuk tanpa kata sandi — cukup kode yang dikirim ke email Anda",
              },
              { icon: WifiOff, text: "Kasir tetap jalan saat internet mati" },
              { icon: ShieldCheck, text: "RBAC granular per role & cabang" },
              { icon: BarChart3, text: "Laporan omzet & stok real-time" },
            ].map((item) => (
              <li key={item.text} className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-primary/12 text-primary">
                  <item.icon className="size-4" />
                </span>
                <span className="text-muted-foreground">{item.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="max-w-sm text-xs text-muted-foreground">
          Dengan melanjutkan, Anda menyetujui Syarat Layanan dan Kebijakan
          Privasi MesinPOS.
        </p>
      </div>

      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Link
            to="/"
            className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground lg:hidden"
          >
            <ArrowLeft className="size-4" /> Kembali
          </Link>

          <h1 className="text-2xl font-bold tracking-tight">
            Masuk atau daftar
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Satu jalur untuk keduanya: tulis email Anda, lalu masukkan kode yang
            kami kirim ke email itu. Tidak ada kata sandi yang perlu dibuat atau
            diingat — akunnya langsung dibuat saat kode pertama Anda benar.
          </p>

          <div className="mt-6">
            {/*
              Kode sudah terbukti benar di titik ini (server atau, di mode demo,
              aturan yang sama di klien) — jadi yang tersisa hanya mencatat
              sesinya lalu menuju tujuan yang diminta.
            */}
            <OtpForm
              onSignedIn={({ email, name }) => {
                signInWithOtp({ email, name });
                navigate(returnTo, { replace: true });
              }}
            />
          </div>

          <div className="mt-6 flex gap-3 rounded-lg border border-accent/30 bg-accent/10 p-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-accent" />
            <p className="text-muted-foreground">
              {DEMO
                ? `Server belum tersambung, jadi kode ${OTP_CODE_LENGTH} digit tidak benar-benar dikirim lewat email: kodenya tampil di kotak surat pengembangan di layar ini. Aturan kodenya (berlaku ${TTL_MINUTES} menit, sekali pakai, berbatas percobaan) sama dengan yang berlaku di server.`
                : `Kode berlaku ${TTL_MINUTES} menit dan hanya bisa dipakai sekali. Kalau emailnya tidak masuk, periksa folder spam lalu minta kode baru.`}
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}

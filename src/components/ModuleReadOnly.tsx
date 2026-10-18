import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { FEATURE_LABELS, type FeatureKey } from "@/lib/billing";
import { useSession } from "@/lib/session";
import { useStore } from "@/lib/store";
import { featureUnavailableReason } from "@/lib/store/modules";
import { cn } from "@/lib/utils";
import { useCan } from "@/lib/usePermission";

/**
 * Halaman (atau bagian halaman) milik **modul yang tidak ada di langganan**
 * ditampilkan apa adanya, tetapi **hanya bisa dibaca**: isinya abu-abu muda, dan
 * tidak ada satu kontrol pun di dalamnya yang bisa diisi, diubah, atau
 * diperbarui.
 *
 * Kenapa begitu, bukan sekadar tombol “mati”: gerbang fitur server menolak
 * *menambah* apa pun tanpa modulnya, jadi halaman yang tetap menawarkan form dan
 * tombol simpan hanya mengantar pengguna ke penolakan — persis keluhan yang
 * berulang (mis. “Fitur Custom role (RBAC) tidak termasuk paket Starter”).
 * Read-only membuat keadaannya terbaca sebelum satu ketukan pun terjadi.
 *
 * Mekanismenya sengaja bukan daftar `disabled` per tombol: satu per satu kontrol
 * mudah tertinggal saat halaman bertambah isinya, dan yang tertinggal itulah yang
 * jadi tombol mati tanpa sebab. `inert` mematikan **seluruh** sub-pohonnya di mata
 * peramban — klik, fokus keyboard, dan penyuntingan — sehingga apa pun yang
 * ditambahkan nanti di dalam wadah ini ikut terkunci tanpa perlu diurus lagi.
 * Lapisan CSS-nya (`pointer-events-none`, abu-abu, `select-none`) hanya membuat
 * keadaannya terlihat; `aria-disabled` menyampaikannya ke pembaca layar.
 *
 * Batas yang disengaja: **hanya** permukaan milik modul itu yang dikunci. Bagian
 * halaman yang dibayar paket semua orang — mis. mengelola anggota tim di halaman
 * Tim & Peran, atau stok dasar di Gudang & Stok — bukan milik modul, jadi ia tetap
 * hidup. Yang dikunci bukan “hak paket murah”, melainkan fitur yang memang tidak
 * dibeli.
 */
export function ModuleReadOnly({
  locked,
  reason,
  children,
  /** Nama modulnya untuk kalimat penutup; opsional supaya pemanggil ringkas. */
  label,
}: {
  locked: boolean;
  reason: string | null;
  children: ReactNode;
  label?: string;
}) {
  const can = useCan();
  if (!locked) return <>{children}</>;

  return (
    <div data-testid="modul-baca-saja" data-readonly="true" className="space-y-4">
      <div
        data-testid="modul-baca-saja-alasan"
        className="flex items-start gap-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent"
      >
        <Lock className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <strong className="text-foreground">
            Halaman ini hanya bisa dibaca
          </strong>
          {label ? (
            <>
              {" "}
              — fitur <strong className="text-foreground">{label}</strong> tidak
              termasuk langganan workspace ini.
            </>
          ) : (
            "."
          )}{" "}
          {reason} Isinya tetap terlihat, tetapi tidak bisa diisi, diubah, atau
          diperbarui sampai langganannya memuat modul itu.
          {can("billing.manage") && (
            <>
              {" "}
              <Link to="/app/subscription" className="underline">
                Kelola langganan
              </Link>{" "}
              atau{" "}
              <Link to="/app/modules" className="underline">
                modul
              </Link>
              .
            </>
          )}
        </div>
      </div>
      <div
        data-testid="modul-baca-saja-isi"
        inert
        aria-disabled="true"
        className={cn(
          // Abu-abu muda: warna teks diganti di akar, ditambah pudar & hilang
          // warnanya supaya pil, lencana, dan grafik tidak lagi berwarna.
          "text-muted-foreground opacity-60 grayscale",
          // Sabuk kedua kalau peramban lama tidak mengenal `inert`.
          "pointer-events-none select-none",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Pembungkus **rute** untuk halaman yang seluruh isinya milik satu fitur/modul.
 * Dipasang sekali di `App.tsx`, jadi tidak ada halaman modul yang bisa lupa
 * dikunci saat rutenya ditambah — dan keadaannya dihitung dari sumber yang sama
 * dengan gerbang server (`featureUnavailableReason` → paket + modul aktif).
 */
export function ModuleRoute({
  feature,
  children,
}: {
  feature: FeatureKey;
  children: ReactNode;
}) {
  const { session } = useSession();
  const { modules } = useStore();
  const planKey = session?.tenant?.planKey ?? "starter";
  const reason = featureUnavailableReason(
    planKey,
    modules.activeVerticals,
    feature,
  );
  return (
    <ModuleReadOnly
      locked={reason !== null}
      reason={reason}
      label={FEATURE_LABELS[feature]}
    >
      {children}
    </ModuleReadOnly>
  );
}

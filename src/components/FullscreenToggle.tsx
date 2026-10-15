import { Maximize, Minimize } from "lucide-react";
import { fullscreenHint, fullscreenLabel } from "@/lib/fullscreen";
import { cn } from "@/lib/utils";

/**
 * Tombol layar penuh. Bersifat **terkendali** (`active` + `onToggle`) supaya
 * state-nya satu dengan shell yang memakainya: di backstage, nilai yang sama
 * itulah yang menyembunyikan sidebar (`sidebarHidden`), jadi tombolnya tidak
 * pernah bertentangan dengan tampilan.
 *
 * Dipakai di tiga tempat: header backstage (`AppLayout`, dengan sidebar),
 * header beranda (`LandingPage`), dan halaman masuk (`AuthPage`) — di dua yang
 * terakhir tidak ada sidebar, jadi tombolnya hanya meminta layar penuh peramban.
 * Karena itu `hasSidebar` ikut menentukan kalimat penjelasnya.
 */
export function FullscreenToggle({
  active,
  onToggle,
  hasSidebar = true,
  className,
}: {
  active: boolean;
  onToggle: () => void;
  /** `false` di halaman publik: tidak ada sidebar yang disembunyikan. */
  hasSidebar?: boolean;
  className?: string;
}) {
  const label = fullscreenLabel(active);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={active}
      title={fullscreenHint(active, { hasSidebar })}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        className,
      )}
    >
      {active ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
    </button>
  );
}

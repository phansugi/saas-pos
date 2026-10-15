import { useCallback, useState } from "react";
import { Moon, Sun } from "lucide-react";
import {
  applyTheme,
  DARK_CLASS,
  nextTheme,
  toggleLabel,
  writeStoredTheme,
  type Theme,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Tema aktif dibaca dari `<html>` — bukan dari state baru — karena bootstrap di
 * `index.html` sudah menyetelnya sebelum React berjalan. Membacanya dari DOM
 * berarti tombol ini tidak pernah bertentangan dengan tampilan yang dilihat
 * pengguna.
 */
function activeTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains(DARK_CLASS) ? "dark" : "light";
}

/** Tombol ganti tema terang/gelap; pilihannya disimpan per perangkat. */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(activeTheme);

  const toggle = useCallback(() => {
    const next = nextTheme(theme);
    setTheme(next);
    writeStoredTheme(window.localStorage, next);
    applyTheme(next, {
      root: document.documentElement,
      meta: document.querySelector('meta[name="theme-color"]'),
    });
  }, [theme]);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={toggleLabel(theme)}
      title={toggleLabel(theme)}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        className,
      )}
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  INDEX_URL,
  NEW_VERSION_TEXT,
  VERSION_CHECK_INTERVAL_MS,
  VERSION_DISMISS_KEY,
  VERSION_FIRST_CHECK_MS,
  bundleFileFromHtml,
  isOlderBundle,
  readDismissedBundle,
  reloadPage,
  runningBundleFile,
  shouldAnnounceVersion,
  versionDetail,
} from "@/lib/bundleVersion";

/**
 * Ajakan “versi baru tersedia — muat ulang”.
 *
 * Kenapa ada: aplikasi ini SPA & PWA, jadi tab yang sudah dibuka tetap
 * menjalankan bundel lama walau situsnya sudah memuat yang baru — service worker
 * bahkan menyimpan `/assets/*` untuk pemakaian luring. Persis dari keadaan itu
 * error `[CONVEX Q(…)] Akses ditolak` pernah datang: klien lama, server baru.
 *
 * Dua hal yang sengaja **tidak** dilakukan:
 *
 *  - **Memuat ulang otomatis.** Kasir bisa punya keranjang yang belum
 *    diselesaikan; yang tahu waktunya adalah pengguna, bukan halaman.
 *  - **Menganggap gagal sebagai “ada versi baru”.** Luring atau jawaban yang
 *    aneh tidak menyimpulkan apa pun (lihat aturan murninya di
 *    `src/lib/bundleVersion.ts`), karena ajakan palsu lebih merugikan daripada
 *    ajakan yang telat.
 */
export function NewVersionNotice() {
  /*
    Bundel yang sedang berjalan tidak pernah berubah selama halaman ini hidup —
    ia dibaca sekali dari dokumen yang memuat aplikasi. Di mode dev isinya
    `null` (`/src/main.tsx` bukan bundel hasil build), dan itulah yang mematikan
    seluruh pemantauan di bawah: tidak ada versi yang bisa basi saat
    pengembangan.
  */
  const [running] = useState(() =>
    typeof document === "undefined" ? null : runningBundleFile(document),
  );
  const [latest, setLatest] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return readDismissedBundle(window.sessionStorage.getItem(VERSION_DISMISS_KEY));
    } catch {
      // Penyimpanan bisa diblokir (mode privat/kebijakan situs); ajakannya
      // tetap boleh muncul, hanya tidak diingat.
      return null;
    }
  });

  useEffect(() => {
    // Tanpa bundel yang bisa dibaca (mode dev), tidak ada yang perlu dipantau.
    if (running === null) return;

    let cancelled = false;
    const inspect = async () => {
      // Tab yang sedang disembunyikan tidak perlu diberi tahu apa pun; yang
      // penting pemeriksaan saat tabnya kembali terlihat di bawah.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        /*
          `no-store` + penanda waktu: yang dibaca harus salinan situs **saat
          ini**, bukan salinan dari cache HTTP/cache perantara. Halaman ini
          hidup berdampingan dengan cache service worker, jadi permintaannya
          harus tegas.
        */
        const response = await fetch(`${INDEX_URL}?v=${Date.now()}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const found = bundleFileFromHtml(await response.text());
        if (!cancelled && isOlderBundle(running, found)) setLatest(found);
      } catch {
        // Luring atau jaringan gagal: tidak ada kesimpulan yang jujur di sini.
      }
    };

    const first = window.setTimeout(() => void inspect(), VERSION_FIRST_CHECK_MS);
    const every = window.setInterval(() => void inspect(), VERSION_CHECK_INTERVAL_MS);
    /*
      Kembali ke tab adalah saat paling berbahaya: tab yang lama menganggur
      dibuka lagi justru ketika situsnya sudah berganti versi. Karena itu
      pemeriksaan diulang begitu tabnya terlihat lagi atau jaringan tersambung
      kembali — tidak menunggu putaran berikutnya.
    */
    const onResume = () => {
      if (document.visibilityState === "visible") void inspect();
    };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("online", onResume);

    /*
      Pemantauan berjalan terus selama halaman ini hidup — juga setelah
      ajakannya muncul atau ditutup; itulah sebabnya efek ini hanya bergantung
      pada `running`. “Nanti” karena itu tidak berarti “bisu selamanya”: begitu
      situs menyajikan bundel **yang lebih baru lagi**, namanya berbeda dari yang
      ditolak, dan ajakannya datang kembali.
    */
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearInterval(every);
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("online", onResume);
    };
  }, [running]);

  const dismiss = useCallback(() => {
    if (latest === null) return;
    setDismissed(latest);
    try {
      window.sessionStorage.setItem(VERSION_DISMISS_KEY, latest);
    } catch {
      // Diabaikan: yang penting ajakannya sudah ditutup di tab ini.
    }
  }, [latest]);

  if (!shouldAnnounceVersion({ running, latest, dismissed })) return null;

  return (
    <div
      role="status"
      aria-label={NEW_VERSION_TEXT.label}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-primary/40 bg-primary/10 px-6 py-3 text-sm"
    >
      <RefreshCw className="size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{NEW_VERSION_TEXT.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{NEW_VERSION_TEXT.body}</p>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {versionDetail(running, latest)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => reloadPage(window.location)}>
          {NEW_VERSION_TEXT.confirm}
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          {NEW_VERSION_TEXT.later}
        </Button>
      </div>
    </div>
  );
}

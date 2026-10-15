import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Download, Share2, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  INSTALL_PROMPT_DELAY_MS,
  INSTALL_STORAGE_KEY,
  isInstalled,
  looksLikeIos,
  markDismissed,
  markInvited,
  manualInstallSteps,
  readInstallRecord,
  serializeInstallRecord,
  shouldOfferInvite,
  shouldShowInstallButton,
  startInstallRecord,
  type InstallRecord,
} from "@/lib/pwa";

/**
 * `beforeinstallprompt` belum ada di tipe DOM standar, padahal justru itu yang
 * membuat pemasangan bisa diminta dari tombol kita sendiri.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface InstallOffer {
  /** Browser menawarkan pemasangan bawaan (Chrome/Edge/Android). */
  canInstall: boolean;
  /** Ajakan 10 detik sedang tampil. */
  inviteOpen: boolean;
  /** Tombol di header harus tampil. */
  buttonVisible: boolean;
  /** Petunjuk pemasangan manual sedang terbuka (mis. Safari iOS). */
  instructionsOpen: boolean;
  accept(): Promise<void>;
  dismiss(): void;
  openInstructions(): void;
  closeInstructions(): void;
}

/**
 * Keadaan diam: dipakai halaman yang dirender tanpa `<InstallProvider>`
 * (harness merender halaman langsung). Halaman seperti itu tetap tampil utuh —
 * yang hilang hanya ajakannya.
 */
const INERT: InstallOffer = {
  canInstall: false,
  inviteOpen: false,
  buttonVisible: false,
  instructionsOpen: false,
  accept: async () => {},
  dismiss: () => {},
  openInstructions: () => {},
  closeInstructions: () => {},
};

const InstallContext = createContext<InstallOffer | null>(null);

function detectInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const media = (query: string) =>
    typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return isInstalled({
    fullscreen: media("(display-mode: fullscreen)"),
    standalone: media("(display-mode: standalone)"),
    iosStandalone,
  });
}

/**
 * Pemilik keadaan pemasangan: satu instance untuk seluruh aplikasi.
 *
 * Kenapa harus satu: `beforeinstallprompt` hanya bisa dipakai **sekali**, dan
 * kalau banner serta tombol header masing-masing menyimak event itu, salah
 * satunya akan memegang janji yang sudah kedaluwarsa. Karena itu keduanya
 * membaca keadaan yang sama dari sini.
 */
export function InstallProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState(detectInstalled);
  const [record, setRecord] = useState<InstallRecord | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const recordRef = useRef<InstallRecord | null>(null);

  const persist = useCallback((next: InstallRecord) => {
    recordRef.current = next;
    setRecord(next);
    try {
      window.localStorage.setItem(INSTALL_STORAGE_KEY, serializeInstallRecord(next));
    } catch {
      // Mode privat/menolak simpanan: ajakan tetap jalan untuk sesi ini.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Kunjungan pertama dicatat di sini — dari catatan itu ajakan tahu apakah
    // ia masih berhak tampil.
    const stored = readInstallRecord(window.localStorage.getItem(INSTALL_STORAGE_KEY));
    const first = stored ?? startInstallRecord(new Date());
    persist(first);

    const onBeforeInstallPrompt = (event: Event) => {
      // Ditahan: yang memutuskan kapan menawarkan adalah aplikasi (10 detik),
      // bukan browser yang menyergap di detik pertama.
      event.preventDefault();
      promptRef.current = event as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInviteOpen(false);
      setInstructionsOpen(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    let timer: number | undefined;
    if (shouldOfferInvite(first, detectInstalled())) {
      timer = window.setTimeout(() => {
        if (detectInstalled()) return;
        setInviteOpen(true);
        persist(markInvited(recordRef.current ?? first, new Date()));
      }, INSTALL_PROMPT_DELAY_MS);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [persist]);

  const settle = useCallback(() => {
    setInviteOpen(false);
    const current = recordRef.current;
    if (current) persist(markDismissed(current, new Date()));
  }, [persist]);

  const accept = useCallback(async () => {
    const prompt = promptRef.current;
    if (!prompt) {
      // Tidak ada janji pemasangan dari browser (Safari iOS, atau sudah pernah
      // ditolak): tampilkan langkah manualnya, jangan diam saja.
      setInviteOpen(false);
      setInstructionsOpen(true);
      return;
    }
    promptRef.current = null;
    setCanInstall(false);
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstalled(true);
      setInviteOpen(false);
      return;
    }
    settle();
  }, [settle]);

  const dismiss = useCallback(() => settle(), [settle]);
  const openInstructions = useCallback(() => setInstructionsOpen(true), []);
  const closeInstructions = useCallback(() => setInstructionsOpen(false), []);

  const value = useMemo<InstallOffer>(
    () => ({
      canInstall,
      inviteOpen,
      buttonVisible: shouldShowInstallButton(record, { installed, inviteOpen }),
      instructionsOpen,
      accept,
      dismiss,
      openInstructions,
      closeInstructions,
    }),
    [
      accept,
      canInstall,
      closeInstructions,
      dismiss,
      instructionsOpen,
      installed,
      inviteOpen,
      openInstructions,
      record,
    ],
  );

  return <InstallContext.Provider value={value}>{children}</InstallContext.Provider>;
}

export function useInstallOffer(): InstallOffer {
  return useContext(InstallContext) ?? INERT;
}

/**
 * Ajakan pemasangan: muncul **sekali**, 10 detik setelah kunjungan pertama.
 * Setelah ditutup, ajakan tidak kembali — yang tersisa hanya tombol di header.
 */
export function InstallPrompt() {
  const offer = useInstallOffer();
  if (!offer.inviteOpen) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] p-4"
      role="region"
      aria-label="Ajakan memasang aplikasi"
    >
      <div className="pointer-events-auto mx-auto flex max-w-md items-start gap-3 rounded-xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <Smartphone className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Pasang MesinPOS di perangkat ini</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Terbuka layar penuh tanpa bilah browser, ikonnya sendiri di layar
            utama, dan kasir tetap jalan saat internet mati.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void offer.accept()}>
              <Download className="size-4" />
              Pasang sekarang
            </Button>
            <Button size="sm" variant="ghost" onClick={offer.dismiss}>
              Nanti saja
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={offer.dismiss}
          aria-label="Tutup ajakan pemasangan"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Tombol pemasangan untuk header — dipasang di sebelah tombol masuk. Ia muncul
 * sendiri setelah ajakan pernah tampil dan aplikasinya belum terpasang.
 */
export function InstallButton({ className }: { className?: string }) {
  const offer = useInstallOffer();
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIos(looksLikeIos(window.navigator.userAgent ?? "", window.navigator.maxTouchPoints ?? 0));
  }, []);

  if (!offer.buttonVisible) return null;

  return (
    <div className={cn("relative", className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          if (offer.canInstall) {
            void offer.accept();
            return;
          }
          offer.openInstructions();
        }}
        aria-label="Pasang aplikasi MesinPOS"
      >
        <Download className="size-4" />
        <span className="hidden sm:inline">Pasang aplikasi</span>
        <span className="sm:hidden">Pasang</span>
      </Button>

      {offer.instructionsOpen && (
        <div
          role="dialog"
          aria-label="Petunjuk memasang aplikasi"
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-border bg-card p-4 text-left shadow-lg"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold">Pasang lewat menu browser</p>
            <button
              type="button"
              onClick={offer.closeInstructions}
              aria-label="Tutup petunjuk pemasangan"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <ol className="mt-2 space-y-1.5 text-xs text-muted-foreground">
            {manualInstallSteps(ios).map((step, index) => (
              <li key={step} className="flex gap-2">
                <span className="font-semibold text-primary">{index + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Share2 className="mt-0.5 size-3.5 shrink-0" />
            Perlu dilakukan sekali; setelah itu ikon MesinPOS ada di layar utama.
          </p>
        </div>
      )}
    </div>
  );
}

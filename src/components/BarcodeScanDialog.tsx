/**
 * Pemindai **barcode / QR** lewat kamera, dipakai halaman Kasir dan halaman
 * Produk & Stok.
 *
 * Empat jalur, berurutan sesuai yang tersedia di perangkat:
 *
 * 1. **Kamera + `BarcodeDetector` bawaan peramban** (Chrome/Edge/Android).
 *    Gambar kamera dibaca tiap ± 350 ms dan kode pertama yang terbaca langsung
 *    dikembalikan ke halaman pemanggil. Frame diminta beresolusi penuh (ideal
 *    1920×1080): barcode yang dicetak kecil — mis. label di halaman detail
 *    marketplace — tidak punya cukup piksel di frame 640×480 bawaan.
 * 2. **Galeri / tangkapan layar.** Kode di layar yang kecil sering mustahil
 *    dibaca kamera, tetapi tangkapan layarnya menyimpan barcode pada resolusi
 *    perangkat. Berkasnya dibaca dengan `BarcodeDetector` yang sama
 *    (`@/lib/barcodeImage`), jadi hasilnya tetap satu teks kode.
 * 3. **Ketik manual.** Selalu tersedia — dipakai saat peramban tidak punya
 *    `BarcodeDetector` (mis. Safari/Firefox saat ini), saat izin kamera ditolak,
 *    atau saat pemilik memakai pemindai USB yang mengetik kode seperti keyboard.
 * 4. **Kamera tanpa pembaca kode**: gambarnya tetap ditampilkan supaya kode di
 *    barang bisa dibaca mata, lalu diketik di kolom manual.
 *
 * Komponen ini **tidak** tahu arti kodenya. Pencocokan ke SKU atau ke kolom
 * barcode/QR produk ada di `@/lib/barcode`, dipakai halaman & harness dengan
 * aturan yang sama.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, CameraOff, ImageUp, Keyboard, Loader2, QrCode, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeScannedCode } from "@/lib/barcode";
import { readBarcodeFromImage } from "@/lib/barcodeImage";

/**
 * Bentuk minimum `BarcodeDetector` yang dipakai di sini. TypeScript DOM belum
 * membawa tipe ini (masih eksperimental), jadi kontraknya ditulis sendiri —
 * bukan `any`, supaya kesalahan bentuk balasan tetap tertangkap.
 */
interface DetectedBarcodeLike {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcodeLike[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

/**
 * Format yang ditawarkan. `getSupportedFormats` disaring dulu: deployment
 * Chrome yang tidak mendukung satu format akan menolak konstruktornya, dan
 * pemindai yang mati karena itu lebih buruk daripada pemindai yang membaca
 * sebagian format.
 */
const SCAN_FORMATS = [
  "qr_code",
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "code_93",
  "itf",
  "codabar",
  "data_matrix",
  "pdf417",
  "aztec",
];

function barcodeDetectorConstructor(): BarcodeDetectorConstructor | null {
  if (typeof globalThis === "undefined") return null;
  const candidate = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  return typeof candidate === "function"
    ? (candidate as BarcodeDetectorConstructor)
    : null;
}

type CameraState = "starting" | "live" | "unsupported" | "denied" | "error";

export interface BarcodeScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kode hasil scan/ketik, sudah dirapikan (bukan divalidasi ke katalog). */
  onScan: (code: string) => void;
  /** Nama halaman asal, hanya untuk kalimat pembantu. */
  context?: string;
}

export function BarcodeScanDialog({
  open,
  onOpenChange,
  onScan,
  context,
}: BarcodeScanDialogProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectingRef = useRef(false);
  /** Kode yang sudah diserahkan; mencegah satu barcode dikirim berkali-kali. */
  const doneRef = useRef(false);
  const onScanRef = useRef(onScan);
  const onOpenChangeRef = useRef(onOpenChange);

  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  /** Berkas tangkapan layar/foto yang sedang dibaca (galeri). */
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [galleryNote, setGalleryNote] = useState<string | null>(null);

  useEffect(() => {
    onScanRef.current = onScan;
    onOpenChangeRef.current = onOpenChange;
  }, [onScan, onOpenChange]);

  /** Menyerahkan satu kode ke halaman, lalu menutup dialog. */
  function serahkan(raw: string) {
    const code = normalizeScannedCode(raw);
    if (code.length === 0 || doneRef.current) return;
    doneRef.current = true;
    onScanRef.current(code);
    onOpenChangeRef.current(false);
  }

  useEffect(() => {
    if (!open) return;
    doneRef.current = false;
    setManual("");
    setCameraState("starting");
    setCameraMessage(null);
    setGalleryNote(null);
    setGalleryBusy(false);

    let cancelled = false;

    const stop = () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    async function mulai() {
      const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
      if (!media?.getUserMedia) {
        if (cancelled) return;
        setCameraState("unsupported");
        setCameraMessage(
          "Peramban ini tidak memberi akses kamera ke halaman. Ketik kode dari barcode/QR-nya di bawah.",
        );
        return;
      }

      let stream: MediaStream;
      try {
        stream = await media.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            /*
              `ideal` (bukan `exact`): perangkat yang tidak sanggup memberi
              frame sebesar ini tetap memberi frame terbaiknya, bukan gagal.
              Tanpa permintaan ini peramban sering memilih 640×480, dan barcode
              selebar ±15 cm di layar jadi kurang dari satu piksel per modul —
              mustahil dibaca. Dengan 1920×1080, kamera yang diarahkan dekat ke
              layar punya cukup piksel untuk kode kecil.
            */
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
      } catch (cause) {
        if (cancelled) return;
        const name = cause instanceof Error ? cause.name : "";
        setCameraState(name === "NotAllowedError" ? "denied" : "error");
        setCameraMessage(
          name === "NotAllowedError"
            ? "Izin kamera ditolak. Izinkan kamera untuk situs ini di pengaturan peramban, lalu buka pemindai lagi — atau ketik kodenya di bawah."
            : "Kamera tidak bisa dibuka di perangkat ini. Ketik kode dari barcode/QR-nya di bawah.",
        );
        return;
      }

      // Peramban tiruan (harness) bisa mengembalikan objek yang bukan MediaStream.
      // Tanpa pemeriksaan ini, `getTracks()` yang tidak ada akan melempar dan
      // dialog tampak rusak — padahal kolom manualnya tetap bisa dipakai.
      if (!stream || typeof stream.getTracks !== "function") {
        if (cancelled) return;
        setCameraState("error");
        setCameraMessage(
          "Kamera tidak tersedia di perangkat ini. Ketik kode dari barcode/QR-nya di bawah.",
        );
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        // `play()` bisa ditolak sebelum video punya cukup data; deteksi tetap
        // dicoba dan akan berhenti sendiri selama frame-nya belum siap.
        if (typeof video.play === "function") {
          await video.play().catch(() => undefined);
        }
      }

      const Detector = barcodeDetectorConstructor();
      if (!Detector) {
        if (cancelled) return;
        setCameraState("live");
        setCameraMessage(
          "Peramban ini belum bisa membaca kode otomatis. Kamera tetap ditampilkan — ketik kodenya di bawah.",
        );
        return;
      }

      let formats: string[] = SCAN_FORMATS;
      if (Detector.getSupportedFormats) {
        try {
          const didukung = new Set(await Detector.getSupportedFormats());
          const cocok = SCAN_FORMATS.filter((format) => didukung.has(format));
          if (cocok.length > 0) formats = cocok;
        } catch {
          // Daftar format gagal dibaca: biarkan konstruktor memakai bawaannya.
          formats = SCAN_FORMATS;
        }
      }

      let detector: BarcodeDetectorLike;
      try {
        detector = new Detector({ formats });
      } catch {
        try {
          detector = new Detector();
        } catch {
          if (cancelled) return;
          setCameraState("live");
          setCameraMessage(
            "Pembaca kode di peramban ini tidak bisa dinyalakan. Ketik kodenya di bawah.",
          );
          return;
        }
      }

      if (cancelled) return;
      setCameraState("live");

      intervalRef.current = setInterval(async () => {
        const target = videoRef.current;
        if (!target || target.readyState < 2 || detectingRef.current || doneRef.current) {
          return;
        }
        detectingRef.current = true;
        try {
          const results = await detector.detect(target);
          const terbaca = results.find((row) => row.rawValue.trim().length > 0);
          if (terbaca) serahkan(terbaca.rawValue);
        } catch {
          // Satu frame gagal (video gelap, belum fokus) bukan alasan mematikan
          // kamera; percobaan berikutnya menyusul 350 ms lagi.
        } finally {
          detectingRef.current = false;
        }
      }, 350);
    }

    void mulai();

    return () => {
      cancelled = true;
      stop();
    };
    // `serahkan` memakai ref callback terbaru, jadi tidak perlu jadi dependensi.
  }, [open]);

  // Escape menutup dialog — sama seperti lembar transaksi lain di aplikasi.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChangeRef.current(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    serahkan(manual);
  }

  /**
   * Membaca kode dari tangkapan layar/foto. Ini jalur yang dipakai saat barcode
   * hanya ada di layar dan dicetak sangat kecil (mis. halaman detail marketplace):
   * gambarnya dibaca pada resolusi aslinya, bukan lewat kamera yang memotret layar.
   */
  async function pilihFoto(file: File | undefined) {
    if (!file) return;
    setGalleryBusy(true);
    setGalleryNote("Membaca kode dari gambar…");
    try {
      const hasil = await readBarcodeFromImage(file);
      if (!hasil.ok) {
        setGalleryNote(hasil.reason);
        return;
      }
      setGalleryNote(`Kode ${normalizeScannedCode(hasil.code)} terbaca dari gambar.`);
      serahkan(hasil.code);
    } finally {
      setGalleryBusy(false);
    }
  }

  const live = cameraState === "live";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-background/80 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="barcode-scan-title"
        data-testid="barcode-scan-dialog"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border/70 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <QrCode className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 id="barcode-scan-title" className="text-sm font-semibold">
                Pindai barcode / QR
              </h3>
              <p className="text-xs text-muted-foreground">
                {context
                  ? `Kode dicocokkan ke SKU atau barcode/QR produk di ${context}.`
                  : "Kode dicocokkan ke SKU atau barcode/QR produk di MesinPOS."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Tutup pemindai"
            data-testid="barcode-scan-close"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-black">
            <video
              ref={videoRef}
              muted
              playsInline
              aria-label="Gambar kamera pemindai"
              className={live ? "size-full object-cover" : "hidden"}
            />
            {live && (
              <>
                {/* Bingkai bidik: empat sudut, bukan kotak penuh, supaya kode di
                    dalamnya tetap terlihat. */}
                <span aria-hidden className="pointer-events-none absolute inset-8 rounded-lg border border-white/20">
                  <span className="absolute -left-px -top-px size-6 rounded-tl-lg border-l-2 border-t-2 border-white" />
                  <span className="absolute -right-px -top-px size-6 rounded-tr-lg border-r-2 border-t-2 border-white" />
                  <span className="absolute -bottom-px -left-px size-6 rounded-bl-lg border-b-2 border-l-2 border-white" />
                  <span className="absolute -bottom-px -right-px size-6 rounded-br-lg border-b-2 border-r-2 border-white" />
                </span>
                <span className="absolute inset-x-0 bottom-2 text-center text-[11px] font-medium text-white/90">
                  Arahkan kamera ke barcode / QR — dekatkan bila kodenya kecil
                </span>
              </>
            )}
            {!live && (
              <div
                data-testid="barcode-scan-camera-note"
                className="flex size-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-white/80"
              >
                {cameraState === "starting" ? (
                  <>
                    <Camera className="size-6 animate-pulse" />
                    Menyiapkan kamera…
                  </>
                ) : (
                  <>
                    <CameraOff className="size-6" />
                    {cameraMessage ?? "Kamera tidak tersedia."}
                  </>
                )}
              </div>
            )}
          </div>

          {live && cameraMessage && (
            <p data-testid="barcode-scan-status" className="text-xs text-muted-foreground">
              {cameraMessage}
            </p>
          )}

          {/*
            Barcode di layar kadang hanya selebar ±15 cm dan modulnya di bawah
            satu piksel — kamera tidak mungkin membacanya, tetapi tangkapan
            layarnya menyimpan kode pada resolusi perangkat. Jalur ini juga
            dipakai saat pengguna menerima foto label lewat chat.
          */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={galleryBusy}
                data-testid="barcode-scan-galeri"
                aria-label="Pilih gambar barcode atau tangkapan layar"
                onClick={() => galleryRef.current?.click()}
                className="shrink-0"
              >
                {galleryBusy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ImageUp className="size-3.5" />
                )}
                Galeri / tangkapan layar
              </Button>
              <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
                Barcode di layar yang kecil — mis. halaman detail marketplace — sering tidak
                terbaca kamera. Simpan tangkapan layarnya, lalu pilih di sini.
              </p>
            </div>
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              tabIndex={-1}
              className="sr-only"
              aria-label="Berkas gambar barcode atau tangkapan layar"
              data-testid="barcode-scan-galeri-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Reset supaya berkas yang sama bisa dipilih lagi setelah gagal.
                event.target.value = "";
                void pilihFoto(file);
              }}
            />
            {galleryNote && (
              <p
                role="status"
                data-testid="barcode-scan-galeri-note"
                className="text-xs text-muted-foreground"
              >
                {galleryNote}
              </p>
            )}
          </div>

          <form onSubmit={submitManual} className="space-y-2 border-t border-border/70 pt-4">
            <label
              htmlFor="barcode-manual"
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
            >
              <Keyboard className="size-3.5" />
              Atau ketik kode hasil scan
            </label>
            <div className="flex gap-2">
              <Input
                id="barcode-manual"
                data-testid="barcode-manual-input"
                value={manual}
                onChange={(event) => setManual(event.target.value)}
                placeholder="Contoh: PBB-0000042"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="font-mono"
              />
              <Button
                type="submit"
                data-testid="barcode-manual-submit"
                disabled={normalizeScannedCode(manual).length === 0}
                className="shrink-0"
              >
                Cari kode
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Pemindai USB yang mengetik seperti keyboard juga bisa memakai kolom ini. Kode yang
              belum terdaftar bisa didaftarkan sebagai SKU produk baru dari hasil pencariannya.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

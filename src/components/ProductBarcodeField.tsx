/**
 * Kolom **Barcode / QR Code (untuk kasir POS)** di form produk.
 *
 * Satu tempat untuk tiga cara mengisi kode:
 *
 *  1. **Buat otomatis dari SKU** — Code 39 untuk jenis Barcode, QR Code untuk
 *     jenis QR. Kode yang dibuat selalu sama dengan yang digambar di pratinjau.
 *  2. **Galeri / Kamera** — foto label dibaca dengan `BarcodeDetector` bawaan
 *     peramban, lalu kodenya disimpan. Kalau peramban belum punya pembaca itu,
 *     pesannya menjelaskan dan kolom ketik manual tetap tersedia.
 *  3. **Ketik manual** — untuk kode eksternal yang tidak terbaca kamera, atau
 *     untuk peramban tanpa `BarcodeDetector`.
 *
 * Komponen ini **tidak** menyimpan apa pun sendiri: nilainya ikut draf produk
 * dan baru ditulis ke server saat produk disimpan.
 */
import { useRef, useState, type FormEvent } from "react";
import {
  Camera,
  ImageUp,
  Loader2,
  QrCode,
  ScanBarcode,
  Sparkles,
  X,
} from "lucide-react";
import { Barcode39Image } from "@/components/Barcode39Image";
import { QrCodeImage } from "@/components/QrCodeImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readBarcodeFromImage } from "@/lib/barcodeImage";
import {
  barcodeFromSku,
  code39Modules,
  normalizeProductBarcode,
  PRODUCT_BARCODE_TYPE_LABELS,
  PRODUCT_BARCODE_TYPES,
  productBarcodeTypeOr,
  validateProductBarcode,
  type ProductBarcodeType,
} from "@/lib/productBarcode";

export interface ProductBarcodeValue {
  barcode: string;
  barcodeType: ProductBarcodeType;
}

interface Status {
  tone: "info" | "error" | "success";
  text: string;
}

export interface ProductBarcodeFieldProps {
  /** Dipakai di `data-testid` & `aria-label`; mis. `produk-baru`. */
  fieldId: string;
  /** Nama tampilan untuk kalimat bantu, mis. “produk baru”. */
  scope: string;
  /** SKU yang sekarang ada di draf — sumber tombol **Buat otomatis**. */
  sku: string;
  value: ProductBarcodeValue;
  onChange: (patch: Partial<ProductBarcodeValue>) => void;
}

export function ProductBarcodeField({
  fieldId,
  scope,
  sku,
  value,
  onChange,
}: ProductBarcodeFieldProps) {
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  const type = productBarcodeTypeOr(value.barcodeType);
  const code = normalizeProductBarcode(value.barcode);
  const typeLabel = PRODUCT_BARCODE_TYPE_LABELS[type];

  function berhasil(patch: Partial<ProductBarcodeValue>, text: string) {
    onChange(patch);
    setStatus({ tone: "success", text });
  }

  function buatOtomatis() {
    const skuBersih = normalizeProductBarcode(sku);
    if (skuBersih.length === 0) {
      setStatus({
        tone: "error",
        text: "Isi kolom SKU dulu — kode otomatis dibuat dari SKU produk ini.",
      });
      return;
    }

    if (type === "barcode") {
      const dibuat = barcodeFromSku(skuBersih);
      if (!dibuat) {
        setStatus({
          tone: "error",
          text: `SKU “${skuBersih}” mengandung karakter yang tidak didukung Code 39. Pilih QR Code untuk SKU ini, atau ketik kode barcode secara manual.`,
        });
        return;
      }
      berhasil(
        { barcode: dibuat, barcodeType: "barcode" },
        `Barcode ${dibuat} dibuat dari SKU. Simpan produk untuk memakainya di kasir.`,
      );
      return;
    }

    const dibuat = skuBersih;
    const cek = validateProductBarcode({ barcode: dibuat, barcodeType: "qr" });
    if (!cek.ok) {
      setStatus({ tone: "error", text: cek.reason });
      return;
    }
    berhasil(
      { barcode: cek.value, barcodeType: "qr" },
      `QR Code berisi ${cek.value}, dibuat dari SKU. Simpan produk untuk memakainya di kasir.`,
    );
  }

  function ubahJenis(jenis: ProductBarcodeType) {
    if (jenis === type) return;
    if (code.length > 0) {
      const cek = validateProductBarcode({ barcode: code, barcodeType: jenis });
      if (!cek.ok) {
        setStatus({
          tone: "error",
          text: `Kode ${code} tidak bisa dipakai sebagai ${PRODUCT_BARCODE_TYPE_LABELS[jenis]}. ${cek.reason}`,
        });
        return;
      }
    }
    setStatus(null);
    onChange({ barcodeType: jenis });
  }

  function pakaiManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cek = validateProductBarcode({ barcode: manual, barcodeType: type });
    if (!cek.ok) {
      setStatus({ tone: "error", text: cek.reason });
      return;
    }
    if (cek.value.length === 0) {
      setStatus({ tone: "error", text: "Ketik kodenya dulu, lalu tekan Pakai." });
      return;
    }
    setManual("");
    berhasil(
      { barcode: cek.value, barcodeType: cek.type },
      `Kode ${cek.value} dipakai. Simpan produk untuk menerapkannya di kasir.`,
    );
  }

  async function pilihFoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setStatus({ tone: "info", text: "Membaca kode dari foto…" });
    try {
      const hasil = await readBarcodeFromImage(file);
      if (!hasil.ok) {
        setStatus({ tone: "error", text: hasil.reason });
        return;
      }
      // Jenis hasil deteksi dipakai apa adanya: QR tetap QR, barcode 1D jadi
      // Barcode. Nilainya dinormalkan & divalidasi dengan aturan yang sama
      // dengan server sebelum masuk draf.
      const cek = validateProductBarcode({
        barcode: hasil.code,
        barcodeType: hasil.barcodeType,
      });
      if (!cek.ok) {
        setStatus({ tone: "error", text: cek.reason });
        return;
      }
      berhasil(
        { barcode: cek.value, barcodeType: cek.type },
        `Kode ${cek.value} terbaca dari foto (${PRODUCT_BARCODE_TYPE_LABELS[cek.type]}).`,
      );
    } finally {
      setBusy(false);
    }
  }

  const barcodeValid = code.length > 0 && code39Modules(code).length > 0;

  return (
    <div
      className="rounded-lg border border-border bg-background p-3"
      data-testid={`${fieldId}-barcode`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Barcode / QR Code (untuk kasir POS)</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Satu kode tambahan di samping SKU. Hasil scan di kasir mencocokkan SKU lebih dulu, lalu
            kode ini.
          </p>
        </div>
        <select
          className="w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground sm:w-auto"
          value={type}
          aria-label={`Jenis barcode ${scope}`}
          data-testid={`${fieldId}-barcode-jenis`}
          onChange={(event) => ubahJenis(event.target.value as ProductBarcodeType)}
        >
          {PRODUCT_BARCODE_TYPES.map((jenis) => (
            <option key={jenis} value={jenis}>
              {PRODUCT_BARCODE_TYPE_LABELS[jenis]}
            </option>
          ))}
        </select>
      </div>

      <div
        className="mt-3 rounded-md border border-border bg-white p-3"
        data-testid={`${fieldId}-barcode-preview`}
      >
        {code.length === 0 ? (
          <div className="flex min-h-20 flex-col items-center justify-center gap-2 text-center text-xs text-slate-500">
            <span className="grid size-9 place-items-center rounded-md border border-dashed border-slate-300">
              {type === "qr" ? <QrCode className="size-4" /> : <ScanBarcode className="size-4" />}
            </span>
            <span>
              Belum ada barcode — buat otomatis dari SKU atau unggah foto dari galeri/kamera.
            </span>
          </div>
        ) : type === "qr" ? (
          <div className="flex flex-col items-center gap-2">
            <QrCodeImage value={code} className="size-36" label={`QR Code ${code}`} />
            <span className="font-mono text-xs text-black">{code}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            {barcodeValid ? (
              <Barcode39Image
                value={code}
                className="max-h-20"
                label={`Barcode ${code}`}
              />
            ) : (
              <p className="py-4 text-center text-xs text-red-600">
                Kode ini bukan Code 39 yang sah, jadi barcodenya tidak bisa digambar.
              </p>
            )}
            <span className="font-mono text-xs text-black">{code}</span>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid={`${fieldId}-barcode-otomatis`}
          aria-label={`Buat ${typeLabel} otomatis`}
          onClick={buatOtomatis}
        >
          <Sparkles className="size-3.5" />
          Buat {typeLabel} otomatis
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          data-testid={`${fieldId}-barcode-galeri`}
          aria-label={`Pilih foto barcode ${scope} dari galeri`}
          onClick={() => galleryRef.current?.click()}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImageUp className="size-3.5" />}
          Galeri
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          data-testid={`${fieldId}-barcode-kamera`}
          aria-label={`Ambil foto barcode ${scope} dengan kamera`}
          onClick={() => cameraRef.current?.click()}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
          Kamera
        </Button>
        {code.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid={`${fieldId}-barcode-hapus`}
            aria-label={`Hapus barcode ${scope}`}
            onClick={() => {
              onChange({ barcode: "" });
              setStatus({ tone: "info", text: "Kode dilepas. Kasir kembali hanya memakai SKU." });
            }}
          >
            <X className="size-3.5" /> Hapus kode
          </Button>
        )}
      </div>

      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        tabIndex={-1}
        className="sr-only"
        aria-label={`Berkas foto barcode ${scope} dari galeri`}
        data-testid={`${fieldId}-barcode-galeri-input`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset supaya berkas yang sama bisa dipilih lagi setelah gagal.
          event.target.value = "";
          void pilihFoto(file);
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        tabIndex={-1}
        className="sr-only"
        aria-label={`Berkas foto barcode ${scope} dari kamera`}
        data-testid={`${fieldId}-barcode-kamera-input`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          void pilihFoto(file);
        }}
      />

      <form onSubmit={pakaiManual} className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={manual}
          onChange={(event) => setManual(event.target.value)}
          placeholder={type === "barcode" ? "Contoh: 8991234567890" : "Contoh: https://…"}
          aria-label={`Kode barcode ${scope}`}
          data-testid={`${fieldId}-barcode-kode`}
          autoComplete="off"
          spellCheck={false}
          className="min-w-40 flex-1 font-mono"
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          data-testid={`${fieldId}-barcode-pakai`}
          disabled={busy}
        >
          Pakai
        </Button>
      </form>

      {status && (
        <p
          role="status"
          data-testid={`${fieldId}-barcode-status`}
          className={
            status.tone === "error"
              ? "mt-2 text-xs text-destructive"
              : status.tone === "success"
                ? "mt-2 text-xs text-emerald-600 dark:text-emerald-400"
                : "mt-2 text-xs text-muted-foreground"
          }
        >
          {status.text}
        </p>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        Pilih jenis kode di atas. Tombol otomatis membuat Code 39 (standar POS) dari SKU untuk
        Barcode, atau QR Code dari SKU untuk QR; kode eksternal bisa diunggah dari galeri/kamera
        atau diketik. Foto hanya dibaca menjadi teks kode — tidak disimpan sebagai gambar.
      </p>
    </div>
  );
}

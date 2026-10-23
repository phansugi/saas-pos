/**
 * Gambar **barcode Code 39** dari kode produk.
 *
 * Kode 39 dipilih karena paling luas dibaca pemindai POS dan hanya butuh huruf
 * besar, angka, serta beberapa tanda baca — tidak perlu pustaka tambahan. Yang
 * digambar adalah bitmap modul dari `@/lib/productBarcode`, jadi lebar batang
 * (narrow/wide) sudah benar dan bukan sekadar kotak-kotak hiasan.
 *
 * Seperti QR, gambar dipaksa hitam di atas putih dengan zona tenang, apa pun tema
 * aplikasinya: pemindai butuh kontras gelap-terang.
 */
import { useMemo } from "react";
import {
  CODE39_QUIET_ZONE,
  code39Bars,
  code39Extent,
  code39Modules,
} from "@/lib/productBarcode";
import { cn } from "@/lib/utils";

export interface Barcode39ImageProps {
  /** Kode yang ditulis; huruf kecil otomatis jadi huruf besar. */
  value: string;
  className?: string;
  /** Label pembaca layar; bawaan menyebut barcode produk. */
  label?: string;
}

export function Barcode39Image({ value, className, label }: Barcode39ImageProps) {
  const { bars, extent, modules } = useMemo(
    () => ({
      bars: code39Bars(value),
      extent: code39Extent(value),
      modules: code39Modules(value).length,
    }),
    [value],
  );

  if (bars.length === 0) return null;

  return (
    <svg
      role="img"
      aria-label={label ?? `Barcode ${value}`}
      data-barcode-value={value}
      data-barcode-modules={modules}
      className={cn("block h-16 w-full bg-white", className)}
      viewBox={`0 0 ${extent} 48`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
    >
      <rect width={extent} height={48} fill="#ffffff" />
      {bars.map((bar, index) => (
        <rect
          key={index}
          x={CODE39_QUIET_ZONE + bar.x}
          y={0}
          width={bar.width}
          height={48}
          fill="#000000"
        />
      ))}
    </svg>
  );
}

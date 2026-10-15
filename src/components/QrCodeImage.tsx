/**
 * Gambar kode QR dari payload tagihan.
 *
 * Komponen ini sengaja memaksa **modul gelap di atas latar putih**, apa pun tema
 * aplikasinya: pemindai mengharapkan kontras gelap-terang, jadi kode QRIS tidak
 * boleh ikut warna tema gelap. Zona tenang (quiet zone) 4 modul ikut digambar
 * supaya pemindai punya margin yang cukup.
 *
 * Namanya `QrCodeImage` (bukan `QrCode`) supaya tidak bentrok dengan ikon
 * `QrCode` dari lucide-react yang sudah dipakai di banyak halaman. Payload juga
 * ditulis ke `data-qr-value` supaya harness bisa memastikan kode yang digambar
 * memang mengodekan tagihan itu — bukan sekadar kotak acak.
 */

import { useMemo } from "react";
import { QR_QUIET_ZONE, qrExtent, qrMatrix, qrSvgPath } from "@/lib/qr";
import { cn } from "@/lib/utils";

export interface QrCodeImageProps {
  /** Teks yang dikodekan (payload QRIS). */
  value: string;
  className?: string;
  /** Label yang dibacakan pembaca layar; bawaan menyebut kode pembayaran. */
  label?: string;
}

export function QrCodeImage({ value, className, label }: QrCodeImageProps) {
  const { path, extent } = useMemo(() => {
    const matrix = qrMatrix(value);
    return { path: qrSvgPath(matrix), extent: qrExtent(matrix) };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label ?? "Kode QR pembayaran"}
      data-qr-value={value}
      className={cn("block bg-white", className)}
      viewBox={`0 0 ${extent} ${extent}`}
      shapeRendering="crispEdges"
    >
      <rect width={extent} height={extent} fill="#ffffff" />
      <g transform={`translate(${QR_QUIET_ZONE} ${QR_QUIET_ZONE})`}>
        <path d={path} fill="#000000" />
      </g>
    </svg>
  );
}

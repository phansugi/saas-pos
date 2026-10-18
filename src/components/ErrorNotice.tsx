import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ERROR_TITLE,
  errorDetailForCopy,
  errorTechnicalNote,
  readableErrorMessage,
} from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * Kotak galat **bersama** untuk tenant dan backstage — satu bentuk untuk semua
 * penolakan server.
 *
 * Kenapa ada: yang sampai ke layar dulu adalah bungkusan mentah Convex
 * (`[CONVEX M(platform:deleteTenant)] [Request ID: …] Uncaught Error: … at handler
 * (../src/convex/platform.ts:1295:27) Called by client`). Itu bukan pesan — id
 * permintaan dan nomor baris menenggelamkan kalimat yang sebenarnya berguna.
 *
 * Kotak ini menampilkan **hanya kalimatnya** (lihat `readableErrorMessage`), lalu
 * menyimpan bungkusan aslinya di balik “Detail teknis” — tetap bisa disalin saat
 * melapor, tanpa mengganggu orang yang cuma ingin tahu kenapa tombolnya menolak.
 *
 * `error` boleh berupa `Error`/`ConvexError`, atau **string** kalimat buatan klien
 * (validasi formulir). String tampil apa adanya, jadi satu kotak melayani dua
 * asal-usul galat tanpa mengubah kalimat yang sudah jelas.
 */
export function ErrorNotice({
  error,
  testId,
  title = ERROR_TITLE,
  hint,
  className,
}: {
  error: unknown;
  /** `data-testid` di akar kotak; harness memakainya untuk membaca teksnya. */
  testId?: string;
  title?: string;
  /** Satu kalimat tindakan yang menolong, kalau ada yang spesifik. */
  hint?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (error === null || error === undefined) return null;

  const message = readableErrorMessage(error);
  const detail = errorTechnicalNote(error);
  const forCopy = errorDetailForCopy(error);

  async function copy() {
    if (!forCopy || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(forCopy);
      setCopied(true);
    } catch {
      // Papan klip bisa diblokir (izin/konteks tidak aman); detailnya tetap
      // terlihat di bawah, jadi kegagalan menyalin tidak perlu jadi galat baru.
    }
  }

  return (
    <div
      role="alert"
      data-testid={testId}
      className={cn(
        "flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm",
        className,
      )}
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-destructive">{title}</p>
        <p
          data-testid={testId ? `${testId}-pesan` : undefined}
          className="break-words text-foreground"
        >
          {message}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {detail && (
          <details className="group pt-1">
            <summary className="flex w-fit cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
              Detail teknis
            </summary>
            <div className="mt-2 space-y-2">
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-secondary/60 p-2 font-mono text-xs text-muted-foreground">
                {detail}
              </pre>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void copy()}
                disabled={!forCopy}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Tersalin" : "Salin detail"}
              </Button>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

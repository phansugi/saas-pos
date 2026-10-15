/**
 * Penangkap error render React.
 *
 * Tanpa ini, satu `throw` di mana pun membuat React melepas seluruh pohon
 * komponen dan yang tersisa hanya halaman putih — tanpa petunjuk apa pun, dan
 * tidak ada cara untuk tahu penyebabnya dari layar. Dengan boundary ini, error
 * yang sama tampil sebagai pesan yang bisa dibaca (dan disalin) di layar.
 *
 * Sengaja hanya memakai elemen HTML + kelas Tailwind, tanpa hook, provider,
 * store, atau router: kalau salah satu dari itu yang gagal, boundary ini harus
 * tetap bisa merender.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  /** Nama komponen yang melempar, dari React — membantu melokalisasi. */
  componentStack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    // Tetap dicatat ke konsol supaya detail lengkapnya tidak hilang.
    console.error("MesinPOS gagal merender:", error, info);
  }

  private details(): string {
    const { error, componentStack } = this.state;
    return [
      error?.name ?? "Error",
      error?.message ?? "tanpa pesan",
      error?.stack ?? "",
      componentStack ?? "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="grid min-h-screen place-items-center bg-background p-6">
        <div className="w-full max-w-xl rounded-lg border border-destructive/40 bg-card p-6">
          <h1 className="text-lg font-bold tracking-tight">
            Halaman ini gagal dimuat
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Bukan layar kosong lagi: pesan di bawah ini yang membuat aplikasi
            berhenti merender. Data transaksi Anda tidak terpengaruh.
          </p>

          <pre className="mt-4 max-h-64 overflow-auto rounded-md border border-border bg-secondary/30 p-3 text-xs">
            {`${error.name}: ${error.message}`}
          </pre>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Muat ulang
            </button>
            <button
              type="button"
              onClick={() => {
                const text = this.details();
                if (navigator.clipboard?.writeText) {
                  void navigator.clipboard.writeText(text);
                } else {
                  console.error(text);
                }
              }}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
            >
              Salin detail
            </button>
          </div>
        </div>
      </div>
    );
  }
}

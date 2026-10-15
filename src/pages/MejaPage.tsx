/**
 * Halaman menu tamu (`/meja/:token`) — halaman publik, **tanpa sesi**.
 *
 * Yang terjadi di sini: tamu memindai kartu QR di mejanya, memilih menu dari
 * katalog toko **yang sama dengan kasir**, lalu membayar lewat tagihan QRIS yang
 * diterbitkan server. Halaman ini sengaja tidak berada di dalam `/app` dan tidak
 * meminta login: ponsel pembeli tidak punya akun workspace.
 *
 * Dua jalur data, satu tampilan:
 *
 *  - **mode Convex** — halaman membaca `api.meja.menu` / `api.meja.status` dan
 *    memanggil `api.meja.order` lewat Convex langsung, karena sesi tidak ada dan
 *    store aplikasi memang dibangun untuk pengguna yang login;
 *  - **mode demo** — datanya dari store demo (`guestMenu`/`placeGuestOrder`/
 *    `guestOrderStatus`), termasuk tombol *simulasi* pelunasan supaya alur
 *    lengkapnya bisa dicoba di pratinjau tanpa gateway.
 *
 * Angka yang ditampilkan hanyalah **pratinjau**: total yang ditagih selalu
 * dihitung ulang server dari katalog (`validateGuestCart` + `orderTotal`).
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Ban,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Minus,
  Plus,
  QrCode,
  ShoppingBag,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QrCodeImage } from "@/components/QrCodeImage";
import {
  DIGITAL_METHOD_LABELS,
  DIGITAL_STATUS_LABELS,
  vaBankLabel,
  type DigitalMethod,
  type VaBank,
} from "@/lib/payments";
import {
  GUEST_QRIS_SCREENSHOT_LABEL,
  MEJA_ORDER_STATUS_LABELS,
  guestOrderTotal,
  guestQrisFileName,
  type MejaOrderStatus,
} from "@/lib/meja";
import { qrisImageCaption } from "@/lib/qrisImage";
import { qrisImagePng } from "@/lib/qrisImageRaster";
import { dataSource } from "@/lib/store/config";
import { useStore } from "@/lib/store";
import type {
  StoreGuestMenu,
  StoreGuestMenuResult,
  StoreGuestOrderStatus,
} from "@/lib/store/types";
import { cn } from "@/lib/utils";

function formatRupiah(value: number): string {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

/**
 * Sisa waktu tagihan sebagai `m:ss` (mis. `4:59`) — atau `j m` begitu umurnya
 * lebih dari satu jam, karena tagihan Virtual Account berlaku sehari dan
 * `1439:00` bukan cara menuliskan sisa waktu yang bisa dibaca tamu.
 */
function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe >= 3600) {
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    return `${hours}j ${minutes}m`;
  }
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

export function MejaPage() {
  const { token } = useParams<{ token: string }>();
  return dataSource === "convex" ? (
    <ConvexGuestMenu token={token ?? ""} />
  ) : (
    <DemoGuestMenu token={token ?? ""} />
  );
}

// ------------------------------------------------------------------ tampilan

interface GuestScreenProps {
  /** Menu meja; `null` = masih dimuat. */
  menu: StoreGuestMenuResult | null;
  /** Pesanan yang sedang dipantau (dari tautan tamu), kalau ada. */
  order: StoreGuestOrderStatus | null;
  /** Tautan pemantau ada, tetapi pesanannya tidak ditemukan (mis. mode demo dimuat ulang). */
  orderMissing: boolean;
  error: string | null;
  busy: boolean;
  onSubmit(input: {
    items: { productId: string; quantity: number }[];
    guestName?: string;
    /** Cara bayar pilihan tamu; `va` wajib menyebut bank penerbitnya. */
    method: DigitalMethod;
    bank: VaBank | null;
  }): void;
  onWatch(watchToken: string): void;
  onForget(): void;
  /** Tombol *simulasi* pelunasan; hanya ada di mode demo. */
  onSimulatePay?: () => void;
  /**
   * Membatalkan pesanan dari ponsel tamunya sendiri. Jawabannya dikembalikan
   * apa adanya supaya kalimat penolakannya (mis. tagihannya sudah lunas) bisa
   * ditampilkan di halaman, bukan hilang sebagai galat.
   */
  onCancel?(): Promise<{ ok: true } | { ok: false; reason: string }>;
}

/**
 * Header halaman tamu: **menempel diam** di atas layar, sedikit transparan dengan
 * latar yang diburamkan, dan membawa identitas merchant — logo, nama usaha, dan
 * nama tokonya — beserta meja yang sedang dipesan.
 *
 * Kenapa sticky: tamu memindai kartu di mejanya lalu menggulir daftar menu yang
 * panjang; tanpa header yang diam, identitas tempatnya ikut tergulir hilang dan
 * satu-satunya penanda "ini pesanan untuk meja mana" ada di lembar pesanan yang
 * justru sedang ia cari. Latarnya diburamkan (bukan solid) supaya menu yang lewat
 * di belakangnya masih terasa sebagai halaman yang sama, bukan halaman baru.
 */
function GuestHeader({ menu }: { menu: StoreGuestMenu }) {
  const initial = menu.business.trim().charAt(0).toUpperCase() || "M";
  return (
    <header
      data-testid="meja-header"
      className="sticky top-0 z-20 border-b border-border/60 bg-background/70 backdrop-blur-md"
    >
      <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-2.5">
        {menu.logoUrl ? (
          <img
            src={menu.logoUrl}
            alt={`Logo ${menu.business}`}
            data-testid="meja-header-logo"
            className="size-9 shrink-0 rounded-lg border border-border bg-card object-contain"
          />
        ) : (
          /*
            Tanpa logo yang diunggah, header tetap punya wajah: inisial nama
            usahanya. Placeholder abu-abu kosong akan terbaca sebagai gambar yang
            gagal dimuat.
          */
          <span
            data-testid="meja-header-logo-huruf"
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-sm font-semibold text-primary"
          >
            {initial}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{menu.business}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {menu.storeName ? `${menu.storeName} · ` : ""}Meja {menu.tableLabel}
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0">
          Menu digital
        </Badge>
      </div>
    </header>
  );
}

function GuestShell({
  header,
  children,
}: {
  /** Header sticky; `undefined` sebelum identitas merchantnya terbaca. */
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      {header}
      <div className="mx-auto w-full max-w-2xl px-4 pb-28 pt-4">
        {children}
        <MejaFooterLink />
      </div>
    </div>
  );
}

function GuestOrderScreen(props: GuestScreenProps) {
  const { menu, order, orderMissing, error, busy } = props;
  const [cart, setCart] = useState<Record<string, number>>({});
  const [guestName, setGuestName] = useState("");
  const [checkout, setCheckout] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  // Dua cara bayar yang ditawarkan: QRIS (bawaan) atau Virtual Account bank.
  const [payMethod, setPayMethod] = useState<DigitalMethod>("qris");
  const [payBank, setPayBank] = useState<VaBank>("bca");

  /**
   * Sisa waktu dihitung di ponsel dari `expiresAt` (detik demi detik), bukan dari
   * jawaban server yang datang sesekali — hitungan mundur yang diam akan membuat
   * tamu mengira tagihannya masih hidup setelah kedaluwarsa.
   */
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!order || order.chargeStatus !== "pending") return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [order, order?.chargeStatus]);

  /**
   * Begitu pesanannya terkirim (dan tagihannya terbit), lembar pesanan ditutup
   * dan keranjangnya dikosongkan: tamu tidak boleh bisa menekan "Pesan" lagi dari
   * lembar yang sudah usang, apalagi mengirim pesanan kedua tanpa sadar.
   */
  useEffect(() => {
    if (!order) return;
    setCheckout(false);
    setCart({});
  }, [order?.chargeNumber]);

  const items = useMemo(
    () => (menu?.ok ? menu.menu.groups.flatMap((group) => group.items) : []),
    [menu],
  );
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const cartLines = useMemo(
    () =>
      Object.entries(cart)
        .filter(([, quantity]) => quantity > 0)
        .map(([id, quantity]) => {
          const item = byId.get(id);
          return {
            productId: id,
            name: item?.name ?? "",
            unitPrice: item?.price ?? 0,
            quantity,
            lineTotal: (item?.price ?? 0) * quantity,
          };
        }),
    [cart, byId],
  );
  const subtotal = cartLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const units = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const tax = menu?.ok ? menu.menu.tax : null;
  const totals = tax ? guestOrderTotal(subtotal, tax) : null;

  if (menu === null) {
    return (
      <GuestShell>
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Memuat menu…
        </p>
      </GuestShell>
    );
  }

  if (!menu.ok) {
    return (
      <GuestShell>
        <div
          data-testid="meja-tidak-aktif"
          className="mt-6 rounded-xl border border-accent/40 bg-accent/10 p-5 text-sm"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-accent" />
            <div>
              <div className="font-semibold text-foreground">
                Menu ini belum bisa dipakai
              </div>
              <p className="mt-1 text-muted-foreground">{menu.reason}</p>
            </div>
          </div>
        </div>
      </GuestShell>
    );
  }

  const { storeName, tableLabel, groups, limits, payment } = menu.menu;
  const shown = activeGroup
    ? groups.filter((group) => group.name === activeGroup)
    : groups;

  function change(id: string, delta: number) {
    setCart((current) => {
      const next = Math.max(0, Math.min(limits.maxQtyPerItem, (current[id] ?? 0) + delta));
      return { ...current, [id]: next };
    });
  }

  function submit() {
    props.onSubmit({
      items: cartLines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
      })),
      guestName: guestName.trim() || undefined,
      method: payMethod,
      bank: payMethod === "va" ? payBank : null,
    });
  }

  const remainingSeconds =
    order?.expiresAt !== undefined && order?.expiresAt !== null
      ? Math.max(0, Math.floor((order.expiresAt - clock) / 1000))
      : order?.remainingSeconds ?? 0;

  return (
    <GuestShell header={<GuestHeader menu={menu.menu} />}>
      <div
        data-testid="meja-cara-pesan"
        className="rounded-xl border border-border bg-card p-4"
      >
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <UtensilsCrossed className="size-5 text-primary" />
          Meja {tableLabel}
          {storeName ? (
            <span className="text-xs font-normal text-muted-foreground">
              · {storeName}
            </span>
          ) : null}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Pilih menu di ponsel Anda, lalu bayar dengan QRIS atau Virtual Account.
          Begitu pembayarannya lunas, pesanan Anda langsung masuk ke antrean
          dapur — tidak perlu menunggu pelayan mencatatnya.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          data-testid="meja-error"
          className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      {/* ------------------------------------------------------- status bayar */}
      {orderMissing && (
        <div
          data-testid="meja-pesanan-hilang"
          className="mt-4 rounded-lg border border-border bg-card p-4 text-sm"
        >
          <div className="font-semibold">Pesanan tidak ditemukan</div>
          <p className="mt-1 text-muted-foreground">
            Pesanannya tidak ada lagi di perangkat ini — di mode demo, memuat
            ulang halaman menghapusnya. Silakan pesan ulang.
          </p>
          <Button className="mt-3" variant="outline" onClick={props.onForget}>
            Pesan lagi
          </Button>
        </div>
      )}

      {order && (
        <PaymentCard
          order={order}
          remainingSeconds={remainingSeconds}
          onForget={props.onForget}
          onSimulatePay={props.onSimulatePay}
          onCancel={props.onCancel}
          busy={busy}
        />
      )}

      {/* --------------------------------------------------------------- menu */}
      {!order &&
        !orderMissing && (
          <>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setActiveGroup(null)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs",
                  activeGroup === null
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground",
                )}
              >
                Semua
              </button>
              {groups.map((group) => (
                <button
                  key={group.name}
                  type="button"
                  onClick={() => setActiveGroup(group.name)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-xs",
                    activeGroup === group.name
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {group.name}
                </button>
              ))}
            </div>

            <div className="mt-3 space-y-6" data-testid="meja-menu">
              {shown.map((group) => (
                <section key={group.name}>
                  <h2 className="text-sm font-semibold">{group.name}</h2>
                  <ul className="mt-2 space-y-2">
                    {group.items.map((item) => {
                      const quantity = cart[item.id] ?? 0;
                      return (
                        <li
                          key={item.id}
                          className={cn(
                            "flex items-center gap-3 rounded-lg border bg-card p-3",
                            item.available ? "border-border" : "border-dashed border-border opacity-70",
                          )}
                        >
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt=""
                              loading="lazy"
                              className="size-14 shrink-0 rounded-md object-cover"
                            />
                          ) : (
                            <div className="size-14 shrink-0 rounded-md bg-secondary/50" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{item.name}</div>
                            <div className="text-sm text-muted-foreground">
                              {formatRupiah(item.price)}
                            </div>
                            {!item.available && (
                              <span className="text-[11px] text-accent">Habis</span>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              aria-label={`Kurangi ${item.name}`}
                              onClick={() => change(item.id, -1)}
                              disabled={quantity === 0}
                              className="grid size-8 place-items-center rounded-md border border-border disabled:opacity-40"
                            >
                              <Minus className="size-3.5" />
                            </button>
                            <span
                              className="w-6 text-center text-sm font-mono"
                              data-testid={`meja-jumlah-${item.id}`}
                            >
                              {quantity}
                            </span>
                            <button
                              type="button"
                              aria-label={`Tambah ${item.name}`}
                              onClick={() => change(item.id, 1)}
                              disabled={!item.available || quantity >= limits.maxQtyPerItem}
                              className="grid size-8 place-items-center rounded-md border border-primary/40 bg-primary/10 text-primary disabled:opacity-40"
                            >
                              <Plus className="size-3.5" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {shown.every((group) => group.items.length === 0) && (
                <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  Belum ada menu yang dijual untuk toko ini. Tanyakan pelayan.
                </p>
              )}
            </div>
          </>
        )}

      {/* -------------------------------------------------------------- bayar */}
      {!order && units > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 p-3 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
            <div className="text-sm">
              <div className="text-muted-foreground">{units} item</div>
              <div className="font-semibold" data-testid="meja-total-keranjang">
                {formatRupiah(totals?.total ?? subtotal)}
              </div>
            </div>
            <Button onClick={() => setCheckout(true)} data-testid="meja-lanjut-bayar">
              <ShoppingBag className="size-4" />
              Pesan &amp; bayar
            </Button>
          </div>
        </div>
      )}

      {checkout && !order && (
        <div
          className="fixed inset-0 z-30 flex items-end bg-black/50 p-0 sm:items-center sm:justify-center"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-t-2xl border border-border bg-card p-4 sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Pesanan Anda</div>
                <div className="text-xs text-muted-foreground">Meja {tableLabel}</div>
              </div>
              <button
                type="button"
                aria-label="Tutup"
                onClick={() => setCheckout(false)}
              >
                <X className="size-4" />
              </button>
            </div>

            <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto text-sm">
              {cartLines.map((line) => (
                <li key={line.productId} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {line.quantity}× {line.name}
                  </span>
                  <span className="font-mono">{formatRupiah(line.lineTotal)}</span>
                </li>
              ))}
            </ul>

            <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
              {totals?.lines.map((line) => (
                <div key={line.kind} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{line.label}</span>
                  <span className="font-mono">{formatRupiah(line.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between gap-3 font-semibold">
                <span>Total tagihan</span>
                <span className="font-mono" data-testid="meja-total-checkout">
                  {formatRupiah(totals?.total ?? subtotal)}
                </span>
              </div>
            </div>

            {/*
              Cara bayar dipilih **sebelum** tagihannya terbit: QRIS menerbitkan
              kode yang bisa dipindai/disimpan, Virtual Account menerbitkan nomor
              transfer bank. Pilihannya datang dari menu (satu sumber dengan
              server), bukan daftar yang ditulis ulang di halaman ini.
            */}
            <div className="mt-3" data-testid="meja-cara-bayar">
              <div className="text-xs font-medium">Cara bayar</div>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                {payment.methods.map((option) => (
                  <button
                    key={option.method}
                    type="button"
                    onClick={() => setPayMethod(option.method)}
                    aria-pressed={payMethod === option.method}
                    data-testid={`meja-bayar-${option.method}`}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-xs",
                      payMethod === option.method
                        ? "border-primary bg-primary/10"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2 font-medium text-foreground">
                      {option.label}
                      {payMethod === option.method ? (
                        <Check className="size-3.5 text-primary" />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {option.hint}
                    </span>
                  </button>
                ))}
              </div>

              {payMethod === "va" ? (
                <div className="mt-2" data-testid="meja-bank-va">
                  <div className="text-[11px] text-muted-foreground">
                    Bank penerbit Virtual Account
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {payment.banks.map((bank) => (
                      <button
                        key={bank.bank}
                        type="button"
                        onClick={() => setPayBank(bank.bank)}
                        aria-pressed={payBank === bank.bank}
                        data-testid={`meja-bank-${bank.bank}`}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px]",
                          payBank === bank.bank
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-border text-muted-foreground",
                        )}
                      >
                        {bank.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <label className="mt-3 block text-xs text-muted-foreground">
              Nama Anda (opsional)
              <Input
                className="mt-1"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                maxLength={limits.nameMax}
                placeholder="mis. Rina"
                aria-label="Nama tamu"
              />
            </label>

            <Button
              className="mt-3 w-full"
              onClick={submit}
              disabled={busy || units === 0}
              data-testid="meja-kirim-pesanan"
            >
              <QrCode className="size-4" />
              {busy ? "Menerbitkan tagihan…" : "Pesan & lanjut bayar"}
            </Button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Tagihan diterbitkan server senilai total di atas — kode QRIS atau
              nomor Virtual Account-nya; pesanannya masuk dapur setelah pembayaran
              diterima.
            </p>
          </div>
        </div>
      )}
    </GuestShell>
  );
}

/** Kartu pembayaran/status satu pesanan tamu. */
function PaymentCard({
  order,
  remainingSeconds,
  busy,
  onForget,
  onSimulatePay,
  onCancel,
}: {
  order: StoreGuestOrderStatus;
  remainingSeconds: number;
  busy: boolean;
  onForget(): void;
  onSimulatePay?: () => void;
  onCancel?(): Promise<{ ok: true } | { ok: false; reason: string }>;
}) {
  const paid = order.status === "paid";
  const cancelled = order.status === "cancelled";
  const expiredOrDead =
    order.chargeStatus === "expired" ||
    order.chargeStatus === "cancelled" ||
    (order.chargeStatus === "pending" && remainingSeconds <= 0);

  const [shotBusy, setShotBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Laporan tindakan tamu (gambar tersimpan, nomor tersalin) — bukan klaim kosong. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Pembatalan pesanan oleh tamu: niat, proses, dan kalimat penolakannya. */
  const [cancelAsk, setCancelAsk] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);

  /**
   * Membatalkan pesanannya sendiri. Pembatalan **tidak** memakai dialog peramban
   * (`confirm`) dan tidak disembunyikan: tamu menekan satu tombol, membaca akibat
   *nya, lalu memutuskan — dan jawaban server (mis. tagihannya ternyata sudah
   * lunas) ditampilkan apa adanya, bukan disamarkan menjadi “berhasil”.
   */
  async function batalkanPesanan() {
    if (!onCancel || cancelBusy) return;
    setCancelBusy(true);
    setCancelNotice(null);
    try {
      const result = await onCancel();
      if (result.ok) {
        setCancelAsk(false);
        setCancelNotice(
          "Pesanan Anda sudah dibatalkan. Tidak ada yang perlu dibayar, dan dapur tidak meneruskan pesanannya.",
        );
        return;
      }
      setCancelNotice(result.reason);
    } catch (cause) {
      setCancelNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCancelBusy(false);
    }
  }

  /**
   * Menyimpan kode QRIS sebagai gambar.
   *
   * Ponsel yang menampilkan kode tidak bisa memindainya sendiri, jadi yang bekerja
   * adalah menyimpan gambarnya lalu memilih bayar dari galeri di aplikasi
   * bank/e-wallet. Berkasnya digambar **di perangkat tamu** (tidak diunggah ke mana
   * pun); kalau perangkatnya punya lembar bagikan berkas, gambarnya diserahkan ke
   * sana supaya bisa langsung disimpan ke galeri atau dikirim, dan kalau tidak, ia
   * diunduh sebagai berkas PNG biasa.
   */
  async function simpanGambarQris() {
    if (shotBusy || !order.qrPayload) return;
    setShotBusy(true);
    setNotice(null);
    try {
      const berkasNama = guestQrisFileName(order.chargeNumber);
      const gambar = await qrisImagePng(order.qrPayload, {
        caption: qrisImageCaption({
          amount: order.total,
          chargeNumber: order.chargeNumber,
        }),
      });
      if (!gambar) {
        setNotice(
          "Perangkat ini belum bisa menggambar kode QRIS jadi berkas — kodenya tetap bisa dipindai langsung dari layar ini, atau minta pelayan menampilkannya.",
        );
        return;
      }

      const berkas = new File([gambar.bytes as unknown as BlobPart], berkasNama, {
        type: "image/png",
      });
      const adaLembarBagikan =
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [berkas] });

      if (adaLembarBagikan) {
        await navigator.share({
          files: [berkas],
          title: `QRIS ${order.chargeNumber}`,
          text: order.instruction,
        });
        setNotice(
          `Gambar ${berkasNama} diserahkan ke lembar bagikan perangkat — simpan ke galeri, lalu di aplikasi bank/e-wallet pilih bayar dari galeri.`,
        );
        return;
      }

      /*
        Tanpa lembar bagikan: gambarnya **diunduh**. URL `blob:`-nya dilepas
        setelah beberapa detik — peramban perlu waktu memulai unduhannya, dan
        melepasnya terlalu cepat menghasilkan berkas kosong.
      */
      const blob = new Blob([gambar.bytes as unknown as BlobPart], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = berkasNama;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setNotice(
        `Gambar ${berkasNama} (${gambar.widthPx}×${gambar.heightPx} px) tersimpan di perangkat — buka aplikasi bank/e-wallet, lalu pilih bayar QRIS dari galeri.`,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setNotice(
          "Menyimpan gambar dibatalkan — kode QRIS tetap bisa dipindai langsung dari layar ini.",
        );
        return;
      }
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setShotBusy(false);
    }
  }

  /** Menyalin nomor Virtual Account; kalau papan klipenya tidak ada, nomornya
   *  dibilang apa adanya supaya tamu masih bisa menyalinnya sendiri. */
  async function salinNomorVa() {
    const nomor = (order.vaNumber ?? "").trim();
    if (!nomor) return;
    try {
      await navigator.clipboard.writeText(nomor);
      setCopied(true);
      setNotice(`Nomor Virtual Account ${nomor} tersalin.`);
    } catch {
      setNotice(
        `Perangkat ini tidak mengizinkan salin otomatis — catat nomor ${nomor} dari layar ini.`,
      );
    }
  }

  return (
    <section
      className="mt-4 rounded-xl border border-border bg-card p-4"
      data-testid="meja-pembayaran"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">
            {paid ? "Pembayaran diterima" : cancelled ? "Pesanan dibatalkan" : "Menunggu pembayaran"}
          </div>
          <div className="text-xs text-muted-foreground">
            Meja {order.tableLabel} · {order.chargeNumber} ·
            {" "}
            {DIGITAL_METHOD_LABELS[order.method]}
          </div>
        </div>
        <Badge variant={paid ? "default" : expiredOrDead ? "accent" : "secondary"}>
          {paid
            ? MEJA_ORDER_STATUS_LABELS.paid
            : DIGITAL_STATUS_LABELS[order.chargeStatus]}
        </Badge>
      </div>

      <div className="mt-3 flex justify-between text-sm">
        <span className="text-muted-foreground">Total tagihan</span>
        <span className="font-mono font-semibold" data-testid="meja-total-tagihan">
          {formatRupiah(order.total)}
        </span>
      </div>
      {order.guestName && (
        <div className="mt-1 text-xs text-muted-foreground">a/n {order.guestName}</div>
      )}
      <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
        {order.lines.map((line, index) => (
          <li key={`${line.name}-${index}`}>
            {line.quantity}× {line.name}
          </li>
        ))}
      </ul>

      {paid ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <div className="font-medium">
              Terima kasih! Pesanan Anda sudah masuk ke dapur
              {order.saleNumber ? ` (tiket ${order.saleNumber})` : ""}.
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Simpan halaman ini kalau perlu menanyakan pesanan Anda ke pelayan.
            </p>
          </div>
        </div>
      ) : expiredOrDead ? (
        <div className="mt-4 rounded-lg border border-accent/40 bg-accent/10 p-3 text-xs">
          Tagihan ini {order.chargeStatus === "cancelled" ? "dibatalkan" : "kedaluwarsa"} —
          tanyakan pelayan, atau buat pesanan baru.
          <Button className="mt-2 w-full" variant="outline" onClick={onForget}>
            Pesan lagi
          </Button>
        </div>
      ) : order.method === "qris" ? (
        <>
          <div className="mt-4 flex flex-col items-center gap-2">
            {order.qrPayload ? (
              <QrCodeImage
                value={order.qrPayload}
                className="size-56 rounded-lg border border-border p-1"
                label="Kode QRIS tagihan pesanan Anda"
              />
            ) : null}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" />
              Berlaku {formatCountdown(remainingSeconds)} lagi
            </div>
          </div>

          <Button
            className="mt-3 w-full"
            variant="outline"
            onClick={() => void simpanGambarQris()}
            disabled={shotBusy || !order.qrPayload}
            data-testid="meja-qris-screenshot"
          >
            <Camera className="size-4" />
            {shotBusy ? "Menyiapkan gambar…" : GUEST_QRIS_SCREENSHOT_LABEL}
          </Button>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Simpan gambarnya, lalu di aplikasi bank/e-wallet pilih bayar QRIS →
            dari galeri. Kodenya juga tetap bisa dipindai dari layar ini oleh
            perangkat lain.
          </p>
        </>
      ) : (
        <>
          <div
            className="mt-4 rounded-lg border border-border bg-secondary/30 p-3"
            data-testid="meja-va"
          >
            <div className="text-[11px] text-muted-foreground">
              {order.bank
                ? `Virtual Account ${vaBankLabel(order.bank)}`
                : "Virtual Account"}
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span
                className="font-mono text-lg font-semibold tracking-wide"
                data-testid="meja-va-nomor"
              >
                {order.vaNumber ?? "—"}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void salinNomorVa()}
                disabled={!order.vaNumber}
                data-testid="meja-va-salin"
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Tersalin" : "Salin"}
              </Button>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" />
              Berlaku {formatCountdown(remainingSeconds)} lagi
            </div>
          </div>
        </>
      )}

      {!paid ? (
        <p
          className="mt-3 text-center text-xs text-muted-foreground"
          data-testid="meja-cara-bayar-kalimat"
        >
          {order.instruction}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          data-testid="meja-bayar-notis"
          className="mt-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-center text-[11px] text-muted-foreground"
        >
          {notice}
        </p>
      ) : null}
      {!paid && order.chargeStatus === "pending" ? (
        <p className="mt-1 text-center text-[11px] text-muted-foreground">
          Halaman ini menyegarkan sendiri begitu kasir mencatat pembayarannya.
        </p>
      ) : null}
      {!paid &&
        onSimulatePay && (
          <Button
            className="mt-3 w-full"
            variant="outline"
            onClick={onSimulatePay}
            disabled={busy}
            data-testid="meja-simulasi-bayar"
          >
            Simulasikan pembayaran (mode demo)
          </Button>
        )}

      {/*
        Berubah pikiran sebelum uangnya masuk adalah hal yang wajar: tamu bisa
        membatalkan pesanannya sendiri dari ponselnya, selama tagihannya belum
        lunas. Yang dilakukannya hanya membatalkan pesanan ini — kalau tagihannya
        masih menunggu, kode bayarnya juga dimatikan supaya tidak bisa dipakai
        membayar pesanan yang sudah dibatalkan.
      */}
      {order.status === "pending" && onCancel ? (
        <div
          className="mt-3 rounded-lg border border-border bg-secondary/30 p-3"
          data-testid="meja-batal-area"
        >
          {cancelAsk ? (
            <>
              <p className="text-xs">
                Batalkan pesanan ini? Pesanannya tidak diteruskan ke dapur, dan
                Anda tidak perlu membayar apa pun.
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCancelAsk(false)}
                  disabled={cancelBusy}
                  data-testid="meja-batal-tidak"
                >
                  Lanjutkan pesanan
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  onClick={() => void batalkanPesanan()}
                  disabled={cancelBusy}
                  data-testid="meja-batal-konfirmasi"
                >
                  <Ban className="size-4" />
                  {cancelBusy ? "Membatalkan…" : "Ya, batalkan"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                className="w-full text-destructive"
                onClick={() => {
                  setCancelNotice(null);
                  setCancelAsk(true);
                }}
                disabled={cancelBusy}
                data-testid="meja-batal-pesanan"
              >
                <Ban className="size-4" />
                Batalkan pesanan
              </Button>
              <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                Berubah pikiran? Batalkan selama tagihannya belum dibayar.
              </p>
            </>
          )}
        </div>
      ) : null}

      {cancelNotice ? (
        <p
          role="status"
          data-testid="meja-batal-notis"
          className="mt-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-center text-[11px] text-muted-foreground"
        >
          {cancelNotice}
        </p>
      ) : null}

      {!paid && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          Sudah bayar tapi statusnya belum berubah? Tanyakan pelayan — pelunasan
          bisa dicatat dari kasir.
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ data: Convex

function ConvexGuestMenu({ token }: { token: string }) {
  const menuDoc = useQuery(api.meja.menu, { token });
  const orderMutation = useMutation(api.meja.order);
  const cancelOwnOrder = useMutation(api.meja.cancelOwnOrder);
  const [searchParams, setSearchParams] = useSearchParams();
  const [watching, setWatching] = useState<string | null>(() => searchParams.get("p"));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const statusDoc = useQuery(
    api.meja.status,
    watching ? { watch: watching } : "skip",
  );

  const menu: StoreGuestMenuResult | null =
    menuDoc === undefined
      ? null
      : menuDoc.ok
        ? { ok: true, menu: menuDoc }
        : { ok: false, reason: menuDoc.reason };

  const order: StoreGuestOrderStatus | null =
    statusDoc && statusDoc.ok
      ? {
          status: statusDoc.status as MejaOrderStatus,
          chargeStatus: statusDoc.chargeStatus,
          chargeNumber: statusDoc.chargeNumber,
          tableLabel: statusDoc.tableLabel,
          guestName: statusDoc.guestName,
          subtotal: statusDoc.subtotal,
          tax: statusDoc.tax,
          serviceCharge: statusDoc.serviceCharge,
          total: statusDoc.total,
          lines: statusDoc.lines.map((line) => ({
            name: line.name,
            quantity: line.quantity,
            lineTotal: line.lineTotal,
          })),
          saleNumber: statusDoc.saleNumber,
          paidAt: statusDoc.paidAt,
          expiresAt: statusDoc.expiresAt,
          remainingSeconds: statusDoc.remainingSeconds,
          method: statusDoc.method,
          bank: statusDoc.bank,
          vaNumber: statusDoc.vaNumber,
          qrPayload: statusDoc.qrPayload,
          instruction: statusDoc.instruction,
        }
      : null;

  async function submit(input: {
    items: { productId: string; quantity: number }[];
    guestName?: string;
    method: DigitalMethod;
    bank: VaBank | null;
  }) {
    setBusy(true);
    setError(null);
    try {
      const result = await orderMutation({
        token,
        items: input.items,
        guestName: input.guestName,
        method: input.method,
        bank: input.bank ?? undefined,
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      // Rahasianya ikut di alamat halaman supaya memuat ulang tidak kehilangan
      // status pesanan yang sedang berjalan.
      setWatching(result.watchToken);
      setSearchParams({ p: result.watchToken }, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <GuestOrderScreen
      menu={menu}
      order={order}
      orderMissing={Boolean(watching) && statusDoc !== undefined && !statusDoc.ok}
      error={error}
      busy={busy}
      onSubmit={(input) => void submit(input)}
      onWatch={(watchToken) => {
        setWatching(watchToken);
        setSearchParams({ p: watchToken }, { replace: true });
      }}
      onForget={() => {
        setWatching(null);
        setSearchParams({}, { replace: true });
      }}
      /*
        Pembatalan tamu dikirim ke server lewat token pemantau (`mjo_…`) — ponsel
        pembeli tidak punya sesi, dan yang bisa dibatalkan hanyalah pesanan yang
        tokennya dipegang pemanggil.
      */
      onCancel={
        watching
          ? async () => {
              const result = await cancelOwnOrder({ watch: watching });
              return result.ok ? { ok: true as const } : { ok: false as const, reason: result.reason };
            }
          : undefined
      }
      /*
        Tanpa tombol simulasi: di mode Convex pelunasan dicatat sungguhan oleh
        kasir (kartu ”Pesanan QR” di layar dapur), dan halaman ini menyegarkan
        sendiri begitu tagihannya lunas.
      */
    />
  );
}

// -------------------------------------------------------------------- data: demo

function DemoGuestMenu({ token }: { token: string }) {
  const store = useStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [watching, setWatching] = useState<string | null>(() => searchParams.get("p"));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const menu = store.guestMenu ? store.guestMenu(token) : null;
  const order = watching && store.guestOrderStatus
    ? store.guestOrderStatus(watching)
    : null;

  async function submit(input: {
    items: { productId: string; quantity: number }[];
    guestName?: string;
    method: DigitalMethod;
    bank: VaBank | null;
  }) {
    if (!store.placeGuestOrder) {
      setError("Mode demo tidak menyediakan pesanan tamu.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await store.placeGuestOrder({
        token,
        items: input.items,
        guestName: input.guestName,
        method: input.method,
        bank: input.bank,
      });
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      setWatching(result.receipt.watchToken);
      setSearchParams({ p: result.receipt.watchToken }, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <GuestOrderScreen
      menu={menu}
      order={order}
      orderMissing={Boolean(watching) && order === null}
      error={error}
      busy={busy}
      onSubmit={(input) => void submit(input)}
      onWatch={(watchToken) => {
        setWatching(watchToken);
        setSearchParams({ p: watchToken }, { replace: true });
      }}
      onForget={() => {
        setWatching(null);
        setSearchParams({}, { replace: true });
      }}
      onCancel={
        watching && store.cancelGuestOrder
          ? () => store.cancelGuestOrder!(watching)
          : undefined
      }
      onSimulatePay={
        order && order.status === "pending"
          ? () => {
              // Mode demo punya tombol ini supaya alur lengkapnya bisa dicoba:
              // pelunasan di demo membuat tiket dapurnya muncul, persis seperti
              // `payments.act` → `meja.guestOrderPaid` di server.
              const target = store.mejaOrders.find(
                (row) => row.chargeNumber === order.chargeNumber,
              );
              if (!target) return;
              void store.settleMejaOrder?.(target.id);
            }
          : undefined
      }
    />
  );
}

/** Tautan balik ke aplikasi untuk pengunjung yang bukan tamu meja. */
export function MejaFooterLink() {
  return (
    <p className="mt-8 text-center text-[11px] text-muted-foreground">
      Dipesan lewat <Link to="/" className="text-primary hover:underline">MesinPOS</Link>
    </p>
  );
}

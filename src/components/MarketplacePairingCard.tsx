/**
 * Kartu **pairing vendor marketplace** di halaman Pengaturan.
 *
 * Alurnya dua langkah dan sengaja tidak menyembunyikan ketergantungan luar:
 *
 * 1. **Cari vendor lewat kontak.** Pemilik mengetik email/WA yang terdaftar di
 *    `pusatbahanbangunan.com`, dan yang tampil di langkah 2 hanya vendor yang
 *    marketplace nyatakan terkait dengan kontak itu — bukan seluruh direktori.
 *    Direktori lengkap baru dibuka kalau pemilik sendiri menekan “Tampilkan
 *    direktori toko”, misalnya karena kontaknya belum terdaftar.
 * 2. **Konfirmasi kontak.** Email atau nomor WA yang terdaftar di marketplace
 *    dinormalkan & disimpan sebagai identitas owner bisnis. Hanya **pemilik**
 *    yang boleh menyelesaikan langkah ini — karena itu **kartunya pun hanya
 *    ditampilkan untuk pemilik**; peran lain tidak melihat status pairing sama
 *    sekali, bukan melihat formulir yang akan ditolak server.
 *
 * Sesudah terpasang, kartu menampilkan tautan snapshot bertoken yang bisa
 * ditarik marketplace. “Sinkronkan sekarang” menyusun snapshot terbaru dan,
 * bila `PUSATBAHANBANGUNAN_SYNC_URL` diisi, mendorongnya; tanpa endpoint itu
 * hasilnya ditulis jujur sebagai “siap ditarik”, bukan “terkirim”.
 *
 * Tombol **Sinkronkan produk** khusus katalog: seluruh field produk + gambar +
 * pohon kategori dikirim sebagai upsert per SKU, dan produk/kategori/field yang
 * belum ada di platform dibuat mengikuti sumbernya.
 */
import { useState } from "react";
import { marketplacePairingVisible } from "@/lib/settingsVisibility";
import { useCan } from "@/lib/usePermission";
import {
  ArrowRight,
  ArrowRightLeft,
  BadgeCheck,
  Building2,
  Check,
  CheckCircle2,
  CloudDownload,
  Copy,
  ExternalLink,
  Inbox,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  Package,
  ReceiptText,
  RefreshCw,
  QrCode,
  Search,
  ShieldCheck,
  Store,
  Unplug,
  Upload,
  Wallet,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiSiteUrl } from "@/lib/apiDocs";
import {
  MARKETPLACE_CONTACT_HINTS,
  MARKETPLACE_CONTACT_KINDS,
  MARKETPLACE_CONTACT_LABELS,
  MARKETPLACE_CONTACT_PLACEHOLDERS,
  MARKETPLACE_STOCK_DIFF_LABELS,
  MARKETPLACE_SYNC_ENTITIES,
  marketplaceBarcodeSyncSentence,
  marketplaceContactSentence,
  marketplaceInboundSentence,
  marketplacePullSentence,
  marketplaceReconcileSentence,
  marketplaceSalesSyncSentence,
  marketplaceSnapshotPath,
  marketplaceStockSyncSentence,
  parseMarketplaceContact,
  type MarketplaceContactKind,
  type MarketplaceVendor,
} from "@/lib/marketplace";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

function formatMoment(ms: number | null): string {
  if (!ms) return "belum pernah";
  return new Date(ms).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatRupiah(value: number): string {
  return `Rp${value.toLocaleString("id-ID")}`;
}

const SYNC_TONE: Record<string, string> = {
  delivered: "border-primary/40 bg-primary/10 text-primary",
  ready: "border-accent/50 bg-accent/10 text-accent-foreground",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
};

const SYNC_LABEL: Record<string, string> = {
  delivered: "Snapshot diterima marketplace",
  ready: "Snapshot siap ditarik",
  failed: "Dorongan gagal",
};

/** Ikon kecil untuk tiap entitas yang ikut disalin. */
const ENTITY_ICON = {
  products: Package,
  sales: ReceiptText,
  purchases: Building2,
  payables: Wallet,
} as const;

export function MarketplacePairingCard() {
  const {
    marketplace,
    apiKeySummary,
    lookupMarketplaceVendors,
    pairMarketplace,
    unpairMarketplace,
    retryMarketplaceOrder,
    setMarketplacePushSecret,
    syncMarketplaceNow,
    pushMarketplaceProducts,
    pullMarketplaceCatalog,
    reconcileMarketplaceStock,
    pushMarketplaceStockDiffs,
    pullMarketplaceStockDiffs,
  } = useStore();

  const [kind, setKind] = useState<MarketplaceContactKind>("email");
  const [query, setQuery] = useState("");
  const [contact, setContact] = useState("");
  const [vendors, setVendors] = useState<MarketplaceVendor[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [verifiedVendorId, setVerifiedVendorId] = useState<string | null>(null);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  /** Mode pencarian terakhir: hasil kontak atau direktori yang sengaja dibuka. */
  const [lookupMode, setLookupMode] = useState<"contact" | "directory" | null>(
    null,
  );
  /**
   * Direktori dibuka karena kontak belum cocok, bukan karena pemilik menekan
   * tombol direktori. Dipakai hanya untuk menjelaskan kenapa daftar toko muncul.
   */
  const [directoryFallback, setDirectoryFallback] = useState(false);
  const [busy, setBusy] = useState<
    | "lookup"
    | "pair"
    | "unpair"
    | "sync"
    | "products"
    | "catalog"
    | "reconcile"
    | "pushDiffs"
    | "pullDiffs"
    | "secret"
    | null
  >(null);
  const [pushSecret, setPushSecret] = useState("");
  /** Nomor pesanan yang sedang dicatat ulang (tombol per baris). */
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);

  const pairing = marketplace.pairing;
  const canPair = marketplace.canPair;
  const can = useCan();
  /*
    Kartu ini hanya untuk pengelola workspace yang memang sudah menyiapkan
    integrasinya — bukan untuk semua akun yang bisa login. Syaratnya tiga-tiganya
    (`marketplacePairingVisible`): akun pemilik, perannya mengatur workspace
    (`billing.manage`), dan workspace punya kunci API aktif sebagai tanda integrasi
    API-nya sudah diatur.

    Akun lain **tidak ditawari kartunya sama sekali** (bukan ditampilkan lalu
    dikunci): status pairing bukan pekerjaan mereka, dan formulir yang tidak bisa
    dipakai hanya menimbulkan pertanyaan. Server tetap memeriksa hal yang sama
    (`ownerOnlyReason`), jadi ini bukan satu-satunya gerbangnya.
  */
  const tampil = marketplacePairingVisible({
    canPair,
    canManageWorkspace: can("billing.manage"),
    activeApiKeys: apiKeySummary.active,
  });
  if (!tampil) return null;
  /** Baris selisih dari pemeriksaan terakhir; kosong = tidak ada yang berbeda. */
  const stockDiffs = pairing?.stockDiffs ?? [];
  /** Hanya selisih saldo yang bisa dikirim; SKU sepihak bukan urusan tombol ini. */
  const pushableDiffs = stockDiffs.filter((row) => row.kind === "both");

  /**
   * Mencatat ulang satu pesanan marketplace yang ditolak.
   *
   * Tidak ada jaringan ke marketplace: isi pesanan yang tersimpan diterapkan
   * ulang lewat jalur penjualan MesinPOS. Dipakai sesudah produknya diperbaiki
   * (SKU didaftarkan / nama disamakan) supaya nota yang tertahan tidak menunggu
   * percobaan berikutnya dari marketplace.
   */
  const catatUlangPesanan = async (orderId: string) => {
    setRetrying(orderId);
    setError(null);
    setNotice(null);
    try {
      const result = await retryMarketplaceOrder(orderId);
      if (result.ok) setNotice(result.message);
      else setError(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRetrying(null);
    }
  };

  /** Menyimpan/menghapus rahasia penanda tangan kiriman ke marketplace. */
  const savePushSecret = async (clear = false) => {
    setBusy("secret");
    setError(null);
    setNotice(null);
    try {
      const result = await setMarketplacePushSecret(clear ? null : pushSecret);
      setNotice(result.sentence);
      if (!clear) setPushSecret("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const matched =
    verifiedVendorId !== null && selectedId === verifiedVendorId;

  const snapshotUrl = pairing?.syncToken
    ? `${apiSiteUrl()}${marketplaceSnapshotPath(pairing.syncToken)}`
    : null;
  const hiddenSnapshotUrl = `${apiSiteUrl()}/api/marketplace/snapshot?token=mp_${"•".repeat(
    12,
  )}`;

  /**
   * Mencari vendor. `mode` bawaan adalah pencarian kontak: hanya vendor yang
   * terkait dengan email/WA yang diketik yang dikembalikan. `directory` hanya
   * dipakai tombol “Tampilkan direktori toko” — pilihan sadar pemilik, bukan
   * tampilan bawaan.
   */
  async function cari(
    nilai: string,
    mode: "contact" | "directory" = "contact",
  ) {
    setBusy("lookup");
    setError(null);
    setNotice(null);
    setLookupNote(null);
    setDirectoryFallback(false);

    const trimmed = nilai.trim();
    if (mode === "contact" && trimmed === "") {
      setError("Masukkan email atau nomor WA dulu supaya vendor-nya bisa dicari.");
      setBusy(null);
      return;
    }
    if (trimmed !== "") {
      const parsed = parseMarketplaceContact({ kind, value: trimmed });
      if (!parsed.ok) {
        setError(parsed.reason);
        setBusy(null);
        return;
      }
    }

    try {
      const result = await lookupMarketplaceVendors({
        contactKind: kind,
        // Direktori tidak dikirim bersama kontak: yang diminta pemilik adalah
        // daftar toko, bukan pencocokan kontak.
        value: mode === "directory" ? "" : trimmed,
        includeDirectory: mode === "directory",
      });
      setVendors(result.vendors);
      setLookupMode(mode);
      setLookupNote(result.note);
      // Vendor yang cocok bisa langsung dipilih; tanpa kecocokan, pemilik harus
      // benar-benar memilih sendiri dari direktori.
      setSelectedId(result.match?.vendorId ?? null);
      setVerifiedVendorId(result.match?.vendorId ?? null);
      if (result.match) {
        setContact(trimmed);
      }

      // Kontak yang belum cocok tidak boleh berhenti di layar kosong: direktori
      // dibuka otomatis supaya pemilik tetap bisa memilih tokonya. Kontaknya
      // disimpan sebagai klaim (bukan hasil pencocokan) dan diisi ke langkah 3
      // agar tidak perlu mengetik ulang. Kegagalan direktori tidak menutupi
      // alasan “belum cocok” yang sudah ditampilkan.
      if (mode === "contact" && result.match === null) {
        try {
          const directory = await lookupMarketplaceVendors({
            contactKind: kind,
            value: "",
            includeDirectory: true,
          });
          setVendors(directory.vendors);
          setLookupMode("directory");
          setDirectoryFallback(directory.vendors.length > 0);
          setContact(trimmed);
        } catch {
          // Biarkan keadaan kosong beserta tombol direktori yang sudah ada.
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function pasang() {
    const vendor = vendors.find((row) => row.id === selectedId);
    if (!vendor) {
      setError("Pilih satu vendor dulu.");
      return;
    }
    const parsed = parseMarketplaceContact({ kind, value: contact });
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }

    setBusy("pair");
    setError(null);
    setNotice(null);
    try {
      const result = await pairMarketplace({
        vendorId: vendor.id,
        vendorName: vendor.name,
        contactKind: kind,
        contact: parsed.value,
        contactVerified: verifiedVendorId === vendor.id,
      });
      setNotice(result.sentence);
      setVendors([]);
      setLookupMode(null);
      setLookupNote(null);
      setDirectoryFallback(false);
      setSelectedId(null);
      setVerifiedVendorId(null);
      setQuery("");
      setContact("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function lepas() {
    setBusy("unpair");
    setError(null);
    setNotice(null);
    try {
      const result = await unpairMarketplace();
      setNotice(result.sentence);
      setConfirmUnpair(false);
      setVendors([]);
      setLookupMode(null);
      setLookupNote(null);
      setDirectoryFallback(false);
      setSelectedId(null);
      setVerifiedVendorId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function sinkron() {
    setBusy("sync");
    setError(null);
    setNotice(null);
    try {
      const result = await syncMarketplaceNow();
      setNotice(result.note);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function sinkronProduk() {
    setBusy("products");
    setError(null);
    setNotice(null);
    try {
      const result = await pushMarketplaceProducts();
      setNotice(result.note);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function imporKatalog() {
    setBusy("catalog");
    setError(null);
    setNotice(null);
    try {
      const result = await pullMarketplaceCatalog();
      setNotice(result.note);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  /** Mengirim saldo POS hanya untuk SKU yang saldonya berbeda. */
  async function kirimSelisih() {
    setBusy("pushDiffs");
    setError(null);
    setNotice(null);
    try {
      const result = await pushMarketplaceStockDiffs();
      setNotice(
        result.reconcile
          ? `${result.push.note} ${marketplaceReconcileSentence({
              lastReconcileAt: result.reconcile.at,
              lastReconcileStatus: result.reconcile.status,
              lastReconcileNote: result.reconcile.note,
              lastReconcileCounts: result.reconcile.counts,
            })}`
          : result.push.note,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  /** Menarik angka marketplace ke saldo POS, hanya untuk SKU yang berbeda. */
  async function tarikSelisih() {
    setBusy("pullDiffs");
    setError(null);
    setNotice(null);
    try {
      const result = await pullMarketplaceStockDiffs();
      const ringkas = `Angka marketplace ditarik untuk ${result.counts.adjusted} dari ${result.counts.requested} SKU${result.counts.skipped > 0 ? `, ${result.counts.skipped} sudah sama` : ""}${result.counts.missing > 0 ? `, ${result.counts.missing} tidak ada lagi di marketplace` : ""}.`;
      setNotice(
        result.reconcile
          ? `${ringkas} ${marketplaceReconcileSentence({
              lastReconcileAt: result.reconcile.at,
              lastReconcileStatus: result.reconcile.status,
              lastReconcileNote: result.reconcile.note,
              lastReconcileCounts: result.reconcile.counts,
            })}`
          : ringkas,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  /** Menjalankan pemeriksaan selisih stok tanpa menunggu jadwal harian. */
  async function periksaSelisih() {
    setBusy("reconcile");
    setError(null);
    setNotice(null);
    try {
      const result = await reconcileMarketplaceStock();
      setNotice(result.note);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function salin() {
    if (!snapshotUrl) return;
    try {
      await navigator.clipboard.writeText(snapshotUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(
        "Tautan tidak bisa disalin otomatis. Tampilkan token lalu salin manual.",
      );
    }
  }

  return (
    <Card
      id="pairing-marketplace"
      data-testid="marketplace-pairing"
      className="overflow-hidden"
    >
      <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary/60 to-accent" />
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 text-primary ring-1 ring-primary/20">
              <Store className="size-5" />
            </span>
            <div className="min-w-0">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                Pairing vendor marketplace
                {pairing ? (
                  <Badge variant="default" className="gap-1">
                    <BadgeCheck className="size-3" />
                    Terpasang
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="gap-1">
                    Belum terpasang
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="mt-1 max-w-2xl">
                Hubungkan workspace ini dengan akun vendor Anda di{" "}
                <strong className="text-foreground">pusatbahanbangunan.com</strong>{" "}
                memakai email atau nomor WA yang terdaftar. Sesudah terpasang,
                katalog, penjualan, penerimaan barang, dan hutang supplier bisa
                ditarik marketplace dari satu tautan bertoken.
              </CardDescription>
            </div>
          </div>
          <a
            href="https://pusatbahanbangunan.com/vendors"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Direktori marketplace
            <ExternalLink className="size-3" />
          </a>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {error && (
          <p
            role="alert"
            data-testid="marketplace-error"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            data-testid="marketplace-notice"
            className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary"
          >
            {notice}
          </p>
        )}

        {pairing ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            {/* Identitas pasangan */}
            <div className="space-y-4 rounded-xl border border-border/60 bg-secondary/20 p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
                  <Building2 className="size-6" />
                </span>
                <div className="min-w-0">
                  <div className="text-base font-bold leading-tight">
                    {pairing.vendorName}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="rounded-full bg-background px-2 py-0.5 font-mono">
                      {pairing.pairingCode}
                    </span>
                    <span>·</span>
                    <span>dipasangkan {formatMoment(pairing.pairedAt)}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    oleh {pairing.pairedByName}
                  </div>
                </div>
              </div>

              <div className="space-y-2 rounded-lg border border-border/60 bg-background/70 p-3 text-sm">
                <div className="flex items-center gap-2">
                  {pairing.contactKind === "email" ? (
                    <Mail className="size-3.5 shrink-0 text-primary" />
                  ) : (
                    <MessageCircle className="size-3.5 shrink-0 text-primary" />
                  )}
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {MARKETPLACE_CONTACT_LABELS[pairing.contactKind]}
                  </span>
                  <span className="ml-auto font-mono text-xs">
                    {pairing.contactMasked}
                  </span>
                </div>
                <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  {pairing.contactVerified ? (
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  ) : (
                    <Link2 className="mt-0.5 size-3.5 shrink-0 text-accent" />
                  )}
                  <span>{marketplaceContactSentence(pairing)}</span>
                </div>
              </div>

              <div className="rounded-lg border border-dashed border-border/70 p-3">
                <div className="text-xs font-medium text-muted-foreground">
                  Yang disalin ke marketplace
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {MARKETPLACE_SYNC_ENTITIES.map((entity) => {
                    const Icon = ENTITY_ICON[entity.key];
                    return (
                      <div key={entity.key} className="flex items-start gap-2">
                        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                          <Icon className="size-3.5" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-medium">{entity.label}</div>
                          <div className="text-[11px] leading-snug text-muted-foreground">
                            {entity.detail}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {!canPair ? (
                <p className="flex items-start gap-1.5 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                  Hanya pemilik yang bisa menyinkronkan, mengganti kontak, atau
                  melepas pairing ini.
                </p>
              ) : confirmUnpair ? (
                <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <p className="text-xs text-destructive">
                    Lepas pairing dengan {pairing.vendorName}? Tautan snapshot
                    yang sudah diberikan ke marketplace langsung berhenti
                    bekerja.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-2 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={busy !== null}
                      onClick={() => void lepas()}
                    >
                      {busy === "unpair" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Unplug className="size-4" />
                      )}
                      Ya, lepas pairing
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() => setConfirmUnpair(false)}
                    >
                      Batal
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  disabled={busy !== null}
                  onClick={() => {
                    setConfirmUnpair(true);
                    setError(null);
                    setNotice(null);
                  }}
                >
                  <Unplug className="size-4" />
                  Lepas pairing
                </Button>
              )}
            </div>

            {/* Sinkronisasi */}
            <div className="space-y-4 rounded-xl border border-border/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <RefreshCw className="size-4 text-primary" />
                    Sinkronisasi data
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    POS sumber utama. Marketplace menarik salinannya; tidak ada
                    perubahan harga/stok yang dikirim balik ke sini.
                  </p>
                </div>
                {pairing.lastSyncStatus && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 gap-1 text-[10px]",
                      SYNC_TONE[pairing.lastSyncStatus],
                    )}
                  >
                    {SYNC_LABEL[pairing.lastSyncStatus]}
                  </Badge>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">
                    Terakhir ditarik marketplace
                  </div>
                  <div
                    data-testid="marketplace-last-pull"
                    className="mt-0.5 text-sm font-medium"
                  >
                    {formatMoment(pairing.lastPullAt)}
                  </div>
                  {pairing.lastPullCounts && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {pairing.lastPullCounts.products} produk ·{" "}
                      {pairing.lastPullCounts.sales} penjualan ·{" "}
                      {pairing.lastPullCounts.purchases} penerimaan ·{" "}
                      {pairing.lastPullCounts.payables} hutang
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">
                    Tombol sinkron terakhir
                  </div>
                  <div className="mt-0.5 text-sm font-medium">
                    {formatMoment(pairing.lastSyncAt)}
                  </div>
                  {pairing.lastSyncNote && (
                    <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                      {pairing.lastSyncNote}
                    </div>
                  )}
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {marketplacePullSentence(pairing)}
              </p>

              {canPair ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label
                      htmlFor="marketplace-snapshot-url"
                      className="text-xs font-medium"
                    >
                      Tautan snapshot untuk marketplace
                    </Label>
                    <button
                      type="button"
                      className="text-[11px] text-primary underline-offset-2 hover:underline"
                      onClick={() => setShowToken((value) => !value)}
                    >
                      {showToken ? "Sembunyikan token" : "Tampilkan token"}
                    </button>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="marketplace-snapshot-url"
                      readOnly
                      data-testid="marketplace-snapshot-url"
                      value={showToken ? (snapshotUrl ?? "") : hiddenSnapshotUrl}
                      className="font-mono text-[11px]"
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={!snapshotUrl}
                        onClick={() => void salin()}
                      >
                        {copied ? (
                          <Check className="size-4 text-primary" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                        {copied ? "Tersalin" : "Salin"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="gap-2"
                        disabled={busy !== null}
                        onClick={() => void sinkron()}
                      >
                        {busy === "sync" ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RefreshCw className="size-4" />
                        )}
                        Sinkronkan
                      </Button>
                    </div>
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Tempel tautan ini di sisi marketplace. Tautan memuat token
                    rahasia — jangan dibagikan ke publik. Setiap tarikan tercatat
                    di kartu ini, termasuk jumlah baris yang diambil.
                  </p>

                  <div
                    data-testid="marketplace-catalog-import"
                    className="space-y-2 rounded-lg border border-dashed border-border/60 bg-background/40 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-semibold">
                          <CloudDownload className="size-3.5 text-primary" />
                          Katalog dari marketplace
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                          Kategori, subkategori, dan produk ditarik dari vendor
                          yang dipasangkan. Produk dicocokkan per SKU: yang belum
                          ada dibuat, yang sudah ada diperbarui
                          nama/harga/satuan/kategorinya. Jumlah stok ikut
                          disalin ke lokasi jual toko utama; harga modal tetap
                          milik POS.
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0 gap-2"
                        data-testid="marketplace-import-catalog"
                        disabled={busy !== null}
                        onClick={() => void imporKatalog()}
                      >
                        {busy === "catalog" ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <CloudDownload className="size-4" />
                        )}
                        Impor katalog
                      </Button>
                    </div>

                    <div className="text-[11px] text-muted-foreground">
                      Terakhir diimpor:{" "}
                      <span className="font-medium text-foreground">
                        {formatMoment(pairing.lastCatalogAt)}
                      </span>
                      {pairing.lastCatalogCounts && (
                        <>
                          {" · "}
                          {pairing.lastCatalogCounts.created} dibuat{" · "}
                          {pairing.lastCatalogCounts.updated} diperbarui{" · "}
                          {pairing.lastCatalogCounts.categories} kategori{" · "}
                          {pairing.lastCatalogCounts.subcategories} subkategori
                          {" · "}
                          {pairing.lastCatalogCounts.stock} stok{" · "}
                          {pairing.lastCatalogCounts.barcodes} barcode/QR
                        </>
                      )}
                    </div>
                    {pairing.lastCatalogNote && (
                      <p
                        data-testid="marketplace-catalog-import-note"
                        className="text-[11px] leading-relaxed text-muted-foreground"
                      >
                        {pairing.lastCatalogNote}
                      </p>
                    )}
                  </div>

                  <div
                    data-testid="marketplace-barcode-sync"
                    className="space-y-1.5 rounded-lg border border-dashed border-border/60 bg-background/40 p-3"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <QrCode className="size-3.5 text-primary" />
                      Barcode/QR otomatis
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Sekali sehari kode dari marketplace disalin ke kolom
                      barcode/QR produk yang SKU-nya cocok — hanya kolom itu,
                      tanpa mengubah nama, harga, stok, atau gambar.
                    </p>
                    <div className="text-[11px] text-muted-foreground">
                      Terakhir otomatis:{" "}
                      <span className="font-medium text-foreground">
                        {formatMoment(pairing.lastBarcodeSyncAt ?? null)}
                      </span>
                    </div>
                    <p
                      data-testid="marketplace-barcode-sync-note"
                      className="text-[11px] leading-relaxed text-muted-foreground"
                    >
                      {marketplaceBarcodeSyncSentence(pairing)}
                    </p>
                  </div>

                  <div
                    data-testid="marketplace-stock-sync"
                    className="space-y-1.5 rounded-lg border border-dashed border-border/60 bg-background/40 p-3"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <Zap className="size-3.5 text-primary" />
                      Stok otomatis sesudah transaksi
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {marketplace.pushEndpointReady
                        ? "Setiap penjualan, pembatalan, penerimaan barang, opname, dan penyesuaian stok mengirim SKU yang berubah ke marketplace ± 2 detik kemudian. Kasir tidak menunggu jaringan, dan satu nota menjadi satu kiriman."
                        : "Perubahan stok belum bisa berangkat sendiri: endpoint dorong marketplace belum diisi di server. Isi PUSATBAHANBANGUNAN_STOCK_URL (atau PUSATBAHANBANGUNAN_PRODUCTS_URL); tanpa itu stok di marketplace baru berubah saat ditarik atau lewat tombol Sinkronkan produk."}
                    </p>
                    <div className="text-[11px] text-muted-foreground">
                      Terakhir otomatis:{" "}
                      <span className="font-medium text-foreground">
                        {formatMoment(pairing.lastStockSyncAt ?? null)}
                      </span>
                      {pairing.lastStockSyncCounts && (
                        <>
                          {" · "}
                          {pairing.lastStockSyncCounts.products} produk
                        </>
                      )}
                    </div>
                    <p
                      data-testid="marketplace-stock-sync-note"
                      className={cn(
                        "text-[11px] leading-relaxed",
                        pairing.lastStockSyncStatus === "failed"
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {marketplaceStockSyncSentence(pairing)}
                    </p>
                  </div>

                  <div
                    data-testid="marketplace-sales-sync"
                    className="space-y-1.5 rounded-lg border border-dashed border-border/60 bg-background/40 p-3"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <ReceiptText className="size-3.5 text-primary" />
                      Penjualan otomatis ke marketplace
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {marketplace.salesPushEndpointReady
                        ? "Setiap nota selesai dan pembatalan dikirim ke marketplace ± 2 detik kemudian, lengkap dengan item, total, metode bayar, dan stok terbaru SKU-nya. Satu nota menjadi satu kiriman; upsert per nomor nota mencegah penjualan ganda saat percobaan ulang."
                        : "Nota belum bisa berangkat sendiri: endpoint dorong penjualan belum diisi di server. Isi PUSATBAHANBANGUNAN_SALES_URL (atau PUSATBAHANBANGUNAN_STOCK_URL); tanpa itu marketplace baru tahu penjualannya saat menarik snapshot."}
                    </p>
                    <div className="text-[11px] text-muted-foreground">
                      Terakhir otomatis:{" "}
                      <span className="font-medium text-foreground">
                        {formatMoment(pairing.lastSalesSyncAt ?? null)}
                      </span>
                      {pairing.lastSalesSyncCounts && (
                        <>
                          {" · "}
                          {pairing.lastSalesSyncCounts.sales} nota{" · "}
                          {pairing.lastSalesSyncCounts.items} item{" · "}
                          {pairing.lastSalesSyncCounts.stock} SKU stok
                        </>
                      )}
                    </div>
                    <p
                      data-testid="marketplace-sales-sync-note"
                      className={cn(
                        "text-[11px] leading-relaxed",
                        pairing.lastSalesSyncStatus === "failed"
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {marketplaceSalesSyncSentence(pairing)}
                    </p>
                  </div>

                  {marketplace.inbound && (
                    <div
                      data-testid="marketplace-inbound-orders"
                      className="space-y-2 rounded-lg border border-dashed border-border/60 bg-background/40 p-3"
                    >
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        <Inbox className="size-3.5 text-primary" />
                        Pesanan dari marketplace
                      </div>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        Penjualan yang terjadi di marketplace dicatat sebagai
                        penjualan MesinPOS: stok lokasi jual berkurang, nota terbit,
                        dan harga, PPN, serta diskon dihitung server. Marketplace
                        mengirim pesanan lunas lewat alamat di bawah, atau lewat
                        <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[10.5px] text-foreground">
                          POST /api/v1/sales
                        </code>{" "}
                        yang sudah dipakai — kedua jalur dikenali sebagai pesanan yang
                        sama, jadi tidak ada nota atau pengurangan stok kedua.
                      </p>
                      {marketplace.inbound.url ? (
                        <Input
                          readOnly
                          data-testid="marketplace-inbound-url"
                          value={marketplace.inbound.url}
                          className="font-mono text-[11px]"
                          onFocus={(event) => event.currentTarget.select()}
                        />
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          Alamat penerimaan belum terbaca dari server
                          (CONVEX_SITE_URL kosong), jadi marketplace belum punya
                          tujuan untuk mengirim pesanan.
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        Event diterima:{" "}
                        <span className="font-medium text-foreground">
                          {marketplace.inbound.events.join(" · ")}
                        </span>{" "}
                        · header{" "}
                        <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[10.5px] text-foreground">
                          Authorization: Bearer &lt;token pairing&gt;
                        </code>
                      </p>
                      {marketplace.inbound.sales.length > 0 && (
                        <ul className="space-y-1">
                          {marketplace.inbound.sales.map((row) => (
                            <li
                              key={`${row.number}-${row.at}`}
                              data-testid="marketplace-inbound-sale"
                              className="flex flex-wrap items-center justify-between gap-1 rounded-md border border-border/50 bg-background/60 px-2 py-1 text-[11px]"
                            >
                              <span className="font-medium">
                                Nota {row.number}
                                {row.status === "void" ? " (dibatalkan)" : ""}
                              </span>
                              <span className="text-muted-foreground">
                                {formatRupiah(row.total)}
                                {" · "}
                                {formatMoment(row.at)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {marketplace.inbound.orders.length > 0 && (
                        <ul className="space-y-1">
                          {marketplace.inbound.orders.map((row) => (
                            <li
                              key={`${row.orderId}-${row.at}`}
                              data-testid="marketplace-inbound-row"
                              className="flex flex-wrap items-center justify-between gap-1 rounded-md border border-border/50 bg-background/60 px-2 py-1 text-[11px]"
                            >
                              <span className="min-w-0 truncate font-medium">
                                {row.orderId}
                              </span>
                              <span className="text-muted-foreground">
                                {row.saleNumber
                                  ? `nota ${row.saleNumber}`
                                  : row.event}
                                {" · "}
                                {row.status === "applied"
                                  ? "diterima"
                                  : row.status === "duplicate"
                                    ? "kiriman ulang"
                                    : "ditolak"}
                                {" · "}
                                {formatMoment(row.at)}
                              </span>
                              {row.status === "rejected" && row.message && (
                                <span className="w-full text-[10.5px] leading-relaxed text-destructive">
                                  {row.message}
                                </span>
                              )}
                              {row.status === "rejected" && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  data-testid="marketplace-inbound-retry"
                                  className="h-6 gap-1 px-1.5 text-[10.5px]"
                                  disabled={retrying === row.orderId}
                                  title="Perbaiki dulu produknya (SKU/nama), lalu catat ulang pesanan yang tersimpan ini — tanpa menunggu marketplace mengirim lagi."
                                  onClick={() => void catatUlangPesanan(row.orderId)}
                                >
                                  {retrying === row.orderId ? (
                                    <Loader2 className="size-3 animate-spin" />
                                  ) : (
                                    <RefreshCw className="size-3" />
                                  )}
                                  Catat ulang
                                </Button>
                              )}
                              {row.status === "rejected" && (
                                <span className="w-full text-[10px] leading-relaxed text-muted-foreground">
                                  Perbaiki dulu produknya — daftarkan SKU atau
                                  samakan namanya — lalu catat ulang di sini.
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      <p
                        data-testid="marketplace-inbound-note"
                        className={cn(
                          "text-[11px] leading-relaxed",
                          marketplace.inbound.orders[0]?.status === "rejected"
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {marketplaceInboundSentence(marketplace.inbound)}{" "}
                        Marketplace hanya mengirim pesanan yang sudah{" "}
                        <strong className="font-semibold text-foreground">lunas</strong>{" "}
                        dan hanya selama integrasinya tidak dijeda. Pesanan yang tertahan
                        beserta sebabnya terlihat di marketplace → Integrasi POS →
                        “Pesanan lunas yang belum masuk MesinPOS”; penolakan lewat
                        <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[10.5px] text-foreground">
                          POST /api/v1/sales
                        </code>{" "}
                        kini ikut tercatat di daftar di atas, jadi sebabnya juga
                        terbaca dari MesinPOS.
                      </p>
                    </div>
                  )}

                  <div
                    data-testid="marketplace-stock-reconcile"
                    className="space-y-2 rounded-lg border border-dashed border-border/60 bg-background/40 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-semibold">
                          <ArrowRightLeft className="size-3.5 text-primary" />
                          Selisih stok per SKU
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                          Saldo lokasi jual di MesinPOS dibandingkan dengan
                          katalog vendor di marketplace — otomatis sekali sehari,
                          dan bisa diperiksa lebih awal dari tombol ini.
                          Pemeriksaannya sendiri{" "}
                          <strong>tidak mengubah stok siapa pun</strong>. Kalau
                          angka POS yang ingin dipakai, tekan{" "}
                          <strong>Kirim stok</strong> atau{" "}
                          <strong>Tarik angka</strong>: keduanya bekerja pada SKU
                          yang saldonya berbeda saja, bukan seluruh katalog.{" "}
                          <em>Kirim</em> menulis saldo POS ke marketplace;{" "}
                          <em>Tarik</em> menyalin angka marketplace ke POS dan
                          mencatat selisihnya sebagai pergerakan{" "}
                          <code>adjustment</code> agar bisa diaudit.
                        </p>
                      </div>
                      {canPair && (
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            data-testid="marketplace-reconcile-now"
                            disabled={busy !== null}
                            onClick={() => void periksaSelisih()}
                          >
                            {busy === "reconcile" ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <ArrowRightLeft className="size-4" />
                            )}
                            Periksa sekarang
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="gap-2"
                            data-testid="marketplace-push-stock-diffs"
                            disabled={
                              busy !== null ||
                              pushableDiffs.length === 0 ||
                              marketplace.pushEndpointReady === false
                            }
                            title={
                              marketplace.pushEndpointReady === false
                                ? "Endpoint dorong stok belum diisi di server, jadi saldo tidak bisa dikirim."
                                : pushableDiffs.length === 0
                                  ? "Tidak ada SKU dengan saldo berbeda untuk dikirim."
                                  : "Mengirim saldo lokasi jual MesinPOS hanya untuk SKU yang saldonya berbeda."
                            }
                            onClick={() => void kirimSelisih()}
                          >
                            {busy === "pushDiffs" ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Upload className="size-4" />
                            )}
                            {pushableDiffs.length > 0
                              ? `Kirim stok ${pushableDiffs.length} SKU`
                              : "Kirim stok SKU"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            data-testid="marketplace-pull-stock-diffs"
                            disabled={busy !== null || pushableDiffs.length === 0}
                            title={
                              pushableDiffs.length === 0
                                ? "Tidak ada SKU dengan saldo berbeda untuk ditarik."
                                : "Menarik angka terbaru dari katalog marketplace ke saldo lokasi jual POS, hanya untuk SKU yang saldonya berbeda."
                            }
                            onClick={() => void tarikSelisih()}
                          >
                            {busy === "pullDiffs" ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <CloudDownload className="size-4" />
                            )}
                            {pushableDiffs.length > 0
                              ? `Tarik angka ${pushableDiffs.length} SKU`
                              : "Tarik angka SKU"}
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="text-[11px] text-muted-foreground">
                      Terakhir diperiksa:{" "}
                      <span className="font-medium text-foreground">
                        {formatMoment(pairing.lastReconcileAt ?? null)}
                      </span>
                      {pairing.lastReconcileCounts && (
                        <>
                          {" · "}
                          {pairing.lastReconcileCounts.matched} SKU sama{" · "}
                          {pairing.lastReconcileCounts.differing} beda{" · "}
                          {pairing.lastReconcileCounts.posOnly} hanya di POS
                          {" · "}
                          {pairing.lastReconcileCounts.marketplaceOnly} hanya di
                          marketplace
                        </>
                      )}
                    </div>
                    <p
                      data-testid="marketplace-reconcile-note"
                      className={cn(
                        "text-[11px] leading-relaxed",
                        pairing.lastReconcileStatus === "failed"
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {marketplaceReconcileSentence(pairing)}
                    </p>

                    {stockDiffs.length > 0 && (
                      <div className="overflow-x-auto rounded-md border border-border/60">
                        <table
                          data-testid="marketplace-stock-diff-table"
                          className="w-full min-w-[30rem] text-[11px]"
                        >
                          <thead className="bg-secondary/40 text-left text-muted-foreground">
                            <tr>
                              <th className="px-2 py-1.5 font-medium">SKU</th>
                              <th className="px-2 py-1.5 font-medium">Produk</th>
                              <th className="px-2 py-1.5 text-right font-medium">
                                MesinPOS
                              </th>
                              <th className="px-2 py-1.5 text-right font-medium">
                                Marketplace
                              </th>
                              <th className="px-2 py-1.5 text-right font-medium">
                                Selisih
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {stockDiffs.map((row) => (
                              <tr
                                key={row.sku}
                                className="border-t border-border/40 align-top"
                              >
                                <td className="px-2 py-1.5 font-mono text-[10px]">
                                  {row.sku}
                                </td>
                                <td className="px-2 py-1.5">
                                  {row.name}
                                  <span className="block text-[10px] text-muted-foreground">
                                    {MARKETPLACE_STOCK_DIFF_LABELS[row.kind]}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums">
                                  {row.posStock ?? "—"}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums">
                                  {row.marketplaceStock ?? "—"}
                                </td>
                                <td
                                  className={cn(
                                    "px-2 py-1.5 text-right font-medium tabular-nums",
                                    row.delta === null
                                      ? "text-muted-foreground"
                                      : row.delta < 0
                                        ? "text-destructive"
                                        : "text-primary",
                                  )}
                                >
                                  {row.delta === null
                                    ? "—"
                                    : `${row.delta > 0 ? "+" : ""}${row.delta}`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div
                    data-testid="marketplace-push-secret"
                    className="space-y-2 rounded-lg border border-border/60 bg-secondary/20 p-3"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <ShieldCheck className="size-3.5 text-primary" />
                      Rahasia penanda tangan marketplace
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Marketplace menolak kiriman tanpa tanda tangan. Isi rahasia
                      yang <strong>sama persis</strong> dengan “rahasia endpoint” di
                      Pengaturan marketplace; setiap dorongan katalog, stok, dan
                      penjualan ditandatangani dengan rahasia ini
                      (<code>x-mesinpos-signature</code>).
                      {pairing.pushSecretSet
                        ? ` Tersimpan: ••••${pairing.pushSecretLastFour ?? "????"}.`
                        : " Belum diisi — kiriman hanya membawa token pairing."}
                    </p>
                    {canPair && (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          type="password"
                          value={pushSecret}
                          onChange={(event) => setPushSecret(event.target.value)}
                          placeholder="Rahasia dari Pengaturan marketplace"
                          autoComplete="off"
                          data-testid="marketplace-push-secret-input"
                        />
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={busy !== null || pushSecret.trim().length < 16}
                            onClick={() => void savePushSecret(false)}
                          >
                            {busy === "secret" ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              "Simpan rahasia"
                            )}
                          </Button>
                          {pairing.pushSecretSet && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy !== null}
                              onClick={() => void savePushSecret(true)}
                            >
                              Hapus
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div
                    data-testid="marketplace-product-sync"
                    className="space-y-2 rounded-lg border border-border/60 bg-secondary/20 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-semibold">
                          <Package className="size-3.5 text-primary" />
                          Katalog, kategori & gambar produk
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                          Seluruh field produk — barcode/QR kasir, harga, modal,
                          satuan, stok, harga bertingkat, konversi satuan,
                          modifier — beserta gambarnya dikirim sebagai upsert per
                          SKU. Produk,
                          kategori, dan field yang belum ada di platform dibuat
                          mengikuti sumbernya, bukan ditolak.
                        </p>
                        <p
                          data-testid="marketplace-category-sync-note"
                          className="mt-1 text-[11px] leading-relaxed text-muted-foreground"
                        >
                          Pohon kategori + subkategori ikut di setiap kiriman
                          katalog. Di data tersambung, setiap perubahan di
                          halaman Produk &amp; Stok dikirim sendiri sesudah
                          disimpan — tidak perlu menunggu tombol ini; di mode
                          demo alurnya hanya disimulasikan.
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="shrink-0 gap-2"
                        data-testid="marketplace-sync-products"
                        disabled={busy !== null}
                        onClick={() => void sinkronProduk()}
                      >
                        {busy === "products" ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Package className="size-4" />
                        )}
                        Sinkronkan produk
                      </Button>
                    </div>

                    <div className="text-[11px] text-muted-foreground">
                      Terakhir dikirim:{" "}
                      <span className="font-medium text-foreground">
                        {formatMoment(pairing.lastProductSyncAt)}
                      </span>
                      {pairing.lastProductSyncCounts && (
                        <>
                          {" · "}
                          {pairing.lastProductSyncCounts.products} produk
                          {pairing.lastProductSyncStatus === "delivered" && (
                            <>
                              {" · "}
                              {pairing.lastProductSyncCounts.created} dibuat{" · "}
                              {pairing.lastProductSyncCounts.updated} diperbarui
                              {" · "}
                              {pairing.lastProductSyncCounts.fieldsCreated} field
                              baru
                            </>
                          )}
                        </>
                      )}
                    </div>
                    {pairing.lastProductSyncNote && (
                      <p
                        data-testid="marketplace-product-sync-note"
                        className="text-[11px] leading-relaxed text-muted-foreground"
                      >
                        {pairing.lastProductSyncNote}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
                  Tautan snapshot beserta tokennya hanya ditampilkan kepada
                  pemilik workspace.
                </p>
              )}
            </div>
          </div>
        ) : marketplace.loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-secondary/20 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-primary" />
            Memuat status pairing marketplace…
          </div>
        ) : !canPair ? (
          <div
            data-testid="marketplace-owner-only"
            className="flex items-start gap-3 rounded-xl border border-border/60 bg-secondary/20 p-4"
          >
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Pairing dilakukan pemilik</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {marketplace.pairBlockedReason ??
                  "Peran Anda bisa membaca status pairing, tetapi yang boleh mengikat identitas bisnis ke akun marketplace adalah pemilik."}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Langkah 1: cari vendor */}
            <div className="rounded-xl border border-border/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="grid size-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                      1
                    </span>
                    Cari vendor Anda
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Masukkan email atau nomor WA yang terdaftar di
                    pusatbahanbangunan.com. Yang ditampilkan di langkah 2 hanya
                    vendor yang terkait dengan kontak itu. Kalau kontak Anda
                    belum cocok dengan vendor mana pun, direktori toko dibuka
                    otomatis supaya Anda tetap bisa memilih toko sendiri.
                  </p>
                </div>
                <div className="inline-flex rounded-lg border border-border/60 p-0.5">
                  {MARKETPLACE_CONTACT_KINDS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={kind === option}
                      onClick={() => {
                        setKind(option);
                        setVendors([]);
                        setLookupMode(null);
                        setLookupNote(null);
                        setDirectoryFallback(false);
                        setSelectedId(null);
                        setVerifiedVendorId(null);
                        setError(null);
                      }}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        kind === option
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option === "email" ? (
                        <Mail className="size-3.5" />
                      ) : (
                        <MessageCircle className="size-3.5" />
                      )}
                      {MARKETPLACE_CONTACT_LABELS[option]}
                    </button>
                  ))}
                </div>
              </div>

              <form
                className="mt-4 flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void cari(query);
                }}
              >
                <Input
                  id="marketplace-vendor-query"
                  data-testid="marketplace-vendor-query"
                  value={query}
                  autoComplete="off"
                  placeholder={MARKETPLACE_CONTACT_PLACEHOLDERS[kind]}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setError(null);
                    setNotice(null);
                  }}
                />
                <Button
                  type="submit"
                  className="gap-2"
                  disabled={busy !== null}
                >
                  {busy === "lookup" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Search className="size-4" />
                  )}
                  Cari vendor
                </Button>
              </form>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {MARKETPLACE_CONTACT_HINTS[kind]}
              </p>
              <p
                data-testid="marketplace-lookup-dependency"
                className="mt-2 rounded-lg bg-secondary/40 px-3 py-2 text-[11px] text-muted-foreground"
              >
                Pencocokan kontak memakai endpoint pencocokan milik
                pusatbahanbangunan.com. Kalau endpoint itu belum aktif atau
                kontaknya belum terdaftar, direktori toko dibuka otomatis
                sesudah pencarian supaya Anda tetap bisa memilih toko —
                kontaknya dicatat sebagai klaim pemilik sampai marketplace
                mencocokkannya.
              </p>

              {lookupNote && (
                <p
                  data-testid="marketplace-lookup-note"
                  className="mt-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-foreground"
                >
                  {lookupNote}
                </p>
              )}
            </div>

            {/* Hasil direktori */}
            <div className="rounded-xl border border-border/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="grid size-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                    2
                  </span>
                  Pilih toko
                </div>
                <div className="flex items-center gap-2">
                  {lookupMode !== null && (
                    <span className="text-xs text-muted-foreground">
                      {vendors.length} vendor
                      {lookupMode === "contact" ? " cocok" : " di direktori"}
                    </span>
                  )}
                  {lookupMode !== null && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="gap-1.5"
                      disabled={busy !== null}
                      onClick={() =>
                        void cari(
                          lookupMode === "directory" ? "" : query,
                          lookupMode,
                        )
                      }
                    >
                      <RefreshCw className="size-3.5" />
                      Muat ulang
                    </Button>
                  )}
                </div>
              </div>

              {directoryFallback && vendors.length > 0 && (
                <p
                  data-testid="marketplace-directory-fallback"
                  className="mt-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent-foreground"
                >
                  Direktori dibuka otomatis karena kontak belum cocok dengan
                  vendor mana pun. Pilih toko Anda di bawah, lalu konfirmasi
                  kontaknya di langkah 3.
                </p>
              )}

              {vendors.length === 0 ? (
                <div className="mt-3 rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                  <p>
                    {busy === "lookup"
                      ? "Mencari vendor yang terkait dengan kontak Anda…"
                      : lookupMode === null
                        ? "Belum ada toko yang ditampilkan. Masukkan email atau nomor WA di langkah 1, lalu tekan “Cari vendor” — hanya vendor yang terkait dengan kontak itu yang muncul di sini."
                        : lookupMode === "contact"
                          ? "Belum ada vendor yang terkait dengan kontak itu. Periksa ejaan email/WA-nya, atau pilih toko Anda sendiri lewat direktori."
                          : "Direktori belum bisa dimuat. Tekan “Muat ulang” untuk mencoba lagi, atau periksa sambungan Anda."}
                  </p>
                  {busy !== "lookup" && lookupMode !== "directory" && (
                    <div className="mt-3 flex flex-col items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={busy !== null}
                        onClick={() => void cari("", "directory")}
                      >
                        <Store className="size-3.5" />
                        Tampilkan direktori toko
                      </Button>
                      <span className="text-[11px]">
                        Direktori hanya dibuka kalau Anda memintanya; isinya
                        tidak dicocokkan otomatis dengan kontak.
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div
                  data-testid="marketplace-vendors"
                  className="mt-3 max-h-[19rem] space-y-2 overflow-y-auto pr-1"
                >
                  {vendors.map((vendor) => {
                    const selected = vendor.id === selectedId;
                    return (
                      <button
                        key={vendor.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setSelectedId(vendor.id);
                          setError(null);
                        }}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                          selected
                            ? "border-primary/60 bg-primary/10 ring-1 ring-primary/25"
                            : "border-border/60 hover:border-primary/30 hover:bg-secondary/30",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full",
                            selected
                              ? "bg-primary text-primary-foreground"
                              : "bg-secondary text-muted-foreground",
                          )}
                        >
                          {selected ? (
                            <Check className="size-4" />
                          ) : (
                            <Store className="size-4" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-semibold">
                              {vendor.name}
                            </span>
                            {verifiedVendorId === vendor.id && (
                              <Badge
                                variant="default"
                                className="gap-1 px-1.5 py-0 text-[10px]"
                              >
                                <BadgeCheck className="size-3" />
                                Cocok kontak
                              </Badge>
                            )}
                          </span>
                          <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                            {vendor.city && <span>{vendor.city}</span>}
                            <span>{vendor.productCount} produk</span>
                            {vendor.joinedAt > 0 && (
                              <span>
                                bergabung{" "}
                                {new Date(vendor.joinedAt).toLocaleDateString(
                                  "id-ID",
                                  { month: "short", year: "numeric" },
                                )}
                              </span>
                            )}
                          </span>
                          {vendor.description && (
                            <span className="mt-1 line-clamp-1 block text-[11px] text-muted-foreground">
                              {vendor.description}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Langkah 3: kontak owner */}
            <div className="rounded-xl border border-border/60 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="grid size-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                  3
                </span>
                Konfirmasi kontak owner
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="marketplace-contact">
                    {MARKETPLACE_CONTACT_LABELS[kind]} terdaftar di marketplace
                  </Label>
                  <Input
                    id="marketplace-contact"
                    data-testid="marketplace-contact"
                    value={contact}
                    autoComplete="off"
                    placeholder={MARKETPLACE_CONTACT_PLACEHOLDERS[kind]}
                    onChange={(event) => {
                      setContact(event.target.value);
                      setVerifiedVendorId(null);
                      setError(null);
                    }}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {matched
                      ? "Marketplace sudah mencocokkan kontak ini dengan vendor yang dipilih."
                      : "Kontak disimpan sebagai identitas owner bisnis. Hanya pemilik yang bisa menyelesaikan langkah ini."}
                  </p>
                </div>
                <Button
                  type="button"
                  className="gap-2"
                  disabled={busy !== null || selectedId === null}
                  onClick={() => void pasang()}
                >
                  {busy === "pair" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Link2 className="size-4" />
                  )}
                  Pasangkan vendor
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                Pairing mengikat workspace ini ke <strong>satu</strong> vendor.
                Kalau bisnis Anda punya beberapa toko, buat satu workspace per
                toko — data dan izinnya tidak tercampur.
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  ChefHat,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Landmark,
  ListPlus,
  Lock,
  Pencil,
  Plus,
  Power,
  Printer,
  QrCode,
  RefreshCw,
  Timer,
  Wallet,
  Trash2,
  UtensilsCrossed,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QrCodeImage } from "@/components/QrCodeImage";
import { Link } from "react-router-dom";
import { isAwaitingPayment, mejaMenuUrl } from "@/lib/meja";
import { playKdsAlertBeep, scanBeepVolumeLabel } from "@/lib/scanBeep";
import { useScanBeep } from "@/lib/useScanBeep";
import { entitlementFor, isFeatureEnabled } from "@/lib/billing";
import { featureUnavailableReason } from "@/lib/store/modules";
import { modifierSummary } from "@/lib/modifiers";
import {
  KDS_ALERT_FLASH_MS,
  KDS_ATTENTION_MINUTES,
  MAX_TABLE_IMPORT_ROWS,
  isKdsAlertFlashing,
  kdsAlertLabel,
  planKdsAlert,
  planTableImport,
  TABLE_IMPORT_EXAMPLE,
  tableLabel,
  tableStates,
  ticketPaymentLabel,
  ticketSummary,
  ticketTableHolders,
  type TableState,
} from "@/lib/fnb";
import { useSession } from "@/lib/session";
import { useStore } from "@/lib/store";
import { useCan } from "@/lib/usePermission";
import { cn } from "@/lib/utils";
import type { StoreTableDeletionCheck } from "@/lib/store/types";

/**
 * Tagihan QR yang sudah pernah **diberitahukan** layar ini (bunyi + kilat).
 * Hidup di tingkat modul, bukan di dalam komponen, karena tagihan yang sama tidak
 * boleh berbunyi dua kali hanya karena kasir sempat membuka halaman Pembayaran
 * lalu kembali ke Dapur & Meja. Umurnya sepanjang halaman ini hidup — satu kali
 * muat ulang halaman berarti satu penilaian baru terhadap tagihan yang masih
 * menunggu, dan penilaian itu pun dibatasi `KDS_ALERT_WINDOW_MS`.
 */
const announcedBills = new Set<string>();

/**
 * Dialog denah meja yang sedang terbuka: **ubah** identitas mejanya, atau
 * **hapus** dengan pagar hapusnya. Dipisah karena keduanya meminta hal berbeda:
 * yang pertama cukup mengisi kolomnya, yang kedua harus lebih dulu membaca
 * pemakaian mejanya dari server (`tables.deletionCheck`) dan menampilkan
 * kalimatnya apa adanya.
 */
type TableDialog =
  | { kind: "edit"; tableId: string; name: string; seats: string; zone: string }
  | {
      kind: "delete";
      tableId: string;
      name: string;
      /** `null` = pagar hapusnya masih dibaca. */
      check: StoreTableDeletionCheck | null;
      error: string | null;
    };

/**
 * Dapur & Meja — alur F&B milik modul F&B (Phase 2).
 *
 * Dua panel yang memang satu alur: **antrean dapur** (paling lama menunggu di
 * depan) dan **denah meja**. Status meja tidak disimpan di mana pun — diturunkan
 * dari pesanan yang terbuka lewat `@/lib/fnb`, jadi menyelesaikan pesanan
 * otomatis mengosongkan mejanya.
 *
 * Antrean ini punya **dua sumber tiket**, dan keduanya pesanan yang memang harus
 * disiapkan dapur (`isKitchenTicket`):
 *
 *  - **penjualan lunas** yang dikirim ke dapur pada momen pembayarannya — kasir
 *    menagih uangnya (tunai, QRIS, atau VA), pesanannya berangkat ke dapur tanpa
 *    tombol kedua, dan struknya ditawarkan di layar yang sama. Tiket begini
 *    menunggu **sejak dikirim**, dan ditandai `settled`;
 *  - **pesanan tertahan** yang dikirim kasir lebih dulu (`holdSale`), termasuk
 *    pesanan QR meja yang tagihannya dilunasi tamunya (`meja.guestOrderPaid`).
 *
 * Bedanya hanya di tombol Selesai: tiket lunas ditandai beres (`kitchenDone`),
 * sedangkan pesanan tertahan **diselesaikan** di situ — stok baru bergerak pada
 * momen itu (`finalizeHeldSale`). Satu panggilan store untuk keduanya
 * (`finishKitchenTicket`) supaya server yang memutuskan, bukan tombolnya.
 *
 * Pesanan QR yang **belum** lunas tetap bukan antrean: layar ini hanya
 * menghitungnya dan mengarahkan kasir ke halaman Pembayaran. Tiket yang datang
 * dari QR meja ditandai kanal & momen pelunasannya (`ticketPaymentLabel`),
 * sedangkan tiket dari kasir ditandai metode bayarnya (`ticketPaidLabel`).
 *
 * Halaman ini bukan gerbangnya sendiri: server menolak `pos.kdsTickets` dan
 * `tables.*` saat modul F&B mati. Panel di bawah hanya menjelaskan keadaan itu.
 */
export function KdsPage() {
  const {
    tables,
    kdsTickets,
    finishKitchenTicket,
    createTable,
    updateTable,
    setTableActive,
    tableDeletionCheck,
    deleteTable,
    moveTable,
    importTables,
    issueTableMenuQr,
    mejaOrders,
    modules,
  } = useStore();
  const { session } = useSession();
  const can = useCan();

  const planKey = session?.tenant?.planKey ?? "starter";
  const entitlements = useMemo(() => entitlementFor(planKey), [planKey]);
  const kdsOn = isFeatureEnabled(entitlements, modules.activeVerticals, "pos.kds");
  // Alasan yang tepat: modul F&B belum dinyalakan, atau paketnya tidak memuat
  // KDS (Starter) — pengguna butuh tahu mana yang harus dibereskan.
  const kdsUnavailable = featureUnavailableReason(
    planKey,
    modules.activeVerticals,
    "pos.kds",
  );
  const tableOn = isFeatureEnabled(entitlements, modules.activeVerticals, "pos.table");

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", seats: "4", zone: "" });
  const [savingTable, setSavingTable] = useState(false);
  /** Kartu QR meja yang sedang ditampilkan (untuk dicetak/dibagikan). */
  const [qrTable, setQrTable] = useState<TableState | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrCopied, setQrCopied] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  /** Dialog ubah/hapus sebuah meja. */
  const [tableDialog, setTableDialog] = useState<TableDialog | null>(null);
  const [tableBusy, setTableBusy] = useState(false);
  /** Impor beberapa meja sekaligus (teks bebas, satu meja per baris). */
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const qrUrl =
    qrToken && typeof window !== "undefined"
      ? mejaMenuUrl(window.location.origin, qrToken)
      : "";

  /**
   * Membuka kartu QR sebuah meja. Tokennya diambil dari denah kalau sudah ada —
   * menerbitkan token baru setiap kali dibuka akan mematikan kartu yang sudah
   * tercetak (server memakai aturan yang sama: idempoten tanpa `rotate`).
   */
  async function openMenuQr(state: TableState) {
    setQrTable(state);
    setQrCopied(false);
    setQrError(null);
    setQrToken(state.menuToken ?? null);
    if (state.menuToken) return;

    setQrBusy(true);
    try {
      const result = await issueTableMenuQr(state.id);
      setQrToken(result.token);
    } catch (cause) {
      setQrError(cause instanceof Error ? cause.message : String(cause));
      setQrTable(null);
    } finally {
      setQrBusy(false);
    }
  }

  /** Ganti kode meja: kartu lama langsung tidak berlaku. */
  async function rotateMenuQr(state: TableState) {
    setQrBusy(true);
    setQrError(null);
    try {
      const result = await issueTableMenuQr(state.id, { rotate: true });
      setQrToken(result.token);
      setQrCopied(false);
    } catch (cause) {
      setQrError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setQrBusy(false);
    }
  }

  async function copyMenuQr() {
    if (!qrUrl) return;
    try {
      await navigator.clipboard?.writeText(qrUrl);
      setQrCopied(true);
    } catch {
      // Peramban yang menolak akses papan klip tetap bisa mencetak kartunya.
      setQrCopied(false);
    }
  }

  /**
   * Denah meja: aturan yang sama dengan server menurunkan statusnya.
   */
  const states = useMemo<TableState[]>(
    () =>
      // **Setiap** tiket dapur menahan mejanya, termasuk yang penjualannya sudah
      // lunas: meja baru bebas setelah dapur menekan Selesai. Itu aturan yang sama
      // dengan yang dipakai kasir (`ticketTableHolders`), jadi meja yang terkunci
      // di kasir tidak mungkin tampak kosong di sini.
      tableStates(tables, ticketTableHolders(kdsTickets)),
    [tables, kdsTickets],
  );

  const occupied = states.filter((state) => state.status === "occupied").length;
  const waitingItems = kdsTickets.reduce((sum, ticket) => sum + ticket.itemCount, 0);
  /** Berapa tiket yang penjualannya sudah dibayar — dapur perlu tahu bedanya. */
  const settledCount = kdsTickets.filter((ticket) => ticket.settled).length;
  /**
   * Pesanan QR yang sudah lunas, per penjualan — penanda "dibayar di meja"
   * beserta momen pelunasannya di kartu tiket dapur.
   */
  const paidQrBySale = useMemo(
    () =>
      new Map(
        mejaOrders
          .filter((order) => order.saleId && order.status === "paid")
          .map((order) => [order.saleId as string, order]),
      ),
    [mejaOrders],
  );
  /**
   * Pesanan QR yang masih menunggu pelunasan (`isAwaitingPayment`: niatnya masih
   * menunggu **dan** tagihannya masih bisa dibayar). **Bukan** antrean dapur:
   * layar ini hanya menyebut jumlahnya dan mengarahkan kasir ke halaman
   * Pembayaran — tagihan yang sudah dibatalkan/kedaluwarsa tidak dihitung lagi.
   */
  const pendingQrBills = useMemo(
    () =>
      mejaOrders
        .filter(isAwaitingPayment)
        .map((order) => ({ id: order.id, createdAt: order.createdAt })),
    [mejaOrders],
  );
  const pendingQrCount = pendingQrBills.length;

  /**
   * Notifikasi tagihan QR baru di layar dapur — dua hal, satu pemicu:
   *
   *  - **bunyi** (`playKdsAlertBeep`, nada yang berbeda dari bip kasir) supaya
   *    dapur yang tidak sedang menatap layar tetap tahu ada tamu menunggu;
   *  - **kilat** pada kartu antrean dapur (`KDS_ALERT_FLASH_MS`) supaya yang
   *    menatap layar melihat dari mana datangnya bunyi itu.
   *
   * Pemicunya satu: tagihan yang **belum pernah dilihat layar ini** dan masih
   * baru (`planKdsAlert`). Karena id-nya dicatat, render ulang tidak
   * membunyikan bip kedua untuk tagihan yang sama; karena umurnya dibatasi,
   * membuka layar di tengah hari tidak membunyikan alarm untuk tagihan yang sudah
   * lama menunggu. Bunyinya tetap tunduk pada setelan bunyi perangkat yang sama
   * dengan kasir — satu saklar, bukan dua.
   */
  const [qrAlert, setQrAlert] = useState<{ at: number; count: number } | null>(null);
  const beep = useScanBeep();

  useEffect(() => {
    const { freshIds, seenIds } = planKdsAlert(announcedBills, pendingQrBills);
    // Semua yang menunggu sekarang diingat — termasuk yang tidak baru — supaya
    // tagihan yang sama tidak pernah diberitahukan dua kali, juga setelah kasir
    // sempat berpindah halaman dan kembali ke layar ini.
    for (const id of seenIds) announcedBills.add(id);
    if (freshIds.length === 0) return;
    setQrAlert({ at: Date.now(), count: freshIds.length });
    playKdsAlertBeep();
  }, [pendingQrBills]);

  /**
   * Kilatnya padam sendiri: keadaannya dibuang setelah `KDS_ALERT_FLASH_MS`,
   * jadi tanda “baru” tidak berubah jadi warna permanen yang lama-lama tidak
   * berarti apa-apa lagi. Bunyinya sudah berbunyi sekali dan tidak diulang.
   */
  useEffect(() => {
    if (!qrAlert) return;
    const timer = setTimeout(() => setQrAlert(null), KDS_ALERT_FLASH_MS);
    return () => clearTimeout(timer);
  }, [qrAlert]);

  const qrFlashing = qrAlert !== null && isKdsAlertFlashing(qrAlert.at);

  async function finish(saleId: string) {
    setBusyId(saleId);
    setError(null);
    try {
      // Satu panggilan untuk kedua jenis tiket: server menyelesaikan penjualan
      // pesanan tertahan, dan hanya menandai beres tiket yang sudah lunas.
      await finishKitchenTicket(saleId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleTable(state: TableState) {
    setBusyId(state.id);
    setError(null);
    try {
      await setTableActive(state.id, !state.active);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function addTable() {
    setSavingTable(true);
    setError(null);
    try {
      await createTable({
        name: form.name,
        seats: Number(form.seats) || 0,
        zone: form.zone.trim() || undefined,
      });
      setForm({ name: "", seats: form.seats, zone: form.zone });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingTable(false);
    }
  }

  /**
   * Pratinjau impor dihitung dari **aturan yang sama** dengan yang dipakai
   * server (`planTableImport`), jadi yang terbaca pemilik sebelum menekan tombol
   * persis yang akan dijawab backend — termasuk kalimat penolakan bernomor baris.
   */
  const importPlan = useMemo(
    () => planTableImport(tables, importText),
    [tables, importText],
  );

  /** Menggeser meja satu langkah; urutan barunya ditentukan aturan bersama. */
  async function moveTableBy(state: TableState, step: -1 | 1) {
    setBusyId(state.id);
    setError(null);
    try {
      await moveTable(state.id, step);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  }

  /** Menjalankan impor: satu aksi untuk beberapa meja, satu laporan hasilnya. */
  async function runImport() {
    setImporting(true);
    setImportError(null);
    setImportNotice(null);
    try {
      const result = await importTables(importText);
      setImportText("");
      setImportNotice(
        `${result.created} meja ditambahkan di akhir denah: ${result.names.join(", ")}.`,
      );
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImporting(false);
    }
  }

  /** Buka dialog ubah meja, terisi nilai mejanya yang sekarang. */
  function openTableEdit(state: TableState) {
    setError(null);
    setTableDialog({
      kind: "edit",
      tableId: state.id,
      name: state.name,
      seats: String(state.seats),
      zone: state.zone ?? "",
    });
  }

  /**
   * Buka dialog hapus meja **beserta pagar hapusnya**. Pamakaian mejanya dibaca
   * lebih dulu supaya tombol Hapusnya sudah tahu jawabannya sebelum ditekan —
   * meja yang masih terisi atau beriwayat ditolak dengan kalimat server, bukan
   * dengan pesan galat setelah terlanjur menekan.
   */
  async function openTableDelete(state: TableState) {
    setError(null);
    setTableDialog({ kind: "delete", tableId: state.id, name: state.name, check: null, error: null });
    try {
      const check = await tableDeletionCheck(state.id);
      setTableDialog((current) =>
        current && current.kind === "delete" && current.tableId === state.id
          ? { ...current, check }
          : current,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setTableDialog((current) =>
        current && current.kind === "delete" && current.tableId === state.id
          ? { ...current, error: message }
          : current,
      );
    }
  }

  async function saveTableEdit() {
    if (!tableDialog || tableDialog.kind !== "edit") return;
    setTableBusy(true);
    setError(null);
    try {
      await updateTable({
        tableId: tableDialog.tableId,
        name: tableDialog.name,
        seats: Number(tableDialog.seats) || 0,
        zone: tableDialog.zone.trim() || undefined,
      });
      setTableDialog(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTableBusy(false);
    }
  }

  async function confirmTableDelete() {
    if (!tableDialog || tableDialog.kind !== "delete") return;
    setTableBusy(true);
    setError(null);
    try {
      await deleteTable(tableDialog.tableId);
      // Kartu QR meja yang barusan dihapus tidak boleh tetap terpampang.
      if (qrTable?.id === tableDialog.tableId) {
        setQrTable(null);
        setQrToken(null);
      }
      setTableDialog(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTableBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ChefHat className="size-5 text-primary" />
            Dapur &amp; Meja
          </h2>
          <p className="text-sm text-muted-foreground">
            {kdsOn
              ? `${kdsTickets.length} pesanan menunggu · ${waitingItems} item · ${occupied} meja terisi${
                  settledCount > 0 ? ` · ${settledCount} sudah lunas` : ""
                }`
              : (kdsUnavailable ?? "Layar dapur tidak aktif di workspace ini.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={kdsOn ? "secondary" : "outline"} className="gap-1.5">
            <span
              className={cn(
                "size-1.5 rounded-full",
                kdsOn ? "bg-primary" : "bg-muted-foreground",
              )}
            />
            {kdsOn ? "Layar dapur aktif" : "Butuh modul F&B"}
          </Badge>
          <Link
            to="/app/modules"
            className="text-xs text-primary hover:underline"
          >
            Kelola modul →
          </Link>
        </div>
      </div>

      {!kdsOn && (
        <div className="flex items-start gap-3 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-accent" />
          <div className="text-muted-foreground">
            <strong className="text-foreground">Denah meja &amp; antrean dapur</strong>{" "}
            hidup di modul Food &amp; Beverage. Aktifkan modulnya di halaman{" "}
            <Link to="/app/modules" className="text-primary hover:underline">
              Modul
            </Link>{" "}
            untuk memakai alur ini — server juga menolak pesanannya selama modul mati.
          </div>
        </div>
      )}

      {error && (
        <p
          role="alert"
          data-testid="meja-galat"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      {/* `grid-cols-1` mencegah kolom implisit ber-ukuran `auto` melebar sampai
          `max-content` isinya (daftar tiket bisa memuat catatan panjang) — penyebab
          isi terpotong di tepi kanan layar HP. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <section className="min-w-0">
          {/*
            Penghitung tagihan QR yang belum masuk antrean duduk **di kartu
            antrean dapur itu sendiri** — bukan di kolom denah — supaya kasir
            yang sedang memandangi antrean langsung membaca berapa pesanan yang
            belum lunas, lalu menekan tombolnya ke halaman Pembayaran tanpa
            harus mencari dulu di mana jumlahnya. Isinya tetap hanya jumlah:
            pesanan yang belum dibayar tidak pernah terbaca dari dapur.
          */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Antrean dapur</h3>
            {tableOn && pendingQrCount > 0 && (
              <div
                data-testid="meja-qr-menunggu-bayar"
                data-kilat={qrFlashing ? "1" : "0"}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5",
                  // Kilatnya gerak; yang memilih senyap tetap dapat teks tandanya
                  // (`meja-qr-kilat`) karena notifikasinya bukan hiasan.
                  qrFlashing && "animate-kilat motion-reduce:animate-none",
                )}
              >
                <Badge
                  variant="accent"
                  className="gap-1.5"
                  data-testid="meja-qr-menunggu-jumlah"
                >
                  <QrCode className="size-3" />
                  {pendingQrCount} pesanan QR meja menunggu pelunasan
                </Badge>
                {/*
                  Tanda “baru masuk” hanya muncul sesaat setelah tagihannya
                  datang (dan hanya kalau tagihannya memang masih baru): dapur
                  tidak perlu diberi tahu hal yang sudah ia lihat sendiri.
                */}
                {qrFlashing && (
                  <span
                    data-testid="meja-qr-kilat"
                    data-kilat-at={qrAlert?.at ?? ""}
                    data-kilat-jumlah={qrAlert?.count ?? 0}
                    className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground"
                  >
                    <BellRing className="size-3" />
                    {kdsAlertLabel(qrAlert?.count ?? 0)}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">
                  Dapur hanya menerima pesanan yang sudah lunas — ini belum masuk
                  antrean.
                </span>
                <Button asChild size="sm" variant="accent">
                  <Link to="/app/payments" data-testid="meja-qr-ke-pembayaran">
                    <ArrowRight className="size-4" />
                    Ke halaman Pembayaran
                  </Link>
                </Button>
                {/*
                  Saklar bunyi bisa dipakai dari sini juga: dapur yang berisik
                  (atau ruang yang sudah sepi) tidak harus membuka halaman lain
                  untuk membisukan layarnya. Setelannya **perangkat**, satu sumber
                  dengan tombol bip kasir & kartu di halaman Pengaturan — jadi
                  tidak mungkin menampilkan keadaan yang berbeda. Volumenya dibaca
                  dari setelan yang sama persis dengan kasir.
                */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={beep.enabled}
                  aria-label="Bunyi saat tagihan QR baru masuk"
                  data-testid="meja-qr-bip"
                  title={
                    beep.enabled
                      ? `Bunyi notifikasi tagihan QR aktif di perangkat ini (volume ${scanBeepVolumeLabel(beep.volume)}) — klik untuk mematikan`
                      : "Bunyi notifikasi tagihan QR mati di perangkat ini — kilatnya tetap berjalan; klik untuk menyalakan"
                  }
                  onClick={() => {
                    const next = !beep.enabled;
                    beep.setEnabled(next);
                    // Menyalakan langsung diperdengarkan nada notifikasi ini,
                    // supaya yang menyalakannya tahu bunyi apa yang ia nyalakan.
                    if (next) playKdsAlertBeep();
                  }}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                    beep.enabled
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {beep.enabled ? (
                    <Volume2 className="size-3" />
                  ) : (
                    <VolumeX className="size-3" />
                  )}
                  Bip tagihan {beep.enabled ? "aktif" : "mati"}
                </button>
              </div>
            )}
          </div>
          {kdsTickets.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              Belum ada pesanan menunggu. Pesanan yang dibayar di kasir masuk ke
              antrean ini <strong className="text-foreground">sendiri</strong> begitu
              uangnya diterima (tunai, QRIS, atau VA). Pesanan QR meja masuk ke
              antrean ini begitu tagihannya lunas. Meja yang tiketnya ada di sini
              tetap terkunci untuk kasir sampai Anda menekan{" "}
              <strong className="text-foreground">Selesai</strong>.
            </p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {kdsTickets.map((ticket) => (
                <article
                  key={ticket.saleId}
                  className={cn(
                    "flex flex-col rounded-lg border bg-card p-4",
                    ticket.late ? "border-accent/50" : "border-border",
                  )}
                >
                  <header className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-semibold">
                        {ticket.number}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {ticket.tableName
                          ? `Meja ${ticket.tableName}`
                          : "Tanpa meja (bungkus)"}
                      </div>
                      {ticket.settled && ticket.paidLabel ? (
                        <div
                          data-testid={`kds-lunas-kasir-${ticket.saleId}`}
                          className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-primary"
                        >
                          <Wallet className="size-3" />
                          {ticket.paidLabel}
                        </div>
                      ) : null}
                      {ticketPaymentLabel(paidQrBySale.get(ticket.saleId)) ? (
                        <div
                          data-testid={`kds-lunas-meja-${ticket.saleId}`}
                          data-paid-at={paidQrBySale.get(ticket.saleId)?.paidAt ?? ""}
                          className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-primary"
                        >
                          {paidQrBySale.get(ticket.saleId)?.method === "va" ? (
                            <Landmark className="size-3" />
                          ) : (
                            <QrCode className="size-3" />
                          )}
                          {ticketPaymentLabel(paidQrBySale.get(ticket.saleId))}
                        </div>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        ticket.late
                          ? "bg-accent/15 text-accent"
                          : "bg-secondary text-muted-foreground",
                      )}
                    >
                      <Timer className="size-3" />
                      {ticket.waitingMinutes} mnt
                      {ticket.late ? ` (> ${KDS_ATTENTION_MINUTES})` : ""}
                    </span>
                  </header>

                  <ul className="mt-3 flex-1 space-y-1 text-sm">
                    {ticket.items.map((item, index) => (
                      <li key={`${ticket.saleId}-${index}`} className="flex justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate">{item.name}</span>
                          {(item.modifiers?.length ?? 0) > 0 && (
                            <span className="block text-[11px] text-primary">
                              {modifierSummary(item.modifiers ?? [])}
                            </span>
                          )}
                        </span>
                        <span className="font-mono text-muted-foreground">
                          {item.quantity}×
                        </span>
                      </li>
                    ))}
                  </ul>

                  <p className="mt-2 truncate text-xs text-muted-foreground">
                    {ticketSummary(ticket)}
                  </p>

                  <Button
                    className="mt-4"
                    variant={ticket.late ? "default" : "outline"}
                    data-testid={`kds-selesai-${ticket.saleId}`}
                    onClick={() => void finish(ticket.saleId)}
                    disabled={busyId === ticket.saleId}
                    title={
                      ticket.settled
                        ? "Tandai tiket ini beres — penjualannya sudah lunas dan stoknya sudah bergerak, jadi tidak ada yang dicatat lagi selain status antreannya"
                        : "Selesaikan pesanan tertahan: penjualannya menjadi selesai dan stoknya bergerak di sini"
                    }
                  >
                    <Check className="size-4" />
                    {busyId === ticket.saleId ? "Menyimpan…" : "Selesai"}
                  </Button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0 space-y-4">
          {/*
            Kolom ini sengaja hanya berisi denah meja. Pesanan QR yang belum lunas
            **tidak** ditampilkan di mana pun sebagai antrean: jumlah dan jalan
            ke halaman Pembayaran-nya ada di kartu antrean dapur (kolom kiri).
          */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Denah meja</h3>
            <span className="text-xs text-muted-foreground">
              {tableOn ? `${states.length} meja` : "modul F&B mati"}
            </span>
          </div>

          {tableOn && states.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              Denah masih kosong. Tambahkan meja pertama di bawah.
            </p>
          )}

          {tableOn && states.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {states.map((state, position) => (
                <div
                  key={state.id}
                  data-testid={`meja-kartu-${state.id}`}
                  className={cn(
                    "rounded-lg border p-3",
                    state.status === "occupied"
                      ? "border-primary/50 bg-primary/10"
                      : state.status === "inactive"
                        ? "border-dashed border-border bg-secondary/20"
                        : "border-border bg-card",
                  )}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-sm font-semibold">{state.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {state.seats} kursi
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    {tableLabel(state)}
                  </div>
                  <div className="mt-2 text-[11px] font-medium">
                    {state.status === "occupied" ? (
                      <span className="text-primary">
                        Terisi {state.orderNumber}
                        {state.waitingMinutes !== undefined
                          ? ` · ${state.waitingMinutes} mnt`
                          : ""}
                      </span>
                    ) : state.status === "inactive" ? (
                      <span className="text-muted-foreground">Nonaktif</span>
                    ) : (
                      <span className="text-muted-foreground">Kosong</span>
                    )}
                  </div>
                  {can("table.manage") && (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void toggleTable(state)}
                        disabled={busyId === state.id}
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Power className="size-3" />
                        {state.active ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                      {state.active && (
                        <button
                          type="button"
                          data-testid={`meja-qr-${state.id}`}
                          onClick={() => void openMenuQr(state)}
                          disabled={qrBusy}
                          className="inline-flex items-center gap-1 text-[11px] text-primary transition-colors hover:underline"
                        >
                          <QrCode className="size-3" />
                          {state.menuToken ? "Kartu QR" : "Buat QR menu"}
                        </button>
                      )}
                      <button
                        type="button"
                        data-testid={`meja-geser-kiri-${state.id}`}
                        aria-label={`Geser ${state.name} ke kiri`}
                        onClick={() => void moveTableBy(state, -1)}
                        disabled={position === 0 || busyId === state.id}
                        className="inline-flex items-center text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronLeft className="size-3" />
                        Geser
                      </button>
                      <button
                        type="button"
                        data-testid={`meja-geser-kanan-${state.id}`}
                        aria-label={`Geser ${state.name} ke kanan`}
                        onClick={() => void moveTableBy(state, 1)}
                        disabled={
                          position === states.length - 1 || busyId === state.id
                        }
                        className="inline-flex items-center text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronRight className="size-3" />
                      </button>
                      <button
                        type="button"
                        data-testid={`meja-ubah-${state.id}`}
                        onClick={() => openTableEdit(state)}
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Pencil className="size-3" />
                        Ubah
                      </button>
                      <button
                        type="button"
                        data-testid={`meja-hapus-${state.id}`}
                        onClick={() => void openTableDelete(state)}
                        className="inline-flex items-center gap-1 text-[11px] text-destructive transition-colors hover:underline"
                      >
                        <Trash2 className="size-3" />
                        Hapus
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tableOn && qrTable && (
            <div
              data-testid="meja-qr-kartu"
              className="rounded-lg border border-primary/30 bg-primary/5 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <QrCode className="size-4 text-primary" />
                    QR menu meja {qrTable.name}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Cetak, lalu tempel kartunya di meja. Tamu memindai kode ini
                    untuk melihat menu dan membayar sendiri; pesanan yang sudah
                    dibayar otomatis muncul di antrean dapur.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Tutup kartu QR"
                  onClick={() => {
                    setQrTable(null);
                    setQrToken(null);
                  }}
                >
                  <X className="size-4" />
                </button>
              </div>

              {qrError && (
                <p className="mt-2 text-[11px] text-destructive">{qrError}</p>
              )}

              <div className="mt-3 flex flex-col items-center gap-2">
                {qrUrl ? (
                  <QrCodeImage
                    value={qrUrl}
                    className="size-44 rounded-lg border border-border p-1"
                    label={`Kode QR menu meja ${qrTable.name}`}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {qrBusy ? "Menerbitkan kode…" : "Kode QR belum siap."}
                  </p>
                )}
                {qrUrl && (
                  <code className="max-w-full truncate rounded bg-secondary/40 px-2 py-1 text-[11px]">
                    {qrUrl}
                  </code>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copyMenuQr()}
                  disabled={!qrUrl}
                  data-testid="meja-qr-salin"
                >
                  <Copy className="size-4" />
                  {qrCopied ? "Tersalin" : "Salin tautan"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => qrUrl && window.print()}
                  disabled={!qrUrl}
                  data-testid="meja-qr-cetak"
                >
                  <Printer className="size-4" />
                  Cetak kartu
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void rotateMenuQr(qrTable)}
                  disabled={qrBusy}
                  data-testid="meja-qr-ganti"
                >
                  <RefreshCw className="size-4" />
                  Ganti kode
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Mengganti kode membuat kartu lama tidak berlaku lagi — pakai
                kalau kartunya hilang atau difoto orang lain.
              </p>
            </div>
          )}

          {tableOn && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <UtensilsCrossed className="size-4 text-primary" />
                Tambah meja
              </div>
              {can("table.manage") ? (
                <div className="mt-3 space-y-2">
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Nama meja (mis. A4)"
                    aria-label="Nama meja"
                  />
                  <div className="flex gap-2">
                    <Input
                      value={form.seats}
                      onChange={(e) => setForm((f) => ({ ...f, seats: e.target.value }))}
                      inputMode="numeric"
                      placeholder="Kursi"
                      aria-label="Jumlah kursi"
                      className="w-24"
                    />
                    <Input
                      value={form.zone}
                      onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))}
                      placeholder="Zona (opsional)"
                      aria-label="Zona meja"
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => void addTable()}
                    disabled={savingTable || form.name.trim().length === 0}
                    data-testid="meja-tambah"
                  >
                    <Plus className="size-4" />
                    {savingTable ? "Menyimpan…" : "Tambah meja"}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    Nama meja unik per toko, kursi 1–24. Meja baru masuk di
                    akhir denah, jadi menambah meja tidak menggeser tataan
                    yang sudah ada. Meja yang masih terisi tidak bisa
                    dinonaktifkan; meja yang sudah dipakai tidak bisa dihapus —
                    nonaktifkan saja.
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  Hanya pemilik atau manajer (izin <code>table.manage</code>) yang
                  bisa mengubah denah meja.
                </p>
              )}
            </div>
          )}

          {tableOn && (
            <div
              data-testid="meja-impor-panel"
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ListPlus className="size-4 text-primary" />
                Impor beberapa meja
              </div>
              {can("table.manage") ? (
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    Satu meja per baris: <b>Nama, kursi, zona</b> — kursi &amp;
                    zona boleh dilewati (<code>A1</code> saja = 4 kursi), dan
                    baris berawalan <code>#</code> diabaikan. Meja barunya masuk
                    berurutan di akhir denah, maksimal {MAX_TABLE_IMPORT_ROWS}{" "}
                    baris sekali impor.
                  </p>
                  <textarea
                    value={importText}
                    onChange={(e) => {
                      setImportText(e.target.value);
                      setImportNotice(null);
                      setImportError(null);
                    }}
                    rows={5}
                    placeholder={TABLE_IMPORT_EXAMPLE}
                    aria-label="Daftar meja yang diimpor"
                    data-testid="meja-impor-teks"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                  />

                  {importError ? (
                    <p
                      role="alert"
                      data-testid="meja-impor-galat"
                      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                    >
                      {importError}
                    </p>
                  ) : importText.trim().length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      Tempel daftarnya, lalu pratinjaunya muncul di sini sebelum
                      Anda menekan Impor.
                    </p>
                  ) : importPlan.ok ? (
                    <div
                      data-testid="meja-impor-pratinjau"
                      className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs"
                    >
                      <div className="font-medium">
                        {importPlan.rows} meja siap ditambahkan di akhir denah:
                      </div>
                      <ul className="mt-1 space-y-0.5 text-muted-foreground">
                        {importPlan.tables.map((row) => (
                          <li key={row.name}>
                            {tableLabel({
                              name: row.name,
                              zone: row.zone ?? "",
                            })}{" "}
                            · {row.seats} kursi
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p
                      role="alert"
                      data-testid="meja-impor-galat"
                      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                    >
                      {importPlan.reason}
                    </p>
                  )}

                  <Button
                    className="w-full"
                    onClick={() => void runImport()}
                    disabled={importing || !importPlan.ok}
                    data-testid="meja-impor"
                  >
                    <ListPlus className="size-4" />
                    {importing
                      ? "Mengimpor…"
                      : importPlan.ok
                        ? `Impor ${importPlan.rows} meja`
                        : "Impor meja"}
                  </Button>
                  {importNotice && (
                    <p
                      role="status"
                      data-testid="meja-impor-notis"
                      className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs"
                    >
                      {importNotice}
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  Hanya pemilik atau manajer (izin <code>table.manage</code>) yang
                  bisa menambah meja sekaligus.
                </p>
              )}
            </div>
          )}

          <div className="rounded-lg border border-border/60 bg-secondary/20 p-4 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">Catatan operasional</div>
            <ul className="mt-2 space-y-1">
              <li>• Pesanan tertahan belum menggerakkan stok; stok berkurang saat ditandai selesai.</li>
              <li>• Satu meja hanya boleh punya satu pesanan terbuka.</li>
              <li>
                • Pesanan tanpa meja tetap boleh (bungkus/take away) dan muncul di
                antrean yang sama.
              </li>
              <li>
                • Pesanan QR baru masuk antrean setelah tagihannya lunas; yang
                masih menunggu tampil di kartu “Pesanan QR dari tamu”.
              </li>
            </ul>
          </div>
        </section>
      </div>

      {/*
        Dialog denah meja: ubah identitas, atau hapus lewat pagar hapus. Meja yang
        sudah terpakai dijawab dengan nonaktifkan (bukan hapus) supaya riwayat
        penjualannya tetap menunjuk mejanya.
      */}
      {tableDialog && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/50 p-0 sm:items-center sm:justify-center"
          role="dialog"
          aria-modal="true"
          data-testid="meja-dialog"
        >
          <div className="w-full max-w-md rounded-t-2xl border border-border bg-card p-4 sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">
                  {tableDialog.kind === "edit"
                    ? `Ubah meja ${tableDialog.name}`
                    : `Hapus meja ${tableDialog.name}`}
                </div>
                <div className="text-xs text-muted-foreground">
                  {tableDialog.kind === "edit"
                    ? "Nama, jumlah kursi, dan zona bisa diubah kapan saja."
                    : "Meja yang belum pernah dipakai aman dihapus."}
                </div>
              </div>
              <button
                type="button"
                aria-label="Tutup"
                onClick={() => setTableDialog(null)}
                data-testid="meja-dialog-tutup"
              >
                <X className="size-4" />
              </button>
            </div>

            {tableDialog.kind === "edit" ? (
              <div className="mt-3 space-y-2">
                <Input
                  value={tableDialog.name}
                  onChange={(e) =>
                    setTableDialog((current) =>
                      current && current.kind === "edit"
                        ? { ...current, name: e.target.value }
                        : current,
                    )
                  }
                  placeholder="Nama meja (mis. A4)"
                  aria-label="Nama meja"
                  data-testid="meja-ubah-nama"
                />
                <div className="flex gap-2">
                  <Input
                    value={tableDialog.seats}
                    onChange={(e) =>
                      setTableDialog((current) =>
                        current && current.kind === "edit"
                          ? { ...current, seats: e.target.value }
                          : current,
                      )
                    }
                    inputMode="numeric"
                    placeholder="Kursi"
                    aria-label="Jumlah kursi"
                    className="w-24"
                    data-testid="meja-ubah-kursi"
                  />
                  <Input
                    value={tableDialog.zone}
                    onChange={(e) =>
                      setTableDialog((current) =>
                        current && current.kind === "edit"
                          ? { ...current, zone: e.target.value }
                          : current,
                      )
                    }
                    placeholder="Zona (opsional)"
                    aria-label="Zona meja"
                    data-testid="meja-ubah-zona"
                  />
                </div>
              </div>
            ) : (
              <div className="mt-3">
                {tableDialog.error ? (
                  <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {tableDialog.error}
                  </p>
                ) : tableDialog.check === null ? (
                  <p className="text-xs text-muted-foreground">
                    Membaca pemakaian meja…
                  </p>
                ) : (
                  <div
                    data-testid="meja-dialog-kalimat"
                    data-can-delete={tableDialog.check.canDelete ? "yes" : "no"}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs",
                      tableDialog.check.canDelete
                        ? "border-primary/40 bg-primary/10"
                        : "border-destructive/40 bg-destructive/10 text-destructive",
                    )}
                  >
                    <p>{tableDialog.check.sentence}</p>
                    {tableDialog.check.blockers.length > 1 && (
                      <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                        {tableDialog.check.blockers.slice(1).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                    {!tableDialog.check.canDelete && (
                      <p className="mt-1.5">
                        Yang dipakai memutuskan bukan jumlah kursinya, melainkan
                        pemakaian mejanya: pesanan terbuka, tagihan tamu yang
                        masih menunggu, dan riwayat penjualan.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setTableDialog(null)}
                data-testid="meja-dialog-batal"
              >
                Batal
              </Button>
              {tableDialog.kind === "edit" ? (
                <Button
                  onClick={() => void saveTableEdit()}
                  disabled={tableBusy || tableDialog.name.trim().length === 0}
                  data-testid="meja-dialog-simpan"
                >
                  {tableBusy ? "Menyimpan…" : "Simpan perubahan"}
                </Button>
              ) : (
                <Button
                  onClick={() => void confirmTableDelete()}
                  disabled={
                    tableBusy ||
                    tableDialog.check === null ||
                    !tableDialog.check.canDelete
                  }
                  data-testid="meja-dialog-hapus"
                >
                  <Trash2 className="size-4" />
                  {tableBusy ? "Menghapus…" : "Hapus meja"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/*
        Kartu QR meja yang benar-benar keluar dari printer. Di layar bagian ini
        tidak tampil (`.meja-qr-cetak`), dan saat mencetak hanya bagian ini yang
        terlihat — pola yang sama dengan struk di halaman kasir.
      */}
      {qrTable && qrUrl && (
        <div data-testid="meja-qr-cetak-area" className="meja-qr-cetak">
          <div
            style={{
              padding: "18mm",
              textAlign: "center",
              color: "#111827",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <div style={{ fontSize: 13, letterSpacing: 2, textTransform: "uppercase" }}>
              {session?.tenant?.name ?? "MesinPOS"}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>
              Meja {qrTable.name}
            </div>
            <div style={{ fontSize: 13, color: "#4b5563", marginTop: 4 }}>
              Pindai kode ini untuk melihat menu &amp; membayar sendiri
            </div>
            <QrCodeImage value={qrUrl} className="mx-auto mt-8 size-64" />
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 10 }}>
              {qrUrl}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

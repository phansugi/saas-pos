import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  AlarmClock,
  AlertTriangle,
  BadgeCheck,
  BellRing,
  ChefHat,
  ChevronUp,
  CloudOff,
  FileDown,
  FileText,
  History,
  Image as ImageIcon,
  ImageOff,
  Lock,
  MessageCircle,
  Minus,
  Pause,
  Play,
  Plus,
  Printer,
  QrCode,
  Bluetooth,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  Usb,
  UtensilsCrossed,
  Volume2,
  VolumeX,
  X,
  XCircle,
} from "lucide-react";
import { QrCodeImage } from "@/components/QrCodeImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  entitlementFor,
  hasFeature,
  isFeatureEnabled,
} from "@/lib/billing";
import { formatPctPlain, orderTotal } from "@/lib/fnbTax";
import { tableLabel, tableStates, ticketTableHolders } from "@/lib/fnb";
import { posCategoryChips } from "@/lib/categories";
import { decideCredit, rupiah } from "@/lib/ar";
import { ESC_POS_TRANSPORTS, type EscposTransport } from "@/lib/escpos";
import { describeMember, discountBreakdown } from "@/lib/loyalty";
import {
  applyModifiers,
  lineTotalWithModifiers,
  modifierSummary,
} from "@/lib/modifiers";
import {
  checkCartMatchesCharge,
  paymentInstruction,
  qrPayload,
  validateCartCharge,
  type DigitalMethod,
} from "@/lib/payments";import { SCAN_BEEP_VOLUME_MAX,
  SCAN_BEEP_VOLUME_MIN,
  playScanBeep,
  scanBeepVolumeLabel,
} from "@/lib/scanBeep";
import { useSession } from "@/lib/session";
/*
  Shift kas dibaca dari perangkat yang sama dengan halaman Shift & Kas.
  Aturannya — bentuk data, jam pengingat, dan kalimatnya — ada di `@/lib/shift`,
  supaya kedua halaman tidak pernah berbeda cerita.
*/
import {
  EMPTY_SHIFT_STATE,
  SHIFT_STORAGE_KEY,
  parseShiftState,
  posShiftGate,
  shiftClockLabel,
  shiftReminder,
  type ShiftState,
} from "@/lib/shift";
import {
  receiptCopiesLabel,
  receiptDocument,
  receiptPrintCss,
  type ReceiptDraft,
  type ReceiptItemLine,
} from "@/lib/struk";
import { receiptPdfBytes, receiptPdfFileName } from "@/lib/receiptPdf";
import { receiptImageFileName } from "@/lib/receiptImage";
import { receiptImagePng } from "@/lib/receiptImageRaster";
import { rasteriseReceiptLogo } from "@/lib/receiptLogoRaster";
import {
  maskPhone,
  receiptWhatsappCaption,
  receiptWhatsappLink,
  receiptWhatsappReceiptMessage,
} from "@/lib/receiptWhatsapp";
import { normalizePhone } from "@/lib/team";
import { useEscpos } from "@/lib/useEscpos";
import { useScanBeep } from "@/lib/useScanBeep";
import {
  useStore,
  type PaymentLabel,
  type StoreModifierGroup,
  type StoreModifierSelection,
  type StoreProduct,
} from "@/lib/store";
import { useCan } from "@/lib/usePermission";
/*
  Pemberitahuan ke **pemilik toko** (`@/lib/useShiftOwnerAlert`): kas yang belum
  dibuka di jam operasional, dan shift yang belum ditutup padahal toko sudah tutup
  atau shiftnya terlalu lama. Laporannya dikirim dari perangkat ini — hanya di sini
  keadaan shiftnya diketahui — lalu server memutuskan ulang & mengirim kabarnya ke
  langganan webhook pemilik.
*/
import {
  shiftOwnerAlertStatusLabel,
  useShiftOwnerAlert,
} from "@/lib/useShiftOwnerAlert";
import { cn, formatIDR } from "@/lib/utils";
import { priceLine } from "@/lib/wholesale";

interface CartLine {
  productId: string;
  name: string;
  price: number;
  qty: number;
  /** Satuan yang dipilih; kosong berarti satuan dasar. Modul Grosir. */
  unitCode?: string;
  /** Pilihan modifier item (level pedas, topping). Modul F&B. */
  modifiers?: StoreModifierSelection[];
}

/**
 * Satu transaksi yang **ditahan sementara** (tombol **Hold**).
 *
 * Isinya adalah keranjang yang belum dibayar: uang belum masuk, stok belum
 * bergerak, dan dapur belum menerima apa pun — jadi ini urusan layar kasir,
 * bukan penjualan di server. Karena itu `total`/`itemCount` di sini hanya
 * catatan **saat ditahan** untuk ditampilkan di daftarnya; begitu transaksinya
 * dilanjutkan, angkanya dihitung ulang dari katalog yang berlaku sekarang.
 */
interface HeldCart {
  id: string;
  heldAt: number;
  cart: CartLine[];
  discount: number;
  tableId?: string;
  /** Nama meja **saat ditahan** — denah bisa berubah (meja diganti nama/dihapus). */
  tableName?: string;
  memberId?: string;
  customerId?: string;
  total: number;
  itemCount: number;
}

/**
 * Sebutan singkat satu transaksi yang ditahan, dipakai di daftarnya dan di notis
 * hasil Hold/Lanjutkan: `Meja A1 · 3 item · Rp 45.000`.
 */
function heldLabel(row: HeldCart): string {
  const where = row.tableName ? `Meja ${row.tableName}` : "Tanpa meja (bungkus)";
  return `${where} · ${row.itemCount} item · ${formatIDR(row.total)}`;
}

/**
 * Satu berkas PDF struk yang sudah dibuat di perangkat kasir selama sesi ini.
 *
 * Byte-nya tidak disimpan di sini (struk bisa puluhan KB), tetapi URL blob-nya
 * ditahan supaya berkas yang sama bisa **dibuka atau diunduh ulang** tanpa
 * menyusun ulang PDF-nya — itulah gunanya daftar PDF di dialog struk. URL-nya
 * hidup selama halaman ini terbuka, dan baru dilepas saat halaman ditinggalkan.
 */
interface ReceiptPdfFile {
  id: string;
  filename: string;
  url: string;
  size: number;
  /** Kalimat singkat berkas ini struk apa, mis. `Nota A-00042`. */
  label: string;
}

/** Pilihan yang sedang disusun di dialog modifier: groupCode → kode opsi. */
type ModifierDraft = Record<string, string[]>;

const PAYMENT_METHODS: PaymentLabel[] = ["Tunai", "QRIS", "Kartu"];
const ALL_CATEGORIES = "Semua";

/**
 * Pecahan uang yang paling sering diserahkan pembeli, untuk tombol cepat di
 * dialog pembayaran tunai.
 *
 * Kasir di depan antrean menghitung uang di tangannya, bukan di layar: menekan
 * “Rp 50.000” lebih cepat — dan tidak salah jumlah nolnya — daripada mengetik
 * lima digit sambil sesekali melihat pelanggan berikutnya. Tombolnya hanya
 * **mengisi** kolom `Uang diterima` (nilainya masih boleh disunting kalau uangnya
 * bukan pecahan pas, mis. Rp 55.000), dan pecahan yang sedang terpakai ditandai
 * sebagai pilihan aktif supaya kembaliannya tidak salah dibaca.
 */
const CASH_QUICK_AMOUNTS = [10_000, 20_000, 50_000, 100_000, 500_000] as const;

/**
 * Tagihan digital yang **diterbitkan dari keranjang kasir** (`payment.digital`).
 *
 * `status` di sini hanya menandai dua keadaan yang dilihat kasir: "menunggu"
 * (kode sudah ditunjukkan, uang belum dipastikan) dan "paid" (tagihan sudah
 * ditandai lunas, penjualannya tinggal disimpan). Kedaluwarsa tidak disimpan di
 * sini — server yang memutuskan saat pelunasan, dan pesannya yang sama dipakai
 * halaman ini.
 */
interface CartCharge {
  id: string;
  number: string;
  method: DigitalMethod;
  amount: number;
  expiresAt: number;
  status: "pending" | "paid";
}

/** Jam tenggat tagihan: cukup jam-menit-detik, karena QRIS berumur menit. */
function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Shift kas dibuka & ditutup dari halaman Shift & Kas dan disimpan di
 * **perangkat ini** (`@/lib/shift`). Halaman Kasir membacanya sendiri saat
 * dibuka: badge “Shift terbuka” dulu tulisan tetap (“Kasir: Rani · buka 08:00”)
 * yang sama sekali tidak melihat keadaan kas, dan tidak ada peringatan apa pun
 * bahwa kas masih terbuka padahal hari sudah berakhir. Berpindah halaman
 * me-remount halaman ini, jadi membacanya sekali sudah cukup.
 */
function readShiftState(): ShiftState {
  if (typeof window === "undefined") return EMPTY_SHIFT_STATE;
  try {
    return parseShiftState(window.localStorage.getItem(SHIFT_STORAGE_KEY));
  } catch {
    return EMPTY_SHIFT_STATE;
  }
}

export function PosPage() {
  const {
    products,
    categories,
    sales,
    createSale,
    source,
    ready,
    offline,
    modules,
    tables,
    kdsTickets,
    customers,
    receivables,
    members,
    // Kirim struk penjualan ke WhatsApp member (nomor tujuannya diambil server
    // dari data member yang mengisi sendiri nomornya di halaman Member).
    sendReceiptWhatsapp,
    digitalPlan,
    digitalLimits,
    createDigitalCharge,
    actDigitalCharge,
    tax: taxSetting,
    fnbTax,
    // Setelan struk workspace (halaman Pengaturan): jenis printer, lebar kertas,
    // rangkap, dan catatan kakinya. Kasir hanya memakainya untuk mencetak — yang
    // mengubahnya pemilik/keuangan lewat izin `billing.manage`.
    receipt,
    // Logo toko yang tercetak di atas nama usaha (`tenants.logo`).
    logo,
    // Setelan pengingat tutup shift workspace (`tenants.shift`, diatur di halaman
    // Pengaturan). Dinamai `shiftSetting` karena `shift` di halaman ini adalah
    // keadaan shift **perangkat** yang sedang berjalan (lihat `readShiftState`).
    shift: shiftSetting,
    /*
      Kas **toko** (`pos.till` di server): shift yang dibuka pemilik di perangkat
      mana pun. Inilah yang membuat kasir bisa melayani pembeli tanpa memegang
      izin `shift.manage` dan tanpa membuka kasnya sendiri.
    */
    till,
  } = useStore();
  const { session } = useSession();
  const can = useCan();
  // Setelan bunyi bip perangkat ini: kasir yang paling tahu ruangnya ramai atau
  // malam sudah sepi, jadi tombolnya ada di sini — bukan hanya di Pengaturan,
  // yang justru butuh izin pengelola tagihan.
  const beep = useScanBeep();
  /*
    Cetak struk **langsung ke printer** (ESC/POS lewat USB atau Bluetooth).
    Sambungan perangkatnya hidup di hook ini, bukan di state halaman, supaya
    keranjang yang berubah tidak memutus printer yang sudah dipilih kasir.
  */
  const escpos = useEscpos();

  /*
    Shift kas perangkat ini: badge di bawah memakai keadaannya yang sebenarnya,
    dan `reminder` memberi tahu kasir kalau kasnya masih terbuka sementara hari
    sudah berakhir / toko mau tutup. Kalau belum pernah dibuka sama sekali,
    keadaannya dijelaskan apa adanya — bukan lagi diklaim “Shift terbuka”.
  */
  const [shift, setShift] = useState<ShiftState>(readShiftState);
  /*
    Dua sumber keadaan kas, dan halaman ini memakai yang mana pun lebih dulu ada:
    kas **toko** dari server (`till`, dibuka pemilik di perangkatnya) dan shift
    yang tersimpan di perangkat ini (cadangan saat store belum siap / mode demo,
    tempat keduanya memang sama-sama hidup di perangkat). Sebelumnya hanya yang
    kedua yang dibaca — akibatnya kasir di perangkat lain tetap melihat “Kas
    belum dibuka” walau pemilik sudah membuka kasnya, dan laporan itu yang
    dikeluhkan.
  */
  /*
    Dibungkus `useMemo` bukan hiasan: objeknya dipakai hook pengingat pemilik
    (`useShiftOwnerAlert`) yang bereaksi pada identitas `current` — objek baru di
    setiap render akan membuatnya melapor berulang kali tanpa henti.
  */
  const openShift = useMemo(
    () =>
      till.current
        ? {
            id: till.current.id,
            openedAt: till.current.openedAt,
            openingCash: till.current.openingCash,
          }
        : shift.current
          ? {
              id: shift.current.id,
              openedAt: Date.parse(shift.current.openedAt),
              openingCash: shift.current.openingCash,
            }
          : null,
    [till.current, shift.current],
  );
  const shiftOpenedMs = openShift ? openShift.openedAt : Number.NaN;
  /*
    Gerbang kasir (`posShiftGate`): tanpa kas yang terbuka (di toko maupun di
    perangkat ini), pekerjaan menjual dimatikan — produk tidak bisa masuk
    keranjang, meja tidak bisa dipilih, transaksi tidak bisa ditahan/dilanjutkan,
    dan pembayaran tidak bisa dibuka. Yang tertinggal hanya jalan menuju halaman
    Shift & Kas, supaya tidak ada penjualan yang tercatat tanpa pemilik kas.
  */
  const shiftGate = posShiftGate(openShift);
  const posLocked = shiftGate.locked;
  /**
   * Shift & kas punya izinnya sendiri (`shift.manage`). Kalau kasir memegang
   * `pos.sell` tanpa izin itu, tautan “Buka shift” di gerbang di bawah akan
   * menabrak rute yang memang tertutup untuknya — jadi pesannya diganti dengan
   * sebab yang sebenarnya (minta izin/beri tahu pemilik), bukan tombol mati.
   */
  const canManageShift = can("shift.manage");
  /*
    Keadaan kasinya juga bisa berubah dari tab/perangkat lain (kasir lain menutup
    shiftnya di halaman Shift & Kas). Pendengar `storage` membacanya ulang supaya
    gerbangnya ikut menutup begitu shiftnya ditutup — bukan tetap menjual dari
    tab yang keadaannya sudah basi. Kunci yang tidak dikenal (peristiwa tanpa
    `key`) tetap dibaca ulang; ruginya hanya satu pembacaan.
  */
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key && event.key !== SHIFT_STORAGE_KEY) return;
      setShift(readShiftState());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  /*
    Ambang pengingatnya milik workspace (`shiftSetting`): jam pengingatnya, ambang
    shift lama, dan saklarnya diatur pemilik toko di halaman Pengaturan — bukan
    lagi angka tetap di kode. Pengingat yang dimatikan berarti `null` di sini,
    walaupun kasnya masih terbuka.
  */
  const shiftNotice = Number.isFinite(shiftOpenedMs)
    ? shiftReminder({ openedAt: shiftOpenedMs, setting: shiftSetting })
    : null;
  /*
    Pemberitahuan ke pemilik toko: keadaan yang sama-sama dibaca dari perangkat
    ini, tetapi kabarnya untuk orang yang mungkin tidak ada di toko. Hook-nya yang
    melaporkan (sekali per hari per jenis) dan mengembalikan apa yang benar-benar
    terjadi — termasuk saat emailnya belum bisa berangkat atau workspace itu belum
    punya endpoint webhook yang menerimanya.
  */
  const ownerAlert = useShiftOwnerAlert({
    current: openShift,
    setting: shiftSetting,
    /*
      Laporan baru dikirim setelah store-nya siap: sebelum itu setelan workspace
      (`tenants.shift`) belum terbaca, jadi jam operasionalnya masih bawaan — dan
      melapor dengan setelan yang belum pasti hanya menghasilkan laporan yang
      ditolak server.
    */
    enabled: ready,
  });

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [tableId, setTableId] = useState<string | undefined>(undefined);
  const [modifierFor, setModifierFor] = useState<{
    productId: string;
    name: string;
    groups: StoreModifierGroup[];
    draft: ModifierDraft;
    /** Baris keranjang yang sedang diubah; `null` berarti produk baru. */
    lineIndex: number | null;
  } | null>(null);
  const [holdNotice, setHoldNotice] = useState<string | null>(null);
  const [holdError, setHoldError] = useState<string | null>(null);
  /** Transaksi yang ditahan sementara — daftar **Transaksi ditahan**. */
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [method, setMethod] = useState<PaymentLabel>("Tunai");
  const [cash, setCash] = useState(0);
  /** Pelanggan B2B penanggung tagihan tempo (modul Grosir). */
  const [customerId, setCustomerId] = useState<string | undefined>(undefined);
  /** Dibayar sekarang; `null` berarti lunas (tidak ada piutang). */
  const [paidNow, setPaidNow] = useState<number | null>(null);
  /** Member yang memakai diskonnya (modul UMKM); kosong = tanpa member. */
  const [memberId, setMemberId] = useState<string | undefined>(undefined);
  const [memberQuery, setMemberQuery] = useState("");
  const [upgradeHint, setUpgradeHint] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  /** Tagihan QRIS yang diterbitkan dari keranjang ini; `null` = belum ada. */
  const [cartCharge, setCartCharge] = useState<CartCharge | null>(null);
  const [lastReceipt, setLastReceipt] = useState<{
    number: string | null;
    total: number;
    queued: boolean;
    /**
     * Penjualan ini langsung masuk antrean dapur pada momen pembayarannya (modul
     * F&B yang punya layar dapur). Ditampilkan di dialog struk yang terbuka
     * otomatis — jadi kasir tahu dapurnya sudah menerima, tanpa berjalan ke
     * belakang untuk memeriksa.
     */
    kitchenFired?: boolean;
    /**
     * Member yang diskonnya dipakai penjualan ini — sekaligus **penerima utama**
     * struknya kalau dikirim lewat WhatsApp. Kosong = pembeli umum: tidak ada data
     * member yang bisa dibaca, jadi nomor tujuannya datang dari kolom nomor yang
     * diisi kasir di dialog struk (dipakai sekali untuk kiriman itu, tidak
     * disimpan sebagai member).
     */
    memberId?: string;
    /** Sisa yang dicatat sebagai piutang, kalau pembayarannya tempo. */
    credit?: number;
    customerName?: string;
    /** Nomor tagihan digital yang melunasi penjualan ini. */
    digital?: string;
    /**
     * Struk penjualan itu, siap dicetak. Disimpan bersama penjualannya supaya
     * cetak otomatis & cetak ulang mengeluarkan nota yang **sudah** dibayar —
     * bukan keranjang kosong yang tinggal setelah `resetSale()`.
     */
    draft: ReceiptDraft;
  } | null>(null);
  /**
   * Dialog “Struk belanja” sesudah penjualan tersimpan.
   *
   * Dulu struknya langsung dilempar ke dialog cetak peramban. Sekarang kasir yang
   * memilih: cetak, unduh PDF, atau kirim ke WhatsApp member — pembeli yang minta
   * dikirim ke WhatsApp tidak perlu menutup dialog cetak lebih dulu, dan kasir
   * tidak lagi bergantung pada dialog cetak untuk hal yang bukan mencetak.
   */
  const [receiptOpen, setReceiptOpen] = useState(false);
  /** Sedang membuat berkas atau mengirim; tombolnya ditahan selama itu. */
  const [receiptBusy, setReceiptBusy] = useState(false);
  /**
   * Sedang menyiapkan berkas untuk lembar bagikan perangkat (Web Share).
   * Dipisah dari `receiptBusy` supaya menekan “Bagikan gambar struk” tidak mengunci
   * tombol Kirim ke WhatsApp — dua jalur itu memang berbeda, walaupun berkasnya sama
   * (satu PNG struk berlogo).
   */
  const [shareBusy, setShareBusy] = useState(false);
  /** Hasil tindakan terakhir, mis. “PDF struk-A-00042.pdf (4,2 KB) disimpan”. */
  const [receiptNotice, setReceiptNotice] = useState<string | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  /**
   * Nomor WhatsApp yang **diketik kasir** di dialog struk. Dipakai hanya untuk
   * member yang belum melengkapi nomornya (mis. member cash yang didaftarkan
   * cepat di kasir); kalau membernya sudah punya nomor, kolomnya tidak muncul
   * sama sekali — nomor yang tersimpan selalu menang.
   */
  const [waPhone, setWaPhone] = useState("");
  /** Berkas PDF struk yang sudah dibuat di perangkat ini selama sesi berjalan. */
  const [pdfFiles, setPdfFiles] = useState<ReceiptPdfFile[]>([]);
  /** Daftar PDF-nya sedang dibuka di dialog struk. */
  const [pdfListOpen, setPdfListOpen] = useState(false);
  /*
    Penomoran berkas & penahan URL-nya: id cuma untuk kunci React, sedangkan
    URL-nya dikumpulkan supaya bisa dilepas sekaligus saat halaman ditutup —
    URL blob yang dibiarkan hidup adalah memori yang tidak bisa dibebaskan lagi.
  */
  const pdfSeq = useRef(0);
  const blobUrls = useRef<string[]>([]);

  /**
   * Lembar **“Transaksi terakhir (shift ini)”** yang muncul dari bawah layar.
   *
   * Dulu daftar ini berupa tabel yang selalu terbuka di bawah halaman kasir. Ia
   * memakan tinggi layar yang justru dipakai keranjang & grid produk, padahal di
   * tengah antrean yang dibaca kasir hanya beberapa baris terakhirnya. Sekarang
   * ringkasannya jadi satu tombol, dan daftar penuh penjualan shift ini dibuka saat
   * memang diminta — dari bawah, mengikuti arah layar kasir yang digulir ke bawah.
   */
  const [salesOpen, setSalesOpen] = useState(false);

  /*
    Escape menutup lembar transaksinya, sama seperti dialog lain di halaman ini.
    Pendengarnya hanya dipasang saat lembarnya terbuka supaya halaman kasir tidak
    menahan satu pendengar global sepanjang shift.
  */
  useEffect(() => {
    if (!salesOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSalesOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [salesOpen]);

  /*
    URL blob dari tiap berkas struk yang sudah dibuat (PDF unduhan, gambar yang
    terpaksa diunduh karena perangkatnya tidak punya lembar bagikan) dilepas saat
    halaman kasir ditinggalkan. Dibiarkan hidup, URL-nya menahan seluruh isi berkas
    di memori sampai peramban ditutup; berkas-berkas itu sendiri memang hanya
    berlaku selama sesi halaman ini (struk tidak pernah diunggah ke mana pun).
  */
  useEffect(() => {
    const daftar = blobUrls.current;
    return () => {
      for (const url of daftar) URL.revokeObjectURL(url);
      daftar.length = 0;
    };
  }, []);

  const planKey = session?.tenant?.planKey ?? "starter";
  const entitlements = useMemo(() => entitlementFor(planKey), [planKey]);
  // Fitur yang dimiliki modul (denah meja = modul F&B) hanya hidup saat modulnya
  // benar-benar aktif — paket saja tidak cukup. Aturan yang sama dipakai server.
  const canUseTables = isFeatureEnabled(
    entitlements,
    modules.activeVerticals,
    "pos.table",
  );
  const canSendToKitchen = isFeatureEnabled(
    entitlements,
    modules.activeVerticals,
    "pos.kds",
  );
  const canPrint = hasFeature(entitlements, "peripheral.escpos");
  // Diskon member (`member.discount`) milik modul UMKM. Kasir juga butuh izin
  // `member.view` untuk membaca daftarnya — sama seperti gerbang server.
  const canUseMemberDiscount = isFeatureEnabled(
    entitlements,
    modules.activeVerticals,
    "member.discount",
  );
  const canPickMember = canUseMemberDiscount && can("member.view");
  // Tempo/piutang adalah fitur modul Grosir (`ar.creditlimit`).
  const canUseCredit = isFeatureEnabled(
    entitlements,
    modules.activeVerticals,
    "ar.creditlimit",
  );
  // Kanal tagih digital (`payment.digital`): kasir menerbitkan tagihan QRIS dari
  // keranjang. Gerbangnya sama dengan server — fitur paketnya hidup **dan** peran
  // ini memegang izin `payment.manage` (kasir, keuangan, manajer, pemilik).
  const canChargeDigital = digitalPlan.digital && can("payment.manage");

  /**
   * Denah meja dari aturan bersama `@/lib/fnb`: meja terisi berasal dari pesanan
   * yang masih terbuka, jadi tidak ada status tersimpan yang bisa basi.
   */
  /*
    Meja ditempati selama masih ada **tiket dapur** yang menunjuknya — termasuk
    tiket yang penjualannya sudah lunas. Jadi meja tamu yang uangnya sudah masuk
    tetap terkunci sampai dapur menekan **Selesai**, sama seperti yang ditolak
    server di `pos.createSale` (`ticketTableHolders` = daftar yang sama dengan
    aturan `tableHolders` di sana).
  */
  const tableStatesNow = useMemo(
    () => tableStates(tables, ticketTableHolders(kdsTickets)),
    [tables, kdsTickets],
  );
  const selectedTable = tableStatesNow.find((state) => state.id === tableId);
  /**
   * Meja yang ditahan transaksi **belum dibayar** (tombol Hold). Meja itu tetap
   * milik tamunya selama transaksinya ditahan, jadi denah menandainya juga —
   * tanpa itu kasir bisa menyusun keranjang kedua untuk meja yang sama.
   */
  const parkedTables = useMemo(
    () =>
      new Map(
        heldCarts
          .filter((row) => row.tableId)
          .map((row) => [row.tableId as string, row] as const),
      ),
    [heldCarts],
  );

  const available = useMemo(
    () => new Map(products.map((p) => [p.id, p.stock])),
    [products],
  );

  /**
   * Tab kategori: kategori aktif, ditambah kategori nonaktif yang **masih dipakai**
   * produk — produk lama tidak boleh kehilangan tabnya hanya karena kategorinya
   * dinonaktifkan di halaman Produk & Stok (aturan `posCategoryChips`).
   */
  const categoryChips = useMemo(
    () => [ALL_CATEGORIES, ...posCategoryChips(categories, products.map((p) => p.category))],
    [categories, products],
  );

  const filtered = useMemo(
    () =>
      products.filter(
        (p) =>
          (category === ALL_CATEGORIES || p.category === category) &&
          p.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [products, category, query],
  );

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  /**
   * Apakah katalog yang **sedang tampil** punya gambar sama sekali. Kasir yang
   * belum pernah mengunggah foto tetap mendapat kartu ringkas seperti semula —
   * kotak gambar kosong di semua produk hanya menghabiskan ruang layar jual.
   */
  const adaGambar = useMemo(
    () => filtered.some((product) => (product.images?.length ?? 0) > 0),
    [filtered],
  );

  /**
   * Harga baris memakai aturan yang sama dengan server (konversi satuan lalu
   * tier), jadi kasir melihat angka yang sama dengan yang akan dicatat.
   */
  function pricedFor(product: StoreProduct | undefined, quantity: number, unitCode?: string) {
    if (!product) return null;
    // Satuan yang sudah tidak ada lagi di produk (mis. baru diubah di halaman
    // Produk) jatuh kembali ke satuan dasar, bukan membuat render gagal.
    const known = product.units ?? [];
    const safeUnit =
      unitCode && known.some((unit) => unit.code === unitCode) ? unitCode : undefined;
    return priceLine({
      product: {
        price: product.price,
        tiers: product.tiers,
        unit: product.unit,
        units: product.units,
      },
      quantity,
      unitCode: safeUnit,
    });
  }

  /**
   * Harga baris = harga (tier/satuan) + tambahan modifier × jumlah unit, memakai
   * aturan yang sama dengan server (`@/lib/modifiers`).
   */
  const cartPriced = cart.map((l) => {
    const product = productById.get(l.productId);
    const priced = pricedFor(product, l.qty, l.unitCode);
    const applied = applyModifiers(product, l.modifiers ?? []);
    return {
      line: l,
      product,
      priced,
      applied,
      lineTotal: lineTotalWithModifiers(
        priced?.lineTotal ?? l.price * l.qty,
        l.qty,
        applied.surcharge,
      ),
    };
  });

  const subtotal = cartPriced.reduce((sum, row) => sum + row.lineTotal, 0);
  /*
    Diskon: member (`member.discount`) + manual, digabung aturan yang sama
    dengan `pos.createSale`. Pratinjau di sini memakai persentase dari data
    member, jadi kasir melihat angka yang akan dicatat server.
  */
  const selectedMember = members.find((m) => m.id === memberId) ?? null;
  const memberDiscounts = discountBreakdown({
    subtotal,
    manualDiscount: discount,
    member: selectedMember
      ? {
          name: selectedMember.name,
          discountPct: selectedMember.discountPct,
          active: selectedMember.active,
        }
      : null,
  });
  const discountApplied = memberDiscounts.manualDiscount;
  const memberDiscountAmount = memberDiscounts.memberDiscount;
  /** Pencarian member di kasir: nama atau kode, member nonaktif tidak ditawarkan. */
  const memberMatches = memberQuery.trim()
    ? members
        .filter((m) => {
          const q = memberQuery.trim().toLowerCase();
          return (
            m.active &&
            (m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q))
          );
        })
        .slice(0, 5)
    : [];
  // Pajak mana yang dipungut penjualan ini datang dari setelan workspace (halaman
  // Pengaturan), bukan dari konstanta di halaman ini — aturan murni `@/lib/fnbTax`
  // yang sama dengan yang dipakai `pos.createSale` di server: PBJT (pajak daerah)
  // menggantikan PPN untuk makanan/minuman yang disajikan langsung, dan biaya
  // layanan berdiri sebagai barisnya sendiri (bukan pajak).
  const totals = orderTotal({ net: memberDiscounts.net, ppn: taxSetting, fnb: fnbTax });
  const tax = { net: totals.net, tax: totals.tax, gross: totals.total, ratePct: totals.plan.ratePct };
  const total = totals.total;
  // Item dihitung dalam satuan dasar supaya sebanding dengan stok dan laporan.
  const itemCount = cartPriced.reduce(
    (sum, row) => sum + (row.priced?.baseQty ?? row.line.qty),
    0,
  );
  const change = method === "Tunai" ? Math.max(0, cash - total) : 0;

  /*
    Struk yang benar-benar dicetak tombol cetak di panel kanan.

    Isinya disusun oleh aturan murni `@/lib/struk` dari setelan workspace yang
    **sama** dengan yang ditampilkan halaman Pengaturan: lebar kertas menentukan
    lebar kolomnya, printer dot matrix mencetak satu bagian per rangkap, dan nama
    produk panjang dibungkus sesuai kolom yang tersedia. Karena itu kasir tidak
    menyimpan bentuk struknya sendiri — kalau setelannya berubah, cetakannya ikut
    berubah tanpa ada dua tata letak yang perlu dijaga bersamaan.
  */
  const strukDraft: ReceiptDraft = {
    business: session?.tenant?.name ?? "MesinPOS",
    store: session?.tenant?.storeName,
    when: new Date().toLocaleString("id-ID", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    // Keranjang yang belum disimpan memang belum punya nomor: menyebutkannya
    // sebagai “belum dibayar” lebih jujur daripada mencetak nomor kosong.
    notice: cartPriced.length > 0 ? "Belum dibayar — struk sementara" : undefined,
    /*
      Nama pembeli di struk: nama member yang dipilih kasir. Kalau tidak ada yang
      dipilih, aturan murni `@/lib/struk` mencetak “Cash” — jadi kasir tidak perlu
      apa-apa agar struknya tetap menyebut pembelinya.
    */
    member: selectedMember?.name,
    /*
      Baris kasir: nama pengguna yang sedang melayani transaksi ini. Kalau
      namanya tidak diketahui (sesi tanpa nama), barisnya dilewati oleh aturan
      murni — bukan dicetak sebagai tanda hubung.
    */
    cashier: session?.user?.name,
    logoUrl: logo?.url,
    items: cartPriced.map((row): ReceiptItemLine => ({
      name: row.product?.name ?? "Produk tidak dikenal",
      qty: row.line.qty,
      unitPrice: row.priced?.unitPrice,
      amount: row.lineTotal,
    })),
    subtotal,
    discount: memberDiscounts.totalDiscount > 0 ? memberDiscounts.totalDiscount : undefined,
    serviceLabel: totals.lines.find((line) => line.kind === "service")?.label,
    serviceAmount: totals.lines.find((line) => line.kind === "service")?.amount,
    taxLabel: totals.lines.find((line) => line.kind === "tax")?.label,
    taxAmount: totals.lines.find((line) => line.kind === "tax")?.amount,
    total,
    paid: method === "Tunai" && cash > 0 ? cash : undefined,
    change: method === "Tunai" && cash > 0 ? change : undefined,
  };
  /*
    Yang benar-benar dikeluarkan printer (dan dikirim ke pembeli) selalu
    **penjualan yang sudah lunas** — `lastReceipt`, bukan keranjang yang sedang
    disusun. Sebelum ada pembayaran, area cetaknya jatuh ke `strukDraft`: draft
    keranjang yang tetap membawa catatan “Belum dibayar — struk sementara”, jadi
    tidak ada jalur apa pun (termasuk Ctrl+P) yang bisa mengeluarkan lembar
    tagihan seolah-olah notanya sudah dibayar.
  */
  const printDraft = lastReceipt?.draft ?? strukDraft;
  const strukDocument = receiptDocument(receipt, printDraft);
  /**
   * Ada penjualan yang sudah lunas: satu-satunya struk yang boleh dicetak atau
   * dikirim. Gerbang inilah yang memunculkan tombol **Cetak** & **Struk & kirim**
   * di panel keranjang — sebelumnya keduanya sudah ditawarkan sejak keranjang
   * diisi, sehingga kasir bisa menyerahkan lembar “Belum dibayar” untuk transaksi
   * yang pembayarannya belum selesai.
   */
  const strukSiap = lastReceipt !== null;

  /*
    Penjualan tempo (modul Grosir, `ar.creditlimit`). Pratinjau di sini memakai
    aturan yang sama dengan server (`@/lib/ar`), jadi kasir melihat penolakan
    (limit habis / ada piutang jatuh tempo) sebelum menekan simpan — bukan
    setelah transaksinya ditolak backend.
  */
  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;      const paid = paidNow ?? total;
  const creditAmount = Math.max(0, total - paid);
  const creditCheck =
    creditAmount > 0 && selectedCustomer
      ? decideCredit({
          customer: {
            name: selectedCustomer.name,
            creditLimit: selectedCustomer.creditLimit,
            active: selectedCustomer.active,
          },
          receivables: receivables
            .filter((row) => row.customerId === selectedCustomer.id)
            .map((row) => ({
              amount: row.amount,
              paidAmount: row.paidAmount,
              dueDate: row.dueDate,
              status: row.status,
            })),
          newDebt: creditAmount,
        })
      : null;

  /** Alasan tombol simpan dimatikan karena aturan tempo — ditampilkan ke kasir. */
  const creditBlockedReason = !creditAmount
    ? null
    : !canUseCredit
      ? "Penjualan tempo butuh modul Grosir aktif. Aktifkan dulu di halaman Modul."
      : !selectedCustomer
        ? `Sisa tagihan ${rupiah(creditAmount)} butuh pelanggan B2B; pilih pelanggannya dulu.`
        : creditCheck && !creditCheck.ok
          ? (creditCheck.reason ?? null)
          : null;

  /*
    Jalur QRIS dari keranjang: kasir memilih QRIS, menerbitkan tagihan senilai
    total keranjang, dan penjualan dicatat setelah tagihan itu lunas. Sisa tempo
    tidak digabung dengan jalur ini — tagihan digital selalu penuh senilai
    keranjang, jadi piutang tetap lewat jalur "Dibayar sekarang" seperti biasa.
  */
  const showDigitalFlow =
    method === "QRIS" && canChargeDigital && creditAmount === 0;

  /*
    Payload QRIS tagihan keranjang, dihitung sekali di sini supaya kode QR yang
    dipindai pelanggan dan salinan teksnya (untuk menelusuri masalah) selalu
    menunjuk tagihan yang sama — bukan dua perhitungan yang bisa melenceng.
  */
  const cartQrPayload = useMemo(
    () =>
      cartCharge
        ? qrPayload({
            number: cartCharge.number,
            amount: cartCharge.amount,
            merchantName: session?.tenant?.name,
          })
        : null,
    [cartCharge, session?.tenant?.name],
  );

  /** One short sentence describing the queue — shown next to the shift badge. */
  const offlineLabel = useMemo(() => {
    if (!offline.online) {
      const queued = offline.pending > 0 ? ` · ${offline.pending} menunggu` : "";
      const failed = offline.blocked > 0 ? ` · ${offline.blocked} gagal` : "";
      return `Mode offline${queued}${failed}`;
    }
    if (offline.pending > 0) return `Menyinkronkan ${offline.pending} transaksi`;
    if (offline.blocked > 0) return `${offline.blocked} transaksi gagal`;
    return "";
  }, [offline]);

  function addToCart(productId: string, name: string, price: number) {
    // Gerbang kasir: tanpa shift terbuka tidak ada barang yang masuk keranjang.
    // Tombolnya memang sudah dimatikan saat terkunci — penjagaan ini yang membuat
    // jalur lain (mis. keranjang lama yang masih tersimpan di layar) tetap tidak
    // bisa memulai penjualan baru.
    if (posLocked) return;
    const product = productById.get(productId);
    const stockLeft = available.get(productId) ?? 0;
    const inCart = cart.find(
      (l) => l.productId === productId && !l.modifiers,
    )?.qty ?? 0;
    // Ketukan yang tidak menghasilkan apa-apa dibiarkan tanpa bunyi: bip untuk
    // barang yang tidak jadi masuk justru menyesatkan kasir.
    if (inCart >= stockLeft) return;

    // Bunyi bip mesin kasir tepat saat ketukan produknya diterima — **termasuk**
    // saat yang terbuka berikutnya adalah dialog modifier, karena dari sisi kasir
    // "produk ini tercatat" sudah terjadi di situ. Satu ketukan = satu bip:
    // menyimpan pilihan modifier tidak membunyikan bip kedua.
    playScanBeep();

    // Produk bermodifier selalu lewat dialog: grup wajib tidak boleh terlewat,
    // dan pilihan topping harus disengaja, bukan diam-diam.
    if ((product?.modifiers?.length ?? 0) > 0) {
      setModifierFor({
        productId,
        name,
        groups: product?.modifiers ?? [],
        draft: {},
        lineIndex: null,
      });
      return;
    }

    setCart((prev) => {
      const existing = prev.find(
        (l) => l.productId === productId && !l.modifiers,
      );
      if (existing) {
        return prev.map((l) =>
          l === existing ? { ...l, qty: l.qty + 1 } : l,
        );
      }
      return [...prev, { productId, name, price, qty: 1 }];
    });
  }

  /** Buka dialog modifier untuk baris yang sudah ada di keranjang. */
  function editLineModifiers(line: CartLine) {
    const product = productById.get(line.productId);
    if (!product?.modifiers || product.modifiers.length === 0) return;
    const index = cart.indexOf(line);
    setModifierFor({
      productId: line.productId,
      name: line.name,
      groups: product.modifiers,
      draft: Object.fromEntries(
        (line.modifiers ?? []).map((selection) => [
          selection.groupCode,
          [...selection.optionCodes],
        ]),
      ),
      lineIndex: index >= 0 ? index : null,
    });
  }

  function toggleModifierOption(group: StoreModifierGroup, optionCode: string) {
    setModifierFor((current) => {
      if (!current) return current;
      const chosen = current.draft[group.code] ?? [];
      const already = chosen.includes(optionCode);

      let next: string[];
      if (group.maxSelect === 1) {
        next = already ? [] : [optionCode];
      } else if (already) {
        next = chosen.filter((code) => code !== optionCode);
      } else if (chosen.length >= group.maxSelect) {
        // Ganti yang paling lama dipilih supaya klik berikutnya tetap bekerja,
        // alih-alih diam saja saat batas tercapai.
        next = [...chosen.slice(1), optionCode];
      } else {
        next = [...chosen, optionCode];
      }

      return { ...current, draft: { ...current.draft, [group.code]: next } };
    });
  }

  function saveModifierDraft() {
    if (!modifierFor) return;
    const selections: StoreModifierSelection[] = Object.entries(modifierFor.draft)
      .filter(([, optionCodes]) => optionCodes.length > 0)
      .map(([groupCode, optionCodes]) => ({ groupCode, optionCodes }));

    if (modifierFor.lineIndex === null) {
      const product = productById.get(modifierFor.productId);
      setCart((prev) => [
        ...prev,
        {
          productId: modifierFor.productId,
          name: modifierFor.name,
          price: product?.price ?? 0,
          qty: 1,
          modifiers: selections,
        },
      ]);
      // Bipnya sudah berbunyi saat kartu produknya diklik; menyimpan pilihan
      // modifier tidak membunyikan bip kedua untuk barang yang sama.
    } else {
      const index = modifierFor.lineIndex;
      setCart((prev) =>
        prev.map((l, i) => (i === index ? { ...l, modifiers: selections } : l)),
      );
    }
    setModifierFor(null);
  }

  function changeQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.productId !== productId) return l;
          // Stok tercatat dalam satuan dasar, jadi batasnya dibagi faktor satuannya.
          const factor = pricedFor(productById.get(productId), l.qty, l.unitCode)?.factor ?? 1;
          const maxQty = Math.floor((available.get(productId) ?? 0) / factor);
          return { ...l, qty: Math.min(l.qty + delta, maxQty) };
        })
        .filter((l) => l.qty > 0),
    );
  }

  /** Ganti satuan baris (Pcs ↔ Dus/Pak) tanpa mengubah kuantitas yang diketik. */
  function changeUnit(productId: string, unitCode: string) {
    setCart((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, unitCode } : l)),
    );
  }

  /**
   * Menahan transaksi yang sedang berjalan (tombol **Hold**).
   *
   * Yang ditahan adalah keranjang yang **belum dibayar**: uang belum masuk, stok
   * belum bergerak, dan dapur belum menerima apa pun — jadi tahanannya cukup
   * hidup di layar kasir (perangkat ini), bukan sebagai penjualan di server.
   * Keranjangnya pindah utuh ke daftar **Transaksi ditahan** berikut meja, member,
   * dan diskonnya, lalu layar kasir siap untuk pembeli berikutnya.
   */
  function holdCart() {
    if (cart.length === 0 || posLocked) return;
    const held: HeldCart = {
      id: `hold-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      heldAt: Date.now(),
      cart,
      discount,
      tableId,
      tableName: selectedTable?.name,
      memberId,
      customerId,
      total,
      itemCount,
    };
    setHeldCarts((prev) => [...prev, held]);
    setHoldError(null);
    setHoldNotice(
      `Transaksi ${heldLabel(held)} ditahan tadi pukul ${formatClock(held.heldAt)} — lanjutkan dari daftar Transaksi ditahan, atau layani pembeli berikutnya dulu.`,
    );
    resetSale();
  }

  /**
   * Melanjutkan transaksi yang ditahan: keranjang, meja, member, dan diskonnya
   * kembali seperti saat ditahan. Harganya dihitung ulang dari katalog sekarang
   * (harga bisa sudah berubah), dan baris yang produknya sudah tidak ada lagi
   * dibuang — kasir tidak bisa menjual barang yang tidak ada di katalog.
   */
  function resumeHeld(id: string) {
    const held = heldCarts.find((row) => row.id === id);
    // Keranjang yang sedang berjalan tidak boleh tertimpa diam-diam: kasir harus
    // menahannya (Hold) atau menyelesaikannya dulu. Saat gerbang kasir tertutup,
    // transaksi yang ditahan juga tidak dilanjutkan — tidak ada gunanya mengisi
    // keranjang yang belum bisa dibayar.
    if (!held || cart.length > 0 || posLocked) return;
    const lines = held.cart.filter((line) => productById.has(line.productId));
    const dropped = held.cart.length - lines.length;

    /*
      Mejanya hanya kembali kalau masih bebas. Meja yang sudah terisi tiket lain
      (mis. tamu lain sempat membayar di situ) dilepas, bukan dipaksakan — server
      tetap akan menolaknya, dan kasir lebih baik diberi tahu sekarang.
    */
    const seatTaken =
      held.tableId !== undefined &&
      tableStatesNow.some(
        (state) => state.id === held.tableId && state.status === "occupied",
      );

    setCart(lines);
    setDiscount(held.discount);
    setTableId(seatTaken ? undefined : held.tableId);
    setMemberId(held.memberId);
    setCustomerId(held.customerId);
    setHeldCarts((prev) => prev.filter((row) => row.id !== id));
    setHoldError(null);
    setHoldNotice(
      `Transaksi ${heldLabel(held)} dilanjutkan.` +
        (seatTaken
          ? ` Mejanya sudah terisi pesanan lain, jadi transaksinya jalan tanpa meja — pilih meja lain kalau memang di situ.`
          : "") +
        (dropped > 0
          ? ` ${dropped} baris dibuang karena produknya sudah tidak ada di katalog.`
          : ""),
    );
  }

  /** Membuang transaksi yang ditahan — tidak ada jejaknya di server, jadi cukup dibuang. */
  function dropHeld(id: string) {
    const held = heldCarts.find((row) => row.id === id);
    if (!held) return;
    setHeldCarts((prev) => prev.filter((row) => row.id !== id));
    setHoldError(null);
    setHoldNotice(`Transaksi ${heldLabel(held)} dibuang — tidak ada yang tercatat karena belum dibayar.`);
  }

  /**
   * Struk penjualan yang **sudah** tersimpan, untuk dicetak sesudah lunas.
   *
   * Isinya sama dengan draft yang dilihat kasir sebelum bayar — baris barang,
   * pajak, dan uang yang diterima — kecuali nomornya kini ada dan catatan “belum
   * dibayar” tidak lagi tercetak: nota yang keluar dari printer adalah bukti
   * pembayaran, bukan pengingat tagihan.
   */
  function saleDraft(settled: { number?: string | null; total: number }): ReceiptDraft {
    return {
      ...strukDraft,
      number: settled.number ?? undefined,
      total: settled.total,
      notice: undefined,
    };
  }

  /**
   * Membuka dialog struk untuk penjualan yang baru tersimpan.
   *
   * Dipanggil dari handler pembayaran, bukan dari efek: yang ditampilkan adalah
   * `lastReceipt` yang baru disimpan, dan itu sudah ada di state saat render
   * berikutnya — tidak ada `window.print()` yang perlu menunggu DOM.
   */
  function openReceiptDialog() {
    setReceiptNotice(null);
    setReceiptError(null);
    // Nomor WA ketikan kasir untuk nota sebelumnya tidak dibawa ke nota berikutnya:
    // nomor itu milik pembeli yang baru saja dilayani, bukan pembeli berikutnya.
    setWaPhone("");
    setPdfListOpen(false);
    // Pesan printer dari nota sebelumnya tidak dibawa ke nota berikutnya: yang
    // dibaca kasir harus keadaan printer saat ini, bukan sisa galat yang lama.
    escpos.clear();
    setReceiptOpen(true);
  }

  /**
   * Struk sebagai **satu gambar PNG**, siap diserahkan ke lembar bagikan.
   *
   * Sumbernya `strukDocument` yang sama dengan berkas PDF & kertasnya, jadi isi
   * gambarnya tidak pernah berbeda dari struk yang dicetak. `null` = gambarnya tidak
   * bisa dibuat di perangkat ini (kanvas tidak ada atau menolak menggambar);
   * pemanggilnya yang memilihkan jalur lain, bukan menyerahkan berkas kosong.
   */
  async function receiptImageFile(): Promise<{
    bytes: Uint8Array;
    filename: string;
    widthPx: number;
    heightPx: number;
    logoDrawn: boolean;
    hasLogo: boolean;
  } | null> {
    /*
      Dua URL logo dicoba: yang tersimpan di struk (dibaca saat penjualannya
      terjadi) lalu yang **segar** dari store — URL berkas Convex bertanda tangan
      dan punya masa berlaku, jadi struk yang baru dikirim beberapa jam sesudahnya
      bisa membawa URL yang sudah kedaluwarsa.
    */
    const gambar = await receiptImagePng(strukDocument, {
      logoUrls: [strukDocument.logoUrl, logo?.url],
    });
    if (!gambar) return null;
    return {
      bytes: gambar.bytes,
      filename: receiptImageFileName({ number: printDraft.number ?? null }),
      widthPx: gambar.widthPx,
      heightPx: gambar.heightPx,
      logoDrawn: gambar.logoDrawn,
      hasLogo: Boolean(strukDocument.logoUrl),
    };
  }

  /**
   * Byte & nama berkas PDF struk yang sedang ditampilkan di dialog.
   *
   * `async` karena **logonya** harus dibaca dulu jadi byte keabuan
   * (`rasteriseReceiptLogo` — peramban, butuh kanvas), sedangkan penulis PDF-nya
   * sendiri tetap murni & sinkron. Kegagalan menyiapkan logo tidak pernah
   * menggagalkan struknya: `null` berarti berkasnya dibuat tanpa logo, seperti
   * sebelum kemampuan ini ada.
   */
  async function receiptPdfFile(): Promise<{ bytes: Uint8Array; filename: string }> {
    /*
      Sumbernya `strukDocument` — berkas yang sama persis dengan yang keluar dari
      printer, termasuk rangkapnya (satu halaman per lembar), catatan kakinya, dan
      logo tokonya. Judul di dalam berkas memakai nomor notanya supaya berkas yang
      sudah terunduh masih bisa dikenali tanpa membukanya.
    */
    const logo = await rasteriseReceiptLogo(strukDocument.logoUrl);
    return {
      bytes: receiptPdfBytes(strukDocument, {
        title: printDraft.number ? `Struk ${printDraft.number}` : "Struk sementara",
        logo,
      }),
      filename: receiptPdfFileName({ number: printDraft.number ?? null }),
    };
  }

  /**
   * Menyimpan byte sebagai berkas di perangkat kasir lewat tautan `blob:`.
   *
   * Tidak ada unggahan ke mana pun: berkasnya dibuat di peramban yang sedang
   * dipakai, jadi struk yang tidak jadi dikirim pun tidak meninggalkan salinan di
   * server mana pun.
   */
  function saveFile(bytes: Uint8Array, filename: string, type: string): string {
    const blob = new Blob([bytes as unknown as BlobPart], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    /*
      URL-nya **dikembalikan**, bukan langsung dilepas: URL yang sama dipakai
      daftar PDF struk supaya berkasnya bisa dibuka atau diunduh ulang dari dialog
      tanpa disusun ulang. Pelepasannya dilakukan sekaligus saat halaman ditutup
      (lihat efek pembersih di atas).
    */
    return url;
  }

  /** base64 dari byte PDF, untuk dikirim ke server (tanpa awalan data URL). */
  function bytesToBase64(bytes: Uint8Array): string {
    let biner = "";
    // Dipotong per 32 KB: `String.fromCharCode(...)` dengan panjang seluas itu
    // masih aman untuk tumpukan peramban.
    for (let index = 0; index < bytes.length; index += 0x8000) {
      biner += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return window.btoa(biner);
  }

  /** Ukuran berkas siap baca, mis. `4,2 KB`. */
  function fileSizeLabel(bytes: number): string {
    return `${(bytes / 1024).toLocaleString("id-ID", {
      maximumFractionDigits: 1,
    })} KB`;
  }

  /**
   * Menyimpan struk sebagai PDF di perangkat kasir, sekaligus mencatatnya di daftar
   * PDF sesi ini.
   *
   * Unduhan ke folder perangkat tetap yang utama — berkasnya harus benar-benar
   * tersimpan. Daftarnya melengkapi itu untuk kasir yang perlu **membuka lagi**
   * struk yang barusan dibuat (mis. pembeli minta ditunjukkan sebelum pergi),
   * yang tidak mungkin dilakukan dari folder unduhan peramban.
   */
  async function downloadReceipt() {
    if (receiptBusy) return;
    setReceiptError(null);
    try {
      const { bytes, filename } = await receiptPdfFile();
      const url = saveFile(bytes, filename, "application/pdf");
      blobUrls.current.push(url);
      pdfSeq.current += 1;
      setPdfFiles((files) => [
        {
          id: `pdf-${pdfSeq.current}`,
          filename,
          url,
          size: bytes.length,
          label: printDraft.number ? `Nota ${printDraft.number}` : "Struk sementara",
        },
        ...files,
      ]);
      setReceiptNotice(
        `PDF ${filename} (${fileSizeLabel(bytes.length)}) disimpan di perangkat ini, dan masuk ke daftar PDF struk untuk dibuka lagi.`,
      );
    } catch (error) {
      setReceiptError(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Member penerima struk terakhir: dari `memberId` yang ikut tersimpan bersama
   * penjualannya — bukan dari pilihan keranjang yang sudah dikosongkan.
   */
  const receiptMember = lastReceipt?.memberId
    ? (members.find((row) => row.id === lastReceipt.memberId) ?? null)
    : null;

  /**
   * Isi pesan WhatsApp untuk struk yang sedang ditampilkan.
   *
   * Dipakai dua kali: dikirim bersama lampirannya lewat kanal WhatsApp, dan
   * sebagai teks tautan `wa.me` kalau kanalnya belum tersambung.
   */
  const receiptCaption = receiptWhatsappCaption({
    business: session?.tenant?.name ?? "MesinPOS",
    store: session?.tenant?.storeName,
    number: printDraft.number ?? null,
    when: printDraft.when ?? null,
    member: receiptMember?.name ?? printDraft.member ?? null,
    total: printDraft.total,
  });

  /**
   * Isi struk sebagai teks WhatsApp — baris-baris yang **sama** dengan yang keluar
   * di kertas (lembar pertama/ASLI), bukan ringkasan.
   *
   * Dipakai dua jalur yang tidak mengirim berkas lewat kanal WhatsApp: tautan
   * cadangan `wa.me` dan lembar bagikan perangkat. Tautan `wa.me` memang tidak bisa
   * membawa lampiran, jadi isi struk itulah satu-satunya yang benar-benar sampai
   * ke pembeli lewat jalur itu — dan struknya memang sudah punya nomor nota,
   * tanggal, nama kasir, dan total di dalam dirinya sendiri.
   */
  const receiptWaText = receiptWhatsappReceiptMessage(
    lastReceipt ? (strukDocument.sheets[0]?.lines ?? []) : [],
  );

  /**
   * Nomor WA yang diketik kasir, sudah dinormalkan & divalidasi dengan aturan yang
   * sama dengan halaman Member. Dipakai hanya kalau membernya belum punya nomor.
   */
  const typedWaPhone = normalizePhone(waPhone);

  /**
   * Struk yang sudah lunas tapi nomor tujuannya belum ada — member yang belum
   * mengisi nomornya, **atau** penjualan tanpa member sama sekali (pembeli umum).
   * Di dua keadaan itulah kolom nomor WA ditawarkan ke kasir, supaya struknya tetap
   * bisa dikirim tanpa menunggu profil membernya dilengkapi.
   */
  const needsWaPhone =
    lastReceipt !== null && (receiptMember === null || !receiptMember.phone);

  /**
   * Penerima struknya disebut apa di layar: nama membernya, atau “pembeli umum”
   * untuk penjualan yang memang tidak punya member.
   */
  const receiptBuyerLabel = receiptMember
    ? `member ${receiptMember.name}`
    : "pembeli umum";

  /**
   * Nomor tujuan yang benar-benar dipakai: nomor tersimpan di data member selalu
   * menang, nomor ketikan kasir hanya jadi cadangan. Kosong = tidak ada tujuan.
   */
  const effectiveWaPhone =
    receiptMember?.phone ?? (typedWaPhone.valid ? (typedWaPhone.value ?? "") : "");

  /**
   * Tautan cadangan `wa.me` — hanya kalau memang ada nomor tujuan.
   *
   * Pesannya adalah **isi struknya sendiri** (`receiptWaText`), bukan ringkasan:
   * ini jalur untuk workspace yang kanal WhatsApp-nya belum tersambung, dan di
   * jalur itu angka belanjanya harus tetap sampai ke pembeli walaupun lampiran
   * PDF-nya tidak bisa dibawa tautan.
   */
  const receiptWaLink = effectiveWaPhone
    ? receiptWhatsappLink(effectiveWaPhone, receiptWaText)
    : null;

  /*
    Ringkasan transaksi shift ini dihitung dari daftar yang benar-benar ditampilkan
    (`sales`, terbaru dulu) — bukan dari ringkasan laporan. Jadi angka di tombol & di
    lembar selalu sama dengan jumlah baris yang bisa dilihat kasir di sana.
  */
  const salesTotal = sales.reduce((sum, sale) => sum + sale.total, 0);
  const salesItemCount = sales.reduce((sum, sale) => sum + sale.itemCount, 0);

  /**
   * Mengirim PDF struk ke WhatsApp penerimanya: member yang dipilih di keranjang,
   * atau — untuk penjualan **tanpa member** — pembeli umum lewat nomor yang diketik
   * kasir di dialog ini.
   *
   * Nomor member **tidak** dikirim dari sini kalau membernya sudah punya nomor:
   * server mengambilnya dari data member yang mengisi sendiri nomor itu di halaman
   * Member. Yang jalan dari klien cuma berkasnya, karena struknya memang dibuat di
   * perangkat kasir.
   */
  async function sendReceiptToMember() {
    if (receiptBusy || lastReceipt === null) return;
    if (waPhone.trim() !== "" && !typedWaPhone.valid) {
      setReceiptNotice(null);
      setReceiptError(
        typedWaPhone.reason ?? "Nomor WhatsApp yang diketik kasir tidak valid.",
      );
      return;
    }
    if (!effectiveWaPhone) {
      setReceiptNotice(null);
      setReceiptError(
        receiptMember
          ? `Member ${receiptMember.name} belum mengisi nomor WhatsApp. Isi nomornya di kolom “Nomor WhatsApp” pada dialog ini, lalu kirim ulang struknya.`
          : "Struk pembeli umum ini belum punya nomor tujuan. Isi kolom “Nomor WhatsApp pembeli” dengan nomor yang diberikan pembelinya, lalu kirim ulang struknya.",
      );
      return;
    }

    setReceiptBusy(true);
    setReceiptError(null);
    setReceiptNotice(null);
    try {
      /*
        Yang dikirim **gambarnya saja** — PNG berlogo yang sama dengan tombol
        *Bagikan gambar struk*. Lewat pesan dokumen, logo tokonya hanya terlihat
        kalau penerimanya membuka lampiran PDF-nya; lewat pesan gambar, struknya
        beserta logonya tampil langsung di percakapan. PDF struknya tidak hilang:
        kasir tetap bisa mengunduhnya lewat **Unduh PDF**.
      */
      const gambarStruk = await receiptImageFile();
      if (!gambarStruk) {
        setReceiptNotice(
          "Perangkat ini tidak bisa menggambar struk jadi gambar, dan yang dikirim ke WhatsApp memang gambarnya — pakai Unduh PDF, lalu lampirkan sendiri berkasnya di percakapan WhatsApp.",
        );
        return;
      }
      const hasil = await sendReceiptWhatsapp({
        // Kosong = pembeli umum: servernya menyimpulkan penerimanya dari `phone`.
        memberId: receiptMember?.id,
        saleNumber: printDraft.number ?? undefined,
        filename: gambarStruk.filename,
        caption: receiptCaption,
        imageBase64: bytesToBase64(gambarStruk.bytes),
        // Nomor ketikan kasir ikut hanya kalau membernya memang belum punya nomor
        // (untuk pembeli umum, itu satu-satunya nomor yang ada).
        phone: receiptMember?.phone ? undefined : (typedWaPhone.value ?? undefined),
      });
      if (hasil.ok) {
        const ringkasGambar = `gambar struk ${gambarStruk.filename} (${gambarStruk.widthPx}×${gambarStruk.heightPx} px, ${fileSizeLabel(gambarStruk.bytes.length)}, berlogo)`;
        setReceiptNotice(
          hasil.simulated
            ? `Mode demo — pengiriman struk ke WhatsApp ${hasil.to} (${receiptBuyerLabel}) disimulasikan (${ringkasGambar}), tidak ada pesan yang benar-benar keluar.`
            : `Struk ${formatIDR(printDraft.total)} terkirim ke WhatsApp ${hasil.to} (${receiptBuyerLabel}) — ${ringkasGambar}, jadi logo tokonya tampil di percakapan.`,
        );
        return;
      }
      setReceiptError(hasil.reason);
    } catch (error) {
      setReceiptError(error instanceof Error ? error.message : String(error));
    } finally {
      setReceiptBusy(false);
    }
  }

  /**
   * Menyerahkan struk sebagai **satu berkas gambar** ke lembar bagikan perangkat:
   * inilah satu-satunya jalur berbagi struk, dipakai “Bagikan gambar struk”.
   *
   * Kenapa **hanya gambar**, bukan PDF: di Android, lembar bagikan yang membawa
   * berkas campuran tipe (PDF + logo PNG) diserahkan sebagai satu intent bertipe
   * **umum** — bukan `image/png` maupun `application/pdf` — dan WhatsApp bisa
   * mengambil berkas pertamanya saja, jadi logonya tidak pernah terlihat di
   * percakapan, walaupun aplikasi sudah menyerahkannya. Struk PDF pun hanya tampil
   * sebagai nama berkas, bukan isinya.
   * Dengan **satu berkas gambar**, tipe intent-nya `image/png`: WhatsApp
   * menampilkannya sebagai foto, dan logo tokonya sudah ada di dalam gambarnya.
   * Isi struknya ikut sebagai teks pesan (`receiptWaText`), jadi penerimanya bisa
   * membaca angkanya tanpa membuka gambarnya. PDF tetap bisa diminta sendiri lewat
   * “Unduh PDF” (di sana struknya memakai jalur logo PDF yang sama).
   *
   * Yang dilaporkan tetap kejadiannya, bukan harapan: berkasnya **diserahkan** ke
   * lembar bagikan. Perangkat yang tidak bisa menggambar kanvas atau tidak punya
   * lembar bagikan berkas dijawab apa adanya beserta jalur yang tetap bekerja
   * (gambarnya diunduh, lalu dilampirkan dari galeri).
   */
  async function bagikanGambarStruk() {
    if (shareBusy || lastReceipt === null) return;
    setReceiptError(null);
    setReceiptNotice(null);
    setShareBusy(true);
    try {
      const gambar = await receiptImageFile();
      if (!gambar) {
        setReceiptNotice(
          "Perangkat ini belum bisa menggambar struk jadi gambar (kanvas tidak tersedia) — pakai Unduh PDF, lalu lampirkan berkasnya di percakapan WhatsApp.",
        );
        return;
      }
      const berkasGambar = new File([gambar.bytes as unknown as BlobPart], gambar.filename, {
        type: "image/png",
      });
      const adaLembarBagikan =
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [berkasGambar] });
      /*
        Tanpa lembar bagikan berkas, gambarnya **diunduh** — bukan sekadar
        diberitahukan. Berkasnya satu gambar biasa, jadi setelah tersimpan di
        perangkat kasir ia bisa dilampirkan dari galeri seperti foto lain.
      */
      if (!adaLembarBagikan) {
        const url = saveFile(gambar.bytes, gambar.filename, "image/png");
        blobUrls.current.push(url);
        setReceiptNotice(
          `Perangkat ini tidak menyediakan lembar bagikan berkas gambar — gambarnya diunduh saja (${gambar.filename}, ${fileSizeLabel(gambar.bytes.length)}); lampirkan dari galeri ke percakapan WhatsApp.`,
        );
        return;
      }
      await navigator.share({
        files: [berkasGambar],
        title: printDraft.number ? `Struk ${printDraft.number}` : "Struk belanja",
        text: receiptWaText,
      });
      // Logo yang tidak tergambar disebut sebabnya, sama seperti jalur PDF — dan
      // yang tergambar disebut juga, supaya kasir tahu gambar ini sudah berlogonya.
      const catatanLogo = gambar.logoDrawn
        ? " Logo tokonya ada di dalam gambarnya."
        : gambar.hasLogo
          ? " Logo tokonya tidak ikut: gambarnya tidak bisa dibaca dari perangkat ini."
          : "";
      setReceiptNotice(
        `Gambar ${gambar.filename} (${gambar.widthPx}×${gambar.heightPx} px, ${fileSizeLabel(gambar.bytes.length)}) diserahkan ke lembar bagikan perangkat — pilih WhatsApp lalu nomor penerimanya. Satu berkas gambar, jadi WhatsApp menampilkannya sebagai foto. Isi struknya juga ikut sebagai teks pesannya.${catatanLogo}`,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setReceiptNotice("Berbagi gambar dibatalkan — tidak ada berkas yang terkirim.");
        return;
      }
      setReceiptError(error instanceof Error ? error.message : String(error));
    } finally {
      setShareBusy(false);
    }
  }

  function resetSale() {
    setCart([]);
    setDiscount(0);
    setTableId(undefined);
    setCash(0);
    setMethod("Tunai");
    setCustomerId(undefined);
    setPaidNow(null);
    setMemberId(undefined);
    setMemberQuery("");
    setPayOpen(false);
    setPayError(null);
    setCartCharge(null);
  }

  /**
   * Terbitkan tagihan QRIS untuk keranjang ini. Nominal, metode, dan
   * keterangannya datang dari aturan bersama `@/lib/payments` — kasir tidak
   * mengetik nominalnya, sedangkan nomor `DIG-…` dan tenggatnya ditetapkan
   * server.
   */
  async function issueCartCharge() {
    if (cart.length === 0 || paying) return;
    /*
      Gerbang kasir diperiksa lagi di sini: shift bisa saja ditutup dari tab
      lain sementara dialog pembayaran masih terbuka (`storage` di atas membaca
      ulang keadaannya) — tagihan atas nama shift yang sudah tutup tidak boleh
      diterbitkan.
    */
    if (posLocked) {
      setPayError(shiftGate.message);
      return;
    }
    setPayError(null);

    const draft = validateCartCharge(
      {
        total,
        lines: cart.map((l) => ({ name: l.name, quantity: l.qty })),
      },
      { digital: canChargeDigital, planName: digitalPlan.planName },
    );
    if (!draft.ok) {
      setPayError(draft.reason);
      return;
    }

    setPaying(true);
    try {
      const created = await createDigitalCharge({
        amount: draft.value.amount,
        method: draft.value.method,
        reference: draft.value.reference ?? undefined,
      });
      setCartCharge({
        id: created.id,
        number: created.number,
        method: draft.value.method,
        amount: draft.value.amount,
        expiresAt: created.expiresAt,
        status: "pending",
      });
    } catch (error) {
      setPayError(error instanceof Error ? error.message : String(error));
    } finally {
      setPaying(false);
    }
  }

  /**
   * Kasir memastikan uangnya sudah masuk: tagihannya dilunasi **lalu** penjualan
   * dicatat dengan menunjuk tagihan itu (`digitalChargeId`). Urutannya sengaja
   * begitu — uang masuk lebih dulu, dan kalau penyimpanan penjualannya gagal,
   * tagihannya tetap tercatat lunas sehingga kasir tinggal menyimpannya lagi,
   * bukan menagih pelanggan dua kali.
   */
  async function settleCartCharge() {
    if (!cartCharge || paying) return;
    // Sama seperti dua jalur pembayaran lain: shift yang sudah tutup menutup
    // jalan menyimpan penjualannya — walau tagihannya sudah terlanjur lunas.
    if (posLocked) {
      setPayError(shiftGate.message);
      return;
    }
    setPayError(null);

    // Keranjang yang berubah setelah tagihan terbit harus dibuatkan tagihan baru;
    // aturannya sama dengan yang diuji server saat penjualannya disimpan.
    const matches = checkCartMatchesCharge(cartCharge, total);
    if (!matches.ok) {
      setPayError(matches.reason);
      return;
    }

    let settled = cartCharge.status === "paid";
    setPaying(true);
    try {
      if (!settled) {
        await actDigitalCharge({
          chargeId: cartCharge.id,
          action: "settle",
          amount: cartCharge.amount,
        });
        settled = true;
        setCartCharge((current) =>
          current ? { ...current, status: "paid" } : current,
        );
      }

      const receipt = await createSale({
        items: cart.map((l) => ({
          productId: l.productId,
          quantity: l.qty,
          unitCode: l.unitCode,
          modifiers: l.modifiers,
        })),
        discount: discountApplied,
        method,
        tableId,
        memberId,
        // Penjualan ini lahir dari tagihan yang sudah lunas: server memeriksa
        // ulang status & nominalnya sebelum mencatatnya.
        digitalChargeId: cartCharge.id,
      });
      setLastReceipt({
        ...receipt,
        draft: saleDraft(receipt),
        memberId,
        digital: cartCharge.number,
        kitchenFired: receipt.kitchenFired,
      });
      resetSale();
      openReceiptDialog();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPayError(
        settled
          ? `Tagihan ${cartCharge.number} sudah lunas, tetapi penjualannya belum tersimpan: ${message} Tekan simpan sekali lagi setelah masalahnya dibereskan.`
          : message,
      );
    } finally {
      setPaying(false);
    }
  }

  /** Batalkan tagihan yang belum dibayar — pelanggannya batal memindai. */
  async function cancelCartCharge() {
    if (!cartCharge || paying) return;
    setPaying(true);
    setPayError(null);
    try {
      await actDigitalCharge({
        chargeId: cartCharge.id,
        action: "cancel",
        reason: "Dibatalkan di kasir",
      });
      setCartCharge(null);
    } catch (error) {
      setPayError(error instanceof Error ? error.message : String(error));
    } finally {
      setPaying(false);
    }
  }

  async function confirmPayment() {
    if (cart.length === 0 || paying) return;
    // QRIS pada tenant dengan kanal tagih digital tidak lewat sini: tombolnya
    // digantikan alur tagihan (`issueCartCharge`/`settleCartCharge`).
    if (showDigitalFlow) return;
    // Shift yang ditutup dari tab lain ikut menutup pembayaran ini (lihat
    // `issueCartCharge`): penjualan tanpa shift terbuka tidak boleh tersimpan.
    if (posLocked) {
      setPayError(shiftGate.message);
      return;
    }
    setPaying(true);
    setPayError(null);
    try {
      const receipt = await createSale({
        items: cart.map((l) => ({
          productId: l.productId,
          quantity: l.qty,
          unitCode: l.unitCode,
          modifiers: l.modifiers,
        })),
        discount: discountApplied,
        method,
        // Penjualan meja sekali bayar (walk-in) tetap mencatat mejanya.
        tableId,
        // Diskon member: persentasenya diambil server dari data member.
        memberId,
        // Tempo: pelanggan penanggung tagihan + jumlah yang benar-benar dibayar.
        // Sisanya dicatat server sebagai piutang setelah limitnya diperiksa.
        customerId: creditAmount > 0 ? (customerId ?? undefined) : undefined,
        paidAmount: creditAmount > 0 ? paid : undefined,
      });
      setLastReceipt({
        ...receipt,
        draft: saleDraft(receipt),
        memberId,
        credit: creditAmount > 0 ? creditAmount : undefined,
        customerName:
          creditAmount > 0 ? (selectedCustomer?.name ?? undefined) : undefined,
        kitchenFired: receipt.kitchenFired,
      });
      resetSale();
      /*
        Dialog struknya langsung terbuka begitu penjualannya tersimpan: di depan
        antrean, kasir tidak boleh perlu mencari tombol lagi untuk hal yang selalu
        dikerjakan sesudah pembayaran — dan sekarang yang dikerjakan itu bisa
        dicetak, diunduh, atau dikirim ke WhatsApp pembelinya.
      */
      openReceiptDialog();
    } catch (error) {
      setPayError(error instanceof Error ? error.message : String(error));
    } finally {
      setPaying(false);
    }
  }

  return (
    /*
      `grid-cols-1` **wajib**, bukan hiasan: tanpa kolom eksplisit, grid memakai
      satu kolom implisit ber-ukuran `auto` yang melebar sampai `max-content`
      isinya. Di HP, keranjang (header “Pesanan” + baris tombol) lebih lebar dari
      layar, jadi kolomnya ikut melebar dan isi halaman terpotong di tepi kanan
      (kasir meluap 28 px di lebar 360 px). Dengan `grid-cols-1` kolomnya `1fr`
      yang tidak pernah melewati wadahnya; kolom 380 px tetap dipakai dari `xl`.
    */
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
      {/*
        Kertas printer struk, diatur **otomatis** dari setelan workspace: lebar
        kertasnya (58/76/80/241 mm) dan tinggi notanya ditulis sebagai aturan
        `@page`, jadi dialog cetak peramban sudah terbuka dengan kertas selebar
        struknya — kasir tidak perlu memilih ukuran kertas, dan struknya tidak
        lagi tercetak di halaman A4. Ukuran huruf lembar cetaknya juga datang dari
        sini supaya tinggi yang dihitung & yang dicetak tidak bisa berbeda.
      */}
      <style data-testid="struk-kertas-css">{receiptPrintCss(strukDocument)}</style>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {openShift ? (
              <Badge className="gap-1.5">
                <span className="size-1.5 rounded-full bg-primary" />
                Shift terbuka
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1.5">
                <Lock className="size-3" />
                Kas belum dibuka
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {openShift
                ? `Kasir: ${session?.user?.name ?? "—"} · buka ${shiftClockLabel(shiftOpenedMs)}`
                : "Buka shift di halaman Shift & Kas untuk membuka kasir: uang kembalian & setoran harinya tercatat."}
            </span>
            {offlineLabel && (
              <button
                type="button"
                onClick={() => void offline.sync()}
                title="Sinkronkan transaksi tersimpan"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  offline.blocked > 0
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-accent/40 bg-accent/10 text-accent",
                )}
              >
                {offline.online ? (
                  <RefreshCw className="size-3" />
                ) : (
                  <CloudOff className="size-3" />
                )}
                {offlineLabel}
              </button>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={beep.enabled}
              aria-label="Bunyi bip saat produk diklik"
              title={
                beep.enabled
                  ? `Bunyi bip kasir aktif di perangkat ini (volume ${scanBeepVolumeLabel(beep.volume)}) — klik untuk mematikan`
                  : "Bunyi bip kasir mati di perangkat ini — klik untuk menyalakan"
              }
              onClick={() => {
                const next = !beep.enabled;
                beep.setEnabled(next);
                // Menyalakan langsung diperdengarkan: kasir tahu bunyinya seperti
                // apa, sekaligus cara memastikan pengeras suaranya memang hidup.
                if (next) beep.preview();
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
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
              Bip kasir {beep.enabled ? "aktif" : "mati"}
            </button>
            {/*
              Kontrol volume tepat di sebelah tombolnya: kasir yang merasa bipnya
              terlalu pelan di ruang ramai (atau terlalu keras saat ruangan sepi)
              bisa menaikkan/menurunkannya **tanpa keluar dari halaman kasir** —
              halaman Pengaturan dijaga izin `billing.manage` yang tidak dimiliki
              kasir. Tiap tekan langsung membunyikan nada dengan volume barunya,
              supaya yang mengatur mendengar akibatnya saat itu juga. Kontrolnya
              disembunyikan saat bipnya mati: yang senyap tidak punya keras.
            */}
            {beep.enabled && (
              <div
                role="group"
                aria-label="Volume bip kasir"
                className="inline-flex items-center gap-0.5 rounded-full border border-border/70 px-1 py-0.5"
              >
                <button
                  type="button"
                  aria-label="Kecilkan volume bip"
                  title={
                    beep.volume <= SCAN_BEEP_VOLUME_MIN
                      ? "Volume bip sudah paling pelan"
                      : "Satu tingkat lebih pelan"
                  }
                  disabled={beep.volume <= SCAN_BEEP_VOLUME_MIN}
                  onClick={() => {
                    beep.decreaseVolume();
                    beep.preview();
                  }}
                  className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  <Minus className="size-3" />
                </button>
                <span
                  data-testid="pos-beep-volume"
                  className="min-w-9 text-center text-[11px] font-medium tabular-nums text-muted-foreground"
                >
                  {scanBeepVolumeLabel(beep.volume)}
                </span>
                <button
                  type="button"
                  aria-label="Besarkan volume bip"
                  title={
                    beep.volume >= SCAN_BEEP_VOLUME_MAX
                      ? "Volume bip sudah paling keras"
                      : "Satu tingkat lebih keras"
                  }
                  disabled={beep.volume >= SCAN_BEEP_VOLUME_MAX}
                  onClick={() => {
                    beep.increaseVolume();
                    beep.preview();
                  }}
                  className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  <Plus className="size-3" />
                </button>
              </div>
            )}
          </div>
          <div className="w-full sm:w-64">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari produk / scan barcode"
                className="pl-8"
              />
            </div>
          </div>
        </div>

        {/*
          Gerbang kasir (`posShiftGate` di `@/lib/shift`). Ini yang dibaca kasir
          lebih dulu saat kasnya belum dibuka: tanpa shift terbuka seluruh
          pekerjaan menjual di halaman ini mati, jadi jalan keluarnya (buka
          shift) ditawarkan di pesan yang sama — bukan tersembunyi di balik
          tombol-tombol yang mati. Peran yang tidak memegang `shift.manage`
          mendapat pesan lain: jalan keluarnya bukan halaman itu, melainkan
          izinnya.
        */}
        {posLocked && (
          <div
            data-testid="pos-gerbang-shift"
            data-level="locked"
            role="alert"
            className="mt-4 flex flex-wrap items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive"
          >
            <Lock className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium">{shiftGate.title}</p>
              <p className="text-xs opacity-90">
                {canManageShift
                  ? shiftGate.message
                  : "Buka shift dilakukan dari halaman Shift & Kas, dan Anda belum memegang izin “Membuka & menutup shift kas”. Minta pemilik atau manajer memberi izin itu (Tim & Peran), atau minta ia membuka shift untuk kas ini."}
              </p>
            </div>
            {/*
              Di layar HP, tautannya turun ke barisnya sendiri (`w-full`): kalau
              dipaksa sebaris, kolom teksnya yang terjepit jadi segelintir kata
              per baris — dan pesan gerbang ini justru yang paling perlu dibaca.
              Tanpa izin, tautannya tidak dipasang sama sekali.
            */}
            {canManageShift && (
              <Button asChild variant="accent" size="sm" className="w-full shrink-0 sm:w-auto">
                <Link to="/app/shift">{shiftGate.cta} →</Link>
              </Button>
            )}
          </div>
        )}

        {/*
          Jangan-lupa-tutup-shift. Kasir yang menutup toko adalah orang yang sama
          yang memegang kasnya, jadi peringatannya ditaruh di layar tempat ia
          bekerja: begitu jam tutup yang diatur pemilik toko terlewat, ia
          diingatkan menutup shift sebelum pulang supaya uang fisiknya dicocokkan
          dan Z-report hari itu tidak hilang. Ambang & kalimatnya dari
          `@/lib/shift`, setelannya dari halaman Pengaturan — sama dengan yang
          tampil di halaman Shift & Kas.
        */}
        {shiftNotice && (
          <div
            data-testid="kasir-ingat-tutup-shift"
            data-level={shiftNotice.level}
            className={cn(
              "mt-4 flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3",
              shiftNotice.level === "late"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-accent/40 bg-accent/10 text-accent",
            )}
          >
            <AlarmClock className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium">{shiftNotice.title}</p>
              <p className="text-xs opacity-90">{shiftNotice.message}</p>
            </div>
            <Link
              to="/app/shift"
              className="w-full shrink-0 pl-7 text-xs font-medium underline underline-offset-4 sm:w-auto sm:pl-0"
            >
              {shiftNotice.cta} →
            </Link>
          </div>
        )}

        {/*
          Kabar yang pergi ke **pemilik toko** (`useShiftOwnerAlert`): kas belum
          dibuka di jam operasional, atau shift belum ditutup padahal toko sudah
          tutup. Kasir melihatnya karena ia yang memegang kasnya — dan supaya ia
          tahu apa yang benar-benar terjadi dengan kabarnya: terkirim, hari itu
          sudah pernah, atau belum sampai karena endpoint webhook pemilik belum ada.
        */}
        {ownerAlert.alert && (
          <div
            data-testid="pos-pemberitahuan-pemilik"
            data-status={ownerAlert.status}
            role="status"
            className={cn(
              "mt-4 flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3",
              ownerAlert.alert.kind === "shift-open"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-accent/40 bg-accent/10 text-accent",
            )}
          >
            <BellRing className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium">
                {ownerAlert.alert.title} · {shiftOwnerAlertStatusLabel(ownerAlert.status)}
              </p>
              <p className="text-xs opacity-90">{ownerAlert.alert.message}</p>
              {ownerAlert.notice && (
                <p data-testid="pos-pemberitahuan-pemilik-catatan" className="text-xs opacity-75">
                  {ownerAlert.notice}
                </p>
              )}
            </div>
            <Link
              to="/app/shift"
              className="w-full shrink-0 pl-7 text-xs font-medium underline underline-offset-4 sm:w-auto sm:pl-0"
            >
              Buka Shift & Kas →
            </Link>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {categoryChips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                category === c
                  ? "border-primary/50 bg-primary/12 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>

        {upgradeHint && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              <strong className="text-foreground">Table Management</strong>{" "}
              tersedia di paket Professional ke atas.
            </span>
            <button
              type="button"
              onClick={() => setUpgradeHint(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((p) => {
            const stockLeft = available.get(p.id) ?? 0;
            const out = stockLeft <= 0;
            const foto = p.images?.[0]?.url;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => addToCart(p.id, p.name, p.price)}
                /*
                  Dua sebab tombolnya mati: stoknya habis, atau kasirnya masih
                  terkunci karena shiftnya belum dibuka (`posShiftGate`).
                */
                disabled={out || posLocked}
                title={posLocked ? shiftGate.hint : undefined}
                className={cn(
                  "flex flex-col rounded-lg border border-border/70 bg-card text-left transition-colors",
                  adaGambar ? "overflow-hidden" : "justify-between p-3",
                  out || posLocked
                    ? "cursor-not-allowed opacity-50"
                    : "hover:border-primary/50 hover:bg-primary/5",
                )}
              >
                {/*
                  Gambar produk membantu kasir mencocokkan barang yang dipegang
                  pembeli, terutama saat namanya mirip. Produk tanpa foto (atau
                  katalog yang belum punya gambar sama sekali) memakai kartu
                  ringkas seperti semula.
                */}
                {adaGambar && (
                  <span className="block aspect-[4/3] w-full overflow-hidden bg-secondary/40">
                    {foto ? (
                      <img
                        src={foto}
                        alt={`Gambar produk ${p.name}`}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <span
                        role="img"
                        aria-label={`Belum ada gambar ${p.name}`}
                        className="grid size-full place-items-center text-muted-foreground"
                      >
                        <ImageOff className="size-5" />
                      </span>
                    )}
                  </span>
                )}
                <span
                  className={cn(
                    "flex flex-1 flex-col",
                    adaGambar ? "justify-between gap-2 p-3" : undefined,
                  )}
                >
                  <span className="text-sm font-medium leading-snug">
                    {p.name}
                    {(p.modifiers?.length ?? 0) > 0 && (
                      <span className="mt-0.5 block text-[11px] font-normal text-primary">
                        {(p.modifiers ?? []).length} grup pilihan
                      </span>
                    )}
                  </span>
                  <span className={cn("flex items-center justify-between", !adaGambar && "mt-3")}>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatIDR(p.price)}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[11px]",
                        out
                          ? "text-destructive"
                          : stockLeft <= 5
                            ? "text-accent"
                            : "text-muted-foreground",
                      )}
                    >
                      {out ? "Habis" : `stok ${stockLeft}`}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}

          {!canUseTables && (
            <button
              type="button"
              onClick={() => setUpgradeHint(true)}
              className="flex flex-col items-start justify-between rounded-lg border border-dashed border-border bg-secondary/20 p-3 text-left transition-colors hover:border-accent/50"
            >
              <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <UtensilsCrossed className="size-4" />
                Table Management
              </span>
              <span className="mt-3 inline-flex items-center gap-1 text-[11px] text-accent">
                <Lock className="size-3" /> Professional
              </span>
            </button>
          )}
        </div>

        {canSendToKitchen && (
          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <div>
              <h2 className="text-sm font-semibold">Meja</h2>
              {tableStatesNow.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Denah meja masih kosong — tambah meja di halaman Dapur &amp; Meja.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setTableId(undefined)}
                    disabled={posLocked}
                    title={posLocked ? shiftGate.hint : undefined}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      posLocked
                        ? "cursor-not-allowed border-border/60 bg-secondary/30 text-muted-foreground opacity-60"
                        : tableId === undefined
                          ? "border-primary/50 bg-primary/12 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="font-medium">Tanpa meja</span>
                    <span className="block font-mono text-[11px]">bungkus</span>
                  </button>
                  {tableStatesNow
                    .filter((state) => state.active)
                    .map((state) => {
                      // Meja terkunci karena dua sebab: ada tiket dapur yang
                      // menunggu di situ, atau transaksi yang sedang ditahan
                      // memakai meja itu. Keduanya berarti tamunya masih duduk.
                      const parked = parkedTables.get(state.id);
                      const taken = state.status === "occupied" || Boolean(parked);
                      return (
                        <button
                          key={state.id}
                          data-testid={`pos-meja-${state.id}`}
                          data-meja-terkunci={taken ? "true" : "false"}
                          type="button"
                          onClick={() => setTableId(state.id)}
                          disabled={taken || posLocked}
                          title={
                            posLocked
                              ? shiftGate.hint
                              : parked
                                ? `Meja ${state.name} dipakai transaksi yang ditahan (${heldLabel(parked)}) — lanjutkan atau buang transaksinya dulu`
                                : state.status === "occupied"
                                  ? `Terisi ${state.orderNumber}${
                                      state.paid
                                        ? " · sudah dibayar, tunggu dapur menekan Selesai"
                                        : ""
                                    }`
                                  : tableLabel(state)
                          }
                          className={cn(
                            "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                            posLocked
                              ? "cursor-not-allowed border-border/60 bg-secondary/30 text-muted-foreground opacity-60"
                              : taken
                                ? "cursor-not-allowed border-border/60 bg-secondary/30 text-muted-foreground"
                                : tableId === state.id
                                  ? "border-primary/50 bg-primary/12 text-primary"
                                  : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <span className="font-medium">{state.name}</span>
                          <span className="block font-mono text-[11px]">
                            {parked
                              ? "ditahan"
                              : state.status === "occupied"
                                ? state.orderNumber
                                : `${state.seats} kursi`}
                          </span>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>

            <div>
              <h2 className="text-sm font-semibold">Pesanan di dapur</h2>
              {kdsTickets.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Belum ada pesanan menunggu.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {kdsTickets.map((ticket) => (
                    <li
                      key={ticket.saleId}
                      className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-card px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-mono">{ticket.number}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {ticket.tableName ? `Meja ${ticket.tableName}` : "Bungkus"}
                        </span>
                        {/*
                          Pesanan yang sudah lunas tetap terlihat di sini — kasir
                          perlu tahu pesanannya sudah diterima dapur — tetapi
                          ditandai, supaya tidak terbaca sebagai tagihan yang masih
                          menunggu uang.
                        */}
                        {ticket.settled && (
                          <span
                            data-testid={`pos-dapur-lunas-${ticket.saleId}`}
                            className="ml-2 text-xs text-primary"
                          >
                            sudah lunas
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {ticket.waitingMinutes} mnt
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/*
          Transaksi yang ditahan (tombol **Hold**). Bagian ini tidak digerbangi
          modul F&B: menahan transaksi adalah cara kerja kasir di semua jenis
          usaha — yang ditahan adalah keranjang yang belum dibayar, bukan pesanan
          dapur.
        */}
        {heldCarts.length > 0 && (
          <section className="mt-6" data-testid="pos-ditahan">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Transaksi ditahan</h2>
              <span className="text-xs text-muted-foreground">
                {heldCarts.length} transaksi
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Keranjang yang ditahan belum dibayar dan belum masuk dapur — stok
              belum bergerak. Meja yang dipilihnya ikut ditahan selama transaksinya
              ada di sini.
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {heldCarts.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  <div className="text-sm font-medium">
                    {row.tableName ? `Meja ${row.tableName}` : "Tanpa meja (bungkus)"}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {row.itemCount} item · {formatIDR(row.total)} · ditahan{" "}
                    {formatClock(row.heldAt)}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`pos-lanjutkan-${row.id}`}
                      onClick={() => resumeHeld(row.id)}
                      disabled={cart.length > 0 || posLocked}
                      title={
                        posLocked
                          ? shiftGate.hint
                          : cart.length > 0
                            ? "Keranjang yang sekarang masih berisi — tahan (Hold) atau selesaikan dulu sebelum melanjutkan transaksi lain"
                            : "Kembalikan transaksi ini ke keranjang kasir"
                      }
                    >
                      <Play className="size-4" />
                      Lanjutkan
                    </Button>
                    <button
                      type="button"
                      data-testid={`pos-buang-${row.id}`}
                      onClick={() => dropHeld(row.id)}
                      title="Buang transaksi yang ditahan ini — tidak ada yang tercatat karena belum dibayar"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                      Buang
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className="flex flex-col rounded-lg border border-border bg-card">
        <div className="border-b border-border/70 px-4 py-3">
          <div className="text-sm font-semibold">
            Pesanan {itemCount > 0 ? "baru" : "—"}
          </div>
          {/*
            Jumlah item keranjang punya alamatnya sendiri (`data-testid`): angka ini
            dipakai harness untuk membuktikan ketukan produk benar-benar menambah
            barang, dan membacanya dari seluruh teks halaman jadi salah begitu ada
            teks lain yang juga menyebut “n item” (mis. ringkasan transaksi).
          */}
          <div data-testid="keranjang-jumlah-item" className="text-xs text-muted-foreground">
            {itemCount} item
            {selectedTable ? ` · Meja ${selectedTable.name}` : canSendToKitchen ? " · bungkus" : ""}
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {cart.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Keranjang kosong. Klik produk untuk menambah.
            </p>
          )}
          {cartPriced.map(({ line, priced, product, applied }) => {
            const units = product?.units ?? [];
            const baseUnit = product?.unit ?? "PCS";
            const hasGroups = (product?.modifiers?.length ?? 0) > 0;
            const foto = product?.images?.[0]?.url;
            return (
            <div key={line.productId} className="flex items-start gap-2">
              {/*
                Thumbnail di keranjang: yang perlu dipastikan kasir adalah barang
                yang sedang dihitung cocok dengan yang dipegang pembeli.
              */}
              {adaGambar && (
                <span className="mt-0.5 block size-9 shrink-0 overflow-hidden rounded-md border border-border/70 bg-secondary/40">
                  {foto ? (
                    <img
                      src={foto}
                      alt={`Gambar produk ${line.name}`}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <span
                      role="img"
                      aria-label={`Belum ada gambar ${line.name}`}
                      className="grid size-full place-items-center text-muted-foreground"
                    >
                      <ImageOff className="size-3.5" />
                    </span>
                  )}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{line.name}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {formatIDR(priced?.unitPrice ?? line.price)} × {line.qty}
                  {priced && priced.factor > 1 ? ` ${priced.unitCode}` : ""}
                  {priced?.tier ? ` · tier ${priced.tier.minQty}+` : ""}
                </div>
                {hasGroups && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {applied.labels.length > 0 ? (
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        {modifierSummary(applied.labels)}
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-destructive">
                        Modifier belum dipilih
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => editLineModifiers(line)}
                      className="text-[11px] text-primary hover:underline"
                    >
                      Ubah modifier
                    </button>
                  </div>
                )}
                {units.length > 0 && (
                  <select
                    value={line.unitCode ?? baseUnit}
                    onChange={(e) => changeUnit(line.productId, e.target.value)}
                    aria-label={`Satuan ${line.name}`}
                    className="mt-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
                  >
                    <option value={baseUnit}>{baseUnit}</option>
                    {units.map((unit) => (
                      <option key={unit.code} value={unit.code}>
                        {unit.code} ({unit.factor} {baseUnit})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => changeQty(line.productId, -1)}
                  className="grid size-7 place-items-center rounded border border-border hover:bg-secondary"
                >
                  <Minus className="size-3" />
                </button>
                <span className="w-6 text-center font-mono text-sm">
                  {line.qty}
                </span>
                <button
                  type="button"
                  onClick={() => changeQty(line.productId, 1)}
                  className="grid size-7 place-items-center rounded border border-border hover:bg-secondary"
                >
                  <Plus className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setCart((prev) =>
                      prev.filter((l) => l.productId !== line.productId),
                    )
                  }
                  className="ml-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
            );
          })}
        </div>

        <div className="space-y-2 border-t border-border/70 p-4 text-sm">
          <Row label="Subtotal" value={formatIDR(subtotal)} />

          {canPickMember && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Member</span>
                {selectedMember && (
                  <button
                    type="button"
                    onClick={() => {
                      setMemberId(undefined);
                      setMemberQuery("");
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    Hapus member
                  </button>
                )}
              </div>

              {selectedMember ? (
                <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-2 py-1.5 text-xs">
                  <span className="min-w-0 truncate font-medium">
                    {selectedMember.name}
                  </span>
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {describeMember(selectedMember)}
                  </span>
                </div>
              ) : (
                <>
                  <Input
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    placeholder="Cari member (nama / kode)"
                    className="h-8"
                    aria-label="Cari member"
                  />
                  {memberQuery.trim() === "" && (
                    <p className="text-xs text-muted-foreground">
                      Pilih member untuk memakai diskonnya.
                    </p>
                  )}
                  {memberQuery.trim() !== "" &&
                    (memberMatches.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Member tidak ditemukan.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {memberMatches.map((m) => (
                          <li key={m.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setMemberId(m.id);
                                setMemberQuery("");
                              }}
                              className="flex w-full items-center justify-between rounded-md border border-border/70 px-2 py-1 text-left text-xs transition-colors hover:border-primary/50 hover:bg-primary/5"
                            >
                              <span className="min-w-0 truncate">{m.name}</span>
                              <span className="shrink-0 font-mono text-muted-foreground">
                                {describeMember(m)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ))}
                </>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Diskon manual</span>
            <div className="w-28">
              <Input
                type="number"
                min={0}
                value={discount === 0 ? "" : discount}
                onChange={(e) =>
                  setDiscount(Math.max(0, Number(e.target.value) || 0))
                }
                placeholder="0"
                className="h-8 text-right font-mono"
              />
            </div>
          </div>
          {memberDiscountAmount > 0 && selectedMember && (
            <Row
              label={`Diskon member (${selectedMember.discountPct}%)`}
              value={`− ${formatIDR(memberDiscountAmount)}`}
            />
          )}
          {totals.serviceCharge > 0 && (
            <Row
              label={`Biaya layanan ${formatPctPlain(totals.serviceChargePct)}`}
              value={formatIDR(totals.serviceCharge)}
            />
          )}
          {tax.tax > 0 ? (
            <Row label={totals.plan.label} value={formatIDR(tax.tax)} />
          ) : (
            <p className="text-xs text-muted-foreground">
              {totals.plan.microExempt
                ? "PBJT tidak dipungut karena pengecualian usaha mikro — pajak daerahnya masih aktif di halaman Pengaturan."
                : "PPN tidak dipungut dan tidak ada pajak daerah yang berlaku — setelannya sedang dimatikan di halaman Pengaturan."}
            </p>
          )}
          {totals.plan.microExempt && tax.tax > 0 && (
            <p className="text-xs text-muted-foreground">
              PBJT tidak dipungut karena pengecualian usaha mikro — pajak daerahnya
              masih aktif di halaman Pengaturan.
            </p>
          )}
          {totals.plan.bothConfigured && (
            <p className="text-xs text-muted-foreground">
              PPN pusat tidak dipungut untuk makanan/minuman yang disajikan
              langsung; barang kemasan pabrik tetap kena PPN.
            </p>
          )}
          <div className="flex items-baseline justify-between border-t border-dashed border-border pt-2">
            <span className="font-medium">Total</span>
            {/*
              Total keranjang punya alamatnya sendiri (`data-testid`): angka ini
              yang dibandingkan harness dengan transaksi yang dilanjutkan dari
              daftar **Transaksi ditahan**.
            */}
            <span
              data-testid="keranjang-total"
              className="font-mono text-xl font-bold text-primary"
            >
              {formatIDR(total)}
            </span>
          </div>
          {lastReceipt && (
            <p
              className={cn(
                "rounded-md px-2 py-1.5 text-xs",
                lastReceipt.queued
                  ? "bg-accent/15 text-accent"
                  : "bg-primary/10 text-primary",
              )}
            >
              {lastReceipt.queued
                ? `Tersimpan offline · menunggu sinkronisasi · ${formatIDR(lastReceipt.total)}`
                : `Tersimpan ${lastReceipt.number} · ${formatIDR(lastReceipt.total)}`}
              {lastReceipt.credit
                ? ` · piutang ${formatIDR(lastReceipt.credit)}${lastReceipt.customerName ? ` (${lastReceipt.customerName})` : ""}`
                : ""}
              {lastReceipt.digital ? ` · QRIS ${lastReceipt.digital}` : ""}
            </p>
          )}
          {cartCharge && (
            <p className="rounded-md bg-accent/15 px-2 py-1.5 text-xs text-accent">
              {cartCharge.status === "paid"
                ? `Tagihan ${cartCharge.number} sudah lunas · penjualannya belum tersimpan — tekan Bayar untuk menyimpannya.`
                : `Tagihan ${cartCharge.number} menunggu pembayaran · ${formatIDR(cartCharge.amount)} · buka Bayar untuk melanjutkan.`}
            </p>
          )}
        </div>

        {(holdNotice || holdError) && (
          <p
            role={holdError ? "alert" : undefined}
            className={cn(
              "mx-4 mt-4 rounded-md px-2 py-1.5 text-xs",
              holdError
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary",
            )}
          >
            {holdError ?? holdNotice}
          </p>
        )}

        <div className="border-t border-border/70 p-4">
          <div className="grid grid-cols-2 gap-2">
            {/*
              **Hold**: transaksi yang sedang berjalan ditahan sementara supaya
              pembeli berikutnya bisa dilayani lebih dulu, lalu dilanjutkan dari
              daftar Transaksi ditahan. Isinya masih murni keranjang — belum ada
              uang, stok, atau tiket dapur yang tercatat.
            */}
            <Button
              variant="outline"
              data-testid="pos-hold"
              onClick={holdCart}
              disabled={cart.length === 0 || posLocked}
              title={
                posLocked
                  ? shiftGate.hint
                  : "Tahan transaksi ini sementara supaya pembeli berikutnya bisa dilayani lebih dulu — lanjutkan dari daftar Transaksi ditahan"
              }
            >
              <Pause className="size-4" />
              Hold
            </Button>
            {/*
              Cetak & kirim baru ditawarkan **sesudah pembayarannya lunas**: struk
              adalah bukti bayar, jadi selama keranjangnya masih disusun satu-satunya
              jalan yang tersedia adalah jalan menuju pembayaran (tombol Bayar).
              Tombolnya lalu mencetak/mengirim nota yang sudah dibayar — bukan draft
              keranjang yang belum lunas — termasuk saat kasir sudah mulai melayani
              pembeli berikutnya.
            */}
            {strukSiap && (
              <>
                <Button
                  variant="outline"
                  aria-label="Cetak struk"
                  onClick={() => canPrint && window.print()}
                  disabled={!canPrint}
                  title={
                    !canPrint
                      ? "Paket ini tanpa cetak struk"
                      : `Cetak ulang struk ${lastReceipt?.number ?? "penjualan terakhir"} ke printer ${strukDocument.printer.label} lewat dialog cetak peramban (${strukDocument.paper.label}, ${receiptCopiesLabel(receipt)})`
                  }
                >
                  <Printer className="size-4" />
                  Cetak
                </Button>
                {/*
                  Struk yang sudah lunas bisa dicetak, diunduh sebagai PDF, atau
                  dikirim ke WhatsApp pembelinya (member atau pembeli umum).
                  Ketiganya dari satu dialog supaya kasir tidak perlu memilih jalur
                  sebelum tahu apa yang diminta pembelinya.
                */}
                <Button
                  variant="outline"
                  aria-label="Struk & kirim"
                  onClick={openReceiptDialog}
                  title={`Cetak, unduh PDF, atau kirim struk ${lastReceipt?.number ?? "penjualan terakhir"} ke WhatsApp pembelinya`}
                >
                  <Share2 className="size-4" />
                  Struk & kirim
                </Button>
              </>
            )}
            <Button
              data-testid="pos-bayar"
              onClick={() => setPayOpen(true)}
              disabled={cart.length === 0 || posLocked}
              title={posLocked ? shiftGate.hint : undefined}
            >
              Bayar
            </Button>
          </div>
          {/*
            Catatan gerbang di panel keranjang: di ponsel, banner di atas daftar
            produk mudah tergulir keluar layar, sedangkan tombol Bayar yang mati
            selalu terlihat — penjelasan singkatnya ikut diletakkan di sini
            berikut tautan jalan keluarnya.
          */}
          {posLocked && (
            <p
              data-testid="pos-gerbang-shift-catatan"
              className="mt-2 text-center text-[11px] text-muted-foreground"
            >
              {shiftGate.title} —{" "}
              <Link to="/app/shift" className="font-medium text-primary hover:underline">
                {shiftGate.cta}
              </Link>
            </p>
          )}
          {heldCarts.length > 0 && cart.length === 0 && (
            <p
              data-testid="pos-ditahan-hint"
              className="mt-2 text-center text-[11px] text-muted-foreground"
            >
              {heldCarts.length} transaksi ditahan menunggu dilanjutkan — tekan{" "}
              <strong className="font-medium text-foreground">Lanjutkan</strong> di
              daftar Transaksi ditahan.
            </p>
          )}
          {strukSiap && (
            <p
              data-testid="struk-lunas-catatan"
              className="mt-2 text-center text-[11px] text-muted-foreground"
            >
              Struk {lastReceipt?.number ?? "penjualan terakhir"} sudah lunas ·{" "}
              {formatIDR(lastReceipt?.total ?? 0)} — tombol di atas mencetak atau
              mengirim nota ini.
            </p>
          )}
        </div>
      </aside>

      {/*
        Kartunya dibatasi setinggi layar dan **isinya sendiri yang digulir**: di
        ponsel, dialog ini bisa jadi lebih tinggi dari layar (jalur QRIS/VA
        menambah blok tagihan, dan papan tombol yang terbuka saat kasir mengetik
        uang diterima memangkas layarnya lagi), sedangkan lapisan luar yang
        `fixed` tidak bisa menggulir apa pun. Judul + tombol tutupnya dibuat
        menempel di atas supaya selalu terjangkau.
      */}
      {payOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="sticky top-0 z-10 -mx-6 -mt-6 flex items-center justify-between rounded-t-xl bg-card px-6 pb-3 pt-6">
              <h3 className="text-lg font-semibold">Pembayaran</h3>
              {/* Tombol berikon: yang dibaca pembaca layar (dan dipakai harness)
                  adalah labelnya, bukan gambar silangnya. */}
              <button
                type="button"
                onClick={() => setPayOpen(false)}
                aria-label="Tutup pembayaran"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    method === m
                      ? "border-primary/50 bg-primary/12 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>

            <div className="mt-5 flex items-baseline justify-between rounded-lg bg-secondary/40 px-4 py-3">
              <span className="text-sm text-muted-foreground">Total tagihan</span>
              <span className="font-mono text-2xl font-bold text-primary">
                {formatIDR(total)}
              </span>
            </div>

            {showDigitalFlow && (
              <div className="mt-4 rounded-lg border border-border/70 bg-secondary/10 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <QrCode className="size-4 text-primary" />
                  Tagih QRIS dari keranjang
                </div>

                {cartCharge ? (
                  <>
                    <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {cartCharge.number}
                      </span>
                      <span className="font-mono text-sm font-semibold">
                        {formatIDR(cartCharge.amount)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {paymentInstruction({
                        method: cartCharge.method,
                        bank: null,
                        amount: cartCharge.amount,
                      })}{" "}
                      {cartCharge.status === "paid"
                        ? "Tagihan sudah lunas — simpan penjualannya."
                        : `Berlaku sampai ${formatClock(cartCharge.expiresAt)} (${digitalLimits.qrisExpiryMinutes} menit).`}
                    </p>
                    {cartQrPayload && (
                      <div className="mt-3 flex flex-col items-center gap-2">
                        <div className="rounded-lg border border-border/60 bg-white p-2">
                          <QrCodeImage
                            value={cartQrPayload}
                            label={`Kode QR tagihan ${cartCharge.number}`}
                            className="size-44"
                          />
                        </div>
                        <p className="text-center text-xs text-muted-foreground">
                          Pindai kode ini dengan aplikasi pembayaran pelanggan.
                        </p>
                        <details className="w-full">
                          <summary className="cursor-pointer text-[10px] text-muted-foreground/70">
                            Payload teks (cadangan)
                          </summary>
                          <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground/80">
                            QRIS: {cartQrPayload}
                          </p>
                        </details>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        className="flex-1"
                        disabled={paying}
                        onClick={() => void settleCartCharge()}
                      >
                        <BadgeCheck className="size-4" />
                        {cartCharge.status === "paid"
                          ? paying
                            ? "Menyimpan…"
                            : "Simpan penjualan"
                          : paying
                            ? "Memproses…"
                            : "Pembayaran diterima"}
                      </Button>
                      {cartCharge.status === "pending" && (
                        <Button
                          variant="outline"
                          disabled={paying}
                          onClick={() => void cancelCartCharge()}
                        >
                          <XCircle className="size-4" />
                          Batalkan
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Tagihan diterbitkan senilai total keranjang{" "}
                      {formatIDR(total)}, dan penjualannya baru dicatat setelah
                      tagihan itu lunas — jadi tidak ada nota yang mendahului
                      uangnya.
                    </p>
                    <Button
                      className="mt-3 w-full"
                      disabled={paying}
                      onClick={() => void issueCartCharge()}
                    >
                      <QrCode className="size-4" />
                      {paying
                        ? "Menerbitkan…"
                        : `Terbitkan tagihan ${formatIDR(total)}`}
                    </Button>
                  </>
                )}
              </div>
            )}

            {method === "QRIS" && !canChargeDigital && (
              <p className="mt-4 flex items-start gap-2 rounded-md border border-border/60 bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                {digitalPlan.digital
                  ? "Peran Anda tidak menagih QRIS; yang menerbitkan tagihan adalah kasir, keuangan, atau manajer."
                  : `Paket ${digitalPlan.planName} belum memuat kanal tagih digital — QRIS tetap bisa dicatat manual seperti kartu.`}
              </p>
            )}

            {selectedMember && (
              <p className="mt-2 text-xs text-muted-foreground">
                Member {selectedMember.name}
                {memberDiscountAmount > 0
                  ? ` · diskon ${selectedMember.discountPct}% (${formatIDR(memberDiscountAmount)})`
                  : " · tanpa diskon"}
              </p>
            )}

            {canUseCredit && customers.length > 0 && (
              <div className="mt-4 space-y-2">
                <label className="text-sm font-medium" htmlFor="customer">
                  Pelanggan B2B (tempo)
                </label>
                <select
                  id="customer"
                  value={customerId ?? ""}
                  onChange={(e) => setCustomerId(e.target.value || undefined)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
                >
                  <option value="">Tanpa pelanggan (tunai)</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id} disabled={!customer.active}>
                      {customer.name} · {customer.code}
                      {customer.creditLimit > 0
                        ? ` · sisa ${formatIDR(customer.availableCredit)}`
                        : " · tunai"}
                    </option>
                  ))}
                </select>
                {selectedCustomer && (
                  <p className="text-xs text-muted-foreground">
                    {selectedCustomer.creditLimit > 0
                      ? `Limit ${formatIDR(selectedCustomer.creditLimit)} · terpakai ${formatIDR(selectedCustomer.outstanding)} · sisa ${formatIDR(selectedCustomer.availableCredit)}`
                      : "Pelanggan ini tunai saja (tanpa limit kredit)."}
                  </p>
                )}

                <div className="space-y-1 pt-1">
                  <label className="text-sm font-medium" htmlFor="paid-now">
                    Dibayar sekarang
                  </label>
                  <Input
                    id="paid-now"
                    type="number"
                    min={0}
                    value={paid === 0 ? "" : paid}
                    onChange={(e) => setPaidNow(Number(e.target.value) || 0)}
                    className="font-mono"
                  />
                  {creditAmount > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Menjadi piutang</span>
                      <span className="font-mono font-semibold text-accent">
                        {formatIDR(creditAmount)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {method === "Tunai" && creditAmount === 0 && (
              <div className="mt-4 space-y-2">
                <label className="text-sm font-medium" htmlFor="cash">
                  Uang diterima
                </label>
                <Input
                  id="cash"
                  type="number"
                  min={0}
                  value={cash === 0 ? "" : cash}
                  onChange={(e) => setCash(Number(e.target.value) || 0)}
                  placeholder="0"
                  className="font-mono"
                />
                {/*
                  Tombol pecahan: satu ketukan mengisi kolom di atas. Yang sedang
                  terpakai diberi lencana aktif (`aria-pressed`) supaya jelas uang
                  mana yang sedang dihitung kembaliannya.
                */}
                <div className="flex flex-wrap gap-2" data-testid="cash-cepat">
                  {CASH_QUICK_AMOUNTS.map((amount) => (
                    <Button
                      key={amount}
                      type="button"
                      size="sm"
                      variant={cash === amount ? "default" : "outline"}
                      aria-pressed={cash === amount}
                      data-testid={`cash-cepat-${amount}`}
                      onClick={() => setCash(amount)}
                    >
                      {formatIDR(amount)}
                    </Button>
                  ))}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Kembalian</span>
                  <span className="font-mono font-semibold">
                    {formatIDR(change)}
                  </span>
                </div>
              </div>
            )}

            {(payError || creditBlockedReason) && (
              <p
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {payError ?? creditBlockedReason}
              </p>
            )}

            {showDigitalFlow ? (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                {cartCharge
                  ? `Penjualan dicatat atas tagihan ${cartCharge.number} setelah tagihan itu lunas.`
                  : "Terbitkan tagihan QRIS lebih dulu; tombol simpan terbuka setelah pelanggan membayar."}
              </p>
            ) : (
              <Button
                className="mt-6 w-full"
                size="lg"
                onClick={confirmPayment}
                disabled={
                  paying ||
                  creditBlockedReason !== null ||
                  (method === "Tunai" && creditAmount === 0 && cash < total)
                }
              >
                {paying ? "Menyimpan…" : "Selesaikan pembayaran"}
              </Button>
            )}
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {canPrint
                ? "Setelah lunas, dialog struknya terbuka: cetak di printer, unduh PDF, atau kirim ke WhatsApp member."
                : "Paket ini tanpa cetak struk; struknya tetap bisa diunduh sebagai PDF atau dikirim ke WhatsApp member setelah lunas."}
            </p>
            <p className="mt-1 text-center text-xs text-muted-foreground">
              {source === "convex"
                ? "Transaksi disimpan ke backend tenant Anda."
                : "Mode demo — transaksi belum tersimpan ke backend."}
            </p>
          </div>
        </div>
      )}

      {/*
        Dialog struk: satu tempat untuk tiga cara struk sampai ke pembelinya.
        Isinya selalu `printDraft` — struk penjualan yang **sudah lunas**; tidak
        ada jalur yang membukanya untuk keranjang yang belum dibayar. Yang di sisi
        server hanya pengiriman WhatsApp-nya, karena nomor tujuannya ada di data
        member.

        Kartunya dibatasi setinggi layar dan **isinya sendiri yang digulir**.
        Dialog ini yang paling panjang — printer, tiga jalan struk, kolom nomor
        WhatsApp, daftar PDF, dan notis — dan di ponsel ia lebih tinggi dari
        layar, sedangkan lapisan luarnya `fixed` sehingga tidak bisa menggulir
        apa pun: laporan pemilik repo, bagian bawahnya (daftar PDF, tombol Tutup)
        tidak pernah bisa dibaca. Judul + tombol tutupnya ditempel di atas
        supaya kasir selalu bisa menutupnya.
      */}
      {receiptOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
          <div
            data-testid="struk-dialog"
            className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-6 shadow-2xl"
          >
            <div className="sticky top-0 z-10 -mx-6 -mt-6 flex items-start justify-between gap-3 rounded-t-xl bg-card px-6 pb-3 pt-6">
              <div>
                <h3 className="text-lg font-semibold">Struk belanja</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {`Struk ${lastReceipt?.number ?? "penjualan terakhir"} · ${formatIDR(printDraft.total)}`}
                </p>
                {receiptMember && (
                  <p
                    data-testid="struk-dialog-member"
                    className="mt-1 text-xs text-muted-foreground"
                  >
                    Penerima: {receiptMember.name} ·{" "}
                    {receiptMember.phone
                      ? `WhatsApp ${maskPhone(receiptMember.phone)}`
                      : "belum ada nomor WhatsApp"}
                  </p>
                )}
                {/*
                  Konfirmasi satu baris bahwa dapurnya sudah menerima pesanan ini.
                  Dialog struk terbuka otomatis sesudah pembayaran, jadi kalimatnya
                  terbaca di tempat kasir memang sedang menatap — bukan di halaman
                  lain yang harus dicari. Hanya muncul kalau penjualannya memang
                  dikirim ke dapur (modul F&B dengan layar dapur).
                */}
                {lastReceipt?.kitchenFired && (
                  <p
                    data-testid="struk-dapur"
                    className="mt-1 flex items-start gap-1.5 text-xs text-primary"
                  >
                    <ChefHat className="mt-0.5 size-3.5 shrink-0" />
                    Pesanan sudah dikirim ke dapur bersamaan dengan pembayaran ini —
                    statusnya ada di halaman Dapur &amp; Meja.
                  </p>
                )}
              </div>
              {/* Berikon: yang dibaca pembaca layar (dan dipakai harness) adalah
                  labelnya, bukan gambar silangnya. */}
              <button
                type="button"
                onClick={() => setReceiptOpen(false)}
                aria-label="Tutup struk"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-5 grid gap-2">
              {/*
                Cetak **langsung ke printer** didahulukan begitu perambannya punya
                jalurnya (WebUSB / Web Bluetooth): struk keluar dari mesin yang
                dipilih pemilik toko tanpa dialog cetak sistem, dan kertas faktur
                maupun printer portabel Bluetooth ikut terpakai. Dialog cetak
                peramban tetap disediakan sebagai cadangan — untuk peramban yang
                belum punya API-nya, dan untuk printer jaringan yang memang tidak
                bisa dijangkau halaman web.
              */}
              {canPrint && escpos.support.supported && (
                <>
                  <div
                    data-testid="struk-printer"
                    className="rounded-lg border border-border px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {escpos.transport === "bluetooth" ? (
                          <Bluetooth className="size-3.5" />
                        ) : (
                          <Usb className="size-3.5" />
                        )}
                        {escpos.connected ? (
                          <>
                            Tersambung:{" "}
                            <strong
                              data-testid="struk-printer-nama"
                              className="font-medium text-foreground"
                            >
                              {escpos.device}
                            </strong>
                          </>
                        ) : (
                          <span data-testid="struk-printer-belum">
                            Belum ada printer tersambung
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <select
                          data-testid="struk-transport"
                          aria-label="Jalur printer"
                          value={escpos.transport}
                          disabled={escpos.busy}
                          onChange={(event) =>
                            escpos.chooseTransport(event.target.value as EscposTransport)
                          }
                          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                        >
                          {ESC_POS_TRANSPORTS.map((jalur) => (
                            <option key={jalur.id} value={jalur.id} title={jalur.where}>
                              {jalur.label}
                            </option>
                          ))}
                        </select>
                        {escpos.connected ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            data-testid="struk-putuskan"
                            disabled={escpos.busy}
                            onClick={() => void escpos.disconnect()}
                          >
                            Putuskan
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            data-testid="struk-sambungkan"
                            disabled={escpos.busy}
                            onClick={() => void escpos.connect()}
                          >
                            Sambungkan
                          </Button>
                        )}
                      </div>
                    </div>
                    {escpos.detail && (
                      <p
                        title={escpos.detail}
                        className="mt-1 truncate text-[11px] text-muted-foreground"
                      >
                        {escpos.detail}
                      </p>
                    )}
                  </div>
                  <Button
                    data-testid="struk-cetak-langsung"
                    disabled={escpos.busy}
                    onClick={() =>
                      void escpos.print(strukDocument, {
                        // Laci kas hanya perlu dibuka kalau ada uang tunai yang diterima.
                        openDrawer: printDraft.paid !== undefined,
                      })
                    }
                    title={`Kirim struk ${lastReceipt?.number ?? "penjualan terakhir"} ke printer ${strukDocument.printer.label} lewat ${escpos.transport === "bluetooth" ? "Bluetooth" : "USB"}`}
                  >
                    <Printer className="size-4" />
                    {escpos.busy ? "Mengirim ke printer…" : "Cetak ke printer"}
                  </Button>
                </>
              )}
              {canPrint && !escpos.support.supported && (
                <p
                  data-testid="struk-tanpa-escpos"
                  className="rounded-md border border-border/60 bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground"
                >
                  {escpos.support.reason}
                </p>
              )}
              <Button
                variant="outline"
                data-testid="struk-cetak-dialog"
                onClick={() => canPrint && window.print()}
                disabled={!canPrint}
                title={
                  canPrint
                    ? `Cetak lewat dialog cetak peramban ke printer ${strukDocument.printer.label} (${strukDocument.paper.label}, ${receiptCopiesLabel(receipt)})`
                    : "Paket ini tanpa cetak struk"
                }
              >
                <Printer className="size-4" />
                Cetak lewat dialog peramban
              </Button>
              <Button
                variant="outline"
                data-testid="struk-unduh-pdf"
                onClick={() => void downloadReceipt()}
                disabled={receiptBusy}
                title="Simpan struk sebagai berkas PDF di perangkat ini"
              >
                <FileDown className="size-4" />
                Unduh PDF
              </Button>
              {/*
                Jalur yang membawa **lampirannya sekaligus**: lembar bagikan
                sistem (Web Share) dengan **satu berkas gambar struk** di dalamnya,
                plus isi struknya sebagai teks. Satu gambar — bukan PDF, bukan
                campuran PDF + logo — karena di Android pasangan berkas campuran
                diserahkan dengan tipe intent **umum** dan WhatsApp bisa mengambil
                berkas pertamanya saja: logonya lalu tidak pernah terlihat. Satu PNG
                bersih dari masalah itu: tipe intent-nya `image/png`, logonya sudah
                ada di dalam gambarnya, dan struknya tampil sebagai foto. Di perangkat
                yang tidak punya API-nya, tombolnya tetap ada dan menjawab apa adanya
                (gambarnya diunduh / diarahkan ke Unduh PDF) — bukan gagal diam-diam,
                karena kasir sedang berdiri di depan pembeli.
              */}
              <Button
                variant="outline"
                data-testid="struk-bagikan-gambar"
                onClick={() => void bagikanGambarStruk()}
                disabled={shareBusy || receiptBusy || lastReceipt === null}
                title={
                  lastReceipt === null
                    ? "Struk dibagikan setelah pembayarannya lunas"
                    : `Serahkan struk ${lastReceipt.number ?? "penjualan terakhir"} sebagai satu gambar PNG ke lembar bagikan perangkat: pilih WhatsApp, lalu nomor pembelinya — gambarnya tampil sebagai foto, lengkap dengan logo tokonya`
                }
              >
                <ImageIcon className="size-4" />
                {shareBusy ? "Menyiapkan berkas…" : "Bagikan gambar struk"}
              </Button>
              <Button
                data-testid="struk-kirim-wa"
                onClick={() => void sendReceiptToMember()}
                disabled={receiptBusy || lastReceipt === null}
                title={
                  lastReceipt === null
                    ? "Struk dikirim setelah pembayarannya lunas"
                    : receiptMember
                      ? `Kirim struk ke WhatsApp ${receiptMember.name}`
                      : "Kirim struk ke WhatsApp pembeli umum — isi nomornya di kolom nomor di bawah"
                }
              >
                <MessageCircle className="size-4" />
                {receiptBusy
                  ? "Mengirim…"
                  : receiptMember
                    ? "Kirim ke WhatsApp member"
                    : "Kirim ke WhatsApp pembeli"}
              </Button>
            </div>

            {/*
              Nomor tujuan yang belum ada di data mana pun. Dua keadaannya:

              1. **member cash yang datanya belum lengkap** — nomornya belum ada di
                 data member, jadi kasir boleh menampungnya di sini supaya struknya
                 bisa dikirim tanpa menunggu profilnya diisi. Nomor yang sudah
                 tersimpan di halaman Member tidak pernah ditimpa — kolom ini tidak
                 muncul sama sekali kalau membernya sudah punya nomor.
              2. **pembeli umum** (penjualan tanpa member sama sekali) — tidak ada
                 data member yang bisa dibaca, jadi nomor ini satu-satunya tujuan.
                 Nomornya tidak disimpan sebagai member; ia hanya dipakai sekali
                 untuk kiriman ini, dan asalnya tetap tercatat di jejak audit.
            */}
            {needsWaPhone && (
              <div
                data-testid="struk-nomor-wa-kotak"
                className="mt-3 rounded-lg border border-border px-3 py-2"
              >
                <label
                  htmlFor="struk-nomor-wa"
                  className="text-xs font-medium text-foreground"
                >
                  {receiptMember
                    ? `Nomor WhatsApp ${receiptMember.name}`
                    : "Nomor WhatsApp pembeli"}
                </label>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {receiptMember
                    ? "Member ini belum mengisi nomornya. Isi di sini (mis. 0812-3456-7890) supaya struknya bisa dikirim sekarang, tanpa menunggu profilnya dilengkapi."
                    : "Struk ini tanpa member (pembeli umum). Tulis nomor WhatsApp yang diberikan pembelinya (mis. 0812-3456-7890) supaya struknya bisa dikirim sekarang — nomornya dipakai sekali untuk kiriman ini, bukan disimpan sebagai data member."}
                </p>
                <Input
                  id="struk-nomor-wa"
                  data-testid="struk-nomor-wa"
                  aria-label={
                    receiptMember
                      ? "Nomor WhatsApp member"
                      : "Nomor WhatsApp pembeli"
                  }
                  value={waPhone}
                  onChange={(event) => setWaPhone(event.target.value)}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="0812-3456-7890"
                  className="mt-2"
                />
                {waPhone.trim() !== "" && !typedWaPhone.valid && (
                  <p
                    data-testid="struk-nomor-wa-galat"
                    className="mt-1 text-[11px] text-destructive"
                  >
                    {typedWaPhone.reason}
                  </p>
                )}
              </div>
            )}

            {/*
              Daftar PDF struk sesi ini: berkas-berkas yang sudah dibuat kasir di
              perangkat ini, supaya struk yang barusan diunduh masih bisa dibuka
              atau diunduh ulang dari dialog tanpa mencarinya di folder unduhan
              peramban. Isinya cuma berkas di perangkat ini — tidak ada unggahan.
            */}
            <div className="mt-3 rounded-lg border border-border">
              <button
                type="button"
                data-testid="struk-daftar-pdf-tombol"
                aria-expanded={pdfListOpen}
                onClick={() => setPdfListOpen((open) => !open)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs text-foreground"
              >
                <span className="flex items-center gap-1.5">
                  <FileText className="size-3.5" />
                  Daftar PDF struk ({pdfFiles.length})
                </span>
                <ChevronUp
                  className={cn(
                    "size-3.5 transition-transform",
                    pdfListOpen && "rotate-180",
                  )}
                />
              </button>
              {pdfListOpen && (
                <div
                  data-testid="struk-daftar-pdf-lembar"
                  className="border-t border-border px-3 py-2"
                >
                  {pdfFiles.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      Belum ada berkas PDF struk yang dibuat di perangkat ini pada
                      sesi ini.
                    </p>
                  ) : (
                    <ul data-testid="struk-daftar-pdf-daftar" className="space-y-1">
                      {pdfFiles.map((file) => (
                        <li
                          key={file.id}
                          className="flex items-center justify-between gap-2 text-[11px]"
                        >
                          <a
                            data-testid="struk-daftar-pdf-item"
                            href={file.url}
                            target="_blank"
                            rel="noreferrer"
                            title={`Buka ${file.filename}`}
                            className="truncate text-primary underline"
                          >
                            {file.filename}
                          </a>
                          <span className="shrink-0 text-muted-foreground">
                            {file.label} · {fileSizeLabel(file.size)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {lastReceipt !== null && !receiptMember && (
              <p data-testid="struk-pembeli-umum" className="mt-3 text-xs text-muted-foreground">
                Struk ini tanpa member (pembeli umum). Isi kolom nomor di atas dengan
                nomor yang diberikan pembelinya, lalu tekan kirim — nomornya tidak
                disimpan sebagai data member.
              </p>
            )}
            {receiptMember && !receiptMember.phone && (
              <p
                data-testid="struk-tanpa-nomor"
                className="mt-3 text-xs text-muted-foreground"
              >
                {receiptMember.name} belum mengisi nomor WhatsApp — isi kolom nomor
                di atas untuk mengirim sekarang, atau lengkapi di halaman Member.
              </p>
            )}

            {escpos.notice && (
              <p
                role="status"
                data-testid="struk-printer-notice"
                className="mt-3 rounded-md bg-primary/10 px-3 py-2 text-xs text-primary"
              >
                {escpos.notice}
              </p>
            )}
            {escpos.error && (
              <p
                role="alert"
                data-testid="struk-printer-error"
                className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{escpos.error}</span>
              </p>
            )}
            {receiptNotice && (
              <p
                role="status"
                data-testid="struk-notice"
                className="mt-3 rounded-md bg-primary/10 px-3 py-2 text-xs text-primary"
              >
                {receiptNotice}
              </p>
            )}
            {receiptError && (
              <div
                role="alert"
                data-testid="struk-error"
                className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>{receiptError}</span>
              </div>
            )}
            {/*
              Kalau kanalnya belum tersambung, struknya tetap bisa sampai lewat
              tautan ini: WhatsApp tidak menerima lampiran lewat `wa.me`, jadi yang
              dibawa tautannya adalah **isi struknya** — angka belanjanya terbaca
              penerimanya sebagai teks. Lampiran **gambar**-nya menyusul lewat tombol
              **Bagikan gambar struk** (lembar bagikan perangkat), atau PDF-nya diunduh
              lalu dilampirkan sendiri oleh kasir.
            */}
            {receiptError && receiptWaLink?.ok && (
              <a
                data-testid="struk-tautan-wa"
                href={receiptWaLink.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block text-center text-xs text-primary underline"
              >
                Buka WhatsApp {maskPhone(receiptWaLink.phone)} dengan isi struk ini;
                lampiran gambarnya lewat tombol “Bagikan gambar struk”
              </a>
            )}

            <div className="mt-4 flex justify-center">
              <Button variant="ghost" onClick={() => setReceiptOpen(false)}>
                Tutup
              </Button>
            </div>
          </div>
        </div>
      )}

      {modifierFor &&
        (() => {
          const selections: StoreModifierSelection[] = Object.entries(
            modifierFor.draft,
          )
            .filter(([, codes]) => codes.length > 0)
            .map(([groupCode, optionCodes]) => ({ groupCode, optionCodes }));
          const preview = applyModifiers(
            { modifiers: modifierFor.groups },
            selections,
          );

          return (
            <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">Atur modifier</h3>
                    <p className="text-sm text-muted-foreground">{modifierFor.name}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setModifierFor(null)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Tutup"
                  >
                    <X className="size-5" />
                  </button>
                </div>

                <div className="mt-4 max-h-[50vh] space-y-4 overflow-y-auto">
                  {modifierFor.groups.map((group) => {
                    const chosen = modifierFor.draft[group.code] ?? [];
                    return (
                      <div key={group.code}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{group.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {group.minSelect > 0 ? "wajib" : "opsional"} · maks{" "}
                            {group.maxSelect}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {group.options.map((option) => {
                            const active = chosen.includes(option.code);
                            return (
                              <button
                                key={option.code}
                                type="button"
                                onClick={() => toggleModifierOption(group, option.code)}
                                aria-pressed={active}
                                className={cn(
                                  "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                                  active
                                    ? "border-primary/50 bg-primary/12 text-primary"
                                    : "border-border text-muted-foreground hover:text-foreground",
                                )}
                              >
                                {option.name}
                                {option.price > 0 && (
                                  <span className="ml-1 font-mono text-[11px]">
                                    +{formatIDR(option.price)}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {!preview.ok && (
                  <p
                    role="alert"
                    className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    {preview.reason}
                  </p>
                )}

                <Button
                  className="mt-5 w-full"
                  size="lg"
                  disabled={!preview.ok}
                  onClick={saveModifierDraft}
                >
                  {preview.surcharge > 0
                    ? `Tambahkan (+${formatIDR(preview.surcharge)} / unit)`
                    : "Tambahkan"}
                </Button>
              </div>
            </div>
          );
        })()}

      <section className="xl:col-span-2">
        {/*
          Ringkasan yang bisa diklik, bukan tabel yang selalu terbuka: di kasir,
          tinggi layar dipakai untuk keranjang & grid produk, sedangkan daftar
          transaksinya dibutuhkan sesekali saja (mencocokkan nota, memastikan
          penjualan tadi benar-benar tercatat).
        */}
        <button
          type="button"
          data-testid="transaksi-terakhir-tombol"
          onClick={() => setSalesOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={salesOpen}
          title="Lihat daftar transaksi shift ini"
          className="flex w-full items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <History className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">
                Transaksi terakhir (shift ini)
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {sales.length === 0
                  ? "Belum ada transaksi — tekan untuk membuka daftarnya"
                  : `${sales.length} transaksi · ${salesItemCount} item · ${formatIDR(salesTotal)}`}
              </span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
            Lihat daftar
            <ChevronUp className="size-4" />
          </span>
        </button>
      </section>

      {/*
        Lembar transaksi: naik dari bawah layar (satu arah dengan jempol yang
        menggulir ke bawah), menutupi layar dengan latar gelap, dan berisi daftar
        **seluruh** penjualan shift ini — bukan hanya enam baris terakhir seperti
        tabel lamanya. Ditutup lewat tombol silang, sentuhan di latar, atau Escape;
        animasi masuk & keluarnya dari `framer-motion` (sudah dipakai beranda &
        onboarding), jadi tidak ada keyframe baru yang perlu dijaga.
      */}
      <AnimatePresence>
        {salesOpen && (
          <>
            <motion.div
              key="transaksi-terakhir-latar"
              data-testid="transaksi-terakhir-latar"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setSalesOpen(false)}
              className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
            />
            <motion.div
              key="transaksi-terakhir-lembar"
              role="dialog"
              aria-modal="true"
              aria-label="Transaksi terakhir (shift ini)"
              data-testid="transaksi-terakhir-lembar"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-hidden rounded-t-2xl border-t border-border bg-card shadow-2xl"
            >
              {/* Penanda geser: memberi tahu bahwa lembarnya berasal dari bawah. */}
              <div className="flex justify-center pt-2">
                <span aria-hidden className="h-1.5 w-10 rounded-full bg-border" />
              </div>

              <div className="flex items-start justify-between gap-3 border-b border-border/70 px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                    <History className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">
                      Transaksi terakhir (shift ini)
                    </h3>
                    <p className="truncate text-xs text-muted-foreground">
                      {sales.length === 0
                        ? "Belum ada penjualan yang tercatat di shift ini."
                        : `${sales.length} transaksi · ${salesItemCount} item · ${formatIDR(salesTotal)}`}
                    </p>
                  </div>
                </div>
                {/* Berikon: yang dibaca pembaca layar (dan dipakai harness) adalah
                    labelnya, bukan gambar silangnya. */}
                <button
                  type="button"
                  onClick={() => setSalesOpen(false)}
                  aria-label="Tutup transaksi terakhir"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div
                data-testid="transaksi-terakhir-daftar"
                className="max-h-[60vh] overflow-y-auto"
              >
                {sales.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                    Belum ada transaksi. Penjualan yang selesai di shift ini muncul di
                    sini, terbaru di atas.
                  </p>
                ) : (
                  <ul className="divide-y divide-border/70">
                    {sales.map((sale) => (
                      <li
                        key={sale.id}
                        data-testid={`transaksi-terakhir-baris-${sale.number}`}
                        className="flex items-center justify-between gap-3 px-5 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-mono text-sm">{sale.number}</p>
                          <p className="text-xs text-muted-foreground">
                            {sale.at} · {sale.itemCount} item · {sale.method}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-sm font-medium">
                          {formatIDR(sale.total)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border/70 px-5 py-3">
                <span className="text-xs text-muted-foreground">
                  {sales.length === 0 ? "Belum ada yang bisa dijumlahkan" : "Total daftar ini"}
                </span>
                <span className="font-mono text-sm font-semibold">
                  {formatIDR(salesTotal)}
                </span>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/*
        Area yang benar-benar keluar dari printer. Di layar ia tidak tampil
        (`.struk-cetak`), dan saat mencetak hanya bagian ini yang terlihat — bentuk
        serta jumlah lembarnya mengikuti setelan struk di halaman Pengaturan, jadi
        yang dicetak kasir tidak pernah berbeda dari pratinjau yang dilihat pemilik
        toko di sana.
      */}
      <div data-testid="struk-cetak" className="struk-cetak">
        {strukDocument.sheets.map((sheet) => (
          <div
            key={sheet.copyIndex}
            style={{ width: `${strukDocument.paper.widthMm}mm` }}
          >
            {strukDocument.logoUrl && (
              /*
                Logo dicetak **lebih kecil dan hitam putih**: kotaknya tetap
                110 px × 110 px (aturan murni `RECEIPT_LOGO_SIZE_PX`) dan warnanya
                dipaksa abu-abu oleh `RECEIPT_LOGO_FILTER`, jadi kertas struknya
                keluar satu warna seperti teksnya — juga kalau printernya berwarna.
              */
              <img
                src={strukDocument.logoUrl}
                alt="Logo toko"
                data-testid={`struk-cetak-logo-${sheet.copyIndex + 1}`}
                style={{
                  width: `${strukDocument.logoSizePx}px`,
                  height: `${strukDocument.logoSizePx}px`,
                  filter: strukDocument.logoFilter,
                }}
                className="mx-auto block object-contain"
              />
            )}
            <pre
              data-testid={`struk-cetak-lembar-${sheet.copyIndex + 1}`}
              className="font-mono text-[11px] leading-tight"
            >
              {sheet.lines.join("\n")}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

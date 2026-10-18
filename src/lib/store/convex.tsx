/**
 * Convex store — the live implementation.
 *
 * Satisfies the same `StoreApi` as the demo store, so no page changes when this
 * is switched on. Three things are worth knowing:
 *
 * 1. Tenancy is resolved from the caller's **membership** (`tenants.listMine`),
 *    never from a slug typed on the client: two businesses that happen to share a
 *    name must not end up in one workspace, and an account that is not a member
 *    must not be able to adopt a stranger's tenant by guessing its name. The
 *    resolved workspace is written back into the device session (`adoptWorkspace`),
 *    so a new device lands in the account's own business instead of being asked to
 *    create another one. The acting user is resolved once via `users.createOrGet`
 *    (idempotent by design); that id is the actor attached to every audited write,
 *    which is what the server's role checks are evaluated against.
 * 2. Prices are still computed server-side by `pos.createSale`. The client's
 *    computed total is only used as the recorded tender amount on the payment,
 *    which is genuinely client-supplied information.
 * 3. Checkout goes through the offline outbox. The entry's `idempotencyKey` is
 *    minted once and reused on every retry, so a reconnect can never charge
 *    twice — the server returns the original sale for a repeated key.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  computeTax,
  DEFAULT_TAX_RATE_PCT,
  entitlementFor,
  isFeatureEnabled,
  PLANS,
  trimVerticalsForPlan,
  type PlanKey,
  type Vertical,
} from "@/lib/billing";
import { shiftSettingOf, type ShiftSetting } from "@/lib/shift";
import {
  activeBusinessCategoryOptions,
  businessCategoryOf,
  businessCategorySentence,
  defaultBusinessCategoryRows,
  type BusinessCategoryChoice,
} from "@/lib/businessCategory";
import { receiptSettingOf, type ReceiptSetting } from "@/lib/struk";
import { taxSettingOf, type TaxSetting } from "@/lib/tax";
import {
  emptyMonthlyTaxRows,
  fnbCurrentMonthSummary,
  fnbTaxProfileOf,
  recentMonthWindows,
  type FnbTaxProfile,
} from "@/lib/fnbTax";
import type { Permission, Role } from "@/lib/authz";
import {
  effectivePermissions,
  MAX_CUSTOM_ROLES,
  sanitizePermissions,
} from "@/lib/rbac";
import {
  isActiveMembership,
  isMembershipSuspended,
  MEMBERSHIP_SUSPENDED_NOTE,
} from "@/lib/team";
import { categoryIsActive, subcategoryIsActive } from "@/lib/categories";
import { isPlatformRole } from "@/lib/platform";
import { DEFAULT_WAREHOUSE_ID, defaultWarehouse } from "@/lib/inventory";
import {
  applyModifiers,
  lineTotalWithModifiers,
} from "@/lib/modifiers";
import { priceLine } from "@/lib/wholesale";
import {
  analyticsRange,
  buildAdvancedReport,
  DEFAULT_ANALYTICS_DAYS,
  resolveAnalyticsDays,
} from "@/lib/analytics";
import { OfflineError, isOfflineError, type OutboxEntry } from "@/lib/offline/outbox";
import { useOutbox } from "@/lib/offline/useOutbox";
import {
  MAX_OPEN_TICKETS,
  MAX_TICKET_LOG,
  supportPlanFor,
} from "@/lib/support";
import {
  DIGITAL_MAX_AMOUNT,
  DIGITAL_MIN_AMOUNT,
  DIGITAL_REFERENCE_MAX,
  DIGITAL_REASON_MAX,
  EXPIRING_SOON_SECONDS,
  QRIS_EXPIRY_MINUTES,
  VA_EXPIRY_MINUTES,
} from "@/lib/payments";
import {
  IDLE_WINDOW_MS,
  MAX_CHANGES_PER_PULL,
  MAX_CLOCK_SKEW_MS,
  ONLINE_WINDOW_MS,
  SYNC_FINGERPRINT_MAX,
  SYNC_LABEL_MAX,
  SYNC_PAYLOAD_MAX,
  type SyncEntity,
  type SyncPlatform,
} from "@/lib/sync";
import type { ReceiptWhatsappSendResult } from "@/lib/receiptWhatsapp";
import { actingRole, useSession } from "@/lib/session";
import {
  EMPTY_INVITE_DELIVERY,
  validateTeamInvite,
  validateTeamMemberEdit,
} from "@/lib/team";
import { StoreContext } from "./context";
import { modulesFor } from "./modules";
import {
  EMPTY_AR_SUMMARY,
  EMPTY_FRANCHISE_REPORT,
  EMPTY_OPNAME_SUMMARY,
  EMPTY_PAYABLE_SUMMARY,
  EMPTY_PURCHASING_SUMMARY,
  EMPTY_THREEWAY_SUMMARY,
  EMPTY_SUMMARY,
  EMPTY_SUPPORT_SUMMARY,
  EMPTY_WAREHOUSE_CAPACITY,
  PAYMENT_LABEL_BY_METHOD,
  type ActSupportTicketInput,
  type CreateSupportTicketInput,
  type CreateApiKeyInput,
  type CreateBillInput,
  type CreateCategoryInput,
  type CreateCustomerInput,
  type CreateCustomRoleInput,
  type CreateMemberInput,
  type CreateProductInput,
  type CreateSubcategoryInput,
  type CreateWebhookEndpointInput,
  type ProductDeletionInfo,
  type UpdateProductInput,
  type UpdatedProduct,
  type CreateSaleInput,
  type CreateSaleResult,
  type CreateTableInput,
  type UpdateTableInput,
  type StoreTableDeletionCheck,
  type CreateOrderInput,
  type CreateRequisitionInput,
  type CreateSupplierInput,
  type CreateWarehouseInput,
  type DecideRequisitionInput,
  type InviteTeamMemberInput,
  type InvitedTeamMember,
  type SendReceiptWhatsappInput,
  type UpdateTeamMemberInput,
  type ReceiveGoodsInput,
  type PayBatchInput,
  type RenameCategoryInput,
  type RenameSubcategoryInput,
  type RenamedCategory,
  type RenamedSubcategory,
  type RemovedCategory,
  type RemovedSubcategory,
  type StoreCategory,
  type StoreSubcategory,
  type RecordInvoiceInput,
  type RecordPayablePaymentInput,
  type ResolveMatchInput,
  type SetOpnameCountInput,
  type StartOpnameInput,
  type StoreOpnameLocation,
  type StoreOpnameSession,
  type MatchDecisionKind,
  type StoreOpnameSummary,
  type StoreAdvancedReport,
  type StoreOrder,
  type StorePaymentBatch,
  type StoreThreewaySummary,
  type StorePayable,
  type StorePayablePayment,
  type StorePayableSummary,
  type StorePurchasingSummary,
  type StoreReceipt,
  type StoreRequisition,
  type StoreStockRow,
  type StoreSupplier,
  type StoreTransfer,
  type UpdateSupplierInput,
  type StoreWarehouse,
  type StoreWarehouseCapacity,
  type TransferStockInput,
  type HoldSaleInput,
  type PaymentLabel,
  type RecordPaymentInput,
  type SetCreditInput,
  type SetModifiersInput,
  type SetPricingInput,
  type SetProductCategoryInput,
  type StoreApi,
  type StoreApiKey,
  type StoreApiKeySummary,
  type StoreArSummary,
  type StoreBuiltinRole,
  type StoreCustomRole,
  type StoreCustomer,
  type StoreKdsTicket,
  type StoreMejaOrder,
  type StoreMember,
  type StoreRoleSummary,
  type StoreFranchiseReport,
  type StoreSupportLimits,
  type StoreSupportPlan,
  type StoreSupportSummary,
  type StoreSupportTicket,
  type StoreTeamMember,
  type StoreWebhookDelivery,
  type StoreWebhookEndpoint,
  type StoreWebhookSummary,
  type UpdateCustomRoleInput,
  type UpdateBuiltinRoleInput,
  EMPTY_BUILTIN_ROLE_SUMMARY,
  type UpdateWebhookEndpointInput,
  type WebhookTestResult,
  type StoreLogo,
  type StoreProduct,
  type StoreReceivable,
  type StoreSale,
  type StoreSummary,
  type StoreTable,
  type UpdateMemberInput,
  type ActDigitalChargeInput,
  type CreateDigitalChargeInput,
  EMPTY_DIGITAL_SUMMARY,
  type StoreDigitalCharge,
  type StoreDigitalLimits,
  type StoreDigitalPlan,
  type StoreDigitalSummary,
  type StoreSyncChange,
  type StoreSyncDevice,
  type StoreSyncEntityOption,
  type StoreSyncLimits,
  type StoreSyncPlan,
  type StoreSyncPlatformOption,
  type StoreSyncSummary,
  EMPTY_SYNC_SUMMARY,
  type RegisterSyncDeviceInput,
  type PushSyncInput,
  type PullSyncInput,
  type PullSyncResult,
  type UpdateTaxInput,
  type UpdatedTax,
  type UpdateFnbTaxInput,
  type UpdatedFnbTax,
  type UpdateReceiptInput,
  type UpdatedReceipt,
  type UpdateShiftInput,
  type UpdatedShift,
  type ShiftAlertReportInput,
  type ShiftAlertReportResult,
  type StoreShiftAlert,
  type StoreTill,
  type StoreFnbTaxMonth,
  type StoreFnbTaxMonthSummary,
  type StoreUserProfile,
  type StoreTenantProfile,
  type SyncedProductCategories,
  type UpdateUserProfileInput,
  type UpdateTenantProfileInput,
  type UpdatedBusinessCategory,
  type UpdatedUserProfile,
  type UpdatedTenantProfile,
} from "./types";

/**
 * Bentuk satu baris perubahan yang dikirim server (`sync.board` & `sync.changes`
 * memakai bentuk yang sama), diubah ke bentuk yang dipakai halaman.
 */
interface SyncChangeDoc {
  id: string;
  revision: number;
  deviceId: string;
  deviceName: string;
  platform: SyncPlatform;
  entity: SyncEntity;
  entityId: string;
  baseRevision: number;
  outcome: StoreSyncChange["outcome"];
  reason: string | null;
  payload: string;
  updatedAt: number;
  conflict: boolean;
  resolvedAt: number | null;
  createdAt: number;
}

function syncChangeFromDoc(row: SyncChangeDoc): StoreSyncChange {
  return {
    id: row.id,
    revision: row.revision,
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    platform: row.platform,
    entity: row.entity,
    entityId: row.entityId,
    baseRevision: row.baseRevision,
    outcome: row.outcome,
    reason: row.reason,
    payload: row.payload,
    updatedAt: row.updatedAt,
    conflict: row.conflict,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
  };
}

const OUTBOX_KEY = "mesinpos.outbox.v1";

/**
 * Berapa bulan yang dibaca laporan pajak & pungutan F&B (`reports.fnbTaxMonths`).
 * Dua belas bulan — cukup untuk laporan setahun berjalan sekaligus, dan sama
 * dengan yang dipakai mode demo (`src/lib/store/demo.tsx`) supaya kedua mode
 * menampilkan daftar bulan yang persis sama.
 */
const FNB_TAX_REPORT_MONTHS = 12;

const METHOD_BY_LABEL: Record<PaymentLabel, "cash" | "qris" | "card" | "transfer"> = {
  Tunai: "cash",
  QRIS: "qris",
  Kartu: "card",
  Transfer: "transfer",
};

function clockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * A rejection ("stok tidak cukup", "akses ditolak") must stay a normal error so
 * the outbox retries it a few times and then marks it blocked for a human.
 * Only genuine connectivity failures become OfflineError, which pauses the
 * queue instead of burning attempts.
 */
const CONNECTIVITY = /failed to fetch|networkerror|network error|websocket|connection (lost|closed)|timed? ?out|econnrefused|offline|load failed/i;

function toTransportError(error: unknown): Error {
  if (isOfflineError(error)) return error as Error;
  const message = error instanceof Error ? error.message : String(error);
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return new OfflineError(message);
  }
  if (CONNECTIVITY.test(message)) return new OfflineError(message);
  return error instanceof Error ? error : new Error(message);
}

export function ConvexStoreProvider({ children }: { children: ReactNode }) {
  const {
    session,
    adoptWorkspace,
    setVerticals,
    setPlan,
    setCustomRole,
    setRolePermissions,
    setUserProfile,
    setTenantProfile: setSessionTenantProfile,
    setBusinessCategory: setSessionBusinessCategory,
  } = useSession();
  const tenant = session?.tenant ?? null;
  const slug = tenant?.slug ?? null;
  // Izin yang dipakai untuk memutuskan query mana yang boleh dilanggan dibaca
  // dari **server**, dan itu baru bisa dihitung setelah workspace aktif
  // diketahui — lihat blok “Izin server” setelah `tenantId`.

  // The acting user resolves before any data is read: every tenant-scoped query
  // needs an actor, because the backend refuses to serve a tenant's data to a
  // caller who is not one of its members.
  const [userId, setUserId] = useState<Id<"users"> | null>(null);

  // A stable window for "today" so the query args do not change every render.
  const dayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const dayEnd = useMemo(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }, []);
  /*
    Workspace yang bisa dipakai pengguna aktif, langsung dari keanggotaan di
    server (`listMine` menolak membaca keanggotaan orang lain). Sengaja **bukan**
    pencarian slug: nama bisnis boleh sama antara dua pemilik toko, dan menebak
    slug tidak boleh membuat satu akun masuk ke workspace milik bisnis lain.
  */
  const myWorkspaces = useQuery(api.tenants.listMine, userId ? { userId } : "skip");
  /*
    Profil pengguna aktif dibaca dari barisnya sendiri (`users.get` melayani
    profil pemanggil saja — lihat `verifyActor`), bukan dari sesi perangkat:
    nama itu milik akunnya, jadi masuk dari perangkat lain harus menampilkan nama
    yang sama. Sesi tetap dipakai sebagai jembatan sebelum query menjawab.
  */
  const myProfileDoc = useQuery(api.users.get, userId ? { userId } : "skip");
  /*
    Akun platform developer dikenali dari barisnya sendiri (`users.platformRole`),
    bukan dari peran tenant — penanda itu di luar RBAC tenant (lihat
    `@/lib/platform`). Nilainya dipakai sidebar aplikasi untuk menampilkan jalan
    masuk ke backstage `/platform`; halaman backstage tetap memeriksa ulang lewat
    `platform.me`, jadi ini hanya soal keterlihatan menu, bukan gerbang.
  */
  const platformDeveloper = isPlatformRole(myProfileDoc?.platformRole ?? "");

  /**
   * Keanggotaan yang **aktif** — hanya itu yang boleh dipakai membuka langganan
   * data. Anggota yang dinonaktifkan pemiliknya tetap terdaftar di `listMine`
   * (dengan `active: false`) supaya keadaannya bisa dijelaskan; kalau barisnya
   * diperlakukan seolah tidak ada, orang itu justru dibuatkan workspace baru dari
   * sisa sesi perangkatnya (lihat efek provisioning di bawah).
   */
  const usableWorkspaces = useMemo(
    () => myWorkspaces?.filter((row) => isActiveMembership(row)),
    [myWorkspaces],
  );

  /**
   * Workspace aktif: pilihan sesi perangkat ini kalau memang salah satu miliknya,
   * kalau tidak workspace pertama miliknya. `undefined` = masih dimuat, `null` =
   * tidak ada workspace yang bisa dipakai (belum punya sama sekali, atau
   * keanggotaannya dinonaktifkan).
   */
  const workspace = useMemo(() => {
    if (!usableWorkspaces) return undefined;
    if (usableWorkspaces.length === 0) return null;
    return (
      usableWorkspaces.find((row) => row.tenant.slug === slug) ??
      usableWorkspaces[0]
    );
  }, [usableWorkspaces, slug]);

  /**
   * Pengguna punya keanggotaan, tetapi semuanya nonaktif — bukan “belum punya
   * workspace”. Dua keadaan itu sengaja dibedakan: yang pertama dijelaskan lewat
   * notis, yang kedua ditawari mendirikan bisnis.
   */
  const membershipSuspended =
    myWorkspaces !== undefined &&
    myWorkspaces.length > 0 &&
    usableWorkspaces !== undefined &&
    usableWorkspaces.length === 0;

  const tenantId = workspace?.tenant._id;

  /*
    Izin yang dipakai untuk memutuskan **query mana yang boleh dilanggan datang
    dari server** (`roles.myAccess`), bukan dari sesi perangkat.

    Sesi perangkat bisa belum selaras, dan justru di sinilah itu mematikan:
    langganan Convex yang ditolak **menjatuhkan render**, jadi yang muncul adalah
    halaman “gagal dimuat”, bukan layar yang menjelaskan. Dua keadaan yang
    sebelumnya memicunya:

      1. **Sesi tanpa tenant dibaca sebagai pemilik.** Masuk di perangkat baru
         (termasuk menerima undangan sebagai kasir) membuat sesi belum punya
         workspace, sementara `workspace` dari `listMine` sudah ada — seluruh
         query bergerbang izin dibuka atas nama pemilik, padahal server mengenali
         aktornya sebagai kasir dan menolak (`products.listAll`: “peran cashier
         tidak memiliki izin product.manage”).
      2. **Peran sisa di perangkat.** Undangan yang berubah atau dicabut
         meninggalkan peran lama di `localStorage`.

    Karena itu, selama server belum menjawab, izinnya **kosong**: langganan
    bergerbang izin tidak dibuka lebih dulu. Yang menjawab adalah keanggotaan yang
    sama dengan yang diperiksa `requirePermission` di server, dan efeknya saling
    menyelaraskan sesi di bawah. Konsekuensinya data bergerbang izin tiba satu
    putaran lebih lambat — jauh lebih baik daripada halaman gagal dimuat.
  */
  const myAccess = useQuery(
    api.roles.myAccess,
    tenantId && userId ? { tenantId, actorId: userId } : "skip",
  );
  const permissions = useMemo(
    () => sanitizePermissions(myAccess?.permissions ?? []),
    [myAccess],
  );
  const has = useCallback(
    (permission: Permission) => permissions.includes(permission),
    [permissions],
  );
  // Piutang hanya dibaca kalau perannya memang boleh (`ar.view`): query Convex
  // yang menolak akan menjatuhkan render, jadi langganannya dimatikan lebih dulu
  // — sama seperti gerbang fitur modul di bawah.
  const canViewAr = has("ar.view");
  // Sama untuk member (modul UMKM): kasir perlu daftarnya di POS.
  const canViewMembers = has("member.view");
  // Gudang & stok per lokasi (Phase 3): hanya peran yang memang bekerja dengan
  // stok. Query yang ditolak akan menjatuhkan render, jadi langganannya
  // dinyalakan hanya saat izinnya ada.
  const canViewInventory = has("inventory.view");
  // Katalog pengelolaan (`products.listAll`, termasuk produk nonaktif) hanya untuk
  // peran yang memang mengurus produk — kasir tidak perlu daftar produk mati yang
  // tidak bisa dia apa-apakan.
  const canManageProducts = has("product.manage");
  // Pembelian (Phase 3): PR/PO/GRN dibaca selama perannya punya `purchase.view`
  // (keuangan termasuk, untuk melihat komitmen belanja).
  const canViewPurchasing = has("purchase.view");
  const canViewPayables = has("payable.view");
  // Peran kustom (Phase 4): halaman Tim & Peran butuh `team.manage`.
  const canManageTeam = has("team.manage");
  // Akses API & webhook (Phase 4): halaman API & Webhook butuh `api.manage`.
  // Query-nya sendiri menuntut izin itu, jadi langganannya dimatikan lebih
  // dulu untuk peran lain — sama seperti piutang & pembelian di atas.
  const canManageApi = has("api.manage");
  // Dukungan khusus (Phase 5): daftar tiket butuh `support.view` (keuangan
  // termasuk, karena banyak tiket soal tagihan); mengubahnya butuh
  // `support.manage`. Query-nya menuntut `support.view`, jadi langganannya
  // dimatikan lebih dulu untuk peran lain.
  const canViewSupport = has("support.view");
  // Pembayaran digital (Phase 6): daftar tagihan butuh `payment.view`; membuat,
  // melunasi, dan membatalkannya butuh `payment.manage`. Query-nya menuntut
  // `payment.view`, jadi langganannya dimatikan lebih dulu untuk peran lain.
  const canViewPayments = has("payment.view");
  // Hub sinkronisasi (Phase 6) memakai izin perangkat yang sama dengan halaman
  // perangkat lain (`device.manage`).
  const canManageSync = has("device.manage");
  // Laporan analitik (Phase 4): butuh izin `report.view`, sama seperti laporan
  // harian — tetapi kuerinya **digerbang fitur** `report.advanced`, jadi
  // langganannya baru dinyalakan kalau paket + modulnya memang memuatnya.
  const canViewReports = has("report.view");
  // Shift kas & pemberitahuan ke pemilik memakai izinnya sendiri
  // (`shift.manage`, sama dengan rute `/app/shift`): yang melaporkan keadaan kas
  // adalah perangkat yang memegang kasnya, dan yang membacanya
  // pemilik/manajer/kasir di halaman itu. Langganannya dimatikan lebih dulu
  // untuk peran lain — query yang ditolak akan menjatuhkan render.
  const canManageShift = has("shift.manage");
  // Antrean dapur (`pos.kdsTickets`) menuntut izin `kds.manage`; peran yang
  // tidak memegangnya tidak boleh berlangganan — query yang ditolak akan
  // menjatuhkan render halaman tempat ia berlangganan.
  const canWorkKitchen = has("kds.manage");
  const [analyticsDays, setAnalyticsDays] = useState(DEFAULT_ANALYTICS_DAYS);

  /*
    Izin server yang sebenarnya adalah sumber kebenaran klien juga: kalau anggota
    ini ditugaskan ke peran kustom, sesi mengikutinya — jadi menu & rute tidak
    menebak dari peran bawaan.
  */
  useEffect(() => {
    if (!myAccess) return;
    setCustomRole(
      myAccess.customRole
        ? {
            id: myAccess.customRole.id,
            name: myAccess.customRole.name,
            permissions: sanitizePermissions(myAccess.customRole.permissions),
          }
        : null,
    );
    // Izin peran bawaan yang sudah disesuaikan workspace juga ikut ke sesi: menu &
    // rute harus memakai izin server, bukan izin bawaan mentah.
    const base = sanitizePermissions(myAccess.rolePermissions ?? []);
    setRolePermissions(base.length > 0 ? base : null);
  }, [myAccess, setCustomRole, setRolePermissions]);

  const stores = useQuery(
    api.tenants.listStores,
    tenantId && userId ? { tenantId, actorId: userId } : "skip",
  );
  const storeId = stores?.[0]?._id;

  const categories = useQuery(
    api.tenants.listCategories,
    tenantId && userId ? { tenantId, actorId: userId } : "skip",
  );
  const subcategories = useQuery(
    api.tenants.listSubcategories,
    tenantId && userId ? { tenantId, actorId: userId } : "skip",
  );
  /*
    Katalog kategori utama bisnis yang boleh dipilih (diatur pemilik platform di
    backstage). Sengaja hanya butuh `userId`, **bukan** `tenantId`: onboarding
    berjalan sebelum workspace ada, dan versi lama yang menuntut keanggotaan
    membuat halaman itu jatuh ke katalog bawaan kode — kategori/subkategori baru
    dari backstage tidak pernah muncul di sana. Query-nya reaktif, jadi perubahan
    backstage sampai ke pemilih yang sedang terbuka tanpa muat ulang.

    Selama jawaban server belum datang, daftar bawaan dipakai supaya pemilih tidak
    kosong sesaat; server tetap memvalidasi ulang pilihan itu, jadi kategori yang
    sudah dinonaktifkan tidak bisa lolos.
  */
  const businessCategoryOptions = useQuery(
    api.tenants.listBusinessCategories,
    userId ? { actorId: userId } : "skip",
  );
  const productDocs = useQuery(
    api.products.listByStore,
    tenantId && storeId && userId
      ? { tenantId, storeId, actorId: userId }
      : "skip",
  );
  // Katalog lengkap (termasuk nonaktif) untuk halaman Produk & Stok. Hanya
  // dilanggan saat izinnya ada: query yang ditolak akan menjatuhkan render.
  const catalogDocs = useQuery(
    api.products.listAll,
    tenantId && storeId && userId && canManageProducts
      ? { tenantId, storeId, actorId: userId }
      : "skip",
  );
  const saleDocs = useQuery(
    api.pos.recent,
    tenantId && storeId && userId
      ? { tenantId, storeId, actorId: userId, limit: 20 }
      : "skip",
  );
  /**
   * Kas toko (`pos.till`): shift yang masih berjalan + riwayat penutupannya.
   * Dibaca tanpa gerbang izin — kasir yang menjual justru tidak memegang
   * `shift.manage`, dan ia yang paling perlu tahu kasnya sudah terbuka dari
   * perangkat mana pun.
   */
  const tillDocs = useQuery(
    api.pos.till,
    tenantId && storeId && userId
      ? { tenantId, storeId, actorId: userId }
      : "skip",
  );
  // Ringkasan harian menuntut `report.view` di server. Peran bawaan semuanya
  // memilikinya, tetapi peran kustom bisa tidak — dan query yang ditolak akan
  // menjatuhkan render, jadi langganannya ikut digerbang izin seperti katalog
  // pengelolaan di atas.
  const rawSummary = useQuery(
    api.reports.dailySummary,
    tenantId && storeId && userId && canViewReports
      ? { tenantId, storeId, actorId: userId, from: dayStart, to: dayEnd }
      : "skip",
  );

  // Modul plug-in: daftar aktif yang sebenarnya ada di server, bukan di sesi.
  const remoteModules = useQuery(
    api.modules.getForTenant,
    tenantId && userId ? { tenantId, actorId: userId } : "skip",
  );

  // Modul aktif versi server dipakai lebih dulu untuk memutuskan query mana yang
  // boleh dijalankan: `pos.kdsTickets` **menolak** tenant tanpa modul F&B (dan
  // peran tanpa izin `kds.manage`), dan query Convex yang melempar akan
  // menjatuhkan render. Jadi langganannya dinyalakan hanya saat fiturnya aktif
  // **dan** perannya memang pekerja dapur.
  const sessionVerticals = useMemo<Vertical[]>(
    () => (tenant ? (tenant.verticals ?? [tenant.vertical]) : ["umkm"]),
    [tenant],
  );
  const serverVerticals = remoteModules?.verticals as Vertical[] | undefined;
  const planKey = remoteModules?.planKey ?? tenant?.planKey ?? "starter";
  const entitlements = useMemo(() => entitlementFor(planKey), [planKey]);
  const verticalsForFeatures = serverVerticals ?? sessionVerticals;
  const tableFeatureOn = isFeatureEnabled(entitlements, verticalsForFeatures, "pos.table");
  const kdsFeatureOn = isFeatureEnabled(entitlements, verticalsForFeatures, "pos.kds");

  const tableDocs = useQuery(
    api.tables.list,
    tenantId && storeId && userId && tableFeatureOn
      ? { tenantId, storeId, actorId: userId }
      : "skip",
  );
  const kdsTicketDocs = useQuery(
    api.pos.kdsTickets,
    tenantId && storeId && userId && kdsFeatureOn && canWorkKitchen
      ? { tenantId, storeId, actorId: userId }
      : "skip",
  );
  /**
   * Pesanan QR meja untuk kasir & layar dapur: yang menunggu pembayaran dan yang
   * baru lunas. Modulnya sama dengan denah meja, jadi gerbangnya `pos.table`.
   */
  const mejaOrderDocs = useQuery(
    api.meja.listOrders,
    tenantId && userId && tableFeatureOn ? { tenantId, actorId: userId } : "skip",
  );

  // Analitik lanjutan (`report.advanced`, paket Enterprise). Offset zona waktu
  // ikut dikirim supaya "jam tersibuk" adalah jam dinding toko.
  const analyticsFeatureOn = isFeatureEnabled(
    entitlements,
    verticalsForFeatures,
    "report.advanced",
  );
  const timezoneOffsetMinutes = useMemo(() => -new Date().getTimezoneOffset(), []);
  const analyticsDocs = useQuery(
    api.reports.advanced,
    tenantId && storeId && userId && canViewReports && analyticsFeatureOn
      ? {
          tenantId,
          storeId,
          actorId: userId,
          days: analyticsDays,
          timezoneOffsetMinutes,
        }
      : "skip",
  );

  // Laporan lintas cabang (`scale.franchise`, Phase 5) — kuerinya digerbang
  // fitur di server, dan paket yang lebih rendah mendapat perkiraan kosong.
  const franchiseFeatureOn = isFeatureEnabled(
    entitlements,
    verticalsForFeatures,
    "scale.franchise",
  );
  const franchiseDocs = useQuery(
    api.reports.franchise,
    tenantId && userId && canViewReports && franchiseFeatureOn
      ? {
          tenantId,
          actorId: userId,
          days: analyticsDays,
          timezoneOffsetMinutes,
        }
      : "skip",
  );

  // Piutang B2B (`ar.creditlimit`): dibaca selama perannya boleh melihat. Ini
  // **tidak** digerbang fitur modul, karena nota piutang lama harus tetap bisa
  // ditagih walau modul Grosir dimatikan (lihat src/convex/ar.ts).
  const arDocs = useQuery(
    api.ar.list,
    tenantId && userId && canViewAr ? { tenantId, actorId: userId } : "skip",
  );

  // Member & diskon (`member.discount`): dibaca selama perannya boleh. Seperti
  // piutang, ini tidak digerbang fitur modul supaya data member tetap bisa
  // dirapikan saat modul UMKM dimatikan.
  const memberDocs = useQuery(
    api.loyalty.list,
    tenantId && userId && canViewMembers ? { tenantId, actorId: userId } : "skip",
  );

  // Gudang & stok per lokasi (`inventory.multiwarehouse`, Phase 3). Dibaca
  // selama perannya punya `inventory.view`; menambah gudang tetap digerbang
  // fitur di server, dan memindahkan stok selalu boleh.
  const inventoryDocs = useQuery(
    api.inventory.list,
    tenantId && storeId && userId && canViewInventory
      ? { tenantId, storeId, actorId: userId }
      : "skip",
  );

  // Sesi stock opname (`inventory.opname`, Phase 3) — izinnya `inventory.view`,
  // sama dengan halaman Gudang & Stok.
  const opnameDocs = useQuery(
    api.opname.list,
    tenantId && storeId && userId && canViewInventory
      ? { tenantId, storeId, actorId: userId }
      : "skip",
  );

  // Peran kustom (`rbac.custom`, Phase 4). `members.list` dipakai bersama untuk
  // daftar anggota (dan sudah membawa `customRoleId`), lalu izin efektif tiap
  // anggota dihitung dengan aturan murni yang sama dengan backend.
  const roleDocs = useQuery(
    api.roles.list,
    tenantId && userId && canManageTeam ? { tenantId, actorId: userId } : "skip",
  );
  const teamDocs = useQuery(
    api.members.list,
    tenantId && userId && canManageTeam ? { tenantId, actorId: userId } : "skip",
  );
  // Kunci API & webhook (`api.access`, Phase 4). Dibaca hanya saat perannya
  // punya `api.manage`; membuat/mengubah tetap digerbang fitur di server,
  // sementara mencabut kunci & mematikan endpoint selalu boleh.
  const apiAccessDocs = useQuery(
    api.apiAccess.overview,
    tenantId && userId && canManageApi ? { tenantId, actorId: userId } : "skip",
  );

  // Tiket dukungan (`support.dedicated`, Phase 5). Membuka tiket berprioritas
  // Tinggi/Mendesak dan eskalasi tetap digerbang fitur di server, sementara
  // menambah catatan/menutup/membuka ulang selalu boleh.
  const supportDocs = useQuery(
    api.support.list,
    tenantId && userId && canViewSupport ? { tenantId, actorId: userId } : "skip",
  );
  const createSupportTicketMutation = useMutation(api.support.create);
  const actSupportTicketMutation = useMutation(api.support.act);

  // Tagihan pembayaran digital (`payment.digital`, Phase 6). Membuat tagihan
  // digerbang fitur di server; melunasi & membatalkan selalu boleh.
  const digitalDocs = useQuery(
    api.payments.list,
    tenantId && userId && canViewPayments ? { tenantId, actorId: userId } : "skip",
  );
  const createDigitalChargeMutation = useMutation(api.payments.create);
  const actDigitalChargeMutation = useMutation(api.payments.act);

  // Hub sinkronisasi real-time (`sync.realtime`, Phase 6). Mendaftarkan perangkat
  // & mendorong perubahan digerbang fitur di server; detak, menarik, dan
  // menandai konflik selesai selalu boleh.
  const syncDocs = useQuery(
    api.sync.board,
    tenantId && userId && canManageSync ? { tenantId, actorId: userId } : "skip",
  );
  // Klien Convex juga dipakai untuk **tarikan sekali jalan**: `sync.changes`
  // adalah query berjendela, bukan langganan, jadi ia diambil saat diminta —
  // bukan disimpan sebagai state seperti `sync.board`.
  const convex = useConvex();
  const registerSyncMutation = useMutation(api.sync.register);
  const heartbeatSyncMutation = useMutation(api.sync.heartbeat);
  const pushSyncMutation = useMutation(api.sync.push);
  const resolveSyncMutation = useMutation(api.sync.resolve);

  const createApiKeyMutation = useMutation(api.apiAccess.createKey);
  const revokeApiKeyMutation = useMutation(api.apiAccess.revokeKey);
  const createEndpointMutation = useMutation(api.apiAccess.createEndpoint);
  const updateEndpointMutation = useMutation(api.apiAccess.updateEndpoint);
  const removeEndpointMutation = useMutation(api.apiAccess.removeEndpoint);
  const testEndpointAction = useAction(api.apiAccess.testEndpoint);
  const sendReceiptWhatsappAction = useAction(api.receiptWa.send);

  const createUser = useMutation(api.users.createOrGet);
  const cancelRegistrationMutation = useMutation(api.users.cancelRegistration);
  const createTenant = useMutation(api.tenants.create);
  const createRoleMutation = useMutation(api.roles.create);
  const updateRoleMutation = useMutation(api.roles.update);
  const removeRoleMutation = useMutation(api.roles.remove);
  const assignRoleMutation = useMutation(api.roles.assign);
  const setBuiltinRoleMutation = useMutation(api.roles.setBuiltin);
  const removeBuiltinRoleMutation = useMutation(api.roles.removeBuiltin);
  const restoreBuiltinRoleMutation = useMutation(api.roles.restoreBuiltin);
  const resetBuiltinRoleMutation = useMutation(api.roles.resetBuiltin);
  const addMemberMutation = useMutation(api.members.add);
  const resendInviteMutation = useMutation(api.members.resendInvite);
  const updateTeamMemberMutation = useMutation(api.members.update);
  const removeTeamMemberMutation = useMutation(api.members.remove);
  const recordWaInviteMutation = useMutation(api.members.recordWaInvite);
  const createSaleMutation = useMutation(api.pos.createSale);
  const adjustStockMutation = useMutation(api.products.adjustStock);
  const setModulesMutation = useMutation(api.modules.setForTenant);
  const setTaxMutation = useMutation(api.tenants.updateTax);
  const updateUserProfileMutation = useMutation(api.users.updateProfile);
  const updateTenantProfileMutation = useMutation(api.tenants.updateProfile);
  const setBusinessCategoryMutation = useMutation(api.tenants.setBusinessCategory);
  const setFnbTaxMutation = useMutation(api.tenants.updateFnbTax);
  const setReceiptMutation = useMutation(api.tenants.updateReceipt);
  const setShiftMutation = useMutation(api.tenants.updateShift);
  const openTillMutation = useMutation(api.pos.openShift);
  const closeTillMutation = useMutation(api.pos.closeShift);
  const reportShiftAlertMutation = useMutation(api.shiftAlerts.report);
  const resolveShiftAlertMutation = useMutation(api.shiftAlerts.resolve);
  const setLogoMutation = useMutation(api.tenants.setLogo);
  const removeLogoMutation = useMutation(api.tenants.removeLogo);
  const generateLogoUploadUrlMutation = useMutation(api.tenants.generateLogoUploadUrl);
  const changePlanMutation = useMutation(api.billing.changePlan);
  const createProductMutation = useMutation(api.products.create);
  const updateProductMutation = useMutation(api.products.update);
  const setProductActiveMutation = useMutation(api.products.setActive);
  const removeProductMutation = useMutation(api.products.remove);
  const generateImageUploadUrlMutation = useMutation(api.products.generateImageUploadUrl);
  const addProductImageMutation = useMutation(api.products.addImage);
  const removeProductImageMutation = useMutation(api.products.removeImage);
  const setPricingMutation = useMutation(api.products.setPricing);
  const setCategoryMutation = useMutation(api.products.setCategory);
  const setModifiersMutation = useMutation(api.products.setModifiers);
  const createTableMutation = useMutation(api.tables.create);
  const updateTableMutation = useMutation(api.tables.update);
  const moveTableMutation = useMutation(api.tables.move);
  const importTablesMutation = useMutation(api.tables.importBatch);
  const setTableActiveMutation = useMutation(api.tables.setActive);
  const removeTableMutation = useMutation(api.tables.remove);
  const issueTableMenuQrMutation = useMutation(api.tables.issueMenuQr);
  const cancelMejaOrderMutation = useMutation(api.meja.cancelOrder);
  const holdSaleMutation = useMutation(api.pos.createSale);
  const finalizeHeldMutation = useMutation(api.pos.finalizeHeldSale);
  const kitchenDoneMutation = useMutation(api.pos.kitchenDone);
  const createCustomerMutation = useMutation(api.ar.createCustomer);
  const setCreditMutation = useMutation(api.ar.setCredit);
  const recordPaymentMutation = useMutation(api.ar.recordPayment);
  const createMemberMutation = useMutation(api.loyalty.create);
  const updateMemberMutation = useMutation(api.loyalty.update);
  const createCategoryMutation = useMutation(api.categories.create);
  const renameCategoryMutation = useMutation(api.categories.rename);
  const syncProductCategoriesMutation = useMutation(
    api.categories.syncFromBusinessCategory,
  );
  const setCategoryActiveMutation = useMutation(api.categories.setActive);
  const removeCategoryMutation = useMutation(api.categories.remove);
  const createSubcategoryMutation = useMutation(api.subcategories.create);
  const renameSubcategoryMutation = useMutation(api.subcategories.rename);
  const setSubcategoryActiveMutation = useMutation(api.subcategories.setActive);
  const removeSubcategoryMutation = useMutation(api.subcategories.remove);
  const purchasingDocs = useQuery(
    api.purchasing.list,
    tenantId && userId && canViewPurchasing ? { tenantId, actorId: userId } : "skip",
  );

  // Hutang usaha (`payable.view`) — dibaca hanya oleh peran yang boleh
  // melihat uang: keuangan, manajer, dan pemilik.
  const payableDocs = useQuery(
    api.payables.list,
    tenantId && userId && canViewPayables ? { tenantId, actorId: userId } : "skip",
  );

  const startOpnameMutation = useMutation(api.opname.start);
  const setOpnameCountMutation = useMutation(api.opname.setCount);
  const postOpnameMutation = useMutation(api.opname.post);
  const cancelOpnameMutation = useMutation(api.opname.cancel);
  const createWarehouseMutation = useMutation(api.inventory.create);
  const updateWarehouseMutation = useMutation(api.inventory.update);
  const transferStockMutation = useMutation(api.inventory.transfer);
  const createSupplierMutation = useMutation(api.purchasing.createSupplier);
  const updateSupplierMutation = useMutation(api.purchasing.updateSupplier);
  const createBillMutation = useMutation(api.payables.createBill);
  const recordPayablePaymentMutation = useMutation(api.payables.recordPayment);
  const recordInvoiceMutation = useMutation(api.payables.recordInvoice);
  const resolveMatchMutation = useMutation(api.payables.resolveMatch);
  const payBatchMutation = useMutation(api.payables.payBatch);
  const createRequisitionMutation = useMutation(api.purchasing.createRequisition);
  const decideRequisitionMutation = useMutation(api.purchasing.decideRequisition);
  const createOrderMutation = useMutation(api.purchasing.createOrder);
  const cancelOrderMutation = useMutation(api.purchasing.cancelOrder);
  const receiveGoodsMutation = useMutation(api.purchasing.receive);

  const [provisionError, setProvisionError] = useState<string | null>(null);

  // Alasan terakhir yang membuat workspace belum tersambung. Disimpan **juga** di
  // ref supaya pesan gerbang aksi di bawah selalu membawa sebabnya walau closure
  // callback-nya berasal dari render lama — daftar dependensi puluhan aksi itu
  // sengaja tidak ditambahi satu per satu hanya untuk teks galat.
  const provisionErrorRef = useRef<string | null>(null);
  const reportProvisionError = useCallback((message: string | null) => {
    provisionErrorRef.current = message;
    setProvisionError(message);
  }, []);

  /**
   * Gerbang aksi saat workspace belum punya `tenantId` di server.
   *
   * Kalau sebabnya sudah diketahui (provisioning ditolak), sebab itu ikut
   * disebut: “coba lagi sebentar lagi” menyesatkan saat penolakannya permanen —
   * mis. akun platform memang tidak boleh punya workspace.
   */
  // Deklarasi fungsi beranotasi `: never` (bukan panah dalam `const`) supaya
  // TypeScript menganggap pemanggilannya **menghentikan alur**: penyempitan
  // `tenantId`/`userId` sesudah guard bergantung pada itu, dan tanpanya seluruh
  // aksi di bawah gagal type-check.
  function notReady(): never {
    const reason = provisionErrorRef.current;
    throw new Error(
      reason
        ? `Tenant belum tersambung ke server: ${reason}`
        : "Tenant belum siap. Coba lagi sebentar lagi.",
    );
  }

  // Resolve the acting user once per session. `createOrGet` is idempotent, so
  // this is also the first-run registration.
  useEffect(() => {
    /*
      Sesi berakhir (keluar, atau pendaftarannya dibatalkan): id pengguna yang
      tersimpan di sini milik baris `users` yang mungkin sudah tidak ada. Kalau
      dibiarkan, `createOrGet` tidak akan pernah berjalan untuk akun berikutnya —
      dan setelah pendaftaran dibatalkan, id lama itu bahkan menunjuk baris yang
      sudah dihapus. Karena itu id-nya dilepas bersama sesinya.
    */
    if (!session) {
      if (userId) setUserId(null);
      return;
    }
    if (userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await createUser({
          email: session.user.email,
          name: session.user.name,
        });
        if (!cancelled) setUserId(result.userId);
      } catch (error) {
        if (!cancelled) {
          reportProvisionError(
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, userId, createUser, reportProvisionError]);

  const provisioning = useRef(false);

  /**
   * Membatalkan pendaftaran akun yang baru dibuat.
   *
   * Yang dikirim ke server hanya id baris milik sesi ini; server memverifikasi
   * aktornya sendiri lalu menghapus baris `users` beserta jejak masuknya. Setelah
   * ini sesi perangkat **masih hidup** — keadaan itu sengaja diserahkan ke
   * halaman (`signOut` + kembali ke beranda) supaya urutannya terlihat di satu
   * tempat, bukan tersembunyi di dalam store.
   */
  const cancelRegistration = useCallback(async () => {
    if (!userId) {
      throw new Error(
        "Akun belum tersambung ke server, jadi pendaftarannya belum bisa dibatalkan. Coba lagi sebentar lagi.",
      );
    }
    const result = await cancelRegistrationMutation({ userId });
    return { email: result.email, sentence: result.sentence };
  }, [userId, cancelRegistrationMutation]);

  /*
    Keanggotaan nonaktif dijelaskan lewat **alasan** workspace belum tersambung
    (notis di atas konten), bukan dibiarkan menjatuhkan render: langganan yang
    ditolak server menggagalkan halaman yang memuatnya, jadi anggota yang
    dinonaktifkan hanya melihat “Halaman ini gagal dimuat”. Kalimatnya diambil
    apa adanya dari aturan bersama (`lib/team.ts`) supaya sama dengan yang dibaca
    pemilik di halaman Tim & Peran; dan kalau aksesnya dikembalikan, kalimat itu
    dilepas lagi supaya notisnya tidak menggantung.
  */
  useEffect(() => {
    if (membershipSuspended) {
      reportProvisionError(MEMBERSHIP_SUSPENDED_NOTE);
      return;
    }
    if (isMembershipSuspended(provisionErrorRef.current)) {
      reportProvisionError(null);
    }
  }, [membershipSuspended, reportProvisionError]);

  // Provisioning hanya untuk akun yang **belum punya satu pun** keanggotaan
  // (`myWorkspaces` kosong). Akun yang sudah punya langsung memakai miliknya —
  // mendaftar/masuk di perangkat lain tidak membuat bisnis kedua. Keanggotaan yang
  // dinonaktifkan juga **tidak** memicu provisioning: orang itu sudah punya
  // workspace, hanya aksesnya ditutup.
  useEffect(() => {
    if (!session || !tenant || !userId) return;
    if (myWorkspaces === undefined || myWorkspaces.length > 0) return;
    if (provisioning.current) return;

    provisioning.current = true;
    void (async () => {
      try {
        const created = await createTenant({
          ownerId: userId,
          name: tenant.name,
          slug: tenant.slug,
          planKey: tenant.planKey,
          storeName: tenant.storeName,
          verticals: tenant.verticals ?? [tenant.vertical],
          // Kategori utama dari onboarding ikut dikunci saat workspace lahir;
          // tanpa ini pilihan pemilik hanya hidup di perangkat dan server masih
          // menawarkannya untuk dipilih kedua kali.
          businessCategory: tenant.businessCategory
            ? {
                category: tenant.businessCategory.category,
                subcategory: tenant.businessCategory.subcategory,
              }
            : undefined,
        });
        // Slug final datang dari server: nama bisnis yang sudah dipakai bisnis lain
        // mendapat slug bebas (`toko-berkah-2`). Sesi diselaraskan supaya halaman
        // lain mencari workspace yang benar-benar ada.
        if (created.slug && created.slug !== tenant.slug) {
          adoptWorkspace({ name: created.name ?? tenant.name, slug: created.slug, role: "owner" });
        }
        reportProvisionError(null);
      } catch (error) {
        reportProvisionError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        provisioning.current = false;
      }
    })();
  }, [
    session,
    tenant,
    userId,
    myWorkspaces,
    createTenant,
    adoptWorkspace,
    reportProvisionError,
  ]);

  /*
    Sesi perangkat diselaraskan dengan workspace milik pengguna di server: nama
    bisnis, alamat, paket, cabang, jam trial, dan peran yang tampil semuanya milik
    workspace yang benar-benar dipakai. Ini yang membuat akun berdiri sendiri —
    masuk dari perangkat baru memulihkan bisnisnya sendiri (bukan menawarkan
    membuat yang baru), dan sisa sesi lama tidak bisa membuat halaman menampilkan
    bisnis orang lain: sumbernya hanya daftar keanggotaan di server.

    Adopsi dipanggil tanpa syarat selama workspace sudah diketahui; dedupe di
    `adoptWorkspace` yang menahan render berulang.
  */
  const serverStoreName = stores?.[0]?.name;
  useEffect(() => {
    if (!workspace) return;
    const row = workspace.tenant;
    adoptWorkspace({
      name: row.name,
      slug: row.slug,
      // `null` = pengguna ini memakai peran tambahan (berdiri sendiri).
      role: workspace.role ?? null,
      planKey: row.planKey,
      verticals: row.verticals,
      storeName: serverStoreName,
      // Identitas usaha ikut dipulihkan supaya perangkat baru tidak melihat
      // alamat/email/WA kosong padahal pemiliknya sudah mengisinya.
      address: row.address,
      email: row.email,
      whatsapp: row.phone,
      // `undefined` untuk workspace lama yang belum pernah memilih; sesi yang sudah
      // memegang pilihan tidak dikosongkan oleh jawaban server yang belum punya
      // kolom itu.
      businessCategory:
        row.businessCategory === undefined
          ? undefined
          : businessCategoryOf(row),
      createdAt: new Date(row.createdAt).toISOString(),
      // Tenant lama (dibuat sebelum kolom jam trial ada) tidak punya nilainya;
      // sesi yang sudah dipegang perangkat ini tetap dipakai untuk kasus itu.
      trialEndsAt:
        row.trialEndsAt === undefined
          ? undefined
          : new Date(row.trialEndsAt).toISOString(),
    });
  }, [workspace, serverStoreName, adoptWorkspace]);

  /**
   * Pemulihan identitas bisnis belum selesai (lihat `StoreApi.workspacePending`).
   *
   * Dua keadaan: daftar keanggotaan masih dimuat, atau sesi perangkat masih
   * memuat identitas lain daripada workspace miliknya — efek adopsi di atas yang
   * menutup selisih itu pada render berikutnya. Sesi kosong (belum masuk) bukan
   * “sedang dipulihkan”, jadi nilainya `false` di situ.
   */
  const workspacePending =
    Boolean(session) &&
    (myWorkspaces === undefined ||
      (workspace !== null &&
        workspace !== undefined &&
        (tenant?.name !== workspace.tenant.name ||
          tenant?.slug !== workspace.tenant.slug)));

  const categoryNames = useMemo(
    () => new Map((categories ?? []).map((c) => [c._id as string, c.name])),
    [categories],
  );

  /** Nama subkategori menurut id-nya — produk menunjuk id, bukan nama. */
  const subcategoryNames = useMemo(
    () => new Map((subcategories ?? []).map((s) => [s._id as string, s.name])),
    [subcategories],
  );

  /** Dokumen produk (dari server) → bentuk yang dipakai halaman & kasir. */
  const toStoreProduct = useCallback(
    (p: NonNullable<typeof productDocs>[number]): StoreProduct => ({
      id: p._id,
      sku: p.sku,
      name: p.name,
      // Dua katalog memakai pemetaan yang sama; yang membedakan hanya daftar
      // dokumennya (`listByStore` = aktif, `listAll` = termasuk nonaktif).
      active: p.active,
      price: p.price,
      cost: p.cost,
      category: p.categoryId
        ? (categoryNames.get(p.categoryId) ?? "Tanpa kategori")
        : "Tanpa kategori",
      subcategory: p.subcategoryId
        ? subcategoryNames.get(p.subcategoryId as string)
        : undefined,
      stock: p.stock,
      // Konfigurasi grosir & modifier datang dari dokumen produk; kosong
      // berarti modulnya tidak dipakai untuk produk itu.
      unit: p.unit,
      units: p.units,
      tiers: p.tiers,
      modifiers: p.modifiers,
      // Gambar: id berkas (untuk menghapus) + URL bertanda tangan yang dibuat
      // server saat query ini dijalankan.
      images: (p.images ?? []).map((image) => ({
        id: image.id as string,
        url: image.url,
      })),
    }),
    [categoryNames, subcategoryNames],
  );

  /** Katalog penjualan: hanya produk aktif (yang dijual kasir & KDS). */
  const products: StoreProduct[] = useMemo(
    () => (productDocs ?? []).map(toStoreProduct),
    [productDocs, toStoreProduct],
  );

  /**
   * Katalog pengelolaan: semua produk, termasuk yang nonaktif — halaman Produk &
   * Stok memakainya supaya produk yang dimatikan tetap bisa diaktifkan kembali.
   * Kalau perannya tidak boleh membacanya (`product.manage` tidak ada), daftarnya
   * jatuh ke katalog penjualan supaya halaman itu tetap bisa dilihat.
   */
  const catalogProducts: StoreProduct[] = useMemo(
    () => (catalogDocs ?? productDocs ?? []).map(toStoreProduct),
    [catalogDocs, productDocs, toStoreProduct],
  );

  const sales: StoreSale[] = useMemo(
    () =>
      (saleDocs ?? [])
        .filter((s) => s.status === "completed")
        .map((s) => ({
          id: s._id,
          number: s.number,
          at: clockTime(s.createdAt),
          method: PAYMENT_LABEL_BY_METHOD[s.payments[0]?.method ?? "cash"] ?? "Tunai",
          itemCount: s.itemCount,
          total: s.total,
        })),
    [saleDocs],
  );

  const summary: StoreSummary = useMemo(() => {
    if (!rawSummary) return EMPTY_SUMMARY;
    const byMethod = { ...EMPTY_SUMMARY.byMethod };
    for (const [method, amount] of Object.entries(rawSummary.byMethod)) {
      const label = PAYMENT_LABEL_BY_METHOD[method];
      if (label) byMethod[label] += amount;
    }
    return {
      revenue: rawSummary.revenue,
      tax: rawSummary.tax,
      discount: rawSummary.discount,
      transactions: rawSummary.transactions,
      itemCount: rawSummary.itemCount,
      averagePerTransaction: rawSummary.averagePerTransaction,
      byMethod,
    };
  }, [rawSummary]);

  /**
   * Kategori seperti yang dibaca halaman: nama + status + jumlah produk.
   *
   * `productCount` dihitung dari katalog yang sudah diambil, bukan angka tersimpan
   * yang bisa basi — dan katalognya sendiri sudah terbatas pada produk aktif
   * (`products.listByStore`).
   */
  /**
   * Subkategori seperti yang dibaca halaman: nama + induk + status + jumlah produk.
   *
   * `productCount` dihitung dari katalog **lengkap** (termasuk produk nonaktif),
   * sama seperti kategori — angka ini dipakai untuk dampak hapus.
   */
  const subcategoriesForUi: StoreSubcategory[] = useMemo(
    () =>
      (subcategories ?? []).map((s) => ({
        id: s._id as string,
        categoryId: s.categoryId as string,
        name: s.name,
        active: subcategoryIsActive(s),
        productCount: (catalogDocs ?? productDocs ?? []).filter(
          (p) => p.subcategoryId === s._id,
        ).length,
      })),
    [subcategories, catalogDocs, productDocs],
  );

  /**
   * Nama subkategori → id **di dalam kategori yang dipilih**.
   *
   * Subkategori hanya berlaku di bawah kategorinya (ia dibuat di sana), jadi
   * pencocokannya memakai pasangan kategori + nama, bukan nama saja. Nama yang
   * tidak ada dianggap kesalahan pemanggil — bukan dibuat diam-diam.
   */
  const resolveSubcategoryId = useCallback(
    (categoryId: string | undefined, name: string | undefined): string | undefined => {
      const wanted = (name ?? "").trim();
      if (wanted.length === 0) return undefined;
      if (!categoryId) {
        throw new Error("Subkategori hanya bisa dipilih kalau produk punya kategori.");
      }
      const found = (subcategories ?? []).find(
        (row) => (row.categoryId as string) === categoryId && row.name === wanted,
      );
      if (!found) {
        throw new Error(
          `Subkategori “${wanted}” tidak ada di kategori itu — buat dulu di kartu “Kategori produk”, atau pilih yang lain.`,
        );
      }
      return found._id as string;
    },
    [subcategories],
  );

  const categoriesForUi: StoreCategory[] = useMemo(
    () =>
      (categories ?? []).map((c) => ({
        id: c._id as string,
        name: c.name,
        // Baris lama tanpa kolom `active` diperlakukan aktif (aturan bersama).
        active: categoryIsActive(c),
        // Dihitung dari katalog **lengkap** — angka ini dipakai untuk dampak hapus
        // kategori, dan server juga menghitung produk nonaktif di situ.
        productCount: (catalogDocs ?? productDocs ?? []).filter(
          (p) => p.categoryId === c._id,
        ).length,
      })),
    [categories, catalogDocs, productDocs],
  );

  /** Prices the cart locally — used for validation and the tendered amount. */
  const priceCart = useCallback(
    (items: CreateSaleInput["items"]) =>
      items.reduce((sum, item) => {
        const product = products.find((p) => p.id === item.productId);
        if (!product) throw new Error("Produk tidak valid untuk tenant ini.");
        // Perhitungan yang sama dengan `pos.createSale`: konversi satuan, lalu
        // harga bertingkat atas kuantitas dalam satuan dasar.
        const priced = priceLine({
          product: {
            price: product.price,
            tiers: product.tiers,
            unit: product.unit,
            units: product.units,
          },
          quantity: item.quantity,
          unitCode: item.unitCode,
        });
        if (priced.baseQty > product.stock) {
          throw new Error(
            `Stok tidak cukup untuk produk ${product.name} (tersedia ${product.stock}).`,
          );
        }
        // Tambahan modifier divalidasi ulang oleh aturan yang sama dengan
        // server, lalu dihitung per unit yang dijual.
        const modifiers = applyModifiers(product, item.modifiers ?? []);
        if (!modifiers.ok) throw new Error(modifiers.reason);
        return (
          sum +
          lineTotalWithModifiers(
            priced.lineTotal,
            item.quantity,
            modifiers.surcharge,
          )
        );
      }, 0),
    [products],
  );

  const send = useCallback(
    async (entry: OutboxEntry<CreateSaleInput>) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw new OfflineError();
      }
      if (!tenantId || !storeId) throw new OfflineError("Menyiapkan data toko…");
      if (!userId) throw new OfflineError("Menyiapkan pengguna…");

      const {
        items,
        discount,
        method,
        customerId,
        paidAmount,
        memberId,
        digitalChargeId,
      } = entry.payload;
      const subtotal = priceCart(items);
      const appliedDiscount = Math.min(Math.max(discount, 0), subtotal);
      const tendered = computeTax(subtotal - appliedDiscount).gross;
      // Pembayaran sebagian: sisanya dicatat server sebagai piutang pelanggan,
      // dan limitnya dievaluasi ulang di sana dari aturan yang sama.
      const paid = paidAmount ?? tendered;

      try {
        return await createSaleMutation({
          tenantId,
          storeId,
          cashierId: userId,
          items: items.map((item) => ({
            productId: item.productId as Id<"products">,
            quantity: item.quantity,
            unitCode: item.unitCode,
            modifiers: item.modifiers,
          })),
          discount: appliedDiscount,
          payments: [
            { method: METHOD_BY_LABEL[method], amount: paid },
          ],
          tableId: entry.payload.tableId as Id<"tables"> | undefined,
          customerId: customerId as Id<"customers"> | undefined,
          memberId: memberId as Id<"members"> | undefined,
          // Tagihan digital yang sudah lunas menanggung penjualan ini. Aman ikut
          // antrean offline: uangnya sendiri sudah dipastikan lewat tagihan yang
          // dibuat & dilunasi **online**, jadi yang menunggu di sini hanya nota
          // penjualannya — dan pemutaran ulang memakai tagihan yang sama.
          digitalChargeId: digitalChargeId as Id<"digitalCharges"> | undefined,
          /*
            Penjualan ditempelkan ke shift kas toko yang sedang berjalan, supaya
            Z-report-nya menghitung penjualan ini (server menjumlahkan penjualan
            per `shiftId`). Kalau kasnya belum dibuka, tidak ada yang ditempelkan
            — server tidak menuntutnya, dan gerbang kasir di layar sudah menutup
            jalur ini lebih dulu.
          */
          shiftId: tillDocs?.current
            ? (tillDocs.current.id as Id<"shifts">)
            : undefined,
          // Reused verbatim on every retry — this is the whole safety net.
          idempotencyKey: entry.idempotencyKey,
        });
      } catch (error) {
        throw toTransportError(error);
      }
    },
    [tenantId, storeId, userId, priceCart, createSaleMutation, tillDocs],
  );

  const outbox = useOutbox<
    CreateSaleInput,
    { number: string; total: number; kitchenFired?: boolean }
  >({
    storageKey: OUTBOX_KEY,
    send,
  });

  const createSale = useCallback(
    async (input: CreateSaleInput): Promise<CreateSaleResult> => {
      if (input.items.length === 0) throw new Error("Keranjang kosong.");

      const subtotal = priceCart(input.items);
      const appliedDiscount = Math.min(Math.max(input.discount, 0), subtotal);
      const tendered = computeTax(subtotal - appliedDiscount).gross;

      const { result } = await outbox.enqueue(input);
      if (result) {
        // `kitchenFired` datang dari server: kalau penjualannya memang langsung
        // dikirim ke dapur, kasir diberi tahu di layar yang sama dengan struknya.
        return {
          number: result.number,
          total: result.total,
          queued: false,
          kitchenFired: result.kitchenFired,
        };
      }
      // Offline: the sale is safe in the queue but the server has not assigned
      // a receipt number yet, so we say so instead of inventing one.
      return { number: null, total: tendered, queued: true };
    },
    [priceCart, outbox],
  );

  /**
   * Produk baru + stok awalnya. Nama kategori diubah jadi id di sini: halaman
   * mengirim nama (itu yang dibaca manusia), sedangkan server menyimpan id.
   */
  const createProduct = useCallback(
    async (input: CreateProductInput): Promise<{ id: string; sku: string }> => {
      if (!tenantId || !storeId) {
        notReady();
      }
      if (!userId) throw new Error("Pengguna belum siap. Coba lagi sebentar lagi.");

      const categoryName = input.category?.trim();
      const categoryId = categoryName
        ? (categories ?? []).find((c) => c.name === categoryName)?._id
        : undefined;
      const subcategoryId = resolveSubcategoryId(categoryId, input.subcategory);

      const created = await createProductMutation({
        tenantId,
        storeId,
        actorId: userId,
        // Kosong = minta server membuat SKU otomatis; nilai finalnya ada di balikan.
        sku: input.sku?.trim() ? input.sku : undefined,
        name: input.name,
        price: input.price,
        cost: input.cost,
        categoryId,
        subcategoryId: subcategoryId as Id<"subcategories"> | undefined,
        unit: input.unit,
        openingStock: input.openingStock,
      });
      return { id: created.productId as string, sku: created.sku };
    },
    [tenantId, storeId, userId, categories, resolveSubcategoryId, createProductMutation],
  );

  /**
   * Gambar produk: unggah berkas ke penyimpanan Convex, lalu tautkan id-nya ke
   * produk. Dua langkah itu memang pola Convex (minta URL → POST berkas → simpan
   * id), dan batas 8 gambar/2 MB diperiksa **lagi** di server saat menautkan.
   */
  const addProductImage = useCallback(
    async (productId: string, file: Blob): Promise<void> => {
      if (!tenantId) {
        notReady();
      }
      if (!userId) throw new Error("Pengguna belum siap. Coba lagi sebentar lagi.");

      const uploadUrl = await generateImageUploadUrlMutation({
        tenantId,
        actorId: userId,
      });
      const uploaded = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });
      if (!uploaded.ok) {
        throw new Error(`Gagal mengunggah gambar ke penyimpanan (HTTP ${uploaded.status}).`);
      }
      const payload = (await uploaded.json()) as { storageId?: string };
      if (!payload.storageId) {
        throw new Error("Penyimpanan tidak mengembalikan id berkas gambar.");
      }

      await addProductImageMutation({
        tenantId,
        actorId: userId,
        productId: productId as Id<"products">,
        storageId: payload.storageId as Id<"_storage">,
      });
    },
    [tenantId, userId, generateImageUploadUrlMutation, addProductImageMutation],
  );

  const removeProductImage = useCallback(
    async (productId: string, imageId: string): Promise<void> => {
      if (!tenantId) {
        notReady();
      }
      if (!userId) throw new Error("Pengguna belum siap. Coba lagi sebentar lagi.");

      await removeProductImageMutation({
        tenantId,
        actorId: userId,
        productId: productId as Id<"products">,
        storageId: imageId as Id<"_storage">,
      });
    },
    [tenantId, userId, removeProductImageMutation],
  );

  const adjustStock = useCallback(
    async (productId: string, delta: number, note?: string): Promise<number> => {
      if (!tenantId || !storeId) {
        notReady();
      }
      if (!userId) throw new Error("Pengguna belum siap. Coba lagi sebentar lagi.");

      const result = await adjustStockMutation({
        tenantId,
        storeId,
        productId: productId as Id<"products">,
        delta,
        note,
        actorId: userId,
      });
      return result.balance;
    },
    [tenantId, storeId, userId, adjustStockMutation],
  );

  const offline = useMemo(
    () => ({
      online: outbox.online,
      pending: outbox.pending,
      blocked: outbox.blocked,
      sync: async () => {
        await outbox.sync();
      },
      retryBlocked: () => {
        outbox.retryBlocked();
      },
    }),
    [outbox],
  );

  // Modul: jawaban server dipakai begitu tersedia; sesi hanya jembatan sampai
  // query pertama tiba, supaya kartu modul tidak berkedip kosong.
  const modules = useMemo(
    () => modulesFor(planKey, serverVerticals ?? sessionVerticals),
    [planKey, serverVerticals, sessionVerticals],
  );

  const setModules = useCallback(
    async (next: Vertical[]) => {
      if (!tenantId || !userId) {
        notReady();
      }
      await setModulesMutation({ tenantId, actorId: userId, verticals: next });
      setVerticals(next);
    },
    [tenantId, userId, setModulesMutation, setVerticals],
  );

  // Setelan PPN dibaca dari baris tenant yang sama dengan yang dibaca server
  // (`tenants.listMine` sudah berlangganan), jadi setelah `tenants.updateTax`
  // mengembalikan hasilnya, angka di kasir ikut berubah tanpa memuat ulang.
  const tax = useMemo<TaxSetting>(
    () =>
      workspace?.tenant
        ? taxSettingOf(workspace.tenant)
        : { active: true, ratePct: DEFAULT_TAX_RATE_PCT },
    [workspace],
  );

  const setTax = useCallback(
    async (input: UpdateTaxInput): Promise<UpdatedTax> => {
      if (!tenantId || !userId) {
        notReady();
      }
      return await setTaxMutation({
        tenantId,
        actorId: userId,
        active: input.active,
        ratePct: input.ratePct,
      });
    },
    [tenantId, userId, setTaxMutation],
  );

  /**
   * Pajak & pungutan F&B dibaca dari baris tenant yang sama dengan yang dibaca
   * server (`tenants.listMine` sudah berlangganan), jadi setelah
   * `tenants.updateFnbTax` tersimpan, kasir dan halaman Pengaturan ikut berubah
   * tanpa memuat ulang — dan workspace yang belum menyimpannya dibaca sebagai
   * bawaan (belum ada pungutan F&B).
   */
  const fnbTax = useMemo<FnbTaxProfile>(
    () => fnbTaxProfileOf(workspace?.tenant?.fnbTaxProfile),
    [workspace],
  );

  const setFnbTax = useCallback(
    async (input: UpdateFnbTaxInput): Promise<UpdatedFnbTax> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await setFnbTaxMutation({
        tenantId,
        actorId: userId,
        profile: input,
      });
      return {
        changed: result.changed,
        profile: result.profile as FnbTaxProfile,
        sentence: result.sentence,
      };
    },
    [tenantId, userId, setFnbTaxMutation],
  );

  /**
   * Setelan struk belanja dibaca dari baris tenant yang sama dengan yang dibaca
   * server (`tenants.listMine` sudah berlangganan), jadi setelah
   * `tenants.updateReceipt` tersimpan, kasir ikut mencetak bentuk struk yang baru
   * tanpa memuat ulang — dan workspace yang belum mengaturnya dibaca sebagai
   * bawaan (thermal 80 mm, satu lembar).
   */
  const receipt = useMemo<ReceiptSetting>(
    () => receiptSettingOf(workspace?.tenant?.receipt ?? null),
    [workspace],
  );

  const setReceipt = useCallback(
    async (input: UpdateReceiptInput): Promise<UpdatedReceipt> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await setReceiptMutation({
        tenantId,
        actorId: userId,
        setting: input,
      });
      return {
        changed: result.changed,
        setting: result.setting as ReceiptSetting,
        sentence: result.sentence,
      };
    },
    [tenantId, userId, setReceiptMutation],
  );

  /**
   * Setelan pengingat tutup shift dibaca dari baris tenant yang sama dengan yang
   * dibaca server (`tenants.listMine` sudah berlangganan), jadi setelah
   * `tenants.updateShift` tersimpan, halaman Kasir & Shift & Kas memakai jam yang
   * baru tanpa memuat ulang — dan workspace yang belum mengaturnya dibaca sebagai
   * bawaan (aktif, 21:00, 14 jam).
   */
  const shift = useMemo<ShiftSetting>(
    () => shiftSettingOf(workspace?.tenant?.shift ?? null),
    [workspace],
  );

  /**
   * Kas **toko** (bukan perangkat): shift yang masih berjalan beserta riwayat
   * penutupannya, dibaca dari tabel `shifts` lewat `pos.till`.
   *
   * Inilah yang membuat kas yang dibuka pemilik di ponselnya ikut membuka kasir
   * di perangkat kasir lain — dan kenapa kasir yang melayani penjualan tidak
   * perlu memegang izin `shift.manage`: ia hanya perlu tahu kasnya terbuka.
   * Query-nya hanya menuntut keanggotaan, jadi tidak perlu digerbang izin seperti
   * `shiftAlerts.list`.
   */
  const till = useMemo<StoreTill>(
    () => ({
      current: tillDocs?.current
        ? {
            id: tillDocs.current.id,
            openedAt: tillDocs.current.openedAt,
            openingCash: tillDocs.current.openingCash,
          }
        : null,
      history: (tillDocs?.history ?? []).map((row) => ({
        id: row.id,
        openedAt: row.openedAt,
        closedAt: row.closedAt,
        openingCash: row.openingCash,
        countedCash: row.countedCash,
        expectedCash: row.expectedCash,
        variance: row.variance,
      })),
    }),
    [tillDocs],
  );

  const openTill = useCallback(
    async (input: { openingCash: number }): Promise<void> => {
      if (!tenantId || !storeId) {
        notReady();
      }
      if (!userId) throw new Error("Pengguna belum siap. Coba lagi sebentar lagi.");
      try {
        await openTillMutation({
          tenantId,
          storeId,
          cashierId: userId,
          openingCash: input.openingCash,
        });
      } catch (error) {
        throw toTransportError(error);
      }
    },
    [tenantId, storeId, userId, openTillMutation],
  );

  const closeTill = useCallback(
    async (input: { countedCash: number }): Promise<void> => {
      if (!tenantId || !storeId) {
        notReady();
      }
      if (!userId) throw new Error("Pengguna belum siap. Coba lagi sebentar lagi.");
      const current = till.current;
      if (!current) throw new Error("Kas belum dibuka; tidak ada shift yang bisa ditutup.");
      try {
        await closeTillMutation({
          shiftId: current.id as Id<"shifts">,
          actorId: userId,
          closingCash: input.countedCash,
        });
      } catch (error) {
        throw toTransportError(error);
      }
    },
    [tenantId, storeId, userId, till, closeTillMutation],
  );

  const setShift = useCallback(
    async (input: UpdateShiftInput): Promise<UpdatedShift> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await setShiftMutation({
        tenantId,
        actorId: userId,
        setting: input,
      });
      return {
        changed: result.changed,
        setting: result.setting as ShiftSetting,
        sentence: result.sentence,
      };
    },
    [tenantId, userId, setShiftMutation],
  );

  /**
   * Kabar shift yang **sudah dikirim ke pemilik toko** (`shiftAlerts.list`): kas
   * belum dibuka di jam operasional, atau shift belum ditutup. Daftarnya dibaca
   * halaman Shift & Kas supaya “pemilik sudah diberi tahu” bisa diperiksa ulang —
   * termasuk status email ke pemiliknya, bukan cuma klaim di layar kasir.
   *
   * Langganannya bergerbang `shift.manage` (izin yang sama dengan rutenya): query
   * yang ditolak akan menjatuhkan render, jadi peran lain tidak berlangganan dulu.
   */
  const shiftAlertDocs = useQuery(
    api.shiftAlerts.list,
    tenantId && userId && canManageShift ? { tenantId, actorId: userId } : "skip",
  );

  const shiftAlerts = useMemo<StoreShiftAlert[]>(
    () =>
      (shiftAlertDocs ?? []).map((row) => ({
        id: row.id,
        kind: row.kind as StoreShiftAlert["kind"],
        reason: row.reason,
        dayKey: row.dayKey,
        title: row.title,
        message: row.message,
        localClock: row.localClock,
        openedAt: row.openedAt,
        notifiedEndpoints: row.notifiedEndpoints,
        emailRecipients: row.emailRecipients,
        emailVia: row.emailVia,
        emailDeliveredAt: row.emailDeliveredAt,
        emailError: row.emailError,
        reportedAt: row.reportedAt,
        resolvedAt: row.resolvedAt,
      })),
    [shiftAlertDocs],
  );

  /**
   * Melaporkan keadaan kas perangkat ini supaya pemilik toko diberi tahu kalau
   * memang perlu. Server memutuskan ulang (`shiftOwnerAlert`) dengan jam lokal yang
   * ikut dikirim, dan menjawab apa adanya: terkirim, tidak perlu, atau hari itu
   * sudah pernah — jadi halaman tidak pernah mengaku sudah mengabari pemilik
   * padahal belum.
   */
  const reportShiftAlert = useCallback(
    async (input: ShiftAlertReportInput): Promise<ShiftAlertReportResult> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await reportShiftAlertMutation({
        tenantId,
        actorId: userId,
        storeId: storeId as Id<"stores"> | undefined,
        kind: input.kind,
        clock: input.clock,
        openedAt: input.openedAt,
      });
      return result as ShiftAlertReportResult;
    },
    [tenantId, userId, storeId, reportShiftAlertMutation],
  );

  /** Menandai satu kabar shift sudah ditangani (`shiftAlerts.resolve`). */
  const resolveShiftAlert = useCallback(
    async (alertId: string): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await resolveShiftAlertMutation({
        alertId: alertId as Id<"shiftAlerts">,
        actorId: userId,
      });
    },
    [tenantId, userId, resolveShiftAlertMutation],
  );

  /**
   * Logo toko yang tercetak di struk. URL-nya dibuat server dari id berkasnya
   * (`tenants.listMine`), bukan disimpan sebagai URL: URL bertanda tangan punya
   * masa berlaku, jadi yang tersimpan di perangkat bisa saja sudah mati.
   */
  const logo = useMemo<StoreLogo | null>(() => {
    const url = workspace?.logoUrl ?? null;
    return url ? { id: "logo-toko", url } : null;
  }, [workspace]);

  /**
   * Profil pengguna aktif: nama & nomor WA-nya. Nomornya tersimpan di bentuk yang
   * dituntut `wa.me` (`62812…`), sama seperti yang ditulis `users.updateProfile`.
   */
  const myProfile = useMemo<StoreUserProfile>(
    () => ({
      name: myProfileDoc?.name ?? session?.user.name ?? "",
      whatsapp: myProfileDoc?.phone ?? session?.user.whatsapp ?? null,
    }),
    [myProfileDoc, session],
  );

  /**
   * Menyimpan profil pengguna lewat `users.updateProfile`. Server mengembalikan
   * nilai finalnya (nomor yang sudah dinormalkan, nama yang sudah dirapikan),
   * dan itu juga yang ditulis ke sesi — supaya struk berikutnya langsung
   * mencetak nama baru tanpa menunggu query berikutnya.
   */
  const setMyProfile = useCallback(
    async (input: UpdateUserProfileInput): Promise<UpdatedUserProfile> => {
      if (!userId) {
        notReady();
      }
      const result = await updateUserProfileMutation({
        userId,
        name: input.name,
        phone: input.whatsapp,
      });
      setUserProfile({ name: result.name, whatsapp: result.phone });
      return {
        name: result.name,
        whatsapp: result.phone,
        changed: result.changed,
        sentence: result.sentence,
      };
    },
    [userId, updateUserProfileMutation, setUserProfile],
  );

  /**
   * Identitas usaha dibaca dari baris tenant yang sama dengan yang dibaca server
   * (`tenants.listMine` sudah berlangganan), jadi setelah `tenants.updateProfile`
   * tersimpan, header dan struk ikut memakai nama usaha yang baru tanpa memuat
   * ulang. Kolom yang belum pernah diisi dibaca sebagai `null`.
   */
  const tenantProfile = useMemo<StoreTenantProfile>(
    () => {
      const row = workspace?.tenant;
      return {
        name: row?.name ?? tenant?.name ?? "",
        address: row?.address ?? tenant?.address ?? null,
        email: row?.email ?? tenant?.email ?? null,
        whatsapp: row?.phone ?? tenant?.whatsapp ?? null,
      };
    },
    [workspace, tenant],
  );

  /**
   * Menyimpan identitas usaha lewat `tenants.updateProfile` (izin
   * `billing.manage` — server yang memutuskan, halaman hanya menawarkan tombolnya
   * kepada yang berhak). Sesi ikut diselaraskan dengan nilai dari server supaya
   * nama bisnis di header tidak menunggu render berikutnya.
   */
  const setTenantProfile = useCallback(
    async (input: UpdateTenantProfileInput): Promise<UpdatedTenantProfile> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await updateTenantProfileMutation({
        tenantId,
        actorId: userId,
        name: input.name,
        address: input.address,
        email: input.email,
        phone: input.whatsapp,
      });
      setSessionTenantProfile({
        name: result.name,
        address: result.address,
        email: result.email,
        whatsapp: result.phone,
      });
      return {
        name: result.name,
        address: result.address,
        email: result.email,
        whatsapp: result.phone,
        changed: result.changed,
        sentence: result.sentence,
      };
    },
    [tenantId, userId, updateTenantProfileMutation, setSessionTenantProfile],
  );

  /**
   * Kategori utama bisnis dari baris tenant (`tenants.businessCategory`) —
   * sumber yang sama dengan yang dibaca server, jadi halaman Profil di perangkat
   * mana pun melihat pilihan yang sudah terkunci. `null` = belum pernah dipilih.
   */
  const businessCategory = useMemo(
    () => businessCategoryOf(workspace?.tenant ?? tenant),
    [workspace, tenant],
  );

  /**
   * Katalog kategori utama yang boleh dipilih; selama jawaban server belum
   * datang, daftar bawaan dipakai supaya pemilih tidak kosong sesaat. Nilainya
   * dibuat sekali per jawaban query supaya daftar di deps store stabil.
   */
  const businessCategories = useMemo(
    () =>
      businessCategoryOptions ??
      activeBusinessCategoryOptions(defaultBusinessCategoryRows()),
    [businessCategoryOptions],
  );

  /**
   * Mengunci kategori utama lewat `tenants.setBusinessCategory`. Server yang
   * memutuskan hasilnya (termasuk penolakan pilihan kedua); sesi hanya mengikuti
   * nilai yang benar-benar tersimpan supaya tampilan tidak mendahului backend.
   */
  const setBusinessCategory = useCallback(
    async (input: BusinessCategoryChoice): Promise<UpdatedBusinessCategory> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await setBusinessCategoryMutation({
        tenantId,
        actorId: userId,
        category: input.category,
        subcategory: input.subcategory,
      });
      const value = result.businessCategory;
      setSessionBusinessCategory(value);
      return {
        businessCategory: value,
        changed: result.changed,
        sentence: result.sentence ?? businessCategorySentence(value),
      };
    },
    [tenantId, userId, setBusinessCategoryMutation, setSessionBusinessCategory],
  );

  /**
   * Memasang logo toko lewat pola tiga langkah Convex: minta URL unggah, kirim
   * berkasnya langsung ke penyimpanan, lalu tautkan id berkasnya ke tenant. Batas
   * tipe & ukurannya ditegakkan di server, bukan hanya di halaman Pengaturan.
   */
  const setLogo = useCallback(
    async (file: Blob): Promise<void> => {
      if (!tenantId) {
        notReady();
      }
      if (!userId) throw new Error("Pengguna belum siap. Coba lagi sebentar lagi.");

      const uploadUrl = await generateLogoUploadUrlMutation({
        tenantId,
        actorId: userId,
      });
      const uploaded = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });
      if (!uploaded.ok) {
        throw new Error(`Gagal mengunggah logo ke penyimpanan (HTTP ${uploaded.status}).`);
      }
      const payload = (await uploaded.json()) as { storageId?: string };
      if (!payload.storageId) {
        throw new Error("Penyimpanan tidak mengembalikan id berkas logo.");
      }

      await setLogoMutation({
        tenantId,
        actorId: userId,
        storageId: payload.storageId as Id<"_storage">,
      });
    },
    [tenantId, userId, generateLogoUploadUrlMutation, setLogoMutation],
  );

  const removeLogo = useCallback(async (): Promise<void> => {
    if (!tenantId) {
      notReady();
    }
    if (!userId) throw new Error("Pengguna belum siap. Coba lagi sebentar lagi.");

    await removeLogoMutation({ tenantId, actorId: userId });
  }, [tenantId, userId, removeLogoMutation]);

  /**
   * Jendela 12 bulan terakhir untuk laporan pajak & pungutan F&B. Dipatok sekali
   * (seperti rentang harian di atas) supaya argumen kuerinya stabil: daftar
   * bulan yang berubah tiap render akan membuat langganan ini berkedip.
   */
  const fnbTaxMonthWindows = useMemo(() => recentMonthWindows(FNB_TAX_REPORT_MONTHS), []);

  /**
   * Laporan pajak & pungutan F&B per bulan, seluruh workspace
   * (`reports.fnbTaxMonths`). Langganannya ikut digerbang izin `report.view` —
   * peran kustom bisa tidak memilikinya, dan query yang ditolak akan
   * menjatuhkan render.
   */
  const rawFnbTaxMonths = useQuery(
    api.reports.fnbTaxMonths,
    tenantId && userId && canViewReports
      ? {
          tenantId,
          actorId: userId,
          months: fnbTaxMonthWindows.map((window) => ({
            year: window.year,
            monthIndex: window.monthIndex,
            from: window.from,
            to: window.to,
          })),
        }
      : "skip",
  );

  /**
   * Selama kuerinya masih dimuat, yang ditampilkan adalah kerangka bulan yang
   * sudah pasti (`emptyMonthlyTaxRows`) dengan angka nol — bukan daftar kosong:
   * tabel laporan harus tetap punya 12 barisnya, dan bulan tanpa penjualan memang
   * nol, bukan hilang.
   */
  const fnbTaxMonths = useMemo<StoreFnbTaxMonth[]>(
    () =>
      rawFnbTaxMonths && rawFnbTaxMonths.length > 0
        ? rawFnbTaxMonths
        : emptyMonthlyTaxRows(fnbTaxMonthWindows),
    [rawFnbTaxMonths, fnbTaxMonthWindows],
  );

  /** Ringkasan bulan berjalan — diturunkan dari baris yang sama dengan tabel. */
  const fnbTaxMonth = useMemo<StoreFnbTaxMonthSummary>(
    () => fnbCurrentMonthSummary(fnbTaxMonths),
    [fnbTaxMonths],
  );

  // Pindah paket. Prorata & jejak audit dihitung server; di sini yang penting dua
  // hal: paket di sesi harus ikut berubah (seluruh gerbang fitur membacanya), dan
  // modul dipangkas dengan aturan yang **sama** (`trimVerticalsForPlan`) supaya
  // sesi tidak menampilkan modul yang sudah dibuang server.
  const changePlan = useCallback(
    async (next: PlanKey) => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await changePlanMutation({
        tenantId,
        actorId: userId,
        newPlanKey: next,
      });
      setPlan(
        result.planKey,
        result.changed
          ? trimVerticalsForPlan(result.planKey, tenant?.verticals ?? [])
          : undefined,
      );
      return {
        changed: result.changed,
        planKey: result.planKey,
        gained: result.gained,
        lost: result.lost,
      };
    },
    [tenantId, userId, tenant, changePlanMutation, setPlan],
  );

  // Harga & konfigurasi grosir disimpan di server; daftar produk ikut segar
  // sendiri karena query Convex reaktif.
  const setPricing = useCallback(
    async (input: SetPricingInput) => {
      if (!tenantId || !userId) {
        notReady();
      }
      await setPricingMutation({
        tenantId,
        actorId: userId,
        productId: input.productId as Id<"products">,
        price: input.price,
        unit: input.unit,
        tiers: input.tiers,
        units: input.units,
      });
    },
    [tenantId, userId, setPricingMutation],
  );

  /**
   * Pindah kategori produk. SKU ikut menyesuaikan di server (`products.setCategory`),
   * dan balikannya dipakai halaman untuk memberi tahu perubahan SKU yang benar-benar
   * terjadi — halaman tidak menghitung sendiri.
   */
  const setCategory = useCallback(
    async (
      input: SetProductCategoryInput,
    ): Promise<{
      sku: string;
      previousSku: string;
      category: string | null;
      subcategory: string | null;
    }> => {
      if (!tenantId || !userId) {
        notReady();
      }

      const name = input.category?.trim();
      const categoryId = name
        ? (categories ?? []).find((c) => c.name === name)?._id
        : undefined;
      if (name && !categoryId) {
        throw new Error(`Kategori “${name}” tidak ada di workspace ini.`);
      }
      const subcategoryId = resolveSubcategoryId(categoryId, input.subcategory);

      const result = await setCategoryMutation({
        tenantId,
        actorId: userId,
        productId: input.productId as Id<"products">,
        categoryId,
        subcategoryId: subcategoryId as Id<"subcategories"> | undefined,
      });

      return {
        sku: result.sku,
        previousSku: result.previousSku,
        category: result.category,
        subcategory: result.subcategory,
      };
    },
    [tenantId, userId, categories, resolveSubcategoryId, setCategoryMutation],
  );

  /**
   * Produk yang sudah tersimpan: ubah identitas, aktif/nonaktifkan, hapus —
   * semuanya berizin `product.manage` (`products.update`/`setActive`/`remove`).
   *
   * Pagar hapusnya dipinta ke server (`products.deletionCheck`) sebelum menekan
   * Hapus: yang ditampilkan halaman adalah hitungan sungguhan (stok, penjualan,
   * pergerakan stok, dokumen pembelian, opname), bukan perkiraan klien.
   */
  const updateProduct = useCallback(
    async (input: UpdateProductInput): Promise<UpdatedProduct> => {
      if (!tenantId || !userId) notReady();
      const result = await updateProductMutation({
        tenantId,
        actorId: userId,
        productId: input.productId as Id<"products">,
        name: input.name,
        sku: input.sku,
        cost: input.cost,
      });
      return {
        name: result.name,
        sku: result.sku,
        cost: result.cost,
        changed: result.changed,
      };
    },
    [tenantId, userId, updateProductMutation],
  );

  const setProductActive = useCallback(
    async (productId: string, active: boolean): Promise<void> => {
      if (!tenantId || !userId) notReady();
      await setProductActiveMutation({
        tenantId,
        actorId: userId,
        productId: productId as Id<"products">,
        active,
      });
    },
    [tenantId, userId, setProductActiveMutation],
  );

  const checkProductDeletion = useCallback(
    async (productId: string): Promise<ProductDeletionInfo> => {
      if (!tenantId || !userId) notReady();
      const result = await convex.query(api.products.deletionCheck, {
        tenantId,
        actorId: userId,
        productId: productId as Id<"products">,
      });
      return {
        name: result.name,
        sku: result.sku,
        usage: result.usage,
        canDelete: result.canDelete,
        blockers: result.blockers,
        sentence: result.sentence,
      };
    },
    [tenantId, userId, convex],
  );

  const removeProduct = useCallback(
    async (productId: string): Promise<{ name: string; sku: string }> => {
      if (!tenantId || !userId) notReady();
      const result = await removeProductMutation({
        tenantId,
        actorId: userId,
        productId: productId as Id<"products">,
      });
      return { name: result.name, sku: result.sku };
    },
    [tenantId, userId, removeProductMutation],
  );

  /**
   * ---------------------------------------------------------------- kategori
   * Kategori produk (`category.manage`): tambah, ganti nama, aktif/nonaktif, hapus.
   *
   * Empat mutation terpisah — bukan satu `update` serba bisa — karena masing-masing
   * punya akibat yang berbeda dan harus dijelaskan apa adanya ke pengguna: ganti
   * nama mengubah kode SKU produk **berikutnya**, nonaktif menutup kategori untuk
   * produk baru, dan hapus melepas produk yang masih memakainya. `actorId` selalu
   * yang sedang masuk; izinnya diperiksa lagi di server.
   */
  const createCategory = useCallback(
    async (input: CreateCategoryInput): Promise<{ id: string; name: string }> => {
      if (!tenantId || !userId) notReady();
      const created = await createCategoryMutation({
        tenantId,
        actorId: userId,
        name: input.name,
      });
      return { id: created.categoryId as string, name: created.name };
    },
    [tenantId, userId, createCategoryMutation],
  );

  /**
   * Menyamakan katalog produk dengan kategori bisnis workspace ini (tombol di
   * halaman Produk & Stok). Server yang memutuskan apa yang masih kurang — hanya
   * menambah, tidak mengganti/menghapus — dan balikannya menjelaskan hasilnya.
   */
  const syncProductCategories = useCallback(async (): Promise<SyncedProductCategories> => {
    if (!tenantId || !userId) notReady();
    const result = await syncProductCategoriesMutation({
      tenantId,
      actorId: userId,
    });
    return {
      changed: result.changed,
      businessCategoryLabel: result.businessCategoryLabel,
      createdCategories: result.createdCategories,
      createdSubcategories: result.createdSubcategories,
      skippedCategories: result.skippedCategories,
      sentence: result.sentence,
    };
  }, [tenantId, userId, syncProductCategoriesMutation]);

  const renameCategory = useCallback(
    async (input: RenameCategoryInput): Promise<RenamedCategory> => {
      if (!tenantId || !userId) notReady();
      const result = await renameCategoryMutation({
        tenantId,
        actorId: userId,
        categoryId: input.categoryId as Id<"categories">,
        name: input.name,
      });
      return {
        name: result.name,
        previousName: result.previousName,
        skuCodeChanged: result.skuCodeChanged,
      };
    },
    [tenantId, userId, renameCategoryMutation],
  );

  const setCategoryActive = useCallback(
    async (categoryId: string, active: boolean): Promise<void> => {
      if (!tenantId || !userId) notReady();
      await setCategoryActiveMutation({
        tenantId,
        actorId: userId,
        categoryId: categoryId as Id<"categories">,
        active,
      });
    },
    [tenantId, userId, setCategoryActiveMutation],
  );

  const removeCategory = useCallback(
    async (categoryId: string): Promise<RemovedCategory> => {
      if (!tenantId || !userId) notReady();
      const result = await removeCategoryMutation({
        tenantId,
        actorId: userId,
        categoryId: categoryId as Id<"categories">,
      });
      return {
        name: result.name,
        detachedProducts: result.detachedProducts,
        removedSubcategories: result.removedSubcategories,
      };
    },
    [tenantId, userId, removeCategoryMutation],
  );

  /**
   * ------------------------------------------------------------- subkategori
   * Subkategori katalog (`category.manage`): selalu **di bawah** sebuah kategori.
   *
   * Empat mutation terpisah dengan akibat yang berbeda dan dijelaskan apa adanya:
   * ganti nama tidak menyentuh SKU sama sekali (produk menunjuk id), nonaktif
   * menutupnya untuk produk baru, dan hapus melepas produk yang memakainya tanpa
   * menghapus produk atau kategorinya.
   */
  const createSubcategory = useCallback(
    async (input: CreateSubcategoryInput): Promise<{ id: string; name: string }> => {
      if (!tenantId || !userId) notReady();
      const created = await createSubcategoryMutation({
        tenantId,
        actorId: userId,
        categoryId: input.categoryId as Id<"categories">,
        name: input.name,
      });
      return { id: created.subcategoryId as string, name: created.name };
    },
    [tenantId, userId, createSubcategoryMutation],
  );

  const renameSubcategory = useCallback(
    async (input: RenameSubcategoryInput): Promise<RenamedSubcategory> => {
      if (!tenantId || !userId) notReady();
      const result = await renameSubcategoryMutation({
        tenantId,
        actorId: userId,
        subcategoryId: input.subcategoryId as Id<"subcategories">,
        name: input.name,
      });
      return { name: result.name, previousName: result.previousName };
    },
    [tenantId, userId, renameSubcategoryMutation],
  );

  const setSubcategoryActive = useCallback(
    async (subcategoryId: string, active: boolean): Promise<void> => {
      if (!tenantId || !userId) notReady();
      await setSubcategoryActiveMutation({
        tenantId,
        actorId: userId,
        subcategoryId: subcategoryId as Id<"subcategories">,
        active,
      });
    },
    [tenantId, userId, setSubcategoryActiveMutation],
  );

  const removeSubcategory = useCallback(
    async (subcategoryId: string): Promise<RemovedSubcategory> => {
      if (!tenantId || !userId) notReady();
      const result = await removeSubcategoryMutation({
        tenantId,
        actorId: userId,
        subcategoryId: subcategoryId as Id<"subcategories">,
      });
      return { name: result.name, detachedProducts: result.detachedProducts };
    },
    [tenantId, userId, removeSubcategoryMutation],
  );

  // -------------------------------- F&B: denah meja + antrean dapur ---------
  const tables: StoreTable[] = useMemo(() => tableDocs ?? [], [tableDocs]);
  const kdsTickets: StoreKdsTicket[] = useMemo(
    () => kdsTicketDocs ?? [],
    [kdsTicketDocs],
  );

  const createTable = useCallback(
    async (input: CreateTableInput): Promise<void> => {
      if (!tenantId || !storeId || !userId) {
        notReady();
      }
      await createTableMutation({
        tenantId,
        storeId,
        actorId: userId,
        name: input.name,
        seats: input.seats,
        zone: input.zone,
      });
    },
    [tenantId, storeId, userId, createTableMutation],
  );

  /** Mengubah identitas meja; nama, kursi, dan zonanya divalidasi ulang server. */
  const updateTable = useCallback(
    async (input: UpdateTableInput): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await updateTableMutation({
        tenantId,
        tableId: input.tableId as Id<"tables">,
        actorId: userId,
        name: input.name,
        seats: input.seats,
        zone: input.zone,
      });
    },
    [tenantId, userId, updateTableMutation],
  );

  const setTableActive = useCallback(
    async (tableId: string, active: boolean): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await setTableActiveMutation({
        tenantId,
        tableId: tableId as Id<"tables">,
        actorId: userId,
        active,
      });
    },
    [tenantId, userId, setTableActiveMutation],
  );

  /**
   * Pagar hapus sebuah meja dipinta ke server (`tables.deletionCheck`) sebelum
   * menekan Hapus: yang ditampilkan dialog adalah pemakaian sungguhan (pesanan
   * terbuka di mejanya, tagihan tamu yang masih menunggu, riwayat penjualan) —
   * pola yang sama dengan `checkProductDeletion`.
   */
  const checkTableDeletion = useCallback(
    async (tableId: string): Promise<StoreTableDeletionCheck> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await convex.query(api.tables.deletionCheck, {
        tenantId,
        actorId: userId,
        tableId: tableId as Id<"tables">,
      });
      return {
        name: result.name,
        active: result.active,
        usage: result.usage,
        canDelete: result.canDelete,
        blockers: result.blockers,
        sentence: result.sentence,
      };
    },
    [tenantId, userId, convex],
  );

  const deleteTable = useCallback(
    async (tableId: string): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await removeTableMutation({
        tenantId,
        tableId: tableId as Id<"tables">,
        actorId: userId,
      });
    },
    [tenantId, userId, removeTableMutation],
  );

  /**
   * Menggeser satu meja satu langkah. Urutan barunya dihitung **server** dari
   * data yang tersimpan (`tables.move` → `planTableMove`), bukan dari daftar yang
   * dikirim klien: denah dipakai bersama satu toko, dan dua perangkat yang menata
   * bersamaan tidak boleh saling menimpa dengan urutan yang salah.
   */
  const moveTable = useCallback(
    async (tableId: string, step: -1 | 1): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await moveTableMutation({
        tenantId,
        tableId: tableId as Id<"tables">,
        actorId: userId,
        step,
      });
    },
    [tenantId, userId, moveTableMutation],
  );

  /**
   * Impor beberapa meja sekaligus. Teksnya diurai **server** dengan aturan yang
   * sama dengan halaman (`planTableImport`): semua atau tidak sama sekali, dan
   * kalimat penolakannya menyebut nomor barisnya.
   */
  const importTables = useCallback(
    async (text: string): Promise<{ created: number; names: string[] }> => {
      if (!tenantId || !storeId || !userId) {
        notReady();
      }
      const result = await importTablesMutation({
        tenantId,
        storeId,
        actorId: userId,
        text,
      });
      return { created: result.created, names: result.names };
    },
    [tenantId, storeId, userId, importTablesMutation],
  );

  /**
   * Kirim pesanan ke dapur. Sengaja **tidak** lewat outbox offline: dapur hanya
   * boleh melihat pesanan yang benar-benar sudah diterima server, jadi tanpa
   * koneksi kasir diberi tahu untuk menunggu, bukan diberi nomor palsu.
   */
  const holdSale = useCallback(
    async (input: HoldSaleInput): Promise<{ number: string | null; total: number }> => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error("Kirim ke dapur butuh koneksi internet. Coba lagi setelah tersambung.");
      }
      if (!tenantId || !storeId || !userId) {
        notReady();
      }

      const subtotal = priceCart(input.items);
      const appliedDiscount = Math.min(Math.max(input.discount, 0), subtotal);
      const tendered = computeTax(subtotal - appliedDiscount).gross;
      // Kunci sekali pakai: pesanan tertahan dibuat persis sekali, bukan diulang
      // seperti penjualan yang boleh dikirim ulang setelah putus koneksi.
      const idempotencyKey = `hold-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const result = await holdSaleMutation({
        tenantId,
        storeId,
        cashierId: userId,
        items: input.items.map((item) => ({
          productId: item.productId as Id<"products">,
          quantity: item.quantity,
          unitCode: item.unitCode,
          modifiers: item.modifiers,
        })),
        discount: appliedDiscount,
        payments: [{ method: METHOD_BY_LABEL[input.method], amount: tendered }],
        status: "held",
        tableId: input.tableId as Id<"tables"> | undefined,
        memberId: input.memberId as Id<"members"> | undefined,
        idempotencyKey,
      });

      return { number: result.number, total: result.total };
    },
    [tenantId, storeId, userId, priceCart, holdSaleMutation],
  );

  const completeHeld = useCallback(
    async (saleId: string): Promise<void> => {
      if (!userId) throw new Error("Pengguna belum siap. Coba lagi sebentar lagi.");
      await finalizeHeldMutation({ saleId: saleId as Id<"sales">, actorId: userId });
    },
    [userId, finalizeHeldMutation],
  );

  /**
   * Tombol Selesai di layar dapur. Satu panggilan untuk kedua jenis tiket —
   * server yang memutuskan apakah penjualannya perlu diselesaikan (pesanan
   * tertahan) atau hanya ditandai beres (tiket yang sudah lunas).
   */
  const finishKitchenTicket = useCallback(
    async (saleId: string): Promise<void> => {
      if (!userId) throw new Error("Pengguna belum siap. Coba lagi sebentar lagi.");
      await kitchenDoneMutation({ saleId: saleId as Id<"sales">, actorId: userId });
    },
    [userId, kitchenDoneMutation],
  );

  // Modifier item: konfigurasi disimpan di server, produknya ikut segar sendiri
  // karena query Convex reaktif.
  const setModifiers = useCallback(
    async (input: SetModifiersInput): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await setModifiersMutation({
        tenantId,
        actorId: userId,
        productId: input.productId as Id<"products">,
        modifiers: input.modifiers,
      });
    },
    [tenantId, userId, setModifiersMutation],
  );

  // ------------------- grosir: pelanggan B2B, limit kredit & piutang --------
  const customers: StoreCustomer[] = useMemo(() => arDocs?.customers ?? [], [arDocs]);
  const receivables: StoreReceivable[] = useMemo(
    () => arDocs?.receivables ?? [],
    [arDocs],
  );
  const arSummary: StoreArSummary = useMemo(
    () => arDocs?.summary ?? EMPTY_AR_SUMMARY,
    [arDocs],
  );

  const createCustomer = useCallback(
    async (input: CreateCustomerInput): Promise<{ id: string; code: string }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await createCustomerMutation({
        tenantId,
        actorId: userId,
        name: input.name,
        code: input.code,
        phone: input.phone,
        creditLimit: input.creditLimit,
        paymentTermDays: input.paymentTermDays,
      });
      return { id: result.customerId, code: result.code };
    },
    [tenantId, userId, createCustomerMutation],
  );

  const setCredit = useCallback(
    async (input: SetCreditInput): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await setCreditMutation({
        tenantId,
        actorId: userId,
        customerId: input.customerId as Id<"customers">,
        creditLimit: input.creditLimit,
        paymentTermDays: input.paymentTermDays,
        active: input.active,
      });
    },
    [tenantId, userId, setCreditMutation],
  );

  const recordPayment = useCallback(
    async (input: RecordPaymentInput): Promise<{ remaining: number }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await recordPaymentMutation({
        tenantId,
        actorId: userId,
        receivableId: input.receivableId as Id<"receivables">,
        amount: input.amount,
        method: METHOD_BY_LABEL[input.method],
        note: input.note,
      });
      return { remaining: result.remaining };
    },
    [tenantId, userId, recordPaymentMutation],
  );

  // ------------------------------- UMKM: member & diskon member -------------
  const members: StoreMember[] = useMemo(() => memberDocs ?? [], [memberDocs]);

  const createMember = useCallback(
    async (input: CreateMemberInput): Promise<{ id: string; code: string }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await createMemberMutation({
        tenantId,
        actorId: userId,
        name: input.name,
        code: input.code,
        phone: input.phone,
        discountPct: input.discountPct,
      });
      return { id: result.memberId, code: result.code };
    },
    [tenantId, userId, createMemberMutation],
  );

  const updateMember = useCallback(
    async (input: UpdateMemberInput): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await updateMemberMutation({
        tenantId,
        actorId: userId,
        memberId: input.memberId as Id<"members">,
        name: input.name,
        phone: input.phone,
        discountPct: input.discountPct,
        active: input.active,
      });
    },
    [tenantId, userId, updateMemberMutation],
  );

  /**
   * Kirim **gambar struk** ke WhatsApp pembeli (`receiptWa.send`).
   *
   * Aksi server itu yang memutuskan boleh-tidaknya kiriman ini: izin `pos.sell`,
   * nomor penerima (dari data member, atau dari nomor yang diketik kasir untuk
   * pembeli umum), dan keadaan kanal WhatsApp. Karena balasannya berbentuk nilai
   * (bukan lemparan) untuk tiga penolakan yang paling sering, kegagalan jaringan
   * yang sesungguhnya tetap diteruskan sebagai galat supaya kasir tidak mengira
   * struknya terkirim. Mengirim berkas memang butuh jaringan, jadi jalur ini tidak
   * lewat outbox offline seperti penjualan: struk yang sudah lunas tidak berubah
   * lagi, dan kasir bisa mengulangnya kapan pun.
   */
  const sendReceiptWhatsapp = useCallback(
    async (
      input: SendReceiptWhatsappInput,
    ): Promise<ReceiptWhatsappSendResult> => {
      if (!tenantId || !userId) {
        notReady();
      }
      return await sendReceiptWhatsappAction({
        tenantId,
        actorId: userId,
        // Kosong = struk pembeli umum; server menyimpulkan sisanya dari `phone`.
        memberId: input.memberId ? (input.memberId as Id<"members">) : undefined,
        saleNumber: input.saleNumber,
        filename: input.filename,
        caption: input.caption,
        imageBase64: input.imageBase64,
        phone: input.phone,
      });
    },
    [tenantId, userId, sendReceiptWhatsappAction],
  );

  // ------------------- Phase 3: gudang & perpindahan stok -----------------
  const warehouses: StoreWarehouse[] = useMemo(
    // Lokasi jual selalu ada, bahkan sebelum query pertama tiba.
    () => inventoryDocs?.locations ?? [defaultWarehouse()],
    [inventoryDocs],
  );
  const stock: StoreStockRow[] = useMemo(() => inventoryDocs?.stock ?? [], [inventoryDocs]);
  const warehouseCapacityValue: StoreWarehouseCapacity = useMemo(
    () => inventoryDocs?.capacity ?? EMPTY_WAREHOUSE_CAPACITY,
    [inventoryDocs],
  );
  const transfers: StoreTransfer[] = useMemo(
    () => inventoryDocs?.history ?? [],
    [inventoryDocs],
  );

  const createWarehouse = useCallback(
    async (input: CreateWarehouseInput): Promise<{ id: string; code: string }> => {
      if (!tenantId || !storeId || !userId) {
        notReady();
      }
      const result = await createWarehouseMutation({
        tenantId,
        storeId,
        actorId: userId,
        name: input.name,
        code: input.code,
        address: input.address,
      });
      return { id: result.warehouseId, code: result.code };
    },
    [tenantId, storeId, userId, createWarehouseMutation],
  );

  const setWarehouseActive = useCallback(
    async (warehouseId: string, active: boolean): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await updateWarehouseMutation({
        tenantId,
        actorId: userId,
        warehouseId: warehouseId as Id<"warehouses">,
        active,
      });
    },
    [tenantId, userId, updateWarehouseMutation],
  );

  const transferStock = useCallback(
    async (input: TransferStockInput): Promise<{ number: string; quantity: number }> => {
      if (!tenantId || !storeId || !userId) {
        notReady();
      }
      const result = await transferStockMutation({
        tenantId,
        storeId,
        actorId: userId,
        productId: input.productId as Id<"products">,
        // Lokasi jual dikirim sebagai `undefined` — server mengenalinya sebagai
        // bucket stok lama (tempat kasir menjual).
        from:
          input.from === DEFAULT_WAREHOUSE_ID
            ? undefined
            : (input.from as Id<"warehouses">),
        to:
          input.to === DEFAULT_WAREHOUSE_ID
            ? undefined
            : (input.to as Id<"warehouses">),
        quantity: input.quantity,
        note: input.note,
      });
      return { number: result.number, quantity: result.quantity };
    },
    [tenantId, storeId, userId, transferStockMutation],
  );

  // ---------------- Phase 3: stock opname (inventory.opname) ----------------
  const opnameSessions: StoreOpnameSession[] = useMemo(
    () =>
      (opnameDocs?.sessions ?? []).map((session) => ({
        id: session.id,
        number: session.number,
        locationId: session.warehouseId,
        locationName: session.locationName,
        status: session.status,
        note: session.note,
        createdAt: session.createdAt,
        postedAt: session.postedAt,
        cancelledAt: session.cancelledAt,
        progress: session.progress,
        variance: session.variance,
        lines: session.lines.map((line) => ({
          productId: line.productId,
          name: line.name,
          sku: line.sku ?? "",
          unit: line.unit ?? "",
          systemQty: line.systemQty,
          countedQty: line.countedQty,
          currentQty: line.currentQty,
          variance: line.variance,
          note: line.note,
        })),
      })),
    [opnameDocs],
  );
  const opnameLocations: StoreOpnameLocation[] = useMemo(
    () => opnameDocs?.locations ?? [],
    [opnameDocs],
  );
  const opnameSummary: StoreOpnameSummary = useMemo(
    () => opnameDocs?.summary ?? EMPTY_OPNAME_SUMMARY,
    [opnameDocs],
  );
  const opnameOpenByLocation = useMemo(
    () => opnameDocs?.openByLocation ?? [],
    [opnameDocs],
  );

  const startOpname = useCallback(
    async (input: StartOpnameInput): Promise<{ id: string; number: string }> => {
      if (!tenantId || !storeId || !userId) {
        notReady();
      }
      const result = await startOpnameMutation({
        tenantId,
        storeId,
        actorId: userId,
        // Lokasi jual dikirim sebagai `undefined` — server mengenalinya sebagai
        // bucket stok lama (tempat kasir menjual).
        warehouseId:
          !input.warehouseId || input.warehouseId === DEFAULT_WAREHOUSE_ID
            ? undefined
            : (input.warehouseId as Id<"warehouses">),
        productIds: input.productIds?.map((id) => id as Id<"products">),
        note: input.note,
      });
      return { id: result.sessionId, number: result.number };
    },
    [tenantId, storeId, userId, startOpnameMutation],
  );

  const setOpnameCount = useCallback(
    async (input: SetOpnameCountInput): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await setOpnameCountMutation({
        tenantId,
        actorId: userId,
        sessionId: input.sessionId as Id<"opnameSessions">,
        productId: input.productId as Id<"products">,
        countedQty: input.countedQty,
        note: input.note,
      });
    },
    [tenantId, userId, setOpnameCountMutation],
  );

  const postOpname = useCallback(
    async (
      sessionId: string,
    ): Promise<{ number: string; movements: number; netUnits: number }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await postOpnameMutation({
        tenantId,
        actorId: userId,
        sessionId: sessionId as Id<"opnameSessions">,
      });
      return {
        number: result.number,
        movements: result.movements.length,
        netUnits: result.netUnits,
      };
    },
    [tenantId, userId, postOpnameMutation],
  );

  const cancelOpname = useCallback(
    async (sessionId: string, reason?: string): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await cancelOpnameMutation({
        tenantId,
        actorId: userId,
        sessionId: sessionId as Id<"opnameSessions">,
        reason,
      });
    },
    [tenantId, userId, cancelOpnameMutation],
  );

  // ------------------- Phase 3: pembelian (PR · PO · GRN) ------------------
  const suppliers: StoreSupplier[] = useMemo(
    () => purchasingDocs?.suppliers ?? [],
    [purchasingDocs],
  );
  const requisitions: StoreRequisition[] = useMemo(
    () => purchasingDocs?.requisitions ?? [],
    [purchasingDocs],
  );
  const orders: StoreOrder[] = useMemo(() => purchasingDocs?.orders ?? [], [purchasingDocs]);
  const receipts: StoreReceipt[] = useMemo(() => purchasingDocs?.receipts ?? [], [purchasingDocs]);
  const purchasingSummary: StorePurchasingSummary = useMemo(
    () => purchasingDocs?.summary ?? EMPTY_PURCHASING_SUMMARY,
    [purchasingDocs],
  );

  // ------------------------- Phase 3: hutang usaha ------------------------
  const payables: StorePayable[] = useMemo(() => payableDocs?.payables ?? [], [payableDocs]);
  const payablePayments: StorePayablePayment[] = useMemo(
    () =>
      (payableDocs?.payments ?? []).map((payment) => ({
        id: payment.id,
        payableId: payment.payableId,
        payableNumber: payment.payableNumber,
        supplierName: payment.supplierName,
        amount: payment.amount,
        method: PAYMENT_LABEL_BY_METHOD[payment.method] ?? "Tunai",
        note: payment.note,
        batchNumber: payment.batchNumber,
        createdAt: payment.createdAt,
      })),
    [payableDocs],
  );
  const payableSummary: StorePayableSummary = useMemo(
    () => payableDocs?.summary ?? EMPTY_PAYABLE_SUMMARY,
    [payableDocs],
  );
  /** Ringkasan pencocokan 3 arah — dihitung server dari aturan murni yang sama. */
  const threewaySummary: StoreThreewaySummary = useMemo(
    () => payableDocs?.matchSummary ?? EMPTY_THREEWAY_SUMMARY,
    [payableDocs],
  );
  /**
   * Laporan analitik siap pakai. Kalau fiturnya tidak hidup (atau perannya tidak
   * boleh melihat laporan), laporannya **kosong tetapi berbentuk sah** — halaman
   * tidak pernah menampilkan angka dari kueri yang tidak dijalankan.
   */
  const analyticsReport: StoreAdvancedReport = useMemo(() => {
    if (analyticsDocs) return analyticsDocs;
    const now = Date.now();
    return buildAdvancedReport({
      sales: [],
      range: analyticsRange({
        days: analyticsDays,
        now,
        timezoneOffsetMinutes,
      }),
      timezoneOffsetMinutes,
      now,
    });
  }, [analyticsDocs, analyticsDays, timezoneOffsetMinutes]);

  const setAnalyticsPeriod = useCallback((days: number) => {
    setAnalyticsDays(resolveAnalyticsDays(days));
  }, []);

  const paymentBatches: StorePaymentBatch[] = useMemo(
    () =>
      (payableDocs?.batches ?? []).map((batch) => ({
        number: batch.number,
        at: batch.at,
        total: batch.total,
        count: batch.count,
        method: PAYMENT_LABEL_BY_METHOD[batch.method] ?? "Tunai",
        bills: batch.bills.map((bill) => ({
          payableId: bill.payableId,
          payableNumber: bill.payableNumber,
          supplierName: bill.supplierName,
          amount: bill.amount,
        })),
      })),
    [payableDocs],
  );

  const recordInvoice = useCallback(
    async (
      input: RecordInvoiceInput,
    ): Promise<{ reference: string | null; total: number; flagged: boolean; reasons: string[] }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await recordInvoiceMutation({
        tenantId,
        actorId: userId,
        payableId: input.payableId as Id<"payables">,
        reference: input.reference,
        dueDate: input.dueDate,
        note: input.note,
        lines: input.lines.map((line) => ({
          productId: line.productId as Id<"products">,
          quantity: line.quantity,
          unitCost: line.unitCost,
        })),
      });
      return {
        reference: result.reference,
        total: result.total,
        flagged: result.flagged,
        reasons: result.reasons,
      };
    },
    [tenantId, userId, recordInvoiceMutation],
  );

  const resolvePayableMatch = useCallback(
    async (
      input: ResolveMatchInput,
    ): Promise<{ kind: MatchDecisionKind | null; amount: number }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await resolveMatchMutation({
        tenantId,
        actorId: userId,
        payableId: input.payableId as Id<"payables">,
        kind: input.kind,
        note: input.note,
      });
      return { kind: result.kind, amount: result.amount };
    },
    [tenantId, userId, resolveMatchMutation],
  );

  const payPayables = useCallback(
    async (
      input: PayBatchInput,
    ): Promise<{ batchNumber: string; total: number; bills: number }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await payBatchMutation({
        tenantId,
        actorId: userId,
        method: METHOD_BY_LABEL[input.method],
        note: input.note,
        payments: input.payments.map((payment) => ({
          payableId: payment.payableId as Id<"payables">,
          amount: payment.amount,
        })),
      });
      return {
        batchNumber: result.batchNumber,
        total: result.total,
        bills: result.bills.length,
      };
    },
    [tenantId, userId, payBatchMutation],
  );

  const createSupplier = useCallback(
    async (input: CreateSupplierInput): Promise<{ id: string; code: string }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await createSupplierMutation({
        tenantId,
        actorId: userId,
        name: input.name,
        code: input.code,
        phone: input.phone,
        address: input.address,
        paymentTermDays: input.paymentTermDays,
      });
      return { id: result.supplierId, code: result.code };
    },
    [tenantId, userId, createSupplierMutation],
  );

  const updateSupplier = useCallback(
    async (input: UpdateSupplierInput): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await updateSupplierMutation({
        tenantId,
        actorId: userId,
        supplierId: input.supplierId as Id<"suppliers">,
        name: input.name,
        phone: input.phone,
        address: input.address,
        paymentTermDays: input.paymentTermDays,
        active: input.active,
      });
    },
    [tenantId, userId, updateSupplierMutation],
  );

  const createBill = useCallback(
    async (input: CreateBillInput): Promise<{ id: string; number: string }> => {
      if (!tenantId || !storeId || !userId) {
        notReady();
      }
      const result = await createBillMutation({
        tenantId,
        storeId,
        actorId: userId,
        supplierId: input.supplierId as Id<"suppliers">,
        reference: input.reference,
        amount: input.amount,
        dueDate: input.dueDate,
        note: input.note,
      });
      return { id: result.payableId, number: result.number };
    },
    [tenantId, storeId, userId, createBillMutation],
  );

  const recordPayablePayment = useCallback(
    async (input: RecordPayablePaymentInput): Promise<{ remaining: number }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await recordPayablePaymentMutation({
        tenantId,
        actorId: userId,
        payableId: input.payableId as Id<"payables">,
        amount: input.amount,
        method: METHOD_BY_LABEL[input.method],
        note: input.note,
      });
      return { remaining: result.remaining };
    },
    [tenantId, userId, recordPayablePaymentMutation],
  );

  const createRequisition = useCallback(
    async (input: CreateRequisitionInput): Promise<{ id: string; number: string }> => {
      if (!tenantId || !storeId || !userId) {
        notReady();
      }
      const result = await createRequisitionMutation({
        tenantId,
        storeId,
        actorId: userId,
        note: input.note,
        lines: input.lines.map((line) => ({
          productId: line.productId as Id<"products">,
          quantity: line.quantity,
          note: line.note,
        })),
      });
      return { id: result.requisitionId, number: result.number };
    },
    [tenantId, storeId, userId, createRequisitionMutation],
  );

  const decideRequisition = useCallback(
    async (input: DecideRequisitionInput): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await decideRequisitionMutation({
        tenantId,
        actorId: userId,
        requisitionId: input.requisitionId as Id<"purchaseRequisitions">,
        approve: input.approve,
        note: input.note,
      });
    },
    [tenantId, userId, decideRequisitionMutation],
  );

  const createOrder = useCallback(
    async (input: CreateOrderInput): Promise<{ id: string; number: string }> => {
      if (!tenantId || !storeId || !userId) {
        notReady();
      }
      const result = await createOrderMutation({
        tenantId,
        storeId,
        actorId: userId,
        supplierId: input.supplierId as Id<"suppliers">,
        requisitionId: input.requisitionId as Id<"purchaseRequisitions">,
        expectedAt: input.expectedAt,
        note: input.note,
        lines: input.lines.map((line) => ({
          productId: line.productId as Id<"products">,
          quantity: line.quantity,
          unitCost: line.unitCost,
        })),
      });
      return { id: result.orderId, number: result.number };
    },
    [tenantId, storeId, userId, createOrderMutation],
  );

  const cancelOrder = useCallback(
    async (orderId: string, reason?: string): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await cancelOrderMutation({
        tenantId,
        actorId: userId,
        orderId: orderId as Id<"purchaseOrders">,
        reason,
      });
    },
    [tenantId, userId, cancelOrderMutation],
  );

  const receiveGoods = useCallback(
    async (input: ReceiveGoodsInput): Promise<{ number: string; total: number }> => {
      if (!tenantId || !storeId || !userId) {
        notReady();
      }
      const result = await receiveGoodsMutation({
        tenantId,
        storeId,
        actorId: userId,
        orderId: input.orderId as Id<"purchaseOrders">,
        // Lokasi jual dikirim sebagai `undefined` — server mengenalinya sebagai
        // bucket stok lama (tempat kasir menjual).
        warehouseId:
          !input.warehouseId || input.warehouseId === DEFAULT_WAREHOUSE_ID
            ? undefined
            : (input.warehouseId as Id<"warehouses">),
        note: input.note,
        lines: input.lines.map((line) => ({
          productId: line.productId as Id<"products">,
          quantity: line.quantity,
        })),
      });
      return { number: result.number, total: result.total };
    },
    [tenantId, storeId, userId, receiveGoodsMutation],
  );

  const ready =
    myWorkspaces !== undefined &&
    (!tenantId ||
      (productDocs !== undefined &&
        saleDocs !== undefined &&
        rawSummary !== undefined &&
        // Piutang & member ikut ditunggu hanya kalau perannya boleh membacanya:
        // untuk peran lain query-nya memang di-skip selamanya.
        (!canViewAr || arDocs !== undefined) &&
        (!canViewMembers || memberDocs !== undefined) &&
        (!canManageTeam || (roleDocs !== undefined && teamDocs !== undefined)) &&
        (!canViewInventory || inventoryDocs !== undefined) &&
        (!canViewInventory || opnameDocs !== undefined) &&
        (!canViewPurchasing || purchasingDocs !== undefined) &&
        (!canViewPayables || payableDocs !== undefined) &&
        (!canManageApi || apiAccessDocs !== undefined)));

  // -------------------- Phase 4: peran kustom (`rbac.custom`) -------------
  const customRoles: StoreCustomRole[] = useMemo(
    () =>
      (roleDocs?.roles ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        permissions: sanitizePermissions(row.permissions),
        active: row.active,
        memberCount: row.memberCount,
      })),
    [roleDocs],
  );

  /** Peran bawaan beserta penyesuaiannya (`roles.list` memuat kelimanya). */
  const builtinRoles: StoreBuiltinRole[] = useMemo(
    () =>
      (roleDocs?.builtin ?? []).map((row) => ({
        role: row.role as Role,
        label: row.label,
        permissions: sanitizePermissions(row.permissions),
        basePermissions: sanitizePermissions(row.basePermissions),
        active: row.active,
        removed: row.removed,
        customized: row.customized,
        memberCount: row.memberCount,
      })),
    [roleDocs],
  );

  const roleSummary: StoreRoleSummary = useMemo(
    () =>
      roleDocs?.summary
        ? {
            ...roleDocs.summary,
            builtin: roleDocs.summary.builtin ?? EMPTY_BUILTIN_ROLE_SUMMARY,
          }
        : {
            total: 0,
            active: 0,
            assignedMembers: 0,
            limit: MAX_CUSTOM_ROLES,
            canCreate: true,
            builtin: EMPTY_BUILTIN_ROLE_SUMMARY,
          },
    [roleDocs],
  );

  const teamMembers: StoreTeamMember[] = useMemo(() => {
    const byId = new Map(customRoles.map((row) => [row.id, row]));
    const builtinById = new Map(builtinRoles.map((row) => [row.role, row]));
    return (teamDocs ?? []).map(({ membership, user }) => {
      const role = membership.customRoleId
        ? (byId.get(membership.customRoleId as string) ?? null)
        : null;
      // Peran kustom nonaktif tidak berlaku lagi: anggota kembali ke peran
      // bawaannya, sama seperti resolusi di backend.
      const effective = role && role.active ? role : null;
      // Izin peran bawaan anggota ini memakai penyesuaian workspace
      // (`rolePermissions` dari server), lalu digantikan peran kustom bila ada.
      // Anggota berperan tambahan tidak punya peran bawaan sama sekali.
      const baseRole = membership.role ?? null;
      const base = baseRole ? (builtinById.get(baseRole)?.permissions ?? null) : null;
      return {
        membershipId: membership._id as string,
        userId: user._id as string,
        name: user.name,
        email: user.email,
        role: baseRole,
        customRoleId: effective ? effective.id : null,
        customRoleName: effective ? effective.name : null,
        permissions: effectivePermissions(
          baseRole,
          effective?.permissions ?? base,
        ),
        active: membership.active,
        // Jejak kirim undangan lewat email (undangan, gagal, atau alamat uji).
        invite: {
          sentAt: membership.inviteSentAt ?? null,
          via: membership.inviteSentVia ?? null,
          error: membership.inviteError ?? null,
          attempts: membership.inviteAttempts ?? 0,
        },
        phone: membership.phone ?? null,
        waInvite: {
          at: membership.waInviteAt ?? null,
          count: membership.waInviteCount ?? 0,
        },
      };
    });
  }, [builtinRoles, customRoles, teamDocs]);

  const createCustomRole = useCallback(
    async (input: CreateCustomRoleInput): Promise<{ id: string; name: string }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await createRoleMutation({
        tenantId,
        actorId: userId,
        name: input.name,
        description: input.description,
        permissions: input.permissions,
      });
      return { id: result.roleId, name: result.name };
    },
    [tenantId, userId, createRoleMutation],
  );

  const updateCustomRole = useCallback(
    async (input: UpdateCustomRoleInput): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await updateRoleMutation({
        tenantId,
        actorId: userId,
        roleId: input.roleId as Id<"customRoles">,
        name: input.name,
        description: input.description,
        permissions: input.permissions,
        active: input.active,
      });
    },
    [tenantId, userId, updateRoleMutation],
  );

  const deleteCustomRole = useCallback(
    async (roleId: string): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await removeRoleMutation({
        tenantId,
        actorId: userId,
        roleId: roleId as Id<"customRoles">,
      });
    },
    [tenantId, userId, removeRoleMutation],
  );

  const assignCustomRole = useCallback(
    async (membershipId: string, roleId: string | null): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await assignRoleMutation({
        tenantId,
        actorId: userId,
        membershipId: membershipId as Id<"memberships">,
        customRoleId: roleId ? (roleId as Id<"customRoles">) : null,
      });
    },
    [tenantId, userId, assignRoleMutation],
  );

  const updateBuiltinRole = useCallback(
    async (
      input: UpdateBuiltinRoleInput,
    ): Promise<{ role: Role; permissions: Permission[]; active: boolean }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await setBuiltinRoleMutation({
        tenantId,
        actorId: userId,
        role: input.role,
        permissions: input.permissions,
        active: input.active,
      });
      return {
        role: result.role as Role,
        permissions: sanitizePermissions(result.permissions),
        active: result.active,
      };
    },
    [tenantId, userId, setBuiltinRoleMutation],
  );

  const deleteBuiltinRole = useCallback(
    async (role: Role): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await removeBuiltinRoleMutation({ tenantId, actorId: userId, role });
    },
    [tenantId, userId, removeBuiltinRoleMutation],
  );

  const restoreBuiltinRole = useCallback(
    async (role: Role): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await restoreBuiltinRoleMutation({ tenantId, actorId: userId, role });
    },
    [tenantId, userId, restoreBuiltinRoleMutation],
  );

  const resetBuiltinRole = useCallback(
    async (role: Role): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await resetBuiltinRoleMutation({ tenantId, actorId: userId, role });
    },
    [tenantId, userId, resetBuiltinRoleMutation],
  );

  /**
   * Mendaftarkan anggota tim baru ke workspace ini.
   *
   * Aturan email & perannya sama dengan server (`validateTeamInvite` di
   * `members.add`), jadi kesalahan terbaca sebelum jaringan dipakai; pagar
   * sesungguhnya tetap di server (`team.manage`, dan hanya pemilik yang boleh
   * mencetak pemilik). Daftar anggota ikut segar sendiri karena `members.list`
   * adalah langganan reaktif.
   */
  const addTeamMember = useCallback(
    async (input: InviteTeamMemberInput): Promise<InvitedTeamMember> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const invite = validateTeamInvite(
        { email: input.email, name: input.name, role: input.role ?? null },
        { actingRole: actingRole(session) },
      );
      if (!invite.ok) throw new Error(invite.reason);

      const result = await addMemberMutation({
        tenantId,
        actorId: userId,
        email: invite.value.email,
        name: invite.value.name,
        phone: input.phone?.trim() ? input.phone : undefined,
        role: invite.value.role ?? undefined,
        /*
          Peran kustom ikut sejak undangan pertama: `members.add` yang memutuskan
          boleh-tidaknya (fitur `rbac.custom` + pagar eskalasi), jadi halaman tidak
          perlu menebak. `null`/kosong berarti anggota memakai peran bawaannya.
        */
        customRoleId:
          input.customRoleId === undefined
            ? undefined
            : input.customRoleId === null
              ? null
              : (input.customRoleId as Id<"customRoles">),

      });
      return {
        membershipId: result.membershipId as string,
        userId: result.userId as string,
        email: invite.value.email,
        role: invite.value.role,
        created: result.created,
        // Pengirimannya dijadwalkan server setelah mutation ini selesai; keadaan
        // sebenarnya (terkirim / gagal / alamat uji) masuk lewat `teamMembers`.
        invite: EMPTY_INVITE_DELIVERY,
      };
    },
    [tenantId, userId, addMemberMutation, session],
  );

  /**
   * Mengubah anggota tim (nama, email, peran, nomor WA, aktif/nonaktif).
   *
   * Pratinjau aturannya dijalankan lebih dulu dengan data anggota yang sudah ada,
   * jadi kesalahan seperti “pemilik terakhir” atau nomor tidak valid terbaca
   * sebelum jaringan dipakai — server tetap yang memutuskan.
   */
  const updateTeamMember = useCallback(
    async (
      input: UpdateTeamMemberInput,
    ): Promise<{ email: string; changed: string[] }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const current = teamMembers.find(
        (row) => row.membershipId === input.membershipId,
      );
      if (!current) throw new Error("Anggota tidak ditemukan untuk tenant ini.");

      const decision = validateTeamMemberEdit(
        {
          membershipId: current.membershipId,
          name: current.name,
          email: current.email,
          role: current.role,
          phone: current.phone,
          active: current.active,
        },
        {
          name: input.name,
          email: input.email,
          role: input.role,
          phone: input.phone,
          active: input.active,
        },
        {
          actingRole: actingRole(session),
          // Baris keanggotaan **pemakai sendiri** (id akun ini dipakai sebagai
          // `actorId`), supaya pagar “akun sendiri” terbaca sebelum jaringan
          // dipakai — sama seperti yang akan dijawab server.
          actorMembershipId:
            teamMembers.find((row) => row.userId === userId)?.membershipId ?? null,
          activeOwners: teamMembers.filter((row) => row.role === "owner" && row.active)
            .length,
          otherEmails: teamMembers
            .filter((row) => row.membershipId !== input.membershipId)
            .map((row) => row.email.trim().toLowerCase()),
        },
      );
      if (!decision.ok) throw new Error(decision.reason);

      const result = await updateTeamMemberMutation({
        tenantId,
        actorId: userId,
        membershipId: input.membershipId as Id<"memberships">,
        name: decision.value.name,
        email: decision.value.email,
        role: decision.value.role ?? undefined,
        phone: decision.value.phone,
        active: decision.value.active,
      });

      return { email: result.email, changed: result.changed };
    },
    [tenantId, userId, teamMembers, updateTeamMemberMutation, session],
  );

  /** Menghapus anggota dari tim; pagar servernya tetap yang menentukan. */
  const removeTeamMember = useCallback(
    async (membershipId: string): Promise<{ email: string }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await removeTeamMemberMutation({
        tenantId,
        actorId: userId,
        membershipId: membershipId as Id<"memberships">,
      });
      return { email: result.email };
    },
    [tenantId, userId, removeTeamMemberMutation],
  );

  /** Mencatat undangan WhatsApp yang tautannya dibuka pengundang. */
  const recordWaInvite = useCallback(
    async (membershipId: string): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await recordWaInviteMutation({
        tenantId,
        actorId: userId,
        membershipId: membershipId as Id<"memberships">,
      });
    },
    [tenantId, userId, recordWaInviteMutation],
  );

  /** Kirim ulang undangan anggota: server menjadwalkan ulang emailnya. */
  const resendInvite = useCallback(
    async (membershipId: string): Promise<{ email: string }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await resendInviteMutation({
        tenantId,
        actorId: userId,
        membershipId: membershipId as Id<"memberships">,
      });
      return { email: result.email };
    },
    [tenantId, userId, resendInviteMutation],
  );

  // -------------------- Phase 4: akses API & webhook (`api.access`) -------
  const apiKeys: StoreApiKey[] = useMemo(
    () =>
      (apiAccessDocs?.keys ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        mask: row.mask,
        publicId: row.publicId,
        scopes: sanitizePermissions(row.scopes),
        creatorRole: row.creatorRole,
        status: row.status,
        expiresAt: row.expiresAt,
        lastUsedAt: row.lastUsedAt,
        createdAt: row.createdAt,
      })),
    [apiAccessDocs],
  );

  const apiKeySummary: StoreApiKeySummary = useMemo(
    () => ({
      active: apiAccessDocs?.summary.activeKeys ?? 0,
      revoked: apiAccessDocs?.summary.revokedKeys ?? 0,
      expiringSoon: apiAccessDocs?.summary.expiringSoon ?? 0,
    }),
    [apiAccessDocs],
  );

  const webhookEndpoints: StoreWebhookEndpoint[] = useMemo(
    () =>
      (apiAccessDocs?.endpoints ?? []).map((row) => ({
        id: row.id,
        url: row.url,
        description: row.description,
        events: row.events,
        active: row.active,
        secretLastFour: row.secretLastFour,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    [apiAccessDocs],
  );

  const webhookDeliveries: StoreWebhookDelivery[] = useMemo(
    () =>
      (apiAccessDocs?.deliveries ?? []).map((row) => ({
        id: row.id,
        endpointId: row.endpointId,
        event: row.event,
        status: row.status,
        attempts: row.attempts,
        lastStatusCode: row.lastStatusCode,
        lastError: row.lastError,
        nextAttemptAt: row.nextAttemptAt,
        deliveredAt: row.deliveredAt,
        createdAt: row.createdAt,
      })),
    [apiAccessDocs],
  );

  const webhookSummary: StoreWebhookSummary = useMemo(
    () => ({
      endpoints: apiAccessDocs?.summary.endpoints ?? 0,
      activeEndpoints: apiAccessDocs?.summary.activeEndpoints ?? 0,
      pendingDeliveries: apiAccessDocs?.summary.pendingDeliveries ?? 0,
      failedDeliveries: apiAccessDocs?.summary.failedDeliveries ?? 0,
    }),
    [apiAccessDocs],
  );

  const createApiKey = useCallback(
    async (
      input: CreateApiKeyInput,
    ): Promise<{
      id: string;
      name: string;
      plaintext: string;
      mask: string;
      scopes: Permission[];
    }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await createApiKeyMutation({
        tenantId,
        actorId: userId,
        name: input.name,
        scopes: input.scopes,
        expiresInDays: input.expiresInDays,
      });
      return {
        id: result.keyId,
        name: result.name,
        plaintext: result.plaintext,
        mask: result.mask,
        scopes: sanitizePermissions(result.scopes),
      };
    },
    [tenantId, userId, createApiKeyMutation],
  );

  const revokeApiKey = useCallback(
    async (keyId: string): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await revokeApiKeyMutation({
        tenantId,
        actorId: userId,
        keyId: keyId as Id<"apiKeys">,
      });
    },
    [tenantId, userId, revokeApiKeyMutation],
  );

  const createWebhookEndpoint = useCallback(
    async (input: CreateWebhookEndpointInput): Promise<{ id: string; secret: string }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await createEndpointMutation({
        tenantId,
        actorId: userId,
        url: input.url,
        description: input.description,
        events: input.events,
      });
      return { id: result.endpointId, secret: result.secret };
    },
    [tenantId, userId, createEndpointMutation],
  );

  const updateWebhookEndpoint = useCallback(
    async (input: UpdateWebhookEndpointInput): Promise<{ secret: string | null }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await updateEndpointMutation({
        tenantId,
        actorId: userId,
        endpointId: input.endpointId as Id<"webhookEndpoints">,
        active: input.active,
        description: input.description,
        events: input.events,
        rotateSecret: input.rotateSecret,
      });
      return { secret: result.secret ?? null };
    },
    [tenantId, userId, updateEndpointMutation],
  );

  const removeWebhookEndpoint = useCallback(
    async (endpointId: string): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await removeEndpointMutation({
        tenantId,
        actorId: userId,
        endpointId: endpointId as Id<"webhookEndpoints">,
      });
    },
    [tenantId, userId, removeEndpointMutation],
  );

  const testWebhookEndpoint = useCallback(
    async (endpointId: string): Promise<WebhookTestResult> => {
      if (!tenantId || !userId) {
        notReady();
      }
      return await testEndpointAction({
        tenantId,
        actorId: userId,
        endpointId: endpointId as Id<"webhookEndpoints">,
      });
    },
    [tenantId, userId, testEndpointAction],
  );

  // -------------------- Phase 5: dukungan khusus (`support.dedicated`) ------
  const supportTickets: StoreSupportTicket[] = useMemo(
    () =>
      (supportDocs?.tickets ?? []).map((row) => ({
        id: row.id,
        number: row.number,
        subject: row.subject,
        category: row.category,
        priority: row.priority,
        status: row.status,
        slaHours: row.slaHours,
        escalated: row.escalated,
        body: row.body,
        log: row.log.map((entry) => ({
          at: entry.at,
          kind: entry.kind,
          body: entry.body,
        })),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        resolvedAt: row.resolvedAt,
        dueAt: row.dueAt,
        slaState: row.slaState,
        remainingHours: row.remainingHours,
      })),
    [supportDocs],
  );

  const supportSummaryValue: StoreSupportSummary = useMemo(
    () => supportDocs?.summary ?? EMPTY_SUPPORT_SUMMARY,
    [supportDocs],
  );

  const supportPlan: StoreSupportPlan = useMemo(() => {
    const fallback = supportPlanFor(planKey);
    return {
      planKey: supportDocs?.plan.planKey ?? planKey,
      dedicated: supportDocs?.plan.dedicated ?? false,
      channel: supportDocs?.plan.channel ?? fallback.channel,
      responseHours: supportDocs?.plan.responseHours ?? fallback.responseHours,
      accountManager: supportDocs?.plan.accountManager ?? fallback.accountManager,
    };
  }, [supportDocs, planKey]);

  const supportLimits: StoreSupportLimits = useMemo(
    () =>
      supportDocs?.limits ?? {
        maxOpenTickets: MAX_OPEN_TICKETS,
        maxLog: MAX_TICKET_LOG,
      },
    [supportDocs],
  );

  const createSupportTicket = useCallback(
    async (
      input: CreateSupportTicketInput,
    ): Promise<{ id: string; number: string; slaHours: number }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await createSupportTicketMutation({
        tenantId,
        actorId: userId,
        subject: input.subject,
        category: input.category,
        priority: input.priority,
        body: input.body,
      });
      return { id: result.ticketId, number: result.number, slaHours: result.slaHours };
    },
    [tenantId, userId, createSupportTicketMutation],
  );

  const actSupportTicket = useCallback(
    async (input: ActSupportTicketInput): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await actSupportTicketMutation({
        tenantId,
        actorId: userId,
        ticketId: input.ticketId as Id<"supportTickets">,
        action: input.action,
        note: input.note,
      });
    },
    [tenantId, userId, actSupportTicketMutation],
  );

  /**
   * Laporan lintas cabang (`scale.franchise`, Phase 5). Angka sudah jadi dari
   * server (aturan murni `@/lib/scale`) — paket tanpa fiturnya menerima laporan
   * kosong yang sah, bukan angka.
   */
  const franchiseReport: StoreFranchiseReport = useMemo(
    () => franchiseDocs ?? EMPTY_FRANCHISE_REPORT,
    [franchiseDocs],
  );

  // ------------------ Phase 6: pembayaran digital (`payment.digital`) -------
  const digitalCharges: StoreDigitalCharge[] = useMemo(
    () =>
      (digitalDocs?.charges ?? []).map((row) => ({
        id: row.id,
        number: row.number,
        method: row.method,
        bank: row.bank,
        amount: row.amount,
        reference: row.reference,
        vaNumber: row.vaNumber,
        qrPayload: row.qrPayload,
        status: row.status,
        expiresAt: row.expiresAt,
        saleId: row.saleId,
        saleNumber: row.saleNumber,
        paidAmount: row.paidAmount,
        paidAt: row.paidAt,
        cancelReason: row.cancelReason,
        cancelledAt: row.cancelledAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        remainingSeconds: row.remainingSeconds,
      })),
    [digitalDocs],
  );

  const digitalSummaryValue: StoreDigitalSummary = useMemo(
    () => digitalDocs?.summary ?? EMPTY_DIGITAL_SUMMARY,
    [digitalDocs],
  );

  const digitalPlan: StoreDigitalPlan = useMemo(
    () => ({
      planKey: digitalDocs?.plan.planKey ?? planKey,
      digital: digitalDocs?.plan.digital ?? false,
      planName: digitalDocs?.plan.planName ?? PLANS[planKey].name,
    }),
    [digitalDocs, planKey],
  );

  const digitalLimits: StoreDigitalLimits = useMemo(
    () =>
      digitalDocs?.limits ?? {
        minAmount: DIGITAL_MIN_AMOUNT,
        maxAmount: DIGITAL_MAX_AMOUNT,
        referenceMax: DIGITAL_REFERENCE_MAX,
        reasonMax: DIGITAL_REASON_MAX,
        expiringSoonSeconds: EXPIRING_SOON_SECONDS,
        qrisExpiryMinutes: QRIS_EXPIRY_MINUTES,
        vaExpiryMinutes: VA_EXPIRY_MINUTES,
      },
    [digitalDocs],
  );

  const createDigitalCharge = useCallback(
    async (
      input: CreateDigitalChargeInput,
    ): Promise<{ id: string; number: string; expiresAt: number }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await createDigitalChargeMutation({
        tenantId,
        actorId: userId,
        amount: input.amount,
        method: input.method,
        bank: input.bank ?? undefined,
        reference: input.reference,
      });
      return { id: result.chargeId, number: result.number, expiresAt: result.expiresAt };
    },
    [tenantId, userId, createDigitalChargeMutation],
  );

  const actDigitalCharge = useCallback(
    async (input: ActDigitalChargeInput): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await actDigitalChargeMutation({
        tenantId,
        actorId: userId,
        chargeId: input.chargeId as Id<"digitalCharges">,
        action: input.action,
        amount: input.amount,
        reason: input.reason,
      });
    },
    [tenantId, userId, actDigitalChargeMutation],
  );

  // -------- Pesanan QR meja (`pos.table` + `payment.digital`) ---------------

  /**
   * Menerbitkan token kode QR meja. Idempoten tanpa `rotate`, dan meja nonaktif
   * ditolak — aturan itu ditegakkan server (`tables.issueMenuQr`), di sini hanya
   * disebut supaya pemanggilnya tidak perlu tahu.
   */
  const issueTableMenuQr = useCallback(
    async (
      tableId: string,
      options?: { rotate?: boolean },
    ): Promise<{ token: string; rotated: boolean }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await issueTableMenuQrMutation({
        tenantId,
        tableId: tableId as Id<"tables">,
        actorId: userId,
        rotate: options?.rotate,
      });
      return { token: result.token, rotated: result.rotated };
    },
    [tenantId, userId, issueTableMenuQrMutation],
  );

  const mejaOrders: StoreMejaOrder[] = useMemo(
    () => mejaOrderDocs ?? [],
    [mejaOrderDocs],
  );

  /**
   * Melunasi tagihan sebuah pesanan QR. Jalurnya `payments.act` yang sama dengan
   * halaman Pembayaran: server yang mengubah pesanannya menjadi tiket dapur
   * begitu tagihannya lunas.
   */
  const settleMejaOrder = useCallback(
    async (orderId: string): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const order = (mejaOrderDocs ?? []).find((row) => row.id === orderId);
      if (!order) throw new Error("Pesanan QR tidak ditemukan untuk tenant ini.");
      if (order.status === "paid") return;

      await actDigitalChargeMutation({
        tenantId,
        actorId: userId,
        chargeId: order.chargeId as Id<"digitalCharges">,
        action: "settle",
        amount: order.total,
      });
    },
    [tenantId, userId, mejaOrderDocs, actDigitalChargeMutation],
  );

  /** Membatalkan niat pesanan QR (tagihannya dibatalkan dari jalurnya sendiri). */
  const cancelMejaOrder = useCallback(
    async (orderId: string): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await cancelMejaOrderMutation({
        tenantId,
        actorId: userId,
        orderId: orderId as Id<"mejaOrders">,
      });
    },
    [tenantId, userId, cancelMejaOrderMutation],
  );

  // ---------------- Phase 6: sinkronisasi real-time (`sync.realtime`) -------
  const syncDevices: StoreSyncDevice[] = useMemo(
    () =>
      (syncDocs?.devices ?? []).map((row) => ({
        deviceId: row.deviceId,
        name: row.name,
        fingerprint: row.fingerprint,
        platform: row.platform,
        lastSeenAt: row.lastSeenAt,
        revoked: row.revoked,
        presence: row.presence,
        idleSeconds: row.idleSeconds,
        revision: row.revision,
      })),
    [syncDocs],
  );

  const syncChanges: StoreSyncChange[] = useMemo(
    () => (syncDocs?.changes ?? []).map(syncChangeFromDoc),
    [syncDocs],
  );

  const syncSummaryValue: StoreSyncSummary = useMemo(
    () => syncDocs?.summary ?? EMPTY_SYNC_SUMMARY,
    [syncDocs],
  );

  const syncLaggingValue: string[] = useMemo(
    () => syncDocs?.lagging ?? [],
    [syncDocs],
  );

  const syncPlan: StoreSyncPlan = useMemo(
    () => ({
      planKey: syncDocs?.plan.planKey ?? planKey,
      realtime: syncDocs?.plan.realtime ?? false,
      planName: syncDocs?.plan.planName ?? PLANS[planKey].name,
    }),
    [syncDocs, planKey],
  );

  const syncLimits: StoreSyncLimits = useMemo(
    () =>
      syncDocs?.limits ?? {
        maxChangesPerPull: MAX_CHANGES_PER_PULL,
        maxBoardChanges: 100,
        maxPayload: SYNC_PAYLOAD_MAX,
        maxClockSkewMs: MAX_CLOCK_SKEW_MS,
        onlineWindowMs: ONLINE_WINDOW_MS,
        idleWindowMs: IDLE_WINDOW_MS,
        maxLabel: SYNC_LABEL_MAX,
        maxFingerprint: SYNC_FINGERPRINT_MAX,
      },
    [syncDocs],
  );

  const syncEntities: StoreSyncEntityOption[] = useMemo(
    () => (syncDocs?.entities ?? []).map((row) => ({ key: row.key, label: row.label })),
    [syncDocs],
  );

  const syncPlatforms: StoreSyncPlatformOption[] = useMemo(
    () => (syncDocs?.platforms ?? []).map((row) => ({ key: row.key, label: row.label })),
    [syncDocs],
  );

  const registerSyncDevice = useCallback(
    async (
      input: RegisterSyncDeviceInput,
    ): Promise<{ deviceId: string; name: string }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await registerSyncMutation({
        tenantId,
        actorId: userId,
        label: input.label,
        platform: input.platform,
        fingerprint: input.fingerprint,
      });
      return { deviceId: result.deviceId, name: result.name };
    },
    [tenantId, userId, registerSyncMutation],
  );

  const heartbeatSyncDevice = useCallback(
    async (deviceId: string): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await heartbeatSyncMutation({
        tenantId,
        actorId: userId,
        deviceId: deviceId as Id<"devices">,
      });
    },
    [tenantId, userId, heartbeatSyncMutation],
  );

  const pushSync = useCallback(
    async (
      input: PushSyncInput,
    ): Promise<{ revision: number; outcome: StoreSyncChange["outcome"]; reason: string | null }> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const result = await pushSyncMutation({
        tenantId,
        actorId: userId,
        deviceFingerprint: input.deviceFingerprint,
        deviceName: input.deviceName,
        platform: input.platform,
        entity: input.entity,
        entityId: input.entityId,
        baseRevision: input.baseRevision,
        updatedAt: input.updatedAt,
        payload: input.payload,
      });
      return { revision: result.revision, outcome: result.outcome, reason: result.reason };
    },
    [tenantId, userId, pushSyncMutation],
  );

  /**
   * Menarik perubahan di atas kursor lewat `sync.changes` (satu jendela, urut
   * revisi menaik). Selalu boleh — perangkat yang kehilangan fiturnya tetap bisa
   * menyusul ketinggalannya.
   */
  const pullSync = useCallback(
    async (input: PullSyncInput): Promise<PullSyncResult> => {
      if (!tenantId || !userId) {
        notReady();
      }
      const cursor = Number.isFinite(input.cursor)
        ? Math.max(0, Math.floor(input.cursor))
        : 0;
      const result = await convex.query(api.sync.changes, {
        tenantId,
        actorId: userId,
        cursor,
        limit: input.limit,
      });
      return {
        items: result.items.map(syncChangeFromDoc),
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        latestRevision: result.latestRevision,
      };
    },
    [tenantId, userId, convex],
  );

  const resolveSyncChange = useCallback(
    async (changeId: string): Promise<void> => {
      if (!tenantId || !userId) {
        notReady();
      }
      await resolveSyncMutation({
        tenantId,
        actorId: userId,
        changeId: changeId as Id<"syncChanges">,
      });
    },
    [tenantId, userId, resolveSyncMutation],
  );

  const value = useMemo<StoreApi>(
    () => ({
      source: "convex",
      ready,
      workspacePending,
      cancelRegistration,
      error: provisionError,
      products,
      catalogProducts,
      sales,
      summary,
      categories: categoriesForUi,
      createCategory,
      renameCategory,
      setCategoryActive,
      removeCategory,
      subcategories: subcategoriesForUi,
      createSubcategory,
      renameSubcategory,
      setSubcategoryActive,
      removeSubcategory,
      modules,
      setModules,
      tax,
      setTax,
      fnbTax,
      setFnbTax,
      fnbTaxMonths,
      fnbTaxMonth,
      receipt,
      setReceipt,
      shift,
      setShift,
      shiftAlerts,
      reportShiftAlert,
      resolveShiftAlert,
      till,
      openTill,
      closeTill,
      logo,
      setLogo,
      removeLogo,
      myProfile,
      setMyProfile,
      tenantProfile,
      setTenantProfile,
      businessCategory,
      setBusinessCategory,
      businessCategories,
      syncProductCategories,
      platformDeveloper,
      changePlan,
      createProduct,
      updateProduct,
      setProductActive,
      checkProductDeletion,
      removeProduct,
      addProductImage,
      removeProductImage,
      setPricing,
      setCategory,
      setModifiers,
      customers,
      receivables,
      arSummary,
      createCustomer,
      setCredit,
      recordPayment,
      members,
      createMember,
      updateMember,
      sendReceiptWhatsapp,
      tables,
      kdsTickets,
      createTable,
      updateTable,
      setTableActive,
      deleteTable,
      tableDeletionCheck: checkTableDeletion,
      moveTable,
      importTables,
      issueTableMenuQr,
      mejaOrders,
      settleMejaOrder,
      cancelMejaOrder,
      holdSale,
      completeHeld,
      finishKitchenTicket,
      warehouses,
      stock,
      warehouseCapacity: warehouseCapacityValue,
      transfers,
      createWarehouse,
      setWarehouseActive,
      transferStock,
      opnameSessions,
      opnameLocations,
      opnameSummary,
      opnameOpenByLocation,
      startOpname,
      setOpnameCount,
      postOpname,
      cancelOpname,
      suppliers,
      requisitions,
      orders,
      receipts,
      purchasingSummary,
      createSupplier,
      updateSupplier,
      createRequisition,
      decideRequisition,
      createOrder,
      cancelOrder,
      receiveGoods,
      payables,
      payablePayments,
      payableSummary,
      threewaySummary,
      paymentBatches,
      createBill,
      recordInvoice,
      resolvePayableMatch,
      recordPayablePayment,
      payPayables,
      analyticsReport,
      analyticsDays,
      setAnalyticsDays: setAnalyticsPeriod,
      franchiseReport,
      supportTickets,
      supportSummary: supportSummaryValue,
      supportPlan,
      supportLimits,
      createSupportTicket,
      actSupportTicket,
      digitalCharges,
      digitalSummary: digitalSummaryValue,
      digitalPlan,
      digitalLimits,
      createDigitalCharge,
      actDigitalCharge,
      syncDevices,
      syncChanges,
      syncSummary: syncSummaryValue,
      syncLagging: syncLaggingValue,
      syncPlan,
      syncLimits,
      syncEntities,
      syncPlatforms,
      registerSyncDevice,
      heartbeatSyncDevice,
      pushSync,
      pullSync,
      resolveSyncChange,
      builtinRoles,
      customRoles,
      roleSummary,
      teamMembers,
      addTeamMember,
      resendInvite,
      updateTeamMember,
      removeTeamMember,
      recordWaInvite,
      createCustomRole,
      updateCustomRole,
      deleteCustomRole,
      assignCustomRole,
      updateBuiltinRole,
      deleteBuiltinRole,
      restoreBuiltinRole,
      resetBuiltinRole,
      apiKeys,
      apiKeySummary,
      webhookEndpoints,
      webhookDeliveries,
      webhookSummary,
      createApiKey,
      revokeApiKey,
      createWebhookEndpoint,
      updateWebhookEndpoint,
      removeWebhookEndpoint,
      testWebhookEndpoint,
      createSale,
      adjustStock,
      offline,
    }),
    [
      ready,
      workspacePending,
      cancelRegistration,
      provisionError,
      products,
      catalogProducts,
      sales,
      summary,
      categoriesForUi,
      createCategory,
      renameCategory,
      setCategoryActive,
      removeCategory,
      subcategoriesForUi,
      createSubcategory,
      renameSubcategory,
      setSubcategoryActive,
      removeSubcategory,
      modules,
      setModules,
      tax,
      setTax,
      fnbTax,
      setFnbTax,
      fnbTaxMonths,
      fnbTaxMonth,
      receipt,
      setReceipt,
      shift,
      setShift,
      shiftAlerts,
      reportShiftAlert,
      resolveShiftAlert,
      till,
      openTill,
      closeTill,
      logo,
      setLogo,
      removeLogo,
      myProfile,
      setMyProfile,
      tenantProfile,
      setTenantProfile,
      businessCategory,
      setBusinessCategory,
      businessCategories,
      syncProductCategories,
      platformDeveloper,
      changePlan,
      createProduct,
      updateProduct,
      setProductActive,
      checkProductDeletion,
      removeProduct,
      addProductImage,
      removeProductImage,
      setPricing,
      setCategory,
      setModifiers,
      customers,
      receivables,
      arSummary,
      createCustomer,
      setCredit,
      recordPayment,
      members,
      createMember,
      updateMember,
      sendReceiptWhatsapp,
      tables,
      kdsTickets,
      createTable,
      updateTable,
      setTableActive,
      deleteTable,
      checkTableDeletion,
      moveTable,
      importTables,
      issueTableMenuQr,
      mejaOrders,
      settleMejaOrder,
      cancelMejaOrder,
      holdSale,
      completeHeld,
      finishKitchenTicket,
      warehouses,
      stock,
      warehouseCapacityValue,
      transfers,
      createWarehouse,
      setWarehouseActive,
      transferStock,
      opnameSessions,
      opnameLocations,
      opnameSummary,
      opnameOpenByLocation,
      startOpname,
      setOpnameCount,
      postOpname,
      cancelOpname,
      suppliers,
      requisitions,
      orders,
      receipts,
      purchasingSummary,
      createSupplier,
      updateSupplier,
      createRequisition,
      decideRequisition,
      createOrder,
      cancelOrder,
      receiveGoods,
      payables,
      payablePayments,
      payableSummary,
      threewaySummary,
      paymentBatches,
      createBill,
      recordInvoice,
      resolvePayableMatch,
      recordPayablePayment,
      payPayables,
      analyticsReport,
      analyticsDays,
      setAnalyticsPeriod,
      franchiseReport,
      supportTickets,
      supportSummaryValue,
      supportPlan,
      supportLimits,
      createSupportTicket,
      actSupportTicket,
      digitalCharges,
      digitalSummaryValue,
      digitalPlan,
      digitalLimits,
      createDigitalCharge,
      actDigitalCharge,
      syncDevices,
      syncChanges,
      syncSummaryValue,
      syncLaggingValue,
      syncPlan,
      syncLimits,
      syncEntities,
      syncPlatforms,
      registerSyncDevice,
      heartbeatSyncDevice,
      pushSync,
      pullSync,
      resolveSyncChange,
      builtinRoles,
      customRoles,
      roleSummary,
      teamMembers,
      addTeamMember,
      resendInvite,
      updateTeamMember,
      removeTeamMember,
      recordWaInvite,
      createCustomRole,
      updateCustomRole,
      deleteCustomRole,
      assignCustomRole,
      updateBuiltinRole,
      deleteBuiltinRole,
      restoreBuiltinRole,
      resetBuiltinRole,
      apiKeys,
      apiKeySummary,
      webhookEndpoints,
      webhookDeliveries,
      webhookSummary,
      createApiKey,
      revokeApiKey,
      createWebhookEndpoint,
      updateWebhookEndpoint,
      removeWebhookEndpoint,
      testWebhookEndpoint,
      createSale,
      adjustStock,
      offline,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

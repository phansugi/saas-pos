/**
 * Demo store — the default implementation.
 *
 * Deliberately behaves like the Convex backend: money is computed with the same
 * shared billing math (so PPN and totals agree), receipts are numbered with the
 * same `A-00001` scheme, over-selling is refused, and the stock ledger moves by
 * the same signed delta. That means switching to Convex changes where the data
 * lives, not what the app does.
 *
 * Checkout also goes through the same offline outbox as the live store. The
 * local commit happens immediately (the till must never block) and the "sync"
 * step is simulated: it fails with OfflineError while the browser is offline so
 * the queue genuinely fills and drains. Numbers appear instantly because there
 * is no server to assign them.
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  API_KEYS,
  CATEGORIES,
  CUSTOMERS,
  CUSTOM_ROLES,
  FRANCHISE_OUTLETS,
  MEMBERS,
  OPNAME_SESSIONS,
  ORDERS,
  PAYABLES,
  PRODUCTS,
  RECEIPTS,
  RECEIVABLES,
  RECENT_SALES,
  REQUISITIONS,
  SUPPLIERS,
  SUPPORT_TICKETS,
  TABLES,
  TEAM_MEMBERS,
  WAREHOUSES,
  WAREHOUSE_STOCK,
  WEBHOOK_DELIVERIES,
  WEBHOOK_ENDPOINTS,
  type DemoApiKey,
  type DemoCustomer,
  type DemoCustomRole,
  type DemoMember,
  type DemoOpnameSession,
  type DemoOrder,
  type DemoPayable,
  type DemoReceipt,
  type DemoReceivable,
  type DemoSupportTicket,
  type DemoSupplier,
  type DemoTeamMember,
  type DemoWarehouse,
  type DemoWebhookEndpoint,
  DIGITAL_CHARGES,
  SYNC_CHANGES,
  SYNC_DEVICES,
  type DemoDigitalCharge,
  type DemoSyncChange,
  type DemoSyncDevice,
} from "@/data/demo";
import {
  API_KEY_SECRET_ALPHABET,
  API_KEY_SECRET_LENGTH,
  hashApiSecret,
  keyStatus,
  maskApiKey,
  mintApiKey,
  randomToken,
  sanitizeApiScopes,
  validateApiKeyInput,
  type ApiKeyStatus,
} from "@/lib/apiKeys";
import {
  agingOf,
  applyReceivablePayment,
  creditFromPayment,
  creditPosition,
  decideCredit,
  dueDateFrom,
  receivableBalance,
  resolveCustomerInput,
  rupiah,
  summariseReceivables,
  type ReceivableLike,
} from "@/lib/ar";
import {
  effectiveTaxRatePct,
  sameTaxSetting,
  taxSettingOf,
  taxSettingSentence,
  validateTaxRatePct,
  type TaxSetting,
} from "@/lib/tax";
import {
  DEFAULT_FNB_TAX_PROFILE,
  fnbCurrentMonthSummary,
  fnbTaxProfileOf,
  fnbTaxProfileSentence,
  monthlyTaxRows,
  orderTotal as fnbOrderTotal,
  recentMonthWindows,
  sameFnbTaxProfile,
  validateFnbTaxProfile,
  type FnbTaxProfile,
} from "@/lib/fnbTax";
import {
  DEFAULT_RECEIPT_SETTING,
  receiptSettingOf,
  receiptSettingSentence,
  sameReceiptSetting,
  validateReceiptSetting,
  type ReceiptSetting,
} from "@/lib/struk";
import {
  applyTenantProfileDraft,
  applyUserProfileDraft,
  sameTenantProfile,
  sameUserProfile,
  tenantProfileSentence,
  userProfileSentence,
} from "@/lib/profile";
import {
  computeTax,
  DEFAULT_TAX_RATE_PCT,
  entitlementFor,
  entitlementsDelta,
  FEATURE_LABELS,
  featureOwner,
  isFeatureEnabled,
  isWithinLimit,
  PLANS,
  reverseTax,
  trimVerticalsForPlan,
  VERTICAL_LABELS,
  type FeatureKey,
  type PlanKey,
  type Vertical,
} from "@/lib/billing";
import {
  DEFAULT_WAREHOUSE_ID,
  defaultWarehouse,
  describeWarehouse,
  normalizeWarehouseCode,
  planTransfer,
  resolveWarehouseInput,
  warehouseCapacity,
} from "@/lib/inventory";
import {
  buildOpnameLines,
  canCancelOpname,
  canEditOpname,
  canPostOpname,
  countProgress,
  lineVariance,
  planOpnamePost,
  resolveOpnameNote,
  resolveOpnameStart,
  setCountedQty,
  summariseOpnameSessions,
  summariseVariance,
  type OpnameLineLike,
  type OpnameStatus,
} from "@/lib/opname";
import {
  applyPayablePayment,
  buildPayableForReceipt,
  describePayableSource,
  payableAging,
  payableBalance,
  payablePosition,
  resolveBillInput,
  resolveDueDate,
  supplierBlockedReason,
  summarisePayables,
  type PayableLike,
  type PayableStatus,
} from "@/lib/payables";
import {
  amountAfterDecision,
  canPayPayable,
  canRecordInvoice,
  matchPayable,
  planBatchPayment,
  resolveInvoiceInput,
  resolveMatchDecision,
  summariseThreeway,
  type InvoiceLine,
  type MatchDecision,
} from "@/lib/threeway";
import {
  canCancelOrder,
  canDecideRequisition,
  canOrderFromRequisition,
  orderLineTotal,
  orderStatusFromLines,
  orderTotal,
  planReceipt,
  resolveOrderInput,
  resolveRequisitionInput,
  resolveSupplierInput,
  resolveSupplierUpdate,
  summarisePurchasing,
  type OrderLine,
  type OrderStatus,
  type RequisitionStatus,
} from "@/lib/purchasing";
import {
  DEFAULT_TABLE_ZONE,
  kdsQueue,
  nextTableSortOrder,
  planTableImport,
  planTableMove,
  resolveTableInput,
  seatTable,
  sortTablesByOrder,
  tableDeletionCheck,
  tableLabel,
  tableNameTaken,
  type TableUsage,
} from "@/lib/fnb";
import {
  GUEST_MAX_LINES,
  GUEST_MAX_QTY_PER_ITEM,
  GUEST_MAX_UNITS,
  GUEST_NAME_MAX,
  guestBankOptions,
  guestCancelCheck,
  guestChargeReference,
  guestOrderTotal,
  guestPayOptions,
  guestPaymentInstruction,
  guestPaymentMethod,
  guestTaxRulesFrom,
  isAwaitingPayment,
  mejaMenuToken,
  mejaUnavailableReason,
  mejaWatchToken,
  normalizeGuestName,
  validateGuestCart,
  type GuestProduct,
} from "@/lib/meja";
import {
  applyModifiers,
  hasModifiers,
  lineTotalWithModifiers,
  resolveModifierConfig,
} from "@/lib/modifiers";
import {
  discountBreakdown,
  resolveMemberInput,
} from "@/lib/loyalty";
import {
  categoryIsActive,
  categoryNameKey,
  categorySkuCode,
  normalizeCategoryName,
  validateCategoryName,
} from "@/lib/categories";
import {
  canAddProductImage,
  readImageAsDataUrl,
  validateProductImage,
} from "@/lib/productImages";
import { validateTenantLogo } from "@/lib/tenantLogo";
import { recodeProductSku, suggestProductSku } from "@/lib/productSku";
import {
  productDeletionCheck,
  validateProductIdentity,
  type ProductUsage,
} from "@/lib/productEdit";
import { priceLine } from "@/lib/wholesale";
import {
  analyticsRange,
  buildAdvancedReport,
  DEFAULT_ANALYTICS_DAYS,
  resolveAnalyticsDays,
  weekdayOf,
  type AnalyticsItemInput,
  type AnalyticsSaleInput,
} from "@/lib/analytics";
import {
  MAX_WEBHOOK_ENDPOINTS,
  sampleDeliveryEvent,
  sampleDeliveryPayload,
  sanitizeWebhookEvents,
  signWebhookPayload,
  validateWebhookEndpoint,
} from "@/lib/webhooks";
import {
  FRANCHISE_TOP_SALES,
  franchiseRollup,
  mergeTopN,
  queryBudgetFor,
  type FranchiseOutletInput,
} from "@/lib/scale";
import {
  applySupportAction,
  dueAt as supportDueAt,
  logBodyFor,
  MAX_OPEN_TICKETS,
  MAX_TICKET_LOG,
  openTicketCount,
  responseHoursFor,
  slaState as supportSlaState,
  supportPlanFor,
  supportSummary,
  ticketNumber,
  validateTicketInput,
  type SupportTicketLike,
} from "@/lib/support";
import {
  applyChargeAction,
  chargeLikeFrom,
  chargeNumber,
  checkSaleAgainstCharge,
  DIGITAL_MAX_AMOUNT,
  DIGITAL_MIN_AMOUNT,
  DIGITAL_REFERENCE_MAX,
  DIGITAL_REASON_MAX,
  EXPIRING_SOON_SECONDS,
  expiryAtFor,
  expiryMinutesFor,
  qrPayload,
  QRIS_EXPIRY_MINUTES,
  remainingSeconds as digitalRemainingSeconds,
  statusOf as digitalStatusOf,
  summariseCharges,
  validateChargeInput,
  VA_EXPIRY_MINUTES,
  virtualAccountNumber,
  type DigitalChargeLike,
  type DigitalMethod,
  type DigitalStatus,
  type VaBank,
} from "@/lib/payments";
import {
  decidePush,
  idleSeconds as syncIdleSeconds,
  laggingDevices,
  MAX_CHANGES_PER_PULL,
  MAX_CLOCK_SKEW_MS,
  nextRevision,
  ONLINE_WINDOW_MS,
  IDLE_WINDOW_MS,
  presenceState,
  pullWindow,
  summariseSync,
  SYNC_ENTITY_KEYS,
  SYNC_ENTITY_LABELS,
  SYNC_FINGERPRINT_MAX,
  SYNC_LABEL_MAX,
  SYNC_PAYLOAD_MAX,
  SYNC_PLATFORM_KEYS,
  SYNC_PLATFORM_LABELS,
  validatePushInput,
  validateSyncDevice,
  type PresenceState,
  type PushOutcome,
} from "@/lib/sync";
import { OfflineError } from "@/lib/offline/outbox";
import { useOutbox } from "@/lib/offline/useOutbox";
import {
  assignmentError,
  effectivePermissions,
  lackingPermissions,
  MAX_CUSTOM_ROLES,
  roleAssignments,
  sanitizePermissions,
  validateCustomRole,
} from "@/lib/rbac";
import type { Permission } from "@/lib/authz";
import {
  maskPhone,
  receiptWhatsappRecipient,
  type ReceiptWhatsappSendResult,
} from "@/lib/receiptWhatsapp";
import { actingPermissions, useSession } from "@/lib/session";
import {
  EMPTY_INVITE_DELIVERY,
  EMPTY_WA_INVITE,
  normalizePhone,
  validateTeamInvite,
  validateTeamMemberEdit,
  validateTeamMemberRemoval,
} from "@/lib/team";
import { StoreContext } from "./context";
import { modulesFor } from "./modules";
import {
  EMPTY_AR_SUMMARY,
  EMPTY_SUMMARY,
  PAYMENT_LABEL_BY_METHOD,
  type CartItemInput,
  type CreateBillInput,
  type CreateCustomerInput,
  type CreateSaleInput,
  type CreateOrderInput,
  type CreateRequisitionInput,
  type CreateSupplierInput,
  type CreateWarehouseInput,
  type DecideRequisitionInput,
  type ReceiveGoodsInput,
  type RecordPayablePaymentInput,
  type SetOpnameCountInput,
  type StartOpnameInput,
  type StoreOpnameLocation,
  type StoreOpnameSession,
  type StoreOpnameSummary,
  type StoreOrder,
  type StorePayable,
  type StorePayablePayment,
  type StorePayableSummary,
  type StoreAdvancedReport,
  type ActSupportTicketInput,
  type CreateSupportTicketInput,
  EMPTY_FRANCHISE_REPORT,
  type StoreFranchiseReport,
  type StoreFranchiseTopSale,
  type StorePaymentBatch,
  type StoreSupportLimits,
  type StoreSupportPlan,
  type StoreSupportSummary,
  type StoreSupportTicket,
  type StoreSupplier,
  type StoreThreewaySummary,
  type PayBatchInput,
  type RecordInvoiceInput,
  type ResolveMatchInput,
  type UpdateSupplierInput,
  type StorePurchasingSummary,
  type ProductDeletionInfo,
  type StoreReceipt,
  type StoreRequisition,
  type StoreStockRow,
  type StoreTransfer,
  type StoreWarehouse,
  type TransferStockInput,
  type CreateSaleResult,
  type CreateTableInput,
  type UpdateTableInput,
  type StoreTableDeletionCheck,
  type HoldSaleInput,
  type RecordPaymentInput,
  type SetCreditInput,
  type SetModifiersInput,
  type SetPricingInput,
  type SetProductCategoryInput,
  type CreateCategoryInput,
  type CreateMemberInput,
  type CreateProductInput,
  type RemovedCategory,
  type RenamedCategory,
  type RenameCategoryInput,
  type StoreCategory,
  type CreateCustomRoleInput,
  type CreateApiKeyInput,
  type CreateWebhookEndpointInput,
  type StoreApi,
  type StoreApiKey,
  type StoreApiKeySummary,
  type StoreWebhookDelivery,
  type StoreWebhookEndpoint,
  type StoreWebhookSummary,
  type UpdateWebhookEndpointInput,
  type WebhookTestResult,
  type StoreArSummary,
  type StoreCustomRole,
  type StoreCustomer,
  type StoreLogo,
  type StoreProduct,
  type StoreProductImage,
  type StoreReceivable,
  type StoreRoleSummary,
  type StoreSale,
  type StoreSummary,
  type StoreTable,
  type StoreTeamMember,
  type InviteTeamMemberInput,
  type InvitedTeamMember,
  type UpdateTeamMemberInput,
  type UpdateCustomRoleInput,
  type UpdateMemberInput,
  type SendReceiptWhatsappInput,
  type UpdateProductInput,
  type UpdatedProduct,
  type UpdateTaxInput,
  type UpdatedTax,
  type UpdateFnbTaxInput,
  type UpdatedFnbTax,
  type UpdateReceiptInput,
  type UpdatedReceipt,
  type StoreFnbTaxMonth,
  type StoreFnbTaxMonthSummary,
  type ActDigitalChargeInput,
  type CreateDigitalChargeInput,
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
  type GuestOrderInput,
  type GuestOrderResult,
  type StoreGuestMenuGroup,
  type StoreGuestMenuResult,
  type StoreGuestOrderStatus,
  type StoreMejaOrder,
  type StoreTenantProfile,
  type StoreUserProfile,
  type UpdateTenantProfileInput,
  type UpdateUserProfileInput,
  type UpdatedTenantProfile,
  type UpdatedUserProfile,
} from "./types";
import type { MejaOrderStatus } from "@/lib/meja";

const LOW_STOCK_THRESHOLD = 5;
const OUTBOX_KEY = "mesinpos.outbox.demo.v1";
/** Berapa bulan yang ditampilkan laporan pajak & pungutan F&B di halaman Laporan. */
const FNB_TAX_REPORT_MONTHS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Piutang demo: jatuh tempo disimpan absolut, hasil dari selisih hari seed. */
type StoredReceivable = Omit<DemoReceivable, "dueOffsetDays"> & { dueDate: number };

/**
 * Kunci API demo dalam bentuk yang disimpan: rahasianya sudah diganti hash,
 * jadi `plaintext` tidak pernah bisa diambil lagi setelah dibuat.
 */
type DemoApiKeyRecord = Omit<DemoApiKey, "expiresInDays" | "lastUsedDaysAgo" | "createdDaysAgo"> & {
  secretHash: string;
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
};

type DemoWebhookEndpointRecord = Omit<DemoWebhookEndpoint, "createdDaysAgo"> & {
  secret: string;
  /** Empat karakter terakhir rahasia penanda tangan; yang tampil di daftar. */
  secretLastFour: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * Tiket dukungan demo dalam bentuk tersimpan: waktu sudah absolut dan riwayatnya
 * siap ditambah. `slaHours` disimpan di baris tiket, bukan dihitung ulang dari
 * paket saat dibaca — sama seperti backend, supaya janji tanggap tidak berubah
 * saat paket berubah.
 */
type DemoTicketRecord = Omit<
  DemoSupportTicket,
  "createdMinutesAgo" | "resolvedMinutesAgo" | "log"
> & {
  createdAt: number;
  resolvedAt: number | null;
  updatedAt: number;
  log: { at: number; kind: "note" | "status"; body: string }[];
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Tagihan digital demo dalam bentuk tersimpan: waktu absolut dan tenggat yang
 * **sudah dipatok** dari janji umur data contoh — sama seperti backend, supaya
 * status kedaluwarsanya dihitung dari aturan yang sama.
 */
type DemoChargeRecord = Omit<
  DemoDigitalCharge,
  "createdMinutesAgo" | "paidMinutesAgo" | "cancelledMinutesAgo"
> & {
  createdAt: number;
  expiresAt: number;
  paidAt: number | null;
  cancelledAt: number | null;
  updatedAt: number;
  /** Penjualan yang dilunasi tagihan ini (`pos.createSale` dari keranjang). */
  saleId?: string | null;
  saleNumber?: string | null;
};

/**
 * Satu pesanan QR meja di mode demo — bentuk tersimpannya, sama seperti baris
 * `mejaOrders` di server: isi pesanannya ditahan dulu, dan penjualannya baru
 * lahir saat tagihannya lunas.
 */
interface DemoMejaOrderRecord {
  id: string;
  tableId: string;
  tableName: string;
  watchToken: string;
  /** Cara bayar yang dipilih tamu + nomor VA-nya (kalau memilih VA). */
  method?: DigitalMethod;
  bank?: VaBank;
  vaNumber?: string;
  lines: {
    productId: string;
    name: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  subtotal: number;
  tax: number;
  serviceCharge: number;
  total: number;
  guestName?: string;
  chargeId: string;
  chargeNumber: string;
  status: MejaOrderStatus;
  saleId?: string;
  saleNumber?: string;
  paidAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** Identitas acak untuk mode demo (peramban & Node sama-sama punya `crypto`). */
function demoRandomId(): string {
  const cryptoRef = globalThis.crypto as Crypto | undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  return Math.random().toString(16).slice(2).repeat(3);
}

/** Perangkat hub sinkronisasi demo: kehadiran diturunkan dari `lastSeenAt`. */
type DemoSyncDeviceRecord = Omit<DemoSyncDevice, "lastSeenMinutesAgo"> & {
  lastSeenAt: number;
  revoked: boolean;
};

/** Satu baris log sinkronisasi demo dengan identitas & waktu absolut. */
type DemoSyncChangeRecord = Omit<
  DemoSyncChange,
  "updatedMinutesAgo" | "resolvedMinutesAgo"
> & {
  id: string;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
};

/** Bagian tiket yang dibutuhkan aturan SLA & transisi murni. */
function toSupportLike(ticket: DemoTicketRecord): SupportTicketLike {
  return {
    number: ticket.number,
    status: ticket.status,
    createdAt: ticket.createdAt,
    slaHours: ticket.slaHours,
    escalated: ticket.escalated,
    resolvedAt: ticket.resolvedAt,
    logCount: ticket.log.length,
  };
}

function seedSupportTickets(): DemoTicketRecord[] {
  const now = Date.now();
  return SUPPORT_TICKETS.map((ticket) => {
    const createdAt = now - ticket.createdMinutesAgo * MINUTE_MS;
    const resolvedAt =
      ticket.resolvedMinutesAgo === undefined
        ? null
        : now - ticket.resolvedMinutesAgo * MINUTE_MS;
    const lastEntry = ticket.log[ticket.log.length - 1];
    return {
      id: ticket.id,
      number: ticket.number,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      slaHours: ticket.slaHours,
      escalated: ticket.escalated,
      body: ticket.body,
      createdAt,
      resolvedAt,
      updatedAt: resolvedAt ?? now - (lastEntry?.atMinutesAgo ?? 0) * MINUTE_MS,
      log: ticket.log.map((entry) => ({
        at: now - entry.atMinutesAgo * MINUTE_MS,
        kind: entry.kind,
        body: entry.body,
      })),
    };
  });
}

/**
 * Cabang contoh dalam bentuk masukan aturan murni `@/lib/scale` — waktu absolut
 * dan baris penjualan, bukan angka jadinya, supaya laporan demo dihitung dengan
 * aturan yang sama dengan server.
 */
function seedFranchiseInputs(): FranchiseOutletInput[] {
  const now = Date.now();
  return FRANCHISE_OUTLETS.map((outlet) => ({
    storeId: outlet.id,
    name: outlet.name,
    code: outlet.code,
    active: outlet.active,
    sales: outlet.sales.map((sale) => ({
      total: sale.total,
      createdAt: now - sale.minutesAgo * MINUTE_MS,
    })),
  }));
}

function seedDigitalCharges(): DemoChargeRecord[] {
  const now = Date.now();
  return DIGITAL_CHARGES.map((charge) => {
    const createdAt = now - charge.createdMinutesAgo * MINUTE_MS;
    const paidAt =
      charge.paidMinutesAgo === undefined
        ? null
        : now - charge.paidMinutesAgo * MINUTE_MS;
    const cancelledAt =
      charge.cancelledMinutesAgo === undefined
        ? null
        : now - charge.cancelledMinutesAgo * MINUTE_MS;
    return {
      ...charge,
      createdAt,
      // Tenggat dipatok saat tagihan dibuat dari janji umurnya sendiri.
      expiresAt: expiryAtFor(charge.method, createdAt),
      paidAt,
      cancelledAt,
      updatedAt: cancelledAt ?? paidAt ?? createdAt,
    };
  });
}

function seedSyncDevices(): DemoSyncDeviceRecord[] {
  const now = Date.now();
  return SYNC_DEVICES.map((device) => ({
    ...device,
    lastSeenAt: now - device.lastSeenMinutesAgo * MINUTE_MS,
    revoked: false,
  }));
}

function seedSyncChanges(): DemoSyncChangeRecord[] {
  const now = Date.now();
  return SYNC_CHANGES.map((change) => {
    const createdAt = now - change.updatedMinutesAgo * MINUTE_MS;
    return {
      ...change,
      id: `sync-${change.revision}`,
      createdAt,
      updatedAt: createdAt,
      resolvedAt:
        change.resolvedMinutesAgo === undefined
          ? null
          : now - change.resolvedMinutesAgo * MINUTE_MS,
    };
  });
}

function seedCustomers(): DemoCustomer[] {
  return CUSTOMERS.map((customer) => ({ ...customer }));
}

function seedMembers(): DemoMember[] {
  return MEMBERS.map((member) => ({ ...member }));
}

/**
 * Kategori demo: berisi kategori katalog contoh **ditambah** kategori yang sudah
 * dipakai produk, urutannya sama dengan urutan yang dulu diturunkan dari katalog
 * (`CATEGORIES` dulu, lalu sisanya) — jadi tampilan demo tidak berubah, tetapi
 * kategorinya sekarang punya identitas sendiri seperti di server.
 */
function seedCategories(): DemoCategoryRow[] {
  const used = new Set(seedProducts().map((product) => product.category));
  const ordered: string[] = CATEGORIES.filter(
    (name) => name !== "Semua" && used.has(name),
  );
  for (const name of used) {
    if (!ordered.includes(name)) ordered.push(name);
  }
  return ordered.map((name, index) => ({
    id: `cat-${index + 1}`,
    name,
    active: true,
    sortOrder: index,
  }));
}

/**
 * Kunci API demo: menyimpan **hash** rahasia, bukan rahasianya — sama seperti
 * backend. Karena data contoh tidak punya rahasia yang diketahui siapa pun,
 * hash-nya dibuat dari token acak sekali pakai, sehingga kunci contoh tidak
 * bisa dipakai walau `publicId`-nya terbaca di halaman.
 */
function seedApiKeys(): DemoApiKeyRecord[] {
  const now = Date.now();
  return API_KEYS.map((key) => ({
    id: key.id,
    name: key.name,
    publicId: key.publicId,
    secretHash: hashApiSecret(
      key.publicId,
      randomToken(API_KEY_SECRET_LENGTH, API_KEY_SECRET_ALPHABET),
    ),
    scopes: sanitizeApiScopes(key.scopes),
    creatorRole: key.creatorRole,
    active: key.active,
    expiresAt: key.expiresInDays === 0 ? null : now + key.expiresInDays * DAY_MS,
    revokedAt: key.active ? null : now - 30 * DAY_MS,
    lastUsedAt: key.lastUsedDaysAgo === null ? null : now - key.lastUsedDaysAgo * DAY_MS,
    createdAt: now - key.createdDaysAgo * DAY_MS,
  }));
}

function seedWebhookEndpoints(): DemoWebhookEndpointRecord[] {
  const now = Date.now();
  return WEBHOOK_ENDPOINTS.map((endpoint) => {
    const createdAt = now - endpoint.createdDaysAgo * DAY_MS;
    // Rahasia contoh, bukan kredensial sungguhan: host `.test` tidak melayani
    // kiriman apa pun. Yang ditampilkan hanya 4 karakter terakhirnya.
    const secret = randomToken(API_KEY_SECRET_LENGTH, API_KEY_SECRET_ALPHABET);
    return {
      id: endpoint.id,
      url: endpoint.url,
      description: endpoint.description,
      events: sanitizeWebhookEvents(endpoint.events),
      secret,
      secretLastFour: secret.slice(-4),
      active: endpoint.active,
      createdAt,
      updatedAt: createdAt,
    };
  });
}

function seedWebhookDeliveries(): StoreWebhookDelivery[] {
  const now = Date.now();
  return WEBHOOK_DELIVERIES.map((delivery) => ({
    id: delivery.id,
    endpointId: delivery.endpointId,
    event: delivery.event,
    status: delivery.status,
    attempts: delivery.attempts,
    lastStatusCode: delivery.lastStatusCode,
    lastError: delivery.lastError,
    nextAttemptAt:
      delivery.nextAttemptMinutes === null
        ? null
        : now + delivery.nextAttemptMinutes * 60 * 1000,
    deliveredAt: delivery.status === "delivered" ? now - delivery.createdMinutesAgo * 60 * 1000 : null,
    createdAt: now - delivery.createdMinutesAgo * 60 * 1000,
  }));
}

function seedReceivables(): StoredReceivable[] {
  const now = Date.now();
  return RECEIVABLES.map(({ dueOffsetDays, ...receivable }) => ({
    ...receivable,
    dueDate: now + dueOffsetDays * DAY_MS,
  }));
}

function toReceivableLike(receivable: StoredReceivable): ReceivableLike {
  return {
    amount: receivable.amount,
    paidAmount: receivable.paidAmount,
    dueDate: receivable.dueDate,
    status: receivable.status,
  };
}

/** Melanjutkan penomoran nota piutang dari seed, sama seperti backend `AR-…`. */
function nextReceivableNumber(receivables: StoredReceivable[]): string {
  const max = receivables.reduce((acc, receivable) => {
    const value = Number(receivable.number.replace(/\D/g, ""));
    return Number.isFinite(value) && value > acc ? value : acc;
  }, 0);
  return `AR-${String(max + 1).padStart(5, "0")}`;
}

/** Kategori di mode demo: sama bentuknya dengan baris `categories` di server. */
interface DemoCategoryRow {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

function seedProducts(): StoreProduct[] {
  return PRODUCTS.map((p) => ({
    id: p.id,
    sku: p.id.toUpperCase(),
    name: p.name,
    // Semua produk contoh mulai aktif; mengaktifkan/menonaktifkan dilakukan dari
    // halaman Produk & Stok (`setProductActive`).
    active: true,
    price: p.price,
    // Harga beli contoh: 60% dari harga jual, dibulatkan — dipakai sebagai
    // saran harga di form PO supaya harganya tidak diketik dari nol.
    cost: Math.round(p.price * 0.6),
    category: p.category,
    stock: p.stock,
    unit: p.unit,
    units: p.units,
    tiers: p.tiers,
    modifiers: p.modifiers,
  }));
}

function seedSales(): StoreSale[] {
  return RECENT_SALES.map((s) => ({ ...s, itemCount: s.itemCount }));
}

/**
 * Riwayat penjualan contoh untuk analitik lanjutan (`report.advanced`).
 *
 * Laporan harian hanya butuh hari ini; analitik lanjutan butuh **arah**. Karena
 * itu demo menyemai 60 hari transaksi (periode ini + periode pembandingnya)
 * dari katalog produk asli, tanpa angka acak supaya hasilnya bisa diuji:
 * akhir pekan lebih ramai, jam 12–13 paling padat, dan 30 hari terakhir
 * sengaja lebih ramai dari 30 hari sebelumnya agar trennya punya cerita.
 */
const DEMO_ANALYTICS_DAYS = 30;
const DEMO_BUSY_HOURS = [9, 11, 12, 12, 13, 13, 16, 19, 20];
const DEMO_ANALYTICS_METHODS = ["cash", "qris", "card", "transfer"];

/** Kebalikan dari `PAYMENT_LABEL_BY_METHOD`: label tampilan → kunci kanonik. */
function methodKeyFor(label: string): string {
  const found = Object.entries(PAYMENT_LABEL_BY_METHOD).find(
    ([, value]) => value === label,
  );
  return found ? found[0] : "cash";
}

function seedAnalyticsSales(taxRatePct: number): AnalyticsSaleInput[] {
  const now = Date.now();
  const offset = -new Date().getTimezoneOffset();
  const range = analyticsRange({
    days: DEMO_ANALYTICS_DAYS * 2,
    now,
    timezoneOffsetMinutes: offset,
  });
  const sales: AnalyticsSaleInput[] = [];
  let sequence = 0;

  for (let day = 0; day < range.days; day += 1) {
    const dayStart = range.from + day * DAY_MS;
    const weekday = weekdayOf(dayStart, offset);
    const weekend = weekday === 0 || weekday === 6;
    // Periode ini (30 hari terakhir) satu transaksi lebih ramai per hari.
    const busier = day >= DEMO_ANALYTICS_DAYS ? 1 : 0;
    const transactions = 3 + ((day * 7) % 3) + (weekend ? 2 : 0) + busier;

    for (let t = 0; t < transactions; t += 1) {
      const hour = DEMO_BUSY_HOURS[(day * 2 + t) % DEMO_BUSY_HOURS.length];
      const createdAt = dayStart + (hour * 60 + ((t * 13) % 60)) * 60_000;
      // Jam yang belum lewat hari ini dilewati supaya tidak ada penjualan dari
      // masa depan di grafik "hari ini".
      if (createdAt > now) continue;

      const items: AnalyticsItemInput[] = [];
      let net = 0;
      const picks = 1 + ((day + t) % 3);
      for (let i = 0; i < picks; i += 1) {
        const product = PRODUCTS[(day * 3 + t * 5 + i * 7) % PRODUCTS.length];
        const quantity = 1 + ((day + t + i) % 3);
        const lineNet = product.price * quantity;
        const lineCost = Math.round(product.price * 0.6) * quantity;
        net += lineNet;
        items.push({
          productId: product.id,
          name: product.name,
          category: product.category,
          quantity,
          net: lineNet,
          cost: lineCost,
        });
      }

      const taxed = computeTax(net, taxRatePct);
      sales.push({
        id: `hist-${sequence}`,
        createdAt,
        total: taxed.gross,
        tax: taxed.tax,
        // Baris contoh mewakili penjualan sebelum setelan F&B ada: PPN, tanpa
        // biaya layanan — sama dengan kolom yang kosong di baris penjualan lama.
        taxKind: "ppn",
        serviceCharge: 0,
        method: DEMO_ANALYTICS_METHODS[(day + t) % DEMO_ANALYTICS_METHODS.length],
        items,
      });
      sequence += 1;
    }
  }

  return sales;
}

/**
 * Token QR demo yang **stabil** dan berbentuk sama dengan server (`mj_<32 hex>`).
 *
 * Diturunkan dari id mejanya, bukan dibuat saat tombolnya ditekan: state demo
 * hidup di memori, jadi token yang lahir saat itu akan hilang begitu halaman
 * dimuat ulang — dan kartu QR yang sudah tercetak di meja tamu langsung jadi kode
 * mati. Karakter id-nya diubah ke kode heksanya lebih dulu supaya hasilnya lolos
 * bentuk kanonik yang sama dengan `isMejaMenuToken`.
 */
function demoTableMenuToken(tableId: string): string {
  const hex = Array.from(tableId)
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
  return mejaMenuToken(hex);
}

function seedTables(): StoreTable[] {
  return TABLES.map((t) => ({ ...t, menuToken: demoTableMenuToken(t.id) }));
}

function seedWarehouses(): DemoWarehouse[] {
  return WAREHOUSES.map((warehouse) => ({ ...warehouse }));
}

function seedSuppliers(): DemoSupplier[] {
  return SUPPLIERS.map((supplier) => ({ ...supplier }));
}

/** Dokumen supplier yang tersimpan di demo; totalnya dihitung dari barisnya. */
type StoredInvoice = {
  reference?: string;
  total: number;
  lines: InvoiceLine[];
  note?: string;
  recordedAt: number;
};

/** Hutang demo: jatuh tempo disimpan absolut, hasil dari selisih hari seed. */
type StoredPayable = Omit<DemoPayable, "dueOffsetDays" | "invoice"> & {
  dueDate: number;
  createdAt: number;
  invoice?: StoredInvoice;
  /** Keputusan manusia atas selisih pencocokan (3-way matching). */
  matchDecision?: MatchDecision;
};

function productName(productId: string): string {
  return PRODUCTS.find((product) => product.id === productId)?.name ?? "Produk dihapus";
}

function seedPayables(): StoredPayable[] {
  const now = Date.now();
  return PAYABLES.map(({ dueOffsetDays, invoice, ...payable }) => ({
    ...payable,
    dueDate: now + dueOffsetDays * DAY_MS,
    // Tagihan lama dibuat beberapa hari sebelum jatuh temponya.
    createdAt: now + (dueOffsetDays - payable.paymentTermDays) * DAY_MS,
    invoice: invoice
      ? {
          reference: invoice.reference,
          note: invoice.note,
          lines: invoice.lines.map((line) => ({
            productId: line.productId,
            name: productName(line.productId),
            quantity: line.quantity,
            unitCost: line.unitCost,
          })),
          total: invoice.lines.reduce(
            (sum, line) => sum + line.quantity * line.unitCost,
            0,
          ),
          recordedAt: now - invoice.recordedDaysAgo * DAY_MS,
        }
      : undefined,
  }));
}

/**
 * Riwayat pembayaran hutang contoh.
 *
 * Satu transfer (nomor batch `PAY-00001`) sengaja sudah tercatat: tagihan
 * `AP-00002` memang lahir dengan `paidAmount` 300.000, dan tanpa baris ini
 * angka itu tidak punya jejak di riwayat pembayaran. Sekaligus memberi Dashboard
 * contoh **riwayat bayar sekaligus** tanpa mengubah uang yang sudah ada —
 * pembayarannya sudah termasuk di `paidAmount` tagihan itu.
 */
function seedPayablePayments(): StorePayablePayment[] {
  const now = Date.now();
  const payable = PAYABLES.find((row) => row.id === "ap02");
  if (!payable || payable.paidAmount <= 0) return [];
  return [
    {
      id: "appay01",
      payableId: payable.id,
      payableNumber: payable.number,
      supplierName:
        SUPPLIERS.find((row) => row.id === payable.supplierId)?.name ?? "Supplier dihapus",
      amount: payable.paidAmount,
      method: "Transfer",
      note: "Transfer bank — satu kali bayar",
      batchNumber: "PAY-00001",
      createdAt: now - 6 * DAY_MS,
    },
  ];
}

/** PO contoh: dokumen rujukan pencocokan 3 arah. */
function seedOrders(): DemoOrderState[] {
  const now = Date.now();
  return ORDERS.map((order: DemoOrder) => ({
    id: order.id,
    number: order.number,
    supplierId: order.supplierId,
    status: order.status,
    note: order.note,
    createdAt: now - order.createdDaysAgo * DAY_MS,
    lines: order.lines.map((line) => ({ ...line })),
  }));
}

/** GRN contoh: nilai barang yang benar-benar datang, pembanding tagihan supplier. */
function seedReceipts(): StoreReceipt[] {
  const now = Date.now();
  return RECEIPTS.map((receipt: DemoReceipt) => ({
    id: receipt.id,
    number: receipt.number,
    orderId: receipt.orderId,
    orderNumber: receipt.orderNumber,
    warehouseId: DEFAULT_WAREHOUSE_ID,
    locationName: defaultWarehouse().name,
    note: receipt.note,
    total: receipt.total,
    createdAt: now - receipt.createdDaysAgo * DAY_MS,
    lines: receipt.lines.map((line) => ({
      productId: line.productId,
      name: productName(line.productId),
      quantity: line.quantity,
      unitCost: line.unitCost,
    })),
  }));
}

function toPayableLike(payable: StoredPayable): PayableLike {
  return {
    amount: payable.amount,
    paidAmount: payable.paidAmount,
    dueDate: payable.dueDate,
    status: payable.status as PayableStatus,
  };
}

/** Sesi opname demo: jam mulai disimpan absolut, bukan "berapa jam lalu". */
type StoredOpnameSession = Omit<DemoOpnameSession, "startedHoursAgo"> & {
  createdAt: number;
  postedAt?: number;
  cancelledAt?: number;
};

function seedOpnameSessions(): StoredOpnameSession[] {
  const now = Date.now();
  return OPNAME_SESSIONS.map(({ startedHoursAgo, status, ...session }) => {
    const createdAt = now - startedHoursAgo * 60 * 60 * 1000;
    return {
      ...session,
      status,
      createdAt,
      // Sesi yang sudah selesai juga menyimpan kapan diposting (riwayat).
      postedAt: status === "posted" ? createdAt + 60 * 60 * 1000 : undefined,
    };
  });
}

/**
 * PR contoh disimpan dengan jam absolut (dihitung dari `createdHoursAgo`) supaya
 * demo tidak pernah menampilkan tanggal basi.
 */
interface DemoRequisitionState {
  id: string;
  number: string;
  status: RequisitionStatus;
  note?: string;
  decisionNote?: string;
  createdAt: number;
  lines: { productId: string; quantity: number; note?: string }[];
  orderId?: string;
}

interface DemoOrderState {
  id: string;
  number: string;
  supplierId: string;
  requisitionId?: string;
  status: OrderStatus;
  expectedAt?: number;
  note?: string;
  createdAt: number;
  lines: { productId: string; quantity: number; unitCost: number; receivedQty: number }[];
  receivedAt?: number;
  cancelledAt?: number;
}

function seedRequisitions(): DemoRequisitionState[] {
  const now = Date.now();
  return REQUISITIONS.map((requisition) => ({
    id: requisition.id,
    number: requisition.number,
    status: requisition.status,
    note: requisition.note,
    createdAt: now - requisition.createdHoursAgo * 60 * 60 * 1000,
    lines: requisition.lines.map((line) => ({ ...line })),
  }));
}

/** Nomor dokumen berikutnya dengan skema yang sama seperti backend (`PR-00001`). */
function nextDocumentNumber(prefix: string, existing: string[]): string {
  const max = existing.reduce((acc, number) => {
    const value = Number(number.replace(/\D/g, ""));
    return Number.isFinite(value) && value > acc ? value : acc;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(5, "0")}`;
}

/** Salinan dalam dari seed stok gudang supaya state demo tidak menyentuh data asli. */
function seedWarehouseStock(): Record<string, Record<string, number>> {
  return Object.fromEntries(
    Object.entries(WAREHOUSE_STOCK).map(([productId, byWarehouse]) => [
      productId,
      { ...byWarehouse },
    ]),
  );
}

/** Satu baris pesanan yang sudah dikirim ke dapur (stok belum bergerak). */
interface HeldLine {
  productId: string;
  name: string;
  /** Kuantitas dalam satuan dasar, supaya sama dengan stok dan laporan. */
  quantity: number;
  lineTotal: number;
  /** Label modifier (`pos.modifier`) yang ikut ke layar dapur. */
  modifiers?: string[];
}

interface HeldOrder {
  id: string;
  number: string;
  createdAt: number;
  method: StoreSale["method"];
  tableId?: string;
  /**
   * Sudah termasuk pajak (PPN atau PBJT) **dan** biaya layanan, sama seperti
   * total pada penjualan biasa.
   */
  total: number;
  /** Pajak yang ikut di dalam `total`, dicatat saat pesanannya dikirim ke dapur. */
  tax: number;
  /** Biaya layanan yang ikut di dalam `total` (bukan pajak); 0 kalau tidak ada. */
  serviceCharge?: number;
  lines: HeldLine[];
}

function clockTime(date = new Date()): string {
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Continues the seeded numbering across **both** penjualan selesai dan pesanan
 * yang masih di dapur, supaya nomor struk tidak pernah dipakai dua kali.
 */
function nextReceiptNumber(sales: StoreSale[], held: HeldOrder[] = []): string {
  const numbers = [...sales.map((s) => s.number), ...held.map((h) => h.number)];
  const max = numbers.reduce((acc, number) => {
    const n = Number(number.replace(/\D/g, ""));
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `A-${String(max + 1).padStart(5, "0")}`;
}

function summarise(sales: StoreSale[]): StoreSummary {
  if (sales.length === 0) return EMPTY_SUMMARY;

  let revenue = 0;
  let tax = 0;
  let itemCount = 0;
  const byMethod = { ...EMPTY_SUMMARY.byMethod };

  for (const sale of sales) {
    revenue += sale.total;
    // Pajak yang tercatat di penjualannya dipakai apa adanya; `reverseTax`
    // (tarif bawaan) hanya untuk baris contoh yang belum menyimpannya. Ini yang
    // membuat “PPN terkumpul” ikut setelan workspace: 12% dihitung 12%.
    tax += sale.tax ?? reverseTax(sale.total).tax;
    itemCount += sale.itemCount;
    byMethod[sale.method] += sale.total;
  }

  return {
    revenue,
    tax,
    discount: 0,
    transactions: sales.length,
    itemCount,
    averagePerTransaction: Math.round(revenue / sales.length),
    byMethod,
  };
}

export function DemoStoreProvider({ children }: { children: ReactNode }) {
  const {
    session,
    setVerticals,
    setPlan,
    setTaxSetting,
    setFnbTaxProfile,
    setReceiptSetting,
    setLogoUrl,
    setUserProfile,
    setTenantProfile,
  } = useSession();
  const [products, setProducts] = useState<StoreProduct[]>(seedProducts);
  const [sales, setSales] = useState<StoreSale[]>(seedSales);
  /** Riwayat analitik: penjualan contoh 60 hari + penjualan yang terjadi di sesi ini. */
  const [analyticsSales, setAnalyticsSales] = useState<AnalyticsSaleInput[]>(() =>
    seedAnalyticsSales(DEFAULT_TAX_RATE_PCT),
  );
  const [analyticsDays, setAnalyticsDays] = useState(DEFAULT_ANALYTICS_DAYS);
  const [tables, setTables] = useState<StoreTable[]>(seedTables);
  /**
   * Denah yang dilihat UI: urutannya urutan tersimpan (`sortTablesByOrder`).
   * Denah, pemilih meja di kasir, dan layar dapur membaca urutan yang sama —
   * kalau tidak, "meja berikutnya" bisa berbeda tergantung halamannya.
   */
  const storeTables = useMemo(() => sortTablesByOrder(tables), [tables]);
  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>([]);
  /** Pesanan QR meja (modul F&B): tagihan dulu, penjualan menyusul. */
  const [mejaOrderRecords, setMejaOrderRecords] = useState<DemoMejaOrderRecord[]>([]);
  const [categoryRows, setCategoryRows] = useState<DemoCategoryRow[]>(seedCategories);
  const [customers, setCustomers] = useState<DemoCustomer[]>(seedCustomers);
  const [members, setMembers] = useState<DemoMember[]>(seedMembers);
  /** Peran kustom + anggota tim (`rbac.custom`, Phase 4). */
  const [customRoles, setCustomRoles] = useState<DemoCustomRole[]>(CUSTOM_ROLES);
  const [teamMembers, setTeamMembers] = useState<DemoTeamMember[]>(TEAM_MEMBERS);
  /** Kunci API + webhook keluar (`api.access`, Phase 4). */
  const [apiKeys, setApiKeys] = useState<DemoApiKeyRecord[]>(seedApiKeys);
  const [webhookEndpoints, setWebhookEndpoints] = useState<DemoWebhookEndpointRecord[]>(
    seedWebhookEndpoints,
  );
  const [webhookDeliveries, setWebhookDeliveries] = useState<StoreWebhookDelivery[]>(
    seedWebhookDeliveries,
  );
  /**
   * Cermin state untuk aksi `api.access` (Phase 4). Sama alasannya dengan
   * cermin piutang di atas: membuat kunci lalu langsung memakainya, atau
   * mendaftarkan endpoint lalu langsung mengirim uji, harus melihat hasil aksi
   * sebelumnya — bukan snapshot render terakhir. Tanpa cermin ini, pemeriksaan
   * “nama kunci/URL sudah dipakai” dan “endpoint hanya boleh dikirim sekali”
   * akan lolos pada panggilan kedua dalam satu tick.
   */
  const apiKeysRef = useRef(apiKeys);
  const webhookEndpointsRef = useRef(webhookEndpoints);
  const webhookDeliveriesRef = useRef(webhookDeliveries);

  const commitApiKeys = useCallback((next: DemoApiKeyRecord[]) => {
    apiKeysRef.current = next;
    setApiKeys(next);
  }, []);
  const commitWebhookEndpoints = useCallback((next: DemoWebhookEndpointRecord[]) => {
    webhookEndpointsRef.current = next;
    setWebhookEndpoints(next);
  }, []);
  const commitWebhookDeliveries = useCallback((next: StoreWebhookDelivery[]) => {
    webhookDeliveriesRef.current = next;
    setWebhookDeliveries(next);
  }, []);
  /** Tiket dukungan (`support.dedicated`, Phase 5). */
  const [supportTickets, setSupportTickets] = useState<DemoTicketRecord[]>(seedSupportTickets);
  /**
   * Cermin state tiket: menambah catatan lalu langsung menutup tiket dalam satu
   * tick harus melihat hasil aksi pertama. Tanpa cermin ini, aturan "riwayat
   * penuh" dan "status sudah selesai" akan dibaca dari snapshot render terakhir.
   */
  const supportTicketsRef = useRef(supportTickets);
  const commitSupportTickets = useCallback((next: DemoTicketRecord[]) => {
    supportTicketsRef.current = next;
    setSupportTickets(next);
  }, []);
  /** Urutan nomor tiket demo, melanjutkan nomor contoh yang sudah ada. */
  const ticketSequenceRef = useRef(SUPPORT_TICKETS.length);
  /** Tagihan pembayaran digital (`payment.digital`, Phase 6). */
  const [digitalCharges, setDigitalCharges] = useState<DemoChargeRecord[]>(seedDigitalCharges);
  /**
   * Cermin state tagihan: melunasi lalu membatalkan dalam satu tick harus melihat
   * hasil aksi pertama — aturan transisi membaca status dari snapshot terakhir
   * kalau cermin ini tidak ada.
   */
  const digitalChargesRef = useRef(digitalCharges);
  const commitDigitalCharges = useCallback((next: DemoChargeRecord[]) => {
    digitalChargesRef.current = next;
    setDigitalCharges(next);
  }, []);
  /** Urutan nomor tagihan demo, melanjutkan nomor contoh yang sudah ada. */
  const chargeSequenceRef = useRef(DIGITAL_CHARGES.length);
  /**
   * Cermin state pesanan QR: pelunasan tagihan harus melihat pesanan yang baru
   * dibuat di tick yang sama, sama seperti server yang membaca barisnya dari DB.
   */
  const mejaOrdersRef = useRef(mejaOrderRecords);
  const commitMejaOrders = useCallback((next: DemoMejaOrderRecord[]) => {
    mejaOrdersRef.current = next;
    setMejaOrderRecords(next);
  }, []);
  /** Hub sinkronisasi real-time (`sync.realtime`, Phase 6). */
  const [syncDevices, setSyncDevices] = useState<DemoSyncDeviceRecord[]>(seedSyncDevices);
  const syncDevicesRef = useRef(syncDevices);
  const commitSyncDevices = useCallback((next: DemoSyncDeviceRecord[]) => {
    syncDevicesRef.current = next;
    setSyncDevices(next);
  }, []);
  const [syncChanges, setSyncChanges] = useState<DemoSyncChangeRecord[]>(seedSyncChanges);
  const syncChangesRef = useRef(syncChanges);
  const commitSyncChanges = useCallback((next: DemoSyncChangeRecord[]) => {
    syncChangesRef.current = next;
    setSyncChanges(next);
  }, []);
  const [receivables, setReceivables] = useState<StoredReceivable[]>(seedReceivables);
  const [warehouses, setWarehouses] = useState<DemoWarehouse[]>(seedWarehouses);
  const [warehouseStock, setWarehouseStock] = useState<Record<string, Record<string, number>>>(
    seedWarehouseStock,
  );
  const [transfers, setTransfers] = useState<StoreTransfer[]>([]);
  const [opnameSessions, setOpnameSessions] = useState<StoredOpnameSession[]>(seedOpnameSessions);
  const [suppliers, setSuppliers] = useState<DemoSupplier[]>(seedSuppliers);
  const [requisitions, setRequisitions] = useState<DemoRequisitionState[]>(seedRequisitions);
  const [orders, setOrders] = useState<DemoOrderState[]>(seedOrders);
  const [receipts, setReceipts] = useState<StoreReceipt[]>(seedReceipts);
  const [payables, setPayables] = useState<StoredPayable[]>(seedPayables);
  const [payablePayments, setPayablePayments] = useState<StorePayablePayment[]>(
    seedPayablePayments,
  );
  /**
   * Cermin state piutang. Dua aksi piutang dalam satu tick (mis. kasir
   * menekan "Catat pembayaran" dua kali cepat) harus melihat hasil aksi
   * sebelumnya, bukan snapshot render terakhir — kalau tidak, pelunasan kedua
   * dihitung dari sisa piutang yang sudah basi.
   */
  const receivablesRef = useRef(receivables);

  const commitReceivables = useCallback((next: StoredReceivable[]) => {
    receivablesRef.current = next;
    setReceivables(next);
  }, []);

  /**
   * Cermin state untuk aksi yang bisa berjalan berurutan dalam satu tick.
   *
   * Perpindahan stok (Phase 3) membuat ini wajib: memindahkan stok dua kali
   * berturut-turut sebelum React merender ulang harus menghitung dari hasil
   * perpindahan pertama, bukan dari snapshot render terakhir — kalau tidak,
   * stok sumber terlihat masih penuh dan penolakannya menyebut angka yang salah
   * (bug yang tertangkap harness render).
   */
  const productsRef = useRef(products);
  /** Urutan produk demo yang dibuat pengguna, supaya id tidak bertabrakan. */
  const productSequenceRef = useRef(0);
  /** Urutan gambar yang diunggah ke produk demo, supaya id-nya tidak bertabrakan. */
  const productImageSequenceRef = useRef(0);
  const warehousesRef = useRef(warehouses);
  const warehouseStockRef = useRef(warehouseStock);
  const transfersRef = useRef(transfers);
  const suppliersRef = useRef(suppliers);
  const requisitionsRef = useRef(requisitions);
  const ordersRef = useRef(orders);
  const receiptsRef = useRef(receipts);
  /**
   * Cermin state hutang. Dua pembayaran dalam satu tick harus melihat hasil
   * pembayaran pertama, bukan snapshot render terakhir — kalau tidak, pelunasan
   * kedua dihitung dari sisa hutang yang sudah basi (bug yang pernah terjadi di
   * piutang, jadi tidak diulang di sini).
   */
  const payablesRef = useRef(payables);

  const updatePayables = useCallback((updater: (current: StoredPayable[]) => StoredPayable[]) => {
    const next = updater(payablesRef.current);
    payablesRef.current = next;
    setPayables(next);
  }, []);

  /**
   * Cermin state sesi opname. Menulis dua baris hitung berturut-turut dalam satu
   * tick harus melihat hasil tulisan pertama, bukan snapshot render terakhir.
   */
  const opnameRef = useRef(opnameSessions);

  const updateOpname = useCallback(
    (updater: (current: StoredOpnameSession[]) => StoredOpnameSession[]) => {
      const next = updater(opnameRef.current);
      opnameRef.current = next;
      setOpnameSessions(next);
    },
    [],
  );

  const updateProducts = useCallback(
    (updater: (current: StoreProduct[]) => StoreProduct[]) => {
      const next = updater(productsRef.current);
      productsRef.current = next;
      setProducts(next);
    },
    [],
  );

  const updateWarehouses = useCallback(
    (updater: (current: DemoWarehouse[]) => DemoWarehouse[]) => {
      const next = updater(warehousesRef.current);
      warehousesRef.current = next;
      setWarehouses(next);
    },
    [],
  );

  const updateWarehouseStock = useCallback(
    (
      updater: (
        current: Record<string, Record<string, number>>,
      ) => Record<string, Record<string, number>>,
    ) => {
      const next = updater(warehouseStockRef.current);
      warehouseStockRef.current = next;
      setWarehouseStock(next);
    },
    [],
  );

  const updateTransfers = useCallback(
    (updater: (current: StoreTransfer[]) => StoreTransfer[]) => {
      const next = updater(transfersRef.current);
      transfersRef.current = next;
      setTransfers(next);
    },
    [],
  );

  const updateSuppliers = useCallback(
    (updater: (current: DemoSupplier[]) => DemoSupplier[]) => {
      const next = updater(suppliersRef.current);
      suppliersRef.current = next;
      setSuppliers(next);
    },
    [],
  );

  const updateRequisitions = useCallback(
    (updater: (current: DemoRequisitionState[]) => DemoRequisitionState[]) => {
      const next = updater(requisitionsRef.current);
      requisitionsRef.current = next;
      setRequisitions(next);
    },
    [],
  );

  const updateOrders = useCallback(
    (updater: (current: DemoOrderState[]) => DemoOrderState[]) => {
      const next = updater(ordersRef.current);
      ordersRef.current = next;
      setOrders(next);
    },
    [],
  );

  const updateReceipts = useCallback(
    (updater: (current: StoreReceipt[]) => StoreReceipt[]) => {
      const next = updater(receiptsRef.current);
      receiptsRef.current = next;
      setReceipts(next);
    },
    [],
  );

  const summary = useMemo(() => summarise(sales), [sales]);

  /**
   * Katalog penjualan: hanya produk **aktif** — sama seperti `products.listByStore`
   * di server. Produk nonaktif tetap ada di `catalogProducts` supaya halaman Produk
   * & Stok bisa menampilkannya, mengaktifkannya kembali, atau menghapusnya.
   */
  const productsForSale: StoreProduct[] = useMemo(
    () => products.filter((product) => product.active !== false),
    [products],
  );

  /**
   * Kategori katalog (`category.manage`).
   *
   * State-nya sendiri, bukan turunan katalog: kategori kosong tetap bisa diatur
   * (ditambah lebih dulu, dinonaktifkan, lalu dihapus) — sama seperti di server,
   * di mana kategori hidup sebagai baris tersendiri.
   */
  const categories: StoreCategory[] = useMemo(
    () =>
      categoryRows.map((row) => ({
        id: row.id,
        name: row.name,
        active: categoryIsActive(row),
        productCount: products.filter(
          (product) => categoryNameKey(product.category) === categoryNameKey(row.name),
        ).length,
      })),
    [categoryRows, products],
  );

  // Modul plug-in: demo membaca pilihan dari sesi, memakai aturan paket yang
  // sama dengan backend sehingga perilakunya identik tanpa server.
  const planKey = session?.tenant?.planKey ?? "starter";
  const activeVerticals = useMemo<Vertical[]>(
    () =>
      session?.tenant
        ? (session.tenant.verticals ?? [session.tenant.vertical])
        : ["umkm"],
    [session],
  );

  /**
   * Gerbang fitur modul dengan pesan yang **sama persis** seperti yang akan
   * dikeluarkan server, supaya demo tidak menjanjikan sesuatu yang ditolak
   * backend (lihat `requireFeature` di src/convex/lib/access.ts).
   */
  const requireModuleFeature = useCallback(
    (feature: FeatureKey) => {
      if (isFeatureEnabled(entitlementFor(planKey), activeVerticals, feature)) return;
      const owner = featureOwner(feature);
      if (owner) {
        throw new Error(
          `Fitur ${FEATURE_LABELS[feature]} memerlukan modul ${VERTICAL_LABELS[owner]} yang belum aktif.`,
        );
      }
      throw new Error(`Fitur ${FEATURE_LABELS[feature]} tidak termasuk paket ${planKey}.`);
    },
    [planKey, activeVerticals],
  );

  /** Aturan "satu meja satu pesanan terbuka", dipakai demo dan server. */
  const requireFreeTable = useCallback(
    (tableId: string | undefined) => {
      if (!tableId) return;
      requireModuleFeature("pos.table");
      const seat = seatTable(
        tables,
        heldOrders.map((order) => ({
          id: order.id,
          number: order.number,
          createdAt: order.createdAt,
          tableId: order.tableId,
        })),
        tableId,
      );
      if (!seat.ok) throw new Error(seat.reason);
    },
    [heldOrders, requireModuleFeature, tables],
  );

  /**
   * Harga satu baris keranjang: konversi satuan + tier (aturan grosir) lalu
   * tambahan modifier per unit (aturan F&B). Satu perhitungan untuk demo dan
   * server, jadi angka di layar kasir tidak pernah berbeda dari yang dicatat.
   */
  const priceCartLine = useCallback(
    (item: CartItemInput) => {
      const product = products.find((p) => p.id === item.productId);
      if (!product) throw new Error("Produk tidak valid untuk tenant ini.");

      // Produk nonaktif tidak dijual: sama seperti server, yang menolaknya walau
      // id-nya dikirim langsung (kasir sendiri tidak lagi menawarkannya).
      if (product.active === false) {
        throw new Error(
          `Produk ${product.name} sedang nonaktif; aktifkan dulu di halaman Produk & Stok kalau memang masih dijual.`,
        );
      }

      // Produk bermodifier ditolak saat modul F&B mati — sama seperti server —
      // supaya pilihan pelanggan tidak hilang diam-diam.
      if (hasModifiers(product)) requireModuleFeature("pos.modifier");

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

      const modifiers = applyModifiers(product, item.modifiers ?? []);
      if (!modifiers.ok) throw new Error(modifiers.reason);

      return {
        product,
        baseQty: priced.baseQty,
        lineTotal: lineTotalWithModifiers(
          priced.lineTotal,
          item.quantity,
          modifiers.surcharge,
        ),
        modifierLabels: modifiers.labels,
      };
    },
    [products, requireModuleFeature],
  );

  /**
   * Setelan PPN tenant demo: kolom yang sama dengan `tenants.taxActive` &
   * `tenants.taxRatePct`. Sesi lama yang belum punya kolom ini dibaca sebagai
   * “aktif 11%” oleh `taxSettingOf` — aturan yang sama dengan server.
   */
  const tax = useMemo<TaxSetting>(
    () =>
      taxSettingOf({
        taxActive: session?.tenant?.taxActive,
        taxRatePct: session?.tenant?.taxRatePct ?? DEFAULT_TAX_RATE_PCT,
      }),
    [session],
  );

  /**
   * Tarif yang benar-benar dipungut (nol saat dimatikan). Dipakai pratinjau kasir
   * dan setiap penjualan yang dicatat store ini supaya keduanya tidak pernah
   * berbeda — sama seperti `pos.createSale` di server.
   */
  const taxRatePct = effectiveTaxRatePct(tax);

  /**
   * Menyimpan setelan PPN. Validasi & kalimatnya memakai aturan murni
   * `@/lib/tax`, jadi pesan yang dilihat pemilik toko di mode demo sama persis
   * dengan yang akan datang dari `tenants.updateTax`.
   */
  const setTax = useCallback(
    async (input: UpdateTaxInput): Promise<UpdatedTax> => {
      const decision = validateTaxRatePct(input.ratePct, { active: input.active });
      if (!decision.ok) throw new Error(decision.reason);

      const after: TaxSetting = { active: input.active, ratePct: decision.value };
      const changed = !sameTaxSetting(tax, after);
      if (changed) setTaxSetting(after.active, after.ratePct);

      return { ...after, changed, sentence: taxSettingSentence(after) };
    },
    [tax, setTaxSetting],
  );

  /**
   * Pajak & pungutan F&B workspace: kolom `tenants.fnbTaxProfile` yang sama
   * dengan server. Workspace yang belum menyimpannya dibaca sebagai bawaan
   * (belum ada pungutan F&B), jadi perilaku lamanya tidak berubah.
   */
  const fnbTax = useMemo<FnbTaxProfile>(
    () => fnbTaxProfileOf(session?.tenant?.fnbTaxProfile ?? DEFAULT_FNB_TAX_PROFILE),
    [session],
  );

  /**
   * Menyimpan profil pajak F&B. Validasi & kalimatnya memakai aturan murni
   * `@/lib/fnbTax`, jadi pesan yang dilihat pemilik toko di mode demo sama persis
   * dengan yang datang dari `tenants.updateFnbTax` di server.
   */
  const setFnbTax = useCallback(
    async (input: UpdateFnbTaxInput): Promise<UpdatedFnbTax> => {
      const decision = validateFnbTaxProfile(input);
      if (!decision.ok) throw new Error(decision.reason);

      const after = decision.value;
      const changed = !sameFnbTaxProfile(fnbTax, after);
      if (changed) setFnbTaxProfile(after);

      return { changed, profile: after, sentence: fnbTaxProfileSentence(after) };
    },
    [fnbTax, setFnbTaxProfile],
  );

  /**
   * Setelan struk belanja: kolom `tenants.receipt` yang sama dengan server.
   * Workspace yang belum menyimpannya dibaca sebagai bawaan (thermal 80 mm, satu
   * lembar), jadi struknya tidak berubah dengan sendirinya.
   */
  const receipt = useMemo<ReceiptSetting>(
    () => receiptSettingOf(session?.tenant?.receipt ?? DEFAULT_RECEIPT_SETTING),
    [session],
  );

  /**
   * Menyimpan setelan struk. Validasi & kalimatnya memakai aturan murni
   * `@/lib/struk`, jadi pesan yang dilihat pemilik toko di mode demo sama persis
   * dengan yang datang dari `tenants.updateReceipt` di server (termasuk penolakan
   * rangkap di printer yang tidak bisa tembusan karbon).
   */
  const setReceipt = useCallback(
    async (input: UpdateReceiptInput): Promise<UpdatedReceipt> => {
      const decision = validateReceiptSetting(input);
      if (!decision.ok) throw new Error(decision.reason);

      const after = decision.value;
      const changed = !sameReceiptSetting(receipt, after);
      if (changed) setReceiptSetting(after);

      return { changed, setting: after, sentence: receiptSettingSentence(after) };
    },
    [receipt, setReceiptSetting],
  );

  /**
   * Logo toko (kolom `tenants.logo` di server). Mode demo tidak punya penyimpanan
   * berkas, jadi logonya hidup sebagai data URL di sesi — rumah yang sama dengan
   * setelan struk, sehingga logo yang dipasang pemilik toko masih ada di struk
   * setelah halaman dimuat ulang.
   */
  const logo = useMemo<StoreLogo | null>(() => {
    const url = session?.tenant?.logoUrl ?? null;
    return url ? { id: "logo-toko", url } : null;
  }, [session]);

  /**
   * Memasang logo toko. Batasnya diperiksa dengan aturan murni yang sama dengan
   * `tenants.setLogo` di server (tipe berkas, maksimal 1 MB), jadi berkas yang
   * ditolak di demo akan ditolak juga di mode Convex.
   */
  const setLogo = useCallback(
    async (file: Blob): Promise<void> => {
      const valid = validateTenantLogo({ contentType: file.type, size: file.size });
      if (!valid.ok) throw new Error(valid.reason);
      setLogoUrl(await readImageAsDataUrl(file));
    },
    [setLogoUrl],
  );

  const removeLogo = useCallback(async (): Promise<void> => {
    setLogoUrl(null);
  }, [setLogoUrl]);

  /**
   * Profil pengguna aktif: nama & nomor WA di sesi perangkat. Di mode demo inilah
   * satu-satunya tempat profil itu hidup (di mode Convex ia dibaca dari baris
   * `users`), dan emailnya datang dari sesi karena loginnya memakai kode OTP ke
   * email itu.
   */
  const myProfile = useMemo<StoreUserProfile>(
    () => ({
      name: session?.user.name ?? "",
      whatsapp: session?.user.whatsapp ?? null,
    }),
    [session],
  );

  /**
   * Menyimpan profil pengguna. Validasi & kalimatnya memakai aturan murni
   * `@/lib/profile`, jadi pesan yang dilihat pemakai di mode demo sama persis
   * dengan yang datang dari `users.updateProfile` di server.
   */
  const setMyProfile = useCallback(
    async (input: UpdateUserProfileInput): Promise<UpdatedUserProfile> => {
      // Bentuk aturan murni memakai nama kolomnya di server (`phone`), store
      // memakai nama yang dibaca halaman (`whatsapp`); penerjemahannya di sini
      // saja supaya aturannya tidak perlu tahu dua nama untuk satu kolom.
      const before = { name: myProfile.name, phone: myProfile.whatsapp };
      const decision = applyUserProfileDraft(before, {
        name: input.name,
        phone: input.whatsapp,
      });
      if (!decision.ok) throw new Error(decision.reason);

      const after = decision.value;
      const changed = !sameUserProfile(before, after);
      if (changed) setUserProfile({ name: after.name, whatsapp: after.phone });

      return { name: after.name, whatsapp: after.phone, changed, sentence: userProfileSentence(after) };
    },
    [myProfile, setUserProfile],
  );

  /**
   * Identitas usaha: nama, alamat, email, dan nomor WA dari baris tenant di sesi.
   * Kolom yang belum pernah diisi dibaca sebagai `null` — sama seperti kolomnya
   * di server — jadi lencana “belum lengkap” di halaman Profil menghitung hal yang
   * sama di kedua mode store.
   */
  const tenantProfile = useMemo<StoreTenantProfile>(
    () => ({
      name: session?.tenant?.name ?? "",
      address: session?.tenant?.address ?? null,
      email: session?.tenant?.email ?? null,
      whatsapp: session?.tenant?.whatsapp ?? null,
    }),
    [session],
  );

  /**
   * Menyimpan identitas usaha. Aturan murni yang sama dengan
   * `tenants.updateProfile`: nama 2–60 karakter, alamat maksimal 160, email
   * divalidasi seperti pengiriman kode, dan nomor WA dinormalkan ke bentuk
   * `wa.me`. Yang kosong disimpan sebagai “belum diisi”, bukan string kosong.
   */
  const setTenantProfileValue = useCallback(
    async (input: UpdateTenantProfileInput): Promise<UpdatedTenantProfile> => {
      const before = {
        name: tenantProfile.name,
        address: tenantProfile.address,
        email: tenantProfile.email,
        phone: tenantProfile.whatsapp,
      };
      const decision = applyTenantProfileDraft(before, {
        name: input.name,
        address: input.address,
        email: input.email,
        phone: input.whatsapp,
      });
      if (!decision.ok) throw new Error(decision.reason);

      const after = decision.value;
      const changed = !sameTenantProfile(before, after);
      if (changed) {
        setTenantProfile({
          name: after.name,
          address: after.address,
          email: after.email,
          whatsapp: after.phone,
        });
      }

      return {
        name: after.name,
        address: after.address,
        email: after.email,
        whatsapp: after.phone,
        changed,
        sentence: tenantProfileSentence(after),
      };
    },
    [tenantProfile, setTenantProfile],
  );

  /**
   * Laporan pajak & pungutan F&B per bulan (12 bulan terakhir, tertua dulu).
   *
   * Demo menghitungnya dari riwayat analitik (60 hari penjualan contoh +
   * penjualan yang terjadi di sesi ini) dengan aturan murni yang sama dengan
   * server — jadi angka di halaman Laporan dan di halaman Pengaturan tidak
   * berbeda antara dua mode store. Baris contoh dibaca sebagai penjualan PPN
   * (itulah yang berlaku saat barisnya “ditulis”), sedangkan penjualan demo yang
   * baru membawa sendiri jenis pajak & biaya layanannya.
   */
  const fnbTaxMonths = useMemo<StoreFnbTaxMonth[]>(() => {
    const months = recentMonthWindows(FNB_TAX_REPORT_MONTHS);
    return monthlyTaxRows({
      sales: analyticsSales.map((sale) => ({
        createdAt: sale.createdAt,
        total: sale.total,
        tax: sale.tax,
        taxKind: sale.taxKind,
        serviceCharge: sale.serviceCharge,
      })),
      months,
    });
  }, [analyticsSales]);

  /**
   * Ringkasan bulan berjalan — bulan terakhir dari laporan di atas, memakai
   * penurunan yang sama dengan mode server (`fnbCurrentMonthSummary`), jadi
   * ringkasan setoran di halaman Pengaturan dan tabel di halaman Laporan tidak
   * pernah memakai dua angka berbeda.
   */
  const fnbTaxMonth = useMemo<StoreFnbTaxMonthSummary>(
    () => fnbCurrentMonthSummary(fnbTaxMonths),
    [fnbTaxMonths],
  );

  /**
   * Diskon satu transaksi: diskon member + diskon manual digabung aturan murni
   * `@/lib/loyalty` — aturan yang sama dengan `pos.createSale`. Member nonaktif
   * ditolak di sini juga, supaya demo tidak menjanjikan diskon yang akan ditolak
   * server.
   */
  const memberBreakdown = useCallback(
    (memberId: string | undefined, subtotal: number, manualDiscount: number) => {
      const member = memberId
        ? members.find((row) => row.id === memberId)
        : undefined;
      if (member && !member.active) {
        throw new Error(
          `Member ${member.name} tidak aktif; aktifkan dulu di halaman Member kalau memang masih berlangganan.`,
        );
      }
      if (member && member.discountPct > 0) requireModuleFeature("member.discount");

      return discountBreakdown({
        subtotal,
        manualDiscount,
        member: member
          ? { name: member.name, discountPct: member.discountPct }
          : null,
      });
    },
    [members, requireModuleFeature],
  );

  /** The optimistic local commit — this is what the cashier sees immediately. */
  const applySale = useCallback(
    (input: CreateSaleInput): { number: string; total: number; memberDiscount: number } => {
      if (input.items.length === 0) throw new Error("Keranjang kosong.");
      requireFreeTable(input.tableId);

      const lines = input.items.map(priceCartLine);

      const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
      const breakdown = memberBreakdown(input.memberId, subtotal, input.discount);
      // Pajak yang dipungut ditentukan aturan murni `@/lib/fnbTax`: PBJT (pajak
      // daerah) **menggantikan** PPN untuk makanan/minuman yang disajikan
      // langsung, dan biaya layanan berdiri sebagai barisnya sendiri. Angka yang
      // sama dengan yang dicatat `pos.createSale` di server.
      const totals = fnbOrderTotal({ net: breakdown.net, ppn: tax, fnb: fnbTax });
      const taxed = {
        net: totals.net,
        tax: totals.tax,
        gross: totals.total,
        ratePct: totals.plan.ratePct,
      };
      const number = nextReceiptNumber(sales, heldOrders);

      // Penjualan tempo (`ar.creditlimit`, modul Grosir): sisa yang belum dibayar
      // menjadi piutang pelanggan. Aturan dan pesannya sama persis dengan
      // `pos.createSale` di backend, jadi demo tidak menjanjikan hal yang akan
      // ditolak server.
      // Tagihan digital yang menanggung penjualan ini (`payment.digital`):
      // diperiksa dengan aturan yang sama seperti `pos.createSale` di server —
      // harus sudah lunas dan bernominal sama dengan total penjualannya.
      let linkedCharge: DemoChargeRecord | null = null;
      if (input.digitalChargeId) {
        const candidate = digitalChargesRef.current.find(
          (row) => row.id === input.digitalChargeId,
        );
        if (!candidate) {
          throw new Error("Tagihan pembayaran tidak ditemukan untuk tenant ini.");
        }
        const charge = checkSaleAgainstCharge(chargeLikeFrom(candidate), {
          saleTotal: taxed.gross,
          saleMethod: methodKeyFor(input.method),
          now: Date.now(),
        });
        if (!charge.ok) throw new Error(charge.reason);
        linkedCharge = candidate;
      }

      const credit = creditFromPayment(taxed.gross, input.paidAmount ?? taxed.gross);
      if (credit > 0) {
        requireModuleFeature("ar.creditlimit");
        const customer = customers.find((row) => row.id === input.customerId);
        if (!customer) {
          throw new Error(
            `Sisa tagihan ${rupiah(credit)} butuh pelanggan B2B; pilih pelanggannya dulu.`,
          );
        }
        const current = receivablesRef.current;
        const decision = decideCredit({
          customer: {
            name: customer.name,
            creditLimit: customer.creditLimit,
            active: customer.active,
          },
          receivables: current
            .filter((row) => row.customerId === customer.id)
            .map(toReceivableLike),
          newDebt: credit,
        });
        if (!decision.ok) throw new Error(decision.reason);

        const now = Date.now();
        commitReceivables([
          ...current,
          {
            id: `ar-${now}`,
            number: nextReceivableNumber(current),
            customerId: customer.id,
            saleNumber: number,
            amount: credit,
            paidAmount: 0,
            dueDate: dueDateFrom(now, customer.paymentTermDays),
            status: "open",
          },
        ]);
      }

      updateProducts((current) =>
        current.map((product) => {
          const line = lines.find((l) => l.product.id === product.id);
          return line ? { ...product, stock: product.stock - line.baseQty } : product;
        }),
      );

      const saleId = `sale-${Date.now()}`;

      // Tagihannya menunjuk balik ke nota ini, sama seperti `pos.createSale`.
      if (linkedCharge) {
        commitDigitalCharges(
          digitalChargesRef.current.map((row) =>
            row.id === linkedCharge.id ? { ...row, saleId, saleNumber: number } : row,
          ),
        );
      }

      setSales((current) => [
        {
          id: saleId,
          number,
          at: clockTime(),
          method: input.method,
          // Item dihitung dalam satuan dasar supaya laporan sebanding dengan stok.
          itemCount: lines.reduce((sum, line) => sum + line.baseQty, 0),
          total: taxed.gross,
          tax: taxed.tax,
          // Baris “bukan pajak” dicatat terpisah di struk, sama seperti kolom
          // `sales.serviceCharge` di server.
          serviceCharge: totals.serviceCharge,
        },
        ...current,
      ]);

      // Analitik lanjutan ikut hidup di demo: setiap penjualan menambah satu
      // baris riwayat lengkap dengan harga pokok barisnya, sehingga laporan
      // ikut berubah begitu kasir menjual — sama seperti di server.
      const soldAt = Date.now();
      setAnalyticsSales((current) => [
        ...current,
        {
          id: `hist-live-${soldAt}`,
          createdAt: soldAt,
          total: taxed.gross,
          tax: taxed.tax,
          // Jenis pajak & biaya layanan ikut dicatat supaya laporan pajak di
          // halaman Laporan menjumlahkan yang benar-benar dipungut penjualan itu.
          taxKind: totals.plan.kind,
          serviceCharge: totals.serviceCharge,
          discount: breakdown.totalDiscount,
          method: methodKeyFor(input.method),
          items: lines.map((line) => ({
            productId: line.product.id,
            name: line.product.name,
            category: line.product.category,
            quantity: line.baseQty,
            net: line.lineTotal,
            cost: line.product.cost * line.baseQty,
          })),
        },
      ]);

      return {
        number,
        total: taxed.gross,
        memberDiscount: breakdown.memberDiscount,
      };
    },
    [
      products,
      sales,
      heldOrders,
      customers,
      memberBreakdown,
      commitReceivables,
      commitDigitalCharges,
      requireFreeTable,
      requireModuleFeature,
      priceCartLine,
      taxRatePct,
      tax,
      fnbTax,
    ],
  );

  /** Resolusi baris pesanan dapur: harga dari aturan yang sama dengan server. */
  const resolveHeldLines = useCallback(
    (items: HoldSaleInput["items"]) => {
      if (items.length === 0) throw new Error("Keranjang kosong.");
      return items.map((item) => {
        const line = priceCartLine(item);
        return {
          productId: line.product.id,
          name: line.product.name,
          quantity: line.baseQty,
          lineTotal: line.lineTotal,
          modifiers:
            line.modifierLabels.length > 0 ? line.modifierLabels : undefined,
        };
      });
    },
    [priceCartLine],
  );

  /**
   * Kirim pesanan ke dapur. Stok **belum** bergerak di sini — itu yang membuat
   * pesanan tertahan berbeda dari penjualan biasa.
   */
  const holdSale = useCallback(
    async (input: HoldSaleInput): Promise<{ number: string | null; total: number }> => {
      requireModuleFeature("pos.kds");
      requireFreeTable(input.tableId);

      const lines = resolveHeldLines(input.items);
      const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
      const breakdown = memberBreakdown(input.memberId, subtotal, input.discount);
      // Pesanan tertahan belum dibayar, tapi total yang dilihat dapur memakai
      // aturan pajak & biaya layanan yang sama dengan penjualan biasa.
      const taxed = fnbOrderTotal({ net: breakdown.net, ppn: tax, fnb: fnbTax });
      const number = nextReceiptNumber(sales, heldOrders);
      const now = Date.now();

      setHeldOrders((current) => [
        ...current,
        {
          id: `held-${now}`,
          number,
          createdAt: now,
          method: input.method,
          tableId: input.tableId,
          total: taxed.total,
          tax: taxed.tax,
          serviceCharge: taxed.serviceCharge,
          lines: lines.map((line) => ({
            productId: line.productId,
            name: line.name,
            quantity: line.quantity,
            lineTotal: line.lineTotal,
            modifiers: line.modifiers,
          })),
        },
      ]);

      return { number, total: taxed.total };
    },
    [
      requireModuleFeature,
      requireFreeTable,
      resolveHeldLines,
      taxRatePct,
      tax,
      fnbTax,
      memberBreakdown,
      sales,
      heldOrders,
    ],
  );

  /**
   * Selesaikan pesanan dapur: stok bergerak di sini (sama seperti backend yang
   * mengurangi stok saat `finalizeHeldSale`), lalu mejanya kembali kosong karena
   * status meja diturunkan dari pesanan terbuka.
   */
  const completeHeld = useCallback(
    async (saleId: string): Promise<void> => {
      const order = heldOrders.find((o) => o.id === saleId);
      if (!order) throw new Error("Pesanan dapur tidak ditemukan.");

      for (const line of order.lines) {
        const product = products.find((p) => p.id === line.productId);
        if (!product) continue;
        if (product.stock < line.quantity) {
          throw new Error(
            `Stok tidak cukup untuk produk ${product.name} (tersedia ${product.stock}).`,
          );
        }
      }

      updateProducts((current) =>
        current.map((product) => {
          const line = order.lines.find((l) => l.productId === product.id);
          return line
            ? { ...product, stock: product.stock - line.quantity }
            : product;
        }),
      );
      setSales((current) => [
        {
          id: `sale-${Date.now()}`,
          number: order.number,
          at: clockTime(),
          method: order.method,
          itemCount: order.lines.reduce((sum, line) => sum + line.quantity, 0),
          total: order.total,
          tax: order.tax,
        },
        ...current,
      ]);
      setHeldOrders((current) => current.filter((o) => o.id !== saleId));
    },
    [heldOrders, products],
  );

  /** Tambah meja ke denah (modul F&B + aturan validasi yang sama dengan server). */
  const createTable = useCallback(
    async (input: CreateTableInput): Promise<void> => {
      requireModuleFeature("pos.table");
      const parsed = resolveTableInput(input);
      if (!parsed.ok) throw new Error(parsed.reason ?? "Data meja tidak valid.");
      if (tableNameTaken(tables, parsed.name)) {
        throw new Error(`Meja ${parsed.name} sudah ada di denah ini.`);
      }
      setTables((current) => [
        ...current,
        {
          id: `table-${Date.now()}`,
          name: parsed.name,
          zone: parsed.zone,
          seats: parsed.seats,
          active: true,
          // Meja baru selalu di akhir denah — sama dengan `tables.create`.
          sortOrder: nextTableSortOrder(current),
        },
      ]);
    },
    [requireModuleFeature, tables],
  );

  /** Menggeser satu meja satu langkah; urutannya dihitung aturan bersama. */
  const moveTable = useCallback(
    async (tableId: string, step: -1 | 1): Promise<void> => {
      requireModuleFeature("pos.table");
      const plan = planTableMove(tables, tableId, step);
      if (!plan.ok) throw new Error(plan.reason);
      const next = new Map(plan.moves.map((move) => [move.id, move.sortOrder]));
      setTables((current) =>
        current.map((row) =>
          next.has(row.id) && next.get(row.id) !== row.sortOrder
            ? { ...row, sortOrder: next.get(row.id) }
            : row,
        ),
      );
    },
    [requireModuleFeature, tables],
  );

  /**
   * Impor beberapa meja sekaligus dari teks — memakai `planTableImport` yang
   * sama dengan server, jadi kalimat penolakan (termasuk nomor barisnya) tidak
   * bisa berbeda antara halaman dan backend.
   */
  const importTables = useCallback(
    async (text: string): Promise<{ created: number; names: string[] }> => {
      requireModuleFeature("pos.table");
      const plan = planTableImport(tables, text);
      if (!plan.ok) throw new Error(plan.reason);

      const now = Date.now();
      const names = plan.tables.map((row) => row.name);
      setTables((current) => {
        const order = nextTableSortOrder(current);
        const added = plan.tables.map((row, index) => ({
          id: `table-${now}-${index}`,
          name: row.name,
          zone: row.zone ?? DEFAULT_TABLE_ZONE,
          seats: row.seats,
          active: true,
          sortOrder: order + index,
        }));
        return [...current, ...added];
      });
      return { created: names.length, names };
    },
    [requireModuleFeature, tables],
  );

  const setTableActive = useCallback(
    async (tableId: string, active: boolean): Promise<void> => {
      requireModuleFeature("pos.table");
      const table = tables.find((t) => t.id === tableId);
      if (!table) throw new Error("Meja tidak ditemukan untuk tenant ini.");

      if (!active) {
        const occupied = heldOrders.find((order) => order.tableId === tableId);
        if (occupied) {
          throw new Error(
            `Meja ${table.name} masih terisi pesanan ${occupied.number}. Selesaikan atau batalkan dulu.`,
          );
        }
      }

      setTables((current) =>
        current.map((t) => (t.id === tableId ? { ...t, active } : t)),
      );
    },
    [requireModuleFeature, tables, heldOrders],
  );

  /**
   * Mengubah nama, kursi, dan zona sebuah meja — aturan validasinya sama dengan
   * `tables.update` di server (`resolveTableInput` + `tableNameTaken`).
   */
  const updateTable = useCallback(
    async (input: UpdateTableInput): Promise<void> => {
      requireModuleFeature("pos.table");
      const table = tables.find((row) => row.id === input.tableId);
      if (!table) throw new Error("Meja tidak ditemukan untuk tenant ini.");

      const parsed = resolveTableInput(input);
      if (!parsed.ok) throw new Error(parsed.reason ?? "Data meja tidak valid.");
      if (tableNameTaken(tables, parsed.name, input.tableId)) {
        throw new Error(`Meja ${parsed.name} sudah ada di denah ini.`);
      }

      setTables((current) =>
        current.map((row) =>
          row.id === input.tableId
            ? { ...row, name: parsed.name, zone: parsed.zone, seats: parsed.seats }
            : row,
        ),
      );
    },
    [requireModuleFeature, tables],
  );

  /**
   * Bagian tagihan yang dibutuhkan aturan transisi & ringkasan murni.
   *
   * Dideklarasikan lebih awal dari bagian tagihannya karena pagar hapus meja
   * (`tableUsageOf` di bawah) juga menilai status tagihan tamu dengan aturan yang
   * sama — tanpa itu, dua tempat ini bisa berbeda pendapat soal tagihan yang
   * masih bisa dibayar.
   */
  const toDigitalLike = useCallback(
    (charge: DemoChargeRecord): DigitalChargeLike => ({
      number: charge.number,
      method: charge.method,
      amount: charge.amount,
      status: charge.status,
      createdAt: charge.createdAt,
      expiresAt: charge.expiresAt,
      paidAt: charge.paidAt,
      paidAmount: charge.paidAmount ?? null,
      cancelledAt: charge.cancelledAt,
      cancelReason: charge.cancelReason ?? null,
    }),
    [],
  );

  /**
   * Pemakaian sebuah meja di mode demo — cermin `tableUsage` di `tables.ts`.
   *
   * Satu bedanya dengan server, dan satu ini memang batas mode demo: penjualan
   * demo tidak menyimpan meja asalnya, jadi "riwayat penjualan" yang terbaca di
   * sini adalah pesanan QR yang **sudah lunas** — pesanan itu sudah menjadi
   * penjualan di jalur yang sama (`settleMejaOrder`), dan setelah kasir
   * menyelesaikannya ia jadi riwayat seperti penjualan lain.
   */
  const tableUsageOf = useCallback(
    (tableId: string): TableUsage => {
      const open = heldOrders.find((order) => order.tableId === tableId);
      const guest = mejaOrdersRef.current.filter((row) => row.tableId === tableId);
      // Sama dengan server: yang menahan hapus meja hanyalah tagihan tamu yang
      // masih bisa dibayar (`isAwaitingPayment`) — tagihan yang sudah dibatalkan
      // kasir atau kedaluwarsa tidak lagi menunggu apa pun.
      const now = Date.now();
      const pending = guest.filter((row) => {
        if (row.status !== "pending") return false;
        const charge = digitalChargesRef.current.find((item) => item.id === row.chargeId);
        return isAwaitingPayment({
          status: row.status,
          chargeStatus: charge ? digitalStatusOf(toDigitalLike(charge), now) : null,
        });
      }).length;
      return {
        openOrders: open ? 1 : 0,
        openOrderNumber: open?.number,
        sales: guest.filter((row) => row.status === "paid").length,
        pendingGuestOrders: pending,
      };
    },
    [heldOrders, mejaOrderRecords, digitalChargesRef, toDigitalLike],
  );

  /**
   * Pagar hapus sebuah meja — dibaca dialog konfirmasi **sebelum** menghapus,
   * supaya kalimatnya sama dengan yang diberikan `deleteTable`.
   */
  const checkTableDeletion = useCallback(
    async (tableId: string): Promise<StoreTableDeletionCheck> => {
      const table = tables.find((row) => row.id === tableId);
      if (!table) throw new Error("Meja tidak ditemukan untuk tenant ini.");
      const usage = tableUsageOf(tableId);
      return {
        name: table.name,
        active: table.active,
        usage,
        ...tableDeletionCheck(table.name, usage),
      };
    },
    [tables, tableUsageOf],
  );

  /**
   * Menghapus meja dari denah. Meja yang masih dipakai ditolak dengan kalimat
   * `tableDeletionCheck` — termasuk meja yang sudah punya riwayat pesanan QR
   * lunas, yang jawabannya menonaktifkan alih-alih menghapus.
   */
  const deleteTable = useCallback(
    async (tableId: string): Promise<void> => {
      requireModuleFeature("pos.table");
      const decision = await checkTableDeletion(tableId);
      if (!decision.canDelete) throw new Error(decision.sentence);
      setTables((current) => current.filter((row) => row.id !== tableId));
    },
    [requireModuleFeature, checkTableDeletion],
  );

  /**
   * Menerbitkan token kode QR meja. Aturannya sama dengan server
   * (`tables.issueMenuQr`): idempoten tanpa `rotate`, dan meja nonaktif tidak
   * diberi kode. Di server izinnya `table.manage`; di demo halaman yang
   * memanggilnya sudah dijaga `useCan`.
   */
  const issueTableMenuQr = useCallback(
    async (
      tableId: string,
      options?: { rotate?: boolean },
    ): Promise<{ token: string; rotated: boolean }> => {
      requireModuleFeature("pos.table");
      const table = tables.find((row) => row.id === tableId);
      if (!table) throw new Error("Meja tidak ditemukan untuk tenant ini.");
      if (!table.active) {
        throw new Error(
          `Meja ${table.name} sedang nonaktif; aktifkan dulu sebelum mencetak kode QR-nya.`,
        );
      }

      const rotate = options?.rotate === true && Boolean(table.menuToken);
      if (table.menuToken && !rotate) {
        return { token: table.menuToken, rotated: false };
      }

      const token = mejaMenuToken(demoRandomId().replace(/[^0-9a-f]/gi, "").padEnd(32, "0"));
      setTables((current) =>
        current.map((row) => (row.id === tableId ? { ...row, menuToken: token } : row)),
      );
      return { token, rotated: rotate };
    },
    [requireModuleFeature, tables],
  );

  /** Antrean dapur dihitung aturan bersama `@/lib/fnb` (paling lama di depan). */
  const kdsTickets = useMemo(
    () =>
      kdsQueue(
        heldOrders.map((order) => ({
          id: order.id,
          number: order.number,
          createdAt: order.createdAt,
          tableId: order.tableId,
          items: order.lines.map((line) => ({
            name: line.name,
            quantity: line.quantity,
            modifiers: line.modifiers,
          })),
        })),
        tables,
      ),
    [heldOrders, tables],
  );

  /**
   * Simulated sync. There is no server in demo mode, so a successful send is a
   * no-op — but it refuses while the browser is offline, which is what makes the
   * queue and the pending-sync UI behave the way they will in production.
   */
  const send = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new OfflineError();
    }
    return { synced: true as const };
  }, []);

  const outbox = useOutbox<CreateSaleInput, { synced: true }>({
    storageKey: OUTBOX_KEY,
    send,
  });

  const createSale = useCallback(
    async (input: CreateSaleInput): Promise<CreateSaleResult> => {
      const applied = applySale(input);
      const { result } = await outbox.enqueue(input);
      return {
        number: applied.number,
        total: applied.total,
        queued: result === null,
        memberDiscount: applied.memberDiscount,
      };
    },
    [applySale, outbox],
  );

  /**
   * Produk baru + stok awalnya, dengan aturan yang sama seperti
   * `products.create`: SKU unik per tenant, harga tidak negatif, dan stok awal
   * hanya ditulis kalau lebih dari nol.
   */
  const createProduct = useCallback(
    async (input: CreateProductInput): Promise<{ id: string; sku: string }> => {
      const name = input.name.trim();
      if (name.length < 2) throw new Error("Nama produk minimal 2 karakter.");
      if (input.price < 0) throw new Error("Harga tidak boleh negatif.");

      const category = input.category?.trim() || "Tanpa kategori";
      /**
       * SKU kosong = dibuat otomatis, memakai aturan & format yang sama dengan
       * server (`lib/productSku.ts`): nomor berikutnya dihitung dari SKU yang
       * sudah ada. SKU yang diketik pemilik toko dipakai apa adanya — sama seperti
       * di server, yang tidak mengubah huruf maupun spasinya.
       */
      const sku =
        input.sku?.trim() ||
        suggestProductSku({
          category: input.category?.trim() || undefined,
          takenSkus: productsRef.current.map((product) => product.sku),
        });
      if (productsRef.current.some((p) => p.sku === sku)) {
        throw new Error(`SKU ${sku} sudah dipakai.`);
      }

      const openingStock = Math.max(0, Math.trunc(input.openingStock ?? 0));
      productSequenceRef.current += 1;
      const id = `prod-${Date.now()}-${productSequenceRef.current}`;

      updateProducts((current) => [
        ...current,
        {
          id,
          sku,
          name,
          active: true,
          price: Math.max(0, Math.round(input.price)),
          cost: Math.max(0, Math.round(input.cost ?? 0)),
          category,
          stock: openingStock,
          unit: (input.unit ?? "").trim().toUpperCase() || "PCS",
        },
      ]);

      return { id, sku };
    },
    [updateProducts],
  );

  /**
   * Seberapa terpakai sebuah produk di mode demo — dasar keputusan hapus, memakai
   * aturan & kalimat yang **sama** dengan server (`@/lib/productEdit`).
   *
   * Sumbernya data demo yang memang ada: stok lokasi jual + stok gudang, riwayat
   * penjualan per produk dari ledger analitik (itulah catatan penjualan per produk
   * di mode demo), dokumen pembelian, transfer antar lokasi sebagai pergerakan
   * stok, dan sesi opname. Server memakai buku besar stok (`stockMovements`) yang
   * tidak dimiliki mode demo; selebihnya aturannya sama.
   */
  function productUsage(productId: string): ProductUsage {
    const product = productsRef.current.find((row) => row.id === productId);
    if (!product) throw new Error("Produk tidak ditemukan untuk tenant ini.");

    const warehouseQty = Object.values(warehouseStock[productId] ?? {}).reduce(
      (sum, quantity) => sum + (Number(quantity) || 0),
      0,
    );
    const sales = analyticsSales.reduce(
      (count, sale) =>
        count + sale.items.filter((item) => item.productId === productId).length,
      0,
    );
    const purchases =
      requisitions.filter((row) => row.lines.some((line) => line.productId === productId))
        .length +
      orders.filter((row) => row.lines.some((line) => line.productId === productId)).length;

    return {
      stock: Math.max(0, product.stock) + warehouseQty,
      sales,
      movements: transfers.filter((row) => row.productName === product.name).length,
      purchases,
      opname: opnameSessions.filter((session) =>
        session.lines.some((line) => line.productId === productId),
      ).length,
    };
  }

  /** Produk yang sudah tersimpan: perbaiki identitas (nama/SKU/harga beli). */
  const updateProduct = useCallback(
    async (input: UpdateProductInput): Promise<UpdatedProduct> => {
      const product = productsRef.current.find((row) => row.id === input.productId);
      if (!product) throw new Error("Produk tidak ditemukan untuk tenant ini.");

      const decision = validateProductIdentity(
        { name: product.name, sku: product.sku, cost: product.cost },
        { name: input.name, sku: input.sku, cost: input.cost },
        {
          otherSkus: productsRef.current
            .filter((row) => row.id !== input.productId)
            .map((row) => row.sku),
        },
      );
      if (!decision.ok) throw new Error(decision.reason);
      if (decision.changed.length === 0) return { ...decision.value, changed: [] };

      updateProducts((current) =>
        current.map((row) =>
          row.id === input.productId ? { ...row, ...decision.value } : row,
        ),
      );
      return { ...decision.value, changed: decision.changed };
    },
    [updateProducts],
  );

  /** Aktif/nonaktifkan produk; nonaktif = hilang dari katalog penjualan. */
  const setProductActive = useCallback(
    async (productId: string, active: boolean): Promise<void> => {
      const product = productsRef.current.find((row) => row.id === productId);
      if (!product) throw new Error("Produk tidak ditemukan untuk tenant ini.");
      updateProducts((current) =>
        current.map((row) => (row.id === productId ? { ...row, active } : row)),
      );
    },
    [updateProducts],
  );

  /** Pagar hapus produk (dihitung dari data demo yang ada). */
  const checkProductDeletion = useCallback(
    async (productId: string): Promise<ProductDeletionInfo> => {
      const product = productsRef.current.find((row) => row.id === productId);
      if (!product) throw new Error("Produk tidak ditemukan untuk tenant ini.");
      const usage = productUsage(productId);
      return {
        name: product.name,
        sku: product.sku,
        usage,
        ...productDeletionCheck(product.name, usage),
      };
    },
    [analyticsSales, opnameSessions, orders, requisitions, transfers, warehouseStock],
  );

  /** Hapus produk yang belum dipakai apa pun; sisanya ditolak dengan alasannya. */
  const removeProduct = useCallback(
    async (productId: string): Promise<{ name: string; sku: string }> => {
      const product = productsRef.current.find((row) => row.id === productId);
      if (!product) throw new Error("Produk tidak ditemukan untuk tenant ini.");

      const usage = productUsage(productId);
      const decision = productDeletionCheck(product.name, usage);
      if (!decision.canDelete) throw new Error(decision.sentence);

      updateProducts((current) => current.filter((row) => row.id !== productId));
      return { name: product.name, sku: product.sku };
    },
    [
      analyticsSales,
      opnameSessions,
      orders,
      requisitions,
      transfers,
      updateProducts,
      warehouseStock,
    ],
  );

  /**
   * Gambar produk di mode demo: tidak ada penyimpanan berkas di server, jadi
   * gambarnya hidup di memori sebagai data URL — sama seperti state demo lain
   * (`localStorage` tidak ikut memuatnya, jadi tidak ada batas kuota 5 MB yang
   * bisa dijebol). Batas 8 gambar & tipe/ukuran berkas tetap ditegakkan dengan
   * aturan yang sama seperti server.
   */
  const addProductImage = useCallback(
    async (productId: string, file: Blob): Promise<void> => {
      const product = productsRef.current.find((p) => p.id === productId);
      if (!product) throw new Error("Produk tidak ditemukan.");

      const room = canAddProductImage((product.images ?? []).length);
      if (!room.ok) throw new Error(room.reason);
      const valid = validateProductImage({ contentType: file.type, size: file.size });
      if (!valid.ok) throw new Error(valid.reason);

      const url = await readImageAsDataUrl(file);
      productImageSequenceRef.current += 1;
      const image: StoreProductImage = {
        id: `img-${Date.now()}-${productImageSequenceRef.current}`,
        url,
      };

      updateProducts((current) =>
        current.map((p) =>
          p.id === productId ? { ...p, images: [...(p.images ?? []), image] } : p,
        ),
      );
    },
    [updateProducts],
  );

  const removeProductImage = useCallback(
    async (productId: string, imageId: string): Promise<void> => {
      const product = productsRef.current.find((p) => p.id === productId);
      if (!product) throw new Error("Produk tidak ditemukan.");
      if (!(product.images ?? []).some((image) => image.id === imageId)) {
        throw new Error("Gambar itu tidak terpasang di produk ini.");
      }
      updateProducts((current) =>
        current.map((p) =>
          p.id === productId
            ? { ...p, images: (p.images ?? []).filter((image) => image.id !== imageId) }
            : p,
        ),
      );
    },
    [updateProducts],
  );

  const adjustStock = useCallback(
    async (productId: string, delta: number, _note?: string): Promise<number> => {
      const product = products.find((p) => p.id === productId);
      if (!product) throw new Error("Produk tidak ditemukan.");

      const next = product.stock + delta;
      if (next < 0) {
        throw new Error(
          `Stok tidak cukup untuk produk ${product.name} (tersedia ${product.stock}).`,
        );
      }

      updateProducts((current) =>
        current.map((p) => (p.id === productId ? { ...p, stock: next } : p)),
      );
      return next;
    },
    [products],
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

  const modules = useMemo(
    () => modulesFor(planKey, activeVerticals),
    [planKey, activeVerticals],
  );
  const setModules = useCallback(
    async (next: Vertical[]) => {
      setVerticals(next);
    },
    [setVerticals],
  );

  /**
   * Pindah paket di demo memakai aturan yang sama dengan `billing.changePlan`:
   * modul dipangkas lewat `trimVerticalsForPlan`, dan `gained`/`lost` dihitung
   * dari entitlement — jadi halaman Langganan berperilaku sama di kedua mode.
   */
  const changePlan = useCallback(
    async (next: PlanKey) => {
      const current = session?.tenant?.planKey ?? "starter";
      if (current === next) {
        return { changed: false, planKey: current, gained: [], lost: [] };
      }
      const delta = entitlementsDelta(entitlementFor(current), entitlementFor(next));
      setPlan(next, trimVerticalsForPlan(next, session?.tenant?.verticals ?? []));
      return {
        changed: true,
        planKey: next,
        gained: delta.gained,
        lost: delta.lost,
      };
    },
    [session, setPlan],
  );

  // Di demo tidak ada server: perubahannya langsung mengubah data lokal, dengan
  // bentuk argumen yang sama persis seperti `products.setPricing` di backend.
  // Modifier item: bentuk argumen identik dengan `products.setModifiers` di
  // backend, termasuk aturan "mengosongkan daftar selalu boleh".
  const setModifiers = useCallback(async (input: SetModifiersInput) => {
    requireModuleFeature("pos.modifier");
    const config = resolveModifierConfig(input.modifiers);
    if (!config.ok) throw new Error(config.reason);
    setProducts((current) =>
      current.map((product) =>
        product.id === input.productId
          ? { ...product, modifiers: config.groups }
          : product,
      ),
    );
  }, [requireModuleFeature]);

  const setPricing = useCallback(async (input: SetPricingInput) => {
    setProducts((current) =>
      current.map((product) =>
        product.id === input.productId
          ? {
              ...product,
              price: input.price,
              unit: input.unit ?? product.unit,
              units: input.units ?? product.units,
              tiers: input.tiers ?? product.tiers,
            }
          : product,
      ),
    );
  }, []);

  /**
   * Pindah kategori, dengan aturan SKU yang sama seperti `products.setCategory`:
   * SKU buatan sistem ikut kode kategori barunya (nomornya dipertahankan selama
   * bebas), sedangkan SKU yang diketik pemilik toko tidak disentuh.
   */
  const setCategory = useCallback(
    async (
      input: SetProductCategoryInput,
    ): Promise<{ sku: string; previousSku: string; category: string | null }> => {
      const product = productsRef.current.find((row) => row.id === input.productId);
      if (!product) throw new Error("Produk tidak ditemukan.");

      const trimmed = normalizeCategoryName(input.category ?? "");
      const hasCategory = trimmed.length > 0 && trimmed !== "Tanpa kategori";
      if (hasCategory) {
        // Kategori nonaktif tidak boleh dipakai — sama seperti di server: itu arti
        // menonaktifkan. Mengaktifkannya kembali adalah jalan yang jelas.
        const target = categoryRows.find(
          (row) => categoryNameKey(row.name) === categoryNameKey(trimmed),
        );
        if (!target) throw new Error(`Kategori “${trimmed}” tidak ada di workspace ini.`);
        if (!categoryIsActive(target)) {
          throw new Error(
            `Kategori ${target.name} sedang nonaktif — aktifkan dulu di halaman Produk & Stok kalau produk ini memang masuk ke sana.`,
          );
        }
      }
      const category = hasCategory ? trimmed : "Tanpa kategori";
      const takenSkus = productsRef.current
        .filter((row) => row.id !== input.productId)
        .map((row) => row.sku);

      const sku = recodeProductSku({
        sku: product.sku,
        category: hasCategory ? category : undefined,
        takenSkus,
      });
      if (sku !== product.sku && takenSkus.includes(sku)) {
        throw new Error(`SKU ${sku} sudah dipakai.`);
      }

      updateProducts((current) =>
        current.map((row) => (row.id === input.productId ? { ...row, category, sku } : row)),
      );

      return {
        sku,
        previousSku: product.sku,
        category: hasCategory ? category : null,
      };
    },
    [categoryRows, updateProducts],
  );

  /**
   * Kategori produk (`category.manage`): tambah, ganti nama, aktif/nonaktif,
   * hapus. Aturannya sama dengan `src/convex/categories.ts` — termasuk ganti nama
   * yang **tidak** menulis ulang SKU, dan hapus yang melepas produknya menjadi
   * “Tanpa kategori”.
   */
  const createCategory = useCallback(
    async (input: CreateCategoryInput): Promise<{ id: string; name: string }> => {
      const decision = validateCategoryName(
        { name: input.name },
        {
          existingNames: categoryRows.map((row) => row.name),
          count: categoryRows.length,
        },
      );
      if (!decision.ok) throw new Error(decision.reason);

      const id = `cat-${Date.now()}`;
      setCategoryRows((current) => [
        ...current,
        {
          id,
          name: decision.value.name,
          active: true,
          sortOrder: current.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0),
        },
      ]);
      return { id, name: decision.value.name };
    },
    [categoryRows],
  );

  const renameCategory = useCallback(
    async (input: RenameCategoryInput): Promise<RenamedCategory> => {
      const existing = categoryRows.find((row) => row.id === input.categoryId);
      if (!existing) throw new Error("Kategori tidak ditemukan untuk tenant ini.");

      const decision = validateCategoryName(
        { name: input.name },
        {
          existingNames: categoryRows
            .filter((row) => row.id !== input.categoryId)
            .map((row) => row.name),
        },
      );
      if (!decision.ok) throw new Error(decision.reason);

      const previousName = existing.name;
      if (decision.value.name === previousName) {
        return { name: previousName, previousName, skuCodeChanged: false };
      }

      setCategoryRows((current) =>
        current.map((row) =>
          row.id === input.categoryId ? { ...row, name: decision.value.name } : row,
        ),
      );
      // Nama kategori di baris produk ikut pindah (di server, produk menunjuk id
      // kategori, jadi namanya mengikuti dengan sendirinya). SKU-nya tidak ditulis
      // ulang — itu aturan bersama yang diuji harness.
      updateProducts((current) =>
        current.map((row) =>
          categoryNameKey(row.category) === categoryNameKey(previousName)
            ? { ...row, category: decision.value.name }
            : row,
        ),
      );

      return {
        name: decision.value.name,
        previousName,
        skuCodeChanged: categorySkuCode(previousName) !== categorySkuCode(decision.value.name),
      };
    },
    [categoryRows, updateProducts],
  );

  const setCategoryActive = useCallback(
    async (categoryId: string, active: boolean): Promise<void> => {
      const existing = categoryRows.find((row) => row.id === categoryId);
      if (!existing) throw new Error("Kategori tidak ditemukan untuk tenant ini.");
      setCategoryRows((current) =>
        current.map((row) => (row.id === categoryId ? { ...row, active } : row)),
      );
    },
    [categoryRows],
  );

  const removeCategory = useCallback(
    async (categoryId: string): Promise<RemovedCategory> => {
      const existing = categoryRows.find((row) => row.id === categoryId);
      if (!existing) throw new Error("Kategori tidak ditemukan untuk tenant ini.");

      const detached = productsRef.current.filter(
        (row) => categoryNameKey(row.category) === categoryNameKey(existing.name),
      ).length;

      updateProducts((current) =>
        current.map((row) =>
          categoryNameKey(row.category) === categoryNameKey(existing.name)
            ? { ...row, category: "Tanpa kategori" }
            : row,
        ),
      );
      setCategoryRows((current) => current.filter((row) => row.id !== categoryId));

      return { name: existing.name, detachedProducts: detached };
    },
    [categoryRows, updateProducts],
  );

  /** Limit & umur piutang: angka yang sama dengan backend, bukan salinan. */
  const storeCustomers: StoreCustomer[] = useMemo(() => {
    const now = Date.now();
    return customers
      .map((customer) => ({
        ...customer,
        ...creditPosition(
          customer,
          receivables
            .filter((row) => row.customerId === customer.id)
            .map(toReceivableLike),
          now,
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "id-ID"));
  }, [customers, receivables]);

  const storeReceivables: StoreReceivable[] = useMemo(() => {
    const now = Date.now();
    const nameById = new Map(customers.map((customer) => [customer.id, customer.name]));
    return receivables
      .slice()
      .sort((a, b) => a.dueDate - b.dueDate)
      .map((receivable) => {
        const aging = agingOf(toReceivableLike(receivable), now);
        return {
          id: receivable.id,
          number: receivable.number,
          customerId: receivable.customerId,
          customerName: nameById.get(receivable.customerId) ?? "—",
          saleNumber: receivable.saleNumber ?? null,
          amount: receivable.amount,
          paidAmount: receivable.paidAmount,
          balance: receivableBalance(toReceivableLike(receivable)),
          dueDate: receivable.dueDate,
          status: receivable.status,
          daysPastDue: aging.daysPastDue,
          bucket: aging.bucket,
          overdue: aging.overdue,
        };
      });
  }, [customers, receivables]);

  const arSummary: StoreArSummary = useMemo(
    () =>
      receivables.length === 0
        ? EMPTY_AR_SUMMARY
        : summariseReceivables(receivables.map(toReceivableLike)),
    [receivables],
  );

  const createCustomer = useCallback(
    async (input: CreateCustomerInput): Promise<{ id: string; code: string }> => {
      const resolved = resolveCustomerInput(input, customers.map((row) => row.code));
      if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
      const customer = resolved.value;

      // Hanya kredit yang butuh modul: daftar pelanggan tunai tetap bisa dirapikan.
      if (customer.creditLimit > 0) requireModuleFeature("ar.creditlimit");
      if (customers.some((row) => row.code === customer.code)) {
        throw new Error(`Kode pelanggan ${customer.code} sudah dipakai.`);
      }

      const id = `cust-${Date.now()}`;
      setCustomers((current) => [...current, { id, ...customer }]);
      return { id, code: customer.code };
    },
    [customers, requireModuleFeature],
  );

  const setCredit = useCallback(
    async (input: SetCreditInput): Promise<void> => {
      const existing = customers.find((row) => row.id === input.customerId);
      if (!existing) throw new Error("Pelanggan tidak ditemukan untuk tenant ini.");

      const creditLimit = input.creditLimit ?? existing.creditLimit;
      // Menutup kredit (limit 0) selalu boleh; menaikkannya butuh modul Grosir.
      if (creditLimit > 0) requireModuleFeature("ar.creditlimit");

      const resolved = resolveCustomerInput({
        name: existing.name,
        code: existing.code,
        phone: existing.phone,
        creditLimit,
        paymentTermDays: input.paymentTermDays ?? existing.paymentTermDays,
        active: input.active ?? existing.active,
      });
      if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
      const next = resolved.value;

      setCustomers((current) =>
        current.map((row) => (row.id === input.customerId ? { id: row.id, ...next } : row)),
      );
    },
    [customers, requireModuleFeature],
  );

  /** Penagihan selalu boleh, bahkan saat modul Grosir mati (utang lama tetap tertagih). */
  const recordPayment = useCallback(
    async (input: RecordPaymentInput): Promise<{ remaining: number }> => {
      const current = receivablesRef.current;
      const receivable = current.find((row) => row.id === input.receivableId);
      if (!receivable) throw new Error("Piutang tidak ditemukan untuk tenant ini.");

      const applied = applyReceivablePayment(toReceivableLike(receivable), input.amount);
      if (!applied.ok) throw new Error(applied.reason);

      commitReceivables(
        current.map((row) =>
          row.id === input.receivableId
            ? {
                ...row,
                paidAmount: row.paidAmount + applied.accepted,
                status: applied.fullyPaid ? "paid" : "open",
              }
            : row,
        ),
      );
      return { remaining: applied.remaining };
    },
    [commitReceivables],
  );

  /**
   * Lokasi stok (Phase 3): lokasi jual toko selalu ada, gudang ditambahkan dari
   * halaman Gudang & Stok. Aturan & pesannya sama dengan `src/convex/inventory.ts`.
   */
  const storeWarehouses: StoreWarehouse[] = useMemo(
    () => [defaultWarehouse(), ...warehouses],
    [warehouses],
  );

  const stock: StoreStockRow[] = useMemo(
    () =>
      products
        .map((product) => {
          const levels = [
            { warehouseId: DEFAULT_WAREHOUSE_ID, quantity: product.stock },
            ...warehouses.map((warehouse) => ({
              warehouseId: warehouse.id,
              quantity: warehouseStock[product.id]?.[warehouse.id] ?? 0,
            })),
          ];
          return {
            productId: product.id,
            sku: product.sku,
            name: product.name,
            unit: product.unit ?? "PCS",
            levels,
            sellable: product.stock,
            total: levels.reduce((sum, level) => sum + level.quantity, 0),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "id-ID")),
    [products, warehouses, warehouseStock],
  );

  /** Batas lokasi dari paket: lokasi jual menempati satu slot. */
  const warehouseCapacityValue = useMemo(
    () =>
      warehouseCapacity(
        entitlementFor(planKey).limits.warehouses,
        warehouses.length,
      ),
    [planKey, warehouses.length],
  );

  const createWarehouse = useCallback(
    async (input: CreateWarehouseInput): Promise<{ id: string; code: string }> => {
      // Gerbang yang sama dengan server: fitur ini murni milik paket (bukan
      // modul vertikal), jadi pesannya menyebut paket.
      requireModuleFeature("inventory.multiwarehouse");

      const resolved = resolveWarehouseInput(
        input,
        warehousesRef.current.map((warehouse) => warehouse.code),
      );
      if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
      const warehouse = resolved.value;

      const current = warehousesRef.current;
      const capacity = warehouseCapacity(
        entitlementFor(planKey).limits.warehouses,
        current.length,
      );
      if (capacity.full) {
        throw new Error(
          `Paket ${PLANS[planKey].name} memungkinkan ${capacity.limit} lokasi stok termasuk lokasi jual; naikkan paket untuk menambah gudang.`,
        );
      }

      const taken = new Set(
        current.map((row) => normalizeWarehouseCode(row.code)),
      );
      if (taken.has(warehouse.code)) {
        throw new Error(`Kode gudang ${warehouse.code} sudah dipakai.`);
      }

      const id = `wh-${Date.now()}`;
      updateWarehouses((rows) => [
        ...rows,
        {
          id,
          code: warehouse.code,
          name: warehouse.name,
          address: warehouse.address,
          active: true,
        },
      ]);
      return { id, code: warehouse.code };
    },
    [planKey, requireModuleFeature, updateWarehouses],
  );

  const setWarehouseActive = useCallback(
    async (warehouseId: string, active: boolean): Promise<void> => {
      const warehouse = warehousesRef.current.find((row) => row.id === warehouseId);
      if (!warehouse) throw new Error("Gudang tidak ditemukan untuk tenant ini.");

      if (!active) {
        const held = Object.values(warehouseStockRef.current).reduce(
          (sum, byWarehouse) => sum + (byWarehouse[warehouseId] ?? 0),
          0,
        );
        if (held !== 0) {
          throw new Error(
            `${describeWarehouse(warehouse)} masih menyimpan ${held} unit; pindahkan dulu stoknya ke lokasi lain.`,
          );
        }
      }

      updateWarehouses((rows) =>
        rows.map((row) => (row.id === warehouseId ? { ...row, active } : row)),
      );
    },
    [updateWarehouses],
  );

  /**
   * Memindahkan stok antar lokasi. Lokasi jual memakai `products[].stock`,
   * gudang memakai peta stok gudang — penjumlahannya tetap sama, jadi total
   * stok tidak pernah berubah karena perpindahan.
   */
  const transferStock = useCallback(
    async (input: TransferStockInput): Promise<{ number: string; quantity: number }> => {
      const product = productsRef.current.find((row) => row.id === input.productId);
      if (!product) throw new Error("Produk tidak valid untuk tenant ini.");

      const source =
        input.from === DEFAULT_WAREHOUSE_ID
          ? defaultWarehouse()
          : warehousesRef.current.find((row) => row.id === input.from);
      const target =
        input.to === DEFAULT_WAREHOUSE_ID
          ? defaultWarehouse()
          : warehousesRef.current.find((row) => row.id === input.to);
      if (!source || !target) throw new Error("Gudang tidak ditemukan untuk tenant ini.");

      const available =
        source.id === DEFAULT_WAREHOUSE_ID
          ? product.stock
          : warehouseStockRef.current[product.id]?.[source.id] ?? 0;

      const plan = planTransfer({
        from: source.id,
        to: target.id,
        quantity: input.quantity,
        available,
        fromName: source.name,
        toName: target.name,
        fromActive: source.active,
        toActive: target.active,
      });
      if (!plan.ok || !plan.value) throw new Error(plan.reason);
      const quantity = plan.value.quantity;

      const move = (locationId: string, delta: number) => {
        if (locationId === DEFAULT_WAREHOUSE_ID) {
          updateProducts((current) =>
            current.map((row) =>
              row.id === product.id ? { ...row, stock: row.stock + delta } : row,
            ),
          );
          return;
        }
        updateWarehouseStock((current) => ({
          ...current,
          [product.id]: {
            ...(current[product.id] ?? {}),
            [locationId]: (current[product.id]?.[locationId] ?? 0) + delta,
          },
        }));
      };

      move(source.id, -quantity);
      move(target.id, quantity);

      const number = `TRF-${String(transfersRef.current.length + 1).padStart(5, "0")}`;
      updateTransfers((current) => [
        {
          number,
          at: Date.now(),
          productName: product.name,
          fromName: source.name,
          toName: target.name,
          quantity,
          note: input.note?.trim() || undefined,
        },
        ...current,
      ]);

      return { number, quantity };
    },
    [updateProducts, updateWarehouseStock, updateTransfers],
  );

  // ------------------ Phase 3: pembelian (PR · PO · GRN) -------------------
  const productNameById = useMemo(
    () => new Map(products.map((product) => [product.id, product.name])),
    [products],
  );

  const storeRequisitions: StoreRequisition[] = useMemo(
    () =>
      requisitions
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((row) => ({
          id: row.id,
          number: row.number,
          status: row.status,
          note: row.note,
          decisionNote: row.decisionNote,
          createdAt: row.createdAt,
          orderNumber: row.orderId
            ? (orders.find((order) => order.id === row.orderId)?.number ?? null)
            : null,
          lines: row.lines.map((line) => ({
            productId: line.productId,
            name: productNameById.get(line.productId) ?? "Produk dihapus",
            quantity: line.quantity,
            note: line.note,
          })),
        })),
    [requisitions, orders, productNameById],
  );

  const supplierNameById = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])),
    [suppliers],
  );

  const storeOrders: StoreOrder[] = useMemo(
    () =>
      orders
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((order) => ({
          id: order.id,
          number: order.number,
          status: orderStatusFromLines(order.status, order.lines),
          supplierId: order.supplierId,
          supplierName: supplierNameById.get(order.supplierId) ?? "Supplier dihapus",
          requisitionNumber: order.requisitionId
            ? (requisitions.find((row) => row.id === order.requisitionId)?.number ?? null)
            : null,
          expectedAt: order.expectedAt,
          note: order.note,
          createdAt: order.createdAt,
          total: orderTotal(order.lines),
          receivedValue: orderTotal(
            order.lines
              .filter((line) => line.receivedQty > 0)
              .map((line) => ({ quantity: line.receivedQty, unitCost: line.unitCost })),
          ),
          lines: order.lines.map((line) => ({
            productId: line.productId,
            name: productNameById.get(line.productId) ?? "Produk dihapus",
            quantity: line.quantity,
            unitCost: line.unitCost,
            receivedQty: line.receivedQty,
            lineTotal: orderLineTotal(line),
          })),
        })),
    [orders, requisitions, supplierNameById, productNameById],
  );

  const purchasingSummary: StorePurchasingSummary = useMemo(
    () =>
      summarisePurchasing({
        requisitions: requisitions.map((row) => ({ status: row.status })),
        orders: orders.map((order) => ({ status: order.status, lines: order.lines })),
        receipts: receipts.map((receipt) => ({
          total: receipt.total,
          createdAt: receipt.createdAt,
        })),
      }),
    [requisitions, orders, receipts],
  );

  // --------------------- Phase 3: hutang usaha (AP) ------------------------
  /**
   * Baris PO & GRN untuk pencocokan 3 arah, dibaca dari dokumen demo.
   * Tagihan tanpa PO/GRN tetap boleh ada (tagihan manual) — hasilnya "tidak ada
   * yang dicocokkan", bukan selisih palsu.
   */
  const matchInputFor = useCallback(
    (payable: StoredPayable) => {
      const receipt =
        receipts.find((row) => row.number === payable.receiptNumber) ?? null;
      const order =
        orders.find(
          (row) => row.number === (payable.orderNumber ?? receipt?.orderNumber),
        ) ?? null;
      return {
        orderLines: (order?.lines ?? []).map((line) => ({
          productId: line.productId,
          name: productName(line.productId),
          quantity: line.quantity,
          unitCost: line.unitCost,
          receivedQty: line.receivedQty,
        })),
        receiptLines: (receipt?.lines ?? []).map((line) => ({
          productId: line.productId,
          name: line.name,
          quantity: line.quantity,
          unitCost: line.unitCost,
        })),
      };
    },
    [orders, receipts],
  );

  const storePayables: StorePayable[] = useMemo(
    () =>
      payables
        .slice()
        .sort((a, b) => a.dueDate - b.dueDate)
        .map((payable) => {
          const aging = payableAging(toPayableLike(payable), Date.now());
          const orderNumber = payable.orderNumber ?? null;
          const receiptNumber = payable.receiptNumber ?? null;
          const match = matchPayable({
            ...matchInputFor(payable),
            invoice: payable.invoice ?? null,
          });
          return {
            id: payable.id,
            number: payable.number,
            supplierId: payable.supplierId,
            supplierName: supplierNameById.get(payable.supplierId) ?? "Supplier dihapus",
            reference: payable.reference,
            orderNumber,
            receiptNumber,
            source: describePayableSource({
              orderNumber,
              receiptNumber,
              reference: payable.reference,
            }),
            amount: payable.amount,
            paidAmount: payable.paidAmount,
            balance: payableBalance(toPayableLike(payable)),
            dueDate: payable.dueDate,
            paymentTermDays: payable.paymentTermDays,
            status: payable.status,
            daysPastDue: aging.daysPastDue,
            bucket: aging.bucket,
            overdue: aging.overdue,
            note: payable.note,
            invoice: payable.invoice
              ? {
                  reference: payable.invoice.reference ?? null,
                  total: payable.invoice.total,
                  lines: payable.invoice.lines,
                  note: payable.invoice.note ?? null,
                  recordedAt: payable.invoice.recordedAt,
                }
              : null,
            decision: payable.matchDecision ?? null,
            match,
            createdAt: payable.createdAt,
          };
        }),
    [payables, supplierNameById, matchInputFor],
  );

  const payableSummary: StorePayableSummary = useMemo(
    () => summarisePayables(payables.map(toPayableLike)),
    [payables],
  );

  /** Ringkasan pencocokan 3 arah + pembayaran batch yang sudah terjadi. */
  const threewaySummary: StoreThreewaySummary = useMemo(
    () =>
      summariseThreeway(
        storePayables.map((row) => ({
          match: row.match,
          decision: row.decision,
          balance: row.balance,
        })),
      ),
    [storePayables],
  );

  const paymentBatches: StorePaymentBatch[] = useMemo(() => {
    const groups = new Map<string, StorePayablePayment[]>();
    for (const payment of payablePayments) {
      if (!payment.batchNumber) continue;
      groups.set(payment.batchNumber, [
        ...(groups.get(payment.batchNumber) ?? []),
        payment,
      ]);
    }
    return [...groups.entries()]
      .map(([number, group]) => ({
        number,
        at: Math.max(...group.map((row) => row.createdAt)),
        total: group.reduce((sum, row) => sum + row.amount, 0),
        count: group.length,
        method: group[0].method,
        bills: group
          .map((row) => ({
            payableId: row.payableId,
            payableNumber: row.payableNumber,
            supplierName: row.supplierName,
            amount: row.amount,
          }))
          .sort((a, b) => a.payableNumber.localeCompare(b.payableNumber)),
      }))
      .sort((a, b) => b.at - a.at);
  }, [payablePayments]);

  /**
   * Analitik lanjutan (`report.advanced`, Phase 4): periode dan pembandingnya
   * dihitung aturan murni yang sama dengan server, memakai offset zona waktu
   * peramban supaya “jam tersibuk” adalah jam dinding toko, bukan jam server.
   *
   * Paket yang tidak memuat fiturnya mendapat laporan kosong yang sah — bukan
   * angka — persis seperti server menolak kuerinya.
   */
  const analyticsReport: StoreAdvancedReport = useMemo(() => {
    const offset = -new Date().getTimezoneOffset();
    const range = analyticsRange({
      days: analyticsDays,
      now: Date.now(),
      timezoneOffsetMinutes: offset,
    });
    const reportEnabled = isFeatureEnabled(
      entitlementFor(planKey),
      activeVerticals,
      "report.advanced",
    );
    return buildAdvancedReport({
      sales: reportEnabled ? analyticsSales : [],
      previousSales: reportEnabled ? analyticsSales : [],
      range,
      timezoneOffsetMinutes: offset,
    });
  }, [analyticsSales, analyticsDays, planKey, activeVerticals]);

  /** Panjang periode analitik selalu masuk batas yang didukung aturannya. */
  const setAnalyticsPeriod = useCallback((days: number) => {
    setAnalyticsDays(resolveAnalyticsDays(days));
  }, []);

  /**
   * Laporan lintas cabang (`scale.franchise`, Phase 5). Angka, urutan, pangsa,
   * dan anggaran query dihitung aturan murni `@/lib/scale` — yang sama dengan
   * backend; yang berbeda hanya sumber datanya.
   *
   * Paket tanpa fiturnya menerima laporan kosong yang sah, bukan angka: halaman
   * tidak boleh menampilkan laporan yang server tidak akan menghitungnya.
   */
  const franchiseReport: StoreFranchiseReport = useMemo(() => {
    const enabled = isFeatureEnabled(
      entitlementFor(planKey),
      activeVerticals,
      "scale.franchise",
    );
    if (!enabled) return EMPTY_FRANCHISE_REPORT;

    const now = Date.now();
    const offset = -new Date().getTimezoneOffset();
    const range = analyticsRange({
      days: analyticsDays,
      now,
      timezoneOffsetMinutes: offset,
    });

    const outlets: FranchiseOutletInput[] = seedFranchiseInputs().map((outlet) => ({
      ...outlet,
      sales: outlet.sales.filter(
        (sale) => sale.createdAt >= range.from && sale.createdAt < range.to,
      ),
    }));
    const budget = queryBudgetFor(outlets.length);
    const report = franchiseRollup({ outlets, budget, from: range.from, to: range.to });

    // Transaksi terbesar jaringan digabung berbatas memori (aturan yang sama
    // dengan backend), bukan dengan menyatukan seluruh baris lalu mengurutkannya.
    const topSales: StoreFranchiseTopSale[] = mergeTopN(
      outlets.map((outlet) =>
        outlet.sales
          .map((sale, index) => ({
            saleId: `${outlet.storeId}-${index}`,
            storeId: outlet.storeId,
            storeName: outlet.name,
            number: `A-${String(index + 1).padStart(4, "0")}`,
            total: sale.total,
            createdAt: sale.createdAt,
          }))
          .sort((a, b) => b.total - a.total),
      ),
      FRANCHISE_TOP_SALES,
      (row) => row.total,
    );

    return {
      ...report,
      days: analyticsDays,
      generatedAt: now,
      topSales,
      beyondWindow: 0,
    };
  }, [analyticsDays, planKey, activeVerticals]);

  const payablesBySupplier = useMemo(() => {
    const map = new Map<string, PayableLike[]>();
    for (const payable of payables) {
      const list = map.get(payable.supplierId) ?? [];
      list.push(toPayableLike(payable));
      map.set(payable.supplierId, list);
    }
    return map;
  }, [payables]);

  /** Daftar supplier + posisi hutangnya — angka dari aturan murni `@/lib/payables`. */
  const storeSuppliers: StoreSupplier[] = useMemo(
    () =>
      suppliers.map((supplier) => ({
        ...supplier,
        ...payablePosition(payablesBySupplier.get(supplier.id) ?? []),
      })),
    [suppliers, payablesBySupplier],
  );

  // ---------------- Phase 3: stock opname (inventory.opname) ----------------
  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  /** Saldo lokasi saat ini: lokasi jual memakai stok produk, gudang memakai peta gudang. */
  const qtyAt = useCallback(
    (locationId: string, productId: string): number =>
      locationId === DEFAULT_WAREHOUSE_ID
        ? (products.find((row) => row.id === productId)?.stock ?? 0)
        : (warehouseStock[productId]?.[locationId] ?? 0),
    [products, warehouseStock],
  );

  const opnameLocationName = useCallback(
    (locationId: string): string =>
      storeWarehouses.find((row) => row.id === locationId)?.name ?? "Lokasi tidak dikenal",
    [storeWarehouses],
  );

  const opnameRows: StoreOpnameSession[] = useMemo(
    () =>
      opnameSessions
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((session) => {
          const lines = session.lines.map((line) => {
            const product = productById.get(line.productId);
            return {
              productId: line.productId,
              name: product?.name ?? "Produk dihapus",
              sku: product?.sku ?? "",
              unit: product?.unit ?? "PCS",
              systemQty: line.systemQty,
              countedQty: line.countedQty,
              currentQty: qtyAt(session.locationId, line.productId),
              variance: lineVariance(line as OpnameLineLike),
              note: line.note,
            };
          });
          const likes = session.lines as OpnameLineLike[];
          return {
            id: session.id,
            number: session.number,
            locationId: session.locationId,
            locationName: opnameLocationName(session.locationId),
            status: session.status,
            note: session.note,
            createdAt: session.createdAt,
            postedAt: session.postedAt,
            cancelledAt: session.cancelledAt,
            progress: countProgress(likes),
            variance: summariseVariance(likes),
            lines,
          };
        }),
    [opnameSessions, productById, qtyAt, opnameLocationName],
  );

  const opnameSummary: StoreOpnameSummary = useMemo(
    () =>
      summariseOpnameSessions(
        opnameSessions.map((session) => ({
          status: session.status,
          lines: session.lines as OpnameLineLike[],
        })),
      ),
    [opnameSessions],
  );

  const opnameLocations: StoreOpnameLocation[] = useMemo(
    () => storeWarehouses.map((row) => ({ id: row.id, name: row.name, active: row.active })),
    [storeWarehouses],
  );

  const opnameOpenByLocation = useMemo(
    () =>
      opnameSessions
        .filter((session) => session.status === "draft")
        .map((session) => ({ number: session.number, locationId: session.locationId })),
    [opnameSessions],
  );

  const startOpname = useCallback(
    async (input: StartOpnameInput): Promise<{ id: string; number: string }> => {
      // Sesi baru adalah tindakan yang dibayar (paket Enterprise).
      requireModuleFeature("inventory.opname");

      const targetId =
        input.warehouseId && input.warehouseId !== DEFAULT_WAREHOUSE_ID
          ? input.warehouseId
          : DEFAULT_WAREHOUSE_ID;

      let locationName = defaultWarehouse().name;
      if (targetId !== DEFAULT_WAREHOUSE_ID) {
        const warehouse = warehousesRef.current.find((row) => row.id === targetId);
        if (!warehouse) throw new Error("Gudang tidak ditemukan untuk tenant ini.");
        if (!warehouse.active) {
          throw new Error(`${describeWarehouse(warehouse)} sedang nonaktif; aktifkan dulu.`);
        }
        locationName = describeWarehouse(warehouse);
      }

      const counted = productsRef.current
        .filter((product) => (input.productIds ? input.productIds.includes(product.id) : true))
        .sort((a, b) => a.name.localeCompare(b.name, "id-ID"));

      const lines = buildOpnameLines(
        counted.map((product) => ({
          id: product.id,
          name: product.name,
          sku: product.sku,
          unit: product.unit,
        })),
        (productId) =>
          targetId === DEFAULT_WAREHOUSE_ID
            ? (productsRef.current.find((row) => row.id === productId)?.stock ?? 0)
            : (warehouseStockRef.current[productId]?.[targetId] ?? 0),
      );

      const plan = resolveOpnameStart({
        location: { id: targetId, name: locationName },
        openSessions: opnameRef.current
          .filter((session) => session.status === "draft")
          .map((session) => ({ number: session.number, locationId: session.locationId })),
        lines,
      });
      if (!plan.ok || !plan.value) throw new Error(plan.reason);

      const note = resolveOpnameNote(input.note);
      if (!note.ok) throw new Error(note.reason);

      const number = nextDocumentNumber(
        "OPN",
        opnameRef.current.map((row) => row.number),
      );
      const id = `op-${Date.now()}`;
      updateOpname((current) => [
        {
          id,
          number,
          locationId: targetId,
          status: "draft",
          note: note.value,
          createdAt: Date.now(),
          lines: plan.value!.lines.map((line) => ({
            productId: line.productId,
            systemQty: line.systemQty,
          })),
        },
        ...current,
      ]);

      return { id, number };
    },
    [requireModuleFeature, updateOpname],
  );

  const setOpnameCount = useCallback(
    async (input: SetOpnameCountInput): Promise<void> => {
      const session = opnameRef.current.find((row) => row.id === input.sessionId);
      if (!session) throw new Error("Sesi opname tidak ditemukan untuk tenant ini.");

      const editable = canEditOpname(session.status);
      if (!editable.ok) throw new Error(editable.reason);

      const updated = setCountedQty(session.lines as OpnameLineLike[], {
        productId: input.productId,
        countedQty: input.countedQty,
        note: input.note,
      });
      if (!updated.ok || !updated.value) throw new Error(updated.reason);

      updateOpname((current) =>
        current.map((row) =>
          row.id === input.sessionId
            ? {
                ...row,
                lines: updated.value!.map((line) => ({
                  productId: line.productId,
                  systemQty: line.systemQty,
                  countedQty: line.countedQty,
                  note: line.note,
                })),
              }
            : row,
        ),
      );
    },
    [updateOpname],
  );

  /**
   * Posting: stok lokasi dibuat sama persis dengan hasil hitung, memakai saldo
   * **terbaru** (bukan snapshot) — aturan yang sama dengan `opname.post`.
   */
  const postOpname = useCallback(
    async (sessionId: string): Promise<{ number: string; movements: number; netUnits: number }> => {
      const session = opnameRef.current.find((row) => row.id === sessionId);
      if (!session) throw new Error("Sesi opname tidak ditemukan untuk tenant ini.");

      const allowed = canPostOpname({
        status: session.status,
        lines: session.lines as OpnameLineLike[],
      });
      if (!allowed.ok) throw new Error(allowed.reason);

      const currentQty: Record<string, number> = {};
      for (const line of session.lines) {
        currentQty[line.productId] =
          session.locationId === DEFAULT_WAREHOUSE_ID
            ? (productsRef.current.find((row) => row.id === line.productId)?.stock ?? 0)
            : (warehouseStockRef.current[line.productId]?.[session.locationId] ?? 0);
      }

      const plan = planOpnamePost(session.lines as OpnameLineLike[], currentQty);

      for (const movement of plan.movements) {
        if (session.locationId === DEFAULT_WAREHOUSE_ID) {
          updateProducts((current) =>
            current.map((row) =>
              row.id === movement.productId
                ? { ...row, stock: row.stock + movement.delta }
                : row,
            ),
          );
        } else {
          updateWarehouseStock((current) => ({
            ...current,
            [movement.productId]: {
              ...(current[movement.productId] ?? {}),
              [session.locationId]:
                (current[movement.productId]?.[session.locationId] ?? 0) + movement.delta,
            },
          }));
        }
      }

      updateOpname((current) =>
        current.map((row) =>
          row.id === sessionId ? { ...row, status: "posted", postedAt: Date.now() } : row,
        ),
      );

      return {
        number: session.number,
        movements: plan.movements.length,
        netUnits: plan.netUnits,
      };
    },
    [updateOpname, updateProducts, updateWarehouseStock],
  );

  const cancelOpname = useCallback(
    async (sessionId: string, reason?: string): Promise<void> => {
      const session = opnameRef.current.find((row) => row.id === sessionId);
      if (!session) throw new Error("Sesi opname tidak ditemukan untuk tenant ini.");

      const allowed = canCancelOpname(session.status);
      if (!allowed.ok) throw new Error(allowed.reason);

      updateOpname((current) =>
        current.map((row) =>
          row.id === sessionId
            ? {
                ...row,
                status: "cancelled" as OpnameStatus,
                cancelledAt: Date.now(),
                note: reason?.trim() || row.note,
              }
            : row,
        ),
      );
    },
    [updateOpname],
  );

  const createSupplier = useCallback(
    async (input: CreateSupplierInput): Promise<{ id: string; code: string }> => {
      const resolved = resolveSupplierInput(
        input,
        suppliersRef.current.map((supplier) => supplier.code),
      );
      if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
      const supplier = resolved.value;

      const id = `sup-${Date.now()}`;
      updateSuppliers((current) => [...current, { id, ...supplier }]);
      return { id, code: supplier.code };
    },
    [updateSuppliers],
  );

  const createRequisition = useCallback(
    async (input: CreateRequisitionInput): Promise<{ id: string; number: string }> => {
      requireModuleFeature("purchasing.basic");

      const resolved = resolveRequisitionInput(input.lines, productsRef.current);
      if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
      const requested = resolved.value;

      const number = nextDocumentNumber(
        "PR",
        requisitionsRef.current.map((row) => row.number),
      );
      const id = `pr-${Date.now()}`;
      updateRequisitions((current) => [
        {
          id,
          number,
          status: "submitted",
          note: input.note?.trim() || undefined,
          createdAt: Date.now(),
          lines: requested.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            note: line.note,
          })),
        },
        ...current,
      ]);
      return { id, number };
    },
    [requireModuleFeature, updateRequisitions],
  );

  const decideRequisition = useCallback(
    async (input: DecideRequisitionInput): Promise<void> => {
      const requisition = requisitionsRef.current.find(
        (row) => row.id === input.requisitionId,
      );
      if (!requisition) throw new Error("PR tidak ditemukan untuk tenant ini.");
      if (!canDecideRequisition(requisition.status)) {
        throw new Error(
          `PR ${requisition.number} sudah diputuskan; statusnya tidak bisa diubah lagi.`,
        );
      }

      updateRequisitions((current) =>
        current.map((row) =>
          row.id === input.requisitionId
            ? {
                ...row,
                status: input.approve ? "approved" : "rejected",
                decisionNote: input.note?.trim() || undefined,
              }
            : row,
        ),
      );
    },
    [updateRequisitions],
  );

  const createOrder = useCallback(
    async (input: CreateOrderInput): Promise<{ id: string; number: string }> => {
      requireModuleFeature("purchasing.basic");

      const supplier = suppliersRef.current.find((row) => row.id === input.supplierId);
      if (!supplier) throw new Error("Supplier tidak ditemukan untuk tenant ini.");
      if (!supplier.active) throw new Error(`Supplier ${supplier.name} sedang nonaktif.`);

      // Supplier yang menunggak tidak dilayani PO baru — tempo punya konsekuensi.
      const blocked = supplierBlockedReason(
        payablesRef.current
          .filter((row) => row.supplierId === supplier.id)
          .map(toPayableLike),
        supplier,
      );
      if (blocked) throw new Error(blocked);

      const requisition = requisitionsRef.current.find(
        (row) => row.id === input.requisitionId,
      );
      if (!requisition) throw new Error("PR tidak ditemukan untuk tenant ini.");

      const alreadyOrdered = ordersRef.current.some(
        (order) => order.requisitionId === input.requisitionId && order.status !== "cancelled",
      );
      const allowed = canOrderFromRequisition(requisition.status, alreadyOrdered);
      if (!allowed.ok) throw new Error(allowed.reason);

      const resolved = resolveOrderInput(input.lines, productsRef.current);
      if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
      const orderedLines = resolved.value;

      const requestedQty = new Map(
        requisition.lines.map((line) => [line.productId, line.quantity]),
      );
      for (const line of orderedLines) {
        const ordered = requestedQty.get(line.productId);
        if (ordered === undefined) {
          throw new Error(`${line.name} tidak ada di PR ${requisition.number}.`);
        }
        if (line.quantity > ordered) {
          throw new Error(
            `${line.name} diminta ${ordered} unit di PR; PO tidak boleh melebihi itu (${line.quantity}).`,
          );
        }
      }

      const number = nextDocumentNumber("PO", ordersRef.current.map((row) => row.number));
      const id = `po-${Date.now()}`;
      updateOrders((current) => [
        {
          id,
          number,
          supplierId: input.supplierId,
          requisitionId: input.requisitionId,
          status: "open",
          expectedAt: input.expectedAt,
          note: input.note?.trim() || undefined,
          createdAt: Date.now(),
          lines: orderedLines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitCost: line.unitCost,
            receivedQty: 0,
          })),
        },
        ...current,
      ]);
      updateRequisitions((current) =>
        current.map((row) => (row.id === input.requisitionId ? { ...row, orderId: id } : row)),
      );
      return { id, number };
    },
    [requireModuleFeature, updateOrders, updateRequisitions],
  );

  /** Membatalkan PO selagi belum ada barang diterima (aturan yang sama dengan server). */
  const cancelOrder = useCallback(
    async (orderId: string): Promise<void> => {
      const order = ordersRef.current.find((row) => row.id === orderId);
      if (!order) throw new Error("PO tidak ditemukan untuk tenant ini.");
      const allowed = canCancelOrder(order.lines, order.status);
      if (!allowed.ok) throw new Error(allowed.reason);

      updateOrders((current) =>
        current.map((row) =>
          row.id === orderId ? { ...row, status: "cancelled", cancelledAt: Date.now() } : row,
        ),
      );
    },
    [updateOrders],
  );

  /**
   * Menerima barang (GRN): stok masuk ke lokasi yang dipilih dan harga beli
   * terakhir ikut tersimpan di produk — sama seperti `purchasing.receive`.
   * Tidak digerbang fitur: barang yang sudah dipesan harus bisa dicatat datang.
   */
  const receiveGoods = useCallback(
    async (input: ReceiveGoodsInput): Promise<{ number: string; total: number }> => {
      const order = ordersRef.current.find((row) => row.id === input.orderId);
      if (!order) throw new Error("PO tidak ditemukan untuk tenant ini.");

      let locationName = defaultWarehouse().name;
      const targetWarehouseId =
        input.warehouseId && input.warehouseId !== DEFAULT_WAREHOUSE_ID
          ? input.warehouseId
          : null;
      if (targetWarehouseId) {
        const warehouse = warehousesRef.current.find((row) => row.id === targetWarehouseId);
        if (!warehouse) throw new Error("Gudang tidak ditemukan untuk tenant ini.");
        if (!warehouse.active) {
          throw new Error(`${describeWarehouse(warehouse)} sedang nonaktif; aktifkan dulu.`);
        }
        locationName = describeWarehouse(warehouse);
      }

      const plan = planReceipt({
        status: order.status,
        lines: order.lines as OrderLine[],
        requests: input.lines,
      });
      if (!plan.ok || !plan.value) throw new Error(plan.reason);
      const receipt = plan.value;
      const number = nextDocumentNumber("GRN", receiptsRef.current.map((row) => row.number));

      for (const line of receipt.lines) {
        if (targetWarehouseId) {
          updateWarehouseStock((current) => ({
            ...current,
            [line.productId]: {
              ...(current[line.productId] ?? {}),
              [targetWarehouseId]: (current[line.productId]?.[targetWarehouseId] ?? 0) + line.quantity,
            },
          }));
        } else {
          updateProducts((current) =>
            current.map((row) =>
              row.id === line.productId ? { ...row, stock: row.stock + line.quantity } : row,
            ),
          );
        }
        if (line.unitCost > 0) {
          updateProducts((current) =>
            current.map((row) =>
              row.id === line.productId ? { ...row, cost: line.unitCost } : row,
            ),
          );
        }
      }

      updateOrders((current) =>
        current.map((row) => {
          if (row.id !== input.orderId) return row;
          return {
            ...row,
            status: receipt.status,
            receivedAt: receipt.status === "received" ? Date.now() : row.receivedAt,
            lines: row.lines.map((line) => {
              const received = receipt.lines.find((entry) => entry.productId === line.productId);
              return received
                ? { ...line, receivedQty: line.receivedQty + received.quantity }
                : line;
            }),
          };
        }),
      );

      updateReceipts((current) => [
        {
          id: `grn-${Date.now()}`,
          number,
          orderId: input.orderId,
          orderNumber: order.number,
          warehouseId: targetWarehouseId ?? DEFAULT_WAREHOUSE_ID,
          locationName,
          note: input.note?.trim() || undefined,
          total: receipt.total,
          createdAt: Date.now(),
          lines: receipt.lines.map((line) => ({
            productId: line.productId,
            name: line.name,
            quantity: line.quantity,
            unitCost: line.unitCost,
          })),
        },
        ...current,
      ]);

      // Barang yang datang dengan tempo supplier berarti hutang, lahir di
      // transaksi yang sama dengan stoknya (sama seperti `purchasing.receive`).
      const supplier = suppliersRef.current.find((row) => row.id === order.supplierId);
      const payableDraft = buildPayableForReceipt({
        supplier: supplier ?? { name: "Supplier", paymentTermDays: 0 },
        total: receipt.total,
        receivedAt: Date.now(),
      });
      if (!payableDraft.ok) throw new Error(payableDraft.reason);

      if (payableDraft.value) {
        const payableNumber = nextDocumentNumber(
          "AP",
          payablesRef.current.map((row) => row.number),
        );
        updatePayables((current) => [
          {
            id: `ap-${Date.now()}`,
            number: payableNumber,
            supplierId: order.supplierId,
            orderNumber: order.number,
            receiptNumber: number,
            amount: payableDraft.value!.amount,
            paidAmount: 0,
            dueDate: payableDraft.value!.dueDate,
            paymentTermDays: payableDraft.value!.paymentTermDays,
            status: "open" as PayableStatus,
            note: `${order.number} · ${number}`,
            createdAt: Date.now(),
          },
          ...current,
        ]);
      }

      return { number, total: receipt.total };
    },
    [updateOrders, updatePayables, updateProducts, updateReceipts, updateWarehouseStock],
  );

  /** Mengubah supplier: kontak, tempo, dan status aktif (izin `purchase.approve`). */
  const updateSupplier = useCallback(
    async (input: UpdateSupplierInput): Promise<void> => {
      const existing = suppliersRef.current.find((row) => row.id === input.supplierId);
      if (!existing) throw new Error("Supplier tidak ditemukan untuk tenant ini.");

      const resolved = resolveSupplierUpdate(existing, {
        name: input.name,
        phone: input.phone,
        address: input.address,
        paymentTermDays: input.paymentTermDays,
        active: input.active,
      });
      if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
      const supplier = resolved.value;

      updateSuppliers((current) =>
        current.map((row) =>
          row.id === input.supplierId
            ? {
                ...row,
                name: supplier.name,
                phone: supplier.phone,
                address: supplier.address,
                paymentTermDays: supplier.paymentTermDays,
                active: supplier.active,
              }
            : row,
        ),
      );
    },
    [updateSuppliers],
  );

  /**
   * Mencatat tagihan supplier di luar PO — saldo awal atau tagihan jasa yang
   * baru ditagihkan sekarang. Komitmen baru, jadi butuh fitur `purchasing.basic`.
   */
  const createBill = useCallback(
    async (input: CreateBillInput): Promise<{ id: string; number: string }> => {
      requireModuleFeature("purchasing.basic");

      const supplier = suppliersRef.current.find((row) => row.id === input.supplierId);
      if (!supplier) throw new Error("Supplier tidak ditemukan untuk tenant ini.");

      const resolved = resolveBillInput(
        {
          reference: input.reference,
          amount: input.amount,
          dueDate: input.dueDate,
          note: input.note,
        },
        { supplierName: supplier.name },
      );
      if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
      const bill = resolved.value;

      const number = nextDocumentNumber("AP", payablesRef.current.map((row) => row.number));
      const id = `ap-${Date.now()}`;
      updatePayables((current) => [
        {
          id,
          number,
          supplierId: input.supplierId,
          reference: bill.reference,
          amount: bill.amount,
          paidAmount: 0,
          dueDate: bill.dueDate,
          paymentTermDays: 0,
          status: "open" as PayableStatus,
          note: bill.note,
          createdAt: Date.now(),
        },
        ...current,
      ]);
      return { id, number };
    },
    [requireModuleFeature, updatePayables],
  );

  /** Membayar hutang supplier, boleh sebagian — tidak digerbang fitur. */
  const recordPayablePayment = useCallback(
    async (input: RecordPayablePaymentInput): Promise<{ remaining: number }> => {
      const payable = payablesRef.current.find((row) => row.id === input.payableId);
      if (!payable) throw new Error("Hutang tidak ditemukan untuk tenant ini.");

      // Tagihan bersengketa menahan uang — aturan yang sama dengan server.
      const payableAllowed = canPayPayable(payable.matchDecision ?? null);
      if (!payableAllowed.ok) throw new Error(payableAllowed.reason);

      const applied = applyPayablePayment(toPayableLike(payable), input.amount);
      if (!applied.ok) throw new Error(applied.reason);

      updatePayables((current) =>
        current.map((row) =>
          row.id === input.payableId
            ? {
                ...row,
                paidAmount: row.paidAmount + applied.accepted,
                status: (applied.fullyPaid ? "paid" : "open") as PayableStatus,
              }
            : row,
        ),
      );

      setPayablePayments((current) => [
        {
          id: `app-${Date.now()}`,
          payableId: input.payableId,
          payableNumber: payable.number,
          supplierName:
            suppliersRef.current.find((row) => row.id === payable.supplierId)?.name ??
            "Supplier dihapus",
          amount: applied.accepted,
          method: input.method,
          note: input.note?.trim() || undefined,
          createdAt: Date.now(),
        },
        ...current,
      ]);

      return { remaining: applied.remaining };
    },
    [updatePayables],
  );

  /**
   * Mencatat **dokumen supplier** lalu mencocokkannya dengan PO & penerimaan
   * (fitur `purchasing.threeway`). Totalnya dihitung dari baris yang ditagih,
   * jadi baris dan total tidak pernah berbeda.
   */
  const recordInvoice = useCallback(
    async (
      input: RecordInvoiceInput,
    ): Promise<{ reference: string | null; total: number; flagged: boolean; reasons: string[] }> => {
      requireModuleFeature("purchasing.threeway");

      const payable = payablesRef.current.find((row) => row.id === input.payableId);
      if (!payable) throw new Error("Hutang tidak ditemukan untuk tenant ini.");

      const allowed = canRecordInvoice({
        status: payable.status as PayableStatus,
        hasInvoice: payable.invoice !== undefined,
        hasReceipt: payable.receiptNumber !== undefined,
      });
      if (!allowed.ok) throw new Error(allowed.reason);

      const { orderLines, receiptLines } = matchInputFor(payable);
      if (receiptLines.length === 0) {
        throw new Error("Penerimaan barang ini tidak punya baris untuk dicocokkan.");
      }

      const resolved = resolveInvoiceInput(
        { reference: input.reference, lines: input.lines, note: input.note },
        { orderLines, receiptLines },
      );
      if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
      const invoice = resolved.value;

      const due = resolveDueDate(input.dueDate ?? payable.dueDate);
      if (!due.ok || due.value === undefined) throw new Error(due.reason);
      const dueDate = due.value;

      const recordedAt = Date.now();
      updatePayables((current) =>
        current.map((row) =>
          row.id === input.payableId
            ? {
                ...row,
                reference: invoice.reference ?? row.reference,
                dueDate,
                invoice: {
                  reference: invoice.reference,
                  total: invoice.total,
                  lines: invoice.lines,
                  note: invoice.note,
                  recordedAt,
                },
              }
            : row,
        ),
      );

      const match = matchPayable({
        orderLines,
        receiptLines,
        invoice: { ...invoice, recordedAt },
      });

      return {
        reference: invoice.reference ?? null,
        total: invoice.total,
        flagged: match.flagged,
        reasons: match.reasons,
      };
    },
    [matchInputFor, requireModuleFeature, updatePayables],
  );

  /**
   * Keputusan selisih: menerima (nilai hutang ikut total tagihan supplier),
   * menyengketakan (pembayaran ditahan), atau mencabut sengketa.
   */
  const resolvePayableMatch = useCallback(
    async (
      input: ResolveMatchInput,
    ): Promise<{ kind: "accepted" | "disputed" | null; amount: number }> => {
      requireModuleFeature("purchasing.threeway");

      const payable = payablesRef.current.find((row) => row.id === input.payableId);
      if (!payable) throw new Error("Hutang tidak ditemukan untuk tenant ini.");
      if (payable.status === "void") throw new Error("Tagihan ini sudah dibatalkan.");

      const match = matchPayable({
        ...matchInputFor(payable),
        invoice: payable.invoice ?? null,
      });
      const resolved = resolveMatchDecision(
        { kind: input.kind, note: input.note },
        { current: payable.matchDecision ?? null, hasVariance: match.flagged },
      );
      if (!resolved.ok) throw new Error(resolved.reason);
      const decision = resolved.value;

      const amount = amountAfterDecision({
        currentAmount: payable.amount,
        paidAmount: payable.paidAmount,
        match,
        decision: decision ?? null,
      });

      updatePayables((current) =>
        current.map((row) =>
          row.id === input.payableId
            ? { ...row, matchDecision: decision ?? undefined, amount }
            : row,
        ),
      );

      return { kind: decision?.kind ?? null, amount };
    },
    [matchInputFor, requireModuleFeature, updatePayables],
  );

  /**
   * Membayar beberapa tagihan sekaligus dalam satu nomor `PAY-…` — tidak
   * digerbang fitur, sama seperti pembayaran satuan.
   */
  const payPayables = useCallback(
    async (
      input: PayBatchInput,
    ): Promise<{ batchNumber: string; total: number; bills: number }> => {
      const plan = planBatchPayment({
        payables: payablesRef.current.map((row) => ({
          ...toPayableLike(row),
          id: row.id,
          number: row.number,
          supplierName: suppliersRef.current.find((s) => s.id === row.supplierId)?.name,
          decision: row.matchDecision ?? null,
        })),
        requests: input.payments,
      });
      if (!plan.ok || !plan.value) throw new Error(plan.reason);
      const rows = plan.value.rows;

      const batchNumber = nextDocumentNumber(
        "PAY",
        payablePayments
          .map((row) => row.batchNumber)
          .filter((value): value is string => Boolean(value)),
      );

      updatePayables((current) =>
        current.map((row) => {
          const applied = rows.find((entry) => entry.payableId === row.id);
          if (!applied) return row;
          return {
            ...row,
            paidAmount: row.paidAmount + applied.amount,
            status: (applied.fullyPaid ? "paid" : "open") as PayableStatus,
          };
        }),
      );

      const createdAt = Date.now();
      setPayablePayments((current) => [
        ...rows.map((row) => ({
          id: `app-${createdAt}-${row.payableId}`,
          payableId: row.payableId,
          payableNumber: row.number,
          supplierName: row.supplierName ?? "Supplier dihapus",
          amount: row.amount,
          method: input.method,
          note: input.note?.trim() || undefined,
          batchNumber,
          createdAt,
        })),
        ...current,
      ]);

      return { batchNumber, total: plan.value.total, bills: rows.length };
    },
    [payablePayments, updatePayables],
  );

  /** Member & diskon (`member.discount`, modul UMKM). */
  const createMember = useCallback(
    async (input: CreateMemberInput): Promise<{ id: string; code: string }> => {
      const resolved = resolveMemberInput(input, members.map((row) => row.code));
      if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
      const member = resolved.value;

      // Hanya diskon yang butuh modul; daftar member tetap bisa dirapikan.
      if (member.discountPct > 0) requireModuleFeature("member.discount");
      if (members.some((row) => row.code === member.code)) {
        throw new Error(`Kode member ${member.code} sudah dipakai.`);
      }

      const id = `member-${Date.now()}`;
      setMembers((current) => [...current, { id, ...member }]);
      return { id, code: member.code };
    },
    [members, requireModuleFeature],
  );

  const updateMember = useCallback(
    async (input: UpdateMemberInput): Promise<void> => {
      const existing = members.find((row) => row.id === input.memberId);
      if (!existing) throw new Error("Member tidak ditemukan untuk tenant ini.");

      const discountPct = input.discountPct ?? existing.discountPct;
      if (discountPct > 0) requireModuleFeature("member.discount");

      const resolved = resolveMemberInput({
        name: input.name ?? existing.name,
        code: existing.code,
        phone: input.phone ?? existing.phone,
        discountPct,
        active: input.active ?? existing.active,
      });
      if (!resolved.ok || !resolved.value) throw new Error(resolved.reason);
      const next = resolved.value;

      setMembers((current) =>
        current.map((row) => (row.id === input.memberId ? { id: row.id, ...next } : row)),
      );
    },
    [members, requireModuleFeature],
  );

  /**
   * Kirim PDF struk ke WhatsApp pembeli — **disimulasikan** di mode demo.
   *
   * Mode demo tidak punya kunci WhatsApp mana pun, jadi tidak ada pesan yang
   * benar-benar keluar; yang diuji di sini adalah jalur lengkapnya: nomor
   * diutamakan dari data member, nomor yang diketik kasir dipakai sebagai
   * cadangan untuk member yang belum punya nomor (dan tetap divalidasi), member
   * tanpa nomor sama sekali ditolak beserta alasannya, **pembeli umum** (tanpa
   * `memberId`) memakai nomor yang diketik kasir sebagai satu-satunya tujuan dan
   * ditolak beralasan kalau nomornya belum diisi, dan pemanggilnya menerima nomor
   * penerima yang sudah tersensor. Hasilnya ditandai `simulated` supaya halaman
   * kasir bisa mengatakannya apa adanya — bukan mengklaim terkirim.
   */
  const sendReceiptWhatsapp = useCallback(
    async (input: SendReceiptWhatsappInput): Promise<ReceiptWhatsappSendResult> => {
      /*
        `memberId` kosong berarti penjualan itu memang **tanpa member** (pembeli
        umum), bukan “membernya tidak ketemu” — jadi yang diperiksa nomornya,
        bukan keberadaan membernya.
      */
      const member = input.memberId
        ? (members.find((row) => row.id === input.memberId) ?? null)
        : null;
      if (input.memberId && !member) {
        return {
          ok: false,
          code: "no-member",
          reason: "Member penerima struk tidak ditemukan untuk workspace ini.",
        };
      }

      // Aturan “nomor mana yang dipakai” sama persis dengan server — fungsi murni
      // yang dipakai bersama, jadi demo tidak pernah menebak aturannya sendiri.
      const tujuan = receiptWhatsappRecipient(
        member?.phone ?? null,
        input.phone,
        member ? "member" : "umum",
      );
      if (!tujuan.ok) {
        return {
          ok: false,
          code: "no-phone",
          reason: member
            ? `Member ${member.name} belum punya nomor WhatsApp. Isi nomornya di kolom “Nomor WhatsApp” pada dialog struk, atau lengkapi di halaman Member, lalu kirim ulang.`
            : tujuan.reason,
        };
      }

      if (input.imageBase64.trim() === "") {
        return {
          ok: false,
          code: "failed",
          reason: "Gambar struknya kosong, jadi tidak ada yang bisa dikirim.",
        };
      }

      return {
        ok: true,
        to: maskPhone(tujuan.phone),
        messageId: `demo-${Date.now()}`,
        simulated: true,
      };
    },
    [members],
  );

  // -------------------- Phase 4: peran kustom (`rbac.custom`) -------------
  const actingBaseRole = session?.tenant?.role ?? "owner";

  const storeCustomRoles: StoreCustomRole[] = useMemo(
    () =>
      customRoles
        .map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          permissions: sanitizePermissions(role.permissions),
          active: role.active,
          memberCount: roleAssignments(role.id, teamMembers),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "id")),
    [customRoles, teamMembers],
  );

  const roleSummary: StoreRoleSummary = useMemo(
    () => ({
      total: storeCustomRoles.length,
      active: storeCustomRoles.filter((row) => row.active).length,
      assignedMembers: storeCustomRoles.reduce((sum, row) => sum + row.memberCount, 0),
      limit: MAX_CUSTOM_ROLES,
      canCreate: storeCustomRoles.length < MAX_CUSTOM_ROLES,
    }),
    [storeCustomRoles],
  );

  const storeTeamMembers: StoreTeamMember[] = useMemo(
    () =>
      teamMembers.map((member) => {
        const role =
          customRoles.find((row) => row.id === (member.customRoleId ?? "")) ?? null;
        // Peran kustom yang nonaktif tidak berlaku lagi — anggota kembali ke
        // peran bawaannya, sama seperti resolusi di backend.
        const effective = role && role.active ? role : null;
        return {
          membershipId: member.membershipId,
          userId: member.userId,
          name: member.name,
          email: member.email,
          role: member.role,
          customRoleId: effective ? effective.id : null,
          customRoleName: effective ? effective.name : null,
          permissions: effectivePermissions(member.role, effective?.permissions ?? null),
          active: member.active,
          invite: member.invite
            ? {
                sentAt: member.invite.sentAt,
                via: member.invite.via,
                error: member.invite.error,
                attempts: member.invite.attempts,
              }
            : EMPTY_INVITE_DELIVERY,
          phone: member.phone ?? null,
          waInvite: member.waInvite
            ? { at: member.waInvite.at, count: member.waInvite.count }
            : EMPTY_WA_INVITE,
        };
      }),
    [customRoles, teamMembers],
  );

  const createCustomRole = useCallback(
    async (input: CreateCustomRoleInput): Promise<{ id: string; name: string }> => {
      requireModuleFeature("rbac.custom");
      const validation = validateCustomRole(input, {
        actingRole: actingBaseRole,
        existingNames: customRoles.map((row) => row.name),
        count: customRoles.length,
      });
      if (!validation.ok) throw new Error(validation.reason);
      const draft = validation.value;
      const id = `role-${Date.now()}`;
      setCustomRoles((current) => [...current, { id, ...draft, active: true }]);
      return { id, name: draft.name };
    },
    [actingBaseRole, customRoles, requireModuleFeature],
  );

  const updateCustomRole = useCallback(
    async (input: UpdateCustomRoleInput): Promise<void> => {
      const existing = customRoles.find((row) => row.id === input.roleId);
      if (!existing) throw new Error("Peran kustom tidak ditemukan untuk tenant ini.");

      // Menonaktifkan peran tanpa mengubah izinnya selalu boleh: itu cara
      // mencabut akses saat paket turun, tanpa perlu fitur `rbac.custom`.
      if (
        input.active === false &&
        input.name === undefined &&
        input.permissions === undefined
      ) {
        setCustomRoles((current) =>
          current.map((row) =>
            row.id === input.roleId ? { ...row, active: false } : row,
          ),
        );
        return;
      }

      requireModuleFeature("rbac.custom");
      const validation = validateCustomRole(
        {
          name: input.name ?? existing.name,
          description: input.description ?? existing.description,
          permissions: input.permissions ?? existing.permissions,
        },
        {
          actingRole: actingBaseRole,
          existingNames: customRoles
            .filter((row) => row.id !== input.roleId)
            .map((row) => row.name),
        },
      );
      if (!validation.ok) throw new Error(validation.reason);
      const draft = validation.value;

      setCustomRoles((current) =>
        current.map((row) =>
          row.id === input.roleId
            ? { ...row, ...draft, active: input.active ?? row.active }
            : row,
        ),
      );
    },
    [actingBaseRole, customRoles, requireModuleFeature],
  );

  const deleteCustomRole = useCallback(
    async (roleId: string): Promise<void> => {
      const existing = customRoles.find((row) => row.id === roleId);
      if (!existing) throw new Error("Peran kustom tidak ditemukan untuk tenant ini.");
      const used = roleAssignments(roleId, teamMembers);
      if (used > 0) {
        throw new Error(
          `Peran "${existing.name}" masih dipakai ${used} anggota; pindahkan mereka ke peran lain dulu.`,
        );
      }
      setCustomRoles((current) => current.filter((row) => row.id !== roleId));
    },
    [customRoles, teamMembers],
  );

  const assignCustomRole = useCallback(
    async (membershipId: string, roleId: string | null): Promise<void> => {
      const target = teamMembers.find((row) => row.membershipId === membershipId);
      if (!target) throw new Error("Anggota tidak ditemukan untuk tenant ini.");

      const blocked = assignmentError(target.role);
      if (blocked) throw new Error(blocked);

      if (roleId === null) {
        setTeamMembers((current) =>
          current.map((row) =>
            row.membershipId === membershipId ? { ...row, customRoleId: null } : row,
          ),
        );
        return;
      }

      requireModuleFeature("rbac.custom");
      const role = customRoles.find((row) => row.id === roleId);
      if (!role) throw new Error("Peran kustom tidak ditemukan untuk tenant ini.");
      if (!role.active) {
        throw new Error(
          `Peran "${role.name}" sedang nonaktif; aktifkan dulu sebelum ditugaskan.`,
        );
      }

      const lacking = lackingPermissions(actingBaseRole, role.permissions);
      if (lacking.length > 0) {
        throw new Error(
          `Anda tidak bisa menugaskan peran yang punya izin di luar wewenang Anda (${lacking.join(", ")}).`,
        );
      }

      setTeamMembers((current) =>
        current.map((row) =>
          row.membershipId === membershipId ? { ...row, customRoleId: role.id } : row,
        ),
      );
    },
    [actingBaseRole, customRoles, requireModuleFeature, teamMembers],
  );

  // -------------------- Phase 4: akses API & webhook (`api.access`) -------
  /**
   * Izin efektif pembuat, bukan hanya `role`: anggota yang berperan kustom
   * tetap tidak bisa memberi kunci dengan scope di luar izinnya — pagar yang
   * sama seperti di server (`resolveMembershipPermissions`).
   */
  const actingEffectivePermissions = useMemo(
    () => actingPermissions(session),
    [session],
  );

  /**
   * Mendaftarkan anggota tim baru (mode demo) — aturan yang sama dengan server.
   *
   * Butuh izin `team.manage`, emailnya harus email yang benar-benar bisa menerima
   * kode masuk (`validateTeamInvite`, aturan yang dipakai `members.add`), dan hanya
   * pemilik yang boleh menetapkan peran pemilik. Baris anggota ditambahkan ke
   * keadaan store, jadi daftar di halaman Tim & Peran berubah seketika — sama
   * seperti `members.list` yang reaktif di mode Convex.
   */
  const addTeamMember = useCallback(
    async (input: InviteTeamMemberInput): Promise<InvitedTeamMember> => {
      if (!actingEffectivePermissions.includes("team.manage")) {
        throw new Error(
          `Akses ditolak: peran ${actingBaseRole} tidak memiliki izin team.manage.`,
        );
      }
      const invite = validateTeamInvite(
        { email: input.email, name: input.name, role: input.role },
        { actingRole: actingBaseRole },
      );
      if (!invite.ok) throw new Error(invite.reason);
      const { email, name, role } = invite.value;

      // Nomor WhatsApp opsional: harus benar-benar bisa dibuka `wa.me`.
      let phone: string | null = null;
      if (input.phone && input.phone.trim() !== "") {
        const nomor = normalizePhone(input.phone);
        if (!nomor.valid || !nomor.value) {
          throw new Error(nomor.reason ?? "Nomor WhatsApp tidak valid.");
        }
        phone = nomor.value;
      }

      const existing = teamMembers.find((row) => row.email === email);
      if (existing) {
        // Undangan untuk email yang sudah jadi anggota = perubahan peran, bukan
        // baris kedua — anggota lama tidak boleh terlihat dua kali di daftar.
        setTeamMembers((current) =>
          current.map((row) =>
            row.membershipId === existing.membershipId
              ? { ...row, name, role, active: true, phone: phone ?? row.phone }
              : row,
          ),
        );
        return {
          membershipId: existing.membershipId,
          userId: existing.userId,
          email,
          role,
          created: false,
          invite: existing.invite ?? EMPTY_INVITE_DELIVERY,
        };
      }

      // Id diturunkan dari email: dua undangan untuk orang yang sama tidak pernah
      // menghasilkan dua baris, walau tombolnya ditekan dua kali.
      const slug = email.replace(/[^a-z0-9]+/g, "-");
      const membershipId = `mem-${slug}`;
      const userId = `u-${slug}`;
      // Mode demo tidak punya penyedia email: undangannya **tidak** dikirim,
      // dan itu ditulis terus-terang (`via: "demo"`) supaya layar tidak pernah
      // mengaku sudah mengirim sesuatu yang tidak berangkat.
      const inviteState = {
        sentAt: Date.now(),
        via: "demo",
        error: null,
        attempts: 1,
      };
      setTeamMembers((current) => [
        ...current,
        {
          membershipId,
          userId,
          name,
          email,
          role,
          customRoleId: null,
          active: true,
          invite: inviteState,
          phone,
        },
      ]);
      return { membershipId, userId, email, role, created: true, invite: inviteState };
    },
    [actingBaseRole, actingEffectivePermissions, teamMembers],
  );

  /**
   * Anggota yang mewakili pemakai aktif di mode demo.
   *
   * Dipakai pagar “akun sendiri” (tidak bisa menonaktifkan atau menghapus dirinya)
   * supaya mode demo berperilaku sama dengan server: yang dicari lebih dulu adalah
   * baris dengan email sesi, kalau tidak ada maka pemilik aktif pertama — peran
   * yang paling mungkin sedang dipakai orang yang membuka halaman ini.
   */
  const actingMembershipId = useMemo(() => {
    const email = (session?.user.email ?? "").trim().toLowerCase();
    const row =
      teamMembers.find((member) => member.email === email) ??
      teamMembers.find((member) => member.role === "owner" && member.active) ??
      null;
    return row?.membershipId ?? null;
  }, [session, teamMembers]);

  /**
   * Mengubah anggota tim (mode demo) — aturan yang sama dengan `members.update`:
   * nama/email/peran/nomor WA/status, dengan pagar pemilik terakhir dan pemilik
   * yang hanya boleh disentuh sesama pemilik.
   */
  const updateTeamMember = useCallback(
    async (
      input: UpdateTeamMemberInput,
    ): Promise<{ email: string; changed: string[] }> => {
      if (!actingEffectivePermissions.includes("team.manage")) {
        throw new Error(
          `Akses ditolak: peran ${actingBaseRole} tidak memiliki izin team.manage.`,
        );
      }
      const target = teamMembers.find((row) => row.membershipId === input.membershipId);
      if (!target) throw new Error("Anggota tidak ditemukan untuk tenant ini.");

      const decision = validateTeamMemberEdit(
        {
          membershipId: target.membershipId,
          name: target.name,
          email: target.email,
          role: target.role,
          phone: target.phone ?? null,
          active: target.active,
        },
        {
          name: input.name,
          email: input.email,
          role: input.role,
          phone: input.phone,
          active: input.active,
        },
        {
          actingRole: actingBaseRole,
          actorMembershipId: actingMembershipId,
          activeOwners: teamMembers.filter((row) => row.role === "owner" && row.active)
            .length,
          otherEmails: teamMembers
            .filter((row) => row.membershipId !== input.membershipId)
            .map((row) => row.email.trim().toLowerCase()),
        },
      );
      if (!decision.ok) throw new Error(decision.reason);
      if (decision.changed.length === 0) {
        return { email: decision.value.email, changed: [] };
      }

      setTeamMembers((current) =>
        current.map((row) =>
          row.membershipId === input.membershipId
            ? {
                ...row,
                name: decision.value.name,
                email: decision.value.email,
                role: decision.value.role,
                phone: decision.value.phone,
                active: decision.value.active,
              }
            : row,
        ),
      );
      return { email: decision.value.email, changed: decision.changed };
    },
    [actingBaseRole, actingEffectivePermissions, actingMembershipId, teamMembers],
  );

  /** Menghapus anggota dari tim (mode demo) — keanggotaan saja, bukan akunnya. */
  const removeTeamMember = useCallback(
    async (membershipId: string): Promise<{ email: string }> => {
      if (!actingEffectivePermissions.includes("team.manage")) {
        throw new Error(
          `Akses ditolak: peran ${actingBaseRole} tidak memiliki izin team.manage.`,
        );
      }
      const target = teamMembers.find((row) => row.membershipId === membershipId);
      if (!target) throw new Error("Anggota tidak ditemukan untuk tenant ini.");

      const decision = validateTeamMemberRemoval(
        { membershipId: target.membershipId, role: target.role, active: target.active },
        {
          actingRole: actingBaseRole,
          actorMembershipId: actingMembershipId,
          activeOwners: teamMembers.filter((row) => row.role === "owner" && row.active)
            .length,
        },
      );
      if (!decision.ok) throw new Error(decision.reason);

      setTeamMembers((current) =>
        current.filter((row) => row.membershipId !== membershipId),
      );
      return { email: target.email };
    },
    [actingBaseRole, actingEffectivePermissions, actingMembershipId, teamMembers],
  );

  /** Mencatat tautan undangan WhatsApp yang dibuka pengundang (mode demo). */
  const recordWaInvite = useCallback(
    async (membershipId: string): Promise<void> => {
      if (!actingEffectivePermissions.includes("team.manage")) {
        throw new Error(
          `Akses ditolak: peran ${actingBaseRole} tidak memiliki izin team.manage.`,
        );
      }
      const target = teamMembers.find((row) => row.membershipId === membershipId);
      if (!target) throw new Error("Anggota tidak ditemukan untuk tenant ini.");
      if (!target.phone) throw new Error("Anggota ini belum punya nomor WhatsApp.");

      setTeamMembers((current) =>
        current.map((row) =>
          row.membershipId === membershipId
            ? {
                ...row,
                waInvite: {
                  at: Date.now(),
                  count: (row.waInvite?.count ?? 0) + 1,
                },
              }
            : row,
        ),
      );
    },
    [actingBaseRole, actingEffectivePermissions, teamMembers],
  );

  /**
   * Kirim ulang undangan (mode demo).
   *
   * Yang berubah hanya jejaknya: `attempts` naik dan waktunya diperbarui, dengan
   * `via: "demo"` yang tetap mengatakan bahwa tidak ada email yang benar-benar
   * berangkat di mode ini.
   */
  const resendInvite = useCallback(
    async (membershipId: string): Promise<{ email: string }> => {
      if (!actingEffectivePermissions.includes("team.manage")) {
        throw new Error(
          `Akses ditolak: peran ${actingBaseRole} tidak memiliki izin team.manage.`,
        );
      }
      const target = teamMembers.find((row) => row.membershipId === membershipId);
      if (!target) throw new Error("Anggota tidak ditemukan untuk tenant ini.");

      const inviteState = {
        sentAt: Date.now(),
        via: "demo",
        error: null,
        attempts: (target.invite?.attempts ?? 0) + 1,
      };
      setTeamMembers((current) =>
        current.map((row) =>
          row.membershipId === membershipId ? { ...row, invite: inviteState } : row,
        ),
      );
      return { email: target.email };
    },
    [actingBaseRole, actingEffectivePermissions, teamMembers],
  );

  const storeApiKeys: StoreApiKey[] = useMemo(() => {
    const now = Date.now();
    return apiKeys
      .map((key) => ({
        id: key.id,
        name: key.name,
        mask: maskApiKey(key.publicId),
        publicId: key.publicId,
        scopes: sanitizeApiScopes(key.scopes),
        creatorRole: key.creatorRole,
        status: keyStatus(key, now) as ApiKeyStatus,
        expiresAt: key.expiresAt ?? null,
        lastUsedAt: key.lastUsedAt ?? null,
        createdAt: key.createdAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [apiKeys]);

  const apiKeySummary: StoreApiKeySummary = useMemo(() => {
    const soon = Date.now() + 14 * DAY_MS;
    return {
      active: storeApiKeys.filter((row) => row.status === "active").length,
      revoked: storeApiKeys.filter((row) => row.status === "revoked").length,
      expiringSoon: storeApiKeys.filter(
        (row) => row.status === "active" && row.expiresAt !== null && row.expiresAt <= soon,
      ).length,
    };
  }, [storeApiKeys]);

  const storeWebhookEndpoints: StoreWebhookEndpoint[] = useMemo(
    () =>
      webhookEndpoints
        .map((endpoint) => ({
          id: endpoint.id,
          url: endpoint.url,
          description: endpoint.description,
          events: sanitizeWebhookEvents(endpoint.events),
          active: endpoint.active,
          secretLastFour: endpoint.secretLastFour,
          createdAt: endpoint.createdAt,
          updatedAt: endpoint.updatedAt,
        }))
        .sort((a, b) => b.createdAt - a.createdAt),
    [webhookEndpoints],
  );

  const storeWebhookDeliveries: StoreWebhookDelivery[] = useMemo(
    () => [...webhookDeliveries].sort((a, b) => b.createdAt - a.createdAt),
    [webhookDeliveries],
  );

  const webhookSummary: StoreWebhookSummary = useMemo(
    () => ({
      endpoints: storeWebhookEndpoints.length,
      activeEndpoints: storeWebhookEndpoints.filter((row) => row.active).length,
      pendingDeliveries: storeWebhookDeliveries.filter((row) => row.status === "pending").length,
      failedDeliveries: storeWebhookDeliveries.filter((row) => row.status === "failed").length,
    }),
    [storeWebhookEndpoints, storeWebhookDeliveries],
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
      requireModuleFeature("api.access");
      const existing = apiKeysRef.current;
      const validation = validateApiKeyInput(
        { name: input.name, scopes: input.scopes, expiresInDays: input.expiresInDays },
        {
          permissions: actingEffectivePermissions,
          existingNames: existing.map((row) => row.name),
          activeCount: existing.filter((row) => keyStatus(row, Date.now()) === "active").length,
        },
      );
      if (!validation.ok) throw new Error(validation.reason);
      const draft = validation.value;

      const minted = mintApiKey();
      const id = `key-${Date.now()}`;
      commitApiKeys([
        {
          id,
          name: draft.name,
          publicId: minted.publicId,
          secretHash: minted.secretHash,
          scopes: draft.scopes,
          creatorRole: actingBaseRole,
          active: true,
          expiresAt: draft.expiresAt,
          revokedAt: null,
          lastUsedAt: null,
          createdAt: Date.now(),
        },
        ...apiKeysRef.current,
      ]);

      return {
        id,
        name: draft.name,
        plaintext: minted.plaintext,
        mask: maskApiKey(minted.publicId),
        scopes: draft.scopes,
      };
    },
    [actingBaseRole, actingEffectivePermissions, commitApiKeys, requireModuleFeature],
  );

  const revokeApiKey = useCallback(
    async (keyId: string): Promise<void> => {
      // Tanpa gerbang fitur: mencabut akses harus selalu mungkin.
      const existing = apiKeysRef.current.find((row) => row.id === keyId);
      if (!existing) throw new Error("Kunci API tidak ditemukan untuk tenant ini.");
      if (!existing.active) throw new Error(`Kunci "${existing.name}" sudah dicabut.`);
      commitApiKeys(
        apiKeysRef.current.map((row) =>
          row.id === keyId ? { ...row, active: false, revokedAt: Date.now() } : row,
        ),
      );
    },
    [commitApiKeys],
  );

  const createWebhookEndpoint = useCallback(
    async (input: CreateWebhookEndpointInput): Promise<{ id: string; secret: string }> => {
      requireModuleFeature("api.access");
      if (webhookEndpointsRef.current.length >= MAX_WEBHOOK_ENDPOINTS) {
        throw new Error(
          `Maksimal ${MAX_WEBHOOK_ENDPOINTS} endpoint webhook per tenant; hapus yang tidak dipakai dulu.`,
        );
      }
      const validation = validateWebhookEndpoint(
        { url: input.url, description: input.description, events: input.events },
        { existingUrls: webhookEndpointsRef.current.map((row) => row.url) },
      );
      if (!validation.ok) throw new Error(validation.reason);
      const draft = validation.value;

      const secret = randomToken(API_KEY_SECRET_LENGTH, API_KEY_SECRET_ALPHABET);
      const now = Date.now();
      const id = `wh-${now}`;
      commitWebhookEndpoints([
        {
          id,
          url: draft.url,
          description: draft.description,
          events: draft.events,
          secret,
          secretLastFour: secret.slice(-4),
          active: true,
          createdAt: now,
          updatedAt: now,
        },
        ...webhookEndpointsRef.current,
      ]);
      return { id, secret };
    },
    [commitWebhookEndpoints, requireModuleFeature],
  );

  const updateWebhookEndpoint = useCallback(
    async (input: UpdateWebhookEndpointInput): Promise<{ secret: string | null }> => {
      const existing = webhookEndpointsRef.current.find((row) => row.id === input.endpointId);
      if (!existing) throw new Error("Endpoint webhook tidak ditemukan untuk tenant ini.");

      // Memutar rahasia atau mengubah langganan menambah komitmen baru dan
      // karenanya butuh fiturnya; menyalakan/mematikan selalu boleh.
      if (input.events !== undefined || input.rotateSecret === true) {
        requireModuleFeature("api.access");
      }

      let events = existing.events;
      if (input.events !== undefined) {
        events = sanitizeWebhookEvents(input.events);
        if (events.length === 0) throw new Error("Pilih minimal satu event yang mau dikirim.");
      }

      const secret =
        input.rotateSecret === true
          ? randomToken(API_KEY_SECRET_LENGTH, API_KEY_SECRET_ALPHABET)
          : null;
      const description =
        input.description === undefined
          ? existing.description
          : input.description.trim().slice(0, 120) || undefined;

      commitWebhookEndpoints(
        webhookEndpointsRef.current.map((row) =>
          row.id === input.endpointId
            ? {
                ...row,
                active: input.active ?? row.active,
                description,
                events,
                secret: secret ?? row.secret,
                secretLastFour: secret ? secret.slice(-4) : row.secretLastFour,
                updatedAt: Date.now(),
              }
            : row,
        ),
      );
      return { secret };
    },
    [commitWebhookEndpoints, requireModuleFeature],
  );

  const removeWebhookEndpoint = useCallback(
    async (endpointId: string): Promise<void> => {
      const existing = webhookEndpointsRef.current.find((row) => row.id === endpointId);
      if (!existing) throw new Error("Endpoint webhook tidak ditemukan untuk tenant ini.");
      commitWebhookEndpoints(
        webhookEndpointsRef.current.filter((row) => row.id !== endpointId),
      );
      commitWebhookDeliveries(
        webhookDeliveriesRef.current.filter((row) => row.endpointId !== endpointId),
      );
    },
    [commitWebhookDeliveries, commitWebhookEndpoints],
  );

  const testWebhookEndpoint = useCallback(
    async (endpointId: string): Promise<WebhookTestResult> => {
      const endpoint = webhookEndpointsRef.current.find((row) => row.id === endpointId);
      if (!endpoint) throw new Error("Endpoint webhook tidak ditemukan untuk tenant ini.");
      if (!endpoint.active) {
        throw new Error(
          `Endpoint ${endpoint.url} sedang nonaktif; aktifkan dulu sebelum mengirim uji.`,
        );
      }

      const now = Date.now();
      const event = sampleDeliveryEvent(endpoint.events);
      const payload = sampleDeliveryPayload(event, now);
      // Tanda tangannya benar-benar dihitung (HMAC-SHA256 atas `timestamp.body`),
      // jadi payload contoh yang ditampilkan halaman memakai skema yang sama
      // dengan kiriman produksi.
      const signature = signWebhookPayload(endpoint.secret, now, payload);

      if (signature.length === 0) {
        throw new Error("Payload uji tidak bisa ditandatangani; periksa rahasia endpoint.");
      }

      // Demo tidak mengirim ke jaringan: mode demo tidak punya server penerima,
      // jadi penerimanya disimulasikan menjawab 200 supaya alur "kirim uji →
      // riwayat" tetap terbaca. Di Convex, aksinya benar-benar POST.
      const row: StoreWebhookDelivery = {
        id: `whd-${now}`,
        endpointId,
        event,
        status: "delivered",
        attempts: 1,
        lastStatusCode: 200,
        lastError: null,
        nextAttemptAt: null,
        deliveredAt: now,
        createdAt: now,
      };
      commitWebhookDeliveries([row, ...webhookDeliveriesRef.current]);
      return { status: "delivered", attempts: 1, event, error: null };
    },
    [commitWebhookDeliveries],
  );

  // ------------- Phase 5: dukungan khusus (`support.dedicated`) -------------
  /** Janji dukungan paket demo, dari aturan murni yang sama dengan server. */
  const supportPlan: StoreSupportPlan = useMemo(() => {
    const profile = supportPlanFor(planKey);
    return {
      planKey,
      dedicated: isFeatureEnabled(
        entitlementFor(planKey),
        activeVerticals,
        "support.dedicated",
      ),
      ...profile,
    };
  }, [planKey, activeVerticals]);

  const supportLimits: StoreSupportLimits = useMemo(
    () => ({ maxOpenTickets: MAX_OPEN_TICKETS, maxLog: MAX_TICKET_LOG }),
    [],
  );

  /**
   * Tiket beserta status SLA-nya. Hanya peran dengan izin `support.view` yang
   * melihatnya — keuangan termasuk, karena banyak tiket memang soal tagihan.
   */
  const storeSupportTickets: StoreSupportTicket[] = useMemo(() => {
    if (!actingEffectivePermissions.includes("support.view")) return [];
    const now = Date.now();
    return supportTickets
      .map((ticket) => {
        const like = toSupportLike(ticket);
        const due = supportDueAt(like);
        return {
          id: ticket.id,
          number: ticket.number,
          subject: ticket.subject,
          category: ticket.category,
          priority: ticket.priority,
          status: ticket.status,
          slaHours: ticket.slaHours,
          escalated: ticket.escalated,
          body: ticket.body,
          log: ticket.log,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
          resolvedAt: ticket.resolvedAt,
          dueAt: due,
          slaState: supportSlaState(like, now),
          remainingHours: Math.max(0, Math.ceil((due - now) / HOUR_MS)),
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [supportTickets, actingEffectivePermissions]);

  const supportSummaryValue: StoreSupportSummary = useMemo(
    () => supportSummary(supportTickets.map(toSupportLike), Date.now()),
    [supportTickets],
  );

  const createSupportTicket = useCallback(
    async (
      input: CreateSupportTicketInput,
    ): Promise<{ id: string; number: string; slaHours: number }> => {
      const validation = validateTicketInput(
        {
          subject: input.subject,
          category: input.category,
          priority: input.priority,
          body: input.body,
        },
        {
          dedicated: supportPlan.dedicated,
          openCount: openTicketCount(supportTicketsRef.current.map(toSupportLike)),
        },
      );
      if (!validation.ok) throw new Error(validation.reason);
      const draft = validation.value;

      const now = Date.now();
      ticketSequenceRef.current += 1;
      const number = ticketNumber(
        ticketSequenceRef.current,
        new Date(now).getFullYear(),
      );
      const slaHours = responseHoursFor(planKey, draft.priority);
      const record: DemoTicketRecord = {
        id: `tkt-${now}`,
        number,
        subject: draft.subject,
        category: draft.category,
        priority: draft.priority,
        status: "open",
        slaHours,
        escalated: false,
        body: draft.body,
        createdAt: now,
        resolvedAt: null,
        updatedAt: now,
        log: [{ at: now, kind: "status", body: "Tiket dibuat." }],
      };
      commitSupportTickets([record, ...supportTicketsRef.current]);
      return { id: record.id, number, slaHours };
    },
    [commitSupportTickets, planKey, supportPlan.dedicated],
  );

  const actSupportTicket = useCallback(
    async (input: ActSupportTicketInput): Promise<void> => {
      const ticket = supportTicketsRef.current.find((row) => row.id === input.ticketId);
      if (!ticket) throw new Error("Tiket dukungan tidak ditemukan untuk tenant ini.");

      // Eskalasi bagian dari janji dukungan khusus; menambah catatan, menutup,
      // dan membuka ulang tiket selalu boleh.
      if (input.action === "escalate" && !supportPlan.dedicated) {
        throw new Error(
          `Eskalasi ke manajer akun memerlukan fitur ${FEATURE_LABELS["support.dedicated"]} (paket ${PLANS.enterprise.name}).`,
        );
      }

      const now = Date.now();
      const patch = applySupportAction(toSupportLike(ticket), input.action, {
        now,
        note: input.note,
      });
      if (!patch.ok) throw new Error(patch.reason);
      const value = patch.value;
      const event = {
        at: now,
        kind: value.kind,
        body: logBodyFor(input.action, value),
      };

      commitSupportTickets(
        supportTicketsRef.current.map((row) =>
          row.id === ticket.id
            ? {
                ...row,
                status: value.status,
                escalated: value.escalated,
                resolvedAt: value.resolvedAt,
                updatedAt: now,
                log: [...row.log, event].slice(-MAX_TICKET_LOG),
              }
            : row,
        ),
      );
    },
    [commitSupportTickets, supportPlan.dedicated],
  );

  // -------- Phase 6: pembayaran digital (`payment.digital`) -----------------
  /** Apakah kanal tagih digital hidup di paket + modul tenant demo ini. */
  const digitalPlan: StoreDigitalPlan = useMemo(() => {
    const digital = isFeatureEnabled(
      entitlementFor(planKey),
      activeVerticals,
      "payment.digital",
    );
    return { planKey, digital, planName: PLANS[planKey].name };
  }, [planKey, activeVerticals]);

  const digitalLimits: StoreDigitalLimits = useMemo(
    () => ({
      minAmount: DIGITAL_MIN_AMOUNT,
      maxAmount: DIGITAL_MAX_AMOUNT,
      referenceMax: DIGITAL_REFERENCE_MAX,
      reasonMax: DIGITAL_REASON_MAX,
      expiringSoonSeconds: EXPIRING_SOON_SECONDS,
      qrisExpiryMinutes: QRIS_EXPIRY_MINUTES,
      vaExpiryMinutes: VA_EXPIRY_MINUTES,
    }),
    [],
  );

  /**
   * Tagihan beserta status efektifnya. Hanya peran dengan izin `payment.view`
   * yang melihatnya; kedaluwarsa diturunkan dari tenggat, bukan status simpanan.
   */
  const storeDigitalCharges: StoreDigitalCharge[] = useMemo(() => {
    if (!actingEffectivePermissions.includes("payment.view")) return [];
    const now = Date.now();
    return digitalCharges
      .map((charge) => {
        const like = toDigitalLike(charge);
        return {
          id: charge.id,
          number: charge.number,
          method: charge.method,
          bank: charge.bank ?? null,
          amount: charge.amount,
          reference: charge.reference ?? null,
          vaNumber: charge.vaNumber ?? null,
          /*
            Tagihan QRIS selalu menyimpan payload-nya di server. Data contoh lama
            tidak memuatnya, jadi payload di sini dihitung dari tagihan + nama
            toko dengan fungsi yang sama seperti `createDigitalCharge` — supaya
            kode QR yang digambar halaman Pembayaran cocok dengan yang akan
            dihitung server (mis. saat tagihan yang sama dicetak ulang).
          */
          qrPayload:
            charge.qrPayload ??
            (charge.method === "qris"
              ? qrPayload({
                  number: charge.number,
                  amount: charge.amount,
                  merchantName: session?.tenant?.name,
                })
              : null),
          status: digitalStatusOf(like, now),
          expiresAt: charge.expiresAt,
          saleId: charge.saleId ?? null,
          saleNumber: charge.saleNumber ?? null,
          paidAmount: charge.paidAmount ?? null,
          paidAt: charge.paidAt,
          cancelReason: charge.cancelReason ?? null,
          cancelledAt: charge.cancelledAt,
          createdAt: charge.createdAt,
          updatedAt: charge.updatedAt,
          remainingSeconds: digitalRemainingSeconds(like, now),
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [digitalCharges, actingEffectivePermissions, toDigitalLike, session?.tenant?.name]);

  const digitalSummaryValue: StoreDigitalSummary = useMemo(
    () => summariseCharges(digitalCharges.map(toDigitalLike), Date.now()),
    [digitalCharges, toDigitalLike],
  );

  const createDigitalCharge = useCallback(
    async (
      input: CreateDigitalChargeInput,
    ): Promise<{ id: string; number: string; expiresAt: number }> => {
      const validation = validateChargeInput(
        {
          amount: input.amount,
          method: input.method,
          bank: input.bank ?? null,
          reference: input.reference,
        },
        { digital: digitalPlan.digital, planName: digitalPlan.planName },
      );
      if (!validation.ok) throw new Error(validation.reason);
      const draft = validation.value;

      const now = Date.now();
      chargeSequenceRef.current += 1;
      const number = chargeNumber(
        chargeSequenceRef.current,
        new Date(now).getFullYear(),
      );
      const expiresAt = expiryAtFor(draft.method, now);
      const record: DemoChargeRecord = {
        id: `dig-${now}-${chargeSequenceRef.current}`,
        number,
        method: draft.method,
        bank: draft.bank ?? undefined,
        amount: draft.amount,
        reference: draft.reference ?? undefined,
        vaNumber:
          draft.method === "va" && draft.bank
            ? virtualAccountNumber(draft.bank, chargeSequenceRef.current)
            : undefined,
        qrPayload:
          draft.method === "qris"
            ? qrPayload({
                number,
                amount: draft.amount,
                // Nama merchant yang sama dengan server, supaya kode yang
                // ditampilkan di kasir persis sama dengan yang tercatat.
                merchantName: session?.tenant?.name,
              })
            : undefined,
        status: "pending",
        expiryMinutes: expiryMinutesFor(draft.method),
        expiresAt,
        paidAt: null,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
      };
      commitDigitalCharges([record, ...digitalChargesRef.current]);
      return { id: record.id, number, expiresAt };
    },
    [
      commitDigitalCharges,
      digitalPlan.digital,
      digitalPlan.planName,
      session?.tenant?.name,
    ],
  );

  const actDigitalCharge = useCallback(
    async (input: ActDigitalChargeInput): Promise<void> => {
      const charge = digitalChargesRef.current.find((row) => row.id === input.chargeId);
      if (!charge) {
        throw new Error("Tagihan pembayaran tidak ditemukan untuk tenant ini.");
      }

      const now = Date.now();
      const patch = applyChargeAction(toDigitalLike(charge), input.action, {
        now,
        amount: input.amount,
        reason: input.reason,
      });
      if (!patch.ok) throw new Error(patch.reason);
      const value = patch.value;

      commitDigitalCharges(
        digitalChargesRef.current.map((row) =>
          row.id === charge.id
            ? {
                ...row,
                status: value.status,
                paidAmount: value.paidAmount ?? undefined,
                paidAt: value.paidAt,
                cancelReason: value.cancelReason ?? undefined,
                cancelledAt: value.cancelledAt,
                updatedAt: now,
              }
            : row,
        ),
      );

      // Tagihan pesanan QR meja yang lunas mengubah pesanannya menjadi tiket
      // dapur di titik ini juga — sama seperti server (`meja.guestOrderPaid`),
      // dan hanya untuk baris yang masih menunggu pembayaran. Momen `paidAt`
      // dipakai bersama oleh tiketnya & penandaan di kartu dapur, sehingga dapur
      // bisa melihat tiket itu memang diterima bersamaan dengan uangnya masuk.
      if (value.status === "paid") {
        const order = mejaOrdersRef.current.find(
          (row) => row.chargeId === charge.id && row.status === "pending",
        );
        if (order) {
          const number = nextReceiptNumber(sales, heldOrders);
          const paidAt = Date.now();
          setHeldOrders((current) => [
            ...current,
            {
              id: order.id,
              number,
              createdAt: paidAt,
              // Kanal yang dipilih tamu ikut tercatat di penjualannya: pesanan
              // Virtual Account adalah transfer bank, bukan QRIS.
              method: order.method === "va" ? "Transfer" : "QRIS",
              tableId: order.tableId,
              total: order.total,
              tax: order.tax,
              serviceCharge: order.serviceCharge,
              lines: order.lines.map((line) => ({
                productId: line.productId,
                name: line.name,
                quantity: line.quantity,
                lineTotal: line.lineTotal,
              })),
            },
          ]);
          commitDigitalCharges(
            digitalChargesRef.current.map((row) =>
              row.id === charge.id
                ? { ...row, saleId: order.id, saleNumber: number }
                : row,
            ),
          );
          commitMejaOrders(
            mejaOrdersRef.current.map((row) =>
              row.id === order.id
                ? {
                    ...row,
                    status: "paid" as MejaOrderStatus,
                    paidAt,
                    saleId: order.id,
                    saleNumber: number,
                    updatedAt: paidAt,
                  }
                : row,
            ),
          );
        }
      }
    },
    [
      commitDigitalCharges,
      commitMejaOrders,
      toDigitalLike,
      sales,
      heldOrders,
      mejaOrdersRef,
    ],
  );

  // -------- Pesanan QR meja (`pos.table` + `payment.digital`) ---------------

  /**
   * Menu satu meja untuk halaman tamu (`/meja/:token`). Di mode demo datanya
   * sama dengan katalog kasir; di mode Convex halaman tamu membaca
   * `api.meja.menu` langsung (tidak ada sesi di ponsel pembeli).
   */
  const guestMenu = useCallback(
    (token: string): StoreGuestMenuResult => {
      const table = tables.find(
        (row) => row.menuToken && row.menuToken === (token ?? "").trim(),
      );
      if (!table) {
        return {
          ok: false,
          reason:
            "Kode QR ini tidak dikenal. Pastikan Anda memindai kartu yang ada di meja, atau tanyakan pelayan.",
        };
      }
      if (!table.active) {
        return {
          ok: false,
          reason: `Meja ${table.name} sedang tidak aktif; tanyakan pelayan untuk tempat lain.`,
        };
      }
      const reason = mejaUnavailableReason(entitlementFor(planKey), activeVerticals);
      if (reason) return { ok: false, reason };

      const visible = products
        .filter((product) => product.active)
        .sort((a, b) => a.name.localeCompare(b.name, "id"));
      const itemOf = (product: StoreProduct) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        // Stok demo selalu dilacak (aturan yang sama dengan `completeHeld`).
        available: product.stock > 0,
        stock: product.stock,
        imageUrl: product.images?.[0]?.url ?? null,
      });

      const groups: StoreGuestMenuGroup[] = categories
        .filter((category) => category.active)
        .map((category) => ({
          name: category.name,
          items: visible
            .filter((product) => product.category === category.name)
            .map(itemOf),
        }));
      groups.push({
        name: "Menu lain",
        items: visible
          .filter(
            (product) =>
              !categories.some(
                (category) => category.active && category.name === product.category,
              ),
          )
          .map(itemOf),
      });

      return {
        ok: true,
        menu: {
          business: session?.tenant?.name ?? "MesinPOS",
          storeName: session?.tenant?.storeName ?? "",
          tableLabel: tableLabel(table),
          logoUrl: session?.tenant?.logoUrl ?? null,
          groups: groups.filter((group) => group.items.length > 0),
          tax: guestTaxRulesFrom(tax, fnbTax),
          payment: {
            methods: guestPayOptions(),
            banks: guestBankOptions(),
          },
          limits: {
            maxLines: GUEST_MAX_LINES,
            maxQtyPerItem: GUEST_MAX_QTY_PER_ITEM,
            maxUnits: GUEST_MAX_UNITS,
            nameMax: GUEST_NAME_MAX,
          },
        },
      };
    },
    [
      tables,
      products,
      categories,
      planKey,
      activeVerticals,
      tax,
      fnbTax,
      session?.tenant?.name,
      session?.tenant?.storeName,
      session?.tenant?.logoUrl,
    ],
  );

  /**
   * Membuat pesanan tamu dari ponselnya: tagihan QRIS dulu, penjualan menyusul
   * saat tagihannya lunas — urutan yang sama dengan `api.meja.order`. Harga,
   * kredit stok, dan totalnya dihitung dari data katalog di sini, bukan dari
   * kiriman halaman tamu.
   */
  const placeGuestOrder = useCallback(
    async (input: GuestOrderInput): Promise<GuestOrderResult> => {
      const clean = (input.token ?? "").trim();
      const table = tables.find((row) => row.menuToken && row.menuToken === clean);
      const gate = guestMenu(clean);
      if (!gate.ok) return { ok: false, reason: gate.reason };
      if (!table) {
        return {
          ok: false,
          reason: "Kode QR ini tidak dikenal. Pastikan Anda memindai kartu yang ada di meja.",
        };
      }

      const catalog: GuestProduct[] = products.map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        active: product.active,
        trackStock: true,
        stock: product.stock,
      }));
      const validated = validateGuestCart(input.items, catalog);
      if (!validated.ok) return { ok: false, reason: validated.reason };
      const { lines, subtotal } = validated.value;

      // Satu meja satu pesanan: yang sudah terbuka di dapur **atau** yang masih
      // menunggu pembayaran. Aturan yang sama dijaga server di `meja.order`.
      const openHeld = heldOrders.find((order) => order.tableId === table.id);
      if (openHeld) {
        return {
          ok: false,
          reason: `Meja ${table.name} masih terisi pesanan ${openHeld.number}. Selesaikan atau batalkan dulu.`,
        };
      }
      const pending = mejaOrdersRef.current.find(
        (row) => row.tableId === table.id && row.status === "pending",
      );
      if (pending) {
        return {
          ok: false,
          reason: `Meja ${table.name} masih punya pesanan QR yang menunggu pembayaran (${pending.chargeNumber}). Bayar atau batalkan dulu.`,
        };
      }

      // Cara bayar tamu divalidasi lebih dulu — pesanan dengan metode/bank yang
      // tidak dikenal ditolak utuh, sama seperti `api.meja.order`.
      const pay = guestPaymentMethod({ method: input.method, bank: input.bank });
      if (!pay.ok) return { ok: false, reason: pay.reason };

      const totals = guestOrderTotal(subtotal, guestTaxRulesFrom(tax, fnbTax));
      let charge: { id: string; number: string; expiresAt: number };
      try {
        charge = await createDigitalCharge({
          amount: totals.total,
          method: pay.value.method,
          bank: pay.value.bank,
          reference: guestChargeReference(table.name, lines),
        });
      } catch (cause) {
        return {
          ok: false,
          reason: cause instanceof Error ? cause.message : String(cause),
        };
      }

      const record =
        digitalChargesRef.current.find((row) => row.id === charge.id) ?? null;
      const vaNumber = record?.vaNumber ?? null;
      const now = Date.now();
      const guestName = normalizeGuestName(input.guestName);
      const orderId = `meja-${now}-${mejaOrdersRef.current.length + 1}`;
      const watchToken = mejaWatchToken(demoRandomId());

      commitMejaOrders([
        ...mejaOrdersRef.current,
        {
          id: orderId,
          tableId: table.id,
          tableName: table.name,
          watchToken,
          method: pay.value.method,
          bank: pay.value.bank ?? undefined,
          vaNumber: vaNumber ?? undefined,
          lines: lines.map((line) => ({
            productId: line.productId,
            name: line.name,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            lineTotal: line.lineTotal,
          })),
          subtotal,
          tax: totals.tax,
          serviceCharge: totals.serviceCharge,
          total: totals.total,
          guestName: guestName || undefined,
          chargeId: charge.id,
          chargeNumber: charge.number,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        },
      ]);

      return {
        ok: true,
        receipt: {
          orderId,
          watchToken,
          business: session?.tenant?.name ?? "MesinPOS",
          tableLabel: tableLabel(table),
          guestName: guestName || null,
          subtotal,
          total: totals.total,
          lines: totals.lines,
          charge: {
            id: charge.id,
            number: charge.number,
            method: pay.value.method,
            bank: pay.value.bank,
            vaNumber,
            qrPayload: record?.qrPayload ?? null,
            expiresAt: charge.expiresAt,
            expiryMinutes: Math.max(
              1,
              Math.round((charge.expiresAt - now) / 60_000),
            ),
            instruction: guestPaymentInstruction({
              method: pay.value.method,
              bank: pay.value.bank,
              amount: totals.total,
              vaNumber,
              qrPayload: record?.qrPayload ?? null,
            }),
          },
        },
      };
    },
    [
      tables,
      guestMenu,
      products,
      heldOrders,
      mejaOrdersRef,
      commitMejaOrders,
      tax,
      fnbTax,
      createDigitalCharge,
      session?.tenant?.name,
    ],
  );

  /** Status pesanan tamu untuk ponselnya (dibaca lewat token pemantau). */
  const guestOrderStatus = useCallback(
    (watchToken: string): StoreGuestOrderStatus | null => {
      const clean = (watchToken ?? "").trim();
      const order = mejaOrdersRef.current.find((row) => row.watchToken === clean);
      if (!order) return null;

      const charge =
        digitalChargesRef.current.find((row) => row.id === order.chargeId) ?? null;
      const like = charge ? toDigitalLike(charge) : null;
      const now = Date.now();
      const chargeStatus = like ? digitalStatusOf(like, now) : "cancelled";
      const method: DigitalMethod = order.method ?? "qris";
      const bank = order.bank ?? null;
      // Nomor VA & payload hanya berarti selama tagihannya masih menunggu.
      const vaNumber =
        chargeStatus === "pending" ? (charge?.vaNumber ?? order.vaNumber ?? null) : null;
      const qrPayload =
        chargeStatus === "pending" ? charge?.qrPayload ?? null : null;

      return {
        status: order.status,
        chargeStatus,
        chargeNumber: order.chargeNumber,
        tableLabel: order.tableName,
        guestName: order.guestName ?? null,
        subtotal: order.subtotal,
        tax: order.tax,
        serviceCharge: order.serviceCharge,
        total: order.total,
        lines: order.lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          lineTotal: line.lineTotal,
        })),
        saleNumber: order.saleNumber ?? null,
        paidAt: order.paidAt ?? null,
        expiresAt: charge?.expiresAt ?? null,
        remainingSeconds: like ? digitalRemainingSeconds(like, now) : 0,
        method,
        bank,
        vaNumber,
        qrPayload,
        instruction: guestPaymentInstruction({
          method,
          bank,
          amount: order.total,
          vaNumber,
          qrPayload,
        }),
      };
    },
    [mejaOrdersRef, toDigitalLike],
  );

  /** Daftar pesanan QR untuk kasir: menunggu bayar + yang baru lunas (12 jam). */
  const mejaOrdersValue = useMemo<StoreMejaOrder[]>(() => {
    const now = Date.now();
    const chargeById = new Map(digitalCharges.map((row) => [row.id, row]));
    return mejaOrderRecords
      .filter(
        (row) =>
          row.status === "pending" ||
          (row.paidAt !== undefined && now - row.createdAt <= 12 * 60 * 60 * 1000),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((row) => {
        const charge = chargeById.get(row.chargeId) ?? null;
        const like = charge ? toDigitalLike(charge) : null;
        return {
          id: row.id,
          tableId: row.tableId,
          tableName: row.tableName,
          guestName: row.guestName ?? null,
          lines: row.lines.map((line) => ({
            name: line.name,
            quantity: line.quantity,
            lineTotal: line.lineTotal,
          })),
          subtotal: row.subtotal,
          tax: row.tax,
          serviceCharge: row.serviceCharge,
          total: row.total,
          status: row.status,
          chargeId: row.chargeId,
          chargeNumber: row.chargeNumber,
          chargeStatus: like ? digitalStatusOf(like, now) : null,
          method: row.method ?? "qris",
          bank: row.bank ?? null,
          vaNumber: row.vaNumber ?? null,
          expiresAt: charge?.expiresAt ?? null,
          remainingSeconds: like ? digitalRemainingSeconds(like, now) : 0,
          saleId: row.saleId ?? null,
          saleNumber: row.saleNumber ?? null,
          paidAt: row.paidAt ?? null,
          createdAt: row.createdAt,
        };
      });
  }, [mejaOrderRecords, digitalCharges, toDigitalLike]);

  /** Melunasi tagihan sebuah pesanan QR — jalur tagihan digital yang sama. */
  const settleMejaOrder = useCallback(
    async (orderId: string): Promise<void> => {
      const order = mejaOrdersRef.current.find((row) => row.id === orderId);
      if (!order) throw new Error("Pesanan QR tidak ditemukan untuk tenant ini.");
      if (order.status === "paid") return;
      await actDigitalCharge({
        chargeId: order.chargeId,
        action: "settle",
        amount: order.total,
      });
    },
    [actDigitalCharge, mejaOrdersRef],
  );

  /** Membatalkan niat pesanan QR (tagihannya dibatalkan dari jalurnya sendiri). */
  const cancelMejaOrder = useCallback(
    async (orderId: string): Promise<void> => {
      const order = mejaOrdersRef.current.find((row) => row.id === orderId);
      if (!order) throw new Error("Pesanan QR tidak ditemukan untuk tenant ini.");
      if (order.status === "paid") {
        throw new Error(
          `Pesanan meja ${order.tableName} sudah lunas (${order.saleNumber ?? order.chargeNumber}); batalkan dari sisi penjualannya, bukan dari sini.`,
        );
      }
      if (order.status === "cancelled") return;

      const now = Date.now();
      commitMejaOrders(
        mejaOrdersRef.current.map((row) =>
          row.id === orderId
            ? { ...row, status: "cancelled" as MejaOrderStatus, updatedAt: now }
            : row,
        ),
      );
    },
    [commitMejaOrders, mejaOrdersRef],
  );

  /**
   * Membatalkan pesanan **dari ponsel tamunya sendiri**, lewat token pemantau —
   * cermin `meja.cancelOwnOrder` di server, termasuk dua aturannya:
   * `guestCancelCheck` memastikan tagihannya belum lunas, dan tagihan yang masih
   * menunggu ikut dimatikan supaya kodenya tidak bisa dipakai membayar pesanan
   * yang sudah dibatalkan. Tanpa aktor: ponsel tamu tidak punya akun, dan yang
   * bisa dibatalkan hanyalah pesanan yang tokennya dipegang pemanggil.
   */
  const cancelGuestOrder = useCallback(
    async (
      watchToken: string,
    ): Promise<{ ok: true } | { ok: false; reason: string }> => {
      const clean = (watchToken ?? "").trim();
      const order = mejaOrdersRef.current.find((row) => row.watchToken === clean);
      if (!order) return { ok: false, reason: "Pesanan tidak ditemukan." };

      const charge =
        digitalChargesRef.current.find((row) => row.id === order.chargeId) ?? null;
      const like = charge ? toDigitalLike(charge) : null;
      const now = Date.now();
      const chargeStatus: DigitalStatus = like ? digitalStatusOf(like, now) : "cancelled";

      const allowed = guestCancelCheck({
        status: order.status,
        chargeStatus,
        saleNumber: order.saleNumber ?? null,
      });
      if (!allowed.ok) return { ok: false, reason: allowed.reason };

      if (like) {
        const action = applyChargeAction(like, "cancel", {
          now,
          reason: "Dibatalkan tamu dari halaman meja",
        });
        if (action.ok) {
          commitDigitalCharges(
            digitalChargesRef.current.map((row) =>
              row.id === order.chargeId
                ? {
                    ...row,
                    status: action.value.status,
                    cancelReason: action.value.cancelReason ?? undefined,
                    cancelledAt: action.value.cancelledAt,
                    updatedAt: now,
                  }
                : row,
            ),
          );
        }
      }

      commitMejaOrders(
        mejaOrdersRef.current.map((row) =>
          row.id === order.id
            ? { ...row, status: "cancelled" as MejaOrderStatus, updatedAt: now }
            : row,
        ),
      );
      return { ok: true };
    },
    [commitDigitalCharges, commitMejaOrders, mejaOrdersRef, toDigitalLike],
  );

  // -------- Phase 6: sinkronisasi real-time (`sync.realtime`) ---------------
  const syncPlan: StoreSyncPlan = useMemo(
    () => ({
      planKey,
      realtime: isFeatureEnabled(
        entitlementFor(planKey),
        activeVerticals,
        "sync.realtime",
      ),
      planName: PLANS[planKey].name,
    }),
    [planKey, activeVerticals],
  );

  const syncLimits: StoreSyncLimits = useMemo(
    () => ({
      maxChangesPerPull: MAX_CHANGES_PER_PULL,
      maxBoardChanges: 100,
      maxPayload: SYNC_PAYLOAD_MAX,
      maxClockSkewMs: MAX_CLOCK_SKEW_MS,
      onlineWindowMs: ONLINE_WINDOW_MS,
      idleWindowMs: IDLE_WINDOW_MS,
      maxLabel: SYNC_LABEL_MAX,
      maxFingerprint: SYNC_FINGERPRINT_MAX,
    }),
    [],
  );

  const syncEntities: StoreSyncEntityOption[] = useMemo(
    () => SYNC_ENTITY_KEYS.map((key) => ({ key, label: SYNC_ENTITY_LABELS[key] })),
    [],
  );

  const syncPlatforms: StoreSyncPlatformOption[] = useMemo(
    () => SYNC_PLATFORM_KEYS.map((key) => ({ key, label: SYNC_PLATFORM_LABELS[key] })),
    [],
  );

  /** Perangkat beserta kehadiran & kursor tiap perangkat. */
  const storeSyncDevices: StoreSyncDevice[] = useMemo(() => {
    if (!actingEffectivePermissions.includes("device.manage")) return [];
    const now = Date.now();
    return syncDevices
      .map((device) => {
        const own = syncChanges
          .filter((change) => change.deviceFingerprint === device.fingerprint)
          .reduce((max, change) => Math.max(max, change.revision), 0);
        return {
          deviceId: device.id,
          name: device.name,
          fingerprint: device.fingerprint,
          platform: device.platform,
          lastSeenAt: device.lastSeenAt,
          revoked: device.revoked,
          presence: presenceState(device.lastSeenAt, now) as PresenceState,
          idleSeconds: syncIdleSeconds(device.lastSeenAt, now),
          revision: own,
        };
      })
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }, [syncDevices, syncChanges, actingEffectivePermissions]);

  /** Log perubahan, terbaru dulu. Konflik = hasil dorongan bukan `applied`. */
  const storeSyncChanges: StoreSyncChange[] = useMemo(() => {
    if (!actingEffectivePermissions.includes("device.manage")) return [];
    return syncChanges
      .slice()
      .sort((a, b) => b.revision - a.revision)
      .map((change) => ({
        id: change.id,
        revision: change.revision,
        deviceId: change.deviceFingerprint,
        deviceName: change.deviceName,
        platform: change.platform,
        entity: change.entity,
        entityId: change.entityId,
        baseRevision: change.baseRevision,
        outcome: change.outcome,
        reason: change.reason ?? null,
        payload: change.payload,
        updatedAt: change.updatedAt,
        conflict: change.outcome !== "applied",
        resolvedAt: change.resolvedAt,
        createdAt: change.createdAt,
      }));
  }, [syncChanges, actingEffectivePermissions]);

  const syncSummaryValue: StoreSyncSummary = useMemo(() => {
    if (!actingEffectivePermissions.includes("device.manage")) return EMPTY_SYNC_SUMMARY;
    return summariseSync(storeSyncDevices, storeSyncChanges, Date.now());
  }, [storeSyncDevices, storeSyncChanges, actingEffectivePermissions]);

  const syncLaggingValue: string[] = useMemo(
    () =>
      laggingDevices(
        storeSyncDevices,
        syncSummaryValue.latestRevision,
        Date.now(),
      ).map((device) => device.deviceId),
    [storeSyncDevices, syncSummaryValue.latestRevision],
  );

  const registerSyncDevice = useCallback(
    async (
      input: RegisterSyncDeviceInput,
    ): Promise<{ deviceId: string; name: string }> => {
      const validation = validateSyncDevice(input);
      if (!validation.ok) throw new Error(validation.reason);
      const draft = validation.value;

      if (!syncPlan.realtime) {
        throw new Error(
          `Fitur ${FEATURE_LABELS["sync.realtime"]} tidak termasuk paket ${syncPlan.planName}; naikkan paket untuk menyambungkannya.`,
        );
      }

      const now = Date.now();
      const existing = syncDevicesRef.current.find(
        (device) => device.fingerprint === draft.fingerprint,
      );
      if (existing) {
        commitSyncDevices(
          syncDevicesRef.current.map((device) =>
            device.id === existing.id
              ? {
                  ...device,
                  name: draft.label,
                  platform: draft.platform,
                  lastSeenAt: now,
                  revoked: false,
                }
              : device,
          ),
        );
        return { deviceId: existing.id, name: draft.label };
      }

      const activeCount = syncDevicesRef.current.filter((device) => !device.revoked).length;
      if (!isWithinLimit(entitlementFor(planKey), "devices", activeCount)) {
        throw new Error(
          `Batas perangkat paket ${syncPlan.planName} tercapai (${activeCount}). Naikkan paket untuk menyambungkan kasir lain.`,
        );
      }

      const record: DemoSyncDeviceRecord = {
        id: `dev-${now}`,
        name: draft.label,
        fingerprint: draft.fingerprint,
        platform: draft.platform,
        lastSeenAt: now,
        revoked: false,
      };
      commitSyncDevices([record, ...syncDevicesRef.current]);
      return { deviceId: record.id, name: record.name };
    },
    [commitSyncDevices, planKey, syncPlan.realtime, syncPlan.planName],
  );

  const heartbeatSyncDevice = useCallback(
    async (deviceId: string): Promise<void> => {
      if (!syncDevicesRef.current.some((device) => device.id === deviceId)) {
        throw new Error("Perangkat tidak ditemukan untuk tenant ini.");
      }
      const now = Date.now();
      commitSyncDevices(
        syncDevicesRef.current.map((device) =>
          device.id === deviceId ? { ...device, lastSeenAt: now } : device,
        ),
      );
    },
    [commitSyncDevices],
  );

  const pushSync = useCallback(
    async (
      input: PushSyncInput,
    ): Promise<{ revision: number; outcome: PushOutcome; reason: string | null }> => {
      const validation = validatePushInput({
        entity: input.entity,
        entityId: input.entityId,
        payload: input.payload,
      });
      if (!validation.ok) throw new Error(validation.reason);
      const draft = validation.value;

      if (!syncPlan.realtime) {
        throw new Error(
          `Fitur ${FEATURE_LABELS["sync.realtime"]} tidak termasuk paket ${syncPlan.planName}; naikkan paket untuk memakainya.`,
        );
      }

      const now = Date.now();
      const latest = syncChangesRef.current
        .filter(
          (change) => change.entity === draft.entity && change.entityId === draft.entityId,
        )
        .reduce<DemoSyncChangeRecord | null>(
          (best, change) => (best === null || change.revision > best.revision ? change : best),
          null,
        );

      const decision = decidePush({
        baseRevision: input.baseRevision,
        entityRevision: latest ? latest.revision : null,
        localUpdatedAt: input.updatedAt,
        serverUpdatedAt: latest ? latest.updatedAt : null,
        localDeviceId: input.deviceFingerprint,
        serverDeviceId: latest ? latest.deviceFingerprint : null,
        now,
      });
      if (!decision.ok) throw new Error(decision.reason);

      const revision = nextRevision(
        syncChangesRef.current.reduce((max, change) => Math.max(max, change.revision), 0),
      );
      const record: DemoSyncChangeRecord = {
        id: `sync-${revision}-${now}`,
        revision,
        deviceFingerprint: input.deviceFingerprint,
        deviceName: input.deviceName,
        platform: input.platform,
        entity: draft.entity,
        entityId: draft.entityId,
        baseRevision: input.baseRevision,
        outcome: decision.value.outcome,
        reason: decision.value.reason ?? undefined,
        payload: draft.payload,
        updatedAt: input.updatedAt,
        createdAt: now,
        resolvedAt: null,
      };
      commitSyncChanges([record, ...syncChangesRef.current]);
      return {
        revision,
        outcome: decision.value.outcome,
        reason: decision.value.reason,
      };
    },
    [commitSyncChanges, syncPlan.realtime, syncPlan.planName],
  );

  /**
   * Menarik perubahan di atas kursor dalam satu jendela (`pullWindow` murni),
   * sehingga perangkat bisa menyusul ketinggalannya tanpa menarik seluruh
   * riwayat. **Selalu boleh** (tanpa gerbang fitur), sama seperti server.
   */
  const pullSync = useCallback(
    async (input: PullSyncInput): Promise<PullSyncResult> => {
      const cursor = Number.isFinite(input.cursor)
        ? Math.max(0, Math.floor(input.cursor))
        : 0;
      const rows: StoreSyncChange[] = syncChangesRef.current.map((change) => ({
        id: change.id,
        revision: change.revision,
        deviceId: change.deviceFingerprint,
        deviceName: change.deviceName,
        platform: change.platform,
        entity: change.entity,
        entityId: change.entityId,
        baseRevision: change.baseRevision,
        outcome: change.outcome,
        reason: change.reason ?? null,
        payload: change.payload,
        updatedAt: change.updatedAt,
        conflict: change.outcome !== "applied",
        resolvedAt: change.resolvedAt,
        createdAt: change.createdAt,
      }));
      const window = pullWindow(rows, cursor, input.limit ?? MAX_CHANGES_PER_PULL);
      const latestRevision = rows.reduce(
        (max, row) => Math.max(max, row.revision),
        0,
      );
      return {
        items: window.items,
        nextCursor: window.nextCursor,
        hasMore: window.hasMore,
        latestRevision,
      };
    },
    [],
  );

  const resolveSyncChange = useCallback(
    async (changeId: string): Promise<void> => {
      const change = syncChangesRef.current.find((row) => row.id === changeId);
      if (!change) {
        throw new Error("Perubahan sinkronisasi tidak ditemukan untuk tenant ini.");
      }
      if (change.outcome === "applied") {
        throw new Error("Perubahan ini tidak tercatat sebagai konflik.");
      }
      if (change.resolvedAt !== null) {
        throw new Error("Konflik ini sudah ditandai selesai.");
      }
      const now = Date.now();
      commitSyncChanges(
        syncChangesRef.current.map((row) =>
          row.id === changeId ? { ...row, resolvedAt: now } : row,
        ),
      );
    },
    [commitSyncChanges],
  );

  const value = useMemo<StoreApi>(
    () => ({
      source: "demo",
      ready: true,
      // Tidak ada server di mode demo: tidak ada identitas bisnis yang perlu
      // dipulihkan, jadi onboarding langsung boleh menampilkan formulirnya.
      workspacePending: false,
      error: null,
      // Katalog penjualan hanya yang aktif; halaman Produk & Stok memakai
      // `catalogProducts` supaya produk nonaktif tetap bisa dikelola.
      products: productsForSale,
      catalogProducts: products,
      sales,
      summary,
      categories,
      createCategory,
      renameCategory,
      setCategoryActive,
      removeCategory,
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
      logo,
      setLogo,
      removeLogo,
      myProfile,
      setMyProfile,
      tenantProfile,
      setTenantProfile: setTenantProfileValue,
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
      customers: storeCustomers,
      receivables: storeReceivables,
      arSummary,
      createCustomer,
      setCredit,
      recordPayment,
      members,
      createMember,
      updateMember,
      sendReceiptWhatsapp,
      tables: storeTables,
      kdsTickets,
      createTable,
      updateTable,
      setTableActive,
      deleteTable,
      tableDeletionCheck: checkTableDeletion,
      moveTable,
      importTables,
      issueTableMenuQr,
      mejaOrders: mejaOrdersValue,
      settleMejaOrder,
      cancelMejaOrder,
      guestMenu,
      placeGuestOrder,
      guestOrderStatus,
      cancelGuestOrder,
      holdSale,
      completeHeld,
      warehouses: storeWarehouses,
      stock,
      warehouseCapacity: warehouseCapacityValue,
      transfers,
      createWarehouse,
      setWarehouseActive,
      transferStock,
      opnameSessions: opnameRows,
      opnameLocations,
      opnameSummary,
      opnameOpenByLocation,
      startOpname,
      setOpnameCount,
      postOpname,
      cancelOpname,
      suppliers: storeSuppliers,
      requisitions: storeRequisitions,
      orders: storeOrders,
      receipts,
      purchasingSummary,
      createSupplier,
      updateSupplier,
      createRequisition,
      decideRequisition,
      createOrder,
      cancelOrder,
      receiveGoods,
      payables: storePayables,
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
      supportTickets: storeSupportTickets,
      supportSummary: supportSummaryValue,
      supportPlan,
      supportLimits,
      createSupportTicket,
      actSupportTicket,
      digitalCharges: storeDigitalCharges,
      digitalSummary: digitalSummaryValue,
      digitalPlan,
      digitalLimits,
      createDigitalCharge,
      actDigitalCharge,
      syncDevices: storeSyncDevices,
      syncChanges: storeSyncChanges,
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
      customRoles: storeCustomRoles,
      roleSummary,
      teamMembers: storeTeamMembers,
      addTeamMember,
      resendInvite,
      updateTeamMember,
      removeTeamMember,
      recordWaInvite,
      createCustomRole,
      updateCustomRole,
      deleteCustomRole,
      assignCustomRole,
      apiKeys: storeApiKeys,
      apiKeySummary,
      webhookEndpoints: storeWebhookEndpoints,
      webhookDeliveries: storeWebhookDeliveries,
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
      products,
      productsForSale,
      sales,
      summary,
      categories,
      createCategory,
      renameCategory,
      setCategoryActive,
      removeCategory,
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
      logo,
      setLogo,
      removeLogo,
      myProfile,
      setMyProfile,
      tenantProfile,
      setTenantProfileValue,
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
      storeCustomers,
      storeReceivables,
      arSummary,
      createCustomer,
      setCredit,
      recordPayment,
      members,
      createMember,
      updateMember,
      sendReceiptWhatsapp,
      storeTables,
      kdsTickets,
      createTable,
      updateTable,
      setTableActive,
      deleteTable,
      checkTableDeletion,
      moveTable,
      importTables,
      issueTableMenuQr,
      mejaOrdersValue,
      settleMejaOrder,
      cancelMejaOrder,
      guestMenu,
      placeGuestOrder,
      guestOrderStatus,
      cancelGuestOrder,
      holdSale,
      completeHeld,
      storeWarehouses,
      stock,
      warehouseCapacityValue,
      transfers,
      createWarehouse,
      setWarehouseActive,
      transferStock,
      opnameRows,
      opnameLocations,
      opnameSummary,
      opnameOpenByLocation,
      startOpname,
      setOpnameCount,
      postOpname,
      cancelOpname,
      storeSuppliers,
      storeRequisitions,
      storeOrders,
      receipts,
      purchasingSummary,
      createSupplier,
      updateSupplier,
      createRequisition,
      decideRequisition,
      createOrder,
      cancelOrder,
      receiveGoods,
      storePayables,
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
      storeSupportTickets,
      supportSummaryValue,
      supportPlan,
      supportLimits,
      createSupportTicket,
      actSupportTicket,
      storeDigitalCharges,
      digitalSummaryValue,
      digitalPlan,
      digitalLimits,
      createDigitalCharge,
      actDigitalCharge,
      storeSyncDevices,
      storeSyncChanges,
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
      storeCustomRoles,
      roleSummary,
      storeTeamMembers,
      addTeamMember,
      resendInvite,
      updateTeamMember,
      removeTeamMember,
      recordWaInvite,
      createCustomRole,
      updateCustomRole,
      deleteCustomRole,
      assignCustomRole,
      storeApiKeys,
      apiKeySummary,
      storeWebhookEndpoints,
      storeWebhookDeliveries,
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

export { LOW_STOCK_THRESHOLD };

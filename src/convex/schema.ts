import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * Multi-tenant schema. Every domain table carries `tenantId` so all reads and
 * writes can be scoped — Convex has no row-level security, so tenant isolation
 * is enforced in the access helpers (see ./lib/access.ts).
 *
 * Stock is modelled as an immutable ledger (`stockMovements`) with
 * `stockLevels` kept in sync inside the same transaction, so audits are
 * inherent rather than reconstructed.
 */

export const roleValidator = v.union(
  v.literal("owner"),
  v.literal("manager"),
  v.literal("cashier"),
  v.literal("inventory"),
  v.literal("finance"),
);

/**
 * Penanda **akun platform** — di luar RBAC tenant, jadi sengaja bukan bagian
 * dari `roleValidator`. Akun dengan penanda ini tidak punya baris `memberships`
 * sama sekali, sehingga tidak muncul di permukaan tenant mana pun (lihat
 * `lib/platform.ts`). Diisi hanya lewat `platform.grant` (internalMutation).
 */
export const platformRoleValidator = v.union(v.literal("developer"));

/**
 * Status sesi pendampingan platform (`lib/impersonation.ts`).
 *
 * Hanya dua nilai yang **tersimpan**. “Kedaluwarsa” sengaja bukan salah satunya:
 * ia dihitung saat dibaca (`impersonationStatus`), supaya jeda antarputaran
 * pekerja perapian tidak pernah menjadi jendela akses.
 */
export const impersonationStatusValidator = v.union(
  v.literal("active"),
  v.literal("ended"),
);

export const verticalValidator = v.union(
  v.literal("umkm"),
  v.literal("fnb"),
  v.literal("wholesale"),
);

/**
 * Izin yang bisa disimpan di sebuah peran kustom (`rbac.custom`, Phase 4).
 *
 * Disimpan sebagai union literal, bukan `v.string()`, supaya izin yang tidak
 * dikenal tidak pernah masuk database — daftar ini wajib sama dengan union
 * `Permission` di `lib/authz.ts`, dan harness memeriksa keduanya sinkron.
 */
export const permissionValidator = v.union(
  v.literal("pos.sell"),
  v.literal("pos.void"),
  v.literal("product.manage"),
  v.literal("category.manage"),
  v.literal("stock.adjust"),
  v.literal("report.view"),
  v.literal("billing.manage"),
  v.literal("device.manage"),
  v.literal("team.manage"),
  v.literal("table.manage"),
  v.literal("ar.view"),
  v.literal("ar.manage"),
  v.literal("member.view"),
  v.literal("member.manage"),
  v.literal("inventory.view"),
  v.literal("inventory.manage"),
  v.literal("purchase.view"),
  v.literal("purchase.request"),
  v.literal("purchase.approve"),
  v.literal("purchase.receive"),
  v.literal("payable.view"),
  v.literal("payable.manage"),
  v.literal("api.manage"),
  v.literal("support.view"),
  v.literal("support.manage"),
  v.literal("payment.view"),
  v.literal("payment.manage"),
);

export const planKeyValidator = v.union(
  v.literal("starter"),
  v.literal("professional"),
  v.literal("enterprise"),
);

/**
 * Setelan pajak & pungutan F&B (`tenants.fnbTaxProfile`) — PBJT, biaya layanan,
 * dan kewajiban pusat pengusaha. Semua bidang opsional: baris tenant yang belum
 * pernah menyimpan profil tetap sah dan dibaca sebagai bawaan (tanpa pungutan
 * F&B) oleh `fnbTaxProfileOf`, jadi perilaku lamanya tidak berubah.
 */
export const fnbTaxProfileValidator = v.object({
  regionalActive: v.optional(v.boolean()),
  regionalRatePct: v.optional(v.number()),
  microExemptActive: v.optional(v.boolean()),
  microExemptBelowIdr: v.optional(v.number()),
  serviceChargeActive: v.optional(v.boolean()),
  serviceChargePct: v.optional(v.number()),
  serviceChargeInTaxBase: v.optional(v.boolean()),
  umkmFinalActive: v.optional(v.boolean()),
  umkmEntityType: v.optional(
    v.union(v.literal("perorangan"), v.literal("cv_firma_koperasi"), v.literal("pt")),
  ),
  umkmStartYear: v.optional(v.number()),
  payrollTaxActive: v.optional(v.boolean()),
  rentTaxActive: v.optional(v.boolean()),
  rentMonthlyIdr: v.optional(v.number()),
  rentRatePct: v.optional(v.number()),
});

/**
 * Setelan struk belanja (`tenants.receipt`) — jenis printer, lebar kertas,
 * rangkap, dan catatan kakinya. Semua bidang opsional: baris tenant yang belum
 * pernah menyimpan setelan ini tetap sah dan dibaca sebagai bawaan (thermal
 * 80 mm, satu lembar) oleh `receiptSettingOf`, jadi struknya tidak berubah
 * dengan sendirinya setelah kolom ini ditambahkan.
 */
export const receiptPrinterValidator = v.union(
  v.literal("thermal"),
  v.literal("dot_matrix"),
  v.literal("portable"),
);

export const receiptSettingValidator = v.object({
  printerId: v.optional(receiptPrinterValidator),
  paperWidthMm: v.optional(v.number()),
  copies: v.optional(v.number()),
  footerText: v.optional(v.string()),
});

/**
 * Jenis pajak yang benar-benar dipungut saat penjualan itu terjadi
 * (`sales.taxKind`). Disimpan apa adanya supaya struk lama tetap bisa dibaca
 * setelah setelannya berubah.
 */
export const saleTaxKindValidator = v.union(
  v.literal("ppn"),
  v.literal("regional"),
  v.literal("none"),
);

export const subscriptionStatusValidator = v.union(
  v.literal("trialing"),
  v.literal("active"),
  v.literal("past_due"),
  v.literal("suspended"),
  v.literal("canceled"),
);

/** Kategori tiket dukungan (`support.dedicated`, Phase 5). */
export const supportCategoryValidator = v.union(
  v.literal("bug"),
  v.literal("payment"),
  v.literal("data"),
  v.literal("howto"),
  v.literal("other"),
);

/**
 * Prioritas tiket. `high` & `urgent` memakai jalur tanggap cepat fitur
 * `support.dedicated`; dua nilai lainnya selalu boleh (lihat lib/support.ts).
 */
export const supportPriorityValidator = v.union(
  v.literal("low"),
  v.literal("normal"),
  v.literal("high"),
  v.literal("urgent"),
);

export const supportStatusValidator = v.union(
  v.literal("open"),
  v.literal("in_progress"),
  v.literal("resolved"),
);

/**
 * Satu baris riwayat tiket: catatan biasa atau perubahan status. `kind` dipakai
 * halaman untuk membedakan mana yang mengubah keadaan, dan `at` menjaga urutannya
 * walau beberapa aksi terjadi pada milidetik yang sama.
 */
const supportLogEntryValidator = v.object({
  at: v.number(),
  kind: v.union(v.literal("note"), v.literal("status")),
  actorId: v.optional(v.id("users")),
  body: v.string(),
});

/**
 * Metode pembayaran digital (`payment.digital`, Phase 6). QRIS memakai kode
 * terpindai, VA memakai nomor transfer bank — lihat lib/digitalPayment.ts.
 */
export const digitalMethodValidator = v.union(
  v.literal("qris"),
  v.literal("va"),
);

/** Bank penerbit Virtual Account; hanya dipakai saat metodenya `va`. */
export const vaBankValidator = v.union(
  v.literal("bca"),
  v.literal("bni"),
  v.literal("bri"),
  v.literal("mandiri"),
);

/**
 * Status satu pesanan QR meja (modul F&B). `expired` tidak ada di sini: tagihan
 * tamu yang lewat tenggat tetap `pending` di sisi pesanan sampai kasir
 * membatalkannya — yang punya umur adalah tagihannya (`digitalCharges`), bukan
 * pesanannya.
 */
export const mejaOrderStatusValidator = v.union(
  v.literal("pending"),
  v.literal("paid"),
  v.literal("cancelled"),
);

/**
 * Status tagihan digital yang **disimpan**. Kedaluwarsa tidak pernah ditulis
 * sebagai status tersimpan — umur tagihan dihitung saat dibaca dari `expiresAt`
 * (`statusOf` di lib/digitalPayment.ts), jadi tidak butuh pekerja terjadwal.
 */
export const digitalStatusValidator = v.union(
  v.literal("pending"),
  v.literal("paid"),
  v.literal("expired"),
  v.literal("cancelled"),
);

/** Jenis perangkat hub sinkronisasi (`sync.realtime`, Phase 6). */
export const syncPlatformValidator = v.union(
  v.literal("web"),
  v.literal("android"),
  v.literal("ios"),
  v.literal("desktop"),
);

/** Hasil satu dorongan perubahan; `conflict` karenanya dihitung dari sini. */
export const syncOutcomeValidator = v.union(
  v.literal("applied"),
  v.literal("rebased"),
  v.literal("rejected"),
);

export const movementReasonValidator = v.union(
  v.literal("sale"),
  v.literal("void"),
  v.literal("adjustment"),
  v.literal("opname"),
  v.literal("purchase"),
  /** Perpindahan antar lokasi (`inventory.multiwarehouse`, Phase 3). */
  v.literal("transfer"),
);

/** Status PR (`purchasing.basic`, Phase 3). */
export const requisitionStatusValidator = v.union(
  v.literal("submitted"),
  v.literal("approved"),
  v.literal("rejected"),
);

/** Status PO; `partial` berarti sebagian barang sudah diterima. */
export const orderStatusValidator = v.union(
  v.literal("open"),
  v.literal("partial"),
  v.literal("received"),
  v.literal("cancelled"),
);

const requisitionLineValidator = v.object({
  productId: v.id("products"),
  /** Nama produk disalin saat dibuat supaya riwayat tidak berubah. */
  name: v.string(),
  quantity: v.number(),
  note: v.optional(v.string()),
});

const orderLineValidator = v.object({
  productId: v.id("products"),
  name: v.string(),
  quantity: v.number(),
  unitCost: v.number(),
  receivedQty: v.number(),
});

const receiptLineValidator = v.object({
  productId: v.id("products"),
  name: v.string(),
  quantity: v.number(),
  unitCost: v.number(),
});

/**
 * Baris **dokumen supplier** (tagihan yang dikirim supplier) — dipakai pencocokan
 * 3 arah (`purchasing.threeway`). Kuantitas & harga di sini adalah yang *ditagih*,
 * yang bisa berbeda dari PO maupun penerimaan; justru selisih itu yang dicari.
 */
const invoiceLineValidator = v.object({
  productId: v.id("products"),
  name: v.string(),
  quantity: v.number(),
  unitCost: v.number(),
});

/** Baris sesi opname; `countedQty` kosong = belum dihitung (bukan nol). */
const opnameLineValidator = v.object({
  productId: v.id("products"),
  name: v.string(),
  sku: v.string(),
  unit: v.string(),
  /** Saldo sistem saat sesi dimulai. */
  systemQty: v.number(),
  countedQty: v.optional(v.number()),
  note: v.optional(v.string()),
});

/** Metode pembayaran yang dikenal backend (dipakai penjualan & pelunasan piutang). */
export const paymentMethodValidator = v.union(
  v.literal("cash"),
  v.literal("qris"),
  v.literal("card"),
  v.literal("transfer"),
);

export const paymentValidator = v.object({
  method: paymentMethodValidator,
  amount: v.number(),
  change: v.optional(v.number()),
  provider: v.optional(v.string()),
  providerRef: v.optional(v.string()),
});

export default defineSchema({
  /*
    Tabel milik Convex Auth (`authSessions`, `authAccounts`, `authRefreshTokens`,
    `authVerificationCodes`, `authVerifiers`, `authRateLimits`) menyusul di sini.
    Tabel `users` bawaan library **diganti** di bawah supaya skema lama proyek ini
    tetap utuh — lihat catatan pada tabel itu.
  */
  ...authTables,

  users: defineTable({
    name: v.string(),
    email: v.string(),
    /**
     * Field standar Convex Auth. `email`/`emailVerificationTime` dipakai
     * library untuk menautkan akun yang sudah ada, dan ketiga field opsional di
     * sini harus tetap ada supaya Convex Auth tidak menulis kolom yang tidak
     * dikenal; proyek ini tidak memakainya.
     */
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    /**
     * Penanda akun platform (mis. `developer`). Kosong untuk akun biasa — dan
     * akun biasa inilah satu-satunya yang boleh menjadi anggota tenant.
     */
    platformRole: v.optional(platformRoleValidator),
    /**
     * Waktu email benar-benar terbukti dimiliki pemiliknya (kode OTP masuk).
     * Kosong untuk baris lama yang dibuat lewat jalur tanpa verifikasi.
     */
    emailVerifiedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    // `email`/`phone` **wajib** bernama persis ini: Convex Auth yang membaca
    // (dan jadi nama indeks email di seluruh kode proyek ini juga — Convex
    // melarang dua indeks dengan field yang sama dalam satu tabel).
    .index("email", ["email"])
    .index("phone", ["phone"]),

  /**
   * Kode OTP masuk tanpa kata sandi (`otp.auth`): satu baris per permintaan.
   *
   * Yang disimpan **hash** kode, bukan kodenya — membaca tabel ini tidak
   * langsung memberi kode yang masih hidup. Baris lama dibiarkan sebagai
   * riwayat: `consumedAt` (sudah dipakai) dan `attempts` (berapa kali salah)
   * adalah bukti kenapa sebuah kode ditolak, dan batas kirim ulang dibaca dari
   * `createdAt` baris-baris ini, bukan dari penghitung terpisah yang bisa basi.
   */
  emailOtps: defineTable({
    email: v.string(),
    codeHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    attempts: v.number(),
    consumedAt: v.optional(v.number()),
    /** Kapan email benar-benar berangkat; kosong = belum terkirim. */
    deliveredAt: v.optional(v.number()),
    /** Saluran yang dipakai (`resend`), untuk jejak audit pengiriman. */
    deliveredVia: v.optional(v.string()),
    /** Pesan kegagalan pengiriman terakhir, kalau ada. */
    deliveryError: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    .index("by_email_created", ["email", "createdAt"]),

  tenants: defineTable({
    name: v.string(),
    slug: v.string(),
    ownerId: v.id("users"),
    planKey: planKeyValidator,
    /** Plan catalog version the tenant is entitled to. */
    planVersion: v.number(),
    status: subscriptionStatusValidator,
    trialEndsAt: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    graceDays: v.number(),
    currency: v.string(),
    /** VAT (PPN) rate in percent, configurable per tenant. */
    taxRatePct: v.number(),
    /**
     * Whether the tenant charges PPN at all (`tenants.updateTax`).
     *
     * Sengaja **opsional**: baris tenant yang dibuat sebelum kolom ini ada tetap
     * sah dan dianggap **aktif**, sama seperti `categories.active`. Mematikan pajak
     * diam-diam untuk workspace lama jauh lebih berbahaya daripada membiarkannya
     * seperti sebelumnya.
     */
    taxActive: v.optional(v.boolean()),
    /**
     * Setelan pajak & pungutan F&B (PBJT, biaya layanan, PPh final UMKM, PPh 21,
     * PPh 4 ayat (2)) — diatur dari halaman Pengaturan (`tenants.updateFnbTax`),
     * dipakai bersama oleh kasir, struk, dan ringkasan setoran bulanan.
     */
    fnbTaxProfile: v.optional(fnbTaxProfileValidator),
    /**
     * Setelan struk belanja: jenis printer, lebar kertas, rangkap, catatan kaki
     * (`tenants.updateReceipt`, halaman Pengaturan). Dibaca kasir saat mencetak
     * dan halaman Pengaturan saat menampilkan pratinjaunya.
     */
    receipt: v.optional(receiptSettingValidator),
    /**
     * Logo toko yang tercetak di atas nama usaha pada struk (`tenants.setLogo`).
     * Disimpan sebagai **id berkas** di penyimpanan Convex, bukan URL — URL
     * bertanda tangan punya masa berlaku, jadi URL yang ditulis ke sini akan mati
     * sendiri. URL-nya dibuat saat query (`tenants.listMine`).
     */
    logo: v.optional(v.id("_storage")),
    verticals: v.array(verticalValidator),
    createdAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_owner", ["ownerId"]),

  memberships: defineTable({
    tenantId: v.id("tenants"),
    userId: v.id("users"),
    role: roleValidator,
    /**
     * Peran kustom yang berlaku untuk anggota ini (`rbac.custom`, Phase 4).
     * Kalau diisi, izinnya **menggantikan** `role`; kalau kosong atau peran
     * kustomnya sudah hilang/nonaktif, `role` yang berlaku (lihat lib/rbac.ts).
     */
    customRoleId: v.optional(v.id("customRoles")),
    storeIds: v.array(v.id("stores")),
    active: v.boolean(),
    createdAt: v.number(),
    /**
     * Undangan lewat email ke anggota ini ("kirim undangan untuk login ke
     * workspace"). Dicatat apa adanya seperti pengiriman kode masuk: pengundang
     * harus bisa membedakan "terkirim" dari "gagal", dan alamat uji `.test`
     * dicatat sebagai `uji` karena memang tidak dikirimi email.
     */
    inviteSentAt: v.optional(v.number()),
    /** Saluran yang dipakai (`resend`, `uji`) — jejak audit pengiriman. */
    inviteSentVia: v.optional(v.string()),
    /** Pesan kegagalan pengiriman undangan terakhir, kalau ada. */
    inviteError: v.optional(v.string()),
    /** Berapa kali undangan dicoba dikirim (termasuk kirim ulang manual). */
    inviteAttempts: v.optional(v.number()),
    /**
     * Nomor WhatsApp anggota (digit + kode negara, mis. `6281234567890`), dipakai
     * mengirim undangan lewat `wa.me`. Bukan jalur masuk: masuknya tetap kode OTP
     * ke email yang diundang.
     */
    phone: v.optional(v.string()),
    /** Kapan tautan undangan WhatsApp terakhir dibuka pengundang. */
    waInviteAt: v.optional(v.number()),
    /** Berapa kali tautan undangan WhatsApp dibuka pengundang. */
    waInviteCount: v.optional(v.number()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_user", ["userId"])
    .index("by_tenant_user", ["tenantId", "userId"]),

  /**
   * Kunci API tenant (`api.access`, Phase 4).
   *
   * `publicId` adalah indeks pencarian yang tidak rahasia; `secret` **tidak
   * pernah disimpan** — yang ada di sini hanya `secretHash`,
   * `sha256(publicId + ":" + secret)`. `creatorRole` disimpan supaya kunci ikut
   * menyempit saat peran pembuatnya diturunkan/berubah (lihat `scopeAllowed`),
   * dan `lastUsedAt` memberi jejak kapan terakhir dipakai.
   */
  apiKeys: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    publicId: v.string(),
    secretHash: v.string(),
    /** Scope yang boleh dipanggil kunci ini (subset izin pembuatnya). */
    scopes: v.array(permissionValidator),
    /** Peran pembuat saat kunci dibuat; dipakai ulang saat verifikasi. */
    creatorRole: roleValidator,
    active: v.boolean(),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    createdById: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_public_id", ["tenantId", "publicId"])
    /** Pencarian kunci saat autentikasi: `publicId` sudah acak 10 karakter. */
    .index("by_public_id", ["publicId"]),

  /**
   * Endpoint webhook keluar (`api.access`, Phase 4).
   *
   * `secret` disimpan apa adanya karena kita yang harus menandatangani setiap
   * kiriman (HMAC) — ini rahasia bersama dengan penerima, bukan kredensial yang
   * kita verifikasi seperti kunci API. `secretLastFour` dipakai untuk menampilkan
   * di daftar tanpa membuka rahasianya.
   */
  webhookEndpoints: defineTable({
    tenantId: v.id("tenants"),
    url: v.string(),
    description: v.optional(v.string()),
    events: v.array(v.string()),
    secret: v.string(),
    secretLastFour: v.string(),
    active: v.boolean(),
    createdById: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant", ["tenantId"]),

  /**
   * Riwayat pengiriman webhook. Satu baris per kiriman, `attempts` bertambah
   * setiap percobaan, dan `nextAttemptAt` dijadwalkan aturan murni
   * `lib/webhooks.ts` (5 percobaan lalu menyerah), sehingga kegagalan permanen
   * berakhir sebagai `failed` yang terlihat di halaman. Indeks
   * `by_status_next_attempt` adalah antrean pekerja terjadwal `crons.ts`: baris
   * `pending` yang jadwalnya sudah lewat diambil dari situ, bukan dengan
   * memindai seluruh riwayat.
   */
  webhookDeliveries: defineTable({
    tenantId: v.id("tenants"),
    endpointId: v.id("webhookEndpoints"),
    event: v.string(),
    payload: v.string(),
    status: v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed")),
    attempts: v.number(),
    lastStatusCode: v.optional(v.number()),
    lastError: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_created", ["tenantId", "createdAt"])
    .index("by_endpoint", ["endpointId"])
    .index("by_status_next_attempt", ["status", "nextAttemptAt"]),

  /**
   * Peran kustom (`rbac.custom`, Phase 4): daftar izin bernama yang ditugaskan
   * ke anggota lewat `memberships.customRoleId`.
   *
   * Izin disimpan sudah tersaring & terurut kanonik (`sanitizePermissions`),
   * dan hanya izin yang dikenal validator yang bisa masuk. Peran kustom yang
   * masih dipakai anggota **tidak boleh dihapus** — kalau tidak, anggota itu
   * diam-diam kehilangan aksesnya tanpa jejak.
   */
  customRoles: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    description: v.optional(v.string()),
    permissions: v.array(permissionValidator),
    /** Nonaktif = peran lama yang disimpan, tidak bisa ditugaskan lagi. */
    active: v.boolean(),
    createdById: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_name", ["tenantId", "name"]),

  /**
   * Tiket dukungan (`support.dedicated`, Phase 5 / Dukungan khusus & skala
   * franchise).
   *
   * `slaHours` **dipatok saat tiket dibuat** dari paket tenant saat itu:
   * naik/turun paket tidak boleh menulis ulang janji tanggap untuk tiket yang
   * sudah masuk. `log` adalah riwayat append-only (catatan + perubahan status),
   * dibatasi `MAX_TICKET_LOG` supaya satu tiket tidak tumbuh tanpa batas.
   */
  supportTickets: defineTable({
    tenantId: v.id("tenants"),
    number: v.string(),
    subject: v.string(),
    category: supportCategoryValidator,
    priority: supportPriorityValidator,
    status: supportStatusValidator,
    /** Jam tanggap yang berlaku untuk tiket ini. */
    slaHours: v.number(),
    /**
     * Janji tanggap dalam bentuk waktu absolut (`createdAt + slaHours`), dipatok
     * saat tiket dibuat. Dipakai pekerja pengingat supaya ia tidak menghitung
     * ulang, dan boleh kosong untuk tiket lama sebelum kolom ini ada.
     */
    dueAt: v.optional(v.number()),
    /**
     * Sudah pernah diingatkan lewat event `support.due`? Penanda inilah yang
     * membuat satu tiket tidak diberitakan setiap putaran pekerja — pengingat
     * yang berulang tanpa kabar baru hanya membuat penerimanya berhenti membaca.
     */
    slaNotified: v.optional(v.boolean()),
    planKeyAtCreation: planKeyValidator,
    escalated: v.boolean(),
    body: v.string(),
    log: v.array(supportLogEntryValidator),
    createdById: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_created", ["tenantId", "createdAt"])
    .index("by_number", ["number"])
    /**
     * Tiket yang belum diingatkan, urut tenggat terdekat — jalur indeks pekerja
     * pengingat (`support.notifyDueTickets`), bukan pemindaian seluruh tabel.
     */
    .index("by_sla", ["slaNotified", "dueAt"]),

  /**
   * Tagihan pembayaran digital (`payment.digital`, Phase 6).
   *
   * Satu baris = satu tagihan yang ditunjukkan ke pelanggan. `expiresAt`
   * **dipatok saat tagihan dibuat** dari metodenya (QRIS 5 menit, VA sehari),
   * sehingga mengubah kebijakan umur tidak mematikan tagihan yang sudah
   * beredar. Kedaluwarsa sendiri tidak disimpan sebagai status: `statusOf`
   * menurunkannya dari `expiresAt` saat dibaca.
   */
  digitalCharges: defineTable({
    tenantId: v.id("tenants"),
    storeId: v.optional(v.id("stores")),
    number: v.string(),
    method: digitalMethodValidator,
    /** Bank penerbit VA; kosong untuk QRIS. */
    bank: v.optional(vaBankValidator),
    amount: v.number(),
    reference: v.optional(v.string()),
    /** Nomor Virtual Account / payload QRIS yang ditunjukkan ke pelanggan. */
    vaNumber: v.optional(v.string()),
    qrPayload: v.optional(v.string()),
    status: digitalStatusValidator,
    /** Dipatok saat dibuat: `createdAt + expiryMinutesFor(method)`. */
    expiresAt: v.number(),
    paidAmount: v.optional(v.number()),
    paidAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
    cancelledAt: v.optional(v.number()),
    createdById: v.optional(v.id("users")),
    /**
     * Penjualan yang dilunasi tagihan ini (`pos.createSale` dari keranjang kasir).
     * Diisi saat penjualannya dibuat, jadi keuangan bisa menelusuri satu tagihan
     * QRIS sampai ke nota yang dibayarnya — dan sebaliknya.
     */
    saleId: v.optional(v.id("sales")),
    saleNumber: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_created", ["tenantId", "createdAt"])
    .index("by_tenant_number", ["tenantId", "number"]),

  /**
   * Log perubahan hub sinkronisasi real-time (`sync.realtime`, Phase 6).
   *
   * Append-only: setiap dorongan menulis satu baris dengan `revision` naik
   * satu-satu per tenant (dari `counters`), sehingga "apa yang belum saya lihat"
   * dijawab satu angka, bukan dengan membandingkan seluruh riwayat. `conflict`
   * menandai dorongan yang kalah/menang lewat penyelesaian last-write-wins, dan
   * `resolvedAt` mencatat kapan manusia menandai konfliknya beres — riwayatnya
   * tidak pernah dihapus.
   */
  syncChanges: defineTable({
    tenantId: v.id("tenants"),
    revision: v.number(),
    /** Sidik perangkat pendorong; dipakai tie-break & ditampilkan. */
    deviceId: v.string(),
    deviceName: v.string(),
    platform: syncPlatformValidator,
    entity: v.string(),
    entityId: v.string(),
    /** Revisi tenant yang jadi basis perangkat saat menyunting. */
    baseRevision: v.number(),
    outcome: syncOutcomeValidator,
    reason: v.optional(v.string()),
    payload: v.string(),
    /** `updatedAt` entitas menurut perangkat. */
    updatedAt: v.number(),
    conflict: v.boolean(),
    resolvedAt: v.optional(v.number()),
    createdById: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_revision", ["tenantId", "revision"])
    .index("by_tenant_created", ["tenantId", "createdAt"])
    /** Perubahan terakhir sebuah entitas: equality pada tiga kolom pertama. */
    .index("by_tenant_entity", ["tenantId", "entity", "entityId", "revision"])
    /** Revisi terakhir yang sudah dilihat satu perangkat (kursor perangkat). */
    .index("by_tenant_device", ["tenantId", "deviceId", "revision"]),

  stores: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    code: v.string(),
    address: v.optional(v.string()),
    active: v.boolean(),
    createdAt: v.number(),
  }).index("by_tenant", ["tenantId"]),

  /**
   * Kategori produk (`category.manage`). Namanya menentukan kode tengah SKU
   * (`PBB-<KATEGORI>-<nomor>`, lihat lib/productSku.ts) dan tab filter POS.
   *
   * `active` sengaja **opsional**: baris kategori dibuat sebelum kolom ini ada
   * (mis. kategori bawaan tenant lama), dan kategori tanpa nilai itu diperlakukan
   * sebagai aktif (`categoryIsActive`) — menandai “nonaktif” hanya lewat aksi
   * yang jelas, bukan lewat migrasi yang bisa salah tebak.
   */
  categories: defineTable({
    tenantId: v.id("tenants"),
    name: v.string(),
    sortOrder: v.number(),
    /** `false` = tidak bisa dipakai produk baru; `undefined` = aktif. */
    active: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
  }).index("by_tenant", ["tenantId"]),

  /**
   * Denah meja (`pos.table`); modul F&B. Status meja TIDAK disimpan di sini —
   * meja terisi kalau ada pesanan berstatus `held` yang menunjuknya, sehingga
   * menyelesaikan pesanan selalu mengosongkan mejanya (lihat lib/fnb.ts).
   */
  tables: defineTable({
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    name: v.string(),
    seats: v.number(),
    zone: v.string(),
    active: v.boolean(),
    /**
     * Token rahasia yang dikodekan ke kode QR di meja (`mj_<32 hex>`), dibuat
     * `tables.issueMenuQr` dan hanya boleh diganti lewat mutasi yang sama.
     * Kosong = meja ini belum punya kartu QR. Token, bukan `tableId`, supaya
     * kode yang difoto tamu tidak bisa dipakai menebak meja lain.
     */
    menuToken: v.optional(v.string()),
    /**
     * Urutan tampil meja di denah (1 = paling depan); `undefined` = data lama
     * yang belum pernah diurutkan, dibaca `sortTablesByOrder`. Diisi saat meja
     * dibuat (selalu paling akhir), digeser (`tables.move`), atau diimpor
     * (`tables.importBatch`).
     */
    sortOrder: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_tenant_store", ["tenantId", "storeId"])
    .index("by_tenant", ["tenantId"])
    .index("by_menu_token", ["menuToken"]),

  /**
   * Satu pesanan QR meja (modul F&B): pesanan yang dikirim tamu dari ponselnya,
   * beserta tagihan digital yang menagihnya.
   *
   * **Tagihan dulu, penjualan kemudian.** Baris ini menahan isi pesanan (nama,
   * harga, dan total saat dipesan) supaya penjualannya baru dicatat ketika
   * tagihannya benar-benar lunas — tamu yang membatalkan pembayaran tidak
   * meninggalkan penjualan atau tiket dapur yang tidak pernah dibayar. Karena
   * itu `saleId`/`saleNumber` baru terisi di titik pelunasan.
   */
  mejaOrders: defineTable({
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    tableId: v.id("tables"),
    /** Nama meja saat pesanan dibuat; riwayat tidak berubah saat meja berganti nama. */
    tableName: v.string(),
    /** Rahasia ponsel tamu (`mjo_<32 hex>`) untuk menanyakan status pesanannya. */
    watchToken: v.string(),
    /** Cara bayar yang dipilih tamu saat memesan; kosong = QRIS (pesanan lama). */
    method: v.optional(digitalMethodValidator),
    /** Bank penerbit Virtual Account; kosong untuk QRIS & pesanan lama. */
    bank: v.optional(vaBankValidator),
    /** Nomor Virtual Account yang ditunjukkan ke tamu (hanya untuk VA). */
    vaNumber: v.optional(v.string()),
    /** Isi pesanan apa adanya saat dipesan (harga dari katalog server). */
    lines: v.array(
      v.object({
        productId: v.id("products"),
        name: v.string(),
        unitPrice: v.number(),
        quantity: v.number(),
        lineTotal: v.number(),
      }),
    ),
    subtotal: v.number(),
    tax: v.number(),
    /** Tarif pajak yang benar-benar dipungut saat pesanan dibuat. */
    taxRatePct: v.number(),
    /** Pajak mana yang dipungut (PPN/PBJT/tanpa); ikut ke penjualan saat lunas. */
    taxKind: v.optional(saleTaxKindValidator),
    serviceCharge: v.number(),
    total: v.number(),
    /** Nama tamu kalau diisi; kosong = pesanan tanpa nama. */
    guestName: v.optional(v.string()),
    chargeId: v.id("digitalCharges"),
    chargeNumber: v.string(),
    /** Penjualan (tiket dapur) yang dibuat saat tagihannya lunas. */
    saleId: v.optional(v.id("sales")),
    saleNumber: v.optional(v.string()),
    status: mejaOrderStatusValidator,
    paidAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tenant_created", ["tenantId", "createdAt"])
    .index("by_watch", ["watchToken"])
    .index("by_charge", ["chargeId"])
    .index("by_sale", ["saleId"])
    // Dipakai pagar hapus meja: pesanan QR yang masih menunggu pembayaran harus
    // ketahuan tanpa memindai seluruh riwayat tenant.
    .index("by_table", ["tableId"]),

  products: defineTable({
    tenantId: v.id("tenants"),
    sku: v.string(),
    name: v.string(),
    categoryId: v.optional(v.id("categories")),
    /** Integer rupiah per satuan dasar, tax-exclusive. */
    price: v.number(),
    cost: v.number(),
    trackStock: v.boolean(),
    active: v.boolean(),
    /** Satuan dasar stok & harga (default "PCS"); modul Grosir. */
    unit: v.optional(v.string()),
    /** Harga bertingkat per satuan dasar (`pricing.multitier`); modul Grosir. */
    tiers: v.optional(
      v.array(v.object({ minQty: v.number(), price: v.number() })),
    ),
    /** Konversi satuan besar → satuan dasar (`uom.multilevel`); modul Grosir. */
    units: v.optional(
      v.array(v.object({ code: v.string(), factor: v.number() })),
    ),
    /**
     * Modifier item (`pos.modifier`); modul F&B. Grup dengan `minSelect > 0`
     * wajib dipilih saat menjual, dan tiap opsi bisa menambah harga per unit.
     */
    modifiers: v.optional(
      v.array(
        v.object({
          code: v.string(),
          name: v.string(),
          minSelect: v.number(),
          maxSelect: v.number(),
          options: v.array(
            v.object({
              code: v.string(),
              name: v.string(),
              price: v.number(),
            }),
          ),
        }),
      ),
    ),
    /**
     * Gambar produk (maksimal 8; lihat lib/productImages.ts). Yang disimpan
     * adalah **id berkas** di penyimpanan Convex, bukan URL — URL bertanda tangan
     * punya masa berlaku, jadi URL yang ditulis ke sini akan mati sendiri.
     */
    images: v.optional(v.array(v.id("_storage"))),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_sku", ["tenantId", "sku"]),

  /**
   * Pelanggan B2B (fitur `ar.creditlimit`, modul Grosir).
   * `creditLimit` 0 berarti tunai saja; limit > 0 memakai tempo
   * `paymentTermDays` hari. Saldo piutang **tidak** disimpan di sini —
   * dihitung dari `receivables` supaya tidak ada angka yang bisa basi
   * (lihat lib/ar.ts).
   */
  customers: defineTable({
    tenantId: v.id("tenants"),
    code: v.string(),
    name: v.string(),
    phone: v.optional(v.string()),
    creditLimit: v.number(),
    paymentTermDays: v.number(),
    active: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_code", ["tenantId", "code"]),

  /**
   * Member pelanggan (`member.discount`; modul UMKM). Sengaja **terpisah** dari
   * `customers` (pelanggan B2B) karena konsepnya beda: member = diskon langganan
   * di kasir, customer = tempo & limit kredit.
   */
  members: defineTable({
    tenantId: v.id("tenants"),
    code: v.string(),
    name: v.string(),
    phone: v.optional(v.string()),
    /** Persen diskon per transaksi (0–50); 0 = member tanpa diskon. */
    discountPct: v.number(),
    active: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_code", ["tenantId", "code"]),

  /**
   * Piutang per nota (satu baris per penjualan yang belum lunas). `paidAmount`
   * bertambah lewat `receivablePayments`; `status` menjadi `paid` setelah
   * sisanya 0, dan `void` kalau penjualannya dibatalkan.
   */
  receivables: defineTable({
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    customerId: v.id("customers"),
    saleId: v.optional(v.id("sales")),
    number: v.string(),
    amount: v.number(),
    paidAmount: v.number(),
    dueDate: v.number(),
    status: v.union(v.literal("open"), v.literal("paid"), v.literal("void")),
    /**
     * Sudah pernah diberitahukan lewat event `receivable.overdue`? Penanda inilah
     * yang membuat pekerja harian tidak mengabarkan nota yang sama setiap hari;
     * piutang yang lahir lewat waktu, bukan lewat transaksi.
     */
    overdueNotified: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_customer", ["tenantId", "customerId"])
    .index("by_sale", ["saleId"])
    /**
     * Piutang yang belum diingatkan, urut jatuh tempo terdekat — jalur indeks
     * pekerja pengingat (`ar.notifyOverdueReceivables`), bukan pemindaian tabel.
     */
    .index("by_overdue", ["overdueNotified", "dueDate"]),

  /** Penerimaan pembayaran piutang (boleh sebagian) — jejak audit penagihan. */
  receivablePayments: defineTable({
    tenantId: v.id("tenants"),
    receivableId: v.id("receivables"),
    customerId: v.id("customers"),
    amount: v.number(),
    method: paymentMethodValidator,
    note: v.optional(v.string()),
    actorId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_receivable", ["receivableId"]),

  /**
   * Lokasi penyimpanan tambahan (`inventory.multiwarehouse`, Phase 3).
   *
   * **Lokasi jual toko tidak punya baris di sini**: bucket stok tanpa
   * `warehouseId` adalah lokasi jual (lihat `lib/inventory.ts`). Jadi fitur ini
   * bisa menyala pada tenant lama tanpa migrasi stok, dan "gudang" berarti
   * tempat menyimpan barang sebelum dipindahkan ke lokasi jual.
   */
  warehouses: defineTable({
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    code: v.string(),
    name: v.string(),
    address: v.optional(v.string()),
    active: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_code", ["tenantId", "code"])
    .index("by_tenant_store", ["tenantId", "storeId"]),

  /**
   * Supplier (`purchasing.basic`, Phase 3). Supplier adalah lawan bicara PO;
   * tempo pembayarannya dipakai nanti oleh 3-way matching & AP.
   */
  suppliers: defineTable({
    tenantId: v.id("tenants"),
    code: v.string(),
    name: v.string(),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    /** Tempo pembayaran ke supplier (hari). */
    paymentTermDays: v.number(),
    active: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_code", ["tenantId", "code"]),

  /**
   * Permintaan pembelian (PR). Dibuat staf gudang (`purchase.request`), diputuskan
   * pemilik/manajer (`purchase.approve`) — yang meminta bukan yang menyetujui.
   * Barisnya disimpan langsung di dokumen (gaya yang sama dengan `sales.payments`).
   */
  purchaseRequisitions: defineTable({
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    number: v.string(),
    status: requisitionStatusValidator,
    note: v.optional(v.string()),
    lines: v.array(requisitionLineValidator),
    requesterId: v.optional(v.id("users")),
    decidedById: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
    decisionNote: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_store", ["tenantId", "storeId"])
    .index("by_number", ["tenantId", "number"]),

  /**
   * Pesanan pembelian (PO). Dibuat dari PR yang **sudah disetujui**; supplier dan
   * harga beli ditentukan di sini. `receivedQty` per baris bertambah lewat GRN,
   * dan status PO selalu dihitung ulang dari barisnya (tidak ada status basi).
   */
  purchaseOrders: defineTable({
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    number: v.string(),
    supplierId: v.id("suppliers"),
    requisitionId: v.optional(v.id("purchaseRequisitions")),
    status: orderStatusValidator,
    expectedAt: v.optional(v.number()),
    note: v.optional(v.string()),
    lines: v.array(orderLineValidator),
    createdById: v.optional(v.id("users")),
    receivedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_store", ["tenantId", "storeId"])
    .index("by_supplier", ["tenantId", "supplierId"])
    .index("by_requisition", ["requisitionId"]),

  /**
   * Penerimaan barang (GRN). Satu GRN = satu peristiwa stok masuk ke lokasi yang
   * dipilih (`warehouseId` kosong = lokasi jual), tercatat di ledger dengan alasan
   * `purchase` dan nomor GRN sebagai `refId`.
   */
  goodsReceipts: defineTable({
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    number: v.string(),
    orderId: v.id("purchaseOrders"),
    warehouseId: v.optional(v.id("warehouses")),
    note: v.optional(v.string()),
    lines: v.array(receiptLineValidator),
    /** Nilai barang yang masuk (unit × harga beli PO). */
    total: v.number(),
    receivedById: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_store", ["tenantId", "storeId"])
    .index("by_order", ["orderId"]),

  /**
   * Sesi stock opname (`inventory.opname`, Phase 3).
   *
   * Satu sesi = satu lokasi yang dihitung. `systemQty` per baris adalah snapshot
   * saldo saat sesi dimulai (patokan selisih yang dibaca audit), sedangkan
   * posting membuat stok lokasi sama persis dengan `countedQty` — lihat
   * `lib/opname.ts`. Baris tanpa `countedQty` berarti **belum dihitung**, dan
   * baris seperti itu tidak pernah ditulis sebagai 0.
   */
  opnameSessions: defineTable({
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    number: v.string(),
    /** Kosong = lokasi jual toko. */
    warehouseId: v.optional(v.id("warehouses")),
    status: v.union(v.literal("draft"), v.literal("posted"), v.literal("cancelled")),
    note: v.optional(v.string()),
    lines: v.array(opnameLineValidator),
    startedById: v.optional(v.id("users")),
    postedById: v.optional(v.id("users")),
    createdAt: v.number(),
    postedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_store", ["tenantId", "storeId"])
    .index("by_tenant_status", ["tenantId", "status"]),

  /**
   * Hutang usaha (AP) — tagihan supplier yang punya tempo (`purchasing.basic`).
   *
   * Satu baris per tagihan, bukan satu saldo per supplier, supaya umur hutang
   * bisa dilacak per tagihan. Hutang lahir dari penerimaan barang lewat GRN
   * (`receiptId`) atau dicatat manual untuk tagihan di luar PO (saldo awal /
   * tagihan jasa). `paidAmount` bertambah lewat `payablePayments`, dan `status`
   * menjadi `paid` setelah sisanya 0.
   */
  payables: defineTable({
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    supplierId: v.id("suppliers"),
    number: v.string(),
    /** Nomor tagihan dari supplier (opsional; sering baru datang menyusul). */
    reference: v.optional(v.string()),
    orderId: v.optional(v.id("purchaseOrders")),
    receiptId: v.optional(v.id("goodsReceipts")),
    amount: v.number(),
    paidAmount: v.number(),
    dueDate: v.number(),
    /** Tempo yang dipakai saat hutang lahir (0 untuk tagihan manual/manual-date). */
    paymentTermDays: v.number(),
    status: v.union(v.literal("open"), v.literal("paid"), v.literal("void")),
    note: v.optional(v.string()),
    /**
     * Dokumen supplier yang dicocokkan (3-way matching). `total` dihitung dari
     * barisnya, bukan diketik terpisah, sehingga total dan barisnya tidak pernah
     * berbeda. Pencocokan itu sendiri **tidak disimpan** — statusnya selalu
     * dihitung ulang dari PO + GRN + dokumen ini.
     */
    invoice: v.optional(
      v.object({
        reference: v.optional(v.string()),
        total: v.number(),
        lines: v.array(invoiceLineValidator),
        note: v.optional(v.string()),
        recordedById: v.optional(v.id("users")),
        recordedAt: v.number(),
      }),
    ),
    /**
     * Keputusan manusia atas selisih: `accepted` menyesuaikan nilai hutang ke total
     * tagihan supplier, `disputed` menahan pembayarannya sampai dicabut.
     */
    matchDecision: v.optional(
      v.object({
        kind: v.union(v.literal("accepted"), v.literal("disputed")),
        note: v.optional(v.string()),
        decidedById: v.optional(v.id("users")),
        decidedAt: v.number(),
      }),
    ),
    /**
     * Sudah pernah diberitahukan lewat event `payable.due`? Penanda inilah yang
     * membuat pekerja harian tidak mengabarkan tagihan yang sama setiap hari;
     * hutang jatuh tempo berubah karena waktu, bukan karena transaksi.
     */
    dueNotified: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_supplier", ["tenantId", "supplierId"])
    .index("by_receipt", ["receiptId"])
    .index("by_order", ["orderId"])
    /**
     * Tagihan yang belum diingatkan, urut jatuh tempo terdekat — jalur indeks
     * pekerja pengingat (`payables.notifyDuePayables`), bukan pemindaian tabel.
     */
    .index("by_due", ["dueNotified", "dueDate"]),

  /** Pembayaran hutang supplier (boleh sebagian) — jejak audit pelunasan. */
  payablePayments: defineTable({
    tenantId: v.id("tenants"),
    payableId: v.id("payables"),
    supplierId: v.id("suppliers"),
    amount: v.number(),
    method: paymentMethodValidator,
    note: v.optional(v.string()),
    /** Nomor batch (`PAY-…`) kalau pembayaran ini bagian dari bayar sekaligus. */
    batchNumber: v.optional(v.string()),
    actorId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_payable", ["payableId"]),

  stockLevels: defineTable({
    tenantId: v.id("tenants"),
    productId: v.id("products"),
    storeId: v.id("stores"),
    /**
     * Kosong = lokasi jual toko (bucket lama, tempat kasir menjual). Diisi =
     * gudang/lokasi penyimpanan tambahan.
     */
    warehouseId: v.optional(v.id("warehouses")),
    quantity: v.number(),
    updatedAt: v.number(),
  })
    .index("by_product_store", ["productId", "storeId"])
    .index("by_tenant_store", ["tenantId", "storeId"]),

  stockMovements: defineTable({
    tenantId: v.id("tenants"),
    productId: v.id("products"),
    storeId: v.id("stores"),
    /** Lokasi yang bergerak; kosong = lokasi jual toko. */
    warehouseId: v.optional(v.id("warehouses")),
    /** Signed change applied to the level. */
    delta: v.number(),
    /** Level after this movement — makes the ledger self-auditing. */
    balanceAfter: v.number(),
    reason: movementReasonValidator,
    refType: v.optional(v.string()),
    refId: v.optional(v.string()),
    note: v.optional(v.string()),
    actorId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_tenant_product", ["tenantId", "productId"])
    .index("by_tenant_created", ["tenantId", "createdAt"])
    .index("by_ref", ["refType", "refId"]),

  shifts: defineTable({
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    cashierId: v.id("users"),
    status: v.union(v.literal("open"), v.literal("closed")),
    openingCash: v.number(),
    closingCash: v.optional(v.number()),
    expectedCash: v.optional(v.number()),
    /** counted - expected, positive = surplus. */
    variance: v.optional(v.number()),
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index("by_tenant_store", ["tenantId", "storeId"])
    .index("by_cashier", ["cashierId"]),

  sales: defineTable({
    tenantId: v.id("tenants"),
    storeId: v.id("stores"),
    shiftId: v.optional(v.id("shifts")),
    number: v.string(),
    status: v.union(
      v.literal("completed"),
      v.literal("held"),
      v.literal("void"),
    ),
    subtotal: v.number(),
    discount: v.number(),
    tax: v.number(),
    taxRatePct: v.number(),
    /**
     * Pajak mana yang dipungut penjualan ini (`lib/fnbTax.ts`): PPN seperti
     * sebelumnya, PBJT pajak daerah yang menggantikannya, atau tidak ada.
     */
    taxKind: v.optional(saleTaxKindValidator),
    /**
     * Biaya layanan yang dipungut penjualan ini (bukan pajak). Opsional supaya
     * baris penjualan yang dicatat sebelum kolomnya ada tetap sah.
     */
    serviceCharge: v.optional(v.number()),
    total: v.number(),
    payments: v.array(paymentValidator),
    cashierId: v.optional(v.id("users")),
    /** Client-generated key so offline replays never double-charge. */
    idempotencyKey: v.string(),
    /** Meja yang ditempati pesanan ini (modul F&B, `pos.table`). */
    tableId: v.optional(v.id("tables")),
    /** Pelanggan B2B penanggung tagihan (modul Grosir, `ar.creditlimit`). */
    customerId: v.optional(v.id("customers")),
    /** Member yang dipakai di transaksi ini (modul UMKM, `member.discount`). */
    memberId: v.optional(v.id("members")),
    /** Bagian dari `discount` yang berasal dari diskon member (bukan manual). */
    memberDiscount: v.optional(v.number()),
    /**
     * Tagihan digital yang melunasi penjualan ini (`payment.digital`). Hanya boleh
     * menunjuk tagihan yang **sudah lunas** dan bernominal sama dengan total
     * penjualan — dua catatan uang yang tidak boleh berbeda.
     */
    digitalChargeId: v.optional(v.id("digitalCharges")),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_store_created", ["tenantId", "storeId", "createdAt"])
    /**
     * Rentang tanggal **seluruh workspace** (semua toko), dipakai ringkasan
     * setoran pajak daerah di halaman Pengaturan: pajaknya setelan workspace,
     * jadi omzetnya tidak boleh hanya satu toko.
     */
    .index("by_tenant_created", ["tenantId", "createdAt"])
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_table", ["tableId"]),

  saleItems: defineTable({
    tenantId: v.id("tenants"),
    saleId: v.id("sales"),
    productId: v.id("products"),
    /** Denormalised so historical receipts never change. */
    name: v.string(),
    unitPrice: v.number(),
    quantity: v.number(),
    lineTotal: v.number(),
    modifiers: v.optional(v.array(v.string())),
  })
    .index("by_sale", ["saleId"])
    .index("by_tenant", ["tenantId"])
    /**
     * Dipakai pagar hapus produk (`products.remove`): produk yang sudah pernah
     * terjual tidak boleh dihapus, dan pertanyaannya dijawab lewat indeks ini —
     * bukan dengan memindai seluruh baris penjualan tenant.
     */
    .index("by_tenant_product", ["tenantId", "productId"]),

  devices: defineTable({
    tenantId: v.id("tenants"),
    storeId: v.optional(v.id("stores")),
    name: v.string(),
    fingerprint: v.string(),
    /** Jenis perangkat (`sync.realtime`, Phase 6); kosong = belum dilaporkan. */
    platform: v.optional(syncPlatformValidator),
    lastSeenAt: v.number(),
    revoked: v.boolean(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_fingerprint", ["tenantId", "fingerprint"]),

  subscriptionInvoices: defineTable({
    tenantId: v.id("tenants"),
    number: v.string(),
    periodStart: v.number(),
    periodEnd: v.number(),
    net: v.number(),
    tax: v.number(),
    gross: v.number(),
    status: v.union(v.literal("open"), v.literal("paid"), v.literal("void")),
    provider: v.union(
      v.literal("xendit"),
      v.literal("gdcpay"),
      v.literal("manual"),
    ),
    providerRef: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_number", ["number"]),

  /** Idempotency ledger for provider webhooks. */
  webhookEvents: defineTable({
    provider: v.string(),
    eventId: v.string(),
    type: v.string(),
    payload: v.optional(v.string()),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
  }).index("by_provider_event", ["provider", "eventId"]),

  auditLogs: defineTable({
    tenantId: v.id("tenants"),
    actorId: v.optional(v.id("users")),
    action: v.string(),
    entity: v.string(),
    entityId: v.optional(v.string()),
    meta: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_tenant", ["tenantId"])
    .index("by_tenant_created", ["tenantId", "createdAt"]),

  /**
   * Sesi pendampingan platform (`lib/impersonation.ts`).
   *
   * Akun platform tidak pernah menjadi anggota tenant, jadi bantuannya tidak
   * bisa berupa “masuk sebagai anggota” — itu justru yang dilarang. Yang
   * disimpan di sini adalah **izin sementara yang berjejak**: siapa (actorId),
   * tenant mana, atas alasan apa, sampai kapan, dan berapa kali tenant itu dibaca.
   *
   * `source` dipatok literal `platform` supaya baris dari jalur lain tidak pernah
   * bisa menyamar sebagai sesi pendampingan. Sesi ini **hanya membaca**; tidak ada
   * izin tulis tenant yang menyertainya.
   */
  impersonationSessions: defineTable({
    actorId: v.id("users"),
    tenantId: v.id("tenants"),
    reason: v.string(),
    source: v.literal("platform"),
    status: impersonationStatusValidator,
    startedAt: v.number(),
    expiresAt: v.number(),
    endedAt: v.optional(v.number()),
    /** Kenapa ditutup: `developer` (diakhiri sendiri) atau `sweeper` (kedaluwarsa). */
    closedBy: v.optional(v.string()),
    /** Berapa kali ringkasan bantuan dibaca — jejak pemakaian, bukan sekadar jejak masuk. */
    helpCount: v.number(),
    lastHelpAt: v.optional(v.number()),
  })
    .index("by_actor_status", ["actorId", "status"])
    .index("by_tenant", ["tenantId"])
    .index("by_status_expires", ["status", "expiresAt"]),

  /** Per-tenant monotonic sequences (sale numbers, invoice numbers). */
  counters: defineTable({
    tenantId: v.id("tenants"),
    key: v.string(),
    value: v.number(),
  }).index("by_tenant_key", ["tenantId", "key"]),
});

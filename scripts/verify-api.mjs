/**
 * Uji aturan akses API & webhook (`api.access`, Phase 4) tanpa deployment.
 *
 * Dua modul murni yang diuji di sini — `src/convex/lib/apiKeys.ts` dan
 * `src/convex/lib/webhooks.ts` — adalah aturan yang sama yang dipakai endpoint
 * HTTP (`src/convex/http.ts`), halaman API & Webhook, kedua store, dan aksi
 * kirim uji. Karena itu harness ini tidak berhenti di aturan: ia juga menjaga
 * sambungan yang mudah melenceng tanpa kelihatan —
 *
 *   - kripto: SHA-256/HMAC dicocokkan dengan `node:crypto` dan vektor NIST/RFC;
 *   - setiap resource di `API_RESOURCES` harus benar-benar dibaca
 *     `readResource` (kalau tidak, endpoint-nya menjawab "tidak dikenal");
 *   - tabel & indeks yang dipakai `apiAccess.ts` harus ada di `schema.ts`;
 *   - seluruh anggota baru `StoreApi` harus diimplementasikan kedua store.
 *
 * Usage: bun scripts/verify-api.mjs
 */
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  API_KEY_EXPIRY_OPTIONS,
  API_KEY_LOOKUP_ALPHABET,
  API_KEY_LOOKUP_LENGTH,
  API_KEY_NAME_MAX,
  API_KEY_NAME_MIN,
  API_KEY_PREFIX,
  API_KEY_SECRET_ALPHABET,
  API_KEY_SECRET_LENGTH,
  API_RESOURCES,
  API_SCOPES,
  API_SCOPE_OPTIONS,
  API_SCOPE_OPTIONS_UNIQUE,
  API_SIGNATURE_RESOURCES,
  API_WRITE_RESOURCES,
  MAX_ACTIVE_API_KEYS,
  describeApiKey,
  findApiResource,
  hashApiSecret,
  isWriteResource,
  keyStatus,
  maskApiKey,
  mintApiKey,
  parseApiKey,
  randomToken,
  resourceScope,
  sanitizeApiScopes,
  scopeAllowed,
  validateApiKeyInput,
  verifyApiKey,
} from "../src/convex/lib/apiKeys.ts";
import {
  hmacSha256Hex,
  sha256Hex,
  timingSafeEqualHex,
} from "../src/convex/lib/hash.ts";
import {
  ORDER_CODE_MAX,
  ORDER_IDEMPOTENCY_MAX,
  ORDER_IDEMPOTENCY_MIN,
  ORDER_LINES_MAX,
  ORDER_NAME_MAX,
  ORDER_QUANTITY_MAX,
  PAYMENT_METHODS,
  describeExternalOrder,
  hasExplicitPaymentAmount,
  normalizeOrderCode,
  parseExternalOrder,
  sampleExternalOrderBody,
} from "../src/convex/lib/apiOrders.ts";
import {
  decodeCursor,
  encodeCursor,
  normalizeStoreCodeParam,
  parseDateRange,
  parseSaleStatus,
} from "../src/convex/lib/apiQuery.ts";
import {
  parseCustomerCreate,
  parseInboundEndpointCreate,
  parseInboundEndpointDelete,
  parseMemberCreate,
  parseProductDelete,
  parseProductPatch,
  parseStockAdjust,
  parseVoidSale,
} from "../src/convex/lib/apiWrites.ts";
import {
  INBOUND_EVENT_KEYS,
  INBOUND_WEBHOOK_EVENTS,
  INBOUND_WEBHOOK_NOTES,
  inboundSignatureProblem,
  isInboundToken,
  parseInboundEnvelope,
  sanitizeInboundEvents,
  validateInboundEndpointInput,
} from "../src/convex/lib/inboundWebhooks.ts";
import {
  DELIVERY_BACKOFF_MINUTES,
  MAX_DELIVERY_ATTEMPTS,
  MAX_RETRY_BATCH,
  MAX_WEBHOOK_ENDPOINTS,
  RETRY_WORKER_INTERVAL_MINUTES,
  WEBHOOK_EVENT_KEYS,
  WEBHOOK_EVENTS,
  WEBHOOK_SECRET_MAX,
  WEBHOOK_SECRET_MIN,
  deliveryBackoffMinutes,
  deliveryOutcome,
  describeReceiverFailure,
  describeWebhookEndpoint,
  isWebhookEvent,
  nextDeliveryAttemptAt,
  retryBatchLimit,
  retryStopReason,
  sampleDeliveryEvent,
  sampleDeliveryPayload,
  sanitizeEventSubject,
  sanitizeWebhookEvents,
  signWebhookPayload,
  validateWebhookEndpoint,
  validateWebhookSecret,
  verifyWebhookSignature,
  webhookDeliveryHeaders,
  webhookHostError,
  webhookPayload,
} from "../src/convex/lib/webhooks.ts";
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
} from "../src/convex/lib/inventory.ts";
import {
  opnamePostedEventData,
  payableDueEventData,
  productCreatedEventData,
  receivableOverdueEventData,
  saleCompletedEventData,
  saleVoidedEventData,
  stockCrossedLow,
  stockLowEventData,
} from "../src/convex/lib/webhookEvents.ts";
import {
  DUE_REMINDER_BATCH,
  DUE_REMINDER_WINDOW_MS,
  needsDueReminder,
} from "../src/convex/lib/payables.ts";
import {
  needsOverdueReminder,
  OVERDUE_REMINDER_BATCH,
  OVERDUE_REMINDER_WINDOW_MS,
} from "../src/convex/lib/ar.ts";

const results = [];
function check(name, condition, detail) {
  // Setiap kegagalan langsung menghentikan harness dengan nama cek-nya, jadi
  // satu cek yang gagal tidak pernah terbaca sebagai “lulus sebagian”.
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const HERE = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, HERE), "utf8");

// ---------------------------------------------------------------- kripto
check(
  "SHA-256 cocok dengan vektor NIST",
  sha256Hex("abc") ===
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  sha256Hex("abc"),
);
check(
  "SHA-256 cocok dengan node:crypto untuk teks Indonesia",
  sha256Hex("Kopi Susu Gula Aren — 25.000") ===
    createHash("sha256").update("Kopi Susu Gula Aren — 25.000", "utf8").digest("hex"),
  sha256Hex("Kopi Susu Gula Aren — 25.000"),
);
check(
  "HMAC-SHA256 cocok dengan vektor RFC 4231 (kunci pendek)",
  hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog") ===
    "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
  hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog"),
);
check(
  "HMAC-SHA256 kunci >64 byte di-hash dulu (RFC 2104)",
  hmacSha256Hex("a".repeat(80), "payload") ===
    createHmac("sha256", Buffer.from("a".repeat(80))).update("payload").digest("hex"),
  hmacSha256Hex("a".repeat(80), "payload"),
);
{
  // Regresi padding blok: panjang pesan 55 mod 64 membuat `bytes.length + 9`
  // tepat kelipatan 64. Versi lama menambah satu blok nol di situ, jadi digest
  // menyimpang dari SHA-256 standar — tanda tangan webhook untuk badan kiriman
  // 41 mod 64 ditolak penerima (HTTP 401 “Tanda tangan tidak cocok”) walaupun
  // rahasianya benar. Disapu ke seluruh kelas panjang, bukan hanya satu nilai.
  const key = "rahasia-uji-padding-32-karakter";
  let wrong = null;
  for (let length = 0; length <= 320 && wrong === null; length += 1) {
    const message = "x".repeat(length);
    if (sha256Hex(message) !== createHash("sha256").update(message, "utf8").digest("hex")) {
      wrong = `sha-${length}`;
      break;
    }
    if (
      hmacSha256Hex(key, message) !==
      createHmac("sha256", Buffer.from(key, "utf8")).update(message, "utf8").digest("hex")
    ) {
      wrong = `hmac-${length}`;
    }
  }
  check(
    "SHA-256 & HMAC sama dengan node:crypto untuk panjang pesan 0–320 (padding blok)",
    wrong === null,
    `menyimpang di ${wrong}`,
  );
}
check(
  "header tanda tangan webhook cocok dengan node:crypto (badan 41 mod 64)",
  (() => {
    // Badan berbentuk badan `sale.completed` sungguhan; panjangnya digeser lewat
    // isi `note` sampai `timestamp.body` jatuh di kelas 55 mod 64 — kelas yang
    // dulu salah. Timestamp 13 digit sama seperti `Date.now()` sekarang.
    const timestamp = 1792516575805;
    const build = (pad) =>
      JSON.stringify({
        id: "evt_1792516575805_sale.completed_A-00047",
        event: "sale.completed",
        createdAt: "2026-10-20T17:16:15.805Z",
        data: { number: "A-00047", total: 68000, note: "x".repeat(pad) },
      });
    let body = null;
    for (let pad = 0; pad <= 80 && body === null; pad += 1) {
      const candidate = build(pad);
      if (candidate.length % 64 === 41) body = candidate;
    }
    if (body === null) return false;
    const headers = webhookDeliveryHeaders({
      secret: "rahasia-uji-padding-32-karakter",
      timestamp,
      event: "sale.completed",
      attempt: 1,
      body,
    });
    const expected = `sha256=${createHmac("sha256", "rahasia-uji-padding-32-karakter")
      .update(`${timestamp}.${body}`, "utf8")
      .digest("hex")}`;
    return headers["x-mesinpos-signature"] === expected;
  })(),
  "DITERIMA — tanda tangan menyimpang",
);
check(
  "perbandingan hash menolak panjang berbeda",
  timingSafeEqualHex("abcd", "abcD") === false && timingSafeEqualHex("", "") === false,
  "DITERIMA — perbandingan bocor",
);

// ------------------------------------------------------------- bentuk kunci
check(
  "kunci baru berbentuk mp_<publicId>_<secret>",
  (() => {
    const minted = mintApiKey();
    return (
      minted.plaintext.startsWith(API_KEY_PREFIX) &&
      minted.publicId.length === API_KEY_LOOKUP_LENGTH &&
      minted.secret.length === API_KEY_SECRET_LENGTH
    );
  })(),
  "DITERIMA — bentuk kunci melenceng",
);
check(
  "publicId membuang karakter yang mudah tertukar saat dibaca",
  !/[0OlI1]/.test(API_KEY_LOOKUP_ALPHABET),
  API_KEY_LOOKUP_ALPHABET,
);

{
  // RNG disuntik supaya hasilnya deterministik — kripto yang tidak bisa diuji
  // ulang tidak bisa dipercaya.
  const bytes = (length) => Uint8Array.from({ length }, (_, index) => index * 7);
  const minted = mintApiKey({ randomBytes: bytes });
  const expectedPublicId = Array.from({ length: API_KEY_LOOKUP_LENGTH }, (_, index) =>
    API_KEY_LOOKUP_ALPHABET[(index * 7) % API_KEY_LOOKUP_ALPHABET.length],
  ).join("");
  check(
    "mintApiKey memakai RNG yang disuntikkan",
    minted.publicId === expectedPublicId,
    `${minted.publicId} vs ${expectedPublicId}`,
  );

  const parsed = parseApiKey(minted.plaintext);
  check(
    "parseApiKey mengembalikan publicId & secret yang sama",
    parsed?.publicId === minted.publicId && parsed?.secret === minted.secret,
    JSON.stringify(parsed),
  );
  check(
    "hash tersimpan = sha256(publicId:secret), bukan rahasianya",
    minted.secretHash === hashApiSecret(minted.publicId, minted.secret) &&
      !minted.secretHash.includes(minted.secret) &&
      minted.secretHash.length === 64,
    minted.secretHash,
  );
  check(
    "mask hanya membuka publicId",
    maskApiKey(minted.publicId) === `${API_KEY_PREFIX}${minted.publicId}_••••••••` &&
      !maskApiKey(minted.publicId).includes(minted.secret),
    maskApiKey(minted.publicId),
  );
}

check(
  "randomToken memetakan byte ke alfabet",
  randomToken(4, "ab", () => Uint8Array.from([0, 1, 2, 3])) === "abab",
  randomToken(4, "ab", () => Uint8Array.from([0, 1, 2, 3])),
);

for (const [label, value] of [
  ["tanpa awalan mp_", "abcdefghij_".padEnd(11 + API_KEY_SECRET_LENGTH, "a")],
  ["publicId terlalu pendek", `${API_KEY_PREFIX}abc_secret`],
  ["tanpa pemisah", `${API_KEY_PREFIX}abcdefghijklmnop`],
  ["publicId memuat huruf ambigu", `${API_KEY_PREFIX}0O0O0O0O0O_${"a".repeat(API_KEY_SECRET_LENGTH)}`],
  ["rahasia terlalu pendek", `${API_KEY_PREFIX}abcdefghij_short`],
  ["bukan teks", 42],
]) {
  check(`format kunci ditolak: ${label}`, parseApiKey(value) === null, String(value).slice(0, 24));
}

// ---------------------------------------------------------- status & verifikasi
{
  const now = Date.now();
  const minted = mintApiKey();
  const record = {
    publicId: minted.publicId,
    secretHash: minted.secretHash,
    active: true,
    revokedAt: null,
    expiresAt: now + 60_000,
  };

  check("kunci aktif lolos verifikasi", verifyApiKey(minted.plaintext, record, now).ok, "DITOLAK");
  check(
    "rahasia yang salah ditolak",
    (() => {
      const other = mintApiKey();
      const verdict = verifyApiKey(minted.plaintext, { ...record, secretHash: other.secretHash }, now);
      return !verdict.ok && verdict.reason.includes("tidak valid");
    })(),
    "DITERIMA — rahasia salah lolos",
  );
  check(
    "publicId yang tidak dikenal ditolak",
    (() => {
      const other = mintApiKey();
      const verdict = verifyApiKey(other.plaintext, record, now);
      return !verdict.ok && verdict.reason.includes("tidak dikenal");
    })(),
    "DITERIMA — kunci asing lolos",
  );
  check(
    "baris tanpa kunci ditolak",
    !verifyApiKey(minted.plaintext, null, now).ok,
    "DITERIMA — null lolos",
  );
  check(
    "kunci dicabut ditolak dengan alasannya",
    (() => {
      const verdict = verifyApiKey(minted.plaintext, { ...record, active: false }, now);
      return !verdict.ok && verdict.reason.includes("dicabut");
    })(),
    "DITERIMA — kunci dicabut masih bekerja",
  );
  check(
    "kunci kedaluwarsa ditolak",
    (() => {
      const verdict = verifyApiKey(minted.plaintext, { ...record, expiresAt: now - 1 }, now);
      return !verdict.ok && verdict.reason.includes("kedaluwarsa");
    })(),
    "DITERIMA — kunci kedaluwarsa masih bekerja",
  );
  check(
    "format salah ditolak sebelum menyentuh hash (pesannya soal format)",
    verifyApiKey("nope", record, now).reason.includes("Format"),
    verifyApiKey("nope", record, now).reason,
  );

  check(
    "status kunci: aktif / dicabut / kedaluwarsa",
    keyStatus({ active: true, revokedAt: null, expiresAt: null }, now) === "active" &&
      keyStatus({ active: false, revokedAt: null, expiresAt: null }, now) === "revoked" &&
      keyStatus({ active: true, revokedAt: now - 5, expiresAt: null }, now) === "revoked" &&
      keyStatus({ active: true, revokedAt: null, expiresAt: now - 5 }, now) === "expired",
    "DITERIMA — status kunci salah",
  );
}

// -------------------------------------------------------------- scope & resource
check(
  "setiap scope API punya endpoint yang memakainya",
  API_SCOPE_OPTIONS.every(
    (option) =>
      /^(GET|POST|PATCH|DELETE) \/api\/v1\//.test(option.endpoint) &&
      option.label.length > 0,
  ) && API_SCOPES.length === API_SCOPE_OPTIONS_UNIQUE.length,
  JSON.stringify(API_SCOPE_OPTIONS.map((option) => option.endpoint)),
);
check(
  "daftar scope tidak menampilkan satu scope berkali-kali",
  new Set(API_SCOPE_OPTIONS_UNIQUE.map((option) => option.permission)).size ===
    API_SCOPE_OPTIONS_UNIQUE.length &&
    API_SCOPE_OPTIONS_UNIQUE.some((option) => option.permission === "product.manage" && option.write),
  JSON.stringify(API_SCOPE_OPTIONS_UNIQUE.map((option) => [option.permission, option.write])),
);
check(
  "setiap endpoint tulis terdaftar dan memakai izin domain yang ada",
  API_WRITE_RESOURCES.length ===
    API_RESOURCES.filter((resource) => resource.method !== "GET").length &&
    API_WRITE_RESOURCES.some((row) => row.resource === "sales.create" && row.scope === "pos.sell") &&
    API_WRITE_RESOURCES.some((row) => row.resource === "sales.void" && row.scope === "pos.void") &&
    API_WRITE_RESOURCES.some((row) => row.resource === "products.update" && row.scope === "product.manage") &&
    API_WRITE_RESOURCES.some((row) => row.resource === "stock.adjust" && row.scope === "stock.adjust") &&
    API_WRITE_RESOURCES.filter((row) => row.scope === null).every((row) => row.auth === "signature"),
  JSON.stringify(API_WRITE_RESOURCES.map((row) => [row.method, row.path, row.scope])),
);
check(
  "flag write diturunkan dari method, bukan daftar terpisah",
  API_RESOURCES.every((resource) => resource.write === (resource.method !== "GET")),
  JSON.stringify(API_RESOURCES.map((row) => [row.resource, row.method, row.write])),
);
check(
  "webhook masuk adalah satu-satunya endpoint bersignature, bukan kunci API",
  API_SIGNATURE_RESOURCES.length === 1 &&
    API_SIGNATURE_RESOURCES[0].resource === "inboundWebhooks.receive" &&
    API_SIGNATURE_RESOURCES[0].path === "/api/v1/webhooks/incoming/{token}" &&
    API_SIGNATURE_RESOURCES[0].scope === null,
  JSON.stringify(API_SIGNATURE_RESOURCES),
);
check(
  "endpoint tulis bisa dicari per method + path",
  findApiResource("POST", "/api/v1/sales")?.resource === "sales.create" &&
    findApiResource("POST", "/api/v1/sales")?.scope === "pos.sell" &&
    findApiResource("GET", "/api/v1/sales")?.resource === "sales" &&
    findApiResource("DELETE", "/api/v1/products")?.resource === "products.delete" &&
    findApiResource("PATCH", "/api/v1/products")?.resource === "products.update" &&
    findApiResource("DELETE", "/api/v1/sales") === null,
  JSON.stringify(findApiResource("PATCH", "/api/v1/products")),
);
check(
  "isWriteResource membedakan tulis, baca, dan resource asing",
  isWriteResource("sales.create") === true &&
    isWriteResource("sales") === false &&
    isWriteResource("penjualan") === undefined,
  String(isWriteResource("sales.create")),
);
check(
  "scope tulis muncul di daftar scope yang bisa dipilih",
  API_SCOPE_OPTIONS.some((option) => option.permission === "pos.sell" && option.write),
  JSON.stringify(API_SCOPE_OPTIONS.map((option) => [option.permission, option.write])),
);
check(
  "scope tulis tetap dibatasi izin pembuat kunci",
  scopeAllowed("cashier", ["pos.sell"], "pos.sell") &&
    scopeAllowed("owner", ["pos.sell"], "pos.sell") &&
    !scopeAllowed("finance", ["pos.sell"], "pos.sell") &&
    !scopeAllowed("inventory", ["pos.sell"], "pos.sell"),
  JSON.stringify({
    kasir: scopeAllowed("cashier", ["pos.sell"], "pos.sell"),
    keuangan: scopeAllowed("finance", ["pos.sell"], "pos.sell"),
  }),
);
check(
  "scope kunci = scope endpoint, tanpa duplikat",
  new Set(API_SCOPES).size === API_SCOPES.length &&
    API_RESOURCES.every((resource) => resource.scope === null || API_SCOPES.includes(resource.scope)),
  JSON.stringify(API_SCOPES),
);
check(
  "resource asing tidak punya scope",
  resourceScope("penjualan") === undefined && resourceScope("sales") === "report.view",
  JSON.stringify(resourceScope("penjualan")),
);
check(
  "endpoint ping hanya butuh kunci sah",
  resourceScope("ping") === null,
  String(resourceScope("ping")),
);
check(
  "sanitizeApiScopes membuang scope di luar daftar API",
  JSON.stringify(sanitizeApiScopes(["payable.view", "billing.manage", "payable.view"])) ===
    JSON.stringify(["payable.view"]),
  JSON.stringify(sanitizeApiScopes(["payable.view", "billing.manage", "payable.view"])),
);

check(
  "scope dilihat dari izin pembuat saat ini, bukan hanya dari daftar kunci",
  scopeAllowed("manager", ["payable.view"], "payable.view") &&
    // Kasir tidak memegang izin hutang usaha, jadi kunci apa pun tidak bisa
    // membuka scope itu untuknya — peran pembuat dilihat **saat ini**.
    !scopeAllowed("cashier", ["payable.view"], "payable.view") &&
    scopeAllowed("finance", ["payable.view"], "payable.view") &&
    scopeAllowed("owner", ["inventory.view"], "inventory.view"),
  JSON.stringify({
    manager: scopeAllowed("manager", ["payable.view"], "payable.view"),
    cashier: scopeAllowed("cashier", ["payable.view"], "payable.view"),
  }),
);
check(
  "scope di luar kunci ditolak walau perannya boleh",
  !scopeAllowed("owner", ["report.view"], "inventory.view"),
  "DITERIMA — scope di luar daftar kunci lolos",
);
check(
  "peran tak dikenal tidak diberi apa pun",
  !scopeAllowed("superadmin", ["report.view"], "report.view"),
  "DITERIMA — peran asing lolos",
);

// -------------------------------------------------------- validasi kunci baru
{
  const owner = ["report.view", "inventory.view", "payable.view", "api.manage", "billing.manage"];
  const ok = validateApiKeyInput(
    { name: "  Server   Produksi ", scopes: ["report.view", "report.view", "inventory.view"], expiresInDays: 30 },
    { permissions: owner, now: 0 },
  );
  check("kunci valid diterima", ok.ok, ok.reason);
  check(
    "nama dirapikan & scope diurutkan tanpa duplikat",
    ok.ok &&
      ok.value.name === "Server Produksi" &&
      JSON.stringify(ok.value.scopes) === JSON.stringify(["report.view", "inventory.view"]) &&
      ok.value.expiresAt === 30 * 24 * 60 * 60 * 1000,
    JSON.stringify(ok.ok ? ok.value : ok.reason),
  );

  const forever = validateApiKeyInput(
    { name: "Server Tetap", scopes: ["report.view"], expiresInDays: 0 },
    { permissions: owner, now: 0 },
  );
  check(
    "masa berlaku 0 berarti tanpa kedaluwarsa",
    forever.ok && forever.value.expiresAt === null,
    JSON.stringify(forever.ok ? forever.value : forever.reason),
  );

  for (const [label, input, options, expected] of [
    [
      "nama terlalu pendek",
      { name: "ab", scopes: ["report.view"] },
      { permissions: owner },
      `${API_KEY_NAME_MIN}–${API_KEY_NAME_MAX}`,
    ],
    [
      "nama terlalu panjang",
      { name: "x".repeat(API_KEY_NAME_MAX + 1), scopes: ["report.view"] },
      { permissions: owner },
      `${API_KEY_NAME_MIN}–${API_KEY_NAME_MAX}`,
    ],
    [
      "nama sudah dipakai",
      { name: "server produksi", scopes: ["report.view"] },
      { permissions: owner, existingNames: ["Server Produksi"] },
      "sudah ada",
    ],
    [
      "tanpa scope",
      { name: "Kunci Kosong", scopes: [] },
      { permissions: owner },
      "minimal satu scope",
    ],
    [
      "scope di luar daftar API",
      { name: "Kunci Aneh", scopes: ["report.view", "team.manage"] },
      { permissions: owner },
      "di luar daftar API",
    ],
    [
      "scope di luar izin pembuat",
      { name: "Kunci Naik Kelas", scopes: ["payable.view"] },
      { permissions: ["report.view", "api.manage"] },
      "tidak punya",
    ],
    [
      "batas kunci hidup tercapai",
      { name: "Kunci ke-21", scopes: ["report.view"] },
      { permissions: owner, activeCount: MAX_ACTIVE_API_KEYS },
      String(MAX_ACTIVE_API_KEYS),
    ],
    [
      "masa berlaku negatif",
      { name: "Kunci Masa Lalu", scopes: ["report.view"], expiresInDays: -1 },
      { permissions: owner },
      "negatif",
    ],
    [
      "masa berlaku keterlaluan",
      { name: "Kunci Abadi", scopes: ["report.view"], expiresInDays: 4000 },
      { permissions: owner },
      "10 tahun",
    ],
  ]) {
    const result = validateApiKeyInput(input, { now: 0, ...options });
    check(
      `kunci ditolak: ${label}`,
      !result.ok && result.reason.includes(expected),
      result.ok ? "DITERIMA — validasi bocor" : result.reason,
    );
  }
}

check(
  "opsi masa berlaku selalu memuat “tanpa kedaluwarsa”",
  API_KEY_EXPIRY_OPTIONS.some((option) => option.days === 0),
  JSON.stringify(API_KEY_EXPIRY_OPTIONS),
);
check(
  "ringkasan kunci menyebut jumlah scope yang sah",
  describeApiKey({ name: " Server Produksi ", scopes: ["report.view", "nope", "report.view"] }) ===
    "Server Produksi · 1 scope",
  describeApiKey({ name: " Server Produksi ", scopes: ["report.view", "nope", "report.view"] }),
);

// ------------------------------------------------------------------ webhook
check(
  "katalog event memakai bentuk objek.aksi dan unik",
  WEBHOOK_EVENTS.every((event) => /^[a-z]+\.[a-z]+$/.test(event.key)) &&
    new Set(WEBHOOK_EVENT_KEYS).size === WEBHOOK_EVENTS.length,
  JSON.stringify(WEBHOOK_EVENT_KEYS),
);
check(
  "isWebhookEvent hanya menerima event katalog",
  isWebhookEvent("sale.completed") && !isWebhookEvent("sale.created"),
  String(isWebhookEvent("sale.created")),
);
check(
  "sanitizeWebhookEvents membuang event asing & duplikat, urut katalog",
  JSON.stringify(sanitizeWebhookEvents(["stock.low", "nope", "sale.completed", "stock.low"])) ===
    JSON.stringify(["sale.completed", "stock.low"]),
  JSON.stringify(sanitizeWebhookEvents(["stock.low", "nope", "sale.completed", "stock.low"])),
);

{
  const ok = validateWebhookEndpoint({
    url: "  https://Sistem-anda.example.com/hooks/mesinpos  ",
    description: "Gudang pusat".repeat(20),
    events: ["stock.low", "sale.completed", "stock.low"],
  });
  check("endpoint valid diterima", ok.ok, ok.reason);
  check(
    "URL dinormalkan, event diurutkan, keterangan dipotong 120 karakter",
    ok.ok &&
      ok.value.url === "https://sistem-anda.example.com/hooks/mesinpos" &&
      JSON.stringify(ok.value.events) === JSON.stringify(["sale.completed", "stock.low"]) &&
      ok.value.description.length === 120,
    JSON.stringify(ok.ok ? ok.value : ok.reason),
  );

  const duplicated = validateWebhookEndpoint(
    { url: "https://sistem-anda.example.com/hooks/mesinpos", events: ["sale.completed"] },
    { existingUrls: ["https://sistem-anda.example.com/hooks/mesinpos"] },
  );
  check(
    "endpoint dengan URL yang sudah terdaftar ditolak",
    !duplicated.ok && duplicated.reason.includes("sudah terdaftar"),
    duplicated.ok ? "DITERIMA — duplikat lolos" : duplicated.reason,
  );

  for (const [label, input, expected] of [
    ["URL kosong", { url: "   ", events: ["sale.completed"] }, "wajib diisi"],
    ["HTTP biasa", { url: "http://toko.example.com/hook", events: ["sale.completed"] }, "HTTPS"],
    [
      "kredensial di URL",
      { url: "https://rahasia:pass@toko.example.com/hook", events: ["sale.completed"] },
      "kredensial",
    ],
    ["URL tidak valid", { url: "bukan-url", events: ["sale.completed"] }, "tidak valid"],
    [
      "URL terlalu panjang",
      { url: `https://toko.example.com/${"x".repeat(300)}`, events: ["sale.completed"] },
      "maksimal",
    ],
    ["tanpa event", { url: "https://toko.example.com/hook", events: [] }, "minimal satu event"],
    [
      "hanya event asing",
      { url: "https://toko.example.com/hook", events: ["nope"] },
      "minimal satu event",
    ],
  ]) {
    const result = validateWebhookEndpoint(input);
    check(
      `endpoint ditolak: ${label}`,
      !result.ok && result.reason.includes(expected),
      result.ok ? "DITERIMA — validasi bocor" : result.reason,
    );
  }

  // Alamat dalam jaringan adalah cara termudah membocorkan data penjualan.
  for (const host of [
    "localhost",
    "127.0.0.1",
    "10.0.0.8",
    "192.168.1.10",
    "172.16.4.2",
    "[::1]",
    "kasir.local",
    "api.internal",
    "0.0.0.0",
    "mesin-toko",
  ]) {
    const url = `https://${host}/hook`;
    const result = validateWebhookEndpoint({ url, events: ["sale.completed"] });
    check(
      `host dalam jaringan ditolak: ${host}`,
      !result.ok && typeof webhookHostError(url) === "string",
      result.ok ? "DITERIMA — webhook ke jaringan dalam" : result.reason,
    );
  }
  check(
    "host publik biasa diterima",
    validateWebhookEndpoint({ url: "https://api.partner.co.id/hooks/pos", events: ["stock.low"] }).ok,
    "DITOLAK — host publik ikut diblokir",
  );
}

{
  // Tanda tangan dicocokkan dengan node:crypto, bukan dengan dirinya sendiri.
  const secret = "rahasia-bersama-32-karakter";
  const timestamp = 1_791_746_927_000;
  const body = JSON.stringify({ event: "sale.completed", total: 22120000 });
  const signature = signWebhookPayload(secret, timestamp, body);
  check(
    "tanda tangan = sha256=HMAC(secret, `timestamp.body`)",
    signature ===
      `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`,
    signature,
  );
  check(
    "penerima bisa memverifikasi tanda tangan yang masih segar",
    verifyWebhookSignature({
      secret,
      timestamp,
      body,
      signature,
      now: timestamp + 1000,
    }),
    "DITOLAK — tanda tangan sah tidak lolos",
  );
  for (const [label, override] of [
    ["isi diubah", { body: `${body} ` }],
    ["rahasia salah", { secret: "rahasia-lain" }],
    ["waktu kirim basi", { now: timestamp + 10 * 60 * 1000 }],
    ["tanda tangan salah", { signature: `sha256=${"0".repeat(64)}` }],
  ]) {
    check(
      `tanda tangan ditolak: ${label}`,
      !verifyWebhookSignature({ secret, timestamp, body, signature, now: timestamp + 1000, ...override }),
      "DITERIMA — verifikasi tanda tangan bocor",
    );
  }
}

check(
  "jadwal percobaan menaik lalu menyerah pada percobaan ke-5",
  JSON.stringify([1, 2, 3, 4, 5].map((attempts) => deliveryBackoffMinutes(attempts))) ===
    JSON.stringify([...DELIVERY_BACKOFF_MINUTES.slice(0, 4), null]) &&
    DELIVERY_BACKOFF_MINUTES.length === MAX_DELIVERY_ATTEMPTS,
  JSON.stringify([1, 2, 3, 4, 5].map((attempts) => deliveryBackoffMinutes(attempts))),
);
check(
  "deliveryOutcome: percobaan 1–4 menunggu, ke-5 menyerah",
  deliveryOutcome(1) === "pending" &&
    deliveryOutcome(4) === "pending" &&
    deliveryOutcome(5) === "failed" &&
    deliveryOutcome(6) === "failed",
  JSON.stringify([1, 4, 5, 6].map(deliveryOutcome)),
);
check(
  "jadwal berikutnya = sekarang + jeda (menit)",
  nextDeliveryAttemptAt(2, 1_000) === 1_000 + 5 * 60 * 1000 &&
    nextDeliveryAttemptAt(5, 1_000) === null,
  JSON.stringify([nextDeliveryAttemptAt(2, 1000), nextDeliveryAttemptAt(5, 1000)]),
);

{
  const at = 1_791_746_927_000;
  const payload = sampleDeliveryPayload("stock.low", at);
  let parsed = null;
  try {
    parsed = JSON.parse(payload);
  } catch {
    parsed = null;
  }
  check(
    "payload contoh adalah JSON dengan event, id, & waktu ISO",
    parsed?.event === "stock.low" &&
      typeof parsed?.id === "string" &&
      parsed?.createdAt === new Date(at).toISOString(),
    payload,
  );
  check(
    "event contoh selalu salah satu event yang dilanggan, deterministik",
    sampleDeliveryEvent(["opname.posted", "stock.low"]) === "stock.low" &&
      sampleDeliveryEvent(["opname.posted"]) === "opname.posted" &&
      sampleDeliveryEvent([]) === "sale.completed" &&
      sampleDeliveryEvent(["sale.completed", "payable.due"]) === "sale.completed",
    `${sampleDeliveryEvent(["opname.posted", "stock.low"])} / ${sampleDeliveryEvent([])}`,
  );
  check(
    "ringkasan endpoint menyebut host & jumlah event",
    describeWebhookEndpoint({ url: "https://api.partner.co.id/hooks/pos", events: ["stock.low", "nope"] }) ===
      "api.partner.co.id · 1 event",
    describeWebhookEndpoint({ url: "https://api.partner.co.id/hooks/pos", events: ["stock.low", "nope"] }),
  );
  check(
    "batas jumlah endpoint webhook masuk akal",
    MAX_WEBHOOK_ENDPOINTS >= 1 && MAX_WEBHOOK_ENDPOINTS <= 50,
    String(MAX_WEBHOOK_ENDPOINTS),
  );
}

// -------------------------------------------- pekerja percobaan ulang webhook
// Jadwal percobaan ulang baru berguna kalau ada yang menjalankannya. Berkas ini
// menguji aturan pekerja (`crons.ts` + `apiAccess.retryDueDeliveries`) tanpa
// jaringan; perilaku nyatanya diuji `scripts/verify-webhook-retries.mjs`.
check(
  "jeda & batas putaran pekerja masuk akal",
  MAX_RETRY_BATCH >= 1 &&
    MAX_RETRY_BATCH <= 100 &&
    RETRY_WORKER_INTERVAL_MINUTES >= 1 &&
    // Jeda percobaan terkecil adalah 1 menit: memeriksa lebih jarang daripada itu
    // berarti pekerja melewatkan jadwalnya sendiri.
    RETRY_WORKER_INTERVAL_MINUTES <= DELIVERY_BACKOFF_MINUTES[0],
  JSON.stringify({ batch: MAX_RETRY_BATCH, menit: RETRY_WORKER_INTERVAL_MINUTES }),
);
check(
  "retryBatchLimit menjepit permintaan ke batas aman",
  retryBatchLimit(undefined) === MAX_RETRY_BATCH &&
    retryBatchLimit(Number.NaN) === MAX_RETRY_BATCH &&
    retryBatchLimit(3) === 3 &&
    retryBatchLimit(2.9) === 2 &&
    retryBatchLimit(0) === 1 &&
    retryBatchLimit(-5) === 1 &&
    retryBatchLimit(MAX_RETRY_BATCH + 50) === MAX_RETRY_BATCH,
  JSON.stringify([
    retryBatchLimit(undefined),
    retryBatchLimit(Number.NaN),
    retryBatchLimit(0),
    retryBatchLimit(2.9),
    retryBatchLimit(MAX_RETRY_BATCH + 50),
  ]),
);
check(
  "retryStopReason berhenti untuk endpoint mati/dihapus dan lanjut untuk yang aktif",
  retryStopReason({ active: true }) === null &&
    typeof retryStopReason({ active: false }) === "string" &&
    retryStopReason({ active: false }).includes("dinonaktifkan") &&
    typeof retryStopReason(null) === "string" &&
    retryStopReason(null).includes("dihapus"),
  String(retryStopReason({ active: false }) ?? retryStopReason(null)),
);
{
  const secret = "rahasia-bersama-32-karakter";
  const timestamp = 1_791_746_927_000;
  const body = sampleDeliveryPayload("sale.completed", timestamp);
  const headers = webhookDeliveryHeaders({
    secret,
    timestamp,
    event: "sale.completed",
    attempt: 3,
    body,
  });
  check(
    "header kiriman menandatangani badan dengan skema yang sama",
    headers["x-mesinpos-signature"] === signWebhookPayload(secret, timestamp, body) &&
      verifyWebhookSignature({
        secret,
        timestamp,
        body,
        signature: headers["x-mesinpos-signature"],
        now: timestamp,
      }),
    JSON.stringify(headers),
  );
  check(
    "header kiriman menyebut event & percobaan ke berapa",
    headers["x-mesinpos-event"] === "sale.completed" &&
      headers["x-mesinpos-attempt"] === "3" &&
      headers["x-mesinpos-timestamp"] === String(timestamp) &&
      headers["content-type"] === "application/json",
    JSON.stringify(headers),
  );
  check(
    "percobaan ulang bertanda tangan baru karena cap waktunya berubah",
    (() => {
      const later = timestamp + 60_000;
      const retry = webhookDeliveryHeaders({
        secret,
        timestamp: later,
        event: "sale.completed",
        attempt: 2,
        body,
      });
      return (
        retry["x-mesinpos-signature"] !== headers["x-mesinpos-signature"] &&
        verifyWebhookSignature({
          secret,
          timestamp: later,
          body,
          signature: retry["x-mesinpos-signature"],
          now: later,
        })
      );
    })(),
    "tanda tangan percobaan ulang tidak bisa diverifikasi penerima",
  );
}

/* --------------------------------------- pesan penerima & rahasia bersama */

check(
  "balasan gagal JSON menyebut pesan penerimanya",
  describeReceiverFailure(
    401,
    '{"error":"Tanda tangan tidak cocok — pastikan rahasianya sama."}',
  ) ===
    "Penerima menjawab 401. Pesan penerima: Tanda tangan tidak cocok — pastikan rahasianya sama.",
  describeReceiverFailure(401, '{"error":"x"}'),
);
check(
  "balasan gagal tanpa badan tetap jujur menyebut status",
  describeReceiverFailure(503, "   ") === "Penerima menjawab 503.",
  describeReceiverFailure(503, "   "),
);
check(
  "balasan gagal bukan JSON dipakai apa adanya",
  describeReceiverFailure(500, "  Internal   Server Error ") ===
    "Penerima menjawab 500. Pesan penerima: Internal Server Error",
  describeReceiverFailure(500, "  Internal   Server Error "),
);
check(
  "pesan penerima yang panjang dipotong, bukan disimpan mentah",
  describeReceiverFailure(400, '{"message":"' + "a".repeat(500) + '"}').length < 300,
  String(describeReceiverFailure(400, "x".repeat(50))),
);

{
  const ok = validateWebhookSecret("RahasiaBersamaDariPenerima123");
  check(
    "rahasia dari penerima diterima apa adanya (tanpa spasi di ujung)",
    ok.ok && ok.value === "RahasiaBersamaDariPenerima123",
    JSON.stringify(ok),
  );
  check(
    "rahasia terlalu pendek ditolak dengan alasannya",
    validateWebhookSecret("pendek").ok === false &&
      validateWebhookSecret("pendek").reason.includes(String(WEBHOOK_SECRET_MIN)),
    JSON.stringify(validateWebhookSecret("pendek")),
  );
  check(
    "rahasia terlalu panjang ditolak",
    validateWebhookSecret("a".repeat(WEBHOOK_SECRET_MAX + 1)).ok === false,
  );
  check(
    "spasi di tengah rahasia ditolak (tidak selamat lewat header)",
    validateWebhookSecret("rahasia dengan spasi di tengah").ok === false,
  );
  check(
    "tanda hubung tipografi hasil salin-tempel ditolak",
    validateWebhookSecret("rahasia–bersama–panjang").ok === false,
  );
  check(
    "rahasia kosong ditolak",
    validateWebhookSecret("   ").ok === false &&
      validateWebhookSecret("   ").reason.includes("wajib diisi"),
    JSON.stringify(validateWebhookSecret("   ")),
  );
}

// ------------------------------------------------ pemicu event saat kejadian
// Webhook hanya berguna kalau peristiwanya benar-benar mengisi antrean. Isi
// kiriman tiap event murni di `lib/webhookEvents.ts`; sambungan ke jalur
// transaksi diperiksa di bagian “sambungan” di bawah.
check(
  "stockCrossedLow hanya benar saat stok menembus ambang ke bawah",
  stockCrossedLow(7, 5) &&
    stockCrossedLow(6, 4, 5) &&
    stockCrossedLow(10, 0) &&
    !stockCrossedLow(5, 4) &&
    !stockCrossedLow(3, 2) &&
    !stockCrossedLow(7, 6) &&
    !stockCrossedLow(5, 5),
  JSON.stringify([
    stockCrossedLow(7, 5),
    stockCrossedLow(5, 4),
    stockCrossedLow(3, 2),
    stockCrossedLow(7, 6),
  ]),
);
check(
  "ambang stok kritis bawaan 5 dan stok tepat di ambang itu sudah menipis",
  DEFAULT_LOW_STOCK_THRESHOLD === 5 &&
    stockCrossedLow(DEFAULT_LOW_STOCK_THRESHOLD + 1, DEFAULT_LOW_STOCK_THRESHOLD) &&
    !stockCrossedLow(DEFAULT_LOW_STOCK_THRESHOLD + 1, DEFAULT_LOW_STOCK_THRESHOLD + 1),
  String(DEFAULT_LOW_STOCK_THRESHOLD),
);
{
  const completed = saleCompletedEventData({
    number: "A-00007",
    total: 66_600,
    tax: 6_600,
    discount: 5_000,
    creditAmount: 16_600,
    itemCount: 2,
    method: "qris",
  });
  check(
    "isi sale.completed memisahkan yang dibayar dari yang menjadi piutang",
    completed.number === "A-00007" &&
      completed.total === 66_600 &&
      completed.paid === 50_000 &&
      completed.creditAmount === 16_600 &&
      completed.method === "qris" &&
      completed.itemCount === 2,
    JSON.stringify(completed),
  );
  check(
    "isi sale.voided menyebut apakah stoknya dikembalikan & penjelasannya",
    (() => {
      const voided = saleVoidedEventData({ number: "A-00007", total: 66_600, restocked: true });
      return voided.number === "A-00007" && voided.restocked === true && voided.reason === null;
    })(),
    JSON.stringify(saleVoidedEventData({ number: "A-00007", total: 66_600, restocked: true })),
  );
  const low = stockLowEventData({ sku: "KOPI-SUSU", name: "Kopi Susu", remaining: 5 });
  check(
    "isi stock.low memakai ambang yang sama dengan daftar stok kritis halaman Produk",
    low.sku === "KOPI-SUSU" &&
      low.remaining === 5 &&
      low.threshold === DEFAULT_LOW_STOCK_THRESHOLD,
    JSON.stringify(low),
  );
  const opname = opnamePostedEventData({
    number: "OPN-00003",
    location: "GD-A · Gudang Utama",
    counted: 2,
    uncounted: 5,
    netUnits: -3,
    movements: 2,
  });
  check(
    "isi opname.posted membawa selisih bersih & jumlah barisnya",
    opname.netUnits === -3 && opname.movements === 2 && String(opname.location).includes("Gudang"),
    JSON.stringify(opname),
  );
  const produkBaru = productCreatedEventData({
    sku: "PBB-SEM-000009",
    name: "Semen Portland 40 kg",
    price: 68_000,
    unit: "SAK",
    active: true,
    category: "Semen & Mortar",
    subcategory: "Semen Portland",
    createdAt: 1_791_746_927_000,
  });
  check(
    "isi product.created menyebut produk barunya tanpa daftar perubahan",
    produkBaru.sku === "PBB-SEM-000009" &&
      produkBaru.price === 68_000 &&
      produkBaru.unit === "SAK" &&
      produkBaru.category === "Semen & Mortar" &&
      produkBaru.createdAt === 1_791_746_927_000 &&
      !("changed" in produkBaru),
    JSON.stringify(produkBaru),
  );
}
{
  // `id` kiriman dipakai penerima untuk mengenali kiriman yang sama; dua
  // kejadian berbeda pada milidetik yang sama tidak boleh berbagi id. Nilai
  // yang sama tetap harus menghasilkan id yang sama (kiriman uji ulang).
  const at = 1_791_746_927_000;
  const idOf = (subject) =>
    JSON.parse(webhookPayload({ event: "sale.completed", data: { number: subject }, at, subject })).id;
  check(
    "id kiriman membedakan dua kejadian pada milidetik yang sama",
    idOf("A-00001") !== idOf("A-00002") && idOf("A-00001") === idOf("A-00001"),
    JSON.stringify([idOf("A-00001"), idOf("A-00002")]),
  );
  check(
    "penanda id dibersihkan & dipotong supaya aman disisipkan ke JSON",
    sanitizeEventSubject('A-00001"}') === "A-00001" &&
      sanitizeEventSubject("  a b  ") === "a-b" &&
      sanitizeEventSubject("###") === "" &&
      sanitizeEventSubject(undefined) === "" &&
      sanitizeEventSubject("x".repeat(60)).length === 40,
    JSON.stringify([
      sanitizeEventSubject('A-00001"}'),
      sanitizeEventSubject("###"),
      sanitizeEventSubject("x".repeat(60)).length,
    ]),
  );
  check(
    "kiriman tanpa penanda tetap memakai id bentuk lama",
    JSON.parse(sampleDeliveryPayload("stock.low", at)).id === `evt_${at}_stock.low`,
    JSON.parse(sampleDeliveryPayload("stock.low", at)).id,
  );
}

// ------------------------------------------------- pesanan masuk dari luar
{
  const find = (body) => parseExternalOrder(body);
  const valid = {
    idempotencyKey: "web-order-0001",
    lines: [{ sku: "kopi-susu", quantity: 2 }, { sku: "teh-manis", quantity: 1, unitCode: "dus" }],
    payment: { method: "qris" },
    discount: 0,
    customerCode: "b2b-0001",
  };
  const parsed = find(valid);
  check("pesanan sistem luar yang benar diterima", parsed.ok, parsed.ok ? "" : parsed.reason);
  check(
    "SKU & kode dinormalkan ke huruf besar, jumlah bayar boleh dihilangkan",
    parsed.ok &&
      parsed.value.lines[0].sku === "KOPI-SUSU" &&
      parsed.value.lines[1].unitCode === "DUS" &&
      parsed.value.customerCode === "B2B-0001" &&
      !hasExplicitPaymentAmount(parsed.value) &&
      parsed.value.payment.method === "qris",
    JSON.stringify(parsed.ok ? parsed.value : parsed.reason),
  );
  check(
    "normalizeOrderCode merapikan spasi & huruf kecil",
    normalizeOrderCode("  kopi susu ") === "KOPI SUSU" &&
      normalizeOrderCode("Dus") === "DUS",
    normalizeOrderCode("  kopi susu "),
  );
  check(
    "jumlah bayar eksplisit dikenali (bukan dianggap tepat total)",
    (() => {
      const withAmount = find({ ...valid, payment: { method: "cash", amount: 50_000 } });
      return (
        withAmount.ok &&
        hasExplicitPaymentAmount(withAmount.value) &&
        withAmount.value.payment.amount === 50_000
      );
    })(),
    "payment.amount tidak terbaca",
  );
  check(
    "field yang tidak dikenal ditolak, bukan diabaikan",
    !find({ ...valid, total: 99_000 }).ok &&
      !find({ ...valid, lines: [{ sku: "KOPI-SUSU", quantity: 1, price: 1 }] }).ok,
    "field asing lolos tanpa keluhan",
  );
  check(
    "nama produk boleh ikut sebagai cadangan SKU (dipangkas & dibatasi)",
    (() => {
      const withName = find({
        ...valid,
        lines: [{ sku: "KOPI-SUSU", name: "  Kopi Susu Gula Aren  ", quantity: 1 }],
      });
      return (
        withName.ok &&
        withName.value.lines[0].name === "Kopi Susu Gula Aren" &&
        find({
          ...valid,
          lines: [{ sku: "KOPI-SUSU", name: "   ", quantity: 1 }],
        }).ok === false &&
        find({
          ...valid,
          lines: [
            { sku: "KOPI-SUSU", name: "x".repeat(ORDER_NAME_MAX + 1), quantity: 1 },
          ],
        }).ok === false
      );
    })(),
    "name tidak diperiksa bentuknya",
  );
  check(
    "idempotencyKey wajib dan bentuknya dibatasi",
    !find({ ...valid, idempotencyKey: undefined }).ok &&
      !find({ ...valid, idempotencyKey: "pendek" }).ok &&
      !find({ ...valid, idempotencyKey: "x".repeat(ORDER_IDEMPOTENCY_MAX + 1) }).ok &&
      !find({ ...valid, idempotencyKey: "ada spasi disini" }).ok &&
      find({ ...valid, idempotencyKey: "a".repeat(ORDER_IDEMPOTENCY_MIN) }).ok,
    `panjang ${ORDER_IDEMPOTENCY_MIN}–${ORDER_IDEMPOTENCY_MAX} tidak ditegakkan`,
  );
  check(
    "pesanan tanpa baris atau terlalu banyak baris ditolak",
    !find({ ...valid, lines: [] }).ok &&
      !find({
        ...valid,
        lines: Array.from({ length: ORDER_LINES_MAX + 1 }, (_, index) => ({
          sku: `SKU-${index}`,
          quantity: 1,
        })),
      }).ok,
    "batas baris tidak ditegakkan",
  );
  check(
    "SKU & jumlah divalidasi per baris dengan nomor barisnya",
    (() => {
      const badSku = find({ ...valid, lines: [{ sku: "", quantity: 1 }] });
      const badQty = find({
        ...valid,
        lines: [{ sku: "KOPI-SUSU", quantity: 1 }, { sku: "TEH-MANIS", quantity: 0 }],
      });
      const tooMany = find({
        ...valid,
        lines: [{ sku: "KOPI-SUSU", quantity: ORDER_QUANTITY_MAX + 1 }],
      });
      return (
        !badSku.ok && /Baris ke-1/.test(badSku.reason) &&
        !badQty.ok && /Baris ke-2/.test(badQty.reason) &&
        !tooMany.ok && /Baris ke-1/.test(tooMany.reason)
      );
    })(),
    "galat baris tidak menyebut nomor barisnya",
  );
  check(
    "baris ganda untuk SKU & satuan yang sama ditolak",
    !find({
      ...valid,
      lines: [
        { sku: "KOPI-SUSU", quantity: 1 },
        { sku: "kopi-susu", quantity: 2 },
      ],
    }).ok &&
      // Satuan berbeda tetap boleh: 1 DUS dan 2 PCS bukan baris yang sama.
      find({
        ...valid,
        lines: [
          { sku: "KOPI-SUSU", quantity: 1 },
          { sku: "KOPI-SUSU", quantity: 2, unitCode: "DUS" },
        ],
      }).ok,
    "baris kembar (atau satuan berbeda) diperlakukan salah",
  );
  check(
    "modifier lewat API diterima dalam bentuk kode grup & opsi",
    (() => {
      const withModifier = find({
        ...valid,
        lines: [
          {
            sku: "KOPI-SUSU",
            quantity: 1,
            modifiers: [
              { groupCode: "level", optionCodes: ["3"] },
              { groupCode: "TOPPING", optionCodes: ["telur", "TELUR"] },
            ],
          },
        ],
      });
      return (
        withModifier.ok &&
        withModifier.value.lines[0].modifiers[0].groupCode === "LEVEL" &&
        JSON.stringify(withModifier.value.lines[0].modifiers[1].optionCodes) ===
          JSON.stringify(["TELUR"])
      );
    })(),
    "modifier sah ditolak atau tidak dinormalkan",
  );
  check(
    "modifier cacat ditolak dengan alasan yang menyebut grupnya",
    (() => {
      const empty = find({
        ...valid,
        lines: [{ sku: "KOPI-SUSU", quantity: 1, modifiers: [{ groupCode: "LEVEL", optionCodes: [] }] }],
      });
      const duplicate = find({
        ...valid,
        lines: [
          {
            sku: "KOPI-SUSU",
            quantity: 1,
            modifiers: [
              { groupCode: "LEVEL", optionCodes: ["1"] },
              { groupCode: "LEVEL", optionCodes: ["2"] },
            ],
          },
        ],
      });
      const stray = find({
        ...valid,
        lines: [
          {
            sku: "KOPI-SUSU",
            quantity: 1,
            modifiers: [{ groupCode: "LEVEL", optionCodes: ["1"], extra: true }],
          },
        ],
      });
      return (
        !empty.ok && /LEVEL/.test(empty.reason) &&
        !duplicate.ok && /dua kali/.test(duplicate.reason) &&
        !stray.ok && /extra/.test(stray.reason)
      );
    })(),
    "modifier cacat lolos",
  );
  check(
    "baris sama dengan modifier berbeda adalah dua baris yang sah",
    find({
      ...valid,
      lines: [
        { sku: "KOPI-SUSU", quantity: 1, modifiers: [{ groupCode: "LEVEL", optionCodes: ["1"] }] },
        { sku: "KOPI-SUSU", quantity: 1, modifiers: [{ groupCode: "LEVEL", optionCodes: ["2"] }] },
      ],
    }).ok &&
      !find({
        ...valid,
        lines: [
          { sku: "KOPI-SUSU", quantity: 1, modifiers: [{ groupCode: "LEVEL", optionCodes: ["1"] }] },
          { sku: "KOPI-SUSU", quantity: 2, modifiers: [{ groupCode: "LEVEL", optionCodes: ["1"] }] },
        ],
      }).ok,
    "tanda tangan baris mengabaikan modifier",
  );
  check(
    "metode pembayaran terbatas pada yang dikenal kasir",
    PAYMENT_METHODS.every((method) => find({ ...valid, payment: { method } }).ok) &&
      !find({ ...valid, payment: { method: "gopay" } }).ok &&
      !find({ ...valid, payment: {} }).ok &&
      !find({ ...valid, payment: "qris" }).ok,
    JSON.stringify(PAYMENT_METHODS),
  );
  check(
    "jumlah bayar negatif/bukan angka ditolak, nol diterima",
    !find({ ...valid, payment: { method: "cash", amount: -1 } }).ok &&
      !find({ ...valid, payment: { method: "cash", amount: "5" } }).ok &&
      find({ ...valid, payment: { method: "cash", amount: 0 } }).ok,
    "payment.amount tidak divalidasi",
  );
  check(
    "provider & providerRef boleh diisi, tapi tidak boleh kosong",
    find({
      ...valid,
      payment: { method: "qris", provider: "xendit", providerRef: "QR-1" },
    }).ok &&
      !find({ ...valid, payment: { method: "qris", provider: "  " } }).ok,
    "payment.provider tidak divalidasi",
  );
  check(
    "diskon manual divalidasi sebagai rupiah",
    find({ ...valid, discount: 5_000 }).ok &&
      !find({ ...valid, discount: -1 }).ok &&
      !find({ ...valid, discount: "1000" }).ok,
    "discount tidak divalidasi",
  );
  check(
    "kode pelanggan/member harus kode yang sah, bukan nama",
    find({ ...valid, memberCode: "mbr-0001" }).ok &&
      !find({ ...valid, customerCode: "Toko Budi" }).ok &&
      !find({ ...valid, memberCode: "x".repeat(ORDER_CODE_MAX + 1) }).ok &&
      !find({ ...valid, customerCode: 12 }).ok,
    "kode pelanggan/member tidak divalidasi",
  );
  check(
    "body yang bukan objek JSON ditolak",
    !find(null).ok && !find("qris").ok && !find([]).ok && !find(undefined).ok,
    "body asing lolos",
  );
  check(
    "setiap alasan galat bisa dibaca operator (bukan kode angka)",
    [
      find(null),
      find({ ...valid, idempotencyKey: "x" }),
      find({ ...valid, lines: [] }),
      find({ ...valid, payment: { method: "gopay" } }),
    ].every((result) => !result.ok && result.reason.length >= 15 && /[a-z]/.test(result.reason)),
    "alasan galat terlalu pendek untuk dibaca",
  );
  check(
    "contoh body halaman lolos parser-nya sendiri",
    (() => {
      const sample = find(sampleExternalOrderBody());
      return sample.ok;
    })(),
    "contoh body di halaman tidak sah",
  );
  check(
    "contoh body tidak menyalin harga dari sistem luar",
    (() => {
      const sample = find(sampleExternalOrderBody());
      return sample.ok && !hasExplicitPaymentAmount(sample.value);
    })(),
    "contoh body mengirim jumlah bayar sendiri",
  );
  check(
    "ringkasan pesanan menyebut baris, metode, dan cara bayarnya",
    (() => {
      const order = find(valid);
      if (!order.ok) return false;
      const text = describeExternalOrder(order.value);
      return /2 baris/.test(text) && /qris/.test(text) && /tepat total/.test(text) && /B2B-0001/.test(text);
    })(),
    (() => {
      const order = find(valid);
      return order.ok ? describeExternalOrder(order.value) : order.reason;
    })(),
  );
}

// ----------------------------------- parameter baca: tanggal, kursor, toko
{
  check(
    "from/to menerima epoch maupun ISO, dan menolak nilai tak terbaca",
    (() => {
      const iso = parseDateRange("2026-10-01T00:00:00Z", "2026-10-20T00:00:00Z");
      const epoch = parseDateRange("1790812800000", null);
      const invalid = parseDateRange("kemarin", null);
      return (
        iso.ok && iso.from === Date.parse("2026-10-01T00:00:00Z") && iso.to === Date.parse("2026-10-20T00:00:00Z") &&
        epoch.ok && epoch.from === 1790812800000 && epoch.to === null &&
        !invalid.ok && /from/.test(invalid.reason)
      );
    })(),
    JSON.stringify(parseDateRange("kemarin", null)),
  );
  check(
    "from yang tidak lebih awal dari to ditolak, bukan diam-diam ditukar",
    !parseDateRange("2026-10-20", "2026-10-01").ok && !parseDateRange("100", "100").ok,
    "rentang terbalik lolos",
  );
  check(
    "kursor bolak-balik utuh dan kursor asing ditolak",
    (() => {
      const cursor = encodeCursor(1770000000000, "A-00042");
      const decoded = decodeCursor(cursor);
      return (
        decoded.ok && decoded.value.at === 1770000000000 && decoded.value.key === "A-00042" &&
        decodeCursor(null).ok && decodeCursor("").ok &&
        !decodeCursor("bukan-kursor").ok && !decodeCursor("12|").ok
      );
    })(),
    JSON.stringify(decodeCursor("bukan-kursor")),
  );
  check(
    "saringan status penjualan hanya menerima nilai yang dikenal",
    parseSaleStatus(null).value === "completed" &&
      parseSaleStatus("void").value === "void" &&
      parseSaleStatus("ALL").value === "all" &&
      !parseSaleStatus("dibatalkan").ok,
    JSON.stringify(parseSaleStatus("dibatalkan")),
  );
  check(
    "kode toko dinormalkan, kosong berarti toko pertama",
    normalizeStoreCodeParam("  pusat ") === "PUSAT" &&
      normalizeStoreCodeParam(null) === null &&
      normalizeStoreCodeParam("   ") === null,
    String(normalizeStoreCodeParam("  pusat ")),
  );
}

// --------------------------------------- badan endpoint tulis non-penjualan
{
  check(
    "PATCH produk menerima harga bulat & menolak harga pecahan/field asing",
    parseProductPatch({ sku: "pbb-sem-1", price: 69000 }).ok &&
      !parseProductPatch({ sku: "PBB-SEM-1", price: 69000.5 }).ok &&
      !parseProductPatch({ sku: "PBB-SEM-1", Price: 1000 }).ok &&
      !parseProductPatch({ sku: "PBB-SEM-1" }).ok &&
      parseProductPatch({ sku: "PBB-SEM-1", unit: "sak", active: false }).ok,
    JSON.stringify(parseProductPatch({ sku: "PBB-SEM-1" })),
  );
  check(
    "DELETE produk hanya menerima SKU",
    parseProductDelete({ sku: "kopi-susu" }).value.sku === "KOPI-SUSU" &&
      !parseProductDelete({ sku: "KOPI-SUSU", hapus: true }).ok,
    JSON.stringify(parseProductDelete({ sku: "KOPI-SUSU", hapus: true })),
  );
  check(
    "penyesuaian stok: delta atau quantity, tidak dua-duanya",
    parseStockAdjust({ sku: "A", delta: -3 }).value.delta === -3 &&
      parseStockAdjust({ sku: "A", quantity: 12 }).value.quantity === 12 &&
      !parseStockAdjust({ sku: "A", delta: 1, quantity: 2 }).ok &&
      !parseStockAdjust({ sku: "A", delta: 0 }).ok &&
      !parseStockAdjust({ sku: "A", quantity: -1 }).ok &&
      !parseStockAdjust({ sku: "A" }).ok,
    JSON.stringify(parseStockAdjust({ sku: "A" })),
  );
  check(
    "pelanggan baru: nama wajib, kode boleh kosong, limit & tempo divalidasi",
    parseCustomerCreate({ name: "CV Bangun Jaya" }).ok &&
      parseCustomerCreate({ name: "CV Bangun Jaya", code: "B2B-0009", creditLimit: 5000000, paymentTermDays: 14 }).ok &&
      !parseCustomerCreate({ name: "" }).ok &&
      !parseCustomerCreate({ name: "Toko", creditLimit: -1 }).ok &&
      !parseCustomerCreate({ name: "Toko", paymentTermDays: "14" }).ok &&
      !parseCustomerCreate({ name: "Toko", limit: 1 }).ok,
    JSON.stringify(parseCustomerCreate({ name: "Toko", limit: 1 })),
  );
  check(
    "member baru: nama wajib, kode maksimal 10, diskon angka",
    parseMemberCreate({ name: "Siti" }).ok &&
      parseMemberCreate({ name: "Siti", code: "MBR-9", discountPct: 5 }).ok &&
      !parseMemberCreate({ name: "Siti", code: "KODE-YANG-SANGAT-PANJANG" }).ok &&
      !parseMemberCreate({ name: "Siti", discountPct: "5" }).ok,
    JSON.stringify(parseMemberCreate({ name: "Siti", discountPct: "5" })),
  );
  check(
    "pembatalan memakai nomor struk yang dinormalkan + alasan opsional",
    parseVoidSale({ number: "a-00043" }).value.number === "A-00043" &&
      parseVoidSale({ number: "A-00043", reason: "Salah input" }).value.reason === "Salah input" &&
      !parseVoidSale({ number: "" }).ok &&
      !parseVoidSale({ number: "A-00043", jumlah: 1 }).ok,
    JSON.stringify(parseVoidSale({ number: "" })),
  );
}

// ------------------------------------------------------------- webhook masuk
{
  check(
    "katalog event masuk sama dengan yang dijalankan penerima",
    INBOUND_EVENT_KEYS.length === 4 &&
      ["order.created", "stock.adjusted", "product.updated", "sale.voided"].every((key) =>
        INBOUND_EVENT_KEYS.includes(key),
      ) &&
      INBOUND_WEBHOOK_EVENTS.every((event) => event.label.length > 0 && event.dataShape.length > 0),
    JSON.stringify(INBOUND_EVENT_KEYS),
  );
  check(
    "konfigurasi endpoint masuk menolak event asing & nama kembar",
    (() => {
      const ok = validateInboundEndpointInput({ name: "Marketplace", events: ["order.created", "dikenal"] });
      const dup = validateInboundEndpointInput(
        { name: "Marketplace", events: ["order.created"] },
        { existingNames: ["marketplace"] },
      );
      const none = validateInboundEndpointInput({ name: "Marketplace", events: [] });
      return (
        ok.ok && JSON.stringify(ok.value.events) === JSON.stringify(["order.created"]) &&
        !dup.ok && !none.ok
      );
    })(),
    JSON.stringify(validateInboundEndpointInput({ name: "X", events: [] })),
  );
  check(
    "token endpoint berbentuk tetap & bukan rahasia",
    isInboundToken("whi_23456789abcdefghjkmn") &&
      !isInboundToken("whi_03456789abcdefghjkmn") &&
      !isInboundToken("mp_23456789abcdefghjkmn"),
    "token webhook masuk tidak diperiksa bentuknya",
  );
  check(
    "tanda tangan webhook masuk diverifikasi dengan skema yang sama",
    (() => {
      const secret = "rahasia-bersama-panjang-1234";
      const now = 1770000000000;
      const body = "{\"id\":\"x\",\"event\":\"order.created\",\"data\":{}}";
      const headers = {
        timestamp: String(now),
        signature: signWebhookPayload(secret, now, body),
        event: "order.created",
        eventId: null,
      };
      const valid = inboundSignatureProblem({ secret, body, headers, now });
      const wrong = inboundSignatureProblem({
        secret,
        body,
        headers: { ...headers, signature: "sha256=" + "0".repeat(64) },
        now,
      });
      const stale = inboundSignatureProblem({ secret, body, headers, now: now + 6 * 60 * 1000 });
      return valid === null && wrong !== null && stale !== null;
    })(),
    "tanda tangan webhook masuk tidak diperiksa",
  );
  check(
    "envelope peristiwa: id wajib, event dikenal, badan & header harus sepakat",
    (() => {
      const headers = { timestamp: "1", signature: "x", event: "order.created", eventId: null };
      const ok = parseInboundEnvelope(
        JSON.stringify({ id: "ord-1", event: "order.created", data: { ok: true } }),
        headers,
      );
      const missingId = parseInboundEnvelope(JSON.stringify({ event: "order.created", data: {} }), headers);
      const unknown = parseInboundEnvelope(
        JSON.stringify({ id: "x", event: "refund.created", data: {} }),
        headers,
      );
      const mismatch = parseInboundEnvelope(
        JSON.stringify({ id: "x", event: "sale.voided", data: {} }),
        headers,
      );
      const notObject = parseInboundEnvelope("[]", headers);
      return ok.ok && !missingId.ok && !unknown.ok && !mismatch.ok && !notObject.ok;
    })(),
    JSON.stringify(parseInboundEnvelope("{}", { timestamp: null, signature: null, event: null, eventId: null })),
  );
  check(
    "penyaringan event masuk membuang yang tak dikenal",
    JSON.stringify(sanitizeInboundEvents(["order.created", "refund.created", "order.created"])) ===
      JSON.stringify(["order.created"]),
    JSON.stringify(sanitizeInboundEvents(["order.created", "refund.created"])),
  );
  check(
    "catatan webhook masuk menyebut tanda tangan & idempotensi",
    INBOUND_WEBHOOK_NOTES.join(" ").includes("tanda tangan") &&
      INBOUND_WEBHOOK_NOTES.join(" ").includes("idempotensi"),
    INBOUND_WEBHOOK_NOTES.join(" | "),
  );
}

// ------------------------------------------- sambungan ke endpoint & schema
{
  const apiAccess = read("src/convex/apiAccess.ts");
  const httpSource = read("src/convex/http.ts");
  /** Handler yang harus ada untuk tiap endpoint tulis (`export const …`). */
  const WRITE_HANDLERS = {
    "sales.create": ["recordOrder", "applyExternalOrder"],
    "sales.void": ["voidSale", "applyVoidSale"],
    "products.update": ["updateProduct", "applyProductPatch"],
    "products.delete": ["deleteProduct", "applyProductDelete"],
    "stock.adjust": ["adjustStock", "applyStockAdjust"],
    "customers.create": ["createCustomer", "applyCustomerCreate"],
    "members.create": ["createMember", "applyMemberCreate"],
    "inboundWebhooks.create": ["createInboundWebhook"],
    "inboundWebhooks.delete": ["deleteInboundWebhook"],
    "inboundWebhooks.receive": ["receiveInboundEvent", "inboundEndpointByToken"],
  };
  for (const resource of API_RESOURCES) {
    if (resource.write) {
      const handlers = WRITE_HANDLERS[resource.resource] ?? [];
      check(
        `handler tulis tersedia untuk "${resource.resource}"`,
        handlers.length > 0 &&
          handlers.every(
            (name) =>
              apiAccess.includes(`export const ${name} = internal`) ||
              apiAccess.includes(`async function ${name}(`),
          ),
        JSON.stringify(handlers),
      );
      if (resource.auth === "signature") {
        check(
          `endpoint bersignature "${resource.resource}" tidak memakai jalur kunci`,
          httpSource.includes("pathPrefix: `${INBOUND_WEBHOOK_PATH}/`") &&
            httpSource.includes("inboundEndpointByToken") &&
            httpSource.includes("inboundSignatureProblem("),
          "webhook masuk diperlakukan seperti endpoint berkunci",
        );
      } else {
        check(
          `http.ts mengarahkan "${resource.resource}" ke jalurnya`,
          httpSource.includes(`case "${resource.resource}":`),
          "endpoint tulis tidak punya cabang dispatch",
        );
        check(
          `resource tulis "${resource.resource}" memeriksa scope di dalam transaksi`,
          apiAccess.includes(`activeWriteKey(ctx, args.tenantId, args.keyId, "${resource.scope}")`),
          "scope kunci tidak diperiksa ulang sebelum menulis",
        );
      }
      continue;
    }
    check(
      `readResource menangani resource "${resource.resource}"`,
      apiAccess.includes(`args.resource === "${resource.resource}"`),
      "DITAWARKAN di halaman tapi tidak dibaca endpoint",
    );
  }
  check(
    "http.ts melewati endpoint bersignature di loop berkunci",
    httpSource.includes('if (resource.auth === "signature") continue;'),
    "webhook masuk ikut didaftarkan sebagai endpoint berkunci",
  );
  check(
    "pemilihan toko memakai kode toko, bukan id internal",
    apiAccess.includes("stores.find((row) => row.code.trim().toUpperCase() === wanted)") &&
      httpSource.includes('url.searchParams.get("storeCode")') &&
      !httpSource.includes("storeId="),
    "toko dipilih dari id internal atau tidak bisa dipilih sama sekali",
  );
  check(
    "kode toko yang tidak dikenal dijawab 404 dengan daftar kode",
    /Toko dengan kode \$\{wanted\} tidak ada di workspace ini/.test(apiAccess),
    "kode toko asing diam-diam memakai toko pertama",
  );
  check(
    "pembacaan penjualan & pembelian memakai from/to dan kursor",
    apiAccess.includes('const from = args.from ?? since ?? Date.now()') &&
      apiAccess.includes("encodeCursor(last.createdAt, last.number)") &&
      apiAccess.includes('withIndex("by_tenant_store_created"') &&
      apiAccess.includes('resource === "customers"') &&
      apiAccess.includes('resource === "members"'),
    "rentang tanggal/kursor tidak dipakai di readResource",
  );
  check(
    "http.ts memeriksa from/to sebelum membaca data",
    /parseDateRange\(url\.searchParams\.get\("from"\), url\.searchParams\.get\("to"\)\)/.test(httpSource) &&
      /if \(!range\.ok\) return json/.test(httpSource) &&
      httpSource.includes("decodeCursor(rawCursor)"),
    "parameter tanggal/kursor tidak divalidasi di jalur HTTP",
  );
  check(
    "modifier pesanan diteruskan ke jalur penjualan kasir",
    apiAccess.includes("if (line.modifiers && line.modifiers.length > 0) item.modifiers = line.modifiers;") &&
      apiAccess.includes("api.pos.createSale"),
    "modifier hilang antara API dan pos.createSale",
  );
  check(
    "pembatalan & perubahan produk memakai jalur aplikasi yang sama",
    apiAccess.includes("api.pos.voidSale") &&
      apiAccess.includes("api.products.update") &&
      apiAccess.includes("api.products.setPricing") &&
      apiAccess.includes("api.products.adjustStock") &&
      apiAccess.includes("api.products.remove"),
    "endpoint tulis punya jalur sendiri di luar aplikasi",
  );
  check(
    "peristiwa webhook masuk dicatat untuk idempotensi",
    apiAccess.includes('insert("inboundWebhookEvents"') &&
      apiAccess.includes('.eq("endpointId", endpoint._id).eq("eventId", args.eventId)'),
    "peristiwa masuk tidak punya jejak idempotensi",
  );
  const http = read("src/convex/http.ts");
  check(
    "http.ts mendaftarkan setiap resource dari API_RESOURCES",
    http.includes("for (const resource of API_RESOURCES)") && http.includes("resource.path"),
    "endpoint /api/v1 tidak lagi mengikuti tabel API_RESOURCES",
  );
  check(
    "http.ts memisahkan jalur baca & tulis dari tabel yang sama",
    /resource\.write\s*\?[\s\S]{0,120}handleApiWrite/.test(http) &&
      http.includes("async function handleApiWrite"),
    "endpoint tulis tidak dipisahkan dari jalur baca",
  );
  check(
    "jalur tulis memeriksa kunci dulu, badan pesan kemudian",
    (() => {
      const handler = http.indexOf("async function handleApiWrite");
      const body = http.indexOf("await req.text()", handler);
      const auth = http.indexOf("internal.apiAccess.authenticate", handler);
      return handler > 0 && auth > handler && body > auth;
    })(),
    "badan pesan dibaca sebelum kunci diperiksa",
  );
  check(
    "bentuk badan pesan diperiksa aturan murni apiOrders",
    http.includes('from "./lib/apiOrders"') && /parseExternalOrder\(/.test(http),
    "http.ts mengurai badan pesan dengan aturannya sendiri",
  );
  check(
    "pesanan marketplace disiapkan aturan murni sebelum diperiksa",
    http.includes("prepareMarketplaceOrderBody") &&
      http.includes("parseExternalOrder(prepareMarketplaceOrderBody(parsed))"),
    "field tambahan marketplace diurai langsung di http.ts",
  );
  check(
    "penulisan API masuk lewat jalur penjualan yang sama dengan kasir",
    apiAccess.includes("api.pos.createSale"),
    "API punya jalur penjualan sendiri",
  );
  check(
    "kunci tidak bisa menulis kalau pembuatnya kehilangan izin domain itu",
    apiAccess.includes("async function activeWriteKey(") &&
      apiAccess.includes("`Kunci ini tidak punya scope ${scope}.`") &&
      /creatorPermissions[\s\S]{0,200}includes\(scope\)/.test(apiAccess),
    "izin pembuat kunci tidak diperiksa ulang di jalur tulis",
  );
  check(
    "kunci dibaca dari header Authorization: Bearer",
    http.includes('req.headers.get("authorization")') && /Bearer/.test(http),
    "header Authorization tidak dibaca",
  );

  const schema = read("src/convex/schema.ts");
  for (const table of [
    "apiKeys",
    "webhookEndpoints",
    "webhookDeliveries",
    "inboundWebhookEndpoints",
    "inboundWebhookEvents",
  ]) {
    check(`schema.ts mendefinisikan tabel ${table}`, schema.includes(`${table}: defineTable(`), table);
  }
  for (const index of [
    'index("by_public_id", ["publicId"])',
    'index("by_tenant", ["tenantId"])',
    'index("by_endpoint", ["endpointId"])',
    'index("by_token", ["token"])',
    'index("by_endpoint_event", ["endpointId", "eventId"])',
    /** Pemilih toko & kursor waktu yang dipakai readResource. */
    'index("by_tenant_code", ["tenantId", "code"])',
    'index("by_tenant_created", ["tenantId", "createdAt"])',
    'index("by_tenant_number", ["tenantId", "number"])',
    'index("by_tenant_store_created", ["tenantId", "storeId", "createdAt"])',
  ]) {
    check(
      `schema.ts punya indeks ${index}`,
      schema.includes(index),
      "indeks yang dipakai apiAccess/http tidak ada",
    );
  }
  {
    // Rahasia kunci API tidak boleh punya kolom sendiri: yang disimpan hanya
    // hash-nya. Dibatasi ke blok `apiKeys` supaya rahasia webhook (yang memang
    // harus disimpan untuk menandatangani kiriman) tidak ikut terhitung.
    const start = schema.indexOf("apiKeys: defineTable(");
    const apiKeysBlock = schema.slice(start, schema.indexOf("webhookEndpoints: defineTable("));
    check(
      "tabel apiKeys menyimpan hash, bukan rahasia kunci",
      apiKeysBlock.includes("secretHash: v.string()") && !/^\s+secret:/m.test(apiKeysBlock),
      "kolom rahasia kunci muncul di tabel apiKeys",
    );
    check(
      "tabel webhookEndpoints menyimpan rahasia + 4 karakter terakhirnya",
      /secret: v\.string\(\),\n\s+secretLastFour: v\.string\(\),/.test(schema),
      "rahasia penanda tangan webhook tidak disimpan",
    );
  }

  // Pekerja terjadwal: jadwal percobaan ulang yang tidak dijalankan siapa pun
  // hanya akan jadi baris `pending` yang menggantung.
  const crons = read("src/convex/crons.ts");
  check(
    "crons.ts mendaftarkan pekerja percobaan ulang webhook",
    crons.includes('from "convex/server"') &&
      crons.includes("cronJobs()") &&
      crons.includes("internal.apiAccess.retryDueDeliveries") &&
      crons.includes("RETRY_WORKER_INTERVAL_MINUTES") &&
      crons.includes("MAX_RETRY_BATCH"),
    "pekerja terjadwal tidak terdaftar di crons.ts",
  );
  check(
    "antrean pekerja diambil dari indeks jadwal, bukan pemindaian riwayat",
    apiAccess.includes('withIndex("by_status_next_attempt"') &&
      apiAccess.includes('.eq("status", "pending")') &&
      /lte\("nextAttemptAt"/.test(apiAccess),
    "pekerja tidak mengambil kiriman jatuh tempo dari indeks",
  );
  check(
    "schema.ts punya indeks antrean pekerja by_status_next_attempt",
    schema.includes('index("by_status_next_attempt", ["status", "nextAttemptAt"])'),
    "indeks yang dipakai pekerja retry tidak ada di schema.ts",
  );
  check(
    "pekerja retry mengirim ulang lewat jalur bertanda tangan yang sama dengan kiriman uji",
    apiAccess.includes("export const retryDueDeliveries = internalAction(") &&
      /retryDueDeliveries[\s\S]*?internal\.apiAccess\.dueDeliveries/.test(apiAccess) &&
      /retryDueDeliveries[\s\S]*?postSignedDelivery\(\{/.test(apiAccess) &&
      // Satu penanda tangan saja: `signWebhookPayload` kini hanya dipanggil dari
      // aturan murni `lib/webhooks.ts` lewat `webhookDeliveryHeaders`, jadi jalur
      // kiriman uji dan jalur percobaan ulang tidak bisa berbeda skema.
      !apiAccess.includes("signWebhookPayload(") &&
      apiAccess.includes("webhookDeliveryHeaders({"),
    "jalur percobaan ulang punya skema tanda tangan sendiri",
  );
  check(
    "setiap percobaan ulang tercatat, dan endpoint mati menghentikan percobaannya",
    /retryDueDeliveries[\s\S]*?internal\.apiAccess\.finishDelivery/.test(apiAccess) &&
      /retryDueDeliveries[\s\S]*?internal\.apiAccess\.stopDelivery/.test(apiAccess),
    "hasil percobaan ulang tidak dicatat / endpoint mati tidak dihentikan",
  );
  check(
    "percobaan ulang menyebut nomor percobaannya di header",
    /retryDueDeliveries[\s\S]*?attempt: item\.attempts \+ 1/.test(apiAccess),
    "percobaan ulang tidak mengirim nomor percobaannya",
  );
  check(
    "alasan dari penerima disimpan, bukan hanya kode statusnya",
    apiAccess.includes("await response.text()") &&
      apiAccess.includes("describeReceiverFailure(response.status, bodyText)"),
    "kiriman gagal hanya menyimpan “Penerima menjawab <status>”",
  );
  check(
    "satu kiriman bisa dikirim ulang dari riwayat tanpa menunggu jadwal",
    apiAccess.includes("export const retryDelivery = action(") &&
      apiAccess.includes("export const beginRetryDelivery = internalMutation(") &&
      /beginRetryDelivery[\s\S]*?attempts: 0/.test(apiAccess) &&
      /retryDelivery = action[\s\S]*?postSignedDelivery\(\{/.test(apiAccess),
    "tombol kirim ulang tidak mengembalikan kiriman ke antrean",
  );
  check(
    "kiriman yang sudah terkirim tidak bisa dikirim ulang",
    apiAccess.includes("sudah diterima penerima; tidak perlu dikirim ulang"),
    "kiriman ganda bisa dibuat lewat tombol kirim ulang",
  );
  {
    const types = read("src/lib/store/types.ts");
    const convexStore = read("src/lib/store/convex.tsx");
    const demoStore = read("src/lib/store/demo.tsx");
    const page = read("src/pages/ApiPage.tsx");
    check(
      "kedua store menyediakan kirim ulang satu kiriman",
      types.includes("retryWebhookDelivery(deliveryId: string)") &&
        convexStore.includes("api.apiAccess.retryDelivery") &&
        demoStore.includes("const retryWebhookDelivery = useCallback("),
      "anggota store baru tidak diimplementasikan kedua store",
    );
    check(
      "halaman menawarkan tombol kirim ulang per baris riwayat",
      page.includes('data-testid={`webhook-retry-${delivery.id}`}') &&
        page.includes("retryWebhookDelivery("),
      "riwayat kiriman tidak punya tombol kirim ulang",
    );
    check(
      "rahasia penanda tangan boleh disamakan dengan milik penerima",
      /secret: v\.optional\(v\.string\(\)\)/.test(apiAccess) &&
        apiAccess.includes("validateWebhookSecret(args.secret)") &&
        demoStore.includes("validateWebhookSecret(input.secret)") &&
        page.includes("validateWebhookSecret") &&
        page.includes("webhook-secret-input-"),
      "rahasia dari penerima tidak bisa dipasang dari halaman",
    );
    check(
      "rahasia yang diketik tidak ditampilkan kembali ke layar",
      apiAccess.includes("tidak dikembalikan lagi") &&
        convexStore.includes("secret: input.secret"),
      "rahasia yang diketik malah dikembalikan sebagai “rahasia baru”",
    );
  }

  // Pemicu event: setiap event yang bisa dilanggan harus jelas nasibnya —
  // dikirim otomatis saat kejadiannya, atau dicatat di sini sebagai belum ada
  // supaya tidak ada entri katalog yang diam-diam tidak pernah terkirim.
  const pos = read("src/convex/pos.ts");
  const opname = read("src/convex/opname.ts");
  const productsSource = read("src/convex/products.ts");
  const outbox = read("src/convex/lib/webhookOutbox.ts");
  for (const [event, file] of [
    ["sale.completed", pos],
    ["sale.voided", pos],
    ["stock.low", pos],
    ["opname.posted", opname],
    ["product.created", productsSource],
  ]) {
    check(
      `peristiwa nyata memicu webhook ${event}`,
      file.includes(`event: "${event}"`) && file.includes("enqueueWebhookEvent(ctx, {"),
      `tidak ada jalur transaksi yang menulis kiriman ${event}`,
    );
  }
  check(
    "kotak keluar hanya menulis ke endpoint aktif yang melanggan event itu",
    outbox.includes('withIndex("by_tenant"') &&
      outbox.includes("endpoint.active &&") &&
      outbox.includes("sanitizeWebhookEvents(endpoint.events).includes(input.event)") &&
      outbox.includes('insert("webhookDeliveries"'),
    "kiriman ditulis tanpa memeriksa langganan endpoint",
  );
  check(
    "kiriman kejadian diserahkan ke pekerja yang sama, bukan dikirim di dalam transaksi",
    outbox.includes("ctx.scheduler.runAfter(0, internal.apiAccess.retryDueDeliveries") &&
      !pos.includes("await fetch(") &&
      !opname.includes("await fetch("),
    "pengiriman jaringan terjadi di dalam transaksi penjualan/opname",
  );
  check(
    "penjadwalan pekerja sekali per transaksi, bukan sekali per event",
    // Dua penjadwalan dalam satu transaksi pernah terbukti membuat dua putaran
    // mengambil baris antrean yang sama: kiriman terkirim dua kali dan baris lain
    // menunggu cron. Jadi `enqueueWebhookEvent` tidak boleh menjadwalkan apa pun;
    // penjadwalannya satu kali lewat `scheduleWebhookDeliveryPass`.
    (() => {
      const mulai = outbox.indexOf("export async function enqueueWebhookEvent");
      const akhir = outbox.indexOf("export async function scheduleWebhookDeliveryPass");
      const badan = outbox.slice(mulai, akhir);
      return (
        mulai > 0 &&
        akhir > mulai &&
        !badan.includes("runAfter") &&
        /scheduleWebhookDeliveryPass[\s\S]{0,400}runAfter\(0, internal\.apiAccess\.retryDueDeliveries/.test(
          outbox,
        ) &&
        pos.includes("await scheduleWebhookDeliveryPass(ctx, enqueued)") &&
        opname.includes("await scheduleWebhookDeliveryPass(ctx, enqueuedOpname)")
      );
    })(),
    "antrean menjadwalkan pekerja per event",
  );
  // Pemicu berbasis kalender: `payable.due` dan `receivable.overdue` tidak bisa
  // dipicu transaksi — keadaannya berubah karena waktu — jadi nasibnya dijaga
  // di sini: pekerja harian, indeks antrean, dan penanda sekali-per-dokumen.
  const payablesFn = read("src/convex/payables.ts");
  const arFn = read("src/convex/ar.ts");
  for (const [event, file] of [
    ["payable.due", payablesFn],
    ["receivable.overdue", arFn],
  ]) {
    check(
      `pekerja terjadwal memicu webhook ${event}`,
      file.includes(`event: "${event}"`) && file.includes("enqueueWebhookEvent(ctx, {"),
      `tidak ada pekerja yang menulis kiriman ${event}`,
    );
  }
  check(
    "pekerja jatuh tempo mengambil dokumen dari indeks, bukan memindai tabel",
    payablesFn.includes('withIndex("by_due"') &&
      payablesFn.includes('.eq("dueNotified", false)') &&
      /lte\("dueDate", now\)/.test(payablesFn) &&
      arFn.includes('withIndex("by_overdue"') &&
      arFn.includes('.eq("overdueNotified", false)') &&
      /lt\("dueDate", now\)/.test(arFn),
    "pekerja jatuh tempo tidak memakai indeks antreannya",
  );
  check(
    "pekerja jatuh tempo dibatasi jendela, supaya baris lama tidak menghabiskan kuota",
    // Tanpa batas bawah, dokumen yang tidak pernah perlu diberitahukan (mis.
    // tagihan yang dibayar sebelum jatuh tempo) menumpuk di depan indeks
    // `(notified, dueDate)` sampai seluruh kuota putaran habis.
    payablesFn.includes('gt("dueDate", now - DUE_REMINDER_WINDOW_MS)') &&
      arFn.includes('gt("dueDate", now - OVERDUE_REMINDER_WINDOW_MS)'),
    "pekerja jatuh tempo memindai tanpa batas bawah",
  );
  check(
    "schema.ts punya indeks antrean pekerja jatuh tempo",
    schema.includes('index("by_due", ["dueNotified", "dueDate"])') &&
      schema.includes('index("by_overdue", ["overdueNotified", "dueDate"])'),
    "indeks yang dipakai pekerja jatuh tempo tidak ada di schema.ts",
  );
  check(
    "pekerja jatuh tempo memasang penanda sekali-per-dokumen",
    payablesFn.includes("patch(payable._id, { dueNotified: true })") &&
      arFn.includes("patch(receivable._id, { overdueNotified: true })"),
    "dokumen tidak ditandai sudah diingatkan, jadi pekerja akan mengulang tiap hari",
  );
  check(
    "dokumen baru menulis penandanya sejak lahir (indeks hanya memuat kolom bernilai false)",
    // Pelajaran mahal: indeks `(dueNotified, dueDate)` tidak memuat baris tanpa
    // kolom `dueNotified`, jadi tagihan/piutang yang dibuat tanpa kolom itu tidak
    // akan pernah ditemukan pekerja — fiturnya terlihat jalan tapi tidak pernah
    // berangkat.
    read("src/convex/purchasing.ts").includes("dueNotified: false") &&
      payablesFn.includes("dueNotified: false") &&
      read("src/convex/pos.ts").includes("overdueNotified: false"),
    "salah satu jalur pembuatan dokumen tidak menulis penanda notifikasi",
  );
  check(
    "pekerja jatuh tempo mendaftar sebagai jadwal harian, bukan menunggu putaran menit",
    crons.includes("crons.daily(") &&
      crons.includes("internal.payables.notifyDuePayables") &&
      crons.includes("internal.ar.notifyOverdueReceivables") &&
      crons.includes("DUE_REMINDER_BATCH") &&
      crons.includes("OVERDUE_REMINDER_BATCH"),
    "pekerja jatuh tempo tidak terdaftar di crons.ts",
  );
  check(
    "pekerja jatuh tempo memakai aturan murni yang sama dengan halaman",
    payablesFn.includes("needsDueReminder({ ...like, dueNotified: payable.dueNotified }, now)") &&
      arFn.includes("needsOverdueReminder({ ...like, overdueNotified: receivable.overdueNotified }, now)"),
    "pekerja jatuh tempo menghitung syaratnya sendiri, bukan lewat aturan murni",
  );
}

// ---------------------------------------------- pengingat dokumen jatuh tempo
// Bagian murni dari pemicu kalender: kapan sebuah dokumen dianggap perlu
// diberitahukan, dan apa isi kirimannya. Perilaku pekerja (indeks + penanda)
// diperiksa di atas; di sini aturannya diuji langsung.
{
  const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
  const DAY = 24 * 60 * 60 * 1000;
  const account = (dueInDays, paidAmount = 0, status = "open", amount = 1_000_000) => ({
    amount,
    paidAmount,
    dueDate: NOW + dueInDays * DAY,
    status,
  });

  check(
    "hutang yang jatuh temponya tiba & belum diingatkan perlu diberitahukan",
    needsDueReminder(account(0), NOW) &&
      needsDueReminder(account(-3), NOW) &&
      needsDueReminder({ ...account(0), dueNotified: false }, NOW),
  );
  check(
    "hutang yang belum jatuh tempo, sudah diingatkan, atau lunas tidak diberitahukan",
    !needsDueReminder(account(1), NOW) &&
      !needsDueReminder({ ...account(-3), dueNotified: true }, NOW) &&
      !needsDueReminder(account(-3, 1_000_000), NOW) &&
      !needsDueReminder(account(-3, 0, "void"), NOW),
  );
  check(
    "piutang yang benar-benar lewat tempo & belum diingatkan perlu diberitahukan",
    needsOverdueReminder(account(-2), NOW) &&
      needsOverdueReminder(account(-45), NOW) &&
      needsOverdueReminder({ ...account(-2), overdueNotified: false }, NOW),
  );
  check(
    "piutang yang diingatkan, belum lewat tempo (termasuk jatuh tempo hari ini), atau lunas tidak diberitahukan",
    !needsOverdueReminder({ ...account(-2), overdueNotified: true }, NOW) &&
      !needsOverdueReminder(account(0), NOW) &&
      !needsOverdueReminder(account(5), NOW) &&
      !needsOverdueReminder(account(-2, 1_000_000), NOW) &&
      !needsOverdueReminder(account(-2, 0, "void"), NOW),
  );
  check(
    "batas putaran & jendela pekerja jatuh tempo masuk akal",
    DUE_REMINDER_BATCH >= 1 &&
      DUE_REMINDER_BATCH <= 100 &&
      OVERDUE_REMINDER_BATCH >= 1 &&
      OVERDUE_REMINDER_BATCH <= 100 &&
      // Jendela harus cukup panjang untuk menutup satu siklus tagihan biasa
      // (tempo maksimal 120 hari berarti tagihan bisa lahir jauh sebelum jatuh
      // tempo) tetapi tetap membatasi penumpukan baris lama.
      DUE_REMINDER_WINDOW_MS >= 30 * DAY &&
      DUE_REMINDER_WINDOW_MS <= 180 * DAY &&
      OVERDUE_REMINDER_WINDOW_MS >= 30 * DAY &&
      OVERDUE_REMINDER_WINDOW_MS <= 180 * DAY,
    JSON.stringify({
      payable: DUE_REMINDER_BATCH,
      piutang: OVERDUE_REMINDER_BATCH,
      jendelaHari: [DUE_REMINDER_WINDOW_MS / DAY, OVERDUE_REMINDER_WINDOW_MS / DAY],
    }),
  );

  const due = payableDueEventData({
    number: "AP-2026-0007",
    supplierName: "PT Sumber Rejeki",
    amount: 1_250_000,
    balance: 1_250_000,
    dueDate: NOW - 2 * DAY,
    daysPastDue: 2,
    reference: "INV/2026/77",
  });
  check(
    "isi payable.due memuat tagihan, supplier, dan umurnya",
    due.number === "AP-2026-0007" &&
      due.supplier === "PT Sumber Rejeki" &&
      due.balance === 1_250_000 &&
      due.daysPastDue === 2 &&
      due.reference === "INV/2026/77",
    JSON.stringify(due),
  );
  check(
    "payable.due tanpa nomor tagihan supplier menulis null, bukan menghilangkan kolom",
    payableDueEventData({
      number: "AP-2026-0008",
      supplierName: "CV Maju",
      amount: 10,
      balance: 10,
      dueDate: NOW,
      daysPastDue: 0,
    }).reference === null,
  );
  const overdue = receivableOverdueEventData({
    number: "AR-2026-0003",
    customerName: "Toko Berkah",
    balance: 450_000,
    dueDate: NOW - 9 * DAY,
    daysPastDue: 9,
  });
  check(
    "isi receivable.overdue memuat nota, pelanggan, dan umurnya",
    overdue.number === "AR-2026-0003" &&
      overdue.customer === "Toko Berkah" &&
      overdue.balance === 450_000 &&
      overdue.daysPastDue === 9,
    JSON.stringify(overdue),
  );
}

// ------------------------------------------------- sambungan ke kedua store
{
  const types = read("src/lib/store/types.ts");
  const demo = read("src/lib/store/demo.tsx");
  const convex = read("src/lib/store/convex.tsx");
  const page = read("src/pages/ApiPage.tsx");

  const members = [
    "apiKeys",
    "apiKeySummary",
    "webhookEndpoints",
    "webhookDeliveries",
    "webhookSummary",
    "createApiKey",
    "revokeApiKey",
    "createWebhookEndpoint",
    "updateWebhookEndpoint",
    "removeWebhookEndpoint",
    "testWebhookEndpoint",
  ];
  for (const member of members) {
    check(`StoreApi mendeklarasikan ${member}`, types.includes(`${member}`), member);
    check(`store demo memakai ${member}`, demo.includes(member), "slice demo belum tersambung");
    check(`store Convex memakai ${member}`, convex.includes(member), "slice Convex belum tersambung");
    check(`halaman API memakai ${member}`, page.includes(member), "halaman belum memakai slice");
  }
  check(
    "halaman hanya menawarkan scope yang dipegang pengguna",
    page.includes("permissions.includes(option.permission)"),
    "daftar scope tidak dibatasi izin pengguna",
  );
  check(
    "halaman menandai endpoint & scope tulis, bukan mengaburkannya",
    page.includes("resource.write") &&
      page.includes("option.write") &&
      page.includes("sampleExternalOrderBody") &&
      page.includes("describeExternalOrder"),
    "halaman tidak membedakan scope baca dan tulis",
  );
  check(
    "gerbang fitur halaman memakai alasan yang sama dengan server",
    page.includes('featureUnavailableReason(') && page.includes('"api.access"'),
    "halaman tidak menjelaskan kenapa API terkunci",
  );
  check(
    "rute /app/api dijaga izin `api.manage`",
    read("src/App.tsx").includes('path="api"') &&
      read("src/App.tsx").includes('permission="api.manage"'),
    "rute API tidak dijaga izin",
  );
  check(
    "menu sidebar memuat API & Webhook",
    read("src/layouts/AppLayout.tsx").includes('to: "/app/api"') &&
      read("src/layouts/AppLayout.tsx").includes('label: "API & Webhook"'),
    "menu sidebar tidak memuat halaman API",
  );
}

console.log(`${results.length}/${results.length} checks passed`);

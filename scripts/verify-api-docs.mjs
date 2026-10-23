/**
 * Uji **dokumentasi API publik** (`/dokumentasi-api`) tanpa peramban.
 *
 * Dokumentasi yang tidak diuji akan melenceng dari kode tanpa ada yang tahu:
 * endpoint baru tidak terdokumentasi, endpoint yang dihapus tetap ditawarkan,
 * atau contoh JSON yang tidak bisa diuraikan. Harness ini menjaga empat hal:
 *
 *   1. **Isi mengikuti server.** Daftar endpoint di `apiDocs.ts` harus sama
 *      persis dengan `API_RESOURCES` (resource, method, path, scope) — tabel
 *      yang juga dipakai `http.ts` untuk memeriksa scope.
 *   2. **Contoh benar-benar sah.** Semua contoh balasan diurai sebagai JSON,
 *      dan contoh pesanan masuk diurai `parseExternalOrder` (jalur yang sama
 *      dengan endpoint tulis), jadi contoh tidak bisa menjadi teks hiasan.
 *   3. **Webhook terdokumentasi utuh.** Nama header, tanda tangan, dan seluruh
 *      event diambil dari aturan murni yang dipakai pengirim, lalu diperiksa
 *      dengan verifikasi yang sama.
 *   4. **Halamannya tetap publik.** Rute `/dokumentasi-api` tidak boleh dibungkus
 *      `RequireAuth`, dan halamannya tidak boleh mengimpor sesi — pembacanya
 *      pengembang platform mitra yang belum punya akun.
 *
 * Usage: bun scripts/verify-api-docs.mjs
 */
import { readFileSync } from "node:fs";
import { API_RESOURCES } from "../src/convex/lib/apiKeys.ts";
import { WEBHOOK_EVENT_KEYS, WEBHOOK_EVENTS } from "../src/convex/lib/webhooks.ts";
import {
  sampleDeliveryPayload,
  verifyWebhookSignature,
  webhookDeliveryHeaders,
} from "../src/convex/lib/webhooks.ts";
import { parseExternalOrder } from "../src/convex/lib/apiOrders.ts";
import {
  INBOUND_EVENT_KEYS,
  INBOUND_HEADERS,
  INBOUND_WEBHOOK_EVENTS,
  parseInboundEnvelope,
} from "../src/convex/lib/inboundWebhooks.ts";
import {
  API_BASE_PLACEHOLDER,
  API_DOC_ENDPOINTS,
  API_DOC_ERRORS,
  API_DOC_INTEGRATION_STEPS,
  API_DOC_LIMITS,
  API_DOC_NOT_YET,
  API_DOC_VERSION,
  INBOUND_WEBHOOK_DOC,
  SAMPLE_ORDER_BODY,
  SYNC_DOC,
  WEBHOOK_DOC,
  apiSiteUrl,
} from "../src/lib/apiDocs.ts";

const results = [];
function check(name, condition, detail) {
  // Satu kegagalan menghentikan harness dengan nama ceknya, supaya hasilnya
  // tidak pernah terbaca sebagai “lulus sebagian”.
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const HERE = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, HERE), "utf8");

// --------------------------------------------------- isi mengikuti server
check("versi dokumentasi terisi", API_DOC_VERSION === "v1", API_DOC_VERSION);
check(
  "jumlah endpoint terdokumentasi sama dengan API_RESOURCES",
  API_DOC_ENDPOINTS.length === API_RESOURCES.length,
  `dokumen ${API_DOC_ENDPOINTS.length}, server ${API_RESOURCES.length}`,
);

const docByResource = new Map(API_DOC_ENDPOINTS.map((row) => [row.resource, row]));
check(
  "tidak ada resource ganda di dokumentasi",
  docByResource.size === API_DOC_ENDPOINTS.length,
  API_DOC_ENDPOINTS.map((row) => row.resource).join(", "),
);

for (const resource of API_RESOURCES) {
  const doc = docByResource.get(resource.resource);
  check(`resource ${resource.resource} terdokumentasi`, Boolean(doc));
  check(
    `method ${resource.resource} = ${resource.method}`,
    doc.method === resource.method,
    doc.method,
  );
  check(
    `path ${resource.resource} = ${resource.path}`,
    doc.path === resource.path,
    doc.path,
  );
  check(
    `scope ${resource.resource} sama dengan server`,
    doc.scope === resource.scope,
    String(doc.scope),
  );
  check(
    `judul & ringkasan ${resource.resource} terisi`,
    doc.title.trim().length >= 3 && doc.summary.trim().length >= 20,
    doc.title,
  );
  check(
    `field balasan ${resource.resource} dijelaskan`,
    doc.fields.length >= 3,
    `${doc.fields.length} field`,
  );
}

check(
  "setiap endpoint tulis punya contoh permintaan, endpoint baca tidak",
  API_DOC_ENDPOINTS.filter((row) => Boolean(row.requestExample))
    .map((row) => row.resource)
    .sort()
    .join(",") ===
    API_RESOURCES.filter((row) => row.write)
      .map((row) => row.resource)
      .sort()
      .join(","),
  API_DOC_ENDPOINTS.filter((row) => Boolean(row.requestExample))
    .map((row) => row.resource)
    .join(","),
);

// ------------------------------------------------ contoh benar-benar sah
for (const endpoint of API_DOC_ENDPOINTS) {
  let parsed = null;
  try {
    parsed = JSON.parse(endpoint.responseExample);
  } catch (error) {
    check(`contoh balasan ${endpoint.resource} adalah JSON sah`, false, String(error));
  }
  check(
    `contoh balasan ${endpoint.resource} berbentuk amplop`,
    parsed && parsed.ok === true && parsed.resource === endpoint.resource && parsed.data !== null,
    JSON.stringify(parsed)?.slice(0, 120),
  );
}

// Katalog dua tingkat: dokumentasi harus menyebut kategori & subkategori pada
// endpoint produk, bukan hanya di kode. Contohnya ikut diperiksa supaya field
// yang dijanjikan tidak hilang dari balasan contoh.
{
  const productDoc = docByResource.get("products");
  const fieldNames = productDoc.fields.map((row) => row.name);
  check(
    "dokumentasi produk menjelaskan kategori & subkategori",
    fieldNames.includes("category") &&
      fieldNames.includes("subcategory") &&
      productDoc.responseExample.includes('"category"') &&
      productDoc.responseExample.includes('"subcategory"'),
    fieldNames.join(", "),
  );
  check(
    "catatan produk menjelaskan subkategori tidak mengubah SKU",
    productDoc.notes.some(
      (note) => note.includes("Subkategori") && note.includes("SKU"),
    ),
    productDoc.notes.join(" | "),
  );
  check(
    "kontrak sinkronisasi menyebut katalog dua tingkat",
    JSON.stringify(SYNC_DOC).includes("subcategory"),
    "SYNC_DOC tidak menyebut subkategori",
  );
}

const writeDoc = docByResource.get("sales.create");
const order = parseExternalOrder(SAMPLE_ORDER_BODY);
check("contoh pesanan masuk lolos parseExternalOrder", order.ok, order.reason);
check(
  "contoh pesanan memakai SKU gaya MesinPOS",
  SAMPLE_ORDER_BODY.lines.every((line) => /^[A-Z0-9][A-Z0-9._-]*$/.test(line.sku)),
  SAMPLE_ORDER_BODY.lines.map((line) => line.sku).join(", "),
);
check(
  "contoh permintaan di halaman sama dengan contoh yang diuji",
  writeDoc.requestExample === JSON.stringify(SAMPLE_ORDER_BODY, null, 2),
  "contoh permintaan disusun ulang",
);

// ------------------------------------------------------- webhook masuk
{
  const receive = docByResource.get("inboundWebhooks.receive");
  check(
    "endpoint webhook masuk terdokumentasi dengan path bertoken",
    Boolean(receive) && receive.path.includes("{token}") && receive.method === "POST",
    receive?.path,
  );
  check(
    "seluruh event webhook masuk terdokumentasi",
    INBOUND_WEBHOOK_DOC.events.length === INBOUND_WEBHOOK_EVENTS.length &&
      INBOUND_EVENT_KEYS.every((key) =>
        INBOUND_WEBHOOK_DOC.events.some((event) => event.key === key),
      ),
    INBOUND_WEBHOOK_DOC.events.map((event) => event.key).join(", "),
  );
  check(
    "header webhook masuk yang didokumentasikan sama dengan yang dibaca server",
    INBOUND_WEBHOOK_DOC.headers.map((header) => header.name).join(",") ===
      [INBOUND_HEADERS.timestamp, INBOUND_HEADERS.signature, INBOUND_HEADERS.event, INBOUND_HEADERS.eventId].join(","),
    INBOUND_WEBHOOK_DOC.headers.map((header) => header.name).join(", "),
  );
  check(
    "contoh badan peristiwa lolos parser penerimanya",
    (() => {
      const parsed = JSON.parse(INBOUND_WEBHOOK_DOC.payloadExample);
      const envelope = parseInboundEnvelope(
        JSON.stringify(parsed),
        { timestamp: "1", signature: "x", event: parsed.event, eventId: null },
      );
      return envelope.ok;
    })(),
    "contoh badan peristiwa tidak sah",
  );
  check(
    "catatan webhook masuk menjelaskan idempotensi & izin pelaku",
    INBOUND_WEBHOOK_DOC.notes.some((note) => note.includes("idempotensi")) &&
      INBOUND_WEBHOOK_DOC.notes.some((note) => note.includes("pembuat endpoint")),
    INBOUND_WEBHOOK_DOC.notes.join(" | "),
  );
  check(
    "dokumentasi menyebut endpoint pengelola webhook masuk",
    ["inboundWebhooks", "inboundWebhooks.create", "inboundWebhooks.delete"].every((resource) =>
      docByResource.has(resource),
    ),
    "endpoint pengelola webhook masuk tidak terdokumentasi",
  );
}

// ------------------------------------------------------ webhook terdokumentasi
check(
  "seluruh event webhook terdokumentasi",
  WEBHOOK_DOC.events.length === WEBHOOK_EVENTS.length &&
    WEBHOOK_EVENT_KEYS.every((key) => WEBHOOK_DOC.events.some((event) => event.key === key)),
  WEBHOOK_DOC.events.map((event) => event.key).join(", "),
);
check(
  "tiap event punya label & keterangan",
  WEBHOOK_DOC.events.every(
    (event) => event.label.trim().length > 0 && event.description.trim().length > 20,
  ),
  "ada event tanpa keterangan",
);

const sampleBody = sampleDeliveryPayload("sale.completed", 1770000000000);
const headers = webhookDeliveryHeaders({
  secret: "rahasia-uji-dokumentasi",
  timestamp: 1770000000000,
  event: "sale.completed",
  attempt: 1,
  body: sampleBody,
});
const documentedHeaders = WEBHOOK_DOC.headers.map((header) => header.name).sort();
check(
  "header webhook terdokumentasi sama dengan yang dikirim server",
  documentedHeaders.join(",") === Object.keys(headers).sort().join(","),
  documentedHeaders.join(", "),
);
check(
  "tanda tangan contoh bisa diverifikasi",
  verifyWebhookSignature({
    secret: "rahasia-uji-dokumentasi",
    timestamp: 1770000000000,
    body: sampleBody,
    signature: headers["x-mesinpos-signature"],
    now: 1770000000000,
  }),
  headers["x-mesinpos-signature"],
);
check(
  "contoh verifikasi menolak badan yang diubah",
  !verifyWebhookSignature({
    secret: "rahasia-uji-dokumentasi",
    timestamp: 1770000000000,
    body: `${sampleBody} `,
    signature: headers["x-mesinpos-signature"],
    now: 1770000000000,
  }),
  "badan yang diubah lolos verifikasi",
);
check(
  "contoh verifikasi menolak kiriman basi",
  !verifyWebhookSignature({
    secret: "rahasia-uji-dokumentasi",
    timestamp: 1770000000000,
    body: sampleBody,
    signature: headers["x-mesinpos-signature"],
    now: 1770000000000 + 6 * 60 * 1000,
  }),
  "kiriman basi lolos verifikasi",
);
check(
  "badan kiriman contoh adalah JSON sah dengan id & event",
  (() => {
    try {
      const parsed = JSON.parse(WEBHOOK_DOC.payloadExample);
      return parsed.event === "sale.completed" && typeof parsed.id === "string";
    } catch {
      return false;
    }
  })(),
  "contoh badan webhook tidak sah",
);
check(
  "contoh verifikasi Node.js benar-benar memakai HMAC atas timestamp.body",
  WEBHOOK_DOC.verifyExample.includes('createHmac("sha256"') &&
    WEBHOOK_DOC.verifyExample.includes('timestamp + "." + body') &&
    WEBHOOK_DOC.verifyExample.includes("timingSafeEqual"),
  "contoh verifikasi tidak mengikuti skema tanda tangan",
);

// ------------------------------------------------------ galat, batas, integrasi
check(
  "kode status yang didokumentasikan lengkap",
  [200, 201, 400, 401, 403, 404, 409].every((status) =>
    API_DOC_ERRORS.some((row) => row.status === status),
  ),
  API_DOC_ERRORS.map((row) => row.status).join(", "),
);
check(
  "tiap kode status punya penyebab yang bisa dibaca",
  API_DOC_ERRORS.every((row) => row.meaning.trim().length > 0 && row.causes.length > 0),
  "ada status tanpa penyebab",
);
check(
  "batas limit & days yang didokumentasikan sama dengan server",
  API_DOC_LIMITS.some((row) => row.value.includes("1–100")) &&
    API_DOC_LIMITS.some((row) => row.value.includes("1–30")) &&
    API_DOC_LIMITS.some((row) => row.value.includes("maksimal 20")),
  API_DOC_LIMITS.map((row) => `${row.label}: ${row.value}`).join(" | "),
);
check(
  "dokumentasi menjelaskan pemilih toko, rentang tanggal, dan kursor",
  API_DOC_LIMITS.some((row) => row.label.includes("storeCode")) &&
    API_DOC_LIMITS.some((row) => row.label.includes("from") && row.label.includes("to")) &&
    API_DOC_LIMITS.some(
      (row) => row.label.includes("cursor") || row.label.includes("bertanggal") || row.note.includes("cursor"),
    ),
  API_DOC_LIMITS.map((row) => row.label).join(" | "),
);
const notYet = API_DOC_NOT_YET.join(" | ").toLowerCase();
check(
  "daftar hal yang belum tersedia masih terisi dan tidak menyebut fitur baru",
  API_DOC_NOT_YET.length >= 3 &&
    notYet.includes("produk") &&
    notYet.includes("antrean ulang") &&
    !notYet.includes("toko pertama") &&
    !notYet.includes("webhook masuk dari platform mitra"),
  API_DOC_NOT_YET.join(" | "),
);
check(
  "langkah integrasi menyebut pusatbahanbangunan.com",
  API_DOC_INTEGRATION_STEPS.some((step) =>
    `${step.title} ${step.body}`.includes("pusatbahanbangunan.com"),
  ),
  "platform mitra tidak disebut",
);
check(
  "langkah integrasi menyebut pesanan, katalog, dan webhook",
  `${JSON.stringify(API_DOC_INTEGRATION_STEPS)}`.includes("POST /api/v1/sales") &&
    `${JSON.stringify(API_DOC_INTEGRATION_STEPS)}`.includes("GET /api/v1/products") &&
    `${JSON.stringify(API_DOC_INTEGRATION_STEPS)}`.includes("sale.completed"),
  "alur integrasi tidak lengkap",
);

// ------------------------------------------------------------ base URL
check(
  "alamat .convex.cloud diterjemahkan ke .convex.site",
  apiSiteUrl("https://mellow-narwhal-477.convex.cloud") ===
    "https://mellow-narwhal-477.convex.site",
  apiSiteUrl("https://mellow-narwhal-477.convex.cloud"),
);
check(
  "alamat tanpa deployment tetap punya pengganti yang jelas",
  API_BASE_PLACEHOLDER.includes("convex.site") && API_BASE_PLACEHOLDER.startsWith("https://"),
  API_BASE_PLACEHOLDER,
);

// ------------------------------------------------------ halaman tetap publik
const page = read("src/pages/ApiDocsPage.tsx");
const app = read("src/App.tsx");
const landing = read("src/pages/LandingPage.tsx");
const apiPage = read("src/pages/ApiPage.tsx");

check(
  "rute /dokumentasi-api memakai halaman dokumentasi",
  app.includes('path="/dokumentasi-api"') && app.includes("<ApiDocsPage />"),
  "rute tidak terpasang",
);
const routeAt = app.indexOf('path="/dokumentasi-api"');
// Potong tepat sampai `/>` pertama: rute tetangga memakai `RequireAuth`, dan
// membaca jendela berukuran tetap akan salah menuduh rute ini dibungkus.
const routeEnd = routeAt >= 0 ? app.indexOf("/>", routeAt) : -1;
const routeBlock = routeAt >= 0 && routeEnd > routeAt ? app.slice(routeAt, routeEnd + 2) : "";
check(
  "rute dokumentasi berada di luar RequireAuth",
  routeBlock.includes("ApiDocsPage") && !routeBlock.includes("RequireAuth"),
  routeBlock || "rute tidak ditemukan",
);
check(
  "halaman dokumentasi tidak mengimpor sesi atau penjaga rute",
  !page.includes("@/lib/session") && !page.includes("<RequireAuth"),
  "halaman membutuhkan sesi",
);
check(
  "halaman membaca isi dari modul dokumentasi",
  page.includes('from "@/lib/apiDocs"') &&
    page.includes("API_DOC_ENDPOINTS.map") &&
    page.includes("WEBHOOK_DOC.events.map"),
  "halaman tidak memakai isi terdokumentasi",
);
check(
  "halaman menautkan ke tempat membuat kunci",
  page.includes('to="/app/api"'),
  "tidak ada jalan ke halaman API & Webhook",
);
check(
  "beranda menautkan dokumentasi di navigasi & footer",
  (landing.match(/to="\/dokumentasi-api"/g) ?? []).length >= 2,
  `${(landing.match(/to="\/dokumentasi-api"/g) ?? []).length} tautan`,
);
check(
  "halaman API & Webhook menautkan dokumentasi publik",
  apiPage.includes('to="/dokumentasi-api"'),
  "tautan dari halaman backstage tidak ada",
);

console.log(`${results.length}/${results.length} checks passed`);

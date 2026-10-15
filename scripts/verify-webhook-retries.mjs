/**
 * Pekerja terjadwal webhook: perilakunya diuji, bukan teksnya.
 *
 * `api.access` sudah menghitung & menyimpan jadwal percobaan ulang
 * (`webhookDeliveries.nextAttemptAt`), dan `scripts/verify-api.mjs` memeriksa
 * **aturan** pekerja tanpa jaringan. Berkas ini menutup jarak terakhir: ia
 * membuat kiriman yang benar-benar gagal di deployment nyata, lalu **tidak
 * melakukan apa-apa** — kesabaran itulah ujiannya. Kalau percobaan bertambah
 * sendiri, berarti `crons.ts` → `retryDueDeliveries` memang menjalankan jadwalnya.
 *
 * Dua penerima diuji bersamaan:
 *
 *   - penerima **aktif** yang tidak bisa dihubungi → percobaannya harus bertambah
 *     dan jadwal berikutnya mengikuti aturan backoff;
 *   - penerima yang **dimatikan** setelah gagal → pekerja harus berhenti dan
 *     menutup kirimannya sebagai `failed`, bukan mengirimkannya diam-diam.
 *
 * Pekerja berjalan tiap `RETRY_WORKER_INTERVAL_MINUTES` menit, jadi skrip ini
 * menunggu jadwal sungguhan (batasnya `MAX_WAIT_SECONDS`, default 160 detik).
 *
 * Usage:
 *   VITE_CONVEX_URL=https://<deployment>.convex.cloud bun scripts/verify-webhook-retries.mjs
 *   SKIP_PUSH=1 VITE_CONVEX_URL=… bun scripts/verify-webhook-retries.mjs   # fungsi sudah pasti ter-push
 *   MAX_WAIT_SECONDS=170 VITE_CONVEX_URL=… bun scripts/verify-webhook-retries.mjs
 */
import { spawnSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../src/convex/_generated/api.js";
import {
  DELIVERY_BACKOFF_MINUTES,
  RETRY_WORKER_INTERVAL_MINUTES,
} from "../src/convex/lib/webhooks.ts";

const url = process.env.VITE_CONVEX_URL;
if (!url) {
  console.error(
    "VITE_CONVEX_URL tidak diset — jalankan `bun convex dev --once` dulu lalu setel URL deployment.",
  );
  process.exit(1);
}

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mendorong kode terbaru dulu: tanpa ini, pemeriksaan bisa "lulus" melawan
 * fungsi lama yang kebetulan sudah punya pekerjanya.
 */
function pushOnce() {
  console.log("→ push kode backend (`bun convex dev --once`)…");
  const res = spawnSync("bun", ["convex", "dev", "--once"], {
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    encoding: "utf8",
    timeout: 240_000,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  if (!out.includes("Convex functions ready")) {
    throw new Error(`push backend gagal — pemeriksaan dibatalkan:\n${out}`);
  }
  console.log("  ✓ kode terbaru ter-push\n");
}

const waitMs = Number(process.env.MAX_WAIT_SECONDS ?? 160) * 1000;
const HOST_MATI = "https://tidak-ada.mesinpos.invalid";

async function main() {
  if (process.env.SKIP_PUSH !== "1") pushOnce();

  const client = new ConvexHttpClient(url);
  await client.query(api.tenants.getBySlug, { slug: "__readiness_probe__" });

  const runId = Date.now();
  const { userId } = await client.mutation(api.users.createOrGet, {
    email: `retry+${runId}@mesinpos.test`,
    name: "Pekerja Webhook Uji",
  });
  const { tenantId } = await client.mutation(api.tenants.create, {
    ownerId: userId,
    name: "Toko Pekerja Webhook",
    slug: `retry-${runId}`,
    planKey: "professional",
    storeName: "Cabang Uji",
    verticals: ["umkm"],
  });
  // Sama seperti tenant nyata: `api.access` ada di paket Enterprise.
  await client.mutation(api.billing.changePlan, {
    tenantId,
    newPlanKey: "enterprise",
    actorId: userId,
  });

  const aktif = await client.mutation(api.apiAccess.createEndpoint, {
    tenantId,
    actorId: userId,
    url: `${HOST_MATI}/penerima-aktif`,
    description: "Penerima aktif (DNS tidak ada)",
    events: ["sale.completed"],
  });
  const mati = await client.mutation(api.apiAccess.createEndpoint, {
    tenantId,
    actorId: userId,
    url: `${HOST_MATI}/penerima-mati`,
    description: "Penerima yang dimatikan",
    events: ["sale.completed"],
  });

  // Kiriman pertama dikirim manual (tombol “Kirim uji”) supaya kegagalannya
  // nyata; sesudah ini tidak ada lagi yang dipicu tangan.
  const kiriman = await Promise.all([
    client.action(api.apiAccess.testEndpoint, {
      tenantId,
      actorId: userId,
      endpointId: aktif.endpointId,
    }),
    client.action(api.apiAccess.testEndpoint, {
      tenantId,
      actorId: userId,
      endpointId: mati.endpointId,
    }),
  ]);
  check(
    "dua kiriman gagal tercatat sebagai percobaan pertama yang menunggu jadwal",
    kiriman[0].attempts === 1 &&
      kiriman[0].status === "pending" &&
      kiriman[0].error !== null &&
      kiriman[1].attempts === 1 &&
      kiriman[1].status === "pending" &&
      kiriman[1].error !== null,
    JSON.stringify(kiriman),
  );

  const awal = await client.query(api.apiAccess.overview, { tenantId, actorId: userId });
  const awalAktif = awal.deliveries.find((row) => row.endpointId === aktif.endpointId);
  const awalMati = awal.deliveries.find((row) => row.endpointId === mati.endpointId);
  check(
    "keduanya menyimpan jadwal percobaan berikutnya",
    typeof awalAktif?.nextAttemptAt === "number" && typeof awalMati?.nextAttemptAt === "number",
    JSON.stringify(awal.deliveries),
  );

  // Penerima kedua dimatikan **sebelum** jadwalnya tiba: pekerja harus berhenti,
  // bukan mengirim walau jadwalnya sudah lewat.
  await client.mutation(api.apiAccess.updateEndpoint, {
    tenantId,
    actorId: userId,
    endpointId: mati.endpointId,
    active: false,
  });

  console.log(
    `→ menunggu pekerja terjadwal (tiap ${RETRY_WORKER_INTERVAL_MINUTES} menit, maks ${waitMs / 1000}s)…`,
  );
  const deadline = Date.now() + waitMs;
  let percobaanAktif = null;
  let dihentikan = null;
  while (Date.now() < deadline) {
    const { deliveries } = await client.query(api.apiAccess.overview, {
      tenantId,
      actorId: userId,
    });
    percobaanAktif =
      deliveries.find((row) => row.endpointId === aktif.endpointId && row.attempts >= 2) ?? null;
    dihentikan =
      deliveries.find((row) => row.endpointId === mati.endpointId && row.status === "failed") ??
      null;
    if (percobaanAktif && dihentikan) break;
    console.log(
      `  …percobaan aktif=${deliveries.find((row) => row.endpointId === aktif.endpointId)?.attempts ?? "-"}` +
        ` penerima-dimatikan=${deliveries.find((row) => row.endpointId === mati.endpointId)?.status ?? "-"}`,
    );
    await sleep(5000);
  }

  check(
    "pekerja mengirim ulang kiriman yang jatuh tempo tanpa ada yang memicu manual",
    percobaanAktif !== null &&
      percobaanAktif.attempts === 2 &&
      percobaanAktif.status === "pending" &&
      percobaanAktif.lastError !== null,
    JSON.stringify(percobaanAktif ?? awalAktif),
  );

  // Aturan murni `deliveryOutcome` yang menentukan jeda: percobaan kedua
  // menjadwalkan +5 menit dari saat percobaan itu, dan percobaan itu terjadi
  // setelah jadwal pertama — jadi jadwal barunya tidak boleh lebih cepat.
  const jedaKeduaMs = DELIVERY_BACKOFF_MINUTES[1] * 60 * 1000;
  check(
    "jadwal percobaan berikutnya memakai aturan backoff, bukan angka baru",
    percobaanAktif !== null &&
      percobaanAktif.nextAttemptAt >= awalAktif.nextAttemptAt + jedaKeduaMs &&
      percobaanAktif.nextAttemptAt <= Date.now() + jedaKeduaMs,
    JSON.stringify({
      awal: awalAktif?.nextAttemptAt,
      sekarang: percobaanAktif?.nextAttemptAt,
      jedaMenit: DELIVERY_BACKOFF_MINUTES[1],
    }),
  );

  check(
    "penerima yang dimatikan tidak dikirimi lagi; kirimannya ditutup sebagai menyerah",
    dihentikan !== null &&
      dihentikan.attempts === 1 &&
      dihentikan.nextAttemptAt === null &&
      typeof dihentikan.lastError === "string" &&
      dihentikan.lastError.includes("dinonaktifkan"),
    JSON.stringify(dihentikan),
  );

  const akhir = await client.query(api.apiAccess.overview, { tenantId, actorId: userId });
  check(
    "ringkasan halaman mengikuti keadaan sebenarnya",
    akhir.summary.pendingDeliveries === 1 &&
      akhir.summary.failedDeliveries === 1 &&
      akhir.summary.activeEndpoints === 1,
    JSON.stringify(akhir.summary),
  );
}

try {
  await main();
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}`);
  console.log(`\n${results.length}/${results.length} checks passed against ${url}`);
} catch (error) {
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}`);
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
}

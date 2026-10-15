/**
 * Tests the offline-first outbox engine (src/lib/offline/outbox.ts).
 *
 * The critical property is that a sale taken offline is replayed with the SAME
 * idempotency key, which is what stops a reconnect from charging twice. To make
 * that observable, the fake transport records the keys it receives.
 *
 * Usage: bun scripts/verify-offline.mjs
 */
import { Outbox, OfflineError, MAX_ATTEMPTS } from "../src/lib/offline/outbox.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

/** In-memory storage that deep-copies, like a real persistent store would. */
function memoryStorage() {
  let entries = [];
  return {
    raw: () => entries,
    load: () => JSON.parse(JSON.stringify(entries)),
    save: (next) => {
      entries = JSON.parse(JSON.stringify(next));
    },
  };
}

function makeTransport() {
  const state = { online: true };
  const failing = new Set();
  const sent = [];
  const attempts = [];
  return {
    state,
    failing,
    sent,
    attempts,
    async send(entry) {
      attempts.push(entry.idempotencyKey);
      if (!state.online) throw new OfflineError();
      const sku = entry.payload?.sku;
      if (sku && failing.has(sku)) throw new Error(`Stok tidak cukup untuk produk ${sku}.`);
      sent.push(entry.idempotencyKey);
      return { number: `A-${String(sent.length).padStart(5, "0")}` };
    },
  };
}

// ------------------------------------------------------------------ scenario
// A till goes offline mid-shift, takes two sales, then reconnects.
{
  const storage = memoryStorage();
  const transport = makeTransport();
  const outbox = new Outbox({ storage, send: transport.send });

  transport.state.online = false;

  const first = outbox.enqueue({ sku: "KOPI", quantity: 2 });
  const second = outbox.enqueue({ sku: "ROTI", quantity: 1 });
  check("dua penjualan masuk antrean saat offline", outbox.size === 2 && outbox.pendingCount === 2, String(outbox.size));
  check("setiap entri punya idempotencyKey unik", first.idempotencyKey !== second.idempotencyKey);

  const offlineFlush = await outbox.flush();
  check("flush saat offline tidak mengirim apa pun", offlineFlush.sent === 0, String(offlineFlush.sent));
  check("flush melaporkan berhenti karena offline", offlineFlush.stoppedOffline === true);
  check("antrean tetap utuh", offlineFlush.remaining === 2, String(offlineFlush.remaining));
  check(
    "berhenti di entri pertama (tidak mencoba sisanya)",
    transport.attempts.length === 1,
    String(transport.attempts.length),
  );

  // Reconnect.
  transport.state.online = true;
  const onlineFlush = await outbox.flush();
  check("setelah tersambung kedua penjualan terkirim", onlineFlush.sent === 2, String(onlineFlush.sent));
  check("antrean kosong setelah sukses", outbox.size === 0, String(outbox.size));
  check(
    "KUNCI: kunci yang sama dipakai ulang saat replay (tidak bisa dobel-charge)",
    transport.sent.length === 2 &&
      transport.sent[0] === first.idempotencyKey &&
      transport.sent[1] === second.idempotencyKey,
    JSON.stringify({ sent: transport.sent, expected: [first.idempotencyKey, second.idempotencyKey] }),
  );
  check(
    "mengulang transaksi yang sama tidak menambah penjualan baru",
    (await outbox.flush()).sent === 0,
    "flush kedua harus mengirim 0",
  );
}

// ------------------------------------------------------------------ scenario
// One rejected order must never wedge the queue; it is retried, then parked.
{
  const storage = memoryStorage();
  const transport = makeTransport();
  const outbox = new Outbox({ storage, send: transport.send });

  transport.failing.add("RUSAK");
  const bad = outbox.enqueue({ sku: "RUSAK", quantity: 1 });
  const good = outbox.enqueue({ sku: "AMAN", quantity: 1 });

  const firstPass = await outbox.flush();
  check("pesanan yang ditolak tidak menghalangi yang berikutnya", firstPass.sent === 1, String(firstPass.sent));
  check("pesanan baik sudah terkirim", transport.sent[0] === good.idempotencyKey);
  check("pesanan ditolak masih menunggu", outbox.pendingCount === 1 && outbox.size === 1);

  // Persistence: a fresh instance over the same storage keeps the attempt count.
  let reloaded = new Outbox({ storage, send: transport.send });
  check("jumlah percobaan tersimpan di storage", reloaded.all[0].attempts === 1, String(reloaded.all[0].attempts));

  // Exhaust the retries.
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    reloaded = new Outbox({ storage, send: transport.send });
    await reloaded.flush();
  }
  check("setelah batas percobaan entri ditandai blocked", reloaded.blockedCount === 1 && reloaded.pendingCount === 0, JSON.stringify({ blocked: reloaded.blockedCount, pending: reloaded.pendingCount }));
  check("entri blocked menyimpan pesan kesalahan", Boolean(reloaded.all[0].lastError), reloaded.all[0].lastError);

  // Fix the cause and re-arm.
  transport.failing.delete("RUSAK");
  const rearmed = reloaded.retryBlocked();
  check("retryBlocked membuka kembali entri", rearmed === 1 && reloaded.blockedCount === 0, String(rearmed));

  const finalFlush = await reloaded.flush();
  check("setelah penyebab diperbaiki entri terkirim", finalFlush.sent === 1, String(finalFlush.sent));
  check("antrean bersih", reloaded.size === 0);
  check(
    "kunci asli tetap dipertahankan pada percobaan terakhir",
    transport.sent[transport.sent.length - 1] === bad.idempotencyKey,
  );
  check("tidak ada entri terkirim dua kali", new Set(transport.sent).size === transport.sent.length, JSON.stringify(transport.sent));
}

// ------------------------------------------------------------------ scenario
// Discarding and clearing.
{
  const storage = memoryStorage();
  const transport = makeTransport();
  const outbox = new Outbox({ storage, send: transport.send });
  transport.state.online = false;

  const entry = outbox.enqueue({ sku: "X", quantity: 1 });
  check("discard menghapus entri", outbox.discard(entry.id) === true && outbox.size === 0);
  check("discard entri tak dikenal mengembalikan false", outbox.discard("nope") === false);

  outbox.enqueue({ sku: "Y", quantity: 1 });
  outbox.clear();
  check("clear mengosongkan antrean dan storage", outbox.size === 0 && storage.raw().length === 0);
}

for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}`);
console.log(`\n${results.length}/${results.length} checks passed`);

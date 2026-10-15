/**
 * Membuktikan bahwa fungsi Convex benar-benar ada di sebuah deployment — hanya
 * dengan membaca: satu panggilan query publik yang tidak mengubah apa pun.
 *
 * Dipakai `scripts/build-hosted.sh` **setelah** `convex deploy` mengaku
 * berhasil. CLI bisa melaporkan sukses padahal kuncinya milik deployment lain,
 * jadi "selesai" dari CLI bukan bukti bahwa fungsi ada di deployment yang
 * dipakai aplikasi (`VITE_CONVEX_URL`). Skrip ini yang jadi buktinya.
 *
 * Usage:  node scripts/convex-verify-push.mjs <host-atau-url> [...]
 * Contoh: node scripts/convex-verify-push.mjs mellow-narwhal-477 \\
 *           https://mellow-narwhal-477.convex.cloud
 *
 * Keluaran: satu baris `DIAG verifikasi <host> fungsi=ada|hilang|tak-terhubung`
 * per target, lalu `PROBE_ADA=` / `PROBE_GAGAL=`. Exit 0 hanya kalau **semua**
 * target punya fungsi. Yang dicetak hanya nama host dan statusnya.
 */

const FUNCTION_PATH = "tenants:getBySlug";
const PAYLOAD = {
  path: FUNCTION_PATH,
  args: { slug: "__deploy_probe__" },
  format: "json",
};

const targets = process.argv.slice(2).filter((value) => value.trim().length > 0);

if (targets.length === 0) {
  console.log("DIAG verifikasi tidak ada target untuk diperiksa");
  process.exit(2);
}

if (typeof fetch !== "function") {
  console.log("DIAG verifikasi gagal: runtime node di sini tidak punya fetch (butuh Node 18+)");
  process.exit(2);
}

const toUrl = (target) => {
  if (/^https?:\/\//i.test(target)) return target.replace(/\/+$/, "");
  // Host lengkap (`<deployment>.convex.cloud`) maupun nama deployment saja
  // harus sama-sama bisa dipakai sebagai target.
  if (/\.convex\.(cloud|site)$/i.test(target)) return `https://${target}`;
  return `https://${target}.convex.cloud`;
};

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** "ada" | "hilang" | "tak-terhubung" */
async function statusOf(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${url}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(PAYLOAD),
      signal: controller.signal,
    });
    const body = await response.text();
    if (body.includes("Could not find public function")) return "hilang";
    // Kesalahan validasi/izin tetap berarti fungsinya ada.
    return response.ok || body.trim().length > 0 ? "ada" : "tak-terhubung";
  } catch {
    return "tak-terhubung";
  } finally {
    clearTimeout(timer);
  }
}

let failed = 0;
const ada = [];
const gagal = [];

for (const target of targets) {
  const url = toUrl(target);
  const host = hostOf(url);
  const status = await statusOf(url);
  console.log(`DIAG verifikasi ${host} (${FUNCTION_PATH}) fungsi=${status}`);
  if (status === "ada") ada.push(host);
  else gagal.push(`${host}:${status}`);
}

if (ada.length > 0) console.log(`PROBE_ADA=${ada.join(",")}`);
if (gagal.length > 0) {
  console.log(`PROBE_GAGAL=${gagal.join(",")}`);
  failed = 1;
}
process.exit(failed);

/**
 * Membaca *bentuk* kredensial Convex dari env `RAW_KEY` tanpa pernah mencetak
 * nilainya. Dipakai `scripts/build-hosted.sh` di builder hosting, di mana hanya
 * log build yang bisa dibaca.
 *
 * Keluaran:
 *   DIAG nilai len=… bentuk=jwt|jwt-json|base64url|base64url-json|opaque
 *              klaim=<nama klaim> sebut_convex=ya|tidak
 *   PROBE_NAME=<nama deployment>   nama berbentuk `kata-kata-angka` bila klaim
 *                                  menyebutkannya (bisa dipakai sebagai prefiks)
 *   PROBE_AS_TOKEN=ya|tidak        nilainya JWT, jadi lebih mungkin token akses
 *                                  (CONVEX_OVERRIDE_ACCESS_TOKEN) daripada kunci
 *
 * Yang tidak pernah dicetak: nilai `RAW_KEY` itu sendiri, dan isi klaim —
 * hanya nama klaimnya.
 *
 * Usage: RAW_KEY='…' node scripts/convex-key-probe.mjs
 */
const raw = process.env.RAW_KEY ?? "";

const isBase64Url = (s) => s.length > 0 && /^[A-Za-z0-9_-]+$/.test(s);

function decodeJson(segment) {
  try {
    const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** JWT asli, bukan sekadar teks yang kebetulan punya dua titik. */
const isJwt = (s) => {
  const parts = s.split(".");
  return parts.length === 3 && parts.every(isBase64Url) && decodeJson(parts[0]) !== null;
};

const shape = isJwt(raw) ? "jwt" : isBase64Url(raw) ? "base64url" : "opaque";
const claims = shape === "jwt" ? decodeJson(raw.split(".")[1]) : decodeJson(raw);
const bentuk = claims ? `${shape}-json` : shape;

/** Nama deployment Convex selalu berbentuk `kata-kata-angka`. */
const DEPLOYMENT_NAME = /^[a-z][a-z0-9]*-[a-z][a-z0-9]*-[0-9]+$/;

function collectStrings(value, depth = 0) {
  if (typeof value === "string") return [value];
  if (depth > 2 || value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap((entry) => collectStrings(entry, depth + 1));
}

const strings = claims ? collectStrings(claims) : [];
const name = strings.find((value) => DEPLOYMENT_NAME.test(value)) ?? "";
const text = claims ? JSON.stringify(claims).toLowerCase() : "";

const parts = [`len=${raw.length}`, `bentuk=${bentuk}`];
if (claims) {
  parts.push(`klaim=${Object.keys(claims).sort().join(",").slice(0, 160)}`);
  parts.push(`sebut_convex=${text.includes("convex") ? "ya" : "tidak"}`);
}
console.log(`DIAG nilai ${parts.join(" ")}`);
if (name) console.log(`DIAG nama_dari_klaim=${name}`);
console.log(`PROBE_NAME=${name}`);
console.log(`PROBE_AS_TOKEN=${shape === "jwt" ? "ya" : "tidak"}`);

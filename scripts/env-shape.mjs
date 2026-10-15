/**
 * Melaporkan **bentuk** nilai variabel environment tanpa pernah mencetak
 * nilainya. Dipakai untuk membedakan tiga hal yang mudah tertukar:
 *
 *   * nilai memang tidak diset              → `kosong`
 *   * nilai teks biasa (URL, flag)          → `url host=…` / `teks`
 *   * nilai masih berupa amplop terenkripsi → `amplop-terenkripsi`
 *
 * Amplop itu dikenali dari bentuknya: base64url dari JSON
 * `{"v":…,"c":…,"k":[…]}`, yaitu nilai yang dienkripsi platform dan tidak bisa
 * dipakai apa adanya oleh skrip build.
 *
 * Nama yang sudah jelas bukan rahasia (flag build/mode) ikut dicetak literalnya
 * supaya hasilnya bisa dibaca; nama lain tidak pernah.
 *
 * Usage: node scripts/env-shape.mjs NAME [NAME ...]
 */

/** Flag yang isinya memang bukan rahasia dan perlu terlihat di log build. */
const PUBLIC_NAMES = new Set(["VITE_DATA_SOURCE", "NODE_ENV", "CONVEX_DEPLOYMENT"]);

const names = process.argv.slice(2).filter((value) => /^[A-Z][A-Z0-9_]*$/.test(value));
if (names.length === 0) {
  console.log("DIAG env-shape tidak ada nama yang diminta");
  process.exit(0);
}

function classify(value) {
  if (!value) return { bentuk: "kosong" };
  if (/^https?:\/\//i.test(value)) {
    let host = value;
    try {
      host = new URL(value).host;
    } catch {
      /* host tetap nilai mentahnya */
    }
    return { bentuk: "url", host };
  }
  if (/^[A-Za-z0-9_=-]+$/.test(value)) {
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed).sort();
        if (keys.includes("c") && keys.includes("k")) {
          return { bentuk: "amplop-terenkripsi", klaim: keys.join(",") };
        }
        return { bentuk: "base64url-json", klaim: keys.join(",") };
      }
    } catch {
      /* bukan base64url JSON */
    }
  }
  return { bentuk: "teks" };
}

for (const name of names) {
  const value = process.env[name] ?? "";
  const info = classify(value);
  const parts = [`len=${value.length}`, `bentuk=${info.bentuk}`];
  if (info.host) parts.push(`host=${info.host}`);
  if (info.klaim) parts.push(`klaim=${info.klaim}`);
  if (PUBLIC_NAMES.has(name) && value.length > 0 && value.length <= 24) {
    parts.push(`nilai=${value}`);
  }
  console.log(`DIAG env ${name} ${parts.join(" ")}`);
}

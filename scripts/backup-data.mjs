/**
 * Backup data & berkas unggahan dari deployment Convex ke satu berkas ZIP.
 *
 * Kode aplikasi sudah dicadangkan di GitHub, tetapi **data** tidak ikut ke sana:
 * hidupnya di deployment Convex. Skrip ini yang membuat salinan lokalnya, dengan
 * satu perintah pendek supaya mencadangkan data tidak jadi pekerjaan yang mudah
 * dilupakan.
 *
 * Hasilnya: `backups/convex-<tanggal>.zip` — folder `backups/` diabaikan git, jadi
 * berkas backup tidak akan ikut ter-commit (skrip ini memeriksanya sendiri).
 *
 * Usage:
 *   bun scripts/backup-data.mjs                  # deployment dev (yang dipakai aplikasi ini)
 *   bun scripts/backup-data.mjs --prod           # deployment produksi default proyek
 *   bun scripts/backup-data.mjs --deployment <nama>
 *
 * Isi ZIP: dokumen semua tabel (`<tabel>/documents.jsonl`) + berkas unggahan
 * (`_storage/`). Memulihkannya: `bunx convex import <berkas.zip>`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BACKUP_DIR = "backups";

/** `2026-10-15-0456` — waktu lokal, supaya nama berkasnya bisa diurutkan. */
function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const day = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-");
  return `${day}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function megabytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

function run(command, args) {
  return spawnSync(command, args, {
    stdio: "inherit",
    // Windows menjalankan `bunx` sebagai skrip shell; Linux/macOS tidak perlu.
    shell: process.platform === "win32",
  });
}

function main() {
  const extraArgs = process.argv.slice(2);
  mkdirSync(BACKUP_DIR, { recursive: true });
  const target = join(BACKUP_DIR, `convex-${stamp()}.zip`);

  console.log(`Mencadangkan data Convex → ${target}`);
  const exported = run("bunx", [
    "convex",
    "export",
    "--include-file-storage",
    "--path",
    target,
    ...extraArgs,
  ]);

  if (exported.status !== 0) {
    console.error(
      `\nGAGAL: ekspor berhenti dengan status ${exported.status ?? "tidak diketahui"}. ` +
        "Tidak ada backup baru yang terpakai — berkas setengah jadi (kalau ada) sebaiknya dihapus.",
    );
    process.exit(1);
  }
  if (!existsSync(target)) {
    console.error(`GAGAL: ${target} tidak ada sesudah ekspor.`);
    process.exit(1);
  }
  const size = statSync(target).size;
  if (size === 0) {
    console.error(`GAGAL: ${target} kosong (0 byte).`);
    process.exit(1);
  }

  console.log(`\n✔ Backup selesai: ${target} (${megabytes(size)} MB)`);

  // Backup tidak boleh ikut ter-commit: buktikan git memang mengabaikannya.
  if (run("git", ["check-ignore", "-q", target]).status !== 0) {
    console.warn(
      `PERINGATAN: ${BACKUP_DIR}/ belum diabaikan git — tambahkan "${BACKUP_DIR}/" ke .gitignore ` +
        "supaya berkas backup tidak ikut ter-commit.",
    );
  }

  console.log(
    "\nCatatan:" +
      "\n  • Setiap ekspor juga menyimpan satu **snapshot di server Convex** (paket gratis: maksimal" +
      "\n    2 snapshot per deployment), jadi tidak perlu diekspor berkali-kali dalam sehari." +
      "\n  • Salinan ZIP-nya sengaja tidak diunggah ke mana-mana: simpan di luar workspace (drive awan" +
      "\n    atau perangkat lain) — backup di komputer yang sama tidak menolong kalau komputernya hilang." +
      `\n  • Pulihkan kalau perlu: bunx convex import ${target}` +
      "\n  • Kunci rahasia tidak bisa ikut berkas ini: catat di Settings → Environment (Freebuff) dan" +
      "\n    lihat nama kunci deployment dengan: bunx convex env list --names-only",
  );
}

main();

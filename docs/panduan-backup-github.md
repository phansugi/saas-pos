# Panduan backup project ini ke GitHub — langkah demi langkah untuk pemula

Panduan ini ditulis untuk yang belum biasa memakai Git/GitHub. Setiap langkah menyebut: **apa yang
dilakukan**, **perintah atau tombol persisnya**, dan **apa yang harus terlihat kalau berhasil**.
Kalau hasilnya berbeda dari yang tertulis, jangan lanjut — lihat bagian *Kalau ada masalah* di bawah.

## Istilah singkat (baca ini dulu)

| Istilah | Arti sederhana |
|---|---|
| **Git** | Alat pencatat versi di komputer ini yang mengingat setiap perubahan kode. |
| **GitHub** | Situs tempat salinan kode disimpan online — inilah "backup"-nya. |
| **Repo** | Folder project yang dilacak Git; repo ini bernama `saas-pos`. |
| **Commit** | Menyimpan perubahan ke catatan Git **di komputer ini**. Belum online. |
| **Push** | Mengirim commit itu ke GitHub supaya online. Ini yang membuat "ter-backup". |
| **Remote `origin`** | Alamat GitHub yang ditunjuk repo ini: `https://github.com/phansugi/saas-pos.git`. |
| **Terminal** | Kotak tempat mengetik perintah (di Freebuff ada panel Terminal). |
| **Panel Changes** | Panel Freebuff yang menampilkan daftar berkas berubah dan tombol commit/push. |

Analogi cepat: *commit* itu seperti menekan **Save** di buku catatan Git; *push* itu seperti
**meng-upload** buku itu ke GitHub. Kalau baru commit tapi belum push, cadangannya belum ada di GitHub.

## Keadaan sekarang (diperiksa 2026-10-15)

- Repo GitHub-nya sudah ada, dan alamat `origin` di sini sudah menunjuk ke sana dengan benar.
- Yang tersimpan di GitHub **baru `README.md`**. Seluruh kode (298 berkas: `src/`, `scripts/`,
  `public/`, `docs/`, `package.json`, dan seterusnya) belum pernah di-commit — jadi **belum punya
  cadangan**. (Angkanya bertambah seiring pekerjaan — yang penting ratusan, bukan belasan.)
- **Akses GitHub sudah berfungsi:** `git ls-remote origin refs/heads/main` menjawab
  `93f26551be840de713fe48b92590884779dad34e	refs/heads/main` (exit 0). Artinya Langkah 1 di bawah
  tidak perlu dilakukan lagi sekarang — simpan sebagai rujukan kalau suatu saat muncul penolakan izin.
- `origin/main` masih menunjuk commit yang **sama** dengan salinan lokal, jadi tidak ada yang perlu
  ditarik dulu; bisa langsung commit lalu push.

---

## Langkah 1 — pastikan Freebuff boleh menyentuh repo GitHub-nya

**Status: sudah beres per 2026-10-15.** Lakukan lagi hanya kalau perintah git yang butuh jaringan
menampilkan pesan ini:

```
Freebuff's GitHub App can't reach phansugi/saas-pos. Either the app was removed from that
repository, or the repository was renamed or deleted.
```

Itu **bukan** soal kunci/token yang perlu ditempel; Freebuff meminjamkan kredensialnya sendiri untuk
tiap perintah git. Yang perlu diperbaiki izinnya:

1. Buka GitHub → **Settings** → **Applications** → **Installed GitHub Apps** → **Freebuff**.
2. Pada **Repository access**, pastikan `phansugi/saas-pos` termasuk repo yang diizinkan.
3. Kalau aplikasinya tidak ada di daftar, sambungkan ulang repo-nya dari Freebuff.
4. Uji dari Terminal:

   ```bash
   git ls-remote origin refs/heads/main
   ```

   **Berhasil** = keluar satu baris berisi hash commit, misalnya
   `93f26551be840de713fe48b92590884779dad34e	refs/heads/main`, dan tidak ada pesan penolakan.

## Langkah 2 — kecualikan folder hasil build `isolate/` (sekali saja)

`isolate/` adalah salinan hasil build (`dist/`) yang disiapkan untuk hosting. Isinya **identik**
dengan `dist/` (11 berkas, 1,5 MB) dan tidak perlu ada di GitHub: kalau ikut, repo membesar sia-sia dan
tiap build menghasilkan "perubahan" palsu.

**Cek dulu (di Terminal):**

```bash
git check-ignore -v isolate
```

- Kalau **tidak ada output sama sekali** → memang belum diabaikan (keadaan sekarang); lanjutkan.
- Kalau keluar baris berisi `.gitignore:…:isolate` → sudah diabaikan; **lewati langkah ini**.

**Tambahkan pengecualiannya:**

1. Buka berkas `.gitignore` di daftar berkas Freebuff (berada di folder paling atas project).
2. Cari baris yang isinya `dist`.
3. Tambahkan satu baris baru tepat di bawahnya, isinya hanya:

   ```
   isolate
   ```

4. Simpan berkasnya (Save / `Ctrl+S`).

**Buktikan berhasil** — jalankan lagi:

```bash
git check-ignore -v isolate
```

Sekarang **harus** keluar baris seperti `.gitignore:2:isolate	isolate`. Folder `isolate/` tetap ada di
disk; yang berubah hanya statusnya bagi Git (tidak akan ikut ter-commit).

## Langkah 3 — periksa apa saja yang akan dikirim

Jalankan dua perintah ini di Terminal dan baca hasilnya:

```bash
git status --porcelain --ignored=matching | grep '^!!'
```

Baris berawalan `!!` adalah berkas yang **tidak** akan ikut. Hasil yang benar memuat:
`.convex/`, `.env.local`, `.vly-run/`, `dist/`, `node_modules/` — dan setelah Langkah 2, juga
`isolate/`. Yang paling penting: **`.env.local` ada di daftar itu**, artinya kunci rahasia lokal tidak
akan ter-upload.

```bash
git ls-files --others --exclude-standard | wc -l
```

Ini jumlah berkas yang akan ikut. Keadaannya: **298** (atau **287** setelah `isolate/` dikecualikan).
Angka yang wajar adalah ratusan; kalau angkanya cuma belasan, berarti ada yang salah. (Angka ini
bertambah tiap kali ada berkas baru, jadi yang penting urutan besarnya, bukan angka persisnya.)

Tidak ada berkas besar yang perlu dikhawatirkan di repo ini (berkas terlacak terbesar `README.md`,
232 KB; GitHub menolak berkas di atas 100 MB).

## Langkah 4 — commit lalu push

Ada dua cara. **Cara A** lebih ramah pemula; **Cara B** lebih terlihat apa yang terjadi.

### Cara A — lewat panel Changes Freebuff (tanpa mengetik perintah)

1. Buka panel **Changes** di Freebuff (daftar berkas yang berubah).
2. **Tinjau daftarnya**: harus berisi kode aplikasi — `src/`, `scripts/`, `public/`, `package.json`,
   `README.md`, `worklog.md`, `docs/`, dan seterusnya — **tanpa** `node_modules/`, `dist/`,
   `.convex/`, `.env.local`, dan tanpa `isolate/`. Kalau salah satu dari yang "tanpa" itu muncul,
   **berhenti** dan perbaiki `.gitignore` lebih dulu.
3. Tulis pesan commit di kotak yang tersedia, misalnya:
   `Backup awal: seluruh kode aplikasi MesinPOS`
4. Tekan tombol **commit/simpan** di panel itu. Setelah ini perubahan tersimpan di Git lokal.
5. Tekan tombol **push/sinkronkan** ke `origin main`. Setelah ini barulah kodenya ada di GitHub.

### Cara B — lewat Terminal (tiap baris dijelaskan)

Jalankan satu per satu, **berurutan**, dari atas ke bawah:

```bash
git add -A
```
Menandai semua berkas yang tidak diabaikan untuk ikut disimpan. `node_modules/`, `dist/`, `.convex/`,
`.env.local`, dan `isolate/` (setelah Langkah 2) otomatis **tidak** ikut.

```bash
git status -s | wc -l
```
Menghitung berapa baris berkas yang siap disimpan. Harusnya ratusan (sekitar 280–300). Kalau
angkanya `0`, tidak ada yang akan disimpan — berhenti dan periksa lagi.

```bash
git commit -m "Backup awal: seluruh kode aplikasi MesinPOS"
```
Menyimpan ke catatan Git lokal. Yang benar: keluar ringkasan seperti `287 files changed, …`.

```bash
git push -u origin main
```
Mengirim ke GitHub. Yang benar: baris berakhiran `-> main` dan
`branch 'main' set up to track 'origin/main'`. (`-u` hanya perlu sekali; berikutnya cukup `git push`.)

## Langkah 5 — buktikan backup-nya benar-benar ada

```bash
git status -sb
```
Baris pertama harus `## main...origin/main` — **tanpa** `[ahead N]` di belakangnya. Kalau ada
`[ahead N]`, berarti masih ada commit yang belum naik; ulangi push di Langkah 4.

```bash
git rev-parse HEAD
git ls-remote origin refs/heads/main
```
Dua perintah ini mengeluarkan hash commit. **Keduanya harus sama persis** (39 karakter). Kalau sama,
salinan di GitHub sudah identik dengan di sini.

Terakhir, buka `https://github.com/phansugi/saas-pos` di peramban: seluruh folder (`src/`, `scripts/`,
`public/`, …) harus terlihat, dan commit terbarunya yang tadi. **Inilah bukti backup-nya.**

## Kalau ada masalah

| Yang muncul | Artinya | Yang dilakukan |
|---|---|---|
| `Freebuff's GitHub App can't reach …` | Freebuff belum diizinkan ke repo itu | Kerjakan Langkah 1 |
| `nothing to commit, working tree clean` | Tidak ada perubahan baru untuk disimpan | Langsung ke `git push` (Langkah 4 Cara B) |
| `failed to push some refs` / `rejected` | Ada commit di GitHub yang belum ada di sini | **Jangan** pakai `--force`. Jalankan `git pull --rebase origin main`, lalu push lagi; kalau bingung, minta bantuan dulu |
| `Everything up-to-date` setelah push | Tidak ada yang perlu dikirim | Normal — cek Langkah 5 |
| Angka di Langkah 3 cuma belasan | Berkas kode tidak terbaca sebagai perubahan | Pastikan Terminal dijalankan di folder project (bukan folder lain) |

## Setelah backup pertama — rutinitas

- **Setiap selesai satu pekerjaan: commit + push.** Repo ini juga mewajibkan satu entri baru di
  `worklog.md` tiap pekerjaan (lihat `AGENTS.md`), jadi commit yang rapi biasanya berisi kode +
  entri worklog-nya.
- Sebelum menutup sesi, jalankan `git status -sb`. Kalau tertulis `[ahead N]`, ada yang belum naik.
- Jangan pakai `git push --force`, `git reset --hard`, atau `git clean -fd` di repo ini — bisa
  menghapus pekerjaan yang belum di-commit.
- GitHub adalah cadangan **kode** saja. Data produksi (database Convex di deployment
  `mellow-narwhal-477`, berkas unggahan, dan rahasia di Settings → Environment) **tidak** ikut
  ter-backup oleh langkah di atas dan perlu dicadangkan terpisah — lihat bagian berikutnya.

## Selain kode: data, berkas, dan kunci rahasia

GitHub menyimpan **kode**. Tiga hal ini tidak ikut dan punya caranya sendiri:

| Yang perlu dicadangkan | Di mana hidupnya | Cara paling mudah |
|---|---|---|
| **Data + berkas unggahan** (produk, penjualan, gambar produk, logo toko) | deployment Convex `mellow-narwhal-477` | tombol **Backup Now** di dashboard Convex, atau satu perintah `bun run backup:data` |
| **Kunci rahasia** (env lokal, env deployment Convex, Settings → Environment Freebuff) | di luar repo — sengaja | catat di pengelola kata sandi; nama kuncinya bisa dibaca dengan `bunx convex env list --names-only` |
| **Akun pihak ketiga** (GitHub, Convex, Resend, WhatsApp Cloud) | situs masing-masing | pastikan email pemulihan & verifikasi dua langkah aktif, simpan kuncinya di pengelola kata sandi |

Yang **tidak** perlu dicadangkan karena bisa dibuat ulang kapan saja: `node_modules/`, `dist/`,
`isolate/`, `.convex/`, dan sesi/riwayat demo di peramban (localStorage perangkat).

Daftar **nama** kunci rahasia proyek ini beserta tempat menyimpannya (env workspace, env deployment
Convex, env produksi) dan cara membuat ulang tiap kunci ada di
[`docs/daftar-kunci-rahasia.md`](./daftar-kunci-rahasia.md).

### Cara 1 — tombol di dashboard Convex (tanpa terminal)

1. Buka dashboard Convex → deployment `mellow-narwhal-477` → **Settings → Snapshots/Backups**
   (tautan ini yang dicetak perintah ekspor:
   <https://dashboard.convex.dev/d/mellow-narwhal-477/settings/snapshots>).
2. Tekan tombol backup (**Backup Now** menurut dokumentasi Convex), tunggu selesai, lalu **Download**.
3. Simpan berkasnya di luar workspace (drive awan atau perangkat lain).

Catatan paket: backup manual tersedia di paket gratis, tetapi **maksimal dua backup per deployment**
dan disimpan sekitar 7 hari; backup terjadwal otomatis butuh paket Pro
(<https://docs.convex.dev/database/backup-restore>).

### Cara 2 — satu perintah dari sini

```bash
bun run backup:data                 # deployment dev (yang dipakai aplikasi ini)
bun run backup:data --prod          # kalau proyek punya deployment produksi terpisah
```

Hasilnya `backups/convex-<tanggal>.zip` (sekitar 4 MB) berisi dokumen semua tabel
(`<tabel>/documents.jsonl`) **dan** berkas unggahan (`_storage/`). Folder `backups/` sudah diabaikan
git, jadi berkas backup tidak akan ikut ter-commit — skripnya sendiri yang memeriksa itu dan memberi
peringatan kalau belum.

Setiap ekspor juga menambah satu **snapshot di server Convex** (karena itu batas dua snapshot di atas
perlu diingat: tidak perlu mengekspor berkali-kali dalam sehari).

Memulihkan salinan: `bunx convex import backups/convex-<tanggal>.zip`. Menurut dokumentasi CLI Convex,
impor dari ZIP mempertahankan id dokumen dan waktu pembuatannya.

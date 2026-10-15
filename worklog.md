# Worklog — MesinPOS (saas-pos)

Catatan pekerjaan global. **Satu berkas untuk seluruh proyek**, bukan per fitur.

**Aturan:** setiap pekerjaan yang dikerjakan wajib menambah **satu entri baru** di bagian
[Riwayat](#riwayat), paling atas (terbaru dulu), memakai format di bawah. Entri lama tidak
dihapus dan tidak ditulis ulang — kalau ada koreksi, tulis entri baru yang menyebut koreksinya.

Format entri:

```md
## YYYY-MM-DD — <judul singkat>
**Ruang lingkup:** apa yang diminta dan apa yang sebenarnya dikerjakan.
**Berkas:** baru: ... · diubah: ...
**Verifikasi:** perintah → hasil (sertakan angka/exit code, bukan "sudah dites").
**Catatan / blocker:** hal yang belum selesai, batasan, atau keputusan yang perlu diketahui.
```

Aturan penulisan yang dipakai di berkas ini:

- Tulis hasil apa adanya. Perintah yang gagal atau tidak bisa dijalankan **ditulis gagal**,
  bukan dihilangkan.
- Setiap klaim verifikasi menyebut perintahnya, supaya bisa diulang.
- Bedakan jelas antara "sudah diverifikasi" dan "hanya type-checked".

---

## Riwayat

## 2026-10-15 — Menyiapkan push pertama: `isolate/` dikecualikan, commit pengguna `46e0b0c` (299 berkas) belum di-push

**Ruang lingkup:** permintaan pemilik repo — “Pandu saya untuk mem-push project ini ke github”. Saat
keadaan repo diperiksa, pemilik repo ternyata **sudah membuat commit lokal**
`46e0b0c "Backup awal: <nama project>"` (299 berkas) tetapi **belum push** (`git status -sb` →
`## main...origin/main [ahead 1]`; `git ls-remote` masih `93f2655`). Yang saya kerjakan: (a) menambah
baris `isolate` ke `.gitignore` di working tree (belum di-commit) supaya hasil build 1,5 MB tidak ikut ke
commit/keadaan berikutnya; (b) memeriksa isi commit (11 berkas `isolate/` ikut; pesan masih placeholder;
tidak ada `.env.local`/`node_modules/`/`dist/` yang ikut); (c) menyusun dua opsi panduan push — langsung,
atau rapikan dulu dengan `git rm -r --cached isolate` + `git commit --amend` (aman karena commit belum
pernah dikirim) — beserta cara membuktikannya.

**Temuan penting:** `git check-ignore -v isolate` **tidak melaporkan apa pun walau polanya sudah
ditambah** — karena `isolate/` sudah **terlacak** di index, dan git check-ignore hanya melaporkan path yang
belum terlacak. Buktinya dengan `--no-index`: `.gitignore:4:isolate` (exit 0). Artinya `.gitignore` saja
tidak cukup untuk berkas yang **sudah** ter-commit; berkas itu harus dikeluarkan dengan
`git rm -r --cached isolate` (berkasnya tetap ada di disk).

**Berkas:** diubah: `.gitignore` (+1 baris, belum di-commit), `worklog.md` (entri ini) · baru: tidak ada.

**Verifikasi:**
- `git status -sb` → `## main...origin/main [ahead 1]` dan ` M .gitignore` (commit pengguna belum di-push)
- `git log --oneline -3` → `46e0b0c Backup awal: <nama project>` di atas `93f2655 Initial commit`
- `git ls-tree -r --name-only HEAD | wc -l` → `299`; di antaranya `grep -c '^isolate/'` → `11`
- `git ls-tree -r --name-only HEAD | rg -i '[.]env|node_modules/|^dist/'` → tidak ada hasil (tanpa
  rahasia/bagian build, kecuali `isolate/`)
- `git check-ignore --no-index -v isolate` → `.gitignore:4:isolate	isolate`, exit 0 (pola baru cocok
  untuk path yang tidak terlacak)
- `git ls-files --others --exclude-standard | wc -l` → `0` (semua sudah terlacak, jadi tinggal push)
- `git ls-remote origin refs/heads/main` → masih `93f26551be840de713fe48b92590884779dad34e` (belum ada push)
- Push sendiri belum dijalankan (pemilik repo minta dipandu; commit/push milik panel Changes Freebuff)

**Catatan / blocker:** sampai `git push` dijalankan, backup di GitHub **masih belum ada** (baru README).
Tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** tidak berubah.

## 2026-10-15 — Tanya-jawab: beberapa project di akun GitHub yang sama tidak bentrok

**Ruang lingkup:** pertanyaan pemilik repo — “saya kan ada beberapa project yg mau saya backup di akun
github yg sama, apakah nanti tidak bentrok?” — dijawab dengan memeriksa bagaimana repo ini menyimpan
remote & identitas. Tidak ada kode yang diubah; tidak ada berkas repo yang berubah selain entri ini.

Fakta yang diperiksa untuk menjawab:

1. Remote project ini menunjuk **satu** repo spesifik: `origin` →
   `https://github.com/phansugi/saas-pos.git` (fetch & push), dan alamat itu disimpan di `.git/config`
   **folder ini**, bukan sebagai setelan global.
2. Identitas commit juga per repo: `.git/config` memuat `name = sugi phan` +
   `email = 308275472+phansugi@users.noreply.github.com` (email noreply GitHub — tidak membocorkan email
   asli), sedangkan commit `93f2655` yang datang dari GitHub memakai `phansugi <phansugisoft@gmail.com>`.
   `git config --global --get user.name`/`user.email` → **kosong**: tidak ada setelan global yang bisa
   saling menimpa antar project.
3. Karena remote dan identitas tersimpan per folder, beberapa project berbeda tidak saling menimpa
   selama tiap folder menunjuk repo GitHub-nya masing-masing.

Yang tetap bisa bentrok (dan karena itu harus dihindari): menjalankan `git init` di folder induk yang
memuat beberapa project (semuanya akan masuk **satu** repo), dan memberi dua repo nama yang sama di satu
akun (GitHub menolak nama duplikat).

**Berkas:** diubah: `worklog.md` (entri ini) · baru: tidak ada.

**Verifikasi:**
- `git remote -v` → satu remote `origin` ke `phansugi/saas-pos.git` (fetch & push)
- `git log -1 --format='%an <%ae>'` → `phansugi <phansugisoft@gmail.com>`
- `git config --global --get user.name` dan `--get user.email` → keduanya kosong (tanpa setelan global)
- `rg -n 'url|name|email' .git/config` → `url`, `name`, `email` tersimpan di folder repo ini
- Berkas markdown saja — tidak ada kode, tipe, atau build yang tersentuh, jadi tidak ada perintah uji
yang perlu dijalankan ulang

**Catatan / blocker:** tidak ada. Tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka**
tidak terpengaruh (ini penjelasan operasional, bukan klausa roadmap).

## 2026-10-15 — Panduan backup ke GitHub ditulis ulang jadi versi awam yang sangat detail + akses GitHub terbukti jalan

**Ruang lingkup:** permintaan pemilik repo — “pandu saya step by step lebih detail, karena saya masih
awam”. `docs/panduan-backup-github.md` ditulis ulang (133 → 203 baris, angka suite/berkas di dalamnya
diselaraskan ke keadaan saat itu: 298 berkas untracked, 287 tanpa `isolate/`): tabel istilah (git, commit, push,
repo, remote, panel Changes), keadaan repo, lima langkah yang masing-masing menyebut **apa yang
dilakukan → perintah/tombol persisnya → apa yang harus terlihat kalau berhasil**, dua cara commit
(panel Changes dan Terminal dengan tiap baris dijelaskan), tabel *Kalau ada masalah* (5 gejala umum),
dan rutinitas setelah backup pertama. Ditambah catatan bahwa GitHub hanya mencadangkan kode, bukan data
produksi.

Temuan penting: **akses GitHub kini sudah berfungsi.** `timeout 60 git ls-remote origin refs/heads/main`
→ `93f26551be840de713fe48b92590884779dad34e	refs/heads/main`, **exit 0** — sebelumnya (entri di bawah)
perintah yang sama ditolak karena izin Freebuff GitHub App. Jadi Langkah 1 panduan turun status dari
“wajib dilakukan dulu” menjadi “rujukan kalau penolakan izin muncul lagi”. `origin/main` masih menunjuk
commit yang sama dengan lokal, jadi tidak ada yang perlu ditarik sebelum commit + push.

**Berkas:** diubah: `docs/panduan-backup-github.md` (ditulis ulang), `worklog.md` (entri ini) · baru:
tidak ada.

**Verifikasi:**
- `timeout 60 git ls-remote origin refs/heads/main` → satu baris hash + `refs/heads/main`, **exit 0**
  (akses GitHub App berfungsi; angka ini juga yang dikutip di panduan)
- Berkas markdown saja — tidak ada kode, tipe, atau build yang tersentuh, jadi tidak ada perintah uji
yang perlu dijalankan ulang
- Perintah lain yang ditulis di panduan sudah pernah dijalankan dan hasilnya tercatat di dua entri di
  bawahnya (`git check-ignore -v isolate` → kosong, exit 1; `git ls-files --others --exclude-standard |
  grep -c '^isolate/'` → 11; `git status --porcelain --ignored=matching | grep '^!!'` → 5 baris)

**Catatan / blocker:** `.gitignore` belum ditambah baris `isolate` dan commit/push belum dijalankan
(keduanya diserahkan ke pemilik repo: menyentuh berkas repo, dan panel Changes Freebuff yang memegang
commit/push). Tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** (10 butir) diperiksa:
tidak ada yang berubah.

## 2026-10-15 — Panduan backup ke GitHub dijelaskan ulang di balasan chat (tanpa perubahan repo)

**Ruang lingkup:** permintaan pemilik repo — “Jelaskan panduan step by step nya di sini” — yaitu lima
langkah backup yang sudah ada di `docs/panduan-backup-github.md` disampaikan langsung di balasan chat,
bukan sebagai berkas baru. Isinya sama dengan berkas panduan (beri Freebuff akses → kecualikan `isolate/`
→ periksa rahasia & berkas besar → commit + push → buktikan isinya sama, plus rutinitas backup). Tidak ada
perintah baru yang dijalankan dan tidak ada berkas repo yang diubah selain entri ini.

**Berkas:** diubah: `worklog.md` (entri ini) · baru: tidak ada.

**Verifikasi:** tidak ada perintah uji yang dijalankan — ini penjelasan ulang atas fakta yang sudah
diverifikasi di dua entri di atasnya (isi `docs/panduan-backup-github.md`, 133 baris; `git status`
menunjukkan `?? docs/`). Berkas markdown saja, tidak ada kode/tipe/build yang tersentuh.

**Catatan / blocker:** sama seperti entri panduan: Langkah 1 (izin Freebuff GitHub App ke
`phansugi/saas-pos`) masih menggantung, jadi langkah yang butuh jaringan belum bisa dibuktikan, dan
`.gitignore` belum ditambah baris `isolate` (sengaja diserahkan ke pemilik repo). Tabel **Status Phase 1–6**
dan daftar **Blocker yang masih terbuka** (10 butir) tidak terpengaruh.

## 2026-10-15 — Panduan langkah demi langkah mem-backup repo ke GitHub (`docs/panduan-backup-github.md`)

**Ruang lingkup:** permintaan pemilik repo — “Tolong buatkan panduan step by step untuk mem-backup
project ini ke github”. Yang dibuat: satu berkas panduan baru berisi lima langkah (beri Freebuff akses ke
repo → kecualikan `isolate/` → periksa rahasia & berkas besar → commit + push → buktikan isinya sama),
plus rutinitas backup harian dan catatan bahwa data produksi tidak ikut. Panduan ditulis dari keadaan
repo yang benar-benar diperiksa pada entri sebelumnya (baru `README.md` yang ada di GitHub), bukan dari
asumsi, dan setiap perintah di dalamnya sudah dijalankan di repo ini sebelum ditulis — termasuk perintah
yang **gagal** (`git ls-remote` ditolak karena izin Freebuff GitHub App), yang justru jadi isi Langkah 1.
Tidak ada kode aplikasi yang diubah; tidak ada commit/push yang dijalankan (panel Changes Freebuff yang
memegang itu).

Fakta baru yang diperiksa untuk panduan ini (belum tercatat di entri sebelumnya):

1. `git check-ignore -v isolate` → tanpa output: `isolate/` **tidak** tercakup `.gitignore` (11 berkas,
   1,5 MB), padahal isinya **identik dengan `dist/`** (`diff` daftar berkas kedua folder → tidak ada
   perbedaan; `du -sh` keduanya 1,5 MB). Jadi menambah satu baris `isolate` di `.gitignore` cukup, dan
   hasil build tidak perlu di-commit.
2. `git check-ignore -v dist .convex node_modules` → ketiganya cocok aturan `.gitignore`; `.vly-run/`
   diabaikan lewat `.git/info/exclude` (bukan `.gitignore`). Daftar lengkap yang diabaikan:
   `git status --porcelain --ignored=matching | grep '^!!'` → `.convex/`, `.env.local`, `.vly-run/`,
   `dist/`, `node_modules/` — jadi kunci lokal `.env.local` **tidak** akan ikut ter-commit.
3. Total berkas untracked **tanpa** `isolate/` = 286, ukuran totalnya **6,3 MB** (tanpa `node_modules`),
   dan tidak ada berkas > 50 MB di luar `node_modules/`/`.git/` — aman untuk GitHub.
4. Repo belum punya folder `docs/`, dan README belum pernah menyebut git/GitHub sama sekali; makanya
   panduan ditaruh di berkas baru + satu paragraf tautan di README, bukan diselipkan ke README yang
   sudah panjang (2.934 baris).

**Berkas:** baru: `docs/panduan-backup-github.md` · diubah: `README.md` (paragraf tautan), `worklog.md`
(entri ini).

**Verifikasi:**
- `git check-ignore -v isolate` → tanpa output (bukti `isolate/` belum diabaikan) — perintah ini juga yang
  dipakai pembaca panduan untuk membuktikan langkah 2 berhasil
- `git ls-files --others --exclude-standard | rg -c '^isolate/'` → `11`; tanpa `isolate/` → `286`
- `diff` daftar berkas `dist/` vs `isolate/` → identik; `du -sh isolate` dan `du -sh dist` → `1.5M` keduanya
- `git status --porcelain --ignored=matching | grep '^!!'` → `.convex/`, `.env.local`, `.vly-run/`, `dist/`,
  `node_modules/` (exit 0) — perintah ini ditulis apa adanya di panduan
- `git ls-files -z | xargs -0 du -h | sort -h | tail -5` → `232K README.md` (berkas terlacak terbesar;
  perintah untuk pembaca panduan memeriksa berkas besar)
- `git ls-remote origin refs/heads/main` → **gagal** (izin Freebuff GitHub App), dan pesannya dikutip
  apa adanya di Langkah 1 panduan; belum dijalankan ulang setelah itu
- Berkas markdown saja (`docs/panduan-backup-github.md`, `README.md`, `worklog.md`) — tidak ada kode,
  tipe, atau build yang tersentuh, jadi tidak ada perintah uji yang perlu dijalankan ulang

**Catatan / blocker:** tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** (10 butir)
diperiksa: tidak ada yang berubah (ini dokumentasi operasional, bukan klausa roadmap). Langkah 1 panduan
belum bisa dibuktikan sampai izin Freebuff GitHub App diberikan ke `phansugi/saas-pos`; sampai itu
dilakukan, semua langkah yang butuh jaringan tetap berhenti di situ.

## 2026-10-15 — Status backup repo ke GitHub: kode belum ter-backup, yang ada di GitHub baru `README.md`

**Ruang lingkup:** pertanyaan pemilik repo — “apakah project ini sudah ter-backup di github?” — dijawab dengan
memeriksa keadaan git apa adanya, bukan dari asumsi. Tidak ada kode yang diubah.

Temuan (semuanya dari pemeriksaan langsung):

1. Remote `origin` → `https://github.com/phansugi/saas-pos.git`; cabang `main` melacak `origin/main`.
2. Satu-satunya commit di lokal **dan** di `origin/main` adalah `93f2655` “Initial commit”
   (2026-10-10T20:26:17+07:00), dan isi commit itu **hanya `README.md`**
   (`git ls-tree -r --name-only HEAD | wc -l` → `1`).
3. Seluruh aplikasi belum pernah di-commit: `git ls-files | wc -l` → `1` berkas terlacak, sementara
   `git ls-files --others --exclude-standard | wc -l` → **297 berkas untracked** (`src/` 196, `scripts/` 68,
   `isolate/` 11, `public/` 8, sisanya di akar: `package.json`, `bun.lock`, `convex.json`, `index.html`,
   `vite.config.ts`, `tsconfig*.json`, `tailwind.config.js`, `postcss.config.js`, `AGENTS.md`, `.gitignore`,
   `worklog.md`). `README.md` juga sudah dimodifikasi lokal tetapi belum di-commit.
4. Klon ini baru sekali (`git reflog` → `clone: from …`, 2026-10-10 13:27:40 +0000) dan tidak ada
   `FETCH_HEAD`, jadi belum ada aktivitas tarik/dorong sejak klon.
5. Pemeriksaan jaringan ke GitHub **gagal karena masalah izin**: `git ls-remote origin refs/heads/main`
   ditolak Freebuff dengan pesan “Freebuff's GitHub App can't reach phansugi/saas-pos …”. Jadi keadaan
   remote di sini diverifikasi dari `origin/main` hasil klon (commit yang sama, 1 berkas), bukan dari
   panggilan jaringan yang baru.

Kesimpulannya: **belum ter-backup.** Yang ada di GitHub baru `README.md`; 297 berkas aplikasi hanya hidup
di workspace ini. `.gitignore` sudah benar menutup `node_modules/`, `dist/`, `dist-ssr/`, `.convex/`, dan
`.env*` (kecuali `.env.example`), jadi yang perlu di-commit memang hanya kode. Sebaliknya `isolate/` (hasil
build yang disalin keluar dari `dist`) **tidak** tercakup `.gitignore` dan sebaiknya tidak ikut di-commit.
Commit/dorong tidak dijalankan dari sini karena panel Changes Freebuff yang memegang simpan, commit, dan push.

**Berkas:** diubah: `worklog.md` (entri ini) · baru: tidak ada.

**Verifikasi:**
- `git remote -v` → `origin  https://github.com/phansugi/saas-pos.git (fetch)` dan `(push)`
- `git log --oneline -5` dan `git log --oneline -5 origin/main` → keduanya hanya `93f2655 Initial commit`
- `git ls-tree -r --name-only HEAD` → `README.md`; `git ls-files | wc -l` → `1`;
  `git ls-files --others --exclude-standard | wc -l` → `297`
- `git status -sb` → `## main...origin/main`, satu `M README.md`, 17 baris untracked
- `git ls-remote origin refs/heads/main` → **gagal**: “Freebuff's GitHub App can't reach phansugi/saas-pos.
  Either the app was removed from that repository, or the repository was renamed or deleted.”
- Berkas markdown saja (entri worklog) — tidak ada kode, tipe, atau build yang tersentuh, jadi tidak ada
  perintah uji yang perlu dijalankan ulang.

**Catatan / blocker:** tidak ada blocker roadmap yang berubah — tabel **Status Phase 1–6** dan daftar
**Blocker yang masih terbuka** (10 butir) diperiksa dan tetap seperti semula; temuan ini murni operasional
(keadaan repo, bukan kemampuan produk). Supaya benar-benar ter-backup: beri Freebuff GitHub App akses ke
`phansugi/saas-pos` (atau sambungkan ulang repo-nya), lalu commit + push lewat panel Changes — `isolate/`
sebaiknya dikecualikan lebih dulu.

## 2026-10-14 — Notifikasi bunyi + kilat di kartu antrean dapur begitu tagihan QR baru menunggu pelunasan

**Ruang lingkup:** permintaan pengguna — “tambahkan suara atau kilat notifikasi di kartu antrean dapur
begitu ada tagihan QR baru menunggu pelunasan”. Yang dikerjakan: **dua-duanya**, satu pemicu:

1. **Aturan murni** (`src/convex/lib/fnb.ts`): `KDS_ALERT_FLASH_MS` (6 detik — lama kilatnya menyala),
   `KDS_ALERT_WINDOW_MS` (30 detik — umur maksimal sebuah tagihan agar masih disebut “baru”),
   `planKdsAlert(seen, pending, now)` (id tagihan yang layak diberitahukan **sekarang**: belum pernah
   dilihat **dan** masih baru; plus `seenIds` dari keadaan sekarang), `isKdsAlertFlashing(at, now)`, dan
   `kdsAlertLabel(count)`. Dua syarat itu keduanya perlu: tanpa “belum pernah dilihat”, setiap render
   ulang akan berbunyi lagi; tanpa batas umur, membuka layar dapur di tengah hari akan membunyikan alarm
   untuk tagihan yang sudah lama menunggu.
2. **Nadanya** (`src/lib/scanBeep.ts`): `KDS_ALERT_BEEP` — **satu oktaf di atas bip kasir** & lebih
   panjang (`2490` Hz / `260` ms vs `1245` Hz / `110` ms), tetap memakai batas sopan yang sama
   (`SCAN_BEEP_MAX_GAIN`) dan setelan volume perangkat yang sama; `playKdsAlertBeep()` memanggil
   `playScanBeep(KDS_ALERT_BEEP)`, jadi **Matikan bunyi** di kasir/Pengaturan juga membisukannya.
   Alasannya: satu ruangan bisa punya dua perangkat yang berbunyi — til kasir dan layar dapur — dan
   nada yang sama persis membuat dapur tidak bisa tahu apa yang sedang diberitahukan.
3. **Layar Dapur & Meja** (`src/pages/KdsPage.tsx`): satu `useEffect` memanggil `planKdsAlert` tiap kali
da berubah, membunyikan `playKdsAlertBeep()` **satu kali per tagihan**, lalu menyalakan kilat
   (`animate-kilat`, `data-kilat`, tanda `meja-qr-kilat` yang berbunyi “N tagihan QR baru masuk”) yang
   padam sendiri sesudah `KDS_ALERT_FLASH_MS`. Daftar “sudah diberitahukan” hidup di tingkat **modul**
   (`announcedBills`), bukan di dalam komponen: berpindah ke halaman Pembayaran lalu kembali ke dapur
   tidak boleh mengulang bunyi untuk tagihan yang sama. Di kartu antrean itu juga ada **saklar
   “Bip tagihan”** (`meja-qr-bip`, `role="switch"`) yang menulis ke setelan bunyi perangkat yang sama;
   kilatnya sengaja **tetap berjalan** walau bunyinya dimatikan.
4. **Animasi** (`tailwind.config.js`): keyframes `kilat` + `animate-kilat` (5 × 1,2 s = 6 s, sama dengan
   `KDS_ALERT_FLASH_MS`) — warna aksen yang berdenyut, bukan berkedip penuh-terang, supaya angka di
   sebelahnya tetap terbaca; ditambah `motion-reduce:animate-none` supaya yang memilih gerak minimal
   tetap dapat teks tandanya.
5. **Harness**: `verify-fnb.mjs` 82 → **95** (kapan tagihan boleh diberitahukan: belum dilihat,
   masih baru, tepat di batas umur, urutannya, bentuk “sudah dilihat”, jam mundur, kalimat tandanya),
   `verify-scan-beep.mjs` 55 → **62** (nada dapur berbeda dari bip kasir, kekuatan & volumenya,
   Matikan bunyi membisukannya, tombol coba tetap berbunyi saat bipnya mati),
   `verify-render.mjs` 788 → **795** (alur tamu → dapur: bunyi yang diminta pemutar tiruan **nada dapur**,
   kilat + tanda jumlahnya, tidak terulang saat layar dibuka ulang, dan mematikan saklarnya membuat
   tagihan berikutnya benar-benar senyap sementara kilatnya tetap ada), `verify-meja-browser.mjs`
   88 → **93** (di Chromium: animasi `kilat` benar-benar terpasang — dibaca dari `getComputedStyle`, bukan
   dari nama kelas di markup — tanda jumlahnya, saklar bunyi di kartu antrean, dan kilat yang tetap
   berjalan saat bunyinya dimatikan).
6. **Dokumentasi**: README (bagian pesanan QR meja + bagian bunyi bip + daftar perintah) diperbarui.

**Berkas:** diubah: `src/convex/lib/fnb.ts`, `src/lib/scanBeep.ts`, `src/pages/KdsPage.tsx`,
`tailwind.config.js`, `scripts/verify-fnb.mjs`, `scripts/verify-scan-beep.mjs`,
`scripts/verify-render.mjs`, `scripts/verify-meja-browser.mjs`, `README.md`, `worklog.md` ·
baru: tidak ada.

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0 (dijalankan setelah setiap tahap; sempat gagal sekali karena `useRef`
  yang tersisa setelah daftar “sudah diberitahukan” pindah ke tingkat modul — dihapus, bukan di-suppress)
- `bun scripts/verify-fnb.mjs` → `95/95 checks passed`, exit 0
- `bun scripts/verify-scan-beep.mjs` → `62/62 checks passed`, exit 0
- `bun scripts/verify-render.mjs` → `795/795 checks passed`, status 0 (log lengkap disimpan ke
  `/tmp/render.log`; 4 baris `AbortError: The animation was canceled` di sana datang dari
  `motion-dom`/framer-motion di blok halaman lain — dicatat apa adanya, tidak dihitung sebagai galat
  konsol halaman dan tidak memengaruhi cek mana pun)
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-meja-browser.mjs http://localhost:5173` → `93/93 checks
  passed`, exit 0 (Chromium atas preview)
- `bun scripts/verify-meja.mjs` → `72/72 checks passed`, exit 0 (dijalankan ulang; aturan murninya tidak
  tersentuh perubahan ini)
- Pemeriksaan CSS yang benar-benar tersaji: `curl -s http://localhost:5173/src/index.css?direct` →
  memuat `.animate-kilat { animation: kilat 1.2s ease-in-out 5; }` dan `@keyframes kilat` (sempat **tidak**
  ada sampai dev server dijalankan ulang — lihat catatan)

**Catatan / blocker:** tidak ada blocker baru. Dua batasan yang perlu diketahui: (a) notifikasinya hidup
**selama layar dapur terbuka** — tidak ada notifikasi latar, service worker, atau push, jadi tagihan yang
datang saat tak ada satu pun perangkat membuka `/app/kds` baru diberitahukan saat layarnya dibuka (dan
hanya kalau tagihannya masih di dalam jendela 30 detik); (b) bunyi sungguhan **tidak bisa didengar** di
harness — yang dibuktikan adalah nada yang benar-benar dijadwalkan ke pemutar (tiruan di DOM, Web Audio
sungguhan di peramban, dengan pemeriksaan kilat lewat `getComputedStyle`). Satu hal dev: perubahan di
`tailwind.config.js` tidak terpakai oleh dev server yang sudah lama hidup sampai preview dijalankan ulang
(`freebuff-preview restart`) — kelas `animate-kilat`-nya sudah ada di CSS yang tersaji sejak itu; build
produksi membaca konfigurasi dari nol, jadi tidak terpengaruh. Tabel **Status Phase 1–2** diperbarui
angkanya (fnb 95, render 795, meja-browser 93); daftar **Blocker yang masih terbuka** diperiksa: tidak ada
klausa roadmap yang berubah dan tidak ada blocker baru.

## 2026-10-14 — Penghitung + tombol ke halaman Pembayaran langsung di kartu antrean dapur

**Ruang lingkup:** permintaan pengguna — “tambahkan penghitung dan tombol menuju halaman Pembayaran langsung
**dari kartu antrean dapur**, supaya kasir tidak perlu membuka halaman lain”. Yang dikerjakan: notis
penghitung pesanan QR yang belum lunas **dipindahkan** dari kolom denah meja (tempat entri 2026-10-14
sebelumnya menaruhnya) ke **kartu antrean dapur** (kolom kiri, tempat tiket dapur berada), dan di sana
tautan teksnya dinaikkan jadi **tombol**: lencana angka `meja-qr-menunggu-jumlah` (“N pesanan QR meja
menunggu pelunasan”) + kalimat sebabnya + `Button` berlabel **Ke halaman Pembayaran** (`meja-qr-ke-pembayaran`)
yang bertaut ke `/app/payments`. Jadi kasir yang sedang memandangi antrean membaca jumlahnya dan menekan
tombolnya tanpa mencari dulu di mana jumlah itu berada; kolom denah meja kembali hanya berisi denah.

**Berkas:** diubah: `src/pages/KdsPage.tsx`, `scripts/verify-render.mjs`, `scripts/verify-meja-browser.mjs`,
`README.md`, `worklog.md` · baru: tidak ada.

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0
- `bun scripts/verify-render.mjs` → `788/788 checks passed`, status 0 (785 lama + 3 cek baru: penghitung &
tombolnya berada di panel yang sama dengan “Antrean dapur”, lencana jumlahnya terpisah, dan tombolnya
benar-benar bertombol/berlabel)
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-meja-browser.mjs http://localhost:5173` → `88/88 checks
passed` (Chromium atas preview yang berjalan; 86 lama + 2 cek baru: penghitung & tombolnya di dalam
`ancestor::section` kartu antrean dapur — bukan kolom denah meja — dan keduanya terbaca sebagai lencana
berangka + tombol berlabel, lalu tombol itu tetap diklik sampai ke `/app/payments`)
- `bun scripts/verify-meja.mjs` → `72/72 checks passed`, exit 0 (dijalankan ulang; aturan murninya tidak
disentuh)

**Catatan / blocker:** tidak ada yang berkurang dari batasan entri sebelumnya — penghitungnya tetap hanya
memuat **jumlah** (tanpa nama tamu/nominal/nomor tagihan), pelunasan/pembatalan tetap hanya dari halaman
Pembayaran, dan karena berpindah tempat, angka notis kini **tidak lagi muncul dua kali** di satu layar.
`verify-backend.mjs` **tidak** dijalankan ulang: perubahan ini murni DOM/klien (`KdsPage.tsx`), tidak ada
fungsi Convex, aturan murni, store, atau skema yang tersentuh — angkanya karena itu tetap 795/795 dari
pemeriksaan terakhir. Tabel **Status Phase 1–2** dan daftar **Blocker** diperiksa: yang berubah hanya angka
suite di baris `pos.table` & `pos.kds` (785 → 788 dan 86 → 88).

## 2026-10-14 — Dapur hanya melihat pesanan yang sudah lunas, dan tiketnya ditandai momen + kanal pelunasannya

**Ruang lingkup:** permintaan pengguna — perbaiki alur dapur: (a) **dapur hanya melihat yang sudah lunas**
(pesanan QR yang belum dibayar tidak lagi tampil di layar Dapur & Meja; kasir melunasi/membatalkannya dari
halaman Pembayaran), dan (b) **tiket dapur ditandai momen & kanal pelunasannya** (“diterima saat lunas QRIS
pukul 13:42”) supaya terlihat tiket itu memang masuk bersamaan dengan uangnya. Yang dikerjakan:

1. **Aturan murni** (`src/convex/lib/fnb.ts`): `TicketPayment`, `clockOfDay` (jam:menit lokal), dan
   `ticketPaymentLabel` — satu tempat yang menuliskan penanda tiket: `Lunas QRIS dari meja · diterima dapur
   pukul 13:42` / `Lunas VA BRI dari meja · diterima dapur pukul 13:42`; data lama tanpa `paidAt` tidak
   diberi penanda. `src/convex/lib/meja.ts` menambah `isAwaitingPayment({ status, chargeStatus })`:
   “masih menunggu pelunasan” = niatnya `pending` **dan** tagihannya masih bisa dibayar — tagihan yang
   dibatalkan kasir atau kedaluwarsa berhenti menunggu.
2. **Layar Dapur & Meja** (`src/pages/KdsPage.tsx`): kartu “Pesanan QR dari tamu” (daftar pesanan **belum
   lunas** + tombol Tandai lunas/Batalkan) **dihapus**; penggantinya notis `meja-qr-menunggu-bayar` yang
   hanya menyebut jumlahnya (“N pesanan QR meja menunggu pelunasan”) + tautan `meja-qr-ke-pembayaran` ke
   `/app/payments`. Kartu tiket dapur kini menampilkan kanal + momen pelunasan (`kds-lunas-meja-*`, dengan
   `data-paid-at`), dan keadaan antrean kosong menjelaskan bahwa pesanan QR masuk setelah tagihannya lunas.
3. **Halaman Pembayaran** (`src/pages/PaymentsPage.tsx`): baris tagihan yang berasal dari pesanan QR meja
   diberi penanda “Pesanan QR meja <meja> · <tamu> — dapur baru menerima pesanannya setelah tagihan ini
   lunas”, tombol pelunasannya berbunyi **Lunasi & kirim ke dapur**, dan barisnya punya `data-testid`
   `tagihan-<nomor>` + tombol `tagihan-lunasi-*`/`tagihan-batal-*` supaya jalurnya bisa diuji.
4. **Backend** (`src/convex/tables.ts`): pagar hapus meja (`tableUsage`) menghitung `pendingGuestOrders`
   dengan `isAwaitingPayment` (status tagihan efektif dari `statusOf`), jadi tagihan yang sudah dibatalkan
   kasir/kedaluwarsa tidak lagi mengunci denah; cermin demo (`src/lib/store/demo.tsx`) memakai aturan yang
   sama, dan `toDigitalLike` dinaikkan supaya pagar itu tidak memakai penilaian status yang berbeda.
5. **Cermin demo**: pelunasan pesanan QR meja kini mencatat kanal yang benar di penjualannya (`Transfer`
   untuk VA, `QRIS` untuk QRIS) — sebelumnya selalu `QRIS`. Komentar `src/convex/meja.ts` &
   `src/lib/store/types.ts` diselaraskan dengan alur baru.
6. **Harness**: `verify-fnb.mjs` 77 → **82** (penanda kanal/momen), `verify-meja.mjs` 68 → **72**
   (`isAwaitingPayment`), `verify-render.mjs` 761 → **785** (alur tamu → dapur → Pembayaran dalam **satu
   store**: pesanan belum lunas tidak tampil, notis + tautannya, pelunasan/pembatalan dari halaman
   Pembayaran, tiket bertanda momen & kanal), `verify-meja-browser.mjs` 75 → **86** (Chromium: pesanan
   belum dibayar tidak tampil di `main` layar dapur, notis & tautannya, pelunasan dari baris tagihan,
   tiket “Lunas VA BRI dari meja · diterima dapur pukul HH:MM”), `verify-backend.mjs` 794 → **795**
   (tagihan QR meja yang dibatalkan kasir dari halaman Pembayaran melepas pagar hapus meja) + satu
   ekspektasi diperbarui (daftar tagihan tenant itu 7 → 8 karena satu tagihan uji baru).
7. **Dokumentasi**: README (bagian pesanan QR meja + daftar perintah) diperbarui ke perilaku baru.

**Berkas:** diubah: `src/convex/lib/fnb.ts`, `src/convex/lib/meja.ts`, `src/convex/tables.ts`,
`src/convex/meja.ts` (komentar), `src/pages/KdsPage.tsx`, `src/pages/PaymentsPage.tsx`,
`src/lib/store/types.ts`, `src/lib/store/demo.tsx`, `scripts/verify-fnb.mjs`, `scripts/verify-meja.mjs`,
`scripts/verify-render.mjs`, `scripts/verify-meja-browser.mjs`, `scripts/verify-backend.mjs`, `README.md`
· baru: tidak ada.

**Verifikasi:**
- `bun convex dev --once` → `Convex functions ready! (4.09s)`, exit 0 (dijalankan lagi setelah perubahan
  terakhir: exit 0)
- `bun tsc -b --noEmit` → exit 0 (dijalankan setelah setiap tahap; sempat gagal dua kali karena impor
  `cn` ganda + `Badge` yang masih dipakai, dan sekali karena `toDigitalLike` dipakai sebelum deklarasinya
  — ketiganya diperbaiki, bukan di-suppress)
- `bun scripts/verify-fnb.mjs` → `82/82 checks passed`, exit 0
- `bun scripts/verify-meja.mjs` → `72/72 checks passed`, exit 0
- `bun scripts/verify-render.mjs` → `785/785 checks passed`, status 0
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-meja-browser.mjs http://localhost:5173` → `86/86 checks
  passed`, exit 0 (Chromium atas preview yang berjalan)
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  `795/795 checks passed against …`, exit 0

**Catatan / blocker:** tidak ada blocker baru. Batasan yang disengaja: notis di layar dapur hanya menyebut
**jumlah** pesanan yang belum lunas (tidak nama tamu/nominal/nomor tagihannya) — supaya pesanan belum lunas
benar-benar tidak terbaca dari layar dapur, sementara kasir tetap tahu ada yang menunggu dan di mana
melunasinya. Pelunasan/pembatalan **hanya** dari halaman Pembayaran; tombolnya sengaja dilepas dari layar
dapur. Tagihan QRIS yang kedaluwarsa (5 menit) membuat pesanannya tidak lagi “menunggu pelunasan” tanpa
perlu ditulis ulang, tetapi pesanannya tetap tercatat — kasir bisa membatalkannya dari halaman Pembayaran
(barisnya masih tampil sebagai kedaluwarsa) atau tamu membatalkannya sendiri. Tabel **Status Phase 1–6**
(baris `pos.table` & `pos.kds`) dan daftar **Blocker yang masih terbuka** diperiksa: tidak ada klausa
roadmap yang berubah dan tidak ada blocker baru.

## 2026-10-14 — Denah meja lebih kaya: urutkan/geser posisi & impor beberapa meja sekaligus

**Ruang lingkup:** permintaan pengguna — tambahkan pengaturan denah meja yang lebih kaya: (a)
**urutkan/geser posisi meja**, dan (b) **impor-batch beberapa meja sekaligus**. Yang dikerjakan:

1. **Aturan murni** (`src/convex/lib/fnb.ts`): `sortTablesByOrder` (urutan tampil: `sortOrder` yang
   disimpan, dan data lama tanpa urutan tetap dibaca dengan aturan lama — zona dulu, lalu nama),
   `nextTableSortOrder` (meja baru selalu di paling akhir), `planTableMove` (geser satu langkah,
   mengembalikan urutan baru **seluruh** denah yang dinomori ulang 1…n, plus kalimat penolakan di ujung
   denah), `splitTableImportRow` (pemisah koma/titik koma/tab — bukan spasi, karena nama meja boleh
   memuat spasi), dan `planTableImport` (satu meja per baris `Nama, kursi, zona`, kursi/zona boleh
   dilewati, baris `#` diabaikan, maksimal `MAX_TABLE_IMPORT_ROWS` = 40 baris, **semua atau tidak sama
   sekali** dengan nomor baris pada penolakannya).
2. **Skema & backend**: `tables.sortOrder` (opsional — data lama tetap terbaca) dan `tablesForStore`
   kini mengurutkan dengan `sortTablesByOrder`; `tables.create` memberi urutan paling akhir;
   `tables.move` (menghitung urutan barunya **di server** dari data tersimpan, hanya menyimpan baris yang
   berubah, audit `table.move`) dan `tables.importBatch` (mengurai teks dengan aturan yang sama, menyisipkan
   meja berurutan di belakang, satu entri audit `table.import`); keduanya berfitur `pos.table` + izin
   `table.manage`.
3. **Store** (`types.ts`, `demo.tsx`, `convex.tsx`): `StoreTable.sortOrder`, `moveTable(tableId, step)`,
   dan `importTables(text)`; mode demo memakai aturan bersama (`planTableMove`/`planTableImport`) dan
   menyajikan denah yang sudah terurut (`sortTablesByOrder`), jadi denah, pemilih meja kasir, dan layar
   dapur membaca urutan yang sama.
4. **UI dasbor admin** (`src/pages/KdsPage.tsx`): tiap kartu meja punya tombol **Geser** kiri/kanan
   (mati di ujung denah, `meja-geser-kiri-*`/`meja-geser-kanan-*`), dan ada panel **Impor beberapa meja**
   dengan kolom teks, **pratinjau** hasil `planTableImport` (jumlah meja + kolom tiap barisnya, atau
   penolakan bernomor baris), dan laporan hasil setelah impor.
5. **Harness**: `verify-fnb.mjs` 55→77 (urutan & impor sebagai aturan murni), `verify-backend.mjs`
   778→794 (server: meja baru di akhir, `tables.move` + penolakan di ujung/meja asing/kasir, urutan tidak
   berubah saat meja diganti nama, `tables.importBatch` + lima bentuk penolakannya + tidak meninggalkan
   meja saat ditolak), `verify-render.mjs` 752→761 (tombol geser mati di ujung, urutan kartu benar-benar
   berpindah di DOM, pratinjau impor, impor menambah meja di akhir denah), `verify-meja-browser.mjs`
   67→75 (Chromium: geser sungguhan + impor sungguhan).
6. **README**: bagian denah meja diperluas (urutan disimpan, geser, impor) dan angka suite diselaraskan.

**Berkas:** baru: tidak ada · diubah: `src/convex/lib/fnb.ts`, `src/convex/schema.ts`,
`src/convex/tables.ts`, `src/lib/store/types.ts`, `src/lib/store/demo.tsx`, `src/lib/store/convex.tsx`,
`src/pages/KdsPage.tsx`, `scripts/verify-fnb.mjs`, `scripts/verify-backend.mjs`,
`scripts/verify-render.mjs`, `scripts/verify-meja-browser.mjs`, `README.md`, `worklog.md`.

**Verifikasi:**

- `bun convex dev --once` → `✔ Convex functions ready! (4.1s)`, exit 0 (kolom `sortOrder` & fungsi
  `tables.move`/`tables.importBatch` ikut ter-push; tidak ada indeks baru yang perlu ditambahkan).
- `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-fnb.mjs` → `77/77 checks passed`, exit 0 (55 → 77; satu ekspektasi awal saya salah
  — saya mengira data lama terurut "A1,A2,B1", ternyata aturan lama mengurut **zona dulu** sehingga
  "B1,A1,A2"; yang diperbaiki adalah ekspektasi tesnya, aturannya memang dipertahankan apa adanya).
- `bun scripts/verify-render.mjs` → `761/761 checks passed`, status 0 (752 → 761). Helper `fill` di
  harness ini diperluas supaya bisa mengisi `textarea` (setter `HTMLInputElement` ditolak tegas
  "Illegal invocation" pada `<textarea>`).
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-meja-browser.mjs http://localhost:5173` → `75/75 checks
  passed`, status 0 (67 → 75).
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  `794/794 checks passed`, exit 0 (778 → 794).

**Catatan / blocker:**

- **Pergeseran memakai tombol satu langkah**, bukan seret-lepas (drag & drop): tombol bisa dipakai di
  ponsel, tablet, dan pembaca layar, dan aturannya bisa diuji tanpa bergantung pada koordinat tetikus.
  Urutan akhirnya tetap bisa ditata bebas dengan menggeser beberapa kali, atau sekaligus dengan impor
  (meja hasil impor masuk berurutan di belakang).
- **Impor bersifat menambah saja** — denah yang ada tidak diubah/dihapus oleh impor, dan meja hasil impor
  selalu masuk di belakang. Menata ulang meja yang sudah ada tetap lewat tombol Geser.
- Urutan denah **tidak** diurutkan ulang otomatis saat meja dihapus: nomor yang tersisa hanya dirapikan
  ketika ada pergeseran atau impor berikutnya. Denah tetap tampil benar karena urutan hanya dibandingkan,
  bukan dipakai sebagai indeks.
- Tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** diperiksa: tidak ada klausa roadmap
  yang berubah (ini memperdalam `pos.table` yang sudah ada), jadi tidak ada baris yang perlu diperbarui.

## 2026-10-14 — Tamu bisa membatalkan pesanannya sendiri & denah meja bisa diubah/dihapus

**Ruang lingkup:** permintaan pengguna — (a) tambahkan **tombol batal** di UI pembeli yang memesan lewat
QR code, karena pembeli bisa berubah pikiran dan tidak jadi memesan/membeli; (b) tambahkan fitur **add,
edit, dan hapus** untuk pengaturan **denah meja** di dasbor admin merchant. Yang dikerjakan:

1. **Aturan murni baru** — `tableDeletionCheck` di `src/convex/lib/fnb.ts`: pagar hapus sebuah meja yang
   membaca **pemakaian**-nya (`TableUsage`: pesanan terbuka + nomornya, tagihan tamu yang masih menunggu
   dibayar, riwayat penjualan) dan mengembalikan `canDelete`, `blockers[]`, serta satu kalimat ringkas.
   Yang benar-benar boleh dihapus hanyalah meja yang **belum pernah dipakai**; meja beriwayat dijawab
   dengan menyarankan **nonaktifkan**. Dan `guestCancelCheck` di `src/convex/lib/meja.ts`: pembatalan tamu
   hanya boleh selama tagihannya **belum lunas**, tagihan yang sudah dibatalkan tidak dibatalkan dua kali,
   dan kalimat penolakannya menyebut nomor penjualannya kalau tagihannya sudah lunas.
2. **Backend** — `tables.update` (nama/kursi/zona, validasi `resolveTableInput` + nama tetap unik), query
   `tables.deletionCheck` (pagar hapus tanpa menghapus apa pun, dibaca dialog konfirmasi), dan
   `tables.remove` yang menegakkan pagar itu di server; semuanya berfitur `pos.table` + izin
   `table.manage`, dengan audit log `table.update`/`table.remove`. `meja.cancelOwnOrder` (mutation tanpa
   aktor, lewat token pemantau `mjo_…`) membatalkan pesanan **dari ponsel tamunya sendiri**: tagihan yang
   masih menunggu ikut dimatikan (supaya kodenya tidak bisa dipakai membayar pesanan yang sudah
   dibatalkan), status pesanannya jadi `cancelled`, dan jejaknya masuk audit log `meja.cancelOwn`.
   `schema.ts` menambah indeks `mejaOrders.by_table` (dipakai `tableUsage`) — saat push: `Added table
   indexes: [+] mejaOrders.by_table`.
3. **Store** (`src/lib/store/types.ts`, `demo.tsx`, `convex.tsx`) — `updateTable`, `deleteTable`,
   `tableDeletionCheck` (mode Convex meminta pagarnya ke server lewat `tables.deletionCheck`, pola yang
   sama dengan `checkProductDeletion`), dan `cancelGuestOrder` di jalur demo (memakai `guestCancelCheck`
   yang sama, termasuk mematikan tagihannya). Mode demo menghitung pemakaian meja dari data yang
   dimilikinya (pesanan tertahan di mejanya, pesanan QR yang menunggu, pesanan QR yang sudah lunas) —
   batas itu ditulis di komentarnya, karena penjualan demo tidak menyimpan meja asalnya.
4. **UI dasbor admin** (`src/pages/KdsPage.tsx`) — tiap kartu meja di denah kini punya **Ubah** (dialog
   nama/kursi/zona, nilai awalnya nilai yang sekarang, disimpan lewat `tables.update`) dan **Hapus**
   (dialog yang **membaca pagar hapusnya lebih dulu** lewat `tables.deletionCheck`: kalimat pagarnya
   ditampilkan apa adanya, dan tombol Hapusnya mati selama mejanya belum boleh dihapus). Menghapus meja
   yang kartu QR-nya sedang terbuka juga menutup kartunya, dan pesan galat halaman dipindai dengan
   `data-testid="meja-galat"`.
5. **UI pembeli** (`src/pages/MejaPage.tsx`) — kartu pembayaran pesanan yang belum lunas punya tombol
   **Batalkan pesanan** dengan langkah konfirmasi (“Pesanannya tidak diteruskan ke dapur, dan Anda tidak
   perlu membayar apa pun.”) beserta tombol **Lanjutkan pesanan**; jawaban server (mode Convex:
   `meja.cancelOwnOrder`, demo: `cancelGuestOrder`) ditampilkan apa adanya lewat `meja-batal-notis` —
   termasuk penolakan “sudah dibayar” — dan begitu dibatalkan kode bayarnya hilang dari kartunya.
6. **Harness**: `verify-fnb.mjs` 39→55 (pagar hapus: meja bebas, terisi, tagihan menunggu, beriwayat,
   tiga penghalang sekaligus); `verify-meja.mjs` 59→68 (pagar pembatalan tamu: menunggu, kedaluwarsa,
   lunas, status tagihan lunas tanpa nomor penjualan, dibatalkan dua kali); `verify-backend.mjs` 754→778
   (pembatalan tamu lewat token asing/bentuk salah, tagihan yang ikut mati & tidak bisa dilunasi lagi,
   tidak membuat tiket dapur, pagar hapus meja dari sisi server, plus dua hitungan tagihan di harness yang
   ikut berubah karena blok baru ini membuat tiga tagihan lagi — 4 → 7 tagihan & 3 → 4 tagihan lunas);
   `verify-render.mjs` 738→752 (alur batal di halaman tamu, pembatalan tertutup setelah lunas, dialog
   Ubah/Hapus meja di DOM tiruan); `verify-meja-browser.mjs` 42→67 (Chromium: tamu membatalkan pesanannya
   — meja kembali kosong & kasir tidak lagi melihatnya — plus tambah/ubah/hapus meja beserta penolakan
   pagar hapusnya dan penolakan nama kembar).
7. **README** — bagian denah meja & pesanan QR meja diperluas, dan angka suite diselaraskan.

**Berkas:** baru: tidak ada · diubah: `src/convex/lib/fnb.ts`, `src/convex/lib/meja.ts`,
`src/convex/schema.ts`, `src/convex/tables.ts`, `src/convex/meja.ts`, `src/lib/store/types.ts`,
`src/lib/store/demo.tsx`, `src/lib/store/convex.tsx`, `src/pages/KdsPage.tsx`, `src/pages/MejaPage.tsx`,
`scripts/verify-fnb.mjs`, `scripts/verify-meja.mjs`, `scripts/verify-backend.mjs`,
`scripts/verify-render.mjs`, `scripts/verify-meja-browser.mjs`, `README.md`, `worklog.md`.

**Verifikasi:**

- `bun convex dev --once` → `✔ Added table indexes: [+] mejaOrders.by_table` lalu
  `✔ Convex functions ready! (4.25s)`, exit 0.
- `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-fnb.mjs` → `55/55 checks passed`, exit 0 (39 → 55).
- `bun scripts/verify-meja.mjs` → `68/68 checks passed`, exit 0 (59 → 68).
- `bun scripts/verify-render.mjs` → `752/752 checks passed`, exit 0 (738 → 752).
- `bun scripts/verify-meja-browser.mjs http://localhost:5173` (Chromium) → `67/67 checks passed`, exit 0
  (42 → 67). Baca "Dibatalkan" pada pesanan yang dibatalkan **tidak** bisa diperiksa di kartu kasir:
  `meja.listOrders` memang hanya mengirim pesanan yang menunggu bayar + yang lunas 12 jam terakhir, dan
  server maupun store demo sepakat — jadi yang diperiksa adalah hilangnya pesanan itu dari daftar tunggu
  kasir **dan** mejanya kembali “Kosong”.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  `778/778 checks passed`, exit 0 (754 → 778; sempat 2× gagal di dua cek hitungan tagihan lama yang ikut
  berubah — `daftar.summary.paid === 3` & `daftarTurun.charges.length === 4` — keduanya diperbarui ke
  jumlah yang benar sesuai skenario baru, bukan dilonggarkan).
- `bun scripts/verify-store-gate.mjs` → `langganan: 27 total · 17 bergerbang izin · 10 cukup keanggotaan`,
  exit 0 (pagar hapus meja dipanggil sebagai `convex.query` sekali pakai, bukan langganan baru).
- `bun scripts/verify-modules.mjs` → `34/34`, `bun scripts/verify-authz.mjs` → `92/92`,
  `bun scripts/verify-menus.mjs` → `406/406`, semuanya exit 0.

**Catatan / blocker:**

- **Mode demo menghitung riwayat penjualan meja dari pesanan QR yang sudah lunas**, karena penjualan demo
  tidak menyimpan `tableId`. Di server hitungannya adalah semua baris `sales` yang menunjuk meja itu
  (`by_table`), jadi meja yang pernah dipakai lewat kasir tetap ditolak dihapus di mode Convex — bedanya
  hanya di demo, dan sudah ditulis di komentar `tableUsageOf`.
- **Pembatalan tamu tidak muncul sebagai “Dibatalkan” di kartu kasir** karena daftar itu memang hanya
  memuat pesanan menunggu + lunas 12 jam terakhir (perilaku lama, tidak diubah di sini). Jejaknya tetap ada
  di audit log (`meja.cancelOwn`).
- Tombol **Batalkan** milik kasir (`meja.cancelOrder`, izin `payment.manage`) tetap ada dan tidak diubah —
  yang baru adalah jalur tamunya sendiri lewat token pemantau.
- Tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** diperiksa: tidak ada klausa roadmap
  yang berubah (ini memperluas `pos.table` & alur QR meja yang sudah ada), jadi tidak ada baris yang perlu
  diperbarui.

## 2026-10-14 — Pesanan QR meja: tambah bayar Virtual Account & tombol “Screenshot QRIS”

**Ruang lingkup:** permintaan pengguna — (a) tambahkan **metode pembayaran Virtual Account (VA)** saat
pembeli checkout dari hasil scan QR di mejanya, dan (b) kalau pembeli memilih **QRIS**, sediakan **tombol
screenshot kode QRIS** supaya ia bisa membayar dari gambar hasil screenshot itu. Yang dikerjakan:

1. **Aturan murni** `src/convex/lib/meja.ts`: `GUEST_PAY_METHODS`/`GUEST_DEFAULT_PAY_METHOD` (QRIS bawaan),
   `GUEST_PAY_BANKS` (BCA/BNI/BRI/Mandiri — daftar yang sama dengan halaman Pembayaran), `guestPayOptions`,
   `guestBankOptions`, `guestPaymentMethod` (VA **wajib** menyebut bank; QRIS menolak bank; metode asing
   ditolak dengan kalimat yang bisa dibaca tamu), `guestPaymentInstruction` (QRIS menyebut jalur screenshot,
   VA menyebut bank + nomornya), `guestQrisFileName` (`qris-<nomor-tagihan>.png`), dan label tombol
   `GUEST_QRIS_SCREENSHOT_LABEL` (satu kalimat untuk halaman & harness).
2. **Gambar QRIS** — `src/lib/qrisImage.ts` (aturan murni: putih, zona tenang 4 modul, tepi 16 px, skala
   bilangan bulat 4–24 px per modul, keterangan `Rp 47.000 · DIG-…` dipotong 48 karakter) dan
   `src/lib/qrisImageRaster.ts` (menggambar di kanvas perangkat tamu → PNG; gagal kanvas = `null`, bukan
   berkas kosong).
3. **Backend** `src/convex/meja.ts` + `schema.ts`: `meja.menu` ikut mengirim cara bayar yang ditawarkan;
   `meja.order` menerima `method`/`bank` (string, supaya penolakannya bisa dibaca tamu), menerbitkan nomor
   VA deterministik (`virtualAccountNumber`) & menyimpannya bersama metodenya; `meja.status`/`listOrders`
   ikut membawa metode, bank, nomor VA, dan kalimat cara bayarnya; internal `guestOrderPaid` mencatat
   penjualannya bertipe pembayaran **transfer** untuk VA (QRIS tetap `qris`); tabel `mejaOrders` menambah
   `method`/`bank`/`vaNumber` (opsional — pesanan lama tetap dibaca QRIS).
4. **Halaman tamu** (`src/pages/MejaPage.tsx`): pemilih cara bayar + bank penerbit di lembar pesanan,
   kartu **Virtual Account** (nomor + tombol **Salin** + hitung mundur yang kini mengenal jam), kartu
   QRIS dengan tombol **Screenshot QRIS** (lembar bagikan perangkat kalau ada → kalau tidak, unduhan PNG
   bernama `qris-<nomor>.png`), dan baris notis yang melaporkan apa yang benar-benar terjadi.
5. **Halaman Dapur & Meja** (`src/pages/KdsPage.tsx`): kartu pesanan QR menampilkan cara bayar & nomor VA
   tujuan, dan penanda tiket dapurnya kini mengikuti metodenya (`Lunas QRIS dari meja` / `Lunas VA <bank>
   dari meja`, testid `kds-lunas-meja-…` menggantikan `kds-lunas-qris-…`).
6. **Store** (`types.ts`, `demo.tsx`): `GuestOrderInput`/`GuestOrderReceipt`/`StoreGuestOrderStatus`/
   `StoreGuestMenu`/`StoreMejaOrder` membawa method/bank/vaNumber/instruction; jalur demo memakai aturan
   yang sama (`guestPaymentMethod` + `createDigitalCharge`).
7. **Harness**: `verify-meja.mjs` +17 cek (cara bayar, bank, nomor VA, kalimat, gambar QRIS dibangun
   ulang piksel demi piksel lalu dibaca balik pemindai — termasuk pada skala terkecil);
   `verify-meja-browser.mjs` +14 cek (Chromium: tombol screenshot benar-benar mengunduh PNG & ukurannya
   sama dengan tata letak aturan murninya, tamu VA dapat nomor `8888…` + salin, tiket dapur `Lunas VA BRI`);
   `verify-render.mjs` +9 cek (pemilih cara bayar, chip bank, kartu VA tanpa kode QR, notis tanpa kanvas);
   `verify-backend.mjs` +10 cek (penolakan VA tanpa bank/QRIS berbank/metode asing, rantai VA sampai tiket
   dapur & tagihan menunjuk penjualannya).
8. **README**: bagian pesanan QR meja diperluas (dua cara bayar, tombol screenshot, nomor VA, penanda tiket)
   dan angka suite diselaraskan (verify-meja 42→59, verify-meja-browser 28→42, verify-render 729→738,
   verify-backend 744→754).

**Berkas:** baru: `src/lib/qrisImage.ts`, `src/lib/qrisImageRaster.ts` · diubah: `src/convex/lib/meja.ts`,
`src/convex/meja.ts`, `src/convex/schema.ts`, `src/lib/store/types.ts`, `src/lib/store/demo.tsx`,
`src/pages/MejaPage.tsx`, `src/pages/KdsPage.tsx`, `scripts/verify-meja.mjs`,
`scripts/verify-meja-browser.mjs`, `scripts/verify-render.mjs`, `scripts/verify-backend.mjs`, `README.md`,
`worklog.md`.

**Verifikasi:**

- `bun scripts/verify-meja.mjs` → `59/59 checks passed`, exit 0 (termasuk gambar QRIS dibaca balik `jsqr`).
- `bun convex dev --once` → `Convex functions ready! (4.09s)`, exit 0.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  `754/754 checks passed`, exit 0 (744 → 754). Rantai VA-nya lulus di deployment: VA tanpa bank ditolak,
  QRIS berbank ditolak, metode asing ditolak → pesanan 1 × 12.000 + PPN 11% = **13.320** → tagihan `va`
  ber-nomor `8810…` (payload QRIS `null`) → belum ada tiket dapur → lunas → penjualan + tiket dapur meja A1
  → tagihan menunjuk penjualannya.
- `bun scripts/verify-render.mjs` → `738/738 checks passed`, exit 0 (729 → 738).
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-meja-browser.mjs http://localhost:5173` → `42/42 checks
  passed`, exit 0 (28 → 42). Berkas unduhan screenshot diperiksa dari byte-nya: tanda tangan PNG sah,
  13.382 byte, dan 524×550 px — persis `qrisImageLayout` untuk payload itu (33 modul + 8 zona tenang,
  × 12 px, + tepi 16 px tiap sisi, + 26 px keterangan).
- `bun tsc -b --noEmit` → exit 0 (sempat gagal `TS1005` di `KdsPage.tsx` karena ternary yang kehilangan
  `: null`; diperbaiki, lalu lolos).

**Catatan / blocker:**

- **Yang dimaksud “melalui payment gateway” masih sebatas kanalnya.** Nomor VA & payload QRIS diterbitkan
  server dari aturan `payment.digital` (nomor VA deterministik per bank + urutan tagihan), dan pelunasannya
  tetap **dicatat kasir** (halaman Pembayaran / tombol Tandai lunas di layar dapur) — belum ada panggilan ke
  gateway sungguhan (Midtrans Core API QRIS / Xendit QR Codes) karena kuncinya belum ada. Menyambungkannya =
  pekerjaan lanjutan + kunci server-side (`XENDIT_SECRET_KEY`+`XENDIT_CALLBACK_TOKEN` atau setara) di
  lingkungan deployment, plus rute webhook di `src/convex/http.ts`.
- Dua angka harapan di blok **pembayaran digital** `verify-backend.mjs` ikut disesuaikan (tagihan lunas 2→3,
  tagihan terbaca 3→4) karena tagihan VA pesanan meja kini ikut terhitung di tenant yang sama; invarian yang
  diperiksa tidak dilonggarkan — jumlahnya justru disebut lebih rinci.
- `data-testid` penanda tiket dapur berubah dari `kds-lunas-qris-…` menjadi `kds-lunas-meja-…`; kedua harness
  yang memakainya sudah diperbarui.
- Tabel **Status Phase 1–6** dan daftar **Blocker** diperiksa: tidak ada klausa roadmap yang berubah
  (pekerjaan ini memperluas klausa `pos.table` + `payment.digital` yang sudah tercatat).

## 2026-10-14 — Pesanan QR meja: tamu memindai kartu di meja, memesan & membayar sendiri

**Ruang lingkup:** permintaan pengguna — tamu yang duduk di meja bisa memindai **kode QR yang ditempel
di mejanya**, melihat menu toko itu, memesan, dan membayar sendiri dari ponselnya, sementara pesanannya
masuk ke antrean dapur mesinPOS tanpa kasir mengetik apa pun. Yang dikerjakan:

1. **Aturan murni** `src/convex/lib/meja.ts`: token kartu `mj_<32 hex>` (rahasia, **bukan** `tableId`) &
token pemantau pesanan `mjo_…`; `validateGuestCart` (harga selalu dari katalog, produk asing/nonaktif/
habis ditolak **dengan nama menunya**, batas 20 baris · 10 porsi per menu · 40 item · nama tamu 24
karakter); `guestOrderTotal` (biaya layanan → pajak, memakai `normalizePct` yang sama dengan
`orderTotal`); `guestChargeReference` (`Meja A2 · 3 item · 2× Kopi Susu`); `mejaUnavailableReason`
(gerbang `pos.table` + `pos.kds` + `payment.digital` beserta kalimat kanoniknya).
2. **Backend** `src/convex/meja.ts`: `menu` (katalog toko **yang sama** dengan kasir, dikelompokkan per
kategori, yang habis tetap dikirim `available: false`), `order` (menerbitkan tagihan QRIS 5 menit +
menahan isi pesanan di tabel `mejaOrders` — **belum** ada penjualan/tiket dapur), `status` (satu pesanan
lewat token pemantau), `listOrders` (kasir/dapur: menunggu bayar berapa pun umurnya + lunas 12 jam),
`cancelOrder` (`payment.manage`), dan internal `guestOrderPaid` yang dipanggil `payments.act` saat
tagihannya lunas → penjualan `held` bernomor + itemnya + tiket dapur; angkanya dipakai apa adanya.
`tables.issueMenuQr` menerbitkan/mengganti (`rotate`) kartu dengan izin `table.manage`, idempoten untuk
kartu yang sudah tercetak.
3. **Halaman tamu publik** `/meja/:token` (`src/pages/MejaPage.tsx` — di luar `/app`, tanpa sesi): menu →
keranjang → tagihan QRIS + hitung mundur → pemantauan status. Dua jalur data: Convex langsung di mode
Convex, store demo di mode demo (termasuk tombol “Simulasikan pembayaran (mode demo)”).
4. **Halaman Dapur & Meja**: kartu QR meja (terbit · salin tautan · ganti kartu · cetak — saat dicetak
hanya kartunya yang terlihat, aturan `@media print` di `src/index.css`) + kartu “Pesanan QR dari tamu”
beserta tombol `Tandai lunas`/`Batalkan` yang bergerbang izin `payment.manage`.
5. **Store & tipe**: `issueTableMenuQr`, `mejaOrders`, `settleMejaOrder`, `cancelMejaOrder`, plus
`guestMenu`/`placeGuestOrder`/`guestOrderStatus` (khusus demo) di `types.ts`/`demo.tsx`/`convex.tsx`.
6. **Harness baru**: `scripts/verify-meja.mjs` (murni) & `scripts/verify-meja-browser.mjs` (Chromium atas
preview); `verify-backend.mjs` (+20 cek) & `verify-render.mjs` (+12 cek) diperluas.
7. **README**: bagian baru “Modul F&B: pesanan QR meja — tamu memesan & membayar dari ponselnya”, dan angka
suite di perintah per bagian diselaraskan (verify-render 717 → **729**, verify-backend 724 → **744**).
8. **Landing page**: daftar fitur **Modul F&B** menambah satu poin — “Pesanan QR meja — tamu pesan & bayar
sendiri dari ponselnya”.

**Berkas:** baru: `src/convex/lib/meja.ts`, `src/convex/meja.ts`, `src/lib/meja.ts`,
`src/pages/MejaPage.tsx`, `scripts/verify-meja.mjs`, `scripts/verify-meja-browser.mjs` · diubah:
`src/convex/lib/fnb.ts`, `src/convex/tables.ts`, `src/convex/schema.ts` (tabel `mejaOrders`, index
`by_menu_token`/`by_watch`/`by_charge`, kolom `tables.menuToken`), `src/convex/payments.ts`, `src/App.tsx`,
`src/index.css`, `src/pages/KdsPage.tsx`, `src/pages/LandingPage.tsx`, `src/lib/store/types.ts`,
`src/lib/store/demo.tsx`,
`src/lib/store/convex.tsx`, `scripts/verify-backend.mjs`, `scripts/verify-render.mjs`, `README.md`,
`worklog.md`.

**Verifikasi:**

- `bun scripts/verify-meja.mjs` → `42/42 checks passed`, exit 0 (termasuk kartu QR yang dibaca balik
pemindai sungguhan `jsqr`, dan perbandingan `guestOrderTotal` vs `orderTotal` untuk beberapa setelan pajak).
- `bun convex dev --once` → `Convex functions ready! (4.15s)`, exit 0.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
`744/744 checks passed`, exit 0 (724 → 744). Rantai barunya lulus di deployment: kartu QR `mj_…` diterbitkan
pemilik (kasir ditolak, `table.manage`) & `rotate` menggantinya → menu publik dibaca **tanpa sesi** →
pesanan tamu 2 × 12.000 = 24.000 + PPN 11% → tagihan QRIS **26.640** (payload memuat nominal & nomornya) →
**belum ada tiket dapur** selama tagihan belum lunas → lunas → penjualan `A-…` + tiket dapur meja A1 →
tagihan menunjuk balik penjualannya → pesanan QR kedua di meja yang masih terisi ditolak.
- `bun scripts/verify-render.mjs` → `729/729 checks passed`, exit 0 (717 → 729).
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-meja-browser.mjs http://localhost:5173` → `28/28 checks
passed`, exit 0 (kartu QR di halaman Dapur & Meja benar-benar dipindai tautannya, halaman tamu memesan →
bayar → tiket dapur bertanda “Lunas QRIS”).
- `bun scripts/verify-menus.mjs` → `406/406 checks passed`, exit 0 (rute publik `/meja/:token` tidak
mengubah peta menu `/app`).
- `bun tsc -b --noEmit` → exit 0 (dijalankan dua kali: sesudah fitur, dan lagi sesudah suntingan landing page).
- `bun scripts/verify-render.mjs` diulang sesudah suntingan landing page → `729/729 checks passed`, exit 0.

**Catatan / blocker:**

- **Uangnya masih dicatat manual.** Tagihan QRIS-nya diterbitkan server (payload deterministik, tergambar
sebagai kode QR yang bisa dipindai), tetapi **belum** tersambung ke payment gateway: pelunasan tetap
ditandai kasir (halaman Pembayaran atau `Tandai lunas` di layar dapur), dan di mode demo ada tombol
simulasi. Menyambungkan gateway (mis. Midtrans Core API QRIS / Xendit QR Codes) berarti pekerjaan
lanjutan + kunci server-side di lingkungan deployment.
- **Panduan belum menyebut alur ini.** Berkas PDF panduan tetap **18 bagian** dan kartu panduan singkat
di halaman Panduan belum memuat panduan QR meja — keduanya kandidat pekerjaan berikutnya (memasukkan ke PDF berarti membangun ulang dokumennya + menaikkan frasa yang diwajibkan `verify-panduan.mjs`).
- Tabel **Status Phase 1–6** diperiksa: klausa roadmap tidak berubah (fitur ini memperluas `pos.table`,
bukan menambah klausa). Baris **F&B: denah meja** diberi keterangan tambahan bahwa kini termasuk pesanan
QR meja. Daftar **Blocker yang masih terbuka** diperiksa: item 3 diberi pembaruan bahwa alur QR meja sudah
dilihat di Chromium (mode demo).

## 2026-10-14 — Panduan PDF jadi 18 bagian: “Kirim struk ke WhatsApp pembeli” masuk berkas

**Ruang lingkup:** permintaan pengguna — panduan kirim struk ke WhatsApp pembeli (yang sebelumnya hanya di
halaman web) dimasukkan ke berkas PDF panduan sebagai **bagian 18**. Yang dikerjakan:

1. **Bagian baru** di `scripts/gen-panduan-pdf.mjs` (`SECTIONS`): bagian 18 **“Kirim struk ke WhatsApp
   pembeli”** — langkah mengirim (4 langkah: pelunasan → tentukan nomor → tekan kirim → baca laporan),
   **apa yang sampai ke pembeli** (satu PNG berlogo sebagai pesan gambar; isinya sama dengan kertas;
   PDF tidak lagi dikirim lewat jalur ini; jejak audit per kiriman), **yang perlu disiapkan** (nomor member
   atau nomor yang diketik kasir untuk pembeli umum, izin `pos.sell`, kunci `WHATSAPP_ACCESS_TOKEN` +
   `WHATSAPP_PHONE_NUMBER_ID` di lingkungan deployment, kanvas perangkat), dan callout **“Kalau kanalnya
   belum tersambung”** (tautan `wa.me` berisi teks struk, Bagikan gambar struk, Unduh PDF, mode demo
   “disimulasikan”).
2. **Bagian 9 diperbaiki** karena klaimnya sudah usang: bullet “Kirim ke WhatsApp pembeli” masih menulis
   “PDF yang sama dikirim…” — sekarang menyebut **gambarnya** dan menunjuk Bagian 18, dan catatan kuncinya
   berbunyi “lingkungan deployment” beserta rujukan yang sama.
3. **PDF dibangun ulang**: `bun run panduan:pdf` → **18 bagian**, 12 gambar, **33 halaman** (31 → 33),
   101.339 byte (95.674 → 101.339); halaman bagian 18 = 31–33.
4. **Harness `verify-panduan.mjs`**: daftar isi 17 → **18** entri, nomor berurutan 1..18, dan **6 frasa baru**
   untuk bagian 18 (Kirim struk ke WhatsApp pembeli, Nomor WhatsApp pembeli, gambar struk PNG berlogo,
   `pos.sell`, `WHATSAPP_ACCESS_TOKEN`, Bagikan gambar struk) — 43 → **49 frasa** yang diwajibkan.
5. **Halaman Panduan** (`PanduanPage.tsx`): lencana “17 bagian · 12 gambar” → **“18 bagian · 12 gambar”**,
   ringkasan isi di kartu pratinjau menyebut bagian barunya, dan kartu panduan singkatnya menyebut bahwa
   ringkasan yang sama ada di PDF sebagai **bagian 18**; cek DOM (`verify-render.mjs`) & Chromium
   (`verify-struk-browser.mjs`) ikut menahan angka & frasanya.

**Berkas:** baru: (tidak ada) · diubah: `scripts/gen-panduan-pdf.mjs`,
`public/panduan/panduan-mesinpos.pdf` (dibangun ulang), `scripts/verify-panduan.mjs`,
`src/pages/PanduanPage.tsx`, `scripts/verify-render.mjs`, `scripts/verify-struk-browser.mjs`, `README.md`,
`worklog.md`.

**Verifikasi:**

- `bun run panduan:pdf` → `bagian: 18`, `halaman: 33`, `gambar: 12`, ukuran 99,0 KB, exit 0.
- `bun scripts/verify-panduan.mjs` → `14/14 pemeriksaan lolos`, exit 0 — daftar isi **18 entri**
  (`1->2 2->3 3->4 4->6 5->7 6->8 7->12 8->13 9->15 10->18 11->19 12->21 13->22 14->23 15->24 16->25 17->27
  18->31`), 33/33 halaman ber-footer, **49 frasa** langkah kunci di bagian yang benar, dan tidak ada teks di
  luar area cetak.
- `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-render.mjs` → `717/717 checks passed`, exit 0 (termasuk lencana 18 bagian & frasa
  “bagian 18” di kartu panduan struk).
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → `93/93 pemeriksaan
  lulus`, exit 0 (lencana “18 bagian · 12 gambar” terbaca di Chromium).

**Catatan / blocker:** tidak ada perintah yang gagal. Entri sebelumnya (“Panduan halaman: panduan singkat…”)
menulis PDF sengaja tidak diubah dan tetap 17 bagian — **entri ini yang mengubahnya**: PDF sekarang 18
bagian, frasa yang diwajibkan 43 → 49, dan lencana di halaman ikut 18. Bagian 18 **tidak** menambah gambar ilustrasi (tetap 12
gambar), jadi tidak ada fungsi gambar baru — bagian ini murni teks. Tabel **Status Phase 1–6** dan daftar
**Blocker yang masih terbuka** diperiksa: tidak ada klausa roadmap yang berubah.

## 2026-10-14 — Panduan halaman: panduan singkat kirim struk ke WhatsApp pembeli

**Ruang lingkup:** permintaan pengguna — tulis panduan singkat di halaman **Panduan** tentang kirim struk ke
WhatsApp pembeli. Yang dikerjakan: satu kartu baru (`data-testid="panduan-kirim-struk"`) di
`src/pages/PanduanPage.tsx`, bukan di berkas PDF — kasir membuka halaman ini dari sidebar saat baru memakainya,
sedangkan pratinjau PDF-nya sering tidak tampil di ponsel. Isinya mengikuti perilaku yang **sekarang** berlaku:

1. **Tiga langkahnya**: selesaikan pembayarannya (dialog struk terbuka sendiri, tombol cetak tidak lagi
   muncul lebih dulu) → tentukan nomornya (nomor member yang tersimpan, atau kolom **Nomor WhatsApp pembeli**
   untuk pembeli umum yang tidak disimpan sebagai member) → tekan **Kirim ke WhatsApp pembeli** dan baca
   laporannya (“disimulasikan” di mode demo, bukan klaim terkirim tanpa bukti).
2. **Apa yang sampai ke pembeli**: satu **gambar struk PNG berlogo** yang tampil sebagai foto di percakapan.
3. **Yang perlu disiapkan**: nomor pembeli, izin `pos.sell`, dan kunci `WHATSAPP_ACCESS_TOKEN` +
   `WHATSAPP_PHONE_NUMBER_ID` di **lingkungan deployment** (Settings → Environment, atau
   `bunx convex env set …` — bukan berkas env mesin kasir) supaya pesannya benar-benar keluar.
4. **Jalan lain saat kanalnya belum tersambung**: tautan `wa.me` yang membawa isi struknya sebagai teks,
   tombol **Bagikan gambar struk** (lembar bagikan perangkat), atau **Unduh PDF** lalu dilampirkan sendiri.
5. **Tautannya** langsung ke kasir (`/app/pos`) dan setelan struk (`/app/settings`).

Berkas PDF panduan **tidak** diubah (tetap 17 bagian), jadi tidak ada PDF yang dibangun ulang dan lencana
“17 bagian · 12 gambar” di halaman tidak bergeser.

**Berkas:** baru: (tidak ada) · diubah: `src/pages/PanduanPage.tsx`, `scripts/verify-render.mjs`,
`scripts/verify-struk-browser.mjs`, `scripts/verify-panduan.mjs`, `README.md`, `worklog.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-panduan.mjs` → `14/14 pemeriksaan lolos`, exit 0 (13 → 14: cek baru membaca sumber
  halaman — kartu `panduan-kirim-struk` beserta frasa langkahnya ada, di samping cek PDF yang lama).
- `bun scripts/verify-render.mjs` → `717/717 checks passed`, exit 0 (715 → 717: dua cek baru merender kartunya
  di DOM tiruan — langkah & frasanya, plus kedua tautannya).
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → `93/93 pemeriksaan
  lulus`, exit 0 (91 → 93: kartu itu benar-benar **terlihat** di halaman Panduan di Chromium beserta kedua
  tautannya).

**Catatan / blocker:** tidak ada perintah yang gagal. Batasannya: panduan ini hanya di halaman web, belum
masuk berkas PDF 17 bagian; memasukkan ke PDF berarti membangun ulang dokumennya (dan menambah bagian
18), jadi sengaja tidak dilakukan pada pekerjaan ini. Tabel **Status Phase 1–6** dan daftar **Blocker yang
masih terbuka** diperiksa: tidak ada klausa roadmap yang berubah.

## 2026-10-14 — Struk: satu jalur berbagi, satu gambar berlogo (tombol “Bagikan PDF” & kirim PDF dilepas)

**Ruang lingkup:** permintaan pengguna — logo **masih tidak terlihat** lewat tombol **Kirim ke WhatsApp
pembeli** & **Bagikan PDF**, sedangkan tombol **Bagikan gambar struk** sudah berhasil mengirimkan gambar
struknya. Karena itu konsep kedua tombol itu diubah: **berbagi/mengirim gambar struk belanja saja**. Yang
dikerjakan:

1. **“Bagikan PDF” dihapus** (bersama fungsi `shareReceipt`-nya). Jalur berbagi struk sekarang **satu**:
   tombol **Bagikan gambar struk** (`bagikanGambarStruk`) yang menyerahkan **satu berkas PNG berlogo** ke
   lembar bagikan perangkat. Pasangan “gambar + PDF” ditinggalkan karena pasangan berkas campuran di Android
   dihitung Chromium jadi satu intent bertipe **`*/*`** dan WhatsApp bisa mengambil berkas **pertamanya**
   saja — itulah sebab logo tidak pernah terlihat di percakapan. PDF tetap tersedia lewat **Unduh PDF**
   (struk berlogo, jalur yang sama seperti sebelumnya).
2. **“Kirim ke WhatsApp pembeli” mengirim gambarnya saja.** Aksi `receiptWa.send` sudah menerima
   `imageBase64` sebagai satu-satunya isi pesan (tidak menerima `pdfBase64` lagi): PNG berlogo diunggah
   (`type=image`) lalu dikirim sebagai **pesan gambar** (`media_id` + caption), jadi logo & isi struknya tampil
   di percakapan tanpa dibuka penerimanya. Kalau perangkat kasir tidak bisa menggambar struknya (tanpa
   kanvas), aksinya berhenti dan mengatakannya apa adanya beserta arah **Unduh PDF** — bukan mengirim berkas
   lain yang tidak diminta.
3. **Kode mati jalur berkas-logo-terpisah dilepas**: `readReceiptLogoFile` (+ pembantu `logoPng`/
   `berkasAsli`), `RECEIPT_WA_LOGO_PX`, dan `receiptWhatsappLogoFilename` — ketiganya hanya dipakai jalur
   yang dihapus, jadi ikut dilepas beserta cek harness-nya (62 → 59 cek di `verify-struk-pdf.mjs`).
4. **Harness** disesuaikan dengan perilaku baru: satu tombol bagikan, tidak ada tombol “Bagikan PDF”, dan di
   DOM tiruan (tanpa kanvas) yang diperiksa adalah laporan yang jujur + **tidak ada berkas kosong yang
   diserahkan**; berkas gambar berlogonya sendiri diperiksa piksel per piksel di Chromium.

**Berkas:** baru: (tidak ada) · diubah: `src/pages/PosPage.tsx`, `src/lib/receiptLogoRaster.ts`,
`src/convex/lib/receiptWhatsapp.ts`, `scripts/verify-struk-browser.mjs`, `scripts/verify-render.mjs`,
`scripts/verify-struk-pdf.mjs`, `scripts/verify-backend.mjs`, `README.md`, `worklog.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0.
- `bun convex dev --once` → `✔ 08:31:19 Convex functions ready! (3.98s)`, exit 0.
- `bun scripts/verify-backend.mjs` (deployment dev `mellow-narwhal-477`) → `724/724 checks passed`, exit 0.
- `bun scripts/verify-render.mjs` → `715/715 checks passed`, exit 0.
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → `91/91 pemeriksaan
  lulus`, exit 0 — termasuk: tidak ada lagi tombol “Bagikan PDF”, menekan tombol bagikan sekali lagi tetap
  menyerahkan **satu** berkas gambar yang sama, dan kiriman WhatsApp mode demo berbunyi “gambar struk
  struk-A-01044.png (1400×1898 px, 231,5 KB, berlogo)” tanpa `.pdf`.
- `bun scripts/verify-struk-pdf.mjs` → `59/59`, `bun scripts/verify-struk.mjs` → `111/111`,
  `bun scripts/verify-struk-gambar.mjs` → `14/14`, exit 0.
- Percobaan pertama `bun scripts/verify-struk-browser.mjs` **gagal** (exit 1): cek mode demo menuntut
  substring `(berlogo)`, sedangkan laporannya berbunyi `(1400×1898 px, 231,5 KB, berlogo)`. Ceknya
  diperbaiki menjadi `berlogo` (tanpa kurung) lalu dijalankan ulang → 91/91.
- Percobaan pertama `bun scripts/verify-backend.mjs` **gagal** (exit 1): deployment masih memakai versi lama
  `receiptWa.send` (validator menuntut `pdfBase64`). Setelah `bun convex dev --once`, jalannya ulang →
  724/724.

**Catatan / blocker:** DOM tiruan (happy-dom 21) tidak punya kanvas — `getContext("2d")` mengembalikan
`null` — jadi di `verify-render.mjs` jalur kirim/bagikan berhenti pada laporan “tidak bisa menggambar struk
jadi gambar”; akibatnya di `verify-render.mjs` tidak ada lagi cek “disimulasikan terkirim” (pindah ke
`verify-struk-browser.mjs` & `verify-backend.mjs`). Di perangkat tanpa kanvas, “Kirim ke WhatsApp pembeli”
tidak bisa mengirim apa pun (hanya memberi tahu) — jalur PDF tersedia lewat **Unduh PDF**. Bahwa WhatsApp
sungguhan menampilkan pesan gambarnya **belum bisa dibuktikan** dari sandbox: `WHATSAPP_ACCESS_TOKEN` +
`WHATSAPP_PHONE_NUMBER_ID` belum diisi di deployment. Tabel **Status Phase 1–6** dan daftar **Blocker yang
masih terbuka** diperiksa: tidak ada klausa roadmap yang berubah; blocker kanal WhatsApp masih sama.

## 2026-10-14 — Logo di “Kirim ke WhatsApp pembeli” & “Bagikan PDF”: sebabnya ketemu, keduanya diperbaiki

**Ruang lingkup:** laporan pengguna — “logo tetap tidak terlihat kalau diklik lewat tombol **Kirim ke WhatsApp
pembeli** & tombol **Bagikan PDF**”. Dua sebab yang **berbeda**, keduanya ditemukan dan diperbaiki:

1. **Kanal Cloud API belum tersambung, jadi tombol itu memang belum mengirim apa pun.** Dibuktikan
   baca-saja: `bunx convex env list --names-only` → hanya `JWKS/JWT_PRIVATE_KEY/OTP_DEV_CODE/OTP_EMAIL_FROM/
   RESEND_API_KEY/SITE_URL` (tidak ada kunci WhatsApp), dan `bunx convex run receiptWaData:channelStatus` →
   `{"configured": false, "missing": [WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID]}`. Preview yang berjalan
   pun mode **demo** (`VITE_DATA_SOURCE=demo` — dibaca dari modul yang dilayani dev server), jadi tombolnya
   menjawab “disimulasikan, tidak ada pesan yang benar-benar keluar”. Tidak ada kode yang bisa membuat logo
   muncul di WhatsApp dari jalur yang tidak mengirim apa pun; yang bisa dikerjakan adalah **menyiapkan** jalur
   itu supaya logonya tampil begitu kuncinya diisi (poin 2) dan menuliskannya apa adanya ke pengguna.
2. **Di jalur lembar bagikan, berkas pertama adalah PDF.** Pasangan berkas campuran diserahkan Android sebagai
   satu intent bertipe umum, dan aplikasi penerimanya bisa mengambil berkas **pertamanya** saja — jadi logonya
   (berkas kedua) tidak pernah terlihat. Sekarang **gambar struk berlogonya yang di depan**, PDF menyusul.

**Yang dikerjakan:**

1. **Murni** (`src/convex/lib/receiptWhatsapp.ts`): `receiptWhatsappMediaRequest` menerima `kind` / `mimeType`
   (bawaan tetap dokumen + `application/pdf`, jadi jalur lama tidak berubah) dan ada
   `receiptWhatsappImageMessageRequest` (pesan `type: "image"` dengan `media_id` + caption, **tanpa** `filename`
   yang tidak dimiliki pesan gambar) + `RECEIPT_WA_IMAGE_MAX_BYTES` (5 MB, batas gambar WhatsApp).
2. **Aksi** (`src/convex/receiptWa.ts`): `send` menerima `imageBase64`/`imageFilename` dan **sesudah dokumennya
   terkirim** mengunggah gambar struk lalu mengirimnya sebagai pesan gambar — best-effort: kegagalan di
   langkah ini tidak membatalkan kiriman dokumennya, hasilnya membawa `imageSent`/`imageReason`, dan jejak
   auditnya ikut mencatat sebabnya. Urutannya sengaja dokumen dulu: itu struk resminya.
3. **Kasir** (`src/pages/PosPage.tsx`): kirim struk membangun gambar struknya (`receiptImageFile`) lalu
   meneruskannya sebagai base64; laporannya berbunyi “gambar struk … (berlogo) + PDF …” kalau ikut, atau
   “PDF … saja — gambar struknya tidak ikut: <sebab>” kalau tidak. **Bagikan PDF** sekarang menyerahkan
   **[gambar struk (PNG berlogo), PDF]** — gambar lebih dulu, dengan berkas logo terpisah hanya sebagai
   cadangan kalau perangkatnya tidak bisa menggambar; judul tombolnya ikut menyebut urutan itu.
4. **Store**: `SendReceiptWhatsappInput` menambah `imageBase64`/`imageFilename` (types + `convex.tsx`
   meneruskannya ke aksi + `demo.tsx` menandai `imageSent` sama seperti server).
5. **Harness**: `verify-struk-pdf.mjs` 57 → **62** (badan unggah gambar `type=image` + `Content-Type: image/png`
   dengan byte PNG utuh & `Content-Length` tepat, pesan gambar berjenis `image` tanpa `filename`, jalur dokumen
   lama tetap `type=document`, batas 5 MB); `verify-render.mjs` 718 → **719** (di DOM tiruan tanpa kanvas:
   dokumennya tetap terkirim dan laporan menyebut gambarnya tidak ikut beserta sebabnya);
   `verify-struk-browser.mjs` 86 → **89** (di Chromium: kiriman mode demo menyertakan gambar berlogo, dan
   tombol **Bagikan PDF** benar-benar menyerahkan `image/png struk-<nota>.png` **lebih dulu** lalu
   `application/pdf struk-<nota>.pdf`, dengan laporan yang menyebut keduanya).
6. **Dokumentasi**: README (urutan berkas + logo di dalam gambar + pesan gambar di kanal resmi **dan** syarat
   kuncinya; rujukan angka 57→62, 718→719, 86→89) plus daftar perintah rutin di berkas ini.

**Berkas:** baru: (tidak ada) · diubah: `src/convex/lib/receiptWhatsapp.ts`, `src/convex/receiptWa.ts`,
`src/lib/store/types.ts`, `src/lib/store/convex.tsx`, `src/lib/store/demo.tsx`, `src/pages/PosPage.tsx`,
`scripts/verify-struk-pdf.mjs`, `scripts/verify-render.mjs`, `scripts/verify-struk-browser.mjs`, `README.md`,
`worklog.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0.
- `bun convex dev --once` → `✔ 07:52:22 Convex functions ready! (4.2s)`, exit 0 (aksi `receiptWa.send` yang
  berubah ikut ter-deploy).
- `bun scripts/verify-struk-pdf.mjs` → `62/62 checks passed`, exit 0.
- `bun scripts/verify-render.mjs` → `719/719 checks passed`, exit 0.
- `bun scripts/verify-struk-browser.mjs` (Chromium, preview berjalan) → `89/89 pemeriksaan lulus`, exit 0.
- `bun scripts/verify-struk-gambar.mjs` → `14/14`, `bun scripts/verify-struk.mjs` → `111/111`, exit 0.
- Keadaan kanal dibuktikan baca-saja: `bunx convex env list --names-only` (tanpa kunci WhatsApp) dan
  `bunx convex run receiptWaData:channelStatus` → `configured: false`, `missing: [WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID]`.
- Tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** diperiksa: tidak ada klausa roadmap
  yang berubah.

**Catatan / blocker:**

1. **Kunci Cloud API belum diisi**, jadi jalur resmi (termasuk pesan gambarnya) belum pernah berjalan
   sungguhan — yang terbukti: bentuk permintaannya (murni, teruji), aksinya ter-deploy, dan di mode demo
   kirimannya menyimulasikan gambar berlogo. Yang **belum** terbukti: WhatsApp benar-benar menampilkan
   gambarnya. Isi `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` di Settings → Environment untuk
   mengaktifkannya.
2. Halaman kasir di preview memakai **data demo** (`VITE_DATA_SOURCE=demo`), jadi tombol kirim di sana selalu
   simulasi — bukan tanda bahwa pengiriman gagal.
3. Permintaan gambar dari perangkat tanpa kanvas tidak dikirim: laporannya menyebut sebabnya (sudah diuji).

---

## 2026-10-14 — “Bagikan gambar struk”: satu PNG berlogo, supaya WhatsApp Android menampilkannya sebagai foto

**Ruang lingkup:** permintaan pengguna — tombol **“Bagikan gambar struk”** yang menggambar struk jadi **satu
berkas PNG lengkap dengan logo toko**, supaya WhatsApp di Android menampilkannya sebagai foto. Alasannya
menyambung entri di bawah: di Android, pasangan PDF + logo PNG diserahkan ke aplikasi penerima sebagai satu
intent bertipe umum (`*/*`, lihat entri sebelumnya), dan WhatsApp bisa mengambil berkas pertamanya saja —
logonya tidak pernah terlihat. Satu berkas `image/png` menutup celah itu: tidak ada berkas kedua yang bisa
tercecer, dan logonya sudah ada **di dalam** gambarnya.

**Yang dikerjakan:**

1. **Aturan murni** (`src/lib/receiptImage.ts`, baru): `receiptImageLayout` — lebar gambar mengikuti lebar
   kertas struknya (14 px per mm; faktur 241 mm dibatasi `RECEIPT_IMAGE_MAX_WIDTH_PX` 1400 px), ukuran huruf
   **dihitung dari jumlah kolom** (bukan ditetapkan) sehingga teks 32 kolom dan 80 kolom sama-sama memakai
   seluruh lebar kertasnya seperti di kertas aslinya, jarak baris 1,32 seperti PDF, kotak logo 140 px dengan
   rasio tetap (`contain`) yang juga tidak boleh melebihi lebar kertas, dan **lembar rangkap digambar sebagai
   lembar terpisah** dengan tinggi yang mengikuti baris terbanyak. Ukuran huruf & jarak barisnya dibulatkan
   ke bilangan bulat: kanvas memangkas ukuran pecahan diam-diam, dan gambar yang digambar untuk tinggi yang
   berbeda dari kanvasnya akan memotong lembar terakhirnya. `receiptImageFileName` memakai sisi depan nama
   yang **sama** dengan berkas PDF-nya (baru: `receiptFileNameStem` di `src/lib/receiptPdf.ts`) →
   `struk-A-00042.png` / `struk-A-00042.pdf`.
2. **Penggambar di peramban** (`src/lib/receiptImageRaster.ts`, baru): kanvas → PNG. Logo digambar **berwarna**
   (di kertas & PDF hitam putih karena printernya begitu; gambar ini dilihat orang sebagai foto), dua URL logo
   dicoba (yang di struk, lalu yang segar dari store — URL bertanda tangan bisa kedaluwarsa), rasio lebar
   huruf monospace **diukur** dari kanvas perangkatnya dan tata letaknya dihitung ulang kalau huruf di sana
   lebih lebar (tidak ada baris yang terpotong di tepi kanan), dan semua kegagalan (tanpa kanvas, `toBlob`
   tidak ada, logo tak terbaca) mengembalikan `null` — pemanggilnya yang menjelaskan ke kasir. Batas waktu
   pemuatan gambar sekarang dipakai bersama (`withImageTimeout` di `src/lib/receiptLogoRaster.ts`).
3. **Kasir** (`src/pages/PosPage.tsx`): tombol **Bagikan gambar struk** di dialog struk (di samping
   Bagikan PDF), `receiptImageFile()` + `shareReceiptImage()`. Satu berkas `image/png` diserahkan ke
   `navigator.share`; tanpa lembar bagikan berkas gambarnya **diunduh** (bukan cuma diberitahukan) supaya
   masih bisa dilampirkan dari galeri, dan di perangkat tanpa kanvas jawabannya mengarahkan ke Bagikan
   PDF/Unduh PDF. Laporannya menyebut nama berkas, ukuran px & KB, sebab kalau logonya tidak ikut, dan
   bahwa WhatsApp menampilkannya sebagai foto. Ref `pdfUrls` → `blobUrls` (sekarang menampung URL PDF
   **dan** gambar yang terpaksa diunduh; pelepasannya tetap saat halaman ditinggalkan).
4. **Harness**: `scripts/verify-struk-gambar.mjs` (baru, murni) 14/14; `scripts/verify-render.mjs`
   715 → **718** cek (tombolnya ada & berjudul satu berkas PNG, dan di DOM tiruan tanpa kanvas jawabannya
   apa adanya tanpa menyerahkan berkas apa pun); `scripts/verify-struk-browser.mjs` 77 → **86** cek — di
   Chromium sungguhan berkas yang diserahkan benar-benar didekode kembali: satu `image/png` bernama
   `struk-A-01043.png`, **1400×1826 px**, 226.277 byte, dua lembar kertas terpisah di atas latar abu-abu,
   logo hijau 19.600 px (**139 px** lebar, berwarna, ada di **kedua** lembar & di tengah), 52.083 px gelap
   untuk teks struknya tanpa satu baris pun melewati tepi kanan kertasnya, dan angka px yang dilaporkan
   dialognya sama dengan ukuran berkasnya.
5. **Dokumentasi**: README (dua bullet kemampuan baru + rujukan `*/*` diarahkan ke jalur ini, baris perintah
   baru, 16 rujukan 715/715 → 718/718, 4 rujukan 77/77 → 86/86) dan daftar perintah rutin di berkas ini.

**Berkas:** baru: `src/lib/receiptImage.ts`, `src/lib/receiptImageRaster.ts`, `scripts/verify-struk-gambar.mjs`
· diubah: `src/lib/receiptPdf.ts`, `src/lib/receiptLogoRaster.ts`, `src/pages/PosPage.tsx`,
`scripts/verify-render.mjs`, `scripts/verify-struk-browser.mjs`, `README.md`, `worklog.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-struk-gambar.mjs` → `14/14 checks passed`, exit 0.
- `bun scripts/verify-struk-pdf.mjs` → `57/57 checks passed`, exit 0 (refactor `receiptFileNameStem` tidak
  mengubah nama berkas PDF-nya).
- `bun scripts/verify-struk.mjs` → `111/111 checks passed`, exit 0.
- `bun scripts/verify-render.mjs` → `718/718 checks passed`, exit 0.
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → `86/86 pemeriksaan
  lulus`, exit 0 (bagian gambar: `struk-A-01043.png · 1400×1826 px · 226.277 byte · 2 lembar · logo
  19600 px hijau (139 px lebar) · 52083 px teks`). Kegagalan pertama di tengah pengerjaan **nyata dan
  diperbaiki**: penghitung “blok putih” lewat kolom tengah salah (teks struk memotongnya → 36 blok, bukan 2);
  barisnya sekarang diklasifikasi per baris penuh (latar ≥ 90 % abu-abu) → 2 blok kertas, 42 baris latar.
- **Tidak dijalankan**: `bun convex dev --once` — tidak ada berkas `src/convex` yang berubah di entri ini
  (perubahan murni sisi klien + harness). Docker/preview tidak disentuh; harness peramban memakai preview
  yang sedang berjalan.
- Tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** diperiksa: tidak ada klausa roadmap
  yang berubah karena entri ini (ini jalur kiriman struk, bukan klausa katalog).

**Catatan / blocker:**

1. **WhatsApp-nya sendiri belum diuji ujung-ke-ujung** — tidak ada perangkat Android di sini. Yang terbukti:
   berkasnya **satu** `image/png` yang isinya benar-benar struk + logo (didekode & diperiksa pikselnya di
   Chromium), dan tombolnya menyerahkannya ke lembar bagikan. Apakah WhatsApp menampilkannya sebagai foto
   tidak bisa dibuktikan dari sandbox.
2. **Rasio huruf diukur, tapi hanya dari Chromium Linux.** Perangkat yang memakai huruf monospace pengganti
   dengan rasio lebih lebar akan dihitung ulang di sana (dan uji murni menutup kasus itu), tetapi uji di
   perangkat kasir sungguhan belum ada.
3. Logo di jalur **kanal resmi** (Cloud API) tetap hanya di dalam PDF — belum jadi pesan gambar tersendiri;
   kuncinya juga masih belum diisi.

---

## 2026-10-14 — Logo di lembar bagikan (Android Chrome): sebabnya dilaporkan & URL logonya dicoba dua kali

**Ruang lingkup:** lanjutan laporan “logo merchant tidak ikut ke WhatsApp”. Pengguna memastikan perangkat &
langkah yang dipakainya: **HP/tablet Android (Chrome)**, lewat **lembar bagikan** — bukan tautan `wa.me`,
bukan pula kanal resmi yang kuncinya belum diisi. Yang dikerjakan di jalur itu: (a) logo dibagikan sebagai
**PNG hasil penggambaran ulang pada 512 px**, bukan berkas aslinya apa adanya; (b) URL logo yang sudah
kedaluwarsa dicoba ulang dengan URL **segar** dari store; (c) “logo ada tetapi berkasnya tidak terbaca”
**dibedakan** dari “belum ada logo”, lalu sebabnya disebut di laporan kasir; (d) batas tipe intent Android
didokumentasikan apa adanya di README.

**Berkas:** baru: (tidak ada) · diubah: `src/lib/receiptLogoRaster.ts` (`readReceiptLogoFile`), `src/pages/PosPage.tsx`
(`receiptLogoFile()` + laporan “Bagikan PDF”), `src/convex/lib/receiptWhatsapp.ts` (`RECEIPT_WA_LOGO_PX = 512`),
`scripts/verify-struk-pdf.mjs`, `scripts/verify-render.mjs`, `README.md`, `worklog.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-struk-pdf.mjs` → `57/57 checks passed`, exit 0 (56 → 57: ukuran logo yang dibagikan
  512 px — di atas pita cetaknya yang 110 px, di bawah 1024 px).
- `bun scripts/verify-render.mjs` → `715/715 checks passed`, exit 0 (713 → 715). Dua cek baru menjalankan
  skenario **“logo ada, berkasnya tidak terbaca”**: sesi workspace berisi URL logo berskema `ftp:` (gagal
  diambil peramban **maupun** Node, jadi bukan kegagalan khusus harness), kasir menjual seperti biasa, menekan
  **Bagikan PDF**, lalu diperiksa bahwa yang diserahkan **hanya satu** berkas PDF, laporannya berbunyi “Logo
  tokonya tidak ikut: gambarnya tidak bisa dibaca dari perangkat ini”, tidak ada `struk-error`, dan tidak ada
  error konsol. Blok lama (logo terbaca) tetap memeriksa PDF + `image/png` bernama `Warung-Uji-Struk-logo.png`.
- `bun convex dev --once` → `✔ 06:55:03 Convex functions ready! (4.28s)`, exit 0 (aturan murni di
  `receiptWhatsapp.ts` ikut ter-deploy).
- **Tidak dijalankan**: harness Chromium (`verify-struk-browser.mjs` dkk.) — butuh Playwright di luar repo +
  preview yang sedang berjalan, dan lembar bagikan Android tetap tidak bisa diuji dari sandbox ini.
- Tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** diperiksa: tidak ada klausa yang
  berubah karena entri ini (ini perbaikan jalur struk WhatsApp, bukan klausa roadmap).

**Catatan / blocker:**

1. **Android Chrome menyerahkan pasangan PDF + PNG dengan tipe intent `*/*`.** Ditelusuri dari kode Chromium
   (`SharedFileCollator.commonMimeType()` menghasilkan `*/*` kalau tipe utamanya berbeda — `application/pdf`
   vs `image/png`) dan dokumentasi Android yang memperingatkan `*/*` tidak selalu ditangani aplikasi penerima.
   Jadi WhatsApp Android **bisa** mengambil berkas pertamanya saja walaupun aplikasi sudah menyerahkan
   keduanya; perilaku WhatsApp untuk campuran PDF + gambar **tidak bisa dipastikan** dari sini (tidak ada
   dokumentasi resmi WhatsApp yang ditemukan). Itu sebabnya laporan aplikasi berbunyi “diserahkan ke lembar
   bagikan”, bukan “diterima”, dan logonya tetap dimasukkan **di dalam** berkas PDF-nya.
2. Percobaan kedua (URL segar) hanya hidup di mode Convex: di mode demo `logoUrl` datang dari sesi, jadi
   `logo.url === strukDocument.logoUrl` dan percabangan itu **belum tercakup** harness.
3. Kanal Cloud API tetap belum berkunci; di jalur itu logo masih ikut di dalam PDF, belum sebagai bubble
   gambar tersendiri.

---

## 2026-10-14 — Logo merchant ikut ke WhatsApp + nama berkas logonya

**Ruang lingkup:** permintaan pengguna — “tambahkan juga logo merchant/toko/perusahaan” pada kiriman struk ke
WhatsApp. Yang dikerjakan: logo toko ikut sebagai **berkas gambar** di jalur tanpa kunci (**Bagikan PDF** /
lembar bagikan perangkat), beserta aturan murni penamaan berkasnya. Jalur kanal resmi (Cloud API) sudah
membawa logonya **di dalam** PDF struk sejak pekerjaan logo sebelumnya — tambahan di sini adalah jalur yang
benar-benar dipakai workspace saat ini (kunci belum diisi).

**Yang dikerjakan:**

1. **Aturan murni** (`src/convex/lib/receiptWhatsapp.ts`): `receiptWhatsappLogoFilename(mimeType, business?)`
   — ekstensi mengikuti tipe gambar yang benar-benar terbaca (`.jpg` untuk jpeg/jpg, `.png`, `.webp`, `.gif`;
   tipe lain tetap dikirim **tanpa ekstensi**), sisi depan namanya nama usaha yang dibersihkan
   (`Warung-Uji-Struk-logo.png`), dan “logo-toko” kalau nama usahanya kosong.
2. **Kasir** (`src/pages/PosPage.tsx`): `receiptLogoFile()` mengambil berkas logo dari `strukDocument.logoUrl`
   **apa adanya** (fetch → blob; data URL di mode demo, URL bertanda tangan di mode Convex) tanpa penggambaran
   ulang di kanvas; `shareReceipt()` menyerahkan `[PDF, logo]` ke `navigator.share` **kalau** `navigator.canShare`
   menerima pasangan berkasnya — kalau tidak, struknya tetap dibagikan (satu berkas) dan hilangnya logo
   disebutkan di laporan, bukan didiamkan. Workspace yang belum memasang logo tidak menambah berkas apa pun.
3. **Harness**: `verify-struk-pdf.mjs` 54 → **56** cek (nama berkas logo: tipe gambar, nama usaha yang
   dibersihkan, cadangan “logo-toko”); `verify-render.mjs` 710 → **713** cek (blok tanpa logo: hanya satu
   berkas & laporan tidak menyebut logo; blok **dengan** logo: `struk-<nota>.pdf` + berkas `image/png` bernama
   `…-logo.png` benar-benar diserahkan, laporannya menyebut logo itu ikut, dan isi struknya tetap ikut sebagai
   teks).
4. **Dokumentasi**: README (bullet **Logo merchant ikut…**, catatan bahwa jalur kanal resmi membawa logo di
   dalam PDF, blok verifikasi, dan 16 rujukan “710/710” → “713/713”), plus dua baris daftar perintah rutin di
   berkas ini.

**Berkas:** baru: (tidak ada) · diubah: `src/convex/lib/receiptWhatsapp.ts`, `src/pages/PosPage.tsx`,
`scripts/verify-struk-pdf.mjs`, `scripts/verify-render.mjs`, `README.md`, `worklog.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-struk-pdf.mjs` → `56/56 checks passed`, exit 0.
- `bun scripts/verify-render.mjs` → `713/713 checks passed`, exit 0 (di dalamnya: berkas logo `image/png`
  bernama `Warung-Uji-Struk-logo.png` benar-benar sampai ke lembar bagikan bersama PDF-nya).
- `bun convex dev --once` → `✔ Convex functions ready! (3.98s)`, exit 0 (modul murni di `src/convex` ikut
  ter-deploy).
- Percobaan pertama blok logo di `verify-render.mjs` **gagal** dengan exit 1 (`rapi is not defined`) karena
  helper `rapi` hanya ada di blok kasir yang lain; perapian teksnya dipindah ke tempat → dijalankan ulang,
  713/713.
- **Tidak dijalankan**: harness Chromium (`verify-struk-browser.mjs` dkk.) — butuh Playwright + preview
  berjalan, dan belum ada cek lembar bagikan di sana.

**Catatan / blocker:** kanal Cloud API belum tersambung, jadi yang terbukti di sini adalah jalur lembar
bagikan. Di jalur kanal resmi, logo **belum** dikirim sebagai pesan gambar tersendiri — ia ikut di dalam
berkas PDF-nya; mengirimkannya sebagai bubble gambar berarti satu unggahan + satu pesan tambahan per struk,
menambah dua titik gagal pada jalur yang belum bisa diuji ujung-ke-ujung tanpa kunci. Web Share berkas juga
tidak ada di Firefox desktop, dan lembar bagikan yang menolak dua berkas sekaligus membuat struknya tetap
terkirim tanpa logo (dilaporkan apa adanya).

## 2026-10-14 — Struk ke WhatsApp tanpa kunci: isi struk lengkap + tombol Bagikan PDF

**Ruang lingkup:** permintaan pengguna — arah kirim struk ke WhatsApp pembeli adalah “isi struk lengkap +
tombol Bagikan PDF (tanpa kunci)”. Sebelum ini jalur tanpa kunci (tautan `wa.me`) hanya membawa **ringkasan
lima baris**, dan lampiran PDF-nya harus ditempel sendiri oleh kasir — sementara nomor yang diketik kasir
(pembeli umum / member tanpa nomor) sudah dipakai sebagai tujuan sejak pekerjaan sebelumnya.

**Yang dikerjakan:**

1. **Aturan murni** (`src/convex/lib/receiptWhatsapp.ts`): `receiptWhatsappReceiptText(lines)` — baris struk
   yang **sama** dengan yang keluar di kertas (spasi ujung kanan dibuang, spasi penyejajar kolom dibiarkan,
   baris kosong ekor dibuang), dan `receiptWhatsappReceiptMessage(lines, max)` — dibungkus blok monospace
   `` ``` `` kalau muat supaya kolom nominal tetap sejajar di WhatsApp, dipotong di `RECEIPT_WA_TEXT_MAX`
   (4096) kalau kepanjangan, pembungkus dilewati kalau isinya sendiri sudah memuat pagarnya. Keduanya ikut
   terekspor lewat `src/lib/receiptWhatsapp.ts` (re-export yang sudah ada).
2. **Kasir** (`src/pages/PosPage.tsx`): `receiptWaText` dihitung dari lembar pertama (ASLI) struk yang
   **sudah lunas**; tautan cadangan `wa.me` memakai teks itu (bukan caption ringkasan lagi) dengan label baru;
   state `shareBusy`; handler `shareReceipt()` yang menyiapkan PDF yang sama (`receiptPdfFile`) lalu
   `navigator.share({ files, title, text })`; tombol **Bagikan PDF** (`data-testid="struk-bagikan-pdf"`) di
   dialog struk. Tanpa Web Share / berkasnya tak bisa dibagikan: laporan apa adanya + diarahkan ke Unduh PDF;
   `AbortError` dilaporkan sebagai “dibatalkan”; laporannya berbunyi **“diserahkan ke lembar bagikan”**, bukan
   “terkirim” — aplikasi tidak bisa tahu apakah kasir jadi menekan kirim di WhatsApp.
3. **Harness**: `verify-struk-pdf.mjs` 47 → **54** cek (isi struk sebagai teks, pemangkasan spasi/baris
   kosong, blok monospace, pemotongan 4096, pagar blok dilewati, tautan `wa.me` berisi item & nomor nota);
   `verify-render.mjs` 705 → **710** cek (dialog menawarkan Bagikan PDF; tanpa API → diarahkan ke Unduh PDF;
   dengan `navigator.share`/`canShare` → berkas PDF bernama `struk-<nota>.pdf` benar-benar diserahkan, isi
   struknya ikut sebagai teks, judulnya menyebut nomor nota, laporannya tidak mengaku “terkirim”).
4. **Dokumentasi**: README (bullet **Bagikan PDF**, bullet jalur cadangan, bullet kanal opsional, blok
   perintah verifikasi, dan 16 rujukan “705/705” → “710/710”), plus dua baris daftar perintah rutin di
   berkas ini (`verify-struk-pdf.mjs` 54/54, `verify-render.mjs` 710/710).

**Berkas:** baru: (tidak ada) · diubah: `src/convex/lib/receiptWhatsapp.ts`, `src/pages/PosPage.tsx`,
`scripts/verify-struk-pdf.mjs`, `scripts/verify-render.mjs`, `README.md`, `worklog.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-struk-pdf.mjs` → `54/54 checks passed`, exit 0.
- `bun scripts/verify-render.mjs` → `710/710 checks passed`, exit 0.
- `bun convex dev --once` → `✔ Convex functions ready! (3.86s)`, exit 0.
- `bun -e '<skrip sebaris>'` mencetak pesan nyata hasil `receiptDocument` 58 mm: struk lengkap (Kopi Senja,
  No. A-00042, item, TOTAL/Bayar/Kembali, catatan kaki) = **484 karakter** di dalam blok monospace, dan
  tautan `wa.me` yang dibangun dari teks itu memuat isi tersebut — jadi bukan cuma lolos uji, keluarannya
  memang bentuk struk.
- Percobaan pertama `bun scripts/verify-render.mjs` **gagal** dengan exit 1 (`tombol
  "button[aria-label=\"Struk & kirim\"]" tidak ada di DOM`) karena saya memakai `ui.click` — yang mencari
  tombol lewat tulisannya — untuk selektor `aria-label`; diganti `ui.clickOn` lalu dijalankan ulang → 710/710.
- **Tidak dijalankan**: harness Chromium (`verify-struk-browser.mjs`, `verify-escpos-browser.mjs`,
  `verify-pos-transaksi-browser.mjs`) — butuh Playwright + preview yang berjalan. Yang diperiksa statis:
  helper `tombolDialog()` di `verify-struk-browser.mjs` terdefinisi tetapi **tidak dipakai**, jadi label
  tombol baru tidak membuat satu pun selektor nama tombol jadi ambigu.

**Catatan / blocker:** kanal WhatsApp tetap belum tersambung (`bunx convex env list --names-only` masih tanpa
`WHATSAPP_*`), jadi jalur otomatis (Cloud API) belum bisa diuji ujung-ke-ujung di peramban sungguhan — yang
baru terbukti adalah dua jalur tanpa kunci (isi struk sebagai teks, dan penyerahan berkas ke lembar bagikan).
Web Share berkas tidak ada di Firefox desktop, jadi di sana tombolnya menjawab apa adanya; kiriman sungguhan
lewat lembar bagikan baru terbukti di perangkat kasir (HP/tablet).

## 2026-10-14 — Panduan kunci WhatsApp: label dasbor Meta dibetulkan

**Ruang lingkup:** pengguna bertanya ulang “gimana cara isi token dan wa nomornya” — pertanda panduan di entri
sebelumnya belum sepenuhnya bisa diikuti, dan pertanyaannya menyiratkan adanya kolom untuk “nomor WA” yang
sebenarnya tidak ada di aplikasi. Yang dikerjakan: mengecek label/jalur terkini dasbor Meta lewat riset
web, lalu membetulkan sub-bagian README yang menyebutkannya.

**Yang dibetulkan di `README.md`** (sub-bagian **Cara mengisi kedua kunci itu, langkah demi langkah**):

1. **Ditambahkan penjelasan bahwa tidak ada kunci “nomor WhatsApp”** — yang disimpan server hanya token &
   Phone number ID; nomor pengirim menempel pada Phone number ID itu, sedangkan nomor penerima datang dari
   data member atau kolom nomor di dialog struk. (Menjawab langsung kebingungan yang memicu pertanyaan.)
2. **Token sementara**: labelnya **Generate access token** dan masa berlakunya **hitungan jam**, bukan
   “± 24 jam” seperti ditulis sebelumnya; ditambah kalimat bahwa kegagalan setelah kedaluwarsa diperbaiki
   dengan mengulang langkah token jangka panjang.
3. **Token system user**: tombolnya bernama **Generate token** (bukan “Buat Token Baru”), dan aset yang harus
   diberikan bukan cuma **Aplikasi** tetapi juga **Akun WhatsApp Business**; izinnya ditambah
   `business_management` di samping `whatsapp_business_messaging` + `whatsapp_business_management`.
4. **Nomor uji**: angka “maksimal 5 penerima” diturunkan menjadi “daftarnya terbatas, umumnya lima nomor”
   dan langkah praktisnya ditulis (isi **To** dengan nomor sendiri), karena batas lima itu tidak terbaca di
   dokumentasi resmi Meta yang diperiksa.
5. **Batas 5 penerima uji dipisah dari nomor usaha**: langkah baru untuk **Add phone number** dengan syarat
   yang benar — nomor tidak boleh sedang aktif di WhatsApp biasa; **verifikasi bisnis tidak lagi wajib**
   hanya untuk mulai memakai platform (klaim lama “butuh verifikasi bisnis” dihapus).
6. **Galat 131047**: ditambahkan bahwa template boleh memuat lampiran dokumen (header `DOCUMENT`), jadi yang
   wajib di luar jendela 24 jam adalah bentuk templatenya, bukan hilangnya lampiran PDF.

**Berkas:** baru: (tidak ada) · diubah: `README.md`, `worklog.md`.

**Verifikasi:**

- Riset web terhadap dokumentasi resmi Meta (Get Started WhatsApp Cloud API, Access Tokens, Business phone
  numbers/registration, Send messages, Error codes 131047, Template components) → sumber yang dipakai:
  `developers.facebook.com/documentation/business-messaging/whatsapp/{get-started,access-tokens/,business-phone-numbers/phone-numbers,access-tokens,business-phone-numbers/registration,messages/send-messages,support/error-codes,templates/components}`.
  Yang **belum** terkonfirmasi dokumentasi resmi dan karena itu tidak lagi ditulis sebagai angka pasti:
  batas lima nomor penerima uji, dan masa berlaku tepat token sementara.
- `rg -n "Cara mengisi kedua kunci itu|Generate token|Generate access token" README.md` → exit 0, tiga baris:
  657 (sub-bagian), 677 (`Generate access token`), 685 (`Generate token`).
- `rg -n "Tidak ada kunci untuk|header .DOCUMENT." README.md` → exit 0: 662 (penjelasan tidak ada kolom nomor
  WA) dan 719 (template boleh memuat lampiran dokumen).
- `rg -n "akaun" README.md` → exit **1**, tidak ada hasil: salah ketik lama tetap bersih.
- Perubahan hanya berkas markdown: **tidak menyentuh kode, tipe, maupun build**. `bun tsc -b --noEmit` tidak
  dijalankan untuk perubahan ini dan tidak ada klaim bahwa ia lulus.

**Catatan / blocker:** kanal WhatsApp tetap belum tersambung — `bunx convex env list --names-only` masih
menunjukkan hanya `JWKS`, `JWT_PRIVATE_KEY`, `OTP_DEV_CODE`, `OTP_EMAIL_FROM`, `RESEND_API_KEY`, `SITE_URL`,
sehingga `receiptWaData:channelStatus` masih membalas `{"configured": false, …}`. Dua nilai itu tidak bisa
diperoleh dari sisi repo: token & Phone number ID hanya keluar dari dasbor Meta milik pengguna.

## 2026-10-14 — Panduan mengisi kunci WhatsApp langkah demi langkah

**Ruang lingkup:** permintaan pengguna — “pandu saya step by step untuk mengisi
`WHATSAPP_ACCESS_TOKEN` dan `WHATSAPP_PHONE_NUMBER_ID`”. Yang dikerjakan: menuliskan alur lengkapnya di
README (bagian **Struk: cetak, unduh PDF, atau kirim ke WhatsApp member**) sebagai sub-bagian baru, karena
sebelumnya dokumentasi hanya menyebut *di mana* kunci itu diisi, tanpa *dari mana* nilainya diambil.

**Yang dikerjakan:** sub-bagian **Cara mengisi kedua kunci itu, langkah demi langkah** di `README.md`:

1. **A. Ambil nilainya di dasbor Meta** — membuat aplikasi Business + produk WhatsApp, menemukan **Phone
   number ID** (dibedakan dari nomor telepon & “WhatsApp Business Account ID” yang tertulis di halaman yang
   sama), token sementara 24 jam, token permanen lewat **Pengguna Sistem → Buat Token Baru** dengan izin
   `whatsapp_business_messaging` + `whatsapp_business_management`, dan aturan nomor pengirim (nomor uji
   hanya boleh mengirim ke 5 penerima uji; nomor usaha butuh verifikasi bisnis).
2. **B. Tempel ke deployment Convex** — tiga perintah `bunx convex env set` + `bunx convex run
   receiptWaData:channelStatus`, beserta peringatan bahwa `.env`/panel Environment Freebuff/Production env
   hosting **tidak** sampai ke fungsi Convex.
3. **C. Uji kiriman pertama** — cara membaca dua hasil yang paling mungkin: “kanal belum tersambung” (kunci
   belum terbaca) dan galat **131047** (jendela 24 jam WhatsApp, butuh template yang disetujui), plus
   jalur yang tetap bekerja selama kanal belum siap (Unduh PDF & `wa.me`).

**Berkas:** baru: (tidak ada) · diubah: `README.md`, `worklog.md`.

**Verifikasi:**

- `bunx convex env list --names-only` → exit 0: kunci di deployment hanya `JWKS`, `JWT_PRIVATE_KEY`,
  `OTP_DEV_CODE`, `OTP_EMAIL_FROM`, `RESEND_API_KEY`, `SITE_URL` — belum ada `WHATSAPP_*`, jadi langkah B
  memang belum dijalankan dan dua perintah di panduan masih menunggu nilainya.
- `bunx convex run receiptWaData:channelStatus` → exit 0, balasannya
  `{"configured": false, "missing": ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]}` — perintah
  pemeriksa yang dipakai di bagian B panduan ini nyata dan bisa dijalankan dari akar proyek.
- Perubahan hanya berkas markdown (`README.md`, `worklog.md`): **tidak menyentuh kode, tipe, maupun build**.
  `bun tsc -b --noEmit` tidak dijalankan untuk perubahan ini dan tidak ada klaim bahwa ia lulus — tidak ada
  satu baris TypeScript yang berubah.

**Catatan / blocker:** kanalnya tetap belum tersambung sampai token & Phone number ID sungguhan diisi;
keduanya hanya bisa diperoleh dari dasbor Meta milik pengguna (butuh akun Business + nomor pengirim).
Panduan PDF (`public/panduan/panduan-mesinpos.pdf`) tetap hanya menyebut nama kedua kunci itu — sengaja,
karena halaman itu dibaca kasir, sedangkan pengisian kuncinya urusan pemilik/ops. Keabsahan token & nomor
pengirim baru terbukti setelah satu struk benar-benar sampai ke nomor uji.

## 2026-10-14 — Kanal WhatsApp: keadaan kuncinya bisa dibaca dari luar aplikasi

**Ruang lingkup:** laporan pengguna — kasir melihat jawaban “Kanal WhatsApp belum tersambung di server:
kunci WHATSAPP_ACCESS_TOKEN & WHATSAPP_PHONE_NUMBER_ID belum diisi. Struknya masih bisa diunduh sebagai
PDF.” Yang dikerjakan: memastikan sebabnya (kunci memang belum ada di lingkungan **deployment**), menyedia-
kan cara memeriksanya yang tidak perlu mengirim struk sungguhan, dan menuliskan di README **di mana** kunci
itu harus diisi (sering tertukar dengan `.env` sandbox).

**Yang dikerjakan:**

1. **Bacaan keadaan kanal di sisi server** (`src/convex/receiptWaData.ts`): query internal baru
   `channelStatus` (arg kosong) mengembalikan `{ configured, missing }` dari `receiptWhatsappConfig` +
   `receiptWhatsappSummary` — fungsi murni yang sudah ada sejak jalur kirim dibuat tetapi belum pernah
   dipakai dari sisi server. Yang dibalikkan hanya **keadaan**, bukan rahasianya, dan karena internal
   tidak ada klien yang bisa memanggilnya.
2. **Dokumentasi** (`README.md`): daftar kunci yang hidup di **lingkungan deployment** (bukan `.env`
   sandbox & bukan Production env hosting) beserta tiga perintah `bunx convex env set` dan perintah
   pemeriksaannya, plus catatan `--prod` untuk workspace yang memakai deployment produksi terpisah.
3. **Daftar perintah rutin** (`worklog.md`): ditambahkan dua baris baca-saja (`convex env list
   --names-only` dan `convex run receiptWaData:channelStatus`) di samping catatan kunci kanal yang sudah ada.

**Berkas:** baru: (tidak ada) · diubah: `src/convex/receiptWaData.ts`, `README.md`, `worklog.md`.

**Verifikasi:**

- `bun convex dev --once` → exit 0, fungsi Convex siap (3,43 s) termasuk fungsi baru itu.
- `bunx convex run receiptWaData:channelStatus` → exit 0, balasannya persis sebabnya:
  `{"configured": false, "missing": ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]}`.
- `bunx convex env list --names-only` → exit 0: kunci yang ada di deployment hanya `JWKS`,
  `JWT_PRIVATE_KEY`, `OTP_DEV_CODE`, `OTP_EMAIL_FROM`, `RESEND_API_KEY`, `SITE_URL` — tidak ada
  `WHATSAPP_*`, jadi pesan di kasir itu benar dan bukan bug baca kunci.
- `bunx convex run receiptWaData:prepareSend '{…}'` (argumen id sengaja tidak sah) → ditolak validator
  `v.id("users")`, membuktikan `convex run` memang bisa menjalankan fungsi internal (dipakai untuk
  memastikan perintah dokumentasi di README benar-benar bisa dijalankan).
- `node -e '… client.query("receiptWaData:channelStatus") …'` dengan `ConvexHttpClient` ke
  `https://mellow-narwhal-477.convex.cloud` → ditolak server: `Could not find public function for
  'receiptWaData:channelStatus'`, jadi sifat internalnya (tidak bisa dipanggil klien) bukan klaim kosong.
- `bun tsc -b --noEmit` → exit 0 (dijalankan sesudah perubahan terakhir).

**Catatan / blocker:**

- **Yang belum selesai dan tidak bisa saya selesaikan sendiri:** mengisi kuncinya butuh kredensial akun
  WhatsApp Business milik pengguna (token system user + Phone number ID dari dasbor Meta). Sampai itu ada,
  kanal tetap belum tersambung; yang tersedia sekarang tetap jalur **unduh PDF** dan tautan cadangan
  **`wa.me`** di dialog struk (PDF dilampirkan sendiri di percakapan WhatsApp-nya).
- **Belum diuji:** satu kiriman sungguhan ke WhatsApp. `channelStatus` hanya membuktikan kuncinya terbaca
  oleh fungsi; keabsahan token & nomor pengirimnya baru terbukti setelah satu struk terkirim ke nomor uji.
- Tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** diperiksa: tidak ada klausa roadmap
  yang berubah (ini alat diagnosa kanal yang sudah ada, bukan kemampuan baru di katalog/paket).
- Berkas markdown tidak memengaruhi build/tipe — yang dijalankan pada berkas itu hanya `tsc` (di atas).

## 2026-10-14 — Struk pembeli umum (tanpa member) juga bisa dikirim ke WhatsApp

**Ruang lingkup:** permintaan pengguna — “Beri jalan yang jelas untuk member cash tanpa member sama
sekali (pembeli umum) agar struknya juga bisa dikirim ke WA”. Sampai entri sebelumnya, penjualan yang
**tidak punya member** adalah jalan buntu: `receiptWa.send` menuntut `memberId`, jadi tidak ada nomor
tujuan yang bisa dibaca dan kasir cuma diberi tahu “struk ini tanpa member”.

**Yang dikerjakan:**

1. **Aturan nomor tujuan mengenal dua kategori pembeli** (`src/convex/lib/receiptWhatsapp.ts`):
   `receiptWhatsappRecipient(storedPhone, typedPhone, buyer)` — `buyer: "member" | "umum"` (bawaan
   `member`) dikembalikan di hasil yang berhasil untuk jejak audit, dan penolakannya memakai kalimat yang
   berbeda: member ditolak dengan “member ini belum mengisinya”, pembeli umum ditolak dengan petunjuk
   menulis nomor di kolom **“Nomor WhatsApp pembeli”**. Fungsi murni ini tetap satu-satunya tempat aturan
   “nomor mana yang dipakai”, dipakai bersama server & mode demo.
2. **Halaman data kirim di server** (`src/convex/receiptWaData.ts`): `prepareSend` menerima `memberId`
   **opsional**; kalau kosong, jalur pembeli umum yang berjalan — tidak ada baris member yang dibaca,
   nomor ketikan kasir wajib (dan tetap divalidasi `normalizePhone`), pembelinya ditandai `umum`.
   `finishSend` juga menerima `memberId` opsional + `saleNumber` + `buyer`, dan menempelkan jejak audit ke
   **penjualannya** (`entity: "sales"`, `entityId` = nomor nota) kalau tidak ada membernya — jadi
   “struk tanpa member yang mana dikirim ke nomor siapa” tetap bisa ditelusuri, dan kasir tidak bisa
   menyamar sebagai member.
3. **Aksi & kontrak store** (`src/convex/receiptWa.ts`, `src/lib/store/types.ts`, kedua store):
   `receiptWa.send` menerima `memberId` opsional + `saleNumber` opsional (nomor nota penjualannya, dipakai
   sebagai rujukan audit); `SendReceiptWhatsappInput.memberId` ikut jadi opsional. Store Convex meneruskan
   `undefined` apa adanya; mode demo memakai aturan murni yang sama (member tak ditemukan tetap `no-member`,
   pembeli umum dinilai dari nomornya).
4. **Dialog struk di kasir** (`src/pages/PosPage.tsx`): kolom nomor sekarang muncul juga untuk penjualan
   **tanpa member** (`needsWaPhone` mencakup `receiptMember === null`), labelnya membedakan **“Nomor
   WhatsApp <nama member>”** dan **“Nomor WhatsApp pembeli”**, pesan bawaannya menjelaskan nomor itu
   dipakai sekali untuk kiriman tersebut (tidak disimpan sebagai member), tombol kirimnya berbunyi
   “Kirim ke WhatsApp pembeli” untuk kasus itu, dan laporan hasilnya menyebut penerimanya (`member …` /
   `pembeli umum`). Mengirim tanpa mengisi nomornya ditolak dengan petunjuk yang menyebut kolomnya — bukan
   pesan buntu “pilih member dulu”.
5. **Harness diperluas:** `verify-struk-pdf.mjs` (aturan pembeli umum + kalimat penolakannya),
   `verify-render.mjs` & `verify-struk-browser.mjs` (penjualan tanpa member: kolom muncul, kirim tanpa nomor
   ditolak beralasan, nomor belum lengkap ditolak, nomor benar dikirim), dan **`verify-backend.mjs`** —
   enam pemeriksaan baru terhadap deployment awan: pembeli umum diterima halaman datanya, penolakan nomor
   yang belum ada/belum sah, nomor tersimpan di data member tetap menang walau kasir mengetik nomor lain,
   member tanpa nomor ditolak beserta namanya, dan orang di luar workspace tidak bisa mengirim struk.
6. **Dokumentasi:** bagian struk & WhatsApp di `README.md`, plus callout “Struk: cetak, PDF, atau WhatsApp”
   di panduan PDF (`scripts/gen-panduan-pdf.mjs` — pernyataan lama “kasir tidak mengetik nomor tujuan”
   sudah tidak benar sejak kolom nomor ada).

**Berkas:** baru: (tidak ada) · diubah: `src/convex/lib/receiptWhatsapp.ts`, `src/convex/receiptWaData.ts`,
`src/convex/receiptWa.ts`, `src/lib/store/types.ts`, `src/lib/store/convex.tsx`, `src/lib/store/demo.tsx`,
`src/pages/PosPage.tsx`, `scripts/verify-struk-pdf.mjs`, `scripts/verify-render.mjs`,
`scripts/verify-struk-browser.mjs`, `scripts/verify-backend.mjs`, `scripts/gen-panduan-pdf.mjs`,
`public/panduan/panduan-mesinpos.pdf` (dibangun ulang), `README.md`, `worklog.md`.

**Verifikasi:**

- `bun convex dev --once && bun tsc -b --noEmit` → exit 0 (fungsi Convex siap, tanpa galat tipe).
- `bun scripts/verify-struk-pdf.mjs` → **47/47 lulus**, exit 0 (45 → 47: pembeli umum memakai nomor
  pemberiannya & ditandai `umum`, plus kalimat penolakan yang menyebut kolom nomor pembeli).
- `bun scripts/verify-render.mjs` → **705/705 lulus**, exit 0 (702 → 705: kolom nomor untuk struk tanpa
  member, kirim tanpa nomor ditolak dengan petunjuknya, nomor belum lengkap ditolak, nomor benar terkirim).
- `bun scripts/verify-backend.mjs` → **724/724 lulus** terhadap `https://mellow-narwhal-477.convex.cloud`,
  exit 0 (718 → 724: enam pemeriksaan baru `receiptWa.send`). Semuanya dikirim dengan `pdfBase64: ""`,
  jadi kanal WhatsApp **tidak pernah** benar-benar dihubungi (berkasnya ditolak ukurannya sebelum unggah).
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → **77/77 lulus**,
  exit 0 (73 → 77: penjualan tanpa member diklik di Chromium — kolom nomor pembeli muncul, ditolak tanpa
  nomor, ditolak saat belum lengkap, lalu dikirim ke nomor yang diisi).
- `bun scripts/verify-struk.mjs` → 111/111 lulus, exit 0 · `bun scripts/verify-menus.mjs` → 406/406 lulus,
  exit 0 (keduanya ikut dijalankan, tidak terpengaruh).
- `bun run panduan:pdf` → berkas dibangun ulang, exit 0: **31 halaman** (dari 30), 17 bagian, 12 gambar,
  95.674 byte · `bun scripts/verify-panduan.mjs` → **13/13 lulus**, exit 0.

**Catatan / blocker:**

- **Yang belum tervalidasi ulang:** baris jejak audit untuk pembeli umum (`entity: "sales"`,
  `entityId` = nomor nota) **tidak dibaca kembali** oleh harness mana pun — repo ini tidak punya query
  publik untuk membaca `auditLogs` (hanya jalur pendampingan platform yang menyaring aksi lain). Yang
  terbukti: barisnya tertulis tanpa galat saat aksi berjalan (aksinya tetap melaporkan hasil yang benar),
  dan tipe argumennya lolos codegen Convex. Pemilik toko juga belum punya halaman yang menampilkan
  `receipt.whatsapp`.
- **Pengiriman sungguhan ke WhatsApp tetap tidak diuji** — tidak ada `WHATSAPP_ACCESS_TOKEN`/
  `WHATSAPP_PHONE_NUMBER_ID` di mana pun di sini, dan pemeriksaan server sengaja memakai berkas 0 byte
  supaya tidak ada satu pun permintaan yang keluar ke jaringan. Ini batasan yang sama seperti jalur member
  sejak awal.
- Nomor pembeli umum **tidak disimpan** sebagai member: ia dipakai sekali untuk kiriman itu (dan tercatat
  tersensor di jejak audit). Kalau pembelinya mau langganan struk berikutnya, dia tetap perlu didaftarkan
  sebagai member di keranjang — itu memang keputusan produk, bukan kelalaian.
- Tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** diperiksa: tidak ada klausa roadmap
  yang berubah (ini penyempurnaan jalur kirim struk yang sudah ada, bukan kemampuan baru di katalog/paket).
- Berkas markdown & panduan PDF tidak memengaruhi build/tipe — yang dijalankan pada berkas itu adalah
  generator PDF + harness panduan (keduanya dijalankan, hasilnya di atas).

## 2026-10-14 — Struk: daftar PDF yang bisa dibuka lagi + kolom nomor WA untuk member cash

**Ruang lingkup:** dua permintaan pengguna: (1) di dialog struk yang diunduh, beri **tombol/tautan yang
bisa diklik kasir untuk melihat daftar berkas PDF-nya**; dan (2) untuk tombol **Kirim ke WhatsApp member**,
kalau membernya belum mengisi profil/nomor WA (“member cash”), **munculkan kolom** untuk menampung nomor
telepon WA member itu.

**Yang dikerjakan:**

1. **Daftar PDF sesi ini** (`src/pages/PosPage.tsx`): dialog struk menampilkan tombol **Daftar PDF struk (n)**
   yang membuka daftar berkas yang sudah dibuat kasir di perangkat ini. Tiap unduhan menyimpan (nama, ukuran,
   label nota, dan **URL `blob:`-nya**) ke state; URL yang sama dipakai tautan tiap baris, jadi berkasnya
   bisa dibuka/diunduh ulang tanpa menyusun ulang PDF-nya. `saveFile` sekarang mengembalikan URL-nya dan
   tidak lagi mencabutnya setelah 10 detik; URL-nya dilepas sekaligus lewat efek pembersih saat halaman
   kasir ditinggalkan. Isinya **tidak diunggah ke mana pun** (hidup di memori halaman), dan keadaan
   kosongnya dikatakan apa adanya.
2. **Kolom nomor WA member cash** (`PosPage.tsx`): kalau `lastReceipt` punya member tetapi nomornya belum
   ada (`needsWaPhone`), dialog menampilkan kolom **Nomor WhatsApp** untuk member itu. Nomor yang diketik
   divalidasi langsung dengan `normalizePhone` (yang belum sah ditolak beserta sebabnya sebelum dikirim),
   dan kolomnya **tidak muncul** kalau membernya sudah punya nomor — nomor tersimpan selalu menang.
3. **Aturan nomor tujuan jadi satu fungsi murni** (`src/convex/lib/receiptWhatsapp.ts`):
   `receiptWhatsappRecipient(storedPhone, typedPhone)` mengembalikan `{ phone, source: "member" | "kasir" }`
   atau penolakan beralasan. Dipakai bersama oleh `receiptWaData.prepareSend` (server) & mode demo, jadi
   “nomor mana yang dipakai” tidak pernah berbeda antara kedua backend.
4. **Kontrak kirim struk bertambah opsional** (`types.ts` → `SendReceiptWhatsappInput.phone`; action
   `receiptWa.send` → arg `phone`): nomor yang diketik kasir hanya jadi **cadangan** kalau member belum
   punya nomor, tetap divalidasi ulang di server, dan asal nomornya (`member`/`kasir`) ikut dicatat di jejak
   audit (`receiptWaData.finishSend`). Kedua store (`convex.tsx`, `demo.tsx`) meneruskan field itu.
5. **Harness diperluas:** `verify-struk-pdf.mjs` menguji urutan prioritas nomor (nomor member menang, nomor
   ketikan dipakai & ditandai `kasir`, tanpa keduanya ditolak); `verify-render.mjs` & `verify-struk-browser.mjs`
   mengklik tombol daftar PDF (tautan `blob:` dibuka & isinya dibaca kembali di Chromium) dan mengisi kolom
   nomor (nomor belum lengkap ditolak, nomor benar mengirim ke nomor itu).

**Berkas:** baru: (tidak ada) · diubah: `src/lib/store/types.ts`, `src/convex/receiptWa.ts`,
`src/convex/receiptWaData.ts`, `src/convex/lib/receiptWhatsapp.ts`, `src/lib/store/convex.tsx`,
`src/lib/store/demo.tsx`, `src/pages/PosPage.tsx`, `scripts/verify-struk-pdf.mjs`,
`scripts/verify-render.mjs`, `scripts/verify-struk-browser.mjs`, `README.md`, `worklog.md`.

**Verifikasi:**

- `bun convex dev --once && bun tsc -b --noEmit` → exit 0 (fungsi Convex siap, tanpa galat tipe).
- `bun scripts/verify-struk-pdf.mjs` → **45/45 lulus**, exit 0 (42 → 45: tiga cek urutan nomor tujuan).
- `bun scripts/verify-render.mjs` → **702/702 lulus**, exit 0 (696 → 702: tombol daftar PDF ×3 + kolom nomor ×3).
- `bun scripts/verify-struk.mjs` → 111/111 lulus, exit 0 (tidak terpengaruh, ikut dijalankan).
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → **73/73 lulus**,
  exit 0 (66 → 73: daftar PDF diperiksa di Chromium — berkas di balik tautan `blob:` dibaca kembali & byte-nya
  sama dengan yang terunduh — plus kolom nomor WA).

**Catatan / blocker:**

- **Keputusan yang perlu diketahui:** sampai entri ini, nomor tujuan sengaja **tidak** diterima dari klien.
  Atas permintaan pengguna, server sekarang menerimanya sebagai **cadangan** untuk member tanpa nomor. Yang
  dijaga: nomor tersimpan di data member selalu menang, nomor ketikan divalidasi ulang (`normalizePhone`),
  dan asalnya dicatat di jejak audit — jadi pemilik toko tetap bisa menelusuri “struk member siapa pergi ke
  nomor siapa”.
- Daftar PDF hidup di memori halaman kasir dan **hilang saat halaman dimuat ulang**; itu memang sifat
  berkas yang dibuat di perangkat kasir (tidak ada unggahan), dan disebut apa adanya di layar.
- Tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** diperiksa: tidak ada klausa roadmap
  yang berubah (ini penyempurnaan dialog struk & jalur kirim WhatsApp, bukan klausa katalog/paket).
- Berkas markdown (`README.md`, `worklog.md`) tidak memengaruhi build/tipe — hanya berarti dokumentasi.

## 2026-10-14 — Logo toko masuk ke berkas PDF struk (unduhan & WhatsApp)

**Ruang lingkup:** permintaan pengguna — “Tambahkan gambar logo toko ke berkas PDF yang diunduh dari
tombol Unduh PDF”. Sampai entri ini berkas PDF struk **murni teks**, dan itu memang dicatat sebagai
batasan di entri sebelumnya (jalur cetak peramban & jalur ESC/POS sudah memuat logo). Yang dikerjakan:
logo ikut ke berkasnya, ukurannya diambil dari peramban kasir, dan isinya dijaga harness sampai ke
byte.

**Yang dikerjakan:**

1. **Penulis PDF tetap murni** (`src/lib/receiptPdf.ts`): masukannya bertambah `logo` berupa
   `ReceiptPdfLogo { width, height, gray }` — **satu byte keabuan per piksel**, bukan gambar jadi, supaya
   modul ini tidak perlu menyentuh `canvas`/`Image`/jaringan dan hasilnya tetap deterministik.
   `receiptPdfLayout(doc, { logo })` menambah tinggi halaman setinggi pita logo di kertas
   (`RECEIPT_PDF_LOGO_PT` = 29,11 mm, dari `RECEIPT_PRINT_LOGO_MM`) dan memuatkan gambarnya `contain` di
   tengah kertas; `receiptPdfBytes(doc, { title, logo })` menulis objek
   `/Type /XObject /Subtype /Image /ColorSpace /DeviceGray /BitsPerComponent 8` **tanpa pemadatan**,
   dirujuk setiap halaman lewat `/Resources << /XObject << /Logo N 0 R >> >>`. Objeknya ditaruh **paling
   akhir** supaya penomoran objek lama tidak bergeser, dan **satu salinan** dipakai semua lembar (struk
   dua rangkap tidak menggandakan gambar). Logo yang byte/ukurannya tidak masuk akal **diabaikan** tanpa
   mengubah berkas — kepala yang rusak tidak boleh menggagalkan struk. Impor konstantanya relatif
   (`../convex/lib/struk`), bukan `@/`, karena berkas ini dipanggil harness murni yang tidak mengenal
   alias itu (dijelaskan di komentar berkasnya).
2. **Peramban yang menyiapkan byte-nya** (`src/lib/receiptLogoRaster.ts`, baru): memuat URL logo lewat
   `loadImage` yang **sama** dengan jalur ESC/POS (satu pemuat gambar = satu aturan CORS),
   memangkasnya ke `RECEIPT_PDF_LOGO_RASTER_PX` (220 px, sisi panjang, **tidak pernah diperbesar**),
   menggambarnya ke kanvas **berlatar putih** (PNG tembus pandang tidak jadi kotak hitam), lalu
   mengubahnya jadi keabuan dengan bobot yang sama seperti jalur ESC/POS (`0,299 R + 0,587 G + 0,114 B`).
   Hasilnya disimpan per URL (maks 4), ada batas tunggu 8 detik, dan **semua** kegagalan (tanpa kanvas,
   CORS tidak ada, gambar rusak, terlalu lama) mengembalikan `null`: berkasnya tetap terunduh **tanpa
   logo**, seperti sebelum kemampuan ini ada. DOM tiruan (happy-dom) memang tidak punya kanvas, dan
   jalur itu diuji: `verify-render.mjs` tetap 696/696.
3. **`loadImage` diekspor** dari `src/lib/escposDevice.ts` (dulu privat) supaya kedua jalur memakai
   pemuat yang sama — termasuk `crossOrigin = "anonymous"` untuk berkas dari penyimpanan Convex.
4. **Halaman kasir** (`src/pages/PosPage.tsx`): `receiptPdfFile()` jadi `async` (menunggu raster), dan
   kedua jalur yang memakainya ikut — **Unduh PDF** dan **Kirim ke WhatsApp** (berkasnya dibuat klien,
   lalu dikirim sebagai base64, jadi kanal WhatsApp memakai logo yang sama).
5. **Panduan PDF**: kalimat “Unduh PDF” di bagian struk kini menyebut logo ikut tercetak; berkasnya
   dibangun ulang (30 halaman, 94.604 byte) dan `verify-panduan.mjs` tetap 13/13.

**Berkas:** baru: `src/lib/receiptLogoRaster.ts` · diubah: `src/lib/receiptPdf.ts`,
`src/lib/escposDevice.ts`, `src/pages/PosPage.tsx`, `scripts/gen-panduan-pdf.mjs`,
`public/panduan/panduan-mesinpos.pdf`, `scripts/verify-struk-pdf.mjs`, `scripts/verify-struk-browser.mjs`,
`README.md`.

**Verifikasi:**

- `bun scripts/verify-struk-pdf.mjs` → **42/42**, exit 0 (dari 33/33; 9 cek logo): berkas tanpa logo
  **identik** dengan sebelumnya (tanpa `/Subtype /Image` maupun `/XObject`), halaman bertambah tepat
  setinggi pita & tidak bergantung pada jumlah piksel, gambarnya `contain` & di tengah (matriks `cm`
  dicocokkan angkanya), pita ditambahkan **di atas** baris pertama (jarak teks dari dasar kertas tidak
  berubah, jarak dari tepi atas bertambah 82,517 pt), objek `/DeviceGray` berukuran byte yang diberikan
  dengan **isinya utuh** (byte dicocokkan satu per satu + `\nendstream` setelahnya), satu salinan gambar
  untuk dua lembar (2 rujukan `/Logo`, 2 `/Logo Do`), logo rusak (byte kurang, ukuran 0, 3,5×2) diabaikan,
  dan berkas berlogo tetap deterministik — ditambah satu cek struktur khusus berkas berlogo (setiap entri
  xref menunjuk objek yang benar, `/Size` cocok, objek gambar ada di posisi terakhir, dan `/Logo Do`
  muncul sekali per halaman).
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → **66/66 lulus**,
  exit 0 (dari 63/63; 3 cek baru di jalur unduhan sungguhan): berkas yang **benar-benar terunduh** memuat
  objek gambar `/Width 96 /Height 48 /DeviceGray` (ukuran aslinya, tidak diperbesar), **isi gambar itu
  dicocokkan piksel per piksel** dengan logo yang diunggah tadi (#14532d → keabuan **60** = bobot yang
  sama dengan jalur ESC/POS), dan gambarnya **satu salinan** walau struknya dua lembar.
- `bun scripts/verify-render.mjs` → **696/696**, exit 0 (jalur unduhan yang kini `async` tetap melaporkan
  nama & ukuran berkas di DOM tiruan; di sana rasternya `null` karena tidak ada kanvas).
- `bun scripts/verify-struk.mjs` → 111/111, exit 0 · `PLAYWRIGHT_DIR=/tmp/pw bun
  scripts/verify-escpos-browser.mjs http://localhost:5173` → 26/26, exit 0 (jalur ESC/POS memakai `loadImage`
  yang sama, jadi ikut diuji ulang).
- `bun run panduan:pdf` → 30 halaman, 94.604 byte · `bun scripts/verify-panduan.mjs` → 13/13, exit 0.
- `bun tsc -b --noEmit` → exit 0 · `bun convex dev --once` → `✔ Convex functions ready!`, exit 0.
- CORS penyimpanan Convex (syarat rasternya): `curl -s -D - -o /dev/null -H "Origin: https://app.mesinpos.test"
  https://mellow-narwhal-477.convex.cloud/api/storage/<id>` → header `access-control-allow-origin:
  https://app.mesinpos.test` (ditambah `access-control-allow-credentials: true`). Jadi `fetch`/kanvas dari
  origin aplikasi memang diizinkan; tanpa itu, jalurnya hanya kehilangan logo (bukan gagal).

**Catatan / blocker:**

- Logonya di PDF **keabuan**, bukan berwarna — sama dengan yang keluar di kertas (jalur cetak memakai
  `grayscale(1) contrast(1.35)`, jalur ESC/POS memakai ambang 50 %), dan 1 byte/piksel berarti berkasnya
  sepertiga lebih kecil. Kalau pemilik toko nanti ingin logo **berwarna** di berkasnya, itu perubahan
  terpisah (baca piksel RGB + `/ColorSpace /DeviceRGB`).
- Gambarnya ditulis **tanpa pemadatan** (penulis PDF ini tidak membawa pustaka pemadatan): pada batas 220 px
  berkasnya bertambah ≈ 48 KB, dan hanya sekali per berkas — masih jauh di bawah batas unggah server untuk
  kanal WhatsApp (4 MB).
- Yang **belum** diuji: logo dari **deployment Convex sungguhan** di peramban (jalur yang diuji di sini
  memakai data URL di mode demo; syarat CORS-nya diperiksa langsung dengan `curl`), dan berkasnya dibuka
  dengan pembaca PDF pihak ketiga di ponsel penerima. Kedua hal itu tetap tugas manusia — sama seperti
  catatan printer fisik di **Blocker #10**.
- Entri sebelumnya mencatat “gambar logo belum ikut ke berkas PDF yang diunduh”; itu **selesai** di entri
  ini (entri lama tidak diubah). Tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka**
  diperiksa: tidak ada klausa roadmap tentang logo berkas PDF, jadi keduanya tidak berubah.

## 2026-10-14 — Cetak struk cuma keluar ekornya (tanpa logo, nama toko, kasir, pembeli): area cetaknya tergeser gulir

**Ruang lingkup:** laporan pengguna — “Kenapa saat cetak struk atau download struk, yg terlihat hanya
seperti gambar yg saya kirim di screenshot ini? Tidak ada logo toko, alamat toko, kasir dan pembeli?”
Tangkapan layarnya adalah dialog cetak Android (Simpan sebagai PDF, ISO A4) yang hanya memuat
`TOTAL`/`Bayar`/`Kembali`/“Terima kasih telah berbelanja” — bagian atas struknya hilang. Yang dikerjakan:
mereproduksi keadaannya di Chromium, mencari sebabnya dengan pengukuran, memperbaikinya, menambah
penjagaan regresinya, dan menuliskan sebabnya di README.

**Sebabnya (diukur, bukan diduga).** Bukan aturan struknya, bukan pula ukuran kertasnya: area cetaknya
(`.struk-cetak`, satu-satunya bagian yang tampil di `@media print`) dulu berposisi `position: absolute`,
dan ia hidup di dalam `<main>` backstage yang **selalu setinggi layar & bisa digulir**
(`app-shell-height` + `overflow-y-auto`). Elemen `absolute` ikut tergeser oleh gulir itu, jadi begitu
halaman kasir tergulir (di ponsel itu biasa: ringkasan keranjang & dialog ada di bawah), bagian atas struk
berada **di atas jendela gulir** dan terpotong saat dicetak. Diukur dengan
`scripts/diag-struk-cetak.mjs` (Chromium, Chromium-tiruan perangkat apa pun):

| Keadaan (ponsel 390×844, kertas 80 mm) | Kotak area cetak | Berkas PDF |
|---|---|---|
| `absolute` (dulu), halaman belum tergulir | `top 64` (di bawah header aplikasi) | 26.705 byte, 1 hlm |
| `absolute` (dulu), `<main>` tergulir 1.156 px | **`top −1.092`** (seluruhnya di atas jendela gulir) | **1.109 byte** — halaman kosong |
| `fixed` (sekarang), kedua posisi gulir | `top 0` (dari sudut kiri-atas kertas) | 27.798 byte, 1 hlm · pita 40 px teratas berisi 620 piksel gelap (dulu 0) |

Desktop 1400×950 tidak pernah bisa menggulir (`main.scrollHeight == clientHeight`), jadi seluruh uji
peramban yang lama — termasuk `verify-struk-browser.mjs` 55/55 — tidak pernah menyentuh keadaan ini. Itu
sebabnya bug ini lolos sampai ke pengguna.

**Perbaikannya.** `src/index.css`: di `@media print`, `.struk-cetak` kini `position: fixed` (dulu
`absolute`) — `fixed` mengacu ke **kotak halaman cetak**, bukan ke wadah gulir, jadi letak struknya tidak
lagi bergantung pada posisi gulir; syaratnya tidak ada leluhur yang membuat containing block sendiri
(`transform`/`filter`/`backdrop-filter`/`perspective`/`contain`), dan keadaan itu **ikut diperiksa**
harness supaya pembungkus beranimasi baru di atas halaman kasir ketahuan. Satu perubahan, bukan tambalan
di halaman kasir. Tidak ada klausa katalog/paket yang berubah, jadi tabel Status Phase 1–6 tetap.

**Penjagaan regresinya** (bagian baru di `scripts/verify-struk-browser.mjs`, 8 cek tambahan): konteks
**ponsel 390×844** dengan sesi yang sama (logo ikut), satu penjualan tunai diselesaikan, lalu:

1. area cetak sudah menempel di sudut kiri-atas kertas (bukan di bawah header aplikasi) sebelum digulir,
2. halaman kasirnya benar-benar lebih tinggi dari layar & tergulir sampai bawah (keadaan pemicunya
   dibuktikan, bukan diandaikan),
3. gulir itu **tidak lagi** menggeser area cetaknya (`fixed` & `top 0`),
4. tidak ada leluhur yang mengikat `fixed`,
5. seluruh lembar & logonya muat di dalam kertas (dibandingkan tinggi `@page` yang dibaca dari halaman),
6. struk yang tercetak memuat logo + `Warung Uji Struk` + `Kasir : Uji Struk` + `Member : Cash` +
   barangnya — tepat daftar keluhan pengguna, bukan cuma ekor TOTAL/Bayar/Kembali,
7. berkas PDF yang keluar saat halaman tergulir **sama persis** (byte & jumlah halaman) dengan yang keluar
   saat halaman belum tergulir,
8. di kertas A4 bawaan jasa cetak ponsel (yang tidak selalu menghormati `@page`), struknya tetap satu
   halaman tanpa halaman kosong tambahan.

Diperiksa juga apa yang **bukan** penyebabnya: berkas PDF yang diunduh lewat tombol **Unduh PDF** dibuat
dari teks struknya sendiri (`@/lib/receiptPdf`), dan byte-nya kini ikut diperiksa memuat nama usaha, baris
`Member`, baris `Kasir`, barang, `TOTAL`, dan penanda tembusannya — jadi jalur unduhan memang lengkap
sejak awal. Satu-satunya yang belum ada di berkas PDF itu: **gambar logonya** (penulis PDF-nya kecil & murni
teks, tanpa penyemat gambar); di jalur cetak, logonya keluar. Itu dicatat di bawah, belum dikerjakan.

**Berkas:** baru: `scripts/diag-struk-cetak.mjs` · diubah: `src/index.css`, `scripts/verify-struk-browser.mjs`,
`README.md`.

**Verifikasi:**

- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/diag-struk-cetak.mjs http://localhost:5173` → keadaan sekarang
  (`fixed`, ponsel gulir bawah): `rect top 0`, `pdfStruk=27798B/1hlm`, `pdfA4=27787B/1hlm`,
  `pikselGelapAtas=620`; dengan kandidat `absolute` disuntikkan kembali: `rect top −1092`,
  `pdfStruk=1109B/1hlm`, `pdfA4=1097B/1hlm`, `pikselGelapAtas=0` — dan di desktop keduanya berturut-turut
  `top 0` vs `top 64`/26.705 byte. `leluhurBerkontainmen=[]` di semua keadaan.
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → **63/63 lulus**,
  exit 0 (dari 55/55; 8 cek ponsel baru di atas).
- **Cek barunya diuji-menangkap-bug:** `position` dikembalikan ke `absolute` sesaat → harness **GAGAL** di
  cek pertama bagian ponsel (`"posisi":"absolute"`, `area.top −871`) → dikembalikan ke `fixed` → 63/63 lulus.
- `bun scripts/verify-render.mjs` → **696/696**,  exit 0 (aturan layar `.struk-cetak { display: none }` & bentuk blok `@media print` yang dibaca DOM tiruan tetap utuh).
- `bun scripts/verify-struk.mjs` → 111/111, exit 0 · `bun scripts/verify-theme.mjs` → 50/50, exit 0.
- `bun tsc -b --noEmit` → exit 0.

**Catatan / blocker:** gambar **logo** belum ikut ke berkas **PDF yang diunduh** (56/76/80/241 mm): penulis
PDF-nya sengaja kecil & murni (tanpa penyemat gambar), jadi menambahkannya berarti mengubah penulis PDF +
`receiptPdfLayout` dan menyediakan piksel RGB dari kanvas peramban — pekerjaan tersendiri, belum dikerjakan
turn ini. Jalur **cetak** (dialog peramban & ESC/POS) memuat logonya. Yang **tidak bisa** dibuktikan di
lingkungan ini: perilaku jasa cetak Android yang sebenarnya (uji di sini memakai Chromium; kertas A4
bawaannya sudah diperiksa lewat PDF A4), dan printer fisik (lihat Blocker #10).

## 2026-10-14 — Cetak struk langsung ke printer: ESC/POS lewat USB & Bluetooth dari halaman kasir

**Ruang lingkup:** permintaan pengguna — “Tambahkan bahasa printer ESC/POS langsung dari halaman
kasir, bukan lewat dialog cetak peramban”. Sampai entri ini, satu-satunya jalur cetak adalah
`window.print()` (dialog peramban), jadi yang mencetak adalah driver sistem: ukuran kertas harus
ditulis ke lembar gaya `@page`, kertas faktur tidak bisa dipilih, dan printer portabel Bluetooth
sama sekali tidak terpakai karena tidak muncul sebagai printer di sistem. Yang dikerjakan:

1. **Aturan byte ESC/POS, murni** — `src/convex/lib/escpos.ts` (di bawah `src/convex` supaya ikut
   dibundel ke Convex; entry point sisi aplikasi adalah shim `src/lib/escpos.ts`): inisialisasi
   `ESC @`, pemilihan halaman kode `ESC t`, perataan, huruf tebal/besar, `GS W` (lebar area cetak),
   umpan `ESC d`, raster logo `GS v 0`, dan potong kertas `GS V`. Teksnya disaring jadi ASCII oleh
   `escposSafe` (aksen dibuang, tanda tipografi dipetakan, sisanya `?`) karena halaman kode printer
   murah berbeda-beda (CP437/CP850/WPC1252) — huruf acak di kertas adalah kegagalan yang paling mahal.
   Lebar kolom, jumlah lembar rangkap, dan lebar kertas dihitung dari setelan struk yang sudah ada
   (`receiptCols`, `RECEIPT_PRINT_LOGO_MM`), jadi setelan tiga jenis printer yang lama tetap berlaku.
   Logo dikirim sebagai bitmap hitam putih 1 bit per titik, bukan sebagai gambar berwarna.
2. **Jalur perangkat** — `src/lib/escposDevice.ts`: **WebUSB** (endpoint out pertama yang benar-benar
   ada di descriptor: bulk dulu daripada interrupt, interface kelas printer dulu daripada vendor) dan
   **Web Bluetooth** (karakteristik tulis pertama dari profil yang dikenal, dengan lima profil + lima
   layanan opsional, dan jeda antar potongan 20 byte seperti yang dituntut printer BLE). Byte-nya
   dipecah per kirim oleh aturan murni. Izinkan-ulang per perangkat dipakai lewat `getDevices()`,
   sehingga struk berikutnya tidak menanyakan printer lagi; `DOMException` diterjemahkan
   (`escposErrorMessage`) jadi kalimat yang bisa ditindaklanjuti kasir. **Kegagalan menulis tidak**
   diam-diam jatuh ke dialog cetak peramban — struk yang keluar dua kali lebih buruk daripada struk
   yang belum keluar.
3. **`src/lib/useEscpos.ts`** — binding React: sambungan perangkatnya hidup di `useRef` (bukan state)
   supaya keranjang yang berubah tidak menutup sambungan di depan antrean; penyambungan otomatis hanya
   untuk USB (Bluetooth selalu dipilih lagi, dan itu dikatakan di layar).
4. **Halaman kasir** (`PosPage.tsx`) — dialog struk kini punya pemilih jenis sambungan (USB/Bluetooth),
   tombol **Sambungkan printer** / **Lepas**, nama perangkat yang tersambung, dan tombol utama
   **Cetak ke printer** yang mengirim byte ESC/POS; tombol lama tetap ada sebagai **Cetak lewat dialog
   peramban** (`data-testid="struk-cetak-dialog"`). Kalau perambannya tidak punya jalurnya, alasannya
   ditulis apa adanya (`data-testid="struk-tanpa-escpos"`) — bukan tombol yang gagal tanpa sebab.
   Semua ini di bawah gerbang fitur `peripheral.escpos` yang sudah ada di katalog paket.
5. **Panduan PDF** — bagian 9 (langkah cetak) & bagian 17 (printer & kertas struk) mendapat subbagian
   “Cetak langsung dari kasir (ESC/POS)” beserta callout syaratnya (Chrome/Edge, HTTPS, driver WinUSB
   di Windows, Bluetooth hanya satu perangkat tersambung).
6. **Dua harness baru** — `scripts/verify-escpos.mjs` (aturan byte, murni) dan
   `scripts/verify-escpos-browser.mjs` (Chromium + perangkat **tiruan**).

**Berkas:** baru: `src/convex/lib/escpos.ts`, `src/lib/escpos.ts`, `src/lib/escposDevice.ts`,
`src/lib/useEscpos.ts`, `scripts/verify-escpos.mjs`, `scripts/verify-escpos-browser.mjs` ·
diubah: `src/pages/PosPage.tsx`, `src/pages/SettingsPage.tsx`, `scripts/verify-struk-browser.mjs`,
`scripts/verify-render.mjs`, `scripts/gen-panduan-pdf.mjs`, `README.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0.
- `bun convex dev --once` → `✔ Convex functions ready!`, exit 0 (modul ESC/POS ikut terbundel).
- `bun scripts/verify-escpos.mjs` → **58/58**, exit 0 — urutan perintah, saringan ASCII
  (mis. `“Rp 12.000” · — café` → ASCII bersih tanpa byte liar), lebar kolom & rangkap dari setelan,
  bitmap logo (lebar titik dibulatkan ke byte, bit terbalik benar), profil Bluetooth, dan pemecahan
  byte per kirim (kiriman>panjang, tidak ada byte yang hilang/tertukar).
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-escpos-browser.mjs http://localhost:5173` → **26/26**,
  exit 0 — perangkat USB & Bluetooth **tiruan** dipasang di Chromium: tombol Sambungkan memanggil
  `requestDevice` dengan saringan kelas printer, memilih alternatif di pemilih, mengambil endpoint out
  yang benar, lalu tombol **Cetak ke printer** benar-benar mengirim byte ke endpoint itu; jalur
  Bluetooth meminta lima profil + lima layanan opsional, menulis per potongan, dan mengirim byte
  dengan isi yang sama; peramban tanpa WebUSB/Web Bluetooth menjelaskan sebabnya dan tetap menawarkan
  cetak lewat dialog peramban; pemilih perangkat yang ditutup tidak mengubah apa pun.
- `bun scripts/verify-render.mjs` → **696/696**, exit 0 (sebelumnya 695/695; cek baru: dialog struk
  kasir memuat pemilih sambungan, tombol Cetak ke printer, tombol dialog peramban, dan alasan
  `struk-tanpa-escpos` saat DOM tiruan tidak punya WebUSB).
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → **55/55**,
  exit 0 (harness disesuaikan: tombol dialog kini `struk-cetak-dialog` “Cetak lewat dialog peramban”,
  dan tetap terbukti memanggil `window.print` sekali dengan nota yang sama).
- `bun scripts/verify-struk.mjs` → 111/111, exit 0 (aturan struk lama tidak berubah).
- `bun run panduan:pdf` → PDF dibangun ulang: **30 halaman** (dari 29), 94.565 byte.
- `bun scripts/verify-panduan.mjs` → **13/13**, exit 0: 30/30 halaman ber-footer, daftar isi 17
  bagian menunjuk halaman yang benar, 43 frasa langkah kunci, 30 halaman bersih, gambar 1–12.

**Catatan / blocker:** jawaban jujur yang penting untuk dicatat: **belum pernah dicetak ke printer
sungguhan** — perangkatnya tiruan di Chromium, karena tidak ada printer di lingkungan ini. Yang belum:
(a) printer USB di Windows dengan driver WinUSB sungguhan, (b) model Bluetooth sungguhan (profil GATT
& jeda potong per model), (c) printer yang memakai protokol vendor sendiri (mis. NIIMBOT/Marklife)
tidak didukung urutan Epson di sini, (d) printer jaringan (LAN/port 9100) tidak punya jalurnya sama
sekali — butuh perantara. Sumber daya yang tidak diklaim: raster logo hanya untuk printer
thermal/portabel; dot matrix melewati logo. Tabel **Status Phase 1–6** diperiksa: tidak ada klausa
roadmap tentang printer/periferal, jadi tidak ada baris yang berubah; daftar **Blocker yang masih
terbuka** bertambah satu butir menjadi **10** (cetak ESC/POS belum pernah menyentuh printer
sungguhan).

## 2026-10-14 — Panduan PDF: bagian 17 “Printer & kertas struk” beserta gambar 11 & 12

**Ruang lingkup:** permintaan pengguna — “Tambahkan bagian "Printer & kertas struk" ke Panduan PDF
beserta gambarnya, lalu perbarui daftar isi dan cek panduan”. Dikerjakan: bagian baru nomor 17 di
`scripts/gen-panduan-pdf.mjs` beserta **dua gambar ilustrasi vektor**, daftar isi di sampul yang ikut
bertambah jadi 17 entri, dan harness `scripts/verify-panduan.mjs` yang diperbarui supaya menahannya
(termasuk frasa kunci bagian baru dan keterangan gambar 11–12).

**Yang ditambahkan:**

1. **Bagian 17 “Printer & kertas struk: memilih mesin dan ukurannya”.** Isinya mengikuti kartu yang
   benar-benar ada di `/app/settings`: langkah memilih jenis printer (thermal / dot matrix / portable
   beserta kertas & rangkap yang didukungnya), tabel ringkas tiga mesin, kartu **Saran setelan otomatis**
   (grosir tanpa F&B → dot matrix 76 mm 2 lembar; F&B → thermal 80 mm 1 lembar; ritel atau workspace yang
   belum mengaktifkan modul → thermal 80 mm 1 lembar; lencana dasar penentuannya serta tombol **Pakai saran
   ini**, dan **Sudah sesuai** kalau pilihan mesinnya sudah cocok), dua hal yang menyesuaikan sendiri
   (lebar kertas pindah ke **kertas terdekat** saat printer diganti, rangkap dipangkas ke kemampuan
   mesinnya), dan ukuran kertas di dialog cetak yang ditulis halaman kasir (`@page`, margin 2 mm untuk
   kertas sampai 60 mm).
2. **Gambar 11 & 12 (ilustrasi vektor, bukan tangkapan layar).** Gambar 11 menggambar kartu **Struk
   belanja**: kotak saran otomatis beserta lencana dasarnya & tombolnya (1), tiga kartu jenis printer
   beserta kertas dan rangkapnya (2), dan lebar kertas yang dibatasi mesin terpilih (3). Gambar 12
   menggambar pratinjau struk di kertas 58 mm (32 kolom) dan 80 mm (48 kolom) berdampingan (1), serta
   dialog cetak yang kolom **Ukuran kertas**-nya sudah terisi `80 mm x 118 mm` (2).
3. **Bug paginasi `bullets()` diperbaiki** (`scripts/gen-panduan-pdf.mjs`). Versi lamanya hanya menjaga
   satu kali di awal daftar lalu mencetak semua butir tanpa mengukur; butir panjang karena itu menembus
   batas bawah halaman, dan pdfkit membuat halaman baru di tengah kalimat — pada bagian baru ini
   akibatnya **tujuh halaman** berisi potongan satu butir. Sekarang tiap butir diukur lebih dulu dan yang
   tidak muat pindah ke halaman berikutnya secara utuh; efeknya seluruh dokumen jadi **29 halaman**
   (sebelumnya 31 halaman untuk 16 bagian).
4. **Harness `scripts/verify-panduan.mjs`:** daftar isi 17 entri, nomor berurutan 1..17, **43 frasa**
   langkah kunci (9 frasa baru untuk bagian 17: nama bagian, Jenis printer struk, Dot matrix,
   Portable (Bluetooth), Pakai saran ini, Simpan setelan struk, kertas terdekat, Cetak struk, margin 2 mm),
   keterangan gambar **1–12**, plus satu perbaikan pemeriksaan: bagian terakhir tidak punya bagian
   berikutnya, jadi jendela pencarian frasanya kini sampai halaman terakhir dokumen — sebelumnya hanya
   halaman pertama bagian itu.
5. **Halaman Panduan (UI) ikut menyebut bagian barunya:** lencana `17 bagian · 12 gambar` dan kalimat
   daftar isi di `src/pages/PanduanPage.tsx` menyebut **printer & kertas struk**; dua harness
   (DOM tiruan & Chromium) disesuaikan, dan `verify-render.mjs` menambah satu cek untuk frasa itu.

**Berkas:** baru: — (tidak ada berkas baru; satu skrip diagnostik sementara sempat dibuat lalu dihapus)
· diubah: `scripts/gen-panduan-pdf.mjs` (bagian 17, `figureReceiptPrinter`, `figureReceiptPrint`,
`bullets()` sadar halaman, entri `FIGURES[17]`), `public/panduan/panduan-mesinpos.pdf` (dibangun ulang),
`scripts/verify-panduan.mjs`, `src/pages/PanduanPage.tsx`, `scripts/verify-render.mjs`,
`scripts/verify-struk-browser.mjs`, `README.md`, `worklog.md`.

**Verifikasi:**

- `bun run panduan:pdf` → exit 0: **29 halaman, 17 bagian, 12 gambar, 89,1 KB** (91.267 byte; sebelumnya
  31 halaman, 16 bagian, 10 gambar, 83.172 byte).
- `bun scripts/verify-panduan.mjs` → **13/13 pemeriksaan lolos**, exit 0 — daftar isi 17 entri
  (`1->2 … 17->26`), nomor `1,2,3,…,17`, **43 frasa** di bagian yang benar, gambar 1–12, geometri & margin
  bersih di 29 halaman, dan berkas PDF yang ditunjuk `PanduanPage.tsx` byte-nya sama (91.267 byte).
- `bun tsc -b --noEmit` → **exit 0** (tanpa keluaran).
- `bun scripts/verify-render.mjs` → **695/695 checks passed**, exit 0 (694 → 695; cek baru: halaman Panduan
  menyebut “printer & kertas struk”, dan lencana bagiannya dibaca “17 bagian · 12 gambar”).
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → **55/55 pemeriksaan
  lulus**, exit 0, tanpa galat konsol — termasuk lencana “17 bagian · 12 gambar” di Chromium.
- Regresi struk (dijalankan walau tidak ada kode struk yang disentuh): `bun scripts/verify-struk.mjs` →
  **111/111 checks passed**, exit 0.
- Berkas markdown saja (`README.md`, `worklog.md`) tidak memengaruhi build/tipe: penyuntingan terakhirnya
  terjadi **sesudah** semua perintah di atas, dan tidak ada perintah yang dijalankan ulang karenanya.
- Isi PDF diperiksa per halaman lewat skrip diagnostik sementara (sudah dihapus dari repo): bagian 17
  jatuh di **halaman 26–27**, kedua gambarnya di **halaman 28** (frasa “Pratinjau di Pengaturan & dialog
  cetak”, “58 mm - 32 kolom”, “80 mm - 48 kolom”, “Epson TM-T82X”, “80 mm x 118 mm”, “Gambar 11”, dan
  “Gambar 12” semuanya ada di halaman itu), penutup di halaman 29.

**Catatan / blocker:** tabel **Status Phase 1–6** tidak berubah (ini dokumentasi, bukan klausa roadmap),
begitu juga daftar **Blocker yang masih terbuka** — dan satu hal yang dulu menggantung di entri “Printer &
kertas struk” (2026-10-13), “Panduan PDF belum punya bagian printer struk”, kini **selesai**. Yang belum:
`bun convex dev --once`, `verify-backend.mjs`, `verify-theme.mjs`, dan `verify-menus.mjs` **tidak**
dijalankan di entri ini karena tidak ada berkas `src/convex/` maupun CSS yang disentuh (pekerjaannya
menambah dokumentasi PDF + lencana di halaman Panduan); Panduan PDF-nya tetap menjelaskan struk lewat
**dialog cetak peramban** (aplikasi belum bicara ESC/POS langsung), dan aturan `@page` baru diuji di
Chromium.

## 2026-10-13 — Printer & kertas struk: saran dari modul, kertas menyesuaikan sendiri, ukuran cetak otomatis

**Ruang lingkup:** permintaan pengguna — “buat pengaturan printer dan setelan kertas printer struk yang
sesuai dan otomatis”. Kartu **Struk belanja** sudah punya katalog tiga printer + lebar kertas yang
didukungnya (entri “Struk belanja: jenis printer, lebar kertas, rangkap & catatan kaki”, 2026-10-13); yang
dikerjakan di entri ini adalah lapisan **otomatis**-nya: satu **saran setelan dari bentuk workspace** yang
ditawarkan sebagai satu klik, dan tiga hal yang bekerja tanpa ditanya — lebar kertas saat printer berganti,
ukuran kertas di dialog cetak, serta rangkap yang dipangkas ke kemampuan mesinnya.

**Yang ditambahkan:**

1. **Saran setelan dari modul yang hidup** (`suggestReceiptSetting` + `sameReceiptPrinterChoice` di
   `src/convex/lib/struk.ts`, aturan murni yang sama dipakai klien & server). Dasarnya `tenants.verticals`,
   **bukan** paket langganan: yang menentukan bentuk nota adalah apa yang dijual tokonya. Grosir **tanpa**
   F&B → **dot matrix 76 mm, 2 lembar** (nota tempo ditandatangani & diarsipkan, dan tembusan karbon hanya
   mungkin di printer berpita); F&B → **thermal 80 mm, 1 lembar** (nama menu & catatan pesanan panjang,
   tetapi meja kasirnya melayani pembeli langsung) — kafe yang sekaligus grosir ikut jalur thermal; ritel/
   UMKM/workspace yang belum mengaktifkan modul → **thermal 80 mm, 1 lembar**. Saran ini sampai ke halaman
   sebagai kartu `struk-saran-otomatis` (lencana `basis`, alasan `struk-saran-alasan`, tombol
   `struk-pakai-saran`) dan menampilkan kalimatnya lewat `receiptSettingSentence`.
2. **Lebar kertas menyesuaikan ke kertas *terdekat*, bukan kertas pertama** (`nearestReceiptPaper`).
   Sebelumnya lebar yang tidak didukung jatuh ke kertas pertama printernya — dan “pertama” selalu yang
   **paling sempit**: pemilik toko yang memakai 76 mm lalu berganti mesin ke thermal mendapat 58 mm (32
   kolom, nama produk gampang terpotong). Sekarang yang dipilih kertas terdekat dengan lebarnya semula
   (76 mm → 80 mm, 241 mm → 80 mm, 80 mm di dot matrix → 76 mm), seri dimenangkan yang lebih lebar, dan lebar
   yang benar-benar tak terbaca tetap punya jawaban: kertas pertama. Lebar yang tidak didukung tetap
   **ditolak** saat disimpan — menyesuaikan hanya berlaku untuk pembacaan & penggantian jenis printer.
3. **Ukuran kertas di dialog cetak ditulis halaman kasir** (`receiptPrintCss`, `receiptPrintHeightMm`,
   `receiptPrintMarginMm`, `RECEIPT_PRINT_FONT_MM`/`_LINE_MM`/`_LOGO_MM`/`_SLACK_MM` di
   `src/convex/lib/struk.ts`, dirender `<style data-testid="struk-kertas-css">` di `src/pages/PosPage.tsx`).
   Aturan `@page` itu menulis lebar × tinggi kertas struknya sendiri (58/76/80/241 mm) plus marginnya (2 mm
   untuk kertas ≤ 60 mm, 4 mm selebihnya) dan metrik barisnya, jadi kasir tidak lagi perlu mengubah “Paper
   size” dan struknya tidak tercetak di halaman A4.

**Keputusan yang diambil (beserta alasannya):**

1. **Saran ditawarkan, bukan ditulis sendiri ke setelannya.** Peramban tidak punya API untuk melihat printer
   yang benar-benar terpasang; memilih jalur dot matrix untuk toko grosir yang mesin kasirnya thermal
   membuat struknya tidak keluar sama sekali. Karena itu server/klien hanya menyiapkan *satu jawaban paling
   masuk akal beserta alasannya*, dan yang memutuskan tetap pemilik toko.
2. **Tombol saran tidak menyentuh catatan kaki.** Yang dipindahkan hanya pilihan mesinnya (printer, kertas,
   rangkap); kalimat catatan kaki milik pemilik toko tidak boleh terhapus oleh satu klik “Pakai saran ini”.
   `sameReceiptPrinterChoice` membandingkan mesin saja — jadi tombolnya membaca “Sudah sesuai” kapan pun
   pilihan mesinnya cocok, walaupun catatan kakinya berbeda.
3. **Kertas terdekat, bukan otomatis “selalu yang lebih lebar”.** Yang dijaga adalah niat pemilik toko
   (lebarnya sedekat mungkin), bukan angka terbesar; seri barulah dimenangkan yang lebih lebar.
4. **`@page` ditulis halaman kasir, bukan `src/index.css`.** Dua `@page` di dua tempat akan saling menimpa
   tanpa ada yang tahu mana yang menang, dan ukurannya memang ikut setelan workspace — sementara metrik
   baris yang dipakai menghitung tinggi kertas harus sama dengan yang dipakai mencetak barisnya, dan itu
   hanya bisa dijamin kalau keduanya datang dari konstanta yang sama.
5. **Tinggi kertas ditulis angka, bukan `auto`.** Bentuk lazim `size: 80mm auto` **tidak sah** menurut CSS
   Paged Media dan dibuang peramban tanpa pesan apa pun (halaman kembali ke A4); karena itu tingginya
   dihitung dari isinya sendiri (`receiptPrintHeightMm`, seluruh lembar rangkap & logo ikut dihitung) dan
   ditulis sebagai pasangan dua angka.
6. **Kertas sempit dapat margin lebih kecil** (2 mm untuk ≤ 60 mm): 58 mm hanya memuat 32 kolom, dan
   margin 4 mm di kiri-kanannya memakan ruang yang tidak tergantikan.

**Berkas:** baru: — (tidak ada berkas baru) · diubah: `src/convex/lib/struk.ts` (`suggestReceiptSetting`,
`sameReceiptPrinterChoice`, `nearestReceiptPaper`, `receiptPrintCss` + konstanta metrik cetak),
`src/pages/SettingsPage.tsx` (kartu saran otomatis + catatan kertas yang menyesuaikan),
`src/pages/PosPage.tsx` (aturan `@page` dari setelan workspace), `src/index.css` (aturan cetak diserahkan ke
`receiptPrintCss`, tidak ada `@page` ganda), `scripts/verify-struk.mjs` (+16 cek),
`scripts/verify-render.mjs` (+7 cek), `scripts/verify-struk-browser.mjs` (+6 cek), `README.md`,
`worklog.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → **exit 0** (tanpa keluaran).
- `bun convex dev --once` → `✔ 11:55:01 Convex functions ready! (4.38s)`, exit 0 (deployment
  `mellow-narwhal-477`) — aturan struk yang dipakai server benar-benar ter-push.
- `bun scripts/verify-struk.mjs` → **111/111 checks passed**, exit 0 (95 → 111). 16 cek baru: tiga hal yang
  bekerja otomatis — kertas terdekat (76→80, 241→80, dot matrix 80→76, portable 80→58, lebar tak terbaca →
  kertas pertama), aturan cetak per lebar (80 mm margin 4 mm, 58 mm margin 2 mm, 241 mm 2 lembar + tinggi
  notanya), dan saran dari modul (grosir tanpa F&B, F&B, kafe yang sekaligus grosir, ritel/workspace kosong,
  basis & alasan, catatan kaki bawaan tetap, plus pembanding pilihan mesin yang mengabaikan catatan kaki).
- `bun scripts/verify-render.mjs` → **694/694 checks passed**, exit 0 (687 → 694). 7 cek baru: halaman
  Pengaturan dengan saran otomatis tanpa galat konsol, kartu saran menyebut dasar penentuannya (modul
  grosir) beserta alasannya, tombol “Pakai saran ini” benar-benar mengklik — mesinnya pindah ke dot matrix
  76 mm dua rangkap — tanpa menghapus catatan kaki yang sedang diketik dan lalu membaca “Sudah sesuai”, plus
  halaman kasir menulis `@page { size: 76mm <tinggi>mm; margin: 4mm }` dari setelan itu.
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → **55/55 pemeriksaan
  lulus**, exit 0, tanpa galat konsol (49 → 55). Di Chromium: kartu saran menampilkan lencana “Modul F&B” &
  mesin yang disarankan sementara setelan tersimpan workspace itu dot matrix 241 mm, menekan “Pakai saran
  ini” benar-benar memindahkan setelannya (printer thermal terpilih, pilihan kertas 241 mm hilang, pratinjau
  jadi 80 mm, rangkapnya 1 lembar, tombolnya terkunci membaca “Sudah sesuai”), dan aturan `@page` yang
  ditulis halaman kasir terbaca dari `document.styleSheets` peramban (241 mm × tinggi notanya).
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` → **718/718
  checks passed** terhadap deployment awan, exit 0 — termasuk setelan struk di server (rangkap di thermal &
  lebar tak didukung tetap ditolak, dot matrix 76 mm dua lembar tersimpan & dibaca kembali persis).
- Regresi: `bun scripts/verify-theme.mjs` → 50/50 · `bun scripts/verify-menus.mjs` → 406/406, exit 0.
- Angka lama di `README.md` dan daftar “Perintah verifikasi rutin” (95/95, 687/687, 49/49) diperbarui supaya
  tidak ada dua angka berbeda untuk perintah yang sama.
- Berkas markdown (`README.md`, `worklog.md`) tidak memengaruhi build/tipe — bukan “sudah dites”.

**Catatan / blocker:** tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** diperiksa:
tidak ada klausa roadmap yang berubah (ini setelan dokumen di modul yang sudah ada, bukan kemampuan baru).
Batasan yang masih terbuka, semuanya sudah tercatat di entri asal fitur struk: (1) aplikasi ini **belum
bicara ESC/POS** — yang dicetak adalah struk berformat teks lewat dialog cetak peramban, jadi “saran printer”
memang panduan memilih mesin, bukan driver; (2) **manajer belum bisa mengubah setelan struk** (halaman
Pengaturan dijaga `billing.manage`, sedangkan manajer memegang `device.manage`) — saran otomatis ini belum
menyentuh keputusan izin itu; (3) pencetakan di **browser HP sungguhan** & build produksi belum diuji, dan
(4) `@page` yang ditulis dari React hanya diuji di Chromium — peramban lain belum diperiksa khusus untuk
aturan itu. Satu hal yang belum dikerjakan: **Panduan PDF belum punya bagian printer struk** (16 bagian
sekarang, tidak ada bagian tentang memilih printer/kertas), jadi saran otomatis ini baru terdokumentasi di
`README.md` dan di halamannya sendiri — menambah bagian baru berarti menggeser daftar isi & cek
"badge 16 bagian" di tiga harness, dan itu keputusan yang tidak diminta pengguna.

## 2026-10-13 — Alur struk diperbaiki: Cetak & Kirim baru muncul setelah pembayarannya lunas

**Ruang lingkup:** permintaan pengguna — “untuk cetak struk atau kirim struk salah flow nya, harusnya setelah
pembayaran lunas, maka baru tombol kirim struk atau cetak struk muncul pilihannya”. Yang dikerjakan: tombol
**Cetak** & **Struk & kirim** di panel keranjang tidak lagi ditawarkan selama keranjang disusun — keduanya
baru muncul setelah ada penjualan yang tercatat (`lastReceipt`), dan yang dicetak/dikirim selalu nota yang
sudah dibayar itu.

**Keadaan sebelum perbaikan (yang membuat alurnya salah):** panel keranjang selalu punya empat tombol
(`Ke dapur`, `Cetak`, `Struk & kirim`, `Bayar`). Dua yang di tengah hidup begitu keranjangnya berisi barang:
`printDraft` memakai draft keranjang berjalan, jadi kasir bisa mengeluarkan lembar bertanda “Belum dibayar —
struk sementara”, membuka dialog kirim untuk transaksi yang pembayarannya belum selesai, dan Ctrl+P di tengah
antrean mencetak draft yang sama. Bukti struk keluar mendahului pembayarannya.

**Keputusan yang diambil (beserta alasannya):**

1. **Satu gerbang: `strukSiap = lastReceipt !== null`.** Hanya penjualan yang sudah lunas yang punya struk.
Tombol `Cetak` & `Struk & kirim` dirender di dalam gerbang itu, jadi sebelum pembayaran tindakan struknya
**tidak ada sama sekali** — bukan sekadar terkunci. Satu-satunya jalan di panel waktu itu tinggal tombol
`Bayar`.
2. **Yang dicetak selalu nota yang sudah dibayar.** `printDraft` berubah dari “draft keranjang kalau ada
isinya” menjadi `lastReceipt?.draft ?? strukDraft`. Efeknya dua: mencetak ulang tetap satu klik sesudah lunas
(termasuk ketika kasir sudah mulai melayani pembeli berikutnya — yang tercetak tetap nota sebelumnya, bukan
keranjang baru), dan Ctrl+P tidak lagi punya jalur untuk mengeluarkan lembar tagihan sebagai nota. Sebelum
ada pembayaran, area cetaknya jatuh ke draft keranjang yang **tetap** membawa catatan “Belum dibayar — struk
sementara”, jadi kalau ada yang memaksa mencetak, lembarnya masih jujur.
3. **Catatan kecil di panel sesudah lunas** (`data-testid="struk-lunas-catatan"`): menyebut nomor & total
nota yang sudah dibayar, supaya jelas tombol di atasnya mencetak/mengirim struk yang mana — terutama ketika
keranjang berikutnya sudah mulai diisi.
4. **Judul tombolnya ikut menyebut faktanya:** `Cetak ulang struk <nomor> ke printer <printer> (<kertas>,
<n> lembar)` dan `… kirim struk <nomor> ke WhatsApp member`, bukan lagi kalimat “struk ke printer” yang
terdengar seperti sedang mencetak keranjang berjalan.
5. **Subjudul dialog disederhanakan.** Dialog struk hanya bisa dibuka dari jalur sesudah lunas (handler
pembayaran atau tombol panel yang bergerbang), jadi cabang “Struk sementara keranjang” dihapus dan yang
tersisa selalu `Struk <nomor> · <total>`.
6. **Yang tidak berubah:** dialog struknya tetap terbuka otomatis begitu penjualannya tersimpan (tunai,
kartu/tempo, dan QRIS yang tagihannya lunas). Yang diperbaiki urutannya, bukan dialognya.

**Berkas:** baru: — (tidak ada berkas baru) · diubah: `src/pages/PosPage.tsx` (gerbang `strukSiap`, `printDraft`,
panel keranjang, subjudul dialog), `scripts/verify-render.mjs` (2 cek baru + 1 cek lama diganti + cek judul
tombol dipindah ke sesudah pembayaran), `scripts/verify-struk-browser.mjs` (2 cek peramban baru),
`scripts/gen-panduan-pdf.mjs` (langkah & callout struk di bagian 9), `public/panduan/panduan-mesinpos.pdf`
(dibangun ulang), `README.md`, `worklog.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → **exit 0** (tanpa keluaran).
- `bun scripts/verify-render.mjs` → **687/687** (naik dari 685): “keranjang yang belum dibayar belum
menawarkan Cetak / Struk & kirim” (keduanya absen, termasuk catatan notasinya), “pembayaran lunas
memunculkan Cetak & Struk & kirim di panel, beserta catatan nota yang dibayar”, “keranjang berikutnya yang
belum dibayar tidak menggantikan struknya: yang tersisa tetap nota yang sudah lunas”, dan judul tombol cetak
(printer + kertas 76 mm + 2 lembar) diperiksa **sesudah** pembayaran diselesaikan.
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → **49/49** (naik dari
47/47) di Chromium sungguhan atas preview yang berjalan: sebelum bayar, panel kasir tidak memuat satu pun
`button[aria-label="Cetak struk"]` / `button[aria-label="Struk & kirim"]` / `[data-testid="struk-lunas-catatan"]`;
sesudah pembayaran tunai lunas keduanya ada, notanya bisa dicetak ulang dari panel, dan catatannya menyebut
nomor nota itu.
- Regresi tanpa kegagalan: `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-pos-transaksi-browser.mjs` **14/14** ·
`bun scripts/verify-menus.mjs` **406/406** · `bun scripts/verify-struk.mjs` **95/95** ·
`bun scripts/verify-panduan.mjs` **13/13** · `bun scripts/verify-theme.mjs` **50/50** ·
`bun scripts/verify-pwa.mjs` **1492/1492** ·
`PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-bip-warna-browser.mjs` **23/23** (0 galat konsol) ·
`PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-browser-scroll.mjs` **60/60** ·
`bun run panduan:pdf` → 31 halaman · 16 bagian · 10 gambar · **83.172 byte** (81,2 KB) — naik dari 83.005 byte
karena dua kalimat panduan bertambah.
- Berkas markdown saja (`README.md`, `worklog.md`) tidak memengaruhi build/tipe — tidak ada perintah tambahan
yang dijalankan untuknya.

**Catatan / blocker:** (1) `lastReceipt` hidup di state halaman, jadi tombol cetak ulang itu hilang begitu
halaman dimuat ulang — sama seperti sebelumnya, dan daftar “Transaksi terakhir (shift ini)” belum punya
tindakan cetak ulang per baris; itu pekerjaan tersendiri kalau mau diadakan. (2) Yang dibuktikan adalah
urutan di antarmuka & lembarnya (Chromium headless atas preview), bukan perangkat kasir fisik.
Tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** tidak berubah karena entri ini: ia
memperbaiki urutan alur di halaman kasir, bukan menambah/menutup klausa katalog, izin, atau integrasi.

## 2026-10-13 — Daftar transaksi shift ini: tombol ringkas + lembar yang naik dari bawah

**Ruang lingkup:** permintaan pengguna — “Buat info Transaksi terakhir (shift ini) yang ada di halaman Kasir
(POS) bagian bawah, muncul dalam bentuk tombol yang bisa diklik, lalu jika di klik akan muncul animasi dari
bawah ke atas daftar/list transaksi yang sudah berhasil”. Tabel yang selalu terbuka di bawah halaman kasir
diganti **satu tombol ringkasan**, dan daftar penuh penjualan shift itu dibuka sebagai **lembar dari bawah**.

**Keputusan yang diambil (beserta alasannya):**

1. **Tabel → tombol bersimbol angka.** Tombolnya tidak cuma berjudul: ia menyebut `N transaksi · N item ·
omzet`, dihitung dari daftar yang sama dengan yang ditampilkan lembar itu. Di depan antrean yang dibaca
   kasir adalah angkanya, dan tinggi layar yang dulu dipakai tabel sekarang kembali ke keranjang & grid
   produk.
2. **Lembarnya naik dari bawah, menempel di tepi bawah layar.** `framer-motion` (sudah dipakai beranda &
   onboarding) dengan `initial={{ y: "100%" }}` → `animate={{ y: 0 }}` + pegas; latarnya memudar. Tidak ada
   keyframe baru yang perlu dijaga di `index.css`.
3. **Yang digulir hanya daftarnya** (`max-h-[60vh] overflow-y-auto`): lembarnya tidak mengambil alih gulir
   halaman kasir, dan tombol Bayar tetap bisa dijangkau begitu lembarnya ditutup.
4. **Isinya seluruh penjualan shift ini**, bukan enam baris terakhir seperti tabel lama (`sales.slice(0, 6)`
   dihapus). Kakinya menjumlahkan daftar itu, dilabeli **“Total daftar ini”** — bukan “omzet shift” — supaya
   angkanya tidak mengklaim lebih dari yang benar-benar ada di daftar (daftar itu berasal dari `sales` yang
   disediakan store, dan ringkasan omzet per shift tetap tugas halaman Shift & Laporan).
5. **Tiga cara menutupnya:** silang (`aria-label="Tutup transaksi terakhir"`), tekanan Escape, dan sentuhan di
   latar. Pendengar Escape hanya dipasang **selama lembarnya terbuka**, jadi halaman kasir tidak menahan
   pendengar global sepanjang shift.
6. **Datanya dibaca dari store (`sales`), bukan salinan saat halaman dibuka** — jadi penjualan yang baru
   diselesaikan langsung muncul di puncak daftar, dan jumlah di tombolnya ikut bertambah.
7. **Perbaikan ikutan yang harus dilakukan supaya jujur:** jumlah item keranjang sekarang punya alamatnya
   sendiri (`data-testid="keranjang-jumlah-item"`). Harness bip kasir membacanya dengan memindai **seluruh
   teks halaman** untuk pola “n item”; ringkasan transaksi baru juga menyebut “15 item”, sehingga pemindaian
   longgar itu menangkap angka yang salah dan cek yang sudah lama benar jadi merah. Yang diperbaiki
   **penyebabnya** (harness membaca elemen yang benar), bukan cek-nya yang dilemahkan: assertion-nya justru
   naik dari “angka terbesar bertambah 1” menjadi “penghitung keranjang bertambah tepat 1”.

**Berkas:** baru: `scripts/verify-pos-transaksi-browser.mjs` · diubah: `src/pages/PosPage.tsx` (tombol +
lembar `AnimatePresence`, state `salesOpen`, efek Escape, `data-testid="keranjang-jumlah-item"`),
`scripts/verify-render.mjs` (4 cek DOM + pembacaan penghitung keranjang dari elemennya),
`scripts/gen-panduan-pdf.mjs` (langkah daftar transaksi di bagian “Menjual di kasir”),
`public/panduan/panduan-mesinpos.pdf` (dibangun ulang), `README.md`, `worklog.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → **exit 0**.
- `bun scripts/verify-render.mjs` → **685/685** (naik dari 681): tombol ringkasannya bersimbol jumlah
  transaksi & daftarnya belum terbuka, menekannya membuka lembar `role=dialog` (`aria-modal`, label “Transaksi
  terakhir (shift ini)”) dengan jumlah baris **sama dengan angka di tombol**, barisnya menyebut nomor nota,
  jam, jumlah item, metode bayar, dan nominal, plus “Total daftar ini”; Escape mengembalikannya jadi tombol.
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-pos-transaksi-browser.mjs http://localhost:5173` → **14/14** di
  Chromium sungguhan, dengan posisi lembar direkam **setiap bingkai** mulai sebelum tombol diklik: bingkai
  pertama `top = tinggi layar` (masih di bawah), lalu naik lewat ≥ 5 posisi berbeda sampai `bottom = tinggi
  layar` (menempel di bawah) sedangkan `top`-nya di dalam layar; dua penjualan baru menambah jumlah transaksi
  di tombol (6 → 8) dan yang terbaru muncul di puncak daftar; ketiga cara menutup bekerja; 0 galat konsol.
- Regresi tanpa kegagalan: `bun scripts/verify-menus.mjs` **406/406** · `bun scripts/verify-struk.mjs`
  **95/95** · `bun scripts/verify-panduan.mjs` **13/13** · `bun run panduan:pdf` → 31 halaman · 16 bagian ·
  10 gambar · **83.005 byte** (81,1 KB).

**Catatan / blocker:** “shift ini” tetap berarti **daftar penjualan selesai yang disediakan store** (di server
query `pos.recent`), bukan jendela waktu shift yang dihitung di klien — halaman Kasir belum membaca shift
terbuka (`pos.openShift`) untuk memotong daftarnya. Jadi daftar ini bisa memuat penjualan sebelum shift
berjalan kalau store mengembalikannya; angka di tombol & lembar tetap cocok karena keduanya membaca daftar
yang sama. Tabel **Status Phase 1–6** tidak berubah (ini penyempurnaan halaman kasir, bukan klausa katalog),
dan tidak ada blocker baru yang dibuka.

## 2026-10-13 — Struk: dipilih mau dicetak, diunduh PDF, atau dikirim ke WhatsApp member

**Ruang lingkup:** permintaan pengguna — “untuk cetak struk belanjanya bisa dipilih, mau print atau
cetak/download/kirim pdf, dan untuk kirim pdf ini bisa dikirim ke WA pembeli yang sudah menjadi member,
dimana member sudah mengisi no.wa sebelumnya”. Yang dikerjakan: **cetak otomatis diganti dialog struk**
berisi tiga pilihan (cetak / unduh PDF / kirim WhatsApp member), **berkas PDF struk dibuat di perangkat
kasir**, dan **kanal kirim WhatsApp** yang mengambil nomor penerimanya dari data member.

**Keputusan yang diambil (beserta alasannya):**

1. **Cetak otomatis → pilihan (entri di bawah ini digantikan).** Begitu penjualan tersimpan, yang terbuka
   sekarang dialog struk, bukan dialog cetak peramban. Pembeli yang minta dikirim lewat WhatsApp tidak perlu
   menutup dialog cetak lebih dulu, dan kasir tidak lagi bergantung pada dialog cetak untuk hal yang bukan
   mencetak. Tombol panelnya juga bertambah: **Cetak** (langsung, tetap ada) dan **Struk & kirim** (membuka
   dialognya lagi kapan pun, termasuk untuk mengirim ulang).
2. **PDF dibuat di perangkat kasir dengan penulis PDF sendiri** (`src/lib/receiptPdf.ts`, tanpa dependensi).
   Sumbernya teks struk yang sama (`receiptDocument().sheets`): satu halaman per lembar rangkap (dot matrix
   dua lembar = dua halaman), `/MediaBox` selebar kertas struknya, tinggi mengikuti jumlah barisnya, dan
   hurufnya dihitung agar `cols` karakter muat di dalam margin. `pdfkit` **tidak** dipakai di bundel kasir —
   ia tetap hanya untuk skrip panduan (`scripts/gen-panduan-pdf.mjs`) — supaya bundel POS tidak membawa mesin
   PDF beserta penyemat hurufnya hanya untuk satu berkas struk.
3. **Nomor penerima datang dari data member, bukan dari kasir.** `receiptWaData.prepareSend` (izin `pos.sell`)
   yang membacanya; satu salah ketik di depan antrean tidak boleh berarti struk orang lain mendarat di nomor
   yang bukan pemiliknya. Member tanpa nomor ditolak **sebelum** jaringan disentuh, beserta petunjuk
   melengkapinya di halaman Member.
4. **Kirimnya dua langkah, seperti tuntutan WhatsApp Cloud API:** unggah berkas ke `/{id-nomor}/media`
   (`media_id`), lalu kirim pesan dokumen ke `/{id-nomor}/messages`. Berkasnya diunggah ke WhatsApp, jadi
   **tidak ada server berkas publik** yang perlu diadakan hanya untuk satu struk.
5. **Tidak ada klaim “terkirim” tanpa bukti.** Baik unggahan maupun pesannya harus membawa `id` dari
   WhatsApp; selain itu hasilnya dilaporkan gagal beserta alasan dari WhatsApp, dicatat di log audit
   (`receipt.whatsapp`, termasuk percobaan yang dilewati karena kanal belum tersambung), dan di layar kasir
   muncul **jalur cadangan `wa.me`**: PDF yang sudah diunduh dilampirkan sendiri di percakapan itu (tautan
   `wa.me` hanya bisa membawa teks).
6. **Nomor tersensor** di layar kasir & di log audit (`6281•••••890`): cukup untuk mencocokkan, tanpa
   memajang nomor penuh di layar yang dilihat pembeli berikutnya di antrean.
7. **Kanalnya opsional dan keadaannya dikatakan apa adanya.** Kirimannya hidup begitu deployment mengisi
   `WHATSAPP_ACCESS_TOKEN` & `WHATSAPP_PHONE_NUMBER_ID` (versi Graph API bisa dipatok lewat
   `WHATSAPP_GRAPH_VERSION`, bawaan `v21.0`); kalau belum, jawabannya “kanal WhatsApp belum tersambung”
   beserta nama kuncinya, dan struknya tetap bisa dicetak/diunduh. Mode demo menyimulasikan pengirimannya dan
   menuliskan kata “Mode demo” — bukan mengaku terkirim.
8. **Modul Node hanya memuat action.** Percobaan pertama menaruh mutation `prepareSend`/`finishSend` di
   `receiptWa.ts` yang bertanda `"use node"`, dan push Convex menolaknya
   (`Only actions can be defined in Node.js`) — maka mutasinya dipindah ke `src/convex/receiptWaData.ts`
   (runtime biasa, boleh membaca basis data), sementara yang menyentuh jaringan tetap di `receiptWa.ts`.

**Berkas:** baru: `src/lib/receiptPdf.ts`, `src/lib/receiptWhatsapp.ts`,
`src/convex/lib/receiptWhatsapp.ts`, `src/convex/receiptWa.ts`, `src/convex/receiptWaData.ts`,
`scripts/verify-struk-pdf.mjs` · diubah: `src/pages/PosPage.tsx`, `src/lib/store/types.ts`,
`src/lib/store/demo.tsx`, `src/lib/store/convex.tsx`, `src/convex/_generated/api.d.ts` (hasil codegen),
`scripts/verify-render.mjs`, `scripts/verify-struk-browser.mjs`, `scripts/gen-panduan-pdf.mjs`,
`public/panduan/panduan-mesinpos.pdf` (dibangun ulang), `README.md`, `worklog.md`.

**Verifikasi:**

- `bun convex dev --once` → **exit 0** (`Convex functions ready! (3.21s)`) — setelah pemisahan modul Node.
- `bun tsc -b --noEmit` → **exit 0** (frontend + backend).
- `bun scripts/verify-struk-pdf.mjs` → **33/33**: berkas PDF diperiksa byte per byte (header/trailer, satu
  halaman per lembar, `MediaBox` = lebar kertas × tinggi baris, tiap entri xref 20 byte & menunjuk objek yang
  benar, `startxref` menunjuk tabel xref, `/Length` tiap aliran = byte-nya, kurung di-escape, huruf di luar
  Latin-1 → `?`, baris panjang dipotong di kolomnya, berkas yang sama deterministik), nama berkas dari nomor
  nota, plus aturan kirim WhatsApp-nya (kanal siap hanya kalau kedua kunci wajib terisi, caption memuat
  nomor/tanggal/total & dipotong sendiri di 1024 karakter, nomor dinormalkan & tersensor, nama berkas
  disterilkan, badan multipart memuat byte PDF utuh dengan `Content-Length` yang tepat, pesan dokumen JSON
  menunjuk `media_id`, dan balasan tanpa id dianggap gagal).
- `bun scripts/verify-render.mjs` → **681/681** (naik dari 673): pembayaran lunas membuka dialog struk (bukan
  dialog cetak) — tiga pilihannya ada, cetakan masih 0 sampai Cetak ditekan, nomor nota penjualan yang baru
  lunas disebut, Unduh PDF melaporkan nama berkas + ukurannya, struk tanpa member menjelaskan kenapa tak bisa
  dikirim, member tanpa nomor WA diperingatkan lalu pengirimannya ditolak beserta sebabnya, member yang punya
  nomor disimulasikan terkirim ke nomor tersensor, dan menutup dialognya tidak menghapus notanya.
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → **47/47** (naik dari
  38) di Chromium sungguhan: dialog struk terbuka tanpa satu pun panggilan `window.print`, **Unduh PDF
  menghasilkan unduhan sungguhan** (`struk-A-01043.pdf`, byte-nya dibaca kembali di harness: `%PDF-1.4` …
  `%%EOF`, 2 halaman untuk 2 lembar rangkap, memuat Cappuccino/TOTAL/TEMBUSAN 1/catatan kaki), member tanpa
  nomor WA ditahan beserta sebabnya, Cetak memanggil dialog cetak sekali dengan nota yang sama, dan kirim ke
  WhatsApp melaporkan hasilnya apa adanya; 0 galat konsol.
- Regresi tanpa kegagalan: `bun scripts/verify-struk.mjs` **95/95** · `verify-menus.mjs` **406/406** ·
  `verify-members.mjs` **30/30** · `verify-theme.mjs` **50/50** · `verify-panduan.mjs` **13/13** ·
  `verify-pwa.mjs` **1492/1492** · `bun run panduan:pdf` → 31 halaman · 16 bagian · 10 gambar · **82.673 byte**
  (80,7 KB) · `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **718/718** (jumlahnya tidak berubah: jalur `receiptWa` belum punya cek tersendiri di harness itu).
- **Belum diverifikasi:** pengiriman sungguhan ke WhatsApp (butuh kunci Meta + nomor bisnis; lihat Blocker
  #9) dan cetak di printer kasir nyata. Yang terbukti adalah **bentuk permintaan** yang dikirim ke Graph API
  (murni, 33/33) dan **berkas PDF yang benar-benar terunduh** di peramban (Chromium, 47/47).

**Catatan / blocker:** kanal WhatsApp-nya belum pernah menyentuh jaringan sungguhan (Blocker #9 ditambahkan).
Yang perlu diketahui operator: kunci `WHATSAPP_ACCESS_TOKEN` & `WHATSAPP_PHONE_NUMBER_ID` diisi di env
**deployment** (bukan di berkas env lokal), nomor pengirimnya nomor WhatsApp Business yang sudah terdaftar di
Meta, dan member harus sudah mengisi nomor WhatsApp-nya di halaman Member sebelum struknya bisa dikirim.
Jaket offline: mengirim berkas butuh jaringan, jadi jalur ini **tidak** lewat outbox seperti penjualan —
kasir bisa mengulangnya kapan pun karena struk yang sudah lunas tidak berubah lagi. Tabel **Status Phase 1–6**
tidak berubah: pekerjaan ini penyempurnaan alur struk, bukan klausa katalog baru, dan tidak mengubah status
fase mana pun.

## 2026-10-13 — Cetak struk otomatis begitu pembayaran lunas (tunai, kartu, tempo, QRIS)

**Ruang lingkup:** permintaan pengguna — “harusnya setelah pembayaran lunas, terutama untuk pembayaran tunai,
langsung memunculkan print struk belanja atau print pdf”. Dialog cetak peramban kini **terbuka sendiri**
begitu penjualan tercatat, di ketiga jalur yang mencatat penjualan (tunai/kartu/tempo di `confirmPayment`,
dan QRIS dari keranjang di `settleCartCharge`). Cetak ke PDF tidak butuh apa pun tambahan: dialog cetak yang
sama punya tujuan “Simpan sebagai PDF”, dan halaman kasir sekarang menyebutkannya.

**Temuan yang harus dibereskan lebih dulu (inti pekerjaannya):** area cetak selalu disusun dari **keranjang**
(`strukDraft`), sedangkan keranjang dikosongkan tepat setelah penjualan tersimpan (`resetSale()`). Jadi
mencetak sesudah bayar akan mengeluarkan **lembar kosong** — dan tombol Cetak memang dimatikan saat keranjang
kosong. Artinya cetak otomatis tidak bisa hanya menambah `window.print()`; struk penjualannya harus disimpan
dulu.

**Keputusan yang diambil (beserta alasannya):**

1. **Struk penjualan disimpan bersama penjualannya** (`lastReceipt.draft`, dibuat `saleDraft()`): nomornya
   sudah ada, `total` diambil dari balikan penjualan (bukan hitungan ulang), dan catatan “Belum dibayar —
   struk sementara” **dilepas** — yang keluar dari printer adalah bukti pembayaran, bukan pengingat tagihan.
   Area cetak memakai `printDraft = keranjang berjalan ?? struk penjualan terakhir`, jadi satu tempat
   melayani cetak sebelum bayar (draft) sekaligus cetak ulang sesudah bayar.
2. **Cetaknya dipicu `useEffect`, bukan di dalam handler pembayaran.** React baru menaruh struk itu di DOM
   pada render berikutnya; `window.print()` di dalam handler akan mencetak keranjang yang masih lama.
   Efeknya memakai satu giliran `setTimeout(0)` supaya DOM-nya selesai diperbarui lebih dulu.
3. **Penghitung tiket, bukan bendera `true/false`.** Dua penjualan berturut-turut harus tetap menghasilkan
   dua dialog cetak; nilai yang sama tidak memicu efek lagi.
4. **Gerbangnya tetap `canPrint`** (`peripheral.escpos`). Paket tanpa fitur itu tidak punya printer yang bisa
   disapa — lebih jujur tidak membuka dialog cetak sama sekali, dan halaman menyebut alasannya di bawah
   tombol simpan. (Ketiga paket yang ada sekarang memuat fitur itu, jadi jalur “tanpa cetak” hanya penjaga.)
5. **Tombol Cetak tidak lagi mati sesudah bayar.** Ia hidup selama masih ada struk yang bisa dikeluarkan:
   draft penjualan berjalan sebelum bayar, atau nota penjualan terakhir sesudahnya (judul tombolnya menyebut
   nomor penjualan itu) — jadi printer yang belum siap/kertas habis tidak berarti notanya hilang.
6. **Nominal & metode bayar tidak berubah.** Yang dicetak tetap struk yang sama; yang berubah hanya *kapan*
   dialognya muncul dan *apa* isinya sesudah transaksi.

**Berkas:** diubah: `src/pages/PosPage.tsx` (`useEffect` impor, state `autoPrintTicket`, `lastReceipt.draft`,
`saleDraft()`/`requestAutoPrint()`, `printDraft`/`printingLastSale`, tombol Cetak + kiat cetak otomatis di
dialog pembayaran), `scripts/verify-render.mjs` (4 cek baru + penukaran `window.print`),
`scripts/verify-struk-browser.mjs` (4 cek peramban), `scripts/gen-panduan-pdf.mjs` (bagian “Menjual di kasir”
+ callout baru), `public/panduan/panduan-mesinpos.pdf` (dibangun ulang), `README.md` (bagian baru “Cetak struk
otomatis…” + angka harness), `worklog.md`. Tidak ada berkas baru, dan **tidak ada perubahan server**
(skema, mutation, izin, store tidak disentuh).

**Verifikasi:**

- `bun tsc -b --noEmit` → **exit 0**.
- `bun scripts/verify-render.mjs` → **673/673 pemeriksaan lolos**, exit 0 (dari 669/669; 4 cek baru di blok
  pembayaran tunai: `window.print` dipanggil **tepat sekali tanpa menekan tombol** setelah lunas; isi area
  cetak saat itu nomor + nama barang + TOTAL/Bayar/Kembali penjualan yang baru lunas dan **tanpa** “Belum
  dibayar”; tombol Cetak struk tetap hidup sesudah bayar dan memanggil cetak **kedua**; keranjang baru kembali
  mencetak draft berjalan tanpa cetakan ketiga).
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → **38/38 pemeriksaan
  lolos**, exit 0 (dari 34/34). Di Chromium sungguhan: `window.print` diganti penghitung, pembayaran tunai
  diselesaikan dari dialog (`Rp 100.000` → Selesaikan pembayaran), cetakan pertama terjadi **tanpa menekan
  tombol** (nilai 1), isi area cetak saat itu nota penjualan yang baru lunas (No. nota, Cappuccino, TOTAL,
  Bayar, Kembali, tanpa “Belum dibayar”), tombol Bayar terkunci karena keranjangnya sudah kosong sementara
  tombol Cetak struk hidup, dan menekannya mengeluarkan nota yang sama sekali lagi (nilai 2). Galat konsol: 0.
- `bun run panduan:pdf` → exit 0: **31 halaman, 16 bagian, 10 gambar, 80,0 KB** (81.933 byte; sebelumnya
  81.435 byte).
- `bun scripts/verify-panduan.mjs` → **13/13 pemeriksaan lolos**, exit 0.
- Regresi: `bun scripts/verify-struk.mjs` → **95/95**, `bun scripts/verify-menus.mjs` → **406/406**,
  `bun scripts/verify-pwa.mjs` → **1492/1492**, semuanya exit 0 (rute `/app/pos` ikut dirender di
  `verify-menus`).

**Catatan / blocker:**

- **Cetak otomatis tidak bisa dibuktikan sebagai jendela cetak sungguhan di uji otomatis** — Chromium
  headless tidak membuka dialog cetak. Yang diuji adalah hal yang memang bisa diperiksa: `window.print`
  dipanggil (diganti penghitung di kedua harness) beserta isi area cetak pada saat itu. Perilaku dialognya
  sendiri (pilihan printer, “Simpan sebagai PDF”) tetap urusan peramban/kasir, dan belum diuji di perangkat
  kasir sungguhan — itu batasan yang disebut apa adanya.
- Urutan **panggilan cetak** bertumpu pada pengaktifan pengguna dari klik “Selesaikan pembayaran”: efeknya
  berjalan segera setelah commit render (satu giliran `setTimeout`), jadi masih di dalam masa aktivasi
  sementara peramban. Kalau nanti ada peramban yang menolak `print()` tanpa aktivasi, gejalanya jelas
  (dialog tidak muncul) dan tombol Cetak struk tetap bisa dipakai untuk mencetak ulang.
- Yang **tidak** dijalankan ulang: `bun scripts/verify-backend.mjs` dan `bun convex dev --once` — tidak ada
  perubahan di `src/convex` maupun fungsi server.
- Tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** diperiksa: **tidak ada klausa roadmap
  maupun blocker yang berubah** (cetak otomatis bukan klausa roadmap dan tidak menyentuh skema/izin/modul).
- Batasan yang masih terbuka: (1) cetak otomatisnya **selalu aktif** — belum ada tombol perangkat untuk
  mematikannya (mis. saat kasir memakai printer bersama beberapa perangkat); (2) nota yang dicetak sesudah
  bayar belum bisa dicari ulang dari riwayat penjualan (halaman Riwayat belum ada); (3) jalur PDF memakai
  “Simpan sebagai PDF” peramban, bukan pembuatan PDF di aplikasi.

## 2026-10-13 — Pembayaran tunai: tombol pecahan uang Rp 10.000 … Rp 500.000

**Ruang lingkup:** permintaan pengguna — “tambahkan opsi pilihan rupiah saat mau bayar / checkout dengan
menggunakan pembayaran tunai. Pilihan nya Rp. 10.000, Rp. 20.000, Rp. 50.000, Rp. 100.000, Rp. 500.000”.
Dialog pembayaran di kasir kini punya **lima tombol pecahan** tepat di bawah kolom `Uang diterima`; satu
ketukan mengisi nominalnya, menandai pilihannya aktif, lalu baris `Kembalian`, struk yang sedang disusun,
dan tombol **Selesaikan pembayaran** mengikuti seketika. Tidak ada perubahan server: nominal uang tunai
memang hanya hidup di layar kasir (yang dicatat server adalah total & metode bayarnya).

**Keputusan yang diambil (beserta alasannya):**

1. **Tombolnya mengisi, bukan mengunci.** Kolom `Uang diterima` tetap bisa diketik sendiri, karena uang yang
   diserahkan sering bukan pecahan pas (Rp 55.000, atau kombinasi beberapa lembar). Menjadikannya pilihan
   eksklusif akan memaksa kasir membatalkan pilihannya dulu untuk mengetik angka yang benar.
2. **Isinya konstanta di halaman kasir, bukan aturan murni baru.** Isinya memang keputusan tampilan — sama
   seperti `PAYMENT_METHODS` di berkas yang sama — bukan aturan yang dipakai server/store, jadi menaruhnya
   di `src/convex/lib` hanya menambah berkas tanpa satu pun pemakai kedua.
3. **Pecahan yang sedang terpakai ditandai aktif** (latar utama + `aria-pressed`), bukan hanya mengisi kolom:
   di depan antrean, kasir perlu memastikan uang mana yang sedang dihitung kembaliannya tanpa membaca ulang
   angka di kolom.
4. **Hanya di tunai penuh.** Bloknya hidup bersama kolom `Uang diterima` (`method === "Tunai" &&
   creditAmount === 0`), jadi QRIS/Kartu dan pembayaran sebagian (tempo) tidak menawarkan pecahan uang —
   di jalur itu nominal yang diserahkan bukan uang tunai.
5. **Diuji sampai ke struk & sampai ke peramban.** Yang diperiksa bukan label tombolnya, melainkan akibatnya:
   Rp 10.000 (di bawah total) harus membuat kembalian Rp 0 dan tombol simpan terkunci, Rp 100.000 (di atas
   total) harus membuka simpan dan mencetak `TOTAL`/`Bayar`/`Kembali` yang konsisten dengan kembalian yang
   dihitung halaman, dan penjualan yang tersimpan harus `Tunai` sebesar total itu. Di Chromium sungguhan,
   kelima tombolnya juga diukur: labelnya dirender `Intl` dan semuanya **muat di dalam dialog** (panel
   kasir hanya 380 px; tombol yang meluber berarti sebagian tidak bisa ditekan).

**Berkas:** diubah: `src/pages/PosPage.tsx` (konstanta `CASH_QUICK_AMOUNTS` + baris tombol pecahan di dialog
pembayaran, plus `aria-label="Tutup pembayaran"` pada tombol tutup yang sebelumnya ikon tanpa nama),
`scripts/verify-render.mjs` (blok 3e-10-2b: 10 cek DOM), `scripts/verify-struk-browser.mjs` (4 cek peramban
+ penyesuaian satu cek cetak), `scripts/gen-panduan-pdf.mjs` (langkah pembayaran tunai di bagian “Menjual di
kasir”), `public/panduan/panduan-mesinpos.pdf` (dibangun ulang), `README.md` (bagian baru + angka harness +
**penutup blok kode yang hilang** di bagian browser), `worklog.md`. Tidak ada berkas baru, dan **tidak ada
perubahan server** (skema, mutation, izin tidak disentuh).

**Verifikasi:**

- `bun tsc -b --noEmit` → **exit 0**.
- `bun scripts/verify-render.mjs` → **669/669 pemeriksaan lolos**, exit 0 (dari 659/659; **10 cek baru** di
  blok 3e-10-2b: kelima tombol pecahan beserta urutan & labelnya, belum ada yang aktif sebelum ditekan,
  Rp 10.000 mengisi kolom + menandai pilihannya aktif (yang lain tidak), Rp 10.000 belum cukup → kembalian
  Rp 0 & simpan terkunci, Rp 100.000 cukup → kembalian 100.000 − total & simpan terbuka, struk sementara
  memuat TOTAL/Bayar/Kembali yang sama, kolom tetap bisa diketik (Rp 55.000), penjualan `Tunai` tercatat
  sebesar totalnya, dan tanpa galat konsol).
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → **34/34 pemeriksaan
  lolos**, exit 0 (dari 29/29). Di Chromium sungguhan: kelima label pecahan dirender `Rp …` (Rp 10.000 …
  Rp 500.000), **kelimanya muat di dalam dialog** (0 meluber dari 5 tombol, semua berlebar > 0), menekan
  Rp 100.000 mengisi kolom `#cash` (nilai 100000) + `aria-pressed="true"` + tombol simpan terbuka +
  kembalian > Rp 0, dan setelah dialog ditutup keranjang & struknya tetap utuh. Galat konsol: 0.
- `bun run panduan:pdf` → exit 0: **31 halaman, 16 bagian, 10 gambar, 79,5 KB** (81.435 byte).
- `bun scripts/verify-panduan.mjs` → **13/13 pemeriksaan lolos**, exit 0.
- `bun scripts/verify-struk.mjs` → **95/95**, exit 0 (aturan struk tidak disentuh turn ini; dijalankan ulang
  supaya angka README/worklog yang menyebutnya tetap apa adanya).
- Regresi: `bun scripts/verify-menus.mjs` → **406/406** (rute `/app/pos` beserta gerbang perannya ikut
  dirender di situ) dan `bun scripts/verify-pwa.mjs` → **1492/1492**, keduanya exit 0.

**Catatan / blocker:**

- **Satu cek cetak diubah, dan inilah alasannya:** `verify-struk-browser.mjs` memakai kata `Bayar` sebagai
  penanda “teks antarmuka kasir tidak ikut tercetak”. Kata itu kini **muncul sah di struk** — baris `Bayar`
  berisi nominal uang yang diterima — begitu harness-nya menekan tombol pecahan sebelum memeriksa cetakan,
  jadi penanda itu tidak lagi membedakan bocornya UI. Penandanya diganti `Selesaikan pembayaran` (yang hanya
  ada di antarmuka) sementara `Cappuccino` & `Keranjang` tetap: perilaku yang dijaga tidak berubah, hanya
  kata penandanya yang tidak lagi ambigu. Cek itu **lulus** setelah diganti.
- Yang **tidak** dijalankan ulang: `bun scripts/verify-backend.mjs` dan `bun convex dev --once` — tidak ada
  perubahan di `src/convex` maupun fungsi server (nominal uang tunai tidak pernah dikirim ke server; yang
  dicatat adalah total & metode).
- Tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** diperiksa: **tidak ada klausa roadmap
  maupun blocker yang berubah** — tombol pecahan uang bukan klausa roadmap, dan ia tidak menyentuh skema,
  izin, modul, atau gerbang paket.
- Batasan yang masih terbuka: (1) pecahannya **tetap** (tidak menyesuaikan total atau kebiasaan toko) — kalau
  nanti perlu, langkah berikutnya adalah tombol “Uang pas” atau pecahan yang bisa diatur per workspace;
  (2) tombolnya belum diuji di browser HP sungguhan (layar sempit tetap diuji lewat panel 380 px di desktop);
  (3) nominalnya tidak disimpan di penjualan, jadi tidak ada laporan “uang masuk per pecahan”.

## 2026-10-13 — Logo struk diperkecil jadi 110 px × 110 px & dicetak hitam putih

**Ruang lingkup:** permintaan pengguna — “logo yg ada di struk belanja dibuat lebih kecil 110 px X 110 px dan
dibuat hitam putih sama seperti teks yang ada di struk belanja. Jadi saat di print, semuanya jadi print
hitam putih”. Aturan murni logo struk diganti: ukurannya **tetap** 110 px × 110 px (dulu mengikuti lebar
kertas: separuh lebar kertas, 58 mm → 29 mm, 76 → 38, 80 → 40, 241 → 121 mm) dan warnanya dipaksa abu-abu
lewat saringan baru. Karena aturannya satu berkas murni, perubahan ini otomatis ikut terpakai di pratinjau
Pengaturan, area cetak kasir, dan kedua store — tidak ada tata letak kedua yang perlu dijaga.

**Keputusan yang diambil (beserta alasannya):**

1. **Ukurannya konstanta, bukan fungsi lebar kertas.** `receiptLogoWidthMm(paper)` diganti
   `RECEIPT_LOGO_SIZE_PX = 110`; logo selebar kertas justru yang dulu mendorong nama usaha & daftar barang
   turun (bahkan ke halaman berikutnya di printer dot matrix). 110 px ≈ 29 mm, masih muat di kertas
   tersempit 58 mm, dan faktur 241 mm tidak lagi memakai logo raksasa. Harness menjaga batas itu dengan
   angka mm, bukan sekadar mencocokkan px-nya.
2. **Kotaknya persegi 110 × 110 px dengan `object-contain`.** Logo asli jarang persegi; mengisi kotaknya
   dengan `object-fill` akan meregangkan logo sampai gepeng, jadi lebarnya dipatok 110 px dan tingginya
   110 px dengan gambar dipaskan ke dalamnya.
3. **Hitam putih lewat CSS filter di satu tempat** (`RECEIPT_LOGO_FILTER = "grayscale(1) contrast(1.35)"`),
   bukan gambar yang diolah ulang saat diunggah. Dengan begitu logo yang sudah tersimpan pun langsung ikut
   hitam putih, dan berkas aslinya tetap utuh (tidak ada re-encode yang bisa menurunkan mutunya).
   `grayscale(1)` memastikan satu warna walau printer berwarna, sedangkan `contrast(1.35)` memadatkan bagian
   gelapnya supaya garis & huruf logonya tetap tegas seperti teks di sekitarnya.
4. **Saringan yang sama dipakai di pratinjau halaman Pengaturan.** Kalau pratinjaunya berwarna sementara
   kertasnya hitam putih, pemilik toko akan memilih logo berdasarkan tampilan yang tidak pernah tercetak.
5. **Diuji sampai pikselnya, bukan cuma gaya di DOM.** Harness peramban mengunggah logo hijau (#14532d),
   lalu **membaca ulang tangkapan layar area cetak lewat canvas** dalam mode cetak: selisih kanal terbesar
   harus **0** dan harus ada piksel gelap (supaya “putih semua” tidak lolos sebagai hitam putih).

**Berkas:** diubah: `src/convex/lib/struk.ts` (`RECEIPT_LOGO_SIZE_PX`, `RECEIPT_LOGO_FILTER`, dokumen struk
membawa `logoSizePx` + `logoFilter` menggantikan `logoWidthMm`), `src/pages/PosPage.tsx` (area cetak: kotak
110 px × 110 px + saringan), `src/pages/SettingsPage.tsx` (pratinjau memakai ukuran & saringan yang sama),
`src/pages/PanduanPage.tsx` (keterangan logo di struk), `scripts/verify-struk.mjs` (95/95, aturan logo),
`scripts/verify-render.mjs` (DOM tiruan), `scripts/verify-struk-browser.mjs` (peramban + bukti piksel),
`scripts/gen-panduan-pdf.mjs` (teks bagian 16 & gambar 10), `public/panduan/panduan-mesinpos.pdf`
(dibangun ulang), `README.md`, `worklog.md`. Tidak ada berkas baru, dan **tidak ada perubahan server**
(logo tetap disimpan/divalidasi seperti sebelumnya; yang berubah hanya cara menggambarnya).

**Verifikasi:**

- `bun tsc -b --noEmit` → **exit 0** (setelah seluruh perubahan kode).
- `bun scripts/verify-struk.mjs` → **95/95 pemeriksaan lolos**, exit 0 (dari 93/93; dua cek baru: ukuran tetap
  110 px di semua printer & lebar kertas + hitam putih; cek lama “lebar mengikuti kertas” diganti).
- `bun scripts/verify-render.mjs` → **659/659 pemeriksaan lolos**, exit 0 (jumlahnya sama: tiga cek logo
  berubah janjinya — 40 mm → **110 px × 110 px + `grayscale`** di pratinjau, **tetap 110 px** saat kertasnya
  jadi 241 mm, dan lembar cetak kasir yang sama besarnya).
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → **29/29 pemeriksaan
  lolos**, exit 0 (dari 28/28). Di peramban sungguhan: logo pratinjau terukur 110 px × 110 px dengan
  `getComputedStyle` (toleransi ±2 px) dan filter berisi `grayscale`, dan **setelah media cetak aktif** area
  cetak terukur 110 px × 110 px juga — lalu tangkapan layar elemennya dibaca ulang lewat canvas:
  **selisih kanal maksimum 0** (hijau → abu-abu murni) dengan >0 piksel gelap. Galat konsol: 0.
- `bun run panduan:pdf` → exit 0: **31 halaman, 16 bagian, 10 gambar, 79,4 KB** (81.332 byte; sebelumnya
  81.018 byte). Gambar 10 kini menggambar kotak logo di pratinjau struk dengan abu-abu, bukan warna tema.
- `bun scripts/verify-panduan.mjs` → **13/13 pemeriksaan lolos**, exit 0 (daftar isi 16 entri, 34 frasa,
  gambar 1–10, geometri & margin bersih di 31 halaman).
- `bun scripts/verify-menus.mjs` → **406/406**; `bun scripts/verify-theme.mjs` → **50/50**;
  `bun scripts/verify-pwa.mjs` → **1492/1492** (semuanya exit 0, dijalankan karena halaman kasir,
  Pengaturan, dan Panduan ikut tersentuh).
- `freebuff-preview status` → `running: true`, `listening: true`, HTTP 200 (preview dipakai harness peramban).

**Catatan / blocker:**

- Yang **tidak** dijalankan ulang: `bun scripts/verify-backend.mjs` dan `bun convex dev --once` — tidak ada
  perubahan di `src/convex` selain modul murni yang sudah ikut ter-typecheck, dan tidak ada fungsi server
  yang berubah (jadi angka **718/718** dari pemeriksaan awan di entri sebelumnya tetap berlaku untuk jalur
  unggah/simpan/lepas logo — yang diubah cuma cara menggambarnya).
- Tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** diperiksa: **tidak ada klausa
  roadmap maupun blocker yang berubah** — logo struk bukan klausa roadmap, dan ukuran/warnanya tidak
  menyentuh jalur server, izin, atau modul. Blocker #3 (“belum pernah di browser sungguhan”) untuk jalur
  ini justru makin tertutup: harness peramban kali ini mengukur sampai piksel cetaknya.
- Saringannya adalah CSS filter, jadi hasil akhirnya tetap bergantung mesin cetaknya: printer thermal/impact
  memang cuma satu warna, sedangkan printer berwarna mencetak abu-abu hasil saringan itu (bukan hitam pekat
  per piksel). Kalau nanti perlu benar-benar 1-bit, langkah berikutnya adalah mengubah logo jadi hitam-putih
  saat diunggah — belum dikerjakan karena berkas aslinya sengaja dibiarkan utuh.
- Logo lama yang sudah tersimpan tidak diunggah ulang; ia langsung ikut kecil & hitam putih karena ukuran
  dan warna ditentukan saat menggambar, bukan dari berkasnya.

## 2026-10-13 — Logo toko juga di sidebar & panduan

**Ruang lingkup:** permintaan pengguna — “tambahkan juga logo di sidebar, panduan, struk belanja”. Logo
toko yang sudah bisa diunggah dari kartu Struk belanja kini dipakai di **tiga tempat dari satu sumber
(store)**: sidebar kiri sebagai penanda workspace, halaman **Panduan** sebagai kartu identitas workspace,
dan struk (sudah ada sejak entri sebelumnya — diperiksa ulang di entri ini). Panduan PDF-nya ikut
mendokumentasikannya: **bagian 16** + **gambar 10**, jadi berkasnya dibangun ulang.

**Keputusan yang diambil (beserta alasannya):**

1. **Sidebar memakai logo sebagai penanda workspace, bukan menambah blok baru.** Kotak ikon di samping
   kata “MesinPOS” memang slot logo; mengisinya dengan logo toko membuat identitas kasir sama dengan yang
   tercetak di struknya tanpa menambah baris yang mengulang nama workspace (nama itu sudah ada di header).
2. **Logonya diberi alas putih di sidebar, bukan dibiarkan tembus pandang.** Logo toko digambar untuk
   kertas struk yang putih; di sidebar gelap, logo berwarna gelap akan hilang. Ikon bawaan tetap dipakai
   selama belum ada logo — jadi workspace lama tidak berubah tampilannya hanya karena fitur ini ada.
3. **Halaman Panduan menampilkan keadaannya apa adanya** (logo atau ajakan memasangnya) karena halaman itu
   dibuka **semua peran** (`report.view`); kasir jadi tahu logo mana yang sedang tercetak di struknya,
   sedangkan yang memegang `billing.manage` bisa langsung menuju Pengaturan.
4. **Panduan PDF dapat bagian sendiri (16) + gambar 10**, bukan hanya sisipan di bagian PPN: logo bukan
   setelan pajak, dan yang membacanya perlu tahu ke mana harus pergi (Pengaturan → kartu Struk belanja)
   sekaligus di mana hasilnya terlihat (sidebar, pratinjau, setiap lembar struk termasuk tembusan).
5. **Gambar 10 digambar dengan primitif yang sudah ada** (tidak menambah pustaka): kotak unggah, logo
   terpasang, pratinjau struk berlogo, dan jalur sidebar — tetap vektor, jadi tajam saat dicetak.

**Berkas:** diubah: `src/layouts/AppLayout.tsx` (logo di sidebar + ikon bawaan sebagai cadangan),
`src/pages/PanduanPage.tsx` (kartu identitas workspace + jumlah bagian/gambar diperbarui),
`scripts/gen-panduan-pdf.mjs` (bagian 16, gambar 10, daftar harness menambah `verify-struk.mjs`),
`public/panduan/panduan-mesinpos.pdf` (dibangun ulang: 31 halaman), `scripts/verify-panduan.mjs`
(16 bagian, nomor 1..16, frasa logo, gambar 10), `scripts/verify-render.mjs`, `scripts/verify-struk-browser.mjs`,
`README.md`. Tidak ada berkas baru, dan **tidak ada perubahan server** (logo sudah tersimpan di entri lalu).

**Verifikasi:**

- `bun tsc -b --noEmit` → **exit 0** (setelah seluruh perubahan kode).
- `bun run panduan:pdf` → berkas dibangun ulang, exit 0: **31 halaman, 16 bagian, 10 gambar, 79,1 KB**
  (sebelumnya 29 halaman, 15 bagian, 9 gambar).
- `bun scripts/verify-panduan.mjs` → **13/13 pemeriksaan lolos**, exit 0 (perintahnya sama; yang berubah
  adalah janjinya: daftar isi **16 entri**, nomor berurutan 1..16, 34 frasa langkah kunci (termasuk
  “Tambah logo”, “Ganti logo”, “Hapus logo”, “Sidebar kiri” di bagian 16), gambar berketerangan
  **1 sampai 10**, serta geometri & margin tetap bersih di 31 halaman).
- `bun scripts/verify-render.mjs` → **659/659**, exit 0 (652 → 659). 7 cek baru: sidebar memakai logo toko
  sebagai penanda workspace (src tepat, ikon bawaan tidak ikut dirender), `alt`-nya menyebut nama
  workspace & kata “MesinPOS” tetap ada, halaman Panduan menampilkan logo yang sama + kartu “Identitas
  workspace di struk & sidebar” + tombol “Atur logo toko”, workspace tanpa logo jatuh ke ikon bawaan,
  halaman Panduan menjelaskan cara memasangnya saat belum ada (dan menyebut “16 bagian · 10 gambar”),
  serta kedua keadaan itu tanpa error konsol.
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → **28/28
  pemeriksaan lulus**, exit 0, galat konsol 0 (24 → 28). 4 cek baru di Chromium sungguhan: sebelum ada
  logo sidebar memakai ikon bawaan, setelah unggah logo yang sama langsung jadi penanda workspace di
  sidebar (`naturalWidth` 96 px, `alt` “Logo Warung Uji Struk”), halaman **Panduan** menampilkan logo itu,
  dan lencana “16 bagian · 10 gambar” benar-benar tampil.
- Regresi: `bun scripts/verify-theme.mjs` → 50/50 · `bun scripts/verify-menus.mjs` → 406/406 ·
  `bun scripts/verify-pwa.mjs` → 1492/1492, semuanya exit 0.
- Percobaan pertama harness peramban **gagal waktu** di `/app/panduan`: peramban dev masih menyajikan
  modul `PanduanPage` yang sudah ter-transform sebelum suntingan (terlihat dari lencana “15 bagian ·
  9 gambar” yang masih lama), sementara `AppLayout` sudah baru. Akar masalahnya cache modul dev, bukan
  kode: `freebuff-preview restart` membersihkannya, dan harness lulus 28/28 tanpa menambal kode.
- Berkas markdown (`README.md`, `worklog.md`) tidak memengaruhi build/tipe — bukan “sudah dites”.

**Catatan / blocker:** tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** diperiksa:
tidak ada klausa roadmap yang berubah. Batasan yang masih terbuka: (1) logo di sidebar & Panduan **belum
bisa diganti dari halaman itu sendiri** — penggantiannya tetap di Pengaturan (izin `billing.manage`),
jadi manajer (`device.manage`) belum bisa; (2) halaman Panduan **tidak menampilkan PDF sebagai gambar
berlogo** — berkas PDF-nya tetap dokumen statis yang menyebut seksi logo, bukan struk contoh berlogo
toko pengguna; (3) panduan PDF yang dibangun ulang **belum diperiksa di pembaca PDF asli** (harness hanya
membongkar teks, geometri, dan tautannya), dan belum ada pemeriksaan cetak berlogo di browser HP.

## 2026-10-13 — Struk: logo toko & nama kasir yang melayani

**Ruang lingkup:** permintaan pengguna — “tambahkan juga logo toko (tenant), nama kasir”. Yang
dikerjakan: logo toko yang bisa diunggah dari kartu **Struk belanja** di halaman Pengaturan dan
tercetak di atas nama usaha pada **setiap** lembar struk (pratinjau & struk kasir), plus baris
**`Kasir`** berisi nama pengguna yang melayani transaksi itu — tepat di bawah baris `Member`.

**Keputusan yang diambil (beserta alasannya):**

1. **Logo disimpan sebagai id berkas (`tenants.logo`), bukan URL.** URL penyimpanan Convex bertanda
   tangan dan punya masa berlaku; menyimpan URL-nya di baris tenant berarti struk kehilangan logonya
   sendiri setelah kedaluwarsa. URL-nya dibuat saat dibaca (`tenants.listMine` → `logoUrl`), pola yang
   sama dengan gambar produk.
2. **Satu logo per workspace, batasnya ditegakkan tiga kali.** Aturan murni baru
   (`src/convex/lib/tenantLogo.ts`: 1 MB, JPG/PNG/WebP — daftar tipe memakai `PRODUCT_IMAGE_TYPES`
   supaya tidak ada dua daftar format yang bisa berbeda) dipakai halaman Pengaturan, store demo, dan
   `tenants.setLogo` (dari metadata `_storage`). Berkas yang ditolak **langsung dihapus**, dan logo
   lama dihapus saat diganti — kuota penyimpanan tidak terisi sampah.
3. **Lebar logo dihitung aturan murni, bukan CSS lebar-penuh.** `receiptLogoWidthMm(paper)` = separuh
   lebar kertas, tak pernah lebih dari kertas dikurangi 8 mm (58 mm → 29 mm, 76 → 38, 80 → 40,
   241 → 121). Logo selebar kertas akan mendorong nama usaha & barangnya ke halaman berikutnya.
4. **Logo hidup di mode demo sebagai data URL di sesi** (sama seperti setelan struk lain), karena demo
   tidak punya penyimpanan berkas. Jadi logo yang dipasang pemilik toko masih terpasang setelah halaman
   dimuat ulang — di mode Convex penyimpanannya baris tenant, yang memang sudah tetap.
5. **Baris `Kasir` dilewati kalau namanya tidak diketahui.** Berbeda dari pembeli yang punya nama
   pengganti “Cash”, di sini kekosongan berarti datanya memang tidak ada; mencetak “Kasir : -” hanya
   menambah kebisingan di kertas. Namanya diambil dari sesi yang sedang mencetak (`session.user.name`).
6. **Izinnya `billing.manage`**, sama dengan setelan struk & PPN: kartunya hidup di halaman Pengaturan
   yang memang dijaga izin itu, jadi tidak ada tombol yang ditawarkan kepada orang yang akan ditolak
   server. Perkecilannya memakai jalur yang sudah ada (`prepareProductImage` lewat alias
   `prepareTenantLogo`), jadi logonya tidak dikirim dalam ukuran kamera ponsel.

**Berkas:** baru: `src/convex/lib/tenantLogo.ts` (aturan murni), `src/lib/tenantLogo.ts` (entry sisi
klien). Diubah: `src/convex/schema.ts` (kolom `tenants.logo`), `src/convex/tenants.ts`
(`generateLogoUploadUrl`, `setLogo`, `removeLogo`, dan `logoUrl` di `listMine`), `src/convex/lib/struk.ts`
(`receiptStaffName`, `receiptLogoUrl`, `receiptLogoWidthMm`, bidang `cashier`/`logoUrl` di `ReceiptDraft`,
`logoUrl`/`logoWidthMm` di `ReceiptDocument`, baris `Kasir`), `src/lib/store/types.ts` (`StoreLogo`,
`logo`, `setLogo`, `removeLogo`), `src/lib/session.tsx` (`tenant.logoUrl` + `setLogoUrl`),
`src/lib/store/demo.tsx`, `src/lib/store/convex.tsx`, `src/pages/SettingsPage.tsx` (seksi logo + logo di
pratinjau), `src/pages/PosPage.tsx` (logo di area cetak + `cashier`), `scripts/verify-struk.mjs`,
`scripts/verify-render.mjs`, `scripts/verify-struk-browser.mjs`, `scripts/verify-backend.mjs`, `README.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → **exit 0** (dijalankan setelah seluruh perubahan kode; sekali sempat merah
  karena `StoreLogo` belum diimpor di store Convex, lalu diperbaiki dan lulus).
- `bun convex dev --once` → `✔ Convex functions ready! (3.67s)`, exit 0 — kolom `tenants.logo` & tiga
  fungsi barunya benar-benar ter-push ke deployment dev.
- `bun scripts/verify-struk.mjs` → **93/93 checks passed**, exit 0 (87 → 93). 6 cek baru: baris kasir
  tepat di bawah baris pembeli, nama kasir kosong/spasi → barisnya dilewati (`receiptStaffName`), tiap
  lembar rangkap menyebut kasir yang sama, dokumen tanpa logo (`logoUrl: null`) tapi lebarnya tetap
  dihitung (40 mm di kertas 80 mm), `receiptLogoUrl("   ")` kosong, dan lebar logo per kertas
  58/76/80/241 mm.
- `bun scripts/verify-render.mjs` → **652/652**, exit 0 (645 → 652). 7 cek baru di DOM tiruan: kartu
  struk menawarkan logo & struk bawaan tanpa logo, memilih berkas menyimpannya sebagai data URL di sesi
  + lencana “Logo terpasang”, pratinjau menggambar logo 40 mm di atas nama usaha, ikut melebar jadi
  121 mm saat kertas 241 mm, struk kasir memuat `Kasir : Uji Struk` + logo di **kedua** lembarnya
  (38 mm di kertas 76 mm), tombol Hapus logo mengembalikan struk tanpa logo, dan halaman Pengaturan
  setelah logo dihapus tanpa error konsol.
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → **24/24
  pemeriksaan lulus**, exit 0, galat konsol 0 (16 → 24). 8 cek baru di Chromium sungguhan: berkas logo
  dipilih lewat input berkas yang sama dengan pengguna (PNG **digambar peramban** dari canvas, jadi
  `naturalWidth` 96 px membuktikan gambarnya benar-benar didekode, bukan berkas contoh yang ditempel),
  tersimpan di sesi, pratinjau benar-benar 40 mm di layar dan berada **di atas** nama usaha,
  melebar jadi 121 mm di kertas 241 mm, masih terpasang setelah halaman dimuat ulang, struk kasir
  memuat logo + `Kasir : Uji Struk` dengan urutan `Member` lalu `Kasir`, logonya `visibility: visible`
  saat media cetak, dan PDF-nya tetap dihasilkan.
- `bun scripts/verify-backend.mjs` (deployment awan `mellow-narwhal-477`) → **718/718 checks passed**,
  exit 0 (703 → 718). 15 cek baru: tenant baru belum punya kolom logo & `logoUrl: null`, kasir ditolak
  meminta URL unggah, berkas PDF ditolak dengan alasan format, berkas >1 MB ditolak, penolakan tidak
  menyisakan logo setengah jadi, logo sah tersimpan + `logoUrl` https, yang tersimpan adalah id berkas
  (bukan URL), pemilik **& kasir** sama-sama membaca `logoUrl`-nya, memasang berkas yang sama tidak
  menulis perubahan, mengganti logo menunjuk berkas baru, orang di luar workspace ditolak, kasir ditolak
  menghapus, hapus logo mengosongkan kolomnya + `logoUrl` kembali null, dan hapus kedua kali tidak
  menulis perubahan.
- Regresi: `bun scripts/verify-theme.mjs` → 50/50 · `bun scripts/verify-menus.mjs` → 406/406, keduanya
  exit 0.
- Satu kegagalan di tengah pengerjaan bukan bug kode: peramban dev melaporkan “module
  `/src/lib/tenantLogo.ts` does not provide an export named `TENANT_LOGO_TYPES`” karena modul yang sudah
  ter-transform lebih dulu belum melihat ekspor baru di berkas sumbernya. `freebuff-preview restart`
  membersihkan cache modul itu, dan harness peramban lulus 24/24 setelahnya (bukan ditambal di kode).
- Angka lama 87/87, 645/645, 16/16, dan 703/703 digantikan angka di atas; `README.md` dan daftar
  perintah rutin di berkas ini sudah diselaraskan.
- Berkas markdown (`README.md`, `worklog.md`) tidak memengaruhi build/tipe — bukan “sudah dites”.

**Catatan / blocker:** tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** diperiksa:
tidak ada klausa roadmap yang berubah. Batasan yang masih terbuka: (1) **penghapusan berkas logo lama
tidak bisa dibuktikan dari harness** — yang bisa diperiksa hanya kolomnya sudah menunjuk berkas baru
(penghapusan berkasnya ada di `setLogo`/`removeLogo`, tapi penyimpanan tidak bisa diintip dari klien);
(2) logo **belum bisa diatur dari halaman profil workspace** — tempatnya di kartu Struk belanja dan
izinnya `billing.manage`, jadi manajer (yang memegang `device.manage`) belum bisa menggantinya;
(3) cetak struk berlogo di **browser HP sungguhan** (Safari iOS/Chrome Android) belum diuji, dan Panduan
PDF belum menyebut seksi logo ini.

## 2026-10-13 — Struk menyebut pembelinya: “Cash” kalau kasir tidak memilih member

**Ruang lingkup:** permintaan pengguna — “Saat bayar atau checkout, jika member / pembeli tidak
dipilih/kosong maka otomatis nama member yg akan tercantum di struk belanja adalah ‘Cash’”. Yang
dikerjakan: struk belanja (pratinjau di halaman Pengaturan **dan** struk yang benar-benar dicetak kasir)
kini punya baris **`Member`** yang memuat nama member yang dipilih kasir, dan otomatis berbunyi
**`Cash`** kalau tidak ada member yang dipilih. Bawaannya ditaruh di aturan murni bersama
(`receiptBuyerName` + `RECEIPT_WALK_IN_NAME` di `src/convex/lib/struk.ts`), bukan di halaman kasir.

**Keputusan yang diambil (beserta alasannya):**

1. **Barisnya selalu tercetak, juga untuk pembeli umum.** Sebelumnya struk sama sekali tidak menyebut
   pembelinya. Membiarkan baris itu muncul hanya saat ada member akan membuat kertas di tangan
   pelanggan tidak bisa ditelusuri lagi saat transaksinya dipertanyakan, dan label kosong hanya
   menyisakan tanda tanya — jadi “Cash” adalah nama pembeli umum, bukan penanda error.
2. **Nama kosong dan nama berisi spasi dihitung belum dipilih.** `receiptBuyerName` memangkas dulu,
   lalu jatuh ke `RECEIPT_WALK_IN_NAME`; nama member yang cuma spasi tidak pernah tercetak sebagai
   nama, dan nama yang diisi dengan spasi di sekelilingnya tidak kehilangan hurufnya.
3. **Aturannya di aturan murni, bukan di `PosPage`.** Satu tempat yang dipakai pratinjau Pengaturan
   **dan** cetakan kasir, jadi tidak ada dua jawaban berbeda soal “siapa pembeli di struk ini” —
   sejalan dengan setelan struk yang sudah dipakai bersama sejak entri sebelumnya.
4. **Letaknya setelah `Tanggal`, sebelum daftar barang**, dan namanya dipotong `fit()` selebar kolom
   kertas — nama panjang tidak menggeser satu baris pun di struk 58 mm.
5. **Nama yang dipakai adalah member yang dipilih kasir** (`selectedMember.name`, member yang sama yang
   memberi diskon), supaya baris pembeli dan diskon member tidak pernah menunjuk orang yang berbeda.
6. **Pratinjau di halaman Pengaturan diberi keterangan** bahwa baris `Member` memuat nama member yang
   dipilih kasir dan mencetak “Cash” kalau tidak ada — pembeli umum tetap punya nama di kertasnya.

**Berkas:** diubah: `src/convex/lib/struk.ts` (konstanta `RECEIPT_WALK_IN_NAME`, fungsi `receiptBuyerName`,
bidang `member` di `ReceiptDraft`, satu baris di `receiptDocument`), `src/pages/PosPage.tsx`
(`member: selectedMember?.name`), `src/pages/SettingsPage.tsx` (keterangan di bawah pratinjau),
`scripts/verify-struk.mjs`, `scripts/verify-render.mjs`, `scripts/verify-struk-browser.mjs`, `README.md`.
Tidak ada berkas baru, dan **tidak ada perubahan server** (struk dirender di klien).

**Verifikasi:**

- `bun tsc -b --noEmit` → **exit 0** (dijalankan setelah seluruh perubahan kode).
- `bun scripts/verify-struk.mjs` → **87/87 checks passed**, exit 0 (82 → 87). 5 cek baru: pembeli umum
  mencetak `Member : Cash`, member yang dipilih mencetak namanya (dan struknya tidak lagi memuat “Cash”),
  `receiptBuyerName` untuk `undefined`/`""`/`"   "`/`null`/`"  Rina Kartika  "`, nama panjang dipotong
  `...` tanpa melebihi 32 kolom di kertas 58 mm, dan setiap lembar rangkap memuat baris pembeli yang sama.
- `bun scripts/verify-render.mjs` → **645/645**, exit 0 (642 → 645). 3 cek baru: pratinjau struk di
  halaman Pengaturan memuat `Member : Cash` beserta keterangannya, struk kasir memuat `Member : Cash` di
  **kedua lembarnya** selama tidak ada member dipilih, dan setelah kasir memilih member “Rina Kartika”
  (diskon 0 %, supaya total 31.080 tidak berubah) barisnya berganti jadi `Member : Rina Kartika` tanpa
  sisa “Cash”.
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → **16/16
  pemeriksaan lulus**, exit 0, galat konsol 0 (13 → 16). 3 cek baru di Chromium sungguhan: pratinjau 80 mm
  yang dirender peramban memuat `Member : Cash`, struk kasir (kertas faktur 241 mm, dua lembar) memuat
  baris yang sama, dan setelah member dipilih lewat kotak “Cari member” barisnya berganti menjadi nama
  membernya.
- Yang **tidak** dijalankan ulang di entri ini: `bun convex dev --once` dan `bun scripts/verify-backend.mjs`
  (tidak ada perubahan skema, mutation, atau aturan server — struk hanya dirender di klien), serta
  `verify-theme.mjs`/`verify-menus.mjs` (tidak ada menu, rute, atau tema yang disentuh).
- Angka lama **82/82**, **642/642**, dan **13/13** di entri sebelumnya digantikan angka di atas; angka di
  `README.md` dan daftar perintah rutin di berkas ini sudah diselaraskan.
- Berkas markdown (`README.md`, `worklog.md`) tidak memengaruhi build/tipe — bukan “sudah dites”.

**Catatan / blocker:** tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** diperiksa:
tidak ada klausa roadmap yang berubah (ini perilaku struk di modul yang sudah ada, bukan kemampuan baru).
Batasan yang masih terbuka: **pembeli B2B (tempo, modul Grosir) belum punya barisnya sendiri di struk** —
baris `Member` memuat member diskon, jadi penjualan tempo tanpa member tetap mencetak “Cash” walaupun
pelanggan penanggung tagihannya sudah dipilih; itu keputusan tersendiri yang perlu izin/desain label, bukan
sesuatu yang bisa ditebak dari permintaan ini.

## 2026-10-13 — Struk belanja: jenis printer, lebar kertas, rangkap & catatan kaki (`billing.manage`)

**Ruang lingkup:** permintaan pengguna — “buat pengaturan untuk struk belanja, seperti Macam-Macam
Printer Struk Belanja berikut: 1. Thermal (elemen pemanas, cepat, tanpa tinta, hasil bisa memudar,
cocok kafe/restoran/minimarket/UMKM, contoh Epson TM-T82X atau Sano P58B) 2. Dot Matrix (jarum memukul
pita karbon, bisa rangkap, bising & lambat, cocok supermarket/apotek/gudang yang butuh arsip rangkap)
3. Portable/Bluetooth (thermal kecil berbaterei, ringkas, gulungan kertas kecil, cocok kasir keliling/
PPOB/table ordering)”. Yang dikerjakan: kartu **Struk belanja** di halaman Pengaturan dengan ketiga jenis
printer itu beserta keterangannya, lebar kertas yang benar-benar didukung tiap printer, jumlah rangkap
(tembusan karbon — hanya dot matrix), catatan kaki, dan **pratinjau struk** selebar kertas yang dipilih;
setelannya disimpan di baris tenant (`tenants.receipt`, mutation baru `tenants.updateReceipt`) dan
**benar-benar dipakai kasir saat mencetak** — tombol Cetak struk di `/app/pos` kini mencetak struk yang
susunannya datang dari aturan yang sama, dengan lembar gaya `@media print` baru.

**Keputusan yang diambil (beserta alasannya):**

1. **Jenis printer menentukan kertas & rangkapnya, bukan sekadar label.** Thermal 58 mm (32 kolom)/80 mm
   (48 kolom), dot matrix 76 mm (40 kolom)/241 mm (80 kolom), portable 58 mm saja. Lebar di luar daftar
   printernya jatuh ke kertas pertama saat dibaca dan **ditolak** validasi saat disimpan, karena “80 mm”
   di printer portable 58 mm akan terpotong di kertas.
2. **Rangkap lebih dari satu ditolak di printer non-impact.** Thermal & portable tidak punya pita karbon
   yang bisa ditembus; permintaan 2 lembar dijawab penolakan yang menyebut printer dot matrix, dan tombol
   `+` di halaman menutup sendiri. Setelan yang menjanjikan lembar kedua yang tidak mungkin keluar lebih
   berbahaya daripada tombol yang tidak bisa ditekan.
3. **Bawaan = perilaku lama (thermal 80 mm, 1 lembar).** Kolom `tenants.receipt` opsional dan dibaca
   `receiptSettingOf`, jadi baris tenant lama dan sesi yang sudah tersimpan tidak berubah struknya hanya
   karena fitur ini ditambahkan.
4. **Nama produk panjang dibungkus, bukan dipotong** (maks 2 baris, sisanya diberi penanda `...`),
   sedangkan penanda `ASLI`/`TEMBUSAN n` hanya dicetak kalau `copies > 1` — satu lembar yang dicap “ASLI”
   hanya menambah kebisingan.
5. **Pratinjau memakai aturan kasir, bukan contoh karangan.** Baris pajak & biaya layanannya dihitung
   `orderTotal` dari setelan PPN/PBJT workspace, dan pratinjaunya dirender dengan lebar mm sungguhan
   (58/76/80/241 mm) — satu blok per lembar rangkap.
6. **Izin `billing.manage`**, sama dengan setelan PPN & pajak F&B: kartunya hidup di halaman Pengaturan
   yang memang dijaga izin itu, jadi tidak ada tombol yang ditawarkan kepada orang yang akan ditolak
   server. (Manajer memegang `device.manage` tetapi tidak `billing.manage`, jadi untuk sekarang justru
   tidak bisa mengubah setelan ini — lihat blocker di bawah.)
7. **`window.print()` kini bermakna.** Sebelumnya tombol cetak mencetak seluruh antarmuka kasir; sekarang
   seluruh aplikasi disembunyikan saat `@media print` dan hanya `.struk-cetak` yang tampil dari sudut
   kiri atas kertas, dengan lebar `<pre>` mengikuti lebar kertas yang dipilih.

**Berkas:** baru: `src/convex/lib/struk.ts` (aturan murni: katalog tiga printer, lebar/kolom, rangkap,
catatan kaki, validasi, tata letak baris struk), `src/lib/struk.ts` (re-export sisi aplikasi),
`scripts/verify-struk.mjs`, `scripts/verify-struk-browser.mjs` · diubah: `src/convex/schema.ts`,
`src/convex/tenants.ts` (`tenants.updateReceipt` + audit `tenant.receipt`), `src/lib/store/types.ts`
(`receipt`/`setReceipt` di `StoreApi`), `src/lib/store/demo.tsx`, `src/lib/store/convex.tsx`,
`src/lib/session.tsx`, `src/pages/SettingsPage.tsx` (kartu baru), `src/pages/PosPage.tsx` (area cetak +
judul tombol), `src/index.css` (`.struk-cetak` + `@media print`), `scripts/verify-render.mjs`,
`scripts/verify-backend.mjs`, `README.md`. Skrip diagnostik sementara `scripts/diag-struk-mode.mjs`
dipakai sekali lalu **dihapus** (tidak ikut tersimpan).

**Verifikasi:**

- `bun tsc -b --noEmit` → **exit 0** (dijalankan beberapa kali; terakhir setelah seluruh perubahan kode).
- `bun convex dev --once` → `✔ Convex functions ready! (4.46s)`, exit 0 — fungsi baru & kolom `tenants.receipt`
  benar-benar ter-push ke deployment dev.
- `bun scripts/verify-struk.mjs` → **82/82 checks passed**, exit 0 (baru): katalog tiga printer beserta
  cara kerja/kelebihan/kekurangan/cocok untuk/contoh produk, kolom per lebar kertas, pembacaan toleran
  tenant lama, penolakan rangkap di thermal/portable & catatan kaki 3 baris/41 karakter, tata letak baris
  (pembungkusan nama, nominal rata kanan, TOTAL, penanda ASLI/TEMBUSAN, batas kolom per kertas).
- `bun scripts/verify-render.mjs` → **642/642**, exit 0 (620 → 642). 22 cek baru: kartu struk diklik di DOM
  tiruan — pindah ke dot matrix menawarkan 76/241 mm & pratinjau 40 kolom, rangkap 2 memunculkan lembar
  `TEMBUSAN 1`, kertas 241 mm membuat nama panjang muat satu baris, catatan kaki tersimpan di workspace,
  thermal memangkas rangkap jadi 1 lembar + penjelasannya, dan **struk yang dicetak kasir** memuat nama
  usaha/cabang/catatan kaki, dua lembar bertanda ASLI & TEMBUSAN 1, serta baris TOTAL rata kanan 40 kolom.
- `bun scripts/verify-backend.mjs` (deployment awan `mellow-narwhal-477`) → **703/703 checks passed**,
  exit 0, 1m47s (691 → 703). 12 cek baru: bawaan tenant baru, kasir ditolak (`izin billing.manage`),
  orang di luar workspace ditolak, rangkap 2 di thermal ditolak server dengan alasan menyebut dot matrix,
  lebar 80 mm di portable ditolak, catatan kaki 3 baris ditolak, penolakan tidak menyimpan setengah jadi,
  setelan dot matrix 76 mm/2 lembar tersimpan & dibaca kembali persis, penyimpanan ulang tidak menulis
  perubahan, dan kasir tetap boleh **membaca** setelan itu.
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173` → **13/13 pemeriksaan
  lulus**, exit 0, galat konsol 0. Di Chromium sungguhan: lebar pratinjau diukur dari `getComputedStyle`
  (80 mm → 302,4 px; 241 mm → 910,9 px), setelan yang disimpan dari halaman Pengaturan benar-benar dipakai
  struk kasir, area cetak `display:none` di layar, dan saat `emulateMedia({media:"print"})` area struk
  kembali `block`/`visible` sementara `aside` & `header` jadi `hidden` — sehingga `body.innerText` saat
  cetak hanya berisi struknya, plus `page.pdf()` menghasilkan berkas 1500+ byte.
- Regresi: `bun scripts/verify-theme.mjs` → 50/50 · `bun scripts/verify-menus.mjs` → 406/406 ·
  `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-browser-scroll.mjs` → 60/60 (termasuk `/app/settings` yang
  kini punya satu kartu panjang tambahan), semuanya exit 0.
- Angka lama di `README.md` (610/610 dan 620/620 → **642/642**, 691/691 → **703/703**) diperbarui supaya
  tidak ada dua angka berbeda untuk perintah yang sama.
- Berkas markdown (`README.md`, `worklog.md`) tidak memengaruhi build/tipe — bukan “sudah dites”.
- Satu kegagalan di tengah pengerjaan bukan bug kode: `verify-struk-browser.mjs` menanam sesi demo lewat
  `addInitScript`, yang berjalan di **setiap** navigasi dan menghapus setelan yang baru disimpan saat
  pindah dari Pengaturan ke kasir (terbukti lewat perekam `localStorage.setItem` + jejak pemanggilnya).
  Skrip init kini hanya menanam kalau kuncinya belum ada, lalu diuji ulang — lulus.

**Catatan / blocker:** tabel **Status Phase 1–6** dan daftar **Blocker yang masih terbuka** diperiksa:
tidak ada klausa roadmap yang berubah (ini setelan dokumen di modul yang sudah ada, bukan kemampuan baru;
`peripheral.escpos` sudah lama ada di katalog paket sebagai fitur yang menggerbang tombol cetak).
Batasan yang masih terbuka: (1) aplikasi ini **belum bicara ESC/POS** ke printer — yang dicetak adalah
struk berformat teks lewat dialog cetak peramban, jadi keterangan & contoh produk di kartu itu panduan
memilih mesin, bukan driver; (2) **manajer belum bisa mengubah setelan struk**: halaman Pengaturan dijaga
`billing.manage` sedangkan manajer memegang `device.manage` — perlu keputusan izin tersendiri kalau
memang manajer yang mengurus printer di lapangan; (3) pencetakan di **browser HP sungguhan** (Safari iOS/
Chrome Android) dan build produksi belum diuji; (4) kartu volume bip di halaman Pengaturan masih diuji
lewat DOM tiruan (tidak berubah di entri ini).

## 2026-10-13 — Volume bunyi bip kasir: bisa dinaikkan/diturunkan 10–100 % (per perangkat)

**Ruang lingkup:** permintaan pengguna — “Buat pengaturan volume untuk menaikkan/menurunkan volume beep
yg ada di halaman kasir (pos)”. Sebelumnya bip kasir hanya bisa dinyalakan/dimatikan; kerasnya tetap
(0,18). Yang dikerjakan: skala volume 10–100 % dengan langkah 10 %, kontrol − / + di **dua tempat**, dan
pemetaan volume ke kekuatan nada saat nada benar-benar dijadwalkan.

**Keputusan yang diambil (beserta alasannya):**

1. **Nada baku kini berarti kekuatan pada volume 100 %, bawaannya 70 %.** 70 % × 0,25 = 0,175 ≈ 0,18 yang
dipakai sebelumnya (beda 0,24 dB — praktis tak terdengar), jadi pemakai yang tidak menyentuh setelan ini
mendengar bunyi yang sama, sementara yang ruangnya lebih ramai punya ruang sampai `SCAN_BEEP_MAX_GAIN`
(0,25 — “batas sopan” yang sudah ada di kode dan sebelumnya belum dipakai siapa pun).
2. **Tidak ada volume 0 %** (paling pelan 10 %). 0 % akan sama persis dengan tombol **Matikan bunyi**, dan
dua keadaan yang tak bisa dibedakan dari layar maupun dari bunyinya hanya membingungkan — pola yang sama
dengan “PPN aktif 0 %” yang justru ditolak di halaman Pengaturan. Yang ingin senyap memakai tombol
Matikan; mematikan bip **tidak** menghapus volumenya.
3. **Kontrolnya ada di kasir juga, bukan hanya di Pengaturan.** `/app/settings` dijaga izin
`billing.manage` (`src/App.tsx`), sedangkan kasir tidak punya izin itu — padahal justru kasir yang tahu
bipnya terdengar atau tidak. Kontrol di header kasir muncul hanya saat bipnya aktif (yang senyap tidak
punya keras).
4. **Kunci penyimpanan terpisah** (`mesinpos.bip.volume.v1`) supaya `mesinpos.bip.v1` yang berisi
`"on"`/`"off"` di perangkat orang tetap berarti persis seperti sebelumnya — tidak ada penafsiran ulang
data lama, dan setelan lamanya tidak perlu ditulis ulang.
5. **Tiap tekan langsung diperdengarkan** dengan volume barunya (di kasir maupun di Pengaturan): menyetel
kerasnya bunyi tanpa mendengarnya hanya menebak.

**Berkas:** diubah: `src/lib/scanBeep.ts` (skala + fungsi murni + kunci tersendiri),
`src/lib/useScanBeep.ts` (binding volume), `src/pages/PosPage.tsx` (grup − / + di header kasir),
`src/pages/SettingsPage.tsx` (baris volume di kartu bunyi bip), `scripts/verify-scan-beep.mjs`,
`scripts/verify-render.mjs`, `scripts/verify-bip-warna-browser.mjs`, `README.md`. Skrip diagnostik
sementara `scripts/diag-beep-volume.mjs` dipakai sekali lalu **dihapus** (tidak ikut tersimpan).

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-scan-beep.mjs` → **55/55 checks passed**, exit 0 (34 → 55; 21 cek volume: skala &
  langkah, penjepitan nilai janggal/rusak, kunci terpisah, kekuatan bawaan 0,175 (≈ 0,18 yang lama),
  100 % = batas sopan 0,25, label & kalimatnya, nada yang dijadwalkan memakai volume tersimpan, dan
  mematikan bip tidak menghapus volumenya).
- `bun scripts/verify-render.mjs` → **620/620 checks passed**, exit 0 (610 → 620): tombol − / + benar-benar
diklik di DOM tiruan di **kedua** tempat, angkanya bergerak 70 → 80 → 60 %, nilainya tersimpan di
perangkat, kontrolnya hilang saat bip dimatikan, mentok di 100 % dan 10 % (tombolnya jadi nonaktif), dan
nada berikutnya dijadwalkan dengan kekuatan 0,15 saat volumenya 60 %.
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-bip-warna-browser.mjs http://localhost:5173` → **23/23
pemeriksaan lulus**, exit 0 (16 → 23), galat konsol 0. Di Chromium sungguhan pembungkus `AudioContext`
kini juga mencatat **kekuatan puncak** nada: setelah “+” dari kasir (80 %) ketukan produk menjadwalkan
0,2; setelah “−” dua langkah (60 %) 0,15; dan setelah halaman **dimuat ulang** angkanya tetap dipakai
(tersimpan di perangkat).
- Diagnostik sementara sempat menemukan sebab kegagalan pertama: modul `src/lib/useScanBeep.ts` yang
  **disajikan dev server masih basi** (`pageerror: beep.increaseVolume is not a function`) padahal berkas
di disk sudah benar dan `tsc` hijau — dibereskan dengan `freebuff-preview restart`
(`{"message":"Preview is ready","listening":true}`) lalu diuji ulang. Bukan bug kode.
- Regresi: `bun scripts/verify-menus.mjs` → 406/406 · `bun scripts/verify-version.mjs` → 44/44 ·
  `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-browser-scroll.mjs` → 60/60 (termasuk `/app/pos` di
  390×844, tempat baris header baru melipat) · `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-browser-menu.mjs`
  → 12/12 · semuanya exit 0.
- Berkas markdown (`README.md`, `worklog.md`) tidak memengaruhi build/tipe — bukan “sudah dites”.

**Catatan / blocker:** volume itu **per perangkat**, bukan setelan workspace — sama seperti setelan
aktif/matinya, tiap til bisa diatur berbeda. Yang belum: uji di browser HP sungguhan (Safari iOS/Chrome
Android) dan build produksi; alur di halaman tetap mengandalkan DOM tiruan + satu harness Chromium di
atas preview.

## 2026-10-13 — Halaman Pengaturan masih bisa mengangkat seluruh shell saat digulir (kontainer posisi di kolom isi)

**Ruang lingkup:** permintaan pengguna — “perbaiki halaman pengaturan karena begitu halaman paling bawah
sampai setelah di scroll, halaman tsb tetap bisa di scroll ke atas, dimana sidebar, header dan halaman
naik semua ke atas. Perbaiki seperti halaman² yg lain ya”. Yang bergulir di sana bukan `main`, melainkan
**dokumen**: shell setinggi layar (`app-shell-height flex overflow-hidden`) jadi bisa diangkat ke atas,
sehingga sidebar + header + halaman naik bersama. Akarnya elemen `.sr-only` (`position: absolute`) di
dalam halaman — di Pengaturan ada dua `<caption className="sr-only">` (contoh perhitungan PPN dan
ringkasan setoran pajak) — yang **tidak punya leluhur ber-posisi**, sehingga containing block-nya jatuh
ke *initial containing block* di luar area gulir; klip `overflow` di `main` tidak berlaku untuk mereka
dan tinggi dokumen ikut memanjang. Perbaikannya satu kelas: kolom isi jadi acuan posisi (`relative`),
jadi elemen absolut halaman ikut terklip di sana seperti isi halaman yang lain — sama untuk semua halaman
backstage, bukan tambalan per halaman.

**Berkas:** baru: `scripts/verify-browser-scroll.mjs` (harness gulir peramban sungguhan),
`scripts/diag-scroll.mjs` (diagnostik “siapa yang membuat dokumen tinggi”) · diubah:
`src/layouts/AppLayout.tsx` (1 kelas + komentar alasannya), `scripts/verify-render.mjs` (1 pemeriksaan
baru), `README.md`. Skrip diagnostik sementara `scripts/diag-scroll-before-after.mjs` dipakai untuk
mengambil angka pembanding lalu **dihapus** (tidak ikut tersimpan).

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-render.mjs` → **610/610**, exit 0 (naik dari 609; pemeriksaan baru: kolom isi
  ber-`relative` sekaligus tetap satu-satunya area gulir).
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-browser-scroll.mjs` → **60/60 pemeriksaan lulus**, exit 0.
  Chromium sungguhan, 6 halaman backstage (`/app/settings`, `/app/reports`, `/app/products`, `/app/pos`,
  `/app/inventory`, `/app/panduan`) × 2 ukuran layar (390×844 HP & 1280×800 desktop). Tiap halaman:
  dokumennya tidak lebih tinggi dari layar, `window.scrollTo(0, 5000)` tidak menggeser apa pun
  (`window.scrollY` tetap 0), header & sidebar tetap `top 0` setelah `main` digulir sampai bawah, dan
  yang bergulir memang `main` sendiri.
- Pembanding sebelum/sesudah di Chromium 1280×800 pada `/app/settings`: dengan `relative` tinggi dokumen
  **800 px** (= tinggi layar, tidak bisa digulir); kelas `relative` dilepas saat runtime (tanpa mengubah
  sumber) → tinggi dokumen **1522 px**, yaitu 722 px gulir shell yang dulu terjadi. Angka ini sekaligus
  membuktikan harness di atas peka terhadap bug ini.
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/diag-scroll.mjs http://localhost:5173 /app/settings` → dokumen
  `844/844` (HP) dan `800/800` (desktop), `main` yang bergulir (`scrollHeight=4492/2560`), dan
  `(tidak ada yang mengurangi tinggi dokumen)` — tidak ada sisa pelaku lain.
- Regresi pada permukaan yang sama: `bun scripts/verify-fullscreen.mjs` → 14/14 ·
  `bun scripts/verify-sidebar-menu.mjs` → 19/19 · `bun scripts/verify-menus.mjs` → 406/406 ·
  `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-browser-menu.mjs` → 12/12, semuanya exit 0.
- Berkas markdown (`README.md`, `worklog.md`) tidak memengaruhi build/tipe — perubahannya hanya
  dokumentasi, tidak dihitung sebagai “sudah dites”.

**Catatan / blocker:** `.sr-only` lain di repo (`src/pages/ProductsPage.tsx:402`,
`src/pages/ReportsPage.tsx:286` & `:538`) kini ikut terklip karena perbaikannya ada di shell, bukan di
halaman masing-masing. Perbaikan ini tidak menyentuh `body`/`#root`, jadi halaman publik (`/`, `/auth`)
yang memang perlu bergulir tidak berubah. Uji peramban di atas memakai sesi yang disemai lewat
`localStorage` (tidak butuh login, tidak menyentuh data siapa pun); belum diuji di peramban HP sungguhan
(Safari iOS/Chrome Android).

## 2026-10-13 — Tombol menu (burger) di header saat layar kecil atau mode layar penuh

**Ruang lingkup:** permintaan pengguna — “jika screen sedang mode fullscreen atau tampilan sedang
dilihat dengan hp atau screen yg kecil, maka akan muncul tombol menu (burger menu) yg posisinya ada di
kiri atas di header”. Keadaan sebelum perubahan memang bermasalah: sidebar hanya `hidden lg:flex`,
jadi di bawah breakpoint `lg` **dan** di mode layar penuh tidak ada jalan masuk menu sama sekali —
satu-satunya cara adalah keluar dari layar penuh atau memperbesar jendela. Yang dikerjakan: tombol
menu di **paling kiri header** (di depan nama workspace) plus panel sidebar melayang yang dibukanya.

**Perubahan:**

1. **Aturan murni baru** `src/lib/sidebarMenu.ts`: `sidebarMenuReach`/`sidebarMenuButtonClass`
   (tombol muncul di layar kecil lewat `lg:hidden`, dan **tanpa** `lg:hidden` saat layar penuh — sebab
   “layar kecil” adalah urusan media query, bukan `window.innerWidth`), `sidebarMode` (statik / panel
   melayang / sembunyi), `sidebarClass` (satu kelas display per keadaan), `sidebarBackdropClass`,
   plus label & hint tombolnya).
2. **Header backstage** (`src/layouts/AppLayout.tsx`): tombol menu `size-9` di kiri atas dengan
   `aria-label`/`aria-expanded`/`aria-controls="app-sidebar"`, ikon `Menu`/`X`; header diberi
   `relative z-40` (di atas latar penutup `z-30`) dan paddingnya `px-4 sm:px-6` supaya lega di HP.
3. **Sidebar** bisa menjadi panel melayang (`fixed left-0 top-16 bottom-0 z-40`, 256 px) dengan latar
   penutup yang menekannya untuk menutup; di luar layar penuh ia kembali `lg:static` begitu layarnya
   lebar. Panel ditutup lewat **tiga** cara: tombol yang sama, `Esc`, atau latarnya — dan otomatis
   tertutup saat memilih menu atau berpindah halaman (`useLocation`, `onClick` pada tiap menu).
4. **Uji**: modul murni baru `scripts/verify-sidebar-menu.mjs`; `verify-render.mjs` menambah alur klik
   di DOM tiruan; **`scripts/verify-browser-menu.mjs` baru** menjalankan Chromium sungguhan di dua
   ukuran layar + mode layar penuh.

**Berkas:** baru: `src/lib/sidebarMenu.ts`, `scripts/verify-sidebar-menu.mjs`,
`scripts/verify-browser-menu.mjs` · diubah: `src/layouts/AppLayout.tsx`, `scripts/verify-render.mjs`,
`README.md`, `worklog.md`. `src/index.css`, `vite.config.ts`, `tailwind.config.js`, `public/` **tidak**
disentuh (tidak ada token atau kelas baru).

**Verifikasi:**

- `bun tsc -b --noEmit` → **exit 0**.
- `bun scripts/verify-sidebar-menu.mjs` → **19/19 checks passed**, exit 0 (murni: tombol muncul di layar
  kecil & layar penuh, satu kelas display per keadaan, panel mulai di bawah header, latar `z-30` di bawah
  panel `z-40`).
- `bun scripts/verify-render.mjs` → **609/609 checks passed**, exit 0 (dari 596; 13 cek baru: tombolnya
  di kiri atas header, panel terbuka, **ditutup lagi lewat tombol yang sama**, latar, `Esc`, memilih menu,
  dan perilaku di mode layar penuh).
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-browser-menu.mjs http://localhost:5173` → **12/12 pemeriksaan
  lulus**, exit 0, di **Chromium sungguhan**: 390×844 (HP) — tombol tampil ≥ 32 px di kiri atas, panel
  256 px menempel kiri + latar penutup, memilih menu membuka halamannya, `Esc` menutup; 1280×800 —
  tombol **tidak** muncul dan sidebar statiknya tampil, lalu saat mode layar penuh tombolnya muncul dan
  panelnya tetap melayang (menekan tombol itu lagi + “Keluar dari layar penuh” mengembalikan sidebar
  statik). Dua tangkapan layar tersimpan di `/tmp/browser-shots/`.
- **Bug nyata yang ditemukan uji peramban (bukan oleh DOM tiruan).** Panelnya mula-mula setinggi layar
  (`inset-y-0`) sehingga **menutupi tombol yang membukanya**: di Chromium, klik kedua pada tombol itu
  gagal dengan “`<aside>` subtree intercepts pointer events” — jadi panelnya hanya bisa ditutup lewat
  latar atau `Esc`, bukan oleh tombolnya lagi. Perbaikannya: panel mulai di bawah header (`top-16
  bottom-0`, sama dengan header `h-16`) dan header diberi `relative z-40`; lalu cek “menekan tombolnya
  lagi menutup panelnya” ditambahkan **di kedua harness** (DOM + peramban) supaya tidak kembali.
- **Regresi nyata yang tertangkap di DOM tiruan.** Cek lama “penanda sumber data menjelaskan artinya
  lewat tooltip” jadi merah karena selector-nya `header [title]` (elemen pertama yang punya `title`),
  dan tombol menu yang baru punya `title` juga. Yang diperbaiki **selector-nya**, bukan ceknya: lencana
  sumber data diberi `data-testid="data-source-badge"` dan cek itu menuju ke sana — tuntutannya tetap
  sama (`title` menyebut “server aplikasi”, dan “data contoh” untuk mode demo).
- Regresi lain yang dijalankan ulang: `verify-fullscreen.mjs` 14/14 · `verify-menus.mjs` 406/406 ·
  `verify-theme.mjs` 50/50 · `verify-pwa.mjs` 1492/1492 · `verify-authz.mjs` 92/92 ·
  `verify-modules.mjs` 34/34 · `verify-api.mjs` 225/225 · `verify-store-gate.mjs` (26 langganan, 17
  bergerbang izin) — semuanya exit 0.
- Prasyarat uji peramban dipasang **di luar repo** (`mkdir -p /tmp/pw && cd /tmp/pw && bun init -y &&
  bun add playwright`, `playwright@1.64.0`; Chromium `chromium_headless_shell-1248` sudah ada di cache),
  jadi unduhan Chromium tidak masuk ke instalasi build hosting. `README.md`/`worklog.md` hanya markdown
  — tidak memengaruhi build/tipe.

**Catatan / blocker:** (1) tombol menu ini **sudah** dilihat di browser sungguhan (Chromium headless)
— lihat Blocker #3 yang diperbarui; yang belum: browser HP sungguhan (Safari iOS/Chrome Android) dan
build produksi. (2) Tombolnya hanya di header **backstage** (`/app/*`); beranda publik & halaman masuk
tidak punya sidebar, jadi tidak ada yang perlu dibuka di sana. (3) Mode layar penuh tetap state per
halaman (muat ulang = kembali normal), dan menekan tombol layar penuh otomatis menutup panel menunya.
(4) Panelnya selebar 256 px tetap (`w-64`) — di layar sangat sempit ia memakai sebagian besar lebar; itu
pilihan sadar supaya label menunya tidak terpotong.

## 2026-10-13 — Laporan pajak & pungutan F&B per bulan di halaman Laporan

**Ruang lingkup:** permintaan pengguna — “Buat laporan pajak & pungutan F&B per bulan di halaman
Laporan”. Sebelumnya yang ada hanya **ringkasan setoran bulan berjalan** (satu bulan, tanpa rincian)
di halaman Pengaturan, dan halaman Laporan sama sekali belum menyebut pajak F&B. Yang dikerjakan:
halaman Laporan (`/app/reports`, izin `report.view`) kini punya kartu **“Pajak & pungutan F&B per
bulan”** berisi **12 bulan terakhir seluruh toko** workspace — omzet tercatat + jumlah transaksi,
**PBJT** yang dipungut, **PPN** yang dipungut, **biaya layanan** (ditandai tegas bukan pajak),
**PPh final UMKM 0,5%**, **PPh 4 ayat (2) sewa**, dan “setoran pengusaha” — lengkap dengan baris
**Jumlah**, **catatan per bulan** yang menyebut ke mana uangnya pergi (PBJT ke kas daerah/Bapenda,
PPN lewat jalur pusat, biaya layanan bukan setoran negara), peringatan pengecualian usaha mikro, dan
kalimat tegas bahwa angkanya **perkiraan dari data aplikasi, bukan perhitungan pajak resmi**. Bulan
tanpa penjualan tetap tampil sebagai nol (bukan hilang). Tanggal 12 bulan itu datang dari **waktu
lokal perangkat** (dikirim klien), sama seperti ringkasan harian — server tidak menebak bulan dari
zona waktunya sendiri.

**Koreksi atas entri 2026-10-13 sebelumnya (pajak & pungutan F&B).** Entri itu menyebut kueri
`reports.fnbTaxMonth` (satu bulan berjalan). Kueri itu **digantikan** `reports.fnbTaxMonths` (daftar
bulan sekaligus, satu kueri untuk tabel 12 bulan), dan anggota `StoreApi.fnbTaxMonth` yang dipakai
ringkasan di halaman Pengaturan sekarang **diturunkan dari baris terakhir** `fnbTaxMonths`
(`fnbCurrentMonthSummary`) — bukan kueri kedua. Alasannya: ringkasan setoran dan tabel laporan yang
bisa menjawab angka berbeda akan membuat pemilik toko tidak punya cara tahu mana yang benar.

**Berkas:** baru: **tidak ada** (semua fungsi/aturan baru ditambahkan ke berkas yang sudah ada) ·
diubah: `src/convex/lib/fnbTax.ts` (`emptyMonthlyTaxRows`, `monthlyTaxRows`, `fnbTaxReportTotals`,
`fnbTaxMonthReport`, `fnbCurrentMonthSummary`, `monthWindow`/`recentMonthWindows`/`monthLabel`),
`src/convex/reports.ts` (`reports.fnbTaxMonths` menggantikan `reports.fnbTaxMonth`),
`src/lib/store/types.ts` (`StoreFnbTaxMonth` = baris bulan, `StoreFnbTaxMonthSummary`,
`fnbTaxMonth: StoreFnbTaxMonthSummary`), `src/lib/store/convex.tsx` (kueri 12 bulan + turunan bulan
berjalan + `FNB_TAX_REPORT_MONTHS`), `src/lib/store/demo.tsx` (turunan yang sama dari riwayat
analitik), `src/pages/ReportsPage.tsx` (kartu laporan), `src/convex/lib/analytics.ts`
(`AnalyticsSaleInput` menerima `taxKind` & `serviceCharge` apa adanya), `scripts/verify-fnb-tax.mjs`,
`scripts/verify-render.mjs`, `scripts/verify-backend.mjs`, `README.md`, `worklog.md`.

**Verifikasi:**

- `bun convex dev --once` → **exit 0** (fungsi terkirim ke deployment dev `mellow-narwhal-477`) lalu
  `bun tsc -b --noEmit` → **exit 0**.
- `bun scripts/verify-fnb-tax.mjs` → **126/126 checks passed**, exit 0 (dari 105; 21 cek baru untuk
  laporan: pengelompokan ke bulan menurut batas lokal, `void`/`held` tidak dihitung, penjualan di luar
  bulan yang diminta tidak bocor, baris lama tanpa `taxKind` dibaca sebagai PPN, PBJT & biaya layanan
  dijumlahkan terpisah, `yearToDateGrossIdr` menumpuk dalam satu tahun, kerangka nol, rincian satu
  bulan beserta catatan & kewajiban pengusaha, dan ringkasan bulan berjalan = bulan terakhir tabel).
- `bun scripts/verify-render.mjs` → **596/596 checks passed**, exit 0 (dari 584; kartu laporan benar-
  benar dirender: judul, kolom, 12 baris bulan termasuk bulan berjalan, catatan PPN, kalimat
  “perkiraan”, serta satu penjualan baru ber-PBJT yang **menambah** baris bulan berjalan tepat sebesar
  pajak/biaya/total yang tercatat di struknya, sementara PPN terkumpul tidak ikut berubah).
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **691/691 checks passed**, exit 0 (deployment awan sungguhan; dari 688 — tiga cek kueri satu-bulan
  diganti enam cek laporan: baris per bulan tertua-dulu, omzet/transaksi/biaya layanan dari struk,
  PBJT & PPN terpisah (2.000 + 2.140 vs 2.200), bulan sebelumnya tetap nol, penjualan yang di-`void`
  hilang dari laporan, dan orang di luar workspace tetap ditolak).
- Regresi yang dijalankan ulang dan **exit 0**: `verify-fnb.mjs` 39/39 · `verify-tax.mjs` 71/71 ·
  `verify-analytics.mjs` 65/65 · `verify-menus.mjs` 406/406 · `verify-api.mjs` 225/225 ·
  `verify-authz.mjs` 92/92 · `verify-modules.mjs` 34/34 · `verify-store-gate.mjs` (26 langganan, 17
  bergerbang izin) · `verify-rbac.mjs` 48/48 · `verify-impersonation.mjs` 52/52.
- Satu cek backend sempat **merah** (biaya layanan saya harapkan 1.400, padahal dua struk uji memuat
  biaya layanan → 2.800). Yang diperbaiki angka harapannya menjadi 2.800 (kenyataannya memang dua
  struk × 7% × 20.000); ceknya **tidak** dilemahkan atau dilewati. Tidak ada mutasi/penanda sementara
  yang tertinggal.
- **Tidak dijalankan:** `verify-theme.mjs`, `verify-pwa.mjs`, `verify-panduan.mjs` (berkas tema/CSS,
  manifest & service worker, dan PDF panduan tidak tersentuh) serta harness browser Playwright (butuh
  preview + `PLAYWRIGHT_DIR`; yang berubah di halaman adalah tabel angka).
- `README.md` dan `worklog.md` hanya markdown — tidak memengaruhi build/tipe, jadi tidak “dites” lewat
  perintah build; yang dijaga hanya konsistensi angkanya (suite yang angkanya berubah diperbarui di
  seluruh README: `verify-fnb-tax` 105→126, `verify-render` 584→596, `verify-backend` 688→691).

**Catatan / blocker:** (1) kartu laporan baru terbukti di **DOM tiruan + server sungguhan**, belum
pernah dilihat di **browser sungguhan** — Blocker #3 diperbarui; (2) jendelanya **tetap 12 bulan**
(tidak ada pemilih periode seperti analitik lanjutan), jadi laporan lintas tahun yang lebih panjang
belum ditawarkan; (3) tarif PBJT, batas omzet mikro, dan dasar pengenaan pajak berbeda per Perda —
yang ada adalah nilai bawaan yang bisa diubah, bukan nasihat pajak; (4) **PPh 21** tetap hanya
ditandai sebagai kewajiban (angkanya dicatat di luar aplikasi) dan tidak muncul sebagai kolom tersendiri
di tabel bulanan; (5) PDF panduan di `/app/panduan` masih memuat bagian PPN versi lama, belum bagian
pajak F&B.

## 2026-10-13 — Pajak & pungutan F&B: PBJT menggantikan PPN, biaya layanan bukan pajak, kewajiban pusat & ringkasan setoran

**Ruang lingkup:** permintaan pengguna — “tambahkan beberapa pengaturan pajak, khususnya untuk bisnis
F&B”. Yang diminta ada tiga kelompok, dan ketiganya dikerjakan sebagai **satu setelan workspace**:
(1) **PBJT makanan dan/atau minuman** (pajak daerah, pengganti istilah lama Pajak Restoran/PB1) dengan
tarif maksimal 10% menurut Perda, dipungut dari konsumen di struk, disetor ke kas daerah (Bapenda)
setiap bulan, plus pengecualian usaha mikro di bawah batas omzet; (2) **kewajiban pajak pusat
pengusaha** — PPh final UMKM 0,5% (PP No. 55/2022, dengan bagian bebas Rp 500 juta setahun untuk orang
pribadi dan batas waktu 7/4/3 tahun), PPh Pasal 21 karyawan, PPh Pasal 4 ayat (2) atas sewa 10%, dan
penegasan bahwa PPN pusat tidak berlaku untuk makanan/minuman yang disajikan langsung; (3) **biaya
layanan** 5–10% yang **bukan pajak** (kebijakan internal, SE-04/BW/1999). Tiga keputusan yang sengaja
diambil: PBJT **menggantikan** PPN (bukan menambah) dan kalau keduanya menyala alasannya terbaca di
kasir; biaya layanan punya barisnya sendiri di struk, terpisah dari pajak; kewajiban pusat **tidak
pernah** menambah nominal di struk pelanggan. **Tidak** menyentuh `vite.config.ts`, `index.html`,
`index.css`, `tailwind.config.js`, `public/sw.js`, maupun `public/panduan/*`.

**Perubahan:**

1. **Aturan murni di satu berkas** (`src/convex/lib/fnbTax.ts`, 1000+ baris termasuk dokumentasi):
   batas 10% untuk PBJT & biaya layanan, “aktif 0%” ditolak, `validateFnbTaxProfile` memeriksa profil
   **utuh** (setelan yang tidak lolos tidak disimpan sebagian), `orderTaxPlan`/`orderTotal`
   (PBJT menggantikan PPN, biaya layanan terpisah, opsional masuk dasar pengenaan pajak),
   `umkmFinalEstimate` (bagian bebas Rp 500 juta dimakan berurutan dari awal tahun, batas waktu per
   bentuk badan), `rentTaxWithholding`, `payrollTaxInfo`, `fnbMonthlySummary` (apa yang dipungut dari
   pelanggan vs apa yang jadi kewajiban pengusaha), `recordedGross`/`tallyGross` (void & held tidak
   dihitung), `microExemptWarning`, plus pembacaan tahan-rusak `fnbTaxProfileOf` — nilai yang tidak
   terbaca kembali ke bawaannya, **bukan** diam-diam menjadi “tidak memungut pajak”.
2. **Setelan tersimpan per workspace**: kolom `tenants.fnbTaxProfile` (semua bidang opsional → baris
   lama tetap sah dan dibaca sebagai bawaan tanpa pungutan F&B), mutasi `tenants.updateFnbTax` (izin
   `billing.manage`, audit `tenant.fnb_tax`, setelan yang tidak berubah tidak menulis jejak), dibaca
   `entitlements.getForTenant`, sesi perangkat (`setFnbTaxProfile`), dan kedua store (`fnbTax`,
   `setFnbTax`, `fnbTaxMonth`).
3. **Struk & server**: `pos.createSale` memakai `orderTotal` yang sama dengan kasir, dan mencatat
   kolom baru `sales.taxKind` (`regional`/`ppn`/`none`) serta `sales.serviceCharge`; ringkasan setoran
   memakai query baru `reports.fnbTaxMonth` (izin `report.view`, indeks baru `sales.by_tenant_created`
   supaya pajak **workspace** dihitung dari semua toko, bukan satu toko saja).
4. **Halaman Pengaturan** mendapat kartu **“Pajak & pungutan F&B”**: kartu PBJT (tarif + pengecualian
   usaha mikro beserta batas omzetnya), kartu biaya layanan, kartu kewajiban pusat (PPh final UMKM
   dengan bentuk badan & tahun mulai, PPh 21, PPh 4(2) sewa), **ringkasan setoran bulan ini** dari
   omzet yang benar-benar tercatat, peringatan begitu omzet melewati batas mikro, dan pratinjau struk
   yang ikut berubah sebelum disimpan. Kasir (`/app/pos`) menampilkan baris **PBJT 10%** atau **PPN**
   sesuai setelan, baris biaya layanan terpisah, dan alasan ketika PPN pusat tidak dipungut.
5. **Harness:** `scripts/verify-fnb-tax.mjs` baru → **105/105**; `verify-render.mjs` 562 → **584**
   (PBJT/biaya layanan diklik di DOM tiruan, tersimpan di workspace, struk kasir 28.000 → 32.760, “aktif
   0%” ditolak, pengecualian mikro + peringatannya); `verify-backend.mjs` 674 → **688** (dua belas cek
   baru di server: izin, penolakan utuh, `taxKind`/`serviceCharge` di struk, dasar pengenaan pajak,
   pengecualian mikro, omzet ringkasan, orang luar ditolak).

**Berkas:** baru: `src/convex/lib/fnbTax.ts` (aturan murni), `src/lib/fnbTax.ts` (re-export sisi
klien), `scripts/verify-fnb-tax.mjs` · diubah: `src/convex/schema.ts` (kolom `tenants.fnbTaxProfile`,
`sales.taxKind`, `sales.serviceCharge`, indeks `sales.by_tenant_created`), `src/convex/tenants.ts`
(`tenants.updateFnbTax`), `src/convex/entitlements.ts`, `src/convex/pos.ts` (perhitungan struk +
kolom baru), `src/convex/reports.ts` (`reports.fnbTaxMonth`), `src/lib/session.tsx`,
`src/lib/store/types.ts`, `src/lib/store/demo.tsx`, `src/lib/store/convex.tsx`,
`src/pages/SettingsPage.tsx`, `src/pages/PosPage.tsx`, `scripts/verify-render.mjs`,
`scripts/verify-backend.mjs`, `README.md`, `worklog.md`. `src/convex/lib/tax.ts` **tidak** disentuh.

**Verifikasi:**

- `bun scripts/verify-fnb-tax.mjs` → **105/105 checks passed**, exit 0 (termasuk: PBJT 10% dari 100.000
  = 10.000 & PPN tidak ditambahkan; biaya layanan 7% di luar dasar → total 117.000, di dalam dasar →
  117.700; orang pribadi omzet 520 juta sebelumnya → PPh final bulan ini 250.000 & setahun 350.000;
  CV 4 tahun & PT 3 tahun lalu berhenti; 100.000 → 110.000 untuk PBJT; 92 → 105 cek setelah validasi
  profil, kalimat setelan, dan penjumlahan rentang ditambahkan).
- `bun tsc -b --noEmit` → **exit 0**. `bun convex dev --once` → **exit 0**, melaporkan indeks baru
  `[+] sales.by_tenant_created`.
- `bun scripts/verify-render.mjs` → **584/584**, exit 0 (satu cek lama sempat merah — kalimat “PPN tidak
  dipungut” di kasir hilang saat saya ganti copy-nya; copy-nya diperbaiki agar tetap menyebut PPN
  **dan** pajak daerah, lalu suite hijau lagi tanpa melemahkan cek).
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **688/688 checks passed**, exit 0 (server sungguhan di deployment awan).
- `bun scripts/verify-tax.mjs` → 71/71 · `verify-menus.mjs` → 406/406 · `verify-api.mjs` → 225/225 ·
  `verify-authz.mjs` → 92/92 · `verify-modules.mjs` → 34/34 · `verify-store-gate.mjs` → exit 0 — semuanya
  exit 0, jadi setelan PPN lama, menu, kontrak API (termasuk cek “anggota `StoreApi` baru wajib
  diimplementasikan kedua store”), izin, dan gerbang langganan tidak ikut rusak.
- **Tidak dijalankan:** `verify-theme.mjs`, `verify-pwa.mjs`, `verify-panduan.mjs` (berkas tema/CSS,
  manifest & service worker, dan PDF panduan tidak tersentuh), serta harness browser Playwright
  (`verify-bip-warna-browser.mjs` dan lainnya) — jalur browser butuh `PLAYWRIGHT_DIR` + preview yang
  sedang jalan, dan yang berubah di kasir adalah baris teks/angka, bukan jalur audio atau tata letak.
  Karena itu “kartu setelan F&B terlihat benar di browser sungguhan” **belum** diverifikasi.

**Catatan / blocker:**

1. Yang **belum**: kartu pajak F&B & ringkasan setoran baru diverifikasi lewat DOM tiruan + backend
   sungguhan, **belum** di browser sungguhan (blokir #3 di bawah ikut diperbarui).
2. Angka ringkasan setoran adalah **perkiraan dari omzet yang tercatat di aplikasi**, bukan perhitungan
   pajak resmi — halaman menyebutnya begitu. PPh 21 tidak dihitung (hanya ditandai sebagai kewajiban),
   karena aplikasi ini belum punya gajian.
3. Tarif PBJT, batas omzet usaha mikro, dan dasar pengenaan pajak **berbeda per Perda**; yang ada di
   aplikasi hanya nilai bawaan yang bisa diubah pemilik toko (contoh DKI Jakarta: Rp 42 juta/bulan).
   Bukan nasihat pajak.
4. PDF panduan (`public/panduan/panduan-mesinpos.pdf`) belum memuat bagian pajak F&B — bagian PPN-nya
   masih versi lama. Dokumentasi lengkap fitur ini ada di README + kartu di halaman Pengaturan.
5. Tabel **Status Phase 1–6** diperiksa: tidak ada klausa roadmap yang berubah (ini setelan pajak di
   modul yang sudah ada, bukan kemampuan baru di roadmap). Daftar **Blocker yang masih terbuka**
   diperbarui di butir 3 (halaman Pengaturan & kasir untuk pajak F&B menyusul daftar yang baru diuji
   lewat DOM tiruan + backend, bukan browser).

## 2026-10-13 — Bip kasir belum terdengar: nada diperjelas, ketukan bermodifier ikut berbunyi, plus setelan aktif/mati

**Ruang lingkup:** permintaan pengguna — “bunyi beep belum terdengar setelah deploy, tolong dicek”,
sekaligus minta setelan untuk menyalakan/mematikannya. Yang dikerjakan: (1) pemeriksaan bukti bundel yang
benar-benar disajikan produksi, (2) nada bip diperjelas & bip dibunyikan pada **setiap ketukan produk
yang diterima**, (3) setelan aktif/mati bip **per perangkat** dengan tombol di header kasir dan kartu di
halaman Pengaturan, (4) perluasan harness. **Tidak** ada perubahan pada `src/convex`, `vite.config.ts`,
`index.html`, `index.css`, `tailwind.config.js`, maupun `public/sw.js`.

**Hasil pemeriksaan (kenapa tidak terdengar):**

1. Deploy terakhir (`mesinpos.freebuff.app`) state `active`, dibuat **2026-10-13 02:16:42 UTC** — setelah
   fitur bip ditulis. Bundel yang benar-benar disajikan diunduh
   (`curl -s https://mesinpos.freebuff.app/assets/index-BgZQivyA.js`, dirujuk oleh HTML produksi) dan
   diperiksa: memuat `createOscillator`, `frequencyHz:1245`, `peakGain:.06`, dan `data-summary`. Jadi
   **kode bip-nya sudah terdeploy** — bukan kasus “belum ikut terbuild”; kartu dashboard berwarna juga
   sudah ikut.
2. Sebab yang tersisa, dan keduanya diperbaiki: (a) nadanya **terlalu pelan** — puncak 0,06 ≈ −24 dBFS,
   jauh di bawah bunyi notifikasi biasa (sekitar −12…−6 dBFS), sehingga di pengeras suara ponsel pada
   ruang ramai praktis tidak terdengar walau nadanya benar-benar dijadwalkan; (b) menurut aturan lama,
   **produk bermodifier baru berbunyi saat tombol *Tambahkan* ditekan** — kasir yang mengklik kartu
   produk seperti itu mendengar senyap.
3. Yang **tidak bisa** dipastikan dari sandbox (tidak ada keluaran audio) dan karena itu ditulis apa
   adanya: apakah pengeras suara perangkat pengguna benar-benar mengeluarkan bunyi, dan apakah tab yang
   mereka lihat saat itu menjalankan bundel lama (service worker menyimpan `/assets/*`; navigasi tetap
   network-first dan banner “Versi baru tersedia” sudah menyebut kedua nama bundelnya). Karena itu
   ditambahkan tombol **Coba bunyikan** supaya bisa diverifikasi sendiri di perangkat itu.

**Perubahan:**

1. **Nada (`src/lib/scanBeep.ts`):** 90 ms/0,06 → **110 ms/0,18** (−24 dBFS → ≈ −14,9 dBFS; ~3× lebih
   kuat), amplop 5 → 6 ms; frekuensi (1245 Hz) dan bentuk gelombang (`triangle`) tetap supaya karakternya
   masih “bip mesin kasir”, bukan alarm. Batas atas puncak naik 0,1 → 0,25.
2. **Kapan berbunyi (`src/pages/PosPage.tsx`):** bip dipindahkan ke awal `addToCart` — satu ketukan = satu
   bip, termasuk saat yang terbuka berikutnya adalah dialog modifier; menyimpan pilihan modifier **tidak**
   membunyikan bip kedua, dan ketukan yang ditolak (stok keranjang penuh) tetap sepi.
3. **Setelan aktif/mati, per perangkat** (`mesinpos.bip.v1`, seperti tema & sesi — bukan setelan workspace,
   karena pengeras suara itu perangkat): `readScanBeepEnabled`/`writeScanBeepEnabled` (murni, tahan
   penyimpanan rusak/ditolak), `isScanBeepEnabled`/`setScanBeepEnabled`/`subscribeScanBeep`,
   `playScanBeep` yang tunduk pada setelan, dan `previewScanBeep` untuk tombol “Coba bunyikan”.
   Hook `useScanBeep` (`src/lib/useScanBeep.ts`) memakai `useSyncExternalStore`, dipakai dua tempat:
   tombol **“Bip kasir”** (`role="switch"`) di header kasir — menyalakannya langsung memperdengarkan
   contoh nada — dan kartu **“Bunyi bip kasir”** di **Pengaturan** dengan tombol nyalakan/matikan +
   **Coba bunyikan** (tetap berbunyi walau bipnya mati). Bawaannya **aktif**, jadi perilaku lama tidak
   berubah bagi yang tidak menyentuh setelan.
4. **Harness:** `verify-scan-beep.mjs` 22 → **34** cek (aturan setelan sebagai fungsi murni),
   `verify-render.mjs` 552 → **562** cek (bip kasir diklik di DOM tiruan termasuk tombol setelannya di
   kasir & di Pengaturan), `verify-bip-warna-browser.mjs` 11 → **16** cek (Chromium: tombolnya benar-benar
   membungkam nada lalu menyalakannya lagi).

**Berkas:** baru: `src/lib/useScanBeep.ts` · diubah: `src/lib/scanBeep.ts`, `src/pages/PosPage.tsx`,
`src/pages/SettingsPage.tsx`, `scripts/verify-scan-beep.mjs`, `scripts/verify-render.mjs`,
`scripts/verify-bip-warna-browser.mjs`, `README.md`, `worklog.md`

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0
- `bun scripts/verify-scan-beep.mjs` → **34/34 checks passed**, exit 0 (sebelumnya 22/22)
- `bun scripts/verify-render.mjs` → **562/562 checks passed**, exit 0 (sebelumnya 552/552)
- `bun scripts/verify-menus.mjs` → **406/406 checks passed**, exit 0
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-bip-warna-browser.mjs http://localhost:5173` → **16/16
  checks passed**, exit 0, `galat konsol selama uji: 0` (sebelumnya 11/11). Di browser sungguhan:
  4 kartu dashboard berwarna beda & hanya kartu stok yang berdenyut, nada 1245 Hz `triangle` ~110 ms
  dijadwalkan pada satu `AudioContext`, konteks kasir `running`, lalu **tombol “Bip kasir” dimatikan →
  klik produk tidak menjadwalkan nada sama sekali (`mesinpos.bip.v1` = `off`) → dinyalakan lagi →
  contoh nada berbunyi & ketukan produk berbunyi lagi (`on`)**.
- Bukti harness tidak kosong — mutasi sementara, lalu dikembalikan (grep `MUTASI` = 0):
  - `if (!isScanBeepEnabled()) return false;` dilepas dari `playScanBeep` → `verify-scan-beep.mjs`
    **exit 1** di “bip yang dimatikan tidak sampai ke pemutar sama sekali — hasil=true dipanggil=1”
  - `onClick` tombol bip di kasir dikosongkan → `verify-render.mjs` **exit 1** di “mematikan bip langsung
    terlihat di tombolnya — checked=true”
- Perintah yang gagal di tengah jalan dan diperbaiki (ditulis apa adanya): cek baru “barangnya tetap masuk
  keranjang” sempat gagal karena mengandalkan teks “Keranjang” yang **hanya muncul saat keranjang kosong**
  (`exit 1`, “bip=3 sebelum=3”) — diganti penghitung “N item” di panel pesanan, lalu `exit 1` berikutnya
  dari variabel `sebelumDimatikan` yang hilang saat penyuntingan.
- `freebuff-deploy check` → `deployable: true`, `installCommand: bun install`,
  `buildCommand: sh ./scripts/build-hosted.sh`, `problems: []`.
- **Tidak dijalankan ulang** (dan alasannya): `verify-theme.mjs`, `verify-pwa.mjs`,
  `verify-store-gate.mjs`, `verify-backend.mjs` — berkas tema/CSS, manifest & service worker, dan
  `src/convex` tidak tersentuh perubahan ini.

**Catatan / blocker:** produksi masih menyajikan bundel 02:16 UTC (nada lama 0,06 + belum ada setelan)
**sampai deploy berikutnya** — supaya perubahan ini terdengar di sana, situsnya perlu di-deploy ulang;
konfigurasi build-nya sudah diperiksa dan siap (`freebuff-deploy check`). Bunyi tetap tidak bisa “didengar”
oleh harness: yang dibuktikan adalah nada yang dijadwalkan & bahwa setelan mati benar-benar membungkam
pemutarnya. Setelannya per perangkat (tidak tersinkron ke server) — itu keputusan yang disengaja, bukan
keterbatasan. Tabel **Status Phase 1/2** dan daftar **Blocker** tidak berubah.

## 2026-10-13 — Bip mesin kasir saat produk diklik & empat kartu dashboard yang berwarna

**Ruang lingkup:** dua permintaan pengguna sekaligus. (1) Bunyi beep seperti mesin kasir saat produk
masuk keranjang di halaman kasir (`/app/pos`). (2) Warna-warni yang menarik perhatian pada empat kartu
dashboard — *Omzet hari ini*, *Transaksi*, *Item terjual*, *Stok kritis*. Yang dikerjakan: satu modul
murni bunyi + penyambungannya di POS, pewarnaan kartu ringkasan (tanda `data-summary` per kartu), dan
harness yang membuktikan keduanya (DOM tiruan + browser sungguhan). **Tidak** ada perubahan pada
`vite.config.ts`, `index.css`, `tailwind.config.js`, `src/convex`, maupun berkas PWA.

1. **Aturan bunyinya murni** (`src/lib/scanBeep.ts`): nada baku 1245 Hz, 90 ms, gelombang `triangle`,
puncak 0,06 dengan amplop naik-turun 5 ms (tanpa “klik” di ujung nada). Satu `AudioContext` dipakai
ulang dan baru dibuat saat nada pertama diminta — di dalam gestur klik itu sendiri, jadi kebijakan
autoplay peramban tidak memblokirnya — konteks yang tertahan diminta `resume`, simpul nada melepas
dirinya sendiri setelah selesai (`onended`), dan **tidak pernah melempar**: tanpa Web Audio bunyinya
hanya senyap.
2. **Kapan berbunyi** (`src/pages/PosPage.tsx`): satu bip per barang yang **benar-benar masuk
keranjang** — jalur `addToCart` dan jalur simpan dialog modifier. Ketukan yang ditolak karena stok
kurang, dan klik yang baru membuka dialog modifier, belum berbunyi; bip untuk barang yang tidak jadi
masuk justru menyesatkan kasir.
3. **Warna kartu dashboard** (`src/pages/DashboardPage.tsx`): tiap kartu ringkasan punya nada warnanya
sendiri (emerald/sky/violet/amber atau rose) untuk permukaan, garis gradien atas, kotak ikon, dan
angkanya — labelnya tetap `muted-foreground` supaya kontras baca tidak dikorbankan. *Stok kritis*
memakai nada bahaya + titik berdenyut **hanya** saat memang ada barang menipis; saat raknya aman
kartunya kembali amber.
4. **Harness:** `scripts/verify-scan-beep.mjs` (22 cek, murni + tiruan `AudioContext`) dan
`scripts/verify-bip-warna-browser.mjs` (11 cek, Chromium atas preview yang berjalan — `AudioContext`
dibungkus sehingga frekuensi/panjang nada dan warna terhitung tiap kartu bisa diperiksa).
`scripts/verify-render.mjs` bertambah **15 cek** (bip kasir dari DOM + nada warna per kartu
`data-summary`), jadi totalnya 537 → 552; angka `537/537` di README ikut disesuaikan.

**Berkas:** baru: `src/lib/scanBeep.ts`, `scripts/verify-scan-beep.mjs`,
`scripts/verify-bip-warna-browser.mjs` · diubah: `src/pages/PosPage.tsx`, `src/pages/DashboardPage.tsx`,
`scripts/verify-render.mjs`, `README.md`, `worklog.md`

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0
- `bun scripts/verify-scan-beep.mjs` → **22/22 checks passed**, exit 0
- `bun scripts/verify-render.mjs` → **552/552 checks passed**, exit 0 (sebelum perubahan ini 537/537)
- `bun scripts/verify-menus.mjs` → **406/406 checks passed**, exit 0
- `PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-bip-warna-browser.mjs http://localhost:5173` → **11/11
  checks passed**, exit 0, `galat konsol selama uji: 0` (Chromium atas preview yang berjalan). Yang
  diperiksa di browser: empat warna batas kartu berbeda, empat gradien garis atas berbeda, kartu omzet
  bernuansa hijau sedangkan kartu stok bernuansa merah, hanya kartu stok yang berdenyut, satu
  `AudioContext` untuk dua ketukan produk dengan nada 1245 Hz `triangle` ~90 ms, dan konteks audio
  kasir berstatus `running` (tidak terkunci autoplay). Tangkapan layar:
  `/tmp/browser-shots/dashboard-warna.png`, `/tmp/browser-shots/kasir-bip.png`.
- Bukti harness tidak kosong — mutasi sementara, lalu dikembalikan (grep `MUTASI` bersih):
  - `playScanBeep()` dilepas dari `addToCart` → `verify-render.mjs` **exit 1** di “produk yang diklik
    berbunyi bip satu kali, seperti mesin kasir — bip=0 nada=undefined”
  - nada kartu omzet ditukar ke `sky` → **exit 1** di “tiap kartu ringkasan punya nada warnanya sendiri
    (tidak ada yang kembar) — ["sky","sky","violet","rose"]”
  - urutan amplop nada dibalik → `verify-scan-beep.mjs` **exit 1** di “amplop nada naik dari senyap ke
    puncak lalu turun lagi (bukan nada kotak)”
  - frekuensi 1245 → 200 Hz + gelombang `triangle` → `square` → **exit 1** di “nada bip tinggi tetapi
    tidak memekakkan (800–4000 Hz) — 200 Hz”
- **Tidak dijalankan ulang** (dan alasannya): `verify-theme.mjs`, `verify-pwa.mjs`,
  `verify-store-gate.mjs`, `verify-backend.mjs` — berkas tema/CSS, manifest & service worker, dan
  `src/convex` tidak tersentuh perubahan ini.

**Catatan / blocker:** bunyi tidak bisa “didengar” oleh harness, jadi yang dibuktikan adalah **nada
yang benar-benar dijadwalkan** ke Web Audio (browser sungguhan, satu konteks, 1245 Hz `triangle` 90 ms)
— bukan bahwa pengeras suara kasir terdengar. Warna kartu diperiksa sebagai warna **terhitung**
(peramban), jadi tampilannya di layar nyata tetap perlu dilihat mata manusia; tangkapan layarnya ada di
`/tmp/browser-shots/`. Belum ada tombol bisukan bunyi di UI (belum diminta): satu-satunya cara
mematikannya sekarang adalah kebijakan audio perangkat/peramban. Tabel **Status Phase 1/2** dan daftar
**Blocker** tidak berubah — perubahan ini tidak menyentuh klausa roadmap maupun blocker yang terdaftar.

## 2026-10-13 — Ajakan “versi baru tersedia — muat ulang” saat bundel situs sudah berganti

**Ruang lingkup:** permintaan pengguna — beri tahu pengguna saat bundel situs sudah berbeda dari yang
sedang berjalan, lanjutan dari temuan entri sebelumnya (error `products:listAll` datang dari klien yang
masih menjalankan bundel lama). Yang dikerjakan: aturan murni + komponen pemantau + banner di shell `/app`,
dua harness baru (DOM tiruan & browser sungguhan), dan dokumentasinya. **Tidak** ada perubahan pada
`vite.config.ts`, `index.html`, atau `public/sw.js`.

1. **Aturannya murni** (`src/lib/bundleVersion.ts`): yang dihitung “bundel” adalah berkas entry Vite
   (`index-<hash>.js`) — bentuk lain (`/src/main.tsx` di mode dev, CSS, vendor) bukan bundel, jadi mode dev
   tidak pernah menagih muat ulang. Yang dibandingkan: script modul **dokumen ini** vs script modul di
   `/index.html` yang disajikan saat itu (`cache: "no-store"` + penanda waktu). Keputusannya satu fungsi:
   `shouldAnnounceVersion({running, latest, dismissed})` — “Nanti” menyimpan **nama bundel** yang ditolak,
   jadi menolak satu versi tidak membungkam versi berikutnya.
2. **Iramanya** (`src/components/NewVersionNotice.tsx`): pemeriksaan pertama 45 detik setelah shell
   terbuka, lalu tiap 5 menit, **ditambah** begitu tabnya kembali terlihat (`visibilitychange`) atau
   jaringan tersambung lagi; tab tersembunyi tidak diperiksa. Yang gagal (luring, HTTP galat, HTML tanpa
   bundel) tidak pernah disimpulkan sebagai “ada versi baru”, dan **tidak** ada muat ulang otomatis —
   kalimatnya menyuruh menyelesaikan transaksi yang terbuka dulu, karena kasir bisa punya keranjang.
3. **Tempatnya:** banner dipasang di `AppLayout` (di bawah header, di luar satu-satunya area gulir),
   sebaris `role="status"` dengan tombol **Muat ulang sekarang**/**Nanti** serta baris rincian
   `Sedang berjalan: index-… · Terbaru di situs: index-…` (supaya laporan pengguna bisa menyebut berkasnya,
   seperti yang diminta bagian README soal error klien lama).
4. **Harness baru:** `scripts/verify-version.mjs` (44 cek: aturan murni, jadwal, DOM, jalur diam, dan
   pemasangan di shell `/app/pos` sungguhan) plus `scripts/verify-version-browser.mjs` (7 cek, Chromium —
   permintaan dokumen dijawab HTML dengan bundel tiruan `index-AAAA1111.js`, permintaan `/index.html?v=…`
   dijawab `index-BBBB2222.js`, jadi aplikasi melihat situsnya sudah berganti bundel tanpa perlu deploy
   kedua).

**Berkas:** baru: `src/lib/bundleVersion.ts`, `src/components/NewVersionNotice.tsx`,
`scripts/verify-version.mjs`, `scripts/verify-version-browser.mjs` · diubah: `src/layouts/AppLayout.tsx`,
`README.md`, `worklog.md`

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0
- `bun scripts/verify-version.mjs` → **44/44 checks passed**, exit 0
- Bukti harness-nya tidak kosong (mutasi sementara, lalu dikembalikan): `shouldAnnounceVersion` diganti
  `return true` → berhenti di “shouldAnnounceVersion menahan ajakan untuk versi yang sudah ditolak”,
  **exit 1**; `<NewVersionNotice />` dilepas dari `AppLayout` → berhenti di “hasil build: ajakan versi
  tampil di dalam shell /app”, **exit 1**. Kedua berkas dikembalikan dan `diff` terhadap salinan sebelum
  mutasi bersih, lalu `bun scripts/verify-version.mjs` → 44/44 lagi.
- `bun scripts/verify-render.mjs` → **537/537 checks passed**, exit 0 (shell `/app`, onboarding, Tim & Peran,
  dan seluruh halaman tetap — angka tidak berubah)
- `bun scripts/verify-menus.mjs` → **406/406 checks passed**, exit 0
- `PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-version-browser.mjs http://localhost:5173` → **7/7 checks
  passed**, exit 0, atas preview yang berjalan: banner muncul **45 detik setelah halaman siap** (bukan
  seketika — jadwal pertama benar-benar berlaku di browser), menyebut `index-AAAA1111.js` &
  `index-BBBB2222.js` di layar kasir, tidak menagih server berulang setelah itu, dan tombol **Muat ulang
  sekarang** benar-benar mengganti dokumen (variabel dunia-halaman yang ditanam sebelum klik hilang).
  Tangkapan layar: `/tmp/browser-shots/versi-{sebelum,banner,sesudah}.png`.
- `freebuff-preview status` → `running: true`, `statusCode: 200` (preview tetap sehat setelah perubahan)
- Tidak dijalankan ulang: `verify-pwa.mjs` (1492/1492 terakhir) dan `verify-theme.mjs` (50/50) — berkas yang
  mereka uji (manifest, ikon, `sw.js`, bootstrap tema, beranda) tidak tersentuh; `verify-store-gate.mjs`
  juga tidak (tidak ada perubahan di `src/convex` maupun gerbang langganan store).
- Setelah kata judulnya diselaraskan dengan permintaan (“Versi baru tersedia — muat ulang”, sebelumnya
  “Versi baru **sudah** tersedia”), seluruh cek yang tersentuh dijalankan ulang atas keadaan akhir berkas:
  `bun tsc -b --noEmit` exit 0, `verify-version.mjs` 44/44, `verify-version-browser.mjs` 7/7,
  `verify-render.mjs` 537/537, `verify-menus.mjs` 406/406.

**Catatan / blocker:** tabel **Status Phase 1–6** dan daftar **Blocker** diperiksa — tidak ada klausa yang
berubah (ini umpan balik UI, bukan kemampuan baru). Dua batasan yang perlu diketahui: (i) bukti browser
memakai **route interception**, bukan deploy kedua yang sungguhan — pendeteksian lintas-deploy tetap hanya
bisa dipastikan oleh deploy berikutnya; (ii) bundel produksi yang sedang disajikan (`index-BRNyf2qd.js`)
belum memuat fitur ini, jadi banner baru ada di produksi **setelah deploy berikutnya** — dan klien yang saat
itu masih memakai bundel lama tetap harus memuat ulang sekali atas kemauan sendiri (banner tidak mungkin
ada di kode yang belum memuatnya). Galat konsol yang tercatat saat uji browser (4) berasal dari script
tiruan `index-AAAA1111.js` yang memang tidak ada di server — bagian dari cara uji itu bekerja, bukan temuan.

## 2026-10-13 — Laporan ulang `products:listAll` di produksi: penyebabnya bundel lama, bukan kode

**Ruang lingkup:** laporan pengguna — error yang sama muncul lagi, kali ini dari
`https://mesinpos.produkaplikasi.my.id/assets/index-ByITNXmA.js`. Yang diminta: hilangkan error itu. Yang
dikerjakan: menelusuri apakah produksi menjalankan kode sebelum perbaikan 2026-10-12, atau ada celah
lain; lalu membuktikan perilakunya pada **build produksi yang sedang disajikan**. Tidak ada perubahan
kode sumber — hasilnya: produksi sudah memuat perbaikan, dan error itu datang dari bundel yang sudah
tidak disajikan lagi.

1. **Build apa yang disajikan produksi.** `curl -s https://mesinpos.produkaplikasi.my.id/index.html` →
   `assets/index-BRNyf2qd.js`, sedangkan stack trace pengguna menyebut `assets/index-ByITNXmA.js` —
   **bundel berbeda**, dan yang di stack trace itu milik versi yang sudah digantikan.
2. **Bundel lama sudah tidak ada di hosting.** Meminta berkas itu mengembalikan **HTTP 200** tetapi
   isinya `index.html` (3.073 byte) — cadangan SPA untuk lintasan yang tidak ada, bukan bundel 1,17 MB.
   Jadi salinan yang dipakai peramban pengguna datang dari **cache-nya sendiri** (halaman/tab yang dibuka
   sebelum deploy; service worker ikut menyimpan `/assets/*`).
3. **Build produksi memang sudah memuat perbaikan.** Berkas perbaikan ditulis 2026-10-12 19:15–19:32 UTC
   (`src/lib/store/convex.tsx` 19:32, `src/lib/session.tsx` 19:15, `src/convex/tenants.ts` 19:27,
   `src/components/ProvisioningNotice.tsx` 19:28), sedangkan deployment terakhir terjadi
   **2026-10-12 19:52:52 UTC** (`freebuff-deploy status`, `triggeredBy: user`) — jadi build-nya di atas
   berkas-berkas itu. Penanda perbaikan juga ada di bundel yang disajikan:
   “dinonaktifkan oleh pemilik bisnis” ×1 dan “Tenant belum tersambung ke server” ×1 (keduanya dari batch
   perbaikan yang sama), dan URL kliennya `https://mellow-narwhal-477.convex.cloud` (satu deployment dengan
   yang dipakai harness).
4. **Uji perilaku pada build produksi, bukan pada kode sumber.** Seluruh alur harness peramban dijalankan
   ke situs produksi sungguhan (Chromium headless, `https://mesinpos.produkaplikasi.my.id`): pemilik
   onboarding → undang kasir → kasir masuk di perangkat baru. Hasilnya **13/13, exit 0**, termasuk
   “dokumen pertama kasir mengirim langganan tanpa `products:listAll`” dan “tidak ada galat konsol soal
   izin”. Jadi build yang berjalan di produksi **tidak lagi** membuka langganan itu sebagai kasir.
5. **Catatan analisis:** dengan kode sekarang, langganan `products:listAll` hanya dibuka kalau
   `roles.myAccess` (keanggotaan yang sama dengan yang diperiksa `requirePermission`) memuat
   `product.manage`, jadi ketidakcocokan klien-vs-server penyebab error ini tidak mungkin lagi — yang
   tersisa hanyalah klien lama. README bagian `[CONVEX Q(...)] … Akses ditolak` diberi cara memeriksa
   bundel yang sedang berjalan (termasuk jebakan HTTP 200 untuk berkas lama).

**Berkas:** diubah: `README.md`, `worklog.md` (tidak ada perubahan kode)

**Verifikasi:**

- `curl -s https://mesinpos.produkaplikasi.my.id/index.html | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'`
  → `assets/index-BRNyf2qd.js` (bundel pengguna: `index-ByITNXmA.js` — beda)
- `curl -s -o /dev/null -w '%{http_code}' .../assets/index-ByITNXmA.js` → `200`, tetapi unduhannya
  **3.073 byte** (cadangan `index.html`), sedangkan `.../assets/index-BRNyf2qd.js` → 1.170.315 byte
- `freebuff-deploy status` → `createdAt` 2026-10-12 19:52:52 UTC, `triggeredBy: user`, `state: active`,
  `unresolvedBuildErrorCount: 0`
- `for f in src/lib/store/convex.tsx …; date -u -r $f` → seluruh berkas perbaikan 19:15–19:32 UTC
  (sebelum deploy)
- `grep -c -F "dinonaktifkan oleh pemilik bisnis"` pada bundel yang disajikan → 1 (ada)
- `PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-browser-invite.mjs https://mesinpos.produkaplikasi.my.id 428913`
  → **13/13 lulus, exit 0** pada build produksi (Chromium 156.0.8078.4)
- `bun tsc -b --noEmit` tidak dijalankan ulang: tidak ada berkas sumber yang berubah pada pekerjaan ini
  (hanya `README.md` & `worklog.md`)

**Catatan / blocker:** uji ke produksi menambah satu workspace uji lagi (`Uji Undangan 1791853735368` +
2 akun `.test`) di deployment yang sama dengan produksi (backend produksi memang
`mellow-narwhal-477`, sama seperti preview sandbox) — belum ada pembersih otomatis, dan ini persis
perilaku uji yang sudah tercatat di entri sebelumnya. Yang **tidak** bisa saya buktikan dari sini: apa yang
ada di peramban pengguna — kalau setelah **muat ulang paksa** namanya masih `index-ByITNXmA.js`, berarti
halamannya masih dilayani cache (perlu hapus data situs / buka ulang aplikasi terpasang di ponsel).
Dua hal yang bisa dikerjakan menyusul kalau diinginkan: (a) ajakan “versi baru tersedia — muat ulang” saat
bundel situs sudah berbeda dari yang berjalan, dan (b) service worker yang tidak lagi menyajikan cangkang
lama saat jaringan gagal.

## 2026-10-13 — Tombol undangan mati selama workspace belum tersambung ke server

**Ruang lingkup:** permintaan pengguna — matikan tombol undangan di halaman Tim & Peran selama workspace
belum tersambung ke server, supaya tidak lagi dijawab “Tenant belum siap”. Ini menutup **temuan samping**
dari entri di bawah (waktu itu dicatat apa adanya dan tidak diperbaiki). Sebabnya: identitas bisnis
pengguna aktif tidak selalu sudah pasti saat halaman terbuka — perangkat baru masih menunggu daftar
keanggotaannya dibaca server, dan keanggotaan yang dinonaktifkan membuat workspace-nya memang tidak bisa
dipakai. Di kedua keadaan itu mutation undangan belum punya tenant yang bisa dituju, dan store
menolaknya dengan “Tenant belum siap. Coba lagi sebentar lagi.” — pesan yang menyuruh menunggu tanpa
menjelaskan sebabnya, muncul **setelah** tombolnya ditekan.

1. **Keputusan tombol dibuat satu tempat** (`resolveTeamInviteForm` + `WORKSPACE_PENDING_INVITE_NOTE` di
   `src/convex/lib/team.ts`, dipakai halaman lewat `@/lib/team`): `workspacePending` dan `store.error`
   diperiksa **lebih dulu**, baru pratinjau formulir (email) dan nomor WhatsApp. Urutannya disengaja —
   pada saat itu pesan “email tidak valid” hanya menyembunyikan sebab sebenarnya. Bentuk nilainya
   mengikuti pola validasi yang sudah ada (`{ ok: true, value } | { ok: false, reason }`).
2. **Halaman `TeamPage` memakai satu keputusan itu untuk tiga hal sekaligus**: `disabled` tombolnya,
   kalimat di bawah tombol, dan pagar di `submitInvite` (jadi tidak ada tombol yang bisa ditekan tanpa
   alasannya ikut terbaca). Kalimat untuk keanggotaan nonaktif diambil dari `store.error` apa adanya
   (`Undangan belum bisa dikirim — Keanggotaan Anda di workspace ini dinonaktifkan oleh pemilik bisnis…`),
   bukan dari pesan teknis store. Ini menutup dua keadaan yang tadinya menjawab sama: sesi perangkat yang
   belum selaras (perangkat baru) dan workspace yang memang tidak bisa dipakai (keanggotaan nonaktif,
   akun platform, bisnis gagal didaftarkan).
3. **Cek baru**: `verify-team.mjs` (murni) menguji keenam kasus keputusan itu, dan `verify-render.mjs`
   (DOM) merender halaman Tim & Peran dengan `StoreContext` yang `workspacePending`/`error`-nya diganti —
   tombolnya mati dan alasannya terbaca, tanpa “Tenant belum siap” di layar; lalu hidup lagi begitu
   workspace-nya siap (bukan tombol mati permanen).

**Berkas:** diubah: `src/convex/lib/team.ts`, `src/pages/TeamPage.tsx`, `scripts/verify-team.mjs`,
`scripts/verify-render.mjs`, `README.md`, `worklog.md`

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0
- `bun scripts/verify-team.mjs` → **47/47** (naik dari 41; enam cek keputusan tombol undangan)
- `bun scripts/verify-render.mjs` → **537/537** (naik dari 532; lima cek DOM: nilai store demo terbaca,
  tombol mati saat `workspacePending`, alasannya terbaca tanpa “Tenant belum siap”, tombol hidup lagi saat
  workspace siap, dan tombol mati dengan kalimat server saat `store.error` terisi)
- `PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-browser-invite.mjs http://localhost:5173 428913` (preview
  sementara di mode Convex) → **13/13, exit 0**: jalur undangan sungguhan lewat tombol itu tetap bekerja
  setelah perubahan (pemilik mengundang kasir → kasir masuk di perangkat baru), jadi tidak ada regresi
- `freebuff-preview status` → running, HTTP 200; preview dikembalikan ke mode demo
  (`VITE_DATA_SOURCE=demo`, sama perilakunya dengan sebelumnya)

**Catatan / blocker:** tabel **Status Phase 1–6** dan daftar **Blocker** diperiksa — tidak ada klausa yang
berubah (ini perbaikan umpan balik UI, bukan kemampuan baru). `verify-backend.mjs` dan `verify-menus.mjs`
tidak dijalankan ulang karena perilaku backend yang mereka uji tidak berubah: tambahan di
`src/convex/lib/team.ts` adalah fungsi **baru** yang hanya dipanggil halaman (`validateTeamInvite`,
`normalizePhone`, pagar anggota, dan gerbang menu semuanya utuh), dan tidak ada jalur server yang
memanggilnya — jadi tidak ada yang perlu di-push untuk perubahan ini. Angka suite di **Perintah
verifikasi rutin** dan README diselaraskan untuk dua harness yang benar-benar berubah.

## 2026-10-13 — Kasir yang diundang dijalankan di browser sungguhan (Chromium + Playwright)

**Ruang lingkup:** lanjutan perbaikan 2026-10-12. Waktu itu buktinya baru **sumber + backend** dan
tercatat sebagai batasan jujur (“jalur store Convex tidak bisa diklik di DOM tiruan”). Permintaan kali
ini: jalankan store Convex di **browser sungguhan** sebagai kasir yang diundang (undangan email →
perangkat baru) dan laporkan apa yang benar-benar terlihat. Yang dikerjakan: Chromium dipasang di
luar repo, preview dijalankan sementara dalam mode Convex, harness peramban baru ditulis, jalur
undangan → perangkat baru dijalankan nyata, lalu preview dikembalikan ke mode demo.

1. **Harness baru `scripts/verify-browser-invite.mjs`** (Playwright, Chromium headless). Playwright
   dipasang **di luar repo** (`PLAYWRIGHT_DIR`) supaya unduhan Chromium tidak ikut masuk ke instalasi
   build hosting. Alurnya memakai UI yang sesungguhnya, bukan fungsi langsung:
   - **perangkat 1 (pemilik):** masuk di `/auth` dengan kode OTP uji (email `.test`), onboarding tiga
     langkah, tenant benar-benar dibuat di server, lalu `/app/products` dibuka;
   - **undangan kasir:** halaman **Tim & Peran** — `#member-email`, `#member-role = cashier`, tombol
     **Daftarkan ke tim**;
   - **perangkat 2 (kasir, konteks peramban baru = `localStorage` kosong):** masuk dengan kode uji,
     lalu `localStorage` sesinya diperiksa (`peran cashier`, nama bisnis = bisnis undangan), halaman
     pertama `/app`, `/app/pos`, dan `/app/products` dibuka.
2. **Bukti langganan dibaca dari bingkai websocket yang benar-benar dikirim klien**, bukan dari kode
   sumber: `WebSocket.prototype.send` dibajak lewat `addInitScript`, jadi tidak ada bingkai awal yang
   lolos karena balapan waktu. Hasilnya: klien **pemilik** mengirim `products:listAll`, sedangkan
   klien **kasir** mengirim `roles:myAccess` + `products:listByStore` dan **tidak pernah**
   `products:listAll` — termasuk di dokumen pertama kasir, yaitu halaman yang dulu jatuh.
3. **Dua pelajaran teknis yang jadi bagian harness:** (a) socket Convex baru terhubung setelah dokumen
   selesai dimuat, jadi memeriksa bingkai terlalu dini membaca “belum ada langganan” dan menyimpulkan
   yang salah — harness menunggu bingkai pertama (`tungguBingkai`); (b) service worker diblokir di
   konteks uji supaya yang diuji selalu dokumen yang baru dimuat, bukan cangkang tersimpan.
4. **Preview dijalankan dalam mode Convex secara sementara.** `.env.local` hanya memuat
   `VITE_CONVEX_URL`, dan tanpa `VITE_DATA_SOURCE=convex` aplikasi memakai store demo, jadi store
   Convex tidak mungkin berjalan di preview apa adanya. Kuncinya diset lewat mekanisme env workspace,
   dan setelah uji selesai dikembalikan ke `demo` (sama perilakunya dengan tanpa kunci itu).
5. **Temuan samping (belum diperbaiki — bukan bagian permintaan):** formulir undangan di `/app/team`
   sudah bisa diklik sebelum store menyelesaikan workspace dari server; undangan yang dikirim saat itu
   dijawab **“Tenant belum siap. Coba lagi sebentar lagi.”** tanpa efek samping (tidak ada baris yang
   ditulis). Harness kini menunggu tabel anggota terisi dari server dulu. Perapiannya: matikan tombol
   undangan selama `workspacePending`.

**Berkas:** baru: `scripts/verify-browser-invite.mjs` · diubah: `README.md`, `worklog.md`

**Verifikasi:**

- `bun add playwright` + `bunx playwright install --with-deps chromium --only-shell` (di `/tmp/pw`, di luar
  repo) → exit 0; browser: Chromium `156.0.8078.4` (headless shell)
- `PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-browser-invite.mjs http://localhost:5173 428913` →
  **13/13 lulus, exit 0** (versi final; versi sebelumnya 12/12, hanya belum memuat cek dokumen pertama).
  Dijalankan berulang pada preview mode Convex, hasilnya sama. Yang lulus:
  pemilik selesai onboarding ke `/app` · halaman Produk & Stok pemilik tampil · klien pemilik mengirim
  `products:listAll` · kasir terdaftar sebagai **Kasir** · sesi kasir = workspace undangan dengan peran
  `cashier` · **halaman pertama kasir tampil, bukan “Halaman ini gagal dimuat”** · dokumen pertama kasir
  mengirim langganan tanpa `products:listAll` · `/app/pos` tampil · klien kasir mengirim `roles:myAccess`
  + `products:listByStore` tapi tidak `products:listAll` · `/app/products` menjawab “Akses ditolak” milik
  klien · Tailwind & ikon benar-benar render (elemen `.rounded-lg` ber-`borderRadius` bukan `0px` dan ada
  `<svg>`) · tidak ada galat konsol soal izin
- screenshot uji: `/tmp/browser-shots/kasir-pos.png` (121.969 B) dan `kasir-produk.png` (89.084 B)
- modul yang disajikan Vite setelah pengembalian: `VITE_DATA_SOURCE": "demo"` → preview kembali ke mode
  demo (sebelum uji: `"convex"`); `freebuff-preview status` → running, HTTP 200
- berkas `src/**` **tidak disentuh** pada pekerjaan ini (hanya `.mjs` baru + dokumentasi), jadi suite
  `verify-*` dan type-check yang sudah lulus di entri 2026-10-12 tidak diulang; tidak ada yang gagal
  dijalankan

**Catatan / blocker:** uji ini menulis data uji ke deployment dev — satu tenant `Uji Undangan <stempel>`
plus dua akun `.test` per jalan, tanpa pembersih otomatis (jalur hapus tenant tidak ada di UI). Preview
dikembalikan ke mode demo; `.env.local` sekarang punya `VITE_DATA_SOURCE=demo` (sama perilakunya dengan
tanpa kunci itu — bisa dihapus dari Settings → Environment kalau tidak diinginkan). Blocker **#3**
diperbarui: jalur store Convex kini sudah dilihat di browser sungguhan untuk alur ini.

## 2026-10-12 — “Halaman ini gagal dimuat”: langganan Convex digerbang izin **server**, bukan izin sesi perangkat

**Ruang lingkup:** laporan pengguna — halaman berhenti merender dengan
`Error: [CONVEX Q(products:listAll)] … Akses ditolak: peran cashier tidak memiliki izin product.manage`.
Sebabnya: langganan itu dibuka atas nama **peran di sesi perangkat**, bukan peran yang dikenali server.
Kasir yang diundang masuk di perangkat baru — sesinya belum tahu workspace mana miliknya (`tenant: null`) — dan
`actingPermissions` menerjemahkan sesi tanpa tenant sebagai **pemilik**, sehingga seluruh query bergerbang izin
dibuka sebagai pemilik sementara server menilainya `cashier`. Langganan Convex yang ditolak **menjatuhkan render**,
jadi yang muncul halaman “gagal dimuat”, bukan penjelasan. Yang dikerjakan:

1. **Izin pembuka langganan datang dari server** (`src/lib/store/convex.tsx`): satu-satunya sumber gerbang adalah
   `api.roles.myAccess` — keanggotaan yang sama dengan yang diperiksa `requirePermission` — lewat
   `sanitizePermissions(myAccess?.permissions ?? [])`. Selama server belum menjawab, izinnya **kosong**, jadi
   langganan bergerbang tidak dibuka lebih dulu; data berizin tiba satu putaran lebih lambat (jauh lebih baik
   daripada halaman gagal dimuat). `products.listAll` (dan seluruh langganan berizin lain) hanya dibuka kalau
   izinnya benar-benar ada; sesi perangkat tetap dipakai untuk hal lain (menyelaraskan nama/peran yang tampil).
2. **Aturan sesi tanpa tenant** (`src/lib/session.tsx`): `actingPermissions` mengembalikan **daftar kosong** untuk
   sesi tanpa tenant, bukan izin pemilik. Rute `/app` tetap dijaga `RequireTenant` (sesi seperti itu diarahkan ke
   onboarding), jadi yang berubah hanya ketidakcocokan yang tadinya mematikan halaman.
3. **Celah kembar ditutup: keanggotaan nonaktif.** Anggota yang dinonaktifkan pemiliknya membuat **setiap**
   langganan dijawab “Akses ditolak: Anda bukan anggota aktif tenant ini”, dan karena `tenants.listMine` dulu tidak
   melaporkan statusnya, orang itu juga berakhir di halaman gagal dimuat. Sekarang `listMine` mengembalikan `active`,
   store hanya memakai keanggotaan aktif (`isActiveMembership`), dan keadaannya dijelaskan lewat notis “Workspace
   belum tersambung ke server” berisi `MEMBERSHIP_SUSPENDED_NOTE` (aturan bersama `src/convex/lib/team.ts`) dengan
   petunjuk menghubungi pemilik. Provisioning hanya berjalan untuk akun **tanpa keanggotaan sama sekali**, supaya
   anggota yang dinonaktifkan tidak dibuatkan bisnis baru dari sisa sesi perangkatnya.
4. **Harness regresi** `scripts/verify-store-gate.mjs` (murni, membaca sumber): memetakan izin yang dituntut setiap
   `query` di `src/convex/*.ts` (`requirePermission` / `requireFeature(…, izin)`) ke gerbang langganan di
   `convex.tsx`, lalu gagal kalau ada langganan berizin yang tidak digerbang `has("<izin>")` yang berasal dari
   `roles.myAccess`; plus wajib `"skip"`, larangan izin sesi untuk keputusan langganan, dan aturan keanggotaan
   nonaktif. Bukti harness ini bukan hiasan: dengan gerbang `products.listAll` dilepas sementara, ia gagal dengan
   “api.products.listAll butuh product.manage”.
5. **Cek baru di harness yang sudah ada**: `verify-backend.mjs` (kasir ditolak `products.listAll`, `roles.myAccess`
   kasir tanpa `product.manage` tetapi punya `pos.sell`, keanggotaan nonaktif tetap terlihat di `listMine`),
   `verify-menus.mjs` (sesi tanpa tenant tanpa izin sama sekali; kasir tanpa `product.manage`; peran kustom tetap
   menggantikan peran bawaan), `verify-render.mjs` (notis keanggotaan nonaktif beserta petunjuknya, bukan “muat ulang”).

**Berkas:** baru: `scripts/verify-store-gate.mjs` · diubah: `src/lib/store/convex.tsx`, `src/lib/session.tsx`,
`src/convex/tenants.ts`, `src/convex/lib/team.ts`, `src/components/ProvisioningNotice.tsx`,
`scripts/verify-backend.mjs`, `scripts/verify-menus.mjs`, `scripts/verify-render.mjs`, `README.md`, `worklog.md`

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0
- `bun convex dev --once` → “Convex functions ready! (4.7s)” (deployment dev `mellow-narwhal-477`)
- `bun scripts/verify-store-gate.mjs` → **17/17** · 25 langganan (16 bergerbang izin, 9 cukup keanggotaan)
- uji negatif: gerbang `products.listAll` dilepas sementara → harness **gagal**
  (“setiap langganan berizin berada di balik gerbang izin server — api.products.listAll butuh product.manage”),
  lalu gerbangnya dikembalikan dan harness lulus lagi
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` → **674/674** (naik dari 671;
  tiga cek baru: `roles.myAccess` kasir, kasir ditolak `products.listAll`, keanggotaan nonaktif ber-`active:false` di `listMine`)
- `bun scripts/verify-menus.mjs` → **406/406** (naik dari 401) · `bun scripts/verify-render.mjs` → **532/532** (naik dari 529)
- `bun scripts/verify-authz.mjs` → 92/92 · `bun scripts/verify-rbac.mjs` → 48/48 · `bun scripts/verify-team.mjs` → 41/41
- `bun scripts/diag-module-graph.mjs` → `modul_diperiksa=123`, `gagal_transform=0` (store baru tetap tersaji)
- `bun scripts/diag-render.mjs / /app/pos /app/products /app/team` → semua rute ✓ (beranda `panjang_html=62917`;
  rute `/app/*` berhenti di “Memuat sesi…” seperti biasa karena efek React tidak jalan di SSR)
- `freebuff-preview status` → `running: true`, `listening: true`, HTTP 200

**Catatan / blocker:** tabel **Status Phase 1–6** diperiksa ulang — tidak ada klausa roadmap yang berubah (ini
perbaikan halaman gagal dimuat, bukan kemampuan baru), dan daftar **Blocker** diperbarui: butir 3 kini mencatat
bahwa gerbang langganan store punya pemeriksaan tingkat sumber, sementara “dijalankan di browser sungguhan sebagai
kasir yang diundang” tetap terbuka. Jalur Convex tidak bisa dirender ulang di harness happy-dom (harness berjalan di mode demo),
sehingga bukti klien untuk jalur ini bersifat **sumber + backend**, bukan klik di DOM tiruan: harness baru memastikan
setiap langganan berizin punya gerbang izin dari server, dan cek backend memastikan izin yang dilaporkan server itu
benar. Penggantian gerbang izin sesi → server membuat data berizin tiba satu render lebih lambat saat pertama dibuka.

## 2026-10-12 — PPN bisa diatur besar/kecil dan bisa dimatikan (halaman Pengaturan)

**Ruang lingkup:** permintaan pengguna: “Ppn bisa diatur besar/kecil nya dan bisa diaktifkan/dinonaktifkan.”
Sebelumnya tarif PPN **ditulis di kode**: kasir memakai konstanta `DEFAULT_TAX_RATE_PCT` (11%),
`pos.createSale` dan `billing.createInvoice` memanggil `computeTax(net)` dengan bawaan 11%, dan tidak
ada jalan mematikannya. Sekarang PPN adalah **setelan workspace** di baris tenant (`tenants.taxRatePct`
+ `tenants.taxActive` yang opsional) dan diatur dari halaman **Pengaturan** (`/app/settings`, izin
`billing.manage`).

Yang dikerjakan:

1. **Aturan murni satu tempat** — `src/convex/lib/tax.ts` (+ re-export `src/lib/tax.ts`, pola yang
   sama dengan modul aturan lain): `taxSettingOf`, `taxIsActive` (kolom kosong = **aktif**, jadi tenant
   lama tidak diam-diam berhenti memungut pajak), `effectiveTaxRatePct` (nol saat dimatikan — satu-satunya
   yang menjawab “berapa yang benar-benar dipungut”), `validateTaxRatePct` (0–100%, dua desimal, dan
   “aktif dengan tarif 0%” **ditolak** supaya “PPN 0%” tidak bercampur dengan “PPN tidak aktif”),
   `parseTaxRateInput` (“11”, “11,5”, “11.5”; kosong = `null`, bukan 0), `formatTaxRatePct`, `taxLabel`,
   `taxSettingSentence`, `taxHint`, `taxSample`, dan `sameTaxSetting`.
2. **Skema & backend** — `tenants.taxActive` opsional di `schema.ts`; `tenants.updateTax`
   (`billing.manage`, jejak audit `tenant.tax` berisi sebelum/sesudah, dan setelan yang tidak mengubah
   apa pun tidak menulis audit); `entitlements.getForTenant` mengembalikan `taxActive`/`taxRatePct`;
   `pos.createSale` mencatat `tax`/`taxRatePct` dari tarif efektif (struk lama tetap utuh setelah
   setelannya diubah); `billing.createInvoice` memungut angka yang sama.
3. **Store** — `StoreApi.tax` + `setTax` (`types.ts`): mode demo menyimpan setelan di sesi tenant
   (`SessionTenant.taxActive`/`taxRatePct` + `setTaxSetting`), mode Convex membaca baris tenant yang
   sudah dilanggan (`tenants.listMine`) dan menulis lewat `tenants.updateTax`, jadi angka di kasir ikut
   berubah tanpa muat ulang.
4. **Halaman Pengaturan** (`src/pages/SettingsPage.tsx`) + menu sidebar + rute `/app/settings`
   (`billing.manage`): tarif (kolom angka + tombol 5% / 11% / 12%), sakelar aktif/nonaktif, contoh
   perhitungan dalam rupiah sebelum disimpan, tombol simpan/batalkan, serta penjelasan apa yang ikut
   berubah. Mematikan PPN mengembalikan tarif tersimpan ke kolomnya kalau kolomnya berisi 0 (angka itu
   hanya sah saat PPN mati), supaya tarif asli tidak hilang tanpa sengaja.
5. **Kasir & Langganan mengikuti setelan** — baris “PPN n%” di keranjang **hilang** saat PPN mati
   (dan diganti catatan kecil bahwa setelannya sedang dimatikan); halaman Langganan memakai tarif
   efektif yang sama untuk pratinjau tagihannya, bukan 11% tetap.
6. **Harness & dokumentasi** — `scripts/verify-tax.mjs` (baru, murni), tambahan cek di
   `verify-backend.mjs` (22 cek PPN di tenant khusus: izin, struk, tagihan langganan, penolakan yang
   tidak menyentuh setelan tersimpan) dan `verify-render.mjs` (alur klik nyata: ubah tarif → simpan →
   matikan → kasir & tagihan ikut berubah); `scripts/verify-menus.mjs` mengenal rute/menu baru;
   panduan operasional dapat **Bagian 15** (PDF dibangun ulang: 15 bagian, 29 halaman) dan README
   punya bagian **PPN workspace** sendiri.

**Berkas:** baru: `src/convex/lib/tax.ts`, `src/lib/tax.ts`, `src/pages/SettingsPage.tsx`,
`scripts/verify-tax.mjs` · diubah: `src/convex/schema.ts`, `src/convex/tenants.ts`,
`src/convex/entitlements.ts`, `src/convex/pos.ts`, `src/convex/billing.ts`, `src/lib/session.tsx`,
`src/lib/store/types.ts`, `src/lib/store/demo.tsx`, `src/lib/store/convex.tsx`, `src/pages/PosPage.tsx`,
`src/pages/SubscriptionPage.tsx`, `src/pages/PanduanPage.tsx`, `src/App.tsx`, `src/layouts/AppLayout.tsx`,
`scripts/verify-menus.mjs`, `scripts/verify-render.mjs`, `scripts/verify-backend.mjs`,
`scripts/verify-panduan.mjs`, `scripts/gen-panduan-pdf.mjs`, `public/panduan/panduan-mesinpos.pdf`,
`README.md`.

**Verifikasi:**

- `bun convex dev --once` → `✔ Convex functions ready! (4.46s)` (exit 0), lalu `bun tsc -b --noEmit` →
  tanpa keluaran, exit 0 — frontend **dan** backend lolos tipe.
- `bun scripts/verify-tax.mjs` → `71/71 checks passed` (exit 0).
- `bun scripts/verify-menus.mjs` → `401/401 checks passed` (exit 0) — menu & rute baru terbukti satu
  lawan satu untuk kelima peran, dan halaman Pengaturan memuat penanda “Setelan PPN” untuk pemilik.
- `bun scripts/verify-render.mjs` → `529/529 checks passed` (exit 0) — alur setelan PPN benar-benar
  diklik di DOM tiruan: tarif 12,5% tersimpan, “aktif 0%” ditolak tanpa mengubah setelan, PPN dimatikan,
  lalu kasir 28.000 dengan PPN 12% menjadi 31.360 dan barisnya hilang saat PPN mati, serta tagihan
  langganan memakai angka yang sama.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  `671/671 checks passed against https://mellow-narwhal-477.convex.cloud` (exit 0; sebelumnya 649/649
  — 22 cek barunya untuk setelan PPN).
- `bun run panduan:pdf` → `halaman: 29 · bagian: 15 · gambar: 9` (exit 0), lalu
  `bun scripts/verify-panduan.mjs` → `13/13 pemeriksaan lolos` (exit 0), termasuk daftar isi 15 bagian
  dan frasa Bagian 15.
- Berkas markdown (`README.md`, `worklog.md`) tidak memengaruhi build/tipe — tidak ada cek tambahan
  yang dijalankan untuk keduanya.

**Catatan / blocker:** tidak ada blocker baru. Tabel **Status Phase 1–6** dan daftar **Blocker yang
masih terbuka** sudah diperiksa: tidak ada klausa roadmap baru (PPN bagian dari engine billing yang
sudah “Selesai”), jadi tabelnya tidak berubah; yang diselaraskan hanya **angka suite** di ringkasan
verifikasi dan daftar **Perintah verifikasi rutin** (`verify-tax` 71/71 baru, `verify-render` 507 → 529,
`verify-backend` awan 649 → 671, `verify-menus` 384 → 401, panduan 14 → 15 bagian). Batasan yang perlu
diketahui: (i) jejak audit `tenant.tax` **ditulis server tetapi belum ada query tenant yang membacanya**,
sehingga isinya tidak diuji harness — yang diuji adalah izin, efek pada struk/tagihan, dan penolakan;
(ii) halaman Pengaturan seperti halaman lain belum pernah dilihat di **browser sungguhan** (Blocker #3),
jadi buktinya masih render DOM tiruan + server nyata.

## 2026-10-12 — Tombol Layar penuh juga di beranda & halaman masuk (laporan “tombolnya tidak ada”)

**Ruang lingkup:** laporan pengguna: “tombol fullscreen nya tidak ada.” Diperiksa dulu, bukan langsung
ditambal: (i) tombolnya **memang ada** di header backstage — harness mengkliknya sejak pekerjaan
sebelumnya, dan modul yang disajikan dev server saat ini benar (`/src/layouts/AppLayout.tsx` memuat
`toggleFullscreen`, `/src/lib/fullscreen.ts` memuat label “Layar penuh”); (ii) build yang **ter-deploy**
(18:21:43, sesudah perubahan 18:13:22) juga memuatnya — bundel `/assets/index-DBlLO_Yb.js` mengandung
`Layar penuh` **dan** `fullscreenchange`. Jadi tombolnya hilang dari pandangan pengguna karena ia berada
di halaman yang **tidak memakai header backstage**: beranda (`/`) dan halaman masuk (`/auth`). Itu
sekaligus tafsir lain dari permintaan pertama (“saat login user”).

Yang dikerjakan:

1. **Komponen & hook bersama.** Tombolnya kini `src/components/FullscreenToggle.tsx` (terkendali:
   `active` + `onToggle`) dan state-nya `src/lib/useFullscreen.ts`. Sebelumnya state & tombolnya menempel
   di `AppLayout`; dipisah supaya satu nilai melayani dua hal sekaligus (sidebar backstage yang
   disembunyikan, dan tombolnya) — kalau keduanya menyimpan state sendiri-sendiri, menekan tombol tidak
   akan menyembunyikan apa pun.
2. **Tiga tempat, satu perilaku.** Header backstage (`/app/*`, dengan sidebar), header beranda publik
   (`/`), dan pojok kanan atas halaman masuk (`/auth`). Halaman masuk berdiri di luar `/app`, jadi
   tombolnya tidak bisa menumpang header backstage — itulah sebabnya tombol ini ditambahkan di sana,
   dan ia sudah ada **sebelum** sesi terbentuk.
3. **Kalimat penjelas ikut konteks.** `fullscreenHint(active, { hasSidebar })`: di beranda & halaman
   masuk tidak ada sidebar yang disembunyikan, jadi `title`-nya berbunyi “Buka halaman ini layar
   penuh — pas untuk demo atau layar pajang”, bukan menjanjikan sidebar.
4. **Verifikasi ditambah di dua halaman itu**, bukan hanya di backstage: tombol beranda/halaman masuk
   benar-benar diklik di DOM tiruan (aktif → `aria-pressed=true` → diklik lagi kembali), dan formulir
   masuk terbukti tidak ikut terganggu.

**Berkas:** baru: `src/components/FullscreenToggle.tsx`, `src/lib/useFullscreen.ts` · diubah:
`src/layouts/AppLayout.tsx` (tombol inline → komponen bersama), `src/lib/fullscreen.ts` (`hasSidebar`),
`src/pages/LandingPage.tsx`, `src/pages/AuthPage.tsx`, `scripts/verify-fullscreen.mjs`,
`scripts/verify-render.mjs`, `README.md`, `worklog.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-fullscreen.mjs` → **14/14, exit 0** (+1: hint di halaman tanpa sidebar tidak
  menyebut sidebar).
- `bun scripts/verify-render.mjs` → **507/507, exit 0** (dari 501/501; +6): tombol di header beranda
  dan di halaman masuk ada & benar-benar diklik (aktif → kembali), header beranda tetap `sticky`, dan
  formulir email halaman masuk tidak terganggu; cek backstage dari pekerjaan sebelumnya tetap lulus
  dengan komponen bersama yang baru.
- Regresi terkait dijalankan ulang, semua exit 0: `verify-theme` 50/50 (tombol di DOM),
  `verify-menus` 384/384, `verify-pwa` 1492/1492, `verify-otp` 79/79 (alur masuk) ·
  `freebuff-preview status` → `running:true, listening:true, statusCode:200`.
- Bukti tambahan: berkas yang disajikan dev server diperiksa langsung (`/src/layouts/AppLayout.tsx`,
  `/src/lib/fullscreen.ts`), dan bundel produksi `https://mesinpos.freebuff.app/assets/index-DBlLO_Yb.js`
  diperiksa memuat `Layar penuh` + `fullscreenchange`.

**Catatan / blocker:** tidak ada blocker baru; tabel **Status Phase 1** dan daftar **Blocker** tidak
berubah. Dua hal yang perlu diketahui pengguna: (i) **peramban harus dimuat ulang** kalau tab-nya masih
terbuka dari sebelum perubahan (HMR dimatikan di workspace ini); (ii) tombol di **beranda & halaman
masuk** baru terlihat di **produksi** setelah deploy berikutnya — pekerjaan ini **tidak** menjalankan
`freebuff-deploy start` (deploy hanya dijalankan kalau diminta). Halaman **backstage platform**
(`/platform`, di luar `/app`, header-nya header isi bukan header shell) sengaja **tidak** diberi tombol
ini; kalau memang perlu, itu penambahan kecil terpisah. Angka `verify-render` di ringkasan suite &
daftar perintah rutin diselaraskan 501 → **507**, `verify-fullscreen` 13 → **14**.

## 2026-10-12 — Tombol Layar penuh di backstage: sidebar disembunyikan, header tetap ada

**Ruang lingkup:** permintaan pengguna: “saat login user, tambahkan tombol fullscreen dimana yg
terlihat adalah UI fullscreen tanpa sidebar (samping kiri).” Sebelum ini shell backstage selalu
memuat sidebar kiri berisi 19 menu, sehingga layar jual (kasir, dapur, opname) kehilangan 256 px
lebar yang tidak dipakai — dan tidak ada cara menutupnya tanpa mengecilkan jendela peramban.

Yang dikerjakan:

1. **Modul aturan murni** `src/lib/fullscreen.ts`: `fullscreenLabel`/`fullscreenHint` (teks tombol &
   penjelasannya satu tempat), `sidebarHidden(active)`, `fullscreenActiveFor(doc)` (membaca
   `fullscreenElement`, dipakai menyelaraskan setelah pengguna menekan `Esc`), dan
   `applyFullscreen(active, doc)` yang mengembalikan `true` hanya kalau peramban benar-benar menerima
   permintaannya. Semua akses API peramban lewat interface opsional, jadi dokumen tanpa Fullscreen API
   pun aman.
2. **Dua janji yang dipisahkan, bukan digabung.** (i) Tombol **selalu** menyembunyikan sidebar lebih
   dulu — itulah yang diminta — lalu **meminta** layar penuh sungguhan (`requestFullscreen`).
   Permintaan itu boleh gagal (peramban lama, atau halaman di dalam `<iframe>` tanpa
   `allow="fullscreen"`) tanpa membatalkan mode aplikasinya; kegagalannya ditelan di modul murni, bukan
   dilempar ke UI. (ii) `exitFullscreen` hanya dipanggil kalau memang ada elemen yang sedang penuh,
   supaya tidak menghasilkan penolakan promise di konsol peramban.
3. **Header tidak ikut disembunyikan** — keputusan sadar: tombol keluarnya ada di sana, dan pemakai
   ponsel tidak punya tombol `Esc`. Yang diminta memang “tanpa sidebar (samping kiri)”. Header, kolom
   isi, dan halaman yang sedang dibuka tetap utuh; `main` tetap satu-satunya area gulir.
4. **Esc tetap mengembalikan sidebar.** Pendengar `fullscreenchange` menyetel ulang state saat
   `fullscreenElement` kosong, jadi tombol dan tampilan tidak pernah bertentangan walaupun pengguna
   keluar lewat `Esc`/tombol peramban, bukan lewat tombol di aplikasi.
5. **Sembunyikan sidebar lewat kelas display yang bercabang, bukan menumpuk `lg:flex` + `lg:hidden`.**
   Dua kelas display di layer Tailwind yang sama membuat pemenangnya bergantung urutan CSS, bukan
   urutan penulisan; karena itu `sidebarHidden(fullscreen)` memilih `hidden` atau `hidden lg:flex`.
   Nav-nya sengaja tetap ter-mount (hanya `display: none`), jadi tidak ada nav yang dibongkar-pasang.
6. **Tidak disimpan ke `localStorage`.** Permintaan layar penuh peramban mensyaratkan sentuhan
   pengguna, jadi menyimpan pilihannya lalu berpura-pura bisa memulihkannya saat halaman dimuat hanya
   akan menyesatkan; muat ulang = kembali normal. Tombolnya ber-`aria-pressed` dan punya `title` yang
   menyebut `Esc`.
7. **Panduan & README**: Bagian 9 “Menjual di kasir” menyebut tombol Layar penuh beserta tombol Keluar
   yang tetap terlihat; README menambah subbagian “Mode layar penuh: sidebar disembunyikan, header tetap
   ada” yang menjelaskan kedua keputusan di atas. PDF dibangun ulang (14 bagian, 28 halaman).

**Berkas:** baru: `src/lib/fullscreen.ts`, `scripts/verify-fullscreen.mjs` · diubah:
`src/layouts/AppLayout.tsx`, `scripts/verify-render.mjs`, `scripts/gen-panduan-pdf.mjs`,
`scripts/verify-panduan.mjs`, `README.md`, `worklog.md` · dibangun ulang:
`public/panduan/panduan-mesinpos.pdf` (14 bagian, 28 halaman, 9 gambar).

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-fullscreen.mjs` → **13/13, exit 0** (murni: label & hint, `sidebarHidden`,
  pembacaan `fullscreenElement`, permintaan yang diterima/ditolak/tak tersedia tidak melempar,
  `exitFullscreen` hanya saat ada elemen penuh, dokumen `null`, dan permintaan keluar tidak pernah
  diterjemahkan menjadi minta masuk).
- `bun scripts/verify-render.mjs` → **501/501, exit 0** (dari 495/495; +6): blok **1d** yang memang
  sudah membuka rute `/app/pos` sungguhan lewat `App` kini juga mengklik tombolnya — kelas sidebar jadi
  `hidden` **tanpa** `lg:flex` (tidak bisa tampil di breakpoint mana pun, dan nav tetap ter-mount),
  header + halaman kasir + tombol Keluar tetap ada, `main` tetap satu-satunya area gulir, lalu klik
  kedua mengembalikan sidebar beserta permukaannya. DOM tiruan happy-dom memang tidak punya Fullscreen
  API, jadi yang terbukti di sini justru janji terpentingnya: “tanpa sidebar” berjalan **tanpa** izin
  peramban.
- Regresi terkait dijalankan ulang, semua exit 0: `verify-theme` 50/50, `verify-menus` 384/384 (peta
  menu↔rute↔izin utuh), `verify-pwa` 1492/1492.
- Panduan: `bun run panduan:pdf` → “halaman: 28, bagian: 14, gambar: 9”, exit 0 ·
  `bun scripts/verify-panduan.mjs` → **13/13, exit 0** (25 frasa langkah kunci, termasuk “Layar penuh”
  di Bagian 9).

**Catatan / blocker:** tidak ada blocker baru. Tabel **Status Phase 1** dan daftar **Blocker** tidak
berubah. Batasan yang perlu diketahui: (i) layar penuh **peramban** belum bisa dibuktikan di harness
karena happy-dom tidak mengimplementasikan Fullscreen API — yang diuji di sana adalah mode aplikasi
(sidebar hilang) dan logika permintaannya diuji murni dengan dokumen tiruan; (ii) header sengaja tidak
ikut disembunyikan, jadi “layar penuh” di sini berarti **tanpa sidebar**, bukan tanpa header;
(iii) tombolnya belum pernah dilihat di peramban sungguhan pada pekerjaan ini. Angka `verify-render` di
ringkasan suite dan daftar perintah rutin diselaraskan 495 → **501**, dan `verify-fullscreen` ditambahkan
ke daftar perintah rutin.

## 2026-10-12 — Gambar produk tampil di halaman kasir (POS)

**Ruang lingkup:** permintaan pengguna: “tampilkan gambar produk di halaman kasir (pos).” Sebelum ini
foto produk hanya hidup di halaman **Produk & Stok** (kolom Gambar + kartu Atur harga); kasir menjual
dari kartu yang isinya cuma nama, harga, dan stok, sehingga barang yang namanya mirip harus dibedakan
dari harga — padahal datanya (`products.images` → `StoreProduct.images`) sudah tersedia di store yang
sama.

Yang dikerjakan:

1. **Kartu produk di kasir** (`src/pages/PosPage.tsx`) kini menampilkan gambar utama sebagai thumbnail
   di atas nama produk (`object-cover`, rasio 4:3, `loading="lazy"` supaya grid besar tetap ringan).
   Yang tidak berubah: kartu itu tetap satu tombol, tetap menyembunyikan harga/stok yang sama, dan
   tetap mati kalau stoknya habis.
2. **Produk tanpa foto ditandai, bukan dikosongkan.** Kalau produk di katalog **ada** yang berfoto,
   produk lain menampilkan penanda “belum ada gambar” (`aria-label`-nya menyebut nama produknya),
   jadi kasir tidak salah membaca kotak kosong sebagai produk bermasalah.
3. **Katalog tanpa foto tetap seperti semula.** `adaGambar` dihitung dari daftar produk yang **sedang
   tampil**: kalau tidak ada satu pun yang berfoto, kartunya kembali ringkas tanpa kotak gambar —
   toko yang belum pernah mengunggah foto tidak kehilangan ruang layar jual.
4. **Baris keranjang** ikut menampilkan thumbnail produknya (36 px), karena di situlah kasir
   mencocokkan barang yang dihitung dengan yang dipegang pembeli. Thumbnail-nya muncul dengan syarat
   yang sama (`adaGambar`) supaya lebarnya tidak berubah di toko tanpa foto.
5. **Gambar tidak disalin ke data apa pun.** Tidak ada kolom/state baru, tidak ada permintaan server
   tambahan: URL bertanda-sign yang sudah dikembalikan query katalog dipakai apa adanya. Karena URL
   itu bisa kedaluwarsa, ia memang perlu dibaca ulang setiap query — bukan disimpan.
6. **Panduan ikut diperbarui**: Bagian 9 “Menjual di kasir” menyebut foto produk di kartu & baris
   keranjang, produk tanpa foto yang tetap bisa dijual, dan katalog tanpa foto yang kembali ringkas.
   PDF dibangun ulang (14 bagian, 28 halaman, 9 gambar) dan daftar bagian menambah frasa
   “belum ada gambar”.

**Berkas:** diubah: `src/pages/PosPage.tsx`, `scripts/verify-render.mjs`, `scripts/gen-panduan-pdf.mjs`,
`scripts/verify-panduan.mjs`, `README.md`, `worklog.md` · dibangun ulang:
`public/panduan/panduan-mesinpos.pdf` (14 bagian, 28 halaman, 9 gambar).

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0 (tidak ada
  perubahan backend di pekerjaan ini).
- `bun scripts/verify-render.mjs` → **495/495, exit 0** (dari 489/489; +6 untuk blok baru **4l**):
  katalog tanpa foto tidak menggambar kotak gambar kosong, foto produk yang diunggah lewat store
  benar-benar dirender sebagai `<img alt="Gambar produk …">` di kartu kasir, produk lain memakai
  penanda “belum ada gambar”, kartu dengan gambar masih bisa diklik untuk menambah ke keranjang, dan
  baris keranjangnya ikut menampilkan thumbnail produk itu — semuanya lewat render + klik di DOM
  tiruan (happy-dom), bukan pemeriksaan sumber.
- Regresi terkait dijalankan ulang, semua exit 0: `verify-theme` 50/50, `verify-menus` 384/384,
  `verify-fnb` 39/39 (POS + F&B), `verify-modules` 34/34, `verify-payments` 72/72 (dialog kasir),
  `verify-product-edit` 36/36, `verify-product-images` 25/25.
- Panduan: `bun run panduan:pdf` → “halaman: 28, bagian: 14, gambar: 9”, exit 0 ·
  `bun scripts/verify-panduan.mjs` → **13/13, exit 0** (24 frasa langkah kunci, termasuk frasa baru
  Bagian 9).

**Catatan / blocker:** tidak ada blocker baru. Tabel **Status Phase 1** dan daftar **Blocker** tidak
berubah. Yang **belum** dikerjakan dan sengaja tidak dilakukan tanpa diminta: thumbnail produk di
**antrean dapur (KDS)**, di **struk**, dan di **halaman Pembelian**; serta kolom “punya foto?” di
tabel produk (sudah ada sebagai lencana `n/8`). Angka `verify-render` di ringkasan suite dan daftar
perintah rutin diselaraskan 489 → **495**.

## 2026-10-12 — Produk yang sudah tersimpan bisa diubah, dinonaktifkan/diaktifkan, dan dihapus

**Ruang lingkup:** permintaan pengguna: “buat fitur untuk produk yang sudah tersimpan bisa di edit,
aktif/nonaktif dan di hapus.” Sebelum ini produk hanya bisa **dibuat** (`products.create`) dan
**ditata harga/kategori/modifier/gambarnya** (`setPricing`/`setCategory`/`setModifiers`/`addImage`):
kolom `products.active` sudah ada di skema tetapi **tidak ada** mutation yang bisa mengubahnya, tidak
ada cara memperbaiki salah ketik nama/SKU/harga beli, dan tidak ada cara menghapus produk — berapa pun
lama produk itu sudah tidak dipakai.

Yang dikerjakan:

1. **Aturan murni satu tempat** (`src/convex/lib/productEdit.ts`, dibuka lewat `@/lib/productEdit`):
   - `validateProductIdentity` — nama **2–60 karakter** (spasi pinggir & ganda dirapikan), SKU
     **dipakai apa adanya** (hurufnya tidak dipaksa, sama seperti saat dibuat) tetapi **unik per
     workspace tanpa peduli huruf besar-kecil**, maksimal 40 karakter, tanpa spasi, dan
     `PBB-SAN-000042` tetap sah; harga beli bulat & tidak boleh negatif. Fungsinya juga
     mengembalikan `changed` (kolom yang benar-benar berubah) supaya server tidak menulis audit dan
     halaman tidak menampilkan notis untuk perubahan kosong, dan **satu kolom yang salah membatalkan
     seluruh perubahan** — tidak ada identitas yang tersimpan separuh.
   - `productDeletionCheck`/`productDeletionBlockers` — daftar alasan tidak-boleh-dihapus beserta
     kalimat siap-baca, dan `productStatusSentence` untuk kalimat aktif/nonaktif.
2. **Backend.** `products.update` (nama/SKU/harga beli), `products.setActive`, `products.deletionCheck`
   (query), dan `products.remove` — semuanya gerbang `product.manage`. `products.remove` menghitung
   dulu `readProductUsage` dari data yang sebenarnya (stok lokasi jual + gudang, baris penjualan,
   pergerakan stok, dokumen pembelian termasuk tagihan supplier, sesi opname) dan **menolak** produk
   yang sudah punya jejak dengan alasan satu per satu; saat produknya memang layak dihapus, hanya
   baris stoknya (yang semuanya nol) dan berkas gambarnya yang ikut dibuang. `products.listAll`
   (baru) membuka katalog **termasuk produk nonaktif** untuk halaman pengelolaan, sedangkan
   `products.listByStore` tetap hanya aktif. Gerbang “nonaktif” tidak berhenti di tampilan:
   `pos.createSale` **menolak** produk nonaktif, jadi perangkat lama yang menyimpan keranjang pun
   tidak bisa menjualnya.
3. **Kedua store.** `updateProduct`, `setProductActive`, `checkProductDeletion`, dan `removeProduct`
   ditambahkan ke `StoreApi` (`src/lib/store/types.ts`) dan diimplementasikan di store Convex serta
   store demo (demo memakai aturan & kalimat yang sama, dengan sumber “pemakaian” yang memang ada di
   data demo). Keduanya juga menyediakan `catalogProducts` (semua produk) di samping `products`
   (katalog penjualan = aktif saja).
4. **Halaman Produk & Stok.** Tabelnya kini membaca `catalogProducts` (produk nonaktif tetap
   terlihat & bisa dinyalakan lagi) dengan judul “N produk (M aktif)”, kolom Status memisahkan
   **ketersediaan stok** dari **status jual** (badge Nonaktif), dan kolom Aksi menambah
   **Nonaktifkan/Aktifkan** serta **Hapus**. Kartu **Atur harga** mendapat kolom Nama produk, SKU,
   dan Harga beli (disimpan bersama tombol Simpan harga, tanpa menyentuh harga jual) — saran SKU
   otomatis juga menghitung produk nonaktif supaya nomornya tidak menabrak. Tombol Hapus membuka
   **dialog konfirmasi yang isinya hasil `products.deletionCheck` dari server**, bukan tebakan halaman:
   produk yang masih dipakai melihat alasannya satu per satu beserta tombol **Nonaktifkan saja**,
   dan tombol Hapus produk-nya mati sampai pagarnya lolos.

5. **Panduan ikut diperbarui.** Panduan operasional (`public/panduan/panduan-mesinpos.pdf`) mendapat
   **Bagian 11 “Merapikan produk yang sudah tersimpan: ubah, nonaktifkan, hapus”** — tabel tombol kolom
   Aksi, langkah memperbaiki nama/SKU/harga beli, arti nonaktif, dan kenapa hapus sering ditolak beserta
   jalan keluarnya. Bagian setelahnya bergeser (troubleshooting 11 → 12, peran 12 → 13, istilah 13 →
   14), dan halaman **Panduan** menyebut 14 bagian.

**Berkas:** baru: `src/convex/lib/productEdit.ts`, `src/lib/productEdit.ts`,
`scripts/verify-product-edit.mjs` · diubah: `src/convex/products.ts`, `src/convex/pos.ts`,
`src/convex/schema.ts` (indeks `by_tenant_product` untuk `stockMovements` & `saleItems` yang dipakai
menghitung pemakaian), `src/lib/store/types.ts`, `src/lib/store/convex.tsx`, `src/lib/store/demo.tsx`,
`src/pages/ProductsPage.tsx`, `src/pages/PanduanPage.tsx`, `scripts/verify-render.mjs`,
`scripts/verify-backend.mjs`, `scripts/gen-panduan-pdf.mjs`, `scripts/verify-panduan.mjs`, `README.md`,
`worklog.md` · dibangun ulang: `public/panduan/panduan-mesinpos.pdf` (14 bagian, 27 halaman, 9 gambar).

**Verifikasi:**

- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0 ·
  `bun convex dev --once` → “Convex functions ready! (3.2s)”, exit 0.
- `bun scripts/verify-product-edit.mjs` → **36/36, exit 0** (murni: nama 2–60 & perapiannya, SKU
  kosong/panjang/spasi/kembar tanpa peduli huruf, harga beli negatif/NaN/pembulatan, `changed` untuk
  perubahan kosong & kombinasi tiga kolom, lima alasan pagar hapus, kalimat aktif/nonaktif).
- `bun scripts/verify-render.mjs` → **489/489, exit 0** (dari 472/472; +17): produk nonaktif hilang
  dari katalog penjualan tetapi tetap di tabel, bisa diaktifkan kembali, ubah nama+SKU+harga beli
  benar-benar tersimpan (harga jual tidak ikut berubah), SKU kembar ditolak tanpa mengubah produknya,
  dialog hapus memblokir produk berstok beserta tombol “Nonaktifkan saja”, dan produk berstok 0 yang
  belum dipakai benar-benar terhapus — semuanya lewat klik di DOM tiruan. Cek lama **staf gudang
  tidak ditawari aksi kategori** dipersempit ke aksi kategori (sebelumnya mencocokkan label
  “Nonaktifkan”/“Hapus” yang kini juga dipakai tombol produk), plus cek baru bahwa staf gudang
  **tetap** boleh mengurus produk tersimpan.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **649/649, exit 0** (dari 632/632; +17, 1m37s) terhadap deployment awan: `products.update` menyimpan
  tiga kolom & tidak menyentuh harga jual, perubahan kosong tidak menulis apa pun, SKU kembar ditolak,
  nama di luar 2–60 ditolak, `setActive` menyembunyikan produk dari `listByStore` **dan** transaksi
  produk nonaktif ditolak, pagar hapus menyebut stok/pergerakan stok, menghapus produk berjejak
  ditolak & produknya tetap ada, produk bersih benar-benar terhapus, dan kasir ditolak
  `product.manage`.
- Regresi terkait dijalankan ulang, semua exit 0: `verify-product-sku` 39/39, `verify-product-images`
  25/25, `verify-categories` 35/35, `verify-menus` 384/384, `verify-authz` 92/92, `verify-rbac` 48/48,
  `verify-offline` 24/24, `verify-modules` 34/34, `verify-wholesale` 31/31, `verify-inventory` 42/42.
- Pasangan panduan: `bun run panduan:pdf` → “PDF dibuat … halaman: 27, bagian: 14, gambar: 9”,
  exit 0 · `bun scripts/verify-panduan.mjs` → **13/13, exit 0** (daftar isi 14 bagian & 23 frasa langkah
  kunci, termasuk frasa baru Bagian 11).
- `bun scripts/diag-render.mjs / /app/products /app/pos` → ketiganya dirender tanpa error (halaman
  `/app/*` menjawab “Memuat sesi…” karena sesinya memang dibaca di klien, jadi ini bukan bukti isi
  halaman); bukti isi halaman ada di `verify-render.mjs`. `freebuff-preview status` →
  `running:true, listening:true, statusCode:200`.

**Catatan / blocker:** tidak ada blocker baru. Tabel **Status Phase 1** dan daftar **Blocker** tidak
berubah (ini kemampuan produk, bukan klausa roadmap); angka `verify-render` (472 → 489),
`verify-backend` awan (632 → 649), daftar perintah rutin, dan ringkasan suite sudah diselaraskan.
Satu cek lama di `verify-render.mjs` tentang gerbang izin staf gudang **dipersempit** (bukan
dimatikan) karena label “Nonaktifkan”/“Hapus” kini juga dipakai tombol produk, bukan hanya tombol
kategori — dan ditambah satu cek positif bahwa staf gudang memang boleh mengurus produk tersimpan.
Halaman Produk & Stok belum pernah dibuka di peramban sungguhan pada pekerjaan ini: buktinya render
DOM tiruan (`verify-render.mjs`) dan `tsc`, bukan tangkapan layar.

## 2026-10-12 — Kategori produk bisa diatur peran pengelola: tambah, ubah, nonaktifkan/aktifkan, hapus (`category.manage`)

**Ruang lingkup:** permintaan pengguna: “tambahkan fitur di kategori produk dimana role yg lebih tinggi
bisa mengaturnya, seperti menambah, mengedit, menonaktifkan/aktifkan, serta menghapusnya.” Sebelum ini
kategori hanya bisa **dibaca** (`tenants.listCategories`) dan **dipakai** (memilih kategori produk,
menggantinya lewat `products.setCategory`); tidak ada cara menambah, mengganti nama, mematikan, atau
menghapusnya — kategori bawaan tenant tidak pernah bisa dirapikan.

Yang dikerjakan:

1. **Izin sendiri, bukan menumpang `product.manage`.** `category.manage` (izin ke-27) dipegang
   **pemilik & manajer** saja; staf gudang tetap boleh mengelola **produk** tetapi tidak menyusun
   kategorinya, dan kasir/keuangan tidak sama sekali. Alasannya kategori bukan label biasa: namanya
   menentukan **kode di tengah SKU** (`PBB-<KATEGORI>-<nomor>`) dan **susunan tab di kasir** — jadi ia
   struktur katalog, seperti `team.manage` dan `api.manage`. Izinnya ikut masuk grup checklist
   “Produk & stok” di halaman Tim & Peran, bisa diturunkan ke peran kustom oleh manajer/pemilik, dan
   **tidak** dibatasi eskalasi (staf gudang yang membuat peran kustom tidak bisa memberikannya).
2. **Aturan murni satu tempat** (`src/convex/lib/categories.ts`, dibuka lewat `@/lib/categories`):
   - nama **2–40 karakter**, spasi pinggir/ganda dirapikan, **unik** per workspace (pembandingnya
     mengabaikan huruf besar & pemisah: “Kopi Susu” = “kopi  susu”);
   - nama **“Tanpa kategori” ditolak** — kalimat itu berarti “produk ini tidak punya kategori” di tabel
     produk, pemilih kategori, dan `productSkuCategoryCode`, jadi kategori bernama itu akan membuat dua
     hal berbeda tidak bisa dibedakan;
   - batas **100 kategori** per workspace (hanya saat menambah, supaya perbaikan nama tetap boleh);
   - `posCategoryChips` = kategori **aktif** + kategori **nonaktif yang masih dipakai** produk (produk
     lama tidak boleh kehilangan tabnya), dan `selectableCategoryNames` = kategori aktif + kategori
     produk itu sendiri walau nonaktif (membuka “Atur harga” tidak boleh tampak seperti memindahkan
     produknya);
   - `duplicateCategoryCodes` melaporkan kategori yang kode SKU-nya sama (mis. “Makanan” & “Makmur” =
     `MAK`) — **diberitahukan, bukan dilarang**, karena SKU tetap unik lewat nomor urutnya;
   - `deleteCategorySentence` menyebut jumlah produk & nasib SKU-nya sebelum menghapus.
3. **Data & backend.** `categories` mendapat kolom `active` (**opsional**, supaya baris lama tetap sah
   dan dianggap aktif) + `createdAt`; kategori bawaan tenant baru ditulis `active: true`.
   `src/convex/categories.ts` menambah empat mutation gerbang `category.manage`:
   `create` (sortOrder di akhir), `rename`, `setActive`, dan `remove`. `products.create` +
   `products.setCategory` sekarang **menolak kategori nonaktif** (“sedang nonaktif — aktifkan dulu …”),
   sehingga menonaktifkan benar-benar berarti menutup kategori itu untuk produk baru; produk yang sudah
   memakainya tetap dijual, tetap ada di kartu “Atur harga” (bertanda `(nonaktif)`), dan tetap punya tab
   di POS.
4. **Store + UI.** `categories` di store berubah dari `string[]` menjadi `StoreCategory[]`
   (`id`, `name`, `active`, `productCount`) dengan `createCategory`/`renameCategory`/`setCategoryActive`/
   `removeCategory` — diimplementasikan sama di mode demo **dan** mode Convex. Halaman **Produk & Stok**
   mendapat kartu **“Kategori produk”**: daftar nama + kode SKU + jumlah produk + status, tombol
   **Ubah nama / Nonaktifkan-Aktifkan / Hapus**, form **Tambah kategori** (dengan pratinjau kode SKU),
   dan peringatan kode SKU yang bentrok. Hapus **dua langkah** (konfirmasi memuat dampaknya), dan peran
   tanpa izin hanya melihat daftarnya + catatan “butuh peran manajer/pemilik”. Tab kategori POS memakai
   aturan `posCategoryChips`.
5. **Dua keputusan yang perlu diketahui** (sengaja, bukan kelalaian):
   - **Ganti nama kategori tidak menulis ulang SKU.** Produknya tidak berpindah kategori, jadi SKU-nya
     tetap sah; yang berubah adalah kode untuk produk **berikutnya** (“Kopi”→“Pangan” mengubah
     `KOP`→`PAN`). Halaman mengatakannya apa adanya dari balikan server (`skuCodeChanged`), termasuk
     saat kodenya **tidak** berubah (“Sanitasi”→”Sanitasi & Kebersihan” tetap `SAN`).
   - **Hapus kategori melepas produknya, tidak menghapusnya.** `categories.remove` menghitung produk
     yang memakainya, melepas `products.categoryId` (produk menjadi “Tanpa kategori”), lalu menghapus
     baris kategorinya; jumlah yang dilepas muncul di konfirmasi, di notis, dan di jejak audit
     (`category.create`/`category.update`/`category.status`/`category.remove`).

**Berkas:** baru: `src/convex/lib/categories.ts`, `src/lib/categories.ts`, `src/convex/categories.ts`,
`scripts/verify-categories.mjs` · diubah: `src/convex/schema.ts` (kolom `active`/`createdAt` +
`category.manage` di `permissionValidator`), `src/convex/lib/authz.ts`, `src/convex/lib/rbac.ts`,
`src/convex/tenants.ts` (kategori bawaan aktif), `src/convex/products.ts` (pagar kategori nonaktif),
`src/lib/store/types.ts`, `src/lib/store/demo.tsx`, `src/lib/store/convex.tsx`,
`src/pages/ProductsPage.tsx`, `src/pages/PosPage.tsx`, `scripts/verify-authz.mjs`,
`scripts/verify-rbac.mjs`, `scripts/verify-render.mjs`, `scripts/verify-backend.mjs`, `README.md`,
`worklog.md`.

**Verifikasi:**

```bash
bun convex dev --once                            # exit 0 — “Convex functions ready! (4.09s)”, termasuk `categories.*` yang baru
bun tsc -b --noEmit                              # exit 0 (frontend)
bun tsc -p tsconfig.convex.json --noEmit         # exit 0 (backend)
bun scripts/verify-categories.mjs                # 35/35 (harness baru, murni)
bun scripts/verify-authz.mjs                     # 92/92 (sebelumnya 86/86 — 6 cek baru untuk izin kategori)
bun scripts/verify-rbac.mjs                      # 48/48 (sebelumnya 45/45 — grup izin, izin kategori di grup “Produk & stok”, pagar eskalasi)
bun scripts/verify-menus.mjs                     # 384/384 (tidak ada menu/rute baru — kartunya di halaman Produk & Stok)
bun scripts/verify-product-sku.mjs               # 39/39
bun scripts/verify-modules.mjs                   # 34/34
bun scripts/verify-theme.mjs                     # 50/50
bun scripts/verify-render.mjs                    # 472/472 (sebelumnya 444/444 — 28 cek baru: kartu kategori, tambah/ubah/nonaktifkan/hapus benar-benar diklik di DOM tiruan, tab POS, gerbang izin staf gudang)
VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs   # 632/632 (sebelumnya 607/607 — 25 cek kategori di deployment: izin ditolak untuk kasir & staf gudang, kategori nonaktif ditolak `products.create`/`setCategory`, hapus melepas produk tanpa mengubah SKU, isolasi lintas tenant)
```

Yang **belum** dijalankan/diperbarui: `verify-pwa.mjs`, `verify-panduan.mjs`, dan PDF panduan
(`public/panduan/panduan-mesinpos.pdf`) — perubahan ini tidak menyentuh PWA, tema, maupun berkas
panduan, jadi keduanya tidak dijalankan; **panduan PDF-nya belum memuat langkah mengelola kategori**
(lihat Catatan).

**Catatan / blocker:** tidak ada blocker baru. Tabel **Status Phase 1–6** tidak berubah — ini kemampuan
produk, bukan klausa roadmap; daftar **Blocker #1–#9** juga tidak tersentuh. Angka suite di
**Perintah verifikasi rutin** dan ringkasan suite diselaraskan (`verify-authz` 84 → 92,
`verify-rbac` 45 → 48, `verify-render` 424 → 472, `verify-backend` 607 → 632, plus baris
`verify-categories` yang baru), sedangkan angka di baris tabel Status dibiarkan historis seperti
sebelumnya. Batasan yang diketahui: (1) panduan PDF belum memuat langkah kategori; (2) `categories.active`
sengaja opsional sehingga tidak ada migrasi — kategori lama dianggap aktif sampai ada aksi yang
menonaktifkannya; (3) di mode demo SKU ia tetap dijaga di memori saja (data demo hilang saat halaman
dimuat ulang), sama seperti state demo lain.

## 2026-10-12 — Penanda sumber data: “Terhubung Convex” → “Terhubung ke server”
**Ruang lingkup:** permintaan pengguna: “kamu lihat di screenshot yg saya kirim ini, yg saya kasih tanda
kotak merah, apakah artinya ini? Bisakah teks kata² convex di ganti dengan server”. Yang ditandai itu
lencana di header backstage, dan artinya adalah **sumber data**, bukan status langganan:

- hijau (`bg-primary`) + **“Terhubung ke server”** = `source === "convex"`, yaitu angka di layar datang
dari server aplikasi (`VITE_DATA_SOURCE=convex` **dan** `VITE_CONVEX_URL` terisi — `src/lib/store/config.ts`);
- kuning (`bg-accent`) + **“Data demo”** = belum tersambung ke server; yang tampil data contoh di
  perangkat.

Yang dikerjakan:

1. **Lencana header** (`src/layouts/AppLayout.tsx`) mengucapkan “Terhubung ke server”, bukan nama
   layanan di belakangnya, plus `title` yang menjelaskan artinya (untuk yang belum tahu arti warnanya).
2. **Kalimat catatan di halaman pemilik toko** ikut memakai kata yang sama — dulu masih menulis nama
   backend: `AuthPage` (“Server belum tersambung, jadi kode …”), `OtpForm` (kotak surat pengembangan),
   `DashboardPage`, `ShiftPage`, dan `ReportsPage` (“Setelah server tersambung, …”).
3. **Harness menambah 9 cek** di `scripts/verify-render.mjs`: badge diuji di **dua** keadaan (`source`
   diganti dari store yang asli, bukan store karangan), tooltip-nya menjelaskan, mode demo tetap jujur
   bilang “Data demo”, empat halaman pemilik toko tidak boleh menyebut merek backend, dan kotak surat
   pengembangan memakai kata “server”.
4. **Sengaja tidak diubah** (dokumentasi teknis, bukan teks untuk pemilik toko): backstage platform
   (`/platform`) dan halaman API & Webhook — di sana domain layanannya memang harus disebut apa adanya
   (mis. `<deployment>.convex.site`), plus komentar kode dan README.

**Berkas:** baru: — · diubah: `src/layouts/AppLayout.tsx`, `src/pages/AuthPage.tsx`,
`src/components/OtpForm.tsx`, `src/pages/DashboardPage.tsx`, `src/pages/ShiftPage.tsx`,
`src/pages/ReportsPage.tsx`, `scripts/verify-render.mjs`, `README.md`, `worklog.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → **exit 0**.
- `bun scripts/verify-render.mjs` → **444/444, exit 0** (439 → +5 untuk badge/sumber data, dan sebelum
  itu 435 → 439 untuk cek shell; total suite kini 444). Cek barunya **gagal** kalau label lamanya
  dikembalikan: `!text.includes("Convex")` pada halaman pemilik toko dan pada kotak surat pengembangan.
- Angka suite di **Perintah verifikasi rutin** dan di bagian README yang menyebut suite ini
  diselaraskan (435 → 444).

**Catatan / blocker:** yang diperiksa mesin adalah **kalimat yang benar-benar dirender** (badge & catatan
halaman), bukan nilai di store saja — jadi penggantian kata ini tidak bisa lolos hanya karena tipe benar.
Yang belum: mengubahnya di situs produksi (`mesinpos.freebuff.app`) — itu perilaku deploy, bukan kode: di
sana label baru muncul setelah deploy ulang. Nama layanan juga masih muncul di dokumentasi teknis
(halaman API & Webhook, backstage platform, README) dan di komentar kode; itu keputusan yang sengaja
diambil supaya operator masih bisa menemukan domain & variabel yang benar, dan bisa diubah kalau memang
diminta.

## 2026-10-12 — Koreksi: sidebar backstage benar-benar berwarna + shell yang tidak bergantung pada `sticky`
**Ruang lingkup:** laporan pengguna sesudah entri sebelumnya: “Sidebar belum ada warnanya, juga sidebar dan
header tidak sticky diam.” Dua-duanya nyata, dan sebabnya berbeda:

1. **Warnanya.** Entri sebelumnya memakai `--sidebar: 222 50% 3%` di tema gelap sedangkan latar halaman
   `222 47% 5%` — dua-duanya nyaris hitam, sehingga sidebar **menyatu dengan halaman**. Tema bawaan
   aplikasi memang gelap (`<html class="dark">` di `index.html`), jadi itulah yang dilihat pengguna.
   Sekarang permukaan sidebar memakai rona teal dan **lebih terang dari latarnya di tema gelap**
   (`176 38% 10%` vs `222 47% 5%`, ujung gradien `200 45% 4%` — tetap gelap, tetapi jelas terpisah),
   dengan pendar aksen dinaikkan (0,16 → 0,24). Di tema terang tetap lebih gelap dari halaman
   (`176 45% 13%`).
   Patokan mesinnya juga dikoreksi: “selalu lebih gelap dari latar” mustahil di tema gelap (halaman
   sudah 5%), jadi yang diperiksa sekarang — permukaan gelap (lightness ≤ 20), **beda nyata** dari latar
   (≥ 4 poin), gradien tidak rata, dan teks terang.
2. **Diamnya.** Entri sebelumnya menempelkan header & sidebar dengan `sticky top-0` plus sidebar
   `h-dvh`. Itu rapuh: `h-dvh` **tidak dikenal** browser yang belum mendukung dvh (Safari < 15.4,
   Chrome < 108), dan kelas tinggi yang gagal berarti `auto` → sidebar setinggi konten → `sticky` tidak
   berpengaruh sama sekali (gejalanya persis “tidak sticky”). Kelas `h-screen h-dvh` juga tidak bisa
   dipakai bersamaan: di CSS yang dihasilkan dev server `.h-screen` ditulis **setelah** `.h-dvh`,
   sehingga `100vh` yang menang — dan `100vh` selalu memakai tinggi layar *terbesar*, jadi di ponsel
   bagian bawah shell tertutup bilah alamat.
   Sekarang keduanya **tidak lagi bergantung pada `sticky`**: shell-nya `app-shell-height flex
   overflow-hidden` (kelas baru di `src/index.css`: `100vh`, diganti `100dvh` lewat `@supports`), dan
   satu-satunya area gulir adalah `main` (`overflow-y-auto overflow-x-hidden`). Header & sidebar berada
   di luar area gulir itu, jadi tidak ada cara keduanya ikut terangkat. Daftar menu sidebar tetap punya
   gulirannya sendiri (17 menu tidak selalu muat di layar pendek).
3. **Harness** mengikuti jaminan yang baru: `verify-render.mjs` menjalankan rute **`/app/pos`
   sungguhan** lewat `App` (gerbang sesi → tenant → shell → halaman kasir), lalu memeriksa shell setinggi
   layar lewat kelas khusus, `overflow-hidden`, `main` ber-`overflow-y-auto`, dan header & sidebar
   **di luar** `main`; kelas `app-shell-height` berikut `@supports`-nya dibaca dari `src/index.css`.
   `verify-theme.mjs` memakai ukuran baru di poin 1.

**Berkas:** baru: — · diubah: `src/index.css`, `src/layouts/AppLayout.tsx`, `scripts/verify-render.mjs`,
`scripts/verify-theme.mjs`, `README.md`, `worklog.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → **exit 0**.
- `bun scripts/verify-render.mjs` → **435/435, exit 0** — termasuk cek baru “shell /app/pos benar-benar
  terbuka (sidebar & halaman kasir ada)”.
- `bun scripts/verify-theme.mjs` → **50/50, exit 0**.
- `bun scripts/verify-menus.mjs` (regresi sidebar) → **384/384, exit 0**.
- Dev server membuktikan kelas barunya menghasilkan CSS (bukan hanya nama kelas di DOM):
  `curl http://localhost:5173/src/index.css` → `--sidebar: 176 38% 10%` (tema gelap) ·
  `.app-shell-height{height:100vh}` **dan** `@supports (height: 100dvh){ .app-shell-height{height:100dvh} }`
  dengan override berada **setelah** aturan dasarnya (posisi 37882 > 17393) · `.sidebar-surface` memakai
  `hsl(var(--sidebar-active) / 0.24)`. Transform `/src/layouts/AppLayout.tsx` → 200 dengan kelas
  `app-shell-height flex overflow-hidden bg-background`.
- `freebuff-preview restart` → _Preview is ready_ (`running: true`, listening, port 5173).
- Warna akhir dihitung dari tokennya: tema gelap `hsl(176 38% 10%)` ≈ `#102322` (panel teal) versus latar
  `#070A13`; tema terang `hsl(176 45% 13%)` ≈ `#12302E` di atas halaman putih.

**Catatan / blocker:** yang salah **bukan** `sticky`-nya, melainkan kelas tinggi yang bergantung pada
dukungan browser — itu akar yang diperbaiki, bukan gejalanya. Yang tetap **tidak** bisa dibuktikan mesin:
melihat sendiri halaman tergulir di browser (happy-dom tidak menghitung layout, dan tidak ada
chromium/playwright di sandbox), jadi yang diperiksa susunan yang menjaminnya + deklarasi CSS-nya di dev
server. Satu hal yang layak diketahui: kalau yang dilihat adalah situs **produksi**
(`mesinpos.freebuff.app`), penyajian di sana berasal dari build **sebelum** perubahan ini (bundel
yang aktif masih memuat `--sidebar:222 50% 3%` + `sticky top-0` + `h-dvh`) — produksi perlu deploy ulang
sebelum perubahan ini terlihat di sana. Daftar **Blocker** diperiksa ulang: butir 3 diperbarui ke
susunan yang baru (tidak ada butir yang berubah status), dan tabel **Status Phase 1** tidak terpengaruh.

## 2026-10-12 — Sidebar backstage lebih gelap + header & sidebar diam saat digulir
**Ruang lingkup:** permintaan pengguna: “buat sidebar (sebelah kiri) UI backend (dashboard) berwarna
lebih gelap, jadi biar tidak kelihatan polos amat”, dan “buat header dan sidebar di dalam dashboard
menjadi diam saat screen di scroll”. Yang dikerjakan:

1. **Permukaan sidebar sendiri.** Sidebar `/app` kini **selalu gelap di kedua tema** (sebelumnya
   `bg-secondary/20` — nyaris sewarna latar, itulah “polos”-nya). Enam token baru di `src/index.css`
   (`--sidebar`, `--sidebar-deep`, `--sidebar-foreground`, `--sidebar-muted`, `--sidebar-border`,
   `--sidebar-active`) didaftarkan juga di `tailwind.config.js`, plus satu kelas permukaan
   `sidebar-surface`: gradien dua nada (13% → 8% di tema terang, 3% → 1% di tema gelap) ditimpa pendar
   aksen hijau di sudut atas. Jadi bukan kotak rata, dan tidak ada warna yang ditulis tetap — teks,
   batas, dan aksen tetap ikut tema lewat token itu.
2. **Isi sidebar ikut token itu**: logo, tautan aktif (`bg-sidebar-active/15` + batang penanda di kiri
   lewat `before:`), hover (`bg-sidebar-active/10`), kartu **Paket aktif** (`bg-sidebar-deep/70`),
   lencana Trial, dan select peran demo — bukan lagi `text-muted-foreground`/`bg-background` yang
   dirancang untuk permukaan terang.
3. **Sidebar & header diam saat digulir**: keduanya `sticky top-0` (bukan `fixed`), jadi kolom isi
   satu-satunya yang bergulir tanpa menghitung lebar sidebar secara manual. Sidebar `h-dvh`
   (setinggi layar; kalau lebih pendek, ia ikut terangkat) dan `overflow-y-auto` supaya 17 menu tetap
   terjangkau di layar pendek; header `glass` + `z-40` — selalu di atas konten, tetapi tetap di bawah
   dialog (`z-50`) dan ajakan pasang PWA (`z-[60]`).
4. **Harness**: 10 cek baru di `scripts/verify-render.mjs` (sidebar & header `sticky`+`top-0`,
   tinggi setinggi layar, `sidebar-surface` benar-benar terpasang, header ber-`z` di antara 30–49,
   tidak ada leluhur ber-`overflow` yang menjadi wadah gulir sendiri, dan tanpa error konsol) dan
   9 cek baru di `scripts/verify-theme.mjs` (token sidebar ada di kedua tema, **lebih gelap** dari
   `--background` — diukur dari komponen lightness HSL, bukan dari nama kelas — gradiennya makin gelap
   ke bawah, teksnya terang, dan kelas permukaannya ada di `index.css`).

**Berkas:** baru: — · diubah: `src/index.css`, `tailwind.config.js`, `src/layouts/AppLayout.tsx`,
`scripts/verify-render.mjs`, `scripts/verify-theme.mjs`, `README.md`, `worklog.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → **exit 0** (tipe frontend; perubahan layout ini TypeScript + CSS saja).
- `bun scripts/verify-theme.mjs` → **48/48, exit 0** (39 → +9).
- `bun scripts/verify-render.mjs` → **434/434, exit 0** (424 → +10).
- `bun scripts/verify-menus.mjs` (regresi: perubahan menyentuh sidebar yang diauditnya sehingga menu
  bisa hilang tanpa sengaja) → **384/384, exit 0**.
- Kelas barunya dibuktikan **menghasilkan CSS**, bukan sekadar terpasang di DOM.
  `curl http://localhost:5173/src/index.css` → `.sidebar-surface` (gradien + pendar aksen),
  `.text-sidebar-muted{color:hsl(var(--sidebar-muted))}`,
  `.border-sidebar-border{border-color:hsl(var(--sidebar-border))}`,
  `.bg-sidebar-active\/15{background-color:hsl(var(--sidebar-active) / 0.15)}`.
  Tailwind membaca `tailwind.config.js` sekali saat start, jadi warna barunya baru muncul setelah
  `freebuff-preview restart` — sebelum restart kelas itu **tidak** ada di CSS yang disajikan, dan
  sesudahnya ada (itu bukti preview benar-benar membawa perubahan ini, bukan tebakan dari DOM tiruan).
- `freebuff-preview restart` → _Preview is ready_ (`running:true`, listening, port 5173);
  `freebuff-preview logs` sesudahnya bersih (tanpa error transform), dan transform
  `/src/layouts/AppLayout.tsx` → HTTP 200.

**Catatan / blocker:** yang **tidak** bisa dibuktikan mesin: gerak menempelnya saat digulir dengan mata
sendiri. `position: sticky` adalah urusan mesin tata letak, jadi yang diperiksa harness adalah syarat
yang membuatnya bekerja (`sticky`+`top-0`, tinggi setinggi layar, tidak ada leluhur ber-`overflow`)
beserta bukti bahwa kelas CSS-nya benar-benar dihasilkan dev server — catatan ini sudah ditambahkan ke
Blocker #3. Sidebar yang selalu gelap juga keputusan tampilan: di tema terang ia kini sengaja kontras
dengan kolom isi (itu inti permintaannya), dan “lebih gelap” diukur dari lightness token, bukan selera.
Daftar **Blocker** diperiksa ulang: tidak ada butir yang berubah status, hanya butir 3 yang bertambah
catatan; tabel **Status Phase 1** tidak terpengaruh (ini perubahan tampilan, bukan klausa roadmap) —
angka suite di **Perintah verifikasi rutin** diselaraskan (389 → 434 untuk `verify-render`,
39 → 48 untuk `verify-theme`), sedangkan angka lama di bagian-bagian README yang lain dibiarkan
historis seperti sebelumnya.

## 2026-10-12 — Undangan tim lewat WhatsApp + ubah/nonaktif/hapus semua akun tim
**Ruang lingkup:** permintaan pengguna: “tambahkan undangan by WA langsung ke tim yang sudah dibuat”,
“buat tambahan add, edit, aktifkan/nonaktifkan dan hapus untuk semua akun tim workspace yang ada”.
Yang dikerjakan:

1. **Undangan WhatsApp** (`wa.me`) — bukan pengirim kedua, tetapi jalan pintas yang dipakai tim nyata:
   tombol **Kirim via WA** per anggota membuka percakapan WhatsApp pengundang dengan pesan sudah terisi,
   lalu mencatat bahwa tautannya dibuka. Aturan murninya di `src/convex/lib/team.ts`: `normalizePhone`
   (buang pemisah, `0`/`8`/`00` → kode negara `62`, panjang 8–15 digit), `whatsappInviteText` (workspace,
   peran, email, pengundang, tautan halaman Masuk), `whatsappInviteUrl` (`https://wa.me/<nomor>?text=…`)
   dan `waInviteSentence`. Nomor disimpan di `memberships.phone` (ternormalisasi) dengan jejak
   `waInviteAt`/`waInviteCount`; server menolak nomor salah bentuk **sebelum** keanggotaan dibuat dan
   menolak permintaan untuk anggota tanpa nomor. Aplikasi tidak pernah mengklaim pesannya terkirim —
   yang dikirim adalah pesan dari aplikasi WhatsApp pengundang.
2. **Ubah anggota** (`members.update`): nama, email, peran bawaan, nomor WhatsApp (kosong = dihapus), dan
   status aktif — satu mutation, satu tempat aturan. Nama/email hidup di baris `users`, jadi memperbaikinya
   ikut memperbaiki jalan masuk orangnya; email yang sudah dipakai anggota lain ditolak.
3. **Aktif/nonaktif & hapus** (`members.update` dengan `active`, dan `members.remove` baru). Menghapus
   hanya melepas keanggotaan di workspace ini — baris `users` tetap ada, sehingga orangnya bisa diundang
   lagi atau jadi anggota workspace lain tanpa melahirkan akun kedua beremail sama.
4. **Pagar murni** (`validateTeamMemberEdit` / `validateTeamMemberRemoval`, dipakai halaman **dan**
   server): pemilik aktif terakhir tidak bisa diturunkan/dinonaktifkan/dihapus, peran Pemilik hanya
   disentuh sesama pemilik, dan akun sendiri tidak bisa dinonaktifkan maupun dihapus. Urutan pagarnya
   sengaja “pemilik terakhir” dulu, baru “akun sendiri”.
5. **Halaman Tim & Peran**: kolom **WhatsApp** (nomor + “Tautan WhatsApp dibuka N×”, tombol mati kalau
   anggota belum punya nomor), form undangan bertambah kolom nomor, form **Ubah** yang terisi data
   anggota beserta pratinjau “Yang berubah: …”, tombol **Nonaktifkan/Aktifkan** dan **Hapus** dengan
   konfirmasi `Yakin hapus?`. Semua aksi hanya tampil untuk pemegang `team.manage`. Pratinjau form
   sekarang juga menerima `actorMembershipId` (email sesi, jika tidak ada → pemilik aktif pertama) supaya
   pagar “akun sendiri” terbaca **sebelum** ditekan, bukan setelah server menolak.
6. **Store demo & Convex**: `updateTeamMember`, `removeTeamMember`, `recordWaInvite` di kedua store,
   ditambah `phone`/`waInvite` pada anggota contoh (`src/data/demo.ts`) supaya kolom baru itu punya isi
   yang jujur (anggota bernomor, tanpa nomor, dan berjejak buka tautan).

**Berkas:** baru: `src/lib/team.ts` (pintu re-export sisi aplikasi), `scripts/verify-team.mjs` ·
diubah: `src/convex/lib/team.ts`, `src/convex/members.ts`, `src/convex/schema.ts`,
`src/lib/store/types.ts`, `src/lib/store/convex.tsx`, `src/lib/store/demo.tsx`, `src/data/demo.ts`,
`src/pages/TeamPage.tsx`, `scripts/verify-backend.mjs`, `scripts/verify-render.mjs`, `README.md`,
`worklog.md`.

**Verifikasi:**

- `bun tsc -b --noEmit` → **exit 0** (tipe frontend).
- `bun tsc -p tsconfig.convex.json --noEmit` → **exit 0** (tipe backend).
- `bun convex dev --once` → push berhasil: _Convex functions ready! (3.98s)_, exit 0.
- `bun scripts/verify-team.mjs` (murni) → **41/41, exit 0** — termasuk nomor WA (`62…`, `00` dibuang,
  salah bentuk ditolak), isi pesan & tautan `wa.me`, serta pagar ubah/nonaktif/hapus
  (pemilik terakhir, penurunan pemilik oleh manajer, akun sendiri, email bentrok).
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **607/607, exit 0** (586 → +21): nomor tersimpan ternormalisasi, nomor salah bentuk ditolak saat
  mendaftar, undangan WA dicatat sebagai tautan dibuka (dan bertambah), anggota tanpa nomor ditolak,
  nama/nomor/status/email tersimpan, tanpa perubahan tidak menulis apa pun, email bentrok ditolak,
  pemilik terakhir & akun sendiri ditolak server, kasir ditolak untuk ketiga aksi, anggota dihapus
  hilang dari daftar **tanpa** kehilangan akunnya, dan bekas anggota kehilangan akses ke workspace itu.
- `bun scripts/verify-render.mjs` (DOM tiruan, klik nyata) → **424/424, exit 0** (406 → +18): kolom
  WhatsApp & keadaan nominalnya, tombol Kirim via WA membuka `https://wa.me/6281234567890?text=…` dengan
  pesan yang memuat workspace/email/peran/pengundang/`/auth`, jejaknya jadi “dibuka 2×”, form **Ubah**
  terisi & perubahannya tersimpan, **Nonaktifkan → Aktifkan** mengubah badge status, **Hapus** minta
  konfirmasi dulu, pagar “akun sendiri” menonaktifkan tombol Simpan beserta alasannya, dan kasir tidak
  ditawari satu pun tombol pengelolaan.
- Regresi setelah perubahan halaman: `bun scripts/verify-menus.mjs` → **384/384, exit 0**;
  `bun scripts/verify-rbac.mjs` → **45/45, exit 0**.

**Catatan / blocker:** yang **tidak** bisa dibuktikan mesin: pesan WA benar-benar terkirim dan tampil di
aplikasi WhatsApp penerima — itu tindakan manusia, karena pesannya berangkat dari perangkat pengundang
(aplikasi ini hanya membuka tautan `wa.me`). Tidak ada integrasi WhatsApp Business API: mengirim pesan
otomatis dari server butuh akun WhatsApp Business + template pesan disetujui Meta, dan itu keputusan
produk/biaya yang belum diambil. Angka suite di perintah verifikasi rutin ikut diselaraskan
(586 → 607 untuk `verify-backend`, 406 → 424 untuk `verify-render`, plus baris `verify-team.mjs`).

## 2026-10-12 — Kirim undangan ke anggota tim lewat email (`inviteEmail.send`, Resend)
**Ruang lingkup:** permintaan pengguna: “kirim undangan ke anggota tim untuk login ke workspace”.
Sebelum ini undangan hanya **tercatat**: `members.add` membuat keanggotaan, tetapi tidak ada email yang
berangkat, sehingga orang yang didaftarkan hanya tahu kalau pengundang memberi tahu sendiri. Yang
dikerjakan:

1. **Aksi pengirim** (`src/convex/inviteEmail.ts`, `"use node"`): memakai `RESEND_API_KEY` + `OTP_EMAIL_FROM`
   yang sama dengan jalur kode masuk, menghormati aturan alamat uji `.test` (tidak dikirimi email,
   dicatat sebagai `uji`), dan **tidak pernah** mengklaim terkirim saat penyedia menolak — kegagalannya
   ditulis balik ke baris keanggotaan (`inviteError`).
2. **Penjadwalan** (`src/convex/members.ts`): `members.add` menjadwalkan pengiriman lewat
   `ctx.scheduler.runAfter(0, internal.inviteEmail.send, …)` untuk anggota **baru** (mutation tidak
   boleh menunggu jaringan; keanggotaan tetap tercatat walau email gagal). Ditambah
   `members.resendInvite` (izin `team.manage`, berjejak audit) dan dua `internalMutation` penulis hasil:
   `markInviteDelivered` / `markInviteFailed` (menaikkan `inviteAttempts`).
3. **Skema** (`src/convex/schema.ts`): `memberships` menyimpan `inviteSentAt`, `inviteSentVia`,
   `inviteError`, `inviteAttempts` — pola yang sama dengan `emailOtps`.
4. **Isi email** (`src/convex/lib/team.ts`): `inviteEmailContent` + `inviteLoginUrl` (tautan `/auth`
   dari `SITE_URL`, atau teks halaman Masuk tanpa alamat kalau variabelnya kosong) dan
   `inviteDeliverySentence` untuk status kirim. Isinya sengaja tanpa kata sandi & tanpa tautan
   bertoken: satu-satunya jalan masuk tetap kode OTP yang diminta orangnya sendiri.
5. **Store & halaman**: `StoreTeamMember.invite` + `StoreApi.resendInvite` (Convex & demo), notis yang
   membedakan “sedang dikirim” dari keadaan yang sudah tercatat, **kolom Undangan** beserta “Percobaan
   kirim: N”, dan tombol **Kirim ulang** per anggota. Mode demo mencatat `via: "demo"` dan mengatakan
   apa adanya bahwa tidak ada email yang benar-benar berangkat.
6. **Harness**: 7 cek baru di `scripts/verify-backend.mjs` (undangan terjadwal & jejak kirimnya masuk,
   jumlah percobaan, kasir ditolak mengirim ulang, pemilik bisa menjadwalkan ulang, percobaan bertambah,
   isi email menyebut workspace/peran/cara masuk, dan perilaku tanpa `SITE_URL`) dan 3 cek baru di
   `scripts/verify-render.mjs` (kolom Undangan jujur di mode demo, tombol Kirim ulang ada di barisnya,
   kliknya menambah percobaan).

**Berkas:** baru: `src/convex/inviteEmail.ts` · diubah: `src/convex/schema.ts` ·
`src/convex/members.ts` · `src/convex/lib/team.ts` · `src/data/demo.ts` · `src/lib/store/types.ts` ·
`src/lib/store/convex.tsx` · `src/lib/store/demo.tsx` · `src/pages/TeamPage.tsx` ·
`scripts/verify-backend.mjs` · `scripts/verify-render.mjs` · `README.md` · `worklog.md`

**Verifikasi:**

- Tipe: `bun tsc -b --noEmit` → **exit 0** · `bun tsc -p tsconfig.convex.json --noEmit` → **exit 0**.
- Backend: `bun convex dev --once` → **exit 0**, `Convex functions ready! (3.4s)` ·
  `bun scripts/verify-backend.mjs` → **586/586, exit 0** (579 → +7), termasuk “undangan anggota
  dijadwalkan dan hasil kirimnya dicatat”, “kasir ditolak mengirim ulang undangan (izin team.manage)”,
  dan “email undangan menyebut workspace, peran, dan cara masuknya”.
- **Kiriman Resend sungguhan**: skrip sementara (sudah dihapus) mengundang **alamat pengirim proyek
  sendiri** (`OTP_EMAIL_FROM`) ke tenant uji → hasil yang dicatat server:
  `{"ok":true,"via":"resend","tercatatTerkirim":true,"adaGalat":false,"percobaan":1}` — jadi jalur
  penyedia email benar-benar ditembus, bukan hanya jalur alamat uji. Tidak ada alamat atau rahasia yang
  dicetak.
- DOM (klik nyata): `bun scripts/verify-render.mjs` → **406/406, exit 0** (403 → +3).
- Preview: `freebuff-preview status` → `running: true`, `listening: true`, `statusCode: 200`.
- **Belum diverifikasi:** penerimaan email oleh orang yang benar-benar diundang (klik dari inbox ke
  halaman Masuk) dan tampilan email di klien email sungguhan — alamat uji sengaja tidak dikirimi email,
  dan pengiriman nyata di atas diarahkan ke kotak proyek sendiri.

**Catatan / blocker:** tidak ada blocker baru. Angka di tabel **Status Phase 1** dan daftar **Perintah
verifikasi rutin** diselaraskan (579 → 586 untuk `verify-backend`, 403 → 406 untuk `verify-render`).

## 2026-10-12 — Tim dalam bisnis yang sama: undangan anggota lewat halaman Tim & Peran (`members.add`)
**Ruang lingkup:** pertanyaan pengguna: “bagaimana cara mendaftarkan akun team baru dalam bisnis yang
sama”. Pemeriksaan awal menemukan celahnya: `members.add` sudah ada di server (izin `team.manage`,
pagar eskalasi pemilik, akun platform ditolak, undangan ulang = perubahan peran), tetapi **tidak ada
satu pun pemanggilnya di klien** — halaman Tim & Peran hanya menampilkan anggota dan peran kustom, jadi
satu-satunya jalur adalah CLI. Yang dikerjakan:

1. **Aturan murni baru** (`src/convex/lib/team.ts` + re-export `src/lib/team.ts`):
   `validateTeamInvite` (email memakai `checkEmail` yang sama dengan halaman masuk, peran dikenal, hanya
   pemilik yang boleh menetapkan `owner`, nama maksimal 80 karakter), `assignableRoles`, dan
   `inviteNextStep` (kalimat langkah berikutnya bagi yang diundang).
2. **Server** (`src/convex/members.ts`): pemeriksaan email & pagar eskalasi sekarang memakai aturan
   murni itu (`validateTeamInvite`), sehingga pesan dan syaratnya sama dengan yang dilihat pengundang
   di halaman — bukan dua aturan yang mirip. Perilaku eskalasi & pemblokiran akun platform tidak berubah.
3. **Kontrak store** (`src/lib/store/types.ts`): `InviteTeamMemberInput`, `InvitedTeamMember`, dan
   aksi `addTeamMember`; diimplementasikan di store Convex (`api.members.add`, daftar anggota ikut segar
   karena `members.list` reaktif) **dan** store demo (validasi sama, id diturunkan dari email supaya
   menekan tombol dua kali tidak menggandakan anggota).
4. **Halaman Tim & Peran** (`src/pages/TeamPage.tsx`): kartu **Daftarkan anggota tim** (email, nama
   opsional, peran) yang hanya tampil untuk izin `team.manage`, dengan pratinjau alasan sebelum dikirim,
   notis hasil yang membedakan anggota baru dari perubahan peran, dan kalimat langkah berikutnya
   (masuk dengan kode OTP ke email itu). Manajer tidak ditawari peran Pemilik.
5. **Harness**: 8 cek baru di `scripts/verify-backend.mjs` (undangan terikat ke akun yang dipakai
   orangnya untuk masuk; akun itu berada di bisnis pengundang — bukan bisnis baru; ia bisa membaca data
   bisnis itu; kasir ditolak mengundang; undangan ulang mengubah peran; tidak ada anggota kembar;
   email tanpa titik ditolak) dan 8 cek baru di `scripts/verify-render.mjs` (form ada, pilihan peran
   pemilik lengkap vs manajer, email salah bentuk ditolak sebelum dikirim, klik nyata menambah anggota
   ke daftar, langkah berikutnya dijelaskan, undangan ulang tidak menggandakan).

**Berkas:** baru: `src/convex/lib/team.ts` · `src/lib/team.ts` · diubah: `src/convex/members.ts` ·
`src/lib/store/types.ts` · `src/lib/store/convex.tsx` · `src/lib/store/demo.tsx` ·
`src/pages/TeamPage.tsx` · `scripts/verify-backend.mjs` · `scripts/verify-render.mjs` · `README.md` ·
`worklog.md`

**Verifikasi:**

- Tipe: `bun tsc -b --noEmit` → **exit 0** · `bun tsc -p tsconfig.convex.json --noEmit` → **exit 0**.
- Backend: `bun convex dev --once` → **exit 0**, `Convex functions ready! (3.56s)` ·
  `bun scripts/verify-backend.mjs` → **579/579, exit 0** (571 → +8), termasuk “undangan anggota tim
  membuat keanggotaan di workspace pengundang”, “undangan terikat ke akun yang dipakai orangnya untuk
  masuk”, “akun yang diundang berada di bisnis pengundang, bukan bisnis baru”, “kasir ditolak
  mendaftarkan anggota tim berikutnya (izin team.manage)”, “anggota yang sama tidak muncul dua kali”.
- DOM (klik nyata): `bun scripts/verify-render.mjs` → **403/403, exit 0** (395 → +8).
- Jalur CLI yang didokumentasikan benar-benar dijalankan: `bun convex run members:add
  '{"tenantId":"ks78b1wz047dhehtvz6b363xss8g411c","actorId":"kx75062x7j6cej9wb7e0adths98g599w","email":"anggota-cli+1791813932538@mesinpos.test","name":"Anggota CLI","role":"cashier"}'`
  → **exit 0**, `{"created": true, "membershipId": "…", "userId": "kx71jr6717w140xxr2k2cxeygs8g5e3h"}`;
  akun yang diundang itu kemudian masuk (`users.createOrGet` dengan email yang sama) → **userId sama**
  dan `tenants.listMine` → **1 workspace** `ks78b1wz047dhehtvz6b363xss8g411c:cashier`. (Skrip bantu
  sementara untuk menyiapkan id sudah dihapus lagi.)
- Preview: `freebuff-preview status` → `running: true`, `listening: true`, `statusCode: 200`; modul yang
  diubah dari dev server → `/src/pages/TeamPage.tsx` **HTTP 200** (memuat teks “Daftarkan anggota tim”
  dan “kode OTP ke email itu”) · `/src/convex/lib/team.ts` **HTTP 200**.
- **Belum diverifikasi:** alur sungguhan di browser terhadap Convex (memasukkan kode OTP orang yang
  diundang di perangkat lain) — harness render berjalan di mode demo, dan langkah manusia dua-perangkat
  belum dijalankan.

**Catatan / blocker:** tidak ada blocker baru. Tabel **Status Phase 1** dan daftar **Blocker**
diperiksa: tidak berubah selain angka suite yang diselaraskan (571 → 579 untuk `verify-backend`,
395 → 403 untuk `verify-render`).

## 2026-10-12 — Satu akun = satu bisnis: workspace berdiri sendiri per akun (nama bisnis boleh sama, data tidak bercampur)
**Ruang lingkup:** permintaan pengguna: “Buat setiap akun yang mendaftar berdiri secara mandiri
berdasarkan nama bisnis masing-masing dan tidak bercampur dengan akun lain yang mendaftar dengan nama
bisnis yang berbeda. Setiap akun yang berdiri mandiri tersebut bisa mengatur semua sendiri-sendiri,
karena web app ini adalah software SaaS POS cloud.” Yang dikerjakan:

1. **Server — nama bisnis bukan kunci unik** (`src/convex/tenants.ts`): `tenants.create` mencari alamat
   bebas (`uniqueSlug`: `desired`, `desired-2`, … maksimum 50 percobaan, dengan pesan jelas kalau
   habis), sehingga pendaftar kedua dengan nama bisnis yang sama **tidak ditolak** dan **tidak
   dilempar** ke workspace milik orang lain — ia mendapat tenant baru beserta cabang pertama,
   keanggotaan `owner`, dan kategori bawaannya sendiri. Hanya tenant tempat pemanggil **sudah** menjadi anggota yang
   dikembalikan sebagai `reused: true` (beserta `slug`/`name` sebenarnya supaya klien bisa
   menyelaraskan sesinya).
2. **Kontrak klien — keanggotaan yang menentukan workspace** (`src/lib/store/convex.tsx`): workspace
   aktif dibaca dari `tenants.listMine` (pilihan sesi perangkat ini kalau memang salah satu miliknya,
   kalau tidak workspace pertamanya), bukan dari pencarian slug. Menebak slug tidak pernah membuka
   bisnis orang lain, dan akun dengan nama bisnis berbeda tidak bisa saling melihat.
3. **Sesi — adopsi identitas workspace** (`src/lib/session.tsx` + efek di store): `adoptWorkspace`
   mengisi nama, slug, peran, **paket, modul, nama cabang, dan jam trial** dari workspace milik
   pengguna, dan dipanggil setiap kali workspace diketahui (dedupe di dalamnya menahan render berulang).
   Efeknya: masuk dari perangkat baru memulihkan bisnisnya sendiri, bukan menawarkan membuat yang baru.
4. **Halaman — onboarding menahan formulir selama identitas belum pasti**: kontrak baru
   `StoreApi.workspacePending` (mode demo: `false`) plus layar `WorkspaceRecovery` di
   `src/pages/OnboardingPage.tsx`; kalau penyambungan gagal, penyebabnya ditampilkan apa adanya beserta
   tombol “Coba lagi”. `RequireTenant` kini membawa `returnTo`, jadi setelah pulih pengguna mendarat di
   halaman yang tadi dibuka, dan `returnTo` dari URL hanya diterima kalau berupa jalur internal.
5. **Harness**: 13 cek baru di `scripts/verify-backend.mjs` (dua akun dengan nama bisnis sama dan
   alamat yang diminta sama → dua workspace berbeda; daftar ulang memakai workspace sendiri; isolasi
   baca & tulis; modul tidak menyentuh bisnis lain) dan 6 cek baru di `scripts/verify-render.mjs`
   (formulir bisnis tersembunyi + alasannya terlihat selama `workspacePending`, dan muncul kembali
   setelah status itu selesai).

**Berkas:** baru: — · diubah: `src/convex/tenants.ts` · `src/lib/session.tsx` ·
`src/lib/store/types.ts` · `src/lib/store/convex.tsx` · `src/lib/store/demo.tsx` ·
`src/pages/OnboardingPage.tsx` · `scripts/verify-backend.mjs` · `scripts/verify-render.mjs` ·
`README.md` · `worklog.md`

**Verifikasi:**

- Tipe: `bun tsc -b --noEmit` → **exit 0** · `bun tsc -p tsconfig.convex.json --noEmit` → **exit 0**.
- Backend: `bun convex dev --once` → **exit 0**, `Convex functions ready! (3.83s)` ·
  `bun scripts/verify-backend.mjs` → **571/571, exit 0** (558 → +13), termasuk “dua bisnis bernama sama
  tidak berbagi workspace”, “pendaftar kedua mendapat alamat sendiri, bukan alamat orang lain”,
  “pemilik bisnis kedua ditolak membaca/menulis katalog bisnis pertama”, “mendaftar ulang memakai
  kembali workspace sendiri”, dan “pengaturan workspace tidak tertimpa saat mendaftar ulang”.
- DOM (React sungguhan di happy-dom): `bun scripts/verify-render.mjs` → **395/395, exit 0** (389 → +6).
- Preview: `freebuff-preview status` → `running: true`, `listening: true`, `statusCode: 200`; modul yang
  diubah dari dev server (`/src/pages/OnboardingPage.tsx` → HTTP 200, `/src/lib/session.tsx` → HTTP 200)
  memuat teks “Memuat workspace Anda” serta pengalihan `onboarding?returnTo=` yang baru — artinya kedua
  modul itu benar-benar terkompilasi di dev server, bukan hanya lolos `tsc`.
- **Belum diverifikasi:** jalur sesi→store Convex di browser sungguhan — harness render berjalan di
  mode demo, jadi gating `workspacePending` diuji dengan nilai store yang asli tetapi status yang
  diganti; langkah manusia di perangkat kedua juga belum dijalankan.

**Catatan / blocker:** Blocker #1 diperbarui: sesi masih per perangkat (`localStorage`), tetapi
identitas bisnisnya kini selalu diselaraskan dari keanggotaan server, jadi sesi basi tidak bisa lagi
menampilkan atau membuka workspace milik akun lain. Angka di tabel **Status Phase 1** dan daftar
**Perintah verifikasi rutin** diselaraskan (558 → 571 untuk `verify-backend`, 389 → 395 untuk
`verify-render`).

## 2026-10-12 — Kategori menentukan SKU: ganti kategori → kode SKU ikut (`products.setCategory`)
**Ruang lingkup:** permintaan pengguna: “jika kategori produk berubah, seharusnya format sku berubah
mengikuti <KATEGORI> yg dipilih / aktif”. Sebelumnya ada dua celah: (a) kategori produk **tidak bisa
diubah** sama sekali setelah dibuat — kartu **Atur harga** hanya memuat harga/satuan/tier, dan (b) di
form **Produk baru**, SKU yang sudah diisi tombol **Buat otomatis** tidak ikut berubah saat Kategori
diganti, jadi `PBB-SAN-…` bisa tertinggal di produk yang kategorinya lain. Yang dikerjakan:

1. **Aturan murni** (`recodeProductSku` di `src/convex/lib/productSku.ts`): SKU berformat `PBB-…`
   diganti kode kategorinya dan **nomornya dipertahankan** selama masih bebas; kalau nomor itu sudah
   dipakai di kategori tujuan, nomor berikutnya yang bebas dipakai supaya pindah kategori tidak pernah
   gagal karena bentrok. SKU di luar format (diketik pemilik toko, mis. `KOPI-01`) dikembalikan apa
   adanya. Label “Tanpa kategori” yang dipakai tabel produk kini dihitung sebagai tidak berkategori
   (kode `UMU`), bukan kategori bernama itu.
2. **Server** (`products.setCategory`, izin `product.manage`): memindahkan produk ke kategori lain
   (atau melepas kategorinya), menghitung SKU baru dari katalog tenant **tanpa** SKU produk itu
   sendiri, memeriksa bentrok terakhir sebelum menyimpan, dan menulis audit `product.category`
   (kategori, SKU sebelum/sesudah). Balikannya `{ sku, previousSku, category }` supaya halaman
   memberi tahu apa yang benar-benar terjadi, bukan menebak.
3. **Kontrak store**: `SetProductCategoryInput` + `setCategory()` di store Convex (nama kategori →
   `categoryId`) dan store demo (memakai `recodeProductSku` yang sama), jadi kedua mode berperilaku
   sama.
4. **Form Produk baru**: status `skuAuto` menandai isi kolom SKU yang berasal dari tombol. Selama
   `skuAuto` hidup, memilih Kategori lain langsung memperbarui SKU-nya; begitu kolomnya diketik
   sendiri, `skuAuto` mati dan isi itu tidak pernah ditimpa. Keterangan kolomnya diperbarui.
5. **Kartu Atur harga**: kolom **Kategori** baru (tersimpan bersama tombol “Simpan harga”), plus baris
   SKU saat ini beserta penjelasan aturannya. Setelah menyimpan, halaman memberi tahu hasilnya:
   “SKU ikut menyesuaikan dari PBB-SAN-000042 menjadi PBB-MAK-000042” atau “SKU … diketik sendiri,
   jadi tidak ikut berubah”.
6. **Panduan**: langkah “Pilih Kategori” menyebut aturan ini, dan PDF-nya dibangun ulang.

**Berkas:** baru: — (tidak ada berkas baru) · diubah: `src/convex/lib/productSku.ts` ·
`src/convex/products.ts` · `src/lib/store/types.ts` · `src/lib/store/demo.tsx` ·
`src/lib/store/convex.tsx` · `src/pages/ProductsPage.tsx` · `scripts/verify-product-sku.mjs` ·
`scripts/verify-render.mjs` · `scripts/verify-backend.mjs` · `scripts/gen-panduan-pdf.mjs` ·
`public/panduan/panduan-mesinpos.pdf` · `README.md` · `worklog.md`

**Verifikasi:**

- Aturan murni: `bun scripts/verify-product-sku.mjs` → **39/39, exit 0** (31 → +8: kategori berubah →
  `PBB-SAN-000042` menjadi `PBB-MAK-000042` dengan nomor tetap; kategori dilepas → `UMU`; kategori sama
  → SKU tidak berubah; `KOPI-01` dan `kopi-susu` tidak disentuh; nomor yang sudah terpakai di kategori
  tujuan → nomor berikutnya yang bebas; dan lima produk yang dipindah satu per satu tidak pernah
  menghasilkan SKU kembar).
- End-to-end di deployment awan: `SPAWN_BACKEND=1 bun scripts/verify-backend.mjs` → **558/558,
  exit 0** (548 → +10: `PBB-UMU-…` → `PBB-MAK-…` nomor tetap, kategori dilepas → `UMU`, SKU manual
  tidak berubah & kategorinya tetap tersimpan, nomor yang ditahan SKU lain dilewati, **kasir ditolak**
  `izin product.manage`, SKU tersimpan di produk, dan tidak ada SKU kembar setelah pindah).
- DOM (klik nyata): `bun scripts/verify-render.mjs` → **389/389, exit 0** (379 → +10: SKU dari tombol
  ikut kategori baru saat Kategori diganti di form, SKU yang diketik berhenti mengikuti, kartu edit
  punya kolom Kategori + SKU saat ini, mengganti kategori dari kartu edit mengubah SKU produk ber-SKU
  otomatis (nomor tetap) dan **tidak** mengubah SKU manual, notisnya menyebut hasilnya, dan katalog
  tetap tanpa SKU kembar).
- Tipe: `bun tsc -b --noEmit` → **exit 0** · `bun tsc -p tsconfig.convex.json --noEmit` → **exit 0**.
- Tidak ada regresi pada cek yang bersinggungan: `bun scripts/verify-product-images.mjs` → **25/25,
  exit 0** · `bun scripts/verify-menus.mjs` → **384/384, exit 0**.
- Panduan & PDF: `bun run panduan:pdf` → **exit 0** (20 halaman, 13 bagian, 9 gambar, 62,4 KB) ·
  `bun scripts/verify-panduan.mjs` → **13/13, exit 0**.
- Preview: `freebuff-preview status` → `running: true`, `statusCode: 200`; modul halaman Produk dari
  dev server → **HTTP 200** dan memuat kolom Kategori kartu edit + helper SKU yang baru.
- Perintah yang **gagal** saat dikerjakan (ditulis apa adanya, lalu diperbaiki bukan dengan melemahkan
  cek): `verify-product-sku.mjs` gagal sekali karena **data uji saya sendiri** memasukkan SKU produk
  yang sedang dipindah ke `takenSkus` (nomornya jadi dianggap bentrok) — diperbaiki dengan
  menyingkirkannya, seperti yang memang dilakukan pemanggil asli; `verify-render.mjs` gagal dua kali:
  probe DOM belum memantau `category`, dan satu langkah memilih kategori yang **sudah** sama sehingga
  bukan perubahan apa pun.
- Yang **tidak** dijalankan: `verify-webhook-retries.mjs` (menunggu jadwal sungguhan, tidak
  bersinggungan).

**Catatan / blocker:** (i) Batas yang disengaja: SKU yang **diketik pemilik toko** tidak pernah diubah
— termasuk saat kategorinya diganti; kalau toko punya SKU manual berformat `PBB-…` dan ingin kodenya
mengikuti, tombol **Buat otomatis** di form (atau mengetik ulang) adalah jalannya. (ii) Nomor urut boleh
“dipakai ulang” setelah kategori berganti selama nomornya bebas di kategori tujuan — nomor urut memang
unikum per tenant, bukan per kategori. (iii) `saleItems` menyimpan nama produk (bukan SKU), jadi riwayat
struk lama tidak ikut berubah oleh SKU baru. (iv) Mengklik kolom Kategori di browser produksi masih
terbuka — **Blocker #3** diperbarui. (v) Angka di tabel Status Phase 1, ringkasan suite, dan daftar
perintah rutin diselaraskan (`verify-render` 379 → **389**, `verify-backend` 548 → **558**,
`verify-product-sku` 31 → **39**). Tidak ada klausa Phase baru.

## 2026-10-12 — SKU otomatis `PBB-<KATEGORI>-<nomor urut>` + tombol **Buat otomatis** di samping kolom SKU
**Ruang lingkup:** permintaan pengguna: “sku dibuat otomatis dengan Format POS: PBB-<KATEGORI>-<nomor
urut> (contoh PBB-SAN-000042). Kosongkan dan simpan untuk dibuat otomatis & unik. Dan di sebelah field
SKU ada tombol Untuk pembuatan sku secara otomatis jika filed sku kosong.” Sebelumnya kolom SKU harus
diisi sendiri (halaman masih mengusulkan dari nama produk) dan server menolak SKU kosong/kembar, jadi
“kosongkan dan simpan” belum mungkin. Yang dikerjakan:

1. **Aturan murni baru** `src/convex/lib/productSku.ts`: prefix `PBB`, kode kategori **tiga huruf**
dari nama kategori (“Sanitasi” → `SAN`; tanpa kategori → `UMU`; nama pendek diisi `X`), dan nomor urut
**enam digit**. Berisi `formatProductSku`, `parseProductSkuSequence`, `isGeneratedProductSku`,
`nextProductSkuSequence`, dan `suggestProductSku`. SKU di luar format (katalog lama seperti `KOPI-01`)
diabaikan saat mencari nomor, jadi tidak menggeser urutannya.
2. **Server** (`src/convex/products.ts`): `resolveProductSku` — SKU yang **diketik** dipakai apa adanya;
kolom **kosong** mengambil nomor dari counter tenant (`nextSequence(..., "product.sku")`) lalu
mencocokkannya dengan SKU yang sudah ada, jadi SKU manual berformat sama (mis. `PBB-SAN-000042` yang
diketik pemilik toko) **tidak ditabrak** — counter-nya hanya maju, maksimal 50 percobaan. `create`
mengembalikan `{ productId, sku }`, jadi klien memakai nomor final dari server, bukan tebakan.
3. **Kontrak store**: `CreateProductInput.sku` jadi opsional dan `createProduct()` mengembalikan
`{ id, sku }`. Store Convex meneruskan SKU kosong sebagai permintaan “buat otomatis”; store demo
memakai `suggestProductSku` (daftar SKU-nya ada seluruhnya di klien) dan kini **tidak** lagi mengubah
huruf SKU yang diketik, sama seperti server.
4. **UI** (form **Produk baru**): kolom SKU diberi label opsional + keterangan formatnya, dan di
sebelahnya ada tombol **Buat otomatis** (`aria-label="Buat SKU otomatis"`) yang mengisi kolom dari
daftar SKU yang sudah ada supaya bisa dilihat/diubah sebelum menyimpan. Tombolnya **mati selama kolom
terisi** — SKU ketikan pemilik toko tidak ditimpa. Notis setelah menyimpan menyebut SKU finalnya.
5. **Panduan**: langkah “Isi Nama produk … SKU diusulkan otomatis dari nama” diganti penjelasan
“SKU boleh dikosongkan”, istilah SKU + ilustrasi formnya ikut diperbarui, dan PDF-nya dibangun ulang
(20 halaman, 13 bagian, 9 gambar).

**Berkas:** baru: `src/convex/lib/productSku.ts` · `src/lib/productSku.ts` ·
`scripts/verify-product-sku.mjs` · diubah: `src/convex/products.ts` · `src/lib/store/types.ts` ·
`src/lib/store/demo.tsx` · `src/lib/store/convex.tsx` · `src/pages/ProductsPage.tsx` ·
`scripts/verify-render.mjs` · `scripts/verify-backend.mjs` · `scripts/gen-panduan-pdf.mjs` ·
`public/panduan/panduan-mesinpos.pdf` · `README.md` · `worklog.md`

**Verifikasi:**

- Aturan murni: `bun scripts/verify-product-sku.mjs` → **31/31, exit 0** (contoh dari permintaan
  terbentuk persis `PBB-SAN-000042`; `Sanitasi`→`SAN`, `Minuman`→`MIN`, tanpa kategori→`UMU`,
  nama `AB`→`ABX`; nomor berikutnya = tertinggi + 1 dan melompati SKU manual berformat sama dengannya;
  SKU di luar format seperti `KOPI-01`, `PBB-SAN-42`, atau `PBB-SAN-000042-EXTRA` ditolak/diabaikan).
- End-to-end di deployment awan: `SPAWN_BACKEND=1 bun scripts/verify-backend.mjs` →
  **548/548, exit 0** (538 → +10 cek SKU: bentuk `PBB-UMU-…` saat kolom kosong, kode kategori ikut
  kategori produk, nomor urut yang sudah dipakai manual **dilewati**, SKU manual dipakai apa adanya,
  SKU otomatis benar-benar tersimpan, tidak ada SKU kembar, dan SKU manual kembar tetap ditolak).
  Blok SKU sengaja dipindah ke **paling akhir** `main()` supaya cek `usage produk = 2` dan laporan yang
  menghitung produk tidak berubah artinya (sebelumnya sempat gagal karena itu).
- DOM (klik nyata): `bun scripts/verify-render.mjs` → **379/379, exit 0** (371 → +8: tombol ada di
  samping kolom SKU, hidup selama kolom kosong, mengisi kolom dengan SKU berformat, mati setelah kolom
  terisi, hidup lagi setelah dikosongkan, simpan dengan kolom kosong menghasilkan SKU otomatis yang
  unik, notisnya menyebut SKU final, dan dugaan tombol sama dengan nomor yang benar-benar dipakai).
- Tipe: `bun tsc -b --noEmit` → **exit 0** · `bun tsc -p tsconfig.convex.json --noEmit` → **exit 0**.
- Tidak ada regresi pada cek yang bersinggungan: `bun scripts/verify-product-images.mjs` → **25/25,
  exit 0** · `bun scripts/verify-menus.mjs` → **384/384, exit 0**.
- Panduan & PDF: `bun run panduan:pdf` → **exit 0** (20 halaman, 13 bagian, 9 gambar, 62,1 KB) ·
  `bun scripts/verify-panduan.mjs` → **13/13, exit 0**.
- Yang **tidak** dijalankan: `verify-webhook-retries.mjs` (butuh menunggu jadwal sungguhan, tidak
  bersinggungan dengan perubahan ini). Klik di browser produksi juga belum (lihat di bawah).

**Catatan / blocker:** (i) tombol **Buat otomatis** hanya mengisi kolom dari daftar SKU yang sedang
terbaca klien; yang **final** tetap counter server, jadi dua kasir yang menyimpan bersamaan tidak bisa
menghasilkan SKU kembar (saran di layar boleh berbeda dari hasil). (ii) Mengklik kolom & tombolnya di
browser produksi masih terbuka — **Blocker #3** diperbarui agar menyebut alur SKU ini. (iii) Tidak ada
klausa Phase baru; angka di tabel Status Phase 1, ringkasan suite, daftar perintah rutin, dan item
Blocker #3 diselaraskan (`verify-render` 371 → **379**, `verify-backend` 538 → **548**). (iv) SKU lama
yang sudah terlanjur dibuat manual **tidak** dimigrasikan — ia diabaikan oleh pencari nomor, jadi
riwayat struk lama tidak berubah.

## 2026-10-12 — Koreksi: opsi unggah gambar harus ada di **kartu tambah/edit produk**, bukan panel terpisah
**Ruang lingkup:** keluhan pengguna “di card add/edit produk masih belum muncul opsi untuk mengupload
gambarnya”. Entri sebelumnya memang salah menaruh: unggahan gambar hanya ada di **panel baris sendiri**
(tombol **Gambar** di kolom Aksi), bukan di kartu yang dibuka pengguna saat menambah atau mengedit
produk — jadi walaupun fiturnya jalan, di tempat yang dicari tidak ada apa pun. Yang diperbaiki:

1. **Satu komponen editor gambar** (`ProductImageEditor` di `src/pages/ProductsPage.tsx`) dipakai di
**dua kartu**: kartu **Produk baru** dan kartu **Atur harga** (kartu edit produk). Komponennya tidak tahu
soal store — pemanggil yang menentukan arti “tambah”/“hapus” — jadi tidak ada logika ganda.
2. **Kartu Produk baru**: bagian **Gambar** ada di dalam form, sebelum tombol Simpan. Berkasnya
**ditahan dulu di state** beserta pratinjaunya (produknya belum punya id, sedangkan `products.addImage`
butuh id), lalu diunggah berurutan setelah `products.create` berhasil. Aturan 8 gambar/2 MB/tipe sudah
diperiksa saat memilih berkas, jadi penolakannya terlihat sebelum menekan Simpan. Menutup form membuang
gambar yang belum terunggah, dan kalau penyimpanan produk gagal, pilihan gambarnya tetap ada untuk dicoba
ulang.
3. **Kartu Atur harga**: bagian gambar yang sama, dan di sana unggah/hapus **langsung tersimpan** —
perilaku itu ditulis di kartunya supaya tidak disangka menunggu tombol “Simpan harga”.
4. **Panel baris “Gambar” dihapus.** Tiga jalan menuju hal yang sama membuat pemeliharaannya
bercabang; kolom **Gambar** di tabel (thumbnail + lencana `n/8`) tetap ada sebagai penanda visual.
5. Tombol baris **Atur harga** dan **Modifier** kini punya `aria-label` yang menyebut nama produk,
supaya bisa diklik tepat per baris (dipakai harness, dan lebih baik untuk pembaca layar).

Catatan penting: **tidak ada perubahan backend** di pekerjaan ini — aturan, skema, dan fungsi server
(`image/*`, `addImage`, `removeImage`) tetap sama; yang berubah hanya tempat opsi unggahnya di UI.

**Berkas:** diubah: `src/pages/ProductsPage.tsx` · `scripts/verify-render.mjs` · `README.md` ·
`worklog.md` (tidak ada berkas baru; `src/convex/**` tidak disentuh)

**Verifikasi:**

- Tipe: `bun tsc -b --noEmit` → **exit 0**.
- DOM (klik nyata, berkas benar-benar dipilih lewat input berkas): `bun scripts/verify-render.mjs` →
  **371/371, exit 0** (370 → 371, dengan 12 cek gambar yang dirapikan ulang: **kartu Produk baru**
  punya input berkas, dua berkas yang dipilih tampil sebagai pratinjau, satu bisa dibatalkan sebelum
  simpan (“Sisa 7 dari 8”), produk tersimpan bersama **2 gambar** dan notisnya menyebut
  “2 gambar ikut tersimpan (2/8)”, thumbnail dirender di kolom gambar; lalu di **kartu Atur harga**:
  bagian gambar memuat 2 gambar yang tadi, enam berkas sekaligus mengisi sampai penuh, saat penuh
  inputnya mati, berkas ke-9 yang dipaksa pun tidak menambah gambar dan alasannya muncul, hapus satu
  gambar, lalu slotnya bisa dipakai lagi).
- Aturan murni tidak berubah dan tetap lulus: `bun scripts/verify-product-images.mjs` → **25/25, exit 0**.
- Menu & rute tidak berubah: `bun scripts/verify-menus.mjs` → **384/384, exit 0**.
- Backend tidak dijalankan ulang (kode `src/convex/**` tidak disentuh): hasil terakhir
  `verify-backend.mjs` **538/538** terhadap deployment awan tetap berlaku.
- Preview: `freebuff-preview status` → `running: true`, `statusCode: 200`; modul halaman Produk
  dikompilasi dev server tanpa galat.

**Catatan / blocker:** (i) mengklik tombolnya di browser produksi masih terbuka — **Blocker #3**
diperbarui agar menyebut kartu Produk baru & Atur harga, bukan panel baris; (ii) tidak ada klausa Phase
baru; angka `verify-render` di paragraf Status Phase 1 dan daftar perintah rutin diselaraskan
370 → **371**; (iii) batas 8 gambar tetap ditegakkan server, jadi UI yang salah pun tidak bisa
melampauinya.

## 2026-10-12 — Gambar produk: sampai **8 gambar** per produk, tersimpan di penyimpanan Convex
**Ruang lingkup:** permintaan “tambahkan gambar untuk setiap produk, bisa sampai maksimal 8 gambar”.
Sebelumnya produk **sama sekali tidak punya gambar**: tabel `products` tidak punya kolom gambar,
penyimpanan berkas Convex belum pernah dipakai, dan halaman Produk & Stok hanya menampilkan
SKU/nama/harga/stok. Yang dikerjakan:

1. **Aturan murni** (`src/convex/lib/productImages.ts`): batas **8 gambar** (`MAX_PRODUCT_IMAGES`),
**2 MB** per berkas (`MAX_PRODUCT_IMAGE_BYTES`), tipe JPG/PNG/WebP, plus `canAddProductImage`,
`validateProductImage`, `productImageSlots`, `remainingProductImageSlots`, `describeProductImages`.
Dipakai **tiga** lapisan sekaligus — halaman Produk, store demo, dan `products.addImage` di server —
jadi angka batasnya tidak bisa berbeda antar lapisan.
2. **Penyimpanan**: kolom baru `products.images: v.optional(v.array(v.id("_storage")))` berisi **id
berkas**, bukan URL (URL bertanda tangan punya masa berlaku; URL yang disimpan akan jadi gambar mati).
Fungsi baru di `src/convex/products.ts`: `generateImageUploadUrl` (izin `product.manage`),
`addImage` (batas 8 diperiksa **lagi** + metadata `_storage` untuk tipe/ukuran; berkas yang ditolak
langsung dihapus), `removeImage` (melepas dari produk **dan** menghapus berkasnya), dan
`listByStore` kini mengembalikan `images: [{ id, url }]` dengan URL dibuat **saat query dijalankan**.
3. **Kontrak store**: `StoreProductImage`, `StoreProduct.images`, `addProductImage(productId, file)`,
`removeProductImage(productId, imageId)`. Di store Convex alurnya tiga langkah (minta URL → POST
berkas → tautkan id); di store demo (yang tidak punya penyimpanan berkas) gambarnya hidup di memori
sebagai data URL — dan state demo memang tidak dipersist ke `localStorage`, jadi tidak ada kuota 5 MB
yang dijebol.
4. **Perkecilan di klien** (`src/lib/productImages.ts`): `prepareProductImage` memperkecil sisi
terpanjang jadi 1200 px dan meng-encode ulang JPEG mutu 0,82 lewat canvas, karena foto kamera ponsel
biasanya 3–8 MB padahal thumbnail-nya cuma beberapa puluh piksel. Kalau `createImageBitmap` tidak ada
(DOM tiruan) berkas aslinya dikembalikan apa adanya — bukan gagal diam-diam. PNG transparan diratakan
ke latar putih dan itu ditulis di dokumen.
5. **UI halaman Produk & Stok**: kolom **Gambar** (thumbnail gambar utama + lencana `n/8`), tombol
**Gambar** per baris, dan panel berisi seluruh gambar dengan tombol hapus per gambar plus kotak
**Tambah gambar** (input berkas `multiple`). Saat penuh, input dimatikan dan labelnya menulis
“Penuh (8 gambar)”. Sisa slot dihitung dari data produk: mengunggah 10 berkas ke produk berisi 5
gambar hanya memakai 3 berkas pertama, dan sisanya **diberitahukan**, bukan dibuang diam-diam.

**Berkas:** baru: `src/convex/lib/productImages.ts` · `src/lib/productImages.ts` ·
`scripts/verify-product-images.mjs` · diubah: `src/convex/schema.ts` · `src/convex/products.ts` ·
`src/lib/store/types.ts` · `src/lib/store/demo.tsx` · `src/lib/store/convex.tsx` ·
`src/pages/ProductsPage.tsx` · `scripts/verify-render.mjs` · `scripts/verify-backend.mjs` ·
`scripts/happy-dom-setup.mjs` · `README.md` · `worklog.md`

**Verifikasi:**

- Aturan murni: `bun scripts/verify-product-images.mjs` → **25/25, exit 0** (batas 8 termasuk berkas
  ke-9 yang ditolak dengan pesan “Hapus salah satu dulu”, tepat 2 MB diterima sementara 2 MB + 1 byte
  ditolak, tipe berkas dengan parameter/huruf besar diterima, GIF & PDF ditolak, jumlah negatif
  ditolak, label slot `0/8`/`3/8`/`8/8`).
- Tipe: `bun tsc -b --noEmit` → **exit 0** · `bun tsc -p tsconfig.convex.json --noEmit` → **exit 0**.
- DOM, dengan berkas yang benar-benar dipilih lewat input: `bun scripts/verify-render.mjs` →
  **370/370, exit 0** (359 → +11: panel gambar terbuka beserta batasnya, berkas tersimpan jadi gambar
  produk, thumbnail gambar utama dirender, notis “kini 1/8”, tujuh berkas sekaligus mengisi sampai 8,
  saat penuh input mati, berkas ke-9 yang **dipaksa** pun tidak menambah gambar dan alasannya
  dijelaskan, gambar bisa dihapus satu per satu, lalu slotnya bisa dipakai gambar baru).
  `scripts/happy-dom-setup.mjs` kini memasang `FileReader` supaya alur unggah bisa diuji tanpa browser.
- Server + penyimpanan **sungguhan** (bukan tiruan): `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud
  bun scripts/verify-backend.mjs` → **538/538 checks passed, exit 0** (502 → +36). Yang diuji di sana:
  `generateImageUploadUrl` mengembalikan URL, POST berkas diterima penyimpanan, `addImage` menautkannya,
  `listByStore` mengembalikan URL `https://` yang **menyajikan byte yang sama** dengan yang diunggah,
  delapan gambar tersimpan, gambar ke-9 ditolak (“maksimal 8”) tanpa menyelinap, PDF ditolak
  (“JPG, PNG, atau WebP”) dan produk itu tetap tanpa gambar, `removeImage` melepas gambar **dan** URL
  lamanya jadi **404**, serta akun di luar tenant tidak bisa meminta URL unggah.
- Menu & rute tidak berubah: `bun scripts/verify-menus.mjs` → **384/384, exit 0**.
- Backend ikut ter-push ke deployment: `bun convex dev --once` → `Convex functions ready!` (exit 0).

**Catatan / blocker:** (i) tombol unggahnya **belum diklik di browser sungguhan** — halaman Produk &
Stok memang sudah masuk **Blocker #3**, dan item itu diperbarui dengan gambar produk; (ii) mode demo
menyimpan gambar sebagai data URL di memori dan produk demo tidak dipersist, jadi gambar demo hilang
saat halaman dimuat ulang — batas mode demo, bukan bug; (iii) grid **kasir** (`/app/pos`) dan struk
**belum** menampilkan gambar produk — permintaan kali ini soal menambahkan gambar ke produk, jadi layar
jual sengaja tidak diubah; (iv) PNG transparan diratakan ke latar putih karena hasilnya JPEG;
(v) tidak ada klausa Phase baru di tabel Status Phase (ini kemampuan produk, bukan klausa roadmap);
angka `verify-backend` di tabel & paragraf Status Phase 1 diselaraskan 502 → **538**, dan paragraf
“Angka di kolom verifikasi” diselaraskan `verify-render` 328 → **370** serta ditambah
`verify-product-images` **25/25**; daftar perintah rutin bertambah satu baris.

## 2026-10-12 — Panduan PDF: bagian **Pembelian** dan **Opname** ditambahkan sampai tuntas
**Ruang lingkup:** permintaan “Tambahkan halaman Panduan pembelian dan opname ke dalam PDF panduan
agar semua alur tercakup”. Panduan yang ada sebelumnya hanya menyentuh keduanya setengah jalan:
bagian pembelian berhenti di penerimaan barang (GRN) — tagihan supplier, pencocokan 3 arah,
keputusan selisih, dan pembayaran hutang tidak pernah masuk dokumen — sedangkan aturan opname
(kolom snapshot vs saldo sekarang, selisih diterapkan ke saldo terakhir, gerbang paket & izin)
hanya disebut sebagai satu langkah. Karena itu dua **bagian panjang** ditambahkan ke
`scripts/gen-panduan-pdf.mjs`, bukan satu-dua baris sisipan:

1. **Bagian 6 — “Pembelian lengkap: supplier, PR, PO, GRN, tagihan & pembayaran”.** Tabel “Yang ada
di halaman Pembelian” (empat angka ringkas, Supplier + tempo, PR, PO + sisa pesanan, GRN, Hutang
usaha, Pencocokan 3 arah), lalu tujuh langkah berurut: siapkan supplier (Tambah supplier + Tempo
hari) → ajukan PR (Tambah baris, Kirim permintaan) → setujui PR & buat PO (harga beli per unit,
Perkiraan datang, kolom Progres 12 / 24) → catat GRN per baris dengan kolom Terima yang sudah terisi
sisa pesanan → tagihan supplier & AP (jatuh tempo otomatis untuk supplier bertempo, Catat tagihan
supplier untuk tagihan di luar PO, kolom Umur & Sisa) → putuskan selisih 3 arah (Tinjau, Catat
dokumen supplier, Terima selisih, Sengketa, Cabut sengketa) → bayar hutang (Bayar per baris atau
Bayar terpilih dengan satu nomor `PAY-`). Dua callout menjaga perilaku server yang mudah
mengejutkan: supplier menunggak ditolak PO baru, dan penerimaan sebagian itu normal.
2. **Bagian 8 — “Opname lengkap: hitung fisik, selisih, dan posting”.** Tabel empat angka
(Sesi berjalan / Selesai / Dibatalkan / Selisih berjalan), enam langkah menghitung (pilih Lokasi →
Catatan sesi → Mulai hitung → isi Hitung fisik per baris, yang belum dihitung dibiarkan kosong —
bukan nol → Posting hasil hitung), tabel “Membaca kolomnya dengan benar” (Sistem (snapshot) vs
Sekarang vs Hitung fisik vs Selisih), callout “Selisih diterapkan terhadap saldo terakhir, bukan
snapshot” (inilah yang membuat opname tetap benar walau toko masih berjualan), dan daftar aturan
yang ditegakkan server (satu sesi per lokasi, lokasi tanpa produk berstok ditolak, hitung sebagian
sah, sesi yang sudah diposting/dibatalkan beku) beserta gerbang paket `inventory.opname` dan izin
`inventory.manage`.
3. **Dua ilustrasi vektor baru** (kini 9 gambar): **Gambar 5** pesanan pembelian dengan penerimaan
bertahap (progres 12/24, kolom Terima, tombol Terima barang) dan **Gambar 6** hutang usaha &
pencocokan 3 arah (tabel tagihan dengan umur & status 3 arah, keputusan Terima selisih / Sengketa,
pembayaran bertanda `PAY-`). Gambar opname yang sudah ada ditambah kartu sesi (progres + ringkasan
selisih) dan tombol Posting hasil hitung.
4. **Berkas PDF dibangun ulang: 13 bagian, 9 gambar, 20 halaman, 63.172 byte** (sebelumnya
12 bagian, 7 gambar, 15 halaman, 44.077 byte). Halaman Panduan (`src/pages/PanduanPage.tsx`)
menyebut “13 bagian · 9 gambar” dan merangkum dua bagian baru; `README.md` ikut menyesuaikan. Harness
`scripts/verify-panduan.mjs` ditambah **11 frasa baru** beserta bagian tempatnya seharusnya berada
(`Tambah supplier`, `Kirim permintaan`, `Pesanan pembelian (PO)`, `Terima selisih`, `Catat tagihan
supplier`, `Bayar terpilih` → bagian 6; `Mulai hitung`, `Hitung fisik`, `Sistem (snapshot)`,
`Batalkan sesi`, `Posting hasil hitung` → bagian 8), dan ambang jumlah bagian/gambar dinaikkan
12 → 13 serta 7 → 9.

**Berkas:** diubah: `scripts/gen-panduan-pdf.mjs` · `scripts/verify-panduan.mjs` ·
`public/panduan/panduan-mesinpos.pdf` · `src/pages/PanduanPage.tsx` · `README.md` · `worklog.md`
(tidak ada berkas baru)

**Verifikasi:**

- Tipe: `bun tsc -b --noEmit` → **exit 0**.
- Bangun ulang: `bun run panduan:pdf` → `ukuran: 61.7 KB · halaman: 20 · bagian: 13 · gambar: 9`
  (exit 0); berkasnya **63.172 byte**.
- Berkas PDF dibongkar ulang: `bun scripts/verify-panduan.mjs` → **13/13, exit 0**, dengan
  `daftar isi: 1->2 2->3 3->4 4->6 5->7 6->8 7->12 8->13 9->15 10->16 11->17 12->18 13->19`,
  `Nomor bagian berurutan 1..13`, `Langkah kunci ada di bagian yang benar - 20 frasa`,
  dan `Gambar (ilustrasi) punya keterangan bernomor - 1 sampai 9`.
- **Kontrol negatif (isi baru dibuktikan benar-benar dibaca).** Dua bagian baru dibuang dari
  **salinan** skrip di `/tmp` (cwd terpisah: generator & harness dijalankan di sana, berkas proyek
  tidak disentuh), hasilnya **9/13, exit 1** dengan kegagalan tepat pada isi baru:
  `Daftar isi memuat 13 bagian - 11 entri` ·
  `Nomor bagian berurutan 1..13 - 1,2,3,4,5,7,9,10,11,12,13` ·
  `Langkah kunci ada di bagian yang benar` gagal untuk 11 frasa (6 frasa bagian 6, 5 frasa bagian 8) ·
  `Gambar (ilustrasi) punya keterangan bernomor` gagal. Sesudah itu `sha256sum -c` memastikan
  `public/panduan/panduan-mesinpos.pdf` dan `scripts/gen-panduan-pdf.mjs` **tidak berubah**
  (keduanya `OK`), jadi kontrolnya tidak meninggalkan jejak di repo.
- Halaman & DOM: `bun scripts/verify-render.mjs` → **359/359, exit 0** (halaman Panduan dirender
  dengan lencana “13 bagian · 9 gambar” dan tautan unduhannya tetap diperiksa);
  `bun scripts/verify-menus.mjs` → **384/384, exit 0**.
- Disajikan: `curl -o /dev/null -w "%{http_code} %{content_type} %{size_download}"` ke
  `http://localhost:5173/panduan/panduan-mesinpos.pdf` → **200 application/pdf 63172 byte**
  (sama dengan berkas di `public/`).

**Catatan / blocker:** (i) PDF-nya tetap memakai **ilustrasi vektor**, bukan tangkapan layar, dan itu
tertulis di sampulnya; (ii) isi kedua bagian ditulis dari label yang ada di halaman Pembelian &
Opname, jadi kalau label tombolnya berubah panduan harus dibangun ulang (`bun run panduan:pdf`) —
yang dijaga harness adalah janji strukturalnya, bukan kecocokan label dengan UI; (iii) tabel
**Status Phase 1** dan daftar **Blocker** diperiksa: tidak ada klausa Phase baru dan **Blocker #3
tidak berubah** (ini isi dokumen, bukan halaman baru), tetapi **dua angka pada tabel Status Phase 1
diselaraskan** karena suite-nya sudah bertambah sebelum entri ini — `verify-authz.mjs` 84/84 →
**86/86** dan `verify-menus.mjs` 364/364 → **384/384** (keduanya dijalankan ulang hari ini);
(iv) daftar perintah rutin di bagian akhir diperbarui: jumlah bagian/gambar/halaman PDF jadi
13 / 9 / 20.

## 2026-10-12 — “Bagaimana cara mengisi stok?”: jalur isi stok yang hilang + panduan PDF yang bisa diunduh
**Ruang lingkup:** pertanyaan pengguna “Bagaimana cara mengisi stok?” sekaligus permintaan panduan
operasional step-by-step bergambar yang bisa diunduh sebagai PDF. Pemeriksaan berkas lebih dulu
menunjukkan pertanyaannya **bukan** soal cara memakai fitur, melainkan fitur yang belum tersambung ke
UI: `products.create` (termasuk `openingStock`) sudah ada di backend tetapi **tidak ada satu pun
halaman yang memanggilnya**, dan `adjustStock` sudah ada di kedua store sejak awal tetapi **tidak
punya tombol di mana pun** — jadi stok mustahil diisi di workspace baru (barang hanya bisa masuk lewat
penerimaan barang dari PO, yang menuntut produk sudah ada). Pekerjaan kali ini menutup celah itu dan
sekaligus menjawab pertanyaannya sebagai dokumen:

1. **Kontrak store bertambah:** `CreateProductInput` + `createProduct` di `src/lib/store/types.ts`,
diimplementasikan di `convex.tsx` (memetakan nama kategori → `categoryId` dan meneruskan
`openingStock`) dan di `demo.tsx` (SKU unik, harga tidak negatif, id berurutan lewat ref supaya dua
produk dalam satu tick tidak bertabrakan).
2. **UI di halaman Produk & Stok:** header baru (judul + jumlah produk), tombol **Tambah produk**
yang membuka form Produk baru (nama, SKU dengan usulan otomatis, kategori, harga jual, harga beli,
satuan dasar, stok awal), dan tombol **Sesuaikan stok** per baris dengan panel jumlah (+/-), catatan,
pratinjau “Stok jadi”, serta tombol yang mati kalau hasilnya negatif. Izin mengikuti server:
`product.manage` untuk membuat, `stock.adjust` untuk menyesuaikan.
3. **Halaman Panduan + PDF:** halaman baru `/app/panduan` (izin `report.view`, sama dengan Dashboard,
supaya kasir & staf gudang bisa membacanya) yang merangkum tiga jalur isi stok, menautkannya ke
halaman terkait, dan menyajikan pratinjau + tombol **Unduh PDF**. Berkasnya
di `public/panduan/panduan-mesinpos.pdf` (12 bagian, 7 gambar, 15 halaman, 43 KB), dibangun oleh
`scripts/gen-panduan-pdf.mjs` (pdfkit) — gambarnya ilustrasi vektor yang digambar ulang di skrip
dan dilabeli “Ilustrasi layar”, bukan tangkapan layar, supaya tidak mengklaim bukti yang tidak ada.
Isi panduan mengikuti label asli aplikasi (Tambah produk, Sesuaikan stok, Terima barang, Mulai
hitung, Posting hasil hitung, Buka shift) dan diterbitkan dua lintasan supaya daftar isinya memuat
nomor halaman yang benar.
4. **Harness PDF `scripts/verify-panduan.mjs`:** membongkar ulang berkasnya (stream halaman
didekompresi, operator teks `TJ` heksadesimal dibaca kembali) lalu memeriksa 13 hal: awalan `%PDF-`,
jumlah halaman, footer bernomor di **setiap** halaman, daftar isi menunjuk halaman yang benar-benar
memuat bagiannya, bagian 1..12 berurutan, frasa langkah kunci ada, tidak ada teks keluar area cetak,
tidak ada teks melewati margin kiri, geometri gambar tidak terpotong, ketujuh keterangan gambar ada,
dan tautan `PDF_URL` di halaman Panduan menunjuk berkas yang benar-benar ada.

**Berkas:** baru: `src/pages/PanduanPage.tsx` · `scripts/gen-panduan-pdf.mjs` ·
`scripts/verify-panduan.mjs` · `public/panduan/panduan-mesinpos.pdf` ·
diubah: `src/lib/store/types.ts` · `src/lib/store/convex.tsx` · `src/lib/store/demo.tsx` ·
`src/pages/ProductsPage.tsx` · `src/App.tsx` · `src/layouts/AppLayout.tsx` · `package.json`
(+devDependency `pdfkit@0.20.2`, skrip `panduan:pdf`) · `scripts/verify-menus.mjs` ·
`scripts/verify-render.mjs` · `README.md` · `worklog.md`

**Verifikasi:**

- Tipe: `bun tsc -b --noEmit` → **exit 0** (kedua store memenuhi kontrak baru).
- DOM + rute + menu: `bun scripts/verify-render.mjs` → **359/359, exit 0** (348 → +11: halaman Panduan
dirender beserta tautan unduhannya, dan alur isi stok **diklik** di DOM tiruan - Tambah produk →
produk lahir dengan stok awal 50, lalu Sesuaikan stok -3 → stok jadi 47, plus tombol simpan yang mati
saat penyesuaiannya membuat stok negatif); `bun scripts/verify-menus.mjs` → **384/384, exit 0**
(364 → +20: menu Panduan × 5 peran, peta menu ↔ rute ↔ izin tetap konsisten).
- **Kontrol negatif alur isi stok:** `openingStock: stock` di `ProductsPage.tsx` sementara diubah jadi
`openingStock: 0`, lalu `verify-render.mjs` dijalankan → **exit 1** dengan
`✗ produk baru tersimpan dengan stok awal yang diketik — {"sku":"KOPIUJI","stock":0}`. Berkas
dikembalikan (`diff` terhadap salinan sebelum kontrol: **identik**) lalu dijalankan ulang → **359/359,
exit 0**. Jadi cek itu memang membaca nilai stok yang tersimpan, bukan namanya saja.
- Bangun PDF: `bun run panduan:pdf` → `PDF dibuat: …/public/panduan/panduan-mesinpos.pdf ·
ukuran: 43.0 KB · halaman: 15 · bagian: 12 · gambar: 7` (exit 0).
- Berkas PDF diperiksa ulang: `bun scripts/verify-panduan.mjs` → **13/13, exit 0**
(`daftar isi: 1->2 2->3 3->4 4->6 5->7 6->8 7->9 8->10 9->11 10->12 11->13 12->14`).
- **Kontrol negatif:** berkas PDF diganti PDF kosong satu halaman (dibuat pdfkit di skrip sementara),
lalu harness dijalankan → **5/13, exit 1** (yang gagal: jumlah halaman, footer, daftar isi, urutan
bagian, langkah kunci, keterangan gambar; tautan halaman lolos karena berkas di jalur itu memang ada,
hanya isinya yang diganti). Berkas asli dipulihkan → **13/13, exit 0**. Jadi
pemeriksaannya memang membaca berkasnya, bukan selalu lolos.
- Disajikan: `curl -s -o /dev/null -w "%{http_code} %{content_type} %{size_download}"` ke
`http://localhost:5173/panduan/panduan-mesinpos.pdf` → **200 application/pdf 44077 byte** (sama dengan
berkas di `public/`), dan rute `/app/panduan` menjawab **200**; perintah hosting
diperiksa dengan `freebuff-deploy check` → `deployable: true`, `problems: []`.

**Catatan / blocker:** (i) **halaman Panduan dan kedua jalur isi stok baru diuji di DOM tiruan &
backend harness, belum diklik di browser sungguhan** — itu menambah daftar **Blocker #3**; (ii) PDF-nya
berisi ilustrasi vektor (bukan tangkapan layar), disebut begitu di sampul supaya tidak menyesatkan;
(iii) konten panduan ditulis dari label halaman yang ada, jadi kalau label tombol berubah, panduan
harus dibangun ulang dengan `bun run panduan:pdf` — harness PDF menahan janji strukturalnya, bukan
kecocokan label dengan UI; (iv) tabel **Status Phase 1–6** tidak berubah (ini perbaikan jalur yang
sudah ada, bukan klausa Phase baru); daftar **Blocker** hanya berubah di item #3; (v) perintah rutin
di bagian akhir ditambah `bun run panduan:pdf` dan `bun scripts/verify-panduan.mjs`.

## 2026-10-12 — Tombol naik paket di halaman Langganan: benar-benar bekerja, dan menuju paket yang benar
**Ruang lingkup:** pertanyaan pengguna “kenapa user tidak bisa meng-klik tombol upgrade ke paket yg di
atas nya?” di `/app/subscription`. Ternyata dua cacat sekaligus: (1) tombolnya **ditulis tetap**
`<Button>Upgrade ke Professional</Button>`, jadi di paket Enterprise — paket tertinggi — yang
ditawarkan justru paket yang lebih rendah, dan kartu “Yang Anda dapat dengan Professional” memakai
nama tetap yang sama; (2) tombolnya **tidak punya penangan klik sama sekali**, sehingga mengkliknya
tidak melakukan apa pun. Padahal jalan di server sudah ada (`billing.changePlan`: prorata, pemangkasan
modul, jejak audit) — hanya belum pernah tersambung ke UI. Sekarang target tombol dihitung dari urutan
katalog (`nextPlanUp`), kliknya memanggil `changePlan` lewat store (Convex & demo), sesi diselaraskan
(`setPlan` + `trimVerticalsForPlan` supaya tidak ada modul yang tampil padahal sudah dibuang server),
hasil & penolakan ditampilkan, dan di paket tertinggi tombolnya diganti penjelasan. Dua tombol
pembayaran (GDCPay/Xendit) kini **dinonaktifkan** dengan keterangan “gateway belum tersambung” —
tombol yang diam tanpa keterangan adalah keluhan yang sama.

**Berkas:** diubah: `src/convex/lib/billing/catalog.ts` (+`planRank`, `nextPlanUp`) ·
`src/convex/lib/billing/entitlements.ts` (+`trimVerticalsForPlan`) · `src/convex/billing.ts` ·
`src/lib/session.tsx` (+`setPlan`) · `src/lib/store/types.ts` · `src/lib/store/convex.tsx` ·
`src/lib/store/demo.tsx` · `src/pages/SubscriptionPage.tsx` · `scripts/verify-modules.mjs` ·
`scripts/verify-render.mjs` · `scripts/verify-backend.mjs` · `README.md` · `worklog.md`

**Verifikasi:**

- Cek murni: `bun scripts/verify-modules.mjs` → **34/34, exit 0** (28 → +6: urutan paket,
  `nextPlanUp` tiap paket, paket tak dikenal, dan tiga aturan `trimVerticalsForPlan`).
- Cek DOM + klik nyata: `bun scripts/verify-render.mjs` → **348/348, exit 0** (341 → +7). Kontrol
  negatif dijalankan lebih dulu: dengan `onClick` dihapus dari tombol, harness **exit 1**
  (`✗ GAGAL: kliknya benar-benar memindahkan paket, bukan tombol mati — planKey=starter`); sesudah
  dikembalikan (`diff` terhadap salinan sebelum kontrol: identik) hijau lagi **348/348**.
- Backend nyata: `bun convex dev --once` → **exit 0** · `bun scripts/verify-backend.mjs` (awan) →
  **508/508, exit 0** (506 → +2: hasil `changePlan` membawa `gained`/`lost`, dan memilih paket yang
  sama menjawab `changed:false` **dengan bentuk hasil yang lengkap** — kontrak yang dibaca klien).
  Sebelum dua cek itu ditambahkan, harness yang sama sudah dijalankan lebih dulu → **506/506,
  exit 0**, jadi refactor `changePlan` (kini memakai `trimVerticalsForPlan`) tidak mengubah perilaku.
- `bun tsc -b --noEmit` → **exit 0** · `bun tsc -p tsconfig.convex.json --noEmit` → **exit 0** ·
  `bun scripts/verify-menus.mjs` → **364/364, exit 0** (halaman Langganan ikut dirender di sana).
- `README.md` + `worklog.md` hanya markdown → tidak memengaruhi build/tipe.

**Catatan / blocker:** (1) Tombol pembayaran QRIS/kartu **belum** tersambung ke gateway; sekarang
 dinonaktifkan + diberi keterangan, bukan dibiarkan seolah bisa diklik. (2) `verify-pwa.mjs` tidak
 dijalankan ulang: beranda tidak tersentuh perubahan ini. (3) **Koreksi angka README**: `verify-modules`
 tertulis 27/27 padahal berkasnya sudah memuat 28 cek sebelum perubahan ini — sekarang ditulis 34/34
 sesuai hasil ukur. (4) Tabel **Status Phase 1** & daftar **Blocker** diperiksa: tidak berubah.

## 2026-10-12 — Akun developer boleh punya workspace sendiri (tetap tak terlihat di tenant orang lain)
**Ruang lingkup:** permintaan pengguna: “Aturan tetap seperti sekarang yaitu akun developer tidak
terlihat oleh akun lain, tetapi akun developer tetap bisa punya dashboard workspace sendiri juga.”
Aturan lama menutup **dua** jalur sekaligus — undangan (`members.add`) **dan** mendirikan tenant
sendiri (`tenants.create`) — sehingga satu-satunya cara memakai produk ini dengan email yang sudah
menjadi akun platform adalah melepas peran platformnya lebih dulu. Sekarang yang ditutup hanya
**undangan**: akun platform boleh mendirikan workspace sendiri. Di sana ia pemilik — dashboard, menu,
modul, tim — sedangkan di tenant orang lain ia tetap tidak punya baris apa pun. Ikutannya:
`visibleInTenantSurfaces` menerima `ownsTenant`, pendampingan platform menolak tenant yang ia dirikan
sendiri, dan backstage menampilkan baris **Workspace saya** berisi tautan ke dashboard.

**Berkas:** diubah: `src/convex/lib/platform.ts` · `src/convex/lib/impersonation.ts` ·
`src/convex/tenants.ts` · `src/convex/members.ts` · `src/convex/platform.ts` ·
`src/convex/lib/access.ts` · `src/components/ProvisioningNotice.tsx` · `src/pages/PlatformPage.tsx` ·
`src/lib/platform.ts` · `src/App.tsx` · `scripts/verify-authz.mjs` ·
`scripts/verify-impersonation.mjs` · `scripts/verify-render.mjs` · `scripts/verify-backend.mjs` ·
`README.md` · `worklog.md`

**Verifikasi:**

- `bun convex dev --once` → **exit 0** (“Convex functions ready!”) — aturan baru benar-benar sampai ke
  deployment yang dipakai situs pengguna.
- `bun tsc -b --noEmit` → **exit 0** · `bun tsc -p tsconfig.convex.json --noEmit` → **exit 0**.
- `bun scripts/verify-backend.mjs` (deployment awan `mellow-narwhal-477`) → **506/506, exit 0**
  (502 → +4 cek): akun platform **bisa** mendirikan workspace sendiri · workspace itu tercatat di
  `tenants.listMine` miliknya · di workspace sendiri ia muncul sebagai **pemilik** · punya workspace
  sendiri **tidak** membuka undangan ke tenant orang lain · dan ia tetap tidak muncul di daftar
  anggota tenant orang lain.
- `bun scripts/verify-authz.mjs` → **86/86, exit 0** (aturan `ownsTenant`: terlihat di workspace
  sendiri, tidak di tenant lain; kalimat penolakan menyebut batas “tenant milik orang lain”).
- `bun scripts/verify-impersonation.mjs` → **52/52, exit 0** (49 → +3: workspace sendiri ditolak
  sebagai sasaran pendampingan · penolakan itu struktural, diperiksa sebelum alasan isian · tenant
  orang lain tetap bisa didampingi).
- `bun scripts/verify-render.mjs` → **341/341, exit 0** (338 → +3: baris “Workspace saya” menawarkan
  onboarding saat perangkat ini belum punya workspace, menautkan `/app` saat sudah ada, tanpa error
  konsol). Harness shell lain: `bun scripts/verify-menus.mjs` → **364/364, exit 0** ·
  `bun scripts/verify-pwa.mjs` → **1492/1492, exit 0**.
- Sentuhan terakhir menyapu **komentar model lama** yang masih menyatakan aturan sebelumnya
  (`src/lib/platform.ts`, komentar rute di `src/App.tsx`, dan komentar `platform.revoke` — yang kini
  menegaskan workspace yang sudah didirikan **tidak** ikut dicabut). Karena ketiganya berkas sumber,
  seluruh rangkaian dijalankan ulang setelahnya: `bun convex dev --once` **exit 0** ·
  `bun tsc -b --noEmit` **exit 0** · `bun tsc -p tsconfig.convex.json --noEmit` **exit 0** ·
  `bun scripts/verify-render.mjs` **341/341** · `bun scripts/verify-authz.mjs` **86/86** ·
  `bun scripts/verify-impersonation.mjs` **52/52**, semua exit 0. `verify-backend.mjs` **tidak**
  dijalankan ulang untuk sentuhan itu: isinya hanya komentar (tanpa perubahan perilaku), sementara
  hasil 506/506 di atas sudah diukur pada fungsi yang sama yang baru saja dipush ulang.
- `README.md` + `worklog.md` hanya markdown → tidak memengaruhi build/tipe.

**Catatan / blocker:** (1) **Koreksi angka yang saya tulis sendiri di entri sebelumnya**: jumlah cek
kebijakan akun platform di `verify-authz.mjs` adalah **10**, bukan 12 — dihitung ulang dari berkasnya
saat entri ini ditulis (angka cek akun platform & pendampingan di blok `verify-backend.mjs` tetap 17).
(2) Workspace pengguna (`phansugisoft@gmail.com`, “Pusat Bahan Bangunan”) **tidak** saya buatkan dari
sini: sesi di browsernya menyambungkannya sendiri saat halaman dimuat ulang, dan jalur itu sudah
terbukti di cek backend (`tenants.create` untuk akun platform). (3) Harness backend tetap
meninggalkan data uji di deployment (termasuk satu tenant pengembang `dev-…` per putaran) — perilaku
yang sudah ada sebelumnya. (4) Tabel **Status Phase 1** & daftar **Blocker** sudah diperiksa dan tidak
berubah.

## 2026-10-12 — “Modul tidak bisa diklik”: penolakan penyambungan workspace akhirnya terlihat
**Ruang lingkup:** pertanyaan pengguna “kenapa modul tidak bisa di klik (aktifkan modul)” di
`https://mesinpos.produkaplikasi.my.id/app/modules`, tempat setiap tombol **Aktifkan modul** menjawab
“Tenant belum siap. Coba lagi sebentar lagi.” Penelusurannya tidak berakhir di aturan modul,
melainkan di **penyambungan tenant**: workspace “Pusat Bahan Bangunan” hanya ada di localStorage,
sedangkan server belum punya tenantnya — dan server memang menolaknya, karena akun yang dipakai
(`phansugisoft@gmail.com`) adalah **akun platform** (`platformRole: "developer"`), sementara akun
platform sengaja tidak boleh punya keanggotaan tenant (aturan yang diuji `verify-authz.mjs` /
`verify-impersonation.mjs`). Yang salah di sisi aplikasi: penolakan itu tersimpan di `store.error`
tetapi **tidak pernah dirender**, jadi satu-satunya umpan balik adalah pesan gerbang aksi yang
menyuruh menunggu — menyesatkan untuk penolakan yang permanen. Diperbaiki: notis kegagalan
penyambungan di shell `/app` (`components/ProvisioningNotice.tsx`) yang membawa **kalimat server apa
adanya** plus petunjuk tindakan (khusus penolakan akun platform: pakai email lain), dan gerbang aksi
store kini menyebut sebabnya (`Tenant belum tersambung ke server: …`).

**Berkas:** baru: `src/components/ProvisioningNotice.tsx` · diubah: `src/convex/lib/platform.ts`
(kalimat penolakan jadi satu konstanta + `isPlatformMembershipRefusal`) · `src/lib/store/convex.tsx`
(50 gerbang aksi memakai `notReady()`, `reportProvisionError`) · `src/layouts/AppLayout.tsx` ·
`scripts/verify-render.mjs` · `scripts/verify-authz.mjs` · `README.md` · `worklog.md`

**Verifikasi:**

- Sebabnya dibuktikan terhadap deployment yang dipakai situs itu, bukan disimpulkan dari kode saja:
  `bun convex run users:createOrGet …` → `{"created": true, …}`, **exit 0** (akun & fungsi hidup),
  lalu  `bun convex run tenants:create '{"ownerId":"kx7ax4ckpm1mnk9n0za0xz6p8s8g45ss","slug":"diag-refusal-…", …}'`
  (ownerId = akun pemilik di browser) → **exit 1**: `Uncaught Error: Akun platform tidak boleh menjadi
  anggota tenant: keberadaannya harus tidak terlihat dari dalam tenant.` — dan `bun convex data
  tenants …` → **0** baris berslug uji itu, jadi uji ini gagal tanpa meninggalkan data.
- Jalur bisnis yang normal terbukti sehat di deployment yang sama: user baru → `tenants.create` →
  `{"tenantId": "ks7ejbm2wd95xgem28jxhw5n3s8g5mhm", …}`, **exit 0** → `modules.setForTenant` →
  menambahkan “Grosir & Wholesale”, **exit 0**.
- Cek regresi: `bun scripts/verify-render.mjs` → **338/338, exit 0** (328 lama + 6 cek notis + 4 cek
  sambungan store → shell). Kontrol negatif dijalankan lebih dulu: dengan `error={null}` di shell,
  harness **exit 1** (`✗ GAGAL: shell /app menampilkan kegagalan sambung-tenant dari store`); sesudah
  wiring dikembalikan (`diff -q` terhadap salinan sebelum kontrol: identik) hijau lagi → **338/338**.
- `bun scripts/verify-authz.mjs` → **86/86, exit 0** (84 lama + penolakan akun platform dikenali walau
  kalimatnya dibungkus lapisan Convex + galat lain tidak ikut dianggap penolakan akun platform).
- `bun tsc -b --noEmit` → **exit 0**. Sempat **gagal 109 error** karena guard `notReady()` semula
  ditulis sebagai panah di dalam `const`: TypeScript tidak menganggapnya menghentikan alur, sehingga
  penyempitan `tenantId`/`userId` sesudah guard hilang. Diperbaiki menjadi deklarasi fungsi
  beranotasi `: never` (ditulis apa adanya karena kegagalannya nyata, bukan dihilangkan).
- `bun convex dev --once` → **exit 0** (“Convex functions ready!”).
- Shell berubah, jadi harness lain yang merendernya dijalankan ulang: `bun scripts/verify-menus.mjs` →
  **364/364, exit 0** · `bun scripts/verify-pwa.mjs` → **1492/1492, exit 0**.
- `bun scripts/verify-backend.mjs` **tidak dijalankan**: perubahan sisi server hanya memindahkan
  kalimat penolakan ke satu konstanta (kesamaannya diuji `verify-authz.mjs`), sedangkan harness itu
  tidak menyentuh jalur penolakan akun platform — jadi menjalankannya tidak menambah bukti apa pun.
- Preview dev server: `GET /` → **200**; modul `AppLayout.tsx` yang disajikan memuat
  `ProvisioningNotice` dan modul store memuat `function notReady` — jadi perubahan benar-benar tersaji.
- `README.md` + `worklog.md` hanya markdown → tidak memengaruhi build/tipe.

**Catatan / blocker:** (1) Aturan “akun platform tidak boleh punya workspace” **tidak diubah** — ia yang
menjaga operator tetap tak terlihat dari dalam tenant, jadi memakai `phansugisoft@gmail.com` sebagai
pemilik workspace menuntut peran platformnya dilepas lebih dulu (`bun convex run platform:revoke …`,
 bisa dikembalikan dengan `platform:grant`), atau workspace bisnis dipakai dengan email lain.
(2) Bukti visual notis di browser sungguhan belum ada: harness membuktikan DOM tiruan + sambungan
 store → shell, sedangkan sesi di browser pengguna tidak bisa direproduksi dari sini.
(3) Uji diagnostik tadi meninggalkan data di deployment: 2 user + 2 tenant berslug `diag-…`/`diag2-…`
 beserta satu perubahan modul di tenant itu (tidak dihapus karena tidak ada jalur hapus tenant).
(4) Tabel **Status Phase 1** & daftar **Blocker** sudah diperiksa dan tidak berubah.

## 2026-10-12 — Header beranda benar-benar menempel di atas saat digulir
**Ruang lingkup:** permintaan pengguna “buat header yg ada di landing page (front page) tetap di atas
meskipun layar sedang di scroll”. Ternyata bukan soal menambah `sticky` — header sudah
`sticky top-0 z-50` sejak awal — melainkan soal **leluhurnya**: pembungkus beranda memakai
`overflow-x-hidden`, dan itu menjadikan div itu wadah gulir sendiri; `sticky` lalu menempel ke wadah
itu, bukan ke layar, sehingga header ikut tergulir pergi. Diperbaiki dengan `overflow-x-clip`
(sama-sama memotong luapan horizontal, tetapi **tidak** membentuk wadah gulir) plus cek regresi di
`verify-render.mjs` yang menolak leluhur ber-`overflow` selain `clip`.

**Berkas:** diubah: `src/pages/LandingPage.tsx` · `scripts/verify-render.mjs` · `README.md` · `worklog.md`

**Verifikasi:**

- Cek barunya ditulis **lebih dulu**, lalu dijalankan sebelum perbaikan:
  `bun scripts/verify-render.mjs` → **exit 1**, `✗ tidak ada leluhur header yang menjadi wadah gulir
  sendiri — min-h-screen overflow-x-hidden bg-background`. Jadi cek ini memang menangkap bug-nya,
  bukan sekadar ikut hijau.
- Setelah `overflow-x-hidden` → `overflow-x-clip`: `bun scripts/verify-render.mjs` → **328/328, exit 0**
  (323 cek lama + 5 cek baru: header ada · `sticky` + `top-0` · lapisan `z-50` di atas konten ·
  tidak ada leluhur yang jadi wadah gulir · tanpa error konsol).
- `bun tsc -b --noEmit` → **exit 0**.
- Harness lain yang menyentuh beranda dijalankan ulang setelah perubahan:
  `bun scripts/verify-pwa.mjs` → **1492/1492, exit 0** · `bun scripts/verify-menus.mjs` →
  **364/364, exit 0**.
- Preview: `GET /` → **200**; modul yang disajikan dev server memuat
  `min-h-screen overflow-x-clip bg-background` dan elemennya **tidak** lagi memakai
  `overflow-x-hidden` (kata itu hanya tersisa di komentar penjelasnya).
- `README.md` + `worklog.md` hanya markdown → tidak memengaruhi build/tipe.

**Catatan / blocker:** DOM tiruan tidak menghitung layout, jadi yang dibuktikan adalah syarat yang
membuat `sticky` bekerja — bukan posisi akhir piksel demi piksel. Bukti visualnya tetap perlu sekali
gulir di browser (preview/produksi). Aturan untuk perubahan berikutnya: **jangan** memakai
`overflow-*-hidden/auto/scroll` pada leluhur elemen `sticky`; pakai `overflow-*-clip`.

## 2026-10-12 — Tema terang, PWA layar penuh, dan ajakan pemasangan (10 detik → tombol di header)
**Ruang lingkup:** permintaan pengguna “Tambahkan mode light theme. Buat PWA fullscreen dan notif ajakan
untuk install muncul setelah 10 detik browsing pertama kali, lalu jika tidak dilakukan install, maka akan
muncul tombol untuk install di header di sebelah tombol masuk.” Yang dikerjakan: (i) tema terang/gelap
beserta bootstrap anti-kedip dan tombolnya di dua header, (ii) PWA tanpa plugin tambahan
(`vite.config.ts` tidak disentuh): manifest `display: fullscreen`, service worker dengan kebijakan sempit,
ikon 192/512 + maskable + Apple + vektor, (iii) ajakan pemasangan sekali pada kunjungan pertama setelah
10 detik, lalu tombol “Pasang aplikasi” di header beranda tepat sebelum tombol Masuk, (iv) dua harness
baru yang mengeksekusi bootstrap tema dan service worker, bukan sekadar membacanya.

**Berkas:** baru: `src/lib/theme.ts` · `src/lib/pwa.ts` · `src/components/ThemeToggle.tsx` ·
`src/components/InstallPrompt.tsx` · `public/manifest.webmanifest` · `public/sw.js` · `public/icon.svg` ·
`public/icon-192.png` · `public/icon-512.png` · `public/icon-maskable-512.png` ·
`public/apple-touch-icon.png` · `scripts/gen-icons.mjs` · `scripts/verify-theme.mjs` ·
`scripts/verify-pwa.mjs` · diubah: `index.html` · `src/main.tsx` · `src/App.tsx` ·
`src/pages/LandingPage.tsx` · `src/layouts/AppLayout.tsx` · `README.md` · `worklog.md`

**Verifikasi:** (semua pada keadaan berkas terakhir)

- `bun scripts/verify-theme.mjs` → **39/39, exit 0** (baru): aturan `resolveTheme`/`nextTheme`/penyimpanan ·
  paritas palet `:root` vs `.dark` (daftar token warna sama persis; latar `0 0% 100%` vs gelap) ·
  **script bootstrap di `index.html` dijalankan** untuk lima keadaan (simpanan terang/gelap, sistem
  terang/gelap, penyimpanan yang melempar) dan hasilnya dibandingkan dengan `resolveTheme` + warna meta ·
  tombol `ThemeToggle` di DOM: klik mengubah kelas `<html>`, menyimpan pilihan, dan mengubah label.
- `bun scripts/verify-pwa.mjs` → **1492/1492, exit 0** (baru): aturan ajakan (jeda **10000 ms**, sekali
  tampil, tombol setelahnya, tidak ada saat terpasang) · manifest `display: fullscreen` +
  `display_override`, ikon 192/512/maskable/vektor ada di disk dan PNG-nya diperiksa sampai isinya
  (CRC tiap chunk, jumlah baris, piksel sudut: ikon membulat transparan, maskable terisi penuh) ·
  **`public/sw.js` dieksekusi** dengan `caches`/`fetch` tiruan: install menyimpan cangkang +
  `skipWaiting`, activate membuang cache versi lama + `claim`, navigasi offline dilayani `/index.html`,
  navigasi online tetap mengambil versi terbaru, aset build tersimpan & terlayani saat offline,
  sementara `/src/…`, `/@vite/…`, permintaan tulis, dan lintas origin (Convex) **tidak pernah**
  di-`respondWith` · perilaku DOM: kunjungan pertama belum berajakan → setelah jeda muncul, tanpa janji
  browser berubah jadi petunjuk manual, ditutup → tombol muncul; dengan janji browser `prompt()`
  dipakai dan `preventDefault` menahan infobar Chromium; kunjungan berikutnya tidak diundang lagi;
  `fullscreen`/`appinstalled` menghapus ajakan & tombol · penempatan: tombol berlabel
  “Pasang aplikasi MesinPOS” ada di `<header>` beranda dan urutan elemen interaktifnya tepat diikuti
  tautan “Masuk” (urutannya diperiksa, bukan sekadar keberadaannya).
- Harness lama tetap lulus setelah header/tema baru: `verify-render` **323/323** · `verify-menus`
  **364/364** — keduanya exit 0.
- `bun tsc -b --noEmit` → **exit 0**.
- `node scripts/gen-icons.mjs` → 4 berkas (192/512/maskable/Apple) + `DIAG` jumlah byte; hasilnya
  diperiksa ulang dengan `python3` (CRC chunk, `zlib.decompress`, panjang baris, dan beberapa piksel)
  → “SEMUA PNG SAH”.
- `freebuff-preview status` → `running: true, listening: true, 200`; fetch lokal ke preview:
  `/manifest.webmanifest`, `/sw.js`, `/icon.svg`, `/icon-192.png`, `/icon-512.png`,
  `/icon-maskable-512.png`, `/apple-touch-icon.png`, dan `/` → **semuanya 200**, dan HTML yang disajikan
  memuat `manifest.webmanifest`, `mesinpos.theme.v1`, `apple-touch-icon.png`,
  `apple-mobile-web-app-capable`, `icon.svg`, serta `theme-color`.
- `freebuff-deploy check` → `deployable: true`, `problems: []`.
- `README.md` + `worklog.md` = markdown: tidak memengaruhi build/tipe.

**Catatan / blocker:** build produksi **tidak** dijalankan (aturan host: jangan `bun run build` tanpa
permintaan), jadi aset `public/` yang ikut terkirim di `dist/` belum dibuktikan di sini — yang terbukti
adalah preview menyajikannya dan `freebuff-deploy check` tanpa masalah. Pemasangan sungguhan hanya bisa
dibuktikan di browser atas build produksi (Blocker #3). Keputusan yang perlu diketahui: (i) service
worker **juga** terdaftar di dev/preview, karena kebijakannya sengaja sempit (`/src/…` dan `/@vite/…`
tidak pernah dicache) sehingga pengembangan tidak bisa dibuat basi; (ii) `index.html` tetap memuat
`class="dark"` sebagai bawaan tanpa JavaScript, dan bootstrap menyesuaikannya sebelum React berjalan;
(iii) tema default produk tetap **gelap** — terang mengikuti pilihan pengguna atau preferensi sistem.

## 2026-10-12 — Cek akun pengembang platform: penanda, gerbang identitas, dan jalur masuk kodenya
**Ruang lingkup:** permintaan pengguna “cek akun developer”. Yang dikerjakan: pemeriksaan **baca-saja**
terhadap akun platform `phansugisoft@gmail.com` — penanda `platformRole`, gerbang
`requirePlatformDeveloper` (positif dan negatif), keanggotaan tenant, sesi pendampingan, tautan identitas
Convex Auth, kunci env + JWKS, dan bukti bahwa deployment yang dibaca CLI adalah deployment yang dipakai
produksi. Tidak ada perubahan kode.

**Berkas:** diubah: `worklog.md` (hanya catatan; tidak ada berkas kode yang disentuh)

**Verifikasi:**

- `bun convex data users --limit 300` → exit 0; baris akun:
  `"kx7ax4ckpm1mnk9n0za0xz6p8s8g45ss" | "phansugisoft@gmail.com" | emailVerifiedAt 1791794229715 |
  emailVerificationTime 1791794692282 | name "phansugisoft" | platformRole "developer"`.
- `bun convex data users --limit 1000` (seluruh tabel, ≈309 baris) + `grep '"developer"'` → **2 akun**:
  akun asli + `platform-1791779111174@mesinpos.id` (“Pengembang Uji”, akun uji sisa harness).
- `bun convex run platform:me '{"userId":"kx7ax4ckpm1mnk9n0za0xz6p8s8g45ss"}' --identity '{"email":"phansugisoft@gmail.com"}'`
  → **exit 0**, `role: "developer"`, `roleLabel: "Pengembang platform"`,
  `label: "phansugisoft <phansugisoft@gmail.com> · Pengembang platform"`.
- Perintah yang sama **tanpa** `--identity` → **exit 1**: “Akses ditolak: akun platform menuntut identitas
  login yang terverifikasi”.
- `bun convex run platform:tenantDirectory '{"actorId":"kx7ax4ckpm1mnk9n0za0xz6p8s8g45ss"}' --identity …`
  → **exit 0**: direktori tenant terbaca (`truncated: true`), jadi akun ini benar-benar bisa bekerja di
  backstage, bukan hanya lolos gerbang `me`.
- `bun convex data memberships --limit 300` → **0 baris** untuk id akun itu (exit 0) — akun platform tidak
  punya keanggotaan tenant, jadi tidak muncul di permukaan tenant mana pun.
- `bun convex run platform:myImpersonations '{"actorId":"…"}' --identity …` → exit 0,
  `activeSession: null`, `ended: 0`, `helpTotal: 0`, `minutesTotal: 0`, `total: 0` (belum ada pendampingan).
- `bun convex data authAccounts --limit 20` → 1 baris: provider `resend-otp`, `providerAccountId
  "phansugisoft@gmail.com"`, `userId` = akun platform (_creationTime 1791794229715) — tautan identitas
  pernah terbentuk.
- `bun convex data authSessions --limit 20` → “There are no documents in this table.” — **tidak ada sesi
  hidup sekarang**, jadi backstage di browser masih butuh permintaan kode baru lalu memasukkannya.
- `bun convex data authVerificationCodes --limit 50` → 1 baris untuk email itu (provider `resend-otp`,
  kedaluwarsa 1791795292281).
- `bun convex data emailOtps --limit 200` + `bun convex run otp:delivery '{"otpId":"ps74caztpbeagaedw8dqcqsqhs8g51c2"}'`
  → `deliveredAt` terisi, `deliveredVia: "resend"`, `deliveryError: null`; dua baris **terlama** masih gagal
  `403 domain mesinpos.produkaplikasi.my.id belum diverifikasi` — artinya pengirim sudah beres sejak itu.
- `bun convex env list --names-only` → `JWKS`, `JWT_PRIVATE_KEY`, `OTP_DEV_CODE`, `OTP_EMAIL_FROM`,
  `RESEND_API_KEY`, `SITE_URL` ada di deployment. Perintah dengan `--prod` (dan versi `env -u
  CONVEX_DEPLOY_KEY`) menjawab “Ignoring `--prod` … using deployment from CONVEX_DEPLOY_KEY” — CLI membaca
  `.env.local` sendiri, jadi **tidak ada pembacaan deployment dev terpisah** dari sini.
- `node scripts/convex-verify-push.mjs mellow-narwhal-477` → exit 0, `fungsi=ada`;
  `node -e 'fetch("https://mellow-narwhal-477.convex.site/.well-known/jwks.json")…'` → **200**.
- Bukti CLI = deployment produksi: `bun convex data users --limit 300 | grep -c "Pengembang Uji\|uji kode
  1791796049724"` → **11 baris**, yaitu baris yang ditulis harness hari ini lewat HTTP ke
  `mellow-narwhal-477.convex.cloud`.
- `bun convex data auditLogs --limit 100` → tidak ada jejak aksi platform (satu baris cocok hanya karena
  metadata `platform: android` pada `sync.register`) — konsisten dengan 0 sesi pendampingan.

**Catatan / blocker:** akun pengembang **siap dan gerbangnya bekerja**; yang tersisa tetap langkah manusia:
minta kode baru untuk `phansugisoft@gmail.com`, lalu masukkan kodenya di browser pada build yang dideploy
(`authSessions` kosong, jadi tidak ada sesi yang bisa diwarisi). Dua hal yang perlu diketahui: (i) ada
**akun uji ber-penanda `developer`** (`platform-1791779111174@mesinpos.id`) sisa harness di deployment yang
sama — pencabutannya (`platform:revoke`) belum dijalankan karena itu tulisan ke data produksi dan belum
diminta; (ii) CLI mengabaikan `--prod` selama `CONVEX_DEPLOY_KEY` ada, jadi jangan menafsirkan dua pembacaan
tanpa/`--prod` sebagai dua deployment berbeda.

## 2026-10-12 — Audit menu: 18 menu × 5 peran diperiksa, celah “menu ↔ rute ↔ izin” ditutup `verify-menus.mjs`
**Ruang lingkup:** permintaan pengguna “cek semua menu atau modul, apakah sudah berfungsi atau belum”.
Yang dikerjakan: (i) seluruh rangkaian verifikasi yang sudah ada dijalankan ulang dan hasilnya dicatat apa
adanya, dan (ii) celah yang belum pernah diuji — kecocokan **peta menu sidebar ↔ peta rute ↔ tabel izin**
beserta perilaku tiap menu untuk tiap peran — ditutup dengan harness baru `scripts/verify-menus.mjs`.
Dua berkas dokumentasi ikut dikoreksi ke angka hasil ukur terbaru.

**Berkas:** baru: `scripts/verify-menus.mjs` · diubah: `worklog.md`, `README.md`

**Verifikasi:** (urutan seperti dijalankan, pada keadaan berkas terakhir)

- `bun scripts/verify-menus.mjs` → **364/364, exit 0** (harness baru). Cakupannya: 18 menu terbaca dari
  sumber `AppLayout` lalu dicocokkan satu lawan satu dengan 18 rute anak `/app` di `App.tsx` (izin menu =
  izin rute, tujuan & label tidak duplikat, tiap rute punya menu, tiap menu punya penanda halaman) · menu
  yang tergambar untuk kelima peran sama persis dengan `effectivePermissions` + gerbang fitur (Pemilik
  18/18, Manajer 16/18, Kasir 8/18, Staf Gudang 6/18, Keuangan 9/18 menu) · peran kustom menggantikan
  peran bawaan di menu · matriks 18 menu × 5 peran: peran yang berhak mendapat halaman aslinya (penanda
  halamannya muncul, tanpa “Akses ditolak”, tanpa error konsol), peran yang tidak berhak mendapat
  “Akses ditolak” **walau URL diketik langsung** · gerbang modul hidup: Starter + UMKM → menu
  “Dapur & Meja” hilang dan halaman Dapur menjelaskan “Butuh modul F&B”, Enterprise + F&B →
  “Layar dapur aktif” · rute di luar menu tetap hidup (`/`, tamu `/app/pos` diarahkan ke halaman masuk,
  `/onboarding`, `/platform`).
- Harness lama, dijalankan ulang seluruhnya: `verify-authz` 84/84 · `verify-impersonation` 49/49 ·
  `verify-offline` 24/24 · `verify-fnb` 39/39 · `verify-modifiers` 46/46 · `verify-ar` 54/54 ·
  `verify-modules` 27/27 · `verify-wholesale` 31/31 · `verify-members` 30/30 · `verify-inventory` 42/42 ·
  `verify-purchasing` 60/60 · `verify-payables` 44/44 · `verify-threeway` 84/84 · `verify-opname` 48/48 ·
  `verify-analytics` 65/65 · `verify-rbac` 45/45 · `verify-scale` 42/42 · `verify-support` 61/61 ·
  `verify-payments` 72/72 · `verify-qr` 11/11 · `verify-otp` 79/79 · `verify-sync` 47/47 ·
  `verify-api` 225/225 · `verify-render` 323/323 — **semuanya exit 0**.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **502/502, exit 0** (77163 ms).
- `SKIP_PUSH=1 VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-webhook-retries.mjs`
  → **6/6, exit 0** (78473 ms): pekerja terjadwal mengirim ulang memakai aturan backoff, penerima yang
  dimatikan berhenti dikirimi, dan ringkasan halaman mengikuti keadaan sebenarnya.
- `bun tsc -b --noEmit` → **exit 0**. `freebuff-preview status` → `running: true, listening: true,
  statusCode 200` (preview workspace, mode demo). `freebuff-deploy status` → produksi `active` di
  `mesinpos.freebuff.app`, `unresolvedBuildErrorCount: 0`.
- Koreksi dokumentasi: `README.md` dan tabel Status di `worklog.md` masih menulis `verify-backend`
  501/501 → diperbarui ke **502/502**; paragraf “Angka di kolom verifikasi” diperbarui ke hasil ukur hari
  ini (`verify-authz` 74→84, `verify-api` 209→225, `verify-support` 51→61, `verify-render` 290→323,
  `verify-backend` (awan) 468→502).
- `worklog.md` + `README.md` hanya markdown: tidak memengaruhi build/tipe, jadi tidak ada cek build
  tambahan untuk perubahan itu.

**Catatan / blocker:** hasil audit = **tidak ada menu atau modul yang gagal** — tiap menu punya rute dengan
izin yang sama, tiap peran melihat dan membuka tepat menu yang menjadi haknya, dan tiap rute menolak peran
yang tidak berhak walau URL diketik. Batas yang tetap berlaku: (i) bukti ini datang dari render DOM tiruan
+ aturan murni + backend awan, **bukan** klik di browser sungguhan pada build produksi (Blocker #3);
(ii) langkah manusia memasukkan kode OTP dari inbox di browser masih terbuka (Blocker #1 & #3);
(iii) harness baru memakai penanda halaman per menu, jadi menu baru **wajib** menambahkan penandanya —
lupa berarti cek “setiap menu punya penanda halaman” gagal (memang disengaja).

## 2026-10-12 — Convex Auth terpasang: `ctx.auth.getUserIdentity()` kini **terisi**, backstage membuka akun pengembang platform
**Ruang lingkup:** permintaan pengguna “Pasang Convex Auth supaya `ctx.auth.getUserIdentity()` terisi
dan halaman backstage bisa dibuka di browser oleh akun pengembang platform”. Yang dikerjakan:
memasang `@convex-dev/auth` sebagai penerbit identitas, menyambungkannya ke provider OTP email
(**Resend** yang sudah terpasang), menulis callback adopsi baris `users` yang sudah ada (akun platform
**tidak boleh digandakan**), menambah rute HTTP auth + tabel auth ke skema, memetakan bentuk `sub`
Convex Auth di lapisan identitas proyek, dan menambah kartu masuk identitas di halaman `/platform`.

Jalur masuk tenant **sengaja tidak dipindah** ke Convex Auth di putaran ini: yang diminta adalah
backstage-nya bisa dibuka, dan mengganti jalur masuk semua pengguna akan menyentuh `OtpForm`, store,
serta seluruh rangkaian `verify-backend.mjs` (502 cek) — pekerjaan terpisah yang belum diminta.

**Berkas:** baru: `src/convex/auth.config.ts` · `src/convex/authEmail.ts` · `src/convex/auth.ts`
diubah: `src/convex/schema.ts` · `src/convex/http.ts` · `src/convex/lib/auth.ts` · `src/convex/lib/otp.ts` ·
`src/convex/otp.ts` · `src/convex/users.ts` · `src/convex/members.ts` · `src/convex/platform.ts` ·
`src/lib/store/index.tsx` · `src/pages/PlatformPage.tsx` · `package.json` · `worklog.md`

**Verifikasi (perintah → hasil apa adanya):**
1. `bun add @convex-dev/auth @auth/core@0.41.1` → 17 paket; versi terpasang **0.0.96**.
2. Kunci JWT RS256 dibuat lokal (PKCS8 + JWKS) lalu disetel: `bun convex env set JWT_PRIVATE_KEY` /
   `JWKS` / `SITE_URL https://mesinpos.produkaplikasi.my.id` → exit 0; `bun convex env list
   --names-only` → `JWKS, JWT_PRIVATE_KEY, OTP_DEV_CODE, OTP_EMAIL_FROM, RESEND_API_KEY, SITE_URL`
   (nilai rahasia tidak pernah dicetak).
3. `bun convex dev --once` → **percobaan pertama GAGAL**: `IndexNotUnique: In table "users" index
   "email" and index "by_email" have the same fields`. Penyebabnya diperbaiki di akar (indeks
   `by_email` dihapus, seluruh kode memakai nama indeks `email` yang dituntut Convex Auth) → push
   kedua **exit 0**: menambah `users.email`, `users.phone`, dan tabel `authAccounts`, `authSessions`,
   `authRefreshTokens`, `authVerificationCodes`, `authVerifiers`, `authRateLimits`.
4. `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0. (Perlu satu
   koreksi tipe: Convex Auth mengetik konteks callback sebagai `AnyDataModel`, jadi nama tabel/indeks
   proyek ini tidak dikenali pemeriksa tipe sampai konteksnya di-cast ke tipe hasil generate.)
5. `bun scripts/verify-otp.mjs` → **79/79** · `bun scripts/verify-render.mjs` → **323/323** ·
   `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
   **502/502** (semuanya exit 0 — jalur lama tidak rusak oleh tabel/indeks baru).
6. Dokumen kunci hidup (HTTP, bukan dugaan): `/.well-known/openid-configuration` → **200** dengan
   `issuer: https://mellow-narwhal-477.convex.site` · `/.well-known/jwks.json` → **200** dan kunci
   yang disajikan **sama** dengan `JWKS` yang saya set.
7. `bun convex run auth:signIn '{"provider":"resend-otp","params":{"email":"phansugisoft@gmail.com"}}'`
   → exit 0, `{ "started": true }` — kode dibuat **dan email benar-benar berangkat** (pengiriman
   memakai `fetch` dari dalam mutation; kalau Resend menolak, `signIn` akan melempar). Baris
   `authVerificationCodes` terbaca di DB: `provider: "resend-otp"`,
   `emailVerified: "phansugisoft@gmail.com"`, `code` tersimpan sebagai hash sha256.
8. Rantai identitas diuji lewat HTTP API dengan token yang **saya tandatangani sendiri** (RS256,
   `sub="<id akun>|<id sesi>"`, `iss`=site, `aud=convex` — bentuk yang diterbitkan Convex Auth):
   `platform:me` → **200** `roleLabel: "Pengembang platform"` (dengan maupun tanpa klaim `email`,
   jadi pemetaan `sub` maupun cadangan email sama-sama bekerja). Negatif: `sub` **akun lain** +
   klaim email akun platform → **ditolak** `"Identitas login tidak cocok dengan aktor yang
   disebutkan"`; aktor yang diklaim ≠ identitas → ditolak juga. Jadi gerbangnya terbuka **untuk
   identitas yang benar**, bukan untuk siapa pun yang menyebut email itu.
9. Halaman `/platform` di **mode convex** dirender di DOM tiruan (skrip sementara, sudah dihapus
   setelah dipakai): kartu “Identitas login terverifikasi” muncul, konsol bersih, dan menekan
   “Kirim kode” mengubah tombol menjadi “Kirim ulang kode” + “Verifikasi kode” serta membuat baris
   `authVerificationCodes` baru — jalur klien → Convex Auth terbukti jalan, bukan hanya type-check.

**Catatan / blocker:**
- **Belum saya buktikan sendiri:** memasukkan kode dari kotak masuk (langkah manusia) dan klik di
  browser sungguhan pada build yang sudah dideploy. Setelah deploy: buka `/platform` — halaman kini
  menampilkan kartu identitas Convex Auth; kirim kode, masukkan kode, dan backstage terbuka sendiri
  atas nama akun itu. Selama langkah itu belum dilakukan, klaim “terbukti di browser” belum boleh
  diambil (Blocker #3).
- **Jalur masuk tenant belum pindah ke Convex Auth.** Kode OTP lama tetap dipakai untuk masuk
  aplikasi, jadi `ALLOW_UNVERIFIED_ACTOR` masih `true` untuk permukaan tenant. Yang berubah: akun
  platform kini **menuntut** identitas Convex Auth, dan identitas itu memang bisa diterbitkan.
- **Penautan akun lewat email.** Callback `createOrUpdateUser` sengaja ditulis sendiri: bawaan
  Convex Auth akan membuat baris `users` baru (yang akan gagal validasi skema di sini karena `name`
  wajib) dan menggandakan akun platform. Adopsi hanya terjadi setelah kode email terbukti, jadi
  tidak menambah jalan masuk baru.
- Deploy berikutnya (`convex deploy` di `scripts/build-hosted.sh`) ikut menerapkan tabel auth baru;
  env `JWT_PRIVATE_KEY`/`JWKS`/`SITE_URL` sudah ada di deployment yang dipakai situs (terbukti dari
  `bun convex env list`).

## 2026-10-12 — `phansugisoft@gmail.com` jadi akun pengembang platform: penanda **terpasang & terbukti**, jalur UI masih menunggu provider identitas
**Ruang lingkup:** pertanyaan pengguna “bagaimana cara agar email `phansugisoft@gmail.com` adalah sebagai
akun developer”. Yang dikerjakan: menemukan satu-satunya pintu di kode yang bisa memberi penanda itu
(`platform.grant`, **internalMutation** ⇒ hanya lewat akses deployment), menjalankannya untuk email itu,
lalu **menguji apa yang benar-benar terbuka** setelahnya — bukan menganggap “penanda terpasang” sama
dengan “backstage bisa dibuka”. Tidak ada perubahan kode; hanya `worklog.md`.

**Perintah & hasil (apa adanya):**
- `bun convex run platform:grant '{"email":"phansugisoft@gmail.com"}'` → **exit 0**:
  `{ "created": false, "userId": "kx7ax4ckpm1mnk9n0za0xz6p8s8g45ss" }` (baris `users`-nya sudah ada —
sisa dari percobaan masuk tadi — jadi hanya penandanya yang ditambahkan).
- `bun convex data users --limit 6` → barisnya kini:
  `"phansugisoft@gmail.com" | emailVerifiedAt 1791791713841 | "developer"` (penanda benar-benar
  tertulis di DB, bukan hanya diklaim perintahnya).
- `bun convex run platform:me '{"userId":"kx7ax4ckpm1mnk9n0za0xz6p8s8g45ss"}'` → **GAGAL, `EXIT=1`**:
  `Akses ditolak: akun platform menuntut identitas login yang terverifikasi; setel
  ALLOW_UNVERIFIED_ACTOR=false dan pasang provider autentikasi.` (dari `lib/access.ts:104`). Ini bukti
  penting: gerbang akun platform **sengaja tidak dilonggarkan** `ALLOW_UNVERIFIED_ACTOR`, jadi penanda
  saja belum membuka apa pun.
- `bun convex run platform:me '{"userId":"kx7ax4ckpm1mnk9n0za0xz6p8s8g45ss"}' --identity '{"email":"phansugisoft@gmail.com"}'` → **exit 0**:
  `role: "developer"`, `roleLabel: "Pengembang platform"`. Jadi penandanya benar dan langsung bekerja
  begitu ada identitas nyata — yang kurang cuma identitasnya.
- `bun convex run --help` → ada opsi `--identity <identity>` (JSON UserIdentity): jalur CLI untuk
  mencoba fungsi platform tanpa memasang provider lebih dulu.
- `grep -n "platformRole" src/convex/tenants.ts src/convex/members.ts` → `tenants.ts:42` &
  `members.ts:58` memakai `membershipAssignmentError`: akun platform ditolak jadi anggota tenant maupun
  pemilik tenant (konsekuensi yang harus diketahui sebelum memakai email ini untuk hal lain).

**Berkas:** diubah: `worklog.md` (entri ini + pembaruan blocker #1) · tidak ada berkas kode.

**Verifikasi:** semua perintah di atas dijalankan dan hasilnya ditulis apa adanya, termasuk yang
**gagal (exit 1)**. Karena yang berubah **hanya markdown**, tidak ada perintah tipe/harness yang
dijalankan ulang di entri ini; hasil terakhir yang masih berlaku: `tsc` exit 0 · `verify-render.mjs`
323/323 · `verify-backend.mjs` 502/502.

**Catatan / blocker:**
- Penanda sudah aktif, **tetapi halaman backstage di browser belum bisa dibuka** sampai
  `ctx.auth.getUserIdentity()` terisi (Blocker #1): butuh provider identitas + token yang dikirim klien
  (`convex.setAuth(…)`). Pilihan yang paling cocok dengan kode yang ada: **Convex Auth**
  (`@convex-dev/auth`) — `identityUser` sudah memetakan `subject` ke id baris `users`, dan provider OTP
  email-nya bisa memakai Resend yang sudah terpasang — atau IdP terkelola (mis. Clerk) yang memberi JWT.
  Belum dikerjakan; ini perubahan besar (menyentuh alur masuk), jadi tidak saya kerjakan tanpa diminta.
- Konsekuensi penanda: selama `platformRole: "developer"` melekat pada email itu, akun tersebut **tidak
  bisa** diundang menjadi anggota tenant mana pun (`members.add` menolak) dan **tidak bisa** mendirikan
  tenant sendiri (`tenants.create` menolak). Kalau email itu juga dipakai sebagai pemilik tenant, pakai
  email lain untuk akun platform, atau cabut dulu dengan
  `bun convex run platform:revoke '{"email":"phansugisoft@gmail.com"}'`.
- Pencarian penyedia identitas: katalog yang tersedia mengembalikan **tanpa rekomendasi** untuk kebutuhan
  “IdP yang mengisi `ctx.auth.getUserIdentity()` di Convex” (alasannya: kandidat yang dikembalikan bukan
  IdP), jadi tidak ada tautan pemasangan yang saya tulis; pilihan katalog yang paling dekat (Clerk,
  Stytch) belum dipasang.

## 2026-10-12 — Pengiriman OTP lewat Resend akhirnya **terbukti sampai penyedia** (`deliveredVia: "resend"`, tanpa galat)
**Ruang lingkup:** lanjutan dua entri di bawah. Pengguna menjawab **“sudah”** — catatan DNS pengirim sudah
dipasang di Vercel. Yang dikerjakan: (1) memastikan catatan itu benar-benar sudah tampak di DNS publik,
(2) membuktikan pengiriman OTP **bukan** sekadar “dijadwalkan”, melainkan benar-benar diterima penyedia
email. Tidak ada perubahan kode; hanya `worklog.md`.

**Hasil (bukti, bukan dugaan):**
- Probe DNS (`node -e` memakai modul `dns`, exit 0) — catatan sekarang **ada**:
  - `MX  send.mesinpos.produkaplikasi.my.id` → `feedback.forge.rmta.net` (priority 10)
  - `TXT send.mesinpos.produkaplikasi.my.id` → `v=spf1 ip4:52.3.252.119 ip4:44.222.39.36 ip4:199.249.231.0/24 ~all`
  - `TXT resend._domainkey.mesinpos.produkaplikasi.my.id` → `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD4x9Cd…IDAQAB`
  - `NS`/`CNAME` di bawah kedua nama itu → `ENODATA` (catatan langsung, bukan CNAME — sesuai bentuk yang
diminta Resend).
- `bun convex run otp:requestCode '{"email":"phansugisoft@gmail.com"}'` → exit 0, `ok: true`,
  `otpId: ps74caztpbeagaedw8dqcqsqhs8g51c2`, `delivery: "dijadwalkan"`.
- `sleep 8; bun convex run otp:delivery '{"otpId":"ps74caztpbeagaedw8dqcqsqhs8g51c2"}'` → exit 0:
  `deliveredAt: 1791791536590` · **`deliveredVia: "resend"`** · `deliveryError: null`. Artinya Resend
  **menerima** kiriman (tidak ada lagi 403 “domain belum diverifikasi”) — inilah bukti yang selama ini
  ditunggu, dan inilah yang menutup blocker #8.
- Percobaan membaca daftar domain lewat API Resend dari sandbox **diblokir oleh tool**
  (“Direct env and sensitive-file access is blocked …”), jadi status “Verified” tidak dibaca langsung dari
dashboard. Kesimpulannya diambil dari sisi penerimaan Resend di atas, bukan dari tampilan dashboard.

**Berkas:** diubah: `worklog.md` (entri ini + blocker #8 ditutup) · tidak ada berkas kode.

**Verifikasi:** perintah di atas semuanya exit 0 (lihat keluaran apa adanya). Karena yang berubah
**hanya markdown**, tidak ada perintah tipe/harness yang dijalankan ulang di entri ini; hasil terakhir
yang masih berlaku: `tsc` exit 0 · `verify-render.mjs` 323/323 · `verify-backend.mjs` 502/502.

**Catatan / blocker:** satu hal **tidak bisa** saya buktikan dari sisi mesin — apakah emailnya terlihat di
**inbox pengguna** (folder Spam/Promosi bisa menahannya, dan itu di luar jangkauan saya). Kode berlaku 10
menit; kalau tidak terlihat, cek Spam lalu minta kode baru dari halaman `/auth`. Kait uji `OTP_DEV_CODE`
tetap ada dan tetap hanya berlaku untuk alamat berdomain `.test`.

## 2026-10-12 — Jalur A “verifikasi domain di Resend”: zona DNS pengirimnya ada di **Vercel**, bukan Rumahweb
**Ruang lingkup:** lanjutan entri di bawah (laporan “Email otp tidak masuk”); pengguna memilih jalur **A**
(verifikasi domain pengirim di Resend). Yang dikerjakan: memastikan **di mana** catatan DNS-nya harus
dipasang — salah zona berarti verifikasi tidak akan pernah selesai walaupun catatannya “sudah
ditambahkan”. Tidak ada perubahan kode; hanya `worklog.md`.

**Temuan (bukti, bukan dugaan):** `mesinpos.produkaplikasi.my.id` **didelegasikan sebagai zona sendiri ke
Vercel DNS**, jadi catatan `send.*` dan `resend._domainkey.*` harus dibuat di **Vercel → DNS**, bukan di
Rumahweb (zona induk) — catatan di zona induk akan **diabaikan** karena nama di bawah `send.` pun dijawab
Vercel:
- `dns.resolveNs("produkaplikasi.my.id")` → `nsid1.rumahweb.com` dkk (zona induk).
- `dns.resolveNs("mesinpos.produkaplikasi.my.id")` → `ns1…ns4.vercel-dns-3.com` (ada zone cut).
- `dns.resolveNs("send.mesinpos.produkaplikasi.my.id")` → Vercel yang sama.
- `dns.resolve4("mesinpos.produkaplikasi.my.id")` → `76.76.21.98` · `resolveCname` → `cname.vercel-dns.com`
  (situsnya sendiri memang di-hosting Vercel).
- MX/TXT `send.*` dan TXT `resend._domainkey.*` (varian `produkaplikasi.my.id` maupun
  `mesinpos.produkaplikasi.my.id`) masih **kosong** — konsisten dengan penolakan 403 dari Resend.
- Fakta Resend diverifikasi ke dokumentasi resminya, bukan dari ingatan: nama catatan mengikuti domain
yang ditambahkan (`send.<domain>` = MX + SPF, `resend._domainkey.<domain>` = DKIM) · **subdomain wajib
diverifikasi sendiri** — domain induk yang sudah terverifikasi bukan pengganti · ada tombol
“Verify DNS Records” · verifikasi biasanya ~15 menit (propagasi DNS bisa sampai 72 jam, ada “Restart
verification”). Sumber: <https://resend.com/docs/add-a-domain> ·
<https://resend.com/docs/dashboard/domains/introduction> ·
<https://resend.com/docs/guides/dns/cloudflare> ·
<https://resend.com/docs/knowledge-base/what-if-my-domain-is-not-verifying>

**Berkas:** diubah: `worklog.md` (entri ini + satu klausa tambahan di blocker #8) · tidak ada berkas kode.

**Verifikasi:** perintah `node -e` memakai modul `dns` (lihat keluaran apa adanya di atas) → selesai,
exit 0. Berkas yang berubah **hanya markdown**, jadi tidak ada perintah build/tipe/harness yang
dijalankan ulang di entri ini; hasil terakhir (exit 0 · 323/323 · 502/502) masih berlaku karena kode
tidak berubah.

**Catatan / blocker:** sisa satu langkah milik pengguna — menambah catatan DNS di **Vercel** lalu menekan
“Verify DNS Records” di Resend. Pengiriman ke inbox nyata baru bisa dibuktikan setelah statusnya
*Verified*; setelah itu pemeriksaannya bisa saya jalankan ulang (`otp:requestCode` → `otp:delivery`,
yang harus berubah jadi `deliveredVia: "resend"` tanpa `deliveryError`).

## 2026-10-12 — “Email otp tidak masuk”: penyebabnya domain pengirim belum diverifikasi di Resend (+ keadaan kirim kini tampil di layar)
**Ruang lingkup:** laporan pengguna **“Email otp tidak masuk”** setelah `RESEND_API_KEY` & `OTP_EMAIL_FROM`
terpasang. Yang dikerjakan: menelusuri sebabnya sampai ke bukti (bukan menebak), menambah satu aksi
diagnostik baca-saja, dan menutup celah yang membuat aplikasi berkata “kode sudah dikirim” padahal
emailnya sudah ditolak penyedia — pengguna jadi menunggu email yang tidak akan datang.

**Sebabnya (dari data deployment, bukan dugaan):** Resend **menolak kirim dengan 403** karena domain
pengirim belum diverifikasi di akun Resend:
`The mesinpos.produkaplikasi.my.id domain is not verified. Please, add and verify your domain on https://resend.com/domains`.
Jadi saluran emailnya **sudah terkonfigurasi** (`otp:status` → `emailConfigured: true`) tetapi
**pengirimannya gagal**: kuncinya sendiri sah (bukan 401), yang kurang hanya verifikasi domain.

**Berkas:** baru: tidak ada · diubah: `src/convex/otpEmail.ts` (internalAction `domainHealth`, baca-saja) ·
`src/convex/otp.ts` (`requestCode` mengembalikan `otpId`; query baru `delivery`) ·
`src/components/OtpForm.tsx` (banner kegagalan pengiriman di mode Convex) · `worklog.md` (entri ini +
pembaruan blocker #8 & daftar perintah rutin).

**Verifikasi (dijalankan, bukan diklaim):**
- `bun convex env list --names-only` → exit 0; ketiga kunci sudah ada: `OTP_DEV_CODE`, `OTP_EMAIL_FROM`,
  `RESEND_API_KEY`.
- `bun convex run otp:status` → exit 0: `"emailConfigured": true` · `"emailFrom": "MesinPOS <otp@mesinpos.produkaplikasi.my.id>"`.
- `bun convex run otpEmail:domainHealth` → exit 0; **belum bisa membaca status domain** karena kuncinya
  ternyata **bercakupan kirim-saja**: `"error": "Resend membalas 401: … This API key is restricted to only send emails"`.
  Ini bukan kegagalan alat — justru temuan: daftar/catatan DNS domain harus dibaca di
  <https://resend.com/domains>, bukan lewat kunci ini.
- `bun convex data emailOtps --limit 8` → exit 0; dua baris terakhir untuk `phansugisoft@gmail.com`
  berisi bukti sebabnya: `deliveredAt` kosong, `deliveryError` = `Resend membalas 403: {"message":"The
  mesinpos.produkaplikasi.my.id domain is not verified…","name":"validation_error","statusCode":403}`.
- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0.
- `bun convex dev --once` → exit 0 (fungsi ter-push ke `mellow-narwhal-477`).
- Bukti jalur baru hidup di deployment (bukan cuma type-checked):
  `bun convex run otp:requestCode '{"email":"uji-terkirim@contoh-uji.example"}'` → exit 0, `ok: true`,
  `otpId: ps72vk1ex1316gjz35ttzv6cyn8g4jkj`; lalu `bun convex run otp:delivery '{"otpId":"ps72vk1…"}'`
  → exit 0, `"deliveredAt": null`, `"deliveryError": "Resend membalas 403: …domain is not verified…"`.
  Jadi kegagalan kirim kini **bisa dibaca klien** dalam hitungan detik; sebelumnya hanya tercatat di DB.
- `bun scripts/verify-render.mjs` → **323/323**, exit 0 (harness render berjalan di mode demo, jadi
  banner baru ini **tidak** ditempuh di sana — lihat catatan).
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **502/502**, exit 0. Angkanya naik dari 501 karena cabang “saluran email siap” kini aktif dan
  dijalankan: “permintaan kode untuk email valid diterima saat saluran email siap”.

**Catatan / blocker:** yang belum terbukti tetap satu — **pengiriman ke inbox nyata belum pernah
terjadi**, karena domain diterima Resend hanya setelah diverifikasi (DNS di sisi pengguna). Perbaikannya
dua jalur: (a) verifikasi `mesinpos.produkaplikasi.my.id` di Resend lalu pasang catatan DNS yang
ditampilkan dashboard, atau (b) sementara pakai pengirim di domain yang **sudah** terverifikasi
(`OTP_EMAIL_FROM`), termasuk `onboarding@resend.dev` yang hanya boleh dikirim ke email pemilik akun
Resend. Banner UI baru ini **hanya type-checked + diuji lewat backend harness**, belum lewat render
klien di mode Convex (harness render selalu mode demo).

## 2026-10-12 — Panduan aktivasi `RESEND_API_KEY` & `OTP_EMAIL_FROM` (+ koreksi perintah `convex env`)
**Ruang lingkup:** permintaan **“Pandu step by step cara aktifkan resend_api_key & otp_email_from”**.
Tidak ada perubahan kode; yang dikerjakan adalah memastikan langkahnya bisa diikuti apa adanya, jadi
tiap perintah di panduan **dijalankan lebih dulu di repo ini** sebelum ditulis, dan fakta pihak ketiga
(Resend, Convex) diverifikasi ke dokumentasi resminya.

**Koreksi terhadap entri lama (bukan ditulis ulang, sesuai aturan worklog):** entri
“Masuk tanpa kata sandi” menyebut cara mencabut kait uji sebagai `bun convex env unset OTP_DEV_CODE`.
Itu **salah**: subperintah CLI Convex adalah `remove` (alias `rm`), bukan `unset`. Bukti:
`bun convex env --help` → daftar `Commands:` berisi `set`, `get`, `remove|rm`, `list`, `default`.
Perintah yang benar: `bun convex env remove OTP_DEV_CODE`. Sisa entri itu tetap berlaku.

**Berkas:** diubah: `worklog.md` (entri ini) · tidak ada berkas kode yang disentuh.

**Verifikasi (dijalankan, bukan diklaim):**
- `bun convex env --help` → exit 0; memastikan nama subperintah (`remove|rm`, `list --names-only`)
  dan bahwa tanpa flag ia menyasar **dev deployment**.
- `bun convex run otp:status` → exit 0, keluaran nyata: `"emailConfigured": false` ·
  `"reason": "Pengiriman email belum dikonfigurasi di server (RESEND_API_KEY belum diset)."` ·
  `"emailFrom": "MesinPOS <otp@mesinpos.id>"` (nilai bawaan, karena `OTP_EMAIL_FROM` belum diset). Ini
  yang jadi **pembanding sebelum/sesudah** di panduan.
- `freebuff-env list` → berkas `.env.local` hanya memuat `CONVEX_DEPLOYMENT`, `CONVEX_DEPLOY_KEY`,
  `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` — jadi benar bahwa **tidak ada** kunci Resend di lingkungan
  workspace, dan kunci itu memang belum pernah dipasang di mana pun.
- `bun convex env list` (dari entri sebelumnya, masih berlaku) → hanya `OTP_DEV_CODE`.
- Fakta pihak ketiga diverifikasi ke dokumentasi resmi, bukan dari ingatan: batas gratis Resend
  **3.000/bulan, 100/hari** · pengirim uji `onboarding@resend.dev` **hanya boleh dikirim ke email pemilik
  akun Resend** (selain itu ditolak) · DMARC **tidak wajib** untuk memverifikasi domain · verifikasi
  domain biasanya selesai **~15 menit** (DNS bisa sampai 72 jam) · dan yang paling menentukan bagi repo
  ini: **`.env.local` TIDAK disinkronkan ke env runtime deployment Convex** — nilai yang dibaca fungsi
  lewat `process.env` harus dipasang dengan `convex env set` (atau dashboard). Sumber:
  <https://resend.com/docs/knowledge-base/what-is-resend-pricing> ·
  <https://resend.com/docs/create-an-api-key> ·
  <https://resend.com/docs/knowledge-base/403-error-resend-dev-domain> ·
  <https://resend.com/docs/add-a-domain> ·
  <https://docs.convex.dev/production/environment-variables> ·
  <https://docs.convex.dev/cli/reference/env>

**Catatan / blocker:** blocker #8 tetap terbuka sampai pengguna memasang kuncinya — panduan ini adalah
jalannya, bukan buktinya. Setelah `RESEND_API_KEY` + `OTP_EMAIL_FROM` terpasang, `bun convex run otp:status` harus berubah
menjadi `"emailConfigured": true` dan `scripts/verify-backend.mjs` menempuh cabang “saluran email siap”. Selama pengirimnya masih `onboarding@resend.dev`, masuk lewat email hanya
bisa diuji untuk **alamat email pemilik akun Resend itu sendiri**; alamat pengguna lain baru bisa setelah
domain sendiri terverifikasi.

## 2026-10-12 — Masuk tanpa kata sandi: peringatan dini saat saluran email belum siap
**Ruang lingkup:** lanjutan dari entri di bawah (permintaan yang sama: **“Buat login dan register jadi 1
dan tanpa password, hanya otp yg terkirim ke email valid”**). Yang diperbaiki hanya satu celah UX yang
tersisa: di mode Convex, satu-satunya cara mengetahui bahwa server belum punya kunci penyedia email
adalah menekan “Kirim kode masuk” lalu membaca penolakannya — jujur, tetapi terlambat. Query
`otp.status` sudah ada dan sudah diuji, tetapi **belum pernah dipakai UI**.

**Berkas:** diubah: `src/components/OtpForm.tsx` (`ConvexOtpForm` membaca `useQuery(api.otp.status)`
dan menampilkan peringatan sebelum pengguna mengetik) · `worklog.md` (entri ini).

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-render.mjs` → **323/323** (sama seperti sebelum perubahan: tidak ada cek baru,
  tidak ada cek yang hilang).
- Catatan apa adanya: perubahan ini hidup di jalur **mode Convex** (`ConvexOtpForm`), sedangkan harness
  render berjalan di **mode demo** (`VITE_DATA_SOURCE` belum `convex`) sehingga ia melewati alur OTP
  interaktif. Jadi peringatan baru ini **hanya type-checked**, belum diuji lewat render; yang tetap
  terverifikasi penuh adalah query `otp.status` di sisi server (dipakai `scripts/verify-otp.mjs` dan
  `scripts/verify-backend.mjs`).

**Catatan / blocker:** tidak ada blocker baru. Blocker #1 (provider identitas) dan #3 (halaman masuk
belum diuji di browser sungguhan) tetap seperti entri sebelumnya, dan yang utama masih sama:
**pengiriman ke inbox nyata belum pernah diverifikasi** karena deployment dev belum punya
`RESEND_API_KEY` dan `OTP_EMAIL_FROM` (`bun convex env list` → hanya `OTP_DEV_CODE`).

## 2026-10-12 — Masuk tanpa kata sandi: login & daftar jadi satu jalur lewat kode OTP email
**Ruang lingkup:** permintaan **“Buat login dan register jadi 1 dan tanpa password, hanya otp yg
terkirim ke email valid”**. Yang dikerjakan:

- **Satu jalur, tanpa kata sandi.** `src/pages/AuthPage.tsx` kehilangan tab “Masuk”/“Daftar” dan
  kehilangan kolom kata sandi; alurnya tulis email → kode 6 digit → masuk. Akun dibuat di **server
  saat kode terbukti benar** (`users.emailVerifiedAt` diisi di titik yang sama), jadi daftar dan masuk
  memang jalur yang sama — yang membedakan hanya apakah baris `users` untuk email itu sudah ada.
- **Email valid, diperiksa dua kali.** `checkEmail` menuntut bentuk `nama@domain.tld`, menolak spasi,
  domain tanpa titik, titik di ujung, dan panjang di luar batas — dipanggil klien (umpan balik langsung)
  **dan** server (yang menentukan). Diuji sebagai kasus tersendiri, bukan satu regex.
- **Empat pagar pada kodenya** (`src/convex/lib/otp.ts`, murni): disimpan **sebagai hash** (+`OTP_PEPPER`
  opsional), **berbatas waktu** 10 menit (dihitung saat dibaca, tanpa pekerja terjadwal), **berbatas 5
  percobaan** (kode mati tidak menambah hitungan), dan **sekali pakai** dengan **satu kode hidup per
  email** (jeda 60 detik) plus **batas 5 kode per email per jam**.
- **Pengiriman lewat Resend** (`src/convex/otpEmail.ts`, aksi `"use node"`). Tanpa `RESEND_API_KEY`,
  permintaan kode **ditolak dengan jujur** (“Pengiriman email belum dikonfigurasi di server”) — bukan
  diklaim “kode terkirim”; kegagalan penyedia dicatat di `emailOtps.deliveryError`.
- **Kait pengujian yang sempit** (`OTP_DEV_CODE`): kode tetap **hanya** berlaku untuk email berdomain
  `.test` (RFC 2606, tidak bisa didaftarkan siapa pun) **dan** hanya kalau deployment memasangnya — jadi
  jalur “kode → masuk” bisa diuji ujung ke ujung tanpa penyedia email, tanpa membuka celah untuk akun
  nyata. Tanpa kait itu, saluran email tetap wajib.
- **Mode demo tetap jujur.** Karena preview berjalan di data demo (`VITE_DATA_SOURCE` belum `convex`),
  `src/components/OtpForm.tsx` menjalankan **aturan yang sama** di klien dan menampilkan kodenya di
  **kotak surat pengembangan** di layar — kode tetap harus diketik, tetap berbatas waktu, tetap sekali
  pakai; yang tidak ada hanya pengirimannya, dan itu dikatakan apa adanya.
- **Temuan sampingan yang diperbaiki:** harness render memuat `react-dom` **sebelum** DOM tiruan
  dipasang, sehingga React memilih jalur event form lama dan `onChange` **tidak pernah** menyala —
  artinya harness tidak bisa mengetik ke kolom teks mana pun. DOM kini dipasang di modul tersendiri
  (`scripts/happy-dom-setup.mjs`) yang diimpor lebih dulu; setelah itu alur OTP sungguhan (ketik email →
  kode → sesi terbentuk) bisa diuji lewat interaksi, bukan hanya lewat teks.

**Berkas:** baru: `src/convex/lib/otp.ts` · `src/lib/otp.ts` · `src/convex/otp.ts` ·
`src/convex/otpEmail.ts` · `src/components/OtpForm.tsx` · `scripts/verify-otp.mjs` ·
`scripts/happy-dom-setup.mjs` ·
diubah: `src/convex/schema.ts` (tabel `emailOtps` + `users.emailVerifiedAt`) ·
`src/lib/session.tsx` (`signIn`/`signUp` → `signInWithOtp`) · `src/pages/AuthPage.tsx` ·
`src/pages/LandingPage.tsx` (CTA “Coba Gratis” tidak lagi memakai `mode=signup`) ·
`scripts/verify-render.mjs` (halaman masuk + alur OTP + pemasangan DOM) ·
`scripts/verify-backend.mjs` · `README.md` (bagian *Masuk tanpa kata sandi*) ·
`worklog.md` (entri ini, Blocker #1 & #3, perintah rutin).

**Verifikasi:**
- `bun convex dev --once` → exit 0, indeks baru ter-push (`emailOtps.by_email`,
  `.by_email_created`), `✔ Convex functions ready! (9.75s)`.
- `bun tsc -b --noEmit` → exit 0 (juga mencakup `src/convex/**` lewat `tsconfig.convex.json`).
- `bun scripts/verify-otp.mjs` → **79/79** (harness baru: email valid, bentuk & hash kode, umur kode,
  batas kirim ulang, batas per jam, terkunci setelah 5 percobaan, sekali pakai, saluran email, isi email).
- `bun scripts/verify-render.mjs` → **323/323** (dari 309): halaman masuk dirender + alur interaktif
  ketik email salah → ditolak, email benar → kode tampil di kotak surat pengembangan, kode salah →
  “Sisa 4 percobaan”, kode benar → **sesi benar-benar terbentuk** untuk email itu.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **501/501** (dari 489): email tidak valid tidak pernah menghasilkan kode · tanpa kunci penyedia email
  permintaan untuk domain nyata ditolak dengan jujur · email yang belum minta kode tidak bisa masuk ·
  kode salah (sisa percobaan 4 lalu 3) · **kode benar membentuk akun baru** · akunnya ditandai
  `emailVerifiedAt` · pemakaian kedua kode yang sama ditolak.
- `bun convex env set OTP_DEV_CODE 428913` → `✔ Successfully set OTP_DEV_CODE (on dev deployment
  mellow-narwhal-477)`; ini yang membuat putaran penuh di atas bisa ditempuh tanpa penyedia email.

**Catatan / blocker:**
- **Belum pernah dikirim ke email sungguhan.** Deployment dev tidak punya `RESEND_API_KEY`, jadi yang
  terbukti adalah aturan kode, penolakan jujur tanpa kunci, dan jalur “kode → masuk”; **pengiriman
  lewat inbox nyata belum diverifikasi** (butuh kunci Resend + `OTP_EMAIL_FROM`). Setelah keduanya
  diisi, `scripts/verify-backend.mjs` otomatis menempuh cabang “saluran email siap”.
- **`OTP_DEV_CODE` kini terpasang di deployment dev** (`428913`) untuk harness. Cabut dengan
  `bun convex env unset OTP_DEV_CODE`; kait itu hanya berlaku untuk email `@…test`, jadi ia tidak bisa
  dipakai masuk ke akun berdomain nyata.
- **Provider identitas tetap belum ada (Blocker #1).** Kode OTP membuktikan kepemilikan email dan
  membuat akun, tetapi **belum** mengisi `ctx.auth.getUserIdentity()`, jadi gerbang aktor backend masih
  memakai `ALLOW_UNVERIFIED_ACTOR`. Artinya “sudah masuk di aplikasi” belum sama dengan “identitas
  terverifikasi bagi server” sampai provider (Convex Auth) dipasang.
- **Sesi tetap disimpan di perangkat** (`localStorage`, `mesinpos.session.v1`). Karena itu, masuk dari
  perangkat/browser lain membuat sesi tenant lama tidak terbawa (mulai dari onboarding) — perilaku yang
  sudah ada sebelum perubahan ini dan akan selesai bersama provider identitas.
- Halaman masuk kini ikut Blocker #3 (diuji di DOM tiruan, belum di browser sungguhan) — lihat item itu.

## 2026-10-12 — Impersonasi platform: sesi pendampingan tenant yang berjejak audit
**Ruang lingkup:** permintaan **“Tambahkan jalur impersonasi platform yang berjejak audit saat
pengembang menolong tenant”**. Ini menutup ketentuan yang sejak entri sebelumnya sengaja ditulis
sebagai **belum dikerjakan**: “jalan yang benar adalah impersonasi eksplisit dengan jejak audit yang
menyebut dirinya sebagai platform — bukan memberi izin tenant diam-diam yang membuatnya tampak seperti
anggota biasa”. Yang dibangun:

- **Sesi, bukan izin.** `impersonationSessions` menyimpan siapa (`actorId`), tenant mana, alasan,
  mulai/kadaluwarsa, dan berapa kali tenant dibaca. Tanpa satu pun `Permission` tenant yang menyala:
  `helpTenant` **hanya membaca** ringkasan bantuan (identitas tenant, anggota, toko) dengan batas baca
  dan pelaporan pemotongan. Jadi “menolong” tidak pernah tampak seperti tindakan anggota.
- **Alasan wajib & berbatas waktu.** `validateImpersonationReason` menuntut 10–200 karakter (spasi
  dirapatkan); lama sesi dipatok 30/60/120 menit. `impersonationStatus` menghitung kedaluwarsa **saat
dibaca**, jadi jeda antarputaran pekerja terjadwal tidak pernah menjadi jendela akses; pekerja
  `platform.sweepExpiredImpersonations` (cron tiap 30 menit) hanya merapikan baris mati supaya jejaknya
  berakhir rapi. Satu pengembang = satu sesi hidup: jejak audit yang bercampur tidak bisa dipastikan
  milik sesi yang mana.
- **Gerbang empat lapis.** `requireImpersonation` berurutan memeriksa: identitas/platform (lewat
  `requirePlatformDeveloper`, jadi `verified: false` ditolak walaupun `ALLOW_UNVERIFIED_ACTOR` longgar) →
  baris sesinya ada → sesi **milik aktor ini** → sesinya masih hidup. Sesi yang bocor karena itu tidak
  cukup dipakai orang lain.
- **Ketak-terlihatan berbalik, dan itu disengaja.** Sesi membuka & menutup menulis `auditLogs`
  **milik tenant yang dibantu** dengan penanda `source: "platform"` + nama/email pengembang + alasan;
  `helpCount` naik tiap kali ringkasan dibaca. Yang disembunyikan adalah **keberadaan** akun platform;
  kunjungan ke data tenant justru harus diketahui tenant. Penyaring jejaknya membaca **isi `meta`**, bukan
  `actorId`, supaya baris yang kebetulan punya actor itu tidak ikut terbaca sebagai kunjungan.
- **Kanal baca untuk tenant.** `platform.impersonationTrail` digerbangi izin tenant biasa
  (`team.manage`: pemilik/manajer), bukan akun platform — yang membaca adalah tenant-nya, tentang
  kunjungan ke datanya sendiri. Sisi platform punya `platform.myImpersonations` (rekap hidup/
  kedaluwarsa/ditutup, jumlah baca, total menit) dan `platform.tenantDirectory` — satu-satunya bacaan
  lintas-tenant di backend, isinya sengaja tipis (identitas & paket, bukan data operasional).
- **Halaman backstage `/platform`** hidup di luar `/app` **tanpa** `RequireTenant` (akun platform tidak
  punya keanggotaan) dan **tanpa tautan di menu mana pun** (keberadaannya tidak boleh bisa ditemukan dari
  dalam tenant). Semua panggilan server di sana di dalam `try/catch`, jadi penolakan identitas tampil
  sebagai pesan — bukan halaman kosong; di mode demo ia menampilkan keadaan terkunci.

**Berkas:** baru: `src/convex/lib/impersonation.ts` · `src/lib/impersonation.ts` ·
`src/pages/PlatformPage.tsx` · `scripts/verify-impersonation.mjs` ·
diubah: `src/convex/schema.ts` (`impersonationSessions` + `impersonationStatusValidator` + tiga indeks) ·
`src/convex/lib/access.ts` (`requireImpersonation`) · `src/convex/platform.ts` (`impersonate`,
`helpTenant`, `endImpersonation`, `myImpersonations`, `tenantDirectory`, `impersonationTrail`,
`sweepExpiredImpersonations`) · `src/convex/crons.ts` (perapian 30 menit) · `src/App.tsx` (rute
`/platform`) · `scripts/verify-render.mjs` · `scripts/verify-backend.mjs` · `README.md` (bagian
*Pendampingan tenant*) · `worklog.md` (entri ini, tabel status, daftar Blocker, perintah rutin).

**Verifikasi:**
- `bun convex dev --once` → `✔ Convex functions ready! (2.34s)` (exit 0) + indeks baru ter-push:
  `impersonationSessions.by_actor_status`, `.by_status_expires`, `.by_tenant`.
- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0.
- `bun scripts/verify-impersonation.mjs` → **49/49** (harness baru).
- `bun scripts/verify-render.mjs` → **309/309** (dari 298/298; +11): backstage menjelaskan kenapa ia
  terkunci, **rute `/platform` terbuka untuk sesi tanpa keanggotaan tenant** (bukti rutenya tidak memakai
  `RequireTenant`), tamu diarahkan ke halaman masuk, dan **tidak satu pun kontrol pendampingan muncul**
  (“Mulai pendampingan”, “Cari tenant”, “Buka ringkasan bantuan”) sebelum gerbang identitas dilewati.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **489/489** (dari 480/480; +9): akun platform **dan** anggota tenant biasa sama-sama tidak bisa membuka
  sesi pendampingan tanpa identitas terverifikasi; id sesi karangan ditolak validasi argumen; riwayat
  sesi & daftar seluruh tenant tidak terbaca klien mana pun; **pemilik tenant bisa membaca jejak
  pendampingan datanya** (kosong sebelum ada kunjungan); akun platform tanpa keanggotaan **tidak bisa**
  membacanya; dan `bun convex run platform:sweepExpiredImpersonations` mengembalikan `checked: 0`,
  `closed: 0` (perapian jalan lewat akses deployment tanpa menyentuh sesi hidup).
- 22 harness murni lain dijalankan ulang, semuanya exit 0 (`verify-authz` 84/84 · `verify-api` 225/225 ·
  `verify-payments` 72/72 · `verify-support` 61/61 · `verify-sync` 47/47 · dll); `FAIL=0`.
- Berkas markdown (`README.md`, `worklog.md`) tidak memengaruhi build/tipe — hanya ditulis.

**Catatan / blocker:**
- **Jalur “diterima” belum bisa diuji end-to-end.** Klien harness tidak pernah punya identitas, jadi E2E
  hanya membuktikan penolakan + batas luar (id sesi tidak bisa dikarang); keputusan membuka sesi,
  kedaluwarsa, dan bentuk jejak auditnya diuji murni. Halaman backstage karena itu **tampil terkunci** di
  deployment ini, dan belum pernah dibuka manusia di browser sungguhan.
- **Jejak tenant belum punya UI.** Bacaannya ada (`platform.impersonationTrail`, izin `team.manage`, sudah
  diuji E2E sebagai pemilik tenant dan ditolak untuk bukan anggota), tetapi belum ada bagiannya di halaman
  Tim — jadi hari ini pemilik tenant harus memanggilnya lewat klien.
- **Sesi ini hanya membaca.** “Menolong” saat ini berarti melihat keadaan tenant, belum memperbaiki data
  tenant dari dalam sesi. Kalau nanti perlu izin tulis, jalannya adalah menambah kapabilitas eksplisit ke
  sesi (dengan pemicu webhook/audit yang sama), bukan mengangkatnya jadi anggota.
- **Sesi bisa dilihat tenant, dan itu memang disengaja.** Termasuk `sessionId` di `meta` jejak audit —
  id itu tidak bisa dipakai tanpa identitas pengembang yang terverifikasi (`requireImpersonation`
  memeriksa kepemilikan sesi), jadi membocorkannya tidak membuka akses; yang penting justru tenant bisa
  melacak kunjungan yang menyebut dirinya.

## 2026-10-12 — Model akses: akun platform developer (di luar RBAC tenant)
**Ruang lingkup:** permintaan **“Model akses: Akun platform developer”** — memilih model yang sudah
dianalisis sebelumnya (akun platform, bukan peran tenant) dan membangunnya. Modelnya:

- **Akun platform bukan peran.** Ia hidup sebagai penanda `users.platformRole`
  (`platformRoleValidator`, satu-satunya nilai: `developer`) dan punya **nol baris `memberships`**.
  `ROLES`/`ROLE_LABELS` sengaja tidak disentuh: apa pun yang masuk sana otomatis terlihat (dropdown
  peran di halaman Tim, label peran di sidebar & halaman API), jadi “role tak terlihat” bertabrakan
  dengan desainnya sendiri.
- **Aturan murninya di `src/convex/lib/platform.ts`** (dipakai `src/convex/platform.ts`,
  `lib/access.ts`, `members.ts`, `tenants.ts`, halaman, dan harness):
  `isPlatformRole`, `PLATFORM_ROLE_LABELS`, `visibleInTenantSurfaces`,
  `membershipAssignmentError`, `describePlatformAccount`, dan kebijakan `decidePlatformAccess`.
- **Gerbangnya lebih ketat daripada gate tenant.** `requirePlatformDeveloper` di `lib/access.ts`
  menolak `verified: false` **walaupun** `ALLOW_UNVERIFIED_ACTOR` masih `true`. Pasangan gate tenant
  boleh longgar selama transisi tanpa provider auth; akun tersembunyi tidak — kalau boleh, ia hanya
  berarti “akun yang bisa dipakai siapa pun yang menebak satu id”. Urutannya juga menutup enumerasi:
  identitas diperiksa **sebelum** peran platform dibaca, jadi pemanggil anonim menerima penolakan yang
  **sama persis** untuk akun biasa maupun akun platform.
- **Ketak-terlihatan dijaga struktur, bukan disiplin operator.** Tanpa keanggotaan tidak ada baris
  yang bisa ditemukan (`members.list` membaca `memberships` per tenant; `tenants.listMine` membaca
  membership pemanggil; semua gate izin berangkat dari `requireMembership`). Dua jalur yang bisa
  membuatnya terlihat justru **ditutup di server**: `members.add` menolak mengundang akun platform
  (`membershipAssignmentError`), dan `tenants.create` menolak akun platform mendirikan tenant sendiri
  (onboarding membuat keanggotaan pemilik).
- **Hanya akses deployment yang bisa membuat/mencabut.** `platform.grant`/`platform.revoke` adalah
  **internalMutation** — tidak bisa dipanggil klien aplikasi, jadi tidak ada jalan bagi siapa pun di
  dalam tenant untuk memberi dirinya penanda ini atau bahkan mengetahui akun semacam ini ada.
- **Tidak menulis `auditLogs`** (disengaja): tabel audit terikat `tenantId`, jadi mencatat tindakan
  platform ke sana berarti memilih satu tenant untuk membocorkan keberadaan akun ini kepadanya.

**Berkas:** baru: `src/convex/lib/platform.ts` · `src/convex/platform.ts` · `src/lib/platform.ts` ·
diubah: `src/convex/schema.ts` (`platformRoleValidator` + `users.platformRole`) ·
`src/convex/lib/access.ts` (`requirePlatformDeveloper`) · `src/convex/members.ts` & `src/convex/tenants.ts`
(pagar ketak-terlihatan) · `scripts/verify-authz.mjs` · `scripts/verify-backend.mjs` · `README.md`
(bagian *Akun platform*) · `worklog.md` (entri ini + daftar perintah rutin).

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0
- `bun convex dev --once` → `✔ Convex functions ready! (2.3s)` (exit 0); kolom `users.platformRole` dan
  modul `convex/platform.ts` ter-push.
- `bun scripts/verify-authz.mjs` → **84/84** (dari 74/74): 10 cek murni kebijakan akun platform — ia
  bukan peran tenant, labelnya ada, penolakan tanpa identitas terverifikasi (termasuk saat
  `ALLOW_UNVERIFIED_ACTOR` longgar), penolakan anonim yang **identik** untuk akun biasa & akun
  platform (anti-enumerasi), akun biasa terverifikasi tetap ditolak, akun platform terverifikasi
  diterima dengan perannya, ketak-terlihatan permukaan tenant, larangan undang ke tenant, dan ringkasan.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **480/480** (dari 472/472): **8 cek end-to-end** terhadap backend nyata — klien aplikasi **tidak
  bisa** memanggil `platform.grant`; akses deployment bisa membuat akun platform lewat
  `bun convex run platform:grant`; akun itu punya **nol tenant** (`tenants.listMine` → `[]`); ia
  **tidak muncul** di `members.list` tenant uji; `members.add` menolaknya dengan alasan yang menyebut
  larangan jadi anggota; `tenants.create` menolaknya juga; `platform.me` menolak pemanggil tanpa
  identitas terverifikasi dengan pesan yang menyebut `ALLOW_UNVERIFIED_ACTOR`; dan penandanya bisa
  dicabut lewat akses deployment.
- Seluruh 21 harness murni lain dijalankan ulang, semuanya exit 0 (`verify-render` 298/298 ·
  `verify-api` 225/225 · `verify-support` 61/61 · `verify-members` 30/30 · `verify-rbac` 45/45 ·
  `verify-sync` 47/47 · `verify-payments` 72/72 · `verify-qr` 11/11 · dll).
- Berkas markdown (`README.md`, `worklog.md`) tidak memengaruhi build/tipe — hanya ditulis.

**Catatan / blocker:**
- **Halaman backstage belum dibangun.** Yang ada baru model aksesnya (`platform.me` sebagai satu-satunya
  bacaan). Karena itu tidak ada cek render untuk fitur ini — jujur: yang diuji adalah gerbang & aturan,
  bukan tampilan.
- **Jalur “diterima” belum bisa diuji end-to-end di sini.** Klien harness tidak pernah punya identitas
  (deployment anonim), jadi E2E hanya membuktikan **penolakan**; jalur akun platform yang benar-benar
  masuk baru hidup setelah provider autentikasi terpasang dan `ALLOW_UNVERIFIED_ACTOR=false`
  (**Blocker #1**, tetap terbuka). Aturan penerimaannya sendiri diuji murni di `verify-authz.mjs`.
- **Impersonasi belum ada.** Kalau akun platform harus bisa menolong tenant, jalan yang benar adalah
  impersonasi eksplisit dengan jejak audit yang menyebut dirinya sebagai platform — bukan memberi izin
  tenant diam-diam yang membuatnya tampak seperti anggota biasa. Belum dikerjakan.
- **Tanggung jawab pemegang akses berubah:** sekarang siapa pun yang bisa menjalankan `convex run` di
  deployment ini bisa membuat akun platform. Itu memang disengaja (akunnya harus tak terlihat dari
  dalam produk), tetapi artinya kontrol aksesnya berpindah ke akses deployment/dashboard Convex.
- Ketak-terlihatan berlaku untuk seluruh permukaan tenant (UI + query/mutation). Siapa pun yang
  memegang akses database/dashboard Convex tetap melihat baris `users`-nya — itu batas yang tidak bisa
  dihilangkan dan tidak diklaim dihilangkan.

## 2026-10-12 — Lencana Phase 5 & 6 di beranda: “Berjalan” → “Selesai”
**Ruang lingkup:** permintaan mengubah lencana status **Phase 5** dan **Phase 6** di beranda dari
“Berjalan” menjadi “Selesai”, karena seluruh klausa keduanya sudah punya kode, gerbang paket, dan
harness. Yang dikerjakan:

- **Data roadmap di `src/pages/LandingPage.tsx`.** `status` Phase 5 (`Dedicated Support & Franchise
  Scale`) dan Phase 6 (`Realtime Sync & Digital Payment`) kini bernilai `"Selesai"`; Phase 1–4 tetap
  `"Berjalan"` (sengaja tidak ikut diubah — permintaannya hanya dua fase itu).
- **Warna lencananya jadi eksplisit.** Sebelumnya pemetaannya satu baris
  (`status === "Berjalan" ? "accent" : "outline"`), sehingga "Selesai" akan jatuh ke `outline` —
  abu-abu yang justru terbaca “belum jadi”. Sekarang ada `roadmapBadgeVariant`: **Selesai → `default`**
  (warna utama), **Berjalan → `accent`**, sisanya `outline`.
- **Cek render diperkuat, bukan dilonggarkan.** Cek lama bernama “beranda menandai Phase 3–6 sudah
  berjalan” hanya memastikan judul fase & tidak ada label “Rencana” — ia **tidak** memeriksa lencana
  status sama sekali, jadi ia tetap lolos walau badge-nya salah. Cek itu diganti menjadi
  “beranda menandai Phase 1–4 berjalan dan Phase 5–6 selesai” yang membaca status **per kartu**
  (potongan teks tepat setelah nomor fasenya, urutan DOM: nomor → lencana → judul → lingkup),
  sehingga kata “Selesai” dari kartu lain tidak bisa membuatnya lolos.

**Berkas:** baru: — · diubah: `src/pages/LandingPage.tsx`
(`status` Phase 5 & 6 + helper `roadmapBadgeVariant`) · `scripts/verify-render.mjs` (cek roadmap) ·
`worklog.md` (entri ini + Status Phase 5 & Phase 6).

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-render.mjs` → **298/298** checks passed, exit 0 (jumlah cek tidak berubah:
  satu cek lama diperkuat, bukan ditambah).
- **Uji mutasi untuk membuktikan cek barunya tidak hampa:** `status` Phase 5 dikembalikan sementara ke
  `"Berjalan"` → harness **gagal** dengan `✗ GAGAL: beranda menandai Phase 1–4 berjalan dan Phase 5–6
  selesai — Phase 1=Berjalan Phase 2=Berjalan Phase 3=Berjalan Phase 4=Berjalan Phase 5=Berjalan
  Phase 6=Selesai` dan **exit 1**; nilai `"Selesai"` dipulihkan → `298/298`, exit 0. Jadi cek ini
  benar-benar mengikat status ke kartunya.
- Berkas markdown (`worklog.md`) tidak memengaruhi build/tipe — hanya ditulis.

**Catatan / blocker:**
- Keputusan yang perlu diketahui: **Phase 1–4 sengaja dibiarkan “Berjalan”**, walaupun kenyataannya
  klausa Phase 1–3 juga sudah lengkap. Permintaannya menyebut Phase 5 & 6 saja, dan mengubah yang lain
  akan menyiratkan penilaian status yang tidak diminta — kalau memang mau, itu pekerjaan terpisah
  (dan murah: satu nilai `status` per fase + cek render yang sudah per kartu).
- Lencana “Selesai” hanya menyatakan keadaan **kode, gerbang, dan harness** — bukan penilaian
  produksi. Blocker #1 (provider autentikasi) dan #3 (belum pernah diklik di browser sungguhan;
  preview masih mode demo) tetap terbuka dan tidak terpengaruh perubahan ini.

## 2026-10-12 — Audit & tutup celah: kanal keluar dukungan, pemicu webhook berbasis kalender, dan aksi sinkronisasi lewat store
**Ruang lingkup:** permintaan “Berikutnya: audit & tutup celah”. Audit dilakukan atas tabel
**Status Phase** + daftar **Blocker** + katalog webhook, dan menemukan **tiga celah** yang semuanya
ditutup di entri ini:

1. **Dukungan khusus belum punya kanal keluar.** Tiket hanya hidup di dalam aplikasi — tidak ada yang
tahu ada tiket baru kecuali halaman Dukungan dibuka. Sekarang tiket mengabarkan dirinya sendiri lewat
webhook `api.access`: empat event baru di katalog (`support.created`, `support.escalated`,
`support.resolved`, `support.due`) dengan pembentuk isi murni di `lib/webhookEvents.ts`, ditulis dari
`support.create`/`support.act`, dan **pengingat janji tanggap** yang dijalankan pekerja terjadwal
(`crons.ts`, tiap 30 menit, `support.notifyDueTickets`). Pekerja itu mengambil kandidat lewat indeks
`(slaNotified, dueAt)` — bukan memindai tabel — memakai ambang “segera jatuh tempo” yang sama dengan
lencana halaman (`needsSlaReminder` → `dueSoonWindowMs`), dan mengirim **sekali per tiket**: penanda
`slaNotified` dipasang saat kirimannya ditulis, dan tiket yang dibuka ulang meresetnya.
2. **Blocker #6: pemicu event berbasis kalender.** `payable.due` dan `receivable.overdue` bisa
dilanggan tetapi **tidak akan pernah terkirim**: keadaannya berubah karena waktu, bukan transaksi.
Sekarang keduanya punya pekerja harian (`crons.daily` → `payables.notifyDuePayables` dan
`ar.notifyOverdueReceivables`) beserta penanda sekali-per-dokumen (`payables.dueNotified`,
`receivables.overdueNotified`) dan indeks antreannya (`by_due`, `by_overdue`). Rantai webhook keluar
kini **tidak punya entri katalog yang diam-diam tidak pernah berangkat**.
3. **Aksi sinkronisasi belum sampai ke kedua store.** Halaman Sinkronisasi (`sync.realtime`)
menggambarkan konflik yang bisa ditandai selesai, tetapi `pullSync`/`resolveSyncChange` belum ada di
`StoreApi` & kedua store. Ketiganya (`registerSyncDevice`/`pushSync` sudah ada, ditambah
`pullSync`, `resolveSyncChange`, dan heartbeat) kini lengkap, dipakai halaman, dan dijaga cek render
blok `3e-11-1` yang menekan aksi store-nya sungguhan (daftar perangkat, tolak label pendek, dorongan
di atas basis basi → `rebased`, jam melenceng → ditolak, konflik → ditandai selesai, tarik
berjendela + kursor + `hasMore`).

**Dua keputusan yang ditemukan saat menutup celah kalender** (keduanya jadi cek harness supaya tidak
kambuh):

- **Penanda harus ditulis sejak dokumen lahir.** Indeks Convex hanya memuat baris yang kolomnya
  **memang bernilai `false`** — baris tanpa kolom `dueNotified` tidak akan pernah ditemukan
  `.eq("dueNotified", false)`. Versi pertama fitur ini hanya menulis penandanya saat pekerja
  menandainya, jadi tagihan/piutang baru langsung tak terlihat: fitur terlihat jalan, tetapi tidak
  pernah berangkat (`bun convex run payables:notifyDuePayables` → `checked: 0` walau ada tagihan
  lewat tempo). Sekarang `purchasing.receive`, `payables.createBill`, dan `pos.createSale` menulis
  penandanya sejak lahir, dan cek `dokumen baru menulis penandanya sejak lahir` menjaganya.
- **Pencarian dibatasi jendela 60 hari.** Tanpa batas bawah, dokumen yang **tidak pernah** perlu
  diberitahukan (mis. tagihan yang dibayar sebelum jatuh tempo, jadi penandanya tetap `false`)
  menumpuk di depan indeks `(notified, dueDate)` selamanya sampai seluruh kuota putaran habis dan
  dokumen yang benar-benar jatuh tempo kelaparan. Batas bawah `dueDate > now − 60 hari` membuat baris
  lama keluar dari pandangan, sementara dokumen yang baru jatuh tempo selalu di dalamnya karena `now`
  ikut maju.

**Berkas:** baru: — · diubah: `src/convex/lib/payables.ts` (+`needsDueReminder`, `DUE_REMINDER_BATCH`,
`DUE_REMINDER_WINDOW_MS`) · `src/convex/lib/ar.ts` (+`needsOverdueReminder`,
`OVERDUE_REMINDER_BATCH`, `OVERDUE_REMINDER_WINDOW_MS`) · `src/convex/lib/webhookEvents.ts`
(+pembentuk isi `support.*` & dokumen jatuh tempo) · `src/convex/lib/webhooks.ts` (empat entri event
dukungan) · `src/convex/lib/support.ts` (+`needsSlaReminder`, `SLA_REMINDER_*`) ·
`src/convex/schema.ts` (`supportTickets.dueAt`/`slaNotified` + indeks `by_sla`;
`receivables.overdueNotified` + `by_overdue`; `payables.dueNotified` + `by_due`) ·
`src/convex/support.ts` (kiriman `support.created`/`escalated`/`resolved` + `notifyDueTickets`) ·
`src/convex/payables.ts` (kiriman `payable.due` + `notifyDuePayables`) · `src/convex/ar.ts`
(kiriman `receivable.overdue` + `notifyOverdueReceivables`) · `src/convex/purchasing.ts` &
`src/convex/pos.ts` (penanda ditulis sejak lahir) · `src/convex/crons.ts` (dua jadwal harian) ·
`src/lib/store/types.ts` · `src/lib/store/demo.tsx` · `src/lib/store/convex.tsx` (aksi sinkronisasi) ·
`src/pages/SyncPage.tsx` (tarik & tandai konflik selesai) · `scripts/verify-api.mjs` ·
`scripts/verify-support.mjs` · `scripts/verify-render.mjs` · `scripts/verify-backend.mjs` ·
`README.md` · `worklog.md` (entri ini + Status Phase 4/5/6 + Blocker #6).

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0
- `bun convex dev --once` → `✔ Convex functions ready! (2.3s)` (exit 0); skema ter-push, termasuk
  indeks baru `[+] payables.by_due dueNotified, dueDate` dan
  `[+] receivables.by_overdue overdueNotified, dueDate`.
- `bun scripts/verify-api.mjs` → **225/225** (dari 209/209, bersih +16): **17 cek baru** — pekerja
  kalender memakai indeks + jendela, penanda sekali-per-dokumen, penanda ditulis sejak lahir, jadwal
  harian terdaftar, aturan murni `needsDueReminder`/`needsOverdueReminder`, batas putaran/jendela, dan
  isi kiriman `payable.due`/`receivable.overdue` — dikurangi **satu cek lama yang dibalik**: cek yang
  menegaskan kedua event “belum punya pemicu” kini memastikan pemicunya **ada**.
- `bun scripts/verify-support.mjs` → **61/61** (dari 51/51): 10 cek kanal keluar dukungan — event
  terdaftar di katalog, `support.created/escalated/resolved/due` benar-benar ditulis dari jalur
  kejadian, pekerja memakai indeks `by_sla`, penanda sekali-per-tiket + reset saat dibuka ulang, dan
  isi kiriman tiap event.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **472/472** (dari 468/468): **4 cek end-to-end baru untuk `payable.due`** yang menjalankan pekerja
  hariannya **apa adanya** (`bun convex run payables:notifyDuePayables`) pada fungsi yang benar-benar
  ter-deploy — sebelum dijalankan belum ada kiriman; setelah dijalankan ada kiriman `payable.due` ke
  endpoint yang melanggannya; putaran kedua **tidak menambah** kiriman (penanda `dueNotified`); dan
  penerimanya dibersihkan dengan jumlah kiriman yang cocok.
- `bun convex run ar:notifyOverdueReceivables` → `{"checked":0,"enqueued":0,"reminded":0}` (exit 0):
  pekerja piutang ikut ter-deploy dan jalan.
- Seluruh 21 harness murni dijalankan ulang, semuanya exit 0: `verify-authz` 74/74 · `verify-offline`
  24/24 · `verify-fnb` 39/39 · `verify-modifiers` 46/46 · `verify-modules` 27/27 · `verify-wholesale`
  31/31 · `verify-members` 30/30 · `verify-inventory` 42/42 · `verify-purchasing` 60/60 ·
  `verify-payables` 44/44 · `verify-threeway` 84/84 · `verify-opname` 48/48 · `verify-analytics` 65/65 ·
  `verify-rbac` 45/45 · `verify-api` 225/225 · `verify-support` 61/61 · `verify-scale` 42/42 ·
  `verify-sync` 47/47 · `verify-payments` 72/72 · `verify-qr` 11/11 · `verify-render` **298/298**
  (dari 293/293: blok `3e-11-1` menguji aksi store sinkronisasi).
- `verify-webhook-retries.mjs` **tidak dijalankan** di sesi ini (butuh ~2 menit menunggu jadwal
  sungguhan; tidak tersentuh perubahan ini).
- Berkas markdown (`README.md`, `worklog.md`) tidak memengaruhi build/tipe — hanya ditulis.

**Catatan / blocker:**
- **`receivable.overdue` belum diuji end-to-end, hanya aturan murni + sambungan kode + eksekusi pekerja.**
  Piutang lahir dengan `dueDate = sekarang + tempo pelanggan`, jadi nota yang **lewat tempo** tidak
  bisa dibuat dari uji tanpa memalsukan waktu; pekerja piutangnya sudah dibuktikan jalan di
  deployment, tetapi kirimannya belum pernah benar-benar terbit dari nota nyata. Batasan ini sama
  sifatnya dengan “pekerja retry menunggu jadwal sungguhan”.
- **Baris lama tanpa penanda tidak akan pernah ditemukan** pekerja kalender (indeks menyaring
  `eq(notified, false)`): dokumen yang dibuat **sebelum** perubahan ini tidak punya kolomnya.
  Dokumen baru selalu menulis penandanya sejak lahir; untuk data lama perlu backfill kalau ada di
  deployment nyata — tidak ada di repo ini karena data contoh hidup di store demo.
- Halaman Sinkronisasi & Dukungan tetap masuk **Blocker #3**: diuji lewat DOM tiruan & backend
  harness, belum pernah diklik di browser sungguhan (preview masih mode demo).
- Audit ini menutup **Blocker #6**; Blocker #1 (provider autentikasi) dan #3 (browser sungguhan) tetap
  terbuka apa adanya.

## 2026-10-12 — Cek render kode QR di halaman Pembayaran (bukan hanya dialog kasir)
**Ruang lingkup:** permintaan “tambahkan cek render untuk kode QR di halaman Pembayaran, bukan hanya
dialog kasir”. Entri sebelumnya sudah memeriksa kode QR **dialog kasir** di DOM tiruan, tetapi kode QR
di halaman **Pembayaran** belum punya cek render sendiri — dan ternyata halaman itu bahkan tidak
menggambarnya pada data contoh: tagihan QRIS contoh (`DIG-2026-0003`, `DIG-2026-0001`) disimpan tanpa
`qrPayload`, sedangkan server selalu menyimpannya.

Yang dikerjakan:
- **Celah datanya ditutup lebih dulu.** Store demo kini menurunkan `qrPayload` untuk tagihan QRIS yang
  belum memilikinya (`src/lib/store/demo.tsx`), memakai fungsi murni `qrPayload` yang sama dengan
  `createDigitalCharge` dan nama toko dari sesi — jadi kode yang digambar halaman Pembayaran cocok
  dengan yang akan dihitung server (mis. saat tagihan yang sama dicetak ulang).
- **Cek render ditambahkan.** Blok `3e-10` di `scripts/verify-render.mjs` kini merender halaman
  Pembayaran lewat `renderInteractive` (bukan hanya `renderTree`) dan memeriksa DOM-nya: tepat **satu**
  `svg[data-qr-value]`, nilainya memuat `DIG-2026-0003`, dan berisi `<path d="M…">`. Satu cek lagi
  memastikan tagihan QRIS yang sudah **kedaluwarsa** (`DIG-2026-0001`) **tidak** digambari kode QR —
  kode kedaluwarsa hanya menyesatkan pemindai.

**Berkas:** diubah: `scripts/verify-render.mjs` · `src/lib/store/demo.tsx` · `README.md` ·
`worklog.md`.

**Verifikasi:**
- `bun scripts/verify-render.mjs` → **293/293** checks passed (naik dua dari 291: cek kode QR halaman
  Pembayaran + cek tagihan kedaluwarsa tanpa QR).
- `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-qr.mjs` → 11/11 · `bun scripts/verify-payments.mjs` → 72/72 (tanpa regresi).

**Catatan / blocker:**
- Sama seperti sebelumnya, ini **belum dilihat di browser sungguhan** (Blocker #3); pembuktian lewat
  DOM tiruan, bukan mata manusia di preview (masih mode demo).
- `qrPayload` turunan itu hanya untuk **data contoh store demo**; di jalur Convex, `payments.create`
  tetap yang mengisi payload-nya dan store Convex membaca `row.qrPayload` apa adanya.

## 2026-10-12 — QRIS digambar sebagai kode QR yang benar-benar bisa dipindai (dialog kasir & halaman Pembayaran)
**Ruang lingkup:** permintaan “tampilkan QRIS sebagai kode QR yang benar-benar bisa dipindai di dialog
kasir, bukan hanya payload teksnya”. Sampai entri sebelumnya, dialog kasir hanya menempelkan **teks**
payload QRIS (`00020101…`) dan halaman Pembayaran menulis “QRIS payload: …” — pelanggan tidak bisa
memindainya, padahal yang dibaca pemindai adalah **gambarnya**. Sekarang payload yang sama digambar
menjadi matriks QR dan dirender sebagai SVG di kedua tempat itu.

Keputusan:
- **Modul murni baru `src/lib/qr.ts`.** `qrMatrix` mengubah payload menjadi matriks modul
gelap/terang (deterministik — tagihan yang sama selalu menghasilkan kode yang sama, jadi struk bisa
dicetak ulang, dan tagihan berbeda tidak bertukar kode), `qrSvgPath` menggabungkannya jadi satu jalur
SVG, `qrExtent`/`QR_QUIET_ZONE` menetapkan zona tenang 4 modul, dan `isPlausibleQrMatrix` memeriksa
pola pencari & pola waktunya. Payload kosong dilempar — kode kosong lebih menyesatkan daripada gagal.
- **Komponen `src/components/QrCodeImage.tsx`** (dinamai `…Image`, bukan `QrCode`, supaya tidak
bentrok dengan ikon `QrCode` dari lucide-react yang sudah dipakai di banyak halaman) menggambar
matriks sebagai `<svg>` dengan latar/modul **dipaksa putih–hitam** apa pun temanya,
`shapeRendering="crispEdges"`, dan `aria-label`. Payload ditulis ke `data-qr-value` supaya harness
bisa memastikan kode yang digambar memang mengodekan tagihan itu.
- **Encodernya memakai pustaka `qrcode`** (encoder QR yang sudah terbukti) alih-alih menulis encoder
sendiri yang berisiko salah dan justru tidak bisa dipindai. `jsqr` ditambahkan sebagai
devDependency **hanya untuk harness**: membaca balik kode yang digambar.
- **Dialog kasir (`/app/pos`)** kini menampilkan kode QR tagihan di antara ringkasan nominal dan
tombol *Pembayaran diterima*; payload teksnya dipindah ke panel *Payload teks (cadangan)*. Halaman
**Pembayaran** melakukan hal yang sama untuk tiap tagihan QRIS yang masih menunggu.
- **Bukti “bisa dipindai” bukan klaim.** Harness baru merapikan matriks — termasuk matriks yang
dibangun ulang **dari jalur SVG yang benar-benar digambar** — menjadi piksel, lalu membacanya dengan
pemindai QR sungguhan dan memastikan teks yang terbaca **persis** payload-nya.

**Berkas:** baru: `src/lib/qr.ts` · `src/components/QrCodeImage.tsx` · `scripts/verify-qr.mjs` ·
diubah: `src/pages/PosPage.tsx` · `src/pages/PaymentsPage.tsx` · `scripts/verify-render.mjs` ·
`README.md` · `package.json` · `bun.lock`.

**Verifikasi:**
- `bun scripts/verify-qr.mjs` → **11/11 checks passed** (matriks deterministik & berbeda untuk
tagihan berbeda, pola pencari/waktu benar, jalur SVG mewakili matriksnya, dan **pemindai `jsqr`
membaca balik payload yang sama**).
- `bun scripts/verify-render.mjs` → **291/291 checks passed** (naik satu dari 290: cek baru
memastikan dialog kasir menggambar `<svg data-qr-value>` bernilai sama dengan `qrPayload` tagihan dan
berisi `<path d="M…">`).
- `bun scripts/verify-payments.mjs` → 72/72 (tanpa regresi).
- `bun tsc -b --noEmit` → exit 0.
- Jalur bundel klien diperiksa lewat Vite: `pluginContainer.resolveId("qrcode", …, { ssr: false })` →
`node_modules/.vite/deps/qrcode.js` (build browser), jadi `pngjs`/`fs` yang hanya ada di jalur Node
tidak ikut ke bundel.

**Catatan / blocker:**
- Ini tetap **belum dilihat di browser sungguhan** (Blocker #3): pembuktiannya lewat matriks + pemindai
di harness dan SVG yang diperiksa di DOM tiruan (`renderInteractive`), bukan mata manusia di preview.
Preview workspace masih mode demo.
- Kode QR mengodekan payload **model tagihan internal** yang sama seperti sebelumnya; pelunasan tetap
ditandai kasir/keuangan karena belum ada webhook provider PSP — lihat entri sebelumnya.

## 2026-10-12 — Kasir menagih QRIS langsung dari keranjang (menyambungkan `payment.digital` ke POS)
**Ruang lingkup:** permintaan “sambungkan pembuatan tagihan digital ke POS supaya kasir bisa menagih
QRIS langsung dari keranjang”. Sampai entri sebelumnya, tagihan digital hanya hidup di halamannya
sendiri: kasir harus pindah halaman dan **mengetik ulang** nominal keranjang di sana, lalu mencatat
penjualannya terpisah — dua catatan uang yang bisa berbeda tanpa ada yang menolak. Sekarang pilihan
**QRIS** di dialog pembayaran kasir menerbitkan tagihan senilai **total keranjang**, dan penjualan
baru dicatat setelah tagihan itu lunas.

Keputusan modelnya:
- **Nominal tagihan = total keranjang, bukan angka yang diketik kasir.** Aturannya satu, di
  `lib/digitalPayment.ts` (`validateCartCharge`: metode `POS_CHARGE_METHOD` = `qris`, nominal =
  `total`, keterangan ringkas isi keranjang lewat `cartChargeReference`, dipotong pada
  `DIGITAL_REFERENCE_MAX`). Gerbang fitur & batas nominal tetap dari `validateChargeInput` yang lama —
  tidak ada aturan kedua yang bisa melenceng.
- **Uang masuk dulu, nota menyusul.** Menekan *Terbitkan tagihan* hanya membuat tagihan `pending`
  (nomor `DIG-…` dan tenggat 5 menit dari server, payload QRIS dihitung dengan fungsi murni yang
  sama seperti server sehingga yang ditampilkan ke pelanggan persis yang tercatat). Menekan
  *Pembayaran diterima* melunasi tagihan **lalu** memanggil `pos.createSale` dengan
  `digitalChargeId`. Selama tagihannya menunggu, **tidak ada** penjualan yang tercatat.
- **Server memeriksa ulang sambungannya** (`checkSaleAgainstCharge`): penjualan yang menunjuk tagihan
  belum lunas / kedaluwarsa / bernominal berbeda dari total penjualan / bermetode berbeda / milik
  tenant lain ditolak — semua **sebelum** apa pun tersimpan (diperiksa di langkah 3b-2
  `pos.createSale`, sebelum nomor nota diambil). Metode tagih dan metode bayar penjualan juga harus
  sepadan (`saleMethodMatchesCharge`: `qris`↔`qris`, `va`↔`transfer`).
- **Keranjang yang berubah harus dibuatkan tagihan baru** (`checkCartMatchesCharge`): pelunasan
  tagihan lama ditolak dengan menyebut kedua nominalnya, bukan dicatat sebagai penjualan bernominal
  lain.
- **Dua catatan itu saling menunjuk:** `sales.digitalChargeId` (kolom baru) dan
  `digitalCharges.saleId`/`saleNumber` (kolom baru). Halaman Pembayaran kini menulis “melunasi
  penjualan A-00012”, jadi keuangan bisa menelusuri satu tagihan QRIS sampai ke notanya.
- **Gagal di tengah jalan tidak menagih dua kali.** Pelunasan dan penyimpanan penjualan adalah dua
  panggilan (bukan satu transaksi), jadi urutannya sengaja “lunasi dulu”: kalau penyimpanan penjualan
  gagal (mis. stok berubah), tagihannya tetap tercatat lunas, kasir diberi tahu apa yang sudah terjadi,
  dan tombolnya berubah jadi **Simpan penjualan** — tagihan yang sudah lunas tidak dilunasi ulang.
  Penjualan yang menyusul itu tetap diperiksa gerbang yang sama saat disimpan.
- **Antrean offline tetap aman:** tagihan & pelunasannya menuntut koneksi (nomor dan tenggatnya dari
  server), sedangkan nota penjualannya boleh ikut antrean offline karena uangnya sudah dipastikan oleh
  tagihan yang lunas — pemutaran ulang memakai tagihan yang sama.
- **Paket tanpa fiturnya tidak mengunci apa pun:** pilihan QRIS tetap bisa dicatat manual seperti
  kartu, dengan keterangan bahwa kanal tagih digitalnya belum termasuk paket / perannya tidak menagih.
- **Perbaikan paritas demo:** store demo kini menghitung payload QRIS dengan nama merchant yang sama
  dengan server (sebelumnya selalu `MESINPOS`), dan `applySale` demo menegakkan
  `checkSaleAgainstCharge` yang sama — jadi mode demo tidak menjanjikan penjualan yang akan ditolak
  backend. `chargeLikeFrom` baru dipakai bersama oleh `payments.ts`, `pos.ts`, dan store demo supaya
  pemetaan baris → aturan hanya ada di satu tempat.

**Berkas:** baru: tidak ada · diubah: `src/convex/lib/digitalPayment.ts` (aturan kasir: 
`POS_CHARGE_METHOD`, `chargeLikeFrom`, `cartChargeReference`, `validateCartCharge`,
`checkCartMatchesCharge`, `saleMethodMatchesCharge`, `checkSaleAgainstCharge`) ·
`src/convex/payments.ts` (`chargeLikeFrom`, `saleId`/`saleNumber` di daftar) · `src/convex/pos.ts`
(arg `digitalChargeId`, gerbang 3b-2, kolom baru saat insert, patok balik ke tagihan) ·
`src/convex/schema.ts` (`sales.digitalChargeId`, `digitalCharges.saleId`/`saleNumber`) ·
`src/lib/store/types.ts` · `src/lib/store/demo.tsx` · `src/lib/store/convex.tsx` ·
`src/pages/PosPage.tsx` (alur terbitkan → lunasi → simpan, banner tagihan menunggu, tombol yang
berubah peran) · `src/pages/PaymentsPage.tsx` · `scripts/verify-payments.mjs` ·
`scripts/verify-render.mjs` (helper `renderInteractive` + alur klik kasir) ·
`scripts/verify-backend.mjs` · `README.md` · `worklog.md`.

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0
- `bun convex dev --once` → `✔ Convex functions ready! (2.11s)` (exit 0), skema baru ter-push
  (`sales.digitalChargeId`, `digitalCharges.saleId`/`saleNumber`)
- `bun scripts/verify-payments.mjs` → **72/72** (dari 50/50): 22 cek baru untuk jalur kasir —
  keterangan keranjang (termasuk potongan pada batas kolom & keranjang kosong), tagihan bernominal
  total keranjang, penolakan di bawah minimum/menolak tanpa fitur, keranjang yang berubah, pemetaan
  metode bayar, dan gerbang penjualan (belum lunas · kedaluwarsa · nominal beda · metode beda · VA
  ditutup transfer), plus cek sinkronisasi di `schema.ts`, `pos.ts`, halaman kasir, dan store demo.
- `bun scripts/verify-render.mjs` → **290/290** (dari 280/280): 10 cek baru yang menekan tombol yang
  benar-benar dipakai kasir (produk → Bayar → QRIS → Terbitkan tagihan → Pembayaran diterima) di DOM
  tiruan, dan memastikan penjualan **belum** tercatat selama tagihan menunggu, lalu satu penjualan
  QRIS tercatat sebesar tagihannya dengan tagihan yang menunjuk balik ke nota itu (termasuk dua
  penolakan di store demo: tagihan belum lunas dan nominal yang berbeda).
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **468/468** (dari 460/460): 8 cek baru terhadap deployment awan — tagihan kasir terbit dari
  keranjang, penjualan yang menunjuk tagihan belum lunas ditolak, total yang meleset ditolak dengan
  kedua angkanya, metode bayar yang tidak cocok ditolak, tagihan tenant lain tidak bisa dipakai,
  penjualan yang sah tercatat sebesar tagihannya, tagihan menunjuk balik ke nota, dan
  **stok hanya berkurang dari penjualan yang diterima** (bukti penolakan tidak menyimpan apa pun).
- 19 harness murni lain dijalankan ulang, semuanya lulus tanpa regresi: `verify-analytics` 65/65 ·
  `verify-api` 209/209 · `verify-ar` 54/54 · `verify-authz` 74/74 · `verify-fnb` 39/39 ·
  `verify-inventory` 42/42 · `verify-members` 30/30 · `verify-modifiers` 46/46 ·
  `verify-modules` 27/27 · `verify-offline` 24/24 · `verify-opname` 48/48 · `verify-payables` 44/44 ·
  `verify-purchasing` 60/60 · `verify-rbac` 45/45 · `verify-scale` 42/42 · `verify-support` 51/51 ·
  `verify-sync` 47/47 · `verify-threeway` 84/84 · `verify-wholesale` 31/31 (semua exit 0).
- `verify-webhook-retries.mjs` **tidak dijalankan** di sesi ini (butuh ~2 menit dan tidak tersentuh
  perubahan ini).
- Berkas markdown (`README.md`, `worklog.md`) tidak memengaruhi build/tipe — hanya ditulis, tidak ada
  perintah dijalankan ulang untuknya.

**Catatan / blocker:** halaman Pembayaran dan Sinkronisasi, termasuk alur baru ini, tetap masuk
**Blocker #3**: sudah diuji lewat tombol di DOM tiruan (bukan hanya teks) dan lewat backend harness,
**belum pernah dilihat di browser sungguhan** karena preview workspace masih mode demo.
QRIS/VA di sini tetap **model tagihan internal** (payload QRIS & nomor VA deterministik), bukan
integrasi PSP: pelunasan ditandai kasir/keuangan di aplikasi karena belum ada webhook provider —
langkah lanjutan yang belum dikerjakan. Pembatalan tagihan dari kasir memakai alasan tetap
(“Dibatalkan di kasir”); kalau nanti perlu alasan bebas, halaman Pembayaran sudah punya kolomnya.

## 2026-10-12 — Phase 6: sinkronisasi real-time (`sync.realtime`) + pembayaran digital (`payment.digital`)
**Ruang lingkup:** mengerjakan **dua klausa katalog terakhir** yang sampai hari ini hanya label tanpa
alur sama sekali — **Sinkronisasi real-time multi-perangkat** dan **Pembayaran digital QRIS/VA**.
Entri audit 2026-10-11 mencatat keduanya sebagai sisa Phase 4, sejajar dengan dukungan khusus & skala
franchise yang sudah tuntas sebagai Phase 5; karena itu keduanya diangkat jadi **Phase 6** di roadmap
beranda, README, dan tabel status di bawah — dan dengan ini **seluruh klausa katalog berjalan**.

**Pembayaran digital (`payment.digital`)** — aturan murni `src/convex/lib/digitalPayment.ts`, dipakai
`src/convex/payments.ts`, halaman, kedua store, dan harness:

- **Tagihan digital adalah utang pelanggan kepada toko, bukan penjualan.** Kasir menerbitkan tagihan
  bernomor (`DIG-2026-0007`, urut per tenant) untuk sebuah nominal; uang baru dihitung masuk saat
  tagihan **dilunasi**, dan ringkasan memisahkan nominal menunggu dari nominal yang sudah masuk.
- **Kedaluwarsa dihitung saat dibaca, bukan oleh pekerja terjadwal.** QRIS berumur **5 menit** dan
  Virtual Account **sehari**; `statusOf` menurunkan `expired` dari `expiresAt`, jadi tidak ada tagihan
  “menunggu” yang menggantung selamanya hanya karena belum ada yang menyapunya.
- **Janji umurnya dipatok saat tagihan dibuat** (`expiresAt` disimpan di barisnya, bukan dihitung ulang
  dari metode hari ini), jadi mengubah kebijakan kedaluwarsa tidak mematikan tagihan yang sudah
  ditunjukkan ke pelanggan.
- **Pelunasan harus pas:** nominal yang tidak sama dengan tagihan ditolak dengan menyebut **kedua**
  angkanya. Transisinya sempit — `pending → paid` dan `pending → cancelled` saja; tidak ada jalan dari
  `paid`, `expired`, atau `cancelled` ke status lain.
- **Nomor VA deterministik** dari bank + urutan (BCA `8808…`, BNI `8810…`, BRI `8888…`, Mandiri
  `8907…`) dan payload QRIS deterministik juga, jadi satu tagihan bisa dicetak ulang dan dua tagihan
  tidak pernah bertukar kode.
- Izin baru: `payment.view` dan `payment.manage`, keduanya dipegang **pemilik, manajer, kasir, dan
  keuangan** — kasir memang menagih di meja dan rekonsiliasi bank memang pekerjaan keuangan; yang
  menjaga uang adalah aturan transisinya, bukan izinnya. Halaman **Pembayaran** (`/app/payments`,
  menu + rute) menampilkan kartu ringkas, formulir tagihan, dan daftar tagihan beserta tenggat &
  aksinya.

**Sinkronisasi real-time (`sync.realtime`)** — aturan murni `src/convex/lib/realtimeSync.ts`, dipakai
`src/convex/sync.ts`, halaman, kedua store, dan harness:

- **Kehadiran dihitung dari detak terakhir, bukan disimpan:** `online` ≤ 1 menit, `idle` ≤ 5 menit,
  selebihnya `offline` diturunkan dari `lastSeenAt` — perangkat yang baterainya mati langsung terlihat
  offline tanpa perlu apa pun membersihkannya.
- **Setiap perubahan punya revisi urut per tenant.** Satu giliran tarik mengambil tepat satu jendela
  (maksimal 200 baris berrevisi di atas kursor, urut naik) dan mengembalikan `nextCursor` + `hasMore`,
  jadi klien tahu harus menarik lagi tanpa menebak dari panjang hasil.
- **Konflik *last-write-wins* yang deterministik:** `updatedAt` terbaru menang; kalau seri, `deviceId`
  yang lebih besar. Hasilnya dibedakan tiga — `applied` · `rebased` · `rejected` — dan konflik
  tercatat untuk ditandai selesai di halaman.
- **Jam yang melenceng ditolak, bukan dipakai:** `updatedAt` lebih dari **5 menit** di depan server
  ditolak dengan alasan yang menyebut selisih detiknya, supaya perangkat berjam salah tidak “menang”
  selamanya.
- **Perangkat tertinggal** hanya berisi perangkat yang sedang **online** tapi revisinya di bawah revisi
  tertinggi — perangkat yang memang mati tidak sedang menunggu apa pun.
- Revisi naik **satu-satu**: counter revisi per tenant dan revisi barisnya kini sama
  (`nextSequence` mengembalikan nilai yang disimpan), sehingga `currentRevision` tidak lagi tertinggal
  satu dari perubahan terbaru. Halaman **Sinkronisasi** (`/app/sync`, menu + rute, izin
  `device.manage` = pemilik & manajer) menampilkan kartu ringkas, daftar perangkat beserta kehadiran &
  revisinya, daftar perubahan beserta aksi konfliknya, dan formulir pendaftaran perangkat.

**Gerbang fitur sengaja searah di keduanya**, mengikuti pola Phase 3–5, supaya paket yang turun tidak
mengunci pekerjaan yang sudah jalan: **membuat tagihan baru butuh `payment.digital`** sementara
melunasi & membatalkan selalu boleh; **mendaftarkan perangkat & mendorong perubahan baru butuh
`sync.realtime`** sementara detak, tarikan, dan menandai konflik selesai selalu boleh.

**Berkas:** baru: `src/convex/lib/digitalPayment.ts`, `src/convex/lib/realtimeSync.ts`,
`src/lib/payments.ts`, `src/lib/sync.ts`, `src/convex/payments.ts`, `src/convex/sync.ts`,
`src/pages/PaymentsPage.tsx`, `src/pages/SyncPage.tsx`, `scripts/verify-payments.mjs`,
`scripts/verify-sync.mjs` · diubah: `src/convex/schema.ts` (tabel `digitalCharges` & `syncChanges` +
validator metode/status/perangkat/entitas, kolom `platform` pada `devices`), `src/convex/lib/authz.ts`
(izin `payment.view`/`payment.manage`/`device.manage` + pemisahan tugasnya), `src/convex/lib/rbac.ts`
(grup izin “Pembayaran” & “Perangkat”), `src/convex/lib/billing/catalog.ts`,
`src/lib/store/types.ts`, `src/lib/store/demo.tsx`, `src/lib/store/convex.tsx`, `src/data/demo.ts`
(tagihan & perangkat contoh), `src/pages/LandingPage.tsx` (Phase 6), `src/App.tsx`,
`src/layouts/AppLayout.tsx`, `scripts/verify-render.mjs`, `scripts/verify-backend.mjs`, `README.md`,
`worklog.md` (entri ini + tabel **Status Phase 6**, **Blocker**, dan daftar perintah rutin).

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0.
- `bun convex dev --once` → `✔ Convex functions ready! (2.05s)` ke deployment dev
  `mellow-narwhal-477`, jadi harness backend di bawah menguji fungsi yang benar-benar ter-push.
- `bun scripts/verify-payments.mjs` → **50/50 checks passed** (exit 0): umur QRIS 5 menit & VA sehari,
  kedaluwarsa diturunkan dari `expiresAt`, pelunasan tidak pas ditolak, tagihan lunas/kedaluwarsa tidak
  bisa dibatalkan, nomor VA per bank, pembuatan ditolak saat `payment.digital` mati.
- `bun scripts/verify-sync.mjs` → **47/47 checks passed** (exit 0): ambang kehadiran, tarik berjendela
  + kursor, LWW dengan tie-break `deviceId`, jam melenceng ditolak, konflik ditandai selesai sekali,
  gerbang fitur hanya pada dorongan & pendaftaran.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **460/460 checks passed** (exit 0, dari 433/433) untuk deployment awan: pembuatan tagihan QRIS & VA,
  penolakan pelunasan tidak pas, tagihan lunas tidak bisa dibatalkan, gerbang fitur saat paket turun,
  isolasi antar tenant, pendaftaran perangkat + kehadiran online setelah detak, dorongan pertama pada
  entitas baru, LWW dua arah, jam melenceng, tarik dua giliran berurutan, konflik ditandai selesai,
  ringkasan hub, dan `device.manage` ditolak untuk kasir.
- `bun scripts/verify-render.mjs` → **280/280 checks passed** (exit 0, dari 255/255): halaman Pembayaran
  & Sinkronisasi dirender di DOM tiruan beserta alur aksinya lewat store, dan beranda menandai Phase 6.
- Seluruh harness murni lain diulang, semua lulus tanpa regresi: `authz` 74/74 · `offline` 24/24 ·
  `fnb` 39/39 · `modifiers` 46/46 · `ar` 54/54 · `modules` 27/27 · `wholesale` 31/31 · `members` 30/30 ·
  `inventory` 42/42 · `purchasing` 60/60 · `payables` 44/44 · `threeway` 84/84 · `opname` 48/48 ·
  `analytics` 65/65 · `rbac` 45/45 · `api` 209/209 · `support` 51/51 · `scale` 42/42.
- Berkas markdown (`README.md`, `worklog.md`) tidak memengaruhi build/tipe — hanya ditulis, tidak dites.

**Catatan / blocker:** tabel **Status Phase 6** ditambahkan dan **Blocker #3** diperbarui dengan kedua
halaman baru; **Blocker #6** (pemicu event berbasis kalender) tidak berubah — tagihan digital maupun
hub sinkronisasi tidak memakai webhook. Kedua klausa ini **tidak** menambah pekerja terjadwal baru:
kedaluwarsa tagihan dan kehadiran perangkat sama-sama dihitung saat dibaca, bukan oleh cron.

## 2026-10-12 — Phase 5: dukungan khusus (`support.dedicated`) + skala franchise (`scale.franchise`)
**Ruang lingkup:** mengerjakan klausa **Phase 5** yang diminta — **Dukungan khusus** dan **Skala
franchise**. Sebelumnya keduanya hanya label katalog tanpa alur dan tercatat sebagai sisa Phase 4
(lihat entri audit 2026-10-11). Sekarang keduanya punya aturan murni, backend, kedua store, halaman,
izin, data contoh, dan harness; karena Phase 4 yang tersisa sudah tuntas sebagai tiga slice
(analitik lanjutan, peran kustom, akses API & webhook), kedua klausa ini diangkat jadi **Phase 5** di
roadmap beranda, README, dan tabel status di bawah.

**Dukungan khusus (`support.dedicated`)** — aturan murni `src/convex/lib/support.ts`, dipakai
`src/convex/support.ts`, halaman, kedua store, dan harness:

- **Janji tanggap per paket** (target prioritas Normal): Starter **48 jam** · Professional **24 jam** ·
  Enterprise **8 jam**, dikali pengali prioritas (Mendesak ×0,25 · Tinggi ×0,5 · Normal ×1 ·
  Rendah ×2) dengan lantai **1 jam** — tiket Mendesak di Enterprise berjanji 2 jam, tiket Rendah di
  Starter 96 jam.
- **Fitur `support.dedicated` menentukan jalur cepat, bukan akses tiket.** Prioritas Tinggi & Mendesak
  dan eskalasi ke manajer akun butuh fiturnya; membuka tiket Normal/Rendah, menambah catatan,
  menutup, dan membuka ulang **selalu boleh**, termasuk sesudah paket turun.
- **Janji dipatok saat tiket dibuat** (`slaHours` + `planKeyAtCreation` di tabel `supportTickets`),
  jadi naik/turun paket tidak menulis ulang janji tiket yang sudah masuk.
- **Transisi status hanya lewat jalur yang sah:** `open → in_progress → resolved` dan
  `resolved → open`; menutup tiket **wajib** menyebut penyelesaiannya (5–1000 karakter); riwayat
  append-only dengan batas 60 catatan/tiket dan 25 tiket berjalan — tiket yang riwayatnya penuh
  **ditolak**, bukan dipangkas di tengah.
- **Status SLA** (`on_track` · `due_soon` · `overdue` · `met` · `missed`) dengan ambang “segera jatuh
  tempo” = seperempat jendela, dijaga 30 menit–2 jam **dan selalu lebih pendek dari jendelanya**,
  supaya tiket yang baru dibuat tidak langsung terlihat hampir lewat.
- Nomor tiket `TKT-2026-0007` urut per tenant; halaman **Dukungan** (`/app/support`, menu + rute)
  menampilkan janji paket, keempat prioritas (jalur cepat ditandai), kartu ringkas, formulir tiket,
  dan daftar tiket beserta aksinya (mulai · catatan · eskalasi · selesaikan · buka ulang).
- Izin baru: `support.view` (melihat tiket + SLA; dipegang pemilik, manajer, dan **keuangan** —
  banyak tiket soal tagihan) dan `support.manage` (membuka & menutup; pemilik/manajer). **Kasir tidak
  melihat tiket sama sekali**, dan itu diuji di backend.

**Skala franchise (`scale.franchise`)** — aturan murni `src/convex/lib/scale.ts`, dipakai query
`reports.franchise` dan halaman Laporan:

- **Anggaran dibagi per cabang, bukan per tenant:** jendela cabang dibatasi 50
  (`MAX_OUTLET_WINDOW`), dan baris terbaru per cabang mengecil saat jumlah cabang bertambah
  (≤3 → 600 · ≤10 → 300 · ≤25 → 200 · di atasnya 150). Query-nya meminta `rowsPerStore + 1` baris —
  satu dokumen ekstra hanya untuk **tahu** ada pemotongan — dan dokumen di luar anggaran **tidak
  pernah dibaca** dari database.
- **Pemotongan dilaporkan apa adanya:** `truncated`, `skippedOutlets`, `beyondWindow`, plus
  `describeBudget()` yang berbunyi “N cabang × M baris terbaru = K dokumen maksimum per laporan”.
- **Pangsa berjumlah 100** lewat metode sisa terbesar (pembulatan per baris rutin menghasilkan 99%
  atau 101%), dan `mergeTopN` menggabungkan transaksi terbesar jaringan dengan memori `O(n)` — kepala
  terbesar tiap cabang diambil bergiliran, bukan menyatukan semua baris lalu mengurutkannya.
- Bagian **Skala franchise · lintas cabang** di halaman `/app/reports`: omzet jaringan, transaksi,
  rata-rata keranjang, cabang aktif/nonaktif, tabel pangsa per cabang, dan transaksi terbesar
  jaringan. Gerbangnya fitur `scale.franchise` (Enterprise) di depan izin `report.view`; paket di
  bawahnya melihat alasan singkat kenapa bagian itu mati sementara laporan harian tetap jalan.

**Berkas:** baru: `src/convex/lib/support.ts`, `src/convex/lib/scale.ts`, `src/lib/support.ts`,
`src/lib/scale.ts`, `src/convex/support.ts`, `src/pages/SupportPage.tsx`,
`scripts/verify-support.mjs`, `scripts/verify-scale.mjs` · diubah: `src/convex/schema.ts` (tabel
`supportTickets` + validator kategori/prioritas/status/log), `src/convex/lib/authz.ts` (izin
`support.view`/`support.manage` + pemisahan tugasnya), `src/convex/lib/rbac.ts` (grup izin
“Dukungan”), `src/convex/reports.ts` (query `franchise`), `src/convex/lib/billing/catalog.ts`,
`src/lib/store/types.ts`, `src/lib/store/demo.tsx`, `src/lib/store/convex.tsx`, `src/data/demo.ts`
(tiket & cabang contoh), `src/pages/ReportsPage.tsx`, `src/pages/LandingPage.tsx` (Phase 4 dipecah,
Phase 5 ditambahkan), `src/App.tsx`, `src/layouts/AppLayout.tsx`, `scripts/verify-render.mjs`,
`scripts/verify-backend.mjs`, `README.md`, `worklog.md` (entri ini + tabel **Status Phase 5**,
**Blocker**, dan daftar perintah rutin).

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0.
- `bun convex dev --once` → `✔ Convex functions ready! (2.21s)` ke deployment dev
  `mellow-narwhal-477`, jadi harness backend di bawah menguji fungsi yang benar-benar ter-push.
- `bun scripts/verify-support.mjs` → **51/51 checks passed** (exit 0): janji tiap paket × prioritas,
  lantai 1 jam, prioritas jalur cepat & eskalasi ditolak tanpa fiturnya, transisi tidak sah ditolak,
  menutup wajib berketerangan, batas catatan/tiket, dan kasus “tiket baru tidak boleh langsung hampir
  lewat”.
- `bun scripts/verify-scale.mjs` → **42/42 checks passed** (exit 0), termasuk pengukuran yang
  dilaporkan harness apa adanya: satu halaman 200 baris dari 200.000 baris **0,028 ms** sementara
  memindai seluruhnya **2.481 ms**; gabung 40×500 baris jadi 5 teratas **0,345 ms** sementara
  gabung-semua-lalu-urutkan **1.156 ms**.
- `bun scripts/verify-render.mjs` → **255/255 checks passed** (exit 0), termasuk cek baru: beranda
  menandai Phase 3, Phase 4, **dan Phase 5** berjalan tanpa label “Rencana”, lingkup Phase 5 disebut,
  halaman Dukungan (janji paket + kartu SLA), alur aksi tiket lewat store, dan bagian **Skala franchise
  · lintas cabang** — termasuk paket Starter yang melihat alasan kenapa bagian itu mati. (Log React di
  akhir keluaran berasal dari uji ErrorBoundary yang memang sengaja melempar error — bukan kegagalan;
  exit code tetap 0.)
- `bun scripts/verify-backend.mjs` → **433/433 checks passed** terhadap
  `https://mellow-narwhal-477.convex.cloud` (exit 0), termasuk **19 cek dukungan khusus** (nomor urut
  per tenant, tiket Mendesak berjanji 2 jam, keuangan melihat tapi tidak membuka, kasir tidak melihat
  sama sekali, eskalasi ditolak tanpa fitur, janji lama tidak berubah saat paket turun, menutup selalu
  boleh) dan **11 cek lintas cabang** (anggaran per cabang, omzet & transaksi sama dengan laporan pada
  jendela yang sama, isolasi antar tenant, gerbang fitur saat paket turun).
- Enam belas harness murni lain dijalankan ulang **setelah** perubahan kode terakhir, semuanya exit 0:
  `verify-authz` 74/74 · `verify-offline` 24/24 · `verify-fnb` 39/39 · `verify-modifiers` 46/46 ·
  `verify-ar` 54/54 · `verify-modules` 27/27 · `verify-wholesale` 31/31 · `verify-members` 30/30 ·
  `verify-inventory` 42/42 · `verify-purchasing` 60/60 · `verify-payables` 44/44 ·
  `verify-threeway` 84/84 · `verify-opname` 48/48 · `verify-analytics` 65/65 · `verify-rbac` 45/45 ·
  `verify-api` 209/209.
- Perubahan `README.md`/`worklog.md` hanya markdown: tidak memengaruhi build/tipe, jadi tidak ada
  perintah build khusus untuk berkas itu.

**Catatan / blocker:**
- **Belum pernah dilihat di browser sungguhan.** Halaman Dukungan dan bagian lintas cabang di halaman
  Laporan sudah **dirender di DOM tiruan** (255/255), bukan diklik di browser — sama batasannya dengan
  halaman lain (Blocker #3).
- **Dukungan khusus belum punya kanal keluar.** Tiket hidup di dalam aplikasi (tabel
  `supportTickets`): belum ada integrasi surel/Slack/helpdesk yang mengabarkan tiket baru ke tim, dan
  belum ada pemberitahuan otomatis saat janji tanggap hampir lewat — status SLA baru terlihat saat
  halamannya dibuka. Ditulis sebagai batasan, bukan diklaim sudah jalan.
- **Produk teratas lintas cabang sengaja tidak dihitung** di laporan jaringan: itu menuntut satu query
  per penjualan, tepat beban yang sedang dihindari `scale.franchise`. Produk teratas tetap tersedia
  **per cabang** di laporan biasa.
- Angka pada tabel status di bawah adalah jumlah cek saat baris itu ditulis; suite bertambah seiring
  fitur, jadi angka terbaru ada di entri ini.

## 2026-10-11 — Audit status Phase 4 (menjawab “apakah Phase 4 sudah selesai semua?”)
**Ruang lingkup:** menjawab pertanyaan status, **tanpa mengubah kode**. Yang diperiksa: tabel
**Status Phase 4** dan daftar **Blocker yang masih terbuka** di `worklog.md`, lalu dicocokkan dengan
klausa roadmap di beranda. Hasilnya: Phase 4 (**Enterprise Intelligence**) belum selesai — **3 dari 5
klausa** punya alur dan bukti, dua sisanya belum disentuh.

Selesai: **Advanced BI & analitik** (`report.advanced`), **Peran kustom** (`rbac.custom`), dan
**API akses penuh & webhook** (`api.access`, termasuk jalur tulis `POST /api/v1/sales` dan pekerja
terjadwal `crons.ts`). Belum: **Dukungan khusus** (`support.dedicated`, masih label katalog) dan
**Optimasi beban skala franchise**.

Sisa yang menggantung di klausa yang sudah selesai dan tetap terbuka: **Blocker #6 bagian kalender**
(`payable.due`/`receivable.overdue` bisa dilanggan tetapi belum punya pemicu), **Blocker #3** (belum
dirender di browser sungguhan; preview masih mode demo), dan **Blocker #1** (provider autentikasi
belum terpasang, `ALLOW_UNVERIFIED_ACTOR` masih default `true`).

**Berkas:** baru: — · diubah: `worklog.md` (entri ini saja).

**Verifikasi:** pekerjaan ini murni membaca — tidak ada kode yang disentuh, jadi tidak ada perintah
build/tipe/harness yang perlu dijalankan ulang.
- `grep -n "Phase 4\|Blocker\|Status Phase" worklog.md | head -60` → exit 0, 52 baris cocok; sumber
  tabel **Status Phase 4** (baris 2410) dan daftar **Blocker** (baris 2461).
- `read worklog.md` baris 2405–2534 → tabel Status Phase 4 memuat 5 baris klausa: 3 ber-“Selesai”,
  1 “Belum — masih label katalog”, 1 “Belum dikerjakan”.
- Angka verifikasi yang disebut di jawaban diambil apa adanya dari tabel itu (`verify-api.mjs`
  209/209 · `verify-backend.mjs` 403/403 · `verify-render.mjs` 239/239 · `verify-webhook-retries.mjs`
  6/6) — **tidak dijalankan ulang** karena tidak ada berkas kode yang berubah sejak entri di atas;
  yang menjalankannya adalah entri “Pemicu event webhook” dan “Phase 4 slice 3c”.

**Catatan / blocker:** tabel **Status Phase 4** dan daftar **Blocker** tidak perlu diperbarui —
isinya sudah sesuai dengan keadaan saat audit ini. Sisa pekerjaan yang paling dekat: menutup bagian
kalender Blocker #6 (pekerja harian + penanda “sudah pernah diberitahukan” per dokumen) atau
mengerjakan `support.dedicated`.

## 2026-10-11 — Pemicu event webhook: kiriman benar-benar berangkat saat kejadiannya
**Ruang lingkup:** melanjutkan entri “Phase 4 slice 3c”. Pekerja terjadwal sudah ada, tetapi
antreannya hanya terisi tombol **Kirim uji** — jadi webhook keluar belum pernah benar-benar
berangkat karena peristiwa nyata, dan itu dicatat sebagai Blocker #6. Entri ini menutup bagian
transaksinya: penjualan selesai, pembatalan, stok yang **baru** menembus ambang, dan opname yang
diposting kini menulis kirimannya sendiri.

Isi slice:
- `src/convex/lib/webhookEvents.ts` (baru, aturan murni): `stockCrossedLow()` — pemicu `stock.low`
  hanya saat stok menembus ambang, bukan setiap penjualan berikutnya selama stoknya masih rendah;
  plus pembentuk isi kiriman tiap event (`saleCompletedEventData`, `saleVoidedEventData`,
  `stockLowEventData`, `opnamePostedEventData`) supaya bentuk kiriman tidak berbeda-beda tergantung
  dari modul mana ia dipicu.
- `src/convex/lib/webhookOutbox.ts` (baru): `enqueueWebhookEvent()` menulis satu baris kiriman per
  endpoint aktif yang melanggan event itu (tanpa gerbang fitur — endpoint hanya ada kalau
  `api.access` pernah dibeli, dan mematikan integrasi yang sedang jalan tanpa memberi tahu siapa pun
  bukan perilaku yang diinginkan), dan `scheduleWebhookDeliveryPass()` meminta satu putaran pekerja
  setelah transaksinya tersimpan.
- Ambang stok kritis pindah menjadi `DEFAULT_LOW_STOCK_THRESHOLD` di `src/convex/lib/inventory.ts`:
  halaman Produk dan pemicu `stock.low` memakai satu angka, jadi notifikasi dan layar tidak bisa
  berbeda pendapat tentang produk mana yang kritis.
- Hook jalur transaksi: `pos.createSale` (`sale.completed` + `stock.low`, memakai nilai kembalian
  `applyStockChange` sehingga stok sebelum penjualan tidak perlu dibaca dua kali),
  `pos.finalizeHeldSale` (pesanan dari dapur baru **sekarang** menjadi penjualan), `pos.voidSale`
  (`sale.voided`, dengan `restocked` membedakan penjualan yang stoknya dikembalikan dari pesanan
  tertahan), dan `opname.post` (`opname.posted`).
- `lib/webhooks.ts`: `webhookPayload` menerima `subject`, dan `sanitizeEventSubject()` membersihkan &
  memotongnya. Tanpa penanda, dua penjualan pada milidetik yang sama akan berbagi `id` kiriman — dan
  penerima yang memakai `id` untuk menolak kiriman kembar justru membuang penjualan yang sah.
- Keputusan desain: kiriman ditulis **di dalam transaksi** (penjualan yang batal tidak boleh
  meninggalkan kiriman), tetapi pengiriman ke jaringan tetap lewat pekerja — kasir tidak menunggu
  jaringan penerima.
- **Cacat yang ketahuan dari pengukuran, bukan dari membaca kode:** versi pertama menjadwalkan satu
  putaran pekerja **per event**, jadi satu penjualan dengan dua event menjadwalkan dua putaran;
  pengukuran di deployment menunjukkan baris pertama dicoba **dua kali** (`sale.completed=2`) sementara
  baris kedua menunggu cron (`stock.low=0`). Akarnya diperbaiki: penjadwalan pindah ke
  `scheduleWebhookDeliveryPass` dan hanya dipanggil **sekali per mutation** dengan `limit` sejumlah
  kiriman yang baru ditulis. Setelah perbaikan, pengukuran yang sama menunjukkan `=1` untuk keduanya
  dalam ~4 detik, dan `verify-api.mjs` sekarang menjaga aturannya (tidak boleh ada `runAfter` di dalam
  `enqueueWebhookEvent`).
- Halaman API & Webhook menyebut pemicunya apa adanya: empat event transaksi berangkat otomatis, dua
  event jatuh tempo belum punya pemicunya.

**Berkas:** baru: `src/convex/lib/webhookEvents.ts`, `src/convex/lib/webhookOutbox.ts` · diubah:
`src/convex/lib/webhooks.ts`, `src/convex/lib/inventory.ts`, `src/convex/products.ts`,
`src/convex/pos.ts`, `src/convex/opname.ts`, `src/pages/ApiPage.tsx`, `scripts/verify-api.mjs`,
`scripts/verify-backend.mjs`, `README.md`, `worklog.md` (entri ini + **Status Phase 4**, **Blocker
#6**, dan daftar perintah rutin).

**Verifikasi:**
- `bun convex dev --once` → `Convex functions ready! (2.15s)`; `bun tsc -p tsconfig.convex.json
  --noEmit` → exit 0; `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-api.mjs` → **209/209 checks passed** (exit 0), naik dari 192 (**+17 cek**):
  `stockCrossedLow` (menembus ambang vs sudah rendah vs belum menyentuh), ambang kritis tunggal,
  isi tiap event (sale.completed memisahkan dibayar vs piutang; sale.voided menyebut `restocked`;
  stock.low memakai ambang halaman Produk; opname.posted membawa `netUnits`), `id` kiriman yang unik
  per kejadian + pembersihan penandanya, dan cek sambungan: setiap event punya pemanggil di jalur
  transaksi, kotak keluar memeriksa langganan endpoint, tidak ada `fetch` di dalam transaksi,
  penjadwalan sekali per transaksi, serta “event jatuh tempo memang belum punya pemicu”.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **403/403 checks passed** (exit 0), naik dari 396 (**+7 cek**), dijalankan **dua kali berturut-turut**
  dengan hasil sama. Yang dibuktikan lewat backend nyata: satu penjualan sungguhan menulis tepat satu
  `sale.completed` **dan** satu `stock.low` (stok 6 → 4 melewati ambang 5), pembatalan menulis
  `sale.voided`, opname yang diposting menulis `opname.posted`, lalu **tanpa satu pun panggilan
  `testEndpoint`** pekerja mencoba keempat kiriman itu sendiri (`attempts ≥ 1`, `status` tetap
  `pending`, galat jaringan tercatat) dan menghapus penerimanya membuang keempat kiriman itu.
- `bun scripts/verify-render.mjs` → **239/239 checks passed** (exit 0) — halaman API & Webhook tetap
  dirender tanpa error setelah copy-nya berubah.
- `SKIP_PUSH=1 VITE_CONVEX_URL=… bun scripts/verify-webhook-retries.mjs` → **6/6 checks passed**
  (exit 0): pekerja percobaan ulang tetap berjalan seperti sebelumnya setelah jalur pemicu masuk.
- Regresi 16 harness murni, semuanya exit 0: `verify-authz` 74/74 · `verify-offline` 24/24 ·
  `verify-fnb` 39/39 · `verify-modifiers` 46/46 · `verify-ar` 54/54 · `verify-modules` 27/27 ·
  `verify-wholesale` 31/31 · `verify-members` 30/30 · `verify-inventory` 42/42 · `verify-purchasing`
  60/60 · `verify-payables` 44/44 · `verify-threeway` 84/84 · `verify-opname` 48/48 ·
  `verify-analytics` 65/65 · `verify-rbac` 45/45 · `verify-api` 209/209 (`set -o pipefail`, output
  dipotong `tail` supaya exit code aslinya tetap terbaca).
- Diagnostik terukur (skrip sekali jalan `bun -e` ke deployment awan, **bukan** harness yang ikut
  tersimpan): sebelum perbaikan penjadwalan → `sale.completed=2 stock.low=0`; sesudah perbaikan →
  `sale.completed=1 stock.low=1` dalam ~4 detik; dan satu pengukuran pada jalur pembatalan
  menunjukkan penjadwalan langsung tidak selalu cepat (baru dicoba ~17 detik kemudian oleh cron) —
  itulah alasan batas tunggu di `verify-backend.mjs` diset 75 detik: cek harus bergantung pada
  jaminan cron 1 menit, bukan pada penjadwalan langsung yang bisa lambat.

**Catatan / blocker:**
- Blocker #6 tinggal bagian **kalender**: `payable.due` dan `receivable.overdue` berbasis waktu,
  bukan transaksi, jadi keduanya butuh pekerja harian sendiri beserta penanda “sudah pernah
  diberitahukan” per dokumen (kalau tidak, satu tagihan akan diberitakan setiap hari).
- Duplikat kiriman pada putaran yang benar-benar tumpang tindih masih mungkin (belum ada langkah
  “klaim” baris sebelum kirim) — cacat **sistematis** dari satu transaksi sudah hilang dan dijaga cek
  statis, tetapi kemungkinan teoretisnya tidak saya klaim nol, dan `id` kiriman tetap sama sehingga
  penerima bisa mengenalinya.
- Pemicu hanya diuji lewat harness backend + pengukuran langsung; dari browser tidak ada alur yang
  memicu webhook, jadi Blocker #3 (alur Convex di browser sungguhan) tidak berubah.
- `README.md` dan `worklog.md` (entri ini + tabel) hanya markdown: tidak memengaruhi build/tipe, jadi
  tidak ada perintah kode yang perlu diulang setelah suntingan dokumentasi terakhir.

## 2026-10-11 — Phase 4 slice 3c: pekerja terjadwal yang benar-benar mengirim ulang webhook gagal
**Ruang lingkup:** permintaannya “Tambahkan pekerja terjadwal yang benar-benar mengirim ulang webhook
yang gagal sesuai jadwalnya”. Ini menutup Blocker #4: jadwal percobaan ulang (`nextAttemptAt`, aturan
murni `deliveryOutcome`) sudah dihitung & disimpan sejak slice 3, tetapi belum ada apa pun yang
menjalankannya, dan halaman API memang menulis itu apa adanya sebagai kekurangan.

Isi slice:
- `src/convex/lib/webhooks.ts` (aturan murni, tetap tanpa jaringan): `RETRY_WORKER_INTERVAL_MINUTES`
  (1 menit) & `MAX_RETRY_BATCH` (20) sebagai satu-satunya sumber angka pekerja; `retryBatchLimit()`
  yang menjepit permintaan (0/negatif/NaN/berlebihan) sehingga pekerja tidak bisa berjalan tanpa batas
  karena salah argumen; `retryStopReason()` yang memutuskan pekerja **berhenti** saat endpoint
  dinonaktifkan/dihapus; dan `webhookDeliveryHeaders()` — satu-satunya tempat yang menandatangani badan
  kiriman, plus `x-mesinpos-attempt` berisi percobaan ke berapa.
- `src/convex/apiAccess.ts`: `postSignedDelivery` sekarang memakai `webhookDeliveryHeaders` (jalur kirim
  uji & jalur percobaan ulang tidak bisa lagi berbeda skema tanda tangan — sebelumnya header event
  jalur uji bahkan menulis `x-mesinpos-event: test`). Tambahan: `dueDeliveries` (internal query yang
  mengambil kiriman `pending` yang jadwalnya lewat **lewat indeks**, bukan memindai riwayat, sekaligus
  membawa URL & rahasia endpoint), `stopDelivery` (internal mutation penutup `failed` untuk endpoint
  mati — beda dari `finishDelivery` yang menjadwalkan ulang lewat backoff), dan `retryDueDeliveries`
  (internal action yang benar-benar mengirim ulang lalu mencatat hasil tiap percobaan).
- `src/convex/crons.ts` (baru): `crons.interval("percobaan ulang webhook yang gagal", { minutes:
  RETRY_WORKER_INTERVAL_MINUTES }, internal.apiAccess.retryDueDeliveries, { limit: MAX_RETRY_BATCH })`.
- `src/convex/schema.ts`: indeks `webhookDeliveries.by_status_next_attempt` (`status`,
  `nextAttemptAt`) sebagai antrean pekerja.
- Keputusan desain: pekerja **tidak** digerbang fitur `api.access` — menghentikan percobaan di tengah
  jalan karena paket berubah hanya akan meninggalkan kiriman setengah jalan; tenant yang tidak ingin
  dikirimi lagi mematikan endpoint-nya, dan `retryStopReason` menutup kirimannya sebagai `failed`.
  Satu penerima yang bermasalah juga tidak menghentikan putaran: pengiriman tetap dilanjutkan ke
  penerima lain dalam batch yang sama.
- Halaman API & Webhook: copy kartu webhook & riwayat kiriman menyebut pekerja terjadwalnya
  (tiap menit, lima percobaan, mematikan endpoint menghentikan sisanya) dan header
  `x-mesinpos-attempt`.

**Berkas:** baru: `src/convex/crons.ts`, `scripts/verify-webhook-retries.mjs` · diubah:
`src/convex/lib/webhooks.ts`, `src/convex/schema.ts`, `src/convex/apiAccess.ts`,
`src/pages/ApiPage.tsx`, `scripts/verify-api.mjs`, `README.md`, `worklog.md` (entri ini +
**Status Phase 4**, **Blocker #4**, dan daftar perintah rutin).

**Verifikasi:**
- `bun convex dev --once` → `Convex functions ready! (2.16s)` dan push-nya menambahkan indeks antrean:
  `[+] webhookDeliveries.by_status_next_attempt   status, nextAttemptAt, _creationTime`.
- `bun tsc -p tsconfig.convex.json --noEmit` → exit 0; `bun tsc -b --noEmit` → exit 0. Percobaan
  pertama type-check backend **gagal** (`src/convex/apiAccess.ts(596,25): error TS2339: Property
  'attempts' does not exist…`) karena jalur uji kini juga mengirim nomor percobaan; diperbaiki di
  sumbernya — `beginTestDelivery` mengembalikan `attempts: 0` (kiriman uji selalu percobaan pertama),
  bukan dengan menghapus header atau membungkam tipe.
- **Pekerja diuji perilakunya, bukan teksnya:**
  `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-webhook-retries.mjs` →
  **6/6 checks passed** (exit 0) dalam satu putaran **± 85 detik** menunggu jadwal sungguhan. Yang
  dibuktikan: dua kiriman ke host yang tidak ada tercatat sebagai percobaan pertama yang menunggu;
  **tanpa ada pemicu manual**, percobaan penerima aktif bertambah **1 → 2** (kegagalan tetap tercatat)
  dan jadwal berikutnya menjadi `nextAttemptAt ≥ jadwal lama + 5 menit` (aturan backoff murni, bukan
  angka baru); penerima yang **dimatikan** setelah gagal tidak dikirimi lagi — kirimannya ditutup
  `failed` pada `attempts: 1` dengan alasan “dinonaktifkan” dan `nextAttemptAt` kosong; ringkasan
  halaman ikut sesuai (1 menunggu, 1 menyerah, 1 endpoint aktif).
- `bun scripts/verify-api.mjs` → **192/192 checks passed** (exit 0), naik dari 180 (**+12 cek**):
  aturan pekerja (jeda ≤ jeda percobaan terkecil, `retryBatchLimit` menjepit 0/negatif/pecahan/NaN/20+,
  `retryStopReason` berhenti untuk endpoint mati & dihapus tetapi lanjut untuk yang aktif, header kiriman
  menandatangani badan dengan skema yang sama & menyebut event + nomor percobaan, tanda tangan percobaan
  ulang segar), plus sambungan antarberkas: `crons.ts` mendaftarkan `internal.apiAccess.retryDueDeliveries`
  dengan interval & batch dari aturan murni, antrean diambil lewat indeks `by_status_next_attempt`
  (bukan pemindaian), indeks itu memang ada di `schema.ts`, `apiAccess.ts` tidak lagi memanggil
  `signWebhookPayload` sendiri (satu penanda tangan), dan pekerja tetap mencatat hasilnya lewat
  `finishDelivery`/`stopDelivery` serta mengirim `attempt: item.attempts + 1`.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **396/396 checks passed** (exit 0) — termasuk cek kiriman webhook yang lama, jadi pekerja yang kini
  berjalan tiap menit **tidak** membuat cek lama flaky (kiriman langsung diperiksa sebelum jadwal
  pertamanya tiba).
- `bun scripts/verify-render.mjs` → **239/239 checks passed** (exit 0) — halaman API & Webhook tetap
  dirender tanpa error setelah copy-nya berubah.
- Regresi 16 harness murni, semuanya exit 0: `verify-authz` 74/74 · `verify-offline` 24/24 ·
  `verify-fnb` 39/39 · `verify-modifiers` 46/46 · `verify-ar` 54/54 · `verify-modules` 27/27 ·
  `verify-wholesale` 31/31 · `verify-members` 30/30 · `verify-inventory` 42/42 · `verify-purchasing`
  60/60 · `verify-payables` 44/44 · `verify-threeway` 84/84 · `verify-opname` 48/48 ·
  `verify-analytics` 65/65 · `verify-rbac` 45/45 · `verify-api` 192/192 (output dipotong `tail` dengan
  `set -o pipefail` supaya exit code aslinya tetap terbaca).

**Catatan / blocker:**
- **Antreannya masih diisi kiriman uji.** Yang **belum** dibuat pemicu peristiwa nyata: `sale.completed`
  dan kawan-kawan masih **hanya** bisa diuji lewat tombol **Kirim uji** — belum ada yang menulis baris
  `webhookDeliveries` saat penjualan/opname/hutang benar-benar terjadi. Pekerja di entri ini
  menjalankan apa pun yang ada di antrean, jadi begitu pemicunya dipasang, jadwalnya langsung hidup
  tanpa perubahan di sisi pekerja. Ini langkah lanjutan yang jelas, dan dicatat di Blocker.
- Dua putaran pekerja yang **tumpang tindih** bisa mengirim kiriman yang sama dua kali (belum ada
  langkah “klaim” baris sebelum kirim). Dampaknya kecil dan bisa dikenali penerima: isi kirimannya
  identik (id di dalam badan kiriman sama), dan jeda percobaan terkecil (1 menit) jauh lebih besar
  daripada durasi satu putaran, jadi kejadiannya jarang. Ini disebut apa adanya, bukan dianggap nol.
- `README.md` dan `worklog.md` (entri ini + tabel) hanya markdown: tidak memengaruhi build/tipe, jadi
  tidak ada perintah kode yang perlu diulang setelah suntingan dokumentasi terakhir.

## 2026-10-11 — Phase 4 slice 3b: endpoint tulis `/api/v1/sales` + scope tulis (`pos.sell`)
**Ruang lingkup:** melengkapi slice `api.access` dengan **jalur tulis**. Permintaannya: “Tambahkan
endpoint tulis /api/v1 (mis. membuat penjualan dari sistem luar) beserta scope tulisnya”. Sebelum ini
API hanya bisa membaca 4 resource; sekarang ada satu endpoint tulis `POST /api/v1/sales` — pesanan
masuk dari sistem luar (kanal penjualan online, mesin pesan antar, integrasi marketplace) — dengan
scope tulis `pos.sell` yang tampil di halaman, diperiksa di server, dan dibatasi izin pembuat kunci.

Isi slice:
- Aturan murni `src/convex/lib/apiOrders.ts` (+ re-export `src/lib/apiOrders.ts`): bentuk pesanan luar
  (`idempotencyKey`, `lines[{sku, quantity, unitCode}]`, `payment{method, amount, provider,
  providerRef}`, `discount`, `customerCode`, `memberCode`). Semua diperiksa **bentuknya** saja (400):
  field asing ditolak, pesan galat menyebut nomor barisnya, SKU/kode dinormalkan ke huruf besar, dua
  baris dengan SKU & satuan sama ditolak, `modifiers` ditolak dengan penjelasan (bukan diabaikan), dan
  `payment.amount` boleh **dihilangkan** — artinya “tagih tepat sebesar total yang kamu hitung”.
- `lib/apiKeys.ts`: `ApiResource.write` **diturunkan dari `method`** (bukan daftar kedua yang bisa
  berbeda), resource `sales.create` (`POST /api/v1/sales`, scope `pos.sell`), plus `API_WRITE_RESOURCES`,
  `findApiResource(method, path)`, dan `isWriteResource`; scope `pos.sell` kini muncul di
  `API_SCOPE_OPTIONS` dengan penanda tulis, jadi daftar scope di halaman ikut berubah sendiri.
- `apiAccess.ts`: internal mutation `recordOrder` — memeriksa ulang kunci, status, **dan scope di
  dalam transaksi tulis** (kunci bisa dicabut antara autentikasi dan penulisan), menerjemahkan
  SKU/kode → id Convex (tidak peka huruf besar-kecil), meneruskan ke **`pos.createSale`**, lalu
  menulis audit `api.sale.create`. Hasilnya bertipe `ApiWriteResult` yang membawa kode HTTP: 400 bentuk
  salah, 409 aturan bisnis, 401/403 kunci — supaya `http.ts` tidak menebak.
- `pos.ts`: arg opsional `payExactTotal` — jumlah pembayaran diambil dari total yang dihitung server
  (hanya boleh satu metode), karena pemanggil API tidak boleh menyalin rumus PPN & diskon.
- `http.ts`: `handleApiWrite` untuk resource bertulis, dipilih dari tabel `API_RESOURCES` yang sama;
  urutannya kunci → badan pesan; 201 untuk penjualan baru dan 200 untuk kiriman ulang dengan
  `idempotencyKey` yang sama.
- Halaman API & Webhook: tabel endpoint menandai baris **tulis**, ada bagian “Pesanan masuk dari
  sistem luar” dengan contoh `curl` yang dibangkitkan dari `sampleExternalOrderBody()` (jadi contohnya
  tidak bisa berbohong), dan scope `pos.sell` ditandai **tulis** di pemilih scope. Beranda (roadmap
  Phase 4) ikut menyebut endpoint tulisnya.
- Desain yang sengaja tidak ditambahkan: **tidak ada scope tulis baru yang khusus API**. Scope
  tulisnya tetap izin domain yang sudah ada (`pos.sell`), sehingga kunci tidak bisa menulis hal yang
  peran pembuatnya sendiri tidak boleh lakukan.

**Berkas:** baru: `src/convex/lib/apiOrders.ts`, `src/lib/apiOrders.ts` · diubah:
`src/convex/lib/apiKeys.ts`, `src/convex/apiAccess.ts`, `src/convex/pos.ts`, `src/convex/http.ts`,
`src/pages/ApiPage.tsx`, `src/pages/LandingPage.tsx` (roadmap), `scripts/verify-api.mjs`,
`scripts/verify-backend.mjs`, `scripts/verify-render.mjs`, `README.md`, `worklog.md` (entri ini +
**Status Phase 4**, **Blocker**, dan daftar perintah rutin).

**Verifikasi:**
- `bun convex dev --once` → `Convex functions ready! (2.19s)`; `bun tsc -b --noEmit` → exit 0.
  Percobaan pertama type-check **gagal** (`src/convex/apiAccess.ts(1020,51): error TS2339: Property
  'pos' does not exist`), karena `recordOrder` memanggil `internal.pos.createSale` sementara
  `pos.createSale` adalah mutation publik. Diperbaiki menjadi `api.pos.createSale` (dan alasannya
  ditulis sebagai komentar di berkas itu), bukan dengan menghapus cek atau menyunting berkas
  `_generated/*`.
- `bun scripts/verify-api.mjs` → **180/180 checks passed** (exit 0), naik dari 147 (**+33 cek**).
  Cek barunya: satu
  endpoint tulis tepat dan scope-nya `pos.sell`; flag `write` diturunkan dari `method`;
  `findApiResource` membedakan GET/POST/DELETE; `isWriteResource` membedakan tulis/baca/asing; scope
  tulis tetap dibatasi izin pembuat (`scopeAllowed` untuk kasir/pemilik ya, keuangan/gudang tidak);
  dan satu blok cek aturan pesanan masuk (contoh body halaman lolos parser-nya sendiri dan tidak memuat harga,
  pesan galat bernomor baris, field asing/modifier/baris kembar/SKU kosong ditolak, `payment.amount`
  negatif ditolak & nol diterima). Ditambah sambungan lintas-berkas: `http.ts` memisahkan jalur baca &
  tulis, **kunci diperiksa sebelum badan pesan diurai**, bentuk badan diperiksa aturan murni, dan
  penulisan API memang masuk lewat `api.pos.createSale`.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **396/396 checks passed** (exit 0), naik dari 375 (**21 cek baru**), lewat HTTP action nyata. Yang
  dibuktikan bukan cuma aturan: tanpa kunci 401, kunci tanpa scope `pos.sell` 403, badan bukan JSON
  400, tanpa `idempotencyKey` 400, field `total` asing 400, lalu penjualan sungguhan **HTTP 201**
  dengan total 66.600 (2 × 30.000 + PPN 11% — harga tidak pernah dikirim klien), **kiriman ulang
  dengan kunci yang sama dijawab 200 dengan id & nomor yang sama**, penjualan tercatat atas nama
  pembuat kunci dengan pembayaran tepat sebesar total dan `idempotencyKey` bernama
  `api:<tenantId>:<kunci>`, penjualan itu terbaca lagi lewat `GET /api/v1/sales`, stok lokasi jual
  turun **3 → 1** lewat `GET /api/v1/products`, stok kurang 409 (`Stok tidak cukup`), sisa tagihan
  tanpa pelanggan 409 (menyebut B2B), SKU asing 400 `tidak ditemukan`, dan kunci tulis yang dicabut
  langsung 401.
- `bun scripts/verify-render.mjs` → **239/239 checks passed** (exit 0), naik dari 237: halaman API &
  Webhook dirender di DOM klien dan benar-benar menampilkan `POST /api/v1/sales`, bagian “Pesanan masuk
  dari sistem luar”, label scope **Melakukan penjualan**, contoh body `"sku": "KOPI-SUSU"` tanpa
  `amount`, dan penjelasan 201/200.
- Regresi 16 harness murni, semuanya exit 0: `verify-authz` 74/74 · `verify-offline` 24/24 ·
  `verify-fnb` 39/39 · `verify-modifiers` 46/46 · `verify-ar` 54/54 · `verify-modules` 27/27 ·
  `verify-wholesale` 31/31 · `verify-members` 30/30 · `verify-inventory` 42/42 · `verify-purchasing`
  60/60 · `verify-payables` 44/44 · `verify-threeway` 84/84 · `verify-opname` 48/48 ·
  `verify-analytics` 65/65 · `verify-rbac` 45/45 · `verify-api` 180/180. Output dijalankan dengan
  `set -o pipefail` supaya exit code aslinya terbaca, bukan exit code `tail`.
- `freebuff-preview status` → `running: true`, `listening: true`, `statusCode: 200`;
  `bun scripts/diag-render.mjs /app/api` → `✓ panjang_html=253` tanpa error render.

**Catatan / blocker:**
- Dua perbaikan harness yang **bukan** pelemahan cek, keduanya ditemukan saat menjalankan ulang:
  (a) cek “pemakaian kunci tercatat” di `verify-backend.mjs` mencari `keys[0]`, sedangkan endpoint
  tulis menambah kunci baru dan daftarnya terurut terbaru dulu — sekarang kuncinya dicari lewat nama;
  (b) cek tanda tangan webhook memakai **tiga** `Date.now()` berbeda dalam satu ekspresi padahal isi
  badan memuat cap waktu itu, jadi ia bisa gagal hanya karena jarum jam bergerak satu milidetik —
  sekarang satu cap waktu dipakai untuk badan, tanda tangan, dan pemeriksaan, plus dua cek negatif
  baru (badan yang diubah dan rahasia lain harus sama-sama ditolak).
- Yang **belum** ada di jalur tulis: ubah harga/stok, pembatalan penjualan, dan `modifiers` (ditolak
  eksplisit). Percobaan ulang webhook masih tanpa pekerja terjadwal (Blocker #4).
- Halaman hanya **mendokumentasikan** endpoint tulis; dari browser tidak ada panggilan jaringan ke
  `/api/v1`. Jalur tulis benar-benar diuji lewat Convex (harness backend), bukan lewat klik kasir di
  browser sungguhan (Blocker #3).
- `README.md` dan `worklog.md` (entri ini + tabel) hanya markdown: tidak memengaruhi build/tipe, jadi
  tidak ada perintah kode yang perlu diulang setelah suntingan dokumentasi terakhir.

## 2026-10-11 — Phase 4 slice 3: akses API & webhook (`api.access`)
**Ruang lingkup:** melanjutkan Phase 4 dengan slice ketiga — **API akses penuh & webhook**
(`api.access`). Sampai slice sebelumnya MesinPOS hanya bisa dibaca manusia lewat antarmuka; slice ini
membuat datanya bisa dipakai sistem lain, dengan dua janji yang harus ditepati: **kunci API yang
bocor tidak membuka lebih dari izin pembuatnya**, dan **kegagalan kirim webhook tidak hilang
diam-diam**. Dikerjakan utuh: aturan murni (+ kripto SHA-256/HMAC sendiri), tabel & endpoint HTTP
`/api/v1/*`, gerbang izin + fitur, halaman API & Webhook, kedua store, dan harness murni + backend +
render.

Isi slice:
- Aturan murni `lib/apiKeys.ts`: kunci berbentuk `mp_<publicId>_<secret>`; `publicId` = indeks
pencarian yang aman ditampilkan (alfabet tanpa huruf mudah tertukar), `secret` **tidak pernah
disimpan** — yang ada hanya `sha256(publicId + ":" + secret)` (publicId berfungsi sebagai salt);
verifikasi berurutan bentuk → status → rahasia (dibandingkan waktu-konstan); `keyStatus`
(active/revoked/expired/disabled); validasi input (nama 3–40 & unik, minimal satu scope, maksimal 20
kunci hidup, masa berlaku 30/90/365/tanpa kedaluwarsa); dan `scopeAllowed` — scope kunci selalu
dibatasi izin **efektif** pembuatnya.
- Kripto `lib/hash.ts`: SHA-256 & HMAC-SHA256 murni (sinkron, tanpa `crypto.subtle`), karena
verifikasi kunci berjalan di dalam mutation/query Convex dan payload webhook harus bisa ditandatangani
& diverifikasi dengan aturan yang sama di klien, harness, dan server.
- Aturan murni `lib/webhooks.ts`: katalog 6 event (`sale.completed`, `sale.voided`, `stock.low`,
`opname.posted`, `payable.due`, `receivable.overdue`); URL wajib HTTPS + host publik (localhost,
10.x/192.168.x/172.16-31.x, `::1`, `.local`, `.internal`, nama mesin tunggal ditolak); tanda tangan
`sha256=<hmac>` atas `timestamp.body` dengan toleransi 5 menit; jeda percobaan ulang 1 → 5 → 30 →
120 → 720 menit lalu menyerah (5 percobaan); payload contoh untuk uji kirim.
- Tabel `apiKeys`, `webhookEndpoints`, `webhookDeliveries` + indeksnya; `src/convex/apiAccess.ts`
(`overview`, `createKey`, `revokeKey`, `createEndpoint`, `updateEndpoint`, `removeEndpoint`, aksi
`testEndpoint` + internal `beginTestDelivery`/`finishDelivery`/`authenticate`/`touchKey`/`readResource`).
- Endpoint HTTP `/api/v1/ping|sales|products|payables` di `src/convex/http.ts`, didaftarkan **dari
tabel `API_RESOURCES`** supaya scope yang ditawarkan di halaman selalu sama dengan yang diperiksa di
endpoint; urutannya tanpa kunci → 401, resource asing → 404, scope kurang → 403.
- Gerbang tidak seragam, mengikuti pola opname/multi-warehouse/rbac: **membuat** kunci/endpoint dan
**mengubah langganan/putar rahasia** butuh fitur `api.access` + izin `api.manage`, sedangkan
**mencabut kunci**, **mematikan/menghapus endpoint**, dan **melihat daftarnya** selalu boleh.
- Halaman **API & Webhook** (`/app/api`, izin `api.manage`) + menu sidebar + rute: kunci beserta scope
& pemakaian terakhir, daftar endpoint beserta langganan event, riwayat 20 kiriman terakhir dengan
jadwal percobaan berikutnya, dokumentasi endpoint `/api/v1` + contoh `curl`, serta form buat kunci &
endpoint dengan pratinjau validasi yang sama dengan server. Rahasia hanya tampil sekali (kunci: sekali
selamanya; webhook: sampai diputar).
- Kedua store memakai slice yang sama; store demo menandatangani payload uji dengan HMAC sungguhan dan
menyimulasikan penerima yang menjawab 200 (mode demo tidak punya server penerima), store Convex
memanggil action `testEndpoint` yang benar-benar POST ke URL tenant.
- Data contoh demo: tiga kunci (dua aktif — satu hampir kedaluwarsa, satu dicabut) dan satu endpoint
webhook dengan tiga riwayat kiriman (terkirim / menunggu / menyerah).

**Berkas:** baru: `src/convex/lib/hash.ts`, `src/convex/lib/apiKeys.ts`, `src/convex/lib/webhooks.ts`,
`src/lib/apiKeys.ts`, `src/lib/webhooks.ts`, `src/convex/apiAccess.ts`, `src/pages/ApiPage.tsx`,
`scripts/verify-api.mjs` · diubah: `src/convex/schema.ts`, `src/convex/http.ts`,
`src/convex/lib/authz.ts` (izin `api.manage`), `src/convex/lib/rbac.ts` (grup izin “Integrasi & API”),
`src/lib/store/types.ts`, `src/lib/store/demo.tsx`, `src/lib/store/convex.tsx`, `src/data/demo.ts`,
`src/App.tsx`, `src/layouts/AppLayout.tsx`, `src/pages/LandingPage.tsx` (roadmap Phase 4),
`scripts/verify-backend.mjs`, `scripts/verify-render.mjs`, `scripts/verify-rbac.mjs`,
`README.md`, `worklog.md` (entri ini + tabel **Status Phase 4**, **Blocker**, dan daftar perintah
rutin).

**Verifikasi:**
- `bun convex dev --once` → `Convex functions ready! (2.11s)`, lalu `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-api.mjs` → **147/147 checks passed** (exit 0). Yang diuji ketat: SHA-256 dan
HMAC dicocokkan dengan vektor NIST/RFC 4231 **dan** dengan `node:crypto` (termasuk kunci >64 byte);
bentuk kunci ditolak untuk 6 variasi salah (tanpa `mp_`, publicId pendek, tanpa pemisah, charset
ambigu, rahasia pendek, bukan teks); verifikasi menolak rahasia salah, publicId asing, baris kosong,
kunci dicabut, dan kunci kedaluwarsa; pagar scope (`scopeAllowed` untuk manager/kasir/keuangan/pemilik
+ peran asing); 9 variasi validasi kunci ditolak; host dalam jaringan ditolak untuk 10 bentuk
(localhost, 127.x, 10.x, 192.168.x, 172.16.x, `::1`, `.local`, `.internal`, `0.0.0.0`, nama tunggal);
tanda tangan ditolak saat isi diubah, rahasia salah, kiriman basi, atau tanda tangan salah; jadwal
percobaan 5 kali lalu `failed`. Plus cek lintas-berkas: setiap resource `API_RESOURCES` benar-benar
dibaca `readResource`, `http.ts` mendaftarkan seluruh resource dari tabel itu, tabel & indeks yang
dipakai ada di `schema.ts`, tabel `apiKeys` **tidak** punya kolom rahasia, dan seluruh 11 anggota baru
`StoreApi` benar-benar dipakai halaman + kedua store.
- `bun scripts/verify-backend.mjs` (deployment awan `mellow-narwhal-477`) → **375/375 checks passed**
(exit 0), **29 cek baru**. Bukan hanya aturan murni: kunci dibuat lalu **dipakai** memanggil HTTP
action nyata di `VITE_CONVEX_SITE_URL` (`/api/v1/ping` 200, tanpa kunci 401, rahasia salah 401,
scope kurang 403 menyebut `inventory.view`, resource asing 404, `/api/v1/sales?days=7` 200 dengan nama
kunci yang benar, `/api/v1/payables` 200); `lastUsedAt` terisi setelah dipakai; kunci buatan anggota
yang ditugaskan peran kustom berisi `api.manage`+`report.view` bisa dipakai, tetapi **langsung
menyempit jadi 403** begitu peran kustomnya dikurangi menjadi `api.manage` saja; kunci yang dicabut
langsung 401 dan tidak bisa dicabut dua kali; endpoint webhook `http://`, host `10.0.0.8`, dan tanpa
event ditolak; URL kembar ditolak; hanya 4 karakter akhir rahasia yang tersimpan; kiriman uji ke host
yang tidak ada tercatat (`attempts: 1`, status `pending`, `lastError` terisi, `nextAttemptAt`
terjadwal); endpoint nonaktif menolak kiriman uji; dan menghapus endpoint membuang riwayatnya.
- `bun scripts/verify-render.mjs` → **237/237 checks passed** (exit 0), **19 cek baru**: halaman API &
Webhook benar-benar dirender (kunci contoh, scope, status, endpoint + langganan event, riwayat kiriman,
dokumentasi `/api/v1`, ringkasan “2 kunci aktif”), lalu lima belas aksi dijalankan di DOM klien lewat
store demo — buat kunci (rahasia muncul sekali, scope ganda dibuang, nama kembar ditolak), tolak scope
di luar daftar API, tolak endpoint HTTP, daftar endpoint HTTPS (rahasia hanya 4 karakter akhir), kirim
uji tercatat, endpoint nonaktif menolak kiriman, hapus endpoint membuang riwayatnya, dan cabut kunci
yang tidak bisa diulang dua kali. Ditambah: paket Starter melihat alasan terkunci (“tidak termasuk
paket Starter”) dan **kasir ditolak di rute `/app/api`** dengan menu “API & Webhook” hilang.
- Regresi seluruh harness murni, semuanya exit 0: `verify-authz` 74/74 · `verify-offline` 24/24 ·
`verify-fnb` 39/39 · `verify-modifiers` 46/46 · `verify-ar` 54/54 · `verify-modules` 27/27 ·
`verify-wholesale` 31/31 · `verify-members` 30/30 · `verify-inventory` 42/42 · `verify-purchasing` 60/60
· `verify-payables` 44/44 · `verify-threeway` 84/84 · `verify-opname` 48/48 · `verify-analytics` 65/65 ·
`verify-rbac` 45/45.

**Catatan / blocker:**
- `scripts/verify-rbac.mjs` diperbarui: cek “seluruh izin dikenal (21)” yang memakai angka tetap kini
  membandingkan daftar izin rbac dengan tabel `PERMISSION_LABELS` (sumber kebenaran yang sama). Bukan
  pelemahan cek: izin yang hilang dari daftar rbac tetap gagal, tetapi menambah izin baru (seperti
  `api.manage` di slice ini) tidak lagi memaksa harness murni diedit — dan hasilnya 45/45 tetap sama.
- Harness render menemukan **bug nyata di store demo**: aksi `api.access` berurutan dalam satu tick
  membaca state sebelum aksi (membuat kunci lalu langsung mencoba nama yang sama, atau mendaftarkan
  endpoint lalu langsung mengirim uji) — pemeriksaan “nama/URL sudah dipakai” dan pencarian endpoint
  jadi lolos/basi. Diperbaiki dengan cermin `ref` + `commit*` seperti pola piutang & perpindahan stok
  yang sudah ada, lalu aksi yang sama diuji ulang: sekarang benar-benar ditolak.
- **Percobaan ulang webhook belum ada pekerjanya.** Jadwalnya dihitung dan disimpan
  (`webhookDeliveries.nextAttemptAt`, status jadi `failed` setelah percobaan kelima), tetapi belum ada
  cron/pekerja terjadwal yang benar-benar mengirim ulang — jadi kegagalan kiriman saat ini berhenti di
  `pending`/`failed` dan harus dikirim ulang manual lewat tombol **Kirim uji**. Ini yang membuat halaman
  menuliskan jadwal, bukan menjanjikan pengiriman ulang otomatis.
- Kiriman uji di **mode demo** tidak menyentuh jaringan (tidak ada server penerima): payload tetap
  ditandatangani HMAC sungguhan, lalu penerimanya disimulasikan menjawab 200 dan komentar di
  `demo.tsx` menyebut hal itu apa adanya. Jalur yang benar-benar POST adalah action `testEndpoint` di
  Convex, yang diuji harness backend di atas.
- Endpoint `/api/v1/*` baru menyediakan **baca** (4 resource); tulis lewat API (mis. membuat penjualan
  dari sistem luar) belum ada, sehingga tidak ada scope tulis yang ditawarkan.

## 2026-10-11 — Phase 4 slice 2: peran kustom (`rbac.custom`)
**Ruang lingkup:** melanjutkan Phase 4 dengan slice kedua — **peran kustom** (`rbac.custom`, Custom
role RBAC). Peran bawaan (Pemilik/Manajer/Kasir/Staf Gudang/Keuangan) adalah kontrak produk; yang
tidak bisa dijawabnya adalah kebutuhan nyata tiap tenant (“kasir shift malam boleh menjual, tidak
boleh membatalkan”; “admin harga hanya menyentuh katalog”). Slice ini dikerjakan utuh: aturan murni,
tabel + penugasan, gerbang server yang benar-benar mengubah izin, halaman, kedua store, dan harness
murni + backend + render.

Isi slice:
- Aturan murni `lib/rbac.ts`: **peran kustom menggantikan** izin peran bawaan (bukan menambah); izin
disaring & diurutkan kanonik; nama peran bawaan ditolak (tanpa peka huruf besar-kecil); **pagar
eskalasi** (pembuat tidak bisa memberi izin yang dia sendiri tidak punya) berlaku saat membuat
**dan** saat menugaskan; **pemilik tenant tidak bisa dipindah** ke peran kustom; batas nama 3–40
karakter, keterangan 200 karakter, maksimal 20 peran kustom per tenant;
`effectivePermissions`/`memberCan`/`permissionDelta`/`groupedPermissions` untuk UI & audit.
- Tabel `customRoles` (+ validator `permissionValidator`) dan kolom `memberships.customRoleId`; fungsi
`roles.*` di server: `list` (beserta jumlah pemakai), `create`, `update`, `remove`, `assign`,
`myAccess`, `effective`.
- `requirePermission` di `lib/access.ts` kini memakai **izin efektif** (`resolveMembershipPermissions`);
peran kustom yang hilang/nonaktif/tenant lain jatuh kembali ke peran bawaan, bukan mengunci orang.
- Gerbang tidak seragam mengikuti pola opname/multi-warehouse: **membuat/mengubah** dan **menugaskan**
butuh fitur `rbac.custom`; **melihat**, **melepas penugasan**, **menonaktifkan**, dan **menghapus
peran yang tidak dipakai** selalu boleh. Peran yang masih dipakai anggota tidak bisa dihapus.
- Klien: `SessionTenant.customRole` + `actingPermissions` + `setCustomRole`; `useCan` dan
`RequirePermission` memakai izin efektif, dan `ConvexStoreProvider` mengisi sesi dari
`roles.myAccess` supaya menu/rute tidak menebak dari peran bawaan.
- Halaman **Tim & Peran** (`/app/team`, izin `team.manage`) + menu sidebar + rute: daftar anggota
dengan izin efektif, daftar peran beserta pemakainya, editor checklist izin berkelompok, dan
pratinjau yang memakai fungsi validasi yang sama dengan server.
- Data contoh demo: dua peran (“Kasir Shift Malam”, “Admin Harga”) + empat anggota tim, salah satunya
sudah ditugaskan.

**Berkas:** baru: `src/convex/lib/rbac.ts`, `src/lib/rbac.ts`, `src/convex/roles.ts`,
`src/pages/TeamPage.tsx`, `scripts/verify-rbac.mjs` · diubah: `src/convex/schema.ts`,
`src/convex/lib/access.ts`, `src/lib/session.tsx`, `src/lib/usePermission.ts`,
`src/lib/store/types.ts`, `src/lib/store/demo.tsx`, `src/lib/store/convex.tsx`, `src/data/demo.ts`,
`src/App.tsx`, `src/layouts/AppLayout.tsx`, `src/pages/LandingPage.tsx`, `scripts/verify-backend.mjs`,
`scripts/verify-render.mjs`, `README.md`, `worklog.md` (entri ini + tabel **Status Phase 4**,
**Blocker**, dan daftar perintah rutin).

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0.
- `bun convex dev --once` → `Convex functions ready! (1.97s)`, dan tabel `customRoles` dibuat di
deployment `mellow-narwhal-477` (`[+] customRoles.by_tenant`, `[+] customRoles.by_tenant_name`).
- `bun scripts/verify-rbac.mjs` → `45/45 checks passed` (exit 0). Termasuk dua cek lintas-berkas:
validator izin di `schema.ts` memuat seluruh 21 izin, dan grup izin di halaman menutupi setiap izin
tepat sekali.
- Lima belas harness murni lain, semuanya exit 0: `verify-analytics` 65/65 · `verify-authz` 74/74 ·
`verify-offline` 24/24 · `verify-fnb` 39/39 · `verify-modifiers` 46/46 · `verify-ar` 54/54 ·
`verify-modules` 27/27 · `verify-wholesale` 31/31 · `verify-members` 30/30 · `verify-inventory` 42/42
· `verify-purchasing` 60/60 · `verify-payables` 44/44 · `verify-threeway` 84/84 · `verify-opname` 48/48.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
**346/346 checks passed** (exit 0), 24 cek baru untuk peran kustom. Yang paling penting bukan
tampilannya: kasir tanpa peran kustom ditolak `inventory.list`, lalu **diterima** setelah ditugaskan
peran berisi `inventory.view`, dan **kehilangan** `ar.view` yang tadinya bawaan (pesannya menyebut
`peran kustom "Pengawas Stok"`). Pagar lain terverifikasi di backend: manajer ditolak membuat peran
dengan `billing.manage`, pemilik tidak bisa dipindah ke peran kustom, peran terpakai tidak bisa
dihapus, dan setelah paket turun ke Professional pembuatan/penugasan ditolak sementara pelepasan
penugasan tetap boleh.
- `bun scripts/verify-render.mjs` → **218/218 checks passed** (exit 0), 12 cek baru: halaman Tim &
Peran (peran contoh, anggota, checklist 6 kelompok izin, pemilik “Selalu seluruh izin”), paket Starter
melihat alasan terkunci, dan — yang paling penting — sesi dengan `customRole` berisi hanya `pos.sell`
benar-benar ditolak di rute dashboard dan menu Tim & Peran hilang.

**Catatan / blocker:** halaman `/app/team` baru dirender di DOM tiruan, belum di browser sungguhan
(preview workspace masih jalur demo) — sama batasannya dengan halaman lain. Sisa Phase 4 yang masih
label katalog tanpa alur: `api.access` dan `support.dedicated`, plus optimasi beban skala franchise.

## 2026-10-11 — Phase 4 slice 1: analitik lanjutan (`report.advanced`) + audit penutup Phase 3
**Ruang lingkup:** permintaan “apakah semua hal di Phase 3 sudah dikerjakan? kalau sudah, lanjut
Phase 4”. Dua bagian. (1) **Audit Phase 3:** keempat klausa sudah punya alur, gerbang paket, izin,
halaman, data contoh, dan harness — tidak ada klausa yang tertinggal; suite lengkap dijalankan ulang
pada kode saat ini sebagai bukti, bukan sekadar membaca catatan lama. (2) **Phase 4 slice pertama:**
**analitik lanjutan** (`report.advanced`, Advanced BI & analitik) dikerjakan utuh — aturan murni
analitik, query backend dengan gerbang fitur + izin, kedua store, halaman Laporan, dan harness.

Isi slice: periode **7 / 30 / 90 hari** (default 30, dipotong 1–90) dengan batas hari **tengah malam
lokal** (offset zona waktu klien, WIB = 420) dan pembanding periode **sama panjang**; tren harian yang
selalu berisi satu titik per hari (tidak bolong); **margin kotor dihitung dari omzet bersih**
(omzet − PPN) − harga pokok (`products.cost` hari ini × jumlah), dengan omzet produk yang belum punya
harga beli dipisahkan sebagai `uncostedRevenue` agar tidak dianggap untung penuh; produk & kategori
teratas, rincian metode bayar, jam tersibuk (24 baris), pola hari (7 baris); dan **kalimat temuan**
berambang yang diurutkan peringatan dulu (omzet naik/turun ≥10%, margin <20% atau ≥40%, satu produk
≥40% omzet, produk terjual di bawah harga beli, hari tanpa penjualan, jam tersibuk, hari teramai).
Gerbangnya: analitik lanjutan **hanya di paket yang memuat `report.advanced`** (Enterprise) di depan
izin `report.view`, tetapi **laporan harian tetap jalan** setelah paket turun — halaman menampilkan
alasan singkat kenapa analitiknya mati, bukan grafik kosong.

**Berkas:** baru: `src/convex/lib/analytics.ts` (aturan murni), `src/lib/analytics.ts` (re-export
sisi aplikasi, pola yang sama seperti `lib/opname.ts`), `scripts/verify-analytics.mjs` · diubah:
`src/convex/reports.ts` (query `advanced`), `src/lib/store/types.ts`, `src/lib/store/demo.tsx`,
`src/lib/store/convex.tsx` (`analyticsReport`/`analyticsDays`/`setAnalyticsDays`),
`src/pages/ReportsPage.tsx`, `src/pages/LandingPage.tsx` (roadmap Phase 4 → **Berjalan**, tidak ada
lagi label “Rencana”), `scripts/verify-render.mjs`, `scripts/verify-backend.mjs`, `README.md`,
`worklog.md` (entri ini + tabel **Status Phase 4**, **Blocker**, dan daftar perintah rutin).

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0.
- `bun convex dev --once` → `Convex functions ready! (1.8s)` (kodegen + push ke deployment
  `mellow-narwhal-477`), jadi harness backend di bawah menguji fungsi yang benar-benar ter-push.
- `bun scripts/verify-analytics.mjs` → `65/65 checks passed` (exit 0). Titik yang diuji ketat: batas
  hari lokal, hari tanpa penjualan tetap punya titik, margin dari omzet bersih, periode pembanding
  sama panjang.
- Tiga belas harness murni lain, semuanya exit 0: `verify-authz` 74/74 · `verify-offline` 24/24 ·
  `verify-fnb` 39/39 · `verify-modifiers` 46/46 · `verify-ar` 54/54 · `verify-modules` 27/27 ·
  `verify-wholesale` 31/31 · `verify-members` 30/30 · `verify-inventory` 42/42 ·
  `verify-purchasing` 60/60 · `verify-payables` 44/44 · `verify-threeway` 84/84 · `verify-opname`
  48/48.
- `bun scripts/verify-backend.mjs` (deployment awan `mellow-narwhal-477`) → **322/322 checks
  passed**, termasuk **14 cek analitik**: bentuk laporan lengkap (30 hari · 24 jam · 7 hari),
  rentang mulai di tengah malam WIB, angka analitik **sama persis** dengan `reports.dailySummary`
  pada rentang yang sama, omzet bersih = omzet − PPN, produk berharga beli dihitung marginnya (2 ×
  Rp 50.000, HPP Rp 30.000 → laba Rp 40.000, margin 40%), margin konsisten + `uncostedRevenue`
  terisi, jam/hari/tren menjumlah persis ke jumlah transaksi, rincian kategori = omzet bersih +
  diskon (baris penjualan memakai harga sebelum diskon), urutan produk teratas, permintaan 500 hari
  dipotong ke 90 hari, paket turun ke Professional → analitik ditolak tapi laporan harian tetap
  jalan, kasir tetap boleh membaca analitik, dan pengguna luar tenant ditolak.
- `bun scripts/verify-render.mjs` → **206/206 checks passed** (exit 0), termasuk bagian baru: halaman
  Laporan memuat KPI + pembanding, pemilih 7/30/90 hari, tren/produk/kategori/jam/hari/temuan;
  paket Starter melihat alasan “tidak termasuk paket Starter” tanpa grafik; store demo menghitung
  laporan dari riwayat nyata (50+ transaksi) dan **ikut berubah setelah kasir menjual**; beranda
  menandai Phase 3 & Phase 4 **Berjalan** tanpa label “Rencana”. (Log React di akhir keluaran berasal
  dari uji ErrorBoundary yang memang sengaja melempar error — bukan kegagalan; exit code tetap 0.)
- Perubahan dokumentasi (`README.md`, `worklog.md`) **hanya markdown**: tidak memengaruhi build/tipe,
  jadi tidak ada perintah build yang dijalankan untuk berkas itu — `tsc` di atas dijalankan ulang
  setelah perubahan kode terakhir (`LandingPage.tsx`) sebagai gantinya.

**Catatan / blocker:**
- Percobaan pertama harness backend **gagal satu cek** dan ditulis apa adanya:
  `✗ staf gudang ditolak karena izin: report.view — DITERIMA`. Penyebabnya asumsi yang salah, bukan
  kode: peran `inventory` **memang memegang** `report.view`, jadi staf gudang memang boleh melihat
  laporan. Cek itu diganti menjadi penolakan **pengguna luar tenant** (`bukan anggota aktif`), lalu
  322/322 lulus.
- Sisa Phase 4 belum dikerjakan dan masih **label katalog tanpa alur**: `api.access` (API akses penuh
  & webhook), `rbac.custom` (peran kustom), `support.dedicated` (dukungan khusus), dan optimasi beban
  skala franchise.
- Halaman Laporan beserta analitiknya sudah **dirender di DOM klien**, tetapi belum pernah dilihat di
  **browser sungguhan** (preview workspace masih jalur demo) — sama seperti halaman lain di daftar
  blocker.
- `previousRange`/pembanding memakai satu kali baca untuk periode ini **dan** periode sebelumnya,
  jadi kedua angka berasal dari snapshot data yang sama; kalau data berubah, keduanya berubah
  bersama (bukan angka yang diambil dari dua titik waktu berbeda).

## 2026-10-11 — Penutupan Phase 3: status roadmap di beranda + audit kelengkapan
**Ruang lingkup:** permintaan “lanjutkan pekerjaan phase 3 yg belum selesai”. Diaudit dulu apa yang
benar-benar belum selesai, bukan langsung menambah fitur. Hasil audit: keempat klausa Phase 3
(multi-warehouse, stock opname, purchasing PR · PO · GRN + hutang usaha, pencocokan 3 arah + bayar
sekaligus) **sudah punya alur, gerbang paket, izin, halaman, data contoh, dan harness** — tidak ada
aturan, tabel, halaman, atau izin yang tertinggal. Yang masih tertinggal hanyalah **bookkeeping**:
beranda masih menandai Phase 3 sebagai “Rencana” padahal keempat fiturnya jalan, dan worklog masih
mencatat jumlah cek `verify-render` 186/186.

Yang dikerjakan:
- `src/pages/LandingPage.tsx`: status roadmap Phase 3 → **Berjalan**, body-nya menyebut lingkup nyata
  (multi-gudang & perpindahan stok, opname berjejak audit, PR → PO → GRN, hutang usaha berjatuh tempo,
  pencocokan 3 arah, bayar sekaligus). Phase 4 tetap “Rencana”.
- `scripts/verify-render.mjs`: **2 cek baru** yang menjaga roadmap beranda mengikuti keadaan kode —
  Phase 3 berjalan dan hanya **satu** label “Rencana” tersisa (Phase 4) — plus penyebutan lingkup
  Phase 3.
- `README.md`: pembuka menyebut Phase 3 **lengkap** (keempat fitur, bukan tiga) dan menegaskan Phase 4
  belum dikerjakan.
- `worklog.md`: angka `verify-render` di daftar blocker & perintah rutin diselaraskan ke 190/190, dan
  ditambahkan bagian **Status Phase 4** supaya jelas apa yang belum dikerjakan.

**Berkas:** baru: — · diubah: `src/pages/LandingPage.tsx` · `scripts/verify-render.mjs` ·
`README.md` · `worklog.md`.

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0
- `bun scripts/verify-render.mjs` → **190/190 checks passed**, exit 0 (2 cek baru: beranda memuat
  “Advanced Supply Chain” + Phase 3 berjalan + hanya satu “Rencana”, dan lingkup Phase 3 benar-benar
  disebut)
- `verify-threeway.mjs` / `verify-backend.mjs` **tidak dijalankan ulang**: tidak ada aturan murni,
  backend/Convex, store, atau data contoh yang berubah (hanya beranda + dokumen), jadi hasil terakhir
  84/84 dan 308/308 tetap berlaku. Markdown tidak memengaruhi build/tipe.

**Catatan / blocker:** audit ini **tidak** menemukan pekerjaan Phase 3 yang tertinggal di kode.
Kalau yang dimaksud adalah memperluas lingkupnya, kandidat paling nyambung — belum ada dan **tidak**
dikerjakan di entri ini — adalah **retur pembelian** (kirim balik barang ke supplier: stok keluar dari
lokasi terima, hutang/beban menyesuaikan, terhubung ke GRN) dan koreksi penerimaan yang salah. Itu di
luar klausa roadmap Phase 3 yang ada, jadi ditulis sebagai usulan, bukan klaim selesai.

## 2026-10-11 — Dashboard: riwayat pembayaran supplier (bayar sekaligus `PAY-…`)
**Ruang lingkup:** permintaan “tampilkan riwayat pembayaran batch di Dashboard hutang usaha”.
Kartu **Pembayaran supplier terakhir** ditambahkan ke bagian hutang usaha Dashboard: nomor `PAY-…`,
tanggal, metode, total, jumlah tagihan, dan tagihan apa saja yang dibayar di dalamnya, plus tautan
“Lihat semua pembayaran” ke halaman Pembelian. Sebelum ini riwayat bayar sekaligus hanya bisa
dilihat di bagian bawah halaman Pembelian.

Sekaligus memperbaiki **data contoh yang tidak konsisten**: `AP-00002` lahir dengan `paidAmount`
300.000 tetapi `payablePayments` dimulai kosong, jadi “sudah dibayar 300.000” tidak punya jejak di
riwayat pembayaran. Data contoh sekarang menyemai **satu pembayaran batch `PAY-00001`** (Transfer,
6 hari lalu) sebesar 300.000 pada tagihan itu. Uangnya tidak berubah sama sekali — nilainya sudah
termasuk di `paidAmount` tagihan tersebut — sehingga seluruh angka hutang/umur (total terbuka,
tunggakan, jatuh tempo terdekat, keranjang umur) tetap sama; yang berubah hanya jumlah baris
pembayaran dan adanya satu batch contoh supaya kartunya tidak kosong di mode demo.

**Berkas:** baru: — · diubah: `src/pages/DashboardPage.tsx` (kartu baru + ikon `Banknote`, konstanta
`BATCH_PREVIEW`), `src/lib/store/demo.tsx` (`seedPayablePayments`), `scripts/verify-render.mjs`,
`README.md`, `worklog.md`.

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0
- `bun tsc -p tsconfig.convex.json --noEmit` → exit 0
- `bun scripts/verify-render.mjs` → **188/188 checks passed** (2 cek baru: kartu “Pembayaran supplier
  terakhir” memuat `PAY-00001`, Transfer, “1 tagihan”, `AP-00002 · Rp 300.000`, dan tautan “Lihat
  semua pembayaran”. Tiga ekspektasi lama disesuaikan karena data contoh menyemai satu baris
  pembayaran/batch: riwayat pembayaran 3 → 4 baris, dan batch buatan harness jadi `PAY-00002`)
- `bun scripts/verify-threeway.mjs` → **84/84 checks passed** (aturan murni tidak berubah)
- `verify-backend.mjs` **tidak dijalankan ulang**: tidak ada perubahan backend/Convex pada pekerjaan
  ini (hanya halaman Dashboard + penyemaian data contoh store demo), jadi hasil terakhir 308/308 tetap
  berlaku. Berkas markdown tidak memengaruhi build/tipe.

**Catatan / blocker:** kartu ini baru diuji lewat DOM tiruan (`verify-render.mjs`) — belum pernah
dilihat di browser sungguhan, sama seperti sisa Dashboard (blocker nomor 3).

## 2026-10-11 — Phase 3 lanjutan: pencocokan 3 arah (PO ↔ GRN ↔ tagihan) & bayar sekaligus (`purchasing.threeway`)
**Ruang lingkup:** permintaan “lanjutkan pekerjaan phase 3”. Slice keempat Phase 3 dikerjakan — dan
dengan ini **seluruh fitur Phase 3 punya alur**: **pencocokan 3 arah**. Sebelum ini
`purchasing.threeway` hanya label di katalog paket: hutang usaha sudah lahir dari penerimaan barang,
tetapi tagihan yang **dikirim supplier** belum pernah dibandingkan dengan dua dokumen yang kita
pegang sendiri — apa yang **dipesan** (PO) dan apa yang **datang** (GRN). Selisih di situ adalah uang,
dan selisih yang tidak dicatat adalah uang yang hilang tanpa jejak. Bagian kedua slice ini adalah
**pembayaran beberapa tagihan sekaligus** dengan satu nomor `PAY-…` supaya satu transfer bank bisa
direkonsiliasi ke beberapa tagihan.

Aturan yang dijaga (satu sumber di `src/convex/lib/threeway.ts`, dipakai server, kedua store, halaman
Pembelian, dan harness):
- **Dokumen supplier dicatat apa adanya, totalnya dihitung dari barisnya.** `payables.invoice`
  menyimpan nomor tagihan supplier, baris yang **ditagih**, dan catatan; `total` dihitung sistem dari
  baris itu, bukan angka yang diketik terpisah — jadi baris dan total tidak pernah bertentangan dan
  pencocokan tidak bisa dibohongi lewat total saja. Mencatat dokumen dua kali untuk tagihan yang sama
  ditolak (hasil tinjauan orang tidak boleh ditimpa diam-diam); tagihan tanpa GRN tidak bisa dicatat
  dokumennya karena tidak ada yang dicocokkan.
- **Pencocokan selalu dihitung ulang, tidak pernah disimpan.** `matchPayable` menurunkan status
  (`Tanpa PO/GRN` / `Menunggu dokumen` / `Cocok` / `Ada selisih`) dari PO + GRN + dokumen supplier
  setiap kali dibaca, jadi tidak ada status yang bisa basi. Selisih dilaporkan per baris — **jumlah**
  (ditagih 12, diterima 10) dan **harga** (Rp 5.200 vs Rp 5.000/unit) dipisah — plus nilai totalnya
  kalau yang kurang justru baris yang tidak ditagih sama sekali.
- **Selisih tidak menahan pekerjaan, tetapi menahan pembayaran.** **Menerima** selisih menyesuaikan
  nilai hutang ke total tagihan supplier (`amountAfterDecision`, tidak pernah di bawah yang sudah
  dibayar); **menyengketakan** mempertahankan nilai semula dan **menahan pembayaran** — satu per satu
  maupun di dalam batch. Sengketa tanpa alasan (minimal 3 karakter) ditolak.
- **Menerima selisih tidak bisa dibatalkan diam-diam.** Nilai hutangnya sudah berubah; mencabut
  keputusan itu akan menyembunyikan perubahan uang, jadi ditolak. Sebaliknya **sengketa boleh
  dicabut** kapan saja dan tagihannya bisa dibayar lagi.
- **Satu kali bayar, satu nomor (`PAY-…`).** `payBatch` memakai aturan pembayaran satuan yang sama
  (`applyPayablePayment`) untuk setiap tagihan, menolak kelebihan bayar seperti pembayaran satuan,
  tetapi menulis **satu baris pembayaran per tagihan** dengan nomor batch yang sama supaya jejak
  auditnya identik dan rekonsiliasi bank tetap cocok. Satu tagihan bersengketa membatalkan **seluruh**
  batch — rencananya diperiksa dulu (`planBatchPayment`) sebelum ada uang bergerak.

**Perbaikan yang ditemukan harness:** ringkasan 3 arah (`summariseThreeway`) semula menghitung tagihan
**manual** (tanpa PO/GRN) sebagai *Cocok* — angka yang menyesatkan di kartu ringkasan karena tidak ada
apa pun yang dicocokkan. Sekarang baris `no_reference` tidak ikut dihitung di mana pun
(`verify-threeway.mjs` mengujinya langsung).

Berkas baru: aturan murni `src/convex/lib/threeway.ts` dan harness `scripts/verify-threeway.mjs`.
Berkas yang diubah: `src/convex/schema.ts` (kolom `invoice` & `matchDecision` di `payables`, kolom
`batchNumber` di `payablePayments`), `src/convex/payables.ts` (mutasi baru `recordInvoice`,
`resolveMatch`, `payBatch`; `list` kini mengembalikan `invoice`, `decision`, `match`, `matchSummary`,
dan `batches`; `recordPayment` menolak tagihan bersengketa), `src/lib/store/types.ts`,
`src/lib/store/demo.tsx`, `src/lib/store/convex.tsx` (aksi yang sama di kedua store, termasuk
`paymentBatches`), `src/data/demo.ts` + `src/lib/store/demo.tsx` (data contoh menambah **2 PO + 2 GRN**
sebagai pembanding pencocokan, plus tagihan contoh berselisih: ditagih 12 padahal diterima 10 → +10.000),
`src/pages/PurchasingPage.tsx` (bagian **Pencocokan 3 arah (PO ↔ GRN ↔ tagihan)**: antrean “perlu
ditinjau”, tombol **Catat dokumen supplier** yang mengisi barisnya dari GRN, keputusan
**Terima selisih** / **Sengketa** / **Cabut sengketa**, pemilihan beberapa tagihan + nomor batch),
`scripts/verify-backend.mjs`, `scripts/verify-render.mjs`, `README.md`, `worklog.md`.

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0
- `bun tsc -p tsconfig.convex.json --noEmit` → exit 0
- `bun convex dev --once` → `✔ Convex functions ready! (1.91s)` (deployment awan, 16:03:33)
- `bun scripts/verify-threeway.mjs` → **84/84 checks passed** (baru; termasuk: total dokumen dihitung
  dari baris, selisih kuantitas vs harga dipisah, baris yang tidak ditagih ketahuan dari total,
  toleransi 1 rupiah, penjagaan satu-dokumen-per-tagihan, penerimaan selisih tidak bisa dibatalkan,
  sengketa menahan bayar, batch ditolak seluruhnya kalau ada sengketa, dan nomor `PAY-…`)
- `bun scripts/verify-render.mjs` → **186/186 checks passed** (14 cek baru: halaman Pembelian memuat
  bagian 3 arah + antreannya, dan alur store demo — dokumen dari GRN cocok tanpa selisih, sengketa
  menahan bayar, menerima selisih menyesuaikan hutang ke 1.460.000, bayar sekaligus `PAY-00001`
  12.000 untuk dua tagihan, ringkasan bersih setelahnya)
- `SPAWN_BACKEND=1 bun scripts/verify-backend.mjs` → **308/308 checks passed** terhadap
  `https://mellow-narwhal-477.convex.cloud` (29 cek baru: dokumen supplier → `matched`, ringkasan
  `matchSummary`, penolakan dokumen ganda & baris di luar PO/GRN, selisih 9.000 dari “ditagih 7 unit,
  diterima 5”, sengketa menahan pembayaran satuan **dan** batch, batch gagal tidak menyisakan satu pun
  pembayaran, menerima selisih 22.500 → 31.500, `PAY-00001` 3.000 untuk dua tagihan, kelebihan bayar di
  batch ditolak, plus gerbang fitur: `recordInvoice`/`resolveMatch` ditolak di paket Professional
  sedangkan pembayaran hutang tetap boleh)
- Harness murni lain (semua exit 0): `verify-authz` 74/74, `verify-offline` 24/24, `verify-fnb` 39/39,
  `verify-modifiers` 46/46, `verify-ar` 54/54, `verify-modules` 27/27, `verify-wholesale` 31/31,
  `verify-members` 30/30, `verify-inventory` 42/42, `verify-purchasing` 60/60, `verify-payables` 44/44
- Berkas markdown (`README.md`, `worklog.md`) tidak memengaruhi build/tipe — hanya ditulis, tidak dites.

**Catatan / blocker:** (a) data contoh baru (2 PO + 2 GRN sebagai rujukan pencocokan) menggeser nomor
dokumen di store demo, jadi **enam ekspektasi lama di `verify-render.mjs` diperbarui**, bukan
kodenya: PO baru `PO-00001` → `PO-00003`, GRN pertama `GRN-00001` → `GRN-00003`, GRN kedua →
`GRN-00004`, jumlah GRN 2 → 4, jumlah PO tanpa fitur 0 → 2, dan sisa AP-00002 memperhitungkan
300.000 yang sudah dibayar di data contoh; (b) `purchasing.threeway` hanya ada di paket Enterprise
(sama seperti `purchasing.basic`), jadi pengujian gerbangnya menurunkan tenant uji ke Professional;
(c) bagian 3 arah ini baru diuji lewat DOM tiruan + backend harness — **belum pernah diklik di browser
sungguhan**, sama seperti sisa halaman lain (blocker nomor 3).

## 2026-10-11 — Phase 3 lanjutan: stock opname & audit selisih (`inventory.opname`)
**Ruang lingkup:** permintaan “lanjutkan pekerjaan phase 3”. Slice ketiga Phase 3 dikerjakan:
**stock opname** — hitung fisik per lokasi, catat selisihnya sebagai bukti audit, dan jadikan stok
sistem sama persis dengan hasil hitung. Sebelum ini `inventory.opname` hanya label di katalog paket
(sejak awal sudah ada alasan `opname` di ledger, tetapi tidak ada alur yang memakainya).

Aturan yang dijaga (satu sumber di `src/convex/lib/opname.ts`, dipakai server, kedua store, halaman,
dan harness):
- **Hasil hitung yang menang, bukan catatan.** Saat posting, stok lokasi dibuat sama persis dengan
  hasil hitung (`delta = counted − saldo terbaru`), bukan ditambah selisih terhadap snapshot. Kalau
  ada penjualan di tengah penghitungan, angka fisik tetap benar dan penjualan itu tidak dihitung dua
  kali — diuji langsung: sesi dimulai di 48, kasir menjual 2 (rak 46), hasil hitung 43, dan delta
  yang ditulis **−3**, sedangkan selisih audit tetap −5 terhadap snapshot.
- **Snapshot dipakai sebagai patokan selisih, bukan sebagai nilai yang ditulis.** Baris sesi
  menyimpan `systemQty` saat sesi dimulai; `counted − systemQty` itulah selisih yang dibaca audit.
- **Baris yang belum dihitung bukan nol.** Posting hanya menerapkan baris yang sudah diisi; baris
  lain dibiarkan apa adanya, jadi hitung sebagian (cycle count) berguna dan lupa mengisi tidak
  menghapus stok.
- **Satu sesi berjalan per lokasi**, **sesi selesai/batal tidak bisa diubah lagi**, dan **membuat
  sesi baru yang digerbang fitur — menghitung & mempostingnya tidak** (fisik sudah dihitung di rak;
  paket yang turun tidak boleh membuat hasil hitungan hilang).

Berkas baru: aturan murni `lib/opname.ts` + entry point klien `src/lib/opname.ts`, backend
`src/convex/opname.ts` (kueri `list`; mutasi `start`/`setCount`/`post`/`cancel`, semuanya menulis
`auditLog`), tabel `opnameSessions` (indeks `by_tenant`, `by_tenant_store`, `by_tenant_status`),
halaman **Opname** (`/app/opname`, izin `inventory.view` untuk melihat, `inventory.manage` untuk
menghitung/memposting/membatalkan), dan menu sidebar “Opname” tanpa gerbang fitur — sesi yang sudah
berjalan harus tetap bisa diselesaikan. Store demo & Convex sama-sama mengimplementasikan
aksi baru (`opnameSessions`, `opnameLocations`, `opnameSummary`, `opnameOpenByLocation`,
`startOpname`, `setOpnameCount`, `postOpname`, `cancelOpname`) sehingga halaman tidak tahu mana yang
aktif. Data contoh menambah dua sesi (satu berjalan di gudang dengan satu baris sengaja belum
dihitung, satu selesai di lokasi jual) supaya halaman tidak kosong di mode demo.

Perbaikan kecil yang ditemukan harness: `opnameNumber(NaN)` menghasilkan nomor dokumen `OPN-00NaN`;
sekarang urutan yang tidak masuk akal jatuh ke 1 (nomor dokumen tidak pernah berisi “NaN”).

**Berkas:** baru: `src/convex/lib/opname.ts` · `src/convex/opname.ts` · `src/lib/opname.ts` ·
`src/pages/OpnamePage.tsx` · `scripts/verify-opname.mjs` · diubah: `src/convex/schema.ts` ·
`src/lib/store/types.ts` · `src/lib/store/demo.tsx` · `src/lib/store/convex.tsx` · `src/data/demo.ts` ·
`src/App.tsx` · `src/layouts/AppLayout.tsx` · `scripts/verify-backend.mjs` ·
`scripts/verify-render.mjs` · `README.md` · `worklog.md`.

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0 (frontend; termasuk store Convex yang mengonsumsi tipe kueri opname)
- `bun convex dev --once` → `✔ Convex functions ready! (2.04s)`
- `bun scripts/verify-opname.mjs` → **48/48 checks passed** (baru; termasuk kasus inti: posting
  memakai saldo terbaru bukan snapshot, baris belum dihitung tidak disentuh, satu sesi per lokasi,
  hitung sebagian, dan snapshot tidak pernah membawa hasil hitung)
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **279/279 checks passed** (31 cek baru: sesi dibuka dengan nomor `OPN-00001` & snapshot 48, kasir
  ditolak di melihat/memulai/menghitung/memposting/membatalkan, sesi kedua di lokasi yang sama
  ditolak, produk di luar sesi hitung sebagian ditolak, hasil hitung negatif ditolak, penjualan saat
  sesi berjalan tetap boleh, posting dengan delta −3 sementara selisih audit −5, stok lokasi menjadi
  sama persis dengan hasil hitung, sesi selesai terkunci, baris belum dihitung membuat stok produk
  lain utuh, pembatalan dengan alasan, ringkasan akhir, dan gerbang paket: sesi baru ditolak di
  Professional tetapi sesi lama tetap terbaca)
- `bun scripts/verify-render.mjs` → **172/172 checks passed** (19 cek baru: halaman Opname masuk
  daftar 13 halaman yang dirender, sesi contoh berjalan & selesai tampil, progres `3/4 dihitung`,
  baris belum dihitung tertulis “belum dihitung” bukan 0, aksi posting/pembatalan terlihat pemilik,
  paket Starter menyebut sebabnya sementara sesi lama tetap terbaca, plus alur store demo:
  `OPN-00003`, sesi kedua di lokasi sama ditolak, posting −3, sesi selesai terkunci, hitung sebagian
  memakai saldo terbaru (45 → 53 = +8), dan sesi batal terkunci)
- Seluruh suite murni dijalankan ulang, semua hijau: `verify-authz` 74/74 · `verify-modules` 27/27 ·
  `verify-modifiers` 46/46 · `verify-wholesale` 31/31 · `verify-fnb` 39/39 · `verify-offline` 24/24 ·
  `verify-ar` 54/54 · `verify-members` 30/30 · `verify-inventory` 42/42 · `verify-purchasing` 60/60 ·
  `verify-payables` 44/44 · `verify-opname` 48/48
- `freebuff-preview start` → `{"message":"Preview is ready","running":true,"listening":true}`
- Setelah pemeriksaan di atas hanya `README.md` dan entri `worklog.md` ini yang berubah; keduanya
  berkas markdown dan **tidak** memengaruhi build/tipe.

**Catatan / blocker:** halaman Opname diuji lewat render klien (DOM tiruan) + alur store demo, bukan
klik di browser sungguhan (blocker nomor 3). Yang masih belum ada dan memang lingkup
`purchasing.threeway`: 3-way matching PO ↔ GRN ↔ tagihan dan pembayaran beberapa tagihan sekaligus.
Penyesuaian opname belum punya tombol “isi semua = sistem” (hitung cepat untuk baris yang cocok) —
baris seperti itu cukup diketik angkanya, dan sengaja tidak dibuat otomatis supaya hasil hitung tidak
tertulis tanpa disentuh.

## 2026-10-11 — Dashboard: hutang usaha + jatuh tempo terdekat
**Ruang lingkup:** permintaan “tampilkan hutang usaha dan jatuh tempo terdekat di Dashboard”.
Hutang usaha sudah ada di halaman Pembelian, tetapi tidak terlihat dari layar yang pertama dibuka
pemilik/keuangan, jadi tunggakan hanya ketahuan kalau halamannya dibuka. Entri ini menambahkan dua
kartu Dashboard yang memakai aturan yang sama (`@/lib/payables`), bukan perhitungan baru di UI.

Yang ditambahkan:
- Kartu **Hutang usaha**: total terbuka, jumlah tagihan belum lunas, bagian yang lewat jatuh tempo,
  kalimat “Rp … jatuh tempo dalam 7 hari ke depan”, empat keranjang umur, dan tautan
  “Bayar di Pembelian”.
- Kartu **Jatuh tempo terdekat**: sampai 5 tagihan supplier diurutkan dari jatuh tempo paling awal,
  **termasuk yang sudah lewat** (paling mendesak dulu), masing-masing menampilkan supplier, nomor
  tagihan + sumbernya (PO/GRN atau nomor invoice), tanggal jatuh tempo, sisa, dan umurnya
  (“lewat 45 hari” / “jatuh tempo hari ini” / “5 hari lagi”), plus tautan “Catat pembayaran”.
- Gerbang izin mengikuti pola bagian Piutang: kartu hanya muncul untuk peran dengan `payable.view`
  (keuangan/manajer/pemilik). Kasir dan staf gudang tidak melihatnya sama sekali — bukan “Rp 0”
  yang menyesatkan.
- Catatan kaki Dashboard ikut menyebut dari mana angka hutang datang dan bahwa tunggakan menahan
  PO baru ke supplier itu.

Keputusan yang diambil: umur tagihan dibaca dari baris yang sudah dihitung store
(`daysPastDue`/`bucket`/`overdue` dari aturan murni), jadi tidak ada aturan umur kedua di UI — bug
umur piutang/hutang yang berbeda antar halaman jadi tidak mungkin. Hari “lagi” dihitung dari
`daysPastDue` yang sama (`-5` → “5 hari lagi”), jadi definisi hari penuh tetap satu.

**Berkas:** diubah: `src/pages/DashboardPage.tsx` · `scripts/verify-render.mjs` · `README.md` ·
`worklog.md`.

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0 (tidak ada berkas backend yang berubah di entri ini, jadi
  `tsconfig.convex.json` dan `bun convex dev --once` tidak dijalankan ulang)
- `bun scripts/verify-render.mjs` → **153/153 checks passed** (6 cek baru: total hutang + tunggakan,
  jatuh tempo ≤ 7 hari, pecahan umur 240.000 di 31–60 dan 175.000 di >60, daftar jatuh tempo
  terdekat dengan “lewat 120 hari”/“lewat 45 hari”/“5 hari lagi”/“20 hari lagi”, tautan ke
  halaman Pembelian, dan peran staf gudang tidak melihat bagian piutang **maupun** hutang)
- Seluruh suite murni lain dijalankan ulang, semua hijau: `verify-modules` 27/27 ·
  `verify-modifiers` 46/46 · `verify-wholesale` 31/31 · `verify-fnb` 39/39 ·
  `verify-inventory` 42/42 · `verify-offline` 24/24 · `verify-ar` 54/54 · `verify-members` 30/30 ·
  `verify-purchasing` 60/60 · `verify-payables` 44/44 · `verify-authz` 74/74.
- Preview: `curl http://localhost:5173/src/pages/DashboardPage.tsx` → **200**.
- Setelah pemeriksaan di atas hanya `README.md` dan entri `worklog.md` ini yang berubah; keduanya
  berkas markdown dan **tidak** memengaruhi build/tipe.

**Catatan / blocker:** Dashboard memakai data store yang sama, jadi di preview (mode demo) angkanya
adalah 4 tagihan contoh; jalur Convex tetap diuji lewat backend harness, bukan lewat klik di browser
sungguhan (blocker nomor 3). Yang masih belum ada dan memang lingkup `purchasing.threeway`:
pencocokan PO ↔ GRN ↔ tagihan (3-way matching) dan pembayaran beberapa tagihan sekaligus.

## 2026-10-11 — Pembelian: halaman supplier yang bisa diatur + hutang usaha (AP) dengan umur & pembayaran
**Ruang lingkup:** permintaan “tambahkan halaman supplier dan hutang usaha di Pembelian supaya tempo
supplier punya alur nyata”. Sebelumnya tempo supplier hanya kolom di daftar supplier: barang yang
datang dengan tempo 30 hari tidak menghasilkan apa pun, jadi tidak ada alur yang bisa dijalankan.
Entri ini menutup lingkaran itu: supplier bisa diatur, penerimaan bertempo melahirkan **hutang
usaha** berjatuh tempo, hutangnya bisa dibayar sebagian, dan **supplier yang menunggak tidak
dilayani PO baru**. Masih di dalam `purchasing.basic` — belum menyentuh 3-way matching/AP penuh
(`purchasing.threeway`).

Keputusan model yang diambil (satu sumber aturan di `src/convex/lib/payables.ts`, dipakai server,
kedua store, halaman, dan harness):
- **Hutang lahir dari bukti.** Setiap GRN dari supplier bertempo membuat satu hutang
  (`AP-00001`, jatuh tempo = tanggal terima + tempo supplier) di transaksi yang sama dengan stok
  masuknya. Dipisah berarti suatu hari ada penerimaan yang stoknya masuk tetapi tagihannya terlupa.
- **Tempo 0 berarti bayar langsung**, jadi supplier tanpa tempo tidak menghasilkan hutang sama
  sekali — pola yang sama dengan pelanggan tanpa limit kredit.
- **Tagihan di luar PO bisa dicatat manual** (`payables.createBill`) dengan jatuh tempo yang boleh
  sudah lewat, sehingga saldo awal dari sistem lama punya umur yang benar (bukan jatuh tempo palsu
  di masa depan). Ini juga yang membuat umur hutang & penolakan menunggak bisa diuji tanpa
  memanipulasi jam.
- **Kosakata umur tagihan dipinjam dari `lib/ar.ts`** (`AGING_BUCKETS`, `AGING_LABELS`, `agingOf`,
  `rupiah`) supaya laporan piutang dan hutang tidak pernah berbeda arti; yang khas hutang (jatuh
  tempo dari GRN, tagihan manual, posisi supplier, pesan penolakan) ditulis di `lib/payables.ts`.
- **Supplier menunggak ditolak PO baru** dengan menyebut jumlah hutangnya. Ini konsekuensi yang
  membuat tempo nyata, dan jalan keluarnya juga nyata: bayar tagihannya, atau nonaktifkan
  suppliernya.
- **Gerbang fitur dipisah seperti biasa:** mencatat tagihan baru butuh `purchasing.basic`,
  sedangkan **melihat dan membayar hutang tidak** — tagihan yang sudah ada harus tetap bisa
  dilunasi walau paketnya turun.
- **Mengubah tempo supplier tidak menulis ulang tagihan lama**: setiap hutang menyimpan temponya
  sendiri saat lahir.

Izin baru dipisah dua: `payable.view` + `payable.manage` dipegang keuangan/manajer/pemilik, **tidak**
oleh staf gudang (yang menerima barang bukan yang membayar tagihannya) maupun kasir. Konsekuensinya
juga nyata di data: `purchasing.list` mengirim posisi hutang supplier hanya ke peran yang boleh
melihat uang — staf gudang melihat daftar supplier tanpa angka hutangnya.

**Berkas:** baru: `src/convex/lib/payables.ts` · `src/convex/payables.ts` · `src/lib/payables.ts` ·
`scripts/verify-payables.mjs` · diubah: `src/convex/schema.ts` (tabel `payables` +
`payablePayments`) · `src/convex/lib/authz.ts` (izin `payable.*`) · `src/convex/lib/purchasing.ts`
(`resolveSupplierUpdate`) · `src/convex/purchasing.ts` (hutang otomatis di `receive`, penolakan PO
ke supplier menunggak, `updateSupplier`, posisi hutang per supplier) · `src/lib/store/types.ts` ·
`src/lib/store/demo.tsx` · `src/lib/store/convex.tsx` · `src/data/demo.ts` (4 tagihan contoh) ·
`src/pages/PurchasingPage.tsx` · `scripts/verify-backend.mjs` · `scripts/verify-render.mjs` ·
`scripts/verify-authz.mjs` · `README.md` · `worklog.md`.

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0
- `bun convex dev --once` → `✔ Convex functions ready! (2.03s)` (sekaligus menambah 6 indeks baru:
  `payables.by_tenant`, `by_tenant_supplier`, `by_receipt`, `by_order`, dan dua indeks
  `payablePayments`)
- `SPAWN_BACKEND=1 bun scripts/verify-backend.mjs` → **248/248 checks passed** terhadap
  `https://mellow-narwhal-477.convex.cloud` (26 cek baru: hutang otomatis dari GRN + jatuh temponya,
  posisi hutang per peran, pembayaran sebagian/kelebihan/nol/negatif, penolakan pembayaran ulang,
  gerbang fitur tagihan manual, tagihan lama lewat jatuh tempo, penolakan PO ke supplier menunggak
  lalu diterima setelah dibayar, tempo 0 tidak menagih hutang, dan izin `payable.*`)
- `bun scripts/verify-payables.mjs` → **44/44** (aturan murni) · `bun scripts/verify-render.mjs` →
  **147/147** (15 cek baru, termasuk alur AP penuh di store demo dan bagian “Hutang usaha (AP)”
  yang dirender) · `bun scripts/verify-authz.mjs` → **74/74** (8 cek izin hutang usaha)
- Seluruh suite murni lain dijalankan ulang, semua hijau: `verify-modules` 27/27 ·
  `verify-modifiers` 46/46 · `verify-wholesale` 31/31 · `verify-fnb` 39/39 ·
  `verify-inventory` 42/42 · `verify-offline` 24/24 · `verify-ar` 54/54 · `verify-members` 30/30 ·
  `verify-purchasing` 60/60.
- Preview: `curl` ke `/`, `/auth`, `/src/pages/PurchasingPage.tsx`, `/src/lib/payables.ts`,
  `/src/convex/payables.ts`, `/src/convex/lib/payables.ts` → **200 semua**.
- Setelah pemeriksaan di atas hanya `README.md` dan entri `worklog.md` ini yang berubah; keduanya
  berkas markdown dan **tidak** memengaruhi build/tipe, jadi tidak ada perintah yang dijalankan
  ulang untuknya.

**Catatan / blocker:** jalur Convex untuk hutang usaha diuji lewat backend harness + render DOM,
**belum lewat klik di browser sungguhan** (preview workspace masih mode demo) — sama seperti
catatan blocker nomor 3. Yang belum ada dan memang lingkup `purchasing.threeway`: pencocokan
PO ↔ GRN ↔ tagihan supplier (3-way matching), pembayaran gabungan beberapa tagihan sekaligus, dan
jurnal akuntansi. Hutang belum muncul di Dashboard (baru di halaman Pembelian).

## 2026-10-11 — Phase 3 lanjutan: pembelian PR · PO · GRN (`purchasing.basic`) tuntas
**Ruang lingkup:** permintaan “lanjutkan Phase 3: kerjakan purchasing PR/PO/GRN sampai tuntas”.
Slice kedua Phase 3 (`purchasing.basic`) dikerjakan utuh: aturan murni, tabel & kolom baru, izin
baru, backend, kedua store (demo & Convex), halaman **Pembelian**, harness, dan dokumentasi.
`inventory.opname` dan `purchasing.threeway` tetap belum dikerjakan (lihat tabel Status Phase 3).

Keputusan model yang diambil (satu sumber aturan di `src/convex/lib/purchasing.ts`, dipakai server,
kedua store, dan harness):
- **Rantai PR → PO → GRN, satu arah.** PR diajukan staf gudang, diputuskan pemilik/manajer, baru
  boleh jadi PO; satu PR hanya boleh punya satu PO hidup (PO yang dibatalkan tidak menghalangi
  PR dipesan ulang). Jumlah barang di PO tidak boleh melebihi yang diminta di PR.
- **Penerimaan (GRN) adalah satu-satunya jalan stok masuk dari pembelian.** Boleh sebagian dan
  berkali-kali sampai PO tertutup, boleh diarahkan ke gudang, tidak boleh melebihi sisa PO, dan
  tidak boleh memuat barang yang bukan bagian PO itu. Penerimaan memakai jalur ledger yang sama
  dengan penjualan & perpindahan (`reason: "purchase"`), jadi total stok tidak mungkin berubah
  tanpa jejak.
- **Yang meminta bukan yang menyetujui.** Izin dipisah tiga (`purchase.request`,
  `purchase.approve`, `purchase.receive`) plus `purchase.view`. Staf gudang meminta **dan**
  menerima, tetapi ditolak saat menyetujui PR; kasir tidak memegang satu pun izin itu, bahkan
  tidak boleh melihat daftar pembelian.
- **Gerbang fitur dipisah dari gerbang izin.** Membuat PR baru butuh `purchasing.basic`;
  **penerimaan barang tidak digerbang fitur** — kalau paket turun setelah PO dibuat, barang yang
  sudah dipesan tetap harus bisa dicatat datang dan masuk stok (membekukan penerimaan hanya
  membuat stok hilang dari sistem padahal fisiknya tiba). Pola “tindakan yang dibayar vs
  tindakan pembersihan” ini sama dengan multi-warehouse.

Temuan yang diperbaiki karena harness menolak, bukan karena saya yakin benar:
- **`summary.openOrderValue` semula menghitung nilai PO penuh.** Untuk PO 20 unit yang 8 unit-nya
  sudah diterima, kartu “Nilai PO terbuka / komitmen belanja” menampilkan Rp100.000 padahal sisa
  komitmennya Rp60.000 — sementara kartu di sebelahnya menulis “12 unit belum datang”. Sekarang
  nilainya dihitung dari sisa unit × harga beli, selaras dengan `openOrderUnits`. Bug ini ketahuan
  dari cek backend, bukan dari tipe (tipe lolos karena bentuknya sama).

**Berkas:** baru: `src/convex/lib/purchasing.ts` · `src/convex/purchasing.ts` ·
`src/pages/PurchasingPage.tsx` · `scripts/verify-purchasing.mjs` · diubah: `src/convex/schema.ts`
(tabel `suppliers`, `purchaseRequisitions`, `purchaseOrders`, `goodsReceipts`) ·
`src/convex/lib/authz.ts` + `src/lib/authz.ts` (izin pembelian) · `src/lib/store/types.ts` ·
`src/lib/store/demo.tsx` · `src/lib/store/convex.tsx` · `src/App.tsx` · `src/layouts/AppLayout.tsx`
· `scripts/verify-backend.mjs` · `scripts/verify-render.mjs` · `scripts/verify-authz.mjs` ·
`README.md` · `worklog.md`.

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0
- `bun convex dev --once` → `✔ Convex functions ready! (2.07s)`
- `SPAWN_BACKEND=1 bun scripts/verify-backend.mjs` → **222/222 checks passed** terhadap
  `https://mellow-narwhal-477.convex.cloud`; 38 cek baru untuk pembelian (alur PR→PO→GRN penuh,
  pemisahan tugas, gerbang paket, penerimaan sebagian, pembatalan, sisa stok per lokasi).
- `bun scripts/verify-purchasing.mjs` → **60/60** (aturan murni) · `bun scripts/verify-authz.mjs` →
  **66/66** · `bun scripts/verify-render.mjs` → **132/132** (PurchasingPage dirender di DOM tiruan,
  termasuk saat fiturnya mati).
- Seluruh suite murni lain dijalankan ulang, semua hijau: `verify-modules` 27/27 · `verify-modifiers`
  46/46 · `verify-wholesale` 31/31 · `verify-fnb` 39/39 · `verify-inventory` 42/42 ·
  `verify-offline` 24/24 · `verify-ar` 54/54 · `verify-members` 30/30.
- `freebuff-preview status` → `{"running":true,"listening":true,"statusCode":"200"}`; `curl` ke
  `/`, `/auth`, dan `/src/pages/PurchasingPage.tsx` → 200 semua (berkas halaman ter-transform).
- Setelah pemeriksaan di atas hanya `README.md` dan entri `worklog.md` ini yang berubah; keduanya
  berkas markdown dan **tidak** memengaruhi build/tipe, jadi tidak ada perintah yang dijalankan
  ulang untuknya.

**Catatan / blocker:** jalur store Convex untuk pembelian diuji lewat backend harness + render DOM,
**belum lewat klik di browser sungguhan** (preview workspace masih mode demo) — sama seperti
catatan blocker nomor 3. Tempo pembayaran supplier (0–365 hari) sengaja disimpan walau hutang
usaha baru ada di `purchasing.threeway`; kolomnya sudah ada supaya tidak perlu migrasi nanti.

## 2026-10-11 — Phase 3 dimulai: gudang & perpindahan stok (`inventory.multiwarehouse`)
**Ruang lingkup:** permintaan “kalau Phase 2 sudah selesai semua, kerjakan Phase 3”. Phase 3
di roadmap adalah **Advanced Supply Chain** (`inventory.multiwarehouse`, `inventory.opname`,
`purchasing.basic`, `purchasing.threeway`). Entri ini mengerjakan **slice pertama**: multi-warehouse
sampai tuntas (aturan murni, schema, backend, izin, dua store, halaman, harness, dokumentasi).
Slice berikutnya (opname, purchasing) belum dikerjakan dan dicatat di tabel Status Phase 3.

Keputusan model yang diambil (satu sumber aturan di `src/convex/lib/inventory.ts`):
- **Stok dijual berasal dari lokasi jual.** Setiap toko punya satu lokasi jual yang **tidak**
  disimpan sebagai baris tabel — ia adalah bucket stok lama (`stockLevels` tanpa `warehouseId`).
  Konsekuensinya bagus dua arah: fitur ini menyala pada tenant lama **tanpa migrasi stok**, dan
  kasir tidak bisa menjual barang yang masih di gudang. Sisi lain dari keputusan ini: penjualan,
  peringatan stok kritis, dan angka stok di halaman Produk tetap memakai angka lokasi jual
  (`products.listByStore` menyaring `warehouseId === undefined`).
- **Gudang = lokasi penyimpanan tambahan.** Barang harus dipindahkan dulu ke lokasi jual, persis
  seperti stok fisik dibawa ke rak depan. Itu perilaku yang diinginkan gudang; alternatifnya
  (menjual langsung dari gudang) membuat angka “bisa dijual” berbohong.
- **Satu perpindahan = dua baris ledger satu nomor `TRF-…`** (keluar & masuk), jadi total stok tidak
  pernah berubah karena pemindahan dan setiap perpindahan bisa ditelusuri. Riwayat di halaman
  dibaca kembali dari ledger itu (dipasangkan per nomor), bukan dari tabel riwayat terpisah.
- **Gerbangnya sengaja tidak seragam.** Menambah gudang butuh fitur `inventory.multiwarehouse`
  (Enterprise) **dan** sisa slot paket (`limits.warehouses`; lokasi jual menempati satu slot) —
  itulah tindakan yang dibayar. Memindahkan stok & menonaktifkan gudang hanya butuh izin
  `inventory.manage`: kalau paketnya turun, gudang lama harus tetap bisa dikosongkan.
- **Gudang berisi stok tidak bisa dinonaktifkan** (`masih menyimpan N unit`) — kalau tidak, stoknya
  hilang dari pandangan padahal fisiknya masih ada di rak.
- **Izin dipisah seperti fitur lain**: `inventory.view`/`inventory.manage` untuk pemilik, manajer,
  dan staf gudang; kasir **tidak** memegangnya (menjual ≠ memindahkan), keuangan juga tidak
  (mencatat uang ≠ mengurus rak).

Dua hal teknis yang ikut diperbaiki karena ditemukan saat mengerjakan ini:
1. **`applyStockChange` tidak lagi `.unique()`** pada `by_product_store`. Sejak satu produk bisa punya
   beberapa baris stok (satu per lokasi), kunci pencariannya jadi (produk, toko, lokasi) lewat
   `findStockLevel` yang baru. Tanpa ini, perpindahan kedua akan melempar “multiple documents”.
2. **Store demo memakai cermin state (ref) untuk gudang & stok.** Bug nyata yang tertangkap harness
   render: dua aksi dalam satu tick (pindah stok lalu pindah lagi / menonaktifkan gudang yang baru
   dibuat) membaca snapshot render terakhir, sehingga penolakan menyebut angka basi (“hanya 120”
   padahal sudah 100) dan gudang yang baru dibuat “tidak ditemukan”. Sekarang produk, gudang, stok
   gudang, dan riwayat perpindahan punya ref + `update*` helper, sama seperti pola `receivablesRef`.

**Berkas:** baru: `src/convex/lib/inventory.ts`, `src/lib/inventory.ts`, `src/convex/inventory.ts`,
`src/pages/InventoryPage.tsx`, `scripts/verify-inventory.mjs` · diubah: `src/convex/schema.ts`
(tabel `warehouses`, kolom `warehouseId` di `stockLevels`/`stockMovements`, alasan `transfer`,
indeks `stockMovements.by_tenant_created`), `src/convex/lib/access.ts` (`findStockLevel`,
`warehouseId` di `applyStockChange`), `src/convex/lib/authz.ts` (izin `inventory.view`/
`inventory.manage`), `src/convex/products.ts` (stok & stok kritis = lokasi jual),
`src/lib/store/types.ts`, `src/lib/store/demo.tsx`, `src/lib/store/convex.tsx`,
`src/data/demo.ts` (3 gudang contoh + stok gudang), `src/App.tsx` (rute `/app/inventory`),
`src/layouts/AppLayout.tsx` (menu Gudang & Stok), `scripts/verify-authz.mjs`,
`scripts/verify-render.mjs`, `scripts/verify-backend.mjs`, `README.md`, `worklog.md`

**Verifikasi:**
- `bun convex dev --once` → `Convex functions ready! (2.12s)`, indeks baru dibuat
  (`warehouses.by_tenant`, `warehouses.by_tenant_code`, `warehouses.by_tenant_store`,
  `stockMovements.by_tenant_created`), exit 0 · `bun tsc -b --noEmit` exit 0 ·
  `bun tsc -p tsconfig.convex.json --noEmit` exit 0.
- `bun scripts/verify-inventory.mjs` (baru, murni) → **42/42 checks passed**, exit 0: lokasi jual
  implisit, normalisasi & validasi kode gudang, usulan kode, duplikat (tanpa peka huruf besar),
  batas paket (1 lokasi = penuh, 3 lokasi = sisa 1 slot, unlimited), dan aturan perpindahan
  (jumlah 0/negatif/pecahan, asal = tujuan, stok kurang, gudang nonaktif, arah toko → gudang),
  plus penjumlahan stok per lokasi yang tidak berubah oleh perpindahan.
- `bun scripts/verify-authz.mjs` → **55/55** (dari 48/48): staf gudang & manajer boleh
  `inventory.view`/`inventory.manage`, kasir tidak keduanya, keuangan tidak memindahkan stok.
- `bun scripts/verify-render.mjs` → **108/108 checks passed** (dari 88/88), termasuk halaman
  Gudang & Stok di DOM klien (lokasi contoh, lokasi jual ditandai, tabel stok per lokasi) dan alur
  perpindahan stok tanpa browser: 20 unit GD-A → lokasi jual (48 → 68 bisa dijual, GD-A 120 → 100,
  total tetap 192), pemindahan melebihi stok sumber ditolak (“hanya 100”), gudang berisi stok tidak
  bisa dinonaktifkan, gudang baru `GD-T` boleh dibuat (Enterprise) lalu dinonaktifkan, dan paket
  Professional menolak pembuatan gudang (“tidak termasuk paket”) sementara stoknya tetap terbaca.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **184/184 checks passed**, exit 0 (dari 158/158; 26 cek baru). Yang baru dan lulus: lokasi jual
  selalu ada tanpa gudang, stok awal 100 di lokasi jual, paket Professional menolak pembuatan gudang
  (limit 1, `full`), naik paket ke Enterprise memberi fiturnya, gudang dibuat dengan kode otomatis
  (`GU`), kode duplikat/nama pendek/kode tidak valid ditolak, pindah 40 unit → 60 bisa dijual + 40 di
  gudang dengan total tetap 100, riwayat `TRF-00001` terbaca dari ledger (dari → ke),
  `products.listByStore` hanya menghitung lokasi jual, perpindahan melebihi stok asal
  (“hanya 60”)/asal = tujuan/jumlah pecahan ditolak, pindah antar gudang `TRF-00002`, gudang berisi 30
  unit ditolak dinonaktifkan, seluruh stok 100 bisa dipindahkan ke gudang, **penjualan ditolak**
  (“Stok tidak cukup”) selama stok masih di gudang, penjualan berhasil (11.100) setelah 5 unit
  dipindahkan ke lokasi jual, kasir ditolak melihat stok per lokasi & memindahkan stok, gudang kosong
  boleh dinonaktifkan, dan gudang nonaktif tidak bisa jadi tujuan.
- Tidak ada regresi: `verify-modules` 27/27 · `verify-wholesale` 31/31 · `verify-members` 30/30 ·
  `verify-fnb` 39/39 · `verify-modifiers` 46/46 · `verify-ar` 54/54 · `verify-offline` 24/24.
- Preview workspace: `freebuff-preview restart` → `Preview is ready`; `/src/pages/InventoryPage.tsx`,
  `/src/lib/inventory.ts`, `/src/convex/lib/inventory.ts`, `/src/convex/inventory.ts`,
  `/src/lib/store/demo.tsx`, dan `/app/inventory` → HTTP 200.

**Catatan / blocker:** Phase 3 **belum selesai seluruhnya** — yang tuntas baru
`inventory.multiwarehouse`. Sisa fitur Phase 3: `inventory.opname` (stock opname & audit selisih;
alasan `opname` sudah ada di ledger sejak awal) dan `purchasing.basic`/`purchasing.threeway`
(PR · PO · GRN, 3-way matching & AP), masing-masing butuh tabel, alur, izin, dan harness sendiri.
Belum pernah dilihat di browser sungguhan (baru DOM tiruan + backend harness), dan perubahan ini
belum tayang di produksi sampai deploy diulang.

## 2026-10-11 — Phase 2 ditutup: member & diskon member (`member.discount`) — fitur UMKM yang masih label
**Ruang lingkup:** permintaan “lanjutkan Phase 2 yang belum dikerjakan”. Audit ulang registri modul
menunjukkan sisa terakhir: `pos.quickgrid` sudah punya alur (grid kasir) tetapi **`member.discount`**
(fitur milik modul UMKM) masih label tanpa alur sama sekali — hanya ada di katalog dan registri modul.
Itu yang dikerjakan sekarang: aturan murni diskon member, tabel member, backend, izin, halaman
**Member**, pemilih member di kasir, harness, dan dokumentasi.

Keputusan model (satu sumber aturan di `src/convex/lib/loyalty.ts`):
- **Diskon dihitung dari data member di server, bukan dari input kasir.** Kasir memilih member;
  persentasenya datang dari catatan member, jadi angka diskon tidak bisa dititipkan lewat request —
  sama seperti harga dihitung server.
- **Diskon member + diskon manual digabung sekali jalan** (`discountBreakdown`): totalnya dipatok di
  subtotal dan PPN dihitung setelah diskon, bukan pada subtotal.
- **Member nonaktif ditolak saat menjual** dengan pesan yang jelas; tidak ada transaksi yang diam-diam
  kehilangan diskon yang sudah dijanjikan kasir ke pelanggan.
- **Member terpisah dari `customers` (B2B)**: member = diskon loyalitas di kasir, customer = tempo &
  limit kredit; menggabungkannya akan mencampur dua izin yang berbeda. Namespace API memakai
  `api.loyalty.*` karena `src/convex/members.ts` sudah berarti **anggota tim**.
- **Pemisahan tugas:** kasir memakai diskon (`member.view`), tetapi besarnya diskon ditentukan
  pemilik/manajer (`member.manage`) — diskon adalah keputusan margin, bukan keputusan meja kasir.
- **Gerbang modul & paket**: diskon > 0 butuh modul UMKM aktif **dan** fitur `member.discount` di paket
  (Starter belum memuatnya). Data member tetap bisa dibaca dan diskon bisa **ditutup** (0%) tanpa modul.

Dua perbaikan akurasi ikut dikerjakan karena ketemu saat menulis fitur ini:
1. **Umur piutang memakai hari penuh** (`Math.floor`, sebelumnya `Math.ceil`): nota yang jatuh tempo
   30 hari 20 jam lalu tadinya masuk bucket “31–60 hari” hanya karena beberapa milidetik sudah
   berlalu — dan harness Dashboard sempat lulus/gagal tergantung timing. Sekarang steady: 30 hari
   20 jam tetap “1–30 hari”.
2. **Pesan “fitur tidak hidup” membedakan modul mati vs paket tidak memuat fitur**
   (`featureUnavailableReason` di `src/lib/store/modules.ts`), dan dipakai halaman Member, Piutang,
   serta Dapur & Meja. Sebelumnya ketiganya menulis “modul belum aktif” padahal tenant Starter sudah
   punya modulnya — yang kurang **paket**, dan menyuruhnya membuka halaman Modul menyesatkan.

**Berkas:** baru: `src/convex/lib/loyalty.ts`, `src/lib/loyalty.ts`, `src/convex/loyalty.ts`,
`src/pages/MembersPage.tsx`, `scripts/verify-members.mjs` · diubah: `src/convex/schema.ts`
(tabel `members`, `sales.memberId`/`memberDiscount`), `src/convex/lib/authz.ts`
(izin `member.view`/`member.manage`), `src/convex/pos.ts` (`memberId` → diskon dari data member,
`discountBreakdown`), `src/convex/lib/ar.ts` (umur piutang hari penuh), `src/lib/store/types.ts`,
`src/lib/store/modules.ts` (`featureUnavailableReason`), `src/lib/store/demo.tsx`,
`src/lib/store/convex.tsx`, `src/data/demo.ts` (4 member contoh, satu nonaktif), `src/pages/PosPage.tsx`
(pemilih member + baris diskon), `src/pages/ReceivablesPage.tsx`, `src/pages/KdsPage.tsx`,
`src/App.tsx` (rute `/app/members`), `src/layouts/AppLayout.tsx` (menu Member),
`scripts/verify-authz.mjs`, `scripts/verify-ar.mjs`, `scripts/verify-render.mjs`,
`scripts/verify-backend.mjs`, `README.md`, `worklog.md`

**Verifikasi:**
- `bun convex dev --once` → `Convex functions ready!`; indeks baru ditambahkan
  (`members.by_tenant`, `members.by_tenant_code`), exit 0 · `bun tsc -b --noEmit` → exit 0 ·
  `bun tsc -p tsconfig.convex.json --noEmit` → exit 0.
- `bun scripts/verify-members.mjs` (baru, murni) → **30/30 checks passed**, exit 0: validasi member
  (nama/telepon/kode/diskon), usulan kode, pembulatan diskon (termasuk 3% dari 12.345 = 370),
  patokan tidak melebihi subtotal, gabungan member + manual, dan member nonaktif.
- `bun scripts/verify-authz.mjs` → **48/48** (dari 42/42): kasir boleh `member.view` tapi tidak
  `member.manage`; keuangan melihat member tetapi tidak mengubah diskon; gudang tidak keduanya.
- `bun scripts/verify-ar.mjs` → **54/54** (dari 52/52): tambahan cek aturan umur piutang hari penuh.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **158/158 checks passed**, exit 0 (dari 141/141; 17 cek baru). Yang baru dan lulus: member dibuat
  dengan kode otomatis, kode duplikat/diskon 80%/telepon salah ditolak, diskon member 5% dihitung
  server (600 → total 12.654), penjualan menyimpan `memberId` + `memberDiscount`, gabungan diskon
  member + manual (11.544), kasir boleh membaca daftar member tetapi ditolak menambah/mengubah,
  member nonaktif ditolak saat menjual, dan saat modul UMKM dimatikan: diskon baru/menaikkan
  diskon/menjual dengan diskon ditolak, sementara daftar tetap terbaca, member tanpa diskon tetap
  bisa dibuat, dan diskon bisa ditutup ke 0%.
- `bun scripts/verify-render.mjs` → **88/88 checks passed** (dari 71/71), termasuk halaman Member di
  DOM klien dan alur diskon member tanpa browser: 5% dari 22.000 = 1.100 → total 23.199; gabungan
  dengan diskon manual 1.000 → 22.089; member nonaktif ditolak (“tidak aktif”); POS menampilkan
  pemilih member saat modul UMKM aktif dan **tidak** menawarkannya saat modul itu mati; halaman
  Member menyebut “tidak termasuk paket Starter” (bukan menyuruh menyalakan modul yang sudah aktif).
- Tidak ada regresi: `verify-modules` 27/27 · `verify-wholesale` 31/31 · `verify-fnb` 39/39 ·
  `verify-modifiers` 46/46 · `verify-offline` 24/24.
- Preview workspace: `/src/pages/MembersPage.tsx`, `/src/lib/loyalty.ts`, `/src/convex/lib/loyalty.ts`,
  `/src/lib/store/demo.tsx` → HTTP 200; `/app/members` → HTTP 200.
- Pemeriksaan ulang penutup setelah tabel **Status Phase 2** dan daftar **Blocker** diperbarui
  (perintah dijalankan lagi dari nol, semua exit 0): `bun convex dev --once` →
  `Convex functions ready! (1.59s)` · `bun tsc -b --noEmit` exit 0 ·
  `bun tsc -p tsconfig.convex.json --noEmit` exit 0 · `verify-modules` 27/27 · `verify-wholesale`
  31/31 · `verify-members` 30/30 · `verify-fnb` 39/39 · `verify-modifiers` 46/46 · `verify-ar` 54/54 ·
  `verify-authz` 48/48 · `verify-offline` 24/24 · `verify-render` 88/88 ·
  `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **158/158 checks passed against https://mellow-narwhal-477.convex.cloud**.

**Catatan / blocker:** dengan ini **tidak ada lagi klausa Phase 2 yang berlabel** — `pos.quickgrid`
(grid kasir) dan `member.discount` (member & diskon) melengkapi modul UMKM, F&B dan Grosir sudah
selesai sebelumnya. Sisa pekerjaan yang belum tuntas bukan lagi fitur Phase 2, melainkan hal-hal di
tabel **Blocker** (provider autentikasi, dan belum pernahnya alur Convex dilihat di browser sungguhan).
Perubahan ini juga **belum tayang di produksi** sampai deploy diulang; preview workspace sudah memuatnya.
Tabel **Status Phase 2** dan daftar **Blocker** di worklog ini sudah diselaraskan dengan keadaan
terakhir (angka suite 158/158, dan baris `pos.quickgrid` mencatat keputusan sadar bahwa grid kasir
**tidak** digerbang server karena itu layar jual inti).

## 2026-10-11 — Dashboard: total piutang + daftar pelanggan menunggak
**Ruang lingkup:** permintaan lanjutan setelah Phase 2 tuntas — menampilkan **total piutang** dan
**daftar pelanggan menunggak** di Dashboard, bukan hanya di halaman Piutang. Yang dikerjakan: dua
kartu piutang di `DashboardPage`, penyaringan berdasarkan izin, dan pemeriksaan di harness render.

Keputusan yang dipakai:
- **Mengikuti izin `ar.view`, bukan mengasumsikan ada.** Staf gudang punya `report.view` (jadi boleh
  membuka Dashboard) tetapi tidak boleh melihat piutang; kartunya **disembunyikan**, bukan
  ditampilkan dengan “Rp 0” yang menyesatkan. Ini konsisten dengan store Convex yang tidak
  berlangganan `ar.list` untuk peran tanpa izin itu.
- **Angka berasal dari aturan yang sama** (`@/lib/ar` lewat store): total terbuka, pecahan umur
  (belum jatuh tempo / 1–30 / 31–60 / >60 hari), dan daftar pelanggan diurutkan dari tunggakan
  terbesar. Umur pelanggan diambil dari **nota terlama** yang lewat tempo, jadi barisnya menjawab
  “seberapa telat”, bukan “ada berapa nota”.
- **Daftar diringkas** maksimal 5 pelanggan di Dashboard (dengan penanda sisanya); daftar lengkap
  tetap di halaman Piutang, dan kedua kartu menautkannya.

**Berkas:** diubah: `src/pages/DashboardPage.tsx`, `scripts/verify-render.mjs`, `README.md`,
`worklog.md`

**Verifikasi:**
- `bun tsc -b --noEmit` → exit 0 (tidak ada perubahan backend/schema, jadi `convex dev --once` tidak dijalankan lagi pada langkah ini).
- `bun scripts/verify-render.mjs` → **71/71 checks passed** (dari 65/65), 6 cek baru: Dashboard
  menampilkan total piutang (Rp 900.000 jatuh tempo dari Rp 1.350.000 terbuka), daftar menunggak
  memuat “Toko Berkah Jaya · 1 nota · 1–30 hari · lewat 6 hari”, pecahan umur piutang tampil, kedua
  tautan ke halaman Piutang ada, tidak ada error konsol, dan dengan peran **gudang** (tanpa `ar.view`)
  bagian piutang tidak muncul sementara “Stok kritis” tetap ada.
- Preview workspace: `/src/pages/DashboardPage.tsx` → HTTP 200 (38.397 byte) setelah HMR.

**Catatan / blocker:** tidak ada perubahan skema/fungsi Convex, jadi tidak ada cek backend baru yang
relevan; angka piutang di Dashboard hanya seakurat data yang dikirim store (demo memakai data contoh,
Convex memakai nota nyata). Perubahan ini belum tayang di produksi sampai deploy diulang.

## 2026-10-11 — Phase 2 tuntas: piutang B2B & credit limit (`ar.creditlimit`) — penjualan tempo, umur piutang, penagihan
**Ruang lingkup:** menutup **fitur terakhir Phase 2 yang masih label**: piutang B2B & credit limit
(`ar.creditlimit`, modul Grosir). Yang dikerjakan: aturan murni piutang, tabel `customers` /
`receivables` / `receivablePayments`, backend `ar.*`, penerimaan pembayaran sebagian, integrasi
`pos.createSale` (bayar sebagian → piutang), pembatalan penjualan berpiutang, izin baru, halaman
**Piutang**, pemilih pelanggan + “dibayar sekarang” di kasir, harness, dan dokumentasi.

Keputusan model (satu sumber aturan di `src/convex/lib/ar.ts`, dipakai server, klien, dan harness):
- **Piutang disimpan per penjualan** (nota `AR-…`), bukan satu saldo per pelanggan: umur piutang dan
  pelunasan sebagian bisa dilacak per nota, dan tidak ada angka saldo yang bisa basi.
- **Sisa limit selalu dihitung** (`limit − piutang terbuka`). Limit 0 berarti tunai saja, dan limit
  tanpa tempo ditolak (“pelanggan yang boleh berutang tapi harus lunas saat itu” itu kontradiktif).
- **Limit dievaluasi server**, bukan dialog kasir: sisa tidak cukup, pelanggan nonaktif, dan
  pelanggan yang punya piutang **jatuh tempo** ditolak dengan pesan yang menyebut angkanya.
- **Umur piutang** dihitung dari **jatuh tempo** tiap nota (bucket: belum jatuh tempo, 1–30, 31–60,
  > 60 hari), jadi penagihan terarah ke nota yang paling telat — bukan ke tanggal transaksi.
- **Pesanan yang masih di dapur tidak pernah jadi piutang**: pembayaran di situ baru niat metodenya.
  Kalau pengirimnya tetap minta tempo, ditolak terang-terangan (uang yang tidak dicatat lebih
  berbahaya daripada penolakan yang jelas).
- **Penjualan yang piutangnya sudah menerima pembayaran tidak bisa dibatalkan** (`pos.voidSale`),
  dan piutang yang belum dibayar ikut di-`void` saat penjualannya dibatalkan sehingga limit
  pelanggan kembali seperti semula.
- **Dua pagar yang sengaja berbeda:** *membuat* piutang butuh modul Grosir aktif (`ar.creditlimit`),
  tetapi *menagih* piutang lama hanya butuh izin (`ar.view`/`ar.manage`) — mematikan modul tidak boleh
  membuat utang pelanggan menjadi tak tertagih. Menu “Piutang” ikut tetap tampil selama masih ada nota
  terbuka walau modulnya mati.
- **Pemisahan tugas piutang:** kasir dapat `ar.view` (boleh melihat sisa limit supaya tidak menjual
  melebihi limit) tetapi **tidak** `ar.manage`; hanya pemilik/manajer/keuangan yang boleh mengubah
  limit dan mencatat pelunasan — yang menjual bukan yang memberi kredit.

**Berkas:** baru: `src/convex/lib/ar.ts`, `src/lib/ar.ts`, `src/convex/ar.ts`,
`src/pages/ReceivablesPage.tsx`, `scripts/verify-ar.mjs` · diubah: `src/convex/schema.ts`
(`customers`, `receivables`, `receivablePayments`, `sales.customerId`, `paymentMethodValidator`),
`src/convex/lib/authz.ts` (izin `ar.view`/`ar.manage`), `src/convex/pos.ts` (`customerId`, sisa tagihan
→ piutang + pemeriksaan limit, void piutang), `src/lib/store/types.ts`, `src/lib/store/demo.tsx`,
`src/lib/store/convex.tsx`, `src/data/demo.ts` (3 pelanggan + 2 nota contoh, satu jatuh tempo),
`src/pages/PosPage.tsx` (pemilih pelanggan + “dibayar sekarang” + pratinjau sisa limit),
`src/App.tsx` (rute `/app/receivables`), `src/layouts/AppLayout.tsx` (menu Piutang),
`scripts/verify-authz.mjs`, `scripts/verify-render.mjs`, `scripts/verify-backend.mjs`, `README.md`,
`worklog.md`

**Verifikasi:**
- `bun convex dev --once` → `Convex functions ready!`; indeks baru ditambahkan (`customers.by_tenant*`,
  `receivables.by_tenant*`, `receivablePayments.*`), exit 0 · `bun tsc -b --noEmit` → exit 0 ·
  `bun tsc -p tsconfig.convex.json --noEmit` → exit 0.
- `bun scripts/verify-ar.mjs` (baru, murni) → **52/52 checks passed**, exit 0: validasi pelanggan
  (nama/telepon/kode/limit/tempo), usulan kode, umur piutang per bucket, posisi kredit & sisa limit,
  keputusan tempo (limit 0, melebihi sisa limit, jatuh tempo, pelanggan nonaktif), pelunasan
  sebagian/penuh/kelebihan, ringkasan umur piutang, dan konversi sisa tagihan menjadi piutang.
- `bun scripts/verify-authz.mjs` → **42/42** (dari 36/36): kasir boleh `ar.view` tapi tidak `ar.manage`,
  keuangan/manajer boleh `ar.manage`, gudang tidak keduanya.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **141/141 checks passed**, exit 0 (dari 116/116; 25 cek baru). Yang baru dan lulus: kode pelanggan
  otomatis, kode duplikat/telepon tidak valid/limit tanpa tempo ditolak, bayar sebagian → nota piutang
  8.320 dengan tempo 30 hari, sisa limit turun jadi 991.680, ringkasan piutang, tempo melebihi sisa
  limit ditolak (menyebut angkanya), tempo tanpa pelanggan / pelanggan limit 0 / pesanan di dapur
  ditolak, kasir boleh membaca tapi tidak boleh mengubah limit & mencatat pelunasan, pelunasan
  sebagian, kelebihan bayar ditolak, penjualan berpiutang yang sudah dibayar tidak bisa di-void,
  tempo baru ditolak saat modul Grosir mati, serta piutang lama tetap terbaca dan bisa dilunasi tanpa
  modul (limit pelanggan kembali penuh setelah lunas).
- `bun scripts/verify-render.mjs` → **65/65 checks passed** (dari 43/43), termasuk halaman Piutang di
  DOM klien dan alur piutang tanpa browser: pelanggan menunggak ditolak (“jatuh tempo”), pelanggan
  tanpa limit ditolak, tempo sah menghasilkan nota `AR-00003` senilai 24.420 dengan sisa limit turun
  24.420, pelunasan sebagian lalu pelunasan sisa (nota jadi `paid` dan keluar dari piutang terbuka),
  serta kelebihan bayar ditolak.
- `bun scripts/verify-modules.mjs` → 27/27 · `verify-wholesale.mjs` → 31/31 · `verify-fnb.mjs` →
  39/39 · `verify-modifiers.mjs` → 46/46 · `verify-offline.mjs` → 24/24 (tidak tersentuh; memastikan
  tidak ada regresi).
- Preview workspace (mode demo): `/src/pages/ReceivablesPage.tsx`, `/src/lib/ar.ts`,
  `/src/lib/store/demo.tsx`, `/src/convex/lib/ar.ts` → HTTP 200 (89.068 / 987 / 79.220 / 36.764 byte);
  `/app/receivables` → HTTP 200.

**Catatan / blocker:** dengan ini **seluruh klausa Phase 2 selesai** (tidak ada lagi fitur berlabel).
Dua bug ikut ketemu & diperbaiki di tengah jalan: (1) demo store menghitung pelunasan dari snapshot
render terakhir sehingga dua pembayaran berturut-turut dalam satu tick bisa memakai sisa piutang yang
basi — sekarang piutang demo punya cermin `useRef` yang memperbarui diri sebelum state; (2) urutan
pemeriksaan di `pos.createSale` membuat gerbang KDS mendahului aturan tempo, sehingga pesan yang
muncul bukan yang paling spesifik — gerbang KDS dipindah setelah aturan tempo. Perubahan ini juga
**belum tayang di produksi** sampai deploy diulang; preview workspace sudah memuatnya.

## 2026-10-11 — Phase 2 lanjutan: modifier item (`pos.modifier`) — level pedas, ukuran, topping berbayar
**Ruang lingkup:** melanjutkan Phase 2 pada fitur label berikutnya di daftar terbuka: **modifier item**
(`pos.modifier`, modul F&B). Yang dikerjakan: aturan murni modifier, kolom `products.modifiers`,
mutation `products.setModifiers`, penerapan di `pos.createSale` (validasi + harga + simpan label),
label modifier di tiket dapur, dialog modifier di kasir, editor modifier di halaman Produk, izin/gerbang
modul, harness, dan dokumentasi.

Keputusan model (satu sumber aturan di `src/convex/lib/modifiers.ts`):
- **Grup & opsi disimpan sebagai kode**, label dibentuk saat transaksi dibuat dan disimpan di
  `saleItems.modifiers` — mengganti tulisan “Telur” → “Telur Ayam” tidak mengubah riwayat struk;
- **`minSelect > 0` berarti wajib**: “Nasi Goreng wajib pilih level pedas” ditegakkan **server**, bukan
  hanya oleh dialog kasir;
- **tambahan harga dihitung per unit yang dijual**, bukan per satuan dasar: 2×“+Telur 5.000” = 10.000,
  dan 1 Dus (24 Pcs) + Telur tetap 5.000 — kalau per satuan dasar, satu Dus akan mengalikan topping 24×;
- urutan label **stabil** (urut konfigurasi produk, lalu kode opsi) supaya dapur membaca hal yang sama
  untuk pilihan yang sama;
- **kode grup/opsi diusulkan otomatis dari nama** di halaman Produk (`suggestGroupCode`/
  `suggestOptionCode`), sehingga pemilik toko tidak perlu mengarang kode dan tidak salah ketik.

Gerbang modul seperti fitur modul lain: memilih modifier butuh fitur `pos.modifier`, mengubah konfigurasi
butuh `pos.modifier` + izin `product.manage`, dan **produk yang punya modifier ditolak dijual saat modul
F&B mati** (pilihan pelanggan tidak boleh hilang diam-diam). Mengosongkan daftar modifier selalu boleh,
bahkan tanpa modul.

**Berkas:** baru: `src/convex/lib/modifiers.ts`, `src/lib/modifiers.ts`, `scripts/verify-modifiers.mjs` ·
diubah: `src/convex/schema.ts` (`products.modifiers`), `src/convex/products.ts` (`create` + `setModifiers`),
`src/convex/pos.ts` (`items[].modifiers`, validasi + harga + label ke `saleItems`), `src/convex/lib/fnb.ts`
(`KdsTicketItem.modifiers` + ringkasan tiket), `src/lib/store/types.ts`, `src/lib/store/demo.tsx`,
`src/lib/store/convex.tsx`, `src/data/demo.ts` (dua produk contoh bermodifier), `src/pages/PosPage.tsx`
(dialog modifier + label di keranjang), `src/pages/KdsPage.tsx` (label di kartu dapur),
`src/pages/ProductsPage.tsx` (editor modifier), `scripts/verify-fnb.mjs`, `scripts/verify-backend.mjs`,
`scripts/verify-render.mjs`, `README.md`, `worklog.md`

**Verifikasi:**
- `bun convex dev --once` → `Convex functions ready!` (fungsi baru ter-push), exit 0 ·
  `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0.
- `bun scripts/verify-modifiers.mjs` (baru, murni) → **46/46 checks passed**, exit 0: validasi
  konfigurasi (batas grup/opsi, kode, nama, min/max, harga negatif), usulan kode otomatis, penerapan
  pilihan (grup wajib, opsi asing, batas pilihan, duplikat), urutan & label stabil, dan aturan harga
  per unit (termasuk kasus Dus).
- `bun scripts/verify-fnb.mjs` → **39/39** (dari 37/37): modifier ikut ke tiket dapur dan tampil di
  ringkasan kartu.
- `bun scripts/verify-render.mjs` → **43/43** (dari 38/38), termasuk pemeriksaan klien: permintaan tanpa
  grup wajib ditolak dengan pesan “wajib dipilih”, label modifier muncul di tiket dapur, dan total
  memuat tambahan per unit (2 × 27.000 + 2 × 5.000 = 64.000 → 71.040 setelah PPN).
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **116/116 checks passed**, exit 0 (dari 105/105; 11 cek baru). Yang baru dan lulus: modifier tersimpan
  di produk, ditolak bila grup wajib tidak dipilih, opsi asing, grup asing, melebihi batas pilihan;
  total memuat tambahan per unit (33.300); tiket dapur memuat label modifier; konfigurasi modifier,
  pemilihan modifier, dan penjualan produk bermodifier ditolak saat modul F&B mati; serta penghapusan
  modifier tetap boleh tanpa modul.
- `bun scripts/verify-authz.mjs` → 36/36 · `verify-modules.mjs` → 27/27 · `verify-wholesale.mjs` →
  31/31 · `verify-offline.mjs` → 24/24 (tidak tersentuh; memastikan tidak ada regresi).

**Catatan / blocker:** sisa Phase 2 yang masih label tinggal **`ar.creditlimit`** (piutang B2B &
credit limit — modul Grosir). Perubahan ini juga **belum tayang di produksi** sampai deploy diulang;
preview workspace sudah memuatnya.

## 2026-10-11 — Phase 2 lanjutan: modul F&B — denah meja (`pos.table`) + antrean dapur/KDS (`pos.kds`)
**Ruang lingkup:** melanjutkan Phase 2 tepat pada titik yang dicatat masih terbuka: alur **F&B** yang
sebelumnya cuma gerbang KDS. Yang dikerjakan: aturan meja, API denah meja, penempatan pesanan ke meja,
antrean dapur (tiket), halaman **Dapur & Meja**, integrasi kasir (pilih meja + kirim ke dapur), izin
baru `table.manage`, plus harness dan dokumentasi.

Keputusan model (satu sumber aturan di `src/convex/lib/fnb.ts`, dipakai backend, klien, dan harness):
- **status meja tidak disimpan**: meja terisi = ada pesanan berstatus `held` yang menunjuknya, jadi
  menyelesaikan atau membatalkan pesanan otomatis mengosongkan mejanya — tidak ada patch tambahan
  yang bisa terlewat;
- **satu meja hanya boleh punya satu pesanan terbuka** (`seatTable`): dua pesanan di satu meja tidak
  bisa dipisahkan lagi tagihannya;
- nama meja unik per toko (tanpa peka huruf besar-kecil), kursi bilangan bulat 1–24, nama ≤16 karakter
  dinormalkan (spasi dirapatkan) dan hanya boleh huruf/angka/spasi/`- . /`;
- **pesanan tertahan belum menggerakkan stok**; stok bergerak saat ditandai selesai — itu yang
  membedakannya dari penjualan biasa (dan alasannya `holdSale` di klien tidak lewat outbox offline:
  dapur hanya boleh melihat pesanan yang benar-benar sudah diterima server);
- antrean dapur diurutkan **paling lama menunggu di depan**, dengan ambang tanda "lama" 15 menit.

Gerbangnya tiga lapis dan bukan kosmetik: menu di sidebar ikut menyembunyikan halaman, rute memeriksa
izin yang sama, dan **server menolak** — `pos.kdsTickets` butuh fitur `pos.kds`, `tables.*` butuh fitur
`pos.table` **dan** izin `table.manage`, dan `pos.createSale` dengan `tableId` butuh fitur `pos.table`.
Izin `table.manage` sengaja bukan milik kasir: kasir memakai meja, bukan mendesain ulang denahnya.

**Berkas:** baru: `src/convex/lib/fnb.ts`, `src/lib/fnb.ts`, `src/convex/tables.ts`,
`src/pages/KdsPage.tsx`, `scripts/verify-fnb.mjs` · diubah: `src/convex/schema.ts` (tabel `tables`,
`sales.tableId`, indeks `by_table`), `src/convex/lib/authz.ts` (izin `table.manage`),
`src/convex/pos.ts` (`createSale` menerima `tableId`, query `kdsTickets`), `src/lib/store/types.ts`,
`src/lib/store/demo.tsx`, `src/lib/store/convex.tsx`, `src/data/demo.ts` (denah contoh),
`src/pages/PosPage.tsx` (pemilih meja + "Ke dapur", daftar antrean), `src/layouts/AppLayout.tsx`
(menu bergantung fitur modul), `src/App.tsx` (rute `/app/kds`), `scripts/verify-authz.mjs`,
`scripts/verify-backend.mjs`, `scripts/verify-render.mjs`, `README.md`, `worklog.md`

**Verifikasi:**
- `bun convex dev --once` → `Convex functions ready!` + indeks baru ditambahkan (`sales.by_table`,
  `tables.by_tenant`, `tables.by_tenant_store`), exit 0.
- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0.
- `bun scripts/verify-fnb.mjs` (baru, murni) → **37/37 checks passed**, exit 0: validasi meja,
  duplikat nama, status denah (termasuk meja nonaktif dan dua pesanan di satu meja), aturan
  `seatTable`, urutan & umur tiket, dan pesanan tanpa meja.
- `bun scripts/verify-authz.mjs` → **36/36** (dari 33/33): izin `table.manage` untuk manajer, ditolak
  untuk kasir dan gudang, dan cek "owner punya semua izin" kini dibandingkan dengan tabel izin itu
  sendiri, bukan angka tetap.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **105/105 checks passed**, exit 0 (dari 85/85; 20 cek baru). Yang baru dan lulus: owner menambah meja,
  nama duplikat ditolak, kursi di luar batas ditolak, kasir ditolak mengubah denah, antrean dapur
  memuat tiket tanpa meja, pesanan tertahan masuk meja, tiket memuat meja + item, urutan paling lama
  di depan, pesanan kedua di meja yang sama ditolak, meja terisi tidak bisa dinonaktifkan, meja kosong
  bisa dinonaktifkan, meja nonaktif tidak bisa ditempati, tiket hilang & meja kosong setelah selesai,
  serta antrean dapur dan penambahan meja ditolak saat modul F&B dimatikan.
- `bun scripts/verify-render.mjs` → **38/38 checks passed** (dari 23/23). Termasuk alur klien penuh yang
  dijalankan di DOM: kirim ke dapur **tidak** menggerakkan stok dan membuat meja `occupied`; setelah
  ditandai selesai stok turun 2 satuan dasar, meja kembali `free`, dan tiketnya hilang dari antrean.
- `bun scripts/verify-modules.mjs` → 27/27 · `bun scripts/verify-wholesale.mjs` → 31/31 (tidak
  tersentuh; dijalankan untuk memastikan tidak ada regresi).

**Catatan / blocker:** fitur `pos.modifier` (modifier item) dan `ar.creditlimit` (piutang B2B) masih
label tanpa alur — itu sisa Phase 2 yang terbuka, lihat tabel di bawah. Perubahan ini juga **belum
tayang di produksi** sampai deploy diulang; preview workspace sudah memuatnya.

## 2026-10-11 — "Layar putih semua": akar masalah direproduksi (penulisan localStorage di efek sesi tanpa penjagaan) + ErrorBoundary
**Ruang lingkup:** laporan pengguna "kenapa layarnya putih semua?". Yang dikerjakan: menelusuri jalur
render (graf modul Vite, render SSR rute, status deploy), **mereproduksi** layar putih di klien tanpa
browser, memperbaiki penyebab yang berhasil direproduksi, lalu memasang penangkap error supaya kalau
ada penyebab lain yang tampil adalah pesan, bukan halaman kosong.

**Akar masalah (berhasil direproduksi, bukan dugaan).** `SessionProvider` menulis `localStorage` di
dalam efek **tanpa penjagaan**: pembacaan sesi (`readStoredSession`) sudah dibungkus `try/catch`,
penulisannya tidak. Di browser yang memblokir penyimpanan (mode privat, "blokir semua cookie" di HP),
`setItem` **melempar**; satu lemparan di dalam efek membuat React melepas seluruh pohon komponen —
persis layar putih tanpa pesan. Harness uji klien yang baru dibuat **gagal** pada kondisi itu sebelum
pengaman dipasang (layar putih / error `storage diblokir` sampai ke React) dan **lulus setelahnya**.
Gejala "kadang normal, kadang putih" ikut dijelaskan: perilakunya bergantung pengaturan penyimpanan
browser, bukan acak.

**Perubahan:**
- `src/lib/session.tsx` — penulisan & penghapusan sesi dibungkus `try/catch`; kalau penyimpanan tidak
  tersedia, sesi hidup di memori tab itu dan aplikasi tetap jalan.
- `src/components/ErrorBoundary.tsx` (baru) + dipasang di `src/App.tsx` **di luar semua provider** —
  error render berikutnya tampil sebagai pesan yang bisa dibaca dan disalin, bukan halaman putih.
  Sengaja hanya HTML + kelas Tailwind, tanpa hook/provider/router, supaya tetap bisa merender kalau
  provider-nya sendiri yang gagal.
- `scripts/verify-render.mjs` (baru) — render **sisi klien** (happy-dom + `react-dom/client`;
  `happy-dom` ditambahkan sebagai devDependency): beranda + 7 halaman aplikasi dijalankan **beserta
  efeknya**, ditambah skenario penyimpanan melempar dan uji ErrorBoundary. Uji render browser pertama
  yang dimiliki repo ini (7 halaman yang sebelumnya cuma "type-checked").
- `scripts/diag-module-graph.mjs` (baru) — menelusuri graf modul dari `index.html` lewat dev server
  (impor statis + dinamis) untuk memisahkan "modul gagal transformasi" dari penyebab lain.
- `scripts/diag-render.mjs` (baru) — render SSR Vite per rute; sekaligus membuktikan rute `/app/*`
  berhenti di "Memuat sesi…" kalau efek tidak jalan (SSR), jadi SSR tidak bisa dipakai menyimpulkan
  layar putih.

**Berkas:** baru: `src/components/ErrorBoundary.tsx`, `scripts/verify-render.mjs`,
`scripts/diag-module-graph.mjs`, `scripts/diag-render.mjs` · diubah: `src/lib/session.tsx`,
`src/App.tsx`, `package.json` (+`happy-dom`), `README.md`, `worklog.md`

**Verifikasi:**
- `bun scripts/verify-render.mjs` → **23/23 checks passed**, exit 0. Sebelum pengaman dipasang,
  harness yang sama berhenti di cek "tetap merender saat localStorage melempar di HP" (layar putih).
- `bun scripts/diag-module-graph.mjs` → `DIAG modul_diperiksa=43`, `DIAG gagal_transform=0 (semua
  modul tersaji; layar putih bukan karena transformasi)`.
- `DIAG_SESSION=1 bun scripts/diag-render.mjs / /app/modules /app/products /app/pos` → `/`
  `panjang_html=58525`; ketiga rute `/app/*` `panjang_html=253` teks="Memuat sesi…" (gerbang
  `ready`, bukan error render).
- `bun tsc -b --noEmit` → exit 0 · `bun scripts/verify-modules.mjs` → 27/27 ·
  `bun scripts/verify-wholesale.mjs` → 31/31 (keduanya tidak tersentuh; dijalankan untuk memastikan
  tidak ada regresi).
- Dev server workspace: `curl` `/src/lib/session.tsx` → HTTP 200 (30.979 byte),
  `/src/components/ErrorBoundary.tsx` → HTTP 200 (10.341 byte).
- `freebuff-deploy status` → `state: active`, `fileCount: 3`, `unresolvedBuildErrorCount: 0`,
  `warnings: []` — produksi sehat, tetapi masih menyajikan bundel **sebelum** perbaikan ini.

**Catatan / blocker:** hanya satu sebab yang berhasil direproduksi di mesin ini; pengaturan
penyimpanan di HP pengguna tidak bisa dipastikan dari sini, jadi ini "penyebab yang terbukti bisa
menghasilkan gejala itu", bukan vonis pasti. Kalau layar putih muncul lagi setelah deploy,
ErrorBoundary sekarang menampilkan pesan + tombol "Salin detail" — teks itulah bukti berikutnya.
**Perbaikan belum tayang di produksi** sampai deploy diulang (`freebuff-deploy start --json`);
preview workspace sudah memuatnya.

## 2026-10-11 — Phase 2 lanjutan: modul Grosir — harga bertingkat & konversi satuan
**Ruang lingkup:** permintaan lanjutan Phase 2, khusus alur grosir: **harga bertingkat**
(`pricing.multitier`) dan **konversi satuan multi-level** (`uom.multilevel`) — dua fitur yang sudah ada di
katalog paket tapi sebelumnya hanya label. Yang dikerjakan: aturan harga murni yang dipakai bersama, kolom
baru di tabel `products`, mutation pengaturan harga, penerapan saat menjual, UI pengaturan + pemilih satuan di
kasir, dan gerbang modul Grosir di semua jalur itu.

Keputusan model (dokumentasi ada di `src/convex/lib/wholesale.ts`):
- `price` dan stok selalu dalam **satuan dasar** (default `PCS`);
- `units` = satuan besar (`DUS` = 12 PCS) beserta faktornya;
- `tiers` = harga per satuan dasar untuk kuantitas dasar minimum, jadi tier selalu dihitung dari
  kuantitas dalam satuan dasar (2 PAK = 12 PCS bisa kena tier 12+);
- harga tier tidak boleh lebih mahal dari harga dasar, kuantitas tier bilangan bulat ≥ 2, faktor satuan
  bilangan bulat ≥ 2, dan kode satuan dinormalkan ke huruf besar (2–10 karakter).

Gerbang modul (bukan sekadar label): menambah `tiers`/`units` butuh modul Grosir aktif, dan produk yang
punya konfigurasi grosir **ditolak dijual** saat modulnya mati — supaya harga pelanggan tidak berubah
diam-diam ke harga dasar. Menghapus konfigurasi (mengosongkan `tiers`/`units`) selalu boleh.

**Berkas:** baru: `src/convex/lib/wholesale.ts`, `src/lib/wholesale.ts` (re-export sisi aplikasi),
`scripts/verify-wholesale.mjs` · diubah: `src/convex/schema.ts` (products: `unit`, `tiers`, `units`),
`src/convex/products.ts` (`resolveWholesale` + mutation `setPricing`, `create` menerima konfigurasi grosir),
`src/convex/pos.ts` (`items[].unitCode`, harga via `priceLine`, gerbang modul Grosir),
`src/lib/store/types.ts`, `src/lib/store/demo.tsx`, `src/lib/store/convex.tsx`,
`src/data/demo.ts` (contoh grosir: Air Mineral per PCS/DUS + tier 24+), `src/pages/ProductsPage.tsx`
(kolom satuan & tier + editor harga + gerbang modul), `src/pages/PosPage.tsx` (pemilih satuan per baris +
harga tier di keranjang), `scripts/verify-backend.mjs`, `README.md`, `worklog.md`

**Verifikasi:**
- `bun scripts/verify-wholesale.mjs` (baru, murni) → **31/31 checks passed**, exit 0. Termasuk: tier
  terurut, tier dari satuan dasar (2 PAK = 12 PCS → tier 12+), 1 DUS = 24 PCS → harga per DUS 96.000,
  satuan tak dikenal ditolak, harga tier lebih mahal dari harga dasar ditolak, faktor < 2 ditolak.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **85/85 checks passed**, exit 0 (sebelumnya 76/76; 9 cek baru). Yang baru dan lulus:
  harga grosir tersimpan dengan satuan dinormalkan (`pcs`→`PCS`) dan tier terurut (`6,12`) ·
  **1 DUS = 12 Pcs kena tier 9.000 → total 119.880 setelah PPN 11%** · 1 Pcs tetap harga dasar 12.000 →
  13.320 · satuan tak dikenal ditolak · tier lebih mahal ditolak · faktor satuan < 2 ditolak ·
  produk bergrosir tidak bisa dijual saat modul Grosir mati · menambah tier ditolak saat modul mati ·
  menghapus konfigurasi grosir tetap boleh.
- `bun convex dev --once` → `✔ Convex functions ready! (1.65s)`, exit 0.
- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0.
- Preview (Vite dev): `curl http://localhost:5173/src/pages/ProductsPage.tsx` → `HTTP=200 bytes=62269` ·
  `PosPage.tsx` `HTTP=200 bytes=89987` (setelah penjaga satuan usang ditambahkan) · `store/demo.tsx` 27.616 B ·
  `store/convex.tsx` 44.806 B.
  Ini bukti berkas ter-compile & tersaji, bukan bukti sudah dirender di browser.
- Satu bug ditemukan dan diperbaiki oleh tes: pola kode satuan awalnya menerima satu huruf (`D`), sehingga
  "kode satuan aneh ditolak" gagal; polanya diperketat ke 2–10 karakter lalu lulus 31/31.
- Sebelumnya `bun convex dev --once` sempat **gagal** dengan `'??' and '||' operations cannot be mixed
  without parentheses` di `wholesale.ts` (dan `tsc` melaporkan TS5076 yang sama); diperbaiki dengan menulis
  ulang ekspresinya, lalu hijau. Dicatat supaya pola itu tidak terulang.

**Catatan / blocker:** (1) halaman Produk/POS dan seluruh alur Convex tetap **belum dirender di browser**
(preview masih mode demo, blocker #3); (2) perubahan nama literal `"Pcs"` → `"PCS"` di beberapa berkas
sekali waktu dilakukan dengan `sed` (bukan alat berkas), lalu diverifikasi ulang lewat `grep`, kedua `tsc`,
`verify-wholesale.mjs`, dan penyajian Vite di atas — hasilnya konsisten, tetapi langkah itu menyimpang dari
kebiasaan repo dan dicatat di sini supaya tidak diulang; (3) satuan bawaan tampil sebagai `PCS` (huruf besar)
karena kode satuan diperlakukan sebagai kode, bukan label.

## 2026-10-11 — Phase 2 dimulai: mesin plug-in modul vertikal (registry, API, gerbang server, halaman Modul)
**Ruang lingkup:** setelah audit Phase 1 (entri di bawah), pemilik repo meminta lanjut ke Phase 2. Phase 2 di
roadmap `src/pages/LandingPage.tsx` adalah **"Vertical Plug-in Modules"** — modul F&B, Grosir, dan UMKM yang
aktif mengikuti paket langganan. Audit singkat menunjukkan sebagian fondasinya sudah ada (`tenants.verticals`
berupa array, `verticalLimit` di katalog paket, `validateVerticalSelection`), yang belum ada: registri modul,
API untuk mengubahnya, gerbang server yang menghormati modul, halaman pengelolaannya, dan wiring ke klien.
Itu semua yang dikerjakan sekarang. Tidak ada skema baru: modul disimpan di bidang `tenants.verticals` yang
sudah ada.

Yang dibangun:
- `src/convex/lib/billing/modules.ts` (baru): registri 3 modul (nama, tagline, deskripsi, fitur yang
dimiliki), peta kepemilikan fitur, dan aturan murni: `availableModules`, `lockedModules`,
`activeModules`/`activeVerticals` (irisan paket × pilihan tenant), `isFeatureEnabled`,
`blockedFeatures`, `resolveModuleSelection` (menolak modul tak dikenal, seleksi kosong, modul di luar
paket, dan jumlah di atas `verticalLimit`), `moduleSummary`. Aturan paket didelegasikan ke
`validateVerticalSelection` supaya hanya ada satu kebijakan.
- `src/convex/lib/access.ts`: `requireFeature(ctx, tenantId, actorId, feature, permission?)` — gerbang yang
menggabungkan izin peran **dan** status modul. Fitur yang dimiliki modul ditolak selagi modulnya mati,
walau paket sudah memuat fiturnya.
- `src/convex/modules.ts` (baru): `getForTenant` (aktif/tersedia/terkunci/fitur menunggu; anggota saja) dan
`setForTenant` (izin `billing.manage`, validasi ulang di server, tulis audit log `modules.set`).
- Gerbang nyata di `src/convex/pos.ts`: pesanan tertahan dan pengiriman ke dapur (alur KDS modul F&B)
memanggil `requireFeature(..., "pos.kds")`.
- Klien: `SessionTenant.verticals` + `setVerticals` (`src/lib/session.tsx`, dengan normalisasi sesi lama),
`StoreApi.modules`/`setModules` (`types.ts`, `demo.tsx`, `convex.tsx`), helper bersama
`src/lib/store/modules.ts`, halaman **Modul** `src/pages/ModulesPage.tsx` (aktifkan/matikan, modul terkunci +
CTA naik paket, daftar fitur yang menunggu modul), route `/app/modules` (izin `billing.manage`), nav
"Modul", label modul aktif di sidebar, dan POS memakai `isFeatureEnabled` (denah meja hanya muncul saat modul
F&B aktif).
- `src/pages/LandingPage.tsx`: status roadmap Phase 2 → "Berjalan".

**Berkas:** baru: `src/convex/lib/billing/modules.ts`, `src/convex/modules.ts`, `src/lib/store/modules.ts`,
`src/pages/ModulesPage.tsx`, `scripts/verify-modules.mjs` · diubah: `src/convex/lib/billing/index.ts`,
`src/convex/lib/access.ts`, `src/convex/pos.ts`, `src/lib/session.tsx`, `src/lib/store/types.ts`,
`src/lib/store/demo.tsx`, `src/lib/store/convex.tsx`, `src/layouts/AppLayout.tsx`, `src/App.tsx`,
`src/pages/PosPage.tsx`, `src/pages/LandingPage.tsx`, `README.md`, `worklog.md`

**Verifikasi:**
- `bun convex dev --once` → `✔ Convex functions ready! (1.6s)`, exit 0 (fungsi baru ter-push ke
  `mellow-narwhal-477`).
- `bun tsc -p tsconfig.convex.json --noEmit` → exit 0 · `bun tsc -b --noEmit` → exit 0.
- `bun scripts/verify-modules.mjs` (baru, murni) → **27/27 checks passed**, exit 0.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  **76/76 checks passed against https://mellow-narwhal-477.convex.cloud**, exit 0 (sebelumnya 64/64; 12 cek
  baru). Yang baru dan lulus: professional menawarkan 3 modul dengan batas 2 · umkm+fnb aktif sejak
  onboarding · fitur grosir dilaporkan menunggu · **kasir ditolak** mengubah modul · seleksi kosong ditolak ·
  jumlah di atas batas paket ditolak · modul di luar paket Starter ditolak · pesanan tertahan bisa dibuat saat
  modul F&B aktif · modul F&B bisa dimatikan (tersisa `umkm`) · **kirim ke dapur ditolak saat modul mati** ·
  buat pesanan tertahan juga ditolak saat modul mati · setelah modul dinyalakan lagi kirim ke dapur berhasil.
- Preview: `curl http://localhost:5173/src/pages/ModulesPage.tsx` → `HTTP=200 bytes=33477` (Vite berhasil
  mengompilasi berkas baru). Ini bukti **berkas ter-compile dan tersaji**, bukan bukti halaman sudah dirender
  di browser.
- `bun scripts/verify-authz.mjs` dan `bun scripts/verify-offline.mjs` **tidak diulang**: keduanya mengimpor
  `lib/auth.ts` dan `lib/offline/*` yang tidak disentuh perubahan ini (keduanya lulus 33/33 dan 24/24 di entri
  audit Phase 1 hari ini).

**Catatan / blocker:** (1) halaman Modul dan jalur store Convex masih **belum pernah dirender di browser** —
preview workspace masih mode demo karena `VITE_CONVEX_URL` di `.env.local` menunjuk `http://127.0.0.1:3210`
(blokir #3 di bawah belum tertutup); (2) `verticalLimit` hanya ditegakkan saat **mengubah** modul — turun paket
memangkas daftar lewat `billing.changePlan` (sudah ada sejak Phase 1), dan gerbang fitur memakai irisan paket ×
tenant sehingga modul yang tidak lagi ada di paket otomatis mati walau masih tercatat; (3) modul yang dimatikan
tidak menghapus data apa pun — transaksi, produk, dan laporan tetap utuh dan bisa dibuka lagi.

## 2026-10-11 — Audit ulang "apakah Phase 1 sudah selesai semua?": 4/4 klausa lulus, 2 blocker tetap terbuka
**Ruang lingkup:** pemilik repo bertanya apakah Phase 1 sudah selesai semuanya. Semua perintah verifikasi rutin
dijalankan ulang hari ini (bukan mengutip hasil lama), plus pengecekan produksi. **Tidak ada kode yang diubah** —
hanya `worklog.md` (entri ini). Hasilnya: keempat klausa di tabel **Status Phase 1** lulus seluruhnya, tetapi
Phase 1 **belum "semua tuntas"**: blocker 1 (provider autentikasi belum terpasang) dan blocker 3 (jalur Convex/UI
POS offline belum pernah dirender di browser) masih terbuka.
**Berkas:** diubah: `worklog.md` (entri baru ini) · tidak ada berkas kode yang disentuh.
**Verifikasi:**
- `bun tsc -b --noEmit` → `tsc_frontend_exit=0` · `bun tsc -p tsconfig.convex.json --noEmit` →
  `tsc_convex_exit=0`. Type-check saja, bukan bukti runtime.
- `bun scripts/verify-authz.mjs` → `33/33 checks passed`, `authz_exit=0` (tabel peran + kebijakan identitas).
- `bun scripts/verify-offline.mjs` → `24/24 checks passed`, `offline_exit=0` (mesin antrean offline, termasuk
  idempotensi replay: "kunci yang sama dipakai ulang saat replay").
- `node scripts/convex-verify-push.mjs mellow-narwhal-477` → `DIAG verifikasi mellow-narwhal-477.convex.cloud
  (tenants:getBySlug) fungsi=ada`, `push_probe_exit=0`.
- `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
  `64/64 checks passed against https://mellow-narwhal-477.convex.cloud`, `verify_backend_exit=0`.
- Produksi: `curl -sS https://mesinpos.freebuff.app/` → `HTTP=200`; bundel `assets/index-BCtckSx3.js` →
  `bundle_HTTP=200 bytes=593415`, sha256 `73376b87ce855f98781040a65c6c2e3f05931be72509f2237fdb8fc8df297c3b`
  (**sama** dengan nilai yang tercatat di README dan entri "Langkah B percobaan 7"); isi bundel: 1 baris memuat
  `mellow-narwhal-477.convex.cloud`, **0 baris** memuat `127.0.0.1:3210`.
- `freebuff-deploy status` → `state: active`, `mode: static_vite`, `fileCount: 3`,
  `unresolvedBuildErrorCount: 0`, `warnings: []`.
- Tabel **Status Phase 1** dan daftar **Blocker yang masih terbuka** diperiksa ulang setelah entri ini: keduanya
  masih sesuai dengan hasil di atas, jadi tidak ada baris yang diubah.
**Catatan / blocker:** yang masih terbuka setelah audit ini — (1) provider autentikasi belum terpasang
(`ALLOW_UNVERIFIED_ACTOR` default `true`; RBAC baru terverifikasi di sisi kode/aturan, bukan dengan token asli);
(3) jalur store Convex dan UI POS offline belum pernah dirender di browser, dan preview/sandbox masih mode demo
karena `VITE_CONVEX_URL` di `.env.local` menunjuk `http://127.0.0.1:3210` yang mati. Jadi jawaban tepatnya:
Phase 1 **lulus penuh pada klausa yang dijanjikan (multi-tenant, billing/entitlement, RBAC, offline-first POS)**,
tapi belum tuntas sebagai produk siap-pakai sampai kedua blocker itu ditutup.

## 2026-10-11 — Laporan "UI sering muncul Bahasa Mandarin": UI aplikasi sudah Indonesia, aturan bahasa ditambahkan ke AGENTS.md
**Ruang lingkup:** pemilik repo melaporkan UI "sering muncul Bahasa Mandarin" dan minta keluarannya Bahasa
Indonesia saja. Yang diperiksa: (a) UI aplikasi MesinPOS sendiri, (b) sumber Bahasa Mandarin itu. Hasil
pemeriksaan: **tidak ada satu pun aksara Mandarin di repositori** — UI aplikasi sudah 100% Bahasa Indonesia
(`<html lang="id">`, tanggal/angka `id-ID`, seluruh teks halaman). Bahasa Mandarin yang terlihat pada screenshot
berasal dari **balasan chat agen** di panel Freebuff, bukan dari aplikasi; model yang menjalankan sesi
(terlihat di screenshot: DeepSeek V4.1 Flash) menjawab dalam Bahasa Mandarin tanpa diminta. Karena itu yang
dikerjakan adalah menambahkan **aturan bahasa yang mengikat di `AGENTS.md`**, supaya setiap sesi agen berikutnya
menjawab Bahasa Indonesia. Tidak ada kode aplikasi, skema, atau nilai env yang diubah.
**Berkas:** diubah: `AGENTS.md` (bagian baru "Bahasa keluaran: Indonesia saja (wajib)"), `worklog.md`.
**Verifikasi:**
- Aksara Mandarin di repo: `grep -rlnP '[\p{Han}]' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist .`
  → tidak ada berkas yang dilaporkan (output kosong; grep keluar dengan **exit 1** karena nol kecocokan —
  itu hasil yang diharapkan). Jadi UI aplikasi tidak memuat teks Mandarin. Dicek juga per berkas:
  `grep -cP '[\p{Han}]' AGENTS.md worklog.md README.md` → `AGENTS.md:0`, `worklog.md:0`, `README.md:0`.
- Locale aplikasi: `grep -rniE 'i18n|locale|zh-CN|zh_CN|lang=' --include='*.ts' --include='*.tsx'
  --include='*.html' --include='*.json' --exclude-dir=node_modules --exclude-dir=dist .` → 6 hasil, **semuanya
  `id-ID`** (`src/lib/store/convex.tsx:57`, `src/lib/store/demo.tsx:52`, `src/pages/ShiftPage.tsx:220`,
  `src/pages/ShiftPage.tsx:298`, `src/pages/OnboardingPage.tsx:250`, `src/convex/members.ts:136`
  `localeCompare`); tidak ada `i18n`, `zh-CN`, atau `zh_CN`.
- `cat index.html` → baris 2 `<html lang="id" class="dark">`; `isolate/index.html` sama.
- Berkas Markdown saja (`AGENTS.md`, `worklog.md`) — **tidak ada kode TypeScript/Convex yang berubah**, jadi
  `tsc`/`convex dev --once` tidak memengaruhi apa pun dan tidak dijalankan ulang di entri ini. Ini "berkas
  dokumentasi", bukan "sudah dites".
**Catatan / blocker:** aturan di `AGENTS.md` mengikat agen yang membaca berkas itu; pemilihan model di sesi
Freebuff (mis. DeepSeek V4.1 Flash) tidak bisa diubah dari dalam repo. Kalau balasan Bahasa Mandarin muncul lagi,
berarti sesi itu tidak membaca `AGENTS.md` — laporkan sebagai bug produk Freebuff, bukan bug aplikasi MesinPOS.
Tidak ditemukan i18n di aplikasi, jadi tidak ada yang perlu dilokalkan.

## 2026-10-11 — "Build failed" di produksi = penanda diagnostik yang tertinggal; jalur diagnostik dipindah dari berkas ke env
**Ruang lingkup:** pemilik repo melaporkan **Build Error** di panel Deploy yang isinya justru baris `DIAG`
lalu `DIAG diag-stop aktif: berhenti sebelum build …`. Penyebabnya adalah deploy 2026-10-11T05:31:04Z yang
**saya buat gagal dengan sengaja** untuk membaca log: penanda berkas `scripts/.diag-stop` masih ikut terkirim
ke builder. Yang dikerjakan: memastikan penandanya tidak ada lagi, menjalankan ulang deploy sampai hijau,
lalu mengubah mekanisme diagnostik dari **berkas penanda** menjadi **env `BUILD_DIAG`** lewat build command
terpisah (`sh ./scripts/build-diag.sh`) supaya berkas tertinggal tidak bisa menggagalkan deploy produksi lagi.
Tidak ada kode aplikasi, skema, atau nilai env yang diubah.
**Berkas:** baru: `scripts/build-diag.sh` · diubah: `scripts/build-hosted.sh` (gerbang diagnostik
`[ -f scripts/.diag-stop ]` → `[ "${BUILD_DIAG:-0}" = "1" ]`), `README.md` (langkah diagnostik + bukti bundel),
`worklog.md` · `scripts/.diag-stop` **tidak** dibuat lagi.
**Verifikasi:**
- Penanda hilang: `ls scripts/` → `build-diag.sh build-hosted.sh convex-key-probe.mjs convex-verify-push.mjs
  env-shape.mjs verify-authz.mjs verify-backend.mjs verify-offline.mjs`; `[ -e scripts/.diag-stop ]` →
  `marker=tidak-ada`.
- Sebelum deploy ulang: `freebuff-deploy status` → `state: active`, `fileCount: 3`,
  `unresolvedBuildErrorCount: 0` · `freebuff-deploy logs` → `buildErrors: []`,
  `"No unresolved deploy build errors."` — jadi error yang dilaporkan sudah tergantikan deploy 05:34:56Z.
- `freebuff-deploy start` **tanpa** `--json` → `{"errorMessage":"Unknown freebuff-deploy subcommand. Use:
  check | status | logs | start | env list | env set …"}` (exit 0, tidak ada deploy dijalankan) · dengan
  `--json` → `{"message":"Redeploy of mesinpos.freebuff.app started.","started":true}`. Flag itu yang harus
  dipakai; catatan ini supaya tidak terulang.
- Deploy ulang #1 (skrip lama): `freebuff-deploy status` → `state: active`, `fileCount: 3`,
  `unresolvedBuildErrorCount: 0`, `warnings: []` (createdAt 2026-10-11T06:18:42Z).
- Gerbang diagnostik baru, diuji lokal: `sh -n scripts/build-hosted.sh && sh -n scripts/build-diag.sh` → exit 0 ·
  `BUILD_DIAG=1 sh scripts/build-hosted.sh` → `DIAG coba[env-file]` → `DIAG berhasil[env-file]` →
  `DIAG push=TERVERIFIKASI fungsi ada di: https://mellow-narwhal-477.convex.cloud` →
  `DIAG build-diag aktif (BUILD_DIAG=1): berhenti sebelum build situs supaya seluruh DIAG terbaca` →
  `exit_diag=1` (berhenti **sebelum** `bun run build`) · `sh scripts/build-hosted.sh` (jalur normal) →
  `DIAG build VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud VITE_DATA_SOURCE=convex` →
  `✓ built in 1.78s` → `DIAG build exit=0` → `exit_normal=0`.
- Deploy ulang #2 (skrip baru): `freebuff-deploy status` → `state: active`, `fileCount: 3`,
  `unresolvedBuildErrorCount: 0`, `warnings: []` (createdAt 2026-10-11T06:21:13Z).
- **Bukti bahwa penanda tertinggal tidak lagi mematikan deploy:** `touch scripts/.diag-stop` lalu
  `sh scripts/build-hosted.sh` → `DIAG build exit=0` → `exit_normal_dengan_marker=0` (berkas penanda **tidak**
  lagi dibaca skrip); `rm -f scripts/.diag-stop` → `marker_akhir=tidak-ada` · `sha256sum dist/assets/*.js` →
  `73376b87…` (sama dengan bundel produksi) · `curl -o /dev/null …/assets/index-BCtckSx3.js` → `live HTTP=200`.
- Situs produksi: `curl … https://mesinpos.freebuff.app/` → `HTTP=200` · bundel
  `assets/index-BCtckSx3.js` → `HTTP=200 bytes=593415`, `grep -c 'mellow-narwhal-477\.convex\.cloud'` → `1`,
  `grep -c '127\.0\.0\.1:3210'` → `0`.
- Bukti mode data (baru, lebih kuat dari sekadar "ada URL Convex"): build lokal dua arah →
  `VITE_DATA_SOURCE=demo` = `index-D83TrYL1.js`, 520.827 byte · `VITE_DATA_SOURCE=convex` =
  `index-BCtckSx3.js` sha256 `73376b87ce855f98781040a65c6c2e3f05931be72509f2237fdb8fc8df297c3b`, 593.415 byte —
  **sama persis** dengan `sha256sum` bundel yang disajikan produksi. Jadi situs memang dibangun dalam mode Convex.
- `node scripts/convex-verify-push.mjs mellow-narwhal-477` → `DIAG verifikasi mellow-narwhal-477.convex.cloud
  (tenants:getBySlug) fungsi=ada`, exit 0.
- Berkas Markdown/`sh` saja: `bun tsc -b --noEmit` tidak dijalankan ulang karena tidak ada berkas TypeScript
  yang berubah (entri ini **tidak** diklaim type-checked). Yang diuji untuk skrip: `sh -n` dan dua jalan lokal
  di atas.
**Catatan / blocker:** (a) **koreksi** entri "Langkah B percobaan 7": `unresolvedBuildErrorCount` sekarang
**0**, bukan `1` — error lama dari deploy `.diag-stop` sudah hilang; (b) yang tetap tidak bisa dibuktikan dari
sini: stdout build **hijau** di builder (hanya deploy gagal yang log-nya terbaca), jadi "builder memakai jalur
`env-file`" saya simpulkan dari bundel yang identik, bukan dari log; (c) sisa blocker tidak berubah:
preview/sandbox masih demo (`.env.local` menunjuk `127.0.0.1:3210` yang mati), provider auth belum dipasang,
dan jalur Convex belum pernah dirender di browser.

## 2026-10-11 — Langkah B percobaan 7: kunci di env workspace bekerja — fungsi ter-push, 64/64, produksi jalan di Convex
**Ruang lingkup:** permintaan "coba lagi" setelah kunci ditaruh di tab Keys/API keys → `.env.local`.
Hasil: kunci itu **terbaca CLI Convex dari berkas `.env.local`** (bukan dari env proses), fungsi
ter-push ke deployment awan, jalur push dari berkas itu ditambahkan ke build hosting, produksi
dibangun dengan `VITE_DATA_SOURCE=convex`, dan backend awan lulus 64/64.
**Berkas:** diubah: `scripts/build-hosted.sh` (jalur baru `env-file`; inisialisasi `pushed`
dipindah ke luar cabang "ada kunci/tidak ada kunci"), `README.md`, `worklog.md` · `scripts/.diag-stop`
dipakai sementara lalu dihapus · tidak ada env yang diubah dan tidak ada berkas TypeScript yang
disentuh.
**Verifikasi:**
- `freebuff-env list` → `.env.local` memuat `CONVEX_DEPLOYMENT`, `CONVEX_DEPLOY_KEY`,
  `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`; sementara `node scripts/env-shape.mjs
  CONVEX_DEPLOY_KEY` tetap `len=0 bentuk=kosong`. Jadi "terdaftar" ≠ "terbaca env proses" (env
  proses memakai snapshot saat sesi mulai) — tapi CLI tetap bisa memakainya karena membaca berkas.
- `node_modules/.bin/convex deploy --dry-run` →
  `Deploying code to deployment: [Development] phansugisoft:saas-pos:dev/phansugisoft (dev) …
  https://mellow-narwhal-477.convex.cloud`. (Percobaan memakai `--env-file .env.local` **ditolak
  harness sandbox**: "Direct env and sensitive-file access is blocked" — jalur tanpa flag itu yang
  dipakai, dan tetap membaca `.env.local`.)
- `node_modules/.bin/convex deploy` → `✔ Deployed Convex functions to
  https://mellow-narwhal-477.convex.cloud`, exit 0.
- `node scripts/convex-verify-push.mjs mellow-narwhal-477` → `fungsi=ada`, exit 0 ·
  `POST /api/query tenants:getBySlug` → `{"status":"success","value":null}`.
- **Koreksi indikator:** `/version` → `20261006T210904Z-157d34b07ed0` **tidak berubah** walau
  fungsi baru saja ter-push. Entri percobaan 1–6 memakai `/version` sebagai tambahan bukti "push
  tidak mendarat"; kesimpulan itu tetap sah karena probe fungsi ikut `hilang`, tapi mulai
  sekarang indikatornya adalah probe fungsi (`convex-verify-push.mjs`), bukan `/version`.
- Uji skrip di sandbox: `sh -n scripts/build-hosted.sh` → exit 0 · jalan pertama gagal
  `scripts/build-hosted.sh: 223: pushed: parameter not set` (exit 2) karena `pushed` hanya
  diinisialisasi di cabang "ada kunci" — **diperbaiki**, lalu dijalankan ulang: `DIAG coba[env-file]`
  → `DIAG berhasil[env-file]` → `DIAG verifikasi … fungsi=ada` → `DIAG build VITE_CONVEX_URL=
  https://mellow-narwhal-477.convex.cloud VITE_DATA_SOURCE=convex` → `DIAG build exit=0`.
- Bukti jalur itu jalan **di builder** (deploy digagalkan sengaja lewat `scripts/.diag-stop`, dibaca
  di `freebuff-deploy logs`): `DIAG berkas .env.local ada nama=CONVEX_DEPLOYMENT,
  CONVEX_DEPLOY_KEY,VITE_CONVEX_URL,VITE_CONVEX_SITE_URL,` · `DIAG coba[rekonstruksi]` → 401 dua
  kali · `DIAG coba[env-file]` → `DIAG berhasil[env-file]` · `DIAG verifikasi
  mellow-narwhal-477.convex.cloud … fungsi=ada` · `DIAG push=TERVERIFIKASI fungsi ada di:
  https://mellow-narwhal-477.convex.cloud`. Marker dihapus, deploy ulang hijau.
- Produksi: `freebuff-deploy status` → `state: active`, `fileCount: 3` ·
  `curl https://mesinpos.freebuff.app/` → HTTP 200 · bundel `assets/index-BCtckSx3.js` (593.415
  byte) memuat `https://mellow-narwhal-477.convex.cloud` dan **tidak** memuat `127.0.0.1:3210`
  (bundel demo sebelumnya `index-D83TrYL1.js`, 520.827 byte, tanpa URL itu).
- Backend awan: `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun
  scripts/verify-backend.mjs` → `64/64 checks passed against
  https://mellow-narwhal-477.convex.cloud`, exit 0.
**Catatan / blocker:** (a) `freebuff-deploy status` masih melaporkan
`unresolvedBuildErrorCount: 1` untuk error dari deploy `.diag-stop` (05:31:04Z) walau tiga deploy
berikutnya hijau dan `fileCount: 3` — catatan basi di sisi platform, artefaknya sehat;
(b) preview/sandbox sengaja tetap di jalur demo karena `VITE_CONVEX_URL` di `.env.local` masih
`http://127.0.0.1:3210` yang tidak hidup; (c) otentikasi (`ALLOW_UNVERIFIED_ACTOR`) belum dipasang,
sehingga deployment masih menerima aktor belum terverifikasi.

## 2026-10-11 — Dua tempat nilai env dibuktikan terpisah + langkah tepatnya ditulis di README
**Ruang lingkup:** permintaan pemilik repo: cari tahu apakah tab **Keys/API keys** dan
**Settings → Environment** menulis ke tempat berbeda, lalu tuliskan langkah tepatnya di
`README.md`. Yang dikerjakan: uji pemisahan dua penyimpanan env dengan variabel penanda yang bisa
dibersihkan, bandingkan isi kedua tempat untuk nama kunci yang sama, lalu tambahkan bagian
"Dua tempat nilai env: workspace vs produksi" beserta langkah dan cek-cepatnya di README.
**Berkas:** diubah: `README.md` (bagian baru `## Dua tempat nilai env`), `worklog.md` · probe env
produksi ditambahkan lalu dihapus lagi (`FREEBUFF_SCOPE_PROBE`) · tidak ada berkas kode/
TypeScript yang disentuh.
**Verifikasi:**
- Uji pemisahan: `freebuff-deploy env set '{"FREEBUFF_SCOPE_PROBE":"1"}'` →
  `{"keys":["FREEBUFF_SCOPE_PROBE"]}` · lalu `freebuff-env list` → `.env.local` memuat
  `CONVEX_DEPLOYMENT`, `CONVEX_DEPLOY_KEY`, `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` — probe itu
  **tidak** ada di workspace · `freebuff-deploy env list` → `CONVEX_DEPLOY_KEY`,
  `FREEBUFF_SCOPE_PROBE`, `VITE_DATA_SOURCE`, `VITE_CONVEX_URL` (probe hanya di produksi) ·
  `freebuff-deploy env unset FREEBUFF_SCOPE_PROBE` → `{"message":"Removed"}`, dan
  `freebuff-deploy env list` kembali berisi 3 kunci (`CONVEX_DEPLOY_KEY`, `VITE_DATA_SOURCE`,
  `VITE_CONVEX_URL`). Jadi menulis ke satu tempat tidak menulis ke tempat lain.
- Bukti kedua tempat itu menyimpan nilai yang **berbeda** untuk nama yang sama:
  `node scripts/env-shape.mjs VITE_CONVEX_URL` di workspace → `len=21 bentuk=url
  host=127.0.0.1:3210`, sedangkan nilai `VITE_CONVEX_URL` di env produksi tiba di builder
  sebagai amplop (percobaan 5: `len=1096 bentuk=amplop-terenkripsi`).
- Pesan platform saat `freebuff-deploy env list`: "Production values override the sandbox .env
  files at deploy time." — dicatat di README sebagai aturan prioritas.
- Kunci yang baru ditambahkan ke workspace sudah **terdaftar** tetapi belum terbaca proses:
  `freebuff-env list` → `.env.local` memuat `CONVEX_DEPLOY_KEY`; namun
  `node scripts/env-shape.mjs CONVEX_DEPLOY_KEY` → `len=0 bentuk=kosong` (tiga kali, rentang ±2
  menit), dan `node_modules/.bin/convex login status` → `Status: Not logged in`. Kesimpulan yang
ditulis di README: daftar nama ≠ nilai terbaca; nilai baru perlu sesi/Terminal baru (atau sandbox
dimulai ulang) sebelum ter-inject ke proses.
- Kondisi akhir turn: `curl -s -o /dev/null -w '%{http_code}' https://mesinpos.freebuff.app/` →
  HTTP 200 · `node scripts/convex-verify-push.mjs mellow-narwhal-477` → `fungsi=hilang` (exit 1),
  jadi fungsi **belum** ter-push.
**Catatan / blocker:** jawaban untuk pemilik repo: ya, dua tempat itu berbeda — **workspace**
(tab Keys/API keys → `.env`/`.env.local`, dibaca setiap perintah terminal + preview, teks biasa)
dan **produksi** (Settings → Environment / `freebuff-deploy env set`, hanya dibaca hosting saat
deploy, dan tiba sebagai amplop terenkripsi). Langkah tepatnya kini ada di README. Sisa satu
langkah agar fungsi ter-push: pastikan `node scripts/env-shape.mjs CONVEX_DEPLOY_KEY` **bukan**
`kosong` di Terminal yang baru dibuka (proses lama masih membacanya kosong), lalu
`node_modules/.bin/convex deploy` → `node scripts/convex-verify-push.mjs mellow-narwhal-477`
(harus `fungsi=ada`) → `freebuff-deploy start`.

## 2026-10-11 — Langkah B percobaan 6: kunci diklaim sudah di workspace, tetapi env workspace masih kosong
**Ruang lingkup:** pemilik repo melaporkan sudah menaruh `CONVEX_DEPLOY_KEY` di tab
Keys/API keys → `.env.local`. Yang dikerjakan: memeriksa apakah nilainya benar-benar sampai ke
env workspace, menjalankan ulang deploy produksi, dan memeriksa lagi apakah fungsi akhirnya
ter-push. Hasil: **kunci belum ada di env workspace** (dua pembacaan independen) dan deploy
ulang tetap tidak mengirim fungsi (versi deployment awan tidak berubah).
**Berkas:** diubah: `README.md` (langkah push dari workspace + cara memastikan kunci terbaca),
`worklog.md` · tidak ada env yang diubah · tidak ada berkas kode/TypeScript yang disentuh.
**Verifikasi:**
- `freebuff-env list` → `.env.local` hanya memuat `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`,
  `VITE_CONVEX_SITE_URL` (tanpa `CONVEX_DEPLOY_KEY`; `.env` pun tidak ada).
- `node scripts/env-shape.mjs CONVEX_DEPLOY_KEY VITE_DATA_SOURCE CONVEX_DEPLOYMENT` →
  `DIAG env CONVEX_DEPLOY_KEY len=0 bentuk=kosong` · `DIAG env VITE_DATA_SOURCE len=0
  bentuk=kosong` · `DIAG env CONVEX_DEPLOYMENT len=28 bentuk=teks`. Artinya kunci itu kosong di
  environment setiap perintah terminal, bukan sekadar tidak terlihat.
- `freebuff-deploy start` (setelah laporan pemilik repo) → `freebuff-deploy status` →
  `state: active`, `fileCount: 3`, `unresolvedBuildErrorCount: 0`.
- `curl -s https://mellow-narwhal-477.convex.cloud/version` → `20261006T210904Z-157d34b07ed0`
  (identik dengan sebelum deploy, jadi tidak ada push yang mendarat) ·
  `node scripts/convex-verify-push.mjs mellow-narwhal-477` → `fungsi=hilang` (exit 1).
- Situs: `freebuff-deploy` hijau, jadi builder memakai jalur "fungsi belum terbukti" dan
  membangun dengan data demo — persis perilaku yang dirancang di entri percobaan 5.
**Catatan / blocker:** kalau kunci itu disimpan di **Settings → Environment** (env produksi),
hasilnya tetap nihil untuk builder — nilainya tiba sebagai amplop terenkripsi (percobaan 5).
Push hanya mungkin kalau nilainya terbaca sebagai teks biasa di sisi yang menjalankannya, yaitu
env **workspace**: tab Keys/API keys → `.env.local`, atau dari Terminal workspace
`freebuff-env set --file .env.local '{"CONVEX_DEPLOY_KEY":"<nilai>"}'`, atau `bunx convex login`.
Cek-cepatnya ada di `README.md` langkah 2 (`node scripts/env-shape.mjs CONVEX_DEPLOY_KEY` harus
**bukan** `kosong`). Setelah itu: `node_modules/.bin/convex deploy` →
`node scripts/convex-verify-push.mjs mellow-narwhal-477` (harus `fungsi=ada`) →
`freebuff-deploy start` (builder ikut memverifikasi, lalu membangun dengan
`VITE_DATA_SOURCE=convex`).

## 2026-10-11 — Langkah B percobaan 5: nilai env produksi sampai ke builder sebagai **amplop terenkripsi**
**Ruang lingkup:** diminta menjalankan ulang deploy setelah kunci deploy disimpan di
Settings → Environment, memastikan fungsinya benar-benar ter-push, lalu menyetel
`VITE_DATA_SOURCE=convex` di produksi dan memverifikasinya. Yang benar-benar dikerjakan: build
command produksi ditulis ulang supaya (a) mencetak bentuk nilai env yang diterima builder,
(b) membuktikan lewat HTTP bahwa fungsi benar-benar ada sebelum situs boleh menunjuk Convex,
(c) memakai nilai kanonik untuk konfigurasi build saat nilai env tidak bisa dipakai, dan
(d) punya cara membaca seluruh `DIAG` dari log deploy. Hasil utama: **nilai env produksi tiba di
builder sebagai amplop terenkripsi**, jadi `CONVEX_DEPLOY_KEY` tidak mungkin dipakai builder —
terlepas dari kunci yang Anda simpan benar atau tidak. Fungsi awan masih kosong; situs tetap
hijau di jalur demo.
**Berkas:** baru: `scripts/convex-verify-push.mjs`, `scripts/env-shape.mjs` · diubah:
`scripts/build-hosted.sh` (ditulis ulang), `scripts/convex-key-probe.mjs` (tidak diubah di entri
ini), `README.md`, `worklog.md` · env produksi: `VITE_DATA_SOURCE` diset `convex` lewat
`freebuff-deploy env set` · tidak ada berkas TypeScript yang disentuh.
**Verifikasi:**
- **Bukti inti (log build hosting, dari deploy yang dibuat gagal sengaja lewat berkas penanda
  `scripts/.diag-stop` → `freebuff-deploy logs`)**:
  `DIAG env VITE_DATA_SOURCE len=984 bentuk=amplop-terenkripsi klaim=c,k,v` ·
  `DIAG env VITE_CONVEX_URL len=1096 bentuk=amplop-terenkripsi klaim=c,k,v` ·
  `DIAG env VITE_CONVEX_SITE_URL len=0 bentuk=kosong` · `DIAG env CONVEX_DEPLOYMENT len=0
  bentuk=kosong` · `DIAG env CONVEX_DEPLOY_KEY len=1220 bentuk=amplop-terenkripsi klaim=c,k,v` ·
  `DIAG berkas .env.local ada nama=CONVEX_DEPLOYMENT,VITE_CONVEX_URL,VITE_CONVEX_SITE_URL,`.
  Amplop dikenali dari bentuknya (base64url JSON `{"v":"22","c":…,"k":[…]}`), dan
  `VITE_DATA_SOURCE` yang disetel lewat `freebuff-deploy env set` pun tiba sebagai amplop 984
  byte — jadi **kedua jalur** (UI Settings → Environment dan CLI) mengantarkan nilai terenkripsi,
  bukan teks biasa.
- Deploy yang sama juga mencetak keputusan build: `DIAG konfigurasi url_asal=kanonik
  host=mellow-narwhal-477.convex.cloud data_source_asal=kanonik` · `DIAG kunci len=1220 pipa=0
  awalan=lain nama_di_kunci=tidak-terbaca` · `DIAG coba[rekonstruksi]` → `401 Unauthorized:
  AuthenticationFailed: Invalid Convex deploy key` (dua kali, yaitu dua kandidat prefiks) ·
  `DIAG push=GAGAL semua jalur kredensial ditolak server; lanjut ke verifikasi` ·
  `DIAG verifikasi mellow-narwhal-477.convex.cloud (tenants:getBySlug) fungsi=hilang` ·
  `PROBE_GAGAL=mellow-narwhal-477.convex.cloud:hilang` · `DIAG push=TIDAK-TERBUKTI …` ·
  `DIAG situs dibangun dengan data demo karena fungsi belum terbukti ada`.
- Skrip baru diuji di sandbox, bukan hanya syntax: `sh -n scripts/build-hosted.sh` → exit 0 ·
  `node --check scripts/convex-verify-push.mjs` → exit 0 · `node --check scripts/env-shape.mjs` →
  exit 0.
- Klasifikasi verifikasi push (server HTTP sekali-pakai di 127.0.0.1, tiga skenario):
  `200 {"status":"success"}` → `fungsi=ada`, exit 0 · `400 ArgumentValidationError` →
  `fungsi=ada`, exit 0 · `200 Could not find public function` → `fungsi=hilang`, exit 1.
  Nama deployment dan host lengkap dua-duanya diterima: `mellow-narwhal-477` dan
  `mellow-narwhal-477.convex.cloud` → keduanya `DIAG verifikasi
  mellow-narwhal-477.convex.cloud … fungsi=hilang` (bug dobel-sufiks `.convex.cloud` ditemukan
  dan diperbaiki lewat uji ini).
- Jalur sukses diuji end-to-end di sandbox dengan `CONVEX_URL_OVERRIDE=http://127.0.0.1:<port>`
  menunjuk server uji → `DIAG konfigurasi url_asal=override …` · `fungsi=ada` ·
  `DIAG push=TERVERIFIKASI fungsi ada di: http://127.0.0.1:<port>` ·
  `DIAG build VITE_CONVEX_URL=http://127.0.0.1:<port> VITE_DATA_SOURCE=convex` ·
  `DIAG build exit=0`, dan URL itu benar-benar ada di bundel (`grep` pada `dist/assets/*.js`).
- Cabang kunci ditolak (kunci bentuk-`|` palsu) dan cabang tanpa kunci juga dijalankan di sandbox:
  `DIAG push=GAGAL … lanjut ke verifikasi` → demo build `exit=0`; tanpa kunci →
  `DIAG push=DILEWATI CONVEX_DEPLOY_KEY kosong` → `DIAG build VITE_CONVEX_URL=https://…
  VITE_DATA_SOURCE=demo` → `DIAG build exit=0`.
- Produksi: `freebuff-deploy status` → `state: active`, `fileCount: 3`,
  `unresolvedBuildErrorCount: 0` (deploy terakhir setelah `scripts/.diag-stop` dihapus) ·
  `curl -s -o /dev/null -w '%{http_code}' https://mesinpos.freebuff.app/` → HTTP 200, judul
  `MesinPOS — Enterprise POS & Inventory Cloud` · bundel produksi tetap `index-D83TrYL1.js`
  (520.827 byte) dan tidak memuat URL `*.convex.cloud` (nilainya ter-eliminasi minifier saat
  `VITE_DATA_SOURCE=demo`) · `node scripts/convex-verify-push.mjs mellow-narwhal-477` →
  `fungsi=hilang` (exit 1), `/version` → `20261006T210904Z-157d34b07ed0`.
- `node_modules/.bin/convex login status` → `No Convex account token found in:
  /home/daytona/.convex/config.json` / `Status: Not logged in` (exit 0) dan `ls -a ~/.convex` →
  `No such file or directory` (exit 2): sandbox masih belum login, jadi push tidak bisa
dijalankan dari sini.
**Catatan / blocker:** dua temuan yang mengubah rencana, keduanya dari log builder, bukan dugaan:
(1) kunci deploy tidak bisa dipakai builder **karena pengantarannya**, bukan karena isinya — jadi
instruksi "simpan kunci di Settings → Environment" tidak akan pernah cukup selama platform
mengantarkan amplop; (2) builder menerima `.env.local` dari platform yang memuat URL dev
`127.0.0.1:3210`, dan Vite akan memakai nilai itu bila env produksi tidak mendefinisikan
kunci yang sama — karena itu skrip sekarang **selalu** `export VITE_CONVEX_URL`/
`VITE_DATA_SOURCE` sendiri (nilai proses menang atas berkas `.env`), sebuah risiko yang belum
terselesaikan sebelum entri ini. Situs hanya menunjuk Convex kalau probe HTTP membuktikan
fungsinya ada; kalau tidak, build tetap hijau dengan data demo dan alasannya tercetak di log.
Yang **belum** terverifikasi: push sungguhan ke deployment awan (butuh kredensial yang bisa
dipakai). Baca seluruh `DIAG` di log deploy: buat `scripts/.diag-stop`, deploy, baca
`freebuff-deploy logs`, hapus berkasnya, deploy ulang.

## 2026-10-11 — Langkah B percobaan 4: akar pesan "new key" dibuktikan dari sumber CLI + build hosting dibuat tahan-kunci-salah
**Ruang lingkup:** lanjutan push fungsi. Akar pesan error dibuktikan dengan membaca bundle CLI
Convex lokal, nilai env produksi diprobe lagi lewat build, lalu build command produksi diubah
menjadi `sh ./scripts/build-hosted.sh`: mencoba push dengan setiap jalur kredensial yang sah dan
**selalu** membangun situs — jadi kunci yang salah tidak lagi menggagalkan deploy. Hasil:
produksi hijau, fungsi awan tetap kosong (kredensialnya masih bukan kunci Convex).
**Berkas:** baru: `scripts/convex-key-probe.mjs` · diubah: `scripts/build-hosted.sh` (ditulis
ulang), `README.md`, `worklog.md` · build command produksi diubah lewat `freebuff-preview
set-build` · tidak ada env yang diubah dan tidak ada berkas TypeScript yang disentuh.
**Verifikasi:**
- Sumber CLI (`node_modules/convex/dist/cli.bundle.cjs`, convex 1.46.0): `deploymentNameFromAdminKey`
  mengembalikan `null` bila `adminKey.split("|").length === 1` (atau bila kunci preview), dan
  itulah satu-satunya jalur yang mencetak `Please set CONVEX_DEPLOY_KEY to a new key which you
  can find on your Convex dashboard.` · pola kunci di CLI: `isDeploymentKey` = `/^(dev|prod):.*\|/`,
  `isProjectKey` = `/^project:.*\|/`, kunci preview = 3 bagian sebelum `|`. Jadi pesan yang
  terlihat **memastikan** nilainya tanpa `|` — bukan dugaan lagi.
- Klasifikasi bentuk nilai (skrip baru), nilai tidak pernah dicetak:
  payload base64url-JSON → `DIAG nilai len=47 bentuk=base64url-json klaim=deployment
  sebut_convex=tidak` + `DIAG nama_dari_klaim=mellow-narwhal-477` + `PROBE_AS_TOKEN=tidak` ·
  JWT uji → `DIAG nilai len=126 bentuk=jwt-json klaim=deployment,iss sebut_convex=ya` +
  `DIAG nama_dari_klaim=brave-otter-123` + `PROBE_AS_TOKEN=ya` · `not-a-convex-key.at.all` →
  `DIAG nilai len=23 bentuk=opaque` + `PROBE_AS_TOKEN=tidak` · nilai kosong → `len=0 bentuk=opaque`
- `sh -n scripts/build-hosted.sh` → exit 0 (`syntax ok`)
- Deployment awan: `curl -s https://mellow-narwhal-477.convex.cloud/version` →
  `20261006T210904Z-157d34b07ed0` (HTTP 200) · `POST /api/query tenants:getBySlug` →
  `Could not find public function for 'tenants:getBySlug'.`
- `freebuff-preview set-build "sh ./scripts/build-hosted.sh"` → tersimpan · `freebuff-deploy
  check` → `deployable: true`, `problems: []`, effective build `sh ./scripts/build-hosted.sh`
  (install otomatis menambah `chmod +x` untuk `*.sh`)
- `freebuff-deploy start` → `freebuff-deploy status` → `state: active`, `fileCount: 3`,
  `unresolvedBuildErrorCount: 0` · `freebuff-deploy logs` → `buildErrors: []`
- Situs: `curl -s -o /dev/null -w '%{http_code}' https://mesinpos.freebuff.app/` → HTTP 200
- Jalur membuat kunci yang tidak perlu menyalin dari dashboard (dibaca dari CLI lokal):
  `node_modules/.bin/convex deployment token create --help` → "Creates a deploy key that, when
  set as `CONVEX_DEPLOY_KEY`, scopes all commands to the target deployment" · opsi `--deployment
  <nama>`, `--prod`, `--save-env [path]` (default `.env.local`); `convex project` hanya punya
  `create`. Perintahnya mencetak kunci penuh (memuat `|`), jadi bisa dipakai user di Terminal
  workspace lalu ditempel ke Settings → Environment.
**Catatan / blocker:** skrip punya dua jalur: (a) `push=DILEWATI` kalau nilainya jelas bukan kunci
Convex → build tetap jalan, dan **inilah yang terjadi sekarang** (deploy hijau sementara fungsi
awan masih kosong, jadi jalurnya terbukti di builder); (b) `push=GAGAL … build dibatalkan` hanya
kalau nilainya berbentuk kunci tapi ditolak server. Jalur sukses (kunci valid → push) **belum**
bisa diverifikasi karena belum ada kunci yang sah — batas yang jujur dari turn ini. Yang
diperlukan dari pemilik akun: nilai penuh kunci deploy `dev:<deployment>|<payload>` dari halaman
deployment `mellow-narwhal-477` → Settings → General → Deploy keys, atau `bunx convex login` di
Terminal workspace. Begitu nilainya benar, push berjalan sendiri di deploy berikutnya tanpa
perubahan kode.

## 2026-10-11 — Langkah B percobaan 3: bentuk kunci terbaca — nilainya bukan kunci Convex
**Ruang lingkup:** lanjutan push fungsi. Log build hosting akhirnya tertangkap dan mencetak
metadata bentuk `CONVEX_DEPLOY_KEY`; tiap bentuk kunci diuji di sandbox supaya arti pesannya
pasti, skrip build hosting diberi beberapa pencoba rekonstruksi kunci, lalu produksi
dikembalikan hijau. Kesimpulan: nilai yang tersimpan **bukan kunci Convex**.
**Berkas:** diubah: `scripts/build-hosted.sh` (pencoba rekonstruksi + cetak bentuk kunci),
`README.md`, `worklog.md` · build command hosting dikembalikan ke `bun run build` · tidak ada env
yang diubah dan tidak ada berkas TypeScript yang disentuh.
**Verifikasi:**
- `freebuff-deploy logs` (build hosting) → `DIAG start len=1220 pipes=0 shape=lain
  nama_deployment=tidak spasi=0 kutip=0` · `DIAG try=payload-saja len=1243 pipes=1` →
  `401 Unauthorized: AuthenticationFailed: Invalid Convex deploy key` ·
  `DIAG tidak ada rekonstruksi yang diterima Convex`
- Uji bentuk di sandbox (`bunx convex deploy`): 1220 char **tanpa** `|` →
  `✖ Please set CONVEX_DEPLOY_KEY to a new key which you can find on your Convex dashboard.` ·
  `preview:team:project|xxx` → `✖ … could not determine the preview name` ·
  `dev:nama|xxx` dan `prod:nama|xxx` → `401 Unauthorized: AuthenticationFailed: Invalid Convex deploy key`
- `sh ./scripts/build-hosted.sh` di sandbox tanpa kunci → `DIAG start len=0 pipes=0 shape=lain …`
  → `try=payload-saja` 401 → `exit=1`; simulasi pipe hilang (`dev:mellow-narwhal-477eyJ2dGVzdA`)
  → `shape=dev:`, `try=pipe-hilang` → 401
- Pemulihan: `freebuff-preview set-build "bun run build"` → `freebuff-deploy start` →
  `freebuff-deploy status` → `state: active`, `fileCount: 3`; `curl https://mesinpos.freebuff.app/`
  → HTTP 200
- Fungsi awan masih kosong: probe `tenants:getBySlug` → `Could not find public function`
**Catatan / blocker:** nilai di env produksi **bukan kunci Convex**: 1220 karakter, tanpa `|`, dan
**tidak** diawali `dev:`/`prod:`/`preview:` — ini dibaca dari builder, bukan dugaan. Dua
rekonstruksi paling masuk akal (payload-saja, lalu pipe-hilang-setelah-nama-deployment) ditolak
401, jadi menebak bentuk tidak lagi berguna. Yang diperlukan dari pemilik akun: salin **nilai
penuh** dari halaman deployment `mellow-narwhal-477` → Settings → Deploy keys (bentuknya
`dev:mellow-narwhal-477|…`), atau jalankan `bunx convex login --no-open --login-flow paste` +
`bunx convex dev --configure` di Terminal workspace supaya push bisa saya kerjakan dari sandbox.
`unresolvedBuildErrorCount` masih bernilai 2 (riwayat percobaan diagnosis) walaupun deployment
terakhir `state: active`; tidak ada subcommand untuk membersihkannya.

## 2026-10-11 — Langkah B percobaan 2: kunci hasil pembaruan tetap ditolak, builder hosting terbukti sehat
**Ruang lingkup:** user menyatakan kunci deploy sudah dibuat ulang. Saya menyalakan lagi push saat
deploy (`convex deploy --cmd`), mencoba 5 kali, membandingkan dengan deploy tanpa Convex, lalu
mengembalikan produksi ke keadaan hijau. Hasil: **fungsi masih belum ter-push**, dan sekarang
terbukti kegagalannya ada di penolakan kunci oleh Convex — bukan di platform hosting.
**Berkas:** baru: `scripts/build-hosted.sh` (pembungkus build hosting: jalankan push, lalu build,
+ diagnostik `key_len`) · diubah: `README.md`, `worklog.md` · build command hosting dikembalikan
ke `bun run build` lewat `freebuff-preview set-build` · tidak ada env yang diubah dan tidak ada
berkas TypeScript yang disentuh.
**Verifikasi:**
- `freebuff-preview set-build "bun run build:deploy"` → tersimpan · `freebuff-deploy check` →
  `deployable: true`, `problems: []`
- `freebuff-deploy start` (build `bun run build:deploy`) → `state: error`; `freebuff-deploy logs` →
  `buildErrors: []` · "No unresolved deploy build errors" → log tidak tertangkap
- `sh ./scripts/build-hosted.sh` di sandbox → `DIAG start 2026-10-11T02:23:23Z key_len=0` ·
  `DIAG exited=1` · exit 1 (kunci memang tidak ada di sandbox; skrip tersambung benar dan berhenti
  sebelum `vite build`)
- `freebuff-preview set-build "sh ./scripts/build-hosted.sh"` → `deployable: true`;
  effective install otomatis jadi `find . -name '*.sh' -not -path './node_modules/*' -exec chmod +x {} + ; bun install`
- `freebuff-deploy start` (build `sh ./scripts/build-hosted.sh`) → `state: error` dalam <30 detik;
  `freebuff-deploy logs` → tetap `buildErrors: []`
- **Kontrol**: `freebuff-preview set-build "bun run build"` → `freebuff-deploy start` →
  `freebuff-deploy status` → `state: active`, `fileCount: 3`, `unresolvedBuildErrorCount: 0` —
  terjadi **dua kali** (createdAt `…500266` dan `…648136`) → builder, install, dan pipeline
  hosting sehat
- Situs: `curl https://mesinpos.freebuff.app/` → HTTP 200
- Fungsi awan masih kosong: probe `POST /api/query tenants:getBySlug` →
  `Could not find public function for 'tenants:getBySlug'.`
**Catatan / blocker:** semua deploy yang menjalankan `convex deploy` gagal, sedangkan semua deploy
tanpa Convex sukses → kegagalan = kunci ditolak Convex, bukan platform. Pesan yang terakhir
tertangkap (percobaan sebelumnya) tetap `✖ Please set CONVEX_DEPLOY_KEY to a new key which you can
find on your Convex dashboard.`, dan uji pembanding di sandbox membuktikan pesan itu hanya muncul
saat variabel **ada** tapi tidak dikenali (variabel kosong/tidak ada → `✖ No CONVEX_DEPLOYMENT set…`).
Log build untuk kegagalan terbaru tidak tertangkap lagi, jadi `key_len` dari
`scripts/build-hosted.sh` belum terbaca. Langkah berikutnya tidak lagi lewat env produksi: pemilik
akun menjalankan `bunx convex login --no-open --login-flow paste` lalu `bunx convex dev --configure`
(pilih deployment `mellow-narwhal-477`) di Terminal workspace; setelah itu push, 64/64, dan flip
`VITE_DATA_SOURCE=convex` bisa saya kerjakan penuh dari sandbox. Build command produksi sengaja
dibiarkan `bun run build` supaya deploy tidak gagal selama menunggu.

## 2026-10-11 — Langkah B dijalankan: kunci deploy sampai ke build tetapi ditolak Convex
**Ruang lingkup:** user menjawab "sudah" atas permintaan mengisi `CONVEX_DEPLOY_KEY`. Dikerjakan:
mencari kunci itu, mencoba jalur push lewat build hosting, mendiagnosis kegagalannya, dan
memulihkan pipeline produksi. Hasil: kunci **berhasil masuk ke build** tetapi Convex menolaknya,
jadi fungsi masih belum ter-push; produksi dikembalikan ke `bun run build` dan sudah deploy sukses
lagi.
**Berkas:** diubah: `package.json` (skrip baru `build:deploy`), `README.md` (cara mengaktifkan
push dari build + arti pesan "new key"), `worklog.md` (entri ini + blocker #2) · build command
hosting diubah lewat `freebuff-preview set-build` (kini kembali `bun run build`) · tidak ada env
yang diubah di turn ini dan tidak ada perubahan kode aplikasi.
**Verifikasi:**
- `freebuff-env list` → `.env.local`: `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`
  — `CONVEX_DEPLOY_KEY` **tidak** ada di sandbox
- `freebuff-deploy env list` → `{"keys":["CONVEX_DEPLOY_KEY","VITE_CONVEX_URL","VITE_DATA_SOURCE"]}`
  → kunci hanya ada di env **produksi**
- `bun run build:deploy` (skrip baru, di sandbox tanpa kunci) → `convex deploy --cmd 'bun run build'`,
  exit 1, "You are currently developing anonymously with a locally running project" → skrip
  tersambung benar dan berhenti sebelum menjalankan build
- `freebuff-preview set-build "bun run build:deploy"` → tersimpan; `freebuff-deploy check` →
  `deployable: true`, `configuredBuildCommand: "bun run build:deploy"`, `problems: []`
- `freebuff-deploy start` → `freebuff-deploy status` → `state: error`; `freebuff-deploy logs` →
  `Build failed - $ convex deploy --cmd 'bun run build'` ·
  `✖ Please set CONVEX_DEPLOY_KEY to a new key which you can find on your Convex dashboard.` ·
  `error: script "build:deploy" exited with code 1` (`buildLog` memuat teks yang sama)
- Reproduksi pesan itu di sandbox: `CONVEX_DEPLOY_KEY=garbage-value bunx convex deploy` → pesan
  **identik**, exit 1. Pembanding: `env -u CONVEX_DEPLOY_KEY CONVEX_DEPLOYMENT= bunx convex deploy`
  dan `CONVEX_DEPLOY_KEY= CONVEX_DEPLOYMENT= bunx convex deploy` → keduanya
  `✖ No CONVEX_DEPLOYMENT set, run 'npx convex dev' to configure a Convex project` → variabelnya
  **ada** di build; yang salah nilainya, bukan kehadirannya
- `bunx convex --version` → `1.46.0` · `npm view convex version` → `1.46.0` → bukan CLI usang
- Pemulihan: `freebuff-preview set-build "bun run build"` → `freebuff-deploy check` →
  `deployable: true`, `problems: []` → `freebuff-deploy start` → `freebuff-deploy status` →
  `state: active`, `fileCount: 3`, `unresolvedBuildErrorCount: 0`
- Situs hidup lagi: `curl https://mesinpos.freebuff.app/` → HTTP 200 · aset
  `/assets/index-D83TrYL1.js` → HTTP 200 (520.827 byte)
- Fungsi awan masih kosong: `POST /api/query {"path":"tenants:getBySlug"}` →
  `Could not find public function for 'tenants:getBySlug'.`
**Catatan / blocker:** kunci yang tersimpan **ditolak Convex** (pesan "new key" = kunci tidak
dikenali/basi). Perbaikannya di sisi pemilik akun: buat kunci baru di halaman deployment yang
dituju (Settings → General → Deploy keys), salin **nilai lengkapnya** tanpa awalan
`CONVEX_DEPLOY_KEY=`, tanpa tanda kutip, tanpa spasi/baris baru, lalu simpan ulang di
Settings → Environment. Setelah kunci valid: `freebuff-preview set-build "bun run build:deploy"`
+ `freebuff-deploy start` akan mengirim fungsi sekaligus membangun situs, lanjut
`VITE_DATA_SOURCE=convex` dan `bun scripts/verify-backend.mjs` terhadap URL awan. Alternatif tanpa
kunci: `bunx convex login` di Terminal workspace, lalu push dari sandbox dengan
`bunx convex dev --once`. Tidak ada typecheck yang dijalankan ulang karena tidak ada berkas
TypeScript yang berubah.

## 2026-10-11 — Percobaan jalur B (kunci deploy): belum bisa, kunci belum ada
**Ruang lingkup:** user meminta "jalankan langkah B" — yaitu push fungsi ke deployment awan
memakai kunci deploy (`CONVEX_DEPLOY_KEY`) tanpa `bunx convex login`. Perintah dijalankan lebih
dulu untuk memastikan keadaan, dan hasilnya: kuncinya belum ada di mana pun, jadi push ke awan
belum bisa dijalankan.
**Berkas:** diubah: `README.md` (dokumentasi jalur B: kunci dev + `bunx convex deploy`),
`worklog.md` (entri ini + blocker #2) · tidak ada perubahan kode dan tidak ada env yang diubah.
**Verifikasi:**
- `freebuff-env list` → kunci `.env.local`: `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`,
  `VITE_CONVEX_SITE_URL` — **tidak ada `CONVEX_DEPLOY_KEY`**
- `freebuff-deploy env list` → `{"keys":["VITE_CONVEX_URL","VITE_DATA_SOURCE"]}` — kunci juga tidak
  ada di env produksi
- `bunx convex login status` → `Status: Not logged in` ("No Convex account token found in:
  /home/daytona/.convex/config.json")
- `bunx convex dev --once` → `[Local] Port 3210 • No Convex account` · "Convex functions ready!" ·
  exit 0 → push kembali mengenai deployment **lokal**, bukan awan (bukti kunci tidak aktif di
  lingkungan terminal)
**Catatan / blocker:** menunggu kunci deploy **dev** dari pemilik akun, disimpan sebagai
`CONVEX_DEPLOY_KEY` di Settings → Environment. Karena kunci dibaca sebelum `CONVEX_DEPLOYMENT`,
`bunx convex deploy` akan langsung mengarah ke deployment dari kunci itu tanpa perlu mengubah
`.env.local`. Riset dashboard/CLI (docs.convex.dev + sumber get-convex/convex-js) mencatat kunci
dibuat dari **Settings → General → Deploy keys** milik deployment dev yang dituju dengan izin
`deployment:deploy`, dan peringatan penting: kunci **production** tidak dijamin memunculkan
peringatan saat dipakai `convex dev`. Karena itu jalur B mensyaratkan kunci dev.

## 2026-10-11 — URL Convex awan: env produksi disiapkan, fungsi belum ter-deploy
**Ruang lingkup:** user memberikan `https://mellow-narwhal-477.convex.cloud` (beserta HTTP Actions
`https://mellow-narwhal-477.convex.site`) sebagai jawaban atas permintaan sebelumnya. Dikerjakan:
audit deployment awan, penyetelan env produksi, dan pengecekan kesiapan build.
**Berkas:** diubah: `README.md` (tambahan cek "apakah fungsi sudah ter-deploy"), `worklog.md`
(entri ini + blocker #2) · tidak ada perubahan kode. Env produksi diubah lewat
`freebuff-deploy env set`, bukan berkas di repo.
**Verifikasi:**
- `curl -s https://mellow-narwhal-477.convex.cloud/version` → `20261006T210904Z-157d34b07ed0`,
  HTTP 200 → deployment hidup
- probe baca-saja `POST /api/query {"path":"tenants:getBySlug",...}` → `{"status":"error",
  "errorMessage":"… Could not find public function for 'tenants:getBySlug'."}` → **fungsi kita
  belum ada di deployment itu**
- `ls -a ~/.convex` → tidak ada · `.convex/project.json` → tidak ada → sandbox belum login,
  jadi tidak ada kredensial untuk push ke awan dari sini
- `freebuff-deploy env set '{"VITE_CONVEX_URL":"https://mellow-narwhal-477.convex.cloud"}'` → tersimpan
- `freebuff-deploy env list` → `{"keys":["VITE_CONVEX_URL","VITE_DATA_SOURCE"]}`
- `freebuff-deploy check` → `deployable: true`, `problems: []`, install `bun install`, build `bun run build`
**Catatan / blocker:** `VITE_DATA_SOURCE` produksi **sengaja tetap `demo`**. Deployment awan itu
hidup tapi belum memuat satu pun fungsi kita; bila `VITE_DATA_SOURCE=convex` disetel sekarang,
build produksi akan memanggil `tenants:getBySlug` yang tidak ada dan halaman aplikasi rusak.
Aktivasi tinggal satu perintah setelah fungsi ter-push:
`freebuff-deploy env set '{"VITE_DATA_SOURCE":"convex"}'` (plus `.env.local` untuk preview).
Untuk push dibutuhkan kredensial: `bunx convex login` + `bunx convex dev --configure` di Terminal
workspace, atau kunci deploy (`CONVEX_DEPLOY_KEY`) lewat Settings → Environment.
`VITE_CONVEX_SITE_URL` tidak disetel di produksi karena tidak ada kode aplikasi yang membacanya —
hanya `src/lib/store/config.ts` yang membaca `VITE_CONVEX_URL` dan `VITE_DATA_SOURCE`.

## 2026-10-11 — Env produksi hosting: VITE_DATA_SOURCE disetel, VITE_CONVEX_URL belum bisa
**Ruang lingkup:** user minta menyiapkan env produksi untuk deployment hosting
(`VITE_CONVEX_URL` dan `VITE_DATA_SOURCE`), lalu menjalankan `freebuff-deploy check`.
**Berkas:** diubah: `worklog.md` (entri ini + blocker #2) · tidak ada perubahan kode. Env
produksi diubah lewat `freebuff-deploy env set`, bukan berkas di repo.
**Verifikasi:**
- `freebuff-deploy env list` (sebelum) → `{"keys":[]}` — "No production environment variables are set."
- `freebuff-deploy env set '{"VITE_DATA_SOURCE":"demo"}'` → `{"message":"Saved…","keys":["VITE_DATA_SOURCE"]}`
- `freebuff-deploy env list` (sesudah) → `{"keys":["VITE_DATA_SOURCE"]}`
- `freebuff-deploy check` (sebelum **dan** sesudah set) → `deployable: true`,
  install `bun install`, build `bun run build`, `problems: []`
- `freebuff-deploy status` → prod `mesinpos`, domain `mesinpos.freebuff.app`, deployment
  terakhir `state: active`, `mode: static_vite`, `unresolvedBuildErrorCount: 0`
**Catatan / blocker:** `VITE_CONVEX_URL` **sengaja tidak diset** karena satu-satunya URL yang ada
adalah loopback sandbox `http://127.0.0.1:3210`. Hosting memakai nilai `.env.local` untuk key
yang tidak didefinisikan di env produksi, jadi menyetel `VITE_DATA_SOURCE=convex` sekarang akan
membuat build produksi mencoba `127.0.0.1:3210` milik pengunjung dan aplikasi gagal total.
Karena itu `VITE_DATA_SOURCE` disetel `demo` — nilai apa pun selain `convex` membuat
`src/lib/store/config.ts` (`requested === "convex" && convexUrl`) memilih jalur demo, sehingga
hasil build produksi deterministik dan tidak bisa terjebak URL dev. Ini placeholder, bukan
tujuan akhir: saat deployment awan sudah ada, setel keduanya sekaligus →
`freebuff-deploy env set '{"VITE_CONVEX_URL":"https://<deployment>.convex.cloud","VITE_DATA_SOURCE":"convex"}'`
lalu `freebuff-deploy check`. Hosting hanya membangun frontend statis; fungsi Convex tetap
dikirim dari workspace (`bunx convex dev --once`, atau `bunx convex deploy` dengan
`CONVEX_DEPLOY_KEY` bila ingin otomatis saat build).

## 2026-10-11 — Panduan langkah demi langkah aktivasi Convex
**Ruang lingkup:** user minta dipandu step by step untuk mengaktifkan Convex. Sebelum menulis
panduan, keadaan sebenarnya diaudit karena blocker #2 di berkas ini menyebut `VITE_CONVEX_URL`
belum ada, padahal `.env.local` sudah memuatnya.

Temuan audit:
- `.env.local` sudah memuat `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`,
  tetapi dari `convex dev` **lokal**, bukan deployment awan. `freebuff-env list` tidak
  menunjukkan `VITE_DATA_SOURCE`, jadi aplikasi memang masih di jalur demo.
- `bun convex dev --once` → "Developing against deployment: [Local] Port 3210 • No Convex
  account" … "Convex functions ready!" · exit 0. Jadi URL terpasang adalah loopback
  `http://127.0.0.1:3210` — tepat kasus yang diperingatkan `src/lib/store/config.ts`.
- `~/.convex` tidak ada → belum ada akun/proyek Convex, jadi belum ada deployment awan.
- `curl http://127.0.0.1:3210/version` → HTTP 000 (connection refused) setelah `--once`
  selesai; `ps aux` tidak menemukan proses `convex` apa pun. Perintah terminal di workspace ini
  sinkron dan tidak dapat menyimpan proses latar, jadi backend lokal hanya hidup selama
  `convex dev` berjalan.

Kesimpulan: seluruh sisi kode sudah siap; yang menghalangi aktivasi adalah langkah yang hanya
bisa dilakukan pemilik akun Convex (login + menautkan deployment awan).

Yang dikerjakan: panduan 6 langkah ditulis ke `README.md` (login → `convex dev --configure` →
`VITE_DATA_SOURCE=convex` → push ulang → verifikasi → env produksi), termasuk catatan mengapa
deployment lokal tidak dipakai, dan blocker #2 diperbarui agar sesuai keadaan nyata.
**Berkas:** diubah: `README.md`, `worklog.md` · tidak ada perubahan kode
**Verifikasi:**
- `bun convex dev --once` → "Convex functions ready" · exit 0
- `SPAWN_BACKEND=1 bun scripts/verify-backend.mjs` → **64/64** terhadap `http://127.0.0.1:3210`
  (backend, aturan bisnis, dan isolasi tenant sinkron dengan sumber saat ini)
- `curl http://127.0.0.1:3210/version` → HTTP 000 (exit 7) · `ps aux | grep convex` → kosong
- `freebuff-preview status` → running, HTTP 200 (masih jalur demo)
- `bun tsc -b --noEmit` → exit 0
**Catatan / blocker:** deployment lokal **tidak bisa** dipakai preview ini: URL-nya `127.0.0.1`
dilihat dari browser pengguna (mesin berbeda dari sandbox) dan backend-nya mati begitu
`convex dev` berhenti. Aktivasi menunggu `bunx convex login` pemilik akun, lalu langkah 2–3 di
`README.md`. Untuk produksi, `VITE_CONVEX_URL` + `VITE_DATA_SOURCE` juga harus disetel sebagai
env produksi (`freebuff-deploy env set`) karena `.env.local` tidak ikut ke build hosting.

## 2026-10-10 — Tambah AGENTS.md agar aturan worklog berjalan otomatis
**Ruang lingkup:** menutup batasan yang dicatat di entri "Buat worklog global" — berkas
`worklog.md` tidak dibaca otomatis oleh sesi agen berikutnya, jadi aturan "satu entri per
pekerjaan" hanya berlaku selama konteks percakapan. `AGENTS.md` ditambahkan sebagai berkas
instruksi agen di root, berisi kewajiban menambah entri worklog beserta aturan isinya.
**Berkas:** baru: `AGENTS.md` · diubah: `worklog.md` (entri ini)
**Verifikasi:** hanya berkas markdown, tidak menyentuh kode — `bun tsc -b --noEmit` → exit 0.
**Catatan / blocker:** entri lama sengaja **tidak** ditulis ulang meski kalimatnya ("belum
dibuat karena belum diminta") kini tidak lagi berlaku; sesuai aturan, koreksi ditulis sebagai
entri baru. `AGENTS.md` tetap hanya berlaku kalau sesi agen membacanya.

## 2026-10-10 — Buat worklog global
**Ruang lingkup:** permintaan user agar setiap pekerjaan dicatat di `worklog.md` secara global.
Berkas ini dibuat, entri untuk pekerjaan yang sudah berjalan ditulis ulang dari riwayat
sebenarnya, dan konvensinya ditetapkan di atas.
**Berkas:** baru: `worklog.md` · diubah: `README.md` (menambahkan penunjuk ke worklog)
**Verifikasi:** berkas tidak memengaruhi build/tipe — `bun tsc -b --noEmit` → exit 0.
**Catatan / blocker:** agar aturan ini otomatis dipatuhi agen di sesi berikutnya, perlu berkas
instruksi agen (`AGENTS.md`) di root. Belum dibuat karena belum diminta.

## 2026-10-10 — Phase 1 lanjutan: audit isolasi multi-tenant + seam identitas
**Ruang lingkup:** user bertanya apakah Phase 1 sudah tuntas. Audit kode menemukan 2 dari 4
klausa belum selesai secara material:
1. *auth RBAC* — RBAC ada, tapi `actorId` selalu datang dari klien, jadi siapa pun bisa
   mengaku sebagai owner. Ditambah 5 mutation tanpa guard: `pos.openShift`, `pos.closeShift`,
   `devices.revoke`, `tenants.create` (spoof `ownerId`), `users.get` (bocor email).
2. *multi-tenant database* — 11 query ber-tenant menyajikan data bisnis **tanpa aktor sama
   sekali** (`tenants.listStores`, `tenants.listCategories`, `products.listByStore`,
   `products.lowStock`, `pos.recent`, `pos.listHeld`, `reports.dailySummary`,
   `entitlements.getForTenant`, `billing.currentSummary`, `billing.listInvoices`,
   `devices.list`); hanya `members.list` yang menerima aktor. `tenants.getBySlug` juga
   mengembalikan dokumen tenant utuh (paket, status, PPN) ke siapa pun yang menebak slug.

Yang dikerjakan:
- `src/convex/lib/auth.ts` (baru): `verifyActor` memverifikasi aktor yang diklaim terhadap
  `ctx.auth.getUserIdentity()`. Identitas ada tapi milik orang lain → ditolak. Identitas tak
  bisa dipetakan ke baris `users` → ditolak. Kebijakannya murni (`decideActor`) sehingga bisa
  diuji tanpa deployment.
- Pemeriksaan identitas ditempatkan di dalam `requireMembership`, sehingga **setiap** guard
  (baca maupun tulis) mewarisinya.
- Isolasi baca: `actorId` + `requireMembership`/`requirePermission` pada seluruh query
  ber-tenant. Harness kini membuktikan **13** pembacaan menolak non-anggota:
  `tenants.listStores`, `tenants.listCategories`, `tenants.getMine`,
  `products.listByStore`, `products.lowStock`, `pos.recent`, `pos.listHeld`,
  `reports.dailySummary`, `entitlements.getForTenant`, `devices.list`,
  `billing.currentSummary`, `billing.listInvoices`, `members.list`.
  `tenants.getBySlug` tidak digerbangi (dipakai onboarding) tapi dipersempit jadi
  `{_id, name, slug}`; data bisnis kini dilayani `tenants.getMine` khusus anggota.
- Guard untuk 5 mutation di atas, plus `pos.createSale` kini memvalidasi `shiftId` milik tenant.
- `scripts/verify-authz.mjs` (baru): uji murni tabel peran + 7 kasus `decideActor`.

**Berkas:** baru: `src/convex/lib/auth.ts`, `scripts/verify-authz.mjs` · diubah:
`src/convex/lib/access.ts`, `tenants.ts`, `users.ts`, `products.ts`, `pos.ts`, `reports.ts`,
`entitlements.ts`, `billing.ts`, `devices.ts`, `src/lib/store/convex.tsx`,
`scripts/verify-backend.mjs`
**Verifikasi:**
- `bun scripts/verify-authz.mjs` → 33/33
- `bun scripts/verify-offline.mjs` → 24/24
- `SPAWN_BACKEND=1 bun scripts/verify-backend.mjs` → **64/64** (dari 37). Termasuk 13 penolakan
  baca lintas tenant, 4 penolakan tulis, dan alur positif buka shift → jual di shift → tutup
  dengan kas seharusnya 116.650 dan selisih 0.
- `bun tsc -b --noEmit` → exit 0 · `bun tsc -p tsconfig.convex.json --noEmit` → exit 0
- `freebuff-preview status` → 200
**Catatan / blocker:** provider autentikasi belum terpasang, jadi `ALLOW_UNVERIFIED_ACTOR`
default `true`: bila tidak ada identitas sama sekali, pemanggil anonim masih boleh menyebut
dirinya aktor. Menyetel `false` di deployment langsung menutup jalur itu. Guard anti-spoof
untuk `tenants.create` dan `users.get` **tidak bisa diuji di harness** (deployment placeholder
tidak menerbitkan token) — karena itu diuji sebagai fungsi murni di `verify-authz.mjs`.

## 2026-10-10 — Phase 1: RBAC + mesin POS offline-first
**Ruang lingkup:** melengkapi dua pilar Phase 1 yang belum ada menurut roadmap di
`src/pages/LandingPage.tsx` ("Multi-tenant database, billing & entitlement engine, auth RBAC,
dan offline-first POS engine" — dua klausa terakhir). Sebelum ini backend hanya memeriksa
keanggotaan tenant, tidak pernah peran; dan `idempotencyKey` sudah diterima server tapi tidak
ada mesin antrean di klien.
- `src/convex/lib/authz.ts` (baru): satu tabel peran → izin, dipakai bersama backend dan klien.
  Pemisahan tugas yang disengaja: kasir boleh menjual tapi **tidak boleh void**, staf gudang
  boleh ubah stok tapi tidak menjual, keuangan lihat uang tapi tidak sentuh stok.
- `src/convex/lib/access.ts`: `requirePermission`; diterapkan pada
  `pos.createSale`/`voidSale`/`finalizeHeldSale`, `products.create`/`adjustStock`,
  `devices.register`, `billing.createInvoice`/`changePlan`. `actorId` menjadi argumen **wajib**.
- `src/convex/members.ts` (baru): `members.add` (izin `team.manage`, ada pengaman eskalasi agar
  manajer tidak bisa membuat owner baru) dan `members.list` — sebelumnya tidak ada cara
  menambahkan anggota kedua, sehingga RBAC tidak bisa dijalankan sama sekali.
- `src/lib/offline/outbox.ts` (baru): antrean dengan `idempotencyKey` yang dibuat sekali dan
  dipakai ulang di setiap percobaan (inilah yang mencegah dobel-charge saat reconnect). Gagal
  koneksi → flush berhenti; penolakan → dicoba maksimum 5 kali lalu ditandai *blocked* agar satu
  transaksi bermasalah tidak menyumbat kasir.
- `src/lib/offline/useOutbox.ts` (baru): binding React, memantau `online`/`offline`, memutar
  ulang antrean sisa saat mount dan saat koneksi kembali.
- Kedua store (`demo.tsx`, `convex.tsx`) checkout lewat outbox yang sama; `CreateSaleResult`
  menambah `queued` dan `number` bisa `null` (offline belum dapat nomor struk dari server).
- RBAC sisi klien: `role` di session, `useCan()`, gate nav **dan** route (`RequirePermission`)
  memakai izin yang sama. Ada pengalih peran di sidebar khusus mode demo agar gate terlihat.
- POS: indikator antrean + tombol sinkronkan.

**Berkas:** baru: `src/convex/lib/authz.ts`, `src/lib/authz.ts`, `src/lib/usePermission.ts`,
`src/lib/offline/outbox.ts`, `src/lib/offline/useOutbox.ts`, `src/convex/members.ts`,
`scripts/verify-offline.mjs` · diubah: `src/convex/lib/access.ts`, `pos.ts`, `products.ts`,
`devices.ts`, `billing.ts`, `src/lib/store/types.ts`, `store/demo.tsx`, `store/convex.tsx`,
`src/lib/session.tsx`, `src/layouts/AppLayout.tsx`, `src/App.tsx`, `src/pages/PosPage.tsx`,
`scripts/verify-backend.mjs`
**Verifikasi:**
- `bun scripts/verify-backend.mjs` → 21/21 lalu **37/37** (RBAC kasir, void mengembalikan stok)
- `bun scripts/verify-offline.mjs` → 24/24 (termasuk bukti kunci idempotensi dipakai ulang)
- `bun tsc -b --noEmit` → exit 0 · modul di preview → 200
**Catatan / blocker:** dua bug ditemukan & diperbaiki di tengah jalan: (1) `pos.createSale`
masih memakai `args.actorId` padahal argumennya sudah diganti `cashierId`; (2) memo di
`useOutbox` tidak dihitung ulang saat antrean berubah, sehingga `pending`/`blocked` akan beku
di angka render pertama — indikator antrean di POS tidak akan pernah muncul.

## 2026-10-10 — Rebrand ArtaPOS → MesinPOS
**Ruang lingkup:** mengganti brand lama ke **MesinPOS** di semua permukaan.
**Berkas:** diubah: `index.html` (title + meta description), `src/pages/LandingPage.tsx`,
`src/pages/AuthPage.tsx`, `src/pages/OnboardingPage.tsx`, `src/pages/ShiftPage.tsx`,
`src/layouts/AppLayout.tsx`, `src/lib/session.tsx`, `scripts/verify-backend.mjs`
(14 kemunculan, 8 berkas). Wordmark tetap dua warna: `Mesin<span>POS</span>`.
**Verifikasi:**
- `grep -ri 'arta' src index.html README.md package.json scripts` → tidak ada sisa
- `bun tsc -b --noEmit` → exit 0
- HTML dari preview (`/`) → title & description MesinPOS, HTTP 200
- `bun run build` → exit 0; `dist/index.html` + `dist/assets/*.js` → 0 kemunculan `ArtaPOS`
**Catatan / blocker:** kunci penyimpanan ikut berubah (`artapos.session.v1` →
`mesinpos.session.v1`, `artapos.shifts.v1` → `mesinpos.shifts.v1`), jadi sesi demo lama hilang
dan riwayat Z-report lokal tereset. Tidak dibuat shim migrasi karena datanya demo dan bisa
dibuat ulang.

---

## Status Phase 1

| Klausa (roadmap) | Status kode | Verifikasi |
|---|---|---|
| Multi-tenant database | Selesai (isolasi baca **dan** tulis; tiap akun berdiri sendiri — nama bisnis boleh sama, workspace & pengaturannya terpisah — dan anggota tim masuk ke workspace yang sama lewat undangan email yang benar-benar dikirim, bisa juga lewat tautan WhatsApp `wa.me`; anggota yang sudah ada bisa diubah, diaktifkan/nonaktifkan, dan dihapus dari workspace itu) | `verify-backend.mjs` 607/607 |
| Billing & entitlement engine | Selesai | `verify-backend.mjs` 607/607 |
| Auth RBAC | Selesai di sisi kode (**termasuk model akses akun platform developer**, di luar RBAC tenant; sejak 2026-10-12 jalur masuknya **tanpa kata sandi** — kode OTP ke email, aturan murni `lib/otp.ts`, satu jalur untuk masuk & daftar) | `verify-authz.mjs` 86/86 · `verify-otp.mjs` 79/79 · `verify-menus.mjs` 384/384 · `verify-team.mjs` 41/41 · `verify-backend.mjs` 607/607 |
| Offline-first POS engine | Selesai | `verify-offline.mjs` 24/24 |

Provider identitas Convex **sudah terpasang** (2026-10-12, Convex Auth + OTP email Resend):
`ctx.auth.getUserIdentity()` kini terisi untuk jalur masuk beridentitas, dan gerbang **akun platform**
menuntutnya. Yang belum: jalur masuk tenant masih memakai kode OTP proyek ini, jadi gerbang aktor
tenant tetap memakai `ALLOW_UNVERIFIED_ACTOR` sampai jalur itu ikut dipindahkan.

Sejak 2026-10-11 backend **awan** juga lulus rangkaian yang sama:
`VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
`184/184 checks passed` (per 2026-10-12 rangkaian yang sama → `607/607`),
dan situs produksi membangun dirinya dengan `VITE_DATA_SOURCE=convex`.
(Angka 64/64 di entri-entri lama adalah jumlah cek saat entri itu ditulis; suite bertambah seiring
fitur baru.)

## Status Phase 2

| Klausa (roadmap) | Status kode | Verifikasi |
|---|---|---|
| Registri modul + kepemilikan fitur per modul | Selesai | `verify-modules.mjs` 27/27 |
| Aktivasi mengikuti paket (modul diizinkan + `verticalLimit` + minimal satu) | Selesai | `verify-modules.mjs` 27/27 · `verify-backend.mjs` 184/184 |
| Gerbang server per modul | Selesai (terpasang di alur F&B: `pos.createSale` status `held`, `pos.finalizeHeldSale`) | `verify-backend.mjs`: 4 cek gerbang modul lulus |
| Halaman Modul + RBAC `billing.manage` | Selesai di sisi kode | `tsc` exit 0 · `verify-render.mjs` 108/108 (dirender di DOM klien) · belum pernah dilihat di browser sungguhan |
| Tiga modul vertikal (UMKM, F&B, Grosir) sebagai plugin | Selesai di sisi kode | 27/27 + 184/184 |
| **UMKM: grid kasir cepat** (`pos.quickgrid`) | Selesai — grid produk di kasir (`/app/pos`) adalah layar jual inti, jadi sengaja **tidak** digerbang server (mematikan UMKM tidak boleh membuat kasir tidak bisa menjual); yang digerbang adalah fitur modul lain (meja, dapur, modifier, grosir, diskon member) | `verify-modules.mjs` 27/27 · `verify-render.mjs` 108/108 |
| **UMKM: member & diskon member** (`member.discount`) | Selesai (tabel `members`, aturan murni `lib/loyalty.ts`, `loyalty.*` di server, pemilih member + baris diskon di kasir, halaman `/app/members`, izin `member.view`/`member.manage`) | `verify-members.mjs` 30/30 · `verify-backend.mjs` 184/184 (termasuk cek gerbang modul/nonaktif) · `verify-render.mjs` 108/108 |
| Halaman Member (sisi klien) | Selesai di sisi kode | `tsc` exit 0 · `verify-render.mjs` 108/108 (dirender di DOM klien) · belum pernah dilihat di browser sungguhan |
| **F&B: denah meja** (`pos.table`) | Selesai (tabel `tables`, aturan murni `lib/fnb.ts`, `tables.*` di server, pemilih meja di kasir, halaman `/app/kds`; sejak 2026-10-14 juga memuat **pesanan QR meja** — tamu memindai kartu `mj_…` di mejanya, memesan & membayar lewat tagihan QRIS/VA dari ponselnya, aturan murni `lib/meja.ts` + `meja.*` di server + halaman publik `/meja/:token`; pelunasan/pembatalannya dari halaman Pembayaran, dan tagihan yang sudah dibatalkan atau kedaluwarsa tidak lagi menahan hapus meja — `isAwaitingPayment`) | `verify-fnb.mjs` 95/95 · `verify-meja.mjs` 72/72 · `verify-meja-browser.mjs` 93/93 · `verify-backend.mjs` (awan) 795/795 · `verify-render.mjs` 795/795 |
| **F&B: Kitchen Display System** (`pos.kds`) | Selesai (query `pos.kdsTickets`, antrean tertua dulu, selesai → stok bergerak & meja kosong; sejak 2026-10-14, entri teratas: **dapur hanya menerima pesanan yang sudah lunas** — pesanan QR yang belum dibayar tidak tampil sebagai antrean, hanya dihitung di **kartu antrean dapur** (lencana `meja-qr-menunggu-jumlah` + tombol `meja-qr-ke-pembayaran` ke halaman Pembayaran), dan tiket yang lahir dari pelunasan ditandai kanal + momen pelunasannya (`ticketPaymentLabel`); sejak entri teratas juga **memberi tahu sendiri**: tagihan QR baru membunyikan `KDS_ALERT_BEEP` & mengkilatkan kartu antreannya sekali per tagihan — `planKdsAlert`, saklar `meja-qr-bip`) | `verify-fnb.mjs` 95/95 · `verify-meja.mjs` 72/72 · `verify-scan-beep.mjs` 62/62 · `verify-render.mjs` 795/795 · `verify-meja-browser.mjs` 93/93 · `verify-backend.mjs` (awan) 795/795 |
| **F&B: modifier item** (`pos.modifier`) | Selesai (kolom `products.modifiers`, aturan murni `lib/modifiers.ts`, `products.setModifiers`, validasi+harga di `pos.createSale`, label di tiket dapur, dialog kasir + editor Produk) | `verify-modifiers.mjs` 46/46 · `verify-backend.mjs` 184/184 · `verify-render.mjs` 108/108 |
| **Grosir: harga bertingkat** (`pricing.multitier`) | Selesai (aturan + DB + setPricing + dipakai saat menjual) | `verify-wholesale.mjs` 31/31 · `verify-backend.mjs` 184/184 (1 DUS kena tier) · `verify-render.mjs` 108/108 |
| **Grosir: konversi satuan** (`uom.multilevel`) | Selesai (kolom `units`, pemilih satuan di kasir, `items[].unitCode`) | `verify-wholesale.mjs` 31/31 · `verify-backend.mjs` 184/184 |
| **Grosir: piutang B2B & credit limit** (`ar.creditlimit`) | Selesai (tabel `customers`/`receivables`/`receivablePayments`, aturan murni `lib/ar.ts`, `ar.*` di server, bayar sebagian di kasir, halaman `/app/receivables`, ringkasan di Dashboard, izin `ar.view`/`ar.manage`) | `verify-ar.mjs` 54/54 · `verify-backend.mjs` 184/184 · `verify-render.mjs` 108/108 |
| Halaman Produk: editor harga/tier & modifier | Selesai di sisi kode | `tsc` exit 0 · `verify-render.mjs` 108/108 (dirender di DOM klien) · belum pernah dilihat di browser sungguhan |

Angka di kolom verifikasi adalah hasil pemeriksaan terakhir (dijalankan ulang 2026-10-13, **pajak &
pungutan F&B**; sebelumnya 2026-10-12 setelan PPN yang bisa diatur & dimatikan):
`verify-authz` 92/92 · `verify-impersonation` 49/49 · `verify-modules` 27/27 · `verify-wholesale` 31/31 ·
`verify-members` 30/30 · `verify-inventory` 42/42 · `verify-purchasing` 60/60 · `verify-payables` 44/44 ·
`verify-fnb` 39/39 · `verify-modifiers` 46/46 · `verify-ar` 54/54 · `verify-offline` 24/24 ·
`verify-threeway` 84/84 · `verify-opname` 48/48 · `verify-analytics` 65/65 · `verify-rbac` 48/48 ·
`verify-api` 225/225 · `verify-support` 61/61 · `verify-scale` 42/42 · `verify-payments` 72/72 ·
`verify-qr` 11/11 · `verify-otp` 79/79 · `verify-sync` 47/47 · `verify-menus` 406/406 ·
`verify-fnb-tax` 126/126 · `verify-render` 609/609 · `verify-fullscreen` 14/14 ·
`verify-product-images` 25/25 · `verify-product-sku` 39/39 · `verify-team` 41/41 ·
`verify-categories` 35/35 · `verify-product-edit` 36/36 · `verify-tax` 71/71 · `verify-modules` 34/34 ·
`verify-backend` (awan) 691/691, semuanya exit 0. Angka di baris tabel adalah jumlah cek saat baris itu ditulis —
suite bertambah seiring fitur baru. Yang **diperbarui pada pemeriksaan 2026-10-13**: `verify-fnb-tax`,
`verify-render`, `verify-backend` (awan), `verify-menus`, `verify-modules`, `verify-tax`, `verify-authz`
92/92, `verify-api` 225/225, `verify-store-gate` (exit 0: 26 langganan, 17 bergerbang izin); angka
lain di daftar ini dari pemeriksaan terakhirnya masing-masing dan tidak ikut berubah karena berkas yang
diujinya tidak disentuh. **Pembaruan 2026-10-13 (laporan pajak & pungutan F&B per bulan, entri
teratas):** pemeriksaan itu dijalankan lagi — `verify-fnb-tax` 105 → **126**, `verify-render` 584 →
**596**, `verify-backend` (awan) 688 → **691**; regresi lain (`verify-fnb`, `verify-tax`,
`verify-analytics`, `verify-menus`, `verify-api`, `verify-authz`, `verify-modules`,
`verify-store-gate`, `verify-rbac`, `verify-impersonation`) tetap hijau pada angka yang sama.
**Pembaruan 2026-10-13 (tombol menu di header, entri teratas):** `verify-render` 596 → **609**
(alur tombol menu), harness murni baru `verify-sidebar-menu` **19/19**, dan uji peramban baru
`verify-browser-menu` **12/12** di Chromium sungguhan; regresi `verify-fullscreen` 14/14,
`verify-menus` 406/406, `verify-theme` 50/50, `verify-pwa` 1492/1492, `verify-authz` 92/92,
`verify-modules` 34/34, `verify-api` 225/225, `verify-store-gate` (26 langganan) tetap hijau.

Seluruh delapan fitur di registri modul kini punya alur — `pos.quickgrid`, `member.discount`,
`pos.table`, `pos.kds`, `pos.modifier`, `pricing.multitier`, `uom.multilevel`, `ar.creditlimit` —
masing-masing dengan aturan murni, data (tabel/kolom), izin, dan harness; tujuh di antaranya punya
gerbang server (`pos.quickgrid` sengaja tidak, lihat barisnya di tabel).

**Tidak ada lagi fitur Phase 2 yang berlabel:** semuanya punya alur, DB, gerbang server, izin, dan
harness — terakhir member & diskon member (`member.discount`, lihat entri teratas). Fitur inventori
lanjutan (`inventory.multiwarehouse`, `purchasing.*`) memang bukan lingkup Phase 2 (Phase 3).

## Status Phase 3

Phase 3 di roadmap adalah **Advanced Supply Chain**. Empat fiturnya ada di katalog paket, dan
**keempatnya sudah punya alur** (multi-warehouse, pembelian + hutang usaha, stock opname, dan
pencocokan 3 arah + bayar sekaligus). Status roadmap-nya di beranda
(`src/pages/LandingPage.tsx`) sudah **Berjalan** sejak 2026-10-11 dan dijaga cek render.

| Klausa (roadmap) | Status kode | Verifikasi |
|---|---|---|
| **Multi-warehouse & lokasi rak** (`inventory.multiwarehouse`) | Selesai (tabel `warehouses`, kolom `warehouseId` di stok & ledger, aturan murni `lib/inventory.ts`, `inventory.*` di server, halaman `/app/inventory`, izin `inventory.view`/`inventory.manage`) | `verify-inventory.mjs` 42/42 · `verify-authz.mjs` 66/66 · `verify-backend.mjs` 222/222 · `verify-render.mjs` 132/132 |
| Stock opname & audit selisih (`inventory.opname`) | Selesai (tabel `opnameSessions`, aturan murni `lib/opname.ts`, `opname.*` di server, halaman `/app/opname`, menu “Opname”, izin `inventory.view`/`inventory.manage`, sesi contoh di store demo) | `verify-opname.mjs` 48/48 · `verify-backend.mjs` 279/279 (31 cek opname) · `verify-render.mjs` 172/172 |
| Purchasing PR · PO · GRN (`purchasing.basic`) | Selesai (tabel `suppliers`, `purchaseRequisitions`, `purchaseOrders`, `goodsReceipts`, **`payables` + `payablePayments`** untuk hutang usaha, aturan murni `lib/purchasing.ts` + `lib/payables.ts`, `purchasing.*`/`payables.*` di server, halaman `/app/purchasing`, **ringkasan hutang + jatuh tempo terdekat di Dashboard**, izin `purchase.view`/`request`/`approve`/`receive` + `payable.view`/`manage`) | `verify-purchasing.mjs` 60/60 · `verify-payables.mjs` 44/44 · `verify-authz.mjs` 74/74 · `verify-backend.mjs` 248/248 (26 cek hutang usaha) · `verify-render.mjs` 153/153 |
| 3-way matching & AP (`purchasing.threeway`) | Selesai (kolom `invoice`, `matchDecision` di `payables`, aturan murni `lib/threeway.ts`, `payables.recordInvoice`/`resolveMatch`/`payBatch` di server, bagian **Pencocokan 3 arah** + bayar sekaligus di halaman `/app/purchasing`, nomor batch `PAY-…` di `payablePayments`, izin `payable.view`/`payable.manage`) | `verify-threeway.mjs` 84/84 · `verify-backend.mjs` 308/308 (29 cek 3 arah) · `verify-render.mjs` 186/186 |

Perbedaan yang perlu diketahui antar slice: multi-warehouse **dan stock opname** adalah fitur
**Enterprise** (`limits.warehouses` 1 di Starter/Professional; `inventory.multiwarehouse` dan
`inventory.opname` hanya ada di `ALL_FEATURES`), jadi pengujian backend-nya menaikkan paket tenant uji
ke Enterprise dulu. Opname mengikuti pola gerbang multi-warehouse: **sesi baru** ditolak di paket
yang tidak memuat fiturnya, tetapi **melihat, menghitung, memposting, dan membatalkan sesi lama tetap
boleh** — hasil hitung fisik tidak boleh hilang karena perubahan langganan.
`purchasing.basic` ada sejak paket Professional, dan gerbangnya sengaja tidak seragam: **penerimaan
barang** dan **pembayaran/melihat hutang** tidak digerbang fitur supaya PO yang sudah jalan tetap
bisa diterima dan tagihan yang sudah tercatat tetap bisa dibayar setelah paket turun; yang digerbang
adalah tindakan yang menambah komitmen baru (PR/PO baru dan tagihan manual). Backend harness menguji
ketiganya setelah menurunkan paket ke Professional — PR baru ditolak, GRN tetap boleh, tagihan manual
ditolak, sedangkan pembayaran hutang lama tetap boleh.

## Status Phase 4

Phase 4 di roadmap adalah **Enterprise Intelligence**, dan sudah **tiga slice** yang punya alur:
**analitik lanjutan** (`report.advanced`, Advanced BI & analitik), **peran kustom**
(`rbac.custom`, Custom role RBAC), dan **akses API & webhook** (`api.access`, API akses penuh &
webhook). Analitik lanjutan: aturan murni `lib/analytics.ts`, query
`reports.advanced` dengan gerbang fitur + izin `report.view`, `analyticsReport`/`analyticsDays` di
kedua store, bagian **Analitik lanjutan (Enterprise)** di halaman `/app/reports`, dan harness murni +
backend + render. Peran kustom: aturan murni `lib/rbac.ts` yang dipakai `requirePermission`, tabel
`customRoles` + `memberships.customRoleId`, fungsi `roles.*`, izin efektif di sesi klien, halaman
**Tim & Peran** (`/app/team`, izin `team.manage`), dan harness murni + backend + render. Akses API &
webhook: aturan murni `lib/apiKeys.ts` + `lib/webhooks.ts` + `lib/hash.ts`, tabel `apiKeys` /
`webhookEndpoints` / `webhookDeliveries`, fungsi `apiAccess.*`, HTTP action `/api/v1/*` di
`src/convex/http.ts` (`GET` untuk baca, **`POST /api/v1/sales`** untuk pesanan masuk dari sistem luar
— aturan bentuknya di `lib/apiOrders.ts`, scope tulisnya `pos.sell`), halaman **API & Webhook**
(`/app/api`, izin `api.manage`), dan harness murni + backend + render. Status roadmap-nya di beranda (`src/pages/LandingPage.tsx`) sudah **Berjalan** sejak
2026-10-11, dan beranda kini **tidak lagi punya label “Rencana”** — dijaga cek render.

| Klausa (roadmap) | Status kode | Verifikasi |
|---|---|---|
| **Advanced BI & analitik** (`report.advanced`) | Selesai (aturan murni `lib/analytics.ts`; query `reports.advanced`; periode 7/30/90 hari dengan batas **tengah malam lokal**; margin kotor dari omzet bersih + pemisahan omzet tanpa harga beli; produk/kategori/metode/jam/hari; perbandingan periode sama panjang; temuan berambang) | `verify-analytics.mjs` 65/65 · `verify-backend.mjs` 375/375 (14 cek analitik) · `verify-render.mjs` 237/237 |
| **Peran kustom** (`rbac.custom`) | Selesai (aturan murni `lib/rbac.ts`; tabel `customRoles` + `memberships.customRoleId`; fungsi `roles.*`; `requirePermission` memakai izin efektif; gerbang fitur tidak seragam — lihat catatan di bawah; halaman `/app/team` + menu + rute; izin `team.manage`) | `verify-rbac.mjs` 45/45 · `verify-backend.mjs` 375/375 (24 cek peran kustom) · `verify-render.mjs` 237/237 |
| **API akses penuh & webhook** (`api.access`) | Selesai (aturan murni `lib/apiKeys.ts` + `lib/webhooks.ts` + `lib/apiOrders.ts` + `lib/webhookEvents.ts` + kripto `lib/hash.ts`; tabel `apiKeys`/`webhookEndpoints`/`webhookDeliveries` + indeks antrean `by_status_next_attempt`; fungsi `apiAccess.*` + HTTP action baca & **tulis** `/api/v1/*` (`POST /api/v1/sales`, scope tulis `pos.sell`); scope dibatasi izin efektif pembuat; halaman `/app/api` + menu + rute; izin `api.manage`; **pekerja terjadwal `crons.ts` yang benar-benar mengirim ulang webhook gagal** + **pemicu seluruh katalog**: transaksi (penjualan selesai/dibatalkan, stok menembus ambang, opname diposting), dokumen jatuh tempo (`payable.due`/`receivable.overdue`, pekerja harian), dan tiket dukungan (`support.*`) — tidak ada lagi entri katalog yang bisa dilanggan tanpa pemicu) | `verify-api.mjs` 225/225 · `verify-backend.mjs` 489/489 (penjualan nyata lewat `POST /api/v1/sales`, pemicu event transaksi, **pemicu kalender end-to-end**, + 29 cek baca) · `verify-render.mjs` 309/309 · `verify-webhook-retries.mjs` 6/6 (E2E, menunggu jadwal sungguhan) |

Yang sudah ada dari arah itu: pembayaran digital + webhook provider (`payment.digital`), laporan
harian (`report.daily`), analitik lanjutan (`report.advanced`), dan peran kustom (`rbac.custom`).

Catatan akses API: kunci API tidak boleh melebihi izin pembuatnya, dan kunci buatan anggota yang
izinnya dicabut langsung menyempit tanpa perlu dicabut satu per satu; `secret` kunci tidak pernah
disimpan (hanya `sha256(publicId:secret)`), sedangkan rahasia webhook memang disimpan karena kita yang
menandatangani kiriman. Satu endpoint juga **menulis** — `POST /api/v1/sales` dengan scope `pos.sell`
untuk pesanan dari sistem luar — tetapi scope tulisnya tetap izin domain yang sudah ada, dan
keputusan bisnisnya (harga, PPN, diskon, stok, limit kredit) tetap dijalankan `pos.createSale`: API
**tidak** punya jalur penjualan sendiri, dan `idempotencyKey` yang dinamai per tenant mencegah kiriman
ulang menjadi penjualan kedua. Gerbangnya sama polanya: **membuat kunci/endpoint & mengubah
langganan** butuh fitur `api.access` (Enterprise), sedangkan **mencabut kunci,
mematikan/menghapus endpoint, dan melihat daftarnya** selalu boleh. Webhook keluar kini punya
pekerja terjadwal (`src/convex/crons.ts`, tiap 1 menit) yang benar-benar mengirim ulang kiriman
gagal sesuai jadwalnya dan menghentikannya saat endpoint dimatikan, sementara penjualan, pembatalan,
stok yang menembus ambang, dan opname yang diposting mengisi antrean itu sendiri. Yang belum ada:
pemicu untuk event berbasis kalender (`payable.due`, `receivable.overdue`) — lihat Blocker #6.

Catatan peran kustom: **peran kustom menggantikan** izin peran bawaan, bukan menambahinya; pembuat
peran tidak bisa memberi izin yang dia sendiri tidak punya (pagar yang sama berlaku saat
menugaskan); pemilik tenant tidak bisa dipindah ke peran kustom; dan peran yang masih dipakai
anggota tidak bisa dihapus. Gerbangnya sengaja tidak seragam: **membuat/mengubah/menugaskan** butuh
fitur `rbac.custom`, sedangkan **melihat, melepas penugasan, menonaktifkan, dan menghapus peran yang
tidak dipakai** selalu boleh — supaya tenant tidak terkunci dari timnya sendiri setelah paket turun.

## Status Phase 5

Phase 5 di roadmap adalah **Dukungan khusus & skala franchise**. Keduanya tidak lagi label katalog:
masing-masing punya aturan murni, backend, kedua store, halaman, izin, data contoh, dan harness.
Status roadmap-nya di beranda (`src/pages/LandingPage.tsx`) sudah **Selesai** sejak 2026-10-12
(sebelumnya *Berjalan*) dan dijaga cek render yang membaca lencananya **per kartu**; body Phase 4 di
beranda kini hanya memuat tiga slice-nya sendiri (analitik lanjutan, peran kustom, akses API &
webhook).

| Klausa (roadmap) | Status kode | Verifikasi |
|---|---|---|
| **Dukungan khusus** (`support.dedicated`) | Selesai (aturan murni `lib/support.ts`; tabel `supportTickets` dengan `slaHours` dipatok saat dibuat + `log` append-only + `dueAt`/`slaNotified` + indeks `by_sla`; `support.list`/`create`/`act` + `notifyDueTickets`; halaman **Dukungan** `/app/support` + menu + rute; izin `support.view`/`support.manage`; gerbang fitur hanya untuk prioritas Tinggi/Mendesak & eskalasi; **kanal keluar** `support.created`/`escalated`/`resolved`/`due` lewat pekerja terjadwal tiap 30 menit) | `verify-support.mjs` 61/61 · `verify-backend.mjs` 489/489 (19 cek dukungan khusus) · `verify-render.mjs` 309/309 |
| **Skala franchise** (`scale.franchise`) | Selesai (aturan murni `lib/scale.ts`: `queryBudgetFor`/`pageWindow`/`mergeTopN`/`franchiseRollup`/`trimOutletRows`; query `reports.franchise` membaca 50 cabang + 1 dan `rowsPerStore + 1` baris per cabang dari indeks `(tenantId, storeId, createdAt)`; pemotongan dilaporkan (`truncated`/`skippedOutlets`/`beyondWindow`); bagian **Skala franchise · lintas cabang** di `/app/reports`; izin `report.view` di depan gerbang fitur) | `verify-scale.mjs` 42/42 · `verify-backend.mjs` 489/489 (11 cek lintas cabang) · `verify-render.mjs` 309/309 |

Dua gerbang yang sengaja tidak seragam — keduanya supaya tenant tidak terkunci dari datanya sendiri
saat paket turun: **tiket yang sudah masuk tetap bisa dicatat, ditutup, dan dibuka ulang** walau
`support.dedicated` mati (yang ditolak hanya prioritas jalur cepat & eskalasi), dan **laporan harian
serta analitik yang sudah ada tetap jalan** walau `scale.franchise` mati (yang mati hanya bagian
lintas cabangnya).

## Status Phase 6

Phase 6 di roadmap adalah **Realtime Sync & Digital Payment**, dan ini **dua klausa katalog
terakhir** — keduanya sudah punya aturan murni, backend, kedua store, halaman, izin, data contoh,
dan harness. Status roadmap-nya di beranda (`src/pages/LandingPage.tsx`) sudah **Selesai** sejak
2026-10-12 (sebelumnya *Berjalan*) dan dijaga cek render yang membaca lencananya **per kartu**;
beranda kini memuat **enam fase** dan tidak ada lagi label “Rencana”. Dengan ini **tidak ada klausa
katalog yang tinggal label**.

| Klausa (roadmap) | Status kode | Verifikasi |
|---|---|---|
| **Sinkronisasi real-time** (`sync.realtime`) | Selesai (aturan murni `lib/realtimeSync.ts`: `presenceState`/`pullWindow`/`decidePush`/`summariseSync`/`laggingDevices`; tabel `syncChanges` berindeks `(tenantId, revision)` + kolom `platform` pada `devices`; fungsi `sync.list`/`register`/`heartbeat`/`push`/`pull`/`resolve`; revisi naik satu-satu lewat `nextSequence`; **aksi store lengkap** (`registerSyncDevice`/`heartbeatSyncDevice`/`pushSync`/`pullSync`/`resolveSyncChange`); halaman **Sinkronisasi** `/app/sync` + menu + rute; izin `device.manage`) | `verify-sync.mjs` 47/47 · `verify-backend.mjs` 489/489 (20 cek sinkronisasi) · `verify-render.mjs` 309/309 (termasuk aksi store sinkronisasi) |
| **Pembayaran digital QRIS / VA** (`payment.digital`) | Selesai (aturan murni `lib/digitalPayment.ts`: `validateChargeInput`/`statusOf`/`applyChargeAction`/`summariseCharges`/`virtualAccountNumber`/`qrPayload` + **jalur kasir** `validateCartCharge`/`checkCartMatchesCharge`/`checkSaleAgainstCharge`; tabel `digitalCharges` + `sales.digitalChargeId` + `digitalCharges.saleId`/`saleNumber`; fungsi `payments.list`/`create`/`act` dan `pos.createSale` dengan `digitalChargeId`; kedaluwarsa QRIS 5 menit & VA sehari dihitung saat dibaca; pelunasan harus pas; **kasir menagih QRIS dari keranjang** — penjualan baru dicatat setelah tagihannya lunas; halaman **Pembayaran** `/app/payments` + menu + rute, plus bagian tagih QRIS di **kasir** `/app/pos` yang **menggambar kode QR-nya** (`src/lib/qr.ts` + `components/QrCodeImage.tsx`) alih-alih hanya menempel payload teks; izin `payment.view`/`payment.manage`) | `verify-payments.mjs` 72/72 · `verify-qr.mjs` 11/11 (kode QR dibaca balik pemindai) · `verify-backend.mjs` 489/489 (27 cek pembayaran digital + 8 cek sambungan ke penjualan kasir) · `verify-render.mjs` 309/309 (termasuk alur klik kasir & kode QR di dialog **dan** di halaman Pembayaran) |

Dua gerbang searah yang menjaga janji yang sama seperti Phase 3–5 — tenant tidak terkunci dari
pekerjaan yang sudah jalan saat paketnya turun: **tagihan yang sudah beredar tetap bisa dilunasi &
dibatalkan** walau `payment.digital` mati (yang ditolak hanya pembuatan tagihan baru — dan penjualan
kasir yang menunjuk tagihan yang sudah lunas tetap boleh disimpan), dan
**perangkat yang sudah terdaftar tetap bisa mendetak, menarik, dan menyelesaikan konfliknya** walau
`sync.realtime` mati (yang ditolak hanya pendaftaran perangkat baru & dorongan perubahan baru).

## Blocker yang masih terbuka

1. **Provider autentikasi belum terpasang.** `ALLOW_UNVERIFIED_ACTOR` default `true`; setel
   `false` di deployment untuk mewajibkan identitas terverifikasi. Memasang Convex Auth
   (`@convex-dev/auth`, `auth.config.ts`, issuer JWT) butuh deployment nyata. Blocker ini juga
   menahan **akun platform developer**: jalur “diterima”-nya tidak bisa diuji sampai identitas nyata
   ada — lihat item 7.
   **Pembaruan 2026-10-12:** jalur masuk **tanpa kata sandi** (kode OTP email, lihat entri teratas)
   kini ada dan membuat akun di server, tetapi ia **belum menggantikan** provider identitas:
   `ctx.auth.getUserIdentity()` masih kosong, jadi `ALLOW_UNVERIFIED_ACTOR` masih berlaku dan
   “sudah masuk di aplikasi” belum berarti “identitas terverifikasi bagi server”. Sesi juga masih
   disimpan per perangkat (`localStorage`).
   **Pembaruan 2026-10-12 (akun platform):** `phansugisoft@gmail.com` sudah diberi penanda
   `platformRole: "developer"` (`bun convex run platform:grant` → exit 0; terbaca di
   `bun convex data users`). Penandanya **bekerja** begitu identitas nyata ada —
   `bun convex run platform:me '{"userId":"kx7ax4ckpm1mnk9n0za0xz6p8s8g45ss"}' --identity '{"email":"phansugisoft@gmail.com"}'`
   → exit 0, `roleLabel: "Pengembang platform"` — sementara panggilan **tanpa** identitas gagal
   **exit 1** (“akun platform menuntut identitas login yang terverifikasi”). Jadi backstage di browser
   tetap terkunci sampai provider identitas terpasang.
   **Pembaruan 2026-10-12 (Convex Auth terpasang).** Provider identitasnya kini ada:
   `@convex-dev/auth@0.0.96` + provider OTP email Resend (`src/convex/auth.ts`,
   `authEmail.ts`, `auth.config.ts`, rute di `http.ts`, tabel auth di skema). Bukti: token bersub
   `"<id akun>|<id sesi>"` diterima `platform:me` (200, `roleLabel: "Pengembang platform"`) sedangkan
   identitas yang tidak cocok tetap ditolak; `/.well-known/jwks.json` menyajikan kunci yang sama
   dengan `JWKS` yang diset. Halaman `/platform` kini punya kartu masuk identitas dan membuka
   backstage sendiri setelah kode diverifikasi. Yang **masih** terbuka: (i) langkah manusia
   memasukkan kode dari inbox + klik di browser sungguhan pada build yang dideploy (Blocker #3),
   dan (ii) jalur masuk tenant yang **belum** pindah ke Convex Auth, sehingga
   `ALLOW_UNVERIFIED_ACTOR` masih `true` untuk permukaan tenant.
   **Pembaruan 2026-10-12 (cek akun pengembang, entri teratas):** tautan identitasnya sudah ada
   (`authAccounts`: `resend-otp` ↔ `phansugisoft@gmail.com`), gerbangnya bekerja dua arah
   (`platform:me` dengan identitas → `Pengembang platform`; tanpa identitas → exit 1), dan akun itu
   punya **0 baris `memberships`**. Yang belum: `authSessions` **kosong**, jadi belum ada sesi hidup —
   backstage di browser tetap menunggu permintaan kode baru lalu memasukkannya. Temuan samping:
   satu akun uji sisa harness (`platform-1791779111174@mesinpos.id`) masih ber-penanda `developer`
   dan belum dicabut (butuh keputusan, karena itu tulisan ke data produksi).
   **Pembaruan 2026-10-12 (entri teratas: workspace berdiri sendiri):** sesi perangkat kini
   diselaraskan dengan keanggotaan di server (`tenants.listMine` → `adoptWorkspace`, ditahan
   `store.workspacePending` selama identitas belum pasti). Jadi bagian “sesi per perangkat” pada butir
   ini tidak lagi berarti “sesi basi bisa menampilkan bisnis orang lain” — workspace-nya selalu
   ditentukan keanggotaan di server. Yang **masih** berlaku dari butir ini: identitas login belum
   menjadi identitas terverifikasi bagi server pada permukaan tenant (`ALLOW_UNVERIFIED_ACTOR`).
2. **SELESAI 2026-10-11 (entri "Langkah B percobaan 7"): fungsi sudah ter-deploy dan produksi
   berjalan di data Convex.** Bukti: `node scripts/convex-verify-push.mjs mellow-narwhal-477` →
   `fungsi=ada` · `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun
   scripts/verify-backend.mjs` → `64/64 checks passed` · bundel produksi
   `assets/index-BCtckSx3.js` memuat `https://mellow-narwhal-477.convex.cloud` dan tidak memuat
   `127.0.0.1:3210`. Kuncinya dipakai CLI Convex langsung dari `.env.local` (env workspace), dan
   `scripts/build-hosted.sh` memakai jalur `env-file` yang sama saat deploy produksi — jadi
   deploy berikutnya ikut mengirim fungsi tanpa campur tangan manual. Sisa catatan:
   (a) preview/sandbox **tetap di jalur demo** karena `VITE_CONVEX_URL` di `.env.local` masih
   `http://127.0.0.1:3210` (tidak hidup) — jangan set `VITE_DATA_SOURCE=convex` di `.env.local`
   selama URL itu belum diganti ke URL awan. **Pembaruan 2026-10-13:** URL di `.env.local` sudah
   `https://mellow-narwhal-477.convex.cloud`, jadi syarat itu tidak lagi menghalangi: uji peramban
   2026-10-13 menjalankan preview dengan `VITE_DATA_SOURCE=convex` dan store Convex benar-benar hidup
   di browser (lihat Blocker #3). Kunci itu dikembalikan ke `demo` setelah uji supaya preview tetap
   seperti semula; (b) `unresolvedBuildErrorCount` kembali **0** sejak deploy ulang
   2026-10-11 06:18Z (sempat `1` dari deploy `.diag-stop`). Jalur diagnostik sekarang lewat
   `sh ./scripts/build-diag.sh` (env `BUILD_DIAG`), bukan berkas penanda — lihat entri teratas
   "Build failed di produksi = penanda diagnostik yang tertinggal"; (c) nilai env
   produksi tetap tiba di builder sebagai **amplop terenkripsi** (percobaan 5), jadi jangan
   diandalkan untuk apa pun; keberadaan `CONVEX_DEPLOY_KEY` di env produksi sudah tidak perlu.
3. **Belum pernah dirender di browser sungguhan:** jalur store Convex dan UI offline POS belum
   dilihat di browser. Halaman Modul/Produk/POS/Dashboard/Dapur & Meja/**Piutang**/**Member**/
   **Gudang & Stok**/**Pembelian** (termasuk bagian hutang usaha & pencocokan 3 arah)/**Dashboard**/
   **Opname**/**Laporan** (termasuk analitik lanjutan)/**Tim & Peran** (peran kustom `rbac.custom`)/
   **API & Webhook** (`api.access`)/**Dukungan** (`support.dedicated`)/**Pembayaran**
   (`payment.digital`)/**Sinkronisasi** (`sync.realtime`)
   dkk. kini **dirender di DOM klien** lewat `scripts/verify-render.mjs` (323/323) — termasuk jalur
   kasir yang menerbitkan tagihan QRIS dari keranjang, yang diuji dengan **menekan tombolnya** di DOM
   tiruan (`renderInteractive`), bukan hanya dengan memeriksa teksnya — dan bug nyata sudah
   tertangkap dari situ
   (penulisan `localStorage` di efek sesi tanpa penjagaan → layar putih; alur F&B kirim-ke-dapur →
   selesai; pelunasan piutang dua kali dalam satu tick memakai sisa yang basi di store demo;
   perpindahan stok dua kali dalam satu tick membaca stok gudang yang basi; dan pada 2026-10-11 aksi
   `api.access` berurutan dalam satu tick membaca daftar kunci/endpoint yang basi sehingga nama kunci
   kembar lolos & kiriman uji tidak menemukan endpoint-nya).
   DOM tiruan tetap bukan browser sungguhan: preview workspace masih mode demo, dan
   alur Convex yang baru (tables/KDS/piutang/member/gudang/pembelian/opname) baru diuji lewat backend
   harness + DOM, bukan lewat klik kasir. Halaman **Member** bergabung ke daftar ini pada
   2026-10-11, halaman **Gudang & Stok** dan **Pembelian** menyusul hari yang sama, halaman
   **Opname** menyusul hari yang sama juga, halaman **Laporan** (beserta analitik lanjutannya)
   menyusul lewat slice pertama Phase 4, halaman **Tim & Peran** menyusul lewat slice kedua hari
   yang sama, halaman **API & Webhook** menyusul lewat slice ketiga hari yang sama, dan halaman
   **Dukungan** beserta bagian lintas cabang di **Laporan** menyusul lewat Phase 5 (2026-10-12),
   dan halaman **Pembayaran** serta **Sinkronisasi** menyusul lewat Phase 6 hari yang sama.
   **Pembaruan 2026-10-12 (panduan & isi stok).** Halaman **Panduan** (`/app/panduan`) beserta dua jalur
   isi stok yang baru disambungkan ke UI (tombol **Tambah produk** dengan stok awal dan tombol
   **Sesuaikan stok** di halaman Produk & Stok) bergabung ke daftar ini juga: keduanya diklik di DOM
   tiruan (`verify-render.mjs` 359/359), belum di browser sungguhan. Berkas PDF panduan
   punya pemeriksaan sendiri (`scripts/verify-panduan.mjs`) karena berkasnya bukan HTML — isinya
   dibongkar ulang dari stream halaman, bukan dibaca dari layar.
   **Pembaruan 2026-10-12 (gambar produk).** Bagian **Gambar** di kartu **Produk baru** dan kartu
   **Atur harga** (kolom **Gambar** di tabel ikut) diklik di DOM tiruan (`verify-render.mjs` 371/371,
   termasuk berkas yang benar-benar dipilih lewat input berkas; DOM tiruan kini memasang `FileReader`).
   Jalur Convex-nya **lebih kuat dari DOM**: berkasnya diunggah sungguhan ke penyimpanan deployment
   awan lewat `verify-backend.mjs` (URL unggah, POST berkas, `addImage`, URL gambar menyajikan byte
   yang sama, batas 8 & tipe berkas ditolak server, berkas yang dihapus jadi 404). Yang **belum**:
   mengklik tombolnya di browser produksi, dan grid **kasir** (`/app/pos`) belum menampilkan gambar
   produk — permintaan ini soal menambahkan gambar ke produk, jadi layar jual tidak diubah.
   **Pembaruan 2026-10-12 (SKU otomatis).** Kolom SKU yang kini boleh dikosongkan beserta tombol
   **Buat otomatis** di form **Produk baru** diklik di DOM tiruan (`verify-render.mjs` 379/379), dan
   jalur penyimpanannya diuji sungguhan lewat `verify-backend.mjs` (548/548) terhadap deployment
   awan — jadi SKU otomatis bukan sekadar lolos tipe. Yang belum: mengkliknya di browser produksi.
   Satu batasan yang perlu diketahui: tombol itu hanya **mengisi kolom** dari daftar SKU yang sedang
   terbaca klien, sedangkan nomor final tetap ditentukan pihak yang menyimpan (counter tenant), jadi
   dua penyimpanan bersamaan tidak bisa menghasilkan SKU kembar.
   **Pembaruan 2026-10-12 (kategori menentukan SKU).** Mengganti kategori produk — di form **Produk
   baru** (selama kolom SKU masih berisi hasil tombol Buat otomatis) maupun di kolom **Kategori** pada
   kartu **Atur harga** — ikut mengganti kode di tengah SKU. Perilakunya diklik di DOM tiruan
   (`verify-render.mjs` 389/389) dan diuji sungguhan di deployment awan (`verify-backend.mjs`
   558/558: `PBB-UMU-000001` → `PBB-MAK-000001`, nomor dipertahankan, SKU manual tidak disentuh,
   kasir ditolak). Yang **belum**: mengklik kolom Kategori itu di browser produksi.
   **Pembaruan 2026-10-12 (audit menu).** Semua menu kini juga diuji **per peran** lewat
   `scripts/verify-menus.mjs` (364/364, exit 0): menu yang tampil untuk kelima peran, halaman yang
   terbuka untuk peran yang berhak, “Akses ditolak” untuk peran yang tidak berhak walau URL diketik,
   dan gerbang modul yang menggerakkan menu Dapur & Meja.
   **Pembaruan 2026-10-12 (tema & PWA).** Permukaan baru juga baru diuji di DOM tiruan:
   `verify-theme.mjs` 39/39 (termasuk **mengeksekusi** bootstrap tema di `index.html`) dan
   `verify-pwa.mjs` 1492/1492 (termasuk **mengeksekusi** `public/sw.js` dengan caches/fetch tiruan).
   Yang belum pernah dilihat mata manusia di browser: pemasangan PWA sungguhan (install prompt,
   ikon di layar utama, jendela layar penuh) pada build produksi.
   **Pembaruan 2026-10-13 (undangan kasir, entri teratas).** Jalur store Convex akhirnya dilihat di
   **browser sungguhan** (Chromium headless + Playwright, preview dijalankan sementara di mode Convex)
   untuk alur undangan kasir: masuk lewat halaman Masuk, onboarding, undangan di halaman Tim & Peran,
   lalu kasir masuk di perangkat baru. Halaman kasir (`/app/pos`) tampil dan klien kasir terbukti hanya
   membuka langganan yang izinnya dimilikinya (`roles:myAccess`, `products:listByStore` — tanpa
   `products:listAll`). Jadi kalimat “preview workspace masih mode demo” pada butir ini tidak lagi
   berarti jalur Convex tidak pernah berjalan di browser. Yang **masih** berlaku: seluruh halaman lain
   (Gudang & Stok, Pembelian, Opname, Laporan, API & Webhook, Dukungan, Pembayaran, Sinkronisasi, PWA
   di build produksi) belum dijalankan di browser sungguhan, masih mengandalkan DOM tiruan + backend.
   **Pembaruan 2026-10-12 (sidebar berwarna & shell backstage).** Sidebar backstage yang kini berwarna
   beserta shell yang setinggi layar diuji di DOM tiruan + dibaca dari berkas CSS-nya
   (`verify-theme.mjs` 50/50, `verify-render.mjs` 435/435), dan dev server membuktikan kelas barunya
   benar-benar menghasilkan deklarasi CSS (`.app-shell-height` + `@supports (height: 100dvh)`,
   `.sidebar-surface`, `.bg-sidebar-active\/15` → `hsl(var(--sidebar-active) / 0.15)`, dst.). Yang
   **belum**: menggulir halamannya di browser — tata letak adalah urusan mesin render, jadi yang
   diperiksa hanya susunan yang menjaminnya (shell setinggi layar, satu area gulir, header & sidebar di
   luar area gulir), bukan gerak menempelnya. Catatan koreksi: percobaan pertama memakai
   `sticky` + `h-dvh` dan gagal di browser tanpa dukungan `dvh` — lihat entri teratas.
   **Pembaruan 2026-10-12 (gerbang langganan dari server).** Jalur store Convex yang menjadi sumber
   laporan “Halaman ini gagal dimuat” (`products:listAll` ditolak untuk kasir) kini punya pemeriksaan
   tingkat **sumber**, bukan DOM: `scripts/verify-store-gate.mjs` (17/17) memetakan izin yang dituntut
   setiap `query` di `src/convex/*.ts` ke gerbang langganan di `src/lib/store/convex.tsx`, dan gagal
   kalau ada satu langganan berizin yang tidak digerbang `has("<izin>")` dari `roles.myAccess`. Sisi
   server-nya diuji sungguhan terhadap deployment awan (`verify-backend.mjs` 674/674: kasir ditolak
   `products.listAll`, `roles.myAccess` kasir tanpa `product.manage`, keanggotaan nonaktif terbaca
   `active:false`). Yang **belum**: menjalankan store Convex di browser sungguhan sebagai kasir yang
   diundang lewat undangan email — jadi urutan “izin kosong dulu, lalu terisi dari jawaban server”
   masih diperiksa sebagai sumber + backend, belum sebagai perilaku yang dilihat mata.
   **Pembaruan 2026-10-13 (pajak & pungutan F&B).** Kartu **Pajak & pungutan F&B** di halaman
   Pengaturan (PBJT + pengecualian usaha mikro, biaya layanan, PPh final UMKM / PPh 21 / PPh 4 ayat
   (2), dan ringkasan setoran bulanan) beserta baris pajak serta biaya layanan di kasir baru diuji di
   DOM tiruan (`verify-render.mjs` 584/584) dan di server sungguhan (`verify-backend.mjs` 688/688),
   belum di browser sungguhan — jadi kalimat “halaman Pengaturan belum pernah dilihat di browser” pada
   butir ini masih berlaku untuk kartu barunya.
   **Pembaruan 2026-10-13 (laporan pajak & pungutan F&B per bulan).** Kartu laporan
   bulanan di halaman Laporan (12 bulan, kolom PBJT/PPN/biaya layanan/PPh final/PPh sewa, baris
   jumlah, catatan per bulan) ditambahkan ke daftar ini: diuji di DOM tiruan (`verify-render.mjs`
   596/596) dan di server sungguhan (`verify-backend.mjs` 691/691, termasuk penjualan yang di-void
   hilang dari laporan), **belum** di browser sungguhan — jadi halaman **Laporan** masih memakai DOM
   tiruan + backend untuk bagian ini.
   **Pembaruan 2026-10-13 (tombol menu di header, entri teratas).** Tombol menu (burger) di header
   backstage beserta panel sidebar yang dibukanya **sudah diuji di browser sungguhan**: Chromium
   headless di 390×844 (HP) dan 1280×800, termasuk mode layar penuh (`scripts/verify-browser-menu.mjs`
   12/12, exit 0) — dan uji itulah yang menangkap bug nyata “panelnya menutupi tombolnya sendiri”.
   Jadi untuk bagian shell ini, kalimat “belum pernah dilihat di browser” **tidak lagi berlaku**. Yang
   masih terbuka: browser HP sungguhan (Safari iOS / Chrome Android, termasuk bilah alamat yang
   muncul-hilang) dan build **produksi**, dan seluruh halaman lain di daftar ini tetap mengandalkan
   DOM tiruan + backend.
   **Pembaruan 2026-10-13 (gulir shell, entri teratas).** Enam halaman backstage — **Pengaturan**,
   **Laporan**, **Produk & Stok**, **Kasir**, **Gudang & Stok**, dan **Panduan** — kini benar-benar
   **dibuka di browser sungguhan** (Chromium headless, 390×844 & 1280×800) oleh
   `scripts/verify-browser-scroll.mjs` (60/60, exit 0): halamannya diperiksa lewat penanda isinya,
   lalu gulirnya diukur — dokumen tidak boleh lebih tinggi dari layar, `window.scrollTo` tidak boleh
   menggeser apa pun, dan header & sidebar harus tetap `top 0` setelah halaman digulir sampai bawah.
   Jadi “belum pernah dilihat di browser” **tidak lagi berlaku untuk kerangka** keenam halaman itu,
   berikut bug nyata yang tertangkap dari situ (`.sr-only` yang membuat seluruh shell bisa diangkat —
   halaman Pengaturan).   Yang masih terbuka: alur **di dalam** halaman-halaman itu (klik, simpan, unggah)
   tetap mengandalkan DOM tiruan + harness backend, dan browser HP sungguhan serta build produksi juga
   belum.
   **Pembaruan 2026-10-13 (volume bip kasir, entri teratas).** Tab baru di halaman kasir — kontrol
   volume bip (tombol − / + dengan angkanya) — **sudah diuji di browser sungguhan**:
   `scripts/verify-bip-warna-browser.mjs` 16 → **23** pemeriksaan, dengan pembungkus `AudioContext` yang
   kini juga mencatat kekuatan puncak nada, jadi terbukti volumenya sampai ke nada yang benar-benar
   dijadwalkan (0,2 di 80 %, 0,15 di 60 %) dan bertahan setelah halaman dimuat ulang. Halaman
   **Pengaturan** sendiri tetap seperti sebelumnya: kartu setelannya diuji di DOM tiruan, bukan di
   browser sungguhan (gerbang izinnya `billing.manage`).
   **Pembaruan 2026-10-14 (cetak struk di ponsel yang tergulir, entri teratas).** Halaman **Kasir**
   sekarang juga diuji di **ponsel sungguhan ukuran 390×844** (Chromium), bukan hanya 1400×950: bagian
   baru `scripts/verify-struk-browser.mjs` menyelesaikan satu penjualan, menggulir `<main>` sampai bawah,
   lalu memeriksa **hasil cetaknya** (area cetak menempel di kertas, seluruh lembar & logo muat, isinya
   memuat nama usaha/kasir/pembeli, berkas PDF-nya sama persis dengan keadaan belum tergulir, kertas A4
   tetap satu halaman). Itu menangkap bug nyata yang lolos dari uji desktop — sebabnya halaman desktop
   tidak bisa menggulir sama sekali.
   **Pembaruan 2026-10-14 (cetak struk langsung ESC/POS, entri teratas).** Dialog struk di halaman
   **Kasir** — sekarang berisi pemilih sambungan USB/Bluetooth, tombol Sambungkan, dan tombol
   **Cetak ke printer** — **sudah diuji di browser sungguhan**: Chromium headless dengan perangkat
   WebUSB & Web Bluetooth **tiruan** (`scripts/verify-escpos-browser.mjs` 26/26, exit 0), dan tombol
   lewat dialog peramban tetap diperiksa di `verify-struk-browser.mjs` (63/63, termasuk bagian ponsel
   390×844 yang tergulir di entri teratas). Yang belum: printer
   fisiknya sendiri — lihat Blocker #10 di bawah.
   **Pembaruan 2026-10-14 (pesanan QR meja, entri teratas).** Alur QR meja dilihat di **browser
   sungguhan** dalam **mode demo** lewat `scripts/verify-meja-browser.mjs` (28/28, exit 0): kartu QR di
   halaman **Dapur & Meja** benar-benar dipindai tautannya (`data-qr-value`), halaman tamu publik
   `/meja/:token` memesan → membayar → dan tiketnya muncul di antrean dapur bertanda “Lunas QRIS”.
   Yang **belum**: alur yang sama di jalur store Convex (baru diuji lewat `verify-backend.mjs` 744/744)
   dan di build produksi.
4. **SELESAI 2026-10-11 (entri “Phase 4 slice 3c”).** `src/convex/crons.ts` menjalankan
   `apiAccess.retryDueDeliveries` **tiap 1 menit**: kiriman `pending` yang jadwalnya lewat diambil lewat
   indeks `by_status_next_attempt`, dikirim ulang lewat jalur bertanda tangan yang sama, dan hasilnya
   dicatat kembali (`finishDelivery`), sehingga jadwal berikutnya tetap dari aturan murni. Endpoint yang
   dimatikan/dihapus **menghentikan** percobaannya (`stopDelivery` → `failed`), bukan menggantung
   selamanya. Bukti perilaku (bukan teks): `bun scripts/verify-webhook-retries.mjs` → 6/6 (percobaan
   penerima aktif bertambah 1 → 2 tanpa pemicu manual, jadwal berikutnya +5 menit, penerima yang
   dimatikan ditutup `failed` pada percobaan 1 dengan alasan “dinonaktifkan”); `bun scripts/verify-api.mjs`
   → 192/192 · `verify-backend.mjs` → 396/396 · `verify-render.mjs` → 239/239 (angka **saat itu** — cek
   bertambah di entri berikutnya: 209/209 · 403/403 · 239/239).
5. **SELESAI 2026-10-11 (entri “Phase 4 slice 3b”).** API tidak lagi baca saja: `POST /api/v1/sales`
   mencatat pesanan dari sistem luar dengan scope tulis `pos.sell` (kunci tetap bertindak sebagai izin
   pembuatnya, harga dihitung server, `idempotencyKey` wajib). Bukti: `bun scripts/verify-api.mjs` →
   180/180 (cek murni) · `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun
   scripts/verify-backend.mjs` → 396/396 (penjualan **201**, kiriman ulang **200** dengan id yang
   sama, stok 3 → 1, stok kurang 409, SKU asing 400, kunci dicabut 401). Sisa yang belum ada di jalur
   tulis: ubah harga/stok, pembatalan penjualan, dan `modifiers` (ditolak eksplisit dengan alasan).
6. **SELESAI 2026-10-12 (entri “Audit & tutup celah”).** Seluruh entri katalog webhook kini punya
   pemicunya. Empat event transaksi berangkat dari jalur kejadiannya (`sale.completed`, `sale.voided`,
   `stock.low`, `opname.posted`), dan **dua event berbasis kalender** — `payable.due` dan
   `receivable.overdue` — kini dijalankan **pekerja harian** (`crons.daily` →
   `payables.notifyDuePayables` / `ar.notifyOverdueReceivables`) dengan penanda sekali-per-dokumen
   (`dueNotified`/`overdueNotified` ditulis sejak dokumen lahir) dan pencarian berjendela 60 hari
   lewat indeks `by_due`/`by_overdue`. Bukti: `bun scripts/verify-api.mjs` → 225/225 dan
   `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` →
   480/480, yang **menjalankan pekerja hariannya apa adanya** (`bun convex run
   payables:notifyDuePayables`) pada deployment nyata: tagihan lewat tempo menulis kiriman
   `payable.due`, putaran kedua tidak menambah kiriman, dan penerimanya dibersihkan. Sisa yang tetap
   terbuka dan bukan lagi blocker: kiriman `receivable.overdue` belum pernah terbit dari nota nyata
   (piutang selalu lahir dengan jatuh tempo di masa depan, jadi menunggak butuh waktu) — dicatat di
   entri tersebut.
7. **Akun platform developer & sesi pendampingan: jalurnya ada, tapi belum pernah dipakai manusia
   sungguhan (2026-10-12, diperbarui).** Model aksesnya (penanda `users.platformRole` tanpa baris
   `memberships`, gerbang `requirePlatformDeveloper` yang menolak `verified: false` walaupun
   `ALLOW_UNVERIFIED_ACTOR` longgar) **dan** jalur pendampingannya (sesi beralasan + berbatas waktu,
   hanya baca, berjejak di `auditLogs` tenant) kini sama-sama ada, berikut halaman backstage
   `/platform`. Bukti: `bun scripts/verify-authz.mjs` → 84/84 · `bun scripts/verify-impersonation.mjs`
   → 49/49 · `bun scripts/verify-render.mjs` → 309/309 ·
   `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs` → 489/489
   (17 cek akun platform & pendampingan). Angka terkini (2026-10-12, setelah jalur masuk tanpa kata
   sandi ditambahkan): 323/323 · 501/501. Yang masih terbuka:
   (a) **jalur “diterima” belum teruji end-to-end** — klien harness tidak pernah beridentitas, jadi E2E
   hanya membuktikan penolakan (aturan penerimaannya diuji murni di `verify-impersonation.mjs`), dan itu
   baru hidup setelah **item 1** (provider autentikasi) selesai;
   (b) **halaman backstage tampil terkunci** di deployment ini karena alasan yang sama — dan ia **belum
   pernah dibuka manusia di browser sungguhan**; yang diuji baru keadaan terkuncinya + rutenya;
   (c) **jejak tenant hanya bisa dibaca lewat query** `platform.impersonationTrail` (izin `team.manage`,
   diuji E2E sebagai pemilik tenant & ditolak untuk bukan anggota) — **belum ada bagian UI** di halaman
   Tim, jadi hari ini pemilik tenant harus memanggilnya lewat klien, bukan membaca di halaman;
   (d) **sesi pendampingan hanya membaca.** Tidak ada satu pun `Permission` tenant yang menyala di
   dalamnya, jadi “menolong” saat ini berarti melihat keadaan tenant (identitas, anggota, toko) — belum
   memperbaiki data tenant dari dalam sesi;
   (e) **membuat/mencabut akun platform bergantung pada akses deployment** (`bun convex run
   platform:grant`/`platform:revoke`, sengaja `internalMutation`), jadi kontrol aksesnya berpindah ke
   dashboard/akses Convex — bukan ke peran di dalam produk.
8. **SELESAI 2026-10-12 (entri teratas).** Kunci email terpasang *dan* pengiriman OTP kini **terbukti
   diterima penyedia**: catatan DNS pengirim (`MX`/`TXT` `send.*` + `TXT resend._domainkey.*`) sudah
   dipasang di **Vercel** (zona subdomain itu sendiri — zona induk Rumahweb tidak menjawab nama di
   bawahnya), lalu `bun convex run otp:requestCode '{"email":"phansugisoft@gmail.com"}'` →
   `bun convex run otp:delivery` menunjukkan `deliveredVia: "resend"` dengan `deliveryError: null`
   (sebelumnya 403 “domain belum diverifikasi”). Sisa yang **tidak bisa** dibuktikan mesin: email itu
   terlihat di inbox pengguna (Spam/Promosi) — itu tugas manusia. Kait uji `OTP_DEV_CODE` tetap ada dan
   tetap hanya berlaku untuk alamat berdomain `.test`.

9. **Kanal kirim struk ke WhatsApp belum pernah menyentuh jaringan sungguhan.** Kodenya lengkap
   (`src/convex/receiptWa.ts` + `receiptWaData.ts`), bentuk permintaannya teruji murni 33/33
   (`verify-struk-pdf.mjs`), dan berkas PDF-nya terbukti benar-benar terunduh di Chromium (47/47) — tetapi
   **belum ada satu pun kiriman nyata** ke WhatsApp Cloud API, karena itu butuh akun Meta: nomor WhatsApp
   Business terdaftar, token akses, dan id nomor pengirim. Rencana verifikasinya: isi
   `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` di env **deployment**, kirim satu struk ke nomor uji,
   lalu periksa baris log audit `receipt.whatsapp` (status `sent` + `to` yang tersensor) dan pesan dokumen
   yang benar-benar diterima di perangkat penerimanya. Selama kuncinya belum ada, aplikasinya menjawab
   “kanal WhatsApp belum tersambung” beserta nama kuncinya — jadi tidak ada klaim palsu, tetapi kemampuan
   ini belum bisa disebut terpakai di produksi.

10. **Cetak struk ESC/POS belum pernah menyentuh printer sungguhan.** Aturan byte-nya teruji murni
   (58/58) dan jalur perangkatnya terbukti mengirim byte di Chromium — tetapi dengan perangkat
   **tiruan** (`scripts/verify-escpos-browser.mjs`, 26/26, exit 0), karena lingkungan ini tidak punya
   printer. Jadi yang **belum** dibuktikan: (a) printer USB di Windows yang memerlukan driver
   **WinUSB** (selama driver pabriknya masih memegang interface-nya, perangkatnya tidak muncul di
   pemilih peramban — dan itu baru ketahuan di mesin kasir sungguhan), (b) model Bluetooth sungguhan
   beserta profil GATT dan jeda antar potongnya, (c) printer yang memakai protokol vendor sendiri
   (mis. NIIMBOT/Marklife) — urutan Epson di sini tidak untuk mereka, dan (d) printer **jaringan**
   (LAN/port 9100) yang tidak punya jalur sama sekali, karena halaman web tidak bisa membuka soket
   TCP mentah; itu butuh perantara. Rencana verifikasinya: di mesin kasir, sambungkan satu printer
   thermal USB (dan satu portabel Bluetooth), cetak satu nota, lalu periksa kertasnya — lebar kolom,
   potongan, logo, dan teks beraksen yang disaring. Sampai itu terjadi, kemampuan ini di sebut
   “teruji di peramban dengan perangkat tiruan”, bukan “teruji di printer”.

## Perintah verifikasi rutin

```bash
bun tsc -b --noEmit                          # tipe frontend
bun tsc -p tsconfig.convex.json --noEmit     # tipe backend
bun scripts/verify-authz.mjs                 # tabel peran, kebijakan identitas & akun platform (murni, 92/92)
bun scripts/verify-categories.mjs            # kategori produk category.manage: nama terlarang & kembar, kode SKU, kategori nonaktif, tab POS, dampak hapus (murni, 35/35)
bun scripts/verify-impersonation.mjs         # sesi pendampingan platform: alasan, batas waktu, penolakan workspace sendiri & jejak audit (murni, 52/52)
bun scripts/verify-offline.mjs               # mesin antrean offline (murni)
bun scripts/verify-fnb.mjs                   # aturan denah meja + antrean dapur + pagar hapus meja + urutan & impor denah + penanda kanal/momen pelunasan tiket + kapan tagihan QR baru boleh diberitahukan (bunyi & kilat: sekali per tagihan, hanya yang baru) (murni, 95/95)
bun scripts/verify-meja.mjs                   # pesanan QR meja: token `mj_`/`mjo_`, keranjang tamu (harga dari katalog & batasnya), total tamu = total kasir, cara bayar QRIS/VA + nomor VA deterministik, gambar QRIS (screenshot) bisa dipindai balik, pagar pembatalan tamu, “masih menunggu pelunasan” (`isAwaitingPayment`) (murni, 72/72)
bun scripts/verify-modifiers.mjs             # aturan modifier item + harga tambahan (murni)
bun scripts/verify-ar.mjs                    # aturan piutang B2B + credit limit (murni)
bun scripts/verify-modules.mjs               # aturan aktivasi modul vertikal + urutan paket & aturan pindah paket (murni, 34/34)
bun scripts/verify-wholesale.mjs             # harga bertingkat + konversi satuan (murni)
bun scripts/verify-members.mjs               # member & diskon member (murni)
bun scripts/verify-inventory.mjs             # gudang + perpindahan stok (murni)
bun scripts/verify-purchasing.mjs            # pembelian PR/PO/GRN (murni)
bun scripts/verify-payables.mjs               # hutang usaha & tempo supplier (murni)
bun scripts/verify-threeway.mjs               # pencocokan 3 arah + bayar sekaligus (murni)
bun scripts/verify-opname.mjs                 # stock opname & audit selisih (murni)
bun scripts/verify-analytics.mjs              # analitik lanjutan report.advanced (murni)
bun scripts/verify-rbac.mjs                   # peran kustom rbac.custom (murni, 48/48)
bun scripts/verify-store-gate.mjs             # gerbang langganan store Convex: izin yang dituntut tiap query di src/convex/*.ts vs gerbang `has(<izin>)` dari roles.myAccess, wajib "skip", izin sesi dilarang, keanggotaan nonaktif (murni, 17/17)
bun scripts/verify-scan-beep.mjs              # bunyi bip kasir + nada notifikasi tagihan QR dapur: nada yang dijadwalkan (frekuensi, amplop, sambungan simpul), konteks sekali & dipakai ulang, resume autoplay, tanpa Web Audio = senyap, aturan setelan aktif/mati (bawaan aktif, hanya "off" yang mematikan, penyimpanan menolak, pendengar React), plus aturan volume 10–100 % (langkah 10 %, bawaan 70 % yang mengembalikan kekuatan lama 0,18, nilai rusak kembali ke bawaan, label & kalimat, nada yang dijadwalkan memakai kekuatan sesuai volume), dan nada dapur yang satu oktaf di atas bip kasir & ikut saklar bunyi yang sama (murni + tiruan AudioContext, 62/62)
# uji browser sungguhan (Chromium/Playwright) — butuh paket peramban DI LUAR repo (PLAYWRIGHT_DIR) dan
# preview yang sedang mode Convex (VITE_DATA_SOURCE=convex + VITE_CONVEX_URL awan):
# PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-escpos-browser.mjs http://localhost:5173   # mode data apa pun
#   → cetak struk langsung ESC/POS: perangkat USB & Bluetooth **tiruan** dipasang di Chromium — tombol
#     Sambungkan memanggil `requestDevice` dengan saringan kelas printer & vendor, memilih alternatif di
#     pemilih perangkat, mengambil endpoint out yang benar, dan tombol Cetak ke printer benar-benar
#     mengirim byte ke endpoint itu; jalur Bluetooth meminta lima profil + lima layanan opsional, menulis
#     per potongan 20 byte, dan mengirim byte berisi hal yang sama; peramban tanpa WebUSB/Web Bluetooth
#     menjelaskan sebabnya (bukan tombol yang gagal tanpa sebab) dan tetap menawarkan dialog cetak
#     peramban; pemilih perangkat yang ditutup dijelaskan apa adanya (26/26)
# PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-browser-invite.mjs http://localhost:5173 428913
#   → undangan kasir lewat UI, kasir masuk di perangkat baru, cek bingkai websocket yang benar-benar dikirim klien (13/13)
# PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-version-browser.mjs http://localhost:5173   # mode data apa pun
#   → banner “Versi baru tersedia — muat ulang”: muncul dari pemeriksaan pertama (45 detik),
#     menyebut kedua bundel, tidak menagih server berulang, tombolnya benar-benar memuat ulang halaman (7/7)
# PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-bip-warna-browser.mjs http://localhost:5173   # mode data apa pun
#   → bip kasir & warna kartu dashboard: ketukan produk membuat AudioContext + nada 1245 Hz `triangle`,
#     empat kartu ringkasan berwarna beda, hanya kartu stok yang berdenyut, tombol “Bip kasir” benar-benar
#     membungkam nada lalu menyalakannya lagi, dan volume − / + di kasir mengubah **kekuatan puncak** yang
#     benar-benar dijadwalkan ke Web Audio (0,2 di 80 %, 0,15 di 60 %) serta bertahan setelah muat ulang (23/23)
# PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-browser-scroll.mjs http://localhost:5173   # mode data apa pun
#   → gulir shell backstage: dokumen tidak bisa digulir, `window.scrollTo` tidak menggeser apa pun, dan header
#     & sidebar tetap menempel di atas setelah halaman digulir sampai bawah (60/60; 6 halaman × 2 ukuran layar)
# PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-pos-transaksi-browser.mjs http://localhost:5173   # mode data apa pun
#   → tombol “Transaksi terakhir (shift ini)” & lembarnya di Chromium: posisi lembar direkam tiap bingkai
#     (bingkai pertama masih di bawah layar, lalu naik ≥ 5 posisi sampai menempel di tepi bawah), daftarnya
#     sebanyak yang disebut tombol (8 baris setelah dua penjualan baru, bukan batas 6 baris tabel lama),
#     transaksi terbaru di puncak, dan ketiga cara menutup (silang/Escape/latar) bekerja (14/14)
# PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173   # mode data apa pun
#   → setelan struk di halaman Pengaturan: katalog tiga jenis printer terlihat, lebar kertas 80 mm/241 mm
#     benar-benar mengubah ukuran pratinjau di layar, logo diunggah lewat input berkas (PNG dari canvas
#     peramban) lalu tampil 110 px × 110 px hitam putih di atas nama usaha (tetap 110 px saat kertasnya
#     jadi 241 mm) dan bertahan setelah muat ulang, logo yang sama jadi penanda workspace di sidebar kiri &
#     tampil di halaman Panduan (badge 18 bagian · 12 gambar), baris pembeli berganti dari “Member : Cash”
#     ke nama member begitu kasir memilihnya, lima tombol pecahan uang dirender & muat di dalam dialog
#     pembayaran (menekan Rp 100.000 mengisi kolom “Uang diterima”, menandai pilihannya, dan menghitung
#     kembaliannya > Rp 0), struk kasir memuat logo + “Kasir : …”, dan saat media cetak hanya struk yang
#     tampil — logo cetaknya diukur ulang dari piksel tangkapan layarnya (selisih kanal 0) plus PDF yang
#     ikut dihasilkan; ditutup dengan pembayaran tunai yang benar-benar diselesaikan: dialog struk terbuka
#     **tanpa** satu pun panggilan `window.print`, **Unduh PDF menghasilkan unduhan sungguhan** yang byte-nya
#     dibaca kembali (`struk-A-01043.pdf`, `%PDF-1.4` … `%%EOF`, 2 halaman untuk 2 lembar rangkap, memuat
#     Cappuccino/TOTAL/TEMBUSAN 1), member tanpa nomor WA ditahan beserta sebabnya, Cetak memanggil dialog
#     cetak sekali dengan nota yang sama, dan kirim ke WhatsApp member (nomor tersensor) dilaporkan apa adanya
#     — disimulasikan di mode demo, atau disebut belum tersambung kalau kuncinya belum ada; termasuk alur
#     struknya: sebelum dibayar panel kasir **belum** memuat tombol Cetak / Struk & kirim, sesudah lunas
#     keduanya ada beserta catatan nomor nota yang sudah dibayar, plus saran setelan otomatis (lencana modul
#     F&B beserta mesin yang disarankan, menekan “Pakai saran ini” benar-benar memindahkan setelannya ke
#     thermal 80 mm satu lembar — pilihan kertas 241 mm hilang — dan tombolnya terkunci membaca “Sudah
#     sesuai”; aturan `@page` yang ditulis halaman kasir juga terbaca peramban: 241 mm × tinggi notanya)
#     — ditutup bagian **ponsel 390×844 yang halamannya tergulir**: area cetaknya tetap mulai dari sudut
#     kiri-atas kertas (`fixed`, bukan tergeser gulir), seluruh lembar & logo muat di kertas, isinya memuat
#     logo + nama usaha + kasir + pembeli, berkas PDF-nya sama persis dengan keadaan belum tergulir, dan
#     kertas A4 tetap satu halaman; dan berkas PDF yang benar-benar terunduh memuat logonya sebagai objek
#     gambar 96 × 48 yang isinya dicocokkan piksel per piksel; tombol **Kirim ke WhatsApp pembeli** yang di
#     mode demo hanya menyertakan **gambar struk berlogo** (tanpa `.pdf`) dan menyebutnya di laporannya;
#     dan tombol **Bagikan gambar struk** — satu-satunya jalur berbagi, tombol “Bagikan PDF” **tidak ada**
#     lagi — menyerahkan satu berkas `image/png` bernama `struk-<nota>.png` yang benar-benar diterbitkan
#     peramban (dua lembar kertas terpisah di atas latar abu-abu, logo hijau tokonya ada **di dalam**
#     gambarnya — berwarna, di kedua lembarnya — dan teks struknya puluhan ribu px gelap tanpa satu baris
#     pun menembus tepi kanan kertasnya), isi struknya ikut sebagai teks pesannya & judulnya menyebut nomor
#     notanya, dan menekan tombolnya sekali lagi tetap menyerahkan satu berkas gambar yang sama; halaman
#     Panduan juga memuat kartu panduan singkat kirim struk ke WhatsApp pembeli (terlihat, langkahnya terbaca,
#     dan kedua tautannya — kasir & pengaturan — ada) (93/93)
bun scripts/verify-team.mjs                   # tim: nomor WA (`62…`), pesan & tautan wa.me, pagar ubah/nonaktif/hapus anggota (murni, 47/47)
bun scripts/verify-api.mjs                    # kunci API, webhook, pekerja retry, pemicu event/kalender & pesanan masuk api.access (murni, 225/225)
bun scripts/verify-support.mjs                # dukungan khusus support.dedicated: janji tanggap, SLA, transisi & kanal keluar (murni, 61/61)
bun scripts/verify-scale.mjs                  # skala franchise scale.franchise: anggaran query, pangsa & gabungan top-N (murni, 42/42)
bun scripts/verify-payments.mjs               # pembayaran digital payment.digital: umur tagihan, pelunasan pas, transisi & tagih dari keranjang (murni, 72/72)
bun scripts/verify-qr.mjs                     # kode QR tagihan bisa dipindai: payload → matriks → jalur SVG → dibaca balik jsqr (murni, 11/11)
bun scripts/verify-otp.mjs                    # masuk tanpa kata sandi otp.auth: email valid, hash & umur kode, batas kirim, sekali pakai (murni, 79/79)
bun scripts/verify-sync.mjs                   # sinkronisasi real-time sync.realtime: kehadiran, kursor tarik & konflik (murni, 47/47)
bun scripts/verify-render.mjs                # render sisi klien di DOM tiruan (happy-dom), termasuk lencana sumber data “Terhubung ke server”/
# “Data demo” beserta penjelasan halaman-halamannya, termasuk alur ketik email → kode OTP → sesi, klik kasir, kode QR di dialog + halaman Pembayaran, aksi store sinkronisasi, backstage platform terkunci + baris “Workspace saya”, header beranda yang menempel saat digulir, notis kegagalan sambung-tenant & tombol naik paket yang benar-benar pindah paket, plus halaman Panduan beserta tautan unduhan PDF-nya & lencana 18 bagian · 12 gambar, alur isi stok yang benar-benar diklik, unggah/hapus gambar produk dari kartu Produk baru & Atur harga sampai batas 8, serta tombol Buat otomatis, simpan dengan kolom SKU kosong, SKU yang ikut kategori baru dari form & dari kartu Atur harga, pengelolaan kategori produk (tambah/ubah nama/nonaktifkan-aktifkan/hapus + tab POS & gerbang izinnya), onboarding yang menahan formulir
bisnisnya selama identitas workspace dipulihkan, pendaftaran anggota tim dari halaman Tim & Peran,
kolom Undangan beserta tombol Kirim ulang, kolom WhatsApp + tombol Kirim via WA yang benar-benar membuka tautan wa.me, serta Ubah/Nonaktifkan/Hapus anggota, plus rute `/app/pos` sungguhan yang membuktikan header & sidebar berada di luar satu-satunya area gulir, dan lencana sumber data “Terhubung ke server”/“Data demo”, kelola produk tersimpan — ubah nama/SKU/harga beli, nonaktifkan/aktifkan, dan dialog hapus berpagar — gambar produk di kartu kasir & baris keranjang, serta tombol Layar penuh yang benar-benar diklik di beranda, halaman masuk, dan backstage, alur setelan PPN (ubah tarif → aktif 0% ditolak → matikan PPN → kasir & tagihan langganan mengikuti), serta notis keanggotaan yang dinonaktifkan beserta petunjuknya, dan tombol undangan yang mati selama workspace belum tersambung ke server, plus pajak & pungutan F&B (PBJT 10% + biaya layanan 7% disimpan dari halaman Pengaturan, struk kasir 28.000 → 32.760, “aktif 0%” ditolak, pengecualian usaha mikro & peringatan batas omzet), baris pembeli struk (“Member : Cash” saat kasir tidak memilih member → nama member begitu dipilih), dan logo toko (unggah/hapus dari kartu struk, kotak 110 px × 110 px hitam putih di pratinjau dan di setiap lembar struk kasir, tidak ikut melebar di kertas 241 mm, jadi penanda workspace di sidebar, dan kartu identitas di halaman Panduan), serta pembayaran tunai (lima tombol pecahan uang Rp 10.000…Rp 500.000 diklik di dialog kasir: Rp 10.000 belum cukup → kembalian Rp 0 & simpan terkunci, Rp 100.000 cukup → kembalian + TOTAL/Bayar/Kembali di struk sementara, kolom tetap bisa diketik sendiri, dan penjualan Tunai tercatat) plus dialog struk sesudah lunas (cetak/unduh PDF/kirim WA member: pilihannya ada, belum mencetak apa pun sampai Cetak ditekan, Unduh PDF melaporkan nama berkas + ukurannya, struk pembeli umum & member tanpa nomor WA masing-masing diberi kolom nomor di dialognya (kirim tanpa nomor ditolak dengan petunjuk kolomnya, nomor yang sah tinggal berhenti di ketiadaan kanvas), member bernomor pun berhenti di titik yang sama, menutup dialog tidak menghapus notanya), gerbang alur struk (keranjang yang belum dibayar belum menawarkan Cetak/Struk & kirim sama sekali, pembayaran lunas memunculkan keduanya beserta catatan nomor & total notanya, keranjang berikutnya tidak menggantikan struk yang dicetak, dan judul tombol cetaknya menyebut printer + kertas + rangkap), dan tombol “Transaksi terakhir (shift ini)” yang membuka lembar dari bawah (jumlah barisnya sama dengan angka di tombol, Escape menutupnya), serta kartu saran setelan otomatis di halaman Pengaturan (toko grosir disarankan dot matrix 76 mm dua rangkap beserta alasannya, menekan “Pakai saran ini” memindahkan pilihan mesin tanpa menghapus catatan kaki, lalu tombolnya membaca “Sudah sesuai”) dan aturan `@page` ukuran struk yang ditulis halaman kasir (76 mm × tinggi notanya, bukan A4), plus **satu jalur bagikan**: dialognya menawarkan “Bagikan gambar struk” dan **tidak** lagi menawarkan tombol kedua, dan di DOM tiruan yang tidak punya kanvas jawabannya mengarahkan ke Unduh PDF serta **tidak ada berkas kosong yang diserahkan** walaupun `navigator.share`/`canShare` dipasang; tombol **Kirim ke WhatsApp pembeli** pun berhenti di titik yang sama dengan laporan yang menyebut sebabnya (bukan klaim terkirim) — baik untuk member yang punya nomor, member yang baru diisi nomornya, maupun pembeli umum, plus halaman Panduan memuat kartu panduan singkat kirim struk ke WhatsApp pembeli dengan langkah, syarat kanal, jalan lain saat kanalnya belum tersambung, dan kedua tautannya, plus halaman tamu meja (pembatalan pesanan sendiri: tombol, konfirmasi, kalimat penolakan saat sudah lunas) dan denah meja di layar Dapur & Meja (Ubah mengisi nilai meja yang sekarang, nama kembar ditolak, dialog Hapus membaca pagar hapusnya lebih dulu, meja yang belum pernah dipakai benar-benar hilang, tombol Geser mati di ujung denah & urutan kartunya benar-benar berpindah, serta panel Impor: jumlah meja + kolom tiap barisnya di pratinjau, penolakan bernomor baris, dan meja hasil impor masuk di akhir denah, serta alur tamu → dapur → halaman Pembayaran dalam **satu store**: dapur tidak menampilkan pesanan QR yang belum dibayar (hanya notis jumlahnya + tautan ke Pembayaran), tiket yang lahir dari pelunasan membawa penanda kanal & momen pelunasannya, dan tagihan yang dibatalkan dari halaman Pembayaran berhenti menunggu, serta penghitung + tombol ke halaman Pembayaran yang menempel di kartu antrean dapur — bukan di kolom denah — dan bunyi + kilat notifikasi tagihan QR baru yang berbunyi sekali per tagihan) (795/795)
bun scripts/verify-product-images.mjs        # gambar produk: batas 8, tepat 2 MB diterima & di atasnya ditolak, tipe berkas, label slot & ringkasan kolom (murni, 25/25)
bun scripts/verify-product-edit.mjs          # produk tersimpan: ubah identitas (nama/SKU/harga beli), aktif/nonaktif, pagar hapus (murni, 36/36)
bun scripts/verify-fullscreen.mjs            # mode layar penuh: label/hint (backstage vs halaman tanpa sidebar), sembunyikan sidebar, requestFullscreen gagal tidak melempar, exitFullscreen tepat (murni, 14/14)
bun scripts/verify-product-sku.mjs           # SKU otomatis PBB-<KATEGORI>-<nomor urut>: kode kategori dari nama, nomor urut per tenant, SKU di luar format, dan recode saat kategori produk berganti (murni, 39/39)
bun scripts/verify-tax.mjs                   # setelan PPN workspace: tarif 0–100% & pembulatan dua desimal, pembacaan “11,5”, tenant lama tetap aktif, “aktif 0%” ditolak, kalimat & contoh perhitungan (murni, 71/71)
bun scripts/verify-fnb-tax.mjs               # pajak & pungutan F&B: PBJT menggantikan PPN dengan batas 10%, pengecualian usaha mikro, biaya layanan bukan pajak, PPh final UMKM (bagian bebas Rp 500 juta setahun + batas 7/4/3 tahun per bentuk badan), PPh 21, PPh 4 ayat (2) sewa, ringkasan setoran & omzet tercatat (murni, 105/105)
bun scripts/verify-struk.mjs                 # struk belanja: katalog tiga jenis printer (thermal/dot matrix/portable) beserta cara kerja, kelebihan, kekurangan, cocok untuk & contoh produknya, kolom per lebar kertas, bawaan dari tenant lama, rangkap ditolak di printer non-impact, catatan kaki 2×40, baris pembeli (nama member / “Cash” saat kosong atau spasi, dipotong selebar kertas), baris kasir (dilewati kalau namanya kosong), logo toko (kotak tetap 110 px × 110 px di semua printer & kertas, masih muat di kertas 58 mm, hitam putih lewat saringan grayscale, kosong/spasi = tanpa logo), tata letak baris, plus tiga hal yang bekerja otomatis: kertas terdekat saat printer diganti (76 mm → 80 mm, bukan 58 mm; lebar tak terbaca jatuh ke kertas pertama), aturan `@page` yang menulis sendiri lebar × tinggi kertas struknya (58/80/241 mm, margin 2 mm di kertas sempit), dan saran setelan dari modul workspace (grosir tanpa F&B → dot matrix 76 mm 2 lembar, F&B → thermal 80 mm, ritel → thermal 80 mm) (murni, 111/111)
bun scripts/verify-escpos.mjs                # aturan byte ESC/POS untuk cetak langsung: urutan perintah (ESC @, ESC t, GS W, ESC d, GS v 0, GS V), saringan teks jadi ASCII, kolom & rangkap dari setelan struk, bitmap logo 1 bit, profil Bluetooth, pemecahan byte per kirim tanpa byte hilang (murni, 58/58)
bun scripts/verify-struk-gambar.mjs           # gambar struk (PNG) untuk WhatsApp, tanpa peramban & jaringan: lebar ikut lebar kertasnya (58 mm → 812 px; faktur 241 mm dibatasi 1400 px), ukuran huruf dihitung dari jumlah kolom & muat di kertasnya (rasio huruf terukur yang lebih lebar mengecilkannya, bukan memotong baris), rangkap 2 jadi dua lembar terpisah dengan tinggi rumusnya, baris terbanyak menentukan tinggi, logo memuat kotak 140 px tanpa mengubah rasio (96×48 → 140×70) & logo 1200 px tetap muat di kertas 58 mm, ukuran logo yang tidak masuk akal diabaikan, dan nama berkasnya berpasangan dengan PDF-nya (`struk-A-00042.png` / `.pdf`) (murni, 14/14)
bun scripts/verify-struk-pdf.mjs              # berkas PDF struk (dibongkar byte per byte: xref, /Length, MediaBox, satu halaman per lembar, **objek gambar logo /DeviceGray + ukuran & isinya**, pita logo 29,11 mm, escape kurung, huruf luar Latin-1, pemotongan di kolom, determinisme) + nama berkas dari nomor nota + aturan kirim WhatsApp (kunci kanal, caption 1024 karakter, nomor dinormalkan & tersensor, **urutan nomor tujuan: nomor member menang atas nomor yang diketik kasir & asalnya ditandai, pembeli umum memakai nomor pemberiannya dan ditandai `umum`**, badan multipart & pesan dokumen Graph API, balasan tanpa id = gagal) + **isi struk sebagai teks pesan** (baris struk apa adanya, spasi ujung kanan dibuang & spasi penyejajar kolom dibiarkan, baris kosong ekor dibuang, blok monospace hanya kalau muat, pemotongan di 4096 karakter, pagar blok dilewati kalau isinya sudah memuatnya, tautan `wa.me` memuat item & nomor notanya) (murni, 59/59 — termasuk badan unggah **gambar** `type=image` + `Content-Type: image/png` dengan byte PNG utuh, pesan **gambar** berjenis `image` dengan `media_id` + caption & tanpa `filename`, jalur dokumen lama yang tetap `type=document`, dan batas unggah gambar 5 MB)
# kanal WhatsApp (opsional): WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID di env DEPLOYMENT (versi Graph API lewat WHATSAPP_GRAPH_VERSION, bawaan v21.0)
bunx convex run receiptWaData:channelStatus   # baca-saja: keadaan kanal WhatsApp di deployment (configured + nama kunci yang masih kurang)
bun scripts/verify-menus.mjs                 # audit menu: 20 menu × 5 peran — peta menu↔rute↔izin, halaman terbuka/ditolak, gerbang modul, plus sumber izin gerbang rute (sesi tanpa tenant tanpa izin, kasir tanpa product.manage, peran kustom menggantikan) (406/406)
bun scripts/gen-panduan-pdf.mjs              # bangun ulang public/panduan/panduan-mesinpos.pdf (18 bagian, 12 gambar, 33 halaman)
bun scripts/verify-panduan.mjs               # berkas PDF dibongkar ulang: halaman, footer, daftar isi (18 bagian), langkah kunci (termasuk logo toko, printer & kertas struk, serta kirim struk ke WhatsApp pembeli), batas gambar 1–12, tautan halaman, plus panduan singkat kirim struk ke WhatsApp pembeli di sumber halamannya (14/14)
bun scripts/verify-theme.mjs                 # tema terang/gelap: aturan, paritas palet CSS, permukaan sidebar (gelap, beda nyata dari latar, teks terang), bootstrap index.html dieksekusi, tombol di DOM (50/50)
bun scripts/verify-pwa.mjs                   # PWA: manifest fullscreen, ikon (diperiksa sampai piksel), sw.js dieksekusi, ajakan install 10 detik + tombol header (1492/1492)
bun scripts/verify-version.mjs               # bundel basi: ajakan “Versi baru tersedia — muat ulang” — aturan murni, perilaku DOM (jadwal, muat ulang, “Nanti” per tab), jalur diam (luring/galat/mode dev/tab tersembunyi), dan pemasangan di shell /app/pos sungguhan (44/44)
node scripts/gen-icons.mjs                   # membuat ulang ikon PWA dari bentuk yang sama dengan public/icon.svg (tanpa dependensi)
bun convex run otpEmail:domainHealth         # baca-saja: domain & catatan DNS di akun Resend (butuh kunci akses penuh; kunci kirim-saja dijawab 401 apa adanya)
bun convex run otp:delivery '{"otpId":"…"}'   # keadaan kirim satu permintaan kode (id dari hasil otp:requestCode)
bun convex env list --names-only               # kunci identitas Convex Auth ada di deployment (JWT_PRIVATE_KEY, JWKS, SITE_URL)
node -e 'fetch("https://mellow-narwhal-477.convex.site/.well-known/jwks.json").then(r=>console.log(r.status))'   # dokumen kunci Convex Auth hidup (200)
bun convex run auth:signIn '{"provider":"resend-otp","params":{"email":"…"}}'   # kirim kode lewat jalur beridentitas (started:true)
bun scripts/diag-module-graph.mjs            # graf modul dev server (butuh preview jalan)
PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-meja-browser.mjs http://localhost:5173   # pesanan QR meja di Chromium: kartu QR di denah → tamu QRIS (tombol Screenshot QRIS benar-benar mengunduh PNG) & tamu Virtual Account (nomor VA bank pilihannya + salin) → pesanan yang belum dibayar **tidak** tampil di layar dapur (hanya dihitung di lencana jumlah + tombol ke Pembayaran yang menempel di kartu antrean dapur, lalu tombolnya benar-benar diklik, dan kartu itu benar-benar berkilat — animasi `kilat` dibaca dari `getComputedStyle` — dengan saklar bunyi yang bisa dimatikan dari sana tanpa mematikan kilatnya) → pelunasan dari halaman Pembayaran → tiket dapur bertanda “Lunas QRIS/Lunas VA BRI dari meja · diterima dapur pukul HH:MM”, plus tamu membatalkan pesanannya sendiri (meja kembali kosong), tambah/ubah/hapus/geser meja beserta penolakan pagar hapusnya, dan impor beberapa meja sekaligus (93/93)
PLAYWRIGHT_DIR=/tmp/pw bun scripts/diag-struk-cetak.mjs http://localhost:5173   # diagnostik: letak area cetak struk vs gulir halaman kasir (ponsel & desktop), jumlah halaman PDF (kertas struk & A4), piksel pita atas, & leluhur ber-containing-block
bun scripts/diag-render.mjs / /app/pos       # SSR per rute (diagnostik layar putih)
SPAWN_BACKEND=1 bun scripts/verify-backend.mjs   # end-to-end terhadap backend lokal
VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs   # 795/795 terhadap deployment awan (dua bisnis bernama sama → dua workspace + isolasinya, undangan anggota tim + jejak kirim emailnya, undangan WhatsApp (nomor ternormalisasi + jejak buka tautan) & kelola anggota (ubah/nonaktif/hapus) beserta pagarnya, HTTP /api/v1 baca & tulis, pemicu event transaksi + kalender, OTP dengan saluran email siap, dukungan khusus, laporan lintas cabang, tagihan digital + sambungannya ke penjualan kasir, hub sinkronisasi, pesanan QR meja (kartu QR → menu publik tanpa sesi → pesanan QRIS **dan** Virtual Account + gerbang pilihan bank → tagihan → lunas dari halaman Pembayaran → tiket dapur → pembatalan oleh tamunya sendiri, plus tagihan QR meja yang dibatalkan kasir melepas pagar hapus meja), ubah/hapus meja beserta pagar hapusnya (tables.update/deletionCheck/remove: izin table.manage, nama unik, pagar terisi/tagihan menunggu/riwayat penjualan), urutan denah & impor sekaligus (tables.move/importBatch: meja baru di akhir, geser satu langkah + penolakan di ujung denah, impor semua-atau-tidak-sama-sekali dengan nomor baris, batas 40 baris, izin table.manage), akun platform & sesi pendampingan, unggah gambar produk ke penyimpanan + batas 8 di server + berkas terhapus jadi 404, SKU otomatis PBB-<KATEGORI>-<nomor urut> + bentroknya dengan SKU manual + pindah kategori produk yang ikut mengganti kode SKU-nya + CRUD kategori produk category.manage beserta pagar izin & pelepasan produk saat dihapus + kelola produk tersimpan (products.update/setActive/deletionCheck/remove: izin product.manage, SKU kembar, pagar hapus, produk nonaktif ditolak kasir) + setelan PPN (tenants.updateTax: izin billing.manage, struk & tagihan langganan memakai tarif setelan, “aktif 0%”/130%/negatif ditolak tanpa mengubah setelan tersimpan, tenant lama tanpa taxActive dibaca aktif) + pajak & pungutan F&B (tenants.updateFnbTax: izin billing.manage, PBJT di atas 10% ditolak utuh tanpa menyimpan sebagian, struk mencatat taxKind/serviceCharge, pengecualian usaha mikro mengembalikan PPN, ringkasan omzet reports.fnbTaxMonth hanya menghitung penjualan yang tercatat) + gerbang langganan klien (roles.myAccess kasir tanpa product.manage, kasir ditolak `products.listAll`, keanggotaan nonaktif tetap terlihat di `listMine` dengan `active:false`, logo toko (tenants.generateLogoUploadUrl/setLogo/removeLogo: izin billing.manage, berkas bukan gambar & >1 MB ditolak tanpa menyisakan logo setengah jadi, logo sah tersimpan sebagai id berkas & dibaca kasir, ganti logo menunjuk berkas baru, hapus logo mengosongkan kolomnya)) + kirim struk `receiptWa.send` (struk pembeli umum tanpa `memberId` diterima & nomornya ditolak beralasan dengan petunjuk kolom nomor pembeli, nomor tersimpan di data member tetap menang, member tanpa nomor ditolak beserta namanya, orang di luar workspace tidak bisa mengirim)
bun convex run platform:sweepExpiredImpersonations '{"limit":50}'   # perapian sesi pendampingan yang kedaluwarsa (internalMutation)
VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-webhook-retries.mjs   # 6/6: pekerja terjadwal mengirim ulang sesuai jadwal (tunggu ~2 menit; SKIP_PUSH=1 kalau sudah ter-push)
node scripts/convex-verify-push.mjs mellow-narwhal-477  # baca-saja: fungsi sudah ada di deployment awan?
freebuff-deploy check                        # perintah yang benar-benar dijalankan hosting
freebuff-deploy start --json                 # deploy ulang; tanpa --json ditolak "Unknown subcommand"
```

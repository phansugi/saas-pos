# Daftar kunci rahasia MesinPOS — nama, tempatnya, dan cara mencatat ulang

Halaman ini mendata **nama** kunci yang dipakai proyek ini (nilainya tidak pernah ditulis di repo),
di mana kunci itu harus ada, dan dari mana nilainya dibuat ulang kalau hilang. Dipakai bersama
[`docs/panduan-backup-github.md`](./panduan-backup-github.md): kode ada di GitHub, **rahasia tidak** —
halaman ini yang menjaga bagian itu.

Aturan yang dipakai halaman ini:

- **Nilai kunci tidak masuk repo, tidak masuk `worklog.md`, dan tidak dimasukkan ke dokumen ini.**
  Catat nilainya di pengelola kata sandi (atau brankas lain) — dokumen ini hanya menyebut namanya.
- Ada **tiga tempat** penyimpanan kunci yang berbeda; kunci yang sama bisa ada di lebih dari satu tempat
  (misalnya `RESEND_API_KEY` ada di workspace **dan** di deployment Convex).

## 1. Tiga tempat penyimpanannya

| Tempat | Dipakai oleh | Cara melihat daftar namanya | Cara mengubah |
|---|---|---|---|
| **Env workspace Freebuff** (Settings → Environment; disimpan lokal sebagai berkas env) | dev server, preview, dan skrip di workspace ini | `freebuff-env list` | Settings → Environment di Freebuff |
| **Env deployment Convex** (`mellow-narwhal-477`) | fungsi server: email, OTP, auth, webhook | `bunx convex env list --names-only` | dashboard Convex → Settings → Environment Variables, atau `bunx convex env set <NAMA> <nilai>` |
| **Env produksi hosting** | build & deploy situs produksi | `freebuff-deploy env list` | `freebuff-deploy env set '{"NAMA":"nilai"}'` |

Nilai-nilainya **tidak pernah ditampilkan kembali** oleh ketiga perintah itu — hanya namanya. Jadi kalau
nilainya hilang, satu-satunya jalan adalah membuat ulang di penyedianya (lihat bagian 4).

## 2. Kunci yang sudah terpasang (per 2026-10-15)

### a. Env workspace — 7 kunci

| Nama | Untuk apa | Wajib? |
|---|---|---|
| `CONVEX_DEPLOYMENT` | nama deployment yang dipakai CLI & skrip | wajib |
| `CONVEX_DEPLOY_KEY` | kunci deploy Convex (dipakai CLI/deploy) | wajib untuk deploy |
| `VITE_CONVEX_URL` | alamat deployment yang dipanggil aplikasi | wajib |
| `VITE_CONVEX_SITE_URL` | alamat bagian “site” (HTTP action) deployment — dipakai `scripts/build-hosted.sh` dan uji backend | wajib untuk deploy & uji HTTP |
| `VITE_DATA_SOURCE` | pilih backend: `convex` atau `demo` | wajib |
| `RESEND_API_KEY` | kirim email (OTP & undangan) dari skrip lokal | wajib untuk uji email |
| `OTP_EMAIL_FROM` | alamat pengirim email OTP | wajib untuk uji email |

### b. Env deployment Convex — 6 kunci

| Nama | Untuk apa | Wajib? |
|---|---|---|
| `JWT_PRIVATE_KEY` | kunci penanda tangan sesi Convex Auth | wajib (auth) |
| `JWKS` | kunci publik pasangannya | wajib (auth) |
| `SITE_URL` | alamat situs yang dipakai email/tautan | wajib |
| `RESEND_API_KEY` | kirim email OTP & undangan dari server | wajib untuk email |
| `OTP_EMAIL_FROM` | alamat pengirim email OTP | wajib untuk email |
| `OTP_DEV_CODE` | kode OTP tetap **hanya** untuk email uji berdomain `.test` | opsional (jangan dipakai di produksi) |

### c. Env produksi hosting — 3 kunci

| Nama | Untuk apa | Wajib? |
|---|---|---|
| `CONVEX_DEPLOY_KEY` | mengirim fungsi Convex saat deploy | wajib |
| `VITE_CONVEX_URL` | alamat deployment untuk situs produksi | wajib |
| `VITE_DATA_SOURCE` | backend yang dipakai situs produksi (`convex`) | wajib |

## 3. Kunci yang dibaca kode tetapi belum dipasang

Semuanya **opsional** — aplikasinya sengaja memberi jawaban yang jujur (“kanal belum tersambung”)
kalau kuncinya tidak ada, bukan gagal diam-diam.

| Nama | Dipakai di | Kalau tidak diisi |
|---|---|---|
| `OTP_PEPPER` | `src/convex/otp.ts`, `otpEmail.ts` | hash kode OTP hanya diikat email (tetap aman, tanpa rahasia tambahan) |
| `WHATSAPP_ACCESS_TOKEN` | `src/convex/receiptWa*.ts`, `lib/receiptWhatsapp.ts` | kirim struk ke WhatsApp menjawab “kanal belum tersambung” |
| `WHATSAPP_PHONE_NUMBER_ID` | idem | idem (keduanya harus ada) |
| `WHATSAPP_GRAPH_VERSION` | `lib/receiptWhatsapp.ts` | memakai bawaan `v21.0` |
| `XENDIT_CALLBACK_TOKEN` | `src/convex/http.ts` | callback Xendit ditolak |
| `GDCPAY_CALLBACK_TOKEN` | `src/convex/http.ts` | callback GDCPay ditolak |
| `ALLOW_UNVERIFIED_ACTOR` | `lib/auth.ts`, `lib/authz.ts`, `authEmail.ts`, `platform.ts` | bernilai `true`: panggilan tanpa identitas masih boleh (lihat Blocker #1 di `worklog.md`) |
| `CONVEX_SITE_URL` | `src/convex/auth.config.ts` | **disediakan otomatis oleh Convex**, tidak perlu diisi manual |

## 4. Kalau nilainya hilang — buat ulang dari sini

| Kunci | Dibuat ulang di |
|---|---|
| `RESEND_API_KEY` | dashboard Resend → API Keys (<https://resend.com/docs/create-an-api-key>) |
| `OTP_EMAIL_FROM` | alamat pengirim yang sudah diverifikasi di Resend (domain `send.mesinpos…`) |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | dashboard aplikasi WhatsApp Business (Meta) → API setup |
| `XENDIT_CALLBACK_TOKEN`, `GDCPAY_CALLBACK_TOKEN` | dashboard penyedianya masing-masing (dipakai `src/convex/http.ts`) |
| `JWT_PRIVATE_KEY`, `JWKS` | dibuat saat memasang provider identitas Convex Auth — **hati-hati:** menggantinya membatalkan semua sesi login yang sedang aktif |
| `CONVEX_DEPLOY_KEY`, `CONVEX_DEPLOYMENT` | dashboard Convex → Settings → Deploy keys |
| `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` | dashboard Convex → deployment `mellow-narwhal-477` |
| `OTP_DEV_CODE`, `OTP_PEPPER` | dibuat sendiri (kode uji / teks acak) |

## 5. Kunci yang **hanya** untuk skrip/alat uji (bukan rahasia produksi)

Tidak perlu dicatat untuk produksi; hanya muncul kalau seseorang menjalankan harness tertentu:
`PLAYWRIGHT_DIR`, `SPAWN_BACKEND`, `SKIP_PUSH`, `DIAG_SESSION`, `DIAG_PAGES`, `DIAG_BOUNDARY`,
`BUILD_DIAG`, `MAX_WAIT_SECONDS`, `RAW_KEY`, `PROBE_AS_TOKEN`, `PROBE_NAME`, `PUBLIC_NAMES`,
`CANONICAL_URL`, `URL_ASAL`, `SOURCE_ASAL`, `EFF_URL`, `APP_HOST`, `PORT`, `NODE_ENV`.

## 6. Cara mencatat ulang semuanya (checklist)

Kunci tidak ikut ke `bun run backup:data` (berkas itu hanya data + berkas unggahan), jadi catat begini:

1. Jalankan ketiga perintah di bagian 1 dan catat **nama** kuncinya di pengelola kata sandi
   (satu entri, mis. “MesinPOS — kunci produksi”).
2. Untuk tiap nama, isi nilainya dari penyedianya (bagian 4). Setelah tercatat, kuncinya bisa
   dibiarkan seperti sekarang — perubahannya dilakukan dari dashboard penyedianya.
3. Foto/tulis di catatan yang sama: `VITE_CONVEX_URL` + nama deployment (`mellow-narwhal-477`),
   dan nama akun pemilik repo GitHub (`phansugi/saas-pos`).
4. Simpan catatan itu **di luar workspace** (pengelola kata sandi awan), sama seperti berkas backup
   data — kalau hanya ada di komputer ini, ia hilang bersama komputernya.
5. Kalau ada kunci baru yang dipasang, tambahkan barisnya di dokumen ini (nama + tempatnya saja) supaya
   daftarnya tetap lengkap.

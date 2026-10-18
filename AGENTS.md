# Instruksi agen — repo MesinPOS (saas-pos)

## Bahasa keluaran: Indonesia saja (wajib)

Semua keluaran yang dibaca manusia di repo ini **hanya bahasa Indonesia**:

- balasan ke pengguna di chat/agen,
- entri `worklog.md`, `README.md`, dan berkas dokumentasi lain,
- komentar kode, pesan commit, dan judul pull request.

Bahasa Mandarin **tidak boleh dipakai**, walaupun model yang menjalankan sesi cenderung menjawab
Bahasa Mandarin, walaupun jawabannya panjang atau teknis, dan walaupun pengguna menulis dalam
bahasa lain. Judul bagian, label tabel, dan kalimat penutup ikut Bahasa Indonesia. Kalau keluaran
alat atau model datang dalam bahasa asing, terjemahkan dulu sebelum dikirim. Istilah teknis
(nama perintah, potongan kode, keluaran terminal apa adanya) tidak diterjemahkan; kalau potongan
output memang berbahasa asing, beri keterangan Bahasa Indonesia di sekitarnya.

## Worklog wajib (tidak opsional)

Setiap pekerjaan di repo ini **wajib** menambah **satu entri baru** di `worklog.md`, di bawah
heading `## Riwayat`, **paling atas** (terbaru dulu). Ini berlaku untuk semua jenis pekerjaan:
fitur baru, perbaikan bug, refactor, audit, maupun perubahan dokumentasi.

Entri lama **tidak dihapus dan tidak ditulis ulang**. Kalau ada koreksi terhadap entri lama,
tulis entri baru yang menyebut koreksinya.

Gunakan format yang sudah ditetapkan di bagian atas `worklog.md`:

```md
## YYYY-MM-DD — <judul singkat>
**Ruang lingkup:** apa yang diminta dan apa yang sebenarnya dikerjakan.
**Berkas:** baru: ... · diubah: ...
**Verifikasi:** perintah → hasil (sertakan angka/exit code, bukan "sudah dites").
**Catatan / blocker:** hal yang belum selesai, batasan, atau keputusan yang perlu diketahui.
```

Aturan isi entri:

- Tulis perintah verifikasinya **beserta hasilnya** — angka, exit code, atau potongan output.
- Perintah yang gagal atau tidak bisa dijalankan ditulis **apa adanya**, jangan dihilangkan.
- Bedakan jelas antara "sudah diverifikasi" dan "hanya type-checked".
- Setelah entri ditambahkan, periksa apakah tabel **Status Phase 1** dan daftar **Blocker**
  di `worklog.md` masih sesuai; perbarui kalau berubah.

Daftar perintah verifikasi rutin ada di bagian akhir `worklog.md`.

## Data uji wajib dibersihkan (tidak opsional)

Deployment dev dipakai bersama oleh aplikasi sungguhan dan harness. Setiap kali menjalankan
uji yang **menulis ke deployment** (`verify-backend.mjs`, uji CLI `bun convex run`, uji browser
yang mendirikan workspace, atau uji manual di aplikasi), sesudahnya **wajib** membersihkan akun
uji yang ditinggalkannya:

```bash
bun run bersih:uji          # akun bisnis berdomain uji, lalu baris pengguna yang yatim
```

Aturannya:

- Jalankan **sesudah** uji, bukan sebelumnya — kalau tidak, akun uji yang baru lahir tertinggal.
- Kalau uji membuat data di **produksi**, sebutkan dan bersihkan dengan cara yang sama
  (`--prod`) serta laporkan hasilnya di entri worklog.
- Jangan mengandalkan cron harian (`platform:purgeFixtureTenantsAuto` pukul 19:00 UTC dan
  `platform:purgeFixtureUsers` pukul 19:30 UTC) sebagai pengganti: cron hanya jaring pengaman.
- Yang tidak boleh dihapus: akun berdomain non-uji, akun platform (`platformRole`), workspace
  pengelola sendiri, dan siapa pun yang masih tercatat sebagai anggota workspace.
- Hasil pembersihan (jumlah akun yang dihapus, sisa yang dilewati) ditulis di entri worklog
  sebagai bagian Verifikasi — bukan sebagai klaim “sudah dibersihkan”.

## Sebelum menyatakan pekerjaan selesai

- Jalankan perintah verifikasi yang relevan dan laporkan hasil apa adanya.
- Berkas markdown saja (termasuk `worklog.md` dan `AGENTS.md`) tidak memengaruhi build/tipe —
  tulis itu di kolom Verifikasi, jangan mengaku sudah dites lebih dari yang dijalankan.

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

## Sebelum menyatakan pekerjaan selesai

- Jalankan perintah verifikasi yang relevan dan laporkan hasil apa adanya.
- Berkas markdown saja (termasuk `worklog.md` dan `AGENTS.md`) tidak memengaruhi build/tipe —
  tulis itu di kolom Verifikasi, jangan mengaku sudah dites lebih dari yang dijalankan.

# saas-pos
Software SaaS POS sistem cloud

Catatan pekerjaan ada di [`worklog.md`](./worklog.md) — setiap pekerjaan yang dikerjakan
menambah satu entri baru di bagian Riwayat berkas itu.

Backup kode ke GitHub (memberi akses, mengecualikan `isolate/`, commit, push, lalu membuktikan
isinya sama) ada di [`docs/panduan-backup-github.md`](./docs/panduan-backup-github.md) — berkas itu juga
menjelaskan cadangan **data** (tombol backup di dashboard Convex, atau satu perintah
`bun run backup:data`, lihat `scripts/backup-data.mjs`) beserta kunci rahasia yang sengaja tidak masuk repo.
Daftar **nama** kunci rahasia (env workspace, deployment Convex, produksi) beserta tempat menyimpan dan
cara membuat ulangnya ada di [`docs/daftar-kunci-rahasia.md`](./docs/daftar-kunci-rahasia.md).

## Dokumentasi API publik: `/dokumentasi-api`

Halaman **publik tanpa sesi** untuk pengembang platform mitra (mis. **pusatbahanbangunan.com**):
`/dokumentasi-api`. Tautannya ada di navigasi & footer beranda, dan dari halaman backstage
**API & Webhook** (`/app/api`). Isinya:

- **mulai cepat** (buat kunci → simpan rahasia → panggil `GET /api/v1/ping`),
- **autentikasi & scope** (header `Authorization: Bearer mp_…` atau `x-api-key`, tabel scope yang
ditawarkan beserta endpoint dan jenisnya),
- **referensi tiap endpoint** (`GET /api/v1/ping`, `GET /api/v1/sales`, `POST /api/v1/sales`,
`GET /api/v1/products`, `GET /api/v1/payables`, `GET /api/v1/purchases`) dengan parameter query
(`days`, `since`, `limit`, `cursor`), arti field balasan, contoh permintaan, contoh balasan, dan catatannya,
- **webhook keluar** (14 event, header `x-mesinpos-*`, HMAC-SHA256 atas `timestamp.body`,
contoh verifikasi Node.js, jadwal percobaan ulang 1 · 5 · 30 · 120 · 720 menit),
- **sinkronisasi berkelanjutan**: tabel kepemilikan data (MesinPOS sumber utama), langkah salinan awal →
webhook realtime → rekonsiliasi berkala, dan aturan “MesinPOS menang” supaya harga/stok tidak saling menimpa.
- **kode status 200/201/400/401/403/404/409** beserta penyebab yang biasa,
- **batas v1** (`limit` 1–100, `days` 1–30, 20 kunci hidup, 50 baris/pesanan, satu toko utama)
  dan daftar jujur hal yang **belum** tersedia lewat API,
- **rencana integrasi pusatbahanbangunan.com**: katalog (berhalaman) dari `GET /products`, pesanan
  lewat `POST /sales` dengan `idempotencyKey` = ID pesanan platform, webhook `sale.completed` /
  `purchase.received` / `stock.changed` / `product.updated` untuk perubahan realtime, serta
  `GET /sales`, `GET /purchases`, dan `GET /payables` dengan `since` untuk rekonsiliasi.

Isi halaman dibaca dari **`src/lib/apiDocs.ts`**, yang menurunkan method/path/scope tiap endpoint dari
`API_RESOURCES` (`src/convex/lib/apiKeys.ts`) dan katalog event dari `WEBHOOK_EVENTS`
(`src/convex/lib/webhooks.ts`) — jadi dokumentasi tidak bisa menawarkan endpoint yang tidak dilayani
`src/convex/http.ts`. Base URL di halaman dihitung dari `VITE_CONVEX_URL` (`.convex.cloud` → `.convex.site`),
selama deployment-nya terbaca; tanpa itu ditampilkan sebagai `https://<deployment>.convex.site`.

```bash
bun scripts/verify-api-docs.mjs   # memeriksa halaman tetap publik, semua endpoint & event terwakili,
                                  # dan setiap contoh JSON benar-benar bisa diuraikan (termasuk parseExternalOrder)
bun scripts/verify-platform-sync.mjs   # sinkronisasi platform: event harga/stok/pembelian, pemicunya di jalur
                                      # tulis domain, endpoint tarik bertahap, dan aturan “MesinPOS sumber utama”
```

## Laporan yang bisa diunduh: **PDF, Excel (`.xlsx`), CSV** — tabel **berwarna**, grafik, **dan ringkasan bahasa awam**

Halaman **Laporan** (`/app/reports`, izin `report.view`) punya kartu **Unduh laporan** di paling atas dengan
tiga tombol: **Unduh PDF**, **Unduh Excel (.xlsx)**, dan **Unduh CSV**. Berkasnya disusun **di perangkat
pengguna** (Blob + tautan `blob:`, sama seperti PDF struk di kasir) — tidak ada satu byte pun yang dikirim ke
server — dan pesan sesudahnya menyebut nama berkas yang benar-benar disimpan beserta ukurannya.

Di bawah tombolnya ada daftar **“Berkas yang sudah diunduh (n)”**: satu baris per berkas berisi **jenis berkas**
(`PDF` / `Excel (.xlsx)` / `CSV`), **nama berkas**, **ukuran**, dan **tanggal & jam unduhnya**, plus tautan
**Unduh ulang** dan **Buka**. Daftarnya urut dari yang terbaru dan **menetap di perangkat** (`localStorage`,
maksimal 8 baris): tetap ada setelah halaman dimuat ulang atau ditutup, dan bisa dikosongkan lewat tombol
**Bersihkan daftar**. URL `blob:` yang masih hidup dipakai untuk **Unduh ulang**/**Buka** byte yang sama
(di ponsel, folder unduhan peramban tidak selalu gampang ditemukan kembali). Baris dari kunjungan sebelumnya
— URL `blob:`-nya sudah mati dan **tidak** pernah ditampilkan sebagai tautan — diberi tombol **Unduh ulang**
yang menyusun berkasnya lagi dari angka yang tampil sekarang (kalau ada penjualan baru, berkas barunya ikut
memuatnya). Saat belum ada unduhan, daftarnya mengatakannya apa adanya, bukan kosong tanpa keterangan.

Sebelum tombolnya, kartu **Ringkasan singkat** di paling atas halaman Laporan menuliskan — dalam kalimat
sehari-hari — berapa yang diterima tokonya, dari berapa transaksi, dibayar pakai apa, apa yang ikut dipungut,
dan apa yang menjadi kewajiban pemiliknya. Kalimat yang sama (turun dari masukan yang sama,
`laporanRingkasanSingkat`) ikut ke dalam ketiga berkas: kotak **Ringkasan singkat** di halaman pertama PDF,
lembar **Info berkas** di Excel, dan baris `Ringkasan;…` di kepala CSV — jadi laporan bisa dikirim ke orang
yang tidak terbiasa membaca pembukuan tanpa perlu dijelaskan lebih dulu.

Tiga berkas itu digambar dari **satu** dokumen (`LaporanDocument`): judul, ruang kerja, toko, periode,
catatan, lalu daftar bagian berisi kepala kolom, baris, dan baris jumlah — **plus daftar grafik** yang
angkanya sama dengan tabelnya. Angka-angkanya datang dari hasil
aturan murni yang **sudah** dipakai halaman (ringkasan harian, pajak & pungutan F&B per bulan, analitik
lanjutan, lintas cabang), jadi berkas dan layar tidak bisa berbeda diam-diam. Selnya membawa **nilainya**,
bukan teksnya: sel uang menyimpan rupiah bulat dan sel angka menyimpan angkanya, sehingga angka di Excel &
CSV tetap angka (bisa dijumlahkan, diurutkan, dipivot) — sedangkan format `Rp1.234.567` hanya dipakai di PDF
yang memang untuk dibaca manusia.

Bedanya ketiga berkas:

- **PDF** — A4 tegak, banyak halaman, angka rata kanan, **tampilannya mengikuti halaman Laporan**: tiap
  bagian digambar sebagai **kartu putih bersudut bulat** dengan pita warna di tepi atasnya, kotak ikon kecil
  bernada bagiannya, label bernomor (“BAGIAN 3 · DARI MANA UANGNYA MASUK”), judul, keterangan, dan daftar
  isi bernomor di halaman pertama — jadi berkas yang diunduh tidak lagi terlihat seperti keluaran lain
  aplikasi. Tabelnya berwarna: kepala kolomnya pita nada tua berhuruf putih, baris isinya berpita sangat
  tipis berselang-seling, dan baris jumlahnya berpita aksen dengan garis tebal di atasnya — semuanya dari
  **satu keluarga warna per bagian** (ringkasan hijau zamrud, metode bayar hijau kebiruan, pajak & pungutan
  kuning madu, analitik biru nila/ungu, produk biru langit, lintas cabang merah muda) yang nilainya ditulis
  sekali di `src/convex/lib/laporanWarna.ts` dan dipakai bersama berkas Excel. Angka utama dicetak sebagai
  **petak berikon** (dua kolom) seperti kartu angka di layar. Warnanya ditulis dengan urutan operator PDF
  yang benar (`r g b rg`, bukan `rg r g b`) supaya pembaca PDF sungguhan benar-benar mengecatnya, dan
  semuanya digambar **tepat selebar tabelnya**. **Pita warna di tepi kartu mengikuti lengkung sudut kartunya**
  (dipotong sebagai potongan tepi kartu, bukan kotak bersudut sendiri) — jadi tidak ada garis warna yang
  menyembul keluar dari kartu — dan **kepala tabel tidak pernah tercetak dua kali** di puncak halaman
  sambungan: pengulangannya menggantikan, bukan menambah. Aturan tata letaknya dijaga harness, bukan cuma diklaim:
  tiap unit tahu kartu pemiliknya (kartu yang unitnya tidak bertanda tidak akan berangka), tinggi tiap unit
  dihitung dari isinya sendiri, tidak ada huruf yang tertimpa bentuk atau **huruf lain** (kotak huruf
  dihitung dari ukuran hurufnya: 0,25 em di bawah garis dasar sampai 0,75 em di atasnya), tidak ada tulisan
  yang melewati tepi halaman, kontras huruf terhadap latar efektifnya (pita setengah tembus pandang ikut
  ditumpuk) minimal 4,5:1, dan tiap bagian benar-benar memakai warnanya sendiri. Kepala kolom yang panjang
  turun ke baris berikutnya sebanyak yang diperlukan dan **tidak pernah dipotong jadi “TRANSAKSI…”**: lebar
  minimum kolom mengikuti kata terpanjang di kepalanya. Huruf di luar Latin-1 (tanda pisah panjang, tanda
  kutip melengkung) diterjemahkan ke ASCII, bukan berubah jadi `?`. **Grafiknya batang vektor berwarna**
  yang digambar di bawah tabel bagiannya: tetap tajam saat dicetak & difotokopi, angkanya ikut tercetak di
  atas batang selama muat di kolomnya sendiri, dan tiap grafik menuliskan *jumlah titik batang & nilai
  tertingginya* sebagai kalimat — jadi isinya tidak hilang di pembaca yang teksnya saja (pembaca layar,
  penyalinan teks).
- **Excel** — `.xlsx` **asli** (paket OOXML + arsip ZIP tanpa pemadatan, ditulis sendiri di
  `src/convex/lib/laporanXlsx.ts`; bukan CSV yang diberi nama `.xls`, yang selalu memunculkan peringatan
  format berkas). Satu lembar per bagian laporan — `Info berkas`, `Ringkasan periode`, `Omzet per metode
  bayar`, `Pajak & pungutan F&B per bulan`, lima lembar analitik (termasuk `Tren omzet harian`), `Temuan`,
  dua lembar lintas cabang — dengan rupiah berformat `#,##0`, desimal `0.00`, dan kepala kolom + baris jumlah
  dicetak tebal. **Tabelnya berwarna juga, satu keluarga warna per bagian** (sumber yang sama dengan PDF):
  tiap lembar dibuka baris judul berhuruf **putih tebal di atas pita nada tua bagiannya** (pitanya dilebarkan
  sampai kolom terakhir tabelnya), kepala kolomnya pita nada tua berhuruf putih dengan bingkai tipis, baris
  isinya berselang-seling pita sangat tipis, dan baris jumlahnya pita aksen bergaris tebal senada — gaya itu
  disusun per **peran sel** (7 peran × 3 jenis angka × 8 keluarga warna = 168 format sel). Kepala kolomnya
  **dibekukan** (`pane ySplit=2`) dan tabelnya bisa **disaring** (`autoFilter`, keterangan di bawah tabel
  sengaja di luar rentangnya). Bagan Excel-nya juga ikut berwarna: tiap batangnya bernada menurut tingginya
  (`laporanWarnaBatang`) dan judul bagannya senada bagiannya.
  **Grafiknya bagan Excel asli**: tiap grafik dapat lembar datanya sendiri (`Grafik - …`)
  dengan bagan di sebelahnya yang **menunjuk ke sel-sel itu** (`'Grafik - Omzet per jam'!$B$3:$B$25`), jadi
  mengubah angkanya langsung menggerakkan batangnya — bukan gambar tempelan.
- **CSV** — pemisah **titik koma** (koma sudah dipakai untuk desimal, jadi berkasnya langsung terbagi ke
  kolom di Excel Indonesia), BOM UTF-8 (tanpa itu huruf beraksen jadi sampah di Windows), CRLF, dan kutip
  ganda hanya untuk sel yang memuat pemisah/kutip/baris baru: nama produk seperti `Semen "Gresik" 40kg;
khusus` tetap **satu** sel. Setiap bagian dibuka baris judulnya dan baris jumlahnya diberi label “Jumlah” —
dan ringkasannya ikut sebagai baris `Ringkasan;…` di kepala berkas (format CSV tidak punya tempat untuk
warna atau grafik).

Grafik batang ikut untuk **omzet per metode bayar, tren omzet harian, omzet per jam, produk teratas, omzet
tercatat per bulan, dan omzet per cabang**. Grafik yang datanya masih kosong **tidak** dipaksakan muncul
(grafik rata tanpa batang hanya membuat berkasnya tampak lebih lengkap daripada isinya), sedangkan tabelnya
tetap ada dengan kalimat “Belum ada data pada periode ini.”. CSV sengaja tetap **tabel saja** — format itu
memang tidak punya tempat untuk grafik, dan grafiknya sudah ada di PDF & Excel dari angka yang sama.

**Halaman Laporannya sendiri berwarna per bagian** — bukan hanya isi berkasnya. Tujuh bagiannya (ringkasan,
angka utama, metode bayar, unduhan, pajak & pungutan, analitik, lintas cabang) masing-masing punya nadanya
sendiri — emerald · sky · teal · indigo · amber · violet · rose — dan nada itu dipakai konsisten pada pita
tepi kartu, kotak ikon, label bagian, kepala kolom tabel, baris selang-seling, baris jumlah, sampai pil di
**peta bagian** di kepala halaman (tujuh pil yang melompat ke bagiannya). Empat angka utama berikon, batang
omzet per metode bayar & per kategori memakai **satu warna per baris**, dan temuan dibedakan kuning (perlu
ditindak) / hijau (kabar baik) / biru (keterangan). Warnanya dijaga terukur, bukan hanya terpasang: pita
kepala kolom memakai warna **solid tingkat 700** karena tulisan putih di atas nada 500/600 diukur hanya
3,19:1, dan `verify-laporan-browser.mjs` memastikan tulisan kepala kolom & judul tiap bagian tetap ≥ 4,5:1
serta pil **peta bagian** benar-benar memindahkan pandangan ke bagiannya (`main` ikut bergulir, bukan cuma
hash di URL yang berubah).

Yang tidak dimuat paket atau peran tidak dihilangkan diam-diam: kepala berkas menyebutkan bahwa analitik
lanjutan atau laporan lintas cabang tidak disertakan, bagian yang datanya belum ada tetap muncul dengan
kalimat “Belum ada data pada periode ini.”, dan kartunya menyebut bagian apa saja yang ikut sebelum tombol
ditekan. Isinya mengikuti apa yang tampil di halaman: ringkasan **hari ini**, analitik **30 hari terakhir**
(sesuai pemilih periode), pajak & pungutan **12 bulan terakhir**, dan lintas cabang **30 hari terakhir** —
bukan ekspor baris penjualan mentah.

```bash
bun scripts/verify-laporan.mjs             # 263/263: tiga bagian enterprise baru (proyeksi, ukuran keranjang, pasangan produk) diperiksa sebagai **angka & keterangan** di model dokumen, **judulnya benar-benar tercetak** di aliran isi PDF, dan **lembar Excel-nya** benar-benar dibuat; plus seluruh cek lama: CSV dibaca ulang (kutip & pemisah), arsip .xlsx dibongkar ulang dari byte-nya (CRC, header lokal, metode pemadatan, nama lembar, sel angka, escape XML, gaya per peran sel per **keluarga warna bagian** + warna kepala kolom tiap bagian dihitung ulang dari `laporanWarna.ts` + cacah bagian gaya (`fonts`/`fills`/`borders`/`cellXfs`) cocok dengan isinya + kepala dibekukan + autoFilter, **rantai bagan** lembar → gambar → bagan + rujukan selnya), grafik (titik & bagiannya, label sumbu dijarangkan, grafik kosong tidak dipaksakan), PDF (offset xref, /Length, /Count, /MediaBox A4, angka ber-pemisah ribuan, paginasi 120 baris, dan **pembaca aliran isi halaman**: isian & garis dibaca sebagai bentuk beserta **kepekatannya** — kartu putih bersudut bulat di tiap halaman, tiap unit bertanda kartu, kepala kolom tidak terpotong, pita per peran baris selebar tabelnya, **pita tepi tidak keluar dari lengkung kotaknya** (jalur tiap pita ditelusuri titik demi titik lalu diuji di dalam jalur kotaknya), **kepala tabel hanya sekali per halaman** saat tabelnya menyambung, batang bagan vektor bernada, tidak ada huruf tertimpa bentuk ataupun **huruf lain** dengan kotak huruf sebenarnya (0,25–0,75 em), tidak ada tulisan keluar tepi halaman, kontras huruf ≥ 4,5:1 di atas latar efektif yang ditumpuk, dan **warna per bagian benar-benar berbeda & tergambar di aliran isi**), ringkasan bahasa awam (diturunkan dari masukan yang sama, ikut ke CSV/Excel/PDF), nama berkas (murni)
PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-laporan-browser.mjs   # 38/38: tiga tombol ditekan di Chromium sungguhan — berkasnya benar-benar tersimpan di disk, namanya laporan-<toko>-<waktu>.<ext>, tanda awal/akhir sesuai; **warna tabelnya diukur dari `getComputedStyle`** (pita kepala kolom, baris selang-seling, pita baris jumlah, jarak dalam sel) + kartu ringkasan; **tulisan kepala kolom & judul tiap bagian harus terbaca di atas latarnya (kontras ≥ 4,5:1**, latar efektif ditelusuri sampai akar) + **pil peta bagian yang benar-benar menggulir ke bagiannya**; **berkas PDF yang benar-benar tersimpan dibaca ulang**: kotak huruf tiap baris teks (dari operator `Tf`-nya) tidak boleh saling menimpa di halaman yang sama; **daftar unduhan** memuat tiga baris dengan jenis, nama, ukuran & tanggalnya, **“Unduh ulang” yang benar-benar mengunduh lagi**, dan setelah halaman **dimuat ulang** daftarnya tetap ada serta tombol **Unduh ulang** baris lamanya benar-benar menyusun berkas sah
bun scripts/verify-render.mjs              # 929/929: kartu unduhan + ketiga tombol diklik di DOM tiruan; berkas yang diserahkan ke peramban diperiksa jenis & isinya (PDF: `%PDF-`, rangka kartu putih `1 1 1 rg`, judul bagan tercetak, ≥ 6 warna pita, ≥ 40 bentuk terisi; Excel: PK\x03\x04 + `xl/charts/chart1.xml`; CSV: BOM + “Metode bayar”), plus baris daftar unduhan (jenis/nama/ukuran/tanggal, urut terbaru)
PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-mobile-overflow.mjs   # 181/181: kartu unduhan & daftar riwayatnya tidak terpotong di lebar 320–414 px
```

Batas yang jujur: berkas `.xlsx` hasil unduhan **sudah** diperiksa alat di luar repo
(`unzip -t` → “No errors detected”, lalu `zipfile` + `xml.etree.ElementTree` Python membaca bagian-bagiannya —
termasuk **`xl/charts/chartN.xml`**: jenis bagan `col`, `ptCount` yang cocok, rumus rujukan sel lembar datanya,
dan gambar tempelnya — semuanya XML yang sah), tetapi **belum pernah dibuka di Excel/Windows, LibreOffice,
maupun pembaca PDF sungguhan** — yang terbukti untuk PDF adalah strukturnya (offset xref, `/Length`,
`/Count`, `/MediaBox`), batangnya yang digambar di aliran isinya, dan tata letaknya yang diukur (lebar
tiap pita, urutan menggambar, tinggi unit terhadap isinya, **jalur pita tepi di dalam jalur lengkung
kotaknya**, tidak ada huruf tertimpa bentuk maupun huruf
lain, kontras ≥ 4,5:1, dan koordinat tiap teks masih di dalam tepi halaman). “Enak dilihat menurut mata manusia” **belum** diperiksa
mata; yang sudah diperiksa sebagai gantinya: warna tabel **di halaman Laporan** diukur dari `getComputedStyle`
di Chromium (pita kepala kolom, baris selang-seling, pita baris jumlah, jarak dalam sel).
Sekali waktu berkas PDF yang diunduh juga **dirender ulang dengan `pdf.js`** (dipasang di `/tmp/pw`, mandiri,
bukan perintah rutin repo) untuk mengukur tepi pita terhadap tepi lengkung kartunya dari piksel — hasilnya
tercatat di `worklog.md`; perintah rutin di atas tetap memeriksa **geometri jalur** di aliran isi halaman,
bukan piksel.

## Mengisi stok & panduan operasional

Dua kemampuan yang paling dicari saat memulai - membuat produk pertama dan mengisi stoknya - ada di
halaman **Produk & Stok**:

- **Tambah produk** (`products.create`, izin `product.manage`): nama, SKU (opsional — kolom yang
  dikosongkan berarti dibuat otomatis, lihat *SKU otomatis* di bawah), kategori, harga jual, harga
  beli, satuan dasar, dan **stok awal** dalam satu form. Stok awal
  ditulis server sebagai pergerakan beralasan `adjustment` (catatan “Stok awal”), jadi angka
  pertamanya punya jejak ledger.
- **Sesuaikan stok** (`products.adjustStock`, izin `stock.adjust`): penyesuaian per baris produk
  dengan jumlah positif/negatif dan catatan; saldo negatif ditolak server dengan pesan yang menyebut
  stok tersedia, dan stok yang jadi ditampilkan sebelum disimpan.

Dua jalur itu melengkapi jalur ketiga yang sudah ada: **penerimaan barang (GRN)** di halaman
Pembelian (`purchase.receive`), tempat stok masuk dari supplier ke lokasi yang dipilih. Ringkasan
ketiganya, plus langkah lengkap dari masuk sampai menjual, ada di halaman **Panduan**
(`/app/panduan`, izin `report.view`) dan di berkas PDF yang bisa diunduh dari halaman itu:
`public/panduan/panduan-mesinpos.pdf` (19 bagian, 12 gambar ilustrasi vektor, 35 halaman — termasuk
panduan pembelian mendalam, panduan opname mendalam, setelan PPN, printer & kertas struk beserta
cetak langsung ESC/POS-nya, **kirim struk ke WhatsApp pembeli** sebagai bagian 18, dan **jam
operasional & pemberitahuan ke pemilik toko** sebagai bagian 19).

```bash
bun run panduan:pdf                # bangun ulang PDF panduan (scripts/gen-panduan-pdf.mjs, pdfkit)
bun scripts/verify-panduan.mjs     # 14/14: halaman, footer, daftar isi (19 bagian), langkah kunci (43 → 62 frasa, termasuk izin `shift.manage` di bagian 10, izin `kds.manage` di tabel bagian 13, 6 frasa bagian 18, dan 7 frasa bagian 19), batas gambar (1–12), tautan halaman, plus panduan singkat kirim struk ke WhatsApp pembeli di sumber halamannya
```

Selain berkas PDF-nya, halaman **Panduan** memuat **panduan singkat kirim struk ke WhatsApp pembeli**
(kartu `panduan-kirim-struk`): kasir membuka halaman ini dari sidebar saat baru memakainya, sedangkan
pratinjau PDF-nya sering tidak tampil di ponsel. Isinya mengikuti perilaku yang benar-benar ada di layar
kasir — langkahnya (selesaikan pembayaran → tentukan nomornya → tekan kirim & baca laporannya), apa yang
sampai ke pembeli (**satu gambar struk PNG berlogo**, tampil sebagai foto), yang perlu disiapkan (nomor
member atau nomor yang diketik kasir untuk pembeli umum, izin `pos.sell`, dan kunci
`WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` di lingkungan **deployment** — Settings → Environment,
atau `bunx convex env set …`), serta jalan lain saat
kanalnya belum tersambung (tautan `wa.me` yang membawa isi struknya, **Bagikan gambar struk**, atau
**Unduh PDF**). Tautannya langsung ke kasir (`/app/pos`) dan ke setelan struk (`/app/settings`), dan
kartunya menyebut bahwa ringkasan yang sama ada di PDF sebagai **bagian 18** — jadi isi halaman dan berkas
PDF-nya tidak bisa berbeda diam-diam.

## SKU otomatis (`PBB-<KATEGORI>-<nomor urut>`)

Kolom SKU di form **Produk baru** boleh dibiarkan **kosong**: yang membuat kodenya adalah store atau
server, bukan tebakan halaman. Formatnya `PBB-<KATEGORI>-<nomor urut>`, contoh `PBB-SAN-000042`:

- `PBB` prefix tetap perusahaan (satu konstanta, `PRODUCT_SKU_PREFIX`),
- `SAN` tiga huruf dari nama kategori ("Sanitasi" → `SAN`); produk tanpa kategori memakai `UMU`,
- `000042` nomor urut enam digit yang berjalan **sekali untuk seluruh tenant**, jadi dua kategori
  berbeda tidak pernah menerima nomor yang sama.

Di sebelah kolom SKU ada tombol **Buat otomatis**. Tombol itu mengisi kolomnya lebih dulu — dari
SKU yang sudah ada, memakai aturan yang sama (`suggestProductSku`) — supaya pemilik toko bisa
melihat & mengubahnya sebelum menyimpan. Tombolnya mati selama kolomnya terisi: SKU yang diketik
pemilik toko dipakai **apa adanya** (huruf dan spasinya tidak diubah).

**Kategori menentukan kode di tengah SKU, jadi mengganti kategori mengganti kodenya.** Di form
Produk baru, selama isi kolom SKU berasal dari tombol **Buat otomatis**, memilih Kategori lain
langsung memperbarui SKU-nya (nomor urutnya tidak berubah); begitu kolomnya diketik sendiri, isi itu
tidak pernah ditimpa.

Untuk produk yang **sudah ada**, kategori diubah dari kolom **Kategori** di kartu **Atur harga**
(tersimpan bersama tombol Simpan harga). `products.setCategory` lalu menyesuaikan SKU lewat
`recodeProductSku`: kode kategorinya diganti, nomornya dipertahankan selama bebas — kalau nomor itu
sudah dipakai di kategori tujuan, nomor berikutnya yang bebas dipakai supaya perubahan kategori tidak
pernah gagal — dan SKU yang **diketik pemilik toko** (di luar format `PBB-…`, mis. `KOPI-01`) tidak
disentuh sama sekali. Halaman memberi tahu apa yang terjadi dari balikan server (`PBB-SAN-000042` →
`PBB-MAK-000042`, atau “SKU diketik sendiri, jadi tidak ikut berubah”).

Nomor final selalu datang dari pihak yang menyimpan. `products.create` memakai counter per tenant
(`counters`, jenis `product.sku`) yang naik sekali per produk, lalu mencocokkan hasilnya dengan SKU
yang sudah ada — SKU manual berformat sama (mis. `PBB-SAN-000042` yang diketik sendiri) tidak
ditabrak, counter-nya hanya maju. Notis setelah menyimpan menyebut SKU final itu, bukan tebakan
klien. Mode demo memakai aturan yang sama di `createProduct` (`src/lib/store/demo.tsx`).

Aturannya murni dan dipakai bersama di `src/convex/lib/productSku.ts` (halaman Produk & Stok, kedua
store, backend, harness).

```bash
bun scripts/verify-product-sku.mjs            # 39/39: format, kode kategori dari nama, nomor urut, recode saat kategori berganti (murni)
bun scripts/verify-render.mjs                 # 832/832: tombol Buat otomatis, simpan dengan kolom SKU kosong & SKU ikut kategori (form + kartu edit) diklik di DOM tiruan
VITE_CONVEX_URL=https://<deployment>.convex.cloud bun scripts/verify-backend.mjs   # 837/837: SKU otomatis & pindah kategori di server — counter naik, bentrok dilewati, SKU manual utuh
```

## Kategori produk: menambah, mengubah, menonaktifkan, menghapus (`category.manage`)

Kategori bukan sekadar label: namanya menentukan **kode di tengah SKU** dan **susunan tab di kasir**.
Karena itu pengelolaannya dipegang salah satu izin tersendiri, bukan menempel pada `product.manage`:

| Peran | `product.manage` (isi rak) | `category.manage` (struktur katalog) |
| --- | --- | --- |
| Pemilik / Manajer | ✅ | ✅ |
| Staf Gudang | ✅ | ❌ |
| Kasir / Keuangan | ❌ | ❌ |

Staf gudang tetap bisa membuat & mengubah produk (dan **memakai** kategori yang aktif di form produk),
tetapi menambah, mengganti nama, menonaktifkan, atau menghapus kategori hanya bisa dilakukan
pemilik/manajer. Di halaman Produk & Stok, peran tanpa izin itu hanya melihat daftar kategorinya
beserta catatan “butuh peran manajer/pemilik” — tombolnya tidak ditawarkan sama sekali, dan server
tetap menolak kalau URL/aksi dipaksakan (`requirePermission` di `src/convex/categories.ts`).

Letaknya: halaman **Produk & Stok → kartu “Kategori produk”** (di atas tabel produk). Kartu itu
menampilkan nama, **kode SKU** kategori, jumlah produk yang memakainya, dan status aktif/nonaktifnya.

### Aturannya (satu tempat, `src/convex/lib/categories.ts`)

- **Nama 2–40 karakter, unik per workspace** — pembandingnya mengabaikan huruf besar dan pemisah,
  jadi “Kopi Susu” dan “kopi  susu” adalah kategori yang sama (spasi pinggir & ganda dirapikan).
- **Nama “Tanpa kategori” ditolak.** Kalimat itu sudah berarti “produk ini tidak punya kategori” di
  tabel produk, pemilih kategori, dan `productSkuCategoryCode`; kategori bernama itu akan membuat
  produk tanpa kategori dan produk berkategori itu tidak bisa dibedakan lagi.
- **Maksimal 100 kategori per workspace**, supaya pemilihnya tetap bisa dibaca.
- **Menonaktifkan ≠ menghapus.** Kategori nonaktif hilang dari pemilih kategori produk baru, dan
  `products.create` / `products.setCategory` **menolak** kategori nonaktif — tetapi produk yang sudah
  memakainya tetap dijual, tetap muncul di tabel produk (ditandai “kategori nonaktif”), tetap ada di
  kartu **Atur harga**-nya sebagai pilihan bertanda `(nonaktif)`, dan **tabnya tetap ada di POS**
  (`posCategoryChips` = kategori aktif + kategori yang masih dipakai produk). Menonaktifkan selalu
  bisa dibatalkan dengan satu tombol.
- **Hapus kategori melepas produknya.** `categories.remove` menghitung dulu berapa produk yang
  memakainya, melepas `products.categoryId`-nya (produk itu menjadi “Tanpa kategori”), lalu menghapus
  baris kategorinya. Produknya **tidak** ikut terhapus dan **SKU-nya tidak ditulis ulang** — jumlah
  produk yang dilepas disebut di konfirmasi sebelum menghapus, di notis sesudahnya, dan di jejak audit.
- **Ganti nama kategori tidak menulis ulang SKU.** Produk tidak berpindah kategori, jadi SKU-nya tetap
  sah (nomornya tetap unik). Yang berubah adalah kode untuk produk **berikutnya**: “Sanitasi” →
  “Sanitasi & Kebersihan” tetap `SAN`, sedangkan “Kopi” → “Pangan” mengubah `KOP` → `PAN`. Halaman
  mengatakan itu apa adanya (`skuCodeChanged` dari server), bukan mengklaim SKU lama ikut berubah.
- **Kode SKU yang bentrok diberitahukan, bukan dilarang.** “Makanan” dan “Makmur” sama-sama `MAK`;
  SKU tetap unik karena nomor urutnya per tenant, tetapi kartu kategori menampilkan peringatan itu.

Bentuk datanya: `categories` (`tenantId`, `name`, `sortOrder`, `active`, `createdAt`) — `active`
sengaja **opsional** supaya baris kategori yang dibuat sebelum kolom ini ada tetap sah dan dianggap
aktif. Mutationnya: `categories.create`, `categories.rename`, `categories.setActive`,
`categories.remove`; daftarnya dibaca lewat `tenants.listCategories` (cukup keanggotaan), karena
pemilih kategori di form produk dan tab POS dipakai semua peran yang bekerja dengan katalog.

```bash
bun scripts/verify-categories.mjs              # 35/35: nama terlarang & kembar, kode SKU, kategori nonaktif, tab POS, dampak hapus (murni)
bun scripts/verify-authz.mjs                    # 92/92: izin kategori ada di pemilik/manajer, bukan gudang/kasir/keuangan
bun scripts/verify-render.mjs                   # 832/832: tambah/ubah/nonaktifkan/hapus kategori benar-benar diklik di DOM tiruan (+ tab POS & gerbang izin staf gudang)
VITE_CONVEX_URL=https://<deployment>.convex.cloud bun scripts/verify-backend.mjs   # 837/837: CRUD kategori di server — izin ditolak untuk kasir/gudang, kategori nonaktif ditolak produk baru, hapus melepas produk tanpa mengubah SKU
```

## Produk tersimpan: ubah, aktif/nonaktifkan, hapus (`product.manage`)

Produk yang sudah tersimpan bisa dirapikan dari halaman **Produk & Stok**, di kolom **Aksi** baris
produknya. Tiga hal yang sengaja dipisahkan dari **Atur harga**:

- **Ubah identitas** — nama, SKU, dan harga beli disunting di kartu **Atur harga**
  (`products.update`, izin `product.manage`) dan disimpan bersama tombol **Simpan harga**. Kolom ini
  **tidak** menyentuh harga jual, konversi satuan, atau modifier: memperbaiki salah ketik nama tidak
  boleh ikut mengubah harga. SKU tetap unik per workspace, pembandingnya mengabaikan huruf
  besar-kecil (`kopi-01` dan `KOPI-01` di satu katalog hanya menyesatkan pembaca), dan SKU yang sudah
  ada dipakai **apa adanya** — hurufnya tidak dipaksa. Kalau tidak ada kolom yang benar-benar berubah,
  tidak ada audit maupun notis yang ditulis.
- **Aktif/nonaktifkan** (`products.setActive`, izin `product.manage`). Nonaktif berarti produk itu
  berhenti dijual: `products.listByStore` (katalog kasir) hanya mengembalikan yang aktif, dan
  `pos.createSale` **menolak** produk nonaktif — jadi “nonaktif” bukan sekadar tampilan. Datanya tetap
  utuh: stok, riwayat penjualan, kartu **Atur harga**, dan tabel produk tetap memuatnya (bertanda
  **Nonaktif**) sehingga bisa diaktifkan kembali kapan saja. Halaman membaca katalog lengkapnya lewat
  `products.listAll` (izin `product.manage`, termasuk yang nonaktif), sedangkan kasir tetap memakai
  `products.listByStore`.
- **Hapus** (`products.remove`, izin `product.manage`) — **hanya** untuk produk yang belum dipakai
  apa pun. Pagarnya `products.deletionCheck`, yang menghitung dari data sebenarnya: stok yang masih
  tercatat (lokasi jual + gudang), baris penjualan, pergerakan stok, dokumen pembelian (permintaan, PO,
  penerimaan, tagihan supplier), dan sesi opname. Produk yang pernah terjual atau masih berstok
  **ditolak** dengan alasan satu per satu — tawarannya adalah **Nonaktifkan saja**, bukan menghapus
  riwayat orang lain. Saat produknya memang layak dihapus, yang ikut dibuang hanya baris stoknya (yang
  semuanya nol) dan berkas gambarnya.

Bedanya dengan **hapus kategori**: kategori dihapus dengan **melepas** produknya (produk jadi “Tanpa
kategori”, SKU tidak ditulis ulang), sedangkan produk dihapus hanya kalau tidak ada jejak yang akan
menggantung. Karena itu halaman menampilkan hasil pemeriksaan server sebelum tombol Hapus ditekan,
sehingga produk yang sebenarnya hanya berhenti dijual langsung diarahkan ke tombol yang benar.

Aturannya murni dan dipakai bersama di `src/convex/lib/productEdit.ts` (halaman Produk & Stok, kedua
store, backend, harness).

```bash
bun scripts/verify-product-edit.mjs           # 36/36: batas nama, bentuk & kembarnya SKU, harga beli, kalimat aktif/nonaktif, pagar hapus (murni)
bun scripts/verify-render.mjs                 # 832/832: ubah nama/SKU/harga beli, nonaktifkan/aktifkan, dialog hapus berpagar, dan gambar produk di kartu kasir & keranjang diklik di DOM tiruan
VITE_CONVEX_URL=https://<deployment>.convex.cloud bun scripts/verify-backend.mjs   # 837/837: products.update/setActive/deletionCheck/remove di server — izin, SKU kembar, pagar hapus, produk nonaktif ditolak kasir
```

## Gambar produk (maksimal 8 per produk)

Setiap produk bisa punya gambar, **maksimal 8** per produk (satu berkas maksimal 2 MB, format JPG/PNG/WebP).
Diatur langsung di **kartu produk** pada halaman Produk & Stok:

- kartu **Produk baru** punya bagian **Gambar** — berkas yang dipilih ditahan dulu (beserta pratinjaunya)
  dan diunggah begitu produknya disimpan, karena `products.addImage` butuh id produk;
- kartu **Atur harga** (edit produk yang sudah ada) punya bagian yang sama, dan di sana unggahan serta
  penghapusan gambar **langsung** tersimpan tanpa menekan “Simpan harga”;
- kolom **Gambar** di tabel produk menampilkan thumbnail gambar utama beserta lencana `n/8`;
- **kasir** (`/app/pos`) menampilkan gambar utama sebagai thumbnail di kartu produk dan di baris
  keranjang — produk yang namanya mirip jadi gampang dibedakan di depan pembeli. Produk yang belum
  difoto memakai penanda “belum ada gambar”, dan kalau katalog yang sedang tampil belum punya satu pun
  foto, kartunya kembali ringkas (tanpa kotak gambar kosong). Gambarnya sengaja **tidak** disalin ke
  simpul pesanan: URL dilewatkan apa adanya ke `<img>`, dan `loading="lazy"` menjaga grid tetap ringan
  di katalog besar.

Penyimpanannya id berkas, bukan URL: kolom `products.images` berisi `Id<"_storage">`, dan URL bertanda
sign dibuat ulang setiap query dijalankan (`products.listByStore` mengembalikan `images: [{ id, url }]`).
URL berkas Convex punya masa berlaku, jadi URL yang disimpan ke DB akan menjadi gambar mati.

Alur unggahnya mengikuti pola tiga langkah Convex dan dijalankan lewat store, bukan langsung dari halaman:

1. `products.generateImageUploadUrl` (izin `product.manage`) mengembalikan URL unggah sekali pakai,
2. klien mem-POST berkasnya ke URL itu,
3. `products.addImage` menautkan `storageId`-nya ke produk — di titik ini batasnya diperiksa **lagi**:
   maksimal 8 gambar, dan metadata `_storage` (tipe + ukuran) harus lolos `lib/productImages.ts`. Berkas
yang ditolak langsung dihapus supaya tidak menumpuk sebagai sampah penyimpanan.

Gambar diperkecil di klien sebelum dikirim (`prepareProductImage`: sisi terpanjang 1200 px, JPEG mutu
0,82), karena foto dari kamera ponsel biasanya 3–8 MB padahal thumbnail-nya hanya beberapa puluh piksel.
PNG dengan transparansi diratakan ke latar putih. `products.removeImage` melepas gambar dari produk
**dan** menghapus berkasnya (URL lamanya langsung 404).

Di **mode demo** tidak ada penyimpanan berkas, jadi gambarnya hidup di memori sebagai data URL — sama
seperti state demo lain, dan ikut hilang saat halaman dimuat ulang. Batas 8 gambar serta aturan tipe/ukuran
berlaku sama di kedua mode karena keduanya memakai `src/convex/lib/productImages.ts`.

```bash
bun scripts/verify-product-images.mjs          # 25/25: batas 8, tipe & ukuran berkas, label slot (murni)
bun scripts/verify-product-sku.mjs             # 39/39: format SKU otomatis PBB-<KATEGORI>-<nomor urut> + recode saat kategori berganti (murni)
bun scripts/verify-render.mjs                  # 832/832: unggah/hapus gambar, SKU otomatis & SKU ikut kategori diklik di DOM tiruan (kartu Produk baru & Atur harga), plus gambar produk di kartu kasir & baris keranjang
VITE_CONVEX_URL=https://<deployment>.convex.cloud bun scripts/verify-backend.mjs   # 837/837: unggah sungguhan ke penyimpanan, batas 8 di server, berkas terhapus (404), SKU otomatis & pindah kategorinya
```

## PPN workspace: tarif bisa diatur & bisa dimatikan (`billing.manage`)

PPN bukan angka tetap di dalam kode lagi. Setelannya hidup di baris tenant (`tenants.taxActive`,
`tenants.taxRatePct`) dan diatur dari halaman **Pengaturan** (`/app/settings`):

- **Tarifnya bisa diubah besar/kecil** — 0–100%, boleh desimal ("11,5" sama dengan "11.5"),
  dibulatkan ke dua angka di belakang koma supaya tidak ada `11,000000000000002` di UI. Tombol
  5% / 11% / 12% mengisi tarif yang sering dipakai, dan contoh perhitungan di sebelah kolomnya
  menunjukkan akibatnya dalam rupiah (belanja 100.000 → nilai PPN → total) sebelum disimpan.
- **Bisa diaktifkan/dinonaktifkan** — dimatikan berarti **tidak ada PPN sama sekali** di struk
  penjualan berikutnya (baris PPN-nya hilang di keranjang kasir, bukan menampilkan nol) dan di
  tagihan langganan workspace itu. Tarifnya tetap tersimpan, jadi menyalakannya lagi memakai angka
  yang sama — dan mematikan PPN tidak pernah menulis ulang riwayat.
- **Aktif dengan tarif 0% ditolak.** "PPN 0%" dan "PPN tidak aktif" adalah dua hal berbeda bagi
  pembaca struk; kalau keduanya menghasilkan angka yang sama, setelannya tidak bisa dibaca ulang
  dengan yakin. Pesannya menyarankan mematikan PPN-nya kalau memang tidak memungut pajak.
- **Izinnya `billing.manage`** (pemilik, manajer, keuangan) — setelan ini mengubah angka uang di
  setiap dokumen, dan kasir/staf gudang tidak ditawari mengubahnya; server tetap menolak kalau
  aksinya dipaksakan. Setiap perubahan (dan hanya yang benar-benar berubah) menulis jejak audit
  `tenant.tax` berisi setelan sebelum & sesudahnya.

**Satu setelan, semua dokumen.** `pos.createSale` mencatat `tax` dan `taxRatePct` dari tarif efektif,
`billing.createInvoice` memungut angka yang sama, dan kasir serta halaman Langganan membaca setelan
yang sama lewat store (`tax` di `StoreApi`) — jadi satu workspace tidak pernah menampilkan dua angka
PPN yang berbeda. Tarif efektif dihitung di satu tempat (`effectiveTaxRatePct`: nol saat dimatikan)
dan **tarif yang tercatat di struk adalah tarif saat penjualan itu terjadi**, sehingga struk lama tetap
utuh setelah setelannya diubah.

Baris tenant yang dibuat sebelum kolom `taxActive` ada tetap sah dan **dianggap aktif** (pola yang
sama dengan `categories.active`): mematikan pajak diam-diam untuk tenant lama jauh lebih berbahaya
daripada membiarkannya seperti sebelumnya. Aturannya murni dan dipakai bersama di
`src/convex/lib/tax.ts` (halaman Pengaturan, kasir, kedua store, `tenants.updateTax`, `pos.createSale`,
`billing.createInvoice`, dan harness).

```bash
bun scripts/verify-tax.mjs                     # 71/71: tarif besar/kecil, pembacaan “11,5”, tenant lama tetap aktif, “aktif 0%” ditolak, kalimat & contoh perhitungan (murni)
bun scripts/verify-render.mjs                  # 832/832: setelan PPN diklik di DOM tiruan — ubah tarif, aktif 0% ditolak, matikan PPN, lalu baris PPN di kasir & tagihan langganan mengikuti; 12% menghasilkan total 31.360 untuk belanja 28.000
bun scripts/verify-backend.mjs                 # 837/837: tenants.updateTax di server — izin billing.manage, struk & tagihan langganan memakai tarif setelan, penolakan tidak menyentuh setelan tersimpan
```

## Pajak & pungutan F&B: PBJT, biaya layanan, dan kewajiban pusat (`billing.manage`)

PPN saja tidak cukup untuk kafe/restoran. Halaman **Pengaturan → kartu “Pajak & pungutan F&B”**
mengatur empat hal sekaligus, semuanya di baris tenant (`tenants.fnbTaxProfile`) dan dipakai bersama
oleh kasir, struk, dan ringkasan setoran bulanan:

1. **PBJT makanan dan/atau minuman — pajak daerah** (pengganti istilah lama Pajak Restoran/PB1).
   Tarifnya mengikuti Perda kabupaten/kota dan **dibatasi 10%** (angka di atas itu ditolak server
   dengan alasan batasnya). Dipungut dari pelanggan di struk, lalu disetor ke kas daerah (Bapenda)
   setiap bulan.
2. **Pengecualian usaha mikro** — usaha kecil di bawah batas omzet Perda (mis. DKI Jakarta:
   Rp 42.000.000 per bulan) boleh tidak dipungut PBJT. Batasnya bisa disetel sendiri, dan halaman
   menampilkan peringatan begitu **omzet bulan berjalan melewati batas itu** — bukan diam-diam
   berhenti mengecualikan atau diam-diam tetap mengecualikan.
3. **Biaya layanan (service charge)** — 5–10% dari harga makanan, kebijakan internal yang dibagikan
   sebagai insentif karyawan (SE-04/BW/1999). Ia **bukan pajak**: barisnya sendiri di struk,
   terpisah dari baris pajak, dan di ringkasan setoran ia tidak pernah dicampur ke setoran negara.
   Sebagian Perda menghitung pajak setelah biaya layanan — itu bisa dicentang.
4. **Kewajiban pajak pusat pengusaha** — tidak ada satu sen pun yang ditambahkan ke struk pelanggan:
   - **PPh final UMKM 0,5%** (PP No. 55 Tahun 2022) dihitung dari omzet bruto bulanan, lengkap dengan
     bagian bebas Rp 500 juta setahun untuk orang pribadi dan batas waktu 7 tahun (orang pribadi),
     4 tahun (CV/Firma/Koperasi), 3 tahun (PT);
   - **PPh Pasal 21** — kewajiban menahan pajak atas gaji karyawan (angkanya dicatat di luar aplikasi);
   - **PPh Pasal 4 ayat (2)** — pemotongan 10% dari nilai sewa tanah/bangunan tempat usaha.

**PBJT menggantikan PPN, bukan menambahnya.** Selama PBJT berlaku untuk penjualan itu, PPN pusat
**tidak** dipungut — memungut dua-duanya berarti pelanggan membayar dua pajak untuk satu gelas kopi.
Kalau keduanya sama-sama dinyalakan, kasir mengatakan alasannya apa adanya (barang kemasan pabrik
tetap kena PPN dan sebaiknya dicatat terpisah). Struk mencatat **jenis pajaknya** (`sales.taxKind`:
`regional`/`ppn`/`none`), tarifnya, dan biaya layanannya (`sales.serviceCharge`) — jadi struk lama
tetap bisa dibaca setelah setelannya diubah.

**Laporan pajak & pungutan F&B per bulan** ada di halaman **Laporan → kartu “Pajak & pungutan F&B
per bulan”**: 12 bulan terakhir untuk **seluruh toko** workspace — setelan PBJT, biaya layanan, dan
PPh final UMKM adalah setelan **workspace**, jadi menghitung satu cabang saja akan mengecilkan angka
setoran yang sebenarnya. Tiap barisnya memisahkan apa yang **dipungut dari pelanggan** (PBJT, PPN,
biaya layanan) dari apa yang menjadi **kewajiban pengusaha** (PPh final UMKM 0,5% + PPh 4 ayat (2)
sewa), lengkap dengan catatan per bulan tentang ke mana uangnya pergi: PBJT disetor ke kas daerah
(Bapenda), PPN lewat jalur pajak pusat, dan biaya layanan bukan setoran negara sama sekali. Baris
“Jumlah” menjumlahkan kolomnya, dan bulan tanpa penjualan tetap tampil sebagai nol — bukan hilang.

Angka tiap bulan dijumlahkan dari yang **tercatat di struk bulan itu** (`tax`, `taxKind`,
`serviceCharge`), bukan dari tarif yang berlaku sekarang: mengubah setelan hari ini tidak menulis
ulang bulan lalu, dan struk lama tetap bisa dibaca. Penjualan yang dibatalkan (`void`) dan pesanan
tertahan (`held`) tidak pernah dihitung. Kuerinya `reports.fnbTaxMonths` (seluruh workspace, lewat
indeks `sales.by_tenant_created`), sedangkan **ringkasan setoran bulan ini** di halaman Pengaturan
diturunkan dari baris terakhir tabel yang sama (`fnbCurrentMonthSummary`) — jadi ringkasan setoran dan
tabel laporan tidak pernah memakai dua angka berbeda. Angkanya perkiraan dari data aplikasi — halaman
menyebutnya begitu, bukan mengaku sebagai perhitungan pajak resmi.

Profilnya divalidasi **seluruhnya** sebelum disimpan (`validateFnbTaxProfile`): batas 10% untuk PBJT &
biaya layanan, “aktif 0%” ditolak, batas omzet mikro harus lebih dari nol, tahun mulai PPh final UMKM
tidak boleh di masa depan — dan setelan yang tidak lolos **tidak disimpan sebagian**. Workspace yang
belum pernah mengaturnya dibaca sebagai bawaan tanpa pungutan F&B, jadi perilaku lamanya (PPN saja)
tidak berubah. Izinnya sama dengan setelan PPN: `billing.manage` (pemilik, manajer, keuangan), dengan
jejak audit `tenant.fnb_tax` berisi setelan sebelum & sesudahnya.

Aturannya murni dan dipakai bersama di `src/convex/lib/fnbTax.ts` (halaman Pengaturan & halaman
Laporan, kasir, kedua store, `tenants.updateFnbTax`, `pos.createSale`, `reports.fnbTaxMonths`, dan
harness).

```bash
bun scripts/verify-fnb-tax.mjs                 # 126/126: PBJT menggantikan PPN, batas 10%, biaya layanan bukan pajak, bagian bebas Rp 500 juta & batas waktu 7/4/3 tahun, PPh 4(2), ringkasan setoran, laporan pajak per bulan (omzet/PBJT/PPN/biaya layanan, void dilewati, bulan nol, bulan berjalan)
bun scripts/verify-render.mjs                  # 832/832: PBJT 10% + biaya layanan 7% diklik di DOM tiruan — tersimpan di workspace, struk kasir 28.000 → 32.760, “aktif 0%” ditolak, pengecualian usaha mikro & peringatan batas omzet, plus kartu laporan pajak F&B 12 bulan di halaman Laporan
bun scripts/verify-backend.mjs                 # 837/837: tenants.updateFnbTax di server — izin billing.manage, struk mencatat taxKind/serviceCharge, PBJT menggantikan PPN, pengecualian mikro, dan reports.fnbTaxMonths dari penjualan tersimpan (void hilang dari laporan, bulan sebelumnya nol)
```

Panduan PDF (`/app/panduan`) masih memuat bagian PPN yang lama; bagian pajak F&B ada di README ini dan
langsung di kartunya di halaman Pengaturan.

## Struk belanja: jenis printer, lebar kertas, rangkap, catatan kaki (`billing.manage`)

Struk bukan satu-satunya keluaran aplikasi ini, tetapi satu-satunya yang **keluar dari mesin yang
dipilih pemilik toko**. Kartu **Struk belanja** di halaman Pengaturan (`/app/settings`) mengatur
bentuknya, dan yang disetel di sana benar-benar mengubah apa yang tercetak dari tombol cetak di kasir
(`/app/pos`) — bukan label di halaman saja.

**Tiga jenis printer struk yang ditawarkan, masing-masing dengan cara kerjanya sendiri:**

| Jenis | Cara kerja | Kelebihan | Kekurangan | Kertas | Rangkap |
| --- | --- | --- | --- | --- | --- |
| **Thermal** | elemen pemanas membakar lapisan kimia kertas thermal | sangat cepat, tidak berisik, tanpa tinta/pita | hasil cetak bisa memudar kena panas atau minyak | 58 mm (32 kolom), 80 mm (48 kolom) | 1 lembar |
| **Dot matrix** | jarum-jarum kecil (pinhead) memukul pita karbon ke kertas | bisa **rangkap** (tembusan karbon) & tahan panas | mesinnya bising, cetaknya lebih lambat | 76 mm (40 kolom), 241 mm (80 kolom) | sampai 3 lembar |
| **Portable (Bluetooth)** | printer thermal kecil, baterai isi ulang, tersambung ke ponsel/tablet | ringkas, praktis untuk transaksi tanpa kabel | kapasitas gulungan kertas lebih kecil | 58 mm (32 kolom) | 1 lembar |

Kartunya juga menyebut **cocok untuk** dan **contoh produknya** (mis. Epson TM-T82X / Sano P58B untuk
thermal, Epson TM-U220 untuk gulungan 76 mm), karena justru kelebihan & kekurangan itulah yang
menentukan pilihan pemilik toko — termasuk kabar buruknya, supaya tidak baru diketahui setelah
mesinnya dibeli.

Empat hal yang sengaja diputuskan di satu tempat (`src/convex/lib/struk.ts`):

- **Rangkap mengikuti kemampuan printernya.** Printer thermal & portable **tidak bisa** tembusan
  karbon: permintaan lebih dari satu lembar **ditolak** server dengan alasan yang menyebut printer dot
  matrix, dan tombol `+` di halaman menutup sendiri saat printernya bukan impact. Kontrol rangkap di
  halaman pun menjelaskan kenapa.
- **Lebar kertas dibatasi per jenis printer.** “80 mm” di printer portable 58 mm akan terpotong di
  kertas; pilihannya hanya yang benar-benar didukung mesin itu. Mengganti jenis printer memindahkan
  lebarnya sendiri ke **kertas terdekat yang didukung** (`nearestReceiptPaper`) — 76 mm di dot matrix
  yang pindah ke thermal jadi 80 mm, bukan 58 mm yang paling sempit — dan kalau jaraknya sama, yang lebih
  lebar menang, supaya nama produk tidak gampang terpotong. Setelan yang tidak didukung tetap **ditolak**
  saat disimpan.
- **Nama produk panjang dibungkus, bukan dipotong.** 58 mm hanya memuat 32 karakter per baris, jadi
  “Kopi Susu Gula Aren Large” dilanjutkan ke baris berikutnya (paling banyak 2 baris, sisanya dipotong
  dengan penanda `...`) supaya jumlah & harganya tetap lurus di kolom kanan.
- **Penanda rangkap hanya muncul kalau memang ada rangkap.** Satu lembar tidak dicap “ASLI”; begitu
  `copies > 1`, tiap lembar dicetak dengan penanda `ASLI` / `TEMBUSAN 1…` untuk arsip.

**Saran setelan otomatis** duduk paling atas kartu itu, sebelum ketiga katalog — satu jawaban untuk
“printer apa yang saya butuhkan” beserta alasannya, dihitung dari **modul yang benar-benar hidup** di
workspace itu (`suggestReceiptSetting` di `src/convex/lib/struk.ts`). Dasarnya modul, bukan paket
langganan: yang menentukan bentuk nota adalah apa yang dijual tokonya, bukan berapa yang dibayarnya per
bulan.

- **Grosir tanpa F&B** → **dot matrix 76 mm, 2 lembar**: nota tempo ditandatangani & diarsipkan, jadi
tembusan karbonnya bernilai — dan tembusan itu hanya bisa di printer berpita.
- **F&B** (termasuk kafe yang sekaligus grosir) → **thermal 80 mm, 1 lembar**: nama menu & catatan
pesanannya panjang (48 kolom per baris), sementara meja kasirnya tetap melayani pembeli langsung.
- **Ritel/UMKM biasa** (atau workspace yang belum mengaktifkan modul apa pun) → **thermal 80 mm, 1
lembar**, ukuran thermal yang paling banyak dipakai kasir ritel.

Saran itu **ditawarkan, bukan ditulis sendiri ke setelannya** — peramban tidak punya API untuk mendeteksi
printer yang terpasang, dan memilih jalur dot matrix untuk toko grosir yang mesin kasirnya thermal membuat
struknya tidak keluar sama sekali. Lencananya menyebut dasar penentuannya (mis. `Modul Grosir &
Wholesale`), alasan yang bisa dibaca pemilik toko, dan satu tombol **Pakai saran ini** yang mengisi pilihan
mesinnya (printer, kertas, rangkap) — catatan kaki yang sedang diketik tidak ikut diubah. Saat pilihan
mesinnya sudah sama dengan saran, tombolnya membaca **Sudah sesuai** dan ikut terkunci. Yang benar-benar
otomatis tanpa bertanya adalah yang tidak menyangkut mesin fisik: lebar kertas menyesuaikan jenis printer
yang dipilih (`nearestReceiptPaper`), rangkapnya dipangkas ke kemampuan printernya (`clampReceiptCopies`),
dan ukuran halaman di dialog cetak (`receiptPrintCss`).

Catatan kaki struk (mis. ucapan terima kasih atau nomor WhatsApp) juga diatur di kartu itu: paling
banyak **2 baris × 40 karakter**, dan dikosongkan berarti memang tanpa catatan kaki. Pratinjau di
halaman menampilkan struk yang **benar-benar akan tercetak** — selebar kertas yang dipilih (58/76/80/241
mm di layar), satu blok per lembar rangkap, dengan baris pajak & biaya layanan yang dihitung aturan yang
sama dengan kasir (`orderTotal`), jadi contohnya tidak pernah berbeda dari struknya.

Penyimpanannya di baris tenant (`tenants.receipt`), kolomnya **opsional**: workspace yang belum pernah
mengaturnya dibaca sebagai bawaan **thermal 80 mm, satu lembar** — yaitu perilaku sebelum setelan ini
ada. Izinnya `billing.manage` (pemilik, manajer, keuangan), sama dengan setelan PPN & pajak F&B, karena
kartunya hidup di halaman Pengaturan yang memang dijaga izin itu; penyimpanan yang tidak mengubah apa pun
tidak menulis jejak audit, dan yang berubah meninggalkan `tenant.receipt` berisi setelan sebelum &
sesudahnya.

Di kasir, tombol **Cetak struk** mencetak area `[data-testid="struk-cetak"]` yang di layar disembunyikan
(`.struk-cetak` di `src/index.css`): saat `@media print` aktif, seluruh aplikasi disembunyikan dan hanya
struknya yang tampil dari sudut kiri atas kertas, dengan lebar `<pre>` mengikuti lebar kertas yang
dipilih. Area cetak itu **`position: fixed`** (di mode cetak), bukan `absolute` — dan itu perbaikan bug
nyata yang dilaporkan pengguna: `.struk-cetak` hidup di dalam `<main>` yang setinggi layar & bisa digulir,
jadi elemen `absolute` ikut tergeser oleh gulir halaman kasir. Di ponsel (390×844, `<main>` tergulir
1.156 px) akibatnya struk yang keluar hanya **ekornya** — TOTAL/Bayar/Kembali — tanpa logo, nama toko,
alamat, maupun baris kasir & pembeli, dan pada gulir penuh berkas PDF-nya jadi halaman kosong
(1.109 byte vs 27.798 byte pada keadaan yang sama tanpa gulir). `fixed` mengacu ke kotak halaman cetak,
bukan ke wadah gulir, jadi letaknya tidak lagi bergantung pada posisi gulir; syaratnya tidak ada leluhur
yang membuat containing block (`transform`/`filter`/`backdrop-filter`/`perspective`/`contain`) — itu
ikut dijaga harness, jadi menambahkan pembungkus beranimasi di atas halaman kasir akan ketahuan. **Ukuran kertas di dialog cetak juga tidak perlu dipilih lagi:** halaman kasir menulis aturan
`@page` dari setelan workspace (`receiptPrintCss` di `src/convex/lib/struk.ts`, dirender sebagai
`<style data-testid="struk-kertas-css">`), jadi dialognya terbuka dengan kertas selebar struknya
(58/76/80/241 mm) dan setinggi isi notanya — bukan A4 yang menyisakan halaman kosong. Tingginya dihitung
angka (`receiptPrintHeightMm`, lembar rangkap & logo ikut dihitung), bukan `size: 80mm auto` yang **tidak
sah** menurut CSS Paged Media dan dibuang peramban tanpa pesan; ukuran huruf & tinggi barisnya ditulis dari
konstanta yang sama (`RECEIPT_PRINT_FONT_MM`/`RECEIPT_PRINT_LINE_MM`), dan kertas sempit (≤ 60 mm) memakai
margin 2 mm supaya 32 kolomnya tidak makin sempit. Tombolnya menyebut printer, lebar kertas, dan jumlah
lembarnya di `title`.

Struknya selalu menyebut **pembelinya** di baris `Member`: nama member yang dipilih kasir saat bayar, dan
**`Cash`** kalau tidak ada member yang dipilih (pembeli umum). Bawaannya ada di aturan murni
(`receiptBuyerName` + `RECEIPT_WALK_IN_NAME` di `src/convex/lib/struk.ts`), bukan di halaman kasir — jadi
pratinjau di Pengaturan dan kertas yang keluar dari printer tidak pernah berbeda soal nama pembelinya.
Nama yang cuma berisi spasi dihitung belum dipilih, dan nama yang lebih panjang dari kertasnya dipotong
selebar kolom.

Di bawahnya ada baris **`Kasir`** dengan nama pengguna yang sedang melayani (dari sesi yang dipakai
mencetak); kalau namanya tidak diketahui, barisnya dilewati — struk tidak mencetak “Kasir : -”.

**Logo toko** diunggah di kartu yang sama (`tenants.logo`, izin `billing.manage`) dan tercetak di atas nama
usaha pada **setiap** lembar struk. Berkasnya tersimpan sebagai id berkas di penyimpanan Convex — bukan URL
bertanda tangan yang bisa kedaluwarsa — dan ukurannya **tetap**: kotak **110 px × 110 px**
(`RECEIPT_LOGO_SIZE_PX`), bukan lagi selebar kertas. 110 px ≈ 29 mm, jadi logonya masih muat di kertas
tersempit (58 mm) tanpa mendorong nama usaha & daftar barangnya ke halaman berikutnya — dan kertas faktur
241 mm tidak lagi memakai logo raksasa. Warnanya dipaksa **hitam putih** oleh `RECEIPT_LOGO_FILTER`
(`grayscale(1) contrast(1.35)`): printer struk cuma punya satu warna tinta, jadi logo berwarna yang dicetak
apa adanya keluar sebagai bercak kelabu yang tidak menyerupai teks di sekitarnya; saringan itu dipakai di
pratinjau Pengaturan **dan** di area cetak kasir, jadi yang dilihat pemilik toko = yang keluar di kertas.
Di mode demo logonya hidup sebagai data URL di sesi, jadi masih terpasang setelah halaman dimuat ulang.

Logo yang sama dipakai di tiga tempat dari satu sumber (store): **sidebar** kiri sebagai penanda workspace
(ikon bawaan kalau belum ada logo), **halaman Panduan** sebagai kartu identitas workspace, dan **struk**.
Panduan PDF-nya ikut mendokumentasikannya di bagian 16 beserta gambar 10, dan setelan printer &
kertas struknya di bagian 17 beserta gambar 11 & 12.

### Cetak langsung dari kasir: ESC/POS lewat USB & Bluetooth (`peripheral.escpos`)

Struk tidak lagi harus lewat **dialog cetak peramban**: halaman kasir mengirim sendiri byte perintah
**ESC/POS** ke printernya, lewat **USB (WebUSB)** atau **Bluetooth (Web Bluetooth)** — tanpa memasang
program apa pun di komputer kasir. Jaringan sengaja tidak didukung: printer LAN memakai TCP port 9100,
dan halaman web tidak punya cara membuka socket mentah.

- **Aturan byte-nya murni & diuji sendiri** (`src/convex/lib/escpos.ts`, dijaga
  `scripts/verify-escpos.mjs`): `ESC @` → `ESC t 0` → `GS W` (lebar = kolom × 12 dot: 58 mm = 384,
  80 mm = 576, 76 mm = 480, faktur 241 mm = 960) → teks per lembar → `ESC d` (umpan, dan jarak antar
  lembar tembusan di kertas kontinu) → `GS V 0` (potong, **hanya** printer thermal) →
  `ESC p 0 25 250` (laci kas, **hanya** kalau pembayarannya tunai).
- **Teksnya disaring jadi ASCII** (`escposSafe`): aksen dibuang (`é`→`e`), tanda tipografi dipetakan ke
  bentuk ASCII-nya (`“ ” – · … × ° ≠` → `" - - ... x o !=`), karakter kendali dibuang, dan sisanya `?` —
  lalu tiap baris dipotong selebar kertasnya (`escposLine`), karena printer tidak membungkus baris
  sendiri dan penyaringan itu bisa memanjangkan baris.
- **Logo** dicetak sebagai raster `GS v 0` sebesar 29 mm (sama dengan jalur cetak peramban), dipadatkan
  1 bit per piksel dengan lebar dibulatkan ke kelipatan 8; printer berpita melewatinya dan struknya
  tetap keluar.
- **Transportnya di `src/lib/escposDevice.ts`** (dipakai hook `src/lib/useEscpos.ts`): endpoint USB
  dicari dari descriptor perangkat (bulk-out, interface kelas printer lebih dulu daripada vendor), dan
  karakteristik BLE dicari dari lima profil yang dikenal (ISSC, 18F0/2AF1, FF00/FF02, HM-10, NIIMBOT).
  Byte dipecah 16 KiB sekali kirim di USB dan 100 byte berjeda 25 ms di Bluetooth (MTU BLE 23 byte),
  dan `getDevices()` dipakai untuk menyambung ulang **tanpa dialog**.
- **Batasannya dikatakan di layar, bukan disembunyikan:** butuh Chrome/Edge (desktop untuk USB &
  Bluetooth, Android untuk Bluetooth) dan halaman HTTPS; di Windows printer USB perlu driver WinUSB.
  Di Firefox/Safari tombol cetak langsungnya tidak muncul dan dialog cetak peramban tetap jadi jalurnya
  (`escposSupport().reason`).
- **Kegagalan tidak jatuh ke dialog cetak peramban**: struk yang keluar dua kali harus disobek,
  sedangkan yang belum keluar masih bisa dicetak ulang. Pesan galatnya diterjemahkan dari `DOMException`
  (`escposErrorMessage`): “Tidak ada printer USB yang dipilih”, “Izin ke printer … ditolak peramban”,
  “Peramban menolak permintaan ini karena halaman bukan HTTPS …”, dst.

bun scripts/verify-escpos.mjs                  # 58/58: urutan perintah (ESC @, ESC t, GS W, teks, ESC d, GS V, ESC p), saringan teks ASCII & pemotongan selebar kertas, raster logo 1 bit + pembulatan lebar ke kelipatan 8, kemampuan per jenis printer (potong & logo), pemecahan byte per jalur (USB 16 KiB / Bluetooth 100 byte), profil GATT yang dikenal + saringan USB, dan terjemahan galat peramban (murni)
# PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-escpos-browser.mjs http://localhost:5173
#   26/26: perangkat USB & Bluetooth **tiruan** dipasang di Chromium — tombol Sambungkan benar-benar
#   memanggil requestDevice dengan saringan kelas printer & vendor, memilih alternate, dan meng-claim
#   interface-nya; tombol Cetak ke printer benar-benar mengirim byte ke endpoint USB dan **tidak**
#   memanggil `window.print` sekali pun; jalur Bluetooth meminta lima profil + memecah byte per ≤ 100
#   byte dengan isi yang sama; peramban tanpa WebUSB/Web Bluetooth menjelaskan sebabnya dan tetap bisa
#   mencetak lewat dialog peramban; pemilih perangkat yang ditutup dijelaskan apa adanya & tidak
#   diam-diam beralih ke dialog cetak
bun scripts/verify-struk.mjs                   # 111/111: katalog tiga printer (cara kerja/kelebihan/kekurangan/cocok untuk/contoh produk), kolom per lebar kertas, bawaan dibaca dari tenant lama, rangkap ditolak di thermal/portable, catatan kaki 2×40, baris pembeli (nama member / “Cash” saat kosong atau spasi, dipotong selebar kertas), baris kasir (dilewati kalau namanya kosong), logo (kotak tetap 110 px × 110 px di semua printer & kertas, masih muat di 58 mm, hitam putih lewat saringan grayscale, kosong/spasi = tanpa logo), tata letak baris (bungkus nama, nominal rata kanan, TOTAL, penanda ASLI/TEMBUSAN), kertas otomatis (yang tak didukung menyesuaikan ke **kertas terdekat**: 76 mm → 80 mm, 241 mm → 80 mm, dot matrix 80 mm → 76 mm, portable 80 mm → 58 mm; lebar tak terbaca jatuh ke kertas pertama), aturan cetak `receiptPrintCss` yang menulis ukuran kertasnya sendiri per lebar (80 mm margin 4 mm, portable 58 mm margin 2 mm, dot matrix 241 mm dua lembar) beserta pembulatan tinggi notanya, dan saran setelan dari modul workspace (`suggestReceiptSetting`: grosir tanpa F&B → dot matrix 76 mm dua rangkap beralasan tembusan, F&B → thermal 80 mm (kafe yang sekaligus grosir ikut jalur thermal, bukan jalur faktur), ritel/workspace kosong → thermal 80 mm satu lembar, catatan kaki bawaan tetap, plus pembanding pilihan mesin yang sengaja mengabaikan catatan kaki)
bun scripts/verify-render.mjs                  # 832/832: kartu struk diklik di DOM tiruan — unggah/hapus logo (data URL di sesi, kotak 110 px × 110 px hitam putih di pratinjau & di setiap lembar struk kasir, tidak ikut melebar saat kertasnya 241 mm), logo yang sama sebagai penanda workspace di sidebar (ikon bawaan sebelum ada logo) & kartu identitas di halaman Panduan, pindah printer & kertas (pratinjau 48/40/80 kolom), rangkap 2 menampilkan lembar TEMBUSAN, catatan kaki tersimpan, thermal memangkas rangkap, kartu saran setelan otomatis (toko grosir disarankan dot matrix 76 mm dua rangkap — lencana dasarnya menyebut modulnya, alasannya terbaca, dan menekan “Pakai saran ini” memindahkan pilihan mesin tanpa menghapus catatan kaki yang sedang diketik, lalu tombolnya membaca “Sudah sesuai”), plus struk yang dicetak kasir memakai setelan yang sama, termasuk baris pembeli “Member : Cash” yang berganti jadi nama member begitu kasir memilihnya dan baris kasir “Kasir : Uji Struk”
bun scripts/verify-backend.mjs                 # 837/837: tenants.updateReceipt & logo toko di server — izin billing.manage (kasir ditolak), rangkap ditolak di thermal, lebar tak didukung ditolak, catatan kaki >2 baris ditolak, berkas bukan gambar & >1 MB ditolak tanpa meninggalkan logo setengah jadi, logo sah tersimpan sebagai id berkas & dibaca kasir, ganti logo menunjuk berkas baru, hapus logo mengosongkan kolomnya
```

Di **browser sungguhan** (Chromium/Playwright, `PLAYWRIGHT_DIR` di luar repo) lebar pratinjau, logo, & aturan
cetaknya diukur dari keadaan yang dihitung peramban sendiri:

```bash
# PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173
#   100/100: pratinjau benar-benar 80 mm & 241 mm di layar, logo diunggah lewat input berkas (PNG dari
#   canvas peramban, 96 px terbaca) lalu tampil 110 px × 110 px hitam putih di atas nama usaha (tetap
#   110 px saat kertasnya jadi 241 mm) dan bertahan setelah muat ulang, logo yang sama jadi penanda
#   workspace di sidebar kiri & tampil di halaman Panduan (badge 19 bagian · 12 gambar, plus kartu
#   panduan singkat kirim struk ke WhatsApp pembeli yang benar-benar terlihat beserta kedua tautannya), kartu saran
#   setelan otomatis tampil di Chromium (lencana “Modul F&B” & mesin yang disarankan terbaca, catatan
#   kertas menyebut lebar yang menyesuaikan sendiri saat printer diganti) dan menekan “Pakai saran ini”
#   benar-benar memindahkan setelannya (printer thermal terpilih, pilihan kertas 241 mm hilang, pratinjau
#   jadi 80 mm, rangkapnya 1 lembar, tombolnya terkunci membaca “Sudah sesuai”), baris pembeli
#   berubah dari “Member : Cash” ke nama member begitu kasir memilihnya, lima tombol pecahan uang
#   dirender & muat di dalam dialog pembayaran (menekan Rp 100.000 mengisi kolom, menandai pilihannya,
#   dan menghitung kembaliannya), struk kasir memuat logo + “Kasir : Uji Struk”, area cetak tersembunyi
#   di layar, dan saat media cetak aktif hanya struknya yang terlihat (sidebar & header hidden) — logo
#   yang dicetak diukur ulang dari piksel tangkapan layarnya: selisih kanal maksimum 0 (hijau #14532d →
#   abu-abu murni), termasuk halaman PDF sungguhan yang dihasilkan dari struk itu — lalu dialog struk
#   sesudah lunas: unduhan PDF sungguhan dibaca kembali (nama, header, 2 halaman, isi), member tanpa nomor
#   WA ditahan beserta sebabnya, dan kirim ke WhatsApp dilaporkan apa adanya; keranjang yang belum
#   dibayar belum menawarkan Cetak/Struk & kirim, dan sesudah lunas panelnya menyebut nota mana yang
#   sudah dibayar; ditutup dengan keadaan **ponsel 390×844 yang halamannya tergulir**: area cetaknya
#   harus tetap mulai dari sudut kiri-atas kertas (`position: fixed`, bukan tergeser gulir −1.092 px
#   seperti sebelum diperbaiki), tidak ada leluhur yang mengikat `fixed` (transform/filter/contain),
#   seluruh lembar & logonya muat di kertas, struk yang tercetak memuat logo + nama usaha +
#   “Kasir : Uji Struk” + “Member : Cash” + barangnya (bukan cuma ekor TOTAL/Bayar/Kembali), dan berkas
#   PDF yang keluar saat halaman tergulir **sama persis** (byte & halaman) dengan yang keluar saat
#   halaman belum tergulir; kertas A4 bawaan jasa cetak ponsel juga tetap satu halaman — dan berkas PDF
#   yang benar-benar terunduh memuat logonya: objek gambar /DeviceGray 96 × 48 (tidak diperbesar, isinya
#   dicocokkan piksel per piksel dengan logo yang diunggah), satu salinan untuk lembar rangkap.
#   Di ponsel, **dialog struknya sendiri** juga diperiksa pada layar pendek (360×720): kartunya dibatasi
#   setinggi layar, isinya benar-benar bisa digulir, kontrol terbawahnya terjangkau setelah digulir sampai
#   bawah, dan baris judul + tombol tutupnya tetap terlihat menempel di atas — sebelum diperbaiki isinya
#   963 px (239 px di luar layar) dan tombol terakhirnya tidak terjangkau sama sekali. Alur dapurnya juga
#   diperiksa: dialog struk yang baru terbuka menyebut pesanannya sudah dikirim ke dapur, dan notanya
#   benar-benar menunggu di halaman **Dapur & Meja** — antreannya memuat pesanannya dan tiketnya
#   menandai sendiri penjualannya lunas beserta cara bayarnya (100/100)
```

## Pembayaran tunai: tombol pecahan uang Rp 10.000 … Rp 500.000

Dialog pembayaran di kasir (`/app/pos` → **Bayar**) menyediakan **lima tombol pecahan** tepat di bawah
kolom `Uang diterima`: **Rp 10.000, Rp 20.000, Rp 50.000, Rp 100.000, dan Rp 500.000** (konstanta
`CASH_QUICK_AMOUNTS` di `src/pages/PosPage.tsx`, di samping daftar metode bayarnya).

- **Satu ketukan mengisi kolomnya.** Pecahan yang sedang terpakai ditandai aktif (latar utama +
  `aria-pressed`) supaya jelas uang mana yang sedang dihitung kembaliannya; baris `Kembalian` dan tombol
  **Selesaikan pembayaran** mengikuti seketika.
- **Tombolnya mengisi, bukan mengunci.** Kolom `Uang diterima` tetap bisa diketik sendiri untuk uang yang
  bukan pecahan pas (mis. Rp 55.000), dan selama uangnya belum cukup tombol simpannya tetap terkunci.
- **Muncul hanya di pembayaran tunai penuh.** Pilihannya hidup bersama kolom `Uang diterima`, jadi tidak
  ditawarkan saat metode QRIS/Kartu yang dipilih atau saat pembayarannya sebagian (tempo) — di jalur itu
  nominal yang diserahkan bukan uang tunai.
- **Yang tercetak ikut pilihan itu.** Nominalnya masuk ke struk sebagai baris `Bayar` beserta
  `Kembali`-nya (aturan murni `receiptDocument`), jadi angka di kertas sama dengan yang dihitung kasir.
- **Tombol tutup dialognya kini berlabel** (`aria-label="Tutup pembayaran"`, sebelumnya ikon tanpa nama)
  supaya pembaca layar — dan harness peramban — bisa menyebutnya.

```bash
bun scripts/verify-render.mjs                  # 832/832: lima tombol pecahan diklik di DOM tiruan — Rp 10.000 (belum cukup: kembalian Rp 0 & tombol simpan terkunci) → Rp 100.000 (cukup: kembalian, TOTAL/Bayar/Kembali di struk sementara, tombol simpan terbuka), kolom tetap bisa diketik sendiri, dan penjualan Tunai tercatat sebesar totalnya
# PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173   # mode data apa pun
#   → tombol pecahan diukur di Chromium sungguhan: kelima labelnya dirender Rp 10.000 … Rp 500.000 dan
#     semuanya muat di dalam dialog (tidak meluber di panel 380 px), menekan Rp 100.000 mengisi kolom
#     “Uang diterima”, menandai pilihannya aktif, membuka tombol simpan, dan kembaliannya > Rp 0 —
#     lalu pembayarannya diselesaikan: dialog struk terbuka (tanpa mencetak apa pun), dan nota yang ada di
#     area cetak saat itu adalah penjualan yang baru lunas (No. nota, barang, TOTAL, Bayar, Kembali) (93/93)
```

## Struk: cetak, unduh PDF, atau kirim ke WhatsApp member

Begitu penjualan tercatat, kasir tidak lagi dilempar ke dialog cetak peramban: yang terbuka adalah
**dialog struk** dengan tiga pilihan, dan kasir memilih apa yang diminta pembelinya. Berlaku untuk setiap
jalur yang mencatat penjualan: **tunai** (dialog **Bayar**), kartu/tempo, dan QRIS yang tagihannya sudah
dilunasi dari keranjang.

- **Baru ditawarkan setelah pembayarannya lunas.** Tombol **Cetak** & **Struk & kirim** tidak ada selama
  keranjangnya masih disusun — struk adalah bukti bayar, jadi pilihannya muncul begitu ada penjualan yang
  tercatat (`lastReceipt`), beserta catatan kecil nomor & total nota yang sudah dibayar itu. Sebelum itu
  satu-satunya jalan di panel adalah tombol **Bayar**: tidak ada lagi jalan pintas yang bisa mengeluarkan
  lembar “Belum dibayar” untuk transaksi yang belum selesai (termasuk Ctrl+P — area cetaknya memakai
  `printDraft`, yang jatuh ke `lastReceipt.draft` dan bukan ke keranjang berjalan).
- **Cetak** — seperti sebelumnya: printer & setelan struk workspace, termasuk rangkapnya. Nota yang keluar
  adalah **penjualan yang baru lunas** (nomornya ada, catatan “Belum dibayar” tidak lagi tercetak), bukan
  keranjang kosong; `draft` disimpan bersama penjualannya di `lastReceipt`.
- **Unduh PDF** — berkasnya dibuat **di perangkat kasir** oleh aturan murni `@/lib/receiptPdf`: satu halaman
  per lembar rangkap, ukuran halaman selebar kertas struknya (58/76/80/241 mm), isinya teks yang sama dengan
  yang keluar di kertas, dan namanya `struk-<nomor nota>.pdf`. Penulis PDF-nya kecil dan tanpa dependensi,
  jadi bundel kasir tidak perlu membawa mesin PDF beserta penyemat hurufnya, dan berkasnya tidak diunggah
  ke mana pun hanya untuk dilihat.
- **Logo toko ikut di dalam berkasnya**, di pita setinggi 29,11 mm yang sama dengan logo di kertas
  (`RECEIPT_PDF_LOGO_PT`) — jadi yang dibuka penerimanya di ponsel sama dengan yang keluar dari printer,
  bukan struk tanpa kepala. Gambarnya disiapkan peramban (`@/lib/receiptLogoRaster`): dimuat memakai pemuat
  gambar yang sama dengan jalur ESC/POS (`loadImage`, dengan `crossOrigin` supaya berkas dari penyimpanan
  Convex boleh dibaca — storage-nya menjawab header CORS, diperiksa langsung dengan `curl -D -`), dipangkas
  ke sisi panjang `RECEIPT_PDF_LOGO_RASTER_PX` (± 2× ukuran cetaknya, tidak pernah diperbesar), lalu
  dijadikan **satu byte keabuan per piksel** dengan bobot yang sama seperti jalur ESC/POS
  (0,299 R + 0,587 G + 0,114 B).
  Di dalam PDF-nya gambar itu masuk sebagai objek `/DeviceGray` **tanpa pemadatan** (penulisnya tidak
  membawa pustaka pemadatan) dan disimpan **sekali** walau lembar rangkapnya dua — pada logo 220 px berkasnya
  bertambah ± 48 KB, jauh di bawah batas unggah WhatsApp (4 MB). Kalau logonya tidak bisa dibaca (tanpa
  kanvas, izin CORS tidak ada, gambarnya rusak, atau memuatnya lebih dari 8 detik), berkasnya tetap dibuat
  **tanpa logo** — struk yang gagal diunduh gara-gara kepalanya jauh lebih buruk daripada struk tanpa logo.
- **Bagikan gambar struk — lampirannya ikut, tanpa satu pun langkah menempel manual.** Tombol **Bagikan
  gambar struk** menyerahkan **satu berkas gambar struk** (PNG) ke **lembar bagikan perangkat** (Web Share
  API), dan **isi struknya ikut sebagai teks pesannya** — jadi di HP/tablet kasir satu ketuk cukup: pilih
  WhatsApp, pilih nomor pembelinya, kirim. Ini satu-satunya jalur tanpa kunci yang membawa **berkasnya**,
  karena tautan `wa.me` memang tidak bisa melampirkan apa pun.
- **Satu jalur berbagi, satu berkas gambar.** Dulu di sini ada dua tombol: satu yang menyerahkan **pasangan**
  gambar + PDF, satu yang menyerahkan gambarnya saja. Pasangan berkas itu di Android dihitung Chromium jadi
  satu intent bertipe **`*/*`** (`SharedFileCollator.commonMimeType()`) dan WhatsApp bisa mengambil berkas
  **pertamanya** saja; dokumentasi Android sendiri memperingatkan `*/*` tidak selalu ditangani aplikasi
  penerima. Sekarang jalur berbaginya **satu**: PNG yang logonya sudah tergambar di dalamnya, tipe intent-nya
  `image/png`, tidak ada berkas kedua yang bisa tercecer, dan laporannya menyebut berkas tunggal itu beserta
  ukurannya (`1400×1898 px, 231,5 KB`) — bukan “terkirim” tanpa bukti. Namanya berpasangan dengan PDF-nya
  (`struk-A-00042.png`), lebarnya mengikuti lebar kertas struknya (14 px per mm — 58 mm → 812 px, dibatasi
  1400 px), ukuran hurufnya dihitung dari jumlah kolom supaya kolom harganya tetap rapi seperti di kertas,
  dan **lembar rangkapnya jadi dua lembar terpisah**. Logonya di sini **berwarna** — di kertas & PDF hitam
  putih karena printernya begitu, sedangkan gambar ini dilihat orang sebagai foto di percakapan.
- **PDF tetap ada lewat “Unduh PDF”.** Berkas PDF tidak dihapus dari aplikasi: tombol **Unduh PDF** dan
  daftar berkas sesi berjalan tetap seperti di atas — jalur itulah yang dipakai kalau gambarnya tidak bisa
  dibuat di perangkat kasir.
- **Perangkatnya dijawab apa adanya, dan ada jalan keluarnya.** Perangkat yang tidak bisa menggambar kanvas
  diberi tahu (diarahkan ke **Unduh PDF**, lalu dilampirkan sendiri di percakapan), dan perangkat yang tidak
  punya lembar bagikan berkas **mengunduh gambarnya** supaya masih bisa dilampirkan dari galeri. Logo yang
  ada tetapi berkasnya tidak terbaca disebutkan di laporannya (“Logo tokonya tidak ikut: gambarnya tidak bisa
  dibaca dari perangkat ini”) — dibedakan dari workspace yang memang belum punya logo. Aturan murni tata
  letaknya hidup di `src/lib/receiptImage.ts` (bisa diuji tanpa peramban & tanpa jaringan), sedangkan
  penggambarnya di `src/lib/receiptImageRaster.ts` (kanvas peramban, huruf monospace diukur dari
  perangkatnya sendiri).
- **Kirim ke WhatsApp pembeli** — **gambar struk** yang sama dikirim ke nomor yang **sudah diisi membernya
  sendiri** (halaman Member); nomor itu yang diutamakan. Aksi `receiptWa.send` mengambilnya dari data member
  (izin `pos.sell`), lalu mengunggah gambarnya ke WhatsApp Cloud API (`/media`, `type=image`) dan mengirim
  **pesan gambar** dengan `media_id` + `caption` hasilnya — jadi tidak ada server berkas publik yang perlu
  diadakan hanya untuk satu struk, dan **logo tokonya tampil di percakapan** tanpa perlu dibuka. Isi pesan
  yang menemani gambarnya (nomor nota, tanggal, total) tetap dihitung aturan murni yang sama
  (`receiptWhatsappCaption`), dan laporan di layar kasir menyebut gambar yang dikirim beserta ukurannya
  (`1400×1898 px, 231,5 KB, berlogo`) — bukan klaim kosong.
- **Gambarnya satu-satunya isi pesan itu.** PDF tidak lagi dikirim lewat kanal resmi: lewat pesan dokumen,
  logo & isi struknya baru terlihat kalau penerimanya membuka lampirannya, sedangkan pesan gambar langsung
  tampil sebagai foto di percakapan. Kalau perangkat kasir tidak bisa menggambar struknya, aksinya berhenti
  dan **mengatakannya apa adanya** (“yang dikirim ke WhatsApp memang gambarnya — pakai Unduh PDF, lalu
  lampirkan sendiri”) alih-alih mengirim berkas lain yang tidak diminta. Jejak audit `receipt.whatsapp` tetap
  mencatat tujuan, asal nomor, nama berkas gambarnya, dan status kirimannya.
  Kanal ini hanya hidup kalau `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` diisi di deployment —
  tanpa keduanya tombolnya menjawab “kanal WhatsApp belum tersambung”, sedangkan mode demo menyimulasikannya
  (tidak ada satu pesan pun yang benar-benar keluar).

- **Cetak otomatis diganti pilihan.** Sebelum ini struk langsung dilempar ke dialog cetak; sekarang yang
  muncul dialog struk. Pembeli yang minta dikirim lewat WhatsApp tidak perlu menutup dialog cetak lebih
  dulu, dan kasir tidak lagi bergantung pada dialog cetak untuk hal yang bukan mencetak.
- **Tidak ada klaim terkirim tanpa bukti.** Baik unggahan berkas maupun pengiriman pesannya harus membawa
  `id` dari WhatsApp; selain itu hasilnya dilaporkan gagal beserta alasan dari WhatsApp dan dicatat di log
  audit (`receipt.whatsapp`). Di layar kasir, kegagalan itu menampilkan tautan `wa.me` sebagai jalur
  cadangan yang membawa **isi struknya**, bukan ringkasan: baris-baris yang sama dengan yang keluar di
  kertas (`receiptWhatsappReceiptText`), dibungkus blok monospace WhatsApp supaya kolom harganya tetap
  sejajar (`receiptWhatsappReceiptMessage`), dan dipotong sendiri di `RECEIPT_WA_TEXT_MAX` (4096 karakter)
  kalau struknya luar biasa panjang — tautan yang tak bisa dibuka lebih buruk daripada struk yang dipangkas.
  Lampiran gambarnya menyusul lewat **Bagikan gambar struk**, atau PDF-nya diunduh lalu dilampirkan sendiri
  oleh kasir.
- **Nomornya tersensor di layar & di log** (`6281•••••890`): cukup untuk mencocokkan, tanpa memajang nomor
  penuh di layar yang dilihat pembeli berikutnya di antrean.
- **Member cash tanpa nomor ditawari kolom — bukan ditebak, dan bukan kegagalan buntu.** Kalau member
  yang dipilih belum mengisi nomornya (mis. member yang didaftarkan cepat di kasir), dialog struk
  memunculkan kolom **Nomor WhatsApp** untuk member itu. Nomor yang diketik tetap lewat aturan yang sama
  (`normalizePhone`): yang belum sah ditolak beserta sebabnya sebelum dikirim, sedangkan nomor yang
  tersimpan di data member selalu menang — kolomnya tidak muncul kalau membernya sudah punya nomor. Aksi
  servernya (`receiptWa.send`) menerima nomor itu sebagai **cadangan** saja, memvalidasinya ulang, dan
  mencatat asal nomornya (`member`/`kasir`) di log audit.
- **Pembeli umum juga bisa dikirimi struk — tanpa harus mendaftarkannya sebagai member dulu.** Penjualan
  yang memang tidak punya member (tidak ada baris member yang bisa dibaca) memakai aksi yang sama:
  `memberId` cukup dikosongkan, dan **nomor yang diketik kasir menjadi satu-satunya tujuan**. Dialog
  struknya karena itu selalu menawarkan kolom **Nomor WhatsApp pembeli** untuk penjualan seperti ini —
  labelnya membedakan dua keadaan: kolom untuk **member** yang datanya belum lengkap (nomor tersimpan
  menang, kolomnya tidak muncul kalau membernya sudah punya nomor) dan kolom untuk **pembeli umum**
  (tidak ada data member sama sekali). Nomor yang belum sah tetap ditolak beserta sebabnya sebelum
  dikirim, dan nomornya **tidak disimpan sebagai member** — hanya dipakai untuk kiriman itu.
- **Jejak kiriman pembeli umum menempel pada notanya.** Log audit `receipt.whatsapp` mencatat `buyer`
  (`member`/`umum`) dan asal nomornya; untuk pembeli umum entitasnya adalah **penjualan** itu beserta nomor
  notasinya (`entity: "sales"`), bukan member yang tidak ada — sehingga pemilik toko tetap bisa menjawab
  “struk tanpa member yang mana dikirim ke nomor siapa”, dan kasir tidak bisa menyamar sebagai member.
- **Berkas PDF yang sudah dibuat bisa dibuka lagi.** Di dialog struk ada tombol **Daftar PDF struk (n)**
  yang membuka daftar berkas yang dibuat kasir di perangkat ini selama sesi berjalan — tiap barisnya tautan
  `blob:` yang benar-benar bisa dibuka atau diunduh ulang, tanpa menyusun ulang PDF-nya. Isinya tidak pernah
  diunggah ke mana pun (hidup di memori halaman & dilepas saat halaman ditutup), dan keadaannya dikatakan
  apa adanya: “Belum ada berkas PDF struk yang dibuat di perangkat ini pada sesi ini.”
- **Kanal WhatsApp opsional, dan keadaannya dikatakan apa adanya.** Kirimannya hidup begitu deployment
  mengisi `WHATSAPP_ACCESS_TOKEN` & `WHATSAPP_PHONE_NUMBER_ID` (versi Graph API bisa dipatok dengan
  `WHATSAPP_GRAPH_VERSION`, bawaan `v21.0`); kalau belum, jawabannya “kanal WhatsApp belum tersambung
  di server: kunci … belum diisi” beserta nama kuncinya, dan struknya tetap bisa dicetak/diunduh — atau
  dikirim lewat jalur cadangan `wa.me` yang membawa **isi struknya**, dengan lampiran **gambarnya** lewat
  tombol **Bagikan gambar struk** (lembar bagikan perangkat). Mode demo menyimulasikan pengirimannya dan
  menuliskan kata “Mode demo” — bukan mengaku terkirim.
- **Kuncinya hidup di lingkungan *deployment*, bukan di `.env` mesin pengembang.** Fungsi Convex membaca
  `process.env` di sisi deployment, jadi `.env`/`.env.local` di sandbox maupun Production env hosting
  **tidak** sampai ke kirimannya — workspace yang mengisi kunci di tempat yang salah tetap melihat
  jawaban “kanal WhatsApp belum tersambung” di kasir:

  ```bash
  bunx convex env set WHATSAPP_ACCESS_TOKEN "…"        # token WhatsApp Business (system user)
  bunx convex env set WHATSAPP_PHONE_NUMBER_ID "…"     # “Phone number ID”, bukan nomor teleponnya
  bunx convex env set WHATSAPP_GRAPH_VERSION "v21.0"   # opsional
  bunx convex run receiptWaData:channelStatus          # baca-saja: configured + kunci yang masih kurang
  ```

  `receiptWaData.channelStatus` bersifat internal (tidak bisa dipanggil klien; yang dibalikkan hanya
  keadaan, bukan rahasianya) dan menghitung keadaannya dengan halaman data yang **sama** dengan kirimannya
  (`receiptWhatsappConfig`), jadi “kuncinya ada di deployment” dan “kirimannya bisa membacanya” tidak bisa
  berbeda. Kalau workspace memakai deployment Convex terpisah untuk produksi, kuncinya diisi di deployment
  itu juga (`bunx convex env set … --prod`).

### Cara mengisi kedua kunci itu, langkah demi langkah

Yang perlu diambil hanya **dua nilai** dari dasbor Meta, dan keduanya berakhir di **lingkungan deployment
Convex** — bukan di `.env` sandbox, bukan di panel Environment Freebuff, bukan di Production env hosting.

**Tidak ada kunci untuk “nomor WhatsApp” di aplikasi ini.** Yang disimpan server hanya **token** (siapa
yang berhak mengirim) dan **Phone number ID** (nomor pengirim mana yang dipakai); nomor pengirimnya sendiri
sudah menempel pada Phone number ID itu di dasbor Meta, dan nomor **penerima** struk datang dari data member
atau dari kolom nomor di dialog struk. Jadi yang perlu Anda masukkan ke server bukan nomor teleponnya,
melainkan **ID**-nya.

**A. Ambil nilainya di dasbor Meta.** Halaman yang benar itu penting: di sana banyak angka mirip, dan yang
kita pakai cuma satu di antaranya.

1. Buka [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Create app** → pilih jenis
   **Business** → di daftar produk tambahkan **WhatsApp**. Gunakan akun Facebook yang memegang **Meta
   Business Account** usaha Anda (akun pribadi tanpa Business Account tidak bisa memakai nomor usaha).
2. Setelah produk WhatsApp aktif, buka **WhatsApp → API Setup** dan catat **Phone number ID**: deretan
   angka panjang (mis. `1053…`). Itu **bukan** nomor telepon pengirim — di halaman yang sama juga tertulis
   “WhatsApp Business Account ID” dan nomor teleponnya, dan keduanya bukan yang dibutuhkan.
3. Di bagian **Access token** pada halaman yang sama, tekan **Generate access token**: itu token
   **sementara** yang kedaluwarsa dalam hitungan jam (bukan tiket sehari penuh) dan cukup untuk uji coba.
   Simpan di tempat yang bisa Anda buka lagi — setelah kedaluwarsa, kiriman struk ditolak dengan alasan dari
   WhatsApp, dan memperbaikinya berarti mengulang langkah 4 (itulah sebabnya pemakaian harian memakai token
   jangka panjang).
4. Untuk pemakaian harian, buat token **jangka panjang lewat system user**: `business.facebook.com` →
   **Pengaturan Bisnis → Pengguna → Pengguna Sistem** → **Tambah** (peran Admin) → beri akses aset lewat
   **Tambahkan Aset**: **Aplikasi** (kelola aplikasi) *dan* **Akun WhatsApp Business** → lalu
   **Generate token** → pilih aplikasi tadi → centang `whatsapp_business_messaging`,
   `whatsapp_business_management`, dan `business_management`. Tokennya hanya ditampilkan **sekali**, jadi
   salin saat itu juga.
5. Nomor pengirim untuk uji coba pertama: nomor uji gratis dari Meta hanya boleh mengirim ke **daftar
   penerima uji** yang didaftarkan di API Setup (daftarnya terbatas, umumnya lima nomor) — tambahkan nomor
   WhatsApp Anda sendiri di kolom **To** supaya struk uji bisa sampai.
6. Untuk memakai **nomor usaha sendiri** sebagai pengirim, tekan **Add phone number** di API Setup: nomornya
   harus bisa menerima kode verifikasi (SMS atau panggilan), dimiliki bisnis Anda, dan **tidak sedang aktif
   di WhatsApp biasa** — nomor yang masih terpasang di aplikasi WhatsApp/WhatsApp Business harus dilepas
   dulu (pengecualiannya jalur *coexistence* lewat mitra, di luar pendaftaran biasa). Verifikasi bisnis
   **tidak lagi wajib hanya untuk mulai memakai platform**, tetapi nama tampilan tetap diisi dan direview
   Meta (otomatis sampai batas pengiriman tertentu).

**B. Tempel ke deployment Convex.** Jalankan dari akar proyek; `convex env set` menulis ke deployment yang
sedang dipakai proyek ini (yang tertulis sebagai `CONVEX_DEPLOYMENT` di `.env.local`):

```bash
bunx convex env set WHATSAPP_ACCESS_TOKEN "EAAG…"     # nilai dari langkah A3 atau A4
bunx convex env set WHATSAPP_PHONE_NUMBER_ID "1053…"  # “Phone number ID” dari langkah A2
bunx convex env set WHATSAPP_GRAPH_VERSION "v21.0"    # opsional; bawaan v21.0 kalau dilewati
bunx convex run receiptWaData:channelStatus           # harus {"configured":true,"missing":[]}
```

Selama `channelStatus` masih membalas `"missing":[…]`, yang salah adalah tempat menempelnya — bukan kode.

**C. Uji kiriman pertama.** Di kasir, lunasi satu penjualan (dengan member bernomor WhatsApp, atau penjualan
pembeli umum yang nomornya diketik di dialog), lalu **Struk & kirim → Kirim ke WhatsApp**. Hasilnya dibaca
apa adanya:

- “kanal WhatsApp belum tersambung di server: kunci … belum diisi” → langkah B belum terbaca di deployment itu.
- Setelah kunci terisi, penolakan datang dari WhatsApp beserta pesannya. Yang paling sering: **131047
  re-engagement** — penerimanya belum pernah mengirim pesan ke nomor Anda dalam **24 jam terakhir**, jadi
  yang boleh keluar hanya **template yang sudah disetujui**, bukan pesan dokumen bebas. Solusinya: minta
  penerima mengirim pesan apa pun lebih dulu (membuka jendela 24 jam), atau ajukan template di **WhatsApp
  Manager → Message templates** — template boleh memuat lampiran **dokumen** (header `DOCUMENT`), jadi yang
  wajib di luar jendela adalah bentuk templatenya, bukan hilangnya lampiran PDF.
- Selama kanal belum tersambung atau tokennya bermasalah, jalur yang tetap bekerja: **Unduh PDF** dan tautan
  cadangan **`wa.me`** di dialog struk.
- **Masih bisa dicetak ulang kapan saja sesudahnya.** Sekali ada penjualan yang lunas, tombol **Cetak** di
  panel keranjang mencetak ulang nota itu — juga saat kasir sudah mulai melayani pembeli berikutnya, karena
  yang dicetak tetap penjualan terakhir yang dibayar, bukan keranjang yang sedang disusun — dan tombol
  **Struk & kirim** membuka dialognya lagi untuk mencetak, mengunduh, atau mengirim ulang.

```bash
bun scripts/verify-struk-gambar.mjs            # 14/14: gambar struk (PNG) diuji tanpa peramban — lebar mengikuti kertasnya (58 mm → 812 px, faktur 241 mm dibatasi 1400 px), huruf dihitung dari jumlah kolom & muat di kertasnya, rangkap 2 jadi dua lembar terpisah dengan tinggi rumusnya, logo memuat kotaknya tanpa mengubah rasio (96×48 → 140×70) & logo selebar 1200 px tetap muat di kertas 58 mm, ukuran logo yang tidak masuk akal diabaikan, dan nama berkasnya berpasangan dengan PDF-nya (`struk-A-00042.png`)
bun scripts/verify-struk-pdf.mjs               # 59/59: berkas PDF diperiksa byte per byte (header/trailer, satu halaman per lembar, MediaBox, dan **logo**: objek /DeviceGray seukuran byte yang diberikan, xref/startxref//Size tetap sah, pita 29,11 mm yang ditambahkan di atas baris pertama, rasio tetap & di tengah, satu salinan gambar untuk lembar rangkap, logo rusak diabaikan tanpa mengubah berkas), plus badan kiriman WhatsApp (multipart, nama berkas, byte PDF utuh) — semua tanpa peramban & tanpa jaringan. Rincian lama: satu halaman per lembar, MediaBox = lebar kertas × tinggi baris, tiap entri xref menunjuk objek yang benar & panjangnya 20 byte, /Length tiap aliran = byte-nya, kurung di-escape, huruf luar Latin-1 → “?”, baris panjang dipotong di kolomnya, berkas yang sama deterministik), nama berkas dari nomor nota, lalu aturan kirim WhatsApp-nya (kanal siap hanya kalau kedua kunci wajib terisi, caption memuat nomor/tanggal/total & dipotong sendiri di 1024 karakter, nomor dinormalkan & tersensor, nama berkas disterilkan, badan multipart memuat byte PDF utuh dengan Content-Length yang tepat, pesan dokumen JSON menunjuk media_id, dan balasan tanpa id dianggap gagal), plus urutan nomor tujuan (`receiptWhatsappRecipient`: nomor yang tersimpan di data member menang atas nomor yang diketik kasir, nomor ketikan dipakai sebagai cadangan & ditandai asalnya, **pembeli umum** memakai nomor pemberiannya sebagai satu-satunya tujuan dengan penandaan `umum` untuk jejak audit, dan nomor tak sah ditolak beralasan dengan kalimat yang berbeda untuk member & pembeli umum) — ditambah **isi struk sebagai teks pesan** (baris yang sama dengan kertas: nomor nota, nama item, TOTAL, Bayar, Kembali; spasi ujung kanan dibuang sementara spasi penyejajar kolom dibiarkan; baris kosong ekor dibuang; blok monospace hanya dipakai kalau muat & isinya belum memuat pagarnya; dipotong di 4096 karakter; dan tautan `wa.me` yang dibangun dari teks itu memuat nama item & nomor notanya) +
  **gambar struk yang jadi satu-satunya isi pesan struk** di kanal resmi: unggahannya mengaku `type=image`
  dengan `Content-Type: image/png` dan byte PNG-nya utuh di dalam badan multipart, pesan gambarnya berjenis
  `image` dengan `media_id` + `caption` dan tanpa kolom `filename` yang tidak dimiliki WhatsApp (badan pesan
  dokumen lama tetap diuji sebagai aturan murni yang masih dipakai berkas lain), plus batas unggah gambar 5 MB
bun scripts/verify-render.mjs                  # 832/832: gerbang alur struknya diklik di DOM tiruan — keranjang yang belum dibayar belum menawarkan Cetak/Struk & kirim sama sekali, pembayaran lunas memunculkan keduanya beserta catatan nomor & total notanya, dan keranjang berikutnya tidak menggantikan struk yang dicetak; juga pembayaran lunas membuka dialog struk (bukan dialog cetak) — tiga pilihannya ada, cetakan masih 0 sampai Cetak ditekan,  nomor nota penjualan yang baru lunas disebut, Unduh PDF melaporkan nama berkas + ukurannya, tombol daftar PDF membuka berkas yang sudah dibuat (tautan `blob:`) lalu menutupnya kembali, **struk tanpa member (pembeli umum) diberi kolom nomor pembeli** yang menolak nomor belum lengkap, lalu nomor yang sah berhenti di ketiadaan kanvas (bukan ditolak soal penerimanya), member tanpa nomor WA diperingatkan lalu pengirimannya ditolak beserta sebabnya tetapi juga diberi kolom nomor, member yang punya nomor pun berhenti di titik yang sama (sebabnya disebut, bukan diklaim terkirim), dan menutup dialognya tidak menghapus notanya; plus **satu jalur bagikan**: dialognya menawarkan “Bagikan gambar struk” dan **tidak** lagi menawarkan tombol kedua, tanpa kanvas jawabannya mengarahkan ke Unduh PDF, dan walaupun `navigator.share`/`canShare` dipasang **tidak ada berkas kosong yang diserahkan** beserta tidak ada klaim “diserahkan” — gambar berlogonya sendiri diperiksa piksel per piksel di Chromium
bunx convex env list --names-only            # kunci apa saja yang ada di deployment (tanpa nilainya)
bunx convex run receiptWaData:channelStatus  # baca-saja: keadaan kanal WhatsApp di deployment — configured + nama kunci yang belum diisi
VITE_CONVEX_URL=https://<deployment>.convex.cloud bun scripts/verify-backend.mjs   # 837/837: halaman data kirim struk di server — struk pembeli umum (tanpa `memberId`) diterima, nomornya boleh tidak ada/ belum sah dan ditolak beralasan dengan petunjuk mengisi kolom nomor pembeli, nomor yang tersimpan di data member tetap menang walau kasir mengetik nomor lain, member tanpa nomor ditolak beserta namanya, dan orang di luar workspace tidak bisa mengirim struk (semuanya dengan **gambar 0 byte**, jadi tidak ada satu pun permintaan yang keluar ke WhatsApp)
# PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-struk-browser.mjs http://localhost:5173   # mode data apa pun
#   → di Chromium sungguhan: dialog struk terbuka setelah pembayaran tunai tanpa satu pun panggilan
#     `window.print`, **Unduh PDF menghasilkan unduhan sungguhan** yang byte-nya dibaca kembali di sini
#     (struk-A-01043.pdf, %PDF-1.4 … %%EOF, 2 halaman untuk 2 lembar rangkap, memuat Cappuccino/TOTAL/
#     TEMBUSAN 1/catatan kaki), daftar PDF membuka berkas yang sudah dibuat lewat tautan `blob:` yang
#     isinya dibaca kembali (PDF yang sama dengan yang terunduh) lalu menutupnya kembali, member tanpa
#     nomor WA ditahan beserta sebabnya sekaligus diberi kolom nomor (nomor belum lengkap ditolak, nomor
#     benar dikirim), **penjualan tanpa member juga bisa dikirimi struk**: dialognya memberi kolom nomor
#     pembeli, mengirim tanpa nomor ditolak dengan petunjuknya, dan nomor yang benar dipakai untuk kiriman
#     itu, Cetak memanggil dialog cetak sekali dengan nota yang sama, kirim ke WhatsApp
#     melaporkan hasilnya apa adanya (di mode demo laporannya menyebut **gambar struk berlogo** yang
#     dikirim — bukan PDF), dan **Bagikan gambar struk** menyerahkan satu berkas `image/png`
#     bernama `struk-<nota>.png` yang benar-benar diterbitkan peramban: 1400×1826 px, 2 lembar kertas
#     terpisah di atas latar abu-abu, logo hijau toko **di dalam** gambarnya (139 px, berwarna — bukan
#     hitam putih seperti di kertas, dan ada di kedua lembar), teks struknya puluhan ribu px gelap tanpa
#     satu baris pun menembus tepi kanan kertasnya, dan tinggi yang dilaporkan dialognya sama dengan
#     berkasnya sendiri — plus bukti bahwa jalur berbaginya kini **satu**: tidak ada tombol “Bagikan PDF”,
#     dan menekan tombol bagikan sekali lagi tetap menyerahkan satu berkas gambar yang sama (93/93)
```

## Daftar transaksi shift ini: tombol + lembar yang naik dari bawah

Tabel “Transaksi terakhir (shift ini)” yang dulu selalu terbuka di bawah halaman kasir sekarang jadi
**satu tombol ringkas**, dan daftar penuh penjualan shift itu dibuka **dari bawah layar**.

- **Tombolnya menyebut angkanya**, bukan hanya judul: `12 transaksi · 15 item · Rp 1.234.000` — dihitung
  dari daftar yang sama dengan yang ditampilkan, jadi angka di tombol dan total di lembar selalu cocok.
  Di tengah antrean, kasir butuh “berapa transaksi & berapa omzet” tanpa membuka apa pun dulu.
- **Lembarnya naik dari bawah** (`framer-motion`: `y: 100%` → `0` dengan pegas), menempel di tepi bawah, dan
  hanya bagian daftarnya yang bisa digulir — layar kasir tidak terkunci, tombol Bayar tetap bisa dijangkau
  begitu lembarnya ditutup.
- **Isinya seluruh penjualan shift ini** (bukan enam baris terakhir seperti tabel lamanya), terbaru di atas:
  nomor nota, jam, jumlah item, metode bayar, dan totalnya, ditutup baris “Total daftar ini”.
- **Tiga cara menutupnya**: silang (`aria-label="Tutup transaksi terakhir"`), tekanan Escape, dan sentuhan di
  latar gelap — sama seperti dialog lain di halaman kasir. Escape hanya menyalakan pendengarnya selama
  lembarnya terbuka.
- **Penjualan yang baru selesai langsung masuk puncak daftar**: datanya dibaca dari store (`sales`), bukan
  salinan yang dibuat saat halaman dibuka.
- **Pelajaran yang ikut diperbaiki:** jumlah item keranjang kini punya `data-testid="keranjang-jumlah-item"`.
  Sebelumnya harness membacanya dengan memindai **seluruh teks halaman** untuk pola “n item” — dan ringkasan
  transaksi yang baru juga menyebut “15 item”, sehingga pembacaan longgar itu menangkap angka yang salah.

```bash
bun scripts/verify-render.mjs                  # 832/832: tombolnya bersimbol jumlah transaksi & daftarnya belum terbuka, menekannya membuka lembar role=dialog berisi baris sebanyak angka di tombol, barisnya menyebut nota/jam/item/metode/total + “Total daftar ini”, dan Escape menutupnya kembali
# PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-pos-transaksi-browser.mjs http://localhost:5173   # mode data apa pun
#   → di Chromium sungguhan posisinya direkam **setiap bingkai** mulai sebelum tombol diklik: bingkai pertama
#     masih di bawah layar, lalu naik (≥ 5 posisi berbeda) sampai menempel di tepi bawah (bottom = tinggi
#     layar) dengan tepi atas di dalam layar; daftarnya sebanyak yang disebut tombol, dua penjualan baru
#     menambah jumlahnya & muncul di puncak daftar (8 baris membuktikan batas enam baris tabel lama hilang),
#     dan ketiga cara menutupnya bekerja — silang, Escape, dan sentuhan di latar (14/14)
```

## Gerbang kasir: tanpa shift terbuka, kasir tidak bisa menjual

Kas yang belum dibuka bukan sekadar catatan yang hilang: penjualan yang tercatat tanpa shift tidak punya
pemilik kas — uang kembalian awalnya tidak diketahui, dan selisih kasnya tidak bisa dicocokkan ke orang
maupun jam. Halaman Kasir (`/app/pos`) karena itu **terkunci sampai ada shift yang terbuka di perangkat
itu**, dan yang dikunci adalah pekerjaan menjualnya:

- **Yang mati**: kartu produk (tidak ada barang yang bisa masuk keranjang), pemilih meja, tombol
  **Hold**, tombol **Lanjutkan** pada transaksi yang ditahan, dan tombol **Bayar** — termasuk ketiga jalur
  pembayarannya (tunai/kartu, tagihan QRIS dari keranjang, dan pelunasan tagihan yang sudah terbit).
  Penjagaannya ada di **fungsinya**, bukan hanya di tombolnya: shift yang ditutup dari tab lain ikut
  menutup pembayaran yang sedang terbuka — keadaan `mesinpos.shifts.v1` dibaca ulang saat peristiwa
  `storage` — jadi tidak ada penjualan yang lolos dari tab yang keadaannya sudah basi.
- **Yang tetap hidup**: mencari produk, membuka daftar transaksi shift yang lalu, dan halaman lain.
  Gerbangnya mengunci pekerjaan yang mencatat uang, bukan seluruh aplikasi.
- **Notisinya satu kartu, beserta jalan keluarnya**: kartu merah di atas katalog
  (`data-testid="pos-gerbang-shift"`, `role="alert"`) berjudul **“Kasir terkunci — shift (kas) belum
  dibuka”**, memuat kalimat “Buka shift (kas) terlebih dahulu di halaman Shift & Kas …”, dan tombol
  **“Buka shift sekarang”** yang menuju `/app/shift`. Di panel keranjang ada catatan ringkas dengan tautan
  yang sama: di ponsel, banner di atas katalog mudah tergulir keluar layar, sedangkan tombol Bayar yang
  mati selalu terlihat.
- **Satu aturan, di `src/convex/lib/shift.ts`** (`posShiftGate`, dipakai halaman Kasir dan harness):
  terbuka = ada shift berjalan yang waktu bukanya bisa dibaca. Shift dengan waktu buka rusak **ikut
  mengunci** — shift yang jamnya tidak bisa dipertanggungjawabkan sama saja dengan kas yang belum dibuka.
  Badge “Kas belum dibuka” tetap ditampilkan apa adanya, dan peringatan tutup shift tetap muncul hanya
  saat waktunya.
- **Saklar “Pengingat tutup shift” di halaman Pengaturan hanya mematikan pengingatnya, bukan gerbangnya.**
  Toko yang tidak ingin diingatkan tetap harus membuka shift sebelum menjual — membuka shift itu satu
  langkah (kas awal diisi sekali di halaman Shift & Kas), sedangkan pengingatnya urusan kenyamanan.
  Karena itu gerbangnya **selalu aktif**: ia tidak ikut konstanta jam/ambang di setelan, dan tidak bisa
  dimatikan dari halaman Pengaturan.
- **Kas itu milik toko, bukan perangkat.** Shift disimpan sebagai baris tabel `shifts` (`pos.openShift`
  / `pos.closeShift`) dan dibaca semua perangkat lewat query `pos.till`: shift yang masih berjalan +
  riwayat Z-report terakhir. Query-nya hanya menuntut **keanggotaan**, bukan `shift.manage` — kasir yang
  melayani pembeli justru tidak memegang izin kas, dan justru ia yang perlu tahu kasnya sudah dibuka.
  Jadi kas yang dibuka pemilik di ponselnya langsung membuka gerbang di perangkat kasir mana pun; mode
  demo memakai penyimpanan perangkat (`mesinpos.shifts.v1`) dengan bentuk data yang sama.
- **Penjualan ditempelkan ke shift yang berjalan** (`shiftId` di `pos.createSale`), sehingga Z-report
  menghitung penjualan shift itu — termasuk penjualan yang dikirim lewat antrean offline.
- **Membuka shift langsung membuka halaman Kasir.** Menekan **Buka shift** di halaman Shift & Kas
  menyimpan shiftnya **lalu memindahkan** pemakainya ke `/app/pos` — halaman Kasir memang sudah membaca
  keadaan kas yang sama, tetapi hanya kalau orangnya pindah ke sana; itulah keluhan “sudah buka shift,
  halaman kasirnya tidak terbuka”. Perpindahannya hanya untuk peran yang memegang `pos.sell` (Pemilik,
  Manajer, Kasir): peran “kas saja” (`shift.manage` tanpa `pos.sell`) tetap di halaman Shift & Kas —
  halaman yang memang haknya — dan di sana tertulis bahwa halaman Kasir butuh izin “Melakukan
  penjualan”, jadi tidak ada yang dilempar ke rute yang tertutup untuknya.
- **Harness ikut menyesuaikan perilakunya**: sesi uji yang menekan tombol kasir sekarang membuka shiftnya
  lebih dulu (persis seperti kasir sungguhan), dan blok yang memang menguji gerbangnya menghapus atau
  mengganti isi `mesinpos.shifts.v1` sendiri.

```bash
bun scripts/verify-shift.mjs                   # 78/78: kas tanpa shift mengunci dengan pesan “Buka shift (kas) terlebih dahulu” & tombol “Buka shift sekarang”, shift yang terbuka (walau dibuka kemarin) membukanya kembali, waktu buka dalam milidetik (kas toko dari `pos.till`) juga membukanya, waktu buka yang rusak/0 tetap terkunci, dan gerbang yang terbuka tidak meninggalkan kalimat sisa
VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud bun scripts/verify-backend.mjs   # 914/914 (7 cek kas toko): kasir tanpa izin `shift.manage` melihat kas yang dibuka pemilik lewat `pos.till` (kas belum masuk riwayat sebelum ditutup, `current` kembali `null` setelah ditutup, Z-report-nya masuk riwayat), kas kedua di toko yang sama ditolak walau aktornya manajer, pembaca di luar tenant ditolak, dan kasir tetap tidak bisa membuka kasnya sendiri
bun scripts/verify-render.mjs                  # 936/936: kartu produk & Bayar benar-benar nonaktif dan keranjang tetap “0 item” walau kartunya ditekan, gerbangnya menautkan `/app/shift`, dan shift yang tersemai membuka gerbangnya kembali (produk masuk keranjang & Bayar hidup)
# PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-mobile-overflow.mjs   # 169/169 (4 cek baru): gerbangnya utuh di 360 px — pesannya tidak terpotong, tombol “Buka shift sekarang” terjangkau, dan tidak ada isi yang terpotong di halaman yang terkunci
bun scripts/verify-shift-pos.mjs               # 20/20: tombol Buka shift benar-benar memindahkan pemakainya ke halaman Kasir (halaman Kasir terbuka & tidak terkunci, produk masuk keranjang), halaman Kasir yang dibuka sendiri/dari tab lain membaca keadaan kas yang sama (peristiwa `storage`), menutup shift mengunci Kasir lagi, dan peran “kas saja” tetap di halaman Shift & Kas beserta alasannya
# PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-pos-transaksi-browser.mjs   # 14/14: alur transaksi di Chromium sungguhan tetap jalan setelah harnessnya membuka shift lebih dulu
```

## Pengingat “jangan lupa tutup shift” di layar kasir

Kas yang masih terbuka padahal hari sudah berakhir cuma ketahuan besok pagi — saat selisih uangnya
sudah bercampur dengan penjualan hari berikutnya. Sekarang kasir diberi tahu **di layar tempat ia
bekerja**, bukan hanya di halaman Shift & Kas yang harus ia buka sendiri.

- **Badge di atas katalog kasir jujur.** Tulisan tetap “Shift terbuka · Kasir: Rani · buka 08:00”
diganti keadaan kas yang sebenarnya (`store.till`, dari `shifts` di server; mode demo dari
`mesinpos.shifts.v1`): kalau kas belum dibuka, yang tampil **“Kas belum dibuka”** dengan satu kalimat
yang mengarahkan ke halaman Shift & Kas; kalau terbuka, yang tampil nama kasir yang sedang masuk + jam
bukanya (`buka 08:00`, `buka kemarin 21:10`).
- **Peringatan muncul sendiri** begitu salah satu ambangnya lewat, dan kalimatnya sama di halaman Kasir
maupun halaman Shift & Kas (satu modul, `src/convex/lib/shift.ts`):
  - **pukul 21:00** (bawaan; jam khas toko/kafe tutup) — pengingat ringan: uang fisik belum dicocokkan dan
    Z-report hari itu belum tersimpan; shift yang masih wajar di siang hari **tidak** diganggu;
  - **shift berjalan ≥ 14 jam** (bawaan) — naik ke peringatan keras, karena uang fisik belum dicocokkan seharian;
  - **shift kemarin belum ditutup** — peringatan paling keras, jam bukanya disebut (`sejak kemarin 21:10`).
- **Jam & ambangnya diatur pemilik toko**, bukan angka tetap di kode: kartu **Pengingat tutup shift** di
halaman Pengaturan (`/app/settings`) menyimpan setelannya ke baris tenant (`tenants.shift`, mutasi
`tenants.updateShift`, izin `billing.manage`) — jam pengingatnya bisa dipilih 0–23, ambang “shift terlalu
lama” 1–24 jam, dan pengingatnya bisa **dimatikan** (kafe yang buka 24 jam). Nilai janggal ditolak dengan
alasannya sebelum satu bidang pun tersimpan, dan lencana di kartunya menunjukkan setelan yang sedang
berlaku (`22:00 · 8 jam`). Halaman Kasir & Shift & Kas membaca setelan yang sama, jadi pengingat yang
dilihat kasir tidak pernah berbeda dari yang diatur pemilik toko.
- **Ada jalan menutupnya dari peringatan itu**: banner kasir menautkan ke `/app/shift` (“Tutup shift
sekarang →”), dan halaman Shift & Kas menampilkan kartu pengingat yang sama di atas rekapnya.
- **Bukan notifikasi push dan bukan penutupan otomatis.** Peringatannya tampil di dalam aplikasi, jadi
ia muncul saat kasir membuka halaman Kasir/Shift & Kas — shift tetap ditutup oleh manusia, dan
penutupan shift tetap manual. Aturan ambangnya diuji murni, terpisah dari tampilan.
- **Pelajaran yang ikut diperbaiki: warna “bahaya” ternyata tidak pernah ada di palet.** Kelas
`text-destructive` / `bg-destructive/10` / `border-destructive/40` dipakai di 24 berkas (182 tempat) — teks
galat, batas peringatan, sampai judul dialog Hapus produk — tetapi `tailwind.config.js` tidak punya token `destructive` dan
`src/index.css` tidak punya `--destructive`, jadi Tailwind tidak pernah membuat kelasnya dan setiap
peringatan galat tampil **seperti teks biasa**. Tokennya ditambahkan di kedua tema (terang `0 74% 42%`,
gelap `0 72% 60%`), dan peringatan paling keras di banner kasir kini benar-benar merah — diukur di
Chromium: latar `rgba(186, 28, 28, 0.1)`, teks `rgb(186, 28, 28)`, tanpa galat konsol, tanpa luapan
mendatar di 1280×800.

```bash
bun scripts/verify-shift.mjs                   # 42/42 (angka pengingat + 4 cek gerbang di bagian sebelumnya): data shift yang rusak/tanpa waktu buka dibuang (bukan “buka NaN”), label jam & lama shift, ambang pengingatnya (20:59 tenang · 21:00 sudah diingatkan · shift 14 jam & shift kemarin naik ke level keras · jam perangkat mundur tidak menuduh kasir), dan setelannya: bawaan tetap aktif · 21:00 · 14 jam, bidang rusak kembali ke bawaan, nilai di luar batas ditolak dengan alasan (jam 24, ambang 0, setengah jam), serta pengingat yang benar-benar mengikuti setelan (jam 23:00, ambang 2 jam, saklar mati)
bun scripts/verify-render.mjs                  # 862/862 (24 cek pengingat + 6 cek gerbang di bagian sebelumnya): kasir tanpa shift menyebut “Kas belum dibuka” (bukan mengklaim “Shift terbuka”), shift kemarin memunculkan banner `data-level="late"` yang menyebut “uang fisik” & “Z-report” beserta tautan `/app/shift`, shift yang sudah ditutup tidak lagi diingatkan, halaman Shift & Kas menampilkan kartu pengingat yang sama, saklar “mati” benar-benar mematikan bannernya, ambang 1 jam dari setelan dipakai kasir, dan kartu halaman Pengaturan menampilkan nilai tersimpan ↔ menolak jam 99 ↔ menyimpan 20:00 sampai ke sesi/store
bun scripts/verify-backend.mjs                 # (awan) 849/849 (12 cek baru): `tenants.updateShift` menolak kasir (izin `billing.manage`) & orang luar, menolak jam 24 dan ambang 0 tanpa menulis apa pun, menyimpan 22:00/8 jam apa adanya, dibaca kembali sama persis oleh pemilik **dan** kasir, tidak menulis audit saat nilainya sama, dan menyimpan keadaan “mati”
# PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-mobile-overflow.mjs   # 169/169 (8 cek pengingat + 4 cek gerbang di bagian sebelumnya): peringatannya utuh di 360 px — bannernya di dalam layar, tautan “Tutup shift” terjangkau, dan tidak ada isi yang terpotong di Kasir maupun Shift & Kas
bun scripts/verify-theme.mjs                   # 50/50: paritas palet terang/gelap tetap utuh sesudah `--destructive` masuk ke kedua tema
# PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-bip-warna-browser.mjs   # 23/23: warna POS & dialognya tidak berubah oleh token baru
```

## Pemberitahuan ke pemilik toko: kas belum dibuka & shift belum ditutup

Kedua keadaan ini cuma kelihatan di **perangkat yang memegang kasnya** — dan pemilik toko sering tidak
sedang berdiri di depannya. Pengingat tutup shift (bagian di atas) mengingatkan **kasirnya**; yang ini
**mengabarkan ke pemiliknya**, karena itu syaratnya pun berbeda.

- **Kas belum dibuka** dikabarkan hanya **di dalam jam operasional**, setelah jeda **30 menit** dari jam
  buka (`opening-grace`): sebelum itu kasirnya masih menghitung uang kembalian, dan di luar jam operasional
  toko memang belum berjualan. Toko yang buka **24 jam** (jam buka = jam tutup) tidak pernah menerima kabar
  ini.
- **Shift belum ditutup** dikabarkan begitu salah satu ini benar: shiftnya dibuka **hari sebelumnya**
  (`cross-day`), toko **sudah tutup** menurut jam operasional (`after-close`), atau shiftnya sudah berjalan
  lebih lama dari ambangnya (`long-shift`).
- **Jam operasionalnya diatur pemilik toko**, bukan angka tetap di kode: kartu **Pengingat tutup shift** di
  halaman Pengaturan (`/app/settings`) menambah kolom **Jam buka toko** & **Jam tutup toko** (0–23, lebih
  kecil dari jam buka berarti buka lintas malam — mis. 20 → 2), plus **saklar pemberitahuan ke pemilik
  toko**. Nilai janggal ditolak dengan alasannya sebelum satu bidang pun tersimpan, dan kalimat di bawah
  kolomnya (`shiftOwnerAlertHint`) menyebut akibat setelan yang sedang diketik apa adanya — termasuk saat
  pemberitahuannya dimatikan.
- **Perangkat melapor, server memutuskan ulang.** Keadaan shift hidup di perangkat
  (`mesinpos.shifts.v1`) supaya kasir tetap bisa menjual saat internetnya putus, jadi perangkat yang
  melaporkan keadaannya **beserta jam lokalnya** (`shiftAlerts.report`, izin `shift.manage`). Server menjalankan
  aturan murni yang sama (`shiftOwnerAlert` di `src/convex/lib/shift.ts`) dengan jam yang dilaporkan itu —
  jadi laporan yang jenisnya tidak cocok dengan keadaannya, atau yang datang di luar jam operasional,
  **berhenti di server** dan tidak pernah menjadi pemberitahuan palsu.
- **Sekali per hari per jenis.** Kunci `(tenantId, kind, dayKey)` dijaga indeks `by_tenant_kind_day`,
  sehingga kasir yang membuka halaman Kasir berkali-kali tidak mengirim kabar yang sama berkali-kali;
  perangkat juga punya penandanya sendiri (`mesinpos.shift-alerts.v1`) supaya halaman yang dimuat ulang
  tidak menembak laporan yang sama.
- **Jalur utamanya email ke pemilik toko, bukan webhook.** Sebelum ini kabarnya hanya tersedia lewat
  langganan webhook — dan yang memasang endpoint sendiri cuma sebagian kecil workspace, jadi kabarnya
  berhenti di tabelnya sendiri. Sekarang setiap laporan **dijadwalkan sebagai email** ke pemilik workspace
  (`tenants.ownerId` + anggota berperan `owner`, unik & ternormalisasi — `shiftAlertOwnerRecipients`),
  lewat aksi terpisah `shiftAlertEmail.send` (`"use node"`) yang memakai jalur email yang sudah ada:
  `RESEND_API_KEY` + `OTP_EMAIL_FROM`, dengan `SITE_URL` untuk tautan halaman Shift & Kas. Alamat uji
  `.test` tidak dikirimi email dan dicatat sebagai `uji`, alamat tanpa pemilik tidak dikirimi ke mana pun.
  Hasilnya disimpan di baris kabarnya (`emailRecipients`, `emailVia`, `emailDeliveredAt`, `emailError`),
  jadi “sudah dikabari” bisa diperiksa ulang, bukan cuma diklaim.
- **Kirimannya juga masuk event webhook `shift.alert`** — jenis di katalog webhook (`api.access`), berisi
  jenis, alasan, hari, jam lokal, judul, isi kabar, waktu buka shift, dan jam operasional yang berlaku.
  Pengirimannya memakai antrean yang sudah ada (`enqueueWebhookEvent` + pekerja percobaan ulang), jadi
  kabar yang gagal sampai ikut dicoba ulang. Kalau workspace itu **belum** punya endpoint pelanggannya,
  kalimatnya menyebut itu apa adanya (“Belum ada endpoint webhook yang melanggan `shift.alert`”) — sambil
  menyebut penerima emailnya, karena itulah jalur yang benar-benar sampai ke pemiliknya.
- **Yang terlihat di layar**: banner di halaman Kasir (`pos-pemberitahuan-pemilik`) yang menyebut keadaan,
  status laporannya (`sedang mengirim` / `pemilik diberi tahu` / `sudah diberi tahu hari ini` / `belum ada
  kabar yang dikirim` / `gagal` beserta sebabnya) dan tautan ke `/app/shift`; kartu **Pemberitahuan ke
  pemilik toko** di halaman Shift & Kas yang membaca daftarnya dari server (`shiftAlerts.list`) beserta
  tombol **Tandai ditangani** (`shiftAlerts.resolve`, idempoten, jejaknya tetap tersimpan); dan lencana
  **Aktif/Mati** di kartu yang sama sesuai saklar di halaman Pengaturan. Tiap barisnya menyebut penerima
  emailnya beserta hasilnya (`shiftAlertDeliveryText`: terkirim / sedang dikirim / gagal beserta pesan
  penyedianya / alamat uji / mode demo) lalu jumlah endpoint webhook yang ikut menerimanya.

Ringkasan yang sama juga ada di berkas PDF panduan sebagai **bagian 19** — jam operasionalnya, kapan
pemilik toko dikabari, dan apa yang tercatat di halaman Shift & Kas — jadi panduan yang diunduh pemilik
toko tidak ketinggalan fitur ini.

```bash
bun scripts/verify-shift.mjs                   # 77/77 (+8 cek kanal email): aturan shiftOwnerAlert (jeda 30 menit, di luar jam operasional diam, lintas malam, toko 24 jam, cross-day/after-close/long-shift, saklar mati), jam operasional & saklar yang ditolak beralasan, setelan sebagian dibaca sebagai bawaan, plus penerima email pemilik (kembar & nonaktif dibuang, alamat `.test` tidak dihitung), isi emailnya, kalimat balikan yang membedakan “dijadwalkan” dari “kanal belum dikonfigurasi”, dan kalimat riwayat yang membedakan terkirim / gagal / alamat uji / mode demo
bun scripts/verify-render.mjs                  # 903/903: banner kasir beserta statusnya, kartu halaman Shift & Kas + “Tandai ditangani”, kenyataan mode demo (tidak ada kanal email server maupun endpoint webhook) dikatakan apa adanya, dan kolom jam buka/tutup & saklar pemberitahuan di halaman Pengaturan benar-benar diklik (jam 24 ditolak, 06:00/23:00 + saklar mati tersimpan ke store)
VITE_CONVEX_URL=https://<deployment>.convex.cloud bun scripts/verify-backend.mjs   # 907/907 (+17 cek shiftAlerts, +6 pemisahan dapur/kas): kabar “kas belum dibuka” tercatat, penerima emailnya alamat pemilik workspace, alamat uji `.test` ditandai `uji` oleh aksi terjadwal (tanpa mengaku terkirim), kabar kedua di hari yang sama duplikat, jenis yang tidak cocok & hari yang bukan YYYY-MM-DD ditolak, di luar jam operasional tidak menjadi pemberitahuan, saklar pemilik mati menghentikan kabar, after-close untuk shift yang belum ditutup, kedua kiriman masuk antrean webhook, daftar terbaru dulu, resolve idempoten, orang luar ditolak, tenant professional ditolak modul api.access
PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-mobile-overflow.mjs http://localhost:5173   # 181/181 (+12 cek pemberitahuan pemilik): di HP 360 px banner pemilik tidak terpotong, tautan “Buka Shift & Kas” terjangkau, kolom teksnya tidak terjepit (dulu 129 px → 250 px), kartu & tombol “Tandai ditangani” muat, dan tidak ada isi yang terpotong di Kasir maupun Shift & Kas
```

Batasan yang jujur: ini **bukan notifikasi push** — kabarnya berangkat saat halaman Kasir/Shift & Kas
terbuka di perangkat yang memegang shiftnya (keadaan shift memang hidup di perangkat), lalu diteruskan
server sebagai **email ke pemilik workspace** (plus langganan webhook kalau ada). Kanal emailnya memakai
`RESEND_API_KEY` + `OTP_EMAIL_FROM` yang sama dengan kode masuk & undangan; kalau kuncinya belum diset di
deployment, laporannya tetap tercatat dan halaman Shift & Kas mengatakan emailnya belum berangkat beserta
sebabnya. Di **mode demo** tidak ada kanal email server maupun endpoint webhook, jadi kabarnya hidup di
sesi saja dan layarnya mengatakan pemilik belum menerimanya.

Banner ini **sudah diukur di peramban sungguhan** pada 360 px (dan 320 px) oleh
`verify-mobile-overflow.mjs`: tidak ada isi yang terpotong di Kasir maupun Shift & Kas, tautan “Buka
Shift & Kas” terjangkau, kartu “Pemberitahuan ke pemilik toko” beserta tombol “Tandai ditangani” muat di
layar. Pengukuran itu menemukan satu cacat yang tidak terlihat dari daftar teks — **kolom teksnya
terjepit** jadi 129 px karena tautan `shrink-0` ikut sebaris, sehingga bannernya setinggi 466 px di HP.
Sekarang tautannya turun ke barisnya sendiri di layar sempit (`w-full sm:w-auto`), dan kolom teksnya
selebar 250 px (320 px: 210 px) — aturan yang sama dipakai banner pengingat tutup shift (dulu 107 px)
beserta kartu gerbang kasir di halaman yang sama. Harness-nya menguji ambang itu, bukan cuma “tidak
terpotong”.

## Modul plug-in (Phase 2)

Tiga modul vertikal (UMKM, F&B, Grosir) sudah punya alur lengkap: UMKM (grid kasir +
**member & diskon**), F&B (denah meja **yang bisa ditambah/diubah/dihapus, digeser, dan diimpor
sekaligus** dari dasbor admin,
antrean dapur **yang hanya menerima pesanan yang sudah lunas** — tiketnya ditandai kanal & momen
pelunasannya, sementara pesanan QR yang belum dibayar dilunasi/dibatalkan kasir dari halaman Pembayaran,
**modifier item**, **pesanan QR meja** — tamu memesan, membayar, **dan bisa membatalkan
pesanannya sendiri** dari ponselnya), dan Grosir (harga
bertingkat, konversi satuan, **piutang B2B & credit limit**).

**Phase 3 (Advanced Supply Chain)** sudah lengkap: keempat fiturnya punya alur, gerbang paket,
izin, dan harness — dan status roadmap-nya di beranda ikut diperbarui jadi *Berjalan*.
`inventory.multiwarehouse` menjadikan gudang sebagai lokasi stok tambahan, menyimpan tiap
perpindahan di ledger, dan menegakkan aturan "kasir menjual dari lokasi jual"; `purchasing.basic`
menjalankan rantai **PR → PO → GRN** (permintaan, pesanan ke supplier, penerimaan) yang membuat
stok masuk tanpa pernah mengetik stok langsung, **plus hutang usaha**: tempo supplier berubah jadi
tagihan berjatuh tempo yang harus dibayar, dan supplier yang menunggak tidak dilayani PO baru —
lihat bagian *Supply chain* dan *Pembelian* di bawah. `inventory.opname` menghitung stok fisik per
lokasi, menyimpan selisihnya sebagai bukti audit, dan baru mengubah stok setelah sesinya diposting —
lihat bagian *Stock opname* di bawah. `purchasing.threeway` menutup lingkarannya: dokumen yang
**dikirim supplier** dicocokkan dengan apa yang **dipesan** (PO) dan apa yang **datang** (GRN),
selisihnya harus diputuskan manusia, dan tagihan bersengketa menahan pembayaran — termasuk saat
beberapa tagihan dibayar sekaligus dengan satu nomor `PAY-…`; lihat bagian *Pencocokan 3 arah*
di bawah.

**Phase 4 (Enterprise Intelligence)** sudah berjalan tiga slice:**analitik lanjutan** (`report.advanced`) hidup di halaman Laporan — tren omzet harian, margin kotor, produk &
kategori teratas, jam tersibuk, pola hari, perbandingan dengan periode sebelumnya, kalimat
temuan yang bisa langsung dipakai mengambil keputusan, plus dua laporan **enterprise**:
**proyeksi akhir periode** (laju hari-hari penuh) dan **analisis keranjang** (ukuran keranjang &
produk yang sering dibeli bersama) — **peran kustom** (`rbac.custom`) hidup
di halaman Tim & Peran, tempat izin tiap staf dirancang sendiri dan ditugaskan per anggota,
**sekaligus izin peran bawaan yang bisa disesuaikan per workspace** (Pemilik tetap dikunci), dan
**akses API & webhook** (`api.access`) hidup di halaman API & Webhook: kunci API bercakupan untuk
endpoint `/api/v1/*` (termasuk jalur **tulis** `POST /api/v1/sales` untuk pesanan dari sistem luar)
plus webhook keluar bertanda tangan HMAC yang **benar-benar berangkat saat kejadiannya** (penjualan
& opname, dokumen yang jatuh tempo, tiket dukungan) dan percobaan ulangnya dijalankan pekerja
terjadwal (`src/convex/crons.ts`); lihat bagian *Analitik
lanjutan*, *Peran kustom & peran bawaan*, dan
*Akses API & webhook* di bawah.

**Phase 5 (Dukungan khusus & skala franchise)** sudah berjalan dua klausanya:
**dukungan khusus** (`support.dedicated`) hidup di halaman Dukungan — tiket dengan janji tanggap
yang dipatok saat tiket dibuat, jalur cepat untuk prioritas Tinggi & Mendesak, dan eskalasi ke
manajer akun — dan **optimasi beban skala franchise** (`scale.franchise`) hidup di halaman Laporan:
satu laporan lintas cabang yang dibaca dengan **anggaran per cabang**, jadi bebannya tidak tumbuh
mengikuti jumlah cabang dan setiap pemotongan dilaporkan apa adanya; lihat bagian *Dukungan khusus*
dan *Skala franchise* di bawah.

**Phase 6 (Realtime Sync & Digital Payment)** sudah berjalan dua klausanya juga — dan ini menutup
seluruh klausa katalog: **pembayaran digital** (`payment.digital`) hidup di halaman Pembayaran,
tempat toko menerbitkan tagihan QRIS/VA bernomor yang dibayar pelanggan sendiri dan baru dihitung
masuk setelah benar-benar dilunasi — dan di **kasir**, pilihan QRIS menerbitkan tagihan senilai
total keranjang, sehingga penjualannya baru tercatat setelah tagihan itu lunas; **sinkronisasi
real-time multi-perangkat**
(`sync.realtime`) hidup di halaman Sinkronisasi: hub perangkat dengan kehadiran yang dihitung dari
detak terakhir, kursor tarik berrevisi, dan penyelesaian konflik *last-write-wins* yang bisa diuji;
lihat bagian *Pembayaran digital* dan *Sinkronisasi real-time* di bawah.

Lencana status **Phase 5** dan **Phase 6** di beranda kini **Selesai** karena seluruh klausanya sudah
punya kode, gerbang paket, dan harness (Phase 1–4 tetap *Berjalan*). Cek render membacanya **per
kartu** — urutan `Phase N → lencana → judul → lingkup` — jadi kata “Selesai” dari kartu lain tidak
bisa membuat lencana yang salah ikut lolos.

Modul vertikal (UMKM, F&B, Grosir) adalah unit yang menentukan fitur apa yang hidup. Aturannya
ada di satu berkas — `src/convex/lib/billing/modules.ts` — dan dipakai bersama oleh halaman Modul,
store klien, dan backend:

- **paket** menentukan modul mana yang *boleh* dinyalakan dan berapa banyak sekaligus
  (`verticalLimit`),
- **`tenants.verticals`** menentukan modul mana yang *sedang aktif*,
- **fitur yang dimiliki modul** (mis. `pos.kds` → modul F&B) hanya bisa dipakai kalau modulnya
  aktif, walaupun paket sudah memuat fiturnya.

Halaman **Modul** (`/app/modules`, izin `billing.manage`) menyalakan/mematikan modul, menampilkan
modul yang terkunci di paket ini, dan mendaftar fitur yang sudah dibayar tapi masih menunggu
modulnya. Server memvalidasi ulang setiap pilihan: `modules.setForTenant` menolak seleksi kosong,
modul di luar paket, dan jumlah di atas batas paket.

Gerbangnya nyata, bukan kosmetik: alur F&B (pesanan ditahan lalu dikirim ke dapur) ditolak
`pos.finalizeHeldSale`/`pos.createSale` saat modul F&B mati, dan lagi bisa dipakai setelah modulnya
dinyalakan kembali.

### Pindah paket dari halaman Langganan

Tombol naik paket di `/app/subscription` menunjuk **paket berikutnya di atas** milik tenant, dihitung
dari urutan katalog (`nextPlanUp` di `lib/billing/catalog.ts`) — bukan nama paket yang ditulis tetap.
Bedanya bukan kosmetik: tombol yang menulis “Upgrade ke Professional” di paket Enterprise menawarkan
paket yang **lebih rendah** sebagai naik paket. Di paket tertinggi karena itu tombolnya tidak ada;
yang muncul penjelasan bahwa tidak ada paket di atasnya, dan kartu “Yang Anda dapat” memakai paket
berikutnya (bukan selalu Professional).

Kliknya benar-benar bekerja: `billing.changePlan` menghitung prorata sisa periode, memangkas modul
yang tidak termasuk paket baru (`trimVerticalsForPlan` — aturan yang sama dipakai klien saat
menyelaraskan sesi), dan menulis jejak `subscription.changePlan` di audit tenant. Setelah sukses,
sesi ikut berubah (`setPlan`), jadi sidebar, gerbang fitur, dan halaman Modul langsung memakai paket
baru tanpa perlu masuk ulang; hasilnya diberitahukan (berapa fitur didapat/dilepas), dan penolakan
server tampil apa adanya di halaman itu. Dua tombol pembayaran (QRIS/GDCPay & kartu/Xendit) masih
**mati** dan diberi keterangan: gateway penagihan belum tersambung, dan tombol yang diam tanpa
keterangan adalah persis keluhan yang memicu perbaikan ini.

### Modul Grosir: harga bertingkat & konversi satuan

Aturannya ada di `src/convex/lib/wholesale.ts` (dipakai server, klien, dan harness):

- `price` dan stok selalu dalam **satuan dasar** (default `PCS`),
- `units` menyatakan satuan besar (`DUS` = 12 PCS) beserta faktornya,
- `tiers` menyatakan harga per satuan dasar untuk kuantitas dasar minimum, dan tier selalu
  dihitung dari kuantitas dalam satuan dasar (2 PAK = 12 PCS bisa kena tier 12+),
- harga tier tidak boleh lebih mahal dari harga dasar, dan faktornya minimal 2.

Diatur dari halaman **Produk → Atur harga** (`products.setPricing`, izin `product.manage`);
mengosongkan `tiers`/`units` selalu boleh, bahkan setelah modul Grosir dimatikan. Saat kasir
memilih satuan besar, `pos.createSale` memakai perhitungan yang sama — `unitCode` dikonversi dulu,
lalu tier diterapkan atas kuantitas dasar.

Produk yang memakai tier/satuan **tidak boleh dijual** ketika modul Grosir mati (server menolak
dengan pesan yang menyuruh mengaktifkan modulnya), supaya harga pelanggan tidak berubah diam-diam.

```bash
bun scripts/verify-panduan.mjs                 # 14/14: berkas PDF panduan dibongkar ulang — halaman, footer, daftar isi (19 bagian), langkah kunci (termasuk izin dapur & kas yang berdiri sendiri, logo toko, printer & kertas struk, kirim struk ke WhatsApp pembeli, serta jam operasional & pemberitahuan ke pemilik toko), batas gambar (1–12), tautan halaman, plus panduan singkat kirim struk ke WhatsApp pembeli di sumber halamannya
bun scripts/verify-modules.mjs                 # 34/34: aturan aktivasi modul + urutan paket & aturan pindah paket (murni)
bun scripts/verify-wholesale.mjs               # 31/31: harga bertingkat + konversi satuan (murni)
bun scripts/verify-ar.mjs                      # 54/54: piutang B2B + credit limit (murni)
bun scripts/verify-members.mjs                 # 30/30: member & diskon member (murni)
bun scripts/verify-inventory.mjs               # 42/42: gudang + perpindahan stok (murni)
bun scripts/verify-purchasing.mjs              # 60/60: PR/PO/GRN pembelian (murni)
bun scripts/verify-payables.mjs                # 44/44: hutang usaha & tempo supplier (murni)
bun scripts/verify-opname.mjs                  # 48/48: stock opname & audit selisih (murni)
bun scripts/verify-fnb.mjs                     # 124/124: denah meja + antrean dapur + pagar hapus meja + urutan & impor denah + penanda kanal/momen pelunasan tiket + kapan tagihan QR baru boleh diberitahukan (bunyi & kilat: sekali per tagihan, hanya yang baru) + dua sumber tiket (tertahan & penjualan lunas yang otomatis dikirim ke dapur) beserta label pembayarannya (murni)
bun scripts/verify-modifiers.mjs               # 46/46: modifier item + harga tambahan (murni)
bun scripts/verify-analytics.mjs               # 81/81: analitik lanjutan report.advanced + proyeksi akhir periode & analisis keranjang (murni)
bun scripts/verify-rbac.mjs                    # 45/45: peran kustom rbac.custom (murni)
bun scripts/verify-api.mjs                     # 225/225: kunci API, webhook, pekerja retry & pemicu event/kalender (murni)
bun scripts/verify-support.mjs                 # 61/61: dukungan khusus support.dedicated + kanal keluarnya (murni)
bun scripts/verify-scale.mjs                   # 42/42: skala franchise scale.franchise (murni)
bun scripts/verify-payments.mjs                # 72/72: pembayaran digital payment.digital (murni)
bun scripts/verify-sync.mjs                    # 47/47: sinkronisasi real-time sync.realtime (murni)
bun scripts/verify-otp.mjs                     # 79/79: kode OTP masuk tanpa kata sandi (murni)
bun scripts/verify-render.mjs                  # 832/832: beranda + 21 halaman dirender di klien + alur aksi (termasuk alur OTP, pembatalan pesanan tamu, serta tambah/ubah/hapus/geser meja dan impor denah) + header beranda tetap di atas saat digulir + shell /app/pos terbuka sungguhan (shell setinggi layar, satu area gulir, header & sidebar di luarnya, permukaan sidebar gelapnya terpasang) + lencana sumber data & catatan halaman pemilik toko menyebut “server”, bukan merek backend + notis kegagalan sambung-tenant + baris “Workspace saya” di backstage + tombol naik paket yang benar-benar pindah paket + alur isi stok yang benar-benar diklik (Tambah produk dengan stok awal & Sesuaikan stok) + unggah/hapus gambar produk dari kartu Produk baru & Atur harga sampai batas 8 + tombol Buat otomatis, simpan dengan kolom SKU kosong, serta SKU yang ikut kategori baru dari form & dari kartu Atur harga
bun scripts/verify-product-images.mjs          # 25/25: gambar produk — batas 8, tipe & ukuran berkas, label slot (murni)
bun scripts/verify-product-sku.mjs             # 39/39: SKU otomatis — format, kode kategori, nomor urut per tenant, recode saat kategori berganti (murni)
bun scripts/verify-menus.mjs                   # 406/406: setiap menu sidebar × setiap peran — menu yang tampil, halaman yang terbuka, penolakan URL langsung & gerbang modul
bun scripts/verify-theme.mjs                   # 50/50: tema terang/gelap — aturan, paritas palet, permukaan sidebar (gelap + beda nyata dari latar + teks terang), bootstrap index.html, tombol di DOM
bun scripts/verify-pwa.mjs                     # 1527/1527: manifest display fullscreen (termasuk rujukan diri untuk menanyakan “sudah terpasang?” & ikon raster didahulukan), ikon dibaca sampai piksel, service worker dieksekusi, ajakan install 10 detik + tombol di header, perangkat yang sudah memasang tidak ditawari lagi, dan peringatan “alamat sementara”
bun scripts/verify-version.mjs                 # 44/44: ajakan “Versi baru tersedia — muat ulang” — aturan murni (berkas mana yang dihitung bundel, kapan ajakan ditahan), perilaku DOM (jadwal, muat ulang, “Nanti” per tab), jalur diam (luring/galat/mode dev/tab tersembunyi), dan pemasangan di shell /app/pos sungguhan
bun scripts/verify-qr.mjs                      # 11/11: payload QRIS → kode QR → dibaca ulang pemindai (murni)
bun scripts/verify-impersonation.mjs           # 52/52: sesi pendampingan platform & jejak auditnya (murni)
VITE_CONVEX_URL=https://<deployment>.convex.cloud bun scripts/verify-backend.mjs   # 837/837 (termasuk pembatalan pesanan tamu dari ponselnya, tagihan QR meja yang dibatalkan kasir melepas pagar hapus meja, ubah/hapus meja beserta pagar hapusnya, serta urutan denah & impor sekaligus, pemicu event nyata, kalender, kode OTP tanpa kata sandi, akun platform & pendampingan, kontrak hasil pindah paket, unggah gambar produk sungguhan ke penyimpanan — batas 8 & berkas terhapus jadi 404, serta SKU otomatis PBB-<KATEGORI>-<nomor urut>, bentroknya dengan SKU manual, dan pindah kategori produk yang ikut mengganti kode SKU-nya)
VITE_CONVEX_URL=https://<deployment>.convex.cloud bun scripts/verify-webhook-retries.mjs   # 6/6 (tunggu ~2 menit)
```

### Modul F&B: denah meja & antrean dapur (KDS)

Aturannya ada di `src/convex/lib/fnb.ts` — satu modul murni yang dipakai backend, klien, dan harness:

- **status meja tidak disimpan.** Meja terisi kalau ada **tiket dapur** yang menunjuknya
  (`tableHolders`) — pesanan tertahan (`status: "held"`) **maupun** penjualan yang sudah lunas tetapi
  tiketnya belum ditandai selesai oleh dapur. Jadi menyelesaikan/membatalkan pesanan atau menekan
  **Selesai** di layar dapur otomatis mengosongkan mejanya, tanpa patch tambahan yang bisa terlewat.
- **Satu meja hanya boleh punya satu pesanan terbuka.** Dua pesanan di satu meja tidak bisa
  dipisahkan lagi tagihannya, jadi yang kedua ditolak (`seatTable`).
- Nama meja unik per toko (tanpa peka huruf besar-kecil), kursi 1–24, nama maksimal 16 karakter dan
  dinormalkan (spasi dirapatkan).
- **Pesanan tertahan belum menggerakkan stok**; stok bergerak saat ditandai selesai di layar dapur.
- **Dua sumber tiket, satu antrean** (`isKitchenTicket`): pesanan tertahan (`status: "held"`) **dan**
  penjualan yang **sudah lunas** yang dikirim ke dapur pada momen pembayarannya. Yang kedua lahir
  sendiri — begitu kasir mencatat uangnya (tunai, QRIS, atau VA) server menulis `kitchenFiredAt`
  (`pos.createSale`, gerbangnya fitur `pos.kds`), jadi dapur menerima pesanannya tanpa kasir menekan
  tombol kedua di depan antrean. Tiketnya menandai dirinya `settled` beserta cara bayarnya
  (`Lunas Tunai · diterima dapur pukul 13:42`, aturan murni `ticketPaidLabel`), dan dialog struk yang
  terbuka otomatis sesudah pembayaran menyebutkan bahwa pesanannya sudah diterima dapur.
- **Tombol Selesai di dapur berarti dua hal, dan yang memutuskan adalah server** (`pos.kitchenDone`,
  satu panggilan store `finishKitchenTicket`): pesanan **tertahan** diselesaikan di situ — stok bergerak
  (`finalizeHeldSale`) — sedangkan tiket yang **sudah lunas** hanya ditandai `kitchenDoneAt`. Stok
  penjualan lunas sudah bergerak saat uangnya dicatat, jadi menyelesaikannya untuk kedua kalinya akan
  mengurangi stok dua kali; itulah yang ditolak jalur ini.
- **Meja yang pesanannya sudah dibayar tetap terkunci sampai dapur menekan Selesai.** Begitu uangnya
  diterima, meja tamu itu masih dipakai tamunya — makanannya belum datang — jadi kasir **tidak bisa**
  memilihnya lagi untuk pembeli berikutnya (`seatTable` menolaknya dengan kalimat “sudah dibayar,
  tunggu dapur menekan Selesai”), dan denah menandainya terisi baik di kasir maupun di layar dapur
  (`paid` di `TableState`). Meja yang sedang menunggu dapur juga tidak bisa dinonaktifkan dari denah.
  Penjualan yang **belum pernah** sampai ke dapur (workspace tanpa layar dapur) tidak menahan meja —
  tanpa tiket di antrean, tidak ada yang bisa melepaskannya. Di daftar **Pesanan di dapur** pada
  halaman kasir, tiket yang sudah lunas ditandai **sudah lunas** supaya tidak terbaca sebagai tagihan
  yang masih menunggu uang.
- **Tombol Hold menahan transaksi yang sedang berjalan.** Keranjang yang belum dibayar bisa ditahan
  sementara (tombol **Hold** di panel keranjang) supaya pembeli berikutnya dilayani lebih dulu, lalu
  transaksinya dilanjutkan dari daftar **Transaksi ditahan** di kolom kiri halaman kasir (`Lanjutkan`,
  atau `Buang` kalau pembelinya batal). Isinya kembali utuh berikut meja, member, dan diskonnya, dengan
  harga yang dihitung ulang dari katalog sekarang; meja yang sudah dipilih ikut ditahan selama
  transaksinya ada di daftar itu. Ini murni urusan layar kasir: selama ditahan belum ada uang, stok,
  maupun tiket dapur yang tercatat, jadi memuat ulang halaman mengosongkan tahanannya (kasir memindai
  ulang barangnya) tanpa ada catatan yang menggantung.
- Antrean dapur diurutkan **paling lama menunggu di depan**, dengan ambang tanda “lama” 15 menit.
- **Urutan denah disimpan, bukan diturunkan dari nama.** Meja punya `sortOrder` eksplisit, jadi denah
  yang sudah ditata pemiliknya tidak berubah sendiri saat ada meja baru ditambahkan di antaranya; meja
  baru selalu masuk **di paling akhir**. Denah bisa digeser satu langkah per meja (`tables.move`), dan
  yang menata urutannya tetap **server**: `planTableMove` menghitung urutan barunya dari data yang
  tersimpan lalu menomori ulang 1…n, sehingga dua perangkat yang menata bersamaan tidak saling menimpa
  dengan urutan yang salah. Tombol gesernya mati di ujung denah (meja paling awal tidak bisa mundur,
  paling akhir tidak bisa maju) dan mengubah nama/kursi/zona tidak menggeser tataannya.
- **Beberapa meja bisa diimpor sekaligus** (`tables.importBatch`) dari teks **satu meja per baris**:
  `Nama, kursi, zona` — kursi & zona boleh dilewati (`A1` saja = 4 kursi), kolom kedua yang bukan angka
  dibaca sebagai zona (`A1, Teras`), baris berawalan `#` diabaikan, dan satu kali impor maksimal 40 baris.
  Aturannya **semua atau tidak sama sekali** (`planTableImport`): satu baris yang salah membatalkan
  seluruh impor dan menyebut **nomor barisnya** — denah yang keburu terisi separuh jauh lebih
  membingungkan daripada perintah yang ditolak. Nama yang kembar di dalam batch maupun yang sudah ada di
  denah ditolak lebih awal, dan meja hasil impor masuk berurutan di akhir denah sesuai urutan teksnya.
- **Meja bisa diubah dan dihapus, tetapi hapus punya pagarnya sendiri** (`tableDeletionCheck`). Yang
  benar-benar terhapus hanyalah meja yang **belum pernah dipakai** (mis. salah tambah); meja yang masih
  terisi pesanan terbuka, masih punya **tagihan tamu yang menunggu dibayar**, atau sudah punya **riwayat
  penjualan** ditolak — yang beriwayat dijawab dengan menyarankan **nonaktifkan** saja, supaya riwayat
  penjualan tidak kehilangan mejanya. Dialog hapus di denah membaca pagar itu lebih dulu
  (`tables.deletionCheck`), jadi tombol Hapusnya sudah tahu jawabannya sebelum ditekan.

Ada dua alur, dan keduanya berakhir di antrean yang sama di halaman **Dapur & Meja** (`/app/kds`):

1. **Pembeli membayar dulu** (paling sering di kafe/restoran cepat): kasir menyusun pesanan, menekan
   **Bayar** dan mencatat uangnya (tunai, QRIS, atau VA). Penjualannya tersimpan sekaligus menjadi
   tiket dapur (`kitchenFiredAt`), stoknya berkurang di titik itu, dan dialog struk terbuka dengan
   pilihan cetak/unduh/bagikan — kasir tidak perlu memilih meja maupun menekan tombol kedua. Dapur
   menutup tiketnya dengan **Selesai** (`pos.kitchenDone`, hanya menandai beres).
2. **Dapur menyiapkan dulu, uangnya menyusul** (pesanan tertahan, mis. dari API atau tamu QR meja):
   yang tersimpan adalah `pos.createSale` dengan `status: "held"` — stok belum bergerak, mejanya jadi
   terisi, dan **Selesai** di layar dapur (`pos.finalizeHeldSale`) yang menyelesaikan penjualannya,
   sehingga stok berkurang dan mejanya kosong lagi. Di halaman kasir jalur ini digantikan tombol
   **Hold** (lihat butir Hold di atas): yang ditahan hanya keranjang kasir, bukan pesanan di dapur,
   karena pesanan yang belum dibayar tidak boleh masuk dapur lebih dulu di alur F&B ini.

Meja yang dipakai alur 1 maupun 2 **tetap terkunci** untuk kasir sampai dapurnya menekan Selesai,
sehingga tidak ada dua tagihan berbeda yang tercampur di satu meja.

Gerbangnya tiga lapis dan bukan kosmetik: menu sidebar ikut menyembunyikan halaman, rute memeriksa
izin yang sama, dan server menolak — `pos.kdsTickets` butuh fitur `pos.kds` **dan** izin `kds.manage`
(peran “dapur saja” cukup dengan izin itu, tanpa `pos.sell`), `tables.*` butuh fitur
`pos.table` **dan** izin `table.manage` (pemilik/manajer; kasir memakai meja, bukan mengubah denah),
dan `pos.createSale` dengan `tableId` butuh fitur `pos.table`. Menambah meja saat modul F&B mati
ditolak dengan pesan yang menyuruh mengaktifkan modulnya.

Pengiriman ke dapur sengaja **tidak** lewat antrean offline (baik penjualan lunas maupun pesanan
tertahan lewat `holdSale`): dapur hanya boleh melihat pesanan yang benar-benar sudah diterima server,
jadi tanpa koneksi kasir diberi tahu untuk menunggu. Penjualan yang masih menunggu sinkronisasi juga
belum menjadi tiket — tiketnya lahir saat server menyimpannya (itulah `kitchenFired` yang kosong di
hasil `createSale` selama penjualannya masih di antrean offline). Tombol **Hold** tidak menyentuh
jaringan sama sekali: yang ditahan hanya keranjang di layar kasir.

```bash
bun scripts/verify-fnb.mjs           # 124/124: dua sumber tiket (`isKitchenTicket`) — tertahan, lunas yang sudah dikirim, yang sudah ditandai selesai, dan yang dibatalkan — penentu kirim otomatis saat penjualan lunas (`fireKitchenOnSale`, termasuk paket tanpa layar dapur & pesanan tertahan yang tidak dikirim dua kali), label pembayaran tiket (`Lunas Tunai/QRIS/Transfer · diterima dapur pukul HH:MM`, metode tak dikenal tidak dihilangkan diam-diam), satu antrean berisi kedua jenis tiket, serta **kunci meja**: tiket lunas menahan mejanya (`tableHolders`/`ticketTableHolders`), penolakannya menyebut “sudah dibayar, tunggu dapur Selesai”, dan penjualan yang tidak pernah ke dapur tidak menahan meja (murni)
bun scripts/verify-render.mjs         # 837/837: kasir F&B benar-benar diklik — tekan produk → Bayar → Rp 100.000 → Selesaikan pembayaran, dialog struk menyebut “dikirim ke dapur”, stok bergerak sekali, tiketnya muncul sebagai `settled` bertanda “Lunas Tunai”, daftar Pesanan di dapur menandainya “sudah lunas”, dan Selesai di dapur mengeluarkan tiket lunas dari antrean tanpa mengurangi stok lagi; plus **Hold** (keranjang ditahan, pembeli berikutnya dilayani, transaksinya dilanjutkan dengan nominal yang sama, tahanan bisa dibuang) dan **kunci meja** (meja terkunci begitu uangnya diterima & tidak bisa diklik, kartu dapur menandainya terisi, terbuka lagi setelah Selesai diklik)
VITE_CONVEX_URL=https://<deployment>.convex.cloud bun scripts/verify-backend.mjs   # 907/907: di server — `createSale` melaporkan `kitchenFired` (tunai **maupun QRIS**, labelnya ikut kanalnya), tiket `settled` + `paidLabel` masuk `pos.kdsTickets`, meja **terkunci** selama tiket lunasnya menunggu dapur (pesanan kedua di meja itu & menonaktifkan mejanya ditolak dengan kalimat “sudah dibayar”), meja bebas lagi & bisa dipakai penjualan berikutnya setelah `kitchenDone`, `pos.kitchenDone` menutup tiket tanpa mengurangi stok dua kali (dan menolak dipanggil dua kali), `kitchenDone` atas pesanan tertahan tetap menyelesaikan penjualannya, serta workspace tanpa fitur `pos.kds` tidak mengklaim pesanannya ke dapur
```

### Modul F&B: pesanan QR meja — tamu memesan & membayar dari ponselnya

Tamu yang duduk di meja memindai **kartu QR** yang ditempel di mejanya, memilih menu dari katalog
toko **yang sama dengan katalog kasir**, lalu membayar **tagihan QRIS** yang diterbitkan server.
Aturannya ada di `src/convex/lib/meja.ts`, backend `src/convex/meja.ts`, halaman tamu `/meja/:token`
(`src/pages/MejaPage.tsx` — publik, di luar `/app` dan tanpa sesi), dan kartunya dikelola dari halaman
**Dapur & Meja** (`/app/kds`).

- **Tautan meja memuat rahasia, bukan id.** Kode QR di meja bisa difoto siapa pun, jadi isinya token
  acak `mj_<32 hex>` — bukan `tableId` — yang hanya bisa diterbitkan pemegang izin `table.manage`
  (pemilik/manajer; kasir memakai meja, bukan menerbitkan kartunya). Menerbitkan ulang **tidak**
  mengganti kartu yang sudah tercetak; penggantian harus diminta eksplisit (`rotate`), dan saat itu
  kartu lamanya langsung tidak berlaku.
- **Tagihan dulu, penjualan kemudian.** Menerima pesanan tamu hanya menerbitkan tagihan digital
  (QRIS berumur 5 menit, atau Virtual Account sehari) dan menahan isi pesanannya; **belum ada tiket
  dapur** — apalagi stok yang bergerak — sebelum uangnya tercatat masuk. Tamu yang menutup halamannya
  sebelum membayar tidak meninggalkan penjualan hantu.
- **Dua cara bayar, dipilih tamu sebelum tagihannya terbit.** **QRIS** (kode dipindai) atau
  **Virtual Account** bank pilihan (BCA/BNI/BRI/Mandiri — daftar bank yang sama dengan halaman
  Pembayaran). Nomor VA-nya deterministik dari bank + urutan tagihan (`8808…`, `8810…`, `8888…`,
  `8907…`), jadi nomor yang sama tidak pernah menunjuk dua tagihan; pilihan yang tidak masuk akal
  ditolak **dengan kalimat yang bisa dibaca tamu** sebelum satu baris pun tersimpan — VA tanpa bank,
  QRIS yang menyebut bank, atau cara bayar asing.
- **Tombol “Screenshot QRIS” menyimpan kodenya sebagai gambar.** Ponsel yang menampilkan kode tidak
  bisa memindainya sendiri, jadi tagihan QRIS bisa digambar jadi **PNG** (`src/lib/qrisImageRaster.ts`) dan
  diserahkan ke lembar bagikan perangkat atau diunduh sebagai `qris-<nomor-tagihan>.png`; berkasnya
  dibuat di perangkat tamu (tidak diunggah ke mana pun) dan keterangan nominal + nomor tagihannya ikut
  tercetak di bawah kode supaya gambar di galeri masih bisa dicocokkan dengan tagihan di kasir.
  Geometrinya aturan murni (`src/lib/qrisImage.ts`: putih, zona tenang, skala bilangan bulat) dan
  harness-nya membangun ulang gambarnya piksel demi piksel lalu membacanya dengan pemindai QR
  sungguhan — screenshot dari galeri harus tetap sah sebagai kode bayar.
- **Harga, pajak, dan total dihitung server.** Ponsel tamu hanya mengirim `productId` dan jumlah.
  `validateGuestCart` mencocokkannya dengan katalog toko — produk nonaktif, habis, jumlah nol, atau
  pesanan kebesaran ditolak **dengan nama menunya** — lalu totalnya dihitung `orderTotal` yang sama
  dengan kasir. `guestOrderTotal` di ponsel tamu hanyalah pratinjau, dan harness membandingkan keduanya
  untuk beberapa setelan pajak, supaya tidak ada dua rumus yang bisa berbeda diam-diam.
- **Pesanan tamu memakai aturan yang sudah ada**, bukan aturan kedua: satu meja satu pesanan terbuka
  (`seatTable` — pesanan QR kedua di meja yang masih terisi ditolak), meja & toko-nya ditentukan token
  (bukan id dari ponsel), dan uangnya tetap satu-satunya catatan tagihan digital.
- **Batas pesanan tamu**: 20 baris menu, 10 porsi per menu, 40 item per pesanan, dan nama tamu maksimal
  24 karakter — supaya pesanan jahil tidak lolos dan dapur tidak dibanjiri satu pesanan raksasa.
- **Pelunasan = penjualan tertahan.** Begitu tagihannya ditandai lunas di halaman **Pembayaran**
  (`payments.act` → `meja.guestOrderPaid`), pesanannya baru menjadi penjualan `held` bernomor
  (`A-00012`) yang menunjuk tagihannya, lengkap dengan itemnya — dan tiketnya langsung muncul di
  antrean dapur pada momen yang sama (`paidAt` = `createdAt` penjualannya).
  Angka pesanannya **dipakai apa adanya**: mengubah setelan pajak setelahnya tidak boleh menulis ulang
  nota yang sudah dibayar.
- **Tagihan QR baru memberi tahu dapur sendiri: bunyi + kilat.** Begitu ada tagihan QR yang belum
  lunas datang, kartu antrean dapur **berbunyi** (`KDS_ALERT_BEEP`, nada satu oktaf di atas bip kasir &
  lebih panjang, jadi “tagihan baru menunggu” tidak tertukar dengan “produk diklik”) dan **berkilat**
  (animasi `kilat`, `data-kilat="1"`, plus tanda `meja-qr-kilat` yang menyebut berapa tagihan baru masuk)
  selama `KDS_ALERT_FLASH_MS` (6 detik) — lalu padam sendiri. Bunyi dan kilatnya dipicu **aturan murni
  yang sama** (`planKdsAlert`): syaratnya tagihannya **belum pernah diberitahukan** layar itu *dan*
  umurnya masih di dalam `KDS_ALERT_WINDOW_MS` (30 detik), jadi satu tagihan berbunyi satu kali
  (berpindah halaman dan kembali tidak mengulangnya) sementara membuka layar dapur di tengah hari tidak
  membunyikan alarm untuk tagihan yang sudah lama menunggu. Bunyinya memakai **setelan bunyi perangkat
  yang sama** dengan kasir (tombol **Matikan bunyi**/**Bip kasir** di kasir & Pengaturan juga
  membisukannya), dan ada **saklar “Bip tagihan”** di kartu antrean dapur itu sendiri
  (`meja-qr-bip`) — dapur yang berisik tidak perlu membuka halaman lain untuk membisukan layarnya.
  Kilatnya tetap berjalan walau bunyinya dimatikan, dan yang memilih senyap tetap dapat teks tandanya.
  Batasnya: notifikasi ini hidup **selama layar dapur terbuka** — tidak ada notifikasi latar/push.
- **Dapur hanya melihat pesanan yang sudah lunas.** Pesanan QR yang belum dibayar **tidak pernah**
  tampil sebagai antrean di layar **Dapur & Meja**. Penghitungnya — lencana angka
  (`meja-qr-menunggu-jumlah`) beserta kalimat “N pesanan QR meja menunggu pelunasan” — duduk di
  **kartu antrean dapur itu sendiri**, bukan di kolom denah meja, supaya kasir yang sedang
  memandangi antrean langsung membaca berapa tagihan yang belum masuk tanpa berpindah halaman dulu.
  Sebelah lencana itu ada **tombol** (`meja-qr-ke-pembayaran`, “Ke halaman Pembayaran”) yang membawa
  kasir ke halaman **Pembayaran**, tempat tagihannya dilunasi (**Lunasi & kirim ke dapur**) atau
  dibatalkan. Barisnya di sana menyebut meja & nama tamunya, supaya kasir tahu tagihan mana yang
  sedang ditunggu dapurnya. Isi penghitungnya tetap **hanya jumlah** — nama tamu, nominal, dan nomor
  tagihan tidak pernah terbaca dari dapur. Yang dihitung “masih
  menunggu” adalah pesanan yang tagihannya **masih bisa dibayar** (`isAwaitingPayment`: niatnya
  `pending` **dan** tagihannya `pending`) — tagihan yang sudah dibatalkan atau kedaluwarsa tidak lagi
  menunggu apa pun, dan karena itu juga tidak lagi menahan hapus meja di pagar
  `tables.deletionCheck`.
- **Tiket dari QR meja ditandai kanal & momen pelunasannya**: `Lunas QRIS dari meja · diterima dapur
  pukul 13:42` atau `Lunas VA BRI dari meja · diterima dapur pukul 13:42` (`ticketPaymentLabel`).
  Waktunya adalah momen pelunasannya, bukan waktu pesanan dibuat — jadi terlihat bahwa tiket itu
  memang masuk dapur bersamaan dengan uangnya.
- **Membatalkan pesanan tamu membatalkan niat pesanannya, bukan tagihannya** (`meja.cancelOrder`, izin
  `payment.manage`). Pesanan yang sudah lunas ditolak dengan petunjuk membatalkannya dari sisi
  penjualannya, karena uangnya sudah masuk.
- **Tamu bisa membatalkan pesanannya sendiri dari ponselnya** (`meja.cancelOwnOrder` lewat token
  pemantau `mjo_…`, aturannya `guestCancelCheck`) — pembeli yang berubah pikiran sebelum uangnya masuk
  tidak perlu menunggu pelayan, dan mejanya tidak tertahan. Batasnya sengaja sempit: hanya selama
  tagihannya **belum lunas** (uang yang sudah masuk tidak dibalik tombol di ponsel), tagihan yang masih
  menunggu **ikut dimatikan** supaya kodenya tidak bisa dipakai membayar pesanan yang sudah dibatalkan,
  tagihan yang kedaluwarsa tetap boleh dibereskan, dan pesanan yang sudah dibatalkan tidak bisa
  dibatalkan dua kali. Karena tagihannya belum pernah lunas, pembatalan ini **tidak pernah** membuat
  penjualan atau tiket dapur — dan tidak bisa dipakai membatalkan pesanan orang lain: yang bisa
  dibatalkan hanyalah pesanan yang tokennya dipegang pemanggil.
- **Status pesanan dipantau token per pesanan** (`mjo_…`): ponsel tamu hanya bisa menanyakan pesanan itu
  sendiri — tidak ada daftar, tidak ada meja lain — dan jawabannya memuat **cara bayar yang berlaku**
  (metode, bank, nomor VA, atau payload QRIS) beserta sisa waktu tagihannya. Nomor VA & payload QRIS
  hanya dikirim selama tagihannya masih menunggu; setelah lunas/kedaluwarsa yang tersisa hanya
  hasilnya.
- **Gerbangnya tiga fitur sekaligus**: `pos.table` + `pos.kds` + `payment.digital`. Kalau salah satunya
  mati, halaman tamu menjawab **alasannya** dengan kalimat kanonik (`mejaUnavailableReason`), bukan galat
  mentah Convex — tamu tidak diminta menebak kenapa menunya tidak hidup.

Kartu QR meja dicetak dari halaman **Dapur & Meja**: denahnya punya **Tampilkan QR** (sekali terbit,
idempoten), **Salin tautan**, **Ganti kartu**, dan **Cetak** — saat dicetak hanya kartunya yang terlihat.
Dasbor admin juga punya **Tambah meja**, **Ubah** (nama, kursi, zona — divalidasi ulang server, termasuk
nama yang unik per toko), **Geser** (satu langkah ke kiri/kanan, tombolnya mati di ujung denah),
**Aktif/Nonaktifkan**, **Hapus** (dengan dialog yang menampilkan pagar hapusnya lebih dulu), dan panel
**Impor beberapa meja** yang menampilkan pratinjau hasil aturan yang sama dengan server sebelum dikirim;
di halaman tamu, kartu pembayaran punya **Batalkan pesanan** dengan konfirmasi (“pesanannya tidak
diteruskan ke dapur”) yang setelah dibatalkan menggantikan kode bayarnya.
Pesanan QR yang tagihannya masih menunggu dibaca kasir di halaman **Pembayaran**: barisnya menyebut
**Pesanan QR meja <nama meja> · <nama tamu>** beserta nomor VA/tenggatnya, dan tombol pelunasannya
berbunyi **Lunasi & kirim ke dapur** (butuh izin `payment.manage`, izin yang sama dengan tagihan
digital) — pelunasannya memakai jalur tagihan digital yang sama, jadi penjualan & tiket dapurnya lahir
di titik itu juga. Tiket yang lahir dari pesanan itu membawa penanda **“Lunas QRIS dari meja”** atau
**“Lunas VA <bank> dari meja”** beserta **momen pelunasannya** (“diterima dapur pukul 13:42”), jadi
dapur tahu uangnya sudah diterima lewat kanal mana dan bahwa tiket itu masuk bersamaan dengan
uangnya. Di halaman tamu, mode demo punya tombol **Simulasikan pembayaran (mode demo)** supaya alurnya
bisa dicoba tanpa gateway; di mode Convex pelunasan dicatat sungguhan (kasir yang menekan
**Tandai lunas**/**Lunasi & kirim ke dapur** setelah uangnya masuk).

```bash
bun scripts/verify-meja.mjs          # 72/72: token `mj_`/`mjo_`, keranjang tamu, total tamu = total kasir, cara bayar QRIS/VA & nomor VA-nya, gambar QRIS (screenshot) bisa dipindai balik, pagar pembatalan tamu, dan “masih menunggu pelunasan” (`isAwaitingPayment`) (murni)
PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-meja-browser.mjs http://localhost:5173   # 93/93 di Chromium: kartu QR → tamu QRIS (unduhan PNG sungguhan) & tamu Virtual Account → tagihan dilunasi dari halaman Pembayaran → tiket dapur bertanda “Lunas QRIS/Lunas VA BRI dari meja · diterima dapur pukul HH:MM”, pesanan yang belum dibayar hanya dihitung di kartu antrean dapur (lencana jumlah + tombol ke Pembayaran yang benar-benar diklik, lalu kartu itu benar-benar berkilat — animasi `kilat` terpasang — dan saklar bunyinya bisa dimatikan dari kartu antrean itu sendiri tanpa mematikan kilatnya), tamu membatalkan pesanannya sendiri (mejanya kembali kosong), tambah/ubah/hapus/geser meja beserta penolakan pagar hapusnya, dan impor beberapa meja sekaligus
bun scripts/verify-backend.mjs       # rantai penuh di server: kartu QR → menu publik tanpa sesi → pesanan (QRIS & VA) → tagihan → lunas dari halaman Pembayaran → tiket dapur, pembatalan oleh tamu, tagihan QR yang dibatalkan kasir melepas pagar hapus meja, ubah/hapus meja, serta urutan denah (`tables.move`) & impor sekaligus (`tables.importBatch`) (837/837)
bun scripts/verify-render.mjs        # halaman tamu (pemilih cara bayar, kartu VA, tombol screenshot, tombol batal), alur tamu → dapur → Pembayaran dalam satu store (dapur hanya menerima yang lunas, tiket bertanda momen pelunasan), serta kartu QR + denah meja (dialog ubah/hapus, geser, impor) di DOM tiruan (832/832) — termasuk penghitung + tombol ke halaman Pembayaran yang menempel di kartu antrean dapur (bukan di kolom denah), bunyi & kilat notifikasi tagihan QR baru (satu kali per tagihan, tidak diulang saat layar dibuka ulang, mati bunyi = benar-benar senyap tetapi kilatnya tetap berjalan)
```

### Modul F&B: modifier item (level pedas, ukuran, topping)

Aturannya ada di `src/convex/lib/modifiers.ts`:

- **Grup & opsi disimpan sebagai kode**; label dibentuk saat transaksi dibuat dan disimpan di
  `saleItems.modifiers`, jadi mengganti tulisan “Telur” → “Telur Ayam” tidak mengubah riwayat struk.
- **`minSelect > 0` berarti wajib** — “wajib pilih level pedas” ditegakkan **server**, bukan hanya oleh
  dialog kasir.
- **Tambahan harga dihitung per unit yang dijual**, bukan per satuan dasar: 2×“+Telur 5.000” = 10.000,
  dan 1 Dus (24 Pcs) + Telur tetap 5.000 — kalau per satuan dasar, satu Dus akan mengalikan topping 24×.
- Urutan label **stabil** (urut konfigurasi produk, lalu kode opsi), supaya dapur dan struk membaca hal
  yang sama untuk pilihan yang sama.

Diatur dari halaman **Produk → Modifier** (`products.setModifiers`, izin `product.manage`); kode grup/opsi
diusulkan otomatis dari nama yang diketik, dan mengosongkan daftar selalu boleh — bahkan setelah modulnya
mati. Di kasir, menekan produk bermodifier membuka dialog pilihannya; labelnya muncul di baris keranjang
(bisa diubah lewat “Ubah modifier”) dan ikut ke kartu di layar **Dapur & Meja**.

Gerbang modulnya sama seperti fitur modul lain: memilih modifier butuh `pos.modifier`, mengubah
konfigurasi butuh `pos.modifier` + izin `product.manage`, dan produk yang punya modifier **ditolak
dijual** saat modul F&B mati — pilihan pelanggan tidak boleh hilang diam-diam.

### Modul Grosir: piutang B2B & credit limit

Aturannya ada di `src/convex/lib/ar.ts` (dipakai server, kasir, dan halaman Piutang):

- **Piutang disimpan per penjualan** (nota `AR-…`), bukan satu saldo per pelanggan, supaya umur
  piutang dan pelunasan sebagian bisa dilacak per nota.
- **Sisa limit selalu dihitung** (`limit − piutang terbuka`), bukan angka tersimpan yang bisa basi.
- **Limit dievaluasi server saat menjual.** Penjualan yang sisanya melebihi sisa limit, pelanggan
  tanpa limit (tunai saja), pelanggan nonaktif, atau pelanggan yang punya piutang **jatuh tempo**
  ditolak dengan pesan yang menyebut angkanya — jadi kasir tahu harus menagih dulu.
- **Nota lunas tidak memakai limit** lagi, dan kelebihan bayar ditolak (bukan dipangkas diam-diam).
- **Penjualan yang piutangnya sudah dibayar tidak bisa dibatalkan** — uangnya harus diselesaikan dulu.

Alurnya: kasir memilih pelanggan lalu mengisi **“Dibayar sekarang”** lebih kecil dari total
(`pos.createSale` dengan `customerId`); sisanya menjadi piutang bertempo (`paymentTermDays`) dan
ditagih di halaman **Piutang** (`/app/receivables`, izin `ar.view` untuk melihat, `ar.manage` untuk
mengubah limit & mencatat pelunasan — kasir hanya melihat sisa limit).

Dua pagar yang sengaja berbeda: **membuat piutang** butuh modul Grosir aktif (`ar.creditlimit`),
tetapi **menagih piutang lama** hanya butuh izin — mematikan modul tidak boleh membuat utang
pelanggan menjadi tak tertagih.

**Dashboard** merangkum total piutang, pecahan umurnya, dan daftar pelanggan menunggak beserta
nota terlama yang lewat tempo. Bagian ini mengikuti izin `ar.view`: peran yang tidak memilikinya
(mis. staf gudang) tidak melihat kartunya sama sekali, bukan melihat “Rp 0” yang menyesatkan.

Hal yang sama berlaku untuk sisi uang yang lain: Dashboard juga memuat **hutang usaha** (total
terbuka, yang lewat jatuh tempo, pecahan umurnya) dan **jatuh tempo terdekat** — daftar tagihan
supplier paling mendesak lebih dulu, termasuk yang sudah lewat, lengkap dengan sisa dan umurnya
(“lewat 45 hari”, “5 hari lagi”). Angkanya datang dari aturan `@/lib/payables` yang sama dengan
halaman Pembelian, dan kartunya hanya muncul untuk peran dengan izin `payable.view` (keuangan,
manajer, pemilik) — kasir dan staf gudang tidak melihatnya.

### Modul UMKM: member & diskon member

Aturannya ada di `src/convex/lib/loyalty.ts` (dipakai server, kasir, dan halaman Member; namespace
`loyalty` dipakai karena `src/convex/members.ts` sudah berarti **anggota tim**):

- **Diskon dihitung dari data member, bukan dari input kasir.** Kasir memilih member di POS; persentase
  diambil server dari catatan member, jadi angka diskon tidak bisa dititipkan lewat request.
- **Diskon member dan diskon manual digabung**, dan totalnya dipatok di subtotal; PPN dihitung setelah
  keduanya (diskon ≠ pajak).
- **Member nonaktif tidak mendapat diskon** — memilihnya ditolak dengan penjelasan, bukan diam-diam
  dijual tanpa diskon.
- Batas diskon 50% dan diskonnya dibulatkan ke rupiah terdekat.

Diatur dari halaman **Member** (`/app/members`, izin `member.view` untuk melihat, `member.manage` untuk
mengubah — kasir memakai diskon yang sudah ditetapkan, manajer/pemilik yang menentukannya). Gerbang
modulnya seperti fitur lain: diskon > 0 butuh modul UMKM aktif **dan** paket yang memuat
`member.discount` (Starter belum termasuk), sementara daftar member tetap bisa dibaca dan diskon bisa **ditutup** (0%) walau modulnya mati — mematikan modul tidak boleh membekukan data pelanggan.

## Supply chain (Phase 3): gudang & perpindahan stok

Fitur pertama Phase 3 adalah `inventory.multiwarehouse`. Aturannya ada di
`src/convex/lib/inventory.ts` (dipakai server, store, halaman Gudang & Stok, dan harness):

- **Stok dijual berasal dari lokasi jual.** Setiap toko punya satu lokasi jual yang
  **tidak** disimpan sebagai baris tabel — ia adalah bucket stok lama (`stockLevels`
  tanpa `warehouseId`). Jadi fitur ini menyala pada tenant lama tanpa migrasi stok,
  dan kasir tidak pernah menjual barang yang masih di gudang.
- **Gudang adalah lokasi penyimpanan tambahan.** Barang harus dipindahkan dulu ke
  lokasi jual sebelum bisa terjual, persis seperti stok fisik yang dibawa ke rak depan.
- **Satu perpindahan = dua baris ledger satu nomor (`TRF-…`).** Keluar dan masuk,
  sehingga total stok tidak pernah berubah karena pemindahan dan setiap perpindahan
  bisa ditelusuri.
- **Gudang yang masih menyimpan stok tidak bisa dinonaktifkan** — kalau tidak,
  stoknya hilang dari pandangan padahal fisiknya masih ada.

Gerbangnya sengaja tidak seragam:

- **Menambah gudang** butuh fitur `inventory.multiwarehouse` **dan** sisa slot paket
  (`limits.warehouses`, lokasi jual menempati satu slot) — inilah tindakan yang dibayar.
- **Memindahkan stok** hanya butuh izin `inventory.manage`. Kalau paket turun, gudang
  lama tetap harus bisa dikosongkan, bukan jadi stok yang terkunci.
- Izinnya dipisah seperti fitur lain: staf gudang & manajer/pemilik memegang
  `inventory.view` + `inventory.manage`; kasir menjual barang tetapi tidak memindahkan
  stok antar gudang, dan keuangan mencatat uang, bukan rak.

Halaman **Gudang & Stok** (`/app/inventory`) menampilkan lokasi, stok per lokasi beserta
kolom total, form pindah stok, dan riwayat perpindahan dari ledger. Halaman **Produk**
tetap menampilkan angka yang **bisa dijual** (lokasi jual), dan peringatan stok kritis
juga memakai angka itu — bukan stok gudang.

```bash
bun scripts/verify-inventory.mjs               # 42/42: aturan gudang & perpindahan stok (murni)
```

## Pembelian: PR · PO · GRN (`purchasing.basic`)

Fitur kedua Phase 3 adalah pembelian. Aturannya ada di `src/convex/lib/purchasing.ts`
(dipakai server, kedua store, halaman Pembelian, dan harness), dan satu arah alurnya:

- **PR — permintaan pembelian.** Staf gudang mengajukan barang & jumlah; pemilik atau
  manajer yang memutuskan (setuju/tolak). Yang **meminta bukan yang menyetujui**: staf gudang
  boleh membuat PR tetapi ditolak saat mencoba menyetujuinya, dan PR yang sudah diputuskan
  tidak bisa diputuskan dua kali.
- **PO — pesanan pembelian.** Dibuat dari PR yang **sudah disetujui**, oleh pemegang izin
  persetujuan, ke satu supplier. Jumlah per barang tidak boleh melebihi yang diminta di PR,
  dan satu PR hanya boleh punya satu PO hidup — PR yang PO-nya dibatalkan boleh dipesan ulang.
  PO kosong (belum ada barang datang) boleh dibatalkan; PO yang sebagian barangnya sudah masuk
  tidak, karena stok yang sudah diterima tidak boleh hilang dari catatan.
- **GRN — penerimaan barang.** Inilah satu-satunya cara stok bertambah dari pembelian.
  Penerimaan boleh sebagian dan berkali-kali sampai PO tertutup, boleh diarahkan ke **gudang**
  (atau lokasi jual kalau tidak diisi), tidak boleh melebihi sisa PO, dan tidak boleh memuat
  barang yang bukan bagian PO itu. Harga beli terakhir tersimpan ke `products.cost` sehingga
  form PO berikutnya terisi sendiri.

Supplier punya kode singkat otomatis dari namanya (`PT Sumber Rejeki` → `PSR`, ditambah angka
kalau sudah dipakai), kontak, dan tempo pembayaran 0–365 hari. Dari halaman Pembelian, supplier
yang sudah ada bisa **diatur** (nama, telepon, alamat, tempo, aktif) — kodenya tidak bisa diubah
karena sudah tercetak di PO lama, dan **mengubah tempo tidak menulis ulang jatuh tempo tagihan
lama**: setiap hutang menyimpan temponya sendiri saat lahir.

Gerbangnya dipisah dengan sengaja, sama polanya seperti multi-warehouse:

- **Membuat PR** butuh izin `purchase.request`; **menyetujui PR, membuat PO, membatalkan PO**
  butuh `purchase.approve`; **menerima barang** butuh `purchase.receive`; dan **melihat**
  dokumennya butuh `purchase.view`. Kasir tidak memegang satu pun izin itu — ia bahkan tidak boleh
  membuka daftar pembelian. Staf gudang meminta **dan** menerima barang, tetapi tidak menyetujui.
- **Membuat PR baru** ditolak kalau paket tidak memuat `purchasing.basic`.
- **Menerima barang tidak digerbang fitur.** Kalau paket turun atau fitur dimatikan setelah PO
  dibuat, barang yang sudah dipesan tetap harus bisa dicatat datang dan masuk stok; membekukan
  penerimaan hanya akan membuat stok hilang dari sistem padahal fisiknya tiba.

Halaman **Pembelian** (`/app/purchasing`) memuat bagian *Permintaan pembelian (PR)*, *Pesanan
pembelian (PO)*, *Penerimaan barang (GRN)*, *Supplier*, *Hutang usaha (AP)*, dan *Pencocokan 3 arah
(PO ↔ GRN ↔ tagihan)*, plus kartu
ringkasan — termasuk **nilai PO terbuka** yang dihitung dari sisa unit yang belum datang (PO 20
unit yang 8 di antaranya sudah diterima menyumbang 12 unit × harga beli, bukan nilai penuh PO).

### Hutang usaha: tempo supplier yang berujung

Tempo supplier bukan lagi kolom pajangan. Aturannya ada di `src/convex/lib/payables.ts` (dipakai
server, store demo, halaman, dan harness), dengan kosakata umur tagihan yang sama seperti piutang
(`AGING_BUCKETS`, `rupiah`) supaya laporan AP dan AR tidak bisa berbeda arti:

- **Hutang lahir dari penerimaan barang.** Setiap GRN dari supplier bertempo membuat satu hutang
  (`AP-00001`) dengan jatuh tempo = tanggal terima + tempo supplier, di transaksi yang sama dengan
  stoknya — jadi tidak ada barang masuk yang tagihannya terlupa.
- **Tempo 0 berarti bayar langsung.** Supplier tanpa tempo tidak menghasilkan hutang sama sekali,
  persis seperti pelanggan tanpa limit kredit yang tidak boleh punya piutang.
- **Tagihan di luar PO bisa dicatat manual** (saldo awal dari sistem lama, tagihan jasa) beserta
  nomor tagihan supplier, nilai, dan jatuh tempo yang **boleh sudah lewat** — justru itu gunanya:
  hutang lama tetap punya umur yang benar, bukan jatuh tempo palsu di masa depan.
- **Pembayaran boleh sebagian**, kelebihan bayar ditolak dengan menyebut sisanya (bukan dipangkas
  diam-diam), dan setiap pembayaran tercatat di `payablePayments` sebagai jejak audit.
- **Umur hutang ditampilkan** di halaman Pembelian **dan Dashboard**: total terbuka, yang lewat
  jatuh tempo, yang jatuh tempo ≤ 7 hari, empat keranjang umur, plus daftar **jatuh tempo terdekat**
  (tagihan paling mendesak lebih dulu, termasuk yang sudah lewat) — angka yang sama yang dipakai
  server saat menolak PO. Dashboard juga memuat **riwayat pembayaran supplier terakhir**: nomor
  `PAY-…`, tanggal, metode, totalnya, dan tagihan apa saja yang dibayar di dalamnya, supaya satu
  baris mutasi bank bisa dicocokkan tanpa membuka halaman Pembelian.
- **Supplier yang menunggak tidak dilayani PO baru.** Ini konsekuensi yang membuat tempo nyata:
  selama ada tagihan lewat jatuh tempo, `purchasing.createOrder` menolak dengan menyebut jumlah
  hutangnya, dan halaman menandai supplier itu di daftar supplier serta di pemilih supplier.
  Jalan keluarnya nyata: **bayar tagihannya**, atau nonaktifkan suppliernya.

Gerbangnya dipisah seperti fitur lain: **mencatat tagihan baru** (`createBill`) butuh fitur
`purchasing.basic`, tetapi **melihat dan membayar hutang tidak** — tagihan yang sudah tercatat
harus tetap bisa dilunasi walau paketnya turun, kalau tidak hutangnya menggantung karena perubahan
langganan. Izinnya juga terpisah: `payable.view` / `payable.manage` dipegang keuangan, manajer, dan
pemilik — **staf gudang yang menerima barang tidak memegangnya**, dan posisi hutang supplier pun
tidak dikirim ke perannya.

### Pencocokan 3 arah: PO ↔ GRN ↔ tagihan (`purchasing.threeway`)

Hutang usaha sudah lahir otomatis dari penerimaan barang, tetapi **tagihan yang dikirim supplier**
belum pernah dibandingkan dengan dua dokumen yang kita pegang sendiri: apa yang dipesan (PO) dan
apa yang datang (GRN). Selisih di situ adalah uang, dan selisih yang tidak dicatat adalah uang yang
hilang tanpa jejak. Aturannya ada di `src/convex/lib/threeway.ts` (dipakai server, kedua store,
halaman Pembelian, dan harness), dengan lima penjagaan:

- **Dokumen supplier dicatat apa adanya.** Nomor tagihan supplier, barisnya (kuantitas & harga yang
  **ditagih**), dan catatannya disimpan di tagihannya. **Totalnya dihitung dari baris** — bukan angka
  yang diketik terpisah — sehingga baris dan totalnya tidak pernah bertentangan dan pencocokan tidak
  bisa dibohongi lewat total saja. Mencatat dokumen dua kali untuk tagihan yang sama ditolak: hasil
  pencocokan yang sudah ditinjau orang tidak boleh ditimpa diam-diam.
- **Pencocokan selalu dihitung ulang, tidak pernah disimpan.** Status *Cocok* / *Ada selisih*
  diturunkan dari PO + GRN + dokumen supplier setiap kali dibaca, jadi tidak ada status yang bisa
  basi setelah salah satu dokumennya diperbaiki. Selisih dilaporkan per baris: **jumlah** (ditagih 12,
  diterima 10) dan **harga** (Rp 5.200 vs Rp 5.000 per unit) dipisah, plus nilai totalnya kalau yang
  kurang justru baris yang tidak ditagih sama sekali.
- **Selisih tidak menahan pekerjaan, tetapi menahan pembayaran.** Dua keputusan yang tersedia:
  **terima** — nilai hutang ikut **total tagihan supplier**, karena itulah yang harus dibayar — atau
  **sengketa** — nilai tetap seperti semula dan **pembayarannya ditahan** sampai sengketanya dicabut
  atau selisihnya diterima. Tanpa aturan itu, pencocokan 3 arah hanya jadi hiasan.
- **Menerima selisih tidak bisa dibatalkan diam-diam.** Nilai hutangnya sudah berubah, jadi mencabut
  keputusan itu akan menyembunyikan perubahan uang. Sebaliknya **sengketa boleh dicabut** kapan saja,
  dan sengketa tanpa alasan (minimal 3 karakter) ditolak — sengketa harus bisa dipertanggungjawabkan.
- **Satu kali bayar, satu nomor (`PAY-…`).** Beberapa tagihan bisa dilunasi sekaligus lewat transfer
  yang sama. Tetap **satu baris pembayaran per tagihan** (jejak auditnya sama seperti bayar satuan)
  dengan nomor batch yang sama, dan halaman menampilkan batchnya supaya rekonsiliasi bank cocok dengan
  transfernya. Satu tagihan bersengketa membatalkan **seluruh** batch, dan kelebihan bayar tetap
  ditolak seperti pembayaran satuan.

Halaman Pembelian menambahkan bagian **Pencocokan 3 arah (PO ↔ GRN ↔ tagihan)** berisi antreannya:
berapa tagihan menunggu dokumen, berapa yang perlu ditinjau beserta nilai selisih yang belum selesai,
berapa yang cocok, dan berapa yang disengketakan. Tagihan yang dokumennya belum dicatat bisa langsung
diisi dari baris penerimaan (GRN) — mencatat tagihan yang cocok tidak perlu mengetik ulang apa pun —
lalu selisihnya diputuskan di tempat yang sama.

Gerbangnya dipisah seperti pembelian: **mencatat dokumen supplier dan memutuskan selisih** butuh fitur
`purchasing.threeway`, tetapi **membayar hutang yang sudah tercatat tidak** — kalau tidak, tagihan
supplier menggantung hanya karena langganan berubah. Izinnya tetap `payable.view` / `payable.manage`.

```bash
bun scripts/verify-purchasing.mjs              # 60/60: aturan pembelian PR/PO/GRN (murni)
bun scripts/verify-payables.mjs                # 44/44: hutang usaha & tempo supplier (murni)
bun scripts/verify-threeway.mjs                # 84/84: pencocokan 3 arah & bayar batch (murni)
```

## Stock opname: hitung fisik & audit selisih (`inventory.opname`)

Fitur ketiga Phase 3 adalah stock opname. Aturannya ada di `src/convex/lib/opname.ts` (dipakai
server, kedua store, halaman Opname, dan harness), dan isinya satu prinsip:

- **Hasil hitung yang menang, bukan catatan.** Saat posting, stok lokasi dibuat sama persis dengan
  hasil hitung (`delta = hasil hitung − saldo terbaru`), bukan ditambah selisih terhadap snapshot.
  Kalau ada penjualan di tengah penghitungan, angka fisik tetap benar dan penjualan itu tidak
  dihitung dua kali. Contoh nyata dari harness: sesi dimulai di 48, kasir menjual 2 (rak 46), hasil
  hitung 43 → yang ditulis **−3**, sedangkan selisih auditnya tetap −5.
- **Snapshot adalah patokan selisih.** Baris sesi menyimpan `systemQty` saat sesi dimulai, dan
  `hasil hitung − systemQty` itulah angka yang dibaca audit — bukan angka yang menggantikan stok.
- **Baris yang belum dihitung bukan nol.** Posting hanya menerapkan baris yang sudah diisi; sisanya
  dibiarkan apa adanya, sehingga **hitung sebagian (cycle count)** berguna dan lupa mengisi tidak
  menghapus stok.
- **Satu sesi berjalan per lokasi.** Dua orang menghitung lokasi yang sama dengan dua snapshot hanya
  menghasilkan selisih palsu, jadi lokasi yang masih punya sesi `Berjalan` menolak sesi baru.
- **Sesi selesai/batal terkunci** — kalau salah, buat sesi baru; jejaknya tetap ada sebagai riwayat.

Alurnya: pemilik/manajer/staf gudang membuka **Opname** (`/app/opname`, izin `inventory.view` untuk
melihat, `inventory.manage` untuk bertindak), memilih lokasi (lokasi jual atau salah satu gudang),
lalu mengetik hasil hitung per baris. Selisih tiap baris tampil berwarna (lebih/kurang), progres
sesi terlihat, dan **Posting hasil hitung** menulis satu baris ledger beralasan `opname` per baris
yang berbeda — lengkap dengan nomor sesi sebagai `refId` dan catatan `systemQty → countedQty`.

Gerbangnya sengaja tidak seragam, seperti multi-warehouse: **membuat sesi baru** butuh fitur
`inventory.opname` (Enterprise), tetapi **melihat, menghitung, memposting, dan membatalkan sesi yang
sudah jalan tidak** — stok fisik sudah dihitung di rak, dan paket yang turun tidak boleh membuat
hasil hitungan itu hilang. Izinnya dipisah seperti fitur stok lain: kasir **tidak** memegang izin
`inventory.*`, jadi kasir tidak melihat menu Opname ataupun bisa menghitung.

```bash
bun scripts/verify-opname.mjs                  # 48/48: aturan stock opname & audit selisih (murni)
```

## Analitik lanjutan: margin, jam sibuk & temuan (`report.advanced`)

Slice pertama Phase 4. Laporan yang sudah ada menjawab *berapa* omzet hari ini; laporan ini
menjawab **kenapa** angkanya begitu dan **apa** yang harus dilakukan. Aturannya ada di
`src/convex/lib/analytics.ts` (dipakai server lewat query `reports.advanced`, kedua store, halaman
Laporan, dan harness), dengan lima prinsip:

- **Periode adalah hari kalender lokal, bukan 24 jam terakhir.** Pemilih 7 / 30 / 90 hari
  (default 30, dipotong di batas 1–90) membentuk rentang dari tengah malam lokal sampai tengah
  malam berikutnya memakai offset zona waktu klien (`timezoneOffsetMinutes`, WIB = 420) — jadi
  “hari ini” berarti hari ini di toko, bukan menurut UTC. Cek masa lalunya memakai periode
  **sama panjang** tepat sebelum periode ini, bukan “bulan lalu” yang panjangnya berbeda.
- **Grafiknya tidak boleh bolong.** Tren harian selalu berisi satu titik per hari di periode itu
  (termasuk hari tanpa penjualan, bernilai nol), dan jam (24 baris) serta hari (7 baris) selalu
  lengkap — itu yang membuat “hari paling ramai” dan “jam tersibuk” bisa dipercaya.
- **Margin dihitung dari omzet bersih, bukan nilai yang dibayar pelanggan.** PPN bukan pendapatan,
  jadi laba kotor = (omzet − PPN) − harga pokok. Harga pokok memakai `products.cost` **hari ini** ×
  jumlah terjual: ini **analitik**, bukan pembukuan historis — kalau harga beli berubah, margin
  periode lama ikut dihitung ulang, dan itu memang yang ingin dilihat pemilik. Produk yang belum
  punya harga beli **tidak** dianggap untung penuh: omzetnya dipisahkan sebagai
  `uncostedRevenue` dan temuan mengingatkan bahwa marginnya belum dihitung lengkap.
- **Rincian kategori memakai harga baris sebelum diskon.** Karena baris penjualan menyimpan harga
  sebelum diskon, total rincian kategori = omzet bersih **+ diskon** — dan harness menguji persamaan
  itu persis, supaya penjumlahan yang tidak cocok tidak bisa berlalu sebagai “pembulatan”.
- **Angka diubah jadi kalimat.** Temuan diurutkan **peringatan dulu**, memakai ambang yang bisa
  dibaca: omzet naik/turun ≥10%, margin <20% (periksa harga) atau ≥40% (sehat), satu produk
  menyumbang ≥40% omzet (ketergantungan), ada produk terjual di bawah harga beli, hari tanpa
  penjualan, jam tersibuk, dan hari paling ramai.

Dua bagian **enterprise** menutup laporan ini — keduanya dari baris penjualan yang sama, tanpa data
baru dan tanpa kueri tambahan:

- **Proyeksi akhir periode** memakai laju hari-hari **penuh** yang sudah lewat, bukan rata-rata
  seluruh periode: hari yang sedang berjalan akan menyeret rata-ratanya turun di pagi hari dan
  menaikkannya lagi sore hari, dan angka yang berubah mengikuti jam lebih buruk daripada proyeksi
  yang mengaku belum punya dasar. Jadi `elapsedDays` (hari penuh), `todayNet` (bagian hari yang
  sudah lewat), dan `netRunRate` dipisahkan; proyeksinya = hari-hari penuh + hari ini pada laju
  hariannya, dan **tidak pernah** lebih rendah daripada yang sudah masuk hari ini. Kalau belum ada
  satu hari penuh pun (periode baru mulai), `hasBasis` false dan yang ditampilkan adalah angka yang
  sudah tercatat — bukan ramalan. Pembandingnya juga bukan periode sebelumnya penuh, melainkan
  periode sebelumnya pada **jumlah hari penuh yang sama** (29 hari penuh diadu dengan 29 hari
  pertama periode lalu), supaya hari yang belum selesai tidak membuat lajunya selalu terlihat turun.
- **Analisis keranjang** menjawab “pelanggan biasanya belanja berapa barang, dan produk mana yang
  benar-benar dibeli **bersama**”. Ukuran keranjang dipecah empat rentang (1 / 2 / 3–5 / 6+ barang)
  beserta jumlah nota, pangsa, dan omzetnya; pasangan produk dihitung **sekali per nota** (dua baris
  produk yang sama tidak memasangkan produk dengan dirinya sendiri), lalu dilaporkan dengan pangsa
  nota (`supportPct`) dan **`lift`** — berapa kali lebih sering keduanya muncul bersama dibanding
  kalau keduanya saling bebas. Produk laris memang sering muncul di mana-mana, jadi pasangan yang
  sering tetapi ber-`lift` ≈1 bukan temuan. Pemindaian pasangannya **beranggaran** (`BASKET_PAIR_SCAN_LIMIT`,
  20.000 pasangan): satu nota dengan 60 jenis barang sudah 1.770 pasangan, jadi batasnya ada — dan
  kalau tersentuh, `truncated` **dilaporkan** ke halaman, berkas PDF/Excel, dan keterangannya,
  bukan disembunyikan.

Halaman Laporan (`/app/reports`, izin `report.view`) menambahkan bagian **Analitik lanjutan
(Enterprise)**: KPI omzet bersih / rata-rata keranjang / margin kotor lengkap dengan “vs periode
sebelumnya”, grafik tren omzet harian, daftar produk teratas & rincian per kategori (dengan porsi
omzet), jam tersibuk dan pola hari, daftar temuan, lalu **Proyeksi akhir periode** (proyeksi omzet
bersih / laba kotor / transaksi, laju per hari, dan perbandingan laju) serta **Keranjang & pasangan
produk** (sebaran ukuran keranjang, rata-rata barang per nota, dan daftar pasangan dengan pangsa &
`lift`). Angka yang sama ikut ke berkas yang diunduh sebagai tiga bagian baru — *Proyeksi akhir
periode* (11 baris), *Ukuran keranjang*, dan *Produk sering dibeli bersama* — jadi berkasnya tidak
bisa berbeda dari layar. Paket yang tidak memuat fiturnya tetap
melihat laporan harian seperti biasa plus alasan singkat **kenapa** analitik lanjutannya mati
(mis. “tidak termasuk paket Starter”) — bukan grafik kosong yang menyesatkan. Di store demo, angka
laporan ini dihitung dari riwayat penjualan yang sama dengan yang dibaca kasir, jadi menjual satu
produk langsung mengubah tren, margin, dan temuan di halaman Laporan.

Halaman yang sama juga memuat kartu **Pajak & pungutan F&B per bulan** (tanpa gerbang paket — izinnya
`report.view`): 12 bulan terakhir seluruh toko, dengan kolom omzet tercatat, PBJT, PPN, biaya layanan,
PPh final UMKM, PPh sewa, dan setoran pengusaha — aturannya dijelaskan di bagian **Pajak & pungutan
F&B** di README ini.

```bash
bun scripts/verify-analytics.mjs               # 81/81: aturan analitik lanjutan + proyeksi akhir periode & analisis keranjang (murni)
bun scripts/verify-fnb-tax.mjs                 # 126/126: laporan pajak & pungutan F&B per bulan (murni)
bun scripts/verify-render.mjs                  # 929/929: halaman Laporan dirender di DOM klien, termasuk tabel pajak F&B 12 bulan, proyeksi & keranjang
bun scripts/verify-laporan.mjs                 # 263/263: berkas PDF/Excel/CSV memuat ketiga bagian baru itu (angka, keterangan, lembar Excel-nya)
```

## Peran: dirancang sendiri **dan** peran bawaan yang disesuaikan (`rbac.custom`)

Slice kedua Phase 4. Peran bawaan (Pemilik, Manajer, Kasir, Staf Gudang, Keuangan) adalah kontrak
produk yang sudah dipisah tugasnya; yang tidak bisa dijawabnya adalah kebutuhan nyata tenant:
“kasir shift malam boleh menjual tetapi tidak boleh membatalkan transaksi”, “admin harga hanya
menyentuh katalog”. Lingkupnya **semua peran**, bukan hanya peran baru: tenant boleh membuat peran
kustom, **dan** menyesuaikan izin peran bawaan, menonaktifkannya, atau menghapusnya dari daftar
penugasan. Aturannya ada di `src/convex/lib/rbac.ts` + `src/convex/lib/roleSettings.ts` (dipakai
server lewat `requirePermission`, halaman Tim & Peran, kedua store, sesi klien, dan harness),
dengan lima prinsip:

- **Peran tambahan berdiri sendiri, bukan menambah.** Anggota yang ditugaskan ke sebuah peran
  kustom memakai daftar izin peran itu persis, dan **tidak** menumpang peran bawaan mana pun. Kalau
  hanya menambah, “kasir yang tidak boleh membatalkan transaksi” mustahil dibuat — peran bawaan
  kasir sudah punya izin itu. Karena berdiri sendiri, satu anggota hanya punya **satu** peran — yang
  tersimpan di baris keanggotaan adalah `role` (peran bawaan) **atau** `customRoleId` (peran
  tambahan), tidak pernah keduanya: `memberships.role` sengaja opsional, dan penugasan peran
  tambahan melepas peran bawaan yang tersimpan (`roles.assign`/`members.update`/store demo).
  Konsekuensinya, status sebuah peran bawaan (nonaktif atau dihapus dari daftar penugasan) **tidak**
  menghalangi penugasan peran tambahan, dan anggota yang peran tambahannya dilepas **tidak**
  diam-diam jatuh ke izin peran bawaan — ia tanpa peran sampai pemilik menugaskan peran berikutnya.
- **Tidak ada eskalasi lewat nama baru.** Pembuat peran tidak bisa memberi izin yang dia sendiri
  tidak punya, dan pagar itu berlaku lagi saat **menugaskan**: peran hasil buatan pemilik yang
  berisi `billing.manage` tetap ditolak bila yang menugaskan manajer. Tanpa pagar ini, satu peran
  bernama bagus cukup untuk naik wewenang.
- **Peran bawaan tidak bisa ditimpa namanya.** “Kasir”, “Manajer”, dan kunci Inggrisnya ditolak
  sebagai nama peran kustom (tanpa peka huruf besar-kecil, setelah spasi dirapikan) supaya daftar
  anggota tidak pernah memuat dua peran berbeda dengan nama yang sama.
- **Pemilik tenant selalu memegang seluruh izin.** Peran kustom tidak bisa ditugaskan ke pemilik —
  kalau bisa, tenant yang mengunci dirinya sendiri dari langganannya hanya karena salah klik tidak
  punya jalan pulang.
- **Data tidak pernah hilang karena perubahan paket.** Gerbangnya sengaja tidak seragam, mengikuti
  pola opname & multi-warehouse: **membuat/mengubah** peran dan **menugaskannya** butuh fitur
  `rbac.custom` (paket Enterprise), tetapi **melihat**, **melepas penugasan**, **menonaktifkan**, dan
  **menghapus peran yang tidak dipakai** selalu boleh. Peran yang masih dipakai anggota tidak bisa
  dihapus; peran yang dinonaktifkan otomatis tidak berlaku. Anggota yang **memang hanya** memakai
  peran tambahan tidak jatuh ke peran bawaan mana pun ketika peran itu dinonaktifkan/dihilangkan —
  ia tanpa izin sampai pemilik menugaskan peran lagi, dan halaman Tim & Peran menyebut keadaan itu
  apa adanya di kolom Peran (“Belum diberi peran”). Baris lama (ditulis sebelum 2026-10-17) yang
  masih menyimpan peran bawaan di samping peran tambahannya **dirapikan** lewat
  `members.cleanupLegacyRoles` (internal mutation, lihat di bawah), bukan dibiarkan menumpuk dan
  bukan dicabut aksesnya diam-diam.

### Membersihkan baris lama: peran bawaan + peran tambahan sekaligus

Baris keanggotaan yang ditulis sebelum aturan “satu anggota = satu peran” menyimpan dua peran: peran
bawaan (biasanya `cashier`) **dan** `customRoleId`. Kode sekarang tidak pernah menulis baris seperti
itu lagi, tetapi datanya tetap ada sampai dibersihkan. Pemersihnya internal mutation
`members.cleanupLegacyRoles` (`src/convex/members.ts`, aturan murninya
`legacyRoleCleanupDecision` di `src/convex/lib/team.ts`), dengan sifat:

- **Akses orangnya tidak berubah** — yang dilepas selalu peran yang **tidak berlaku** sekarang:
  peran tambahan yang sah (aktif, milik tenant yang sama) → peran bawaan yang dilepas; peran tambahan
  yang hilang/nonaktif/milik tenant lain → peran tambahannya yang dilepas sehingga peran bawaan yang
  tersimpan tetap berlaku.
- **Pemilik tetap Pemilik** — anggotanya `owner` selalu mempertahankan peran Pemilik (seluruh izin,
  termasuk `billing.manage`); peran tambahannya yang dilepas. Melepas peran Pemilik bisa
  menghilangkan pemilik aktif terakhir dan mengunci workspace dari langganannya sendiri.
- **Idempoten & bertahap** — baris yang sudah satu peran dilewati, dan satu panggilan memproses satu
  batch (bawaan 100 baris, maksimal 200) lalu menjadwalkan batch berikutnya sampai habis; batas
  baca/tulis satu transaksi Convex tidak pernah tersentuh.
- **Bisa diuji tanpa menulis** — `dryRun` hanya melaporkan baris dan keputusannya, dan
  `members.legacyRoleReport` (internal query, baca-saja) menghitung baris yang **masih** tersisa.

```bash
bunx convex run members:legacyRoleReport                       # baca-saja: baris lama yang tersisa + keputusannya
bunx convex run members:cleanupLegacyRoles '{"dryRun":true}'    # lihat apa yang akan diubah
bunx convex run members:cleanupLegacyRoles                      # rapikan (menjadwalkan batch berikutnya sendiri)
```
- **Peran bawaan diatur izinnya, bukan namanya.** Yang disimpan tenant ada di tabel `roleSettings`
  (izin, status aktif, penanda dihapus) — satu baris per peran bawaan. **Nama** peran bawaan sengaja
  tidak bisa diubah: `ROLE_LABELS` dipakai struk, sidebar, pesan penolakan, dan jejak audit, jadi ia
  harus sama di semua workspace. **Pemilik tenant dikunci** dari tiga-tiganya (`OWNER_ROLE_LOCK_REASON`):
  izinnya tidak bisa dipersempit, statusnya tidak bisa dimatikan, dan perannya tidak bisa dihapus —
  tenant tidak boleh terkunci dari langganannya sendiri. Pagar eskalasi di sini memakai izin
  **efektif** penyunting (sudah termasuk penyesuaian workspace), jadi manajer yang izinnya sudah
  dipersempit tidak bisa memakainya untuk mengembalikan izin yang tidak dia punya; karena itu tombol
  “Kembalikan izin bawaan” pun butuh fitur `rbac.custom`. Baris yang tidak menyimpan apa-apa
  **dihapus**, bukan dibiarkan kosong, supaya workspace baru berjalan persis seperti sebelum fitur
  ini ada.

Halaman **Tim & Peran** (`/app/team`, izin `team.manage`) memuat daftar anggota beserta **izinefektif** masing-masing, **satu daftar peran** dengan dua bagian — **Peran bawaan** (izin yang
berlaku + lencana “izin disesuaikan”, ubah izin, kembalikan izin bawaan, nonaktifkan/aktifkan,
Pulihkan, dan hapus dengan konfirmasi dua langkah) dan **Peran tambahan** (buat, ubah, aktif/nonaktif,
hapus; jumlah pemakainya ditampilkan) — serta satu editor peran berupa checklist izin yang
dikelompokkan. Keduanya satu daftar, bukan dua kartu terpisah: pengelolaan peran (buat, edit,
aktif/nonaktif, hapus) berfokus pada peran yang **ada**, dan peran tambahan yang dibuat langsung
muncul sebagai pilihan peran di formulir undangan. Pratinjau di editor memakai fungsi validasi yang
sama dengan server — termasuk untuk peran bawaan — jadi apa yang terbaca di layar itulah yang akan
dijawab backend.

Gerbangnya tiga lapis seperti fitur lain: menu sidebar dan rute memakai izin efektif yang sama
(`actingPermissions` di sesi klien, diisi `roles.myAccess` dari server — peran bawaan yang izinnya
diatur ikut terbaca dari `rolePermissions`), dan server memeriksa ulang setiap permintaan. Bukti
backend-nya bukan tampilan: kasir yang ditugaskan peran berisi `inventory.view` benar-benar bisa
membuka stok per gudang, dan **kehilangan** `ar.view` yang tadinya bawaan — pesan penolakannya
menyebut peran kustom yang berlaku; izin yang dilepas dari **peran bawaan** pun langsung ditolak
server, sementara izin yang dipertahankan tetap bekerja.

```bash
bun scripts/verify-rbac.mjs                    # 48/48: aturan peran kustom (murni)
bun scripts/verify-role-settings.mjs           # 62/62: aturan peran bawaan — izin, status, hapus/pulihkan, pagar Pemilik, aksi kartu halaman (murni)
bun scripts/verify-team.mjs                    # 61/61: nomor WA, pesan wa.me, isi email undangan (peran tambahan disebut sebagai **satu** peran, bukan “Kasir (peran kustom: …)”), nilai pemilih peran gabungan (`roleChoiceValue`/`parseRoleChoice` — peran tambahan tidak membawa peran bawaan mana pun), pagar ubah/nonaktif/hapus anggota, dan keputusan pembersihan baris lama (`legacyRoleCleanupDecision`: peran tambahan sah → peran bawaan dilepas; peran tambahan hilang/nonaktif/tenant lain → peran tambahan dilepas; Pemilik tetap Pemilik) (murni)
bun scripts/verify-backend.mjs                 # 924/924: di antaranya cek peran kustom & peran bawaan di backend — jalur **undangan dengan peran kustom** (tersimpan di keanggotaan baru tanpa peran bawaan, `null` melepasnya, peran nonaktif ditolak, pemilik ditolak, eskalasi manajer ditolak), undangan berperan tambahan yang **tetap diterima walau Kasir dinonaktifkan** sementara undangan berperan bawaan Kasir ditolak, **`roles.myAccess`/`roles.effective` yang melaporkan `role: null` + `rolePermissions: []`** untuk anggota berperan tambahan, peran tambahan yang dilepas **tidak** jatuh ke peran bawaan, dan pengangkatan pemilik yang **melepas** peran tambahan yang menempel, plus izin yang dilepas ditolak server dan pemisahan dapur/kas dari `pos.sell`
bun scripts/verify-render.mjs                  # 946/946: halaman Tim & Peran — satu daftar peran (ubah izin, nonaktifkan, kembalikan, pulihkan, hapus) & peran tambahan diklik di DOM tiruan, termasuk **satu pemilih peran** di formulir pendaftaran anggota baru (peran bawaan + peran tambahan, tanpa pemilih kedua), kolom Peran di daftar anggota yang benar-benar menggantikan peran, dan formulir Ubah yang tidak lagi menanyakan peran
bun scripts/verify-role-coverage.mjs           # 61/61: audit cakupan — 21 menu (20 berizin + Profil), 29 izin semuanya punya gerbang server & tampil di checklist, token asing 0, izin lintas-menu dicatat
```

### Cakupan peran: apa yang sudah bisa diatur merchant, dan apa yang belum

`scripts/verify-role-coverage.mjs` menjawab pertanyaan yang tidak dijawab harness lain: **semua yang
terlihat di aplikasi sudah masuk ke sistem peran atau belum?** Hasil audit pada keadaan sekarang:

- **Menu: 21, semuanya bermuara pada izin** kecuali `/app/profil` — halaman profil orang yang sedang
  masuk, dan kartu **profil usaha** di dalamnya tetap dijaga `billing.manage`. Setiap izin menu juga
  tampil di checklist Tim & Peran dan dipegang Pemilik, jadi tidak ada halaman yang tidak bisa dibuka
  pemiliknya sendiri.
- **Izin: 29, sembilan grup checklist, semuanya punya gerbang `requirePermission`/`requireFeature` di
  server** — tidak ada izin hantu yang tampil di checklist tetapi tidak mengatur apa pun. Empat belas
  di antaranya hanya menjaga tombol/aksi di dalam halaman (mis. `pos.void`, `purchase.approve`,
  `payment.manage`) dan memang tidak punya menu sendiri.
- **Fitur modul:** fitur yang menjadi gerbang menu (`pos.kds`, `ar.creditlimit`, `member.discount`)
  semuanya ada di katalog paket dan modul. Empat fitur tidak punya gerbang peran karena memang bukan
  pekerjaan staf (`pos.quickgrid`, `peripheral.escpos`, `report.daily`, `inventory.basic`) — ia hidup
  mengikuti paket/perangkat, bukan peran.

Yang **belum** bisa dipisah merchant, dan tercatat sebagai inventaris di harness (penambahan menu ke
izin yang sama akan menggagalkan cek sampai diputuskan):

| Izin | Menu yang ikut | Akibatnya |
| --- | --- | --- |
| `billing.manage` | Modul, **Pengaturan**, Langganan | Setelan operasional (PPN, pajak & pungutan F&B, struk, logo, printer, jam operasional, pengingat shift) menumpang izin tagihan. Merchant tidak bisa memberi manajer operasional akses setelan struk/printer tanpa sekaligus memberi akses langganan. |
| `inventory.view` | Gudang & Stok, Opname | Melihat opname selalu ikut dengan akses gudang; belum ada izin opname tersendiri. |
| `report.view` | Dashboard, Laporan, **Panduan** | Panduan operasional hanya terbaca oleh yang boleh melihat laporan; kasir/staf gudang tanpa `report.view` tidak bisa membukanya. |

**Yang sudah diperbaiki dari daftar ini:** dapur dan kas tidak lagi menumpang `pos.sell` — keduanya
kini punya izin sendiri, `kds.manage` (menu & antrean Dapur, tiket dapur, termasuk menutup tiket dari
peran kustom “dapur saja”) dan `shift.manage` (menu Shift & Kas, buka/tutup kas, serta kabar kas ke
pemilik toko). Peran bawaan Pemilik, Manajer, dan Kasir memegang keduanya supaya tidak ada kemampuan
yang hilang; staf gudang dan keuangan tidak diberi keduanya, sama seperti sebelumnya. Satu hal yang perlu diketahui merchant: penjualan
menuntut shift terbuka, jadi peran yang **menjual** harus memegang `pos.sell` **dan** `shift.manage` —
halaman Kasir sudah mengatakannya apa adanya saat izinnya kurang (tidak lagi menawarkan tombol menuju
halaman yang tertutup untuknya).

Dua ketidakcocokan kecil yang juga ditemukan audit, sengaja **belum** diubah karena menyangkut
kontrak produk:

1. Rute **Produk & Stok** dijaga `stock.adjust`, sedangkan halamannya berisi aksi `product.manage` dan
   `category.manage`. Peran kustom yang boleh mengelola produk tetapi tidak boleh menyesuaikan stok
   bisa melihat tombolnya di checklist, tetapi tidak bisa membuka halamannya.
2. Mengubah izin **peran bawaan** memerlukan fitur `rbac.custom` (paket Enterprise) — sama seperti peran
   kustom. Di paket lain tombol **Ubah izin** masih tampil, dan penolakan baru muncul saat menyimpan;
   spanduk “Peran kustom terkunci” belum menyebut izin peran bawaan ikut terkunci.

## Akun platform: pengembang di luar RBAC tenant

Akun pengembang **bukan peran**. Seluruh peran aplikasi ini hidup di `memberships` dan selalu terikat
satu tenant, jadi apa pun yang ditambahkan ke `ROLES`/`ROLE_LABELS` otomatis terlihat — dropdown
peran di halaman Tim, label peran di sidebar dan halaman API, sampai cek harness. Karena itu akun
platform tinggal di tempat lain: penanda `users.platformRole`, dengan keanggotaan hanya di
**workspace yang ia dirikan sendiri** — ia boleh punya dashboard sendiri, tetapi tidak pernah ada di
tenant orang lain. Aturannya ada di satu modul murni `src/convex/lib/platform.ts`, dipakai
`src/convex/platform.ts`, `lib/access.ts`, jalur undangan di `members.ts`, dan harness.

- **Tak terlihat di tenant orang lain karena tidak punya baris untuk ditemukan.** `members.list`
  membaca `memberships` per tenant, `tenants.listMine` membaca membership milik pemanggil, dan setiap
  gate izin berangkat dari `requireMembership`. Akun yang bukan anggota memang tidak pernah muncul —
  tidak ada penyaringan khusus yang bisa lupa dipasang.
- **Keanggotaannya hanya bisa lahir dari `tenants.create` (mendirikan workspace sendiri).** Jalur
  undangan ditutup di server: `members.add` menolak mengundang akun platform
  (`membershipAssignmentError`), jadi satu kali undangan tidak cukup untuk membuatnya muncul di tim
  orang lain. Workspace sendiri tetap boleh — di situ ia memang pemiliknya, dan menyembunyikannya
  justru membuat workspace tanpa pemilik (`visibleInTenantSurfaces({ ownsTenant: true })`).
- **Workspace sendiri tidak bisa didampingi lewat jalur platform.** `platform.impersonate` menolak
  tenant yang ia dirikan sendiri: masuk ke sana lewat keanggotaan pemilik, bukan lewat sesi berjejak
  — kalau tidak, “kapan pengembang masuk” ikut menghitung saat ia membuka dashboard-nya sendiri.
  Tautan ke dashboard itu ada di backstage, di baris **Workspace saya**.
- **Gerbangnya lebih ketat daripada gate tenant:** `requirePlatformDeveloper` menolak
  `verified: false` **walaupun** `ALLOW_UNVERIFIED_ACTOR` masih `true`. Pasangan gate tenant boleh
  longgar selama transisi menuju provider autentikasi; akun tersembunyi tidak — kalau boleh, ia hanya
  berarti “akun yang bisa dipakai siapa pun yang menebak satu id”. Urutannya juga menutup enumerasi:
  identitas diperiksa **sebelum** peran platform dibaca, jadi pemanggil anonim mendapat penolakan yang
  sama baik untuk akun biasa maupun akun platform.
- **Hanya akses deployment yang bisa membuatnya.** `platform.grant`/`platform.revoke` adalah
  **internalMutation**, jadi tidak bisa dipanggil klien aplikasi — diuji apa adanya di harness
  (`bun convex run platform:grant …`).
- **Selama tidak menolong, tidak ada baris `auditLogs` atas namanya.** Tabel audit terikat tenant,
  jadi mencatat tindakan platform yang tidak menyangkut tenant mana pun berarti memilih satu tenant
  untuk membocorkan keberadaan akun ini kepadanya. Aturannya berbalik hanya saat ia mendampingi —
  di situ tenant memang harus tahu (lihat bagian di bawah).

### Pendampingan tenant: impersonasi berjejak (`/platform`)

Akun platform tidak pernah mendapat izin tenant — kalau ia “masuk sebagai anggota”, ia justru jadi
anggota palsu, dan itu yang dilarang. Bantuannya karena itu bukan izin, melainkan **sesi
pendampingan** yang dibuka sadar dan berjejak. Aturannya ada di satu modul murni
`src/convex/lib/impersonation.ts`, dipakai `src/convex/platform.ts`, gerbang
`requireImpersonation` di `lib/access.ts`, pekerja perapian di `crons.ts`, halaman backstage, dan
harness.

- **Ada sebabnya.** Setiap sesi wajib membawa alasan tertulis (10–200 karakter, spasi dirapikan).
  Alasan itu ikut ke jejak audit, jadi “kenapa” tersimpan bersama “kapan” — bukan sekadar “ada orang
  platform membuka data Anda”.
- **Ada batas waktunya, dan kedaluwarsa tidak menunggu pekerja.** Sesi mati sendiri setelah 30/60/120
  menit; `impersonationStatus` menghitungnya **saat dibaca**, sehingga jeda antarputaran pekerja
  terjadwal tidak pernah menjadi jendela akses. Pekerja (`crons.ts`, tiap 30 menit) hanya merapikan
  baris mati supaya jejaknya berakhir rapi.
- **Satu sesi hidup per pengembang.** Dua sesi bersamaan membuat jejak audit tidak bisa dipastikan
  milik sesi yang mana, jadi yang kedua ditolak dengan alasan yang menyebut tenantnya.
- **Hanya membaca.** `helpTenant` mengembalikan ringkasan bantuan (identitas tenant, anggota, toko)
  dengan batas baca (`membersTruncated`/`storesTruncated`), dan tetap **tidak ada `Permission` tenant
  yang menyala** — sesi ini tidak bisa mengubah apa pun di dalam tenant.
- **Setiap pembacaan tercatat.** `helpTenant` sengaja *mutation*, bukan query: ia menambah `helpCount`
  dan `lastHelpAt` pada sesi lalu menulis satu baris audit. Bacaan yang teraudit memang bukan bacaan
  biasa.
- **Ketak-terlihatan berbalik hanya di sini.** Sesi membuka & menutup **menulis `auditLogs` milik
  tenant yang dibantu** dengan penanda `source: "platform"` di `meta`, lengkap dengan nama & email
  pengembangnya. Yang disembunyikan adalah keberadaan akun ini; kunjungan ke data tenant tidak.
  Tenant membacanya lewat `platform.impersonationTrail` (izin `team.manage`, jadi pemilik/manajer),
  dan penyaringnya membaca **isi meta**, bukan `actorId` — baris yang kebetulan punya actor itu tidak
  ikut terbaca sebagai kunjungan.
- **Gerbangnya empat lapis, bukan satu.** `requireImpersonation` memeriksa: identitas/platform
  (lebih ketat daripada gate tenant), baris sesinya ada, sesi itu **milik aktor ini**, dan sesinya
  masih hidup — sebuah id sesi yang bocor pun tidak cukup untuk memakai sesi orang lain.
- **Jejak di sisi platform juga ada.** `platform.myImpersonations` memberi pengembang rekap sesinya
  (hidup/kedaluwarsa/ditutup, jumlah baca, total menit); `platform.tenantDirectory` — satu-satunya
  bacaan lintas-tenant di backend — hanya menerima akun platform terverifikasi dan isinya tipis
  (identitas & paket, bukan data operasional).

Halaman backstage `/platform` hidup **di luar `/app`** dan tanpa `RequireTenant`, karena akun platform
tidak punya keanggotaan di tenant orang lain. Ia juga sengaja **tidak punya tautan di menu mana pun**:
keberadaan akun platform tidak boleh bisa ditemukan dari dalam tenant, jadi jalan masuknya hanya
alamat itu. Seluruh panggilan server di halaman itu dilakukan di dalam penangan kejadian dengan
`try/catch`, sehingga penolakan identitas tampil sebagai pesan, bukan halaman kosong; di mode demo ia
menampilkan keadaan terkunci.

Sisi lain aturan itu adalah jalur yang paling gampang hilang: penyambungan workspace ke server bisa
**gagal**, dan dulu kegagalan itu hanya tersimpan di `store.error` tanpa pernah dirender — sehingga
satu-satunya umpan balik yang terlihat adalah pesan gerbang aksi “Tenant belum siap. Coba lagi
sebentar lagi.”, yang menyuruh menunggu untuk penolakan yang menunggu tidak akan menolong.
Sekarang kegagalan penyambungan tampil sebagai notis di shell `/app`
(`components/ProvisioningNotice.tsx`) berisi **kalimat server apa adanya** plus petunjuk tindakan;
pesan gerbang aksi di store ikut menyebut sebabnya (`Tenant belum tersambung ke server: …`).

```bash
bun scripts/verify-impersonation.mjs           # 52/52: alasan, batas waktu, keputusan sesi (termasuk penolakan workspace sendiri), jejak audit (murni)
bun scripts/verify-authz.mjs                   # 89/89: termasuk 10 cek kebijakan akun platform (murni)
bun scripts/verify-render.mjs                  # termasuk backstage terkunci + rute /platform tanpa keanggotaan
bun scripts/verify-backend.mjs                 # termasuk 17 cek akun platform & pendampingan terhadap backend nyata (mendirikan workspace sendiri, pagar undangan, sesi berjejak)
bun convex run platform:grant '{"email":"dev@contoh.id","name":"Pengembang"}'   # hanya akses deployment
bun convex run platform:sweepExpiredImpersonations '{"limit":50}'                # perapian sesi kedaluwarsa
```

## Akses API & webhook: integrasi keluar (`api.access`)

Slice ketiga Phase 4. Sampai di sini MesinPOS hanya bisa dilihat manusia lewat antarmuka; slice ini
membuat datanya bisa dipakai sistem lain — dan itu berarti dua janji yang harus ditepati: **kunci
API yang bocor tidak membuka lebih dari izin pembuatnya**, dan **kegagalan kirim tidak hilang
diam-diam**. Aturannya ada di dua modul murni, `src/convex/lib/apiKeys.ts` dan
`src/convex/lib/webhooks.ts`, dipakai bersama oleh endpoint HTTP (`src/convex/http.ts`), halaman API
& Webhook, kedua store, aksi kirim uji, dan harness.

Kunci API:

- **Bentuknya `mp_<publicId>_<secret>`.** `publicId` adalah indeks pencarian yang tidak rahasia
  (boleh tampil di daftar, memakai alfabet tanpa huruf mudah tertukar), sedangkan `secret` **tidak
  pernah disimpan**: yang tersimpan hanya `sha256(publicId + ":" + secret)`. Memasukkan `publicId` ke
  dalam hash berfungsi sebagai salt — bocornya isi tabel tidak langsung memberi kunci yang bisa
  dipakai, dan hash satu baris tidak bisa dipindah ke baris lain.
- **Scope tidak boleh melebihi izin pembuatnya**, dan pagar itu hidup: kunci buatan anggota yang
  ditugaskan ke peran kustom hanya boleh memuat scope yang dipunyai peran itu, dan **kunci ikut
  menyempit begitu izin pembuatnya dicabut** — tanpa perlu mencabut kunci satu per satu.
- **Verifikasi memeriksa bentuk dulu, status kemudian, baru rahasianya** (dibandingkan
  waktu-konstan), sehingga kunci yang salah bentuk tidak pernah menyentuh hash dan pesan
  penolakannya bisa ditindaklanjuti (dicabut / kedaluwarsa / bukan milik tenant ini).
- Scope yang boleh dipilih diturunkan dari endpoint yang benar-benar dilayani (`API_RESOURCES`),
  jadi tidak ada scope yang ditawarkan di halaman tapi tidak dipakai siapa pun.

Endpoint HTTP yang dilayani: `GET /api/v1/ping`, `/api/v1/sales`, `/api/v1/products`, dan
`/api/v1/payables`, plus satu endpoint tulis `POST /api/v1/sales`; dibaca/ditulis dengan header
`Authorization: Bearer mp_…` di domain `<deployment>.convex.site`. Urutannya penting: tanpa kunci →
401, resource asing → 404, scope kurang → 403, dan tidak ada data tenant yang tersentuh sebelum
kuncinya sah (di jalur tulis pun kuncinya diperiksa **sebelum** badan pesan diurai).

Pesanan masuk dari sistem luar (aturan murni di `src/convex/lib/apiOrders.ts`):

- **Produk ditunjuk dengan `sku`**, bukan id Convex — sistem luar tidak pernah melihat id internal,
  dan pencocokannya tidak peka huruf besar-kecil (`kopi-susu` = `KOPI-SUSU`). `unitCode` boleh diisi
  untuk satuan besar modul Grosir; `modifiers` belum didukung dan ditolak dengan penjelasan, bukan
  diabaikan diam-diam.
- **Harga tidak pernah diterima dari luar.** Harga, harga bertingkat, diskon member, dan PPN dihitung
  server lewat jalur yang sama dengan kasir (`pos.createSale`), jadi `payment.amount` boleh
  **dihilangkan** — artinya “tagih tepat sebesar total yang kamu hitung”. Field harga apa pun di
  kiriman ditolak sebagai field asing.
- **`idempotencyKey` wajib** (8–64 karakter), dan disimpan per tenant (`api:<tenantId>:<kunci>`) —
  sistem luar yang mengirim ulang karena jaringannya gagal mendapat **penjualan yang sama** (HTTP 200)
  alih-alih penjualan kedua (HTTP 201).
- **Kunci bertindak sebagai pembuatnya.** Penjualannya tercatat atas nama pemilik kunci, memakai izin
  & audit orang itu; kunci tidak pernah punya wewenang sendiri, jadi kunci buatan kasir tidak bisa
  menjual barang yang kasirnya sendiri tidak boleh jual.
- **Keputusan bisnis tetap milik jalur kasir.** Stok kurang, modul mati, atau sisa tagihan tanpa
  pelanggan B2B dijawab **409** dengan pesan dari `pos.createSale` apa adanya, sedangkan bentuk
  kiriman yang salah dijawab **400**; tidak ada penjualan parsial.

Webhook keluar:

- **Hanya event katalog yang bisa dilanggan** (`sale.completed`, `sale.voided`, `stock.low`,
  `opname.posted`, `payable.due`, `receivable.overdue`), ditulis `objek.aksi` supaya namanya stabil
  walau labelnya berubah.
- **URL wajib HTTPS dan host publik.** Webhook ke `http://`, ke `localhost`/`10.x`/`192.168.x`, atau
  ke nama mesin tunggal ditolak dengan alasan yang terbaca — itu cara termudah membocorkan data
  penjualan.
- **Setiap kiriman ditandatangani** HMAC-SHA256 atas `timestamp.body` (`sha256=<hmac>`), dikirim lewat
  header `x-mesinpos-signature` + `x-mesinpos-timestamp`, dan penerima bisa menolak kiriman basi
  (toleransi 5 menit). Tanda tangannya dihitung dengan HMAC-SHA256 yang diuji vektor NIST/RFC 4231 dan
  dicocokkan dengan `node:crypto`.
- **Kegagalan dijadwalkan lalu berhenti:** jeda percobaan dihitung aturan murni (1 → 5 → 30 → 120
  → 720 menit, ± 14,6 jam) dan setelah percobaan kelima statusnya `failed` yang kelihatan di halaman
  — bukan antrean tak berujung.
- **Jadwal itu benar-benar dijalankan pekerja terjadwal.** `src/convex/crons.ts` menjalankan
  `apiAccess.retryDueDeliveries` tiap 1 menit: ia mengambil kiriman `pending` yang jadwalnya sudah
  lewat lewat indeks `by_status_next_attempt` (bukan memindai riwayat), mengirim ulang dengan tanda
  tangan yang sama seperti kiriman biasa — ditambah header `x-mesinpos-attempt` berisi percobaan ke
  berapa — lalu mencatat hasilnya kembali ke riwayat, jadi jadwal berikutnya tetap dihitung aturan
  murni. Satu penerima yang bermasalah tidak menahan antrean penerima lain, dan yang **mematikan
  endpoint** menghentikan sisa percobaannya: kiriman yang menggantung ditutup sebagai `failed`
  (bukan dikirim diam-diam, bukan pula menunggu selamanya).

- **Event transaksi benar-benar berangkat.** Penjualan selesai (`sale.completed` — termasuk pesanan
  F&B yang baru di-finalize dan pesanan masuk lewat `POST /api/v1/sales`), pembatalan
  (`sale.voided`), stok yang **baru menembus** ambang kritis (`stock.low` — sekali per kejadian,
  bukan tiap penjualan selama stoknya masih rendah), dan opname yang diposting (`opname.posted`)
  menulis kiriman ke semua endpoint aktif yang melanggannya. Barisnya ditulis **di dalam transaksi**
  (penjualan yang batal tidak meninggalkan kiriman), sedangkan pengirimannya lewat pekerja yang
  sama: satu putaran dipanggil begitu transaksinya tersimpan, dengan cron sebagai jaring pengaman.
- **Event berbasis kalender punya pekerja hariannya sendiri.** `payable.due` dan
  `receivable.overdue` adalah keadaan yang berubah karena **waktu**, bukan karena transaksi, jadi
  `crons.ts` menjalankannya **harian**: `payables.notifyDuePayables` dan
  `ar.notifyOverdueReceivables` mengambil dokumen lewat indeks `(dueNotified, dueDate)` /
  `(overdueNotified, dueDate)`, memeriksa syaratnya dengan aturan murni yang sama dengan lencana di
  halaman (`needsDueReminder` / `needsOverdueReminder`), lalu menulis kirimannya. Tiap dokumen
  ditandai **sekali** — tagihan yang sama tidak dikabarkan setiap hari — dan pencariannya dibatasi
  jendela 60 hari supaya dokumen yang tidak pernah perlu diberitahukan (mis. tagihan yang dibayar
  sebelum jatuh tempo) tidak menumpuk di depan antrean dan membuat dokumen yang benar-benar jatuh
  tempo kelaparan. Penandanya ditulis **sejak dokumen lahir**: indeks Convex hanya memuat baris yang
  kolomnya memang bernilai `false`, jadi baris tanpa kolom itu tidak akan pernah ditemukan pekerja.

Isi kiriman tidak berubah antar-percobaan: id di dalam badan kiriman tetap sama, jadi penerima bisa
mengenali percobaan ulang sebagai **kiriman yang sama** (bukan penjualan kedua) walau cap waktu &
tanda tangannya selalu baru. `id`-nya memuat penanda kejadian (nomor struk, SKU, nomor opname),
sehingga dua penjualan pada milidetik yang sama tidak pernah berbagi id — penerima yang memakai id
untuk menolak kiriman kembar tidak membuang penjualan yang sah.

Halaman **API & Webhook** (`/app/api`, izin `api.manage`) menampilkan kunci beserta scope, pembuat,
masa berlaku & pemakaian terakhir; daftar endpoint webhook beserta langganan event-nya; riwayat 20
kiriman terakhir dengan jadwal percobaan berikutnya; serta dokumentasi endpoint `/api/v1` dan contoh
`curl`. Rahasia kunci dan rahasia webhook hanya tampil **sekali** saat dibuat (dan bisa diputar),
karena yang disimpan server memang bukan rahasianya. Gerbangnya mengikuti pola slice sebelumnya:
**membuat** kunci/endpoint dan **mengubah langganan** butuh fitur `api.access` (paket Enterprise) +
izin `api.manage`, sedangkan **mencabut kunci**, **mematikan/menghapus endpoint**, dan **melihat
daflarnya** selalu boleh — mencabut akses tidak boleh ikut terkunci saat paket turun.

```bash
bun scripts/verify-api.mjs                     # 225/225: aturan kunci, webhook, pekerja retry & pemicu event/kalender (murni)
bun scripts/verify-backend.mjs                 # termasuk penjualan nyata lewat POST /api/v1/sales & pemicu kalender
bun scripts/verify-render.mjs                  # halaman API & Webhook (termasuk endpoint tulis)
# pekerja terjadwal: menunggu jadwal sungguhan (~2 menit) di deployment Convex
VITE_CONVEX_URL=https://<deployment>.convex.cloud bun scripts/verify-webhook-retries.mjs   # 6/6
```

## Dukungan khusus: tiket dengan janji tanggap (`support.dedicated`)

Klausa pertama Phase 5. Sampai di sini “dukungan” berarti sebuah alamat surel; sekarang janji
tanggapnya **terukur** — dan itu menuntut tiga hal yang tidak boleh dikompromikan: janji yang
**dipatok saat tiket dibuat**, status yang hanya berubah lewat jalur yang sah, dan riwayat yang
tidak bisa ditulis ulang. Aturannya ada di satu modul murni `src/convex/lib/support.ts`, dipakai
bersama oleh `src/convex/support.ts`, halaman Dukungan, kedua store, dan harness.

Janji tanggap per paket (target prioritas Normal):

- **Starter** — Email dukungan, **48 jam**.
- **Professional** — Email prioritas, **24 jam**.
- **Enterprise** — Kanal langsung + manajer akun, **8 jam**.

Prioritas mengalikan target itu (Mendesak ×0,25 · Tinggi ×0,5 · Normal ×1 · Rendah ×2), dengan
lantai **1 jam** — janji “tanggap dalam 0 jam” tidak bisa ditepati siapa pun. Jadi tiket Mendesak di
Enterprise berjanji 2 jam, sementara tiket Rendah di Starter 96 jam.

- **Fitur `support.dedicated` tidak mengunci tiket — yang dijual adalah jalur cepatnya.** Prioritas
  Tinggi & Mendesak serta eskalasi ke manajer akun butuh fiturnya; membuka tiket Normal/Rendah,
  menambah catatan, menutup, dan membuka ulang **selalu boleh**, termasuk setelah paket turun.
- **Janji itu dipatok, bukan dihitung ulang.** Setiap tiket menyimpan jam tanggapnya saat dibuat;
  paket yang naik/turun tidak menulis ulang janji untuk tiket yang sudah masuk — penerima janjinya
  pelanggan, bukan sistem.
- **Prioritas di luar kemampuan paket ditolak dengan penjelasan**, bukan diam-diam diturunkan ke
  Normal: pelanggan yang mengira tiketnya jalur cepat akan menunggu dengan janji yang salah.
- **Status hanya berubah lewat jalur yang sah:** `open → in_progress → resolved`, dan
  `resolved → open` (buka ulang). Menutup tiket **wajib** menyebut penyelesaiannya (5–1000 karakter);
  tiket “selesai” tanpa keterangan tidak menolong siapa pun yang membacanya enam bulan lagi.
- **Riwayatnya append-only dan terbatas:** tiap aksi menambah satu baris catatan, maksimal 25 tiket
  berjalan dan 60 catatan per tiket — tiket yang riwayatnya penuh **ditolak** (bukan dipangkas
  diam-diam, karena memangkas justru membuang bagian yang paling baru).
- **Warna tenggatnya bermakna:** “Dalam jadwal”, “Segera jatuh tempo” (seperempat jendela, dijaga
  30 menit–2 jam **dan selalu lebih pendek dari jendelanya**), “Lewat janji”, “Tepat waktu”, dan
  “Lewat janji saat ditutup” — tiket yang baru dibuat tidak boleh langsung terlihat hampir lewat.
- Nomor tiketnya `TKT-2026-0007`, urut per tenant.
- **Tiket punya kanal keluar.** Sebelumnya tiket hanya hidup di dalam aplikasi — tidak ada yang tahu
  ada tiket baru kecuali halaman Dukungan dibuka. Sekarang tiket mengabarkan dirinya sendiri lewat
  webhook `api.access`: `support.created` (beserta janji tanggap & tenggat absolutnya),
  `support.escalated`, `support.resolved` (menyebut janji tanggapnya terpenuhi atau tidak), dan
  `support.due`. Kirimannya memakai jalur bertanda tangan yang sama dengan event transaksi, dan
  diserahkan ke pekerja percobaan ulang begitu tiketnya tersimpan.
- **Janji tanggap yang hampir lewat mengabarkan dirinya sendiri.** Pekerja terjadwal
  (`src/convex/crons.ts`, tiap 30 menit) mengambil tiket berjalan yang **belum pernah diingatkan**
  lewat indeks `(slaNotified, dueAt)` — bukan memindai tabel — lalu mengirim `support.due`. Ambang
  “segera jatuh tempo”-nya memakai aturan yang sama dengan lencana di halaman, jadi pengingat dan
  warna tenggat tidak pernah berbeda pendapat, dan pengingatnya **sekali per tiket**: tiket yang
  dibuka ulang mereset penandanya, tiket yang dibiarkan tidak diberitakan berulang-ulang.

Halaman **Dukungan** (`/app/support`) menampilkan janji tanggap paket ini beserta keempat
prioritasnya (prioritas jalur cepat ditandai), kartu ringkas (menunggu ditangani · sedang ditangani
· lewat janji · tenggat terdekat), formulir tiket baru, dan daftar tiket lengkap dengan riwayat &
aksinya (mulai, catatan, eskalasi, selesaikan, buka ulang). Izinnya `support.view` dan
`support.manage`: **keuangan melihat** tiket tapi tidak membukanya, **pemilik/manajer membuka & 
menutup**, dan **kasir tidak melihat tiket sama sekali** — jawaban pelanggan tidak menunggu kasir.

```bash
bun scripts/verify-support.mjs      # 61/61: janji tanggap, transisi status, SLA, batas & kanal keluar (murni)
bun scripts/verify-render.mjs       # halaman Dukungan + alur aksi tiket lewat store
```

## Skala franchise: laporan lintas cabang beranggaran per cabang (`scale.franchise`)

Klausa kedua Phase 5. Ini satu-satunya laporan yang **tumbuh mengikuti ukuran pelanggan**, bukan
mengikuti ukuran halaman: tenant satu toko bisa membaca seluruh riwayatnya tanpa terasa, sementara
jaringan 40 cabang akan menggandakan biaya bacanya 40 kali kalau ditulis seperti laporan biasa.
Karena itu cara membacanya diatur aturan murni `src/convex/lib/scale.ts` dan diterapkan
`reports.franchise` (`src/convex/reports.ts`).

- **Anggaran dibagi per cabang, bukan per tenant.** Jendela cabang dibatasi 50
  (`MAX_OUTLET_WINDOW`), dan baris terbaru per cabang mengecil saat jumlah cabang bertambah:
  ≤3 cabang → 600 baris, ≤10 → 300, ≤25 → 200, di atasnya 150. Query-nya meminta
  `rowsPerStore + 1` baris — satu dokumen ekstra hanya untuk **tahu** ada baris di luar anggaran —
  dan dokumen di luar anggaran **tidak pernah diambil** dari database. Halaman menyebut anggarannya
  apa adanya: “12 cabang × 300 baris terbaru = 3.600 dokumen maksimum per laporan.”
- **Batasnya jujur, bukan diam-diam.** Laporan memuat `truncated`, `skippedOutlets` (cabang yang
  tidak diagregasi), dan `beyondWindow` (cabang di luar jendela 50); halaman menuliskan berapa cabang
  yang belum diagregasi alih-alih menampilkan angka yang terlihat lengkap padahal bukan.
- **Pangsanya berjumlah 100.** Metode sisa terbesar dipakai supaya kolom “Pangsa” tidak berjumlah 99%
  atau 101% seperti pembulatan per baris.
- **Transaksi terbesar jaringan digabung dengan `mergeTopN`:** kepala terbesar dari tiap cabang
  diambil bergiliran, jadi memorinya `O(n)` dan yang disentuh sekitar `n × jumlah cabang` baris,
  bukan seluruh baris. Prasyaratnya tiap daftar cabang datang **sudah terurut**, dan harness
  memeriksa kedua pemanggilnya memenuhi itu.
- **Yang sengaja tidak ada:** produk teratas lintas cabang — itu menuntut satu query per penjualan,
  tepat beban yang sedang dihindari di sini. Produk teratas tetap tersedia **per cabang** di laporan
  biasa.
- **Jendela waktunya sama dengan analitik lanjutan:** 1–90 hari (default 30), batas harinya tengah
  malam lokal lewat offset zona waktu klien.

Halaman **Laporan** memuat bagian **Skala franchise · lintas cabang**: omzet jaringan, transaksi,
rata-rata keranjang, jumlah cabang aktif/nonaktif, tabel pangsa per cabang (diurutkan menurut omzet
menurun), dan transaksi terbesar jaringan. Gerbangnya fitur `scale.franchise` (paket Enterprise) di
depan izin `report.view` — paket di bawahnya melihat alasan singkat kenapa bagian itu mati, sementara
laporan harian tetap jalan.

```bash
bun scripts/verify-scale.mjs        # 42/42: anggaran query, pangsa bulat & gabungan top-N (murni)
bun scripts/verify-backend.mjs       # laporan lintas cabang di deployment Convex (isolasi antar tenant)
```

## Pembayaran digital: tagihan QRIS / VA (`payment.digital`)

Klausa pertama Phase 6. Sampai di sini uang hanya masuk lewat kasir: tunai, kartu, atau transfer
yang dicatat manual. Sekarang toko bisa menerbitkan **tagihan digital** bernomor (`DIG-2026-0007`)
yang dibayar pelanggan sendiri — memindai **QRIS** atau mentransfer ke **Virtual Account** bank —
dan kasir menandainya lunas setelah uangnya benar-benar masuk. Aturannya ada di
`src/convex/lib/digitalPayment.ts`, dipakai `src/convex/payments.ts`, halaman **Pembayaran**
(`/app/payments`, izin `payment.view`), kedua store, dan harness.

- **Tagihan digital adalah utang pelanggan kepada toko, bukan penjualan.** Nominal yang masih
  menunggu dan yang sudah masuk dipisahkan di ringkasan, jadi omzet tidak pernah menghitung uang
  yang belum diterima.
- **Kedaluwarsa dihitung saat dibaca, bukan oleh pekerja terjadwal.** QRIS berumur 5 menit dan
  Virtual Account sehari; tagihan yang lewat tenggat tidak menggantung sebagai “menunggu” hanya
  karena belum ada yang menyapunya — status `expired` diturunkan dari `expiresAt`, dan itu
  satu-satunya kebenaran soal umur tagihan.
- **Janji umurnya dipatok saat tagihan dibuat.** `expiresAt` disimpan di barisnya, bukan dihitung
  ulang dari metode hari ini, jadi mengubah kebijakan kedaluwarsa tidak mematikan tagihan yang
  sudah ditunjukkan ke pelanggan.
- **Pelunasan harus pas.** Nominal yang tidak sama dengan tagihan ditolak dengan menyebut kedua
  angkanya; kelebihan atau kekurangan pembayaran bukan sesuatu yang boleh dipangkas diam-diam.
- **Transisinya sempit dengan sengaja:** `pending → paid` (nominal pas, sebelum tenggat) dan
  `pending → cancelled`. Tidak ada jalan dari `paid`, `expired`, atau `cancelled` ke status lain —
  uang yang sudah masuk tidak diubah oleh satu tombol di halaman.
- **Nomor Virtual Account deterministik** dari bank + urutan (BCA `8808…`, BNI `8810…`,
  BRI `8888…`, Mandiri `8907…`), dan payload QRIS-nya juga deterministik — tagihan yang sama selalu
  menghasilkan kode yang sama sehingga bisa dicetak ulang, dan dua tagihan berbeda tidak pernah
  bertukar kode.
- **QRIS ditampilkan sebagai kode QR yang benar-benar bisa dipindai, bukan hanya payload teksnya.**
  Payload itu digambar menjadi matriks QR (`src/lib/qr.ts`) dan dirender sebagai SVG oleh
  `@/components/QrCodeImage`; latar dan modulnya dipaksa putih–hitam supaya kontrasnya tetap
  terbaca walau tema aplikasi gelap. Payload teksnya tetap disediakan di balik panel *Payload teks
  (cadangan)* untuk menelusuri masalah, tetapi yang dipindai pelanggan adalah gambarnya.
- **Gerbangnya satu arah seperti klausa lain:** **membuat tagihan butuh fitur `payment.digital`**,
  sedangkan **melunasi & membatalkan selalu boleh** — kalau paket turun di tengah hari, uang
  pelanggan yang sudah di jalan tetap bisa dicatat masuk.

### Menagih QRIS langsung dari keranjang kasir

Kanal tagih itu tidak cuma hidup di halaman Pembayaran: di **kasir** (`/app/pos`) pilihan metode
**QRIS** menerbitkan tagihan senilai **total keranjang** tanpa kasir mengetik nominal apa pun, dan
penjualannya baru dicatat setelah tagihan itu lunas.

- **Nominal tagihan = total keranjang.** Kasir tidak mengetik nominalnya, metodenya QRIS (yang
dipindai di depan kasir), dan keterangannya ringkasan isi keranjang (`POS · 2 baris · 3 item · 2×
Kopi Susu`) — dipotong pada batas kolom keterangan, bukan dibiarkan gagal.
- **Uang masuk lebih dulu, nota menyusul.** Menekan **Terbitkan tagihan** hanya membuat tagihan
  `pending`; menekan **Pembayaran diterima** melunasi tagihan itu **lalu** mencatat penjualan dengan
  menunjuk tagihannya (`pos.createSale` + `digitalChargeId`). Selama tagihannya menunggu, tidak ada
  penjualan yang tercatat.
- **Server memeriksa ulang sambungannya.** Penjualan yang menunjuk tagihan **belum lunas**,
  **kedaluwarsa**, bernominal **berbeda** dari total penjualan, bermetode berbeda, atau milik
  **tenant lain** ditolak — semuanya sebelum apa pun tersimpan. Aturannya satu, di
  `lib/digitalPayment.ts` (`validateCartCharge`, `checkCartMatchesCharge`, `checkSaleAgainstCharge`),
  jadi kasir tidak pernah melihat janji yang akan ditolak backend.
- **Keranjang yang berubah harus dibuatkan tagihan baru.** Kalau kasir mengubah isi keranjang
  setelah tagihan terbit, pelunasan tagihan lama ditolak dengan menyebut kedua nominalnya — bukan
  dicatat sebagai penjualan bernominal lain.
- **Tagihan dan penjualan saling menunjuk.** Setelah penjualannya tersimpan, tagihannya menyimpan
  `saleId`/`saleNumber` dan halaman Pembayaran menampilkan *“melunasi penjualan A-00012”*, sehingga
  keuangan bisa menelusuri satu tagihan QRIS sampai ke notanya (dan sebaliknya).
- **Gagal di tengah jalan tidak menagih dua kali.** Kalau pelunasan berhasil tetapi penyimpanan
  penjualannya gagal (mis. stok berubah), kasir diberi tahu bahwa tagihannya **sudah lunas** dan
tombolnya berubah jadi **Simpan penjualan** — tagihan yang sudah lunas tidak dilunasi ulang.
- **Paket tanpa fiturnya tidak mengunci apa pun:** pilihan QRIS tetap bisa dicatat manual seperti
  kartu, dengan keterangan bahwa kanal tagih digitalnya belum termasuk paket.
- **Dialog kasir menggambar kode QR-nya.** Begitu tagihan terbit, dialog menampilkan kode QR tagihan
  itu (dipindai pelanggan di depan kasir) beserta tenggatnya; halaman **Pembayaran** melakukan hal
  yang sama untuk tiap tagihan QRIS yang masih menunggu, dan **tidak** menggambarinya untuk yang
  sudah kedaluwarsa. Harness `verify-qr.mjs` membuktikan kodenya bisa dipindai dengan membaca balik
  payload-nya memakai pemindai QR sungguhan, dan `verify-render.mjs` memeriksa **kedua tempat** itu
  di DOM tiruan: dialog kasir *dan* halaman Pembayaran sama-sama harus merender `<svg data-qr-value>`
  yang nilainya sama dengan payload tagihannya.

Halaman **Pembayaran** menampilkan kartu ringkas (menunggu, lunas, kedaluwarsa, segera kedaluwarsa),
formulir tagihan (nominal, metode, bank untuk VA, keterangan), dan daftar tagihan beserta tenggatnya
serta aksi **Tandai lunas** dan **Batalkan tagihan**. Izinnya `payment.view` untuk melihat
tagihan, dan `payment.manage` untuk membuat, melunasi, serta membatalkannya — keduanya dipegang
**pemilik, manajer, kasir, dan keuangan**: kasir memang menagih di meja, dan rekonsiliasi bank
memang pekerjaan keuangan. Yang menjaga uang bukan izinnya, melainkan aturan transisinya.

```bash
bun scripts/verify-payments.mjs     # 72/72: umur tagihan, pelunasan pas, transisi, tagih dari keranjang (murni)
bun scripts/verify-qr.mjs            # 11/11: kode QR tagihan bisa dipindai (bolak-balik lewat jsqr, murni)
bun scripts/verify-backend.mjs       # tagihan digital & sambungan ke penjualan kasir di Convex (isolasi antar tenant)
bun scripts/verify-render.mjs        # alur kasir: keranjang → tagihan QRIS → penjualan + kode QR (DOM tiruan) & kode QR di halaman Pembayaran
```

## Sinkronisasi real-time: hub perangkat (`sync.realtime`)

Klausa kedua Phase 6, dan yang menutup katalog fitur. Sampai di sini satu toko bekerja di satu
perangkat pada satu waktu: kasir lain harus menunggu. Sekarang beberapa perangkat — kasir web,
tablet Android, iPad, aplikasi desktop — masuk ke satu **hub sinkronisasi**: masing-masing melaporkan
perubahan lokalnya, menarik perubahan yang belum dilihatnya lewat kursor revisi, dan konflik
diselesaikan dengan aturan yang bisa diuji. Aturannya ada di `src/convex/lib/realtimeSync.ts`,
dipakai `src/convex/sync.ts`, halaman **Sinkronisasi** (`/app/sync`, izin `device.manage`), kedua
store, dan harness.

- **Kehadiran dihitung dari detak terakhir, bukan disimpan.** Perangkat tidak pernah “menyalakan”
  status online-nya; yang ada hanya `lastSeenAt`, dan `online` ≤ 1 menit, `idle` ≤ 5 menit,
  selebihnya `offline` diturunkan dari jaraknya ke sekarang. Perangkat yang baterainya mati langsung
  terlihat offline tanpa perlu apa pun membersihkannya.
- **Setiap perubahan punya revisi yang naik satu-satu** (urutan global per tenant), sehingga “apa
  yang belum saya lihat” selalu bisa dijawab dengan satu angka. Satu giliran tarik mengambil tepat
  satu jendela — maksimal `MAX_CHANGES_PER_PULL` (200) baris berrevisi di atas kursor, urut naik —
  dan mengembalikan `nextCursor` serta `hasMore` supaya klien tahu harus menarik lagi tanpa menebak
  dari panjang hasil.
- **Konflik diselesaikan *last-write-wins* yang deterministik:** kalau perangkat mendorong di atas
  basis yang sudah basi, yang menang adalah `updatedAt` terbaru; kalau seri, `deviceId` yang lebih
  besar — jadi dua pelanggan tidak pernah melihat hasil berbeda. Hasilnya dibedakan tiga: `applied`
  (diterima bersih), `rebased` (diterima dengan penyesuaian), `rejected` (versi server dipertahankan),
  dan **setiap konflik tercatat** untuk ditandai selesai di halaman.
- **Jam yang melenceng ditolak, bukan dipakai.** Perangkat dengan `updatedAt` lebih dari 5 menit di
  depan server tidak boleh “menang” selamanya hanya karena jamnya salah; perubahannya ditolak dengan
  alasan yang menyebut selisih detiknya.
- **Perangkat yang tertinggal ditampilkan apa adanya:** hanya perangkat yang **sedang online** tapi
  revisinya di bawah revisi tertinggi — perangkat yang memang mati tidak sedang menunggu apa pun.
- **Gerbangnya searah seperti klausa lain:** **mendorong perubahan baru & mendaftarkan perangkat
  butuh fitur `sync.realtime`**, sedangkan **detak, tarikan, dan menandai konflik selesai selalu
  boleh** — paket yang turun tidak boleh mengunci perangkat dari mengosongkan perubahan terakhirnya.

Halaman **Sinkronisasi** menampilkan kartu ringkas (online, menganggur, offline, konflik belum
selesai), daftar perangkat beserta kehadiran dan revisinya, daftar perubahan terbaru (dengan
penanda konflik dan aksinya), serta formulir pendaftaran perangkat (nama, jenis, sidik perangkat).
Izinnya `device.manage` (pemilik & manajer) — kasir memakai perangkatnya, tetapi tidak mengelola
hub-nya.

```bash
bun scripts/verify-sync.mjs         # 47/47: kehadiran, tarik berjendela, konflik LWW, jam melenceng (murni)
bun scripts/verify-backend.mjs       # hub perangkat di deployment Convex (isolasi antar tenant)
```

## Masuk tanpa kata sandi: satu jalur, kode OTP ke email (`otp.auth`)

Halaman masuk (`src/pages/AuthPage.tsx`) **tidak** punya tab "Masuk"/"Daftar" dan **tidak** punya
kolom kata sandi. Alurnya satu: tulis email → terima kode 6 digit → masuk. Akunnya dibuat saat kode
pertama Anda benar, jadi daftar dan masuk memang jalur yang sama — yang membedakan hanya apakah baris
`users` untuk email itu sudah ada, dan itu ditentukan **server**, bukan pilihan pengguna.

Aturannya ada di `src/convex/lib/otp.ts` (murni; dipakai backend, kotak surat pengembangan di klien,
**dan** harness). Empat pagar yang membuat kode 6 digit layak dipercaya:

- **disimpan sebagai hash** (`hashOtpCode`, dengan `OTP_PEPPER` opsional) — membaca tabel `emailOtps`
  tidak langsung memberi kode yang masih hidup;
- **berbatas waktu 10 menit** (`OTP_TTL_MS`) — kedaluwarsanya dihitung saat dibaca, jadi tidak butuh
  pekerja terjadwal;
- **berbatas 5 percobaan** (`OTP_MAX_ATTEMPTS`) — kode yang terus salah akan terkunci, dan percobaan
  pada kode yang sudah mati tidak menambah hitungan;
- **sekali pakai + satu kode hidup per email** (`OTP_RESEND_COOLDOWN_MS` 60 detik) dan **maksimum 5
  kode per email per jam** (`OTP_MAX_PER_HOUR`) — kode lama tidak bisa bercampur dengan kode baru.

Email yang diterima adalah email yang **benar-benar bisa menerima kode**: `checkEmail` menuntut bentuk
`nama@domain.tld`, dan menolak spasi, domain tanpa titik, titik di ujung, serta panjang di luar batas
wajar — diperiksa di klien (umpan balik langsung) **dan** di server (yang menentukan).

### Mengaktifkan pengiriman email

Pengirimannya lewat **Resend** (`src/convex/otpEmail.ts`, aksi berkunci `"use node"` karena hanya di
situ kunci rahasia dan jaringan luar dipakai). Tanpa kunci itu, permintaan kode **ditolak dengan jujur**
("Pengiriman email belum dikonfigurasi di server") — tidak ada kode yang diklaim terkirim padahal
tidak. Kegagalan penyedia dicatat di baris `emailOtps.deliveryError`, bukan dianggap sukses.

| Variabel (Settings → Environment) | Wajib | Gunanya |
| --- | --- | --- |
| `RESEND_API_KEY` | ya | kunci API Resend untuk mengirim kode |
| `OTP_EMAIL_FROM` | ya | alamat pengirim terverifikasi, mis. `MesinPOS <otp@toko.id>` |
| `OTP_PEPPER` | tidak | rahasia tambahan pada hash kode |
| `OTP_DEV_CODE` | tidak | kait pengujian: kode tetap **hanya** untuk email `@…test` |
| `SITE_URL` | lihat tabel Convex Auth di bawah | alamat situs; dipakai menyusun tautan halaman Masuk di email undangan anggota |

`OTP_DEV_CODE` sengaja sempit: ia hanya berlaku untuk domain `.test` yang tidak bisa didaftarkan siapa
pun (RFC 2606) **dan** hanya kalau deployment memasangnya. Karena itu ia tidak pernah bisa dipakai
masuk ke akun nyata, sedangkan pengujian otomatis bisa menempuh jalur "kode → masuk" yang lengkap tanpa
penyedia email. Deployment dev saat ini memasangnya untuk harness; cabut dengan
`bun convex env unset OTP_DEV_CODE`.

### Identitas berverifikasi (Convex Auth)

Selain kode OTP proyek ini, deployment juga memasang **Convex Auth** (`@convex-dev/auth`) dengan
provider OTP email yang memakai Resend yang sama (`src/convex/auth.ts`, `src/convex/authEmail.ts`).
Bedanya: di jalur ini kode dan **token** diterbitkan server, sehingga `ctx.auth.getUserIdentity()`
benar-benar terisi. Itulah yang dituntut gerbang **akun platform**: halaman `/platform` punya kartu
“Identitas login terverifikasi”, dan setelah kodenya diverifikasi halaman itu membuka dirinya sendiri
lewat `platform.me`.

| Variabel (env **deployment Convex**, `bun convex env set …`) | Wajib | Gunanya |
| --- | --- | --- |
| `JWT_PRIVATE_KEY` | ya | kunci RS256 (PKCS8 satu baris) untuk menandatangani token |
| `JWKS` | ya | kunci publik yang disajikan `/.well-known/jwks.json` untuk verifikasi |
| `SITE_URL` | ya | alamat situs aplikasi; `CONVEX_SITE_URL` diisi Convex sendiri dan dipakai `auth.config.ts` |

Kuncinya dibuat sekali secara lokal (RS256, PKCS8 + JWKS dengan `use: "sig"`) dan tidak pernah dicetak
ke log. Penautan akun ditangani sendiri oleh callback `createOrUpdateUser`: baris `users` yang sudah ada
(mis. akun platform) **diadopsi** alih-alih digandakan, dan itu hanya terjadi **setelah** kode email
terbukti — jadi adopsi bukan jalan masuk baru.

### Mode demo: kotak surat pengembangan

Selama `VITE_DATA_SOURCE` belum `convex`, aplikasi berjalan di data demo — dan `src/components/OtpForm.tsx`
maka menjalankan **aturan yang sama di klien**, menampilkan kodenya di **kotak surat pengembangan** di
layar. Kode itu tetap harus diketik, tetap berbatas waktu, dan tetap sekali pakai; yang tidak ada hanya
pengirimannya, dan itu dikatakan apa adanya (bukan diklaim "email terkirim").

### Di mana gerbangnya

- **Halaman** `src/pages/AuthPage.tsx` + **form** `src/components/OtpForm.tsx` (dua implementasi, satu
  tampilan; mode dipilih sekali seperti `StoreProvider`, jadi tidak ada hook yang dipanggil kondisional).
- **Sesi** `useSession().signInWithOtp(...)` (`src/lib/session.tsx`) — dipanggil **setelah** kode terbukti
  benar; tenant lama di perangkat itu dipertahankan hanya kalau emailnya sama, akun baru mulai dari
  onboarding.
- **Server** `otp.requestCode` / `otp.verifyCode` / `otp.status` (`src/convex/otp.ts`) dan pengiriman
  `otpEmail.send` (`src/convex/otpEmail.ts`). Akun hasil kode ditandai `users.emailVerifiedAt`, jadi
  "terverifikasi" berarti kode benar-benar tiba di email itu.

```bash
bun scripts/verify-otp.mjs       # 79/79: email valid, umur kode, batas kirim, sekali pakai, isi email (murni)
bun scripts/verify-render.mjs    # alur sungguhan: ketik email → kode → sesi terbentuk (DOM tiruan)
bun scripts/verify-backend.mjs   # kontrak deployment: email tidak valid, jeda kirim, kode salah & kode benar → akun
```

**Batas yang masih terbuka:** jalur kode OTP proyek ini membuktikan kepemilikan email dan membuat akun,
tetapi **jalur masuk tenant belum dipindahkan** ke Convex Auth, jadi permukaan tenant masih memakai
`ALLOW_UNVERIFIED_ACTOR` (lihat `src/convex/lib/auth.ts`) — “sudah masuk di aplikasi” belum berarti
“identitas terverifikasi bagi server”. Sejak 2026-10-12 provider identitasnya **sudah terpasang**
(Convex Auth) dan itulah yang dipakai jalur backstage platform: di sana `ctx.auth.getUserIdentity()`
terisi dan gerbangnya menuntut identitas terverifikasi.

### Membatalkan pendaftaran: email yang dipakai mendaftar **benar-benar dihapus**

Halaman onboarding (`/onboarding`) menampilkan kartu **“Berubah pikiran di tengah pendaftaran?”** dengan
tautan **Batalkan**. Tautan itu tidak sekadar keluar dari sesi: akun yang baru lahir dari kode OTP
**dihapus**, jadi emailnya bebas dipakai mendaftar dari awal kapan saja (bukan berstatus “sudah terdaftar”
padahal pendaftarannya tidak pernah selesai). Sesudahnya pengguna kembali ke **beranda**.

Urutan kerjanya dijaga, bukan kebetulan:

- **Server dihubungi lebih dulu** (`store.cancelRegistration()` → `users.cancelRegistration`). Halaman baru
  melepas sesi dan berpindah ke beranda setelah server menjawab — kalau server menolak, sesinya tidak
  disentuh dan alasan penolakannya tampil di kartu itu (`batalkan-galat`).
- **Yang dihapus:** baris `users` untuk email itu beserta jejak masuknya (`authSessions`,
  `authRefreshTokens`, `authAccounts`, `authVerificationCodes`), sehingga tidak ada token hidup yang
  menunjuk akun yang sudah tidak ada. Baris `emailOtps` sengaja tetap: isinya hash kode yang sudah
  kedaluwarsa dan dipakai sebagai bukti/batas kirim ulang.
- **Yang ditolak** (aturan murni `src/convex/lib/account.ts`, dipakai server & harness): akun yang **sudah
  punya keanggotaan** — barisnya bisa pemilik workspace beserta seluruh datanya — dan **akun platform**
  (`platformRole`), yang penandanya hanya boleh dicabut lewat akses deployment. Pemanggilnya juga harus
  memegang identitas baris yang sama (`verifyActor`), jadi id orang lain tidak bisa dipakai menghapus akun.
- **Mode demo** tidak punya akun di server: yang dikembalikan hanya email sesi, dan pengguna tetap
  dibawa ke beranda.

```bash
bun scripts/verify-authz.mjs     # +5 cek aturan pembatalan: pendaftaran baru boleh, workspace & akun platform ditolak
bun scripts/verify-render.mjs    # 936/936: onboarding menawarkan tautan “Batalkan”; ditekan → server dipanggil, sesi dilepas, mendarat di beranda; penolakan server tampil sebagai pesan dan sesinya tidak dilepas
bun scripts/verify-backend.mjs   # 901/901: akun benar-benar hilang, email yang sama bisa mendaftar lagi sebagai akun baru, dan akun ber-workspace ditolak
```

## Halaman Profil: identitas orangnya & identitas usahanya, di satu halaman (`/app/profil`)

Dua profil yang berbeda pemiliknya diubah berdampingan di **satu halaman**, dan pembagian izinnya
mengikuti siapa yang berhak — bukan selera tata letak:

- **Profil saya** (`users.updateProfile`) — nama yang tercetak sebagai baris `Kasir` di struk dan tampil
di daftar anggota Tim & Peran, beserta nomor WhatsApp pengguna aktif. **Semua peran** boleh
memperbaikinya; server memeriksa bahwa yang diubah memang barisnya sendiri (`verifyActor`), jadi kasir
tidak perlu izin tambahan hanya untuk membetulkan namanya. **Email tidak diubah dari sini**: ia identitas
masuk (kode OTP dikirim ke sana), jadi menggantinya berarti masuk dengan email baru — kolomnya
ditampilkan sebagai keterangan, bukan kolom.
- **Profil usaha** (`tenants.updateProfile`) — nama usaha, alamat, email kontak, dan nomor WA. Izinnya
`billing.manage`, sama dengan setelan workspace lain; peran tanpa izin itu tetap **membaca** isinya
(mereka perlu tahu alamat & WA tokonya) tetapi kolomnya terkunci, alasannya disebut, dan server menolak
kalau aksinya dipaksakan dari luar halaman. Perubahannya menulis jejak audit `tenant.profile`.
- **Keluar** — mengakhiri sesi **di perangkat ini**; data workspace tidak ikut terhapus.

Aturannya **satu sumber** (`src/convex/lib/profile.ts`, dipakai halaman, kedua store, dan server): nama
2–60 karakter (spasi pinggir & ganda dirapikan), alamat maksimal 160, email memakai validator yang sama
dengan pengiriman kode masuk, dan nomor WhatsApp memakai normalisasi yang sama dengan undangan tim
(`08…`/`8…`/`+62…` → `62812…`, bentuk yang dibutuhkan `wa.me`). Kolom yang boleh kosong berarti
**belum diisi** (bukan salah): lencana kartunya menyebut apa yang masih kurang (`Belum ada: nomor WA`),
dan satu kolom yang tidak lolos membatalkan **seluruh** penyimpanan — setelan separuh tersimpan lebih
membingungkan daripada tidak tersimpan sama sekali.

```bash
bun scripts/verify-profile.mjs   # 59/59: aturan murni (nama, alamat, email, nomor wa.me, batal-semua) + halaman aslinya diketik & disimpan di DOM tiruan — kedua kartu, notis, lencana, terkunci untuk kasir, dan keluar
bun scripts/verify-menus.mjs     # 427/427: rute /app/profil tanpa gerbang izin terbuka untuk kelima peran, dan menunya ada di sidebar
VITE_CONVEX_URL=https://<deployment>.convex.cloud bun scripts/verify-backend.mjs   # 837/837: kontrak deployment `users.updateProfile` (baris sendiri lewat `verifyActor`, tanpa izin peran) & `tenants.updateProfile` (izin `billing.manage`, nomor jadi `628…`, satu kolom salah = batal semua, anggota nonaktif & orang luar ditolak)
```

## Satu akun = satu bisnis: workspace yang berdiri sendiri

Setiap akun yang mendaftar mendapat **workspace-nya sendiri**, dan tidak ada dua akun yang berbagi
workspace walau keduanya menamai bisnisnya sama. Aturannya ada di tiga lapis:

1. **Nama bisnis bukan kunci unik** (`src/convex/tenants.ts`). `tenants.create` mencari alamat bebas
   (`toko`, `toko-2`, `toko-3`, … lewat `uniqueSlug`) jadi pendaftar kedua dengan nama “Toko Berkah”
   **tidak ditolak** dan **tidak dilempar ke workspace orang lain** — ia mendapat workspace baru
   beserta cabang pertama, keanggotaan `owner`, dan kategori bawaannya sendiri. Tenant tempat pemanggil
   **sudah** menjadi anggota dikembalikan sebagai `reused: true` (onboarding ulang di perangkat baru
   tidak menumpuk bisnis kedua, dan tidak menimpa pengaturan yang sudah diatur pemiliknya).
2. **Keanggotaan yang menentukan workspace, bukan slug yang diketik.** Klien membaca
   `tenants.listMine` (`src/lib/store/convex.tsx`): workspace aktif = salah satu milik pengguna —
   pilihan sesi perangkat ini kalau memang salah satunya, kalau tidak workspace pertamanya. Menebak
   slug tidak pernah membuka bisnis orang lain.
3. **Sesi perangkat diselaraskan dengan workspace itu** (`adoptWorkspace` di `src/lib/session.tsx`):
   nama bisnis, slug, peran, paket, modul, nama cabang, dan jam trial diisi dari workspace milik
   pengguna. Masuk dari perangkat baru (sesi kosong) memulihkan bisnisnya sendiri, bukan menawarkan
   membuat yang baru; sisa sesi lama tidak bisa membuat halaman menampilkan bisnis orang lain.

Di halaman **Onboarding** (`src/pages/OnboardingPage.tsx`) formulir nama bisnis **ditahan** selama
identitas belum pasti (`store.workspacePending`): yang tampil adalah layar “Memuat workspace Anda”.
Begitu server memastikan akun itu sudah punya workspace, pengguna langsung dibawa ke dashboard-nya
(`returnTo` dari rute yang tadi dibuka ikut dibawa lewat `RequireTenant`); kalau memang belum punya,
formulirnya muncul. Tanpa penahan itu pemilik toko yang masuk di perangkat baru akan mendirikan
bisnis kedua, karena sesi perangkat ini belum tahu apa pun tentang bisnisnya.

Tiap workspace juga **mengatur dirinya sendiri**: paket & modul, cabang, peran & anggota, member,
kunci API & webhook, dukungan, dan tagihan — semuanya tersimpan per tenant. Pagar servernya
(`requireMembership` / `requirePermission`) menolak anggota bisnis lain, termasuk saat namanya sama.

### Izin yang membuka data datang dari **server**, bukan dari sesi perangkat

Di mode Convex, data dibaca lewat **langganan** (`useQuery`), dan langganan yang ditolak server
**menjatuhkan halaman yang memuatnya** — pengguna melihat “Halaman ini gagal dimuat”, bukan penjelasan.
Karena itu klien tidak boleh membuka langganan bergerbang izin atas dasar peran yang tertulis di
perangkat ini. Yang dipakai adalah jawaban server: `api.roles.myAccess` mengembalikan peran, izin
efektif, dan peran kustom anggota yang sedang masuk (`ConvexStoreProvider` di
`src/lib/store/convex.tsx`) — keanggotaan yang sama dengan yang diperiksa `requirePermission`.
Selama jawabannya belum ada, izinnya **kosong**, jadi langganan bergerbang (katalog pengelolaan
`products.listAll`, piutang, pembelian, gudang, laporan, tim, API, dukungan, pembayaran digital)
belum dibuka. Akibatnya data berizin tiba satu putaran lebih lambat saat pertama dibuka — jauh lebih
baik daripada halaman gagal dimuat.

Dua keadaan yang tadinya mematikan halaman itu ditangani terus terang:

- **Sesi perangkat yang belum selaras.** Masuk di perangkat baru — termasuk menerima undangan sebagai
  kasir — membuat sesi belum tahu workspace mana miliknya. `actingPermissions` (`src/lib/session.tsx`)
  karena itu mengembalikan **daftar kosong** untuk sesi tanpa tenant, bukan izin pemilik. Halaman `/app`
  tetap dijaga `RequireTenant`, jadi sesi seperti itu diarahkan ke onboarding seperti biasa.
- **Keanggotaan yang dinonaktifkan pemiliknya.** `tenants.listMine` melaporkan status keanggotaan
  (`active`), dan store hanya memakai keanggotaan yang aktif. Anggota yang dinonaktifkan melihat notis
  “Workspace belum tersambung ke server” berisi kalimat `MEMBERSHIP_SUSPENDED_NOTE`
  (`src/convex/lib/team.ts`) beserta petunjuk **minta pemilik mengaktifkan kembali** — bukan halaman
  gagal dimuat, dan bukan pula tawaran mendirikan bisnis baru: provisioning hanya berjalan untuk akun
  yang **belum punya keanggotaan sama sekali**.

### Uji yang membuka browser sungguhan (`verify-browser-invite.mjs`)

Harness DOM (`verify-render.mjs`) berjalan di mode demo, jadi jalur store Convex tidak pernah terbuka di
sana — padahal “Halaman ini gagal dimuat” hanya muncul di browser sungguhan dengan backend hidup.
`scripts/verify-browser-invite.mjs` menutup celah itu: ia menjalankan **Chromium headless** dan memakai UI
apa adanya — pemilik masuk di `/auth` dengan kode OTP uji, menyelesaikan onboarding, mengundang kasir di
halaman **Tim & Peran**; lalu **perangkat baru** (konteks peramban dengan `localStorage` kosong) masuk
sebagai kasir itu, dan yang benar-benar tampil diperiksa: halaman pertama `/app`, `/app/pos`, dan
`/app/products` (“Akses ditolak” milik klien).

Buktinya bukan teks halaman saja: `WebSocket.prototype.send` dibajak lewat `addInitScript`, jadi harness
membaca **bingkai yang benar-benar dikirim klien** ke Convex. Klien pemilik mengirim `products:listAll`,
klien kasir mengirim `roles:myAccess` + `products:listByStore` dan **tidak pernah** `products:listAll`.

```bash
# di luar repo, supaya unduhan Chromium tidak ikut ke instalasi build hosting
mkdir -p /tmp/pw && cd /tmp/pw && bun init -y && bun add playwright
bunx playwright install --with-deps chromium --only-shell

# preview harus sedang mode Convex (VITE_DATA_SOURCE=convex + VITE_CONVEX_URL awan)
PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-browser-invite.mjs http://localhost:5173 428913
```

Kode uji `428913` hanya berlaku untuk email berdomain `.test` di deployment yang memasang `OTP_DEV_CODE`
(`isTestLoginEnabled` di `src/convex/lib/otp.ts`), jadi uji ini tidak pernah menyentuh kotak surat orang
sungguhan. Perlu diketahui: setiap jalan membuat satu workspace uji `Uji Undangan <stempel>` beserta dua
akun `.test` di deployment dev — belum ada pembersih otomatis.

`scripts/verify-version-browser.mjs` memakai Chromium yang sama untuk satu hal yang **tidak** bisa
dibuktikan di DOM tiruan: banner **“Versi baru tersedia — muat ulang”**. Permintaan dokumen dijawab
dengan HTML yang memuat script modul tiruan `/assets/index-AAAA1111.js`, sedangkan permintaan
`/index.html?v=…` (yang dipakai pemantau versi) dijawab dengan `/assets/index-BBBB2222.js` — jadi aplikasi
melihat situsnya baru berganti bundel tanpa perlu deploy kedua. Yang diperiksa: banner muncul dari
pemeriksaan pertama (±45 detik, tidak menyergap render awal), menyebut kedua nama berkas, tidak menagih
server berulang sesudahnya, dan tombol **Muat ulang sekarang** benar-benar memuat ulang halaman. Sesi demo
ditanam skripnya sendiri, jadi preview dengan data demo sudah cukup:

```bash
PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-version-browser.mjs http://localhost:5173
```

### Mendaftarkan & mengelola akun tim di bisnis yang sama

Anggota tim tidak membuat bisnis baru: yang dibuat adalah **akun di workspace ini**. Langkahnya di
halaman **Tim & Peran** (`/app/team`, izin `team.manage`):

1. Isi **Email** orangnya (wajib), **Nama** (opsional), **Nomor WhatsApp** (opsional, dipakai tombol
   *Kirim via WA*), dan **Peran** — **satu** pertanyaan untuk satu orang: kelompok *Peran bawaan*
   (Kasir, Manajer, Staf Gudang, Keuangan, dan Pemilik bila Anda pemilik tenant) lalu kelompok *Peran
   tambahan* berisi peran kustom aktif yang sudah dibuat di daftar **Peran**. Dulu ada dua pemilih
   terpisah (“Peran” + “Peran kustom (opsional)”), dan itu yang membuat satu orang seolah memakai
   dua peran; sekarang tidak. Pilihannya disaring dengan pagar yang sama seperti penugasan biasa
   (hanya peran **aktif** dan yang izinnya tidak melewati wewenang pengundang), dan pemilik tenant
   tidak ditawari peran tambahan karena seluruh izin sudah dipegangnya. Pil di kanan labelnya menuliskan
   akibat pilihannya — “peran bawaan” atau “N izin · peran tambahan”.
2. Tekan **Daftarkan ke tim** (`members.add`): server membuat baris `users` untuk email itu kalau belum
   ada, lalu baris `memberships` di tenant ini (beserta `customRoleId`-nya kalau peran tambahan dipilih —
   pagar fitur `rbac.custom`, peran aktif, dan larangan eskalasi diperiksa **sebelum** barisnya ditulis;
   untuk peran tambahan peran dasarnya adalah `Kasir` tersembunyi yang **statusnya tidak ikut diperiksa**,
   **lalu mengirim email undangan** ke alamat itu
   (`inviteEmail.send`, terjadwal lewat `ctx.scheduler` supaya kegagalan penyedia email tidak pernah
   membatalkan keanggotaan). Undangan ulang untuk email yang sudah anggota adalah **perubahan peran**,
   bukan anggota kedua — dan tidak mengirim email otomatis; pakai tombol **Kirim ulang** kalau perlu.
3. Minta orangnya masuk di `/auth` dengan **kode OTP ke email itu** — tidak ada kata sandi bersama yang
   perlu dibagikan. Setelah masuk ia langsung berada di workspace ini, karena keanggotaannya ada di
   server (`tenants.listMine`), bukan karena perangkat ini pernah memuat bisnis itu.

Isi emailnya (`inviteEmailContent` di `src/convex/lib/team.ts`) hanya menyebut **siapa yang mengundang,
workspace mana, peran apa — satu peran saja, jadi undangan berperan tambahan berbunyi `sebagai Kasir
Shift Malam`, bukan “Kasir (peran kustom: Kasir Shift Malam)” — dan ke mana harus pergi** — tidak ada
kata sandi dan tidak ada tautan
bertoken, karena kode masuk hanya terbit kalau orangnya memintanya sendiri di halaman Masuk. Kalau
emailnya salah kirim, tidak ada yang bisa dipakai orang lain dari situ. Tautan halaman Masuk dibangun
dari `SITE_URL`; kalau variabelnya belum diset, emailnya menyebut halamannya tanpa mengarang alamat.

**Tombolnya mati selama workspace belum tersambung.** Identitas bisnis pengguna aktif tidak selalu sudah
pasti saat halaman ini terbuka: perangkat baru masih menunggu daftar keanggotaannya dibaca server, dan
keanggotaan yang dinonaktifkan pemilik membuat workspace-nya memang tidak bisa dipakai. Dalam kedua
keadaan itu mutation undangan belum punya tenant yang bisa dituju, dan store menolaknya dengan pesan
teknis **“Tenant belum siap. Coba lagi sebentar lagi.”** — yang menyuruh menunggu tanpa menjelaskan apa
pun. Karena itu keputusan tombol **Daftarkan ke tim** (dan kalimat di bawahnya) dibuat di satu tempat,
`resolveTeamInviteForm` (`src/convex/lib/team.ts`): `workspacePending` dan `store.error` diperiksa lebih
dulu, jadi yang terbaca adalah sebabnya — `WORKSPACE_PENDING_INVITE_NOTE` (“Workspace belum tersambung ke
server — tunggu sebentar…”) atau kalimat server apa adanya (`Undangan belum bisa dikirim — …`), bukan
galat setelah ditekan. Urutan formulir (email tidak sah, nomor WhatsApp salah) tetap berlaku setelah
keduanya selesai.

Kolom **Undangan** di tabel anggota melaporkan keadaan yang sebenarnya, bukan harapan: kapan emailnya
berangkat, atau pesan kegagalannya apa (`inviteError`) beserta tombol **Kirim ulang** — dan jumlah
percobaan kirim. Dua keadaan sengaja tidak diklaim terkirim: alamat uji `.test` (domain yang tidak bisa
didaftarkan siapa pun) dicatat sebagai `uji` tanpa email, dan mode demo mencatat `demo` karena memang
tidak ada penyedia email di situ.

#### Undangan lewat WhatsApp (`wa.me`)

Banyak tim di Indonesia menyebar undangannya lewat WhatsApp, bukan email. Kolom **WhatsApp** di tabel
yang sama menjawab itu tanpa berpura-pura menjadi pengirim: tombol **Kirim via WA** membuka percakapan
`wa.me` di nomor anggota — **dari perangkat pengundang**, dengan pesan sudah terisi — lalu mencatat
bahwa tautannya dibuka. Nomor dinormalkan lebih dulu (`normalizePhone`: buang pemisah, `0`/`8`/`00`
menjadi kode negara `62`, panjang 8–15 digit), karena nomor bertanda `+` atau berspasi tidak dikenali
`wa.me`; nomor yang salah bentuk ditolak **sebelum** keanggotaannya dibuat, bukan tersimpan apa adanya.

Isi pesannya (`whatsappInviteText`) menyebut yang sama dengan email: siapa yang mengundang, workspace
mana, peran apa, email yang harus diisi, dan tautan halaman Masuk — jadi penerimanya tidak menunggu
kode di WhatsApp. Yang **tidak** dilakukan aplikasi ini adalah mengklaim pesannya terkirim: yang
dikirim adalah pesan dari aplikasi WhatsApp pengundang, dan server tidak menerima konfirmasi dari sana.
Karena itu `members.recordWaInvite` hanya mencatat tautannya dibuka beserta jumlahnya
(`waInviteAt` / `waInviteCount`) dan tabelnya berbunyi *“Tautan WhatsApp dibuka N×”*, bukan
“terkirim”. Pesan WA juga **bukan jalur masuk kedua**: masuknya tetap kode OTP ke email yang diundang,
sehingga nomor yang salah tidak memberi siapa pun jalan masuk.

#### Ubah, aktif/nonaktif, dan hapus anggota

Semua akun tim di workspace — termasuk akun sendiri — muncul di tabel yang sama lengkap dengan aksi
pengelolaannya: kolom **Peran** berisi **satu** pemilih peran (kelompok *Peran bawaan* lalu
*Peran tambahan*) yang langsung menggantikan peran orangnya — memilih peran tambahan cukup menugaskan
peran itu, dan kembali ke peran bawaan melepas peran tambahannya lebih dulu; tombol **Ubah** membuka
form identitas yang sudah terisi (nama, email, nomor WhatsApp, status aktif) dengan catatan peran yang
sedang dipakai dan pengingat bahwa perannya diganti di kolom Peran (form itu **tidak** menanyakan
peran lagi, supaya tidak ada dua pertanyaan untuk satu hal); **Nonaktifkan/Aktifkan** mengubah
aksesnya dalam satu klik, dan **Hapus** meminta konfirmasi lebih dulu (`Yakin hapus?`). Mengangkat
seseorang menjadi **Pemilik** dari kolom Peran **melepas** peran tambahan yang masih menempel
(`members.update`), karena pemilik selalu memegang seluruh izin. Perubahannya satu pintu di server — `members.update`
untuk nama/email/peran/nomor/status dan `members.remove` untuk keanggotaannya, keduanya butuh
`team.manage` dan berjejak audit.

Aturan murninya (`validateTeamMemberEdit` / `validateTeamMemberRemoval` di
`src/convex/lib/team.ts`) dipakai halaman **dan** server, jadi pratinjau di form berbunyi sama dengan
jawaban backend. Empat pagar yang tidak boleh hilang:

- **Workspace tidak kehilangan pemilik terakhir.** Menurunkan, menonaktifkan, atau menghapus pemilik
  **aktif terakhir** ditolak; angkat pemilik pengganti dulu.
- **Peran Pemilik hanya disentuh sesama pemilik.** Manajer bisa mengurus anggota lain, tetapi tidak
  mengangkat maupun menurunkan pemilik.
- **Satu akun = satu orang.** Email yang sudah dipakai anggota lain di workspace itu ditolak, dan
  nama/email hidup di baris `users` — memperbaikinya berarti memperbaiki jalan masuk orangnya.
- **Akun sendiri tidak dikunci dari sini.** Akun yang sedang dipakai tidak bisa menonaktifkan atau
  menghapus dirinya sendiri (minta pemilik lain melakukannya), supaya tidak ada yang kehilangan akses
  karena salah klik.

Menghapus anggota hanya menghapus **keanggotaannya di workspace ini**: baris `users`-nya tetap ada,
jadi mengundangnya lagi nanti (atau orangnya bergabung ke workspace lain) tidak membuat akun kedua
beremail sama — harness memeriksanya dengan masuk lagi memakai email itu. Nomor WhatsApp yang
dikosongkan di form Ubah berarti nomornya **dihapus**, bukan disimpan sebagai teks kosong.

Undangannya diikat ke **email**, bukan perangkat, dan emailnya diperiksa dengan aturan yang sama
seperti halaman masuk (`checkEmail` lewat `validateTeamInvite` — dipakai halaman **dan** server), supaya
tidak ada undangan untuk email yang tidak bisa menerima kode. Pagar lain: hanya peran berizin
`team.manage` yang boleh mendaftarkan (kasir ditolak server), dan akun platform
(`platformRole: developer`) tidak bisa diundang masuk tenant orang lain
(`membershipAssignmentError`).

Kalau UI-nya tidak bisa dipakai (mis. deployment tanpa halaman tim), jalurnya sama lewat CLI — id
tenant dan id pengguna pemilik bisa dibaca dari `bun convex data tenants` / `bun convex data users`:

```bash
bun convex run members:add '{"tenantId":"<tenantId>","actorId":"<userId pemilik>","email":"sari@bisnis.id","name":"Sari","phone":"0812-3456-7890","role":"cashier"}'
# → {"created": true, "membershipId": "…", "userId": "…"}
bun convex run members:update '{"tenantId":"<tenantId>","actorId":"<userId pemilik>","membershipId":"<membershipId>","name":"Sari W","phone":null,"active":false}'
# → {"membershipId": "…", "changed": ["name", "phone", "active"], "email": "sari@bisnis.id"}
bun convex run members:remove '{"tenantId":"<tenantId>","actorId":"<userId pemilik>","membershipId":"<membershipId>"}'
# → {"removed": true, "email": "sari@bisnis.id"}
```

```bash
bun scripts/verify-team.mjs       # 61/61: aturan murni nomor WA, isi pesan wa.me, pagar ubah/nonaktif/hapus anggota, keputusan tombol undangan (`resolveTeamInviteForm`), dan keputusan pembersihan baris lama (peran bawaan + peran tambahan sekaligus)
bunx convex run members:legacyRoleReport                 # baca-saja: baris keanggotaan lama yang masih menyimpan dua peran (harus 0 setelah dibersihkan)
bunx convex run members:cleanupLegacyRoles '{"dryRun":true}'   # uji kering: keputusan per baris tanpa menulis
bunx convex run members:cleanupLegacyRoles               # rapikan baris lama (internalMutation, idempoten & bertahap)
bun scripts/verify-store-gate.mjs # 17/17: setiap query berizin di src/convex digerbang `has(<izin>)` dari roles.myAccess di store, wajib "skip", izin sesi dilarang, keanggotaan nonaktif dikenali
bun scripts/verify-backend.mjs    # 837/837: dua bisnis bernama sama → dua workspace, isolasi baca & tulis, onboarding ulang memakai workspace sendiri, undangan tim + jejak kirim emailnya, undangan WhatsApp (nomor ternormalisasi + jejak buka tautan) & kelola anggota di server, plus izin kasir (ditolak `products.listAll`, `roles.myAccess` tanpa product.manage) & penanda `active:false` untuk keanggotaan nonaktif
bun scripts/verify-render.mjs     # 832/832: onboarding menahan formulir selama workspace dipulihkan, form anggota tim menambah anggota, kolom Undangan + Kirim ulang bekerja, tombol Kirim via WA membuka wa.me, Ubah/Nonaktifkan/Hapus anggota tersimpan, notis keanggotaan yang dinonaktifkan, serta tombol undangan yang mati selama workspace belum tersambung ke server
bun scripts/verify-menus.mjs      # 406/406: sumber izin gerbang rute — sesi tanpa tenant tanpa izin, kasir tanpa product.manage, peran kustom menggantikan peran bawaan
```

## Bip kasir & empat kartu ringkasan dashboard yang berwarna

Dua hal kecil yang membuat kerja di depan pembeli lebih enak: **umpan balik bunyi** saat barang masuk
keranjang, dan **empat angka teratas dashboard yang langsung bisa dibedakan**.

### Bunyi bip mesin kasir saat produk diklik (`/app/pos`)

Nadanya **pendek tetapi jelas**: 1245 Hz, 110 ms, gelombang `triangle`, puncak 0,18, dengan amplop
naik-turun 6 ms supaya ujung nada tidak berbunyi “klik”. Yang diinginkan tanda “tercatat”, bukan alarm:
kasir bekerja sambil melihat pembeli, dan baris keranjang yang bertambah gampang terlewat saat produk
diketik beruntun.

> **Koreksi 2026-10-13 (percobaan pertama tidak terdengar).** Angka awalnya 90 ms dengan puncak 0,06
> (≈ −24 dBFS) — nada yang dijadwalkan sudah benar dan sudah ikut terdeploy, tetapi **terlalu pelan**
> untuk terdengar dari pengeras suara ponsel di ruang ramai. Yang dinaikkan hanya amplitudo dan
> lamanya; frekuensi & bentuk gelombangnya tetap supaya karakternya masih bip kasir.

Aturan bunyinya hidup di satu modul murni `src/lib/scanBeep.ts`:

- **satu bip per ketukan produk yang diterima** (termasuk saat yang terbuka berikutnya adalah dialog
  modifier — dari sisi kasir “produk ini tercatat” sudah terjadi di situ). Menyimpan pilihan modifier
  **tidak** membunyikan bip kedua, dan ketukan yang ditolak karena stok keranjang sudah penuh tidak
  berbunyi sama sekali;
- **satu `AudioContext` dipakai ulang** untuk semua ketukan (peramban membatasi jumlahnya). Konteksnya
  baru dibuat saat nada pertama diminta — yaitu di dalam gestur klik itu sendiri, jadi kebijakan
  autoplay peramban tidak memblokirnya — dan konteks yang ditahan peramban diminta `resume`;
- **simpul nada melepas dirinya sendiri** (`onended`), jadi menekan puluhan produk beruntun tidak
  menumpuk simpul di konteks yang sama;
- **tidak pernah melempar.** Tanpa Web Audio (DOM tiruan, peramban tua, audio diblokir kebijakan
  privasi) bunyinya hanya senyap — kasir tidak boleh gagal menjual karena bunyinya tidak bisa
  dibunyikan.

**Bisa dimatikan, per perangkat.** Setelannya hidup di penyimpanan perangkat
(`mesinpos.bip.v1`), bukan di server: tiap til punya pengeras suaranya sendiri, jadi mematikan bunyi di
satu kasir tidak boleh membisukan kasir lain. Ada di dua tempat yang menulis ke setelan yang sama:

- **tombol “Bip kasir”** di header halaman kasir — muncul sebagai `role="switch"` dengan keadaan
  `aktif`/`mati` (menyalakannya langsung memperdengarkan contoh nada);
- **kartu “Bunyi bip kasir”** di halaman **Pengaturan** (`/app/settings`) dengan tombol nyalakan/matikan
  dan **Coba bunyikan** — tombol coba itu sengaja tetap berbunyi walau bipnya sedang mati, supaya orang
  yang mau menyalakannya bisa menilai dulu bunyinya di perangkat itu;
- **saklar “Bip tagihan”** di kartu antrean dapur (`/app/kds`, testid `meja-qr-bip`) — mematikan bunyi
  dari layar dapur itu sendiri, tanpa membuka halaman lain.

Saklar yang sama juga mengatur **nada notifikasi tagihan QR di layar dapur** (`KDS_ALERT_BEEP`): satu
saklar, dua nada — sehingga tidak ada dua setelan yang bisa saling berbeda. Bedanya hanya bunyinya
sendiri: bip kasir 1245 Hz / 110 ms, notifikasi dapur 2490 Hz / 260 ms.

Bawaannya **aktif**; nilai selain `"off"` (kosong, rusak, dari versi lain) dianggap aktif, dan
penyimpanan yang diblokir hanya berarti setelannya tidak tersimpan — tidak pernah melempar.

**Bisa diatur kerasnya juga, per perangkat.** Volume bip bergerak **10–100 %** dengan langkah 10 %,
tersimpan di kunci terpisah (`mesinpos.bip.volume.v1`) supaya nilai `"on"`/`"off"` yang sudah ada di
perangkat orang tetap berarti persis seperti sebelumnya. Kontrolnya ada di **dua tempat**:

- **header kasir**, tepat di sebelah tombol “Bip kasir” — tombol − / + dengan angka yang sedang berlaku.
  Letaknya di situ karena halaman Pengaturan dijaga izin `billing.manage` yang **tidak** dimiliki kasir,
  padahal justru kasir yang tahu bipnya terdengar atau tidak; kontrolnya disembunyikan saat bipnya mati
  (yang senyap tidak punya keras);
- **kartu “Bunyi bip kasir”** di halaman **Pengaturan**, dengan − / + serta tombol **Coba bunyikan**.

Tiap tekan **langsung diperdengarkan** dengan volume barunya — menyetel kerasnya bunyi tanpa
mendengarnya hanya menebak. Volumenya dikalikan saat nada dijadwalkan (`scanBeepToneAtVolume`) dan
dijepit ke batas sopan `SCAN_BEEP_MAX_GAIN` (0,25 = 100 %), jadi naik sampai 100 % tidak akan melewatinya.

Dua keputusan yang sengaja diambil:

- **Nada baku kini berarti “kekuatan pada volume 100 %”, dan bawaan volumenya 70 %.** 70 % × 0,25 = 0,175
  ≈ kekuatan 0,18 yang dipakai sebelumnya, jadi pemakai yang tidak menyentuh setelan ini mendengar bunyi
  yang sama seperti dulu, sementara yang ruangnya lebih ramai punya ruang sampai 0,25;
- **tidak ada volume 0 %.** 0 % menghasilkan hal yang sama persis dengan tombol **Matikan bunyi**, dan
  dua setelan yang tidak bisa dibedakan dari layar maupun dari bunyinya hanya membingungkan — sama
  seperti “PPN aktif 0 %” yang ditolak di halaman Pengaturan. Paling pelan adalah 10 %.

Harness menyuntikkan pemutar tiruan lewat `setScanBeepPlayer`, jadi “apakah kasir berbunyi” bisa
diperiksa tanpa audio sungguhan; di browser nyata nada yang dijadwalkan dibaca lewat pembungkus
`AudioContext` (`scripts/verify-bip-warna-browser.mjs`), termasuk **kekuatan puncak** yang benar-benar
dijadwalkan ke peramban — itulah bukti bahwa setelan volumenya sampai ke telinga, bukan cuma ke UI.

### Kartu ringkasan dashboard: empat nada warna yang berbeda

Empat kartu teratas **Dashboard** (`/app`) — *Omzet hari ini*, *Transaksi*, *Item terjual*, dan
*Stok kritis* — sekarang punya nada warnanya sendiri (hijau → biru → ungu → peringatan): garis gradien
di tepi atas tiap kartu, kotak ikon berwarna, dan angka yang ikut berwarna, dengan pasangan warnanya
sendiri di tema gelap. Tujuannya bukan ramai, melainkan supaya “yang mana omzet, yang mana stok”
langsung terbaca tanpa membaca labelnya; labelnya sendiri tetap `muted-foreground` supaya kontras
bacanya tidak dikorbankan.

Dua keadaan yang sengaja dibedakan: **Stok kritis** bernada bahaya (merah) beserta titik yang
berdenyut **hanya saat memang ada barang menipis**; kalau raknya aman, kartunya kembali tenang (amber).
Kartu peringatan yang menyala terus-menerus lama-lama tidak dibaca lagi. Tiap kartu ditandai
`data-summary` (`omzet`, `transaksi`, `item`, `stok`) supaya harness bisa memeriksa nada warnanya
**per kartu** — bukan sekadar “ada kelas warna di suatu tempat”.

```bash
bun scripts/verify-scan-beep.mjs   # 62/62: nada yang benar-benar dijadwalkan (frekuensi, amplop, sambungan simpul), konteks dibuat sekali & dipakai ulang, `resume` saat autoplay menahan, tanpa Web Audio = senyap, kegagalan audio tidak melempar, aturan setelan aktif/mati (bawaan aktif, hanya "off" yang mematikan, penyimpanan menolak, pendengar React), plus aturan volume (skala 10–100 % langkah 10 % bawaan 70 %, penjepitan nilai rusak, label & kalimatnya, dan bukti bahwa nada yang dijadwalkan memakai kekuatan sesuai volume), serta **nada notifikasi tagihan QR dapur** (satu oktaf di atas bip kasir & lebih panjang, kekuatannya di batas sopan yang sama, kerasnya ikut setelan volume yang sama, dan Matikan bunyi juga membisukannya)
bun scripts/verify-render.mjs      # 832/832: bip kasir benar-benar dipanggil saat ketukan produk diterima (bukan saat menyimpan modifier), tombol “Bip kasir” di kasir & kartu di Pengaturan benar-benar membungkam pemutarnya, tombol − / + volume benar-benar diklik di dua tempat (tersimpan, angkanya bergerak, mentok di batas, dan nada berikutnya memakai kekuatan itu), + nada warna tiap kartu dashboard & kartu stok yang menyala hanya saat ada barang menipis
# uji browser sungguhan (Chromium/Playwright, PLAYWRIGHT_DIR di luar repo) atas preview yang berjalan:
# PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-bip-warna-browser.mjs http://localhost:5173   # 23/23
#   → termasuk volume: menaikkan/menurunkan dari kasir mengubah kekuatan puncak yang benar-benar
#     dijadwalkan ke Web Audio (0,2 di 80 %, 0,15 di 60 %), dan setelannya bertahan setelah muat ulang
```

## Tema terang & pemasangan aplikasi (PWA layar penuh)

Tema hidup sebagai **satu kelas** di `<html>` (`dark`), sesuai `darkMode: ["class"]` di Tailwind:
palet terang ada di `:root`, palet gelap menimpanya di `.dark`. Aturannya (`resolveTheme`, penyimpanan,
`applyTheme`) ada di `src/lib/theme.ts` — dipakai tombol `ThemeToggle` (beranda **dan** header aplikasi)
serta bootstrap kecil di `index.html` yang berjalan **sebelum React** supaya tidak ada kedipan tema.
Bootstrap itu salinan dari aturan yang sama; `verify-theme.mjs` mengeksekusinya di DOM tiruan dan
membandingkan hasilnya dengan `resolveTheme`, jadi keduanya tidak bisa menyimpang diam-diam.

Pemasangannya sendiri adalah PWA biasa tanpa plugin tambahan, jadi `vite.config.ts` tidak disentuh:

- `public/manifest.webmanifest` — `display: "fullscreen"` (dengan `display_override` ke `standalone`),
  **ikon raster (PNG 192/512 + maskable) lebih dulu**, ikon vektor paling belakang, dan tiga pintasan ke
  menu utama. Urutan itu bukan selera: Android **membuat aplikasinya (WebAPK) dari ikon raster**, dan
  ikon SVG ber-`sizes: "any"` yang didahulukan pernah dilaporkan menggagalkan pembuatan WebAPK — jadi
  PNG dulu, SVG sesudahnya (favicon tetap SVG). Manifestnya
  juga **merujuk dirinya sendiri** (`related_applications` dengan `platform: "webapp"`, `url` ke
  `/manifest.webmanifest`, `id: "/"`) — tanpa rujukan itu peramban menolak menjawab pertanyaan
  “aplikasi ini sudah terpasang di perangkat ini?” lewat `navigator.getInstalledRelatedApps()`,
  dan `prefer_related_applications` sengaja **tidak** dinyalakan supaya aplikasi ini sendiri tetap
  bisa dipasang dari browser;
- `public/sw.js` — service worker dengan kebijakan **sempit**: navigasi network-first dengan cadangan
  `/index.html` saat offline, aset build (`/assets/`, ikon, manifest) disimpan lalu diperbarui, dan
  **selain itu lewat begitu saja** — `/src/…`, `/@vite/…`, permintaan tulis, serta seluruh permintaan
  lintas origin (Convex) tidak pernah dicache. Itu yang membuat service worker tidak membuat modul dev
  basi di preview maupun di pengembangan lokal;
- ikonnya adalah **mark brand aplikasi** — ikon `store` lucide yang sama dengan penanda di sidebar,
  beranda, halaman masuk, dan onboarding — digambar hijau merek (`#20C589`) di atas bidang gelap
  aplikasi (`#070A13`, sama dengan `background_color` manifest). PNG-nya dibuat ulang lewat
  `node scripts/gen-icons.mjs` (encoder PNG sendiri, tanpa dependensi; jalur ikonnya salinan apa adanya
  dari `lucide-react`, jadi ikonnya tidak bisa menyimpang dari mark di aplikasi), dan bentuknya sama
  persis dengan `public/icon.svg` yang dipakai favicon.

Ajakan pemasangan mengikuti aturan di `src/lib/pwa.ts` dan tampil **sekali** saja:

1. kunjungan pertama dicatat di perangkat (`mesinpos.install.v1`);
2. **10 detik** setelah aplikasi dibuka, ajakan muncul (tombol `beforeinstallprompt` ditahan dulu,
   jadi browser tidak menyergap di detik pertama);
3. kalau tidak dipasang — ditutup atau dibiarkan — yang tersisa hanya tombol **“Pasang aplikasi”** di
   header beranda, tepat di sebelah tombol **Masuk**; di iOS (tanpa `beforeinstallprompt`) tombol itu
   membuka langkah “Tambah ke Layar Utama”;
4. begitu aplikasinya terpasang, ajakan **dan** tombolnya hilang — termasuk saat alamatnya dibuka lagi
   **di tab browser biasa**, bukan jendela aplikasi.

Satu hal yang sengaja **tidak** didiamkan: memasang aplikasi dari alamat yang **sementara** (pratinjau
sandbox `*.e2b.app`, `localhost`) menghasilkan ikon yang benar-benar ada di layar utama tetapi menunjuk
ke tempat mati — membukanya berakhir “tidak bisa dibuka”. Karena itu ajakan dan petunjuk pasang
memperingatkan apa adanya di alamat seperti itu, dengan menyebut alamat tetapnya
(`STABLE_INSTALL_ORIGIN` = alamat produksi). Aturannya murni (`isEphemeralOrigin`) dan sengaja hanya
mengenali alamat yang jelas sementara; domain lain — termasuk domain sendiri — tidak dituduh apa-apa,
dan di alamat tetap peringatan itu tidak muncul.

Yang terakhir itu yang paling mudah salah: `appinstalled` hanya berbunyi di tab yang sedang terbuka,
dan mode tampilan hanya cocok kalau aplikasinya dibuka dari ikonnya. Jadi “perangkat ini sudah
memasang” dikumpulkan dari empat sumber sekaligus, lalu **dicatat di perangkat** (`installedAt` di
`mesinpos.install.v1`) supaya kunjungan berikutnya tidak menawarinya lagi:

- `beforeinstallprompt` — peramban menawarkan pemasangan ⇒ perangkat ini **belum** terpasang, jadi
  catatan yang keliru (mis. aplikasinya dicopot) dibuang tepat di situ; tanpa itu, tombolnya hilang
  selamanya setelah pemasangan pertama;
- `appinstalled` — pemasangan yang terjadi di tab ini, termasuk lewat menu browser sendiri;
- mode tampilan jendela aplikasi (`fullscreen`, `standalone`, `minimal-ui`, `window-controls-overlay`)
  atau penanda `navigator.standalone` di iOS;
- `navigator.getInstalledRelatedApps()` (Chromium) — satu-satunya cara tahu dari **tab browser biasa**,
  dan jawabannya asinkron: keputusannya dipakai untuk membatalkan ajakan 10 detik yang sudah
  dijadwalkan. Peramban yang tidak punya API-nya (Safari, Firefox) menjawab “tidak tahu”, dan itu
  memang jawabannya — karena itu memasang aplikasinya di Chrome lalu membuka alamatnya di Firefox/Safari
  tetap menampilkan tombolnya: catatan itu memang **per peramban**, dan di sana buktinya hanya bisa
  datang dari mode tampilan (dibuka dari ikonnya).

Berkas `src/lib/pwa.ts` menyimpan aturannya sebagai fungsi murni (`markInstalled`, `markNotInstalled`,
`installedFromRelatedApps`, `shouldOfferInvite`, `shouldShowInstallButton`, `isEphemeralOrigin`), jadi
perilaku itu diuji sebagai aturan **dan** sebagai DOM (`verify-pwa.mjs` merender provider + tombolnya di
happy-dom), serta di Chromium sungguhan (`verify-pwa-browser.mjs`, dijalankan baik terhadap alamat
sementara maupun alamat tetap).

```bash
bun scripts/verify-theme.mjs    # 50/50: aturan tema, paritas palet CSS, permukaan sidebar (gelap, beda nyata dari latar, teks terang), bootstrap index.html dieksekusi, tombol di DOM
bun scripts/verify-pwa.mjs      # 1527/1527: manifest fullscreen + rujukan diri + ikon raster didahulukan, ikon dibaca sampai piksel (mark brand hijau di bidang gelap), sw.js dieksekusi, ajakan 10 detik & tombol header, lima skenario “sudah terpasang” di DOM, dan peringatan alamat sementara
bun scripts/verify-version.mjs  # 44/44: ajakan “Versi baru tersedia — muat ulang” (aturan murni, DOM, jalur diam, shell /app/pos)
# uji browser sungguhan (Chromium/Playwright, PLAYWRIGHT_DIR di luar repo) atas preview yang berjalan:
# PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-version-browser.mjs http://localhost:5173   # 7/7
# PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-mobile-overflow.mjs http://localhost:5173  # 157/157 (header beranda & transaksi ditahan ikut diperiksa)
# PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-pwa-browser.mjs http://localhost:5173     # 8/8
#   → tombol “Pasang” di header beranda di Chromium 390×844: **ada** saat perangkatnya belum
#     memasang, dan **hilang** setelah terbukti memasang — dari catatan perangkat, dari jawaban
#     `getInstalledRelatedApps()`, atau dari dibukanya aplikasi lewat ikonnya; jalur “dijawab
#     peramban” menunggu ajakan 10 detiknya sungguhan (11 detik) supaya pembatalannya ikut terbukti;
#     dan peringatan “alamat sementara” ikut diperiksa mengikuti alamat yang sedang diuji
#     (muncul di `localhost:5173`, tidak muncul di `https://mesinpos.freebuff.app`)
```

**Batas yang masih terbuka:** pemasangan sungguhan hanya bisa dibuktikan di browser atas build produksi,
dan di sandbox yang diuji adalah manifest, service worker, perilaku ajakannya di DOM tiruan, serta
perilaku tombolnya di Chromium 390×844 dengan keadaan “sudah terpasang” yang dibangun dari ketiga jalur
bukti di atas. Yang **tetap** tidak bisa diuji mesin: Safari iOS — `getInstalledRelatedApps()` tidak
diselenggarakan di sana, jadi di iOS jawabannya hanya bergantung pada `navigator.standalone` & mode
tampilan (yaitu ketika aplikasinya dibuka dari ikonnya), dan perangkatnya sendiri tidak pernah dipakai
di sini (Blocker #3 di `worklog.md`).

### Versi baru tersedia — muat ulang

Sisi lain dari pemasangan PWA: tab yang sudah terbuka **tetap menjalankan bundel lama** setelah deploy
berikutnya, dan service worker ikut menyimpan `/assets/*`, jadi halaman lama bisa terus hidup. Dari
keadaan itulah error `[CONVEX Q(products:listAll)] Akses ditolak` pernah datang ke produksi — klien lama,
server baru. SPA hanya berpindah versi lewat muat ulang, jadi aplikasi sekarang mengatakannya sendiri:
banner **“Versi baru tersedia”** dengan tombol **Muat ulang sekarang** (dan **Nanti**), dipasang di
shell `/app` (`src/components/NewVersionNotice.tsx`), di bawah header — tempat kerja yang paling dirugikan
oleh bundel basi.

Aturannya ada di `src/lib/bundleVersion.ts` (murni, jadi bisa diuji tanpa browser):

- **Yang dibandingkan adalah bahan yang benar-benar berjalan.** Dokumen ini memuat bundel mana (dibaca
dari `<script type="module" src>` miliknya), lalu sesekali dibandingkan dengan nama bundel di
`/index.html` yang disajikan **saat ini** (`cache: "no-store"` + penanda waktu, supaya cache HTTP maupun
cache perantara tidak ikut menjawab). Bentuk yang bukan bundel — mis. `/src/main.tsx` di mode dev —
tidak dianggap versi, jadi mode dev tidak pernah menagih muat ulang.
- **Iramanya:** pemeriksaan pertama 45 detik setelah shell terbuka, lalu tiap 5 menit, **ditambah**
begitu tabnya kembali terlihat (`visibilitychange`) atau jaringannya tersambung lagi — saat itulah tab lama
paling berbahaya. Tab yang sedang tersembunyi tidak diperiksa sama sekali.
- **Yang gagal tidak disimpulkan.** Luring, jawaban galat, dan HTML tanpa bundel tidak pernah dianggap
“ada versi baru”; ajakan palsu lebih merugikan daripada ajakan yang telat.
- **Tidak memuat ulang otomatis.** Kasir bisa punya transaksi yang belum diselesaikan — kalimatnya menyuruh
menyelesaikannya dulu, dan yang memutuskan kapan adalah pengguna. “Nanti” diingat **per tab**, dan hanya
untuk versi itu: begitu situs menyajikan bundel yang lebih baru lagi, ajakannya datang kembali.

Harness `bun scripts/verify-version.mjs` (44/44) menguji keempat aturan itu, jalur diamnya, jalur
penjadwalannya (callback yang terjadwal benar-benar memeriksa), dan menempatkannya di shell `/app/pos` yang
asli — termasuk membuktikan tombolnya benar-benar memanggil muat ulang.

### Sidebar backstage: permukaan berwarna & shell yang diam saat digulir

Sidebar `/app` **selalu permukaan gelap berwarna**, bukan `--secondary`/`--card` yang ikut berubah.
Tokennya sendiri (`--sidebar`, `--sidebar-deep`, `--sidebar-foreground`, `--sidebar-muted`,
`--sidebar-border`, `--sidebar-active`) plus satu kelas permukaan `sidebar-surface` di `src/index.css`
(gradien dua nada + pendar aksen hijau di sudut atas, supaya tidak terlihat sebagai kotak rata);
halaman memakai kelasnya (`bg-sidebar-deep`, `text-sidebar-muted`, `border-sidebar-border`,
`text-sidebar-active`, `bg-sidebar-active/15`), bukan warna yang ditulis tetap.

Di tema terang sidebar benar-benar lebih gelap dari halaman (13% vs 100%). Di tema gelap halaman sudah
nyaris hitam (5%), jadi “lebih gelap lagi” tidak mungkin terlihat — versi pertama fitur ini memakai 3%
dan hasilnya **menyatu dengan latarnya**. Karena itu di tema gelap sidebar dibuat sebagai **panel teal
gelap yang lebih terang dari latar** (10% vs 5%, ujung bawah 4%): tetap gelap, tetapi jelas punya warna.
Yang dijaga mesin bukan “lebih gelap”, melainkan: permukaannya gelap (lightness ≤ 20), **berbeda nyata**
dari latar (selisih ≥ 4 poin), gradiennya tidak rata, dan teksnya terang.

Header dan sidebar tidak bergerak saat digulir **bukan** karena `sticky`, melainkan karena susunan
shell-nya: shell setinggi layar yang tidak bergulir sendiri (`app-shell-height flex overflow-hidden`),
dengan **satu** area gulir, yaitu `main` (`overflow-y-auto overflow-x-hidden`). Header dan sidebar berada
di luar area gulir itu, jadi tidak ada cara keduanya ikut terangkat. Daftar menu sidebar punya
gulirannya sendiri (17 menu tidak selalu muat di layar pendek).

Kolom isi itu juga `relative`, dan itu bukan hiasan. Ia menjadi **acuan posisi** bagi elemen `absolute`
di dalam halaman — terutama `.sr-only` (teks pembaca layar, mis. `<caption>` tabel ringkasan). Elemen
seperti itu tidak punya leluhur ber-posisi lain, jadi containing block-nya jatuh ke *initial containing
block*, yang berada **di luar** area gulir ini; klip `overflow` di sini tidak berlaku untuk mereka,
tinggi **dokumen** ikut memanjang, dan seluruh shell (sidebar + header + halaman) bisa diangkat ke atas —
persis gejala yang dilaporkan di halaman Pengaturan, “setelah sampai paling bawah, sidebar, header, dan
halaman naik semua”. Dengan `relative`, elemen-elemen itu ikut terklip di dalam `main` seperti isi
halaman yang lain. Terukur di Chromium 1280×800 pada `/app/settings`: dokumen **800 px** (sama dengan
tinggi layar) saat `relative` terpasang, dan **1522 px** saat kelasnya dilepas.

Tingginya dari kelas `app-shell-height`: `100vh` sebagai cadangan, diganti `100dvh` lewat `@supports` di
browser yang mendukung. Dua kelas Tailwind `h-screen h-dvh` **tidak** dipakai bersamaan, karena urutan
CSS-nya membuat `h-screen` (100vh) yang menang — dan `100vh` selalu memakai tinggi layar *terbesar*,
sehingga di ponsel bagian bawah shell tertutup bilah alamat.

### Mode layar penuh: sidebar disembunyikan, header tetap ada

Tombol **Layar penuh** ada di **tiga tempat**, memakai komponen & hook yang sama
(`src/components/FullscreenToggle.tsx` + `src/lib/useFullscreen.ts`):

| Tempat | Yang terjadi saat ditekan |
| --- | --- |
| Header backstage (`/app/*`, di sebelah tombol tema) | Sidebar kiri disembunyikan, kolom isi memakai seluruh lebar layar |
| Header beranda publik (`/`) | Halaman dibuka layar penuh lewat peramban (tidak ada sidebar di sana) |
| Halaman masuk (`/auth`, pojok kanan atas) | Sama seperti beranda — tombolnya sudah ada **sebelum** sesi terbentuk, karena halaman ini berdiri di luar `/app` |

Di backstage, tekan sekali lagi (atau `Esc`) untuk memunculkan kembali sidebar. Layar jual seperti kasir
dan dapur jadi jauh lebih lega karena 256 px sidebar tidak lagi terpakai.

Dua keputusan yang sengaja diambil:

- **Header tidak ikut disembunyikan.** Tombol keluarnya ada di sana; kalau header ikut hilang, satu-satunya
  jalan keluar adalah `Esc`, dan pemakai ponsel tidak punya tombol itu. Yang diminta memang “tanpa sidebar”.
- **“Tanpa sidebar” tidak bergantung pada izin peramban.** Tombolnya menyembunyikan sidebar lebih dulu,
  lalu **meminta** layar penuh sungguhan lewat Fullscreen API (`document.documentElement.requestFullscreen`).
  Permintaan itu boleh gagal — peramban lama tidak punya API-nya, dan halaman di dalam `<iframe>` tanpa
  `allow="fullscreen"` ditolak — tanpa membatalkan mode aplikasinya. Keluar dari layar penuh peramban
  (mis. `Esc`) ikut memunculkan kembali sidebar lewat pendengar `fullscreenchange`, jadi tombol dan
  tampilan tidak pernah bertentangan.

State-nya hanya hidup selama halaman/shell terpasang (muat ulang = kembali normal): permintaan layar penuh
peramban mensyaratkan sentuhan pengguna, jadi menyimpannya lalu berpura-pura bisa memulihkannya sendiri
hanya akan menyesatkan. Aturannya ada di modul murni `src/lib/fullscreen.ts`; kalimat penjelasnya
mengikuti `hasSidebar` — di beranda dan halaman masuk tidak ada sidebar, jadi `title`-nya tidak
menjanjikan sesuatu yang tidak ada di sana.

```bash
bun scripts/verify-fullscreen.mjs   # 14/14: label & hint (termasuk halaman tanpa sidebar), sembunyikan sidebar, requestFullscreen yang tak ada/ditolak tidak melempar, exitFullscreen hanya saat ada elemen penuh (murni)
bun scripts/verify-render.mjs   # 832/832: shell /app/pos terbuka sungguhan (shell → halaman kasir), header & sidebar di luar satu-satunya area gulir, permukaan gelapnya terpasang, lencana sumber data menyebut “server”, plus tombol Layar penuh yang benar-benar diklik di ketiga tempat — beranda, halaman masuk, dan header backstage (sidebar hilang → kembali)
bun scripts/verify-theme.mjs    # 50/50: permukaan sidebar gelap, beda nyata dari latar di kedua tema, teksnya terang
PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-browser-scroll.mjs   # 60/60: Chromium sungguhan — 6 halaman backstage × 2 ukuran layar (390×844 & 1280×800): dokumen tidak lebih tinggi dari layar, `window.scrollTo` tidak menggeser apa pun, header & sidebar tetap di `top 0` setelah halaman digulir sampai bawah, dan yang bergulir memang `main`
```

### Tombol menu (burger) di header: layar kecil & mode layar penuh

Tombol menu **paling kiri di header backstage** (di depan nama workspace) membuka sidebar sebagai panel
melayang. Ia muncul karena **dua sebab**, dan keduanya berujung pada hal yang sama — sidebar statiknya
sedang tidak ada:

| Keadaan | Sidebar statik | Tombol menu |
| --- | --- | --- |
| Layar lebar, bukan layar penuh | Tampil (256 px) | Tidak muncul |
| Layar kecil (di bawah breakpoint `lg`) | Tidak tampil | **Muncul** — satu-satunya jalan masuk menu |
| Mode layar penuh, lebar apa pun | Tidak tampil (memang dimatikan) | **Muncul** |

Karena “layar kecil” ditentukan **CSS**, bukan JavaScript (lebar viewport ≠ lebar layout saat bilah alamat
muncul), jejaknya kelas `lg:hidden` yang dipasang hanya saat layar penuh tidak aktif — bukan
`window.innerWidth` yang bisa salah menebak. Menekan tombolnya membuka panel `fixed` selebar 256 px yang
**mulai di bawah header** (`top-16`, sama dengan tinggi `h-16` header), dengan latar penutup di atas
halaman. Panel itu bisa ditutup dengan **tiga cara**: tombol yang sama (ikonnya berubah jadi ✕), `Esc`,
atau menekan latarnya; memilih satu menu juga menutupnya karena halaman tujuan harus langsung terbaca
penuh.

Di luar layar penuh panelnya kembali menjadi sidebar statik begitu lebar layarnya cukup (`lg:static`),
jadi pengguna yang memperbesar jendela tidak terjebak dengan panel melayang dan halaman yang tertutup.
Di mode layar penuh panelnya tetap melayang di lebar mana pun — sidebar statiknya memang sedang dimatikan.
Header sengaja diberi `relative z-40`, di atas latar penutup (`z-30`), supaya tombol menu tidak ikut
tertutup lapisan gelapnya.

Aturannya murni dan dipakai bersama header, sidebar, dan harness di `src/lib/sidebarMenu.ts`
(`sidebarMode`, `sidebarClass`, `sidebarBackdropClass`, `sidebarMenuButtonClass`).

```bash
bun scripts/verify-sidebar-menu.mjs   # 19/19: tombol muncul di layar kecil & layar penuh, satu kelas display per keadaan, panel mulai di bawah header, latar z-30 di bawah panel z-40 (murni)
bun scripts/verify-render.mjs         # 832/832: tombolnya benar-benar diklik di DOM tiruan — panel terbuka, ditutup lagi lewat tombol yang sama, latar, Esc, dan pilih menu; di mode layar penuh panelnya tidak kembali statik
PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-browser-menu.mjs   # 12/12: Chromium sungguhan di 390×844 (HP) & 1280×800 — tombol tampil di kiri atas header, panel 256 px menempel kiri + latar, dan mode layar penuh berperilaku sama (media query benar-benar dihitung)
```

## Tata letak HP: tidak ada isi yang terpotong di tepi

Di layar HP (320–414 px) **isi yang lebih lebar dari layar tidak boleh terpotong**. Ini bukan
kerapian belaka: shell backstage memang memakai `overflow-x-hidden`, jadi isi yang terlalu lebar
hilang **tanpa jejak** — dulu tombol **Coba Gratis** di header beranda terpotong 60 px di layar
390 px, panel keranjang kasir terpotong 28 px di 360 px, dan kolom **Aksi** tabel katalog produk
terpotong 581 px (tidak ada jalan membacanya sama sekali).

Dua penyebabnya, dan keduanya sudah ditutup:

1. **Kolom grid implisit ber-ukuran `auto`.** `grid` tanpa kolom eksplisit memakai satu kolom
   implisit yang melebar sampai `max-content` isinya — satu panel yang lebih lebar dari layar
   menarik seluruh halaman ikut melebar. Karena itu tata letak halaman yang bertumpuk di HP
   menulis `grid-cols-1` **sebelum** varian breakpoint-nya (`grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]`),
   dan baris tombol yang tidak mungkin muat menulis `flex-wrap`.
2. **Tabel lebar tanpa wadah geser.** Tabel katalog produk (9 kolom), laporan lintas cabang, dan
   laporan produk teratas dulu berakhir di `overflow-hidden`; sekarang wadahnya `overflow-x-auto`,
   jadi kolom terakhirnya **bisa dicapai dengan menggeser**, bukan dihilangkan.

Pratinjau struk di halaman Pengaturan mengikuti aturan yang sama: lembarnya tetap selebar kertas
sungguhan (58/80/241 mm) supaya pratinjaunya jujur, tetapi wadahnya `max-w-full overflow-x-auto`
sehingga di HP pratinjaunya digeser, bukan dipotong.

Dua perintah untuk menjaganya, keduanya butuh peramban sungguhan (happy-dom tidak menghitung tata
letak, jadi tidak ada harness DOM yang bisa menemukan luapan ini):

```bash
PLAYWRIGHT_DIR=/tmp/pw node scripts/verify-mobile-overflow.mjs      # 181/181: 23 rute × 320/390 px (+ 360/414 px untuk beranda, kasir, katalog) — tidak ada yang terpotong, halamannya benar-benar terisi, header beranda utuh, kolom Aksi tabel katalog bisa dicapai dengan menggeser, dan di kasir 360 px transaksi yang ditahan (tombol Hold), peringatan tutup shift, gerbang “kas belum dibuka”, serta banner pemberitahuan ke pemilik toko (360 & 320 px) muncul tanpa terpotong maupun terjepit
PLAYWRIGHT_DIR=/tmp/pw node scripts/diag-overflow.mjs http://localhost:5173 360 / /app/pos   # diagnosa: daftar elemen terpotong + rantai leluhurnya (siapa yang menentukan lebarnya)
```

Prasyarat peramban dipasang di luar repo, sama seperti harness peramban lain di berkas ini (supaya
unduhan Chromium tidak ikut masuk ke instalasi build hosting), lalu preview-nya harus sedang berjalan:

```bash
mkdir -p /tmp/pw && cd /tmp/pw && bun init -y && bun add playwright
bunx playwright install --with-deps chromium --only-shell
freebuff-preview start   # preview di port 5173
```

## Kalau layarnya putih / halaman kosong

`tsc` dan transformasi modul tidak bisa menangkap error yang hanya muncul saat React benar-benar
merender. Tiga perintah berikut memisahkan penyebabnya (urut dari murah ke mahal):

```bash
bun scripts/diag-module-graph.mjs             # setiap modul dari index.html bisa ditransformasi?
bun scripts/diag-render.mjs / /app/pos        # render SSR per rute (butuh preview/dev server jalan)
bun scripts/diag-scroll.mjs /app/settings     # apa yang membuat dokumen backstage lebih tinggi dari layar (butuh preview/dev server jalan)
PLAYWRIGHT_DIR=/tmp/pw bun scripts/diag-halaman-laporan.mjs   # warna yang benar-benar dihitung tiap bagian halaman Laporan + kontras tema gelap + tangkapan layar
bun scripts/verify-render.mjs                 # render klien sungguhan di DOM tiruan + jalankan efek
```

Yang perlu diketahui saat membaca hasilnya:

- **`diag-module-graph.mjs`** menelusuri impor statis **dan** dinamis dari `index.html`, jadi graf
  bundel produksi pun ikut terbaca. Contoh keluaran sehat: `DIAG modul_diperiksa=43`,
  `DIAG gagal_transform=0`.
- **`diag-render.mjs`** merender rute lewat SSR Vite. Rute `/app/*` **selalu** berhenti di
  `Memuat sesi…` di sana (efek React tidak jalan di server) — itu normal, bukan layar putih.
- **`diag-scroll.mjs`** mencari elemen yang membuat **dokumen** backstage lebih tinggi dari layar (yang
  membuat sidebar & header bisa terangkat): elemen yang menonjol keluar layar atau ber-`position:
  fixed/absolute` disembunyikan satu per satu, lalu tinggi dokumen diukur ulang. Dipakai pada bug
  2026-10-13 (`.sr-only` di halaman Pengaturan) dan sekarang melaporkan
  `(tidak ada yang mengurangi tinggi dokumen)`.
- **`diag-halaman-laporan.mjs`** membuka halaman Laporan di Chromium sungguhan lalu mencetak warna yang
  **benar-benar dihitung** tiap bagian (garis tepi, permukaan, pita, kotak ikon, pita kepala kolom tabel),
  rasio kontras judul/keterangan/pita kepala kolom di tema gelap, dan menyimpan tiga tangkapan layar
  (`/tmp/laporan-desktop.png`, `/tmp/laporan-ponsel.png`, `/tmp/laporan-gelap.png`). Dipakai pada pekerjaan
  2026-10-16 (tampilan berwarna per bagian): warna solid kepala kolom yang **terbuang** oleh `cn()`
  (terbaca `rgba(0, 0, 0, 0)`) dan permukaan kartu yang jadi tembus pandang ketahuan dari alat ini,
  bukan dari membaca kode.
- **`verify-render.mjs`** memasang happy-dom + `react-dom/client`, merender aplikasi yang asli
  **beserta efeknya**, dan memeriksa bahwa beranda serta 19 halaman aplikasi menghasilkan teks, tidak
  ada error yang dilepas ke root, dan `ErrorBoundary` menampilkan pesan saat komponen melempar.
  Ini uji regresi untuk bug 2026-10-11 (lihat `worklog.md`).

### Kenapa layar putih bisa terjadi (dan apa yang sudah dijaga)

React **melepas seluruh pohon komponen** kalau satu error lolos tanpa penangkap, dan yang tersisa
hanya halaman putih tanpa petunjuk apa pun. Dua penjagaan sekarang ada di kode:

1. `src/components/ErrorBoundary.tsx` dipasang di `src/App.tsx` **di luar semua provider** — error
   render apa pun tampil sebagai pesan + tombol **Salin detail**, bukan layar kosong. Sengaja hanya
   HTML + Tailwind supaya tetap bisa merender kalau provider-nya sendiri yang gagal.
2. **`localStorage` bisa melempar**, bukan cuma mengembalikan `null` — di mode privat atau saat
   penyimpanan diblokir browser HP, `setItem` melempar `SecurityError`. Efek sesi di
   `src/lib/session.tsx` sekarang menulis di dalam `try/catch`; sesi tetap hidup di memori tab itu.
   Itu akar masalah yang direproduksi `verify-render.mjs` (gagal sebelum pengaman, lulus setelahnya).

Kalau pesan `ErrorBoundary` muncul di produksi, kirimkan teksnya: pesan itu menyebut komponen dan
barisnya, dan biasanya cukup untuk memperbaiki penyebab berikutnya tanpa menebak.

### Kalau pesannya `[CONVEX Q(...)] … Akses ditolak`

Bentuk itu khas data server: halaman berhenti merender karena **satu langganan ditolak server**, dan
yang tampil adalah pengaman di atas dengan pesan aslinya — mis.
`Uncaught Error: Akses ditolak: peran cashier tidak memiliki izin product.manage`. Penyebabnya selalu
ketidakcocokan antara izin yang dipakai klien untuk membuka langganan dan izin yang dikenali server,
jadi penjagaannya ada di dua tempat:

- **Klien** membuka langganan bergerbang izin hanya dari jawaban server (`api.roles.myAccess` di
  `src/lib/store/convex.tsx`); peran di sesi perangkat tidak pernah dipakai untuk keputusan itu, dan
  selama jawabannya belum ada izinnya kosong. Lihat bagian “Izin yang membuka data datang dari server”.
- **Harness** `bun scripts/verify-store-gate.mjs` memetakan izin yang dituntut setiap `query` di
  `src/convex/*.ts` ke gerbang langganan di store, dan gagal kalau ada satu saja yang tidak digerbang.
- **Harness browser** `scripts/verify-browser-invite.mjs` membuktikannya dari sisi klien sungguhan:
  kasir yang diundang masuk di perangkat baru, halamannya tampil, dan kliennya tidak pernah mengirim
  langganan katalog pengelolaan (`products:listAll`) — lihat bagian “Uji yang membuka browser sungguhan”.

Dua keadaan keanggotaan juga sudah punya penjelasannya sendiri di layar, bukan halaman gagal dimuat:
saat sesi perangkat belum selaras (masuk di perangkat baru) dan saat keanggotaan orangnya dinonaktifkan
pemilik (notis “Workspace belum tersambung ke server”).

**Periksa juga berkas yang sedang berjalan, bukan hanya kodenya.** Pesan ini bisa datang dari **bundel
lama** yang sudah tidak disajikan situs: tab yang dibuka sebelum deploy tetap menjalankan JavaScript yang
lama sampai dimuat ulang (aplikasi ini SPA, jadi memuat ulang halaman adalah satu-satunya cara berpindah
versi — dan service worker ikut menyimpan `/assets/*`, sehingga halaman lama bisa tetap hidup saat
jaringan putus). Nama berkasnya ada di akhir stack trace, mis. `assets/index-ByITNXmA.js`; bandingkan
dengan yang benar-benar disajikan sekarang:

```bash
curl -s https://<situs>/index.html | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'
```

Kalau namanya berbeda, yang perlu dilakukan bukan memperbaiki kode melainkan **memuat ulang paksa**
(`Ctrl+Shift+R`, atau tutup lalu buka lagi aplikasi yang terpasang di ponsel). Perlu diketahui satu
jebakan alat: permintaan ke berkas lama tetap dijawab **HTTP 200** oleh hosting (yang dikirim adalah
`index.html` sebagai cadangan SPA — berkasnya ±3 KB, bukan bundel JavaScript ±1 MB), jadi status
200 bukan bukti bahwa berkas lama masih ada.

Pengguna tidak harus menebak sendiri: sejak banner **“Versi baru tersedia — muat ulang”** ada di
shell `/app` (`src/components/NewVersionNotice.tsx` + aturan di `src/lib/bundleVersion.ts`), perbandingan
bundel berjalan/terbaru itu dilakukan aplikasi — lengkap dengan nama kedua berkas di baris rinciannya.
Lihat bagian “Versi baru tersedia — muat ulang”.

## Aktifkan Convex (langkah demi langkah)

Aplikasi berjalan di **data demo** sampai `VITE_DATA_SOURCE=convex` diset. Convex sengaja
opt-in (`src/lib/store/config.ts`) supaya URL loopback dari `convex dev` lokal tidak pernah
ikut ke preview maupun build produksi.

Sumber data yang sedang aktif ditandai di header backstage: titik **hijau** +
**“Terhubung ke server”** berarti angka di layar datang dari server aplikasi, sedangkan titik kuning
+ **“Data demo”** berarti belum tersambung dan yang tampil adalah data contoh di perangkat — arahkan
kursor ke lencana itu untuk penjelasan lengkapnya. Kalimat catatan di halaman yang sama itu memakai
kata yang sama juga (“server”), bukan nama layanan yang dipasang di belakangnya; nama layanan hanya
muncul di dokumentasi teknis (halaman API & Webhook, backstage platform, dan README ini).

Semua perintah dijalankan di root project.

1. **Login akun Convex** (sekali per mesin). Butuh browser milik Anda, jadi jalankan di
   Terminal workspace:

   ```bash
   bunx convex login
   ```

   Untuk mesin tanpa browser: `bunx convex login --no-open --login-flow paste` akan
   mencetak tautan; buka tautannya, lalu tempel kode balik ke terminal.

2. **Buat & tautkan deployment dev** (sekali per project). Perintah ini memilih/membuat
   project, menulis `CONVEX_DEPLOYMENT` + `VITE_CONVEX_URL=https://<deployment>.convex.cloud`
   ke `.env.local`, dan mengirim fungsi:

   ```bash
   bunx convex dev --configure
   ```

   Cek `bunx convex login status` kalau langkah ini menolak dengan "No Convex account".

   **Jalur alternatif tanpa login di mesin ini (kunci deploy):**

   a. Di dashboard Convex, buka **deployment dev yang dituju** → **Settings → General →
      Deploy keys → Generate a deploy key**, aktifkan izin `deployment:deploy`. Pastikan kunci
      **dev**, bukan production: kunci production mengarahkan `convex dev`/`convex deploy` ke
      deployment produksi proyek, dan CLI tidak menjamin memberi peringatan (lihat
      get-convex/convex-backend#387).
   b. Simpan kuncinya sebagai `CONVEX_DEPLOY_KEY` di Settings → Environment — jangan ditempel ke
      chat atau berkas di repo.
   c. Kirim fungsi tanpa login: `bunx convex deploy`. Kunci menang atas `CONVEX_DEPLOYMENT`, jadi
      targetnya deployment dari kunci itu.

   Kunci yang sama juga bisa **dibuat dari Terminal** (setelah `bunx convex login` di langkah 1),
   jadi tidak perlu menyalin dari dashboard. Perintahnya mencetak kunci utuh — nilai itu yang
   ditempel ke Settings → Environment, dan harus memuat `|`:

   ```bash
   bunx convex deployment token create hosting --deployment mellow-narwhal-477
   # varian produksi: --prod   ·   simpan ke berkas env: --save-env .env.production
   ```

   Dan jalur paling singkat yang tidak melibatkan kunci sama sekali — login lalu tautkan
   deployment-nya, perintah ini sekaligus mengirim fungsi dari workspace ini:

   ```bash
   bunx convex dev --configure
   ```

   **Kirim fungsi otomatis saat deploy produksi.** Build command produksi memakai
   `sh ./scripts/build-hosted.sh`. Skrip itu bekerja berurutan:

   1. mencetak bentuk nilai env yang diterima builder (panjang + jenis, bukan nilainya);
   2. mencoba mengirim fungsi lewat setiap jalur kredensial yang sah:
      `CONVEX_DEPLOY_KEY` apa adanya · prefiks `dev:`/`prod:` bila bagian depannya hilang saat
      menyalin · **kunci dari `.env.local`** yang ikut terkirim ke builder (CLI Convex membaca
      berkas itu sendiri; jalur inilah yang bekerja sekarang, lihat catatan di bawah) ·
      `CONVEX_OVERRIDE_ACCESS_TOKEN` + `CONVEX_DEPLOYMENT` bila yang tersimpan token akses;
   3. **membuktikan** hasilnya lewat HTTP (`scripts/convex-verify-push.mjs`), karena "deploy
      sukses" dari CLI bukan bukti fungsi ada di deployment yang dipakai situs.

   Jalur `.env.local` penting: hosting mengirim salinan `.env.local` dari workspace ke builder,
   jadi kunci deploy yang Anda taruh di **env workspace** (tab Keys/API keys) otomatis dipakai
   saat deploy — tanpa perlu nilai env produksi sama sekali. `CONVEX_DEPLOY_KEY` dari env
   produksi dilepas dulu di langkah itu, karena nilainya yang berbentuk amplop terenkripsi akan
   menimpa berkas dan membuat CLI menolak kunci (401).

   `VITE_DATA_SOURCE` untuk build ditentukan dari hasil langkah 3: `convex` kalau fungsinya
   terbukti ada, `demo` kalau tidak (nilai env yang sah selalu dihormati). `VITE_CONVEX_URL`
   dipakai dari env hanya kalau bentuknya `https://*.convex.cloud`; kalau tidak, nilai kanonik
   `https://<nama-deployment>.convex.cloud` yang dipakai (bisa ditimpa dengan
   `CONVEX_URL_OVERRIDE`). Keduanya selalu di-`export`, sebab Vite lebih memilih nilai proses
   daripada berkas `.env*` — penting, karena builder menerima `.env.local` dari workspace yang
   memuat URL dev `127.0.0.1:3210`.

   ```bash
   freebuff-preview set-build "sh ./scripts/build-hosted.sh"   # minimal: "bun run build"
   freebuff-deploy check && freebuff-deploy start --json
   ```

   **Membaca diagnosis dari log deploy.** Deploy yang gagal memuat stdout build di
   `freebuff-deploy logs`; deploy yang hijau tidak. Untuk memaksa seluruh baris `DIAG` terbaca,
   tukar build command ke `sh ./scripts/build-diag.sh` (menyalakan `BUILD_DIAG`), deploy, baca
   lognya, lalu kembalikan build command normal. Deploy itu memang sengaja gagal tepat sebelum
   build situs; karena penandanya **env**, bukan berkas, deploy normal tidak bisa terhenti oleh
   berkas yang tertinggal — penanda lama `scripts/.diag-stop` pernah menggagalkan satu deploy
   produksi seperti itu (2026-10-11).

   ```bash
   freebuff-preview set-build "sh ./scripts/build-diag.sh"
   freebuff-deploy check && freebuff-deploy start --json    # lalu baca lognya
   freebuff-deploy logs
   freebuff-preview set-build "sh ./scripts/build-hosted.sh"  # kembali normal
   ```
   Baris `DIAG` hanya memuat metadata (panjang, jumlah `|`, awalan, nama deployment yang terbaca,
   host `VITE_CONVEX_URL`) — nilai kredensial tidak pernah dicetak. Bentuk tiap nilai bisa
   diperiksa sendiri:

   ```bash
   node scripts/env-shape.mjs CONVEX_DEPLOY_KEY VITE_CONVEX_URL VITE_DATA_SOURCE
   RAW_KEY='…' node scripts/convex-key-probe.mjs            # bentuk kunci, bukan nilainya
   node scripts/convex-verify-push.mjs mellow-narwhal-477   # baca-saja: fungsi sudah ada?
   ```

   Kunci yang tidak dikenali Convex ditolak dengan pesan persis: `✖ Please set CONVEX_DEPLOY_KEY
   to a new key which you can find on your Convex dashboard.` Pesan itu dibuat CLI **lokal**
   (`deploymentNameFromAdminKey`) dan hanya muncul kalau nama deployment tidak bisa diturunkan
   dari nilainya — yaitu nilainya **tanpa `|`**, atau berkunci `preview:`.

   Status 2026-10-11 (entri "Langkah B percobaan 7" di `worklog.md`, terbaru): fungsi **sudah
   ter-push** ke `https://mellow-narwhal-477.convex.cloud` dan situs produksi membangun dirinya
   dengan `VITE_DATA_SOURCE=convex` (bundel `index-BCtckSx3.js` memuat URL kanonik itu, tanpa URL
   loopback `127.0.0.1:3210`). Bukti bahwa situs memang dibangun dalam mode Convex: bundel yang
   disajikan **byte-identik** dengan hasil build lokal `VITE_DATA_SOURCE=convex`
   (sha256 `73376b87…`, 593.415 byte), sementara build `VITE_DATA_SOURCE=demo` menghasilkan
   berkas lain (`index-D83TrYL1.js`, 520.827 byte). Verifikasi: `node scripts/convex-verify-push.mjs
   mellow-narwhal-477` → `fungsi=ada`, dan `VITE_CONVEX_URL=https://mellow-narwhal-477.convex.cloud
   bun scripts/verify-backend.mjs` → `64/64 checks passed` saat itu (suite bertambah seiring fitur
   baru; sekarang 116/116). Catatan: `/version` di deployment
   **bukan** indikator push (tidak berubah walau fungsi bertambah) — pakai probe fungsi.

   Status sebelumnya (entri "Langkah B percobaan 5"): **nilai env produksi tiba
   di builder sebagai amplop terenkripsi**, bukan teks biasa — dari log build,
   `CONVEX_DEPLOY_KEY len=1220 bentuk=amplop-terenkripsi klaim=c,k,v`,
   `VITE_CONVEX_URL len=1096 … amplop-terenkripsi`, `VITE_DATA_SOURCE len=984 …
   amplop-terenkripsi` (yang terakhir disetel lewat `freebuff-deploy env set`, jadi jalur CLI pun
   sama). Amplop dikenali dari bentuknya: base64url JSON `{"v":"22","c":…,"k":[…]}`. Artinya
   kunci di Settings → Environment **tidak bisa dipakai builder**, sesempurna apa pun isinya, dan
   `VITE_DATA_SOURCE=convex` di sana tidak berpengaruh. Jadi fungsi dikirim dari **workspace**
   (env workspace terbukti terbaca sebagai teks biasa):

   1. taruh `CONVEX_DEPLOY_KEY` di tab Keys/API keys → `.env.local`; bisa juga dari Terminal
      workspace: `freebuff-env set --file .env.local '{"CONVEX_DEPLOY_KEY":"<nilai>"}'`.
      Alternatif tanpa menyalin kunci sama sekali: `bunx convex login` lalu
      `bunx convex dev --configure`. Pastikan kuncinya sudah **terdaftar** (cukup daftar nama;
      proses yang sudah berjalan boleh masih membacanya kosong, lihat catatan):

      ```bash
      freebuff-env list     # CONVEX_DEPLOY_KEY harus muncul di .env.local
      ```

   2. `node_modules/.bin/convex deploy` (atau `bunx convex dev --once`) — mengirim fungsi ke
      deployment yang ditunjuk kunci. **Tidak perlu export apa pun**: CLI Convex membaca
      `.env.local` sendiri, jadi cara ini bekerja walaupun `node scripts/env-shape.mjs
      CONVEX_DEPLOY_KEY` masih berbunyi `kosong` (proses lama memakai snapshot env). Jalur yang
      sama juga dipakai `scripts/build-hosted.sh` saat deploy produksi;
   3. `node scripts/convex-verify-push.mjs mellow-narwhal-477` → harus berbunyi `fungsi=ada`;
   4. `freebuff-deploy start --json` → builder memverifikasi sendiri, lalu membangun dengan
      `VITE_DATA_SOURCE=convex` tanpa bergantung pada nilai env produksi. (Tanpa `--json`
      subcommand-nya ditolak dengan `Unknown freebuff-deploy subcommand`.)

   Varian tegas satu langkah — hosting mengirim fungsi **dan** membangun situs dalam satu
   perintah — berguna kalau kredensialnya sudah terbukti bisa dipakai builder:
   `bun run build:deploy`.

3. **Nyalakan jalur Convex.** Pastikan `VITE_CONVEX_URL` menunjuk `https://…convex.cloud`
   (bukan `http://127.0.0.1:3210`), lalu set flag-nya:

   ```bash
   freebuff-env set --file .env.local --restart '{"VITE_DATA_SOURCE":"convex"}'
   ```

4. **Kirim ulang fungsi** setiap kali `src/convex/` berubah (aman diulang, tidak ada
   proses yang harus dibiarkan hidup):

   ```bash
   bunx convex dev --once
   ```

   Cek cepat apakah fungsi benar-benar sudah ada di deployment itu (baca-saja, tidak menulis
   apa pun). `Could not find public function` berarti masih kosong:

   ```bash
   curl -s -X POST https://<deployment>.convex.cloud/api/query \
     -H 'Content-Type: application/json' \
     -d '{"path":"tenants:getBySlug","args":{"slug":"__readiness_probe__"},"format":"json"}'
   ```

   Selama jawabannya masih error, **jangan** setel `VITE_DATA_SOURCE=convex`: aplikasi akan
   memanggil fungsi yang tidak ada dan halamannya rusak.

5. **Verifikasi.** Preview di-restart oleh langkah 3 (`--restart`); buka `/app` dan pastikan
   dashboard/POS memuat data nyata (bukan contoh demo). Lalu buktikan aturan backend:

   ```bash
   bun scripts/verify-backend.mjs          # 116/116 terhadap deployment yang dipakai aplikasi
   ```

6. **Untuk produksi**, jangan mengandalkan berkas `.env*` **maupun env produksi**: builder
   menerima `.env.local` dari workspace (yang memuat URL dev `127.0.0.1:3210`), dan nilai env
   produksi tiba sebagai amplop terenkripsi yang tidak bisa dibaca Vite. Karena itu konfigurasi
   build yang benar ditetapkan `scripts/build-hosted.sh` sendiri: `VITE_CONVEX_URL` = nilai env
   kalau berbentuk `https://*.convex.cloud` (kalau tidak: nilai kanonik), dan `VITE_DATA_SOURCE`
   = `convex` hanya kalau probe HTTP membuktikan fungsinya ada. Yang perlu Anda lakukan cuma
   memastikan fungsi terkirim (lihat langkah 2); build produksi ikut menyesuaikan.

   ```bash
   freebuff-deploy check    # pastikan build command-nya sh ./scripts/build-hosted.sh
   ```

   Kalau ingin memaksa nilainya sendiri (mis. deployment lain), setel `CONVEX_URL_OVERRIDE` di
   tempat yang benar-benar terbaca builder — praktisnya nilai kanonik di dalam skrip — karena
   `freebuff-deploy env set` untuk nilai `VITE_*` tidak berpengaruh (amplop).

## Dua tempat nilai env: workspace vs produksi

Ada **dua penyimpanan yang terpisah**, dan salah menaruh nilai adalah penyebab paling sering dari
"variabelnya sudah diisi tapi tetap kosong". Isi tabel di bawah diperiksa dengan perintah di
kolom terakhir, bukan asumsi:

| | Workspace | Produksi |
|---|---|---|
| Isi nyata untuk nama yang sama | `VITE_CONVEX_URL=http://127.0.0.1:3210` (URL dev) | `VITE_CONVEX_URL` = amplop 1096 karakter |
| Nama kunci yang terlihat | `CONVEX_DEPLOYMENT`, `CONVEX_DEPLOY_KEY`, `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` | `CONVEX_DEPLOY_KEY`, `VITE_DATA_SOURCE`, `VITE_CONVEX_URL` |
| Diisi lewat | tab **Keys/API keys** (menulis `.env`/`.env.local`), atau `freebuff-env set [--file .env.local]` | **Settings → Environment**, atau `freebuff-deploy env set` |
| Terbaca oleh | setiap `run_terminal_command`, proses preview, shell Terminal/VS Code | hanya hosting saat build/deploy; **tidak** oleh sandbox |
| Bentuknya saat dipakai | teks biasa | amplop terenkripsi (`{"v":"22","c":…,"k":[…]}`) — untuk semua nilai |
| Cek | `freebuff-env list` · `node scripts/env-shape.mjs <NAMA>` | `freebuff-deploy env list` |

Uji pemisahan yang sudah dijalankan di repo ini: `freebuff-deploy env set
'{"FREEBUFF_SCOPE_PROBE":"1"}'` lalu `freebuff-env list` → probe itu **tidak** muncul di
`.env.local` (hanya muncul di `freebuff-deploy env list`), dan sudah dibersihkan lagi dengan
`freebuff-deploy env unset FREEBUFF_SCOPE_PROBE`. Menulis ke satu tempat tidak menulis ke tempat
lain.

Konsekuensinya untuk proyek ini:

- **`CONVEX_DEPLOY_KEY` harus ada di workspace.** Hanya dari sana perintah Convex bisa mengirim
  fungsi (`node_modules/.bin/convex deploy`, `bunx convex dev --once`), dan hosting mengirim
  salinan `.env.local` itu ke builder sehingga deploy produksi juga ikut mengirim fungsi. Nilai
  yang sama di Settings → Environment tidak bisa dipakai builder, sesempurna apa pun isinya.
- **Nilai `VITE_*` jangan diandalkan dari kedua tempat.** Platform menyatakan sendiri nilai
  produksi menang atas berkas `.env` saat deploy ("Production values override the sandbox .env
  files at deploy time."), dan Vite mendahulukan nilai proses atas berkas `.env*`. Karena itu
  `scripts/build-hosted.sh` selalu `export` sendiri: `VITE_CONVEX_URL` dipakai dari env hanya
  kalau berbentuk `https://*.convex.cloud` (kalau tidak: nilai kanonik), dan `VITE_DATA_SOURCE`
  = `convex` hanya setelah probe HTTP membuktikan fungsinya ada.
- Perhatikan bedanya "terdaftar" dan "terbaca proses": `freebuff-env list` bisa sudah
  mencantumkan `CONVEX_DEPLOY_KEY` sementara `node scripts/env-shape.mjs CONVEX_DEPLOY_KEY`
  masih `kosong` (env di-inject saat sesi mulai, jadi proses lama memakai nilai lama). Itu
  **bukan** penghalang: CLI Convex membaca `.env.local` sendiri — terbukti 2026-10-11,
  `node_modules/.bin/convex deploy` berhasil saat `env-shape` masih `len=0`.

**Kenapa deployment lokal `http://127.0.0.1:3210` tidak dipakai:** URL itu diakses dari
browser pengguna (bukan dari sandbox), dan backend-nya hanya hidup selama `bunx convex dev`
berjalan di mesin yang sama. Untuk preview Cloud dan produksi, pakai deployment awan.

**Pengerasan opsional:** `bunx convex env set ALLOW_UNVERIFIED_ACTOR false` — menolak
pemanggil tanpa identitas terverifikasi. **Jangan disetel sekarang:** Convex Auth sudah terpasang,
tetapi baru jalur backstage platform yang memindahkan sesinya ke sana — jalur masuk tenant masih
memakai kode OTP proyek ini dan belum mengirim token, jadi mematikannya akan menolak semua pengguna
tenant. Gerbang akun platform tidak terpengaruh nilai variabel ini: ia selalu menuntut identitas
terverifikasi.

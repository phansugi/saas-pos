/**
 * Uji **peramban sungguhan**: tombol unduh laporan benar-benar menghasilkan berkas.
 *
 * Kenapa harness ini ada: `verify-laporan.mjs` membuktikan byte berkasnya benar
 * (arsip ZIP `.xlsx`, tabel xref PDF, kutip CSV) — tetapi ia **tidak** membuktikan
 * bahwa halamannya mengirim byte itu ke perangkat pengguna. Yang paling mudah rusak
 * justru bagian terakhir itu: `URL.createObjectURL` yang tidak dipanggil, `download`
 * atribut yang hilang sehingga berkasnya terbuka di tab baru, atau tombolnya tidak
 * pernah terpasang karena satu import yang salah. Semua itu tidak terlihat di
 * harness DOM (happy-dom tidak mengunduh apa pun) dan baru ketahuan saat pemilik toko
 * menekan tombolnya.
 *
 * Yang diperiksa di sini, dari **berkas yang benar-benar tersimpan di disk**:
 *
 *   1. nama berkasnya (`laporan-<toko>-<cap waktu>.<ext>`) — pemilik toko mencari
 *      berkasnya di folder unduhan, jadi namanya bagian dari hasilnya;
 *   2. isi awalnya sesuai formatnya (BOM UTF-8 + pemisah titik koma untuk CSV,
 *      `%PDF-` untuk PDF, header ZIP `PK\\x03\\x04` untuk `.xlsx`);
 *   3. ukurannya masuk akal (bukan berkas kosong), dan `.xlsx`-nya punya penanda
 *      akhir arsip (EOCD) — berkas yang terpotong tetap “terunduh” tetapi tidak bisa
 *      dibuka Excel;
 *   4. halaman memberi tahu berkas mana yang barusan disimpan, dan tidak ada galat
 *      peramban yang muncul selama itu.
 *
 * Berkasnya **tidak** dihapus di akhir: jalur penyimpanannya dicetak supaya bisa
 * diperiksa alat lain (mis. `unzip -t` atau `python3 -m zipfile`) — pemeriksaan itu
 * bagian dari verifikasi repo ini dan hasilnya dicatat di `worklog.md`.
 *
 * Prasyarat — paket peramban dipasang di luar repo, supaya unduhan Chromium tidak
 * ikut masuk ke instalasi build hosting (sama seperti `verify-mobile-overflow.mjs`):
 *
 *   mkdir -p /tmp/pw && cd /tmp/pw && bun init -y && bun add playwright
 *   bunx playwright install --with-deps chromium --only-shell
 *
 * Usage:
 *   PLAYWRIGHT_DIR=/tmp/pw bun scripts/verify-laporan-browser.mjs [baseUrl]
 *
 * Default: `http://localhost:5173` (dev server/preview yang sedang berjalan).
 * Sesi backstage disemai lewat `localStorage`, jadi uji ini tidak butuh login dan
 * tidak menyentuh data siapa pun.
 */
import { createRequire } from "node:module";
import { mkdir, rm } from "node:fs/promises";

const BASE = (process.argv[2] ?? "http://localhost:5173").replace(/\/+$/, "");
const OUT = "/tmp/laporan-unduhan";

const playwrightDir = process.env.PLAYWRIGHT_DIR;
const requireFrom = playwrightDir
  ? createRequire(`${playwrightDir.replace(/\/+$/, "")}/`)
  : createRequire(import.meta.url);
const { chromium } = requireFrom("playwright");

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

const SESSION_KEY = "mesinpos.session.v1";
const SESSION = {
  user: { name: "Uji Unduh Laporan", email: "unduh-laporan@mesinpos.test" },
  tenant: {
    name: "Pusat Bahan Bangunan",
    slug: "pusat-bahan-bangunan",
    storeName: "Pusat",
    vertical: "umkm",
    verticals: ["umkm", "fnb", "wholesale"],
    planKey: "enterprise",
    role: "owner",
    customRole: null,
    shift: { active: false, reminderHour: 21, longShiftHours: 14 },
    createdAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  },
};

/** Tiga tombol unduh: id-nya, ekstensi yang diharapkan, dan tanda awal berkasnya. */
const TOMBOL = [
  {
    testid: "laporan-unduh-pdf",
    ext: "pdf",
    cekAwal: (bytes) =>
      new TextDecoder().decode(bytes.subarray(0, 8)).startsWith("%PDF-"),
    /** Berkas PDF diakhiri penanda `%%EOF`. */
    cekAkhir: (bytes) =>
      new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.length - 16))).includes("%%EOF"),
    label: "PDF",
  },
  {
    testid: "laporan-unduh-excel",
    ext: "xlsx",
    cekAwal: (bytes) =>
      bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04,
    /** Arsip ZIP diakhiri EOCD (`PK\x05\x06`) dalam 64 KB terakhir. */
    cekAkhir: (bytes) => {
      for (let index = bytes.length - 22; index >= 0 && index >= bytes.length - 65558; index -= 1) {
        if (
          bytes[index] === 0x50 &&
          bytes[index + 1] === 0x4b &&
          bytes[index + 2] === 0x05 &&
          bytes[index + 3] === 0x06
        ) {
          return true;
        }
      }
      return false;
    },
    label: "Excel",
  },
  {
    testid: "laporan-unduh-csv",
    ext: "csv",
    cekAwal: (bytes) => bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    cekAkhir: (bytes) =>
      new TextDecoder().decode(bytes).trimEnd().length > 0 &&
      new TextDecoder().decode(bytes).includes(";"),
    label: "CSV",
  },
];

await mkdir(OUT, { recursive: true });

let browser;
let failure = null;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(
    ([key, session]) => {
      window.localStorage.setItem(key, JSON.stringify(session));
    },
    [SESSION_KEY, SESSION],
  );

  const page = await context.newPage();
  const galat = [];
  page.on("pageerror", (error) => galat.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") galat.push(message.text());
  });

  await page.goto(`${BASE}/app/reports`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="laporan-unduh"]', { timeout: 30000 });
  check(
    "halaman Laporan menampilkan kartu Unduh laporan",
    (await page.textContent('[data-testid="laporan-unduh"]')).includes("Isinya:"),
    "kartu unduhan tidak lengkap",
  );
  check(
    "daftar unduhan mulai dari keadaan kosong — dan mengatakannya",
    (await page.textContent('[data-testid="laporan-unduhan-kosong"]')).includes(
      "Belum ada berkas yang diunduh",
    ),
    "keadaan kosong tidak dijelaskan",
  );

  const tersimpan = [];
  for (const tombol of TOMBOL) {
    await rm(`${OUT}/laporan-*.${tombol.ext}`, { force: true }).catch(() => {});
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20000 }),
      page.click(`[data-testid="${tombol.testid}"]`),
    ]);
    const nama = download.suggestedFilename();
    const jalur = `${OUT}/${nama}`;
    await download.saveAs(jalur);

    check(
      `${tombol.label}: unduhan terjadi dengan nama laporan-<toko>-<waktu>.${tombol.ext}`,
      new RegExp(`^laporan-[a-z0-9-]+-\\d{8}-\\d{4}\\.${tombol.ext}$`).test(nama),
      nama,
    );

    const bytes = new Uint8Array(await Bun.file(jalur).arrayBuffer());
    check(`${tombol.label}: berkasnya tersimpan di disk (${bytes.length} byte)`, bytes.length > 200, `${bytes.length} byte`);
    check(`${tombol.label}: tandanya sesuai format`, tombol.cekAwal(bytes), `${bytes[0]},${bytes[1]},${bytes[2]},${bytes[3]}`);
    check(`${tombol.label}: berkasnya lengkap sampai akhir`, tombol.cekAkhir(bytes), "akhir berkas tidak sesuai");

    const hasil = await page.textContent('[data-testid="laporan-unduh-hasil"]');
    check(
      `${tombol.label}: halaman memberi tahu berkas yang barusan disimpan`,
      hasil.includes(nama) && /disimpan di perangkat ini/.test(hasil),
      hasil,
    );
    tersimpan.push(jalur);
  }

  /*
    Daftar hasil unduhan: yang diperiksa di sini adalah hal-hal yang tidak bisa
dilihat harness DOM — barisnya muncul di peramban sungguhan, jenis & tanggalnya
terbaca, dan tautan “Unduh ulang”-nya benar-benar menghasilkan berkas lagi (URL
`blob:`-nya masih hidup, bukan sudah dilepas).
  */
  const daftar = await page.$$('[data-testid="laporan-unduhan-baris"]');
  check(
    "daftar unduhan memuat tiga berkas yang barusan disimpan",
    daftar.length === 3,
    `${daftar.length} baris`,
  );
  const baris = [];
  for (const row of daftar) {
    baris.push({
      jenis: await row.getAttribute("data-jenis"),
      waktu: await row.getAttribute("data-waktu"),
      teks: (await row.textContent()).replace(/\s+/g, " ").trim(),
      nama: await row.evaluate((element) =>
        (element.querySelector("span.font-mono")?.textContent ?? "").trim(),
      ),
      href: await row.evaluate(
        (element) => element.querySelector('a[download]')?.getAttribute("href") ?? "",
      ),
    });
  }
  check(
    "daftar unduhan mencantumkan jenis berkasnya",
    ["csv", "xlsx", "pdf"].every((kind) => baris.some((row) => row.jenis === kind)),
    baris.map((row) => row.jenis).join(","),
  );
  check(
    "daftar unduhan mencantumkan nama berkas yang benar",
    baris.every((row) => /^laporan-[a-z0-9-]+-\d{8}-\d{4}\.(pdf|xlsx|csv)$/.test(row.nama)),
    baris.map((row) => row.nama).join(" | "),
  );
  check(
    "daftar unduhan mencantumkan tanggal & jam unduhnya",
    baris.every((row) => /^\d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}$/.test(row.waktu ?? "")) &&
      baris.every((row) => row.teks.includes(row.waktu ?? "x")),
    baris.map((row) => row.waktu).join(" | "),
  );
  check(
    "daftar unduhan menampilkan ukuran berkasnya",
    baris.every((row) => /\d+([,.]\d+)? KB/.test(row.teks)),
    baris.map((row) => row.teks).join(" || "),
  );
  check(
    "daftar unduhan urut dari yang terbaru (CSV terakhir di atas)",
    baris[0]?.jenis === "csv",
    baris.map((row) => row.jenis).join(","),
  );
  check(
    "tautan unduh ulang memakai berkas yang masih hidup (blob:)",
    baris.every((row) => row.href.startsWith("blob:")),
    baris.map((row) => row.href.slice(0, 16)).join(" | "),
  );

  const namaCsv = baris[0]?.nama ?? "";
  const [ulang] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.click('[data-testid="laporan-unduhan-ulang"]'),
  ]);
  check(
    "menekan “Unduh ulang” di daftar benar-benar mengunduh berkas yang sama lagi",
    ulang.suggestedFilename() === namaCsv,
    `${ulang.suggestedFilename()} vs ${namaCsv}`,
  );

  /*
    Warna tabel di halaman: “berwarna” yang tidak sampai ke layar (mis. kelas Tailwind
    yang tidak terkompilasi) hanya kelihatan sebagai tabel putih biasa. Yang diperiksa
    di sini gaya yang benar-benar dihitung peramban: pita kepala kolom, baris
    selang-seling, pita baris jumlah, dan jarak dalam selnya.
  */
  const gayaTabel = await page.evaluate(() => {
    const tabel = document.querySelector('[data-testid="fnb-tax-report"] table');
    if (!tabel) return null;
    const barisIsi = [...tabel.querySelectorAll('tbody tr')];
    const warna = (element) =>
      element ? getComputedStyle(element).backgroundColor : '';
    const pad = (element) =>
      element ? getComputedStyle(element.querySelector('th, td')).paddingLeft : '';
    return {
      kepala: warna(tabel.querySelector('thead')),
      ganjil: warna(barisIsi[0]),
      genap: warna(barisIsi[1]),
      jumlah: warna(tabel.querySelector('tfoot tr')),
      pad: pad(tabel.querySelector('thead tr')),
    };
  });
  check(
    "tabel laporan di layar berkepala kolom berpita warna",
    gayaTabel !== null && gayaTabel.kepala !== "rgba(0, 0, 0, 0)",
    JSON.stringify(gayaTabel),
  );
  check(
    "baris tabel di layar berselang-seling warna (bukan putih semua)",
    gayaTabel !== null &&
      gayaTabel.genap !== "rgba(0, 0, 0, 0)" &&
      gayaTabel.genap !== gayaTabel.ganjil,
    JSON.stringify(gayaTabel),
  );
  check(
    "baris jumlah di layar diberi pita aksen sendiri",
    gayaTabel !== null &&
      gayaTabel.jumlah !== "rgba(0, 0, 0, 0)" &&
      gayaTabel.jumlah !== gayaTabel.kepala,
    JSON.stringify(gayaTabel),
  );
  check(
    "sel tabel di layar punya jarak dalam (angkanya tidak menempel garis)",
    gayaTabel !== null && Number.parseFloat(gayaTabel.pad) >= 8,
    JSON.stringify(gayaTabel),
  );

  /*
    Keterbacaan warna: laporan yang berwarna tetapi tulisannya samar sama tidak
    bergunanya dengan tabel putih polos — dan justru begitulah warna gagal: pita
    hijau terang dengan tulisan putih, atau kepala kolom yang warnanya hilang karena
    kelasnya terbuang saat digabung. Yang diukur rasio kontras teks terhadap latar
    yang benar-benar menempel di belakangnya (menelusuri latar leluhurnya, jadi pita
    setengah transparan pun dihitung apa adanya), minimal 4,5:1 — ambang yang sama
    dengan pemeriksaan palet laporan PDF di `verify-laporan.mjs`.
  */
  const keterbacaan = await page.evaluate(() => {
    const keRgba = (warna) => {
      const angka = (warna.match(/[\d.]+/g) ?? ["0", "0", "0", "1"]).map(Number);
      return [angka[0], angka[1], angka[2], angka[3] ?? 1];
    };
    const luminansi = ([r, g, b]) => {
      const f = (nilai) => {
        const v = nilai / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const rasio = (teks, latar) => {
      const l1 = luminansi(keRgba(teks).slice(0, 3));
      const l2 = luminansi(latar);
      const [terang, gelap] = l1 > l2 ? [l1, l2] : [l2, l1];
      return Math.round(((terang + 0.05) / (gelap + 0.05)) * 100) / 100;
    };
    const periksa = [];
    /**
     * Menambahkan satu pemeriksaan: warna teks elemen dibanding latar efektifnya.
     * Latarnya ditelusuri sampai akar lalu ditimpa dari belakang ke depan, jadi
     * pita setengah transparan di atas kartu pun dihitung sebagaimana terlihat.
     */
    const tambah = (nama, elemen) => {
      if (!elemen) return;
      const tumpukan = [];
      for (let node = elemen; node; node = node.parentElement) {
        tumpukan.push(getComputedStyle(node).backgroundColor);
      }
      let latar = [255, 255, 255];
      for (const warna of tumpukan.reverse()) {
        const [r, g, b, a] = keRgba(warna);
        latar = [
          r * a + latar[0] * (1 - a),
          g * a + latar[1] * (1 - a),
          b * a + latar[2] * (1 - a),
        ];
      }
      periksa.push({ nama, rasio: rasio(getComputedStyle(elemen).color, latar) });
    };

    for (const bagian of [
      "laporan-ringkasan",
      "laporan-unduh",
      "fnb-tax-report",
      "omzet-metode",
      "analitik",
      "franchise",
    ]) {
      tambah(`judul ${bagian}`, document.querySelector(`[data-testid="${bagian}"] h3, [id="${bagian}"] h3`));
    }
    tambah(
      "pita kepala kolom tabel pajak",
      document.querySelector('[data-testid="fnb-tax-report"] thead th'),
    );
    tambah(
      "pita kepala kolom daftar unduhan",
      document.querySelector('[data-testid="laporan-unduhan-daftar"] thead th'),
    );
    return periksa;
  });
  check(
    "tulisan di kepala kolom & judul bagian terbaca di atas latarnya (kontras ≥ 4,5:1)",
    keterbacaan.length >= 8 && keterbacaan.every((row) => row.rasio >= 4.5),
    keterbacaan.map((row) => `${row.nama}=${row.rasio}`).join(", "),
  );
  check(
    "kartu ringkasan singkat tampil dengan kalimat yang bisa dimengerti orang awam",
    (await page.textContent('[data-testid="laporan-ringkasan"]')).includes("Toko menerima") &&
      (await page.$$('[data-testid="laporan-ringkasan-daftar"] li')).length >= 3,
    "ringkasan tidak tampil di halaman",
  );

  /*
    Peta bagian di kepala halaman adalah **navigasi**, bukan hiasan: pilnya harus
    benar-benar memindahkan pandangan ke bagian yang dipilih. Yang diperiksa bukan
    “hash-nya berubah”, melainkan bahwa bagian tujuannya benar-benar masuk ke layar
    dan wadah gulir backstage (`main`, bukan dokumen) ikut bergulir — kalau tidak,
    pil itu hanya tautan mati yang terlihat bagus.
  */
  await page.click('[data-testid="laporan-peta-bagian"] a[href="#analitik"]');
  const petaSesudah = await page
    .waitForFunction(
      () => {
        const sasaran = document.getElementById("analitik");
        if (!sasaran) return false;
        const rect = sasaran.getBoundingClientRect();
        if (rect.top < -8 || rect.top >= window.innerHeight) return false;
        let wadah = null;
        for (let node = sasaran.parentElement; node; node = node.parentElement) {
          if (node.scrollHeight > node.clientHeight + 1) {
            wadah = node;
            break;
          }
        }
        return {
          gulir: Math.round(wadah ? wadah.scrollTop : window.scrollY),
          atas: Math.round(rect.top),
        };
      },
      { timeout: 5000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  check(
    "peta bagian benar-benar memindahkan pandangan ke bagiannya",
    petaSesudah !== null && petaSesudah.gulir > 0,
    JSON.stringify(petaSesudah),
  );

  /*
    Daftar unduhan harus tetap ada setelah halaman dimuat ulang — itu yang membedakan
    “daftar berkas yang sudah diunduh” dari “daftar yang kosong lagi begitu di-refresh”.
    URL `blob:` tidak bisa bertahan, jadi baris lamanya harus menyediakan tombol yang
    **menyusun ulang** berkasnya, dan tombol itu harus benar-benar menghasilkan berkas.
  */
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="laporan-unduhan-daftar"]', { timeout: 30000 });
  const setelahMuatUlang = await page.$$('[data-testid="laporan-unduhan-baris"]');
  check(
    "daftar unduhan bertahan setelah halaman dimuat ulang",
    setelahMuatUlang.length === 3,
    `${setelahMuatUlang.length} baris setelah dimuat ulang`,
  );
  check(
    "URL blob yang sudah mati tidak ditampilkan sebagai tautan",
    (await page.$$('[data-testid="laporan-unduhan-baris"] a[download]')).length === 0,
    "masih ada tautan blob setelah dimuat ulang",
  );
  const [susunUlang] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.click('[data-testid="laporan-unduhan-ulang"]'),
  ]);
  check(
    "tombol “Unduh ulang” baris lama menyusun berkasnya lagi dengan nama yang sama",
    susunUlang.suggestedFilename() === namaCsv,
    `${susunUlang.suggestedFilename()} vs ${namaCsv}`,
  );
  const jalurSusunUlang = `${OUT}/susun-ulang-${susunUlang.suggestedFilename()}`;
  await susunUlang.saveAs(jalurSusunUlang);
  const bytesSusunUlang = new Uint8Array(await Bun.file(jalurSusunUlang).arrayBuffer());
  check(
    "berkas hasil susun ulang benar-benar berkas CSV yang sah (BOM UTF-8)",
    bytesSusunUlang[0] === 0xef && bytesSusunUlang[1] === 0xbb && bytesSusunUlang[2] === 0xbf,
    `${bytesSusunUlang[0]},${bytesSusunUlang[1]},${bytesSusunUlang[2]}`,
  );

  /*
    Berkas PDF yang **sudah tersimpan di disk** dibaca ulang baris demi baris: tiap teks
    yang digambar (`1 0 0 1 x y Tm (...) Tj ET`) dicatat beserta titik gambarnya, lalu
    dipastikan tidak ada dua tulisan yang digambar berturut-turut dari titik X yang sama
    pada garis dasar yang jaraknya kurang dari tinggi hurufnya. Kesalahan yang di layar
    terbaca sebagai **judul yang dicoret** — “(bersambung dari halaman sebelumnya)” yang
    digambar terlalu dekat di bawah judul kartunya — masuk ke kategori ini, dan tidak
    kelihatan sama sekali dari daftar teksnya.
  */
  const jalurPdf = tersimpan.find((jalur) => jalur.endsWith(".pdf"));
  const pdfTeks = new TextDecoder("windows-1252").decode(
    new Uint8Array(await Bun.file(jalurPdf).arrayBuffer()),
  );
  /*
    Yang dibandingkan bukan “jarak garis dasarnya”, melainkan **kotak hurufnya**: tinggi
    hurufnya dibaca dari operator `Tf` di berkasnya, lalu kotak tiap teks dihitung dari
    0,25 em di bawah garis dasar (ekor huruf) sampai 0,75 em di atasnya (huruf besar).
    Judul 12,5 pt dan baris kecil 7,2 pt bisa “berjarak” 7 pt tetapi ekornya sudah saling
    menyentuh — itulah yang terlihat sebagai judul yang dicoret di layar.
  */
  const kotakHuruf = (baris) => ({
    x: baris.x,
    y: baris.y - baris.ukuran * 0.25,
    h: baris.ukuran,
  });
  const aliran = [...pdfTeks.matchAll(/<< \/Length \d+ >>\nstream\n([\s\S]*?)\nendstream/g)];
  const jumlahBaris = aliran.reduce(
    (total, match) =>
      total +
      [...match[1].matchAll(/\/F\d [\d.]+ Tf [\d.]+ Tc 1 0 0 1 [\d.-]+ [\d.-]+ Tm \(.*?\) Tj ET/g)]
        .length,
    0,
  );
  /*
    Diperiksa **per halaman**: halaman menarik dari koordinat yang sama, jadi teks halaman
    dua akan tampak “menimpa” teks halaman pertama kalau semuanya digabung. Yang dicari
    pasangan yang digambar dari **titik X yang sama** tetapi kotak hurufnya bertumpuk —
    itu tanda tulisan menimpa tulisan (judul kartu ditimpa baris kecil di bawahnya), dan
    tidak mungkin disalahartikan sebagai dua tulisan berdampingan pada satu baris.
  */
  const bertumpuk = [];
  aliran.forEach((halamanStream, halamanKe) => {
    const barisGambar = [
      ...halamanStream[1].matchAll(
        /\/F\d ([\d.]+) Tf [\d.]+ Tc 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm \((.*?)\) Tj ET/g,
      ),
    ].map((match) => ({
      ukuran: Number(match[1]),
      x: Number(match[2]),
      y: Number(match[3]),
      teks: match[4],
    }));
    for (let satu = 0; satu < barisGambar.length; satu += 1) {
      for (let dua = satu + 1; dua < barisGambar.length; dua += 1) {
        const a = kotakHuruf(barisGambar[satu]);
        const b = kotakHuruf(barisGambar[dua]);
        const tumpang = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (tumpang > 0.5 && Math.abs(a.x - b.x) < 0.5) {
          bertumpuk.push(
            `“${barisGambar[satu].teks}” ↔ “${barisGambar[dua].teks}” (halaman ${
              halamanKe + 1
            }, ${tumpang.toFixed(1)} pt)`,
          );
        }
      }
    }
  });
  check(
    "berkas PDF yang diunduh: tidak ada tulisan yang menimpa tulisan lain di titik yang sama",
    bertumpuk.length === 0 && jumlahBaris > 100,
    `${jumlahBaris} baris teks: ${bertumpuk.slice(0, 3).join(" | ")}`,
  );

  check(
    "tidak ada galat peramban selama mengunduh",
    galat.length === 0,
    galat.slice(0, 3).join(" | "),
  );

  console.log(`Berkas hasil unduhan:\n  ${tersimpan.join("\n  ")}`);
  await context.close();
} catch (error) {
  failure = error;
} finally {
  if (browser) await browser.close();
}

if (failure) {
  for (const result of results) {
    console.log(`${result.ok ? "✓" : "✗"} ${result.name}`);
  }
  console.error(`\n✗ ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`${results.length}/${results.length} pemeriksaan lulus terhadap ${BASE}`);
}

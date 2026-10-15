/**
 * Kirim struk belanja ke WhatsApp pembeli yang sudah jadi member: isi pesannya,
 * tautan `wa.me` sebagai jalur cadangan, dan badan permintaan ke **WhatsApp Cloud
 * API** (Graph API) sebagai jalur sungguhan.
 *
 * Kenapa ada: setelah pembayaran lunas kasir punya struk yang harus sampai ke
 * pembeli. Ada tiga cara, dan ketiganya berbagi aturan yang sama di sini:
 *
 * 1. **cetak** di printer struk — jalur lama, tetap ada;
 * 2. **unduh PDF** — berkasnya dibuat di perangkat kasir (`@/lib/receiptPdf`);
 * 3. **kirim ke WhatsApp member** — **gambar struknya** (`@/lib/receiptImage`, PNG
 *    berlogo yang sama dengan tombol *Bagikan gambar struk*) dikirim ke nomor yang
 *    sudah diisi member sebelumnya. Berkas PDF-nya tetap ada untuk diunduh
 *    (tombol **Unduh PDF**), dan bentuk pesan dokumennya tetap disusun di modul ini
 *    (`receiptWhatsappMessageRequest`, teruji) kalau jalur itu dipakai lagi.
 *
 * Yang tidak dilakukan di sini: memanggil jaringannya. Modul ini hanya menyusun
 * *apa* yang dikirim (teks pesan, nomor yang sudah dinormalkan, badan multipart
 * untuk unggah berkas) dan *bagaimana hasilnya dibaca*; yang menyentuh jaringan
 * adalah aksi `receiptWa.send` di server. Karena itu aturannya bisa diuji tanpa
 * kartu SIM, tanpa nomor bisnis, dan tanpa satu pun byte keluar dari mesin uji.
 *
 * Empat keputusan yang sengaja diambil:
 *
 * 1. **Nomornya datang dari data member, bukan dari kasir.** Aturan `normalizePhone`
 *    di `./team` sudah dipakai undangan tim; memakai yang sama berarti nomor yang
 *    tersimpan saat member didaftarkan itulah yang dipakai — kasir tidak bisa
 *    “salah ketik nomor” di depan antrean.
 * 2. **Teks pesannya menyebut angka yang sama dengan struknya**: nomor nota,
 *    tanggal, nama member, dan total. Pesan “struk Anda sudah dikirim” tanpa angka
 *    tidak bisa dipakai pembeli untuk mencocokkan belanjanya.
 * 3. **Jalur `wa.me` tetap ada.** Ia hanya bisa membawa teks (WhatsApp tidak
 *    menerima lampiran dari tautan), jadi ia dipakai kalau kanal API belum
 *    tersambung: PDF-nya diunduh dulu, lalu percakapan WhatsApp pembeli dibuka
 *    dengan pesan yang sudah terisi.
 * 4. **Berkasnya diunggah ke WhatsApp, bukan ditaruh di URL publik.** Graph API
 *    menerima berkas langsung (`/media`) dan mengembalikan `media_id` yang bisa
 *    dirujuk pesan **gambar** — jadi tidak ada server berkas publik yang perlu
 *    diadakan hanya untuk mengirim satu struk.
 */

import { formatIdrPlain } from "./fnbTax";
import { normalizePhone } from "./team";

/* ------------------------------------------------ keadaan kanal (kunci env) */

/**
 * Nama kunci lingkungan yang dibaca server, apa adanya.
 *
 * Ditulis sebagai konstanta supaya pesan galat yang dilihat pengguna bisa
 * menyebut kunci yang **persis** sama dengan yang ada di dasbor WhatsApp &
 * dokumentasi: salah satu huruf saja membuat penelusurannya jadi tebak-tebakan.
 */
export const RECEIPT_WA_ENV = {
  /** Token akses sistem/pengguna dari aplikasi WhatsApp Business. */
  token: "WHATSAPP_ACCESS_TOKEN",
  /** ID nomor pengirim (bukan nomornya): “Phone number ID” di dasbor Meta. */
  phoneNumberId: "WHATSAPP_PHONE_NUMBER_ID",
  /** Versi Graph API; opsional. */
  graphVersion: "WHATSAPP_GRAPH_VERSION",
} as const;

/** Versi Graph API kalau `WHATSAPP_GRAPH_VERSION` tidak diisi. */
export const RECEIPT_WA_GRAPH_VERSION_DEFAULT = "v21.0";

/** Induk Graph API. Ditulis satu tempat supaya bisa diperiksa harness. */
export const RECEIPT_WA_GRAPH_HOST = "https://graph.facebook.com";

/**
 * Batas panjang `caption` dokumen menurut WhatsApp: **1024 karakter**.
 *
 * Pesan yang lebih panjang **ditolak seluruhnya** (bukan dipotong), jadi caption
 * kita potong sendiri sebelum dikirim — struk tetap sampai, dan yang hilang cuma
 * ekor kalimat yang memang tidak informatif.
 */
export const RECEIPT_WA_CAPTION_MAX = 1024;

/** Batas panjang nama berkas di pesan WhatsApp. */
export const RECEIPT_WA_FILENAME_MAX = 240;

/**
 * Pagar panjang isi struk yang dikirim sebagai **teks** WhatsApp (tautan `wa.me`
 * dan lembar bagikan perangkat).
 *
 * Ini bukan batas WhatsApp seperti caption lampiran (`RECEIPT_WA_CAPTION_MAX`,
 * 1024 karakter — batas keras dari API-nya), melainkan pagar kita sendiri supaya
 * tautannya tetap masuk akal untuk struk yang luar biasa panjang: struk belanja
 * biasa (puluhan baris) jauh di bawah angka ini, dan yang melebihinya dipotong
 * dengan penanda “…” alih-alih membuat tautan yang tidak bisa dibuka.
 */
export const RECEIPT_WA_TEXT_MAX = 4096;

export interface ReceiptWhatsappConfig {
  /** `true` kalau token **dan** id nomor pengirim sudah ada. */
  configured: boolean;
  /** Kunci yang belum diisi, siap disebut ke pengguna. */
  missing: string[];
  /** Token akses; `null` kalau belum ada. Tidak pernah dikirim ke klien. */
  token: string | null;
  phoneNumberId: string | null;
  graphVersion: string;
}

/**
 * Membaca keadaan kanal dari lingkungan server.
 *
 * Yang dianggap “belum siap” hanya kekurangan **wajib** (token & id nomor).
 * Versi Graph API punya bawaan, jadi workspace yang hanya mengisi dua kunci
 * wajib tetap bisa mengirim.
 */
export function receiptWhatsappConfig(
  env: Record<string, string | undefined>,
): ReceiptWhatsappConfig {
  const token = (env[RECEIPT_WA_ENV.token] ?? "").trim();
  const phoneNumberId = (env[RECEIPT_WA_ENV.phoneNumberId] ?? "").trim();
  const version = (env[RECEIPT_WA_ENV.graphVersion] ?? "").trim();

  const missing: string[] = [];
  if (token === "") missing.push(RECEIPT_WA_ENV.token);
  if (phoneNumberId === "") missing.push(RECEIPT_WA_ENV.phoneNumberId);

  return {
    configured: missing.length === 0,
    missing,
    token: token === "" ? null : token,
    phoneNumberId: phoneNumberId === "" ? null : phoneNumberId,
    graphVersion: version === "" ? RECEIPT_WA_GRAPH_VERSION_DEFAULT : version,
  };
}

/** Bagian keadaan kanal yang boleh sampai ke klien (tanpa rahasia apa pun). */
export function receiptWhatsappSummary(config: ReceiptWhatsappConfig): {
  configured: boolean;
  missing: string[];
} {
  return { configured: config.configured, missing: config.missing };
}

/**
 * Menyensor nomor untuk ditampilkan kembali.
 *
 * Kasir perlu yakin nomornya memang nomor yang benar, tetapi nomor utuh tidak
 * perlu tercetak di layar kasir — layar POS dilihat pembeli berikutnya di
 * antrean. Empat digit depan (kode negara + awal nomor) dan tiga digit akhir
 * cukup untuk mencocokkan.
 */
export function maskPhone(raw: string): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length <= 3) return "•".repeat(Math.max(1, digits.length));
  const depan = Math.min(4, Math.max(1, digits.length - 3));
  const ekor = digits.length - depan;
  return `${digits.slice(0, depan)}${"•".repeat(ekor)}`;
}

/* --------------------------------------------------------------- isi pesan */

export interface ReceiptWhatsappCaptionInput {
  /** Nama usaha; dipakai sebagai pembuka pesan. */
  business: string;
  /** Nama cabang/toko, kalau ada. */
  store?: string | null;
  /** Nomor nota (`A-00042`). */
  number?: string | null;
  /** Tanggal siap-baca, sama seperti yang tercetak di struk. */
  when?: string | null;
  /** Nama member yang struknya dikirim. */
  member?: string | null;
  /** Total belanja dalam rupiah. */
  total: number;
}

/**
 * Isi pesan yang menemani PDF struk.
 *
 * Angka-angkanya sengaja sama dengan yang tercetak di struk (nomor, tanggal,
 * total) supaya pesan ini bisa dipakai mencocokkan belanja **tanpa** membuka
 * lampirannya — dan kalau lampirannya gagal dibuka, pesannya masih berguna.
 */
export function receiptWhatsappCaption(input: ReceiptWhatsappCaptionInput): string {
  const business = (input.business ?? "").trim() || "MesinPOS";
  const store = (input.store ?? "").trim();
  const baris: string[] = [
    `Struk belanja dari ${business}${store ? ` (${store})` : ""}:`,
  ];
  if (input.number) baris.push(`No. ${input.number}`);
  if (input.when) baris.push(`Tanggal ${input.when}`);
  if (input.member) baris.push(`Member ${input.member}`);
  baris.push(`Total ${formatIdrPlain(input.total)}`);
  baris.push("PDF struknya kami lampirkan. Terima kasih telah berbelanja.");

  const teks = baris.join("\n");
  if (teks.length <= RECEIPT_WA_CAPTION_MAX) return teks;
  // Dipotong, bukan ditolak: WhatsApp menolak caption yang kepanjangan, dan
  // kehilangan kalimat penutup lebih baik daripada kehilangan seluruh kiriman.
  return `${teks.slice(0, RECEIPT_WA_CAPTION_MAX - 1)}…`;
}

/**
 * Isi struk sebagai teks biasa: baris-baris yang **sama** dengan yang keluar di
 * kertas, hanya dirapikan untuk layar.
 *
 * Spasi di ujung kanan tiap baris dibuang — struk diisi selebar kertasnya,
 * sedangkan spasi itu tidak terlihat di pesan. Spasi di tengah & di kiri
 * **dipertahankan**: justru itulah yang menyejajarkan kolom nominal, jadi struk
 * yang dibaca di WhatsApp tetap berbentuk struk, bukan tumpukan teks. Baris kosong
 * di ekor ikut dibuang supaya pesannya tidak diakhiri beberapa baris kosong.
 */
export function receiptWhatsappReceiptText(lines: readonly string[]): string {
  const baris = (lines ?? []).map((line) =>
    typeof line === "string" ? line.replace(/[ \t]+$/, "") : "",
  );
  let akhir = baris.length;
  while (akhir > 0 && baris[akhir - 1] === "") akhir -= 1;
  return baris.slice(0, akhir).join("\n");
}

/**
 * Isi struk siap kirim sebagai pesan WhatsApp.
 *
 * Teksnya dibungkus blok monospace WhatsApp (```` ``` ````) **kalau muat**, supaya
 * kolom harganya tetap sejajar seperti di kertas — pesan WhatsApp memakai huruf
 * proporsional, dan struk yang rata kiri-kanan kehilangan bentuknya di sana. Yang
 * tidak muat dipotong di batas `max` dan ditutup “…” alih-alih mengirim teks yang
 * membuat tautannya tak bisa dibuka.
 *
 * Kalau isinya sendiri sudah memuat ```` ``` ````, pembungkusnya dilewati: blok yang
 * rusak lebih buruk daripada teks rapi yang tidak monospace.
 */
export function receiptWhatsappReceiptMessage(
  lines: readonly string[],
  max: number = RECEIPT_WA_TEXT_MAX,
): string {
  const teks = receiptWhatsappReceiptText(lines);
  if (teks === "") return "";
  const dibungkus = teks.includes("```") ? null : `\`\`\`\n${teks}\n\`\`\``;
  if (dibungkus !== null && dibungkus.length <= max) return dibungkus;
  if (teks.length <= max) return teks;
  return `${teks.slice(0, Math.max(1, max) - 1)}…`;
}

/* ------------------------------------------------------- jalur cadangan wa.me */

export type ReceiptWhatsappLink =
  | { ok: true; url: string; phone: string }
  | { ok: false; reason: string };

/**
 * Tautan percakapan WhatsApp dengan pesan sudah terisi.
 *
 * Dipakai kalau kanal API belum tersambung: yang terkirim hanya **teksnya**, dan
 * PDF-nya perlu kasir lampirkan sendiri dari berkas yang sudah diunduh. Karena
 * itu tautan ini tidak pernah dilaporkan sebagai “terkirim” — sama seperti
 * undangan tim lewat WhatsApp di `./team`.
 */
export function receiptWhatsappLink(phone: string, text: string): ReceiptWhatsappLink {
  const nomor = normalizePhone(phone);
  if (!nomor.valid || !nomor.value) {
    return { ok: false, reason: nomor.reason ?? "Nomor WhatsApp member tidak valid." };
  }
  return {
    ok: true,
    phone: nomor.value,
    url: `https://wa.me/${nomor.value}?text=${encodeURIComponent(text)}`,
  };
}

/** Nama berkas PDF yang aman dikirim: tanpa spasi, garis miring, atau tanda kutip. */
export function receiptWhatsappFilename(raw: string, fallback: string): string {
  const bersih = (raw ?? "")
    .replace(/[^\w.\- ]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    // Tanda hubung yang bersisa menempel di titik atau di tepi nama dibuang:
    // `struk "asli".pdf` tidak boleh jadi `struk-asli-.pdf`.
    .replace(/-+\./g, ".")
    .replace(/\.-+/g, ".")
    .replace(/^-+|-+$/g, "")
    .slice(0, RECEIPT_WA_FILENAME_MAX);
  return bersih === "" ? fallback : bersih;
}

/* ---------------------------------------------------- permintaan Graph API */

/**
 * Satu permintaan HTTP yang siap dikirim.
 *
 * Dipisah dua bentuk — badan **teks** (JSON pesan) dan badan **byte** (unggah
 * berkas) — supaya pemanggilnya tidak perlu menebak isinya: pengunggah berkas
 * memang byte, pengirim pesan memang teks.
 */
export interface ReceiptWhatsappJsonRequest {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface ReceiptWhatsappBinaryRequest {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** Permintaan apa pun yang bisa dikirim langsung ke Graph API. */
export type ReceiptWhatsappRequest =
  | ReceiptWhatsappJsonRequest
  | ReceiptWhatsappBinaryRequest;

/** Menyambung potongan teks & byte jadi satu badan permintaan. */
function receiptWhatsappConcat(
  chunks: readonly (string | Uint8Array)[],
): Uint8Array {
  const encoder = new TextEncoder();
  const parts = chunks.map((chunk) =>
    typeof chunk === "string" ? encoder.encode(chunk) : chunk,
  );
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Batas ukuran **gambar** struk yang mau diunggah: **5 MB** — batas gambar WhatsApp.
 *
 * Gambar struk dari perangkat kasir hanya ratusan kilobyte (PNG kertas putih dengan
 * teks tipis), jadi batas ini sekali lagi hanya menahan permintaan yang salah.
 */
export const RECEIPT_WA_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export interface ReceiptWhatsappMediaInput {
  config: ReceiptWhatsappConfig;
  /** PDF struk atau gambar struk, apa adanya dari pembuatnya di perangkat kasir. */
  bytes: Uint8Array;
  /** Nama berkas yang dilihat penerima. */
  filename: string;
  /**
   * Berkas ini dipakai pesan **dokumen** (bawaan) atau pesan **gambar**.
   *
   * Bedanya menentukan dua hal di badan multipart: kolom `type` yang dikirim ke
   * WhatsApp dan `Content-Type` berkasnya. WhatsApp memakai keduanya untuk
   * memutuskan cara berkasnya ditampilkan ke penerima — salah satunya saja (mis.
   * PDF yang mengaku gambar) membuat lampirannya tidak bisa dibuka.
   */
  kind?: "document" | "image";
  /** Tipe berkasnya; bawaan mengikuti `kind`. */
  mimeType?: string;
  /**
   * Pemisah bagian multipart. Disuntikkan pemanggil (bukan diacak di sini) supaya
   * badannya bisa diuji tanpa kehilangan sifat “pemisahnya acak” saat dikirim.
   */
  boundary: string;
}

/**
 * Permintaan unggah berkas ke WhatsApp (`POST /{phone-number-id}/media`).
 *
 * WhatsApp menerima berkas struk langsung lewat multipart dan mengembalikan id
 * berkas yang bisa dirujuk pesan dokumen. Karena kartu SIM & tokennya milik
 * workspace, unggahannya tidak lewat server perantara mana pun.
 */
export function receiptWhatsappMediaRequest(
  input: ReceiptWhatsappMediaInput,
): ReceiptWhatsappBinaryRequest {
  const { config, bytes, boundary } = input;
  const jenis = input.kind ?? "document";
  const tipe = input.mimeType ?? (jenis === "image" ? "image/png" : "application/pdf");
  const dash = `--${boundary}`;
  const body = receiptWhatsappConcat([
    `${dash}\r\n`,
    `Content-Disposition: form-data; name="messaging_product"\r\n\r\n`,
    `whatsapp\r\n`,
    `${dash}\r\n`,
    `Content-Disposition: form-data; name="type"\r\n\r\n`,
    `${jenis}\r\n`,
    `${dash}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="${input.filename}"\r\n`,
    `Content-Type: ${tipe}\r\n\r\n`,
    bytes,
    `\r\n${dash}--\r\n`,
  ]);

  return {
    method: "POST",
    url: `${RECEIPT_WA_GRAPH_HOST}/${config.graphVersion}/${config.phoneNumberId}/media`,
    headers: {
      Authorization: `Bearer ${config.token ?? ""}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  };
}

export interface ReceiptWhatsappMessageInput {
  config: ReceiptWhatsappConfig;
  /** Nomor penerima dalam bentuk digit + kode negara. */
  to: string;
  /** `media_id` hasil unggahan. */
  mediaId: string;
  filename: string;
  caption: string;
}

/**
 * Permintaan kirim pesan **dokumen** (`POST /{phone-number-id}/messages`).
 *
 * Jenisnya `document`: struk PDF harus sampai sebagai berkas yang bisa dibuka &
 * disimpan pembeli. **Jalur kirim yang dipakai sekarang adalah pesan gambar**
 * (`receiptWhatsappImageMessageRequest`) karena logo tokonya langsung terlihat di
 * percakapan; bentuk pesan dokumen ini tetap disimpan & teruji supaya jalur itu bisa
 * dipakai lagi tanpa menulis ulang badannya — PDF-nya sendiri tetap bisa diunduh
 * dari dialog struk.
 */
export function receiptWhatsappMessageRequest(
  input: ReceiptWhatsappMessageInput,
): ReceiptWhatsappJsonRequest {
  const { config } = input;
  return {
    method: "POST",
    url: `${RECEIPT_WA_GRAPH_HOST}/${config.graphVersion}/${config.phoneNumberId}/messages`,
    headers: {
      Authorization: `Bearer ${config.token ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "document",
      document: {
        id: input.mediaId,
        filename: input.filename,
        caption: input.caption,
      },
    }),
  };
}

/**
 * Permintaan kirim **pesan gambar** (`POST /{phone-number-id}/messages`).
 *
 * Kenapa dipakai di samping pesan dokumen: logo toko ada **di dalam** PDF, jadi lewat
 * pesan dokumen saja penerimanya harus membuka berkasnya dulu untuk melihat identitas
 * tokonya. Pesan gambar menampilkan struknya langsung di percakapan — berikut logonya,
 * karena gambarnya digambar di perangkat kasir (piksel yang sama dengan yang diuji di
 * `verify-struk-browser.mjs`). Pesan gambar tidak punya kolom `filename`: yang dipakai
 * penerimanya adalah keterangan (`caption`) — di situ isi struknya diringkas.
 */
export function receiptWhatsappImageMessageRequest(
  input: ReceiptWhatsappMessageInput,
): ReceiptWhatsappJsonRequest {
  const { config } = input;
  return {
    method: "POST",
    url: `${RECEIPT_WA_GRAPH_HOST}/${config.graphVersion}/${config.phoneNumberId}/messages`,
    headers: {
      Authorization: `Bearer ${config.token ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.to,
      type: "image",
      image: {
        id: input.mediaId,
        caption: input.caption,
      },
    }),
  };
}

/* ------------------------------------------------------ nomor tujuan struk */

/**
 * Struk ini milik siapa: pembeli **member** terdaftar (ada baris di halaman
 * Member) atau pembeli **umum** yang tidak punya member sama sekali.
 *
 * Bedanya cuma satu dan itu menentukan: pembeli umum tidak punya nomor tersimpan
 * yang bisa dibaca, jadi satu-satunya sumber nomornya adalah yang diketik kasir —
 * sedangkan pembeli member selalu mengutamakan nomor yang sudah ia daftarkan
 * sendiri. Kategorinya ikut dicatat di jejak audit supaya “struk tanpa member ini
 * dikirim ke nomor siapa” bisa ditelusuri tanpa menebak.
 */
export type ReceiptWhatsappBuyer = "member" | "umum";

export type ReceiptWhatsappRecipient =
  | {
      ok: true;
      phone: string;
      /** Dari mana nomornya diambil. */
      source: "member" | "kasir";
      /** Kategori pembelinya, untuk jejak audit. */
      buyer: ReceiptWhatsappBuyer;
    }
  | { ok: false; reason: string };

/**
 * Menentukan nomor tujuan struk dari dua sumber.
 *
 * Nomor yang **tersimpan di data member** selalu menang — itu nomor yang sudah
 * didaftarkan, dan struk berikutnya tidak boleh mendarat di nomor lain hanya
 * karena kasir salah ketik. Nomor yang **diketik kasir** dipakai sebagai cadangan
 * untuk member yang datanya belum lengkap (mis. member cash yang didaftarkan cepat
 * di kasir) **dan** untuk pembeli umum yang memang tidak punya baris member (`buyer`
 * `"umum"`: `storedPhone` selalu kosong, nomornya datang dari pembeli di depan
 * kasir). Nomor ketikan tetap melewati `normalizePhone` yang sama — jadi yang lolos
 * hanya nomor yang bentuknya benar. Asal nomornya dikembalikan supaya bisa dicatat
 * di jejak audit.
 *
 * Dipakai bersama oleh `receiptWaData.prepareSend` (server) dan mode demo, sehingga
 * “nomor mana yang dipakai” tidak pernah berbeda antara kedua backend.
 */
export function receiptWhatsappRecipient(
  storedPhone: string | null | undefined,
  typedPhone: string | null | undefined,
  /** Asal struknya; hanya memengaruhi kalimat penolakannya. Bawaan `member`. */
  buyer: ReceiptWhatsappBuyer = "member",
): ReceiptWhatsappRecipient {
  const tersimpan = normalizePhone(storedPhone ?? "");
  if (tersimpan.valid && tersimpan.value) {
    return { ok: true, phone: tersimpan.value, source: "member", buyer };
  }
  const diketik = normalizePhone(typedPhone ?? "");
  if (diketik.valid && diketik.value) {
    return { ok: true, phone: diketik.value, source: "kasir", buyer };
  }
  return {
    ok: false,
    reason:
      buyer === "umum"
        ? "Struk pembeli umum ini belum punya nomor tujuan: isi kolom “Nomor WhatsApp pembeli” di dialog struk dengan nomor yang diberikan pembelinya, lalu kirim ulang struknya."
        : "Nomor WhatsApp penerimanya belum ada: member ini belum mengisinya, dan kolom nomor di dialog struk juga masih kosong atau belum sah.",
  };
}

/* ----------------------------------------------------------- hasil kiriman */

/**
 * Alasan kiriman struk tidak terjadi, dipakai bersama oleh server & kasir.
 *
 * Ditulis sebagai kode, bukan kalimat: kasir yang menampilkannya perlu
 * menyebutkan **apa yang harus dibetulkan** (nomor member atau kunci kanal),
 * dan aturan tampilannya bisa berbeda tanpa mengubah pesan server.
 */
export type ReceiptWhatsappFailure =
  /**
   * Member penerima yang ditunjuk tidak ada di workspace ini. Struk **pembeli
   * umum** (tanpa member sama sekali) bukan kasus ini — di sana yang diperiksa
   * nomornya, `no-phone`.
   */
  | "no-member"
  /** Nomor tujuannya belum ada: member belum mengisinya, atau pembeli umum belum diberi nomor. */
  | "no-phone"
  /** Kanal WhatsApp belum tersambung (kunci server belum diisi). */
  | "not-configured"
  /** Sudah dicoba, tetapi WhatsApp/pengirimnya menolak. */
  | "failed";

/** Balasan aksi kirim struk: berhasil (dengan penerimanya) atau beserta alasannya. */
export type ReceiptWhatsappSendResult =
  | {
      ok: true;
      /** Nomor penerima yang sudah disensor, mis. `6281•••••890`. */
      to: string;
      messageId: string;
      /** `true` = mode demo: disimulasikan, tidak ada pesan yang benar-benar keluar. */
      simulated?: boolean;
    }
  | {
      ok: false;
      code: ReceiptWhatsappFailure;
      reason: string;
      /** Nama kunci lingkungan yang belum diisi, kalau alasannya `not-configured`. */
      missing?: string[];
    };

export type ReceiptWhatsappSendOutcome =
  | { ok: true; mediaId: string }
  | { ok: false; reason: string };

/** Pesan galat dari badan balasan Graph API, apa pun bentuknya. */
function receiptWhatsappErrorText(status: number, payload: unknown): string {
  const isi = payload as
    | { error?: { message?: unknown }; message?: unknown }
    | null
    | undefined;
  const pesan =
    typeof isi?.error?.message === "string"
      ? isi.error.message
      : typeof isi?.message === "string"
        ? isi.message
        : "";
  return pesan.trim() === ""
    ? `WhatsApp menolak permintaannya (HTTP ${status}).`
    : `WhatsApp menolak permintaannya (HTTP ${status}): ${pesan.trim()}`;
}

/**
 * Membaca balasan unggahan berkas.
 *
 * Yang dianggap berhasil hanya balasan yang **benar-benar membawa id berkas**:
 * balasan 200 tanpa id berarti struknya tidak akan pernah bisa dilampirkan, jadi
 * lebih jujur dilaporkan gagal daripada diteruskan menjadi kiriman kosong.
 */
export function receiptWhatsappMediaOutcome(
  status: number,
  payload: unknown,
): ReceiptWhatsappSendOutcome {
  if (status >= 200 && status < 300) {
    const id = (payload as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id.trim() !== "") {
      return { ok: true, mediaId: id.trim() };
    }
    return { ok: false, reason: receiptWhatsappErrorText(status, payload) };
  }
  return { ok: false, reason: receiptWhatsappErrorText(status, payload) };
}

/** Membaca balasan pengiriman pesan: butuh id pesan yang benar-benar terbit. */
export function receiptWhatsappMessageOutcome(
  status: number,
  payload: unknown,
): { ok: true; messageId: string } | { ok: false; reason: string } {
  const pesan = (payload as { messages?: { id?: unknown }[] } | null)?.messages;
  const id = Array.isArray(pesan) ? pesan[0]?.id : undefined;
  if (status >= 200 && status < 300 && typeof id === "string" && id.trim() !== "") {
    return { ok: true, messageId: id.trim() };
  }
  return { ok: false, reason: receiptWhatsappErrorText(status, payload) };
}

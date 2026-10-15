/**
 * Bunyi "bip" mesin kasir saat produk diklik di halaman POS, beserta setelannya.
 *
 * Kenapa ada: kasir bekerja sambil melihat pembeli, bukan layar. Umpan balik
 * visual saja (baris keranjang yang bertambah) mudah terlewat saat produk
 * diklik beruntun, dan tanpa bunyi kasir baru sadar belakangan bahwa satu
 * ketukan tidak masuk. Bunyinya karena itu **pendek dan tenang** — sekedar tanda
 * "tercatat", bukan alarm.
 *
 * Bunyi dan setelannya hidup di satu berkas murni ini supaya halaman kasir,
 * halaman Pengaturan, dan harness memakai aturan yang sama. Harness menyuntikkan
 * pemutar tiruan (`setScanBeepPlayer`) supaya "apakah kasir berbunyi" bisa
 * diperiksa tanpa audio sungguhan.
 *
 * Tiga hal yang sengaja dijaga:
 *
 *  - **tidak pernah melempar.** Peramban tanpa Web Audio (DOM tiruan, peramban
 *    tua, kebijakan privasi yang memblokir audio) hanya menghasilkan senyap —
 *    kasir tidak boleh gagal menjual karena bunyinya tidak bisa dibunyikan;
 *  - **dibuat sekali, dipakai berulang.** `AudioContext` itu mahal dan peramban
 *    membatasi jumlahnya, jadi satu konteks dipakai ulang untuk semua ketukan;
 *  - **bisa dimatikan & diatur kerasnya, per perangkat.** Ruang toko
 *    berbeda-beda (dan di malam hari kasir kadang ingin senyap), jadi ada setelan
 *    aktif/mati **dan** setelan volume 10–100 % yang disimpan di perangkat itu
 *    sendiri — bukan setelan workspace.
 *
 * Sejak 2026-10-14 nada yang sama dipakai untuk hal kedua: **notifikasi tagihan
 * QR baru** di kartu antrean dapur (`playKdsAlertBeep`, nada `KDS_ALERT_BEEP`).
 * Bunyinya memakai setelan perangkat yang sama supaya tidak ada dua saklar yang
 * bisa berbeda, tetapi nadanya sengaja dibedakan supaya “produk diklik” dan
 * “tagihan baru menunggu” tidak tertukar.
 *
 * Volume bukan hiasan: bip yang sama bisa terlalu pelan di ruang ramai dan
 * terlalu keras di ruang sepi, dan yang tahu bedanya cuma orang yang berdiri di
 * til itu. Karena itu kontrolnya ada di **dua tempat**: halaman Pengaturan dan
 * header kasir (`/app/pos`).
 */

/** Satu nada bip: frekuensi, lamanya, dan bentuk amplopnya. */
export interface ScanBeepTone {
  /** Frekuensi nada dalam hertz. */
  frequencyHz: number;
  /** Lama nada berbunyi, dalam milidetik. */
  durationMs: number;
  /** Bentuk gelombang; `triangle` menonjol tanpa terasa tajam/nyaring. */
  waveform: OscillatorType;
  /** Kekuatan puncak (0–1). Kecil supaya tidak mengagetkan di ruang ramai. */
  peakGain: number;
  /** Lama naik & turun amplop, supaya ujung nada tidak berbunyi "klik". */
  fadeMs: number;
}

/** Batas atas puncak yang masih sopan dipakai di depan pelanggan. */
export const SCAN_BEEP_MAX_GAIN = 0.25;

/**
 * Nada bip baku: satu nada di sekitar dua oktaf di atas nada bicara, cukup tinggi
 * untuk terdengar di atas bising kasir tetapi tidak menusuk.
 *
 * Kekuatan & panjangnya dinaikkan dari percobaan pertama (0,06 / 90 ms): dengan
 * angka itu bip-nya **tidak terdengar** di pengeras suara ponsel saat ruangan
 * ramai, padahal nada yang dijadwalkan sendiri sudah benar. Yang dibesarkan
 * hanya amplitudo dan lamanya — frekuensi dan bentuk gelombangnya tetap, supaya
 * karakternya masih "bip mesin kasir", bukan alarm.
 *
 * `peakGain` di sini adalah kekuatan pada volume 100 % (= batas sopan di atas).
 * Nada yang benar-benar dibunyikan selalu dikalikan setelan volume
 * (`scanBeepToneAtVolume`), dan bawaan volume (70 %) tepat mengembalikan
 * kekuatan lama 0,18 — jadi pemakai yang tidak menyentuh setelan ini mendengar
 * bunyi yang sama seperti sebelumnya, sementara yang ruangnya lebih ramai punya
 * ruang sampai 0,25.
 */
export const SCAN_BEEP: ScanBeepTone = {
  frequencyHz: 1245,
  durationMs: 110,
  waveform: "triangle",
  peakGain: SCAN_BEEP_MAX_GAIN,
  fadeMs: 6,
};

/**
 * Nada **notifikasi tagihan QR baru** di kartu antrean dapur (layar Dapur &
 * Meja). Sengaja berbeda dari bip kasir: nada satu oktaf lebih tinggi (`1760` vs
 * `1245` Hz — 2× frekuensinya, jadi terdengar sebagai nada yang sama tetapi
 * terdengar “di atas” bip kasir) dan lebih panjang (260 ms vs 110 ms).
 *
 * Kenapa harus bisa dibedakan: di satu ruangan bisa ada dua perangkat — til
 * kasir yang berbunyi tiap produk diklik dan layar dapur yang berbunyi saat
 * tagihan QR masuk. Kalau nadanya sama persis, dapur tidak bisa tahu apakah yang
 * berbunyi itu “produk masuk keranjang” atau “ada tamu yang menunggu dibayar”.
 *
 * Kekuatan puncaknya tetap batas sopan yang sama (`SCAN_BEEP_MAX_GAIN`) dan
 * tetap dikalikan setelan volume perangkat (`scanBeepToneAtVolume`), jadi setelan
 * volume yang sudah diatur kasir juga berlaku untuk nada ini.
 */
export const KDS_ALERT_BEEP: ScanBeepTone = {
  frequencyHz: SCAN_BEEP.frequencyHz * 2,
  durationMs: 260,
  waveform: "triangle",
  peakGain: SCAN_BEEP_MAX_GAIN,
  fadeMs: 8,
};

// -------------------------------------------------------------------- volume

/**
 * Volume bip, dalam persen kekuatan nada: 100 % = `SCAN_BEEP_MAX_GAIN` (paling
 * keras yang masih sopan di depan pelanggan), 10 % = paling pelan.
 *
 * **Tidak ada 0 %.** Volume 0 % menghasilkan hal yang sama persis dengan tombol
 * Matikan — dua setelan yang tidak bisa dibedakan dari layar maupun dari
 * bunyinya hanya membuat bingung, seperti “PPN aktif 0 %” yang ditolak di
 * halaman Pengaturan. Yang ingin senyap memakai tombol **Matikan bunyi**.
 */
export const SCAN_BEEP_VOLUME_MIN = 10;
export const SCAN_BEEP_VOLUME_MAX = 100;
/** Satu tekan tombol − / + mengubah 10 % — 10 tingkat, cukup halus tanpa menggeser terus. */
export const SCAN_BEEP_VOLUME_STEP = 10;
/** Bawaan 70 % × 0,25 = 0,175 ≈ kekuatan nada lama (0,18), jadi bunyinya tidak berubah. */
export const SCAN_BEEP_VOLUME_DEFAULT = 70;

/**
 * Kunci setelan bunyi bip (aktif/mati). **Per perangkat**, sama seperti tema &
 * sesi: tiap kasir punya pengeras suaranya sendiri, jadi setelan workspace justru
 * salah tempat (mematikan bunyi di satu til tidak boleh membisukan til yang lain).
 */
export const SCAN_BEEP_STORAGE_KEY = "mesinpos.bip.v1";

/**
 * Kunci setelan volume, sengaja **terpisah** dari kunci aktif/mati: nilai
 * `"on"`/`"off"` yang sudah tersimpan di perangkat orang tetap berarti persis
 * seperti sebelumnya, tanpa perlu ditafsir ulang. Volume yang belum pernah
 * diatur memakai bawaannya.
 */
export const SCAN_BEEP_VOLUME_STORAGE_KEY = "mesinpos.bip.volume.v1";

/** Pemutar bunyi: bisa pemutar Web Audio sungguhan, bisa pemutar tiruan. */
export interface ScanBeepPlayer {
  /** Mengembalikan `true` kalau nada benar-benar dijadwalkan. */
  play(tone?: ScanBeepTone): boolean;
}

type AudioContextCtor = new () => AudioContext;

/**
 * Konstruktor `AudioContext` yang ada di lingkungan ini, kalau ada.
 *
 * `globalThis` dipakai — bukan `window` — supaya peramban dan lingkungan uji
 * yang memasang tiruannya di global sama-sama terbaca, dan `webkitAudioContext`
 * tetap dilayani untuk Safari lama.
 */
function audioContextCtor(): AudioContextCtor | null {
  const scope = globalThis as {
    AudioContext?: unknown;
    webkitAudioContext?: unknown;
  };
  for (const candidate of [scope.AudioContext, scope.webkitAudioContext]) {
    if (typeof candidate === "function") return candidate as AudioContextCtor;
  }
  return null;
}

/**
 * Pemutar bunyi sungguhan (Web Audio). Konteksnya baru dibuat saat nada pertama
 * diminta: peramban menahan audio sampai ada gestur pengguna, dan klik pada
 * produk itu sendiri gesturnya.
 */
export function createBrowserScanBeepPlayer(): ScanBeepPlayer {
  let context: AudioContext | null = null;
  /** Sekali terbukti tidak ada Web Audio, jangan coba lagi tiap ketukan. */
  let unsupported = false;

  return {
    play(tone: ScanBeepTone = SCAN_BEEP): boolean {
      if (unsupported) return false;

      try {
        if (!context) {
          const Ctor = audioContextCtor();
          if (!Ctor) {
            unsupported = true;
            return false;
          }
          context = new Ctor();
        }

        const audio = context;
        // Konteks yang ditahan peramban: minta lanjut, tapi kegagalannya hanya
        // berarti senyap — bukan alasan membatalkan penambahan ke keranjang.
        if (audio.state === "suspended") {
          const resumed: unknown = audio.resume();
          if (resumed instanceof Promise) resumed.catch(() => {});
        }

        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = tone.waveform;
        oscillator.frequency.value = tone.frequencyHz;

        const startAt = audio.currentTime;
        const fadeSeconds = tone.fadeMs / 1000;
        const stopAt = startAt + tone.durationMs / 1000;
        // Amplop dari nol → puncak → nol. `exponentialRampToValueAtTime` tidak
        // menerima 0, jadi nilai sunyi dipakai (0,0001 ≈ tak terdengar).
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(tone.peakGain, startAt + fadeSeconds);
        gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(startAt);
        oscillator.stop(stopAt);
        // Nada yang sudah selesai melepas simpulnya sendiri: kasir bisa menekan
        // puluhan produk beruntun tanpa menumpuk simpul di konteks yang sama.
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
        return true;
      } catch {
        return false;
      }
    },
  };
}

// --------------------------------------------------------------- setelan bunyi

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Penyimpanan perangkat, kalau ada & bisa diakses (mode privat bisa menolak). */
function deviceStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Baca setelan tersimpan. Hanya `"off"` yang berarti mati: nilai kosong, rusak,
 * atau dari versi lain **dianggap aktif** — bip yang tiba-tiba hilang karena
 * data rusak lebih membingungkan daripada bip yang berbunyi.
 */
export function readScanBeepEnabled(
  storage: StorageLike | null | undefined,
): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(SCAN_BEEP_STORAGE_KEY) !== "off";
  } catch {
    // Penyimpanan diblokir: pakai bawaannya (aktif) untuk sesi ini.
    return true;
  }
}

/** Simpan setelan. Ditulis apa adanya (`"on"`/`"off"`) supaya bisa dibaca manusia. */
export function writeScanBeepEnabled(
  storage: StorageLike | null | undefined,
  enabled: boolean,
): void {
  if (!storage) return;
  try {
    storage.setItem(SCAN_BEEP_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Penyimpanan penuh/diblokir: pilihan tetap berlaku untuk sesi ini.
  }
}

/**
 * Jepit nilai apa pun menjadi volume yang sah: persen bulat pada langkah 10 %,
 * antara 10 % dan 100 %.
 *
 * Nilai yang bukan angka — kosong, rusak, atau sisa versi lain — memakai
 * **bawaan**, sama seperti setelan aktif/mati: data yang rusak tidak boleh
 * membuat bip kasir hilang atau berubah keras dengan sendirinya.
 */
export function clampScanBeepVolume(value: unknown): number {
  const raw =
    typeof value === "string"
      ? Number(value.trim() === "" ? Number.NaN : value.trim())
      : value;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return SCAN_BEEP_VOLUME_DEFAULT;
  }
  const stepped = Math.round(raw / SCAN_BEEP_VOLUME_STEP) * SCAN_BEEP_VOLUME_STEP;
  return Math.min(SCAN_BEEP_VOLUME_MAX, Math.max(SCAN_BEEP_VOLUME_MIN, stepped));
}

/**
 * Volume setelah satu tekan tombol: `-1` menurunkan, `+1` menaikkan. Berhenti di
 * batasnya (bukan memutar balik ke ujung yang lain), karena “paling keras” dan
 * “paling pelan” itu keadaan yang bisa dilihat di layar.
 */
export function stepScanBeepVolume(current: unknown, direction: -1 | 1): number {
  return clampScanBeepVolume(
    clampScanBeepVolume(current) + direction * SCAN_BEEP_VOLUME_STEP,
  );
}

/** Volume sebagai teks untuk layar: `"70 %"`. */
export function scanBeepVolumeLabel(volume: unknown): string {
  return `${clampScanBeepVolume(volume)} %`;
}

/** Kalimat di bawah kontrol volume — menyebut akibatnya, bukan hanya angkanya. */
export function scanBeepVolumeHint(volume: unknown): string {
  const value = clampScanBeepVolume(volume);
  if (value >= SCAN_BEEP_VOLUME_MAX) {
    return "Paling keras yang masih sopan di depan pelanggan — tidak bisa dinaikkan lagi.";
  }
  if (value <= SCAN_BEEP_VOLUME_MIN) {
    return "Paling pelan — nyaris tak terdengar kalau ruangan ramai.";
  }
  return "Bunyi setiap ketukan produk sekeras ini. Yang ingin senyap memakai tombol Matikan bunyi.";
}

/**
 * Nada dengan kekuatan puncak sesuai setelan volume. Dipakai **setiap kali bip
 * dibunyikan**, jadi mengubah volume di Pengaturan dan di kasir selalu
 * menghasilkan bunyi yang sama.
 */
export function scanBeepToneAtVolume(
  tone: ScanBeepTone,
  volume: unknown,
): ScanBeepTone {
  const gain = (tone.peakGain * clampScanBeepVolume(volume)) / 100;
  return { ...tone, peakGain: Math.min(SCAN_BEEP_MAX_GAIN, gain) };
}

/** Baca volume tersimpan (per perangkat). Belum pernah diatur / rusak → bawaan. */
export function readScanBeepVolume(
  storage: StorageLike | null | undefined,
): number {
  if (!storage) return SCAN_BEEP_VOLUME_DEFAULT;
  try {
    return clampScanBeepVolume(storage.getItem(SCAN_BEEP_VOLUME_STORAGE_KEY));
  } catch {
    // Penyimpanan diblokir: pakai bawaannya untuk sesi ini.
    return SCAN_BEEP_VOLUME_DEFAULT;
  }
}

/** Simpan volume. Ditulis sebagai angka apa adanya (`"70"`) supaya bisa dibaca manusia. */
export function writeScanBeepVolume(
  storage: StorageLike | null | undefined,
  volume: unknown,
): void {
  if (!storage) return;
  try {
    storage.setItem(
      SCAN_BEEP_VOLUME_STORAGE_KEY,
      String(clampScanBeepVolume(volume)),
    );
  } catch {
    // Penyimpanan penuh/diblokir: pilihan tetap berlaku untuk sesi ini.
  }
}

/** Setelan bip yang sedang berlaku di perangkat ini. */
export interface ScanBeepSetting {
  /** Apakah bip berbunyi saat produk diklik. */
  enabled: boolean;
  /** Seberapa keras bip berbunyi, dalam persen (10–100). */
  volume: number;
}

/** Setelan yang sedang berlaku; `null` berarti belum dibaca dari perangkat. */
let settingCache: ScanBeepSetting | null = null;
const settingListeners = new Set<() => void>();

/**
 * Setelan bip yang sedang berlaku. Objeknya **stabil** selama tidak ada yang
 * mengubahnya — itu yang membuatnya aman dipakai `useSyncExternalStore`
 * (snapshot baru tiap render akan membuat React merender tanpa henti).
 */
export function scanBeepSetting(): ScanBeepSetting {
  if (settingCache === null) {
    const storage = deviceStorage();
    settingCache = {
      enabled: readScanBeepEnabled(storage),
      volume: readScanBeepVolume(storage),
    };
  }
  return settingCache;
}

/** Apakah bip kasir aktif di perangkat ini? Bawaannya **aktif**. */
export function isScanBeepEnabled(): boolean {
  return scanBeepSetting().enabled;
}

/** Seberapa keras bip berbunyi di perangkat ini (persen). */
export function isScanBeepVolume(): number {
  return scanBeepSetting().volume;
}

/**
 * Simpan setelan baru lalu beri tahu semua pemakainya: tombol di kasir dan
 * kartu di Pengaturan tidak bisa menampilkan keadaan yang berbeda.
 */
function publishScanBeepSetting(next: ScanBeepSetting): void {
  settingCache = next;
  for (const listener of [...settingListeners]) listener();
}

/**
 * Menyalakan/mematikan bip. Disimpan ke perangkat, lalu memberi tahu semua
 * pemakai yang sedang mendengarkan (tombol di kasir & kartu di Pengaturan jadi
 * tidak bisa menampilkan keadaan yang berbeda).
 */
export function setScanBeepEnabled(next: boolean): void {
  const current = scanBeepSetting();
  writeScanBeepEnabled(deviceStorage(), next);
  publishScanBeepSetting({ ...current, enabled: next });
}

/**
 * Mengubah volume bip (langsung tersimpan ke perangkat). Mengembalikan nilai
 * yang benar-benar berlaku — sudah dijepit & dibulatkan ke langkahnya.
 * Mematikan bip **tidak** mengubah volume yang tersimpan.
 */
export function setScanBeepVolume(next: unknown): number {
  const current = scanBeepSetting();
  const volume = clampScanBeepVolume(next);
  writeScanBeepVolume(deviceStorage(), volume);
  publishScanBeepSetting({ ...current, volume });
  return volume;
}

/** Berlangganan perubahan setelan (dipakai hook React). */
export function subscribeScanBeep(listener: () => void): () => void {
  settingListeners.add(listener);
  return () => {
    settingListeners.delete(listener);
  };
}

// ------------------------------------------------------------------- pemutar

let player: ScanBeepPlayer | null = null;

/** Pemutar yang sedang dipakai; dibuat sekali saat nada pertama diminta. */
export function scanBeepPlayer(): ScanBeepPlayer {
  if (!player) player = createBrowserScanBeepPlayer();
  return player;
}

/**
 * Menyuntikkan pemutar bunyi. **Dipakai harness** untuk memasang pemutar tiruan,
 * supaya "apakah kasir membunyikan bip" bisa diperiksa tanpa audio sungguhan;
 * `null` mengembalikan pemutar Web Audio. Aplikasi tidak pernah memanggilnya.
 */
export function setScanBeepPlayer(next: ScanBeepPlayer | null): void {
  player = next;
}

/**
 * Bunyikan bip kasir — **tunduk pada setelan**. Senyap (dan `false`) kalau bipnya
 * sedang dimatikan atau lingkungannya tidak punya Web Audio; pemanggil tidak
 * perlu memeriksa apa pun.
 */
export function playScanBeep(tone: ScanBeepTone = SCAN_BEEP): boolean {
  if (!isScanBeepEnabled()) return false;
  return scanBeepPlayer().play(scanBeepToneAtVolume(tone, isScanBeepVolume()));
}

/**
 * Bunyikan contoh nada **tanpa** melihat setelan. Dipakai tombol **Coba
 * bunyikan** di Pengaturan dan saat bip baru dinyalakan di kasir: orang yang mau
 * menyalakannya harus bisa mendengar dulu bunyi yang akan ia nyalakan.
 */
export function previewScanBeep(tone: ScanBeepTone = SCAN_BEEP): boolean {
  return scanBeepPlayer().play(scanBeepToneAtVolume(tone, isScanBeepVolume()));
}

/**
 * Bunyikan **notifikasi tagihan QR baru** di layar Dapur & Meja.
 *
 * Sama seperti `playScanBeep`: tunduk pada setelan bunyi perangkat yang sama
 * (tombol Matikan bunyi di kasir/Pengaturan mematikannya juga — satu saklar,
 * bukan dua), dan senyap tanpa melempar di lingkungan tanpa Web Audio. Layar
 * dapur memanggil ini satu kali per tagihan baru, bukan tiap render.
 */
export function playKdsAlertBeep(): boolean {
  return playScanBeep(KDS_ALERT_BEEP);
}

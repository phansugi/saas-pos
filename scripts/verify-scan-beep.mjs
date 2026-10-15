/**
 * Uji bunyi bip kasir (`src/lib/scanBeep.ts`).
 *
 * Kenapa ada: yang diminta adalah bunyi "seperti mesin kasir" yang terdengar saat
 * produk diklik di halaman POS, plus setelan yang bisa mematikannya. Bunyi
 * sungguhan tidak bisa didengar di harness, jadi yang diperiksa adalah **nada
 * yang benar-benar dijadwalkan ke Web Audio** — frekuensi, panjang, amplop, dan
 * sambungan simpulnya — lewat tiruan `AudioContext` yang mencatat setiap
 * panggilan. Dengan begitu "ada bip" tidak berhenti jadi klaim: bentuk nadanya,
 * konteks yang dibuat sekali saja, bunyi yang dinaikkan supaya terdengar, dan
 * janji bahwa kegagalan audio tidak pernah menjadi galat di kasir, semuanya
 * punya bukti. Setelan aktif/matinya diuji sebagai fungsi murni dengan
 * penyimpanan tiruan — termasuk penyimpanan yang menolak.
 *
 * Usage: bun scripts/verify-scan-beep.mjs
 */
import {
  KDS_ALERT_BEEP,
  SCAN_BEEP,
  SCAN_BEEP_MAX_GAIN,
  SCAN_BEEP_STORAGE_KEY,
  SCAN_BEEP_VOLUME_DEFAULT,
  SCAN_BEEP_VOLUME_MAX,
  SCAN_BEEP_VOLUME_MIN,
  SCAN_BEEP_VOLUME_STEP,
  SCAN_BEEP_VOLUME_STORAGE_KEY,
  clampScanBeepVolume,
  createBrowserScanBeepPlayer,
  isScanBeepEnabled,
  isScanBeepVolume,
  playKdsAlertBeep,
  playScanBeep,
  previewScanBeep,
  readScanBeepEnabled,
  readScanBeepVolume,
  scanBeepPlayer,
  scanBeepToneAtVolume,
  scanBeepVolumeHint,
  scanBeepVolumeLabel,
  setScanBeepEnabled,
  setScanBeepPlayer,
  setScanBeepVolume,
  stepScanBeepVolume,
  subscribeScanBeep,
  writeScanBeepEnabled,
  writeScanBeepVolume,
} from "../src/lib/scanBeep.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

function near(a, b, eps = 1e-9) {
  return typeof a === "number" && Math.abs(a - b) < eps;
}

/** Parameter AudioParam tiruan: mencatat jadwal nilainya, bukan membunyikannya. */
class FakeParam {
  constructor() {
    this.value = 0;
    this.events = [];
  }
  setValueAtTime(value, time) {
    this.events.push({ kind: "set", value, time });
  }
  exponentialRampToValueAtTime(value, time) {
    this.events.push({ kind: "ramp", value, time });
  }
}

class FakeOscillator {
  constructor() {
    this.type = "";
    this.frequency = new FakeParam();
    this.targets = [];
    this.startedAt = null;
    this.stoppedAt = null;
    this.onended = null;
    this.disconnected = false;
  }
  connect(node) {
    this.targets.push(node);
  }
  disconnect() {
    this.disconnected = true;
  }
  start(time) {
    this.startedAt = time;
  }
  stop(time) {
    this.stoppedAt = time;
  }
}

class FakeGain {
  constructor() {
    this.gain = new FakeParam();
    this.targets = [];
    this.disconnected = false;
  }
  connect(node) {
    this.targets.push(node);
  }
  disconnect() {
    this.disconnected = true;
  }
}

class FakeAudioContext {
  static created = 0;
  static instances = [];
  constructor() {
    FakeAudioContext.created += 1;
    FakeAudioContext.instances.push(this);
    this.currentTime = 10;
    this.state = "running";
    this.destination = { name: "keluaran audio" };
    this.oscillators = [];
    this.gains = [];
    this.resumeCalls = 0;
    this.failOnOscillator = false;
  }
  createOscillator() {
    if (this.failOnOscillator) throw new Error("Web Audio ditolak peramban");
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  resume() {
    this.resumeCalls += 1;
    return Promise.resolve();
  }
}

const globalScope = globalThis;

/** Memasang tiruan `AudioContext` (dan membersihkannya lagi sesudah blok uji). */
function withFakeAudioContext(run) {
  const beforeAudio = globalScope.AudioContext;
  const beforeWebkit = globalScope.webkitAudioContext;
  FakeAudioContext.created = 0;
  FakeAudioContext.instances = [];
  globalScope.AudioContext = FakeAudioContext;
  delete globalScope.webkitAudioContext;
  try {
    return run();
  } finally {
    if (beforeAudio === undefined) delete globalScope.AudioContext;
    else globalScope.AudioContext = beforeAudio;
    if (beforeWebkit === undefined) delete globalScope.webkitAudioContext;
    else globalScope.webkitAudioContext = beforeWebkit;
  }
}

/** Melepas Web Audio dari lingkungan, seperti DOM tiruan / peramban yang memblokirnya. */
function withoutAudioContext(run) {
  const beforeAudio = globalScope.AudioContext;
  const beforeWebkit = globalScope.webkitAudioContext;
  delete globalScope.AudioContext;
  delete globalScope.webkitAudioContext;
  try {
    return run();
  } finally {
    if (beforeAudio !== undefined) globalScope.AudioContext = beforeAudio;
    if (beforeWebkit !== undefined) globalScope.webkitAudioContext = beforeWebkit;
  }
}

// ------------------------------------------------------------ bentuk nada
check(
  "nada bip tinggi tetapi tidak memekakkan (800–4000 Hz)",
  SCAN_BEEP.frequencyHz >= 800 && SCAN_BEEP.frequencyHz <= 4000,
  `${SCAN_BEEP.frequencyHz} Hz`,
);
check(
  "nada bip pendek seperti konfirmasi kasir (40–200 ms)",
  SCAN_BEEP.durationMs >= 40 && SCAN_BEEP.durationMs <= 200,
  `${SCAN_BEEP.durationMs} ms`,
);
check(
  "kekuatan nada kecil supaya tidak mengagetkan pembeli di depan kasir",
  SCAN_BEEP.peakGain > 0 && SCAN_BEEP.peakGain <= SCAN_BEEP_MAX_GAIN,
  `${SCAN_BEEP.peakGain} (maks ${SCAN_BEEP_MAX_GAIN})`,
);
check(
  "amplop naik-turun lebih pendek dari nada, jadi tidak ada \"klik\" di ujungnya",
  SCAN_BEEP.fadeMs > 0 && SCAN_BEEP.fadeMs * 2 < SCAN_BEEP.durationMs,
  `fade=${SCAN_BEEP.fadeMs} durasi=${SCAN_BEEP.durationMs}`,
);
check(
  "gelombang `triangle`: menonjol tetapi tidak nyaring seperti `square`",
  SCAN_BEEP.waveform === "triangle",
  SCAN_BEEP.waveform,
);

// ------------------------------------- lingkungan tanpa Web Audio = senyap
{
  const hasil = withoutAudioContext(() => {
    setScanBeepPlayer(null);
    let melempar = null;
    let nilai = null;
    try {
      nilai = playScanBeep();
    } catch (error) {
      melempar = error;
    }
    return { nilai, melempar };
  });

  check(
    "tanpa Web Audio, bip tidak melempar galat",
    hasil.melempar === null,
    String(hasil.melempar),
  );
  check(
    "tanpa Web Audio, bip hanya senyap (bukan alasan gagal menjual)",
    hasil.nilai === false,
    String(hasil.nilai),
  );
}

// ------------------------------------------ nada yang benar-benar dijadwalkan
{
  setScanBeepEnabled(true);
  const hasil = withFakeAudioContext(() => {
    const player = createBrowserScanBeepPlayer();
    const pertama = player.play();
    const kedua = player.play({ ...SCAN_BEEP, frequencyHz: 880, durationMs: 120 });
    return { player, pertama, kedua, contexts: FakeAudioContext.instances };
  });

  check("bip sungguhan dijadwalkan ke Web Audio", hasil.pertama === true, String(hasil.pertama));
  check(
    "sekali bip membuat satu konteks audio (yang mahal itu)",
    hasil.contexts.length === 1,
    `konteks=${hasil.contexts.length}`,
  );
  check(
    "konteks yang sama dipakai ulang untuk bip berikutnya",
    hasil.contexts.length === 1 && hasil.contexts[0].oscillators.length === 2,
    `osilator=${hasil.contexts[0]?.oscillators.length}`,
  );

  const audio = hasil.contexts[0];
  const osc = audio.oscillators[0];
  const gain = audio.gains[0];
  const t0 = audio.currentTime;

  check(
    "osilator disetel ke frekuensi nada baku",
    osc.frequency.value === SCAN_BEEP.frequencyHz,
    String(osc.frequency.value),
  );
  check(
    "bentuk gelombang osilator ikut resep nada",
    osc.type === SCAN_BEEP.waveform,
    osc.type,
  );
  check(
    "nada berhenti tepat setelah panjangnya, bukan terus berbunyi",
    near(osc.startedAt, t0) && near(osc.stoppedAt, t0 + SCAN_BEEP.durationMs / 1000),
    `start=${osc.startedAt} stop=${osc.stoppedAt}`,
  );
  check(
    "amplop nada naik dari senyap ke puncak lalu turun lagi (bukan nada kotak)",
    gain.gain.events.length === 3 &&
      gain.gain.events[0].kind === "set" &&
      gain.gain.events[0].value < 0.001 &&
      near(gain.gain.events[1].time, t0 + SCAN_BEEP.fadeMs / 1000) &&
      gain.gain.events[1].value === SCAN_BEEP.peakGain &&
      gain.gain.events[2].value < 0.001 &&
      near(gain.gain.events[2].time, t0 + SCAN_BEEP.durationMs / 1000),
    JSON.stringify(gain.gain.events),
  );
  check(
    "osilator → gain → keluaran audio (nada bisa terdengar, bukan simpul menggantung)",
    osc.targets[0] === gain && gain.targets[0] === audio.destination,
    `osc→${osc.targets.length} gain→${gain.targets[0] === audio.destination}`,
  );

  osc.onended?.();
  check(
    "nada yang sudah selesai melepas simpulnya (tidak menumpuk saat kasir menekan cepat)",
    osc.disconnected === true && gain.disconnected === true,
    `osc=${osc.disconnected} gain=${gain.disconnected}`,
  );

  check(
    "nada khusus yang diminta pemanggil dipakai apa adanya",
    audio.oscillators[1].frequency.value === 880 &&
      near(audio.oscillators[1].stoppedAt, t0 + 0.12),
    `freq=${audio.oscillators[1].frequency.value} stop=${audio.oscillators[1].stoppedAt}`,
  );
}

// Saat peramban menahan audio sampai ada gestur, konteksnya berstatus
// `suspended`; bip berikutnya harus meminta lanjut, bukan diam.
{
  const hasil = withFakeAudioContext(() => {
    const player = createBrowserScanBeepPlayer();
    const original = globalScope.AudioContext;
    class SuspendedContext extends original {
      constructor() {
        super();
        this.state = "suspended";
      }
    }
    globalScope.AudioContext = SuspendedContext;
    const nilai = player.play();
    globalScope.AudioContext = original;
    return { nilai, audio: FakeAudioContext.instances[0] };
  });

  check(
    "konteks yang ditahan peramban dilanjutkan (`resume`) saat produk diklik",
    hasil.audio?.resumeCalls === 1 && hasil.nilai === true,
    `resume=${hasil.audio?.resumeCalls} nilai=${hasil.nilai}`,
  );
}

// --------------------------------- kegagalan Web Audio tidak menjatuhkan POS
{
  const hasil = withFakeAudioContext(() => {
    const player = createBrowserScanBeepPlayer();
    player.play();
    FakeAudioContext.instances[0].failOnOscillator = true;
    let nilai = null;
    let melempar = null;
    try {
      nilai = player.play();
    } catch (error) {
      melempar = error;
    }
    return { nilai, melempar };
  });

  check(
    "Web Audio yang menolak hanya membuat senyap, bukan galat",
    hasil.melempar === null && hasil.nilai === false,
    `melempar=${hasil.melempar} nilai=${hasil.nilai}`,
  );
}

// ------------------------------------------- pemutar yang dipakai aplikasi
{
  setScanBeepEnabled(true);
  const panggilan = [];
  setScanBeepPlayer({
    play(tone) {
      panggilan.push(tone?.frequencyHz ?? null);
      return true;
    },
  });
  check(
    "pemutar yang disuntikkan harness benar-benar dipakai (tanpa audio sungguhan)",
    playScanBeep() === true && playScanBeep(SCAN_BEEP) === true,
    JSON.stringify(panggilan),
  );
  check(
    "nada baku diteruskan ke pemutar (frekuensi & durasinya sama)",
    panggilan[0] === SCAN_BEEP.frequencyHz && panggilan[1] === SCAN_BEEP.frequencyHz,
    JSON.stringify(panggilan),
  );

  const kembali = withoutAudioContext(() => {
    setScanBeepPlayer(null);
    return { pemutar: scanBeepPlayer(), hasil: playScanBeep() };
  });
  check(
    "mengembalikan pemutar ke bawaan lagi (harness tidak membekukan bunyi aplikasi)",
    typeof kembali.pemutar?.play === "function" && kembali.hasil === false,
    `hasil=${kembali.hasil}`,
  );
}

/** Penyimpanan tiruan: satu nilai, bisa juga sengaja menolak (mode privat). */
const penyimpanan = (isi = null, { tolak = false } = {}) => {
  let nilai = isi;
  return {
    getItem() {
      if (tolak) throw new Error("penyimpanan ditolak");
      return nilai;
    },
    setItem(_key, next) {
      if (tolak) throw new Error("penyimpanan ditolak");
      nilai = next;
    },
    get nilai() {
      return nilai;
    },
  };
};

// ------------------------------------------------- setelan aktif/mati bipnya
//
// Setelannya **per perangkat** (penyimpanan lokal), jadi aturannya diuji sebagai
// fungsi murni dengan penyimpanan tiruan — termasuk penyimpanan yang rusak atau
// menolak — bukan lewat peramban.
{
  check(
    "setelannya hidup per perangkat, seperti tema & sesi",
    SCAN_BEEP_STORAGE_KEY === "mesinpos.bip.v1",
    SCAN_BEEP_STORAGE_KEY,
  );
  check(
    "bip aktif dari awal — perilaku sebelum setelan ini ada tidak berubah",
    readScanBeepEnabled(penyimpanan(null)) === true &&
      readScanBeepEnabled(penyimpanan("on")) === true &&
      readScanBeepEnabled(null) === true,
    "bawaan",
  );
  check(
    "hanya nilai “off” yang berarti mati (nilai rusak/asing kembali ke bawaan)",
    readScanBeepEnabled(penyimpanan("off")) === false &&
      readScanBeepEnabled(penyimpanan("0")) === true &&
      readScanBeepEnabled(penyimpanan("false")) === true &&
      readScanBeepEnabled(penyimpanan("")) === true,
    "nilai",
  );
  check(
    "penyimpanan yang menolak hanya berarti bawaannya dipakai, bukan galat",
    readScanBeepEnabled(penyimpanan(null, { tolak: true })) === true,
    "menolak",
  );

  const catatan = penyimpanan(null);
  writeScanBeepEnabled(catatan, false);
  check(
    "mematikan bip ditulis apa adanya sebagai \"off\"",
    catatan.nilai === "off",
    String(catatan.nilai),
  );
  writeScanBeepEnabled(catatan, true);
  check("menyalakan bip ditulis sebagai \"on\"", catatan.nilai === "on", String(catatan.nilai));

  let ditolak = null;
  try {
    writeScanBeepEnabled(penyimpanan(null, { tolak: true }), false);
  } catch (error) {
    ditolak = error;
  }
  check(
    "penyimpanan yang menolak tulisan tidak melempar ke kasir",
    ditolak === null,
    String(ditolak),
  );

  // Pemutar tiruan yang menghitung panggilan: inilah yang membedakan “bipnya
  // dimatikan” dari “bip dibunyikan tapi tidak terdengar”. Yang pertama **tidak
  // boleh** sampai ke pemutarnya sama sekali.
  const dipanggil = [];
  setScanBeepPlayer({
    play(tone) {
      dipanggil.push(tone?.frequencyHz ?? null);
      return true;
    },
  });

  const pemberitahuan = [];
  const berhenti = subscribeScanBeep(() => pemberitahuan.push(isScanBeepEnabled()));

  setScanBeepEnabled(false);
  check(
    "mematikan bip membuat pemakainya ikut tahu (tombol tidak bisa basi)",
    isScanBeepEnabled() === false && pemberitahuan.at(-1) === false,
    JSON.stringify(pemberitahuan),
  );
  const saatMati = playScanBeep();
  check(
    "bip yang dimatikan tidak sampai ke pemutar sama sekali",
    saatMati === false && dipanggil.length === 0,
    `hasil=${saatMati} dipanggil=${dipanggil.length}`,
  );
  const saatCoba = previewScanBeep();
  check(
    "tombol “Coba bunyikan” tetap berbunyi walau bipnya sedang mati",
    saatCoba === true && dipanggil.length === 1,
    `hasil=${saatCoba} dipanggil=${dipanggil.length}`,
  );

  setScanBeepEnabled(true);
  const saatHidup = playScanBeep();
  check(
    "menyalakan lagi membuat ketukan produk berbunyi seperti semula",
    saatHidup === true && dipanggil.length === 2 && pemberitahuan.at(-1) === true,
    `hasil=${saatHidup} dipanggil=${dipanggil.length}`,
  );

  berhenti();
  const sebelumBerhenti = pemberitahuan.length;
  setScanBeepEnabled(false);
  setScanBeepEnabled(true);
  check(
    "pendengar yang sudah berhenti tidak lagi dipanggil",
    pemberitahuan.length === sebelumBerhenti,
    `${sebelumBerhenti} → ${pemberitahuan.length}`,
  );

  // Dikembalikan ke bawaan supaya keadaan akhir modul tetap “aktif”.
  setScanBeepPlayer(null);
  setScanBeepEnabled(true);
}

// ------------------------------------------------------------ volume bipnya
//
// Volume itu **seberapa keras** bip berbunyi (10–100 %), diatur per 10 % lewat
// tombol − / + di halaman kasir & kartu Pengaturan. Yang diperiksa di sini:
// skalanya, penjepitan nilai, kunci penyimpanannya sendiri, dan bukti bahwa nada
// yang benar-benar dijadwalkan memakai kekuatan sesuai setelan itu.
{
  check(
    "skala volume 10–100 % dengan langkah 10 % dan bawaan 70 %",
    SCAN_BEEP_VOLUME_MIN === 10 &&
      SCAN_BEEP_VOLUME_MAX === 100 &&
      SCAN_BEEP_VOLUME_STEP === 10 &&
      SCAN_BEEP_VOLUME_DEFAULT === 70,
    `${SCAN_BEEP_VOLUME_MIN}–${SCAN_BEEP_VOLUME_MAX} langkah ${SCAN_BEEP_VOLUME_STEP} bawaan ${SCAN_BEEP_VOLUME_DEFAULT}`,
  );
  check(
    "tidak ada volume 0 % — yang ingin senyap memakai tombol Matikan bunyi",
    SCAN_BEEP_VOLUME_MIN > 0,
    String(SCAN_BEEP_VOLUME_MIN),
  );
  check(
    "kunci volume terpisah dari kunci aktif/mati, jadi data lama tetap berarti sama",
    SCAN_BEEP_VOLUME_STORAGE_KEY === "mesinpos.bip.volume.v1" &&
      SCAN_BEEP_VOLUME_STORAGE_KEY !== SCAN_BEEP_STORAGE_KEY,
    SCAN_BEEP_VOLUME_STORAGE_KEY,
  );
  check(
    "kekuatan nada baku kini adalah titik 100 % (batas sopan tetap dipakai)",
    SCAN_BEEP.peakGain === SCAN_BEEP_MAX_GAIN,
    `${SCAN_BEEP.peakGain} / maks ${SCAN_BEEP_MAX_GAIN}`,
  );

  // Pembanding penting: volume bawaan harus mengembalikan kekuatan nada yang
  // sudah dipakai sebelum setelan ini ada (0,18) — pemakai yang tidak menyentuh
  // volumenya tidak boleh mendengar bunyi yang berbeda.
  const bawaan = scanBeepToneAtVolume(SCAN_BEEP, SCAN_BEEP_VOLUME_DEFAULT);
  check(
    "volume bawaan mengembalikan kekuatan lama (0,18): bunyi tidak berubah",
    Math.abs(bawaan.peakGain - 0.18) < 0.01 && bawaan.peakGain < SCAN_BEEP.peakGain,
    `bawaan=${bawaan.peakGain} nada=${SCAN_BEEP.peakGain}`,
  );
  check(
    "volume 100 % = paling keras yang masih sopan, tidak pernah melewatinya",
    scanBeepToneAtVolume(SCAN_BEEP, SCAN_BEEP_VOLUME_MAX).peakGain === SCAN_BEEP_MAX_GAIN &&
      scanBeepToneAtVolume(SCAN_BEEP, 963).peakGain <= SCAN_BEEP_MAX_GAIN,
    `${scanBeepToneAtVolume(SCAN_BEEP, SCAN_BEEP_VOLUME_MAX).peakGain}`,
  );
  check(
    "volume hanya mengubah kekuatannya, frekuensi & panjangnya tetap",
    bawaan.frequencyHz === SCAN_BEEP.frequencyHz &&
      bawaan.durationMs === SCAN_BEEP.durationMs &&
      bawaan.waveform === SCAN_BEEP.waveform,
    `${bawaan.frequencyHz} Hz / ${bawaan.durationMs} ms`,
  );

  check(
    "nilai janggal dijepit & dibulatkan ke langkah terdekat",
    clampScanBeepVolume(63) === 60 &&
      clampScanBeepVolume(65) === 70 &&
      clampScanBeepVolume(-40) === SCAN_BEEP_VOLUME_MIN &&
      clampScanBeepVolume(250) === SCAN_BEEP_VOLUME_MAX &&
      clampScanBeepVolume("80") === 80,
    [63, 65, -40, 250, "80"].map((nilai) => clampScanBeepVolume(nilai)).join(","),
  );
  check(
    "nilai rusak/kosong kembali ke bawaan, bukan ke volume terkecil",
    clampScanBeepVolume(null) === SCAN_BEEP_VOLUME_DEFAULT &&
      clampScanBeepVolume("") === SCAN_BEEP_VOLUME_DEFAULT &&
      clampScanBeepVolume("off") === SCAN_BEEP_VOLUME_DEFAULT &&
      clampScanBeepVolume(Number.NaN) === SCAN_BEEP_VOLUME_DEFAULT &&
      clampScanBeepVolume(Number.POSITIVE_INFINITY) === SCAN_BEEP_VOLUME_DEFAULT,
    "rusak",
  );
  check(
    "satu tekan naik/turun bergerak satu langkah, berhenti di batasnya",
    stepScanBeepVolume(70, 1) === 80 &&
      stepScanBeepVolume(70, -1) === 60 &&
      stepScanBeepVolume(SCAN_BEEP_VOLUME_MAX, 1) === SCAN_BEEP_VOLUME_MAX &&
      stepScanBeepVolume(SCAN_BEEP_VOLUME_MIN, -1) === SCAN_BEEP_VOLUME_MIN,
    `${stepScanBeepVolume(70, 1)} / ${stepScanBeepVolume(70, -1)}`,
  );
  check(
    "label & kalimatnya menyebut angka yang benar-benar berlaku",
    scanBeepVolumeLabel(70) === "70 %" &&
      scanBeepVolumeLabel(963) === "100 %" &&
      scanBeepVolumeHint(SCAN_BEEP_VOLUME_MAX).includes("Paling keras") &&
      scanBeepVolumeHint(SCAN_BEEP_VOLUME_MIN).includes("Paling pelan") &&
      scanBeepVolumeHint(SCAN_BEEP_VOLUME_DEFAULT).includes("Matikan"),
    scanBeepVolumeLabel(70),
  );

  const catatanVolume = penyimpanan(null);
  writeScanBeepVolume(catatanVolume, 40);
  check(
    "volume tersimpan sebagai angka apa adanya di perangkat",
    catatanVolume.nilai === "40",
    String(catatanVolume.nilai),
  );
  check(
    "volume tersimpan dibaca kembali (dibulatkan ke langkah & dijepit)",
    readScanBeepVolume(penyimpanan("40")) === 40 &&
      readScanBeepVolume(penyimpanan("41")) === 40 &&
      readScanBeepVolume(penyimpanan(null)) === SCAN_BEEP_VOLUME_DEFAULT &&
      readScanBeepVolume(penyimpanan(null, { tolak: true })) === SCAN_BEEP_VOLUME_DEFAULT &&
      readScanBeepVolume(null) === SCAN_BEEP_VOLUME_DEFAULT,
    "baca",
  );
  let tolakTulisVolume = null;
  try {
    writeScanBeepVolume(penyimpanan(null, { tolak: true }), 90);
  } catch (error) {
    tolakTulisVolume = error;
  }
  check(
    "penyimpanan yang menolak tulisan volume tidak melempar ke kasir",
    tolakTulisVolume === null,
    String(tolakTulisVolume),
  );

  // Bagian yang paling menentukan: nada yang benar-benar dijadwalkan harus
  // memakai kekuatan sesuai setelan — bukan kekuatan penuh.
  const nadaVolume = [];
  setScanBeepPlayer({
    play(tone) {
      nadaVolume.push(tone ?? null);
      return true;
    },
  });

  const pemberitahuanVolume = [];
  const berhentiVolume = subscribeScanBeep(() =>
    pemberitahuanVolume.push(`${isScanBeepEnabled() ? "on" : "off"}:${isScanBeepVolume()}`),
  );

  setScanBeepVolume(40);
  check(
    "mengubah volume memberi tahu pemakainya (kasir & Pengaturan tidak bisa basi)",
    isScanBeepVolume() === 40 && pemberitahuanVolume.at(-1) === "on:40",
    JSON.stringify(pemberitahuanVolume),
  );
  check(
    "ketukan produk memakai volume tersimpan, bukan kekuatan penuh",
    playScanBeep() === true && Math.abs(nadaVolume.at(-1).peakGain - 0.1) < 1e-9,
    `peak=${nadaVolume.at(-1)?.peakGain}`,
  );
  check(
    "frekuensi & panjang nada tidak ikut berubah oleh volume",
    nadaVolume.at(-1).frequencyHz === SCAN_BEEP.frequencyHz &&
      nadaVolume.at(-1).durationMs === SCAN_BEEP.durationMs,
    `${nadaVolume.at(-1)?.frequencyHz} Hz`,
  );
  previewScanBeep();
  check(
    "tombol “Coba bunyikan” memakai volume yang sedang berlaku",
    nadaVolume.length === 2 && Math.abs(nadaVolume.at(-1).peakGain - 0.1) < 1e-9,
    `peak=${nadaVolume.at(-1)?.peakGain}`,
  );
  setScanBeepVolume(SCAN_BEEP_VOLUME_MAX + 40);
  playScanBeep();
  check(
    "volume yang dipaksa melebihi 100 % tetap dijepit ke batas sopan",
    Math.abs(nadaVolume.at(-1).peakGain - SCAN_BEEP_MAX_GAIN) < 1e-9,
    `peak=${nadaVolume.at(-1)?.peakGain}`,
  );

  setScanBeepEnabled(false);
  const sebelumDiam = nadaVolume.length;
  playScanBeep();
  check(
    "mematikan bip tidak mengubah volume tersimpan",
    nadaVolume.length === sebelumDiam && isScanBeepVolume() === SCAN_BEEP_VOLUME_MAX,
    `nada=${nadaVolume.length} volume=${isScanBeepVolume()}`,
  );

  berhentiVolume();
  setScanBeepPlayer(null);
  setScanBeepEnabled(true);
  setScanBeepVolume(SCAN_BEEP_VOLUME_DEFAULT);
  check(
    "setelan dikembalikan ke bawaan setelah diuji (harness tidak membekukan bunyi aplikasi)",
    isScanBeepEnabled() === true && isScanBeepVolume() === SCAN_BEEP_VOLUME_DEFAULT,
    `enabled=${isScanBeepEnabled()} volume=${isScanBeepVolume()}`,
  );
}

// -------- notifikasi tagihan QR baru di kartu antrean dapur
//
// Layar dapur berbunyi saat tagihan QR baru menunggu pelunasan. Yang dijaga:
// nadanya **berbeda** dari bip kasir (satu ruangan bisa punya dua perangkat yang
// berbunyi), saklarnya satu (`playScanBeep` → setelan perangkat yang sama), dan
// volumenya ikut setelan itu.
{
  setScanBeepPlayer(null);
  setScanBeepEnabled(true);
  setScanBeepVolume(SCAN_BEEP_VOLUME_MAX);

  check(
    "nada notifikasi dapur berbeda dari bip kasir (satu oktaf lebih tinggi & lebih panjang)",
    KDS_ALERT_BEEP.frequencyHz === SCAN_BEEP.frequencyHz * 2 &&
      KDS_ALERT_BEEP.frequencyHz !== SCAN_BEEP.frequencyHz &&
      KDS_ALERT_BEEP.durationMs > SCAN_BEEP.durationMs,
    `${KDS_ALERT_BEEP.frequencyHz} Hz / ${KDS_ALERT_BEEP.durationMs} ms vs ${SCAN_BEEP.frequencyHz} Hz / ${SCAN_BEEP.durationMs} ms`,
  );
  check(
    "kekuatan nada notifikasi dapur tetap di batas sopan yang sama",
    KDS_ALERT_BEEP.peakGain === SCAN_BEEP_MAX_GAIN &&
      KDS_ALERT_BEEP.waveform === SCAN_BEEP.waveform,
    `peak=${KDS_ALERT_BEEP.peakGain}`,
  );

  const nadaDapur = [];
  setScanBeepPlayer({
    play(tone) {
      nadaDapur.push(tone ?? null);
      return true;
    },
  });

  check(
    "tagihan QR baru membunyikan nada notifikasi dapur, bukan nada kasir",
    playKdsAlertBeep() === true &&
      nadaDapur.length === 1 &&
      nadaDapur[0].frequencyHz === KDS_ALERT_BEEP.frequencyHz &&
      nadaDapur[0].durationMs === KDS_ALERT_BEEP.durationMs,
    JSON.stringify(nadaDapur),
  );
  setScanBeepVolume(SCAN_BEEP_VOLUME_DEFAULT);
  playKdsAlertBeep();
  check(
    "kerasnya mengikuti setelan volume perangkat yang sama dengan kasir",
    Math.abs(nadaDapur.at(-1).peakGain - (SCAN_BEEP_MAX_GAIN * SCAN_BEEP_VOLUME_DEFAULT) / 100) <
      1e-9,
    `peak=${nadaDapur.at(-1)?.peakGain}`,
  );

  setScanBeepEnabled(false);
  const sebelumSenyap = nadaDapur.length;
  playKdsAlertBeep();
  check(
    "Matikan bunyi juga membisukan notifikasi dapur — bukan hanya bip kasir",
    playKdsAlertBeep() === false && nadaDapur.length === sebelumSenyap,
    `nada=${nadaDapur.length}`,
  );
  check(
    "nada notifikasi dapur tetap bisa didengar lewat tombol coba walau bipnya mati",
    previewScanBeep(KDS_ALERT_BEEP) === true && nadaDapur.length === sebelumSenyap + 1,
    `nada=${nadaDapur.length}`,
  );

  setScanBeepPlayer(null);
  setScanBeepEnabled(true);
  setScanBeepVolume(SCAN_BEEP_VOLUME_DEFAULT);
  check(
    "setelan bunyi tetap utuh setelah menguji notifikasi dapur",
    isScanBeepEnabled() === true && isScanBeepVolume() === SCAN_BEEP_VOLUME_DEFAULT,
    `enabled=${isScanBeepEnabled()} volume=${isScanBeepVolume()}`,
  );
}

console.log(`${results.length}/${results.length} checks passed`);

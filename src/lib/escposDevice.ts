/**
 * Sambungan ke **printer struk** dari peramban: WebUSB (kabel) dan Web Bluetooth
 * (printer portabel). Di sinilah satu-satunya bagian aplikasi yang menyentuh
 * perangkat keras — aturan byte-nya sendiri ada di `@/lib/escpos`.
 *
 * Empat keputusan yang sengaja diambil:
 *
 * 1. **Tanpa perangkat lunak perantara.** Dua API peramban ini yang membuat
 *    halaman kasir bisa bicara langsung ke printer. Konsekuensinya nyata dan
 *    dikatakan apa adanya di layar: hanya Chrome/Edge (desktop untuk USB &
 *    Bluetooth, Android untuk Bluetooth), halaman harus HTTPS, dan di Windows
 *    printer USB perlu driver **WinUSB** — kalau driver pabriknya masih memegang
 *    interface-nya, perangkatnya tidak akan muncul di pemilih peramban.
 * 2. **Endpoint & karakteristiknya dicari, bukan ditebak.** Nomor konfigurasi,
 *    interface, dan endpoint berbeda per model, jadi yang dipakai adalah endpoint
 *    **out** pertama yang benar-benar ada di descriptor perangkat (bulk lebih
 *    dulu daripada interrupt, interface kelas printer lebih dulu daripada vendor);
 *    untuk Bluetooth, karakteristik tulis pertama dari profil yang dikenal.
 * 3. **Tidak ada dialog saat mencetak ulang.** Peramban mengingat izin per
 *    perangkat (`getDevices()`), jadi struk berikutnya bisa dicetak tanpa memilih
 *    printer lagi; yang perlu ketukan kasir hanya penyambungan pertama.
 * 4. **Galat peramban diterjemahkan.** `DOMException` mentah tidak berarti apa pun
 *    di depan antrean; `escposErrorMessage` mengubahnya jadi kalimat yang bisa
 *    ditindaklanjuti. Kegagalan menulis juga **tidak** diam-diam jatuh ke dialog
 *    cetak peramban — struk bisa keluar dua kali kalau begitu, dan kertas struk
 *    tidak bisa ditarik kembali.
 */

import {
  ESC_POS_BLE_OPTIONAL_SERVICES,
  ESC_POS_BLE_PROFILES,
  ESC_POS_USB_FILTERS,
  ESC_POS_BLE_CHUNK_DELAY_MS,
  escposCapability,
  escposChunkBytes,
  escposChunks,
  escposLogoDots,
  escposPackBitmap,
  escposReceiptBytes,
  escposReceiptSteps,
  escposSupport,
  escposTransportOf,
  type EscposBitmap,
  type EscposSupport,
  type EscposTransport,
} from "@/lib/escpos";
import type { ReceiptDocument } from "@/lib/struk";

/** Preferensi jalur cetak di perangkat kasir ini (bukan setelan workspace). */
export const ESCPOS_TRANSPORT_STORAGE_KEY = "mesinpos.escpos.transport.v1";

/* ------------------------------------------------------- jenis API peramban -- */

/*
  Peramban belum menstandarkan tipe WebUSB/Web Bluetooth di pustaka tipe
  TypeScript, jadi bentuk yang benar-benar dipakai aplikasi ini ditulis di sini —
  secukupnya, supaya kesalahan pemakaian API tetap tertangkap pemeriksaan tipe.
*/

interface UsbEndpoint {
  endpointNumber: number;
  direction: string;
  type: string;
  packetSize?: number;
}

interface UsbAlternate {
  alternateSetting: number;
  interfaceClass: number;
  interfaceSubclass: number;
  interfaceProtocol: number;
  endpoints: UsbEndpoint[];
}

interface UsbInterface {
  interfaceNumber: number;
  claimed?: boolean;
  alternate: UsbAlternate;
  alternates: UsbAlternate[];
}

interface UsbConfiguration {
  configurationValue: number;
  interfaces: UsbInterface[];
}

interface UsbDevice {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  serialNumber?: string;
  configuration: UsbConfiguration | null;
  configurations: UsbConfiguration[];
  opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  transferOut(
    endpointNumber: number,
    data: Uint8Array,
  ): Promise<{ status: string; bytesWritten?: number }>;
}

interface UsbApi {
  requestDevice(options: { filters: { classCode: number }[] }): Promise<UsbDevice>;
  getDevices(): Promise<UsbDevice[]>;
}

interface BluetoothCharacteristic {
  uuid: string;
  properties?: { write?: boolean; writeWithoutResponse?: boolean };
  /*
    Parameter tulisannya `Uint8Array` (bukan `BufferSource`) karena itulah yang
    benar-benar dikirim aplikasi ini: potongan byte struk. `BufferSource` juga
    menerima `SharedArrayBuffer`, dan itu membuat tipe potongan `Uint8Array` biasa
    ditolak pemeriksaan tipe tanpa ada gunanya di sini.
  */
  writeValueWithResponse?(data: Uint8Array): Promise<void>;
  writeValueWithoutResponse?(data: Uint8Array): Promise<void>;
}

interface BluetoothService {
  uuid: string;
  getCharacteristics(): Promise<BluetoothCharacteristic[]>;
  getCharacteristic(uuid: string): Promise<BluetoothCharacteristic>;
}

interface BluetoothServer {
  connected: boolean;
  connect(): Promise<BluetoothServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BluetoothService>;
  getPrimaryServices(): Promise<BluetoothService[]>;
}

interface BluetoothDevice {
  id: string;
  name?: string;
  gatt?: BluetoothServer;
}

interface BluetoothApi {
  requestDevice(options: {
    acceptAllDevices: boolean;
    optionalServices: string[];
  }): Promise<BluetoothDevice>;
}

function usbApi(): UsbApi | null {
  if (typeof navigator === "undefined") return null;
  const usb = (navigator as unknown as { usb?: UsbApi }).usb;
  return usb && typeof usb.requestDevice === "function" ? usb : null;
}

function bluetoothApi(): BluetoothApi | null {
  if (typeof navigator === "undefined") return null;
  const bluetooth = (navigator as unknown as { bluetooth?: BluetoothApi }).bluetooth;
  return bluetooth && typeof bluetooth.requestDevice === "function" ? bluetooth : null;
}

/** Apakah peramban yang sedang dipakai punya jalur cetak langsung? */
export function escposBrowserSupport(): EscposSupport {
  return escposSupport(usbApi() !== null, bluetoothApi() !== null);
}

/* --------------------------------------------------------- preferensi lokal -- */

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Penyimpanan diblokir (mode privat/kebijakan): bukan alasan untuk gagal.
    return null;
  }
}

/** Jalur cetak yang dipilih kasir di perangkat ini; bawaannya USB. */
export function escposPreferredTransport(): EscposTransport {
  return escposTransportOf(storage()?.getItem(ESCPOS_TRANSPORT_STORAGE_KEY) ?? "usb");
}

export function setEscposPreferredTransport(transport: EscposTransport): void {
  try {
    storage()?.setItem(ESCPOS_TRANSPORT_STORAGE_KEY, escposTransportOf(transport));
  } catch {
    // Gagal menyimpan preferensi bukan kegagalan mencetak.
  }
}

/* --------------------------------------------------------------- sambungan -- */

export interface EscposConnection {
  transport: EscposTransport;
  /** Nama yang ditampilkan di layar (nama produk dari peramban, atau "Printer USB"). */
  name: string;
  /** Keterangan teknis singkat: endpoint atau profil yang benar-benar dipakai. */
  detail: string;
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

function usbDeviceName(device: UsbDevice): string {
  const nama = [device.manufacturerName, device.productName].filter(Boolean).join(" ").trim();
  if (nama) return nama;
  const hex = (value: number) => value.toString(16).padStart(4, "0");
  return `Printer USB ${hex(device.vendorId)}:${hex(device.productId)}`;
}

interface UsbTarget {
  interfaceNumber: number;
  alternateSetting: number;
  endpointNumber: number;
  label: string;
}

/**
 * Mencari endpoint tulis yang benar-benar ada di descriptor perangkat.
 *
 * Urutan pilihannya: interface kelas printer (0x07) lebih dulu daripada interface
 * vendor-specific, dan endpoint bulk lebih dulu daripada interrupt — printer
 * struk mengirim data dalam jumlah besar, jadi bulk-lah yang dipakai model yang
 * menyediakannya. Kalau endpoint-nya hanya ada di *alternate* yang belum aktif,
 * alternate itu yang dipilih lebih dulu: tanpa itu, yang menerima data bukan
 * descriptor yang sedang dilihat.
 */
function findUsbTarget(device: UsbDevice): UsbTarget | null {
  const configuration = device.configuration ?? device.configurations?.[0];
  if (!configuration) return null;

  const kandidat: (UsbTarget & { prioritas: number })[] = [];
  configuration.interfaces.forEach((iface) => {
    const daftar = iface.alternates?.length ? iface.alternates : [iface.alternate];
    daftar.forEach((alternate) => {
      (alternate?.endpoints ?? [])
        .filter((endpoint) => endpoint.direction === "out")
        .forEach((endpoint) => {
          const kelasPrinter =
            alternate.interfaceClass === 0x07 || alternate.interfaceClass === 0xff;
          kandidat.push({
            interfaceNumber: iface.interfaceNumber,
            alternateSetting: alternate.alternateSetting,
            endpointNumber: endpoint.endpointNumber,
            label:
              `interface ${iface.interfaceNumber} alt ${alternate.alternateSetting}, ` +
              `endpoint ${endpoint.endpointNumber} (${endpoint.type}, ${endpoint.packetSize ?? "?"} byte)`,
            prioritas: (kelasPrinter ? 0 : 2) + (endpoint.type === "bulk" ? 0 : 1),
          });
        });
    });
  });

  if (kandidat.length === 0) return null;
  const { prioritas: _prioritas, ...terpilih } = kandidat.sort(
    (a, b) => a.prioritas - b.prioritas,
  )[0];
  return terpilih;
}

async function openUsb(device: UsbDevice): Promise<EscposConnection> {
  await device.open();
  if (!device.configuration) {
    const configuration = device.configurations?.[0];
    if (!configuration) {
      throw new DOMException("Printer USB tanpa konfigurasi", "NotSupportedError");
    }
    await device.selectConfiguration(configuration.configurationValue);
  }

  const target = findUsbTarget(device);
  if (!target) {
    throw new DOMException("Printer USB tanpa endpoint tulis", "NotSupportedError");
  }
  const iface = device.configuration?.interfaces?.[target.interfaceNumber];
  if (!iface?.claimed) {
    await device.selectAlternateInterface(target.interfaceNumber, target.alternateSetting);
    await device.claimInterface(target.interfaceNumber);
  }

  return {
    transport: "usb",
    name: usbDeviceName(device),
    detail: target.label,
    async write(bytes) {
      for (const chunk of escposChunks(bytes, escposChunkBytes("usb"))) {
        const hasil = await device.transferOut(target.endpointNumber, chunk);
        if (hasil.status !== "ok" || (hasil.bytesWritten ?? chunk.length) !== chunk.length) {
          throw new DOMException(`Transfer USB: ${hasil.status}`, "NetworkError");
        }
      }
    },
    async close() {
      try {
        if (device.configuration?.interfaces?.[target.interfaceNumber]?.claimed) {
          await device.releaseInterface(target.interfaceNumber);
        }
      } finally {
        if (device.opened) await device.close();
      }
    },
  };
}

interface TulisTarget {
  characteristic: BluetoothCharacteristic;
  label: string;
}

/**
 * Karakteristik tulis untuk BLE: profil yang dikenal dicoba berurutan, lalu
 * (kalau tidak ada yang cocok) karakteristik tulis pertama dari layanan lain yang
 * sudah diizinkan. Urutannya penting — beberapa printer mengiklankan beberapa
 * layanan sekaligus, dan hanya satu yang benar-benar menerima cetakan.
 */
async function findWritableCharacteristic(server: BluetoothServer): Promise<TulisTarget> {
  for (const profil of ESC_POS_BLE_PROFILES) {
    try {
      const service = await server.getPrimaryService(profil.service);
      const characteristic = await service.getCharacteristic(profil.characteristic);
      if (characteristic.properties?.write || characteristic.properties?.writeWithoutResponse) {
        return { characteristic, label: `${profil.label} (${profil.characteristic})` };
      }
    } catch {
      // Layanan itu tidak ada di perangkat ini: lanjut ke profil berikutnya.
    }
  }

  try {
    const services = await server.getPrimaryServices();
    for (const service of services) {
      const characteristics = await service.getCharacteristics();
      for (const characteristic of characteristics) {
        if (characteristic.properties?.write || characteristic.properties?.writeWithoutResponse) {
          return { characteristic, label: `layanan ${service.uuid} (${characteristic.uuid})` };
        }
      }
    }
  } catch {
    // Layanan di luar yang diizinkan tidak bisa dibaca: jatuh ke galat di bawah.
  }

  throw new DOMException("Tidak ada karakteristik tulis", "NotSupportedError");
}

async function openBluetooth(device: BluetoothDevice): Promise<EscposConnection> {
  const server = device.gatt;
  if (!server) {
    throw new DOMException("Printer Bluetooth tanpa layanan GATT", "NotSupportedError");
  }
  await server.connect();
  const target = await findWritableCharacteristic(server);

  return {
    transport: "bluetooth",
    name: device.name || device.id || "Printer Bluetooth",
    detail: target.label,
    async write(bytes) {
      const potongan = escposChunks(bytes, escposChunkBytes("bluetooth"));
      for (let index = 0; index < potongan.length; index += 1) {
        const chunk = potongan[index];
        if (target.characteristic.writeValueWithoutResponse) {
          await target.characteristic.writeValueWithoutResponse(chunk);
        } else if (target.characteristic.writeValueWithResponse) {
          await target.characteristic.writeValueWithResponse(chunk);
        } else {
          throw new DOMException("Printer Bluetooth hanya bisa dibaca", "NotSupportedError");
        }
        // Jeda kecil antar potongan: buffer printer kecil, dan mengirim tanpa jeda
        // membuat cetakannya terpotong di tengah.
        if (index < potongan.length - 1) {
          await new Promise((done) => setTimeout(done, ESC_POS_BLE_CHUNK_DELAY_MS));
        }
      }
    },
    async close() {
      try {
        server.disconnect();
      } catch {
        // Sudah terputus: tidak ada yang perlu dikerjakan.
      }
    },
  };
}

/**
 * Menyambung ke printer — **memunculkan pemilih peramban**, jadi harus dipanggil
 * langsung dari ketukan kasir (bukan dari `useEffect`): peramban menolak
 * permintaan perangkat tanpa gerakan pengguna.
 */
export async function escposConnect(transport: EscposTransport): Promise<EscposConnection> {
  const jalur = escposTransportOf(transport);
  if (jalur === "bluetooth") {
    const bluetooth = bluetoothApi();
    if (!bluetooth) throw new DOMException("Web Bluetooth tidak tersedia", "NotSupportedError");
    const device = await bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ESC_POS_BLE_OPTIONAL_SERVICES,
    });
    return openBluetooth(device);
  }

  const usb = usbApi();
  if (!usb) throw new DOMException("WebUSB tidak tersedia", "NotSupportedError");
  const device = await usb.requestDevice({ filters: ESC_POS_USB_FILTERS });
  return openUsb(device);
}

/**
 * Menyambung ulang **tanpa dialog**: peramban mengingat izin per perangkat, dan
 * `getDevices()` mengembalikan yang sudah diizinkan.
 *
 * Hanya untuk USB: Web Bluetooth belum punya daftar serupa di peramban stabil,
 * jadi printer Bluetooth memang harus dipilih lagi setelah halaman dimuat ulang —
 * dan itu dikatakan di layar, bukan dibiarkan tampak seperti kerusakan.
 */
export async function escposResume(transport: EscposTransport): Promise<EscposConnection | null> {
  if (escposTransportOf(transport) !== "usb") return null;
  const usb = usbApi();
  if (!usb) return null;
  try {
    const devices = await usb.getDevices();
    if (devices.length === 0) return null;
    return await openUsb(devices[0]);
  } catch {
    // Perangkat lupa izinnya atau gagal dibuka: kasir menyambung lewat tombol.
    return null;
  }
}

/* ------------------------------------------------------------------- logo --- */

/**
 * Memuat gambar jadi elemen `Image` (untuk digambar ke kanvas).
 *
 * Dipakai dua jalur yang sama-sama perlu piksel logo: bitmap ESC/POS di berkas
 * ini, dan raster keabuan untuk PDF struk (`@/lib/receiptLogoRaster`). Satu
 * pemuat gambar berarti satu aturan CORS juga — logo dari penyimpanan Convex
 * datang dari origin lain, dan tanpa `crossOrigin` kanvasnya “tercemar” sehingga
 * pikselnya tidak boleh dibaca.
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((selesai, gagal) => {
    const image = new Image();
    if (!url.startsWith("data:")) image.crossOrigin = "anonymous";
    image.onload = () => selesai(image);
    image.onerror = () => gagal(new Error("Logo tidak bisa dibaca"));
    image.src = url;
  });
}

/**
 * Logo toko sebagai bitmap ESC/POS.
 *
 * Logonya digambar `contain` ke kanvas persegi sebesar ukurannya di kertas, lalu
 * pikselnya dijadikan hitam-putih keras: di kertas struk hanya ada satu warna
 * tinta, jadi ambang 50 % menghasilkan bentuk yang sama dengan saringan
 * `grayscale(1) contrast(1.35)` di jalur cetak peramban. Piksel tembus pandang
 * dihitung putih (kertas).
 *
 * Mengembalikan `null` kalau gambarnya tidak bisa dibaca (mis. izin CORS tidak
 * ada) — pemanggilnya melewati logo, bukan menggagalkan seluruh struk.
 */
export async function escposLogoBitmap(url: string, sizePx: number): Promise<EscposBitmap | null> {
  if (!url || sizePx <= 0 || typeof document === "undefined") return null;
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = sizePx;
  canvas.height = sizePx;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, sizePx, sizePx);

  const lebarGambar = image.naturalWidth || image.width;
  const tinggiGambar = image.naturalHeight || image.height;
  if (lebarGambar <= 0 || tinggiGambar <= 0) return null;
  const skala = Math.min(sizePx / lebarGambar, sizePx / tinggiGambar);
  const lebar = Math.max(1, Math.round(lebarGambar * skala));
  const tinggi = Math.max(1, Math.round(tinggiGambar * skala));
  context.drawImage(
    image,
    Math.round((sizePx - lebar) / 2),
    Math.round((sizePx - tinggi) / 2),
    lebar,
    tinggi,
  );

  const piksel = context.getImageData(0, 0, sizePx, sizePx).data;
  return escposPackBitmap(sizePx, sizePx, (x, y) => {
    const offset = (y * sizePx + x) * 4;
    if (piksel[offset + 3] < 128) return false;
    const cahaya =
      0.299 * piksel[offset] + 0.587 * piksel[offset + 1] + 0.114 * piksel[offset + 2];
    return cahaya < 128;
  });
}

/* ------------------------------------------------------------------ cetak --- */

export interface EscposPrintResult {
  /** Kalimat yang bisa langsung ditampilkan ke kasir. */
  message: string;
  /** Jumlah byte yang dikirim. */
  bytes: number;
  /** Langkah perintah yang dikirim (nama + panjang byte) — untuk laporan & uji. */
  steps: { label: string; bytes: number }[];
}

/**
 * Menyusun byte struk lalu mengirimkannya lewat sambungan yang sudah ada.
 *
 * Logo disiapkan **sesudah** sambungan berdiri (gambar & kanvas butuh waktu), dan
 * kegagalannya hanya membuat logo dilewati: struknya tetap harus keluar.
 */
export async function escposPrintReceipt(
  connection: EscposConnection,
  document: ReceiptDocument,
  options: { openDrawer?: boolean } = {},
): Promise<EscposPrintResult> {
  const capability = escposCapability(document.printer.id);
  let logo: EscposBitmap | null = null;
  let catatan = "";
  if (document.logoUrl && capability.raster) {
    try {
      const ukuran = escposLogoDots({
        printerId: document.printer.id,
        paperWidthMm: document.paper.widthMm,
      });
      logo = await escposLogoBitmap(document.logoUrl, ukuran);
      if (!logo) catatan = " Logo tidak bisa disiapkan, jadi struknya dicetak tanpanya.";
    } catch {
      catatan =
        " Logo toko tidak bisa dibaca (izin berkas), jadi struknya dicetak tanpanya.";
    }
  } else if (document.logoUrl && !capability.raster) {
    catatan = ` Printer ${document.printer.label} mencetak tanpa logo.`;
  }

  const bytes = escposReceiptBytes(document, { logo, openDrawer: options.openDrawer });
  await connection.write(bytes);

  return {
    message:
      `Struk dikirim ke ${connection.name} — ${bytes.length} byte, ` +
      `${document.sheets.length} lembar.${catatan}`,
    bytes: bytes.length,
    steps: escposReceiptSteps(document, { logo, openDrawer: options.openDrawer }).map(
      (step) => ({ label: step.label, bytes: step.bytes.length }),
    ),
  };
}

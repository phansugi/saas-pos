/**
 * Binding React untuk cetak struk **langsung ke printer** (`src/lib/escposDevice.ts`).
 *
 * Dipakai halaman kasir: satu tempat yang tahu apakah peramban punya jalurnya,
 * printer mana yang sedang tersambung, dan apa yang harus dikatakan kalau
 * gagal — supaya tombol cetak di layar tidak perlu tahu soal WebUSB, endpoint
 * USB, atau karakteristik Bluetooth.
 *
 * Tiga hal yang sengaja tidak diambil dari React:
 *
 * 1. **Sambungan perangkatnya sendiri** (`useRef`): ia hidup di luar siklus
 *    render. Kalau disimpan di state, menyusun ulang komponen (mis. keranjang
 *    berubah) bisa membuat sambungannya tertutup dan kasir harus memilih
 *    printernya lagi di depan antrean.
 * 2. **Penyambungan otomatis** hanya berlaku untuk USB (`getDevices()` diam-diam
 *    mengembalikan perangkat yang izinnya sudah diberikan). Bluetooth selalu
 *    butuh dipilih lagi, dan itu dikatakan di layar, bukan gagal diam-diam.
 * 3. **Kegagalan menulis tidak jatuh ke dialog cetak peramban.** Struk yang keluar
 *    dua kali lebih buruk daripada struk yang belum keluar: yang satu masih bisa
 *    dicetak ulang setelah sebabnya dibetulkan, yang satunya lagi harus disobek.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  escposErrorMessage,
  type EscposSupport,
  type EscposTransport,
} from "@/lib/escpos";
import {
  escposBrowserSupport,
  escposConnect,
  escposPreferredTransport,
  escposPrintReceipt,
  escposResume,
  setEscposPreferredTransport,
  type EscposConnection,
} from "@/lib/escposDevice";
import type { ReceiptDocument } from "@/lib/struk";

export interface EscposControl {
  /** Jalur apa yang hidup di peramban ini. */
  support: EscposSupport;
  /** Jalur yang dipilih kasir di perangkat ini (USB/Bluetooth). */
  transport: EscposTransport;
  chooseTransport: (transport: EscposTransport) => void;
  /** Nama printer yang tersambung, atau `null` kalau belum ada. */
  device: string | null;
  /** Keterangan teknis sambungan (endpoint/profil) — ditampilkan sebagai `title`. */
  detail: string | null;
  connected: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
  /** Menyambung ke printer; **memunculkan pemilih peramban**, jadi harus dari ketukan. */
  connect: () => Promise<boolean>;
  /** Memutuskan sambungan (printer harus dipilih lagi berikutnya). */
  disconnect: () => Promise<void>;
  /** Mencetak satu dokumen struk; menyambung sendiri kalau belum tersambung. */
  print: (document: ReceiptDocument, options?: { openDrawer?: boolean }) => Promise<boolean>;
  /** Membersihkan pesan terakhir (dipakai saat dialog struk dibuka ulang). */
  clear: () => void;
}

export function useEscpos(): EscposControl {
  const [support] = useState<EscposSupport>(() => escposBrowserSupport());
  const [transport, setTransport] = useState<EscposTransport>(() => escposPreferredTransport());
  const [device, setDevice] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const connectionRef = useRef<EscposConnection | null>(null);

  const lepasSambungan = useCallback(async () => {
    const connection = connectionRef.current;
    connectionRef.current = null;
    setDevice(null);
    setDetail(null);
    if (connection) {
      try {
        await connection.close();
      } catch {
        // Sudah dicabut/terputus: tidak ada yang perlu dikerjakan.
      }
    }
  }, []);

  /*
    Menyambung ulang tanpa dialog hanya mungkin untuk USB. Kalau izinnya sudah
    pernah diberikan, printer yang sama langsung siap; kalau belum, kasir cukup
    menekan tombolnya sekali dan tidak ada pesan galat palsu di layar.
  */
  useEffect(() => {
    let hidup = true;
    if (transport !== "usb" || !support.usb) return () => {};
    void (async () => {
      const connection = await escposResume("usb");
      if (!hidup || !connection) return;
      connectionRef.current = connection;
      setDevice(connection.name);
      setDetail(connection.detail);
    })();
    return () => {
      hidup = false;
    };
  }, [support.usb, transport]);

  useEffect(
    () => () => {
      void lepasSambungan();
    },
    [lepasSambungan],
  );

  const chooseTransport = useCallback(
    (next: EscposTransport) => {
      setEscposPreferredTransport(next);
      setTransport(next);
      setError(null);
      setNotice(null);
      void lepasSambungan();
    },
    [lepasSambungan],
  );

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const connection = await escposConnect(transport);
      connectionRef.current = connection;
      setDevice(connection.name);
      setDetail(connection.detail);
      setNotice(`Printer ${connection.name} siap dipakai.`);
      return true;
    } catch (gagal) {
      const nama = (gagal as { name?: unknown })?.name;
      setError(
        typeof nama === "string" && nama !== ""
          ? escposErrorMessage(nama, transport)
          : `Gagal menyambung ke printer: ${(gagal as Error)?.message ?? String(gagal)}`,
      );
      return false;
    } finally {
      setBusy(false);
    }
  }, [transport]);

  const print = useCallback(
    async (document: ReceiptDocument, options: { openDrawer?: boolean } = {}) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        let connection = connectionRef.current;
        if (!connection) {
          connection = await escposConnect(transport);
          connectionRef.current = connection;
          setDevice(connection.name);
          setDetail(connection.detail);
        }
        const hasil = await escposPrintReceipt(connection, document, options);
        setNotice(hasil.message);
        return true;
      } catch (gagal) {
        const nama = (gagal as { name?: unknown })?.name;
        setError(
          typeof nama === "string" && nama !== ""
            ? escposErrorMessage(nama, transport)
            : `Gagal mencetak: ${(gagal as Error)?.message ?? String(gagal)}`,
        );
        // Sambungan yang gagal menulis dibuang: printer yang dicabut di tengah
        // mencetak tidak boleh dipakai lagi untuk nota berikutnya.
        await lepasSambungan();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [lepasSambungan, transport],
  );

  const clear = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  return {
    support,
    transport,
    chooseTransport,
    device,
    detail,
    connected: device !== null,
    busy,
    error,
    notice,
    connect,
    disconnect: lepasSambungan,
    print,
    clear,
  };
}

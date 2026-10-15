/**
 * Binding React untuk setelan bunyi bip kasir (`src/lib/scanBeep.ts`).
 *
 * Dipakai dua tempat: tombol **Bip kasir** beserta kontrol volumenya di header
 * halaman kasir (tempat kasir bisa mengaturnya sendiri, tanpa izin pengaturan
 * workspace) dan kartu setelan di halaman **Pengaturan**. Keduanya menulis ke
 * satu sumber yang sama, jadi tidak mungkin menampilkan keadaan yang berbeda —
 * termasuk volumenya.
 *
 * Sumbernya `useSyncExternalStore`, bukan `useState`: setelan ini hidup di luar
 * React (perangkat + modul murni yang juga dipanggil jalur non-React seperti
 * `addToCart`), dan salinan di state komponen justru yang membuat keduanya bisa
 * menyimpang.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  previewScanBeep,
  scanBeepSetting,
  setScanBeepEnabled,
  setScanBeepVolume,
  stepScanBeepVolume,
  subscribeScanBeep,
} from "@/lib/scanBeep";

export interface ScanBeepControl {
  /** Apakah bip aktif di perangkat ini. */
  enabled: boolean;
  /** Kekuatan bip di perangkat ini, dalam persen (10–100). */
  volume: number;
  /** Nyalakan/matikan (langsung tersimpan ke perangkat). */
  setEnabled: (next: boolean) => void;
  /** Setel volume langsung; nilai di luar skala dibulatkan & dijepit. */
  setVolume: (next: number) => void;
  /** Satu tingkat lebih keras (langkah 10 %), berhenti di batasnya. */
  increaseVolume: () => void;
  /** Satu tingkat lebih pelan, berhenti di batasnya. */
  decreaseVolume: () => void;
  /** Bunyikan contoh nada — dengan volume yang sedang berlaku — tanpa mengubah setelan. */
  preview: () => void;
}

export function useScanBeep(): ScanBeepControl {
  const setting = useSyncExternalStore(
    subscribeScanBeep,
    scanBeepSetting,
    scanBeepSetting,
  );

  const setEnabled = useCallback((next: boolean) => setScanBeepEnabled(next), []);
  const setVolume = useCallback((next: number) => {
    setScanBeepVolume(next);
  }, []);
  /*
    Langkah naik/turun dihitung dari nilai yang **sedang berlaku** (bukan dari
    `setting.volume` yang bisa basi kalau dua klik datang cepat): perubahan
    setelan langsung tersimpan, jadi klik beruntun tetap naik satu tingkat
    masing-masing.
  */
  const increaseVolume = useCallback(() => {
    setScanBeepVolume(stepScanBeepVolume(scanBeepSetting().volume, 1));
  }, []);
  const decreaseVolume = useCallback(() => {
    setScanBeepVolume(stepScanBeepVolume(scanBeepSetting().volume, -1));
  }, []);
  const preview = useCallback(() => {
    previewScanBeep();
  }, []);

  return {
    enabled: setting.enabled,
    volume: setting.volume,
    setEnabled,
    setVolume,
    increaseVolume,
    decreaseVolume,
    preview,
  };
}

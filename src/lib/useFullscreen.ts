import { useCallback, useEffect, useState } from "react";
import { applyFullscreen, fullscreenActiveFor } from "@/lib/fullscreen";

/**
 * State mode layar penuh untuk **satu shell/halaman**: `active` + `toggle`.
 *
 * Dipisah jadi hook (bukan disimpan di dalam tombolnya) karena dua hal harus
 * membaca nilai yang sama: sidebar backstage yang disembunyikan, dan tombolnya —
 * kalau keduanya punya state sendiri-sendiri, menekan tombol tidak akan
 * menyembunyikan apa pun.
 *
 * State-nya sengaja **tidak** persisten: permintaan layar penuh peramban
 * mensyaratkan sentuhan pengguna, jadi pilihan yang disimpan hanya akan gagal
 * dipulihkan saat halaman dimuat ulang. Muat ulang = kembali normal.
 */
export function useFullscreen(): { active: boolean; toggle: () => void } {
  const [active, setActive] = useState(false);

  // Keluar lewat Esc (atau tombol layar penuh peramban) harus mengembalikan
  // tampilan: tombol dan isi layar tidak boleh bertentangan.
  useEffect(() => {
    function syncFromBrowser() {
      if (!fullscreenActiveFor(document)) setActive(false);
    }
    document.addEventListener("fullscreenchange", syncFromBrowser);
    return () => document.removeEventListener("fullscreenchange", syncFromBrowser);
  }, []);

  const toggle = useCallback(() => {
    const next = !active;
    // Tampilan diubah lebih dulu: hasilnya tidak boleh bergantung pada izin
    // layar penuh peramban (lihat `@/lib/fullscreen`).
    setActive(next);
    void applyFullscreen(next, document);
  }, [active]);

  return { active, toggle };
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import {
  applyTheme,
  readStoredTheme,
  resolveTheme,
  systemPrefersLight,
} from "@/lib/theme";
import { SERVICE_WORKER_URL, supportsServiceWorker } from "@/lib/pwa";
import "./index.css";

/*
  Bootstrap di `index.html` sudah menyetel tema sebelum React berjalan (supaya
  tidak ada kedipan). Ini mengulangnya dengan aturan yang sama supaya tema tetap
  benar kalau script itu diblokir — dan sekaligus menyelaraskan warna bilah
  browser.
*/
applyTheme(resolveTheme(readStoredTheme(window.localStorage), systemPrefersLight()), {
  root: document.documentElement,
  meta: document.querySelector('meta[name="theme-color"]'),
});

/*
  Service worker: yang membuat aplikasi bisa dipasang dan tetap terbuka offline.
  Didaftarkan setelah halaman selesai dimuat supaya tidak berebut bandwidth
  dengan render pertama, dan kegagalannya **tidak** dibiarkan mematikan aplikasi
  — pemasangan PWA adalah bonus, bukan syarat.
*/
if (supportsServiceWorker(navigator)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(() => {
      // Diabaikan dengan sengaja: lihat komentar di atas.
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

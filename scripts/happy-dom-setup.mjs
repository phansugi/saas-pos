/**
 * DOM tiruan (happy-dom) yang dipasang sebagai global **sebelum** React DOM
 * diimpor.
 *
 * Kenapa dipisah jadi modul sendiri: `react-dom` membaca `document` saat
 * modulnya baru dievaluasi untuk memutuskan cara menangani event form
 * (`isInputEventSupported`). Kalau React dievaluasi lebih dulu — yaitu urutan
 * alami kalau pemasangan global ada di badan berkas yang sama — React memilih
 * jalur lama (`onpropertychange` ala IE), dan event `input` tidak pernah
 * diterjemahkan menjadi `onChange`. Akibatnya harness tidak bisa mengetik ke
 * kolom teks sama sekali, walaupun di browser normal kolom itu berfungsi.
 *
 * Karena ESM mengevaluasi import secara berurutan, cukup mengimpor berkas ini
 * **paling atas** di harness:
 *
 *   import { window } from "./happy-dom-setup.mjs";
 *   import React from "react";
 *   import { createRoot } from "react-dom/client";
 */
import { Window } from "happy-dom";

/*
  Harness DOM tiruan selalu bekerja pada **data demo**, apa pun isi `.env.local`
  mesin ini (mis. saat preview dijalankan dalam mode Convex supaya backstage hidup).
  Aplikasi memilih sumber datanya saat modul dievaluasi (`src/lib/store/config.ts`),
  dan nilai yang diset di proses menang atas berkas env — jadi menetapkannya di sini
  membuat hasil harness tidak bergantung pada setelan mesin pengembang.
*/
process.env.VITE_DATA_SOURCE = "demo";

const window = new Window({ url: "https://mesinpos.test/" });

globalThis.window = window;
globalThis.document = window.document;
globalThis.navigator = window.navigator;
globalThis.localStorage = window.localStorage;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.MutationObserver = window.MutationObserver;
// `FileReader` ada di peramban tetapi tidak di Node, jadi memasangnya aman: tanpa
// ini berkas gambar yang dipilih pengguna tidak bisa dibaca di DOM tiruan, dan
// alur unggah gambar produk hanya bisa diuji di browser sungguhan.
globalThis.FileReader = window.FileReader;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  });
}
globalThis.matchMedia = window.matchMedia.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export { window };

/**
 * Uji aturan tombol menu (burger) di header backstage tanpa deployment.
 *
 * Yang diuji adalah `src/lib/sidebarMenu.ts` — modul murni yang dipakai header
 * (`AppLayout`), sidebar-nya, dan harness render. Dua janji yang dijaga:
 *
 *  1. **Menu selalu punya jalan masuk.** Tombolnya wajib ada di layar kecil
 *     (sidebar statiknya tidak tampil di bawah `lg`) **dan** di mode layar penuh
 *     (sidebar statiknya sengaja dimatikan) — dua sebab berbeda, satu tombol.
 *     Karena “layar kecil” ditentukan CSS, jejaknya kelas `lg:hidden` yang
 *     **hanya** dipasang saat layar penuh tidak aktif.
 *  2. **Satu kelas display per keadaan.** Statik (`hidden lg:flex`), panel
 *     melayang (fixed), atau sembunyi total (`hidden`) — tidak ada dua kelas
 *     display yang bertabrakan dan membuat pemenangnya bergantung urutan CSS.
 *     Panel melayang di luar layar penuh harus kembali statik di layar lebar,
 *     supaya halaman tidak tertutup lapisan yang tidak terlihat.
 *
 * Usage: bun scripts/verify-sidebar-menu.mjs
 */
import {
  sidebarBackdropClass,
  sidebarClass,
  sidebarMenuButtonClass,
  sidebarMenuHint,
  sidebarMenuLabel,
  sidebarMenuReach,
  sidebarMode,
} from "../src/lib/sidebarMenu.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

/** Kelas sebagai potongan-potongan, supaya pemeriksaannya per-kelas. */
const classes = (value) => value.split(/\s+/).filter(Boolean);

/** Kelas yang benar-benar menampilkan sebuah elemen (bukan `hidden`). */
const DISPLAY = /^(flex|block|grid|inline-flex|table|contents)$/;
const LG_DISPLAY = /^lg:(flex|block|grid|inline-flex|table|contents)$/;

// ----------------------------------------------------- kapan tombolnya muncul
check(
  "di layar kecil tombol menu muncul, dan jejaknya kelas lg:hidden",
  sidebarMenuReach(false) === "small-screens" &&
    classes(sidebarMenuButtonClass(false)).includes("lg:hidden"),
  `${sidebarMenuReach(false)} · ${sidebarMenuButtonClass(false)}`,
);
check(
  "di mode layar penuh tombolnya muncul di lebar mana pun (tanpa lg:hidden)",
  sidebarMenuReach(true) === "always" &&
    classes(sidebarMenuButtonClass(true)).includes("inline-flex") &&
    !classes(sidebarMenuButtonClass(true)).includes("lg:hidden"),
  `${sidebarMenuReach(true)} · ${sidebarMenuButtonClass(true)}`,
);
check(
  "tombolnya selalu bisa tampil, apa pun keadaannya",
  classes(sidebarMenuButtonClass(true)).includes("inline-flex") &&
    classes(sidebarMenuButtonClass(false)).includes("inline-flex"),
  `${sidebarMenuButtonClass(true)} | ${sidebarMenuButtonClass(false)}`,
);

// ------------------------------------------------------------ keadaan sidebar
check(
  "panel dibuka → sidebar jadi panel melayang (lepas dari aliran halaman)",
  sidebarMode({ fullscreen: false, open: true }) === "drawer" &&
    sidebarMode({ fullscreen: true, open: true }) === "drawer",
  `${sidebarMode({ fullscreen: false, open: true })} / ${sidebarMode({ fullscreen: true, open: true })}`,
);
check(
  "panel tertutup & bukan layar penuh → sidebar statik seperti sebelumnya",
  sidebarMode({ fullscreen: false, open: false }) === "static",
  sidebarMode({ fullscreen: false, open: false }),
);
check(
  "panel tertutup & layar penuh → sidebar sembunyi total (perilaku lama tidak berubah)",
  sidebarMode({ fullscreen: true, open: false }) === "hidden",
  sidebarMode({ fullscreen: true, open: false }),
);

// -------------------------------------------------------------- kelas sidebar
{
  const hidden = classes(sidebarClass({ fullscreen: true, open: false }));
  check(
    "sidebar yang disembunyikan tidak punya satu pun kelas yang bisa memunculkannya",
    hidden.includes("hidden") &&
      !hidden.includes("lg:flex") &&
      !hidden.some((name) => DISPLAY.test(name) || LG_DISPLAY.test(name)),
    hidden.join(" "),
  );
}
{
  const statik = classes(sidebarClass({ fullscreen: false, open: false }));
  check(
    "sidebar statik tetap hidden lg:flex seperti sebelumnya",
    statik.includes("hidden") &&
      statik.includes("lg:flex") &&
      !statik.some((name) => DISPLAY.test(name)),
    statik.join(" "),
  );
}
{
  const drawer = classes(sidebarClass({ fullscreen: false, open: true }));
  check(
    "panel melayang menempel kiri layar, di atas isi halaman",
    drawer.includes("flex") &&
      drawer.includes("fixed") &&
      drawer.includes("left-0") &&
      drawer.includes("z-40") &&
      !drawer.includes("hidden"),
    drawer.join(" "),
  );
  // Bug yang ditemukan uji peramban: panel setinggi layar menutupi tombol yang
  // membukanya, sehingga klik kedua tertelan panelnya sendiri.
  check(
    "panelnya mulai di bawah header (top-16) supaya tidak menutupi tombol menunya",
    drawer.includes("top-16") &&
      drawer.includes("bottom-0") &&
      !drawer.includes("inset-y-0") &&
      !drawer.includes("top-0"),
    drawer.join(" "),
  );
  check(
    "panel melayang di luar layar penuh kembali statik di layar lebar",
    drawer.includes("lg:static") &&
      drawer.includes("lg:z-auto") &&
      drawer.includes("lg:shadow-none"),
    drawer.join(" "),
  );
}
{
  const drawerPenuh = classes(sidebarClass({ fullscreen: true, open: true }));
  check(
    "di layar penuh panelnya tetap melayang di semua lebar (tidak kembali statik)",
    drawerPenuh.includes("fixed") &&
      !drawerPenuh.includes("lg:static") &&
      !drawerPenuh.some((name) => LG_DISPLAY.test(name)),
    drawerPenuh.join(" "),
  );
  check(
    "di layar penuh panelnya juga mulai di bawah header (geometrinya sama di dua mode)",
    drawerPenuh.includes("top-16") && drawerPenuh.includes("bottom-0"),
    drawerPenuh.join(" "),
  );
}

// -------------------------------------------------------------- latar penutup
{
  const biasa = classes(sidebarBackdropClass(false));
  const penuh = classes(sidebarBackdropClass(true));
  check(
    "latar penutup menutupi seluruh layar",
    biasa.includes("fixed") && biasa.includes("inset-0") && biasa.includes("z-30"),
    biasa.join(" "),
  );
  check(
    "latar penutup ikut hilang di layar lebar kalau bukan layar penuh",
    biasa.includes("lg:hidden") && !penuh.includes("lg:hidden"),
    `${biasa.join(" ")} | ${penuh.join(" ")}`,
  );
  check(
    "latar penutup berada di bawah panelnya (z-30 < z-40)",
    biasa.includes("z-30") && classes(sidebarClass({ fullscreen: false, open: true })).includes("z-40"),
    `${biasa.join(" ")}`,
  );
}

// ------------------------------------------------------------- label & hint
check(
  "label tombol menyebut tindakan yang akan terjadi",
  sidebarMenuLabel(false) === "Buka menu" && sidebarMenuLabel(true) === "Tutup menu",
  `${sidebarMenuLabel(false)} / ${sidebarMenuLabel(true)}`,
);
check(
  "hint menjelaskan kenapa tombolnya ada (layar kecil & layar penuh)",
  sidebarMenuHint(false).includes("layar kecil") &&
    sidebarMenuHint(false).includes("layar penuh"),
  sidebarMenuHint(false),
);
check(
  "hint saat terbuka menyebut cara menutupnya",
  sidebarMenuHint(true).includes("Esc") && sidebarMenuHint(true).includes("Tutup"),
  sidebarMenuHint(true),
);

console.log(`${results.length}/${results.length} checks passed`);

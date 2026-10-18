/**
 * Uji halaman **Profil** (`/app/profil`) — dua profil di satu halaman.
 *
 * Kenapa ada: halaman ini satu-satunya tempat dua pemilik data yang berbeda
 * diubah berdampingan, dan justru pembagian itulah yang paling mudah rusak:
 *
 *   1. **profil saya** (`users.updateProfile`) harus bisa diubah **setiap** peran —
 *      kasir yang memperbaiki namanya tidak boleh butuh izin tambahan, dan yang
 *      diubah harus benar-benar baris miliknya (`verifyActor`);
 *   2. **profil usaha** (`tenants.updateProfile`) butuh `billing.manage`; peran
 *      tanpa izin itu tetap harus **membaca** identitas tokonya, tetapi kolomnya
 *      terkunci dan alasannya disebut — bukan halaman yang gagal dimuat;
 *   3. keduanya harus **tersimpan seperti yang dikatakan notisnya**: nomor
 *      `0812…` tersimpan sebagai `62812…` (`wa.me`), kolom yang dikosongkan jadi
 *      “belum diisi” (bukan string kosong), dan satu kolom yang tidak lolos
 *      membatalkan seluruh penyimpanan;
 *   4. aturannya **satu sumber** (`src/convex/lib/profile.ts`) untuk halaman,
 *      kedua store, dan server — pesan yang dibaca di mode demo harus sama dengan
 *      yang datang dari server.
 *
 * Karena itu yang diuji bukan hanya fungsinya: halaman aslinya dirender di DOM
 * tiruan (router + provider + store asli, mode demo), kolomnya **diketik**, dan
 * tombol simpannya **ditekan** — lalu yang diperiksa adalah yang benar-benar
 * tampil di layar setelahnya.
 *
 * Usage: bun scripts/verify-profile.mjs
 */
// DOM tiruan dipasang lebih dulu, lalu React **diimpor setelahnya** (lihat
// happy-dom-setup.mjs): urutannya menentukan apakah event `input` sampai ke
// `onChange` milik React.
import "./happy-dom-setup.mjs";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import {
  applyTenantProfileDraft,
  applyUserProfileDraft,
  checkProfileAddress,
  checkProfileEmail,
  checkProfileName,
  checkProfilePhone,
  describeTenantProfile,
  describeUserProfile,
  formatWhatsapp,
  PROFILE_ADDRESS_MAX,
  PROFILE_NAME_MAX,
  PROFILE_NAME_MIN,
  sameTenantProfile,
  sameUserProfile,
  tenantProfileGaps,
  tenantProfileOf,
  tenantProfileSentence,
  userProfileGaps,
  userProfileOf,
  userProfileSentence,
  whatsappHref,
} from "../src/convex/lib/profile.ts";

const window = globalThis.window;
const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router-dom");

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// Animasi framer-motion (beranda) dibatalkan saat pohonnya dilepas, dan happy-dom
// melaporkan pembatalan itu sebagai rejection tanpa penangkap. Membongkar render
// memang begitu — bukan kegagalan uji.
process.on("unhandledRejection", (reason) => {
  if (reason?.name === "AbortError") return;
  throw reason;
});

const errors = [];
const originalError = console.error;
console.error = (...args) => {
  errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  originalError(...args);
};
globalThis.reportError = (error) => {
  errors.push(`reportError: ${error?.message ?? String(error)}`);
};
window.reportError = globalThis.reportError;

// ══════════════════════════════════════════════ 1. Aturan murni (satu sumber)
{
  // ── nama ─────────────────────────────────────────────────────────────────
  check(
    "nama dirapikan: spasi pinggir & ganda tidak dihitung",
    checkProfileName("  Toko   Berkah ").value === "Toko Berkah",
    JSON.stringify(checkProfileName("  Toko   Berkah ")),
  );
  const kosong = checkProfileName("   ", "Nama usaha");
  check(
    "nama kosong ditolak dan kolomnya disebut",
    kosong.ok === false && kosong.reason.includes("Nama usaha") && kosong.reason.includes("kosong"),
    JSON.stringify(kosong),
  );
  const pendek = checkProfileName("A");
  check(
    `nama ${PROFILE_NAME_MIN}–${PROFILE_NAME_MAX} karakter ditegakkan`,
    pendek.ok === false &&
      pendek.reason.includes(`minimal ${PROFILE_NAME_MIN}`) &&
      checkProfileName("A".repeat(PROFILE_NAME_MIN)).ok === true &&
      checkProfileName("B".repeat(PROFILE_NAME_MAX)).ok === true &&
      checkProfileName("C".repeat(PROFILE_NAME_MAX + 1)).ok === false,
    JSON.stringify([pendek, checkProfileName("B".repeat(PROFILE_NAME_MAX + 1))]),
  );

  // ── kolom boleh kosong: kosong = null, bukan string kosong ───────────────
  check(
    "alamat yang dikosongkan jadi null, dan batasnya ditegakkan",
    checkProfileAddress("").value === null &&
      checkProfileAddress("  Jl. Merdeka 10  ").value === "Jl. Merdeka 10" &&
      checkProfileAddress("x".repeat(PROFILE_ADDRESS_MAX)).ok === true &&
      checkProfileAddress("x".repeat(PROFILE_ADDRESS_MAX + 1)).ok === false,
    JSON.stringify(checkProfileAddress("x".repeat(PROFILE_ADDRESS_MAX + 1))),
  );

  // ── email: validator yang sama dengan pengiriman kode OTP ────────────────
  check(
    "email usaha memakai validator kode OTP dan dinormalkan",
    checkProfileEmail("Halo@Bisnis.ID ").value === "halo@bisnis.id" &&
      checkProfileEmail("").value === null &&
      checkProfileEmail("budi@toko").ok === false &&
      checkProfileEmail("budi@toko").reason.includes("titik"),
    JSON.stringify(checkProfileEmail("budi@toko")),
  );

  // ── nomor WhatsApp: satu aturan dengan undangan tim (`wa.me`) ────────────
  check(
    "nomor WhatsApp dinormalkan ke bentuk wa.me (08…/8…/+62… sama)",
    checkProfilePhone("0812-3456-7890").value === "6281234567890" &&
      checkProfilePhone("81234567890").value === "6281234567890" &&
      checkProfilePhone("+62 8123 4567 890").value === "6281234567890" &&
      checkProfilePhone("").value === null,
    JSON.stringify([
      checkProfilePhone("0812-3456-7890"),
      checkProfilePhone("+62 8123 4567 890"),
    ]),
  );
  const tanpaAngka = checkProfilePhone("abc");
  check(
    "isian tanpa angka disebut apa adanya, bukan “kosong”",
    tanpaAngka.ok === false && tanpaAngka.reason.includes("harus berisi angka"),
    JSON.stringify(tanpaAngka),
  );
  const terlaluPendek = checkProfilePhone("0812");
  check(
    "nomor terlalu pendek ditolak dengan batas digitnya",
    terlaluPendek.ok === false && terlaluPendek.reason.includes("8–15 digit"),
    JSON.stringify(terlaluPendek),
  );

  // ── isian halaman diterapkan: satu kolom salah = batal semua ─────────────
  const current = { name: "Toko Berkah", address: null, email: null, phone: null };
  const campur = applyTenantProfileDraft(current, {
    name: "Toko Berkah Jaya",
    address: "Jl. Merdeka 10, Bandung",
    email: "halo@toko",
    phone: "0812-3456-7890",
  });
  check(
    "satu kolom yang tidak lolos membatalkan seluruh penyimpanan",
    campur.ok === false && campur.reason.includes("titik"),
    JSON.stringify(campur),
  );
  const sebagian = applyTenantProfileDraft(current, { phone: "0812-3456-7890" });
  check(
    "kolom yang tidak dikirim berarti “jangan diubah”",
    sebagian.ok === true &&
      sebagian.value.name === "Toko Berkah" &&
      sebagian.value.address === null &&
      sebagian.value.phone === "6281234567890",
    JSON.stringify(sebagian),
  );
  const userDraft = applyUserProfileDraft(
    { name: "Rina", phone: null },
    { name: "  Rina   Kasir ", phone: "0812-3456-7890" },
  );
  check(
    "profil pengguna memakai aturan yang sama (nama + nomor)",
    userDraft.ok === true &&
      userDraft.value.name === "Rina Kasir" &&
      userDraft.value.phone === "6281234567890",
    JSON.stringify(userDraft),
  );
  check(
    "profil tanpa nama ditolak (nama wajib)",
    applyUserProfileDraft({ name: "Rina", phone: null }, { name: " " }).ok === false,
    JSON.stringify(applyUserProfileDraft({ name: "Rina", phone: null }, { name: " " })),
  );

  // ── pembanding “tidak ada yang berubah” ──────────────────────────────────
  const full = {
    name: "Toko Berkah",
    address: "Jl. Merdeka 10",
    email: "halo@berkah.id",
    phone: "6281234567890",
  };
  check(
    "perubahan kosong dikenali supaya tidak menulis audit/notis",
    sameTenantProfile(full, { ...full }) === true &&
      sameTenantProfile(full, { ...full, phone: null }) === false &&
      sameUserProfile({ name: "Rina", phone: null }, { name: "Rina", phone: null }) === true,
    "pembanding profil",
  );

  // ── pembacaan baris lama (kolom yang belum ada) ──────────────────────────
  check(
    "tenant lama tanpa kolom profil dibaca “belum diisi”, bukan gagal",
    JSON.stringify(tenantProfileOf({ name: "Toko Lama" })) ===
      JSON.stringify({ name: "Toko Lama", address: null, email: null, phone: null }),
    JSON.stringify(tenantProfileOf({ name: "Toko Lama" })),
  );
  const barisLama = tenantProfileOf({
    name: "Toko Lama",
    address: "  Jl.  Lama 1 ",
    email: "HALO@LAMA.ID",
    phone: "0812-3456-7890",
  });
  check(
    "baris lama yang sudah terisi dinormalkan sama seperti tulisan baru",
    barisLama.address === "Jl. Lama 1" &&
      barisLama.email === "halo@lama.id" &&
      barisLama.phone === "6281234567890",
    JSON.stringify(barisLama),
  );
  check(
    "profil pengguna dari baris users dibaca seragam",
    JSON.stringify(userProfileOf({ name: " Rina ", phone: "0812-3456-7890" })) ===
      JSON.stringify({ name: "Rina", phone: "6281234567890" }),
    JSON.stringify(userProfileOf({ name: " Rina ", phone: "0812-3456-7890" })),
  );

  // ── lencana & kalimat notis: yang kurang harus disebut ───────────────────
  check(
    "kekurangan profil usaha disebut berurutan (alamat, email, nomor WA)",
    JSON.stringify(tenantProfileGaps({ name: "Toko", address: null, email: null, phone: null })) ===
      JSON.stringify(["alamat", "email", "nomor WA"]) &&
      describeTenantProfile({ name: "Toko", address: null, email: null, phone: null }) ===
        "Belum ada: alamat, email, nomor WA" &&
      describeTenantProfile(full) === "Profil lengkap",
    describeTenantProfile({ name: "Toko", address: null, email: null, phone: null }),
  );
  check(
    "profil pengguna hanya menuntut nomor WA",
    JSON.stringify(userProfileGaps({ name: "Rina", phone: null })) === JSON.stringify(["nomor WA"]) &&
      describeUserProfile({ name: "Rina", phone: "6281234567890" }) === "Profil lengkap",
    describeUserProfile({ name: "Rina", phone: null }),
  );
  check(
    "notis setelah menyimpan menyebut yang tersimpan dan yang masih kurang",
    tenantProfileSentence(full) === "Profil usaha “Toko Berkah” tersimpan lengkap." &&
      tenantProfileSentence({ ...full, phone: null }) ===
        "Profil usaha “Toko Berkah” tersimpan. Belum diisi: nomor WA." &&
      userProfileSentence({ name: "Rina", phone: null }) ===
        "Profil Rina tersimpan. Belum diisi: nomor WA.",
    [tenantProfileSentence({ ...full, phone: null }), userProfileSentence({ name: "Rina", phone: null })].join(
      " | ",
    ),
  );

  // ── tampilan nomor: yang tersimpan digit `wa.me`, yang dibaca manusia rapi ─
  check(
    "nomor tersimpan ditampilkan rapi dan bisa dibuka WhatsApp",
    formatWhatsapp("6281234567890") === "+62 8123-4567-890" &&
      formatWhatsapp(null) === "—" &&
      whatsappHref("6281234567890") === "https://wa.me/6281234567890" &&
      whatsappHref(null) === null,
    [formatWhatsapp("6281234567890"), whatsappHref(null)].join(" | "),
  );

  // ── satu sumber aturan: halaman, store, dan server memakai modul yang sama ─
  const pageSource = readFileSync(new URL("../src/pages/ProfilePage.tsx", import.meta.url), "utf8");
  const usersSource = readFileSync(new URL("../src/convex/users.ts", import.meta.url), "utf8");
  const tenantsSource = readFileSync(new URL("../src/convex/tenants.ts", import.meta.url), "utf8");
  const demoSource = readFileSync(new URL("../src/lib/store/demo.tsx", import.meta.url), "utf8");
  const convexSource = readFileSync(new URL("../src/lib/store/convex.tsx", import.meta.url), "utf8");
  check(
    "halaman mengambil aturannya dari @/lib/profile (bukan salinannya sendiri)",
    pageSource.includes('from "@/lib/profile"') &&
      pageSource.includes("applyUserProfileDraft") &&
      pageSource.includes("applyTenantProfileDraft"),
    "import halaman Profil",
  );
  check(
    "server: profil pengguna diperiksa pemilik barisnya, bukan izin peran",
    usersSource.includes("verifyActor(ctx, args.userId)") &&
      usersSource.includes("applyUserProfileDraft") &&
      usersSource.includes("sameUserProfile"),
    "users.updateProfile",
  );
  check(
    "server: profil usaha butuh billing.manage dan menulis jejak audit",
    tenantsSource.includes('requirePermission(ctx, args.tenantId, args.actorId, "billing.manage")') &&
      tenantsSource.includes("applyTenantProfileDraft") &&
      tenantsSource.includes('action: "tenant.profile"'),
    "tenants.updateProfile",
  );
  check(
    "store demo memakai aturan murni yang sama (bukan salinannya)",
    demoSource.includes('from "@/lib/profile"') &&
      demoSource.includes("applyUserProfileDraft") &&
      demoSource.includes("applyTenantProfileDraft") &&
      demoSource.includes("userProfileSentence") &&
      demoSource.includes("tenantProfileSentence"),
    "store demo",
  );
  check(
    "store Convex menyerahkan draftnya ke mutation server (satu aturan lagi)",
    convexSource.includes("api.users.updateProfile") &&
      convexSource.includes("api.tenants.updateProfile"),
    "store Convex",
  );
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

let failure = null;

try {
  const { App } = await server.ssrLoadModule("/src/App.tsx");
  const { SessionProvider } = await server.ssrLoadModule("/src/lib/session.tsx");
  const { BackendProvider, StoreProvider } = await server.ssrLoadModule(
    "/src/lib/store/index.tsx",
  );

  const SESSION_KEY = "mesinpos.session.v1";

  function sessionOf(role, options = {}) {
    const { name = "Uji Profil", tenant = {} } = options;
    return {
      user: { name, email: `profil-${role}@mesinpos.test` },
      tenant: {
        name: "Toko Uji Profil",
        slug: "toko-uji-profil",
        storeName: "Cabang Uji",
        vertical: "umkm",
        verticals: ["umkm", "fnb", "wholesale"],
        planKey: "enterprise",
        role,
        customRole: null,
        createdAt: new Date().toISOString(),
        trialEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        ...tenant,
      },
    };
  }

  /** Render aplikasi asli di `/app/profil`, seperti pengguna membukanya. */
  async function openProfil(session) {
    if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_KEY);
    const container = window.document.createElement("div");
    window.document.body.appendChild(container);
    const root = createRoot(container);
    const before = errors.length;

    await React.act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ["/app/profil"] },
          React.createElement(
            SessionProvider,
            null,
            React.createElement(
              BackendProvider,
              null,
              React.createElement(StoreProvider, null, React.createElement(App, null)),
            ),
          ),
        ),
      );
    });

    return {
      text: () => container.textContent.replace(/\s+/g, " ").trim(),
      q: (selector) => container.querySelector(selector),
      /** Mengisi kolom seperti pengguna mengetik (React yang mengendalikan nilainya). */
      fill: async (selector, value) => {
        const input = container.querySelector(selector);
        if (!input) throw new Error(`kolom "${selector}" tidak ada di DOM`);
        if (input.disabled) throw new Error(`kolom "${selector}" sedang terkunci`);
        const prototype =
          input instanceof window.HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
        await React.act(async () => {
          setter.call(input, value);
          input.dispatchEvent(new window.Event("input", { bubbles: true }));
        });
      },
      /** Memilih opsi `<select>` seperti pengguna memilihnya. */
      pilih: async (selector, value) => {
        const select = container.querySelector(selector);
        if (!select) throw new Error(`pilihan "${selector}" tidak ada di DOM`);
        if (select.disabled) throw new Error(`pilihan "${selector}" sedang terkunci`);
        await React.act(async () => {
          select.value = value;
          select.dispatchEvent(new window.Event("change", { bubbles: true }));
        });
      },
      klik: async (selector) => {
        const element = container.querySelector(selector);
        if (!element) throw new Error(`elemen "${selector}" tidak ada di DOM`);
        if (element.disabled) throw new Error(`elemen "${selector}" sedang nonaktif`);
        await React.act(async () => {
          element.click();
        });
      },
      /** Sesi yang benar-benar tersimpan di perangkat setelah aksi. */
      session: () => JSON.parse(window.localStorage.getItem(SESSION_KEY) ?? "null"),
      newErrors: () => errors.slice(before),
      close: async () => {
        await React.act(async () => {
          root.unmount();
        });
        container.remove();
      },
    };
  }

  const EMPTY_TENANT = {};
  /**
   * Identitas usaha yang **sudah terisi** di sesi. Nama kolomnya mengikuti
   * bentuk sesi perangkat (`whatsapp`), bukan bentuk baris `tenants` (`phone`) —
   * itulah yang dibaca store demo, dan itulah yang ditulis halaman saat
   * menyimpan.
   */
  const ISIsiUsaha = {
    address: "Jl. Merdeka 10, Bandung",
    email: "halo@berkah.id",
    whatsapp: "6281311112222",
  };

  // ═══════════════════════════════════ 2. Pemilik: kedua profil di satu halaman
  {
    const view = await openProfil(sessionOf("owner", { tenant: EMPTY_TENANT }));

    check(
      "kedua kartu profil ada di halaman yang sama (plus jalan keluar)",
      Boolean(view.q('[data-testid="profil-saya"]')) &&
        Boolean(view.q('[data-testid="profil-usaha"]')) &&
        Boolean(view.q('[data-testid="profil-keluar"]')),
      view.text().slice(0, 200),
    );
    check(
      "halaman benar-benar halaman Profil (bukan dialihkan)",
      view.text().includes("Profil") &&
        view.text().includes("Profil saya") &&
        view.text().includes("Profil usaha"),
      view.text().slice(0, 200),
    );
    check(
      "email masuk ditampilkan sebagai keterangan, bukan kolom yang bisa diubah",
      view.q('[data-testid="profil-email-masuk"]').disabled === true &&
        view.q('[data-testid="profil-email-masuk"]').value === "profil-owner@mesinpos.test",
      view.q('[data-testid="profil-email-masuk"]').value,
    );
    check(
      "yang belum diisi disebut apa adanya di lencana kedua kartu",
      view.text().includes("Belum ada: nomor WA") &&
        view.text().includes("Belum ada: alamat, email, nomor WA"),
      view.text().slice(0, 400),
    );
    check(
      "kedua tombol simpan mati selama belum ada yang diubah",
      view.q('[data-testid="simpan-profil-saya"]').disabled === true &&
        view.q('[data-testid="simpan-profil-usaha"]').disabled === true,
      "tombol simpan awal",
    );

    // ── profil saya: diisi, disimpan, dan hasilnya benar-benar berlaku ──────
    await view.fill('[data-testid="profil-nama"]', "Rina Kasir");
    await view.fill('[data-testid="profil-wa"]', "0812-3456-7890");
    check(
      "tombol simpan hidup begitu ada perubahan yang sah",
      view.q('[data-testid="simpan-profil-saya"]').disabled === false,
      "status tombol",
    );
    await view.klik('[data-testid="simpan-profil-saya"]');

    check(
      "notis profil saya menyebut nama yang benar-benar tersimpan",
      view.q('[data-testid="profil-saya-notis"]')?.textContent.trim() ===
        "Profil Rina Kasir tersimpan lengkap.",
      view.q('[data-testid="profil-saya-notis"]')?.textContent?.trim(),
    );
    check(
      "lencana kartu ikut berubah jadi lengkap",
      view.q('[data-testid="profil-saya-lencana"]')?.textContent.trim() === "Profil lengkap",
      view.q('[data-testid="profil-saya-lencana"]')?.textContent?.trim(),
    );
    check(
      "nomor tersimpan dalam bentuk wa.me dan ditampilkan rapi",
      view.text().includes("+62 8123-4567-890") &&
        view.q('[data-testid="profil-chat-wa"]')?.getAttribute("href") ===
          "https://wa.me/6281234567890",
      view.q('[data-testid="profil-chat-wa"]')?.getAttribute("href"),
    );
    const setelahSimpan = view.session();
    check(
      "profil pengguna benar-benar tersimpan di sesi perangkat",
      setelahSimpan.user.name === "Rina Kasir" && setelahSimpan.user.whatsapp === "6281234567890",
      JSON.stringify(setelahSimpan.user),
    );
    check(
      "mengubah nama tidak menyentuh email masuk (identitas masuk tetap)",
      view.q('[data-testid="profil-email-masuk"]').value === "profil-owner@mesinpos.test",
      view.q('[data-testid="profil-email-masuk"]').value,
    );

    // ── validasi: yang salah diberitahukan, dan tidak ada yang tersimpan ────
    await view.fill('[data-testid="profil-nama"]', "R");
    check(
      "nama terlalu pendek: alasannya ditampilkan dan simpan dikunci",
      view.q('[data-testid="profil-saya-validasi"]')?.textContent.includes("minimal 2 karakter") &&
        view.q('[data-testid="simpan-profil-saya"]').disabled === true,
      view.q('[data-testid="profil-saya-validasi"]')?.textContent,
    );
    await view.fill('[data-testid="profil-nama"]', "Rina Kasir");
    await view.fill('[data-testid="profil-wa"]', "abc");
    check(
      "nomor tanpa angka: pesannya menyebut angka, bukan “kosong”",
      view.q('[data-testid="profil-saya-validasi"]')?.textContent.includes("harus berisi angka") &&
        view.q('[data-testid="simpan-profil-saya"]').disabled === true,
      view.q('[data-testid="profil-saya-validasi"]')?.textContent,
    );
    await view.fill('[data-testid="profil-wa"]', "0812");
    check(
      "nomor terlalu pendek: batas digitnya disebut dan simpan tetap dikunci",
      view.q('[data-testid="profil-saya-validasi"]')?.textContent.includes("8–15 digit") &&
        view.q('[data-testid="simpan-profil-saya"]').disabled === true,
      view.q('[data-testid="profil-saya-validasi"]')?.textContent,
    );
    check(
      "yang ditolak tidak pernah tersimpan sebagian",
      view.session().user.name === "Rina Kasir" &&
        view.session().user.whatsapp === "6281234567890",
      JSON.stringify(view.session().user),
    );

    // ── mengosongkan nomor itu sah: “belum diisi”, bukan galat ─────────────
    await view.fill('[data-testid="profil-wa"]', "");
    await view.klik('[data-testid="simpan-profil-saya"]');
    check(
      "mengosongkan nomor WA tersimpan sebagai “belum diisi”",
      view.q('[data-testid="profil-saya-notis"]')?.textContent.trim() ===
        "Profil Rina Kasir tersimpan. Belum diisi: nomor WA." &&
        view.q('[data-testid="profil-saya-lencana"]')?.textContent.trim() ===
          "Belum ada: nomor WA" &&
        view.session().user.whatsapp === undefined,
      JSON.stringify([view.session().user, view.q('[data-testid="profil-saya-notis"]')?.textContent]),
    );
    check(
      "tautan WhatsApp hilang saat nomornya kosong (bukan tautan mati)",
      view.q('[data-testid="profil-chat-wa"]') === null,
      "tautan wa.me",
    );

    // ── profil usaha: satu kolom salah membatalkan seluruh simpan ──────────
    await view.fill('[data-testid="profil-nama-usaha"]', "Toko Berkah Jaya");
    await view.fill('[data-testid="profil-alamat"]', "Jl. Merdeka 10, Bandung");
    await view.fill('[data-testid="profil-email"]', "halo@toko");
    await view.fill('[data-testid="profil-wa-usaha"]', "0813-1111-2222");
    check(
      "email usaha tanpa titik ditolak dan simpan usaha dikunci",
      view.q('[data-testid="profil-usaha-validasi"]')?.textContent.includes("titik") &&
        view.q('[data-testid="simpan-profil-usaha"]').disabled === true,
      view.q('[data-testid="profil-usaha-validasi"]')?.textContent,
    );

    await view.fill('[data-testid="profil-email"]', "halo@berkah.id");
    await view.klik('[data-testid="simpan-profil-usaha"]');
    check(
      "notis profil usaha menyebut nama usaha dan kelengkapannya",
      view.q('[data-testid="profil-usaha-notis"]')?.textContent.trim() ===
        "Profil usaha “Toko Berkah Jaya” tersimpan lengkap.",
      view.q('[data-testid="profil-usaha-notis"]')?.textContent?.trim(),
    );
    const usahaTersimpan = view.session().tenant;
    check(
      "identitas usaha yang tersimpan sudah dinormalkan (nomor jadi 62…)",
      usahaTersimpan.name === "Toko Berkah Jaya" &&
        usahaTersimpan.address === "Jl. Merdeka 10, Bandung" &&
        usahaTersimpan.email === "halo@berkah.id" &&
        usahaTersimpan.whatsapp === "6281311112222",
      JSON.stringify(usahaTersimpan),
    );
    check(
      "nama usaha baru langsung dipakai header aplikasi",
      view.q("header h1")?.textContent.trim() === "Toko Berkah Jaya",
      view.q("header h1")?.textContent?.trim(),
    );
    check(
      "lencana kartu usaha jadi lengkap setelah semua kolom terisi",
      view.q('[data-testid="profil-usaha-lencana"]')?.textContent.trim() === "Profil lengkap",
      view.q('[data-testid="profil-usaha-lencana"]')?.textContent?.trim(),
    );
    // ── kategori utama bisnis: dipilih sekali, lalu terkunci di layar ────────
    check(
      "kartu kategori utama ada dan menyebut pilihan ini permanen",
      Boolean(view.q('[data-testid="profil-kategori-utama"]')) &&
        view.q('[data-testid="profil-kategori-lencana"]')?.textContent.trim() ===
          "Belum dipilih" &&
        view.text().includes("tidak bisa diubah atau dikosongkan"),
      view.text().slice(0, 500),
    );
    check(
      "tombol kunci mati selama kategori & subkategori belum dipilih",
      view.q('[data-testid="simpan-kategori-utama"]').disabled === true &&
        view.q('[data-testid="profil-subkategori-pilih"]').disabled === true,
      "status pemilih kategori",
    );
    await view.pilih('[data-testid="profil-kategori-pilih"]', "fnb");
    check(
      "subkategori hanya berisi milik kategori yang dipilih",
      [...view.q('[data-testid="profil-subkategori-pilih"]').options].map((row) => row.value).join(",") ===
        ",kafe,restoran,warung,bakery,katering",
      [...view.q('[data-testid="profil-subkategori-pilih"]').options]
        .map((row) => row.value)
        .join(","),
    );
    await view.pilih('[data-testid="profil-subkategori-pilih"]', "kafe");
    check(
      "tombol kunci hidup setelah pasangan kategori + subkategori lengkap",
      view.q('[data-testid="simpan-kategori-utama"]').disabled === false,
      "status tombol kunci",
    );
    await view.klik('[data-testid="simpan-kategori-utama"]');
    check(
      "setelah dikunci, nilai kategori & subkategori benar-benar tersimpan",
      view.session().tenant.businessCategory?.category === "fnb" &&
        view.session().tenant.businessCategory?.subcategory === "kafe",
      JSON.stringify(view.session().tenant.businessCategory),
    );
    check(
      "kartu berubah menjadi terkunci: nilai, tanggal, dan tanpa pemilih lagi",
      view.q('[data-testid="profil-kategori-lencana"]')?.textContent.trim() ===
        "Terkunci permanen" &&
        view.q('[data-testid="profil-kategori-nilai"]')?.textContent.trim() ===
          "Makanan & Minuman" &&
        view.q('[data-testid="profil-subkategori-nilai"]')?.textContent.trim() ===
          "Kafe & Kedai Kopi" &&
        view.q('[data-testid="profil-kategori-tanggal"]')?.textContent.trim() !== "—" &&
        view.q('[data-testid="profil-kategori-pilih"]') === null &&
        view.q('[data-testid="simpan-kategori-utama"]') === null,
      view.text().slice(-600),
    );
    check(
      "notis menyebut kategori, subkategori, dan janji permanen",
      view.q('[data-testid="profil-kategori-notis"]')?.textContent.includes(
        "Makanan & Minuman — Kafe & Kedai Kopi",
      ) === true &&
        view.q('[data-testid="profil-kategori-notis"]')?.textContent.includes("permanen") === true,
      view.q('[data-testid="profil-kategori-notis"]')?.textContent,
    );
    check(
      "notis juga menyebut katalog produk yang ikut menyesuaikan",
      view.q('[data-testid="profil-kategori-notis"]')?.textContent.includes(
        "kategori produk",
      ) === true &&
        view.q('[data-testid="profil-kategori-notis"]')?.textContent.includes("Kopi") === true,
      view.q('[data-testid="profil-kategori-notis"]')?.textContent,
    );

    // Muat ulang halaman dengan sesi yang tersimpan: yang tampil harus nilai yang
    // sama, bukan formulir kosong yang menawarkan pilihan kedua.
    const sesiTerkunci = view.session();
    await view.close();
    {
      const ulang = await openProfil(sesiTerkunci);
      check(
        "setelah halaman dimuat ulang, kategori tetap terkunci pada nilai yang sama",
        ulang.q('[data-testid="profil-kategori-nilai"]')?.textContent.trim() ===
          "Makanan & Minuman" &&
          ulang.q('[data-testid="profil-subkategori-nilai"]')?.textContent.trim() ===
            "Kafe & Kedai Kopi" &&
          ulang.q('[data-testid="profil-kategori-pilih"]') === null,
        ulang.text().slice(-500),
      );
      check(
        "halaman dengan kategori terkunci tanpa error konsol",
        ulang.newErrors().length === 0,
        ulang.newErrors().join(" | ").slice(0, 200),
      );
      await ulang.close();
    }

    const viewPenutup = await openProfil(sesiTerkunci);
    check(
      "halaman Profil tanpa error konsol",
      viewPenutup.newErrors().length === 0,
      viewPenutup.newErrors().join(" | ").slice(0, 200),
    );
    await viewPenutup.close();
  }

  // ═══════════════════════ 3. Kasir: profilnya sendiri boleh, identitas usaha tidak
  {
    const view = await openProfil(
      sessionOf("cashier", { name: "Kasir Uji", tenant: { name: "Toko Berkah", ...ISIsiUsaha } }),
    );

    check(
      "kasir tetap membuka halaman Profil (tanpa gerbang izin halaman)",
      !view.text().includes("Akses ditolak") && Boolean(view.q('[data-testid="profil-saya"]')),
      view.text().slice(0, 200),
    );
    check(
      "kasir boleh memperbaiki namanya sendiri tanpa izin tambahan",
      view.q('[data-testid="simpan-profil-saya"]') !== null &&
        view.q('[data-testid="profil-nama"]').disabled === false,
      "kartu profil saya",
    );
    await view.fill('[data-testid="profil-nama"]', "Kasir Sari");
    await view.klik('[data-testid="simpan-profil-saya"]');
    check(
      "perubahan nama kasir benar-benar tersimpan",
      view.session().user.name === "Kasir Sari" &&
        view.q('[data-testid="profil-saya-notis"]')?.textContent.includes("Kasir Sari"),
      JSON.stringify(view.session().user),
    );

    check(
      "kasir tetap bisa membaca identitas usaha (alamat & WA tokonya)",
      view.q('[data-testid="profil-nama-usaha"]').value === "Toko Berkah" &&
        view.q('[data-testid="profil-alamat"]').value === "Jl. Merdeka 10, Bandung" &&
        view.q('[data-testid="profil-wa-usaha"]').value === "6281311112222",
      view.text().slice(0, 300),
    );
    const kolomUsaha = [
      "profil-nama-usaha",
      "profil-alamat",
      "profil-email",
      "profil-wa-usaha",
    ].map((id) => view.q(`[data-testid="${id}"]`));
    check(
      "kolom identitas usaha terkunci untuk kasir, dan tombol simpan tidak ditawarkan",
      kolomUsaha.every((input) => input.disabled === true) &&
        view.q('[data-testid="simpan-profil-usaha"]') === null,
      kolomUsaha.map((input) => input.disabled).join(","),
    );
    check(
      "alasan terkuncinya disebut beserta izin yang dibutuhkan",
      view.q('[data-testid="profil-usaha-baca-saja"]')?.textContent.includes("Mengelola langganan") ===
        true,
      view.q('[data-testid="profil-usaha-baca-saja"]')?.textContent,
    );
    check(
      "kasir hanya membaca kategori utama: tidak ada pemilih atau tombol kunci",
      view.q('[data-testid="profil-kategori-baca-saja"]')?.textContent.includes(
        "Hanya pemilik bisnis",
      ) === true &&
        view.q('[data-testid="profil-kategori-pilih"]') === null &&
        view.q('[data-testid="simpan-kategori-utama"]') === null,
      view.q('[data-testid="profil-kategori-baca-saja"]')?.textContent,
    );
    check(
      "alamat & WA tokonya bisa dibuka dari halaman ini",
      view.q('[data-testid="profil-chat-wa-usaha"]')?.getAttribute("href") ===
        "https://wa.me/6281311112222",
      view.q('[data-testid="profil-chat-wa-usaha"]')?.getAttribute("href"),
    );
    check(
      "halaman Profil untuk kasir tanpa error konsol",
      view.newErrors().length === 0,
      view.newErrors().join(" | ").slice(0, 200),
    );

    await view.close();
  }

  // ═══════════════════════════════════════════ 4. Keluar dari perangkat ini
  {
    const view = await openProfil(sessionOf("owner", { tenant: ISIsiUsaha }));
    check(
      "keluar menjelaskan bahwa data workspace tidak ikut terhapus",
      view.text().includes("data workspace tidak ikut terhapus") ||
        view.text().includes("Data workspace tidak ikut terhapus"),
      view.text().slice(0, 300),
    );
    await view.klik('[data-testid="profil-keluar"]');
    check(
      "keluar benar-benar mengakhiri sesi perangkat ini",
      window.localStorage.getItem(SESSION_KEY) === null,
      window.localStorage.getItem(SESSION_KEY),
    );
    check(
      "setelah keluar pengguna kembali ke beranda publik",
      view.text().includes("Masuk") && !view.text().includes("Profil usaha"),
      view.text().slice(0, 160),
    );
    await view.close();
  }
} catch (error) {
  failure = error;
} finally {
  await server.close();
  await window.happyDOM?.close?.();
}

if (failure) {
  for (const result of results) {
    console.log(`${result.ok ? "✓" : "✗"} ${result.name}`);
  }
  console.error(`\n✗ ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log(`${results.length}/${results.length} checks passed`);
  process.exit(0);
}

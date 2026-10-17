import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  Gauge,
  KeyRound,
  Lock,
  Plug,
  ShieldCheck,
  Store,
  Terminal,
  Webhook,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  API_BASE_PLACEHOLDER,
  API_DOC_ENDPOINTS,
  API_DOC_ERRORS,
  API_DOC_INTEGRATION_STEPS,
  API_DOC_LIMITS,
  API_DOC_NOT_YET,
  API_DOC_UPDATED,
  API_DOC_VERSION,
  SAMPLE_ORDER_BODY,
  SYNC_DOC,
  WEBHOOK_DOC,
  apiSiteUrl,
  type ApiDocEndpoint,
} from "@/lib/apiDocs";
import { API_SCOPE_OPTIONS } from "@/lib/apiKeys";
import { cn } from "@/lib/utils";

/**
 * Dokumentasi API publik (`/dokumentasi-api`) — **tanpa sesi**.
 *
 * Pembacanya adalah pengembang platform mitra (mis. pusatbahanbangunan.com)
 * yang belum punya akun MesinPOS, jadi halaman ini sengaja berada di luar
 * `RequireAuth` dan tidak memuat rahasia apa pun. Isinya dibaca dari
 * `src/lib/apiDocs.ts`, yang menurunkan daftar endpoint dari `API_RESOURCES`
 * dan katalog event dari `WEBHOOK_EVENTS` — jadi dokumentasi tidak bisa
 * menawarkan endpoint yang tidak benar-benar dilayani `http.ts`.
 */
export function ApiDocsPage() {
  const baseUrl = useMemo(() => apiSiteUrl(), []);
  const sections = [
    { id: "mulai", label: "Mulai cepat" },
    { id: "autentikasi", label: "Autentikasi & scope" },
    { id: "endpoint", label: "Referensi endpoint" },
    { id: "webhook", label: "Webhook keluar" },
    { id: "sinkron", label: "Sinkronisasi berkelanjutan" },
    { id: "galat", label: "Kode status" },
    { id: "batas", label: "Batas & kuota" },
    { id: "integrasi", label: "Integrasi platform" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="container flex min-h-16 flex-wrap items-center justify-between gap-2 py-2">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-lg bg-primary/15 text-primary">
                <Store className="size-5" />
              </span>
              <span className="text-base font-bold tracking-tight sm:text-lg">
                Mesin<span className="text-primary">POS</span>
              </span>
            </Link>
            <Badge variant="outline" className="hidden font-mono sm:inline-flex">
              API {API_DOC_VERSION}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm">
              <Link to="/auth?returnTo=/app">Masuk</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/auth?returnTo=/onboarding">Coba Gratis</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative isolate border-b border-border/60 bg-radial-glow">
        <div className="absolute inset-0 -z-10 bg-grid opacity-30" />
        <div className="container py-14 lg:py-20">
          <Badge className="mb-4 gap-1.5">
            <BookOpen className="size-3.5" />
            Dokumentasi publik · {API_DOC_VERSION}
          </Badge>
          <h1 className="max-w-3xl text-balance text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
            API MesinPOS untuk integrasi platform Anda
          </h1>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            REST + JSON di atas HTTPS. Satu kunci API mewakili satu workspace, dengan izin
            yang dibatasi pembuatnya. Halaman ini menjelaskan cara membuat kunci, memanggil
            setiap endpoint, menangani kode status, dan menerima webhook — termasuk langkah
            integrasi ke <strong>pusatbahanbangunan.com</strong>.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2">
              <Terminal className="size-4 text-primary" />
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Base URL
              </span>
              <code className="font-mono text-xs sm:text-sm">{baseUrl}</code>
            </div>
            {baseUrl !== API_BASE_PLACEHOLDER && <CopyButton value={baseUrl} label="Salin" />}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Diperbarui {API_DOC_UPDATED} · tidak ada autentikasi untuk <em>membaca</em>{" "}
            dokumentasi ini; setiap panggilan API tetap wajib memakai kunci.
          </p>
        </div>
      </section>

      <div className="container grid gap-10 py-12 lg:grid-cols-[210px_1fr] lg:gap-14">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Di halaman ini
          </div>
          <nav className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {section.label}
              </a>
            ))}
          </nav>
          <div className="mt-6 hidden rounded-lg border border-border/60 bg-secondary/20 p-3 text-xs text-muted-foreground lg:block">
            Butuh kunci? Buka{" "}
            <Link to="/app/api" className="font-medium text-primary hover:underline">
              API &amp; Webhook
            </Link>{" "}
            di workspace Anda (izin <code>api.manage</code>).
          </div>
        </aside>

        <main className="min-w-0 space-y-14">
          <Section
            id="mulai"
            eyebrow="Langkah pertama"
            title="Mulai cepat dalam empat langkah"
            description="Tidak ada SDK khusus: semuanya HTTP biasa, bisa dipanggil dari backend mana pun."
          >
            <ol className="space-y-3">
              {[
                {
                  title: "Buat kunci di workspace",
                  body: "Masuk ke MesinPOS, buka API & Webhook (`/app/api`), lalu buat kunci dengan nama yang mudah dikenali (mis. “Pusat Bahan Bangunan”) dan scope yang dibutuhkan. Pembuat kunci harus memegang fitur `api.access` dan izin `api.manage`.",
                },
                {
                  title: "Salin rahasia sekali",
                  body: "Kunci tampil sebagai `mp_<publicId>_<rahasia>` dan rahasianya hanya ditampilkan sekali. Yang disimpan server hanya hash-nya, jadi kalau hilang, buat kunci baru atau putar kuncinya.",
                },
                {
                  title: "Simpan di server platform",
                  body: "Simpan kunci sebagai environment variable di backend pusatbahanbangunan.com. Jangan pernah menaruhnya di kode frontend, repositori publik, atau tautan yang bisa dibuka pengguna akhir.",
                },
                {
                  title: "Panggil /ping lebih dulu",
                  body: "Satu permintaan termurah untuk memastikan kunci sah, workspace benar, dan alamat deployment tidak salah.",
                },
              ].map((step) => (
                <li key={step.title} className="rounded-lg border border-border/60 bg-card p-4">
                  <div className="text-sm font-semibold">{step.title}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
            <CodeBlock
              label="Contoh: cek kunci"
              code={`curl -s -H "Authorization: Bearer mp_XXXXXXXXXX_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" \\
  "${baseUrl}${API_DOC_ENDPOINTS.find((row) => row.resource === "ping")?.path ?? "/api/v1/ping"}"`}
            />
            <p className="text-xs text-muted-foreground">
              Header alternatif <code>x-api-key</code> juga diterima untuk klien yang tidak
              nyaman mengirim <code>Authorization</code>; isinya kunci yang sama.
            </p>
          </Section>

          <Section
            id="autentikasi"
            eyebrow="Keamanan"
            title="Autentikasi & scope"
            description="Kunci API adalah bentuk lain dari “bertindak sebagai pembuatnya” — izinnya tidak pernah melebihi izin orang yang membuatnya."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Feature
                icon={KeyRound}
                title="Bentuk kunci"
                body="mp_ + 10 karakter publicId + _ + 32 karakter rahasia. publicId boleh tampil di daftar; rahasianya tidak pernah disimpan."
              />
              <Feature
                icon={ShieldCheck}
                title="Scope ⊆ izin pembuat"
                body="Scope kunci dibatasi izin efektif pembuatnya saat itu. Kalau peran pembuat diturunkan, kunci yang pernah dibuatnya ikut menyempit tanpa perlu dicabut satu per satu."
              />
              <Feature
                icon={Lock}
                title="Berhenti otomatis"
                body="Kunci berhenti bekerja saat dicabut, kedaluwarsa, atau pembuatnya tidak lagi aktif di workspace. Jawabannya 401/403 dengan pesan yang bisa ditindaklanjuti."
              />
              <Feature
                icon={Gauge}
                title="Satu kunci, satu workspace"
                body="Kunci hanya melihat data workspace pembuatnya. Untuk banyak merchant, buat satu kunci per workspace — jangan memakai satu kunci untuk semua."
              />
            </div>
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Scope</th>
                    <th className="px-3 py-2">Artinya</th>
                    <th className="px-3 py-2">Endpoint</th>
                    <th className="px-3 py-2">Jenis</th>
                  </tr>
                </thead>
                <tbody>
                  {API_SCOPE_OPTIONS.map((option) => (
                    <tr key={option.permission} className="border-t border-border/60">
                      <td className="px-3 py-2 font-mono text-xs">{option.permission}</td>
                      <td className="px-3 py-2">{option.label}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                        {option.endpoint}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={option.write ? "accent" : "outline"}>
                          {option.write ? "tulis" : "baca"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CodeBlock
              label="Header permintaan"
              code={`Authorization: Bearer mp_XXXXXXXXXX_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
Accept: application/json`}
            />
          </Section>

          <Section
            id="endpoint"
            eyebrow={`${API_DOC_ENDPOINTS.length} endpoint`}
            title="Referensi endpoint"
            description="Semua balasan berbentuk amplop yang sama: ok, resource, key, scopes, dan data. Bentuk ini stabil untuk versi v1."
          >
            <CodeBlock
              label="Amplop balasan"
              code={`{
  "ok": true,
  "resource": "products",
  "key": "Pusat Bahan Bangunan",
  "scopes": ["inventory.view"],
  "data": { }
}`}
            />
            <div className="space-y-6">
              {API_DOC_ENDPOINTS.map((endpoint) => (
                <EndpointCard key={`${endpoint.method}-${endpoint.resource}`} endpoint={endpoint} />
              ))}
            </div>
          </Section>

          <Section
            id="webhook"
            eyebrow="MesinPOS → platform"
            title="Webhook keluar"
            description="Platform mitra tidak perlu menebak kapan penjualan selesai: daftarkan endpoint HTTPS, lalu MesinPOS mengirim kiriman bertanda tangan setiap event terjadi."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Feature
                icon={Webhook}
                title="Tanda tangan HMAC-SHA256"
                body="Isi dan waktu kirim sama-sama terlindungi: HMAC dihitung atas `${timestamp}.${body}`, dengan toleransi jam 5 menit."
              />
              <Feature
                icon={Plug}
                title="Percobaan ulang terukur"
                body={`${WEBHOOK_DOC.retries}. Balasan 2xx dianggap terkirim; selain itu dicoba lagi, lalu ditandai failed dan terlihat di halaman API.`}
              />
            </div>

            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Event</th>
                    <th className="px-3 py-2">Kapan dikirim</th>
                  </tr>
                </thead>
                <tbody>
                  {WEBHOOK_DOC.events.map((event) => (
                    <tr key={event.key} className="border-t border-border/60">
                      <td className="px-3 py-2 font-mono text-xs">{event.key}</td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{event.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {event.description}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Header</th>
                    <th className="px-3 py-2">Contoh</th>
                    <th className="px-3 py-2">Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  {WEBHOOK_DOC.headers.map((header) => (
                    <tr key={header.name} className="border-t border-border/60">
                      <td className="px-3 py-2 font-mono text-xs">{header.name}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                        {header.value}
                      </td>
                      <td className="px-3 py-2 text-xs">{header.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <CodeBlock label="Badan kiriman" code={WEBHOOK_DOC.payloadExample} />
            <CodeBlock label="Verifikasi tanda tangan (Node.js)" code={WEBHOOK_DOC.verifyExample} />
            <ul className="space-y-2 text-sm text-muted-foreground">
              {WEBHOOK_DOC.notes.map((note) => (
                <li key={note} className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            id="sinkron"
            eyebrow="Pusat bahan bangunan · sinkron"
            title="Sinkronisasi berkelanjutan"
            description="MesinPOS adalah sumber utama; platform menerima salinan dan hanya mengirim pesanan. Pembagian itu menghapus konflik harga/stok dan loop event tanpa perlu aturan last-write-wins."
          >
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Data</th>
                    <th className="px-3 py-2">Arah</th>
                    <th className="px-3 py-2">Cara tarik</th>
                    <th className="px-3 py-2">Event realtime</th>
                  </tr>
                </thead>
                <tbody>
                  {SYNC_DOC.ownership.map((row) => (
                    <tr key={row.entity} className="border-t border-border/60 align-top">
                      <td className="px-3 py-2 font-medium">{row.entity}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{row.direction}</td>
                      <td className="px-3 py-2 font-mono text-[11px]">{row.pull}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                        {row.event}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ol className="space-y-3">
              {SYNC_DOC.steps.map((step) => (
                <li key={step.title} className="rounded-lg border border-border/60 bg-card p-4">
                  <div className="text-sm font-semibold">{step.title}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>

            <ul className="space-y-2 rounded-lg border border-border/60 p-4 text-sm text-muted-foreground">
              {SYNC_DOC.rules.map((rule) => (
                <li key={rule} className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            id="galat"
            eyebrow="Penanganan galat"
            title="Kode status & artinya"
            description={`Galat selalu berbentuk JSON { ok: false, error: "pesan" } — pesannya sudah ditulis untuk dibaca operator, bukan kode internal.`}
          >
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Arti</th>
                    <th className="px-3 py-2">Penyebab yang biasa</th>
                  </tr>
                </thead>
                <tbody>
                  {API_DOC_ERRORS.map((row) => (
                    <tr key={row.status} className="border-t border-border/60 align-top">
                      <td className="px-3 py-2 font-mono text-xs">
                        <Badge variant={row.status < 300 ? "default" : row.status < 500 ? "accent" : "outline"}>
                          {row.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-medium">{row.meaning}</td>
                      <td className="px-3 py-2">
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {row.causes.map((cause) => (
                            <li key={cause}>• {cause}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent" />
              <p>
                Kirim ulang <strong>hanya</strong> untuk 5xx/jaringan putus. Untuk 409,
                memperbaiki keadaannya dulu (stok, modul, limit kredit) — mengulang permintaan
                yang sama akan ditolak lagi.
              </p>
            </div>
          </Section>

          <Section
            id="batas"
            eyebrow="Batas yang berlaku"
            title="Batas & kuota v1"
            description="Angka di bawah ini adalah batas yang ditegakkan server, bukan anjuran."
          >
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Hal</th>
                    <th className="px-3 py-2">Nilai</th>
                    <th className="px-3 py-2">Catatan</th>
                  </tr>
                </thead>
                <tbody>
                  {API_DOC_LIMITS.map((row) => (
                    <tr key={row.label} className="border-t border-border/60">
                      <td className="px-3 py-2 font-mono text-xs">{row.label}</td>
                      <td className="px-3 py-2 font-medium">{row.value}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            id="integrasi"
            eyebrow="pusatbahanbangunan.com"
            title="Rencana integrasi ke platform pusat"
            description="Urutan yang disarankan agar katalog, pesanan, dan pembukuan tetap satu sumber: MesinPOS menghitung, platform menampilkan."
          >
            <div className="space-y-3">
              {API_DOC_INTEGRATION_STEPS.map((step) => (
                <div key={step.title} className="rounded-lg border border-border/60 bg-card p-4">
                  <div className="text-sm font-semibold">{step.title}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                </div>
              ))}
            </div>
            <CodeBlock
              label="Pesanan contoh dari platform"
              code={`curl -X POST "${baseUrl}/api/v1/sales" \\
  -H "Authorization: Bearer mp_XXXXXXXXXX_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(SAMPLE_ORDER_BODY, null, 2)}'`}
            />
            <div className="rounded-lg border border-border/60 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="size-4 text-accent" />
                Belum tersedia lewat API v1
              </div>
              <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                {API_DOC_NOT_YET.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Kebutuhan yang belum ada di daftar ini sebaiknya dibicarakan dulu sebelum
                dibangun di sisi platform — supaya tidak ada dua sumber kebenaran untuk stok
                dan omzet.
              </p>
            </div>
          </Section>

          <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background to-accent/10 p-8 text-center">
            <h2 className="text-2xl font-bold tracking-tight">Siap menghubungkan platform?</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
              Buat kunci API di workspace MesinPOS Anda, lalu mulai dari{" "}
              <code className="font-mono text-xs">GET /api/v1/ping</code>. Untuk kebutuhan
              integrasi khusus pusatbahanbangunan.com, siapkan satu workspace per merchant agar
              data dan izin tidak tercampur.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button asChild>
                <Link to="/app/api">Buka halaman API &amp; Webhook</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/auth?returnTo=/onboarding">Buat workspace</Link>
              </Button>
            </div>
          </div>
        </main>
      </div>

      <footer className="border-t border-border/60 bg-secondary/20">
        <div className="container flex flex-col items-center justify-between gap-3 py-8 text-xs text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} MesinPOS · Dokumentasi API {API_DOC_VERSION}</span>
          <span className="flex flex-wrap items-center gap-4">
            <Link to="/" className="hover:text-foreground">
              Beranda
            </Link>
            <a href="#mulai" className="hover:text-foreground">
              Mulai cepat
            </a>
            <Link to="/app/api" className="hover:text-foreground">
              API &amp; Webhook
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

function Section({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-5">
      <div>
        <div className="text-xs font-semibold uppercase tracking-widest text-primary">
          {eyebrow}
        </div>
        <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Feature({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof KeyRound;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-border/60 bg-card p-4">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-1 text-xs text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function EndpointCard({ endpoint }: { endpoint: ApiDocEndpoint }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-md px-2 py-0.5 font-mono text-[11px] font-bold",
              endpoint.method === "GET"
                ? "bg-primary/15 text-primary"
                : "bg-accent/20 text-accent",
            )}
          >
            {endpoint.method}
          </span>
          <code className="break-all font-mono text-sm">{endpoint.path}</code>
          <Badge variant={endpoint.scope ? "outline" : "secondary"}>
            {endpoint.scope ? endpoint.scopeLabel : "Cukup kunci sah"}
          </Badge>
          {endpoint.scope && <Badge variant="secondary" className="font-mono text-[10px]">{endpoint.scope}</Badge>}
        </div>
        <CardTitle className="pt-1 text-base">{endpoint.title}</CardTitle>
        <CardDescription>{endpoint.summary}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {endpoint.parameters.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Parameter query
            </div>
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <tbody>
                  {endpoint.parameters.map((parameter) => (
                    <tr key={parameter.name} className="border-t border-border/60 first:border-t-0">
                      <td className="px-3 py-2 font-mono text-xs">{parameter.name}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                        {parameter.example}
                      </td>
                      <td className="px-3 py-2 text-xs">{parameter.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Field balasan
          </div>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <tbody>
                {endpoint.fields.map((field) => (
                  <tr key={field.name} className="border-t border-border/60 first:border-t-0">
                    <td className="px-3 py-2 font-mono text-xs">{field.name}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {field.type}
                    </td>
                    <td className="px-3 py-2 text-xs">{field.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {endpoint.requestExample && (
          <CodeBlock label="Permintaan" code={endpoint.requestExample} />
        )}
        <CodeBlock label="Balasan sukses" code={endpoint.responseExample} />

        <ul className="space-y-2 text-xs text-muted-foreground">
          {endpoint.notes.map((note) => (
            <li key={note} className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Peramban tanpa izin clipboard: nilainya tetap terlihat & bisa disalin manual.
    }
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={copy} className="gap-1.5">
      {copied ? <Check /> : <Copy />}
      {copied ? "Tersalin" : label}
    </Button>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/70">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-secondary/40 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <CopyButton value={code} label="Salin" />
      </div>
      <pre className="overflow-x-auto bg-secondary/10 p-3 text-xs leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

/**
 * Kartu **kategori utama bisnis** di halaman Profil.
 *
 * Pemilik memilih kategori utama beserta subkategorinya **sekali**; setelah
 * tersimpan, MesinPOS mengunci pasangan itu permanen (lihat
 * `tenants.setBusinessCategory`). Karena itu kartunya punya dua wajah:
 *
 *  - belum dipilih → dua pemilih (kategori & subkategori) + tombol kunci, hanya
 *    untuk pemilik. Peran lain membaca keterangan bahwa pilihan itu milik pemilik;
 *  - sudah terkunci → nilai yang tersimpan, tanggal penguncian, dan penjelasan
 *    bahwa tidak ada tombol ubah — bukan formulir yang diam-diam menolak.
 *
 * Aturan taksonomi & penguncian tidak disalin di sini: semuanya datang dari
 * `@/lib/businessCategory`, modul yang sama dengan server dan kedua store.
 */
import { useEffect, useState } from "react";
import { Lock, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { useStore } from "@/lib/store";
import { useRole } from "@/lib/usePermission";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Tanggal penguncian ditulis apa adanya; `0` = baris lama tanpa waktu kunci. */
function tanggalKunci(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function BusinessCategoryCard() {
  const { businessCategory, setBusinessCategory, businessCategories } = useStore();
  const role = useRole();
  // Server memeriksa hal yang sama: hanya pemilik yang boleh mengunci pilihan.
  const canPick = role === "owner";

  const [categoryDraft, setCategoryDraft] = useState("");
  const [subcategoryDraft, setSubcategoryDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Katalog aktif dari store: kategori/subkategori yang dinonaktifkan backstage
  // tidak pernah ditawarkan di sini, sama seperti onboarding.
  const kategoriDraft =
    businessCategories.find((row) => row.key === categoryDraft) ?? null;

  useEffect(() => {
    // Nilai terkunci bisa datang dari perangkat lain (mode Convex); draft lama
    // dibersihkan supaya tidak tampak sebagai pilihan yang masih bisa disimpan.
    if (businessCategory) {
      setCategoryDraft("");
      setSubcategoryDraft("");
    }
  }, [businessCategory]);

  async function kunci() {
    if (!kategoriDraft || !subcategoryDraft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await setBusinessCategory({
        category: kategoriDraft.key,
        subcategory: subcategoryDraft,
      });
      /*
        Pilihan bisnis juga menyemai **master kategori & subkategori produk**
        (lihat halaman Produk & Stok). Kalau server/demo mengabarkannya, kalimat
        itu ikut ditampilkan — pemilik langsung tahu katalog produknya sudah
        menyesuaikan tanpa harus mencari sendiri.
      */
      setNotice(
        result.productCatalogSentence
          ? `${result.sentence} ${result.productCatalogSentence}`
          : result.sentence,
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="profil-kategori-utama">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Tag className="size-4 text-primary" />
              Kategori utama bisnis
            </CardTitle>
            <CardDescription className="mt-1">
              Kategori &amp; subkategori yang menjelaskan bisnis Anda di seluruh
              MesinPOS. Dipilih sekali oleh pemilik, lalu dikunci permanen.
            </CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0" data-testid="profil-kategori-lencana">
            {businessCategory ? "Terkunci permanen" : "Belum dipilih"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {businessCategory ? (
          <div
            data-testid="profil-kategori-terkunci"
            className="rounded-lg border border-border/60 bg-secondary/30 p-4"
          >
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Lock className="size-4 text-primary" />
              Terkunci permanen
            </div>
            <dl className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Kategori utama
                </dt>
                <dd
                  data-testid="profil-kategori-nilai"
                  className="mt-0.5 truncate text-sm font-medium"
                >
                  {businessCategory.categoryLabel}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Subkategori
                </dt>
                <dd
                  data-testid="profil-subkategori-nilai"
                  className="mt-0.5 truncate text-sm font-medium"
                >
                  {businessCategory.subcategoryLabel}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Dikunci sejak
                </dt>
                <dd
                  data-testid="profil-kategori-tanggal"
                  className="mt-0.5 truncate text-sm font-medium"
                >
                  {tanggalKunci(businessCategory.lockedAt)}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              MesinPOS tidak menyediakan tombol ubah atau hapus untuk pilihan ini —
              termasuk bagi pemilik — karena ia menjadi identitas bisnis Anda di
              seluruh sistem.
            </p>
          </div>
        ) : canPick ? (
          <>
            <p className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-xs text-muted-foreground">
              Pilihan ini <strong className="text-foreground">permanen</strong>:
              setelah dikunci, kategori dan subkategorinya tidak bisa diubah atau
              dikosongkan lagi, termasuk oleh pemilik.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs text-muted-foreground">
                Kategori utama
                <select
                  data-testid="profil-kategori-pilih"
                  className="w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground"
                  value={categoryDraft}
                  onChange={(event) => {
                    setCategoryDraft(event.target.value);
                    // Subkategori selalu milik kategorinya; pasangan lama tidak
                    // boleh tertinggal dan ikut terkunci tanpa dibaca.
                    setSubcategoryDraft("");
                  }}
                >
                  <option value="">Pilih kategori utama…</option>
                  {businessCategories.map((row) => (
                    <option key={row.key} value={row.key}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 text-xs text-muted-foreground">
                Subkategori
                <select
                  data-testid="profil-subkategori-pilih"
                  className="w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground disabled:opacity-60"
                  value={subcategoryDraft}
                  disabled={!kategoriDraft}
                  onChange={(event) => setSubcategoryDraft(event.target.value)}
                >
                  <option value="">Pilih subkategori…</option>
                  {(kategoriDraft?.subcategories ?? []).map((row) => (
                    <option key={row.key} value={row.key}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                data-testid="simpan-kategori-utama"
                disabled={busy || !kategoriDraft || !subcategoryDraft}
                onClick={() => void kunci()}
                className="gap-2"
              >
                <Lock className="size-4" />
                {busy ? "Mengunci…" : "Kunci kategori utama"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Pilih kategori dan subkategori lebih dulu.
              </span>
            </div>
          </>
        ) : (
          <p
            data-testid="profil-kategori-baca-saja"
            className="rounded-lg border border-border/60 bg-secondary/30 px-4 py-3 text-xs text-muted-foreground"
          >
            Kategori utama bisnis belum dipilih. Hanya{" "}
            <strong className="text-foreground">pemilik bisnis</strong> yang boleh
            memilihnya, karena pilihan itu langsung dikunci permanen. Server tetap
            menolak perubahan yang dipaksakan dari luar halaman ini.
          </p>
        )}

        {error && (
          <p
            role="alert"
            data-testid="profil-kategori-galat"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {notice && (
          <p data-testid="profil-kategori-notis" className="text-xs text-muted-foreground">
            {notice}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

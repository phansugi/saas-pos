/**
 * Backstage: kartu **kategori & subkategori bisnis** (`/platform`).
 *
 * Hanya pemilik developer platform yang melihat kartu ini, dan hanya setelah
 * gerbang server (`platform.me`) menerimanya — komponennya sendiri tidak
 * memutuskan siapa yang boleh masuk. Semua aksi dikirim apa adanya ke
 * `platformCategories.apply`, yang memeriksa ulang akun platform di server dan
 * menjalankan pagar-pagar katalog (minimal satu kategori aktif; kategori aktif
 * wajib punya subkategori aktif).
 *
 * Yang penting bagi pemilik platform untuk tahu, dan karena itu ditulis di
 * kartunya: mengubah taksonomi **tidak** menulis ulang pilihan yang sudah
 * dikunci workspace. Ganti nama/hapus hanya memengaruhi pilihan baru — bisnis
 * yang sudah berdiri tetap memegang salinan labelnya.
 */
import { useState } from "react";
import { useConvex, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorNotice } from "@/components/ErrorNotice";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Directory = NonNullable<
  FunctionReturnType<typeof api.platformCategories.list>
>;
type CategoryRow = Directory["categories"][number];
type SubRow = CategoryRow["subcategories"][number];

type Action =
  | { type: "createCategory"; label: string }
  | { type: "renameCategory"; key: string; label: string }
  | { type: "setCategoryActive"; key: string; active: boolean }
  | { type: "removeCategory"; key: string }
  | { type: "createSubcategory"; categoryKey: string; label: string }
  | { type: "renameSubcategory"; categoryKey: string; key: string; label: string }
  | {
      type: "setSubcategoryActive";
      categoryKey: string;
      key: string;
      active: boolean;
    }
  | { type: "removeSubcategory"; categoryKey: string; key: string };

export function PlatformBusinessCategoriesCard({
  actorId,
}: {
  actorId: Id<"users">;
}) {
  const convex = useConvex();
  const directory = useQuery(api.platformCategories.list, { actorId });

  const [busy, setBusy] = useState(false);
  /** Galat terakhir dari server — disimpan utuh supaya detail teknisnya bisa dibuka. */
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Kunci baris yang sedang diubah namanya + draft-nya. */
  const [editing, setEditing] = useState<{ key: string; label: string } | null>(null);
  const [subDraft, setSubDraft] = useState<{ categoryKey: string; label: string } | null>(
    null,
  );

  async function run(action: Action) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await convex.mutation(api.platformCategories.apply, {
        actorId,
        action,
      });
      setNotice(result.sentence);
      setEditing(null);
      setSubDraft(null);
      setNewCategory("");
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  function tombolUbahNama(key: string, label: string) {
    setEditing({ key, label });
    setError(null);
    setNotice(null);
  }

  function barisUbahNama(key: string, simpan: () => Promise<void>) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          data-testid={`kategori-nama-${key}`}
          value={editing?.label ?? ""}
          onChange={(event) =>
            setEditing((current) =>
              current ? { ...current, label: event.target.value } : current,
            )
          }
          className="h-8 max-w-xs"
          aria-label="Nama baru"
        />
        <Button
          size="sm"
          disabled={busy || (editing?.label ?? "").trim().length === 0}
          onClick={() => void simpan()}
          data-testid={`kategori-nama-simpan-${key}`}
        >
          Simpan nama
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
          Batal
        </Button>
      </div>
    );
  }

  function aksiBaris(row: { key: string; label: string; active: boolean }, sub: boolean) {
    const categoryKey = expanded ?? "";
    return (
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          data-testid={`ubah-nama-${sub ? "sub" : "kategori"}-${row.key}`}
          onClick={() => tombolUbahNama(row.key, row.label)}
        >
          <Pencil className="size-3.5" />
          Ubah nama
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          data-testid={`${row.active ? "nonaktifkan" : "aktifkan"}-${sub ? "sub" : "kategori"}-${row.key}`}
          onClick={() =>
            void run(
              sub
                ? {
                    type: "setSubcategoryActive",
                    categoryKey,
                    key: row.key,
                    active: !row.active,
                  }
                : { type: "setCategoryActive", key: row.key, active: !row.active },
            )
          }
        >
          {row.active ? <Ban className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
          {row.active ? "Nonaktifkan" : "Aktifkan"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          data-testid={`hapus-${sub ? "sub" : "kategori"}-${row.key}`}
          onClick={() =>
            void run(
              sub
                ? { type: "removeSubcategory", categoryKey, key: row.key }
                : { type: "removeCategory", key: row.key },
            )
          }
        >
          <Trash2 className="size-3.5" />
          Hapus
        </Button>
      </div>
    );
  }

  function barisUbahNamaSub(categoryKey: string, sub: SubRow) {
    return barisUbahNama(sub.key, async () => {
      await run({
        type: "renameSubcategory",
        categoryKey,
        key: sub.key,
        label: editing?.label ?? "",
      });
    });
  }

  return (
    <Card data-testid="platform-kategori-bisnis">
      <CardHeader>
        <CardTitle className="text-base">3. Kategori &amp; subkategori bisnis</CardTitle>
        <CardDescription className="mt-1">
          Taksonomi yang dipilih pemilik saat mendaftar. Anda bisa membuat, mengubah
          nama, mengaktifkan/menonaktifkan, dan menghapusnya; kategori nonaktif tidak
          ditawarkan lagi, sedangkan workspace yang sudah mengunci pilihannya tidak
          ikut berubah (label tersimpan di baris workspace masing-masing).
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {directory && (
          <p
            data-testid="platform-kategori-catatan"
            className="rounded-lg border border-border/60 bg-secondary/30 px-4 py-3 text-xs text-muted-foreground"
          >
            {directory.note} {directory.categories.length} kategori ·{" "}
            {directory.activeOptions} siap dipilih ·{" "}
            {directory.seeded ? "tersimpan di database" : "masih bawaan kode"}.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1 space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="platform-kategori-baru">
              Kategori utama baru
            </label>
            <Input
              id="platform-kategori-baru"
              data-testid="platform-kategori-baru"
              value={newCategory}
              placeholder="mis. Otomotif"
              onChange={(event) => setNewCategory(event.target.value)}
            />
          </div>
          <Button
            disabled={busy || newCategory.trim().length === 0}
            data-testid="platform-kategori-tambah"
            onClick={() => void run({ type: "createCategory", label: newCategory })}
          >
            <Plus className="size-4" />
            Tambah kategori
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Kategori baru dibuat <strong>nonaktif</strong>: tambahkan minimal satu
          subkategori dulu, baru aktifkan — supaya pemilih tidak pernah melihat kategori
          kosong.
        </p>

        <div className="space-y-2">
          {(directory?.categories ?? []).map((row: CategoryRow) => {
            const terbuka = expanded === row.key;
            const draftSub = subDraft?.categoryKey === row.key ? subDraft : null;
            return (
              <div
                key={row.key}
                data-testid={`platform-kategori-baris-${row.key}`}
                className="rounded-lg border border-border/60"
              >
                <div className="flex flex-wrap items-start justify-between gap-2 p-3">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-2 text-left"
                    data-testid={`platform-kategori-buka-${row.key}`}
                    onClick={() => setExpanded(terbuka ? null : row.key)}
                  >
                    {terbuka ? (
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {row.label}
                      </span>
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {row.key} · {row.subcategories.length} subkategori
                      </span>
                    </span>
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={row.active ? "accent" : "outline"}
                      data-testid={`platform-kategori-status-${row.key}`}
                    >
                      {row.active ? "Aktif" : "Nonaktif"}
                    </Badge>
                    {aksiBaris(row, false)}
                  </div>
                </div>

                {editing?.key === row.key && !expanded && (
                  <div className="px-3 pb-3">
                    {barisUbahNama(row.key, async () => {
                      await run({
                        type: "renameCategory",
                        key: row.key,
                        label: editing?.label ?? "",
                      });
                    })}
                  </div>
                )}

                {terbuka && (
                  <div className="space-y-2 border-t border-border/60 p-3">
                    {editing?.key === row.key && (
                      <div>
                        {barisUbahNama(row.key, async () => {
                          await run({
                            type: "renameCategory",
                            key: row.key,
                            label: editing?.label ?? "",
                          });
                        })}
                      </div>
                    )}

                    {row.subcategories.map((sub: SubRow) => (
                      <div
                        key={sub.key}
                        data-testid={`platform-sub-baris-${sub.key}`}
                        className="rounded-md border border-border/50 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block truncate text-sm">{sub.label}</span>
                            <span className="block font-mono text-[11px] text-muted-foreground">
                              {sub.key}
                            </span>
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={sub.active ? "accent" : "outline"}
                              data-testid={`platform-sub-status-${sub.key}`}
                            >
                              {sub.active ? "Aktif" : "Nonaktif"}
                            </Badge>
                            {aksiBaris(sub, true)}
                          </div>
                        </div>
                        {editing?.key === sub.key && barisUbahNamaSub(row.key, sub)}
                      </div>
                    ))}

                    {row.subcategories.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Belum ada subkategori. Kategori ini belum bisa diaktifkan.
                      </p>
                    )}

                    <div className="flex flex-wrap items-end gap-2 pt-1">
                      <div className="min-w-48 flex-1 space-y-1.5">
                        <label
                          className="text-xs text-muted-foreground"
                          htmlFor={`platform-sub-baru-${row.key}`}
                        >
                          Subkategori baru di “{row.label}”
                        </label>
                        <Input
                          id={`platform-sub-baru-${row.key}`}
                          data-testid={`platform-sub-baru-${row.key}`}
                          value={draftSub?.label ?? ""}
                          placeholder="mis. Bengkel Motor"
                          onChange={(event) =>
                            setSubDraft({ categoryKey: row.key, label: event.target.value })
                          }
                        />
                      </div>
                      <Button
                        disabled={busy || !draftSub || draftSub.label.trim().length === 0}
                        data-testid={`platform-sub-tambah-${row.key}`}
                        onClick={() =>
                          void run({
                            type: "createSubcategory",
                            categoryKey: row.key,
                            label: draftSub?.label ?? "",
                          })
                        }
                      >
                        <Plus className="size-4" />
                        Tambah subkategori
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <ErrorNotice
          error={error}
          testId="platform-kategori-galat"
          hint="Katalog kategori dipakai bersama seluruh deployment; tidak ada yang berubah selama perubahan ditolak."
        />
        {notice && (
          <p data-testid="platform-kategori-notis" className="text-xs text-muted-foreground">
            {notice}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

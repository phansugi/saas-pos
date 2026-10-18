import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, IdCard, Lock, Percent, Save, UserPlus } from "lucide-react";
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
import { MAX_DISCOUNT_PCT, describeMember, suggestMemberCode } from "@/lib/loyalty";
import { useStore } from "@/lib/store";
import { featureUnavailableReason } from "@/lib/store/modules";
import { useSession } from "@/lib/session";
import { useCan } from "@/lib/usePermission";
import { cn, formatIDR } from "@/lib/utils";

/**
 * Member & Diskon (`member.discount`) — modul UMKM, Phase 2.
 *
 * Halaman ini menetapkan **siapa** yang mendapat diskon dan **berapa besar** —
 * dua hal yang tidak boleh diputuskan di meja kasir. Kasir memakai diskonnya di
 * POS (`memberId` dikirim ke `pos.createSale`, persentasenya diambil server dari
 * data di sini), sedangkan halaman ini butuh izin `member.manage`.
 *
 * Membaca daftar tidak butuh modul UMKM aktif: mematikan modul berarti berhenti
 * memberi diskon baru, bukan menghapus data member. Yang butuh modul adalah
 * diskon > 0, dan itu dijelaskan di layar.
 */
export function MembersPage() {
  const { members, createMember, updateMember, modules } = useStore();
  const { session } = useSession();
  const can = useCan();

  const canManage = can("member.manage");
  const planKey = session?.tenant?.planKey ?? "starter";
  // Alasan yang tepat (modul mati vs paket tidak memuat) supaya petunjuknya bisa
  // ditindaklanjuti — tenant Starter sudah punya modul UMKM, yang kurang paketnya.
  const discountUnavailable = featureUnavailableReason(
    planKey,
    modules.activeVerticals,
    "member.discount",
  );
  const discountModuleOn = discountUnavailable === null;

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: "", code: "", phone: "", discountPct: "5" });

  const stats = useMemo(() => {
    const active = members.filter((m) => m.active);
    const withDiscount = active.filter((m) => m.discountPct > 0);
    const highest = members.reduce((max, m) => Math.max(max, m.discountPct), 0);
    return { active: active.length, withDiscount: withDiscount.length, highest };
  }, [members]);

  function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    action()
      .then(() => setNotice(message))
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setBusy(false));
  }

  async function addMember() {
    const pct = Number(form.discountPct) || 0;
    if (busy) return;
    if (!discountModuleOn && pct > 0) {
      setError(
        `${discountUnavailable ?? "Diskon member belum bisa dipakai."} Simpan member tanpa diskon dulu, atau rapikan paketnya.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createMember({
        name: form.name,
        code: form.code.trim() || undefined,
        phone: form.phone.trim() || undefined,
        discountPct: pct,
      });
      setForm({ name: "", code: "", phone: "", discountPct: form.discountPct });
      setNotice(`Member ${created.code} ditambahkan.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-primary/12 text-primary">
            <IdCard className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Member &amp; Diskon</h2>
            <p className="text-sm text-muted-foreground">
              Modul UMKM · {members.length} member · {stats.withDiscount} dengan diskon
            </p>
          </div>
        </div>
        {discountUnavailable && (
          <Badge variant="outline" className="gap-1.5 py-1">
            <Lock className="size-3" />
            Diskon member tidak berlaku
          </Badge>
        )}
      </header>

      {discountUnavailable && (
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          {discountUnavailable} Halaman ini hanya bisa dibaca: daftar member tetap
          terlihat, tetapi menambah, mengubah, atau merapikannya tidak bisa dari
          sini sampai langganannya memuat modul itu.{" "}
          {can("billing.manage") && (
            <Link to="/app/modules" className="underline">
              Kelola modul &amp; paket
            </Link>
          )}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          {notice}
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Member aktif", value: String(stats.active), hint: `dari ${members.length} member` },
          { label: "Dengan diskon", value: String(stats.withDiscount), hint: "berlaku di kasir" },
          {
            label: "Diskon terbesar",
            value: `${stats.highest}%`,
            hint: `batas sistem ${MAX_DISCOUNT_PCT}%`,
          },
        ].map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="font-mono text-xl">{card.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">{card.hint}</CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Daftar member</CardTitle>
          <CardDescription>
            Diskon dihitung dari data ini setiap kali kasir memilih member —
            angkanya tidak bisa diketik ulang di POS.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Kode</th>
                  <th className="px-2 py-2">Nama</th>
                  <th className="px-2 py-2">Telepon</th>
                  <th className="px-2 py-2">Diskon</th>
                  <th className="px-2 py-2">Status</th>
                  {canManage && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const draft = drafts[member.id] ?? String(member.discountPct);
                  const changed = draft !== String(member.discountPct);
                  return (
                    <tr key={member.id} className="border-t border-border/60">
                      <td className="px-2 py-2 font-mono text-xs">{member.code}</td>
                      <td className="px-2 py-2">{member.name}</td>
                      <td className="px-2 py-2 font-mono text-xs text-muted-foreground">
                        {member.phone ?? "—"}
                      </td>
                      <td className="px-2 py-2">
                        {canManage ? (
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              min={0}
                              max={MAX_DISCOUNT_PCT}
                              value={draft}
                              aria-label={`Diskon ${member.name}`}
                              onChange={(e) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [member.id]: e.target.value,
                                }))
                              }
                              className="h-8 w-20 text-right font-mono"
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                            <Button
                              size="sm"
                              variant={changed ? "default" : "ghost"}
                              disabled={busy || !changed}
                              title={changed ? "Simpan diskon" : "Belum ada perubahan"}
                              onClick={() =>
                                run(async () => {
                                  await updateMember({
                                    memberId: member.id,
                                    discountPct: Number(draft) || 0,
                                  });
                                  setDrafts((current) => {
                                    const next = { ...current };
                                    delete next[member.id];
                                    return next;
                                  });
                                }, `Diskon ${member.name} diperbarui.`)
                              }
                            >
                              <Save />
                            </Button>
                          </div>
                        ) : (
                          <span className="font-mono text-xs">
                            {describeMember(member)}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant={member.active ? "default" : "outline"}>
                          {member.active ? "aktif" : "nonaktif"}
                        </Badge>
                      </td>
                      {canManage && (
                        <td className="px-2 py-2 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              run(
                                () =>
                                  updateMember({
                                    memberId: member.id,
                                    active: !member.active,
                                  }),
                                member.active
                                  ? `${member.name} dinonaktifkan — diskonnya berhenti berlaku.`
                                  : `${member.name} diaktifkan kembali.`,
                              )
                            }
                          >
                            {member.active ? "Nonaktifkan" : "Aktifkan"}
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {members.length === 0 && (
                  <tr>
                    <td
                      colSpan={canManage ? 6 : 5}
                      className="px-2 py-4 text-center text-sm text-muted-foreground"
                    >
                      Belum ada member.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canManage && (
            <div className="mt-5 rounded-lg border border-border/60 bg-secondary/20 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <UserPlus className="size-4" />
                Tambah member
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <label className="text-xs text-muted-foreground md:col-span-2">
                  Nama
                  <Input
                    className="mt-1"
                    value={form.name}
                    placeholder="Bu Sari Wulandari"
                    onChange={(e) => {
                      const name = e.target.value;
                      setForm((current) => ({
                        ...current,
                        name,
                        code:
                          current.code === ""
                            ? suggestMemberCode(name, members.map((m) => m.code))
                            : current.code,
                      }));
                    }}
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Kode
                  <Input
                    className="mt-1 font-mono"
                    value={form.code}
                    placeholder="BSW"
                    onChange={(e) => setForm((c) => ({ ...c, code: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Telepon (opsional)
                  <Input
                    className="mt-1"
                    value={form.phone}
                    placeholder="0812…"
                    onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Diskon (%)
                  <Input
                    className="mt-1 font-mono"
                    type="number"
                    min={0}
                    max={MAX_DISCOUNT_PCT}
                    value={form.discountPct}
                    onChange={(e) => setForm((c) => ({ ...c, discountPct: e.target.value }))}
                  />
                </label>
                <div className="flex items-start md:col-span-3">
                  <Button
                    className="mt-auto w-full md:w-auto"
                    disabled={busy || form.name.trim().length < 2}
                    onClick={() => void addMember()}
                  >
                    <Percent />
                    Simpan member
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Diskon &gt; 0% butuh modul UMKM aktif; menyimpan member tanpa diskon
                selalu boleh.
              </p>
            </div>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            Total diskon satu transaksi tidak pernah melebihi subtotal
            {stats.highest > 0
              ? ` — mis. belanja ${formatIDR(100_000)} dengan diskon ${stats.highest}% menjadi ${formatIDR(100_000 - Math.round((100_000 * stats.highest) / 100))} sebelum PPN.`
              : "."}
          </p>
        </CardContent>
      </Card>

      {!canManage && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="size-3.5" />
          Kasir memakai diskon yang sudah ditetapkan di sini; mengubahnya butuh
          peran manajer/pemilik.
        </p>
      )}

      <p className={cn("text-xs text-muted-foreground", !discountModuleOn && "text-accent")}>
        Member nonaktif tidak pernah mendapat diskon: barisnya tetap ada untuk
        riwayat, tetapi kasir tidak bisa memilihnya.
      </p>
    </div>
  );
}

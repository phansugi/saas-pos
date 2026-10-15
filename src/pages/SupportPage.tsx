import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Headset,
  LifeBuoy,
  Lock,
  MessageSquarePlus,
  Send,
  Sparkles,
  Timer,
  Undo2,
  UserCheck,
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
import { Label } from "@/components/ui/label";
import {
  DEDICATED_PRIORITIES,
  SUPPORT_CATEGORY_KEYS,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITY_KEYS,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_SLA_LABELS,
  SUPPORT_STATUS_LABELS,
  responseHoursFor,
  type SupportCategory,
  type SupportPriority,
  type SupportSlaState,
} from "@/lib/support";
import { useSession } from "@/lib/session";
import { useStore } from "@/lib/store";
import { useCan } from "@/lib/usePermission";
import { cn } from "@/lib/utils";

/**
 * Dukungan khusus (`support.dedicated`, Phase 5 / Dukungan khusus & skala
 * franchise).
 *
 * Halaman ini adalah satu-satunya tempat tenant berbicara dengan tim dukungan
 * lewat sistem, dan itu membuat janji tanggapnya jadi **terukur**: setiap tiket
 * menyimpan jam tanggap yang berlaku saat ia dibuat, lalu halaman menampilkan
 * sisa waktunya apa adanya — termasuk saat janjinya sudah lewat.
 *
 * Gerbangnya mengikuti aturan yang sama dengan server: **prioritas Tinggi &
 * Mendesak** (jalur tanggap cepat) dan **eskalasi ke manajer akun** butuh fitur
 * `support.dedicated`; **membuka tiket Normal/Rendah**, **menambah catatan**,
 * **menutup**, dan **membuka ulang** selalu boleh — mematikan jalur cepat tidak
 * boleh mengunci tenant dari tiketnya sendiri.
 */

const SLA_TONE: Record<SupportSlaState, string> = {
  on_track: "border-primary/40 bg-primary/10 text-primary",
  due_soon: "border-accent/50 bg-accent/10 text-accent",
  overdue: "border-destructive/50 bg-destructive/10 text-destructive",
  met: "border-primary/40 bg-primary/10 text-primary",
  missed: "border-destructive/50 bg-destructive/10 text-destructive",
};

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "3 jam lagi" / "lewat 5 jam" — dibaca sebagai janji, bukan angka mentah. */
function describeDue(ticket: {
  resolvedAt: number | null;
  slaHours: number;
  dueAt: number;
  remainingHours: number;
  slaState: SupportSlaState;
}): string {
  if (ticket.resolvedAt !== null) {
    return ticket.slaState === "met"
      ? `Selesai dalam janji ${ticket.slaHours} jam`
      : `Selesai lewat janji ${ticket.slaHours} jam`;
  }
  if (ticket.slaState === "overdue") {
    return `Lewat janji ${ticket.slaHours} jam`;
  }
  return `Sisa ${ticket.remainingHours} jam dari janji ${ticket.slaHours} jam`;
}

export function SupportPage() {
  const {
    supportTickets,
    supportSummary,
    supportPlan,
    supportLimits,
    createSupportTicket,
    actSupportTicket,
  } = useStore();
  const { session } = useSession();
  const can = useCan();
  const planKey = session?.tenant?.planKey ?? "starter";
  const canManage = can("support.manage");
  const canView = can("support.view");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    subject: "",
    category: "bug" as SupportCategory,
    priority: "normal" as SupportPriority,
    body: "",
  });
  /** Keterangan per tiket: catatan, penyelesaian, atau alasan buka ulang. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const submitTicket = async () => {
    await run(async () => {
      const created = await createSupportTicket(form);
      setForm({ subject: "", category: "bug", priority: "normal", body: "" });
      setNotice(`Tiket ${created.number} dibuat dengan janji tanggap ${created.slaHours} jam.`);
    }, "Tiket dibuat.");
  };

  const act = (
    ticketId: string,
    action: "note" | "start" | "resolve" | "reopen" | "escalate",
    label: string,
  ) => {
    const note = drafts[ticketId] ?? "";
    void run(async () => {
      await actSupportTicket({ ticketId, action, note });
      setDrafts((current) => ({ ...current, [ticketId]: "" }));
    }, label);
  };

  const openCount = supportSummary.open + supportSummary.inProgress;

  return (
    <div className="space-y-6">
      {/* ------------------------------- Janji dukungan ---------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Headset className="size-4" />
            Dukungan khusus (Enterprise)
          </CardTitle>
          <CardDescription>
            {supportPlan.channel} · target tanggap dasar{" "}
            {supportPlan.responseHours} jam untuk prioritas Normal, dan tiket
            yang dibuat di sini menyimpan janji tanggapnya sendiri — paket yang
            berubah nanti tidak menulis ulang janji tiket lama.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!supportPlan.dedicated && (
            <p className="flex items-start gap-2 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-sm text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              Paket ini belum memuat jalur dukungan khusus: tiket prioritas
              Normal &amp; Rendah tetap bisa dibuka, tetapi prioritas Tinggi
              &amp; Mendesak dan eskalasi ke manajer akun menunggu paket
              Enterprise.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {SUPPORT_PRIORITY_KEYS.map((priority) => (
              <div
                key={priority}
                className="rounded-lg border border-border/60 bg-secondary/20 px-4 py-3"
              >
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{SUPPORT_PRIORITY_LABELS[priority]}</span>
                  {DEDICATED_PRIORITIES.includes(priority) && (
                    <Badge variant={supportPlan.dedicated ? "accent" : "outline"}>
                      jalur cepat
                    </Badge>
                  )}
                </div>
                <div className="mt-1 font-mono text-lg font-bold">
                  {responseHoursFor(planKey, priority)} jam
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={supportPlan.dedicated ? "accent" : "outline"}>
              <UserCheck className="mr-1 size-3" />
              {supportPlan.dedicated
                ? "Eskalasi ke manajer akun aktif"
                : "Tanpa manajer akun"}
            </Badge>
            <span>
              Maksimal {supportLimits.maxOpenTickets} tiket berjalan dan{" "}
              {supportLimits.maxLog} catatan per tiket.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* --------------------------------- Ringkasan ------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Tiket berjalan",
            value: openCount,
            hint: `${supportSummary.open} baru · ${supportSummary.inProgress} ditangani`,
          },
          {
            label: "Lewat janji",
            value: supportSummary.overdue,
            hint: "perlu dijawab sekarang",
          },
          {
            label: "Segera jatuh tempo",
            value: supportSummary.dueSoon,
            hint: "sisa waktu tinggal seperempat",
          },
          {
            label: "Selesai",
            value: supportSummary.resolved,
            hint: `${supportSummary.escalated} tiket pernah dieskalasi`,
          },
        ].map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-2xl font-bold">{card.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{card.hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {supportSummary.nextDueAt !== null && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Timer className="size-3.5" />
          Tenggat terdekat: {formatClock(supportSummary.nextDueAt)}.
        </p>
      )}

      {(error || notice) && (
        <p
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
            error
              ? "border-destructive/50 bg-destructive/10 text-destructive"
              : "border-primary/40 bg-primary/10 text-primary",
          )}
        >
          {error ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          )}
          {error ?? notice}
        </p>
      )}

      {/* ------------------------------- Buka tiket -------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquarePlus className="size-4" />
            Buka tiket
          </CardTitle>
          <CardDescription>
            Jelaskan apa yang terjadi dan langkah yang sudah dicoba. Nomor tiket
            (`TKT-…`) dan janji tanggapnya ditetapkan server saat tiket dibuat.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canManage ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0" />
              Peran Anda dapat melihat tiket dan status SLA-nya, tetapi membuka
              atau menutup tiket adalah wewenang pemilik/manajer.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-3">
                  <Label htmlFor="support-subject">Subjek</Label>
                  <Input
                    id="support-subject"
                    value={form.subject}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, subject: event.target.value }))
                    }
                    placeholder="Mis. Struk tidak keluar setelah pembayaran QRIS"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="support-category">Kategori</Label>
                  <select
                    id="support-category"
                    value={form.category}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        category: event.target.value as SupportCategory,
                      }))
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {SUPPORT_CATEGORY_KEYS.map((category) => (
                      <option key={category} value={category}>
                        {SUPPORT_CATEGORY_LABELS[category]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="support-priority">Prioritas</Label>
                  <select
                    id="support-priority"
                    value={form.priority}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        priority: event.target.value as SupportPriority,
                      }))
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {SUPPORT_PRIORITY_KEYS.map((priority) => (
                      <option
                        key={priority}
                        value={priority}
                        disabled={
                          !supportPlan.dedicated && DEDICATED_PRIORITIES.includes(priority)
                        }
                      >
                        {SUPPORT_PRIORITY_LABELS[priority]} ·{" "}
                        {responseHoursFor(planKey, priority)} jam
                        {DEDICATED_PRIORITIES.includes(priority) ? " (jalur cepat)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5 sm:col-span-3">
                  <Label htmlFor="support-body">Uraian</Label>
                  <textarea
                    id="support-body"
                    rows={4}
                    value={form.body}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, body: event.target.value }))
                    }
                    placeholder="Kejadian apa yang tampak, kapan, di cabang mana, dan apa yang sudah dicoba."
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </div>
              <Button disabled={busy} onClick={() => void submitTicket()}>
                <Send className="size-4" />
                Kirim tiket
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------- Daftar tiket ------------------------ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <LifeBuoy className="size-4" />
            Tiket tenant ini
          </CardTitle>
          <CardDescription>
            Urut dari yang terbaru. Riwayat tiap tiket append-only: setiap
            catatan dan perubahan status tersimpan beserta waktunya.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canView || supportTickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {canView
                ? "Belum ada tiket. Tiket pertama Anda akan muncul di sini beserta sisa waktu janji tanggapnya."
                : "Daftar tiket hanya terbuka untuk peran dengan izin melihat dukungan."}
            </p>
          ) : (
            supportTickets.map((ticket) => (
              <div
                key={ticket.id}
                className="rounded-lg border border-border/60 bg-secondary/10 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {ticket.number}
                      </span>
                      <Badge
                        variant={
                          ticket.status === "resolved"
                            ? "outline"
                            : ticket.status === "in_progress"
                              ? "default"
                              : "secondary"
                        }
                      >
                        {SUPPORT_STATUS_LABELS[ticket.status]}
                      </Badge>
                      {ticket.escalated && (
                        <Badge variant="accent">
                          <UserCheck className="mr-1 size-3" />
                          dukungan khusus
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 truncate text-sm font-semibold">
                      {ticket.subject}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {SUPPORT_CATEGORY_LABELS[ticket.category]} ·{" "}
                      {SUPPORT_PRIORITY_LABELS[ticket.priority]} · dibuat{" "}
                      {formatClock(ticket.createdAt)}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs",
                      SLA_TONE[ticket.slaState],
                    )}
                  >
                    <Clock className="size-3" />
                    {SUPPORT_SLA_LABELS[ticket.slaState]} · {describeDue(ticket)}
                  </span>
                </div>

                <p className="mt-3 whitespace-pre-line text-sm">{ticket.body}</p>

                <ul className="mt-3 space-y-1.5 border-l border-border/60 pl-3">
                  {ticket.log.map((entry, index) => (
                    <li key={`${ticket.id}-${index}`} className="text-xs">
                      <span className="text-muted-foreground">
                        {formatClock(entry.at)} ·{" "}
                        {entry.kind === "status" ? "status" : "catatan"}
                      </span>{" "}
                      {entry.body}
                    </li>
                  ))}
                </ul>

                {canManage && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Input
                      value={drafts[ticket.id] ?? ""}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [ticket.id]: event.target.value,
                        }))
                      }
                      placeholder="Catatan, keterangan penyelesaian, atau alasan buka ulang…"
                      className="h-9 max-w-md flex-1"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => act(ticket.id, "note", `Catatan pada ${ticket.number} ditambahkan.`)}
                    >
                      Tambah catatan
                    </Button>
                    {ticket.status === "open" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => act(ticket.id, "start", `${ticket.number} mulai ditangani.`)}
                      >
                        Mulai ditangani
                      </Button>
                    )}
                    {ticket.status !== "resolved" && (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => act(ticket.id, "resolve", `${ticket.number} ditutup.`)}
                      >
                        <CheckCircle2 className="size-4" />
                        Selesaikan
                      </Button>
                    )}
                    {ticket.status === "resolved" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => act(ticket.id, "reopen", `${ticket.number} dibuka ulang.`)}
                      >
                        <Undo2 className="size-4" />
                        Buka ulang
                      </Button>
                    )}
                    {!ticket.escalated && ticket.status !== "resolved" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || !supportPlan.dedicated}
                        title={
                          supportPlan.dedicated
                            ? "Teruskan ke manajer akun"
                            : "Eskalasi memerlukan fitur dukungan khusus (Enterprise)"
                        }
                        onClick={() => act(ticket.id, "escalate", `${ticket.number} dieskalasi.`)}
                      >
                        <Sparkles className="size-4" />
                        Eskalasi
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

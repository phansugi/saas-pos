import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Lock,
  MessageCircle,
  Pencil,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  UserCog,
  UserPlus,
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
  PERMISSION_LABELS,
  ROLE_LABELS,
  type Permission,
  type Role,
} from "@/lib/authz";
import {
  describeCustomRole,
  PERMISSION_GROUPS,
  sanitizePermissions,
  validateCustomRole,
} from "@/lib/rbac";
import { actingRole, useSession } from "@/lib/session";
import type { StoreTeamMember } from "@/lib/store";
import {
  assignableRoles,
  inviteDeliverySentence,
  inviteNextStep,
  MEMBER_CHANGE_LABELS,
  normalizePhone,
  resolveTeamInviteForm,
  validateTeamInvite,
  validateTeamMemberEdit,
  waInviteSentence,
  whatsappInviteText,
  whatsappInviteUrl,
} from "@/lib/team";
import { useStore } from "@/lib/store";
import { featureUnavailableReason } from "@/lib/store/modules";
import { useCan } from "@/lib/usePermission";
import { cn } from "@/lib/utils";

/**
 * Tim & Peran (`rbac.custom`, Phase 4 / Enterprise Intelligence).
 *
 * Halaman ini menjawab pertanyaan yang peran bawaan tidak bisa jawab: "staf ini
 * boleh apa saja, tepatnya?". Dua bagiannya saling melengkapi — **Anggota tim**
 * menunjukkan izin efektif tiap orang (peran bawaan atau peran kustom yang
 * berlaku), dan **Peran kustom** tempat izin itu dirancang.
 *
 * Yang sengaja tidak ada di sini: mengurangi izin peran bawaan. Peran bawaan
 * adalah kontrak produk (`lib/authz.ts`); menyesuaikannya untuk satu orang
 * berarti membuat peran kustom dan menugaskannya — itulah kenapa kartu pratinjau
 * menampilkan izin efektif, bukan "peran + tambahan".
 */
export function TeamPage() {
  const {
    customRoles,
    roleSummary,
    teamMembers,
    addTeamMember,
    resendInvite,
    updateTeamMember,
    removeTeamMember,
    recordWaInvite,
    createCustomRole,
    updateCustomRole,
    deleteCustomRole,
    assignCustomRole,
    modules,
    workspacePending,
    error: storeError,
  } = useStore();
  const { session } = useSession();
  const can = useCan();

  const canManage = can("team.manage");
  const planKey = session?.tenant?.planKey ?? "starter";
  // Kalimat alasannya sama dengan server (`featureUnavailableReason`), supaya
  // halaman tidak menawarkan peran yang akan ditolak backend.
  const gateReason = featureUnavailableReason(
    planKey,
    modules.activeVerticals,
    "rbac.custom",
  );

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    permissions: [] as Permission[],
  });

  /**
   * Pratinjau memakai peran **pembuat** (bukan peran pemilik): pagar eskalasi
   * baru terasa kalau manajer yang membuka halaman, dan hasilnya sama persis
   * dengan yang akan dijawab server.
   */
  const preview = useMemo(
    () =>
      validateCustomRole(
        {
          name: form.name,
          description: form.description,
          permissions: form.permissions,
        },
        {
          actingRole: actingRole(session),
          existingNames: customRoles
            .filter((row) => row.id !== editingId)
            .map((row) => row.name),
        },
      ),
    [customRoles, editingId, form, session],
  );

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

  function resetForm() {
    setEditingId(null);
    setForm({ name: "", description: "", permissions: [] });
  }

  function startEdit(roleId: string) {
    const role = customRoles.find((row) => row.id === roleId);
    if (!role) return;
    setEditingId(roleId);
    setForm({
      name: role.name,
      description: role.description ?? "",
      permissions: sanitizePermissions(role.permissions),
    });
    setError(null);
    setNotice(null);
  }

  function togglePermission(permission: Permission) {
    setForm((current) => {
      const selected = current.permissions.includes(permission);
      return {
        ...current,
        permissions: selected
          ? current.permissions.filter((value) => value !== permission)
          : [...current.permissions, permission],
      };
    });
  }

  function submit() {
    if (busy) return;
    if (!preview.ok) {
      setError(preview.reason);
      return;
    }
    const value = preview.value;
    if (editingId) {
      run(
        () =>
          updateCustomRole({
            roleId: editingId,
            name: value.name,
            description: value.description ?? "",
            permissions: value.permissions,
          }),
        `Peran ${value.name} diperbarui.`,
      );
    } else {
      run(async () => {
        await createCustomRole({
          name: value.name,
          description: value.description,
          permissions: value.permissions,
        });
      }, `Peran ${value.name} dibuat.`);
    }
    resetForm();
  }

  const activeRoles = customRoles.filter((role) => role.active);
  const roleOptions = activeRoles;

  // --------------------------- Daftarkan anggota tim ----------------------
  //
  // Satu akun = satu keanggotaan di **workspace ini**. Undangannya diikat ke email,
  // bukan perangkat: orang yang didaftarkan di sini masuk sendiri lewat kode OTP ke
  // email itu, lalu mendarat di workspace ini karena keanggotaannya ada di server.
  // Karena itu emailnya diperiksa dengan aturan yang sama seperti undangan server
  // (`validateTeamInvite`) — email yang tidak bisa menerima kode tidak bisa diundang.
  const acting = actingRole(session);
  const roleChoices = useMemo(() => assignableRoles(acting), [acting]);
  const memberEmails = useMemo(
    () => teamMembers.map((member) => member.email.trim().toLowerCase()),
    [teamMembers],
  );

  const [inviteForm, setInviteForm] = useState({
    email: "",
    name: "",
    phone: "",
    role: "cashier" as Role,
  });
  const invitePreview = useMemo(
    () => validateTeamInvite(inviteForm, { actingRole: acting }),
    [inviteForm, acting],
  );
  const joinExisting =
    invitePreview.ok && memberEmails.includes(invitePreview.value.email);
  // Nomor WhatsApp opsional; kalau diisi harus benar-benar bisa dibuka `wa.me`.
  const invitePhoneCheck = useMemo(
    () => (inviteForm.phone.trim() === "" ? null : normalizePhone(inviteForm.phone)),
    [inviteForm.phone],
  );
  /*
    Satu keputusan untuk tombol, kalimat di bawahnya, dan pagar `submitInvite`.
    `workspacePending` dan `storeError` diperiksa **lebih dulu**: selama identitas
    bisnis pengguna aktif belum pasti (atau workspace-nya memang tidak bisa
    dipakai), mutation-nya belum punya tenant yang bisa dituju dan dijawab store
    dengan “Tenant belum siap…” — jadi tombolnya mati dan alasannya terbaca,
    bukan galat setelah ditekan.
  */
  const inviteGate = resolveTeamInviteForm({
    workspacePending,
    error: storeError,
    preview: invitePreview,
    phoneCheck: invitePhoneCheck,
  });

  /**
   * Kirim ulang email undangan satu anggota.
   *
   * Notisnya sengaja tidak mengklaim “terkirim”: yang dijadwalkan adalah
   * pengirimannya, dan hasil sebenarnya muncul di kolom Undangan (reaktif).
   */
  function resend(member: StoreTeamMember) {
    run(
      () => resendInvite(member.membershipId),
      `Undangan untuk ${member.email} dijadwalkan ulang — hasilnya muncul di kolom Undangan.`,
    );
  }

  function submitInvite() {
    if (busy) return;
    if (!inviteGate.ok) {
      setError(inviteGate.reason);
      return;
    }
    const value = inviteGate.value;
    setBusy(true);
    setError(null);
    setNotice(null);
    addTeamMember({
      email: value.email,
      name: value.name,
      phone: inviteForm.phone,
      role: value.role,
    })
      .then((result) => {
        /*
          Keadaan kirim yang sudah tercatat (mode demo, alamat uji, atau kegagalan)
          disebut apa adanya. Di mode Convex pengirimannya baru **dijadwalkan**
          server saat mutation ini selesai, jadi yang jujur diucapkan adalah
          "sedang dikirim" — hasilnya menyusul di kolom Undangan.
        */
        const kirim =
          result.invite.via || result.invite.error
            ? inviteDeliverySentence(result.invite)
            : "Undangan lewat email sedang dikirim — hasilnya muncul di kolom Undangan.";
        setNotice(
          result.created
            ? `${value.name} terdaftar sebagai ${ROLE_LABELS[value.role]}. ${kirim} ${inviteNextStep(value)}`
            : `${value.email} sudah anggota tim — perannya diperbarui menjadi ${ROLE_LABELS[value.role]}. Undangannya tidak dikirim ulang otomatis; pakai tombol Kirim ulang di kolom Undangan kalau perlu.`,
        );
        setInviteForm({ email: "", name: "", phone: "", role: value.role });
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setBusy(false));
  }

  // ------------------- Ubah, aktif/nonaktif, hapus anggota -----------------
  //
  // Semua perubahan melewati aturan murni `validateTeamMemberEdit` — pagar
  // "pemilik terakhir", "hanya pemilik yang menyentuh peran pemilik", dan
  // "akun sendiri tidak bisa dinonaktifkan" terbaca di sini sebelum dikirim,
  // dan server memutuskan hal yang sama.
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [memberForm, setMemberForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "cashier" as Role,
    active: true,
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const editingMember = editingMemberId
    ? (teamMembers.find((row) => row.membershipId === editingMemberId) ?? null)
    : null;

  /**
   * Anggota yang mewakili **pemakai aktif**, untuk pagar “akun sendiri”.
   *
   * Aturannya sama dengan yang dipakai kedua store: baris dengan email sesi,
   * kalau tidak ada maka pemilik aktif pertama. Tanpa ini pratinjau akan
   * menawarkan penonaktifan akun sendiri yang pasti ditolak server — halaman
   * seharusnya menyebut alasannya lebih dulu, bukan setelah ditekan.
   */
  const actingMembershipId = useMemo(() => {
    const email = (session?.user.email ?? "").trim().toLowerCase();
    const row =
      teamMembers.find(
        (member) => member.email.trim().toLowerCase() === email,
      ) ??
      teamMembers.find((member) => member.role === "owner" && member.active) ??
      null;
    return row?.membershipId ?? null;
  }, [session, teamMembers]);

  /** Peran yang boleh dipilih saat mengubah: peran yang boleh diberikan **atau** peran yang sedang dipakai. */
  const editRoleChoices = useMemo(() => {
    const choices = assignableRoles(acting);
    if (editingMember && !choices.includes(editingMember.role)) {
      return [...choices, editingMember.role];
    }
    return choices;
  }, [acting, editingMember]);

  const memberPreview = useMemo(() => {
    if (!editingMember) return null;
    return validateTeamMemberEdit(
      {
        membershipId: editingMember.membershipId,
        name: editingMember.name,
        email: editingMember.email,
        role: editingMember.role,
        phone: editingMember.phone,
        active: editingMember.active,
      },
      {
        name: memberForm.name,
        email: memberForm.email,
        phone: memberForm.phone,
        role: memberForm.role,
        active: memberForm.active,
      },
      {
        actingRole: acting,
        actorMembershipId: actingMembershipId,
        activeOwners: teamMembers.filter((row) => row.role === "owner" && row.active)
          .length,
        otherEmails: teamMembers
          .filter((row) => row.membershipId !== editingMember.membershipId)
          .map((row) => row.email.trim().toLowerCase()),
      },
    );
  }, [editingMember, memberForm, acting, actingMembershipId, teamMembers]);

  function startEditMember(member: StoreTeamMember) {
    setEditingMemberId(member.membershipId);
    setMemberForm({
      name: member.name,
      email: member.email,
      phone: member.phone ?? "",
      role: member.role,
      active: member.active,
    });
    setConfirmDeleteId(null);
    setError(null);
    setNotice(null);
  }

  function cancelEditMember() {
    setEditingMemberId(null);
    setError(null);
  }

  function submitMemberEdit() {
    if (busy || !editingMember || !memberPreview) return;
    if (!memberPreview.ok) {
      setError(memberPreview.reason);
      return;
    }
    const target = editingMember;
    const changed = memberPreview.changed;
    if (changed.length === 0) {
      setNotice(`Tidak ada perubahan untuk ${target.name}.`);
      setEditingMemberId(null);
      return;
    }
    const labels = changed.map((field) => MEMBER_CHANGE_LABELS[field] ?? field);
    run(async () => {
      await updateTeamMember({
        membershipId: target.membershipId,
        name: memberPreview.value.name,
        email: memberPreview.value.email,
        role: memberPreview.value.role,
        phone: memberPreview.value.phone,
        active: memberPreview.value.active,
      });
      setEditingMemberId(null);
    }, `${memberPreview.value.name}: ${labels.join(", ")} diperbarui.`);
  }

  function toggleActive(member: StoreTeamMember) {
    run(
      () =>
        updateTeamMember({ membershipId: member.membershipId, active: !member.active }),
      member.active
        ? `${member.name} dinonaktifkan — ia tidak bisa memakai workspace ini sampai diaktifkan lagi.`
        : `${member.name} diaktifkan kembali.`,
    );
  }

  function removeMember(member: StoreTeamMember) {
    run(async () => {
      await removeTeamMember(member.membershipId);
      if (editingMemberId === member.membershipId) setEditingMemberId(null);
      setConfirmDeleteId(null);
    }, `${member.name} dihapus dari tim ini. Akunnya sendiri tetap ada — yang hilang hanya aksesnya ke workspace ini.`);
  }

  /**
   * Undangan WhatsApp: buka percakapan `wa.me` dengan pesan sudah terisi, lalu
   * catat bahwa tautannya dibuka.
   *
   * Aplikasi **tidak** bisa memastikan pesannya terkirim — pesannya dikirim dari
   * aplikasi WhatsApp pengundang, dan itulah yang dikatakan kolom WhatsApp.
   * Tautan halaman Masuk dibangun dari alamat halaman yang sedang dibuka.
   */
  function waInvite(member: StoreTeamMember) {
    const tautan = whatsappInviteUrl({
      phone: member.phone ?? "",
      text: whatsappInviteText({
        workspace: session?.tenant?.name ?? "workspace ini",
        email: member.email,
        name: member.name,
        role: member.role,
        invitedBy: session?.user.name,
        loginUrl:
          typeof window === "undefined" ? null : `${window.location.origin}/auth`,
      }),
    });
    if (!tautan.ok) {
      setError(tautan.reason);
      return;
    }
    setError(null);
    // Dibuka lebih dulu, masih di dalam gestur klik, supaya tidak diblokir.
    if (typeof window !== "undefined") {
      window.open(tautan.url, "_blank", "noopener,noreferrer");
    }
    run(
      () => recordWaInvite(member.membershipId),
      `WhatsApp untuk ${member.name} dibuka di nomor ${tautan.phone} — pesannya dikirim dari aplikasi WhatsApp Anda.`,
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-primary/12 text-primary">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Tim &amp; Peran</h2>
            <p className="text-sm text-muted-foreground">
              {roleSummary.total} peran kustom · {roleSummary.assignedMembers}{" "}
              anggota memakai peran kustom · {teamMembers.length} anggota tim
            </p>
          </div>
        </div>
        {gateReason && (
          <Badge variant="outline" className="gap-1.5 py-1">
            <Lock className="size-3" />
            Peran kustom terkunci
          </Badge>
        )}
      </header>

      {gateReason && (
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          {gateReason} Peran kustom yang sudah ada tetap terlihat dan anggota
          tetap bisa dikembalikan ke peran bawaannya; yang ditolak adalah membuat
          peran baru dan menugaskannya.{" "}
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
          {
            label: "Peran kustom",
            value: `${roleSummary.total}`,
            hint: `batas ${roleSummary.limit} per tenant`,
          },
          {
            label: "Peran aktif",
            value: `${roleSummary.active}`,
            hint: "bisa ditugaskan ke anggota",
          },
          {
            label: "Anggota dengan peran kustom",
            value: `${roleSummary.assignedMembers}`,
            hint: `dari ${teamMembers.length} anggota`,
          },
        ].map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="font-mono text-xl">{card.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {card.hint}
            </CardContent>
          </Card>
        ))}
      </section>

      {/* --------------------------- Daftarkan anggota tim ------------------ */}
      {canManage && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="size-4" />
              Daftarkan anggota tim
            </CardTitle>
            <CardDescription>
              Akunnya dibuat di workspace ini, bukan di bisnis baru: yang diikat
              adalah <strong>email</strong>, bukan perangkat. Orangnya masuk sendiri
              di halaman Masuk dengan kode OTP ke email itu — tidak ada kata sandi
              bersama untuk dibagikan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="member-email">Email</Label>
                <Input
                  id="member-email"
                  type="email"
                  value={inviteForm.email}
                  placeholder="sari@bisnis.id"
                  onChange={(event) =>
                    setInviteForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="member-name">Nama (opsional)</Label>
                <Input
                  id="member-name"
                  value={inviteForm.name}
                  placeholder="Sari Wulandari"
                  onChange={(event) =>
                    setInviteForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="member-phone">Nomor WhatsApp (opsional)</Label>
                <Input
                  id="member-phone"
                  value={inviteForm.phone}
                  placeholder="0812-3456-7890"
                  onChange={(event) =>
                    setInviteForm((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="member-role">Peran</Label>
                <select
                  id="member-role"
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-2 text-sm"
                  value={inviteForm.role}
                  onChange={(event) =>
                    setInviteForm((current) => ({
                      ...current,
                      role: event.target.value as Role,
                    }))
                  }
                >
                  {roleChoices.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="accent"
                onClick={submitInvite}
                disabled={busy || !inviteGate.ok}
              >
                <UserPlus /> Daftarkan ke tim
              </Button>
              <p className="text-xs text-muted-foreground">
                {!inviteGate.ok
                  ? inviteGate.reason
                  : joinExisting
                    ? "Email ini sudah anggota tim — perannya akan diperbarui, bukan digandakan."
                    : `Ia akan masuk sebagai ${ROLE_LABELS[inviteGate.value.role]} setelah kode OTP ke email itu dimasukkan.`}
              </p>
            </div>
            {acting !== "owner" && (
              <p className="text-xs text-muted-foreground">
                Peran <strong>Pemilik</strong> tidak ditawarkan di sini: hanya pemilik
                tenant yang boleh menetapkan pemilik lain.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------------------------- Ubah anggota tim ---------------------- */}
      {canManage && editingMember && (
        <Card className="border-primary/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Pencil className="size-4" />
              Ubah anggota: {editingMember.name}
            </CardTitle>
            <CardDescription>
              Email juga dipakai orangnya untuk masuk (kode OTP dikirim ke situ),
              jadi memperbaikinya berarti memperbaiki jalan masuknya.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Nama</Label>
                <Input
                  id="edit-name"
                  value={memberForm.name}
                  onChange={(event) =>
                    setMemberForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={memberForm.email}
                  onChange={(event) =>
                    setMemberForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Nomor WhatsApp</Label>
                <Input
                  id="edit-phone"
                  value={memberForm.phone}
                  placeholder="0812-3456-7890"
                  onChange={(event) =>
                    setMemberForm((current) => ({ ...current, phone: event.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Kosongkan untuk menghapus nomornya.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-role">Peran bawaan</Label>
                <select
                  id="edit-role"
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-2 text-sm"
                  value={memberForm.role}
                  onChange={(event) =>
                    setMemberForm((current) => ({
                      ...current,
                      role: event.target.value as Role,
                    }))
                  }
                >
                  {editRoleChoices.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                id="edit-active"
                type="checkbox"
                checked={memberForm.active}
                onChange={(event) =>
                  setMemberForm((current) => ({
                    ...current,
                    active: event.target.checked,
                  }))
                }
              />
              Anggota aktif — boleh memakai workspace ini
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="accent"
                onClick={submitMemberEdit}
                disabled={busy || !memberPreview?.ok}
              >
                <Save /> Simpan perubahan
              </Button>
              <Button type="button" variant="ghost" onClick={cancelEditMember} disabled={busy}>
                Batal
              </Button>
              <p className="text-xs text-muted-foreground">
                {memberPreview && !memberPreview.ok
                  ? memberPreview.reason
                  : memberPreview && memberPreview.changed.length > 0
                    ? `Yang berubah: ${memberPreview.changed
                        .map((field) => MEMBER_CHANGE_LABELS[field] ?? field)
                        .join(", ")}.`
                    : "Belum ada perubahan."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ------------------------------- Anggota tim ------------------------ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCog className="size-4" />
            Anggota tim
          </CardTitle>
          <CardDescription>
            Peran kustom <strong>menggantikan</strong> izin peran bawaan, bukan
            menambahinya. Pemilik tenant selalu memakai peran bawaan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Nama</th>
                  <th className="px-2 py-2">Peran bawaan</th>
                  <th className="px-2 py-2">Peran kustom</th>
                  <th className="px-2 py-2">Undangan</th>
                  <th className="px-2 py-2">WhatsApp</th>
                  <th className="px-2 py-2 text-right">Izin efektif</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {teamMembers.map((member) => (
                  <tr key={member.membershipId} className="border-t border-border/60">
                    <td className="px-2 py-2">
                      <div>{member.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {member.email}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <Badge variant="outline">{ROLE_LABELS[member.role]}</Badge>
                    </td>
                    <td className="px-2 py-2">
                      {member.role === "owner" ? (
                        <span className="text-xs text-muted-foreground">
                          Selalu seluruh izin
                        </span>
                      ) : (
                        <select
                          aria-label={`Peran kustom ${member.name}`}
                          className="h-9 w-full max-w-56 rounded-md border border-border/60 bg-background px-2 text-sm disabled:opacity-60"
                          value={member.customRoleId ?? ""}
                          disabled={busy || !canManage}
                          onChange={(event) =>
                            run(
                              () =>
                                assignCustomRole(
                                  member.membershipId,
                                  event.target.value === "" ? null : event.target.value,
                                ),
                              event.target.value === ""
                                ? `${member.name} kembali ke peran ${ROLE_LABELS[member.role]}.`
                                : `${member.name} memakai peran kustom ${
                                    roleOptions.find(
                                      (row) => row.id === event.target.value,
                                    )?.name ?? event.target.value
                                  }.`,
                            )
                          }
                        >
                          <option value="">
                            Peran bawaan ({ROLE_LABELS[member.role]})
                          </option>
                          {roleOptions.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="max-w-72 text-xs text-muted-foreground">
                        {inviteDeliverySentence(member.invite)}
                      </div>
                      {member.invite.attempts > 0 && (
                        <div className="text-[11px] text-muted-foreground">
                          Percobaan kirim: {member.invite.attempts}
                        </div>
                      )}
                      {canManage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-1 h-7 px-2 text-xs"
                          disabled={busy}
                          onClick={() => resend(member)}
                        >
                          <Send className="size-3" /> Kirim ulang
                        </Button>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="text-xs">
                        {member.phone ? `+${member.phone}` : "Belum ada nomor"}
                      </div>
                      <div className="max-w-56 text-[11px] text-muted-foreground">
                        {waInviteSentence(member.waInvite)}
                      </div>
                      {canManage && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-1 h-7 px-2 text-xs"
                          disabled={busy || !member.phone}
                          onClick={() => waInvite(member)}
                        >
                          <MessageCircle className="size-3" /> Kirim via WA
                        </Button>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {member.permissions.length}
                    </td>
                    <td className="px-2 py-2">
                      <Badge variant={member.active ? "default" : "outline"}>
                        {member.active ? "aktif" : "nonaktif"}
                      </Badge>
                    </td>
                    <td className="px-2 py-2">
                      {canManage && (
                        <div className="flex flex-wrap items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            disabled={busy}
                            onClick={() => startEditMember(member)}
                          >
                            <Pencil className="size-3" /> Ubah
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            disabled={busy}
                            onClick={() => toggleActive(member)}
                          >
                            {member.active ? "Nonaktifkan" : "Aktifkan"}
                          </Button>
                          {confirmDeleteId === member.membershipId ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-destructive"
                                disabled={busy}
                                onClick={() => removeMember(member)}
                              >
                                <Trash2 className="size-3" /> Yakin hapus?
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                disabled={busy}
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                Batal
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              disabled={busy}
                              onClick={() => setConfirmDeleteId(member.membershipId)}
                            >
                              <Trash2 className="size-3" /> Hapus
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {teamMembers.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-2 py-4 text-center text-sm text-muted-foreground"
                    >
                      Belum ada anggota tim.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------- Peran kustom ----------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Peran kustom</CardTitle>
          <CardDescription>
            Peran yang masih ditugaskan ke anggota tidak bisa dihapus — pindahkan
            anggotanya dulu supaya tidak ada yang kehilangan akses diam-diam.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {customRoles.map((role) => (
              <div
                key={role.id}
                className={cn(
                  "rounded-lg border px-4 py-3",
                  editingId === role.id
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/60 bg-secondary/10",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      {role.name}
                      <Badge variant={role.active ? "default" : "outline"}>
                        {role.active ? "aktif" : "nonaktif"}
                      </Badge>
                      <span className="text-xs font-normal text-muted-foreground">
                        {role.memberCount} anggota
                      </span>
                    </div>
                    {role.description && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {role.description}
                      </p>
                    )}
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {describeCustomRole(role)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => startEdit(role.id)}
                    >
                      Ubah
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || !canManage}
                      onClick={() =>
                        run(
                          () =>
                            updateCustomRole({ roleId: role.id, active: !role.active }),
                          role.active
                            ? `Peran ${role.name} dinonaktifkan — anggotanya kembali ke peran bawaan.`
                            : `Peran ${role.name} diaktifkan kembali.`,
                        )
                      }
                    >
                      {role.active ? "Nonaktifkan" : "Aktifkan"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || !canManage}
                      title={
                        role.memberCount > 0
                          ? "Masih dipakai anggota"
                          : "Hapus peran ini"
                      }
                      onClick={() =>
                        run(
                          () => deleteCustomRole(role.id),
                          `Peran ${role.name} dihapus.`,
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {role.permissions.map((permission) => (
                    <span
                      key={permission}
                      className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {PERMISSION_LABELS[permission]}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {customRoles.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Belum ada peran kustom. Peran bawaan (Pemilik, Manajer, Kasir,
                Staf Gudang, Keuangan) tetap berlaku.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------- Editor ----------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {editingId ? "Ubah peran kustom" : "Peran kustom baru"}
          </CardTitle>
          <CardDescription>
            Pilih izin satu per satu. Nama peran bawaan (Kasir, Manajer, …) tidak
            bisa dipakai ulang supaya izinnya tidak tertukar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs text-muted-foreground">
              Nama peran
              <Input
                className="mt-1"
                value={form.name}
                disabled={busy || !canManage}
                placeholder="Kasir shift malam"
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <label className="text-xs text-muted-foreground md:col-span-2">
              Keterangan (opsional)
              <Input
                className="mt-1"
                value={form.description}
                disabled={busy || !canManage}
                placeholder="Menjual tanpa bisa membatalkan transaksi"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <div className="space-y-3">
            {PERMISSION_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {group.permissions.map((permission) => {
                    const selected = form.permissions.includes(permission);
                    return (
                      <button
                        key={permission}
                        type="button"
                        aria-pressed={selected}
                        disabled={busy || !canManage}
                        onClick={() => togglePermission(permission)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60",
                          selected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border/60 text-muted-foreground hover:border-primary/40",
                        )}
                      >
                        {PERMISSION_LABELS[permission]}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={busy || !canManage} onClick={() => submit()}>
              <Save />
              {editingId ? "Simpan perubahan" : "Buat peran"}
            </Button>
            {editingId && (
              <Button variant="ghost" disabled={busy} onClick={resetForm}>
                Batal
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {preview.ok
                ? `${preview.value.permissions.length} izin dipilih.`
                : preview.reason}
            </span>
          </div>

          {!canManage && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Lock className="size-3.5" />
              Melihat peran boleh; mengubahnya butuh izin `team.manage`.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Anda tidak bisa memberi izin yang Anda sendiri tidak punya — pagar ini
            mencegah seorang manajer membuat peran berisi `billing.manage` lalu
            menugaskannya ke dirinya sendiri.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

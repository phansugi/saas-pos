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
  lackingFromPermissions,
  PERMISSION_GROUPS,
  sanitizePermissions,
  validateCustomRole,
} from "@/lib/rbac";
import {
  describeBuiltinRole,
  isLockedRole,
  OWNER_ROLE_LOCK_REASON,
  roleActions,
  roleChoicesForMember,
  roleState,
  summarizeRoleSettings,
  validateRoleSetting,
} from "@/lib/roleSettings";
import { actingPermissions, actingRole, useSession } from "@/lib/session";
import type { StoreTeamMember } from "@/lib/store";
import {
  assignableRoles,
  inviteDeliverySentence,
  inviteNextStep,
  MEMBER_CHANGE_LABELS,
  normalizePhone,
  parseRoleChoice,
  resolveTeamInviteForm,
  ROLE_CHOICE_CUSTOM_PREFIX,
  roleChoiceValue,
  validateTeamInvite,
  validateTeamMemberEdit,
  waInviteSentence,
  whatsappInviteText,
  whatsappInviteUrl,
} from "@/lib/team";
import { useStore } from "@/lib/store";
import { FEATURE_LABELS } from "@/lib/billing";
import { ModuleReadOnly } from "@/components/ModuleReadOnly";
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
    builtinRoles,
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
    updateBuiltinRole,
    deleteBuiltinRole,
    restoreBuiltinRole,
    resetBuiltinRole,
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
  /** Peran **bawaan** yang izinnya sedang disunting (`null` = tidak ada). */
  const [editingBuiltin, setEditingBuiltin] = useState<Role | null>(null);
  /**
   * Konfirmasi hapus peran — satu keadaan untuk dua jenis peran, karena
   * menghapus peran tidak boleh sedetik pun terjadi tanpa ditekan dua kali.
   * Nilainya `bawaan:<peran>` atau `kustom:<id>`.
   */
  const [confirmRole, setConfirmRole] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    permissions: [] as Permission[],
  });

  /** Izin efektif pembuka halaman — pagar eskalasi peran bawaan memakainya. */
  const myPermissions = useMemo(() => actingPermissions(session), [session]);

  /** Penyesuaian peran bawaan workspace ini, seperti yang dibaca daftar di atas. */
  const roleSettingRows = useMemo(
    () =>
      builtinRoles.map((role) => ({
        role: role.role,
        permissions: role.permissions,
        active: role.active,
        removed: role.removed,
      })),
    [builtinRoles],
  );

  const builtinSummary = useMemo(
    () => ({
      ...summarizeRoleSettings(roleSettingRows),
      total: builtinRoles.length,
    }),
    [builtinRoles.length, roleSettingRows],
  );

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
    setEditingBuiltin(null);
    setForm({ name: "", description: "", permissions: [] });
  }

  /**
   * Menyunting **izin peran bawaan**: namanya tidak ikut berubah (dipakai struk,
   * sidebar, dan jejak audit), yang dipilih hanya izinnya.
   */
  function startEditBuiltin(role: Role) {
    /*
      Gerbang fitur diperiksa **sebelum** editornya terbuka: menyunting izin
      peran bawaan ditolak server tanpa `rbac.custom`, dan editor yang terbuka
      hanya akan berakhir di galat server (persis keluhan “Fitur Custom role
      (RBAC) tidak termasuk paket Starter”).
    */
    if (gateReason) {
      setError(gateReason);
      return;
    }
    const row = builtinRoles.find((item) => item.role === role);
    if (!row) return;
    setEditingId(null);
    setEditingBuiltin(role);
    setForm({
      name: row.label,
      description: "",
      permissions: sanitizePermissions(row.permissions),
    });
    setError(null);
    setNotice(null);
    setConfirmRole(null);
  }

  /** Pratinjau izin peran bawaan — aturan yang sama dengan server. */
  const builtinPreview = useMemo(
    () =>
      editingBuiltin
        ? validateRoleSetting(
            { permissions: form.permissions },
            { role: editingBuiltin, actingPermissions: myPermissions },
          )
        : null,
    [editingBuiltin, form.permissions, myPermissions],
  );

  function submitBuiltin() {
    if (gateReason) {
      setError(gateReason);
      return;
    }
    if (busy || !editingBuiltin || !builtinPreview) return;
    if (!builtinPreview.ok) {
      setError(builtinPreview.reason);
      return;
    }
    const role = editingBuiltin;
    const permissions = builtinPreview.value.permissions ?? [];
    const label = ROLE_LABELS[role];
    run(
      () =>
        updateBuiltinRole({ role, permissions }).then(() => {
          resetForm();
        }),
      `Izin peran ${label} disimpan (${permissions.length} izin).`,
    );
  }

  function startEdit(roleId: string) {
    const role = customRoles.find((row) => row.id === roleId);
    if (!role) return;
    setEditingId(roleId);
    setEditingBuiltin(null);
    setConfirmRole(null);
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
  /**
   * Peran yang ditawarkan saat mengundang: peran bawaan yang boleh dicetak
   * pengundang, **dikurangi** peran yang dinonaktifkan/dihapus di workspace ini.
   */
  const roleChoices = useMemo(
    () =>
      assignableRoles(acting).filter(
        (role) =>
          roleState(roleSettingRows.find((row) => row.role === role)) === "aktif",
      ),
    [acting, roleSettingRows],
  );
  const memberEmails = useMemo(
    () => teamMembers.map((member) => member.email.trim().toLowerCase()),
    [teamMembers],
  );

  const [inviteForm, setInviteForm] = useState({
    email: "",
    name: "",
    phone: "",
    /** `null` = yang dipilih peran tambahan (tidak ada peran bawaan yang ikut). */
    role: "cashier" as Role | null,
    /** Id peran kustom yang langsung dipakai anggota ini; `""` = tanpa peran kustom. */
    customRoleId: "",
  });
  /*
    Peran kustom yang boleh ditawarkan **saat mendaftarkan anggota baru**. Dulu
    peran kustom hanya bisa ditugaskan sesudah orangnya masuk tim, dan itu yang
    dikeluhkan: peran yang sudah dibuat tidak muncul di pilihan pendaftaran.

    Isinya disaring dengan pagar yang sama seperti server (`members.add` → aturan
    `roles.assign`): hanya peran aktif yang izinnya tidak melewati wewenang
    pengundang — jadi tidak ada pilihan yang berakhir ditolak setelah ditekan.
  */
  const inviteCustomRoles = useMemo(
    () =>
      roleOptions.filter(
        (role) => lackingFromPermissions(myPermissions, role.permissions).length === 0,
      ),
    [myPermissions, roleOptions],
  );
  /**
   * Peran kustom yang sedang dipilih di formulir pendaftaran (`null` = tidak ada).
   *
   * Pemilik tenant selalu memegang seluruh izin, jadi pilihan peran kustom tidak
   * berlaku untuknya — dan nilai lama di formulir tidak boleh ikut terkirim saat
   * peran bawaannya diganti menjadi Pemilik (server akan menolaknya; lebih baik
   * permintaannya tidak pernah dibuat).
   */
  const inviteCustomRole =
    inviteForm.role === "owner"
      ? null
      : (inviteCustomRoles.find((role) => role.id === inviteForm.customRoleId) ?? null);
  /*
    Pratinjau undangan memakai aturan yang sama dengan server. Kalau yang dipilih
    peran tambahan, peran dasar tersembunyinya (`STANDALONE_BASE_ROLE`) **tidak**
    diperiksa statusnya — peran tambahan berdiri sendiri, jadi Kasir yang
    dinonaktifkan/dihapus tidak boleh ikut memblokirnya.
  */
  const invitePreview = useMemo(
    () =>
      validateTeamInvite(inviteForm, {
        actingRole: acting,
        roleSettings: inviteCustomRole ? [] : roleSettingRows,
        standaloneCustomRole: Boolean(inviteCustomRole),
      }),
    [inviteForm, acting, inviteCustomRole, roleSettingRows],
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
      customRoleId: inviteCustomRole ? inviteCustomRole.id : null,
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
        /*
          Satu orang = satu peran. Peran tambahan berdiri sendiri, jadi yang
          disebut hanya namanya — bukan “Kasir + peran kustom …”.
        */
        const peran = inviteCustomRole
          ? inviteCustomRole.name
          : value.role
            ? ROLE_LABELS[value.role]
            : "peran tambahan";
        setNotice(
          result.created
            ? `${value.name} terdaftar sebagai ${peran}. ${kirim} ${inviteNextStep(value)}`
            : `${value.email} sudah anggota tim — perannya diperbarui menjadi ${peran}. Undangannya tidak dikirim ulang otomatis; pakai tombol Kirim ulang di kolom Undangan kalau perlu.`,
        );
        /*
          Formulir kembali ke keadaan siap-isi: kolom peran diisi peran bawaan
          yang pertama ditawarkan, **bukan** peran tambahan yang barusan dipakai —
          kalau tidak, pilihan berikutnya akan membawa peran tambahan yang sama
          secara diam-diam untuk orang yang berbeda.
        */
        setInviteForm({
          email: "",
          name: "",
          phone: "",
          role: roleChoices[0] ?? "cashier",
          customRoleId: "",
        });
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
    /** `null` = anggota itu memakai peran tambahan (berdiri sendiri). */
    role: "cashier" as Role | null,
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

  /*
    Satu anggota = satu peran yang terlihat. Kolom **Peran** di daftar anggota
    memakai pemilih yang sama dengan formulir undangan: peran bawaan dan peran
    tambahan dalam satu daftar. Peran tambahan yang sedang dipakai tetap
    ditawarkan walaupun sudah dinonaktifkan, supaya dropdown yang menyempit tidak
    memaksa orang berpindah peran.
  */
  function memberRoleChoices(member: StoreTeamMember): Role[] {
    return roleChoicesForMember(roleChoices, member.role);
  }

  function memberCustomChoices(member: StoreTeamMember) {
    const aktif = roleOptions.filter((role) => role.active);
    if (
      member.customRoleId &&
      !aktif.some((role) => role.id === member.customRoleId)
    ) {
      const sedangDipakai = customRoles.find(
        (role) => role.id === member.customRoleId,
      );
      if (sedangDipakai) return [...aktif, sedangDipakai];
    }
    return aktif;
  }

  /**
   * Mengganti **satu-satunya peran** seorang anggota dari kolom Peran.
   *
   * Peran tambahan berdiri sendiri: memilihnya cukup menugaskan peran itu (peran
   * dasar tersembunyinya tidak berubah). Kembali ke peran bawaan melepas peran
   * tambahannya lebih dulu — termasuk saat tujuannya Pemilik, karena pemilik
   * tidak boleh memakai peran tambahan sama sekali.
   */
  function changeMemberRole(member: StoreTeamMember, value: string) {
    const parsed = parseRoleChoice(value);
    if (!parsed) return;
    const custom = parsed.customRoleId
      ? (customRoles.find((role) => role.id === parsed.customRoleId) ?? null)
      : null;
    const peranBawaan = parsed.role ?? null;
    const label = custom
      ? custom.name
      : peranBawaan
        ? ROLE_LABELS[peranBawaan]
        : "peran tambahan";

    if (custom) {
      run(
        () => assignCustomRole(member.membershipId, custom.id),
        `${member.name} sekarang memakai ${label}.`,
      );
      return;
    }

    // Nilai yang bukan peran bawaan & bukan peran tambahan tidak dikirim.
    if (!peranBawaan) return;
    if (member.role === peranBawaan && !member.customRoleId) return;

    /*
      Satu panggilan saja: `members.update` sudah melepas peran tambahan begitu
      peran bawaan dikirim, jadi tidak ada jeda di mana anggotanya tanpa peran —
      dan peran barunya benar-benar berdiri sendiri.
    */
    run(
      () =>
        updateTeamMember({
          membershipId: member.membershipId,
          role: peranBawaan,
        }),
      `${member.name} sekarang ${label}.`,
    );
  }

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

  /* --------------------- Aksi peran bawaan (izin & status) -------------- */

  function toggleBuiltinActive(role: Role) {
    const row = builtinRoles.find((item) => item.role === role);
    if (!row) return;
    const label = ROLE_LABELS[role];
    run(
      () => updateBuiltinRole({ role, active: !row.active }),
      row.active
        ? `Peran ${label} dinonaktifkan — ia tidak bisa ditugaskan lagi ke anggota yang belum memakainya.`
        : `Peran ${label} diaktifkan kembali.`,
    );
  }

  function removeBuiltin(role: Role) {
    const label = ROLE_LABELS[role];
    run(async () => {
      await deleteBuiltinRole(role);
      setConfirmRole(null);
      if (editingBuiltin === role) resetForm();
    }, `Peran ${label} dihapus dari daftar penugasan — bisa dipulihkan kapan saja lewat tombol Pulihkan.`);
  }

  function restoreBuiltin(role: Role) {
    const label = ROLE_LABELS[role];
    run(
      () => restoreBuiltinRole(role),
      `Peran ${label} dipulihkan.`,
    );
  }

  function resetBuiltin(role: Role) {
    if (gateReason) {
      setError(gateReason);
      return;
    }
    const label = ROLE_LABELS[role];
    run(async () => {
      await resetBuiltinRole(role);
      if (editingBuiltin === role) resetForm();
    }, `Izin peran ${label} dikembalikan ke bawaan.`);
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
        customRoleName: customRoles.find((role) => role.id === member.customRoleId)
          ?.name,
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
              {builtinRoles.length} peran bawaan
              {roleSummary.builtin.customized > 0
                ? ` (${roleSummary.builtin.customized} disesuaikan)`
                : ""}{" "}
              · {roleSummary.total} peran kustom · {roleSummary.assignedMembers}{" "}
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
          {gateReason} Bagian <strong className="text-foreground">Peran</strong>{" "}
          di halaman ini hanya bisa dibaca — abu-abu, tanpa satu pun kontrol yang
          bisa diisi, diubah, atau diperbarui. Mengelola{" "}
          <strong className="text-foreground">anggota</strong> (mendaftarkan,
          mengubah, menonaktifkan) tetap bisa seperti biasa, karena itu bukan
          fitur modul ini.{" "}
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
              {/*
                **Satu pemilih peran**, bukan dua. Isinya semua peran yang ada:
                peran bawaan yang masih bisa ditugaskan, lalu peran tambahan
                (kustom) yang aktif dan tidak melewati wewenang pengundang.
                Memilih peran tambahan berarti anggota itu **hanya** memakai
                peran itu; peran dasar Kasir yang tersimpan di baris keanggotaan
                adalah keterangan tersembunyi, bukan pilihan kedua.
              */}
              <div className="space-y-2 sm:col-span-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="member-role">Peran</Label>
                  <Badge variant={inviteCustomRole ? "default" : "outline"}>
                    {inviteCustomRole
                      ? `${inviteCustomRole.permissions.length} izin · peran tambahan`
                      : "peran bawaan"}
                  </Badge>
                </div>
                <select
                  id="member-role"
                  className={cn(
                    "h-10 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-60",
                    inviteCustomRole
                      ? "border-primary/60 font-medium ring-1 ring-primary/25"
                      : "border-border/60",
                  )}
                  value={roleChoiceValue(inviteForm.role, inviteForm.customRoleId)}
                  /*
                    Hanya gerbang **peran tambahan** yang menutup pemilih ini —
                    bukan seluruhnya. Menugaskan peran bawaan tidak butuh fitur
                    `rbac.custom` di server (`members.add` menuntutnya hanya saat
                    `customRoleId` diisi), jadi mengunci pemilihnya berarti tenan
                    Starter tidak bisa memilih peran sama sekali padahal server
                    menerimanya.
                  */
                  disabled={busy}
                  onChange={(event) => {
                    const parsed = parseRoleChoice(event.target.value);
                    if (!parsed) return;
                    setInviteForm((current) => ({
                      ...current,
                      role: parsed.role,
                      customRoleId: parsed.customRoleId ?? "",
                    }));
                  }}
                >
                  <optgroup label="Peran bawaan">
                    {roleChoices.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </optgroup>
                  {gateReason === null && inviteCustomRoles.length > 0 && (
                    <optgroup label="Peran tambahan">
                      {inviteCustomRoles.map((role) => (
                        <option
                          key={role.id}
                          value={`${ROLE_CHOICE_CUSTOM_PREFIX}${role.id}`}
                        >
                          {role.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <p
                  data-testid="member-role-catatan"
                  className="text-xs text-muted-foreground"
                >
                  {gateReason
                    ? `${gateReason} Peran bawaan tetap bisa ditugaskan; yang tidak ditawarkan di sini adalah peran tambahan.`
                    : (inviteCustomRole
                      ? `${describeCustomRole(inviteCustomRole)} — peran tambahan berdiri sendiri; izin peran bawaan tidak ikut dipakai.`
                      : inviteCustomRoles.length === 0
                        ? "Selain peran bawaan, belum ada peran tambahan yang bisa Anda tugaskan — buat di daftar Peran di bawah."
                        : "Pilih satu peran saja. Peran tambahan berdiri sendiri — izinnya tidak menumpang peran bawaan.")}
                </p>
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
                    : `Ia akan masuk sebagai ${
                        inviteGate.value.role
                          ? ROLE_LABELS[inviteGate.value.role]
                          : "peran tambahan"
                      } setelah kode OTP ke email itu dimasukkan.`}
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
              {/*
                Peran **tidak** diubah dari sini: satu anggota = satu peran, dan
                tempatnya di kolom Peran pada daftar anggota (peran bawaan dan
                peran tambahan di satu daftar). Formulir ini mengurus identitas
                orangnya — nama, email, nomor WA, dan status aktifnya.
              */}
              <div className="space-y-2 sm:col-span-2">
                <Label>Peran</Label>
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="edit-peran-catatan"
                >
                  {editingMember?.customRoleId
                    ? `${editingMember.name} memakai peran tambahan ${
                        customRoles.find(
                          (row) => row.id === editingMember.customRoleId,
                        )?.name ?? "—"
                      } — berdiri sendiri, bukan tambahan di atas peran bawaan.`
                    : memberForm.role
                      ? `${editingMember?.name ?? "Anggota ini"} memakai peran bawaan ${
                          ROLE_LABELS[memberForm.role]
                        }.`
                      : `${editingMember?.name ?? "Anggota ini"} belum diberi peran di workspace ini.`}{" "}
                  Ganti perannya di kolom <strong>Peran</strong> pada daftar anggota.
                </p>
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
            Satu anggota memakai <strong>satu</strong> peran — pilih di kolom
            Peran. Peran tambahan berdiri sendiri: izinnya tidak menumpang peran
            bawaan. Pemilik tenant selalu memakai peran bawaan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Nama</th>
                  <th className="min-w-64 px-2 py-2">Peran</th>
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
                    <td className="min-w-64 px-2 py-2">
                      {member.role === "owner" ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">Pemilik</Badge>
                          <span className="text-xs text-muted-foreground">
                            Selalu seluruh izin
                          </span>
                        </div>
                      ) : (
                        <>
                          <select
                            aria-label={`Peran ${member.name}`}
                            className={cn(
                              "h-9 w-full min-w-60 max-w-64 rounded-md border bg-background px-2 text-sm disabled:opacity-60",
                              member.customRoleId
                                ? "border-primary/60 font-medium ring-1 ring-primary/25"
                                : "border-border/60",
                            )}
                            value={roleChoiceValue(member.role, member.customRoleId)}
                            disabled={busy || !canManage}
                            onChange={(event) =>
                              changeMemberRole(member, event.target.value)
                            }
                          >
                            {/*
                              Anggota tanpa peran (peran tambahannya dinonaktifkan
                              dan belum ditugaskan peran baru) tidak punya nilai
                              pilihan yang cocok — keadaan itu disebutkan apa
                              adanya, bukan diam-diam tampil sebagai peran pertama.
                            */}
                            {member.role === null && !member.customRoleId && (
                              <option value="">Belum diberi peran</option>
                            )}
                            <optgroup label="Peran bawaan">
                              {memberRoleChoices(member).map((role) => (
                                <option key={role} value={role}>
                                  {ROLE_LABELS[role]}
                                </option>
                              ))}
                            </optgroup>
                            {memberCustomChoices(member).length > 0 && (
                              <optgroup label="Peran tambahan">
                                {memberCustomChoices(member).map((role) => (
                                  <option
                                    key={role.id}
                                    value={`${ROLE_CHOICE_CUSTOM_PREFIX}${role.id}`}
                                  >
                                    {role.name}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </>
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
                      colSpan={7}
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

      {/* ------------------------------- Peran ------------------------------- */}
      {/*
        **Satu daftar peran** untuk seluruh pengelolaan: peran bawaan dan peran
        tambahan berdampingan, dengan aksi yang sama (ubah izin, aktif/nonaktif,
        hapus). Dulu keduanya dua kartu terpisah — yang membuat “peran” terasa
        seperti dua konsep berbeda dan formulir undangan sampai menanyakan dua
        kali. Peran tambahan **berdiri sendiri**: izinnya tidak menumpang peran
        bawaan mana pun.
      */}
      {/*
        Bagian **Peran** milik fitur `rbac.custom`. Tanpa fiturnya (paket Starter
        / Professional) bagian ini hanya bisa dibaca: kartu peran, editor izin,
        dan tombol-tombolnya dirender abu-abu di dalam `ModuleReadOnly` sehingga
        tidak ada satu pun yang bisa diklik atau diisi. Mengelola **anggota**
        (kartu di atas) bukan milik modul ini — paket semua orang memuatnya —
        jadi ia tetap hidup.
      */}
      <ModuleReadOnly
        locked={gateReason !== null}
        reason={gateReason}
        label={FEATURE_LABELS["rbac.custom"]}
      >
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4" />
            Peran
          </CardTitle>
          <CardDescription>
            Izin peran bawaan bisa disesuaikan dengan cara kerja toko ini,
            dinonaktifkan (tidak bisa ditugaskan lagi ke anggota yang belum
            memakainya), atau dihapus dari daftar penugasan. Peran tambahan
            dikelola di daftar yang sama dan <strong>berdiri sendiri</strong> —
            izinnya tidak menumpang peran bawaan. <strong>Nama peran bawaan tetap</strong> —
            labelnya dipakai di struk, sidebar, pesan penolakan, dan jejak audit,
            jadi ia sama di semua workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">
                Peran bawaan
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {builtinRoles.length} peran · tidak bisa diubah namanya
                </span>
              </h3>
            </div>
            {builtinRoles.map((role) => {
              const actions = roleActions({
                role: role.role,
                active: role.active,
                removed: role.removed,
                customized: role.customized,
                // Tombol hanya hidup kalau servernya memang akan menerimanya.
                editGateReason: gateReason,
                memberCount: role.memberCount,
                canManage,
              });
              const label = role.label;
              const confirmKey = `bawaan:${role.role}`;
              return (
                <div
                  key={role.role}
                  data-testid={`peran-bawaan-${role.role}`}
                  className={cn(
                    "rounded-lg border px-4 py-3",
                    editingBuiltin === role.role
                      ? "border-primary/40 bg-primary/5"
                      : "border-border/60 bg-secondary/10",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {label}
                        <Badge variant={role.active ? "default" : "outline"}>
                          {role.removed
                            ? "dihapus"
                            : role.active
                              ? "aktif"
                              : "nonaktif"}
                        </Badge>
                        {role.customized && (
                          <Badge variant="outline">izin disesuaikan</Badge>
                        )}
                        <span className="text-xs font-normal text-muted-foreground">
                          {role.memberCount} anggota
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                        {describeBuiltinRole({
                          label,
                          permissions: role.permissions,
                          customized: role.customized,
                        })}
                      </p>
                      {isLockedRole(role.role) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {OWNER_ROLE_LOCK_REASON}
                        </p>
                      )}
                      {!role.removed && !role.active && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Peran ini tidak ditawarkan lagi saat mengundang atau
                          memindahkan anggota; {role.memberCount} anggota yang masih
                          memakainya tetap bekerja sampai dipindahkan.
                        </p>
                      )}
                    </div>
                    {!isLockedRole(role.role) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {actions.edit ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            aria-label={`Ubah izin peran ${label}`}
                            onClick={() => startEditBuiltin(role.role)}
                          >
                            <Pencil className="size-3" /> Ubah izin
                          </Button>
                        ) : (
                          /*
                            Tanpa fitur `rbac.custom` tombolnya tetap tampil tetapi
                            mati, dengan sebabnya terbaca (bukan hilang diam-diam,
                            dan bukan pula hidup lalu ditolak server). Alasannya
                            datang dari `featureUnavailableReason`, jadi kalimatnya
                            sama persis dengan kalimat `requireFeature` di server.
                          */
                          actions.editReason && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled
                              title={actions.editReason}
                              aria-label={`Ubah izin peran ${label} terkunci`}
                            >
                              <Lock className="size-3" /> Ubah izin
                            </Button>
                          )
                        )}
                        {actions.reset && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            aria-label={`Kembalikan izin bawaan ${label}`}
                            onClick={() => resetBuiltin(role.role)}
                          >
                            Kembalikan izin bawaan
                          </Button>
                        )}
                        {actions.toggle && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            aria-label={`${role.active ? "Nonaktifkan" : "Aktifkan"} peran ${label}`}
                            onClick={() => toggleBuiltinActive(role.role)}
                          >
                            {role.active ? "Nonaktifkan" : "Aktifkan"}
                          </Button>
                        )}
                        {actions.restore && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            aria-label={`Pulihkan peran ${label}`}
                            onClick={() => restoreBuiltin(role.role)}
                          >
                            Pulihkan
                          </Button>
                        )}
                        {confirmRole === confirmKey ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive"
                              disabled={busy}
                              aria-label={`Yakin hapus peran ${label}`}
                              onClick={() => removeBuiltin(role.role)}
                            >
                              <Trash2 className="size-3" /> Yakin hapus?
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => setConfirmRole(null)}
                            >
                              Batal
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy || !actions.remove}
                            aria-label={`Hapus peran ${label}`}
                            title={
                              actions.removeReason ??
                              "Hapus peran ini dari daftar penugasan"
                            }
                            onClick={() => setConfirmRole(confirmKey)}
                          >
                            <Trash2 className="size-3" /> Hapus
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {role.permissions.map((permission) => (
                      <span
                        key={permission}
                        data-testid={`peran-bawaan-izin-${role.role}-${permission}`}
                        className="rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {PERMISSION_LABELS[permission]}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Peran tambahan — bagian dari daftar yang sama, dengan aksi yang
                sama. Peran yang masih ditugaskan ke anggota tidak bisa dihapus. */}
            <div className="flex flex-wrap items-baseline justify-between gap-2 pt-2">
              <h3 className="text-sm font-semibold">
                Peran tambahan
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {customRoles.length} peran · berdiri sendiri
                </span>
              </h3>
            </div>
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
                      aria-label={`Ubah peran ${role.name}`}
                      onClick={() => startEdit(role.id)}
                    >
                      Ubah
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || !canManage}
                      aria-label={`${role.active ? "Nonaktifkan" : "Aktifkan"} peran ${role.name}`}
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
                    {confirmRole === `kustom:${role.id}` ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive"
                          disabled={busy}
                          aria-label={`Yakin hapus peran ${role.name}`}
                          onClick={() => {
                            setConfirmRole(null);
                            run(
                              () => deleteCustomRole(role.id),
                              `Peran ${role.name} dihapus.`,
                            );
                          }}
                        >
                          <Trash2 className="size-3" /> Yakin hapus?
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setConfirmRole(null)}
                        >
                          Batal
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy || !canManage || role.memberCount > 0}
                        aria-label={`Hapus peran ${role.name}`}
                        title={
                          role.memberCount > 0
                            ? `Masih dipakai ${role.memberCount} anggota; pindahkan mereka ke peran lain dulu.`
                            : "Hapus peran ini"
                        }
                        onClick={() => setConfirmRole(`kustom:${role.id}`)}
                      >
                        <Trash2 className="size-3" /> Hapus
                      </Button>
                    )}
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
                Belum ada peran tambahan. Buat lewat formulir di bawah; peran
                bawaan (Pemilik, Manajer, Kasir, Staf Gudang, Keuangan) tetap
                berlaku.
              </p>
            )}
            {!canManage && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Lock className="size-3.5" />
                Melihat peran boleh; mengubahnya butuh izin `team.manage`.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {builtinSummary.customized} peran bawaan disesuaikan · {" "}
              {builtinSummary.assignable} dari {builtinSummary.total} masih bisa
              ditugaskan · {roleSummary.total} peran tambahan terdaftar.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------- Editor ----------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {editingBuiltin
              ? `Ubah izin peran ${ROLE_LABELS[editingBuiltin]}`
              : editingId
                ? "Ubah peran tambahan"
                : "Peran tambahan baru"}
          </CardTitle>
          <CardDescription>
            {editingBuiltin
              ? "Izin yang dicentang di sini yang berlaku untuk seluruh anggota berperan " +
                `${ROLE_LABELS[editingBuiltin]} di workspace ini. Nama perannya tidak berubah.`
              : "Peran tambahan berdiri sendiri: pilih izinnya sendiri, tidak menumpang " +
                "izin peran bawaan. Nama peran bawaan (Kasir, Manajer, …) tidak bisa dipakai " +
                "ulang supaya izinnya tidak tertukar."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {editingBuiltin && (
            <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
              Menyimpan izin baru langsung berlaku untuk setiap anggota yang berperan
              {` ${ROLE_LABELS[editingBuiltin]}`}, termasuk yang sedang bekerja. Kalau
              salah, tombol <strong>Kembalikan izin bawaan</strong> mengembalikannya
              ke izin asli peran itu.
            </p>
          )}
          {editingBuiltin && (
            <p className="text-xs text-muted-foreground" data-testid="editor-peran-bawaan">
              Izin bawaan peran {ROLE_LABELS[editingBuiltin]}:{" "}
              {(builtinRoles.find((row) => row.role === editingBuiltin)
                ?.basePermissions ?? []) 
                .map((permission) => PERMISSION_LABELS[permission])
                .join(", ")}
            </p>
          )}
          {/* Nama & keterangan hanya untuk peran kustom; nama peran bawaan tetap. */}
          {!editingBuiltin && (
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
          )}

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
            <Button
              disabled={busy || !canManage}
              onClick={() => (editingBuiltin ? submitBuiltin() : submit())}
            >
              <Save />
              {editingBuiltin
                ? "Simpan izin"
                : editingId
                  ? "Simpan perubahan"
                  : "Buat peran"}
            </Button>
            {(editingId || editingBuiltin) && (
              <Button variant="ghost" disabled={busy} onClick={resetForm}>
                Batal
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {editingBuiltin
                ? builtinPreview && !builtinPreview.ok
                  ? builtinPreview.reason
                  : `${form.permissions.length} izin dipilih.`
                : preview.ok
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
      </ModuleReadOnly>
    </div>
  );
}

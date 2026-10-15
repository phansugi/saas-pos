import { AlertTriangle } from "lucide-react";
import { isPlatformMembershipRefusal } from "@/lib/platform";
import { isMembershipSuspended } from "@/lib/team";

/**
 * Kenapa ada: menyambungkan workspace ke server bisa **ditolak**, dan penolakan
 * itu dulu hanya tersimpan di store (`provisionError`) tanpa pernah ditampilkan.
 * Akibatnya satu-satunya umpan balik yang dilihat pengguna adalah pesan gerbang
 * aksi — “Tenant belum siap. Coba lagi sebentar lagi.” — yang menyuruh menunggu,
 * padahal menunggu tidak menolong saat penolakannya permanen (mis. akun platform
 * memang tidak boleh punya workspace).
 *
 * Notis ini karena itu membawa **kalimat server apa adanya** (bukan ringkasan
 * buatan klien) plus satu petunjuk tindakan. Petunjuknya bercabang hanya untuk
 * penolakan akun platform, karena di situlah tindakan yang benar memang berbeda:
 * akun platform **boleh** punya workspace sendiri, jadi yang perlu dibereskan
 * adalah akun yang sedang masuk — bukan halamannya yang perlu dimuat ulang.
 *
 * Cabang kedua: keanggotaan yang **dinonaktifkan** pemiliknya. Di situ memuat
 * ulang halaman tidak menolong sama sekali — yang mengembalikan aksesnya hanya
 * pemilik bisnis — jadi petunjuknya menyebut itu, bukan menyuruh mencoba lagi.
 */
export function ProvisioningNotice({ error }: { error: string | null }) {
  if (!error) return null;

  const platformAccount = isPlatformMembershipRefusal(error);
  const suspended = isMembershipSuspended(error);

  return (
    <div
      role="alert"
      className="flex items-start gap-3 border-b border-destructive/40 bg-destructive/10 px-6 py-3 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">Workspace belum tersambung ke server</p>
        <p className="mt-0.5 break-words">{error}</p>
        <p className="mt-1 text-xs">
          {suspended
            ? "Minta pemilik bisnis mengaktifkan kembali keanggotaan Anda di halaman Tim & Peran; halaman ini akan menyambung sendiri setelah aksesnya kembali."
            : platformAccount
              ? "Akun platform boleh punya workspace miliknya sendiri, tetapi tidak bisa menjadi anggota workspace orang lain. Kalau workspace ini bukan milik Anda, keluar lalu masuk dengan akun pemiliknya; kalau ini workspace Anda, muat ulang halaman untuk menyambungkannya."
              : "Muat ulang halaman untuk mencoba lagi. Kalau tetap gagal, masuk ulang dengan email yang sama."}
        </p>
      </div>
    </div>
  );
}

/**
 * Form masuk **tanpa kata sandi** — satu jalur untuk masuk dan daftar.
 *
 * Alurnya hanya dua langkah: tulis email → terima kode → masuk. Tidak ada tab
 * "Masuk"/"Daftar" dan tidak ada kata sandi, karena yang membedakan akun baru
 * dan akun lama hanyalah apakah baris `users` untuk email itu sudah ada — dan
 * itu ditentukan server saat kodenya terverifikasi, bukan oleh pilihan
 * pengguna.
 *
 * Dua implementasi, satu aturan:
 *
 *   - **mode Convex** memakai mutation `otp.requestCode`/`otp.verifyCode`, jadi
 *     kodenya benar-benar dikirim ke email oleh server;
 *   - **mode demo** (deployment belum tersambung) menjalankan aturan yang sama
 *     (`@/lib/otp`) di klien dan menampilkan kodenya di **kotak surat
 *     pengembangan** di layar. Kode itu tetap harus diketik, tetap berbatas
 *     waktu, dan tetap sekali pakai — yang tidak ada hanya pengirimannya, dan
 *     itu dikatakan apa adanya, bukan diklaim "email terkirim".
 *
 * Keduanya berbagi satu tampilan (`OtpFormView`), jadi tidak ada aturan yang
 * ditulis dua kali. Pemilihannya dilakukan sekali dengan merender salah satu
 * komponen — pola yang sama dengan `StoreProvider`, supaya tidak ada hook yang
 * dipanggil secara kondisional.
 */

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dataSource } from "@/lib/store/config";
import {
  checkEmail,
  defaultNameFromEmail,
  generateOtpCode,
  hashOtpCode,
  maskEmail,
  normalizeEmail,
  OTP_CODE_LENGTH,
  OTP_RESEND_COOLDOWN_MS,
  otpExpiresAt,
  randomSource,
  verifyOtpCode,
  type OtpRow,
} from "@/lib/otp";

export interface OtpSignInResult {
  email: string;
  /** Nama dari server; akun baru memakai nama wajar dari emailnya. */
  name?: string;
}

export interface OtpFormProps {
  onSignedIn: (result: OtpSignInResult) => void;
}

/** Sisa waktu tunggu dalam detik, diperbarui tiap detik selama masih menunggu. */
function useCountdown(until: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!until || until <= Date.now()) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      // Berhenti sendiri saat hitungannya habis, jadi tidak ada timer yang
      // terus berdetak sepanjang umur halaman.
      if (Date.now() >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);

  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

/** Hanya digit, dipotong sepanjang kode — tempelan dengan spasi tetap sah. */
function cleanCodeInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, OTP_CODE_LENGTH);
}

interface OtpFormViewProps {
  email: string;
  code: string;
  step: "email" | "code";
  busy: boolean;
  /** Pesan keadaan (mis. kode sudah dikirim ke email mana). */
  notice: string | null;
  error: string | null;
  /** Kode yang tampil di kotak surat pengembangan; hanya ada di mode demo. */
  devInbox: { code: string; expiresAt: number } | null;
  resendSeconds: number;
  onEmailChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onSubmitEmail: () => void;
  onSubmitCode: () => void;
  onResend: () => void;
  onBack: () => void;
}

function OtpFormView(props: OtpFormViewProps) {
  const canSubmitEmail = !props.busy && props.email.trim().length > 0;
  const canSubmitCode =
    !props.busy && props.code.length === OTP_CODE_LENGTH;

  return (
    <div className="space-y-5">
      {props.step === "email" ? (
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmitEmail) props.onSubmitEmail();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              value={props.email}
              onChange={(event) => props.onEmailChange(event.target.value)}
              placeholder="nama@bisnis.id"
              autoComplete="email"
              autoFocus
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={!canSubmitEmail}
          >
            {props.busy ? "Mengirim kode…" : "Kirim kode masuk"}
          </Button>
        </form>
      ) : (
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmitCode) props.onSubmitCode();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="otp">Kode {OTP_CODE_LENGTH} digit</Label>
            <Input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={props.code}
              onChange={(event) =>
                props.onCodeChange(cleanCodeInput(event.target.value))
              }
              placeholder={"0".repeat(OTP_CODE_LENGTH)}
              className="text-center text-xl font-semibold tracking-[0.4em]"
              autoFocus
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={!canSubmitCode}
          >
            {props.busy ? "Memeriksa kode…" : "Masuk"}
          </Button>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={props.onBack}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Ganti email
            </button>
            <button
              type="button"
              onClick={props.onResend}
              disabled={props.busy || props.resendSeconds > 0}
              className="text-primary transition-colors hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
            >
              {props.resendSeconds > 0
                ? `Kirim ulang dalam ${props.resendSeconds}s`
                : "Kirim ulang kode"}
            </button>
          </div>
        </form>
      )}

      {props.notice && (
        <p
          role="status"
          className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground"
        >
          {props.notice}
        </p>
      )}

      {props.error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {props.error}
        </p>
      )}

      {props.devInbox && (
        <div className="rounded-lg border border-dashed border-accent/50 bg-accent/10 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-accent">
            Kotak surat pengembangan
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Server belum tersambung, jadi emailnya tidak benar-benar berangkat.
            Kode di bawah sama dengan yang akan dikirim server:
          </p>
          {/*
            `data-otp-dev-inbox` menandai isi kotak surat pengembangan supaya
            harness render bisa membaca kode yang sama seperti yang dibaca
            pengguna, bukan menebak dari teks.
          */}
          <p
            data-otp-dev-inbox={props.devInbox.code}
            className="mt-2 font-mono text-2xl font-semibold tracking-[0.4em] text-foreground"
          >
            {props.devInbox.code}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Mode Convex: kode diminta & diperiksa server. Sisa waktu tunggu datang dari
 * server (`retryAfterMs`), bukan dihitung ulang di klien — supaya aturan kirim
 * ulang tetap milik server.
 */
function ConvexOtpForm({ onSignedIn }: OtpFormProps) {
  const requestCode = useMutation(api.otp.requestCode);
  const verifyCode = useMutation(api.otp.verifyCode);
  /**
   * Kesiapan saluran email, dibaca sebelum pengguna mengetik. Tanpa ini, satu-
   * satunya cara mengetahui email belum bisa dikirim adalah menekan tombol lalu
   * membaca penolakannya — jujur, tapi terlambat.
   */
  const status = useQuery(api.otp.status);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const resendSeconds = useCountdown(resendAt);
  const [pendingOtpId, setPendingOtpId] = useState<Id<"emailOtps"> | null>(
    null,
  );

  /**
   * Server **menjadwalkan** pengiriman, jadi jawaban `requestCode` yang `ok`
   * berarti kodenya sudah dicatat — belum tentu emailnya berangkat. Keadaan
   * kirim baris itu dibaca di sini, supaya kode yang ditolak penyedia email
   * (misalnya karena domain pengirim belum diverifikasi) tidak membuat
   * pengguna menunggu email yang tidak akan pernah datang.
   */
  const delivery = useQuery(
    api.otp.delivery,
    pendingOtpId ? { otpId: pendingOtpId } : "skip",
  );

  const send = useCallback(
    async (rawEmail: string, isResend: boolean) => {
      const emailCheck = checkEmail(rawEmail);
      if (!emailCheck.valid) {
        setError(emailCheck.reason ?? "Email tidak valid.");
        return;
      }
      const normalized = normalizeEmail(rawEmail);

      setBusy(true);
      setError(null);
      try {
        const result = await requestCode({ email: normalized });
        if (!result.ok) {
          setResendAt(
            result.retryAfterMs > 0 ? Date.now() + result.retryAfterMs : 0,
          );
          setError(result.reason ?? "Kode tidak bisa dikirim ke email itu.");
          return;
        }
        setEmail(normalized);
        setCode("");
        setStep("code");
        setResendAt(result.resendAt);
        setPendingOtpId(result.otpId);
        setNotice(
          isResend
            ? `Kode baru sudah dikirim ulang ke ${maskEmail(normalized)}.`
            : `Kode ${OTP_CODE_LENGTH} digit sudah dikirim ke ${maskEmail(normalized)}. Kodenya berlaku sebentar saja, jadi buka emailnya sekarang.`,
        );
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Kode gagal dikirim.",
        );
      } finally {
        setBusy(false);
      }
    },
    [requestCode],
  );

  const submitCode = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await verifyCode({ email, code });
      if (!result.ok) {
        setError(result.reason ?? "Kode tidak sesuai.");
        return;
      }
      setNotice(null);
      onSignedIn({ email: result.email, name: result.name });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Kode gagal diverifikasi.",
      );
    } finally {
      setBusy(false);
    }
  }, [code, email, onSignedIn, verifyCode]);

  return (
    <>
      {status && !status.emailConfigured && (
        <p
          role="status"
          className="mb-5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {status.reason ??
            "Pengiriman email belum dikonfigurasi di server."}{" "}
          Kode masuk belum bisa dikirim ke alamat email mana pun sampai server
          memiliki kunci penyedia email.
        </p>
      )}
      {delivery?.deliveryError && (
        <p
          role="alert"
          className="mb-5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Kode sudah dibuat, tetapi emailnya ditolak penyedia pengiriman — jadi
          tidak ada email yang berangkat: {delivery.deliveryError} Perbaiki
          pengirimnya dulu (alamat di `OTP_EMAIL_FROM` harus memakai domain yang
          sudah diverifikasi penyedia), lalu minta kode baru.
        </p>
      )}
      <OtpFormView
        step={step}
        email={email}
        code={code}
        busy={busy}
        notice={notice}
        error={error}
        devInbox={null}
        resendSeconds={resendSeconds}
        onEmailChange={(value) => {
          setEmail(value);
          setError(null);
        }}
        onCodeChange={(value) => {
          setCode(value);
          setError(null);
        }}
        onSubmitEmail={() => void send(email, false)}
        onSubmitCode={() => void submitCode()}
        onResend={() => void send(email, true)}
        onBack={() => {
          setStep("email");
          setCode("");
          setNotice(null);
          setError(null);
          setPendingOtpId(null);
        }}
      />
    </>
  );
}

/**
 * Mode demo: aturan yang sama dijalankan di klien. Kode yang dihasilkan adalah
 * kode sungguhan menurut aturan MesinPOS (6 digit acak, hash, 10 menit, sekali
 * pakai, 5 percobaan) — hanya pengirimannya yang diganti kotak surat di layar.
 */
function DemoOtpForm({ onSignedIn }: OtpFormProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [row, setRow] = useState<OtpRow | null>(null);
  const [devInbox, setDevInbox] = useState<{
    code: string;
    expiresAt: number;
  } | null>(null);
  const resendSeconds = useCountdown(resendAt);

  const send = useCallback(
    (rawEmail: string, isResend: boolean) => {
      const emailCheck = checkEmail(rawEmail);
      if (!emailCheck.valid) {
        setError(emailCheck.reason ?? "Email tidak valid.");
        return;
      }
      const normalized = normalizeEmail(rawEmail);
      const now = Date.now();
      if (!isResend && row && row.email !== normalized) {
        setRow(null);
      }
      if (resendAt > now) {
        setError(
          `Kode sudah dikirim. Tunggu ${Math.ceil((resendAt - now) / 1000)} detik sebelum minta kode lagi.`,
        );
        return;
      }

      const secret = generateOtpCode(randomSource());
      const expiresAt = otpExpiresAt(now);
      setRow({
        email: normalized,
        codeHash: hashOtpCode(secret, normalized),
        createdAt: now,
        expiresAt,
        attempts: 0,
        consumedAt: null,
      });
      setDevInbox({ code: secret, expiresAt });
      setEmail(normalized);
      setCode("");
      setStep("code");
      setResendAt(now + OTP_RESEND_COOLDOWN_MS);
      setError(null);
      setNotice(
        isResend
          ? `Kode baru dibuat untuk ${maskEmail(normalized)}.`
          : `Kode ${OTP_CODE_LENGTH} digit dibuat untuk ${maskEmail(normalized)}.`,
      );
    },
    [resendAt, row],
  );

  const submitCode = useCallback(() => {
    const now = Date.now();
    const decision = verifyOtpCode({
      row,
      code,
      email,
      codeHash: row?.codeHash ?? null,
      now,
    });

    if (!decision.ok) {
      if (row && decision.attempts !== row.attempts) {
        setRow({ ...row, attempts: decision.attempts });
      }
      setError(decision.reason ?? "Kode tidak sesuai.");
      return;
    }

    if (row) setRow({ ...row, consumedAt: now, attempts: decision.attempts });
    setError(null);
    setNotice(null);
    onSignedIn({ email, name: defaultNameFromEmail(email) });
  }, [code, email, onSignedIn, row]);

  return (
    <OtpFormView
      step={step}
      email={email}
      code={code}
      /* Aturan demo berjalan seketika: tidak ada permintaan jaringan yang harus ditunggu. */
      busy={false}
      notice={notice}
      error={error}
      devInbox={devInbox}
      resendSeconds={resendSeconds}
      onEmailChange={(value) => {
        setEmail(value);
        setError(null);
      }}
      onCodeChange={(value) => {
        setCode(value);
        setError(null);
      }}
      onSubmitEmail={() => send(email, false)}
      onSubmitCode={submitCode}
      onResend={() => send(email, true)}
      onBack={() => {
        setStep("email");
        setCode("");
        setNotice(null);
        setError(null);
      }}
    />
  );
}

/** Memilih implementasi sekali, bukan per render: tidak ada hook kondisional. */
export function OtpForm(props: OtpFormProps) {
  if (dataSource === "convex") return <ConvexOtpForm {...props} />;
  return <DemoOtpForm {...props} />;
}

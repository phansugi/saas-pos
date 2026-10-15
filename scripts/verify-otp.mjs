/**
 * Uji aturan masuk **tanpa kata sandi** (kode OTP email) tanpa deployment.
 *
 * Kenapa ada: jalur yang paling perlu dibuktikan justru yang sulit dipicu lewat
 * deployment — kode kedaluwarsa, kode yang sudah dipakai, kode terkunci setelah
 * percobaan salah, dan batas kirim ulang. Semuanya keputusan murni, jadi
 * diperiksa langsung di sini; `scripts/verify-backend.mjs` lalu memeriksa bahwa
 * deployment benar-benar memakai aturan yang sama.
 *
 * Usage: bun scripts/verify-otp.mjs
 */
import {
  checkEmail,
  defaultNameFromEmail,
  evaluateOtpRequest,
  generateOtpCode,
  hashOtpCode,
  isOtpCodeShape,
  isTestEmail,
  isTestLoginEnabled,
  maskEmail,
  normalizeEmail,
  otpCodeMatches,
  otpEmailContent,
  otpEmailFrom,
  otpExpiresAt,
  otpResendAt,
  otpStatus,
  OTP_CODE_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_PER_HOUR,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
  randomSource,
  resolveEmailTransport,
  resolveOtpCode,
  verifyOtpCode,
} from "../src/convex/lib/otp.ts";

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) throw new Error(`GAGAL: ${name} — ${detail ?? ""}`);
}

// --------------------------------------------------------------- email valid
// Email yang lolos di sini adalah email yang benar-benar bisa menerima kode —
// bentuknya harus `nama@domain.tld`.
check(
  "normalisasi email: spasi dibuang, huruf dikecilkan",
  normalizeEmail("  Budi@Toko.ID ") === "budi@toko.id",
  normalizeEmail("  Budi@Toko.ID "),
);
for (const email of ["budi@toko.id", "a@b.co.id", "kepala.toko+pos@bisnis.co.id"]) {
  check(`email valid diterima: ${email}`, checkEmail(email).valid);
}
for (const [email, problem] of [
  ["", "kosong"],
  ["   ", "kosong"],
  ["budi", "@"],
  ["budi@", "domain"],
  ["@toko.id", "sebelum @"],
  ["budi@toko", "titik"],
  ["budi @toko.id", "spasi"],
  ["budi@toko..id", "format"],
  ["budi@toko.id.", "format"],
  ["budi.@toko.id.", "format"],
]) {
  const result = checkEmail(email);
  check(`email tidak valid ditolak (${problem}): "${email}"`, !result.valid, JSON.stringify(result));
  check(
    `penolakan email "${email}" punya alasan Bahasa Indonesia`,
    typeof result.reason === "string" && result.reason.length > 10 && /[a-z]/.test(result.reason),
    String(result.reason),
  );
}
check(
  "email terlalu panjang ditolak",
  !checkEmail(`${"a".repeat(250)}@toko.id`).valid,
);
check(
  "email dengan local part > 64 karakter ditolak",
  !checkEmail(`${"a".repeat(65)}@toko.id`).valid,
);

// ------------------------------------------------------------------ kode OTP
{
  const fixed = (value) => () => value;
  check("kode 6 digit dari nol", generateOtpCode(fixed(0)) === "000000", generateOtpCode(fixed(0)));
  check(
    "kode tertinggi tetap 6 digit",
    generateOtpCode(fixed(0.999999)) === "999999",
    generateOtpCode(fixed(0.999999)),
  );
  check(
    "sumber acak yang mentok di 1 tidak menghasilkan digit tak sah",
    isOtpCodeShape(generateOtpCode(fixed(1))),
    generateOtpCode(fixed(1)),
  );

  const codes = new Set();
  for (let index = 0; index < 200; index += 1) {
    const code = generateOtpCode(randomSource());
    if (!isOtpCodeShape(code)) throw new Error(`kode tidak sah: ${code}`);
    codes.add(code);
  }
  check(`200 kode yang dihasilkan semuanya 6 digit (${codes.size} unik)`, codes.size > 100, `${codes.size} unik`);

  check("bentuk kode: hanya 6 angka", isOtpCodeShape("123456") && !isOtpCodeShape("12345") && !isOtpCodeShape("1234567") && !isOtpCodeShape("12a456") && !isOtpCodeShape(""));

  check(
    "kode tidak disimpan sebagai teks",
    hashOtpCode("123456", "budi@toko.id") !== "123456" &&
      !hashOtpCode("123456", "budi@toko.id").includes("123456"),
  );
  check(
    "hash kode terikat pada emailnya",
    hashOtpCode("123456", "budi@toko.id") !== hashOtpCode("123456", "siti@toko.id"),
  );
  check(
    "hash kode stabil untuk input yang sama",
    hashOtpCode("123456", "budi@toko.id") === hashOtpCode(" 123456 ", " Budi@Toko.ID "),
  );
  check(
    "pepper mengubah hash (rahasia deployment ikut mengikat)",
    hashOtpCode("123456", "budi@toko.id", "rahasia") !== hashOtpCode("123456", "budi@toko.id"),
  );
  check(
    "pencocokan kode memakai hash, bukan teks",
    otpCodeMatches({ code: "123456", email: "budi@toko.id", codeHash: hashOtpCode("123456", "budi@toko.id") }) &&
      !otpCodeMatches({ code: "123457", email: "budi@toko.id", codeHash: hashOtpCode("123456", "budi@toko.id") }),
  );

  // Kait pengujian yang sempit: kode tetap hanya berlaku untuk email berdomain
  // `.test` yang tidak bisa didaftarkan siapa pun.
  check("domain uji dikenali", isTestEmail("uji@mesinpos.test") && !isTestEmail("budi@toko.id") && !isTestEmail("budi@test.id"));
  check(
    "kode tetap dipakai hanya untuk email .test",
    resolveOtpCode({ email: "uji@mesinpos.test", devCode: "123456" }) === "123456",
  );
  check(
    "kode tetap diabaikan untuk email nyata",
    resolveOtpCode({ email: "budi@toko.id", devCode: "123456" }) !== "123456",
  );
  check(
    "kode tetap yang tidak berbentuk kode diabaikan",
    resolveOtpCode({ email: "uji@mesinpos.test", devCode: "abcdef" }) !== "abcdef" &&
      resolveOtpCode({ email: "uji@mesinpos.test", devCode: "12345" }) !== "12345",
  );
  check(
    "tanpa kode tetap, kode dibuat acak",
    isOtpCodeShape(resolveOtpCode({ email: "uji@mesinpos.test", devCode: "" })),
  );
  check(
    "kait kode tetap hanya aktif dengan kode sah + domain .test",
    isTestLoginEnabled("uji@mesinpos.test", "428913") &&
      !isTestLoginEnabled("budi@toko.id", "428913") &&
      !isTestLoginEnabled("uji@mesinpos.test", "") &&
      !isTestLoginEnabled("uji@mesinpos.test", "abcdef") &&
      !isTestLoginEnabled("uji@mesinpos.test", "12345"),
  );
}

// ------------------------------------------------------------------ umur kode
{
  const now = 1_700_000_000_000;
  check("masa hidup kode 10 menit", OTP_TTL_MS === 600_000 && otpExpiresAt(now) === now + 600_000);
  check("jeda kirim ulang 60 detik", OTP_RESEND_COOLDOWN_MS === 60_000 && otpResendAt(now) === now + 60_000);

  const row = { attempts: 0, expiresAt: otpExpiresAt(now), consumedAt: null };
  check("kode baru berstatus aktif", otpStatus(row, now) === "aktif");
  check("kode lewat masa hidup → kedaluwarsa", otpStatus(row, now + 600_001) === "kedaluwarsa");
  check("kode yang sudah dipakai → terpakai", otpStatus({ ...row, consumedAt: now + 1000 }, now + 2000) === "terpakai");
  check(
    "kode dengan percobaan habis → terkunci",
    otpStatus({ ...row, attempts: OTP_MAX_ATTEMPTS }, now) === "terkunci",
  );
  check(
    "kode terkunci mengalahkan kedaluwarsa (alasan yang lebih spesifik)",
    otpStatus({ ...row, attempts: OTP_MAX_ATTEMPTS, expiresAt: now - 1 }, now) === "terkunci",
  );
}

// --------------------------------------------------------------- batas kirim
{
  const now = 1_700_000_000_000;
  const fresh = evaluateOtpRequest({ now, recent: [] });
  check("email yang belum pernah minta kode boleh langsung", fresh.allowed && fresh.retryAfterMs === 0);

  const justSent = evaluateOtpRequest({ now, recent: [{ createdAt: now - 10_000, consumedAt: null }] });
  check(
    "permintaan kedua dalam 60 detik ditolak dengan sisa waktu",
    !justSent.allowed && justSent.retryAfterMs === 50_000 && justSent.reason.includes("50 detik"),
    JSON.stringify(justSent),
  );

  const consumed = evaluateOtpRequest({ now, recent: [{ createdAt: now - 10_000, consumedAt: now - 5_000 }] });
  check("kode yang sudah dipakai tidak menahan permintaan berikutnya", consumed.allowed, JSON.stringify(consumed));

  const oldEnough = evaluateOtpRequest({
    now,
    recent: [{ createdAt: now - OTP_RESEND_COOLDOWN_MS - 1, consumedAt: null }],
  });
  check("setelah 60 detik boleh minta lagi", oldEnough.allowed, JSON.stringify(oldEnough));

  const many = Array.from({ length: OTP_MAX_PER_HOUR }, (_, index) => ({
    createdAt: now - 5 * 60_000 - index * 1000,
    consumedAt: now - 4 * 60_000,
  }));
  const capped = evaluateOtpRequest({ now, recent: many });
  check(
    `batas ${OTP_MAX_PER_HOUR} kode per jam ditegakkan`,
    !capped.allowed && capped.retryAfterMs > 0 && capped.retryAfterMs <= 60 * 60_000,
    JSON.stringify(capped),
  );
  check(
    "sisa waktu tunggu tidak pernah negatif",
    evaluateOtpRequest({ now, recent: [{ createdAt: now, consumedAt: null }] }).retryAfterMs >= 0 &&
      capped.retryAfterMs >= 0,
  );
}

// ------------------------------------------------------- verifikasi & sekali pakai
{
  const now = 1_700_000_000_000;
  const email = "budi@toko.id";
  const code = "428913";
  const makeRow = (overrides = {}) => ({
    email,
    codeHash: hashOtpCode(code, email),
    createdAt: now,
    expiresAt: otpExpiresAt(now),
    attempts: 0,
    consumedAt: null,
    ...overrides,
  });

  const good = verifyOtpCode({ row: makeRow(), code, email, codeHash: hashOtpCode(code, email), now });
  check("kode benar diterima", good.ok && good.status === "terpakai", JSON.stringify(good));

  const wrong = verifyOtpCode({ row: makeRow(), code: "000000", email, codeHash: hashOtpCode(code, email), now });
  check(
    "kode salah ditolak dan menghitung percobaan",
    !wrong.ok && wrong.attempts === 1 && wrong.remainingAttempts === OTP_MAX_ATTEMPTS - 1 && wrong.reason.includes("Sisa 4"),
    JSON.stringify(wrong),
  );

  const wrongShape = verifyOtpCode({ row: makeRow(), code: "12a456", email, codeHash: hashOtpCode(code, email), now });
  check(
    "kode yang bukan 6 angka tidak pernah cocok (tetap dihitung)",
    !wrongShape.ok && wrongShape.attempts === 1,
    JSON.stringify(wrongShape),
  );

  const lastChance = verifyOtpCode({
    row: makeRow({ attempts: OTP_MAX_ATTEMPTS - 1 }),
    code: "000000",
    email,
    codeHash: hashOtpCode(code, email),
    now,
  });
  check(
    "percobaan salah terakhir mengunci kode",
    !lastChance.ok && lastChance.status === "terkunci" && lastChance.remainingAttempts === 0,
    JSON.stringify(lastChance),
  );

  const locked = verifyOtpCode({
    row: makeRow({ attempts: OTP_MAX_ATTEMPTS }),
    code,
    email,
    codeHash: hashOtpCode(code, email),
    now,
  });
  check(
    "kode terkunci ditolak walau kodenya benar",
    !locked.ok && locked.status === "terkunci" && locked.attempts === OTP_MAX_ATTEMPTS,
    JSON.stringify(locked),
  );

  const expired = verifyOtpCode({
    row: makeRow({ expiresAt: now - 1 }),
    code,
    email,
    codeHash: hashOtpCode(code, email),
    now,
  });
  check(
    "kode kedaluwarsa ditolak walau kodenya benar",
    !expired.ok && expired.status === "kedaluwarsa" && expired.attempts === 0,
    JSON.stringify(expired),
  );

  const reused = verifyOtpCode({
    row: makeRow({ consumedAt: now - 1_000 }),
    code,
    email,
    codeHash: hashOtpCode(code, email),
    now,
  });
  check(
    "kode sekali pakai: pemakaian kedua ditolak",
    !reused.ok && reused.status === "terpakai" && reused.attempts === 0,
    JSON.stringify(reused),
  );

  const noCode = verifyOtpCode({ row: null, code, email, codeHash: null, now });
  check(
    "email tanpa kode punya alasan sendiri (bukan \"kedaluwarsa\")",
    !noCode.ok && noCode.reason.includes("Belum ada kode"),
    JSON.stringify(noCode),
  );

  const otherEmail = verifyOtpCode({ row: makeRow(), code, email: "siti@toko.id", codeHash: hashOtpCode(code, email), now });
  check(
    "kode tidak bisa dipakai untuk email lain",
    !otherEmail.ok && otherEmail.attempts === 1,
    JSON.stringify(otherEmail),
  );

  // --- putaran penuh: minta kode → salah → benar → dipakai → baris ditandai
  const request = {
    code,
    row: makeRow(),
  };
  check("kode yang dikirim tersimpan sebagai hash saja", request.row.codeHash === hashOtpCode(code, email) && request.row.codeHash !== code);
  const roundTrip = verifyOtpCode({
    row: request.row,
    code,
    email,
    codeHash: request.row.codeHash,
    now,
  });
  const consumedRow = { ...request.row, consumedAt: now, attempts: roundTrip.attempts };
  check("putaran penuh: kode dari email masuk", roundTrip.ok);
  check("putaran penuh: barisnya ditandai terpakai", otpStatus(consumedRow, now + 1) === "terpakai");
  check(
    "putaran penuh: kode yang sama tidak bisa dipakai dua kali",
    !verifyOtpCode({ row: consumedRow, code, email, codeHash: consumedRow.codeHash, now: now + 2 }).ok,
  );
}

// --------------------------------------------------------- saluran & isi email
{
  const missing = resolveEmailTransport({});
  check(
    "tanpa kunci penyedia email, saluran belum siap dan alasannya menyebut variabelnya",
    missing.kind === "unconfigured" && missing.reason.includes("RESEND_API_KEY"),
    JSON.stringify(missing),
  );
  check(
    "kunci ada tapi pengirim belum → tetap belum siap (menyebut OTP_EMAIL_FROM)",
    resolveEmailTransport({ resendApiKey: "re_123" }).kind === "unconfigured" &&
      resolveEmailTransport({ resendApiKey: "re_123" }).reason.includes("OTP_EMAIL_FROM"),
  );
  check(
    "kunci + pengirim → saluran Resend siap",
    resolveEmailTransport({ resendApiKey: "re_123", from: "MesinPOS <otp@toko.id>" }).kind === "resend",
  );
  check(
    "kunci kosong dianggap belum diset",
    resolveEmailTransport({ resendApiKey: "   ", from: "a@b.id" }).kind === "unconfigured",
  );

  check(
    "pengirim email punya nilai bawaan",
    otpEmailFrom() === "MesinPOS <otp@mesinpos.id>" && otpEmailFrom(" otp@toko.id ") === "otp@toko.id",
  );

  const message = otpEmailContent({ code: "428913" });
  check("subjek email memuat kodenya", message.subject.includes("428913"), message.subject);
  check("isi email memuat kodenya", message.text.includes("428913"), message.text.slice(0, 60));
  check(
    "isi email menyebut masa berlaku & sekali pakai",
    message.text.includes("10 menit") && message.text.includes("sekali"),
    message.text,
  );
  check(
    "isi email memperingatkan pemilik akun, bukan hanya penerima kode",
    message.text.includes("tidak meminta kode ini"),
  );

  check(
    "nama awal dari email dirapikan",
    defaultNameFromEmail("kepala.toko@bisnis.id") === "kepala toko" &&
      defaultNameFromEmail("a@bisnis.id") === "Pemilik" &&
      defaultNameFromEmail("siti@bisnis.id") === "siti",
  );

  check(
    "email disamarkan saat ditampilkan",
    maskEmail("budi@toko.id") === "b***@toko.id" &&
      !maskEmail("budi@toko.id").includes("budi") &&
      maskEmail("a@toko.id").length > 0,
    maskEmail("budi@toko.id"),
  );
}

console.log(`${results.length}/${results.length} checks passed`);

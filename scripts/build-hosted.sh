#!/bin/sh
# Build command produksi: kirim fungsi Convex, **buktikan** fungsi itu ada di
# deployment yang dipakai situs, baru bangun situsnya.
#
# Tiga hal yang membuat skrip ini ada:
#
#   1. `convex deploy --cmd 'bun run build'` membuat satu kredensial yang salah
#      mematikan seluruh build tanpa penjelasan. Di sini setiap langkah mencetak
#      baris `DIAG` yang bisa dibaca dari log deploy.
#   2. "deploy sukses" dari CLI **bukan** bukti fungsi ada di deployment yang
#      dipakai situs — kunci bisa menunjuk deployment lain. Karena itu hasilnya
#      diverifikasi lewat HTTP (`scripts/convex-verify-push.mjs`), dan data
#      source situs ditentukan dari hasil verifikasi itu.
#   3. Nilai env produksi bisa sampai ke builder sebagai **amplop terenkripsi**
#      (lihat juga `scripts/build-diag.sh` untuk membaca seluruh baris DIAG)
#      (base64url JSON `{"c":…,"k":[…]}`), bukan teks biasa. Nilai seperti itu
#      tidak bisa dipakai `convex deploy` maupun Vite, jadi bentuknya dikenali
#      (`scripts/env-shape.mjs`) dan konfigurasi build yang bukan rahasia jatuh
#      ke nilai kanonik.
#
# Aman diulang: satu-satunya operasi tulis ke Convex adalah `convex deploy`
# (idempoten), selebihnya pembacaan.
set -u

NAME="${CONVEX_DEPLOYMENT_NAME:-mellow-narwhal-477}"
RAW="${CONVEX_DEPLOY_KEY:-}"
LOG=/tmp/convex-push.log
# Nilai kanonik untuk konfigurasi build. URL `.convex.cloud` memang publik: ia
# ikut terpanggang ke bundel klien. Bisa ditimpa lewat CONVEX_URL_OVERRIDE.
CANONICAL_URL="${CONVEX_URL_OVERRIDE:-https://${NAME}.convex.cloud}"

count_of() { printf '%s' "$1" | tr -cd "$2" | wc -c | tr -d ' '; }
host_of() { printf '%s' "$1" | sed -e 's#^[A-Za-z][A-Za-z0-9+.-]*://##' -e 's#/.*##'; }
is_convex_url() { case "$1" in https://*.convex.cloud*) return 0 ;; *) return 1 ;; esac; }
is_source_flag() { case "$1" in convex|demo) return 0 ;; *) return 1 ;; esac; }
# Nama deployment Convex selalu berbentuk `kata-kata-angka`.
valid_name() {
  case "$1" in
    ""|*[!a-z0-9-]*) return 1 ;;
    *-*-*) return 0 ;;
    *) return 1 ;;
  esac
}

echo "DIAG nilai env yang diterima builder (bentuknya saja):"
node scripts/env-shape.mjs VITE_DATA_SOURCE VITE_CONVEX_URL VITE_CONVEX_SITE_URL CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY 2>&1 ||
  echo "DIAG env-shape gagal dijalankan"
for berkas in .env .env.local .env.production .env.production.local; do
  if [ -f "$berkas" ]; then
    echo "DIAG berkas $berkas ada nama=$(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$berkas" | tr '\n' ',')"
  else
    echo "DIAG berkas $berkas tidak-ada"
  fi
done

# ------------------------------------------------------------ konfigurasi build
# Nilai env dipakai kalau bentuknya masuk akal; kalau tidak (amplop terenkripsi,
# kosong, atau bukan URL), nilai kanonik yang dipakai.
if [ -n "${CONVEX_URL_OVERRIDE:-}" ]; then
  EFF_URL="$CONVEX_URL_OVERRIDE"
  URL_ASAL="override"
elif is_convex_url "${VITE_CONVEX_URL:-}"; then
  EFF_URL="$VITE_CONVEX_URL"
  URL_ASAL="env"
else
  EFF_URL="$CANONICAL_URL"
  URL_ASAL="kanonik"
fi
APP_HOST="$(host_of "$EFF_URL")"

if is_source_flag "${VITE_DATA_SOURCE:-}"; then
  SOURCE_ASAL="env"
else
  SOURCE_ASAL="kanonik"
fi

echo "DIAG konfigurasi url_asal=$URL_ASAL host=$APP_HOST data_source_asal=$SOURCE_ASAL"

build_site() { # $1 = nilai VITE_DATA_SOURCE yang dipakai
  # Deploy diagnostik (membaca seluruh baris DIAG dari `freebuff-deploy logs`) hanya
  # jalan lewat build command `sh ./scripts/build-diag.sh`, yang menyalakan
  # BUILD_DIAG. Dulu ini dipicu oleh berkas penanda `scripts/.diag-stop`, dan
  # berkas yang tertinggal pernah menggagalkan deploy produksi — penanda env tidak
  # bisa tertinggal seperti itu. Deploy diagnostik memang sengaja gagal di sini.
  if [ "${BUILD_DIAG:-0}" = "1" ]; then
    echo "DIAG build-diag aktif (BUILD_DIAG=1): berhenti sebelum build situs supaya seluruh DIAG terbaca; deploy ini sengaja gagal"
    exit 1
  fi
  export VITE_CONVEX_URL="$EFF_URL"
  export VITE_DATA_SOURCE="$1"
  echo "DIAG build VITE_CONVEX_URL=$EFF_URL VITE_DATA_SOURCE=$1"
  bun run build
  code=$?
  echo "DIAG build exit=$code"
  exit "$code"
}

# Situs hanya boleh menunjuk Convex kalau fungsinya terbukti ada. Nilai env yang
# sah (`convex`/`demo`) selalu dihormati; kalau tidak terbaca, verifikasi yang
# menentukan.
decide_and_build() { # $1 = ya|tidak: apakah fungsi terbukti ada
  if [ "$SOURCE_ASAL" = "env" ]; then
    if [ "$VITE_DATA_SOURCE" = "convex" ] && [ "$1" != "ya" ]; then
      echo "DIAG gagal: VITE_DATA_SOURCE=convex tapi fungsi belum terbukti ada di $APP_HOST; build dibatalkan"
      exit 1
    fi
    build_site "$VITE_DATA_SOURCE"
  fi
  if [ "$1" = "ya" ]; then
    build_site convex
  fi
  echo "DIAG situs dibangun dengan data demo karena fungsi belum terbukti ada"
  build_site demo
}

# ------------------------------------------------------------------ bentuk kunci
key_name=""
claim_name=""
as_token="tidak"
# `pushed=0` berarti fungsi berhasil dikirim; dipakai juga oleh jalur env-file
# di bawah, jadi inisialisasinya di luar cabang "ada kunci / tidak ada kunci".
pushed=1
tried=""
if [ -z "$RAW" ]; then
  echo "DIAG push=DILEWATI CONVEX_DEPLOY_KEY kosong; mencoba kunci dari .env.local lewat env-file"
else
  awalan="lain"
  case "$RAW" in
    dev:*)
      awalan="dev:"
      key_name="${RAW#dev:}"
      key_name="${key_name%%|*}"
      ;;
    prod:*)
      awalan="prod:"
      key_name="${RAW#prod:}"
      key_name="${key_name%%|*}"
      ;;
    project:*) awalan="project:" ;;
    preview:*) awalan="preview:" ;;
  esac
  valid_name "$key_name" || key_name=""

  pipes=$(count_of "$RAW" '|')
  echo "DIAG kunci len=${#RAW} pipa=$pipes awalan=$awalan nama_di_kunci=${key_name:-tidak-terbaca} spasi=$(count_of "$RAW" ' ') kutip=$(count_of "$RAW" '"')"

  # Bentuk nilai kunci itu sendiri, tanpa mencetak isinya.
  probe="$(RAW_KEY="$RAW" node scripts/convex-key-probe.mjs 2>&1)" || probe="DIAG nilai probe-gagal"
  echo "$probe"
  claim_name="$(printf '%s\n' "$probe" | sed -n 's/^PROBE_NAME=//p' | head -n 1)"
  as_token="$(printf '%s\n' "$probe" | sed -n 's/^PROBE_AS_TOKEN=//p' | head -n 1)"

  try_key() { # $1 label, $2 nilai CONVEX_DEPLOY_KEY
    echo "DIAG coba[$1]"
    if CONVEX_DEPLOY_KEY="$2" node_modules/.bin/convex deploy >"$LOG" 2>&1; then
      echo "DIAG berhasil[$1]"
      return 0
    fi
    echo "DIAG gagal[$1]: $(tr '\n' ' ' <"$LOG" | cut -c1-200)"
    return 1
  }

  try_token() { # $1 label, $2 nilai CONVEX_DEPLOYMENT
    echo "DIAG coba[$1]"
    if CONVEX_OVERRIDE_ACCESS_TOKEN="$RAW" CONVEX_DEPLOYMENT="$2" \
      node_modules/.bin/convex deploy >"$LOG" 2>&1; then
      echo "DIAG berhasil[$1]"
      return 0
    fi
    echo "DIAG gagal[$1]: $(tr '\n' ' ' <"$LOG" | cut -c1-200)"
    return 1
  }

  # Kandidat prefiks untuk nilai yang kehilangan bagian depannya saat disalin.
  kandidat=""
  if [ "$pipes" -eq 0 ]; then
    for n in "$claim_name" "$key_name" "$NAME"; do
      [ -n "$n" ] || continue
      kandidat="$kandidat dev:$n|$RAW prod:$n|$RAW"
    done
    case "$RAW" in
      dev:*) kandidat="$kandidat dev:$NAME|${RAW#dev:}" ;;
      prod:*) kandidat="$kandidat prod:$NAME|${RAW#prod:}" ;;
      project:*) kandidat="$kandidat project:$NAME|${RAW#project:}" ;;
    esac
  fi

  coba_token() {
    [ "$as_token" = "ya" ] || return 1
    for dep in "dev:$claim_name" "dev:$key_name" "dev:$NAME" "prod:$NAME"; do
      case "$dep" in "dev:"|"prod:") continue ;; esac
      case " $tried " in *" $dep "*) continue ;; esac
      tried="$tried $dep"
      try_token "token:$dep" "$dep" && return 0
    done
    return 1
  }

  coba_kunci() {
    if [ "$pipes" -gt 0 ]; then
      try_key "apa-adanya" "$RAW" && return 0
    fi
    for cand in $kandidat; do
      case " $tried " in *" $cand "*) continue ;; esac
      tried="$tried $cand"
      try_key "rekonstruksi" "$cand" && return 0
    done
    return 1
  }

  # Nilai JWT lebih mungkin token akses; nilai lain lebih mungkin kunci deploy.
  if [ "$as_token" = "ya" ]; then
    coba_token && pushed=0
    [ "$pushed" -eq 0 ] || { coba_kunci && pushed=0; }
  else
    coba_kunci && pushed=0
    [ "$pushed" -eq 0 ] || { coba_token && pushed=0; }
  fi

fi

# Jalur yang tidak bergantung pada env produksi: CLI Convex membaca `.env.local`
# sendiri (opsi `--env-file` hanya menunjuk berkas lain), dan hosting ikut
# mengirim salinan `.env.local` dari workspace ke builder. Jadi kunci deploy yang
# ditaruh di env **workspace** bisa dipakai di sini. Nilai dari env produksi
# menimpa berkas itu — dan nilainya berbentuk amplop terenkripsi — jadi ketiga
# variabelnya dilepas dulu supaya berkas yang menentukan.
if [ "$pushed" -ne 0 ]; then
  echo "DIAG coba[env-file]"
  if env -u CONVEX_DEPLOY_KEY -u CONVEX_OVERRIDE_ACCESS_TOKEN -u CONVEX_DEPLOYMENT \
    node_modules/.bin/convex deploy >"$LOG" 2>&1; then
    echo "DIAG berhasil[env-file]"
    pushed=0
  else
    echo "DIAG gagal[env-file]: $(tr '\n' ' ' <"$LOG" | cut -c1-200)"
  fi
fi

# Push yang gagal bukan alasan berhenti: fungsi bisa saja sudah terkirim dari
# tempat lain (mis. Terminal workspace). Verifikasi di bawah yang menentukan.
[ "$pushed" -eq 0 ] || echo "DIAG push=GAGAL semua jalur kredensial ditolak server; lanjut ke verifikasi"

# ------------------------------------------------------------------ verifikasi
# Periksa deployment yang dipakai situs (`VITE_CONVEX_URL`) dan deployment yang
# ditunjuk kunci, karena CLI bisa mendarat di tempat lain tanpa peringatan.
targets="$EFF_URL"
for n in "$key_name" "$claim_name"; do
  [ -n "$n" ] || continue
  targets="$targets $n"
done

uniq=""
for t in $targets; do
  case " $uniq " in *" $t "*) continue ;; esac
  uniq="$uniq $t"
done
uniq="$(printf '%s' "$uniq" | sed -e 's/^ *//' -e 's/ *$//')"

if [ -z "$uniq" ]; then
  echo "DIAG verifikasi tidak bisa dijalankan: tidak ada nama deployment yang bisa diperiksa"
  decide_and_build tidak
fi

node scripts/convex-verify-push.mjs $uniq
vcode=$?
if [ "$vcode" -ne 0 ]; then
  echo "DIAG push=TIDAK-TERBUKTI fungsi belum ada di: $uniq"
  decide_and_build tidak
fi

echo "DIAG push=TERVERIFIKASI fungsi ada di: $uniq"
decide_and_build ya

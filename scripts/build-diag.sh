#!/bin/sh
# Build command **khusus deploy diagnostik**: menyalakan BUILD_DIAG supaya
# `scripts/build-hosted.sh` mencetak seluruh baris DIAG lalu berhenti sebelum
# build situs. Deploy ini memang berakhir gagal — itu satu-satunya cara membaca
# stdout build (`freebuff-deploy logs` hanya memuat log deploy yang gagal).
#
# Pakai:
#   freebuff-preview set-build "sh ./scripts/build-diag.sh"
#   freebuff-deploy check && freebuff-deploy start --json   # tunggu state: active/gagal
#   freebuff-deploy logs                                    # seluruh DIAG ada di sini
#   freebuff-preview set-build "sh ./scripts/build-hosted.sh"   # kembali normal
#
# Kenapa env, bukan berkas penanda: berkas penanda `scripts/.diag-stop` yang
# tertinggal pernah menggagalkan deploy produksi tanpa disadari. Build normal
# memakai BUILD_DIAG yang tidak disetel, jadi tidak ada berkas yang bisa
# membuatnya berhenti.
BUILD_DIAG=1
export BUILD_DIAG
exec sh ./scripts/build-hosted.sh

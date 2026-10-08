#!/usr/bin/env bash
#
# Ejecuta las pruebas del servidor de Calendar.
#
#   server/tests/run.sh [filtro]
#
# Variables: LUX (binario de Lux; por defecto el que compila CMake en ../../build).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
LUX="${LUX:-$(dirname "$ROOT")/build/vendor/lux/lux}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export CALENDAR_DB="$TMP/calendar.db"
export CALENDAR_PROXY=0

status=0
# Las pruebas del módulo nativo no necesitan la aplicación.
"$LUX" test "$HERE/rrule_test.lux" ${1:+-- "$1"} || status=1
# Las de la API van con la aplicación entera.
"$LUX" test "$ROOT/app" "$HERE/api_test.lux" ${1:+-- "$1"} || status=1
[ $status -eq 0 ] && echo "TODO CORRECTO" || echo "HAY FALLOS"
exit $status

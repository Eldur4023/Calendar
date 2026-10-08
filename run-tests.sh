#!/usr/bin/env bash
#
# Todas las pruebas de Calendar:
#   ./run-tests.sh
#
# Hace falta haber compilado Lux antes: cmake -S desktop -B build && cmake --build build --target lux-bin
# (las del servicio y las del módulo nativo rrule usan ese binario).
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
status=0
echo "== Lógica de la ventana (node)"
node "$ROOT/desktop/tests/logic.test.js" || status=1
echo "== Módulo rrule y servidor"
"$ROOT/server/tests/run.sh" || status=1
echo "== Sonda de QuemaOS"
"$ROOT/server/tests/quemaos.sh" || status=1
echo "== Servicio de escritorio contra un servidor real"
"$ROOT/desktop/tests/e2e.sh" || status=1
[ $status -eq 0 ] && echo "TODO CORRECTO" || echo "HAY FALLOS"
exit $status

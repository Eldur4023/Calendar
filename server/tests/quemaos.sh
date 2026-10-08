#!/usr/bin/env bash
#
# Pruebas de la sonda de QuemaOS (server/quemaos): arranca un servidor de Calendar de
# verdad, mide con él activo y después lo para para comprobar el «caído».
#
#   server/tests/quemaos.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
LUX="${LUX:-$(dirname "$ROOT")/build/vendor/lux/lux}"
PORT="${SERVER_PORT:-8196}"
TMP="$(mktemp -d)"
PID=""
cleanup() { [ -n "$PID" ] && kill "$PID" 2>/dev/null; wait 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

export CALENDAR_DB="$TMP/calendar.db" CALENDAR_PROXY=0 CALENDAR_URL="http://127.0.0.1:$PORT"
"$LUX" run "$ROOT/app" -- createuser sonda --password '${PW}' >/dev/null 2>&1
"$LUX" "$ROOT/app" --no-watch --port "$PORT" >"$TMP/server.log" 2>&1 &
PID=$!
for _ in $(seq 1 50); do curl -fs "$CALENDAR_URL/healthz" >/dev/null 2>&1 && break; sleep 0.2; done
curl -fs "$CALENDAR_URL/healthz" >/dev/null || { echo "el servidor no arranca"; cat "$TMP/server.log"; exit 1; }
export CALENDAR_TEST_TOKEN="$(curl -s -X POST "$CALENDAR_URL/api/login" -H 'Content-Type: application/json' \
  -d '{"username":"sonda","password":"${PW}"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')"

status=0
echo "== con el servidor activo"
"$LUX" test "$ROOT/quemaos" "$HERE/quemaos_test.lux" -- activo || status=1

echo "== con el servidor parado"
kill "$PID"; wait "$PID" 2>/dev/null; PID=""
"$LUX" test "$ROOT/quemaos" "$HERE/quemaos_test.lux" -- caido || status=1

echo "== el lanzador impone el rango de la suite y arranca en un puerto bueno"
mkdir -p "$TMP/opt" && cp "$LUX" "$TMP/opt/lux" && cp -r "$ROOT/quemaos" "$TMP/opt/quemaos" && cp "$ROOT/deploy/quemaos-run.sh" "$TMP/opt/"
for bad in 8000 9699 9800 abc; do
  out=$(CALENDAR_QUEMAOS_PORT=$bad "$TMP/opt/quemaos-run.sh" 2>&1); code=$?
  if [ $code -ne 0 ] && echo "$out" | grep -q "entre 9700 y 9799"; then echo "  ok    rechaza $bad"; else echo "  FAIL  acepta $bad ($code): $out"; status=1; fi
done
CALENDAR_QUEMAOS_PORT=9791 "$TMP/opt/quemaos-run.sh" >"$TMP/probe.log" 2>&1 & PID=$!
for _ in $(seq 1 50); do curl -fs http://127.0.0.1:9791/quemaos/status >/dev/null 2>&1 && break; sleep 0.2; done
body=$(curl -s http://127.0.0.1:9791/quemaos/status)
echo "$body" | grep -q '"id":"calendar"' && echo "  ok    responde en 9791 (con el servidor parado: $(echo "$body" | sed -E 's/.*"status":"([a-z]+)".*/\1/'))" || { echo "  FAIL  sin respuesta: $body"; status=1; }
[ $status -eq 0 ] && echo "TODO CORRECTO" || echo "HAY FALLOS"
exit $status

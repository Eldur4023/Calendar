#!/usr/bin/env bash
#
# Extremo a extremo del servicio de escritorio: arranca un servidor de Calendar de
# verdad (base de datos temporal) y lanza daemon_test.lux contra el servicio.
#
#   desktop/tests/e2e.sh [filtro]
#
# Variables: LUX (binario de Lux; por defecto el de ../../build), SERVER_PORT (8198).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$(dirname "$HERE")")"
LUX="${LUX:-$ROOT/build/vendor/lux/lux}"
PORT="${SERVER_PORT:-8198}"
TMP="$(mktemp -d)"
PID=""
cleanup() { [ -n "$PID" ] && kill "$PID" 2>/dev/null; wait 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

# Servidor.
export CALENDAR_DB="$TMP/server.db" CALENDAR_PROXY=0
"$LUX" "$ROOT/server/app" --no-watch --port "$PORT" >"$TMP/server.log" 2>&1 &
PID=$!
for _ in $(seq 1 50); do
    curl -fs "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break
    sleep 0.2
done
curl -fs "http://127.0.0.1:$PORT/healthz" >/dev/null || { echo "el servidor no arranca"; cat "$TMP/server.log"; exit 1; }

# Un notify-send de pega: apunta cómo lo llaman y sólo "entrega" si existe el fichero de permiso.
cat > "$TMP/notify-send" <<STUB
#!/bin/sh
echo "\$@" >> "$TMP/notify.log"
[ -e "$TMP/notify.ok" ]
STUB
chmod +x "$TMP/notify-send"
: > "$TMP/notify.log"
rm -f "$TMP/notify.ok"

# Servicio bajo prueba.
export CALENDAR_DAEMON_DB="$TMP/daemon.db" CALENDAR_DAEMON_HOME="$TMP"
export CALENDAR_NOTIFY_CMD="$TMP/notify-send" CALENDAR_TEST_NOTIFY_LOG="$TMP/notify.log" CALENDAR_TEST_NOTIFY_OK="$TMP/notify.ok"
export CALENDAR_TEST_SERVER="http://127.0.0.1:$PORT" CALENDAR_TEST_LUX="$LUX" CALENDAR_TEST_SERVER_APP="$ROOT/server/app"
"$LUX" test "$ROOT/desktop/daemon" "$HERE/daemon_test.lux" ${1:+-- "$1"}
status=$?
[ $status -eq 0 ] || { echo "--- registro del servidor ---"; tail -n 15 "$TMP/server.log"; }
exit $status

#!/bin/bash
#
# Lanzador de la sonda de QuemaOS (calendar-quemaos.service). Lee /etc/calendar/calendar.env:
#
#   CALENDAR_DB             la base del servidor (sólo se lee)
#   CALENDAR_QUEMAOS_PORT   puerto de la sonda: 9700-9799, el rango de la suite (9705)
#   CALENDAR_QUEMAOS_HOST   127.0.0.1; 0.0.0.0 si QuemaOS la consulta desde otra máquina
#   BIND_PORT               dónde escucha el servidor, para comprobar que responde (8100)
set -euo pipefail

_script="${BASH_SOURCE[0]}"
_dir="${_script%/*}"
[[ "$_dir" == "$_script" ]] && _dir="."
APP_DIR="$(cd "$_dir" && pwd)"

PORT="${CALENDAR_QUEMAOS_PORT:-9705}"
if ! [[ "$PORT" =~ ^97[0-9][0-9]$ ]]; then
    echo "CALENDAR_QUEMAOS_PORT debe estar entre 9700 y 9799 (es '$PORT')" >&2
    exit 1
fi
export CALENDAR_DB="${CALENDAR_DB:-/var/lib/calendar/calendar.db}"
# Calendar escucha en la IP de Tailscale, no en 127.0.0.1: la sonda lo comprueba ahí.
export CALENDAR_URL="${CALENDAR_URL:-http://${CALENDAR_HOST:-127.0.0.1}:${BIND_PORT:-8100}}"
export CALENDAR_QUEMAOS_PORT="$PORT"

echo "Sonda de QuemaOS en http://${CALENDAR_QUEMAOS_HOST:-127.0.0.1}:$PORT/quemaos/status"
exec "$APP_DIR/lux" "$APP_DIR/quemaos" --no-watch --port "$PORT"

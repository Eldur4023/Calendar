#!/bin/bash
#
# Lanzador del servicio. Lo ejecuta systemd; no se llama a mano.
#
# El shebang es la ruta absoluta a propósito, no "/usr/bin/env bash": la unidad
# puede restringir el PATH y con env el arranque fallaría.
#
# Lee /etc/calendar/calendar.env (que systemd ya ha cargado en el entorno):
#
#   BIND_PORT        Puerto de escucha de Lux (8100).
#   CALENDAR_HOST    Dirección de escucha (127.0.0.1: sólo nginx llega a Lux).
#   CALENDAR_DB      Fichero de la base de datos SQLite.
#   CALENDAR_PROXY   1 si hay un proxy delante (nginx) y se fía de X-Forwarded-For.
#   LUX_BIN          Binario de Lux (por defecto, /opt/calendar/lux).
#
# Lux resuelve CALENDAR_DB y CALENDAR_HOST al compilar (env() en app/app.lux), así
# que tienen que estar en el entorno antes de lanzarlo.

set -euo pipefail

_script="${BASH_SOURCE[0]}"
_dir="${_script%/*}"
[[ "$_dir" == "$_script" ]] && _dir="."
APP_DIR="$(cd "$_dir" && pwd)"

export CALENDAR_DB="${CALENDAR_DB:-/var/lib/calendar/calendar.db}"
BIND_PORT="${BIND_PORT:-8100}"
# Lux propio de Calendar (lleva el módulo rrule): no el del sistema, que puede ser el de otra app.
LUX_BIN="${LUX_BIN:-$APP_DIR/lux}"

if [[ ! -x "$LUX_BIN" ]]; then
    echo "No se encuentra el binario de Lux ($LUX_BIN). Reinstala con install.sh." >&2
    exit 1
fi

cd "$APP_DIR"
echo "Escuchando en http://127.0.0.1:$BIND_PORT (sin TLS: el cifrado lo pone nginx)"
# --no-watch: en producción no se vigilan los ficheros para recargar.
exec "$LUX_BIN" "$APP_DIR/app" --no-watch --port "$BIND_PORT"

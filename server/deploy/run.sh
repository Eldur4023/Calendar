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
#   CALENDAR_HOST    IP de Tailscale del servidor: Calendar escucha SÓLO ahí (no en la LAN ni en Internet).
#   CALENDAR_DB      Fichero de la base de datos SQLite.
#   CALENDAR_PROXY   0 (sin proxy: el cliente es el par de la conexión). 1 sólo si algún día hay uno delante.
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
HOST="${CALENDAR_HOST:-}"
if [[ -z "$HOST" || "$HOST" == 0.0.0.0 ]]; then
    echo "CALENDAR_HOST debe ser la IP de Tailscale (es '${HOST}'): Calendar no se expone a otras redes." >&2
    exit 1
fi
# Tras un reinicio, tailscaled puede tardar en poner la IP en la interfaz: se espera en vez de fallar.
# Se mira /proc/net/fib_trie y no `ip addr`: `ip` habla por netlink, que la unidad de systemd no permite
# (RestrictAddressFamilies), y dentro del servicio fallaba en silencio.
tiene_ip() { grep -qF -- "|-- $HOST" /proc/net/fib_trie 2>/dev/null; }
if [[ "$HOST" != 127.0.0.1 ]]; then
    for _ in $(seq 1 90); do tiene_ip && break; sleep 1; done
    tiene_ip || { echo "La IP $HOST no está en ninguna interfaz (¿tailscaled?)." >&2; exit 1; }
fi
echo "Escuchando en http://$HOST:$BIND_PORT (red de Tailscale; el tráfico ya va cifrado por WireGuard)"
# --no-watch: en producción no se vigilan los ficheros para recargar.
exec "$LUX_BIN" "$APP_DIR/app" --no-watch --port "$BIND_PORT"

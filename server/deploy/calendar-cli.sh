#!/usr/bin/env bash
#
# Órdenes de administración de una instalación de servidor. Se instala como
# /usr/local/bin/calendar-cli.
#
#   sudo calendar-cli createuser NOMBRE [--password P]
#   sudo calendar-cli passwd NOMBRE [--password P]
#   sudo calendar-cli listusers
#   sudo calendar-cli totp NOMBRE [--off]       segundo factor (muestra el secreto)
#   sudo calendar-cli disable NOMBRE            desactiva la cuenta y cierra sus sesiones
#   sudo calendar-cli maintenance
#
# Es un envoltorio de `lux run` (app/routes/commands.lux): carga
# /etc/calendar/calendar.env y ejecuta la orden como el usuario del servicio, para
# que los ficheros que cree tengan el dueño correcto.

set -euo pipefail

ENV_FILE="${CALENDAR_ENV_FILE:-/etc/calendar/calendar.env}"
APP_DIR="${CALENDAR_APP_DIR:-/opt/calendar}"
SERVICE_USER=calendar

uso() {
    sed -n '3,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit "${1:-1}"
}

comando="${1:-}"
[[ -z "$comando" || "$comando" == "-h" || "$comando" == "--help" ]] && uso 0

if [[ ! -r "$ENV_FILE" ]]; then
    echo "No puedo leer $ENV_FILE. ¿Está Calendar instalado? ¿Usas sudo?" >&2
    exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Como el usuario del servicio si somos root; tal cual en el resto de casos.
if [[ $EUID -eq 0 ]] && id "$SERVICE_USER" &>/dev/null; then
    exec sudo -E -u "$SERVICE_USER" "$APP_DIR/lux" run "$APP_DIR/app" -- "$@"
fi
exec "$APP_DIR/lux" run "$APP_DIR/app" -- "$@"

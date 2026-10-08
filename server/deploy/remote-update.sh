#!/usr/bin/env bash
#
# Actualiza el código de una instalación ya existente, sin tocar la base de datos
# ni calendar.env. Si el servicio no arranca con el código nuevo, vuelve a la
# versión anterior.
#
# No se ejecuta a mano: lo lanza deploy.sh sobre el servidor. Para una instalación
# desde cero, usa install.sh.
#
#   sudo bash deploy/remote-update.sh [PUERTO_HEALTHZ]

set -euo pipefail

APP_DIR=/opt/calendar
ENV_FILE=/etc/calendar/calendar.env
SERVICE_USER=calendar

# El puerto se toma del propio servidor salvo que se indique otro: así la
# comprobación final no falla por haberlo cambiado allí.
HEALTH_PORT="${1:-}"
if [[ -z "$HEALTH_PORT" && -f "$ENV_FILE" ]]; then
    HEALTH_PORT="$(grep -E '^BIND_PORT=' "$ENV_FILE" | cut -d= -f2 || true)"
fi
HEALTH_PORT="${HEALTH_PORT:-8100}"

if [[ $EUID -ne 0 ]]; then
    echo "Ejecútalo como root (sudo)." >&2
    exit 1
fi
if [[ ! -f "$APP_DIR/app/app.lux" ]]; then
    echo "No hay ninguna instalación en $APP_DIR. Usa install.sh." >&2
    exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREVIOUS="$APP_DIR/previous"

# Antes de parar nada: ¿compila el código nuevo con el Lux nuevo?
NEW_LUX="$APP_DIR/lux"
[[ -f "$SOURCE_DIR/lux" ]] && NEW_LUX="$SOURCE_DIR/lux"
echo "==> Comprobando que el código nuevo compila"
CALENDAR_DB=/dev/null "$NEW_LUX" --check "$SOURCE_DIR/app" >/dev/null

echo "==> Guardando la versión anterior"
rm -rf "$PREVIOUS"
mkdir -p "$PREVIOUS"
cp -a "$APP_DIR/app" "$APP_DIR/lux" "$APP_DIR/run.sh" "$APP_DIR/deploy" "$PREVIOUS/"
cp /etc/systemd/system/calendar.service "$PREVIOUS/calendar.service"

restaurar() {
    echo "!!! La actualización ha fallado: se vuelve a la versión anterior." >&2
    systemctl stop calendar || true
    rm -rf "$APP_DIR/app" "$APP_DIR/deploy"
    mv "$PREVIOUS/app" "$APP_DIR/app"
    mv "$PREVIOUS/deploy" "$APP_DIR/deploy"
    install -m 755 "$PREVIOUS/lux" "$APP_DIR/lux"
    install -m 755 "$PREVIOUS/run.sh" "$APP_DIR/run.sh"
    cp "$PREVIOUS/calendar.service" /etc/systemd/system/calendar.service
    rm -rf "$PREVIOUS"
    systemctl daemon-reload
    systemctl start calendar || true
    journalctl -u calendar -n 30 --no-pager >&2 || true
    exit 1
}
trap restaurar ERR

echo "==> Parando el servicio"
systemctl stop calendar

echo "==> Instalando el código nuevo"
rm -rf "$APP_DIR/app" "$APP_DIR/deploy"
cp -r "$SOURCE_DIR/app" "$APP_DIR/app"
cp -r "$SOURCE_DIR/deploy" "$APP_DIR/deploy"
rm -f "$APP_DIR/deploy/lux"
install -m 755 "$NEW_LUX" "$APP_DIR/lux"
install -m 755 "$SOURCE_DIR/deploy/run.sh" "$APP_DIR/run.sh"
cp "$SOURCE_DIR/deploy/calendar.service" /etc/systemd/system/calendar.service
install -m 755 "$SOURCE_DIR/deploy/calendar-cli.sh" /usr/local/bin/calendar-cli
chown -R root:"$SERVICE_USER" "$APP_DIR"
chmod -R g+rX "$APP_DIR"
chown -R root:"$SERVICE_USER" "$APP_DIR"
systemctl daemon-reload

echo "==> Arrancando el servicio"
systemctl start calendar

echo "==> Esperando a que responda"
ok=0
for _ in $(seq 1 20); do
    if curl -fsS --max-time 3 "http://127.0.0.1:$HEALTH_PORT/healthz" >/dev/null 2>&1; then
        ok=1
        break
    fi
    sleep 1
done
[[ $ok -eq 1 ]]    # si no, salta el trap y se restaura

trap - ERR
rm -rf "$PREVIOUS"
echo
echo "Calendar actualizado y respondiendo en http://127.0.0.1:$HEALTH_PORT"

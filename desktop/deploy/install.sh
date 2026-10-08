#!/usr/bin/env bash
# Instala Calendar de escritorio: el servicio (réplica, sincronización y avisos) como
# servicio de sistema y la ventana como aplicación.
#
#   sudo ./desktop/deploy/install.sh [--user NOMBRE]     instalar o actualizar
#   sudo ./desktop/deploy/install.sh --uninstall         quitarlo (no borra /var/lib/calendar-daemon)
#
# Antes: cmake -S desktop -B build && cmake --build build --target lux-bin calendar-desktop
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "ejecútalo con sudo" >&2; exit 1; }
HERE=$(cd "$(dirname "$0")/.." && pwd)        # .../desktop
REPO=$(cd "$HERE/.." && pwd)
BUILD="$REPO/build"
APP_USER=${SUDO_USER:-}
UNINSTALL=0
while [ $# -gt 0 ]; do
  case $1 in
    --user) APP_USER=$2; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "opción desconocida: $1" >&2; exit 2 ;;
  esac
done

if [ $UNINSTALL -eq 1 ]; then
  systemctl disable --now calendar-daemon.service 2>/dev/null || true
  rm -f /etc/systemd/system/calendar-daemon.service /usr/local/bin/calendar-desktop /usr/share/applications/calendar-desktop.desktop /usr/share/icons/hicolor/256x256/apps/calendar-desktop.png
  rm -rf /opt/calendar-desktop
  systemctl daemon-reload
  echo "Desinstalado. Tu calendario local (/var/lib/calendar-daemon) se ha conservado."
  exit 0
fi

[ -n "$APP_USER" ] && [ "$APP_USER" != root ] || { echo "indica el usuario dueño del calendario: --user NOMBRE" >&2; exit 2; }
id "$APP_USER" >/dev/null || { echo "no existe el usuario $APP_USER" >&2; exit 2; }
LUX="$BUILD/vendor/lux/lux"
[ -x "$LUX" ] || { echo "falta $LUX: compila primero (cmake --build build --target lux-bin calendar-desktop)" >&2; exit 1; }
[ -x "$BUILD/calendar-desktop" ] || { echo "falta $BUILD/calendar-desktop: compila primero" >&2; exit 1; }
command -v notify-send >/dev/null || echo "aviso: falta notify-send (paquete libnotify-bin): no saldrán notificaciones de escritorio" >&2

# Zona horaria del equipo, para las horas de los avisos.
TZ_NAME=$(timedatectl show -p Timezone --value 2>/dev/null || true)
[ -n "$TZ_NAME" ] || TZ_NAME=$(cat /etc/timezone 2>/dev/null || true)
[ -n "$TZ_NAME" ] || TZ_NAME=UTC
APP_UID=$(id -u "$APP_USER")

echo "==> Instalando en /opt/calendar-desktop (usuario: $APP_USER, zona: $TZ_NAME)"
install -d /opt/calendar-desktop
install -m 0755 "$LUX" /opt/calendar-desktop/lux
rm -rf /opt/calendar-desktop/daemon
cp -r "$HERE/daemon" /opt/calendar-desktop/daemon
CALENDAR_DAEMON_DB=/dev/null /opt/calendar-desktop/lux --check /opt/calendar-desktop/daemon

# Para que la ventana busque actualizaciones: de qué repositorio y commit se instaló.
echo "$REPO" > /opt/calendar-desktop/source
runuser -u "$APP_USER" -- git -C "$REPO" rev-parse HEAD > /opt/calendar-desktop/version 2>/dev/null || rm -f /opt/calendar-desktop/version

install -m 0755 "$BUILD/calendar-desktop" /usr/local/bin/calendar-desktop
install -Dm 0644 "$HERE/app/icon.png" /usr/share/icons/hicolor/256x256/apps/calendar-desktop.png
install -Dm 0644 "$HERE/deploy/calendar-desktop.desktop" /usr/share/applications/calendar-desktop.desktop
# Sin esto el lanzador puede seguir mostrando el icono anterior.
gtk-update-icon-cache -qf /usr/share/icons/hicolor 2>/dev/null || true

sed -e "s/@USER@/$APP_USER/" -e "s/@UID@/$APP_UID/" -e "s#@TZ@#$TZ_NAME#" "$HERE/deploy/calendar-daemon.service" > /etc/systemd/system/calendar-daemon.service
systemctl daemon-reload
systemctl enable calendar-daemon.service
systemctl restart calendar-daemon.service

echo "==> Esperando a que arranque…"
for _ in $(seq 20); do
  if curl -fs -o /dev/null http://127.0.0.1:7879/healthz; then ok=1; break; fi
  sleep 1
done
[ "${ok:-0}" = 1 ] || { journalctl -u calendar-daemon -n 20 --no-pager; echo "el servicio no arrancó" >&2; exit 1; }
echo
echo "Listo. El servicio sincroniza y lanza los avisos solo, incluso sin sesión iniciada."
echo "  estado:    systemctl status calendar-daemon"
echo "  registro:  journalctl -u calendar-daemon -f"
echo "  ventana:   calendar-desktop        (la primera vez te pide el servidor y tu cuenta)"

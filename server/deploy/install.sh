#!/usr/bin/env bash
#
# Instalación de Calendar (servidor) en Ubuntu Server (22.04 / 24.04).
#
#   sudo bash deploy/install.sh
#
# Deja el servicio escuchando en 127.0.0.1:8100 bajo systemd. El TLS (nginx) se
# configura aparte con deploy/setup-tls.sh. Convive con Drive en la misma máquina:
# otro usuario, otro puerto, otra base de datos y SU PROPIO binario de Lux
# (/opt/calendar/lux, con el módulo rrule), sin tocar el /usr/local/bin/lux de Drive.
#
# El binario de Lux sale de, por orden:
#   1. LUX_BIN=/ruta/a/lux     un binario ya compilado.
#   2. un fichero "lux" junto a deploy/ (lo envía deploy.sh).

set -euo pipefail

APP_DIR=/opt/calendar
DATA_DIR=/var/lib/calendar
ENV_DIR=/etc/calendar
SERVICE_USER=calendar

if [[ $EUID -ne 0 ]]; then
    echo "Ejecútalo como root (sudo)." >&2
    exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

LUX_SRC_BIN="${LUX_BIN:-}"
[[ -z "$LUX_SRC_BIN" && -f "$SOURCE_DIR/lux" ]] && LUX_SRC_BIN="$SOURCE_DIR/lux"
if [[ -z "$LUX_SRC_BIN" || ! -f "$LUX_SRC_BIN" ]]; then
    echo "No hay binario de Lux. Pásalo con LUX_BIN=/ruta/lux (deploy.sh lo envía solo)." >&2
    exit 1
fi

echo "==> Instalando dependencias del sistema"
apt-get update -qq
# Bibliotecas que enlaza el binario de Lux, nginx para el TLS, openssl, libargon2
# (hashes de contraseña), tzdata (zonas horarias de las repeticiones) y qrencode,
# opcional, para dibujar el QR del segundo factor.
apt-get install -y --no-install-recommends \
    ca-certificates curl openssl nginx qrencode \
    libsqlite3-0 libcurl4 libwebp7 libpng16-16 libjpeg-turbo8 libcairo2 \
    libjemalloc2 libpq5 libmysqlclient21 zlib1g libargon2-1 tzdata

echo "==> Creando el usuario de servicio"
if ! id "$SERVICE_USER" &>/dev/null; then
    adduser --system --group --home "$DATA_DIR" --no-create-home "$SERVICE_USER"
fi

echo "==> Copiando la aplicación a $APP_DIR"
mkdir -p "$APP_DIR"
# Se borra el código anterior en vez de copiar encima: si no, un fichero que
# se haya eliminado del proyecto seguiría vivo en el servidor.
rm -rf "$APP_DIR/app" "$APP_DIR/deploy" "$APP_DIR/quemaos"
cp -r "$SOURCE_DIR/app" "$APP_DIR/app"
cp -r "$SOURCE_DIR/quemaos" "$APP_DIR/quemaos"
install -m 755 "$LUX_SRC_BIN" "$APP_DIR/lux"
cp "$SOURCE_DIR/deploy/run.sh" "$APP_DIR/run.sh"
cp "$SOURCE_DIR/deploy/quemaos-run.sh" "$APP_DIR/quemaos-run.sh"
chmod 755 "$APP_DIR/run.sh" "$APP_DIR/quemaos-run.sh"
# Los scripts de operación quedan en el servidor: setup-tls.sh y la plantilla de
# nginx hacen falta después de instalar, no sólo durante.
cp -r "$SOURCE_DIR/deploy" "$APP_DIR/deploy"
rm -f "$APP_DIR/deploy/lux"

echo "==> Comprobando que la aplicación compila con este Lux"
CALENDAR_DB=/dev/null "$APP_DIR/lux" --check "$APP_DIR/app" >/dev/null
CALENDAR_DB=/dev/null "$APP_DIR/lux" --check "$APP_DIR/quemaos" >/dev/null

echo "==> Preparando los directorios de datos"
mkdir -p "$DATA_DIR" "$ENV_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"

if [[ ! -f "$ENV_DIR/calendar.env" ]]; then
    cat > "$ENV_DIR/calendar.env" <<ENV
# Configuración de Calendar. Lo lee systemd y deploy/calendar-cli.sh.
CALENDAR_DB=$DATA_DIR/calendar.db

# Puerto de Lux (lo lee run.sh). Escucha sólo en el bucle local; nginx lo expone
# (deploy/setup-tls.sh). Con nginx delante déjalo en 1: se fía de X-Forwarded-For.
BIND_PORT=8100
CALENDAR_PROXY=1

# Sonda de estado para QuemaOS: su propio puerto, del rango 9700-9799 de la suite. Escucha sólo en
# 127.0.0.1; pon CALENDAR_QUEMAOS_HOST=0.0.0.0 si QuemaOS la consulta desde otra máquina.
CALENDAR_QUEMAOS_PORT=9705
ENV
    chmod 640 "$ENV_DIR/calendar.env"
    chown root:"$SERVICE_USER" "$ENV_DIR/calendar.env"
    echo "    configuración creada en $ENV_DIR/calendar.env"
else
    echo "    $ENV_DIR/calendar.env ya existe: se conserva."
fi

chown -R root:"$SERVICE_USER" "$APP_DIR"
chmod -R g+rX "$APP_DIR"

echo "==> Instalando el servicio"
cp "$SOURCE_DIR/deploy/calendar.service" /etc/systemd/system/calendar.service
cp "$SOURCE_DIR/deploy/calendar-cli.sh" /usr/local/bin/calendar-cli
chmod 755 /usr/local/bin/calendar-cli
cp "$SOURCE_DIR/deploy/calendar-quemaos.service" /etc/systemd/system/calendar-quemaos.service
systemctl daemon-reload
systemctl enable calendar.service calendar-quemaos.service
systemctl restart calendar.service

PUERTO="$(grep -E '^BIND_PORT=' "$ENV_DIR/calendar.env" | cut -d= -f2)"
PUERTO="${PUERTO:-8100}"

for _ in $(seq 1 20); do
    if curl -fsS --max-time 3 "http://127.0.0.1:$PUERTO/healthz" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

systemctl restart calendar-quemaos.service
QPORT="$(grep -E '^CALENDAR_QUEMAOS_PORT=' "$ENV_DIR/calendar.env" | cut -d= -f2)"
QPORT="${QPORT:-9705}"
sleep 2

echo
if curl -fsS --max-time 3 "http://127.0.0.1:$QPORT/quemaos/status" >/dev/null 2>&1; then
    echo "Sonda de QuemaOS en http://127.0.0.1:$QPORT/quemaos/status"
else
    echo "aviso: la sonda de QuemaOS no responde (journalctl -u calendar-quemaos)" >&2
fi
if curl -fsS --max-time 3 "http://127.0.0.1:$PUERTO/healthz" >/dev/null 2>&1; then
    echo "Calendar responde en http://127.0.0.1:$PUERTO"
else
    echo "El servicio no responde todavía. Revisa:" >&2
    echo "  systemctl status calendar; journalctl -u calendar -n 50" >&2
    exit 1
fi
echo
echo "Crea tu cuenta con:"
echo "  sudo calendar-cli createuser TUUSUARIO"
echo
echo "Ahora sólo es accesible desde la propia máquina y sin cifrar. Para exponerlo"
echo "(con un nombre distinto del de Drive si comparten el puerto 443):"
echo "  sudo bash $APP_DIR/deploy/setup-tls.sh letsencrypt calendar.tudominio tu@correo 443"
echo "  sudo bash $APP_DIR/deploy/setup-tls.sh self-signed 192.168.1.20 4123"

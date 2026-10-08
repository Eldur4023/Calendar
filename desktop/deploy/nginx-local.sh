#!/usr/bin/env bash
#
# Da de alta calendar.lan en el nginx de ESTE equipo (el portátil), apuntando a Calendar por Tailscale.
#
#   sudo ./desktop/deploy/nginx-local.sh              instalar (o actualizar)
#   sudo ./desktop/deploy/nginx-local.sh --quitar     quitarlo
#
# Hace: copia el sitio a /etc/nginx/sites-available/calendar.lan, lo activa, añade
# «127.0.0.1 calendar.lan» a /etc/hosts, comprueba la configuración y recarga nginx.
# Si la comprobación falla, deja todo como estaba.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "ejecútalo con sudo" >&2; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
SITE=/etc/nginx/sites-available/calendar.lan
LINK=/etc/nginx/sites-enabled/calendar.lan
NAME=calendar.lan

if [ "${1:-}" = "--quitar" ]; then
  rm -f "$LINK" "$SITE"
  sed -i "/[[:space:]]$NAME\$/d" /etc/hosts
  nginx -t && systemctl reload nginx
  echo "calendar.lan quitado."
  exit 0
fi

command -v nginx >/dev/null || { echo "nginx no está instalado en este equipo" >&2; exit 1; }
[ -d /etc/nginx/sites-available ] || { echo "no encuentro /etc/nginx/sites-available" >&2; exit 1; }

previo=""; [ -f "$SITE" ] && previo=$(mktemp) && cp "$SITE" "$previo"
cp "$HERE/calendar.lan.nginx.conf" "$SITE"
ln -sf "$SITE" "$LINK"
if ! nginx -t; then
  echo "!!! nginx -t falla: se deshace." >&2
  rm -f "$LINK"
  if [ -n "$previo" ]; then cp "$previo" "$SITE"; ln -sf "$SITE" "$LINK"; else rm -f "$SITE"; fi
  exit 1
fi
grep -qE "[[:space:]]$NAME(\$|[[:space:]])" /etc/hosts || printf '127.0.0.1\t%s\n' "$NAME" >> /etc/hosts
systemctl reload nginx

echo "Listo: http://$NAME  ->  Calendar (por Tailscale)"
if curl -fsS --max-time 5 "http://$NAME/healthz" 2>/dev/null; then echo; else
  echo "(no responde todavía: ¿Tailscale activo en este equipo? curl http://100.89.87.71:8100/healthz)"; fi

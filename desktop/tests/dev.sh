#!/usr/bin/env bash
#
# Entorno de desarrollo: un servidor de Calendar de pega, el servicio y la ventana,
# todo con datos temporales y con eventos de ejemplo.
#
#   desktop/tests/dev.sh            abre la ventana (Ctrl+C para cerrar todo)
#   desktop/tests/dev.sh --no-window   sólo servidor y servicio (puertos 8198 y 7879)
#
# Hay que compilar antes: cmake -S desktop -B build && cmake --build build
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LUX="$ROOT/build/vendor/lux/lux"
TMP="$(mktemp -d)"
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

export CALENDAR_DB="$TMP/server.db" CALENDAR_PROXY=0
"$LUX" run "$ROOT/server/app" -- createuser demo --password '${PW}' >/dev/null 2>&1
"$LUX" "$ROOT/server/app" --no-watch --port 8198 >"$TMP/server.log" 2>&1 & PIDS+=($!)

export CALENDAR_DAEMON_DB="$TMP/daemon.db" CALENDAR_DAEMON_HOME="$TMP" CALENDAR_DAEMON_PORT=7879 CALENDAR_NOTIFY_CMD=true
"$LUX" --no-watch "$ROOT/desktop/daemon" >"$TMP/daemon.log" 2>&1 & PIDS+=($!)
for _ in $(seq 1 50); do curl -fs http://127.0.0.1:7879/healthz >/dev/null 2>&1 && curl -fs http://127.0.0.1:8198/healthz >/dev/null 2>&1 && break; sleep 0.2; done

python3 - "$TMP" <<'PY'
import json, sys, time, datetime as dt, urllib.request
tmp = sys.argv[1]
tok = open(tmp + "/api-token").read().strip()
def call(method, path, body=None):
    r = urllib.request.Request("http://127.0.0.1:7879" + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                               headers={"X-Calendar-Token": tok, "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(r))
call("POST", "/api/settings", {"server_url": "http://127.0.0.1:8198", "username": "demo", "password": "${PW}"})
call("POST", "/api/sync")
today = dt.datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
def ms(d): return int(d.timestamp() * 1000)
def utc_day(d): return int(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).timestamp() * 1000)
def ev(i, cal, title, d, h, m, mins, **kw):
    s = d + dt.timedelta(hours=h, minutes=m)
    o = {"op": "event.put", "id": "demo-ev-%04d" % i, "calendar_id": cal, "title": title, "start": ms(s), "end": ms(s) + mins * 60000,
         "all_day": False, "tzid": "Europe/Madrid", "reminders": [10]}
    o.update(kw); return o
mon = today - dt.timedelta(days=today.weekday())
D = lambda n: mon + dt.timedelta(days=n)
ops = [
  {"op": "cal.put", "id": "demo-cal-0001", "name": "Personal", "color": "#d97757", "position": 0},
  {"op": "cal.put", "id": "demo-cal-0002", "name": "Trabajo", "color": "#60a5fa", "position": 1},
  {"op": "cal.put", "id": "demo-cal-0003", "name": "Familia", "color": "#10b981", "position": 2},
  ev(1, "demo-cal-0002", "Reunión de equipo", D(0), 10, 0, 60),
  ev(2, "demo-cal-0002", "Revisión de diseño", D(0), 10, 30, 90),
  ev(3, "demo-cal-0002", "Comida con cliente", D(2), 14, 0, 90, location="Casa Lucio"),
  ev(4, "demo-cal-0001", "Dentista", D(3), 9, 30, 45, location="Clínica Sol"),
  ev(5, "demo-cal-0003", "Cumpleaños de Lola", D(4), 0, 0, 0, all_day=True, tzid="UTC", start=utc_day(D(4)), end=utc_day(D(4)) + 86400000, reminders=[1440]),
  ev(6, "demo-cal-0001", "Yoga", D(0), 19, 0, 60, rrule="FREQ=WEEKLY;BYDAY=MO,WE", tzid="Europe/Madrid"),
  ev(7, "demo-cal-0002", "Viaje a Bilbao", D(5), 0, 0, 0, all_day=True, tzid="UTC", start=utc_day(D(5)), end=utc_day(D(5)) + 3 * 86400000),
  ev(8, "demo-cal-0003", "Cena en familia", D(5), 21, 0, 120),
  ev(9, "demo-cal-0002", "Planificación mensual", D(1), 16, 0, 60, rrule="FREQ=MONTHLY;BYDAY=2TU"),
  ev(10, "demo-cal-0001", "Pagar el alquiler", D(7 + 1), 9, 0, 15, rrule="FREQ=MONTHLY"),
  ev(11, "demo-cal-0001", "Correr", D(1), 7, 30, 45), ev(12, "demo-cal-0001", "Correr", D(3), 7, 30, 45),
  ev(13, "demo-cal-0002", "Demo a dirección", D(2), 11, 0, 60), ev(14, "demo-cal-0002", "Retro", D(2), 11, 15, 60),
  ev(15, "demo-cal-0002", "Standup", D(2), 11, 30, 15),
]
print(json.dumps([r.get("ok") for r in call("POST", "/api/ops", {"ops": ops})["results"]]))
call("POST", "/api/sync")
PY

echo "Servidor http://127.0.0.1:8198 (demo / ${PW}) · servicio http://127.0.0.1:7879"
if [ "${1:-}" = "--no-window" ]; then echo "Ctrl+C para cerrar"; wait; exit; fi
"$ROOT/build/calendar-desktop"

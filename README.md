# Calendar

Calendario personal autoalojado de la suite (junto a [Drive](../Drive) y [Mail](../Mail)): eventos, series que se repiten, varios calendarios con color y avisos de escritorio, con los datos en tu propio servidor.

Son dos piezas, las dos en [Lux](vendor/lux) y **sin ninguna dependencia de Drive** (otra cuenta, otra base de datos, otro servicio):

```
 tu equipo                                          tu servidor (el mismo que Drive)
┌─────────────────────────────┐   HTTPS + token    ┌──────────────────────────────────┐
│ calendar-desktop  (ventana) │                    │ calendar  (Lux, systemd)         │
│        │ HTTP, sólo 127.0.0.1                    │  SQLite propia · puerto 8100     │
│        ▼                    │                    │  nginx delante para el TLS       │
│ calendar-daemon  (servicio) │ ─────────────────► │                                  │
│  réplica local + cola       │ ◄───────────────── │                                  │
│  sincroniza y lanza avisos  │                    └──────────────────────────────────┘
└─────────────────────────────┘
```

- **Servidor** (`server/`): guarda los calendarios y los eventos de cada cuenta y expone una API JSON. Es una app Lux, como `Drive/lux`.
- **Servicio de escritorio** (`desktop/daemon/`): corre aunque no haya nadie con sesión. Guarda una copia local (SQLite), la sincroniza con el servidor y lanza los avisos con `notify-send`.
- **Ventana** (`desktop/app/`): Lux Desktop (GTK + WebKitGTK, un solo binario). Pinta mes, semana, día y agenda; todo lo que hace pasa por el servicio. La paleta es la de Drive.

## Qué hace

- Calendarios con color, que se pueden ocultar; mes, semana, día y agenda; mini-calendario; búsqueda; atajos de teclado (`?` los muestra).
- Eventos de hora o de todo el día, con lugar, notas y varios avisos (a la hora, 5 min… 1 día antes).
- **Series**: diaria, semanal (con días), mensual (el día N, el 2.º martes, el último viernes, el último día), anual; con fin por fecha o por número de veces. Editar o borrar «solo este evento» o «toda la serie». Las repeticiones conservan la hora de pared al cambiar de horario.
- **Sin conexión**: se edita sobre la copia local y los cambios se envían al volver la red. Si dos equipos tocan lo mismo, **gana la edición más reciente** y queda anotado en el registro.
- **Avisos con la ventana cerrada**: los lanza el servicio. Si nadie ha iniciado sesión (o no hay servicio de notificaciones), se reintentan mientras el evento no haya empezado.
- Cuentas con contraseña (argon2), segundo factor TOTP opcional, bloqueo por intentos fallidos y tokens revocables.
- Actualizaciones desde GitHub como en Mail y Drive Sync: al abrir, la ventana compara el commit instalado con el de GitHub y ofrece **Actualizar**.

## Compilar

Hacen falta `cmake`, `g++` (C++20), `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libcurl4-openssl-dev`, `libsqlite3-dev` y `tzdata`.

```bash
cmake -S desktop -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --target lux-bin calendar-desktop -j$(nproc)
```

Compila `build/vendor/lux/lux` (Lux, con el módulo nativo `rrule`) y `build/calendar-desktop` (la ventana).

## Servidor

```bash
./server/deploy/deploy.sh usuario@servidor          # instala; la segunda vez sólo actualiza
ssh -t usuario@servidor sudo calendar-cli createuser TUNOMBRE
ssh usuario@servidor sudo bash /opt/calendar/deploy/setup-tls.sh letsencrypt calendar.tudominio tu@correo 443
```

`deploy.sh` empaqueta la app y el binario de Lux, los envía por SSH y ejecuta el instalador. **Convive con Drive**: usuario `calendar`, `/opt/calendar`, `/var/lib/calendar`, puerto 8100 y su **propio** binario de Lux (`/opt/calendar/lux`); no toca el `lux` del sistema. Al actualizar conserva la base de datos y `calendar.env`, y si el servicio no arranca vuelve solo a la versión anterior (`--dry-run` enseña lo que haría). Con nginx delante y otro nombre que Drive, comparten el 443.

Órdenes de administración (`calendar-cli`): `createuser`, `passwd` (cierra las sesiones abiertas), `listusers`, `totp NOMBRE [--off]`, `disable`, `maintenance`.

Variables en `/etc/calendar/calendar.env`: `CALENDAR_DB`, `BIND_PORT`, `CALENDAR_HOST` (127.0.0.1), `CALENDAR_PROXY` (1 si hay nginx delante).

## Estado para QuemaOS

`calendar-quemaos.service` es un proceso aparte (Lux sólo abre un puerto por app) que escucha en `127.0.0.1:9705` y responde `GET /quemaos/status` con el contrato de la suite: `{quemaos, id: "calendar", name, status: ok|warn|error, message, metrics, extra}`. No toca la base al contestar: sirve lo último que midió un reloj interno (cada 30 s) y, si ese reloj se para, lo delata. Da `error` si el servidor no responde a `/healthz` o queda poco disco, y `warn` si va justo. El puerto va en `calendar.env` (`CALENDAR_QUEMAOS_PORT`, 9700-9799 — lo impone `quemaos-run.sh`) y `CALENDAR_QUEMAOS_HOST=0.0.0.0` la abre a la red. Código: [server/quemaos/app.lux](server/quemaos/app.lux). Sólo hace `SELECT`, pero el driver SQLite de Lux no tiene modo de sólo lectura, así que esa garantía es del código, no de la base.

## Escritorio

```bash
sudo ./desktop/deploy/install.sh --user $USER
calendar-desktop
```

Instala el servicio `calendar-daemon` (systemd, como tu usuario, arranca con el equipo) y la ventana. La primera vez pide la dirección del servidor y tu cuenta: el servidor entrega un token a este equipo y la contraseña no se guarda. La copia local y el token viven en `/var/lib/calendar-daemon` (sólo tu usuario). `journalctl -u calendar-daemon -f` es el registro.

## API del servidor

Autenticación con `Authorization: Bearer <token>` (ámbitos `read` y `write`). Errores como `{"detail": "…"}`.

```
POST /api/login        {username, password, totp?, name?}  → {token, user}
GET  /api/me · POST /api/logout · GET /api/tokens · DELETE /api/tokens/:id
GET  /api/changes?since=N     lo que cambió desde la revisión N (0 = todo lo vivo)
POST /api/ops                 lote {run, ops:[…]} de hasta 1000 operaciones
GET  /api/occurrences?after&before&calendars   series ya expandidas (ms UTC)
GET  /healthz
```

- **`changes`**: cada cambio de un calendario o evento tiene una revisión única (`rev`) y los borrados viajan como lápidas durante 30 días. Se pagina (`more`); si la respuesta trae `reset`, el cliente estaba demasiado atrasado y debe volver a bajarlo todo.
- **`ops`**: `cal.put`, `cal.delete`, `event.put`, `event.delete`, cada una con su `key` y un `base_rev` opcional. Un lote es atómico en su conjunto pero cada operación responde por separado (un fallo no corta el resto) y es **idempotente**: repetir un lote no cambia nada ni sube revisiones. Si `base_rev` es más viejo que el servidor, responde `conflict` con la versión actual.
- Los instantes son milisegundos UTC. Un evento lleva la zona (`tzid`) en que se creó; las repeticiones se calculan en ella. Los de todo el día usan `tzid` UTC y medianoches UTC: son el mismo día en cualquier zona.

## Repeticiones (módulo `rrule`)

Lux no trae RRULE, así que se añadió un módulo nativo ([rrule.cpp](vendor/lux/src/lux_script/modules/base_modules/rrule.cpp)): `rrule.check(regla)` y `rrule.expand(regla, inicio, zona, exdates, desde, hasta[, límite])`. Soporta `FREQ` (diaria, semanal, mensual, anual), `INTERVAL`, `COUNT`, `UNTIL`, `BYDAY` (con ordinal en mensual/anual), `BYMONTHDAY` (también negativo), `BYMONTH` y `WKST`. Lo que no soporta lo **rechaza** (`check`) en vez de ignorarlo. Como dice el RFC, un día que no existe en un mes (el 31, el 29 de febrero) se salta; una hora que no existe por el cambio de horario se adelanta; una ambigua toma la primera. `COUNT` cuenta también las repeticiones excluidas.

## Pruebas

```bash
./run-tests.sh
```

- `node desktop/tests/logic.test.js`: fechas, repeticiones del formulario y maquetación de la ventana.
- `server/tests/quemaos.sh`: la sonda de QuemaOS (contrato, métricas, caché, servidor caído, rango de puertos).
- `server/tests/run.sh`: el módulo `rrule` (18 casos: cambio de hora, hora inexistente y ambigua, el 31, años bisiestos…) y la API contra un servidor real (17: aislamiento entre cuentas, idempotencia, conflictos, paginación, purga de lápidas, ámbitos, bloqueo…).
- `desktop/tests/e2e.sh`: el servicio contra un servidor real (12: sin conexión, conflictos por fecha de edición, rechazos del servidor, series, avisos, lotes grandes…).
- `desktop/tests/dev.sh`: servidor + servicio + ventana con datos de ejemplo para desarrollar.

## Cómo está montado

```
vendor/lux/                      Lux (copia de la de Drive de escritorio) + módulo rrule
server/quemaos/                  la sonda de QuemaOS (app Lux aparte)
server/app/                      app.lux · lib/{db,auth,calendar,maintenance}.lux · routes/{api,commands}.lux
server/deploy/                   install · remote-update (con vuelta atrás) · deploy · calendar-cli · nginx · setup-tls
desktop/daemon/                  store · remote · data · sync · reminders · api
desktop/app/                     app.lux (ventana y actualizaciones) · public/{index.html,style.css,logic.js,app.js}
desktop/{src,include,third_party,tools}/   el shell GTK/WebKit (de Lux Desktop)
desktop/deploy/                  install · update · calendar-daemon.service · .desktop
```

El esquema de las dos bases de datos está **versionado** (`schema_version` + lista de migraciones en `db.lux` y `store.lux`): para cambiarlo se añade una versión al final, nunca se edita una anterior.

## Límites conocidos

- **Sin móvil** todavía (ver `plan.md`).
- Sondeo, no push: un cambio de otro equipo tarda hasta un minuto en llegar (los propios se envían en ~5 s).
- Un cliente que lleve más de 30 días sin sincronizar vuelve a bajarlo todo (las lápidas se purgan a los 30 días).
- Los avisos de un evento de todo el día se calculan respecto a la medianoche local (válido de UTC−11 a UTC+11).
- El bloqueo por intentos fallidos vive en memoria del servidor: se pierde al reiniciar. No hay límite de peticiones fuera del login.
- Editar «este y los siguientes» de una serie no existe: se elige «solo este» o «toda la serie».

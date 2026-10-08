# Calendar — plan

Calendario personal de la suite, junto a Mail y Drive. Son dos piezas dentro de
este repositorio, y **ninguna depende de Drive**:

```
 equipo                                          servidor (el mismo que Drive)
┌────────────────────────┐   HTTPS + token    ┌───────────────────────────────┐
│ calendar-desktop       │ ─────────────────► │ calendar-server  (Lux, systemd)│
│ Lux Desktop (GTK/WebKit)│                    │  SQLite propia, puerto propio │
│ copia local + cola     │ ◄───────────────── │  nginx delante (TLS)          │
└────────────────────────┘                    └───────────────────────────────┘
```

## Decisiones

| Decisión | Por qué |
|---|---|
| **Servicio propio en Lux**, con su base de datos, sus usuarios, sus tokens y su unidad de systemd. Convive con Drive en la misma máquina, pero no comparte proceso, base de datos ni cuentas. | Lo pediste así. Si Drive se cae o se actualiza, el calendario sigue. |
| El servidor es una app Lux como `Drive/lux/`, y el cliente es una app de Lux Desktop (Lux-Local) como Mail. | Se compila, instala y actualiza con las mismas herramientas que ya conoces. |
| **Se copia código de Drive y Mail**, no se importa. Cada repositorio queda autosuficiente. | Un cambio en Drive no puede romper el calendario. El coste es que algunas piezas viven duplicadas (ver tabla de reutilización). |
| La sincronización es por cursor (`rev`) y lotes de operaciones. | Es el patrón de `/api/sync/ops` de Drive: idempotente, atómico y auditado. |
| Las recurrencias las expande el servidor, en LuxScript. | Lux no trae RRULE. Se implementa solo el subconjunto necesario (ver Modelo) y se prueba a fondo. Es la parte con más riesgo del proyecto. |
| Paleta de Drive en toda la suite. | Ver [Paleta](#paleta). |
| El móvil queda fuera por ahora. | Ver [Futuro](#futuro). |

## Qué se reutiliza

Se copia y se adapta (cambia el prefijo `DRIVE_` por `CALENDAR_`, y se quita lo relativo a ficheros):

| De | Qué | Para |
|---|---|---|
| `Drive/lux/app/lib/` | `config.lux`, `db.lux`, `security.lux`, `auth.lux`, `ctx.lux`, `ratelimit.lux`, `netutils.lux`, `audit.lux`, `maintenance.lux`, `util.lux` | cuentas con argon2, 2FA, sesiones, tokens con ámbitos, bloqueo por intentos, límite por IP y auditoría |
| `Drive/lux/app/routes/` | `auth.lux`, `profile.lux`, `admin.lux`, `commands.lux` | login, perfil y tokens, panel de administración y la CLI |
| `Drive/lux/deploy/` | `install.sh`, `deploy.sh`, `remote-update.sh`, `run.sh`, `setup-tls.sh`, `nginx.conf`, `*.service` | despliegue por SSH con vuelta atrás automática |
| `Drive/lux/tests/` | `lib.lux`, `run.sh` | pruebas de extremo a extremo |
| `Mail/` | `src/`, `include/`, `third_party/webview`, `CMakeLists.txt`, `vendor/lux`, `app/update.lux`, `app/window.lux`, `app/secrets.lux`, `deploy/` | shell de escritorio, llavero, bandeja, notificaciones y actualizaciones |
| `Drive/desktop/` | `deploy/*.service`, `daemon/store.lux` | solo como referencia, si hace falta un servicio en segundo plano |

No se copia: `files_service`, `storage`, `shares_service`, `thumbnails`, `permissions` (los permisos de Drive son por fichero; aquí basta con «es tu calendario»).

## Estructura

```
Calendar/
  server/                  calendar-server (Lux)
    app/
      app.lux
      lib/                 config, db, security, auth, ctx, ratelimit, audit, maintenance, recurrence
      routes/              auth, profile, admin, api, commands
      templates/           login, perfil, admin (mismo estilo que Drive)
      public/              style.css
    config/config.json
    deploy/                install.sh, deploy.sh, remote-update.sh, run.sh, nginx.conf, calendar.service
    tests/
  desktop/                 calendar-desktop (Lux Desktop)
    app/                   app.lux, sync.lux, db.lux, events.lux, update.lux, window.lux, secrets.lux
      templates/ public/
    src/ include/ third_party/webview vendor/lux CMakeLists.txt
    deploy/                install.sh, update.sh, calendar-desktop.desktop
    tests/
  plan.md
```

## Servidor

Un puerto propio (por ejemplo 8100; el de Drive es 8000) y variables `CALENDAR_*`. Escucha solo en `127.0.0.1` y nginx pone el TLS, igual que Drive. Los datos están en `/var/lib/calendar`, y esa carpeta es lo único que hay que copiar para una copia de seguridad.

### Modelo

```
users / sessions / tokens / audit      copiados del esquema de Drive
calendars  id, user_id, name, color, position, rev, deleted_at
events     id (uuid del cliente), calendar_id, title, location, notes,
           start, end,                     -- UTC; si all_day, solo fecha
           all_day, tzid,                  -- zona de creación, p. ej. Europe/Madrid
           rrule, exdates, recurrence_id,  -- recurrencia, ver abajo
           reminders,                      -- JSON: minutos antes, p. ej. [10, 1440]
           rev, updated_at, deleted_at
meta       contador de rev por usuario
```

- **Borrado lógico** (`deleted_at`), para que el cambio llegue a los demás clientes. Mantenimiento lo purga a los 30 días.
- **`rev`** es un contador creciente por usuario que aumenta en cada cambio; el cliente pide lo posterior a su último `rev`.
- **Esquema:** Lux no tiene migraciones (lo dice `Drive/lux/needed.md`). Se crea con `create table if not exists` en `on start:`, y se añade una tabla `schema_version` con un `alter table` ordenado por versión desde el primer día, para no tener el problema que Drive ya reconoce.
- **RRULE admitidas:** `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`, `INTERVAL`, `COUNT`, `UNTIL`, `BYDAY` y `BYMONTHDAY`. Editar «solo esta repetición» añade la fecha a `exdates` y crea un evento suelto con `recurrence_id`. Las horas se expanden en la `tzid` del evento, para que una reunión a las 10:00 siga a las 10:00 tras el cambio de hora.

### API

Autenticación con `Authorization: Bearer <token>` (tokens con ámbitos `read` y `write`, que se crean en el perfil) o con la cookie de sesión.

```
GET  /api/me                              quién soy
GET  /api/changes?since=<rev>             calendarios y eventos con rev > since, más el rev nuevo
POST /api/ops                             lote {"run", "ops": [...]}, hasta 1000
GET  /api/occurrences?from&to&calendars   repeticiones ya expandidas en un intervalo
GET  /healthz
```

Operaciones del lote: `cal.put`, `cal.delete`, `event.put`, `event.delete`. Cada una lleva su `key` y el `base_rev` que vio el cliente. Son atómicas e idempotentes, devuelven un resultado por operación y dejan rastro en la auditoría. Si `base_rev` es más antiguo que el `rev` del servidor, la operación responde `conflict` con la versión del servidor; el cliente conserva la de `updated_at` más reciente y lo avisa.

Aparte de eso, una interfaz web mínima de cuentas (login, perfil, tokens y administración, ya hechas en Drive) para crear el usuario y el token con los que se configura el cliente. El calendario en sí se usa desde el cliente de escritorio.

### Pruebas

Con el sistema de `lux test` de Drive. Cubren: aislamiento entre usuarios (404 al pedir lo ajeno), ámbitos de los tokens, idempotencia de `ops`, conflicto por `base_rev`, expansión de RRULE con `exdates`, cambio de hora y fin de mes (31 → 30 → 28), y que borrar y volver a pedir `changes` propaga el borrado.

## Cliente de escritorio

- **Datos locales:** SQLite en `~/.local/share/lux-desktop/calendar/`, con una copia de las tablas y una cola `pending_ops`.
- **Sincronización:** al abrir, cada 60 s y con ⟳ se llama a `changes?since=`; después se vacía `pending_ops` con `ops`. Sin red se sigue trabajando sobre lo local y se envía al volver.
- **Vistas:** mes, semana, día y agenda (los próximos 30 días). Cada calendario tiene su color, como las cuentas en Mail.
- **Teclado** (mismas convenciones que Mail): `c` crear, `t` hoy, `j`/`k` o `←`/`→` periodo anterior/siguiente, `m`/`w`/`d`/`a` cambiar de vista, `/` buscar, `Supr` eliminar, `?` ayuda.
- **Recordatorios:** el cliente programa `window.notify` a partir de `reminders`. Solo avisa con la app o la bandeja abiertas, y la interfaz lo dice.
- **Credenciales:** la dirección del servidor y el token van en el llavero (`secrets.lux`), como las contraseñas de Mail.

### Paleta

La de Drive (`Drive/app/static/style.css`), solo tema oscuro, en las tres aplicaciones:

```css
--bg:#141413; --surface:#1f1e1c; --surface-2:#262523; --surface-3:#302f2c;
--border:#33312e; --border-strong:#4a4743; --text:#f5f3ec; --muted:#a8a397;
--accent:#d97757; --accent-2:#b8532f; --accent-soft:rgba(217,119,87,.14);
--ok:#86d9a4; --err:#ff9b8a; --warn:#f5c86a;
```

Calendar la usa tal cual, con el degradado radial de fondo de Drive. **Mail ya se ha pasado** a esos valores en `Mail/app/public/style.css` (sus nombres de variable no cambian, solo los valores; no se ha abierto la app para verlo). El icono mantiene el estilo de la suite: fondo gris oscuro con el glifo relleno en naranja.

### Actualizaciones

Idénticas a las de Mail y Drive Sync, cada pieza con su propio mecanismo:

- **Cliente:** `deploy/install.sh --user` instala `/usr/local/bin/calendar-desktop`, el icono y el `.desktop`, y anota el repositorio de origen y el commit en `/opt/calendar-desktop/{source,version}`. `app/update.lux` (copia de la de Mail con `CALENDAR_OPT` y `~/.cache/calendar-update.log`) hace `git fetch` al abrir, muestra los commits nuevos y ofrece **Actualizar**; `deploy/update.sh` hace `git pull --ff-only`, compila y lanza `pkexec install.sh`, y acaba en `==> LISTO` o `==> ERROR`. Luego **Reiniciar Calendar** cierra la ventana anterior.
- **Servidor:** `server/deploy/deploy.sh usuario@host` empaqueta, envía por SSH y actualiza solo el código; conserva la base de datos, la configuración y el secreto de firma, y vuelve a la versión anterior si el servicio no arranca.

## Fases

1. **Servidor, base:** copiar de Drive las cuentas, tokens, auditoría y despliegue; esquema con versión; `healthz`. Se instala en el servidor junto a Drive para comprobar que conviven (puerto, usuario de servicio y nginx).
2. **Servidor, calendario:** `calendars`, `events`, `changes`, `ops` y sus pruebas.
3. **Esqueleto del cliente:** shell, CMake y `vendor/lux` de Mail; ventana vacía con la paleta, `install.sh`, `update.sh` y `update.lux`. Desde aquí la app ya se actualiza sola.
4. **Lectura:** sincronización hacia abajo, vistas de mes, semana, día y agenda.
5. **Edición:** crear, editar, mover y borrar eventos; cola sin conexión y conflictos.
6. **Recurrencias y recordatorios:** `lib/recurrence.lux`, `occurrences`, «solo esta / toda la serie» y notificaciones.

## Futuro

- **Móvil**, cuando toque. Las opciones son un feed `.ics` de solo lectura con token (barato) o CalDAV (mucho más trabajo, y editaría desde el móvil). Nada del diseño lo impide.
- Importar y exportar `.ics`, y que Mail detecte invitaciones y ofrezca «Añadir a Calendar».
- Calendarios compartidos entre usuarios (el modelo ya lleva `user_id`).
- Invitaciones a terceros y sus respuestas (iTIP).

## Cosas por decidir al empezar

- **Puerto y nombre del servicio:** `calendar` en el 8100 es lo que se supone aquí.
- **Si el cliente necesita servicio en segundo plano** para avisar de recordatorios con la app cerrada. El plan lo deja fuera; si lo quieres, se hace como `drive-sync` (unidad de systemd con `lux`, sin ventana).

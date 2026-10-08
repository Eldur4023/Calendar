# Calendar — plan

Estado a 2026-10-08. Cómo se usa y cómo está montado: [README.md](README.md).

## Decisiones tomadas

| Decisión | Por qué |
|---|---|
| **Servicio propio en Lux**, con su base de datos, usuarios, tokens y unidad de systemd. Convive con Drive en la misma máquina pero no comparte nada con él. | Si Drive se cae o se actualiza, el calendario sigue. Lo pediste así. |
| Servidor = app Lux (como `Drive/lux`); escritorio = Lux Desktop (como Mail y Drive Sync). | Se compila, instala y actualiza con las mismas herramientas. |
| **Se copió código** de Drive y Mail, no se importa. | Un cambio en Drive no puede romper el calendario. |
| Un único Lux vendorizado (`vendor/lux`, el de Drive de escritorio: trae zonas horarias, `otp`, `crypto`…) + un **módulo nativo `rrule`**. | Lux no trae RRULE; en LuxScript habría sido lento y difícil de acertar con los cambios de hora. |
| El servidor se instala con **su propio binario de Lux** en `/opt/calendar/lux`. | El `lux` del sistema es el de Drive; cambiarlo podría romperlo. |
| El cliente es **servicio + ventana**: el servicio guarda la copia, sincroniza y avisa; la ventana sólo pinta. | Los avisos tienen que sonar con la ventana cerrada. |
| Sincronización por cursor (`rev` único por cambio) y lotes `ops` idempotentes; conflictos: **gana la edición más reciente**. | Es el patrón de `sync/ops` de Drive; no pierde cambios y no necesita una interfaz de resolución. |
| Paleta de Drive en toda la suite (Mail ya se pasó: commit `3a9fb1f` en Mail). | Lo pediste. |
| Esquemas con versión desde el primer día. | Lux no tiene migraciones (lo dice `Drive/lux/needed.md`). |

Cambios respecto al plan inicial: el día 31 en una serie mensual **se salta** los meses que no lo tienen (es lo que dice el RFC y lo que hacen los demás), en vez de recortarse al 28/30; no hay feed `.ics` ni interfaz web de cuentas (se crean con `calendar-cli`, y la ventana hace el login con usuario y contraseña).

## Hecho

1. **Servidor**: cuentas, login con token, bloqueo por intentos, TOTP opcional, `changes`, `ops`, `occurrences`, mantenimiento, `calendar-cli`, despliegue por SSH con vuelta atrás, nginx/TLS. 17 pruebas.
2. **Módulo `rrule`**: 18 pruebas (cambio de hora, hora inexistente y ambigua, el 31, bisiestos, `COUNT` con `EXDATE`, reglas sin días…).
3. **Servicio de escritorio**: réplica local, cola sin conexión, conflictos, avisos con `notify-send`, API local con secreto en fichero. 12 pruebas contra un servidor real.
4. **Ventana**: mes, semana, día, agenda, editor con series («solo este / toda la serie»), calendarios, búsqueda, registro, atajos, bandeja, actualizaciones desde GitHub. 14 pruebas de la lógica en node; revisada a mano con capturas de la interfaz real.

## Sonda de QuemaOS y despliegue (2026-10-08)

Contrato, reglas y puertos en `~/Escritorio/Suite-Canon.md` (§5 y §6). Calendar: proceso aparte `server/quemaos` en el **9705**. Drive: app Lux aparte en el 9704. Homeflix: relé Lux en el 9700. **Desplegado en el servidor** (`burnt-server`, por Tailscale): Calendar (instalación nueva; ahora **sólo en la IP de Tailscale**, 100.89.87.71:8100), Drive (actualizado) y las tres sondas; el código de descubrimiento de QuemaOS las ve las cinco.

## Sin hacer / pendiente de probar

- **El instalador de escritorio y el del servidor no se han ejecutado de verdad** (piden `sudo`/`pkexec`): se comprobó la sintaxis, que el servicio arranca con el mismo endurecimiento de systemd (`systemd-run --user`), que `notify-send` funciona dentro de él y que el servidor arranca con el lanzador en la disposición instalada. Falta una primera instalación real.
- **No se ha probado `deploy.sh` contra un servidor** (ni `setup-tls.sh`, copiado de Drive).
- La ventana se probó en Firefox (mismo HTML/JS) y arrancada en una sesión con la pantalla bloqueada: no he visto el aspecto dentro de WebKitGTK ni la bandeja.
- Los iconos de la aplicación (`desktop/app/icon.png`, `favicon.svg`) son nuevos y sólo los he visto a 256 px.

## Futuro

- **Móvil** (se hará más adelante, como dijiste). Opciones: feed `.ics` de solo lectura con token (barato) o CalDAV (mucho más trabajo; permite editar). El modelo no lo impide.
- Importar y exportar `.ics`; que Mail detecte invitaciones y ofrezca «Añadir a Calendar».
- «Este y los siguientes» al editar una serie.
- Calendarios compartidos entre cuentas (el modelo ya lleva `user_id`).
- Push en vez de sondeo (SSE desde el servidor) si un minuto de retraso entre equipos molesta.

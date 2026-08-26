# 26. Divergencia del módulo TDAH: estado de servidor fuera del documento de sincronización

Fecha: 2026-08-24

## Estado

Aceptado.

## Contexto

El Modo TDAH (Epic 1) necesita un perfil por usuario en el servidor auto-alojado:
modo on/off, zona horaria IANA y hora del ritual nocturno. La arquitectura del
resto del producto es "core una vez, apps delgadas": el estado del usuario vive
en el documento de sincronización (`AppData`) o en `AppSettings`, replicado a
todos los dispositivos, con la nube como transporte de blob que fusiona por
entidad y revisión (ADR 0003, ADR 0008, ADR 0025).

Ese modelo no sirve para el perfil TDAH. La espina del modo exige un único
escritor — el VPS — porque programadores, generación de agenda y supresión de
recordatorios se deciden en el servidor (AD-1); un campo replicado en el
documento de sincronización tendría dos fuentes de verdad y los dispositivos
escribirían encima de la decisión del servidor. Además el resto del Epic
(Rutinas, Limbo, historial, origen Jira) es dato de servidor que jamás cabría
en el contrato de `AppData` sin ensuciar el esquema sincronizado de
tareas/proyectos/secciones.

Dos convenciones del servidor también chocan con una base de datos viva:

- **Escritura durable.** El patrón del repo es `durablyPublishFile`
  (temp → fsync → rename → fsync del directorio). Publicar por rename es
  intrínseco a archivos completos; una BD SQLite con WAL muta in place, así que
  el equivalente duradero es `PRAGMA journal_mode=WAL` +
  `PRAGMA synchronous=FULL` (la combinación que fsyncea el WAL en cada commit).
- **Bloqueo cruzado en escritura.** Las rutas existentes serializan escrituras
  con `withCloudFileLock` (BEGIN IMMEDIATE sobre 64 shards). SQLite ya serializa
  escritores concurrentes de la misma BD con sus propios locks de archivo,
  incluido entre procesos, por lo que un lock adicional alrededor de cada
  operación TDAH sería redundante.

## Decisión

El módulo TDAH vive como sub-módulo aditivo del servidor en
`apps/cloud/src/tdah/`, fuera del documento de sincronización:

- **Rutas propias bajo `/v1/tdah/`** con su propio `withNamespace()`:
  autenticación, límite de tasa y admisión de espacio de nombres idénticos al
  resto del servidor; identidad de usuario = `ctx.key` (sha256 del token). El
  cableado en `server.ts` es 100% aditivo (import, configuración espejo de
  `calendarFeedServerConfig` y un bloque de despacho antes del 404); ningún
  handler, storage o esquema del sync existente se modifica.
- **SQLite por usuario** en `<dataDir>/<key>/tdah/tdah.sqlite` — el mismo
  aislamiento por espacio de nombres que `<key>/attachments/`. Directorios vía
  `ensureDurableDirectory`; durabilidad WAL + synchronous=FULL en lugar de
  temp→rename (la divergencia de arriba, deliberada).
- **Sin `withCloudFileLock`**: cada operación abre la BD, hace su transacción
  (BEGIN IMMEDIATE en escrituras) y cierra; SQLite arbitra la concurrencia.
- **Errores con código estable**: cuerpo `{error: {code: 'TDAH_…'}}`; jamás un
  `.message` crudo de fs/sqlite (política del servidor).
- **El perfil nunca entra a `AppData`**: las pantallas cliente lo leen y mutan
  por HTTP (GET al montar, PUT para cambiar), reflejando estado del servidor;
  no se agrega nada a `AppSettings`.

La superficie v1 es mínima: GET/PUT de perfil (modo, zona horaria con
validación IANA semántica, hora ritual `HH:mm` con default 23:00). El CRUD de
Rutinas, el scheduler nocturno y el resto del Epic extendrán el módulo bajo la
misma forma.

## Consecuencias

El servidor deja de ser un transporte de blob puro: opera un segundo almacén
por usuario con lógica propia. Ese estado no se respalda con el documento
`<key>.json` ni se ve en las estadísticas de fusión — respaldar un usuario es
respaldar su directorio `<key>/` completo (el operador que ya copia el dataDir
lo cubre sin cambios). La lectura del perfil requiere servidor (sin conexión la
pantalla muestra error/reintento, no un estado fantasma local — AD-11), que es
exactamente la semántica que la espina pide.

El costo de mantenimiento es un sub-módulo más que seguir el precedente
estructural del feed de calendario (`server-calendar-feed.ts`): autocontenido,
montado bajo su prefijo, sin tocar las rutas de sync. Si un futuro requisito
obligue a compartir esquema o transacciones con el documento de sincronización,
esa sería una divergencia nueva a decidir aquí de nuevo.

## Adenda (historia 1.4): mecanismo de migración de esquema

La historia 1.4 (CRUD de Rutinas) fue la primera vez que este módulo necesitó
ensanchar una tabla ya publicada en disco: `tdah_routine.pattern_kind` pasó de
un único literal (`CHECK (pattern_kind IN ('weekday'))`) a un patrón de
calendario real (`'weekday' | 'nthWeekdayOfMonth'`), con columnas nuevas
nullable (`pattern_weekdays`, `pattern_nth_ordinal`, `pattern_nth_weekday`).
`CREATE TABLE IF NOT EXISTS` — el único mecanismo de esquema que el módulo
había usado hasta entonces — es un no-op permanente contra cualquier
`tdah.sqlite` que ya exista en disco desde una activación 1.1–1.3 (DW-9): la
restricción `CHECK` vieja se habría quedado vigente para siempre en esas bases.

Mecanismo elegido: `PRAGMA user_version`, nativo de SQLite, sin framework de
migraciones genérico (el módulo tiene exactamente un cambio de esquema que
hacer; un runner reusable sería infraestructura que esta historia no
necesita — mismo criterio "aditivo, mínimo" del resto de este ADR). Un único
salto de versión `0 → 1`:

- `apps/cloud/src/tdah/storage.ts`'s `migrateSchemaIfNeeded(database)` corre
  dentro de `ensureSchema()`, en el mismo paso donde ya viven los `CREATE
  TABLE IF NOT EXISTS` — es decir, en cada apertura de escritura
  (`withWriteTransaction`) y, si hace falta, también en cada apertura de
  lectura (`withReadDatabase`, ver abajo), antes de servir la petición.
- Detecta si la base necesita migrar por presencia de columna
  (`PRAGMA table_info('tdah_routine')` buscando `pattern_weekdays`), no solo
  por `user_version`: una base nueva ya nace con el esquema ensanchado
  (`CREATE_ROUTINE_TABLE_SQL` lo declara directamente), así que solo necesita
  que se le estampe `user_version = 1`, nunca una reconstrucción.
- Cuando sí hace falta reconstruir (base 1.1–1.3 real): crea
  `tdah_routine_v2` con las columnas nuevas, copia las filas existentes
  (`pattern_weekdays = '1,2,3,4,5'` para cada fila `'weekday'` — el único
  patrón que la plantilla fija de onboarding pudo haber creado, y que siempre
  implicó Lunes–Viernes aunque nunca se guardó explícitamente), hace `DROP
  TABLE`/`RENAME` y fija `PRAGMA user_version = 1`.
- **Lecturas también migran.** La migración es DDL y exige un handle no
  `readonly`, pero varias rutas nuevas (`GET /v1/tdah/routines`, el preview de
  aplicabilidad) son de solo lectura y podrían ser la primera petición del
  módulo tras el upgrade — típicamente al abrir la vista de lista de Rutinas.
  `withReadDatabase` resuelve esto con una sonda: abre readonly, lee
  `PRAGMA user_version`; si ya está al día, sigue igual que antes (un
  `PRAGMA` de más, sin costo real); si detecta una base vieja, dispara una
  pasada corta de `withWriteTransaction` (que reutiliza su propio backoff ante
  `SQLITE_BUSY` en vez de duplicarlo) para migrar, y luego abre el handle
  readonly real. Así "cualquier petición migra el esquema de forma
  transparente antes de ser servida" vale también para las rutas de solo
  lectura, no solo para las de escritura.

Además de la migración de esquema, la historia 1.4 fijó tres decisiones de
producto/diseño que valen la pena dejar registradas aquí junto al mecanismo:

- **Desempate de precedencia entre Rutinas de igual especificidad: gana la más
  reciente (`created_at` DESC, empate por `id` DESC).** `nthWeekdayOfMonth`
  siempre supera a `weekday` (AD-5), pero cuando dos Rutinas empatan en
  especificidad no hay un campo de prioridad explícito que el usuario pueda
  fijar — se eligió deliberadamente "la más reciente gana" porque es el
  cambio mínimo que preserva el comportamiento *ya existente* antes de 1.4
  ("gana la más reciente" era la selección implícita cuando solo podía existir
  una Rutina), en vez de introducir una UI de prioridad ordenable que el spec
  de UX de esta historia no pedía. El indicador de conflicto en la lista sigue
  mostrando qué Rutina gana, así que el desempate es visible para el usuario,
  no silencioso (ver spec 1.4, sección "Design Notes").
- **El solape de Bloques pasó de rechazo duro (historia 1.3) a aviso no
  bloqueante.** Antes de esta historia, `POST /activate` rechazaba con 400
  `TDAH_ROUTINE_INVALID` cualquier Rutina cuyos Bloques se solaparan en el
  tiempo. La historia 1.4 relaja eso: el solape (y el cruce de medianoche) se
  computan en cada lectura (`computeOverlapWarnings`/
  `computeMidnightCrossingWarnings` en storage.ts) y se devuelven como
  advertencias no bloqueantes junto a un guardado exitoso — el usuario puede
  querer solapes deliberados (p. ej. un Bloque de "disponibilidad" que cubre
  varios Bloques más específicos), y forzarlo a resolver eso antes de guardar
  no aportaba valor.
- **El CRUD de Rutinas no está condicionado por `TdahProfile.mode`.** Se puede
  crear, editar, duplicar y borrar Rutinas con el modo en `'off'` — `mode`
  únicamente controla si el módulo genera DayPlans/Actividades (la espina de
  AD-1), no si el usuario puede administrar sus datos. Es consistente con el
  resto del módulo: el perfil y las Rutinas son almacenamiento de servidor
  independiente de si la generación automática está activa.

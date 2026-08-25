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

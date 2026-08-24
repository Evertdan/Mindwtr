# ADR 0014: Puertos de orquestación de sincronización compartida

Fecha: 2026-05-04
Estado: Aceptado (implementado el 2026-07-13)

## Contexto

El escritorio y el móvil ejecutan la misma forma de orquestación de sincronización: leer estado local, enviar a backends de archivo/WebDAV/nube/Dropbox, reconciliar advertencias, actualizar estado y mostrar notificaciones. Hoy esos flujos viven en servicios específicos de la aplicación, por lo que las correcciones a menudo necesitan aplicarse dos veces.

El algoritmo de fusión ya se comparte en `@mindwtr/core`; la duplicación restante es la máquina de estado de orquestación alrededor de IO de backend y notificación de interfaz de usuario.

## Decisión

Planificar una refactorización de seguimiento que mueva la máquina de estado de orquestación de sincronización independiente de plataforma a `@mindwtr/core`.

El paquete central debe poseer:

1. transiciones de estado del ciclo de sincronización
2. política de reintento y escritura pendiente
3. configuración de diagnósticos de conflicto
4. contratos de envío de backend

Las aplicaciones deben proporcionar puertos:

1. `BackendIO` para llamadas de transporte de archivo/WebDAV/nube/Dropbox/iCloud
2. `Storage` para leer y escribir instantáneas locales
3. `Notifier` para brindis, insignias y registros de plataforma
4. `Clock` u hooks de tiempo de prueba donde se necesita el tiempo determinista

## Consecuencias

- El comportamiento de sincronización puede cubrirse una vez con pruebas unitarias principales.
- El escritorio y el móvil mantienen backends específicos de plataforma sin duplicar política.
- La refactorización debe hacerse como su propio conjunto de cambios porque toca código de ciclo de vida de sincronización de alto riesgo.
- Hasta que esto se implemente, las correcciones de error de sincronización deben mantener la verificación en ambos orquestadores de aplicación.

## Plan de implementación (agregado el 2026-07-05)

La duplicación medida al momento de escribir: escritorio `sync-service.ts` 2,448 líneas con 32 sitios de distribución `backend ===`; móvil `sync-service.ts` 1,615 líneas con 30; ambos implementan el mismo canalización de ~10 fases (`readRemoteDataByBackend`, `prepareRemoteWriteData`, `writeRemoteDataByBackend`, huellas digitales de verificación rápida, fases de archivo adjunto previas/posteriores, persistencia de estado/historial) alrededor de la fusión central compartida. Las costuras de prueba difieren por plataforma: el escritorio modifica una bolsa de dependencia global de 21 claves (`__syncServiceTestUtils.setDependenciesForTests`); el móvil no tiene punto de inyección y necesita 13 mocks de módulo por ejecución de prueba.

Etapas, cada una su propio compromiso y cada una cerrada en los conjuntos completos de sincronización de ambas plataformas más un humo manual de dos dispositivos:

1. **Puertos en core (solo tipos).** Derivar `BackendIO`, `Storage`, `Notifier`, `Clock` de la unión de los conjuntos de métodos actuales de los dos orquestadores — no idealizar; codificar lo que existe.
2. **Máquina de estado en core.** Mover fases de ciclo, política de verificación/omisión rápida, política de reintento y escritura pendiente y configuración de diagnósticos de conflicto a `packages/core` detrás de esos puertos. Prueba unitaria contra falsificaciones en memoria; la falsificación es el segundo adaptador que hace que la costura sea real. Las aplicaciones siguen ejecutándose en sus orquestadores antiguos — esta etapa no cambia el comportamiento de la aplicación.
3. **El escritorio se adapta primero.** Su costura de inyección de dependencias interna existente hace que la migración sea mecánica: cada rama de backend se convierte en un adaptador `BackendIO`; eliminar `setDependenciesForTests` en favor de inyectar falsificaciones en la costura del puerto.
4. **El móvil se adapta.** Los mismos puertos más el adaptador CloudKit; el bosque de 13 mocks en `sync-service.runtime.test.ts` colapsa en falsificaciones de puerto.
5. **Paso de eliminación.** Eliminar la fontanería de omisión/estado/huella digital duplicada de ambas aplicaciones; lo que permanece por plataforma es solo código de transporte.

Restricción de programación: aterriza en una ventana silenciosa de lanzamiento, nunca junto con un RC activo — una regresión de sincronización aquí es el modo de falla del peor proyecto.

## Notas de implementación (2026-07-13)

Se realizó justo después de v1.1.0 estable, en los commits escalonados que este plan prescribió.

- `packages/core/src/sync-run-ports.ts` contiene los puertos; `sync-run.ts` es la
  máquina de estado (`runSharedSyncCycle`), probada unitariamente contra falsificaciones en memoria en
  `sync-run.test.ts`. Los agrupamientos de puerto se asignan a este ADR como: `SyncBackendIO`
  (BackendIO), `SyncRunStorage` (Storage), `SyncRunNotifier` (Notifier),
  inyección `now()` (Clock), más `SyncRunStoreBridge` para acceso de almacén compartido
  y `SyncRunPlatformHooks`/`SyncRunPolicy` para divergencias de plataforma codificadas.
- Las divergencias deliberadas se convirtieron en interruptores de política explícitos en lugar de ser
  unificadas: el móvil ejecuta la previa de archivo adjunto antes de la verificación rápida y tiene una
  segunda omisión de lectura y comparación; el móvil falla el ciclo en el archivo adjunto posterior a la fusión
  errores donde el escritorio se degrada a una advertencia; el tiempo de ejecución web del escritorio desactiva
  fases de archivo adjunto.
- Desviación del paso 3 como se escribió: el `setDependenciesForTests` del escritorio fue
  mantenido, no eliminado. Ahora cubre solo dependencias a nivel de transporte (Tauri
  invocar, fetch, CloudKit, acceso al almacén); la política de ciclo se prueba falsamente una vez en
  core, mientras que ambos conjuntos de aplicación ejercitan la máquina real a través de adaptadores reales
  sobre transportes falsificados — estrictamente más cobertura que reemplazar esos conjuntos
  con falsificaciones de puerto.
- Cambios de comportamiento benignos conocidos de la extracción: el escritorio persiste calendarios externos fusionados
  después (no antes) de la verificación de frescura a mitad de ciclo; el escritorio
  obtuvo las líneas de registro "Sincronización final de archivo adjunto inicio/fin" del móvil; el móvil obtuvo
  advertencia "Sincronización fallida" del escritorio más registros de paso para descarga/actualización; las líneas de registro de omisión sin cambios del móvil
  perdieron sus extras de tiempo transcurrido/forma de carga útil.
- Recuentos de líneas: escritorio `sync-service.ts` 2,456 → ~1,860; móvil
  `sync-service.ts` 1,651 → ~1,250; la máquina más puertos agregan ~1,000 líneas a
  core, escrito una vez.

## Actualización de seguridad de activación (2026-08-03)

El escritorio y el móvil ahora pasan configuraciones de transporte no comprometidas a la máquina de estado compartida
como configuración candidata. Una sonda de activación realiza la normal
lectura remota, fusión, validación y escritura contra ese candidato mientras mantiene
datos locales, estado, historial y estado de sincronización rápida sin cambios.

Después de fusionar el documento candidato, la sonda ejecuta transferencia de archivos adjuntos
contra un clon de esa instantánea fusionada inmediatamente antes de la escritura del candidato.
Cada archivo adjunto de archivo activo, incluido uno encontrado solo en el documento candidato,
debe terminar con una clave remota y disponibilidad confirmada en el destino
candidato. Una clave dejada de otro backend no satisface esa verificación.
Una eliminación de propietario entrante mantiene semántica de fusión normal y se excluye de
prueba de archivo adjunto en lugar de ser recargada.

La configuración confirma el candidato solo después de que la sonda tenga éxito. El escritorio desactiva
el backend actual mientras escribe y verifica el transporte candidato, luego
reactiva el candidato. Una escritura fallida restaura y verifica la
configuración anterior; si la reversión no se puede verificar, la sincronización se detiene. El móvil escribe
la clave de activación del backend después de sus valores de transporte candidatos y restaura
y verifica los valores anteriores si la transacción falla; una reversión incompleta
deja la sincronización durablemente desactivada.

La primera sincronización durable después de la activación preserva cualquier marcador de escritura remota pendiente
pero ignora un plazo de reintento heredado del backend anterior. El
nuevo backend por lo tanto recibe una confirmación completa antes de que se reanude la política de reintento normal.
Para esa fusión, las claves de archivo adjunto activas del documento candidato son
autoritativas para que una clave de tiempo igual del backend anterior no pueda regresar.

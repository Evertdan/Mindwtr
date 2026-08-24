# 24. Motor SQLite nativo móvil (op-sqlite)

Fecha: 2026-07-12

## Estado

Aceptado

## Contexto

La aplicación móvil ejecuta la interfaz de usuario, el almacenamiento y todo el ciclo de sincronización en el único subproceso de React
Native JS (#853, evidencia en #766). Los registros beta de #766 muestran el subproceso de JS
— no SQLite — como el cuello de botella: `BEGIN` esperó hasta 16s con
`busy_timeout=5000` y `rowsWritten 0`, mientras que el tiempo SQL propio de las declaraciones
se mantuvo en los cientos bajos de milisegundos. La API async moderna de expo-sqlite
ya ejecuta SQL en una cola nativa, pero cada declaración hace un viaje redondo a través de
la capa async de Expo Modules, la conversión de resultados aterriza en el subproceso de JS, y el
motor solo es accesible desde el tiempo de ejecución principal de JS — así que no hay parte del
ciclo de lectura→fusión→escritura que pueda salir de ese subproceso.

El problema #853 clasifica tres opciones: (1) JS fuera de subproceso para el ciclo de sincronización,
(2) un motor JSI SQLite nativo, (3) un núcleo compartido de almacenamiento/fusión de Rust. Bifurcar
el algoritmo de fusión (opción 3) es el principal riesgo de corrección y se difiere deliberadamente
hasta que se midan 1+2.

## Decisión

Reemplazar expo-sqlite con `@op-engineering/op-sqlite` detrás de la
costura `SqliteClient` existente; el `SqliteAdapter` principal (inserciones guardadas por revisión, caché de
huella digital, FTS) no se toca. El cliente abre el mismo archivo que creó expo-sqlite
(`<documentDirectory>/SQLite/mindwtr.db`), por lo que las instalaciones existentes se actualizan
en su lugar sin migración. FTS5 se habilita a través de la
configuración `op-sqlite` package.json (desactivado de forma predeterminada). expo-sqlite fue
eliminado completamente en lugar de mantenerse como respaldo: op-sqlite documenta conflictos
de pod de iOS con otros paquetes que vinculan SQLite, y Expo Go ya ejecuta la ruta JSON/AsyncStorage
(`Constants.appOwnership === 'expo'`), que se mantiene como respaldo cuando el módulo nativo
no está disponible.

Las fases de seguimiento planeadas bajo #853, en orden: encaminar el trabajo de CPU del ciclo de sincronización
(análisis de carga útil remota, fusión, serialización) en un tiempo de ejecución de JS de fondo a través de
`react-native-worklets` (ya una dependencia a través de Reanimated 4), cerrado en
los diagnósticos de rc.6 confirmando dónde va el tiempo de actualización/fusión; transportar almacenamiento
y fusión a un núcleo compartido de Rust solo si eso aún pierde el objetivo
de <100ms pulsar durante sincronización en una biblioteca de 5k tareas.

## Consecuencias

La ejecución SQL se ejecuta en el subproceso nativo dedicado por base de datos de op-sqlite con un
camino de llamada JSI más barato que el puente de Expo Modules, y el motor es un objeto
anfitrión JSI plano — la propiedad que necesita el trabajo de tiempo de ejecución de fondo de fase 2.
La semántica de la declaración no cambia: una conexión, FIFO por base de datos, manual
`BEGIN IMMEDIATE…COMMIT` del adaptador sigue serializando exactamente como antes.
Los costos: las compilaciones de Android/iOS ahora compilan SQLite desde la fuente (la misma clase de compilación
que whisper.rn, bien para F-Droid), los objetivos web/Expo Go móviles no tienen SQLite
en absoluto (ruta JSON, sin cambios en la práctica), y las actualizaciones principales de op-sqlite rastrean
principales de React Native más agresivamente que lo hacen los paquetes de Expo.

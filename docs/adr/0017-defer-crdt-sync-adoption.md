# ADR 0017: Diferir adopción de sincronización CRDT

Fecha: 2026-05-30
Estado: Aceptado

## Contexto

Mindwtr actualmente usa SQLite como almacén local principal e instantáneas JSON como puente de sincronización y copia de seguridad. La ruta de sincronización central compartida valida y normaliza instantáneas locales y remotas, fusiona matrices de entidades con `rev`/`revBy`, preserva lápidas, repara referencias, registra diagnósticos de conflicto y escribe el resultado fusionado de nuevo a través de puertos específicos del backend.

Loro es un fuerte candidato de CRDT para software nativo-primero:

- se implementa en Rust y expone enlaces de JavaScript/TypeScript y Swift
- admite importación/exportación de actualización orientada a bytes que puede moverse a través de transportes arbitrarios
- incluye árbol movible, lista movible, texto, mapa, vector de versión, instantánea y primitivos de viaje en el tiempo
- su modelo de árbol movible es relevante si Mindwtr crece en jerarquías de tarea/proyecto recursivas más profundas

Sin embargo, adoptar CRDT no es un reemplazo drop-in para el algoritmo de sincronización actual. El modelo de producto y datos de Mindwtr son principalmente instantáneas GTD personales:

- la jerarquía se representa por registros planos con `areaId`, `projectId` y `sectionId`, no un árbol recursivo arbitrario
- los elementos de lista de verificación son matrices locales de tareas, no entidades independientes entre dispositivos
- los backends de sincronización son transportes de instantánea BYOS: sincronización de archivos, WebDAV, Dropbox, CloudKit y nube alojada por el usuario
- la compatibilidad de copia de seguridad/exportación JSON y API en la nube son parte del contrato público
- los archivos adjuntos y los diagnósticos de sincronización locales del dispositivo necesitan manejo específico de la aplicación fuera de cualquier documento CRDT
- los diagnósticos de conflicto actuales son visibles para el usuario y están vinculados a la forma de estadísticas de fusión existente

Cambiar la fuente de producción de verdad de sincronización a un documento CRDT requeriría migración de modelo de datos, compatibilidad dual de lectura/escritura, validación de empaque móvil, compatibilidad de copia de seguridad/exportación, cambios en la API en la nube y una nueva historia de diagnósticos.

## Decisión

Mindwtr no reemplazará el motor de sincronización de producción actual con un documento CRDT en este momento.

La arquitectura actual permanece:

1. SQLite es el almacén local principal.
2. Las instantáneas JSON `AppData` permanecen como puente de sincronización, copia de seguridad, importación/exportación y API en la nube.
3. La sincronización central mantiene la fusión de instantánea consciente de revisión existente, retención de lápida, validación, reparación de referencia y ventana de fusión/escritura serializada.
4. Las bibliotecas CRDT, incluido Loro, pueden evaluarse en prototipos, pero no deben convertirse en dependencias de sincronización de producción hasta que se respondan las preguntas de migración y compatibilidad.

Un prototipo de CRDT debe probar al menos:

1. viaje redondo determinista entre `AppData` JSON actual y el modelo de documento CRDT
2. viabilidad de empaque de React Native Android e iOS, no solo viabilidad de Tauri o web de escritorio
3. compatibilidad con pruebas de sincronización existentes para conflictos de eliminación-vs-activa, lápidas, preferencias de sincronización de configuración, reparación de referencia y metadatos de archivo adjunto
4. preservación de compatibilidad de copia de seguridad/exportación JSON y API en la nube alojada por el usuario
5. un modelo de diagnósticos que pueda reemplazar o asignar nuevamente a entradas de `MergeStats` e historial de sincronización actual
6. una ruta de migración para datos de usuario existentes y versiones de aplicación anteriores

La adopción de CRDT debe reconsiderarse solo si uno o más requisitos de producto cambian sustancialmente:

- la colaboración multiusuario en tiempo real se convierte en una característica de primera clase
- Mindwtr introduce tareas de estilo esquematizador recursivo o árboles de proyecto donde los movimientos concurrentes son comunes
- la sincronización punto a punto se convierte en un backend admitido
- la recuperación de historial de edición/viaje en el tiempo se convierte en una característica central del usuario
- el tamaño de la instantánea o la latencia de sincronización cruza los umbrales descritos en ADR 0008

## Consecuencias

- El modelo de sincronización de producción permanece simple, depurable y compatible con backends BYOS actuales.
- Loro sigue siendo una dirección futura plausible, especialmente para notas colaborativas, árboles de tareas anidadas o sincronización P2P, pero no un reemplazo a corto plazo para `mergeAppData`.
- El trabajo futuro de CRDT debe comenzar detrás de un adaptador o experimento aislado, no reescribiendo acciones de almacén central o reemplazando el puente JSON.
- Cualquier modelo futuro respaldado por CRDT aún debe exponer JSON `AppData` como límite de compatibilidad estable a menos que un ADR separado deprecie intencionalmente ese contrato.
- Esta decisión extiende ADR 0008 y ADR 0009 en lugar de reemplazarlos.

# ADR 0009: SQLite como almacén principal, JSON como puente de instantánea de sincronización

Fecha: 2026-04-16
Estado: Aceptado

## Contexto

Mindwtr persiste datos estructurados en SQLite en escritorio y móvil, mientras que los backends de sincronización intercambian una instantánea JSON (`data.json`) más archivos adjuntos.

Esa representación dual es intencional, pero el contrato solo estaba implícito por texto de código y wiki:

- SQLite maneja lecturas locales, consultas e inicio de aplicación.
- Los backends de sincronización leen y escriben instantáneas JSON.
- Los servicios de sincronización vaciaban guardados locales pendientes antes de leer para sincronización.
- El escritorio y el móvil permiten ediciones durante la sincronización, por lo que deben evitar sobrescribir el estado local más fresco.

Sin un ADR explícito, el riesgo es una desviación accidental en el trabajo futuro: tratar SQLite y JSON como pares iguales, sincronizar diagnósticos locales del dispositivo de forma remota o agregar rutas de escritura que eviten los invariantes del puente.

## Decisión

Mindwtr mantiene SQLite y JSON, pero con un contrato asimétrico:

1. SQLite es el almacén local principal.
   - El arranque en frío, consultas y lecturas normales de la aplicación provienen del almacenamiento respaldado por SQLite.
   - JSON no es una segunda fuente de verdad local durante el tiempo de ejecución ordinario.
2. `data.json` es una instantánea de transporte y copia de seguridad.
   - La sincronización saliente exporta la instantánea de aplicación actual desde almacenamiento local después de que se vacíen los guardados locales pendientes.
   - La sincronización entrante valida y normaliza JSON externo, lo fusiona con datos locales y luego persiste el resultado fusionado de nuevo en almacenamiento respaldado por SQLite.
3. Los diagnósticos de sincronización permanecen locales del dispositivo.
   - Configuraciones como `lastSyncStats`, `lastSyncHistory` e indicadores de recuperación de escritura remota pendiente son útiles localmente, pero se eliminan de cargas útiles remotas.
4. La sincronización no toma un bloqueo de edición de interfaz de usuario.
   - El escritorio y el móvil detectan cambios de instantánea locales durante escrituras de sincronización.
   - Si los datos locales cambian a mitad de ciclo, la sincronización actual se aborta y se pone en cola una ejecución nueva en lugar de sobrescribir el estado local más nuevo.

## Consecuencias

- El puente es más fácil de razonar: SQLite es autoritativo localmente, JSON es la representación de sincronización/copia de seguridad.
- Los cambios futuros de sincronización o almacenamiento deben preservar el contrato de descarga -> lectura -> fusión -> persistencia o actualizar este ADR.
- Los diagnósticos de sincronización locales del dispositivo permanecen útiles sin crear churn entre dispositivos.
- Los usuarios pueden seguir editando durante la sincronización, pero pueden ver un reintento/requeue de sincronización en lugar de un bloqueo de edición duro.

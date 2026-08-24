# ADR 0020: Ciclo de vida y crecimiento del documento de sincronización

Fecha: 2026-07-02
Estado: Aceptado

## Contexto

La misma pregunta de escalabilidad sigue regresando en discusiones comunitarias (#629 dividir archivos en `archive.json`, #793 por qué `data.json` crece y se encoge, #802 entradas de tiempo solo adición): ¿qué crece en el conjunto de datos sincronizado, qué lo reduce y cuál es el plan a largo plazo cuando se vuelve grande?

Las respuestas existen, pero solo como respuestas de discusión dispersas. Restricciones de diseño de ADRs e incidentes anteriores:

- ADR 0008 mantiene la fusión de instantánea completa sin registro de delta.
- Los backends de archivo (WebDAV, carpeta, Dropbox) cargan archivos independientemente. Dividir el conjunto de datos entre archivos convierte el archivo/desarchivado en una transacción entre archivos e invita a split-brain (#629).
- Los campos heredados viven en cargas útiles remotas durante años; eliminar uno sin un paso de franja causó el incidente de conflicto perpetuo #698.

## Decisión

1. **Un documento sincronizado.** El conjunto de datos se mantiene como una unidad de fusión única. Sin `archive.json`, sin archivos por entidad, a menos que un cambio futuro traiga un protocolo de confirmación de múltiples archivos atómico con él. Las características prefieren campos en entidades existentes sobre nuevos documentos de nivel superior.
2. **SQLite es el almacén; `data.json` es una instantánea.** La fuente local de verdad es SQLite. `data.json` se reescribe del almacén como una instantánea de sincronización/copia de seguridad — no es un registro de adición y no necesita compactación manual.
3. **El crecimiento está limitado por reglas de ciclo de vida, declaradas en el momento del diseño.** Las entidades eliminadas se convierten en lápidas y se podan después de la ventana de retención (90 días por defecto). La purga de basura elimina entidades inmediatamente (manteniendo una lápida hasta que expira la retención). Los metadatos de archivo adjunto y las eliminaciones remotas pendientes tienen reintentos y edades limitadas. Cualquier dato sincronizado nuevo debe indicar su curva de crecimiento por adelantado; los datos de adición para siempre solo son aceptables con un rollup o regla de retención definida al nacer, no "más tarde".
4. **La dirección de optimización del tamaño de carga útil es sincronización incremental a nivel de registro**, construida sobre `rev`/`revBy` (ADR 0008), no más archivos. Hasta entonces, el tamaño de la instantánea es el intercambio aceptado.
5. **Los recortes de campo heredado están cerrados de migración.** Por ejemplo, las tareas serializan tanto `order` como su alias heredado `orderNum`. Soltar un alias de cargas útiles requiere un paso de franja/normalización que tolera clientes antiguos (la lección #698); es trabajo programado, no una limpieza rápida.

## Consecuencias

- Las preguntas comunitarias sobre el crecimiento de archivos pueden ser respondidas con una página de documentación en lugar de explicaciones por hilo.
- Las propuestas que agregan datos sincronizados ilimitados (por ejemplo, registros de tiempo por sesión) se evalúan contra la regla 3 antes de la implementación.
- El trabajo de transporte de sincronización, cuando sucede, está limitado al intercambio de registro incremental en lugar de cambios de diseño de archivo.

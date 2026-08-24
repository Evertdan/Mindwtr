# ADR 0011: Modelo de sincronización de archivos adjuntos

Fecha: 2026-04-24
Estado: Aceptado

## Contexto

Las tareas y proyectos pueden hacer referencia a archivos adjuntos, pero los bytes de archivo adjunto tienen restricciones diferentes de datos GTD estructurados:

- los archivos pueden ser mucho más grandes que la instantánea JSON
- los URI de archivo local son específicos del dispositivo
- las rutas de objeto remoto deben sobrevivir la sincronización entre dispositivos
- el progreso de carga/descarga es útil localmente pero no debe crear churn remoto
- las eliminaciones necesitan limpieza de estilo lápida para que los archivos huérfanos remotos no se acumulen

Mezclar transferencia de archivo adjunto binario directamente en la instantánea JSON principal haría que la sincronización ordinaria de tareas fuera más lenta y más difícil de recuperar.

## Decisión

Mindwtr trata metadatos de archivo adjunto como parte de datos de tarea/proyecto y bytes de archivo adjunto como un flujo de transferencia separado.

El contrato de metadatos es:

1. `cloudKey`, `mimeType`, `size` y `fileHash` pueden sincronizar porque describen el objeto remoto.
2. `uri` es estado local del dispositivo y está excluido de comparación remota.
3. `localStatus` rastrean disponibilidad local y estado de transferencia; se persisten localmente pero se excluyen de comparación remota.
4. Las eliminaciones de archivos adjuntos utilizan metadatos de eliminación suave primero, luego la limpieza en segundo plano elimina archivos locales y remotos huérfanos.

El contrato de transferencia es:

1. La sincronización de datos estructurados puede converger sin descargar primero todos los archivos adjuntos.
2. La carga/descarga de archivos adjuntos es específica del backend pero debe actualizar metadatos locales a través de los mismos registros de tarea/proyecto.
3. La lógica de fusión debe preservar un URI local utilizable cuando dos dispositivos tienen rutas locales válidas diferentes para el mismo archivo adjunto.
4. Las eliminaciones remotas se reintentan a través del estado de limpieza de archivo adjunto en lugar de bloquear el ciclo de sincronización principal indefinidamente.
5. Antes de que un backend nuevo o cambiad se active, su sonda de activación debe contabilizar todos los archivos adjuntos de archivo activos. El backend debe verificar el objeto remoto o cargar una copia local; una clave de objeto de otro backend no prueba disponibilidad.
6. Las sondas de activación fusionan el documento candidato primero, luego ejecutan transferencia de archivos adjuntos contra un clon de esa instantánea fusionada inmediatamente antes de la escritura del candidato. Esto contabiliza archivos adjuntos solo remotos de candidato también como locales y evita que una fila de metadatos remoto más nueva reemplace una clave que la sonda acaba de probar. La sonda puede publicar metadatos de archivo adjunto probado a la candida remota, pero no persisten ese metadatos en el almacén local hasta que la configuración candidata pase y se complete una sincronización normal.
7. La primera sincronización durable después de la activación trata las claves de archivo adjunto activas en ese documento candidato probado como autoritarias para el nuevo destino mientras se preservan URI de archivo local y disponibilidad.

## Consecuencias

- La sincronización principal permanece rápida y determinista para datos de tareas.
- Las rutas locales del dispositivo y el estado transitorio de transferencia no crean conflictos falsos.
- Los usuarios pueden ver si un archivo adjunto está disponible, faltante, cargando o descargando en el dispositivo actual.
- Los backends necesitan código de validación y limpieza específico del archivo adjunto.
- Un cambio de backend falla cerrado cuando Mindwtr no puede probar uno de los archivos adjuntos activos en el destino candidato.
- El trabajo futuro de archivos adjuntos debe preservar la división de metadatos vs bytes a menos que una nueva arquitectura de almacenamiento reemplace la sincronización de instantánea por completo.

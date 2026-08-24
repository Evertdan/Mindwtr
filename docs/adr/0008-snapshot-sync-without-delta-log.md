# ADR 0008: Sincronización de instantánea sin registro de delta

Fecha: 2026-04-16
Estado: Aceptado

## Contexto

Mindwtr ya envía sincronización BYOS basada en archivos y otros backends usando fusión de instantánea completa. El modelo de sincronización actual es consciente de revisiones y determinista:

- ADR 0003 introdujo metadatos `rev` y `revBy` con reglas de fusión conscientes de lápidas.
- ADR 0007 mantuvo ese modelo y cambió solo la regla de ganador ambigua de eliminación-vs-activa.

Para una aplicación GTD personal a escala actual, el enfoque de instantánea sigue siendo el intercambio correcto porque:

- los recuentos de entidad son pequeños
- los recuentos de dispositivo son bajos
- los datos son por usuario en lugar de compartidos a escala de equipo
- las escrituras de archivo completo son simples y atómicas
- los campos `rev` y `revBy` existentes ya previenen actualizaciones perdidas sin un registro de operación separado

Un registro de delta añadiría compactación, seguimiento de marca de agua, reglas de reproducción y más estado de sincronización para depurar. Esa complejidad no está justificada aún.

## Decisión

Mindwtr mantiene la fusión de instantánea y no agrega un registro de delta en este momento.

Si el transporte de sincronización evoluciona más tarde, debe construirse sobre los metadatos `rev` y `revBy` existentes y preservar las reglas de conflicto actuales de ADR 0003 y ADR 0007. No estamos introduciendo un nuevo esquema de número de secuencia.

## Consecuencias

- La sincronización sigue siendo más simple de razonar: fusionar dos instantáneas, escribir un resultado fusionado y mantener la atomicidad de archivo completo.
- El trabajo de implementación actual debe enfocarse en reactividad de almacén, actualizaciones dirigidas y experiencia de usuario de sincronización en lugar de inventar una segunda representación de sincronización.
- Debemos revisar esta decisión solo si se cruzan uno o más de estos umbrales:
  - el archivo de instantánea de un usuario excede 5 MB
  - la latencia de viaje redondo de sincronización excede 5 segundos en una red típica
  - Mindwtr necesita transmisión en tiempo real de múltiples dispositivos
- Si esa revisión sucede, el primer diseño a evaluar es un `mindwtr-delta.jsonl` de solo adición junto con `mindwtr-snapshot.json`, construido sobre los metadatos `rev` y `revBy` existentes, manteniendo las reglas actuales de resolución de conflictos, compactando por la revisión más alta por id de entidad y seguimiento de marcas de agua por dispositivo.

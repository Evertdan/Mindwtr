# ADR 0007: Preferir datos activos en fusiones ambiguas de eliminación-vs-activa

Fecha: 2026-04-14
Estado: Aceptado

## Contexto

ADR 0003 estableció sincronización consciente de revisiones con lápidas y desempates deterministas. Su regla original de eliminación-vs-activa prefería la lápida cuando los tiempos de operación eran iguales.

Después de más tráfico de sincronización del mundo real, esa regla resultó demasiado agresiva alrededor de ediciones muy juntas y dispositivos sesgados de reloj. Mindwtr 0.8.2 cambió el comportamiento enviado y las notas de lanzamiento para preferir datos activos en fusiones ambiguas de eliminación-vs-activa.

## Decisión

Mantenemos la sincronización consciente de revisiones, lápidas y desempates deterministas de ADR 0003, pero cambiamos la regla de ambigüedad de eliminación-vs-activa:

1. Comparar conflictos de eliminación-vs-activa usando tiempo de operación (`max(updatedAt, deletedAt)` para lápidas).
2. Si las dos operaciones están separadas por más de 30 segundos, la operación más nueva gana.
3. Si las dos operaciones caen dentro de la ventana de ambigüedad de 30 segundos y un lado tiene un número de revisión más alto, la revisión más alta gana.
4. De lo contrario, preservar el elemento activo en lugar de dejar que la lápida gane de forma predeterminada.

Esto reemplaza la regla de ganador de eliminación-vs-activa en ADR 0003.

## Consecuencias

- El conjunto de ADR ahora coincide con el comportamiento de sincronización de 0.8.2 enviado y las notas de lanzamiento.
- Las carreras de eliminación-vs-activa casi simultáneas tienen menos probabilidad de descartar una edición activa válida debido al sesgo de reloj o propagación de eliminación anticuada.
- La ambigüedad de eliminación-vs-activa sigue siendo una regla de comportamiento de sincronización: los cambios futuros aún requieren actualizaciones explícitas de ADR y pruebas.

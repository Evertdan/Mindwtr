# ADR 0016: Serializar ciclos de sincronización alrededor de la ventana de fusión/escritura

Fecha: 2026-05-06
Estado: Aceptado

## Contexto

El escritorio y el móvil pueden solicitar sincronización desde múltiples disparadores: inicio, primer plano, trabajo en segundo plano programado, botones manuales y nudges posteriores al guardado. Sin serialización, dos ciclos pueden superponer sus ventanas de lectura, fusión y escritura.

Los ciclos superpuestos pueden escribir instantáneas fusionadas obsoletas, perder lápidas o informar estado de conflicto engañoso incluso cuando cada fusión individual es válida.

## Decisión

Serializar `performSyncCycle` en core para que solo se ejecute un ciclo de lectura/fusión/escritura a la vez en un proceso. Las solicitudes de sincronización de seguimiento se ponen en cola detrás del ciclo en vuelo.

En móvil, las ejecuciones de sincronización y transferencias destructivas de documentos completos (importación, restauración o reemplazo) también comparten un carril de operación de documento serializado. Una transferencia toma la barrera de escritura del almacén solo después de que llega al frente de ese carril; las ediciones ordinarias pueden continuar durante la sincronización y se manejan mediante la verificación de frescura existente y la ruta de seguimiento de sincronización.

El ordenamiento de conflicto de lápida también trata el tiempo efectivo de una operación de eliminación como `max(updatedAt, deletedAt)`. Esto preserva las eliminaciones que recibieron actualizaciones de metadatos posteriores y evita que una edición activa entre `deletedAt` y una `updatedAt` de lápida posterior gane incorrectamente.

## Consecuencias

- La sincronización manual y programada ya no puede intercalar escrituras dentro del mismo proceso de aplicación.
- La sincronización móvil no puede intercalar su ventana de lectura/fusión/escritura con una importación o restauración de documento completo, independientemente de qué operación comience primero.
- El invariante de fusión/escritura central es comprobable una vez en lugar de ser reimplementado en servicios de escritorio y móvil.
- La concurrencia entre dispositivos se resuelve mediante las reglas de fusión de sincronización; esta decisión solo serializa ciclos locales en proceso.
- Un tiempo de ejecución de sincronización compartida posterior puede reutilizar este comportamiento central en lugar de agregar otro mutex a nivel de plataforma.

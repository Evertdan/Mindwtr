# ADR 0001: Restricciones de SQLite y eliminaciones suaves de sincronización

Fecha: 2026-01-30
Estado: Aceptado

## Contexto

Mindwtr es nativo-primero y utiliza lápidas de eliminación suave para que las eliminaciones se puedan sincronizar de forma segura entre dispositivos. El esquema SQLite local tiene relaciones entre tareas, proyectos, secciones y áreas. Aún queremos que SQLite proteja la integridad referencial básica de registros activos, pero también necesitamos lógica de reparación consciente de sincronización para eliminaciones suaves, lápidas y cargas útiles heredadas.

## Decisión

Mantenemos las restricciones de clave externa de SQLite **activadas**.

- `tasks.projectId`, `tasks.sectionId`, `tasks.areaId` y `projects.areaId` utilizan `ON DELETE SET NULL`.
- `sections.projectId` utiliza `ON DELETE CASCADE`.
- La eliminación suave, la retención de lápidas y la reparación de referencias entre dispositivos aún viven en la lógica de aplicación compartida.

Esto nos proporciona protección a nivel de base de datos para eliminaciones duras mientras se preserva el comportamiento de fusión y reparación consciente de sincronización en la capa central.

## Consecuencias

- Las eliminaciones duras aún pueden propagarse en la capa de SQLite, especialmente para la limpieza de proyecto -> sección.
- Las fusiones de sincronización siguen siendo responsables de las lápidas, resolución de ambigua eliminación-vs-activa y reparación de referencias huérfanas después de fusión/importación.
- La validación de datos aún debe ocurrir en el almacén central, normalización de sincronización y rutas de importación.

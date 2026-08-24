# ADR 0004: SQLite WAL y FTS5 como pila de persistencia local predeterminada

Fecha: 2026-03-14
Estado: Aceptado

## Contexto

Mindwtr es nativo-primero y necesita un enfoque de persistencia único que funcione entre escritorio y móvil sin introducir un servicio de base de datos separado o una capa de almacenamiento específica de sincronización.

La capa de almacenamiento necesita soportar:

- lecturas y escrituras sin conexión con baja sobrecarga operativa
- patrones de acceso concurrente seguro desde código de aplicación y trabajo en segundo plano
- instantáneas predecibles para sincronización/exportación
- búsqueda de texto completo rápida sobre tareas y proyectos

Usar SQLite con registro de escritura anticipada (WAL) e índice FTS5 mantiene el modelo de almacenamiento incrustado y portátil mientras aún cubre esos requisitos.

## Decisión

Usamos SQLite como almacén local principal, habilitamos modo WAL y mantenemos índices de búsqueda respaldados por FTS5 para búsqueda de tarea/proyecto.

Este sigue siendo la pila de persistencia predeterminada para adaptadores de escritorio y móvil a menos que una restricción de plataforma fuerce una ruta de respaldo temporal.

## Consecuencias

- La búsqueda permanece local y rápida sin introducir un servicio de búsqueda externo.
- Los lectores pueden continuar mientras las escrituras están en progreso, lo que se ajusta mejor al modelo nativo-primero de Mindwtr que un archivo JSON bloqueado único.
- Debemos administrar migraciones de esquema, reconstrucciones de índice FTS y recuperación de corrupción explícitamente en código de aplicación.
- Las copias de seguridad JSON y las exportaciones siguen siendo importantes como mecanismos de portabilidad y reparación, pero no son el almacén de tiempo de ejecución principal.

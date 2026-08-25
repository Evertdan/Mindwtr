# Registros de decisiones de arquitectura (ADR)

Esta carpeta contiene pequeños documentos de decisión enfocados que explican **por qué** hicimos una opción técnica.

## Índice

- [ADR 0001: Restricciones de SQLite y eliminaciones suaves de sincronización](0001-sqlite-constraints.md)
- [ADR 0002: Almacén central compartido entre escritorio y móvil](0002-shared-core-store.md)
- [ADR 0003: Sincronización consciente de revisiones con resolución determinista de lápidas](0003-revision-aware-sync.md)
- [ADR 0004: SQLite WAL y FTS5 como pila de persistencia local predeterminada](0004-sqlite-wal-fts5.md)
- [ADR 0005: Política de retención y purga de lápidas](0005-tombstone-retention-policy.md)
- [ADR 0006: Zustand como modelo de estado compartido principal](0006-zustand-shared-state-model.md)
- [ADR 0007: Preferir datos activos en fusiones ambiguas de eliminación-vs-activa](0007-live-wins-in-ambiguous-delete-merge.md)
- [ADR 0008: Sincronización de instantánea sin registro de delta](0008-snapshot-sync-without-delta-log.md)
- [ADR 0009: SQLite como almacén principal, JSON como puente de instantánea de sincronización](0009-sqlite-json-sync-bridge.md)
- [ADR 0010: Servidor de sincronización en la nube alojado por el usuario](0010-self-hosted-cloud-sync-server.md)
- [ADR 0011: Modelo de sincronización de archivos adjuntos](0011-attachment-sync-model.md)
- [ADR 0012: Cascada de eliminación suave de área](0012-area-soft-delete-cascade.md)
- [ADR 0013: Recordatorios de inicio y vencimiento divididos](0013-start-due-reminder-split.md)
- [ADR 0014: Puertos de orquestación de sincronización compartida](0014-sync-orchestration-ports.md)
- [ADR 0015: Límite de revisiones de sincronización en techo de entero seguro](0015-sync-revision-cap.md)
- [ADR 0016: Serializar ciclos de sincronización alrededor de la ventana de fusión/escritura](0016-sync-cycle-serialization.md)
- [ADR 0017: Diferir adopción de sincronización CRDT](0017-defer-crdt-sync-adoption.md)
- [ADR 0018: Tematización móvil a través de gancho de token unificado con invariante de aislamiento de tema](0018-mobile-theming-token-hook.md)
- [ADR 0019: Contrato de audio móvil local Whisper](0019-mobile-local-whisper-audio-contract.md)
- [ADR 0020: Ciclo de vida y crecimiento del documento de sincronización](0020-sync-document-lifecycle.md)
- [ADR 0021: Candidatos de revisión más allá de fechas de revisión](0021-review-candidates-beyond-review-dates.md)
- [ADR 0022: Lista de verificación desacoplada del markdown de descripción](0022-checklist-decoupled-from-description-markdown.md)
- [ADR 0023: DndContext unificado de vista de proyectos](0023-unified-projects-view-dnd-context.md)
- [ADR 0024: Motor SQLite nativo móvil (op-sqlite)](0024-mobile-native-sqlite-engine.md)
- [ADR 0025: Sin encriptación de la carga útil de sincronización combinada por el servidor; backends de blob encriptados con frase de contraseña son de primera parte](0025-no-first-party-payload-encryption.md)
- [ADR 0026: Divergencia del módulo TDAH: estado de servidor fuera del documento de sincronización](0026-tdah-module-divergence.md)

## Plantilla

Usa esta estructura cuando agregues un nuevo ADR:

```
# ADR XXXX: Título

Fecha: AAAA-MM-DD
Estado: Propuesto | Aceptado | Deprecado | Superado

## Contexto
Explica el problema y restricciones.

## Decisión
Describe la opción y razonamiento.

## Consecuencias
Lista compensaciones, riesgos y trabajo de seguimiento.
```

# Architecture Decision Records (ADR)

This folder contains small, focused decision documents that explain **why** we made a technical choice.

## Index

- [ADR 0001: SQLite constraints and sync soft-deletes](0001-sqlite-constraints.md)
- [ADR 0002: Shared core store across desktop and mobile](0002-shared-core-store.md)
- [ADR 0003: Revision-aware sync with deterministic tombstone resolution](0003-revision-aware-sync.md)
- [ADR 0004: SQLite WAL and FTS5 as the default local persistence stack](0004-sqlite-wal-fts5.md)
- [ADR 0005: Tombstone retention and purge policy](0005-tombstone-retention-policy.md)
- [ADR 0006: Zustand as the primary shared state model](0006-zustand-shared-state-model.md)
- [ADR 0007: Prefer live data in ambiguous delete-vs-live merges](0007-live-wins-in-ambiguous-delete-merge.md)
- [ADR 0008: Snapshot sync without a delta log](0008-snapshot-sync-without-delta-log.md)
- [ADR 0009: SQLite as primary store, JSON as sync snapshot bridge](0009-sqlite-json-sync-bridge.md)
- [ADR 0010: Self-hosted cloud sync server](0010-self-hosted-cloud-sync-server.md)
- [ADR 0011: Attachment sync model](0011-attachment-sync-model.md)
- [ADR 0012: Area soft-delete cascade](0012-area-soft-delete-cascade.md)
- [ADR 0013: Split start and due reminders](0013-start-due-reminder-split.md)
- [ADR 0014: Shared sync orchestration ports](0014-sync-orchestration-ports.md)
- [ADR 0015: Cap sync revisions at a safe integer ceiling](0015-sync-revision-cap.md)
- [ADR 0016: Serialize sync cycles around the merge/write window](0016-sync-cycle-serialization.md)
- [ADR 0017: Defer CRDT sync adoption](0017-defer-crdt-sync-adoption.md)
- [ADR 0018: Mobile theming via unified token hook with theme-isolation invariant](0018-mobile-theming-token-hook.md)
- [ADR 0019: Mobile local Whisper audio contract](0019-mobile-local-whisper-audio-contract.md)
- [ADR 0020: Sync document lifecycle and growth](0020-sync-document-lifecycle.md)
- [ADR 0021: Review candidates beyond review dates](0021-review-candidates-beyond-review-dates.md)
- [ADR 0022: Checklist decoupled from description markdown](0022-checklist-decoupled-from-description-markdown.md)
- [ADR 0023: Unified Projects-view DndContext](0023-unified-projects-view-dnd-context.md)
- [ADR 0024: Mobile native SQLite engine (op-sqlite)](0024-mobile-native-sqlite-engine.md)
- [ADR 0025: No first-party sync-payload encryption; pluggable encrypted backends welcome](0025-no-first-party-payload-encryption.md)

## Template

Use this structure when adding a new ADR:

```
# ADR XXXX: Title

Date: YYYY-MM-DD
Status: Proposed | Accepted | Deprecated | Superseded

## Context
Explain the problem and constraints.

## Decision
Describe the choice and reasoning.

## Consequences
List trade-offs, risks, and follow-up work.
```

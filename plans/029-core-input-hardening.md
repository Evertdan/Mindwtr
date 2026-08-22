# Plan 029: Core input hardening — prototype-chain lookups, OmniFocus budget, CSV import scan

> Drift check: `git diff --stat b0a96ccc9..HEAD -- packages/core/src/markdown.ts packages/core/src/todoist-import.ts packages/core/src/omnifocus-import.ts packages/core/src/mindwtr-csv-import.ts`

## Status
- **Priority**: P2 · **Effort**: M · **Risk**: LOW-MED · **Depends on**: none · **Category**: security/bug/perf
- **Planned at**: `b0a96ccc9`, 2026-08-22

## Findings (one commit each)

1. **SEC-13 prototype-chain lookups** — `packages/core/src/markdown.ts:977` (auto-pair table at `:784`), `:917`/`:952` (table at `:799`) look up user-typed text on object literals: typing `constructor` injects native-function source into the note (EXECUTED by the auditor; assist default-on, `markdown.ts:249-253`; live call sites `TaskItemFieldRenderer.tsx:551`, `TaskEditContentField.tsx:316`). Same class: `todoist-import.ts:241-256` weekdayMap keyed by the DATE cell, guarded only `!== undefined` → inherited function makes day math NaN and `|| 7` fabricates a due date. FIX: all three tables → `Map` (or `Object.create(null)`); Todoist guard → `typeof weekday === 'number'`. Red tests: `applyMarkdownPairInsertion('constructor'…)` returns null (TEST-07b: also add the markdown deny-list test — `[x](javascript:…)` yields a text token, verify it fails with the deny list at `markdown.ts:118-137` removed); Todoist DATE cell `constructor` → skipped, not seven-days-out.
2. **SEC-14 OmniFocus JSON path has no import budget** — `omnifocus-import.ts` imports neither `createImportArchiveBudget` nor `assertImportChecklistItemCount` (all three sibling importers charge one: ticktick:601, todoist:563, mindwtr-csv:633); `:914` tasks uncapped, `:1068` checklists uncapped, `:1124` per-entry JSON.parse. ~16MB of minimal JSON → hundreds of MB + unbounded freeze. FIX: create the budget in `parseOmniFocusImportSource`, thread into `parseJsonImport`, charge consumeEntities/consumeChecklistItems — same error shape as siblings. Red test: oversized synthetic doc → ImportSourceLimitError, matching a sibling's test pattern.
3. **BUG-12 CSV historical-id scan is O(rows × projects) hashing** — `mindwtr-csv-import.ts:955-967` inside the per-row loop flat-maps ALL project scopes into 3 candidate keys each, each SHA-hashed (`createMindwtrCsvImportId` → `generateDeterministicUUID`); benchmarked 6.3 s @5k rows × 200 projects, 61 s @20k×500, synchronous inside `runDataTransferTransaction`. The no-historical-match case is the NORMAL first import. FIX: precompute the ~3×projects prefix strings once outside the row loop so per-row work is one `prefix + sourceId` hash — PRESERVE which id wins (identity resolution drives re-import dedupe; the existing dedupe tests must stay green byte-for-byte). Red evidence: add a bounded perf assertion or (better) extend `performance-large-store`-style budget only if cheap; otherwise pin behavior with an id-resolution equality test across the refactor (same fixture → same ids), and quote before/after timings in the report.

## Verification
Core suite (markdown, todoist-import, omnifocus-import, mindwtr-csv-import files) + `bun run typecheck`. CSV importer memory notes (#1011) say import-apply.ts owns sections — do not drift identity behavior.

## Release notes
Item 1 fixes shipped note-corruption behavior → one unreleased.md line ("typing certain words like 'constructor' no longer corrupts the note text"). Items 2–3: no note (hardening/perf on import paths; item 3 arguably user-visible for big imports — add a line if timings show multi-second wins on realistic sizes).

## STOP
- Item 3: any id-resolution equality test disagrees pre/post refactor.

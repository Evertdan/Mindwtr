# 007 — Stop the mobile capture path loading the import parsers

Base: 0e4021faa · Finding: A-05 [PERF-03] (improve audit 2026-08-13) · One commit.

## Context
`apps/mobile/lib/data-transfer.ts:35-47` statically imports 4 core import parsers (~150KB source); `apps/mobile/components/quick-capture-sheet.tsx:56` imports `createMobileRecoverySnapshot` from it, so Metro (no tree-shaking) evaluates the parsers when capture mounts. Desktop twin (`apps/desktop/src/lib/data-transfer.ts:19-39`, `QuickAddModal.tsx:43` → `createDesktopRecoverySnapshot`) has the same shape but Rollup tree-shakes; fix mobile first, desktop only if trivial by symmetry.

## Fix (decided)
Extract the recovery-snapshot helpers (`createMobileRecoverySnapshot` and their direct dependencies — the snapshot write path landed in aa53238c5 lives in data-transfer.ts; move the snapshot cluster, not the importers) into `apps/mobile/lib/recovery-snapshot.ts`; capture components import from there; data-transfer.ts re-exports for its internal use (or imports from the new module) so settings-side callers are unchanged.
- Metro constraint: if the new module imports core subpaths, they must be reachable via core index.ts barrel (report any missing export line to the coordinator — do not edit index.ts).
- Mirror on desktop only if it's a pure move with no test churn; otherwise skip and say so.

## TDD/verification
- Existing data-transfer tests keep passing; move the snapshot tests (or their imports) with the code.
- Static proof: `bunx vitest run` the capture-sheet test file; grep proof that quick-capture-sheet's transitive import chain no longer reaches `mindwtr-csv-import` (e.g. `bun build --target=node --analyze`-style or a require-trace in a small script — state the method and result).
- Optional (only if an emulator is already running — do NOT set one up): mobile startup bench before/after.

## Scope
In: apps/mobile/lib/data-transfer.ts, new recovery-snapshot.ts, capture-sheet import line, tests; optionally the desktop twin. Out: importer logic, snapshot format/naming (just moved).

## Gates
`bun run --filter mobile test:coverage` + `bun run typecheck:mobile`. Real exit codes.

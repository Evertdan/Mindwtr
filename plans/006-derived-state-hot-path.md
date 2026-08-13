# 006 — Cheapen the per-mutation derived-state pass (collators + single pass)

Base: 0e4021faa · Findings: A-02 [PERF-01], A-04 [PERF-02] (improve audit 2026-08-13) · Two commits.

## Commit 1 (A-02, collators)
22 non-test comparator sites call `localeCompare(x, undefined, {opts})` — constructing a collator per comparison (V8 caches only the argless default). Hottest: `packages/core/src/task-token-usage.ts:77,95,110` and `store-helpers.ts:820-821` (per-mutation derived state); also store-helpers.ts:371, focus-grouping.ts:90,128, people.ts:164,215, `apps/desktop/src/components/views/list/next-grouping.ts:177,353,430`, `apps/mobile/lib/task-group-sections.ts:179`, and the rest findable by grepping `localeCompare(` with an options arg. `packages/core/src/task-utils.ts:22` already exports the pattern (`textCollator`).
- Add TWO shared collators in task-utils.ts: base-sensitivity (`{sensitivity:'base'}`) and numeric (`{numeric:true,sensitivity:'base'}`); re-export via the quick-add-style barrel path only if mobile imports them (check Metro constraint).
- Swap every options-bag comparator site to `collator.compare(a,b)`; NEVER collapse the numeric sites (TaskItemEditor.tsx:153, InboxProcessingWizard.tsx:257, InboxProcessingQuickPanel.tsx:192) into the base one. Argless `localeCompare()` sites stay untouched.
- Behavior-preserving: `new Intl.Collator(undefined, opts).compare` ≡ `localeCompare(x, undefined, opts)`. Existing sort-order tests must stay green unchanged.

## Commit 2 (A-04, single pass)
`computeTaskDerivedState` (`packages/core/src/store-helpers.ts:765-810`) walks all tasks 3× (collectTaskTokenUsage for contexts, again for tags, then the main loop). Fold token accumulation into the existing main `forEach`. SUBTLETY (load-bearing): the main loop skips `task.deletedAt` at :773 while `collectTaskTokenUsage` runs over the unfiltered array — REPLICATE collectTaskTokenUsage's inclusion rule exactly for the token accumulation (deleted tasks still counted if that's the current behavior — verify by reading collectTaskTokenUsage first and pin it with a test BEFORE folding). Keep `collectTaskTokenUsage` exported for its other callers.
- Red: pin current context/tag usage output for a fixture including deleted+archived tasks; fold; identical output.

## Gates
Core suite + `bun run test:perf` (Production task-derived state budget row — record before/after numbers, loadavg < 8) + desktop suite (next-grouping touched). Real exit codes.

## Escape hatch
If perf gate worsens or output differs on any fixture, STOP and report rather than adjusting the budget or the inclusion rule.

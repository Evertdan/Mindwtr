# Plan 030: Fix the quadratic bulk-update path and give it a budget

> Drift check: `git diff --stat b0a96ccc9..HEAD -- packages/core/src/store-tasks.ts packages/core/src/performance-large-store.test.ts`

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none · **Category**: perf
- **Planned at**: `b0a96ccc9`, 2026-08-22

## Why
`packages/core/src/store-tasks.ts:1124-1128` — inside the per-task loop of `batchUpdateTasks`, `findExistingRecurringFollowUp([...newAllTasksBase, ...nextRecurringTasks], …)` copies the ENTIRE task collection per updated task (arguments evaluate eagerly; the callee's null guard at `:1129` runs after the copy). `:1130` re-spreads the accumulator per append. "Select all → Move" on 5k tasks ≈ 25M element copies / ~200MB transient garbage inside one synchronous zustand set(). Reachable: `selectAllVisibleTasks` has no cap (`useTaskSelection.ts:145-149`) → `batchMoveTasks` → `batchUpdateTasks`; same core backs mobile. Secondary: `ids.indexOf(id) === index` dedupe at `:1071,1170` (error-path only — clean up in passing).

**PERF-02**: no perf budget anywhere references batchUpdateTasks/batchMoveTasks/batchDeleteTasks — the one hot path a user can hand 5k mutations with no gate.

## Steps
1. Red budget test FIRST (PERF-02): add a `describePerf` case in `performance-large-store.test.ts` budgeting `batchUpdateTasks` over all tasks at the existing size tiers, using the file's `expectWithinBudget` helper and fixtures; pick the budget from the POST-fix timing with the suite's usual headroom multiplier, then confirm the guard bites by running it against the UNFIXED code (should fail) — do this by writing the test, seeing it fail (or grossly exceed) pre-fix, then fixing. Record the number in `docs/performance-budgets.md` (gated behind MINDWTR_PERF_TEST like siblings).
2. Fix (PERF-01): wrap the `findExistingRecurringFollowUp` call in `if (stampedNextRecurringTask)`; replace the accumulator spread-reassign with `push` (function-local, only read after the loop at `:1136-1149`); switch the two indexOf dedupes to a Set. If recurrence-heavy batches still show the scan, index follow-up candidates by dedupe key once before the loop.
3. Verify: `bun run --filter @mindwtr/core test -- store-tasks recurrence` green (behavior identical — the guard hoist is semantics-preserving by construction); `MINDWTR_PERF_TEST=1 bun run test:perf` green at loadavg < 8.

Commits: `perf(core): stop copying the whole task collection once per task in batchUpdateTasks` + `test(core): budget the bulk-mutation path` (or one commit if the plan's red-first flow makes them inseparable — prefer two).

## STOP
- Any recurrence test changes outcome (the hoisted guard must be observationally identical).

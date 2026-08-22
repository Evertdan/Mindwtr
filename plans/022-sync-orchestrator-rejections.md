# Plan 022: Stop the sync orchestrator's unhandled rejections; cover its failure paths

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none · **Category**: bug
- **Planned at**: `b0a96ccc9`, 2026-08-22
- Drift check: `git diff --stat b0a96ccc9..HEAD -- packages/core/src/sync-orchestrator.ts packages/core/src/sync-orchestrator.test.ts`

## Why
`packages/core/src/sync-orchestrator.ts:88` — `current.finally(() => {…});` discards the derived promise, which REJECTS with `current`'s reason whenever a cycle throws; `run()` returns `current` (`:121`) so callers handle the original but never the derived one. Every rejecting sync cycle (offline, auth failure, corrupt remote) emits an unhandled rejection — RN red box / crash under `--unhandled-rejections=throw`. Three production consumers: `apps/desktop/src/lib/sync-service.ts:899`, `apps/desktop/src/lib/auto-sync-controller.ts:170`, `apps/mobile/lib/sync-service.ts:1498`. The test file (`sync-orchestrator.test.ts`, 8 tests) has zero rejection coverage (TEST-03) — `onQueuedRunError`, `onDrained`, `reset()` untested.

## Steps
1. Red test: rejecting `runCycle` — assert (a) `run()`'s returned promise rejects with the cause, (b) an `unhandledRejection` listener registered for the test captures NOTHING (fails today), (c) `onQueuedRunError` fires for a queued follow-up failure, (d) drain proceeds after a failure.
2. Fix: run the drain/requeue body from the existing `then(resolve, reject)` chain at `:80-83`, or append `.catch(() => {})` to the derived `finally` chain — whichever keeps the drain semantics byte-identical for the success path.
3. Verify: core suite green; then run desktop + mobile sync-service test files (consumers) to confirm no behavioral shift.

One commit: `fix(core): stop the sync orchestrator emitting an unhandled rejection for every failed cycle`; second commit for the added non-rejection coverage if written separately: `test(core): cover the sync orchestrator's rejection and drain paths`.

## STOP
- The drain body turns out to depend on running in `finally` ordering relative to consumer `.then` handlers (assert ordering in a test before changing it).

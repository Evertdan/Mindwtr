# Plan 018: Centralize mobile store-action settlement

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. The reviewer maintains `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat feecbb40a..HEAD -- apps/mobile/components/store-action-result.ts apps/mobile/app/'(drawer)'/'(tabs)'/focus.tsx apps/mobile/app/check-focus.tsx apps/mobile/components/project-next-action-prompt.tsx apps/mobile/components/swipeable-task-item.tsx apps/mobile/components/swipeable-task-item/useSwipeableChecklist.ts apps/mobile/components/task-edit/use-task-edit-actions.ts apps/mobile/components/task-edit/use-task-edit-state.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `feecbb40a`, 2026-08-14
- **Completed**: 2026-08-14

## Why this matters

Mobile store actions can fail in three ways: they can throw synchronously,
return a rejected promise, or resolve to `{ success: false, error }`. The
existing `store-action-result.ts` exposes the shape inspectors, but 24 call
sites still rebuild the settlement protocol themselves. That duplication has
already produced three different control-flow styles and a local wrapper in
the task editor. Deepen the existing module so every user-awaited write has one
settlement invariant while each screen retains its own toast, logging, undo,
and busy-state policy.

## Current state

- `apps/mobile/components/store-action-result.ts:1-31` owns
  `isActionFailure`, `getActionFailureMessage`, and `getUnknownErrorMessage`,
  but it does not execute or settle an action.
- `apps/mobile/components/task-edit/use-task-edit-actions.ts:121-134` already
  implements a local `runStoreAction` that awaits an action, inspects the
  structured result, catches a rejection, reports the message, and returns a
  boolean. This is the closest existing behavioral exemplar.
- `apps/mobile/components/project-next-action-prompt.tsx:114-174` repeats
  `Promise.resolve(action()).then(inspect-or-throw).catch(report)` for three
  store actions. Because the action is evaluated before `Promise.resolve`, a
  synchronous throw is not captured by that chain.
- `apps/mobile/components/swipeable-task-item.tsx:323-473` contains manual
  synchronous-throw handling plus several separate structured-result and
  rejected-promise branches.
- `packages/core/src/store-types.ts` defines `StoreActionResult`; successful
  results may carry fields such as `id`, `ids`, and `reused`. The new boundary
  must preserve the full successful value.
- Architecture constraint: this is an in-process mobile helper. Do not add a
  port, adapter, React context, toast hook, or cross-platform abstraction.

Target interface:

```ts
export type StoreActionOutcome<T> =
    | { ok: true; result: T }
    | { ok: false; message?: string; cause?: unknown };

export async function settleStoreAction<T>(
    action: () => T | Promise<T>,
): Promise<StoreActionOutcome<T>>;
```

Only an explicit `success === false` is a structured failure. `void`, unknown
values, and successful payloads remain successes. A structured failure uses
its trimmed nonblank `error`; synchronous throws and promise rejections use the
existing unknown-error normalization and preserve the original value as
`cause`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused helper test | `cd apps/mobile && bun run test -- components/store-action-result.test.ts` | all helper cases pass |
| Mobile regressions | `cd apps/mobile && bun run test -- components/swipeable-task-item.test.tsx components/project-next-action-prompt.test.tsx lib/focus-screen.test.tsx components/task-edit/use-task-edit-actions.save-result.test.tsx` | all selected suites pass |
| Typecheck | `bun run typecheck:mobile` | exit 0, no errors |
| Lint | `bun run lint:mobile` | exit 0; existing warnings only |
| Canonical gate | `bun run verify` | exit 0 |

## Scope

**In scope** (the only files you should modify):

- `apps/mobile/components/store-action-result.ts`
- `apps/mobile/components/store-action-result.test.ts` (create)
- `apps/mobile/app/(drawer)/(tabs)/focus.tsx`
- `apps/mobile/app/check-focus.tsx`
- `apps/mobile/components/project-next-action-prompt.tsx`
- `apps/mobile/components/swipeable-task-item.tsx`
- `apps/mobile/components/swipeable-task-item/useSwipeableChecklist.ts`
- `apps/mobile/components/task-edit/use-task-edit-actions.ts`
- `apps/mobile/components/task-edit/use-task-edit-state.ts`
- The focused existing test files listed above, only if a caller-level
  regression assertion is needed.

**Out of scope**:

- `packages/core` store action semantics or return types.
- Desktop call sites.
- Inbox workflow code that receives an already-resolved embedded
  `writeResult`; keep the pure inspectors for that case.
- Toast wording, translations, logging scopes, undo behavior, loading state,
  or callback ordering.
- A new hook, React context, reporter port, or adapter.
- The separate task-field-renderer prop-surface exploration.

## Git workflow

- Work in an isolated worktree from the plan commit plus the plan-set commit.
- Make exactly one implementation commit: `refactor(mobile): settle store actions centrally`.
- Do not push or open a PR.
- Other agents may be active; do not revert or overwrite their changes.

## Steps

### Step 1: Characterize the settlement protocol

Create `apps/mobile/components/store-action-result.test.ts`. Add tests for:

1. a `void` result is successful;
2. a successful payload is returned by identity, including extra fields;
3. `{ success: false, error: ' message ' }` becomes a failure with `message`;
4. a blank structured error yields no message;
5. a synchronous throw becomes a failure and preserves `cause`;
6. a rejected promise becomes a failure and preserves `cause`.

Write the tests against `settleStoreAction` before implementing it and capture
the expected red failure.

**Verify**: `cd apps/mobile && bun run test -- components/store-action-result.test.ts` → fails because the export does not exist.

### Step 2: Deepen the existing result module

Implement `StoreActionOutcome<T>` and `settleStoreAction<T>` in
`store-action-result.ts`. Reuse the existing three pure inspectors; do not
duplicate their shape or message parsing. Invoke the thunk inside `try` so
synchronous throws are captured. Preserve the original successful result and
the original thrown/rejected value.

**Verify**: `cd apps/mobile && bun run test -- components/store-action-result.test.ts` → 6 new tests pass.

### Step 3: Replace direct action-settlement ceremony

Migrate the in-scope direct-action callers to `settleStoreAction`:

- Call the helper with a thunk, inspect `outcome.ok`, and use
  `outcome.message` for each screen's existing reporter.
- Preserve `outcome.result` anywhere success payload fields are used.
- Preserve logging by passing `outcome.cause` to the existing logging helper
  only when present.
- Preserve success callback order, undo registration, `finally` cleanup, and
  loading/busy guards exactly.
- Remove the task editor's local `runStoreAction`; if a screen-specific helper
  is still useful, it may wrap `settleStoreAction` only for local presentation
  and must not re-parse the store result.
- Leave the pure inspectors exported for already-resolved embedded results.

Do not perform unrelated formatting or component refactors.

**Verify**: run the Mobile regressions command → all selected suites pass.

### Step 4: Verify scope and the mobile contract

Run typecheck, lint, and the canonical verification command. Confirm the diff
contains only the in-scope files and that direct-action consumers no longer
combine `Promise.resolve(action())`, `isActionFailure`, and catch-based message
normalization themselves.

**Verify**: `bun run typecheck:mobile && bun run lint:mobile && bun run verify` → exit 0.

## Test plan

- Six pure settlement tests in `store-action-result.test.ts` cover all three
  failure channels plus successful value preservation.
- Existing SwipeableTaskItem, project-next-action, Focus, and task-editor tests
  protect callback ordering, undo behavior, user feedback, and payload use.
- Add a caller-level regression only if an existing suite does not prove that
  a synchronous throw reaches the existing error reporter; keep any such test
  in the named focused files.

## Done criteria

- [x] The six settlement cases pass.
- [x] Successful payload fields remain available through `outcome.result`.
- [x] The six compatible direct-action consumer modules use the shared settlement boundary.
- [x] Inbox embedded-result inspection remains unchanged.
- [x] No toast copy, logging scope, undo behavior, callback order, or busy-state behavior changes.
- [x] Focused caller suites pass.
- [x] `bun run typecheck:mobile`, `bun run lint:mobile`, and `bun run verify` exit 0.
- [x] `git diff --check` exits 0 and no out-of-scope file is modified.
- [x] Exactly one implementation commit exists and nothing is pushed.

Plan deviation resolved during verification: `use-task-edit-state.ts` keeps its
bespoke sync/thenable settlement path because six full-suite tests proved that
void-returning modal saves must close in the same tick. The implementation
adds a comment documenting that constraint; making the shared helper hybrid
would leak the very sync/async distinction this boundary is meant to hide.

## STOP conditions

Stop and report instead of improvising if:

- A successful store result must be transformed rather than preserved.
- A caller intentionally distinguishes synchronous throws from promise
  rejections in its user-visible behavior.
- Preserving behavior requires changing core store types, translations,
  logging infrastructure, or an out-of-scope component.
- The focused suites expose an ordering or undo semantic that the proposed
  outcome interface cannot preserve.
- A verification command fails twice after a reasonable scoped fix.

## Maintenance notes

Future mobile store-action call sites should pass a thunk to
`settleStoreAction` and keep only presentation policy locally. Reviewers should
scrutinize result-payload preservation and cleanup ordering. Do not migrate
already-resolved workflow results merely to eliminate imports; that would make
the boundary shallower, not deeper.

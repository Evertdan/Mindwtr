# Plan 031: Un-stub the mobile suites that test hand-copies of core, and cover CloudKit invariants

> Drift check: `git diff --stat b0a96ccc9..HEAD -- apps/mobile/tests/calendar-push-sync.test.ts apps/mobile/lib/focus-screen.test.tsx apps/mobile/lib/cloudkit-sync.ts apps/mobile/lib/cloudkit-sync.test.ts`
> (TEST-01, the attachment-suite twin of this problem, lives in plan 024 — do not duplicate.)

## Status
- **Priority**: P2 · **Effort**: M · **Risk**: MED (existing assertions were pinned to stub output and must be corrected to production output) · **Depends on**: 024 recommended first (shared vi.mock idiom) · **Category**: tests
- **Planned at**: `b0a96ccc9`, 2026-08-22

## Findings (one commit each)

1. **TEST-02a calendar-push suite stubs the field builder it certifies** — `apps/mobile/tests/calendar-push-sync.test.ts:137` replaces core `buildCalendarPushEventFields` with a 14-line copy omitting the `metaLines` block (`Project: X › Y`, `Status: …`, `Effort: …` — real builder at `packages/core/src/calendar-scheduling.ts:555`); `:152` also stubs `getTaskCalendarOccurrenceDate`. 43 tests guarding what gets written into users' real calendars stay green if the project/section/leadingNote argument were deleted. FIX: drop the core overrides (importOriginal is already spread), correct the exact-`notes` assertions to production output (e.g. `Status: Next\n\nBring notes`). Every assertion change must be toward what production writes — verify one by hand against the real builder before mass-updating.
2. **TEST-02b focus suite stubs safeParseDueDate** — `apps/mobile/lib/focus-screen.test.tsx:144` overrides `safeParseDate`/`safeParseDueDate` with `new Date(value)`, while real `safeParseDueDate` (`date.ts:735`) parses bare dates as LOCAL midnight then end-of-day 23:59:59.999 — up to ~24h swing; five fixtures carry bare dates (`:62,94,545,811,1195`). Deleting the end-of-day normalization would leave the 2153-line suite green. FIX: drop the two overrides, fix fallout toward production semantics, and run the suite once under a non-UTC TZ (`TZ=America/New_York`) locally to prove classification stability; keep CI invocation unchanged.
3. **TEST-09 CloudKit change-token/conflict invariants** — `apps/mobile/lib/cloudkit-sync.ts:317` "only advance the change token when allConflicts.length===0" has no test; nor `:184` tokenExpired → clear+full fetch, `:198` no-changes → null, `:537` deletePurgedRecords. A regression advancing the token after a conflicted save silently skips the failed records forever. FIX: using the existing hoisted native-module mock in `cloudkit-sync.test.ts` (currently regex+abort checks only): assert token NOT persisted on conflicts / persisted on clean save; tokenExpired falls through to fetchAllRecords; only purgedAt ids reach deleteRecords. Each new test must fail with its guard inverted (flip the condition locally to prove, then restore).

## Verification
`bun run --filter mobile test:coverage` full suite (never path-scoped for the final run — repo rule); `bunx tsc --noEmit` mobile.

## STOP
- Un-stubbing reveals a REAL product bug (assertions can't be reconciled with production output because production output is wrong) — report it as a new finding instead of adjusting production code in this plan.

# Plan 021: Consult revisions in delete-vs-live merges outside the ambiguity window (TS + Rust lockstep)

> **Executor instructions**: red tests first; TS and Rust land in ONE commit (shared fixture pins both). Drift check: `git diff --stat b0a96ccc9..HEAD -- packages/core/src/sync.ts packages/core/src/sync-entity-arbitration-parity.fixtures.json apps/desktop/src-tauri/src/storage.rs`.

## Status
- **Priority**: P1 · **Effort**: M · **Risk**: MED (merge-outcome change; both languages must move together) · **Depends on**: none · **Category**: bug (data integrity)
- **Planned at**: `b0a96ccc9`, 2026-08-22

## Why
`packages/core/src/sync.ts` `resolveDeleteVsLiveWinner`: inside the 30 s ambiguity window (`DELETE_VS_LIVE_AMBIGUOUS_WINDOW_MS`, sync-types.ts:87) revision dominance applies (`:512-519`), but once `|operationDiff|` exceeds the window the winner is pure operation-timestamp (`:529-534`, verified) and `revDiff` is never read. A local task live at rev 10 loses to an incoming tombstone at rev 3 whose deletedAt is 31 s later (clock skew or stale replica): seven revisions of edits soft-deleted. Rev-aware LWW is the design (guardrail P-series; same-delete-state path applies rev unconditionally at `:568-570`).

Companion **BUG-17**: `sync.ts:427-448` — `unresolvedDeleteStateDiff` requires `(!hasRevision || revDiff === 0)`, so when a revision resolves a delete-vs-live pair, `differs=false` and neither `stats.maxClockSkewMs` nor a conflict reason is recorded — the clock-skew warning (`:764`,`:1229`) can never fire for revisioned clients.

Companion **TEST-04**: `sync-entity-arbitration-parity.fixtures.json` (consumed by `sync-entity-arbitration-parity.test.ts:18` and `apps/desktop/src-tauri/src/storage.rs:8633`) is Task-only, 16 cases, and its delete-live cases all have rev agreeing with timestamps — the adversarial case has no fixture.

## Design (fixed)
Move the `hasRevision && revDiff !== 0` dominance check so it gates ALL of `resolveDeleteVsLiveWinner` (both inside and outside the window); operation-time comparison remains the tie-breaker when revisions tie or are absent. Record skew/conflict stats whenever `localDeleted !== incomingDeleted` regardless of who wins (stats-only; BUG-17). Mirror the same ordering change in the Rust merge in `storage.rs` (locate via the parity fixture consumer at `:8633` and the delete-vs-live resolution it pins).

## Steps
1. Red fixtures: add a `revision-vs-delete-window` category to the parity fixture — live-higher-rev vs later-tombstone-lower-rev (outside window) → live wins; tombstone-higher-rev vs later-live-lower-rev → tombstone wins; rev-tie outside window → timestamp wins (current behavior); plus one case per non-task entity (project/section/area/person) exercising the same resolver. Raise the pinned cardinality in BOTH consumers. Run both suites → new cases fail in both languages.
2. Implement TS, then Rust, until both consumers pass.
3. BUG-17 stats: red test in `sync-settings.test.ts` or the sync stats suite — revision-resolved delete-vs-live with 6-min skew must increment a conflict reason and record maxClockSkewMs (fails today).
4. Full gates: core suite, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`, plus the existing delete-window tests (must stay green — the in-window and revisionless behaviors are unchanged).

Commits: one for the resolver+fixtures (`fix(sync): let revisions win delete-vs-live merges outside the ambiguity window`), one for stats (`fix(sync): record conflict and clock-skew stats when a revision resolves a delete-vs-live merge`).

## STOP conditions
- The Rust side turns out not to implement delete-vs-live symmetrically (report the divergence; do not invent a new Rust path).
- Any EXISTING fixture case changes outcome — the change must only affect rev-divergent cases outside the window.
- An ADR or code comment explicitly records timestamp-over-revision outside the window as deliberate (search `docs/adr/` + sync.ts comments first).

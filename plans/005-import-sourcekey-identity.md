# 005 — Make import task identity impossible to collapse

Base: 0e4021faa · Finding: R-07 [CORRECTNESS-02] (improve audit 2026-08-13) · One commit.

## Context
`packages/core/src/import-apply.ts:354`: `const taskId = idFor('task', task.sourceKey ?? '')`. `ImportTaskSource.sourceKey` is optional (:69). Under the deterministic `idFor` all importers pass, every sourceKey-less task hashes '' → the SAME id; all but the first are skipped as "already imported" (:355-358, :413-416) — silent data loss reported as success. Latent: all four importers currently populate sourceKey (mindwtr-csv-import.ts:493-501 row-ordinal fallback; ticktick-import.ts:678; dgt-import/apply.ts:46), but the type permits omission.

## Fix (decided)
Make `sourceKey` REQUIRED on `ImportTaskSource` — the compiler then proves every current and future importer supplies it. Fix any resulting compile errors by making the caller's fallback explicit at the callsite (never `?? ''`). Keep `idFor('task', ...)` unchanged.

## TDD
Red test first against current code using a crafted `ImportPlan` with two tasks lacking sourceKey (cast around the type if needed pre-fix) asserting both tasks materialize — observe it fail (1 task + 1 "already imported"), then the type change makes the bad state unrepresentable; keep a runtime test that two distinct sourceKeys yield two tasks and duplicate sourceKeys still dedupe.

## Scope
In: `packages/core/src/import-apply.ts`, the four importer files ONLY if the compiler demands, their tests. Out: id derivation scheme, section ownership (import-apply owns sections — don't disturb), preview logic.

## Gates
`bun run --filter @mindwtr/core test` + root `bun run typecheck` (type change ripples). Real exit codes.

## Escape hatch
If some importer genuinely cannot supply a stable sourceKey, do NOT invent uuid fallback silently inside import-apply — report; the fallback belongs at that importer with a comment.

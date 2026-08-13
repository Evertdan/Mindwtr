# 015 — Make CI actually lint core

Base: 0e4021faa · Finding: DX-03 (improve audit 2026-08-13) · One commit.

## Context
ci.yml:525-526: the step named "Check for lint errors (core)" runs `cd packages/core && bun run tsc --noEmit` — a typecheck duplicating the core job (:43-44). packages/core has a real `lint` script (eslint -c ../../eslint.node.config.mjs) that CI never runs; the largest shared package has zero ESLint enforcement in CI.

## Steps (decided)
1. Size the backlog FIRST: run `bun run --filter @mindwtr/core lint`; record the violation count (real exit code).
2. If ZERO violations: swap the CI step body to the real lint and delete the duplicated tsc line. Done.
3. If violations exist: do NOT fix them in this commit and do NOT blind-swap (that reds CI). Report the count + rule breakdown to the coordinator; the expected resolution is either a small fix-batch commit first (if <20 mechanical items, coordinator will authorize) or per-rule `--max-warnings`-style ratchet — decided then, not improvised.
4. actionlint on ci.yml (exit code stated).

## Scope
In: .github/workflows/ci.yml; packages/core sources ONLY if step 3 authorizes a fix batch. Out: eslint.node.config.mjs rules.

## Gates
actionlint; the lint command itself; nothing else.

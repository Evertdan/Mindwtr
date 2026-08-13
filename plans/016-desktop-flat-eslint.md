# 016 — Migrate desktop ESLint to flat config

Base: 0e4021faa · Finding: DX-06 (improve audit 2026-08-13) · One commit.

## Context
apps/desktop/.eslintrc.cjs is the last eslintrc config (all four other packages are flat); apps/desktop/package.json:22 compensates with `ESLINT_USE_FLAT_CONFIG=false ... --ext ts,tsx`. The escape hatch is removed in ESLint 10, so a major bump silently breaks desktop lint.

## Steps (decided)
1. Record the BEFORE baseline: run desktop lint on current HEAD; save the violation count AND the full file list linted (eslint --debug or a file-list flag) to scratchpad.
2. Translate .eslintrc.cjs (five overrides) to apps/desktop/eslint.config.mjs following the shape of apps/mobile/eslint.config.js / eslint.node.config.mjs; preserve every rule EXACTLY — including `react-hooks/exhaustive-deps: 'off'` (DELIBERATE, do not "fix" toward mobile's error).
3. Drop ESLINT_USE_FLAT_CONFIG=false and --ext from the lint script; delete .eslintrc.cjs.
4. AFTER: rerun; the violation count and the linted file SET must match the baseline exactly — flat config resolves ignores differently, and a silent file-set change is the failure mode. If they differ, reconcile deliberately (ignores block in the flat config) until identical, or STOP and report what can't be matched.

## Scope
In: the two config files + the lint script line. Out: rule changes of any kind, other packages' configs, lint:node wiring (leave; consolidation is a later candidate).

## Gates
Desktop lint before/after with matching counts + file sets (evidence in the report); CI lint step unchanged (it calls `bun run lint`).

# Plan 034: Carry recurrence through the Mindwtr CSV format (DIR-01)

> Drift check: `git diff --stat b0a96ccc9..HEAD -- packages/core/src/mindwtr-csv-export.ts packages/core/src/mindwtr-csv-import.ts packages/core/src/mindwtr-csv-columns.ts packages/core/src/recurrence.ts`

## Status
- **Priority**: P2 · **Effort**: M · **Risk**: MED (recurrence guardrail area) · **Depends on**: none · **Category**: direction (gap closure)
- **Planned at**: `b0a96ccc9`, 2026-08-22

## Why
The RECURRENCE column is reserved and warned about but never written or parsed (`mindwtr-csv-columns.ts:9-10`, `mindwtr-csv-import.ts:443,163`), while both converters already exist and are load-bearing in 17 files (`recurrence.ts:186` parseRRuleString, `:311` buildRRuleString — used by omnifocus and dgt importers and both recurrence editors). Docs steer users away from the first-party CSV format solely because of this (faq.md:499, data-sync/index.md:538, import/index.md:37). Closing it removes the one class of data the recommended migration format drops.

## Design (fixed)
- Export: write `buildRRuleString(task.recurrence)` into the RECURRENCE cell (empty when none). LOW risk, independent.
- Import: parse the cell with `parseRRuleString`; on a parse failure or a rule the model cannot express, WARN PER ROW (naming the row + rule) and import the task without recurrence — never a plausible-but-wrong rule (guardrail history: single-case recurrence patches re-broke 3+ times). Replace the blanket "this importer does not create recurring tasks" warning.
- SPIKE FIRST (30 min, in-report not in-code): list what RRULE subset parseRRuleString accepts (read it + its tests) and confirm buildRRuleString(parse(x)) round-trips for the export side; note unsupported shapes in the import warning text.

## Steps
1. Red test: export a task with each recurrence family (daily/weekly/monthly-day/monthly-nth-weekday/yearly/COUNT, strict + after-completion, date-only + datetime — reuse the recurrence matrix fixtures) → RECURRENCE cell round-trips through parseRRuleString to an equivalent rule. Fails today (cell empty).
2. Implement export. Commit: `feat(core): write recurrence rules into Mindwtr CSV exports`.
3. Red test: import rows with valid rules (task gains recurrence; matrix subset), an invalid rule (warned per row, task imported without recurrence), and NO recurrence column (unchanged behavior).
4. Implement import. Commit: `feat(core): import recurrence rules from Mindwtr CSV (#per-row warnings for unparseable rules)` — fix the commit line style: one line, no parenthetical.
5. Docs follow-up (mindwtr-web, 6-locale rule): update import/mindwtr-csv.md column table + the three steer-away sentences (faq.md:499, data-sync/index.md:538, import/index.md:37) to reflect recurrence support; `bun run check` exit 0. Separate commit in mindwtr-web.
6. unreleased.md line in the import commit (user-facing feature).

## Verification
`bun run --filter @mindwtr/core test -- mindwtr-csv recurrence` + full core suite; recurrence matrix suite green untouched.

## STOP
- parseRRuleString's accepted subset is materially narrower than what the recurrence model expresses (export would emit rules import can't read back) — report the asymmetry with the list; do not ship export-only silently.

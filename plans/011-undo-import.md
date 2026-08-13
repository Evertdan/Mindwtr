# 011 — Offer "Undo import" from the import result instead of manual snapshot navigation

Base: 0e4021faa · Finding: Q-03 [QUALITY-03] (improve audit 2026-08-13) · One commit (+ optional docs follow-up).

## Context
`packages/core/src/import-runner.ts:346,368` returns `snapshotName` from every import; all six import paths + restore/merge toast "Recovery snapshot saved as {{snapshotName}}" (`apps/desktop/src/components/views/settings/useSyncSettings.ts:1302,1358,1419,1480,1543,1606`) and leave the user to navigate Settings → snapshots → match a name from a vanished toast. The restore call and confirmation machinery already exist (snapshot restore path).

## Fix (decided)
- Desktop: on the import-result surface (the success toast/dialog produced by those six call sites), add an "Undo import" action carrying snapshotName that invokes the EXISTING snapshot-restore path behind the EXISTING restore confirmation (must state that edits made since the import are also rolled back — reuse/extend the standard restore confirm copy; new keys to en + 4 full-parity locales if none fit).
- Mobile: mirror IF the mobile import result surface has an equivalent seam (check the mobile sync-settings import flow; if the seam differs materially, implement desktop only and report the mobile shape for a follow-up — do not force it).
- Same treatment for backup restore/merge results ONLY if they share the identical toast component (they report the same string) — otherwise scope to imports.
- Guardrails: restore is a destructive full-data operation — the confirmation weight must equal manual snapshot restore; no new setting; the action disappears with the result surface (no persistent affordance).

## TDD
Desktop: red test — import result renders the Undo action; activating it routes to the restore path with the exact snapshotName and shows the confirmation; declining does nothing.

## Scope
In: useSyncSettings.ts + its result-surface component(s) + tests, locale files (minimal keys), optionally mobile twin. Out: snapshot format/pruning, import-runner, the restore implementation itself.

## Gates
Desktop suite, i18n:check, typecheck (+ mobile gates if mirrored). Real exit codes.

## Release note
Yes — one line: imports can now be undone in one tap from the result message.

## Docs (mindwtr-web, separate commit, only if shipped both platforms)
Soften import/index.md step 4's manual rollback to mention the inline Undo (EN + 5 locales, parity gate).

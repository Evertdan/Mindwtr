# 009 — Close the desktop toast i18n leaks and the mobile phantom keys

Base: 0e4021faa · Finding: Q-02 [QUALITY-02] (improve audit 2026-08-13) · One commit (or two if the ratchet guard is separable).

## Context
Two mechanisms leak English past i18n:
1. Desktop bypasses t() with string literals in major-flow toasts: `apps/desktop/src/App.tsx:479,481` (sync-conflict outcome — "Kept local changes and updated sync file."), `components/GlobalSearch.tsx:340,341`, `components/views/ListView.tsx:111`, `components/views/projects/ProjectWorkspace.tsx:927`, `components/views/ProjectsView.tsx:422,425` (and sweep for more literals passed to showToast in apps/desktop/src).
2. Mobile calls `resolveText('projects.duplicated', 'Project duplicated')` (apps/mobile/app/(drawer)/projects-screen.tsx:472) and `projects.duplicateFailed` with keys ABSENT from en.ts — the fallback English renders in all 20 locales forever, invisible to the missing-key ratchet (which only sees keys reaching en.ts). Verified: grep for those keys in en.ts exits 1.
3. Parity gap: desktop shows NO success feedback after duplicating a project (ProjectsView.tsx:415-427) where mobile toasts.

## Fix (decided)
- Add the missing keys to en.ts (+ real translations in zh-Hans/zh-Hant/fa/sv per the full-parity floor; other locales opportunistic) — entering en.ts pulls them into the ratchet.
- Route every identified desktop literal through t() with new or existing keys (check for existing semantically-equal keys FIRST — e.g. sync-conflict strings may exist for mobile).
- Add the desktop duplicate-success toast using the same key mobile uses.
- Ratchet guard (this is what stops the class regrowing): a source-convention test (apps/desktop/src/test/, walker pattern) flagging string literals passed directly to showToast(...) in apps/desktop/src — allowlist template-built diagnostic strings if any are legitimately non-UI. Verify it FAILS with one literal restored.

## TDD
Red: the ratchet test fails on current HEAD (the literals exist); each migrated toast has a test asserting translator output where the surface has tests.

## Scope
In: the listed desktop files, mobile projects-screen (only if key rename needed — prefer adding the keys it already asks for), locale files (en + 4 full-parity), the new ratchet test. Out: reportError diagnostic labels (deliberately English), settings hooks already localized in the 08-09 legacy plan follow-ups.

## Gates
Core suite (i18n tests), desktop suite, `bun run i18n:check`, typecheck. Real exit codes.

## Release note
Yes — one line (shipped behavior on released code): sync-conflict and project-duplication feedback now appears in your language.

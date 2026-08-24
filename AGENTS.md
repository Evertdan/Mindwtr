<!-- bmad:context -->
<!-- Verified 2026-08-24 against 62b1ceef9. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## Mindwtr

GTD-style task manager (desktop, mobile, cloud sync, MCP server). Monorepo, Bun workspaces (`apps/*`, `packages/*`), no task-graph tool (no Turbo/Nx). Domain terms and preferred wording: `CONTEXT.md`. Architecture: `docs/ARCHITECTURE.md`. Decisions: `docs/adr/`.

## Policy

- Never push directly to `main`; PRs only, CLA signed, 1 approval — enforced via GitHub branch protection.
- Security vulnerabilities: never file as public issues, use GitHub Security Advisories (`SECURITY.md`).
- GitHub Actions pinned to full commit SHAs; a new dependency needing install scripts requires extra review.
- Only the latest release tag gets security patches; older tags are immutable, never patched in place.
- Never hand-edit `packages/core/src/i18n/starter-seed-strings.ts` — generated, see Running and verifying.
- This repo's `docs/` is for contributor-local material only; user-facing docs live in the external `mindwtr-web` site repo. `wiki/` holds only a redirect, never new content.

## Where things are

- Domain terminology, preferred vs. banned synonyms: `CONTEXT.md` — read before naming anything.
- Each workspace has its own AGENTS.md: `apps/cloud/AGENTS.md`, `apps/desktop/AGENTS.md`, `apps/mcp-server/AGENTS.md`, `apps/mobile/AGENTS.md`, `packages/core/AGENTS.md`

## Running and verifying

- `bun run verify` is a literal `&&` chain (no Turbo/Nx) — a failure partway through stops later checks instead of reporting all of them.
- `bun run verify` doesn't cover everything CI does: CI additionally runs performance budgets, per-package coverage thresholds (CLI flags in `.github/workflows/ci.yml` only), Expo Doctor, and store metadata checks.
- `apps/desktop/.github/workflows/test.yml` is stale (uses npm/package-lock.json in an otherwise all-Bun repo) — not authoritative, ignore it.
- Windows: MSVC v143 toolset required to link `whisper-rs`; VS 2026's default C++ toolchain currently fails (LNK1120).
- After changing any `starter.*` i18n string, run `bun run scripts/i18n-locale-parity.ts --fix` — `i18n:check` fails until regenerated.
- `bun run schema:check` (native-schema CI job) runs with no `bun install` — files it touches must stay zero-npm-dependency and use relative imports, never `@mindwtr/core/...`.

## Known pitfalls

- Never run a repo-wide automated translation pass without diffing for corrupted non-comment code — a 2026-08-23 "translate to Spanish" campaign (commits `237730a44`, `37f1e6907`, `e086fc87b`) mistranslated live code and content across every workspace and every i18n locale file, including `en.ts` (the canonical English source — ~468 keys got Spanish text; non-Spanish locales had stray Spanish words too). Fixed in `d8009dce1`..`62b1ceef9`.
- A date/calendar test failing with Spanish month names (e.g. "abril de 2026") on this kind of machine isn't translation corruption — some tests build their expected label with `Intl.DateTimeFormat(undefined, ...)`, which reads the host OS locale instead of the app's own locale. Confirmed in `calendar-scheduling.test.ts`, `PromptModal.test.tsx`, `CalendarView.test.tsx`; not fixed, left as pre-existing test fragility.

<!-- /bmad:context -->

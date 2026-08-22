# Plan 033: Docs batch — backup/attachment truth, broken quick starts, stale references

> Two repos. mindwtr-web edits: EVERY English page edit needs the same structural edit in all five locales (de/es/fr/zh-Hans/zh-Hant) with real translations; `bun run check` (in mindwtr-web) must exit 0 after each finding. Repo-local docs (Mindwtr/docs/**) have no locale gate. One commit per finding per repo.
> Drift check: `git -C /home/dd/code/mindwtr-web log --oneline -3` and compare cited lines before editing.

## Status
- **Priority**: P2 · **Effort**: M (many S × locale fan-out) · **Risk**: LOW · **Depends on**: none · **Category**: docs
- **Planned at**: Mindwtr `b0a96ccc9` / mindwtr-web `6b3513f`, 2026-08-22

## Findings (both repos; wv = mindwtr-web ×6 files, repo = Mindwtr single file)

1. **DOCS-01 (wv)** backup-restore.md "What Restore Does Not Do" (~:97-101) + use/attachments.md: state that file attachments live OUTSIDE the JSON backup (Attachment stores a relative path — types.ts:151-162; serializer carries metadata only) and must be copied separately; cross-link. This is the unrecoverable-data gap — write it plainly.
2. **DOCS-02 (wv)** power-users/local-api.md:42/:60/:74 + developers/developer-guide.md:330-335: the quick start exits immediately — `MINDWTR_API_TOKEN` is REQUIRED (scripts/mindwtr-api.ts:96-100) unless `--dangerously-disable-auth`; document both flags incl. `MINDWTR_API_CORS_ORIGIN` (:106); show the token in the quick-start command.
3. **DOCS-03 (wv)** developers/core-api.md:393: delete `restoreSection` (no such store action — store-types.ts:137-145; only internal restoreSectionFromProjectArchive exists).
4. **DOCS-04 (wv)** document project duplication: store-types.ts:132-133 duplicateProject ships on desktop (ProjectsSidebar.tsx:707, ProjectWorkspace.tsx:1663) and mobile (projects-screen.tsx:451); zero docs hits; use/reusable-lists.md teaches a manual workaround instead. Add a "Duplicate a project" pattern (read duplicateProject's implementation first to state exactly what resets) + a line each in use/desktop.md and use/mobile.md.
5. **DOCS-05 (repo)** correct mindwtr-csv-export.ts:11-14 and mindwtr-csv-import.ts:897-899 comments: re-import SKIPS matching ids (import-apply.ts:429-431), edits are deliberately not applied; the docs (import/mindwtr-csv.md:102) are right, the comments are wrong. This records the DIR-02 decision: round-trip apply stays declined; docs stance stands.
6. **DOCS-06 (wv)** developers/developer-guide.md:147/:170: `bun build` → `bun run build` (reserved subcommand; error reproduced). Exact-command parity: all six copies in lockstep.
7. **DOCS-07 (wv)** developer-guide.md:405-408: add `MINDWTR_CLOUD_CORS_ORIGIN` (prod boot throws without it — server-config.ts:114-116) and `MINDWTR_CLOUD_AUTH_TOKENS`, or point at cloud-deployment.md (verified complete).
8. **DOCS-08 (wv)** troubleshooting.md:48 dead cross-ref → point at the page that actually lists per-OS storage paths (find it; if none exists, inline the paths).
9. **DOCS-09 (repo)** ARCHITECTURE.md:16: MCP server also has streamable-HTTP transport (http-server.ts:52-76) and a self-hosted-cloud backend (cloud-service.ts); link power-users/mcp.md.
10. **DOCS-10 (repo + wv)** document version floors: Bun per `.bun-version` (1.3.5), Node >=20 for mcp-server — one line in Mindwtr/docs/CONTRIBUTING.md (repo) and developer-guide.md:45 (wv).

## Verification
mindwtr-web: `bun run check` exit 0 after each wv finding and at the end. Mindwtr: none needed beyond reading. No release notes (docs commits).

## STOP
- A cited claim turns out true in current code (e.g. restoreSection was added since the audit) — re-verify each code citation before deleting/altering docs.

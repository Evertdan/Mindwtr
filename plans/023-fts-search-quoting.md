# Plan 023: Quote FTS5 tokens so context/tag searches work, and stop rebuilding the index on syntax errors

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none · **Category**: bug
- **Planned at**: `b0a96ccc9`, 2026-08-22
- Drift check: `git diff --stat b0a96ccc9..HEAD -- packages/core/src/sqlite-adapter.ts packages/core/src/sqlite-adapter.test.ts`

## Why
`packages/core/src/sqlite-adapter.ts:985` deliberately keeps `#`/`@` in tokens; `:998` emits `@home*`, which is invalid FTS5 syntax (empirically verified: `"plumber*"` fine, `"@home*"`/`"#tag*"` → `fts5: syntax error`). The catch at `:1021-1024` swallows the error and calls `ensureFtsPopulated(true)` — a FULL delete-and-reinsert of tasks_fts + projects_fts (`:847-862`) — then retries and returns empty (`:1027`). Net effect on mobile + MCP local mode: every search containing a context or tag returns zero results AND triggers the adapter's most expensive operation once per debounced keystroke. Mobile's own fallback (`apps/mobile/lib/storage-adapter.ts:1461`) is unreachable because the adapter never throws.

## Steps
1. Red test (TEST-07a): in `sqlite-adapter.test.ts` near the existing searchAll cases (`:1057-1173`, all plain alphanumeric today): seed a task with `@home` in its contexts/text; `searchAll('@home')` must return it (fails today with empty results). Add a `#tag` case.
2. Fix: wrap each token as `"${token.replace(/"/g, '""')}"*` so FTS5 treats it as a quoted literal prefix. Keep the cleaning regex as-is (it defines what a token is).
3. Rebuild policy: in the query catch, stop calling `ensureFtsPopulated(true)` for what is now impossible-by-construction syntax errors; keep the rebuild only for corruption-class errors (match on the SQLite error text — inspect what better-sqlite3 raises for a dropped/corrupt FTS table before choosing the discriminator; if reliable discrimination is not possible, rebuild at most once per process lifetime via a latch). Add a test asserting a second syntax-class failure does not trigger a second rebuild.
4. Verify: `bun run --filter @mindwtr/core test -- sqlite-adapter`; then the MCP local suite (`apps/mcp-server` tests) since it shares the adapter.

One commit: `fix(core): quote FTS5 search tokens so context and tag searches return results`; a second commit if the rebuild-latch is separable: `fix(core): stop rebuilding the FTS index on search syntax errors`.

## STOP
- FTS5 quoted-prefix semantics differ from expected for embedded `#`/`@` (verify with a quick probe first — the auditor verified the failure, not the fix).

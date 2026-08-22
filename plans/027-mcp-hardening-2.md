# Plan 027: MCP server — cloud-adapter parity, entry-point guard, shutdown, flags

> Drift check: `git diff --stat b0a96ccc9..HEAD -- apps/mcp-server/src`

## Status
- **Priority**: P1 · **Effort**: M · **Risk**: LOW · **Depends on**: none · **Category**: bug/security
- **Planned at**: `b0a96ccc9`, 2026-08-22
- Known repo gotchas: MCP dist/ emit trap (stale dist can shadow src — rebuild before manual verification); a published npm release is required for users to receive these fixes (note it in the report, do not publish).

## Findings (one commit each)

1. **BUG-13 cloud adapter ignores `view` and operator `search`** — `apps/mcp-server/src/cloud-service.ts:228-250` never reads `input.view` (local implements it, `queries.ts:275-293`; tools advertise it for both, `index.ts:231-233`); `matchesSearch` (`cloud-service.ts:106-117`) is literal substring while `index.ts:467` promises the operator language and local routes through core `filterTasksBySearch` (`queries.ts:271-273`). FIX: cloud holds full AppData in memory — apply core's eligibility pass for `view` and `filterTasksBySearch` for `search`, same calls local uses; then correct the stale adapter-contract comment at `service.ts:404-411` (describes a retired FTS design). Red tests via TEST-05 (below).
2. **TEST-05 conformance rows where the adapters diverge** — `service-conformance.test.ts:59-118` has zero rows for view/search/dates. Add rows: `{view:'available'}`, `{view:'deferred'}`, `{view:'blocked'}`, `{search:'status:next -meeting'}`, `{dueDateFrom,dueDateTo}` incl. one offset-bearing dueDate crossing a day boundary. Verify each new row FAILS on cloud before fix 1/3 lands (red), passes after. Ship in the same commit as finding 1 where they pin it; date rows land with finding 3.
3. **BUG-25 dateKey timezone divergence** — `cloud-service.ts:102-104` takes raw first-10-chars; local uses SQLite `date()` which normalizes to UTC (`queries.ts:241-248`); validation admits offsets (`input-validation.ts:21-22`). FIX: parse with Date.parse and emit the UTC day, prefix fallback for date-only strings.
4. **BUG-14 import starts a server** — `src/index.ts:892` `if (import.meta.main)` compiles under `bun build --target node --format esm` to `__require.main == __require.module` → `undefined == undefined` → TRUE on import (empirically verified on Node 22): importing any published export boots a stdio server, resumes stdin, and pins the process with a giant setInterval. FIX: split the CLI entry into `src/cli.ts` (bin) leaving `index.ts` side-effect-free — preferred over a cleverer guard; update package.json bin/main accordingly and the build config. Red test: a node script importing the built package exits by itself (fails today).
5. **BUG-15 shutdown + abort leaks** — `index.ts:821-840` `void service.close()` then `process.exit(0)` next line (close never runs; no WAL checkpoint; -wal/-shm linger, locked on Windows); write client has no close path (`core-adapter.ts:307,448`); `http-server.ts:101-127` `readRequestBody` never settles on client abort (handler frame stranded); `res.on('close', cleanup)` registered after the awaited read (`:270`). FIX: await close before exit; export a close for the core-adapter singletons; `req.on('close')` rejection inside readRequestBody; register res close-cleanup before the body read guarded on `res.closed`.
6. **SEC-11 parseBooleanFlag fails open** — `flags.ts:32-40` unrecognized string → `true`; consumed by `--write` (`index.ts:134`) and `--cloud-allow-insecure-http` (`:180-184`) and explicitHttp (`http-server.ts:53`). `--write=disabled` enables writes. FIX: throw ValidationError on unrecognized values (bare-flag boolean path unchanged). Red test: `--write=nope` → startup error naming the flag.

## Verification
`cd apps/mcp-server && bun run test` (check exact script name) all green incl. conformance; typecheck; rebuild dist and run the import-side-effect probe against the BUILT output (BUG-14's failure mode only exists post-build).

## Release notes
MCP ships as an npm package with its own versioning — add unreleased.md lines for BUG-13 (agents get correct availability filtering) and SEC-11 (strict flag parsing; behavior change for typo'd flags) if the repo's release notes cover the MCP package (check how #922's fix was noted; match that precedent).

## STOP
- Splitting cli.ts breaks a documented invocation path (README/docs name `dist/index.js` directly) — reconcile docs in the same commit or STOP if ambiguous.

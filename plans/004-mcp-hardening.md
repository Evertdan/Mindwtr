# 004 — Throttle MCP HTTP auth failures, check Origin, and pin capture-retry idempotency

Base: 0e4021faa · Findings: R-06 [SECURITY-03], R-08 [CORRECTNESS-03 investigate] (improve audit 2026-08-13) · Two commits.

## Context
`apps/mcp-server/src/http-server.ts`: bare 401 on bad bearer (:145-152), no rate limiting, no Origin check; `--http-host` supports non-loopback binds; token floor 16 chars. The cloud server treats the same threat with per-IP + per-token-digest failure buckets (`apps/cloud/src/server.ts:963-983`, `server-rate-limit.ts`) — copy the shape, do NOT import across workspaces (the file header at :73-76 records that decision).
Separately (R-08): `runCoreWriteWithRetries` (`apps/mcp-server/src/service.ts:112-130`) retries whole callbacks up to 7× on retryable SQLite errors; the quickAdd callback (:431-499) can be multi-write (addProject then addTask) — idempotency on retry is presumed from the re-list/re-fetch behavior but unproven.

## Commit 1 (R-06)
- Fixed-window counter keyed on socket address AND presented-token digest; past the cap, 401s become 429 (or delayed 401 — follow the cloud server's exact response choice) until the window resets. Success path untouched.
- Reject `Origin` headers not matching the configured host on /mcp POSTs (403; MCP spec guidance for local HTTP transports).
- Red tests: N failed auths then throttled; correct token during throttle window (decide + pin the semantics — cloud's behavior is the model); foreign-Origin rejected; no-Origin (CLI clients) accepted.

## Commit 2 (R-08 → test-only, unless it fails)
- Test: quickAdd capture that mints a project AND a task, with the storage layer forced to throw a retryable SQLITE_BUSY once between the two writes → assert exactly one project and one task exist after the retry.
- If the test FAILS (duplicate project): STOP, report the failure shape — the fix (scoping retries or idempotency keys) is a design decision for the coordinator, not this plan.

## Scope
In: `apps/mcp-server/src/http-server.ts` + tests, `service.ts` tests (+ minimal seam for fault injection if needed). Out: stdio transport, tool schemas, token length policy.

## Gates
mcp-server tests (`cd apps/mcp-server && bun run test` — check the script name in its package.json first) + `bunx tsc --noEmit -p apps/mcp-server/tsconfig.json` (root typecheck skips this workspace). Real exit codes.

<!-- bmad:context -->
<!-- Verified 2026-08-24 against 62b1ceef9. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## apps/mcp-server

MCP server exposing Mindwtr's local SQLite store (or a self-hosted Cloud backend) over stdio/HTTP. Real entry: `src/cli.ts` — `src/index.ts`'s `startMcpServer()` must never auto-run on import.

## Policy

- Writes disabled by default — require `--write`. Mutating tools wrapped in `withReadonlyMcpErrorHandling`, reads in `withMcpErrorHandling`.
- HTTP transport requires an explicit bearer token ≥16 chars (20+ recommended) — throws at startup otherwise.
- Cloud mode IS writable via `--write` (person edits/restore excepted) — `server.json`'s "read-only" description is stale, ignore it; the code and README are correct.
- Task write-field surface is schema-derived from core's `TASK_SYNC_FIELD_SCHEMA` — a new synced field reaches MCP automatically unless excluded in `task-write-field-exclusions.ts`.

## Running and verifying

- `bun run mindwtr:mcp` must run from the repo root — it's a root script, not defined here.
- Never launch via `bun run mindwtr:mcp` from an MCP client config — the `bun run` wrapper prints banner lines that corrupt the JSON-RPC stream. Invoke `bun /path/to/src/cli.ts` directly.
- DB auto-discovery needs the real desktop app's data dir/`mindwtr.db` — no fixture DB ships here; override with `--db`/`MINDWTR_DB_PATH`.
- SQLite writer-lock failures retry the whole write with backoff, reloading data before reapplying — not a single-attempt write model.

<!-- /bmad:context -->

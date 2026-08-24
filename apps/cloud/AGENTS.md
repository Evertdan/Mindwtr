<!-- bmad:context -->
<!-- Verified 2026-08-23 against bd6be89fa. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## apps/cloud

Self-hosted sync server for Mindwtr — hand-rolled `Bun.serve`, no framework. Entry: `src/server.ts` (`startCloudServer()`).

## Policy

- `MINDWTR_CLOUD_CORS_ORIGIN` must never be `"*"` in production — throws at import time otherwise.
- Auth must be explicit: throws unless `MINDWTR_CLOUD_AUTH_TOKENS`/`MINDWTR_CLOUD_TOKEN` is set, or `MINDWTR_CLOUD_ALLOW_ANY_TOKEN=true` is opted into.
- Never log or return raw `fs`/`sqlite` error `.message` — embeds absolute server paths and namespace keys. Use `.code` only.
- Cross-package imports in files reachable by the no-install schema-parity CI job must be relative, never `@mindwtr/core/...`.
- `CLOUD_TASK_*_ALLOWED_PROP_KEYS` (and project/section equivalents) are generated from core's `TASK_SYNC_FIELD_SCHEMA` — never hand-edit.

## Running and verifying

- Requires the Bun runtime specifically — throws if `globalThis.Bun` is absent, `node` won't run it.
- Tests spawn real child processes and bind real ports to test cross-process file locking.
- CI coverage gate (70% lines/statements, 50% functions) exists only in `ci.yml`, not the local `test:coverage` script.

## Conventions that differ from defaults

- Every namespaced route must go through `withNamespace()` for auth/rate-limit/admission — a route once hand-copied the preamble and dropped the guard.
- All disk writes go through `durablyPublishFile` (temp file → fsync → atomic rename → fsync parent dir), never plain `writeFileSync`.
- Cross-process locking uses `bun:sqlite` `BEGIN IMMEDIATE` transactions sharded across 64 lock files, not a lockfile library.
- The calendar feed uses a separate bearer token from sync auth, in per-namespace sidecar files — rotation never touches sync auth.

<!-- /bmad:context -->

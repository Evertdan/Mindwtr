# Plan 019: Refuse cloud REST writes over an unreadable namespace; make feed revocation durable

> **Executor instructions**: Follow step by step; run every verification command. STOP conditions at the end. Update `plans/README.md` when done.
> **Drift check (run first)**: `git diff --stat b0a96ccc9..HEAD -- apps/cloud/src/` — on any drift, compare the excerpts below against live code; mismatch = STOP.

## Status
- **Priority**: P1 · **Effort**: S · **Risk**: LOW · **Depends on**: none · **Category**: bug/security
- **Planned at**: commit `b0a96ccc9`, 2026-08-22

## Why this matters
`apps/cloud/src/server-storage.ts:583-597`: `readData` catches every read/parse error and returns null; `loadAppDataUncached` then returns `createDefaultData()`. All four REST entity write routes (`apps/cloud/src/server.ts:436,469,492,1153`) load via that path, mutate, and `writeCloudData` — so one `POST /v1/tasks` against a namespace whose data file is corrupt or transiently unreadable (EIO/EACCES) atomically replaces the user's whole database with a near-empty document. Worse, `handleOrphanAttachmentGcRequest` (`apps/cloud/src/server-attachments.ts:222-231`) computes the referenced-key set from that empty document and deletes every attachment file older than the grace period. `PUT /v1/data` already handles this correctly via `loadExistingDataForMerge` (`server.ts:218-229`), which distinguishes "absent" (fine, empty) from "unreadable" (500) — that is the pattern to reuse.

Second finding, same file family: `revokeCalendarFeed` and `pruneOrphanedCalendarFeeds` (`apps/cloud/src/server-calendar-feed.ts:57-62,122`) use bare `existsSync`+`unlinkSync` — no `durablyRemoveFile`, so a crash can resurrect a revoked feed token (the URL is the entire credential), and an ENOENT race becomes a 500.

## Steps (one commit per finding)
1. **BUG-01** — red test first: in `apps/cloud/src/server.test.ts`, model on the existing PUT corruption test (~line 2054): write garbage bytes to the namespace data file, then `POST /v1/tasks` must return 500 and leave the file bytes untouched; same for the orphan-GC route (corrupt data file → 500, no attachment deleted). Then implement: give the storage layer a discriminated result (e.g. `loadAppDataForWrite` returning `{state:'ok'|'absent'|'unreadable'}`) and route the four entity write paths plus the GC through it; `absent` keeps returning default data (first write to a fresh namespace must still work — keep the existing test green). Commit: `fix(cloud): refuse REST writes and attachment GC when the namespace file exists but cannot be read`.
2. **SEC-15a** — red test: simulate unlink race/verify fsync usage by asserting both feed-removal sites call the shared `durablyRemoveFile` helper (find it with `/usr/bin/grep -rn durablyRemoveFile apps/cloud/src`); tolerate ENOENT (treat as already removed, not 500). Commit: `fix(cloud): remove calendar-feed files durably and tolerate already-removed feeds`.

## Verification
`bun run --filter @mindwtr/cloud test` (or `cd apps/cloud && bun run test` — check package.json scripts) → all pass incl. new tests; `bun run typecheck` → exit 0.

## Done criteria
- [ ] Corrupt-file POST + GC tests exist and fail when the fix is reverted
- [ ] Fresh-namespace first-write behavior unchanged (existing tests green)
- [ ] Both feed deletions route through durable removal
- [ ] No files outside apps/cloud/src touched

## STOP conditions
- `loadExistingDataForMerge` no longer exists or the write routes changed shape.
- The GC route turns out to have its own corruption guard already (re-read before fixing).
- A fix would require changing the `PUT /v1/data` merge path (out of scope).

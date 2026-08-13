# 002 — Revoke published calendar feeds when their token leaves the allowlist

Base: 0e4021faa · Finding: R-03 [SECURITY-01] (improve audit 2026-08-13) · One commit (+ one public-docs commit in mindwtr-web).

## Context
The published `.ics` feed route (`apps/cloud/src/server.ts:~1368-1392`) deliberately skips bearer auth (feed URLs carry their own token), but it also never checks the namespace against `allowedAuthTokens` — so revoking a sync token (the documented rotation flow, mindwtr-web docs/data-sync/cloud-deployment.md "Remove old token after migration window") leaves an unauthenticated URL serving that namespace's task titles/dates forever. `revokeCalendarFeed` (`server-calendar-feed.ts:57`) is only reachable via authenticated DELETE — i.e. only with the very token being revoked. Nothing sweeps orphaned `<key>.ics.json` sidecars.

## Fix (decided)
1. When an allowlist is configured (`allowedAuthTokens !== null`), the feed route must 404 (matching the unknown-token response shape) any feed whose namespace key is not in the allowed set. `tokenToKey(token)` is hex of the same SHA-256 `createAllowedAuthTokens` stores as raw bytes (`server-auth.ts:15` vs `:26`) — derive the allowed key set once (cache alongside allowedAuthTokens).
2. Prune orphaned feed sidecars at startup when an allowlist is configured (log count only — no paths, privacy ratchet).
3. "Any token" mode (`allowedAuthTokens === null`): every feed stays valid — unchanged, by design; pin with a test.

## TDD
Red test in `server.test.ts`: publish a feed → restart server with the token absent from the allowlist → GET feed asserts 404. Plus: any-token mode keeps serving; allowlisted feed keeps serving.

## Scope
In: `apps/cloud/src/server.ts`, `server-calendar-feed.ts`, `server-auth.ts` (derived key set), `server.test.ts`. Out: feed token format, ICS content, rate limiting.

## Public docs (separate commit, mindwtr-web)
Add one sentence to cloud-deployment.md Token Rotation (EN + 5 locales, parity gate `bun run check:docs-sources` must pass): removing a token from the allowlist also stops its calendar feed.

## Gates
`cd apps/cloud && bun test` real exit code; typecheck if exported types change.

## Escape hatches
If feed tokens turn out NOT to be derivable to namespace keys via tokenToKey (i.e. feed sidecar stores its own independent token), STOP and report the actual linkage before redesigning.

## Release note
Add one unreleased.md line in the same commit (shipped-surface change on released code): revoking a cloud token now also stops its published calendar feed.

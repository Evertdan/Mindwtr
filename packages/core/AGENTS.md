<!-- bmad:context -->
<!-- Verified 2026-08-23 against bd6be89fa. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## packages/core

Shared domain/store/sync library (`@mindwtr/core`), consumed as raw TypeScript source — no build step, `tsc --noEmit` only type-checks.

## Policy

- `src/index.ts`'s barrel export is a one-way ratchet — never remove a name. Metro (mobile) resolves every subpath through this file and ignores `package.json` exports; an unexported module is `undefined` on-device even though Node/vitest resolve it fine.
- Two export aliases are deliberate, don't "clean up": `toStableSyncJson` also as `toStableJson`; `fetchWithTimeout` resolves to `./http-utils`'s version over `./ai/utils`'s.
- Rust write-path parity: `local-api-action-parity.test.ts` guards that desktop's Tauri `local_api.rs` matches core's store logic exactly — changing task completion/archive/restore/recurrence logic here requires updating the Rust side too.
- CloudKit field parity is schema-gated: a new/changed `cloudKit` mapping needs an entry in `cloudkit-production-schema.json`; `--release-gate` hard-fails stable releases on any pending field.
- `entity-sync-schema.ts` and its per-entity schema files must stay zero-npm-dependency — a CI job checks them on a fresh checkout with no `bun install`.
- `sync-signatures.ts`'s field-exclusion list is deliberately hand-written, not derived from the JSON schema.

## Running and verifying

- `lint` uses a config outside this package: `eslint -c ../../eslint.node.config.mjs`.
- `test:perf` needs `MINDWTR_PERF_TEST=1` — running the file directly via `vitest` without it silently skips everything.
- Run from repo root via `bun run --filter @mindwtr/core test`, not `cd packages/core && npm test`.

<!-- /bmad:context -->

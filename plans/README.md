# Plans index

Written by the 2026-08-13 improve audit (Phase 2 of the review-improve loop), stamped against `0e4021faa`. Selection was non-interactive: every high-confidence actionable finding became a plan; speculative/deferred items are recorded below instead of planned.

## Execution order and status

| # | Plan | Findings | Effort | Status |
|---|------|----------|--------|--------|
| 001 | tauri-main-thread-commands | R-01, R-02 | S-M | DONE |
| 002 | calendar-feed-revocation | R-03 | S | DONE |
| 003 | local-api-hardening | R-04, R-05 | S-M | DONE |
| 004 | mcp-hardening | R-06, R-08 | S | DONE |
| 005 | import-sourcekey-identity | R-07 | S | DONE |
| 006 | derived-state-hot-path | A-02, A-04 | S | DONE |
| 007 | capture-import-chain | A-05 | S | DONE |
| 008 | source-hygiene-pair | A-03, A-07 | S | DONE |
| 009 | i18n-toast-leaks | Q-02 | S | DONE |
| 010 | locale-coverage-label | Q-01 | S | DONE |
| 011 | undo-import | Q-03 | S-M | DONE |
| 012 | csv-export | DIR-01 | M | DONE |
| 013 | automation-query-unification | DIR-02 | M | DONE |
| 014 | dx-batch | DX-01/02/04/05 | S | DONE |
| 015 | core-lint-ci | DX-03 | S | DONE |
| 016 | desktop-flat-eslint | DX-06 | S-M | DONE |
| 017 | adr-encryption-at-rest | DOCS-01 | S | DONE |
| 018 | mobile-store-action-settlement | ARCH-01 | M | DONE |

Dependencies: 015 before 016 (both touch lint wiring; 015 is upstream in CI). 001's commit 2 depends on its commit 1. 006 commit 2 depends on commit 1 only for merge cleanliness. Everything else independent.

## Deferred (recorded, deliberately not planned)

- **DEPS-01** desktop `file:` → `workspace:*` core dependency (138MB stale copy): defer until just after 1.2.0 stable — lockfile churn mid-RC-train is the hazard, not the change.
- **DEPS-02** Expo SDK 54→57 migration: own release train post-stable, staged 54→55→56→57 with per-hop device rounds and patch re-validation; the `@fugood/react-native-audio-pcm-stream` New-Architecture question decides whether realtime transcription needs a new transport first.
- **DEBT-03** attachment-backend 2×5 glue duplication: investigation verdict only — lifecycle + wire protocol already shared; diff WebDAV+Dropbox bodies before believing consolidation pays. Do not re-audit without that diff.
- **DIR-03** publish the CLI (bin in mindwtr-mcp) vs. relabel docs as contributor script: maintainer product decision; both halves cheap once decided.
- **DIR-04** web/PWA storage decision: spike (measure serialized 5k-task fixture vs localStorage quota) decides invest (IndexedDB adapter behind setStorageAdapter) vs demote (docs). Product call after the measurement.
- **DIR-05** Obsidian on mobile: real parity hole, deliberately not now (SAF two-way writer risk). Recorded to stop re-derivation.

## Considered and rejected

- zustand v5 / lucide 1.x bumps: ride-along only, no standalone value.
- Re-export shim deletion (attachment-utils, dropbox-sync pair): churn > value.
- Rust storage.rs/sync.rs "god module" split: production halves are ~3k lines; tests inflate the counts.
- native-schema job off macOS: needs xcrun swiftc, verified.
- testing-strategy.md command additions: 6-locale parity cost for info one click away.
- MCP/cloud auth helper sharing: deliberate workspace independence, recorded in file headers.
- Global Android user-CA trust: deliberately restores OS trust-store parity for arbitrary self-hosted URLs; scoping it requires a separate native HTTP stack, and the device owner or administrator must explicitly install the CA. The low-leverage L/HIGH-risk migration is rejected unless the product threat model changes.
- Mobile task-field renderer mega-interface: real coupling, but current performance gates are green and the refactor crosses keyboard, recurrence, attachment, audio, and progressive-disclosure behavior. Keep as Worth exploring until a measured regression or a narrower slice justifies it.

## Legacy plans (2026-08-09 files, reconciled 2026-08-13)

`2026-08-09-improve-product.md` and `2026-08-09-improve-architecture-performance.md` predate this run (base faea7edc3):
- Persistence-failure surface with retry — **DONE** (645f376d7, PersistenceFailureBanner both platforms).
- Watcher partial-failure lifecycle — **DONE** (watcher controller/generation commits + this loop's S6/S11/C2).
- Localize desktop Settings feedback — **LARGELY DONE** (4b8c53a4c, 43fc66552, 06eb36bc9, 24ac122f2); the ratchet-test remainder is superseded by plan 009.
- Mobile onboarding busy-guard — **LIKELY DONE** (8aad219ff); verify before re-planning.
- SQLite warm-open cost, TS/Rust golden merge fixtures, exact transfer-operation IDs, mobile Data-row a11y — **STILL OPEN**, carried as future candidates (not selected this run; the first two are M-L with high care requirements, the latter two are UX polish batches).

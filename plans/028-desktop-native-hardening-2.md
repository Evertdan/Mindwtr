# Plan 028: Desktop native hardening — Obsidian writes/scope, widget command, config errors, logs, ratchets

> Drift check: `git diff --stat b0a96ccc9..HEAD -- apps/desktop/src-tauri/src apps/desktop/src/lib/app-log.ts apps/desktop/src/lib/portable-migration.ts`

## Status
- **Priority**: P1 · **Effort**: M · **Risk**: LOW-MED · **Depends on**: none · **Category**: bug/security/tests
- **Planned at**: `b0a96ccc9`, 2026-08-22

## Findings (one commit each)

1. **BUG-07 Windows Obsidian delete-before-persist** — `apps/desktop/src-tauri/src/obsidian_writer.rs:191-196` removes the existing note BEFORE `temp_file.persist(path)`; failure of both persist and the `fs::copy` fallback (`:198-207`) destroys the note (temp file dropped). FIX: attempt persist first; only on failure rename the original aside, retry, restore on failure. Confirm the pinned `tempfile` crate's Windows persist-over-existing semantics before choosing the branch shape. Red test: inject persist failure → original content survives.
2. **BUG-08 + TEST-06 widget command blocks the main thread; ratchet blind** — `macos_widget.rs:41` plain `#[tauri::command]` doing create_dir_all/write/rename per edit burst with the full store serialized (`apps/desktop/src/lib/macos-widget-sync.ts:100-108`); the governance ratchet's `sources` roster (`sync.rs:5224-5241`) hand-lists 16 files and omits macos_widget.rs. FIX: `#[tauri::command(async)]`; make the ratchet enumerate `src/*.rs` containing `#[tauri::command` via read_dir so new files fail until rostered. Red: add macos_widget.rs to the scan first and watch the ratchet fail on the sync command (proves both halves).
3. **SEC-09 fs-scope widening + unbound Obsidian writers** — `config.rs:2713-2722` (and the `Value` path at `:2564`) grants recursive fs-scope for ANY renderer-supplied path for the app lifetime; `obsidian_writer.rs:402-537` four commands join caller-supplied `vault_path` with only relative-half validation (`obsidian_paths.rs:72-85`); every sibling fs command validates its root (`set_sync_path`, `sync.rs:2789` model). FIX: bind the scope grant and the four writers to the vault path persisted in `obsidian_config` (server-side equality check), canonicalize the joined path and re-assert the vault prefix. Red tests: command with a non-config vault path → error; traversal via canonicalization → error.
4. **BUG-21 keyring migration swallows the config rewrite failure** — `config.rs:1983,2058,2096` `let _ = write_config_files(...)` after moving secrets to the keyring: on failure the plaintext copy persists silently and is re-read. FIX: propagate the error (or at minimum log::warn + emit_keyring_fallback_warning — prefer propagate; every sibling credential write returns its error). Note in the commit body that users who hit this path should rotate (no user-facing note — cannot detect it happened).
5. **BUG-22 log fallback truncates; clear leaves rotation** — `apps/desktop/src/lib/app-log.ts:66-70` failed append falls back to a TRUNCATING write; `logging.rs:66-75` clear_log_file removes only mindwtr.log, leaving mindwtr.log.1 (5MB). FIX: drop the truncating fallback (return null); remove the rotated file in clear_log_file. Red tests: app-log's first test file (TEST-13a) asserting the fallback never shrinks the file; Rust test for clear removing both.
6. **TEST-12 retry classifier + wrapper coverage** — `storage.rs:693-699` `is_retryable_storage_error` substring allowlist untested, gating 3 retry loops behind all four local-API write routes. FIX: unit-test it against real rusqlite SQLITE_BUSY/LOCKED message texts; if cheap, extract the retry loop's connection dependency for a locked-database test — otherwise classifier tests only (report the seam as follow-up).
7. **TEST-13 remainder** — first tests for `portable-migration.ts` (mid-loop updateTask rejection leaves already-moved attachments resolvable — pins the undocumented #1038 filename-fallback coupling with `platform.rs:98-116`) and Rust table tests for `linux_calendar.rs` `escape_ics_text` (backslash/CRLF/semicolon/comma order) and `calendar_query` (non-RFC3339, inverted range). Pure test additions, one commit.

## Verification
`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` full; `cd apps/desktop && bun run test` for app-log/portable-migration; governance suite (`bun run test:governance`) untouched by Rust-side ratchet (that ratchet lives in cargo tests — confirm) — run both.

## Release notes
Items 1 and 5 change shipped behavior → unreleased.md lines in those commits (Obsidian note safety on Windows; "Clear log" now clears rotated history). Others: internal.

## STOP
- Item 3: a legitimate flow grants scope for a NON-config vault path (e.g. vault picker preview) — check the renderer call sites for `expand_obsidian_vault_scope` first; if the picker needs pre-config access, gate on a validated `.obsidian` marker + directory check instead and report the deviation.

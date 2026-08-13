# 001 — Move blocking storage commands off the Tauri main thread and derive the governance roster

Base: 0e4021faa · Findings: R-01 [CORRECTNESS-01], R-02 [TESTS-01] (improve audit 2026-08-13) · Two commits, one per finding.

## Context
Plain (non-async) `#[tauri::command]` fns run on the Tauri main/event-loop thread — the repo's own governance test states this premise (`apps/desktop/src-tauri/src/sync.rs` test `blocking_io_commands_never_run_on_the_ui_thread`, ~:4090). Five storage commands with real disk I/O are still plain: `create_data_snapshot` (storage.rs:4663 — invoked at the START of EVERY sync run from `apps/desktop/src/lib/sync-service.ts:1795`), `restore_data_snapshot` (:4686), `list_data_snapshots` (:4671), `query_tasks` (:4710), `search_fts` (:4787 — interactive search via `storage-adapter.ts:463,466`). On rclone/WinFSP-backed data dirs (supported locations) the window freezes for seconds per sync cycle. This is the exact bug class the governance test was written for; it missed these because it checks a hardcoded 11-name list over ~110 plain commands.

## Commit 1 (R-01)
- Change the five commands to `#[tauri::command(async)]` (bodies unchanged — they are sync fns; the attribute moves them to the blocking pool).
- Losing implicit main-thread serialization means snapshot create/restore could interleave: add a module-level `Mutex` guarding `create_data_snapshot` + `restore_data_snapshot` (+ `list_data_snapshots` if it reads mid-write state) — mirror the `VAULT_WRITE_MUTEX` pattern in `obsidian_writer.rs`. `query_tasks`/`search_fts` are reads through SQLite (WAL) — no extra lock; verify they open their own connections.
- Tests: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` green. Add a test that snapshot create is serialized (two concurrent calls do not interleave) if the seam allows; otherwise document the mutex invariant at the definition.

## Commit 2 (R-02)
- Invert the governance test: parse the Rust sources for every plain `#[tauri::command]` (not `(async)`, not `async fn`), subtract an explicit `ALLOWED_MAIN_THREAD_COMMANDS` allowlist (pure in-memory/state accessors like `get_data_path_cmd`, `notify_ui_ready`, `set_tray_visible` — inspect each before allowlisting; one-line justification per entry), and fail on any remainder. Keep it in the same test module; reuse its source-walking helpers if present.
- Red proof: with commit 1 reverted, the new test must FAIL naming the five commands; with it applied, green.

## Scope
In: `apps/desktop/src-tauri/src/storage.rs`, `sync.rs` (test module only). Out: TypeScript callers (invoke signatures unchanged), any other command's behavior.

## Gates
`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` (real exit code); `cargo check` clean. No JS suite needed (no JS change).

## Escape hatches
If a command in the five turns out to hold `&AppHandle`-main-thread-only state (compile error after `(async)`), STOP and report — that command needs `run_on_main_thread` splitting instead, which is a different change.

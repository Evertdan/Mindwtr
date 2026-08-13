# 014 — DX batch: pinned tauri CLI, CI concurrency, verify coverage, editorconfig

Base: 0e4021faa · Findings: DX-01, DX-02, DX-04, DX-05 (improve audit 2026-08-13) · Four commits, one per finding.

## DX-01 — desktop scripts use the pinned CLI
apps/desktop/package.json:18,20: `cargo tauri dev`/`build` (global cargo-tauri, 2.9.5 on this machine) vs CI/releases using pinned @tauri-apps/cli 2.11.3 via `bunx tauri` (ci.yml:256, release-*.yml). Change both scripts to `bunx tauri dev` / `bunx tauri build`. Verify `bun desktop:dev --help`-equivalent resolves (do NOT launch the app; `bunx tauri --version` from apps/desktop suffices → expect 2.11.3).

## DX-02 — CI concurrency
ci.yml and native-platform-ci.yml lack a concurrency block (19/22 other workflows have one). Add `concurrency: { group: "${{ github.workflow }}-${{ github.ref }}", cancel-in-progress: ${{ github.event_name == 'pull_request' }} }` to both — pushes to main never cancelled. Validate with actionlint (exit code stated). Leave dependency-audit.yml alone.

## DX-04 — verify covers what CI enforces
package.json `verify` runs lint:node (core+cloud only) + typecheck that skips mcp-server, while CI separately lints desktop/mobile/mcp and typechecks mcp (ci.yml:398-399,:528-538); mobile's exhaustive-deps=error is exactly what verify misses. Fix: extend verify (or add lint:all) to include desktop, mobile, and mcp lint plus mcp typecheck. TIME the additions: if mobile `expo lint` exceeds ~60s, put desktop+mcp in verify and mobile in a `verify:full`, and say which in the commit. Update docs/CONTRIBUTING.md:131-140's description in the SAME commit. Run the new verify once to prove green (real exit code) — if any backlog violations surface in desktop/mcp, STOP and report counts instead of fixing them in this commit.

## DX-05 — .editorconfig
No .editorconfig; the convention lives in CONTRIBUTING prose (":183-186 desktop/core 4 spaces, mobile 2"). Add root .editorconfig: `root=true`; `[*] indent_style=space, indent_size=4, end_of_line=lf, insert_final_newline=true, charset=utf-8`; `[apps/mobile/**] indent_size=2`; `[*.{yml,yaml,json}] indent_size=2` (verify against actual repo YAML/JSON style first — sample 3 files each). NO Prettier. Verify by opening a sampled file per rule and confirming the config matches reality (editorconfig describes, not reformats).

## Scope
In: the named files only. Out: eslint configs (plan 015/016), CONTRIBUTING beyond the verify sentence.

## Gates per commit
Stated above; nothing else runs.

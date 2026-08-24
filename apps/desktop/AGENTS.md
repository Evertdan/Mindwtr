<!-- bmad:context -->
<!-- Verified 2026-08-24 against 62b1ceef9. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## apps/desktop

Tauri v2 (Rust + WebView), not Electron. Rust entry: `src-tauri/src/lib.rs::run()`. Renderer entry: `src/main.tsx`.

## Policy

- Never import `invoke` from `@tauri-apps/api/core` directly — use `invokeNative`/`invokeNativeOr` from `src/lib/tauri-invoke.ts`. Ratchet test fails CI on raw imports.
- Never hand-roll a modal overlay — go through `components/ui/Dialog.tsx`. Ratchet test allow-lists only that module.
- `src-tauri/icons/` are committed-as-final, nothing regenerates them — keep `icon.ico`'s 32×32 image first (Windows taskbar bug #937 if reordered).
- CSP is intentionally restrictive — don't loosen it to load untrusted remote content.

## Running and verifying

- Main window is built with `create: false`, revealed only after `notify_ui_ready` — portable mode pins the webview profile dir first; the `tauri.conf.json` window config alone doesn't launch the UI.
- Two test runners, different DOM shims: `bun run test` (vitest) vs `bun test` (Bun's runner) — don't assume they're interchangeable.
- Rust tests run from repo root: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, not inside `src-tauri/`.
- macOS release build needs `xcrun`/`swiftc` in PATH — panics on missing `swiftc` unless `MINDWTR_ALLOW_WIDGET_RELOAD_STUB=1`.
- Linux build needs `rust webkit2gtk-4.1 base-devel`.

<!-- /bmad:context -->

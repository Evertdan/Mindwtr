# 008 — Source hygiene: NUL byte in Layout.tsx, junk hunks in the mdast patch

Base: 0e4021faa · Findings: A-03 [DEBT-01], A-07 [DEBT-02] (improve audit 2026-08-13) · Two commits.

## Commit 1 (A-03)
`apps/desktop/src/components/Layout.tsx:564-565` contains a literal 0x00 byte as a `join()` separator (verified via od) — the only NUL in tracked source; `grep -r` treats the 1700-line file as binary and silently skips it. Replace both with the escape `'\0'` (identical runtime string). Verify: `file` reports the file as text; `/usr/bin/grep -c "join" <file>` returns a count instead of "binary file matches"; desktop typecheck green; the component's tests (if any reference these lines' behavior) green.
Optional in the same commit: extend an existing source-convention test (apps/desktop/src/test/) to assert no tracked source file contains a NUL byte — cheap ratchet, follow the dialog-overlay-pin.test.ts walker pattern.

## Commit 2 (A-07)
`patches/mdast-util-gfm-autolink-literal@2.0.1.patch:1-8`: two `diff --git` hunks creating empty `.bun-tag-*` scratch files (Bun patch-generation artifacts); only the third hunk is the real fix. Delete the two junk hunks. Verify: `bun install` (or `bun install --frozen-lockfile` if the lock hash embeds patch content — if the lockfile changes, include it) applies the patch cleanly; the patched file's real hunk still applies; core/desktop tests that exercise markdown autolinking stay green (find via grep for the package name in tests).

## Scope
In: the two files (+ lockfile only if patch-hash requires). Out: everything else.

## Gates
Desktop typecheck; `bun install` exit code; affected test files. Real exit codes.

## Escape hatch
If stripping the patch hunks changes bun.lock's patch hash and that cascades beyond the lockfile entry, STOP and report before committing lockfile churn.

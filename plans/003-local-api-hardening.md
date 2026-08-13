# 003 — Bound local-API connections and test its HTTP parser

Base: 0e4021faa · Findings: R-04 [SECURITY-02], R-05 [TESTS-02] (improve audit 2026-08-13) · Two commits.

## Context
`apps/desktop/src-tauri/src/local_api.rs` (opt-in localhost server, default off, 127.0.0.1:3456): the accept loop spawns an unbounded `thread::spawn` per connection (:246-254) BEFORE auth; `set_read_timeout(5s)` (:392) bounds each read() syscall, not the request — a slow-drip peer (any local process or a browser tab issuing fetch to localhost) pins threads indefinitely. The hand-rolled HTTP parser (`read_request` :401, `find_header_end` :480, `parse_request_target` :484, `http_response` :505) has zero tests; the header/body byte caps (:413,:419,:457) have never been asserted.

## Commit 1 (R-04)
- Cap concurrent handler threads (AtomicUsize counter checked at accept; past N=32 respond 503 with the existing error-shape helper and close). Decrement in a drop guard so panics can't leak permits.
- Absolute per-request deadline: record `Instant` at handle_connection entry; both read loops (header + body) check elapsed against ~10s and return the existing 400/413-style error on exceedance.
- Red tests: a slow-drip connection gets terminated by the deadline; the 33rd concurrent connection gets 503 (loopback sockets in-test).

## Commit 2 (R-05)
- Generalize `read_request` to `&mut impl Read` (mechanical) or drive real loopback sockets; table-driven tests: oversized headers (cap trips), oversized declared Content-Length, body split across reads, missing request line, non-UTF-8 header bytes, slow-drip hits deadline (reuses commit 1).

## Scope
In: `apps/desktop/src-tauri/src/local_api.rs` only. Out: routing/validation semantics (already tested), auth logic, port/bind config, TS callers.

## Gates
`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` real exit code.

## Escape hatches
If capping requires an async runtime change (it should not — plain counter suffices), STOP and report. Keep 503/deadline constants module-level consts with a one-line rationale.

## Release note
One line (feature shipped in stable; hardening is user-visible only under abuse): none needed — hardening with no behavior change for legitimate clients. Skip.

# 013 — One query language and a real "what's actionable" for the automation surfaces

Base: 0e4021faa · Finding: DIR-02 (improve audit 2026-08-13) · Three commits (a, b, c below).

## Context
Three search implementations diverge: core `searchAll` (packages/core/src/search.ts:299) implements the documented operator language (status:/context:/tag:/due:<=7d/negation/quotes — documented in en.ts search.helpOperators and mindwtr-web docs/power-users/local-api.md:81,:225-240); the Rust local API does lowercased substring matching (local_api.rs:864-869) so documented operator queries silently return wrong/empty sets; MCP does FTS5+LIKE (apps/mcp-server/src/queries.ts:203-270). And no automation surface can express GTD availability although core has the predicates (task-utils.ts:403 deferral, :475-514 and :1027-1063 sequential blocking) — MCP list_tasks filters only status/project/date/search/isFocusedToday (index.ts:462-473), so agent answers to "what should I do now" include deferred and blocked tasks.

## Commits (decided)
(a) MCP `list_tasks.search` routes through core `searchAll` (core-adapter embeds core — call-site change). Mind the 200-slice-BEFORE-pagination gotcha (searchAll slices 200 before pagination — memory): decide and pin the pagination interaction explicitly in tests. Parity fixture test: MCP and `scripts/mindwtr-cli.ts` return the same task set for the same operator query.
(b) MCP `list_tasks` gains a `view` filter: 'available' | 'deferred' | 'blocked', implemented by calling the EXISTING core predicates (import from core; never re-derive). Tests: a deferred task and a sequentially-blocked task are excluded from 'available' and appear in their views; tool schema description documents the semantics.
(c) Rust local API: reject operator-shaped queries (a conservative regex on `key:`-shaped or quoted-phrase tokens) with 400 + an error body naming plain-text-only, OR (smaller) fix mindwtr-web local-api.md to state the HTTP query param is plain text. DECISION: do BOTH halves of honesty — 400 on operator-shaped input is a behavior change to a shipped endpoint; prefer the docs fix NOW (6 locales, parity gate) and add the 400 only if trivial in local_api.rs with a test. Rust local_api is an accepted reduced implementation — do NOT port the operator parser.

## Scope
In: apps/mcp-server (queries/index/service + tests), packages/core read-only usage, scripts/mindwtr-cli.ts read-only reference, mindwtr-web local-api.md ×6. Out: core searchAll semantics, desktop/mobile search UIs, Rust parser work beyond the optional 400.

## Gates
mcp-server tests + tsc; core suite untouched-green; docs parity gate for (c). Real exit codes.

## Release note
Yes, for (a)+(b): MCP clients can now use the documented search operators and ask for genuinely available tasks.

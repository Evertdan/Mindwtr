# 012 — Write the Mindwtr CSV format (export), completing the documented round trip

Base: 0e4021faa · Finding: DIR-01 (improve audit 2026-08-13) · 2-3 commits (core writer; app wiring; docs in mindwtr-web).

## Context
The Mindwtr CSV importer (packages/core/src/mindwtr-csv-import.ts, KNOWN_COLUMNS :139-142 incl ID) shipped in #1011 with docs (mindwtr-web docs/import/mindwtr-csv.md:92,:125) describing an ID-stable re-import round trip — but nothing writes CSV; the only export is JSON backup. Grounded product gap: bulk spreadsheet editing and migration-out both require hand-authoring the file the app can already parse.

## Design (decided)
- Core `serializeMindwtrCsv(data: AppData, options)` in a NEW module `packages/core/src/mindwtr-csv-export.ts`, column set driven by the SAME KNOWN_COLUMNS/parse metadata the importer consumes (extract the shared column table to a module both import if needed — the two must be structurally unable to drift). Always writes the ID column. Excludes tombstones (deletedAt/purgedAt) — export is live data, matching JSON backup's user expectation? NO — check what backup-transfer does and match ITS live/tombstone stance; state the decision inline.
- One CSV file (flat, project/section/area as columns per the documented format). ZIP-of-CSVs NOT in scope (importer accepts both; single file is the simpler write; record as future).
- Escaping/format: reuse the importer's dialect (delimiter, quoting, date formats) — round-trip fidelity is the acceptance bar.
- Apps: an "Export CSV" action in the Backup fold next to Export Backup on BOTH platforms, reusing the existing file-save plumbing (desktop data-transfer.ts save path; mobile share/save path used by JSON export). No new settings.
- Metro: new core module must be re-exported (report the index.ts/barrel line to the coordinator if the quick-add-style sibling barrel isn't appropriate).

## TDD
Core red test FIRST: `parseMindwtrCsv(serializeMindwtrCsv(fixture))` reproduces every field the importer claims to preserve (use/extend the importer's own fixture); ID stability: re-import of an export maps onto the same task ids (no duplicates). Edge fixtures: quotes/newlines/CJK in titles, checklists, date-only vs datetime, manual order.

## Scope
In: new core module (+ shared column table extraction), both apps' Backup fold + tests, locale keys (en + 4 full-parity). Out: ZIP export, per-project export, importer behavior changes.

## Gates
Core suite, desktop suite, mobile coverage + typecheck:mobile, i18n:check. Real exit codes.

## Release note + docs
unreleased.md line in the app-wiring commit. mindwtr-web: extend the mindwtr-csv page (EN + 5 locales, parity gate) to document export — separate commit.

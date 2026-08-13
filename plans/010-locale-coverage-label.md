# 010 — Label partly-translated locales in the language pickers

Base: 0e4021faa · Finding: Q-01 [QUALITY-01] (improve audit 2026-08-13) · One commit.

## Context
`packages/core/src/i18n/i18n-locales.ts` descriptors carry `translatedKeyFloor` (COUNTS, not percentages — locale-add checklist memory); nl's floor 569 vs en's ~2316 keys ≈ 26% translated, several others ~62-65%. The pickers (`apps/desktop/src/components/views/settings/SettingsMainPage.tsx:269,279`; `apps/mobile/components/settings/general-settings-screen.tsx:373,407`) render only the native name — a Dutch user gets a three-quarters-English app with no signal why.

## Fix (decided; automatic-beats-manual: no new setting)
- Core: derive a coverage ratio per locale from its descriptor floor over the en key count (compute the en count at build/test time or from the loaded en dictionary — pick the cheaper accurate source; floors ratchet upward so this self-updates). Export one helper (e.g. `getLocaleCoverageTier(code): 'full' | 'partial'`) with a single threshold constant (~0.9) — justify the threshold inline; locales meeting `translatedKeyFloor: 'all'` semantics are 'full' by definition.
- Pickers: for 'partial' locales append a secondary label — localized string like "partly translated" (new i18n key in en + zh-Hans/zh-Hant/fa/sv; shown in the CURRENT UI language). Both platforms, same helper.
- No per-locale hand data; no new setting; nothing synced.

## TDD
Core: helper returns 'partial' for nl-like floors, 'full' for full-parity locales; picker tests (where they exist) assert the secondary label renders for a partial locale and not for en.

## Scope
In: i18n-locales.ts (helper only — do NOT touch floors), the two picker components + tests, locale files for the new key. Out: locale loading, floor values, release-notes "20 languages" phrasing (leave).

## Gates
Core suite, desktop suite, mobile focused picker test + typecheck:mobile, i18n:check. Real exit codes.

## Release note
Yes — one line: the language picker now says when a language is only partly translated.

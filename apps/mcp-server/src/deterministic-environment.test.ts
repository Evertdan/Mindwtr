import { describe, expect, test } from 'bun:test';

/**
 * DW-113 / DW-115 — guard: the test process must run in a pinned timezone and
 * locale.
 *
 * Three desktop tests once passed in CI and failed on a maintainer's machine
 * for no reason other than their OS locale being Spanish. Date formatting in
 * this codebase deliberately prefers the SYSTEM locale over the app language
 * when no `dateFormat` setting is present (`resolveDateLocaleTag`,
 * packages/core/src/date.ts), so anything asserting a formatted date silently
 * depends on the host.
 *
 * The pin lives in the `test` script (`TZ=... LANG=... LC_ALL=... bun test`)
 * and NOT in a setup file, because it has to: `TZ` can be changed at runtime,
 * but ICU fixes the default locale when the process starts, so setting `LANG`
 * from inside a test does nothing.
 *
 * DW-115 added this file to the two `bun test` packages. They already carried
 * the script prefix, but had no guard, so dropping it here would have failed
 * silently while the three vitest packages failed loudly.
 *
 * MEASURED, so nobody reads more protection into this file than it gives:
 * under Bun only the `TZ` half of the pin does anything. Bun resolves the
 * default Intl locale to `en-US` regardless of `LANG`/`LC_ALL` (verified: the
 * same env that makes Node report `ja-JP` still gives `en-US` under Bun), so
 * the locale assertions below hold here even with the prefix removed. The
 * `TZ` assertion is the one that actually fails without it. The `LANG` half is
 * kept anyway — it costs nothing, keeps the five packages uniform, and stops
 * being a no-op the day Bun starts honouring it.
 */
describe('DW-113 deterministic test environment', () => {
    test('runs in UTC', () => {
        expect(new Date('2026-01-01T00:00:00Z').getHours()).toBe(0);
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
    });

    test('resolves the default locale to en-US', () => {
        expect(Intl.DateTimeFormat().resolvedOptions().locale).toBe('en-US');
    });

    test('formats a date the way locale-sensitive assertions expect', () => {
        const formatted = new Intl.DateTimeFormat(undefined, {
            month: 'short', day: 'numeric', year: 'numeric',
        }).format(new Date(Date.UTC(2026, 3, 4)));
        expect(formatted).toBe('Apr 4, 2026');
    });
});

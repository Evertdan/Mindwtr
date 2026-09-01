import { describe, expect, it } from 'vitest';

/**
 * DW-113 — guard: the test process must run in a pinned timezone and locale.
 *
 * Three desktop tests once passed in CI and failed on a maintainer's machine
 * for no reason other than their OS locale being Spanish. Date formatting in
 * this app deliberately prefers the SYSTEM locale over the app language when no
 * `dateFormat` setting is present (`resolveDateLocaleTag`, packages/core/src/
 * date.ts), so anything asserting a formatted date silently depends on the host.
 *
 * The pin lives in the `test` script (`TZ=... LANG=... LC_ALL=... vitest run`)
 * and NOT in a setup file, because it has to: `TZ` can be changed at runtime,
 * but ICU fixes the default locale when the process starts, so setting `LANG`
 * from inside a test does nothing. This guard fails loudly if the prefix is
 * ever dropped from the script.
 */
describe('DW-113 deterministic test environment', () => {
    it('runs in UTC', () => {
        expect(new Date('2026-01-01T00:00:00Z').getHours()).toBe(0);
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
    });

    it('resolves the default locale to en-US', () => {
        expect(Intl.DateTimeFormat().resolvedOptions().locale).toBe('en-US');
    });

    it('formats a date the way locale-sensitive assertions expect', () => {
        const formatted = new Intl.DateTimeFormat(undefined, {
            month: 'short', day: 'numeric', year: 'numeric',
        }).format(new Date(Date.UTC(2026, 3, 4)));
        expect(formatted).toBe('Apr 4, 2026');
    });
});

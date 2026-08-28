import { describe, expect, it } from 'vitest';

import {
    formatRangeLabel,
    isValidCustomPeriodRange,
    TDAH_CUSTOM_RANGE_MAX_SPAN_DAYS,
    TDAH_DEFAULT_PERIOD,
    TDAH_PERIOD_OPTIONS,
} from './tdah-period-range';

describe('tdah-period-range', () => {
    it('exposes the four period options in a stable order, defaulting to day', () => {
        expect(TDAH_PERIOD_OPTIONS.map((o) => o.value)).toEqual(['day', 'week', 'month', 'custom']);
        expect(TDAH_DEFAULT_PERIOD).toBe('day');
    });

    describe('formatRangeLabel', () => {
        it('renders a single date when from === to', () => {
            expect(formatRangeLabel({ from: '2026-08-20', to: '2026-08-20' }, 'en-US')).toBe('Aug 20, 2026');
        });

        it('renders a "from – to" span when the range covers more than one day', () => {
            expect(formatRangeLabel({ from: '2026-08-01', to: '2026-08-20' }, 'en-US')).toBe('Aug 1, 2026 – Aug 20, 2026');
        });

        it('never shifts the date across the UTC day boundary regardless of the runtime locale', () => {
            // A date string right at a boundary that historically breaks
            // `new Date(str)` + local-time formatting (off-by-one day).
            expect(formatRangeLabel({ from: '2026-01-01', to: '2026-01-01' }, 'en-US')).toBe('Jan 1, 2026');
            expect(formatRangeLabel({ from: '2026-12-31', to: '2026-12-31' }, 'en-US')).toBe('Dec 31, 2026');
        });

        it('falls back to the raw string for a malformed date instead of throwing', () => {
            expect(formatRangeLabel({ from: 'not-a-date', to: 'also-not-a-date' }, 'en-US')).toBe('not-a-date – also-not-a-date');
        });
    });

    describe('isValidCustomPeriodRange', () => {
        it('accepts from === to', () => {
            expect(isValidCustomPeriodRange('2026-08-20', '2026-08-20')).toBe(true);
        });

        it('accepts a span within the cap', () => {
            expect(isValidCustomPeriodRange('2026-01-01', '2026-06-01')).toBe(true);
        });

        it('rejects from > to', () => {
            expect(isValidCustomPeriodRange('2026-09-01', '2026-08-01')).toBe(false);
        });

        const isoDaysAfter = (from: string, days: number): string => {
            const date = new Date(`${from}T00:00:00Z`);
            date.setUTCDate(date.getUTCDate() + days);
            return date.toISOString().slice(0, 10);
        };

        it(`accepts a span of exactly ${TDAH_CUSTOM_RANGE_MAX_SPAN_DAYS} days`, () => {
            const from = '2026-01-01';
            expect(isValidCustomPeriodRange(from, isoDaysAfter(from, TDAH_CUSTOM_RANGE_MAX_SPAN_DAYS))).toBe(true);
        });

        it(`rejects a span of ${TDAH_CUSTOM_RANGE_MAX_SPAN_DAYS + 1} days`, () => {
            const from = '2026-01-01';
            expect(isValidCustomPeriodRange(from, isoDaysAfter(from, TDAH_CUSTOM_RANGE_MAX_SPAN_DAYS + 1))).toBe(false);
        });

        it('rejects malformed or empty dates', () => {
            expect(isValidCustomPeriodRange('', '2026-08-20')).toBe(false);
            expect(isValidCustomPeriodRange('2026-08-20', 'not-a-date')).toBe(false);
        });
    });
});

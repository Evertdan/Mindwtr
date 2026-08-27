import { describe, expect, it } from 'vitest';

import { computeActivityLayout, parseHHMMToMinutes } from './tdah-timeline-layout';
import { TDAH_TIMELINE_MIN_ROW_HEIGHT, TDAH_TIMELINE_PIXELS_PER_MINUTE } from './tdah-today.styles';

describe('parseHHMMToMinutes', () => {
    it('parses a valid HH:mm string', () => {
        expect(parseHHMMToMinutes('00:00')).toBe(0);
        expect(parseHHMMToMinutes('09:30')).toBe(9 * 60 + 30);
        expect(parseHHMMToMinutes('23:59')).toBe(23 * 60 + 59);
    });

    it('rejects malformed input', () => {
        expect(parseHHMMToMinutes('24:00')).toBeNull();
        expect(parseHHMMToMinutes('9:30')).toBeNull();
        expect(parseHHMMToMinutes('not-a-time')).toBeNull();
        expect(parseHHMMToMinutes('')).toBeNull();
    });
});

describe('computeActivityLayout', () => {
    it('positions an Activity by its startTime in minutes', () => {
        const layout = computeActivityLayout('01:00', 30);
        expect(layout?.top).toBe(60 * TDAH_TIMELINE_PIXELS_PER_MINUTE);
    });

    it('scales height by durationMinutes when above the accessibility minimum', () => {
        const layout = computeActivityLayout('09:00', 60);
        expect(layout?.height).toBe(60 * TDAH_TIMELINE_PIXELS_PER_MINUTE);
    });

    it('floors height at the 48dp accessibility minimum for a zero/short/null duration', () => {
        expect(computeActivityLayout('09:00', 0)?.height).toBe(TDAH_TIMELINE_MIN_ROW_HEIGHT);
        expect(computeActivityLayout('09:00', 5)?.height).toBe(TDAH_TIMELINE_MIN_ROW_HEIGHT);
        expect(computeActivityLayout('09:00', null)?.height).toBe(TDAH_TIMELINE_MIN_ROW_HEIGHT);
    });

    it('returns null (never a silent top:0) for an unparseable non-null startTime, same as a null startTime', () => {
        expect(computeActivityLayout('garbage', 10)).toBeNull();
        expect(computeActivityLayout('25:99', 10)).toBeNull();
    });

    it('returns null for a null startTime — a "sin hora" Activity never gets a timeline position', () => {
        expect(computeActivityLayout(null, 30)).toBeNull();
        expect(computeActivityLayout(null, null)).toBeNull();
    });
});

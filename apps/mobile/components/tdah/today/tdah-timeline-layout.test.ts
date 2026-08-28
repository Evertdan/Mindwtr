import { describe, expect, it } from 'vitest';

import {
    computeActivityLaneOffsets,
    computeActivityLayout,
    formatActivityTimeRange,
    parseHHMMToMinutes,
    TDAH_TIMELINE_LANE_OFFSET_PX,
} from './tdah-timeline-layout';
import {
    TDAH_TIMELINE_DAY_END_HOUR,
    TDAH_TIMELINE_DAY_START_HOUR,
    TDAH_TIMELINE_MIN_ROW_HEIGHT,
    TDAH_TIMELINE_PIXELS_PER_MINUTE,
} from './tdah-today.styles';
import type { TdahActivity } from './tdah-today-types';

const TIMELINE_HEIGHT_PX = (
    TDAH_TIMELINE_DAY_END_HOUR - TDAH_TIMELINE_DAY_START_HOUR
) * 60 * TDAH_TIMELINE_PIXELS_PER_MINUTE;

const activityAt = (id: number, startTime: string | null, durationMinutes: number | null): TdahActivity => ({
    id,
    dayPlanDate: '2026-08-26',
    blockId: null,
    title: `Activity ${id}`,
    startTime,
    durationMinutes,
    origin: 'routine',
    state: 'pending',
    startedAt: null,
    completedAt: null,
});

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

    it('clamps an Activity crossing 24:00 to the timeline bottom when the clamp stays above the minimum', () => {
        // 23:00 + 120min would be 168px tall, but only 84px of timeline remain.
        const layout = computeActivityLayout('23:00', 120);
        expect(layout).not.toBeNull();
        expect(layout!.top + layout!.height).toBe(TIMELINE_HEIGHT_PX);
        expect(layout!.height).toBe(84);
    });

    it('floors a late short Activity at the minimum row height even when the timeline bottom is closer', () => {
        // 23:30 + 60min: only 42px remain, but the accessibility floor wins.
        const layout = computeActivityLayout('23:30', 60);
        expect(layout!.height).toBe(TDAH_TIMELINE_MIN_ROW_HEIGHT);
    });

    it('keeps a mid-day Activity untouched by the clamp', () => {
        const layout = computeActivityLayout('09:00', 60);
        expect(layout!.top + layout!.height).toBeLessThan(TIMELINE_HEIGHT_PX);
        expect(layout!.height).toBe(60 * TDAH_TIMELINE_PIXELS_PER_MINUTE);
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

describe('computeActivityLaneOffsets', () => {
    it('gives overlapping Activities different lanes so both stay visible and tappable', () => {
        const offsets = computeActivityLaneOffsets([
            activityAt(1, '09:00', 60),
            activityAt(2, '09:30', 60),
        ]);
        expect(offsets.get(1)).toBe(0);
        expect(offsets.get(2)).toBe(1);
    });

    it('separates two Activities with an identical startTime (the earlier one was invisible before)', () => {
        const offsets = computeActivityLaneOffsets([
            activityAt(1, '09:00', 30),
            activityAt(2, '09:00', 45),
        ]);
        expect(offsets.get(1)).toBe(0);
        expect(offsets.get(2)).toBe(1);
    });

    it('separates two equal-start zero-duration rows (minimum row height still makes them collide visually)', () => {
        const offsets = computeActivityLaneOffsets([
            activityAt(1, '09:00', 0),
            activityAt(2, '09:00', 0),
        ]);
        expect(offsets.get(1)).toBe(0);
        expect(offsets.get(2)).toBe(1);
    });

    it('reuses lane 0 for Activities that do not overlap', () => {
        const offsets = computeActivityLaneOffsets([
            activityAt(1, '08:00', 60),
            activityAt(2, '10:00', 30),
        ]);
        expect(offsets.get(1)).toBe(0);
        expect(offsets.get(2)).toBe(0);
    });

    it('reuses a lane freed by an occupant that has already ended', () => {
        const offsets = computeActivityLaneOffsets([
            activityAt(1, '09:00', 60),
            activityAt(2, '09:30', 30),
            // Starts exactly when activity 1 (lane 0) ends at 10:00 — the
            // rendered spans touch but never overlap, so lane 0 is free again.
            activityAt(3, '10:00', 30),
        ]);
        expect(offsets.get(3)).toBe(0);
        expect(offsets.get(2)).toBe(1);
    });

    it('assigns lanes by startTime regardless of input order', () => {
        const offsets = computeActivityLaneOffsets([
            activityAt(2, '09:30', 60),
            activityAt(1, '09:00', 60),
        ]);
        expect(offsets.get(1)).toBe(0);
        expect(offsets.get(2)).toBe(1);
    });

    it('gives no lane to "sin hora" Activities', () => {
        const offsets = computeActivityLaneOffsets([
            activityAt(1, null, null),
            activityAt(2, '09:00', 30),
        ]);
        expect(offsets.has(1)).toBe(false);
        expect(offsets.get(2)).toBe(0);
    });

    it('exposes a lane width wide enough to keep offset rows tappable', () => {
        expect(TDAH_TIMELINE_LANE_OFFSET_PX).toBeGreaterThan(0);
    });
});

// Story 4.2: the work band renders a real range ("9:30–14:00"), which no
// surface of T-01 formatted before this story.
describe('formatActivityTimeRange', () => {
    it('renders start and end as an en-dash range with unpadded hours', () => {
        expect(formatActivityTimeRange('09:30', 270)).toBe('9:30–14:00');
    });

    it('renders a full working-window band', () => {
        expect(formatActivityTimeRange('09:00', 540)).toBe('9:00–18:00');
    });

    it('renders a band created mid-afternoon at its real, non-retro-dated start', () => {
        expect(formatActivityTimeRange('15:20', 160)).toBe('15:20–18:00');
    });

    it('renders only the start when there is no duration to end at', () => {
        expect(formatActivityTimeRange('09:30', null)).toBe('9:30');
    });

    it('treats a zero duration the same as "no duration given" — never a "9:30–9:30" range', () => {
        expect(formatActivityTimeRange('09:30', 0)).toBe('9:30');
    });

    it('wraps an end past midnight onto a real wall clock instead of "25:30"', () => {
        expect(formatActivityTimeRange('23:00', 150)).toBe('23:00–1:30');
    });

    // Same "no position, no placeholder" contract computeActivityLayout uses
    // for the identical inputs: the caller drops the segment entirely.
    it('returns null for a "sin hora" Activity', () => {
        expect(formatActivityTimeRange(null, 60)).toBeNull();
    });

    it('returns null for an unparseable startTime rather than a wrong-but-plausible range', () => {
        expect(formatActivityTimeRange('25:00', 60)).toBeNull();
        expect(formatActivityTimeRange('9:30', 60)).toBeNull();
    });
});

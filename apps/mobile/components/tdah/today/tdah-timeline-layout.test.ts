import { describe, expect, it } from 'vitest';

import {
    computeActivityLaneOffsets,
    computeActivityLayout,
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

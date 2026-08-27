import {
    TDAH_TIMELINE_DAY_END_HOUR,
    TDAH_TIMELINE_DAY_START_HOUR,
    TDAH_TIMELINE_MIN_ROW_HEIGHT,
    TDAH_TIMELINE_PIXELS_PER_MINUTE,
} from './tdah-today.styles';
import type { TdahActivity } from './tdah-today-types';

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parses the server's "HH:mm" wall-clock strings — never a full date. */
export function parseHHMMToMinutes(value: string): number | null {
    const match = HHMM_PATTERN.exec(value);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

const TIMELINE_HEIGHT_PX = (
    TDAH_TIMELINE_DAY_END_HOUR - TDAH_TIMELINE_DAY_START_HOUR
) * 60 * TDAH_TIMELINE_PIXELS_PER_MINUTE;

export type TdahActivityLayout = {
    top: number;
    height: number;
};

/**
 * Positions one Activity on the vertical timeline. `durationMinutes === 0`
 * (or `null`, "no duration given") still gets the accessibility minimum row
 * height rather than collapsing to a sliver.
 *
 * An Activity whose end crosses 24:00 is clamped to the timeline's bottom
 * (`top + height` never passes the 24:00 channel), floored at the
 * accessibility minimum — without the clamp a late Block with a long
 * duration overflows the fixed-height timelineArea and covers the trailing
 * "sin hora" section.
 *
 * A `null` `startTime` — a manual Activity created without an explicit time
 * (doc 02's "sin hora" case) — gets no vertical position at all: it returns
 * `null` instead of defaulting to some arbitrary top offset, so the caller
 * knows to render it in the trailing "sin hora" section instead of on the
 * timeline (see `TdahTodayScreen.tsx`). The server always sends a validated
 * `HH:mm` or `null` today, but an unparseable *non-null* string (defensive
 * only) is routed to that same "no timeline position" result rather than
 * silently defaulting to `top: 0` — a wrong-but-plausible position would be
 * far more misleading than falling back to the "sin hora" section.
 */
export function computeActivityLayout(startTime: string | null, durationMinutes: number | null): TdahActivityLayout | null {
    if (startTime === null) return null;
    const startMinutes = parseHHMMToMinutes(startTime);
    if (startMinutes === null) return null;
    const top = Math.max(0, startMinutes - TDAH_TIMELINE_DAY_START_HOUR * 60) * TDAH_TIMELINE_PIXELS_PER_MINUTE;
    const durationPx = Math.max(0, durationMinutes ?? 0) * TDAH_TIMELINE_PIXELS_PER_MINUTE;
    const height = Math.max(TDAH_TIMELINE_MIN_ROW_HEIGHT, Math.min(durationPx, TIMELINE_HEIGHT_PX - top));
    return { top, height };
}

/** Horizontal inset applied per overlap lane — narrow lanes, no full column machinery. */
export const TDAH_TIMELINE_LANE_OFFSET_PX = 28;

// Lane assignment works on the *rendered* span, not the planned one: every
// row is at least MIN_ROW_HEIGHT tall (~34 minutes at PIXELS_PER_MINUTE), so
// two rows visually collide even when their planned durations don't overlap
// (including two equal-start zero-duration rows at the identical top).
const MIN_ROW_VISUAL_SPAN_MINUTES = TDAH_TIMELINE_MIN_ROW_HEIGHT / TDAH_TIMELINE_PIXELS_PER_MINUTE;

/**
 * Simple lane offsetting for overlapping timed Activities (the server admits
 * overlaps as non-blocking warnings): sort by start, then give each Activity
 * the first lane whose previous occupant no longer visually overlaps it, or
 * a fresh lane when none is free. Without this, two Activities sharing a
 * startTime render at the identical absolute top and the earlier one becomes
 * invisible and untappable. No-time Activities get no entry — they never
 * render on the timeline.
 */
export function computeActivityLaneOffsets(activities: TdahActivity[]): Map<number, number> {
    const laneEnds: number[] = [];
    const offsets = new Map<number, number>();
    const timed = activities
        .map((activity) => ({
            activity,
            startMinutes: activity.startTime === null ? null : parseHHMMToMinutes(activity.startTime),
        }))
        .filter((entry): entry is { activity: TdahActivity; startMinutes: number } => entry.startMinutes !== null)
        .sort((a, b) => a.startMinutes - b.startMinutes || a.activity.id - b.activity.id);
    for (const { activity, startMinutes } of timed) {
        const endMinutes = startMinutes + Math.max(
            activity.durationMinutes ?? 0,
            MIN_ROW_VISUAL_SPAN_MINUTES,
        );
        let lane = laneEnds.findIndex((laneEnd) => laneEnd <= startMinutes);
        if (lane === -1) {
            lane = laneEnds.length;
            laneEnds.push(endMinutes);
        } else {
            laneEnds[lane] = endMinutes;
        }
        offsets.set(activity.id, lane);
    }
    return offsets;
}

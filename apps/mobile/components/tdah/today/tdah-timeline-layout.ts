import {
    TDAH_TIMELINE_DAY_START_HOUR,
    TDAH_TIMELINE_MIN_ROW_HEIGHT,
    TDAH_TIMELINE_PIXELS_PER_MINUTE,
} from './tdah-today.styles';

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Parses the server's "HH:mm" wall-clock strings — never a full date. */
export function parseHHMMToMinutes(value: string): number | null {
    const match = HHMM_PATTERN.exec(value);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

export type TdahActivityLayout = {
    top: number;
    height: number;
};

/**
 * Positions one Activity on the vertical timeline. `durationMinutes === 0`
 * (or `null`, "no duration given") still gets the accessibility minimum row
 * height rather than collapsing to a sliver.
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
    const height = Math.max(TDAH_TIMELINE_MIN_ROW_HEIGHT, durationPx);
    return { top, height };
}

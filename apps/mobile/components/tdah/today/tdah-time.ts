/**
 * Shared AD-6 wall-clock helpers: every "now" reading on the TDAH screens is
 * resolved in the profile's own configured IANA zone via
 * `Intl.DateTimeFormat`, never the device's local `Date` methods (which can
 * disagree with the profile zone). Same technique as the cloud side's
 * `formatDateInTimeZone` (apps/cloud/src/tdah/storage.ts) — clients never
 * import server code across the wire boundary (ADR 0026), so the small
 * formatter lives here instead.
 */

const WALL_CLOCK_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
};

const partsToWallClock = (parts: Intl.DateTimeFormatPart[]): string => {
    const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
    const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
    return `${hour}:${minute}`;
};

/** Minutes since midnight of `date`'s wall-clock time in `timeZone`. */
export function getMinutesSinceMidnightInTimeZone(date: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
    return hour * 60 + minute;
}

/** `date`'s wall-clock time in `timeZone` as a plain "HH:mm" string. */
export function formatWallClockInTimeZone(date: Date, timeZone: string): string {
    return partsToWallClock(
        new Intl.DateTimeFormat('en-US', { timeZone, ...WALL_CLOCK_FORMAT_OPTIONS }).formatToParts(date),
    );
}

/** `date`'s calendar day in `timeZone` as a "yyyy-MM-dd" key, the same shape `GET /v1/tdah/day`'s `date` uses. */
export function formatDayKeyInTimeZone(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
    const month = parts.find((part) => part.type === 'month')?.value ?? '01';
    const day = parts.find((part) => part.type === 'day')?.value ?? '01';
    return `${year}-${month}-${day}`;
}

/**
 * Formats an instant string (e.g. `startedAt`'s ISO timestamp) as "HH:mm" in
 * `timeZone`, falling back to the raw string when it can't be parsed or the
 * zone is invalid — same fallback semantics as safeFormatDate's third
 * argument, so a malformed value renders verbatim instead of crashing.
 */
export function formatIsoWallClockInTimeZone(value: string, timeZone: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    try {
        return new Intl.DateTimeFormat('en-US', { timeZone, ...WALL_CLOCK_FORMAT_OPTIONS }).format(parsed);
    } catch {
        return value;
    }
}

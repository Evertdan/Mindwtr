/**
 * Story 4.3 — the ONE place in the whole repository where "is this instant
 * silenced?" is decided (FR-12, AD-8).
 *
 * Everything here is pure: dates and times in, a verdict out. No sqlite, no
 * `fs`, no `fetch`, no `new Date()` of its own — every caller hands in the
 * instant/zone it already resolved. That purity is not an aesthetic: it is
 * what makes the edge matrix (half-open ranges, overlapping windows,
 * transitive contiguous blocks, weekday rules across three time zones,
 * midnight-crossing calendar events) exhaustively testable in `dnd.test.ts`
 * without a server, and it is what makes the AD-8 acceptance criterion
 * checkable with a grep: no client — mobile or PWA — imports or reimplements
 * `resolveDndActive`/`isDndWindowOnDay`. The phone uploads raw UTC instants
 * and renders the `dndActiveUntil` the server already computed; it decides
 * nothing.
 *
 * Exactly three callers exist, all server-side:
 * - `activity-trigger.ts` (N-01/N-02/N-04) — seals and discards.
 * - `scheduler.ts` (N-03) — seals and discards.
 * - `storage.ts`'s day view — computes `dndActiveUntil` for T-01's chip.
 *
 * Suppressing means SEALING AND DISCARDING: the caller marks the very same
 * dedupe column a real fire would mark and builds no event. There is no queue,
 * no `suppressed_at`, no deferral — which is precisely why nothing can ever be
 * "recovered" when the meeting ends.
 *
 * Every time value in this module is a zero-padded `HH:mm` wall clock in the
 * PROFILE's time zone, compared lexically, and every range is half-open
 * `[start, end)` — the same idiom `isWithinWorkingHours` (origin-pull.ts)
 * already uses. Every date is a `YYYY-MM-DD` string that was already resolved
 * in the profile's zone upstream; nothing here ever reads the process clock or
 * the device's zone.
 */
import type {
    TdahDndCalendarEvent,
    TdahDndWindow,
    TdahDndWindowDraft,
    TdahDndWindowInput,
} from './types';

/**
 * The manual-window cap, the same class of bound `TDAH_DAY_MAX_ACTIVITIES`
 * (storage.ts) already sets on the day: a list a person actually curates by
 * hand, kept from becoming an unbounded write surface. Calendar windows are
 * NOT counted against it — they are a replaceable projection, and the phone's
 * own upload is bounded separately below.
 */
export const TDAH_DND_MAX_MANUAL_WINDOWS = 50;

/**
 * The per-request cap on `PUT /v1/tdah/dnd/calendar`'s `events` array. A
 * fortnight of a busy calendar is well under this; anything beyond it is a
 * client bug or an attempt to make the server materialize an unbounded number
 * of rows, so it is a 400 rather than a silent truncation (truncating would
 * mean silently NOT suppressing a real meeting, which is the one failure this
 * feature cannot have).
 */
export const TDAH_DND_MAX_CALENDAR_EVENTS = 200;

/** Doc 06's own example window, and the same 09:00–18:00 pair the Origen defaults to — deliberately duplicated rather than imported, because the two definitions are independent on purpose (see `TdahDndSettings`). */
export const TDAH_DND_DEFAULT_WORK_START = '09:00';
export const TDAH_DND_DEFAULT_WORK_END = '18:00';

/** A window's own label is the user's free text; capped like every other free-text field in this module. */
export const TDAH_DND_LABEL_MAX_LENGTH = 80;

/**
 * A multi-day calendar event is split one local day at a time; this bounds
 * that walk so a malformed (or genuinely enormous) event can never spin the
 * materializer. Two weeks is far past anything a "busy" event should span, and
 * every segment past the working window is discarded anyway.
 *
 * Hitting the bound DROPS THE WHOLE EVENT rather than keeping the prefix it
 * managed to walk (see `materializeCalendarWindows`): an event this long is not
 * a meeting, and silencing its first fifteen days while leaving its last one
 * loud is strictly worse than silencing none of it — it produces a silence the
 * user cannot predict and cannot explain from the list.
 */
const MAX_CALENDAR_EVENT_LOCAL_DAYS = 14;

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
// Same shape/range as storage.ts's own TDAH_DATE_SHAPE_PATTERN — replicated
// rather than imported because storage.ts imports THIS module (for
// `resolveDndActive`), and this module must stay dependency-free to stay pure.
const DATE_SHAPE_PATTERN = /^(19[7-9]\d|2\d{3})-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

/** The last representable `HH:mm` of a local day — where a midnight-crossing calendar event's first segment is closed (see `materializeCalendarWindows`). */
const LAST_MINUTE_OF_DAY = '23:59';
const FIRST_MINUTE_OF_DAY = '00:00';

/**
 * "HH:mm" wall-clock time in `timeZone` at `now`, resolved through
 * `Intl.DateTimeFormat` rather than manual UTC-offset math — the module's
 * standing "never bypass Intl for calendar/time-zone work" convention.
 * Zero-padded (`hourCycle: 'h23'`), so it compares lexically against a
 * profile's `ritualHour`, a window's `startTime`/`endTime` and the DND working
 * hours alike.
 *
 * Lives here (story 4.3) rather than in `scheduler.ts`, which is where it was
 * first written and which now re-exports it unchanged: `storage.ts` needs the
 * same value to attach `dndActiveUntil` to the day, and `storage.ts` importing
 * `scheduler.ts` would close an import cycle (scheduler → storage → scheduler).
 * This module imports nothing but types, so it can be the shared floor.
 */
export const computeLocalTimeOfDay = (timeZone: string, now: Date): string => (
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
);

/**
 * The weekday (0=Sunday … 6=Saturday, the same numbering
 * `TdahRoutineWeekdayPattern` uses) of a `YYYY-MM-DD` date string that was
 * ALREADY resolved in the profile's time zone.
 *
 * This signature is the whole point: it cannot take a `Date`, so it cannot be
 * called with `now.getDay()`/`now.getUTCDay()` semantics by accident. A weekly
 * rule for "Monday 10:30" must fire when the USER's calendar says Monday, and
 * for a profile in `Pacific/Auckland` at 22:00 UTC on a Sunday it is already
 * Monday there — `now.getDay()` would say Sunday and silently not suppress.
 * `Date.UTC` over a time-less date is immune to DST, so this always agrees
 * with the day the user sees.
 */
export const computeLocalWeekday = (date: string): number => {
    const [year, month, day] = date.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

/**
 * Does this window apply on `date` at all? Recurrence only — the time-of-day
 * comparison is `resolveDndActive`'s job.
 *
 * `weekday` is passed in rather than recomputed so a caller evaluating many
 * windows for one day derives it exactly once (and so a test can prove the two
 * agree).
 */
export const isDndWindowOnDay = (window: TdahDndWindow, date: string, weekday: number): boolean => {
    if (window.kind === 'once') return window.date === date;
    return Array.isArray(window.weekdays) && window.weekdays.includes(weekday);
};

export type TdahDndResolution =
    | { active: false }
    | { active: true; until: string };

/**
 * The predicate. Overlapping windows are an OR — any one active suppresses —
 * and the `until` the user is shown is the end of the CONTIGUOUS BLOCK, not of
 * the single window that happens to cover "now":
 *
 *   10:00–11:00 + 10:30–12:00, now 10:45  ->  until 12:00 (overlapping)
 *   10:00–11:00 + 11:00–12:00, now 10:10  ->  until 12:00 (abutting, extends transitively)
 *   10:00–11:00 + 11:30–12:00, now 10:10  ->  until 11:00 (a real gap ends the block)
 *
 * The extension is transitive and iterated to a fixed point on purpose: a
 * chain of three back-to-back meetings must report the end of the third, or
 * the chip would promise the user quiet at a moment they will still be
 * silenced — and this screen's entire job is to be trustworthy about when the
 * silence ends.
 *
 * Ranges are half-open `[start, end)`: a window ending at 11:00 is already
 * over at 11:00. The loop is bounded by the window count (each pass either
 * advances `until` strictly or stops), so it always terminates.
 */
export const resolveDndActive = (
    windows: TdahDndWindow[],
    date: string,
    weekday: number,
    timeOfDay: string,
): TdahDndResolution => {
    const onDay = windows.filter((window) => isDndWindowOnDay(window, date, weekday));
    let until: string | null = null;
    for (const window of onDay) {
        if (window.startTime <= timeOfDay && timeOfDay < window.endTime) {
            if (until === null || window.endTime > until) until = window.endTime;
        }
    }
    if (until === null) return { active: false };

    // Fixed point: absorb every window that starts at or before the current
    // block end and reaches past it. Capped by `onDay.length` because each
    // effective pass strictly increases `until`, so no window can be absorbed
    // twice.
    for (let pass = 0; pass < onDay.length; pass += 1) {
        let extended = false;
        for (const window of onDay) {
            if (window.startTime <= until && window.endTime > until) {
                until = window.endTime;
                extended = true;
            }
        }
        if (!extended) break;
    }
    return { active: true, until };
};

const isValidTimeOfDay = (value: unknown): value is string => (
    typeof value === 'string' && TIME_OF_DAY_PATTERN.test(value)
);

/** Calendar-real ISO date (rejects e.g. `2026-02-31`), same round-trip check `isValidDateString` (storage.ts) performs. */
const isValidDndDate = (value: unknown): value is string => {
    if (typeof value !== 'string' || !DATE_SHAPE_PATTERN.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const roundTrip = new Date(Date.UTC(year, month - 1, day));
    return roundTrip.getUTCFullYear() === year
        && roundTrip.getUTCMonth() === month - 1
        && roundTrip.getUTCDate() === day;
};

/** `date` shifted by whole days, via the same `Date.UTC` normalization `computeTomorrowDate` (storage.ts) uses — no zone needed, the zone was already applied when `date` was first resolved. */
const shiftDndDate = (date: string, deltaDays: number): string => {
    const [year, month, day] = date.split('-').map(Number) as [number, number, number];
    const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
    const shiftedYear = String(shifted.getUTCFullYear()).padStart(4, '0');
    const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const shiftedDay = String(shifted.getUTCDate()).padStart(2, '0');
    return `${shiftedYear}-${shiftedMonth}-${shiftedDay}`;
};

/**
 * One absolute instant projected into `timeZone` as a `(date, HH:mm)` pair, in
 * a SINGLE `Intl` call. One call rather than two on purpose: two independent
 * formats a few statements apart can straddle nothing here (the instant is
 * fixed), but reading both halves out of one `formatToParts` makes it
 * structurally impossible for the date and the time to come from different
 * resolutions of the same zone.
 */
const resolveZonedParts = (instant: Date, timeZone: string): { date: string; time: string } => {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(instant);
    const read = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
    return {
        date: `${read('year')}-${read('month')}-${read('day')}`,
        time: `${read('hour')}:${read('minute')}`,
    };
};

const isWithinDndWorkingHours = (start: string, end: string, workStart: string, workEnd: string): boolean => (
    start < end && start < workEnd && end > workStart
);

/**
 * Turns the phone's RAW UTC instants into profile-local `source: 'calendar'`
 * windows. This is the AD-8 boundary made concrete: every conversion, every
 * clip and every discard happens HERE, on the server, in the PROFILE's zone —
 * never on the device, whose own zone can legitimately differ (AD-6 makes the
 * profile zone editable).
 *
 * Per event, in order:
 * 1. Reject anything unparseable or non-forward (`end <= start`).
 * 2. Project both endpoints into `timeZone`.
 * 3. Split by LOCAL midnight: an event running 23:00–01:00 becomes
 *    `23:00–23:59` today and `00:00–01:00` tomorrow. The lost minute is
 *    deliberate — it keeps every window inside one `HH:mm` day so the whole
 *    domain stays lexically comparable, and one minute cannot matter for
 *    silencing a meeting. (Both halves normally vanish at step 4 anyway.)
 * 4. Clip to `[workStart, workEnd)` and DISCARD anything that ends up empty —
 *    an evening event never silences anything, which is the point of having a
 *    working window bound the detection at all.
 *
 * No label ever travels: the event's title stays on the phone. The server has
 * no use for it and the privacy rule forbids it reaching a log.
 */
export const materializeCalendarWindows = (
    events: TdahDndCalendarEvent[],
    timeZone: string,
    workStart: string,
    workEnd: string,
): TdahDndWindowDraft[] => {
    const windows: TdahDndWindowDraft[] = [];
    for (const event of events) {
        const startMs = Date.parse(event.startsAt);
        const endMs = Date.parse(event.endsAt);
        if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) continue;

        const start = resolveZonedParts(new Date(startMs), timeZone);
        const end = resolveZonedParts(new Date(endMs), timeZone);

        const segments: { date: string; startTime: string; endTime: string }[] = [];
        if (start.date === end.date) {
            segments.push({ date: start.date, startTime: start.time, endTime: end.time });
        } else {
            segments.push({ date: start.date, startTime: start.time, endTime: LAST_MINUTE_OF_DAY });
            let cursor = shiftDndDate(start.date, 1);
            let guard = 0;
            while (cursor < end.date && guard < MAX_CALENDAR_EVENT_LOCAL_DAYS) {
                segments.push({ date: cursor, startTime: FIRST_MINUTE_OF_DAY, endTime: LAST_MINUTE_OF_DAY });
                cursor = shiftDndDate(cursor, 1);
                guard += 1;
            }
            // The walk stopped short of the event's own last day: the guard
            // tripped. Truncation here is TOTAL, not partial — emitting the
            // prefix would silence day 1..15 and leave day 16 loud, a lopsided
            // silence nobody asked for and nobody can predict. Drop the event.
            if (cursor !== end.date) continue;
            segments.push({ date: end.date, startTime: FIRST_MINUTE_OF_DAY, endTime: end.time });
        }

        for (const segment of segments) {
            const clippedStart = segment.startTime < workStart ? workStart : segment.startTime;
            const clippedEnd = segment.endTime > workEnd ? workEnd : segment.endTime;
            if (!isWithinDndWorkingHours(clippedStart, clippedEnd, workStart, workEnd)) continue;
            windows.push({
                source: 'calendar',
                kind: 'once',
                weekdays: null,
                date: segment.date,
                startTime: clippedStart,
                endTime: clippedEnd,
                label: null,
            });
        }
    }
    return windows;
};

type ManualWindowBody = {
    kind?: unknown;
    weekdays?: unknown;
    date?: unknown;
    startTime?: unknown;
    endTime?: unknown;
    label?: unknown;
};

/**
 * `POST`/`PUT /v1/tdah/dnd/windows[/:id]`'s validator — shape only, zero I/O,
 * the same "parse before any storage touch" order `parseWorkOriginPutBody`
 * (routes.ts) follows. Returns `null` for anything malformed; the route turns
 * that into 400 `TDAH_DND_INVALID` with nothing persisted.
 *
 * `source` is deliberately NOT accepted from the body: a client can only ever
 * create a `'manual'` window, and a `'calendar'` one is minted exclusively by
 * `materializeCalendarWindows` above. That is what makes the read-only rule
 * enforceable rather than merely documented.
 *
 * `startTime < endTime` is required (never `<=`, never crossing midnight):
 * a half-open range with `start === end` silences nothing, and a
 * midnight-crossing rule is expressed as two windows — the same shape
 * `handlePutWorkOrigin`'s `workStart < workEnd` check already establishes for
 * the Origen's window.
 */
export const parseManualWindowInput = (value: unknown): TdahDndWindowInput | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const raw = value as ManualWindowBody;

    if (!isValidTimeOfDay(raw.startTime) || !isValidTimeOfDay(raw.endTime)) return null;
    if (raw.startTime >= raw.endTime) return null;

    let label: string | null = null;
    if (raw.label !== undefined && raw.label !== null) {
        if (typeof raw.label !== 'string') return null;
        const trimmed = raw.label.trim();
        if (trimmed.length > TDAH_DND_LABEL_MAX_LENGTH) return null;
        label = trimmed.length > 0 ? trimmed : null;
    }

    if (raw.kind === 'once') {
        if (!isValidDndDate(raw.date)) return null;
        return {
            source: 'manual',
            kind: 'once',
            weekdays: null,
            date: raw.date,
            startTime: raw.startTime,
            endTime: raw.endTime,
            label,
        };
    }

    if (raw.kind !== 'weekly') return null;
    if (!Array.isArray(raw.weekdays) || raw.weekdays.length === 0) return null;
    const weekdays: number[] = [];
    for (const entry of raw.weekdays) {
        if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0 || entry > 6) return null;
        if (!weekdays.includes(entry)) weekdays.push(entry);
    }
    weekdays.sort((left, right) => left - right);
    return {
        source: 'manual',
        kind: 'weekly',
        weekdays,
        date: null,
        startTime: raw.startTime,
        endTime: raw.endTime,
        label,
    };
};

type CalendarSyncBody = {
    rangeStart?: unknown;
    rangeEnd?: unknown;
    events?: unknown;
};

export type TdahDndParsedCalendarSync = {
    rangeStartMs: number;
    rangeEndMs: number;
    events: TdahDndCalendarEvent[];
};

/**
 * `PUT /v1/tdah/dnd/calendar`'s validator. Same shape-only contract as
 * `parseManualWindowInput`: every instant must be a parseable ISO string, the
 * range must run forward, and the payload must stay under
 * `TDAH_DND_MAX_CALENDAR_EVENTS`.
 *
 * Individual events are NOT rejected here for being non-forward or outside the
 * range — `materializeCalendarWindows` already drops those, and a whole sync
 * failing because one calendar entry is odd would leave the user silently
 * un-suppressed for every OTHER meeting in the range. The cap is different: it
 * bounds the work, so it must fail the request rather than truncate it.
 */
export const parseCalendarSyncInput = (value: unknown): TdahDndParsedCalendarSync | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const raw = value as CalendarSyncBody;
    if (typeof raw.rangeStart !== 'string' || typeof raw.rangeEnd !== 'string') return null;
    const rangeStartMs = Date.parse(raw.rangeStart);
    const rangeEndMs = Date.parse(raw.rangeEnd);
    if (Number.isNaN(rangeStartMs) || Number.isNaN(rangeEndMs) || rangeEndMs <= rangeStartMs) return null;
    if (!Array.isArray(raw.events)) return null;
    if (raw.events.length > TDAH_DND_MAX_CALENDAR_EVENTS) return null;

    const events: TdahDndCalendarEvent[] = [];
    for (const entry of raw.events) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
        const { startsAt, endsAt } = entry as { startsAt?: unknown; endsAt?: unknown };
        if (typeof startsAt !== 'string' || typeof endsAt !== 'string') return null;
        if (Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt))) return null;
        events.push({ startsAt, endsAt });
    }
    return { rangeStartMs, rangeEndMs, events };
};

/** `TdahDndSettingsInput`'s shape check — the `workStart < workEnd` cross-check happens in the handler, on the merged (body → persisted → default) pair, exactly like `handlePutWorkOrigin`'s. */
export const parseDndSettingsInput = (value: unknown): { calendarEnabled?: boolean; workStart?: string; workEnd?: string } | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const raw = value as { calendarEnabled?: unknown; workStart?: unknown; workEnd?: unknown };
    const parsed: { calendarEnabled?: boolean; workStart?: string; workEnd?: string } = {};
    if (raw.calendarEnabled !== undefined) {
        if (typeof raw.calendarEnabled !== 'boolean') return null;
        parsed.calendarEnabled = raw.calendarEnabled;
    }
    if (raw.workStart !== undefined) {
        if (!isValidTimeOfDay(raw.workStart)) return null;
        parsed.workStart = raw.workStart;
    }
    if (raw.workEnd !== undefined) {
        if (!isValidTimeOfDay(raw.workEnd)) return null;
        parsed.workEnd = raw.workEnd;
    }
    return parsed;
};

/** Re-exported for callers that only need the window type alongside the predicate. */
export type { TdahDndWindow };

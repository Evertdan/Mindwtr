/**
 * Story 4.3 — the DND predicate's own edge matrix.
 *
 * `dnd.ts` is pure by design (see its header), so everything the whole feature
 * can get wrong about time is provable here, with no server, no sqlite, no
 * socket and no clock: half-open ranges, OR of overlapping windows, transitive
 * extension across a contiguous block, weekday rules resolved in the PROFILE's
 * zone rather than the process's, calendar events converted/split/clipped, and
 * everything outside the working window discarded.
 *
 * `formatDateInTimeZone` is imported from `storage.ts` on purpose: the
 * time-zone tests below must exercise the SAME "today" resolution production
 * uses (`runNamespaceTick`/`runNamespaceActivityTriggerTick` both call it), not
 * a second copy written for the test.
 */
import { describe, expect, test } from 'bun:test';
import {
    computeLocalTimeOfDay,
    computeLocalWeekday,
    isDndWindowOnDay,
    materializeCalendarWindows,
    parseCalendarSyncInput,
    parseDndSettingsInput,
    parseManualWindowInput,
    resolveDndActive,
    TDAH_DND_DEFAULT_WORK_END,
    TDAH_DND_DEFAULT_WORK_START,
    TDAH_DND_MAX_CALENDAR_EVENTS,
} from './dnd';
import { formatDateInTimeZone } from './storage';
import type { TdahDndWindow } from './types';

const DATE = '2026-08-30';
/** 2026-08-30 is a Sunday (0); every fixture below leans on that. */
const SUNDAY = 0;
const MONDAY = 1;

let nextWindowId = 0;
const onceWindow = (startTime: string, endTime: string, date: string = DATE): TdahDndWindow => {
    nextWindowId += 1;
    return {
        id: `w${nextWindowId}`,
        source: 'manual',
        kind: 'once',
        weekdays: null,
        date,
        startTime,
        endTime,
        label: null,
    };
};

const weeklyWindow = (weekdays: number[], startTime: string, endTime: string): TdahDndWindow => {
    nextWindowId += 1;
    return {
        id: `w${nextWindowId}`,
        source: 'manual',
        kind: 'weekly',
        weekdays,
        date: null,
        startTime,
        endTime,
        label: null,
    };
};

const resolveAt = (windows: TdahDndWindow[], timeOfDay: string, date: string = DATE) => (
    resolveDndActive(windows, date, computeLocalWeekday(date), timeOfDay)
);

describe('resolveDndActive (story 4.3: the suppression predicate)', () => {
    test('a window is half-open [start, end): active at its start, still active one minute before its end, over exactly at its end', () => {
        const windows = [onceWindow('10:00', '11:00')];
        expect(resolveAt(windows, '09:59')).toEqual({ active: false });
        expect(resolveAt(windows, '10:00')).toEqual({ active: true, until: '11:00' });
        expect(resolveAt(windows, '10:59')).toEqual({ active: true, until: '11:00' });
        // The exact instant the meeting ends is already quiet — the same
        // half-open convention `isWithinWorkingHours` (origin-pull.ts) uses.
        expect(resolveAt(windows, '11:00')).toEqual({ active: false });
    });

    test('with no windows at all, nothing is ever active (the whole no-regression path)', () => {
        expect(resolveAt([], '10:00')).toEqual({ active: false });
        expect(resolveAt([], '00:00')).toEqual({ active: false });
        expect(resolveAt([], '23:59')).toEqual({ active: false });
    });

    // Matrix: "OR de solapadas".
    test('overlapping windows are an OR, and `until` is the furthest end', () => {
        const windows = [onceWindow('10:00', '11:00'), onceWindow('10:30', '12:00')];
        expect(resolveAt(windows, '10:45')).toEqual({ active: true, until: '12:00' });
        // Order of the list must not matter.
        expect(resolveAt([...windows].reverse(), '10:45')).toEqual({ active: true, until: '12:00' });
    });

    // Matrix: "Bloque contiguo" — this is the one the chip's honesty depends on.
    test('`until` extends transitively across a contiguous block, not just to the window covering "now"', () => {
        const windows = [onceWindow('10:00', '11:00'), onceWindow('11:00', '12:00')];
        expect(resolveAt(windows, '10:10')).toEqual({ active: true, until: '12:00' });
    });

    test('the transitive extension chains through three back-to-back windows', () => {
        const windows = [
            onceWindow('09:00', '10:00'),
            onceWindow('10:00', '11:00'),
            onceWindow('11:00', '12:30'),
        ];
        expect(resolveAt(windows, '09:05')).toEqual({ active: true, until: '12:30' });
    });

    // Matrix: "No contiguas".
    test('a real gap ends the block: a later, disconnected window never extends `until`', () => {
        const windows = [onceWindow('10:00', '11:00'), onceWindow('11:30', '12:00')];
        expect(resolveAt(windows, '10:10')).toEqual({ active: true, until: '11:00' });
        // And the gap itself is genuinely quiet.
        expect(resolveAt(windows, '11:15')).toEqual({ active: false });
        expect(resolveAt(windows, '11:30')).toEqual({ active: true, until: '12:00' });
    });

    test('a window fully contained in another never shortens the block end', () => {
        const windows = [onceWindow('09:00', '13:00'), onceWindow('10:00', '10:15')];
        expect(resolveAt(windows, '10:05')).toEqual({ active: true, until: '13:00' });
    });

    // Matrix: "Puntual de otro día".
    test('a `once` window only applies on its own date', () => {
        const windows = [onceWindow('10:00', '11:00', '2026-09-01')];
        expect(resolveAt(windows, '10:30', '2026-08-28')).toEqual({ active: false });
        expect(resolveAt(windows, '10:30', '2026-09-01')).toEqual({ active: true, until: '11:00' });
    });

    test('a `weekly` window applies on every listed weekday and on no other', () => {
        // Monday + Wednesday + Friday.
        const windows = [weeklyWindow([1, 3, 5], '09:30', '09:45')];
        // 2026-08-30 is a Sunday: not listed.
        expect(resolveAt(windows, '09:35', '2026-08-30')).toEqual({ active: false });
        // 2026-08-31 is the Monday right after.
        expect(resolveAt(windows, '09:35', '2026-08-31')).toEqual({ active: true, until: '09:45' });
        // 2026-09-01 is the Tuesday: not listed.
        expect(resolveAt(windows, '09:35', '2026-09-01')).toEqual({ active: false });
    });

    test('a manual window and a calendar window OR together exactly like two manual ones', () => {
        const calendar: TdahDndWindow = { ...onceWindow('10:00', '11:00'), source: 'calendar' };
        const manual = onceWindow('10:45', '11:30');
        expect(resolveAt([calendar, manual], '10:50')).toEqual({ active: true, until: '11:30' });
    });
});

describe('computeLocalWeekday (story 4.3: the weekday never comes from the process clock)', () => {
    test('derives the weekday from an already-zone-resolved YYYY-MM-DD, DST-immune', () => {
        expect(computeLocalWeekday('2026-08-30')).toBe(SUNDAY);
        expect(computeLocalWeekday('2026-08-31')).toBe(MONDAY);
        // Across a DST transition in the northern hemisphere (2026-03-29 is a
        // Sunday in Europe/Madrid's spring-forward week) the answer is still
        // pure calendar arithmetic.
        expect(computeLocalWeekday('2026-03-29')).toBe(SUNDAY);
        expect(computeLocalWeekday('2026-03-30')).toBe(MONDAY);
    });

    /**
     * The bug this whole helper exists to block. At 2026-08-30T23:00Z it is
     * still Sunday in UTC and in America/Los_Angeles, but already MONDAY in
     * Pacific/Auckland. A weekly "Monday 10:30-11:30" rule must suppress for
     * the Auckland profile and must NOT for the other two — and `now.getDay()`
     * / `now.getUTCDay()` would say Sunday for all three, silently letting the
     * meeting be interrupted.
     */
    test('a weekly Monday rule fires in the zone where it is already Monday, and nowhere else', () => {
        const now = new Date('2026-08-30T23:00:00.000Z');
        expect(now.getUTCDay()).toBe(SUNDAY);

        const windows = [weeklyWindow([MONDAY], '10:30', '11:30')];

        const auckland = formatDateInTimeZone(now, 'Pacific/Auckland');
        expect(auckland).toBe('2026-08-31');
        expect(computeLocalTimeOfDay('Pacific/Auckland', now)).toBe('11:00');
        expect(resolveDndActive(windows, auckland, computeLocalWeekday(auckland), computeLocalTimeOfDay('Pacific/Auckland', now)))
            .toEqual({ active: true, until: '11:30' });

        const utc = formatDateInTimeZone(now, 'UTC');
        expect(utc).toBe('2026-08-30');
        expect(resolveDndActive(windows, utc, computeLocalWeekday(utc), computeLocalTimeOfDay('UTC', now)))
            .toEqual({ active: false });

        const losAngeles = formatDateInTimeZone(now, 'America/Los_Angeles');
        expect(losAngeles).toBe('2026-08-30');
        expect(resolveDndActive(windows, losAngeles, computeLocalWeekday(losAngeles), computeLocalTimeOfDay('America/Los_Angeles', now)))
            .toEqual({ active: false });
    });
});

describe('isDndWindowOnDay (story 4.3: recurrence, independent of the clock)', () => {
    test('separates recurrence from the time-of-day comparison', () => {
        const weekly = weeklyWindow([MONDAY], '10:00', '11:00');
        expect(isDndWindowOnDay(weekly, '2026-08-31', MONDAY)).toBe(true);
        expect(isDndWindowOnDay(weekly, '2026-08-30', SUNDAY)).toBe(false);

        const once = onceWindow('10:00', '11:00', '2026-08-31');
        expect(isDndWindowOnDay(once, '2026-08-31', MONDAY)).toBe(true);
        expect(isDndWindowOnDay(once, '2026-08-30', SUNDAY)).toBe(false);
    });

    test('a weekly window with a null/empty weekday list never applies (a corrupt row silences nothing)', () => {
        const broken: TdahDndWindow = { ...weeklyWindow([1], '10:00', '11:00'), weekdays: null };
        expect(isDndWindowOnDay(broken, '2026-08-31', MONDAY)).toBe(false);
    });
});

describe('materializeCalendarWindows (story 4.3: the phone observes, the server decides)', () => {
    const WORK_START = TDAH_DND_DEFAULT_WORK_START;
    const WORK_END = TDAH_DND_DEFAULT_WORK_END;

    // Matrix: "Calendario fuera de horario laboral".
    test('an event entirely outside the working window materializes nothing', () => {
        const windows = materializeCalendarWindows(
            [{ startsAt: '2026-08-30T20:00:00.000Z', endsAt: '2026-08-30T21:00:00.000Z' }],
            'UTC',
            WORK_START,
            WORK_END,
        );
        expect(windows).toEqual([]);
    });

    // Matrix: "Calendario recortado".
    test('an event straddling the start of the working window is clipped to it', () => {
        const windows = materializeCalendarWindows(
            [{ startsAt: '2026-08-30T08:00:00.000Z', endsAt: '2026-08-30T10:00:00.000Z' }],
            'UTC',
            WORK_START,
            WORK_END,
        );
        expect(windows).toEqual([{
            source: 'calendar',
            kind: 'once',
            weekdays: null,
            date: '2026-08-30',
            startTime: '09:00',
            endTime: '10:00',
            label: null,
        }]);
    });

    test('an event straddling the end of the working window is clipped to it', () => {
        const windows = materializeCalendarWindows(
            [{ startsAt: '2026-08-30T17:30:00.000Z', endsAt: '2026-08-30T19:30:00.000Z' }],
            'UTC',
            WORK_START,
            WORK_END,
        );
        expect(windows).toHaveLength(1);
        expect(windows[0]?.startTime).toBe('17:30');
        expect(windows[0]?.endTime).toBe('18:00');
    });

    // Matrix: "Evento cruza medianoche local".
    test('an event crossing local midnight becomes two windows, split at 23:59 / 00:00', () => {
        const windows = materializeCalendarWindows(
            [{ startsAt: '2026-08-30T23:00:00.000Z', endsAt: '2026-08-31T01:00:00.000Z' }],
            'UTC',
            // A full-day working window, purely so the split itself is visible;
            // with the real 09:00-18:00 default both halves vanish (asserted
            // in the next test).
            '00:00',
            '23:59',
        );
        expect(windows).toEqual([
            { source: 'calendar', kind: 'once', weekdays: null, date: '2026-08-30', startTime: '23:00', endTime: '23:59', label: null },
            { source: 'calendar', kind: 'once', weekdays: null, date: '2026-08-31', startTime: '00:00', endTime: '01:00', label: null },
        ]);
    });

    test('both halves of a midnight-crossing event disappear under the default 09:00-18:00 window', () => {
        const windows = materializeCalendarWindows(
            [{ startsAt: '2026-08-30T23:00:00.000Z', endsAt: '2026-08-31T01:00:00.000Z' }],
            'UTC',
            WORK_START,
            WORK_END,
        );
        expect(windows).toEqual([]);
    });

    /**
     * The AD-8 conversion itself: the phone uploads one absolute instant, and
     * which local day/hours it lands on is decided ENTIRELY by the profile's
     * zone. The same 23:00Z event is an evening in UTC (discarded) and a
     * late-morning meeting in Pacific/Auckland (kept, clipped).
     */
    test('the profile time zone — not the device\'s — decides the local day and hours', () => {
        const event = [{ startsAt: '2026-08-30T23:00:00.000Z', endsAt: '2026-08-31T00:30:00.000Z' }];

        expect(materializeCalendarWindows(event, 'UTC', WORK_START, WORK_END)).toEqual([]);

        const auckland = materializeCalendarWindows(event, 'Pacific/Auckland', WORK_START, WORK_END);
        expect(auckland).toEqual([{
            source: 'calendar',
            kind: 'once',
            weekdays: null,
            date: '2026-08-31',
            startTime: '11:00',
            endTime: '12:30',
            label: null,
        }]);
    });

    test('never carries a label: nothing the user wrote in their calendar leaves the phone', () => {
        const windows = materializeCalendarWindows(
            [{ startsAt: '2026-08-30T10:00:00.000Z', endsAt: '2026-08-30T11:00:00.000Z' }],
            'UTC',
            WORK_START,
            WORK_END,
        );
        expect(windows).toHaveLength(1);
        expect(windows[0]?.label).toBeNull();
        expect(windows[0]?.source).toBe('calendar');
    });

    test('an unparseable or non-forward event is dropped without taking the rest of the sync down with it', () => {
        const windows = materializeCalendarWindows(
            [
                { startsAt: 'not-a-date', endsAt: '2026-08-30T11:00:00.000Z' },
                { startsAt: '2026-08-30T11:00:00.000Z', endsAt: '2026-08-30T11:00:00.000Z' },
                { startsAt: '2026-08-30T12:00:00.000Z', endsAt: '2026-08-30T11:00:00.000Z' },
                { startsAt: '2026-08-30T14:00:00.000Z', endsAt: '2026-08-30T15:00:00.000Z' },
            ],
            'UTC',
            WORK_START,
            WORK_END,
        );
        expect(windows).toHaveLength(1);
        expect(windows[0]?.startTime).toBe('14:00');
    });

    /**
     * The day-walk guard, pinned on both sides. Truncation is TOTAL, never
     * partial: an event long enough to trip `MAX_CALENDAR_EVENT_LOCAL_DAYS` is
     * dropped whole, rather than emitting the prefix the walk managed to reach
     * and silently leaving the event's LAST day loud. Silencing fifteen days of
     * something and not the sixteenth is a silence the user can neither predict
     * nor explain from the list; silencing none of it at least matches the
     * "this is not a meeting" reality.
     */
    test('an event exactly at the multi-day bound still materializes every one of its local days', () => {
        const windows = materializeCalendarWindows(
            // 2026-08-30 .. 2026-09-14 inclusive: 16 local days, the longest
            // walk the guard permits.
            [{ startsAt: '2026-08-30T10:00:00.000Z', endsAt: '2026-09-14T11:00:00.000Z' }],
            'UTC',
            '00:00',
            '23:59',
        );
        expect(windows).toHaveLength(16);
        expect(windows[0]?.date).toBe('2026-08-30');
        expect(windows[0]?.startTime).toBe('10:00');
        expect(windows[15]?.date).toBe('2026-09-14');
        expect(windows[15]?.endTime).toBe('11:00');
    });

    test('an event one local day past the bound is dropped ENTIRELY, not truncated to a lopsided prefix', () => {
        const windows = materializeCalendarWindows(
            [
                // 17 local days — one past the walk's bound.
                { startsAt: '2026-08-30T10:00:00.000Z', endsAt: '2026-09-15T11:00:00.000Z' },
                // ...and a perfectly ordinary meeting in the same payload,
                // which must survive its neighbour being dropped.
                { startsAt: '2026-08-30T14:00:00.000Z', endsAt: '2026-08-30T15:00:00.000Z' },
            ],
            'UTC',
            '00:00',
            '23:59',
        );
        expect(windows).toEqual([{
            source: 'calendar',
            kind: 'once',
            weekdays: null,
            date: '2026-08-30',
            startTime: '14:00',
            endTime: '15:00',
            label: null,
        }]);
    });

    test('the materialized windows feed straight back into the predicate', () => {
        const windows = materializeCalendarWindows(
            [{ startsAt: '2026-08-30T10:00:00.000Z', endsAt: '2026-08-30T11:00:00.000Z' }],
            'UTC',
            WORK_START,
            WORK_END,
        ).map((draft, index) => ({ id: `c${index}`, ...draft }));
        expect(resolveAt(windows, '10:30')).toEqual({ active: true, until: '11:00' });
        expect(resolveAt(windows, '11:00')).toEqual({ active: false });
    });
});

describe('parseManualWindowInput (story 4.3: 400 TDAH_DND_INVALID, nothing persisted)', () => {
    test('accepts a weekly rule and normalizes its weekdays (deduped, sorted)', () => {
        expect(parseManualWindowInput({ kind: 'weekly', weekdays: [3, 1, 1], startTime: '10:00', endTime: '11:00' })).toEqual({
            source: 'manual',
            kind: 'weekly',
            weekdays: [1, 3],
            date: null,
            startTime: '10:00',
            endTime: '11:00',
            label: null,
        });
    });

    test('accepts a one-off rule with a real calendar date and a trimmed label', () => {
        expect(parseManualWindowInput({ kind: 'once', date: '2026-09-01', startTime: '22:45', endTime: '23:30', label: '  Junta  ' })).toEqual({
            source: 'manual',
            kind: 'once',
            weekdays: null,
            date: '2026-09-01',
            startTime: '22:45',
            endTime: '23:30',
            label: 'Junta',
        });
    });

    test('rejects `end <= start`, a malformed HH:mm, an empty/out-of-range weekday list and a non-ISO date', () => {
        const base = { kind: 'weekly' as const, weekdays: [1], startTime: '10:00', endTime: '11:00' };
        expect(parseManualWindowInput({ ...base, endTime: '10:00' })).toBeNull();
        expect(parseManualWindowInput({ ...base, endTime: '09:00' })).toBeNull();
        expect(parseManualWindowInput({ ...base, startTime: '9:00' })).toBeNull();
        expect(parseManualWindowInput({ ...base, startTime: '24:00' })).toBeNull();
        expect(parseManualWindowInput({ ...base, endTime: '10:60' })).toBeNull();
        expect(parseManualWindowInput({ ...base, weekdays: [] })).toBeNull();
        expect(parseManualWindowInput({ ...base, weekdays: [7] })).toBeNull();
        expect(parseManualWindowInput({ ...base, weekdays: [-1] })).toBeNull();
        expect(parseManualWindowInput({ ...base, weekdays: [1.5] })).toBeNull();
        expect(parseManualWindowInput({ kind: 'once', date: '2026-02-31', startTime: '10:00', endTime: '11:00' })).toBeNull();
        expect(parseManualWindowInput({ kind: 'once', date: '2026-9-1', startTime: '10:00', endTime: '11:00' })).toBeNull();
        expect(parseManualWindowInput({ kind: 'daily', startTime: '10:00', endTime: '11:00' })).toBeNull();
        expect(parseManualWindowInput(null)).toBeNull();
        expect(parseManualWindowInput([])).toBeNull();
    });

    test('never accepts a `source` from the body — a client can only ever create a manual window', () => {
        const parsed = parseManualWindowInput({
            kind: 'weekly',
            weekdays: [1],
            startTime: '10:00',
            endTime: '11:00',
            source: 'calendar',
        });
        expect(parsed?.source).toBe('manual');
    });
});

describe('parseCalendarSyncInput / parseDndSettingsInput (story 4.3)', () => {
    test('requires a forward range and caps the payload', () => {
        const ok = parseCalendarSyncInput({
            rangeStart: '2026-08-30T00:00:00.000Z',
            rangeEnd: '2026-09-06T00:00:00.000Z',
            events: [{ startsAt: '2026-08-30T10:00:00.000Z', endsAt: '2026-08-30T11:00:00.000Z' }],
        });
        expect(ok?.events).toHaveLength(1);

        expect(parseCalendarSyncInput({ rangeStart: 'x', rangeEnd: '2026-09-06T00:00:00.000Z', events: [] })).toBeNull();
        expect(parseCalendarSyncInput({
            rangeStart: '2026-09-06T00:00:00.000Z',
            rangeEnd: '2026-08-30T00:00:00.000Z',
            events: [],
        })).toBeNull();
        expect(parseCalendarSyncInput({
            rangeStart: '2026-08-30T00:00:00.000Z',
            rangeEnd: '2026-09-06T00:00:00.000Z',
            events: Array.from({ length: TDAH_DND_MAX_CALENDAR_EVENTS + 1 }, () => ({
                startsAt: '2026-08-30T10:00:00.000Z',
                endsAt: '2026-08-30T11:00:00.000Z',
            })),
        })).toBeNull();
    });

    test('settings accept only booleans and HH:mm, and leave omitted fields undefined for the merge', () => {
        expect(parseDndSettingsInput({ calendarEnabled: true })).toEqual({ calendarEnabled: true });
        expect(parseDndSettingsInput({ workStart: '08:30', workEnd: '17:00' })).toEqual({ workStart: '08:30', workEnd: '17:00' });
        expect(parseDndSettingsInput({})).toEqual({});
        expect(parseDndSettingsInput({ calendarEnabled: 'yes' })).toBeNull();
        expect(parseDndSettingsInput({ workStart: '8:30' })).toBeNull();
        expect(parseDndSettingsInput(null)).toBeNull();
    });
});

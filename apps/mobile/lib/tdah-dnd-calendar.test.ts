import { beforeEach, describe, expect, it, vi } from 'vitest';

// The test-time react-native shim reports `Platform.OS === 'web'`, which is
// exactly the platform this module refuses to read calendars on — override it
// so the real observation path is the one under test.
vi.mock('react-native', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('react-native');
    return { ...actual, Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios } };
});

const permission = vi.hoisted(() => ({ status: 'granted' as 'granted' | 'denied' | 'undetermined' }));
vi.mock('./external-calendar', () => ({
    getSystemCalendarPermissionStatus: async () => permission.status,
}));

const calendarApi = vi.hoisted(() => ({
    calendars: [] as unknown[],
    events: [] as unknown[],
    getEventsArgs: [] as unknown[][],
    throwOnEvents: false,
}));

vi.mock('expo-calendar', () => ({
    EntityTypes: { EVENT: 'event' },
    Availability: { NOT_SUPPORTED: 'notSupported', BUSY: 'busy', FREE: 'free', TENTATIVE: 'tentative', UNAVAILABLE: 'unavailable' },
    EventStatus: { NONE: 'none', CONFIRMED: 'confirmed', TENTATIVE: 'tentative', CANCELED: 'canceled' },
    getCalendarsAsync: async () => calendarApi.calendars,
    getEventsAsync: async (...args: unknown[]) => {
        calendarApi.getEventsArgs.push(args);
        if (calendarApi.throwOnEvents) throw new Error('calendar blew up with "Reunión de líderes" in the message');
        return calendarApi.events;
    },
}));

import { TDAH_DND_MAX_CALENDAR_EVENTS, collectBusyCalendarEvents } from './tdah-dnd-calendar';

const RANGE_START = new Date('2026-08-28T00:00:00.000Z');
const RANGE_END = new Date('2026-09-04T00:00:00.000Z');

const busyEvent = (overrides: Record<string, unknown> = {}) => ({
    id: 'evt-1',
    calendarId: 'cal-1',
    title: 'Junta de líderes',
    startDate: '2026-08-28T16:00:00.000Z',
    endDate: '2026-08-28T17:00:00.000Z',
    allDay: false,
    availability: 'busy',
    status: 'confirmed',
    ...overrides,
});

const collect = () => collectBusyCalendarEvents(RANGE_START, RANGE_END);

beforeEach(() => {
    permission.status = 'granted';
    calendarApi.calendars = [{ id: 'cal-1', title: 'Trabajo' }];
    calendarApi.events = [busyEvent()];
    calendarApi.getEventsArgs = [];
    calendarApi.throwOnEvents = false;
});

describe('collectBusyCalendarEvents (story 4.3 — the phone only observes)', () => {
    // The single most load-bearing assertion of the mobile half of this
    // story (AD-8): what leaves the phone is the raw absolute instant, with
    // no zone conversion, no working-hours clipping and no local-midnight
    // split — all of which are the server's job.
    it('uploads raw UTC instants, verbatim', async () => {
        const events = await collect();
        expect(events).toEqual([
            { startsAt: '2026-08-28T16:00:00.000Z', endsAt: '2026-08-28T17:00:00.000Z' },
        ]);
    });

    it('does not clip an event that starts before the range or reaches past it', async () => {
        calendarApi.events = [busyEvent({
            startDate: '2026-08-27T22:00:00.000Z',
            endDate: '2026-09-05T02:00:00.000Z',
        })];
        expect(await collect()).toEqual([
            { startsAt: '2026-08-27T22:00:00.000Z', endsAt: '2026-09-05T02:00:00.000Z' },
        ]);
    });

    it('accepts a Date instance from the native module as readily as an ISO string', async () => {
        calendarApi.events = [busyEvent({
            startDate: new Date('2026-08-28T16:00:00.000Z'),
            endDate: new Date('2026-08-28T17:00:00.000Z'),
        })];
        expect(await collect()).toEqual([
            { startsAt: '2026-08-28T16:00:00.000Z', endsAt: '2026-08-28T17:00:00.000Z' },
        ]);
    });

    it('passes the caller\'s range straight through to expo-calendar', async () => {
        await collect();
        expect(calendarApi.getEventsArgs[0]).toEqual([['cal-1'], RANGE_START, RANGE_END]);
    });

    describe('what counts as busy', () => {
        it('drops an event the calendar marks free', async () => {
            calendarApi.events = [busyEvent({ availability: 'free' })];
            expect(await collect()).toEqual([]);
        });

        it('drops an all-day event', async () => {
            calendarApi.events = [busyEvent({ allDay: true })];
            expect(await collect()).toEqual([]);
        });

        it('drops a cancelled event', async () => {
            calendarApi.events = [busyEvent({ status: 'canceled' })];
            expect(await collect()).toEqual([]);
        });

        // Android routinely reports no availability at all; treating that as
        // free would quietly disable DND on most Android calendars.
        it('keeps an event with no availability reported at all', async () => {
            calendarApi.events = [busyEvent({ availability: undefined })];
            expect(await collect()).toHaveLength(1);
        });

        it('keeps a tentative event', async () => {
            calendarApi.events = [busyEvent({ availability: 'tentative' })];
            expect(await collect()).toHaveLength(1);
        });

        // Unlike the timeline's own reader, nothing here may invent an end:
        // an invented duration is an invented silence.
        it('drops an event with no usable end rather than fabricating one', async () => {
            calendarApi.events = [
                busyEvent({ id: 'a', endDate: null }),
                busyEvent({ id: 'b', endDate: '2026-08-28T16:00:00.000Z' }),
                busyEvent({ id: 'c', endDate: '2026-08-28T15:00:00.000Z' }),
            ];
            expect(await collect()).toEqual([]);
        });

        it('drops an event with an unparseable start', async () => {
            calendarApi.events = [busyEvent({ startDate: 'not-a-date' })];
            expect(await collect()).toEqual([]);
        });
    });

    describe('which calendars it reads', () => {
        it("skips Mindwtr's own mirror calendar, whose events are GTD tasks, not meetings", async () => {
            calendarApi.calendars = [{ id: 'cal-1', title: 'Trabajo' }, { id: 'cal-mirror', title: 'Mindwtr' }];
            await collect();
            expect(calendarApi.getEventsArgs[0][0]).toEqual(['cal-1']);
        });

        it('falls back to the legacy `name` field when a calendar has no title', async () => {
            calendarApi.calendars = [{ id: 'cal-mirror', name: 'Mindwtr Calendar' }];
            expect(await collect()).toEqual([]);
            expect(calendarApi.getEventsArgs).toHaveLength(0);
        });

        it('returns nothing when every calendar is filtered out', async () => {
            calendarApi.calendars = [];
            expect(await collect()).toEqual([]);
        });
    });

    describe('degrading without noise', () => {
        it('returns nothing when the calendar permission is not granted', async () => {
            permission.status = 'denied';
            expect(await collect()).toEqual([]);
            expect(calendarApi.getEventsArgs).toHaveLength(0);
        });

        it('returns nothing while the permission is still undetermined', async () => {
            permission.status = 'undetermined';
            expect(await collect()).toEqual([]);
        });

        it('returns nothing for an empty or reversed range', async () => {
            expect(await collectBusyCalendarEvents(RANGE_END, RANGE_START)).toEqual([]);
            expect(await collectBusyCalendarEvents(RANGE_START, RANGE_START)).toEqual([]);
        });

        // A raw calendar error can embed event titles and account names; it
        // must never escape this module.
        it('swallows a native failure instead of letting calendar data surface', async () => {
            calendarApi.throwOnEvents = true;
            await expect(collect()).resolves.toEqual([]);
        });
    });

    describe('ordering and the upload cap', () => {
        it('returns the events oldest-first', async () => {
            calendarApi.events = [
                busyEvent({ id: 'late', startDate: '2026-08-28T18:00:00.000Z', endDate: '2026-08-28T19:00:00.000Z' }),
                busyEvent({ id: 'early', startDate: '2026-08-28T09:00:00.000Z', endDate: '2026-08-28T10:00:00.000Z' }),
            ];
            const events = await collect();
            expect(events.map((event) => event.startsAt)).toEqual([
                '2026-08-28T09:00:00.000Z',
                '2026-08-28T18:00:00.000Z',
            ]);
        });

        it('caps the upload and keeps the soonest meetings, never the farthest', async () => {
            calendarApi.events = Array.from({ length: TDAH_DND_MAX_CALENDAR_EVENTS + 25 }, (_value, index) => {
                const day = String(1 + (index % 28)).padStart(2, '0');
                const hour = String(index % 24).padStart(2, '0');
                return busyEvent({
                    id: `evt-${index}`,
                    startDate: `2026-09-${day}T${hour}:00:00.000Z`,
                    endDate: `2026-09-${day}T${hour}:30:00.000Z`,
                });
            });
            const events = await collect();
            expect(events).toHaveLength(TDAH_DND_MAX_CALENDAR_EVENTS);
            expect(events[0].startsAt).toBe('2026-09-01T00:00:00.000Z');
        });
    });
});

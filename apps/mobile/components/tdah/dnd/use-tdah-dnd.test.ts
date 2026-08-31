import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The shim reports `Platform.OS === 'web'`, where calendar reading is
// permanently unavailable (the PWA's state, doc 06) — override it so the
// phone path is the one under test.
vi.mock('react-native', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('react-native');
    return { ...actual, Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios } };
});

const cloud = vi.hoisted(() => ({
    get: vi.fn(),
    request: vi.fn(),
}));

vi.mock('@mindwtr/core', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('@mindwtr/core');
    return {
        ...actual,
        cloudGetJson: (...args: unknown[]) => cloud.get(...args),
        cloudRequestJson: (...args: unknown[]) => cloud.request(...args),
    };
});

const config = vi.hoisted(() => ({ value: { url: 'https://sync.example.com', token: 'tok', allowInsecureHttp: false } as unknown }));

vi.mock('./tdah-dnd-cloud', () => ({
    loadTdahCloudConfig: async () => config.value,
    buildTdahRequestOptions: () => ({ token: 'tok' }),
    buildTdahDndUrl: () => 'https://sync.example.com/v1/tdah/dnd',
    buildTdahDndWindowsUrl: () => 'https://sync.example.com/v1/tdah/dnd/windows',
    buildTdahDndWindowUrl: (_url: string, id: string) => `https://sync.example.com/v1/tdah/dnd/windows/${id}`,
    buildTdahDndCalendarUrl: () => 'https://sync.example.com/v1/tdah/dnd/calendar',
}));

const calendar = vi.hoisted(() => ({
    permission: 'granted' as 'granted' | 'denied' | 'undetermined',
    requested: 'granted' as 'granted' | 'denied' | 'undetermined',
    requestCalls: 0,
    events: [] as { startsAt: string; endsAt: string }[],
    collectCalls: [] as Date[][],
}));

vi.mock('@/lib/external-calendar', () => ({
    getSystemCalendarPermissionStatus: async () => calendar.permission,
    requestSystemCalendarPermission: async () => {
        calendar.requestCalls += 1;
        calendar.permission = calendar.requested;
        return calendar.requested;
    },
}));

vi.mock('@/lib/tdah-dnd-calendar', () => ({
    collectBusyCalendarEvents: async (rangeStart: Date, rangeEnd: Date) => {
        calendar.collectCalls.push([rangeStart, rangeEnd]);
        return calendar.events;
    },
}));

import { CloudHttpError } from '@mindwtr/core';

import type { TdahDndResponse, TdahDndWindow } from './tdah-dnd-types';
import {
    TDAH_DND_CALENDAR_HORIZON_MS,
    TDAH_DND_CALENDAR_LOOKBACK_MS,
    useTdahDnd,
    type UseTdahDndResult,
} from './use-tdah-dnd';

const manualWindow: TdahDndWindow = {
    id: 'w-manual',
    source: 'manual',
    kind: 'weekly',
    weekdays: [1],
    date: null,
    startTime: '10:00',
    endTime: '11:00',
    label: 'Junta de líderes',
};

const calendarWindow: TdahDndWindow = {
    id: 'w-calendar',
    source: 'calendar',
    kind: 'once',
    weekdays: null,
    date: '2026-08-28',
    startTime: '10:30',
    endTime: '12:00',
    label: null,
};

const state = (overrides: Partial<TdahDndResponse> = {}): TdahDndResponse => ({
    settings: { calendarEnabled: false, workStart: '09:00', workEnd: '18:00' },
    windows: [manualWindow],
    activeUntil: null,
    ...overrides,
});

let latest: UseTdahDndResult;

const Probe = (): null => {
    latest = useTdahDnd();
    return null;
};

const mount = async (): Promise<ReactTestRenderer> => {
    let tree!: ReactTestRenderer;
    await act(async () => {
        tree = create(React.createElement(Probe));
    });
    return tree;
};

const mountAndLoad = async (): Promise<ReactTestRenderer> => {
    const tree = await mount();
    await act(async () => { await latest.reload(); });
    return tree;
};

const requestsTo = (url: string) => cloud.request.mock.calls.filter((call) => call[1] === url);

beforeEach(() => {
    cloud.get.mockReset().mockResolvedValue(state());
    cloud.request.mockReset().mockResolvedValue({});
    config.value = { url: 'https://sync.example.com', token: 'tok', allowInsecureHttp: false };
    calendar.permission = 'granted';
    calendar.requested = 'granted';
    calendar.requestCalls = 0;
    calendar.events = [];
    calendar.collectCalls = [];
});

describe('useTdahDnd', () => {
    describe('loading the state', () => {
        it('applies the server state verbatim and lands on ready', async () => {
            cloud.get.mockResolvedValue(state({
                settings: { calendarEnabled: true, workStart: '08:30', workEnd: '17:00' },
                windows: [manualWindow, calendarWindow],
                activeUntil: '12:00',
            }));
            await mountAndLoad();

            expect(latest.phase).toBe('ready');
            expect(latest.settings).toEqual({ calendarEnabled: true, workStart: '08:30', workEnd: '17:00' });
            expect(latest.windows).toEqual([manualWindow, calendarWindow]);
            // AD-8: `activeUntil` is the server's own answer, never anything
            // this hook recomputes from `windows` — note the two windows above
            // do not, on their own, imply 12:00 for any particular "now".
            expect(latest.activeUntil).toBe('12:00');
        });

        it('reads a missing activeUntil as "no window active"', async () => {
            cloud.get.mockResolvedValue({ ...state(), activeUntil: undefined });
            await mountAndLoad();
            expect(latest.activeUntil).toBeNull();
        });

        // DW-102: `activeUntil` is a bare "HH:mm", so T-12 needs the zone the
        // server resolved it against to know when it has passed. AD-6 makes
        // that zone editable and free to disagree with the device's.
        it('exposes the profile zone the server resolved activeUntil against', async () => {
            cloud.get.mockResolvedValue(state({ activeUntil: '12:00', timeZone: 'Asia/Tokyo' }));
            await mountAndLoad();
            expect(latest.timeZone).toBe('Asia/Tokyo');
        });

        it('falls back to the device zone when the server sends none', async () => {
            cloud.get.mockResolvedValue({ ...state(), timeZone: undefined });
            await mountAndLoad();
            expect(latest.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
        });

        it('is unconfigured when Self-Hosted sync is not set up', async () => {
            config.value = null;
            await mountAndLoad();
            expect(latest.phase).toBe('unconfigured');
            expect(cloud.get).not.toHaveBeenCalled();
        });

        // Modo TDAH off: every /v1/tdah/dnd* route answers 409
        // TDAH_ACTIVATE_REQUIRED, and CloudHttpError still carries no body
        // code (deferred from 4.2), so the status is what maps it.
        it('is inactive on a 409, not a generic error', async () => {
            cloud.get.mockRejectedValue(new CloudHttpError('activate required', 409));
            await mountAndLoad();
            expect(latest.phase).toBe('inactive');
        });

        it('is error on any other server status', async () => {
            cloud.get.mockRejectedValue(new CloudHttpError('boom', 500));
            await mountAndLoad();
            expect(latest.phase).toBe('error');
        });

        it('is offline when the request never reached the server', async () => {
            cloud.get.mockRejectedValue(new Error('network unreachable'));
            await mountAndLoad();
            expect(latest.phase).toBe('offline');
        });

        it('is error, never offline, for a malformed body', async () => {
            cloud.get.mockResolvedValue({ windows: 'nope' });
            await mountAndLoad();
            expect(latest.phase).toBe('error');
        });

        it('lets the newest reload win when a stale one resolves later', async () => {
            await mount();
            let resolveStale: ((value: unknown) => void) | undefined;
            cloud.get.mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }));
            cloud.get.mockResolvedValueOnce(state({ activeUntil: '11:00' }));

            await act(async () => {
                const stale = latest.reload();
                await latest.reload();
                resolveStale?.(state({ activeUntil: '09:00' }));
                await stale;
            });

            expect(latest.activeUntil).toBe('11:00');
        });
    });

    describe('the calendar upload (AD-8: the phone only observes)', () => {
        it('uploads the raw instants and the observed range when detection is on and allowed', async () => {
            cloud.get.mockResolvedValue(state({ settings: { calendarEnabled: true, workStart: '09:00', workEnd: '18:00' } }));
            calendar.events = [{ startsAt: '2026-08-28T16:00:00.000Z', endsAt: '2026-08-28T17:00:00.000Z' }];
            const before = Date.now();
            await mountAndLoad();

            const [call] = requestsTo('https://sync.example.com/v1/tdah/dnd/calendar');
            expect(call[0]).toBe('PUT');
            const body = call[2] as { rangeStart: string; rangeEnd: string; events: unknown[] };
            expect(body.events).toEqual(calendar.events);
            expect(Date.parse(body.rangeStart)).toBeGreaterThanOrEqual(before - TDAH_DND_CALENDAR_LOOKBACK_MS - 5_000);
            expect(Date.parse(body.rangeEnd) - Date.parse(body.rangeStart))
                .toBe(TDAH_DND_CALENDAR_LOOKBACK_MS + TDAH_DND_CALENDAR_HORIZON_MS);
            // The range the observer was asked for is the range that was
            // uploaded — nothing in between reinterprets it.
            expect(calendar.collectCalls[0][0].toISOString()).toBe(body.rangeStart);
            expect(calendar.collectCalls[0][1].toISOString()).toBe(body.rangeEnd);
        });

        it('re-reads the state after uploading, so activeUntil comes from the server', async () => {
            cloud.get
                .mockResolvedValueOnce(state({ settings: { calendarEnabled: true, workStart: '09:00', workEnd: '18:00' } }))
                .mockResolvedValueOnce(state({
                    settings: { calendarEnabled: true, workStart: '09:00', workEnd: '18:00' },
                    windows: [manualWindow, calendarWindow],
                    activeUntil: '12:00',
                }));
            await mountAndLoad();
            expect(latest.activeUntil).toBe('12:00');
            expect(latest.windows).toHaveLength(2);
        });

        it('uploads nothing when detection is off', async () => {
            await mountAndLoad();
            expect(requestsTo('https://sync.example.com/v1/tdah/dnd/calendar')).toHaveLength(0);
        });

        it('uploads nothing when the permission is not granted — manual windows still load', async () => {
            calendar.permission = 'denied';
            cloud.get.mockResolvedValue(state({ settings: { calendarEnabled: true, workStart: '09:00', workEnd: '18:00' } }));
            await mountAndLoad();

            expect(latest.phase).toBe('ready');
            expect(latest.permission).toBe('denied');
            expect(latest.windows).toEqual([manualWindow]);
            expect(requestsTo('https://sync.example.com/v1/tdah/dnd/calendar')).toHaveLength(0);
        });

        it('degrades to a tagged error instead of taking the loaded screen down', async () => {
            cloud.get.mockResolvedValue(state({ settings: { calendarEnabled: true, workStart: '09:00', workEnd: '18:00' } }));
            cloud.request.mockRejectedValue(new Error('network unreachable'));
            await mountAndLoad();

            expect(latest.phase).toBe('ready');
            expect(latest.mutationError).toBe('calendar');
            expect(latest.calendarSyncing).toBe(false);
        });

        it('asks for the permission before turning detection on', async () => {
            calendar.permission = 'denied';
            calendar.requested = 'granted';
            await mountAndLoad();

            await act(async () => { await latest.setCalendarEnabled(true); });

            expect(calendar.requestCalls).toBe(1);
            const [settingsCall] = requestsTo('https://sync.example.com/v1/tdah/dnd');
            expect(settingsCall[0]).toBe('PUT');
            expect(settingsCall[2]).toEqual({ calendarEnabled: true, workStart: '09:00', workEnd: '18:00' });
            expect(requestsTo('https://sync.example.com/v1/tdah/dnd/calendar')).toHaveLength(1);
        });

        it('does not persist calendarEnabled when the OS prompt is denied', async () => {
            calendar.permission = 'undetermined';
            calendar.requested = 'denied';
            await mountAndLoad();

            let applied = true;
            await act(async () => { applied = await latest.setCalendarEnabled(true); });

            // The prompt was shown and refused, so nothing is written: a
            // persisted `true` would leave the switch reading "on" over a
            // detection that can never upload anything.
            expect(calendar.requestCalls).toBe(1);
            expect(applied).toBe(false);
            expect(requestsTo('https://sync.example.com/v1/tdah/dnd')).toHaveLength(0);
            expect(requestsTo('https://sync.example.com/v1/tdah/dnd/calendar')).toHaveLength(0);
            expect(latest.settings.calendarEnabled).toBe(false);
            // A denied permission is a legitimate choice, not a failure: the
            // screen's own blame-free denied block carries it, not an error tag.
            expect(latest.mutationError).toBeNull();
            expect(latest.permission).toBe('denied');
        });

        it('still turns detection off while the permission is denied', async () => {
            cloud.get.mockResolvedValue(state({
                settings: { calendarEnabled: true, workStart: '09:00', workEnd: '18:00' },
            }));
            calendar.permission = 'denied';
            calendar.requested = 'denied';
            await mountAndLoad();

            let applied = false;
            await act(async () => { applied = await latest.setCalendarEnabled(false); });

            expect(applied).toBe(true);
            const [settingsCall] = requestsTo('https://sync.example.com/v1/tdah/dnd');
            expect(settingsCall?.[0]).toBe('PUT');
            expect(settingsCall?.[2]).toEqual({ calendarEnabled: false, workStart: '09:00', workEnd: '18:00' });
        });

        it('never asks for the permission just to turn detection off', async () => {
            await mountAndLoad();
            await act(async () => { await latest.setCalendarEnabled(false); });
            expect(calendar.requestCalls).toBe(0);
        });
    });

    describe('manual window CRUD', () => {
        const input = {
            kind: 'weekly' as const,
            weekdays: [1, 3],
            date: null,
            startTime: '10:00',
            endTime: '11:00',
            label: 'Junta',
        };

        it('creates through POST and re-reads the whole state afterwards', async () => {
            await mountAndLoad();
            cloud.get.mockResolvedValueOnce(state({ windows: [manualWindow, { ...manualWindow, id: 'w-2' }] }));

            let applied = false;
            await act(async () => { applied = await latest.createWindow(input); });

            expect(applied).toBe(true);
            const [call] = requestsTo('https://sync.example.com/v1/tdah/dnd/windows');
            expect(call[0]).toBe('POST');
            expect(call[2]).toEqual(input);
            expect(latest.windows).toHaveLength(2);
            expect(latest.mutationError).toBeNull();
        });

        // A 409 on a create, once the screen has already loaded, can only be
        // the manual-window cap (TDAH_DND_LIMIT).
        it('reports the manual-window cap on a 409 and keeps the list untouched', async () => {
            await mountAndLoad();
            cloud.request.mockRejectedValueOnce(new CloudHttpError('limit', 409));

            let applied = true;
            await act(async () => { applied = await latest.createWindow(input); });

            expect(applied).toBe(false);
            expect(latest.mutationError).toBe('windowLimit');
            expect(latest.windows).toEqual([manualWindow]);
        });

        it('reports a plain save failure separately from the cap', async () => {
            await mountAndLoad();
            cloud.request.mockRejectedValueOnce(new Error('network unreachable'));

            await act(async () => { await latest.createWindow(input); });
            expect(latest.mutationError).toBe('windowSave');
        });

        it('edits through PUT on the window\'s own URL', async () => {
            await mountAndLoad();
            await act(async () => { await latest.updateWindow('w-manual', input); });

            const [call] = requestsTo('https://sync.example.com/v1/tdah/dnd/windows/w-manual');
            expect(call[0]).toBe('PUT');
            expect(call[2]).toEqual(input);
        });

        it('deletes through DELETE and tags its own failure', async () => {
            await mountAndLoad();
            await act(async () => { await latest.deleteWindow('w-manual'); });
            expect(requestsTo('https://sync.example.com/v1/tdah/dnd/windows/w-manual')[0][0]).toBe('DELETE');

            cloud.request.mockRejectedValueOnce(new Error('network unreachable'));
            await act(async () => { await latest.deleteWindow('w-manual'); });
            expect(latest.mutationError).toBe('windowDelete');
        });

        it('clears a previous mutation error on the next successful mutation', async () => {
            await mountAndLoad();
            cloud.request.mockRejectedValueOnce(new Error('network unreachable'));
            await act(async () => { await latest.deleteWindow('w-manual'); });
            expect(latest.mutationError).toBe('windowDelete');

            await act(async () => { await latest.createWindow(input); });
            expect(latest.mutationError).toBeNull();
        });
    });

    describe('working hours', () => {
        it('PUTs the range while preserving the calendar flag', async () => {
            cloud.get.mockResolvedValue(state({ settings: { calendarEnabled: true, workStart: '09:00', workEnd: '18:00' } }));
            calendar.permission = 'denied';
            await mountAndLoad();

            await act(async () => { await latest.saveWorkingHours('08:00', '16:30'); });

            const [call] = requestsTo('https://sync.example.com/v1/tdah/dnd');
            expect(call[0]).toBe('PUT');
            expect(call[2]).toEqual({ calendarEnabled: true, workStart: '08:00', workEnd: '16:30' });
        });

        it('tags its own failure so the screen can say which control failed', async () => {
            await mountAndLoad();
            cloud.request.mockRejectedValueOnce(new Error('network unreachable'));
            await act(async () => { await latest.saveWorkingHours('08:00', '16:30'); });
            expect(latest.mutationError).toBe('workingHours');
        });
    });
});

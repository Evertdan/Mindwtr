import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getTdahConnectionState,
    subscribeTdahConnectionReconnected,
    subscribeTdahConnectionState,
    useRootLayoutTdahConnection,
} from '@/hooks/root-layout/use-root-layout-tdah-connection';

type FakeConnectionState = { status: 'connected' | 'reconnecting' | 'offline'; consecutiveFailures: number };

const {
    appState,
    appStateListeners,
    fakeHandles,
    INITIAL_STATE,
    isPersistentConnectionSupportedMock,
    startPersistentConnectionMock,
    tdahModeActiveMock,
    showTdahActivityNotificationMock,
    showTdahRitualNotificationMock,
    showTdahWorkBandNotificationMock,
} = vi.hoisted(() => ({
    appState: { currentState: 'active' as 'active' | 'background' | 'inactive' },
    appStateListeners: new Set<(state: 'active' | 'background' | 'inactive') => void>(),
    fakeHandles: [] as Array<{
        options: any;
        getState: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        listeners: Set<(state: FakeConnectionState) => void>;
    }>,
    INITIAL_STATE: { status: 'reconnecting', consecutiveFailures: 0 } as FakeConnectionState,
    isPersistentConnectionSupportedMock: vi.fn(() => true),
    startPersistentConnectionMock: vi.fn(),
    tdahModeActiveMock: vi.fn((_refreshKey?: unknown) => false),
    showTdahActivityNotificationMock: vi.fn<(request: {
        key: string;
        title: string;
        message?: string;
        vibrationPattern: number[];
        actionLabels: { start: string; complete: string; snooze: string };
        channelName: string;
        data: Record<string, string>;
    }) => Promise<void>>(async () => undefined),
    showTdahRitualNotificationMock: vi.fn<(request: {
        key: string;
        title: string;
        message?: string;
        vibrationPattern: number[];
        channelName: string;
        data: Record<string, string>;
    }) => Promise<void>>(async () => undefined),
    showTdahWorkBandNotificationMock: vi.fn<(request: {
        key: string;
        title: string;
        message?: string;
        vibrationPattern: number[];
        channelName: string;
        data: Record<string, string>;
    }) => Promise<void>>(async () => undefined),
}));

vi.mock('@/lib/notification-service-local', () => ({
    showTdahActivityNotification: showTdahActivityNotificationMock,
    showTdahRitualNotification: showTdahRitualNotificationMock,
    showTdahWorkBandNotification: showTdahWorkBandNotificationMock,
}));

vi.mock('react-native', async () => {
    const actual = await vi.importActual<typeof import('react-native')>('react-native');
    return {
        ...actual,
        AppState: {
            get currentState() {
                return appState.currentState;
            },
            addEventListener: vi.fn((_event: string, listener: (state: 'active' | 'background' | 'inactive') => void) => {
                appStateListeners.add(listener);
                return { remove: () => appStateListeners.delete(listener) };
            }),
        },
    };
});

vi.mock('@/lib/persistent-connection', () => ({
    INITIAL_TDAH_CONNECTION_STATE: INITIAL_STATE,
    isPersistentConnectionSupported: () => isPersistentConnectionSupportedMock(),
    startPersistentConnection: (options: any) => {
        const listeners = new Set<(state: FakeConnectionState) => void>();
        const state: FakeConnectionState = { status: 'reconnecting', consecutiveFailures: 0 };
        const handle = {
            getState: vi.fn(() => state),
            subscribe: vi.fn((listener: (nextState: FakeConnectionState) => void) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            }),
            stop: vi.fn(),
        };
        fakeHandles.push({ options, getState: handle.getState, stop: handle.stop, listeners });
        startPersistentConnectionMock(options);
        return handle;
    },
}));

vi.mock('@/components/tdah/today/use-tdah-mode-active', () => ({
    useTdahModeActive: (refreshKey: unknown) => tdahModeActiveMock(refreshKey),
}));

function TestHarness({ resolveText }: { resolveText?: (key: string, fallback: string) => string }) {
    useRootLayoutTdahConnection({ resolveText: resolveText ?? ((_key, fallback) => fallback) });
    return null;
}

let tree: ReactTestRenderer | null = null;

describe('useRootLayoutTdahConnection', () => {
    beforeEach(() => {
        appState.currentState = 'active';
        appStateListeners.clear();
        fakeHandles.length = 0;
        isPersistentConnectionSupportedMock.mockReset();
        isPersistentConnectionSupportedMock.mockReturnValue(true);
        startPersistentConnectionMock.mockReset();
        tdahModeActiveMock.mockReset();
        tdahModeActiveMock.mockReturnValue(false);
        showTdahActivityNotificationMock.mockReset();
        showTdahActivityNotificationMock.mockResolvedValue(undefined);
        showTdahRitualNotificationMock.mockReset();
        showTdahRitualNotificationMock.mockResolvedValue(undefined);
        showTdahWorkBandNotificationMock.mockReset();
        showTdahWorkBandNotificationMock.mockResolvedValue(undefined);
    });

    afterEach(() => {
        if (tree) act(() => tree?.unmount());
        tree = null;
        vi.useRealTimers();
    });

    it('never starts the channel on a platform that does not support it, and never polls the mode flag', async () => {
        isPersistentConnectionSupportedMock.mockReturnValue(false);
        await act(async () => { tree = create(<TestHarness />); });

        expect(tdahModeActiveMock).toHaveBeenCalledWith(undefined);
        expect(startPersistentConnectionMock).not.toHaveBeenCalled();
        expect(appStateListeners.size).toBe(0);
    });

    it('does not start the channel while Modo TDAH is off', async () => {
        tdahModeActiveMock.mockReturnValue(false);
        await act(async () => { tree = create(<TestHarness />); });

        expect(startPersistentConnectionMock).not.toHaveBeenCalled();
    });

    it('starts the channel when Modo TDAH is active, publishing the handle state via the module singleton', async () => {
        tdahModeActiveMock.mockReturnValue(true);
        await act(async () => { tree = create(<TestHarness />); });

        expect(startPersistentConnectionMock).toHaveBeenCalledTimes(1);
        expect(fakeHandles).toHaveLength(1);
        expect(getTdahConnectionState()).toEqual(INITIAL_STATE);
    });

    it('stops the channel and resets the published state once Modo TDAH turns off (survives navigation, not screen-scoped)', async () => {
        let modeActive = true;
        tdahModeActiveMock.mockImplementation(() => modeActive);
        await act(async () => { tree = create(<TestHarness />); });
        expect(fakeHandles).toHaveLength(1);
        const handle = fakeHandles[0];

        modeActive = false;
        // A foreground transition bumps the poll tick, re-rendering the hook
        // and re-evaluating useTdahModeActive with the latest value — this is
        // the same idiom the root layout uses; no screen mount/unmount is
        // involved at all.
        await act(async () => {
            appStateListeners.forEach((listener) => listener('active'));
        });

        expect(handle.stop).toHaveBeenCalledTimes(1);
        expect(getTdahConnectionState()).toEqual(INITIAL_STATE);
    });

    it('stops the channel on unmount', async () => {
        tdahModeActiveMock.mockReturnValue(true);
        await act(async () => { tree = create(<TestHarness />); });
        const handle = fakeHandles[0];

        await act(async () => { tree?.unmount(); });
        tree = null;

        expect(handle.stop).toHaveBeenCalledTimes(1);
    });

    it('re-polls the mode flag on every foreground transition, not only on mount', async () => {
        tdahModeActiveMock.mockReturnValue(false);
        await act(async () => { tree = create(<TestHarness />); });
        expect(tdahModeActiveMock).toHaveBeenCalledWith(0);

        await act(async () => {
            appStateListeners.forEach((listener) => listener('active'));
        });
        expect(tdahModeActiveMock).toHaveBeenCalledWith(1);
    });

    it('re-polls the mode flag on a timer while the app stays foregrounded (no push signal exists for the flag)', async () => {
        vi.useFakeTimers();
        tdahModeActiveMock.mockReturnValue(false);
        await act(async () => { tree = create(<TestHarness />); });
        expect(tdahModeActiveMock).toHaveBeenCalledWith(0);

        await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
        expect(tdahModeActiveMock).toHaveBeenCalledWith(1);
    });

    it('builds the N-05 notification strings from resolveText, not raw keys', async () => {
        tdahModeActiveMock.mockReturnValue(true);
        const resolveText = vi.fn((_key: string, fallback: string) => `translated:${fallback}`);
        await act(async () => { tree = create(<TestHarness resolveText={resolveText} />); });

        expect(startPersistentConnectionMock).toHaveBeenCalledWith(expect.objectContaining({
            strings: expect.objectContaining({
                connectedTitle: 'translated:Mindwtr connected',
                connectedText: "translated:Your day's reminders are active",
            }),
        }));
    });

    it("notifies subscribeTdahConnectionReconnected listeners through the handle's onReconnected (AC: T-01 re-fetches on reconnect)", async () => {
        tdahModeActiveMock.mockReturnValue(true);
        await act(async () => { tree = create(<TestHarness />); });
        const { options } = fakeHandles[0];

        const reconnected = vi.fn();
        const unsubscribe = subscribeTdahConnectionReconnected(reconnected);
        act(() => { options.onReconnected(); });
        expect(reconnected).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it('publishes every handle state transition to subscribeTdahConnectionState listeners', async () => {
        tdahModeActiveMock.mockReturnValue(true);
        await act(async () => { tree = create(<TestHarness />); });
        const handle = fakeHandles[0];

        const listener = vi.fn();
        const unsubscribe = subscribeTdahConnectionState(listener);
        const nextState: FakeConnectionState = { status: 'connected', consecutiveFailures: 0 };
        act(() => {
            handle.listeners.forEach((subscribed) => subscribed(nextState));
        });
        expect(listener).toHaveBeenCalledWith(nextState);
        unsubscribe();
    });

    describe('story 2.2 — activity-trigger WS message -> local notification', () => {
        it('shows a start notification with the "{Actividad} — {duración}" title, 2-short-pulse haptics, and no truncation', async () => {
            tdahModeActiveMock.mockReturnValue(true);
            await act(async () => { tree = create(<TestHarness />); });
            const { options } = fakeHandles[0];

            const longTitle = 'Preparar la presentación completa para la reunión trimestral de todo el equipo';
            await act(async () => {
                options.onMessage(JSON.stringify({
                    kind: 'activity-trigger',
                    edge: 'start',
                    activityId: 42,
                    title: longTitle,
                    durationMinutes: 25,
                }));
            });

            expect(showTdahActivityNotificationMock).toHaveBeenCalledTimes(1);
            const request = showTdahActivityNotificationMock.mock.calls[0][0];
            expect(request.key).toBe('tdah-activity:42:start');
            expect(request.title).toBe(`${longTitle} — 25 min`);
            expect(request.title).not.toContain('…');
            expect(request.vibrationPattern).toEqual([0, 120, 120, 120]);
            expect(request.data).toMatchObject({ kind: 'tdah-activity', context: '42', edge: 'start' });
        });

        it('shows an end notification with the 1-long-pulse haptic pattern', async () => {
            tdahModeActiveMock.mockReturnValue(true);
            await act(async () => { tree = create(<TestHarness />); });
            const { options } = fakeHandles[0];

            await act(async () => {
                options.onMessage(JSON.stringify({
                    kind: 'activity-trigger',
                    edge: 'end',
                    activityId: 7,
                    title: 'Llamar al banco',
                    durationMinutes: 15,
                }));
            });

            expect(showTdahActivityNotificationMock).toHaveBeenCalledTimes(1);
            const request = showTdahActivityNotificationMock.mock.calls[0][0];
            expect(request.key).toBe('tdah-activity:7:end');
            expect(request.vibrationPattern).toEqual([0, 650]);
            expect(request.data).toMatchObject({ kind: 'tdah-activity', context: '7', edge: 'end' });
        });

        it('resolves the 3 action labels through resolveText instead of raw keys', async () => {
            tdahModeActiveMock.mockReturnValue(true);
            const resolveText = vi.fn((_key: string, fallback: string) => `translated:${fallback}`);
            await act(async () => { tree = create(<TestHarness resolveText={resolveText} />); });
            const { options } = fakeHandles[0];

            await act(async () => {
                options.onMessage(JSON.stringify({
                    kind: 'activity-trigger', edge: 'start', activityId: 1, title: 'Foo', durationMinutes: 10,
                }));
            });

            const request = showTdahActivityNotificationMock.mock.calls[0][0];
            expect(request.actionLabels).toEqual({
                start: 'translated:Start',
                complete: 'translated:Complete',
                snooze: 'translated:Postpone +10 min',
            });
            expect(request.channelName).toBe('translated:Activity reminders');
        });

        it('ignores an unparseable message (e.g. story 2.1\'s own {kind: "connected"} event) without calling the notifier', async () => {
            tdahModeActiveMock.mockReturnValue(true);
            await act(async () => { tree = create(<TestHarness />); });
            const { options } = fakeHandles[0];

            await act(async () => {
                options.onMessage(JSON.stringify({ kind: 'connected', at: '2026-08-27T09:00:00.000Z' }));
            });

            expect(showTdahActivityNotificationMock).not.toHaveBeenCalled();
        });
    });

    describe('story 3.1 — ritual-invitation WS message -> local notification', () => {
        it('shows N-03 with the AC copy, the 3-soft-pulse haptics, and kind: tdah-ritual', async () => {
            tdahModeActiveMock.mockReturnValue(true);
            await act(async () => { tree = create(<TestHarness />); });
            const { options } = fakeHandles[0];

            await act(async () => {
                options.onMessage(JSON.stringify({ kind: 'ritual-invitation', at: '2026-08-27T05:00:00.000Z' }));
            });

            expect(showTdahRitualNotificationMock).toHaveBeenCalledTimes(1);
            const request = showTdahRitualNotificationMock.mock.calls[0][0];
            expect(request.key).toBe('tdah-ritual-invitation');
            expect(request.title).toBe('Close today — 10 minutes and tomorrow is ready');
            expect(request.vibrationPattern).toEqual([0, 150, 300, 150, 300, 150]);
            expect(request.data).toMatchObject({ kind: 'tdah-ritual' });
            expect(showTdahActivityNotificationMock).not.toHaveBeenCalled();
        });

        it('resolves the title and channel name through resolveText instead of raw keys', async () => {
            tdahModeActiveMock.mockReturnValue(true);
            const resolveText = vi.fn((_key: string, fallback: string) => `translated:${fallback}`);
            await act(async () => { tree = create(<TestHarness resolveText={resolveText} />); });
            const { options } = fakeHandles[0];

            await act(async () => {
                options.onMessage(JSON.stringify({ kind: 'ritual-invitation', at: '2026-08-27T05:00:00.000Z' }));
            });

            const request = showTdahRitualNotificationMock.mock.calls[0][0];
            expect(request.title).toBe('translated:Close today — 10 minutes and tomorrow is ready');
            expect(request.channelName).toBe('translated:Activity reminders');
        });

        it('ignores an unparseable message (e.g. an activity-trigger event) without calling the ritual notifier', async () => {
            tdahModeActiveMock.mockReturnValue(true);
            await act(async () => { tree = create(<TestHarness />); });
            const { options } = fakeHandles[0];

            await act(async () => {
                options.onMessage(JSON.stringify({
                    kind: 'activity-trigger', edge: 'start', activityId: 1, title: 'Foo', durationMinutes: 10,
                }));
            });

            expect(showTdahRitualNotificationMock).not.toHaveBeenCalled();
            expect(showTdahActivityNotificationMock).toHaveBeenCalledTimes(1);
        });
    });

    describe('story 4.2 — work-band WS message -> N-04', () => {
        const workBandEvent = {
            kind: 'work-band',
            activityId: 91,
            title: 'Sprint',
            startTime: '09:00',
            durationMinutes: 540,
            itemCount: 3,
            at: '2026-08-28T15:00:00.000Z',
        };

        // AC: "se emite exactamente una notificación con el conteo y un solo
        // pulso corto".
        it('shows N-04 with the count in the title, the single short pulse, and kind: tdah-work-band', async () => {
            tdahModeActiveMock.mockReturnValue(true);
            await act(async () => { tree = create(<TestHarness />); });
            const { options } = fakeHandles[0];

            await act(async () => { options.onMessage(JSON.stringify(workBandEvent)); });

            expect(showTdahWorkBandNotificationMock).toHaveBeenCalledTimes(1);
            const request = showTdahWorkBandNotificationMock.mock.calls[0][0];
            expect(request.key).toBe('tdah-work-band:91');
            expect(request.title).toBe('Sprint: 3 pending assigned tasks');
            expect(request.message).toBe('Your work band starts now.');
            expect(request.vibrationPattern).toEqual([0, 90]);
            expect(request.data).toMatchObject({ kind: 'tdah-work-band', context: '91' });
        });

        it('interpolates the real count, never a hard-coded one', async () => {
            tdahModeActiveMock.mockReturnValue(true);
            await act(async () => { tree = create(<TestHarness />); });
            const { options } = fakeHandles[0];

            await act(async () => {
                options.onMessage(JSON.stringify({ ...workBandEvent, itemCount: 11 }));
            });

            expect(showTdahWorkBandNotificationMock.mock.calls[0][0].title).toBe('Sprint: 11 pending assigned tasks');
        });

        it('resolves the title and body through resolveText instead of raw keys', async () => {
            tdahModeActiveMock.mockReturnValue(true);
            const resolveText = vi.fn((_key: string, fallback: string) => `translated:${fallback}`);
            await act(async () => { tree = create(<TestHarness resolveText={resolveText} />); });
            const { options } = fakeHandles[0];

            await act(async () => { options.onMessage(JSON.stringify(workBandEvent)); });

            const request = showTdahWorkBandNotificationMock.mock.calls[0][0];
            expect(request.title).toBe('translated:Sprint: 3 pending assigned tasks');
            expect(request.message).toBe('translated:Your work band starts now.');
            expect(request.channelName).toBe('translated:Activity reminders');
        });

        // Spec Always: the band fires N-04 and nothing else — never N-01/N-02
        // (the server drops it from the candidate query) and never N-03.
        it('fires only the work-band notifier, never the Activity or ritual one', async () => {
            tdahModeActiveMock.mockReturnValue(true);
            await act(async () => { tree = create(<TestHarness />); });
            const { options } = fakeHandles[0];

            await act(async () => { options.onMessage(JSON.stringify(workBandEvent)); });

            expect(showTdahActivityNotificationMock).not.toHaveBeenCalled();
            expect(showTdahRitualNotificationMock).not.toHaveBeenCalled();
        });

        it('leaves the other two events routed to their own handlers, unaffected by the third branch', async () => {
            tdahModeActiveMock.mockReturnValue(true);
            await act(async () => { tree = create(<TestHarness />); });
            const { options } = fakeHandles[0];

            await act(async () => {
                options.onMessage(JSON.stringify({
                    kind: 'activity-trigger', edge: 'start', activityId: 1, title: 'Foo', durationMinutes: 10,
                }));
                options.onMessage(JSON.stringify({ kind: 'ritual-invitation', at: '2026-08-28T05:00:00.000Z' }));
            });

            expect(showTdahActivityNotificationMock).toHaveBeenCalledTimes(1);
            expect(showTdahRitualNotificationMock).toHaveBeenCalledTimes(1);
            expect(showTdahWorkBandNotificationMock).not.toHaveBeenCalled();
        });

        it('ignores a malformed work-band payload rather than announcing a NaN count', async () => {
            tdahModeActiveMock.mockReturnValue(true);
            await act(async () => { tree = create(<TestHarness />); });
            const { options } = fakeHandles[0];

            await act(async () => {
                options.onMessage(JSON.stringify({ ...workBandEvent, itemCount: undefined }));
            });

            expect(showTdahWorkBandNotificationMock).not.toHaveBeenCalled();
        });
    });
});

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
});

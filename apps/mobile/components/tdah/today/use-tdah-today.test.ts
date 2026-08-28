import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTdahToday, type UseTdahTodayResult } from './use-tdah-today';

// Story 2.1's connection state machine lives in apps/mobile/lib/ (a sibling
// module, not this directory), but the spec's Verification section scopes
// its tests to `vitest run apps/mobile/components/tdah/today` — this file is
// the one pre-existing test file this story is allowed to extend, so the
// pure-state-machine and connection-lifecycle tests below live here rather
// than in a new file outside that scope.
import {
    buildTdahConnectionWebSocketUrl,
    computeTdahConnectionBackoffDelayMs,
    INITIAL_TDAH_CONNECTION_STATE,
    reduceTdahConnectionState,
    startPersistentConnection,
    TDAH_CONNECTION_BACKOFF_BASE_MS,
    TDAH_CONNECTION_BACKOFF_CAP_MS,
    TDAH_CONNECTION_OFFLINE_THRESHOLD_ATTEMPTS,
    type PersistentConnectionSocketLike,
} from '@/lib/persistent-connection';

const { MockCloudHttpError, cloudGetJson, cloudRequestJson } = vi.hoisted(() => {
    class HoistedMockCloudHttpError extends Error {
        status: number;
        constructor(message: string, status: number) {
            super(message);
            this.status = status;
        }
    }
    return {
        MockCloudHttpError: HoistedMockCloudHttpError,
        cloudGetJson: vi.fn(),
        cloudRequestJson: vi.fn(),
    };
});

vi.mock('@mindwtr/core', () => ({
    cloudGetJson: (...args: unknown[]) => cloudGetJson(...args),
    cloudRequestJson: (...args: unknown[]) => cloudRequestJson(...args),
    CloudHttpError: MockCloudHttpError,
    getCloudBaseUrl: (url: string) => `${url.replace(/\/+$/, '')}/v1`,
}));

const asyncStorageGetItem = vi.fn();
vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: (...args: unknown[]) => asyncStorageGetItem(...args),
    },
}));

const getSecureConfigValue = vi.fn();
vi.mock('@/lib/secure-config', () => ({
    getSecureConfigValue: (...args: unknown[]) => getSecureConfigValue(...args),
}));

vi.mock('@/lib/webdav-request-options', () => ({
    getMobileCloudRequestOptions: () => ({}),
}));

const CLOUD_URL = 'https://sync.example.com';
const CLOUD_TOKEN = 'cloud-token-1234567890';

const configureCloudSync = (url: string | null = CLOUD_URL, token: string | null = CLOUD_TOKEN): void => {
    asyncStorageGetItem.mockImplementation(async (key: string) => {
        if (key === '@mindwtr_cloud_url') return url;
        if (key === '@mindwtr_cloud_allow_insecure_http') return 'false';
        return null;
    });
    getSecureConfigValue.mockImplementation(async (key: string) => (
        key === '@mindwtr_cloud_token' ? token : null
    ));
};

let latest: UseTdahTodayResult | null = null;
let tree: ReactTestRenderer | null = null;

function Harness() {
    latest = useTdahToday();
    return React.createElement('Harness', null);
}

const mount = async (): Promise<void> => {
    await act(async () => {
        tree = create(React.createElement(Harness));
    });
};

describe('useTdahToday', () => {
    beforeEach(() => {
        cloudGetJson.mockReset();
        cloudRequestJson.mockReset();
        asyncStorageGetItem.mockReset();
        getSecureConfigValue.mockReset();
        configureCloudSync();
        latest = null;
    });

    afterEach(() => {
        if (tree) {
            act(() => {
                tree?.unmount();
            });
        }
        tree = null;
    });

    it('starts in the loading phase and never fetches before reload() is called', async () => {
        await mount();
        expect(latest?.phase).toBe('loading');
        expect(cloudGetJson).not.toHaveBeenCalled();
    });

    it('moves to ready with the server activities on a successful fetch', async () => {
        cloudGetJson.mockResolvedValue({
            date: '2026-08-26',
            timeZone: 'America/Mexico_City',
            routineTitle: 'Día laboral',
            activities: [{
                id: 1, dayPlanDate: '2026-08-26', blockId: null, title: 'X', startTime: '09:00',
                durationMinutes: 30, origin: 'routine', state: 'pending', startedAt: null, completedAt: null,
            }],
        });
        await mount();
        await act(async () => { await latest?.reload(); });

        expect(latest?.phase).toBe('ready');
        expect(latest?.routineTitle).toBe('Día laboral');
        expect(latest?.activities).toHaveLength(1);
        // AD-6: threaded straight from the server's own `timeZone` field, for
        // TdahNowLine to resolve "now" against — never a device-local value.
        expect(latest?.timeZone).toBe('America/Mexico_City');
        expect(cloudGetJson).toHaveBeenCalledWith(
            'https://sync.example.com/v1/tdah/day',
            expect.objectContaining({ token: CLOUD_TOKEN }),
        );
    });

    // Story 4.2 — the only join between the server's `workOriginErrorCode` and
    // the band's degradation notice. The server test asserts the field on the
    // HTTP body and TdahWorkBandRow's test drives the prop directly; without
    // this one, the hook could drop the field entirely and both ends stay green
    // while no user ever sees the notice.
    it('threads workOriginErrorCode from the day response, and reports null when the field is absent or not a string', async () => {
        cloudGetJson.mockResolvedValue({
            date: '2026-08-26', timeZone: 'UTC', routineTitle: null, activities: [],
            workOriginErrorCode: 'TDAH_ORIGIN_CREDENTIALS_INVALID',
        });
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.workOriginErrorCode).toBe('TDAH_ORIGIN_CREDENTIALS_INVALID');

        // A healthy last pull sends null; a server that predates the field
        // sends nothing at all. Both mean "no notice", never a rendered "null".
        cloudGetJson.mockResolvedValue({
            date: '2026-08-26', timeZone: 'UTC', routineTitle: null, activities: [],
            workOriginErrorCode: null,
        });
        await act(async () => { await latest?.reload(); });
        expect(latest?.workOriginErrorCode).toBeNull();

        cloudGetJson.mockResolvedValue({ date: '2026-08-26', timeZone: 'UTC', routineTitle: null, activities: [] });
        await act(async () => { await latest?.reload(); });
        expect(latest?.workOriginErrorCode).toBeNull();
    });

    it('falls back to the device time zone when the server response omits timeZone, without failing the fetch', async () => {
        cloudGetJson.mockResolvedValue({ date: '2026-08-26', routineTitle: null, activities: [] });
        await mount();
        await act(async () => { await latest?.reload(); });

        expect(latest?.phase).toBe('empty');
        expect(latest?.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    });

    it('moves to a clear error phase (never offline) on a malformed response body, e.g. activities missing or not an array', async () => {
        cloudGetJson.mockResolvedValue({ date: '2026-08-26', routineTitle: null, activities: 'not-an-array' });
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.phase).toBe('error');
    });

    it('moves to empty when the day has no activities (no Rutina applies)', async () => {
        cloudGetJson.mockResolvedValue({ date: '2026-08-26', routineTitle: null, activities: [] });
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.phase).toBe('empty');
    });

    it('moves to the offline phase on a network-level failure, never a generic error', async () => {
        cloudGetJson.mockRejectedValue(new Error('network down'));
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.phase).toBe('offline');
    });

    it('moves to the error phase on a real server error response', async () => {
        cloudGetJson.mockRejectedValue(new MockCloudHttpError('server exploded', 500));
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.phase).toBe('error');
    });

    it('moves to the generic error phase (never a crash) on a 409 TDAH_ACTIVATE_REQUIRED — the mode is off', async () => {
        cloudGetJson.mockRejectedValue(new MockCloudHttpError('TDAH_ACTIVATE_REQUIRED', 409));
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.phase).toBe('error');
    });

    it('moves to the unconfigured phase (never error) when Self-Hosted sync is not configured, without ever fetching', async () => {
        configureCloudSync(null, null);
        await mount();
        await act(async () => { await latest?.reload(); });
        expect(latest?.phase).toBe('unconfigured');
        expect(cloudGetJson).not.toHaveBeenCalled();
    });

    it('createManualActivity POSTs to /tdah/day/activities and merges the created Activity', async () => {
        cloudGetJson.mockResolvedValue({ date: '2026-08-26', routineTitle: null, activities: [] });
        cloudRequestJson.mockResolvedValue({
            activity: {
                id: 2, dayPlanDate: '2026-08-26', blockId: null, title: 'Manual', startTime: '10:00',
                durationMinutes: 0, origin: 'manual', state: 'pending', startedAt: null, completedAt: null,
            },
        });
        await mount();
        await act(async () => { await latest?.reload(); });
        await act(async () => { await latest?.createManualActivity({ title: 'Manual' }); });

        expect(cloudRequestJson).toHaveBeenCalledWith(
            'POST',
            'https://sync.example.com/v1/tdah/day/activities',
            { title: 'Manual' },
            expect.objectContaining({ token: CLOUD_TOKEN }),
        );
        expect(latest?.activities.map((activity) => activity.id)).toEqual([2]);
    });

    it('createManualActivity drops the merge when the response belongs to another day (mutation spanning midnight)', async () => {
        cloudGetJson.mockResolvedValue({ date: '2026-08-26', timeZone: 'UTC', routineTitle: null, activities: [] });
        cloudRequestJson.mockResolvedValue({
            activity: {
                // The server assigned it to tomorrow's plan (past the profile's midnight).
                id: 2, dayPlanDate: '2026-08-27', blockId: null, title: 'Late add', startTime: '23:50',
                durationMinutes: 30, origin: 'manual', state: 'pending', startedAt: null, completedAt: null,
            },
        });
        await mount();
        await act(async () => { await latest?.reload(); });
        await act(async () => { await latest?.createManualActivity({ title: 'Late add', startTime: '23:50' }); });

        // The created Activity is still returned to the caller, but never
        // spliced into yesterday's (2026-08-26) timeline.
        expect(latest?.activities).toHaveLength(0);
    });

    it('createManualActivity still merges when the response belongs to the loaded day', async () => {
        cloudGetJson.mockResolvedValue({ date: '2026-08-26', timeZone: 'UTC', routineTitle: null, activities: [] });
        cloudRequestJson.mockResolvedValue({
            activity: {
                id: 2, dayPlanDate: '2026-08-26', blockId: null, title: 'Same day', startTime: '10:00',
                durationMinutes: 0, origin: 'manual', state: 'pending', startedAt: null, completedAt: null,
            },
        });
        await mount();
        await act(async () => { await latest?.reload(); });
        await act(async () => { await latest?.createManualActivity({ title: 'Same day' }); });

        expect(latest?.activities.map((activity) => activity.id)).toEqual([2]);
    });

    it('registerActivityAction POSTs to the action URL and merges the returned Activity by id', async () => {
        const activity = {
            id: 3, dayPlanDate: '2026-08-26', blockId: null, title: 'X', startTime: '09:00',
            durationMinutes: 30, origin: 'routine' as const, state: 'pending' as const, startedAt: null, completedAt: null,
        };
        cloudGetJson.mockResolvedValue({ date: '2026-08-26', routineTitle: null, activities: [activity] });
        cloudRequestJson.mockResolvedValue({ activity: { ...activity, state: 'started', startedAt: '2026-08-26T09:00:00.000Z' } });

        await mount();
        await act(async () => { await latest?.reload(); });
        await act(async () => { await latest?.registerActivityAction(3, 'start'); });

        expect(cloudRequestJson).toHaveBeenCalledWith(
            'POST',
            'https://sync.example.com/v1/tdah/activities/3/start',
            undefined,
            expect.objectContaining({ token: CLOUD_TOKEN }),
        );
        expect(latest?.activities[0]?.state).toBe('started');
        expect(latest?.activities[0]?.startedAt).toBe('2026-08-26T09:00:00.000Z');
    });

    it('registerActivityAction drops the merge when the server moves the Activity to another day (midnight span)', async () => {
        const activity = {
            id: 3, dayPlanDate: '2026-08-26', blockId: null, title: 'X', startTime: '23:30',
            durationMinutes: 30, origin: 'routine' as const, state: 'pending' as const, startedAt: null, completedAt: null,
        };
        cloudGetJson.mockResolvedValue({ date: '2026-08-26', timeZone: 'UTC', routineTitle: null, activities: [activity] });
        // Started after the profile's midnight: the server now files it under 2026-08-27.
        cloudRequestJson.mockResolvedValue({
            activity: { ...activity, dayPlanDate: '2026-08-27', state: 'started', startedAt: '2026-08-26T23:45:00.000Z' },
        });

        await mount();
        await act(async () => { await latest?.reload(); });
        await act(async () => { await latest?.registerActivityAction(3, 'start'); });

        // Yesterday's rendered row keeps its own snapshot; the new-day copy
        // never replaces it in state.
        expect(latest?.activities[0]?.state).toBe('pending');
        expect(latest?.activities[0]?.dayPlanDate).toBe('2026-08-26');
    });
});

describe('computeTdahConnectionBackoffDelayMs (Story 2.1 backoff shape)', () => {
    it('doubles the base delay per attempt with no jitter drift when random() is exactly 0.5', () => {
        const noJitter = () => 0.5;
        expect(computeTdahConnectionBackoffDelayMs(0, noJitter)).toBe(TDAH_CONNECTION_BACKOFF_BASE_MS);
        expect(computeTdahConnectionBackoffDelayMs(1, noJitter)).toBe(TDAH_CONNECTION_BACKOFF_BASE_MS * 2);
        expect(computeTdahConnectionBackoffDelayMs(2, noJitter)).toBe(TDAH_CONNECTION_BACKOFF_BASE_MS * 4);
    });

    it('caps the delay at TDAH_CONNECTION_BACKOFF_CAP_MS however high the attempt count climbs', () => {
        const noJitter = () => 0.5;
        expect(computeTdahConnectionBackoffDelayMs(10, noJitter)).toBe(TDAH_CONNECTION_BACKOFF_CAP_MS);
        expect(computeTdahConnectionBackoffDelayMs(50, noJitter)).toBe(TDAH_CONNECTION_BACKOFF_CAP_MS);
    });

    it('applies +/-20% jitter around the exponential delay (Design Notes: avoids synchronized reconnects)', () => {
        expect(computeTdahConnectionBackoffDelayMs(0, () => 0)).toBe(Math.round(TDAH_CONNECTION_BACKOFF_BASE_MS * 0.8));
        expect(computeTdahConnectionBackoffDelayMs(0, () => 1)).toBe(Math.round(TDAH_CONNECTION_BACKOFF_BASE_MS * 1.2));
    });

    it('never returns a negative delay for attempt 0 even at the jitter floor', () => {
        expect(computeTdahConnectionBackoffDelayMs(0, () => 0)).toBeGreaterThanOrEqual(0);
    });
});

describe('reduceTdahConnectionState (Story 2.1 pure connection state machine)', () => {
    it('starts reconnecting (never a false "connected") before the first open event', () => {
        expect(INITIAL_TDAH_CONNECTION_STATE).toEqual({ status: 'reconnecting', consecutiveFailures: 0 });
    });

    it('moves to connected with the failure count reset on open', () => {
        const state = reduceTdahConnectionState({ status: 'reconnecting', consecutiveFailures: 3 }, { type: 'open' });
        expect(state).toEqual({ status: 'connected', consecutiveFailures: 0 });
    });

    it('stays reconnecting (no banner) for close events below the offline threshold', () => {
        let state = INITIAL_TDAH_CONNECTION_STATE;
        for (let i = 0; i < TDAH_CONNECTION_OFFLINE_THRESHOLD_ATTEMPTS - 1; i += 1) {
            state = reduceTdahConnectionState(state, { type: 'close' });
            expect(state.status).toBe('reconnecting');
        }
        expect(state.consecutiveFailures).toBe(TDAH_CONNECTION_OFFLINE_THRESHOLD_ATTEMPTS - 1);
    });

    it('moves to offline (banner visible) only once close events reach the threshold — never on the first transient drop', () => {
        let state: ReturnType<typeof reduceTdahConnectionState> = INITIAL_TDAH_CONNECTION_STATE;
        for (let i = 0; i < TDAH_CONNECTION_OFFLINE_THRESHOLD_ATTEMPTS; i += 1) {
            state = reduceTdahConnectionState(state, { type: 'close' });
        }
        expect(state).toEqual({ status: 'offline', consecutiveFailures: TDAH_CONNECTION_OFFLINE_THRESHOLD_ATTEMPTS });
    });

    it('a rejected handshake and a network failure share the same close path (spec: no separate infinite-loop path)', () => {
        // A raw RN WebSocket exposes no HTTP status for a rejected upgrade —
        // an invalid/missing token and an unreachable server both surface as
        // the same 'close' event, so both drive the identical backoff path.
        const afterAuthRejection = reduceTdahConnectionState(INITIAL_TDAH_CONNECTION_STATE, { type: 'close' });
        const afterNetworkFailure = reduceTdahConnectionState(INITIAL_TDAH_CONNECTION_STATE, { type: 'close' });
        expect(afterAuthRejection).toEqual(afterNetworkFailure);
    });

    it('drops a connected status to reconnecting on app-foreground without proof the socket survived backgrounding', () => {
        const state = reduceTdahConnectionState({ status: 'connected', consecutiveFailures: 0 }, { type: 'app-foreground' });
        expect(state).toEqual({ status: 'reconnecting', consecutiveFailures: 0 });
    });

    it('leaves an already-degraded status untouched on app-foreground (no double-transition)', () => {
        const reconnecting = { status: 'reconnecting' as const, consecutiveFailures: 2 };
        expect(reduceTdahConnectionState(reconnecting, { type: 'app-foreground' })).toEqual(reconnecting);
        const offline = { status: 'offline' as const, consecutiveFailures: 5 };
        expect(reduceTdahConnectionState(offline, { type: 'app-foreground' })).toEqual(offline);
    });
});

describe('buildTdahConnectionWebSocketUrl (Story 2.1 handshake URL)', () => {
    // This file's own '@mindwtr/core' mock (top of file) defines
    // getCloudBaseUrl as `${url.replace(/\/+$/, '')}/v1` — the same shape
    // the real implementation returns (scheme preserved, normalized to
    // `.../v1`), so this exercises the same scheme-swap this function does
    // against real cloud config.
    it('swaps https -> wss and appends the tdah/ws path with the token query param', () => {
        expect(buildTdahConnectionWebSocketUrl('https://cloud.example.com', 'tok-123')).toBe(
            'wss://cloud.example.com/v1/tdah/ws?token=tok-123',
        );
    });

    it('swaps http -> ws (never wss) for a plain http cloud URL', () => {
        expect(buildTdahConnectionWebSocketUrl('http://192.168.1.10:8787', 'tok-123')).toBe(
            'ws://192.168.1.10:8787/v1/tdah/ws?token=tok-123',
        );
    });

    it('URL-encodes the token in the query param', () => {
        const url = buildTdahConnectionWebSocketUrl('https://cloud.example.com', 'a b/c+d');
        expect(url).toBe('wss://cloud.example.com/v1/tdah/ws?token=a%20b%2Fc%2Bd');
    });
});

describe('startPersistentConnection (Story 2.1 wiring over the pure state machine)', () => {
    class FakeSocket implements PersistentConnectionSocketLike {
        onopen: ((event: unknown) => void) | null = null;
        onclose: ((event: unknown) => void) | null = null;
        onerror: ((event: unknown) => void) | null = null;
        onmessage: ((event: { data: unknown }) => void) | null = null;
        closedWith: { code?: number; reason?: string } | null = null;
        close(code?: number, reason?: string) {
            this.closedWith = { code, reason };
        }
    }

    const strings = {
        connectedTitle: 'Mindwtr connected',
        connectedText: "Today's reminders are active",
        reconnectingText: 'Reconnecting…',
        channelName: 'Connection',
    };

    let sockets: FakeSocket[] = [];
    const createSocket = (_url: string): PersistentConnectionSocketLike => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
    };

    beforeEach(() => {
        sockets = [];
        // This describe sits outside the 'useTdahToday' block above, so its
        // own beforeEach (which wires the same asyncStorageGetItem /
        // getSecureConfigValue mocks) doesn't run for these tests — configure
        // them directly here.
        configureCloudSync();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('opens a socket for the configured cloud URL/token and reports connected on open', async () => {
        const handle = startPersistentConnection({ strings, createSocket });
        await vi.advanceTimersByTimeAsync(0);

        expect(sockets).toHaveLength(1);
        sockets[0].onopen?.({});
        expect(handle.getState()).toEqual({ status: 'connected', consecutiveFailures: 0 });

        handle.stop();
    });

    it('reconnects with backoff after a close, escalates to offline at the threshold, then recovers and fires onReconnected once open again', async () => {
        const onReconnected = vi.fn();
        const handle = startPersistentConnection({ strings, createSocket, onReconnected });
        await vi.advanceTimersByTimeAsync(0);
        sockets[0].onopen?.({});
        expect(handle.getState().status).toBe('connected');

        // Drive close -> backoff -> new socket, TDAH_CONNECTION_OFFLINE_THRESHOLD_ATTEMPTS times.
        for (let i = 0; i < TDAH_CONNECTION_OFFLINE_THRESHOLD_ATTEMPTS; i += 1) {
            const socketCountBefore = sockets.length;
            sockets[sockets.length - 1].onclose?.({});
            // Advance well past the backoff cap so the retry fires regardless of jitter.
            await vi.advanceTimersByTimeAsync(TDAH_CONNECTION_BACKOFF_CAP_MS + 1_000);
            expect(sockets.length).toBe(socketCountBefore + 1);
        }
        expect(handle.getState()).toEqual({ status: 'offline', consecutiveFailures: TDAH_CONNECTION_OFFLINE_THRESHOLD_ATTEMPTS });
        expect(onReconnected).not.toHaveBeenCalled();

        sockets[sockets.length - 1].onopen?.({});
        expect(handle.getState()).toEqual({ status: 'connected', consecutiveFailures: 0 });
        expect(onReconnected).toHaveBeenCalledTimes(1);

        handle.stop();
    });

    it('notifies subscribers on every state transition', async () => {
        const listener = vi.fn();
        const handle = startPersistentConnection({ strings, createSocket });
        const unsubscribe = handle.subscribe(listener);
        await vi.advanceTimersByTimeAsync(0);

        sockets[0].onopen?.({});
        expect(listener).toHaveBeenCalledWith({ status: 'connected', consecutiveFailures: 0 });

        unsubscribe();
        sockets[0].onclose?.({});
        // Unsubscribed: no further calls beyond the one already asserted above.
        expect(listener).toHaveBeenCalledTimes(1);

        handle.stop();
    });

    it('stop() closes the socket intentionally and schedules no further reconnect attempts', async () => {
        const handle = startPersistentConnection({ strings, createSocket });
        await vi.advanceTimersByTimeAsync(0);
        const socket = sockets[0];

        handle.stop();

        expect(socket.closedWith).toEqual({ code: 1000, reason: 'tdah-mode-off' });
        const socketCountAfterStop = sockets.length;
        await vi.advanceTimersByTimeAsync(TDAH_CONNECTION_BACKOFF_CAP_MS + 1_000);
        expect(sockets).toHaveLength(socketCountAfterStop);
    });

    it('a synchronously-throwing createSocket follows the same failure/backoff path as a close event', async () => {
        const throwingCreateSocket = vi.fn((_url: string): PersistentConnectionSocketLike => {
            throw new Error('socket construction failed');
        });
        const handle = startPersistentConnection({ strings, createSocket: throwingCreateSocket });
        await vi.advanceTimersByTimeAsync(0);

        expect(handle.getState()).toEqual({ status: 'reconnecting', consecutiveFailures: 1 });
        expect(sockets).toHaveLength(0);

        // The failure still schedules exactly one backoff retry (attempt 0's
        // delay, max ~1200ms with jitter) — same createSocket, so it throws
        // again. A larger advance would cascade through several automatic
        // retries in one jump (this createSocket fails every time, unlike
        // the manually-driven close events in the tests above), so this
        // advances only enough for the single next attempt to fire.
        await vi.advanceTimersByTimeAsync(Math.ceil(TDAH_CONNECTION_BACKOFF_BASE_MS * 1.3));
        expect(handle.getState()).toEqual({ status: 'reconnecting', consecutiveFailures: 2 });
        expect(throwingCreateSocket).toHaveBeenCalledTimes(2);

        handle.stop();
    });

    it('never calls createSocket when Self-Hosted sync is not configured, and still follows the failure/backoff path', async () => {
        configureCloudSync(null, null);
        const handle = startPersistentConnection({ strings, createSocket });
        await vi.advanceTimersByTimeAsync(0);

        expect(sockets).toHaveLength(0);
        expect(handle.getState()).toEqual({ status: 'reconnecting', consecutiveFailures: 1 });

        // Same reasoning as above: advance just enough for the single next
        // automatic retry (attempt 0), not enough to cascade further.
        await vi.advanceTimersByTimeAsync(Math.ceil(TDAH_CONNECTION_BACKOFF_BASE_MS * 1.3));
        expect(sockets).toHaveLength(0);
        expect(handle.getState()).toEqual({ status: 'reconnecting', consecutiveFailures: 2 });

        handle.stop();
    });

    it('ignores a stale socket\'s onopen after a close already replaced it with a new connect() cycle', async () => {
        const handle = startPersistentConnection({ strings, createSocket });
        await vi.advanceTimersByTimeAsync(0);
        const firstSocket = sockets[0];
        firstSocket.onopen?.({});
        expect(handle.getState()).toEqual({ status: 'connected', consecutiveFailures: 0 });

        // The close schedules a reconnect, which creates a second socket.
        firstSocket.onclose?.({});
        await vi.advanceTimersByTimeAsync(TDAH_CONNECTION_BACKOFF_CAP_MS + 1_000);
        expect(sockets).toHaveLength(2);
        expect(handle.getState().status).toBe('reconnecting');

        // The first (now-stale) socket firing onopen late must be ignored —
        // it is no longer the socket this handle is tracking.
        firstSocket.onopen?.({});
        expect(handle.getState().status).toBe('reconnecting');

        // The real, current socket still works normally.
        sockets[1].onopen?.({});
        expect(handle.getState()).toEqual({ status: 'connected', consecutiveFailures: 0 });

        handle.stop();
    });
});

describe('startPersistentConnection native foreground-service wiring (Story 2.1, Platform.OS === "android")', () => {
    // The rest of this file's tests run under the shimmed 'react-native'
    // (Platform.OS === 'web'), where every native call below is a gated
    // no-op — proving nothing about the actual wiring. This block forces
    // Platform.OS to 'android' via a scoped `vi.doMock` + `vi.resetModules`
    // + fresh dynamic import, so `isPersistentConnectionSupported()` is true
    // and the native module calls in persistent-connection.ts are actually
    // reachable and assertable.
    class FakeSocket implements PersistentConnectionSocketLike {
        onopen: ((event: unknown) => void) | null = null;
        onclose: ((event: unknown) => void) | null = null;
        onerror: ((event: unknown) => void) | null = null;
        onmessage: ((event: { data: unknown }) => void) | null = null;
        close() {}
    }

    const strings = {
        connectedTitle: 'Mindwtr connected',
        connectedText: "Today's reminders are active",
        reconnectingText: 'Reconnecting…',
        channelName: 'Connection',
    };

    const startForegroundConnection = vi.fn();
    const updateForegroundConnectionStatus = vi.fn();
    const stopForegroundConnection = vi.fn();

    let sockets: FakeSocket[] = [];
    const createSocket = (_url: string): PersistentConnectionSocketLike => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
    };

    let androidStartPersistentConnection: typeof startPersistentConnection;

    beforeEach(async () => {
        sockets = [];
        startForegroundConnection.mockReset();
        updateForegroundConnectionStatus.mockReset();
        stopForegroundConnection.mockReset();
        configureCloudSync();

        vi.resetModules();
        vi.doMock('react-native', () => ({
            AppState: { addEventListener: () => ({ remove: () => {} }) },
            Platform: { OS: 'android' },
        }));
        vi.doMock('@/modules/persistent-connection', () => ({
            isPersistentConnectionForegroundServiceSupported: () => true,
            startPersistentConnectionForegroundService: startForegroundConnection,
            updatePersistentConnectionForegroundServiceStatus: updateForegroundConnectionStatus,
            stopPersistentConnectionForegroundService: stopForegroundConnection,
            isIgnoringBatteryOptimizations: () => true,
            requestIgnoreBatteryOptimizations: () => {},
        }));

        const mod = await import('@/lib/persistent-connection');
        androidStartPersistentConnection = mod.startPersistentConnection;
    });

    afterEach(() => {
        vi.doUnmock('react-native');
        vi.doUnmock('@/modules/persistent-connection');
        vi.resetModules();
    });

    it('calls startPersistentConnectionForegroundService with the connected copy on open', async () => {
        const handle = androidStartPersistentConnection({ strings, createSocket });
        // Real timers are active in this block (no vi.useFakeTimers here) —
        // a real macrotask tick reliably flushes the async
        // loadTdahConnectionCloudConfig() -> Promise.all() chain inside
        // connect(), unlike a fixed number of microtask-only `await
        // Promise.resolve()` hops.
        await new Promise((resolve) => { setTimeout(resolve, 0); });

        sockets[0].onopen?.({});

        expect(startForegroundConnection).toHaveBeenCalledWith(
            strings.connectedTitle,
            strings.connectedText,
            strings.channelName,
        );

        handle.stop();
    });

    it('calls updateForegroundConnectionStatus with the reconnecting copy on close/reconnect', async () => {
        const handle = androidStartPersistentConnection({ strings, createSocket });
        // Real timers are active in this block (no vi.useFakeTimers here) —
        // a real macrotask tick reliably flushes the async
        // loadTdahConnectionCloudConfig() -> Promise.all() chain inside
        // connect(), unlike a fixed number of microtask-only `await
        // Promise.resolve()` hops.
        await new Promise((resolve) => { setTimeout(resolve, 0); });

        sockets[0].onopen?.({});
        updateForegroundConnectionStatus.mockClear();

        sockets[0].onclose?.({});

        expect(updateForegroundConnectionStatus).toHaveBeenCalledWith(
            strings.connectedTitle,
            strings.reconnectingText,
            strings.channelName,
        );

        handle.stop();
    });

    it('calls stopPersistentConnectionForegroundService on stop()', async () => {
        const handle = androidStartPersistentConnection({ strings, createSocket });
        // Real timers are active in this block (no vi.useFakeTimers here) —
        // a real macrotask tick reliably flushes the async
        // loadTdahConnectionCloudConfig() -> Promise.all() chain inside
        // connect(), unlike a fixed number of microtask-only `await
        // Promise.resolve()` hops.
        await new Promise((resolve) => { setTimeout(resolve, 0); });

        expect(stopForegroundConnection).not.toHaveBeenCalled();
        handle.stop();
        expect(stopForegroundConnection).toHaveBeenCalledTimes(1);
    });
});

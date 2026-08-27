import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';

import { getCloudBaseUrl } from '@mindwtr/core';

import {
    isPersistentConnectionForegroundServiceSupported,
    isIgnoringBatteryOptimizations,
    requestIgnoreBatteryOptimizations,
    startPersistentConnectionForegroundService,
    stopPersistentConnectionForegroundService,
    updatePersistentConnectionForegroundServiceStatus,
} from '@/modules/persistent-connection';

import { getSecureConfigValue } from './secure-config';
import { CLOUD_TOKEN_KEY, CLOUD_URL_KEY } from './sync-constants';

// ---------------------------------------------------------------------------
// Pure state machine (spec Always: "el estado de conexión es una máquina de
// estados testable de forma pura (mismo patrón que
// runNightlyTdahTick/runNamespaceTick en apps/cloud/src/tdah/scheduler.ts:
// lógica separada del wiring de timers/sockets real)"). Everything below
// `startPersistentConnection` is pure and has no I/O.
// ---------------------------------------------------------------------------

export const TDAH_CONNECTION_STATUSES = ['connected', 'reconnecting', 'offline'] as const;
export type TdahConnectionStatus = (typeof TDAH_CONNECTION_STATUSES)[number];

export type TdahConnectionState = {
    status: TdahConnectionStatus;
    consecutiveFailures: number;
};

export const INITIAL_TDAH_CONNECTION_STATE: TdahConnectionState = {
    status: 'reconnecting',
    consecutiveFailures: 0,
};

/**
 * Design Notes: "el connection-dot pasa de reconectando a sin servidor
 * únicamente después de que el backoff supere un número de intentos
 * consecutivos definido en la implementación" — 4 consecutive failed
 * attempts (roughly 1s+2s+4s+8s ≈ 15s of real retrying before the banner
 * appears), never on the first transient drop.
 */
export const TDAH_CONNECTION_OFFLINE_THRESHOLD_ATTEMPTS = 4;

export const TDAH_CONNECTION_BACKOFF_BASE_MS = 1_000;
export const TDAH_CONNECTION_BACKOFF_CAP_MS = 30_000;
const TDAH_CONNECTION_BACKOFF_JITTER_RATIO = 0.2;

/**
 * Design Notes: `delay = min(cap, base * 2^intento) * (1 + jitter)`, jitter
 * ±20% so multiple clients recovering from the same VPS outage don't all
 * reconnect in lockstep. `attempt` is 0-based (the first retry after a
 * connection uses attempt 0). `random` is injectable for deterministic
 * tests.
 */
export function computeTdahConnectionBackoffDelayMs(attempt: number, random: () => number = Math.random): number {
    const exponential = TDAH_CONNECTION_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt);
    const capped = Math.min(TDAH_CONNECTION_BACKOFF_CAP_MS, exponential);
    const jitter = 1 + (random() * 2 - 1) * TDAH_CONNECTION_BACKOFF_JITTER_RATIO;
    return Math.max(0, Math.round(capped * jitter));
}

export type TdahConnectionEvent =
    | { type: 'open' }
    | { type: 'close' }
    | { type: 'app-foreground' };

/**
 * Pure reducer. A rejected handshake (missing/invalid token) is indistinguishable
 * on a raw RN `WebSocket` from a network-level failure — no HTTP status
 * survives the failed upgrade — so both paths emit the same `'close'` event
 * and share this same backoff-driven path (spec I/O matrix: "Cliente trata el
 * rechazo como 'sin servidor' (no reintenta en loop infinito sin backoff)").
 *
 * AD-11 / Boundaries "Never": this machine tracks connectivity only — it
 * never reconciles or re-derives the day's plan, that stays on
 * useTdahToday's own `reload()`.
 */
export function reduceTdahConnectionState(state: TdahConnectionState, event: TdahConnectionEvent): TdahConnectionState {
    switch (event.type) {
        case 'open':
            return { status: 'connected', consecutiveFailures: 0 };
        case 'close': {
            const consecutiveFailures = state.consecutiveFailures + 1;
            const status: TdahConnectionStatus = consecutiveFailures >= TDAH_CONNECTION_OFFLINE_THRESHOLD_ATTEMPTS
                ? 'offline'
                : 'reconnecting';
            return { status, consecutiveFailures };
        }
        case 'app-foreground':
            // OEMs kill the foreground service/socket silently while
            // backgrounded (#819-style) with no event firing for it — coming
            // back to foreground never keeps claiming 'connected' on faith,
            // it drops to 'reconnecting' until a genuine 'open' event proves
            // the socket is alive again.
            return state.status === 'connected'
                ? { status: 'reconnecting', consecutiveFailures: state.consecutiveFailures }
                : state;
        default:
            return state;
    }
}

// ---------------------------------------------------------------------------
// Wiring: the real WebSocket client, foreground service, and N-05 notifier.
// ---------------------------------------------------------------------------

export function isPersistentConnectionSupported(): boolean {
    return Platform.OS === 'android';
}

export type PersistentConnectionStrings = {
    /** N-05 title/text while connected, e.g. "Mindwtr connected" / "Your day's reminders are active". */
    connectedTitle: string;
    connectedText: string;
    /** N-05 text while reconnecting; title stays connectedTitle. */
    reconnectingText: string;
    channelName: string;
};

export type PersistentConnectionListener = (state: TdahConnectionState) => void;

export type PersistentConnectionHandle = {
    getState: () => TdahConnectionState;
    subscribe: (listener: PersistentConnectionListener) => () => void;
    /** Intentional shutdown (spec: mode deactivated) — closes the socket, stops the foreground service, and removes N-05. */
    stop: () => void;
};

/** Minimal shape this module needs off RN's global `WebSocket` (or a test double). */
export type PersistentConnectionSocketLike = {
    onopen: ((event: unknown) => void) | null;
    onclose: ((event: unknown) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onmessage: ((event: { data: unknown }) => void) | null;
    close: (code?: number, reason?: string) => void;
};

export type StartPersistentConnectionOptions = {
    strings: PersistentConnectionStrings;
    /** AC: "T-01 re-obtiene el plan del día automáticamente" on every successful reconnect (not the first connect). */
    onReconnected?: () => void;
    onMessage?: (data: unknown) => void;
    /** Test seam — defaults to `new WebSocket(url)`. */
    createSocket?: (url: string) => PersistentConnectionSocketLike;
};

type TdahConnectionCloudConfig = {
    url: string;
    token: string;
};

/**
 * Mirrors tdah-today-cloud.ts's loadTdahCloudConfig auth-source pattern
 * (CLOUD_URL_KEY / CLOUD_TOKEN_KEY via getSecureConfigValue) without
 * importing across the lib→components boundary. Never cached (spec Always:
 * "leído sin cachear vía getSecureConfigValue(CLOUD_TOKEN_KEY)") — read fresh
 * on every (re)connect attempt so a token rotated in Settings takes effect on
 * the very next retry instead of requiring an app restart.
 */
async function loadTdahConnectionCloudConfig(): Promise<TdahConnectionCloudConfig | null> {
    const [rawUrl, rawToken] = await Promise.all([
        AsyncStorage.getItem(CLOUD_URL_KEY),
        getSecureConfigValue(CLOUD_TOKEN_KEY),
    ]);
    const url = rawUrl?.trim() ?? '';
    const token = rawToken?.trim() ?? '';
    if (!url || !token) return null;
    return { url, token };
}

/**
 * Design Notes: "el bearer token viaja como query param, ej.
 * wss://vps/tdah/ws?token=..." — the RN WebSocket client can't set custom
 * headers on the handshake. `getCloudBaseUrl` always returns a
 * `<scheme>://host[:port]/v1` URL with the original http(s) scheme intact,
 * so building the WS URL only needs an http(s) -> ws(s) swap plus the tdah/ws
 * path and token query param.
 */
export function buildTdahConnectionWebSocketUrl(cloudUrl: string, token: string): string {
    const httpBase = getCloudBaseUrl(cloudUrl);
    const wsBase = /^https:/i.test(httpBase)
        ? httpBase.replace(/^https/i, 'wss')
        : httpBase.replace(/^http/i, 'ws');
    return `${wsBase}/tdah/ws?token=${encodeURIComponent(token)}`;
}

const defaultCreateSocket = (url: string): PersistentConnectionSocketLike => (
    new (globalThis as unknown as { WebSocket: new (url: string) => PersistentConnectionSocketLike }).WebSocket(url)
);

/**
 * Opens (and keeps re-opening, with backoff) the TDAH WebSocket channel for
 * the lifetime of Modo TDAH being active (spec Always: "se abre al activar
 * el modo y se cierra intencionalmente al desactivarlo"). Callers own that
 * lifecycle boundary — call `stop()` when the mode turns off.
 */
export function startPersistentConnection(options: StartPersistentConnectionOptions): PersistentConnectionHandle {
    const createSocket = options.createSocket ?? defaultCreateSocket;
    const listeners = new Set<PersistentConnectionListener>();
    let state: TdahConnectionState = INITIAL_TDAH_CONNECTION_STATE;
    let socket: PersistentConnectionSocketLike | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let hasEverConnected = false;
    // Guards against two `connect()` calls racing (e.g. a scheduled retry
    // firing while an AppState-triggered reconnect is still awaiting
    // `loadTdahConnectionCloudConfig()`): without it, both could each open a
    // real socket and the one that resolves last would silently overwrite
    // `socket`, leaking the other's live connection.
    let connecting = false;

    const emit = () => {
        listeners.forEach((listener) => listener(state));
    };

    const applyForegroundServiceForState = () => {
        if (!isPersistentConnectionSupported()) return;
        if (state.status === 'connected') {
            startPersistentConnectionForegroundService(
                options.strings.connectedTitle,
                options.strings.connectedText,
                options.strings.channelName,
            );
        } else {
            updatePersistentConnectionForegroundServiceStatus(
                options.strings.connectedTitle,
                options.strings.reconnectingText,
                options.strings.channelName,
            );
        }
    };

    const clearReconnectTimer = () => {
        if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    };

    const detachSocket = (target: PersistentConnectionSocketLike | null) => {
        if (!target) return;
        target.onopen = null;
        target.onclose = null;
        target.onerror = null;
        target.onmessage = null;
    };

    const scheduleReconnect = () => {
        if (stopped || reconnectTimer !== null) return;
        const attempt = Math.max(0, state.consecutiveFailures - 1);
        const delay = computeTdahConnectionBackoffDelayMs(attempt);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            void connect();
        }, delay);
    };

    const handleFailure = () => {
        if (stopped) return;
        detachSocket(socket);
        socket = null;
        state = reduceTdahConnectionState(state, { type: 'close' });
        emit();
        applyForegroundServiceForState();
        scheduleReconnect();
    };

    const connect = async (): Promise<void> => {
        if (stopped || connecting) return;
        connecting = true;
        try {
            let cloud: TdahConnectionCloudConfig | null;
            try {
                cloud = await loadTdahConnectionCloudConfig();
            } catch {
                // AsyncStorage/getSecureConfigValue rejecting must never
                // surface as an unhandled rejection from this
                // fire-and-forgotten `connect()` call — same failure/backoff
                // path as every other connect-time failure.
                handleFailure();
                return;
            }
            if (stopped) return;
            if (!cloud) {
                // Self-Hosted sync not configured: same shape as a failed
                // attempt, retried with backoff rather than hammering the
                // storage layer in a tight loop.
                handleFailure();
                return;
            }

            const url = buildTdahConnectionWebSocketUrl(cloud.url, cloud.token);
            let nextSocket: PersistentConnectionSocketLike;
            try {
                nextSocket = createSocket(url);
            } catch {
                handleFailure();
                return;
            }
            socket = nextSocket;

            nextSocket.onopen = () => {
                if (stopped || socket !== nextSocket) return;
                clearReconnectTimer();
                const isReconnect = hasEverConnected;
                hasEverConnected = true;
                state = reduceTdahConnectionState(state, { type: 'open' });
                emit();
                applyForegroundServiceForState();
                if (isReconnect) options.onReconnected?.();
            };
            nextSocket.onmessage = (event) => {
                if (stopped || socket !== nextSocket) return;
                options.onMessage?.(event?.data);
            };
            nextSocket.onerror = () => {
                // RN's WebSocket always follows an error with a close event; the
                // state transition happens once, in onclose, to avoid
                // double-counting a single failure as two.
            };
            nextSocket.onclose = () => {
                if (socket !== nextSocket) return;
                handleFailure();
            };
        } finally {
            connecting = false;
        }
    };

    void connect();

    const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
        if (stopped || nextAppState !== 'active') return;
        const before = state;
        state = reduceTdahConnectionState(state, { type: 'app-foreground' });
        if (state !== before) {
            emit();
            // The transition to 'reconnecting' means the reducer no longer
            // trusts the previously-'connected' socket — discard it here too
            // (never just wait for its onclose, which an OEM background kill
            // never fires) so the reconnect check below actually finds
            // `socket` empty and schedules a fresh attempt instead of
            // sitting on a silently-dead reference forever.
            if (socket) {
                const staleSocket = socket;
                socket = null;
                detachSocket(staleSocket);
                try {
                    staleSocket.close();
                } catch {
                    // Already dead — nothing to clean up.
                }
            }
        }
        // Re-arm the notification even when the JS status didn't change —
        // OEMs remove the notification itself on process kills without
        // firing any JS-visible event (same rationale as
        // keepPersistentCaptureNotificationArmed).
        applyForegroundServiceForState();
        if (!socket && !connecting) scheduleReconnect();
    });

    return {
        getState: () => state,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        stop: () => {
            if (stopped) return;
            stopped = true;
            clearReconnectTimer();
            const activeSocket = socket;
            socket = null;
            if (activeSocket) {
                detachSocket(activeSocket);
                try {
                    activeSocket.close(1000, 'tdah-mode-off');
                } catch {
                    // Socket already gone — nothing to clean up.
                }
            }
            appStateSubscription.remove();
            if (isPersistentConnectionSupported()) {
                stopPersistentConnectionForegroundService();
            }
        },
    };
}

export {
    isIgnoringBatteryOptimizations,
    isPersistentConnectionForegroundServiceSupported,
    requestIgnoreBatteryOptimizations,
};

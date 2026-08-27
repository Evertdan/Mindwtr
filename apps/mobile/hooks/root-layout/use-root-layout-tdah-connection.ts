import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
    getTdahActivityVibrationPattern,
    parseTdahWsActivityTriggerEvent,
    buildTdahActivityNotificationTitle,
    type TdahWsActivityTriggerEvent,
} from '@/components/tdah/today/tdah-activity-notification';
import { useTdahModeActive } from '@/components/tdah/today/use-tdah-mode-active';
import { logWarn } from '@/lib/app-log';
import { showTdahActivityNotification } from '@/lib/notification-service-local';
import {
    INITIAL_TDAH_CONNECTION_STATE,
    isPersistentConnectionSupported,
    startPersistentConnection,
    type TdahConnectionState,
} from '@/lib/persistent-connection';

type ResolveText = (key: string, fallback: string) => string;

type UseRootLayoutTdahConnectionParams = {
    resolveText: ResolveText;
};

// ---------------------------------------------------------------------------
// Module-level pub/sub: RootLayout is this channel's only lifecycle owner
// (spec Always: "El canal WS solo se sostiene mientras el Modo TDAH está
// activo: se abre al activar el modo y se cierra intencionalmente al
// desactivarlo"). T-01 (`TdahTodayScreen`) only ever *reads* this state for
// its connection-dot and re-derives its plan on reconnect — it never starts
// or stops the socket itself, so the channel survives navigating away from
// T-01 while the mode stays on. Same plain-singleton idiom as
// notification-service.ts's registered handler: RootLayout mounts before any
// route screen, so a subscriber is always attached before a screen reads it.
// ---------------------------------------------------------------------------

let latestConnectionState: TdahConnectionState = INITIAL_TDAH_CONNECTION_STATE;
const connectionStateListeners = new Set<(state: TdahConnectionState) => void>();
const reconnectedListeners = new Set<() => void>();

function publishConnectionState(next: TdahConnectionState): void {
    latestConnectionState = next;
    connectionStateListeners.forEach((listener) => listener(next));
}

export function getTdahConnectionState(): TdahConnectionState {
    return latestConnectionState;
}

export function subscribeTdahConnectionState(listener: (state: TdahConnectionState) => void): () => void {
    connectionStateListeners.add(listener);
    return () => {
        connectionStateListeners.delete(listener);
    };
}

/**
 * AC: "T-01 re-obtiene el plan del día automáticamente" on every reconnect —
 * T-01 no longer owns the socket, so it subscribes to this instead of
 * passing its own `reload` as `onReconnected` to `startPersistentConnection`.
 */
export function subscribeTdahConnectionReconnected(listener: () => void): () => void {
    reconnectedListeners.add(listener);
    return () => {
        reconnectedListeners.delete(listener);
    };
}

/**
 * Story 2.2 glue: WS raw message -> parsed Activity-trigger event -> local
 * notification. Lives here per Code Map ("el parseo/branching del nuevo
 * evento debe vivir en su consumidor"), not in persistent-connection.ts
 * (whose `onMessage` stays a raw, event-agnostic pass-through) nor in
 * notification-service-local.ts (which only knows how to *show* a
 * notification, never what triggered it). Every string is resolved through
 * the same `resolveText(key, fallback)` seam `useRootLayoutTdahConnection`
 * already uses for N-05's strings.
 */
function handleTdahActivityTriggerEvent(event: TdahWsActivityTriggerEvent, resolveText: ResolveText): void {
    const title = buildTdahActivityNotificationTitle(event.title, event.durationMinutes);
    const body = event.edge === 'start'
        ? resolveText('tdahToday.activityStartNotificationBody', "It's time to start.")
        : resolveText('tdahToday.activityEndNotificationBody', "Time's up — see what's next.");

    void showTdahActivityNotification({
        key: `tdah-activity:${event.activityId}:${event.edge}`,
        title,
        message: body,
        vibrationPattern: getTdahActivityVibrationPattern(event.edge),
        actionLabels: {
            start: resolveText('tdahToday.activityStartActionLabel', 'Start'),
            complete: resolveText('tdahToday.activityCompleteActionLabel', 'Complete'),
            snooze: resolveText('tdahToday.activityPostponeActionLabel', 'Postpone +10 min'),
        },
        channelName: resolveText('tdahToday.activityNotificationChannelName', 'Activity reminders'),
        data: {
            kind: 'tdah-activity',
            // The existing native->JS open-payload path (both the live
            // OnNotificationOpened event and the Android cold-start payload
            // store — see apps/mobile/modules/notification-open-intents)
            // only forwards a fixed field allowlist that has no `activityId`
            // slot; `context` is the one generic passthrough field both
            // paths already carry end-to-end, so the Activity id rides there
            // instead of a new field this story can't add outside its owned
            // files.
            context: String(event.activityId),
            edge: event.edge,
        },
    }).catch((error) => {
        // Outcome evidence (#1028 convention): a failed notifier must be
        // distinguishable from a lost WS event. Id/edge level only — never
        // the notification's user-facing text.
        void logWarn('[Local Notifications] Failed to show TDAH Activity notification', {
            scope: 'notifications',
            extra: {
                error: error instanceof Error ? error.message : String(error),
                activityId: String(event.activityId),
                edge: event.edge,
            },
        });
    });
}

// There is no push signal for the mode flag flipping off elsewhere in the
// same foreground session (AD-1 forbids caching it client-side), so this
// hook re-checks on the same 30s cadence already established for this exact
// domain (TDAH_NOW_TICK_INTERVAL_MS in use-tdah-now.ts's midnight-rollover
// poll), plus every foreground transition — the same re-arm idiom
// persistent-capture-notification.ts already uses for this feature family.
const TDAH_MODE_POLL_INTERVAL_MS = 30_000;

/**
 * Root-layout owner of Story 2.1's persistent WS channel lifecycle. Mounted
 * once at the app root (alongside the other `use-root-layout-*` hooks) so
 * the channel opens/closes with Modo TDAH itself rather than with whichever
 * screen happens to be focused.
 */
export function useRootLayoutTdahConnection({ resolveText }: UseRootLayoutTdahConnectionParams): void {
    const connectionSupported = isPersistentConnectionSupported();
    const [pollTick, setPollTick] = useState(0);
    const resolveTextRef = useRef(resolveText);
    resolveTextRef.current = resolveText;

    // Re-checks the mode flag periodically and on every foreground
    // transition; `tdahModeActive` below re-fetches whenever `pollTick`
    // changes (same refreshKey contract the Menu sheet already uses).
    useEffect(() => {
        if (!connectionSupported) return undefined;
        const bump = () => setPollTick((tick) => tick + 1);
        const interval = setInterval(bump, TDAH_MODE_POLL_INTERVAL_MS);
        const subscription = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'active') bump();
        });
        return () => {
            clearInterval(interval);
            subscription.remove();
        };
    }, [connectionSupported]);

    const tdahModeActive = useTdahModeActive(connectionSupported ? pollTick : undefined);

    useEffect(() => {
        if (!connectionSupported || !tdahModeActive) return undefined;

        const handle = startPersistentConnection({
            strings: {
                connectedTitle: resolveTextRef.current('tdahToday.connectionNotificationTitle', 'Mindwtr connected'),
                connectedText: resolveTextRef.current('tdahToday.connectionNotificationText', "Your day's reminders are active"),
                reconnectingText: resolveTextRef.current('tdahToday.connectionNotificationReconnectingText', 'Reconnecting…'),
                channelName: resolveTextRef.current('tdahToday.connectionNotificationChannelName', 'Connection'),
            },
            onReconnected: () => {
                reconnectedListeners.forEach((listener) => listener());
            },
            onMessage: (data) => {
                const event = parseTdahWsActivityTriggerEvent(data);
                if (!event) return;
                handleTdahActivityTriggerEvent(event, resolveTextRef.current);
            },
        });
        const unsubscribe = handle.subscribe(publishConnectionState);
        publishConnectionState(handle.getState());

        return () => {
            unsubscribe();
            handle.stop();
            publishConnectionState(INITIAL_TDAH_CONNECTION_STATE);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connectionSupported, tdahModeActive]);
}

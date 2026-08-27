import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TdahTodayScreen } from './TdahTodayScreen';
import { TDAH_NOW_TICK_INTERVAL_MS } from './use-tdah-now';
import type { TdahActivity } from './tdah-today-types';

const hookState = vi.hoisted(() => ({
    phase: 'loading' as string,
    date: '2026-08-26' as string | null,
    timeZone: 'America/Mexico_City',
    routineTitle: null as string | null,
    activities: [] as TdahActivity[],
    reload: vi.fn(),
}));

vi.mock('./use-tdah-today', () => ({
    useTdahToday: () => hookState,
}));

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('expo-router', () => ({
    useRouter: () => router,
}));

vi.mock('@react-navigation/native', () => ({
    useFocusEffect: (callback: () => void | (() => void)) => {
        React.useEffect(callback, [callback]);
    },
}));

const networkListeners = vi.hoisted(() => [] as ((state: { isConnected: boolean | null }) => void)[]);
vi.mock('expo-network', () => ({
    addNetworkStateListener: (listener: (state: { isConnected: boolean | null }) => void) => {
        networkListeners.push(listener);
        return {
            remove: () => {
                const index = networkListeners.indexOf(listener);
                if (index !== -1) networkListeners.splice(index, 1);
            },
        };
    },
}));

type FakeConnectionState = { status: 'connected' | 'reconnecting' | 'offline'; consecutiveFailures: number };

// Wiring the screen actually reads (spec 2.1 I/O matrix: connection-dot +
// offline banner + reconnect reload) — TdahTodayScreen imports the
// subscribe/get functions from the root-layout hook module, not from
// `@/lib/persistent-connection` directly; that module only supplies
// isPersistentConnectionSupported/isIgnoringBatteryOptimizations/
// requestIgnoreBatteryOptimizations plus types.
const connection = vi.hoisted(() => ({
    supported: false,
    state: { status: 'connected', consecutiveFailures: 0 } as FakeConnectionState,
    stateListeners: new Set<(state: FakeConnectionState) => void>(),
    reconnectedListeners: new Set<() => void>(),
    batteryLimited: false,
    requestBatteryExemption: vi.fn(),
}));

vi.mock('@/lib/persistent-connection', () => ({
    isPersistentConnectionSupported: () => connection.supported,
    isIgnoringBatteryOptimizations: () => !connection.batteryLimited,
    requestIgnoreBatteryOptimizations: () => connection.requestBatteryExemption(),
}));

vi.mock('@/hooks/root-layout/use-root-layout-tdah-connection', () => ({
    getTdahConnectionState: () => connection.state,
    subscribeTdahConnectionState: (listener: (state: FakeConnectionState) => void) => {
        connection.stateListeners.add(listener);
        return () => connection.stateListeners.delete(listener);
    },
    subscribeTdahConnectionReconnected: (listener: () => void) => {
        connection.reconnectedListeners.add(listener);
        return () => connection.reconnectedListeners.delete(listener);
    },
}));

vi.mock('react-native-safe-area-context', () => ({
    SafeAreaView: (props: any) => React.createElement('SafeAreaView', props, props.children),
}));

vi.mock('lucide-react-native', () => ({
    Plus: (props: any) => React.createElement('Plus', props),
    Moon: (props: any) => React.createElement('Moon', props),
    Circle: (props: any) => React.createElement('Circle', props),
    CircleCheck: (props: any) => React.createElement('CircleCheck', props),
    CircleDashed: (props: any) => React.createElement('CircleDashed', props),
    CircleDot: (props: any) => React.createElement('CircleDot', props),
    CircleSlash: (props: any) => React.createElement('CircleSlash', props),
    CircleX: (props: any) => React.createElement('CircleX', props),
}));

const THEME = {
    bg: '#fff', text: '#0f172a', secondaryText: '#94a3b8', cardBg: '#fff', border: '#e2e8f0',
    filterBg: '#eef2f7', tint: '#3b82f6', onTint: '#fff', danger: '#ef4444',
    // TdahStatusGlyph reads these for the limbo/completed glyph colors —
    // omitting them left any color assertion for those two states
    // exercising `undefined` instead of a real value.
    warning: '#f59e0b', success: '#10b981',
    // surfaceContainerHigh in the token source's M3 mapping; primary = tint.
    taskItemBg: '#f1f5f9',
};

vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => THEME,
}));

vi.mock('@/hooks/use-filled-button-colors', () => ({
    useFilledButtonColors: () => ({ backgroundColor: '#3b82f6', textColor: '#fff' }),
}));

vi.mock('@/contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

const activity: TdahActivity = {
    id: 7, dayPlanDate: '2026-08-26', blockId: null, title: 'Caminadora', startTime: '09:30',
    durationMinutes: 30, origin: 'routine', state: 'pending', startedAt: null, completedAt: null,
};

const noTimeActivity: TdahActivity = {
    id: 8, dayPlanDate: '2026-08-26', blockId: null, title: 'Sin hora', startTime: null,
    durationMinutes: null, origin: 'manual', state: 'pending', startedAt: null, completedAt: null,
};

const flattenStyle = (style: unknown): Record<string, unknown> => (
    Array.isArray(style) ? Object.assign({}, ...style.map(flattenStyle)) : (style as Record<string, unknown>)
);

describe('TdahTodayScreen', () => {
    beforeEach(() => {
        hookState.phase = 'loading';
        hookState.date = '2026-08-26';
        hookState.routineTitle = null;
        hookState.activities = [];
        hookState.reload.mockReset();
        router.push.mockReset();
        networkListeners.length = 0;
        connection.supported = false;
        connection.state = { status: 'connected', consecutiveFailures: 0 };
        connection.stateListeners.clear();
        connection.reconnectedListeners.clear();
        connection.batteryLimited = false;
        connection.requestBatteryExemption.mockReset();
    });

    describe('Story 3.1 — manual "open ritual" header button (T-05\'s second manual-open entry)', () => {
        it('navigates to /tdah-ritual on tap, regardless of the day-fetch phase', async () => {
            hookState.phase = 'loading';
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahTodayScreen />); });

            const button = tree!.root.findByProps({ testID: 'tdah-today-open-ritual' });
            await act(async () => { button.props.onPress(); });
            expect(router.push).toHaveBeenCalledWith('/tdah-ritual');
        });

        it('is present in every day-fetch phase, not only "ready"', async () => {
            for (const phase of ['loading', 'error', 'empty', 'offline', 'unconfigured', 'ready']) {
                hookState.phase = phase;
                let tree: ReturnType<typeof create> | undefined;
                await act(async () => { tree = create(<TdahTodayScreen />); });
                expect(tree!.root.findByProps({ testID: 'tdah-today-open-ritual' })).toBeTruthy();
                await act(async () => { tree!.unmount(); });
            }
        });

        it('carries a hitSlop, same convention as this app\'s other small icon-only touch targets', async () => {
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahTodayScreen />); });

            const button = tree!.root.findByProps({ testID: 'tdah-today-open-ritual' });
            expect(button.props.hitSlop).toBe(8);
        });
    });

    it('reloads on focus (AD-1: every screen load is a fresh fetch)', async () => {
        await act(async () => {
            create(<TdahTodayScreen />);
        });
        expect(hookState.reload).toHaveBeenCalledTimes(1);
    });

    it('shows the loading state with the skeleton channel rows (AC: "skeleton con canal dibujado")', async () => {
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahTodayScreen />); });
        expect(tree!.root.findByProps({ testID: 'tdah-today-loading' })).toBeTruthy();
        [0, 1, 2].forEach((index) => {
            expect(tree!.root.findByProps({ testID: `tdah-today-skeleton-row-${index}` })).toBeTruthy();
        });
    });

    it('shows the error state with a working retry', async () => {
        hookState.phase = 'error';
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahTodayScreen />); });
        const retry = tree!.root.findByProps({ testID: 'tdah-today-retry' });
        await act(async () => { retry.props.onPress(); });
        expect(hookState.reload).toHaveBeenCalledTimes(2); // once on focus, once on retry tap
    });

    it('shows a dedicated offline state, never the ready timeline underneath it (AD-11)', async () => {
        hookState.phase = 'offline';
        hookState.activities = [activity];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahTodayScreen />); });
        expect(tree!.root.findByProps({ testID: 'tdah-today-offline' })).toBeTruthy();
        expect(tree!.root.findAllByProps({ testID: `tdah-activity-row-${activity.id}` })).toHaveLength(0);
    });

    it('shows the empty state with a CTA that opens the create screen', async () => {
        hookState.phase = 'empty';
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahTodayScreen />); });
        const cta = tree!.root.findByProps({ testID: 'tdah-today-add-manual-empty' });
        await act(async () => { cta.props.onPress(); });
        expect(router.push).toHaveBeenCalledWith('/tdah-activity/new');
    });

    it('renders the timeline with each Activity row when ready, and navigates on tap', async () => {
        hookState.phase = 'ready';
        hookState.routineTitle = 'Día laboral';
        hookState.activities = [activity];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahTodayScreen />); });

        const row = tree!.root.findByProps({ testID: `tdah-activity-row-${activity.id}` });
        await act(async () => { row.props.onPress(); });
        expect(router.push).toHaveBeenCalledWith(`/tdah-activity/${activity.id}`);

        const fab = tree!.root.findByProps({ testID: 'tdah-today-add-manual-fab' });
        await act(async () => { fab.props.onPress(); });
        expect(router.push).toHaveBeenCalledWith('/tdah-activity/new');
    });

    it('renders a no-time Activity in the trailing "sin hora" section instead of on the timed timeline', async () => {
        hookState.phase = 'ready';
        hookState.activities = [activity, noTimeActivity];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahTodayScreen />); });

        expect(tree!.root.findByProps({ testID: 'tdah-today-no-time-section' })).toBeTruthy();
        expect(tree!.root.findByProps({ testID: `tdah-activity-row-${activity.id}` })).toBeTruthy();
        expect(tree!.root.findByProps({ testID: `tdah-activity-row-${noTimeActivity.id}` })).toBeTruthy();
    });

    it('omits the "sin hora" section entirely when every Activity has a time', async () => {
        hookState.phase = 'ready';
        hookState.activities = [activity];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahTodayScreen />); });

        expect(tree!.root.findAllByProps({ testID: 'tdah-today-no-time-section' })).toHaveLength(0);
    });

    describe('unconfigured phase (UX-DR5: not an error, a way out)', () => {
        it('renders the unconfigured state with a Settings CTA instead of a dead-end retry', async () => {
            hookState.phase = 'unconfigured';
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahTodayScreen />); });

            expect(tree!.root.findByProps({ testID: 'tdah-today-unconfigured' })).toBeTruthy();
            expect(tree!.root.findAllByProps({ testID: 'tdah-today-retry' })).toHaveLength(0);

            const openSettings = tree!.root.findByProps({ testID: 'tdah-today-open-settings' });
            await act(async () => { openSettings.props.onPress(); });
            expect(router.push).toHaveBeenCalledWith('/settings');
        });
    });

    describe('offline -> online recovery (AD-11: the copy promises retrying)', () => {
        it('reloads when connectivity is restored during the offline phase', async () => {
            hookState.phase = 'offline';
            await act(async () => { create(<TdahTodayScreen />); });
            expect(hookState.reload).toHaveBeenCalledTimes(1); // focus only

            await act(async () => {
                networkListeners.forEach((listener) => listener({ isConnected: true }));
            });
            expect(hookState.reload).toHaveBeenCalledTimes(2);
        });

        it('guards against duplicate recovery reloads from a burst of connectivity events', async () => {
            hookState.phase = 'offline';
            await act(async () => { create(<TdahTodayScreen />); });

            await act(async () => {
                networkListeners.forEach((listener) => listener({ isConnected: true }));
                networkListeners.forEach((listener) => listener({ isConnected: true }));
                networkListeners.forEach((listener) => listener({ isConnected: true }));
            });
            expect(hookState.reload).toHaveBeenCalledTimes(2); // focus + exactly one recovery
        });

        it('ignores connectivity events that are not a restoration (isConnected false)', async () => {
            hookState.phase = 'offline';
            await act(async () => { create(<TdahTodayScreen />); });

            await act(async () => {
                networkListeners.forEach((listener) => listener({ isConnected: false }));
                networkListeners.forEach((listener) => listener({ isConnected: null }));
            });
            expect(hookState.reload).toHaveBeenCalledTimes(1);
        });

        it('subscribes only while in the offline phase and unsubscribes on unmount', async () => {
            hookState.phase = 'ready';
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahTodayScreen />); });
            expect(networkListeners).toHaveLength(0);

            hookState.phase = 'offline';
            await act(async () => { tree!.update(<TdahTodayScreen />); });
            expect(networkListeners).toHaveLength(1);

            await act(async () => { tree!.unmount(); });
            expect(networkListeners).toHaveLength(0);
        });
    });

    describe('midnight rollover in the profile zone', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('does not reload while the loaded day still matches the zone\'s day key', async () => {
            hookState.phase = 'ready';
            hookState.date = '2026-08-26';
            hookState.timeZone = 'UTC';
            vi.setSystemTime(new Date('2026-08-26T12:00:00Z'));

            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahTodayScreen />); });
            expect(hookState.reload).toHaveBeenCalledTimes(1);

            await act(async () => { vi.advanceTimersByTime(TDAH_NOW_TICK_INTERVAL_MS * 4); });
            expect(hookState.reload).toHaveBeenCalledTimes(1);

            await act(async () => { tree!.unmount(); });
        });

        it('reloads once the zone\'s day key rolls past the loaded date', async () => {
            hookState.phase = 'ready';
            hookState.date = '2026-08-26';
            hookState.timeZone = 'UTC';
            // 10s before local midnight; the next 30s tick lands past it.
            vi.setSystemTime(new Date('2026-08-26T23:59:50Z'));

            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahTodayScreen />); });
            expect(hookState.reload).toHaveBeenCalledTimes(1);

            await act(async () => { vi.advanceTimersByTime(TDAH_NOW_TICK_INTERVAL_MS); });
            expect(hookState.reload).toHaveBeenCalledTimes(2);

            await act(async () => { tree!.unmount(); });
        });

        it('cleans the interval up on unmount — no further reloads fire', async () => {
            hookState.phase = 'ready';
            hookState.date = '2026-08-26';
            hookState.timeZone = 'UTC';
            vi.setSystemTime(new Date('2026-08-26T23:59:50Z'));

            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahTodayScreen />); });
            await act(async () => { tree!.unmount(); });

            await act(async () => { vi.advanceTimersByTime(TDAH_NOW_TICK_INTERVAL_MS * 3); });
            expect(hookState.reload).toHaveBeenCalledTimes(1); // focus only
        });
    });

    describe('vigente emphasis (story 1.6 AC, AD-6: now resolved in the profile zone)', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('emphasizes exactly the Activity whose window contains now (pending/started only)', async () => {
            hookState.phase = 'ready';
            hookState.timeZone = 'America/Mexico_City'; // UTC-6, no DST
            const current: TdahActivity = {
                id: 21, dayPlanDate: '2026-08-26', blockId: null, title: 'Ahora toca', startTime: '09:30',
                durationMinutes: 60, origin: 'routine', state: 'pending', startedAt: null, completedAt: null,
            };
            const later: TdahActivity = {
                id: 22, dayPlanDate: '2026-08-26', blockId: null, title: 'Más tarde', startTime: '12:00',
                durationMinutes: 30, origin: 'routine', state: 'pending', startedAt: null, completedAt: null,
            };
            const doneOverlapping: TdahActivity = {
                id: 23, dayPlanDate: '2026-08-26', blockId: null, title: 'Ya terminada', startTime: '09:00',
                durationMinutes: 120, origin: 'routine', state: 'completed', startedAt: null, completedAt: null,
            };
            hookState.activities = [current, later, doneOverlapping];
            // 16:00 UTC == 10:00 in Mexico City: inside 21's [09:30, 10:30) and
            // 23's [09:00, 11:00), past 22's start.
            vi.setSystemTime(new Date('2026-08-26T16:00:00Z'));

            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahTodayScreen />); });

            const currentRow = flattenStyle(tree!.root.findByProps({ testID: 'tdah-activity-row-21' }).props.style);
            expect(currentRow.backgroundColor).toBe(THEME.taskItemBg);
            expect(currentRow.borderColor).toBe(THEME.tint);

            for (const id of [22, 23]) {
                const row = flattenStyle(tree!.root.findByProps({ testID: `tdah-activity-row-${id}` }).props.style);
                expect(row.backgroundColor).toBe(THEME.cardBg);
                expect(row.borderColor).toBe(THEME.border);
            }

            await act(async () => { tree!.unmount(); });
        });
    });

    describe('connection state (spec 2.1 I/O matrix: connection-dot + offline banner + reconnect reload)', () => {
        beforeEach(() => {
            connection.supported = true;
        });

        it('shows the connection banner once the connection state pushes offline (row: "VPS caído o inalcanzable tras reintentos sostenidos")', async () => {
            hookState.phase = 'ready';
            connection.state = { status: 'connected', consecutiveFailures: 0 };
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahTodayScreen />); });
            expect(tree!.root.findAllByProps({ testID: 'tdah-today-connection-banner' })).toHaveLength(0);

            await act(async () => {
                connection.stateListeners.forEach((listener) => listener({ status: 'offline', consecutiveFailures: 4 }));
            });
            expect(tree!.root.findByProps({ testID: 'tdah-today-connection-banner' })).toBeTruthy();
        });

        it('does not show the banner while reconnecting (row: "Pérdida de red momentánea" — sin banner todavía)', async () => {
            hookState.phase = 'ready';
            connection.state = { status: 'connected', consecutiveFailures: 0 };
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahTodayScreen />); });

            await act(async () => {
                connection.stateListeners.forEach((listener) => listener({ status: 'reconnecting', consecutiveFailures: 1 }));
            });
            expect(tree!.root.findAllByProps({ testID: 'tdah-today-connection-banner' })).toHaveLength(0);
            expect(tree!.root.findByProps({ testID: 'tdah-connection-dot-reconnecting' })).toBeTruthy();
        });

        it('shows no banner and a connected dot when the connection state is connected', async () => {
            hookState.phase = 'ready';
            connection.state = { status: 'connected', consecutiveFailures: 0 };
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahTodayScreen />); });

            expect(tree!.root.findAllByProps({ testID: 'tdah-today-connection-banner' })).toHaveLength(0);
            expect(tree!.root.findByProps({ testID: 'tdah-connection-dot-connected' })).toBeTruthy();
        });

        it("reloads the day's plan when the reconnected callback fires (row: \"Reconexión exitosa tras caída\" — sin acción del usuario)", async () => {
            hookState.phase = 'ready';
            connection.state = { status: 'connected', consecutiveFailures: 0 };
            await act(async () => { create(<TdahTodayScreen />); });
            expect(hookState.reload).toHaveBeenCalledTimes(1); // focus only

            await act(async () => {
                connection.reconnectedListeners.forEach((listener) => listener());
            });
            expect(hookState.reload).toHaveBeenCalledTimes(2);
        });

        it('suppresses the connection banner when the day-fetch phase is already offline (no double banner over the dedicated offline screen)', async () => {
            hookState.phase = 'offline';
            connection.state = { status: 'offline', consecutiveFailures: 4 };
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahTodayScreen />); });

            expect(tree!.root.findByProps({ testID: 'tdah-today-offline' })).toBeTruthy();
            expect(tree!.root.findAllByProps({ testID: 'tdah-today-connection-banner' })).toHaveLength(0);
        });

        it('suppresses the connection banner when the day-fetch phase is unconfigured (no double banner over the unconfigured screen)', async () => {
            hookState.phase = 'unconfigured';
            connection.state = { status: 'offline', consecutiveFailures: 4 };
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahTodayScreen />); });

            expect(tree!.root.findByProps({ testID: 'tdah-today-unconfigured' })).toBeTruthy();
            expect(tree!.root.findAllByProps({ testID: 'tdah-today-connection-banner' })).toHaveLength(0);
        });

        it('passes batteryLimited through to the connection dot when the battery-exemption permission is missing', async () => {
            hookState.phase = 'ready';
            connection.state = { status: 'connected', consecutiveFailures: 0 };
            connection.batteryLimited = true;
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahTodayScreen />); });

            expect(tree!.root.findByProps({ testID: 'tdah-connection-battery-chip' })).toBeTruthy();
        });
    });
});

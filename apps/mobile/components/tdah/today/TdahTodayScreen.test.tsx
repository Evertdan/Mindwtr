import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TdahTodayScreen } from './TdahTodayScreen';
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

vi.mock('react-native-safe-area-context', () => ({
    SafeAreaView: (props: any) => React.createElement('SafeAreaView', props, props.children),
}));

vi.mock('lucide-react-native', () => ({
    Plus: (props: any) => React.createElement('Plus', props),
    Circle: (props: any) => React.createElement('Circle', props),
    CircleCheck: (props: any) => React.createElement('CircleCheck', props),
    CircleDashed: (props: any) => React.createElement('CircleDashed', props),
    CircleDot: (props: any) => React.createElement('CircleDot', props),
    CircleSlash: (props: any) => React.createElement('CircleSlash', props),
    CircleX: (props: any) => React.createElement('CircleX', props),
}));

vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => ({
        bg: '#fff', text: '#0f172a', secondaryText: '#94a3b8', cardBg: '#fff', border: '#e2e8f0',
        filterBg: '#eef2f7', tint: '#3b82f6', onTint: '#fff', danger: '#ef4444',
        // TdahStatusGlyph reads these for the limbo/completed glyph colors —
        // omitting them left any color assertion for those two states
        // exercising `undefined` instead of a real value.
        warning: '#f59e0b', success: '#10b981',
    }),
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

describe('TdahTodayScreen', () => {
    beforeEach(() => {
        hookState.phase = 'loading';
        hookState.date = '2026-08-26';
        hookState.routineTitle = null;
        hookState.activities = [];
        hookState.reload.mockReset();
        router.push.mockReset();
    });

    it('reloads on focus (AD-1: every screen load is a fresh fetch)', async () => {
        await act(async () => {
            create(<TdahTodayScreen />);
        });
        expect(hookState.reload).toHaveBeenCalledTimes(1);
    });

    it('shows the loading state', async () => {
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahTodayScreen />); });
        expect(tree!.root.findByProps({ testID: 'tdah-today-loading' })).toBeTruthy();
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
});

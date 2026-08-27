import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudHttpError } from '@mindwtr/core';

import { TdahRitualScreen } from './TdahRitualScreen';
import type { TdahActivity } from './tdah-today-types';

vi.mock('@react-native-community/datetimepicker', () => ({
    __esModule: true,
    default: (props: any) => React.createElement('DateTimePicker', props),
}));

const { showToast } = vi.hoisted(() => ({
    showToast: vi.fn(),
}));
vi.mock('@/contexts/toast-context', () => ({
    useToast: () => ({ showToast, dismissToast: vi.fn() }),
}));

const hookState = vi.hoisted(() => ({
    phase: 'ready' as string,
    date: '2026-08-26' as string | null,
    timeZone: 'America/Mexico_City',
    activities: [] as TdahActivity[],
    reload: vi.fn(),
    decideActivity: vi.fn(),
}));

vi.mock('./use-tdah-ritual', () => ({
    useTdahRitual: () => hookState,
}));

const router = vi.hoisted(() => ({
    push: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
    canGoBack: vi.fn(() => true),
}));
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
        filterBg: '#eef2f7', tint: '#3b82f6', onTint: '#fff', danger: '#ef4444', success: '#10b981',
        warning: '#f59e0b',
    }),
}));

vi.mock('@/hooks/use-filled-button-colors', () => ({
    useFilledButtonColors: () => ({ backgroundColor: '#3b82f6', textColor: '#fff' }),
}));

const TRANSLATIONS: Record<string, string> = {
    'tdahToday.scoreboardOnTime': 'On time',
    'tdahToday.scoreboardMissed': 'Missed',
    'tdahToday.scoreboardLimbo': 'In limbo',
    'tdahToday.closeSummary': '{count} left undecided',
    'tdahToday.continueToMorning': 'Continue to Tomorrow',
};
vi.mock('@/contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => TRANSLATIONS[key] ?? key }),
}));

const missedActivity: TdahActivity = {
    id: 1, dayPlanDate: '2026-08-26', blockId: null, title: 'Correo', startTime: '09:00',
    durationMinutes: 30, origin: 'manual', state: 'missed', startedAt: null, completedAt: null,
};
const limboActivity: TdahActivity = {
    id: 2, dayPlanDate: '2026-08-26', blockId: null, title: 'Reporte', startTime: null,
    durationMinutes: null, origin: 'manual', state: 'limbo', startedAt: null, completedAt: null,
};
const completedActivity: TdahActivity = {
    id: 3, dayPlanDate: '2026-08-26', blockId: null, title: 'Ejercicio', startTime: '07:00',
    durationMinutes: 20, origin: 'routine', state: 'completed',
    startedAt: '2026-08-26T13:00:00.000Z', completedAt: '2026-08-26T13:20:00.000Z',
};

describe('TdahRitualScreen — screen states', () => {
    beforeEach(() => {
        hookState.phase = 'ready';
        hookState.activities = [];
        hookState.reload.mockReset();
        hookState.decideActivity.mockReset();
        showToast.mockReset();
        router.push.mockReset();
    });

    it('shows the loading state', async () => {
        hookState.phase = 'loading';
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahRitualScreen />); });
        expect(tree!.root.findByProps({ testID: 'tdah-ritual-loading' })).toBeTruthy();
    });

    it('shows the offline state with a retry that reloads (AD-11: never a phantom list)', async () => {
        hookState.phase = 'offline';
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahRitualScreen />); });
        expect(tree!.root.findByProps({ testID: 'tdah-ritual-offline' })).toBeTruthy();
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-ritual-retry' }).props.onPress();
        });
        expect(hookState.reload).toHaveBeenCalled();
    });

    it('shows the error state with a retry that reloads', async () => {
        hookState.phase = 'error';
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahRitualScreen />); });
        expect(tree!.root.findByProps({ testID: 'tdah-ritual-error' })).toBeTruthy();
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-ritual-retry' }).props.onPress();
        });
        expect(hookState.reload).toHaveBeenCalled();
    });

    it('shows the unconfigured state, never a dead-end error loop, with a CTA that opens Settings (UX-DR5: never a Retry that can never succeed)', async () => {
        hookState.phase = 'unconfigured';
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahRitualScreen />); });
        expect(tree!.root.findByProps({ testID: 'tdah-ritual-unconfigured' })).toBeTruthy();

        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-ritual-open-settings' }).props.onPress();
        });
        expect(router.push).toHaveBeenCalledWith('/settings');
    });

    it('reloads on every focus (AD-1)', async () => {
        await act(async () => { create(<TdahRitualScreen />); });
        expect(hookState.reload).toHaveBeenCalledTimes(1);
    });
});

describe('TdahRitualScreen — scoreboard', () => {
    beforeEach(() => {
        hookState.phase = 'ready';
        hookState.activities = [missedActivity, limboActivity, completedActivity];
        hookState.reload.mockReset();
        hookState.decideActivity.mockReset();
        showToast.mockReset();
        router.push.mockReset();
    });

    it('shows three equal-weight figures: on-time, missed, and limbo counts — no percentage, no medals', async () => {
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahRitualScreen />); });

        const onTime = tree!.root.findByProps({ testID: 'tdah-ritual-scoreboard-on-time' });
        const missed = tree!.root.findByProps({ testID: 'tdah-ritual-scoreboard-missed' });
        const limbo = tree!.root.findByProps({ testID: 'tdah-ritual-scoreboard-limbo' });

        expect(onTime.findAllByType(Text).map((node) => node.props.children).flat()).toContain(1);
        expect(missed.findAllByType(Text).map((node) => node.props.children).flat()).toContain(1);
        expect(limbo.findAllByType(Text).map((node) => node.props.children).flat()).toContain(1);
    });

    it('renders read-only hours (startedAt/completedAt), never the planned startTime as if it were real', async () => {
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahRitualScreen />); });
        const texts = tree!.root.findAllByType(Text).map((node) => node.props.children).flat();
        expect(texts).toContain('Started: 07:00');
        expect(texts).toContain('Completed: 07:20');
    });

    it('renders a DecisionChip only for missed/limbo rows, never for completed/pending/started/discarded ones', async () => {
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahRitualScreen />); });
        // { deep: false } avoids double-counting the shim's own composite
        // View wrapper alongside the host element it renders — both carry
        // the same testID prop.
        expect(tree!.root.findAllByProps({ testID: 'tdah-decision-chip-1' }, { deep: false })).toHaveLength(1);
        expect(tree!.root.findAllByProps({ testID: 'tdah-decision-chip-2' }, { deep: false })).toHaveLength(1);
        expect(tree!.root.findAllByProps({ testID: 'tdah-decision-chip-3' }, { deep: false })).toHaveLength(0);
    });

    it('shows "N left undecided" while missed/limbo rows remain undecided, and hides it once N reaches 0', async () => {
        hookState.decideActivity.mockResolvedValue({ ...missedActivity, state: 'pending', dayPlanDate: '2026-08-27' });
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahRitualScreen />); });
        expect(tree!.root.findByProps({ testID: 'tdah-ritual-summary' }).props.children).toBe('2 left undecided');

        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-decision-chip-1-move-tomorrow' }).props.onPress();
        });
        expect(tree!.root.findByProps({ testID: 'tdah-ritual-summary' }).props.children).toBe('1 left undecided');

        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-decision-chip-2-undated' }).props.onPress();
        });
        expect(tree!.root.findAllByProps({ testID: 'tdah-ritual-summary' })).toHaveLength(0);
    });
});

describe('TdahRitualScreen — applying a decision', () => {
    beforeEach(() => {
        hookState.phase = 'ready';
        hookState.activities = [missedActivity];
        hookState.reload.mockReset();
        hookState.decideActivity.mockReset();
        showToast.mockReset();
        router.push.mockReset();
    });

    it('calls decideActivity with the activity id and request, then collapses the row only after the 200 (spec Always: never before)', async () => {
        hookState.decideActivity.mockResolvedValue({ ...missedActivity, state: 'pending', dayPlanDate: '2026-08-27' });
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahRitualScreen />); });

        expect(tree!.root.findByProps({ testID: 'tdah-ritual-row-1' }).props.style).toEqual(
            expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
        );

        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-decision-chip-1-move-tomorrow' }).props.onPress();
        });

        expect(hookState.decideActivity).toHaveBeenCalledWith(1, { decision: 'move-tomorrow' });
        expect(tree!.root.findByProps({ testID: 'tdah-ritual-row-1' }).props.style).toEqual(
            expect.arrayContaining([expect.objectContaining({ opacity: 0.5 })]),
        );
        expect(tree!.root.findAllByProps({ testID: 'tdah-decision-chip-1' })).toHaveLength(0);
    });

    it('never mutates the row\'s own hours/glyph after a decision — the recap keeps showing the day\'s real, original outcome', async () => {
        hookState.decideActivity.mockResolvedValue({
            ...missedActivity, state: 'pending', dayPlanDate: '2026-08-27', startedAt: null, completedAt: null,
        });
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahRitualScreen />); });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-decision-chip-1-move-tomorrow' }).props.onPress();
        });

        const texts = tree!.root.findAllByType(Text).map((node) => node.props.children).flat();
        expect(texts.join(' ')).toContain('Correo');
    });

    it('shows an error-tone toast and leaves the row un-collapsed when the server rejects the decision (e.g. a past date, 400)', async () => {
        hookState.decideActivity.mockRejectedValue(new CloudHttpError('Cloud POST failed (400): Bad Request', 400));
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahRitualScreen />); });

        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-decision-chip-1-discard' }).props.onPress();
        });

        // The rejected-decision copy specifically — not the offline copy —
        // and no title (this is a real server rejection, not connectivity).
        expect(showToast).toHaveBeenCalledWith({
            message: 'Could not complete the action. Try again.',
            tone: 'error',
        });
        expect(tree!.root.findAllByProps({ testID: 'tdah-decision-chip-1' }, { deep: false })).toHaveLength(1);
        expect(tree!.root.findByProps({ testID: 'tdah-ritual-row-1' }).props.style).toEqual(
            expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
        );
    });

    it('shows an error-tone offline toast on a real network failure, without an optimistic edit', async () => {
        hookState.decideActivity.mockRejectedValue(new Error('network down'));
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahRitualScreen />); });

        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-decision-chip-1-discard' }).props.onPress();
        });

        // The offline copy specifically — a real 400 rejection must never
        // show this "you're offline" title/message.
        expect(showToast).toHaveBeenCalledWith({
            title: 'Offline',
            message: 'No internet connection. The action was not registered.',
            tone: 'error',
        });
        expect(tree!.root.findAllByProps({ testID: 'tdah-decision-chip-1' }, { deep: false })).toHaveLength(1);
    });
});

describe('TdahRitualScreen — Continuar a Mañana', () => {
    beforeEach(() => {
        hookState.phase = 'ready';
        hookState.reload.mockReset();
        hookState.decideActivity.mockReset();
        showToast.mockReset();
        router.push.mockReset();
    });

    it('navigates to T-06 with zero-count params even with undecided Activities remaining (deciding is never mandatory)', async () => {
        hookState.activities = [missedActivity, limboActivity];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahRitualScreen />); });

        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-ritual-continue' }).props.onPress();
        });

        // Both rows are undecided (spec: "al Limbo" = no decididas + 'undated').
        expect(router.push).toHaveBeenCalledWith({
            pathname: '/tdah-morning',
            params: { movedTomorrow: '0', movedDate: '0', discarded: '0', limbo: '2' },
        });
    });

    it('navigates to T-06 with zero-count params with zero Activities decided', async () => {
        hookState.activities = [];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahRitualScreen />); });

        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-ritual-continue' }).props.onPress();
        });

        expect(router.push).toHaveBeenCalledWith({
            pathname: '/tdah-morning',
            params: { movedTomorrow: '0', movedDate: '0', discarded: '0', limbo: '0' },
        });
    });

    it('forwards per-decision counts (move-tomorrow/move-date/discard) plus Limbo (undecided + undated)', async () => {
        const missed2: TdahActivity = { ...missedActivity, id: 4 };
        const missed3: TdahActivity = { ...missedActivity, id: 5 };
        const limbo2: TdahActivity = { ...limboActivity, id: 6 };
        hookState.activities = [missedActivity, missed2, missed3, limboActivity, limbo2];
        hookState.decideActivity.mockImplementation(async (activityId: number) => ({
            ...missedActivity, id: activityId, state: 'pending', dayPlanDate: '2026-08-27',
        }));
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahRitualScreen />); });

        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-decision-chip-1-move-tomorrow' }).props.onPress();
        });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-decision-chip-4-discard' }).props.onPress();
        });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-decision-chip-2-undated' }).props.onPress();
        });
        // 5 (missed3) and 6 (limbo2) are left fully undecided.

        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-ritual-continue' }).props.onPress();
        });

        expect(router.push).toHaveBeenCalledWith({
            pathname: '/tdah-morning',
            params: { movedTomorrow: '1', movedDate: '0', discarded: '1', limbo: '3' },
        });
    });
});

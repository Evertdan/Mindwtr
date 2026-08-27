import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TdahActivityDetailScreen } from './TdahActivityDetailScreen';
import type { TdahActivity } from './tdah-today-types';

const hookState = vi.hoisted(() => ({
    phase: 'ready' as string,
    routineTitle: null as string | null,
    activities: [] as TdahActivity[],
    reload: vi.fn(),
    createManualActivity: vi.fn(),
    registerActivityAction: vi.fn(),
}));

vi.mock('./use-tdah-today', () => ({
    useTdahToday: () => hookState,
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

vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => ({
        bg: '#fff', text: '#0f172a', secondaryText: '#94a3b8', border: '#e2e8f0',
        filterBg: '#eef2f7', tint: '#3b82f6', onTint: '#fff', danger: '#ef4444', success: '#10b981',
        inputBg: '#f8fafc',
    }),
}));

vi.mock('@/hooks/use-filled-button-colors', () => ({
    useFilledButtonColors: () => ({ backgroundColor: '#3b82f6', textColor: '#fff' }),
}));

vi.mock('@/contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

const activity: TdahActivity = {
    id: 5, dayPlanDate: '2026-08-26', blockId: null, title: 'Caminadora', startTime: '09:30',
    durationMinutes: 30, origin: 'manual', state: 'pending', startedAt: null, completedAt: null,
};

describe('TdahActivityDetailScreen — create mode', () => {
    beforeEach(() => {
        hookState.phase = 'ready';
        hookState.activities = [];
        hookState.createManualActivity.mockReset();
        hookState.registerActivityAction.mockReset();
        router.back.mockReset();
        router.canGoBack.mockReset().mockReturnValue(true);
    });

    it('disables Save until a non-empty title is entered', async () => {
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="create" />); });
        expect(tree!.root.findByProps({ testID: 'tdah-activity-save' }).props.accessibilityState.disabled).toBe(true);

        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-activity-title-input' }).props.onChangeText('Leer');
        });
        expect(tree!.root.findByProps({ testID: 'tdah-activity-save' }).props.accessibilityState.disabled).toBe(false);
    });

    it('keeps Save disabled while the optional startTime is malformed', async () => {
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="create" />); });
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-activity-title-input' }).props.onChangeText('Leer');
            tree!.root.findByProps({ testID: 'tdah-activity-start-time-input' }).props.onChangeText('9h30');
        });
        expect(tree!.root.findByProps({ testID: 'tdah-activity-save' }).props.accessibilityState.disabled).toBe(true);
    });

    it('submits the trimmed title plus optional fields, then navigates back', async () => {
        hookState.createManualActivity.mockResolvedValue(activity);
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="create" />); });
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-activity-title-input' }).props.onChangeText('  Leer  ');
            tree!.root.findByProps({ testID: 'tdah-activity-start-time-input' }).props.onChangeText('09:30');
            tree!.root.findByProps({ testID: 'tdah-activity-duration-input' }).props.onChangeText('30');
        });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-activity-save' }).props.onPress();
        });

        expect(hookState.createManualActivity).toHaveBeenCalledWith({ title: 'Leer', startTime: '09:30', durationMinutes: 30 });
        expect(router.back).toHaveBeenCalledTimes(1);
    });

    it('omits startTime/durationMinutes entirely (never a defaulted value) when the user leaves them empty (FR-4/doc 02: genuinely optional)', async () => {
        hookState.createManualActivity.mockResolvedValue({ ...activity, startTime: null, durationMinutes: null });
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="create" />); });
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-activity-title-input' }).props.onChangeText('Sin hora');
        });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-activity-save' }).props.onPress();
        });

        expect(hookState.createManualActivity).toHaveBeenCalledWith({ title: 'Sin hora' });
        const [[calledWith]] = hookState.createManualActivity.mock.calls;
        expect(calledWith).not.toHaveProperty('startTime');
        expect(calledWith).not.toHaveProperty('durationMinutes');
        expect(router.back).toHaveBeenCalledTimes(1);
    });

    it('shows a generic error banner and stays on the form when creation fails', async () => {
        hookState.createManualActivity.mockRejectedValue(new Error('network down'));
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="create" />); });
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-activity-title-input' }).props.onChangeText('Leer');
        });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-activity-save' }).props.onPress();
        });

        expect(tree!.root.findByProps({ testID: 'tdah-activity-create-error' })).toBeTruthy();
        expect(router.back).not.toHaveBeenCalled();
    });
});

describe('TdahActivityDetailScreen — view mode', () => {
    beforeEach(() => {
        hookState.phase = 'ready';
        hookState.activities = [activity];
        hookState.reload.mockReset();
        hookState.registerActivityAction.mockReset();
    });

    it('shows a not-found fallback when the Activity id is not in today\'s activities', async () => {
        hookState.activities = [];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="view" activityId={999} />); });
        expect(tree!.root.findByProps({ testID: 'tdah-activity-not-found' })).toBeTruthy();
    });

    it('enables Start only while pending, and disables it once started', async () => {
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="view" activityId={5} />); });
        expect(tree!.root.findByProps({ testID: 'tdah-activity-action-start' }).props.disabled).toBe(false);

        hookState.activities = [{ ...activity, state: 'started', startedAt: '2026-08-26T09:30:00.000Z' }];
        await act(async () => { tree!.update(<TdahActivityDetailScreen mode="view" activityId={5} />); });
        expect(tree!.root.findByProps({ testID: 'tdah-activity-action-start' }).props.disabled).toBe(true);
    });

    it('registers "start" via the hook on tap', async () => {
        hookState.registerActivityAction.mockResolvedValue({ ...activity, state: 'started' });
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="view" activityId={5} />); });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-activity-action-start' }).props.onPress();
        });
        expect(hookState.registerActivityAction).toHaveBeenCalledWith(5, 'start');
    });

    it('disables Completed/Not completed once the Activity is no longer pending/started', async () => {
        hookState.activities = [{ ...activity, state: 'completed', completedAt: '2026-08-26T10:00:00.000Z' }];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="view" activityId={5} />); });
        expect(tree!.root.findByProps({ testID: 'tdah-activity-action-complete' }).props.disabled).toBe(true);
        expect(tree!.root.findByProps({ testID: 'tdah-activity-action-miss' }).props.disabled).toBe(true);
    });

    it('shows an error banner when a registration action fails, without crashing', async () => {
        hookState.registerActivityAction.mockRejectedValue(new Error('network down'));
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="view" activityId={5} />); });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-activity-action-start' }).props.onPress();
        });
        expect(tree!.root.findByProps({ testID: 'tdah-activity-action-error' })).toBeTruthy();
    });

    it('clears the error banner and reflects the new state after a successful retry of the same action', async () => {
        hookState.registerActivityAction.mockRejectedValueOnce(new Error('network down'));
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="view" activityId={5} />); });

        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-activity-action-start' }).props.onPress();
        });
        expect(tree!.root.findByProps({ testID: 'tdah-activity-action-error' })).toBeTruthy();

        hookState.registerActivityAction.mockResolvedValueOnce({
            ...activity,
            state: 'started',
            startedAt: '2026-08-26T09:30:00.000Z',
        });
        hookState.activities = [{ ...activity, state: 'started', startedAt: '2026-08-26T09:30:00.000Z' }];
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-activity-action-start' }).props.onPress();
        });
        await act(async () => {
            tree!.update(<TdahActivityDetailScreen mode="view" activityId={5} />);
        });

        expect(tree!.root.findAllByProps({ testID: 'tdah-activity-action-error' })).toHaveLength(0);
        expect(hookState.registerActivityAction).toHaveBeenCalledTimes(2);
        expect(tree!.root.findByProps({ testID: 'tdah-activity-action-start' }).props.disabled).toBe(true);
    });

    it('shows the "No time" fallback (never a blank/garbled value) for a null startTime, and hides the duration field for a null durationMinutes', async () => {
        hookState.activities = [{ ...activity, startTime: null, durationMinutes: null }];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="view" activityId={5} />); });
        const texts = tree!.root.findAllByType(Text).map((node) => node.props.children);
        expect(texts.flat()).toContain('No time');
        expect(texts.flat().join(' ')).not.toMatch(/\bmin\b/);
    });

    it('shows the offline/error state with a retry that reloads', async () => {
        hookState.phase = 'offline';
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="view" activityId={5} />); });
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-activity-retry' }).props.onPress();
        });
        expect(hookState.reload).toHaveBeenCalled();
    });
});

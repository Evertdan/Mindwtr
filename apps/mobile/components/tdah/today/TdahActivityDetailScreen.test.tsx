import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudHttpError } from '@mindwtr/core';

import { TdahActivityDetailScreen } from './TdahActivityDetailScreen';
import type { TdahActivity } from './tdah-today-types';

const { showToast } = vi.hoisted(() => ({
    showToast: vi.fn(),
}));
vi.mock('@/contexts/toast-context', () => ({
    useToast: () => ({ showToast, dismissToast: vi.fn() }),
}));

const hookState = vi.hoisted(() => ({
    phase: 'ready' as string,
    timeZone: 'America/Mexico_City',
    routineTitle: null as string | null,
    activities: [] as TdahActivity[],
    reload: vi.fn(),
    createManualActivity: vi.fn(),
    registerActivityAction: vi.fn(),
}));

vi.mock('./use-tdah-today', () => ({
    useTdahToday: () => hookState,
}));

// Story 3.3: TdahActivityDetailScreen now also always instantiates
// useTdahMorning() (Code Map: "ambos hooks se instancian condicionalmente
// sin violar Rules of Hooks") — mocked separately so a targetDate='tomorrow'
// submit can be asserted against its own addManualActivity spy, distinct
// from useTdahToday's createManualActivity above.
const morningHookState = vi.hoisted(() => ({
    addManualActivity: vi.fn(),
}));
vi.mock('./use-tdah-morning', () => ({
    useTdahMorning: () => morningHookState,
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
        hookState.reload.mockReset();
        morningHookState.addManualActivity.mockReset();
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

    it('without targetDate, never fetches useTdahMorning\'s own reload (only useTdahToday reloads today\'s day)', async () => {
        await act(async () => { create(<TdahActivityDetailScreen mode="create" />); });
        expect(hookState.reload).toHaveBeenCalledTimes(1);
    });
});

describe('TdahActivityDetailScreen — create mode, story 3.3 targetDate="tomorrow" (T-06\'s own "Agregar manual")', () => {
    beforeEach(() => {
        hookState.phase = 'ready';
        hookState.activities = [];
        hookState.createManualActivity.mockReset();
        hookState.reload.mockReset();
        morningHookState.addManualActivity.mockReset();
        router.back.mockReset();
        router.canGoBack.mockReset().mockReturnValue(true);
    });

    it('submits via useTdahMorning\'s addManualActivity, never useTdahToday\'s createManualActivity, and never fetches useTdahToday\'s "hoy" day (spec Always: independent of "hoy")', async () => {
        morningHookState.addManualActivity.mockResolvedValue({ ...activity, dayPlanDate: '2026-08-27' });
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="create" targetDate="tomorrow" />); });
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-activity-title-input' }).props.onChangeText('Para mañana');
        });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-activity-save' }).props.onPress();
        });

        expect(morningHookState.addManualActivity).toHaveBeenCalledWith({ title: 'Para mañana' });
        expect(hookState.createManualActivity).not.toHaveBeenCalled();
        expect(hookState.reload).not.toHaveBeenCalled();
        expect(router.back).toHaveBeenCalledTimes(1);
    });

    it('shows the generic error banner and stays on the form when the tomorrow submission fails', async () => {
        morningHookState.addManualActivity.mockRejectedValue(new Error('network down'));
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="create" targetDate="tomorrow" />); });
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-activity-title-input' }).props.onChangeText('Para mañana');
        });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-activity-save' }).props.onPress();
        });

        expect(tree!.root.findByProps({ testID: 'tdah-activity-create-error' })).toBeTruthy();
        expect(router.back).not.toHaveBeenCalled();
    });

    it('targetDate="today" (explicit) behaves exactly like the omitted/default case — uses useTdahToday, still reloads', async () => {
        hookState.createManualActivity.mockResolvedValue(activity);
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="create" targetDate="today" />); });
        expect(hookState.reload).toHaveBeenCalledTimes(1);
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-activity-title-input' }).props.onChangeText('Hoy');
        });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-activity-save' }).props.onPress();
        });
        expect(hookState.createManualActivity).toHaveBeenCalledWith({ title: 'Hoy' });
        expect(morningHookState.addManualActivity).not.toHaveBeenCalled();
    });
});

describe('TdahActivityDetailScreen — view mode', () => {
    beforeEach(() => {
        hookState.phase = 'ready';
        hookState.activities = [activity];
        hookState.reload.mockReset();
        hookState.registerActivityAction.mockReset();
        showToast.mockReset();
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

    it('shows a visible error-tone toast when a registration action fails offline, from a manual tap (spec Always: never queued silently)', async () => {
        hookState.registerActivityAction.mockRejectedValue(new Error('network down'));
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="view" activityId={5} />); });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-activity-action-start' }).props.onPress();
        });
        expect(showToast).toHaveBeenCalledTimes(1);
        expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    });

    it('stays fully silent (no toast, no error banner) when the server rejects a redundant action with a 400', async () => {
        hookState.registerActivityAction.mockRejectedValue(new CloudHttpError('Cloud POST failed (400): Bad Request', 400));
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="view" activityId={5} />); });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-activity-action-start' }).props.onPress();
        });
        expect(tree!.root.findAllByProps({ testID: 'tdah-activity-action-error' })).toHaveLength(0);
        expect(showToast).not.toHaveBeenCalled();
    });

    it('shows the error banner but no toast when the server rejects with a non-400 status (a real, non-network failure)', async () => {
        hookState.registerActivityAction.mockRejectedValue(new CloudHttpError('Cloud POST failed (500): Server Error', 500));
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="view" activityId={5} />); });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-activity-action-start' }).props.onPress();
        });
        expect(tree!.root.findByProps({ testID: 'tdah-activity-action-error' })).toBeTruthy();
        expect(showToast).not.toHaveBeenCalled();
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

    it('renders startedAt/completedAt in the profile time zone (AD-6: one clock everywhere), not the device zone', async () => {
        hookState.phase = 'ready';
        hookState.timeZone = 'America/Mexico_City'; // UTC-6, no DST
        hookState.activities = [{
            ...activity,
            state: 'started',
            startedAt: '2026-08-26T15:30:00.000Z', // 09:30 in Mexico City
            completedAt: '2026-08-26T16:00:00.000Z', // 10:00 in Mexico City
        }];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="view" activityId={5} />); });

        const texts = tree!.root.findAllByType(Text).map((node) => node.props.children);
        expect(texts.flat()).toContain('Started: 09:30');
        expect(texts.flat()).toContain('Completed: 10:00');
        // A device-zone implementation on a UTC test runner would render 15:30/16:00.
        expect(texts.flat().join(' ')).not.toContain('15:30');
        expect(texts.flat().join(' ')).not.toContain('16:00');
    });

    it('falls back to the raw instant string when it cannot be formatted, without crashing', async () => {
        hookState.phase = 'ready';
        hookState.activities = [{ ...activity, state: 'started', startedAt: 'not-an-instant', completedAt: null }];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahActivityDetailScreen mode="view" activityId={5} />); });

        const texts = tree!.root.findAllByType(Text).map((node) => node.props.children);
        expect(texts.flat()).toContain('Started: not-an-instant');
    });
});

describe('TdahActivityDetailScreen — view mode, story 2.3 notification autoAction', () => {
    beforeEach(() => {
        hookState.phase = 'ready';
        hookState.activities = [activity];
        hookState.reload.mockReset();
        hookState.registerActivityAction.mockReset();
        showToast.mockReset();
    });

    it("fires the notification-tapped 'start' action automatically once the pending Activity resolves on mount", async () => {
        hookState.registerActivityAction.mockResolvedValue({ ...activity, state: 'started' });
        await act(async () => {
            create(<TdahActivityDetailScreen mode="view" activityId={5} autoAction="start" />);
        });
        expect(hookState.registerActivityAction).toHaveBeenCalledTimes(1);
        expect(hookState.registerActivityAction).toHaveBeenCalledWith(5, 'start');
    });

    it("fires the notification-tapped 'complete' action automatically once the started Activity resolves on mount", async () => {
        hookState.activities = [{ ...activity, state: 'started', startedAt: '2026-08-26T09:30:00.000Z' }];
        hookState.registerActivityAction.mockResolvedValue({ ...activity, state: 'completed' });
        await act(async () => {
            create(<TdahActivityDetailScreen mode="view" activityId={5} autoAction="complete" />);
        });
        expect(hookState.registerActivityAction).toHaveBeenCalledTimes(1);
        expect(hookState.registerActivityAction).toHaveBeenCalledWith(5, 'complete');
    });

    it('never fires the automatic action twice in the same mount, even after the Activity re-renders with fresh data', async () => {
        hookState.registerActivityAction.mockResolvedValue({ ...activity, state: 'started', startedAt: '2026-08-26T09:30:00.000Z' });
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => {
            tree = create(<TdahActivityDetailScreen mode="view" activityId={5} autoAction="start" />);
        });
        expect(hookState.registerActivityAction).toHaveBeenCalledTimes(1);

        // Simulate the merged post-mutation state (and a later, unrelated
        // reload) re-rendering the same mounted screen.
        hookState.activities = [{ ...activity, state: 'started', startedAt: '2026-08-26T09:30:00.000Z' }];
        await act(async () => {
            tree!.update(<TdahActivityDetailScreen mode="view" activityId={5} autoAction="start" />);
        });

        expect(hookState.registerActivityAction).toHaveBeenCalledTimes(1);
    });

    it('does not fire the automatic action when the Activity is already past the state the tapped action still allows', async () => {
        hookState.activities = [{ ...activity, state: 'completed', completedAt: '2026-08-26T10:00:00.000Z' }];
        await act(async () => {
            create(<TdahActivityDetailScreen mode="view" activityId={5} autoAction="start" />);
        });
        expect(hookState.registerActivityAction).not.toHaveBeenCalled();
    });

    // Parity with the manual "Completada" button (story 1.6), which already
    // allows completing a still-pending Activity (never-started) — the
    // notification-tapped 'complete' action is held to the same guard
    // (registerDisabled), not a stricter one.
    it("fires the notification-tapped 'complete' action on a still-pending Activity that was never manually started", async () => {
        hookState.activities = [{ ...activity, state: 'pending' }];
        hookState.registerActivityAction.mockResolvedValue({ ...activity, state: 'completed' });
        await act(async () => {
            create(<TdahActivityDetailScreen mode="view" activityId={5} autoAction="complete" />);
        });
        expect(hookState.registerActivityAction).toHaveBeenCalledTimes(1);
        expect(hookState.registerActivityAction).toHaveBeenCalledWith(5, 'complete');
    });

    it('never attempts the automatic action, and renders the not-found fallback, when the Activity id is not in today\'s activities', async () => {
        hookState.activities = [];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => {
            tree = create(<TdahActivityDetailScreen mode="view" activityId={5} autoAction="start" />);
        });
        expect(hookState.registerActivityAction).not.toHaveBeenCalled();
        expect(tree!.root.findByProps({ testID: 'tdah-activity-not-found' })).toBeTruthy();
    });

    it('shows a visible error-tone toast when the automatic action fails offline, never queuing it silently', async () => {
        hookState.registerActivityAction.mockRejectedValue(new Error('network down'));
        await act(async () => {
            create(<TdahActivityDetailScreen mode="view" activityId={5} autoAction="start" />);
        });
        expect(showToast).toHaveBeenCalledTimes(1);
        expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'error' }));
    });

    it('stays fully silent when the automatic action is rejected with a 400 because another device already registered it', async () => {
        hookState.registerActivityAction.mockRejectedValue(new CloudHttpError('Cloud POST failed (400): Bad Request', 400));
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => {
            tree = create(<TdahActivityDetailScreen mode="view" activityId={5} autoAction="start" />);
        });
        expect(tree!.root.findAllByProps({ testID: 'tdah-activity-action-error' })).toHaveLength(0);
        expect(showToast).not.toHaveBeenCalled();
    });

    it('never fires an automatic action when no autoAction param is passed (pre-2.3 behavior intact)', async () => {
        await act(async () => {
            create(<TdahActivityDetailScreen mode="view" activityId={5} />);
        });
        expect(hookState.registerActivityAction).not.toHaveBeenCalled();
    });
});

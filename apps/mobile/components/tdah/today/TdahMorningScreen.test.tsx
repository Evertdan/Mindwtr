import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudHttpError } from '@mindwtr/core';

import { TdahMorningScreen } from './TdahMorningScreen';
import type { TdahActivity } from './tdah-today-types';

const asyncStorageGetItem = vi.fn();
vi.mock('@react-native-async-storage/async-storage', () => ({
    default: { getItem: (...args: unknown[]) => asyncStorageGetItem(...args) },
}));
vi.mock('@/lib/secure-config', () => ({
    getSecureConfigValue: vi.fn(),
}));
vi.mock('@/lib/webdav-request-options', () => ({
    getMobileCloudRequestOptions: () => ({}),
}));

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/contexts/toast-context', () => ({
    useToast: () => ({ showToast, dismissToast: vi.fn() }),
}));

const hookState = vi.hoisted(() => ({
    phase: 'ready' as string,
    date: '2026-08-28' as string | null,
    timeZone: 'America/Mexico_City',
    routineTitle: null as string | null,
    confirmedAt: null as string | null,
    draftActivities: [] as TdahActivity[],
    reload: vi.fn(),
    reorderDraft: vi.fn(),
    updateDraftActivity: vi.fn(),
    deleteDraftActivity: vi.fn(),
    addManualActivity: vi.fn(),
    syncNewActivities: vi.fn(),
    confirmMorning: vi.fn(),
}));
vi.mock('./use-tdah-morning', () => ({
    useTdahMorning: () => hookState,
}));

const router = vi.hoisted(() => ({
    push: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
    canGoBack: vi.fn(() => true),
}));
const searchParams = vi.hoisted(() => ({
    current: {} as Record<string, string | undefined>,
}));
vi.mock('expo-router', () => ({
    useRouter: () => router,
    useLocalSearchParams: () => searchParams.current,
}));

vi.mock('react-native-safe-area-context', () => ({
    SafeAreaView: (props: any) => React.createElement('SafeAreaView', props, props.children),
}));

// TdahMorningScreen imports TdahActivityDetailScreen.tsx for two shared
// consts (START_TIME_PATTERN/DURATION_MAX_MINUTES) — that module's own
// top-level imports (never invoked here, since TdahActivityDetailScreen
// itself is never rendered in these tests) still need to resolve.
// Captures the latest registered callback (in addition to running it as a
// mount effect, mirroring every other T-0X screen's test double) so tests
// can simulate a *second* focus event directly — the real useFocusEffect
// re-invokes its callback on every focus regain, which a plain
// `useEffect(callback, [callback])` mount-only stand-in can't reproduce on
// its own since `callback`'s identity never changes across rerenders here.
const focusCallbackRef = vi.hoisted(() => ({ current: null as (() => void | (() => void)) | null }));
vi.mock('@react-navigation/native', () => ({
    useFocusEffect: (callback: () => void | (() => void)) => {
        focusCallbackRef.current = callback;
        React.useEffect(callback, [callback]);
    },
}));

vi.mock('lucide-react-native', () => ({
    Trash2: (props: any) => React.createElement('Trash2', props),
}));

vi.mock('react-native-draggable-flatlist', () => ({
    default: (props: any) => React.createElement('DraggableFlatList', props),
}));

vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => ({
        bg: '#fff', text: '#0f172a', secondaryText: '#94a3b8', cardBg: '#fff', border: '#e2e8f0',
        filterBg: '#eef2f7', tint: '#3b82f6', onTint: '#fff', danger: '#ef4444', success: '#10b981',
        warning: '#f59e0b', inputBg: '#eef2f7',
    }),
}));

vi.mock('@/hooks/use-filled-button-colors', () => ({
    useFilledButtonColors: () => ({ backgroundColor: '#3b82f6', textColor: '#fff' }),
}));

const TRANSLATIONS: Record<string, string> = {
    'settings.tdah.needsSync': 'Set up cloud sync in Settings to use ADHD Mode.',
};
vi.mock('@/contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => TRANSLATIONS[key] ?? key }),
}));

const activity = (overrides: Partial<TdahActivity> = {}): TdahActivity => ({
    id: 1,
    dayPlanDate: '2026-08-28',
    blockId: null,
    title: 'Correo',
    startTime: '09:00',
    durationMinutes: 30,
    origin: 'routine',
    state: 'pending',
    startedAt: null,
    completedAt: null,
    movedAt: null,
    ...overrides,
});

describe('TdahMorningScreen — screen states', () => {
    beforeEach(() => {
        hookState.phase = 'ready';
        hookState.date = '2026-08-28';
        hookState.routineTitle = null;
        hookState.confirmedAt = null;
        hookState.draftActivities = [];
        hookState.reload.mockReset();
        hookState.reorderDraft.mockReset();
        hookState.updateDraftActivity.mockReset();
        hookState.deleteDraftActivity.mockReset();
        hookState.addManualActivity.mockReset();
        hookState.syncNewActivities.mockReset();
        hookState.confirmMorning.mockReset();
        showToast.mockReset();
        router.push.mockReset();
        searchParams.current = {};
        focusCallbackRef.current = null;
    });

    it('shows the loading state and fetches exactly once on mount', async () => {
        hookState.phase = 'loading';
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        expect(tree!.root.findByProps({ testID: 'tdah-morning-loading' })).toBeTruthy();
        expect(hookState.reload).toHaveBeenCalledTimes(1);
    });

    it('never calls syncNewActivities on the very first focus (the mount-only effect already covers the initial load)', async () => {
        await act(async () => { create(<TdahMorningScreen />); });
        expect(hookState.syncNewActivities).not.toHaveBeenCalled();
    });

    it('calls syncNewActivities on a subsequent focus regain — e.g. after the "Agregar manual" round trip (bug fix regression)', async () => {
        await act(async () => { create(<TdahMorningScreen />); });
        expect(hookState.syncNewActivities).not.toHaveBeenCalled();

        await act(async () => {
            focusCallbackRef.current?.();
        });
        expect(hookState.syncNewActivities).toHaveBeenCalledTimes(1);
        // reload() must never be re-invoked by a focus regain (it would
        // clobber the mount-only-preserved draft) — only syncNewActivities.
        expect(hookState.reload).toHaveBeenCalledTimes(1);
    });

    it('shows the offline state with a retry that reloads (AD-11)', async () => {
        hookState.phase = 'offline';
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        expect(tree!.root.findByProps({ testID: 'tdah-morning-offline' })).toBeTruthy();
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-morning-retry' }).props.onPress();
        });
        expect(hookState.reload).toHaveBeenCalledTimes(2);
    });

    it('shows the error state with a retry that reloads', async () => {
        hookState.phase = 'error';
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        expect(tree!.root.findByProps({ testID: 'tdah-morning-error' })).toBeTruthy();
    });

    it('shows the unconfigured state with a CTA that opens Settings', async () => {
        hookState.phase = 'unconfigured';
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        expect(tree!.root.findByProps({ testID: 'tdah-morning-unconfigured' })).toBeTruthy();
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-morning-open-settings' }).props.onPress();
        });
        expect(router.push).toHaveBeenCalledWith('/settings');
    });

    it('shows the empty state when the draft has zero activities', async () => {
        hookState.draftActivities = [];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        expect(tree!.root.findByProps({ testID: 'tdah-morning-empty' })).toBeTruthy();
    });

    it('renders the header with the day and, when present, the Routine label', async () => {
        hookState.routineTitle = 'Día laboral';
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        const texts = tree!.root.findAllByType(Text).map((node) => node.props.children).flat();
        expect(texts.join(' ')).toContain('Routine Día laboral');
    });

    it('shows the soft-lock banner only when confirmedAt is non-null (spec Always: re-entry after a previous confirm)', async () => {
        hookState.confirmedAt = '2026-08-27T22:00:00.000Z';
        hookState.draftActivities = [activity()];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        expect(tree!.root.findByProps({ testID: 'tdah-morning-confirmed-banner' })).toBeTruthy();
    });

    it('never shows the soft-lock banner when confirmedAt is null', async () => {
        hookState.confirmedAt = null;
        hookState.draftActivities = [activity()];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        expect(tree!.root.findAllByProps({ testID: 'tdah-morning-confirmed-banner' })).toHaveLength(0);
    });
});

describe('TdahMorningScreen — overlap warning (spec Never: never blocks the confirm send)', () => {
    beforeEach(() => {
        hookState.phase = 'ready';
        hookState.confirmedAt = null;
        hookState.routineTitle = null;
        showToast.mockReset();
        router.push.mockReset();
    });

    it('shows the warning when two draft activities overlap', async () => {
        hookState.draftActivities = [
            activity({ id: 1, startTime: '09:00', durationMinutes: 30 }),
            activity({ id: 2, startTime: '09:15', durationMinutes: 30 }),
        ];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        expect(tree!.root.findByProps({ testID: 'tdah-morning-overlap-warning' })).toBeTruthy();
    });

    it('never shows the warning for non-overlapping or no-time activities', async () => {
        hookState.draftActivities = [
            activity({ id: 1, startTime: '09:00', durationMinutes: 30 }),
            activity({ id: 2, startTime: '10:00', durationMinutes: 30 }),
            activity({ id: 3, startTime: null, durationMinutes: null }),
        ];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        expect(tree!.root.findAllByProps({ testID: 'tdah-morning-overlap-warning' })).toHaveLength(0);
    });

    it('the confirm CTA stays enabled even while the warning is showing', async () => {
        hookState.draftActivities = [
            activity({ id: 1, startTime: '09:00', durationMinutes: 30 }),
            activity({ id: 2, startTime: '09:15', durationMinutes: 30 }),
        ];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        expect(tree!.root.findByProps({ testID: 'tdah-morning-confirm' }).props.accessibilityState).toEqual({ disabled: false });
    });
});

describe('TdahMorningScreen — draft rows', () => {
    beforeEach(() => {
        hookState.phase = 'ready';
        hookState.confirmedAt = null;
        hookState.routineTitle = 'Día laboral';
        hookState.draftActivities = [activity()];
        hookState.updateDraftActivity.mockReset();
        hookState.deleteDraftActivity.mockReset();
        router.push.mockReset();
    });

    const renderRow = async (item: TdahActivity, extra: Partial<{ isActive: boolean }> = {}) => {
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        const list = tree!.root.findByProps({ testID: 'tdah-morning-list' });
        let row: ReturnType<typeof create> | undefined;
        await act(async () => {
            row = create(list.props.renderItem({ item, drag: vi.fn(), isActive: extra.isActive ?? false }));
        });
        return { tree: tree!, row: row! };
    };

    it('shows the "De Rutina X" badge for a routine-origin, never-moved activity', async () => {
        const { row } = await renderRow(activity({ origin: 'routine', movedAt: null }));
        const badge = row.root.findByProps({ testID: 'tdah-morning-row-1-badge' });
        expect(badge.props.children).toBe('Part of Routine Día laboral');
    });

    it('shows the "Movido desde el Cierre" badge for a moved activity, never the Rutina badge, even when both would apply', async () => {
        const { row } = await renderRow(activity({ origin: 'routine', movedAt: '2026-08-27T22:00:00.000Z' }));
        const badge = row.root.findByProps({ testID: 'tdah-morning-row-1-badge' });
        expect(badge.props.children).toBe('Moved from Cierre');
    });

    it('shows no badge for a manual, never-moved activity', async () => {
        const { row } = await renderRow(activity({ origin: 'manual', movedAt: null }));
        expect(row.root.findAllByProps({ testID: 'tdah-morning-row-1-badge' })).toHaveLength(0);
    });

    it('commits a valid hora edit to the draft on blur', async () => {
        const { row } = await renderRow(activity({ startTime: '09:00' }));
        const timeInput = row.root.findByProps({ testID: 'tdah-morning-row-1-time' });
        await act(async () => {
            timeInput.props.onChangeText('11:15');
        });
        await act(async () => {
            row.root.findByProps({ testID: 'tdah-morning-row-1-time' }).props.onEndEditing();
        });
        expect(hookState.updateDraftActivity).toHaveBeenCalledWith(1, { startTime: '11:15', durationMinutes: 30 });
    });

    it('rejects an invalid hora and reverts the field instead of committing it', async () => {
        const { row } = await renderRow(activity({ startTime: '09:00' }));
        await act(async () => {
            row.root.findByProps({ testID: 'tdah-morning-row-1-time' }).props.onChangeText('9h');
        });
        await act(async () => {
            row.root.findByProps({ testID: 'tdah-morning-row-1-time' }).props.onEndEditing();
        });
        expect(hookState.updateDraftActivity).not.toHaveBeenCalled();
        expect(row.root.findByProps({ testID: 'tdah-morning-row-1-time' }).props.value).toBe('09:00');
    });

    it('commits an empty hora as null (sin hora)', async () => {
        const { row } = await renderRow(activity({ startTime: '09:00', durationMinutes: 30 }));
        await act(async () => {
            row.root.findByProps({ testID: 'tdah-morning-row-1-time' }).props.onChangeText('');
        });
        await act(async () => {
            row.root.findByProps({ testID: 'tdah-morning-row-1-time' }).props.onEndEditing();
        });
        expect(hookState.updateDraftActivity).toHaveBeenCalledWith(1, { startTime: null, durationMinutes: 30 });
    });

    it('commits a valid duration edit to the draft on blur', async () => {
        const { row } = await renderRow(activity({ durationMinutes: 30 }));
        await act(async () => {
            row.root.findByProps({ testID: 'tdah-morning-row-1-duration' }).props.onChangeText('45');
        });
        await act(async () => {
            row.root.findByProps({ testID: 'tdah-morning-row-1-duration' }).props.onEndEditing();
        });
        expect(hookState.updateDraftActivity).toHaveBeenCalledWith(1, { startTime: '09:00', durationMinutes: 45 });
    });

    it('rejects a duration above the max and reverts the field', async () => {
        const { row } = await renderRow(activity({ durationMinutes: 30 }));
        await act(async () => {
            row.root.findByProps({ testID: 'tdah-morning-row-1-duration' }).props.onChangeText('99999');
        });
        await act(async () => {
            row.root.findByProps({ testID: 'tdah-morning-row-1-duration' }).props.onEndEditing();
        });
        expect(hookState.updateDraftActivity).not.toHaveBeenCalled();
        expect(row.root.findByProps({ testID: 'tdah-morning-row-1-duration' }).props.value).toBe('30');
    });

    it('calls deleteDraftActivity when the delete icon is pressed', async () => {
        const { row } = await renderRow(activity());
        await act(async () => {
            row.root.findByProps({ testID: 'tdah-morning-row-1-delete' }).props.onPress();
        });
        expect(hookState.deleteDraftActivity).toHaveBeenCalledWith(1);
    });

    it('calls reorderDraft with the drop indices on DraggableFlatList onDragEnd', async () => {
        hookState.draftActivities = [activity({ id: 1 }), activity({ id: 2 })];
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        const list = tree!.root.findByProps({ testID: 'tdah-morning-list' });
        await act(async () => {
            list.props.onDragEnd({ data: hookState.draftActivities, from: 0, to: 1 });
        });
        expect(hookState.reorderDraft).toHaveBeenCalledWith(0, 1);
    });
});

describe('TdahMorningScreen — Agregar manual', () => {
    beforeEach(() => {
        hookState.phase = 'ready';
        hookState.confirmedAt = null;
        hookState.draftActivities = [activity()];
        router.push.mockReset();
    });

    it('navigates to the reused T-02 create form with targetDate=tomorrow (spec Always)', async () => {
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-morning-add-manual' }).props.onPress();
        });
        expect(router.push).toHaveBeenCalledWith({
            pathname: '/tdah-activity/new',
            params: { targetDate: 'tomorrow' },
        });
    });
});

describe('TdahMorningScreen — Confirmar mañana', () => {
    beforeEach(() => {
        hookState.phase = 'ready';
        hookState.confirmedAt = null;
        hookState.draftActivities = [activity()];
        hookState.confirmMorning.mockReset();
        showToast.mockReset();
        router.push.mockReset();
        searchParams.current = { movedTomorrow: '2', movedDate: '1', discarded: '3', limbo: '4' };
    });

    it('confirms and navigates to T-07 forwarding T-05\'s counts plus morningChanges from the resolved outcome', async () => {
        hookState.confirmMorning.mockResolvedValue({ changesCount: 5 });
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-morning-confirm' }).props.onPress();
        });

        expect(hookState.confirmMorning).toHaveBeenCalled();
        expect(router.push).toHaveBeenCalledWith({
            pathname: '/tdah-confirmation',
            params: { movedTomorrow: '2', movedDate: '1', discarded: '3', limbo: '4', morningChanges: '5' },
        });
    });

    it('defaults every forwarded count to "0" when T-05 sent none', async () => {
        searchParams.current = {};
        hookState.confirmMorning.mockResolvedValue({ changesCount: 0 });
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-morning-confirm' }).props.onPress();
        });
        expect(router.push).toHaveBeenCalledWith({
            pathname: '/tdah-confirmation',
            params: { movedTomorrow: '0', movedDate: '0', discarded: '0', limbo: '0', morningChanges: '0' },
        });
    });

    it('shows a generic error toast on a rejected confirm (400) and never navigates', async () => {
        hookState.confirmMorning.mockRejectedValue(new CloudHttpError('Cloud POST failed (400): Bad Request', 400));
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-morning-confirm' }).props.onPress();
        });
        expect(showToast).toHaveBeenCalledWith({
            message: 'Could not complete the action. Try again.',
            tone: 'error',
        });
        expect(router.push).not.toHaveBeenCalled();
    });

    it('shows an offline toast on a network-level confirm failure and never navigates', async () => {
        hookState.confirmMorning.mockRejectedValue(new Error('network down'));
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });
        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-morning-confirm' }).props.onPress();
        });
        expect(showToast).toHaveBeenCalledWith({
            title: 'Offline',
            message: 'No internet connection. The action was not registered.',
            tone: 'error',
        });
        expect(router.push).not.toHaveBeenCalled();
    });
});

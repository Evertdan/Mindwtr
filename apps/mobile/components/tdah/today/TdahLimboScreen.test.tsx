import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CloudHttpError } from '@mindwtr/core';

import { TdahLimboScreen } from './TdahLimboScreen';
import type { TdahActivity } from './tdah-today-types';

vi.mock('@react-native-community/datetimepicker', () => ({
    __esModule: true,
    default: (props: any) => React.createElement('DateTimePicker', props),
}));

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/contexts/toast-context', () => ({
    useToast: () => ({ showToast, dismissToast: vi.fn() }),
}));

const hookState = vi.hoisted(() => ({
    phase: 'ready' as string,
    activities: [] as TdahActivity[],
    selectedIds: new Set<number>(),
    toggleSelect: vi.fn(),
    clearSelection: vi.fn(),
    reload: vi.fn(),
    decideOne: vi.fn(),
    decideBatch: vi.fn(),
}));

vi.mock('./use-tdah-limbo', () => ({
    useTdahLimbo: () => hookState,
}));

// Profile timeZone fetch (AD-6) — TdahLimboScreen.tsx reads this directly
// (not through use-tdah-limbo.ts, mocked above wholesale), same reasoning
// documented on its own effect: best-effort, defaults to the device zone.
const cloudConfig = vi.hoisted(() => ({
    value: null as null | { url: string; token: string; allowInsecureHttp: boolean },
}));
vi.mock('./tdah-today-cloud', () => ({
    loadTdahCloudConfig: () => Promise.resolve(cloudConfig.value),
    buildTdahProfileUrl: (url: string) => `${url}/tdah/profile`,
    buildTdahRequestOptions: (cloud: { token: string }) => ({ token: cloud.token }),
}));

const { cloudGetJson } = vi.hoisted(() => ({ cloudGetJson: vi.fn() }));
vi.mock('@mindwtr/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@mindwtr/core')>();
    return { ...actual, cloudGetJson };
});

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('expo-router', () => ({
    useRouter: () => router,
}));

// Captures the latest registered focus callback (mirroring
// TdahMorningScreen.test.tsx's own double) so a test can simulate a second
// focus regain directly — the skip-first-focus pattern under test can't be
// exercised by a plain mount-only effect stand-in.
const focusCallbackRef = vi.hoisted(() => ({ current: null as (() => void | (() => void)) | null }));
vi.mock('@react-navigation/native', () => ({
    useFocusEffect: (callback: () => void | (() => void)) => {
        focusCallbackRef.current = callback;
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
    'tdahToday.limboTitle': 'Limbo',
    'tdahToday.limboBadgeLabel': '{count} in Limbo',
    'tdahToday.limboEmpty': 'Nothing pending a decision — clean',
    'tdahToday.limboTimeInLimboDays': '{count} days in Limbo',
    'tdahToday.limboSelectionCount': '{count} selected',
    'tdahToday.limboBatchApply': 'Apply to selection',
};
vi.mock('@/contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => TRANSLATIONS[key] ?? key }),
}));

const limboActivity = (overrides: Partial<TdahActivity> = {}): TdahActivity => ({
    id: 1, dayPlanDate: '2026-08-20', blockId: null, title: 'Reporte', startTime: '09:00',
    durationMinutes: 30, origin: 'manual', state: 'limbo', startedAt: null, completedAt: null,
    ...overrides,
});

describe('TdahLimboScreen', () => {
    beforeEach(() => {
        hookState.phase = 'ready';
        hookState.activities = [];
        hookState.selectedIds = new Set();
        hookState.toggleSelect.mockReset();
        hookState.clearSelection.mockReset();
        hookState.reload.mockReset();
        hookState.decideOne.mockReset();
        hookState.decideBatch.mockReset();
        showToast.mockReset();
        router.push.mockReset();
        cloudConfig.value = null;
        cloudGetJson.mockReset();
        focusCallbackRef.current = null;
    });

    describe('screen states', () => {
        it('shows the loading state and fetches exactly once on mount', async () => {
            hookState.phase = 'loading';
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahLimboScreen />); });
            expect(tree!.root.findByProps({ testID: 'tdah-limbo-loading' })).toBeTruthy();
            expect(hookState.reload).toHaveBeenCalledTimes(1);
        });

        it('never re-fetches on the very first focus (the mount-only effect already covers the initial load)', async () => {
            await act(async () => { create(<TdahLimboScreen />); });
            expect(hookState.reload).toHaveBeenCalledTimes(1);
        });

        it('re-fetches on a subsequent focus regain (anti-staleness: a decision made in T-05 must be reflected without a manual reload)', async () => {
            await act(async () => { create(<TdahLimboScreen />); });
            expect(hookState.reload).toHaveBeenCalledTimes(1);

            await act(async () => { focusCallbackRef.current?.(); });
            expect(hookState.reload).toHaveBeenCalledTimes(2);
        });

        it('shows the offline state with a retry that reloads (AD-11: never a phantom list)', async () => {
            hookState.phase = 'offline';
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahLimboScreen />); });
            expect(tree!.root.findByProps({ testID: 'tdah-limbo-offline' })).toBeTruthy();
            await act(async () => {
                tree!.root.findByProps({ testID: 'tdah-limbo-retry' }).props.onPress();
            });
            expect(hookState.reload).toHaveBeenCalledTimes(2);
        });

        it('shows the error state with a retry that reloads', async () => {
            hookState.phase = 'error';
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahLimboScreen />); });
            expect(tree!.root.findByProps({ testID: 'tdah-limbo-error' })).toBeTruthy();
            await act(async () => {
                tree!.root.findByProps({ testID: 'tdah-limbo-retry' }).props.onPress();
            });
            expect(hookState.reload).toHaveBeenCalledTimes(2);
        });

        it('shows the unconfigured state with a Settings CTA instead of a dead-end retry', async () => {
            hookState.phase = 'unconfigured';
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahLimboScreen />); });
            expect(tree!.root.findByProps({ testID: 'tdah-limbo-unconfigured' })).toBeTruthy();
            await act(async () => {
                tree!.root.findByProps({ testID: 'tdah-limbo-open-settings' }).props.onPress();
            });
            expect(router.push).toHaveBeenCalledWith('/settings');
        });

        it('shows the calm empty state ("Nada pendiente de decisión — limpio") for an empty Limbo, not a separate phase', async () => {
            hookState.phase = 'ready';
            hookState.activities = [];
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahLimboScreen />); });
            expect(tree!.root.findByProps({ testID: 'tdah-limbo-empty' })).toBeTruthy();
            expect(tree!.root.findAllByProps({ testID: 'tdah-limbo-activity-list' })).toHaveLength(0);
        });
    });

    describe('the list (spec AC: every day mixed together, oldest first, glyph + title + original date + planned hour + time-in-limbo)', () => {
        it('renders each row with the limbo glyph, title, and a DecisionChip variant="limbo"', async () => {
            hookState.activities = [limboActivity()];
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahLimboScreen />); });

            expect(tree!.root.findByProps({ testID: 'tdah-limbo-row-1' })).toBeTruthy();
            expect(tree!.root.findByProps({ testID: 'tdah-decision-chip-1-complete-late' })).toBeTruthy();
            expect(tree!.root.findAllByProps({ testID: 'tdah-decision-chip-1-undated' })).toHaveLength(0);
        });

        it('toggles selection on checkbox tap', async () => {
            hookState.activities = [limboActivity()];
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahLimboScreen />); });

            await act(async () => {
                tree!.root.findByProps({ testID: 'tdah-limbo-checkbox-1' }).props.onPress();
            });
            expect(hookState.toggleSelect).toHaveBeenCalledWith(1);
        });

        it('renders the original date with the year (FR-9: an item can be arbitrarily old, "Dec 31" alone would be ambiguous) and the planned hour', async () => {
            hookState.activities = [limboActivity({ id: 1, dayPlanDate: '2024-12-31', startTime: '09:00' })];
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahLimboScreen />); });

            const row = tree!.root.findByProps({ testID: 'tdah-limbo-row-1' });
            const texts = row.findAllByType(Text).map((node) => node.props.children).flat();
            expect(texts).toContain('12/31/2024');
            expect(texts).toContain('09:00');
        });

        it('computes the time-in-limbo count from dayPlanDate when the Activity never moved through T-05 (movedAt absent)', async () => {
            vi.useFakeTimers();
            try {
                cloudConfig.value = { url: 'https://sync.example.com', token: 'tok', allowInsecureHttp: false };
                cloudGetJson.mockResolvedValue({ profile: { timeZone: 'UTC' } });
                vi.setSystemTime(new Date('2026-08-27T12:00:00Z'));
                hookState.activities = [limboActivity({ id: 1, dayPlanDate: '2026-08-20', movedAt: null })];
                let tree: ReturnType<typeof create> | undefined;
                await act(async () => { tree = create(<TdahLimboScreen />); });

                const row = tree!.root.findByProps({ testID: 'tdah-limbo-row-1' });
                const texts = row.findAllByType(Text).map((node) => node.props.children).flat();
                expect(texts).toContain('7 days in Limbo');
            } finally {
                vi.useRealTimers();
            }
        });

        // DW-117: the DEVICE_TIME_ZONE fallback (TdahLimboScreen.tsx:30,76) had
        // no test at all. It is observable through the day count, because
        // `daysInLimbo` resolves both ends in that zone. The pair below is what
        // makes it a real assertion: the first proves the fallback is used when
        // the profile carries no zone, the second proves the zone still shifts
        // the count — without it, code that always returned 'UTC' would pass.
        //
        // Deliberately anchored so both sides land on a plural count (3 vs 2).
        // A 2-vs-1 split discriminates just as well but would make the test
        // assert "1 days in Limbo", codifying the missing plural form in
        // `tdahToday.limboTimeInLimboDays` as expected output. See DW-118.
        it('falls back to the device zone when the profile carries no timeZone', async () => {
            vi.useFakeTimers();
            try {
                cloudConfig.value = { url: 'https://sync.example.com', token: 'tok', allowInsecureHttp: false };
                cloudGetJson.mockResolvedValue({ profile: {} });
                // 00:30 UTC on the 27th. In UTC the day key is the 27th, so an
                // Activity moved on the 25th reads 2 days.
                vi.setSystemTime(new Date('2026-08-27T00:30:00Z'));
                hookState.activities = [limboActivity({ id: 1, dayPlanDate: '2026-08-01', movedAt: '2026-08-24T10:00:00Z' })];
                let tree: ReturnType<typeof create> | undefined;
                await act(async () => { tree = create(<TdahLimboScreen />); });

                const row = tree!.root.findByProps({ testID: 'tdah-limbo-row-1' });
                const texts = row.findAllByType(Text).map((node) => node.props.children).flat();
                expect(texts).toContain('3 days in Limbo');
            } finally {
                vi.useRealTimers();
            }
        });

        it('uses the profile timeZone over the device zone, shifting the count across a day boundary', async () => {
            vi.useFakeTimers();
            try {
                cloudConfig.value = { url: 'https://sync.example.com', token: 'tok', allowInsecureHttp: false };
                // Same instant as above, but Mexico City (UTC-6) is still on the
                // 26th at 00:30 UTC, so the same Activity reads one day fewer.
                cloudGetJson.mockResolvedValue({ profile: { timeZone: 'America/Mexico_City' } });
                vi.setSystemTime(new Date('2026-08-27T00:30:00Z'));
                hookState.activities = [limboActivity({ id: 1, dayPlanDate: '2026-08-01', movedAt: '2026-08-24T10:00:00Z' })];
                let tree: ReturnType<typeof create> | undefined;
                await act(async () => { tree = create(<TdahLimboScreen />); });

                const row = tree!.root.findByProps({ testID: 'tdah-limbo-row-1' });
                const texts = row.findAllByType(Text).map((node) => node.props.children).flat();
                expect(texts).toContain('2 days in Limbo');
            } finally {
                vi.useRealTimers();
            }
        });

        it('sources the time-in-limbo count from movedAt, not the original dayPlanDate, once the Activity moved through T-05', async () => {
            vi.useFakeTimers();
            try {
                cloudConfig.value = { url: 'https://sync.example.com', token: 'tok', allowInsecureHttp: false };
                cloudGetJson.mockResolvedValue({ profile: { timeZone: 'UTC' } });
                vi.setSystemTime(new Date('2026-08-27T12:00:00Z'));
                // dayPlanDate alone would read 26 days; movedAt re-anchors the
                // count to 2 — the branch a regression in the daysInLimbo
                // helper's movedAt-vs-dayPlanDate choice would silently break.
                hookState.activities = [limboActivity({
                    id: 1, dayPlanDate: '2026-08-01', movedAt: '2026-08-25T10:00:00Z',
                })];
                let tree: ReturnType<typeof create> | undefined;
                await act(async () => { tree = create(<TdahLimboScreen />); });

                const row = tree!.root.findByProps({ testID: 'tdah-limbo-row-1' });
                const texts = row.findAllByType(Text).map((node) => node.props.children).flat();
                expect(texts).toContain('2 days in Limbo');
                expect(texts).not.toContain('26 days in Limbo');
            } finally {
                vi.useRealTimers();
            }
        });
    });

    describe('per-row decision (decideOne)', () => {
        it('calls decideOne with the activity id and request on a chip tap', async () => {
            hookState.activities = [limboActivity()];
            hookState.decideOne.mockResolvedValue({ ...limboActivity(), state: 'completed', completedAt: '2026-08-27T10:00:00Z' });
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahLimboScreen />); });

            await act(async () => {
                await tree!.root.findByProps({ testID: 'tdah-decision-chip-1-complete-late' }).props.onPress();
            });

            expect(hookState.decideOne).toHaveBeenCalledWith(1, { decision: 'complete-late' });
        });

        it('shows an error-tone toast on a rejected decision, without throwing out of the chip', async () => {
            hookState.activities = [limboActivity()];
            hookState.decideOne.mockRejectedValue(new CloudHttpError('Cloud POST failed (400)', 400));
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahLimboScreen />); });

            await act(async () => {
                await tree!.root.findByProps({ testID: 'tdah-decision-chip-1-discard' }).props.onPress();
            });

            expect(showToast).toHaveBeenCalledWith({
                message: 'Could not complete the action. Try again.',
                tone: 'error',
            });
        });
    });

    describe('batch bar (spec Always: "todo o nada")', () => {
        it('is hidden with no selection, and shown with the selection count once rows are selected', async () => {
            hookState.activities = [limboActivity({ id: 1 }), limboActivity({ id: 2 })];
            hookState.selectedIds = new Set();
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahLimboScreen />); });
            expect(tree!.root.findAllByProps({ testID: 'tdah-limbo-batch-bar' })).toHaveLength(0);

            hookState.selectedIds = new Set([1, 2]);
            await act(async () => { tree!.update(<TdahLimboScreen />); });
            const bar = tree!.root.findByProps({ testID: 'tdah-limbo-batch-bar' });
            expect(bar).toBeTruthy();
        });

        it('calls decideBatch with the picked decision when a batch-bar chip is tapped', async () => {
            hookState.activities = [limboActivity({ id: 1 }), limboActivity({ id: 2 })];
            hookState.selectedIds = new Set([1, 2]);
            hookState.decideBatch.mockResolvedValue([]);
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahLimboScreen />); });

            await act(async () => {
                await tree!.root.findByProps({ testID: 'tdah-decision-chip--1-discard' }).props.onPress();
            });

            expect(hookState.decideBatch).toHaveBeenCalledWith({ decision: 'discard' });
        });

        it('shows an error-tone toast on a rejected batch (spec Error Handling: "selección intacta")', async () => {
            hookState.activities = [limboActivity({ id: 1 })];
            hookState.selectedIds = new Set([1]);
            hookState.decideBatch.mockRejectedValue(new CloudHttpError('Cloud POST failed (400)', 400));
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahLimboScreen />); });

            await act(async () => {
                await tree!.root.findByProps({ testID: 'tdah-decision-chip--1-move-tomorrow' }).props.onPress();
            });

            expect(showToast).toHaveBeenCalledWith({
                message: 'Could not complete the action. Try again.',
                tone: 'error',
            });
        });
    });

    describe('profile time zone (AD-6)', () => {
        it('feeds the fetched profile time zone into the row DecisionChip (move-date picker floor)', async () => {
            cloudConfig.value = { url: 'https://sync.example.com', token: 'tok', allowInsecureHttp: false };
            cloudGetJson.mockResolvedValue({ profile: { timeZone: 'Pacific/Kiritimati' } });
            hookState.activities = [limboActivity()];
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<TdahLimboScreen />); });

            await act(async () => {
                tree!.root.findByProps({ testID: 'tdah-decision-chip-1-move-date' }).props.onPress();
            });
            const picker = tree!.root.findByType('DateTimePicker' as any);
            expect(picker).toBeTruthy();
        });
    });
});

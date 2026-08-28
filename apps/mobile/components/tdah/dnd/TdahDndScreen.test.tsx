import React from 'react';
import { Switch, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TdahDndScreen } from './TdahDndScreen';
import type { TdahDndWindow } from './tdah-dnd-types';
import type { TdahDndMutationError, TdahDndPhase, UseTdahDndResult } from './use-tdah-dnd';

const hookState = vi.hoisted(() => ({
    phase: 'ready' as TdahDndPhase,
    settings: { calendarEnabled: false, workStart: '09:00', workEnd: '18:00' },
    windows: [] as TdahDndWindow[],
    activeUntil: null as string | null,
    permission: 'granted' as 'granted' | 'denied' | 'undetermined',
    calendarSupported: true,
    calendarSyncing: false,
    mutationError: null as TdahDndMutationError | null,
    clearMutationError: vi.fn(),
    reload: vi.fn(),
    requestCalendarPermission: vi.fn(async () => 'granted' as const),
    setCalendarEnabled: vi.fn(async () => true),
    saveWorkingHours: vi.fn(async () => true),
    createWindow: vi.fn(async () => true),
    updateWindow: vi.fn(async () => true),
    deleteWindow: vi.fn(async () => true),
}));

vi.mock('./use-tdah-dnd', () => ({
    useTdahDnd: (): UseTdahDndResult => hookState as unknown as UseTdahDndResult,
}));

const themeTokens = vi.hoisted(() => ({ roles: null as { dnd: string } | null }));
vi.mock('@/hooks/use-theme-tokens', () => ({
    useThemeTokens: () => themeTokens,
}));

vi.mock('@react-navigation/native', () => ({
    useFocusEffect: (callback: () => void | (() => void)) => {
        React.useEffect(callback, [callback]);
    },
}));

vi.mock('react-native-safe-area-context', () => ({
    SafeAreaView: (props: any) => React.createElement('SafeAreaView', props, props.children),
}));

const THEME = {
    bg: '#fff', text: '#0f172a', secondaryText: '#94a3b8', cardBg: '#fff', border: '#e2e8f0',
    filterBg: '#eef2f7', inputBg: '#eef2f7', tint: '#3b82f6', onTint: '#fff', danger: '#ef4444',
    warning: '#f59e0b', success: '#10b981', taskItemBg: '#f1f5f9',
};

vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => THEME,
}));

vi.mock('@/hooks/use-filled-button-colors', () => ({
    useFilledButtonColors: () => ({ backgroundColor: '#3b82f6', textColor: '#fff' }),
}));

// Miss every key so the copy resolves through tFallback's English fallback —
// the same "always-miss" convention the other TDAH screen tests use.
vi.mock('@/contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key, language: 'en' }),
}));

const flattenStyle = (style: unknown): Record<string, unknown> => (
    Array.isArray(style) ? Object.assign({}, ...style.map(flattenStyle)) : ((style ?? {}) as Record<string, unknown>)
);

const manualWindow: TdahDndWindow = {
    id: 'w-manual',
    source: 'manual',
    kind: 'weekly',
    weekdays: [1],
    date: null,
    startTime: '10:00',
    endTime: '11:00',
    label: 'Junta de líderes',
};

const onceWindow: TdahDndWindow = {
    id: 'w-once',
    source: 'manual',
    kind: 'once',
    weekdays: null,
    date: '2026-09-01',
    startTime: '22:45',
    endTime: '23:30',
    label: null,
};

const calendarWindow: TdahDndWindow = {
    id: 'w-calendar',
    source: 'calendar',
    kind: 'once',
    weekdays: null,
    date: '2026-08-28',
    startTime: '10:30',
    endTime: '12:00',
    label: null,
};

const render = async (): Promise<ReactTestRenderer> => {
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<TdahDndScreen />); });
    return tree;
};

const allText = (tree: ReactTestRenderer): string => tree.root
    .findAll((node) => node.type === Text)
    .map((node) => node.props.children)
    .flat()
    .filter((value) => typeof value === 'string')
    .join(' | ');

const press = async (tree: ReactTestRenderer, testID: string): Promise<void> => {
    await act(async () => { tree.root.findByProps({ testID }).props.onPress(); });
};

const type = async (tree: ReactTestRenderer, testID: string, value: string): Promise<void> => {
    await act(async () => { tree.root.findByProps({ testID }).props.onChangeText(value); });
};

beforeEach(() => {
    hookState.phase = 'ready';
    hookState.settings = { calendarEnabled: false, workStart: '09:00', workEnd: '18:00' };
    hookState.windows = [];
    hookState.activeUntil = null;
    hookState.permission = 'granted';
    hookState.calendarSupported = true;
    hookState.calendarSyncing = false;
    hookState.mutationError = null;
    themeTokens.roles = null;
    hookState.clearMutationError.mockReset();
    hookState.reload.mockReset();
    hookState.requestCalendarPermission.mockReset().mockResolvedValue('granted');
    hookState.setCalendarEnabled.mockReset().mockResolvedValue(true);
    hookState.saveWorkingHours.mockReset().mockResolvedValue(true);
    hookState.createWindow.mockReset().mockResolvedValue(true);
    hookState.updateWindow.mockReset().mockResolvedValue(true);
    hookState.deleteWindow.mockReset().mockResolvedValue(true);
});

describe('TdahDndScreen (T-12)', () => {
    it('fetches on focus', async () => {
        await render();
        expect(hookState.reload).toHaveBeenCalledTimes(1);
    });

    describe('phases', () => {
        it('shows a skeleton-free calm loading state', async () => {
            hookState.phase = 'loading';
            const tree = await render();
            expect(tree.root.findByProps({ testID: 'tdah-dnd-loading' })).toBeTruthy();
        });

        // UX-DR5: a Retry that can only ever fail is a dead end.
        it('says sync is not configured, with no retry', async () => {
            hookState.phase = 'unconfigured';
            const tree = await render();
            expect(allText(tree)).toContain('Set up Self-Hosted cloud sync');
            expect(tree.root.findAllByProps({ testID: 'tdah-dnd-retry' })).toHaveLength(0);
        });

        it('says the mode is off rather than showing an error', async () => {
            hookState.phase = 'inactive';
            const tree = await render();
            expect(allText(tree)).toContain('ADHD mode is off');
            expect(tree.root.findAllByProps({ testID: 'tdah-dnd-retry' })).toHaveLength(0);
        });

        it('offers a retry for a server error and for offline alike', async () => {
            for (const phase of ['error', 'offline'] as const) {
                hookState.phase = phase;
                const tree = await render();
                await press(tree, 'tdah-dnd-retry');
                expect(hookState.reload).toHaveBeenCalled();
                await act(async () => { tree.unmount(); });
                hookState.reload.mockReset();
            }
        });
    });

    describe('zone 1 — the current state and the promise', () => {
        // The promise is product behavior, not decoration (FR-12/SM-C1): a
        // user who suspects a post-meeting avalanche turns DND off.
        it('always states that what is suppressed does not come back', async () => {
            const tree = await render();
            expect(allText(tree)).toContain('does not come back later');
        });

        it('renders the server\'s own activeUntil verbatim', async () => {
            hookState.activeUntil = '12:00';
            const tree = await render();
            expect(allText(tree)).toContain('Quiet until 12:00');
        });

        it('says reminders are coming through when nothing is active', async () => {
            const tree = await render();
            expect(allText(tree)).toContain('Not quiet right now');
        });

        it('paints the active state with the Material 3 dnd role when the theme resolves one', async () => {
            themeTokens.roles = { dnd: '#A78BFA' };
            hookState.activeUntil = '12:00';
            const tree = await render();
            const value = tree.root.findByProps({ testID: 'tdah-dnd-status-value' });
            expect(flattenStyle(value.props.style).color).toBe('#A78BFA');
        });

        it('falls back to tc.tint (never a danger token) on a non-Material theme', async () => {
            themeTokens.roles = null;
            hookState.activeUntil = '12:00';
            const tree = await render();
            const value = tree.root.findByProps({ testID: 'tdah-dnd-status-value' });
            expect(flattenStyle(value.props.style).color).toBe(THEME.tint);
            expect(flattenStyle(value.props.style).color).not.toBe(THEME.danger);
        });
    });

    describe('zone 2 — calendar detection', () => {
        it('toggles detection through the hook', async () => {
            const tree = await render();
            await act(async () => {
                tree.root.findByProps({ testID: 'tdah-dnd-calendar-toggle' }).props.onValueChange(true);
            });
            expect(hookState.setCalendarEnabled).toHaveBeenCalledWith(true);
        });

        // Doc 06: a denied permission degrades gracefully to manual windows,
        // with copy that blames nobody and a way back.
        it('degrades to manual windows with blame-free copy and a recovery path', async () => {
            hookState.permission = 'denied';
            const tree = await render();

            const text = allText(tree);
            expect(text).toContain('Calendar access is off, so only your manual windows apply');
            expect(text).not.toMatch(/error|fail|must grant/i);

            await press(tree, 'tdah-dnd-calendar-permission-cta');
            expect(hookState.requestCalendarPermission).toHaveBeenCalled();
            expect(tree.root.findByProps({ testID: 'tdah-dnd-calendar-permission-settings' })).toBeTruthy();
        });

        it('hides the permission prompt once access is granted', async () => {
            const tree = await render();
            expect(tree.root.findAllByProps({ testID: 'tdah-dnd-calendar-permission' })).toHaveLength(0);
        });

        it('counts the windows the server materialized from the calendar', async () => {
            hookState.settings = { calendarEnabled: true, workStart: '09:00', workEnd: '18:00' };
            hookState.windows = [manualWindow, calendarWindow];
            const tree = await render();
            expect(allText(tree)).toContain('1 windows detected from your calendar');
        });

        it('says the calendar had nothing busy rather than showing a bare zero', async () => {
            hookState.settings = { calendarEnabled: true, workStart: '09:00', workEnd: '18:00' };
            const tree = await render();
            expect(allText(tree)).toContain('No busy events in your working hours right now.');
        });

        it('shows the reading state while a sync is in flight', async () => {
            hookState.calendarSyncing = true;
            const tree = await render();
            expect(tree.root.findByProps({ testID: 'tdah-dnd-calendar-syncing' })).toBeTruthy();
        });

        // The PWA lives here permanently (doc 06) — a platform that cannot
        // read calendars offers no toggle at all, not a disabled one.
        it('states the permanent no-calendar situation on a platform that cannot read them', async () => {
            hookState.calendarSupported = false;
            const tree = await render();
            expect(allText(tree)).toContain('This app does not read calendars');
            expect(tree.root.findAllByType(Switch)).toHaveLength(0);
        });
    });

    describe('zone 3 — working hours', () => {
        it('seeds the fields from the server and saves an ordered range', async () => {
            const tree = await render();
            expect(tree.root.findByProps({ testID: 'tdah-dnd-work-start' }).props.value).toBe('09:00');

            await type(tree, 'tdah-dnd-work-start', '08:00');
            await act(async () => { tree.root.findByProps({ testID: 'tdah-dnd-work-end' }).props.onEndEditing(); });
            expect(hookState.saveWorkingHours).toHaveBeenCalledWith('08:00', '18:00');
        });

        it('refuses to save a range whose start is not before its end', async () => {
            const tree = await render();
            await type(tree, 'tdah-dnd-work-start', '19:00');
            await act(async () => { tree.root.findByProps({ testID: 'tdah-dnd-work-end' }).props.onEndEditing(); });

            expect(hookState.saveWorkingHours).not.toHaveBeenCalled();
            expect(tree.root.findByProps({ testID: 'tdah-dnd-work-invalid' })).toBeTruthy();
        });

        it('refuses a malformed HH:mm', async () => {
            const tree = await render();
            await type(tree, 'tdah-dnd-work-end', '25:00');
            await act(async () => { tree.root.findByProps({ testID: 'tdah-dnd-work-end' }).props.onEndEditing(); });
            expect(hookState.saveWorkingHours).not.toHaveBeenCalled();
        });
    });

    describe('zone 4 — the manual windows', () => {
        it('offers a dignified empty state, not a blank card', async () => {
            const tree = await render();
            expect(allText(tree)).toContain('No manual windows yet');
        });

        it('describes a weekly window with its days and range', async () => {
            hookState.windows = [manualWindow];
            const tree = await render();
            const text = allText(tree);
            expect(text).toContain('Junta de líderes');
            expect(text).toContain('10:00–11:00');
            expect(text).not.toContain('No manual windows yet');
        });

        it('describes a one-off window by its date', async () => {
            hookState.windows = [onceWindow];
            const tree = await render();
            expect(allText(tree)).toContain('2026-09-01 · 22:45–23:30');
        });

        // An unlabelled window's title ALREADY falls back to `describeWindow`,
        // so rendering the meta line underneath it printed the very same string
        // twice, one above the other.
        it('does not repeat the description under the title when the window has no label', async () => {
            hookState.windows = [{ ...manualWindow, label: null }];
            const tree = await render();
            const text = allText(tree);
            expect(text).toContain('10:00–11:00');
            expect(text.split('10:00–11:00')).toHaveLength(2);
        });

        it('still shows both the label and the description on a labelled window', async () => {
            hookState.windows = [manualWindow];
            const tree = await render();
            const text = allText(tree);
            expect(text).toContain('Junta de líderes');
            expect(text.split('10:00–11:00')).toHaveLength(2);
        });

        it('deletes a manual window through the hook', async () => {
            hookState.windows = [manualWindow];
            const tree = await render();
            await press(tree, `tdah-dnd-window-${manualWindow.id}-delete`);
            expect(hookState.deleteWindow).toHaveBeenCalledWith(manualWindow.id);
        });

        // The server answers 409 TDAH_DND_READ_ONLY on a calendar row, so the
        // affordance would only ever fail — it is not offered at all.
        it('offers no edit or delete on a calendar-detected window, and says where it comes from', async () => {
            hookState.windows = [calendarWindow];
            const tree = await render();

            expect(tree.root.findAllByProps({ testID: `tdah-dnd-window-${calendarWindow.id}-edit` })).toHaveLength(0);
            expect(tree.root.findAllByProps({ testID: `tdah-dnd-window-${calendarWindow.id}-delete` })).toHaveLength(0);
            expect(tree.root.findByProps({ testID: `tdah-dnd-window-${calendarWindow.id}-source` })).toBeTruthy();
            expect(allText(tree)).toContain('From your calendar');
        });
    });

    describe('the editor', () => {
        it('creates a weekly window from the days and times the user picked', async () => {
            const tree = await render();
            await press(tree, 'tdah-dnd-add-window');

            await press(tree, 'tdah-dnd-editor-day-3');
            await press(tree, 'tdah-dnd-editor-day-1');
            await type(tree, 'tdah-dnd-editor-start', '10:00');
            await type(tree, 'tdah-dnd-editor-end', '11:00');
            await type(tree, 'tdah-dnd-editor-label', '  Junta  ');
            await press(tree, 'tdah-dnd-editor-save');

            expect(hookState.createWindow).toHaveBeenCalledWith({
                kind: 'weekly',
                weekdays: [1, 3],
                date: null,
                startTime: '10:00',
                endTime: '11:00',
                label: 'Junta',
            });
            // A successful save closes the editor.
            expect(tree.root.findAllByProps({ testID: 'tdah-dnd-editor' })).toHaveLength(0);
        });

        it('creates a one-off window from a date instead of weekdays', async () => {
            const tree = await render();
            await press(tree, 'tdah-dnd-add-window');
            await press(tree, 'tdah-dnd-editor-kind-once');
            await type(tree, 'tdah-dnd-editor-date', '2026-09-01');
            await type(tree, 'tdah-dnd-editor-start', '22:45');
            await type(tree, 'tdah-dnd-editor-end', '23:30');
            await press(tree, 'tdah-dnd-editor-save');

            expect(hookState.createWindow).toHaveBeenCalledWith({
                kind: 'once',
                weekdays: null,
                date: '2026-09-01',
                startTime: '22:45',
                endTime: '23:30',
                label: null,
            });
        });

        // Design Notes: a window that crosses midnight is expressed as two
        // windows, so `start < end` is a hard rule of the editor too.
        it('refuses a range that crosses midnight, and every other invalid shape', async () => {
            const cases: { setup: (tree: ReactTestRenderer) => Promise<void> }[] = [
                { // crosses midnight
                    setup: async (tree) => {
                        await press(tree, 'tdah-dnd-editor-day-1');
                        await type(tree, 'tdah-dnd-editor-start', '23:00');
                        await type(tree, 'tdah-dnd-editor-end', '01:00');
                    },
                },
                { // no day picked
                    setup: async (tree) => {
                        await type(tree, 'tdah-dnd-editor-start', '10:00');
                        await type(tree, 'tdah-dnd-editor-end', '11:00');
                    },
                },
                { // malformed HH:mm
                    setup: async (tree) => {
                        await press(tree, 'tdah-dnd-editor-day-1');
                        await type(tree, 'tdah-dnd-editor-start', '9:0');
                        await type(tree, 'tdah-dnd-editor-end', '11:00');
                    },
                },
                { // one-off with no valid date
                    setup: async (tree) => {
                        await press(tree, 'tdah-dnd-editor-kind-once');
                        await type(tree, 'tdah-dnd-editor-date', '01/09/2026');
                        await type(tree, 'tdah-dnd-editor-start', '10:00');
                        await type(tree, 'tdah-dnd-editor-end', '11:00');
                    },
                },
                { // one-off on a `YYYY-MM-DD`-SHAPED date that does not exist:
                  // caught here rather than coming back from the server as a
                  // generic save failure, the same `Date.UTC` round-trip the
                  // server and the desktop view both perform.
                    setup: async (tree) => {
                        await press(tree, 'tdah-dnd-editor-kind-once');
                        await type(tree, 'tdah-dnd-editor-date', '2026-02-31');
                        await type(tree, 'tdah-dnd-editor-start', '10:00');
                        await type(tree, 'tdah-dnd-editor-end', '11:00');
                    },
                },
            ];

            for (const testCase of cases) {
                const tree = await render();
                await press(tree, 'tdah-dnd-add-window');
                await testCase.setup(tree);
                await press(tree, 'tdah-dnd-editor-save');

                expect(hookState.createWindow).not.toHaveBeenCalled();
                expect(tree.root.findByProps({ testID: 'tdah-dnd-editor-invalid' })).toBeTruthy();
                await act(async () => { tree.unmount(); });
            }
        });

        it('opens pre-filled when editing, and saves through updateWindow', async () => {
            hookState.windows = [manualWindow];
            const tree = await render();
            await press(tree, `tdah-dnd-window-${manualWindow.id}-edit`);

            expect(tree.root.findByProps({ testID: 'tdah-dnd-editor-start' }).props.value).toBe('10:00');
            expect(tree.root.findByProps({ testID: 'tdah-dnd-editor-label' }).props.value).toBe('Junta de líderes');

            await type(tree, 'tdah-dnd-editor-end', '11:30');
            await press(tree, 'tdah-dnd-editor-save');

            expect(hookState.updateWindow).toHaveBeenCalledWith(manualWindow.id, expect.objectContaining({
                kind: 'weekly',
                weekdays: [1],
                endTime: '11:30',
            }));
        });

        // A failed save must not throw away what the user typed — the same
        // Save button is the retry.
        it('keeps the editor open with its values when the save fails', async () => {
            hookState.createWindow.mockResolvedValue(false);
            const tree = await render();
            await press(tree, 'tdah-dnd-add-window');
            await press(tree, 'tdah-dnd-editor-day-1');
            await type(tree, 'tdah-dnd-editor-start', '10:00');
            await type(tree, 'tdah-dnd-editor-end', '11:00');
            await press(tree, 'tdah-dnd-editor-save');

            expect(tree.root.findByProps({ testID: 'tdah-dnd-editor' })).toBeTruthy();
            expect(tree.root.findByProps({ testID: 'tdah-dnd-editor-start' }).props.value).toBe('10:00');
        });

        it('closes without saving on cancel', async () => {
            const tree = await render();
            await press(tree, 'tdah-dnd-add-window');
            await press(tree, 'tdah-dnd-editor-cancel');

            expect(tree.root.findAllByProps({ testID: 'tdah-dnd-editor' })).toHaveLength(0);
            expect(hookState.createWindow).not.toHaveBeenCalled();
        });
    });

    describe('mutation errors', () => {
        const expectations: [TdahDndMutationError, string][] = [
            ['windowLimit', 'You have reached the limit of manual windows'],
            ['windowSave', 'Could not save that window'],
            ['windowDelete', 'Could not delete that window'],
            ['workingHours', 'Could not save your working hours'],
            ['calendar', 'Could not send your calendar windows'],
        ];

        it.each(expectations)('names %s in its own words', async (error, expected) => {
            hookState.mutationError = error;
            const tree = await render();
            expect(tree.root.findByProps({ testID: 'tdah-dnd-mutation-error' })).toBeTruthy();
            expect(allText(tree)).toContain(expected);
        });

        it('shows nothing when the last mutation succeeded', async () => {
            const tree = await render();
            expect(tree.root.findAllByProps({ testID: 'tdah-dnd-mutation-error' })).toHaveLength(0);
        });
    });
});

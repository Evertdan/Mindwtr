import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DecisionChip } from './DecisionChip';
import type { TdahActivityDecideRequest } from './tdah-today-types';

vi.mock('@react-native-community/datetimepicker', () => ({
    __esModule: true,
    default: (props: any) => React.createElement('DateTimePicker', props),
}));

vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => ({
        text: '#0f172a', secondaryText: '#94a3b8', filterBg: '#eef2f7', tint: '#3b82f6', onTint: '#fff',
    }),
}));

vi.mock('@/contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('DecisionChip', () => {
    let onDecide: ReturnType<typeof vi.fn<(activityId: number, request: TdahActivityDecideRequest) => Promise<boolean>>>;

    beforeEach(() => {
        onDecide = vi.fn();
    });

    it('renders all four decisions, "Mañana" preselected with an outlined (non-filled) border', async () => {
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<DecisionChip activityId={5} timeZone="America/Mexico_City" onDecide={onDecide} />); });

        const tomorrow = tree!.root.findByProps({ testID: 'tdah-decision-chip-5-move-tomorrow' });
        const discard = tree!.root.findByProps({ testID: 'tdah-decision-chip-5-discard' });
        expect(tree!.root.findByProps({ testID: 'tdah-decision-chip-5-move-date' })).toBeTruthy();
        expect(tree!.root.findByProps({ testID: 'tdah-decision-chip-5-undated' })).toBeTruthy();

        const tomorrowStyle = Object.assign({}, ...[tomorrow.props.style].flat());
        const discardStyle = Object.assign({}, ...[discard.props.style].flat());
        expect(tomorrowStyle.borderWidth).toBe(2);
        expect(tomorrowStyle.backgroundColor).toBe('transparent');
        expect(discardStyle.borderWidth).toBeUndefined();
    });

    it('applies "move-tomorrow" directly on one tap, with no separate confirm step', async () => {
        onDecide.mockResolvedValue(true);
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<DecisionChip activityId={5} timeZone="America/Mexico_City" onDecide={onDecide} />); });

        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-decision-chip-5-move-tomorrow' }).props.onPress();
        });

        expect(onDecide).toHaveBeenCalledWith(5, { decision: 'move-tomorrow' });
    });

    it('applies "discard" directly on one tap', async () => {
        onDecide.mockResolvedValue(true);
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<DecisionChip activityId={5} timeZone="America/Mexico_City" onDecide={onDecide} />); });

        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-decision-chip-5-discard' }).props.onPress();
        });

        expect(onDecide).toHaveBeenCalledWith(5, { decision: 'discard' });
    });

    it('applies "undated" directly on one tap (the deliberate no-op decision)', async () => {
        onDecide.mockResolvedValue(true);
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<DecisionChip activityId={5} timeZone="America/Mexico_City" onDecide={onDecide} />); });

        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-decision-chip-5-undated' }).props.onPress();
        });

        expect(onDecide).toHaveBeenCalledWith(5, { decision: 'undated' });
    });

    it('opens the native date picker on "Fecha" and applies "move-date" with the picked calendar day once one is chosen', async () => {
        onDecide.mockResolvedValue(true);
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<DecisionChip activityId={5} timeZone="America/Mexico_City" onDecide={onDecide} />); });

        expect(tree!.root.findAllByType('DateTimePicker' as any)).toHaveLength(0);
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-decision-chip-5-move-date' }).props.onPress();
        });
        expect(tree!.root.findAllByType('DateTimePicker' as any)).toHaveLength(1);

        await act(async () => {
            tree!.root.findByType('DateTimePicker' as any).props.onChange(
                { type: 'set' },
                new Date(2026, 7, 28),
            );
        });

        expect(onDecide).toHaveBeenCalledWith(5, { decision: 'move-date', date: '2026-08-28' });
    });

    it('never applies a decision when the date picker is dismissed', async () => {
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<DecisionChip activityId={5} timeZone="America/Mexico_City" onDecide={onDecide} />); });

        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-decision-chip-5-move-date' }).props.onPress();
        });
        await act(async () => {
            tree!.root.findByType('DateTimePicker' as any).props.onChange({ type: 'dismissed' }, undefined);
        });

        expect(onDecide).not.toHaveBeenCalled();
        expect(tree!.root.findAllByType('DateTimePicker' as any)).toHaveLength(0);
    });

    it('disables every chip while a decision is pending (guards a raced double-tap)', async () => {
        let resolveDecide: (value: boolean) => void = () => {};
        onDecide.mockReturnValue(new Promise((resolve) => { resolveDecide = resolve; }));
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<DecisionChip activityId={5} timeZone="America/Mexico_City" onDecide={onDecide} />); });

        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-decision-chip-5-move-tomorrow' }).props.onPress();
        });
        expect(tree!.root.findByProps({ testID: 'tdah-decision-chip-5-discard' }).props.disabled).toBe(true);

        await act(async () => { resolveDecide(true); });
        expect(onDecide).toHaveBeenCalledTimes(1);
    });

    it('re-enables the chips after a failed decision (onDecide resolves false — spec: "chip vuelve a habilitarse")', async () => {
        onDecide.mockResolvedValue(false);
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<DecisionChip activityId={5} timeZone="America/Mexico_City" onDecide={onDecide} />); });

        await act(async () => {
            await tree!.root.findByProps({ testID: 'tdah-decision-chip-5-discard' }).props.onPress();
        });

        expect(tree!.root.findByProps({ testID: 'tdah-decision-chip-5-move-tomorrow' }).props.disabled).toBe(false);
    });

    describe('variant="limbo" (story 3.4, T-08) — swaps only the 4th chip', () => {
        it('renders "completar tardíamente" instead of "sin fecha" as the 4th chip, the other 3 unchanged', async () => {
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => {
                tree = create(<DecisionChip activityId={5} timeZone="America/Mexico_City" onDecide={onDecide} variant="limbo" />);
            });

            expect(tree!.root.findByProps({ testID: 'tdah-decision-chip-5-move-tomorrow' })).toBeTruthy();
            expect(tree!.root.findByProps({ testID: 'tdah-decision-chip-5-move-date' })).toBeTruthy();
            expect(tree!.root.findByProps({ testID: 'tdah-decision-chip-5-discard' })).toBeTruthy();
            expect(tree!.root.findByProps({ testID: 'tdah-decision-chip-5-complete-late' })).toBeTruthy();
            expect(tree!.root.findAllByProps({ testID: 'tdah-decision-chip-5-undated' })).toHaveLength(0);
        });

        it('applies "complete-late" directly on one tap', async () => {
            onDecide.mockResolvedValue(true);
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => {
                tree = create(<DecisionChip activityId={5} timeZone="America/Mexico_City" onDecide={onDecide} variant="limbo" />);
            });

            await act(async () => {
                tree!.root.findByProps({ testID: 'tdah-decision-chip-5-complete-late' }).props.onPress();
            });

            expect(onDecide).toHaveBeenCalledWith(5, { decision: 'complete-late' });
        });

        it('defaults to variant="cierre" when the prop is omitted — every existing T-05 call site keeps its original 4 chips', async () => {
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => { tree = create(<DecisionChip activityId={5} timeZone="America/Mexico_City" onDecide={onDecide} />); });

            expect(tree!.root.findByProps({ testID: 'tdah-decision-chip-5-undated' })).toBeTruthy();
            expect(tree!.root.findAllByProps({ testID: 'tdah-decision-chip-5-complete-late' })).toHaveLength(0);
        });
    });

    it("derives the date picker's minimum date from the profile time zone (AD-6), not the device/test-runner's local clock", async () => {
        // At this instant, Kiritimati (UTC+14) has already rolled into
        // 2026-08-28, while this test runner's own local zone (whatever it
        // is) has not — a device-local implementation would compute
        // tomorrow as 2026-08-29 (from *its own* today, 08-28) only by
        // coincidence; this proves the floor comes from `timeZone`, not
        // `new Date()` read in the local zone.
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-27T23:30:00.000Z'));
        try {
            let tree: ReturnType<typeof create> | undefined;
            await act(async () => {
                tree = create(<DecisionChip activityId={5} timeZone="Pacific/Kiritimati" onDecide={onDecide} />);
            });
            await act(async () => {
                tree!.root.findByProps({ testID: 'tdah-decision-chip-5-move-date' }).props.onPress();
            });

            const picker = tree!.root.findByType('DateTimePicker' as any);
            const minimumDate: Date = picker.props.minimumDate;
            expect([minimumDate.getFullYear(), minimumDate.getMonth(), minimumDate.getDate()]).toEqual([2026, 7, 29]);
            expect([picker.props.value.getFullYear(), picker.props.value.getMonth(), picker.props.value.getDate()]).toEqual([2026, 7, 29]);
        } finally {
            vi.useRealTimers();
        }
    });
});

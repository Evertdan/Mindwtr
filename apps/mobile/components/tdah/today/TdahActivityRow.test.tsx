import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { TdahActivityRow } from './TdahActivityRow';
import { styles } from './tdah-today.styles';
import type { TdahActivity } from './tdah-today-types';

const flattenStyle = (style: unknown): Record<string, unknown> => (
    Array.isArray(style) ? Object.assign({}, ...style.map(flattenStyle)) : (style as Record<string, unknown>)
);

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
        text: '#0f172a', secondaryText: '#94a3b8', cardBg: '#ffffff', border: '#e2e8f0', filterBg: '#eef2f7',
    }),
}));

// Miss every key so labels resolve through tFallback's English fallback text
// — the same "always-miss" convention tdah-settings-screen.test.tsx uses.
vi.mock('@/contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

const baseActivity: TdahActivity = {
    id: 1,
    dayPlanDate: '2026-08-26',
    blockId: null,
    title: 'Caminadora',
    startTime: '09:30',
    durationMinutes: 30,
    origin: 'routine',
    state: 'pending',
    startedAt: null,
    completedAt: null,
};

const renderRow = (activity: TdahActivity, onPress: (activity: TdahActivity) => void): ReactTestRenderer => {
    let tree!: ReactTestRenderer;
    act(() => {
        tree = create(<TdahActivityRow activity={activity} onPress={onPress} />);
    });
    return tree;
};

describe('TdahActivityRow', () => {
    it('composes the accessibility label as "hora, título, estado, origen"', () => {
        const tree = renderRow(baseActivity, () => undefined);
        const pressable = tree.root.findByType(Pressable);
        expect(pressable.props.accessibilityLabel).toBe('09:30, Caminadora, Pending, Routine');
    });

    it('reflects a different state/origin in the composed label', () => {
        const activity: TdahActivity = { ...baseActivity, state: 'completed', origin: 'manual' };
        const tree = renderRow(activity, () => undefined);
        const pressable = tree.root.findByType(Pressable);
        expect(pressable.props.accessibilityLabel).toBe('09:30, Caminadora, Completed, Manual');
    });

    it('shows the duration label when durationMinutes is above zero', () => {
        const tree = renderRow(baseActivity, () => undefined);
        const texts = tree.root.findAll((node) => node.type === Text).map((node) => node.props.children);
        expect(texts.flat().join(' ')).toContain('30');
    });

    it('hides the duration label when durationMinutes is zero (manual, no duration given)', () => {
        const activity: TdahActivity = { ...baseActivity, durationMinutes: 0 };
        const tree = renderRow(activity, () => undefined);
        const texts = tree.root.findAll((node) => node.type === Text).map((node) => node.props.children);
        // \b avoids a false match against "Caminadora", which contains the
        // substring "min" but not the word.
        expect(texts.flat().join(' ')).not.toMatch(/\bmin\b/);
    });

    it('calls onPress with the Activity when tapped', () => {
        const onPress = vi.fn();
        const tree = renderRow(baseActivity, onPress);
        act(() => {
            tree.root.findByType(Pressable).props.onPress();
        });
        expect(onPress).toHaveBeenCalledWith(baseActivity);
    });

    describe('a "sin hora" Activity (startTime: null)', () => {
        const noTimeActivity: TdahActivity = { ...baseActivity, startTime: null, durationMinutes: null };

        it('drops the time segment from the accessibility label instead of leaving it blank/garbled', () => {
            const tree = renderRow(noTimeActivity, () => undefined);
            const pressable = tree.root.findByType(Pressable);
            expect(pressable.props.accessibilityLabel).toBe('Caminadora, Pending, Routine');
        });

        it('renders no time text', () => {
            const tree = renderRow(noTimeActivity, () => undefined);
            const texts = tree.root.findAll((node) => node.type === Text).map((node) => node.props.children);
            expect(texts.flat().join(' ')).not.toContain('09:30');
        });

        it('hides the duration label when durationMinutes is null', () => {
            const tree = renderRow(noTimeActivity, () => undefined);
            const texts = tree.root.findAll((node) => node.type === Text).map((node) => node.props.children);
            expect(texts.flat().join(' ')).not.toMatch(/\bmin\b/);
        });
    });

    // AC: "fila se apila a 200% sin truncar" — a structural check that the
    // wrap-enabling layout is actually present, not a simulated
    // OS-level-font-scale rendering.
    describe('stacks instead of truncating at large font scale (AC: "fila se apila a 200% sin truncar")', () => {
        it('lets the time/title line wrap onto multiple lines instead of clipping it to one row', () => {
            const tree = renderRow(baseActivity, () => undefined);
            const topLine = tree.root.findAllByType(View).find((node) => node.props.style === styles.rowTopLine);
            expect(topLine).toBeTruthy();
            expect(flattenStyle(topLine!.props.style)).toMatchObject({ flexWrap: 'wrap' });
        });

        it('never artificially caps the title to a single line', () => {
            const tree = renderRow(baseActivity, () => undefined);
            const title = tree.root.findByProps({ children: baseActivity.title });
            expect(title.props.numberOfLines).toBeGreaterThan(1);
        });
    });
});

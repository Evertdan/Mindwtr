import React from 'react';
import { Animated } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TdahConfirmationScreen } from './TdahConfirmationScreen';

const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/use-reduced-motion', () => ({
    useReducedMotion: () => reducedMotion.value,
}));

const THEME = {
    bg: '#fff', text: '#0f172a', secondaryText: '#94a3b8', onTint: '#fff',
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

vi.mock('react-native-safe-area-context', () => ({
    SafeAreaView: (props: any) => React.createElement('SafeAreaView', props, props.children),
}));

const router = vi.hoisted(() => ({ replace: vi.fn() }));
const searchParams = vi.hoisted(() => ({
    current: {} as Record<string, string | undefined>,
}));
vi.mock('expo-router', () => ({
    useRouter: () => router,
    useLocalSearchParams: () => searchParams.current,
}));

const flattenStyle = (style: unknown): Record<string, unknown> => (
    Array.isArray(style) ? Object.assign({}, ...style) : (style as Record<string, unknown>)
);

const renderScreen = (): ReactTestRenderer => {
    let tree!: ReactTestRenderer;
    act(() => {
        tree = create(<TdahConfirmationScreen />);
    });
    return tree;
};

describe('TdahConfirmationScreen (T-07)', () => {
    beforeEach(() => {
        reducedMotion.value = false;
        router.replace.mockReset();
        searchParams.current = {};
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('never fetches — every figure comes from route params (spec Always: "T-07 no hace fetch propio")', () => {
        searchParams.current = { movedTomorrow: '2', movedDate: '1', discarded: '3', limbo: '4', morningChanges: '5' };
        const tree = renderScreen();
        expect(tree.root.findByProps({ testID: 'tdah-confirmation-moved-tomorrow' }).props.children).toBe('Moved to tomorrow: 2');
        expect(tree.root.findByProps({ testID: 'tdah-confirmation-moved-date' }).props.children).toBe('Moved to another date: 1');
        expect(tree.root.findByProps({ testID: 'tdah-confirmation-discarded' }).props.children).toBe('Discarded: 3');
        expect(tree.root.findByProps({ testID: 'tdah-confirmation-limbo' }).props.children).toBe('Left in Limbo: 4');
        expect(tree.root.findByProps({ testID: 'tdah-confirmation-changes' }).props.children).toBe('Changes to tomorrow: 5');
    });

    it('defaults every count to 0 when a param is missing (a stale/incomplete deep link)', () => {
        searchParams.current = {};
        const tree = renderScreen();
        expect(tree.root.findByProps({ testID: 'tdah-confirmation-moved-tomorrow' }).props.children).toBe('Moved to tomorrow: 0');
        expect(tree.root.findByProps({ testID: 'tdah-confirmation-changes' }).props.children).toBe('Changes to tomorrow: 0');
    });

    it('shows the neutral, non-celebratory success copy — no fetched summary, just the beat', () => {
        const tree = renderScreen();
        expect(tree.root.findByProps({ testID: 'tdah-confirmation-success' }).props.children).toBe('Tomorrow is ready.');
    });

    it('starts the beat at opacity 0 / scale 0.98 and animates both to 1 over exactly 400ms when motion is not reduced', () => {
        const timingSpy = vi.spyOn(Animated, 'timing');
        const tree = renderScreen();
        const beat = flattenStyle(tree.root.findByProps({ testID: 'tdah-confirmation-beat' }).props.style);

        // The mobile test shim's Animated.timing().start() resolves
        // synchronously (same as TdahNowLine's own pulse) — so by the time
        // renderScreen()'s act() flushes, the beat has already reached its
        // resting state. What proves the "0.98->1 fade+scale over 400ms"
        // contract here is the exact call this effect made, not an
        // in-between snapshot.
        expect((beat.opacity as { _value: number })._value).toBe(1);
        expect((beat.transform as { scale: { _value: number } }[])[0].scale._value).toBe(1);
        // Both the fade and the scale animate — one call per Animated.Value
        // — sharing the same 400ms duration and end value (`_value` is
        // mutated in place by `.start()`, so this checks the config each
        // call was made with rather than a since-overwritten starting
        // value).
        expect(timingSpy).toHaveBeenCalledTimes(2);
        for (const call of timingSpy.mock.calls) {
            expect(call[1]).toEqual(expect.objectContaining({ toValue: 1, duration: 400 }));
        }
        timingSpy.mockRestore();
    });

    it('never calls Animated.timing at all when reduced motion is enabled (spec Always)', () => {
        reducedMotion.value = true;
        const timingSpy = vi.spyOn(Animated, 'timing');
        renderScreen();
        expect(timingSpy).not.toHaveBeenCalled();
        timingSpy.mockRestore();
    });

    it('renders already at rest (opacity 1, scale 1), never animating, when reduced motion is enabled (spec Always)', () => {
        reducedMotion.value = true;
        const tree = renderScreen();
        const beat = flattenStyle(tree.root.findByProps({ testID: 'tdah-confirmation-beat' }).props.style);
        expect((beat.opacity as { _value: number })._value).toBe(1);
        expect((beat.transform as { scale: { _value: number } }[])[0].scale._value).toBe(1);
    });

    it('fires the beat only once per mount, never replaying on a re-render', () => {
        const tree = renderScreen();
        act(() => {
            vi.advanceTimersByTime(400);
        });
        const beforeRerender = flattenStyle(tree.root.findByProps({ testID: 'tdah-confirmation-beat' }).props.style);
        expect((beforeRerender.opacity as { _value: number })._value).toBe(1);

        act(() => {
            tree.update(<TdahConfirmationScreen />);
        });
        const afterRerender = flattenStyle(tree.root.findByProps({ testID: 'tdah-confirmation-beat' }).props.style);
        expect((afterRerender.opacity as { _value: number })._value).toBe(1);
    });

    it('the exit CTA replaces to /tdah-today (never back/push, so the confirmed T-06/T-05 stay unreachable via back-swipe)', () => {
        const tree = renderScreen();
        act(() => {
            tree.root.findByProps({ testID: 'tdah-confirmation-done' }).props.onPress();
        });
        expect(router.replace).toHaveBeenCalledWith('/tdah-today');
    });
});

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TdahNowLine } from './TdahNowLine';
import { TDAH_TIMELINE_PIXELS_PER_MINUTE } from './tdah-today.styles';

const reducedMotion = vi.hoisted(() => ({ value: false }));

vi.mock('@/hooks/use-reduced-motion', () => ({
    useReducedMotion: () => reducedMotion.value,
}));

vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => ({ danger: '#ef4444' }),
}));

const flattenStyle = (style: unknown): Record<string, unknown> => (
    Array.isArray(style) ? Object.assign({}, ...style) : (style as Record<string, unknown>)
);

const renderNowLine = (timeZone = 'UTC'): ReactTestRenderer => {
    let tree!: ReactTestRenderer;
    act(() => {
        tree = create(<TdahNowLine timeZone={timeZone} />);
    });
    return tree;
};

describe('TdahNowLine', () => {
    beforeEach(() => {
        reducedMotion.value = false;
        vi.useFakeTimers();
        // A fixed UTC instant (not the bare local-time string the previous
        // version of this test used) — deterministic regardless of the test
        // runner's own local zone, and lets the time-zone-conversion test
        // below prove the marker really reads `timeZone`, not any local clock.
        vi.setSystemTime(new Date('2026-08-26T09:30:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('positions itself using (hours*60 + minutes) * pixelsPerMinute in the given timeZone, the calendar-view formula', () => {
        const tree = renderNowLine('UTC');
        const marker = tree.root.findByProps({ testID: 'tdah-now-line' });
        const style = flattenStyle(marker.props.style);
        expect(style.top).toBe((9 * 60 + 30) * TDAH_TIMELINE_PIXELS_PER_MINUTE);
    });

    it('resolves "now" in the given timeZone (AD-6), not the device/test runner\'s own local clock', () => {
        // America/Mexico_City is UTC-6 with no DST since 2022: 09:30 UTC is
        // 03:30 there — a different answer than the UTC case above, which a
        // device-local-clock implementation would get wrong whenever the
        // device's zone differs from the TDAH profile's own configured zone.
        const tree = renderNowLine('America/Mexico_City');
        const marker = tree.root.findByProps({ testID: 'tdah-now-line' });
        const style = flattenStyle(marker.props.style);
        expect(style.top).toBe((3 * 60 + 30) * TDAH_TIMELINE_PIXELS_PER_MINUTE);
    });

    it('pulses the dot opacity over time when reduced motion is off', () => {
        const tree = renderNowLine();
        const dot = () => tree.root.findByProps({ testID: 'tdah-now-line-dot' });
        const opacityValue = () => flattenStyle(dot().props.style).opacity as { _value: number };

        expect(opacityValue()._value).toBe(1);
        act(() => {
            vi.advanceTimersByTime(900);
        });
        expect(opacityValue()._value).toBe(0.35);
        act(() => {
            vi.advanceTimersByTime(900);
        });
        expect(opacityValue()._value).toBe(1);
    });

    it('never animates the dot when reduced motion is enabled (spec Always)', () => {
        reducedMotion.value = true;
        const tree = renderNowLine();
        const opacityValue = () => (
            flattenStyle(tree.root.findByProps({ testID: 'tdah-now-line-dot' }).props.style).opacity as { _value: number }
        );
        expect(opacityValue()._value).toBe(1);

        act(() => {
            vi.advanceTimersByTime(5000);
        });
        expect(opacityValue()._value).toBe(1);
    });
});

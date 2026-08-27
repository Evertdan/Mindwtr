import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { TdahConnectionDot } from './TdahConnectionDot';

vi.mock('lucide-react-native', () => ({
    Circle: (props: any) => React.createElement('Circle', props),
    CircleDashed: (props: any) => React.createElement('CircleDashed', props),
}));

const THEME = {
    bg: '#fff', text: '#0f172a', secondaryText: '#94a3b8', cardBg: '#fff', border: '#e2e8f0',
    filterBg: '#eef2f7', tint: '#3b82f6', onTint: '#fff', danger: '#ef4444',
    warning: '#f59e0b', success: '#10b981', taskItemBg: '#f1f5f9',
};

vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => THEME,
}));

vi.mock('@/contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('TdahConnectionDot', () => {
    it('renders the connected glyph filled in success, with no battery chip and no explanation until tapped', () => {
        const onRequestBatteryExemption = vi.fn();
        let tree: ReturnType<typeof create> | undefined;
        act(() => {
            tree = create(
                <TdahConnectionDot status="connected" batteryLimited={false} onRequestBatteryExemption={onRequestBatteryExemption} />,
            );
        });
        const glyph = tree!.root.findByProps({ testID: 'tdah-connection-dot-connected' });
        expect(glyph.props.fill).toBe(THEME.success);
        expect(glyph.props.color).toBe(THEME.success);
        expect(tree!.root.findAllByProps({ testID: 'tdah-connection-battery-chip' })).toHaveLength(0);
        expect(tree!.root.findAllByProps({ testID: 'tdah-connection-explanation' })).toHaveLength(0);
    });

    it('renders the reconnecting glyph without an aggressive fill, in the muted tone (DESIGN.md: sin animación agresiva)', () => {
        let tree: ReturnType<typeof create> | undefined;
        act(() => {
            tree = create(
                <TdahConnectionDot status="reconnecting" batteryLimited={false} onRequestBatteryExemption={vi.fn()} />,
            );
        });
        const glyph = tree!.root.findByProps({ testID: 'tdah-connection-dot-reconnecting' });
        expect(glyph.props.color).toBe(THEME.border);
    });

    it('renders the offline glyph hollow in error color', () => {
        let tree: ReturnType<typeof create> | undefined;
        act(() => {
            tree = create(
                <TdahConnectionDot status="offline" batteryLimited={false} onRequestBatteryExemption={vi.fn()} />,
            );
        });
        const glyph = tree!.root.findByProps({ testID: 'tdah-connection-dot-offline' });
        expect(glyph.props.color).toBe(THEME.danger);
        expect(glyph.props.fill).toBe('none');
    });

    it('shows the battery-limited chip when batteryLimited is true, in every status', () => {
        let tree: ReturnType<typeof create> | undefined;
        act(() => {
            tree = create(
                <TdahConnectionDot status="connected" batteryLimited onRequestBatteryExemption={vi.fn()} />,
            );
        });
        expect(tree!.root.findByProps({ testID: 'tdah-connection-battery-chip' })).toBeTruthy();
    });

    it('tap expands an inline explanation — never a Modal (EXPERIENCE.md: nunca genera modal por sí solo)', async () => {
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => {
            tree = create(
                <TdahConnectionDot status="connected" batteryLimited={false} onRequestBatteryExemption={vi.fn()} />,
            );
        });
        expect(tree!.root.findAllByProps({ testID: 'tdah-connection-explanation' })).toHaveLength(0);

        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-connection-dot-glyph' }).props.onPress();
        });

        expect(tree!.root.findByProps({ testID: 'tdah-connection-explanation' })).toBeTruthy();
        // Tapping again collapses it back — still no Modal anywhere in the tree.
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-connection-dot-glyph' }).props.onPress();
        });
        expect(tree!.root.findAllByProps({ testID: 'tdah-connection-explanation' })).toHaveLength(0);
    });

    it('shows the battery-exemption request button inside the explanation only when battery-limited, and wires the callback', async () => {
        const onRequestBatteryExemption = vi.fn();
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => {
            tree = create(
                <TdahConnectionDot status="offline" batteryLimited onRequestBatteryExemption={onRequestBatteryExemption} />,
            );
        });
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-connection-dot-glyph' }).props.onPress();
        });
        const button = tree!.root.findByProps({ testID: 'tdah-connection-request-battery-exemption' });
        await act(async () => {
            button.props.onPress();
        });
        expect(onRequestBatteryExemption).toHaveBeenCalledTimes(1);
    });

    it('never shows the battery-exemption button when not battery-limited, even expanded', async () => {
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => {
            tree = create(
                <TdahConnectionDot status="connected" batteryLimited={false} onRequestBatteryExemption={vi.fn()} />,
            );
        });
        await act(async () => {
            tree!.root.findByProps({ testID: 'tdah-connection-dot-glyph' }).props.onPress();
        });
        expect(tree!.root.findAllByProps({ testID: 'tdah-connection-request-battery-exemption' })).toHaveLength(0);
    });
});

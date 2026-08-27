import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TdahRitualScreen } from './TdahRitualScreen';

vi.mock('react-native-safe-area-context', () => ({
    SafeAreaView: (props: any) => React.createElement('SafeAreaView', props, props.children),
}));

const THEME = {
    bg: '#fff', text: '#0f172a', secondaryText: '#94a3b8', cardBg: '#fff', border: '#e2e8f0',
    filterBg: '#eef2f7', tint: '#3b82f6', onTint: '#fff', danger: '#ef4444',
};

vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => THEME,
}));

vi.mock('@/contexts/language-context', () => ({
    useLanguage: () => ({ t: (key: string) => key }),
}));

describe('TdahRitualScreen (T-05 placeholder — Story 3.1 Never: no real T-05 content yet)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders an honest "coming soon" placeholder, never a stuck loading spinner or a scoreboard/decision-chip', async () => {
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahRitualScreen />); });

        const placeholder = tree!.root.findByProps({ testID: 'tdah-ritual-coming-soon' });
        expect(placeholder).toBeTruthy();
        // The mocked `t` returns the raw key (a miss), so `tFallback` resolves
        // to the fallback copy — asserting on that copy is what actually
        // proves the new, honest placeholder message rendered.
        const texts = placeholder.findAllByType(Text).map((node) => node.props.children);
        expect(texts).toContain('The night ritual is coming soon');

        // Never the loading-spinner copy/testID — a permanent "Loading your
        // day…" here would read as a stuck/broken screen (there is no fetch
        // behind this route in this story).
        expect(tree!.root.findAllByProps({ testID: 'tdah-ritual-loading' })).toHaveLength(0);
        expect(tree!.root.findAllByProps({ testID: 'tdah-ritual-scoreboard' })).toHaveLength(0);
    });
});

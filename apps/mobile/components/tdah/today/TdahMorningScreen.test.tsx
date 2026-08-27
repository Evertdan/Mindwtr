import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TdahMorningScreen } from './TdahMorningScreen';

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

describe('TdahMorningScreen (T-06 placeholder — spec Never: no real T-06 content yet, Story 3.3)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders an honest "coming soon" placeholder, never a stuck loading spinner or the T-05 scoreboard', async () => {
        let tree: ReturnType<typeof create> | undefined;
        await act(async () => { tree = create(<TdahMorningScreen />); });

        const placeholder = tree!.root.findByProps({ testID: 'tdah-morning-coming-soon' });
        expect(placeholder).toBeTruthy();
        // The mocked `t` returns the raw key (a miss), so `tFallback` resolves
        // to the fallback copy — asserting on that copy is what actually
        // proves the new, honest placeholder message rendered.
        const texts = placeholder.findAllByType(Text).map((node) => node.props.children);
        expect(texts).toContain("Tomorrow's plan is coming soon");

        expect(tree!.root.findAllByProps({ testID: 'tdah-morning-loading' })).toHaveLength(0);
        expect(tree!.root.findAllByProps({ testID: 'tdah-ritual-scoreboard' })).toHaveLength(0);
    });
});

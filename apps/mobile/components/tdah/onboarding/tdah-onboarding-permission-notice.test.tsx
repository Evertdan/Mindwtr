import React from 'react';
import renderer from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { TdahOnboardingPermissionNotice } from './tdah-onboarding-permission-notice';

vi.mock('@/hooks/use-theme-colors', () => ({
    useThemeColors: () => ({
        bg: '#0f172a',
        cardBg: '#111827',
        border: '#334155',
        text: '#f8fafc',
        secondaryText: '#94a3b8',
        tint: '#3b82f6',
        onTint: '#ffffff',
        inputBg: '#1e293b',
        danger: '#ef4444',
        success: '#10b981',
        warning: '#f59e0b',
    }),
}));

vi.mock('@/hooks/use-filled-button-colors', () => ({
    useFilledButtonColors: () => ({ backgroundColor: '#3b82f6', textColor: '#ffffff' }),
}));

vi.mock('@/contexts/language-context', () => ({
    useLanguage: () => ({
        language: 'en',
        t: (key: string) => key,
    }),
}));

vi.mock('react-native', async () => {
    const actual = await vi.importActual<typeof import('react-native')>('react-native');
    return {
        ...actual,
        Linking: { openSettings: vi.fn(), sendIntent: vi.fn() },
    };
});

const pressByTestId = async (tree: renderer.ReactTestRenderer, testID: string) => {
    await renderer.act(async () => {
        tree.root.findByProps({ testID }).props.onPress();
    });
};

const PERMISSIONS = { notifications: 'denied' as const, battery: 'granted' as const, calendar: 'granted' as const };

describe('TdahOnboardingPermissionNotice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('offers a Back affordance, consistent with every other step, so the user can return and grant the permission properly', async () => {
        const onBack = vi.fn();
        const onContinue = vi.fn();
        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingPermissionNotice onBack={onBack} onContinue={onContinue} permissions={PERMISSIONS} />,
            );
        });

        await pressByTestId(tree, 'tdah-onboarding-permission-notice-back');
        expect(onBack).toHaveBeenCalledTimes(1);
        expect(onContinue).not.toHaveBeenCalled();
    });

    it('still lets the user continue forward without going back', async () => {
        const onContinue = vi.fn();
        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingPermissionNotice onBack={vi.fn()} onContinue={onContinue} permissions={PERMISSIONS} />,
            );
        });

        await pressByTestId(tree, 'tdah-onboarding-permission-notice-continue');
        expect(onContinue).toHaveBeenCalledTimes(1);
    });
});

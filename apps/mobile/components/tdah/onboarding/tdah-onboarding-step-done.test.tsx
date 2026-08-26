import React from 'react';
import renderer from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { TdahOnboardingStepDone } from './tdah-onboarding-step-done';

vi.mock('@mindwtr/core', () => ({
    resolveI18nText: (
        t: (key: string) => string,
        key: string,
        options?: { values?: Record<string, string> },
    ): string => {
        const template = t(key);
        if (!options?.values) return template;
        return template.replace(/\{\{?\s*(\w+)\s*\}?\}/g, (_match, name: string) => options.values?.[name] ?? '');
    },
}));

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

const pressByTestId = async (tree: renderer.ReactTestRenderer, testID: string) => {
    await renderer.act(async () => {
        tree.root.findByProps({ testID }).props.onPress();
    });
};

const RESULT = {
    profile: { mode: 'on' as const, timeZone: 'Europe/Madrid', ritualHour: '23:00' },
    routineCreated: false,
    dayPlan: { date: '2026-08-26', activityCount: 3 },
};

describe('TdahOnboardingStepDone', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows a pending indicator while idle or pending, with no exit affordance', async () => {
        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingStepDone
                    onClose={vi.fn()}
                    onDone={vi.fn()}
                    onRetry={vi.fn()}
                    result={null}
                    status="pending"
                    variant="full"
                />,
            );
        });

        expect(tree.root.findByProps({ testID: 'tdah-onboarding-step-done-pending' })).toBeTruthy();
    });

    it('offers both Retry and Close on the error branch, and wires each independently', async () => {
        const onRetry = vi.fn();
        const onClose = vi.fn();
        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingStepDone
                    onClose={onClose}
                    onDone={vi.fn()}
                    onRetry={onRetry}
                    result={null}
                    status="error"
                    variant="reactivation"
                />,
            );
        });

        expect(tree.root.findByProps({ testID: 'tdah-onboarding-step-done-error' })).toBeTruthy();

        await pressByTestId(tree, 'tdah-onboarding-done-retry');
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();

        await pressByTestId(tree, 'tdah-onboarding-done-close');
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('renders the close affordance on the error branch for the reactivation variant, which has no earlier screen to fall back to', async () => {
        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingStepDone
                    onClose={vi.fn()}
                    onDone={vi.fn()}
                    onRetry={vi.fn()}
                    result={null}
                    status="error"
                    variant="reactivation"
                />,
            );
        });

        expect(tree.root.findByProps({ testID: 'tdah-onboarding-done-close' })).toBeTruthy();
    });

    it('shows the day plan and a Finish button that calls onDone on success', async () => {
        const onDone = vi.fn();
        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingStepDone
                    onClose={vi.fn()}
                    onDone={onDone}
                    onRetry={vi.fn()}
                    result={RESULT}
                    status="success"
                    variant="full"
                />,
            );
        });

        expect(tree.root.findByProps({ testID: 'tdah-onboarding-step-done-success' })).toBeTruthy();
        await pressByTestId(tree, 'tdah-onboarding-done-finish');
        expect(onDone).toHaveBeenCalledTimes(1);
    });
});

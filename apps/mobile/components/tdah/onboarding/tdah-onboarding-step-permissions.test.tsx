import React from 'react';
import renderer from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { TdahOnboardingStepPermissions } from './tdah-onboarding-step-permissions';

const mockGetSnapshot = vi.fn();
const mockRequestNotifications = vi.fn();
const mockRequestBattery = vi.fn();
const mockRequestCalendar = vi.fn();
const mockSubscribeBatteryRecheck = vi.fn((_onResolved: (status: string) => void) => () => undefined);

vi.mock('@/lib/tdah-permissions', () => ({
    getTdahPermissionsSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
    requestTdahNotificationsPermission: (...args: unknown[]) => mockRequestNotifications(...args),
    requestTdahBatteryPermission: (...args: unknown[]) => mockRequestBattery(...args),
    requestTdahCalendarPermission: (...args: unknown[]) => mockRequestCalendar(...args),
    isTdahBatteryPermissionApplicable: () => true,
    subscribeTdahBatteryPermissionForegroundRecheck: (onResolved: (status: string) => void) => (
        mockSubscribeBatteryRecheck(onResolved)
    ),
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

vi.mock('react-native', async () => {
    const actual = await vi.importActual<typeof import('react-native')>('react-native');
    return {
        ...actual,
        Platform: { OS: 'android', Version: 34, select: (options: Record<string, unknown>) => options.android ?? options.default },
    };
});

const flushAsync = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
};

const pressByTestId = async (tree: renderer.ReactTestRenderer, testID: string) => {
    await renderer.act(async () => {
        tree.root.findByProps({ testID }).props.onPress();
        await flushAsync();
    });
};

const renderStep = async (onContinue = vi.fn(), onBack = vi.fn()) => {
    let tree!: renderer.ReactTestRenderer;
    await renderer.act(async () => {
        tree = renderer.create(
            <TdahOnboardingStepPermissions onContinue={onContinue} onBack={onBack} />,
        );
    });
    return tree;
};

describe('TdahOnboardingStepPermissions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSnapshot.mockResolvedValue({ notifications: 'granted', battery: 'granted', calendar: 'granted' });
    });

    it('disables Continue until the permissions snapshot resolves, then enables it', async () => {
        let resolveSnapshot!: (value: { notifications: string; battery: string; calendar: string }) => void;
        mockGetSnapshot.mockReturnValue(new Promise((resolve) => {
            resolveSnapshot = resolve;
        }));

        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingStepPermissions onContinue={vi.fn()} onBack={vi.fn()} />,
            );
        });

        const continueButton = () => tree.root.findByProps({ testID: 'tdah-onboarding-permissions-continue' });
        expect(continueButton().props.accessibilityState.disabled).toBe(true);
        expect(continueButton().props.disabled).toBe(true);

        await renderer.act(async () => {
            resolveSnapshot({ notifications: 'granted', battery: 'granted', calendar: 'granted' });
            await flushAsync();
        });

        expect(continueButton().props.accessibilityState.disabled).toBe(false);
        expect(continueButton().props.disabled).toBe(false);
    });

    it('does not submit the fallback snapshot when Continue is pressed before the fetch resolves', async () => {
        let resolveSnapshot!: (value: { notifications: string; battery: string; calendar: string }) => void;
        mockGetSnapshot.mockReturnValue(new Promise((resolve) => {
            resolveSnapshot = resolve;
        }));
        const onContinue = vi.fn();

        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingStepPermissions onContinue={onContinue} onBack={vi.fn()} />,
            );
        });

        // A fast tap while still loading must be a no-op — disabled buttons don't fire onPress
        // in real RN, but we assert the prop directly since react-test-renderer doesn't enforce it.
        expect(tree.root.findByProps({ testID: 'tdah-onboarding-permissions-continue' }).props.disabled).toBe(true);
        expect(onContinue).not.toHaveBeenCalled();

        await renderer.act(async () => {
            resolveSnapshot({ notifications: 'denied', battery: 'granted', calendar: 'undetermined' });
            await flushAsync();
        });

        await pressByTestId(tree, 'tdah-onboarding-permissions-continue');
        expect(onContinue).toHaveBeenCalledWith({ notifications: 'denied', battery: 'granted', calendar: 'undetermined' });
    });

    it('still enables Continue when the snapshot fetch rejects, falling back to undetermined', async () => {
        mockGetSnapshot.mockRejectedValue(new Error('calendar permission check threw'));
        const onContinue = vi.fn();

        const tree = await renderStep(onContinue);

        const continueButton = tree.root.findByProps({ testID: 'tdah-onboarding-permissions-continue' });
        expect(continueButton.props.disabled).toBe(false);
        expect(continueButton.props.accessibilityState.disabled).toBe(false);

        await pressByTestId(tree, 'tdah-onboarding-permissions-continue');
        expect(onContinue).toHaveBeenCalledWith({ notifications: 'undetermined', battery: 'undetermined', calendar: 'undetermined' });
    });

    it('keeps the previous status and resets busy state when a permission request rejects', async () => {
        mockGetSnapshot.mockResolvedValue({ notifications: 'undetermined', battery: 'granted', calendar: 'undetermined' });
        mockRequestNotifications.mockRejectedValue(new Error('request failed'));

        const tree = await renderStep();

        await pressByTestId(tree, 'tdah-onboarding-permission-request-notifications');

        // Status is unchanged (still undetermined) and the button is no longer busy/disabled.
        expect(tree.root.findByProps({ testID: 'tdah-onboarding-permission-status-notifications' }).props.children)
            .toBe('tdahOnboarding.permissions.statusUndetermined');
        const requestButton = tree.root.findByProps({ testID: 'tdah-onboarding-permission-request-notifications' });
        expect(requestButton.props.disabled).toBe(false);
        expect(requestButton.props.accessibilityState.disabled).toBe(false);
    });

    it('does not throw an unhandled rejection when the calendar permission request rejects', async () => {
        mockGetSnapshot.mockResolvedValue({ notifications: 'granted', battery: 'granted', calendar: 'undetermined' });
        mockRequestCalendar.mockRejectedValue(new Error('calendar request threw'));

        const tree = await renderStep();

        await expect(pressByTestId(tree, 'tdah-onboarding-permission-request-calendar')).resolves.not.toThrow();

        expect(tree.root.findByProps({ testID: 'tdah-onboarding-permission-status-calendar' }).props.children)
            .toBe('tdahOnboarding.permissions.statusUndetermined');
    });

    it('updates the status and clears busy state when a permission request succeeds', async () => {
        mockGetSnapshot.mockResolvedValue({ notifications: 'undetermined', battery: 'granted', calendar: 'undetermined' });
        mockRequestNotifications.mockResolvedValue('granted');

        const tree = await renderStep();

        await pressByTestId(tree, 'tdah-onboarding-permission-request-notifications');

        expect(tree.root.findByProps({ testID: 'tdah-onboarding-permission-status-notifications' }).props.children)
            .toBe('tdahOnboarding.permissions.statusGranted');
    });
});

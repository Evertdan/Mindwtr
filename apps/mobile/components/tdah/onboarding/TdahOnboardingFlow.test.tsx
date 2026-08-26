import React from 'react';
import renderer from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { TdahOnboardingFlow } from './TdahOnboardingFlow';

const mockCloudRequestJson = vi.fn();
const mockGetSnapshot = vi.fn();
const mockRequestNotifications = vi.fn();
const mockRequestBattery = vi.fn();
const mockRequestCalendar = vi.fn();
const mockSubscribeBatteryRecheck = vi.fn((_onResolved: (status: string) => void) => () => undefined);

const TRANSLATIONS: Record<string, string> = {
    'tdahOnboarding.done.dayPlanReady': 'Ready for {{date}} with {{count}} activities',
};

vi.mock('@mindwtr/core', () => ({
    cloudRequestJson: (...args: unknown[]) => mockCloudRequestJson(...args),
    getCloudBaseUrl: (url: string) => `${url.replace(/\/+$/, '')}/v1`,
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

vi.mock('@/lib/webdav-request-options', () => ({
    getMobileCloudRequestOptions: (allowInsecureHttp?: boolean) => (
        allowInsecureHttp === true ? { allowInsecureHttp: true } : {}
    ),
}));

vi.mock('@/lib/tdah-permissions', () => ({
    getTdahPermissionsSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
    requestTdahNotificationsPermission: (...args: unknown[]) => mockRequestNotifications(...args),
    requestTdahBatteryPermission: (...args: unknown[]) => mockRequestBattery(...args),
    requestTdahCalendarPermission: (...args: unknown[]) => mockRequestCalendar(...args),
    isTdahBatteryPermissionApplicable: () => true,
    subscribeTdahBatteryPermissionForegroundRecheck: (onResolved: (status: string) => void) => (
        mockSubscribeBatteryRecheck(onResolved)
    ),
    isTdahPermissionDegraded: (snapshot: { notifications: string; battery: string; calendar: string }) => (
        snapshot.notifications !== 'granted' || snapshot.battery !== 'granted' || snapshot.calendar !== 'granted'
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
        t: (key: string) => TRANSLATIONS[key] ?? key,
    }),
}));

vi.mock('react-native-safe-area-context', () => ({
    SafeAreaView: (props: { children?: React.ReactNode }) => (
        React.createElement('SafeAreaView', null, props.children)
    ),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock('react-native', async () => {
    const actual = await vi.importActual<typeof import('react-native')>('react-native');
    return {
        ...actual,
        Platform: { OS: 'android', Version: 34, select: (options: Record<string, unknown>) => options.android ?? options.default },
        Linking: { openSettings: vi.fn(), sendIntent: vi.fn() },
    };
});

const CLOUD = { url: 'https://sync.example.com', token: 'cloud-token-1234567890', allowInsecureHttp: false };

const flushAsync = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
};

const pressByTestId = async (tree: renderer.ReactTestRenderer, testID: string) => {
    await renderer.act(async () => {
        tree.root.findByProps({ testID }).props.onPress();
        await flushAsync();
    });
};

describe('TdahOnboardingFlow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSnapshot.mockResolvedValue({ notifications: 'granted', battery: 'granted', calendar: 'granted' });
        mockCloudRequestJson.mockResolvedValue({
            profile: { mode: 'on', timeZone: 'Europe/Madrid', ritualHour: '23:00' },
            routineCreated: false,
            dayPlan: { date: '2026-08-26', activityCount: 0 },
        });
    });

    it('walks the full 5-step flow and activates with the created routine', async () => {
        const onFinished = vi.fn();
        const onClose = vi.fn();
        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingFlow
                    cloud={CLOUD}
                    variant="full"
                    initialTimeZone="Europe/Madrid"
                    onFinished={onFinished}
                    onClose={onClose}
                />,
            );
        });

        expect(tree.root.findByProps({ testID: 'tdah-onboarding-step-promise' })).toBeTruthy();
        await pressByTestId(tree, 'tdah-onboarding-promise-next');

        expect(tree.root.findByProps({ testID: 'tdah-onboarding-step-ritual' })).toBeTruthy();
        await pressByTestId(tree, 'tdah-onboarding-ritual-next');

        expect(tree.root.findByProps({ testID: 'tdah-onboarding-step-routine' })).toBeTruthy();
        await pressByTestId(tree, 'tdah-onboarding-routine-create');

        expect(tree.root.findByProps({ testID: 'tdah-onboarding-step-permissions' })).toBeTruthy();
        await pressByTestId(tree, 'tdah-onboarding-permissions-continue');

        // All granted — the permission notice is skipped entirely.
        expect(tree.root.findAllByProps({ testID: 'tdah-onboarding-permission-notice' })).toHaveLength(0);
        expect(tree.root.findByProps({ testID: 'tdah-onboarding-step-done-success' })).toBeTruthy();

        expect(mockCloudRequestJson).toHaveBeenCalledWith(
            'POST',
            'https://sync.example.com/v1/tdah/activate',
            {
                timeZone: 'Europe/Madrid',
                ritualHour: '23:00',
                routine: {
                    title: 'Día laboral',
                    blocks: [
                        { title: 'Mañana', startTime: '08:00', durationMinutes: 240 },
                        { title: 'Tarde', startTime: '13:00', durationMinutes: 240 },
                        { title: 'Noche', startTime: '19:00', durationMinutes: 120 },
                    ],
                },
            },
            expect.objectContaining({ token: CLOUD.token }),
        );
        expect(onFinished).toHaveBeenCalledWith(expect.objectContaining({ dayPlan: { date: '2026-08-26', activityCount: 0 } }));

        const dayPlanText = tree.root.findByProps({ testID: 'tdah-onboarding-done-day-plan' }).props.children;
        expect(dayPlanText).toBe('Ready for 2026-08-26 with 0 activities');
    });

    it('activates without a routine when the user skips step 3', async () => {
        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingFlow
                    cloud={CLOUD}
                    variant="full"
                    initialTimeZone="UTC"
                    onFinished={vi.fn()}
                    onClose={vi.fn()}
                />,
            );
        });

        await pressByTestId(tree, 'tdah-onboarding-promise-next');
        await pressByTestId(tree, 'tdah-onboarding-ritual-next');
        await pressByTestId(tree, 'tdah-onboarding-routine-skip');
        await pressByTestId(tree, 'tdah-onboarding-permissions-continue');

        expect(mockCloudRequestJson).toHaveBeenCalledWith(
            'POST',
            expect.any(String),
            { timeZone: 'UTC', ritualHour: '23:00' },
            expect.anything(),
        );
    });

    it('routes through the permission notice when any permission is degraded, and never blocks completion', async () => {
        mockGetSnapshot.mockResolvedValue({ notifications: 'denied', battery: 'granted', calendar: 'granted' });
        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingFlow
                    cloud={CLOUD}
                    variant="full"
                    initialTimeZone="UTC"
                    onFinished={vi.fn()}
                    onClose={vi.fn()}
                />,
            );
        });

        await pressByTestId(tree, 'tdah-onboarding-promise-next');
        await pressByTestId(tree, 'tdah-onboarding-ritual-next');
        await pressByTestId(tree, 'tdah-onboarding-routine-skip');
        await pressByTestId(tree, 'tdah-onboarding-permissions-continue');

        expect(tree.root.findByProps({ testID: 'tdah-onboarding-permission-notice' })).toBeTruthy();
        expect(mockCloudRequestJson).not.toHaveBeenCalled();

        await pressByTestId(tree, 'tdah-onboarding-permission-notice-continue');

        expect(tree.root.findByProps({ testID: 'tdah-onboarding-step-done-success' })).toBeTruthy();
        expect(mockCloudRequestJson).toHaveBeenCalledTimes(1);
    });

    it('reactivation skips steps 1-4 and activates with an empty body', async () => {
        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingFlow
                    cloud={CLOUD}
                    variant="reactivation"
                    initialTimeZone="Europe/Madrid"
                    onFinished={vi.fn()}
                    onClose={vi.fn()}
                />,
            );
        });

        expect(tree.root.findAllByProps({ testID: 'tdah-onboarding-step-promise' })).toHaveLength(0);
        expect(tree.root.findByProps({ testID: 'tdah-onboarding-step-done-success' })).toBeTruthy();
        expect(mockCloudRequestJson).toHaveBeenCalledWith(
            'POST',
            'https://sync.example.com/v1/tdah/activate',
            {},
            expect.anything(),
        );
    });

    it('shows a retry affordance and never fabricates a result when activation fails', async () => {
        mockCloudRequestJson.mockRejectedValueOnce(new Error('network down'));
        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingFlow
                    cloud={CLOUD}
                    variant="reactivation"
                    initialTimeZone="UTC"
                    onFinished={vi.fn()}
                    onClose={vi.fn()}
                />,
            );
        });

        expect(tree.root.findByProps({ testID: 'tdah-onboarding-step-done-error' })).toBeTruthy();
        expect(tree.root.findAllByProps({ testID: 'tdah-onboarding-step-done-success' })).toHaveLength(0);

        await pressByTestId(tree, 'tdah-onboarding-done-retry');

        expect(mockCloudRequestJson).toHaveBeenCalledTimes(2);
        expect(tree.root.findByProps({ testID: 'tdah-onboarding-step-done-success' })).toBeTruthy();
    });

    it('lets the user close out of a failed reactivation instead of being stuck on a repeated retry', async () => {
        mockCloudRequestJson.mockRejectedValueOnce(new Error('network down'));
        const onClose = vi.fn();
        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingFlow
                    cloud={CLOUD}
                    variant="reactivation"
                    initialTimeZone="UTC"
                    onFinished={vi.fn()}
                    onClose={onClose}
                />,
            );
        });

        // Reactivation shows step 5 first — there is no earlier screen with a close
        // button, so the error branch itself must offer one.
        expect(tree.root.findByProps({ testID: 'tdah-onboarding-step-done-error' })).toBeTruthy();

        await pressByTestId(tree, 'tdah-onboarding-done-close');

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not update state or call onFinished after the flow unmounts mid-activation', async () => {
        let resolveActivate!: (value: unknown) => void;
        mockCloudRequestJson.mockReturnValueOnce(new Promise((resolve) => {
            resolveActivate = resolve;
        }));
        const onFinished = vi.fn();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingFlow
                    cloud={CLOUD}
                    variant="reactivation"
                    initialTimeZone="UTC"
                    onFinished={onFinished}
                    onClose={vi.fn()}
                />,
            );
        });

        await renderer.act(async () => {
            tree.unmount();
        });

        await renderer.act(async () => {
            resolveActivate({
                profile: { mode: 'on', timeZone: 'UTC', ritualHour: '23:00' },
                routineCreated: false,
                dayPlan: { date: '2026-08-26', activityCount: 0 },
            });
            await flushAsync();
        });

        expect(onFinished).not.toHaveBeenCalled();
        const stateUpdateWarning = consoleError.mock.calls.some(([message]) => (
            typeof message === 'string' && message.includes("state update")
        ));
        expect(stateUpdateWarning).toBe(false);

        consoleError.mockRestore();
    });

    it('lets the user go back from the permission notice to grant a permission properly', async () => {
        mockGetSnapshot.mockResolvedValue({ notifications: 'denied', battery: 'granted', calendar: 'granted' });
        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingFlow
                    cloud={CLOUD}
                    variant="full"
                    initialTimeZone="UTC"
                    onFinished={vi.fn()}
                    onClose={vi.fn()}
                />,
            );
        });

        await pressByTestId(tree, 'tdah-onboarding-promise-next');
        await pressByTestId(tree, 'tdah-onboarding-ritual-next');
        await pressByTestId(tree, 'tdah-onboarding-routine-skip');
        await pressByTestId(tree, 'tdah-onboarding-permissions-continue');

        expect(tree.root.findByProps({ testID: 'tdah-onboarding-permission-notice' })).toBeTruthy();

        await pressByTestId(tree, 'tdah-onboarding-permission-notice-back');

        expect(tree.root.findByProps({ testID: 'tdah-onboarding-step-permissions' })).toBeTruthy();
        expect(tree.root.findAllByProps({ testID: 'tdah-onboarding-permission-notice' })).toHaveLength(0);
        expect(mockCloudRequestJson).not.toHaveBeenCalled();
    });

    it('closes without activating when the user backs out of step 1', async () => {
        const onClose = vi.fn();
        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingFlow
                    cloud={CLOUD}
                    variant="full"
                    initialTimeZone="UTC"
                    onFinished={vi.fn()}
                    onClose={onClose}
                />,
            );
        });

        await pressByTestId(tree, 'tdah-onboarding-close');

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mockCloudRequestJson).not.toHaveBeenCalled();
    });

    it('rejects an invalid ritual hour or time zone before letting the user continue', async () => {
        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingFlow
                    cloud={CLOUD}
                    variant="full"
                    initialTimeZone="UTC"
                    onFinished={vi.fn()}
                    onClose={vi.fn()}
                />,
            );
        });

        await pressByTestId(tree, 'tdah-onboarding-promise-next');

        await renderer.act(async () => {
            tree.root.findByProps({ testID: 'tdah-onboarding-ritual-hour-input' }).props.onChangeText('25:99');
        });

        const nextButton = tree.root.findByProps({ testID: 'tdah-onboarding-ritual-next' });
        expect(nextButton.props.accessibilityState.disabled).toBe(true);

        await renderer.act(async () => {
            tree.root.findByProps({ testID: 'tdah-onboarding-ritual-hour-input' }).props.onChangeText('22:15');
        });
        expect(tree.root.findByProps({ testID: 'tdah-onboarding-ritual-next' }).props.accessibilityState.disabled).toBe(false);
    });

    it('exposes every actionable control as an accessible button', async () => {
        let tree!: renderer.ReactTestRenderer;
        await renderer.act(async () => {
            tree = renderer.create(
                <TdahOnboardingFlow
                    cloud={CLOUD}
                    variant="full"
                    initialTimeZone="UTC"
                    onFinished={vi.fn()}
                    onClose={vi.fn()}
                />,
            );
        });

        const buttons = tree.root.findAllByType(TouchableOpacity);
        expect(buttons.length).toBeGreaterThan(0);
        buttons.forEach((button) => {
            expect(button.props.accessibilityRole).toBe('button');
        });
    });
});

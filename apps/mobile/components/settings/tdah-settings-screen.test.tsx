import React from 'react';
import renderer from 'react-test-renderer';
import { Switch, Text, TouchableOpacity } from 'react-native';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { TdahSettingsScreen, detectDeviceTimeZone } from './tdah-settings-screen';

const cloudGetJson = vi.fn();
const cloudPutJson = vi.fn().mockResolvedValue({});
const asyncStorageGetItem = vi.fn();
const getSecureConfigValue = vi.fn();

vi.mock('@mindwtr/core', () => ({
    cloudGetJson: (...args: unknown[]) => cloudGetJson(...args),
    cloudPutJson: (...args: unknown[]) => cloudPutJson(...args),
    getCloudBaseUrl: (url: string) => `${url.replace(/\/+$/, '')}/v1`,
}));

vi.mock('@/lib/secure-config', () => ({
    getSecureConfigValue: (...args: unknown[]) => getSecureConfigValue(...args),
}));

vi.mock('@/lib/webdav-request-options', () => ({
    getMobileCloudRequestOptions: (allowInsecureHttp?: boolean) => (
        allowInsecureHttp === true ? { allowInsecureHttp: true } : {}
    ),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: (...args: unknown[]) => asyncStorageGetItem(...args),
        setItem: vi.fn(async () => undefined),
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
    }),
}));

vi.mock('./settings.hooks', () => ({
    useSettingsLocalization: () => ({
        isChineseLanguage: false,
        language: 'en',
        tr: (key: string) => key,
        t: (key: string) =>
            ({
                'settings.tdah.title': 'ADHD mode',
                'settings.tdah.enable': 'Enable ADHD mode',
                'settings.tdah.enableDesc': 'Activities and their history are kept; turning it off only pauses generation and reminders.',
                'settings.tdah.timeZone': 'Profile time zone',
                'settings.tdah.ritualHour': 'Nightly ritual hour',
                'settings.tdah.loading': 'Loading ADHD mode state…',
                'settings.tdah.loadError': 'Could not load the ADHD mode state from your server.',
                'settings.tdah.retry': 'Retry',
                'settings.tdah.saveError': 'Could not save the change. Please try again.',
                'settings.tdah.needsSync': 'Set up Self-Hosted cloud sync to use ADHD mode.',
            }[key] ?? key),
    }),
    useSettingsScrollContent: () => ({}),
}));

vi.mock('./settings.shell', () => ({
    SettingsTopBar: () => React.createElement('SettingsTopBar'),
}));

vi.mock('react-native-safe-area-context', () => ({
    SafeAreaView: (props: { children?: React.ReactNode }) => (
        React.createElement('SafeAreaView', null, props.children)
    ),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

type MockOnboardingProps = {
    variant: 'full' | 'reactivation';
    initialTimeZone: string;
    onFinished: (result: unknown) => void;
    onClose: () => void;
};

const mockOnboardingProps = vi.fn<(props: MockOnboardingProps) => void>();

vi.mock('../tdah/onboarding/TdahOnboardingFlow', () => ({
    TdahOnboardingFlow: (props: MockOnboardingProps) => {
        mockOnboardingProps(props);
        return React.createElement('TdahOnboardingFlow', { testID: 'tdah-onboarding-flow-mock' });
    },
}));

const CLOUD_URL = 'https://sync.example.com';
const CLOUD_TOKEN = 'cloud-token-1234567890';

const configureCloudSync = (url: string | null = CLOUD_URL, token: string | null = CLOUD_TOKEN): void => {
    asyncStorageGetItem.mockImplementation(async (key: string) => {
        if (key === '@mindwtr_cloud_url') return url;
        if (key === '@mindwtr_cloud_allow_insecure_http') return 'false';
        return null;
    });
    getSecureConfigValue.mockImplementation(async (key: string) => (
        key === '@mindwtr_cloud_token' ? token : null
    ));
};

const renderScreen = async (): Promise<renderer.ReactTestRenderer> => {
    let tree!: renderer.ReactTestRenderer;
    await renderer.act(async () => {
        tree = renderer.create(<TdahSettingsScreen />);
    });
    return tree;
};

const findSwitch = (tree: renderer.ReactTestRenderer): renderer.ReactTestInstance => (
    tree.root.findByType(Switch)
);

describe('TdahSettingsScreen', () => {
    beforeEach(() => {
        cloudGetJson.mockReset().mockResolvedValue({ profile: null });
        cloudPutJson.mockReset().mockResolvedValue({});
        asyncStorageGetItem.mockReset();
        getSecureConfigValue.mockReset();
        mockOnboardingProps.mockReset();
    });

    it('falls back to UTC when the device time zone cannot be resolved', () => {
        const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
        Intl.DateTimeFormat.prototype.resolvedOptions = () => {
            throw new Error('unavailable');
        };
        try {
            expect(detectDeviceTimeZone()).toBe('UTC');
        } finally {
            Intl.DateTimeFormat.prototype.resolvedOptions = originalResolvedOptions;
        }
    });

    it('shows a disabled toggle with the sync hint when cloud sync is not configured', async () => {
        configureCloudSync(null, null);
        const tree = await renderScreen();

        const modeSwitch = findSwitch(tree);
        expect(modeSwitch.props.value).toBe(false);
        expect(modeSwitch.props.disabled).toBe(true);

        const texts = tree.root.findAllByType(Text).map((node) => node.props.children);
        expect(texts).toContain('Set up Self-Hosted cloud sync to use ADHD mode.');
        expect(cloudGetJson).not.toHaveBeenCalled();
    });

    it('reflects the server profile after the initial GET', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({
            profile: { mode: 'on', timeZone: 'Europe/Madrid', ritualHour: '22:30' },
        });
        const tree = await renderScreen();

        expect(cloudGetJson).toHaveBeenCalledWith(
            'https://sync.example.com/v1/tdah/profile',
            expect.objectContaining({ token: CLOUD_TOKEN }),
        );

        const modeSwitch = findSwitch(tree);
        expect(modeSwitch.props.value).toBe(true);
        expect(modeSwitch.props.disabled).toBe(false);

        const timeZoneValue = tree.root.findByProps({ testID: 'tdah-time-zone-value' }).props.children;
        expect(timeZoneValue).toBe('Europe/Madrid');
        const ritualHourValue = tree.root.findByProps({ testID: 'tdah-ritual-hour-value' }).props.children;
        expect(ritualHourValue).toBe('22:30');
    });

    it('opens the full onboarding flow instead of PUTting when the profile never existed (first activation)', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValueOnce({ profile: null });
        const tree = await renderScreen();

        const modeSwitch = findSwitch(tree);
        expect(modeSwitch.props.value).toBe(false);

        await renderer.act(async () => {
            await modeSwitch.props.onValueChange(true);
        });

        expect(cloudPutJson).not.toHaveBeenCalled();
        expect(tree.root.findByProps({ testID: 'tdah-onboarding-flow-mock' })).toBeTruthy();
        expect(mockOnboardingProps).toHaveBeenCalledWith(
            expect.objectContaining({ variant: 'full' }),
        );
    });

    it('opens the reactivation onboarding step when a previously-off profile is turned back on', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValueOnce({
            profile: { mode: 'off', timeZone: 'Europe/Madrid', ritualHour: '22:30' },
        });
        const tree = await renderScreen();

        await renderer.act(async () => {
            await findSwitch(tree).props.onValueChange(true);
        });

        expect(cloudPutJson).not.toHaveBeenCalled();
        expect(tree.root.findByProps({ testID: 'tdah-onboarding-flow-mock' })).toBeTruthy();
        expect(mockOnboardingProps).toHaveBeenCalledWith(
            expect.objectContaining({ variant: 'reactivation', initialTimeZone: 'Europe/Madrid' }),
        );
    });

    it('closes the onboarding overlay and re-reads the server state once it finishes', async () => {
        configureCloudSync();
        cloudGetJson
            .mockResolvedValueOnce({ profile: null })
            .mockResolvedValueOnce({ profile: { mode: 'on', timeZone: 'Europe/Madrid', ritualHour: '22:30' } });
        const tree = await renderScreen();

        await renderer.act(async () => {
            await findSwitch(tree).props.onValueChange(true);
        });
        const { onFinished } = mockOnboardingProps.mock.calls[0][0];

        await renderer.act(async () => {
            onFinished({ profile: { mode: 'on', timeZone: 'Europe/Madrid', ritualHour: '22:30' }, routineCreated: false, dayPlan: { date: '2026-08-26', activityCount: 0 } });
        });

        expect(tree.root.findAllByProps({ testID: 'tdah-onboarding-flow-mock' })).toHaveLength(0);
        expect(cloudGetJson).toHaveBeenCalledTimes(2);
        expect(findSwitch(tree).props.value).toBe(true);
    });

    it('closes the onboarding overlay without any server call when the user backs out', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValueOnce({ profile: null });
        const tree = await renderScreen();

        await renderer.act(async () => {
            await findSwitch(tree).props.onValueChange(true);
        });
        const { onClose } = mockOnboardingProps.mock.calls[0][0];

        await renderer.act(async () => {
            onClose();
        });

        expect(tree.root.findAllByProps({ testID: 'tdah-onboarding-flow-mock' })).toHaveLength(0);
        expect(cloudGetJson).toHaveBeenCalledTimes(1);
        expect(cloudPutJson).not.toHaveBeenCalled();
    });

    it('disabling the mode PUTs off without touching the time zone', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValueOnce({
            profile: { mode: 'on', timeZone: 'Europe/Madrid', ritualHour: '22:30' },
        });
        const tree = await renderScreen();

        await renderer.act(async () => {
            await findSwitch(tree).props.onValueChange(false);
        });

        expect(cloudPutJson).toHaveBeenCalledWith(
            'https://sync.example.com/v1/tdah/profile',
            { mode: 'off' },
            expect.objectContaining({ token: CLOUD_TOKEN }),
        );
    });

    it('renders the load error with a retry that recovers', async () => {
        configureCloudSync();
        cloudGetJson.mockRejectedValueOnce(new Error('network down'));
        let tree = await renderScreen();

        expect(tree.root.findByProps({ testID: 'tdah-load-error' })).toBeTruthy();
        expect(tree.root.findAllByType(Switch)).toHaveLength(0);

        cloudGetJson.mockResolvedValueOnce({
            profile: { mode: 'on', timeZone: 'Europe/Madrid', ritualHour: '22:30' },
        });
        await renderer.act(async () => {
            tree.root.findByProps({ testID: 'tdah-retry' }).props.onPress();
        });

        expect(tree.root.findByProps({ testID: 'tdah-mode-row' })).toBeTruthy();
        expect(findSwitch(tree).props.value).toBe(true);
    });

    it('shows the save error and keeps the server state when the PUT fails', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValueOnce({
            profile: { mode: 'on', timeZone: 'Europe/Madrid', ritualHour: '22:30' },
        });
        const tree = await renderScreen();

        cloudPutJson.mockRejectedValueOnce(new Error('network down'));
        await renderer.act(async () => {
            await findSwitch(tree).props.onValueChange(false);
        });

        expect(tree.root.findByProps({ testID: 'tdah-save-error' })).toBeTruthy();
        expect(findSwitch(tree).props.value).toBe(true);
    });

    it('keeps the toggle usable again after a failed mutation', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({
            profile: { mode: 'on', timeZone: 'Europe/Madrid', ritualHour: '22:30' },
        });
        const tree = await renderScreen();

        cloudPutJson.mockRejectedValueOnce(new Error('network down'));
        await renderer.act(async () => {
            await findSwitch(tree).props.onValueChange(false);
        });
        expect(findSwitch(tree).props.disabled).toBe(false);

        cloudPutJson.mockResolvedValueOnce({});
        await renderer.act(async () => {
            await findSwitch(tree).props.onValueChange(false);
        });
        expect(tree.root.findAllByProps({ testID: 'tdah-save-error' })).toHaveLength(0);
    });

    it('exposes the retry control as a labelled button', async () => {
        configureCloudSync();
        cloudGetJson.mockRejectedValueOnce(new Error('network down'));
        const tree = await renderScreen();

        const retryButtons = tree.root.findAllByType(TouchableOpacity)
            .filter((node) => node.props.testID === 'tdah-retry');
        expect(retryButtons).toHaveLength(1);
        expect(retryButtons[0].props.accessibilityLabel).toBe('Retry');
    });
});

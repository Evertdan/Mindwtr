import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CloudHttpError } from '@mindwtr/core';

import { TdahActivationSection } from './TdahActivationSection';

const LABELS: Record<string, string> = {
    'settings.tdah.title': 'ADHD mode',
    'settings.tdah.enable': 'Enable ADHD mode',
    'settings.tdah.needsSync': 'Set up Self-Hosted cloud sync to use ADHD mode.',
    'settings.tdah.loading': 'Loading ADHD mode state…',
    'settings.tdah.loadError': 'Could not load the ADHD mode state from your server.',
    'settings.tdah.retry': 'Retry',
    'settings.tdah.activatePwaTitle': 'Activate ADHD mode',
    'settings.tdah.activatePwaBody': 'Confirm your time zone and ritual hour to turn it on.',
    'settings.tdah.activatePwaButton': 'Activate',
    'settings.tdah.activatePwaBusy': 'Activating…',
    'settings.tdah.activatePwaDone': 'Activated — tomorrow is already generated.',
    'settings.tdah.activatePwaError': 'Could not activate ADHD mode. Try again.',
    'settings.tdah.timeZone': 'Profile time zone',
    'settings.tdah.timeZoneDesc': 'Your hours are calculated in this time zone.',
    'settings.tdah.ritualHour': 'Nightly ritual hour',
    'settings.tdah.ritualHourDesc': 'Defaults to 23:00.',
    'tdahOnboarding.step2TimeZoneLabel': 'Time zone',
    'tdahOnboarding.step2TimeZoneDetected': 'Detected automatically — confirm or change it.',
    'tdahOnboarding.ritual.invalidTimeZone': "That doesn't look like a valid time zone.",
    'tdahOnboarding.ritual.invalidRitualHour': 'Enter a valid time in HH:mm format.',
};

const cloudGetJson = vi.fn();
const cloudRequestJson = vi.fn();
const getCloudConfig = vi.fn();

vi.mock('@mindwtr/core', () => {
    class CloudHttpError extends Error {
        status: number;
        statusCode: number;

        constructor(message: string, status: number) {
            super(message);
            this.name = 'CloudHttpError';
            this.status = status;
            this.statusCode = status;
        }
    }
    return {
        CloudHttpError,
        cloudGetJson: (...args: unknown[]) => cloudGetJson(...args),
        cloudRequestJson: (...args: unknown[]) => cloudRequestJson(...args),
        getCloudBaseUrl: (url: string) => `${url.replace(/\/+$/, '')}/v1`,
        getTranslator: () => (key: string) => LABELS[key] ?? key,
    };
});

vi.mock('../../../contexts/language-context', () => ({
    getCurrentUiLanguage: () => 'en',
}));

vi.mock('../../../lib/tauri-http', () => ({
    getTauriHttpFetch: async () => undefined,
}));

vi.mock('../../../lib/sync-service', () => ({
    SyncService: {
        getCloudConfig: (...args: unknown[]) => getCloudConfig(...args),
    },
}));

const CLOUD_URL = 'https://sync.example.com';
const CLOUD_TOKEN = 'cloud-token-1234567890';

const configureCloudSync = (url: string | null = CLOUD_URL, token: string | null = CLOUD_TOKEN): void => {
    getCloudConfig.mockResolvedValue({
        url: url ?? '',
        token: token ?? '',
        allowInsecureHttp: false,
    });
};

describe('TdahActivationSection', () => {
    beforeEach(() => {
        cloudGetJson.mockReset().mockResolvedValue({ profile: null });
        cloudRequestJson.mockReset().mockResolvedValue({ profile: { mode: 'on', timeZone: 'UTC', ritualHour: '23:00' } });
        getCloudConfig.mockReset();
    });

    it('shows the needs-sync hint and never calls the server when Self-Hosted sync is not configured', async () => {
        configureCloudSync(null, null);
        render(<TdahActivationSection />);

        await screen.findByText('Set up Self-Hosted cloud sync to use ADHD mode.');
        expect(cloudGetJson).not.toHaveBeenCalled();
    });

    it('renders the activation form with the detected time zone and default ritual hour on first activation', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({ profile: null });
        render(<TdahActivationSection />);

        await screen.findByText('Activate ADHD mode');
        expect(cloudGetJson).toHaveBeenCalledWith(
            'https://sync.example.com/v1/tdah/profile',
            expect.objectContaining({ token: CLOUD_TOKEN }),
        );
        expect(screen.getByLabelText('Nightly ritual hour')).toHaveValue('23:00');
    });

    it('pre-fills the conserved time zone and ritual hour on reactivation (mode off)', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({ profile: { mode: 'off', timeZone: 'Europe/Madrid', ritualHour: '22:30' } });
        render(<TdahActivationSection />);

        await screen.findByText('Activate ADHD mode');
        expect(screen.getByLabelText('Time zone')).toHaveValue('Europe/Madrid');
        expect(screen.getByLabelText('Nightly ritual hour')).toHaveValue('22:30');
    });

    it('activates without a routine and shows the done state from the server response', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({ profile: null });
        cloudRequestJson.mockResolvedValue({
            profile: { mode: 'on', timeZone: 'Europe/Madrid', ritualHour: '22:30' },
            routineCreated: false,
            dayPlan: { date: '2026-08-26', activityCount: 0 },
        });
        render(<TdahActivationSection />);

        await screen.findByText('Activate ADHD mode');
        fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/Madrid' } });
        fireEvent.change(screen.getByLabelText('Nightly ritual hour'), { target: { value: '22:30' } });
        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

        await waitFor(() => {
            expect(cloudRequestJson).toHaveBeenCalledWith(
                'POST',
                'https://sync.example.com/v1/tdah/activate',
                { timeZone: 'Europe/Madrid', ritualHour: '22:30' },
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
        });

        await screen.findByText('Activated — tomorrow is already generated.');
        expect(screen.getByText('Europe/Madrid')).toBeInTheDocument();
        expect(screen.getByText('22:30')).toBeInTheDocument();
    });

    it('shows the already-activated state without the form when the profile is already on', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({ profile: { mode: 'on', timeZone: 'Europe/Madrid', ritualHour: '22:30' } });
        render(<TdahActivationSection />);

        await screen.findByText('Activated — tomorrow is already generated.');
        expect(screen.queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument();
    });

    it('shows the activation error and keeps the form usable when the POST fails', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({ profile: null });
        cloudRequestJson.mockRejectedValue(new Error('network down'));
        render(<TdahActivationSection />);

        await screen.findByText('Activate ADHD mode');
        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

        await screen.findByText('Could not activate ADHD mode. Try again.');
        expect(screen.getByRole('button', { name: 'Activate' })).not.toBeDisabled();
    });

    it('disables Activate and shows an inline error for an invalid time zone, without calling the server', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({ profile: null });
        render(<TdahActivationSection />);

        await screen.findByText('Activate ADHD mode');
        fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'not a real time zone!!' } });

        await screen.findByText("That doesn't look like a valid time zone.");
        expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
        expect(cloudRequestJson).not.toHaveBeenCalled();
    });

    it('disables Activate when the ritual hour is cleared, without calling the server', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({ profile: null });
        render(<TdahActivationSection />);

        await screen.findByText('Activate ADHD mode');
        // A native type="time" input sanitizes out-of-range strings down to
        // "" — clearing it is the reachable way to reproduce an invalid
        // (non-HH:mm) ritual hour through the real widget.
        fireEvent.change(screen.getByLabelText('Nightly ritual hour'), { target: { value: '' } });

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();
        });

        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
        expect(cloudRequestJson).not.toHaveBeenCalled();
    });

    it('shows a fix-your-input error for a 400-class response, distinct from the generic network error copy', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({ profile: null });
        cloudRequestJson.mockRejectedValue(new CloudHttpError('Cloud POST failed (400): Bad Request', 400));
        render(<TdahActivationSection />);

        await screen.findByText('Activate ADHD mode');
        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

        await screen.findByText("That doesn't look like a valid time zone.");
        expect(screen.queryByText('Could not activate ADHD mode. Try again.')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Activate' })).not.toBeDisabled();
    });

    it('treats a falsy/empty activation response as a failure instead of fabricating a profile', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({ profile: null });
        cloudRequestJson.mockResolvedValue(null);
        render(<TdahActivationSection />);

        await screen.findByText('Activate ADHD mode');
        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

        await screen.findByText('Could not activate ADHD mode. Try again.');
        expect(screen.queryByText('Activated — tomorrow is already generated.')).not.toBeInTheDocument();
    });

    it('renders the load error with a retry that recovers', async () => {
        configureCloudSync();
        cloudGetJson.mockRejectedValueOnce(new Error('network down'));
        render(<TdahActivationSection />);

        await screen.findByText('Could not load the ADHD mode state from your server.');

        cloudGetJson.mockResolvedValueOnce({ profile: { mode: 'on', timeZone: 'UTC', ritualHour: '23:00' } });
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

        await screen.findByText('Activated — tomorrow is already generated.');
    });
});

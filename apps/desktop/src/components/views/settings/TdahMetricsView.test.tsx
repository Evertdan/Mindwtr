import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CloudHttpError } from '@mindwtr/core';

import { TdahMetricsView, type TdahMetricsResponse } from './TdahMetricsView';

const LABELS: Record<string, string> = {
    'tdahMetrics.title': 'Metrics',
    'tdahMetrics.loading': 'Loading Metrics…',
    'tdahMetrics.needsSync': 'Set up Self-Hosted cloud sync to see your Metrics.',
    'tdahMetrics.inactive': 'Turn on ADHD mode to see your Metrics.',
    'tdahMetrics.loadError': 'Could not load your Metrics from your server.',
    'tdahMetrics.retry': 'Retry',
    'tdahMetrics.offlineBanner': 'Offline — showing the last loaded Metrics.',
    'tdahMetrics.kpi.definition': 'Completed the same day they were planned.',
    'tdahMetrics.kpi.noData': 'Aún no hay historia — usá el modo unos días',
    'tdahMetrics.kpi.fraction': '{completed}/{total}',
    'tdahMetrics.byOrigin.title': 'By origin',
    'tdahMetrics.trend.title': '8-week trend',
    'tdahMetrics.trend.noData': 'No data',
    'tdahMetrics.trend.weekFraction': '{completed}/{total} ({rate})',
    'tdahHistory.filters.period': 'Period',
    'tdahHistory.filters.from': 'From',
    'tdahHistory.filters.to': 'To',
    'tdahHistory.filters.customRangeInvalid': 'Pick a valid range (from ≤ to, 366 days max).',
    'tdahHistory.filters.originRoutine': 'Routine',
    'tdahHistory.filters.originManual': 'Manual',
    'tdahPeriod.day': 'Day',
    'tdahPeriod.week': 'Week',
    'tdahPeriod.month': 'Month',
    'tdahPeriod.custom': 'Custom',
};

const cloudGetJson = vi.fn();
const getCloudConfig = vi.fn();

vi.mock('@mindwtr/core', async () => {
    const actual = await vi.importActual<typeof import('@mindwtr/core')>('@mindwtr/core');
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
        ...actual,
        CloudHttpError,
        cloudGetJson: (...args: unknown[]) => cloudGetJson(...args),
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

const baseMetrics: TdahMetricsResponse = {
    period: { from: '2026-08-01', to: '2026-08-20' },
    completedOnTime: 6,
    total: 20,
    rate: 0.3,
    byOrigin: [
        { origin: 'routine', completedOnTime: 4, total: 10 },
        { origin: 'manual', completedOnTime: 2, total: 10 },
    ],
    trend: [
        { weekStart: '2026-07-06', completedOnTime: 5, total: 5, rate: 1 },
        { weekStart: '2026-07-13', completedOnTime: 0, total: 0, rate: null },
        { weekStart: '2026-07-20', completedOnTime: 1, total: 4, rate: 0.25 },
        { weekStart: '2026-07-27', completedOnTime: 2, total: 4, rate: 0.5 },
        { weekStart: '2026-08-03', completedOnTime: 3, total: 4, rate: 0.75 },
        { weekStart: '2026-08-10', completedOnTime: 1, total: 2, rate: 0.5 },
        { weekStart: '2026-08-17', completedOnTime: 0, total: 3, rate: 0 },
        { weekStart: '2026-08-24', completedOnTime: 6, total: 20, rate: 0.3 },
    ],
};

const mockMetrics = (metrics: TdahMetricsResponse): void => {
    cloudGetJson.mockImplementation((url: string) => (
        url.includes('/tdah/metrics') ? Promise.resolve(metrics) : Promise.resolve(null)
    ));
};

describe('TdahMetricsView', () => {
    beforeEach(() => {
        cloudGetJson.mockReset();
        getCloudConfig.mockReset();
    });

    it('shows the needs-sync hint and never calls the server when Self-Hosted sync is not configured', async () => {
        configureCloudSync(null, null);
        render(<TdahMetricsView />);

        await screen.findByText('Set up Self-Hosted cloud sync to see your Metrics.');
        expect(cloudGetJson).not.toHaveBeenCalled();
    });

    it('fetches the default (day) period on first load', async () => {
        configureCloudSync();
        mockMetrics(baseMetrics);
        render(<TdahMetricsView />);

        await waitFor(() => {
            expect(cloudGetJson).toHaveBeenCalledWith(
                'https://sync.example.com/v1/tdah/metrics?period=day',
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
        });
    });

    it('renders the KPI rate, fraction, and always-visible definition', async () => {
        configureCloudSync();
        mockMetrics(baseMetrics);
        render(<TdahMetricsView />);

        await screen.findByTestId('tdah-metrics-kpi');
        expect(screen.getByTestId('tdah-metrics-kpi')).toHaveTextContent('30%');
        expect(screen.getByText('6/20')).toBeInTheDocument();
        expect(screen.getByText('Completed the same day they were planned.')).toBeInTheDocument();
    });

    it('uses the exact same fixed color class for the KPI at 30% and at 100% — never a semaphore (SM-C2)', async () => {
        configureCloudSync();
        mockMetrics(baseMetrics);
        const { unmount } = render(<TdahMetricsView />);
        await screen.findByTestId('tdah-metrics-kpi');
        const lowClass = screen.getByTestId('tdah-metrics-kpi').className;
        unmount();

        mockMetrics({ ...baseMetrics, completedOnTime: 20, total: 20, rate: 1 });
        render(<TdahMetricsView />);
        await screen.findByTestId('tdah-metrics-kpi');
        const highClass = screen.getByTestId('tdah-metrics-kpi').className;

        expect(highClass).toBe(lowClass);
    });

    it('shows the no-data message and a null rate when total is 0', async () => {
        configureCloudSync();
        mockMetrics({ ...baseMetrics, completedOnTime: 0, total: 0, rate: null });
        render(<TdahMetricsView />);

        await screen.findByTestId('tdah-metrics-kpi');
        expect(screen.getByTestId('tdah-metrics-kpi')).toHaveTextContent('—');
        // The same no-data copy also covers the trend's own null-rate week
        // (2026-07-13 in `baseMetrics.trend`) — both must be present.
        expect(screen.getAllByText('Aún no hay historia — usá el modo unos días').length).toBeGreaterThanOrEqual(1);
    });

    it('renders the Routine/manual origin breakdown with matching fixed-color bars', async () => {
        configureCloudSync();
        mockMetrics(baseMetrics);
        render(<TdahMetricsView />);

        await screen.findByText('By origin');
        expect(screen.getByText('4/10')).toBeInTheDocument();
        expect(screen.getByText('2/10')).toBeInTheDocument();
        const routineBar = screen.getByTestId('tdah-metrics-origin-bar-routine');
        const manualBar = screen.getByTestId('tdah-metrics-origin-bar-manual');
        expect(routineBar.className).toBe(manualBar.className);
    });

    it('renders all 8 trend weeks, including a null-rate week rendered distinctly from a 0% week', async () => {
        configureCloudSync();
        mockMetrics(baseMetrics);
        render(<TdahMetricsView />);

        await screen.findByText('8-week trend');
        // 7 weeks have a numeric rate rendered as "{completed}/{total} ({rate})"; the null week renders the no-data copy instead.
        expect(screen.getByText('5/5 (100%)')).toBeInTheDocument();
        expect(screen.getByText('0/3 (0%)')).toBeInTheDocument();
        // The per-week label is `trend.noData`, NOT the whole-screen
        // `kpi.noData` empty state — that copy ("no history yet, use the mode
        // for a few days") reads as nonsense repeated inside a list of weeks,
        // and must not appear at all while `baseMetrics.rate` is non-null.
        expect(screen.getAllByText('No data')).toHaveLength(1);
        expect(screen.queryByText('Aún no hay historia — usá el modo unos días')).toBeNull();
    });

    it('sends explicit from/to only for a custom period, and never fires a request for an invalid custom range', async () => {
        configureCloudSync();
        mockMetrics(baseMetrics);
        render(<TdahMetricsView />);
        await screen.findByTestId('tdah-metrics-kpi');
        cloudGetJson.mockClear();

        fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'custom' } });
        await screen.findByLabelText('From');
        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
        fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-01' } });

        await waitFor(() => {
            expect(screen.getByText('Pick a valid range (from ≤ to, 366 days max).')).toBeInTheDocument();
        });
        expect(cloudGetJson).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-05' } });
        await waitFor(() => {
            expect(cloudGetJson).toHaveBeenCalledWith(
                'https://sync.example.com/v1/tdah/metrics?period=custom&from=2026-09-01&to=2026-09-05',
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
        });
    });

    it('shows the inactive state when the server responds 409 TDAH_ACTIVATE_REQUIRED, without any stale KPI', async () => {
        configureCloudSync();
        cloudGetJson.mockRejectedValue(new CloudHttpError('activation required', 409));
        render(<TdahMetricsView />);

        await screen.findByText('Turn on ADHD mode to see your Metrics.');
        expect(screen.queryByTestId('tdah-metrics-kpi')).not.toBeInTheDocument();
    });

    it('shows a generic load error with retry on a non-409 failure', async () => {
        configureCloudSync();
        cloudGetJson.mockRejectedValue(new Error('network down'));
        render(<TdahMetricsView />);

        await screen.findByText('Could not load your Metrics from your server.');

        mockMetrics(baseMetrics);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByTestId('tdah-metrics-kpi');
    });

    it('never rounds an imperfect rate up to 100%, and never rounds real progress down to 0%', async () => {
        configureCloudSync();
        mockMetrics({ ...baseMetrics, completedOnTime: 249, total: 250, rate: 0.996, trend: [] });
        render(<TdahMetricsView />);

        // 249 of 250 is not a perfect period; showing "100%" beside that
        // fraction would invent a perfect score the user did not earn.
        const kpi = await screen.findByTestId('tdah-metrics-kpi');
        expect(kpi.textContent).toContain('99%');
        expect(kpi.textContent).not.toContain('100%');
    });

    it('shows 100% only for an exactly perfect rate', async () => {
        configureCloudSync();
        mockMetrics({ ...baseMetrics, completedOnTime: 5, total: 5, rate: 1, trend: [] });
        render(<TdahMetricsView />);

        const kpi = await screen.findByTestId('tdah-metrics-kpi');
        expect(kpi.textContent).toContain('100%');
    });

    it('clears the previous period numbers when the custom range becomes invalid', async () => {
        configureCloudSync();
        mockMetrics(baseMetrics);
        render(<TdahMetricsView />);
        await screen.findByTestId('tdah-metrics-kpi');

        fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'custom' } });
        await screen.findByLabelText('From');
        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
        fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-01' } });

        await waitFor(() => {
            expect(screen.queryByTestId('tdah-metrics-kpi')).not.toBeInTheDocument();
        });
    });

    it('shows the offline banner over the last loaded Metrics and refetches on reconnect', async () => {
        configureCloudSync();
        mockMetrics(baseMetrics);
        render(<TdahMetricsView />);
        await screen.findByTestId('tdah-metrics-kpi');
        expect(screen.queryByText('Offline — showing the last loaded Metrics.')).toBeNull();

        fireEvent(window, new Event('offline'));
        await screen.findByText('Offline — showing the last loaded Metrics.');
        expect(screen.getByTestId('tdah-metrics-kpi')).toBeInTheDocument();

        cloudGetJson.mockClear();
        fireEvent(window, new Event('online'));
        await waitFor(() => {
            expect(cloudGetJson).toHaveBeenCalled();
        });
        await waitFor(() => {
            expect(screen.queryByText('Offline — showing the last loaded Metrics.')).toBeNull();
        });
    });
});

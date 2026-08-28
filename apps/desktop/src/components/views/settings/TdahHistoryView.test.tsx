import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CloudHttpError } from '@mindwtr/core';

import { TdahHistoryView, type TdahHistoryEntry } from './TdahHistoryView';
import type { TdahRoutine } from './TdahRoutinesListView';

const LABELS: Record<string, string> = {
    'tdahHistory.title': 'History',
    'tdahHistory.loading': 'Loading History…',
    'tdahHistory.needsSync': 'Set up Self-Hosted cloud sync to see your History.',
    'tdahHistory.inactive': 'Turn on ADHD mode to see your History.',
    'tdahHistory.loadError': 'Could not load your History from your server.',
    'tdahHistory.retry': 'Retry',
    'tdahHistory.offlineBanner': 'Offline — showing the last loaded History.',
    'tdahHistory.filters.period': 'Period',
    'tdahHistory.filters.from': 'From',
    'tdahHistory.filters.to': 'To',
    'tdahHistory.filters.origin': 'Origin',
    'tdahHistory.filters.originAll': 'All',
    'tdahHistory.filters.originRoutine': 'Routine',
    'tdahHistory.filters.originManual': 'Manual',
    'tdahHistory.filters.routine': 'Routine',
    'tdahHistory.filters.routineAll': 'All Routines',
    'tdahHistory.filters.customRangeInvalid': 'Pick a valid range (from ≤ to, 366 days max).',
    'tdahHistory.empty': 'Sin incompletas en este rango',
    'tdahHistory.entry.fromRoutine': 'From Routine "{title}"',
    'tdahHistory.entry.moved': 'Moved',
    'tdahHistory.result.completedLate': 'Completed late',
    'tdahHistory.result.limbo': 'Limbo',
    'tdahHistory.result.missed': 'Missed',
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

const routine: TdahRoutine = {
    id: 5,
    title: 'Workday',
    pattern: { kind: 'weekday', weekdays: [1, 2, 3, 4, 5] },
    blocks: [],
    createdAt: '2026-01-01T00:00:00Z',
    overlapWarnings: [],
    crossesMidnightWarnings: [],
};

const missedEntry: TdahHistoryEntry = {
    activity: {
        id: 1,
        dayPlanDate: '2026-08-20',
        title: 'Take out trash',
        startTime: '08:00',
        durationMinutes: 10,
        origin: 'manual',
        state: 'missed',
        startedAt: null,
        completedAt: null,
        movedAt: null,
    },
    routineTitle: null,
    completedLate: false,
};

const lateCompletedFromRoutineEntry: TdahHistoryEntry = {
    activity: {
        id: 2,
        dayPlanDate: '2026-08-19',
        title: 'Stretch',
        startTime: '06:00',
        durationMinutes: 15,
        origin: 'routine',
        state: 'completed',
        startedAt: '2026-08-19T06:05:00Z',
        completedAt: '2026-08-20T01:00:00Z',
        movedAt: '2026-08-19T22:00:00Z',
    },
    routineTitle: 'Workday',
    completedLate: true,
};

const mockHistoryAndRoutines = (entries: TdahHistoryEntry[], range = { from: '2026-08-20', to: '2026-08-20' }): void => {
    cloudGetJson.mockImplementation((url: string) => {
        if (url.includes('/tdah/routines')) return Promise.resolve({ routines: [routine] });
        if (url.includes('/tdah/history')) return Promise.resolve({ range, entries });
        return Promise.resolve(null);
    });
};

describe('TdahHistoryView', () => {
    beforeEach(() => {
        cloudGetJson.mockReset();
        getCloudConfig.mockReset();
    });

    it('shows the needs-sync hint and never calls the server when Self-Hosted sync is not configured', async () => {
        configureCloudSync(null, null);
        render(<TdahHistoryView />);

        await screen.findByText('Set up Self-Hosted cloud sync to see your History.');
        expect(cloudGetJson).not.toHaveBeenCalled();
    });

    it('fetches the default (day) period with no filters on first load', async () => {
        configureCloudSync();
        mockHistoryAndRoutines([]);
        render(<TdahHistoryView />);

        await waitFor(() => {
            expect(cloudGetJson).toHaveBeenCalledWith(
                'https://sync.example.com/v1/tdah/history?period=day',
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
        });
    });

    it('shows the empty-range message when there are no incomplete Actividades', async () => {
        configureCloudSync();
        mockHistoryAndRoutines([]);
        render(<TdahHistoryView />);

        await screen.findByText('Sin incompletas en este rango');
    });

    it('renders a missed entry and a late-completed, Routine-linked, moved entry with the right badges', async () => {
        configureCloudSync();
        mockHistoryAndRoutines([missedEntry, lateCompletedFromRoutineEntry]);
        render(<TdahHistoryView />);

        await screen.findByText('Take out trash');
        expect(screen.getByText('Missed')).toBeInTheDocument();

        expect(screen.getByText('Stretch')).toBeInTheDocument();
        expect(screen.getByText('Completed late')).toBeInTheDocument();
        expect(screen.getByText('From Routine "Workday"')).toBeInTheDocument();
        expect(screen.getByText('Moved')).toBeInTheDocument();
        // The missed entry was never moved — its badge must not render.
        expect(screen.getAllByText('Moved')).toHaveLength(1);
    });

    it('renders the server-resolved range as a formatted label, never recomputing it client-side', async () => {
        configureCloudSync();
        mockHistoryAndRoutines([], { from: '2026-08-01', to: '2026-08-20' });
        render(<TdahHistoryView />);

        await screen.findByText('Aug 1, 2026 – Aug 20, 2026');
    });

    it('refetches with the chosen period, origin, and Routine filters', async () => {
        configureCloudSync();
        mockHistoryAndRoutines([]);
        render(<TdahHistoryView />);

        await waitFor(() => expect(cloudGetJson).toHaveBeenCalled());
        await screen.findByText('Sin incompletas en este rango');

        // Each change re-triggers a fetch, which briefly flips the phase back
        // to `loading` and unmounts the filter row — wait for it to come
        // back before firing the next change, same as a real user would.
        fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'month' } });
        await screen.findByLabelText('Origin');
        fireEvent.change(screen.getByLabelText('Origin'), { target: { value: 'routine' } });
        await screen.findByLabelText('Routine');
        fireEvent.change(screen.getByLabelText('Routine'), { target: { value: '5' } });

        await waitFor(() => {
            expect(cloudGetJson).toHaveBeenCalledWith(
                'https://sync.example.com/v1/tdah/history?period=month&origin=routine&routineId=5',
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
        });
    });

    it('sends explicit from/to only for a custom period, and never fires a request for an invalid custom range', async () => {
        configureCloudSync();
        mockHistoryAndRoutines([]);
        render(<TdahHistoryView />);
        await screen.findByText('Sin incompletas en este rango');
        cloudGetJson.mockClear();

        fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'custom' } });
        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
        fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-01' } });

        await waitFor(() => {
            expect(screen.getByText('Pick a valid range (from ≤ to, 366 days max).')).toBeInTheDocument();
        });
        expect(cloudGetJson).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-05' } });
        await waitFor(() => {
            expect(cloudGetJson).toHaveBeenCalledWith(
                'https://sync.example.com/v1/tdah/history?period=custom&from=2026-09-01&to=2026-09-05',
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
        });
    });

    it('shows the inactive state when the server responds 409 TDAH_ACTIVATE_REQUIRED, without any stale data', async () => {
        configureCloudSync();
        cloudGetJson.mockImplementation((url: string) => {
            if (url.includes('/tdah/routines')) return Promise.resolve({ routines: [] });
            return Promise.reject(new CloudHttpError('activation required', 409));
        });
        render(<TdahHistoryView />);

        await screen.findByText('Turn on ADHD mode to see your History.');
        expect(screen.queryByText('Sin incompletas en este rango')).not.toBeInTheDocument();
    });

    it('shows a generic load error with retry on a non-409 failure', async () => {
        configureCloudSync();
        cloudGetJson.mockImplementation((url: string) => {
            if (url.includes('/tdah/routines')) return Promise.resolve({ routines: [] });
            return Promise.reject(new Error('network down'));
        });
        render(<TdahHistoryView />);

        await screen.findByText('Could not load your History from your server.');

        mockHistoryAndRoutines([]);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByText('Sin incompletas en este rango');
    });

    it('degrades the Routine filter to empty rather than failing the whole view when the Routines fetch fails', async () => {
        configureCloudSync();
        cloudGetJson.mockImplementation((url: string) => {
            if (url.includes('/tdah/routines')) return Promise.reject(new Error('routines down'));
            if (url.includes('/tdah/history')) return Promise.resolve({ range: { from: '2026-08-20', to: '2026-08-20' }, entries: [] });
            return Promise.resolve(null);
        });
        render(<TdahHistoryView />);

        await screen.findByText('Sin incompletas en este rango');
        expect(screen.getByLabelText('Routine')).toBeInTheDocument();
    });

    it('takes "completed late" from the server flag, never re-deriving it from the Activity state (AD-5)', async () => {
        configureCloudSync();
        // A `completed` Activity the server did NOT flag as late. The client
        // must trust the flag: re-deriving lateness from `state` alone (the
        // original defect) would mislabel this one.
        mockHistoryAndRoutines([{
            ...lateCompletedFromRoutineEntry,
            activity: { ...lateCompletedFromRoutineEntry.activity, id: 42, state: 'limbo' },
            completedLate: false,
        }]);
        render(<TdahHistoryView />);

        await screen.findByText('Limbo');
        expect(screen.queryByText('Completed late')).toBeNull();
    });

    it('labels a Routine-origin entry whose Rutina was deleted as Routine, not Manual', async () => {
        configureCloudSync();
        // `routineTitle: null` with `origin: 'routine'` is the documented
        // deleted-Rutina case (the server's LEFT JOIN stops matching). Keying
        // the label off the title instead of the origin mislabels it "Manual".
        mockHistoryAndRoutines([{
            ...lateCompletedFromRoutineEntry,
            routineTitle: null,
        }]);
        render(<TdahHistoryView />);

        await screen.findByText('Completed late');
        // "Manual" must appear exactly once — as the origin-filter <option>,
        // never as this entry's origin line (which is what the bug produced).
        expect(screen.getAllByText('Manual')).toHaveLength(1);
        expect(screen.getAllByText('Manual')[0]?.tagName).toBe('OPTION');
    });

    it('clears the previous range results when the custom range becomes invalid', async () => {
        configureCloudSync();
        mockHistoryAndRoutines([missedEntry]);
        render(<TdahHistoryView />);
        await screen.findByText('Take out trash');

        fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'custom' } });
        await screen.findByLabelText('From');
        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
        fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-01' } });

        // Stale entries must not stay on screen under controls that no longer
        // describe them.
        await waitFor(() => {
            expect(screen.queryByText('Take out trash')).toBeNull();
        });
        expect(screen.getByText('Pick a valid range (from ≤ to, 366 days max).')).toBeInTheDocument();
    });

    it('shows the offline banner over the last loaded History and refetches on reconnect', async () => {
        configureCloudSync();
        mockHistoryAndRoutines([missedEntry]);
        render(<TdahHistoryView />);
        await screen.findByText('Take out trash');
        expect(screen.queryByText('Offline — showing the last loaded History.')).toBeNull();

        fireEvent(window, new Event('offline'));
        await screen.findByText('Offline — showing the last loaded History.');
        expect(screen.getByText('Take out trash')).toBeInTheDocument();

        cloudGetJson.mockClear();
        fireEvent(window, new Event('online'));
        await waitFor(() => {
            expect(cloudGetJson).toHaveBeenCalled();
        });
        await waitFor(() => {
            expect(screen.queryByText('Offline — showing the last loaded History.')).toBeNull();
        });
    });
});

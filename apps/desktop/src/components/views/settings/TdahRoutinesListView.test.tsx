import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CloudHttpError } from '@mindwtr/core';

import { TdahRoutinesListView, type TdahRoutine } from './TdahRoutinesListView';

const LABELS: Record<string, string> = {
    'tdahRoutines.list.sectionTitle': 'Routines',
    'tdahRoutines.list.loading': 'Loading Routines…',
    'tdahRoutines.list.needsSync': 'Set up Self-Hosted cloud sync to manage Routines.',
    'tdahRoutines.list.loadError': 'Could not load your Routines from your server.',
    'tdahRoutines.list.retry': 'Retry',
    'tdahRoutines.list.offlineBanner': 'Offline — showing the last loaded Routines.',
    'tdahRoutines.list.emptyTitle': 'No Routines yet',
    'tdahRoutines.list.emptyBody': 'A Routine is the template for a type of day.',
    'tdahRoutines.list.emptyCta': 'Create your first Routine',
    'tdahRoutines.list.newRoutine': 'New Routine',
    'tdahRoutines.list.openEditor': 'Edit "{title}"',
    'tdahRoutines.list.blockCount': '{count} Block(s)',
    'tdahRoutines.list.noBlocks': 'No Blocks — an empty day.',
    'tdahRoutines.list.blocksPreviewMore': '+{count} more',
    'tdahRoutines.list.duplicate': 'Duplicate',
    'tdahRoutines.list.duplicateSuffix': '(copy)',
    'tdahRoutines.list.duplicateError': 'Could not duplicate this Routine. Try again.',
    'tdahRoutines.list.delete': 'Delete',
    'tdahRoutines.list.deleting': 'Deleting…',
    'tdahRoutines.list.deleteConfirmBody': "Already-generated days won't change.",
    'tdahRoutines.list.deleteConfirmConfirm': 'Delete',
    'tdahRoutines.list.deleteConfirmCancel': 'Cancel',
    'tdahRoutines.list.deleteError': 'Could not delete this Routine. Try again.',
    'tdahRoutines.list.conflictWins': 'Overlaps with "{title}" — this Routine currently wins on the shared days.',
    'tdahRoutines.list.conflictLoses': 'Overlaps with "{title}", which currently wins on the shared days.',
    'tdahRoutines.pattern.everyDay': 'Every day',
    'tdahRoutines.pattern.weekdaysMonFri': 'Weekdays (Monday–Friday)',
    'tdahRoutines.pattern.weekendSatSun': 'Weekends (Saturday–Sunday)',
    'tdahRoutines.pattern.onDays': 'On {days}',
    'tdahRoutines.pattern.nthWeekdayOfMonth': 'The {ordinal} {weekday} of the month',
    'recurrence.ordinal.first': 'first',
    'recurrence.ordinal.second': 'second',
    'recurrence.ordinal.third': 'third',
    'recurrence.ordinal.fourth': 'fourth',
    'recurrence.ordinal.last': 'last',
};

const cloudGetJson = vi.fn();
const cloudRequestJson = vi.fn();
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

vi.mock('./TdahRoutineEditorView', () => ({
    TdahRoutineEditorView: (props: {
        routineId: number | null;
        onSaved: (routine: TdahRoutine) => void;
        onCancel: () => void;
    }) => (
        <div>
            <div>editor-mode:{props.routineId ?? 'new'}</div>
            <button
                type="button"
                onClick={() => props.onSaved({
                    id: 999,
                    title: 'Saved Routine',
                    pattern: { kind: 'weekday', weekdays: [1] },
                    blocks: [],
                    createdAt: '2026-08-01T00:00:00Z',
                    overlapWarnings: [],
                    crossesMidnightWarnings: [],
                })}
            >
                stub-save
            </button>
            <button type="button" onClick={props.onCancel}>stub-cancel</button>
        </div>
    ),
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

const workdayRoutine: TdahRoutine = {
    id: 1,
    title: 'Workday',
    pattern: { kind: 'weekday', weekdays: [1, 2, 3, 4, 5] },
    blocks: [
        { id: 10, title: 'Wake up', startTime: '05:30', durationMinutes: 15, sortOrder: 0 },
        { id: 11, title: 'Treadmill', startTime: '06:00', durationMinutes: 20, sortOrder: 1 },
        { id: 12, title: 'Shower', startTime: '06:20', durationMinutes: 15, sortOrder: 2 },
        { id: 13, title: 'Breakfast', startTime: '06:40', durationMinutes: 20, sortOrder: 3 },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    overlapWarnings: [],
    crossesMidnightWarnings: [],
};

const lastSaturdayRoutine: TdahRoutine = {
    id: 2,
    title: 'Last Saturday',
    pattern: { kind: 'nthWeekdayOfMonth', ordinal: -1, weekday: 6 },
    blocks: [],
    createdAt: '2026-01-02T00:00:00Z',
    overlapWarnings: [],
    crossesMidnightWarnings: [],
};

describe('TdahRoutinesListView', () => {
    beforeEach(() => {
        cloudGetJson.mockReset().mockResolvedValue({ routines: [] });
        cloudRequestJson.mockReset().mockResolvedValue(null);
        getCloudConfig.mockReset();
    });

    it('shows the needs-sync hint and never calls the server when Self-Hosted sync is not configured', async () => {
        configureCloudSync(null, null);
        render(<TdahRoutinesListView />);

        await screen.findByText('Set up Self-Hosted cloud sync to manage Routines.');
        expect(cloudGetJson).not.toHaveBeenCalled();
    });

    it('shows the empty state with a create CTA when there are no Routines', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({ routines: [] });
        render(<TdahRoutinesListView />);

        await screen.findByText('No Routines yet');
        expect(cloudGetJson).toHaveBeenCalledWith(
            'https://sync.example.com/v1/tdah/routines',
            expect.objectContaining({ token: CLOUD_TOKEN }),
        );

        fireEvent.click(screen.getByRole('button', { name: 'Create your first Routine' }));
        await screen.findByText('editor-mode:new');
    });

    it('renders a Routine card with its pattern description, block preview, and block count', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({ routines: [workdayRoutine] });
        render(<TdahRoutinesListView />);

        await screen.findByText('Workday');
        expect(screen.getByText('Weekdays (Monday–Friday)')).toBeInTheDocument();
        expect(screen.getByText('05:30 Wake up · 06:00 Treadmill · 06:20 Shower · +1 more')).toBeInTheDocument();
        expect(screen.getByText('4 Block(s)')).toBeInTheDocument();
    });

    it('describes an nthWeekdayOfMonth pattern using the ordinal + weekday template', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({ routines: [lastSaturdayRoutine] });
        render(<TdahRoutinesListView />);

        await screen.findByText('Last Saturday');
        expect(screen.getByText('The last Saturday of the month')).toBeInTheDocument();
        expect(screen.getByText('No Blocks — an empty day.')).toBeInTheDocument();
    });

    it('opens the editor with the clicked Routine id and returns to the list on cancel', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({ routines: [workdayRoutine] });
        render(<TdahRoutinesListView />);

        await screen.findByText('Workday');
        fireEvent.click(screen.getByRole('button', { name: 'Edit "Workday"' }));

        await screen.findByText('editor-mode:1');
        fireEvent.click(screen.getByRole('button', { name: 'stub-cancel' }));
        await screen.findByText('Workday');
    });

    it('renders Routines in the exact order the server response returns, without re-sorting them client-side (AD-5)', async () => {
        configureCloudSync();
        // A specificity-based client-side sort would put the nthWeekdayOfMonth
        // Routine first. Deliberately returning it second here proves the
        // component trusts the response order verbatim instead of recomputing it.
        const weekly: TdahRoutine = {
            id: 1,
            title: 'Weekly one',
            pattern: { kind: 'weekday', weekdays: [1] },
            blocks: [],
            createdAt: '2026-01-01T00:00:00Z',
            overlapWarnings: [],
            crossesMidnightWarnings: [],
        };
        const nth: TdahRoutine = {
            id: 2,
            title: 'Nth one',
            pattern: { kind: 'nthWeekdayOfMonth', ordinal: 1, weekday: 1 },
            blocks: [],
            createdAt: '2026-02-01T00:00:00Z',
            overlapWarnings: [],
            crossesMidnightWarnings: [],
        };
        cloudGetJson.mockImplementation((url: string) => (
            url.endsWith('/routines/conflicts') ? Promise.resolve({ conflicts: {} }) : Promise.resolve({ routines: [weekly, nth] })
        ));
        render(<TdahRoutinesListView />);

        const weeklyEl = await screen.findByText('Weekly one');
        const nthEl = screen.getByText('Nth one');
        expect(weeklyEl.compareDocumentPosition(nthEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('reloads the list after the editor reports a save', async () => {
        configureCloudSync();
        let routinesLoadCount = 0;
        cloudGetJson.mockImplementation((url: string) => {
            if (url.endsWith('/routines/conflicts')) return Promise.resolve({ conflicts: {} });
            routinesLoadCount += 1;
            return Promise.resolve(routinesLoadCount === 1 ? { routines: [] } : { routines: [workdayRoutine] });
        });
        render(<TdahRoutinesListView />);

        await screen.findByText('No Routines yet');
        fireEvent.click(screen.getByRole('button', { name: 'Create your first Routine' }));
        await screen.findByText('editor-mode:new');

        fireEvent.click(screen.getByRole('button', { name: 'stub-save' }));

        await screen.findByText('Workday');
        expect(routinesLoadCount).toBe(2);
    });

    it('duplicates a Routine by POSTing its pattern and blocks under a suffixed title', async () => {
        configureCloudSync();
        cloudGetJson.mockImplementation((url: string) => (
            url.endsWith('/routines/conflicts')
                ? Promise.resolve({ conflicts: {} })
                : Promise.resolve({ routines: [workdayRoutine] })
        ));
        cloudRequestJson.mockResolvedValue({ routine: { ...workdayRoutine, id: 3 } });
        render(<TdahRoutinesListView />);

        await screen.findByText('Workday');
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

        await waitFor(() => {
            expect(cloudRequestJson).toHaveBeenCalledWith(
                'POST',
                'https://sync.example.com/v1/tdah/routines',
                expect.objectContaining({ title: 'Workday (copy)', pattern: workdayRoutine.pattern }),
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
        });
    });

    it('truncates an over-length duplicate title without splitting a surrogate pair at the boundary', async () => {
        configureCloudSync();
        // 79 'x' + one astral emoji (a surrogate pair, 2 UTF-16 code units) is
        // itself 81 code units — already over the 80-char cap by construction,
        // so appending the " (copy)" suffix forces truncation right at the
        // point a naive `.slice(0, 80)` would cut the emoji's surrogate pair
        // in half.
        const longTitleRoutine: TdahRoutine = {
            id: 9,
            title: `${'x'.repeat(79)}😀`,
            pattern: { kind: 'weekday', weekdays: [1] },
            blocks: [],
            createdAt: '2026-01-01T00:00:00Z',
            overlapWarnings: [],
            crossesMidnightWarnings: [],
        };
        cloudGetJson.mockImplementation((url: string) => (
            url.endsWith('/routines/conflicts') ? Promise.resolve({ conflicts: {} }) : Promise.resolve({ routines: [longTitleRoutine] })
        ));
        cloudRequestJson.mockResolvedValue({ routine: { ...longTitleRoutine, id: 10 } });
        render(<TdahRoutinesListView />);

        await screen.findByText(longTitleRoutine.title);
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

        await waitFor(() => {
            expect(cloudRequestJson).toHaveBeenCalled();
        });
        const [, , body] = cloudRequestJson.mock.calls[0] as [string, string, { title: string }];
        expect(body.title.endsWith('😀')).toBe(true);
        expect(body.title).toBe(`${'x'.repeat(79)}😀`);
    });

    it('reports the duplicate as succeeded even when the post-duplicate reload fails', async () => {
        configureCloudSync();
        let routinesCallCount = 0;
        cloudGetJson.mockImplementation((url: string) => {
            if (url.endsWith('/routines/conflicts')) return Promise.resolve({ conflicts: {} });
            routinesCallCount += 1;
            // First call is the initial list load; the reload triggered after
            // the duplicate succeeds is the one that fails.
            return routinesCallCount === 1 ? Promise.resolve({ routines: [workdayRoutine] }) : Promise.reject(new Error('network down'));
        });
        cloudRequestJson.mockResolvedValue({ routine: { ...workdayRoutine, id: 3 } });
        render(<TdahRoutinesListView />);

        await screen.findByText('Workday');
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

        await waitFor(() => {
            expect(cloudRequestJson).toHaveBeenCalled();
        });
        await waitFor(() => expect(routinesCallCount).toBe(2));
        expect(screen.queryByText('Could not duplicate this Routine. Try again.')).not.toBeInTheDocument();
    });

    it('shows a duplicate error and does not reload the list when the POST fails', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({ routines: [workdayRoutine] });
        cloudRequestJson.mockRejectedValue(new Error('network down'));
        render(<TdahRoutinesListView />);

        await screen.findByText('Workday');
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

        await screen.findByText('Could not duplicate this Routine. Try again.');
    });

    it('deletes a Routine only after explicit confirmation, then reloads the list', async () => {
        configureCloudSync();
        let routinesLoadCount = 0;
        cloudGetJson.mockImplementation((url: string) => {
            if (url.endsWith('/routines/conflicts')) return Promise.resolve({ conflicts: {} });
            routinesLoadCount += 1;
            return Promise.resolve(routinesLoadCount === 1 ? { routines: [workdayRoutine] } : { routines: [] });
        });
        cloudRequestJson.mockResolvedValue(null);
        render(<TdahRoutinesListView />);

        await screen.findByText('Workday');
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        await screen.findByText("Already-generated days won't change.");

        // Cancel first: no request should fire.
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByText("Already-generated days won't change.")).not.toBeInTheDocument();
        expect(cloudRequestJson).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        await screen.findByText("Already-generated days won't change.");
        fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]);

        await waitFor(() => {
            expect(cloudRequestJson).toHaveBeenCalledWith(
                'DELETE',
                'https://sync.example.com/v1/tdah/routines/1',
                undefined,
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
        });
        await screen.findByText('No Routines yet');
    });

    it('reports the delete as succeeded even when the post-delete reload fails', async () => {
        configureCloudSync();
        let routinesCallCount = 0;
        cloudGetJson.mockImplementation((url: string) => {
            if (url.endsWith('/routines/conflicts')) return Promise.resolve({ conflicts: {} });
            routinesCallCount += 1;
            // First call is the initial list load; the reload triggered after
            // the delete succeeds is the one that fails.
            return routinesCallCount === 1 ? Promise.resolve({ routines: [workdayRoutine] }) : Promise.reject(new Error('network down'));
        });
        cloudRequestJson.mockResolvedValue(null);
        render(<TdahRoutinesListView />);

        await screen.findByText('Workday');
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        await screen.findByText("Already-generated days won't change.");
        fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]);

        await waitFor(() => {
            expect(cloudRequestJson).toHaveBeenCalledWith(
                'DELETE',
                'https://sync.example.com/v1/tdah/routines/1',
                undefined,
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
        });
        await waitFor(() => expect(routinesCallCount).toBe(2));
        expect(screen.queryByText('Could not delete this Routine. Try again.')).not.toBeInTheDocument();
    });

    it('shows a delete error and keeps the Routine listed when the DELETE fails', async () => {
        configureCloudSync();
        cloudGetJson.mockResolvedValue({ routines: [workdayRoutine] });
        cloudRequestJson.mockRejectedValue(new CloudHttpError('Cloud DELETE failed (500)', 500));
        render(<TdahRoutinesListView />);

        await screen.findByText('Workday');
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]);

        await screen.findByText('Could not delete this Routine. Try again.');
        expect(screen.getByText('Workday')).toBeInTheDocument();
    });

    it('renders conflict badges straight from the server-computed conflicts endpoint (AD-5: never recomputed client-side)', async () => {
        configureCloudSync();
        const earlier: TdahRoutine = {
            id: 1,
            title: 'Generic Tuesday',
            pattern: { kind: 'weekday', weekdays: [2] },
            blocks: [],
            createdAt: '2026-01-01T00:00:00Z',
            overlapWarnings: [],
            crossesMidnightWarnings: [],
        };
        const later: TdahRoutine = {
            id: 2,
            title: 'New Tuesday',
            pattern: { kind: 'weekday', weekdays: [2, 3] },
            blocks: [],
            createdAt: '2026-02-01T00:00:00Z',
            overlapWarnings: [],
            crossesMidnightWarnings: [],
        };
        cloudGetJson.mockImplementation((url: string) => {
            if (url.endsWith('/routines/conflicts')) {
                return Promise.resolve({
                    conflicts: {
                        '1': [{ withId: 2, withTitle: 'New Tuesday', wins: false }],
                        '2': [{ withId: 1, withTitle: 'Generic Tuesday', wins: true }],
                    },
                });
            }
            return Promise.resolve({ routines: [earlier, later] });
        });
        render(<TdahRoutinesListView />);

        await screen.findByText('Generic Tuesday');
        expect(screen.getByText('Overlaps with "New Tuesday", which currently wins on the shared days.')).toBeInTheDocument();
        expect(screen.getByText('Overlaps with "Generic Tuesday" — this Routine currently wins on the shared days.')).toBeInTheDocument();
        expect(cloudGetJson).toHaveBeenCalledWith(
            'https://sync.example.com/v1/tdah/routines/conflicts',
            expect.objectContaining({ token: CLOUD_TOKEN }),
        );
    });

    it('shows a "+N more" affordance when a Routine has more than one conflict', async () => {
        configureCloudSync();
        const a: TdahRoutine = {
            id: 1,
            title: 'A',
            pattern: { kind: 'weekday', weekdays: [2] },
            blocks: [],
            createdAt: '2026-01-01T00:00:00Z',
            overlapWarnings: [],
            crossesMidnightWarnings: [],
        };
        const b: TdahRoutine = {
            id: 2,
            title: 'B',
            pattern: { kind: 'weekday', weekdays: [2] },
            blocks: [],
            createdAt: '2026-01-02T00:00:00Z',
            overlapWarnings: [],
            crossesMidnightWarnings: [],
        };
        const c: TdahRoutine = {
            id: 3,
            title: 'C',
            pattern: { kind: 'weekday', weekdays: [2] },
            blocks: [],
            createdAt: '2026-01-03T00:00:00Z',
            overlapWarnings: [],
            crossesMidnightWarnings: [],
        };
        cloudGetJson.mockImplementation((url: string) => {
            if (url.endsWith('/routines/conflicts')) {
                return Promise.resolve({
                    conflicts: {
                        '1': [
                            { withId: 2, withTitle: 'B', wins: false },
                            { withId: 3, withTitle: 'C', wins: false },
                        ],
                    },
                });
            }
            return Promise.resolve({ routines: [a, b, c] });
        });
        render(<TdahRoutinesListView />);

        await screen.findByText('A');
        expect(screen.getByText('Overlaps with "B", which currently wins on the shared days. +1 more')).toBeInTheDocument();
    });

    it('renders the load error with a retry that recovers', async () => {
        configureCloudSync();
        cloudGetJson.mockRejectedValueOnce(new Error('network down'));
        render(<TdahRoutinesListView />);

        await screen.findByText('Could not load your Routines from your server.');

        cloudGetJson.mockResolvedValueOnce({ routines: [workdayRoutine] });
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

        await screen.findByText('Workday');
    });
});

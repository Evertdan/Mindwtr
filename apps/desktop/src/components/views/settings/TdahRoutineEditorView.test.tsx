import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CloudHttpError } from '@mindwtr/core';

import { TdahRoutineEditorView } from './TdahRoutineEditorView';
import type { CloudConnection, TdahRoutine } from './TdahRoutinesListView';

const LABELS: Record<string, string> = {
    'tdahRoutines.list.retry': 'Retry',
    'tdahRoutines.editor.loading': 'Loading Routine…',
    'tdahRoutines.editor.loadError': 'Could not load this Routine.',
    'tdahRoutines.editor.titleCreate': 'New Routine',
    'tdahRoutines.editor.titleEdit': 'Edit Routine',
    'tdahRoutines.editor.editBanner': "Already-generated days don't change.",
    'tdahRoutines.editor.nameLabel': 'Name',
    'tdahRoutines.editor.namePlaceholder': 'e.g. "Workday"',
    'tdahRoutines.editor.nameTooLong': 'The name must be {max} characters or fewer.',
    'tdahRoutines.editor.patternLabel': 'Calendar pattern',
    'tdahRoutines.editor.patternKindWeekday': 'Specific weekdays',
    'tdahRoutines.editor.patternKindNth': 'Nth weekday of the month',
    'tdahRoutines.editor.patternWeekdaysEmpty': 'Select at least one day.',
    'tdahRoutines.editor.patternOrdinalLabel': 'Which occurrence',
    'tdahRoutines.editor.patternWeekdayLabel': 'Day of the week',
    'tdahRoutines.editor.previewLabel': 'Applicability preview',
    'tdahRoutines.editor.previewPrevMonth': 'Previous month',
    'tdahRoutines.editor.previewNextMonth': 'Next month',
    'tdahRoutines.editor.previewHint': 'Days this Routine would win.',
    'tdahRoutines.editor.previewLoading': 'Loading preview…',
    'tdahRoutines.editor.previewError': 'Could not load the preview.',
    'tdahRoutines.editor.previewEmpty': 'No days match this pattern this month.',
    'tdahRoutines.editor.previewLegendWin': 'This Routine wins',
    'tdahRoutines.editor.blocksLabel': 'Blocks',
    'tdahRoutines.editor.blocksEmpty': 'No Blocks yet.',
    'tdahRoutines.editor.addBlock': 'Add Block',
    'tdahRoutines.editor.blockTitleLabel': 'Title',
    'tdahRoutines.editor.blockTitlePlaceholder': 'e.g. "Wake up"',
    'tdahRoutines.editor.blockStartTimeLabel': 'Start time',
    'tdahRoutines.editor.blockDurationLabel': 'Duration (minutes)',
    'tdahRoutines.editor.blockDurationTooLong': 'Duration must be {max} minutes or fewer.',
    'tdahRoutines.editor.blockMoveUp': 'Move up',
    'tdahRoutines.editor.blockMoveDown': 'Move down',
    'tdahRoutines.editor.removeBlock': 'Remove Block',
    'tdahRoutines.editor.totalDuration': 'Total: {duration}',
    'tdahRoutines.editor.overlapWarning': 'This Block overlaps with another one in time.',
    'tdahRoutines.editor.midnightWarning': '"{title}" crosses midnight.',
    'tdahRoutines.editor.untitledBlock': 'This Block',
    'tdahRoutines.editor.save': 'Save',
    'tdahRoutines.editor.saving': 'Saving…',
    'tdahRoutines.editor.cancel': 'Cancel',
    'tdahRoutines.editor.saveError': 'Could not save this Routine. Try again.',
    'tdahRoutines.editor.saveInvalid': 'Fix the highlighted fields before saving.',
    'tdahRoutines.editor.saveNotFound': 'This Routine no longer exists.',
    'recurrence.ordinal.first': 'first',
    'recurrence.ordinal.second': 'second',
    'recurrence.ordinal.third': 'third',
    'recurrence.ordinal.fourth': 'fourth',
    'recurrence.ordinal.last': 'last',
};

const cloudGetJson = vi.fn();
const cloudRequestJson = vi.fn();

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

const CLOUD: CloudConnection = {
    url: 'https://sync.example.com',
    token: 'cloud-token-1234567890',
    allowInsecureHttp: false,
};

const workdayRoutine: TdahRoutine = {
    id: 5,
    title: 'Workday',
    pattern: { kind: 'weekday', weekdays: [1, 2, 3, 4, 5] },
    blocks: [
        { id: 1, title: 'Wake up', startTime: '05:30', durationMinutes: 15, sortOrder: 0 },
        { id: 2, title: 'Treadmill', startTime: '06:00', durationMinutes: 20, sortOrder: 1 },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    overlapWarnings: [],
    crossesMidnightWarnings: [],
};

describe('TdahRoutineEditorView', () => {
    const onSaved = vi.fn();
    const onCancel = vi.fn();

    beforeEach(() => {
        cloudGetJson.mockReset();
        cloudRequestJson.mockReset();
        onSaved.mockReset();
        onCancel.mockReset();
    });

    it('renders a blank create form with Save disabled until a name, pattern, and at least one Block are provided', async () => {
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={null} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('New Routine');
        expect(cloudGetJson).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Saturday home' } });
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Sunday' }));
        // Still disabled: the server always rejects an empty-Blocks Routine.
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Add Block' }));
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Wake up' } });
        expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
    });

    it('keeps Save disabled when there are zero Blocks even with a valid name and pattern', async () => {
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={null} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('New Routine');
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'No blocks yet' } });
        fireEvent.click(screen.getByRole('button', { name: 'Monday' }));

        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('disables Add Block once the max Blocks cap (24) is reached', async () => {
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={null} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('New Routine');
        const addBlockButton = screen.getByRole('button', { name: 'Add Block' });
        for (let i = 0; i < 24; i += 1) {
            fireEvent.click(addBlockButton);
        }

        expect(screen.getAllByLabelText('Title')).toHaveLength(24);
        expect(addBlockButton).toBeDisabled();
    });

    it('rejects a title over the length cap client-side, keeping Save disabled', async () => {
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={null} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('New Routine');
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x'.repeat(81) } });
        fireEvent.click(screen.getByRole('button', { name: 'Sunday' }));

        await screen.findByText('The name must be 80 characters or fewer.');
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('loads an existing Routine, shows the edit-mode banner, and fetches the applicability preview', async () => {
        cloudGetJson.mockImplementation((url: string) => {
            if (url.endsWith('/routines/5')) return Promise.resolve({ routine: workdayRoutine });
            if (url.includes('/preview')) return Promise.resolve({ dates: ['2026-08-03', '2026-08-04'] });
            return Promise.resolve(null);
        });
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={5} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('Edit Routine');
        expect(screen.getByText("Already-generated days don't change.")).toBeInTheDocument();
        expect(screen.getByLabelText('Name')).toHaveValue('Workday');

        await waitFor(() => {
            expect(cloudGetJson).toHaveBeenCalledWith(
                'https://sync.example.com/v1/tdah/routines/5',
                expect.objectContaining({ token: CLOUD.token }),
            );
        });
        await waitFor(() => {
            expect(cloudGetJson).toHaveBeenCalledWith(
                expect.stringContaining('/v1/tdah/routines/5/preview?month='),
                expect.objectContaining({ token: CLOUD.token }),
            );
        });
    });

    it('does not request an applicability preview in create mode (no id to preview yet)', async () => {
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={null} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('New Routine');
        expect(screen.queryByText('Applicability preview')).not.toBeInTheDocument();
        expect(cloudGetJson).not.toHaveBeenCalled();
    });

    it('surfaces a non-blocking overlap warning without disabling Save', async () => {
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={null} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('New Routine');
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Overlap test' } });
        fireEvent.click(screen.getByRole('button', { name: 'Monday' }));

        fireEvent.click(screen.getByRole('button', { name: 'Add Block' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add Block' }));
        const titleInputs = screen.getAllByLabelText('Title');
        fireEvent.change(titleInputs[0], { target: { value: 'First' } });
        fireEvent.change(titleInputs[1], { target: { value: 'Second' } });
        const startInputs = screen.getAllByLabelText('Start time');
        fireEvent.change(startInputs[0], { target: { value: '09:00' } });
        fireEvent.change(startInputs[1], { target: { value: '09:15' } });

        await waitFor(() => {
            expect(screen.getAllByText('This Block overlaps with another one in time.')).toHaveLength(2);
        });
        expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
    });

    it('surfaces a non-blocking midnight-crossing warning for a Block that pushes past 24:00', async () => {
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={null} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('New Routine');
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Midnight test' } });
        fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add Block' }));

        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Late block' } });
        fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '23:30' } });
        fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '90' } });

        await screen.findByText('"Late block" crosses midnight.');
        expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
    });

    it('falls back to a generic label for the midnight warning when the Block has no title yet', async () => {
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={null} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('New Routine');
        fireEvent.click(screen.getByRole('button', { name: 'Add Block' }));
        fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '23:30' } });
        fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '90' } });

        await screen.findByText('"This Block" crosses midnight.');
    });

    it('rejects a Block duration over the upper bound client-side', async () => {
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={null} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('New Routine');
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Too long' } });
        fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add Block' }));

        fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '100000' } });

        await screen.findByText('Duration must be 1440 minutes or fewer.');
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('allows a Block with zero duration (valid: end equals start), but keeps Save disabled until it is added', async () => {
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={null} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('New Routine');
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Empty day' } });
        fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Add Block' }));
        fireEvent.change(screen.getByLabelText('Duration (minutes)'), { target: { value: '0' } });
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Instant' } });
        expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
    });

    it('reorders Blocks with the move-up/move-down controls', async () => {
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={null} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('New Routine');
        fireEvent.click(screen.getByRole('button', { name: 'Add Block' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add Block' }));
        const titleInputs = screen.getAllByLabelText('Title');
        fireEvent.change(titleInputs[0], { target: { value: 'First' } });
        fireEvent.change(titleInputs[1], { target: { value: 'Second' } });

        const moveDownButtons = screen.getAllByRole('button', { name: 'Move down' });
        fireEvent.click(moveDownButtons[0]);

        const reordered = screen.getAllByLabelText('Title') as HTMLInputElement[];
        expect(reordered[0]).toHaveValue('Second');
        expect(reordered[1]).toHaveValue('First');
    });

    it('clears stale server-computed warnings when Blocks are reordered after a save', async () => {
        cloudGetJson.mockImplementation((url: string) => {
            if (url.endsWith('/routines/5')) return Promise.resolve({ routine: workdayRoutine });
            if (url.includes('/preview')) return Promise.resolve({ dates: [] });
            return Promise.resolve(null);
        });
        const savedWithWarning: TdahRoutine = {
            ...workdayRoutine,
            overlapWarnings: [{ blockIndexA: 0, blockIndexB: 1 }],
            crossesMidnightWarnings: [],
        };
        cloudRequestJson.mockResolvedValue({ routine: savedWithWarning });
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={5} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('Edit Routine');
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(screen.getAllByText('This Block overlaps with another one in time.')).toHaveLength(2);
        });

        const moveDownButtons = screen.getAllByRole('button', { name: 'Move down' });
        fireEvent.click(moveDownButtons[0]);

        // workdayRoutine's real Block times don't actually overlap — the
        // warning above came only from the stale server response attached to
        // the save. Reordering must clear it, not keep showing it against the
        // now-shuffled indices.
        expect(screen.queryByText('This Block overlaps with another one in time.')).not.toBeInTheDocument();
    });

    it('clamps the applicability-preview navigation to 12 months before the current month', async () => {
        cloudGetJson.mockImplementation((url: string) => {
            if (url.endsWith('/routines/5')) return Promise.resolve({ routine: workdayRoutine });
            return Promise.resolve({ dates: [] });
        });
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={5} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('Edit Routine');
        const prevButton = screen.getByRole('button', { name: 'Previous month' });

        for (let i = 0; i < 12; i += 1) {
            fireEvent.click(prevButton);
        }

        const now = new Date();
        const floor = new Date(now.getFullYear(), now.getMonth() - 12, 1);
        const expectedMonth = `${floor.getFullYear()}-${String(floor.getMonth() + 1).padStart(2, '0')}`;
        await waitFor(() => {
            expect(screen.getByText(expectedMonth)).toBeInTheDocument();
            expect(prevButton).toBeDisabled();
        });
    });

    it('creates a Routine via POST with the weekday pattern payload and reports the saved entity', async () => {
        const saved: TdahRoutine = {
            id: 42,
            title: 'New one',
            pattern: { kind: 'weekday', weekdays: [1] },
            blocks: [{ id: 1, title: 'Wake up', startTime: '09:00', durationMinutes: 30, sortOrder: 0 }],
            createdAt: '2026-08-01T00:00:00Z',
            overlapWarnings: [],
            crossesMidnightWarnings: [],
        };
        cloudRequestJson.mockResolvedValue({ routine: saved });
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={null} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('New Routine');
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New one' } });
        fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add Block' }));
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Wake up' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(cloudRequestJson).toHaveBeenCalledWith(
                'POST',
                'https://sync.example.com/v1/tdah/routines',
                {
                    title: 'New one',
                    pattern: { kind: 'weekday', weekdays: [1] },
                    blocks: [{ title: 'Wake up', startTime: '09:00', durationMinutes: 30 }],
                },
                expect.objectContaining({ token: CLOUD.token }),
            );
        });
        await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    });

    it('updates an existing Routine via a PUT-verb request to /routines/:id', async () => {
        cloudGetJson.mockImplementation((url: string) => {
            if (url.endsWith('/routines/5')) return Promise.resolve({ routine: workdayRoutine });
            if (url.includes('/preview')) return Promise.resolve({ dates: [] });
            return Promise.resolve(null);
        });
        cloudRequestJson.mockResolvedValue({ routine: { ...workdayRoutine, title: 'Workday renamed' } });
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={5} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('Edit Routine');
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Workday renamed' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(cloudRequestJson).toHaveBeenCalledWith(
                'PUT',
                'https://sync.example.com/v1/tdah/routines/5',
                expect.objectContaining({ title: 'Workday renamed' }),
                expect.objectContaining({ token: CLOUD.token }),
            );
        });
        await waitFor(() => expect(onSaved).toHaveBeenCalled());
    });

    it('shows a fix-your-input error for a 400-class save response, distinct from the generic network error copy', async () => {
        cloudRequestJson.mockRejectedValue(new CloudHttpError('Cloud POST failed (400): Bad Request', 400));
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={null} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('New Routine');
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bad input' } });
        fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add Block' }));
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Wake up' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await screen.findByText('Fix the highlighted fields before saving.');
        expect(screen.queryByText('Could not save this Routine. Try again.')).not.toBeInTheDocument();
        expect(onSaved).not.toHaveBeenCalled();
    });

    it('shows a distinct not-found message when the save target was deleted elsewhere (404), instead of the generic invalid-input copy', async () => {
        cloudGetJson.mockImplementation((url: string) => {
            if (url.endsWith('/routines/5')) return Promise.resolve({ routine: workdayRoutine });
            if (url.includes('/preview')) return Promise.resolve({ dates: [] });
            return Promise.resolve(null);
        });
        cloudRequestJson.mockRejectedValue(new CloudHttpError('Cloud PUT failed (404): Not Found', 404));
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={5} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('Edit Routine');
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await screen.findByText('This Routine no longer exists.');
        expect(screen.queryByText('Fix the highlighted fields before saving.')).not.toBeInTheDocument();
        expect(screen.queryByText('Could not save this Routine. Try again.')).not.toBeInTheDocument();
        expect(onSaved).not.toHaveBeenCalled();
    });

    it('shows the generic save error for a network failure', async () => {
        cloudRequestJson.mockRejectedValue(new Error('network down'));
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={null} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('New Routine');
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Offline' } });
        fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add Block' }));
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Wake up' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        await screen.findByText('Could not save this Routine. Try again.');
        expect(onSaved).not.toHaveBeenCalled();
    });

    it('calls onCancel without saving when Cancel is clicked', async () => {
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={null} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('New Routine');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(cloudRequestJson).not.toHaveBeenCalled();
    });

    it('renders the load error with a retry that recovers', async () => {
        cloudGetJson.mockRejectedValueOnce(new Error('network down'));
        render(<TdahRoutineEditorView cloud={CLOUD} routineId={5} onSaved={onSaved} onCancel={onCancel} />);

        await screen.findByText('Could not load this Routine.');

        cloudGetJson.mockImplementation((url: string) => {
            if (url.endsWith('/routines/5')) return Promise.resolve({ routine: workdayRoutine });
            return Promise.resolve({ dates: [] });
        });
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

        await screen.findByText('Edit Routine');
    });
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

import { CloudHttpError } from '@mindwtr/core';

import { TdahDndView, type TdahDndResponse, type TdahDndWindow } from './TdahDndView';

const LABELS: Record<string, string> = {
    'tdahDnd.title': 'Do not disturb',
    'tdahDnd.promise': 'During a meeting we stay quiet. What gets suppressed does not come back later — you settle it at night, in the ritual.',
    'tdahDnd.loading': 'Loading your quiet windows…',
    'tdahDnd.needsSync': 'Set up Self-Hosted cloud sync to manage your quiet windows.',
    'tdahDnd.inactive': 'ADHD mode is off — turn it on to manage your quiet windows.',
    'tdahDnd.loadError': 'Could not load your quiet windows from your server.',
    'tdahDnd.retry': 'Retry',
    'tdahDnd.offlineBanner': 'Offline — showing the last loaded state.',
    'tdahDnd.status.title': 'Right now',
    'tdahDnd.status.active': 'Quiet until {time}',
    'tdahDnd.status.idle': 'Not quiet right now — reminders are coming through.',
    'tdahDnd.calendar.title': 'Calendar detection',
    'tdahDnd.calendar.description': 'Events marked busy inside your working hours silence reminders on their own.',
    'tdahDnd.calendar.toggle': 'Detect meetings from my calendar',
    'tdahDnd.calendar.permissionCta': 'Allow calendar access',
    'tdahDnd.calendar.permissionSettings': 'Open system settings',
    'tdahDnd.calendar.unsupported': 'This app does not read calendars. Here you manage your manual windows; meeting detection lives on your phone.',
    'tdahDnd.work.title': 'Working hours',
    'tdahDnd.work.hint': 'Calendar detection only looks inside this range.',
    'tdahDnd.work.start': 'From',
    'tdahDnd.work.end': 'To',
    'tdahDnd.work.invalid': 'The start has to come before the end.',
    'tdahDnd.work.saveError': 'Could not save your working hours on your server.',
    'tdahDnd.windows.title': 'Manual windows',
    'tdahDnd.windows.empty': 'No manual windows yet. Add one for the meetings that come back every week.',
    'tdahDnd.windows.add': 'Add a window',
    'tdahDnd.windows.edit': 'Edit',
    'tdahDnd.windows.delete': 'Delete',
    'tdahDnd.windows.deleteError': 'Could not delete that window on your server.',
    'tdahDnd.windows.limit': 'You have reached the limit of manual windows. Delete one to add another.',
    'tdahDnd.windows.weekly': '{days} · {start}–{end}',
    'tdahDnd.windows.once': '{date} · {start}–{end}',
    'tdahDnd.windows.sourceCalendar': 'From your calendar',
    'tdahDnd.editor.addTitle': 'New quiet window',
    'tdahDnd.editor.editTitle': 'Edit quiet window',
    'tdahDnd.editor.kind': 'Repeats',
    'tdahDnd.editor.kindWeekly': 'Every week',
    'tdahDnd.editor.kindOnce': 'One-off',
    'tdahDnd.editor.days': 'Days',
    'tdahDnd.editor.date': 'Date',
    'tdahDnd.editor.start': 'Starts',
    'tdahDnd.editor.end': 'Ends',
    'tdahDnd.editor.label': 'Name (optional)',
    'tdahDnd.editor.labelPlaceholder': 'Leaders meeting',
    'tdahDnd.editor.save': 'Save',
    'tdahDnd.editor.saving': 'Saving…',
    'tdahDnd.editor.cancel': 'Cancel',
    'tdahDnd.editor.invalid': 'Check the days, the date and the times.',
    'tdahDnd.editor.saveError': 'Could not save that window on your server.',
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

const CLOUD_URL = 'https://sync.example.com';
const CLOUD_TOKEN = 'cloud-token-1234567890';
const DND_URL = 'https://sync.example.com/v1/tdah/dnd';
const WINDOWS_URL = 'https://sync.example.com/v1/tdah/dnd/windows';

const configureCloudSync = (url: string | null = CLOUD_URL, token: string | null = CLOUD_TOKEN): void => {
    getCloudConfig.mockResolvedValue({
        url: url ?? '',
        token: token ?? '',
        allowInsecureHttp: false,
    });
};

const manualWeekly: TdahDndWindow = {
    id: 'w-weekly',
    source: 'manual',
    kind: 'weekly',
    weekdays: [1, 3],
    date: null,
    startTime: '10:00',
    endTime: '11:00',
    label: 'Leaders meeting',
};

const manualOnce: TdahDndWindow = {
    id: 'w-once',
    source: 'manual',
    kind: 'once',
    weekdays: null,
    date: '2026-09-01',
    startTime: '14:00',
    endTime: '15:30',
    label: null,
};

// Uploaded by the phone. The PWA neither creates nor edits these.
const calendarWindow: TdahDndWindow = {
    id: 'w-calendar',
    source: 'calendar',
    kind: 'once',
    weekdays: null,
    date: '2026-08-28',
    startTime: '10:00',
    endTime: '11:00',
    label: 'Sprint review',
};

const baseState: TdahDndResponse = {
    settings: { calendarEnabled: false, workStart: '09:00', workEnd: '18:00' },
    windows: [manualWeekly, manualOnce],
    activeUntil: null,
};

const mockDnd = (state: TdahDndResponse | null): void => {
    cloudGetJson.mockImplementation((url: string) => (
        url.includes('/tdah/dnd') ? Promise.resolve(state) : Promise.resolve(null)
    ));
};

/**
 * `mockDnd`, but the SECOND and later reads answer with `next` — the shape a
 * real server produces once the announced instant has passed and it recomputes
 * `activeUntil` for the new "now".
 */
const mockDndSequence = (first: TdahDndResponse, next: TdahDndResponse): void => {
    let seen = 0;
    cloudGetJson.mockImplementation((url: string) => {
        if (!url.includes('/tdah/dnd')) return Promise.resolve(null);
        seen += 1;
        return Promise.resolve(seen === 1 ? first : next);
    });
};

const openEditorForNewWindow = async (): Promise<HTMLElement> => {
    fireEvent.click(screen.getByRole('button', { name: 'Add a window' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('New quiet window')).toBeInTheDocument();
    return dialog;
};

describe('TdahDndView', () => {
    beforeEach(() => {
        cloudGetJson.mockReset();
        cloudRequestJson.mockReset();
        getCloudConfig.mockReset();
    });

    it('shows the needs-sync hint and never calls the server when Self-Hosted sync is not configured', async () => {
        configureCloudSync(null, null);
        render(<TdahDndView />);

        await screen.findByText('Set up Self-Hosted cloud sync to manage your quiet windows.');
        expect(cloudGetJson).not.toHaveBeenCalled();
        expect(cloudRequestJson).not.toHaveBeenCalled();
    });

    it('reads the state from the server and shows the idle status plus the no-recovery promise', async () => {
        configureCloudSync();
        mockDnd(baseState);
        render(<TdahDndView />);

        const status = await screen.findByTestId('tdah-dnd-status');
        expect(status.textContent).toBe('Not quiet right now — reminders are coming through.');
        expect(cloudGetJson).toHaveBeenCalledWith(DND_URL, expect.objectContaining({ token: CLOUD_TOKEN }));
        expect(screen.getByText(/does not come back later/)).toBeInTheDocument();
    });

    it('renders the server-computed activeUntil verbatim and never decides it locally', async () => {
        configureCloudSync();
        // DW-111: the claim is time-dependent now, so the clock is pinned
        // inside the announced window (10:00 in the profile's zone) rather than
        // left to whatever the wall clock says when the suite runs.
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.setSystemTime(new Date('2026-08-26T16:00:00Z'));
        try {
            // The windows list here says nothing about *now*: the only source of
            // "quiet until 11:00" is the server's own `activeUntil` (AD-8). A
            // client that computed this itself would say "idle" for this payload.
            mockDnd({ ...baseState, windows: [], activeUntil: '11:00', timeZone: 'America/Mexico_City' });
            render(<TdahDndView />);

            const status = await screen.findByTestId('tdah-dnd-status');
            expect(status.textContent).toBe('Quiet until 11:00');
        } finally {
            vi.useRealTimers();
        }
    });

    // DW-111 — zone 1's claim is time-dependent, and until this fix nothing on
    // this view ever re-read it: "Quiet until 11:00" stayed on screen at 14:00,
    // on the very view the user opens to check whether they are quiet. Same
    // defect and same fix as the two mobile surfaces (DW-102).
    describe('DW-111 — the status stops claiming a silence that has ended', () => {
        beforeEach(() => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('keeps the claim while the announced instant is still ahead', async () => {
            configureCloudSync();
            // 09:00 in the profile's zone (America/Mexico_City = UTC-6).
            vi.setSystemTime(new Date('2026-08-26T15:00:00Z'));
            mockDnd({ ...baseState, activeUntil: '12:00', timeZone: 'America/Mexico_City' });
            render(<TdahDndView />);

            const status = await screen.findByTestId('tdah-dnd-status');
            expect(status.textContent).toBe('Quiet until 12:00');

            // 09:00 → 11:00 local: still inside the window.
            await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000); });
            expect(screen.getByTestId('tdah-dnd-status').textContent).toBe('Quiet until 12:00');
        });

        it('drops the claim once the announced instant passes, and re-reads the server', async () => {
            configureCloudSync();
            vi.setSystemTime(new Date('2026-08-26T15:00:00Z'));
            // The reload the expiry triggers gets the server's fresh verdict —
            // which is `null`, because the window really has ended. The view
            // never decides that itself (AD-8); it only decides when to ask.
            mockDndSequence(
                { ...baseState, activeUntil: '12:00', timeZone: 'America/Mexico_City' },
                { ...baseState, activeUntil: null, timeZone: 'America/Mexico_City' },
            );
            render(<TdahDndView />);

            const status = await screen.findByTestId('tdah-dnd-status');
            expect(status.textContent).toBe('Quiet until 12:00');
            expect(cloudGetJson).toHaveBeenCalledTimes(1);

            // 09:00 → 12:10 local.
            await act(async () => { await vi.advanceTimersByTimeAsync((3 * 60 + 10) * 60 * 1000); });
            await waitFor(() => {
                expect(screen.getByTestId('tdah-dnd-status').textContent)
                    .toBe('Not quiet right now — reminders are coming through.');
            });
            // Edge-triggered: exactly one extra read, not one per tick.
            expect(cloudGetJson).toHaveBeenCalledTimes(2);
        });

        // The midnight edge a bare "HH:mm" compare cannot see: "00:20" is
        // lexically SMALLER than "23:59", so the time term alone would keep an
        // end-of-day claim standing for most of the following day.
        it('drops an end-of-day claim once the profile zone rolls past midnight', async () => {
            configureCloudSync();
            // 23:50 local on 2026-08-26 (UTC-6).
            vi.setSystemTime(new Date('2026-08-27T05:50:00Z'));
            mockDndSequence(
                { ...baseState, activeUntil: '23:59', timeZone: 'America/Mexico_City' },
                { ...baseState, activeUntil: null, timeZone: 'America/Mexico_City' },
            );
            render(<TdahDndView />);

            const status = await screen.findByTestId('tdah-dnd-status');
            expect(status.textContent).toBe('Quiet until 23:59');

            // 23:50 → 00:20 the next local day.
            await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000); });
            await waitFor(() => {
                expect(screen.getByTestId('tdah-dnd-status').textContent)
                    .toBe('Not quiet right now — reminders are coming through.');
            });
        });
    });

    it('stays idle when the server says so even while manual windows exist', async () => {
        configureCloudSync();
        mockDnd({ ...baseState, activeUntil: null });
        render(<TdahDndView />);

        const status = await screen.findByTestId('tdah-dnd-status');
        expect(status.textContent).toBe('Not quiet right now — reminders are coming through.');
    });

    it('states permanently that this app does not read calendars, with no toggle and no permission prompt', async () => {
        configureCloudSync();
        mockDnd(baseState);
        render(<TdahDndView />);

        const notice = await screen.findByTestId('tdah-dnd-unsupported');
        expect(notice.textContent).toContain('does not read calendars');
        // Not a degradation with a way out: nothing here offers detection.
        expect(screen.queryByLabelText('Detect meetings from my calendar')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Allow calendar access' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Open system settings' })).toBeNull();
        // And it never uploads calendar windows.
        expect(cloudRequestJson).not.toHaveBeenCalled();
    });

    it('lists only manual windows, describing weekly and one-off rules', async () => {
        configureCloudSync();
        mockDnd({ ...baseState, windows: [manualWeekly, manualOnce, calendarWindow] });
        render(<TdahDndView />);

        await screen.findByTestId('tdah-dnd-window-w-weekly');
        expect(screen.getByText('Mon, Wed · 10:00–11:00')).toBeInTheDocument();
        expect(screen.getByText('Leaders meeting')).toBeInTheDocument();
        expect(screen.getByTestId('tdah-dnd-window-w-once').textContent).toContain('14:00–15:30');
        expect(screen.getByTestId('tdah-dnd-window-w-once').textContent).toContain('2026');

        // A calendar row would only ever answer 409 TDAH_DND_READ_ONLY here.
        expect(screen.queryByTestId('tdah-dnd-window-w-calendar')).toBeNull();
        expect(screen.queryByText('Sprint review')).toBeNull();
    });

    it('shows the dignified empty state when there are no manual windows', async () => {
        configureCloudSync();
        mockDnd({ ...baseState, windows: [calendarWindow] });
        render(<TdahDndView />);

        const empty = await screen.findByTestId('tdah-dnd-empty');
        expect(empty.textContent).toContain('No manual windows yet');
    });

    it('creates a weekly window, sending the weekday shape without a null date', async () => {
        configureCloudSync();
        mockDnd({ ...baseState, windows: [] });
        cloudRequestJson.mockResolvedValue({ ...baseState, windows: [manualWeekly] });
        render(<TdahDndView />);
        await screen.findByTestId('tdah-dnd-empty');

        const dialog = await openEditorForNewWindow();
        // A just-opened dialog is invalid by construction (no day picked yet),
        // but the user has not done anything wrong: the red line stays away
        // until they touch a field. The save is still refused locally, not by
        // the server.
        expect(within(dialog).queryByTestId('tdah-dnd-editor-invalid')).toBeNull();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        expect(cloudRequestJson).not.toHaveBeenCalled();

        // ...and once they DO touch it and the draft is still incomplete, the
        // line appears.
        fireEvent.change(within(dialog).getByLabelText('Starts'), { target: { value: '10:30' } });
        expect(within(dialog).getByTestId('tdah-dnd-editor-invalid')).toBeInTheDocument();

        fireEvent.click(within(dialog).getByLabelText('Monday'));
        fireEvent.change(within(dialog).getByLabelText('Starts'), { target: { value: '10:30' } });
        fireEvent.change(within(dialog).getByLabelText('Ends'), { target: { value: '11:30' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(cloudRequestJson).toHaveBeenCalled());
        const [method, url, body] = cloudRequestJson.mock.calls[0];
        expect(method).toBe('POST');
        expect(url).toBe(WINDOWS_URL);
        expect(body).toEqual({ kind: 'weekly', weekdays: [1], startTime: '10:30', endTime: '11:30' });
        // The irrelevant half of the shape is absent, never sent as null.
        expect(Object.prototype.hasOwnProperty.call(body, 'date')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(body, 'label')).toBe(false);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('creates a one-off window, sending the date shape without a null weekdays', async () => {
        configureCloudSync();
        mockDnd({ ...baseState, windows: [] });
        cloudRequestJson.mockResolvedValue({ ...baseState, windows: [manualOnce] });
        render(<TdahDndView />);
        await screen.findByTestId('tdah-dnd-empty');

        const dialog = await openEditorForNewWindow();
        fireEvent.click(within(dialog).getByRole('button', { name: 'One-off' }));
        fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-09-01' } });
        fireEvent.change(within(dialog).getByLabelText('Name (optional)'), { target: { value: '  Dentist  ' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(cloudRequestJson).toHaveBeenCalled());
        const [, , body] = cloudRequestJson.mock.calls[0];
        expect(body).toEqual({
            kind: 'once',
            date: '2026-09-01',
            startTime: '10:00',
            endTime: '11:00',
            label: 'Dentist',
        });
        expect(Object.prototype.hasOwnProperty.call(body, 'weekdays')).toBe(false);
    });

    it('never sends an inverted window, an empty weekday set, or a date that does not exist', async () => {
        configureCloudSync();
        mockDnd({ ...baseState, windows: [] });
        render(<TdahDndView />);
        await screen.findByTestId('tdah-dnd-empty');

        const dialog = await openEditorForNewWindow();
        fireEvent.click(within(dialog).getByLabelText('Monday'));
        // `[start, end)` with end <= start is a window that can never be active.
        fireEvent.change(within(dialog).getByLabelText('Ends'), { target: { value: '10:00' } });
        expect(within(dialog).getByTestId('tdah-dnd-editor-invalid')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        expect(cloudRequestJson).not.toHaveBeenCalled();

        // Unpicking the last weekday is the same class of defect.
        fireEvent.change(within(dialog).getByLabelText('Ends'), { target: { value: '11:00' } });
        await waitFor(() => expect(within(dialog).queryByTestId('tdah-dnd-editor-invalid')).toBeNull());
        fireEvent.click(within(dialog).getByLabelText('Monday'));
        expect(within(dialog).getByTestId('tdah-dnd-editor-invalid')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        expect(cloudRequestJson).not.toHaveBeenCalled();

        // A `YYYY-MM-DD`-shaped string that is not a real date.
        fireEvent.click(within(dialog).getByRole('button', { name: 'One-off' }));
        fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-02-31' } });
        expect(within(dialog).getByTestId('tdah-dnd-editor-invalid')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        expect(cloudRequestJson).not.toHaveBeenCalled();
    });

    it('edits an existing manual window in place through PUT', async () => {
        configureCloudSync();
        mockDnd(baseState);
        cloudRequestJson.mockResolvedValue(baseState);
        render(<TdahDndView />);
        await screen.findByTestId('tdah-dnd-window-w-weekly');

        const row = screen.getByTestId('tdah-dnd-window-w-weekly');
        fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Edit quiet window')).toBeInTheDocument();
        // Seeded from the server's row, not from a blank draft.
        expect((within(dialog).getByLabelText('Starts') as HTMLInputElement).value).toBe('10:00');
        expect((within(dialog).getByLabelText('Name (optional)') as HTMLInputElement).value).toBe('Leaders meeting');

        fireEvent.change(within(dialog).getByLabelText('Ends'), { target: { value: '12:00' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(cloudRequestJson).toHaveBeenCalled());
        const [method, url, body] = cloudRequestJson.mock.calls[0];
        expect(method).toBe('PUT');
        expect(url).toBe(`${WINDOWS_URL}/w-weekly`);
        expect(body).toEqual({
            kind: 'weekly',
            weekdays: [1, 3],
            startTime: '10:00',
            endTime: '12:00',
            label: 'Leaders meeting',
        });
    });

    it('deletes a manual window and reports a failed delete without dropping the row', async () => {
        configureCloudSync();
        mockDnd(baseState);
        cloudRequestJson.mockRejectedValue(new Error('server down'));
        render(<TdahDndView />);
        await screen.findByTestId('tdah-dnd-window-w-once');

        const row = screen.getByTestId('tdah-dnd-window-w-once');
        fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));

        await screen.findByTestId('tdah-dnd-delete-error');
        expect(screen.getByTestId('tdah-dnd-window-w-once')).toBeInTheDocument();

        cloudRequestJson.mockResolvedValue({ ...baseState, windows: [manualWeekly] });
        fireEvent.click(within(screen.getByTestId('tdah-dnd-window-w-once')).getByRole('button', { name: 'Delete' }));

        await waitFor(() => {
            expect(cloudRequestJson).toHaveBeenLastCalledWith(
                'DELETE',
                `${WINDOWS_URL}/w-once`,
                undefined,
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
        });
        await waitFor(() => expect(screen.queryByTestId('tdah-dnd-window-w-once')).toBeNull());
    });

    it('refuses the 51st manual window locally instead of trading a 409 it cannot read a code off', async () => {
        configureCloudSync();
        const windows: TdahDndWindow[] = Array.from({ length: 50 }, (_, index) => ({
            ...manualWeekly,
            id: `w-${index}`,
            label: null,
        }));
        mockDnd({ ...baseState, windows });
        render(<TdahDndView />);

        await screen.findByTestId('tdah-dnd-limit');
        expect(screen.getByRole('button', { name: 'Add a window' })).toBeDisabled();
        expect(cloudRequestJson).not.toHaveBeenCalled();
    });

    it('saves the working hours on blur, carrying calendarEnabled through untouched', async () => {
        configureCloudSync();
        mockDnd({ ...baseState, settings: { calendarEnabled: true, workStart: '09:00', workEnd: '18:00' } });
        cloudRequestJson.mockResolvedValue({
            ...baseState,
            settings: { calendarEnabled: true, workStart: '07:30', workEnd: '18:00' },
        });
        render(<TdahDndView />);
        await screen.findByTestId('tdah-dnd-status');

        expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('09:00');
        fireEvent.change(screen.getByLabelText('From'), { target: { value: '07:30' } });
        fireEvent.blur(screen.getByLabelText('From'));

        await waitFor(() => {
            expect(cloudRequestJson).toHaveBeenCalledWith(
                'PUT',
                DND_URL,
                // `calendarEnabled` is server state the phone owns: this screen
                // must never flip detection off as a side effect.
                { calendarEnabled: true, workStart: '07:30', workEnd: '18:00' },
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
        });
    });

    it('never sends an inverted working window and reports a failed save', async () => {
        configureCloudSync();
        mockDnd(baseState);
        render(<TdahDndView />);
        await screen.findByTestId('tdah-dnd-status');

        fireEvent.change(screen.getByLabelText('To'), { target: { value: '08:00' } });
        fireEvent.blur(screen.getByLabelText('To'));
        await screen.findByTestId('tdah-dnd-work-invalid');
        expect(cloudRequestJson).not.toHaveBeenCalled();

        cloudRequestJson.mockRejectedValue(new Error('server down'));
        fireEvent.change(screen.getByLabelText('To'), { target: { value: '17:00' } });
        fireEvent.blur(screen.getByLabelText('To'));
        await screen.findByTestId('tdah-dnd-work-error');
    });

    it('shows the inactive state when the server answers 409 TDAH_ACTIVATE_REQUIRED', async () => {
        configureCloudSync();
        cloudGetJson.mockRejectedValue(new CloudHttpError('activation required', 409));
        render(<TdahDndView />);

        await screen.findByText('ADHD mode is off — turn it on to manage your quiet windows.');
        expect(screen.queryByRole('button', { name: 'Add a window' })).toBeNull();
    });

    it('tells a mutation 409 apart from the mode gate by re-reading', async () => {
        configureCloudSync();
        mockDnd({ ...baseState, windows: [] });
        // The create 409s but the read still works: the mode is on, so this is
        // the manual-window cap, not "ADHD mode is off".
        cloudRequestJson.mockRejectedValue(new CloudHttpError('limit', 409));
        render(<TdahDndView />);
        await screen.findByTestId('tdah-dnd-empty');

        const dialog = await openEditorForNewWindow();
        fireEvent.click(within(dialog).getByLabelText('Monday'));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        const editorError = await screen.findByTestId('tdah-dnd-editor-error');
        expect(editorError.textContent).toContain('limit of manual windows');
        expect(screen.queryByText('ADHD mode is off — turn it on to manage your quiet windows.')).toBeNull();
    });

    it('falls to the inactive state when the mutation 409 and the re-read both come back closed', async () => {
        configureCloudSync();
        mockDnd({ ...baseState, windows: [] });
        cloudRequestJson.mockImplementation(async () => {
            cloudGetJson.mockRejectedValue(new CloudHttpError('activation required', 409));
            throw new CloudHttpError('activation required', 409);
        });
        render(<TdahDndView />);
        await screen.findByTestId('tdah-dnd-empty');

        const dialog = await openEditorForNewWindow();
        fireEvent.click(within(dialog).getByLabelText('Monday'));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        await screen.findByText('ADHD mode is off — turn it on to manage your quiet windows.');
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('surfaces a rejected window shape as its own message, not as a generic save failure', async () => {
        configureCloudSync();
        mockDnd({ ...baseState, windows: [] });
        cloudRequestJson.mockRejectedValue(new CloudHttpError('invalid', 400));
        render(<TdahDndView />);
        await screen.findByTestId('tdah-dnd-empty');

        const dialog = await openEditorForNewWindow();
        fireEvent.click(within(dialog).getByLabelText('Monday'));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

        const editorError = await screen.findByTestId('tdah-dnd-editor-error');
        expect(editorError.textContent).toBe('Check the days, the date and the times.');
        // The dialog stays open with the draft intact so the user can fix it.
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('shows a generic load error with retry on a non-409 failure', async () => {
        configureCloudSync();
        cloudGetJson.mockRejectedValue(new Error('network down'));
        render(<TdahDndView />);

        await screen.findByText('Could not load your quiet windows from your server.');

        mockDnd(baseState);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByTestId('tdah-dnd-window-w-weekly');
    });

    it('shows the offline banner over the last loaded state and refetches on reconnect', async () => {
        configureCloudSync();
        mockDnd(baseState);
        render(<TdahDndView />);
        await screen.findByTestId('tdah-dnd-window-w-weekly');
        expect(screen.queryByText('Offline — showing the last loaded state.')).toBeNull();

        fireEvent(window, new Event('offline'));
        await screen.findByText('Offline — showing the last loaded state.');
        expect(screen.getByTestId('tdah-dnd-window-w-weekly')).toBeInTheDocument();

        cloudGetJson.mockClear();
        fireEvent(window, new Event('online'));
        await waitFor(() => expect(cloudGetJson).toHaveBeenCalled());
        await waitFor(() => {
            expect(screen.queryByText('Offline — showing the last loaded state.')).toBeNull();
        });
    });
});

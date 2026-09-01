import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CloudHttpError } from '@mindwtr/core';

import { TdahJiraView, type TdahWorkOriginResponse } from './TdahJiraView';

const LABELS: Record<string, string> = {
    'tdahJira.title': 'Jira work origin',
    'tdahJira.privacy': 'Nothing from Jira enters GTD sync — it lives on your server, per account.',
    'tdahJira.loading': 'Loading your work origin…',
    'tdahJira.needsSync': 'Set up Self-Hosted cloud sync to connect your work origin.',
    'tdahJira.inactive': 'ADHD mode is off — turn it on to connect your work origin.',
    'tdahJira.loadError': 'Could not load your work origin from your server.',
    'tdahJira.retry': 'Retry',
    'tdahJira.offlineBanner': 'Offline — showing the last loaded state.',
    'tdahJira.readOnly': 'Jira tasks are read-only: marking one records the alert as handled and never writes back to Jira.',
    'tdahJira.status.title': 'Connection',
    'tdahJira.status.connected': 'Connected to {site}',
    'tdahJira.status.disconnected': 'No work origin connected yet.',
    'tdahJira.status.account': 'As {email}',
    'tdahJira.status.lastSync': 'Last successful sync {when}',
    'tdahJira.status.neverSynced': 'No successful sync yet.',
    'tdahJira.status.syncing': 'Syncing…',
    'tdahJira.status.taskCount': '{count} assigned task(s) in the active sprint',
    'tdahJira.status.noSprint': 'No active sprint — nothing to import.',
    'tdahJira.status.multiSprint': 'Several sprints are open at once; every assigned task from all of them is grouped into one band.',
    'tdahJira.error.credentials': 'The token no longer works — add a new one. Your personal activities keep running as usual.',
    'tdahJira.error.unreachable': 'Your server could not reach Jira. Your personal activities keep running as usual.',
    'tdahJira.error.keyUnavailable': 'Your server has no at-rest encryption key configured, so it refuses to store the token. Ask whoever runs it to set one.',
    'tdahJira.error.dayFull': 'Your day is already full, so the work band could not be added. Free up some activities and sync again.',
    'tdahJira.form.title': 'Connect',
    'tdahJira.form.siteUrl': 'Jira Cloud site URL',
    'tdahJira.form.siteUrlHint': 'For example https://yourcompany.atlassian.net',
    'tdahJira.form.email': 'Jira account email',
    'tdahJira.form.token': 'API token',
    'tdahJira.form.tokenHint': 'Stored encrypted on your server and never shown again.',
    'tdahJira.form.tokenStoredPlaceholder': 'A token is already stored',
    'tdahJira.form.tokenNewPlaceholder': 'Paste your API token',
    'tdahJira.form.save': 'Connect',
    'tdahJira.form.saving': 'Connecting…',
    'tdahJira.form.update': 'Update connection',
    'tdahJira.form.invalid': 'Check the site URL, the email and the token.',
    'tdahJira.form.saveError': 'Could not save the connection on your server.',
    'tdahJira.sync.title': 'Sync',
    'tdahJira.sync.interval': 'Pull every',
    'tdahJira.sync.intervalHours': '{hours} h',
    'tdahJira.sync.window': 'Working hours',
    'tdahJira.sync.windowHint': 'The band starts at this hour, and no pull runs outside the window.',
    'tdahJira.sync.now': 'Sync now',
    'tdahJira.jql.title': 'Query that runs',
    'tdahJira.jql.hint': 'This is the exact JQL your server sends to Jira.',
    'tdahJira.disconnect.action': 'Disconnect',
    'tdahJira.disconnect.title': 'Disconnect the Jira origin?',
    'tdahJira.disconnect.body': 'No more tasks will be imported. What was already imported stays in your History.',
    'tdahJira.disconnect.confirm': 'Disconnect',
    'tdahJira.disconnect.cancel': 'Cancel',
    'tdahJira.disconnect.error': 'Could not disconnect on your server.',
    'tdahHistory.filters.from': 'From',
    'tdahHistory.filters.to': 'To',
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
const ORIGIN_URL = 'https://sync.example.com/v1/tdah/origin';
const JIRA_TOKEN = 'atlassian-api-token-SECRET-9f3b';
const JQL = 'assignee = currentUser() AND sprint in openSprints() AND statusCategory != Done ORDER BY updated ASC';

const configureCloudSync = (url: string | null = CLOUD_URL, token: string | null = CLOUD_TOKEN): void => {
    getCloudConfig.mockResolvedValue({
        url: url ?? '',
        token: token ?? '',
        allowInsecureHttp: false,
    });
};

// The real wire shape of the disconnected state: the server's
// `TdahWorkOriginStatus` nulls every settings field until a credential exists,
// including `jql`. This is the first payload the screen ever sees.
const disconnectedOrigin: TdahWorkOriginResponse = {
    connected: false,
    provider: null,
    siteUrl: null,
    email: null,
    jql: null,
    workStart: null,
    workEnd: null,
    pullIntervalMinutes: null,
    connectedAt: null,
    lastSyncAt: null,
    lastErrorCode: null,
    issues: [],
};

const connectedOrigin: TdahWorkOriginResponse = {
    connected: true,
    provider: 'jira',
    siteUrl: 'https://acme.atlassian.net',
    email: 'me@acme.com',
    jql: JQL,
    workStart: '09:00',
    workEnd: '18:00',
    pullIntervalMinutes: 120,
    connectedAt: '2026-08-20T09:00:00Z',
    lastSyncAt: '2026-08-28T11:00:00Z',
    lastErrorCode: null,
    issues: [
        { externalKey: 'ACME-1', summary: 'Ship the thing', status: 'In Progress', sprintName: 'Sprint 12' },
        { externalKey: 'ACME-2', summary: 'Review the other thing', status: 'To Do', sprintName: 'Sprint 12' },
    ],
};

const mockOrigin = (origin: TdahWorkOriginResponse | null): void => {
    cloudGetJson.mockImplementation((url: string) => (
        url.includes('/tdah/origin') ? Promise.resolve(origin) : Promise.resolve(null)
    ));
};

/** Nothing anywhere in the rendered tree — text or input value — may be the token. */
const expectTokenAbsentFromDom = (): void => {
    expect(document.body.textContent ?? '').not.toContain(JIRA_TOKEN);
    for (const input of Array.from(document.querySelectorAll('input'))) {
        expect(input.value).not.toContain(JIRA_TOKEN);
    }
};

const fillCredentials = (): void => {
    fireEvent.change(screen.getByLabelText('Jira Cloud site URL'), { target: { value: 'https://acme.atlassian.net' } });
    fireEvent.change(screen.getByLabelText('Jira account email'), { target: { value: 'me@acme.com' } });
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: JIRA_TOKEN } });
};

describe('TdahJiraView', () => {
    beforeEach(() => {
        cloudGetJson.mockReset();
        cloudRequestJson.mockReset();
        getCloudConfig.mockReset();
    });

    it('shows the needs-sync hint and never calls the server when Self-Hosted sync is not configured', async () => {
        configureCloudSync(null, null);
        render(<TdahJiraView />);

        await screen.findByText('Set up Self-Hosted cloud sync to connect your work origin.');
        expect(cloudGetJson).not.toHaveBeenCalled();
        expect(cloudRequestJson).not.toHaveBeenCalled();
    });

    it('reads the origin status from the server and shows the never-connected onboarding state', async () => {
        configureCloudSync();
        mockOrigin(disconnectedOrigin);
        render(<TdahJiraView />);

        await screen.findByText('No work origin connected yet.');
        expect(cloudGetJson).toHaveBeenCalledWith(ORIGIN_URL, expect.objectContaining({ token: CLOUD_TOKEN }));
        // Nothing to disconnect yet, and no "Sync now" without a connection.
        expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    });

    it('shows the effective JQL as selectable text even before anything is connected', async () => {
        configureCloudSync();
        // The disconnected payload carries `jql: null` — zone 4 still has to
        // show the query that *will* run.
        mockOrigin(disconnectedOrigin);
        render(<TdahJiraView />);

        const jql = await screen.findByTestId('tdah-jira-jql');
        expect(jql.textContent).toBe(JQL);
        expect(screen.getByText('This is the exact JQL your server sends to Jira.')).toBeInTheDocument();
    });

    it('renders the healthy connected state: site, account, last sync and the task count', async () => {
        configureCloudSync();
        mockOrigin(connectedOrigin);
        render(<TdahJiraView />);

        await screen.findByText('Connected to https://acme.atlassian.net');
        expect(screen.getByText('As me@acme.com')).toBeInTheDocument();
        expect(screen.getByText('2 assigned task(s) in the active sprint')).toBeInTheDocument();
        expect(screen.getByText(/^Last successful sync /)).toBeInTheDocument();
        // Only one sprint in the snapshot — the multi-sprint notice stays away.
        expect(screen.queryByText(/Several sprints are open/)).toBeNull();
    });

    it('shows the no-sprint state instead of a task count when the snapshot is empty', async () => {
        configureCloudSync();
        mockOrigin({ ...connectedOrigin, issues: [], lastSyncAt: null });
        render(<TdahJiraView />);

        await screen.findByText('No active sprint — nothing to import.');
        expect(screen.getByText('No successful sync yet.')).toBeInTheDocument();
        // A clean empty snapshot is not an error state.
        expect(screen.queryByTestId('tdah-jira-last-error')).toBeNull();
    });

    it('warns when the snapshot spans several open sprints', async () => {
        configureCloudSync();
        mockOrigin({
            ...connectedOrigin,
            issues: [
                connectedOrigin.issues[0],
                { externalKey: 'ACME-9', summary: 'Other board', status: 'To Do', sprintName: 'Sprint 4' },
            ],
        });
        render(<TdahJiraView />);

        await screen.findByText(/Several sprints are open/);
    });

    it('surfaces a persisted lastErrorCode as actionable copy while keeping the connection', async () => {
        configureCloudSync();
        mockOrigin({ ...connectedOrigin, lastErrorCode: 'TDAH_ORIGIN_CREDENTIALS_INVALID' });
        render(<TdahJiraView />);

        const error = await screen.findByTestId('tdah-jira-last-error');
        expect(error.textContent).toContain('The token no longer works');
        // Still connected: the token is not deleted by a failed pull.
        expect(screen.getByText('Connected to https://acme.atlassian.net')).toBeInTheDocument();
    });

    it('names a full day as its own problem, not as a degraded pull', async () => {
        configureCloudSync();
        // The pull reached Jira fine — the day simply had no room for the
        // band. Falling through to the unknown-code copy would send the user
        // to check their network or their token instead of their day.
        mockOrigin({ ...connectedOrigin, lastErrorCode: 'TDAH_ORIGIN_DAY_FULL' });
        render(<TdahJiraView />);

        const error = await screen.findByTestId('tdah-jira-last-error');
        expect(error.textContent).toContain('Your day is already full');
        expect(error.textContent).not.toContain('could not reach Jira');
    });

    it('falls back to the degraded-pull copy for an error code this build does not know', async () => {
        configureCloudSync();
        mockOrigin({ ...connectedOrigin, lastErrorCode: 'TDAH_ORIGIN_SOMETHING_NEW' });
        render(<TdahJiraView />);

        const error = await screen.findByTestId('tdah-jira-last-error');
        expect(error.textContent).toContain('Your personal activities keep running as usual.');
    });

    it('shows the inactive state when the server answers 409 TDAH_ACTIVATE_REQUIRED', async () => {
        configureCloudSync();
        cloudGetJson.mockRejectedValue(new CloudHttpError('activation required', 409));
        render(<TdahJiraView />);

        await screen.findByText('ADHD mode is off — turn it on to connect your work origin.');
        expect(screen.queryByLabelText('API token')).toBeNull();
    });

    it('shows a generic load error with retry on a non-409 failure', async () => {
        configureCloudSync();
        cloudGetJson.mockRejectedValue(new Error('network down'));
        render(<TdahJiraView />);

        await screen.findByText('Could not load your work origin from your server.');

        mockOrigin(disconnectedOrigin);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByText('No work origin connected yet.');
    });

    it('sends the token exactly once, in the PUT body, and clears the field afterwards', async () => {
        configureCloudSync();
        mockOrigin(disconnectedOrigin);
        cloudRequestJson.mockResolvedValue(connectedOrigin);
        render(<TdahJiraView />);
        await screen.findByText('No work origin connected yet.');

        fillCredentials();
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

        await waitFor(() => {
            expect(cloudRequestJson).toHaveBeenCalledWith(
                'PUT',
                ORIGIN_URL,
                {
                    provider: 'jira',
                    siteUrl: 'https://acme.atlassian.net',
                    email: 'me@acme.com',
                    token: JIRA_TOKEN,
                    workStart: '09:00',
                    workEnd: '18:00',
                    pullIntervalMinutes: 120,
                },
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
        });

        // Exactly one write carried the token; the re-read is a GET.
        const tokenCarryingCalls = cloudRequestJson.mock.calls.filter(
            (call) => JSON.stringify(call[2] ?? null).includes(JIRA_TOKEN),
        );
        expect(tokenCarryingCalls).toHaveLength(1);

        await screen.findByText('Connected to https://acme.atlassian.net');
        expect((screen.getByLabelText('API token') as HTMLInputElement).value).toBe('');
        expectTokenAbsentFromDom();
    });

    it('edits the cadence of an existing origin without re-typing the token, omitting the key entirely', async () => {
        configureCloudSync();
        mockOrigin(connectedOrigin);
        cloudRequestJson.mockResolvedValue({ ...connectedOrigin, pullIntervalMinutes: 240 });
        render(<TdahJiraView />);
        await screen.findByText('Connected to https://acme.atlassian.net');

        // Token field untouched: the server carries the sealed secret forward.
        fireEvent.change(screen.getByLabelText('Pull every'), { target: { value: '240' } });
        fireEvent.click(screen.getByRole('button', { name: 'Update connection' }));

        await waitFor(() => expect(cloudRequestJson).toHaveBeenCalled());
        const [method, url, body] = cloudRequestJson.mock.calls[0];
        expect(method).toBe('PUT');
        expect(url).toBe(ORIGIN_URL);
        // Absent, not empty: the parser rejects a present-but-empty token.
        expect(Object.prototype.hasOwnProperty.call(body, 'token')).toBe(false);
        expect(body).toEqual({
            provider: 'jira',
            siteUrl: 'https://acme.atlassian.net',
            email: 'me@acme.com',
            workStart: '09:00',
            workEnd: '18:00',
            pullIntervalMinutes: 240,
        });
    });

    it('still requires a token for a first connection', async () => {
        configureCloudSync();
        mockOrigin(disconnectedOrigin);
        render(<TdahJiraView />);
        await screen.findByText('No work origin connected yet.');

        fireEvent.change(screen.getByLabelText('Jira Cloud site URL'), { target: { value: 'https://acme.atlassian.net' } });
        fireEvent.change(screen.getByLabelText('Jira account email'), { target: { value: 'me@acme.com' } });
        // Everything else is valid; only the token is missing.
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
        expect(cloudRequestJson).not.toHaveBeenCalled();

        // Whitespace is not a token either.
        fireEvent.change(screen.getByLabelText('API token'), { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
        expect(cloudRequestJson).not.toHaveBeenCalled();
    });

    it('never repaints the token even if a response echoes one back', async () => {
        configureCloudSync();
        mockOrigin(disconnectedOrigin);
        // A hostile/buggy server that leaks the secret back must still not put
        // it on screen: no field of the modelled response is ever rendered as
        // a credential, and the token input is state-only.
        cloudRequestJson.mockResolvedValue({ ...connectedOrigin, token: JIRA_TOKEN, secret: JIRA_TOKEN });
        render(<TdahJiraView />);
        await screen.findByText('No work origin connected yet.');

        fillCredentials();
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

        await screen.findByText('Connected to https://acme.atlassian.net');
        expectTokenAbsentFromDom();
    });

    it('refuses to send a non-https or path-bearing site URL, and never reaches the server', async () => {
        configureCloudSync();
        mockOrigin(disconnectedOrigin);
        render(<TdahJiraView />);
        await screen.findByText('No work origin connected yet.');

        fireEvent.change(screen.getByLabelText('Jira Cloud site URL'), { target: { value: 'http://acme.atlassian.net' } });
        fireEvent.change(screen.getByLabelText('Jira account email'), { target: { value: 'me@acme.com' } });
        fireEvent.change(screen.getByLabelText('API token'), { target: { value: JIRA_TOKEN } });

        await screen.findByText('Check the site URL, the email and the token.');
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
        expect(cloudRequestJson).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Jira Cloud site URL'), { target: { value: 'https://acme.atlassian.net/wiki' } });
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
        expect(cloudRequestJson).not.toHaveBeenCalled();
    });

    it('rejects site shapes the server rejects — a port, an IP literal, a private-network host', async () => {
        configureCloudSync();
        mockOrigin(disconnectedOrigin);
        render(<TdahJiraView />);
        await screen.findByText('No work origin connected yet.');

        fireEvent.change(screen.getByLabelText('Jira account email'), { target: { value: 'me@acme.com' } });
        fireEvent.change(screen.getByLabelText('API token'), { target: { value: JIRA_TOKEN } });

        for (const site of [
            'https://acme.atlassian.net:8443',
            'https://10.0.0.7',
            'https://jira.local',
            'https://jira.internal',
            'https://jira.home.arpa',
            'https://jira.localhost',
        ]) {
            fireEvent.change(screen.getByLabelText('Jira Cloud site URL'), { target: { value: site } });
            await screen.findByText('Check the site URL, the email and the token.');
            fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
            expect(cloudRequestJson).not.toHaveBeenCalled();
        }

        // The real thing still passes.
        fireEvent.change(screen.getByLabelText('Jira Cloud site URL'), { target: { value: 'https://acme.atlassian.net' } });
        await waitFor(() => {
            expect(screen.queryByText('Check the site URL, the email and the token.')).toBeNull();
        });
    });

    it('never sends an inverted or cleared working window, and never blames the token for it', async () => {
        configureCloudSync();
        mockOrigin(disconnectedOrigin);
        render(<TdahJiraView />);
        await screen.findByText('No work origin connected yet.');
        fillCredentials();

        // 18:00 → 09:00 is a window the server's own lexicographic gate can
        // never be inside; it earns a 400 that would otherwise be rendered as
        // "The token no longer works".
        fireEvent.change(screen.getByLabelText('To'), { target: { value: '08:00' } });
        await screen.findByTestId('tdah-jira-schedule-error');
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
        expect(cloudRequestJson).not.toHaveBeenCalled();
        expect(screen.queryByTestId('tdah-jira-save-error')).toBeNull();
        expect(screen.queryByText(/The token no longer works/)).toBeNull();

        // A cleared time input is the same class of defect.
        fireEvent.change(screen.getByLabelText('To'), { target: { value: '18:00' } });
        fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } });
        await screen.findByTestId('tdah-jira-schedule-error');
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
        expect(cloudRequestJson).not.toHaveBeenCalled();

        // Restored: the same credentials now go out.
        fireEvent.change(screen.getByLabelText('From'), { target: { value: '09:00' } });
        await waitFor(() => expect(screen.queryByTestId('tdah-jira-schedule-error')).toBeNull());
        cloudRequestJson.mockResolvedValue(connectedOrigin);
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
        await waitFor(() => expect(cloudRequestJson).toHaveBeenCalled());
    });

    it('maps a rejected credential and a missing master key to their own messages', async () => {
        configureCloudSync();
        mockOrigin(disconnectedOrigin);
        cloudRequestJson.mockRejectedValue(new CloudHttpError('invalid', 400));
        render(<TdahJiraView />);
        await screen.findByText('No work origin connected yet.');

        fillCredentials();
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
        const saveError = await screen.findByTestId('tdah-jira-save-error');
        expect(saveError.textContent).toContain('The token no longer works');
        // A rejected save leaves the typed token in the field so the user can
        // fix it — but it is still never echoed by the server.
        expect(cloudGetJson).toHaveBeenCalledTimes(1);

        cloudRequestJson.mockRejectedValue(new CloudHttpError('no key', 503));
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
        await waitFor(() => {
            expect(screen.getByTestId('tdah-jira-save-error').textContent).toContain('no at-rest encryption key');
        });

        cloudRequestJson.mockRejectedValue(new CloudHttpError('unreachable', 502));
        fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
        await waitFor(() => {
            expect(screen.getByTestId('tdah-jira-save-error').textContent).toContain('could not reach Jira');
        });
    });

    it('triggers a manual pull through POST /tdah/origin/sync', async () => {
        configureCloudSync();
        mockOrigin(connectedOrigin);
        cloudRequestJson.mockResolvedValue({ ...connectedOrigin, issues: [], lastErrorCode: null });
        render(<TdahJiraView />);
        await screen.findByText('Connected to https://acme.atlassian.net');

        fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

        await waitFor(() => {
            expect(cloudRequestJson).toHaveBeenCalledWith(
                'POST',
                'https://sync.example.com/v1/tdah/origin/sync',
                undefined,
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
        });
        await screen.findByText('No active sprint — nothing to import.');
    });

    it('never disconnects without an explicit confirmation', async () => {
        configureCloudSync();
        mockOrigin(connectedOrigin);
        render(<TdahJiraView />);
        await screen.findByText('Connected to https://acme.atlassian.net');

        fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('Disconnect the Jira origin?')).toBeInTheDocument();
        expect(within(dialog).getByText(/stays in your History/)).toBeInTheDocument();
        // Opening the confirmation is not the destructive act.
        expect(cloudRequestJson).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(cloudRequestJson).not.toHaveBeenCalled();
    });

    it('deletes the origin only after the confirmation and returns to the disconnected state', async () => {
        configureCloudSync();
        mockOrigin(connectedOrigin);
        cloudRequestJson.mockImplementation(async () => {
            mockOrigin(disconnectedOrigin);
            return { deleted: true };
        });
        render(<TdahJiraView />);
        await screen.findByText('Connected to https://acme.atlassian.net');

        fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

        await waitFor(() => {
            expect(cloudRequestJson).toHaveBeenCalledWith(
                'DELETE',
                ORIGIN_URL,
                undefined,
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
        });
        await screen.findByText('No work origin connected yet.');
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('still offers to revoke the credential once ADHD mode is switched off', async () => {
        configureCloudSync();
        // `GET /v1/tdah/origin` is mode-gated; `DELETE` deliberately is not, so
        // a stored token stays revocable. Hiding the button here would make the
        // server's exemption unreachable and the token unrevokable from the app.
        cloudGetJson.mockRejectedValue(new CloudHttpError('activation required', 409));
        cloudRequestJson.mockResolvedValue({ deleted: true });
        render(<TdahJiraView />);
        await screen.findByText('ADHD mode is off — turn it on to connect your work origin.');

        fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

        await waitFor(() => {
            expect(cloudRequestJson).toHaveBeenCalledWith(
                'DELETE',
                ORIGIN_URL,
                undefined,
                expect.objectContaining({ token: CLOUD_TOKEN }),
            );
        });
    });

    it('still offers to revoke the credential when the status read failed outright', async () => {
        configureCloudSync();
        cloudGetJson.mockRejectedValue(new Error('server down'));
        render(<TdahJiraView />);
        await screen.findByText('Could not load your work origin from your server.');

        expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('drops the connected view when the post-disconnect re-read fails', async () => {
        configureCloudSync();
        mockOrigin(connectedOrigin);
        // The DELETE lands, the follow-up GET does not. Leaving "Connected to
        // {site}" on screen would advertise an origin that no longer exists.
        cloudRequestJson.mockImplementation(async () => {
            cloudGetJson.mockRejectedValue(new Error('read failed after delete'));
            return { deleted: true };
        });
        render(<TdahJiraView />);
        await screen.findByText('Connected to https://acme.atlassian.net');

        fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

        await screen.findByText('No work origin connected yet.');
        expect(screen.queryByText('Connected to https://acme.atlassian.net')).toBeNull();
    });

    it('keeps the confirmation open and reports the failure when the disconnect fails', async () => {
        configureCloudSync();
        mockOrigin(connectedOrigin);
        cloudRequestJson.mockRejectedValue(new Error('server down'));
        render(<TdahJiraView />);
        await screen.findByText('Connected to https://acme.atlassian.net');

        fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

        await screen.findByText('Could not disconnect on your server.');
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('Connected to https://acme.atlassian.net')).toBeInTheDocument();
    });

    it('shows the offline banner over the last loaded status and refetches on reconnect', async () => {
        configureCloudSync();
        mockOrigin(connectedOrigin);
        render(<TdahJiraView />);
        await screen.findByText('Connected to https://acme.atlassian.net');
        expect(screen.queryByText('Offline — showing the last loaded state.')).toBeNull();

        fireEvent(window, new Event('offline'));
        await screen.findByText('Offline — showing the last loaded state.');
        expect(screen.getByText('Connected to https://acme.atlassian.net')).toBeInTheDocument();

        cloudGetJson.mockClear();
        fireEvent(window, new Event('online'));
        await waitFor(() => expect(cloudGetJson).toHaveBeenCalled());
        await waitFor(() => {
            expect(screen.queryByText('Offline — showing the last loaded state.')).toBeNull();
        });
    });

    it('seeds the pull window and cadence from the server, never from a device default', async () => {
        configureCloudSync();
        mockOrigin({ ...connectedOrigin, workStart: '07:30', workEnd: '15:45', pullIntervalMinutes: 240 });
        render(<TdahJiraView />);
        await screen.findByText('Connected to https://acme.atlassian.net');

        expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('07:30');
        expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('15:45');
        expect((screen.getByLabelText('Pull every') as HTMLSelectElement).value).toBe('240');
    });

    it('keeps an off-ladder server interval selectable instead of silently rewriting it', async () => {
        configureCloudSync();
        mockOrigin({ ...connectedOrigin, pullIntervalMinutes: 90 });
        render(<TdahJiraView />);
        await screen.findByText('Connected to https://acme.atlassian.net');

        const select = screen.getByLabelText('Pull every') as HTMLSelectElement;
        expect(select.value).toBe('90');
        expect(Array.from(select.options).map((option) => option.value)).toContain('90');
    });
});

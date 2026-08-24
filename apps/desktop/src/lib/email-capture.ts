import type { Task } from '@mindwtr/core';

import { invokeNative, invokeNativeOr } from './tauri-invoke';

export const DEFAULT_EMAIL_CAPTURE_PORT = 993;
export const DEFAULT_EMAIL_CAPTURE_FOLDER = 'Mindwtr';

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_INITIAL_POLL_DELAY_MS = 20_000;
// A backlog (first configuración with a full folder) is drained in bounded rounds per
// cycle; anything left waits for the next intervalo.
const DEFAULT_MAX_ROUNDS_PER_CYCLE = 10;
const EMAIL_TITLE_FROM_BODY_MAX_CHARS = 100;

export type EmailCaptureConfig = {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    folder: string;
    hasPassword: boolean;
};

export type EmailCaptureMessage = {
    uid: number;
    messageId: string;
    subject: string;
    from: string;
    receivedAt?: string | null;
    bodyText: string;
};

export type EmailCapturePollResult = {
    uidValidity: number;
    messages: EmailCaptureMessage[];
    maxFetchedUid: number;
    hasMore: boolean;
};

export type EmailCaptureErrorKind = 'auth' | 'network' | 'folder' | 'config' | 'other';

export type EmailCaptureErrorInfo = {
    kind: EmailCaptureErrorKind;
    message: string;
};

export type EmailCaptureStatus = {
    lastPollAt: string | null;
    lastImportCount: number;
    lastError: EmailCaptureErrorInfo | null;
    // Terminal errors (bad credentials, broken config) stop polling until the
    // settings are saved again; retrying them on a timer no puede succeed.
    terminal: boolean;
};

const defaultEmailCaptureConfig = (): EmailCaptureConfig => ({
    enabled: false,
    host: '',
    port: DEFAULT_EMAIL_CAPTURE_PORT,
    username: '',
    folder: DEFAULT_EMAIL_CAPTURE_FOLDER,
    hasPassword: false,
});

export async function getEmailCaptureConfig(): Promise<EmailCaptureConfig> {
    return invokeNativeOr(defaultEmailCaptureConfig(), 'get_email_capture_config');
}

export async function setEmailCaptureConfig(
    config: Omit<EmailCaptureConfig, 'hasPassword'>,
    password?: string,
): Promise<EmailCaptureConfig> {
    const result = await invokeNative<EmailCaptureConfig>('set_email_capture_config', {
        config,
        password: password?.trim() ? password.trim() : undefined,
    });
    notifyEmailCaptureConfigChanged();
    return result;
}

const isErrorKind = (value: unknown): value is EmailCaptureErrorKind => (
    value === 'auth' || value === 'network' || value === 'folder' || value === 'config' || value === 'other'
);

export const toEmailCaptureError = (error: unknown): EmailCaptureErrorInfo => {
    if (error && typeof error === 'object') {
        const candidate = error as { kind?: unknown; message?: unknown };
        if (typeof candidate.message === 'string') {
            return {
                kind: isErrorKind(candidate.kind) ? candidate.kind : 'other',
                message: candidate.message,
            };
        }
    }
    if (error instanceof Error) return { kind: 'other', message: error.message };
    return { kind: 'other', message: String(error ?? 'Unknown error') };
};

export const isTerminalEmailCaptureError = (info: EmailCaptureErrorInfo): boolean => (
    info.kind === 'auth' || info.kind === 'config' || info.kind === 'folder'
);

export const buildTaskFromEmailMessage = (
    message: EmailCaptureMessage,
): { title: string; description?: string } => {
    const subject = message.subject.trim();
    const body = message.bodyText.trim();
    const firstBodyLine = body.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? '';
    const title = subject
        || (firstBodyLine.length > EMAIL_TITLE_FROM_BODY_MAX_CHARS
            ? `${firstBodyLine.slice(0, EMAIL_TITLE_FROM_BODY_MAX_CHARS)}…`
            : firstBodyLine)
        || message.from.trim()
        || 'Email';
    const from = message.from.trim();
    const parts: string[] = [];
    if (from) parts.push(`From: ${from}`);
    if (body) parts.push(body);
    const description = parts.join('\n\n');
    return description ? { title, description } : { title };
};

type EmailCaptureStatusListener = (status: EmailCaptureStatus) => void;

const initialStatus = (): EmailCaptureStatus => ({
    lastPollAt: null,
    lastImportCount: 0,
    lastError: null,
    terminal: false,
});

let currentStatus: EmailCaptureStatus = initialStatus();
const statusListeners = new Set<EmailCaptureStatusListener>();

const publishStatus = (status: EmailCaptureStatus) => {
    currentStatus = status;
    statusListeners.forEach((listener) => listener(status));
};

export const getEmailCaptureStatus = (): EmailCaptureStatus => currentStatus;

export const subscribeEmailCaptureStatus = (listener: EmailCaptureStatusListener): (() => void) => {
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
};

let activeController: EmailCaptureController | null = null;

/** Clears a terminal error and schedules a prompt re-poll after settings change. */
export const notifyEmailCaptureConfigChanged = () => {
    publishStatus({ ...currentStatus, lastError: null, terminal: false });
    activeController?.handleConfigChanged();
};

export type EmailCaptureController = {
    start: () => void;
    pollNow: () => Promise<void>;
    handleConfigChanged: () => void;
    dispose: () => void;
};

type AddTasksResult = { success: boolean; error?: string };

type EmailCaptureControllerOptions = {
    getConfig?: () => Promise<EmailCaptureConfig>;
    poll?: () => Promise<EmailCapturePollResult>;
    commit?: (args: { uidValidity: number; lastSeenUid: number; messageIds: string[] }) => Promise<void>;
    addTasks: (items: Array<{ title: string; initialProps?: Partial<Task> }>) => Promise<AddTasksResult>;
    flushPendingSave: () => Promise<void>;
    reportError: (label: string, error: unknown) => void;
    logInfo?: (message: string, extra?: Record<string, string>) => void;
    onTerminalError?: (error: EmailCaptureErrorInfo) => void;
    onStatusChange?: (status: EmailCaptureStatus) => void;
    now?: () => Date;
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
    intervalMs?: number;
    initialDelayMs?: number;
    maxRoundsPerCycle?: number;
};

export const createEmailCaptureController = (
    options: EmailCaptureControllerOptions,
): EmailCaptureController => {
    const getConfig = options.getConfig ?? getEmailCaptureConfig;
    const poll = options.poll ?? (() => invokeNative<EmailCapturePollResult>('email_capture_poll'));
    const commit = options.commit ?? ((args: { uidValidity: number; lastSeenUid: number; messageIds: string[] }) =>
        invokeNative<void>('email_capture_commit', args));
    const now = options.now ?? (() => new Date());
    const setTimer = options.setTimer ?? setTimeout;
    const clearTimer = options.clearTimer ?? clearTimeout;
    const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_POLL_DELAY_MS;
    const maxRoundsPerCycle = options.maxRoundsPerCycle ?? DEFAULT_MAX_ROUNDS_PER_CYCLE;
    const onStatusChange = options.onStatusChange ?? publishStatus;

    let status: EmailCaptureStatus = initialStatus();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let disposed = false;

    const updateStatus = (updates: Partial<EmailCaptureStatus>) => {
        status = { ...status, ...updates };
        onStatusChange(status);
    };

    const clearTimerIfSet = () => {
        if (!timer) return;
        clearTimer(timer);
        timer = null;
    };

    const schedule = (delayMs: number) => {
        clearTimerIfSet();
        if (disposed) return;
        timer = setTimer(() => {
            timer = null;
            void runCycle().catch((error) => options.reportError('Email capture failed', error));
        }, delayMs);
    };

    const runCycle = async (): Promise<void> => {
        if (disposed || running) return;
        running = true;
        try {
            if (status.terminal) return;
            const config = await getConfig();
            if (!config.enabled) return;

            let imported = 0;
            for (let round = 0; round < maxRoundsPerCycle; round += 1) {
                const result = await poll();
                if (result.messages.length > 0) {
                    const items = result.messages.map((message) => {
                        const { title, description } = buildTaskFromEmailMessage(message);
                        return {
                            title,
                            initialProps: {
                                status: 'inbox',
                                ...(description ? { description } : {}),
                            } as Partial<Task>,
                        };
                    });
                    const added = await options.addTasks(items);
                    if (!added.success) {
                        throw new Error(added.error || 'Failed to add captured email tasks');
                    }
                    // The IMAP watermark only advances after the tasks are
                    // durably persisted; a crash in between re-imports mail
                    // en lugar de silently dropping it.
                    await options.flushPendingSave();
                    imported += result.messages.length;
                }
                if (result.maxFetchedUid > 0) {
                    await commit({
                        uidValidity: result.uidValidity,
                        lastSeenUid: result.maxFetchedUid,
                        messageIds: result.messages.map((message) => message.messageId),
                    });
                }
                if (!result.hasMore) break;
            }

            if (imported > 0) {
                options.logInfo?.('Email capture imported messages', { count: String(imported) });
            }
            updateStatus({
                lastPollAt: now().toISOString(),
                lastImportCount: imported,
                lastError: null,
                terminal: false,
            });
        } catch (error) {
            const info = toEmailCaptureError(error);
            const terminal = isTerminalEmailCaptureError(info);
            updateStatus({
                lastPollAt: now().toISOString(),
                lastError: info,
                terminal,
            });
            if (terminal) {
                options.onTerminalError?.(info);
            }
            options.logInfo?.('Email capture poll failed', { kind: info.kind, terminal: String(terminal) });
        } finally {
            running = false;
            if (!disposed && !status.terminal) {
                schedule(intervalMs);
            }
        }
    };

    return {
        start: () => {
            if (disposed) return;
            schedule(initialDelayMs);
        },
        pollNow: () => runCycle(),
        handleConfigChanged: () => {
            if (disposed) return;
            updateStatus({ lastError: null, terminal: false });
            schedule(1_000);
        },
        dispose: () => {
            disposed = true;
            clearTimerIfSet();
        },
    };
};

export const registerEmailCaptureController = (controller: EmailCaptureController | null) => {
    activeController = controller;
};

export const pollEmailCaptureNow = async (): Promise<void> => {
    await activeController?.pollNow();
};

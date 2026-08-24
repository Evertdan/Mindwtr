export const FEEDBACK_CATEGORIES = ['bug', 'feature', 'other'] as const;

export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number];

export type FeedbackMetadata = {
    appVersion?: string;
    platform?: string;
    os?: string;
    installChannel?: string;
    locale?: string;
    build?: string;
};

export type FeedbackDiagnostics = {
    logs?: string;
};

export type FeedbackSubmissionInput = {
    category: FeedbackCategory;
    message: string;
    email?: string;
    metadata?: FeedbackMetadata;
    diagnostics?: FeedbackDiagnostics;
};

export type FeedbackSubmissionPayload = {
    category: FeedbackCategory;
    message: string;
    email?: string;
    metadata: FeedbackMetadata;
    diagnostics?: FeedbackDiagnostics;
    submittedAt: string;
};

export type FeedbackValidationError =
    | 'message_required'
    | 'message_too_long'
    | 'invalid_email'
    | 'invalid_category';

const MAX_FEEDBACK_MESSAGE_LENGTH = 4_000;
const MAX_FEEDBACK_LOG_LENGTH = 20_000;

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
    return typeof value === 'string' && FEEDBACK_CATEGORIES.includes(value as FeedbackCategory);
}

export function normalizeFeedbackEmail(value: string | undefined): string | undefined {
    const trimmed = String(value ?? '').trim();
    return trimmed || undefined;
}

export function isValidFeedbackEmail(value: string | undefined): boolean {
    const email = normalizeFeedbackEmail(value);
    if (!email) return true;
    if (email.length > 254) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeMetadata(metadata: FeedbackMetadata | undefined): FeedbackMetadata {
    const result: FeedbackMetadata = {};
    const keys: Array<keyof FeedbackMetadata> = [
        'appVersion',
        'platform',
        'os',
        'installChannel',
        'locale',
        'build',
    ];
    for (const key of keys) {
        const value = metadata?.[key];
        if (typeof value !== 'string') {
            continue;
        }
        const trimmed = value.trim();
        if (!trimmed) {
            continue;
        }
        result[key] = trimmed.slice(0, 180);
    }
    return result;
}

function normalizeDiagnostics(diagnostics: FeedbackDiagnostics | undefined): FeedbackDiagnostics | undefined {
    const logs = String(diagnostics?.logs ?? '').trim();
    if (!logs) return undefined;
    return {
        logs: logs.slice(-MAX_FEEDBACK_LOG_LENGTH),
    };
}

export function buildFeedbackSubmissionPayload(
    input: FeedbackSubmissionInput
): { ok: true; payload: FeedbackSubmissionPayload } | { ok: false; error: FeedbackValidationError } {
    if (!isFeedbackCategory(input.category)) {
        return { ok: false, error: 'invalid_category' };
    }

    const message = String(input.message ?? '').trim();
    if (!message) {
        return { ok: false, error: 'message_required' };
    }
    if (message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
        return { ok: false, error: 'message_too_long' };
    }

    const email = normalizeFeedbackEmail(input.email);
    if (!isValidFeedbackEmail(email)) {
        return { ok: false, error: 'invalid_email' };
    }

    const diagnostics = normalizeDiagnostics(input.diagnostics);

    return {
        ok: true,
        payload: {
            category: input.category,
            message,
            ...(email ? { email } : {}),
            metadata: normalizeMetadata(input.metadata),
            ...(diagnostics ? { diagnostics } : {}),
            submittedAt: new Date().toISOString(),
        },
    };
}

export async function submitFeedbackSubmission(
    endpointUrl: string,
    input: FeedbackSubmissionInput,
    fetcher: typeof fetch = globalThis.fetch
): Promise<void> {
    const endpoint = endpointUrl.trim();
    if (!endpoint) {
        throw new Error('feedback_not_configured');
    }

    const built = buildFeedbackSubmissionPayload(input);
    if (!built.ok) {
        throw new Error(built.error);
    }

    const response = await fetcher(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(built.payload),
    });

    if (!response.ok) {
        throw new Error(`feedback_failed_${response.status}`);
    }
}

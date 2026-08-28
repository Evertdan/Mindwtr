import type { Area, Project, Section, Task } from '@mindwtr/core';
// Relative path, not '@mindwtr/core/task-sync-schema': this file is imported by
// scripts/check-synced-field-parity.ts, which the native-schema CI job runs without
// `bun install` (see BEARER_TOKEN_PATTERN below), so a workspace-package import
// cannot resolve there. A plain relative path always resolves.
import { TASK_SYNC_FIELD_SCHEMA } from '../../../packages/core/src/task-sync-schema';
import { PROJECT_SYNC_FIELD_SCHEMA } from '../../../packages/core/src/project-sync-schema';
import { SECTION_SYNC_FIELD_SCHEMA } from '../../../packages/core/src/section-sync-schema';
import {
    AREA_NAME_MAX_LENGTH as SHARED_AREA_NAME_MAX_LENGTH,
    LIST_PAGE_MAX_LIMIT as SHARED_LIST_PAGE_MAX_LIMIT,
} from '../../../packages/core/src/shared-api-write-limits';

type Flags = Record<string, string | boolean>;
type LogLevel = 'info' | 'warn' | 'error';
type LogEntry = {
    ts: string;
    level: LogLevel;
    scope: 'cloud';
    message: string;
    context?: Record<string, unknown>;
};

export type CloudFailureContext = {
    failureClass: 'cache' | 'filesystem' | 'runtime' | 'validation';
    failureCode:
        | 'attachment_io_failed'
        | 'cache_clone_failed'
        | 'data_dir_not_writable'
        | 'permission_denied'
        | 'request_failed'
        | 'server_start_failed'
        | 'stored_data_invalid'
        | 'stored_data_invalid_json'
        | 'tdah_activity_trigger_onfire_failed'
        | 'tdah_activity_trigger_tick_crashed'
        | 'tdah_activity_trigger_tick_failed'
        | 'tdah_nightly_tick_crashed'
        | 'tdah_nightly_tick_failed'
        // Story 3.1: a namespace's ritual_notified_date mark already
        // committed successfully — only the WS push of the resulting
        // ritual-invitation event itself failed (e.g. a closing socket).
        // Distinct from 'tdah_nightly_tick_failed' (a genuine namespace
        // read/write failure) the same way 'tdah_activity_trigger_onfire_failed'
        // is distinct from 'tdah_activity_trigger_tick_failed' above.
        | 'tdah_ritual_invitation_push_failed'
        // Story 4.1: one namespace's Origen pull failed this tick — a storage
        // throw, a missing at-rest key, bad credentials, or an unreachable
        // site. Deliberately its own code rather than the generic
        // 'request_failed': no inbound request is involved, exactly the
        // background-job/inbound-request split 'tdah_nightly_tick_failed'
        // already draws. Never carries the token, the site host or the
        // account email — only `.code`, like every other failure context here.
        | 'tdah_origin_pull_failed'
        // Story 4.1: `runWorkOriginPullTick` itself threw despite its own
        // never-throws contract — the backstop, mirroring
        // 'tdah_activity_trigger_tick_crashed'.
        | 'tdah_origin_pull_tick_crashed';
    // S10: ONLY ever assign a bare fs/sqlite error code here (e.g. 'ENOENT', 'EACCES',
    // 'SQLITE_BUSY') — never error.message or a path. Privacy ratchet 9e1cd93b7 covers
    // this field too: logError does not sanitize it, the caller must.
    failureErrno?: string;
    requestId?: string;
};

export const CLOUD_LOG_MESSAGES = [
    'Failed to clone cloud app data cache entry',
    'Failed to start server',
    'MINDWTR_CLOUD_ALLOW_ANY_TOKEN is enabled. Prefer MINDWTR_CLOUD_AUTH_TOKENS for stronger access control.',
    'MINDWTR_CLOUD_TOKEN is deprecated; use MINDWTR_CLOUD_AUTH_TOKENS instead',
    'MINDWTR_CLOUD_TRUST_PROXY_HEADERS is enabled but no trusted proxy IPs are configured; forwarded IP headers will be ignored',
    'Stored cloud data failed validation',
    'Stored cloud data failed validation before attachment GC',
    'cloud data directory is not writable',
    'cloud data directory ready',
    'cloud server listening',
    'failed to prune some orphaned calendar feed sidecars',
    'pruned orphaned calendar feed sidecars',
    'request completed',
    'request failed',
    'shutdown signal received',
    'tdah activity trigger crashed',
    'tdah activity trigger fired',
    'tdah activity trigger namespace failed',
    'tdah activity trigger onFire failed',
    'tdah nightly ritual invitation push failed',
    'tdah nightly trigger crashed',
    'tdah nightly trigger fired',
    'tdah nightly trigger namespace failed',
    'tdah origin pull crashed',
    'tdah origin pull fired',
    'tdah origin pull namespace failed',
    'token auth allowlist enabled',
    'token namespace mode enabled by explicit opt-in',
    'trusting proxy IP headers for auth failure rate limiting',
] as const;

type CloudLogMessage = typeof CLOUD_LOG_MESSAGES[number];
type CloudOperationalLogContext = Partial<Record<
    | 'allowedTokens'
    | 'count'
    // Story 1.5 (tdah nightly scheduler): 'date', 'failedCount', 'firedCount',
    // 'generatedCount', 'limboCount', 'namespaceCount' and 'skippedCount' back
    // the 'tdah nightly trigger fired' audit line's context
    // (TdahNightlyTickSummary) — counts and the tick's own reference date
    // only, deliberately never a namespace key (AGENTS.md's `.code`-only
    // rule).
    | 'date'
    | 'elapsedMs'
    | 'failedCount'
    | 'firedCount'
    // Story 2.2 (tdah activity-trigger tick): 'firedNamespaceCount' and
    // 'firedEventCount' back the 'tdah activity trigger fired' audit line's
    // context (TdahActivityTriggerTickSummary) — same counts-only,
    // never-a-namespace-key discipline as the nightly tick's own context above.
    | 'firedNamespaceCount'
    | 'firedEventCount'
    // Story 4.2 (N-04, the Jira work band): 'firedWorkBandCount' joins the
    // 'tdah activity trigger fired' audit line's context. Counted separately
    // from 'firedEventCount' on purpose — folding N-04 into the N-01/N-02 total
    // would hide exactly the double-notification regression this story fixed.
    // Still a bare count: never a namespace key, an issue key or a band title.
    | 'firedWorkBandCount'
    | 'generatedCount'
    | 'hint'
    // Story 4.1 (tdah Origen pull tick): 'itemCount' and 'syncedCount' back
    // the 'tdah origin pull fired' audit line's context
    // (TdahOriginPullTickSummary), alongside the shared 'date'/'namespaceCount'/
    // 'skippedCount'/'failedCount' above. Counts only — never a namespace key,
    // never a site host, never an issue key or summary.
    | 'itemCount'
    | 'limboCount'
    | 'maxNamespaces'
    | 'method'
    | 'namespaceCount'
    | 'port'
    | 'requestId'
    // Story 3.1: 'ritualPushFailedCount' backs the 'tdah nightly trigger
    // fired' audit line's context alongside the story 1.5 fields above — the
    // count of namespaces whose ritual_notified_date mark committed but
    // whose WS push itself threw (see TdahNightlyTickSummary).
    | 'ritualPushFailedCount'
    | 'route'
    | 'signal'
    | 'skippedCount'
    | 'status'
    | 'syncedCount'
    | 'trustedProxyIps',
    string | number
>>;

const writeLog = (entry: LogEntry) => {
    const line = `${JSON.stringify(entry)}\n`;
    if (entry.level === 'error') {
        process.stderr.write(line);
    } else {
        process.stdout.write(line);
    }
};

export const normalizeRevision = (value?: number): number => (
    typeof value === 'number' && Number.isFinite(value) ? value : 0
);

export const logInfo = (message: CloudLogMessage, context?: CloudOperationalLogContext) => {
    writeLog({ ts: new Date().toISOString(), level: 'info', scope: 'cloud', message, context });
};

export const logWarn = (message: CloudLogMessage, context?: CloudOperationalLogContext) => {
    writeLog({ ts: new Date().toISOString(), level: 'warn', scope: 'cloud', message, context });
};

export const logFailureWarn = (message: CloudLogMessage, context: CloudFailureContext) => {
    writeLog({ ts: new Date().toISOString(), level: 'warn', scope: 'cloud', message, context });
};

export const logError = (message: CloudLogMessage, context: CloudFailureContext) => {
    writeLog({ ts: new Date().toISOString(), level: 'error', scope: 'cloud', message, context });
};

const configuredCorsOrigin = (process.env.MINDWTR_CLOUD_CORS_ORIGIN || '').trim();
if (configuredCorsOrigin === '*') {
    throw new Error('MINDWTR_CLOUD_CORS_ORIGIN cannot be "*" in production. Set an explicit origin.');
}
const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
const isProductionEnv = nodeEnv === 'production';
if (!configuredCorsOrigin && isProductionEnv) {
    throw new Error('MINDWTR_CLOUD_CORS_ORIGIN must be set in production.');
}

export const corsOrigin = configuredCorsOrigin || 'http://localhost:5173';
const maxTaskTitleLengthValue = Number(process.env.MINDWTR_CLOUD_MAX_TASK_TITLE_LENGTH || 500);
export const MAX_TASK_TITLE_LENGTH = Number.isFinite(maxTaskTitleLengthValue) && maxTaskTitleLengthValue > 0
    ? Math.floor(maxTaskTitleLengthValue)
    : 500;
const maxTaskQuickAddLengthValue = Number(process.env.MINDWTR_CLOUD_MAX_TASK_QUICK_ADD_LENGTH || 2000);
export const MAX_TASK_QUICK_ADD_LENGTH = Number.isFinite(maxTaskQuickAddLengthValue) && maxTaskQuickAddLengthValue > 0
    ? Math.floor(maxTaskQuickAddLengthValue)
    : 2000;
// Aligned with apps/mcp-server's area-name cap (packages/core/src/shared-api-write-limits.ts)
// — this used to reuse MAX_TASK_TITLE_LENGTH (500), letting a cloud-created area name run
// 2.5x longer than the same call through MCP or the desktop/mobile apps for no reason.
const maxAreaNameLengthValue = Number(process.env.MINDWTR_CLOUD_MAX_AREA_NAME_LENGTH || SHARED_AREA_NAME_MAX_LENGTH);
export const MAX_AREA_NAME_LENGTH = Number.isFinite(maxAreaNameLengthValue) && maxAreaNameLengthValue > 0
    ? Math.floor(maxAreaNameLengthValue)
    : SHARED_AREA_NAME_MAX_LENGTH;
const maxItemsPerCollectionValue = Number(process.env.MINDWTR_CLOUD_MAX_ITEMS_PER_COLLECTION || 50_000);
export const MAX_ITEMS_PER_COLLECTION = Number.isFinite(maxItemsPerCollectionValue) && maxItemsPerCollectionValue > 0
    ? Math.floor(maxItemsPerCollectionValue)
    : 50_000;
const listDefaultLimitValue = Number(process.env.MINDWTR_CLOUD_LIST_DEFAULT_LIMIT || 200);
export const LIST_DEFAULT_LIMIT = Number.isFinite(listDefaultLimitValue) && listDefaultLimitValue > 0
    ? Math.floor(listDefaultLimitValue)
    : 200;
// Aligned with apps/mcp-server's page-size cap (packages/core/src/shared-api-write-limits.ts)
// — this used to default to 1000 while MCP capped the same kind of request at 500.
const listMaxLimitValue = Number(process.env.MINDWTR_CLOUD_LIST_MAX_LIMIT || SHARED_LIST_PAGE_MAX_LIMIT);
export const LIST_MAX_LIMIT = Number.isFinite(listMaxLimitValue) && listMaxLimitValue > 0
    ? Math.floor(listMaxLimitValue)
    : SHARED_LIST_PAGE_MAX_LIMIT;
const rateLimitMaxKeysValue = Number(process.env.MINDWTR_CLOUD_RATE_MAX_KEYS || 10_000);
export const RATE_LIMIT_MAX_KEYS = Number.isFinite(rateLimitMaxKeysValue) && rateLimitMaxKeysValue > 0
    ? Math.floor(rateLimitMaxKeysValue)
    : 10_000;
export const MAX_PENDING_REMOTE_DELETE_ATTEMPTS = 100;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const authFailureRateMaxValue = Number(process.env.MINDWTR_CLOUD_AUTH_FAILURE_RATE_MAX || 30);
export const AUTH_FAILURE_RATE_MAX = Number.isFinite(authFailureRateMaxValue) && authFailureRateMaxValue > 0
    ? Math.floor(authFailureRateMaxValue)
    : 30;
export const ATTACHMENT_PATH_ALLOWLIST = /^[a-zA-Z0-9._/-]+$/;
// Real cloudKeys reaching this server are content-addressed and short: buildCloudKey
// (packages/core/src/attachment-paths.ts) emits `attachments/<uuid>[.ext]` — 2 segments,
// ~52 chars. (The CloudKit backend's `cloudkit:<uuid>` keys never reach this endpoint at
// all — ATTACHMENT_PATH_ALLOWLIST above has no `:`, so those requests go straight to
// Apple's CloudKit and are rejected here if ever attempted.) These bounds give an 8x/10x
// margin over that 2-segment/~52-char shape while still rejecting the thousands-of-segments
// paths that make ensureDirectoryWithinRoot's per-segment walk O(depth^2) on an authenticated PUT.
export const ATTACHMENT_PATH_MAX_SEGMENTS = 16;
export const ATTACHMENT_PATH_MAX_LENGTH = 512;
export const CLOUD_DATA_LOCK_WAIT_TIMEOUT_MS = 60_000;
// Generated from TASK_SYNC_FIELD_SCHEMA's cloudWrite flag (task-sync-schema.ts): a field
// with cloudWrite 'create-patch' is writable both at task creation and via patch; 'patch'
// only via patch (title/order/orderNum/boardOrder/focusOrder — set at creation through
// their own dedicated params, not this generic prop bag); 'managed' is never
// client-writable. server-config.test.ts pins both sets to the schema with a snapshot
// test, and scripts/check-synced-field-parity.ts checks CLOUD_TASK_PATCH_ALLOWED_PROP_KEYS
// is a superset of the schema's writable fields.
export const CLOUD_TASK_CREATION_ALLOWED_PROP_KEYS = new Set<keyof Task>(
    TASK_SYNC_FIELD_SCHEMA
        .filter((field) => field.cloudWrite === 'create-patch')
        .map((field) => field.name),
);
export const CLOUD_TASK_PATCH_ALLOWED_PROP_KEYS = new Set<keyof Task>(
    TASK_SYNC_FIELD_SCHEMA
        .filter((field) => field.cloudWrite === 'create-patch' || field.cloudWrite === 'patch')
        .map((field) => field.name),
);
// Generated from PROJECT_SYNC_FIELD_SCHEMA / SECTION_SYNC_FIELD_SCHEMA's cloudWrite flag —
// same generation story as the task allowlists above. server-config.test.ts pins both pairs
// to their schema with a snapshot test.
export const CLOUD_PROJECT_CREATION_ALLOWED_PROP_KEYS = new Set<keyof Project>(
    PROJECT_SYNC_FIELD_SCHEMA
        .filter((field) => field.cloudWrite === 'create-patch')
        .map((field) => field.name),
);
export const CLOUD_PROJECT_PATCH_ALLOWED_PROP_KEYS = new Set<keyof Project>(
    PROJECT_SYNC_FIELD_SCHEMA
        .filter((field) => field.cloudWrite === 'create-patch' || field.cloudWrite === 'patch')
        .map((field) => field.name),
);
export const CLOUD_SECTION_CREATION_ALLOWED_PROP_KEYS = new Set<keyof Section>(
    SECTION_SYNC_FIELD_SCHEMA
        .filter((field) => field.cloudWrite === 'create-patch')
        .map((field) => field.name),
);
export const CLOUD_SECTION_PATCH_ALLOWED_PROP_KEYS = new Set<keyof Section>(
    SECTION_SYNC_FIELD_SCHEMA
        .filter((field) => field.cloudWrite === 'create-patch' || field.cloudWrite === 'patch')
        .map((field) => field.name),
);
export const CLOUD_AREA_CREATION_ALLOWED_PROP_KEYS = new Set<keyof Area>([
    'color',
    'icon',
    'order',
]);
export const CLOUD_AREA_PATCH_ALLOWED_PROP_KEYS = new Set<keyof Area>([
    'name',
    ...CLOUD_AREA_CREATION_ALLOWED_PROP_KEYS,
]);
export const CLOUD_API_REV_BY = 'cloud';
// Must stay a literal: this file is imported by scripts/check-synced-field-parity.ts,
// which CI runs without installing workspace deps, so a runtime @mindwtr/core import
// cannot resolve there. A test in server.test.ts pins this to core's
// CLOUD_SYNC_TOKEN_PATTERN so client and server cannot drift.
export const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{20,512}$/;

export function parseArgs(argv: string[]) {
    const flags: Flags = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg || !arg.startsWith('--')) continue;
        const keyValue = arg.slice(2);
        const equalsIndex = keyValue.indexOf('=');
        if (equalsIndex > 0) {
            const key = keyValue.slice(0, equalsIndex);
            flags[key] = keyValue.slice(equalsIndex + 1);
            continue;
        }
        const key = keyValue;
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
            flags[key] = next;
            i += 1;
        } else {
            flags[key] = true;
        }
    }
    return flags;
}

export function parsePagination(searchParams: URLSearchParams): { limit: number; offset: number } | { error: string } {
    const limitRaw = searchParams.get('limit');
    const offsetRaw = searchParams.get('offset');
    const parsedLimit = limitRaw == null ? LIST_DEFAULT_LIMIT : Number(limitRaw);
    const parsedOffset = offsetRaw == null ? 0 : Number(offsetRaw);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        return { error: 'Invalid limit' };
    }
    if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
        return { error: 'Invalid offset' };
    }
    const limit = Math.min(LIST_MAX_LIMIT, Math.floor(parsedLimit));
    const offset = Math.floor(parsedOffset);
    return { limit, offset };
}

const applyCorsHeaders = (headers: Headers): Headers => {
    headers.set('Access-Control-Allow-Origin', corsOrigin);
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Allow-Methods', 'GET,HEAD,PUT,POST,PATCH,DELETE,OPTIONS');
    headers.set('Access-Control-Expose-Headers', 'ETag, Last-Modified, Content-Length');
    return headers;
};

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    applyCorsHeaders(headers);
    return new Response(JSON.stringify(body, null, 2), { ...init, headers });
}

export function preflightResponse(init: ResponseInit = {}) {
    const headers = applyCorsHeaders(new Headers(init.headers));
    return new Response(null, { status: 204, ...init, headers });
}

export function errorResponse(message: string, status = 400) {
    return jsonResponse({ error: message }, { status });
}

export function createInternalServerErrorResponse(message: string, requestId: string): Response {
    return jsonResponse(
        { error: message, requestId },
        { status: 500, headers: { 'X-Request-Id': requestId } },
    );
}

/**
 * HTTP surface of the TDAH module: GET/PUT `/v1/tdah/profile`,
 * POST `/v1/tdah/activate`, the `/v1/tdah/routines*` Rutina CRUD (story 1.4)
 * — GET/POST `/v1/tdah/routines`, GET/PUT/DELETE `/v1/tdah/routines/:id`,
 * GET `/v1/tdah/routines/:id/preview`, and GET `/v1/tdah/routines/conflicts`
 * — and the "Hoy" surface (story 1.6): GET `/v1/tdah/day`,
 * POST `/v1/tdah/day/activities`,
 * POST `/v1/tdah/activities/:id/{start|complete|miss}`, and (story 3.2, T-05)
 * POST `/v1/tdah/activities/:id/decide` — plus (story 3.4, T-08) El Limbo:
 * GET `/v1/tdah/limbo` and POST `/v1/tdah/limbo/decide` (the same decisions
 * as `/activities/:id/decide`, minus `'undated'`, applied to a whole set of
 * ids atomically) — plus (story 3.5, T-09/T-10) GET `/v1/tdah/history` and
 * GET `/v1/tdah/metrics`, both computed fresh at request time over the same
 * `missed`/`limbo`/`completed` candidate set (AD-13: no precomputed
 * aggregate) — plus (story 4.1, T-13) the Origen de trabajo:
 * GET/PUT/DELETE `/v1/tdah/origin` and POST `/v1/tdah/origin/sync`, the only
 * routes in this module that talk to a third party (read-only, GET-only, see
 * `jira-origin.ts`) and the only ones that ever receive a secret — which is
 * sealed at rest and never appears in any response, log or subsequent read.
 * — plus (story 4.3, T-12) el DND: GET/PUT `/v1/tdah/dnd`, POST
 * `/v1/tdah/dnd/windows`, PUT/DELETE `/v1/tdah/dnd/windows/:id` and PUT
 * `/v1/tdah/dnd/calendar` (the phone's raw UTC observation, converted and
 * clipped server-side — no client ever decides what gets silenced, AD-8).
 * PUT `/tdah/profile`
 * only ever sets `mode:'off'` or updates timeZone/ritualHour on an existing
 * profile — POST /activate is the only way to set `mode:'on'`, and PUT
 * rejects a `mode:'on'` body outright with `TDAH_ACTIVATE_REQUIRED`.
 *
 * Mounted additively by server.ts under its own prefix (ADR 0026) — every
 * request arrives already authenticated, rate-limited and namespace-admitted
 * via `withNamespace`, with the caller's identity being `ctx.key`. Error
 * bodies are always `{error: {code: 'TDAH_…'}}`; raw fs/sqlite `.message`
 * values never reach a response (cloud logging/privacy policy).
 */
import { getFsErrorCode, isBodyReadError, readJsonBody } from '../server-storage';
import { jsonResponse, logError } from '../server-config';
import {
    activateTdahProfile,
    computeApplicabilityPreview,
    computeRollingRange,
    computeRoutineConflicts,
    confirmMorning,
    createManualActivity,
    createManualActivityForTomorrow,
    createRoutine,
    decideActivity,
    decideLimboBatch,
    deleteRoutine,
    formatDateInTimeZone,
    getHistory,
    getLimboActivities,
    getMetrics,
    getRoutineWithBlocks,
    getTodayDayPlan,
    getTomorrowDayPlan,
    isValidDateString,
    isValidMonthString,
    listRoutinesWithBlocks,
    readTdahProfile,
    TDAH_BLOCK_DURATION_MAX_MINUTES,
    TDAH_DAY_MAX_ACTIVITIES,
    TDAH_ROUTINE_TITLE_MAX_LENGTH,
    transitionActivityState,
    type TdahCreateManualActivityInput,
    updateRoutine,
    upsertTdahProfile,
    deleteWorkOrigin,
    readWorkOriginStatus,
    upsertWorkOrigin,
    TDAH_WORK_ORIGIN_DEFAULT_PULL_INTERVAL_MINUTES,
    TDAH_WORK_ORIGIN_DEFAULT_WORK_END,
    TDAH_WORK_ORIGIN_DEFAULT_WORK_START,
    TDAH_WORK_ORIGIN_MAX_EMAIL_LENGTH,
    TDAH_WORK_ORIGIN_MAX_PULL_INTERVAL_MINUTES,
    TDAH_WORK_ORIGIN_MAX_TOKEN_LENGTH,
    TDAH_WORK_ORIGIN_MIN_PULL_INTERVAL_MINUTES,
} from './storage';
import {
    createDndWindow,
    deleteDndWindow,
    readDndState,
    replaceDndCalendarWindows,
    updateDndWindow,
    upsertDndSettings,
} from './storage';
import {
    materializeCalendarWindows,
    parseCalendarSyncInput,
    parseDndSettingsInput,
    parseManualWindowInput,
} from './dnd';
import { resolveOriginEncryptionKey, sealOriginSecret } from './origin-crypto';
import { resolveWorkOriginProvider, type WorkOriginFetch } from './work-origin';
import { runNamespaceWorkOriginPull } from './origin-pull';
import {
    isTdahMode,
    TDAH_ACTIVITY_ORIGINS,
    TDAH_ERRORS,
    type TdahActivateResponse,
    type TdahActivityDecideRequest,
    type TdahActivityOrigin,
    type TdahActivityResponse,
    type TdahActivityTransitionAction,
    type TdahConfirmMorningRequest,
    type TdahDayResponse,
    type TdahDndResponse,
    type TdahErrorCode,
    type TdahHistoryResponse,
    type TdahLimboDecideBatchRequest,
    type TdahLimboDecideBatchResponse,
    type TdahLimboResponse,
    type TdahMetricsResponse,
    type TdahMode,
    type TdahProfileResponse,
    type TdahRoutinePattern,
    type TdahRoutineBlockInput,
    type TdahRoutineInput,
    isTdahWorkOriginProvider,
    type TdahWorkOriginResponse,
    type TdahWorkOriginUpsertRequest,
} from './types';

export const TDAH_PATH_PREFIX = '/v1/tdah';
const TDAH_PROFILE_PATH = `${TDAH_PATH_PREFIX}/profile`;
const TDAH_ACTIVATE_PATH = `${TDAH_PATH_PREFIX}/activate`;
export const TDAH_ROUTINES_PATH_PREFIX = `${TDAH_PATH_PREFIX}/routines`;
const TDAH_ROUTINE_CONFLICTS_PATH = `${TDAH_ROUTINES_PATH_PREFIX}/conflicts`;
const TDAH_ROUTINE_ID_PATTERN = /^\/v1\/tdah\/routines\/([^/]+)$/;
const TDAH_ROUTINE_PREVIEW_PATTERN = /^\/v1\/tdah\/routines\/([^/]+)\/preview$/;
// Story 1.6 — the "Hoy" surface: GET the auto-generated today DayPlan, POST a
// manual Activity onto it, and register start/complete/miss on an existing
// Activity.
const TDAH_DAY_PATH = `${TDAH_PATH_PREFIX}/day`;
const TDAH_DAY_ACTIVITIES_PATH = `${TDAH_DAY_PATH}/activities`;
const TDAH_ACTIVITY_ACTION_PATTERN = /^\/v1\/tdah\/activities\/([^/]+)\/(start|complete|miss)$/;
// Story 3.2 — T-05's decision-chip endpoint. A separate pattern (rather than
// widening TDAH_ACTIVITY_ACTION_PATTERN's alternation) since `decide` takes a
// body while start/complete/miss never do.
const TDAH_ACTIVITY_DECIDE_PATTERN = /^\/v1\/tdah\/activities\/([^/]+)\/decide$/;
// Story 3.4 — El Limbo (T-08): a persistent tray over every Actividad in
// `state='limbo'`, queried with no date/timeZone scoping (FR-9: nothing here
// ever disappears by age). Exact-string dispatch, so `TDAH_LIMBO_DECIDE_PATH`
// never collides with `TDAH_ACTIVITY_DECIDE_PATTERN` above in practice, but
// both are still checked ahead of it in `handleTdahRequest` for the same
// clarity every other sub-path in this dispatcher already follows.
const TDAH_LIMBO_PATH = `${TDAH_PATH_PREFIX}/limbo`;
const TDAH_LIMBO_DECIDE_PATH = `${TDAH_LIMBO_PATH}/decide`;
// Story 3.3 — T-06's morning editor / T-07's confirm. `TDAH_DAY_TOMORROW_PATH`
// never collides with `TDAH_DAY_PATH` (exact-string dispatch), but the three
// are still matched ahead of it in handleTdahRequest for the same clarity
// every other sub-path in this dispatcher already follows.
const TDAH_DAY_TOMORROW_PATH = `${TDAH_DAY_PATH}/tomorrow`;
const TDAH_DAY_TOMORROW_ACTIVITIES_PATH = `${TDAH_DAY_TOMORROW_PATH}/activities`;
const TDAH_DAY_TOMORROW_CONFIRM_PATH = `${TDAH_DAY_TOMORROW_PATH}/confirm`;
// Story 3.5 — T-09 Historial / T-10 Métricas. Exact-string dispatch, matched
// ahead of `TDAH_PROFILE_PATH`'s catch-all fallback, same as every other
// sub-path above.
const TDAH_HISTORY_PATH = `${TDAH_PATH_PREFIX}/history`;
const TDAH_METRICS_PATH = `${TDAH_PATH_PREFIX}/metrics`;
// Story 4.1 — T-13's Origen de trabajo. `.../origin/sync` is dispatched ahead
// of `.../origin` for the same clarity ordering `TDAH_LIMBO_DECIDE_PATH`
// already follows over `TDAH_LIMBO_PATH`, and both ahead of
// `TDAH_PROFILE_PATH`'s catch-all fallback.
const TDAH_ORIGIN_PATH = `${TDAH_PATH_PREFIX}/origin`;
const TDAH_ORIGIN_SYNC_PATH = `${TDAH_ORIGIN_PATH}/sync`;
// Story 4.3 — T-12's DND. Dispatched most-specific-first
// (`/dnd/calendar` -> `/dnd/windows/:id` -> `/dnd/windows` -> `/dnd`), the
// same ordering `TDAH_ORIGIN_SYNC_PATH` follows over `TDAH_ORIGIN_PATH`, and
// all of them ahead of `TDAH_PROFILE_PATH`'s catch-all fallback.
const TDAH_DND_PATH = `${TDAH_PATH_PREFIX}/dnd`;
const TDAH_DND_CALENDAR_PATH = `${TDAH_DND_PATH}/calendar`;
const TDAH_DND_WINDOWS_PATH = `${TDAH_DND_PATH}/windows`;
// Built from `TDAH_DND_WINDOWS_PATH` rather than repeating the literal prefix,
// so the pattern cannot drift from the exact-string path it is the `/:id`
// sibling of. The prefix is a fixed ASCII path with no regex metacharacters, so
// it needs no escaping.
const TDAH_DND_WINDOW_ID_PATTERN = new RegExp(`^${TDAH_DND_WINDOWS_PATH}/([^/]+)$`);

const IANA_TIME_ZONE_PATTERN = /^[A-Za-z0-9+_/-]{1,64}$/;
const RITUAL_HOUR_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
// The profile's own ritualHour additionally rejects exactly '00:00': every
// local wall-clock time of the day is >= '00:00', so a 00:00 ritual would
// make isRitualHourReached true all day and the scheduler's sweep-close
// would limbo the just-started day's Actividades on every tick. Shared with
// Bloque/manual-Activity startTime validation above, which must KEEP
// accepting '00:00' — a Bloque may legitimately start at midnight.
const PROFILE_RITUAL_HOUR_PATTERN = /^(?!00:00$)([01]\d|2[0-3]):[0-5]\d$/;
// A single day's routine cannot reasonably need more Bloques than this —
// caps the otherwise-unbounded `blocks` array on the input.
const TDAH_ROUTINE_MAX_BLOCKS = 24;
const TDAH_WEEKDAY_NUMBERS = [0, 1, 2, 3, 4, 5, 6];
const TDAH_NTH_WEEKDAY_ORDINALS = [-1, 1, 2, 3, 4];

/**
 * Shared positive-integer path-segment parser — originally routine-only, now
 * also used by the story 1.6 `:id/{start|complete|miss}` activity-action
 * dispatch below, hence the entity-agnostic name.
 */
const parsePositiveIntegerId = (raw: string): number | null => {
    if (!/^\d+$/.test(raw)) return null;
    const id = Number(raw);
    // `Number.isInteger` alone accepts an absurdly large numeric string (e.g.
    // "9007199254740993") that has already silently lost precision going
    // through `Number()` — `Number.isSafeInteger` additionally rejects
    // anything past `2^53-1`, so a request can never match/mutate a
    // different id than the one it actually typed out.
    return Number.isSafeInteger(id) && id > 0 ? id : null;
};

// Story 3.5 — T-09 Historial / T-10 Métricas shared query-param parsing.
const TDAH_HISTORY_METRICS_PERIODS = ['day', 'week', 'month', 'custom'] as const;
type TdahHistoryMetricsPeriod = (typeof TDAH_HISTORY_METRICS_PERIODS)[number];
const isTdahHistoryMetricsPeriod = (value: string): value is TdahHistoryMetricsPeriod => (
    (TDAH_HISTORY_METRICS_PERIODS as readonly string[]).includes(value)
);
// day/week/month are rolling windows of 1/7/30 days ending "today" (AD-6) —
// never calendar-aligned (Design Notes: "ventanas rodantes vs. calendario").
const TDAH_HISTORY_METRICS_PRESET_DAYS: Record<Exclude<TdahHistoryMetricsPeriod, 'custom'>, number> = {
    day: 1,
    week: 7,
    month: 30,
};
// Boundaries & Constraints: "un span máximo de 366 días" — never an unbounded
// "todo el historial" query (this story's own fix for 3.4's unscoped Limbo
// read).
const TDAH_HISTORY_METRICS_MAX_CUSTOM_SPAN_DAYS = 366;

/**
 * Calendar-day difference between two already-`isValidDateString`-validated
 * `YYYY-MM-DD` strings (`to - from`, never negative once `from <= to` has
 * already been checked by the caller) — pure date arithmetic, no time zone
 * needed since both inputs are already resolved local calendar dates.
 */
const daysBetweenDateStrings = (from: string, to: string): number => {
    const fromParts = from.split('-').map(Number) as [number, number, number];
    const toParts = to.split('-').map(Number) as [number, number, number];
    const fromUtc = Date.UTC(fromParts[0], fromParts[1] - 1, fromParts[2]);
    const toUtc = Date.UTC(toParts[0], toParts[1] - 1, toParts[2]);
    return Math.round((toUtc - fromUtc) / 86_400_000);
};

type TdahParsedHistoryMetricsQuery =
    | { ok: true; period: TdahHistoryMetricsPeriod; from?: string; to?: string }
    | { ok: false };

/**
 * Shape-level validation only — never touches the caller's profile/time zone
 * (that read happens after this, alongside the FR-1 mode gate every other
 * handler already does). `custom` is fully resolved here (`from <= to`, span
 * <= 366 days); `day`/`week`/`month` are left unresolved (no `from`/`to`) for
 * `resolveHistoryMetricsRange` below to turn into an explicit window once the
 * caller's time zone is known.
 */
const parseHistoryMetricsPeriodQuery = (url: URL): TdahParsedHistoryMetricsQuery => {
    const periodParam = url.searchParams.get('period') ?? 'day';
    if (!isTdahHistoryMetricsPeriod(periodParam)) return { ok: false };
    if (periodParam !== 'custom') return { ok: true, period: periodParam };
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!from || !to || !isValidDateString(from) || !isValidDateString(to)) return { ok: false };
    if (from > to) return { ok: false };
    if (daysBetweenDateStrings(from, to) > TDAH_HISTORY_METRICS_MAX_CUSTOM_SPAN_DAYS) return { ok: false };
    return { ok: true, period: 'custom', from, to };
};

/**
 * Turns a shape-validated query into the explicit, bounded `{from, to}`
 * range actually queried (Boundaries & Constraints: "todo rango de consulta
 * es explícito y acotado"). `custom`'s bounds were already resolved by the
 * parse step above; `day`/`week`/`month` are resolved here, now that
 * `timeZone` (the caller's own profile) is available (`computeRollingRange`,
 * storage.ts).
 */
const resolveHistoryMetricsRange = (
    parsed: Extract<TdahParsedHistoryMetricsQuery, { ok: true }>,
    timeZone: string,
): { from: string; to: string } => (
    parsed.period === 'custom'
        ? { from: parsed.from as string, to: parsed.to as string }
        : computeRollingRange(timeZone, TDAH_HISTORY_METRICS_PRESET_DAYS[parsed.period])
);

export type TdahRequestContext = {
    key: string;
};

export type TdahRequestOptions = {
    dataDir: string;
    maxBodyBytes: number;
    signal?: AbortSignal;
    /**
     * Story 4.1 — the outbound `fetch` the Origen's provider uses. Injected
     * (defaulting to the global) for the same reason `activity-trigger.ts`
     * injects `hasOpenConnection`: `PUT /v1/tdah/origin` and
     * `POST /v1/tdah/origin/sync` are the only routes in this module that
     * talk to a third party, and they must be testable against a fake without
     * a network or a mutated global. `server.ts` never passes it.
     */
    fetchImpl?: WorkOriginFetch;
};

type TdahProfilePutBody = {
    mode?: unknown;
    timeZone?: unknown;
    ritualHour?: unknown;
};

type TdahParsedProfilePut = {
    mode?: TdahMode;
    timeZone?: string;
    ritualHour?: string;
};

const tdahErrorResponse = (code: TdahErrorCode, status: number): Response => (
    jsonResponse({ error: { code } }, { status })
);

const isValidTimeZone = (value: string): boolean => {
    if (!IANA_TIME_ZONE_PATTERN.test(value)) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return true;
    } catch {
        return false;
    }
};

const parseProfilePutBody = (body: unknown): { ok: true; body: TdahParsedProfilePut } | { ok: false; code: TdahErrorCode } => {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return { ok: false, code: TDAH_ERRORS.invalidBody };
    }
    const raw = body as TdahProfilePutBody;
    if (raw.mode !== undefined && !isTdahMode(raw.mode)) {
        return { ok: false, code: TDAH_ERRORS.invalidBody };
    }
    if (raw.timeZone !== undefined && typeof raw.timeZone !== 'string') {
        return { ok: false, code: TDAH_ERRORS.invalidBody };
    }
    if (raw.timeZone !== undefined && !isValidTimeZone(raw.timeZone)) {
        return { ok: false, code: TDAH_ERRORS.invalidTimeZone };
    }
    if (raw.ritualHour !== undefined && typeof raw.ritualHour !== 'string') {
        return { ok: false, code: TDAH_ERRORS.invalidBody };
    }
    if (raw.ritualHour !== undefined && !PROFILE_RITUAL_HOUR_PATTERN.test(raw.ritualHour)) {
        return { ok: false, code: TDAH_ERRORS.invalidRitualHour };
    }
    if (raw.mode === 'on') {
        return { ok: false, code: TDAH_ERRORS.activateRequired };
    }
    const parsed: TdahParsedProfilePut = {};
    if (raw.mode !== undefined) parsed.mode = raw.mode;
    if (raw.timeZone !== undefined) parsed.timeZone = raw.timeZone;
    if (raw.ritualHour !== undefined) parsed.ritualHour = raw.ritualHour;
    return { ok: true, body: parsed };
};

type TdahRoutineBlockBody = {
    title?: unknown;
    startTime?: unknown;
    durationMinutes?: unknown;
};

type TdahRoutinePatternBody = {
    kind?: unknown;
    weekdays?: unknown;
    ordinal?: unknown;
    weekday?: unknown;
};

type TdahRoutineBody = {
    title?: unknown;
    pattern?: unknown;
    blocks?: unknown;
};

type TdahActivateBody = {
    timeZone?: unknown;
    ritualHour?: unknown;
    routine?: unknown;
};

type TdahParsedActivate = {
    timeZone?: string;
    ritualHour?: string;
    routine?: TdahRoutineInput;
};

const parseRoutineBlockInput = (value: unknown): TdahRoutineBlockInput | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const raw = value as TdahRoutineBlockBody;
    if (typeof raw.title !== 'string' || raw.title.trim().length === 0) return null;
    if (typeof raw.startTime !== 'string' || !RITUAL_HOUR_PATTERN.test(raw.startTime)) return null;
    // Zero is a valid duration (a zero-length Bloque, end === start) per
    // 03-modo-tdah-rutinas.md's edge cases ("Bloque sin duración (válida —
    // fin = inicio)"). Only a negative value is rejected.
    if (typeof raw.durationMinutes !== 'number' || !Number.isInteger(raw.durationMinutes) || raw.durationMinutes < 0) {
        return null;
    }
    // DW-2: an unbounded duration let a single Bloque swallow the entire day
    // (or well beyond it) with no upper bound.
    if (raw.durationMinutes > TDAH_BLOCK_DURATION_MAX_MINUTES) return null;
    // Persist the trimmed title — the untrimmed raw.title was only used above
    // to reject whitespace-only input.
    return { title: raw.title.trim(), startTime: raw.startTime, durationMinutes: raw.durationMinutes };
};

const isTdahWeekdayNumber = (value: unknown): value is number => (
    typeof value === 'number' && Number.isInteger(value) && TDAH_WEEKDAY_NUMBERS.includes(value)
);

/**
 * `pattern` is optional — `undefined` returns the fixed Mon–Fri weekday
 * default (`TDAH_DEFAULT_ROUTINE_PATTERN` in storage.ts), the same default
 * the v0→v1 migration backfills, so `POST /activate`'s inline Rutina
 * creation (which never sends a `pattern`) keeps working unchanged. When
 * present, `kind` selects `weekdays` (non-empty subset of `0`-`6`) XOR
 * `ordinal` (`1`-`4` or `-1` for "last") + `weekday` (`0`-`6`).
 */
const parseRoutinePatternInput = (value: unknown): TdahRoutinePattern | null | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const raw = value as TdahRoutinePatternBody;
    if (raw.kind === 'weekday') {
        if (!Array.isArray(raw.weekdays) || raw.weekdays.length === 0) return null;
        // Bound the raw input length before doing any per-element work below —
        // there are only 7 distinct weekdays, so a legitimate caller never
        // sends more than that many entries. Checking this first rejects an
        // oversized array immediately instead of paying an O(n) dedup/validate
        // pass proportional to an arbitrarily large (or adversarial) input.
        if (raw.weekdays.length > TDAH_WEEKDAY_NUMBERS.length) return null;
        // Dedupe (e.g. `[1,1,2,2,2]`) before storing, matching the `blocks`
        // array's own cap discipline — `weekdays` always ends up a set of
        // unique 0-6 values, not a bag that can repeat the same day.
        const seen = new Set<number>();
        const weekdays: number[] = [];
        for (const day of raw.weekdays) {
            if (!isTdahWeekdayNumber(day)) return null;
            if (seen.has(day)) continue;
            seen.add(day);
            weekdays.push(day);
        }
        return { kind: 'weekday', weekdays };
    }
    if (raw.kind === 'nthWeekdayOfMonth') {
        if (typeof raw.ordinal !== 'number' || !TDAH_NTH_WEEKDAY_ORDINALS.includes(raw.ordinal)) return null;
        if (!isTdahWeekdayNumber(raw.weekday)) return null;
        return { kind: 'nthWeekdayOfMonth', ordinal: raw.ordinal, weekday: raw.weekday };
    }
    return null;
};

const parseRoutineInput = (value: unknown): TdahRoutineInput | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const raw = value as TdahRoutineBody;
    if (typeof raw.title !== 'string' || raw.title.trim().length === 0) return null;
    const title = raw.title.trim();
    // DW-2: an unbounded title let free editing ship without any cap.
    if (title.length > TDAH_ROUTINE_TITLE_MAX_LENGTH) return null;
    const pattern = parseRoutinePatternInput(raw.pattern);
    if (pattern === null) return null;
    if (!Array.isArray(raw.blocks) || raw.blocks.length === 0 || raw.blocks.length > TDAH_ROUTINE_MAX_BLOCKS) {
        return null;
    }
    const blocks: TdahRoutineBlockInput[] = [];
    for (const rawBlock of raw.blocks) {
        const block = parseRoutineBlockInput(rawBlock);
        if (!block) return null;
        blocks.push(block);
    }
    // Overlap is a non-blocking warning (UX spec: "aviso no bloqueante"), not
    // a parse rejection — computed fresh from the persisted Bloques on every
    // response instead (storage.ts's rowToRoutine).
    return { title, ...(pattern !== undefined ? { pattern } : {}), blocks };
};

type TdahManualActivityBody = {
    title?: unknown;
    startTime?: unknown;
    durationMinutes?: unknown;
};

/**
 * POST /v1/tdah/day/activities body (story 1.6, FR-4). `title` reuses the
 * same trim+cap rule Rutina/Bloque titles already enforce
 * (`TDAH_ROUTINE_TITLE_MAX_LENGTH`, not a new, separate cap). `startTime`/
 * `durationMinutes` are genuinely optional — when present, they're validated
 * with the exact same rules `parseRoutineBlockInput` already applies to a
 * Bloque (`RITUAL_HOUR_PATTERN` / `TDAH_BLOCK_DURATION_MAX_MINUTES`); when
 * omitted, `storage.ts`'s `mutateCreateManualActivity` persists `NULL` for
 * that field rather than a defaulted value (doc 02's "sin hora" case).
 */
const parseManualActivityInput = (value: unknown): TdahCreateManualActivityInput | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const raw = value as TdahManualActivityBody;
    if (typeof raw.title !== 'string' || raw.title.trim().length === 0) return null;
    const title = raw.title.trim();
    if (title.length > TDAH_ROUTINE_TITLE_MAX_LENGTH) return null;

    const parsed: TdahCreateManualActivityInput = { title };
    if (raw.startTime !== undefined) {
        if (typeof raw.startTime !== 'string' || !RITUAL_HOUR_PATTERN.test(raw.startTime)) return null;
        parsed.startTime = raw.startTime;
    }
    if (raw.durationMinutes !== undefined) {
        if (typeof raw.durationMinutes !== 'number' || !Number.isInteger(raw.durationMinutes) || raw.durationMinutes < 0) {
            return null;
        }
        if (raw.durationMinutes > TDAH_BLOCK_DURATION_MAX_MINUTES) return null;
        parsed.durationMinutes = raw.durationMinutes;
    }
    return parsed;
};

type TdahActivityDecideBody = {
    decision?: unknown;
    date?: unknown;
};

/**
 * POST /v1/tdah/activities/:id/decide body (story 3.2). Same shape-invalid
 * → `null` → `TDAH_ACTIVITY_INVALID` 400 convention as
 * `parseManualActivityInput` above (not `TDAH_INVALID_BODY` — see that
 * function's own error-code choice). `date` is only read/validated for
 * `move-date`; `isValidDateString` (storage.ts) rejects both a malformed
 * `YYYY-MM-DD` shape and a calendar-impossible one (e.g. "2026-02-30").
 * Whether `date` is actually in the future is a semantic check left to
 * `mutateDecideActivity` (storage.ts), which needs the caller's profile time
 * zone (AD-6) to know "today" — not available at this parsing stage.
 */
const parseDecideRequestBody = (value: unknown): TdahActivityDecideRequest | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const raw = value as TdahActivityDecideBody;
    if (
        raw.decision === 'move-tomorrow'
        || raw.decision === 'discard'
        || raw.decision === 'undated'
        || raw.decision === 'complete-late'
    ) {
        return { decision: raw.decision };
    }
    if (raw.decision === 'move-date') {
        if (typeof raw.date !== 'string' || !isValidDateString(raw.date)) return null;
        return { decision: 'move-date', date: raw.date };
    }
    return null;
};

type TdahLimboDecideBatchBody = {
    activityIds?: unknown;
    decision?: unknown;
};

/**
 * POST /v1/tdah/limbo/decide body (story 3.4). `decision` reuses
 * `parseDecideRequestBody` for its own nested `{decision, date}` shape, then
 * rejects the one variant it parses that the Limbo screen never offers
 * (`'undated'` — see `TdahLimboDecideBatchRequest`'s doc comment in
 * types.ts). `activityIds` must be a non-empty array of positive safe
 * integers — the same rule `parseConfirmMorningRequestBody` above already
 * applies to `deletedActivityIds`; duplicates are tolerated here and deduped
 * by `mutateDecideLimboBatch` (storage.ts) rather than rejected at this
 * parsing stage.
 *
 * `activityIds.length` is capped at `TDAH_DAY_MAX_ACTIVITIES` (review fix):
 * unlike `mutateConfirmMorning`'s target set — naturally bounded by a single
 * day's own `TDAH_DAY_MAX_ACTIVITIES` cap — the Limbo tray has no such
 * ceiling by construction (FR-9: nothing is ever evicted by age, so it can
 * accumulate indefinitely). `mutateDecideLimboBatch`'s `WHERE id IN (?, ?, …)`
 * placeholder list is sized directly off this array, so an unbounded request
 * body risks hitting SQLite's own bound-parameter limit as an opaque 500
 * instead of a controlled 400 — reusing this module's existing batch-size
 * precedent here rejects it as a clean body-validation failure instead.
 *
 * Per-id eligibility (must exist AND currently be `limbo`) and the
 * "no partial batch" atomicity are semantic checks left to
 * `decideLimboBatch`/`mutateDecideLimboBatch`, which need the caller's own
 * namespace database to resolve them, not available at this parsing stage.
 */
const parseLimboDecideBatchBody = (value: unknown): TdahLimboDecideBatchRequest | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const raw = value as TdahLimboDecideBatchBody;
    if (!Array.isArray(raw.activityIds) || raw.activityIds.length === 0) return null;
    if (raw.activityIds.length > TDAH_DAY_MAX_ACTIVITIES) return null;
    const activityIds: number[] = [];
    for (const rawId of raw.activityIds) {
        if (typeof rawId !== 'number' || !Number.isSafeInteger(rawId) || rawId <= 0) return null;
        activityIds.push(rawId);
    }
    const decision = parseDecideRequestBody(raw.decision);
    if (!decision || decision.decision === 'undated') return null;
    return { activityIds, decision };
};

type TdahConfirmMorningActivityBody = {
    id?: unknown;
    startTime?: unknown;
    durationMinutes?: unknown;
};

type TdahConfirmMorningBody = {
    activities?: unknown;
    deletedActivityIds?: unknown;
};

/**
 * One entry of `POST /v1/tdah/day/tomorrow/confirm`'s `activities` array
 * (story 3.3). `id` reuses the same positive-safe-integer rule
 * `parsePositiveIntegerId` enforces on path segments, just against a JSON
 * number instead of a string. `startTime`/`durationMinutes` are validated
 * with the exact same rules `parseManualActivityInput` already applies
 * (`RITUAL_HOUR_PATTERN` / `TDAH_BLOCK_DURATION_MAX_MINUTES`) — the field may
 * be omitted (kept `null`, "sin hora"/"sin duración") or explicitly `null`,
 * but a present non-null value must still be well-formed.
 */
const parseConfirmMorningActivityEntry = (
    value: unknown,
): { id: number; startTime: string | null; durationMinutes: number | null } | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const raw = value as TdahConfirmMorningActivityBody;
    if (typeof raw.id !== 'number' || !Number.isSafeInteger(raw.id) || raw.id <= 0) return null;

    let startTime: string | null = null;
    if (raw.startTime !== undefined && raw.startTime !== null) {
        if (typeof raw.startTime !== 'string' || !RITUAL_HOUR_PATTERN.test(raw.startTime)) return null;
        startTime = raw.startTime;
    }

    let durationMinutes: number | null = null;
    if (raw.durationMinutes !== undefined && raw.durationMinutes !== null) {
        if (
            typeof raw.durationMinutes !== 'number'
            || !Number.isInteger(raw.durationMinutes)
            || raw.durationMinutes < 0
            || raw.durationMinutes > TDAH_BLOCK_DURATION_MAX_MINUTES
        ) {
            return null;
        }
        durationMinutes = raw.durationMinutes;
    }

    return { id: raw.id, startTime, durationMinutes };
};

/**
 * POST /v1/tdah/day/tomorrow/confirm body (story 3.3). Same shape-invalid →
 * `null` → `TDAH_ACTIVITY_INVALID` 400 convention as
 * `parseManualActivityInput`/`parseDecideRequestBody` above — accounting
 * (`activities.length + deletedActivityIds.length` against the day's real
 * `pending` count) and per-id eligibility are semantic checks left to
 * `confirmMorning`/`mutateConfirmMorning` (storage.ts), which need the
 * caller's own namespace database to resolve them, not available at this
 * parsing stage.
 */
const parseConfirmMorningRequestBody = (value: unknown): TdahConfirmMorningRequest | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const raw = value as TdahConfirmMorningBody;
    if (!Array.isArray(raw.activities)) return null;
    const activities: TdahConfirmMorningRequest['activities'] = [];
    for (const rawEntry of raw.activities) {
        const entry = parseConfirmMorningActivityEntry(rawEntry);
        if (!entry) return null;
        activities.push(entry);
    }
    if (!Array.isArray(raw.deletedActivityIds)) return null;
    const deletedActivityIds: number[] = [];
    for (const rawId of raw.deletedActivityIds) {
        if (typeof rawId !== 'number' || !Number.isSafeInteger(rawId) || rawId <= 0) return null;
        deletedActivityIds.push(rawId);
    }
    return { activities, deletedActivityIds };
};

const parseActivateBody = (body: unknown): { ok: true; body: TdahParsedActivate } | { ok: false; code: TdahErrorCode } => {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return { ok: false, code: TDAH_ERRORS.invalidBody };
    }
    const raw = body as TdahActivateBody;
    if (raw.timeZone !== undefined && typeof raw.timeZone !== 'string') {
        return { ok: false, code: TDAH_ERRORS.invalidBody };
    }
    if (raw.timeZone !== undefined && !isValidTimeZone(raw.timeZone)) {
        return { ok: false, code: TDAH_ERRORS.invalidTimeZone };
    }
    if (raw.ritualHour !== undefined && typeof raw.ritualHour !== 'string') {
        return { ok: false, code: TDAH_ERRORS.invalidBody };
    }
    if (raw.ritualHour !== undefined && !PROFILE_RITUAL_HOUR_PATTERN.test(raw.ritualHour)) {
        return { ok: false, code: TDAH_ERRORS.invalidRitualHour };
    }
    const parsed: TdahParsedActivate = {};
    if (raw.timeZone !== undefined) parsed.timeZone = raw.timeZone;
    if (raw.ritualHour !== undefined) parsed.ritualHour = raw.ritualHour;
    if (raw.routine !== undefined) {
        const routine = parseRoutineInput(raw.routine);
        if (!routine) {
            return { ok: false, code: TDAH_ERRORS.routineInvalid };
        }
        parsed.routine = routine;
    }
    return { ok: true, body: parsed };
};

/**
 * POST /v1/tdah/activate — the only way to turn the mode on, first time or
 * on reactivation. `PUT /tdah/profile` rejects a `mode:'on'` body with
 * `TDAH_ACTIVATE_REQUIRED`; it only sets `mode:'off'` or updates
 * timeZone/ritualHour on an existing profile. Idempotent: a Rutina is
 * created only if the body includes one and none exists yet;
 * `generateTomorrowIfMissing` never duplicates tomorrow's DayPlan (see
 * storage.ts).
 */
const handleActivate = async (
    req: Request,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    const body = await readJsonBody(req, options.maxBodyBytes, options.signal);
    if (isBodyReadError(body)) {
        // `body.__mindwtrError.status` already distinguishes a genuinely
        // oversized payload (413) from a request abort/timeout (408) — see
        // readRequestBytes in ../server-storage. Propagating it instead of a
        // hardcoded 413 stops an abort/timeout from being misreported as
        // Payload Too Large.
        return tdahErrorResponse(TDAH_ERRORS.invalidBody, body.__mindwtrError.status);
    }
    const parsed = parseActivateBody(body);
    if (!parsed.ok) {
        return tdahErrorResponse(parsed.code, 400);
    }
    try {
        const { profile, routineCreated, dayPlan } = await activateTdahProfile(options.dataDir, ctx.key, {
            timeZone: parsed.body.timeZone,
            ritualHour: parsed.body.ritualHour,
            routine: parsed.body.routine,
        });
        const responseBody: TdahActivateResponse = {
            profile,
            routineCreated,
            dayPlan: { date: dayPlan.date, activityCount: dayPlan.activityCount },
        };
        return jsonResponse(responseBody);
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/** GET /v1/tdah/routines — every Rutina, most-specific-first, each with its full Bloque list. */
const handleListRoutines = async (ctx: TdahRequestContext, options: TdahRequestOptions): Promise<Response> => {
    try {
        const routines = await listRoutinesWithBlocks(options.dataDir, ctx.key);
        return jsonResponse({ routines });
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/** GET /v1/tdah/routines/:id — a single Rutina, 404 when it doesn't exist. */
const handleGetRoutine = async (
    routineId: number,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    try {
        const routine = await getRoutineWithBlocks(options.dataDir, ctx.key, routineId);
        if (!routine) return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
        return jsonResponse({ routine });
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/** POST /v1/tdah/routines — always creates a new Rutina; never the `/activate`-only no-op-if-exists shortcut. */
const handleCreateRoutine = async (
    req: Request,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    const body = await readJsonBody(req, options.maxBodyBytes, options.signal);
    if (isBodyReadError(body)) {
        return tdahErrorResponse(TDAH_ERRORS.invalidBody, body.__mindwtrError.status);
    }
    const input = parseRoutineInput(body);
    if (!input) return tdahErrorResponse(TDAH_ERRORS.routineInvalid, 400);
    try {
        const routine = await createRoutine(options.dataDir, ctx.key, input);
        // `null` means the namespace was already at TDAH_ROUTINE_MAX_COUNT — the
        // insert never ran (checked and rejected atomically inside the same
        // write transaction, see storage.ts).
        if (!routine) return tdahErrorResponse(TDAH_ERRORS.routineInvalid, 400);
        return jsonResponse({ routine }, { status: 201 });
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/** PUT /v1/tdah/routines/:id — full replace of pattern + Bloques; already-generated days untouched. */
const handleUpdateRoutine = async (
    req: Request,
    routineId: number,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    const body = await readJsonBody(req, options.maxBodyBytes, options.signal);
    if (isBodyReadError(body)) {
        return tdahErrorResponse(TDAH_ERRORS.invalidBody, body.__mindwtrError.status);
    }
    const input = parseRoutineInput(body);
    if (!input) return tdahErrorResponse(TDAH_ERRORS.routineInvalid, 400);
    // Unlike POST (where an omitted `pattern` intentionally defaults to
    // Mon-Fri, per parseRoutineInput's own doc comment), PUT is a full
    // replace of an *existing* Rutina — silently falling back to the default
    // here would reset a custom pattern (e.g. "last Saturday") back to
    // Mon-Fri on any update payload that simply forgot to include `pattern`.
    // So `pattern` is required on this path specifically.
    if (input.pattern === undefined) return tdahErrorResponse(TDAH_ERRORS.routineInvalid, 400);
    try {
        const routine = await updateRoutine(options.dataDir, ctx.key, routineId, input);
        if (!routine) return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
        return jsonResponse({ routine });
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/** DELETE /v1/tdah/routines/:id — removes the row and its Bloques; already-generated Actividades keep their historical data. */
const handleDeleteRoutine = async (
    routineId: number,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    try {
        const deleted = await deleteRoutine(options.dataDir, ctx.key, routineId);
        if (!deleted) return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
        return jsonResponse({ deleted: true });
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * GET /v1/tdah/routines/:id/preview?month=YYYY-MM — every date that month
 * where this Rutina currently wins precedence (AD-5: server computes, UI only
 * requests/renders). Pattern matching is calendar-date arithmetic
 * (`weekdayOfDate` is timezone-independent), so no profile read is needed
 * here — the Y-M-D dates themselves are timezone-free.
 */
const handleGetRoutinePreview = async (
    req: Request,
    routineId: number,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    const url = new URL(req.url);
    const month = url.searchParams.get('month');
    if (!month || !isValidMonthString(month)) {
        return tdahErrorResponse(TDAH_ERRORS.invalidBody, 400);
    }
    try {
        const dates = await computeApplicabilityPreview(options.dataDir, ctx.key, routineId, month);
        if (!dates) return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
        return jsonResponse({ dates });
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * GET /v1/tdah/routines/conflicts — every conflicting Rutina pair with the
 * server-computed winner (AD-5: "el servidor computa la precedencia; la UI
 * solo la solicita y la renderiza, nunca la recalcula localmente"). Dispatched
 * as its own exact-path branch ahead of the `/:id` regex so the literal
 * segment "conflicts" is never mistaken for a routine id.
 */
const handleGetRoutineConflicts = async (ctx: TdahRequestContext, options: TdahRequestOptions): Promise<Response> => {
    try {
        const conflicts = await computeRoutineConflicts(options.dataDir, ctx.key);
        return jsonResponse({ conflicts });
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * GET /v1/tdah/day — story 1.6, T-01. Always 200 when the mode is on
 * (auto-generates today's DayPlan on demand if missing, AD-5), in the
 * caller's own profile time zone. FR-1 gate: with the mode off — or no
 * profile at all, i.e. a namespace that never activated — this must NOT
 * auto-generate DayPlans/Actividades (and must not plant `tdah.sqlite` for a
 * never-activated namespace), so it returns 409 TDAH_ACTIVATE_REQUIRED.
 *
 * Story 4.2 — the response body now also carries the grouped Jira band's
 * read-only sub-rows (`activities[].workItems`, only on the `origin: 'jira'`
 * row) and the Origen's own `workOriginErrorCode`, both attached by
 * `selectDayPlanView` (storage.ts). Neither ever carries the sealed credential:
 * the snapshot table has no token column to read, and the error code is a
 * stable `TDAH_…` classification, never a raw provider message.
 *
 * Story 4.3 — and `dndActiveUntil`, T-01's `🌙 DND · hasta {hora}` chip. It is
 * the one field in this body whose value comes from a CLOCK rather than from
 * stored rows: `selectDayPlanView` resolves it against the profile-local "now"
 * at request time, over the same `resolveDndActive` predicate the two
 * notification ticks use, so the chip can never disagree with whether a
 * notification would actually be suppressed. Being clock-derived, it is
 * attached only to TODAY's view — tomorrow's editor and the confirm write have
 * no "now" to be inside of and read `null` (AD-8: the client computes nothing).
 */
const handleGetDay = async (ctx: TdahRequestContext, options: TdahRequestOptions): Promise<Response> => {
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const day = await getTodayDayPlan(options.dataDir, ctx.key, profile.timeZone);
        const responseBody: TdahDayResponse = day;
        return jsonResponse(responseBody);
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/** POST /v1/tdah/day/activities — story 1.6, FR-4: adds a manual Activity to today's timeline. FR-1 gate: 409 TDAH_ACTIVATE_REQUIRED unless the mode is on (see handleGetDay). */
const handleCreateManualActivity = async (
    req: Request,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    const body = await readJsonBody(req, options.maxBodyBytes, options.signal);
    if (isBodyReadError(body)) {
        return tdahErrorResponse(TDAH_ERRORS.invalidBody, body.__mindwtrError.status);
    }
    const input = parseManualActivityInput(body);
    if (!input) return tdahErrorResponse(TDAH_ERRORS.activityInvalid, 400);
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const activity = await createManualActivity(options.dataDir, ctx.key, profile.timeZone, input);
        // `null` means today's DayPlan was already at TDAH_DAY_MAX_ACTIVITIES —
        // the insert never ran (checked and rejected atomically inside the same
        // write transaction, see storage.ts).
        if (!activity) return tdahErrorResponse(TDAH_ERRORS.activityInvalid, 400);
        const responseBody: TdahActivityResponse = { activity };
        return jsonResponse(responseBody, { status: 201 });
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * GET /v1/tdah/day/tomorrow — story 3.3, T-06's morning editor. Mirrors
 * `handleGetDay` above but reads/materializes tomorrow's DayPlan
 * (`getTomorrowDayPlan`) instead of today's; never generates today's plan.
 * Same FR-1 gate: 409 TDAH_ACTIVATE_REQUIRED unless the mode is on.
 */
const handleGetTomorrowDay = async (ctx: TdahRequestContext, options: TdahRequestOptions): Promise<Response> => {
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const day = await getTomorrowDayPlan(options.dataDir, ctx.key, profile.timeZone);
        const responseBody: TdahDayResponse = day;
        return jsonResponse(responseBody);
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * POST /v1/tdah/day/tomorrow/activities — story 3.3, T-06's "Agregar manual"
 * CTA. Unlike every other T-06 edit, this persists immediately, independent
 * of the confirm draft (Design Notes) — mirrors `handleCreateManualActivity`
 * above, targeting tomorrow's DayPlan instead of today's. Same FR-1 gate.
 */
const handleCreateManualActivityForTomorrow = async (
    req: Request,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    const body = await readJsonBody(req, options.maxBodyBytes, options.signal);
    if (isBodyReadError(body)) {
        return tdahErrorResponse(TDAH_ERRORS.invalidBody, body.__mindwtrError.status);
    }
    const input = parseManualActivityInput(body);
    if (!input) return tdahErrorResponse(TDAH_ERRORS.activityInvalid, 400);
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const activity = await createManualActivityForTomorrow(options.dataDir, ctx.key, profile.timeZone, input);
        // `null` means tomorrow's DayPlan was already at TDAH_DAY_MAX_ACTIVITIES —
        // the insert never ran (checked and rejected atomically inside the same
        // write transaction, see storage.ts).
        if (!activity) return tdahErrorResponse(TDAH_ERRORS.activityInvalid, 400);
        const responseBody: TdahActivityResponse = { activity };
        return jsonResponse(responseBody, { status: 201 });
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * POST /v1/tdah/activities/:id/{start|complete|miss} — story 1.6, T-02/AD-7.
 * See `mutateTransitionActivityState` (storage.ts) for the exact idempotency
 * and rejection rules this only translates into HTTP status/error codes.
 * FR-1 gate first: 409 TDAH_ACTIVATE_REQUIRED unless the mode is on — the
 * whole mutation surface pauses with the mode (see handleGetDay).
 */
const handleTransitionActivity = async (
    activityId: number,
    action: TdahActivityTransitionAction,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const result = await transitionActivityState(options.dataDir, ctx.key, activityId, action);
        if (result.kind === 'notFound') return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
        if (result.kind === 'rejected') return tdahErrorResponse(TDAH_ERRORS.activityInvalid, 400);
        const responseBody: TdahActivityResponse = { activity: result.activity };
        return jsonResponse(responseBody);
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * POST /v1/tdah/activities/:id/decide — story 3.2, T-05's decision-chip.
 * Same FR-1 mode gate + 404/rejected→400/500 shape as
 * `handleTransitionActivity` above; see `mutateDecideActivity` (storage.ts)
 * for the exact idempotency/eligibility/date rules `result.kind` encodes.
 */
const handleDecideActivity = async (
    req: Request,
    activityId: number,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    const body = await readJsonBody(req, options.maxBodyBytes, options.signal);
    if (isBodyReadError(body)) {
        return tdahErrorResponse(TDAH_ERRORS.invalidBody, body.__mindwtrError.status);
    }
    const decideRequest = parseDecideRequestBody(body);
    if (!decideRequest) return tdahErrorResponse(TDAH_ERRORS.activityInvalid, 400);
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const result = await decideActivity(options.dataDir, ctx.key, activityId, decideRequest, profile.timeZone);
        if (result.kind === 'notFound') return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
        if (result.kind === 'rejected') return tdahErrorResponse(TDAH_ERRORS.activityInvalid, 400);
        const responseBody: TdahActivityResponse = { activity: result.activity };
        return jsonResponse(responseBody);
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * POST /v1/tdah/day/tomorrow/confirm — story 3.3, T-06's single
 * grouped-persist. Same FR-1 mode gate + rejected→400/500 shape as
 * `handleDecideActivity` above; see `mutateConfirmMorning` (storage.ts) for
 * the exact accounting/eligibility/idempotency rules `result.kind` encodes.
 * There is no `notFound` branch here (unlike the other activity-id-keyed
 * endpoints) — this always operates on the caller's own tomorrow DayPlan as
 * a whole, never a single Activity id.
 */
const handleConfirmMorning = async (
    req: Request,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    const body = await readJsonBody(req, options.maxBodyBytes, options.signal);
    if (isBodyReadError(body)) {
        return tdahErrorResponse(TDAH_ERRORS.invalidBody, body.__mindwtrError.status);
    }
    const confirmRequest = parseConfirmMorningRequestBody(body);
    if (!confirmRequest) return tdahErrorResponse(TDAH_ERRORS.activityInvalid, 400);
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const result = await confirmMorning(options.dataDir, ctx.key, confirmRequest, profile.timeZone);
        if (result.kind === 'rejected') {
            // Story 4.2 — a body that names the grouped Jira band is not a
            // malformed request, it is a request for something the module never
            // allows: the band is read-only on every surface, and the work
            // record it stands for lives in Jira. 409 (conflict with the
            // resource's own nature), with its own code, so the client can show
            // the persistent read-only notice instead of a generic "revisá los
            // datos".
            if (result.reason === 'originReadOnly') {
                return tdahErrorResponse(TDAH_ERRORS.originReadOnly, 409);
            }
            return tdahErrorResponse(TDAH_ERRORS.activityInvalid, 400);
        }
        const responseBody: TdahDayResponse = result.day;
        return jsonResponse(responseBody);
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * GET /v1/tdah/limbo — story 3.4, T-08. Every Actividad currently
 * `state='limbo'` across every day, oldest first (`getLimboActivities`,
 * storage.ts) — no date/timeZone scoping, unlike `handleGetDay`/
 * `handleGetTomorrowDay` above (FR-9: nothing here ever disappears by age).
 * Same FR-1 gate: 409 TDAH_ACTIVATE_REQUIRED unless the mode is on.
 */
const handleGetLimbo = async (ctx: TdahRequestContext, options: TdahRequestOptions): Promise<Response> => {
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const activities = await getLimboActivities(options.dataDir, ctx.key);
        const responseBody: TdahLimboResponse = { activities };
        return jsonResponse(responseBody);
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * POST /v1/tdah/limbo/decide — story 3.4, T-08's batch decision bar. Same
 * FR-1 mode gate + rejected→400/500 shape as `handleConfirmMorning` above;
 * see `mutateDecideLimboBatch` (storage.ts) for the exact atomicity/
 * eligibility rules `result.kind` encodes. No `notFound` branch (like
 * `handleConfirmMorning`) — an unknown or non-`limbo` id inside the batch is
 * a `rejected` 400 for the whole request, not a per-id 404, since this
 * targets a set, not a single resource.
 */
const handleDecideLimboBatch = async (
    req: Request,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    const body = await readJsonBody(req, options.maxBodyBytes, options.signal);
    if (isBodyReadError(body)) {
        return tdahErrorResponse(TDAH_ERRORS.invalidBody, body.__mindwtrError.status);
    }
    const batchRequest = parseLimboDecideBatchBody(body);
    if (!batchRequest) return tdahErrorResponse(TDAH_ERRORS.activityInvalid, 400);
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const result = await decideLimboBatch(options.dataDir, ctx.key, batchRequest, profile.timeZone);
        if (result.kind === 'rejected') return tdahErrorResponse(TDAH_ERRORS.activityInvalid, 400);
        const responseBody: TdahLimboDecideBatchResponse = { activities: result.activities };
        return jsonResponse(responseBody);
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * GET /v1/tdah/history — story 3.5, T-09. Query-param shape validation
 * happens first (`parseHistoryMetricsPeriodQuery`, plus `origin`/`routineId`
 * below) — invalid input never even reads the profile — then the same FR-1
 * mode gate every other route uses, then the rolling-window resolution
 * (`resolveHistoryMetricsRange`) that needs the now-known profile time zone.
 */
const handleGetHistory = async (
    req: Request,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    const url = new URL(req.url);
    const parsedQuery = parseHistoryMetricsPeriodQuery(url);
    if (!parsedQuery.ok) return tdahErrorResponse(TDAH_ERRORS.invalidBody, 400);

    const originParam = url.searchParams.get('origin');
    if (originParam !== null && !(TDAH_ACTIVITY_ORIGINS as readonly string[]).includes(originParam)) {
        return tdahErrorResponse(TDAH_ERRORS.invalidBody, 400);
    }
    const routineIdParam = url.searchParams.get('routineId');
    let routineId: number | undefined;
    if (routineIdParam !== null) {
        const parsed = parsePositiveIntegerId(routineIdParam);
        if (parsed === null) return tdahErrorResponse(TDAH_ERRORS.invalidBody, 400);
        routineId = parsed;
    }

    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const range = resolveHistoryMetricsRange(parsedQuery, profile.timeZone);
        const entries = await getHistory(options.dataDir, ctx.key, {
            from: range.from,
            to: range.to,
            timeZone: profile.timeZone,
            ...(originParam !== null ? { origin: originParam as TdahActivityOrigin } : {}),
            ...(routineId !== undefined ? { routineId } : {}),
        });
        const responseBody: TdahHistoryResponse = { range, entries };
        return jsonResponse(responseBody);
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * GET /v1/tdah/metrics — story 3.5, T-10. Same parse-then-gate-then-resolve
 * order as `handleGetHistory` above, minus the `origin`/`routineId` filters
 * (Metrics never filters by either — only History's per-Actividad list does).
 */
const handleGetMetrics = async (
    req: Request,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    const url = new URL(req.url);
    const parsedQuery = parseHistoryMetricsPeriodQuery(url);
    if (!parsedQuery.ok) return tdahErrorResponse(TDAH_ERRORS.invalidBody, 400);

    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const range = resolveHistoryMetricsRange(parsedQuery, profile.timeZone);
        const responseBody: TdahMetricsResponse = await getMetrics(options.dataDir, ctx.key, {
            from: range.from,
            to: range.to,
            timeZone: profile.timeZone,
        });
        return jsonResponse(responseBody);
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

// --- Origen de trabajo (story 4.1, T-13) ------------------------------------

type TdahWorkOriginPutBody = {
    provider?: unknown;
    siteUrl?: unknown;
    email?: unknown;
    token?: unknown;
    workStart?: unknown;
    workEnd?: unknown;
    pullIntervalMinutes?: unknown;
};

/**
 * PUT /v1/tdah/origin body. Everything is validated BEFORE the handler makes
 * any outbound request — a malformed site URL must cost a 400, never a
 * connection attempt (I/O Matrix: "rechazo antes de cualquier salida de red").
 *
 * `siteUrl` is normalized by the PROVIDER (`parseSiteUrl`), not by a regex
 * here: what counts as a legitimate site is provider-specific, and the
 * rejected shapes (userinfo, path, non-https, IP literals, internal suffixes)
 * are the module's SSRF boundary, so they live next to the code that actually
 * sends the credential — see `parseJiraSiteUrl`'s own doc comment.
 *
 * `token` is OPTIONAL. Omitting it means "keep the stored credential", which
 * is what makes doc 06 zone 3's pull settings independently adjustable: moving
 * your working hours must not require minting a fresh Atlassian API token.
 * Whether an omitted token is actually acceptable depends on an existing row,
 * which this parser cannot see — `handlePutWorkOrigin` enforces it. When
 * present it is length-bounded but otherwise opaque: only Atlassian can say
 * whether a token works, and a client-side format guess would just reject
 * valid future formats.
 *
 * `workStart`/`workEnd`/`pullIntervalMinutes` are shape-validated here but
 * NOT cross-validated: the effective window is the merge of body over stored
 * over defaults, and only the handler (which reads the stored row) can compute
 * it. `handlePutWorkOrigin` checks `workStart < workEnd` on that merged pair,
 * still before any outbound call.
 */
const parseWorkOriginPutBody = (value: unknown): TdahWorkOriginUpsertRequest | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const raw = value as TdahWorkOriginPutBody;

    if (!isTdahWorkOriginProvider(raw.provider)) return null;
    const provider = resolveWorkOriginProvider(raw.provider);
    if (!provider) return null;

    if (typeof raw.siteUrl !== 'string') return null;
    const siteUrl = provider.parseSiteUrl(raw.siteUrl);
    if (!siteUrl) return null;

    if (typeof raw.email !== 'string') return null;
    const email = raw.email.trim();
    if (email.length === 0 || email.length > TDAH_WORK_ORIGIN_MAX_EMAIL_LENGTH) return null;

    const parsed: TdahWorkOriginUpsertRequest = { provider: raw.provider, siteUrl, email };

    if (raw.token !== undefined) {
        if (typeof raw.token !== 'string') return null;
        const token = raw.token.trim();
        if (token.length === 0 || token.length > TDAH_WORK_ORIGIN_MAX_TOKEN_LENGTH) return null;
        parsed.token = token;
    }

    if (raw.workStart !== undefined) {
        if (typeof raw.workStart !== 'string' || !RITUAL_HOUR_PATTERN.test(raw.workStart)) return null;
        parsed.workStart = raw.workStart;
    }
    if (raw.workEnd !== undefined) {
        if (typeof raw.workEnd !== 'string' || !RITUAL_HOUR_PATTERN.test(raw.workEnd)) return null;
        parsed.workEnd = raw.workEnd;
    }

    if (raw.pullIntervalMinutes !== undefined) {
        if (
            typeof raw.pullIntervalMinutes !== 'number'
            || !Number.isInteger(raw.pullIntervalMinutes)
            || raw.pullIntervalMinutes < TDAH_WORK_ORIGIN_MIN_PULL_INTERVAL_MINUTES
            || raw.pullIntervalMinutes > TDAH_WORK_ORIGIN_MAX_PULL_INTERVAL_MINUTES
        ) {
            return null;
        }
        parsed.pullIntervalMinutes = raw.pullIntervalMinutes;
    }

    return parsed;
};

/**
 * GET /v1/tdah/origin — T-13's whole read (doc 06 zones 1, 3 and 4: the
 * connection state, the pull settings, and the effective JQL as selectable
 * text). Same FR-1 mode gate as every other TDAH route: 409
 * TDAH_ACTIVATE_REQUIRED unless the mode is on.
 *
 * A namespace with no Origen answers 200 `{connected: false, …}` — the
 * "nunca conectado" onboarding state, never a 404: T-13 is a settings screen
 * that must render before anything exists.
 *
 * The response can hold no token at any level, by construction — see
 * `TdahWorkOriginStatus` and `readWorkOriginStatus`.
 */
const handleGetWorkOrigin = async (ctx: TdahRequestContext, options: TdahRequestOptions): Promise<Response> => {
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const responseBody: TdahWorkOriginResponse = await readWorkOriginStatus(options.dataDir, ctx.key);
        return jsonResponse(responseBody);
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * PUT /v1/tdah/origin — the one-time write of the credential (doc 06 zone 2).
 *
 * Order of operations is the security contract, not an implementation detail:
 *
 * 1. Parse (no I/O at all) — a bad site URL never reaches the network.
 * 2. Mode gate — 409, same as every other route.
 * 3. Resolve the effective settings against what is already stored: body →
 *    persisted → default, then validate the merged work window. Still before
 *    any outbound call, so an impossible window is a 400, never a connection.
 * 4. Master key — 503 `TDAH_ORIGIN_KEY_UNAVAILABLE` when a token needs
 *    sealing and the operator has not configured one. The Origen fails
 *    CLOSED: there is no branch that persists a token in clear.
 * 5. Validate against the live API — a 401/403 is a 400
 *    `TDAH_ORIGIN_CREDENTIALS_INVALID` and NOTHING is written, so a failed
 *    re-connection attempt leaves a previously working credential intact.
 * 6. Seal, then persist. The plaintext exists only as a local in this
 *    function and inside the provider call; it is never assigned to a stored
 *    object, never returned, never logged.
 *
 * A settings-only PUT (no `token`, against an already-connected Origen) skips
 * steps 4 and 5 entirely: there is no new credential to prove and no reason to
 * spend an Atlassian round trip — the stored sealed secret is carried forward
 * untouched (`secretSealed: undefined`, see `upsertWorkOrigin`). A first
 * connection with no `token` is a 400: there is nothing to keep.
 *
 * The response is the same public status `GET` returns — the client learns
 * that the write landed without the server ever echoing back what it wrote.
 */
const handlePutWorkOrigin = async (
    req: Request,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    const body = await readJsonBody(req, options.maxBodyBytes, options.signal);
    if (isBodyReadError(body)) {
        return tdahErrorResponse(TDAH_ERRORS.invalidBody, body.__mindwtrError.status);
    }
    const input = parseWorkOriginPutBody(body);
    if (!input) return tdahErrorResponse(TDAH_ERRORS.originInvalid, 400);
    const provider = resolveWorkOriginProvider(input.provider);
    if (!provider) return tdahErrorResponse(TDAH_ERRORS.originInvalid, 400);

    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }

        const existing = await readWorkOriginStatus(options.dataDir, ctx.key);
        // A first connection MUST carry a token; a re-save of an existing one
        // may omit it to keep the stored credential.
        if (input.token === undefined && !existing.connected) {
            return tdahErrorResponse(TDAH_ERRORS.originInvalid, 400);
        }

        // body → persisted → default. Falling straight to the default on a
        // re-save is what used to silently reset a customised window.
        const workStart = input.workStart ?? existing.workStart ?? TDAH_WORK_ORIGIN_DEFAULT_WORK_START;
        const workEnd = input.workEnd ?? existing.workEnd ?? TDAH_WORK_ORIGIN_DEFAULT_WORK_END;
        const pullIntervalMinutes = input.pullIntervalMinutes
            ?? existing.pullIntervalMinutes
            ?? TDAH_WORK_ORIGIN_DEFAULT_PULL_INTERVAL_MINUTES;
        // Lexically comparable because both are zero-padded `HH:mm`. A window
        // that does not run forward would make the pull gate never open (and
        // the band's duration negative), so it is rejected rather than clamped.
        if (workStart >= workEnd) return tdahErrorResponse(TDAH_ERRORS.originInvalid, 400);

        let secretSealed: string | undefined;
        if (input.token !== undefined) {
            const encryptionKey = resolveOriginEncryptionKey(process.env);
            if (!encryptionKey) {
                return tdahErrorResponse(TDAH_ERRORS.originKeyUnavailable, 503);
            }
            const credentials = { siteUrl: input.siteUrl, email: input.email, token: input.token };
            const validation = await provider.validateCredentials(credentials, options.fetchImpl ?? fetch);
            if (validation.kind === 'invalid-credentials') {
                return tdahErrorResponse(TDAH_ERRORS.originCredentialsInvalid, 400);
            }
            if (validation.kind === 'unreachable') {
                return tdahErrorResponse(TDAH_ERRORS.originUnreachable, 502);
            }
            secretSealed = sealOriginSecret(encryptionKey, ctx.key, input.token);
        }

        const status = await upsertWorkOrigin(options.dataDir, ctx.key, {
            provider: input.provider,
            siteUrl: input.siteUrl,
            email: input.email,
            ...(secretSealed !== undefined ? { secretSealed } : {}),
            jql: provider.describeQuery(),
            workStart,
            workEnd,
            pullIntervalMinutes,
        });
        const responseBody: TdahWorkOriginResponse = status;
        return jsonResponse(responseBody);
    } catch (error) {
        // `.code` only — never the caught error's message, which for a failed
        // outbound request embeds the site URL.
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * DELETE /v1/tdah/origin — doc 06 zone 5's "Desconectar". Removes the
 * credential and the snapshot; every band already materialized keeps existing
 * and stays visible in the Historial (see `deleteWorkOrigin`, storage.ts).
 *
 * Idempotent: 200 even when nothing was connected. Deliberately NOT gated on
 * `profile.mode === 'on'`, unlike GET/PUT/sync — a user who turned the mode
 * off must still be able to revoke a stored credential, and refusing that
 * would be the one place where the mode toggle traps a secret on the server.
 * The confirmation dialog the UX asks for is a client concern (T-13), not a
 * second server-side gate.
 */
const handleDeleteWorkOrigin = async (ctx: TdahRequestContext, options: TdahRequestOptions): Promise<Response> => {
    try {
        await deleteWorkOrigin(options.dataDir, ctx.key);
        return jsonResponse({ deleted: true });
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * POST /v1/tdah/origin/sync — T-13's manual "reintentar" (doc 06: the sync
 * state is what the user comes to look at when something breaks, so they need
 * a way to act on it without waiting out the interval).
 *
 * Runs exactly the tick's own per-namespace logic (`runNamespaceWorkOriginPull`)
 * with both scheduling gates bypassed — a person tapping retry has already
 * decided that now is the moment. Everything else is identical, so there is
 * no second code path where the credential could be handled differently.
 *
 * A pull failure that PERSISTED its reason (bad credentials, unreachable
 * site, missing key, full day) answers 200 with the refreshed status: the
 * failure is already in `lastErrorCode`, which is precisely the field T-13
 * renders, and an HTTP error would repeat what the body already says while
 * losing the rest of the state the screen needs.
 *
 * `storageFailed` is the exception, and is a 500. Nothing was persisted in
 * that case — writing an error code would have needed the storage that just
 * failed — so a 200 there would hand the client a stale, healthy-looking
 * status and no indication at all that the retry it just asked for never
 * happened.
 */
const handleSyncWorkOrigin = async (ctx: TdahRequestContext, options: TdahRequestOptions): Promise<Response> => {
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const status = await readWorkOriginStatus(options.dataDir, ctx.key);
        if (!status.connected) {
            return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
        }
        const outcome = await runNamespaceWorkOriginPull(
            options.dataDir,
            ctx.key,
            new Date(),
            options.fetchImpl ?? fetch,
            { ignoreSchedule: true },
        );
        if (outcome.kind === 'failed' && outcome.errorCode === TDAH_ERRORS.storageFailed) {
            return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
        }
        const responseBody: TdahWorkOriginResponse = await readWorkOriginStatus(options.dataDir, ctx.key);
        return jsonResponse(responseBody);
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

// --- Story 4.3: el DND (T-12) -----------------------------------------------
//
// Every handler below shares the module's FR-1 gate (409
// TDAH_ACTIVATE_REQUIRED unless the mode is on) and the same
// parse-before-any-I/O order the Origen's routes established, so a malformed
// window never reaches storage. None of them decides anything about
// suppression: the verdict comes from `dnd.ts` and travels back as
// `activeUntil` (AD-8).

/** GET /v1/tdah/dnd — T-12's whole read: the settings, every window (manual and calendar-derived) and the server-computed `activeUntil`. */
const handleGetDnd = async (ctx: TdahRequestContext, options: TdahRequestOptions): Promise<Response> => {
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const responseBody: TdahDndResponse = await readDndState(options.dataDir, ctx.key, profile.timeZone);
        return jsonResponse(responseBody);
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * PUT /v1/tdah/dnd — doc 06 zones 2 and 3: the calendar-detection toggle and
 * the working window that bounds it.
 *
 * `workStart < workEnd` is checked on the MERGED pair (body over persisted over
 * default), the same way `handlePutWorkOrigin` checks the Origen's — a
 * settings-only PUT that omits one half must not be validated against a
 * default the user never chose.
 */
const handlePutDnd = async (
    req: Request,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    const body = await readJsonBody(req, options.maxBodyBytes, options.signal);
    if (isBodyReadError(body)) {
        return tdahErrorResponse(TDAH_ERRORS.invalidBody, body.__mindwtrError.status);
    }
    const input = parseDndSettingsInput(body);
    if (!input) return tdahErrorResponse(TDAH_ERRORS.dndInvalid, 400);
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const existing = await readDndState(options.dataDir, ctx.key, profile.timeZone);
        const workStart = input.workStart ?? existing.settings.workStart;
        const workEnd = input.workEnd ?? existing.settings.workEnd;
        // Lexically comparable because both are zero-padded `HH:mm`. A window
        // that does not run forward would silently disable every calendar
        // detection, so it is rejected rather than clamped — same call the
        // Origen's own window makes.
        if (workStart >= workEnd) return tdahErrorResponse(TDAH_ERRORS.dndInvalid, 400);
        // The check above is only the fast path: it reads the stored pair
        // OUTSIDE the write transaction, so two concurrent partial PUTs could
        // each pass it and still merge into an inverted window. The invariant
        // itself is enforced by `mutateUpsertDndSettings`, inside the held
        // transaction, and surfaces here as the very same 400.
        const outcome = await upsertDndSettings(options.dataDir, ctx.key, profile.timeZone, input);
        if (outcome.status !== 'ok') return tdahErrorResponse(TDAH_ERRORS.dndInvalid, 400);
        const responseBody: TdahDndResponse = outcome.response;
        return jsonResponse(responseBody);
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/** Shared 409 mapping for the two by-id window mutations: a `source='calendar'` row is `TDAH_DND_READ_ONLY`, a missing one is a plain 404. */
const dndWindowRejectionResponse = (
    outcome: { status: 'notFound' } | { status: 'rejected'; reason: 'dndLimit' | 'dndReadOnly' },
): Response => {
    if (outcome.status === 'notFound') return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
    return outcome.reason === 'dndLimit'
        ? tdahErrorResponse(TDAH_ERRORS.dndLimit, 409)
        : tdahErrorResponse(TDAH_ERRORS.dndReadOnly, 409);
};

/** POST /v1/tdah/dnd/windows — doc 06 zone 4: a new MANUAL window (weekly or one-off). 409 TDAH_DND_LIMIT past `TDAH_DND_MAX_MANUAL_WINDOWS`. */
const handleCreateDndWindow = async (
    req: Request,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    const body = await readJsonBody(req, options.maxBodyBytes, options.signal);
    if (isBodyReadError(body)) {
        return tdahErrorResponse(TDAH_ERRORS.invalidBody, body.__mindwtrError.status);
    }
    const input = parseManualWindowInput(body);
    if (!input) return tdahErrorResponse(TDAH_ERRORS.dndInvalid, 400);
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const outcome = await createDndWindow(options.dataDir, ctx.key, profile.timeZone, input);
        if (outcome.status !== 'ok') return dndWindowRejectionResponse(outcome);
        const responseBody: TdahDndResponse = outcome.response;
        return jsonResponse(responseBody, { status: 201 });
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/** PUT /v1/tdah/dnd/windows/:id — edits one MANUAL window. A calendar-derived row is 409 TDAH_DND_READ_ONLY with nothing written (the next sync would replace it anyway). */
const handleUpdateDndWindow = async (
    req: Request,
    windowId: string,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    const body = await readJsonBody(req, options.maxBodyBytes, options.signal);
    if (isBodyReadError(body)) {
        return tdahErrorResponse(TDAH_ERRORS.invalidBody, body.__mindwtrError.status);
    }
    const input = parseManualWindowInput(body);
    if (!input) return tdahErrorResponse(TDAH_ERRORS.dndInvalid, 400);
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const outcome = await updateDndWindow(options.dataDir, ctx.key, profile.timeZone, windowId, input);
        if (outcome.status !== 'ok') return dndWindowRejectionResponse(outcome);
        const responseBody: TdahDndResponse = outcome.response;
        return jsonResponse(responseBody);
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/** DELETE /v1/tdah/dnd/windows/:id — same read-only rule as the PUT above. */
const handleDeleteDndWindow = async (
    windowId: string,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const outcome = await deleteDndWindow(options.dataDir, ctx.key, profile.timeZone, windowId);
        if (outcome.status !== 'ok') return dndWindowRejectionResponse(outcome);
        const responseBody: TdahDndResponse = outcome.response;
        return jsonResponse(responseBody);
    } catch (error) {
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

/**
 * PUT /v1/tdah/dnd/calendar — the phone's observation, and the concrete AD-8
 * boundary. The body is nothing but `{rangeStart, rangeEnd, events:[{startsAt,
 * endsAt}]}` in raw UTC ISO: no titles, no calendar names, no wall-clock times,
 * no "is this in working hours" judgment. Everything after that happens here —
 * `materializeCalendarWindows` converts each instant into the PROFILE's zone
 * (which may differ from the device's, AD-6), splits by local midnight, clips
 * to the DND working window and drops whatever is left empty — and
 * `replaceDndCalendarWindows` swaps that range's projection in block, never
 * touching a manual window.
 *
 * Replacing a whole range (rather than upserting events) is what lets a
 * cancelled meeting disappear: it is expressed by its ABSENCE from the payload.
 */
const handleSyncDndCalendar = async (
    req: Request,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response> => {
    const body = await readJsonBody(req, options.maxBodyBytes, options.signal);
    if (isBodyReadError(body)) {
        return tdahErrorResponse(TDAH_ERRORS.invalidBody, body.__mindwtrError.status);
    }
    const input = parseCalendarSyncInput(body);
    if (!input) return tdahErrorResponse(TDAH_ERRORS.dndInvalid, 400);
    try {
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        if (!profile || profile.mode !== 'on') {
            return tdahErrorResponse(TDAH_ERRORS.activateRequired, 409);
        }
        const existing = await readDndState(options.dataDir, ctx.key, profile.timeZone);
        const windows = materializeCalendarWindows(
            input.events,
            profile.timeZone,
            existing.settings.workStart,
            existing.settings.workEnd,
        );
        // The range's own local-date bounds, resolved in the profile's zone for
        // exactly the same reason the events are: the phone reports absolute
        // instants, and the rows are keyed by local calendar day.
        const rangeStartDate = formatDateInTimeZone(new Date(input.rangeStartMs), profile.timeZone);
        const rangeEndDate = formatDateInTimeZone(new Date(input.rangeEndMs), profile.timeZone);
        const responseBody: TdahDndResponse = await replaceDndCalendarWindows(
            options.dataDir,
            ctx.key,
            profile.timeZone,
            windows,
            rangeStartDate,
            rangeEndDate,
        );
        return jsonResponse(responseBody);
    } catch (error) {
        // `.code` only — never the caught error's message, and never anything
        // read out of the user's calendar.
        logError('request failed', {
            failureClass: 'filesystem',
            failureCode: 'request_failed',
            failureErrno: getFsErrorCode(error),
        });
        return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
    }
};

export async function handleTdahRequest(
    req: Request,
    pathname: string,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response | null> {
    if (pathname === TDAH_ACTIVATE_PATH) {
        if (req.method !== 'POST') {
            return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        }
        return handleActivate(req, ctx, options);
    }

    if (pathname === TDAH_ROUTINES_PATH_PREFIX) {
        if (req.method === 'GET') return handleListRoutines(ctx, options);
        if (req.method === 'POST') return handleCreateRoutine(req, ctx, options);
        return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
    }

    // Must be checked before TDAH_ROUTINE_ID_PATTERN below — "conflicts" would
    // otherwise fail parsePositiveIntegerId's numeric check and 404, instead of the
    // clean 200 this fixed path is supposed to return.
    if (pathname === TDAH_ROUTINE_CONFLICTS_PATH) {
        if (req.method !== 'GET') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleGetRoutineConflicts(ctx, options);
    }

    const previewMatch = pathname.match(TDAH_ROUTINE_PREVIEW_PATTERN);
    if (previewMatch) {
        const routineId = parsePositiveIntegerId(previewMatch[1] as string);
        if (routineId === null) return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
        if (req.method !== 'GET') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleGetRoutinePreview(req, routineId, ctx, options);
    }

    const itemMatch = pathname.match(TDAH_ROUTINE_ID_PATTERN);
    if (itemMatch) {
        const routineId = parsePositiveIntegerId(itemMatch[1] as string);
        if (routineId === null) return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
        if (req.method === 'GET') return handleGetRoutine(routineId, ctx, options);
        if (req.method === 'PUT') return handleUpdateRoutine(req, routineId, ctx, options);
        if (req.method === 'DELETE') return handleDeleteRoutine(routineId, ctx, options);
        return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
    }

    // Story 3.3 — T-06's morning editor / T-07's confirm. Must be checked
    // ahead of TDAH_DAY_PATH/TDAH_DAY_ACTIVITIES_PATH and
    // TDAH_PROFILE_PATH's catch-all fallback below — no real string collision
    // (exact-path dispatch), kept for the same clarity every other sub-path
    // in this dispatcher already follows.
    if (pathname === TDAH_DAY_TOMORROW_CONFIRM_PATH) {
        if (req.method !== 'POST') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleConfirmMorning(req, ctx, options);
    }

    if (pathname === TDAH_DAY_TOMORROW_ACTIVITIES_PATH) {
        if (req.method !== 'POST') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleCreateManualActivityForTomorrow(req, ctx, options);
    }

    if (pathname === TDAH_DAY_TOMORROW_PATH) {
        if (req.method !== 'GET') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleGetTomorrowDay(ctx, options);
    }

    // Story 1.6 — "Hoy". Must be checked ahead of `TDAH_PROFILE_PATH`'s
    // catch-all fallback below, the same way the routine sub-paths above are.
    if (pathname === TDAH_DAY_PATH) {
        if (req.method !== 'GET') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleGetDay(ctx, options);
    }

    if (pathname === TDAH_DAY_ACTIVITIES_PATH) {
        if (req.method !== 'POST') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleCreateManualActivity(req, ctx, options);
    }

    const activityActionMatch = pathname.match(TDAH_ACTIVITY_ACTION_PATTERN);
    if (activityActionMatch) {
        const activityId = parsePositiveIntegerId(activityActionMatch[1] as string);
        if (activityId === null) return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
        if (req.method !== 'POST') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        const action = activityActionMatch[2] as TdahActivityTransitionAction;
        return handleTransitionActivity(activityId, action, ctx, options);
    }

    // Story 3.4 — El Limbo (T-08). Must be checked ahead of
    // TDAH_ACTIVITY_DECIDE_PATTERN below (so `/v1/tdah/limbo/decide` is never
    // shadowed by the single-id `/activities/:id/decide` pattern) and ahead
    // of TDAH_PROFILE_PATH's catch-all fallback, same as every other sub-path
    // above. The more specific `.../decide` path is checked first, same
    // ordering `TDAH_DAY_TOMORROW_CONFIRM_PATH` uses ahead of
    // `TDAH_DAY_TOMORROW_PATH` above.
    if (pathname === TDAH_LIMBO_DECIDE_PATH) {
        if (req.method !== 'POST') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleDecideLimboBatch(req, ctx, options);
    }

    if (pathname === TDAH_LIMBO_PATH) {
        if (req.method !== 'GET') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleGetLimbo(ctx, options);
    }

    // Story 3.2 — must be checked ahead of TDAH_PROFILE_PATH's catch-all
    // fallback below, same as every other sub-path above.
    const decideMatch = pathname.match(TDAH_ACTIVITY_DECIDE_PATTERN);
    if (decideMatch) {
        const activityId = parsePositiveIntegerId(decideMatch[1] as string);
        if (activityId === null) return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
        if (req.method !== 'POST') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleDecideActivity(req, activityId, ctx, options);
    }

    // Story 3.5 — T-09 Historial / T-10 Métricas. Must be checked ahead of
    // TDAH_PROFILE_PATH's catch-all fallback below, same as every other
    // sub-path above.
    if (pathname === TDAH_HISTORY_PATH) {
        if (req.method !== 'GET') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleGetHistory(req, ctx, options);
    }

    if (pathname === TDAH_METRICS_PATH) {
        if (req.method !== 'GET') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleGetMetrics(req, ctx, options);
    }

    // Story 4.1 — T-13's Origen de trabajo. The more specific `.../origin/sync`
    // is matched first (same ordering `TDAH_LIMBO_DECIDE_PATH` uses ahead of
    // `TDAH_LIMBO_PATH`), and both ahead of `TDAH_PROFILE_PATH`'s catch-all
    // fallback below, same as every other sub-path above.
    if (pathname === TDAH_ORIGIN_SYNC_PATH) {
        if (req.method !== 'POST') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleSyncWorkOrigin(ctx, options);
    }

    if (pathname === TDAH_ORIGIN_PATH) {
        if (req.method === 'GET') return handleGetWorkOrigin(ctx, options);
        if (req.method === 'PUT') return handlePutWorkOrigin(req, ctx, options);
        if (req.method === 'DELETE') return handleDeleteWorkOrigin(ctx, options);
        return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
    }

    // Story 4.3 — T-12's DND, dispatched MOST SPECIFIC FIRST
    // (`/dnd/calendar` -> `/dnd/windows/:id` -> `/dnd/windows` -> `/dnd`) so a
    // sub-path can never be swallowed by a shorter one, and all of them ahead
    // of `TDAH_PROFILE_PATH`'s catch-all fallback below — the same ordering
    // every other family in this dispatcher follows.
    if (pathname === TDAH_DND_CALENDAR_PATH) {
        if (req.method !== 'PUT') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleSyncDndCalendar(req, ctx, options);
    }

    const dndWindowMatch = pathname.match(TDAH_DND_WINDOW_ID_PATTERN);
    if (dndWindowMatch) {
        // A window id is an opaque UUID string (not a positive integer like
        // every other id in this module), so it is passed through as-is; a
        // nonexistent one simply resolves to 404 in the handler.
        //
        // The decode runs OUTSIDE any handler's try/catch, so a malformed
        // percent-escape (`%E0%A4%A`) would otherwise throw a `URIError`
        // straight out of the dispatcher and become a 500. An unparseable id
        // is an id that matches nothing, so it answers 404 — the same outcome
        // `parsePositiveIntegerId` returning `null` produces for every other
        // id in this dispatcher.
        let windowId: string;
        try {
            windowId = decodeURIComponent(dndWindowMatch[1] as string);
        } catch {
            return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
        }
        if (req.method === 'PUT') return handleUpdateDndWindow(req, windowId, ctx, options);
        if (req.method === 'DELETE') return handleDeleteDndWindow(windowId, ctx, options);
        return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
    }

    if (pathname === TDAH_DND_WINDOWS_PATH) {
        if (req.method !== 'POST') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleCreateDndWindow(req, ctx, options);
    }

    if (pathname === TDAH_DND_PATH) {
        if (req.method === 'GET') return handleGetDnd(ctx, options);
        if (req.method === 'PUT') return handlePutDnd(req, ctx, options);
        return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
    }

    if (pathname !== TDAH_PROFILE_PATH) {
        return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
    }

    if (req.method === 'GET') {
        try {
            const profile = await readTdahProfile(options.dataDir, ctx.key);
            const responseBody: TdahProfileResponse = { profile };
            return jsonResponse(responseBody);
        } catch (error) {
            logError('request failed', {
                failureClass: 'filesystem',
                failureCode: 'request_failed',
                failureErrno: getFsErrorCode(error),
            });
            return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
        }
    }

    if (req.method === 'PUT') {
        const body = await readJsonBody(req, options.maxBodyBytes, options.signal);
        if (isBodyReadError(body)) {
            // Same as handleActivate: `body.__mindwtrError.status` already
            // distinguishes a genuinely oversized payload (413) from a request
            // abort/timeout (408) — a hardcoded 413 here would misreport an
            // abort as Payload Too Large.
            return tdahErrorResponse(TDAH_ERRORS.invalidBody, body.__mindwtrError.status);
        }
        const parsed = parseProfilePutBody(body);
        if (!parsed.ok) {
            return tdahErrorResponse(parsed.code, 400);
        }
        try {
            const existing = await readTdahProfile(options.dataDir, ctx.key);
            if (!existing && parsed.body.mode === undefined) {
                return tdahErrorResponse(TDAH_ERRORS.invalidBody, 400);
            }
            const profile = await upsertTdahProfile(options.dataDir, ctx.key, {
                mode: parsed.body.mode,
                timeZone: parsed.body.timeZone,
                ritualHour: parsed.body.ritualHour,
            });
            const responseBody: TdahProfileResponse = { profile };
            return jsonResponse(responseBody);
        } catch (error) {
            logError('request failed', {
                failureClass: 'filesystem',
                failureCode: 'request_failed',
                failureErrno: getFsErrorCode(error),
            });
            return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
        }
    }

    return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
}

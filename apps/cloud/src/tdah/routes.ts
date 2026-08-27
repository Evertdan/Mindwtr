/**
 * HTTP surface of the TDAH module: GET/PUT `/v1/tdah/profile`,
 * POST `/v1/tdah/activate`, the `/v1/tdah/routines*` Rutina CRUD (story 1.4)
 * — GET/POST `/v1/tdah/routines`, GET/PUT/DELETE `/v1/tdah/routines/:id`,
 * GET `/v1/tdah/routines/:id/preview`, and GET `/v1/tdah/routines/conflicts`
 * — and the "Hoy" surface (story 1.6): GET `/v1/tdah/day`,
 * POST `/v1/tdah/day/activities`,
 * POST `/v1/tdah/activities/:id/{start|complete|miss}`, and (story 3.2, T-05)
 * POST `/v1/tdah/activities/:id/decide`. PUT `/tdah/profile`
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
    computeRoutineConflicts,
    createManualActivity,
    createRoutine,
    decideActivity,
    deleteRoutine,
    getRoutineWithBlocks,
    getTodayDayPlan,
    isValidDateString,
    isValidMonthString,
    listRoutinesWithBlocks,
    readTdahProfile,
    TDAH_BLOCK_DURATION_MAX_MINUTES,
    TDAH_ROUTINE_TITLE_MAX_LENGTH,
    transitionActivityState,
    type TdahCreateManualActivityInput,
    updateRoutine,
    upsertTdahProfile,
} from './storage';
import {
    isTdahMode,
    TDAH_ERRORS,
    type TdahActivateResponse,
    type TdahActivityDecideRequest,
    type TdahActivityResponse,
    type TdahActivityTransitionAction,
    type TdahDayResponse,
    type TdahErrorCode,
    type TdahMode,
    type TdahProfileResponse,
    type TdahRoutinePattern,
    type TdahRoutineBlockInput,
    type TdahRoutineInput,
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

export type TdahRequestContext = {
    key: string;
};

export type TdahRequestOptions = {
    dataDir: string;
    maxBodyBytes: number;
    signal?: AbortSignal;
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
    if (raw.decision === 'move-tomorrow' || raw.decision === 'discard' || raw.decision === 'undated') {
        return { decision: raw.decision };
    }
    if (raw.decision === 'move-date') {
        if (typeof raw.date !== 'string' || !isValidDateString(raw.date)) return null;
        return { decision: 'move-date', date: raw.date };
    }
    return null;
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

    // Story 3.2 — must be checked ahead of TDAH_PROFILE_PATH's catch-all
    // fallback below, same as every other sub-path above.
    const decideMatch = pathname.match(TDAH_ACTIVITY_DECIDE_PATTERN);
    if (decideMatch) {
        const activityId = parsePositiveIntegerId(decideMatch[1] as string);
        if (activityId === null) return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
        if (req.method !== 'POST') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleDecideActivity(req, activityId, ctx, options);
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

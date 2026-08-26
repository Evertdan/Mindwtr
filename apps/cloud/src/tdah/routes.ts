/**
 * HTTP surface of the TDAH module: GET/PUT `/v1/tdah/profile`,
 * POST `/v1/tdah/activate`, and the `/v1/tdah/routines*` Rutina CRUD
 * (story 1.4) — GET/POST `/v1/tdah/routines`, GET/PUT/DELETE
 * `/v1/tdah/routines/:id`, GET `/v1/tdah/routines/:id/preview`, and
 * GET `/v1/tdah/routines/conflicts`. PUT `/tdah/profile` only ever sets
 * `mode:'off'` or updates timeZone/ritualHour on an existing profile —
 * POST /activate is the only way to set `mode:'on'`, and PUT rejects a
 * `mode:'on'` body outright with `TDAH_ACTIVATE_REQUIRED`.
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
    createRoutine,
    deleteRoutine,
    getRoutineWithBlocks,
    isValidMonthString,
    listRoutinesWithBlocks,
    readTdahProfile,
    TDAH_BLOCK_DURATION_MAX_MINUTES,
    TDAH_DEFAULT_TIME_ZONE,
    TDAH_ROUTINE_TITLE_MAX_LENGTH,
    updateRoutine,
    upsertTdahProfile,
} from './storage';
import {
    isTdahMode,
    TDAH_ERRORS,
    type TdahActivateResponse,
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

const IANA_TIME_ZONE_PATTERN = /^[A-Za-z0-9+_/-]{1,64}$/;
const RITUAL_HOUR_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
// A single day's routine cannot reasonably need more Bloques than this —
// caps the otherwise-unbounded `blocks` array on the input.
const TDAH_ROUTINE_MAX_BLOCKS = 24;
const TDAH_WEEKDAY_NUMBERS = [0, 1, 2, 3, 4, 5, 6];
const TDAH_NTH_WEEKDAY_ORDINALS = [-1, 1, 2, 3, 4];

const parseRoutineId = (raw: string): number | null => {
    if (!/^\d+$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
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
    if (raw.ritualHour !== undefined && !RITUAL_HOUR_PATTERN.test(raw.ritualHour)) {
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
    if (raw.ritualHour !== undefined && !RITUAL_HOUR_PATTERN.test(raw.ritualHour)) {
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
 * requests/renders). Uses the caller's profile time zone, falling back to
 * `TDAH_DEFAULT_TIME_ZONE` the same way profile creation does.
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
        const profile = await readTdahProfile(options.dataDir, ctx.key);
        const timeZone = profile?.timeZone ?? TDAH_DEFAULT_TIME_ZONE;
        const dates = await computeApplicabilityPreview(options.dataDir, ctx.key, routineId, month, timeZone);
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
    // otherwise fail parseRoutineId's numeric check and 404, instead of the
    // clean 200 this fixed path is supposed to return.
    if (pathname === TDAH_ROUTINE_CONFLICTS_PATH) {
        if (req.method !== 'GET') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleGetRoutineConflicts(ctx, options);
    }

    const previewMatch = pathname.match(TDAH_ROUTINE_PREVIEW_PATTERN);
    if (previewMatch) {
        const routineId = parseRoutineId(previewMatch[1] as string);
        if (routineId === null) return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
        if (req.method !== 'GET') return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
        return handleGetRoutinePreview(req, routineId, ctx, options);
    }

    const itemMatch = pathname.match(TDAH_ROUTINE_ID_PATTERN);
    if (itemMatch) {
        const routineId = parseRoutineId(itemMatch[1] as string);
        if (routineId === null) return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
        if (req.method === 'GET') return handleGetRoutine(routineId, ctx, options);
        if (req.method === 'PUT') return handleUpdateRoutine(req, routineId, ctx, options);
        if (req.method === 'DELETE') return handleDeleteRoutine(routineId, ctx, options);
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
            return tdahErrorResponse(TDAH_ERRORS.invalidBody, 413);
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

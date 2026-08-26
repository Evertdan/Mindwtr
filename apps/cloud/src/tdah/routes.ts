/**
 * HTTP surface of the TDAH module: GET/PUT `/v1/tdah/profile` and
 * POST `/v1/tdah/activate`. PUT only ever sets `mode:'off'` or updates
 * timeZone/ritualHour on an existing profile — POST /activate is the only
 * way to set `mode:'on'`, and PUT rejects a `mode:'on'` body outright with
 * `TDAH_ACTIVATE_REQUIRED`.
 *
 * Mounted additively by server.ts under its own prefix (ADR 0026) — every
 * request arrives already authenticated, rate-limited and namespace-admitted
 * via `withNamespace`, with the caller's identity being `ctx.key`. Error
 * bodies are always `{error: {code: 'TDAH_…'}}`; raw fs/sqlite `.message`
 * values never reach a response (cloud logging/privacy policy).
 */
import { getFsErrorCode, isBodyReadError, readJsonBody } from '../server-storage';
import { jsonResponse, logError } from '../server-config';
import { activateTdahProfile, readTdahProfile, upsertTdahProfile } from './storage';
import {
    isTdahMode,
    TDAH_ERRORS,
    type TdahActivateResponse,
    type TdahErrorCode,
    type TdahMode,
    type TdahProfileResponse,
    type TdahRoutineBlockInput,
    type TdahRoutineInput,
} from './types';

export const TDAH_PATH_PREFIX = '/v1/tdah';
const TDAH_PROFILE_PATH = `${TDAH_PATH_PREFIX}/profile`;
const TDAH_ACTIVATE_PATH = `${TDAH_PATH_PREFIX}/activate`;

const IANA_TIME_ZONE_PATTERN = /^[A-Za-z0-9+_/-]{1,64}$/;
const RITUAL_HOUR_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
// A single day's routine cannot reasonably need more Bloques than this —
// caps the otherwise-unbounded `blocks` array on the input.
const TDAH_ROUTINE_MAX_BLOCKS = 24;

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

type TdahRoutineBody = {
    title?: unknown;
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
    if (typeof raw.durationMinutes !== 'number' || !Number.isInteger(raw.durationMinutes) || raw.durationMinutes <= 0) {
        return null;
    }
    // Persist the trimmed title — the untrimmed raw.title was only used above
    // to reject whitespace-only input.
    return { title: raw.title.trim(), startTime: raw.startTime, durationMinutes: raw.durationMinutes };
};

/** `startTime` is already RITUAL_HOUR_PATTERN-validated ("HH:mm") by the time this runs. */
const startTimeToMinutes = (startTime: string): number => {
    const [hours, minutes] = startTime.split(':').map(Number);
    return (hours as number) * 60 + (minutes as number);
};

/** True when any two Bloques' [start, start+duration) ranges intersect. */
const hasOverlappingBlocks = (blocks: TdahRoutineBlockInput[]): boolean => {
    const sorted = [...blocks].sort((a, b) => startTimeToMinutes(a.startTime) - startTimeToMinutes(b.startTime));
    for (let i = 1; i < sorted.length; i += 1) {
        const previous = sorted[i - 1] as TdahRoutineBlockInput;
        const current = sorted[i] as TdahRoutineBlockInput;
        const previousEnd = startTimeToMinutes(previous.startTime) + previous.durationMinutes;
        if (startTimeToMinutes(current.startTime) < previousEnd) {
            return true;
        }
    }
    return false;
};

const parseRoutineInput = (value: unknown): TdahRoutineInput | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const raw = value as TdahRoutineBody;
    if (typeof raw.title !== 'string' || raw.title.trim().length === 0) return null;
    if (!Array.isArray(raw.blocks) || raw.blocks.length === 0 || raw.blocks.length > TDAH_ROUTINE_MAX_BLOCKS) {
        return null;
    }
    const blocks: TdahRoutineBlockInput[] = [];
    for (const rawBlock of raw.blocks) {
        const block = parseRoutineBlockInput(rawBlock);
        if (!block) return null;
        blocks.push(block);
    }
    if (hasOverlappingBlocks(blocks)) return null;
    // Persist the trimmed title — the untrimmed raw.title was only used above
    // to reject whitespace-only input.
    return { title: raw.title.trim(), blocks };
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

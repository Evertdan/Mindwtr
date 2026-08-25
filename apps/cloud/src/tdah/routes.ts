/**
 * HTTP surface of the TDAH module: GET/PUT `/v1/tdah/profile`.
 *
 * Mounted additively by server.ts under its own prefix (ADR 0026) — every
 * request arrives already authenticated, rate-limited and namespace-admitted
 * via `withNamespace`, with the caller's identity being `ctx.key`. Error
 * bodies are always `{error: {code: 'TDAH_…'}}`; raw fs/sqlite `.message`
 * values never reach a response (cloud logging/privacy policy).
 */
import { isBodyReadError, readJsonBody } from '../server-storage';
import { jsonResponse } from '../server-config';
import { readTdahProfile, upsertTdahProfile } from './storage';
import { isTdahMode, TDAH_ERRORS, type TdahErrorCode, type TdahMode, type TdahProfileResponse } from './types';

export const TDAH_PATH_PREFIX = '/v1/tdah';
const TDAH_PROFILE_PATH = `${TDAH_PATH_PREFIX}/profile`;

const IANA_TIME_ZONE_PATTERN = /^[A-Za-z0-9+_/-]{1,64}$/;
const RITUAL_HOUR_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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
    const parsed: TdahParsedProfilePut = {};
    if (raw.mode !== undefined) parsed.mode = raw.mode;
    if (raw.timeZone !== undefined) parsed.timeZone = raw.timeZone;
    if (raw.ritualHour !== undefined) parsed.ritualHour = raw.ritualHour;
    return { ok: true, body: parsed };
};

export async function handleTdahRequest(
    req: Request,
    pathname: string,
    ctx: TdahRequestContext,
    options: TdahRequestOptions,
): Promise<Response | null> {
    if (pathname !== TDAH_PROFILE_PATH) {
        return tdahErrorResponse(TDAH_ERRORS.notFound, 404);
    }

    if (req.method === 'GET') {
        try {
            const profile = await readTdahProfile(options.dataDir, ctx.key);
            const responseBody: TdahProfileResponse = { profile };
            return jsonResponse(responseBody);
        } catch {
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
        } catch {
            return tdahErrorResponse(TDAH_ERRORS.storageFailed, 500);
        }
    }

    return tdahErrorResponse(TDAH_ERRORS.methodNotAllowed, 405);
}

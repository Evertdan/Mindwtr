import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { tokenToKey } from '../server-auth';
import { startCloudServer } from '../server';
import {
    activateTdahProfile,
    computeTomorrowDate,
    formatDateInTimeZone,
    isValidMonthString,
    listActiveTdahNamespaces,
    readTdahProfile,
    tdahDatabasePath,
} from './storage';
import { handleTdahRequest } from './routes';
import { runNightlyTdahTick } from './scheduler';

const TOKEN_ALPHA = 'tdah-token-alpha-1234567890';
const TOKEN_BETA = 'tdah-token-beta-1234567890';

type TdahTestProfile = {
    mode: string;
    timeZone: string;
    ritualHour: string;
    createdAt: string;
    updatedAt: string;
};

type TdahTestPattern =
    | { kind: 'weekday'; weekdays: number[] }
    | { kind: 'nthWeekdayOfMonth'; ordinal: number; weekday: number };

type TdahTestBlock = {
    id: number;
    routineId: number;
    title: string;
    startTime: string;
    durationMinutes: number;
    sortOrder: number;
};

type TdahTestRoutine = {
    id: number;
    title: string;
    pattern: TdahTestPattern;
    createdAt: string;
    blocks: TdahTestBlock[];
    overlapWarnings: { blockIndexA: number; blockIndexB: number }[];
    crossesMidnightWarnings: { blockIndex: number }[];
};

describe('tdah module', () => {
    let sandbox: string;
    let dataDir: string;
    let server: Awaited<ReturnType<typeof startCloudServer>> | null = null;
    let baseUrl: string;

    const authedFetch = (
        path: string,
        init: RequestInit & { token?: string } = {},
    ): Promise<Response> => {
        const { token = TOKEN_ALPHA, ...rest } = init;
        return fetch(`${baseUrl}${path}`, {
            ...rest,
            headers: {
                ...(rest.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                ...(rest.headers ?? {}),
                Authorization: `Bearer ${token}`,
            },
        });
    };

    const putProfile = (body: unknown, token?: string): Promise<Response> => (
        authedFetch('/v1/tdah/profile', { method: 'PUT', body: JSON.stringify(body), token })
    );

    const getProfile = (token?: string): Promise<Response> => (
        authedFetch('/v1/tdah/profile', { method: 'GET', token })
    );

    const activate = (body: unknown, token?: string): Promise<Response> => (
        authedFetch('/v1/tdah/activate', { method: 'POST', body: JSON.stringify(body), token })
    );

    const listRoutinesApi = (token?: string): Promise<Response> => (
        authedFetch('/v1/tdah/routines', { method: 'GET', token })
    );

    const createRoutineApi = (body: unknown, token?: string): Promise<Response> => (
        authedFetch('/v1/tdah/routines', { method: 'POST', body: JSON.stringify(body), token })
    );

    const getRoutineApi = (id: number, token?: string): Promise<Response> => (
        authedFetch(`/v1/tdah/routines/${id}`, { method: 'GET', token })
    );

    const updateRoutineApi = (id: number, body: unknown, token?: string): Promise<Response> => (
        authedFetch(`/v1/tdah/routines/${id}`, { method: 'PUT', body: JSON.stringify(body), token })
    );

    const deleteRoutineApi = (id: number, token?: string): Promise<Response> => (
        authedFetch(`/v1/tdah/routines/${id}`, { method: 'DELETE', token })
    );

    const previewRoutineApi = (id: number, month: string, token?: string): Promise<Response> => (
        authedFetch(`/v1/tdah/routines/${id}/preview?month=${month}`, { method: 'GET', token })
    );

    const readRoutine = async (response: Response): Promise<TdahTestRoutine> => (
        (await response.json() as { routine: TdahTestRoutine }).routine
    );

    const readRoutines = async (response: Response): Promise<TdahTestRoutine[]> => (
        (await response.json() as { routines: TdahTestRoutine[] }).routines
    );

    const readDates = async (response: Response): Promise<string[]> => (
        (await response.json() as { dates: string[] }).dates
    );

    // Story 1.4 widened `TdahRoutineInput.pattern` from an implicit
    // Mon-Fri-only default to a real calendar pattern, so a fixture with no
    // `pattern` at all now defaults to weekdays [1,2,3,4,5] — day-dependent
    // whenever "tomorrow" (in `computeTomorrowDate`'s real, unmocked system
    // clock) falls on a weekend. This fixture is used by tests that only care
    // about basic activation write-through, not the precedence engine, so it
    // gets an explicit every-day pattern to stay day-independent.
    const WORKDAY_ROUTINE = {
        title: 'Día laboral',
        pattern: { kind: 'weekday' as const, weekdays: [0, 1, 2, 3, 4, 5, 6] },
        blocks: [
            { title: 'Mañana', startTime: '08:00', durationMinutes: 120 },
            { title: 'Tarde', startTime: '14:00', durationMinutes: 180 },
        ],
    };

    type TdahTestActivateResponse = {
        profile: TdahTestProfile;
        routineCreated: boolean;
        dayPlan: { date: string; activityCount: number };
    };

    const readActivateResponse = async (response: Response): Promise<TdahTestActivateResponse> => (
        await response.json() as TdahTestActivateResponse
    );

    const readProfile = async (response: Response): Promise<TdahTestProfile | null> => {
        const body = await response.json() as { profile: TdahTestProfile | null };
        return body.profile;
    };

    const readErrorCode = async (response: Response): Promise<string> => {
        const body = await response.json() as { error?: { code?: string; message?: string } };
        return body.error?.code ?? 'MISSING_ERROR_CODE';
    };

    const expectInvalidBody = async (rawBody: string): Promise<void> => {
        const response = await authedFetch('/v1/tdah/profile', {
            method: 'PUT',
            body: rawBody,
            headers: { 'Content-Type': 'application/json' },
        });
        expect(response.status).toBe(400);
        expect(await readErrorCode(response)).toBe('TDAH_INVALID_BODY');
    };

    beforeEach(async () => {
        sandbox = mkdtempSync(join(tmpdir(), 'mindwtr-cloud-tdah-'));
        dataDir = join(sandbox, 'data');
        mkdirSync(dataDir, { recursive: true });
        server = await startCloudServer({
            host: '127.0.0.1',
            port: 0,
            dataDir,
            allowedAuthTokens: new Set([TOKEN_ALPHA, TOKEN_BETA]),
        });
        baseUrl = `http://127.0.0.1:${server.port}`;
    });

    afterEach(() => {
        server?.stop();
        server = null;
        rmSync(sandbox, { recursive: true, force: true });
    });

    test('GET without a profile returns 200 {profile: null} and plants nothing on disk', async () => {
        const response = await getProfile();
        expect(response.status).toBe(200);
        const body = await response.json() as { profile: TdahTestProfile | null };
        expect(body.profile).toBeNull();
        expect(existsSync(join(dataDir, tokenToKey(TOKEN_ALPHA)))).toBe(false);
    });

    test('first activation persists mode, detected time zone and the 23:00 ritual default in the namespace sqlite', async () => {
        const response = await activate({ timeZone: 'America/Mexico_City' });
        expect(response.status).toBe(200);
        const profile = await readProfile(response);
        expect(profile?.mode).toBe('on');
        expect(profile?.timeZone).toBe('America/Mexico_City');
        expect(profile?.ritualHour).toBe('23:00');
        expect(typeof profile?.createdAt).toBe('string');
        expect(typeof profile?.updatedAt).toBe('string');

        const key = tokenToKey(TOKEN_ALPHA);
        const databasePath = tdahDatabasePath(dataDir, key);
        expect(existsSync(databasePath)).toBe(true);

        const { Database } = await import('bun:sqlite');
        const database = new Database(databasePath, { readonly: true });
        try {
            const journalMode = database.prepare('PRAGMA journal_mode;').get() as { journal_mode?: string };
            expect(journalMode.journal_mode).toBe('wal');
            const row = database.prepare('SELECT mode, time_zone, ritual_hour FROM tdah_profile WHERE id = 1;').get() as {
                mode: string;
                time_zone: string;
                ritual_hour: string;
            };
            expect(row.mode).toBe('on');
            expect(row.time_zone).toBe('America/Mexico_City');
            expect(row.ritual_hour).toBe('23:00');
        } finally {
            database.close();
        }
    });

    test('activation without a time zone falls back to UTC', async () => {
        const response = await activate({});
        expect(response.status).toBe(200);
        const profile = await readProfile(response);
        expect(profile?.mode).toBe('on');
        expect(profile?.timeZone).toBe('UTC');
        expect(profile?.ritualHour).toBe('23:00');
    });

    test('invalid IANA time zone returns 400 TDAH_INVALID_TIME_ZONE without a raw message', async () => {
        const response = await putProfile({ mode: 'on', timeZone: 'No/Una::Zona' });
        expect(response.status).toBe(400);
        const raw = await response.json() as { error?: { code?: string } & Record<string, unknown> };
        expect(raw.error?.code).toBe('TDAH_INVALID_TIME_ZONE');
        expect(raw.error !== undefined && 'message' in raw.error).toBe(false);
    });

    test('syntactically valid but non-existent IANA time zone returns 400 TDAH_INVALID_TIME_ZONE', async () => {
        // 'Fake/Placeholder' matches IANA_TIME_ZONE_PATTERN (/^[A-Za-z0-9+_/-]{1,64}$/,
        // letters and a single '/' only) so it clears the syntactic check and
        // exercises the semantic Intl.DateTimeFormat check in isValidTimeZone.
        const response = await putProfile({ mode: 'on', timeZone: 'Fake/Placeholder' });
        expect(response.status).toBe(400);
        const raw = await response.json() as { error?: { code?: string } & Record<string, unknown> };
        expect(raw.error?.code).toBe('TDAH_INVALID_TIME_ZONE');
        expect(raw.error !== undefined && 'message' in raw.error).toBe(false);
    });

    test('invalid ritual hour returns 400 TDAH_INVALID_RITUAL_HOUR', async () => {
        const response = await putProfile({ mode: 'on', ritualHour: '25:99' });
        expect(response.status).toBe(400);
        expect(await readErrorCode(response)).toBe('TDAH_INVALID_RITUAL_HOUR');
    });

    test('malformed JSON body returns 400 TDAH_INVALID_BODY', async () => {
        await expectInvalidBody('not json{');
    });

    test('array body returns 400 TDAH_INVALID_BODY', async () => {
        await expectInvalidBody('[1,2,3]');
    });

    test('wrong mode type returns 400 TDAH_INVALID_BODY', async () => {
        await expectInvalidBody('{"mode":5}');
    });

    test('wrong time zone type returns 400 TDAH_INVALID_BODY', async () => {
        await expectInvalidBody('{"mode":"on","timeZone":42}');
    });

    test('creating a profile without mode returns 400 TDAH_INVALID_BODY', async () => {
        await expectInvalidBody('{}');
    });

    test("PUT mode:'on' is rejected — POST /activate is the only way to turn the mode on", async () => {
        const response = await putProfile({ mode: 'on' });
        expect(response.status).toBe(400);
        expect(await readErrorCode(response)).toBe('TDAH_ACTIVATE_REQUIRED');
    });

    test('deactivating keeps the profile row intact (time zone and ritual hour preserved)', async () => {
        await activate({ timeZone: 'Europe/Madrid', ritualHour: '22:30' });
        const response = await putProfile({ mode: 'off' });
        expect(response.status).toBe(200);
        const profile = await readProfile(response);
        expect(profile?.mode).toBe('off');
        expect(profile?.timeZone).toBe('Europe/Madrid');
        expect(profile?.ritualHour).toBe('22:30');
        expect(typeof profile?.createdAt).toBe('string');
    });

    test('reactivating after off does not reset time zone or ritual hour (FR-1)', async () => {
        await activate({ timeZone: 'Europe/Madrid', ritualHour: '22:30' });
        await putProfile({ mode: 'off' });
        const response = await activate({});
        expect(response.status).toBe(200);
        const profile = await readProfile(response);
        expect(profile?.mode).toBe('on');
        expect(profile?.timeZone).toBe('Europe/Madrid');
        expect(profile?.ritualHour).toBe('22:30');
    });

    test('requests without a valid token are rejected by the namespace gate with 401', async () => {
        const noToken = await fetch(`${baseUrl}/v1/tdah/profile`);
        expect(noToken.status).toBe(401);
        const badToken = await fetch(`${baseUrl}/v1/tdah/profile`, {
            headers: { Authorization: 'Bearer tdah-token-gamma-1234' },
        });
        expect(badToken.status).toBe(401);
    });

    test('DELETE /v1/tdah/profile returns 405 TDAH_METHOD_NOT_ALLOWED', async () => {
        const response = await authedFetch('/v1/tdah/profile', { method: 'DELETE' });
        expect(response.status).toBe(405);
        expect(await readErrorCode(response)).toBe('TDAH_METHOD_NOT_ALLOWED');
    });

    test('unknown tdah route returns 404 TDAH_NOT_FOUND', async () => {
        const response = await authedFetch('/v1/tdah/otra');
        expect(response.status).toBe(404);
        expect(await readErrorCode(response)).toBe('TDAH_NOT_FOUND');
    });

    test('two tokens get isolated sqlite databases under their own namespace', async () => {
        const alphaActivation = await activate({ timeZone: 'America/Mexico_City' }, TOKEN_ALPHA);
        expect(alphaActivation.status).toBe(200);
        const betaActivation = await activate({ timeZone: 'Asia/Tokyo', ritualHour: '21:00' }, TOKEN_BETA);
        expect(betaActivation.status).toBe(200);

        const alphaKey = tokenToKey(TOKEN_ALPHA);
        const betaKey = tokenToKey(TOKEN_BETA);
        expect(alphaKey).not.toBe(betaKey);
        expect(existsSync(tdahDatabasePath(dataDir, alphaKey))).toBe(true);
        expect(existsSync(tdahDatabasePath(dataDir, betaKey))).toBe(true);

        const alphaProfile = await readProfile(await getProfile(TOKEN_ALPHA));
        expect(alphaProfile?.timeZone).toBe('America/Mexico_City');
        expect(alphaProfile?.ritualHour).toBe('23:00');
        const betaProfile = await readProfile(await getProfile(TOKEN_BETA));
        expect(betaProfile?.timeZone).toBe('Asia/Tokyo');
        expect(betaProfile?.ritualHour).toBe('21:00');
    });

    test('concurrent activations for the same token all succeed and leave a coherent, non-mixed row', async () => {
        const writes = [
            { timeZone: 'America/Mexico_City', ritualHour: '20:00' },
            { timeZone: 'Europe/Madrid', ritualHour: '21:15' },
            { timeZone: 'Asia/Tokyo', ritualHour: '22:30' },
            { timeZone: 'America/New_York', ritualHour: '23:45' },
        ];

        const responses = await Promise.all(writes.map((body) => activate(body)));
        for (const response of responses) {
            expect(response.status).toBe(200);
        }

        const profile = await readProfile(await getProfile());
        const isCoherentCombination = writes.some((body) => (
            body.timeZone === profile?.timeZone && body.ritualHour === profile?.ritualHour
        ));
        expect(isCoherentCombination).toBe(true);
    });

    describe('POST /v1/tdah/activate', () => {
        test('first activation with a routine persists the profile, the Rutina/Bloques and tomorrow\'s DayPlan with Actividades', async () => {
            const response = await activate({
                timeZone: 'America/Mexico_City',
                ritualHour: '22:00',
                routine: WORKDAY_ROUTINE,
            });
            expect(response.status).toBe(200);
            const body = await readActivateResponse(response);
            expect(body.profile.mode).toBe('on');
            expect(body.profile.timeZone).toBe('America/Mexico_City');
            expect(body.profile.ritualHour).toBe('22:00');
            expect(body.routineCreated).toBe(true);
            expect(body.dayPlan.activityCount).toBe(WORKDAY_ROUTINE.blocks.length);
            expect(/^\d{4}-\d{2}-\d{2}$/.test(body.dayPlan.date)).toBe(true);

            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const { Database } = await import('bun:sqlite');
            const database = new Database(databasePath, { readonly: true });
            try {
                const routineRow = database.prepare('SELECT title, pattern_kind FROM tdah_routine;').get() as {
                    title: string;
                    pattern_kind: string;
                };
                expect(routineRow.title).toBe(WORKDAY_ROUTINE.title);
                expect(routineRow.pattern_kind).toBe('weekday');

                const blockRows = (database.prepare('SELECT title, start_time, duration_minutes, sort_order FROM tdah_routine_block ORDER BY sort_order;') as unknown as {
                    all(): { title: string; start_time: string; duration_minutes: number; sort_order: number }[];
                }).all();
                expect(blockRows).toHaveLength(2);
                expect(blockRows[0]?.title).toBe('Mañana');
                expect(blockRows[0]?.sort_order).toBe(0);
                expect(blockRows[1]?.title).toBe('Tarde');
                expect(blockRows[1]?.sort_order).toBe(1);

                const dayPlanRow = database.prepare('SELECT date FROM tdah_day_plan;').get() as { date: string };
                expect(dayPlanRow.date).toBe(body.dayPlan.date);

                const activityRows = (database.prepare('SELECT title, origin, state, day_plan_date FROM tdah_activity ORDER BY id;') as unknown as {
                    all(): { title: string; origin: string; state: string; day_plan_date: string }[];
                }).all();
                expect(activityRows).toHaveLength(2);
                for (const row of activityRows) {
                    expect(row.origin).toBe('routine');
                    expect(row.state).toBe('pending');
                    expect(row.day_plan_date).toBe(body.dayPlan.date);
                }
            } finally {
                database.close();
            }
        });

        test('first activation without a routine yields an empty DayPlan (no Actividades)', async () => {
            const response = await activate({ timeZone: 'Europe/Madrid' });
            expect(response.status).toBe(200);
            const body = await readActivateResponse(response);
            expect(body.profile.mode).toBe('on');
            expect(body.routineCreated).toBe(false);
            expect(body.dayPlan.activityCount).toBe(0);
        });

        test('retrying the same activation after a timeout never duplicates the Rutina or the DayPlan (idempotent)', async () => {
            const first = await activate({
                timeZone: 'America/Mexico_City',
                ritualHour: '22:00',
                routine: WORKDAY_ROUTINE,
            });
            expect(first.status).toBe(200);
            const firstBody = await readActivateResponse(first);

            const retry = await activate({
                timeZone: 'America/Mexico_City',
                ritualHour: '22:00',
                routine: WORKDAY_ROUTINE,
            });
            expect(retry.status).toBe(200);
            const retryBody = await readActivateResponse(retry);
            expect(retryBody.routineCreated).toBe(false);
            expect(retryBody.dayPlan.date).toBe(firstBody.dayPlan.date);
            expect(retryBody.dayPlan.activityCount).toBe(firstBody.dayPlan.activityCount);

            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const { Database } = await import('bun:sqlite');
            const database = new Database(databasePath, { readonly: true });
            try {
                const routineCount = database.prepare('SELECT COUNT(*) AS count FROM tdah_routine;').get() as { count: number };
                expect(routineCount.count).toBe(1);
                const dayPlanCount = database.prepare('SELECT COUNT(*) AS count FROM tdah_day_plan;').get() as { count: number };
                expect(dayPlanCount.count).toBe(1);
                const activityCount = database.prepare('SELECT COUNT(*) AS count FROM tdah_activity;').get() as { count: number };
                expect(activityCount.count).toBe(WORKDAY_ROUTINE.blocks.length);
            } finally {
                database.close();
            }
        });

        test('reactivating after off skips the routine step, keeps tz/ritualHour, and reuses the already-generated DayPlan', async () => {
            const first = await activate({
                timeZone: 'Europe/Madrid',
                ritualHour: '22:30',
                routine: WORKDAY_ROUTINE,
            });
            const firstBody = await readActivateResponse(first);
            await putProfile({ mode: 'off' });

            const reactivation = await activate({});
            expect(reactivation.status).toBe(200);
            const reactivationBody = await readActivateResponse(reactivation);
            expect(reactivationBody.profile.mode).toBe('on');
            expect(reactivationBody.profile.timeZone).toBe('Europe/Madrid');
            expect(reactivationBody.profile.ritualHour).toBe('22:30');
            expect(reactivationBody.routineCreated).toBe(false);
            expect(reactivationBody.dayPlan.date).toBe(firstBody.dayPlan.date);
            expect(reactivationBody.dayPlan.activityCount).toBe(firstBody.dayPlan.activityCount);
        });

        test('routine with an empty blocks array returns 400 TDAH_ROUTINE_INVALID', async () => {
            const response = await activate({
                timeZone: 'UTC',
                routine: { title: 'Día laboral', blocks: [] },
            });
            expect(response.status).toBe(400);
            expect(await readErrorCode(response)).toBe('TDAH_ROUTINE_INVALID');
        });

        test('a zero-duration routine block is valid (end === start, 03-modo-tdah-rutinas.md edge case)', async () => {
            const response = await activate({
                timeZone: 'UTC',
                routine: {
                    title: 'Día laboral',
                    blocks: [{ title: 'Mañana', startTime: '08:00', durationMinutes: 0 }],
                },
            });
            expect(response.status).toBe(200);
        });

        test('routine block with a negative duration_minutes returns 400 TDAH_ROUTINE_INVALID', async () => {
            const response = await activate({
                timeZone: 'UTC',
                routine: {
                    title: 'Día laboral',
                    blocks: [{ title: 'Mañana', startTime: '08:00', durationMinutes: -1 }],
                },
            });
            expect(response.status).toBe(400);
            expect(await readErrorCode(response)).toBe('TDAH_ROUTINE_INVALID');
        });

        test('invalid time zone on activate returns 400 TDAH_INVALID_TIME_ZONE', async () => {
            const response = await activate({ timeZone: 'No/Una::Zona' });
            expect(response.status).toBe(400);
            expect(await readErrorCode(response)).toBe('TDAH_INVALID_TIME_ZONE');
        });

        test('invalid ritual hour on activate returns 400 TDAH_INVALID_RITUAL_HOUR', async () => {
            const response = await activate({ ritualHour: '25:99' });
            expect(response.status).toBe(400);
            expect(await readErrorCode(response)).toBe('TDAH_INVALID_RITUAL_HOUR');
        });

        test('GET /v1/tdah/activate returns 405 TDAH_METHOD_NOT_ALLOWED', async () => {
            const response = await authedFetch('/v1/tdah/activate', { method: 'GET' });
            expect(response.status).toBe(405);
            expect(await readErrorCode(response)).toBe('TDAH_METHOD_NOT_ALLOWED');
        });

        test('a request abort/timeout during activate is reported with its own status, not always 413', async () => {
            // Bypasses HTTP/fetch on purpose: an aborted ReadableStream body,
            // fed straight into the exported handleTdahRequest, is the only
            // reliable way to force readJsonBody down the BodyReadError path
            // for the "aborted mid-read" cause (status 408) rather than the
            // "declared/observed length over the limit" cause (status 413).
            const key = tokenToKey(TOKEN_ALPHA);
            const abortController = new AbortController();
            const req = new Request('http://localhost/v1/tdah/activate', {
                method: 'POST',
                body: new ReadableStream({
                    start(streamController) {
                        streamController.enqueue(new TextEncoder().encode('{"timeZone":'));
                    },
                    cancel() {
                        return undefined;
                    },
                }),
                duplex: 'half' as RequestDuplex,
            });
            abortController.abort(new Error('Request timed out'));

            const response = await handleTdahRequest(req, '/v1/tdah/activate', { key }, {
                dataDir,
                maxBodyBytes: 1024,
                signal: abortController.signal,
            });
            expect(response).not.toBeNull();
            expect(response?.status).toBe(408);
            expect(await readErrorCode(response as Response)).toBe('TDAH_INVALID_BODY');
        });

        test('a genuinely oversized activate body still returns 413 TDAH_INVALID_BODY', async () => {
            const response = await authedFetch('/v1/tdah/activate', {
                method: 'POST',
                // startCloudServer's default maxBodyBytes is 2_000_000 (server.ts);
                // pad well past it so this is unambiguously the oversized-body case.
                body: JSON.stringify({ timeZone: 'UTC', routine: WORKDAY_ROUTINE, padding: 'x'.repeat(3 * 1024 * 1024) }),
            });
            expect(response.status).toBe(413);
            expect(await readErrorCode(response)).toBe('TDAH_INVALID_BODY');
        });

        test('a routine with more than 24 blocks returns 400 TDAH_ROUTINE_INVALID', async () => {
            const blocks = Array.from({ length: 25 }, (_, index) => ({
                title: `Bloque ${index}`,
                startTime: `00:${String(index).padStart(2, '0')}`,
                durationMinutes: 1,
            }));
            const response = await activate({
                timeZone: 'UTC',
                routine: { title: 'Día laboral', blocks },
            });
            expect(response.status).toBe(400);
            expect(await readErrorCode(response)).toBe('TDAH_ROUTINE_INVALID');
        });

        test('overlapping blocks in a routine no longer reject — story 1.4 relaxes this to a non-blocking overlapWarnings save', async () => {
            // Story 1.3 hard-rejected this with 400 TDAH_ROUTINE_INVALID; the
            // UX spec deliberately relaxes it ("aviso no bloqueante — el
            // usuario puede querer solapes deliberados") — see routes.ts's
            // parseRoutineInput and storage.ts's computeOverlapWarnings.
            const response = await activate({
                timeZone: 'UTC',
                routine: {
                    title: 'Día laboral',
                    blocks: [
                        { title: 'Mañana', startTime: '08:00', durationMinutes: 120 },
                        { title: 'Solapado', startTime: '09:00', durationMinutes: 30 },
                    ],
                },
            });
            expect(response.status).toBe(200);
            const body = await readActivateResponse(response);
            expect(body.routineCreated).toBe(true);

            const listResponse = await authedFetch('/v1/tdah/routines');
            const listBody = await listResponse.json() as { routines: TdahTestRoutine[] };
            expect(listBody.routines).toHaveLength(1);
            expect(listBody.routines[0]?.overlapWarnings).toEqual([{ blockIndexA: 0, blockIndexB: 1 }]);
        });

        test('a non-overlapping routine (existing coverage) still activates successfully', async () => {
            const response = await activate({ timeZone: 'UTC', routine: WORKDAY_ROUTINE });
            expect(response.status).toBe(200);
            const body = await readActivateResponse(response);
            expect(body.routineCreated).toBe(true);
        });

        test('leading/trailing whitespace in the routine title and a block title is trimmed before it is persisted', async () => {
            const response = await activate({
                timeZone: 'UTC',
                routine: {
                    title: '  Día laboral  ',
                    blocks: [{ title: '  Mañana  ', startTime: '08:00', durationMinutes: 60 }],
                },
            });
            expect(response.status).toBe(200);

            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const { Database } = await import('bun:sqlite');
            const database = new Database(databasePath, { readonly: true });
            try {
                const routineRow = database.prepare('SELECT title FROM tdah_routine;').get() as { title: string };
                expect(routineRow.title).toBe('Día laboral');
                const blockRow = database.prepare('SELECT title FROM tdah_routine_block;').get() as { title: string };
                expect(blockRow.title).toBe('Mañana');
            } finally {
                database.close();
            }
        });

        test('a storage-level failure mid-activation rolls back the profile upsert too (atomic activate)', async () => {
            // Storage-unit test, bypassing HTTP/route validation on purpose:
            // `parseRoutineInput` rejects a non-string `startTime` long before it
            // reaches storage.ts, so the only way to exercise the transaction's
            // rollback is to call `activateTdahProfile` directly with a `null`
            // `startTime` smuggled past TypeScript via `as any`. That value hits
            // `tdah_routine_block.start_time TEXT NOT NULL` (storage.ts's
            // CREATE_ROUTINE_BLOCK_TABLE_SQL) on the second block's INSERT — after
            // the profile upsert and the first block insert have already run
            // inside the same held transaction — so a real SQLITE_CONSTRAINT
            // error is what triggers the rollback, not a hand-rolled throw.
            const key = tokenToKey(TOKEN_ALPHA);

            await expect(activateTdahProfile(dataDir, key, {
                timeZone: 'UTC',
                routine: {
                    title: 'Día laboral',
                    blocks: [
                        { title: 'Mañana', startTime: '08:00', durationMinutes: 60 },
                        { title: 'Tarde', startTime: null as unknown as string, durationMinutes: 60 },
                    ],
                },
            })).rejects.toBeTruthy();

            const profile = await readTdahProfile(dataDir, key);
            expect(profile).toBeNull();
        });
    });

    describe('/v1/tdah/routines CRUD & precedence engine (story 1.4)', () => {
        const NEW_WORKDAY_ROUTINE = {
            title: 'Día laboral',
            pattern: { kind: 'weekday', weekdays: [1, 2, 3, 4, 5] },
            blocks: [
                { title: 'Mañana', startTime: '08:00', durationMinutes: 120 },
                { title: 'Tarde', startTime: '14:00', durationMinutes: 180 },
            ],
        };

        /** Tomorrow's calendar date in UTC, decomposed for building test Rutina patterns that are guaranteed to match it. */
        const tomorrowInfoUtc = (): { date: string; year: number; month: number; day: number; weekday: number; ordinal: number } => {
            const now = new Date();
            const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
            const tomorrowUtc = new Date(todayUtc.getTime() + 24 * 60 * 60 * 1000);
            const year = tomorrowUtc.getUTCFullYear();
            const month = tomorrowUtc.getUTCMonth() + 1;
            const day = tomorrowUtc.getUTCDate();
            const weekday = tomorrowUtc.getUTCDay();
            const occurrence = Math.ceil(day / 7);
            const ordinal = occurrence <= 4 ? occurrence : -1;
            const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            return { date, year, month, day, weekday, ordinal };
        };

        test('create weekday Rutina returns 201 with full Rutina, blocks, empty overlapWarnings', async () => {
            const response = await createRoutineApi(NEW_WORKDAY_ROUTINE);
            expect(response.status).toBe(201);
            const routine = await readRoutine(response);
            expect(typeof routine.id).toBe('number');
            expect(routine.title).toBe('Día laboral');
            expect(routine.pattern).toEqual({ kind: 'weekday', weekdays: [1, 2, 3, 4, 5] });
            expect(routine.blocks).toHaveLength(2);
            expect(routine.overlapWarnings).toEqual([]);
            expect(routine.crossesMidnightWarnings).toEqual([]);
        });

        test('create nthWeekdayOfMonth Rutina ("último sábado") persists ordinal/weekday', async () => {
            const response = await createRoutineApi({
                title: 'Último sábado',
                pattern: { kind: 'nthWeekdayOfMonth', ordinal: -1, weekday: 6 },
                blocks: [{ title: 'Limpieza', startTime: '10:00', durationMinutes: 60 }],
            });
            expect(response.status).toBe(201);
            const routine = await readRoutine(response);
            expect(routine.pattern).toEqual({ kind: 'nthWeekdayOfMonth', ordinal: -1, weekday: 6 });
        });

        test('empty weekdays array returns 400 TDAH_ROUTINE_INVALID', async () => {
            const response = await createRoutineApi({
                title: 'Vacío',
                pattern: { kind: 'weekday', weekdays: [] },
                blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 60 }],
            });
            expect(response.status).toBe(400);
            expect(await readErrorCode(response)).toBe('TDAH_ROUTINE_INVALID');
        });

        test('ordinal out of range (5) returns 400 TDAH_ROUTINE_INVALID', async () => {
            const response = await createRoutineApi({
                title: 'Ordinal inválido',
                pattern: { kind: 'nthWeekdayOfMonth', ordinal: 5, weekday: 6 },
                blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 60 }],
            });
            expect(response.status).toBe(400);
            expect(await readErrorCode(response)).toBe('TDAH_ROUTINE_INVALID');
        });

        test('overlapping Bloques save successfully with overlapWarnings populated instead of rejecting', async () => {
            const response = await createRoutineApi({
                title: 'Con solape',
                blocks: [
                    { title: 'Mañana', startTime: '08:00', durationMinutes: 120 },
                    { title: 'Solapado', startTime: '09:00', durationMinutes: 30 },
                ],
            });
            expect(response.status).toBe(201);
            const routine = await readRoutine(response);
            expect(routine.overlapWarnings).toEqual([{ blockIndexA: 0, blockIndexB: 1 }]);
        });

        test('a Bloque crossing midnight saves successfully with a crossesMidnightWarnings entry', async () => {
            const response = await createRoutineApi({
                title: 'Nocturno',
                blocks: [{ title: 'Noche', startTime: '23:30', durationMinutes: 90 }],
            });
            expect(response.status).toBe(201);
            const routine = await readRoutine(response);
            expect(routine.crossesMidnightWarnings).toEqual([{ blockIndex: 0 }]);
        });

        test('a title over 80 characters returns 400 TDAH_ROUTINE_INVALID (DW-2)', async () => {
            const response = await createRoutineApi({
                title: 'x'.repeat(201),
                blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 60 }],
            });
            expect(response.status).toBe(400);
            expect(await readErrorCode(response)).toBe('TDAH_ROUTINE_INVALID');
        });

        test('a duration over 1440 minutes returns 400 TDAH_ROUTINE_INVALID (DW-2)', async () => {
            const response = await createRoutineApi({
                title: 'Duración inválida',
                blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 100000 }],
            });
            expect(response.status).toBe(400);
            expect(await readErrorCode(response)).toBe('TDAH_ROUTINE_INVALID');
        });

        // --- P7: exact-boundary coverage on the CRUD routes (title, duration, blocks caps) ---

        test('a title of exactly TDAH_ROUTINE_TITLE_MAX_LENGTH (80) chars succeeds via POST', async () => {
            const response = await createRoutineApi({
                title: 'x'.repeat(80),
                blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 60 }],
            });
            expect(response.status).toBe(201);
            const routine = await readRoutine(response);
            expect(routine.title).toHaveLength(80);
        });

        test('a title of TDAH_ROUTINE_TITLE_MAX_LENGTH + 1 (81) chars fails with TDAH_ROUTINE_INVALID via POST', async () => {
            const response = await createRoutineApi({
                title: 'x'.repeat(81),
                blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 60 }],
            });
            expect(response.status).toBe(400);
            expect(await readErrorCode(response)).toBe('TDAH_ROUTINE_INVALID');
        });

        test('the same title boundary (80 ok, 81 rejected) holds via PUT', async () => {
            const created = await readRoutine(await createRoutineApi(NEW_WORKDAY_ROUTINE));
            const atLimit = await updateRoutineApi(created.id, {
                title: 'y'.repeat(80),
                pattern: NEW_WORKDAY_ROUTINE.pattern,
                blocks: NEW_WORKDAY_ROUTINE.blocks,
            });
            expect(atLimit.status).toBe(200);

            const overLimit = await updateRoutineApi(created.id, {
                title: 'y'.repeat(81),
                pattern: NEW_WORKDAY_ROUTINE.pattern,
                blocks: NEW_WORKDAY_ROUTINE.blocks,
            });
            expect(overLimit.status).toBe(400);
            expect(await readErrorCode(overLimit)).toBe('TDAH_ROUTINE_INVALID');
        });

        test('a durationMinutes of exactly TDAH_BLOCK_DURATION_MAX_MINUTES (1440) succeeds via POST', async () => {
            const response = await createRoutineApi({
                title: 'Duración límite',
                blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 1440 }],
            });
            expect(response.status).toBe(201);
        });

        test('a durationMinutes of TDAH_BLOCK_DURATION_MAX_MINUTES + 1 (1441) fails with TDAH_ROUTINE_INVALID via POST', async () => {
            const response = await createRoutineApi({
                title: 'Duración excedida',
                blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 1441 }],
            });
            expect(response.status).toBe(400);
            expect(await readErrorCode(response)).toBe('TDAH_ROUTINE_INVALID');
        });

        test('the same duration boundary (1440 ok, 1441 rejected) holds via PUT', async () => {
            const created = await readRoutine(await createRoutineApi(NEW_WORKDAY_ROUTINE));
            const atLimit = await updateRoutineApi(created.id, {
                title: created.title,
                pattern: NEW_WORKDAY_ROUTINE.pattern,
                blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 1440 }],
            });
            expect(atLimit.status).toBe(200);

            const overLimit = await updateRoutineApi(created.id, {
                title: created.title,
                pattern: NEW_WORKDAY_ROUTINE.pattern,
                blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 1441 }],
            });
            expect(overLimit.status).toBe(400);
            expect(await readErrorCode(overLimit)).toBe('TDAH_ROUTINE_INVALID');
        });

        test('a blocks array of TDAH_ROUTINE_MAX_BLOCKS (24) is accepted, and 25 is rejected with TDAH_ROUTINE_INVALID, via POST', async () => {
            const buildBlocks = (count: number) => Array.from({ length: count }, (_, index) => ({
                title: `Bloque ${index}`,
                startTime: `00:${String(index % 60).padStart(2, '0')}`,
                durationMinutes: 1,
            }));

            const atLimit = await createRoutineApi({ title: 'Bloques al límite', blocks: buildBlocks(24) });
            expect(atLimit.status).toBe(201);

            const overLimit = await createRoutineApi({ title: 'Demasiados bloques', blocks: buildBlocks(25) });
            expect(overLimit.status).toBe(400);
            expect(await readErrorCode(overLimit)).toBe('TDAH_ROUTINE_INVALID');
        });

        test('a blocks array of 25 is rejected with TDAH_ROUTINE_INVALID via PUT (not just the /activate path)', async () => {
            const created = await readRoutine(await createRoutineApi(NEW_WORKDAY_ROUTINE));
            const blocks = Array.from({ length: 25 }, (_, index) => ({
                title: `Bloque ${index}`,
                startTime: `00:${String(index % 60).padStart(2, '0')}`,
                durationMinutes: 1,
            }));
            const response = await updateRoutineApi(created.id, { title: created.title, pattern: NEW_WORKDAY_ROUTINE.pattern, blocks });
            expect(response.status).toBe(400);
            expect(await readErrorCode(response)).toBe('TDAH_ROUTINE_INVALID');
        });

        // --- TDAH_ROUTINE_MAX_COUNT: unbounded Rutina creation per namespace is a real resource-cost concern this story introduces ---

        test('a namespace can create up to TDAH_ROUTINE_MAX_COUNT (50) Rutinas, and the 51st is rejected with TDAH_ROUTINE_INVALID', async () => {
            for (let i = 0; i < 50; i += 1) {
                const response = await createRoutineApi({
                    title: `Rutina ${i}`,
                    blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 30 }],
                });
                expect(response.status).toBe(201);
            }

            const overCap = await createRoutineApi({
                title: 'Rutina 51',
                blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 30 }],
            });
            expect(overCap.status).toBe(400);
            expect(await readErrorCode(overCap)).toBe('TDAH_ROUTINE_INVALID');

            const listResponse = await listRoutinesApi();
            const routines = await readRoutines(listResponse);
            expect(routines).toHaveLength(50);
        });

        // --- P4: duplicate weekday numbers are deduped before persisting ---

        test('duplicate weekday values in the pattern are deduped before persisting', async () => {
            const response = await createRoutineApi({
                title: 'Duplicados',
                pattern: { kind: 'weekday', weekdays: [1, 1, 2, 2, 2, 3] },
                blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 60 }],
            });
            expect(response.status).toBe(201);
            const routine = await readRoutine(response);
            expect(routine.pattern).toEqual({ kind: 'weekday', weekdays: [1, 2, 3] });
        });

        // --- P7: PUT changing pattern.kind clears the now-irrelevant columns ---

        test('PUT changing pattern.kind from nthWeekdayOfMonth to weekday clears stale ordinal/weekday fields', async () => {
            const created = await readRoutine(await createRoutineApi({
                title: 'Último sábado',
                pattern: { kind: 'nthWeekdayOfMonth', ordinal: -1, weekday: 6 },
                blocks: [{ title: 'Limpieza', startTime: '10:00', durationMinutes: 60 }],
            }));
            expect(created.pattern).toEqual({ kind: 'nthWeekdayOfMonth', ordinal: -1, weekday: 6 });

            const updateResponse = await updateRoutineApi(created.id, {
                title: created.title,
                pattern: { kind: 'weekday', weekdays: [1, 2, 3] },
                blocks: [{ title: 'Bloque', startTime: '09:00', durationMinutes: 30 }],
            });
            expect(updateResponse.status).toBe(200);
            const updated = await readRoutine(updateResponse);
            expect(updated.pattern).toEqual({ kind: 'weekday', weekdays: [1, 2, 3] });
            expect((updated.pattern as { ordinal?: number }).ordinal).toBeUndefined();
            expect((updated.pattern as { weekday?: number }).weekday).toBeUndefined();

            // Read back independently via GET — confirms the persisted row, not
            // just the write response, carries no stale nth-columns.
            const fetched = await readRoutine(await getRoutineApi(created.id));
            expect(fetched.pattern).toEqual({ kind: 'weekday', weekdays: [1, 2, 3] });
        });

        test('PUT changing pattern.kind from weekday to nthWeekdayOfMonth clears the stale weekdays field', async () => {
            const created = await readRoutine(await createRoutineApi(NEW_WORKDAY_ROUTINE));
            expect(created.pattern).toEqual({ kind: 'weekday', weekdays: [1, 2, 3, 4, 5] });

            const updateResponse = await updateRoutineApi(created.id, {
                title: created.title,
                pattern: { kind: 'nthWeekdayOfMonth', ordinal: 2, weekday: 3 },
                blocks: [{ title: 'Bloque', startTime: '09:00', durationMinutes: 30 }],
            });
            expect(updateResponse.status).toBe(200);
            const updated = await readRoutine(updateResponse);
            expect(updated.pattern).toEqual({ kind: 'nthWeekdayOfMonth', ordinal: 2, weekday: 3 });
            expect((updated.pattern as { weekdays?: number[] }).weekdays).toBeUndefined();

            const fetched = await readRoutine(await getRoutineApi(created.id));
            expect(fetched.pattern).toEqual({ kind: 'nthWeekdayOfMonth', ordinal: 2, weekday: 3 });
        });

        // --- P6/P8: bogus-year months are rejected instead of silently wrapping century ---

        test('a preview month with a bogus year like 0099-01 is rejected as 400 instead of silently producing a wrong-century date', async () => {
            const created = await readRoutine(await createRoutineApi(NEW_WORKDAY_ROUTINE));
            const response = await previewRoutineApi(created.id, '0099-01');
            expect(response.status).toBe(400);
        });

        test('a preview month with year 0000 is rejected as 400', async () => {
            const created = await readRoutine(await createRoutineApi(NEW_WORKDAY_ROUTINE));
            const response = await previewRoutineApi(created.id, '0000-05');
            expect(response.status).toBe(400);
        });

        // --- P1: GET /v1/tdah/routines/conflicts (server-computed precedence) ---

        test('GET /v1/tdah/routines/conflicts returns an empty object when no Rutinas conflict, and is not swallowed by the /:id route', async () => {
            await createRoutineApi(NEW_WORKDAY_ROUTINE);
            const response = await authedFetch('/v1/tdah/routines/conflicts');
            expect(response.status).toBe(200);
            const body = await response.json() as { conflicts: Record<string, unknown> };
            expect(body.conflicts).toEqual({});
        });

        test('GET /v1/tdah/routines/conflicts reports every conflicting weekday pair with the server-computed winner (same tie-break as day-plan generation)', async () => {
            const older = await readRoutine(await createRoutineApi({
                title: 'Genérica martes',
                pattern: { kind: 'weekday', weekdays: [2] },
                blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 30 }],
            }));
            const newer = await readRoutine(await createRoutineApi({
                title: 'Nueva martes',
                pattern: { kind: 'weekday', weekdays: [2, 3] },
                blocks: [{ title: 'Bloque', startTime: '09:00', durationMinutes: 30 }],
            }));

            const response = await authedFetch('/v1/tdah/routines/conflicts');
            expect(response.status).toBe(200);
            const body = await response.json() as { conflicts: Record<string, { withId: number; withTitle: string; wins: boolean }[]> };
            expect(body.conflicts[String(older.id)]).toEqual([{ withId: newer.id, withTitle: 'Nueva martes', wins: false }]);
            expect(body.conflicts[String(newer.id)]).toEqual([{ withId: older.id, withTitle: 'Genérica martes', wins: true }]);
        });

        test('GET /v1/tdah/routines/conflicts: a nthWeekdayOfMonth Rutina always outranks a conflicting weekday Rutina, regardless of createdAt', async () => {
            const weekly = await readRoutine(await createRoutineApi({
                title: 'Todos los sábados',
                pattern: { kind: 'weekday', weekdays: [6] },
                blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 30 }],
            }));
            const specific = await readRoutine(await createRoutineApi({
                title: 'Último sábado',
                pattern: { kind: 'nthWeekdayOfMonth', ordinal: -1, weekday: 6 },
                blocks: [{ title: 'Bloque', startTime: '09:00', durationMinutes: 30 }],
            }));

            const response = await authedFetch('/v1/tdah/routines/conflicts');
            const body = await response.json() as { conflicts: Record<string, { withId: number; wins: boolean }[]> };
            expect(body.conflicts[String(weekly.id)]?.find((c) => c.withId === specific.id)?.wins).toBe(false);
            expect(body.conflicts[String(specific.id)]?.find((c) => c.withId === weekly.id)?.wins).toBe(true);
        });

        test('GET /v1/tdah/routines/conflicts: two nthWeekdayOfMonth Rutinas on the same weekday conflict regardless of ordinal (false positives acceptable, false negatives are not)', async () => {
            const first = await readRoutine(await createRoutineApi({
                title: 'Primer sábado',
                pattern: { kind: 'nthWeekdayOfMonth', ordinal: 1, weekday: 6 },
                blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 30 }],
            }));
            const last = await readRoutine(await createRoutineApi({
                title: 'Último sábado',
                pattern: { kind: 'nthWeekdayOfMonth', ordinal: -1, weekday: 6 },
                blocks: [{ title: 'Bloque', startTime: '09:00', durationMinutes: 30 }],
            }));

            const response = await authedFetch('/v1/tdah/routines/conflicts');
            const body = await response.json() as { conflicts: Record<string, { withId: number }[]> };
            expect(body.conflicts[String(first.id)]?.some((c) => c.withId === last.id)).toBe(true);
            expect(body.conflicts[String(last.id)]?.some((c) => c.withId === first.id)).toBe(true);
        });

        test('POST /v1/tdah/routines/conflicts returns 405 TDAH_METHOD_NOT_ALLOWED', async () => {
            const response = await authedFetch('/v1/tdah/routines/conflicts', { method: 'POST' });
            expect(response.status).toBe(405);
            expect(await readErrorCode(response)).toBe('TDAH_METHOD_NOT_ALLOWED');
        });

        test('GET /v1/tdah/routines/:id returns the Rutina; an unknown id returns 404', async () => {
            const created = await readRoutine(await createRoutineApi(NEW_WORKDAY_ROUTINE));
            const found = await getRoutineApi(created.id);
            expect(found.status).toBe(200);
            expect((await readRoutine(found)).id).toBe(created.id);

            const missing = await getRoutineApi(999999);
            expect(missing.status).toBe(404);
            expect(await readErrorCode(missing)).toBe('TDAH_NOT_FOUND');
        });

        test('PUT /v1/tdah/routines/:id fully replaces pattern and Bloques', async () => {
            const created = await readRoutine(await createRoutineApi(NEW_WORKDAY_ROUTINE));
            const updateResponse = await updateRoutineApi(created.id, {
                title: 'Fin de semana',
                pattern: { kind: 'weekday', weekdays: [0, 6] },
                blocks: [{ title: 'Descanso', startTime: '10:00', durationMinutes: 30 }],
            });
            expect(updateResponse.status).toBe(200);
            const updated = await readRoutine(updateResponse);
            expect(updated.title).toBe('Fin de semana');
            expect(updated.pattern).toEqual({ kind: 'weekday', weekdays: [0, 6] });
            expect(updated.blocks).toHaveLength(1);
            expect(updated.blocks[0]?.title).toBe('Descanso');
        });

        test('PUT on an unknown Rutina id returns 404 TDAH_NOT_FOUND', async () => {
            const response = await updateRoutineApi(999999, NEW_WORKDAY_ROUTINE);
            expect(response.status).toBe(404);
            expect(await readErrorCode(response)).toBe('TDAH_NOT_FOUND');
        });

        test('PUT with no pattern in the body returns 400 TDAH_ROUTINE_INVALID instead of silently resetting it to the Mon-Fri default', async () => {
            const created = await readRoutine(await createRoutineApi({
                title: 'Último sábado',
                pattern: { kind: 'nthWeekdayOfMonth', ordinal: -1, weekday: 6 },
                blocks: [{ title: 'Limpieza', startTime: '10:00', durationMinutes: 60 }],
            }));
            const response = await updateRoutineApi(created.id, {
                title: created.title,
                blocks: created.blocks.map((b) => ({ title: b.title, startTime: b.startTime, durationMinutes: b.durationMinutes })),
            });
            expect(response.status).toBe(400);
            expect(await readErrorCode(response)).toBe('TDAH_ROUTINE_INVALID');

            // The custom pattern must still be intact — the rejected PUT never reached storage.
            const fetched = await readRoutine(await getRoutineApi(created.id));
            expect(fetched.pattern).toEqual({ kind: 'nthWeekdayOfMonth', ordinal: -1, weekday: 6 });
        });

        test('DELETE /v1/tdah/routines/:id removes the row; a second GET then 404s', async () => {
            const created = await readRoutine(await createRoutineApi(NEW_WORKDAY_ROUTINE));
            const deleteResponse = await deleteRoutineApi(created.id);
            expect(deleteResponse.status).toBe(200);
            expect(await deleteResponse.json()).toEqual({ deleted: true });

            const found = await getRoutineApi(created.id);
            expect(found.status).toBe(404);
        });

        test('DELETE on an unknown Rutina id returns 404 TDAH_NOT_FOUND', async () => {
            const response = await deleteRoutineApi(999999);
            expect(response.status).toBe(404);
            expect(await readErrorCode(response)).toBe('TDAH_NOT_FOUND');
        });

        test('editing/deleting a Rutina never touches already-generated day plans or activities', async () => {
            const created = await readRoutine(await createRoutineApi(NEW_WORKDAY_ROUTINE));
            const activation = await activate({ timeZone: 'UTC' });
            const activationBody = await readActivateResponse(activation);
            const generatedActivityCount = activationBody.dayPlan.activityCount;

            await updateRoutineApi(created.id, {
                title: 'Otro nombre',
                pattern: NEW_WORKDAY_ROUTINE.pattern,
                blocks: [{ title: 'Solo uno', startTime: '09:00', durationMinutes: 30 }],
            });
            await deleteRoutineApi(created.id);

            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const { Database } = await import('bun:sqlite');
            const database = new Database(databasePath, { readonly: true });
            try {
                const activityCount = database
                    .prepare('SELECT COUNT(*) AS count FROM tdah_activity WHERE day_plan_date = ?;')
                    .get(activationBody.dayPlan.date) as { count: number };
                expect(activityCount.count).toBe(generatedActivityCount);
            } finally {
                database.close();
            }
        });

        test('list Rutinas orders most-specific-first (nthWeekdayOfMonth before weekday)', async () => {
            await createRoutineApi(NEW_WORKDAY_ROUTINE);
            const specific = await readRoutine(await createRoutineApi({
                title: 'Último viernes',
                pattern: { kind: 'nthWeekdayOfMonth', ordinal: -1, weekday: 5 },
                blocks: [{ title: 'Cierre', startTime: '17:00', durationMinutes: 30 }],
            }));

            const listResponse = await listRoutinesApi();
            expect(listResponse.status).toBe(200);
            const routines = await readRoutines(listResponse);
            expect(routines).toHaveLength(2);
            expect(routines[0]?.id).toBe(specific.id);
            expect(routines[0]?.pattern.kind).toBe('nthWeekdayOfMonth');
        });

        test('applicability preview: nthWeekdayOfMonth outranks a same-day generic weekday Rutina (AD-5)', async () => {
            const tomorrow = tomorrowInfoUtc();
            const month = `${tomorrow.year}-${String(tomorrow.month).padStart(2, '0')}`;

            const generic = await readRoutine(await createRoutineApi({
                title: 'Genérica',
                pattern: { kind: 'weekday', weekdays: [tomorrow.weekday] },
                blocks: [{ title: 'Bloque genérico', startTime: '08:00', durationMinutes: 30 }],
            }));
            const specific = await readRoutine(await createRoutineApi({
                title: 'Específica',
                pattern: { kind: 'nthWeekdayOfMonth', ordinal: tomorrow.ordinal, weekday: tomorrow.weekday },
                blocks: [{ title: 'Bloque específico', startTime: '08:00', durationMinutes: 30 }],
            }));

            const genericPreview = await readDates(await previewRoutineApi(generic.id, month));
            const specificPreview = await readDates(await previewRoutineApi(specific.id, month));
            expect(specificPreview).toContain(tomorrow.date);
            expect(genericPreview).not.toContain(tomorrow.date);
        });

        test('applicability preview: a same-specificity tie goes to the most-recently-created Rutina', async () => {
            const tomorrow = tomorrowInfoUtc();
            const month = `${tomorrow.year}-${String(tomorrow.month).padStart(2, '0')}`;
            const allWeekdays = [0, 1, 2, 3, 4, 5, 6];

            const older = await readRoutine(await createRoutineApi({
                title: 'Más antigua',
                pattern: { kind: 'weekday', weekdays: allWeekdays },
                blocks: [{ title: 'Bloque', startTime: '08:00', durationMinutes: 30 }],
            }));
            const newer = await readRoutine(await createRoutineApi({
                title: 'Más reciente',
                pattern: { kind: 'weekday', weekdays: allWeekdays },
                blocks: [{ title: 'Bloque', startTime: '09:00', durationMinutes: 30 }],
            }));

            const olderPreview = await readDates(await previewRoutineApi(older.id, month));
            const newerPreview = await readDates(await previewRoutineApi(newer.id, month));
            expect(olderPreview).toEqual([]);
            expect(newerPreview.length).toBeGreaterThan(0);
        });

        test('day-plan generation itself picks the precedence winner, not just the preview (nthWeekdayOfMonth beats weekday)', async () => {
            const tomorrow = tomorrowInfoUtc();
            await createRoutineApi({
                title: 'Genérica',
                pattern: { kind: 'weekday', weekdays: [tomorrow.weekday] },
                blocks: [{ title: 'Solo uno', startTime: '08:00', durationMinutes: 30 }],
            });
            await createRoutineApi({
                title: 'Específica',
                pattern: { kind: 'nthWeekdayOfMonth', ordinal: tomorrow.ordinal, weekday: tomorrow.weekday },
                blocks: [
                    { title: 'Primero', startTime: '08:00', durationMinutes: 30 },
                    { title: 'Segundo', startTime: '09:00', durationMinutes: 30 },
                ],
            });

            const response = await activate({ timeZone: 'UTC' });
            expect(response.status).toBe(200);
            const body = await readActivateResponse(response);
            expect(body.dayPlan.date).toBe(tomorrow.date);
            expect(body.dayPlan.activityCount).toBe(2);
        });

        test('GET .../preview with an unknown Rutina id returns 404', async () => {
            const response = await previewRoutineApi(999999, '2026-09');
            expect(response.status).toBe(404);
            expect(await readErrorCode(response)).toBe('TDAH_NOT_FOUND');
        });

        test('GET .../preview with a missing or malformed month query param returns 400', async () => {
            const created = await readRoutine(await createRoutineApi(NEW_WORKDAY_ROUTINE));
            const missingMonth = await authedFetch(`/v1/tdah/routines/${created.id}/preview`);
            expect(missingMonth.status).toBe(400);
            const malformedMonth = await previewRoutineApi(created.id, 'not-a-month');
            expect(malformedMonth.status).toBe(400);
        });

        test("DW-5: reactivating with a different Rutina than the one CRUD already created stays a no-op", async () => {
            const created = await readRoutine(await createRoutineApi(NEW_WORKDAY_ROUTINE));

            const response = await activate({
                timeZone: 'UTC',
                routine: {
                    title: 'Otra rutina completamente distinta',
                    blocks: [{ title: 'Diferente', startTime: '06:00', durationMinutes: 45 }],
                },
            });
            expect(response.status).toBe(200);
            const body = await readActivateResponse(response);
            expect(body.routineCreated).toBe(false);

            const routines = await readRoutines(await listRoutinesApi());
            expect(routines).toHaveLength(1);
            expect(routines[0]?.id).toBe(created.id);
            expect(routines[0]?.title).toBe('Día laboral');
        });

        test('a fresh database starts directly at schema v1 (no migration needed)', async () => {
            await activate({ timeZone: 'UTC' });
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const { Database } = await import('bun:sqlite');
            const database = new Database(databasePath, { readonly: true });
            try {
                const versionRow = database.prepare('PRAGMA user_version;').get() as { user_version: number };
                expect(versionRow.user_version).toBe(1);
                const columns = (database.prepare("PRAGMA table_info('tdah_routine');") as unknown as {
                    all(): { name: string }[];
                }).all();
                expect(columns.some((column) => column.name === 'pattern_weekdays')).toBe(true);
            } finally {
                database.close();
            }
        });

        test('a pre-1.4 (schema v0) database on disk migrates transparently and its Rutina backfills to weekdays [1,2,3,4,5]', async () => {
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            mkdirSync(join(dataDir, key, 'tdah'), { recursive: true });

            const { Database } = await import('bun:sqlite');
            const seedDatabase = new Database(databasePath);
            try {
                seedDatabase.exec(`
                    CREATE TABLE tdah_routine (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT NOT NULL,
                        pattern_kind TEXT NOT NULL CHECK (pattern_kind IN ('weekday')),
                        created_at TEXT NOT NULL
                    );
                `);
                seedDatabase.exec(`
                    CREATE TABLE tdah_routine_block (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        routine_id INTEGER NOT NULL REFERENCES tdah_routine(id),
                        title TEXT NOT NULL,
                        start_time TEXT NOT NULL,
                        duration_minutes INTEGER NOT NULL,
                        sort_order INTEGER NOT NULL
                    );
                `);
                seedDatabase
                    .prepare("INSERT INTO tdah_routine (id, title, pattern_kind, created_at) VALUES (1, 'Día laboral', 'weekday', '2026-01-01T00:00:00.000Z');")
                    .run();
                seedDatabase
                    .prepare("INSERT INTO tdah_routine_block (routine_id, title, start_time, duration_minutes, sort_order) VALUES (1, 'Mañana', '08:00', 120, 0);")
                    .run();
                // PRAGMA user_version defaults to 0 — left unset on purpose, matching a real pre-1.4 file on disk.
            } finally {
                seedDatabase.close();
            }

            // A pure read (GET, no prior write in this process) is the
            // riskier path — withReadDatabase must migrate a stale v0
            // database itself, not only withWriteTransaction.
            const listResponse = await listRoutinesApi();
            expect(listResponse.status).toBe(200);
            const routines = await readRoutines(listResponse);
            expect(routines).toHaveLength(1);
            expect(routines[0]?.title).toBe('Día laboral');
            expect(routines[0]?.pattern).toEqual({ kind: 'weekday', weekdays: [1, 2, 3, 4, 5] });
            expect(routines[0]?.blocks).toHaveLength(1);

            const verifyDatabase = new Database(databasePath, { readonly: true });
            try {
                const versionRow = verifyDatabase.prepare('PRAGMA user_version;').get() as { user_version: number };
                expect(versionRow.user_version).toBe(1);
            } finally {
                verifyDatabase.close();
            }
        });

        test('a stray leftover tdah_routine_v2 table from an interrupted migration self-heals instead of throwing "table already exists" (P2)', async () => {
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            mkdirSync(join(dataDir, key, 'tdah'), { recursive: true });

            const { Database } = await import('bun:sqlite');
            const seedDatabase = new Database(databasePath);
            try {
                seedDatabase.exec(`
                    CREATE TABLE tdah_routine (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT NOT NULL,
                        pattern_kind TEXT NOT NULL CHECK (pattern_kind IN ('weekday')),
                        created_at TEXT NOT NULL
                    );
                `);
                seedDatabase.exec(`
                    CREATE TABLE tdah_routine_block (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        routine_id INTEGER NOT NULL REFERENCES tdah_routine(id),
                        title TEXT NOT NULL,
                        start_time TEXT NOT NULL,
                        duration_minutes INTEGER NOT NULL,
                        sort_order INTEGER NOT NULL
                    );
                `);
                seedDatabase
                    .prepare("INSERT INTO tdah_routine (id, title, pattern_kind, created_at) VALUES (1, 'Día laboral', 'weekday', '2026-01-01T00:00:00.000Z');")
                    .run();
                seedDatabase
                    .prepare("INSERT INTO tdah_routine_block (routine_id, title, start_time, duration_minutes, sort_order) VALUES (1, 'Mañana', '08:00', 120, 0);")
                    .run();
                // Simulate a migration interrupted right after CREATE TABLE
                // tdah_routine_v2 but before it could DROP/RENAME — the exact
                // stray state the `DROP TABLE IF EXISTS` defense-in-depth
                // targets. PRAGMA user_version is left at 0, matching a real
                // interrupted-migration file on disk.
                seedDatabase.exec(`
                    CREATE TABLE tdah_routine_v2 (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT NOT NULL,
                        pattern_kind TEXT NOT NULL CHECK (pattern_kind IN ('weekday', 'nthWeekdayOfMonth')),
                        pattern_weekdays TEXT,
                        pattern_nth_ordinal INTEGER,
                        pattern_nth_weekday INTEGER,
                        created_at TEXT NOT NULL
                    );
                `);
            } finally {
                seedDatabase.close();
            }

            const listResponse = await listRoutinesApi();
            expect(listResponse.status).toBe(200);
            const routines = await readRoutines(listResponse);
            expect(routines).toHaveLength(1);
            expect(routines[0]?.title).toBe('Día laboral');
            expect(routines[0]?.pattern).toEqual({ kind: 'weekday', weekdays: [1, 2, 3, 4, 5] });

            const verifyDatabase = new Database(databasePath, { readonly: true });
            try {
                const versionRow = verifyDatabase.prepare('PRAGMA user_version;').get() as { user_version: number };
                expect(versionRow.user_version).toBe(1);
                const tableNames = (verifyDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'table';") as unknown as {
                    all(): { name: string }[];
                }).all().map((row) => row.name);
                expect(tableNames).not.toContain('tdah_routine_v2');
            } finally {
                verifyDatabase.close();
            }
        });
    });

    describe('runNightlyTdahTick (story 1.5: nightly scheduler)', () => {
        // Mexico abolished DST in 2022 (fixed UTC-6 year-round), so tests can
        // build exact instants for this zone without any DST ambiguity.
        const MEXICO_CITY_OFFSET = '-06:00';
        const localInstant = (date: string, time: string): Date => new Date(`${date}T${time}:00${MEXICO_CITY_OFFSET}`);

        type ActivityRow = { day_plan_date: string; title: string; origin: string; state: string };
        type DayPlanCountRow = { count: number };

        const readActivityRows = async (databasePath: string, date: string): Promise<ActivityRow[]> => {
            const { Database } = await import('bun:sqlite');
            const database = new Database(databasePath, { readonly: true });
            try {
                return (database.prepare(
                    'SELECT day_plan_date, title, origin, state FROM tdah_activity WHERE day_plan_date = ? ORDER BY id;',
                ) as unknown as { all(...params: unknown[]): ActivityRow[] }).all(date);
            } finally {
                database.close();
            }
        };

        const countDayPlans = async (databasePath: string, date: string): Promise<number> => {
            const { Database } = await import('bun:sqlite');
            const database = new Database(databasePath, { readonly: true });
            try {
                const row = database.prepare('SELECT COUNT(*) AS count FROM tdah_day_plan WHERE date = ?;').get(date) as DayPlanCountRow;
                return row.count;
            } finally {
                database.close();
            }
        };

        test('at ritual hour: closes today (pending/started -> limbo) and generates tomorrow with one Actividad per Bloque', async () => {
            const activation = await activate({
                timeZone: 'America/Mexico_City',
                ritualHour: '22:00',
                routine: WORKDAY_ROUTINE,
            });
            const activationBody = await readActivateResponse(activation);
            const outgoingDate = activationBody.dayPlan.date;
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);

            // Simulate real usage: one Actividad got started but never finished before the ritual.
            const { Database } = await import('bun:sqlite');
            const seedDatabase = new Database(databasePath);
            try {
                seedDatabase.prepare("UPDATE tdah_activity SET state = 'started' WHERE day_plan_date = ? AND title = ?;")
                    .run(outgoingDate, 'Mañana');
            } finally {
                seedDatabase.close();
            }

            const now = localInstant(outgoingDate, '23:30');
            const nextDate = computeTomorrowDate('America/Mexico_City', now);

            const summary = await runNightlyTdahTick(dataDir, now);

            // TdahNightlyTickSummary.date is the tick's own UTC-calendar-day
            // reference (formatDateInTimeZone(now, 'UTC') in scheduler.ts) — not
            // any single namespace's local date.
            expect(summary.date).toBe(formatDateInTimeZone(now, 'UTC'));
            expect(summary.namespaceCount).toBe(1);
            expect(summary.firedCount).toBe(1);
            expect(summary.skippedCount).toBe(0);
            expect(summary.failedCount).toBe(0);
            expect(summary.generatedCount).toBe(WORKDAY_ROUTINE.blocks.length);
            expect(summary.limboCount).toBe(WORKDAY_ROUTINE.blocks.length);

            const outgoingRows = await readActivityRows(databasePath, outgoingDate);
            expect(outgoingRows).toHaveLength(2);
            for (const row of outgoingRows) {
                expect(row.state).toBe('limbo');
            }

            expect(await countDayPlans(databasePath, nextDate)).toBe(1);
            const nextRows = await readActivityRows(databasePath, nextDate);
            expect(nextRows).toHaveLength(2);
            for (const row of nextRows) {
                expect(row.origin).toBe('routine');
                expect(row.state).toBe('pending');
            }
        });

        test('re-firing for the same boundary is a no-op: no duplicate rows, no re-touched Actividad', async () => {
            const activation = await activate({
                timeZone: 'America/Mexico_City',
                ritualHour: '22:00',
                routine: WORKDAY_ROUTINE,
            });
            const activationBody = await readActivateResponse(activation);
            const outgoingDate = activationBody.dayPlan.date;
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const now = localInstant(outgoingDate, '23:30');
            const nextDate = computeTomorrowDate('America/Mexico_City', now);

            const first = await runNightlyTdahTick(dataDir, now);
            expect(first.firedCount).toBe(1);

            const second = await runNightlyTdahTick(dataDir, now);
            expect(second.namespaceCount).toBe(1);
            expect(second.firedCount).toBe(0);
            expect(second.skippedCount).toBe(1);
            expect(second.failedCount).toBe(0);

            expect(await countDayPlans(databasePath, nextDate)).toBe(1);
            const nextRows = await readActivityRows(databasePath, nextDate);
            expect(nextRows).toHaveLength(WORKDAY_ROUTINE.blocks.length);
            // The already-limbo'd outgoing Actividades were not re-touched by the second, skipped firing.
            const outgoingRows = await readActivityRows(databasePath, outgoingDate);
            for (const row of outgoingRows) {
                expect(row.state).toBe('limbo');
            }
        });

        test('no Rutina applies: still generates a valid empty DayPlan', async () => {
            const activation = await activate({ timeZone: 'America/Mexico_City', ritualHour: '22:00' });
            const activationBody = await readActivateResponse(activation);
            expect(activationBody.dayPlan.activityCount).toBe(0);
            const outgoingDate = activationBody.dayPlan.date;
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const now = localInstant(outgoingDate, '23:30');
            const nextDate = computeTomorrowDate('America/Mexico_City', now);

            const summary = await runNightlyTdahTick(dataDir, now);
            expect(summary.firedCount).toBe(1);
            expect(summary.generatedCount).toBe(0);
            expect(summary.limboCount).toBe(0);
            expect(await countDayPlans(databasePath, nextDate)).toBe(1);
            expect(await readActivityRows(databasePath, nextDate)).toHaveLength(0);
        });

        test("mode:'off' skips the namespace entirely, touching nothing", async () => {
            const activation = await activate({
                timeZone: 'America/Mexico_City',
                ritualHour: '22:00',
                routine: WORKDAY_ROUTINE,
            });
            const activationBody = await readActivateResponse(activation);
            const outgoingDate = activationBody.dayPlan.date;
            await putProfile({ mode: 'off' });
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const now = localInstant(outgoingDate, '23:30');
            const nextDate = computeTomorrowDate('America/Mexico_City', now);

            const summary = await runNightlyTdahTick(dataDir, now);
            expect(summary.namespaceCount).toBe(1);
            expect(summary.firedCount).toBe(0);
            expect(summary.skippedCount).toBe(1);
            expect(await countDayPlans(databasePath, nextDate)).toBe(0);
            const outgoingRows = await readActivityRows(databasePath, outgoingDate);
            for (const row of outgoingRows) {
                expect(row.state).toBe('pending');
            }
        });

        test('before the ritual hour: skips, leaving today untouched and tomorrow ungenerated', async () => {
            const activation = await activate({
                timeZone: 'America/Mexico_City',
                ritualHour: '22:00',
                routine: WORKDAY_ROUTINE,
            });
            const activationBody = await readActivateResponse(activation);
            const outgoingDate = activationBody.dayPlan.date;
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const now = localInstant(outgoingDate, '21:00');
            const nextDate = computeTomorrowDate('America/Mexico_City', now);

            const summary = await runNightlyTdahTick(dataDir, now);
            expect(summary.firedCount).toBe(0);
            expect(summary.skippedCount).toBe(1);
            expect(await countDayPlans(databasePath, nextDate)).toBe(0);
            const outgoingRows = await readActivityRows(databasePath, outgoingDate);
            for (const row of outgoingRows) {
                expect(row.state).toBe('pending');
            }
        });

        test('a ritualHour/timeZone change via PUT /profile takes effect on the next tick, reading the live profile fresh', async () => {
            const activation = await activate({
                timeZone: 'America/Mexico_City',
                ritualHour: '22:00',
                routine: WORKDAY_ROUTINE,
            });
            const activationBody = await readActivateResponse(activation);
            const outgoingDate = activationBody.dayPlan.date;
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const beforeChangeRows = await readActivityRows(databasePath, outgoingDate);

            // Push the ritual hour later, same timezone: a tick that already passed the OLD
            // hour but not the new one must still skip -- the tick has to re-read the live
            // profile every time, never a cached "next fire" instant from activation.
            await putProfile({ ritualHour: '23:30' });
            const stillEarlyForNewHour = localInstant(outgoingDate, '22:30');
            const skippedSummary = await runNightlyTdahTick(dataDir, stillEarlyForNewHour);
            expect(skippedSummary.firedCount).toBe(0);
            expect(skippedSummary.skippedCount).toBe(1);

            // Changing the profile did not touch any already-persisted Actividad row.
            const unchangedRows = await readActivityRows(databasePath, outgoingDate);
            expect(unchangedRows).toEqual(beforeChangeRows);

            // Once local time reaches the NEW ritual hour, the tick fires using it.
            const atNewHour = localInstant(outgoingDate, '23:30');
            const nextDate = computeTomorrowDate('America/Mexico_City', atNewHour);
            const firedSummary = await runNightlyTdahTick(dataDir, atNewHour);
            expect(firedSummary.firedCount).toBe(1);
            expect(await countDayPlans(databasePath, nextDate)).toBe(1);
        });

        test('a timeZone change via PUT /profile takes effect on the next tick, computing tomorrow against the new zone', async () => {
            const activation = await activate({
                timeZone: 'America/Mexico_City',
                ritualHour: '22:00',
                routine: WORKDAY_ROUTINE,
            });
            const activationBody = await readActivateResponse(activation);
            const outgoingDate = activationBody.dayPlan.date;
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const beforeChangeRows = await readActivityRows(databasePath, outgoingDate);

            // Asia/Tokyo has no DST (fixed UTC+9 year-round) -- the same
            // determinism reasoning MEXICO_CITY_OFFSET above exists for -- so
            // this test can build exact instants for the NEW zone without any
            // DST ambiguity, the same way `localInstant` already does for the
            // old one.
            await putProfile({ timeZone: 'Asia/Tokyo' });

            // At this instant Mexico City's clock already reads 23:30 -- past
            // the OLD zone's 22:00 ritual hour -- but Tokyo's clock (Mexico +
            // 15h) only reads 14:30 the same wall-clock day, well before the
            // SAME '22:00' ritual hour string in the NEW zone. A tick that
            // fires here would prove it's still using a cached America/Mexico_City
            // zone instead of re-reading the live (now Asia/Tokyo) profile.
            const pastOldZoneRitualNotYetNewZone = localInstant(outgoingDate, '23:30');
            const skippedSummary = await runNightlyTdahTick(dataDir, pastOldZoneRitualNotYetNewZone);
            expect(skippedSummary.firedCount).toBe(0);
            expect(skippedSummary.skippedCount).toBe(1);

            // Changing the profile did not touch any already-persisted Actividad row.
            const unchangedRows = await readActivityRows(databasePath, outgoingDate);
            expect(unchangedRows).toEqual(beforeChangeRows);

            // Once Tokyo's own local clock reaches 22:00 on `outgoingDate`, the tick
            // fires using the NEW zone end to end: closing `outgoingDate` and
            // generating tomorrow computed against Asia/Tokyo, not America/Mexico_City.
            const atNewZoneRitualHour = new Date(`${outgoingDate}T22:00:00+09:00`);
            const nextDate = computeTomorrowDate('Asia/Tokyo', atNewZoneRitualHour);
            const firedSummary = await runNightlyTdahTick(dataDir, atNewZoneRitualHour);
            expect(firedSummary.firedCount).toBe(1);
            expect(firedSummary.skippedCount).toBe(0);

            const outgoingRows = await readActivityRows(databasePath, outgoingDate);
            expect(outgoingRows).toHaveLength(WORKDAY_ROUTINE.blocks.length);
            for (const row of outgoingRows) {
                expect(row.state).toBe('limbo');
            }
            expect(await countDayPlans(databasePath, nextDate)).toBe(1);
            const nextRows = await readActivityRows(databasePath, nextDate);
            expect(nextRows).toHaveLength(WORKDAY_ROUTINE.blocks.length);
        });

        test('the recurring scheduler itself also picks the precedence winner (nthWeekdayOfMonth beats an existing weekday Rutina)', async () => {
            const activation = await activate({
                timeZone: 'America/Mexico_City',
                ritualHour: '22:00',
                routine: WORKDAY_ROUTINE,
            });
            const activationBody = await readActivateResponse(activation);
            const outgoingDate = activationBody.dayPlan.date;
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);

            const now = localInstant(outgoingDate, '23:30');
            const nextDate = computeTomorrowDate('America/Mexico_City', now);

            // Same date-decomposition approach as story 1.4's own "day-plan
            // generation itself picks the precedence winner" test
            // (`tomorrowInfoUtc` above), just applied to the SCHEDULER's own
            // generated target date (`nextDate`) instead of the real calendar
            // "tomorrow".
            const [year, month, day] = nextDate.split('-').map(Number) as [number, number, number];
            const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
            const occurrence = Math.ceil(day / 7);
            const ordinal = occurrence <= 4 ? occurrence : -1;

            // More specific than WORKDAY_ROUTINE's every-day `weekday` pattern
            // (created inline at activation above) and matching the exact same
            // `nextDate` the scheduler is about to generate.
            await createRoutineApi({
                title: 'Específica',
                pattern: { kind: 'nthWeekdayOfMonth', ordinal, weekday },
                blocks: [
                    { title: 'Primero', startTime: '08:00', durationMinutes: 30 },
                    { title: 'Segundo', startTime: '09:00', durationMinutes: 30 },
                ],
            });

            const summary = await runNightlyTdahTick(dataDir, now);
            expect(summary.firedCount).toBe(1);

            const nextRows = await readActivityRows(databasePath, nextDate);
            expect(nextRows.map((row) => row.title)).toEqual(['Primero', 'Segundo']);
        });

        test('a namespace directory with no tdah database at all is skipped, not counted', async () => {
            mkdirSync(join(dataDir, 'no-tdah-namespace', 'attachments'), { recursive: true });
            const summary = await runNightlyTdahTick(dataDir, new Date());
            expect(summary.namespaceCount).toBe(0);
            expect(summary.firedCount).toBe(0);
        });

        test('listActiveTdahNamespaces only returns entries with an existing tdah.sqlite file', () => {
            const customDir = mkdtempSync(join(tmpdir(), 'mindwtr-cloud-tdah-list-'));
            try {
                // A namespace with other data (e.g. attachments/sync doc) but no tdah/ subfolder.
                mkdirSync(join(customDir, 'namespace-without-tdah', 'attachments'), { recursive: true });
                // A flat per-namespace sidecar file (calendar feed / sync doc shape), not a directory at all.
                writeFileSync(join(customDir, 'namespace-with-sidecar-only.json'), '{}');
                // A real TDAH namespace.
                mkdirSync(join(customDir, 'namespace-with-tdah', 'tdah'), { recursive: true });
                writeFileSync(join(customDir, 'namespace-with-tdah', 'tdah', 'tdah.sqlite'), '');
                expect(listActiveTdahNamespaces(customDir)).toEqual(['namespace-with-tdah']);
            } finally {
                rmSync(customDir, { recursive: true, force: true });
            }
        });

        test('a write failure for one namespace is logged and retried, without aborting other namespaces in the same tick', async () => {
            const alphaActivation = await activate({
                timeZone: 'America/Mexico_City',
                ritualHour: '22:00',
                routine: WORKDAY_ROUTINE,
            }, TOKEN_ALPHA);
            const alphaBody = await readActivateResponse(alphaActivation);
            const betaActivation = await activate({
                timeZone: 'America/Mexico_City',
                ritualHour: '22:00',
                routine: WORKDAY_ROUTINE,
            }, TOKEN_BETA);
            const betaBody = await readActivateResponse(betaActivation);
            // Both activated moments apart in the same test run — same local calendar date in practice.
            const outgoingDate = alphaBody.dayPlan.date;
            expect(betaBody.dayPlan.date).toBe(outgoingDate);

            const alphaPath = tdahDatabasePath(dataDir, tokenToKey(TOKEN_ALPHA));
            const betaPath = tdahDatabasePath(dataDir, tokenToKey(TOKEN_BETA));
            // Corrupt beta's database file so any open against it throws — simulating a
            // per-namespace storage failure. The WAL/SHM sidecars have to be removed
            // too: SQLite's WAL recovery can silently reconstruct a valid database
            // from those even when the main file's header is garbage, which would
            // mask the failure this test needs to exercise.
            for (const suffix of ['', '-wal', '-shm']) {
                const sidecarPath = `${betaPath}${suffix}`;
                if (existsSync(sidecarPath)) rmSync(sidecarPath);
            }
            writeFileSync(betaPath, 'this is not a valid sqlite database file, corrupted intentionally for this test');

            const now = localInstant(outgoingDate, '23:30');
            const nextDate = computeTomorrowDate('America/Mexico_City', now);

            const summary = await runNightlyTdahTick(dataDir, now);
            expect(summary.namespaceCount).toBe(2);
            expect(summary.firedCount).toBe(1);
            expect(summary.failedCount).toBe(1);

            // Alpha fired normally despite beta's failure in the same tick.
            expect(await countDayPlans(alphaPath, nextDate)).toBe(1);

            // Retrying the same tick still attempts (and fails) beta again, while alpha is now a no-op skip.
            const retry = await runNightlyTdahTick(dataDir, now);
            expect(retry.firedCount).toBe(0);
            expect(retry.skippedCount).toBe(1);
            expect(retry.failedCount).toBe(1);
        });
    });

    describe('computeTomorrowDate (story 1.5: DST-safe date arithmetic)', () => {
        test('rolls over correctly across a spring-forward DST transition (a 23-hour local day)', () => {
            // 2026-03-08 is when America/New_York springs forward (02:00 -> 03:00 local).
            expect(computeTomorrowDate('America/New_York', new Date('2026-03-08T20:00:00Z'))).toBe('2026-03-09');
        });

        test('rolls over correctly across a fall-back DST transition (a 25-hour local day)', () => {
            // 2026-11-01 is when America/New_York falls back (02:00 -> 01:00 local).
            expect(computeTomorrowDate('America/New_York', new Date('2026-11-01T20:00:00Z'))).toBe('2026-11-02');
        });

        test('rolls over a year boundary correctly regardless of a large positive UTC offset', () => {
            // Pacific/Kiritimati is UTC+14 year-round: 2026-12-30T20:00:00Z is
            // already 2026-12-31T10:00 local, so tomorrow is the new year.
            expect(computeTomorrowDate('Pacific/Kiritimati', new Date('2026-12-30T20:00:00Z'))).toBe('2027-01-01');
        });
    });

    describe('formatDateInTimeZone', () => {
        test('throws a controlled error instead of letting a raw Intl exception escape for a bogus IANA zone', () => {
            // Every production caller validates the time zone first (or falls
            // back to UTC) before this ever runs — this is a unit-level check
            // of the defensive try/catch boundary itself, not a reachable
            // production path.
            expect(() => formatDateInTimeZone(new Date(), 'Bogus/Zone')).toThrow();
        });
    });

    describe('isValidMonthString (P6/P8: single canonical validator, tightened year range)', () => {
        test('rejects a bogus year like 0099 or 0000 while accepting a sane 4-digit year', () => {
            expect(isValidMonthString('0099-01')).toBe(false);
            expect(isValidMonthString('0000-05')).toBe(false);
            expect(isValidMonthString('2026-08')).toBe(true);
            expect(isValidMonthString('1970-01')).toBe(true);
            expect(isValidMonthString('2999-12')).toBe(true);
        });

        test('still rejects a malformed month regardless of year', () => {
            expect(isValidMonthString('2026-13')).toBe(false);
            expect(isValidMonthString('2026-00')).toBe(false);
            expect(isValidMonthString('not-a-month')).toBe(false);
        });
    });
});

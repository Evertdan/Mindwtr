import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { tokenToKey } from '../server-auth';
import { startCloudServer, runTdahActivityTriggerIntervalTick, buildTdahActivityTriggerPush } from '../server';
import {
    activateTdahProfile,
    computeTomorrowDate,
    formatDateInTimeZone,
    isValidMonthString,
    listActiveTdahNamespaces,
    readTdahProfile,
    tdahDatabasePath,
    weekdayOfDate,
    withWriteTransaction,
} from './storage';
import { handleTdahRequest } from './routes';
import { runNightlyTdahTick } from './scheduler';
import { runActivityTriggerTick } from './activity-trigger';
import { createTdahWsConnectionRegistry, resolveTdahWsAuth, TDAH_WS_PATH } from './ws-channel';
import { createAllowedAuthTokens } from '../server-auth';
import type { TdahWsActivityTriggerEvent } from './types';

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

    const getDay = (token?: string): Promise<Response> => (
        authedFetch('/v1/tdah/day', { method: 'GET', token })
    );

    const createManualActivityApi = (body: unknown, token?: string): Promise<Response> => (
        authedFetch('/v1/tdah/day/activities', { method: 'POST', body: JSON.stringify(body), token })
    );

    const transitionActivityApi = (
        id: number,
        action: 'start' | 'complete' | 'miss',
        token?: string,
    ): Promise<Response> => (
        authedFetch(`/v1/tdah/activities/${id}/${action}`, { method: 'POST', token })
    );

    type TdahTestActivity = {
        id: number;
        dayPlanDate: string;
        blockId: number | null;
        title: string;
        startTime: string | null;
        durationMinutes: number | null;
        origin: string;
        state: string;
        startedAt: string | null;
        completedAt: string | null;
    };

    type TdahTestDay = {
        date: string;
        timeZone: string;
        routineTitle: string | null;
        activities: TdahTestActivity[];
    };

    const readDay = async (response: Response): Promise<TdahTestDay> => (
        await response.json() as TdahTestDay
    );

    const readActivity = async (response: Response): Promise<TdahTestActivity> => (
        (await response.json() as { activity: TdahTestActivity }).activity
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

    // server.ts's tdahServerConfig sets initializeNamespace: () => undefined
    // (the base config would plant the <key>.json sync document) — activating
    // TDAH must never reserve a sync document for the namespace.
    test('a full activation plants only the tdah artifacts — no sync document is reserved for the namespace', async () => {
        const response = await activate({ timeZone: 'UTC', routine: WORKDAY_ROUTINE });
        expect(response.status).toBe(200);

        const key = tokenToKey(TOKEN_ALPHA);
        expect(existsSync(join(dataDir, `${key}.json`))).toBe(false);
        expect(readdirSync(join(dataDir, key))).toEqual(['tdah']);
        expect(readdirSync(dataDir)).toEqual([key]);
    });

    // The module header documents WAL + synchronous=FULL as the durable
    // equivalent of the repo's temp->fsync->rename pattern. synchronous is
    // per-connection, so the assertion must read it from INSIDE a write
    // transaction (the exact connection shape withWriteTransaction opens).
    // SQLite's documented mapping: 1 = NORMAL, 2 = FULL, 3 = EXTRA.
    test('every write transaction opens with journal_mode=wal and synchronous=FULL (2)', async () => {
        await activate({ timeZone: 'UTC' });
        const databasePath = tdahDatabasePath(dataDir, tokenToKey(TOKEN_ALPHA));

        const pragmas = await withWriteTransaction(databasePath, (database) => ({
            journalMode: (database.prepare('PRAGMA journal_mode;').get() as { journal_mode?: string }).journal_mode,
            synchronous: (database.prepare('PRAGMA synchronous;').get() as { synchronous?: number }).synchronous,
        }));
        expect(pragmas.journalMode).toBe('wal');
        expect(pragmas.synchronous).toBe(2);
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

    // A '00:00' ritual hour is degenerate: every local time of day is
    // >= '00:00', so the scheduler's ritual-hour gate would be true all day
    // and the sweep-close would limbo the just-started day's Actividades on
    // every tick. '00:01' (the earliest non-degenerate value) must stay
    // valid, on both the PUT and the activate paths.
    test("ritualHour '00:00' is rejected on PUT /profile with 400 TDAH_INVALID_RITUAL_HOUR", async () => {
        const response = await putProfile({ timeZone: 'UTC', ritualHour: '00:00' });
        expect(response.status).toBe(400);
        expect(await readErrorCode(response)).toBe('TDAH_INVALID_RITUAL_HOUR');
    });

    test("ritualHour '00:00' is rejected on POST /activate with 400 TDAH_INVALID_RITUAL_HOUR", async () => {
        const response = await activate({ ritualHour: '00:00' });
        expect(response.status).toBe(400);
        expect(await readErrorCode(response)).toBe('TDAH_INVALID_RITUAL_HOUR');
    });

    test("ritualHour '00:01' and '23:00' remain valid on both the activate and PUT /profile paths", async () => {
        const activated = await activate({ timeZone: 'UTC', ritualHour: '00:01' });
        expect(activated.status).toBe(200);
        expect((await readProfile(activated))?.ritualHour).toBe('00:01');

        const updated = await putProfile({ ritualHour: '23:00' });
        expect(updated.status).toBe(200);
        expect((await readProfile(updated))?.ritualHour).toBe('23:00');
    });

    // A Bloque startTime of exactly midnight stays legal — the 00:00
    // rejection is a ritualHour-only rule, never a general HH:mm rule.
    test("a Bloque startTime of '00:00' is still valid (the 00:00 rejection is ritualHour-only)", async () => {
        const response = await activate({
            timeZone: 'UTC',
            routine: { title: 'Día laboral', blocks: [{ title: 'Medianoche', startTime: '00:00', durationMinutes: 30 }] },
        });
        expect(response.status).toBe(200);
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

        test('a request abort/timeout during activate or PUT /profile is reported with its own status, not always 413', async () => {
            // Bypasses HTTP/fetch on purpose: an aborted ReadableStream body,
            // fed straight into the exported handleTdahRequest, is the only
            // reliable way to force readJsonBody down the BodyReadError path
            // for the "aborted mid-read" cause (status 408) rather than the
            // "declared/observed length over the limit" cause (status 413).
            // PUT /profile used to hardcode 413 here while every sibling
            // handler (including activate) propagated the real status.
            const abortedBodyRequest = (path: string): { req: Request; signal: AbortSignal } => {
                const abortController = new AbortController();
                const req = new Request(`http://localhost${path}`, {
                    method: path === '/v1/tdah/activate' ? 'POST' : 'PUT',
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
                return { req, signal: abortController.signal };
            };
            const key = tokenToKey(TOKEN_ALPHA);

            const activateAborted = abortedBodyRequest('/v1/tdah/activate');
            const activateResponse = await handleTdahRequest(activateAborted.req, '/v1/tdah/activate', { key }, {
                dataDir,
                maxBodyBytes: 1024,
                signal: activateAborted.signal,
            });
            expect(activateResponse).not.toBeNull();
            expect(activateResponse?.status).toBe(408);
            expect(await readErrorCode(activateResponse as Response)).toBe('TDAH_INVALID_BODY');

            const profileAborted = abortedBodyRequest('/v1/tdah/profile');
            const profileResponse = await handleTdahRequest(profileAborted.req, '/v1/tdah/profile', { key }, {
                dataDir,
                maxBodyBytes: 1024,
                signal: profileAborted.signal,
            });
            expect(profileResponse).not.toBeNull();
            expect(profileResponse?.status).toBe(408);
            expect(await readErrorCode(profileResponse as Response)).toBe('TDAH_INVALID_BODY');
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

        test('a genuinely oversized PUT /profile body still returns 413 TDAH_INVALID_BODY (real status propagated, not hardcoded)', async () => {
            const response = await authedFetch('/v1/tdah/profile', {
                method: 'PUT',
                body: JSON.stringify({ timeZone: 'UTC', padding: 'x'.repeat(3 * 1024 * 1024) }),
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

        // Story 1.6 added a second version bump (tdah_activity's
        // started_at/completed_at, SCHEMA_VERSION_ACTIVITY_TIMESTAMPS = 2),
        // and story 2.2 added a third (start_notified_at/end_notified_at,
        // SCHEMA_VERSION_ACTIVITY_NOTIFICATIONS = 3), so a fresh database —
        // which gets all three widened/added shapes directly from their
        // CREATE TABLE statements — now lands at v3, not v1.
        test('a fresh database starts directly at schema v3 (no migration needed)', async () => {
            await activate({ timeZone: 'UTC' });
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const { Database } = await import('bun:sqlite');
            const database = new Database(databasePath, { readonly: true });
            try {
                const versionRow = database.prepare('PRAGMA user_version;').get() as { user_version: number };
                expect(versionRow.user_version).toBe(3);
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

            // Story 1.6's v1->v2 step and story 2.2's v2->v3 step also run
            // here: this seed never creates `tdah_activity` at all, so
            // `ensureSchema`'s `CREATE TABLE IF NOT EXISTS` plants it already
            // widened (started_at/completed_at and start_notified_at/
            // end_notified_at included), and both migration steps see those
            // columns present and stamp v3 directly — same as the "fresh
            // database" case above.
            const verifyDatabase = new Database(databasePath, { readonly: true });
            try {
                const versionRow = verifyDatabase.prepare('PRAGMA user_version;').get() as { user_version: number };
                expect(versionRow.user_version).toBe(3);
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

            // Same story 1.6 v1->v2 and story 2.2 v2->v3 cascade as the test
            // above: this seed never creates `tdah_activity` either, so it
            // lands on v3 too.
            const verifyDatabase = new Database(databasePath, { readonly: true });
            try {
                const versionRow = verifyDatabase.prepare('PRAGMA user_version;').get() as { user_version: number };
                expect(versionRow.user_version).toBe(3);
                const tableNames = (verifyDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'table';") as unknown as {
                    all(): { name: string }[];
                }).all().map((row) => row.name);
                expect(tableNames).not.toContain('tdah_routine_v2');
            } finally {
                verifyDatabase.close();
            }
        });
    });

    describe('GET /v1/tdah/day, POST /v1/tdah/day/activities, POST /v1/tdah/activities/:id/{start|complete|miss} (story 1.6)', () => {
        // Every-day pattern so these tests never depend on which real weekday
        // they happen to run on, matching WORKDAY_ROUTINE's own rationale above.
        const ALL_DAYS_ROUTINE = {
            title: 'Día laboral',
            pattern: { kind: 'weekday' as const, weekdays: [0, 1, 2, 3, 4, 5, 6] },
            blocks: [
                { title: 'Mañana', startTime: '08:00', durationMinutes: 120 },
                { title: 'Tarde', startTime: '14:00', durationMinutes: 180 },
            ],
        };

        // FR-1 gate (review fix): the Hoy mutation surface must not plant
        // DayPlans/Actividades — or tdah.sqlite itself — for a namespace that
        // never activated. This test used to enshrine the opposite
        // ("still auto-generates an empty today DayPlan").
        test('GET without any profile returns 409 TDAH_ACTIVATE_REQUIRED and plants nothing on disk', async () => {
            const response = await getDay();
            expect(response.status).toBe(409);
            expect(await readErrorCode(response)).toBe('TDAH_ACTIVATE_REQUIRED');
            expect(existsSync(join(dataDir, tokenToKey(TOKEN_ALPHA)))).toBe(false);
        });

        // Same FR-1 gate with the mode explicitly off (deactivation pauses
        // generation, FR-1) — day GET, manual-Activity POST, and one
        // transition all refuse; the ungated routines CRUD stays reachable so
        // Rutina templates survive deactivation by design.
        test('with mode off, the day GET, manual-Activity POST and activity transitions all return 409 TDAH_ACTIVATE_REQUIRED, while routines CRUD stays reachable', async () => {
            const activated = await activate({ timeZone: 'UTC', routine: ALL_DAYS_ROUTINE });
            expect(activated.status).toBe(200);
            const created = await readActivity(await createManualActivityApi({ title: 'Antes de apagar' }));
            await putProfile({ mode: 'off' });

            const dayResponse = await getDay();
            expect(dayResponse.status).toBe(409);
            expect(await readErrorCode(dayResponse)).toBe('TDAH_ACTIVATE_REQUIRED');

            const manualResponse = await createManualActivityApi({ title: 'Con modo apagado' });
            expect(manualResponse.status).toBe(409);
            expect(await readErrorCode(manualResponse)).toBe('TDAH_ACTIVATE_REQUIRED');

            const transitionResponse = await transitionActivityApi(created.id, 'start');
            expect(transitionResponse.status).toBe(409);
            expect(await readErrorCode(transitionResponse)).toBe('TDAH_ACTIVATE_REQUIRED');

            const routinesResponse = await listRoutinesApi();
            expect(routinesResponse.status).toBe(200);
            const routines = await readRoutines(routinesResponse);
            expect(routines).toHaveLength(1);
        });

        // AD-6: the client must compute "now" and the header date in the
        // caller's own configured profile time zone, never the requesting
        // device's local clock — a device set to a different zone than the
        // profile would otherwise show a wrong now-marker/date. The response
        // must carry the profile's real time zone, not the UTC default, for
        // the client to do that correctly.
        test("GET /v1/tdah/day returns the caller's configured profile time zone, not the UTC default", async () => {
            await activate({ timeZone: 'America/Mexico_City', routine: ALL_DAYS_ROUTINE });
            const day = await readDay(await getDay());
            expect(day.timeZone).toBe('America/Mexico_City');
        });

        test('first GET the same day as activation auto-generates today from the active Rutina (activate only ever generates tomorrow)', async () => {
            await activate({ timeZone: 'UTC', routine: ALL_DAYS_ROUTINE });
            const response = await getDay();
            expect(response.status).toBe(200);
            const day = await readDay(response);
            expect(day.routineTitle).toBe('Día laboral');
            expect(day.activities).toHaveLength(2);
            expect(day.activities.map((activity) => activity.title)).toEqual(['Mañana', 'Tarde']);
            for (const activity of day.activities) {
                expect(activity.origin).toBe('routine');
                expect(activity.state).toBe('pending');
                expect(activity.startedAt).toBeNull();
                expect(activity.completedAt).toBeNull();
            }
        });

        test('a second GET reads back the already-generated day instead of duplicating it', async () => {
            await activate({ timeZone: 'UTC', routine: ALL_DAYS_ROUTINE });
            const first = await readDay(await getDay());
            const second = await readDay(await getDay());
            expect(second).toEqual(first);
        });

        // PRAGMA data_version only increments when ANOTHER connection commits,
        // so an unchanged value across a request is direct evidence that the
        // request never opened (let alone committed) a write transaction —
        // exactly the read-only fast path getTodayDayPlan must take once
        // today's plan exists, instead of a BEGIN IMMEDIATE on every GET.
        test("once today's plan exists, GET /day serves it read-only (no write transaction)", async () => {
            await activate({ timeZone: 'UTC', routine: ALL_DAYS_ROUTINE });
            await getDay();

            const { Database } = await import('bun:sqlite');
            const probe = new Database(tdahDatabasePath(dataDir, tokenToKey(TOKEN_ALPHA)), { readonly: true });
            try {
                const readDataVersion = (): number => (
                    (probe.prepare('PRAGMA data_version;').get() as { data_version: number }).data_version
                );
                const before = readDataVersion();
                const response = await getDay();
                expect(response.status).toBe(200);
                expect(readDataVersion()).toBe(before);
            } finally {
                probe.close();
            }
        });

        test('no applicable Rutina yields routineTitle:null and an empty activities list (FR-3)', async () => {
            await activate({ timeZone: 'UTC' });
            const day = await readDay(await getDay());
            expect(day.routineTitle).toBeNull();
            expect(day.activities).toEqual([]);
        });

        test("GET /v1/tdah/day for one token never returns another token's Activities/DayPlan (namespace isolation)", async () => {
            await activate({ timeZone: 'America/Mexico_City', routine: ALL_DAYS_ROUTINE }, TOKEN_ALPHA);
            await createManualActivityApi({ title: 'Solo alpha' }, TOKEN_ALPHA);
            // Beta must be activated too: with the FR-1 mode gate, an
            // unactivated beta would 409 before any isolation assertion could run.
            await activate({ timeZone: 'UTC' }, TOKEN_BETA);

            const alphaDay = await readDay(await getDay(TOKEN_ALPHA));
            expect(alphaDay.activities.map((activity) => activity.title)).toContain('Solo alpha');
            expect(alphaDay.timeZone).toBe('America/Mexico_City');

            const betaDay = await readDay(await getDay(TOKEN_BETA));
            expect(betaDay.activities).toEqual([]);
            expect(betaDay.routineTitle).toBeNull();
            expect(betaDay.timeZone).toBe('UTC');
        });

        test('GET /v1/tdah/day rejects a non-GET method with 405 TDAH_METHOD_NOT_ALLOWED', async () => {
            const response = await authedFetch('/v1/tdah/day', { method: 'PUT' });
            expect(response.status).toBe(405);
            expect(await readErrorCode(response)).toBe('TDAH_METHOD_NOT_ALLOWED');
        });

        test('DELETE /v1/tdah/day returns 405 TDAH_METHOD_NOT_ALLOWED', async () => {
            const response = await authedFetch('/v1/tdah/day', { method: 'DELETE' });
            expect(response.status).toBe(405);
            expect(await readErrorCode(response)).toBe('TDAH_METHOD_NOT_ALLOWED');
        });

        describe('POST /v1/tdah/day/activities', () => {
            // FR-1 mode gate: every test below now needs an active (mode on)
            // profile — the endpoint 409s without one. Activated WITHOUT a
            // routine so tests asserting a day's activity ordering/content
            // see only their own manual Activities (today's plan bootstraps
            // empty on first write).
            beforeEach(async () => {
                await activate({ timeZone: 'UTC' });
            });

            test('creates a manual Activity with an explicit time/duration', async () => {
                const response = await createManualActivityApi({ title: 'Llamar al banco', startTime: '09:30', durationMinutes: 15 });
                expect(response.status).toBe(201);
                const activity = await readActivity(response);
                expect(activity.title).toBe('Llamar al banco');
                expect(activity.startTime).toBe('09:30');
                expect(activity.durationMinutes).toBe(15);
                expect(activity.origin).toBe('manual');
                expect(activity.state).toBe('pending');
                expect(activity.blockId).toBeNull();
                expect(activity.startedAt).toBeNull();
                expect(activity.completedAt).toBeNull();
            });

            test('omitted startTime/durationMinutes persist as null (FR-4/doc 02: genuinely optional, "sin hora") and the Activity still appears in the timeline', async () => {
                const created = await createManualActivityApi({ title: 'Sin hora' });
                expect(created.status).toBe(201);
                const activity = await readActivity(created);
                expect(activity.startTime).toBeNull();
                expect(activity.durationMinutes).toBeNull();

                const day = await readDay(await getDay());
                expect(day.activities.map((entry) => entry.title)).toContain('Sin hora');
            });

            test('a no-time Activity sorts after every timed Activity, in creation order', async () => {
                await createManualActivityApi({ title: 'Tarde', startTime: '18:00', durationMinutes: 30 });
                await createManualActivityApi({ title: 'Primero sin hora' });
                await createManualActivityApi({ title: 'Temprano', startTime: '07:00', durationMinutes: 30 });
                await createManualActivityApi({ title: 'Segundo sin hora' });

                const day = await readDay(await getDay());
                const titles = day.activities.map((entry) => entry.title);
                expect(titles).toEqual(['Temprano', 'Tarde', 'Primero sin hora', 'Segundo sin hora']);
            });

            test('omitting only startTime keeps an explicit durationMinutes, and vice versa', async () => {
                const durationOnly = await readActivity(
                    await createManualActivityApi({ title: 'Solo duración', durationMinutes: 45 }),
                );
                expect(durationOnly.startTime).toBeNull();
                expect(durationOnly.durationMinutes).toBe(45);

                const timeOnly = await readActivity(
                    await createManualActivityApi({ title: 'Solo hora', startTime: '11:15' }),
                );
                expect(timeOnly.startTime).toBe('11:15');
                expect(timeOnly.durationMinutes).toBeNull();
            });

            test("bootstraps today's DayPlan (and its Rutina Bloques) when no prior GET /v1/tdah/day has run", async () => {
                await activate({ timeZone: 'UTC', routine: ALL_DAYS_ROUTINE });
                const response = await createManualActivityApi({ title: 'Extra' });
                expect(response.status).toBe(201);
                const day = await readDay(await getDay());
                expect(day.routineTitle).toBe('Día laboral');
                expect(day.activities.map((activity) => activity.title).sort()).toEqual(['Extra', 'Mañana', 'Tarde']);
            });

            test('empty title returns 400 TDAH_ACTIVITY_INVALID', async () => {
                const response = await createManualActivityApi({ title: '   ' });
                expect(response.status).toBe(400);
                expect(await readErrorCode(response)).toBe('TDAH_ACTIVITY_INVALID');
            });

            test('oversized title returns 400 TDAH_ACTIVITY_INVALID', async () => {
                const response = await createManualActivityApi({ title: 'x'.repeat(81) });
                expect(response.status).toBe(400);
                expect(await readErrorCode(response)).toBe('TDAH_ACTIVITY_INVALID');
            });

            test('malformed startTime returns 400 TDAH_ACTIVITY_INVALID', async () => {
                const response = await createManualActivityApi({ title: 'Algo', startTime: '25:99' });
                expect(response.status).toBe(400);
                expect(await readErrorCode(response)).toBe('TDAH_ACTIVITY_INVALID');
            });

            test('negative durationMinutes returns 400 TDAH_ACTIVITY_INVALID', async () => {
                const response = await createManualActivityApi({ title: 'Algo', durationMinutes: -1 });
                expect(response.status).toBe(400);
                expect(await readErrorCode(response)).toBe('TDAH_ACTIVITY_INVALID');
            });

            test('durationMinutes over the shared Bloque cap (1440) returns 400 TDAH_ACTIVITY_INVALID', async () => {
                const response = await createManualActivityApi({ title: 'Algo', durationMinutes: 1441 });
                expect(response.status).toBe(400);
                expect(await readErrorCode(response)).toBe('TDAH_ACTIVITY_INVALID');
            });

            // --- TDAH_DAY_MAX_ACTIVITIES: unbounded manual-Activity creation per day is the same DW-2-style resource-cost concern TDAH_ROUTINE_MAX_BLOCKS/TDAH_ROUTINE_MAX_COUNT already guard against ---

            test('a day can hold up to TDAH_DAY_MAX_ACTIVITIES (50) Activities, and the 51st manual add is rejected with TDAH_ACTIVITY_INVALID', async () => {
                for (let i = 0; i < 50; i += 1) {
                    const response = await createManualActivityApi({ title: `Actividad ${i}` });
                    expect(response.status).toBe(201);
                }

                const overCap = await createManualActivityApi({ title: 'Actividad 51' });
                expect(overCap.status).toBe(400);
                expect(await readErrorCode(overCap)).toBe('TDAH_ACTIVITY_INVALID');

                const day = await readDay(await getDay());
                expect(day.activities).toHaveLength(50);
            });

            test('GET on the activities collection path returns 405 TDAH_METHOD_NOT_ALLOWED', async () => {
                const response = await authedFetch('/v1/tdah/day/activities', { method: 'GET' });
                expect(response.status).toBe(405);
                expect(await readErrorCode(response)).toBe('TDAH_METHOD_NOT_ALLOWED');
            });

            test('DELETE on the activities collection path returns 405 TDAH_METHOD_NOT_ALLOWED', async () => {
                const response = await authedFetch('/v1/tdah/day/activities', { method: 'DELETE' });
                expect(response.status).toBe(405);
                expect(await readErrorCode(response)).toBe('TDAH_METHOD_NOT_ALLOWED');
            });
        });

        describe('POST /v1/tdah/activities/:id/{start|complete|miss} (AD-7 idempotency)', () => {
            const createTodayActivity = async (): Promise<TdahTestActivity> => (
                await readActivity(await createManualActivityApi({ title: 'Meditar', startTime: '07:00', durationMinutes: 10 }))
            );

            // FR-1 mode gate: `createTodayActivity` posts through the gated
            // manual-Activity endpoint, so the profile must be active first.
            beforeEach(async () => {
                await activate({ timeZone: 'UTC' });
            });

            test('start on a pending Activity sets state:started and startedAt', async () => {
                const created = await createTodayActivity();
                const response = await transitionActivityApi(created.id, 'start');
                expect(response.status).toBe(200);
                const activity = await readActivity(response);
                expect(activity.state).toBe('started');
                expect(typeof activity.startedAt).toBe('string');
                expect(activity.completedAt).toBeNull();
            });

            test('a raced double-tap of start is a no-op — same startedAt, never a second write', async () => {
                const created = await createTodayActivity();
                const first = await readActivity(await transitionActivityApi(created.id, 'start'));
                const second = await readActivity(await transitionActivityApi(created.id, 'start'));
                expect(second.state).toBe('started');
                expect(second.startedAt).toBe(first.startedAt);
            });

            test('complete on a pending Activity sets state:completed and completedAt without ever starting it', async () => {
                const created = await createTodayActivity();
                const response = await transitionActivityApi(created.id, 'complete');
                expect(response.status).toBe(200);
                const activity = await readActivity(response);
                expect(activity.state).toBe('completed');
                expect(typeof activity.completedAt).toBe('string');
                expect(activity.startedAt).toBeNull();
            });

            test('complete on a started Activity preserves the original startedAt', async () => {
                const created = await createTodayActivity();
                const started = await readActivity(await transitionActivityApi(created.id, 'start'));
                const completed = await readActivity(await transitionActivityApi(created.id, 'complete'));
                expect(completed.state).toBe('completed');
                expect(completed.startedAt).toBe(started.startedAt);
            });

            test('miss on a pending Activity sets state:missed without a completedAt', async () => {
                const created = await createTodayActivity();
                const response = await transitionActivityApi(created.id, 'miss');
                expect(response.status).toBe(200);
                const activity = await readActivity(response);
                expect(activity.state).toBe('missed');
                expect(activity.completedAt).toBeNull();
            });

            test('re-registering the same target state (complete twice) is a 200 no-op, not a duplicate write', async () => {
                const created = await createTodayActivity();
                const first = await readActivity(await transitionActivityApi(created.id, 'complete'));
                const second = await readActivity(await transitionActivityApi(created.id, 'complete'));
                expect(second.completedAt).toBe(first.completedAt);
            });

            test('miss after complete (different terminal state) is rejected with 400 TDAH_ACTIVITY_INVALID', async () => {
                const created = await createTodayActivity();
                await transitionActivityApi(created.id, 'complete');
                const response = await transitionActivityApi(created.id, 'miss');
                expect(response.status).toBe(400);
                expect(await readErrorCode(response)).toBe('TDAH_ACTIVITY_INVALID');
            });

            test('complete after miss (different terminal state) is rejected with 400 TDAH_ACTIVITY_INVALID', async () => {
                const created = await createTodayActivity();
                await transitionActivityApi(created.id, 'miss');
                const response = await transitionActivityApi(created.id, 'complete');
                expect(response.status).toBe(400);
                expect(await readErrorCode(response)).toBe('TDAH_ACTIVITY_INVALID');
            });

            test('start on an already-completed Activity is a no-op, not an error', async () => {
                const created = await createTodayActivity();
                await transitionActivityApi(created.id, 'complete');
                const response = await transitionActivityApi(created.id, 'start');
                expect(response.status).toBe(200);
                const activity = await readActivity(response);
                expect(activity.state).toBe('completed');
                expect(activity.startedAt).toBeNull();
            });

            test('unknown Activity id returns 404 TDAH_NOT_FOUND', async () => {
                const response = await transitionActivityApi(999999, 'start');
                expect(response.status).toBe(404);
                expect(await readErrorCode(response)).toBe('TDAH_NOT_FOUND');
            });

            // An id past Number.MAX_SAFE_INTEGER silently loses precision
            // through `Number()` and could otherwise coerce to a different,
            // real id — parsePositiveIntegerId must reject it outright rather
            // than let it fall through to a lookup, the same 404 a malformed
            // id already gets.
            test('an activity id past Number.MAX_SAFE_INTEGER returns 404 TDAH_NOT_FOUND, not a coerced match', async () => {
                const created = await createTodayActivity();
                const unsafeId = `9007199254740993${created.id}`;
                const response = await authedFetch(`/v1/tdah/activities/${unsafeId}/start`, { method: 'POST' });
                expect(response.status).toBe(404);
                expect(await readErrorCode(response)).toBe('TDAH_NOT_FOUND');
            });

            test("registering an action on another namespace's Activity 404s (namespace isolation)", async () => {
                const created = await createTodayActivity();
                // Beta needs its own active profile: the FR-1 mode gate would
                // otherwise 409 for a never-activated namespace before this
                // test could assert the activity-level 404 it exists for.
                await activate({ timeZone: 'UTC' }, TOKEN_BETA);
                const response = await transitionActivityApi(created.id, 'start', TOKEN_BETA);
                expect(response.status).toBe(404);
                expect(await readErrorCode(response)).toBe('TDAH_NOT_FOUND');
            });

            test('GET on an activity-action path returns 405 TDAH_METHOD_NOT_ALLOWED', async () => {
                const created = await createTodayActivity();
                const response = await authedFetch(`/v1/tdah/activities/${created.id}/start`, { method: 'GET' });
                expect(response.status).toBe(405);
                expect(await readErrorCode(response)).toBe('TDAH_METHOD_NOT_ALLOWED');
            });
        });

        describe('schema migration v1 -> v2 (started_at/completed_at)', () => {
            test('a fresh database starts directly at schema v3 (story 2.2 bump) with started_at/completed_at present and start_time/duration_minutes nullable', async () => {
                await activate({ timeZone: 'UTC' });
                const key = tokenToKey(TOKEN_ALPHA);
                const databasePath = tdahDatabasePath(dataDir, key);
                const { Database } = await import('bun:sqlite');
                const database = new Database(databasePath, { readonly: true });
                try {
                    const versionRow = database.prepare('PRAGMA user_version;').get() as { user_version: number };
                    expect(versionRow.user_version).toBe(3);
                    const columns = (database.prepare("PRAGMA table_info('tdah_activity');") as unknown as {
                        all(): { name: string; notnull: number }[];
                    }).all();
                    expect(columns.some((column) => column.name === 'started_at')).toBe(true);
                    expect(columns.some((column) => column.name === 'completed_at')).toBe(true);
                    expect(columns.find((column) => column.name === 'start_time')?.notnull).toBe(0);
                    expect(columns.find((column) => column.name === 'duration_minutes')?.notnull).toBe(0);
                } finally {
                    database.close();
                }
            });

            test('a pre-1.6 (schema v1) database on disk migrates transparently and backfills started_at/completed_at as NULL', async () => {
                const key = tokenToKey(TOKEN_ALPHA);
                const databasePath = tdahDatabasePath(dataDir, key);
                mkdirSync(join(dataDir, key, 'tdah'), { recursive: true });

                const today = formatDateInTimeZone(new Date(), 'UTC');
                const { Database } = await import('bun:sqlite');
                const seedDatabase = new Database(databasePath);
                try {
                    seedDatabase.exec(`
                        CREATE TABLE tdah_routine (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            title TEXT NOT NULL,
                            pattern_kind TEXT NOT NULL CHECK (pattern_kind IN ('weekday', 'nthWeekdayOfMonth')),
                            pattern_weekdays TEXT,
                            pattern_nth_ordinal INTEGER,
                            pattern_nth_weekday INTEGER,
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
                    seedDatabase.exec(`
                        CREATE TABLE tdah_day_plan (
                            date TEXT PRIMARY KEY,
                            generated_at TEXT NOT NULL
                        );
                    `);
                    // Deliberately the pre-1.6 shape — widened routine columns
                    // (story 1.4) already present, but no started_at/completed_at
                    // on tdah_activity yet.
                    seedDatabase.exec(`
                        CREATE TABLE tdah_activity (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            day_plan_date TEXT NOT NULL REFERENCES tdah_day_plan(date),
                            block_id INTEGER REFERENCES tdah_routine_block(id),
                            title TEXT NOT NULL,
                            start_time TEXT NOT NULL,
                            duration_minutes INTEGER NOT NULL,
                            origin TEXT NOT NULL CHECK (origin IN ('routine', 'manual')),
                            state TEXT NOT NULL CHECK (state IN ('pending', 'started', 'completed', 'missed', 'limbo', 'discarded')) DEFAULT 'pending'
                        );
                    `);
                    seedDatabase.prepare('INSERT INTO tdah_day_plan (date, generated_at) VALUES (?, ?);').run(today, '2026-01-01T00:00:00.000Z');
                    seedDatabase
                        .prepare("INSERT INTO tdah_activity (day_plan_date, block_id, title, start_time, duration_minutes, origin, state) VALUES (?, NULL, 'Vieja', '08:00', 30, 'manual', 'pending');")
                        .run(today);
                    // PRAGMA user_version = 1 — matches a real post-1.4/pre-1.6 file on disk.
                    seedDatabase.exec('PRAGMA user_version = 1;');
                } finally {
                    seedDatabase.close();
                }

            // FR-1 mode gate: GET /day needs an active profile now. Activation
            // is the write that runs both migration steps here (its single
            // withWriteTransaction opens the seeded v1 file and runs
            // ensureSchema), so the assertions below still verify the same
            // end state as when getDay was the first module touch.
            await activate({ timeZone: 'UTC' });

            const response = await getDay();
            expect(response.status).toBe(200);
            const day = await readDay(response);
            expect(day.activities).toHaveLength(1);
            expect(day.activities[0]?.title).toBe('Vieja');
                // The pre-1.6 row's real (non-null) start_time/duration_minutes
                // values must survive the create-copy-drop-rename rebuild
                // untouched — the rebuild widens the column definitions, it
                // never rewrites existing data.
                expect(day.activities[0]?.startTime).toBe('08:00');
                expect(day.activities[0]?.durationMinutes).toBe(30);
                expect(day.activities[0]?.startedAt).toBeNull();
                expect(day.activities[0]?.completedAt).toBeNull();

                // The whole point of rebuilding rather than ALTER-TABLE-ing:
                // the migrated table must actually accept NULL start_time/
                // duration_minutes for a newly created manual Activity, not
                // just carry the started_at/completed_at columns structurally.
                const createdAfterMigration = await readActivity(
                    await createManualActivityApi({ title: 'Nueva sin hora' }),
                );
                expect(createdAfterMigration.startTime).toBeNull();
                expect(createdAfterMigration.durationMinutes).toBeNull();

                const verifyDatabase = new Database(databasePath, { readonly: true });
                try {
                    const versionRow = verifyDatabase.prepare('PRAGMA user_version;').get() as { user_version: number };
                    // v1 -> v2 (this describe's own migration) then v2 -> v3
                    // (story 2.2's) both run in sequence on this seeded v1 file.
                    expect(versionRow.user_version).toBe(3);
                    const columns = (verifyDatabase.prepare("PRAGMA table_info('tdah_activity');") as unknown as {
                        all(): { name: string; notnull: number }[];
                    }).all();
                    expect(columns.some((column) => column.name === 'started_at')).toBe(true);
                    expect(columns.some((column) => column.name === 'completed_at')).toBe(true);
                    expect(columns.find((column) => column.name === 'start_time')?.notnull).toBe(0);
                    expect(columns.find((column) => column.name === 'duration_minutes')?.notnull).toBe(0);
                } finally {
                    verifyDatabase.close();
                }
            });

            // Both migration steps are otherwise only ever exercised
            // independently: the v0 Rutina-widening test above never creates
            // `tdah_activity` at all (so ensureSchema's CREATE TABLE IF NOT
            // EXISTS plants it already-widened and the activity rebuild's real
            // body never runs), and the v1->v2-only test above seeds a
            // database already at v1 (so the routine-widening rebuild never
            // runs alongside it). This is the realistic "skip an intermediate
            // release, upgrade straight from pre-1.4 to post-1.6" scenario: a
            // v0 database (unset user_version) with BOTH a legacy, unwidened
            // Rutina/Bloque set AND a legacy, populated tdah_activity table.
            test('a v0 database with both a legacy Rutina/Bloque set and a legacy populated tdah_activity table runs both migrations in sequence on first touch (skip-an-intermediate-release upgrade)', async () => {
                const key = tokenToKey(TOKEN_ALPHA);
                const databasePath = tdahDatabasePath(dataDir, key);
                mkdirSync(join(dataDir, key, 'tdah'), { recursive: true });

                const today = formatDateInTimeZone(new Date(), 'UTC');
                const { Database } = await import('bun:sqlite');
                const seedDatabase = new Database(databasePath);
                try {
                    // Legacy (pre-1.4) narrow Rutina shape — single-literal
                    // CHECK, no pattern_weekdays/pattern_nth_* columns.
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
                    seedDatabase.exec(`
                        CREATE TABLE tdah_day_plan (
                            date TEXT PRIMARY KEY,
                            generated_at TEXT NOT NULL
                        );
                    `);
                    // Legacy (pre-1.6) narrow Activity shape — NOT NULL
                    // start_time/duration_minutes, no started_at/completed_at.
                    seedDatabase.exec(`
                        CREATE TABLE tdah_activity (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            day_plan_date TEXT NOT NULL REFERENCES tdah_day_plan(date),
                            block_id INTEGER REFERENCES tdah_routine_block(id),
                            title TEXT NOT NULL,
                            start_time TEXT NOT NULL,
                            duration_minutes INTEGER NOT NULL,
                            origin TEXT NOT NULL CHECK (origin IN ('routine', 'manual')),
                            state TEXT NOT NULL CHECK (state IN ('pending', 'started', 'completed', 'missed', 'limbo', 'discarded')) DEFAULT 'pending'
                        );
                    `);
                    seedDatabase
                        .prepare("INSERT INTO tdah_routine (id, title, pattern_kind, created_at) VALUES (1, 'Día laboral', 'weekday', '2026-01-01T00:00:00.000Z');")
                        .run();
                    seedDatabase
                        .prepare("INSERT INTO tdah_routine_block (routine_id, title, start_time, duration_minutes, sort_order) VALUES (1, 'Mañana', '08:00', 120, 0);")
                        .run();
                    seedDatabase.prepare('INSERT INTO tdah_day_plan (date, generated_at) VALUES (?, ?);').run(today, '2026-01-01T00:00:00.000Z');
                    seedDatabase
                        .prepare("INSERT INTO tdah_activity (day_plan_date, block_id, title, start_time, duration_minutes, origin, state) VALUES (?, NULL, 'Legado', '09:15', 45, 'manual', 'pending');")
                        .run(today);
                    // PRAGMA user_version defaults to 0 — left unset on
                    // purpose, matching a real database that never ran
                    // story 1.4's migration at all before 1.6 shipped.
                } finally {
                    seedDatabase.close();
                }

            // A single request is enough to trigger both migration steps
            // in sequence — activation's withWriteTransaction opens the v0
            // file and `ensureSchema` runs the v0->v1 Rutina widening first,
            // then the v1->v2 Activity rebuild, all inside the same call.
            // (FR-1 mode gate: the profile this creates is also what lets
            // the getDay below through.)
            await activate({ timeZone: 'UTC' });
            const response = await getDay();
            expect(response.status).toBe(200);
            const day = await readDay(response);
            const legacyActivity = day.activities.find((activity) => activity.title === 'Legado');
                // The pre-1.6 row's real (non-null) start_time/duration_minutes
                // values must survive the create-copy-drop-rename rebuild
                // untouched, with started_at/completed_at backfilled to NULL.
                expect(legacyActivity?.startTime).toBe('09:15');
                expect(legacyActivity?.durationMinutes).toBe(45);
                expect(legacyActivity?.startedAt).toBeNull();
                expect(legacyActivity?.completedAt).toBeNull();

                // Same assertions as the standalone v0->v1 test: the Rutina
                // survives correctly widened to the explicit Mon-Fri default.
                const routines = await readRoutines(await listRoutinesApi());
                expect(routines).toHaveLength(1);
                expect(routines[0]?.title).toBe('Día laboral');
                expect(routines[0]?.pattern).toEqual({ kind: 'weekday', weekdays: [1, 2, 3, 4, 5] });
                expect(routines[0]?.blocks).toHaveLength(1);

                const verifyDatabase = new Database(databasePath, { readonly: true });
                try {
                    const versionRow = verifyDatabase.prepare('PRAGMA user_version;').get() as { user_version: number };
                    // All three migration steps (v0->v1, v1->v2, v2->v3) run in
                    // sequence on this seeded v0 file.
                    expect(versionRow.user_version).toBe(3);
                } finally {
                    verifyDatabase.close();
                }
            });
        });
    });

    describe('WS channel (story 2.1: persistent connection)', () => {
        type TdahWsServerEventLike = { kind: string; at: string };

        const wsUrl = (token: string = TOKEN_ALPHA): string => (
            `ws://127.0.0.1:${server!.port}${TDAH_WS_PATH}?token=${encodeURIComponent(token)}`
        );

        // Resolves once the server's own "connected" event (types.ts's
        // `TdahWsConnectedEvent`) arrives — proof the upgrade actually
        // completed and the channel is live, not just that the client-side
        // `open` event fired.
        const openTdahWs = (token?: string): Promise<{ ws: WebSocket; connectedEvent: TdahWsServerEventLike }> => (
            new Promise((resolve, reject) => {
                const ws = new WebSocket(wsUrl(token));
                const timeout = setTimeout(() => {
                    reject(new Error('WS did not receive the connected event in time'));
                }, 2000);
                ws.onmessage = (event) => {
                    clearTimeout(timeout);
                    resolve({ ws, connectedEvent: JSON.parse(String(event.data)) as TdahWsServerEventLike });
                };
                ws.onerror = () => {
                    clearTimeout(timeout);
                    reject(new Error('WS errored before the connected event arrived'));
                };
            })
        );

        const waitForClose = (ws: WebSocket): Promise<void> => (
            new Promise((resolve) => {
                if (ws.readyState === ws.CLOSED) {
                    resolve();
                    return;
                }
                ws.onclose = () => resolve();
            })
        );

        test('a valid token upgrades the connection and receives a "connected" event', async () => {
            const { ws, connectedEvent } = await openTdahWs();
            expect(connectedEvent.kind).toBe('connected');
            expect(typeof connectedEvent.at).toBe('string');
            expect(Number.isNaN(Date.parse(connectedEvent.at))).toBe(false);
            ws.close();
            await waitForClose(ws);
        });

        test('a missing token is rejected before the handshake, with 401 and a .code body', async () => {
            const response = await fetch(`${baseUrl}${TDAH_WS_PATH}`);
            expect(response.status).toBe(401);
            expect(await readErrorCode(response)).toBe('TDAH_WS_UNAUTHORIZED');
        });

        test('a malformed token is rejected before the handshake, with 401 and a .code body', async () => {
            const response = await fetch(`${baseUrl}${TDAH_WS_PATH}?token=short`);
            expect(response.status).toBe(401);
            expect(await readErrorCode(response)).toBe('TDAH_WS_UNAUTHORIZED');
        });

        test('a well-formed but unrecognized token is rejected the same way as a missing one', async () => {
            // Same length/charset as TOKEN_ALPHA (passes the bearer-token
            // format check) but never added to this server's
            // allowedAuthTokens allowlist — proves the allowlist check runs,
            // not just the format check.
            const response = await fetch(`${baseUrl}${TDAH_WS_PATH}?token=tdah-token-unknown-0000000`);
            expect(response.status).toBe(401);
            expect(await readErrorCode(response)).toBe('TDAH_WS_UNAUTHORIZED');
        });

        test('non-GET requests to the WS path are rejected with 405, before auth is even checked', async () => {
            const response = await fetch(`${baseUrl}${TDAH_WS_PATH}`, { method: 'POST' });
            expect(response.status).toBe(405);
            expect(await readErrorCode(response)).toBe('TDAH_METHOD_NOT_ALLOWED');
        });

        test('a valid token without a real WS handshake gets a plain 400, not the channel\'s .code', async () => {
            // A plain fetch() GET never sends the Upgrade/Connection headers a
            // real WS client sends, so `bunServer.upgrade()` returns false
            // even though the token itself is valid and allowlisted — this is
            // the "not a real handshake" branch, distinct from an auth
            // rejection (server.ts's own comment on that branch).
            const response = await fetch(`${baseUrl}${TDAH_WS_PATH}?token=${encodeURIComponent(TOKEN_ALPHA)}`);
            expect(response.status).toBe(400);
            const body = await response.json() as { error?: string };
            expect(body.error).toBe('WebSocket upgrade required');
        });

        test('repeated invalid-token attempts trip the same auth-failure rate limit as HTTP routes, returning 429', async () => {
            // Mirrors server.test.ts's "auth failure throttling never bypasses
            // token checks" pattern: AUTH_FAILURE_RATE_MAX defaults to 30, so
            // the 31st request in the same window trips it. All requests
            // share the 'auth-failure:ip:unknown' bucket here (no
            // trustProxyHeaders configured), same as that existing test.
            let firstStatus = 0;
            let lastStatus = 0;
            for (let attempt = 0; attempt < 31; attempt += 1) {
                const response = await fetch(`${baseUrl}${TDAH_WS_PATH}?token=not-a-real-token-at-all-000`);
                if (attempt === 0) firstStatus = response.status;
                lastStatus = response.status;
            }
            expect(firstStatus).toBe(401);
            expect(lastStatus).toBe(429);
        });

        test('a client-initiated close is clean: the server keeps serving, and the same namespace can reconnect right away', async () => {
            const { ws } = await openTdahWs();
            ws.close(1000, 'done');
            await waitForClose(ws);
            expect(ws.readyState).toBe(ws.CLOSED);

            // The disconnect must not affect the rest of the server.
            const health = await fetch(`${baseUrl}/health`);
            expect(health.status).toBe(200);

            // And the closed connection's registry entry didn't leak or block
            // a fresh upgrade for the very same namespace.
            const reconnect = await openTdahWs();
            expect(reconnect.connectedEvent.kind).toBe('connected');
            reconnect.ws.close();
            await waitForClose(reconnect.ws);
        });

        test('two different tokens each get their own independent, simultaneous connection', async () => {
            const alpha = await openTdahWs(TOKEN_ALPHA);
            const beta = await openTdahWs(TOKEN_BETA);
            expect(alpha.ws.readyState).toBe(alpha.ws.OPEN);
            expect(beta.ws.readyState).toBe(beta.ws.OPEN);
            alpha.ws.close();
            beta.ws.close();
            await Promise.all([waitForClose(alpha.ws), waitForClose(beta.ws)]);
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

        // Review FIX 1, scenario (a): POST /activate already generated
        // tomorrow earlier in the day — the ritual-hour tick that evening
        // must still close TODAY (the old pre-check skipped the whole tick
        // because tomorrow existed, so the outgoing day was never limboed).
        test('activation-day close runs even though tomorrow was already generated at activation', async () => {
            const activation = await activate({
                timeZone: 'America/Mexico_City',
                ritualHour: '22:00',
                routine: WORKDAY_ROUTINE,
            });
            const activationBody = await readActivateResponse(activation);
            // The Hoy gap-filler generates TODAY's plan (activation only ever
            // generates tomorrow's).
            const today = await readDay(await getDay());
            expect(today.activities).toHaveLength(WORKDAY_ROUTINE.blocks.length);

            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const now = localInstant(today.date, '23:30');
            const nextDate = computeTomorrowDate('America/Mexico_City', now);
            // Activation happened "earlier today", so tomorrow's plan exists already.
            expect(nextDate).toBe(activationBody.dayPlan.date);

            const summary = await runNightlyTdahTick(dataDir, now);
            expect(summary.firedCount).toBe(1);
            expect(summary.skippedCount).toBe(0);
            // Sweep-only fire: nothing new generated (tomorrow existed), but
            // today's pending Actividades were all closed.
            expect(summary.generatedCount).toBe(0);
            expect(summary.limboCount).toBe(WORKDAY_ROUTINE.blocks.length);

            const todayRows = await readActivityRows(databasePath, today.date);
            for (const row of todayRows) {
                expect(row.state).toBe('limbo');
            }
            expect(await countDayPlans(databasePath, nextDate)).toBe(1);
            const nextRows = await readActivityRows(databasePath, nextDate);
            expect(nextRows).toHaveLength(WORKDAY_ROUTINE.blocks.length);
            for (const row of nextRows) {
                expect(row.state).toBe('pending');
            }
        });

        // Review FIX 1, scenario (b): an Actividad added after the ritual
        // fired (between the fire and midnight) is limboed by the NEXT tick
        // — the old tick skipped forever once tomorrow existed.
        test('a late Actividad added after the ritual fire is limboed by the next tick', async () => {
            const activation = await activate({
                timeZone: 'America/Mexico_City',
                ritualHour: '22:00',
                routine: WORKDAY_ROUTINE,
            });
            const activationBody = await readActivateResponse(activation);
            const outgoingDate = activationBody.dayPlan.date;
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);

            const first = await runNightlyTdahTick(dataDir, localInstant(outgoingDate, '23:30'));
            expect(first.firedCount).toBe(1);

            // A manual add later the same evening, still before midnight —
            // seeded directly because the real clock (which
            // createManualActivity would use) is not the simulated one.
            const { Database } = await import('bun:sqlite');
            const seedDatabase = new Database(databasePath);
            try {
                seedDatabase
                    .prepare("INSERT INTO tdah_activity (day_plan_date, block_id, title, start_time, duration_minutes, origin, state) VALUES (?, NULL, 'Tardía', '23:45', 10, 'manual', 'pending');")
                    .run(outgoingDate);
            } finally {
                seedDatabase.close();
            }

            const second = await runNightlyTdahTick(dataDir, localInstant(outgoingDate, '23:50'));
            expect(second.firedCount).toBe(1);
            expect(second.generatedCount).toBe(0);
            expect(second.limboCount).toBe(1);

            const lateRow = (await readActivityRows(databasePath, outgoingDate)).find((row) => row.title === 'Tardía');
            expect(lateRow?.state).toBe('limbo');
        });

        // Review FIX 1, scenario (c): a whole ritual window missed (e.g.
        // deploy downtime 23:00–00:00) leaves a stale past day pending —
        // the sweep (`day_plan_date <= today`) closes it at the next ritual
        // tick instead of leaving it pending forever.
        test('a stale past day (missed ritual window) is swept to limbo at the next ritual tick', async () => {
            const activation = await activate({
                timeZone: 'America/Mexico_City',
                ritualHour: '22:00',
                routine: WORKDAY_ROUTINE,
            });
            const activationBody = await readActivateResponse(activation);
            const outgoingDate = activationBody.dayPlan.date;
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);

            const staleDate = '2000-01-01';
            const { Database } = await import('bun:sqlite');
            const seedDatabase = new Database(databasePath);
            try {
                seedDatabase.prepare('INSERT INTO tdah_day_plan (date, generated_at) VALUES (?, ?);').run(staleDate, '2000-01-01T00:00:00.000Z');
                seedDatabase
                    .prepare("INSERT INTO tdah_activity (day_plan_date, block_id, title, start_time, duration_minutes, origin, state) VALUES (?, NULL, 'Día olvidado', '09:00', 30, 'manual', 'pending');")
                    .run(staleDate);
            } finally {
                seedDatabase.close();
            }

            const summary = await runNightlyTdahTick(dataDir, localInstant(outgoingDate, '23:30'));
            expect(summary.firedCount).toBe(1);
            // The stale day's one Actividad plus the outgoing day's two.
            expect(summary.limboCount).toBe(WORKDAY_ROUTINE.blocks.length + 1);

            const staleRow = (await readActivityRows(databasePath, staleDate)).find((row) => row.title === 'Día olvidado');
            expect(staleRow?.state).toBe('limbo');
        });

        // Same data_version technique as the GET /day read-only test: an
        // unchanged value across the second tick proves the steady-state
        // skip never opens (let alone commits) a write transaction.
        test('a steady-state re-fire stays skipped and takes no write path', async () => {
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

            const first = await runNightlyTdahTick(dataDir, now);
            expect(first.firedCount).toBe(1);

            const { Database } = await import('bun:sqlite');
            const probe = new Database(databasePath, { readonly: true });
            try {
                const readDataVersion = (): number => (
                    (probe.prepare('PRAGMA data_version;').get() as { data_version: number }).data_version
                );
                const before = readDataVersion();
                const second = await runNightlyTdahTick(dataDir, now);
                expect(second.firedCount).toBe(0);
                expect(second.skippedCount).toBe(1);
                expect(readDataVersion()).toBe(before);
            } finally {
                probe.close();
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

    describe('schema migration v2 -> v3 (start_notified_at/end_notified_at, story 2.2)', () => {
        test('a fresh database starts directly at schema v3 with start_notified_at/end_notified_at present', async () => {
            await activate({ timeZone: 'UTC' });
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const { Database } = await import('bun:sqlite');
            const database = new Database(databasePath, { readonly: true });
            try {
                const versionRow = database.prepare('PRAGMA user_version;').get() as { user_version: number };
                expect(versionRow.user_version).toBe(3);
                const columns = (database.prepare("PRAGMA table_info('tdah_activity');") as unknown as {
                    all(): { name: string }[];
                }).all();
                expect(columns.some((column) => column.name === 'start_notified_at')).toBe(true);
                expect(columns.some((column) => column.name === 'end_notified_at')).toBe(true);
            } finally {
                database.close();
            }
        });

        test('a pre-2.2 (schema v2) database on disk migrates transparently via ALTER TABLE, backfilling both new columns as NULL', async () => {
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            mkdirSync(join(dataDir, key, 'tdah'), { recursive: true });

            const today = formatDateInTimeZone(new Date(), 'UTC');
            const { Database } = await import('bun:sqlite');
            const seedDatabase = new Database(databasePath);
            try {
                // Deliberately the pre-2.2 shape (story 1.6's schema v2):
                // started_at/completed_at present, but no start_notified_at/
                // end_notified_at yet.
                seedDatabase.exec(`
                    CREATE TABLE tdah_day_plan (
                        date TEXT PRIMARY KEY,
                        generated_at TEXT NOT NULL
                    );
                `);
                seedDatabase.exec(`
                    CREATE TABLE tdah_activity (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        day_plan_date TEXT NOT NULL REFERENCES tdah_day_plan(date),
                        block_id INTEGER,
                        title TEXT NOT NULL,
                        start_time TEXT,
                        duration_minutes INTEGER,
                        origin TEXT NOT NULL CHECK (origin IN ('routine', 'manual')),
                        state TEXT NOT NULL CHECK (state IN ('pending', 'started', 'completed', 'missed', 'limbo', 'discarded')) DEFAULT 'pending',
                        started_at TEXT,
                        completed_at TEXT
                    );
                `);
                seedDatabase.prepare('INSERT INTO tdah_day_plan (date, generated_at) VALUES (?, ?);').run(today, '2026-01-01T00:00:00.000Z');
                seedDatabase
                    .prepare("INSERT INTO tdah_activity (day_plan_date, block_id, title, start_time, duration_minutes, origin, state) VALUES (?, NULL, 'Vieja', '08:00', 30, 'manual', 'pending');")
                    .run(today);
                // PRAGMA user_version = 2 — matches a real post-1.6/pre-2.2 file on disk.
                seedDatabase.exec('PRAGMA user_version = 2;');
            } finally {
                seedDatabase.close();
            }

            // FR-1 mode gate: GET /day needs an active profile — activation's
            // withWriteTransaction is the write that opens the seeded v2 file
            // and runs ensureSchema, migrating it in place.
            await activate({ timeZone: 'UTC' });

            const day = await readDay(await getDay());
            expect(day.activities).toHaveLength(1);
            expect(day.activities[0]?.title).toBe('Vieja');
            // The pre-2.2 row's real values survive the ALTER TABLE untouched.
            expect(day.activities[0]?.startTime).toBe('08:00');
            expect(day.activities[0]?.durationMinutes).toBe(30);

            const verifyDatabase = new Database(databasePath, { readonly: true });
            try {
                const versionRow = verifyDatabase.prepare('PRAGMA user_version;').get() as { user_version: number };
                expect(versionRow.user_version).toBe(3);
                const row = verifyDatabase.prepare(
                    'SELECT start_notified_at, end_notified_at FROM tdah_activity WHERE day_plan_date = ?;',
                ).get(today) as { start_notified_at: string | null; end_notified_at: string | null };
                expect(row.start_notified_at).toBeNull();
                expect(row.end_notified_at).toBeNull();
            } finally {
                verifyDatabase.close();
            }
        });
    });

    describe('runActivityTriggerTick (story 2.2: activity-trigger tick)', () => {
        // Builds an exact UTC instant for the REAL current calendar day (so it
        // lands on the same `tdah_day_plan.date` row `createManualActivityApi`
        // plants via its own unmocked `new Date()`), with full control over
        // the HH:mm portion for start/end-crossing comparisons.
        const buildTodayInstant = (hhmm: string): Date => (
            new Date(`${formatDateInTimeZone(new Date(), 'UTC')}T${hhmm}:00.000Z`)
        );

        const alwaysConnected = (): boolean => true;
        const neverConnected = (): boolean => false;

        type CollectedFire = { key: string; event: TdahWsActivityTriggerEvent };
        const collectFires = (): {
            fires: CollectedFire[];
            onFire: (key: string, event: TdahWsActivityTriggerEvent) => void;
        } => {
            const fires: CollectedFire[] = [];
            return { fires, onFire: (key, event) => fires.push({ key, event }) };
        };

        type NotifiedRow = {
            id: number;
            title: string;
            start_notified_at: string | null;
            end_notified_at: string | null;
        };

        const readNotifiedRows = async (databasePath: string, date: string): Promise<NotifiedRow[]> => {
            const { Database } = await import('bun:sqlite');
            const database = new Database(databasePath, { readonly: true });
            try {
                return (database.prepare(
                    'SELECT id, title, start_notified_at, end_notified_at FROM tdah_activity WHERE day_plan_date = ? ORDER BY id;',
                ) as unknown as { all(...params: unknown[]): NotifiedRow[] }).all(date);
            } finally {
                database.close();
            }
        };

        test('an Actividad whose startTime already arrived fires exactly one "start" event with a self-sufficient payload, and persists the mark', async () => {
            await activate({ timeZone: 'UTC' });
            const created = await readActivity(
                await createManualActivityApi({ title: 'Foco', startTime: '11:55', durationMinutes: 25 }),
            );
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const now = buildTodayInstant('12:00');

            const { fires, onFire } = collectFires();
            const summary = await runActivityTriggerTick(dataDir, now, alwaysConnected, onFire);

            expect(summary.namespaceCount).toBe(1);
            expect(summary.firedNamespaceCount).toBe(1);
            expect(summary.firedEventCount).toBe(1);
            expect(summary.skippedCount).toBe(0);
            expect(summary.failedCount).toBe(0);
            expect(fires).toHaveLength(1);
            expect(fires[0]?.key).toBe(key);
            expect(fires[0]?.event.kind).toBe('activity-trigger');
            expect(fires[0]?.event.edge).toBe('start');
            expect(fires[0]?.event.activityId).toBe(created.id);
            expect(fires[0]?.event.title).toBe('Foco');
            expect(fires[0]?.event.durationMinutes).toBe(25);
            expect(fires[0]?.event.startTime).toBe('11:55');
            expect(typeof fires[0]?.event.at).toBe('string');
            expect(Number.isNaN(Date.parse(fires[0]?.event.at ?? ''))).toBe(false);

            const rows = await readNotifiedRows(databasePath, created.dayPlanDate);
            expect(rows).toHaveLength(1);
            expect(rows[0]?.start_notified_at).not.toBeNull();
            expect(rows[0]?.end_notified_at).toBeNull();
        });

        test('an Actividad whose startTime + durationMinutes already arrived fires an "end" event once its start mark is already set', async () => {
            await activate({ timeZone: 'UTC' });
            const created = await readActivity(
                await createManualActivityApi({ title: 'Reunión', startTime: '09:00', durationMinutes: 30 }),
            );
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);

            // First tick: only the start milestone (09:00) has crossed —
            // 09:15 is still before the 09:30 end.
            const startOnly = collectFires();
            const firstSummary = await runActivityTriggerTick(dataDir, buildTodayInstant('09:15'), alwaysConnected, startOnly.onFire);
            expect(firstSummary.firedEventCount).toBe(1);
            expect(startOnly.fires[0]?.event.edge).toBe('start');

            // Second tick, later: the end milestone (09:30) has now also
            // crossed — only "end" fires, since "start" is already marked.
            const endOnly = collectFires();
            const secondSummary = await runActivityTriggerTick(dataDir, buildTodayInstant('09:31'), alwaysConnected, endOnly.onFire);
            expect(secondSummary.firedEventCount).toBe(1);
            expect(endOnly.fires).toHaveLength(1);
            expect(endOnly.fires[0]?.event.edge).toBe('end');
            expect(endOnly.fires[0]?.event.activityId).toBe(created.id);
            expect(endOnly.fires[0]?.event.durationMinutes).toBe(30);

            const rows = await readNotifiedRows(databasePath, created.dayPlanDate);
            expect(rows[0]?.start_notified_at).not.toBeNull();
            expect(rows[0]?.end_notified_at).not.toBeNull();
        });

        // Matrix: "Reinicio del servidor entre el startTime y el disparo" — a
        // milestone that arrives while no tick ever ran (simulating downtime)
        // is still detected and fires exactly once on the next tick, since
        // the mark lives entirely in the persisted database, never in any
        // process-local memory.
        test('a milestone that arrived while the tick never ran (simulated server downtime) still fires exactly once on the next tick', async () => {
            await activate({ timeZone: 'UTC' });
            const created = await readActivity(
                await createManualActivityApi({ title: 'Ducha', startTime: '07:00', durationMinutes: 15 }),
            );
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);

            // No tick ran anywhere near 07:00 or 07:15 — the very first tick
            // to ever run against this namespace happens well after both
            // milestones already crossed.
            const { fires, onFire } = collectFires();
            const summary = await runActivityTriggerTick(dataDir, buildTodayInstant('08:00'), alwaysConnected, onFire);
            expect(summary.firedEventCount).toBe(2);
            expect(fires.map((fire) => fire.event.edge)).toEqual(['start', 'end']);
            expect(fires.every((fire) => fire.event.activityId === created.id)).toBe(true);

            // A fresh call to the pure tick function — exactly what a
            // restarted process's very first tick looks like, since it
            // carries zero in-memory state from before — never re-fires.
            const retry = collectFires();
            const retrySummary = await runActivityTriggerTick(dataDir, buildTodayInstant('08:05'), alwaysConnected, retry.onFire);
            expect(retrySummary.firedEventCount).toBe(0);
            expect(retry.fires).toHaveLength(0);

            const rows = await readNotifiedRows(databasePath, created.dayPlanDate);
            expect(rows[0]?.start_notified_at).not.toBeNull();
            expect(rows[0]?.end_notified_at).not.toBeNull();
        });

        test('re-running the tick for the same crossed milestone is a no-op (idempotent, no duplicate event)', async () => {
            await activate({ timeZone: 'UTC' });
            await createManualActivityApi({ title: 'Lectura', startTime: '10:00', durationMinutes: 20 });
            const now = buildTodayInstant('10:05');

            const first = collectFires();
            const firstSummary = await runActivityTriggerTick(dataDir, now, alwaysConnected, first.onFire);
            expect(firstSummary.firedEventCount).toBe(1);

            const second = collectFires();
            const secondSummary = await runActivityTriggerTick(dataDir, now, alwaysConnected, second.onFire);
            expect(secondSummary.firedEventCount).toBe(0);
            expect(secondSummary.skippedCount).toBe(1);
            expect(second.fires).toHaveLength(0);
        });

        test('an Actividad with a null startTime (manual, "sin hora") never fires any event', async () => {
            await activate({ timeZone: 'UTC' });
            await createManualActivityApi({ title: 'Algún día' });

            const { fires, onFire } = collectFires();
            const summary = await runActivityTriggerTick(dataDir, buildTodayInstant('23:59'), alwaysConnected, onFire);
            expect(summary.firedEventCount).toBe(0);
            expect(summary.skippedCount).toBe(1);
            expect(fires).toHaveLength(0);
        });

        // Matrix: "Sin conexión WS al momento del disparo" — no live socket
        // to push to means nothing is marked notified either, so the very
        // next tick (once a connection exists) still detects and fires it.
        test('with no open WS connection, the tick fires nothing and marks nothing notified; once reconnected, the next tick fires normally', async () => {
            await activate({ timeZone: 'UTC' });
            const created = await readActivity(
                await createManualActivityApi({ title: 'Estiramientos', startTime: '06:00', durationMinutes: 10 }),
            );
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const now = buildTodayInstant('06:30');

            const disconnected = collectFires();
            const disconnectedSummary = await runActivityTriggerTick(dataDir, now, neverConnected, disconnected.onFire);
            expect(disconnectedSummary.firedEventCount).toBe(0);
            expect(disconnectedSummary.skippedCount).toBe(1);
            expect(disconnected.fires).toHaveLength(0);

            const rowsWhileDisconnected = await readNotifiedRows(databasePath, created.dayPlanDate);
            expect(rowsWhileDisconnected[0]?.start_notified_at).toBeNull();
            expect(rowsWhileDisconnected[0]?.end_notified_at).toBeNull();

            const reconnected = collectFires();
            const reconnectedSummary = await runActivityTriggerTick(dataDir, now, alwaysConnected, reconnected.onFire);
            expect(reconnectedSummary.firedEventCount).toBe(2);
            expect(reconnected.fires.map((fire) => fire.event.edge)).toEqual(['start', 'end']);
        });

        test('a deactivated (mode: off) profile is skipped without ever reading its Actividades', async () => {
            await activate({ timeZone: 'UTC' });
            await createManualActivityApi({ title: 'Fantasma', startTime: '05:00', durationMinutes: 5 });
            await putProfile({ mode: 'off' });

            const { fires, onFire } = collectFires();
            const summary = await runActivityTriggerTick(dataDir, buildTodayInstant('23:00'), alwaysConnected, onFire);
            expect(summary.namespaceCount).toBe(1);
            expect(summary.skippedCount).toBe(1);
            expect(summary.firedEventCount).toBe(0);
            expect(fires).toHaveLength(0);
        });

        test('an Actividad with a startTime but no durationMinutes can fire "start" but never "end"', async () => {
            await activate({ timeZone: 'UTC' });
            const created = await readActivity(
                await createManualActivityApi({ title: 'Sin duración', startTime: '13:00' }),
            );
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);

            const { fires, onFire } = collectFires();
            const summary = await runActivityTriggerTick(dataDir, buildTodayInstant('23:00'), alwaysConnected, onFire);
            expect(summary.firedEventCount).toBe(1);
            expect(fires[0]?.event.edge).toBe('start');
            expect(fires[0]?.event.durationMinutes).toBeNull();

            const rows = await readNotifiedRows(databasePath, created.dayPlanDate);
            expect(rows[0]?.start_notified_at).not.toBeNull();
            expect(rows[0]?.end_notified_at).toBeNull();
        });

        // Review fix (HIGH): plain minutes-of-day arithmetic (0-1439) can
        // never represent "tomorrow", so an end milestone landing after
        // midnight could never satisfy a same-day comparison at all.
        test('an Actividad whose end milestone crosses midnight (23:50 + 30min) fires correctly once the next day arrives', async () => {
            await activate({ timeZone: 'UTC' });
            const created = await readActivity(
                await createManualActivityApi({ title: 'Trasnochada', startTime: '23:50', durationMinutes: 30 }),
            );
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);

            // First tick, same day at 23:55: the start milestone (23:50) has
            // crossed; the end milestone (00:20 the NEXT day) has not.
            const startOnly = collectFires();
            const firstSummary = await runActivityTriggerTick(dataDir, buildTodayInstant('23:55'), alwaysConnected, startOnly.onFire);
            expect(firstSummary.firedEventCount).toBe(1);
            expect(startOnly.fires).toHaveLength(1);
            expect(startOnly.fires[0]?.event.edge).toBe('start');

            // Second tick, the NEXT calendar day at 00:25: the end milestone
            // (00:20) has now crossed too, even though this Actividad's own
            // `day_plan_date` is "yesterday" relative to this tick's "today".
            const nextDayAt0025 = new Date(buildTodayInstant('00:25').getTime() + 24 * 60 * 60 * 1000);
            const endOnly = collectFires();
            const secondSummary = await runActivityTriggerTick(dataDir, nextDayAt0025, alwaysConnected, endOnly.onFire);
            expect(secondSummary.firedEventCount).toBe(1);
            expect(endOnly.fires).toHaveLength(1);
            expect(endOnly.fires[0]?.event.edge).toBe('end');
            expect(endOnly.fires[0]?.event.activityId).toBe(created.id);

            const rows = await readNotifiedRows(databasePath, created.dayPlanDate);
            expect(rows[0]?.start_notified_at).not.toBeNull();
            expect(rows[0]?.end_notified_at).not.toBeNull();
        });

        // Review fix (HIGH): the candidate query used to be bound to
        // `day_plan_date = today` exactly, so a milestone still pending when
        // the calendar day rolled over (the tick never got a chance to run
        // on the Actividad's own day at all — simulated server downtime
        // spanning midnight) silently dropped out of every future query.
        test('a milestone still pending when the calendar day rolls over (server down across midnight) still fires after the rollover', async () => {
            await activate({ timeZone: 'UTC' });
            const created = await readActivity(
                await createManualActivityApi({ title: 'Madrugada', startTime: '01:00', durationMinutes: 10 }),
            );
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);

            // No tick ever ran on this Actividad's own day — the very first
            // tick against this namespace happens the NEXT calendar day.
            const nextDayAt1000 = new Date(buildTodayInstant('10:00').getTime() + 24 * 60 * 60 * 1000);
            const { fires, onFire } = collectFires();
            const summary = await runActivityTriggerTick(dataDir, nextDayAt1000, alwaysConnected, onFire);
            expect(summary.firedEventCount).toBe(2);
            expect(fires.map((fire) => fire.event.edge)).toEqual(['start', 'end']);
            expect(fires.every((fire) => fire.event.activityId === created.id)).toBe(true);

            const rows = await readNotifiedRows(databasePath, created.dayPlanDate);
            expect(rows[0]?.start_notified_at).not.toBeNull();
            expect(rows[0]?.end_notified_at).not.toBeNull();
        });

        // Review fix (HIGH): the candidate query's backward sweep was
        // unbounded (`day_plan_date <= ?` with no lower bound), so the first
        // tick after a reconnect — or after the v2->v3 migration added the
        // notified columns — re-evaluated every stale never-notified
        // Actividad from the namespace's ENTIRE history at once: a
        // notification storm. The sweep is now bounded to the tick's own day
        // plus exactly one earlier day, which still covers the
        // midnight-rollover catch-up case pinned by the test above (and the
        // server-down-across-midnight matrix in scheduler-era tests).
        test('an Actividad from 3 days ago (outside the one-day sweep window) never fires — no stale-notification storm', async () => {
            await activate({ timeZone: 'UTC' });
            const created = await readActivity(
                await createManualActivityApi({ title: 'Añeja', startTime: '00:00', durationMinutes: 1 }),
            );
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);
            const threeDaysAgo = formatDateInTimeZone(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), 'UTC');

            // Push the due Actividad's day 3 days back with a raw write —
            // exactly the stale row a bounded sweep must stop finding. (The
            // tdah schema's FK on day_plan_date is not enforced: SQLite
            // defaults PRAGMA foreign_keys to off and this module never
            // turns it on.)
            const { Database } = await import('bun:sqlite');
            const database = new Database(databasePath);
            try {
                database
                    .prepare('UPDATE tdah_activity SET day_plan_date = ? WHERE id = ?;')
                    .run(threeDaysAgo, created.id);
            } finally {
                database.close();
            }

            // The real clock, exactly like the interval's own wiring — the
            // row sits 3 days back, outside the [today-1, today] window.
            const { fires, onFire } = collectFires();
            const summary = await runActivityTriggerTick(dataDir, new Date(), alwaysConnected, onFire);
            expect(summary.firedEventCount).toBe(0);
            expect(fires).toHaveLength(0);

            const rows = await readNotifiedRows(databasePath, threeDaysAgo);
            expect(rows).toHaveLength(1);
            expect(rows[0]?.start_notified_at).toBeNull();
            expect(rows[0]?.end_notified_at).toBeNull();
        });
        // wiring synchronously ws.send()s inside it) — one namespace's push
        // failing (e.g. an already-closing socket) must never abort the
        // remaining namespaces still left in the same tick's loop.
        test('one namespace\'s onFire throwing does not abort the remaining namespaces in the same tick call', async () => {
            const keyAlpha = tokenToKey(TOKEN_ALPHA);
            const keyBeta = tokenToKey(TOKEN_BETA);

            await activate({ timeZone: 'UTC' }, TOKEN_ALPHA);
            await activate({ timeZone: 'UTC' }, TOKEN_BETA);
            await createManualActivityApi({ title: 'Alpha', startTime: '09:00', durationMinutes: 5 }, TOKEN_ALPHA);
            await createManualActivityApi({ title: 'Beta', startTime: '09:00', durationMinutes: 5 }, TOKEN_BETA);

            const now = buildTodayInstant('09:10');
            const betaFires: { key: string; event: TdahWsActivityTriggerEvent }[] = [];
            let onFireCalls = 0;
            const summary = await runActivityTriggerTick(dataDir, now, alwaysConnected, (key, event) => {
                onFireCalls += 1;
                if (key === keyAlpha) {
                    throw new Error('boom - simulated closing socket');
                }
                betaFires.push({ key, event });
            });

            // Both namespaces had real work (start + end, since duration 5
            // means 09:05 has also already crossed by 09:10) and both are
            // counted as fired regardless of alpha's onFire throwing — the
            // notified mark is already durably committed before onFire runs.
            expect(summary.firedNamespaceCount).toBe(2);
            expect(summary.firedEventCount).toBe(4);
            expect(onFireCalls).toBe(4);
            expect(betaFires).toHaveLength(2);
            expect(betaFires.every((fire) => fire.key === keyBeta)).toBe(true);
            expect(betaFires.map((fire) => fire.event.edge).sort()).toEqual(['end', 'start']);
        });

        // Review fix (LOW): per-namespace storage-failure isolation for the
        // tick itself — a namespace whose tdah database can't even be opened
        // (here: garbage bytes planted on disk, never activated) must fail
        // alone: every healthy namespace in the same tick still fires, the
        // failure is counted (never thrown — runActivityTriggerTick's own
        // never-throws contract), and the call resolves.
        test('a corrupt namespace database fails alone: healthy namespaces still fire, failedCount counts it, and the tick resolves', async () => {
            const keyAlpha = tokenToKey(TOKEN_ALPHA);
            const keyBeta = tokenToKey(TOKEN_BETA);

            await activate({ timeZone: 'UTC' }, TOKEN_ALPHA);
            await createManualActivityApi({ title: 'Sana', startTime: '07:00', durationMinutes: 10 }, TOKEN_ALPHA);

            // listActiveTdahNamespaces discovers beta purely by the tdah
            // database file EXISTING on disk — no activation ever ran for
            // it, so the garbage bytes below are the first thing any opener
            // sees and the tick's profile read throws.
            mkdirSync(join(dataDir, keyBeta, 'tdah'), { recursive: true });
            writeFileSync(tdahDatabasePath(dataDir, keyBeta), 'not a sqlite database');

            const { fires, onFire } = collectFires();
            const summary = await runActivityTriggerTick(dataDir, buildTodayInstant('07:30'), alwaysConnected, onFire);
            expect(summary.namespaceCount).toBe(2);
            expect(summary.firedNamespaceCount).toBe(1);
            expect(summary.firedEventCount).toBe(2);
            expect(summary.failedCount).toBe(1);
            expect(fires).toHaveLength(2);
            expect(fires.every((fire) => fire.key === keyAlpha)).toBe(true);
        });

        // Review fix (MEDIUM): the candidate query had no `state` filter, so
        // a manually completed/discarded/missed Actividad still fired its
        // originally-planned notification even though the user already
        // resolved it.
        test('a manually completed Actividad never fires its start/end notification', async () => {
            await activate({ timeZone: 'UTC' });
            const created = await readActivity(
                await createManualActivityApi({ title: 'Ya resuelta', startTime: '08:00', durationMinutes: 10 }),
            );
            const completeResponse = await transitionActivityApi(created.id, 'complete');
            expect(completeResponse.status).toBe(200);

            const { fires, onFire } = collectFires();
            const summary = await runActivityTriggerTick(dataDir, buildTodayInstant('23:00'), alwaysConnected, onFire);
            expect(summary.firedEventCount).toBe(0);
            expect(summary.skippedCount).toBe(1);
            expect(fires).toHaveLength(0);
        });

        // Review fix (LOW): `started` is not a terminal state — an Actividad
        // the user explicitly began still deserves its remaining milestone
        // notifications; only completed/discarded/missed are excluded by the
        // candidate query's state filter.
        test('a started Actividad still fires its start/end events once both milestones cross', async () => {
            await activate({ timeZone: 'UTC' });
            const created = await readActivity(
                await createManualActivityApi({ title: 'En curso', startTime: '07:00', durationMinutes: 10 }),
            );
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);

            const startResponse = await transitionActivityApi(created.id, 'start');
            expect(startResponse.status).toBe(200);

            const { fires, onFire } = collectFires();
            const summary = await runActivityTriggerTick(dataDir, buildTodayInstant('07:30'), alwaysConnected, onFire);
            expect(summary.firedEventCount).toBe(2);
            expect(fires.map((fire) => fire.event.edge)).toEqual(['start', 'end']);
            expect(fires.every((fire) => fire.event.activityId === created.id)).toBe(true);

            const rows = await readNotifiedRows(databasePath, created.dayPlanDate);
            expect(rows[0]?.start_notified_at).not.toBeNull();
            expect(rows[0]?.end_notified_at).not.toBeNull();
        });

        // Review fix (LOW): durationMinutes 0 is valid input (the routes
        // validate `>= 0`) but has no end milestone distinct from its start
        // — it used to fire a simultaneous duplicate 'end' event alongside
        // the 'start' one in the same tick.
        test('a zero-durationMinutes Actividad fires exactly one "start" event and never an "end"', async () => {
            await activate({ timeZone: 'UTC' });
            const created = await readActivity(
                await createManualActivityApi({ title: 'Instantáneo', startTime: '09:00', durationMinutes: 0 }),
            );
            const key = tokenToKey(TOKEN_ALPHA);
            const databasePath = tdahDatabasePath(dataDir, key);

            const { fires, onFire } = collectFires();
            const summary = await runActivityTriggerTick(dataDir, buildTodayInstant('23:00'), alwaysConnected, onFire);
            expect(summary.firedEventCount).toBe(1);
            expect(fires).toHaveLength(1);
            expect(fires[0]?.event.edge).toBe('start');
            expect(fires[0]?.event.durationMinutes).toBe(0);

            const rows = await readNotifiedRows(databasePath, created.dayPlanDate);
            expect(rows[0]?.start_notified_at).not.toBeNull();
            expect(rows[0]?.end_notified_at).toBeNull();
        });
    });

    describe('runTdahActivityTriggerIntervalTick (story 2.2: server.ts interval wiring)', () => {
        test('runs one tick and invokes onFire for a crossed milestone, never throwing even if onFire itself throws', async () => {
            await activate({ timeZone: 'UTC' });
            await createManualActivityApi({ title: 'Bloque', startTime: '00:00', durationMinutes: 1 });

            // The real interval always calls this with `new Date()` — with
            // startTime '00:00' the milestone has necessarily already
            // crossed by the time this test runs "today", regardless of the
            // real wall-clock instant, so this exercises the exact function
            // server.ts wires into its own setInterval without needing to
            // fake the clock.
            let onFireCalls = 0;
            await expect(
                runTdahActivityTriggerIntervalTick(
                    dataDir,
                    () => true,
                    () => {
                        onFireCalls += 1;
                        throw new Error('boom - a send failure must never crash the tick');
                    },
                ),
            ).resolves.toBeUndefined();
            expect(onFireCalls).toBeGreaterThan(0);
        });

        test('resolves cleanly with zero namespaces when dataDir has no TDAH database at all (steady-state no-op)', async () => {
            // A dataDir that has never had a TDAH database resolves to an
            // empty namespace list (listActiveTdahNamespaces' own
            // missing-directory handling) rather than throwing — the
            // wrapper's never-throws contract holds trivially here, and no
            // onFire call happens.
            let onFireCalls = 0;
            await expect(
                runTdahActivityTriggerIntervalTick(
                    join(dataDir, 'does-not-exist'),
                    () => true,
                    () => { onFireCalls += 1; },
                ),
            ).resolves.toBeUndefined();
            expect(onFireCalls).toBe(0);
        });
    });

    // Review fix (MEDIUM): the interval's two push closures (hasOpenConnection
    // + onFire) used to live inline in startCloudServer's setInterval, so the
    // real wiring — JSON.stringify, fan-out over connectionsFor, and the
    // readyState guard — was never directly tested. They are extracted as
    // buildTdahActivityTriggerPush; these tests exercise the actual function
    // the interval uses, with fake sockets instead of a real port.
    describe('buildTdahActivityTriggerPush (story 2.2: the interval\'s real WS push wiring)', () => {
        type FakePushSocket = {
            readyState: number;
            sent: string[];
            send: (payload: string) => void;
        };

        const buildFakeSocket = (readyState: number): FakePushSocket => {
            const sent: string[] = [];
            return {
                readyState,
                sent,
                send: (payload: string): void => {
                    sent.push(payload);
                },
            };
        };

        test('onFire JSON.stringifies the event and fans out only to OPEN sockets; hasOpenConnection mirrors the registry count', () => {
            const registry = createTdahWsConnectionRegistry<FakePushSocket>();
            const push = buildTdahActivityTriggerPush(registry);
            expect(push.hasOpenConnection('key-a')).toBe(false);

            const openSocket = buildFakeSocket(1);
            const closingSocket = buildFakeSocket(3);
            registry.register('key-a', openSocket);
            registry.register('key-a', closingSocket);
            expect(push.hasOpenConnection('key-a')).toBe(true);

            const event: TdahWsActivityTriggerEvent = {
                kind: 'activity-trigger',
                edge: 'start',
                activityId: 7,
                title: 'Foco',
                durationMinutes: 25,
                startTime: '11:55',
                at: new Date('2026-08-27T12:00:00.000Z').toISOString(),
            };
            push.onFire('key-a', event);

            // Only the OPEN socket received the payload, exactly once; the
            // CLOSING socket (readyState 3) was skipped explicitly.
            expect(openSocket.sent).toHaveLength(1);
            expect(closingSocket.sent).toHaveLength(0);

            // The payload parses back into the exact wire shape
            // (types.ts's TdahWsActivityTriggerEvent).
            const received = JSON.parse(openSocket.sent[0] ?? '{}') as TdahWsActivityTriggerEvent;
            expect(received).toEqual(event);
            expect(received.kind).toBe('activity-trigger');
            expect(received.edge).toBe('start');
            expect(received.activityId).toBe(7);
            expect(received.title).toBe('Foco');
            expect(received.durationMinutes).toBe(25);
            expect(received.startTime).toBe('11:55');
            expect(received.at).toBe(event.at);

            registry.unregister('key-a', openSocket);
            expect(push.hasOpenConnection('key-a')).toBe(true);
            registry.unregister('key-a', closingSocket);
            expect(push.hasOpenConnection('key-a')).toBe(false);
        });
    });

    describe('weekdayOfDate (timezone-independent)', () => {
        // 2026-01-15 is a Thursday. The old noon-UTC-then-format-in-zone
        // implementation returned Friday for Pacific/Kiritimati (+14) and
        // Pacific/Apia (+13) — noon UTC is already the next calendar day
        // there — and was equally wrong for any UTC+12/13/14 zone in DST
        // (e.g. Pacific/Auckland in summer). The weekday of a calendar date
        // is the same in every zone, which is exactly what these assert.
        test('2026-01-15 is Thursday (4) — the date the old code got wrong for Pacific/Kiritimati (+14), Pacific/Apia (+13) and Pacific/Auckland', () => {
            expect(weekdayOfDate('2026-01-15')).toBe(4);
        });

        // A July date catches the southern-hemisphere winter side (NZST,
        // UTC+12, no DST) — 2026-07-16 is also a Thursday.
        test('a July date (NZ winter, DST off) also resolves by pure calendar math — 2026-07-16 is Thursday', () => {
            expect(weekdayOfDate('2026-07-16')).toBe(4);
        });

        test('matches Date.UTC weekday for every day of a full leap year', () => {
            for (let dayIndex = 0; dayIndex < 366; dayIndex += 1) {
                const utc = new Date(Date.UTC(2028, 0, 1 + dayIndex));
                const iso = `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`;
                expect(weekdayOfDate(iso)).toBe(utc.getUTCDay());
            }
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

describe('resolveTdahWsAuth (story 2.1: WS channel token resolution, no server/socket needed)', () => {
    const ALLOWED = createAllowedAuthTokens(['tdah-token-alpha-1234567890']);
    const wsUrlWithToken = (token: string | null): URL => {
        const url = new URL('ws://127.0.0.1/v1/tdah/ws');
        if (token !== null) url.searchParams.set('token', token);
        return url;
    };

    test('accepts a valid, allowlisted token and returns its namespace key', () => {
        const result = resolveTdahWsAuth(wsUrlWithToken('tdah-token-alpha-1234567890'), ALLOWED);
        expect(result.ok).toBe(true);
        expect(result.ok && typeof result.key).toBe('string');
        expect(result.ok && result.key.length).toBe(64); // sha256 hex digest, same shape as tokenToKey elsewhere
    });

    test('rejects a missing token with TDAH_WS_UNAUTHORIZED', () => {
        const result = resolveTdahWsAuth(wsUrlWithToken(null), ALLOWED);
        expect(result).toEqual({ ok: false, code: 'TDAH_WS_UNAUTHORIZED' });
    });

    test('rejects a malformed token (fails BEARER_TOKEN_PATTERN) with the same code', () => {
        const result = resolveTdahWsAuth(wsUrlWithToken('short'), ALLOWED);
        expect(result).toEqual({ ok: false, code: 'TDAH_WS_UNAUTHORIZED' });
    });

    test('rejects a well-formed but non-allowlisted token with the same code', () => {
        const result = resolveTdahWsAuth(wsUrlWithToken('tdah-token-unknown-0000000'), ALLOWED);
        expect(result).toEqual({ ok: false, code: 'TDAH_WS_UNAUTHORIZED' });
    });

    test('a null allowlist (any-token mode) accepts any well-formed token', () => {
        const result = resolveTdahWsAuth(wsUrlWithToken('tdah-token-anything-000000'), null);
        expect(result.ok).toBe(true);
    });
});

describe('createTdahWsConnectionRegistry (story 2.1: pure per-namespace connection bookkeeping)', () => {
    test('starts empty', () => {
        const registry = createTdahWsConnectionRegistry<string>();
        expect(registry.namespaceCount()).toBe(0);
        expect(registry.connectionCount('key-a')).toBe(0);
        expect(registry.connectionsFor('key-a').size).toBe(0);
    });

    test('register adds a connection under its namespace key, visible via connectionsFor/connectionCount', () => {
        const registry = createTdahWsConnectionRegistry<string>();
        registry.register('key-a', 'conn-1');
        expect(registry.connectionCount('key-a')).toBe(1);
        expect(registry.connectionsFor('key-a')).toEqual(new Set(['conn-1']));
        expect(registry.namespaceCount()).toBe(1);
    });

    test('a namespace can hold more than one simultaneous connection', () => {
        const registry = createTdahWsConnectionRegistry<string>();
        registry.register('key-a', 'conn-1');
        registry.register('key-a', 'conn-2');
        expect(registry.connectionCount('key-a')).toBe(2);
        expect(registry.namespaceCount()).toBe(1);
    });

    test('different namespaces stay isolated from each other', () => {
        const registry = createTdahWsConnectionRegistry<string>();
        registry.register('key-a', 'conn-1');
        registry.register('key-b', 'conn-2');
        expect(registry.connectionCount('key-a')).toBe(1);
        expect(registry.connectionCount('key-b')).toBe(1);
        expect(registry.namespaceCount()).toBe(2);
    });

    test('unregister removes only the given connection and prunes an emptied namespace entirely', () => {
        const registry = createTdahWsConnectionRegistry<string>();
        registry.register('key-a', 'conn-1');
        registry.register('key-a', 'conn-2');
        registry.unregister('key-a', 'conn-1');
        expect(registry.connectionCount('key-a')).toBe(1);
        expect(registry.connectionsFor('key-a')).toEqual(new Set(['conn-2']));

        registry.unregister('key-a', 'conn-2');
        expect(registry.connectionCount('key-a')).toBe(0);
        // The empty Set must not linger as a dangling namespace entry.
        expect(registry.namespaceCount()).toBe(0);
    });

    test('unregistering an unknown connection or namespace is a harmless no-op', () => {
        const registry = createTdahWsConnectionRegistry<string>();
        registry.register('key-a', 'conn-1');
        registry.unregister('key-a', 'conn-does-not-exist');
        registry.unregister('key-does-not-exist', 'conn-1');
        expect(registry.connectionCount('key-a')).toBe(1);
        expect(registry.namespaceCount()).toBe(1);
    });
});

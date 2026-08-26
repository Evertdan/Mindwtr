import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { tokenToKey } from '../server-auth';
import { startCloudServer } from '../server';
import { activateTdahProfile, readTdahProfile, tdahDatabasePath } from './storage';

const TOKEN_ALPHA = 'tdah-token-alpha-1234567890';
const TOKEN_BETA = 'tdah-token-beta-1234567890';

type TdahTestProfile = {
    mode: string;
    timeZone: string;
    ritualHour: string;
    createdAt: string;
    updatedAt: string;
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

    const WORKDAY_ROUTINE = {
        title: 'Día laboral',
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

        test('routine block with duration_minutes<=0 returns 400 TDAH_ROUTINE_INVALID', async () => {
            const response = await activate({
                timeZone: 'UTC',
                routine: {
                    title: 'Día laboral',
                    blocks: [{ title: 'Mañana', startTime: '08:00', durationMinutes: 0 }],
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
                        { title: 'Tarde', startTime: null as any, durationMinutes: 60 },
                    ],
                },
            })).rejects.toBeTruthy();

            const profile = await readTdahProfile(dataDir, key);
            expect(profile).toBeNull();
        });
    });
});

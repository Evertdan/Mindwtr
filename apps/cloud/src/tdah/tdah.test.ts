import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { tokenToKey } from '../server-auth';
import { startCloudServer } from '../server';
import { tdahDatabasePath } from './storage';

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
        const response = await putProfile({ mode: 'on', timeZone: 'America/Mexico_City' });
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
        const response = await putProfile({ mode: 'on' });
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

    test('deactivating keeps the profile row intact (time zone and ritual hour preserved)', async () => {
        await putProfile({ mode: 'on', timeZone: 'Europe/Madrid', ritualHour: '22:30' });
        const response = await putProfile({ mode: 'off' });
        expect(response.status).toBe(200);
        const profile = await readProfile(response);
        expect(profile?.mode).toBe('off');
        expect(profile?.timeZone).toBe('Europe/Madrid');
        expect(profile?.ritualHour).toBe('22:30');
        expect(typeof profile?.createdAt).toBe('string');
    });

    test('reactivating after off does not reset time zone or ritual hour (FR-1)', async () => {
        await putProfile({ mode: 'on', timeZone: 'Europe/Madrid', ritualHour: '22:30' });
        await putProfile({ mode: 'off' });
        const response = await putProfile({ mode: 'on' });
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
        const alphaActivation = await putProfile({ mode: 'on', timeZone: 'America/Mexico_City' }, TOKEN_ALPHA);
        expect(alphaActivation.status).toBe(200);
        const betaActivation = await putProfile({ mode: 'on', timeZone: 'Asia/Tokyo', ritualHour: '21:00' }, TOKEN_BETA);
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
});

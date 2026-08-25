/**
 * Per-namespace SQLite storage for the TDAH profile (ADR 0026).
 *
 * One database per user at `<dataDir>/<key>/tdah/tdah.sqlite` — the same
 * per-namespace isolation `<key>/attachments/` uses, so tokens can never read
 * each other's profiles. Durability diverges deliberately from the repo's
 * temp→fsync→rename pattern (`durablyPublishFile`): a live database with WAL
 * cannot be published by rename, so the durable equivalent is
 * `journal_mode=WAL` + `synchronous=FULL`. SQLite's own file locks
 * (BEGIN IMMEDIATE) serialize concurrent writers cross-process, which is why
 * this module does not take `withCloudFileLock`.
 */
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { ensureDurableDirectory } from '../server-storage';
import type { TdahMode, TdahProfile, TdahProfileUpsertRequest } from './types';

const TDAH_DIR_NAME = 'tdah';
const TDAH_DB_FILE_NAME = 'tdah.sqlite';
export const TDAH_DEFAULT_RITUAL_HOUR = '23:00';
const TDAH_DEFAULT_TIME_ZONE = 'UTC';
const TDAH_WRITE_BUSY_TIMEOUT_MS = 5_000;

export const tdahDatabasePath = (dataDir: string, key: string): string => (
    join(dataDir, key, TDAH_DIR_NAME, TDAH_DB_FILE_NAME)
);

const CREATE_PROFILE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS tdah_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        mode TEXT NOT NULL CHECK (mode IN ('on', 'off')),
        time_zone TEXT NOT NULL,
        ritual_hour TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
`;

const SELECT_PROFILE_SQL = 'SELECT mode, time_zone, ritual_hour, created_at, updated_at FROM tdah_profile WHERE id = 1;';
const UPSERT_PROFILE_SQL = `
    INSERT INTO tdah_profile (id, mode, time_zone, ritual_hour, created_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
        mode = excluded.mode,
        time_zone = excluded.time_zone,
        ritual_hour = excluded.ritual_hour,
        updated_at = excluded.updated_at;
`;

type TdahProfileRow = {
    mode: unknown;
    time_zone: unknown;
    ritual_hour: unknown;
    created_at: unknown;
    updated_at: unknown;
};

const asString = (value: unknown): string | null => (
    typeof value === 'string' ? value : null
);

const rowToProfile = (row: TdahProfileRow | undefined | null): TdahProfile | null => {
    if (!row) return null;
    const mode = row.mode;
    const timeZone = asString(row.time_zone);
    const ritualHour = asString(row.ritual_hour);
    const createdAt = asString(row.created_at);
    const updatedAt = asString(row.updated_at);
    if ((mode !== 'on' && mode !== 'off') || !timeZone || !ritualHour || !createdAt || !updatedAt) {
        return null;
    }
    return { mode, timeZone, ritualHour, createdAt, updatedAt };
};

const openDatabase = async (
    databasePath: string,
    options: { readonly: boolean },
): Promise<InstanceType<typeof import('bun:sqlite').Database>> => {
    const { Database } = await import('bun:sqlite');
    const database = new Database(databasePath, options.readonly ? { readonly: true } : undefined);
    if (!options.readonly) {
        database.exec(`PRAGMA busy_timeout = ${TDAH_WRITE_BUSY_TIMEOUT_MS};`);
        database.exec('PRAGMA journal_mode = WAL;');
        database.exec('PRAGMA synchronous = FULL;');
        database.exec(CREATE_PROFILE_TABLE_SQL);
    }
    return database;
};

const withDatabase = async <T>(
    databasePath: string,
    options: { readonly: boolean },
    run: (database: InstanceType<typeof import('bun:sqlite').Database>) => T,
): Promise<T> => {
    const database = await openDatabase(databasePath, options);
    try {
        return run(database);
    } finally {
        database.close();
    }
};

export async function readTdahProfile(dataDir: string, key: string): Promise<TdahProfile | null> {
    const databasePath = tdahDatabasePath(dataDir, key);
    // A read must never plant the namespace's tdah directory on disk — the
    // same rule resolveAttachmentPath enforces with `create: false`.
    if (!existsSync(databasePath)) return null;
    return await withDatabase(databasePath, { readonly: true }, (database) => (
        rowToProfile(database.prepare(SELECT_PROFILE_SQL).get() as TdahProfileRow | undefined | null)
    ));
}

export async function upsertTdahProfile(
    dataDir: string,
    key: string,
    request: TdahProfileUpsertRequest,
): Promise<TdahProfile> {
    const databasePath = tdahDatabasePath(dataDir, key);
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    return await withDatabase(databasePath, { readonly: false }, (database) => {
        const nowIso = new Date().toISOString();
        database.exec('BEGIN IMMEDIATE;');
        try {
            const existing = rowToProfile(
                database.prepare(SELECT_PROFILE_SQL).get() as TdahProfileRow | undefined | null,
            );
            const nextMode: TdahMode = request.mode ?? existing?.mode ?? 'off';
            const nextTimeZone = request.timeZone ?? existing?.timeZone ?? TDAH_DEFAULT_TIME_ZONE;
            const nextRitualHour = request.ritualHour ?? existing?.ritualHour ?? TDAH_DEFAULT_RITUAL_HOUR;
            const createdAt = existing?.createdAt ?? nowIso;
            database
                .prepare(UPSERT_PROFILE_SQL)
                .run(nextMode, nextTimeZone, nextRitualHour, createdAt, nowIso);
            database.exec('COMMIT;');
            const saved = rowToProfile(
                database.prepare(SELECT_PROFILE_SQL).get() as TdahProfileRow | undefined | null,
            );
            if (!saved) {
                throw new Error('TDAH profile readback failed after upsert');
            }
            return saved;
        } catch (error) {
            database.exec('ROLLBACK;');
            throw error;
        }
    });
}

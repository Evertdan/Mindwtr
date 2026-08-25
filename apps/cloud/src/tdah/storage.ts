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
 *
 * It does borrow that lock's waiting strategy, though. `bun:sqlite`'s
 * exec/run/get are synchronous native calls on Bun's single JS thread, so a
 * non-zero `busy_timeout` parks the entire event loop — and every unrelated
 * cloud request with it — until the lock frees. Writers therefore poll with a
 * zero busy timeout and yield between attempts, exactly as `withCloudFileLock`
 * does.
 */
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { ensureDurableDirectory } from '../server-storage';
import type { TdahMode, TdahProfile, TdahProfileUpsertRequest } from './types';

const TDAH_DIR_NAME = 'tdah';
const TDAH_DB_FILE_NAME = 'tdah.sqlite';
export const TDAH_DEFAULT_RITUAL_HOUR = '23:00';
const TDAH_DEFAULT_TIME_ZONE = 'UTC';
// The same busy/locked predicate `withCloudFileLock` matches on in
// server-storage.ts. Kept local rather than imported so this module stays
// purely additive to the existing cloud server, per ADR 0026.
const isSqliteBusyError = (error: unknown): boolean => {
    const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
    const message = error instanceof Error ? error.message : String(error);
    return code === 'SQLITE_BUSY'
        || code === 'SQLITE_LOCKED'
        || /database is (?:busy|locked)/i.test(message);
};

const TDAH_WRITE_LOCK_WAIT_TIMEOUT_MS = 5_000;
const TDAH_WRITE_LOCK_MAX_BACKOFF_MS = 1_000;

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

type TdahDatabase = InstanceType<typeof import('bun:sqlite').Database>;

const withReadDatabase = async <T>(
    databasePath: string,
    run: (database: TdahDatabase) => T,
): Promise<T> => {
    const { Database } = await import('bun:sqlite');
    const database = new Database(databasePath, { readonly: true });
    try {
        return run(database);
    } finally {
        database.close();
    }
};

const waitForWriteLockRetry = (delayMs: number): Promise<void> => (
    new Promise((resolve) => {
        setTimeout(resolve, delayMs);
    })
);

/**
 * Run `mutate` inside a held BEGIN IMMEDIATE transaction, committing on return
 * and rolling back on throw.
 *
 * Schema init and the transaction are acquired together under a zero
 * `busy_timeout`: every one of those statements can hit SQLITE_BUSY when
 * another writer holds the file, and blocking on any of them would stall Bun's
 * only JS thread. A contended attempt closes its handle, awaits a backoff that
 * yields to the event loop, and retries until the wait budget is spent.
 */
const withWriteTransaction = async <T>(
    databasePath: string,
    mutate: (database: TdahDatabase) => T,
): Promise<T> => {
    const { Database } = await import('bun:sqlite');
    const startedAt = Date.now();
    let attempt = 0;
    let database: TdahDatabase | null = null;

    while (database === null) {
        const candidate = new Database(databasePath);
        try {
            candidate.exec('PRAGMA busy_timeout = 0;');
            candidate.exec('PRAGMA journal_mode = WAL;');
            candidate.exec('PRAGMA synchronous = FULL;');
            candidate.exec(CREATE_PROFILE_TABLE_SQL);
            candidate.exec('BEGIN IMMEDIATE;');
            database = candidate;
        } catch (error) {
            candidate.close();
            if (!isSqliteBusyError(error)) throw error;
            if (Date.now() - startedAt > TDAH_WRITE_LOCK_WAIT_TIMEOUT_MS) {
                throw new Error('Timed out waiting for the TDAH profile write lock');
            }
            attempt += 1;
            await waitForWriteLockRetry(Math.min(TDAH_WRITE_LOCK_MAX_BACKOFF_MS, 25 * attempt));
        }
    }

    try {
        const result = mutate(database);
        database.exec('COMMIT;');
        return result;
    } catch (error) {
        try {
            database.exec('ROLLBACK;');
        } catch {
            // Closing the handle below releases the lock either way.
        }
        throw error;
    } finally {
        database.close();
    }
};

export async function readTdahProfile(dataDir: string, key: string): Promise<TdahProfile | null> {
    const databasePath = tdahDatabasePath(dataDir, key);
    // A read must never plant the namespace's tdah directory on disk — the
    // same rule resolveAttachmentPath enforces with `create: false`.
    if (!existsSync(databasePath)) return null;
    return await withReadDatabase(databasePath, (database) => (
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
    return await withWriteTransaction(databasePath, (database) => {
        const nowIso = new Date().toISOString();
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
        // Read back inside the transaction: it observes its own write, and the
        // COMMIT the helper issues on return makes it durable.
        const saved = rowToProfile(
            database.prepare(SELECT_PROFILE_SQL).get() as TdahProfileRow | undefined | null,
        );
        if (!saved) {
            throw new Error('TDAH profile readback failed after upsert');
        }
        return saved;
    });
}

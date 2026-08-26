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
import type {
    TdahMode,
    TdahProfile,
    TdahProfileUpsertRequest,
    TdahRoutineBlock,
    TdahRoutineInput,
    TdahRoutinePatternKind,
} from './types';

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

// Story 1.3 — minimal Rutina/DayPlan/Actividad schema, additive to the
// profile table above. Only one Rutina can ever exist in this story (single
// "Día laboral" pattern, no precedence engine — story 1.4); `tdah_day_plan`
// is keyed by date so `generateTomorrowIfMissing` is naturally idempotent via
// its PRIMARY KEY.
const CREATE_ROUTINE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS tdah_routine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        pattern_kind TEXT NOT NULL CHECK (pattern_kind IN ('weekday')),
        created_at TEXT NOT NULL
    );
`;

const CREATE_ROUTINE_BLOCK_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS tdah_routine_block (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        routine_id INTEGER NOT NULL REFERENCES tdah_routine(id),
        title TEXT NOT NULL,
        start_time TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        sort_order INTEGER NOT NULL
    );
`;

const CREATE_DAY_PLAN_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS tdah_day_plan (
        date TEXT PRIMARY KEY,
        generated_at TEXT NOT NULL
    );
`;

const CREATE_ACTIVITY_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS tdah_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day_plan_date TEXT NOT NULL REFERENCES tdah_day_plan(date),
        block_id INTEGER REFERENCES tdah_routine_block(id),
        title TEXT NOT NULL,
        start_time TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        origin TEXT NOT NULL CHECK (origin IN ('routine', 'manual')),
        state TEXT NOT NULL CHECK (state IN ('pending', 'started', 'completed', 'missed', 'limbo', 'discarded')) DEFAULT 'pending'
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

// `bun-sqlite.d.ts`'s ambient `Statement` type only declares `get`/`run` —
// `all` exists on the real bun:sqlite Statement at runtime but isn't in that
// shared declaration. Narrowing locally here (rather than editing the shared
// .d.ts) keeps this file's multi-row reads type-safe without touching a
// declaration other TDAH files rely on too.
type TdahStatementWithAll<Row> = { all(...params: unknown[]): Row[] };
const prepareAll = <Row>(database: TdahDatabase, sql: string): TdahStatementWithAll<Row> => (
    database.prepare(sql) as unknown as TdahStatementWithAll<Row>
);

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
            candidate.exec(CREATE_ROUTINE_TABLE_SQL);
            candidate.exec(CREATE_ROUTINE_BLOCK_TABLE_SQL);
            candidate.exec(CREATE_DAY_PLAN_TABLE_SQL);
            candidate.exec(CREATE_ACTIVITY_TABLE_SQL);
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

/**
 * Upsert mutation body, factored out so `activateTdahProfile` can run it in
 * the same held transaction as the routine/day-plan mutations below instead
 * of opening its own `BEGIN IMMEDIATE`/`COMMIT`.
 */
const mutateUpsertProfile = (database: TdahDatabase, request: TdahProfileUpsertRequest): TdahProfile => {
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
};

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
    return await withWriteTransaction(databasePath, (database) => mutateUpsertProfile(database, request));
}

// --- Rutina / DayPlan / Actividad (story 1.3) ------------------------------

const SELECT_LATEST_ROUTINE_SQL = 'SELECT id, title, pattern_kind, created_at FROM tdah_routine ORDER BY id DESC LIMIT 1;';
const SELECT_ROUTINE_BLOCKS_SQL = 'SELECT id, routine_id, title, start_time, duration_minutes, sort_order FROM tdah_routine_block WHERE routine_id = ? ORDER BY sort_order ASC;';
const INSERT_ROUTINE_SQL = 'INSERT INTO tdah_routine (title, pattern_kind, created_at) VALUES (?, ?, ?);';
const INSERT_ROUTINE_BLOCK_SQL = 'INSERT INTO tdah_routine_block (routine_id, title, start_time, duration_minutes, sort_order) VALUES (?, ?, ?, ?, ?);';
const SELECT_DAY_PLAN_SQL = 'SELECT date, generated_at FROM tdah_day_plan WHERE date = ?;';
const INSERT_DAY_PLAN_SQL = 'INSERT INTO tdah_day_plan (date, generated_at) VALUES (?, ?);';
const COUNT_ACTIVITIES_FOR_DAY_PLAN_SQL = 'SELECT COUNT(*) AS count FROM tdah_activity WHERE day_plan_date = ?;';
const INSERT_ACTIVITY_FROM_BLOCK_SQL = `
    INSERT INTO tdah_activity (day_plan_date, block_id, title, start_time, duration_minutes, origin, state)
    VALUES (?, ?, ?, ?, ?, 'routine', 'pending');
`;

type TdahRoutineRow = {
    id: unknown;
    title: unknown;
    pattern_kind: unknown;
    created_at: unknown;
};

type TdahRoutineBlockRow = {
    id: unknown;
    routine_id: unknown;
    title: unknown;
    start_time: unknown;
    duration_minutes: unknown;
    sort_order: unknown;
};

const rowToRoutineBlock = (row: TdahRoutineBlockRow): TdahRoutineBlock => ({
    id: Number(row.id),
    routineId: Number(row.routine_id),
    title: String(row.title),
    startTime: String(row.start_time),
    durationMinutes: Number(row.duration_minutes),
    sortOrder: Number(row.sort_order),
});

/** A persisted Rutina with its Bloques, ordered by `sort_order`. */
type TdahRoutineWithBlocks = {
    id: number;
    title: string;
    patternKind: TdahRoutinePatternKind;
    createdAt: string;
    blocks: TdahRoutineBlock[];
};

const selectLatestRoutineWithBlocks = (database: TdahDatabase): TdahRoutineWithBlocks | null => {
    const routineRow = database.prepare(SELECT_LATEST_ROUTINE_SQL).get() as TdahRoutineRow | undefined | null;
    if (!routineRow) return null;
    const id = Number(routineRow.id);
    const blockRows = prepareAll<TdahRoutineBlockRow>(database, SELECT_ROUTINE_BLOCKS_SQL).all(id);
    return {
        id,
        title: String(routineRow.title),
        patternKind: routineRow.pattern_kind as TdahRoutinePatternKind,
        createdAt: String(routineRow.created_at),
        blocks: blockRows.map(rowToRoutineBlock),
    };
};

export type CreateRoutineResult = {
    routine: TdahRoutineWithBlocks;
    /** false when a Rutina already existed and the input was ignored (idempotent retry). */
    created: boolean;
};

/**
 * Routine-creation mutation body, factored out for the same reason as
 * `mutateUpsertProfile` above — reused inside `activateTdahProfile`'s single
 * shared transaction.
 */
const mutateCreateRoutineWithBlocks = (database: TdahDatabase, input: TdahRoutineInput): CreateRoutineResult => {
    const existing = selectLatestRoutineWithBlocks(database);
    if (existing) {
        return { routine: existing, created: false };
    }
    const nowIso = new Date().toISOString();
    const insertedRoutine = database.prepare(INSERT_ROUTINE_SQL).run(input.title, 'weekday', nowIso);
    const routineId = Number(insertedRoutine.lastInsertRowid);
    input.blocks.forEach((block, index) => {
        database
            .prepare(INSERT_ROUTINE_BLOCK_SQL)
            .run(routineId, block.title, block.startTime, block.durationMinutes, index);
    });
    const created = selectLatestRoutineWithBlocks(database);
    if (!created) {
        throw new Error('TDAH routine readback failed after insert');
    }
    return { routine: created, created: true };
};

/**
 * Creates the single Rutina this story supports, with its Bloques, unless
 * one already exists — retries of `POST /activate` with a `routine` in the
 * body must never produce a second Rutina (only one is ever allowed until
 * story 1.4's precedence engine lands).
 */
export async function createRoutineWithBlocks(
    dataDir: string,
    key: string,
    input: TdahRoutineInput,
): Promise<CreateRoutineResult> {
    const databasePath = tdahDatabasePath(dataDir, key);
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    return await withWriteTransaction(databasePath, (database) => mutateCreateRoutineWithBlocks(database, input));
}

const formatDateInTimeZone = (date: Date, timeZone: string): string => (
    // en-CA formats as YYYY-MM-DD, matching tdah_day_plan.date's sortable text key.
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
);

/**
 * Tomorrow's calendar date in the profile's time zone, as a `YYYY-MM-DD`
 * string. Deliberately simple calendar-day arithmetic — DST-aware
 * recalculation and the recurring midnight rollover are story 1.5's job.
 */
const computeTomorrowDate = (timeZone: string, now: Date = new Date()): string => {
    const todayParts = formatDateInTimeZone(now, timeZone).split('-').map(Number);
    const [year, month, day] = todayParts as [number, number, number];
    const tomorrowUtc = new Date(Date.UTC(year, month - 1, day + 1));
    return formatDateInTimeZone(tomorrowUtc, 'UTC');
};

export type GenerateTomorrowResult = {
    date: string;
    activityCount: number;
    /** false when tomorrow's DayPlan already existed (idempotent no-op). */
    created: boolean;
};

/**
 * Day-plan-generation mutation body, factored out for the same reason as the
 * two mutate helpers above. Takes the already-computed `date` rather than a
 * profile, since `activateTdahProfile` computes it from the profile it just
 * upserted inside the same transaction.
 */
const mutateGenerateTomorrowIfMissing = (database: TdahDatabase, date: string): GenerateTomorrowResult => {
    const existing = database.prepare(SELECT_DAY_PLAN_SQL).get(date) as { date: unknown } | undefined | null;
    if (existing) {
        const countRow = database.prepare(COUNT_ACTIVITIES_FOR_DAY_PLAN_SQL).get(date) as { count: unknown };
        return { date, activityCount: Number(countRow.count), created: false };
    }
    const nowIso = new Date().toISOString();
    database.prepare(INSERT_DAY_PLAN_SQL).run(date, nowIso);
    const routine = selectLatestRoutineWithBlocks(database);
    const blocks = routine?.blocks ?? [];
    for (const block of blocks) {
        database
            .prepare(INSERT_ACTIVITY_FROM_BLOCK_SQL)
            .run(date, block.id, block.title, block.startTime, block.durationMinutes);
    }
    return { date, activityCount: blocks.length, created: true };
};

/**
 * The only function that generates a DayPlan. Inserts `tdah_day_plan` for
 * tomorrow (in the profile's time zone) plus one Actividad per Bloque of the
 * most recent Rutina, or an empty DayPlan when no Rutina exists yet (FR-3).
 * A no-op when tomorrow's DayPlan already exists — `tdah_day_plan.date` is
 * the PRIMARY KEY, so retries and story 1.5's recurring scheduler can call
 * this safely without ever duplicating a day.
 */
export async function generateTomorrowIfMissing(
    dataDir: string,
    key: string,
    profile: Pick<TdahProfile, 'timeZone'>,
): Promise<GenerateTomorrowResult> {
    const databasePath = tdahDatabasePath(dataDir, key);
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    const date = computeTomorrowDate(profile.timeZone);
    return await withWriteTransaction(databasePath, (database) => mutateGenerateTomorrowIfMissing(database, date));
}

/**
 * POST /v1/tdah/activate's single write path (story 1.3's atomicity fix):
 * runs the profile upsert, the optional routine creation, and tomorrow's
 * day-plan generation inside ONE held `BEGIN IMMEDIATE`/`COMMIT` transaction,
 * instead of three independently-committing calls. If any step throws — most
 * notably a `tdah_routine_block` constraint violation from a malformed
 * routine — `withWriteTransaction`'s existing rollback undoes the profile
 * upsert too, so the mode is never left flipped on without its routine/plan.
 */
export async function activateTdahProfile(
    dataDir: string,
    key: string,
    request: { timeZone?: string; ritualHour?: string; routine?: TdahRoutineInput },
): Promise<{ profile: TdahProfile; routineCreated: boolean; dayPlan: GenerateTomorrowResult }> {
    const databasePath = tdahDatabasePath(dataDir, key);
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    return await withWriteTransaction(databasePath, (database) => {
        const profile = mutateUpsertProfile(database, {
            mode: 'on',
            timeZone: request.timeZone,
            ritualHour: request.ritualHour,
        });
        const routineResult = request.routine
            ? mutateCreateRoutineWithBlocks(database, request.routine)
            : undefined;
        const date = computeTomorrowDate(profile.timeZone);
        const dayPlan = mutateGenerateTomorrowIfMissing(database, date);
        return { profile, routineCreated: routineResult?.created ?? false, dayPlan };
    });
}

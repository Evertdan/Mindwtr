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
import { existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { ensureDurableDirectory } from '../server-storage';
import type {
    TdahActivity,
    TdahActivityOrigin,
    TdahActivityState,
    TdahActivityTransitionAction,
    TdahMode,
    TdahProfile,
    TdahProfileUpsertRequest,
    TdahRoutine,
    TdahRoutineBlock,
    TdahRoutineInput,
    TdahRoutineMidnightWarning,
    TdahRoutineNthWeekdayPattern,
    TdahRoutineOverlapWarning,
    TdahRoutinePattern,
    TdahRoutinePatternKind,
    TdahRoutineWeekdayPattern,
} from './types';

const TDAH_DIR_NAME = 'tdah';
const TDAH_DB_FILE_NAME = 'tdah.sqlite';
export const TDAH_DEFAULT_RITUAL_HOUR = '23:00';
export const TDAH_DEFAULT_TIME_ZONE = 'UTC';
// DW-2: Rutina title and Bloque duration were unbounded before this story.
export const TDAH_ROUTINE_TITLE_MAX_LENGTH = 80;
export const TDAH_BLOCK_DURATION_MAX_MINUTES = 1440;
// `computeRoutineConflicts` and the per-read overlap/midnight recomputation
// are O(n^2) per Rutina, so unbounded creation via POST /v1/tdah/routines is
// a real resource-cost concern this story introduces (story 1.3 only ever
// allowed exactly one Rutina to exist). Generous but bounded, matching the
// other DW-2 caps in this module. Enforced inside the same write transaction
// as the insert (see insertRoutineIfUnderCap below) so a burst of concurrent
// creates can never race past it.
export const TDAH_ROUTINE_MAX_COUNT = 50;
// The only Rutina any pre-1.4 user could have had is the fixed "Día laboral"
// onboarding template, whose blocks always implied Monday-Friday even though
// nothing stored that explicitly. Both the v0->v1 migration backfill and
// `TdahRoutineInput.pattern` being optional (POST /activate's routine body
// never sends one) resolve to this same default.
const TDAH_DEFAULT_ROUTINE_PATTERN: TdahRoutinePattern = { kind: 'weekday', weekdays: [1, 2, 3, 4, 5] };
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

// `ritual_notified_date` (story 3.1) tracks the local calendar date
// (`YYYY-MM-DD`, same text key shape as `tdah_day_plan.date`) the nightly
// ritual invitation (N-03) was already pushed for — a fresh database gets it
// directly from this CREATE TABLE (so a new user starts at schema v4 with no
// migration to run), while a pre-3.1 database needs
// `migrateRitualNotificationColumnIfNeeded` below (a plain
// `ALTER TABLE ... ADD COLUMN`, same shape as
// `migrateActivityNotificationColumnsIfNeeded`'s pair, since it's a genuinely
// new nullable column with no existing constraint to relax). It is never part
// of the public `TdahProfile` shape (types.ts) — purely scheduler-internal
// bookkeeping, read/written only through `readRitualNotifiedDate`/
// `mutateMarkRitualNotified` below.
const CREATE_PROFILE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS tdah_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        mode TEXT NOT NULL CHECK (mode IN ('on', 'off')),
        time_zone TEXT NOT NULL,
        ritual_hour TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ritual_notified_date TEXT
    );
`;

// Story 1.3 — minimal Rutina/DayPlan/Actividad schema, additive to the
// profile table above. `tdah_day_plan` is keyed by date so
// `generateTomorrowIfMissing` is naturally idempotent via its PRIMARY KEY.
//
// Story 1.4 widens `tdah_routine`'s pattern columns (DW-9): a *fresh*
// database gets the widened shape directly from this CREATE TABLE (so a new
// user starts at schema v1 with no migration to run), while a pre-1.4
// database already has a `tdah_routine` table on disk from
// `CREATE TABLE IF NOT EXISTS`'s old narrow CHECK constraint — that
// statement alone is a permanent no-op against it, which is exactly what
// `migrateSchemaIfNeeded` below exists to fix.
const CREATE_ROUTINE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS tdah_routine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        pattern_kind TEXT NOT NULL CHECK (pattern_kind IN ('weekday', 'nthWeekdayOfMonth')),
        pattern_weekdays TEXT,
        pattern_nth_ordinal INTEGER,
        pattern_nth_weekday INTEGER,
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

// Story 1.6 (DW-2 sibling): a fresh database gets `started_at`/`completed_at`
// AND nullable `start_time`/`duration_minutes` directly from this CREATE
// TABLE (so a new user starts at schema v2 with no migration to run), while a
// pre-1.6 database already has a `tdah_activity` table on disk without the
// timestamp columns and with `start_time`/`duration_minutes` still
// `NOT NULL` — `CREATE TABLE IF NOT EXISTS` alone is a permanent no-op
// against it, which is what `migrateActivityTimestampColumnsIfNeeded` below
// exists to fix (v1->v2, a full create-copy-drop-rename rebuild rather than
// `ALTER TABLE ... ADD COLUMN`, since SQLite cannot relax an existing
// `NOT NULL` constraint via `ALTER TABLE`).
//
// `start_time`/`duration_minutes` are nullable so a manual Activity's
// time/duration can be genuinely optional (doc 02's T-01 "sin hora" trailing
// section; epics.md's own AC for this story): a Bloque-instantiated Activity
// always has both, since it copies them straight from its Bloque, but a
// manual Activity created without an explicit time must persist `NULL`
// rather than a defaulted "now"/`0` — see `mutateCreateManualActivity`.
// `start_notified_at`/`end_notified_at` (story 2.2) track whether the
// activity-trigger tick already fired the start/end WS notification for this
// Actividad — a fresh database gets them directly from this CREATE TABLE (so
// a new user starts at schema v3 with no migration to run), while a pre-2.2
// database needs `migrateActivityNotificationColumnsIfNeeded` below (a plain
// `ALTER TABLE ... ADD COLUMN` pair, since both are genuinely new nullable
// columns with no existing constraint to relax).
const CREATE_ACTIVITY_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS tdah_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day_plan_date TEXT NOT NULL REFERENCES tdah_day_plan(date),
        block_id INTEGER REFERENCES tdah_routine_block(id),
        title TEXT NOT NULL,
        start_time TEXT,
        duration_minutes INTEGER,
        origin TEXT NOT NULL CHECK (origin IN ('routine', 'manual')),
        state TEXT NOT NULL CHECK (state IN ('pending', 'started', 'completed', 'missed', 'limbo', 'discarded')) DEFAULT 'pending',
        started_at TEXT,
        completed_at TEXT,
        start_notified_at TEXT,
        end_notified_at TEXT
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

// --- Schema migration (story 1.4 DW-9, extended by story 1.6) --------------
//
// Two sequential version bumps tracked via `PRAGMA user_version`: 0 -> 1
// widens `tdah_routine`'s pattern columns (story 1.4); 1 -> 2 adds
// `tdah_activity.started_at`/`completed_at` and relaxes
// `start_time`/`duration_minutes` to nullable, so a manual Activity's
// time/duration can be genuinely optional (story 1.6). Deliberately not a
// generic migration framework — the module has exactly these two schema
// changes to make, and SQLite already ships version tracking for free. A
// database more than one version behind (a pre-1.4 file opened for the first
// time after 1.6 shipped) runs both steps in sequence within the same
// `migrateSchemaIfNeeded` call.
const SCHEMA_VERSION_ROUTINE_PATTERN_WIDENED = 1;
const SCHEMA_VERSION_ACTIVITY_TIMESTAMPS = 2;
// Story 2.2 — adds `tdah_activity.start_notified_at`/`end_notified_at`.
const SCHEMA_VERSION_ACTIVITY_NOTIFICATIONS = 3;
// Story 3.1 — adds `tdah_profile.ritual_notified_date`.
const SCHEMA_VERSION_RITUAL_NOTIFICATION = 4;
const SCHEMA_TARGET_VERSION = SCHEMA_VERSION_RITUAL_NOTIFICATION;

/**
 * v0 -> v1: a pre-1.4 database's `tdah_routine` still has the old
 * single-literal `CHECK (pattern_kind IN ('weekday'))` and none of the new
 * pattern columns — `CREATE TABLE IF NOT EXISTS` alone can never widen that
 * (DW-9). Detected by column presence rather than trusting `user_version`
 * alone, so a fresh database (which gets the widened `CREATE_ROUTINE_TABLE_SQL`
 * directly) is recognised as already-current and only needs its version
 * stamped, not rebuilt.
 */
const migrateRoutinePatternWideningIfNeeded = (database: TdahDatabase): void => {
    const columns = prepareAll<{ name: unknown }>(database, "PRAGMA table_info('tdah_routine');").all();
    const hasWidenedColumns = columns.some((column) => String(column.name) === 'pattern_weekdays');

    if (!hasWidenedColumns) {
        // The whole DDL sequence runs inside its own explicit transaction so a
        // crash mid-migration — or two concurrent writers both observing
        // needsMigration=true on the same pre-1.4 database — can never leave a
        // stray, half-migrated `tdah_routine_v2` on disk. SQLite's own
        // BEGIN IMMEDIATE here serializes concurrent attempts the same way
        // `withWriteTransaction`'s own BEGIN IMMEDIATE already does for
        // ordinary writes, and it runs inside the same try/catch that call
        // sits in (`withWriteTransaction`'s per-attempt loop), so a SQLITE_BUSY
        // thrown from this BEGIN IMMEDIATE is still retried exactly like any
        // other busy error today. A throw/crash after this BEGIN IMMEDIATE
        // rolls back to the pre-migration state, safe to retry from scratch,
        // instead of leaving a stray `tdah_routine_v2` that would make the
        // next attempt's `CREATE TABLE tdah_routine_v2` (no `IF NOT EXISTS`)
        // throw "table already exists" forever.
        database.exec('BEGIN IMMEDIATE;');
        try {
            // Defense-in-depth for a database that already has a stray
            // tdah_routine_v2 left over from a migration that was interrupted
            // before this atomic-transaction fix shipped.
            database.exec('DROP TABLE IF EXISTS tdah_routine_v2;');
            database.exec(`
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
            // Every pre-1.4 'weekday' row is the fixed "Día laboral" onboarding
            // template, whose blocks always implied Monday-Friday even though
            // nothing stored that explicitly — backfill makes that implicit
            // assumption an explicit, editable fact (matches TDAH_DEFAULT_ROUTINE_PATTERN).
            database.exec(`
                INSERT INTO tdah_routine_v2 (id, title, pattern_kind, pattern_weekdays, pattern_nth_ordinal, pattern_nth_weekday, created_at)
                SELECT id, title, pattern_kind, '1,2,3,4,5', NULL, NULL, created_at FROM tdah_routine;
            `);
            database.exec('DROP TABLE tdah_routine;');
            database.exec('ALTER TABLE tdah_routine_v2 RENAME TO tdah_routine;');
            database.exec(`PRAGMA user_version = ${SCHEMA_VERSION_ROUTINE_PATTERN_WIDENED};`);
            database.exec('COMMIT;');
        } catch (error) {
            try {
                database.exec('ROLLBACK;');
            } catch {
                // Closing the handle in the caller releases the lock either way.
            }
            throw error;
        }
        return;
    }

    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION_ROUTINE_PATTERN_WIDENED};`);
};

/**
 * v1 -> v2 (story 1.6): a pre-1.6 database's `tdah_activity` has neither
 * `started_at` nor `completed_at`, and its `start_time`/`duration_minutes`
 * columns are still `NOT NULL` (inherited from the original
 * Rutina-Bloque-instantiation-only design, before manual Activities existed).
 * Adding the two new nullable timestamp columns alone would be a plain
 * `ALTER TABLE ... ADD COLUMN`, but relaxing `start_time`/`duration_minutes`
 * to nullable (so a manual Activity's time/duration can be genuinely
 * optional, per doc 02's "sin hora" trailing section) is NOT something
 * `ALTER TABLE` can do in SQLite — it cannot drop or relax an existing
 * `NOT NULL`/CHECK constraint on a column. So this step is a full
 * create-copy-drop-rename rebuild, matching the style of the v0->v1 Rutina
 * widening migration above, rather than the narrower `ADD COLUMN` approach a
 * timestamp-only change would have allowed. Every pre-1.6 row already has
 * real (non-null) `start_time`/`duration_minutes` values — the rebuild only
 * widens the column definitions, it never touches existing data — so the
 * copy is a straight `INSERT...SELECT` with `NULL` backfilled for the two new
 * timestamp columns. Still wrapped in its own explicit transaction for the
 * same crash-safety reason as every other migration step in this file: a
 * throw mid-rebuild rolls back to the pre-migration state, safe to retry from
 * scratch, instead of leaving a stray `tdah_activity_v2` that would make the
 * next attempt's `CREATE TABLE tdah_activity_v2` (no `IF NOT EXISTS`) throw
 * "table already exists" forever.
 */
const migrateActivityTimestampColumnsIfNeeded = (database: TdahDatabase): void => {
    const columns = prepareAll<{ name: unknown }>(database, "PRAGMA table_info('tdah_activity');").all();
    const hasTimestampColumns = columns.some((column) => String(column.name) === 'started_at');

    if (!hasTimestampColumns) {
        database.exec('BEGIN IMMEDIATE;');
        try {
            // Defense-in-depth for a database that already has a stray
            // tdah_activity_v2 left over from a migration interrupted before
            // reaching COMMIT.
            database.exec('DROP TABLE IF EXISTS tdah_activity_v2;');
            database.exec(`
                CREATE TABLE tdah_activity_v2 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    day_plan_date TEXT NOT NULL REFERENCES tdah_day_plan(date),
                    block_id INTEGER REFERENCES tdah_routine_block(id),
                    title TEXT NOT NULL,
                    start_time TEXT,
                    duration_minutes INTEGER,
                    origin TEXT NOT NULL CHECK (origin IN ('routine', 'manual')),
                    state TEXT NOT NULL CHECK (state IN ('pending', 'started', 'completed', 'missed', 'limbo', 'discarded')) DEFAULT 'pending',
                    started_at TEXT,
                    completed_at TEXT
                );
            `);
            database.exec(`
                INSERT INTO tdah_activity_v2 (id, day_plan_date, block_id, title, start_time, duration_minutes, origin, state, started_at, completed_at)
                SELECT id, day_plan_date, block_id, title, start_time, duration_minutes, origin, state, NULL, NULL FROM tdah_activity;
            `);
            database.exec('DROP TABLE tdah_activity;');
            database.exec('ALTER TABLE tdah_activity_v2 RENAME TO tdah_activity;');
            database.exec(`PRAGMA user_version = ${SCHEMA_VERSION_ACTIVITY_TIMESTAMPS};`);
            database.exec('COMMIT;');
        } catch (error) {
            try {
                database.exec('ROLLBACK;');
            } catch {
                // Closing the handle in the caller releases the lock either way.
            }
            throw error;
        }
        return;
    }

    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION_ACTIVITY_TIMESTAMPS};`);
};

/**
 * v2 -> v3 (story 2.2): a pre-2.2 database's `tdah_activity` has neither
 * `start_notified_at` nor `end_notified_at` — the persisted "already
 * notified" mark the activity-trigger tick needs to survive a server
 * restart between a milestone (`startTime`/`startTime + durationMinutes`)
 * and its actual disparo without re-firing or losing it. Unlike the two
 * migrations above, both new columns are genuinely optional additions with
 * no existing `NOT NULL`/CHECK constraint to relax, so this is a plain
 * `ALTER TABLE ... ADD COLUMN` pair rather than a create-copy-drop-rename
 * rebuild.
 */
const migrateActivityNotificationColumnsIfNeeded = (database: TdahDatabase): void => {
    const columns = prepareAll<{ name: unknown }>(database, "PRAGMA table_info('tdah_activity');").all();
    const hasNotificationColumns = columns.some((column) => String(column.name) === 'start_notified_at');

    if (!hasNotificationColumns) {
        database.exec('BEGIN IMMEDIATE;');
        try {
            database.exec('ALTER TABLE tdah_activity ADD COLUMN start_notified_at TEXT;');
            database.exec('ALTER TABLE tdah_activity ADD COLUMN end_notified_at TEXT;');
            database.exec(`PRAGMA user_version = ${SCHEMA_VERSION_ACTIVITY_NOTIFICATIONS};`);
            database.exec('COMMIT;');
        } catch (error) {
            try {
                database.exec('ROLLBACK;');
            } catch {
                // Closing the handle in the caller releases the lock either way.
            }
            throw error;
        }
        return;
    }

    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION_ACTIVITY_NOTIFICATIONS};`);
};

/**
 * v3 -> v4 (story 3.1): a pre-3.1 database's `tdah_profile` has no
 * `ritual_notified_date` column — the persisted "already invited today" mark
 * the nightly tick (scheduler.ts) needs so it fires the ritual-invitation WS
 * event at most once per local calendar day, surviving a server restart
 * between the ritual hour and the actual disparo. Like
 * `migrateActivityNotificationColumnsIfNeeded`, this is a genuinely new
 * nullable column with no existing `NOT NULL`/CHECK constraint to relax, so a
 * plain `ALTER TABLE ... ADD COLUMN` suffices — no create-copy-drop-rename
 * rebuild needed.
 */
const migrateRitualNotificationColumnIfNeeded = (database: TdahDatabase): void => {
    const columns = prepareAll<{ name: unknown }>(database, "PRAGMA table_info('tdah_profile');").all();
    const hasRitualNotifiedColumn = columns.some((column) => String(column.name) === 'ritual_notified_date');

    if (!hasRitualNotifiedColumn) {
        database.exec('BEGIN IMMEDIATE;');
        try {
            database.exec('ALTER TABLE tdah_profile ADD COLUMN ritual_notified_date TEXT;');
            database.exec(`PRAGMA user_version = ${SCHEMA_VERSION_RITUAL_NOTIFICATION};`);
            database.exec('COMMIT;');
        } catch (error) {
            try {
                database.exec('ROLLBACK;');
            } catch {
                // Closing the handle in the caller releases the lock either way.
            }
            throw error;
        }
        return;
    }

    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION_RITUAL_NOTIFICATION};`);
};

const migrateSchemaIfNeeded = (database: TdahDatabase): void => {
    const versionRow = database.prepare('PRAGMA user_version;').get() as { user_version: unknown };
    let currentVersion = Number(versionRow.user_version ?? 0);
    if (currentVersion >= SCHEMA_TARGET_VERSION) return;

    if (currentVersion < SCHEMA_VERSION_ROUTINE_PATTERN_WIDENED) {
        migrateRoutinePatternWideningIfNeeded(database);
        currentVersion = SCHEMA_VERSION_ROUTINE_PATTERN_WIDENED;
    }

    if (currentVersion < SCHEMA_VERSION_ACTIVITY_TIMESTAMPS) {
        migrateActivityTimestampColumnsIfNeeded(database);
        currentVersion = SCHEMA_VERSION_ACTIVITY_TIMESTAMPS;
    }

    if (currentVersion < SCHEMA_VERSION_ACTIVITY_NOTIFICATIONS) {
        migrateActivityNotificationColumnsIfNeeded(database);
        currentVersion = SCHEMA_VERSION_ACTIVITY_NOTIFICATIONS;
    }

    if (currentVersion < SCHEMA_VERSION_RITUAL_NOTIFICATION) {
        migrateRitualNotificationColumnIfNeeded(database);
        currentVersion = SCHEMA_VERSION_RITUAL_NOTIFICATION;
    }
};

/** Schema init (`CREATE TABLE IF NOT EXISTS` x5) plus the migration step above, run on every open. */
const ensureSchema = (database: TdahDatabase): void => {
    database.exec(CREATE_PROFILE_TABLE_SQL);
    database.exec(CREATE_ROUTINE_TABLE_SQL);
    database.exec(CREATE_ROUTINE_BLOCK_TABLE_SQL);
    database.exec(CREATE_DAY_PLAN_TABLE_SQL);
    database.exec(CREATE_ACTIVITY_TABLE_SQL);
    migrateSchemaIfNeeded(database);
};

/**
 * Migration DDL requires a non-readonly handle, so a readonly open can't fix
 * a stale pre-1.4 database itself. The common case (already migrated) pays
 * only one throwaway readonly `PRAGMA user_version` check; only a genuinely
 * stale database pays for a short write-mode pass first — reusing
 * `withWriteTransaction`'s own busy-lock retry rather than duplicating it, so
 * "any request touching the module migrates the schema transparently before
 * being served" holds for read-only routes too (list/preview), not just
 * writes.
 *
 * Exported (story 1.5) so `scheduler.ts` can run its own cheap pre-transaction
 * skip check (`hasDayPlan`) without duplicating this open/migrate/close
 * dance.
 */
export const withReadDatabase = async <T>(
    databasePath: string,
    run: (database: TdahDatabase) => T,
): Promise<T> => {
    const { Database } = await import('bun:sqlite');
    const probe = new Database(databasePath, { readonly: true });
    let needsMigration: boolean;
    try {
        const versionRow = probe.prepare('PRAGMA user_version;').get() as { user_version: unknown };
        needsMigration = Number(versionRow.user_version ?? 0) < SCHEMA_TARGET_VERSION;
    } finally {
        probe.close();
    }
    if (needsMigration) {
        await withWriteTransaction(databasePath, () => undefined);
    }
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
 *
 * Exported (story 1.5) so `scheduler.ts` can hold one transaction per
 * namespace across `mutateCloseOutgoingDay` + `mutateGenerateTomorrowIfMissing`
 * together, the same way every mutation in this file already reuses it.
 */
export const withWriteTransaction = async <T>(
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
            ensureSchema(candidate);
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

// --- Rutina / DayPlan / Actividad (story 1.3, widened by story 1.4) --------

const SELECT_ROUTINE_PATTERN_COLUMNS = 'id, title, pattern_kind, pattern_weekdays, pattern_nth_ordinal, pattern_nth_weekday, created_at';
// Deterministic secondary sort (created_at DESC, id DESC) so precedence
// tie-breaking is reproducible everywhere this feeds `pickMostApplicableCandidate`
// — without it, two rows with the same `created_at` (or a driver that doesn't
// otherwise guarantee row order) could resolve a tie differently across calls.
const SELECT_ALL_ROUTINE_PATTERNS_SQL = `SELECT ${SELECT_ROUTINE_PATTERN_COLUMNS} FROM tdah_routine ORDER BY created_at DESC, id DESC;`;
const SELECT_ROUTINE_BY_ID_SQL = `SELECT ${SELECT_ROUTINE_PATTERN_COLUMNS} FROM tdah_routine WHERE id = ?;`;
// Most-specific-first (nthWeekdayOfMonth beats weekday), then most-recently-created first within a tier.
const SELECT_ROUTINES_ORDERED_SQL = `
    SELECT ${SELECT_ROUTINE_PATTERN_COLUMNS} FROM tdah_routine
    ORDER BY CASE pattern_kind WHEN 'nthWeekdayOfMonth' THEN 0 ELSE 1 END ASC, created_at DESC;
`;
const SELECT_FIRST_ROUTINE_ID_SQL = 'SELECT id FROM tdah_routine ORDER BY id ASC LIMIT 1;';
const SELECT_ROUTINE_EXISTS_SQL = 'SELECT id FROM tdah_routine WHERE id = ?;';
const SELECT_ROUTINE_BLOCKS_SQL = 'SELECT id, routine_id, title, start_time, duration_minutes, sort_order FROM tdah_routine_block WHERE routine_id = ? ORDER BY sort_order ASC;';
const INSERT_ROUTINE_SQL = `
    INSERT INTO tdah_routine (title, pattern_kind, pattern_weekdays, pattern_nth_ordinal, pattern_nth_weekday, created_at)
    VALUES (?, ?, ?, ?, ?, ?);
`;
const UPDATE_ROUTINE_SQL = `
    UPDATE tdah_routine
    SET title = ?, pattern_kind = ?, pattern_weekdays = ?, pattern_nth_ordinal = ?, pattern_nth_weekday = ?
    WHERE id = ?;
`;
const DELETE_ROUTINE_SQL = 'DELETE FROM tdah_routine WHERE id = ?;';
const DELETE_ROUTINE_BLOCKS_SQL = 'DELETE FROM tdah_routine_block WHERE routine_id = ?;';
const COUNT_ROUTINES_SQL = 'SELECT COUNT(*) AS count FROM tdah_routine;';
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
    pattern_weekdays: unknown;
    pattern_nth_ordinal: unknown;
    pattern_nth_weekday: unknown;
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

const rowToPattern = (row: TdahRoutineRow): TdahRoutinePattern => {
    if (row.pattern_kind === 'nthWeekdayOfMonth') {
        return {
            kind: 'nthWeekdayOfMonth',
            ordinal: Number(row.pattern_nth_ordinal),
            weekday: Number(row.pattern_nth_weekday),
        };
    }
    const weekdaysText = typeof row.pattern_weekdays === 'string' ? row.pattern_weekdays : '';
    const weekdays = weekdaysText.length > 0 ? weekdaysText.split(',').map(Number) : [];
    return { kind: 'weekday', weekdays };
};

/**
 * `startTime` is already `HH:mm`-validated (RITUAL_HOUR_PATTERN in routes.ts)
 * by the time anything is persisted, so this local copy of routes.ts's own
 * `startTimeToMinutes` is safe to trust on read. Kept local rather than
 * imported to avoid a routes.ts -> storage.ts -> routes.ts import cycle
 * (routes.ts already imports from storage.ts).
 */
const startTimeToMinutes = (startTime: string): number => {
    const [hours, minutes] = startTime.split(':').map(Number);
    return (hours as number) * 60 + (minutes as number);
};

const MINUTES_PER_DAY = 24 * 60;

/**
 * Bloque overlap is a non-blocking warning (UX spec: "aviso no bloqueante —
 * el usuario puede querer solapes deliberados"), computed fresh from the
 * persisted Bloques on every read rather than stored — so it's always
 * accurate even after an update changes the Bloques without touching this
 * function.
 */
const computeOverlapWarnings = (blocks: TdahRoutineBlock[]): TdahRoutineOverlapWarning[] => {
    const warnings: TdahRoutineOverlapWarning[] = [];
    for (let i = 0; i < blocks.length; i += 1) {
        for (let j = i + 1; j < blocks.length; j += 1) {
            const a = blocks[i] as TdahRoutineBlock;
            const b = blocks[j] as TdahRoutineBlock;
            const aStart = startTimeToMinutes(a.startTime);
            const aEnd = aStart + a.durationMinutes;
            const bStart = startTimeToMinutes(b.startTime);
            const bEnd = bStart + b.durationMinutes;
            if (aStart < bEnd && bStart < aEnd) {
                warnings.push({ blockIndexA: i, blockIndexB: j });
            }
        }
    }
    return warnings;
};

/** One warning per Bloque whose `startTime + durationMinutes` runs past 24:00 — non-blocking, same shape as overlap. */
const computeMidnightCrossingWarnings = (blocks: TdahRoutineBlock[]): TdahRoutineMidnightWarning[] => (
    blocks
        .map((block, index) => ({ block, index }))
        .filter(({ block }) => startTimeToMinutes(block.startTime) + block.durationMinutes > MINUTES_PER_DAY)
        .map(({ index }) => ({ blockIndex: index }))
);

const rowToRoutine = (database: TdahDatabase, row: TdahRoutineRow): TdahRoutine => {
    const id = Number(row.id);
    const blockRows = prepareAll<TdahRoutineBlockRow>(database, SELECT_ROUTINE_BLOCKS_SQL).all(id);
    const blocks = blockRows.map(rowToRoutineBlock);
    return {
        id,
        title: String(row.title),
        pattern: rowToPattern(row),
        createdAt: String(row.created_at),
        blocks,
        overlapWarnings: computeOverlapWarnings(blocks),
        crossesMidnightWarnings: computeMidnightCrossingWarnings(blocks),
    };
};

const selectRoutineWithBlocksById = (database: TdahDatabase, id: number): TdahRoutine | null => {
    const row = database.prepare(SELECT_ROUTINE_BY_ID_SQL).get(id) as TdahRoutineRow | undefined | null;
    return row ? rowToRoutine(database, row) : null;
};

/**
 * Sunday=0 … Saturday=6. The weekday of a *calendar* date (a plain Y-M-D
 * string, already resolved to a local day upstream by
 * `formatDateInTimeZone`) is timezone-independent, so this is pure UTC
 * calendar math. The former implementation anchored noon UTC and then
 * formatted in the target zone — wrong for Pacific/Kiritimati (+14) and
 * Pacific/Apia (+13), where noon UTC is already the *next* calendar day
 * (e.g. it returned Friday for the Thursday 2026-01-15), and equally wrong
 * for any UTC+12/13/14 zone while it sits in DST. Exported for direct unit
 * testing only, the same way `formatDateInTimeZone` is.
 */
export const weekdayOfDate = (date: string): number => {
    const parts = date.split('-').map(Number);
    const [year, month, day] = parts as [number, number, number];
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

/** True when `date`'s day-of-month is the `ordinal`-th occurrence of its weekday, or the last one when `ordinal === -1`. */
const isNthWeekdayOccurrence = (date: string, ordinal: number): boolean => {
    const parts = date.split('-').map(Number);
    const [year, month, day] = parts as [number, number, number];
    if (ordinal !== -1) {
        return Math.ceil(day / 7) === ordinal;
    }
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day + 7 > daysInMonth;
};

/** Does `pattern` match calendar `date` (AD-6)? The weekday of a calendar date is timezone-independent (`weekdayOfDate`), so "wall-clock in `timeZone`" is resolved upstream — by whoever computed the Y-M-D string — never here. */
const routineMatchesDate = (pattern: TdahRoutinePattern, date: string): boolean => {
    const weekday = weekdayOfDate(date);
    if (pattern.kind === 'weekday') {
        return pattern.weekdays.includes(weekday);
    }
    return pattern.weekday === weekday && isNthWeekdayOccurrence(date, pattern.ordinal);
};

type TdahRoutinePatternCandidate = { id: number; title: string; pattern: TdahRoutinePattern; createdAt: string };

/** nthWeekdayOfMonth always outranks weekday (AD-5); a same-specificity tie goes to the most-recently-created Rutina. */
const routineSpecificityRank = (kind: TdahRoutinePatternKind): number => (kind === 'nthWeekdayOfMonth' ? 0 : 1);

/**
 * Returns the more-applicable of two candidates per AD-5 precedence:
 * most-specific first (nthWeekdayOfMonth beats weekday), then a deterministic
 * tie-break (most-recently-created wins; a same-`createdAt` tie goes to the
 * higher id) — the same ordering `SELECT_ALL_ROUTINE_PATTERNS_SQL`'s
 * `ORDER BY created_at DESC, id DESC` now guarantees at the query level.
 * Factored out so both `pickMostApplicableCandidate` (single-winner reduce)
 * and `computeRoutineConflicts` (pairwise winner-per-pair) share one
 * tie-break implementation instead of two copies that could drift apart.
 */
const moreApplicableCandidate = (
    a: TdahRoutinePatternCandidate,
    b: TdahRoutinePatternCandidate,
): TdahRoutinePatternCandidate => {
    const rankDiff = routineSpecificityRank(a.pattern.kind) - routineSpecificityRank(b.pattern.kind);
    if (rankDiff !== 0) return rankDiff < 0 ? a : b;
    if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? a : b;
    return a.id > b.id ? a : b;
};

const pickMostApplicableCandidate = (
    candidates: TdahRoutinePatternCandidate[],
): TdahRoutinePatternCandidate | null => (
    candidates.reduce<TdahRoutinePatternCandidate | null>((best, candidate) => (
        best ? moreApplicableCandidate(best, candidate) : candidate
    ), null)
);

const selectAllRoutinePatternCandidates = (database: TdahDatabase): TdahRoutinePatternCandidate[] => (
    prepareAll<TdahRoutineRow>(database, SELECT_ALL_ROUTINE_PATTERNS_SQL)
        .all()
        .map((row) => ({
            id: Number(row.id),
            title: String(row.title),
            pattern: rowToPattern(row),
            createdAt: String(row.created_at),
        }))
);

/**
 * Does at least one calendar date exist where both `a` and `b` could match
 * (`routineMatchesDate`)? Used to decide whether a Rutina pair is worth
 * reporting from `computeRoutineConflicts` — never to compute precedence
 * itself (that stays `moreApplicableCandidate`, evaluated per real date).
 *
 * - weekday vs weekday: any shared weekday number.
 * - nthWeekdayOfMonth vs weekday: the nth pattern's weekday is in the
 *   weekday pattern's set.
 * - nthWeekdayOfMonth vs nthWeekdayOfMonth: same weekday, regardless of
 *   ordinal — "last" can shift to overlap with ordinal 4 or lower in some
 *   months, so treating every same-weekday pair as conflicting accepts a
 *   false positive there rather than risk a false negative.
 */
const patternsCanConflict = (a: TdahRoutinePattern, b: TdahRoutinePattern): boolean => {
    if (a.kind === 'weekday' && b.kind === 'weekday') {
        return a.weekdays.some((day) => b.weekdays.includes(day));
    }
    if (a.kind === 'nthWeekdayOfMonth' && b.kind === 'nthWeekdayOfMonth') {
        return a.weekday === b.weekday;
    }
    const nth = a.kind === 'nthWeekdayOfMonth' ? a : (b as TdahRoutineNthWeekdayPattern);
    const weekly = a.kind === 'weekday' ? a : (b as TdahRoutineWeekdayPattern);
    return weekly.weekdays.includes(nth.weekday);
};

export type TdahRoutineConflictEntry = { withId: number; withTitle: string; wins: boolean };

const selectRoutineConflicts = (database: TdahDatabase): Record<string, TdahRoutineConflictEntry[]> => {
    const candidates = selectAllRoutinePatternCandidates(database);
    const result: Record<string, TdahRoutineConflictEntry[]> = {};
    const add = (id: number, entry: TdahRoutineConflictEntry): void => {
        const key = String(id);
        const list = result[key] ?? [];
        list.push(entry);
        result[key] = list;
    };
    for (let i = 0; i < candidates.length; i += 1) {
        for (let j = i + 1; j < candidates.length; j += 1) {
            const a = candidates[i] as TdahRoutinePatternCandidate;
            const b = candidates[j] as TdahRoutinePatternCandidate;
            if (!patternsCanConflict(a.pattern, b.pattern)) continue;
            const winner = moreApplicableCandidate(a, b);
            add(a.id, { withId: b.id, withTitle: b.title, wins: winner.id === a.id });
            add(b.id, { withId: a.id, withTitle: a.title, wins: winner.id === b.id });
        }
    }
    return result;
};

/**
 * GET /v1/tdah/routines/conflicts — every conflicting Rutina pair, with the
 * server-computed winner (AD-5: "the server computes precedence, the UI only
 * requests and renders it, never recomputes it locally"). Reports EVERY
 * conflicting pair per Rutina, not just the first, and covers
 * `nthWeekdayOfMonth` pairs the desktop client's former local computation
 * skipped entirely.
 */
export async function computeRoutineConflicts(
    dataDir: string,
    key: string,
): Promise<Record<string, TdahRoutineConflictEntry[]>> {
    const databasePath = tdahDatabasePath(dataDir, key);
    if (!existsSync(databasePath)) return {};
    return await withReadDatabase(databasePath, (database) => selectRoutineConflicts(database));
}

/** Evaluates every persisted Rutina against `date` and returns the precedence winner (or `null` — the already-supported empty-day case, unchanged from story 1.3). */
const selectApplicableRoutine = (database: TdahDatabase, date: string): TdahRoutine | null => {
    const matching = selectAllRoutinePatternCandidates(database)
        .filter((candidate) => routineMatchesDate(candidate.pattern, date));
    const winner = pickMostApplicableCandidate(matching);
    return winner ? selectRoutineWithBlocksById(database, winner.id) : null;
};

const patternColumns = (pattern: TdahRoutinePattern): [string, string | null, number | null, number | null] => (
    pattern.kind === 'weekday'
        ? ['weekday', pattern.weekdays.join(','), null, null]
        : ['nthWeekdayOfMonth', null, pattern.ordinal, pattern.weekday]
);

const insertRoutineWithBlocks = (database: TdahDatabase, input: TdahRoutineInput): TdahRoutine => {
    const nowIso = new Date().toISOString();
    const [kind, weekdays, nthOrdinal, nthWeekday] = patternColumns(input.pattern ?? TDAH_DEFAULT_ROUTINE_PATTERN);
    const insertedRoutine = database
        .prepare(INSERT_ROUTINE_SQL)
        .run(input.title, kind, weekdays, nthOrdinal, nthWeekday, nowIso);
    const routineId = Number(insertedRoutine.lastInsertRowid);
    input.blocks.forEach((block, index) => {
        database
            .prepare(INSERT_ROUTINE_BLOCK_SQL)
            .run(routineId, block.title, block.startTime, block.durationMinutes, index);
    });
    const created = selectRoutineWithBlocksById(database, routineId);
    if (!created) {
        throw new Error('TDAH routine readback failed after insert');
    }
    return created;
};

export type CreateRoutineResult = {
    routine: TdahRoutine;
    /** false when a Rutina already existed and the input was ignored (idempotent retry). */
    created: boolean;
};

/**
 * Routine-creation mutation body, factored out for the same reason as
 * `mutateUpsertProfile` above — reused inside `activateTdahProfile`'s single
 * shared transaction. `POST /activate`'s inline Rutina creation is the
 * story-1.3 shortcut and stays a single-Rutina-only entry point even after
 * full CRUD exists (DW-5): it no-ops whenever *any* Rutina already exists,
 * CRUD-created or not, rather than becoming a second way to add Rutinas.
 */
const mutateCreateRoutineWithBlocks = (database: TdahDatabase, input: TdahRoutineInput): CreateRoutineResult => {
    const firstRow = database.prepare(SELECT_FIRST_ROUTINE_ID_SQL).get() as { id: unknown } | undefined | null;
    if (firstRow) {
        const existing = selectRoutineWithBlocksById(database, Number(firstRow.id));
        if (!existing) {
            throw new Error('TDAH routine readback failed for existing-routine check');
        }
        return { routine: existing, created: false };
    }
    return { routine: insertRoutineWithBlocks(database, input), created: true };
};

/**
 * Creates the single Rutina `POST /activate`'s inline shortcut supports,
 * with its Bloques, unless one already exists — retries of `POST /activate`
 * with a `routine` in the body must never produce a second Rutina via this
 * path (DW-5).
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

/** GET /v1/tdah/routines — every Rutina, most-specific-first (`03-modo-tdah-rutinas.md` T-03), each with its full Bloque list. */
export async function listRoutinesWithBlocks(dataDir: string, key: string): Promise<TdahRoutine[]> {
    const databasePath = tdahDatabasePath(dataDir, key);
    // A read must never plant the namespace's tdah directory on disk.
    if (!existsSync(databasePath)) return [];
    return await withReadDatabase(databasePath, (database) => (
        prepareAll<TdahRoutineRow>(database, SELECT_ROUTINES_ORDERED_SQL)
            .all()
            .map((row) => rowToRoutine(database, row))
    ));
}

/** GET /v1/tdah/routines/:id — a single Rutina, or `null` for a 404. */
export async function getRoutineWithBlocks(dataDir: string, key: string, routineId: number): Promise<TdahRoutine | null> {
    const databasePath = tdahDatabasePath(dataDir, key);
    if (!existsSync(databasePath)) return null;
    return await withReadDatabase(databasePath, (database) => selectRoutineWithBlocksById(database, routineId));
}

/**
 * Counts and inserts inside the same held transaction so a burst of
 * concurrent `POST /v1/tdah/routines` calls can never all observe
 * count < TDAH_ROUTINE_MAX_COUNT and collectively overshoot it. `null` means
 * the namespace was already at the cap — the caller (routes.ts) turns that
 * into a 400 TDAH_ROUTINE_INVALID without a second query.
 */
const insertRoutineIfUnderCap = (database: TdahDatabase, input: TdahRoutineInput): TdahRoutine | null => {
    const countRow = database.prepare(COUNT_ROUTINES_SQL).get() as { count: unknown };
    if (Number(countRow.count) >= TDAH_ROUTINE_MAX_COUNT) return null;
    return insertRoutineWithBlocks(database, input);
};

/**
 * POST /v1/tdah/routines — always creates a new Rutina (unlike
 * `createRoutineWithBlocks`'s activate-only shortcut, this never no-ops).
 * `null` when the namespace is already at `TDAH_ROUTINE_MAX_COUNT`.
 */
export async function createRoutine(dataDir: string, key: string, input: TdahRoutineInput): Promise<TdahRoutine | null> {
    const databasePath = tdahDatabasePath(dataDir, key);
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    return await withWriteTransaction(databasePath, (database) => insertRoutineIfUnderCap(database, input));
}

const mutateUpdateRoutine = (database: TdahDatabase, routineId: number, input: TdahRoutineInput): TdahRoutine | null => {
    const existing = database.prepare(SELECT_ROUTINE_EXISTS_SQL).get(routineId) as { id: unknown } | undefined | null;
    if (!existing) return null;
    const [kind, weekdays, nthOrdinal, nthWeekday] = patternColumns(input.pattern ?? TDAH_DEFAULT_ROUTINE_PATTERN);
    database
        .prepare(UPDATE_ROUTINE_SQL)
        .run(input.title, kind, weekdays, nthOrdinal, nthWeekday, routineId);
    // Full replace of the Bloque list (spec: "full replace of pattern + blocks
    // in one transaction") — already-generated tdah_activity rows reference
    // block_id, which is nullable and not FK-enforced, so their historical
    // data survives untouched even though these old block ids no longer exist.
    database.prepare(DELETE_ROUTINE_BLOCKS_SQL).run(routineId);
    input.blocks.forEach((block, index) => {
        database
            .prepare(INSERT_ROUTINE_BLOCK_SQL)
            .run(routineId, block.title, block.startTime, block.durationMinutes, index);
    });
    const updated = selectRoutineWithBlocksById(database, routineId);
    if (!updated) {
        throw new Error('TDAH routine readback failed after update');
    }
    return updated;
};

/** PUT /v1/tdah/routines/:id — full replace of pattern + Bloques; `null` when `:id` doesn't exist (404). */
export async function updateRoutine(
    dataDir: string,
    key: string,
    routineId: number,
    input: TdahRoutineInput,
): Promise<TdahRoutine | null> {
    const databasePath = tdahDatabasePath(dataDir, key);
    if (!existsSync(databasePath)) return null;
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    return await withWriteTransaction(databasePath, (database) => mutateUpdateRoutine(database, routineId, input));
}

const mutateDeleteRoutine = (database: TdahDatabase, routineId: number): boolean => {
    const existing = database.prepare(SELECT_ROUTINE_EXISTS_SQL).get(routineId) as { id: unknown } | undefined | null;
    if (!existing) return false;
    database.prepare(DELETE_ROUTINE_BLOCKS_SQL).run(routineId);
    database.prepare(DELETE_ROUTINE_SQL).run(routineId);
    return true;
};

/** DELETE /v1/tdah/routines/:id — removes the row and its Bloques; already-generated Actividades keep their historical data (block_id is nullable, not FK-enforced). */
export async function deleteRoutine(dataDir: string, key: string, routineId: number): Promise<boolean> {
    const databasePath = tdahDatabasePath(dataDir, key);
    if (!existsSync(databasePath)) return false;
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    return await withWriteTransaction(databasePath, (database) => mutateDeleteRoutine(database, routineId));
}

// Canonical single implementation (P6/P8): routes.ts used to keep its own
// copy of this regex; both accepted nonsensical years like `0000`-`0099`,
// which then hit JS's legacy two-digit-year `Date.UTC` behavior
// (`Date.UTC(99, ...)` silently maps to 1999) inside `weekdayOfDate` /
// `selectApplicabilityPreviewDates`, producing a wrong-century result while
// echoing the original garbage `YYYY-MM` back in the response. The year is
// bounded to a generous, non-time-dependent range (1970-2999) rather than
// hardcoded to "the current year" so this never needs revisiting as time
// passes.
const TDAH_MONTH_PATTERN = /^(19[7-9]\d|2\d{3})-(0[1-9]|1[0-2])$/;
export const isValidMonthString = (value: string): boolean => TDAH_MONTH_PATTERN.test(value);

const selectApplicabilityPreviewDates = (
    database: TdahDatabase,
    routineId: number,
    monthYYYYMM: string,
): string[] | null => {
    if (!isValidMonthString(monthYYYYMM)) return null;
    const routineRow = database.prepare(SELECT_ROUTINE_BY_ID_SQL).get(routineId) as TdahRoutineRow | undefined | null;
    if (!routineRow) return null;
    const targetPattern = rowToPattern(routineRow);
    const candidates = selectAllRoutinePatternCandidates(database);

    const parts = monthYYYYMM.split('-').map(Number);
    const [year, month] = parts as [number, number];
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    const dates: string[] = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
        const date = `${monthYYYYMM}-${String(day).padStart(2, '0')}`;
        if (!routineMatchesDate(targetPattern, date)) continue;
        const matchingOnDate = candidates.filter((candidate) => routineMatchesDate(candidate.pattern, date));
        const winner = pickMostApplicableCandidate(matchingOnDate);
        if (winner?.id === routineId) {
            dates.push(date);
        }
    }
    return dates;
};

/**
 * GET /v1/tdah/routines/:id/preview?month=YYYY-MM — every date in that month
 * where this Rutina currently wins precedence (AD-5: computed server-side,
 * never recomputed by the UI). `null` when `:id` doesn't exist (404) or
 * `monthYYYYMM` isn't a valid `YYYY-MM` string.
 */
export async function computeApplicabilityPreview(
    dataDir: string,
    key: string,
    routineId: number,
    monthYYYYMM: string,
): Promise<string[] | null> {
    const databasePath = tdahDatabasePath(dataDir, key);
    if (!existsSync(databasePath)) return null;
    return await withReadDatabase(databasePath, (database) => (
        selectApplicabilityPreviewDates(database, routineId, monthYYYYMM)
    ));
}

/**
 * Every caller today validates `timeZone` first (or falls back to
 * `TDAH_DEFAULT_TIME_ZONE`), so `Intl.DateTimeFormat` should never actually
 * throw here — but nothing in this function's signature enforces that
 * invariant, and a previously-valid IANA zone can in principle be retired
 * from tzdata. The try/catch is a defensive boundary, not a swallow: it
 * surfaces a specific, controlled error instead of letting a raw `Intl`
 * exception escape uncaught. Exported for direct unit testing only — every
 * production caller still goes through `computeTomorrowDate`.
 */
export const formatDateInTimeZone = (date: Date, timeZone: string): string => {
    try {
        // en-CA formats as YYYY-MM-DD, matching tdah_day_plan.date's sortable text key.
        return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    } catch (error) {
        throw new Error(`TDAH: failed to format date in time zone "${timeZone}"`, { cause: error });
    }
};

/**
 * Tomorrow's calendar date in `timeZone`, as a `YYYY-MM-DD` string. Genuinely
 * DST-safe (story 1.5): today's local Y-M-D components are resolved once via
 * `formatDateInTimeZone`'s `Intl.DateTimeFormat` call, which already accounts
 * for the zone's DST state at `now`; the day component is then incremented
 * through `Date.UTC`, which normalizes month/year rollover (e.g. day 32 of
 * January becomes February 1) correctly regardless of month length or leap
 * years. No further time-zone offset is applied after that initial Intl
 * resolution, so this never repeats the naive-arithmetic bug a fixed
 * `now.getTime() + 24*60*60*1000` offset would have on a DST-transition day
 * (when the local calendar day is 23 or 25 hours long, not 24).
 *
 * Exported (story 1.5) since the nightly scheduler needs both this and "local
 * today" (plain `formatDateInTimeZone(now, timeZone)` — no new helper needed
 * for that half).
 */
export const computeTomorrowDate = (timeZone: string, now: Date = new Date()): string => {
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
 * upserted inside the same transaction. `timeZone` was dropped from the
 * signature along with `selectApplicableRoutine`'s own: the applicable
 * Rutina is matched against the calendar date alone (`weekdayOfDate` is
 * timezone-independent).
 *
 * Exported (story 1.5) so `scheduler.ts` can run it inside the same
 * `withWriteTransaction` as `mutateCloseOutgoingDay`, exactly as this file's
 * own `activateTdahProfile` already does.
 */
export const mutateGenerateTomorrowIfMissing = (database: TdahDatabase, date: string): GenerateTomorrowResult => {
    const existing = database.prepare(SELECT_DAY_PLAN_SQL).get(date) as { date: unknown } | undefined | null;
    if (existing) {
        const countRow = database.prepare(COUNT_ACTIVITIES_FOR_DAY_PLAN_SQL).get(date) as { count: unknown };
        return { date, activityCount: Number(countRow.count), created: false };
    }
    const nowIso = new Date().toISOString();
    database.prepare(INSERT_DAY_PLAN_SQL).run(date, nowIso);
    const routine = selectApplicableRoutine(database, date);
    const blocks = routine?.blocks ?? [];
    for (const block of blocks) {
        database
            .prepare(INSERT_ACTIVITY_FROM_BLOCK_SQL)
            .run(date, block.id, block.title, block.startTime, block.durationMinutes);
    }
    return { date, activityCount: blocks.length, created: true };
};

// --- Nightly scheduler primitives (story 1.5) -------------------------------

const SELECT_DAY_PLAN_EXISTS_SQL = 'SELECT 1 FROM tdah_day_plan WHERE date = ? LIMIT 1;';
// Sweep close: every Actividad still pending/started on the outgoing local
// day OR ANY EARLIER DAY (a whole ritual window missed — e.g. the server was
// down 23:00–00:00 — leaves yesterday's rows pending forever if the close
// only ever targeted exactly "today"). `tdah_activity.day_plan_date` is a
// YYYY-MM-DD text key, so lexical `<=` is chronological.
const CLOSE_OUTGOING_DAY_SQL = `
    UPDATE tdah_activity SET state = 'limbo'
    WHERE day_plan_date <= ? AND state IN ('pending', 'started');
`;
const SELECT_PENDING_OR_STARTED_UP_TO_SQL = `
    SELECT 1 FROM tdah_activity WHERE day_plan_date <= ? AND state IN ('pending', 'started') LIMIT 1;
`;

/**
 * Cheap existence check against `tdah_day_plan`'s own PRIMARY KEY — the
 * scheduler's pre-transaction skip check (`scheduler.ts`): a namespace whose
 * tomorrow-DayPlan already exists is skipped without ever opening a write
 * transaction, since `mutateGenerateTomorrowIfMissing` would itself be a
 * no-op. Takes an already-open `database` handle (typically opened via
 * `withReadDatabase`) rather than a path, so the caller controls whether this
 * check runs standalone or alongside other reads in the same handle.
 */
export const hasDayPlan = (database: TdahDatabase, date: string): boolean => (
    Boolean(database.prepare(SELECT_DAY_PLAN_EXISTS_SQL).get(date))
);

/**
 * The sweep-close half of the scheduler's pre-transaction skip check: true
 * when any Actividad is still `pending`/`started` on the outgoing local day
 * or any earlier day — work only `mutateCloseOutgoingDay` can do, so a
 * namespace with nothing left to close never opens a write transaction. Same
 * already-open-handle contract as `hasDayPlan`.
 */
export const hasPendingOrStartedUpTo = (database: TdahDatabase, date: string): boolean => (
    Boolean(database.prepare(SELECT_PENDING_OR_STARTED_UP_TO_SQL).get(date))
);

export type CloseOutgoingDayResult = { limboCount: number };

/**
 * The limbo transition (AD-5/AD-11): every Actividad still `pending`/`started`
 * for the outgoing local day — or any STALE EARLIER day whose ritual window
 * was missed entirely — becomes `limbo`. Only `scheduler.ts` calls this
 * — no route may bulk-set `limbo` (ADR 0026 addendum, story 1.5). Separately
 * idempotent from `mutateGenerateTomorrowIfMissing`: re-running it against a
 * date whose Actividades are already `limbo` (or `completed`/`missed`/
 * `discarded`) matches zero rows and changes nothing.
 */
export const mutateCloseOutgoingDay = (database: TdahDatabase, date: string): CloseOutgoingDayResult => {
    const result = database.prepare(CLOSE_OUTGOING_DAY_SQL).run(date);
    return { limboCount: Number(result.changes) };
};

// --- Ritual invitation primitives (story 3.1) -------------------------------

const SELECT_RITUAL_NOTIFIED_DATE_SQL = 'SELECT ritual_notified_date FROM tdah_profile WHERE id = 1;';
const UPDATE_RITUAL_NOTIFIED_DATE_SQL = 'UPDATE tdah_profile SET ritual_notified_date = ? WHERE id = 1;';

type TdahRitualNotifiedDateRow = { ritual_notified_date: unknown };

/**
 * The namespace's last-marked "ritual invitation already pushed" local date
 * (`YYYY-MM-DD`), or `null` when the profile row doesn't exist yet or no mark
 * has ever been written. `scheduler.ts`'s `runNamespaceTick` compares this
 * against `today` (`formatDateInTimeZone`, never UTC/device time — AD-6) to
 * decide whether a fresh `ritual-invitation` WS event is due this tick; this
 * function itself never computes "today" or decides anything, it only reads
 * the persisted mark. Same already-open-handle contract as `hasDayPlan`/
 * `hasPendingOrStartedUpTo`: the caller controls whether this read happens
 * standalone (the pre-transaction check) or inside the held write transaction
 * (the re-check right before marking).
 */
export const readRitualNotifiedDate = (database: TdahDatabase): string | null => {
    const row = database.prepare(SELECT_RITUAL_NOTIFIED_DATE_SQL).get() as TdahRitualNotifiedDateRow | undefined | null;
    return row ? asString(row.ritual_notified_date) : null;
};

/**
 * Marks `date` as the local calendar day this namespace's ritual invitation
 * was already pushed — the ONLY place `ritual_notified_date` is ever written
 * (same single-writer discipline `mutateCloseOutgoingDay`/
 * `mutateMarkDueActivityTriggersNotified` already establish for their own
 * columns). Idempotent the same way those are: re-running it with the same
 * `date` changes nothing observable, and a plain `UPDATE ... WHERE id = 1`
 * against a namespace with no profile row yet is simply a 0-row no-op rather
 * than a throw. Unlike `start_notified_at`/`end_notified_at` (set once,
 * forever), this mark is meant to be overwritten on every new local day — the
 * "at most one invitation per calendar day" guarantee lives in the caller's
 * `readRitualNotifiedDate(...) !== today` check, not in this write.
 */
export const mutateMarkRitualNotified = (database: TdahDatabase, date: string): void => {
    database.prepare(UPDATE_RITUAL_NOTIFIED_DATE_SQL).run(date);
};

// --- Activity-trigger primitives (story 2.2) --------------------------------

// Candidate rows for either milestone: an Actividad with a real `start_time`
// that still needs its `start` mark OR (has a real `duration_minutes` and
// still needs its `end` mark). `day_plan_date <= ?` (not `= ?`) is the same
// unbounded backward SWEEP `CLOSE_OUTGOING_DAY_SQL`/
// `SELECT_PENDING_OR_STARTED_UP_TO_SQL` above already use: a milestone whose
// day rolled over before the tick ever caught it (server down across
// midnight, or longer) must still be found on every later tick, not just the
// one day it was originally planned for. `state NOT IN (...)` excludes the
// three terminal states — a manually completed/discarded/missed Actividad
// must never fire a notification for a milestone the user already resolved;
// `pending`/`started`/`limbo` remain eligible (the nightly sweep's own
// `limbo` transition is a day-close bookkeeping concern, independent of
// whether this Actividad's start/end notification already fired). Narrowed
// once in SQL; the actual crossing comparison happens in JS below via
// `localInstantMs`, never raw minutes-of-day (see that helper's own comment
// for why).
const SELECT_ACTIVITY_TRIGGER_CANDIDATES_SQL = `
    SELECT id, day_plan_date, title, start_time, duration_minutes, start_notified_at, end_notified_at
    FROM tdah_activity
    WHERE day_plan_date <= ? AND start_time IS NOT NULL
      AND state NOT IN ('completed', 'discarded', 'missed')
      AND (start_notified_at IS NULL OR (duration_minutes IS NOT NULL AND end_notified_at IS NULL));
`;
const UPDATE_ACTIVITY_START_NOTIFIED_SQL = 'UPDATE tdah_activity SET start_notified_at = ? WHERE id = ? AND start_notified_at IS NULL;';
const UPDATE_ACTIVITY_END_NOTIFIED_SQL = 'UPDATE tdah_activity SET end_notified_at = ? WHERE id = ? AND end_notified_at IS NULL;';

type TdahActivityTriggerCandidateRow = {
    id: unknown;
    day_plan_date: unknown;
    title: unknown;
    start_time: unknown;
    duration_minutes: unknown;
    start_notified_at: unknown;
    end_notified_at: unknown;
};

/**
 * Absolute local instant (ms), for a `date` ("YYYY-MM-DD") + `timeOfDay`
 * ("HH:mm") pair, anchored via `Date.UTC` the same "pure calendar math, IANA
 * zone resolution happens upstream" way `weekdayOfDate`/`computeTomorrowDate`
 * already anchor theirs — never a literal UTC instant, just a stable,
 * comparable number. This is what makes milestone-crossing comparisons
 * correct across a midnight boundary: plain minutes-of-day arithmetic
 * (0-1439) can never represent "tomorrow", so a milestone landing after
 * midnight (`startTime + durationMinutes > 1440`, or a row whose
 * `day_plan_date` is now yesterday relative to the tick's "today") could
 * never satisfy a same-day minutes-of-day comparison at all — that bug is
 * exactly what this helper (and the `day_plan_date <= ?` sweep above) fix.
 */
const localInstantMs = (date: string, timeOfDay: string): number => {
    const [year, month, day] = date.split('-').map(Number) as [number, number, number];
    const [hours, minutes] = timeOfDay.split(':').map(Number) as [number, number];
    return Date.UTC(year, month - 1, day, hours, minutes);
};

/** One Actividad milestone (`start` or `end`) that has crossed and hasn't been notified yet — `activity-trigger.ts`'s own shape for what to push over WS. */
export type TdahActivityTriggerFire = {
    id: number;
    title: string;
    startTime: string;
    durationMinutes: number | null;
    edge: 'start' | 'end';
};

/**
 * Evaluates every start/end-pending Actividad for `date` against
 * `nowTimeOfDay` ("HH:mm", the caller's own namespace-local wall clock — see
 * `computeLocalTimeOfDay` in scheduler.ts) and returns every milestone that
 * has crossed and still has no notified mark. An Actividad whose `start`
 * mark is still missing AND whose `end` milestone has also already crossed
 * (e.g. the tick was down across both) returns BOTH entries — each
 * milestone's mark is tracked and reported independently.
 */
const selectDueActivityTriggers = (database: TdahDatabase, date: string, nowTimeOfDay: string): TdahActivityTriggerFire[] => {
    const nowInstantMs = localInstantMs(date, nowTimeOfDay);
    const rows = prepareAll<TdahActivityTriggerCandidateRow>(database, SELECT_ACTIVITY_TRIGGER_CANDIDATES_SQL).all(date);
    const fires: TdahActivityTriggerFire[] = [];
    for (const row of rows) {
        // The milestone's OWN day (`row.day_plan_date`), never the tick's
        // "today" `date` param — a row swept in from an earlier day (the
        // `day_plan_date <= ?` query above) must anchor its instant to the
        // day it actually happened on.
        const rowDate = String(row.day_plan_date);
        const startTime = String(row.start_time);
        const startInstantMs = localInstantMs(rowDate, startTime);
        const durationMinutes = asNumberOrNull(row.duration_minutes);
        const id = Number(row.id);
        const title = String(row.title);
        const startAlreadyNotified = row.start_notified_at !== null && row.start_notified_at !== undefined;
        const endAlreadyNotified = row.end_notified_at !== null && row.end_notified_at !== undefined;
        if (!startAlreadyNotified && startInstantMs <= nowInstantMs) {
            fires.push({ id, title, startTime, durationMinutes, edge: 'start' });
        }
        if (!endAlreadyNotified && durationMinutes !== null) {
            const endInstantMs = startInstantMs + durationMinutes * 60_000;
            if (endInstantMs <= nowInstantMs) {
                fires.push({ id, title, startTime, durationMinutes, edge: 'end' });
            }
        }
    }
    return fires;
};

/**
 * The activity-trigger tick's own pre-transaction skip check (mirrors
 * `hasDayPlan`/`hasPendingOrStartedUpTo` above): true when at least one
 * Actividad milestone is due, so a namespace with nothing to fire never
 * opens a write transaction. Same already-open-handle contract as those two.
 */
export const hasDueActivityTriggers = (database: TdahDatabase, date: string, nowTimeOfDay: string): boolean => (
    selectDueActivityTriggers(database, date, nowTimeOfDay).length > 0
);

/**
 * Re-evaluates the due milestones INSIDE the held write transaction (never
 * trusts the pre-transaction read above — this is the one write that must be
 * atomic) and marks each one notified before returning it. The
 * `... IS NULL` guard on both UPDATE statements makes each mark idempotent
 * even in principle, though `withWriteTransaction`'s own `BEGIN IMMEDIATE`
 * already serializes every writer against this database file. This is the
 * ONLY place `start_notified_at`/`end_notified_at` are ever written — once
 * marked, a milestone can never fire a second WS event (AD-11-style
 * single-writer discipline, matching `mutateCloseOutgoingDay`'s own "only
 * the scheduler may bulk-transition state" rule).
 */
export const mutateMarkDueActivityTriggersNotified = (
    database: TdahDatabase,
    date: string,
    nowTimeOfDay: string,
    notifiedAtIso: string,
): TdahActivityTriggerFire[] => {
    const due = selectDueActivityTriggers(database, date, nowTimeOfDay);
    for (const fire of due) {
        if (fire.edge === 'start') {
            database.prepare(UPDATE_ACTIVITY_START_NOTIFIED_SQL).run(notifiedAtIso, fire.id);
        } else {
            database.prepare(UPDATE_ACTIVITY_END_NOTIFIED_SQL).run(notifiedAtIso, fire.id);
        }
    }
    return due;
};

/**
 * Every namespace under `dataDir` with an existing TDAH database, for
 * `scheduler.ts` to walk each tick. Reuses `pruneOrphanedCalendarFeeds`'s
 * (`server-calendar-feed.ts`) `readdirSync(dataDir)` pattern rather than
 * inventing a second directory-walk convention: `dataDir` mixes namespace
 * directories (`<key>/`, holding `attachments/` and now `tdah/`) with flat
 * per-namespace sidecar files (`<key>.json`, `<key>.ics.json`), so every entry
 * is filtered through `tdahDatabasePath` + `existsSync` rather than assumed to
 * be a namespace directory. A missing or unreadable `dataDir` yields an empty
 * list rather than throwing — mirrors `pruneOrphanedCalendarFeeds`'s own
 * best-effort `readdirSync` handling.
 */
export const listActiveTdahNamespaces = (dataDir: string): string[] => {
    let entries: string[];
    try {
        entries = readdirSync(dataDir);
    } catch {
        return [];
    }
    return entries.filter((entry) => existsSync(tdahDatabasePath(dataDir, entry)));
};

/**
 * The only function that generates a DayPlan. Inserts `tdah_day_plan` for
 * tomorrow (in the profile's time zone) plus one Actividad per Bloque of the
 * Rutina that wins precedence for that date (story 1.4's precedence engine —
 * nthWeekdayOfMonth outranks weekday, ties broken by most-recently-created),
 * or an empty DayPlan when no Rutina matches (FR-3, unchanged from story
 * 1.3). A no-op when tomorrow's DayPlan already exists — `tdah_day_plan.date`
 * is the PRIMARY KEY, so retries and story 1.5's recurring scheduler can call
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
    return await withWriteTransaction(databasePath, (database) => (
        mutateGenerateTomorrowIfMissing(database, date)
    ));
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

// --- Today / Activities (story 1.6) -----------------------------------------

// Timed Activities first (ascending by `start_time`), then every "sin hora"
// (no-time) Activity trailing at the end in `id` order — doc 02's T-01
// layout puts the "sin hora" section after the timed timeline, and without
// the explicit `(start_time IS NULL) ASC` clause SQLite's default `ASC`
// ordering treats `NULL` as smaller than any real value, which would sort
// no-time Activities FIRST instead of last.
const SELECT_ACTIVITIES_FOR_DAY_SQL = `
    SELECT id, day_plan_date, block_id, title, start_time, duration_minutes, origin, state, started_at, completed_at
    FROM tdah_activity
    WHERE day_plan_date = ?
    ORDER BY (start_time IS NULL) ASC, start_time ASC, id ASC;
`;
// `null` whenever today has no block-linked (origin:'routine') Activity —
// either no Rutina applies (FR-3) or today is manual-only. A routine-edit
// that deletes a Bloque after generation (block_id nullable, not
// FK-enforced, per storage.ts's existing update/delete comments) makes this
// JOIN stop matching for that Activity too — accepted the same way that
// existing divergence already is elsewhere in this file.
// `ORDER BY tdah_activity.id ASC` makes the `LIMIT 1` pick deterministic —
// current design only ever has every routine-linked Activity for a day share
// the same Rutina (so there's exactly one candidate title in practice), but
// the query itself should never depend on SQLite's unspecified row order for
// the theoretical case where more than one candidate exists.
const SELECT_ROUTINE_TITLE_FOR_DAY_SQL = `
    SELECT tdah_routine.title AS title
    FROM tdah_activity
    JOIN tdah_routine_block ON tdah_activity.block_id = tdah_routine_block.id
    JOIN tdah_routine ON tdah_routine_block.routine_id = tdah_routine.id
    WHERE tdah_activity.day_plan_date = ?
    ORDER BY tdah_activity.id ASC
    LIMIT 1;
`;
const SELECT_ACTIVITY_BY_ID_SQL = 'SELECT id, day_plan_date, block_id, title, start_time, duration_minutes, origin, state, started_at, completed_at FROM tdah_activity WHERE id = ?;';
const INSERT_MANUAL_ACTIVITY_SQL = `
    INSERT INTO tdah_activity (day_plan_date, block_id, title, start_time, duration_minutes, origin, state)
    VALUES (?, NULL, ?, ?, ?, 'manual', 'pending');
`;
const UPDATE_ACTIVITY_START_SQL = "UPDATE tdah_activity SET state = 'started', started_at = ? WHERE id = ?;";
const UPDATE_ACTIVITY_COMPLETE_SQL = "UPDATE tdah_activity SET state = 'completed', completed_at = ? WHERE id = ?;";
const UPDATE_ACTIVITY_MISS_SQL = "UPDATE tdah_activity SET state = 'missed' WHERE id = ?;";

type TdahActivityRow = {
    id: unknown;
    day_plan_date: unknown;
    block_id: unknown;
    title: unknown;
    start_time: unknown;
    duration_minutes: unknown;
    origin: unknown;
    state: unknown;
    started_at: unknown;
    completed_at: unknown;
};

const asNumberOrNull = (value: unknown): number | null => (
    value === null || value === undefined ? null : Number(value)
);

const rowToActivity = (row: TdahActivityRow): TdahActivity => ({
    id: Number(row.id),
    dayPlanDate: String(row.day_plan_date),
    blockId: row.block_id === null || row.block_id === undefined ? null : Number(row.block_id),
    title: String(row.title),
    // `null` for a manual Activity created without an explicit time/duration
    // (doc 02's "sin hora" case) — a Bloque-instantiated Activity always has
    // both, since it copies them straight from its Bloque.
    startTime: asString(row.start_time),
    durationMinutes: asNumberOrNull(row.duration_minutes),
    origin: row.origin as TdahActivityOrigin,
    state: row.state as TdahActivityState,
    startedAt: asString(row.started_at),
    completedAt: asString(row.completed_at),
});

const selectActivityById = (database: TdahDatabase, activityId: number): TdahActivity | null => {
    const row = database.prepare(SELECT_ACTIVITY_BY_ID_SQL).get(activityId) as TdahActivityRow | undefined | null;
    return row ? rowToActivity(row) : null;
};

export type TdahDayPlanView = {
    date: string;
    timeZone: string;
    routineTitle: string | null;
    activities: TdahActivity[];
};

/**
 * `getTodayDayPlan`'s raw-database read half — every Activity for `date`
 * (ordered by `plannedStart`, doc 02's T-01 layout) plus the applicable
 * Rutina's title, if any. `timeZone` is threaded through rather than reread
 * from the profile here, since the caller already resolved it (with the
 * `TDAH_DEFAULT_TIME_ZONE` fallback) before opening this transaction.
 */
const selectDayPlanView = (database: TdahDatabase, date: string, timeZone: string): TdahDayPlanView => {
    const activities = prepareAll<TdahActivityRow>(database, SELECT_ACTIVITIES_FOR_DAY_SQL).all(date).map(rowToActivity);
    const routineTitleRow = database.prepare(SELECT_ROUTINE_TITLE_FOR_DAY_SQL).get(date) as { title: unknown } | undefined | null;
    return { date, timeZone, routineTitle: routineTitleRow ? String(routineTitleRow.title) : null, activities };
};

/**
 * GET /v1/tdah/day — today's DayPlan (AD-1: always fetched fresh, server
 * computes "today" from the caller's own profile time zone, never the
 * client). Auto-generates today's DayPlan on demand if missing, reusing
 * `mutateGenerateTomorrowIfMissing` with today's date instead of tomorrow's
 * (the design's own gap-filler for a same-day-as-activation "Hoy" view,
 * which the nightly scheduler — story 1.5 — never has a chance to generate
 * itself, since it only ever generates *tomorrow's* plan).
 *
 * The generate-if-missing write is the RARE path, so it mirrors the
 * scheduler's own shape rather than paying a `BEGIN IMMEDIATE` on every GET:
 * a read-only `hasDayPlan` check serves the overwhelming-majority case, and
 * only a missing plan takes the write transaction (inside which the
 * generate and the view read still share one held transaction, so a
 * concurrent request can never observe a half-generated day). The rare
 * two-first-GETs race is safe because `tdah_day_plan.date`'s PRIMARY KEY
 * makes the loser's generate a no-op.
 */
export async function getTodayDayPlan(
    dataDir: string,
    key: string,
    timeZone: string,
): Promise<TdahDayPlanView> {
    const databasePath = tdahDatabasePath(dataDir, key);
    const date = formatDateInTimeZone(new Date(), timeZone);
    if (existsSync(databasePath)) {
        const existing = await withReadDatabase(databasePath, (database) => (
            hasDayPlan(database, date) ? selectDayPlanView(database, date, timeZone) : null
        ));
        if (existing) return existing;
    }
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    return await withWriteTransaction(databasePath, (database) => {
        mutateGenerateTomorrowIfMissing(database, date);
        return selectDayPlanView(database, date, timeZone);
    });
}

export type TdahCreateManualActivityInput = {
    title: string;
    startTime?: string;
    durationMinutes?: number;
};

// A single day's timeline cannot reasonably need more Actividades than this —
// caps otherwise-unbounded manual-Activity creation via
// POST /v1/tdah/day/activities, the same DW-2-style resource-cost concern
// `TDAH_ROUTINE_MAX_BLOCKS`/`TDAH_ROUTINE_MAX_COUNT` already guard against for
// Rutina Bloques/count. Counts every Activity for the day (routine-generated
// included, not just manual ones) since both share the same rendered
// timeline.
export const TDAH_DAY_MAX_ACTIVITIES = 50;

/**
 * `mutateCreateManualActivity`'s own day-plan bootstrap: FR-4 lets a manual
 * Activity be added "at any moment", including before today's DayPlan has
 * ever been fetched (and thus generated) — reusing
 * `mutateGenerateTomorrowIfMissing` here (rather than a bare
 * `INSERT INTO tdah_day_plan`) means a first-ever manual add on an
 * un-generated day still applies today's Rutina, if any, instead of
 * silently creating an empty day that then blocks the real Rutina Activities
 * from ever being generated (`tdah_day_plan.date` is a PRIMARY KEY).
 *
 * `null` means the day was already at `TDAH_DAY_MAX_ACTIVITIES` — the count
 * check and the insert run inside the same held transaction (matching
 * `insertRoutineIfUnderCap`'s own cap discipline), so a burst of concurrent
 * creates can never all observe count < the cap and collectively overshoot
 * it.
 */
const mutateCreateManualActivity = (
    database: TdahDatabase,
    date: string,
    input: TdahCreateManualActivityInput,
): TdahActivity | null => {
    mutateGenerateTomorrowIfMissing(database, date);
    const countRow = database.prepare(COUNT_ACTIVITIES_FOR_DAY_PLAN_SQL).get(date) as { count: unknown };
    if (Number(countRow.count) >= TDAH_DAY_MAX_ACTIVITIES) return null;
    // FR-4/doc 02: time and duration are genuinely optional on a manual
    // Activity — an omitted `startTime`/`durationMinutes` persists as `NULL`
    // (the "sin hora" case), never a defaulted "now"/`0`. Only
    // Bloque-instantiated Activities (INSERT_ACTIVITY_FROM_BLOCK_SQL) always
    // have a real time, since they copy it straight from their Bloque.
    const startTime = input.startTime ?? null;
    const durationMinutes = input.durationMinutes ?? null;
    const inserted = database.prepare(INSERT_MANUAL_ACTIVITY_SQL).run(date, input.title, startTime, durationMinutes);
    const activityId = Number(inserted.lastInsertRowid);
    const created = selectActivityById(database, activityId);
    if (!created) {
        throw new Error('TDAH activity readback failed after insert');
    }
    return created;
};

/**
 * POST /v1/tdah/day/activities — creates a manual Activity for today (FR-4),
 * origin:'manual', state:'pending'. `null` when the day is already at
 * `TDAH_DAY_MAX_ACTIVITIES` — the insert never ran (routes.ts turns that into
 * 400 `TDAH_ACTIVITY_INVALID`).
 */
export async function createManualActivity(
    dataDir: string,
    key: string,
    timeZone: string,
    input: TdahCreateManualActivityInput,
): Promise<TdahActivity | null> {
    const databasePath = tdahDatabasePath(dataDir, key);
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    const date = formatDateInTimeZone(new Date(), timeZone);
    return await withWriteTransaction(databasePath, (database) => mutateCreateManualActivity(database, date, input));
}

export type TdahActivityTransitionResult =
    | { kind: 'notFound' }
    | { kind: 'rejected' }
    | { kind: 'ok'; activity: TdahActivity };

/**
 * AD-7: `startedAt`/`completedAt` are each written exactly once, by their own
 * dedicated endpoint, and never re-editable afterward. `start`/`complete`/
 * `miss` are idempotent — a raced double-tap (or a tap on an
 * already-further-along Activity) never produces a duplicate write or an
 * error:
 * - `start` only transitions a `pending` Activity; any other current state
 *   is a no-op returning the current state unchanged.
 * - `complete`/`miss` only transition a `pending`/`started` Activity into
 *   their target state (`completed`/`missed`). Calling one when the
 *   Activity is already in that exact target state is the same kind of
 *   no-op; any other non-`pending`/`started` current state is `rejected`
 *   (routes.ts turns that into 400 `TDAH_ACTIVITY_INVALID`) — `limbo`/
 *   `discarded` are set later by the scheduler or a future ritual flow and
 *   are never reachable through these endpoints in practice, since this
 *   story only ever registers actions on *today's* Activities.
 */
const mutateTransitionActivityState = (
    database: TdahDatabase,
    activityId: number,
    action: TdahActivityTransitionAction,
): TdahActivityTransitionResult => {
    const activity = selectActivityById(database, activityId);
    if (!activity) return { kind: 'notFound' };

    if (action === 'start') {
        if (activity.state !== 'pending') return { kind: 'ok', activity };
        database.prepare(UPDATE_ACTIVITY_START_SQL).run(new Date().toISOString(), activityId);
        const updated = selectActivityById(database, activityId);
        if (!updated) throw new Error('TDAH activity readback failed after start');
        return { kind: 'ok', activity: updated };
    }

    const targetState: TdahActivityState = action === 'complete' ? 'completed' : 'missed';
    if (activity.state === targetState) {
        return { kind: 'ok', activity };
    }
    if (activity.state !== 'pending' && activity.state !== 'started') {
        return { kind: 'rejected' };
    }
    if (action === 'complete') {
        database.prepare(UPDATE_ACTIVITY_COMPLETE_SQL).run(new Date().toISOString(), activityId);
    } else {
        database.prepare(UPDATE_ACTIVITY_MISS_SQL).run(activityId);
    }
    const updated = selectActivityById(database, activityId);
    if (!updated) throw new Error('TDAH activity readback failed after transition');
    return { kind: 'ok', activity: updated };
};

/** POST /v1/tdah/activities/:id/{start|complete|miss} — see `mutateTransitionActivityState` for the idempotency/rejection rules. */
export async function transitionActivityState(
    dataDir: string,
    key: string,
    activityId: number,
    action: TdahActivityTransitionAction,
): Promise<TdahActivityTransitionResult> {
    const databasePath = tdahDatabasePath(dataDir, key);
    if (!existsSync(databasePath)) return { kind: 'notFound' };
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    return await withWriteTransaction(databasePath, (database) => mutateTransitionActivityState(database, activityId, action));
}

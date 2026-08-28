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
import { TDAH_ACTIVITY_ORIGINS, TDAH_ERRORS } from './types';
import type {
    TdahActivity,
    TdahActivityDecideRequest,
    TdahActivityOrigin,
    TdahActivityState,
    TdahActivityTransitionAction,
    TdahConfirmMorningRequest,
    TdahErrorCode,
    TdahHistoryEntry,
    TdahLimboDecideBatchRequest,
    TdahMetricsOriginBreakdown,
    TdahMetricsResponse,
    TdahMetricsTrendPoint,
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
    TdahWorkOriginItem,
    TdahWorkOriginProvider,
    TdahWorkOriginStatus,
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

// `confirmed_at` (story 3.3) marks the local calendar date `tdah_day_plan`'s
// row was last confirmed via `POST /v1/tdah/day/tomorrow/confirm` — a fresh
// database gets it directly from this CREATE TABLE (so a new user starts at
// schema v5 with no migration to run), while a pre-3.3 database needs
// `migrateMorningEditColumnsIfNeeded` below (a plain `ALTER TABLE ... ADD
// COLUMN`, same shape as the notification-column pairs above, since it's a
// genuinely new nullable column with no existing constraint to relax). `null`
// until the first confirm; re-confirming after that (T-06's soft-lock
// re-entry) simply overwrites it with a fresher timestamp.
const CREATE_DAY_PLAN_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS tdah_day_plan (
        date TEXT PRIMARY KEY,
        generated_at TEXT NOT NULL,
        confirmed_at TEXT
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
// `sort_order`/`moved_at` (story 3.3) back T-06's morning editor: `sort_order`
// is the draft's confirmed drag order (`0` default for every unedited row, so
// existing rows keep their prior relative order via the secondary sort keys
// in `SELECT_ACTIVITIES_FOR_DAY_SQL` below); `moved_at` marks an Actividad
// that a T-05 `move-tomorrow`/`move-date` decision (story 3.2) relocated here
// — distinct from `origin:'routine'`'s "De Rutina X" badge. A fresh database
// gets both directly from this CREATE TABLE (so a new user starts at schema
// v5 with no migration to run), while a pre-3.3 database needs
// `migrateMorningEditColumnsIfNeeded` below (a plain `ALTER TABLE ... ADD
// COLUMN` pair, since both are genuinely new columns with no existing
// constraint to relax — `sort_order` gets a `DEFAULT 0` so the `ALTER TABLE`
// itself backfills every pre-existing row instead of leaving them NULL).
const CREATE_ACTIVITY_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS tdah_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day_plan_date TEXT NOT NULL REFERENCES tdah_day_plan(date),
        block_id INTEGER REFERENCES tdah_routine_block(id),
        title TEXT NOT NULL,
        start_time TEXT,
        duration_minutes INTEGER,
        origin TEXT NOT NULL CHECK (origin IN ('routine', 'manual', 'jira')),
        state TEXT NOT NULL CHECK (state IN ('pending', 'started', 'completed', 'missed', 'limbo', 'discarded')) DEFAULT 'pending',
        started_at TEXT,
        completed_at TEXT,
        start_notified_at TEXT,
        end_notified_at TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        moved_at TEXT
    );
`;

// --- Origen de trabajo (story 4.1) -----------------------------------------
//
// One row, `id = 1`, exactly like `tdah_profile`: a namespace has at most one
// connected Origen in v1, so the singleton PRIMARY KEY makes "connect twice"
// an UPSERT rather than something the application has to police.
//
// `secret_sealed` holds ONLY the `v1.<nonce>.<ciphertext>` container from
// `origin-crypto.ts`. There is deliberately no companion plaintext column and
// no "unsealed" fallback — the Origen fails closed when no master key is
// configured (see `TDAH_ERRORS.originKeyUnavailable`), and a schema with
// nowhere to put a clear token cannot be talked into storing one.
//
// `last_pull_at` vs `last_sync_at` are two different facts and both are
// needed: the first is *attempted* (advanced on every pull, success or not,
// so a failing Origen backs off on its own schedule instead of hammering
// Atlassian every tick), the second is *succeeded* (what T-13 renders as
// "última sincronización"). Collapsing them would either hammer or lie.
//
// `last_error_code` stores a stable `TDAH_…` code, never a raw HTTP/fs
// message — the same `.code`-only rule the rest of the module follows.
const CREATE_WORK_ORIGIN_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS tdah_work_origin (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        provider TEXT NOT NULL,
        site_url TEXT NOT NULL,
        account_email TEXT NOT NULL,
        secret_sealed TEXT NOT NULL,
        jql TEXT NOT NULL,
        work_start TEXT NOT NULL,
        work_end TEXT NOT NULL,
        pull_interval_minutes INTEGER NOT NULL,
        connected_at TEXT NOT NULL,
        last_pull_at TEXT,
        last_sync_at TEXT,
        last_error_code TEXT,
        updated_at TEXT NOT NULL
    );
`;

// The snapshot the last successful pull left behind — wholesale replaced on
// every sync (`replaceWorkOriginItems`), never merged, so a closed issue
// simply stops existing rather than needing a tombstone. No foreign key to
// `tdah_work_origin`: `deleteWorkOrigin` clears both tables in one
// transaction, and a FK would only add a constraint failure mode to a
// relationship that is already 1:N-by-construction (one singleton row).
const CREATE_WORK_ORIGIN_ITEM_SQL = `
    CREATE TABLE IF NOT EXISTS tdah_work_origin_item (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_key TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        sprint_name TEXT,
        sort_order INTEGER NOT NULL
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
// Story 3.3 — adds `tdah_activity.sort_order`/`moved_at` and
// `tdah_day_plan.confirmed_at` (T-06's morning editor + T-07's confirm).
const SCHEMA_VERSION_MORNING_EDIT = 5;
// Story 4.1 — widens `tdah_activity.origin`'s CHECK to admit the Origen's
// grouped band (`'jira'`). The two new Origen tables need no version of their
// own (`CREATE TABLE IF NOT EXISTS` creates them on any database, new or old);
// only the CHECK relaxation needs a real migration, since SQLite cannot alter
// an existing constraint in place.
const SCHEMA_VERSION_JIRA_ORIGIN = 6;
const SCHEMA_TARGET_VERSION = SCHEMA_VERSION_JIRA_ORIGIN;

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

/**
 * v4 -> v5 (story 3.3): a pre-3.3 database's `tdah_activity` has neither
 * `sort_order` nor `moved_at`, and its `tdah_day_plan` has no `confirmed_at`
 * — the persisted shape T-06's morning editor and T-07's confirm need (see
 * this file's own CREATE_ACTIVITY_TABLE_SQL/CREATE_DAY_PLAN_TABLE_SQL doc
 * comments above). Every one of the three is a genuinely new column with no
 * existing `NOT NULL`/CHECK constraint to relax, so this is a plain
 * `ALTER TABLE ... ADD COLUMN` trio rather than a create-copy-drop-rename
 * rebuild — `sort_order`'s own `DEFAULT 0` backfills every pre-existing row
 * automatically.
 */
const migrateMorningEditColumnsIfNeeded = (database: TdahDatabase): void => {
    const activityColumns = prepareAll<{ name: unknown }>(database, "PRAGMA table_info('tdah_activity');").all();
    const hasMorningEditColumns = activityColumns.some((column) => String(column.name) === 'sort_order');

    if (!hasMorningEditColumns) {
        database.exec('BEGIN IMMEDIATE;');
        try {
            database.exec('ALTER TABLE tdah_activity ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;');
            database.exec('ALTER TABLE tdah_activity ADD COLUMN moved_at TEXT;');
            database.exec('ALTER TABLE tdah_day_plan ADD COLUMN confirmed_at TEXT;');
            database.exec(`PRAGMA user_version = ${SCHEMA_VERSION_MORNING_EDIT};`);
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

    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION_MORNING_EDIT};`);
};

/**
 * v5 -> v6 (story 4.1): every database created before this story carries
 * `CHECK (origin IN ('routine', 'manual'))` on `tdah_activity`. The Origen's
 * grouped band is `origin = 'jira'`, so without this step the very first pull
 * would fail its INSERT with a constraint violation — the same permanent
 * `CREATE TABLE IF NOT EXISTS` no-op trap DW-9 documented for the Rutina
 * pattern widening.
 *
 * A CHECK constraint cannot be relaxed by `ALTER TABLE` in SQLite, so this is
 * the full create-copy-drop-rename rebuild, following
 * `migrateActivityTimestampColumnsIfNeeded`'s pattern exactly (including the
 * `_v2` staging name, the `DROP TABLE IF EXISTS` defense against an
 * interrupted earlier attempt, and its own explicit transaction so a crash
 * mid-rebuild rolls back cleanly instead of stranding a `tdah_activity_v2`
 * that would make every later attempt throw "table already exists").
 *
 * Detection reads the stored DDL (`sqlite_master.sql`) rather than
 * `PRAGMA table_info`, because unlike every previous migration in this file
 * the change is to a *constraint*, not to the column set — `table_info` cannot
 * see it. A fresh database already gets the widened CHECK from
 * `CREATE_ACTIVITY_TABLE_SQL`, so it is recognised as current and only needs
 * its version stamped, never a rebuild.
 */
const migrateActivityJiraOriginIfNeeded = (database: TdahDatabase): void => {
    const tableRow = database
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tdah_activity';")
        .get() as { sql: unknown } | undefined | null;
    const ddl = tableRow ? String(tableRow.sql ?? '') : '';
    const hasWidenedOriginCheck = ddl.includes("'jira'");

    if (!hasWidenedOriginCheck) {
        database.exec('BEGIN IMMEDIATE;');
        try {
            database.exec('DROP TABLE IF EXISTS tdah_activity_v2;');
            database.exec(`
                CREATE TABLE tdah_activity_v2 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    day_plan_date TEXT NOT NULL REFERENCES tdah_day_plan(date),
                    block_id INTEGER REFERENCES tdah_routine_block(id),
                    title TEXT NOT NULL,
                    start_time TEXT,
                    duration_minutes INTEGER,
                    origin TEXT NOT NULL CHECK (origin IN ('routine', 'manual', 'jira')),
                    state TEXT NOT NULL CHECK (state IN ('pending', 'started', 'completed', 'missed', 'limbo', 'discarded')) DEFAULT 'pending',
                    started_at TEXT,
                    completed_at TEXT,
                    start_notified_at TEXT,
                    end_notified_at TEXT,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    moved_at TEXT
                );
            `);
            // Straight copy of every column: this step only relaxes a
            // constraint, it never reinterprets or backfills existing data.
            // By the time it runs, the v1->v5 steps above have already brought
            // every column into existence, so the explicit column list is
            // safe against any starting version.
            database.exec(`
                INSERT INTO tdah_activity_v2 (
                    id, day_plan_date, block_id, title, start_time, duration_minutes, origin, state,
                    started_at, completed_at, start_notified_at, end_notified_at, sort_order, moved_at
                )
                SELECT
                    id, day_plan_date, block_id, title, start_time, duration_minutes, origin, state,
                    started_at, completed_at, start_notified_at, end_notified_at, sort_order, moved_at
                FROM tdah_activity;
            `);
            database.exec('DROP TABLE tdah_activity;');
            database.exec('ALTER TABLE tdah_activity_v2 RENAME TO tdah_activity;');
            database.exec(`PRAGMA user_version = ${SCHEMA_VERSION_JIRA_ORIGIN};`);
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

    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION_JIRA_ORIGIN};`);
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

    if (currentVersion < SCHEMA_VERSION_MORNING_EDIT) {
        migrateMorningEditColumnsIfNeeded(database);
        currentVersion = SCHEMA_VERSION_MORNING_EDIT;
    }

    if (currentVersion < SCHEMA_VERSION_JIRA_ORIGIN) {
        migrateActivityJiraOriginIfNeeded(database);
        currentVersion = SCHEMA_VERSION_JIRA_ORIGIN;
    }
};

/** Schema init (`CREATE TABLE IF NOT EXISTS` x7) plus the migration step above, run on every open. */
const ensureSchema = (database: TdahDatabase): void => {
    database.exec(CREATE_PROFILE_TABLE_SQL);
    database.exec(CREATE_ROUTINE_TABLE_SQL);
    database.exec(CREATE_ROUTINE_BLOCK_TABLE_SQL);
    database.exec(CREATE_DAY_PLAN_TABLE_SQL);
    database.exec(CREATE_ACTIVITY_TABLE_SQL);
    database.exec(CREATE_WORK_ORIGIN_TABLE_SQL);
    database.exec(CREATE_WORK_ORIGIN_ITEM_SQL);
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

// Story 3.2 — `move-date`'s own `YYYY-MM-DD` validator, same bounded-year
// rationale as `TDAH_MONTH_PATTERN` above (a caller-controlled year string
// otherwise risks JS's legacy two-digit-year `Date.UTC` folding). Unlike
// `TDAH_MONTH_PATTERN`, this also round-trips the parsed Y-M-D through
// `Date.UTC` and checks the result's own components still match, so a
// syntactically-shaped but calendar-impossible date (e.g. "2026-02-30")
// is rejected too, rather than silently rolling over into March.
const TDAH_DATE_SHAPE_PATTERN = /^(19[7-9]\d|2\d{3})-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
export const isValidDateString = (value: string): boolean => {
    if (!TDAH_DATE_SHAPE_PATTERN.test(value)) return false;
    const parts = value.split('-').map(Number);
    const [year, month, day] = parts as [number, number, number];
    const roundTrip = new Date(Date.UTC(year, month - 1, day));
    return roundTrip.getUTCFullYear() === year && roundTrip.getUTCMonth() === month - 1 && roundTrip.getUTCDate() === day;
};

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

/**
 * `date` (a `YYYY-MM-DD` string already resolved via `formatDateInTimeZone`)
 * shifted by `deltaDays` (positive or negative), calendar-safe via the same
 * `Date.UTC`-normalization trick `computeTomorrowDate` above already uses for
 * its own `+1` day case — treats the Y-M-D components as UTC and lets
 * `Date.UTC` handle month/year rollover, so no time zone is needed for this
 * second step (the zone was already applied once, when `date` itself was
 * first resolved).
 */
const shiftDateString = (date: string, deltaDays: number): string => {
    const parts = date.split('-').map(Number);
    const [year, month, day] = parts as [number, number, number];
    const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
    return formatDateInTimeZone(shifted, 'UTC');
};

/**
 * Story 3.5 — the shared rolling-window primitive behind History/Metrics'
 * `day`/`week`/`month` presets (`routes.ts`) and Metrics' own always-8-week
 * trend window (`getMetrics` below): a `days`-day window ending "today" in
 * `timeZone` (AD-6: `formatDateInTimeZone(new Date(), timeZone)`, never the
 * client's clock). `days: 1` yields `from === to === today`.
 */
export const computeRollingRange = (
    timeZone: string,
    days: number,
    now: Date = new Date(),
): { from: string; to: string } => {
    const to = formatDateInTimeZone(now, timeZone);
    const from = shiftDateString(to, -(days - 1));
    return { from, to };
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
// `sort_order ASC` leads (story 3.3): T-06's confirm persists the draft's
// final drag order there (index in the confirmed array), so a confirmed day
// renders in exactly that order. Every row `sort_order` has never touched
// still shares the default `0`, so the original timed-then-untimed ordering
// (`(start_time IS NULL) ASC, start_time ASC, id ASC`) remains the tie-break
// among them — an un-confirmed day (or one confirmed with no reorder) renders
// identically to before this story.
const SELECT_ACTIVITIES_FOR_DAY_SQL = `
    SELECT id, day_plan_date, block_id, title, start_time, duration_minutes, origin, state, started_at, completed_at, moved_at
    FROM tdah_activity
    WHERE day_plan_date = ?
    ORDER BY sort_order ASC, (start_time IS NULL) ASC, start_time ASC, id ASC;
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
// Story 3.4 — El Limbo (T-08): every Actividad currently `state = 'limbo'`,
// across every `day_plan_date`, oldest first. Deliberately no `WHERE
// day_plan_date = ?` — unlike SELECT_ACTIVITIES_FOR_DAY_SQL above, this
// screen has no "today"/"tomorrow" scoping at all (FR-9: nothing here ever
// disappears by age, so nothing here is ever date-filtered either).
const SELECT_LIMBO_ACTIVITIES_SQL = `
    SELECT id, day_plan_date, block_id, title, start_time, duration_minutes, origin, state, started_at, completed_at, moved_at
    FROM tdah_activity
    WHERE state = 'limbo'
    ORDER BY day_plan_date ASC, id ASC;
`;
// Story 3.5 — History (T-09) candidate query. The denominator both screens
// draw from (Boundaries & Constraints): every Actividad
// `missed`/`limbo`/`completed` in `[?, ?]` (lexical `>=`/`<=` on
// `day_plan_date`'s `YYYY-MM-DD` text key, same idiom as
// `CLOSE_OUTGOING_DAY_SQL` above) — deliberately excludes `pending`/`started`
// (not yet decided) and `discarded` (never penalized, SM-C2). `origin`/
// `tdah_routine.id` are optional filters expressed as `(? IS NULL OR …)`;
// `getHistory` is the only caller, and `getMetrics` uses its own two-window
// variant below rather than widening this single window.
// `LEFT JOIN` (not `JOIN`, unlike `SELECT_ROUTINE_TITLE_FOR_DAY_SQL`): a
// `manual` Actividad, or a `routine` one whose Bloque/Rutina was since
// deleted, must still surface in the candidate set — it simply carries a
// `NULL` `routine_title`/`routine_id_for_filter`.
const SELECT_HISTORY_CANDIDATES_SQL = `
    SELECT
        tdah_activity.id AS id,
        tdah_activity.day_plan_date AS day_plan_date,
        tdah_activity.block_id AS block_id,
        tdah_activity.title AS title,
        tdah_activity.start_time AS start_time,
        tdah_activity.duration_minutes AS duration_minutes,
        tdah_activity.origin AS origin,
        tdah_activity.state AS state,
        tdah_activity.started_at AS started_at,
        tdah_activity.completed_at AS completed_at,
        tdah_activity.moved_at AS moved_at,
        tdah_routine.title AS routine_title
    FROM tdah_activity
    LEFT JOIN tdah_routine_block ON tdah_activity.block_id = tdah_routine_block.id
    LEFT JOIN tdah_routine ON tdah_routine_block.routine_id = tdah_routine.id
    WHERE tdah_activity.state IN ('missed', 'limbo', 'completed')
      AND tdah_activity.day_plan_date >= ? AND tdah_activity.day_plan_date <= ?
      AND (? IS NULL OR tdah_activity.origin = ?)
      AND (? IS NULL OR tdah_routine.id = ?)
    ORDER BY tdah_activity.day_plan_date DESC, tdah_activity.id DESC;
`;
// `getMetrics`' own candidate select. It needs TWO windows at once (the
// requested KPI period and the always-rolling 56-day trend), which are not
// necessarily adjacent — a `custom` period may sit entirely in the past. Two
// explicit `BETWEEN` predicates, never the hull `min(from) .. max(to)`: the
// hull would silently scan every day between an old custom period and today,
// re-creating exactly the unscoped read this story exists to fix (Boundaries &
// Constraints: "todo rango de consulta es explícito y acotado... nunca una
// consulta 'todo el historial' sin tope"). Rows in the gap between the two
// windows are never read at all. No `origin`/`routineId` filters: Metrics
// always aggregates the whole range and breaks down by origin in JS.
const SELECT_METRICS_CANDIDATES_SQL = `
    SELECT
        tdah_activity.id AS id,
        tdah_activity.day_plan_date AS day_plan_date,
        tdah_activity.block_id AS block_id,
        tdah_activity.title AS title,
        tdah_activity.start_time AS start_time,
        tdah_activity.duration_minutes AS duration_minutes,
        tdah_activity.origin AS origin,
        tdah_activity.state AS state,
        tdah_activity.started_at AS started_at,
        tdah_activity.completed_at AS completed_at,
        tdah_activity.moved_at AS moved_at
    FROM tdah_activity
    WHERE tdah_activity.state IN ('missed', 'limbo', 'completed')
      AND (
          (tdah_activity.day_plan_date >= ? AND tdah_activity.day_plan_date <= ?)
          OR (tdah_activity.day_plan_date >= ? AND tdah_activity.day_plan_date <= ?)
      );
`;
const SELECT_ROUTINE_TITLE_FOR_DAY_SQL = `
    SELECT tdah_routine.title AS title
    FROM tdah_activity
    JOIN tdah_routine_block ON tdah_activity.block_id = tdah_routine_block.id
    JOIN tdah_routine ON tdah_routine_block.routine_id = tdah_routine.id
    WHERE tdah_activity.day_plan_date = ?
    ORDER BY tdah_activity.id ASC
    LIMIT 1;
`;
const SELECT_ACTIVITY_BY_ID_SQL = 'SELECT id, day_plan_date, block_id, title, start_time, duration_minutes, origin, state, started_at, completed_at, moved_at FROM tdah_activity WHERE id = ?;';
const INSERT_MANUAL_ACTIVITY_SQL = `
    INSERT INTO tdah_activity (day_plan_date, block_id, title, start_time, duration_minutes, origin, state)
    VALUES (?, NULL, ?, ?, ?, 'manual', 'pending');
`;
const UPDATE_ACTIVITY_START_SQL = "UPDATE tdah_activity SET state = 'started', started_at = ? WHERE id = ?;";
const UPDATE_ACTIVITY_COMPLETE_SQL = "UPDATE tdah_activity SET state = 'completed', completed_at = ? WHERE id = ?;";
const UPDATE_ACTIVITY_MISS_SQL = "UPDATE tdah_activity SET state = 'missed' WHERE id = ?;";
// Story 3.2 — `move-tomorrow`/`move-date`: reprogramming is a fresh attempt
// on a new day, so `startedAt`/`completedAt` are cleared back to NULL rather
// than carried over from the missed/limbo attempt being replaced.
// `moved_at` (story 3.3) is stamped here too — the only place it's ever
// written — so T-06 can render its "Movido desde el Cierre" badge, distinct
// from `origin:'routine'`'s own badge; `discard`/`undated` never touch it.
const UPDATE_ACTIVITY_DECIDE_MOVE_SQL = "UPDATE tdah_activity SET state = 'pending', day_plan_date = ?, started_at = NULL, completed_at = NULL, moved_at = ? WHERE id = ?;";
const UPDATE_ACTIVITY_DECIDE_DISCARD_SQL = "UPDATE tdah_activity SET state = 'discarded' WHERE id = ?;";

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
    moved_at: unknown;
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
    // `null` unless a T-05 `move-tomorrow`/`move-date` decision (story 3.2)
    // relocated this Actividad — the only write path for this column (see
    // UPDATE_ACTIVITY_DECIDE_MOVE_SQL).
    movedAt: asString(row.moved_at),
});

const selectActivityById = (database: TdahDatabase, activityId: number): TdahActivity | null => {
    const row = database.prepare(SELECT_ACTIVITY_BY_ID_SQL).get(activityId) as TdahActivityRow | undefined | null;
    return row ? rowToActivity(row) : null;
};

export type TdahDayPlanView = {
    date: string;
    timeZone: string;
    routineTitle: string | null;
    /** `null` until `POST /v1/tdah/day/tomorrow/confirm` (story 3.3, T-06/T-07) sets it; re-confirming overwrites it with a fresher timestamp. */
    confirmedAt: string | null;
    activities: TdahActivity[];
};

const SELECT_DAY_PLAN_CONFIRMED_AT_SQL = 'SELECT confirmed_at FROM tdah_day_plan WHERE date = ?;';

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
    const dayPlanRow = database.prepare(SELECT_DAY_PLAN_CONFIRMED_AT_SQL).get(date) as { confirmed_at: unknown } | undefined | null;
    return {
        date,
        timeZone,
        routineTitle: routineTitleRow ? String(routineTitleRow.title) : null,
        confirmedAt: dayPlanRow ? asString(dayPlanRow.confirmed_at) : null,
        activities,
    };
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

/**
 * GET /v1/tdah/day/tomorrow — story 3.3, T-06's morning editor. Same shape as
 * `getTodayDayPlan` above, but reads/materializes tomorrow's DayPlan
 * (`computeTomorrowDate`, AD-6) instead of today's — it never generates
 * *today's* plan, and it never regenerates tomorrow's if it already exists
 * (the same `tdah_day_plan.date` PRIMARY KEY makes `mutateGenerateTomorrowIfMissing`
 * a no-op either way, exactly like the nightly scheduler's own generate step).
 */
export async function getTomorrowDayPlan(
    dataDir: string,
    key: string,
    timeZone: string,
): Promise<TdahDayPlanView> {
    const databasePath = tdahDatabasePath(dataDir, key);
    const date = computeTomorrowDate(timeZone);
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

/**
 * GET /v1/tdah/limbo — story 3.4, T-08. Every Actividad in `state = 'limbo'`
 * across every day, oldest first (`SELECT_LIMBO_ACTIVITIES_SQL` above). Never
 * auto-generates anything (unlike `getTodayDayPlan`/`getTomorrowDayPlan`) —
 * there is nothing to materialize here, only a query — and a read must never
 * plant the namespace's tdah directory on disk (same rule
 * `listRoutinesWithBlocks` already follows), so a namespace with no database
 * yet simply has an empty Limbo.
 */
export async function getLimboActivities(dataDir: string, key: string): Promise<TdahActivity[]> {
    const databasePath = tdahDatabasePath(dataDir, key);
    if (!existsSync(databasePath)) return [];
    return await withReadDatabase(databasePath, (database) => (
        prepareAll<TdahActivityRow>(database, SELECT_LIMBO_ACTIVITIES_SQL).all().map(rowToActivity)
    ));
}

// --- History / Metrics (story 3.5) ------------------------------------------

type TdahHistoryCandidateRow = TdahActivityRow & { routine_title: unknown };

/**
 * "Completada a tiempo" (Boundaries & Constraints): `state === 'completed'`
 * AND the LOCAL calendar date of `completedAt`, in the caller's own profile
 * time zone, equals `dayPlanDate`. Deliberately JS (`formatDateInTimeZone`),
 * never SQLite's `date()`/`strftime()` — those only understand UTC or a
 * fixed numeric offset, not an IANA zone's actual (DST-aware) rules, so this
 * comparison can never be pushed into the SQL query itself. `completedAt`
 * being `null` here would only ever happen for a `missed`/`limbo` row (never
 * a `completed` one — see `UPDATE_ACTIVITY_COMPLETE_SQL`), so the `null`
 * guard is defensive, not a real production path.
 */
const isCompletedOnTime = (activity: TdahActivity, timeZone: string): boolean => (
    activity.state === 'completed'
    && activity.completedAt !== null
    && formatDateInTimeZone(new Date(activity.completedAt), timeZone) === activity.dayPlanDate
);

export type TdahGetHistoryOptions = {
    from: string;
    to: string;
    origin?: TdahActivityOrigin;
    routineId?: number;
    timeZone: string;
};

/**
 * GET /v1/tdah/history — story 3.5, T-09. `from`/`to` arrive already resolved
 * (routes.ts: either the validated `custom` bounds, or a `computeRollingRange`
 * preset computed from the caller's own profile time zone) — this function
 * never computes "today" itself, unlike `getTodayDayPlan`/`getTomorrowDayPlan`
 * above. Reads `SELECT_HISTORY_CANDIDATES_SQL`'s full missed/limbo/completed
 * candidate set for the range, then drops every `completed` row that was ON
 * TIME (`isCompletedOnTime` above) — those never belong in the Historial
 * (Boundaries & Constraints: "el Historial muestra... completadas tarde", not
 * every completion). The remaining rows are already ordered most-recent-first
 * by the SQL itself, so no re-sort is needed here.
 *
 * Never plants the namespace's tdah directory on disk for a namespace with no
 * database yet — same read-only contract `getLimboActivities` above follows.
 */
export async function getHistory(
    dataDir: string,
    key: string,
    options: TdahGetHistoryOptions,
): Promise<TdahHistoryEntry[]> {
    const databasePath = tdahDatabasePath(dataDir, key);
    if (!existsSync(databasePath)) return [];
    const originParam = options.origin ?? null;
    const routineIdParam = options.routineId ?? null;
    return await withReadDatabase(databasePath, (database) => {
        const rows = prepareAll<TdahHistoryCandidateRow>(database, SELECT_HISTORY_CANDIDATES_SQL)
            .all(options.from, options.to, originParam, originParam, routineIdParam, routineIdParam);
        const entries: TdahHistoryEntry[] = [];
        for (const row of rows) {
            const activity = rowToActivity(row);
            const completedLate = activity.state === 'completed' && !isCompletedOnTime(activity, options.timeZone);
            // A same-day `completed` Actividad is excluded outright — it never
            // appears in the Historial (Boundaries & Constraints).
            if (activity.state === 'completed' && !completedLate) continue;
            entries.push({
                activity,
                routineTitle: row.routine_title === null || row.routine_title === undefined ? null : String(row.routine_title),
                completedLate,
            });
        }
        return entries;
    });
}

// Story 3.5 — Metrics' own always-rolling trend window: 8 weeks (56 days)
// ending "today", independent of whatever `period` the caller requested for
// the KPI (Boundaries & Constraints).
const TDAH_METRICS_TREND_WEEKS = 8;
const TDAH_METRICS_TREND_WINDOW_DAYS = TDAH_METRICS_TREND_WEEKS * 7;

/**
 * Buckets `rows` (already classified `isCompletedOnTime`) into
 * `TDAH_METRICS_TREND_WEEKS` consecutive 7-day windows starting at
 * `trendRange.from`, oldest week first — the last bucket's own last day
 * always equals `trendRange.to` ("hoy"), since `trendRange` is itself exactly
 * `TDAH_METRICS_TREND_WINDOW_DAYS` days wide. Called with `rows: []` for a
 * namespace with no database yet, yielding 8 all-zero/`null`-rate points
 * rather than a separate empty-state builder.
 */
const buildMetricsTrend = (
    trendRange: { from: string; to: string },
    rows: Array<{ activity: TdahActivity; completedOnTime: boolean }>,
): TdahMetricsTrendPoint[] => {
    const points: TdahMetricsTrendPoint[] = [];
    for (let week = 0; week < TDAH_METRICS_TREND_WEEKS; week += 1) {
        const weekStart = shiftDateString(trendRange.from, week * 7);
        const weekEnd = shiftDateString(weekStart, 6);
        const weekRows = rows.filter((row) => row.activity.dayPlanDate >= weekStart && row.activity.dayPlanDate <= weekEnd);
        const total = weekRows.length;
        const completedOnTime = weekRows.filter((row) => row.completedOnTime).length;
        points.push({ weekStart, completedOnTime, total, rate: total === 0 ? null : completedOnTime / total });
    }
    return points;
};

export type TdahGetMetricsOptions = {
    from: string;
    to: string;
    timeZone: string;
};

/**
 * GET /v1/tdah/metrics — story 3.5, T-10. `from`/`to` are the requested KPI
 * period (already resolved by routes.ts, same convention as `getHistory`
 * above); the trend window is always its own independent 56-day rolling
 * range ending "today" (`computeRollingRange`, this function's own `now`).
 *
 * Reads `SELECT_METRICS_CANDIDATES_SQL` — one query holding BOTH windows as
 * two separate `BETWEEN` predicates, never the hull between them, so a
 * `custom` period sitting far in the past cannot turn this into a scan from
 * that date to today. Then classifies every row once (`isCompletedOnTime`)
 * and slices the in-memory result twice: once against `[from, to]` for the
 * KPI/`byOrigin` numbers, once against the trend range for `trend`. Never a
 * precomputed/persisted aggregate (AD-13).
 */
export async function getMetrics(
    dataDir: string,
    key: string,
    options: TdahGetMetricsOptions,
): Promise<TdahMetricsResponse> {
    const databasePath = tdahDatabasePath(dataDir, key);
    const period = { from: options.from, to: options.to };
    const trendRange = computeRollingRange(options.timeZone, TDAH_METRICS_TREND_WINDOW_DAYS);
    const emptyByOrigin: TdahMetricsOriginBreakdown[] = TDAH_ACTIVITY_ORIGINS.map((origin) => ({ origin, completedOnTime: 0, total: 0 }));
    if (!existsSync(databasePath)) {
        return { period, completedOnTime: 0, total: 0, rate: null, byOrigin: emptyByOrigin, trend: buildMetricsTrend(trendRange, []) };
    }
    return await withReadDatabase(databasePath, (database) => {
        const rows = prepareAll<TdahActivityRow>(database, SELECT_METRICS_CANDIDATES_SQL)
            .all(period.from, period.to, trendRange.from, trendRange.to);
        const classified = rows.map((row) => {
            const activity = rowToActivity(row);
            return { activity, completedOnTime: isCompletedOnTime(activity, options.timeZone) };
        });

        const periodRows = classified.filter((row) => row.activity.dayPlanDate >= period.from && row.activity.dayPlanDate <= period.to);
        const total = periodRows.length;
        const completedOnTime = periodRows.filter((row) => row.completedOnTime).length;
        const rate = total === 0 ? null : completedOnTime / total;
        const byOrigin: TdahMetricsOriginBreakdown[] = TDAH_ACTIVITY_ORIGINS.map((origin) => {
            const originRows = periodRows.filter((row) => row.activity.origin === origin);
            return {
                origin,
                completedOnTime: originRows.filter((row) => row.completedOnTime).length,
                total: originRows.length,
            };
        });

        const trendRows = classified.filter((row) => row.activity.dayPlanDate >= trendRange.from && row.activity.dayPlanDate <= trendRange.to);
        const trend = buildMetricsTrend(trendRange, trendRows);

        return { period, completedOnTime, total, rate, byOrigin, trend };
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

/**
 * POST /v1/tdah/day/tomorrow/activities — story 3.3, T-06's "Agregar manual"
 * CTA (reusing T-02's create flow). Unlike every other T-06 edit
 * (reorder/hora/duración/eliminar, all borrador-local until confirm), this
 * persists immediately — the same "always-immediate" contract
 * `createManualActivity` already gives today, just targeting tomorrow's
 * DayPlan (`computeTomorrowDate`) via the same date-generic
 * `mutateCreateManualActivity` body.
 */
export async function createManualActivityForTomorrow(
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
    const date = computeTomorrowDate(timeZone);
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

export type TdahActivityDecideResult =
    | { kind: 'notFound' }
    | { kind: 'rejected' }
    | { kind: 'ok'; activity: TdahActivity };

/**
 * Story 3.2 — T-05's decision-chip mutation. Every branch only ever
 * transitions a `missed`/`limbo` Activity; any other current state is
 * `rejected` (routes.ts turns that into 400 `TDAH_ACTIVITY_INVALID`) UNLESS
 * it's an AD-7 idempotent retry that already landed exactly on the requested
 * outcome, in which case it's a 200 no-op — mirroring
 * `mutateTransitionActivityState`'s own "already at target state" shortcut,
 * just checked against `dayPlanDate` too for the two move decisions.
 *
 * `undated` never writes (see `TdahActivityDecideRequest`'s doc comment in
 * types.ts for why) but still enforces the same missed/limbo eligibility gate
 * as the other three, so it can't be used to "no-op past" an ineligible
 * current state (e.g. an already-`completed` Activity).
 *
 * `move-tomorrow`/`move-date` re-resolve and re-validate their destination
 * date on every call, including a retry — a date that was invalid on the
 * first call is never legitimized by that first call having failed, since a
 * genuinely successful first call could only ever have landed on a valid
 * date in the first place.
 */
const mutateDecideActivity = (
    database: TdahDatabase,
    activityId: number,
    request: TdahActivityDecideRequest,
    timeZone: string,
): TdahActivityDecideResult => {
    const activity = selectActivityById(database, activityId);
    if (!activity) return { kind: 'notFound' };

    if (request.decision === 'undated') {
        if (activity.state !== 'missed' && activity.state !== 'limbo') return { kind: 'rejected' };
        return { kind: 'ok', activity };
    }

    if (request.decision === 'discard') {
        if (activity.state === 'discarded') return { kind: 'ok', activity };
        if (activity.state !== 'missed' && activity.state !== 'limbo') return { kind: 'rejected' };
        database.prepare(UPDATE_ACTIVITY_DECIDE_DISCARD_SQL).run(activityId);
        const updated = selectActivityById(database, activityId);
        if (!updated) throw new Error('TDAH activity readback failed after discard');
        return { kind: 'ok', activity: updated };
    }

    // Story 3.4 — T-08's "completar tardíamente": reuses
    // UPDATE_ACTIVITY_COMPLETE_SQL verbatim (the same write
    // `mutateTransitionActivityState`'s `complete` action uses), just gated
    // by the missed/limbo eligibility every decision here shares, rather than
    // the pending/started gate the plain `complete` action enforces — that
    // action explicitly rejects a `limbo` origin, which is exactly why this
    // decision exists as its own path instead of reusing it. Idempotent the
    // same way `discard` is above: a retry that already landed on
    // `state:'completed'` is a 200 no-op, never a rewrite.
    if (request.decision === 'complete-late') {
        if (activity.state === 'completed') return { kind: 'ok', activity };
        if (activity.state !== 'missed' && activity.state !== 'limbo') return { kind: 'rejected' };
        database.prepare(UPDATE_ACTIVITY_COMPLETE_SQL).run(new Date().toISOString(), activityId);
        const updated = selectActivityById(database, activityId);
        if (!updated) throw new Error('TDAH activity readback failed after complete-late');
        return { kind: 'ok', activity: updated };
    }

    // move-tomorrow / move-date: destination day must be strictly after
    // "today" in the caller's own profile time zone (AD-6) — `computeTomorrowDate`
    // always satisfies this by construction, so the check only ever actually
    // rejects a `move-date` target.
    const today = formatDateInTimeZone(new Date(), timeZone);
    const targetDate = request.decision === 'move-tomorrow' ? computeTomorrowDate(timeZone) : request.date;
    if (targetDate <= today) return { kind: 'rejected' };

    // AD-7 idempotency: already a fresh, never-started pending Activity on
    // this exact destination day — a raced double-tap responds 200 without
    // rewriting, never a rejection. Compared against `>= today` rather than
    // `=== targetDate`: the ritual runs close to local midnight, so a retry
    // can realistically land after local midnight has rolled over between
    // the original call and the retry. When that happens, `today` (and thus
    // `targetDate` for move-tomorrow, which is always "today + 1") has
    // itself advanced by one day, so the activity's actual `dayPlanDate`
    // (set by the original, successful call) now equals the *new* `today`
    // instead of the freshly recomputed `targetDate` — a strict `===`
    // comparison would wrongly treat that legitimate retry as a fresh,
    // ineligible request and 400 it. `>= today` still requires the activity
    // to be parked on-or-after "now", so a genuinely stale/unrelated
    // Activity (dayPlanDate in the past) is never matched here.
    //
    // This is deliberately checked ahead of the missed/limbo eligibility
    // check below — not because eligibility could safely run first (a
    // retry's current state is already this decision's *outcome*, e.g.
    // `pending`, so eligibility alone can never recognize a retry) — and it
    // can, in theory, also match an Activity that was never missed/limbo but
    // happens to already sit in this exact shape (e.g. a routine-generated
    // Activity for tomorrow, or any ordinary pending Activity already dated
    // today/later — there is no persisted signal distinguishing a genuine
    // retry from a coincidentally-shaped one). That's unreachable through
    // the real UI (which only ever calls decide on a missed/limbo id) and
    // writes nothing, so it's accepted as a known, low-risk limitation
    // rather than solved with new persisted state.
    const alreadyApplied = activity.state === 'pending'
        && activity.dayPlanDate >= today
        && activity.startedAt === null
        && activity.completedAt === null;
    if (alreadyApplied) return { kind: 'ok', activity };

    if (activity.state !== 'missed' && activity.state !== 'limbo') {
        return { kind: 'rejected' };
    }

    // Materialize the destination day's tdah_day_plan (and its own routine
    // Bloques, if any apply there) before the cap check — same order
    // `mutateCreateManualActivity` already uses, so a bootstrap write still
    // happens even on the over-cap rejection path.
    mutateGenerateTomorrowIfMissing(database, targetDate);
    const countRow = database.prepare(COUNT_ACTIVITIES_FOR_DAY_PLAN_SQL).get(targetDate) as { count: unknown };
    if (Number(countRow.count) >= TDAH_DAY_MAX_ACTIVITIES) {
        return { kind: 'rejected' };
    }
    database.prepare(UPDATE_ACTIVITY_DECIDE_MOVE_SQL).run(targetDate, new Date().toISOString(), activityId);
    const updated = selectActivityById(database, activityId);
    if (!updated) throw new Error('TDAH activity readback failed after decide');
    return { kind: 'ok', activity: updated };
};

/** POST /v1/tdah/activities/:id/decide — see `mutateDecideActivity` for the idempotency/rejection/date rules. */
export async function decideActivity(
    dataDir: string,
    key: string,
    activityId: number,
    request: TdahActivityDecideRequest,
    timeZone: string,
): Promise<TdahActivityDecideResult> {
    const databasePath = tdahDatabasePath(dataDir, key);
    if (!existsSync(databasePath)) return { kind: 'notFound' };
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    return await withWriteTransaction(databasePath, (database) => mutateDecideActivity(database, activityId, request, timeZone));
}

export type TdahLimboDecideBatchResult =
    | { kind: 'rejected' }
    | { kind: 'ok'; activities: TdahActivity[] };

/**
 * POST /v1/tdah/limbo/decide — story 3.4, T-08's batch decision bar.
 * Precedent: `mutateConfirmMorning` below — validate the whole requested set
 * before writing anything, never a loop of `mutateDecideActivity` calls with
 * a partial-failure midway.
 *
 * `activityIds.length` is already bounded at `TDAH_DAY_MAX_ACTIVITIES` by
 * `parseLimboDecideBatchBody` (routes.ts, review fix) before this ever runs —
 * this function trusts that cap rather than re-checking it, the same
 * division of responsibility `mutateConfirmMorning`'s own doc comment
 * describes for its `startTime`/`durationMinutes` shape validation. Without
 * that upstream cap, the `WHERE id IN (?, ?, …)` placeholder list below is
 * sized directly off the request and would risk SQLite's own
 * bound-parameter limit on an oversized batch — the Limbo tray has no
 * natural ceiling of its own (FR-9: nothing is ever evicted by age).
 *
 * 1. Dedup `activityIds`, then `SELECT` which of those ids are currently
 *    `state = 'limbo'`. If that resulting set doesn't cover every deduped id
 *    (one never existed, already got decided from T-05/another T-08 tap,
 *    etc.), the whole batch is `rejected` — nothing is written.
 * 2. `discard`/`complete-late` have no further eligibility to check (every id
 *    already confirmed `limbo` above), so they just apply their write to
 *    every id in the batch.
 * 3. `move-tomorrow`/`move-date` re-resolve the destination date exactly like
 *    `mutateDecideActivity` (rejecting a target on-or-before "today"), then
 *    check the destination day has enough cap headroom for the *whole* batch
 *    at once (`current count + batch size <= TDAH_DAY_MAX_ACTIVITIES`) before
 *    writing a single row — the same "exceeds cupo a mitad" scenario the I/O
 *    Matrix calls out is caught here, ahead of any write, rather than letting
 *    some ids succeed and others fail partway through.
 */
const mutateDecideLimboBatch = (
    database: TdahDatabase,
    activityIds: number[],
    decision: TdahLimboDecideBatchRequest['decision'],
    timeZone: string,
): TdahLimboDecideBatchResult => {
    const uniqueIds = [...new Set(activityIds)];
    if (uniqueIds.length === 0) return { kind: 'rejected' };

    const placeholders = uniqueIds.map(() => '?').join(', ');
    const limboRows = prepareAll<{ id: unknown }>(
        database,
        `SELECT id FROM tdah_activity WHERE state = 'limbo' AND id IN (${placeholders});`,
    ).all(...uniqueIds);
    // `limboRows` is a subset of `uniqueIds` by construction (the `IN`
    // clause), so a matching count is sufficient proof every deduped id is
    // covered — no need to diff the two sets member-by-member.
    if (limboRows.length !== uniqueIds.length) return { kind: 'rejected' };

    if (decision.decision === 'discard') {
        for (const id of uniqueIds) {
            database.prepare(UPDATE_ACTIVITY_DECIDE_DISCARD_SQL).run(id);
        }
    } else if (decision.decision === 'complete-late') {
        const completedAt = new Date().toISOString();
        for (const id of uniqueIds) {
            database.prepare(UPDATE_ACTIVITY_COMPLETE_SQL).run(completedAt, id);
        }
    } else {
        const today = formatDateInTimeZone(new Date(), timeZone);
        const targetDate = decision.decision === 'move-tomorrow' ? computeTomorrowDate(timeZone) : decision.date;
        if (targetDate <= today) return { kind: 'rejected' };
        mutateGenerateTomorrowIfMissing(database, targetDate);
        const countRow = database.prepare(COUNT_ACTIVITIES_FOR_DAY_PLAN_SQL).get(targetDate) as { count: unknown };
        if (Number(countRow.count) + uniqueIds.length > TDAH_DAY_MAX_ACTIVITIES) return { kind: 'rejected' };
        const movedAt = new Date().toISOString();
        for (const id of uniqueIds) {
            database.prepare(UPDATE_ACTIVITY_DECIDE_MOVE_SQL).run(targetDate, movedAt, id);
        }
    }

    const activities = uniqueIds.map((id) => {
        const activity = selectActivityById(database, id);
        if (!activity) throw new Error('TDAH activity readback failed after limbo batch decide');
        return activity;
    });
    return { kind: 'ok', activities };
};

/** POST /v1/tdah/limbo/decide — see `mutateDecideLimboBatch` for the atomicity/eligibility rules `result.kind` encodes. */
export async function decideLimboBatch(
    dataDir: string,
    key: string,
    request: TdahLimboDecideBatchRequest,
    timeZone: string,
): Promise<TdahLimboDecideBatchResult> {
    const databasePath = tdahDatabasePath(dataDir, key);
    // No database yet means no Actividad has ever reached `limbo` in this
    // namespace — every requested id necessarily fails the eligibility check
    // `mutateDecideLimboBatch` would otherwise run, so this short-circuits to
    // the same `rejected` outcome without planting the tdah directory on disk.
    if (!existsSync(databasePath)) return { kind: 'rejected' };
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    return await withWriteTransaction(databasePath, (database) => (
        mutateDecideLimboBatch(database, request.activityIds, request.decision, timeZone)
    ));
}

// --- Morning editor / confirm (story 3.3, T-06/T-07) ------------------------

// Eligibility (Design Notes: "el confirm es una sobrescritura completa"):
// only an Actividad that is BOTH on tomorrow's own DayPlan AND still
// `state:'pending'` may appear in a confirm payload, as a survivor
// (`activities`) or a deletion (`deletedActivityIds`) — the same set backs
// both the exact-accounting check and the per-id eligibility check below, so
// an id from another day/namespace, or one that is no longer `pending`
// (already started/completed/missed/limbo/discarded), can never sneak
// through either list.
const SELECT_ELIGIBLE_MORNING_ACTIVITY_IDS_SQL = "SELECT id FROM tdah_activity WHERE day_plan_date = ? AND state = 'pending';";
const UPDATE_ACTIVITY_MORNING_EDIT_SQL = 'UPDATE tdah_activity SET start_time = ?, duration_minutes = ?, sort_order = ? WHERE id = ?;';
const DELETE_ACTIVITY_BY_ID_SQL = 'DELETE FROM tdah_activity WHERE id = ?;';
const UPDATE_DAY_PLAN_CONFIRMED_AT_SQL = 'UPDATE tdah_day_plan SET confirmed_at = ? WHERE date = ?;';

export type TdahConfirmMorningResult =
    | { kind: 'rejected' }
    | { kind: 'ok'; day: TdahDayPlanView };

/**
 * `POST /v1/tdah/day/tomorrow/confirm`'s single grouped-persist (story 3.3,
 * Design Notes: "el confirm es una sobrescritura completa, nunca un diff
 * implícito"). Validates fully before writing anything, so a rejected
 * payload never applies partially (I/O Matrix: "transacción completa
 * rechazada"):
 *
 * 1. Exact accounting — `activities.length + deletedActivityIds.length` must
 *    equal the day's current eligible (`pending`) Actividad count. A
 *    desynced client (one that missed an Actividad another device already
 *    added/removed) can never silently drop or duplicate rows this way.
 * 2. Per-id eligibility — every id in either list must be one of those
 *    eligible ids, and no id may repeat across (or within) the two lists.
 *
 * `startTime`/`durationMinutes` format (HH:mm / 0-`TDAH_BLOCK_DURATION_MAX_MINUTES`)
 * is already validated by routes.ts's request parser before this ever runs —
 * the same division of responsibility `mutateCreateManualActivity` already
 * relies on for its own `input.startTime`/`input.durationMinutes`, so this
 * function trusts its `request` shape the same way.
 *
 * Once validated, every survivor in `activities` is written with its array
 * index as the confirmed `sort_order` (the draft's final drag order), every
 * id in `deletedActivityIds` is deleted, and `tdah_day_plan.confirmed_at` is
 * stamped — all inside the caller's held transaction, so a crash mid-write
 * rolls back to the pre-confirm state. Re-running the exact same payload is
 * naturally idempotent (Design Notes): the second run's eligible-id set still
 * matches 1:1 (the survivors are still `pending`, still on this day), so it
 * re-applies the identical writes rather than erroring.
 */
export const mutateConfirmMorning = (
    database: TdahDatabase,
    date: string,
    request: TdahConfirmMorningRequest,
    timeZone: string,
): TdahConfirmMorningResult => {
    const eligibleRows = prepareAll<{ id: unknown }>(database, SELECT_ELIGIBLE_MORNING_ACTIVITY_IDS_SQL).all(date);
    const eligibleIds = new Set(eligibleRows.map((row) => Number(row.id)));

    if (request.activities.length + request.deletedActivityIds.length !== eligibleIds.size) {
        return { kind: 'rejected' };
    }

    const seenIds = new Set<number>();
    for (const entry of request.activities) {
        if (!eligibleIds.has(entry.id) || seenIds.has(entry.id)) return { kind: 'rejected' };
        seenIds.add(entry.id);
    }
    for (const id of request.deletedActivityIds) {
        if (!eligibleIds.has(id) || seenIds.has(id)) return { kind: 'rejected' };
        seenIds.add(id);
    }

    request.activities.forEach((entry, index) => {
        database.prepare(UPDATE_ACTIVITY_MORNING_EDIT_SQL).run(entry.startTime, entry.durationMinutes, index, entry.id);
    });
    for (const id of request.deletedActivityIds) {
        database.prepare(DELETE_ACTIVITY_BY_ID_SQL).run(id);
    }
    database.prepare(UPDATE_DAY_PLAN_CONFIRMED_AT_SQL).run(new Date().toISOString(), date);

    return { kind: 'ok', day: selectDayPlanView(database, date, timeZone) };
};

/**
 * POST /v1/tdah/day/tomorrow/confirm — see `mutateConfirmMorning` for the
 * exact accounting/eligibility/idempotency rules `result.kind` encodes. Only
 * ever targets tomorrow's own DayPlan (`computeTomorrowDate`, AD-6), the same
 * date T-06 read from `GET .../tomorrow` — a confirm payload built from a
 * stale "tomorrow" (the caller waited past local midnight) simply fails the
 * exact-accounting check above against the now-different day's Actividades,
 * the same "no partial application" guarantee every other mismatch hits.
 */
export async function confirmMorning(
    dataDir: string,
    key: string,
    request: TdahConfirmMorningRequest,
    timeZone: string,
): Promise<TdahConfirmMorningResult> {
    const databasePath = tdahDatabasePath(dataDir, key);
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    const date = computeTomorrowDate(timeZone);
    return await withWriteTransaction(databasePath, (database) => mutateConfirmMorning(database, date, request, timeZone));
}

// --- Origen de trabajo (story 4.1, T-13) ------------------------------------

/** Default work window and cadence when a first connection omits them (doc 06 zone 3: "cada 2h en horario laboral"). */
export const TDAH_WORK_ORIGIN_DEFAULT_WORK_START = '09:00';
export const TDAH_WORK_ORIGIN_DEFAULT_WORK_END = '18:00';
export const TDAH_WORK_ORIGIN_DEFAULT_PULL_INTERVAL_MINUTES = 120;
/** Bounded on both ends: below 5 minutes this would hammer Atlassian, above a day it would never fire inside one work window. */
export const TDAH_WORK_ORIGIN_MIN_PULL_INTERVAL_MINUTES = 5;
export const TDAH_WORK_ORIGIN_MAX_PULL_INTERVAL_MINUTES = 1440;
/** Same DW-2 bounding discipline the Rutina/Actividad inputs already follow — remote and user input alike land in our own SQLite. */
export const TDAH_WORK_ORIGIN_MAX_EMAIL_LENGTH = 254;
export const TDAH_WORK_ORIGIN_MAX_TOKEN_LENGTH = 4096;
/** Cap on the persisted snapshot, mirroring the provider's own per-request ceiling. */
export const TDAH_WORK_ORIGIN_MAX_ITEMS = 50;
/**
 * The band's title — count-free (the count lives in the snapshot the UI
 * renders separately) and, importantly, LANGUAGE-NEUTRAL.
 *
 * This string is written verbatim into `tdah_activity.title` and rendered as-is
 * in Hoy, Historial and Métricas for all 20 locales — the title column is user
 * data, not a translatable key, so whatever goes in here is what every user
 * sees regardless of their language. "Sprint" is the term the epic's own band
 * copy already uses and reads the same in every locale the product ships;
 * a Spanish word here would have been untranslatable copy smuggled in through
 * a data column.
 */
export const TDAH_WORK_ORIGIN_BAND_TITLE = 'Sprint';

const SELECT_WORK_ORIGIN_SQL = `
    SELECT provider, site_url, account_email, jql, work_start, work_end, pull_interval_minutes,
           connected_at, last_pull_at, last_sync_at, last_error_code
    FROM tdah_work_origin WHERE id = 1;
`;
// Deliberately its own statement, selecting the sealed column and nothing
// else. `SELECT_WORK_ORIGIN_SQL` above — the one every response path uses —
// cannot name `secret_sealed` at all, so no read that feeds a Response can
// carry it even by accident (AD-9).
const SELECT_WORK_ORIGIN_SECRET_SQL = 'SELECT secret_sealed FROM tdah_work_origin WHERE id = 1;';
const UPSERT_WORK_ORIGIN_SQL = `
    INSERT INTO tdah_work_origin (
        id, provider, site_url, account_email, secret_sealed, jql, work_start, work_end,
        pull_interval_minutes, connected_at, last_pull_at, last_sync_at, last_error_code, updated_at
    )
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        site_url = excluded.site_url,
        account_email = excluded.account_email,
        secret_sealed = excluded.secret_sealed,
        jql = excluded.jql,
        work_start = excluded.work_start,
        work_end = excluded.work_end,
        pull_interval_minutes = excluded.pull_interval_minutes,
        -- last_pull_at is the interval gate's left-hand side and is advanced
        -- on every ATTEMPT, failed ones included. Preserving it across a
        -- reconnection would mean that fixing a revoked token still leaves the
        -- user waiting out the whole (up to 24 h) interval before anything
        -- happens -- the exact opposite of what pressing "connect" promises.
        -- Clearing it makes a fresh or repaired connection due on the next
        -- eligible tick, which is what isPullIntervalElapsed's own
        -- "never pulled -> always due" rule already says.
        last_pull_at = NULL,
        -- Preserved when the identity is unchanged (the previous successful
        -- sync really did happen), reset by the caller when the tenant/account
        -- changes and the snapshot it described is discarded with it.
        last_sync_at = excluded.last_sync_at,
        -- A re-connection clears the previous failure: the user just proved a
        -- working credential against the live API, so leaving a stale
        -- "token inválido" banner on T-13 would be actively misleading.
        last_error_code = NULL,
        updated_at = excluded.updated_at;
`;
const SELECT_WORK_ORIGIN_EXISTS_SQL = 'SELECT 1 FROM tdah_work_origin WHERE id = 1 LIMIT 1;';
const DELETE_WORK_ORIGIN_SQL = 'DELETE FROM tdah_work_origin WHERE id = 1;';
const DELETE_WORK_ORIGIN_ITEMS_SQL = 'DELETE FROM tdah_work_origin_item;';
const SELECT_WORK_ORIGIN_ITEMS_SQL = 'SELECT external_key, summary, status, sprint_name FROM tdah_work_origin_item ORDER BY sort_order ASC, id ASC;';
const INSERT_WORK_ORIGIN_ITEM_SQL = 'INSERT INTO tdah_work_origin_item (external_key, summary, status, sprint_name, sort_order) VALUES (?, ?, ?, ?, ?);';
const UPDATE_WORK_ORIGIN_PULL_RESULT_SQL = `
    UPDATE tdah_work_origin
    SET last_pull_at = ?, last_sync_at = COALESCE(?, last_sync_at), last_error_code = ?, updated_at = ?
    WHERE id = 1;
`;
// The band is identified by (day, origin) alone — there is exactly one per
// local day by construction (Never: "una sola Actividad-franja por día").
const SELECT_WORK_ORIGIN_BAND_SQL = "SELECT id, state FROM tdah_activity WHERE day_plan_date = ? AND origin = 'jira' ORDER BY id ASC LIMIT 1;";
const UPDATE_WORK_ORIGIN_BAND_SQL = "UPDATE tdah_activity SET title = ?, start_time = ?, duration_minutes = ? WHERE id = ? AND state = 'pending';";
const DELETE_WORK_ORIGIN_BAND_SQL = "DELETE FROM tdah_activity WHERE id = ? AND state = 'pending';";
const INSERT_WORK_ORIGIN_BAND_SQL = `
    INSERT INTO tdah_activity (day_plan_date, block_id, title, start_time, duration_minutes, origin, state)
    VALUES (?, NULL, ?, ?, ?, 'jira', 'pending');
`;

type TdahWorkOriginRow = {
    provider: unknown;
    site_url: unknown;
    account_email: unknown;
    jql: unknown;
    work_start: unknown;
    work_end: unknown;
    pull_interval_minutes: unknown;
    connected_at: unknown;
    last_pull_at: unknown;
    last_sync_at: unknown;
    last_error_code: unknown;
};

type TdahWorkOriginItemRow = {
    external_key: unknown;
    summary: unknown;
    status: unknown;
    sprint_name: unknown;
};

/**
 * The disconnected state, shared by "no database yet", "no row", and "row
 * unreadable" so every one of them looks identical to the client.
 *
 * A FACTORY, never a shared constant: the returned object (and its `issues`
 * array) is serialized straight into a response and handed to callers across
 * every namespace. One shared instance would mean a single accidental mutation
 * anywhere leaking into every other user's disconnected response — a
 * cross-namespace bug waiting for its first careless `push`.
 */
const disconnectedWorkOriginStatus = (): TdahWorkOriginStatus => ({
    connected: false,
    provider: null,
    siteUrl: null,
    email: null,
    jql: null,
    workStart: null,
    workEnd: null,
    pullIntervalMinutes: null,
    connectedAt: null,
    lastSyncAt: null,
    lastErrorCode: null,
    issues: [],
});

const rowToWorkOriginItem = (row: TdahWorkOriginItemRow): TdahWorkOriginItem => ({
    externalKey: String(row.external_key),
    summary: String(row.summary),
    status: String(row.status),
    sprintName: asString(row.sprint_name),
});

const selectWorkOriginItems = (database: TdahDatabase): TdahWorkOriginItem[] => (
    prepareAll<TdahWorkOriginItemRow>(database, SELECT_WORK_ORIGIN_ITEMS_SQL).all().map(rowToWorkOriginItem)
);

const selectWorkOriginStatus = (database: TdahDatabase): TdahWorkOriginStatus => {
    const row = database.prepare(SELECT_WORK_ORIGIN_SQL).get() as TdahWorkOriginRow | undefined | null;
    if (!row) return disconnectedWorkOriginStatus();
    return {
        connected: true,
        provider: String(row.provider) as TdahWorkOriginProvider,
        siteUrl: String(row.site_url),
        email: String(row.account_email),
        jql: String(row.jql),
        workStart: String(row.work_start),
        workEnd: String(row.work_end),
        pullIntervalMinutes: Number(row.pull_interval_minutes),
        connectedAt: String(row.connected_at),
        lastSyncAt: asString(row.last_sync_at),
        lastErrorCode: asString(row.last_error_code) as TdahErrorCode | null,
        issues: selectWorkOriginItems(database),
    };
};

/**
 * GET /v1/tdah/origin's read. Returns the PUBLIC status only — the return type
 * itself has no token field, and the query behind it
 * (`SELECT_WORK_ORIGIN_SQL`) does not select `secret_sealed`, so this function
 * physically cannot carry the credential into a response.
 *
 * Never plants the namespace's tdah directory on disk for a namespace with no
 * database yet — the same read-only contract `getLimboActivities`/`getHistory`
 * already follow.
 */
export async function readWorkOriginStatus(dataDir: string, key: string): Promise<TdahWorkOriginStatus> {
    const databasePath = tdahDatabasePath(dataDir, key);
    if (!existsSync(databasePath)) return disconnectedWorkOriginStatus();
    return await withReadDatabase(databasePath, (database) => selectWorkOriginStatus(database));
}

/**
 * Everything the pull tick needs to decide whether to run and where to send
 * the request — and nothing else. In particular `lastPullAt` lives here
 * rather than on `TdahWorkOriginStatus`: it is scheduler bookkeeping (the
 * interval gate's left-hand side), not user-facing state, and T-13 renders
 * `lastSyncAt` — what actually succeeded — instead.
 *
 * `null` when nothing is connected, which the tick treats as `skipped`.
 */
export type TdahWorkOriginPullPlan = {
    provider: TdahWorkOriginProvider;
    siteUrl: string;
    email: string;
    workStart: string;
    workEnd: string;
    pullIntervalMinutes: number;
    lastPullAt: string | null;
};

export async function readWorkOriginPullPlan(dataDir: string, key: string): Promise<TdahWorkOriginPullPlan | null> {
    const databasePath = tdahDatabasePath(dataDir, key);
    if (!existsSync(databasePath)) return null;
    return await withReadDatabase(databasePath, (database) => {
        const row = database.prepare(SELECT_WORK_ORIGIN_SQL).get() as TdahWorkOriginRow | undefined | null;
        if (!row) return null;
        return {
            provider: String(row.provider) as TdahWorkOriginProvider,
            siteUrl: String(row.site_url),
            email: String(row.account_email),
            workStart: String(row.work_start),
            workEnd: String(row.work_end),
            pullIntervalMinutes: Number(row.pull_interval_minutes),
            lastPullAt: asString(row.last_pull_at),
        };
    });
}

/**
 * The sealed container, for the pull tick alone (`origin-pull.ts`). Returns
 * the ciphertext, NOT the token: opening it needs the operator's master key,
 * which this module never touches. `null` when nothing is connected.
 *
 * Kept as a separate exported function rather than a field on
 * `readWorkOriginStatus`'s result precisely so that "who can reach the
 * credential" is a one-line grep with exactly one production caller.
 */
export async function readSealedWorkOriginSecret(dataDir: string, key: string): Promise<string | null> {
    const databasePath = tdahDatabasePath(dataDir, key);
    if (!existsSync(databasePath)) return null;
    return await withReadDatabase(databasePath, (database) => {
        const row = database.prepare(SELECT_WORK_ORIGIN_SECRET_SQL).get() as { secret_sealed: unknown } | undefined | null;
        return row ? asString(row.secret_sealed) : null;
    });
}

export type TdahUpsertWorkOriginInput = {
    provider: TdahWorkOriginProvider;
    siteUrl: string;
    email: string;
    /**
     * Already sealed by the caller (`sealOriginSecret`) — this module never
     * sees the plaintext token.
     *
     * `undefined` means "keep whatever is stored": a settings-only PUT (the
     * user moved their working hours, nothing else) must not require them to
     * mint a fresh Atlassian API token just to change a time. Requires an
     * existing row, which the route guarantees before calling.
     */
    secretSealed?: string;
    jql: string;
    workStart: string;
    workEnd: string;
    pullIntervalMinutes: number;
};

/**
 * PUT /v1/tdah/origin's write. Takes the ALREADY-SEALED container: sealing
 * happens in the route, right where the plaintext arrives and dies, so no
 * storage function ever has a token in scope.
 *
 * `connected_at` is preserved across a re-connection — the Origen has been
 * connected since then, only the credential or the settings changed.
 *
 * `last_pull_at` is always cleared, so a repaired connection pulls on the next
 * eligible tick instead of waiting out the interval that the failed attempts
 * themselves advanced (see `UPSERT_WORK_ORIGIN_SQL`).
 *
 * Changing the tenant (`site_url`) or the account (`account_email`) discards
 * the snapshot and `last_sync_at` with it: those issue keys, summaries and
 * that timestamp describe a DIFFERENT Jira account, and continuing to serve
 * them from `GET /v1/tdah/origin` would show one tenant's work under another
 * tenant's connection. Re-pointing at the same site with the same account
 * (the ordinary "my token was revoked" case) keeps both.
 */
export async function upsertWorkOrigin(
    dataDir: string,
    key: string,
    input: TdahUpsertWorkOriginInput,
): Promise<TdahWorkOriginStatus> {
    const databasePath = tdahDatabasePath(dataDir, key);
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    const nowIso = new Date().toISOString();
    return await withWriteTransaction(databasePath, (database) => {
        const existingRow = database.prepare(SELECT_WORK_ORIGIN_SQL).get() as TdahWorkOriginRow | undefined | null;
        const existingSecretRow = database.prepare(SELECT_WORK_ORIGIN_SECRET_SQL).get() as { secret_sealed: unknown } | undefined | null;
        const existingSealed = existingSecretRow ? asString(existingSecretRow.secret_sealed) : null;

        const secretSealed = input.secretSealed ?? existingSealed;
        if (secretSealed === null) {
            // Unreachable through the route (it requires a token whenever no
            // row exists) — a guard so a future caller cannot create a
            // credential-less Origen row that the tick could never open.
            throw new Error('TDAH work origin upsert requires a sealed secret on first connection');
        }

        const identityChanged = existingRow !== null && existingRow !== undefined
            && (String(existingRow.site_url) !== input.siteUrl || String(existingRow.account_email) !== input.email);
        if (identityChanged) {
            database.prepare(DELETE_WORK_ORIGIN_ITEMS_SQL).run();
        }
        const lastSyncAt = existingRow && !identityChanged ? asString(existingRow.last_sync_at) : null;
        const connectedAt = existingRow ? String(existingRow.connected_at) : nowIso;

        database.prepare(UPSERT_WORK_ORIGIN_SQL).run(
            input.provider,
            input.siteUrl,
            input.email,
            secretSealed,
            input.jql,
            input.workStart,
            input.workEnd,
            input.pullIntervalMinutes,
            connectedAt,
            lastSyncAt,
            nowIso,
        );
        return selectWorkOriginStatus(database);
    });
}

/**
 * DELETE /v1/tdah/origin. Removes the credential and the snapshot, and
 * NOTHING else — in particular it never touches `tdah_activity`, so every
 * band already materialized stays exactly where it is and remains queryable
 * from the Historial (I/O Matrix; doc 06 zone 5: "las pasadas quedan en
 * Historial").
 *
 * Idempotent by construction: both DELETEs match zero rows on a namespace
 * that was never connected, which is why the route can answer 200 either way
 * without a pre-check.
 */
export async function deleteWorkOrigin(dataDir: string, key: string): Promise<void> {
    const databasePath = tdahDatabasePath(dataDir, key);
    // Nothing to delete, and a disconnect must never be the thing that plants
    // a database on disk.
    if (!existsSync(databasePath)) return;
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    await withWriteTransaction(databasePath, (database) => {
        database.prepare(DELETE_WORK_ORIGIN_ITEMS_SQL).run();
        database.prepare(DELETE_WORK_ORIGIN_SQL).run();
    });
}

/**
 * Wholesale replacement of the snapshot — delete-all then insert, never a
 * merge. The remote sprint is the source of truth; an issue that dropped out
 * of the JQL simply stops existing here, with no tombstone to reason about.
 * `sortOrder` is the array index, so the provider's own `ORDER BY updated ASC`
 * survives into the rendered sub-rows.
 *
 * Takes an already-open handle (like `mutateGenerateTomorrowIfMissing`) so the
 * pull tick can run this, the pull-result stamp and the band materialization
 * inside ONE transaction — a crash between them must never leave a snapshot
 * that disagrees with `last_sync_at`.
 */
export const mutateReplaceWorkOriginItems = (database: TdahDatabase, items: TdahWorkOriginItem[]): void => {
    database.prepare(DELETE_WORK_ORIGIN_ITEMS_SQL).run();
    items.slice(0, TDAH_WORK_ORIGIN_MAX_ITEMS).forEach((item, index) => {
        database.prepare(INSERT_WORK_ORIGIN_ITEM_SQL).run(item.externalKey, item.summary, item.status, item.sprintName, index);
    });
};

/**
 * Stamps the outcome of one pull attempt.
 *
 * `pulledAt` advances on EVERY attempt, success or failure — that is what
 * makes a broken Origen back off to its configured interval instead of
 * retrying on every 60s tick. `syncedAt` is `null` on failure and, thanks to
 * the `COALESCE` in the SQL, leaves the previous successful timestamp intact
 * rather than erasing it: T-13 must still be able to say "última
 * sincronización hace 3h" while showing today's error.
 *
 * `errorCode` is `null` on success, which is how a recovered Origen clears
 * its own banner without any separate "clear error" call.
 */
export const mutateMarkWorkOriginPullResult = (
    database: TdahDatabase,
    pulledAtIso: string,
    syncedAtIso: string | null,
    errorCode: TdahErrorCode | null,
): void => {
    database.prepare(UPDATE_WORK_ORIGIN_PULL_RESULT_SQL).run(pulledAtIso, syncedAtIso, errorCode, pulledAtIso);
};

/**
 * The grouped band (AC 3; Design Notes "Franja agrupada"): ONE Actividad per
 * local day standing for the whole imported sprint load, starting at
 * `workStart` and lasting until `workEnd`, with `block_id NULL`. No hour is
 * ever invented per task — the per-issue detail lives in the snapshot, which
 * story 4.2 renders as expandable sub-rows.
 *
 * Idempotency is the hard part, and it is resolved by state rather than by a
 * marker column:
 *
 * - No band yet -> insert one (respecting `TDAH_DAY_MAX_ACTIVITIES`, the same
 *   cap every other Activity-creating path honours).
 * - A band exists and is still `pending` -> update it in place. A changed work
 *   window on a later pull moves it; a second pull the same day never
 *   duplicates it.
 * - A band exists in ANY other state (`started`/`completed`/`missed`/`limbo`/
 *   `discarded`) -> left completely untouched. The user has already acted on
 *   it, and a background tick must never undo a person's decision (Block If:
 *   "materializar la franja obligara a romper el estado de una Actividad ya
 *   registrada").
 *
 * With `itemCount === 0` there is nothing to represent, so no band is created
 * (I/O Matrix: "sin sprint activo -> snapshot vacío, sin franja, sin error").
 * A band left over from an earlier pull that same day is removed, but only if
 * it is still `pending` — the same "never touch a decided Actividad" rule.
 *
 * The day plan itself is materialized on demand via
 * `mutateGenerateTomorrowIfMissing`, exactly as `mutateCreateManualActivity`
 * does, so the first pull of a day still applies that day's Rutina instead of
 * planting an empty plan that would block it forever.
 */
export type TdahWorkOriginBandOutcome =
    /** A band was inserted for this day. */
    | 'created'
    /** An existing still-`pending` band was refreshed in place. */
    | 'updated'
    /** The sprint emptied and this day's still-`pending` band was retired. */
    | 'removed'
    /** Nothing to do: no issues and no band to retire, or a band the user already acted on. */
    | 'none'
    /** The day is already at `TDAH_DAY_MAX_ACTIVITIES` — the band could NOT be created. */
    | 'capped';

export const mutateSyncWorkOriginBand = (
    database: TdahDatabase,
    date: string,
    itemCount: number,
    workStart: string,
    workEnd: string,
    title: string,
): TdahWorkOriginBandOutcome => {
    const existing = database.prepare(SELECT_WORK_ORIGIN_BAND_SQL).get(date) as { id: unknown; state: unknown } | undefined | null;

    if (itemCount <= 0) {
        if (existing && existing.state === 'pending') {
            database.prepare(DELETE_WORK_ORIGIN_BAND_SQL).run(Number(existing.id));
            return 'removed';
        }
        return 'none';
    }

    const durationMinutes = Math.max(0, startTimeToMinutes(workEnd) - startTimeToMinutes(workStart));

    if (existing) {
        if (existing.state !== 'pending') return 'none';
        // The `AND state = 'pending'` guard lives in the SQL too, so even a
        // read/write race cannot overwrite a band the user just started.
        database.prepare(UPDATE_WORK_ORIGIN_BAND_SQL).run(title, workStart, durationMinutes, Number(existing.id));
        return 'updated';
    }

    mutateGenerateTomorrowIfMissing(database, date);
    const countRow = database.prepare(COUNT_ACTIVITIES_FOR_DAY_PLAN_SQL).get(date) as { count: unknown };
    // Reported rather than swallowed: a silently dropped band leaves the user
    // with a fresh "última sincronización" and nothing on the day, and no way
    // to tell that from "the sprint is empty". The caller turns this into a
    // persisted `TDAH_ORIGIN_DAY_FULL`, which T-13 can act on.
    if (Number(countRow.count) >= TDAH_DAY_MAX_ACTIVITIES) return 'capped';
    database.prepare(INSERT_WORK_ORIGIN_BAND_SQL).run(date, title, workStart, durationMinutes);
    return 'created';
};

export type TdahCommitWorkOriginPullResult =
    /** The Origen was disconnected while this pull was in flight — nothing was written. */
    | { kind: 'disconnected' }
    | { kind: 'committed'; band: TdahWorkOriginBandOutcome };

/**
 * The pull tick's single held transaction: snapshot replacement, pull stamp
 * and band materialization together, so a crash can never commit one without
 * the others. Exported as one function (rather than three) precisely to make
 * that atomicity impossible to forget at the call site.
 *
 * It re-checks that the Origen row still exists INSIDE the transaction, and
 * writes nothing when it does not. That check is not defensive padding: a pull
 * blocks on the network for up to `TDAH_JIRA_REQUEST_TIMEOUT_MS`, and a
 * `DELETE /v1/tdah/origin` landing in that window would otherwise be undone by
 * the response that was already in flight — resurrecting the snapshot the user
 * just revoked and materializing a `jira` band for a namespace with no Origen
 * at all. Disconnect has to win that race; the read that decided to pull is
 * simply stale by the time it returns.
 *
 * `band === 'capped'` is committed as a SUCCESSFUL sync (the snapshot really
 * did refresh) that also carries `TDAH_ORIGIN_DAY_FULL`, so T-13 shows both
 * facts rather than pretending the day is fine.
 */
export async function commitWorkOriginPull(
    dataDir: string,
    key: string,
    options: {
        date: string;
        items: TdahWorkOriginItem[];
        pulledAtIso: string;
        workStart: string;
        workEnd: string;
        bandTitle: string;
    },
): Promise<TdahCommitWorkOriginPullResult> {
    const databasePath = tdahDatabasePath(dataDir, key);
    // A pull must never be the thing that plants a database on disk: no
    // database means no Origen row, which means the disconnect already won.
    if (!existsSync(databasePath)) return { kind: 'disconnected' };
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    return await withWriteTransaction(databasePath, (database) => {
        if (!database.prepare(SELECT_WORK_ORIGIN_EXISTS_SQL).get()) {
            return { kind: 'disconnected' } as TdahCommitWorkOriginPullResult;
        }
        mutateReplaceWorkOriginItems(database, options.items);
        const band = mutateSyncWorkOriginBand(
            database,
            options.date,
            options.items.length,
            options.workStart,
            options.workEnd,
            options.bandTitle,
        );
        mutateMarkWorkOriginPullResult(
            database,
            options.pulledAtIso,
            options.pulledAtIso,
            band === 'capped' ? TDAH_ERRORS.originDayFull : null,
        );
        return { kind: 'committed', band } as TdahCommitWorkOriginPullResult;
    });
}

/**
 * The failure counterpart of `commitWorkOriginPull`: records that an attempt
 * happened and why it failed, and touches nothing else. The credential is
 * NOT deleted (I/O Matrix: "el token no se borra" — a revoked token is
 * usually re-issued, and silently discarding it would force the user to
 * retype a site URL and email they never changed), the snapshot is NOT
 * cleared, and no Actividad changes state — the previous days' bands stay
 * exactly as they were.
 */
export async function markWorkOriginPullFailure(
    dataDir: string,
    key: string,
    pulledAtIso: string,
    errorCode: TdahErrorCode,
): Promise<void> {
    const databasePath = tdahDatabasePath(dataDir, key);
    if (!existsSync(databasePath)) return;
    const durableDir = ensureDurableDirectory(dirname(databasePath));
    if (!durableDir) {
        throw new Error('TDAH database directory is unsafe');
    }
    await withWriteTransaction(databasePath, (database) => {
        mutateMarkWorkOriginPullResult(database, pulledAtIso, null, errorCode);
    });
}

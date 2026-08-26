/**
 * TDAH module contract — the single source of truth for the profile API's
 * shapes and error codes. Server-only by design (ADR 0026): clients talk to
 * the HTTP surface, they never import these types across the wire boundary.
 */

export const TDAH_MODES = ['on', 'off'] as const;
export type TdahMode = (typeof TDAH_MODES)[number];

export const isTdahMode = (value: unknown): value is TdahMode => (
    value === 'on' || value === 'off'
);

export type TdahProfile = {
    mode: TdahMode;
    timeZone: string;
    ritualHour: string;
    createdAt: string;
    updatedAt: string;
};

/**
 * PUT /v1/tdah/profile body. Upsert semantics: creating a profile requires
 * `mode` and fills `ritualHour='23:00'` plus `timeZone` from the body
 * (fallback 'UTC'); updating preserves every field the body omits, so
 * reactivating after off never re-runs onboarding (FR-1).
 */
export type TdahProfileUpsertRequest = {
    mode?: TdahMode;
    timeZone?: string;
    ritualHour?: string;
};

export type TdahProfileResponse = {
    profile: TdahProfile | null;
};

/**
 * Story 1.3 — minimal Rutina/DayPlan/Actividad schema. Additive to the
 * profile table above; widened by story 1.4's `pattern_kind`
 * `PRAGMA user_version`-gated migration (v0→v1) to support a real
 * calendar-pattern precedence engine, reused as-is by story 1.5 (recurring
 * scheduler) rather than being reimplemented there.
 */
export const TDAH_ROUTINE_PATTERN_KINDS = ['weekday', 'nthWeekdayOfMonth'] as const;
export type TdahRoutinePatternKind = (typeof TDAH_ROUTINE_PATTERN_KINDS)[number];

/** Matches on a fixed set of weekdays (Sunday=0 … Saturday=6), any week of the month. */
export type TdahRoutineWeekdayPattern = {
    kind: 'weekday';
    weekdays: number[];
};

/**
 * Matches on the `ordinal`-th occurrence of `weekday` in the month —
 * `ordinal` is `1`-`4`, or `-1` for "last" ("último sábado" beats a generic
 * Saturday Rutina when both match a date; see `routineMatchesDate` in
 * storage.ts). Always outranks `weekday` in precedence (AD-5).
 */
export type TdahRoutineNthWeekdayPattern = {
    kind: 'nthWeekdayOfMonth';
    ordinal: number;
    weekday: number;
};

export type TdahRoutinePattern = TdahRoutineWeekdayPattern | TdahRoutineNthWeekdayPattern;

/** A Bloque-time-range overlap warning — non-blocking (UX spec: "aviso no bloqueante"). */
export type TdahRoutineOverlapWarning = {
    blockIndexA: number;
    blockIndexB: number;
};

/** A single Bloque whose `startTime + durationMinutes` crosses midnight — non-blocking, same shape as overlap. */
export type TdahRoutineMidnightWarning = {
    blockIndex: number;
};

export type TdahRoutineBlock = {
    id: number;
    routineId: number;
    title: string;
    startTime: string;
    durationMinutes: number;
    sortOrder: number;
};

/**
 * The full persisted Rutina, as returned by every routine response (list,
 * get, create, update): its calendar pattern, its ordered Bloques, and the
 * non-blocking warnings computed fresh from those Bloques on every read —
 * never persisted, always recomputed (AD-5: the server computes, the UI only
 * renders).
 */
export type TdahRoutine = {
    id: number;
    title: string;
    pattern: TdahRoutinePattern;
    createdAt: string;
    blocks: TdahRoutineBlock[];
    overlapWarnings: TdahRoutineOverlapWarning[];
    crossesMidnightWarnings: TdahRoutineMidnightWarning[];
};

export type TdahRoutineBlockInput = {
    title: string;
    startTime: string;
    durationMinutes: number;
};

/**
 * `pattern` is optional on input and defaults to the fixed Mon–Fri weekday
 * pattern (`{kind:'weekday', weekdays:[1,2,3,4,5]}`) when omitted — the same
 * default the v0→v1 migration backfills onto pre-1.4 rows. This keeps
 * `POST /activate`'s inline Rutina creation (story 1.3's mobile onboarding
 * shortcut, which never sends a `pattern`) working unchanged alongside the
 * new `/v1/tdah/routines` CRUD surface, which always sends one explicitly.
 */
export type TdahRoutineInput = {
    title: string;
    pattern?: TdahRoutinePattern;
    blocks: TdahRoutineBlockInput[];
};

export type TdahDayPlan = {
    date: string;
    generatedAt: string;
};

export const TDAH_ACTIVITY_ORIGINS = ['routine', 'manual'] as const;
export type TdahActivityOrigin = (typeof TDAH_ACTIVITY_ORIGINS)[number];

export const TDAH_ACTIVITY_STATES = ['pending', 'started', 'completed', 'missed', 'limbo', 'discarded'] as const;
export type TdahActivityState = (typeof TDAH_ACTIVITY_STATES)[number];

export type TdahActivity = {
    id: number;
    dayPlanDate: string;
    blockId: number | null;
    title: string;
    startTime: string;
    durationMinutes: number;
    origin: TdahActivityOrigin;
    state: TdahActivityState;
};

/**
 * POST /v1/tdah/activate body. Always turns the mode on (first activation or
 * reactivation) — `PUT /tdah/profile` remains the only way to turn it off.
 * `routine` is optional: omitting it skips Rutina creation and yields an
 * empty DayPlan (FR-3).
 */
export type TdahActivateRequest = {
    timeZone?: string;
    ritualHour?: string;
    routine?: TdahRoutineInput;
};

export type TdahActivateResponse = {
    profile: TdahProfile;
    routineCreated: boolean;
    dayPlan: {
        date: string;
        activityCount: number;
    };
};

/**
 * Story 1.5 — per-tick aggregate stats across every namespace scanned by
 * `runNightlyTdahTick` (scheduler.ts). Doubles as the scheduler's own audit
 * log context (`server-config.ts`'s `CLOUD_LOG_MESSAGES`) and as a typed
 * return value tests can assert against. Deliberately counts only — never a
 * namespace key or Activity title (AGENTS.md's existing `.code`-only rule
 * applies here too, since a namespace key is exactly the kind of identifying
 * detail that rule exists to keep out of logs).
 */
export type TdahNightlyTickSummary = {
    /** The tick's own reference date (UTC calendar day of `now`) — not any single namespace's local date, since namespaces can span time zones. */
    date: string;
    /** Namespaces with an existing TDAH database, scanned this tick. */
    namespaceCount: number;
    /** Namespaces that closed today and generated tomorrow this tick. */
    firedCount: number;
    /** Namespaces skipped this tick (mode off, ritual hour not yet reached, or tomorrow already generated). */
    skippedCount: number;
    /** Namespaces whose write transaction failed this tick — retried automatically next tick. */
    failedCount: number;
    /** Total Actividades created across every namespace that fired this tick. */
    generatedCount: number;
    /** Total Actividades moved to `limbo` across every namespace that fired this tick. */
    limboCount: number;
};

const TDAH_ERROR_CODES = {
    invalidBody: 'TDAH_INVALID_BODY',
    invalidTimeZone: 'TDAH_INVALID_TIME_ZONE',
    invalidRitualHour: 'TDAH_INVALID_RITUAL_HOUR',
    routineInvalid: 'TDAH_ROUTINE_INVALID',
    methodNotAllowed: 'TDAH_METHOD_NOT_ALLOWED',
    notFound: 'TDAH_NOT_FOUND',
    storageFailed: 'TDAH_STORAGE_FAILED',
    activateRequired: 'TDAH_ACTIVATE_REQUIRED',
} as const;

export type TdahErrorCode = (typeof TDAH_ERROR_CODES)[keyof typeof TDAH_ERROR_CODES];

export const TDAH_ERRORS = TDAH_ERROR_CODES;

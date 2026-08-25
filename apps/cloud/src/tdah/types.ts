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
 * profile table above; reused as-is by story 1.4 (CRUD/precedence) and 1.5
 * (recurring scheduler) rather than being reimplemented there.
 */
export const TDAH_ROUTINE_PATTERN_KINDS = ['weekday'] as const;
export type TdahRoutinePatternKind = (typeof TDAH_ROUTINE_PATTERN_KINDS)[number];

export type TdahRoutine = {
    id: number;
    title: string;
    patternKind: TdahRoutinePatternKind;
    createdAt: string;
};

export type TdahRoutineBlock = {
    id: number;
    routineId: number;
    title: string;
    startTime: string;
    durationMinutes: number;
    sortOrder: number;
};

export type TdahRoutineBlockInput = {
    title: string;
    startTime: string;
    durationMinutes: number;
};

/** Only the single "Día laboral" pattern is supported in this story. */
export type TdahRoutineInput = {
    title: string;
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

const TDAH_ERROR_CODES = {
    invalidBody: 'TDAH_INVALID_BODY',
    invalidTimeZone: 'TDAH_INVALID_TIME_ZONE',
    invalidRitualHour: 'TDAH_INVALID_RITUAL_HOUR',
    routineInvalid: 'TDAH_ROUTINE_INVALID',
    methodNotAllowed: 'TDAH_METHOD_NOT_ALLOWED',
    notFound: 'TDAH_NOT_FOUND',
    storageFailed: 'TDAH_STORAGE_FAILED',
} as const;

export type TdahErrorCode = (typeof TDAH_ERROR_CODES)[keyof typeof TDAH_ERROR_CODES];

export const TDAH_ERRORS = TDAH_ERROR_CODES;

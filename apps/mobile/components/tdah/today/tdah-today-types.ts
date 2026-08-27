/**
 * Wire-facing shapes for T-01/T-02 (story 1.6). Mirrors the
 * `GET /v1/tdah/day`, `POST /v1/tdah/day/activities`, and
 * `POST /v1/tdah/activities/:id/{start|complete|miss}` contracts by hand
 * rather than importing apps/cloud/src/tdah/types.ts (ADR 0026: clients talk
 * to the HTTP surface, never to server-only types across the wire boundary —
 * same convention as tdah-onboarding-types.ts).
 */

export const TDAH_ACTIVITY_ORIGINS = ['routine', 'manual'] as const;
export type TdahActivityOrigin = (typeof TDAH_ACTIVITY_ORIGINS)[number];

export const TDAH_ACTIVITY_STATES = ['pending', 'started', 'completed', 'missed', 'limbo', 'discarded'] as const;
export type TdahActivityState = (typeof TDAH_ACTIVITY_STATES)[number];

/**
 * `startTime`/`durationMinutes` are `null` for a manual Activity created
 * without an explicit time/duration (doc 02's T-01 "sin hora" trailing
 * section; epics.md's own AC for this story: title, hora/duración
 * opcionales) — the server persists `NULL` for an omitted field rather than
 * defaulting it (apps/cloud/src/tdah/storage.ts's
 * `mutateCreateManualActivity`). A Bloque-instantiated Activity
 * (`origin: 'routine'`) always has both non-null, since it copies them
 * straight from its Bloque. `durationMinutes === 0` (as opposed to `null`)
 * reads as "zero minutes given", not "instant" — the UI hides the duration
 * label rather than showing "0 min" for either case.
 */
export type TdahActivity = {
    id: number;
    dayPlanDate: string;
    blockId: number | null;
    title: string;
    startTime: string | null;
    durationMinutes: number | null;
    origin: TdahActivityOrigin;
    state: TdahActivityState;
    startedAt: string | null;
    completedAt: string | null;
};

/**
 * GET /v1/tdah/day response — returned bare, no wrapper. `timeZone` is the
 * TDAH profile's own configured IANA zone (AD-6: wall-clock always in the
 * user's own configured zone, never the requesting device's) — the client
 * must use it for anything that reads "now" (the T-01 now-line), rather than
 * the device's local `Date` methods, which can disagree with the profile's
 * zone.
 */
export type TdahDayResponse = {
    date: string;
    timeZone: string;
    routineTitle: string | null;
    activities: TdahActivity[];
};

/** POST /v1/tdah/day/activities body. `startTime`/`durationMinutes` are genuinely optional — omit either to leave it unset ("sin hora"). */
export type TdahCreateManualActivityRequest = {
    title: string;
    startTime?: string;
    durationMinutes?: number;
};

/** Response shape shared by POST .../day/activities and POST .../activities/:id/{action}. */
export type TdahActivityResponse = {
    activity: TdahActivity;
};

export type TdahActivityTransitionAction = 'start' | 'complete' | 'miss';

/** Mirrors TDAH_ERRORS.activityInvalid in apps/cloud/src/tdah/types.ts. */
export const TDAH_ACTIVITY_INVALID_CODE = 'TDAH_ACTIVITY_INVALID';

/**
 * T-05's one-tap Cierre decision for a `missed`/`limbo` Activity (spec
 * Code Map). Mirrors `TdahActivityDecision`/`TdahActivityDecideRequest` in
 * apps/cloud/src/tdah/types.ts by hand (ADR 0026). `'undated'` ("sin
 * fecha") is a deliberate no-op on the server (Design Notes: `state`/
 * `dayPlanDate` never change) — it still round-trips through
 * `POST .../decide` so the row collapses only after a real 200, never
 * optimistically.
 */
export const TDAH_ACTIVITY_DECISIONS = ['move-tomorrow', 'move-date', 'discard', 'undated'] as const;
export type TdahActivityDecision = (typeof TDAH_ACTIVITY_DECISIONS)[number];

export type TdahActivityDecideRequest =
    | { decision: 'move-tomorrow' }
    | { decision: 'move-date'; date: string }
    | { decision: 'discard' }
    | { decision: 'undated' };

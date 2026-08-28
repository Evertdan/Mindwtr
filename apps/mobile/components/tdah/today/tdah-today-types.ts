/**
 * Wire-facing shapes for T-01/T-02 (story 1.6). Mirrors the
 * `GET /v1/tdah/day`, `POST /v1/tdah/day/activities`, and
 * `POST /v1/tdah/activities/:id/{start|complete|miss}` contracts by hand
 * rather than importing apps/cloud/src/tdah/types.ts (ADR 0026: clients talk
 * to the HTTP surface, never to server-only types across the wire boundary —
 * same convention as tdah-onboarding-types.ts).
 */

/**
 * Mirrors `TDAH_ACTIVITY_ORIGINS` in apps/cloud/src/tdah/types.ts by hand
 * (ADR 0026, same as the shapes below).
 *
 * `'jira'` (story 4.1) is the single grouped, read-only "banda de trabajo"
 * the Origen de trabajo materializes once per local day — server-created by
 * the pull tick rather than by a Rutina (`'routine'`) or by the user
 * (`'manual'`). It is deliberately part of the SAME union rather than a
 * parallel concept: `GET /v1/tdah/day` returns it as an ordinary
 * `TdahActivity`, so every consumer here (T-01's timeline, the origin badge,
 * the accessibility label) must already handle it. Keep this list in sync
 * with the server's — a stale mirror silently blanks the badge for the
 * origins it is missing.
 */
export const TDAH_ACTIVITY_ORIGINS = ['routine', 'manual', 'jira'] as const;
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
 *
 * `movedAt` (story 3.3): the instant a `move-tomorrow`/`move-date` T-05
 * decision last touched this Activity — `null`/absent for one that never
 * moved through the Cierre. Drives T-06's "Movido desde el Cierre" badge,
 * distinct from the `origin:'routine'` "De Rutina X" badge (an Activity can
 * carry both: a Rutina-born row moved by a decision keeps its `origin` and
 * also gains `movedAt`). Typed optional (`?`) rather than required so the
 * many pre-3.3 fixtures across other stories' own test files — outside this
 * story's owned files, so never touched here — that build a `TdahActivity`
 * literal without it keep typechecking; every real server response still
 * always includes it. Read it as `activity.movedAt ?? null`, never a bare
 * `!== null`, so an omitted field in an older fixture reads the same as an
 * explicit `null` (never mistaken for "moved").
 *
 * `workItems` (story 4.2): the sprint issues the server attaches to the one
 * `origin: 'jira'` Activity of the day — absent on every other row. Three
 * fields and no fourth: `externalKey`, `summary` and `status` are exactly
 * what Jira returns under the current `fields=summary,status` query, and the
 * band deliberately renders **no per-task time at all** (FR-11: "SIN horas
 * inventadas por tarea"). `sprintName` is not mirrored here (spec Design
 * Notes: no surface of the day reads it; the multi-sprint notice stays in
 * T-13).
 */
export type TdahDayWorkItem = {
    externalKey: string;
    summary: string;
    status: string;
};

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
    movedAt?: string | null;
    /**
     * Optional for exactly the reason `movedAt` is: `use-tdah-limbo.ts` and
     * `use-tdah-morning.ts` build `TdahActivity[]` of their own out of
     * responses that never carry a work band, and neither file belongs to
     * this story. Read it as `activity.workItems ?? []`, never a bare
     * `.length`.
     */
    workItems?: TdahDayWorkItem[];
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
    /**
     * `null` until "Confirmar mañana" (T-06) persists the day's draft —
     * story 3.3. Present on every `GET .../day{,/tomorrow}` and the confirm
     * response alike (same `TdahDayPlanView` shape server-side); "hoy"'s own
     * response also carries it (always `null` there in practice, since T-05
     * closes "hoy" via `/decide`, never `/confirm`) rather than typing two
     * near-identical response shapes for one field.
     */
    confirmedAt: string | null;
    /**
     * Story 4.2: `tdah_work_origin.last_error_code` — the code of the last
     * failed pull, or `null` when the last pull succeeded (and absent
     * entirely when there is no Origen configured at all). T-01 maps it onto
     * the already-translated `tdahJira.error.*` copy to paint the band's
     * degradation notice, exactly as T-13 does with the same codes; nothing
     * personal in the day is gated on it (FR-11: "lo personal sigue
     * funcionando").
     *
     * Optional (`?`) so a pre-4.2 fixture, or a server that has not shipped
     * this field yet, reads the same as an explicit `null` — never as a
     * degraded band.
     */
    workOriginErrorCode?: string | null;
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
 *
 * `'complete-late'` (story 3.4, T-08's Limbo): the 5th decision, exclusive
 * to a `limbo` Activity's DecisionChip `variant='limbo'` (never offered by
 * `variant='cierre'`, since T-05 keeps its original 4). Server-side it
 * reuses the same completion SQL a normal `complete` uses (spec Code Map),
 * through this same `/decide` endpoint — never the
 * `POST /v1/tdah/activities/:id/complete` endpoint, which rejects a
 * `limbo` origin state outright (spec Never).
 */
export const TDAH_ACTIVITY_DECISIONS = ['move-tomorrow', 'move-date', 'discard', 'undated', 'complete-late'] as const;
export type TdahActivityDecision = (typeof TDAH_ACTIVITY_DECISIONS)[number];

export type TdahActivityDecideRequest =
    | { decision: 'move-tomorrow' }
    | { decision: 'move-date'; date: string }
    | { decision: 'discard' }
    | { decision: 'undated' }
    | { decision: 'complete-late' };

/**
 * `POST /v1/tdah/day/tomorrow/confirm` body (story 3.3, T-06). A full
 * overwrite, never a diff (Design Notes): `activities` carries every
 * surviving Activity of the day, in its final order (`sortOrder` = array
 * index, assigned server-side), and `deletedActivityIds` carries every id
 * removed from the draft. The server rejects the request whole (400
 * `TDAH_ACTIVITY_INVALID`) unless `activities.length + deletedActivityIds.length`
 * equals its own current count for the day — exact accounting, so a
 * desynced client can never silently drop rows it doesn't know about.
 */
export type TdahConfirmMorningRequest = {
    activities: { id: number; startTime: string | null; durationMinutes: number | null }[];
    deletedActivityIds: number[];
};

/**
 * `GET /v1/tdah/limbo` response (story 3.4, T-08). Every Activity currently
 * `state='limbo'`, across every `dayPlanDate` — deliberately no date/zone
 * scoping (spec Always: "no hay 'hoy'/'mañana' en esta pantalla"), ordered
 * oldest-first by the server (`day_plan_date ASC, id ASC`).
 */
export type TdahLimboResponse = {
    activities: TdahActivity[];
};

/**
 * `POST /v1/tdah/limbo/decide` body (story 3.4, T-08's batch bar). One
 * decision applied to every id in `activityIds` atomically — the server
 * validates the whole set is 1:1 with Activities actually in `limbo` (no
 * missing/foreign id) before writing anything; a single ineligible id
 * rejects the entire batch (spec Always, same "todo o nada" contract as
 * `TdahConfirmMorningRequest`/`mutateConfirmMorning`, story 3.3's
 * precedent). `'undated'` is excluded — the Limbo never offers "sin fecha"
 * (spec Never: already undated, a no-op there).
 */
export type TdahLimboDecideBatchRequest = {
    activityIds: number[];
    decision: Exclude<TdahActivityDecideRequest, { decision: 'undated' }>;
};

/** `POST /v1/tdah/limbo/decide` response — only the post-mutation rows for exactly the ids in the batch request (a subset of a full `TdahLimboResponse` listing), same shape as `TdahActivityResponse` scaled up to many rows. */
export type TdahLimboDecideBatchResponse = {
    activities: TdahActivity[];
};

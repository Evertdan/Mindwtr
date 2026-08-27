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

/**
 * `startedAt`/`completedAt` are story 1.6's own AD-7 fields: each is written
 * exactly once, by its own dedicated endpoint (`POST .../start`,
 * `POST .../complete`), and never re-editable afterward. `miss` sets
 * `state:'missed'` without writing a timestamp — the état table has no
 * "missedAt" concept, only started/completed instants.
 *
 * `startTime`/`durationMinutes` are `null` for a manual Activity created
 * without an explicit time/duration (doc 02's T-01 "sin hora" trailing
 * section; epics.md's own AC for this story: title, hora/duración
 * opcionales). A Bloque-instantiated Activity (`origin: 'routine'`) always
 * has both non-null, since it copies them straight from its Bloque.
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
    /**
     * Story 3.3 — `null` unless a T-05 `move-tomorrow`/`move-date` decision
     * (story 3.2) relocated this Activity here. T-06's morning editor renders
     * that as a distinct "Movido desde el Cierre" badge, separate from
     * `origin:'routine'`'s own "De Rutina X" badge.
     */
    movedAt: string | null;
};

/**
 * GET /v1/tdah/day — story 1.6. `routineTitle` is `null` whenever today has
 * no block-linked (origin:'routine') Activity, whether because no Rutina
 * applies (FR-3) or because today is manual-only. Always 200: the day is
 * generated on demand if missing (AD-5's idempotent generator, called with
 * today's date instead of tomorrow's), so there's no "day not found" case.
 *
 * `timeZone` is the caller's own TDAH profile time zone (falling back to
 * `TDAH_DEFAULT_TIME_ZONE` the same way `date`/`activities` already do when no
 * profile exists yet) — AD-6 requires wall-clock in the user's own configured
 * time zone, not the requesting device's local clock, so the client needs
 * this value to compute "now" and render the header date correctly even when
 * the device itself is set to a different zone.
 */
export type TdahDayResponse = {
    date: string;
    timeZone: string;
    routineTitle: string | null;
    /**
     * Story 3.3 — `null` until `POST /v1/tdah/day/tomorrow/confirm` sets it;
     * re-confirming overwrites it with a fresher timestamp. T-06 renders a
     * soft-lock banner when this is non-null on re-entry, but still allows
     * editing and reconfirming (no hard block).
     */
    confirmedAt: string | null;
    activities: TdahActivity[];
};

/**
 * POST /v1/tdah/day/activities body — story 1.6 (FR-4). `title` is required
 * (trimmed, capped at `TDAH_ROUTINE_TITLE_MAX_LENGTH`, the same cap Rutina
 * Bloques already enforce — not a new, separate one). `startTime`/
 * `durationMinutes` are genuinely optional (epics.md's own AC: "hora/duración
 * opcionales"): an omitted `startTime` and/or `durationMinutes` persists as
 * `NULL` (doc 02's T-01 "sin hora" trailing section), never a defaulted
 * "now"/`0` — see `mutateCreateManualActivity` in storage.ts.
 */
export type TdahCreateManualActivityRequest = {
    title: string;
    startTime?: string;
    durationMinutes?: number;
};

export type TdahActivityResponse = {
    activity: TdahActivity;
};

/**
 * POST /v1/tdah/activities/:id/{start|complete|miss} — story 1.6, AD-7.
 * `start` only ever transitions a `pending` Activity; any other current
 * state (already `started` or beyond) is a no-op returning the current
 * state unchanged, never an error (covers a raced double-tap).
 * `complete`/`miss` only ever transition a `pending`/`started` Activity into
 * their target state; calling one when the Activity is already in that exact
 * target state is the same kind of no-op, while any other non-`pending`/
 * `started` current state is rejected with `TDAH_ACTIVITY_INVALID` — this
 * story only ever registers actions on *today's* Activities, so `limbo`/
 * `discarded` (set later, by the scheduler or a future ritual flow) are never
 * reachable through these endpoints in practice.
 */
export type TdahActivityTransitionAction = 'start' | 'complete' | 'miss';

/**
 * POST /v1/tdah/activities/:id/decide — story 3.2, T-05's decision-chip row
 * under every `missed`/`limbo` Actividad on the ritual close screen. Reuses
 * `TdahActivityResponse` (above) as its response shape, same as
 * start/complete/miss.
 *
 * `move-tomorrow`/`move-date` share "reprogram as a fresh attempt on a new
 * day" semantics: `state` goes to `pending`, `startedAt`/`completedAt` are
 * cleared to `null`, and the destination day's `tdah_day_plan` row is
 * materialized on demand (`mutateGenerateTomorrowIfMissing` in storage.ts),
 * capped at `TDAH_DAY_MAX_ACTIVITIES` same as every other Activity-creating
 * path. `move-date`'s `date` must be strictly after "today" in the caller's
 * profile time zone (AD-6) — `date` <= today is rejected.
 *
 * `discard` sets `state:'discarded'` (terminal, never reappears in any
 * DayPlan) without touching `dayPlanDate`.
 *
 * `undated` is deliberately a data no-op — FR-9 only recognizes
 * move/discard/complete-late as Limbo exits, so "sin fecha" never writes
 * `state`/`dayPlanDate`; it only closes the row client-side for this ritual
 * session (see storage.ts's `mutateDecideActivity` doc comment). It still
 * shares the same `missed`/`limbo` eligibility gate as the other three
 * decisions, so calling it on, say, an already-`completed` Activity is
 * rejected exactly like the others.
 *
 * Every decision only ever transitions a `missed`/`limbo` Activity; any other
 * current state is `rejected` → 400 `TDAH_ACTIVITY_INVALID` (same contract as
 * start/complete/miss), UNLESS the request is an AD-7 idempotent retry whose
 * result already matches what's being asked for (same `state`, and for
 * move-tomorrow/move-date a `dayPlanDate` on or after "today" — not a strict
 * equality against the freshly recomputed target, so a retry that lands
 * after local midnight has rolled over between calls still matches;
 * `state:'discarded'` already for discard) — that responds 200 without
 * rewriting, never 400.
 */
export const TDAH_ACTIVITY_DECISIONS = ['move-tomorrow', 'move-date', 'discard', 'undated'] as const;
export type TdahActivityDecision = (typeof TDAH_ACTIVITY_DECISIONS)[number];

export type TdahActivityDecideRequest =
    | { decision: 'move-tomorrow' }
    | { decision: 'move-date'; date: string }
    | { decision: 'discard' }
    | { decision: 'undated' };

/**
 * POST /v1/tdah/day/tomorrow/confirm body — story 3.3, T-06's single
 * grouped-persist for the morning editor's borrador local (Design Notes: "el
 * confirm es una sobrescritura completa, nunca un diff implícito").
 *
 * `activities` carries every surviving Actividad in its final order —
 * `sortOrder` is implicit, the array index — with its (possibly edited)
 * `startTime`/`durationMinutes`; `deletedActivityIds` carries every id the
 * draft removed. The server requires
 * `activities.length + deletedActivityIds.length` to equal the day's current
 * `pending` Actividad count exactly (contabilidad exacta) — any mismatch, or
 * any id outside tomorrow's own `pending` set, rejects the WHOLE request with
 * `TDAH_ACTIVITY_INVALID` and writes nothing (see `mutateConfirmMorning` in
 * storage.ts). Retrying the identical payload is naturally idempotent —
 * there is no separate idempotency-key mechanism.
 */
export type TdahConfirmMorningRequest = {
    activities: Array<{ id: number; startTime: string | null; durationMinutes: number | null }>;
    deletedActivityIds: number[];
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
    /**
     * Namespaces that did real write work this tick: closed today and/or
     * generated tomorrow, and/or (story 3.1) marked+pushed the
     * ritual-invitation event for the first time today — including a
     * mark-only fire where close/generate both had nothing left to do
     * (`generatedCount`/`limboCount` stay at their existing totals, but the
     * namespace still counted here for the ritual-invitation push alone).
     */
    firedCount: number;
    /**
     * Namespaces skipped this tick — mode off, ritual hour not yet reached,
     * OR (once the ritual hour has been reached) tomorrow already generated,
     * nothing left to sweep-close, AND the ritual invitation is either
     * already marked notified today or has no open WS connection to push to
     * (story 3.1) — every one of those three conditions must hold for a
     * namespace past its ritual hour to be skipped rather than fired.
     */
    skippedCount: number;
    /** Namespaces whose write transaction failed this tick — retried automatically next tick. */
    failedCount: number;
    /** Total Actividades created across every namespace that fired this tick. */
    generatedCount: number;
    /** Total Actividades moved to `limbo` across every namespace that fired this tick. */
    limboCount: number;
    /**
     * Story 3.1 — namespaces whose `ritual_notified_date` mark committed
     * successfully this tick but whose WS push of the resulting
     * `ritual-invitation` event itself threw (e.g. a closing socket). The
     * mark is never rolled back for this (it is already durable by the time
     * the push is attempted — see scheduler.ts's own doc comment), so this
     * count is purely informational: it never causes a retry, since a retry
     * would just find `ritual_notified_date` already set and skip. Included
     * in `firedCount` above (the write itself still succeeded), never in
     * `failedCount` (that is reserved for a genuine namespace read/write
     * failure).
     */
    ritualPushFailedCount: number;
};

const TDAH_ERROR_CODES = {
    invalidBody: 'TDAH_INVALID_BODY',
    invalidTimeZone: 'TDAH_INVALID_TIME_ZONE',
    invalidRitualHour: 'TDAH_INVALID_RITUAL_HOUR',
    routineInvalid: 'TDAH_ROUTINE_INVALID',
    // Story 1.6: covers both a malformed/oversized manual-Activity input and
    // an invalid `start`/`complete`/`miss` state transition (e.g. `complete`
    // on an Activity already `missed`) — mirrors `routineInvalid` covering
    // both Rutina input validation and the routine-count cap.
    activityInvalid: 'TDAH_ACTIVITY_INVALID',
    methodNotAllowed: 'TDAH_METHOD_NOT_ALLOWED',
    notFound: 'TDAH_NOT_FOUND',
    storageFailed: 'TDAH_STORAGE_FAILED',
    activateRequired: 'TDAH_ACTIVATE_REQUIRED',
    // Story 2.1: the WS channel upgrade's own bearer-token check (query
    // param, not the `Authorization` header — see ws-channel.ts) rejects a
    // missing/invalid/unauthorized token with this single code, before the
    // handshake ever completes. The client treats any WS close/reject as
    // "sin servidor" and never inspects a raw message (AGENTS.md's
    // `.code`-only rule applies to the channel exactly like every HTTP
    // TDAH route).
    wsUnauthorized: 'TDAH_WS_UNAUTHORIZED',
} as const;

export type TdahErrorCode = (typeof TDAH_ERROR_CODES)[keyof typeof TDAH_ERROR_CODES];

export const TDAH_ERRORS = TDAH_ERROR_CODES;

/**
 * Story 2.1 — the persistent WS channel's shared shapes. Same server-only
 * rule as the rest of this file (ADR 0026): the channel lives entirely in
 * server.ts + ws-channel.ts, and story 2.2 (activity-trigger notifications)
 * will add its own event `kind`s onto this same envelope rather than
 * inventing a second one.
 */

/**
 * Sent once, immediately after a successful upgrade (server.ts's
 * `websocket.open` handler) — the minimal "the channel is live" payload.
 * `kind` is a discriminant so `TdahWsServerEvent` can grow into a real union
 * once story 2.2 adds its own event kinds on top, without this story having
 * to anticipate their fields.
 */
export type TdahWsConnectedEvent = {
    kind: 'connected';
    at: string;
};

/**
 * Story 2.2 — the activity-trigger tick's own WS event kind, added onto the
 * same envelope story 2.1's `TdahWsConnectedEvent` doc-comment anticipated.
 * `cloud/src/tdah/activity-trigger.ts`'s `runActivityTriggerTick` pushes one
 * of these per Actividad milestone that just crossed and hadn't been
 * notified yet — `edge: 'start'` when `startTime` arrives, `edge: 'end'`
 * when `startTime + durationMinutes` arrives. Never a third, generic kind.
 *
 * Field names/`kind` value (`'activity-trigger'`, `edge` rather than
 * `event`) match `apps/mobile/components/tdah/today/tdah-activity-
 * notification.ts`'s own mirror of this shape (ADR 0026: the client can't
 * import this file across the wire boundary, so it keeps an independent
 * copy) — that file's own doc comment says only its parser needs to change
 * if the server lands on different names, so this is the actual wire
 * contract to reconcile it against, not a guess.
 *
 * `durationMinutes` travels raw (not a pre-formatted string) so the client
 * builds the `"{Actividad} — {duración}"` title itself, following the same
 * `{durationMinutes} min` formatting convention `TdahActivityRow.tsx`
 * already uses. It is never `null` for an `edge: 'end'` trigger (an
 * Actividad without a duration can never reach an end milestone, since
 * `startTime + durationMinutes` is undefined without both), but genuinely
 * optional for `edge: 'start'` (a manual Actividad can have a `startTime`
 * without a `durationMinutes`) — the mobile mirror type above types its own
 * `durationMinutes` the same nullable way.
 */
export type TdahWsActivityTriggerEvent = {
    kind: 'activity-trigger';
    edge: 'start' | 'end';
    activityId: number;
    title: string;
    durationMinutes: number | null;
    startTime: string;
    at: string;
};

/**
 * Story 3.1 — the nightly ritual invitation's own WS event kind, added onto
 * the same envelope as `TdahWsConnectedEvent`/`TdahWsActivityTriggerEvent`
 * above. `cloud/src/tdah/scheduler.ts`'s `runNamespaceTick` pushes exactly
 * one of these per namespace per local calendar day — the first tick that
 * crosses the namespace's local ritual hour AND has an open WS connection to
 * push to (AD-5: same tick as the close/generate write, never a second
 * independent timer). Never a second `ritual-invitation` the same local day
 * (`ritual_notified_date` in `tdah_profile`, storage.ts, tracks that), and
 * never fired at all while no connection is open — the next tick retries
 * once the phone reconnects, still the same local day.
 *
 * Deliberately as minimal as `TdahWsConnectedEvent` (just `kind` + `at`):
 * this story only delivers the invitation trigger and the navigable route
 * (`kind: 'tdah-ritual'` in the mobile notification-open handler), never any
 * of T-05's real content (scoreboard, decision-chips) — that's Story 3.2, so
 * there is no scoreboard/count payload to carry here yet.
 */
export type TdahWsRitualInvitationEvent = {
    kind: 'ritual-invitation';
    at: string;
};

export type TdahWsServerEvent = TdahWsConnectedEvent | TdahWsActivityTriggerEvent | TdahWsRitualInvitationEvent;

/**
 * Story 2.2 — per-tick aggregate stats across every namespace scanned by
 * `runActivityTriggerTick` (activity-trigger.ts). Same shape/spirit as
 * `TdahNightlyTickSummary` above: counts only, never a namespace key or
 * Activity title (AGENTS.md's `.code`-only logging rule applies here too).
 */
export type TdahActivityTriggerTickSummary = {
    /** The tick's own reference date (UTC calendar day of `now`) — not any single namespace's local date, since namespaces can span time zones. */
    date: string;
    /** Namespaces with an existing TDAH database, scanned this tick. */
    namespaceCount: number;
    /** Namespaces that fired at least one activity-trigger event this tick. */
    firedNamespaceCount: number;
    /** Total individual start/end trigger events fired across every namespace this tick. */
    firedEventCount: number;
    /**
     * Namespaces skipped this tick — mode off, no open WS connection to push
     * to (never marks anything notified in that case — see
     * activity-trigger.ts), or no Actividad milestone due yet.
     */
    skippedCount: number;
    /** Namespaces whose write transaction failed this tick — retried automatically next tick. */
    failedCount: number;
};

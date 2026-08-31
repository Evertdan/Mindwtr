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

/**
 * Story 4.1 adds a third origin, `'jira'` — the single grouped work band
 * (`mutateSyncWorkOriginBand`, storage.ts) the Origen de trabajo materializes
 * once per local day. It is deliberately part of the SAME enum rather than a
 * parallel concept: the band is an ordinary Actividad for every downstream
 * consumer (Hoy, Historial, Métricas' `byOrigin`), it just happens to be
 * created by the pull tick instead of a Rutina or the user.
 *
 * Widening this list widens `tdah_activity`'s own `CHECK (origin IN (...))`,
 * which SQLite cannot relax via `ALTER TABLE` — see
 * `migrateActivityJiraOriginIfNeeded` (schema v5 -> v6) in storage.ts.
 */
export const TDAH_ACTIVITY_ORIGINS = ['routine', 'manual', 'jira'] as const;
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
    /**
     * Story 4.2 — present ONLY on the grouped Jira band (`origin: 'jira'`),
     * absent on every other Actividad. The issues the band stands for, in the
     * snapshot's own order, so T-01 can render read-only sub-rows without a
     * second request to `GET /v1/tdah/origin` (which is T-13's surface and
     * carries connection settings the day has no business knowing).
     *
     * Optional rather than `TdahDayWorkItem[] | null` because the mobile
     * mirror of this type is also built by `use-tdah-limbo`/`use-tdah-morning`
     * from responses that never carry it.
     */
    workItems?: TdahDayWorkItem[];
};

/**
 * Story 4.2 — one read-only sub-row of the grouped band. Deliberately a
 * NARROWER shape than `TdahWorkOriginItem`: no `sprintName` (no surface of the
 * day reads it — see the story's Design Notes; the multi-sprint notice lives
 * only in T-13) and, above all, no hour of any kind. The band never invents a
 * time per task (FR-11).
 */
export type TdahDayWorkItem = {
    externalKey: string;
    summary: string;
    status: string;
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
    /**
     * Story 4.2 — the Origen's last failure code (`tdah_work_origin
     * .last_error_code`), or `null` when the last pull succeeded, when no
     * Origen is connected, and when the mode never had one at all. T-01 maps it
     * onto the already-translated `tdahJira.error.*` copy to paint the band's
     * degradation notice while everything personal keeps working (FR-11's own
     * consequence).
     *
     * Deliberately NOT optional here: the day always states the Origen's health
     * explicitly, so "no lo sé" can never be confused with "está sano".
     */
    workOriginErrorCode: TdahErrorCode | null;
    /**
     * Story 4.3 — the end (`HH:mm`, profile-local) of the contiguous DND block
     * covering "now", or `null` when no window is active. Computed BY THE
     * SERVER (`resolveDndActive`, dnd.ts) over the same windows the two
     * notification ticks evaluate, so T-01's `🌙 DND · hasta {hora}` chip is a
     * rendering of a server decision, never a client-side re-derivation
     * (AD-8).
     *
     * Only ever non-null on today's day (`GET /v1/tdah/day`): tomorrow's plan
     * (`GET /v1/tdah/day/tomorrow`) has no "now" to be inside of, so it always
     * reports `null`.
     */
    dndActiveUntil: string | null;
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
 * `complete-late` (story 3.4, T-08's Limbo tray) sets `state:'completed'` and
 * stamps `completedAt`, reusing the exact same write `start`/`complete`/`miss`'s
 * `complete` action already uses — the *only* thing that differs is which
 * current states are eligible to reach it (this decision, same as every other
 * one here, only ever transitions a `missed`/`limbo` Activity, where the plain
 * `complete` action above only ever transitions a `pending`/`started` one).
 * Never reachable through `POST .../complete` itself, which explicitly
 * rejects a `limbo` origin state.
 *
 * Every decision only ever transitions a `missed`/`limbo` Activity; any other
 * current state is `rejected` → 400 `TDAH_ACTIVITY_INVALID` (same contract as
 * start/complete/miss), UNLESS the request is an AD-7 idempotent retry whose
 * result already matches what's being asked for (same `state`, and for
 * move-tomorrow/move-date a `dayPlanDate` on or after "today" — not a strict
 * equality against the freshly recomputed target, so a retry that lands
 * after local midnight has rolled over between calls still matches;
 * `state:'discarded'` already for discard; `state:'completed'` already for
 * complete-late) — that responds 200 without rewriting, never 400.
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
 * GET /v1/tdah/limbo — story 3.4, T-08's Limbo tray. Every Actividad whose
 * `state === 'limbo'`, across every `dayPlanDate`, ordered oldest-first
 * (`day_plan_date ASC, id ASC` — see `SELECT_LIMBO_ACTIVITIES_SQL` in
 * storage.ts). Deliberately no date/timeZone scoping unlike
 * `TdahDayResponse`: FR-9 requires this list to never shrink by age alone, so
 * there is no "today"/"tomorrow" concept on this screen at all, only how long
 * each row has been waiting (computed client-side from `dayPlanDate`/
 * `movedAt`). Always 200 — an empty `activities` array is the "nothing to
 * decide" state, never a 404.
 */
export type TdahLimboResponse = {
    activities: TdahActivity[];
};

/**
 * POST /v1/tdah/limbo/decide — story 3.4, T-08's batch decision bar: the same
 * four decisions `TdahActivityDecideRequest` offers on a single Activity,
 * minus `'undated'` (the Limbo screen never offers "sin fecha" — everything
 * listed there is already without a date, so it would be a meaningless
 * no-op), applied to every id in `activityIds` at once.
 *
 * Atomic, "todo o nada" — same contract as `TdahConfirmMorningRequest`
 * above, not a loop of individual `decideActivity` calls: every id in
 * `activityIds` must exist and currently be `state === 'limbo'` (deduped,
 * none missing), and — for `move-tomorrow`/`move-date` — the destination day
 * must have enough cap headroom for the *whole* batch at once, or the entire
 * request is rejected with `TDAH_ACTIVITY_INVALID` and nothing is written
 * (see `mutateDecideLimboBatch` in storage.ts).
 */
export type TdahLimboDecideBatchRequest = {
    activityIds: number[];
    decision: Exclude<TdahActivityDecideRequest, { decision: 'undated' }>;
};

/**
 * Response shape for `POST /v1/tdah/limbo/decide` — the post-mutation
 * `TdahActivity` rows for exactly the ids in the request's `activityIds`
 * (same shape as `TdahLimboResponse.activities` above, just a subset rather
 * than the full Limbo list).
 */
export type TdahLimboDecideBatchResponse = {
    activities: TdahActivity[];
};

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
 * GET /v1/tdah/history — story 3.5, T-09. One entry per Actividad in the
 * requested range that is `missed`, `limbo`, or `completed` *after* its own
 * `dayPlanDate` ("completada tarde") — a same-day `completed` Actividad never
 * appears here (see `getHistory` in storage.ts's own doc comment for the
 * exact JS-side, timezone-correct classification, and AGENTS.md's "the
 * server computes" rule). `entries` is ordered most-recent-first
 * (`day_plan_date DESC, id DESC`).
 *
 * `routineTitle` mirrors `TdahDayResponse.routineTitle`'s own null
 * convention — `null` for a manual (`origin:'manual'`) Actividad, or for a
 * `origin:'routine'` one whose Bloque/Rutina has since been deleted (the
 * LEFT JOIN simply stops matching, same accepted divergence
 * `SELECT_ROUTINE_TITLE_FOR_DAY_SQL` already documents).
 *
 * `completedLate` is `true` only for the "completada tarde" case above —
 * always `false` for `missed`/`limbo` entries. The UI never re-derives this
 * from `activity.completedAt`/`dayPlanDate` itself (AD-5: the server
 * computes, the client only renders).
 */
export type TdahHistoryEntry = {
    activity: TdahActivity;
    routineTitle: string | null;
    completedLate: boolean;
};

/**
 * `range` echoes back the server-resolved `{from, to}` bounds actually
 * queried — the rolling-window math for `day`/`week`/`month` presets happens
 * server-side (AD-6: `formatDateInTimeZone(new Date(), profile.timeZone)`,
 * never the client's clock), so the client reads the resolved dates here
 * rather than recomputing them.
 */
export type TdahHistoryResponse = {
    range: { from: string; to: string };
    entries: TdahHistoryEntry[];
};

/**
 * GET /v1/tdah/metrics — story 3.5, T-10. Every count below is computed
 * fresh, at request time, over the same three-state candidate set
 * (`missed`/`limbo`/`completed`) `TdahHistoryResponse` draws from — never a
 * precomputed/persisted aggregate (AD-13). `completedOnTime`/`total` are the
 * KPI's numerator/denominator; `rate` is `completedOnTime / total` as a
 * **fraction in `[0, 1]`, never a pre-multiplied percentage** — `null` only
 * when `total === 0` (not enough history yet). The KPI's color is a single
 * fixed token regardless of `rate`'s value (epics.md AC, SM-C2 — never a
 * semáforo, see the spec's Design Notes for the doc-05 wording conflict this
 * resolves).
 */
export type TdahMetricsOriginBreakdown = {
    origin: TdahActivityOrigin;
    completedOnTime: number;
    total: number;
};

/**
 * One week of the always-8-week (56-day), always-rolling-to-today trend
 * (independent of whatever `period` the caller requested for the KPI above —
 * see the spec's Boundaries & Constraints). `weekStart` is that week's first
 * `YYYY-MM-DD` date; `rate` follows the same fraction-or-`null` convention as
 * `TdahMetricsResponse.rate`.
 */
export type TdahMetricsTrendPoint = {
    weekStart: string;
    completedOnTime: number;
    total: number;
    rate: number | null;
};

export type TdahMetricsResponse = {
    period: { from: string; to: string };
    completedOnTime: number;
    total: number;
    rate: number | null;
    byOrigin: TdahMetricsOriginBreakdown[];
    trend: TdahMetricsTrendPoint[];
};

// --- Origen de trabajo (story 4.1, T-13) ------------------------------------

/**
 * The generic Origen registry's provider ids. v1 ships exactly one (`'jira'`,
 * Jira Cloud), but the seam is real rather than notional: `work-origin.ts`
 * holds the provider-agnostic contract and `jira-origin.ts` the only
 * implementation, so adding Azure DevOps/GitHub later never means unpicking
 * Jira specifics out of storage/routes/tick code (epic Non-Goal v1, but
 * explicitly "no acoplado").
 */
export const TDAH_WORK_ORIGIN_PROVIDERS = ['jira'] as const;
export type TdahWorkOriginProvider = (typeof TDAH_WORK_ORIGIN_PROVIDERS)[number];

export const isTdahWorkOriginProvider = (value: unknown): value is TdahWorkOriginProvider => (
    typeof value === 'string' && (TDAH_WORK_ORIGIN_PROVIDERS as readonly string[]).includes(value)
);

/**
 * One row of the snapshot the last successful pull left behind — the issues
 * the grouped band stands for. Story 4.2 renders these as the band's
 * expandable sub-rows; this story only persists and returns them.
 *
 * Deliberately NOT an Actividad: no hour is ever invented per task (Never),
 * so these carry no `startTime`/`durationMinutes`/`state` of their own.
 */
export type TdahWorkOriginItem = {
    externalKey: string;
    summary: string;
    status: string;
    sprintName: string | null;
};

/**
 * The Origen's public state — everything `GET /v1/tdah/origin` returns.
 *
 * There is NO token field at any level, by construction: the sealed secret
 * lives only in `tdah_work_origin.secret_sealed` and is read exclusively by
 * the pull tick (`readSealedWorkOriginSecret`, storage.ts). A response shape
 * that cannot name the token cannot leak it (AD-9; doc 06: "esta pantalla
 * NUNCA lo muestra de vuelta").
 *
 * `jql` is the effective query as plain, selectable text (doc 06 zone 4 —
 * "dejar visible como texto consultable"), so the user can audit exactly what
 * the server asks Jira for.
 */
export type TdahWorkOriginStatus = {
    connected: boolean;
    provider: TdahWorkOriginProvider | null;
    siteUrl: string | null;
    email: string | null;
    jql: string | null;
    workStart: string | null;
    workEnd: string | null;
    pullIntervalMinutes: number | null;
    connectedAt: string | null;
    lastSyncAt: string | null;
    /** The last failure's stable `TDAH_…` code, or `null` when the last pull succeeded. Never a raw fs/http/sqlite message. */
    lastErrorCode: TdahErrorCode | null;
    issues: TdahWorkOriginItem[];
};

export type TdahWorkOriginResponse = TdahWorkOriginStatus;

/**
 * PUT /v1/tdah/origin body. `token` travels here and ONLY here — it is never
 * echoed back, never logged, never re-rendered (AD-9).
 *
 * `token` itself is optional: omitting it keeps the stored credential, so a
 * settings-only edit (moving the working hours, changing the cadence) does not
 * force the user to mint a fresh Atlassian API token just to change a time.
 * It is mandatory on a FIRST connection, where there is nothing to keep —
 * `handlePutWorkOrigin` enforces that, since only it can see whether a row
 * already exists.
 *
 * `workStart`/`workEnd`/`pullIntervalMinutes` are optional and resolve as
 * body → currently persisted value → module default
 * (`TDAH_WORK_ORIGIN_DEFAULT_*`, storage.ts). Falling straight back to the
 * default on a re-connection would silently reset a customised 07:30–15:45
 * window every time the user rotated their token.
 */
export type TdahWorkOriginUpsertRequest = {
    provider: TdahWorkOriginProvider;
    siteUrl: string;
    email: string;
    token?: string;
    workStart?: string;
    workEnd?: string;
    pullIntervalMinutes?: number;
};

/**
 * Story 4.1 — per-tick aggregate stats across every namespace scanned by
 * `runWorkOriginPullTick` (origin-pull.ts). Same counts-only, never-a-
 * namespace-key discipline as `TdahNightlyTickSummary`/
 * `TdahActivityTriggerTickSummary` above (AGENTS.md's `.code`-only rule).
 */
export type TdahOriginPullTickSummary = {
    /** The tick's own reference date (UTC calendar day of `now`) — not any single namespace's local date. */
    date: string;
    /** Namespaces with an existing TDAH database, scanned this tick. */
    namespaceCount: number;
    /** Namespaces that actually pulled and re-materialized their band this tick. */
    syncedCount: number;
    /**
     * Namespaces skipped this tick — mode off, no Origen connected, outside
     * the configured working hours (no network call is ever made in that
     * case), or the pull interval has not elapsed since `last_pull_at`.
     */
    skippedCount: number;
    /**
     * Namespaces whose pull failed this tick — bad credentials, unreachable
     * site, missing master key, or a storage error. Each one persisted its own
     * `last_error_code` and is retried on the next eligible tick; personal
     * Actividades are untouched either way (graceful degradation).
     */
    failedCount: number;
    /** Total issues materialized into snapshots across every namespace that synced this tick. */
    itemCount: number;
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
    /**
     * Story 4.3 — namespaces whose ritual invitation (N-03) was SEALED AND
     * DISCARDED this tick because a DND window was active: `ritual_notified_date`
     * is marked exactly as a real fire marks it, and no event is built or
     * pushed. Counted in `firedCount` too (the tick genuinely wrote), and never
     * retried — the seal is the whole point. A suppressed invitation is gone,
     * not deferred (FR-12: "lo suprimido no vuelve después").
     */
    suppressedCount: number;
};

/**
 * Story 4.3 — el DND (FR-12, T-12). The whole feature's data is these two
 * shapes plus one derived string; there is deliberately no queue table, no
 * `suppressed_at` column and no new Activity state (see dnd.ts's own header).
 *
 * `source` is the provenance, and it is what makes a window editable or not:
 * `'manual'` rows are the user's own rules (weekly or one-off), `'calendar'`
 * rows are a pure projection of what the phone observed, materialized by the
 * server (`materializeCalendarWindows`) and replaced wholesale by the next
 * `PUT /v1/tdah/dnd/calendar` — editing one by hand would silently un-happen,
 * so the routes reject it with `TDAH_DND_READ_ONLY`.
 *
 * `kind` is the recurrence: `'weekly'` carries `weekdays` (0=Sunday … 6=
 * Saturday, the same numbering `TdahRoutineWeekdayPattern` already uses) and a
 * `null` `date`; `'once'` carries a `YYYY-MM-DD` `date` and `null` `weekdays`.
 * Every calendar-derived window is `'once'`.
 *
 * `startTime`/`endTime` are zero-padded `HH:mm` in the PROFILE's time zone,
 * half-open `[start, end)` — the same lexically-comparable idiom
 * `isWithinWorkingHours` (origin-pull.ts) already uses. `start < end` is
 * enforced at parse time, so a window never crosses local midnight; the server
 * splits a midnight-crossing calendar event into two windows instead.
 */
export type TdahDndWindowSource = 'manual' | 'calendar';
export type TdahDndWindowKind = 'weekly' | 'once';

export type TdahDndWindow = {
    id: string;
    source: TdahDndWindowSource;
    kind: TdahDndWindowKind;
    weekdays: number[] | null;
    date: string | null;
    startTime: string;
    endTime: string;
    label: string | null;
};

/**
 * A window before it has an id — what `materializeCalendarWindows` (dnd.ts)
 * returns and what `mutateReplaceCalendarWindows` (storage.ts) inserts. Kept
 * separate from `TdahDndWindow` so the pure module stays pure: minting an id
 * is I/O-ish (randomness), and a deterministic-by-construction test of the
 * materializer would be impossible if it had to invent them.
 */
export type TdahDndWindowDraft = Omit<TdahDndWindow, 'id'>;

/** POST/PUT `/v1/tdah/dnd/windows[/:id]` body, already validated by `parseManualWindowInput` (dnd.ts). Always `source: 'manual'` by construction — the route never accepts a `source`. */
export type TdahDndWindowInput = TdahDndWindowDraft;

/**
 * The DND's own working hours, deliberately NOT shared with
 * `tdah_work_origin.work_start/work_end` (story 4.1): 4.3 must work for a user
 * who never connects a Jira Origen, so requiring one to bound calendar
 * detection would leave the whole feature dead for them. Unifying the two
 * definitions is explicit deferred work, not a silent coupling.
 *
 * `calendarEnabled` is the user's toggle for calendar detection. It gates the
 * PHONE's upload (T-12 only collects and PUTs while it is on); the server
 * still evaluates whatever `source: 'calendar'` windows exist, so turning the
 * toggle off and syncing an empty range is what actually clears them.
 */
export type TdahDndSettings = {
    calendarEnabled: boolean;
    workStart: string;
    workEnd: string;
};

/** PUT `/v1/tdah/dnd` body — every field optional, merged over what is stored, then over the defaults (same body → persisted → default order `handlePutWorkOrigin` already uses). */
export type TdahDndSettingsInput = {
    calendarEnabled?: boolean;
    workStart?: string;
    workEnd?: string;
};

/** GET `/v1/tdah/dnd` / every DND mutation's response. `activeUntil` is the same server-computed value `TdahDayResponse.dndActiveUntil` carries. */
export type TdahDndResponse = {
    settings: TdahDndSettings;
    windows: TdahDndWindow[];
    activeUntil: string | null;
    /**
     * The profile's own IANA zone, the same field `TdahDayResponse` already
     * carries and for the same reason (DW-102): `activeUntil` is an "HH:mm"
     * with no zone of its own, so T-12 cannot tell whether it has passed
     * without knowing which clock it was written against — and AD-6 makes the
     * profile zone editable and therefore free to disagree with the device's.
     * The client still decides nothing about ACTIVENESS with it; it only
     * learns when to ask the server again.
     */
    timeZone: string;
};

/**
 * One busy event as the phone observed it: two RAW UTC ISO instants and
 * nothing else. No title, no calendar name, no attendee — the server never
 * needs them and must never log them, and the client never converts, clips or
 * decides anything (AD-8).
 */
export type TdahDndCalendarEvent = {
    startsAt: string;
    endsAt: string;
};

/**
 * PUT `/v1/tdah/dnd/calendar` body. `rangeStart`/`rangeEnd` are UTC ISO
 * instants bounding what the phone actually looked at, so the server can
 * replace exactly that slice of `source: 'calendar'` windows in block — an
 * event deleted from the phone's calendar disappears here because it is
 * ABSENT from the new payload, which only works if the range is explicit.
 */
export type TdahDndCalendarSyncRequest = {
    rangeStart: string;
    rangeEnd: string;
    events: TdahDndCalendarEvent[];
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
    // Story 4.1 — the Origen de trabajo (T-13). Four codes, one per genuinely
    // distinct failure the user can act on differently (doc 06: "el estado de
    // sincronización es el dato que el usuario vendrá a mirar cuando algo
    // falle — priorizar claridad del estado degradado"):
    // - `originInvalid`: the request itself is malformed — a non-`https:`
    //   site URL, one carrying userinfo/path/query, an unknown provider, a
    //   bad work window. Rejected BEFORE any outbound network call.
    // - `originCredentialsInvalid`: Atlassian itself answered 401/403 — the
    //   email/token pair is wrong or revoked. Also reused by the pull tick
    //   when a persisted sealed secret cannot be opened (a row copied into
    //   another namespace's SQLite fails its AAD check, see origin-crypto.ts).
    // - `originUnreachable`: the outbound GET threw, timed out, redirected,
    //   or answered anything else non-2xx — a degraded network, never a
    //   credential problem.
    // - `originKeyUnavailable`: the operator has not configured
    //   `MINDWTR_CLOUD_TDAH_ORIGIN_KEY(_FILE)`. The Origen fails closed: a
    //   token is NEVER persisted in clear as a fallback.
    originInvalid: 'TDAH_ORIGIN_INVALID',
    originCredentialsInvalid: 'TDAH_ORIGIN_CREDENTIALS_INVALID',
    originUnreachable: 'TDAH_ORIGIN_UNREACHABLE',
    originKeyUnavailable: 'TDAH_ORIGIN_KEY_UNAVAILABLE',
    // The pull itself succeeded but the day is already at
    // `TDAH_DAY_MAX_ACTIVITIES`, so the grouped band could not be inserted.
    // It gets its own code rather than being swallowed: silently reporting a
    // fresh "última sincronización" while no band appears is exactly the kind
    // of unexplained absence the mode is supposed to never produce. The user
    // resolves it by removing something from the day, so it is actionable —
    // which is what earns it a code of its own.
    originDayFull: 'TDAH_ORIGIN_DAY_FULL',
    // Story 4.2 — the server half of "la franja es de solo lectura". The band
    // is excluded from `SELECT_ELIGIBLE_MORNING_ACTIVITY_IDS_SQL`, so any
    // `POST /v1/tdah/day/tomorrow/confirm` body that names it (to re-time it or
    // to delete it) is rejected without writing anything. It gets its own code
    // rather than the generic `activityInvalid` because it is not a malformed
    // request at all: the payload is well-formed and the id is real, the row is
    // simply not the user's to edit — the work record lives in Jira, and
    // Mindwtr never writes there.
    originReadOnly: 'TDAH_ORIGIN_READ_ONLY',
    // Story 4.3 — el DND (T-12). Three codes, one per genuinely distinct thing
    // the user (or the client) did wrong, following the same "one code per
    // action the user can take differently" rule the `origin*` block above
    // establishes:
    // - `dndInvalid`: the window/settings payload itself is malformed — an
    //   `endTime <= startTime`, a non-`HH:mm` time, an empty or out-of-range
    //   `weekdays`, a `date` that is not a real ISO calendar date, a work
    //   window that does not run forward, or a calendar sync body over
    //   `TDAH_DND_MAX_CALENDAR_EVENTS`. Nothing is persisted.
    // - `dndReadOnly`: the row is real and the request is well-formed, but the
    //   window's `source` is `'calendar'` — it is a projection of the phone's
    //   observation (AD-8), replaced wholesale by the next
    //   `PUT /v1/tdah/dnd/calendar`, so editing or deleting it by hand would
    //   silently un-happen. The exact counterpart of `originReadOnly`.
    // - `dndLimit`: the namespace already holds `TDAH_DND_MAX_MANUAL_WINDOWS`
    //   manual windows. Bounded like every other list in this module
    //   (`TDAH_DAY_MAX_ACTIVITIES` is the precedent), and actionable: the user
    //   deletes one.
    dndInvalid: 'TDAH_DND_INVALID',
    dndReadOnly: 'TDAH_DND_READ_ONLY',
    dndLimit: 'TDAH_DND_LIMIT',
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

/**
 * Story 4.2 — N-04, the grouped work band's own event kind. Pushed by the SAME
 * `activity-trigger.ts` tick as `TdahWsActivityTriggerEvent` above (never a
 * fourth `setInterval`, never a second channel), exactly ONCE per band per
 * local day: the tick that first crosses the band's own `start_time` with an
 * open WS connection seals `tdah_activity.start_notified_at` and emits this.
 *
 * The band is deliberately absent from the N-01/N-02 candidate query
 * (`SELECT_ACTIVITY_TRIGGER_CANDIDATES_SQL` excludes `origin = 'jira'`), so it
 * can never also produce a start AND an end `activity-trigger` — the
 * two-notifications-per-band avalanche FR-11 forbids. There is no end-of-band
 * notification at all, by design.
 *
 * `itemCount` is the count of issues in the last successful snapshot, carried
 * raw so the client composes "Sprint: 3 tareas" itself with its own localized
 * copy (`tdahToday.workBandNotificationTitle`/`…Body`) — the same
 * client-formats-the-string convention `durationMinutes` already follows above.
 * No per-issue detail travels here: the band never names a task in a
 * notification, and never invents an hour for one.
 */
export type TdahWsWorkBandEvent = {
    kind: 'work-band';
    activityId: number;
    title: string;
    startTime: string;
    durationMinutes: number | null;
    itemCount: number;
    at: string;
};

export type TdahWsServerEvent =
    | TdahWsConnectedEvent
    | TdahWsActivityTriggerEvent
    | TdahWsRitualInvitationEvent
    | TdahWsWorkBandEvent;

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
    /** Namespaces that fired at least one event this tick. Story 4.2: unlike `firedEventCount`/`firedWorkBandCount`, which stay deliberately separate, this counts a namespace whose only work was N-04 — it answers "did this namespace push anything at all?", which is the question the skip accounting is checked against. */
    firedNamespaceCount: number;
    /** Total individual start/end trigger events fired across every namespace this tick. Story 4.2: work-band events are counted separately below, never folded in here — an N-01/N-02 count that silently included N-04 would hide exactly the double-notification regression this story fixed. */
    firedEventCount: number;
    /**
     * Story 4.2 — total `work-band` (N-04) events fired across every namespace
     * this tick. At most one per namespace per local day by construction (the
     * band's own `start_notified_at` seal), so in steady state this is 0 and,
     * on the tick that crosses a band's start, 1.
     */
    firedWorkBandCount: number;
    /**
     * Namespaces skipped this tick — mode off, no open WS connection to push
     * to (never marks anything notified in that case — see
     * activity-trigger.ts), or no Actividad milestone due yet.
     */
    skippedCount: number;
    /** Namespaces whose write transaction failed this tick — retried automatically next tick. */
    failedCount: number;
    /**
     * Story 4.3 — total N-01/N-02/N-04 milestones SEALED AND DISCARDED this
     * tick because a DND window was active. Each one marked its dedupe column
     * (`start_notified_at`/`end_notified_at`) exactly like a real fire and
     * produced no event, so it can never be delivered later — not by a
     * post-window tick, not by a reconnection. Deliberately its own counter and
     * never folded into `firedEventCount`: a suppression that reported itself
     * as a fire would make the audit log claim the user was notified.
     */
    suppressedCount: number;
};

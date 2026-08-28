/**
 * The module's — and the app's — first background scheduler (ADR 0026
 * addendum, story 1.5). `server.ts`'s `startCloudServer` registers a 60s
 * `setInterval` calling `runNightlyTdahTick(dataDir, new Date())`, mirroring
 * the existing rate-limiter cleanup timer's wiring shape.
 *
 * Each tick walks every namespace with a TDAH database
 * (`listActiveTdahNamespaces`) and, once that namespace's local ritual hour
 * has arrived today, atomically closes the outgoing day (`pending`/`started`
 * -> `limbo`) and generates tomorrow's DayPlan, inside one held
 * `withWriteTransaction` per namespace. Every namespace's local
 * ritual-hour/time-zone is read fresh from its own profile on every tick — no
 * cached "next fire" instant — so a `PUT /profile` change takes effect on the
 * very next tick with no invalidation logic, and never touches
 * already-recorded Activity times.
 *
 * Closing is a SWEEP: `mutateCloseOutgoingDay` limboes every Actividad still
 * `pending`/`started` on the outgoing local day OR ANY EARLIER day, so (a) a
 * day whose plan was already generated earlier (e.g. by POST /activate) is
 * still closed — generation existing must never short-circuit the close —
 * (b) an Actividad added or started after the ritual fired is closed by the
 * next tick, and (c) a whole ritual window missed (server down 23:00–00:00)
 * is swept at the next ritual tick instead of staying pending forever.
 *
 * Steady-state ticks stay read-only: a cheap pre-transaction check
 * (`hasDayPlan` for tomorrow + `hasPendingOrStartedUpTo` for anything left
 * to close) opens a write transaction only when there is real work.
 * Generation remains generate-if-missing via tomorrow's `tdah_day_plan` row
 * (its existing PRIMARY KEY, unchanged from story 1.3/1.4), and closing only
 * ever touches rows still in `pending`/`started`, so every part of the write
 * is idempotent.
 *
 * A write failure for one namespace is logged (`.code` only, never a raw
 * message or a namespace key — AGENTS.md's privacy rule) and left for the
 * next tick's retry; it never aborts or delays any other namespace's firing
 * in the same tick.
 */
import { getFsErrorCode } from '../server-storage';
import { logError } from '../server-config';
import { computeLocalTimeOfDay, computeLocalWeekday, resolveDndActive } from './dnd';
import {
    computeTomorrowDate,
    formatDateInTimeZone,
    hasDayPlan,
    hasPendingOrStartedUpTo,
    listActiveTdahNamespaces,
    mutateCloseOutgoingDay,
    mutateGenerateTomorrowIfMissing,
    mutateMarkRitualNotified,
    readEffectiveDndWindows,
    readRitualNotifiedDate,
    readTdahProfile,
    tdahDatabasePath,
    withReadDatabase,
    withWriteTransaction,
} from './storage';
import type { TdahNightlyTickSummary, TdahWsRitualInvitationEvent } from './types';

/**
 * "HH:mm" wall-clock time in `timeZone` at `now` — re-exported unchanged from
 * `dnd.ts`, which is where the implementation moved in story 4.3 (`storage.ts`
 * needs the same value to attach `dndActiveUntil` to the day, and
 * `storage.ts` importing this file would close an import cycle). Every
 * existing importer — `activity-trigger.ts`, the tests — keeps importing it
 * from here, and its behavior is byte-identical.
 */
export { computeLocalTimeOfDay };

const isRitualHourReached = (timeZone: string, ritualHour: string, now: Date): boolean => (
    computeLocalTimeOfDay(timeZone, now) >= ritualHour
);

type NamespaceTickOutcome =
    | { kind: 'skipped' }
    | {
        kind: 'fired';
        generatedCount: number;
        limboCount: number;
        ritualEvent: TdahWsRitualInvitationEvent | null;
        /**
         * Story 4.3 — this tick SEALED `ritual_notified_date` because a DND
         * window was active, and built no event. Never both this and a
         * `ritualEvent`: the two are the mutually exclusive halves of the same
         * "the invitation is now resolved for today" write.
         */
        ritualSuppressed: boolean;
    }
    | { kind: 'failed'; code: string };

/**
 * Story 3.1 — the ready-to-send ritual-invitation WS event, built the moment
 * `runNamespaceTick` marks a namespace notified for the day. Kept as a tiny,
 * exported builder (mirrors `activity-trigger.ts`'s own
 * `buildTdahActivityTriggerEvent`) so `runNightlyTdahTick`'s caller
 * (server.ts) never constructs the envelope itself, only serializes and
 * pushes what this returns.
 */
export const buildTdahRitualInvitationEvent = (now: Date): TdahWsRitualInvitationEvent => ({
    kind: 'ritual-invitation',
    at: now.toISOString(),
});

/**
 * One namespace's share of a tick. Never throws: any storage failure — even
 * one from the very first read (a corrupted database, an unreadable file) —
 * is caught and reported as `{ kind: 'failed' }` so the caller can log it and
 * move on to the next namespace. The whole function body is deliberately one
 * try block, not just the write path: a throw from `readTdahProfile` here is
 * exactly as much "one namespace's failure" as a throw from the write
 * transaction, and must isolate the same way (a prior version only wrapped
 * the read/write-transaction calls, which let a bad profile read escape and
 * abort the entire tick for every other namespace).
 *
 * 'fired' covers every tick that did write work — a full ritual fire
 * (generatedCount > 0), a sweep-only close of late or stale Actividades
 * (generatedCount 0, limboCount > 0), and a mark-only ritual invitation
 * (both counts 0, `ritualEvent` non-null — tomorrow already existed and
 * nothing was left to sweep, but the namespace hadn't been invited yet today)
 * all count; `generatedCount` reports only Actividades actually created,
 * never the existing count of an already-present tomorrow plan.
 *
 * `hasOpenConnection` gates the ritual-invitation mark/push (story 3.1,
 * AD-5): closing/generation stay exactly as unconditional as story 1.5 left
 * them, but marking `ritual_notified_date` and returning a non-null
 * `ritualEvent` only ever happens when there is an open WS connection to
 * push to — with no connection, the mark is skipped entirely (never set)
 * so the very next tick re-evaluates and retries, same local day, once the
 * phone reconnects (the same reconnect discipline `activity-trigger.ts`'s
 * own doc comment already documents for its start/end milestones).
 */
const runNamespaceTick = async (
    dataDir: string,
    key: string,
    now: Date,
    hasOpenConnection: (key: string) => boolean,
): Promise<NamespaceTickOutcome> => {
    try {
        const profile = await readTdahProfile(dataDir, key);
        if (!profile || profile.mode !== 'on') {
            return { kind: 'skipped' };
        }
        if (!isRitualHourReached(profile.timeZone, profile.ritualHour, now)) {
            return { kind: 'skipped' };
        }

        const today = formatDateInTimeZone(now, profile.timeZone);
        const tomorrow = computeTomorrowDate(profile.timeZone, now);
        // Story 4.3 — every DND input derives from the PROFILE's zone: the
        // wall clock via `computeLocalTimeOfDay`, and the weekday from the
        // already-resolved `today` string (never `now.getDay()`, which reports
        // the process's own day and would misfire every weekly rule for a
        // profile whose local date differs from the server's).
        const nowTimeOfDay = computeLocalTimeOfDay(profile.timeZone, now);
        const weekday = computeLocalWeekday(today);
        const databasePath = tdahDatabasePath(dataDir, key);

        // Steady-state guard: open the write transaction only when there is
        // real work — tomorrow's plan is missing (generate), any Actividad
        // is still pending/started on today or a stale earlier day (sweep
        // close), OR the ritual invitation is still due today and there is
        // an open connection to push it to (mark-only fire). A namespace
        // already through tonight's ritual (plan generated, nothing to
        // sweep, already invited today) matches none of the three and stays
        // entirely read-only until the next local day.
        //
        // Story 4.3 widens the third clause with `|| dndActive`, and the OR is
        // the whole point: an active DND window must reach the write
        // transaction so it can SEAL the invitation, even (especially) when
        // there is no socket. The two gates are exact opposites —
        // `hasOpenConnection === false` means "mark nothing, retry on
        // reconnect", `dndActive === true` means "mark it and send nothing,
        // ever" — so a namespace in a meeting with a dropped socket must not
        // fall through the connection gate and get the whole backlog on
        // reconnect.
        const needsWrite = await withReadDatabase(databasePath, (database) => {
            const dndActive = resolveDndActive(readEffectiveDndWindows(database), today, weekday, nowTimeOfDay).active;
            const ritualInvitationDue = readRitualNotifiedDate(database) !== today
                && (hasOpenConnection(key) || dndActive);
            return !hasDayPlan(database, tomorrow) || hasPendingOrStartedUpTo(database, today) || ritualInvitationDue;
        });
        if (!needsWrite) {
            return { kind: 'skipped' };
        }
        const result = await withWriteTransaction(databasePath, (database) => {
            // Story 4.3, "Never": the close and the generate are OUTSIDE every
            // DND condition, unconditionally, exactly as story 1.5 left them.
            // The DND silences the INVITATION (N-03), never the sweep that
            // precedes it — a suppressed day still closes, still limboes what
            // was left pending, and still generates tomorrow.
            const closed = mutateCloseOutgoingDay(database, today);
            const generated = mutateGenerateTomorrowIfMissing(database, tomorrow);
            // Re-evaluated INSIDE the held write transaction — never trusts
            // the pre-transaction read above (same discipline
            // `mutateMarkDueActivityTriggersNotified` documents for its own
            // due-milestone re-check): an open connection can drop between
            // the read and the write, and marking must stay atomic with the
            // close/generate write it shares this transaction with.
            let ritualEvent: TdahWsRitualInvitationEvent | null = null;
            let ritualSuppressed = false;
            if (readRitualNotifiedDate(database) !== today) {
                // DND is checked FIRST, over the same handle: a suppressed
                // invitation must seal whether or not a socket exists, whereas
                // the connection gate deliberately seals nothing. Reversing
                // these two turns suppression into recovery.
                if (resolveDndActive(readEffectiveDndWindows(database), today, weekday, nowTimeOfDay).active) {
                    mutateMarkRitualNotified(database, today);
                    ritualSuppressed = true;
                } else if (hasOpenConnection(key)) {
                    mutateMarkRitualNotified(database, today);
                    ritualEvent = buildTdahRitualInvitationEvent(now);
                }
            }
            return { closed, generated, ritualEvent, ritualSuppressed };
        });
        // The narrow race `needsWrite`'s own doc comment above flags:
        // `!hasDayPlan`/`hasPendingOrStartedUpTo` are stable DB facts that
        // cannot flip between the pre-transaction read and this write (no
        // other writer can interleave once BEGIN IMMEDIATE is held), so
        // whichever of them made `needsWrite` true here still holds — but
        // `hasOpenConnection` is a live external signal that genuinely can
        // flip (the socket drops in that exact window). When `needsWrite`
        // was true SOLELY because a connection was open a moment ago, and it
        // is gone by the time this transaction re-checks, every one of the
        // three write outcomes below is a no-op — that tick did nothing at
        // all and must be reported as `skipped`, not `fired`, or
        // `firedCount` inflates for ticks with zero real effect.
        //
        // Story 4.3 adds `ritualSuppressed` to this check: a sealed-and-
        // discarded invitation IS real write work (the dedupe column moved),
        // so reporting it as `skipped` would hide the suppression from the
        // audit line entirely.
        if (
            result.closed.limboCount === 0
            && !result.generated.created
            && result.ritualEvent === null
            && !result.ritualSuppressed
        ) {
            return { kind: 'skipped' };
        }
        return {
            kind: 'fired',
            generatedCount: result.generated.created ? result.generated.activityCount : 0,
            limboCount: result.closed.limboCount,
            ritualEvent: result.ritualEvent,
            ritualSuppressed: result.ritualSuppressed,
        };
    } catch (error) {
        return { kind: 'failed', code: getFsErrorCode(error) };
    }
};

/** Default `hasOpenConnection` for callers that never pass one (every pre-3.1 call site) — no connection is ever "open", so the ritual invitation never marks/fires and behavior stays byte-identical to before this story. */
const NO_OPEN_CONNECTIONS = (): boolean => false;
/** Default `onRitualInvitationFire` for callers that never pass one — a no-op, paired with `NO_OPEN_CONNECTIONS` above so it can never actually be invoked by a caller that opted out of the WS push. */
const NOOP_RITUAL_INVITATION_FIRE = (): void => undefined;

/**
 * Runs one nightly tick across every namespace with a TDAH database. Never
 * throws — every per-namespace failure is caught, logged (one
 * `'tdah nightly trigger namespace failed'` `logError`, distinct from the
 * generic inbound-request `'request failed'` message so background-job
 * failures never get conflated with real request failures in log
 * search/alerting, `.code` only — never a namespace key or Activity title in
 * clear text), and counted, while every other namespace in the same tick
 * fires normally.
 *
 * Deliberately does not log its own aggregate summary — mirrors
 * `pruneOrphanedCalendarFeeds` (`server-calendar-feed.ts`), a pure function
 * that returns counts and lets its caller (`server.ts`'s interval callback)
 * own the one `'tdah nightly trigger fired'` audit line.
 *
 * `hasOpenConnection`/`onRitualInvitationFire` (story 3.1) are injected
 * predicates/callbacks — same shape and same testability reasoning as
 * `activity-trigger.ts`'s `runActivityTriggerTick` — with defaults that
 * disable the ritual-invitation push entirely, so the many pre-3.1 callers
 * (including `server.test.ts`'s own direct test of
 * `runTdahNightlyIntervalTick`) keep compiling and behaving unchanged without
 * having to pass anything new. server.ts's real interval wiring is the only
 * caller that supplies real ones, mirroring its own activity-trigger timer:
 * `hasOpenConnection` reads `tdahWsRegistry.connectionCount(key) > 0` and
 * `onRitualInvitationFire` serializes the event and `ws.send`s it to every
 * open connection for that namespace.
 */
export async function runNightlyTdahTick(
    dataDir: string,
    now: Date,
    hasOpenConnection: (key: string) => boolean = NO_OPEN_CONNECTIONS,
    onRitualInvitationFire: (key: string, event: TdahWsRitualInvitationEvent) => void = NOOP_RITUAL_INVITATION_FIRE,
): Promise<TdahNightlyTickSummary> {
    const namespaces = listActiveTdahNamespaces(dataDir);
    const summary: TdahNightlyTickSummary = {
        date: formatDateInTimeZone(now, 'UTC'),
        namespaceCount: namespaces.length,
        firedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        generatedCount: 0,
        limboCount: 0,
        ritualPushFailedCount: 0,
        suppressedCount: 0,
    };

    for (const key of namespaces) {
        const outcome = await runNamespaceTick(dataDir, key, now, hasOpenConnection);
        if (outcome.kind === 'skipped') {
            summary.skippedCount += 1;
        } else if (outcome.kind === 'fired') {
            summary.firedCount += 1;
            summary.generatedCount += outcome.generatedCount;
            summary.limboCount += outcome.limboCount;
            if (outcome.ritualSuppressed) summary.suppressedCount += 1;
            if (outcome.ritualEvent) {
                // The notified mark is already durably committed by this
                // point (inside `mutateMarkRitualNotified`'s own write
                // transaction, above) — same "the push can fail, the mark
                // never re-fires" isolation `activity-trigger.ts`'s own
                // `onFire` try/catch documents, so one bad push (a closing
                // socket) can never cause a re-fire on the next tick, nor
                // abort the remaining namespaces still left in this loop.
                // Its own dedicated message/failureCode (mirrors
                // 'tdah activity trigger onFire failed'/
                // 'tdah_activity_trigger_onfire_failed'), distinct from a
                // genuine namespace write failure — the write already
                // succeeded here, only the push itself threw.
                try {
                    onRitualInvitationFire(key, outcome.ritualEvent);
                } catch (error) {
                    summary.ritualPushFailedCount += 1;
                    logError('tdah nightly ritual invitation push failed', {
                        failureClass: 'runtime',
                        failureCode: 'tdah_ritual_invitation_push_failed',
                        failureErrno: getFsErrorCode(error),
                    });
                }
            }
        } else {
            summary.failedCount += 1;
            logError('tdah nightly trigger namespace failed', {
                failureClass: 'filesystem',
                failureCode: 'tdah_nightly_tick_failed',
                failureErrno: outcome.code,
            });
        }
    }

    return summary;
}

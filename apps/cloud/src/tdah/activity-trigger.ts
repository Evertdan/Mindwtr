/**
 * Story 2.2 — the activity-trigger tick: per namespace, per tick, detects
 * every Actividad whose `startTime` ("start" milestone) or
 * `startTime + durationMinutes` ("end" milestone) has just crossed and
 * hasn't been notified yet, durably marks it notified
 * (`storage.ts`'s `mutateMarkDueActivityTriggersNotified` — a persisted
 * column, never an in-memory set, so a server restart between the milestone
 * and the actual disparo never re-fires or drops it), and reports each fired
 * milestone to the caller via `onFire`.
 *
 * Mirrors `scheduler.ts`'s `runNightlyTdahTick`/`runNamespaceTick` split
 * (`dataDir` + `now` in, summary out; per-namespace failures isolated,
 * logged, and never abort the whole tick) with one deliberate divergence: a
 * namespace with no open WS connection right now is skipped WITHOUT marking
 * anything notified, so "nobody to push to this instant" never becomes "this
 * Actividad's notification silently never fires" — the very next tick, once
 * `hasOpenConnection` flips true (the phone reconnects), re-evaluates and
 * fires normally. This is the spec's own edge case: "sin conexión WS al
 * momento del disparo ... al reconectar, el tick vuelve a evaluar y dispara
 * si la Actividad sigue sin marca de notificado — ningún disparo se pierde
 * silenciosamente por más de un ciclo de reconexión."
 *
 * Story 4.2 adds N-04, the grouped Jira work band's single notification, onto
 * this exact same tick — deliberately NOT a fourth `setInterval`. The band is
 * already a `tdah_activity` row with a `start_time` and a `state`, so this tick
 * already walks it with the profile's time zone resolved and the correct
 * connection gate; mounting N-04 here reuses the dedupe column
 * (`start_notified_at`), the latency and the audit line for free. The only
 * surgery needed was negative: `origin = 'jira'` is now excluded from the
 * N-01/N-02 candidate query (storage.ts), because the band used to match it and
 * fire BOTH a start and an end notification — the per-band avalanche FR-11
 * forbids. The band fires exactly one `work-band` event at its start, and
 * nothing at its end.
 *
 * `hasOpenConnection` is injected as a plain predicate rather than this file
 * importing `ws-channel.ts`'s real connection registry directly, so the tick
 * stays testable with a fake predicate — no real socket, port, or process
 * needed. server.ts is the only real caller; it wires `hasOpenConnection` to
 * `tdahWsRegistry.connectionCount(key) > 0` and `onFire` to iterating
 * `tdahWsRegistry.connectionsFor(key)` and `ws.send(...)`ing the built event.
 */
import { getFsErrorCode } from '../server-storage';
import { logError } from '../server-config';
import { computeLocalTimeOfDay } from './scheduler';
import { computeLocalWeekday, resolveDndActive } from './dnd';
import {
    formatDateInTimeZone,
    hasDueActivityTriggers,
    hasDueWorkBandTrigger,
    listActiveTdahNamespaces,
    mutateMarkDueActivityTriggersNotified,
    mutateMarkDueWorkBandNotified,
    readEffectiveDndWindows,
    readTdahProfile,
    tdahDatabasePath,
    withReadDatabase,
    withWriteTransaction,
    type TdahActivityTriggerFire,
    type TdahWorkBandTriggerFire,
} from './storage';
import type { TdahActivityTriggerTickSummary, TdahWsActivityTriggerEvent, TdahWsWorkBandEvent } from './types';

/**
 * Builds the ready-to-send WS event from one persisted-and-marked fire —
 * server.ts's real wiring only ever `ws.send(JSON.stringify(...))`s this,
 * never constructs the envelope itself.
 */
export const buildTdahActivityTriggerEvent = (fire: TdahActivityTriggerFire, now: Date): TdahWsActivityTriggerEvent => ({
    kind: 'activity-trigger',
    edge: fire.edge,
    activityId: fire.id,
    title: fire.title,
    durationMinutes: fire.durationMinutes,
    startTime: fire.startTime,
    at: now.toISOString(),
});

/**
 * Story 4.2 — N-04's ready-to-send event, the exact counterpart of
 * `buildTdahActivityTriggerEvent` above. One per band, at its start, ever: the
 * band is excluded from the N-01/N-02 candidate query, so it can never also
 * produce a start and an end `activity-trigger`, and there is deliberately no
 * end-of-band event at all.
 */
export const buildTdahWorkBandEvent = (fire: TdahWorkBandTriggerFire, now: Date): TdahWsWorkBandEvent => ({
    kind: 'work-band',
    activityId: fire.id,
    title: fire.title,
    startTime: fire.startTime,
    durationMinutes: fire.durationMinutes,
    itemCount: fire.itemCount,
    at: now.toISOString(),
});

type NamespaceActivityTriggerOutcome =
    | { kind: 'skipped' }
    | { kind: 'fired'; events: TdahWsActivityTriggerEvent[]; workBandEvents: TdahWsWorkBandEvent[] }
    /**
     * Story 4.3 — a DND window was active, so every due milestone had its
     * dedupe column marked (exactly as a real fire marks it) and NO event was
     * built. Deliberately a third outcome rather than a `fired` with an empty
     * event list: the tick genuinely wrote, so it is not `skipped`, and it
     * genuinely notified nobody, so it must never inflate `firedEventCount`.
     */
    | { kind: 'suppressed'; suppressedCount: number }
    | { kind: 'failed'; code: string };

/**
 * One namespace's share of a tick. Never throws — the same
 * one-try-block-around-everything discipline `scheduler.ts`'s
 * `runNamespaceTick` uses, so a bad profile read or a storage failure is
 * exactly as much "one namespace's failure" as a write-transaction throw,
 * and isolates the same way.
 */
const runNamespaceActivityTriggerTick = async (
    dataDir: string,
    key: string,
    now: Date,
    hasOpenConnection: (key: string) => boolean,
): Promise<NamespaceActivityTriggerOutcome> => {
    try {
        const profile = await readTdahProfile(dataDir, key);
        if (!profile || profile.mode !== 'on') {
            return { kind: 'skipped' };
        }

        // Story 4.3 REORDERED this function's gates, and the order is the
        // contract:
        //
        //   profile -> zone/clock -> one read pass (dnd + due) -> SUPPRESS
        //   -> hasOpenConnection -> fire
        //
        // The `hasOpenConnection` check used to sit right here, above
        // everything. It now sits below the suppression branch, because the
        // two gates are exact opposites (see the block comment at the
        // suppression branch itself). Moving it back up would mean a user
        // whose socket happened to be down during a meeting seals nothing and
        // receives the whole backlog on reconnect — the notification fatigue
        // (SM-C1) this epic exists to prevent.
        const today = formatDateInTimeZone(now, profile.timeZone);
        const nowTimeOfDay = computeLocalTimeOfDay(profile.timeZone, now);
        // The weekday comes from the already-zone-resolved `today` string, not
        // from `now` — see `computeLocalWeekday`'s own doc comment for the
        // Pacific/Auckland case that makes `now.getDay()` wrong.
        const weekday = computeLocalWeekday(today);
        const databasePath = tdahDatabasePath(dataDir, key);

        // Steady-state guard, mirroring scheduler.ts's own `needsWrite`
        // check: a read-only pass serves the overwhelming-majority case
        // (nothing due yet), and only a namespace with a real milestone to
        // fire pays for a write transaction.
        //
        // Story 4.2 — the work band rides the SAME read, the same `today`/
        // `nowTimeOfDay`, the same `hasOpenConnection` gate (the one that
        // deliberately marks nothing when there is no socket, so a reconnect
        // inside the same local day still delivers N-04) and the same write
        // transaction. That is the whole reason N-04 lives here and not in a
        // fourth `setInterval`.
        //
        // Story 4.3 — the DND windows ride this same single read pass rather
        // than paying for a second open: a namespace with nothing due never
        // even looks at whether it is silenced, because there is nothing to
        // silence.
        const pass = await withReadDatabase(databasePath, (database) => ({
            dndActive: resolveDndActive(readEffectiveDndWindows(database), today, weekday, nowTimeOfDay).active,
            due: hasDueActivityTriggers(database, today, nowTimeOfDay)
                || hasDueWorkBandTrigger(database, today, nowTimeOfDay),
        }));
        if (!pass.due) {
            return { kind: 'skipped' };
        }

        // SUPPRESSION, before the connection gate. The two gates look alike and
        // are opposites:
        //
        //   hasOpenConnection === false  ->  mark NOTHING  ->  reconnect recovers  (Epic 2 / 4.2)
        //   dndActive         === true   ->  MARK it       ->  nothing is ever recovered (FR-12)
        //
        // So suppression must happen whether or not a socket exists. Sealing
        // is literally calling the same `mutateMark*Notified` writes the firing
        // path calls and THROWING THE RESULT AWAY: no queue, no `suppressed_at`
        // column, no deferral. The row is already marked, which is what makes a
        // later delivery structurally impossible rather than merely unlikely.
        if (pass.dndActive) {
            const sealedCount = await withWriteTransaction(databasePath, (database) => {
                // Re-evaluated inside the held transaction, same discipline the
                // marking writes themselves follow. A window that ended in the
                // gap between the read and the write is not suppressed at all;
                // the `null` falls through to the ordinary firing path below.
                if (!resolveDndActive(readEffectiveDndWindows(database), today, weekday, nowTimeOfDay).active) return null;
                const notifiedAtIso = now.toISOString();
                const fires = mutateMarkDueActivityTriggersNotified(database, today, nowTimeOfDay, notifiedAtIso);
                const bandFires = mutateMarkDueWorkBandNotified(database, today, nowTimeOfDay, notifiedAtIso);
                return fires.length + bandFires.length;
            });
            if (sealedCount !== null) {
                // Zero means another tick won the race and already marked
                // everything — nothing was suppressed here, so it is a plain
                // skip, exactly like the firing path's own lost-race branch.
                return sealedCount === 0 ? { kind: 'skipped' } : { kind: 'suppressed', suppressedCount: sealedCount };
            }
        }

        // No live socket to push to right now — never mark anything notified
        // (see this file's own doc comment on the reconnect edge case). Reached
        // only when the DND is NOT active, which is what preserves story
        // 2.2/4.2's reconnect behavior byte for byte.
        if (!hasOpenConnection(key)) {
            return { kind: 'skipped' };
        }

        const marked = await withWriteTransaction(databasePath, (database) => ({
            fires: mutateMarkDueActivityTriggersNotified(database, today, nowTimeOfDay, now.toISOString()),
            bandFires: mutateMarkDueWorkBandNotified(database, today, nowTimeOfDay, now.toISOString()),
        }));
        if (marked.fires.length === 0 && marked.bandFires.length === 0) {
            // Lost the race against another read between the pre-check and
            // the write transaction (e.g. a previous tick already marked
            // it) — not a failure, just nothing left to report.
            return { kind: 'skipped' };
        }
        return {
            kind: 'fired',
            events: marked.fires.map((fire) => buildTdahActivityTriggerEvent(fire, now)),
            workBandEvents: marked.bandFires.map((fire) => buildTdahWorkBandEvent(fire, now)),
        };
    } catch (error) {
        return { kind: 'failed', code: getFsErrorCode(error) };
    }
};

/**
 * Runs one activity-trigger tick across every namespace with a TDAH
 * database. Never throws — every per-namespace failure is caught, logged
 * (one `'tdah activity trigger namespace failed'` `logError`, `.code`
 * only — never a namespace key or Activity title in clear text), and
 * counted, while every other namespace in the same tick fires normally.
 *
 * `onFire` is called once per fired event, synchronously, strictly AFTER
 * that event's notified mark is already durably committed inside
 * `mutateMarkDueActivityTriggersNotified`'s transaction — so a throw from
 * `onFire` itself (e.g. a `ws.send` on an already-closing socket) can never
 * cause a re-fire on the next tick; the mark is already permanent regardless
 * of whether the push itself lands. Each call is individually try/caught
 * (logged as `'tdah activity trigger onFire failed'`, `.code` only) so one
 * bad push — e.g. one closing socket in namespace A — can never abort the
 * remaining events for that namespace, nor the remaining namespaces still
 * left in this same tick's `for` loop; this is the actual per-namespace
 * isolation the rest of this function's own doc comment above claims,
 * mirroring `scheduler.ts`'s `runNightlyTdahTick`.
 *
 * `onWorkBandFire` (story 4.2) is N-04's own sink, kept SEPARATE from `onFire`
 * rather than widening it to a union — the same split `scheduler.ts` already
 * draws between `hasOpenConnection` and `onRitualInvitationFire`. It is
 * optional (defaulting to a no-op) so a caller that only cares about N-01/N-02
 * keeps working unchanged; `server.ts`'s real 15s timer supplies both.
 */
export async function runActivityTriggerTick(
    dataDir: string,
    now: Date,
    hasOpenConnection: (key: string) => boolean,
    onFire: (key: string, event: TdahWsActivityTriggerEvent) => void,
    onWorkBandFire: (key: string, event: TdahWsWorkBandEvent) => void = () => {},
): Promise<TdahActivityTriggerTickSummary> {
    const namespaces = listActiveTdahNamespaces(dataDir);
    const summary: TdahActivityTriggerTickSummary = {
        date: formatDateInTimeZone(now, 'UTC'),
        namespaceCount: namespaces.length,
        firedNamespaceCount: 0,
        firedEventCount: 0,
        firedWorkBandCount: 0,
        skippedCount: 0,
        failedCount: 0,
        suppressedCount: 0,
    };

    for (const key of namespaces) {
        const outcome = await runNamespaceActivityTriggerTick(dataDir, key, now, hasOpenConnection);
        if (outcome.kind === 'skipped') {
            summary.skippedCount += 1;
        } else if (outcome.kind === 'suppressed') {
            // Story 4.3 — counted on its own axis and NOWHERE else: not in
            // `firedNamespaceCount` (nothing was pushed), not in
            // `firedEventCount`/`firedWorkBandCount` (no event exists), not in
            // `skippedCount` (the tick did write). There is no sink to call:
            // the whole point is that nothing leaves the server.
            summary.suppressedCount += outcome.suppressedCount;
        } else if (outcome.kind === 'fired') {
            summary.firedNamespaceCount += 1;
            summary.firedEventCount += outcome.events.length;
            summary.firedWorkBandCount += outcome.workBandEvents.length;
            for (const event of outcome.events) {
                try {
                    onFire(key, event);
                } catch (error) {
                    // The notified mark for this event is already durably
                    // committed (see this function's own doc comment) — only
                    // the push itself failed, so this is logged and skipped,
                    // never rethrown, never a reason to abort the remaining
                    // events or namespaces in this tick.
                    logError('tdah activity trigger onFire failed', {
                        failureClass: 'runtime',
                        failureCode: 'tdah_activity_trigger_onfire_failed',
                        failureErrno: getFsErrorCode(error),
                    });
                }
            }
            for (const event of outcome.workBandEvents) {
                try {
                    onWorkBandFire(key, event);
                } catch (error) {
                    // Identical contract to `onFire` above: the band's
                    // `start_notified_at` seal is already durable, so a failed
                    // push is logged and dropped — never retried, since a retry
                    // would be the second notification FR-11 forbids.
                    logError('tdah activity trigger onFire failed', {
                        failureClass: 'runtime',
                        failureCode: 'tdah_activity_trigger_onfire_failed',
                        failureErrno: getFsErrorCode(error),
                    });
                }
            }
        } else {
            summary.failedCount += 1;
            logError('tdah activity trigger namespace failed', {
                failureClass: 'filesystem',
                failureCode: 'tdah_activity_trigger_tick_failed',
                failureErrno: outcome.code,
            });
        }
    }

    return summary;
}

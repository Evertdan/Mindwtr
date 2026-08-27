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
import {
    formatDateInTimeZone,
    hasDueActivityTriggers,
    listActiveTdahNamespaces,
    mutateMarkDueActivityTriggersNotified,
    readTdahProfile,
    tdahDatabasePath,
    withReadDatabase,
    withWriteTransaction,
    type TdahActivityTriggerFire,
} from './storage';
import type { TdahActivityTriggerTickSummary, TdahWsActivityTriggerEvent } from './types';

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

type NamespaceActivityTriggerOutcome =
    | { kind: 'skipped' }
    | { kind: 'fired'; events: TdahWsActivityTriggerEvent[] }
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
        // No live socket to push to right now — never mark anything
        // notified (see this file's own doc comment on the reconnect edge
        // case), and checked BEFORE the profile read so a disconnected
        // namespace never pays that disk I/O on every 15s tick.
        if (!hasOpenConnection(key)) {
            return { kind: 'skipped' };
        }
        const profile = await readTdahProfile(dataDir, key);
        if (!profile || profile.mode !== 'on') {
            return { kind: 'skipped' };
        }

        const today = formatDateInTimeZone(now, profile.timeZone);
        const nowTimeOfDay = computeLocalTimeOfDay(profile.timeZone, now);
        const databasePath = tdahDatabasePath(dataDir, key);

        // Steady-state guard, mirroring scheduler.ts's own `needsWrite`
        // check: a read-only pass serves the overwhelming-majority case
        // (nothing due yet), and only a namespace with a real milestone to
        // fire pays for a write transaction.
        const needsWrite = await withReadDatabase(databasePath, (database) => (
            hasDueActivityTriggers(database, today, nowTimeOfDay)
        ));
        if (!needsWrite) {
            return { kind: 'skipped' };
        }

        const fires = await withWriteTransaction(databasePath, (database) => (
            mutateMarkDueActivityTriggersNotified(database, today, nowTimeOfDay, now.toISOString())
        ));
        if (fires.length === 0) {
            // Lost the race against another read between the pre-check and
            // the write transaction (e.g. a previous tick already marked
            // it) — not a failure, just nothing left to report.
            return { kind: 'skipped' };
        }
        return { kind: 'fired', events: fires.map((fire) => buildTdahActivityTriggerEvent(fire, now)) };
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
 */
export async function runActivityTriggerTick(
    dataDir: string,
    now: Date,
    hasOpenConnection: (key: string) => boolean,
    onFire: (key: string, event: TdahWsActivityTriggerEvent) => void,
): Promise<TdahActivityTriggerTickSummary> {
    const namespaces = listActiveTdahNamespaces(dataDir);
    const summary: TdahActivityTriggerTickSummary = {
        date: formatDateInTimeZone(now, 'UTC'),
        namespaceCount: namespaces.length,
        firedNamespaceCount: 0,
        firedEventCount: 0,
        skippedCount: 0,
        failedCount: 0,
    };

    for (const key of namespaces) {
        const outcome = await runNamespaceActivityTriggerTick(dataDir, key, now, hasOpenConnection);
        if (outcome.kind === 'skipped') {
            summary.skippedCount += 1;
        } else if (outcome.kind === 'fired') {
            summary.firedNamespaceCount += 1;
            summary.firedEventCount += outcome.events.length;
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

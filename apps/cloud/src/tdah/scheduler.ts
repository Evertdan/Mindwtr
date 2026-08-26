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
 * Idempotent via tomorrow's `tdah_day_plan` row (its existing PRIMARY KEY,
 * unchanged from story 1.3/1.4): a namespace whose tomorrow-DayPlan already
 * exists is skipped by a cheap read (`hasDayPlan`), without ever opening a
 * write transaction. Closing is separately idempotent because it only ever
 * touches rows still in `pending`/`started`.
 *
 * A write failure for one namespace is logged (`.code` only, never a raw
 * message or a namespace key — AGENTS.md's privacy rule) and left for the
 * next tick's retry; it never aborts or delays any other namespace's firing
 * in the same tick.
 */
import { getFsErrorCode } from '../server-storage';
import { logError } from '../server-config';
import {
    computeTomorrowDate,
    formatDateInTimeZone,
    hasDayPlan,
    listActiveTdahNamespaces,
    mutateCloseOutgoingDay,
    mutateGenerateTomorrowIfMissing,
    readTdahProfile,
    tdahDatabasePath,
    withReadDatabase,
    withWriteTransaction,
} from './storage';
import type { TdahNightlyTickSummary } from './types';

/**
 * "HH:mm" wall-clock time in `timeZone` at `now`, resolved through
 * `Intl.DateTimeFormat` rather than manual UTC-offset math — the same
 * "never bypass Intl for calendar/time-zone work" convention `storage.ts`'s
 * `weekdayOfDate`/`formatDateInTimeZone` already establish. Zero-padded
 * (`hourCycle: 'h23'`), so it's directly comparable, lexically, against the
 * profile's own zero-padded `ritualHour` string.
 */
const computeLocalTimeOfDay = (timeZone: string, now: Date): string => (
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
);

const isRitualHourReached = (timeZone: string, ritualHour: string, now: Date): boolean => (
    computeLocalTimeOfDay(timeZone, now) >= ritualHour
);

type NamespaceTickOutcome =
    | { kind: 'skipped' }
    | { kind: 'fired'; generatedCount: number; limboCount: number }
    | { kind: 'failed'; code: string };

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
 */
const runNamespaceTick = async (dataDir: string, key: string, now: Date): Promise<NamespaceTickOutcome> => {
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
        const databasePath = tdahDatabasePath(dataDir, key);

        const alreadyGenerated = await withReadDatabase(databasePath, (database) => hasDayPlan(database, tomorrow));
        if (alreadyGenerated) {
            return { kind: 'skipped' };
        }
        const result = await withWriteTransaction(databasePath, (database) => {
            const closed = mutateCloseOutgoingDay(database, today);
            const generated = mutateGenerateTomorrowIfMissing(database, tomorrow, profile.timeZone);
            return { closed, generated };
        });
        return {
            kind: 'fired',
            generatedCount: result.generated.activityCount,
            limboCount: result.closed.limboCount,
        };
    } catch (error) {
        return { kind: 'failed', code: getFsErrorCode(error) };
    }
};

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
 */
export async function runNightlyTdahTick(dataDir: string, now: Date): Promise<TdahNightlyTickSummary> {
    const namespaces = listActiveTdahNamespaces(dataDir);
    const summary: TdahNightlyTickSummary = {
        date: formatDateInTimeZone(now, 'UTC'),
        namespaceCount: namespaces.length,
        firedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        generatedCount: 0,
        limboCount: 0,
    };

    for (const key of namespaces) {
        const outcome = await runNamespaceTick(dataDir, key, now);
        if (outcome.kind === 'skipped') {
            summary.skippedCount += 1;
        } else if (outcome.kind === 'fired') {
            summary.firedCount += 1;
            summary.generatedCount += outcome.generatedCount;
            summary.limboCount += outcome.limboCount;
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

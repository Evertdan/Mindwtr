/**
 * Story 4.1 — the Origen de trabajo's pull tick.
 *
 * Modelled directly on `activity-trigger.ts` (and, through it, on
 * `scheduler.ts`): `dataDir` + `now` in, a counts-only summary out; one
 * `try` block per namespace so a failure isolates instead of aborting the
 * sweep; every failure logged with a `.code` only.
 *
 * Two independent gates decide whether a namespace pulls, and NEITHER is
 * wall-clock arithmetic — this is the timezone bug class that has already
 * cost this module twice (stories 1.5 and 2.2):
 *
 * 1. **Working hours** — `computeLocalTimeOfDay(profile.timeZone, now)`
 *    compared lexically against the persisted `HH:mm` window, exactly as
 *    `isRitualHourReached` compares against `ritualHour`. Outside the window
 *    there is NO outbound request and NO write at all: a user asleep at 07:00
 *    generates no Atlassian traffic (I/O Matrix: "ni salida de red ni
 *    escritura").
 * 2. **Interval** — elapsed UTC milliseconds since `last_pull_at`
 *    (`now.getTime() - Date.parse(lastPullAt)`), never a comparison of two
 *    wall clocks. Absolute elapsed time is the only thing that survives a DST
 *    jump or a time-zone change without either double-firing or stalling for
 *    an hour.
 *
 * Nothing is ever cached between ticks: the profile and the Origen row are
 * re-read fresh every time, so a `PUT /v1/tdah/origin` that changes the
 * window or the cadence takes effect on the very next tick with zero
 * invalidation logic — the same discipline the nightly scheduler already
 * follows.
 *
 * Failure always degrades rather than escalates. Every failure class persists
 * its own `last_error_code` (surfaced verbatim on T-13) and advances
 * `last_pull_at` so the next attempt honours the configured cadence instead
 * of retrying every 60 seconds. No personal Actividad ever changes state
 * because a pull failed (AC 4), and the credential is never deleted.
 */
import { getFsErrorCode } from '../server-storage';
import { logError } from '../server-config';
import { computeLocalTimeOfDay } from './scheduler';
import { openOriginSecret, resolveOriginEncryptionKey } from './origin-crypto';
import { resolveWorkOriginProvider, type WorkOriginFetch } from './work-origin';
import {
    commitWorkOriginPull,
    formatDateInTimeZone,
    listActiveTdahNamespaces,
    markWorkOriginPullFailure,
    readSealedWorkOriginSecret,
    readTdahProfile,
    readWorkOriginPullPlan,
    TDAH_WORK_ORIGIN_BAND_TITLE,
} from './storage';
import { TDAH_ERRORS, type TdahErrorCode, type TdahOriginPullTickSummary } from './types';

export type WorkOriginPullOutcome =
    | { kind: 'skipped' }
    | { kind: 'synced'; itemCount: number }
    | { kind: 'failed'; errorCode: TdahErrorCode };

export type RunNamespaceWorkOriginPullOptions = {
    /**
     * `true` for `POST /v1/tdah/origin/sync` — T-13's explicit "reintentar"
     * button. A person tapping retry has, by definition, decided that now is
     * the right moment, so both scheduling gates are bypassed; the security
     * and failure handling below are identical either way.
     */
    ignoreSchedule?: boolean;
};

/**
 * `now` is inside `[workStart, workEnd)` in the namespace's own zone.
 *
 * Half-open on purpose: `workEnd` itself is outside the window, so an 18:00
 * end means the last eligible instant is 17:59 — the same convention the band
 * itself encodes (`start_time = workStart`, ending exactly at `workEnd`).
 *
 * A window whose end is not after its start is rejected at parse time
 * (routes.ts), so no midnight-crossing case can reach here.
 */
const isWithinWorkingHours = (timeZone: string, workStart: string, workEnd: string, now: Date): boolean => {
    const localTime = computeLocalTimeOfDay(timeZone, now);
    return localTime >= workStart && localTime < workEnd;
};

/**
 * Has the configured cadence elapsed since the last ATTEMPT? Measured in
 * absolute UTC milliseconds (see this file's header). A never-pulled Origen
 * (`lastPullAt === null`) is always due, so a fresh connection materializes
 * its band on the first eligible tick rather than waiting a full interval. An
 * unparseable timestamp is treated as "never pulled" instead of throwing —
 * degrade, never crash the sweep.
 *
 * A `lastPullAt` in the FUTURE also counts as elapsed. That is not a
 * theoretical case: a backwards NTP step, a corrected clock, or a database
 * restored onto a machine whose clock is behind all produce it, and a naive
 * `elapsed >= interval` would then stall this namespace silently — no pull, no
 * error, nothing to look at — until wall-clock time caught up. Treating it as
 * due self-heals on the very next tick, and the worst case is one extra pull.
 */
const isPullIntervalElapsed = (lastPullAt: string | null, pullIntervalMinutes: number, now: Date): boolean => {
    if (lastPullAt === null) return true;
    const lastPullMs = Date.parse(lastPullAt);
    if (Number.isNaN(lastPullMs)) return true;
    const elapsedMs = now.getTime() - lastPullMs;
    if (elapsedMs < 0) return true;
    return elapsedMs >= pullIntervalMinutes * 60_000;
};

/**
 * One namespace's share of a pull. Never throws — the whole body is a single
 * `try`, exactly like `runNamespaceActivityTriggerTick`, so a corrupt
 * database, a retired IANA zone or an exploding provider are all equally
 * "this namespace's failure" and isolate identically.
 *
 * Exported so `POST /v1/tdah/origin/sync` can run precisely this logic for
 * one namespace instead of re-implementing the gates, the sealing dance and
 * the failure bookkeeping a second time.
 */
export const runNamespaceWorkOriginPull = async (
    dataDir: string,
    key: string,
    now: Date,
    fetchImpl: WorkOriginFetch,
    options: RunNamespaceWorkOriginPullOptions = {},
): Promise<WorkOriginPullOutcome> => {
    /**
     * EVERY failure exits through here — the credential, unreachable,
     * key-unavailable, unknown-provider and day-full paths as well as the
     * storage throw below. Previously only the storage throw logged, which
     * meant an operator reading `'tdah origin pull fired'` could see
     * `failedCount: 12` with not a single corresponding namespace line to
     * investigate.
     *
     * Its own background-job message/code, never the generic inbound-request
     * `'request failed'` — the same split `'tdah nightly trigger namespace
     * failed'` already draws, so an Origen failure can never be conflated with
     * a real request failure in log search.
     *
     * The context is codes only: `failureErrno` carries the stable `TDAH_…`
     * classification (or the fs/sqlite `.code`), never the token, the site
     * host, the account email, or a caught error's message — all three of
     * which are exactly what an outbound-request failure's message embeds.
     */
    const fail = (
        errorCode: TdahErrorCode,
        failureClass: 'filesystem' | 'runtime',
        failureErrno?: string,
    ): WorkOriginPullOutcome => {
        logError('tdah origin pull namespace failed', {
            failureClass,
            failureCode: 'tdah_origin_pull_failed',
            failureErrno: failureErrno ?? errorCode,
        });
        return { kind: 'failed', errorCode };
    };

    try {
        const profile = await readTdahProfile(dataDir, key);
        if (!profile || profile.mode !== 'on') return { kind: 'skipped' };

        const plan = await readWorkOriginPullPlan(dataDir, key);
        if (!plan) return { kind: 'skipped' };

        if (!options.ignoreSchedule) {
            // Working hours first, deliberately: it is the gate that must
            // guarantee "no outbound request at all", so nothing above it may
            // touch the network or the disk.
            if (!isWithinWorkingHours(profile.timeZone, plan.workStart, plan.workEnd, now)) {
                return { kind: 'skipped' };
            }
            if (!isPullIntervalElapsed(plan.lastPullAt, plan.pullIntervalMinutes, now)) {
                return { kind: 'skipped' };
            }
        }

        const nowIso = now.toISOString();

        // Fail closed: with no operator key there is no way to open the
        // credential, and there is deliberately no plaintext fallback to reach
        // for. Persist the reason so T-13 can tell the user's *operator*
        // problem apart from their own.
        const encryptionKey = resolveOriginEncryptionKey(process.env);
        if (!encryptionKey) {
            await markWorkOriginPullFailure(dataDir, key, nowIso, TDAH_ERRORS.originKeyUnavailable);
            return fail(TDAH_ERRORS.originKeyUnavailable, 'runtime');
        }

        const provider = resolveWorkOriginProvider(plan.provider);
        if (!provider) {
            // Only reachable if a database written by a newer build (with a
            // provider this build does not know) is opened by an older one.
            await markWorkOriginPullFailure(dataDir, key, nowIso, TDAH_ERRORS.originInvalid);
            return fail(TDAH_ERRORS.originInvalid, 'runtime');
        }

        const sealed = await readSealedWorkOriginSecret(dataDir, key);
        // A sealed value that will not open is either a row lifted out of
        // another namespace's SQLite (the AAD check, AD-9's isolation made
        // verifiable) or a rotated/corrupted key. Either way it is a
        // credential the user must re-enter, and the plaintext never existed
        // in this process — `openOriginSecret` returns `null`, never an error
        // carrying the secret.
        const token = sealed === null ? null : openOriginSecret(encryptionKey, key, sealed);
        if (token === null) {
            await markWorkOriginPullFailure(dataDir, key, nowIso, TDAH_ERRORS.originCredentialsInvalid);
            return fail(TDAH_ERRORS.originCredentialsInvalid, 'runtime');
        }

        const outcome = await provider.fetchWorkItems(
            { siteUrl: plan.siteUrl, email: plan.email, token },
            fetchImpl,
        );

        if (outcome.kind === 'invalid-credentials') {
            await markWorkOriginPullFailure(dataDir, key, nowIso, TDAH_ERRORS.originCredentialsInvalid);
            return fail(TDAH_ERRORS.originCredentialsInvalid, 'runtime');
        }
        if (outcome.kind === 'unreachable') {
            await markWorkOriginPullFailure(dataDir, key, nowIso, TDAH_ERRORS.originUnreachable);
            return fail(TDAH_ERRORS.originUnreachable, 'runtime');
        }

        // The band belongs to the user's OWN local day (AD-6), never the
        // process's calendar day — two namespaces pulled by the same tick in
        // Pacific/Kiritimati and UTC legitimately land on different dates.
        const date = formatDateInTimeZone(now, profile.timeZone);
        const commit = await commitWorkOriginPull(dataDir, key, {
            date,
            items: outcome.items,
            pulledAtIso: nowIso,
            workStart: plan.workStart,
            workEnd: plan.workEnd,
            bandTitle: TDAH_WORK_ORIGIN_BAND_TITLE,
        });
        if (commit.kind === 'disconnected') {
            // A DELETE landed while this pull was blocked on the network (up
            // to TDAH_JIRA_REQUEST_TIMEOUT_MS). The user's revocation wins and
            // nothing was written — see `commitWorkOriginPull`'s in-transaction
            // re-check. There is no row left to record anything against, so
            // this is `skipped` rather than a failure to alarm anyone about.
            return { kind: 'skipped' };
        }
        if (commit.band === 'capped') {
            // The snapshot refreshed but the day was already at
            // TDAH_DAY_MAX_ACTIVITIES, so no band exists.
            // `commitWorkOriginPull` persisted TDAH_ORIGIN_DAY_FULL inside
            // that same transaction; reporting it here keeps the tick's counts
            // honest and matches what T-13 renders, instead of a "synced" that
            // silently produced nothing.
            return fail(TDAH_ERRORS.originDayFull, 'runtime');
        }
        return { kind: 'synced', itemCount: outcome.items.length };
    } catch (error) {
        // A storage-level throw. Nothing is persisted here — writing an error
        // code would itself need the storage that just failed — so this
        // namespace simply retries on the next eligible tick.
        return fail(TDAH_ERRORS.storageFailed, 'filesystem', getFsErrorCode(error));
    }
};

/**
 * Runs one Origen pull tick across every namespace with a TDAH database.
 * Never throws: `runNamespaceWorkOriginPull` already absorbs and logs every
 * per-namespace failure, so one broken Origen can never stop another
 * namespace's from syncing in the same tick.
 *
 * `fetchImpl` is injected (defaulting to the global `fetch`) for the same
 * reason `activity-trigger.ts` injects `hasOpenConnection`: the tick stays
 * testable against a fake without a network, a port, or a mutated global.
 */
export async function runWorkOriginPullTick(
    dataDir: string,
    now: Date,
    fetchImpl: WorkOriginFetch = fetch,
): Promise<TdahOriginPullTickSummary> {
    const namespaces = listActiveTdahNamespaces(dataDir);
    const summary: TdahOriginPullTickSummary = {
        date: formatDateInTimeZone(now, 'UTC'),
        namespaceCount: namespaces.length,
        syncedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        itemCount: 0,
    };

    for (const key of namespaces) {
        const outcome = await runNamespaceWorkOriginPull(dataDir, key, now, fetchImpl);
        if (outcome.kind === 'skipped') {
            summary.skippedCount += 1;
        } else if (outcome.kind === 'synced') {
            summary.syncedCount += 1;
            summary.itemCount += outcome.itemCount;
        } else {
            summary.failedCount += 1;
        }
    }

    return summary;
}

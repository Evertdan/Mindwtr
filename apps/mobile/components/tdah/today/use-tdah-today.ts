import { useCallback, useEffect, useRef, useState } from 'react';

import { CloudHttpError, cloudGetJson, cloudRequestJson } from '@mindwtr/core';

import {
    buildTdahActivityActionUrl,
    buildTdahDayActivitiesUrl,
    buildTdahDayUrl,
    buildTdahRequestOptions,
    loadTdahCloudConfig,
} from './tdah-today-cloud';
import type {
    TdahActivity,
    TdahActivityResponse,
    TdahActivityTransitionAction,
    TdahCreateManualActivityRequest,
    TdahDayResponse,
} from './tdah-today-types';

/**
 * `loading` -> `ready`/`empty`/`offline`/`unconfigured`/`error`, mirroring
 * tdah-settings-screen.tsx's phase pattern but splitting network failure
 * into its own `offline` phase (AD-11: an offline banner, never a stale plan
 * rendered as if it were live) instead of collapsing every failure into one
 * generic `error`. `error` is reserved for a real server response (a bad
 * status, e.g. a 409 when the mode is off); `offline` is reserved for a
 * request that never reached the server (network unreachable, timeout);
 * `unconfigured` is Self-Hosted sync not set up yet — a distinct phase, not
 * a fake `error`, because its Retry can never succeed until the user
 * configures sync in Settings (UX-DR5: no dead-end error loop).
 */
export type TdahTodayPhase = 'loading' | 'ready' | 'empty' | 'offline' | 'error' | 'unconfigured';

export type UseTdahTodayResult = {
    phase: TdahTodayPhase;
    date: string | null;
    timeZone: string;
    routineTitle: string | null;
    activities: TdahActivity[];
    reload: () => Promise<void>;
    createManualActivity: (input: TdahCreateManualActivityRequest) => Promise<TdahActivity>;
    registerActivityAction: (activityId: number, action: TdahActivityTransitionAction) => Promise<TdahActivity>;
};

const mergeActivity = (activities: TdahActivity[], next: TdahActivity): TdahActivity[] => {
    const index = activities.findIndex((activity) => activity.id === next.id);
    if (index === -1) return [...activities, next];
    const merged = activities.slice();
    merged[index] = next;
    return merged;
};

/**
 * Midnight-day merge guard: a mutation whose response spans the profile's
 * local midnight (the server assigns it to the *new* day's plan) must never
 * splice into the still-rendered previous day's timeline — only merge when
 * the returned activity belongs to the loaded day. A dropped merge is safe:
 * every screen refetches on focus (AD-1), so the new day's plan renders as
 * soon as the user re-enters T-01 or the rollover reload fires.
 */
const shouldMergeIntoRenderedDay = (activity: TdahActivity, renderedDate: string | null): boolean => (
    activity.dayPlanDate === renderedDate
);

// Fallback only: used before the first successful `GET /v1/tdah/day`
// resolves (`day.timeZone`, AD-6's real source of truth), and when a
// response somehow omits it — never the value TdahNowLine actually renders
// against once a day has loaded.
const DEVICE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Guards against a malformed `GET /v1/tdah/day` body (e.g. `activities`
 * missing or not an array) so it fails as a clear, distinct `'error'` phase
 * instead of throwing inside the success path and being mislabeled `'offline'`
 * by the generic catch below (a real bug this shape check exists to close).
 */
const isValidTdahDayResponse = (value: unknown): value is TdahDayResponse => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<TdahDayResponse>;
    return typeof candidate.date === 'string' && Array.isArray(candidate.activities);
};

/**
 * T-01's data hook (spec Code Map). Every mount is a fresh, uncached
 * `GET /v1/tdah/day` (AD-1) — no plan is ever kept across screens or
 * remounts. T-02 (TdahActivityDetailScreen) uses its own instance of this
 * same hook rather than receiving props from T-01, so a "back" navigation
 * into T-01 always re-fetches too (no shared, potentially-stale state).
 */
export function useTdahToday(): UseTdahTodayResult {
    const [phase, setPhase] = useState<TdahTodayPhase>('loading');
    const [date, setDate] = useState<string | null>(null);
    const [timeZone, setTimeZone] = useState<string>(DEVICE_TIME_ZONE);
    const [routineTitle, setRoutineTitle] = useState<string | null>(null);
    const [activities, setActivities] = useState<TdahActivity[]>([]);
    const mountedRef = useRef(true);
    // The rendered day (`date`), readable from the mutation callbacks below
    // without re-creating them whenever the day changes — the merge guard
    // compares each server-returned activity's `dayPlanDate` against it.
    const dateRef = useRef<string | null>(null);
    // A stale in-flight `reload()` resolving after a newer one (retry tap,
    // screen refocus) must never overwrite the fresher state — same
    // request-id idiom as quick-capture-sheet.tsx's `contextOptionsRequestRef`.
    const reloadRequestRef = useRef(0);

    useEffect(() => () => {
        mountedRef.current = false;
    }, []);

    // No fetch-on-mount here: each screen using this hook drives `reload()`
    // from its own `useFocusEffect` instead, so "every screen load is a
    // fresh fetch" (AD-1) covers both an initial mount and a back-navigation
    // return to an already-mounted screen, without double-fetching on mount.
    const reload = useCallback(async (): Promise<void> => {
        const requestId = reloadRequestRef.current + 1;
        reloadRequestRef.current = requestId;
        const isStale = () => !mountedRef.current || reloadRequestRef.current !== requestId;

        setPhase('loading');
        try {
            const cloud = await loadTdahCloudConfig();
            if (!cloud) {
                if (!isStale()) setPhase('unconfigured');
                return;
            }
            const day = await cloudGetJson<TdahDayResponse>(buildTdahDayUrl(cloud.url), buildTdahRequestOptions(cloud));
            if (isStale()) return;
            if (!day) {
                setPhase('error');
                return;
            }
            if (!isValidTdahDayResponse(day)) {
                // A malformed body is a real bug, never a network/fetch
                // failure — keep it out of the catch block below so it can
                // never be mislabeled 'offline'.
                setPhase('error');
                return;
            }
            setDate(day.date);
            dateRef.current = day.date;
            setTimeZone(typeof day.timeZone === 'string' && day.timeZone.length > 0 ? day.timeZone : DEVICE_TIME_ZONE);
            setRoutineTitle(day.routineTitle);
            setActivities(day.activities);
            setPhase(day.activities.length > 0 ? 'ready' : 'empty');
        } catch (error) {
            if (isStale()) return;
            setPhase(error instanceof CloudHttpError ? 'error' : 'offline');
        }
    }, []);

    const createManualActivity = useCallback(async (input: TdahCreateManualActivityRequest): Promise<TdahActivity> => {
        const cloud = await loadTdahCloudConfig();
        if (!cloud) throw new Error('TDAH cloud sync is not configured');
        const result = await cloudRequestJson<TdahActivityResponse>(
            'POST',
            buildTdahDayActivitiesUrl(cloud.url),
            input,
            buildTdahRequestOptions(cloud),
        );
        if (!result) throw new Error('TDAH manual activity creation returned no body');
        if (mountedRef.current && shouldMergeIntoRenderedDay(result.activity, dateRef.current)) {
            setActivities((current) => mergeActivity(current, result.activity));
        }
        return result.activity;
    }, []);

    const registerActivityAction = useCallback(async (
        activityId: number,
        action: TdahActivityTransitionAction,
    ): Promise<TdahActivity> => {
        const cloud = await loadTdahCloudConfig();
        if (!cloud) throw new Error('TDAH cloud sync is not configured');
        const result = await cloudRequestJson<TdahActivityResponse>(
            'POST',
            buildTdahActivityActionUrl(cloud.url, activityId, action),
            undefined,
            buildTdahRequestOptions(cloud),
        );
        if (!result) throw new Error('TDAH activity action returned no body');
        if (mountedRef.current && shouldMergeIntoRenderedDay(result.activity, dateRef.current)) {
            setActivities((current) => mergeActivity(current, result.activity));
        }
        return result.activity;
    }, []);

    return { phase, date, timeZone, routineTitle, activities, reload, createManualActivity, registerActivityAction };
}

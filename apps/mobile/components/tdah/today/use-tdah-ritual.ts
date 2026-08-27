import { useCallback, useEffect, useRef, useState } from 'react';

import { CloudHttpError, cloudGetJson, cloudRequestJson } from '@mindwtr/core';

import {
    buildTdahActivityDecideUrl,
    buildTdahDayUrl,
    buildTdahRequestOptions,
    loadTdahCloudConfig,
} from './tdah-today-cloud';
import type {
    TdahActivity,
    TdahActivityDecideRequest,
    TdahActivityResponse,
    TdahDayResponse,
} from './tdah-today-types';

/**
 * T-05's own phase set (spec Code Map: "mismos estados de pantalla que
 * T-01" via `useTdahRitual`) — deliberately without T-01's `empty` phase:
 * the Cierre's scoreboard renders (all-zero) even for a day with no
 * Activities, so there is nothing distinct to branch on there. Same
 * offline/error/unconfigured split as useTdahToday's own doc comment:
 * `offline` is a request that never reached the server, `error` is a real
 * server response, `unconfigured` is Self-Hosted sync not set up yet.
 */
export type TdahRitualPhase = 'loading' | 'ready' | 'offline' | 'error' | 'unconfigured';

export type UseTdahRitualResult = {
    phase: TdahRitualPhase;
    date: string | null;
    timeZone: string;
    activities: TdahActivity[];
    reload: () => Promise<void>;
    decideActivity: (activityId: number, request: TdahActivityDecideRequest) => Promise<TdahActivity>;
};

// Fallback only: used before the first successful `GET /v1/tdah/day`
// resolves, and when a response somehow omits `timeZone` — same convention
// as useTdahToday's own DEVICE_TIME_ZONE constant.
const DEVICE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Guards against a malformed `GET /v1/tdah/day` body the same way
 * useTdahToday's own isValidTdahDayResponse does, so it fails as a clear
 * `'error'` phase instead of throwing inside the success path and being
 * mislabeled `'offline'` by the generic catch below.
 */
const isValidTdahDayResponse = (value: unknown): value is TdahDayResponse => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<TdahDayResponse>;
    return typeof candidate.date === 'string' && Array.isArray(candidate.activities);
};

/**
 * T-05's data hook (spec Code Map), kept fully separate from useTdahToday
 * (T-01) so the two screens' fetch lifecycles never couple — spec Always:
 * the ritual reads "hoy" via the very same `GET /v1/tdah/day` T-01 uses
 * (never a distinct "day being closed" endpoint), and every mount/focus is
 * a fresh, uncached fetch (AD-1).
 */
export function useTdahRitual(): UseTdahRitualResult {
    const [phase, setPhase] = useState<TdahRitualPhase>('loading');
    const [date, setDate] = useState<string | null>(null);
    const [timeZone, setTimeZone] = useState<string>(DEVICE_TIME_ZONE);
    const [activities, setActivities] = useState<TdahActivity[]>([]);
    const mountedRef = useRef(true);
    // A stale in-flight `reload()` resolving after a newer one must never
    // overwrite the fresher state — same request-id idiom as
    // useTdahToday's `reloadRequestRef`.
    const reloadRequestRef = useRef(0);

    useEffect(() => () => {
        mountedRef.current = false;
    }, []);

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
            if (!day || !isValidTdahDayResponse(day)) {
                setPhase('error');
                return;
            }
            setDate(day.date);
            setTimeZone(typeof day.timeZone === 'string' && day.timeZone.length > 0 ? day.timeZone : DEVICE_TIME_ZONE);
            setActivities(day.activities);
            setPhase('ready');
        } catch (error) {
            if (isStale()) return;
            setPhase(error instanceof CloudHttpError ? 'error' : 'offline');
        }
    }, []);

    // Deliberately never merges the mutated Activity back into `activities`
    // the way useTdahToday's own registerActivityAction does: a successful
    // decision clears startedAt/completedAt and moves dayPlanDate off
    // "today" server-side (spec Always), but T-05's recap is a read-only
    // record of the day that just closed — it must keep showing the
    // Activity's original missed/limbo glyph and real hours for the rest of
    // this session. The caller (TdahRitualScreen) tracks which rows were
    // decided locally instead (Design Notes: even "sin fecha", which
    // changes nothing server-side, only collapses the row for this
    // session).
    const decideActivity = useCallback(async (
        activityId: number,
        request: TdahActivityDecideRequest,
    ): Promise<TdahActivity> => {
        const cloud = await loadTdahCloudConfig();
        if (!cloud) throw new Error('TDAH cloud sync is not configured');
        const result = await cloudRequestJson<TdahActivityResponse>(
            'POST',
            buildTdahActivityDecideUrl(cloud.url, activityId),
            request,
            buildTdahRequestOptions(cloud),
        );
        if (!result) throw new Error('TDAH activity decision returned no body');
        return result.activity;
    }, []);

    return { phase, date, timeZone, activities, reload, decideActivity };
}

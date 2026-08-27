import { useCallback, useEffect, useRef, useState } from 'react';

import { CloudHttpError, cloudGetJson, cloudRequestJson } from '@mindwtr/core';

import {
    buildTdahActivityDecideUrl,
    buildTdahLimboDecideBatchUrl,
    buildTdahLimboUrl,
    buildTdahRequestOptions,
    loadTdahCloudConfig,
} from './tdah-today-cloud';
import type {
    TdahActivity,
    TdahActivityDecideRequest,
    TdahActivityResponse,
    TdahLimboDecideBatchRequest,
    TdahLimboDecideBatchResponse,
    TdahLimboResponse,
} from './tdah-today-types';

/**
 * T-08's own phase set (spec Code Map: "fases loading/ready/offline/error/
 * unconfigured") — the same 5 phases as T-05's `useTdahRitual`, deliberately
 * without T-01's `empty` phase: an empty Limbo still renders `ready` (with
 * its own calm "nada pendiente" copy), the same reasoning T-05 already
 * documents for its own scoreboard.
 */
export type TdahLimboPhase = 'loading' | 'ready' | 'offline' | 'error' | 'unconfigured';

export type UseTdahLimboResult = {
    phase: TdahLimboPhase;
    activities: TdahActivity[];
    selectedIds: ReadonlySet<number>;
    toggleSelect: (activityId: number) => void;
    clearSelection: () => void;
    reload: () => Promise<void>;
    /**
     * POSTs to the existing single-id `/decide` endpoint (spec Code Map:
     * "reutiliza el endpoint single-id existente"). Unlike T-05's own
     * `decideActivity` — a read-only recap that never mutates its fetched
     * list — T-08 is a live work tray: a successful decision removes the
     * Activity from `activities` (and `selectedIds`, if it was selected)
     * immediately, since there is no "day that just closed" snapshot worth
     * preserving here.
     */
    decideOne: (activityId: number, request: TdahActivityDecideRequest) => Promise<TdahActivity>;
    /**
     * POSTs every currently-selected id plus `decision` to the new batch
     * endpoint in one atomic request (spec Always: "todo o nada", the same
     * contract `mutateConfirmMorning` already established in story 3.3) —
     * never a client-side loop over `decideOne`, which could apply some and
     * fail others. Removes every id the response confirms was applied and
     * clears the selection on success; a rejection leaves both `activities`
     * and `selectedIds` completely untouched (spec Error Handling:
     * "selección intacta").
     */
    decideBatch: (decision: TdahLimboDecideBatchRequest['decision']) => Promise<TdahActivity[]>;
};

/**
 * Guards against a malformed `GET /v1/tdah/limbo` body the same way
 * useTdahToday/useTdahRitual/useTdahMorning's own isValidTdahDayResponse
 * does, so it fails as a clear `'error'` phase instead of throwing inside
 * the success path and being mislabeled `'offline'` by the generic catch
 * below.
 */
const isValidTdahLimboResponse = (value: unknown): value is TdahLimboResponse => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<TdahLimboResponse>;
    return Array.isArray(candidate.activities);
};

/**
 * T-08's data hook (spec Code Map, "mirroring use-tdah-ritual.ts") — the
 * Limbo tray: every `state='limbo'` Activity across every day, no date/zone
 * scoping (spec Always). Kept fully separate from useTdahToday/useTdahRitual/
 * useTdahMorning so none of the four screens' fetch lifecycles ever couple;
 * every `reload()` is a fresh, uncached fetch (AD-1).
 */
export function useTdahLimbo(): UseTdahLimboResult {
    const [phase, setPhase] = useState<TdahLimboPhase>('loading');
    const [activities, setActivities] = useState<TdahActivity[]>([]);
    const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
    const mountedRef = useRef(true);
    // A stale in-flight `reload()` resolving after a newer one must never
    // overwrite the fresher state — same request-id idiom as
    // useTdahToday/useTdahRitual/useTdahMorning's own reloadRequestRef.
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
            const response = await cloudGetJson<TdahLimboResponse>(
                buildTdahLimboUrl(cloud.url),
                buildTdahRequestOptions(cloud),
            );
            if (isStale()) return;
            if (!response || !isValidTdahLimboResponse(response)) {
                setPhase('error');
                return;
            }
            const freshIds = new Set(response.activities.map((activity) => activity.id));
            setActivities(response.activities);
            // A previously-selected id the fresh fetch no longer confirms as
            // `limbo` (decided elsewhere — T-05, or another session/device,
            // in the interim) must never linger in the selection: a later
            // batch built from it would just be rejected by the server's own
            // 1:1 eligibility check (spec Always).
            setSelectedIds((current) => {
                const pruned = new Set([...current].filter((id) => freshIds.has(id)));
                return pruned.size === current.size ? current : pruned;
            });
            setPhase('ready');
        } catch (error) {
            if (isStale()) return;
            setPhase(error instanceof CloudHttpError ? 'error' : 'offline');
        }
    }, []);

    const toggleSelect = useCallback((activityId: number): void => {
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(activityId)) {
                next.delete(activityId);
            } else {
                next.add(activityId);
            }
            return next;
        });
    }, []);

    const clearSelection = useCallback((): void => {
        setSelectedIds(new Set());
    }, []);

    const decideOne = useCallback(async (
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
        if (mountedRef.current) {
            setActivities((current) => current.filter((activity) => activity.id !== activityId));
            setSelectedIds((current) => {
                if (!current.has(activityId)) return current;
                const next = new Set(current);
                next.delete(activityId);
                return next;
            });
        }
        return result.activity;
    }, []);

    const decideBatch = useCallback(async (
        decision: TdahLimboDecideBatchRequest['decision'],
    ): Promise<TdahActivity[]> => {
        const cloud = await loadTdahCloudConfig();
        if (!cloud) throw new Error('TDAH cloud sync is not configured');
        const request: TdahLimboDecideBatchRequest = {
            activityIds: Array.from(selectedIds),
            decision,
        };
        const result = await cloudRequestJson<TdahLimboDecideBatchResponse>(
            'POST',
            buildTdahLimboDecideBatchUrl(cloud.url),
            request,
            buildTdahRequestOptions(cloud),
        );
        if (!result) throw new Error('TDAH limbo batch decision returned no body');
        if (mountedRef.current) {
            const appliedIds = new Set(result.activities.map((activity) => activity.id));
            setActivities((current) => current.filter((activity) => !appliedIds.has(activity.id)));
            clearSelection();
        }
        return result.activities;
    }, [selectedIds, clearSelection]);

    return { phase, activities, selectedIds, toggleSelect, clearSelection, reload, decideOne, decideBatch };
}

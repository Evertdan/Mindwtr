import { useCallback, useEffect, useRef, useState } from 'react';

import { CloudHttpError, cloudGetJson, cloudRequestJson } from '@mindwtr/core';

import {
    buildTdahRequestOptions,
    buildTdahTomorrowActivitiesUrl,
    buildTdahTomorrowConfirmUrl,
    buildTdahTomorrowDayUrl,
    loadTdahCloudConfig,
} from './tdah-today-cloud';
import type {
    TdahActivity,
    TdahActivityResponse,
    TdahConfirmMorningRequest,
    TdahCreateManualActivityRequest,
    TdahDayResponse,
} from './tdah-today-types';

/**
 * T-06's own phase set (spec Code Map: "mismos estados de pantalla" as
 * useTdahRitual) — no `empty` phase, same reasoning as T-05: the editor
 * renders (with its own empty-state copy) even for a day with zero
 * Activities, so there's nothing distinct to branch on there.
 */
export type TdahMorningPhase = 'loading' | 'ready' | 'offline' | 'error' | 'unconfigured';

export type TdahMorningActivityChanges = {
    startTime: string | null;
    durationMinutes: number | null;
};

export type UseTdahMorningResult = {
    phase: TdahMorningPhase;
    date: string | null;
    timeZone: string;
    routineTitle: string | null;
    /** `null` until a previous confirm — drives T-06's soft-lock banner (spec Always: re-entry after confirm still allows editing/reconfirming). */
    confirmedAt: string | null;
    /**
     * The in-memory draft (Design Notes: never persisted per-action).
     * Reorder/edit/delete only ever touch this array — nothing reaches the
     * server until `confirmMorning()`. Reset to the server's own order on
     * every `reload()` (same every-focus-refetches convention as T-01/T-05
     * — spec Always: abandoning T-06 unconfirmed loses this draft).
     */
    draftActivities: TdahActivity[];
    reload: () => Promise<void>;
    reorderDraft: (fromIndex: number, toIndex: number) => void;
    updateDraftActivity: (activityId: number, changes: TdahMorningActivityChanges) => void;
    deleteDraftActivity: (activityId: number) => void;
    /** POSTs immediately (spec Always: independent of the confirm draft) and appends the result to the draft. */
    addManualActivity: (input: TdahCreateManualActivityRequest) => Promise<TdahActivity>;
    /**
     * A lightweight, best-effort `GET .../day/tomorrow` that only *adds*
     * Activities the current `draftActivities` doesn't already know about
     * (fix for the "Agregar manual" round trip, spec bug 1): the create
     * screen (`/tdah-activity/new`) owns its own separate `useTdahMorning()`
     * instance and POSTs the new manual Activity through it, so this
     * screen's own instance never learns about it any other way — the
     * mount-only `reload()` (by design) never refires on that round trip.
     * Never touches or reorders any Activity already present in the draft;
     * a failure here is swallowed rather than surfaced, since it must never
     * disturb the preserved draft the mount-only fetch exists to protect.
     */
    syncNewActivities: () => Promise<void>;
    /**
     * The single grouped `POST .../confirm` (spec Always). Resolves with
     * `changesCount` — edits + deletions + manual additions made across
     * this screen's mounted lifetime (Code Map: `morningChanges` for T-07)
     * — computed here rather than in the screen, since it depends on the
     * same reload-snapshot bookkeeping this hook already keeps.
     */
    confirmMorning: () => Promise<{ changesCount: number }>;
};

// Fallback only: used before the first successful `GET .../day/tomorrow`
// resolves, and when a response somehow omits `timeZone` — same convention
// as useTdahToday/useTdahRitual's own DEVICE_TIME_ZONE constant.
const DEVICE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Guards against a malformed `GET .../day/tomorrow` body the same way
 * useTdahToday/useTdahRitual's own isValidTdahDayResponse does, so it fails
 * as a clear `'error'` phase instead of throwing inside the success path
 * and being mislabeled `'offline'` by the generic catch below.
 */
const isValidTdahDayResponse = (value: unknown): value is TdahDayResponse => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<TdahDayResponse>;
    return typeof candidate.date === 'string' && Array.isArray(candidate.activities);
};

/**
 * T-06's data hook (spec Code Map: "mirroring use-tdah-ritual.ts completo").
 * Reads "mañana" via `GET /v1/tdah/day/tomorrow` (never generates the day —
 * AD-5, spec Always), and owns the local-draft/confirm lifecycle that makes
 * this story's editor different from every other TDAH screen: reorder,
 * inline hora/duración edits, and deletions only ever touch
 * `draftActivities` in memory; only `confirmMorning()` reaches the server.
 */
export function useTdahMorning(): UseTdahMorningResult {
    const [phase, setPhase] = useState<TdahMorningPhase>('loading');
    const [date, setDate] = useState<string | null>(null);
    const [timeZone, setTimeZone] = useState<string>(DEVICE_TIME_ZONE);
    const [routineTitle, setRoutineTitle] = useState<string | null>(null);
    const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
    const [draftActivities, setDraftActivities] = useState<TdahActivity[]>([]);
    const mountedRef = useRef(true);
    // A stale in-flight `reload()` resolving after a newer one must never
    // overwrite the fresher state — same request-id idiom as
    // useTdahToday/useTdahRitual's `reloadRequestRef`.
    const reloadRequestRef = useRef(0);

    // --- Draft bookkeeping, all reset to a fresh snapshot on every reload()
    // (the draft is never carried across a server refetch — Design Notes).
    // `snapshotRef` holds each surviving Activity's server-known
    // startTime/durationMinutes as of the last reload, so updateDraftActivity
    // can tell a real edit from a no-op write-back of the same value.
    const snapshotRef = useRef<Map<number, TdahMorningActivityChanges>>(new Map());
    const deletedIdsRef = useRef<Set<number>>(new Set());
    const editedIdsRef = useRef<Set<number>>(new Set());
    // Accumulates across every reload this screen's mounted lifetime sees
    // (not reset per reload, unlike the two sets above) — "Agregar manual"
    // persists immediately and independently of the draft (spec Always), so
    // a newly created Activity only ever becomes visible here through a
    // fresh GET; this is what turns that into one more counted "change" for
    // T-07's `morningChanges` even though it never touched deletedIds/editedIds.
    const manualAddedIdsRef = useRef<Set<number>>(new Set());
    const knownActivityIdsRef = useRef<Set<number>>(new Set());
    const hasLoadedOnceRef = useRef(false);
    // The id order as of the last reload()/syncNewActivities(), grown (never
    // reordered) by both addManualActivity and syncNewActivities as they
    // append newly-known ids — the baseline confirmMorning() diffs the final
    // draftActivities order against to detect a reorder-only session (fix
    // for bug 3: a pure drag-reorder previously reported changesCount: 0).
    const orderSnapshotRef = useRef<number[]>([]);

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
            const day = await cloudGetJson<TdahDayResponse>(
                buildTdahTomorrowDayUrl(cloud.url),
                buildTdahRequestOptions(cloud),
            );
            if (isStale()) return;
            if (!day || !isValidTdahDayResponse(day)) {
                setPhase('error');
                return;
            }

            if (hasLoadedOnceRef.current) {
                for (const activity of day.activities) {
                    if (activity.origin === 'manual' && !knownActivityIdsRef.current.has(activity.id)) {
                        manualAddedIdsRef.current.add(activity.id);
                    }
                }
            }
            knownActivityIdsRef.current = new Set(day.activities.map((activity) => activity.id));
            hasLoadedOnceRef.current = true;
            snapshotRef.current = new Map(day.activities.map((activity) => [
                activity.id,
                { startTime: activity.startTime, durationMinutes: activity.durationMinutes },
            ]));
            deletedIdsRef.current = new Set();
            editedIdsRef.current = new Set();
            orderSnapshotRef.current = day.activities.map((activity) => activity.id);

            setDate(day.date);
            setTimeZone(typeof day.timeZone === 'string' && day.timeZone.length > 0 ? day.timeZone : DEVICE_TIME_ZONE);
            setRoutineTitle(day.routineTitle);
            setConfirmedAt(day.confirmedAt ?? null);
            setDraftActivities(day.activities);
            setPhase('ready');
        } catch (error) {
            if (isStale()) return;
            setPhase(error instanceof CloudHttpError ? 'error' : 'offline');
        }
    }, []);

    const reorderDraft = useCallback((fromIndex: number, toIndex: number): void => {
        setDraftActivities((current) => {
            if (
                fromIndex === toIndex
                || fromIndex < 0 || fromIndex >= current.length
                || toIndex < 0 || toIndex >= current.length
            ) return current;
            const next = current.slice();
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            return next;
        });
    }, []);

    const updateDraftActivity = useCallback((activityId: number, changes: TdahMorningActivityChanges): void => {
        const original = snapshotRef.current.get(activityId);
        const isRealChange = !original
            || original.startTime !== changes.startTime
            || original.durationMinutes !== changes.durationMinutes;
        if (isRealChange) {
            editedIdsRef.current.add(activityId);
        } else {
            editedIdsRef.current.delete(activityId);
        }
        setDraftActivities((current) => current.map((activity) => (
            activity.id === activityId ? { ...activity, ...changes } : activity
        )));
    }, []);

    const deleteDraftActivity = useCallback((activityId: number): void => {
        deletedIdsRef.current.add(activityId);
        editedIdsRef.current.delete(activityId);
        setDraftActivities((current) => current.filter((activity) => activity.id !== activityId));
    }, []);

    const addManualActivity = useCallback(async (input: TdahCreateManualActivityRequest): Promise<TdahActivity> => {
        const cloud = await loadTdahCloudConfig();
        if (!cloud) throw new Error('TDAH cloud sync is not configured');
        const result = await cloudRequestJson<TdahActivityResponse>(
            'POST',
            buildTdahTomorrowActivitiesUrl(cloud.url),
            input,
            buildTdahRequestOptions(cloud),
        );
        if (!result) throw new Error('TDAH manual activity creation returned no body');
        if (mountedRef.current) {
            manualAddedIdsRef.current.add(result.activity.id);
            knownActivityIdsRef.current.add(result.activity.id);
            snapshotRef.current.set(result.activity.id, {
                startTime: result.activity.startTime,
                durationMinutes: result.activity.durationMinutes,
            });
            orderSnapshotRef.current = [...orderSnapshotRef.current, result.activity.id];
            setDraftActivities((current) => [...current, result.activity]);
        }
        return result.activity;
    }, []);

    const syncNewActivities = useCallback(async (): Promise<void> => {
        const cloud = await loadTdahCloudConfig();
        if (!cloud) return;
        let day: TdahDayResponse | null;
        try {
            day = await cloudGetJson<TdahDayResponse>(
                buildTdahTomorrowDayUrl(cloud.url),
                buildTdahRequestOptions(cloud),
            );
        } catch {
            // Best-effort only — a failed sync must never disturb the
            // preserved draft this screen's mount-only fetch protects.
            return;
        }
        if (!mountedRef.current || !day || !isValidTdahDayResponse(day)) return;
        setDraftActivities((current) => {
            const currentIds = new Set(current.map((activity) => activity.id));
            const newActivities = (day as TdahDayResponse).activities.filter(
                (activity) => !currentIds.has(activity.id),
            );
            if (newActivities.length === 0) return current;
            for (const activity of newActivities) {
                manualAddedIdsRef.current.add(activity.id);
                knownActivityIdsRef.current.add(activity.id);
                snapshotRef.current.set(activity.id, {
                    startTime: activity.startTime,
                    durationMinutes: activity.durationMinutes,
                });
            }
            orderSnapshotRef.current = [...orderSnapshotRef.current, ...newActivities.map((activity) => activity.id)];
            return [...current, ...newActivities];
        });
    }, []);

    const confirmMorning = useCallback(async (): Promise<{ changesCount: number }> => {
        const cloud = await loadTdahCloudConfig();
        if (!cloud) throw new Error('TDAH cloud sync is not configured');
        // Story 4.2: the Jira work band is read-only, and the server excludes
        // `origin: 'jira'` rows from the eligible set T-06 is allowed to edit.
        // Sending one would fail the server's exact-count check and reject the
        // whole confirmation with TDAH_ORIGIN_READ_ONLY, so the band is
        // filtered out here too — the display guard in TdahMorningScreen and
        // this payload guard have to agree or a legitimate confirmation dies.
        const editableActivities = draftActivities.filter((activity) => activity.origin !== 'jira');
        const request: TdahConfirmMorningRequest = {
            activities: editableActivities.map((activity) => ({
                id: activity.id,
                startTime: activity.startTime,
                durationMinutes: activity.durationMinutes,
            })),
            deletedActivityIds: Array.from(deletedIdsRef.current),
        };
        // A reorder-only session (fix for bug 3) never touches editedIdsRef/
        // deletedIdsRef/manualAddedIdsRef, so it would otherwise report
        // changesCount: 0 despite persisting a genuinely different
        // sort_order — diff the final surviving-id order against the
        // snapshot captured at the start of this draft (reload()/
        // syncNewActivities()/addManualActivity(), filtered down to the
        // ids that are still present) and count a difference as one change.
        const survivingSnapshotOrder = orderSnapshotRef.current.filter(
            (id) => draftActivities.some((activity) => activity.id === id),
        );
        const currentOrder = draftActivities.map((activity) => activity.id);
        const orderChanged = survivingSnapshotOrder.length !== currentOrder.length
            || survivingSnapshotOrder.some((id, index) => id !== currentOrder[index]);
        const reorderChanged = orderChanged ? 1 : 0;
        const changesCount = editedIdsRef.current.size + deletedIdsRef.current.size
            + manualAddedIdsRef.current.size + reorderChanged;
        const result = await cloudRequestJson<TdahDayResponse>(
            'POST',
            buildTdahTomorrowConfirmUrl(cloud.url),
            request,
            buildTdahRequestOptions(cloud),
        );
        if (!result) throw new Error('TDAH confirm morning returned no body');
        // A rejection (400/network) never reaches here — the draft above
        // (deletedIdsRef/draftActivities) is left completely untouched on
        // any thrown error, so a retry after a failed confirm resends the
        // exact same draft (spec Error Handling: "borrador local intacto").
        if (mountedRef.current) {
            knownActivityIdsRef.current = new Set(result.activities.map((activity) => activity.id));
            snapshotRef.current = new Map(result.activities.map((activity) => [
                activity.id,
                { startTime: activity.startTime, durationMinutes: activity.durationMinutes },
            ]));
            deletedIdsRef.current = new Set();
            editedIdsRef.current = new Set();
            // Reset alongside the two sets above (fix for bug 2) — otherwise
            // a second confirmMorning() later in the same mounted session
            // (the documented soft-lock re-entry/reconfirm flow) recounts
            // manual activities already accounted for by the first confirm.
            manualAddedIdsRef.current = new Set();
            orderSnapshotRef.current = result.activities.map((activity) => activity.id);
            setDraftActivities(result.activities);
            setConfirmedAt(result.confirmedAt ?? null);
        }
        return { changesCount };
    }, [draftActivities]);

    return {
        phase,
        date,
        timeZone,
        routineTitle,
        confirmedAt,
        draftActivities,
        reload,
        reorderDraft,
        updateDraftActivity,
        deleteDraftActivity,
        addManualActivity,
        syncNewActivities,
        confirmMorning,
    };
}

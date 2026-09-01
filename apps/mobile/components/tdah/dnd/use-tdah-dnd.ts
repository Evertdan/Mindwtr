import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { CloudHttpError, cloudGetJson, cloudRequestJson } from '@mindwtr/core';

import {
    getSystemCalendarPermissionStatus,
    requestSystemCalendarPermission,
    type SystemCalendarPermissionStatus,
} from '@/lib/external-calendar';
import { collectBusyCalendarEvents } from '@/lib/tdah-dnd-calendar';

import { formatDayKeyInTimeZone } from '../today/tdah-time';

import {
    buildTdahDndCalendarUrl,
    buildTdahDndUrl,
    buildTdahDndWindowUrl,
    buildTdahDndWindowsUrl,
    buildTdahRequestOptions,
    loadTdahCloudConfig,
    type TdahDndCloudConfig,
} from './tdah-dnd-cloud';
import type {
    TdahDndCalendarSyncRequest,
    TdahDndResponse,
    TdahDndSettings,
    TdahDndWindow,
    TdahDndWindowInput,
} from './tdah-dnd-types';

/**
 * T-12's own phase set — T-01's five (`loading|ready|offline|error|
 * unconfigured`, see use-tdah-today.ts for why network failure is split out
 * of `error`) plus `inactive`.
 *
 * `inactive` is Modo TDAH switched off: every `/v1/tdah/dnd*` route answers
 * 409 `TDAH_ACTIVATE_REQUIRED` then, exactly like the rest of the module.
 * `CloudHttpError` still carries no body `code` (deferred from story 4.2),
 * so the status alone maps it — which is sound here because
 * `GET /v1/tdah/dnd` has no other 409: the limit and read-only 409s can only
 * come back from a *mutation*, and by then the screen has already loaded.
 */
export type TdahDndPhase = 'loading' | 'ready' | 'offline' | 'error' | 'unconfigured' | 'inactive';

/**
 * The one mutation that just failed, as a stable tag the screen maps onto
 * copy — never a raw error object, so nothing from `fs`/HTTP leaks into the
 * UI. Cleared by the next successful mutation and by `reload()`.
 */
export type TdahDndMutationError =
    | 'workingHours'
    | 'windowSave'
    | 'windowLimit'
    | 'windowDelete'
    | 'calendar';

export type UseTdahDndResult = {
    phase: TdahDndPhase;
    settings: TdahDndSettings;
    windows: TdahDndWindow[];
    /** The server's own answer, rendered verbatim (AD-8) — never recomputed here. */
    activeUntil: string | null;
    /**
     * The profile's zone the server resolved `activeUntil` against (DW-102),
     * falling back to the device's own only while no response has landed yet.
     */
    timeZone: string;
    /**
     * The profile-zone day (`YYYY-MM-DD`) the server resolved the current
     * `activeUntil` ON, or `null` before the first response. `activeUntil` is a
     * bare "HH:mm", and "HH:mm" only orders monotonically WITHIN one calendar
     * day — past local midnight "00:05" is lexically smaller than a stale
     * "23:59", so a comparison without this would silently conclude the silence
     * is still running.
     *
     * Comes from the response's own `date` (DW-114), never from the client
     * clock: a response computed at 23:58 and applied after midnight would
     * otherwise be stamped with the wrong day and never recover. T-01 reads the
     * same field off `GET /v1/tdah/day`.
     */
    dayKey: string | null;
    permission: SystemCalendarPermissionStatus;
    /** `false` on web/PWA, which never reads calendars at all (doc 06, permanent state). */
    calendarSupported: boolean;
    calendarSyncing: boolean;
    mutationError: TdahDndMutationError | null;
    clearMutationError: () => void;
    reload: () => Promise<void>;
    requestCalendarPermission: () => Promise<SystemCalendarPermissionStatus>;
    setCalendarEnabled: (next: boolean) => Promise<boolean>;
    saveWorkingHours: (workStart: string, workEnd: string) => Promise<boolean>;
    createWindow: (input: TdahDndWindowInput) => Promise<boolean>;
    updateWindow: (windowId: string, input: TdahDndWindowInput) => Promise<boolean>;
    deleteWindow: (windowId: string) => Promise<boolean>;
};

export const TDAH_DND_DEFAULT_WORK_START = '09:00';
export const TDAH_DND_DEFAULT_WORK_END = '18:00';

const DEFAULT_SETTINGS: TdahDndSettings = {
    calendarEnabled: false,
    workStart: TDAH_DND_DEFAULT_WORK_START,
    workEnd: TDAH_DND_DEFAULT_WORK_END,
};

/**
 * How much calendar the phone observes on each sync. Both bounds are
 * absolute instants — picking a range is "how much to look at", not a
 * suppression decision, so it stays free of any time-zone reasoning (AD-8).
 * The lookback covers the running local day whatever the profile's zone is
 * (a device up to a day behind or ahead of it still uploads today's
 * meetings); the horizon keeps a week of upcoming meetings materialized so
 * the server can suppress them even if the phone never opens again.
 */
export const TDAH_DND_CALENDAR_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const TDAH_DND_CALENDAR_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Guards against a malformed `GET /v1/tdah/dnd` body the same way
 * use-tdah-today.ts's own `isValidTdahDayResponse` does, so it fails as a
 * clear `'error'` phase instead of throwing inside the success path and
 * being mislabeled `'offline'` by the generic catch.
 */
/**
 * Only ever a placeholder until the first response lands (same role and same
 * resolution as `use-tdah-today.ts`'s own constant): AD-6's real source of
 * truth is the profile's zone, which the server sends back on every read.
 */
const DEVICE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const isValidDndResponse = (value: unknown): value is TdahDndResponse => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<TdahDndResponse>;
    if (!Array.isArray(candidate.windows)) return false;
    const settings = candidate.settings;
    return Boolean(settings)
        && typeof settings === 'object'
        && typeof (settings as TdahDndSettings).workStart === 'string'
        && typeof (settings as TdahDndSettings).workEnd === 'string';
};

/**
 * T-12's data hook (spec Code Map). Every `reload()` is a fresh, uncached
 * fetch (AD-1), and every mutation re-reads the whole state afterwards
 * rather than patching a local copy: `activeUntil` is a server computation
 * that a locally-spliced window would silently invalidate.
 */
export function useTdahDnd(): UseTdahDndResult {
    const [phase, setPhase] = useState<TdahDndPhase>('loading');
    const [settings, setSettings] = useState<TdahDndSettings>(DEFAULT_SETTINGS);
    const [windows, setWindows] = useState<TdahDndWindow[]>([]);
    const [activeUntil, setActiveUntil] = useState<string | null>(null);
    const [timeZone, setTimeZone] = useState<string>(DEVICE_TIME_ZONE);
    const [dayKey, setDayKey] = useState<string | null>(null);
    const [permission, setPermission] = useState<SystemCalendarPermissionStatus>('undetermined');
    const [calendarSyncing, setCalendarSyncing] = useState(false);
    const [mutationError, setMutationError] = useState<TdahDndMutationError | null>(null);
    const calendarSupported = Platform.OS !== 'web';
    const mountedRef = useRef(true);
    // A stale in-flight `reload()` resolving after a newer one (retry tap,
    // screen refocus) must never overwrite the fresher state — same
    // request-id idiom as use-tdah-today.ts's own reloadRequestRef.
    const reloadRequestRef = useRef(0);

    useEffect(() => () => {
        mountedRef.current = false;
    }, []);

    const applyState = useCallback((response: TdahDndResponse): void => {
        setSettings({
            calendarEnabled: response.settings.calendarEnabled === true,
            workStart: response.settings.workStart,
            workEnd: response.settings.workEnd,
        });
        setWindows(response.windows);
        setActiveUntil(typeof response.activeUntil === 'string' ? response.activeUntil : null);
        const zone = typeof response.timeZone === 'string' && response.timeZone.length > 0
            ? response.timeZone
            : DEVICE_TIME_ZONE;
        setTimeZone(zone);
        // DW-114 — the server's own resolution day, verbatim. The fallback to a
        // client stamp only covers a server predating the field; it carries the
        // midnight-straddle race this change exists to remove, so it is the
        // degraded path, never the normal one.
        setDayKey(typeof response.date === 'string' && response.date.length > 0
            ? response.date
            : formatDayKeyInTimeZone(new Date(), zone));
    }, []);

    const fetchState = useCallback(async (cloud: TdahDndCloudConfig): Promise<TdahDndResponse | null> => {
        const response = await cloudGetJson<TdahDndResponse>(
            buildTdahDndUrl(cloud.url),
            buildTdahRequestOptions(cloud),
        );
        return isValidDndResponse(response) ? response : null;
    }, []);

    /**
     * Uploads the busy instants of the observation range and re-reads the
     * resulting state. Everything it sends is raw UTC (AD-8): no window is
     * decided, clipped or split here — the server does all of that.
     */
    const syncCalendar = useCallback(async (cloud: TdahDndCloudConfig): Promise<void> => {
        if (!calendarSupported) return;
        setCalendarSyncing(true);
        try {
            const now = Date.now();
            const rangeStart = new Date(now - TDAH_DND_CALENDAR_LOOKBACK_MS);
            const rangeEnd = new Date(now + TDAH_DND_CALENDAR_HORIZON_MS);
            const events = await collectBusyCalendarEvents(rangeStart, rangeEnd);
            const body: TdahDndCalendarSyncRequest = {
                rangeStart: rangeStart.toISOString(),
                rangeEnd: rangeEnd.toISOString(),
                events,
            };
            await cloudRequestJson('PUT', buildTdahDndCalendarUrl(cloud.url), body, buildTdahRequestOptions(cloud));
            const refreshed = await fetchState(cloud);
            if (!mountedRef.current) return;
            if (refreshed) applyState(refreshed);
        } catch {
            // A failed calendar sync degrades to "manual windows only"; it
            // never takes the loaded screen down with it.
            if (mountedRef.current) setMutationError('calendar');
        } finally {
            if (mountedRef.current) setCalendarSyncing(false);
        }
    }, [applyState, calendarSupported, fetchState]);

    const reload = useCallback(async (): Promise<void> => {
        const requestId = reloadRequestRef.current + 1;
        reloadRequestRef.current = requestId;
        const isStale = () => !mountedRef.current || reloadRequestRef.current !== requestId;

        setPhase('loading');
        setMutationError(null);
        try {
            const cloud = await loadTdahCloudConfig();
            if (!cloud) {
                if (!isStale()) setPhase('unconfigured');
                return;
            }
            const response = await fetchState(cloud);
            if (isStale()) return;
            if (!response) {
                setPhase('error');
                return;
            }
            applyState(response);
            setPhase('ready');

            const status = calendarSupported ? await getSystemCalendarPermissionStatus() : 'denied';
            if (isStale()) return;
            setPermission(status);
            // The upload is an effect of a healthy load, never a gate on it:
            // the windows the server already knows are on screen either way.
            if (response.settings.calendarEnabled === true && status === 'granted') {
                await syncCalendar(cloud);
            }
        } catch (error) {
            if (isStale()) return;
            if (error instanceof CloudHttpError) {
                setPhase(error.status === 409 ? 'inactive' : 'error');
                return;
            }
            setPhase('offline');
        }
    }, [applyState, calendarSupported, fetchState, syncCalendar]);

    const clearMutationError = useCallback((): void => {
        setMutationError(null);
    }, []);

    const requestCalendarPermission = useCallback(async (): Promise<SystemCalendarPermissionStatus> => {
        if (!calendarSupported) return 'denied';
        const status = await requestSystemCalendarPermission();
        if (mountedRef.current) setPermission(status);
        return status;
    }, [calendarSupported]);

    /**
     * Runs one mutation and, on success, re-reads the whole DND state so
     * `activeUntil` and the window list always come from the server.
     * Returns `false` (and tags `mutationError`) instead of throwing, so the
     * caller can keep an editor open on failure without a try/catch.
     */
    const runMutation = useCallback(async (
        request: (cloud: TdahDndCloudConfig) => Promise<unknown>,
        failure: TdahDndMutationError,
        conflictFailure?: TdahDndMutationError,
    ): Promise<boolean> => {
        setMutationError(null);
        try {
            const cloud = await loadTdahCloudConfig();
            if (!cloud) {
                if (mountedRef.current) setPhase('unconfigured');
                return false;
            }
            await request(cloud);
            const refreshed = await fetchState(cloud);
            if (!mountedRef.current) return true;
            if (refreshed) applyState(refreshed);
            return true;
        } catch (error) {
            if (!mountedRef.current) return false;
            const isConflict = error instanceof CloudHttpError && error.status === 409;
            setMutationError(isConflict && conflictFailure ? conflictFailure : failure);
            return false;
        }
    }, [applyState, fetchState]);

    const setCalendarEnabled = useCallback(async (next: boolean): Promise<boolean> => {
        // Asking for the permission before writing the flag keeps the toggle
        // honest: turning detection on with no access would otherwise read as
        // "on" while silencing nothing.
        let status = permission;
        if (next && calendarSupported && status !== 'granted') {
            status = await requestCalendarPermission();
        }
        // ...and honest means NOT persisting `calendarEnabled: true` when the
        // OS said no. Nothing would ever be uploaded, so the switch would sit
        // there reading "on" over a detection that cannot happen — exactly the
        // state the request above exists to prevent. No `mutationError` is
        // raised either: a denied permission is a legitimate choice (copia sin
        // culpa, doc 06), and the screen already renders its own blame-free
        // denied block for `permission !== 'granted'`. Turning detection OFF is
        // never gated — it must work whatever the permission says.
        if (next && calendarSupported && status !== 'granted') {
            setMutationError(null);
            return false;
        }
        const applied = await runMutation(
            (cloud) => cloudRequestJson(
                'PUT',
                buildTdahDndUrl(cloud.url),
                { ...settings, calendarEnabled: next },
                buildTdahRequestOptions(cloud),
            ),
            'calendar',
        );
        if (applied && next && status === 'granted') {
            const cloud = await loadTdahCloudConfig();
            if (cloud) await syncCalendar(cloud);
        }
        return applied;
    }, [calendarSupported, permission, requestCalendarPermission, runMutation, settings, syncCalendar]);

    const saveWorkingHours = useCallback(async (workStart: string, workEnd: string): Promise<boolean> => (
        runMutation(
            (cloud) => cloudRequestJson(
                'PUT',
                buildTdahDndUrl(cloud.url),
                { calendarEnabled: settings.calendarEnabled, workStart, workEnd },
                buildTdahRequestOptions(cloud),
            ),
            'workingHours',
        )
    ), [runMutation, settings.calendarEnabled]);

    const createWindow = useCallback(async (input: TdahDndWindowInput): Promise<boolean> => (
        runMutation(
            (cloud) => cloudRequestJson(
                'POST',
                buildTdahDndWindowsUrl(cloud.url),
                input,
                buildTdahRequestOptions(cloud),
            ),
            'windowSave',
            // The only 409 a create can raise once the screen has loaded is
            // the manual-window cap (`TDAH_DND_LIMIT`).
            'windowLimit',
        )
    ), [runMutation]);

    const updateWindow = useCallback(async (windowId: string, input: TdahDndWindowInput): Promise<boolean> => (
        runMutation(
            (cloud) => cloudRequestJson(
                'PUT',
                buildTdahDndWindowUrl(cloud.url, windowId),
                input,
                buildTdahRequestOptions(cloud),
            ),
            'windowSave',
        )
    ), [runMutation]);

    const deleteWindow = useCallback(async (windowId: string): Promise<boolean> => (
        runMutation(
            (cloud) => cloudRequestJson(
                'DELETE',
                buildTdahDndWindowUrl(cloud.url, windowId),
                undefined,
                buildTdahRequestOptions(cloud),
            ),
            'windowDelete',
        )
    ), [runMutation]);

    return {
        phase,
        settings,
        windows,
        activeUntil,
        timeZone,
        dayKey,
        permission,
        calendarSupported,
        calendarSyncing,
        mutationError,
        clearMutationError,
        reload,
        requestCalendarPermission,
        setCalendarEnabled,
        saveWorkingHours,
        createWindow,
        updateWindow,
        deleteWindow,
    };
}

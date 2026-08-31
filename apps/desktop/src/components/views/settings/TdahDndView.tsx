import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import {
    CloudHttpError,
    cloudGetJson,
    cloudRequestJson,
    formatI18nTemplate,
    getCloudBaseUrl,
    getLocalizedWeekdayLabels,
    getTranslator,
    WEEKDAY_ORDER,
} from '@mindwtr/core';

import { getCurrentUiLanguage } from '../../../contexts/language-context';
import { getTauriHttpFetch } from '../../../lib/tauri-http';
import { SyncService } from '../../../lib/sync-service';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../../ui/Dialog';
import { SettingsCard, SettingsSectionHeader } from './SettingRow';
import { TDAH_REQUEST_TIMEOUT_MS, type CloudConnection } from './TdahRoutinesListView';

/**
 * T-12 (spec 4.3): "Juntas sin vibras" in the PWA. Self-contained like
 * `TdahJiraView`/`TdahRoutinesListView`: resolves its own cloud config and
 * i18n rather than threading through `SettingsMainPage`'s `t: Labels` prop,
 * and reads the mode gate straight off the 409 `TDAH_ACTIVATE_REQUIRED` the
 * server answers with (no separate profile fetch).
 *
 * **The PWA manages manual windows only, and that is permanent.** It never
 * reads a calendar and never asks for a calendar permission — there is no
 * degraded path back to detection here, so the calendar zone carries
 * `tdahDnd.calendar.unsupported` as a standing statement of fact (doc 06:
 * "la PWA vive permanentemente en este estado"), not as an error, a retry or a
 * "grant access" prompt. Meeting detection lives on the phone.
 *
 * **AD-8 — zero suppression logic on the client.** Nothing in this file
 * decides whether a window is active: `activeUntil` arrives already computed by
 * the server (end of the contiguous block of overlapping windows, resolved in
 * `profile.timeZone`) and is rendered verbatim. The only predicates here are
 * *input* validators that keep a shape the server would reject from ever
 * leaving the device — the same role `isValidJiraSiteUrl` plays in
 * `TdahJiraView`. There is deliberately no local "is it quiet right now?"
 * anywhere below, and no clock is consulted to answer that question.
 *
 * The `/v1/tdah/dnd*` wire shapes below are DUPLICATED, not imported: under
 * ADR 0026 the TDAH module's state lives on the self-hosted server rather than
 * in the replicated sync document, and desktop views never import server types
 * across that boundary — the same "kept in sync by hand, ADR 0026" convention
 * `TdahRoutinesListView` and `TdahJiraView` already document. The counterpart
 * definitions live in `apps/cloud/src/tdah/types.ts` (and, for
 * `TDAH_DND_MAX_MANUAL_WINDOWS` and the 09:00/18:00 working-hour defaults
 * mirrored below, `apps/cloud/src/tdah/dnd.ts`); a change on either side has to
 * be carried to the other by hand.
 */

export type TdahDndWindowSource = 'manual' | 'calendar';
export type TdahDndWindowKind = 'weekly' | 'once';

/**
 * `weekdays` is populated for `kind: 'weekly'` and `date` for `kind: 'once'`;
 * the other one is null. Times are `HH:mm` in `profile.timeZone`, half-open
 * `[startTime, endTime)`, and never cross midnight (a manual window that would
 * is expressed as two windows — spec's "Ventanas que cruzan medianoche").
 */
export type TdahDndWindow = {
    id: string;
    source: TdahDndWindowSource;
    kind: TdahDndWindowKind;
    weekdays: number[] | null;
    date: string | null;
    startTime: string;
    endTime: string;
    label: string | null;
};

export type TdahDndSettings = {
    calendarEnabled: boolean;
    workStart: string;
    workEnd: string;
};

/**
 * `GET /v1/tdah/dnd`, `PUT /v1/tdah/dnd` and every window mutation answer with
 * this same envelope. `activeUntil` is the server's verdict — `null` when
 * nothing is suppressing right now, otherwise the `HH:mm` end of the contiguous
 * block.
 */
export type TdahDndResponse = {
    settings: TdahDndSettings;
    windows: TdahDndWindow[];
    activeUntil: string | null;
    /**
     * The profile's own IANA zone (AD-6). `activeUntil` is a bare `HH:mm` with
     * no zone of its own, so without this the view cannot tell whether the
     * announced instant has already passed — and the browser's zone is free to
     * disagree with the profile's. Optional on the wire: a server predating
     * this field simply leaves the view on its previous, focus-only refresh.
     */
    timeZone?: string;
};

type TdahDndPhase = 'loading' | 'no-sync' | 'inactive' | 'ready' | 'error';

export const TDAH_DND_PATH = '/tdah/dnd';
export const TDAH_DND_WINDOWS_PATH = '/tdah/dnd/windows';

// Mirrors `TDAH_DND_MAX_MANUAL_WINDOWS` / the working-hours defaults the spec
// pins in `apps/cloud/src/tdah/dnd.ts` — duplicated here by hand rather than
// imported, the same cross-package convention every other TDAH view documents
// (ADR 0026: clients never import server-only modules across the wire).
export const TDAH_DND_MAX_MANUAL_WINDOWS = 50;
export const TDAH_DND_DEFAULT_WORK_START = '09:00';
export const TDAH_DND_DEFAULT_WORK_END = '18:00';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const buildTdahUrl = (cloudUrl: string, path: string): string => `${getCloudBaseUrl(cloudUrl)}${path}`;

const buildCloudRequestOptions = async (config: CloudConnection) => ({
    token: config.token,
    allowInsecureHttp: config.allowInsecureHttp,
    timeoutMs: TDAH_REQUEST_TIMEOUT_MS,
    fetcher: (await getTauriHttpFetch()) ?? fetch,
});

/**
 * The module's whole 409 family: `TDAH_ACTIVATE_REQUIRED`, `TDAH_DND_LIMIT`
 * and `TDAH_DND_READ_ONLY` all land on this status and the body's `code` never
 * reaches the client (`CloudHttpError` carries no `code` — spec 4.3 keeps that
 * deferred and explicitly refuses to change it). On a *read* the ambiguity is
 * only theoretical: neither the limit nor a read-only row can be raised by a
 * GET, so a 409 there is the mode gate. On a mutation, `resolveConflict` below
 * tells them apart.
 */
const isConflictError = (error: unknown): boolean => error instanceof CloudHttpError && error.status === 409;

/**
 * Both ends must be zero-padded `HH:mm` and the start must sort before the
 * end: the server compares them lexicographically inside a half-open
 * `[start, end)` range, so an inverted or equal pair names a window that can
 * never be active. Same rule the working-hours pair obeys.
 */
export const isValidDndTimeRange = (start: string, end: string): boolean => {
    if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) return false;
    return start < end;
};

/** `weekdays` is 0–6 with 0 = Sunday, matching `WEEKDAY_ORDER` and the server's `getUTCDay()`. */
export const isValidDndWeekdays = (weekdays: number[]): boolean =>
    weekdays.length > 0 && weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);

/** A real calendar date, not merely a `YYYY-MM-DD`-shaped string (`2026-02-31` is not one). */
export const isValidDndDate = (value: string): boolean => {
    if (!DATE_PATTERN.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

// A response envelope is only trusted to replace local state if it actually
// looks like one; anything else falls back to a plain re-read of GET.
const isDndResponse = (value: unknown): value is TdahDndResponse =>
    typeof value === 'object'
    && value !== null
    && Array.isArray((value as TdahDndResponse).windows)
    && typeof (value as TdahDndResponse).settings === 'object'
    && (value as TdahDndResponse).settings !== null;

/**
 * DW-111 — the two wall-clock readings zone 1's staleness check needs, both in
 * the PROFILE's zone (AD-6), never the browser's. Hand-written here rather than
 * imported from `apps/mobile`'s `tdah-time.ts`: the two apps share no client
 * code, and this file already mirrors the server's own constants and validators
 * by hand for the same reason every other TDAH view documents (ADR 0026).
 */
const DEVICE_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const formatWallClockInTimeZone = (date: Date, timeZone: string): string => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
    const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
    return `${hour}:${minute}`;
};

const formatDayKeyInTimeZone = (date: Date, timeZone: string): string => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
    const month = parts.find((part) => part.type === 'month')?.value ?? '01';
    const day = parts.find((part) => part.type === 'day')?.value ?? '01';
    return `${year}-${month}-${day}`;
};

/** Same 30s cadence the phone's own `useTdahNow` uses, for the same job: nothing here polls the server, the tick only re-evaluates a claim already on screen. */
const TDAH_DND_STATUS_TICK_INTERVAL_MS = 30_000;

/**
 * `Date.UTC` over the already-resolved `YYYY-MM-DD` plus a UTC formatter: a
 * one-off window's date is a wall-clock date in the profile's zone, and
 * `new Date('2026-09-01')` rendered in a negative-offset browser would print
 * the day before.
 */
const formatWindowDate = (value: string, locale: string): string => {
    if (!isValidDndDate(value)) return value;
    const [year, month, day] = value.split('-').map(Number);
    try {
        return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
            .format(new Date(Date.UTC(year, month - 1, day)));
    } catch {
        return value;
    }
};

type WindowDraft = {
    kind: TdahDndWindowKind;
    weekdays: number[];
    date: string;
    startTime: string;
    endTime: string;
    label: string;
};

const emptyDraft = (): WindowDraft => ({
    kind: 'weekly',
    weekdays: [],
    date: '',
    startTime: '10:00',
    endTime: '11:00',
    label: '',
});

const draftFromWindow = (window: TdahDndWindow): WindowDraft => ({
    kind: window.kind,
    weekdays: window.weekdays ?? [],
    date: window.date ?? '',
    startTime: window.startTime,
    endTime: window.endTime,
    label: window.label ?? '',
});

export function TdahDndView() {
    const language = getCurrentUiLanguage();
    const t = getTranslator(language);

    const [phase, setPhase] = useState<TdahDndPhase>('loading');
    const [state, setState] = useState<TdahDndResponse | null>(null);
    const [cloud, setCloud] = useState<CloudConnection | null>(null);
    const [isOffline, setIsOffline] = useState(false);
    // DW-111 — zone 1's own clock. `now` re-samples the real clock every tick
    // (never a fixed increment), so it crosses a day boundary correctly after
    // the window was left open or the machine slept.
    const [now, setNow] = useState(() => new Date());
    // The profile-zone day key the CURRENT `activeUntil` was resolved on,
    // stamped at receipt because `GET /v1/tdah/dnd` carries no date of its own.
    const [dayKey, setDayKey] = useState<string | null>(null);

    const [workStart, setWorkStart] = useState(TDAH_DND_DEFAULT_WORK_START);
    const [workEnd, setWorkEnd] = useState(TDAH_DND_DEFAULT_WORK_END);
    const [workErrorKey, setWorkErrorKey] = useState<string | null>(null);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [draft, setDraft] = useState<WindowDraft>(emptyDraft);
    // A freshly opened create dialog is INVALID by construction (`emptyDraft`
    // starts with no weekday picked), so gating the validation line on
    // `draftValid` alone painted the red "check the window" copy the instant
    // the dialog appeared — telling the user off for a form they had not begun.
    // Same `editorTouched` gate T-12's mobile screen already uses: the line
    // only appears once the user has actually changed something.
    const [editorTouched, setEditorTouched] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [editorErrorKey, setEditorErrorKey] = useState<string | null>(null);
    const [deleteFailed, setDeleteFailed] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const applyState = useCallback((next: TdahDndResponse): void => {
        setState(next);
        setWorkStart(next.settings.workStart || TDAH_DND_DEFAULT_WORK_START);
        setWorkEnd(next.settings.workEnd || TDAH_DND_DEFAULT_WORK_END);
        setDayKey(formatDayKeyInTimeZone(
            new Date(),
            typeof next.timeZone === 'string' && next.timeZone.length > 0 ? next.timeZone : DEVICE_TIME_ZONE,
        ));
    }, []);

    const load = useCallback(async (config: CloudConnection): Promise<void> => {
        const options = await buildCloudRequestOptions(config);
        const result = await cloudGetJson<TdahDndResponse>(buildTdahUrl(config.url, TDAH_DND_PATH), options);
        if (!mountedRef.current) return;
        if (isDndResponse(result)) applyState(result);
        else setState(null);
        setPhase('ready');
    }, [applyState]);

    const reload = useCallback(async (): Promise<void> => {
        setPhase('loading');
        try {
            const config = await SyncService.getCloudConfig({ silent: true });
            const url = config.url?.trim() ?? '';
            const cloudToken = config.token?.trim() ?? '';
            if (!mountedRef.current) return;
            if (!url || !cloudToken) {
                setCloud(null);
                setState(null);
                setPhase('no-sync');
                return;
            }
            const next: CloudConnection = { url, token: cloudToken, allowInsecureHttp: config.allowInsecureHttp === true };
            setCloud(next);
            await load(next);
        } catch (error) {
            if (!mountedRef.current) return;
            if (isConflictError(error)) {
                setState(null);
                setPhase('inactive');
                return;
            }
            setPhase('error');
        }
    }, [load]);

    useEffect(() => {
        void reload();
    }, [reload]);

    // DW-111 — zone 1 must never outlive the silence it announces, the same
    // defect and the same fix the two mobile surfaces carry (DW-102; see
    // TdahTodayScreen.tsx for the full rationale). `activeUntil` is a
    // server-computed "HH:mm" that nothing here re-read, so "Quiet until 12:00"
    // stayed on screen at 14:00 — on the very view the user opens to check
    // whether they are quiet.
    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), TDAH_DND_STATUS_TICK_INTERVAL_MS);
        return () => clearInterval(interval);
    }, []);

    const activeUntil = state?.activeUntil ?? null;
    const activeZone = (typeof state?.timeZone === 'string' && state.timeZone.length > 0)
        ? state.timeZone
        : DEVICE_TIME_ZONE;
    // Two terms, both load-bearing. The time term alone would be wrong past
    // local midnight: "HH:mm" orders monotonically only WITHIN one calendar
    // day, so "00:05" is lexically SMALLER than a stale "23:59" and an
    // end-of-day window would keep claiming a silence for most of the next
    // day. A rolled-over day key means the announced instant belongs to a day
    // that is already over, which expires it outright.
    //
    // Neither term decides whether a window is ACTIVE — that stays the
    // server's call (AD-8). They decide only that the announced instant is
    // behind us, and the reload is what produces the next truth: a contiguous
    // window that follows comes back with its own later `until`.
    const activeUntilExpired = activeUntil !== null
        && (dayKey === null
            || formatDayKeyInTimeZone(now, activeZone) !== dayKey
            || formatWallClockInTimeZone(now, activeZone) >= activeUntil);
    const activeUntilLabel = activeUntilExpired ? null : activeUntil;

    const reloadRef = useRef(reload);
    reloadRef.current = reload;
    useEffect(() => {
        // Edge-triggered, never a poll — and never while offline, where the
        // reload could only fail and the banner already tells the user the
        // state on screen is the last one known.
        if (!activeUntilExpired || isOffline) return;
        void reloadRef.current();
    }, [activeUntilExpired, isOffline]);

    // Offline: pause automatic reloads and keep the last loaded state on screen
    // behind a banner — same pattern as the other TDAH views.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handleOnline = () => {
            setIsOffline(false);
            void reload();
        };
        const handleOffline = () => setIsOffline(true);
        setIsOffline(typeof navigator !== 'undefined' ? !navigator.onLine : false);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [reload]);

    /**
     * Status 409 is shared by `TDAH_ACTIVATE_REQUIRED`, `TDAH_DND_LIMIT` and
     * `TDAH_DND_READ_ONLY`, and the body's `code` never reaches the client
     * (`CloudHttpError` carries no `code` — spec 4.3 keeps that deferred and
     * explicitly refuses to change it). A plain re-read separates them: the
     * mode gate closes `GET /v1/tdah/dnd` too, the other two do not.
     */
    const resolveConflict = useCallback(async (config: CloudConnection): Promise<'inactive' | 'rejected'> => {
        try {
            await load(config);
            return 'rejected';
        } catch (error) {
            return isConflictError(error) ? 'inactive' : 'rejected';
        }
    }, [load]);

    const windows = useMemo(() => state?.windows ?? [], [state]);
    /**
     * Manual windows are the whole editing surface of this screen: the PWA
     * neither uploads nor edits `source: 'calendar'` rows, so listing them
     * under "Manual windows" would offer an edit that can only ever answer 409
     * `TDAH_DND_READ_ONLY`.
     */
    const manualWindows = useMemo(() => windows.filter((window) => window.source === 'manual'), [windows]);
    const atLimit = manualWindows.length >= TDAH_DND_MAX_MANUAL_WINDOWS;

    const shortWeekdayLabels = getLocalizedWeekdayLabels(language, 'short');
    const longWeekdayLabels = getLocalizedWeekdayLabels(language, 'long');

    const describeWindow = useCallback((window: TdahDndWindow): string => {
        if (window.kind === 'weekly') {
            const days = (window.weekdays ?? [])
                .slice()
                .sort((a, b) => a - b)
                .map((day) => shortWeekdayLabels[WEEKDAY_ORDER[day]])
                .join(', ');
            return formatI18nTemplate(t('tdahDnd.windows.weekly'), {
                days,
                start: window.startTime,
                end: window.endTime,
            });
        }
        return formatI18nTemplate(t('tdahDnd.windows.once'), {
            date: window.date ? formatWindowDate(window.date, language) : '',
            start: window.startTime,
            end: window.endTime,
        });
    }, [language, shortWeekdayLabels, t]);

    const workWindowValid = isValidDndTimeRange(workStart, workEnd);

    // The working hours are server state shared with the phone: the PWA does
    // not read a calendar itself, but it owns the range the phone's uploaded
    // events are clipped to. `calendarEnabled` is carried through untouched —
    // this screen has no business flipping detection on or off.
    const commitWorkWindow = useCallback(async (): Promise<void> => {
        if (!cloud || !state) return;
        if (!workWindowValid) return;
        if (workStart === state.settings.workStart && workEnd === state.settings.workEnd) return;
        setWorkErrorKey(null);
        try {
            const options = await buildCloudRequestOptions(cloud);
            const result = await cloudRequestJson<TdahDndResponse>(
                'PUT',
                buildTdahUrl(cloud.url, TDAH_DND_PATH),
                { calendarEnabled: state.settings.calendarEnabled, workStart, workEnd },
                options,
            );
            if (!mountedRef.current) return;
            if (isDndResponse(result)) applyState(result);
            else await load(cloud);
        } catch (error) {
            if (!mountedRef.current) return;
            if (isConflictError(error) && (await resolveConflict(cloud)) === 'inactive') {
                if (mountedRef.current) setPhase('inactive');
                return;
            }
            if (!mountedRef.current) return;
            setWorkErrorKey('tdahDnd.work.saveError');
        }
    }, [applyState, cloud, load, resolveConflict, state, workEnd, workStart, workWindowValid]);

    const openCreate = useCallback((): void => {
        setEditingId(null);
        setDraft(emptyDraft());
        setEditorTouched(false);
        setEditorErrorKey(null);
        setIsEditorOpen(true);
    }, []);

    const openEdit = useCallback((window: TdahDndWindow): void => {
        setEditingId(window.id);
        setDraft(draftFromWindow(window));
        setEditorTouched(false);
        setEditorErrorKey(null);
        setIsEditorOpen(true);
    }, []);

    /** Every draft edit goes through here, so `editorTouched` cannot drift out of step with the fields. */
    const updateDraft = useCallback((patch: (prev: WindowDraft) => WindowDraft): void => {
        setEditorTouched(true);
        setDraft(patch);
    }, []);

    const closeEditor = useCallback((): void => {
        if (isSaving) return;
        setIsEditorOpen(false);
        setEditingId(null);
        setEditorErrorKey(null);
    }, [isSaving]);

    const toggleDraftWeekday = useCallback((index: number): void => {
        updateDraft((prev) => ({
            ...prev,
            weekdays: prev.weekdays.includes(index)
                ? prev.weekdays.filter((day) => day !== index)
                : [...prev.weekdays, index].sort((a, b) => a - b),
        }));
    }, [updateDraft]);

    const draftValid = isValidDndTimeRange(draft.startTime, draft.endTime)
        && (draft.kind === 'weekly' ? isValidDndWeekdays(draft.weekdays) : isValidDndDate(draft.date));

    const handleSaveWindow = useCallback(async (): Promise<void> => {
        if (!cloud || !draftValid || isSaving) return;
        // Refuse the 51st window locally rather than trading a 409 the client
        // cannot read a code off — same shape as `TdahJiraView`'s "never submit
        // what the server will reject".
        if (!editingId && atLimit) {
            setEditorErrorKey('tdahDnd.windows.limit');
            return;
        }
        setIsSaving(true);
        setEditorErrorKey(null);
        const label = draft.label.trim();
        // The irrelevant half of the discriminated shape is omitted, never sent
        // as null: `weekdays: null` on a weekly window is exactly what
        // `TDAH_DND_INVALID` is for.
        const body = {
            kind: draft.kind,
            ...(draft.kind === 'weekly' ? { weekdays: draft.weekdays } : { date: draft.date }),
            startTime: draft.startTime,
            endTime: draft.endTime,
            ...(label ? { label } : {}),
        };
        try {
            const options = await buildCloudRequestOptions(cloud);
            const result = await cloudRequestJson<TdahDndResponse>(
                editingId ? 'PUT' : 'POST',
                editingId
                    ? buildTdahUrl(cloud.url, `${TDAH_DND_WINDOWS_PATH}/${encodeURIComponent(editingId)}`)
                    : buildTdahUrl(cloud.url, TDAH_DND_WINDOWS_PATH),
                body,
                options,
            );
            if (!mountedRef.current) return;
            setIsEditorOpen(false);
            setEditingId(null);
            if (isDndResponse(result)) applyState(result);
            else await load(cloud);
        } catch (error) {
            if (!mountedRef.current) return;
            if (isConflictError(error)) {
                const outcome = await resolveConflict(cloud);
                if (!mountedRef.current) return;
                if (outcome === 'inactive') {
                    setIsEditorOpen(false);
                    setPhase('inactive');
                    return;
                }
                // Not the mode gate: on a create that is the manual-window cap,
                // on an edit it is a row this screen should never have offered.
                setEditorErrorKey(editingId ? 'tdahDnd.editor.saveError' : 'tdahDnd.windows.limit');
                return;
            }
            setEditorErrorKey(
                error instanceof CloudHttpError && error.status === 400
                    ? 'tdahDnd.editor.invalid'
                    : 'tdahDnd.editor.saveError',
            );
        } finally {
            if (mountedRef.current) setIsSaving(false);
        }
    }, [applyState, atLimit, cloud, draft, draftValid, editingId, isSaving, load, resolveConflict]);

    const handleDelete = useCallback(async (windowId: string): Promise<void> => {
        if (!cloud || deletingId) return;
        setDeletingId(windowId);
        setDeleteFailed(false);
        try {
            const options = await buildCloudRequestOptions(cloud);
            const result = await cloudRequestJson<TdahDndResponse>(
                'DELETE',
                buildTdahUrl(cloud.url, `${TDAH_DND_WINDOWS_PATH}/${encodeURIComponent(windowId)}`),
                undefined,
                options,
            );
            if (!mountedRef.current) return;
            if (isDndResponse(result)) applyState(result);
            else await load(cloud);
        } catch (error) {
            if (!mountedRef.current) return;
            if (isConflictError(error) && (await resolveConflict(cloud)) === 'inactive') {
                if (mountedRef.current) setPhase('inactive');
                return;
            }
            if (!mountedRef.current) return;
            setDeleteFailed(true);
        } finally {
            if (mountedRef.current) setDeletingId(null);
        }
    }, [applyState, cloud, deletingId, load, resolveConflict]);

    return (
        <>
            <SettingsSectionHeader>{t('tdahDnd.title')}</SettingsSectionHeader>
            <SettingsCard>
                {phase === 'loading' ? (
                    <div className="p-4 text-[13px] text-muted-foreground">{t('tdahDnd.loading')}</div>
                ) : null}
                {phase === 'no-sync' ? (
                    <div className="p-4 space-y-1">
                        <div className="text-sm font-medium">{t('tdahDnd.title')}</div>
                        <div className="text-xs text-muted-foreground">{t('tdahDnd.needsSync')}</div>
                    </div>
                ) : null}
                {phase === 'inactive' ? (
                    <div className="p-4 space-y-1">
                        <div className="text-sm font-medium">{t('tdahDnd.title')}</div>
                        <div className="text-xs text-muted-foreground">{t('tdahDnd.inactive')}</div>
                    </div>
                ) : null}
                {phase === 'error' ? (
                    <div className="p-4 flex items-center justify-between gap-4">
                        <div className="text-[13px] text-muted-foreground">{t('tdahDnd.loadError')}</div>
                        <button
                            type="button"
                            onClick={() => void reload()}
                            className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                        >
                            {t('tdahDnd.retry')}
                        </button>
                    </div>
                ) : null}
                {phase === 'ready' ? (
                    <>
                        {isOffline ? (
                            <div className="p-3 text-xs text-muted-foreground bg-muted/30">
                                {t('tdahDnd.offlineBanner')}
                            </div>
                        ) : null}

                        {/* Zone 1 — what is true right now, plus the promise the
                            whole feature lives or dies by. `activeUntil` is the
                            server's answer, rendered verbatim (AD-8). */}
                        <div className="p-4 space-y-1.5 border-b border-border">
                            <div className="text-sm font-medium">{t('tdahDnd.status.title')}</div>
                            <div className="text-[13px]" data-testid="tdah-dnd-status">
                                {activeUntilLabel
                                    ? formatI18nTemplate(t('tdahDnd.status.active'), { time: activeUntilLabel })
                                    : t('tdahDnd.status.idle')}
                            </div>
                            <p className="text-xs text-muted-foreground pt-1">{t('tdahDnd.promise')}</p>
                        </div>

                        {/* Zone 2 — calendar detection. Permanently unavailable
                            here: no toggle, no permission CTA, no retry. */}
                        <div className="p-4 space-y-1.5 border-b border-border">
                            <div className="text-sm font-medium">{t('tdahDnd.calendar.title')}</div>
                            <div className="text-xs text-muted-foreground" data-testid="tdah-dnd-unsupported">
                                {t('tdahDnd.calendar.unsupported')}
                            </div>
                        </div>

                        {/* Zone 3 — the working hours the phone's uploaded events
                            are clipped to. Shared server state, editable here. */}
                        <div className="p-4 space-y-2 border-b border-border">
                            <div className="text-sm font-medium">{t('tdahDnd.work.title')}</div>
                            <div className="flex items-center gap-2">
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground">{t('tdahDnd.work.start')}</span>
                                    <input
                                        type="time"
                                        aria-label={t('tdahDnd.work.start')}
                                        value={workStart}
                                        onChange={(e) => setWorkStart(e.target.value)}
                                        onBlur={() => void commitWorkWindow()}
                                        className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                                    />
                                </label>
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground">{t('tdahDnd.work.end')}</span>
                                    <input
                                        type="time"
                                        aria-label={t('tdahDnd.work.end')}
                                        value={workEnd}
                                        onChange={(e) => setWorkEnd(e.target.value)}
                                        onBlur={() => void commitWorkWindow()}
                                        className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                                    />
                                </label>
                            </div>
                            <div className="text-xs text-muted-foreground">{t('tdahDnd.work.hint')}</div>
                            {workWindowValid ? null : (
                                <div className="text-xs text-destructive" data-testid="tdah-dnd-work-invalid">
                                    {t('tdahDnd.work.invalid')}
                                </div>
                            )}
                            {workErrorKey ? (
                                <div className="text-xs text-destructive" data-testid="tdah-dnd-work-error">
                                    {t(workErrorKey)}
                                </div>
                            ) : null}
                        </div>

                        {/* Zone 4 — the manual windows, the whole editing surface
                            of the PWA. */}
                        <div className="p-4 space-y-3">
                            <div className="flex items-center justify-between gap-4">
                                <div className="text-sm font-medium">{t('tdahDnd.windows.title')}</div>
                                <button
                                    type="button"
                                    onClick={openCreate}
                                    disabled={atLimit}
                                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Plus className="w-4 h-4" />
                                    {t('tdahDnd.windows.add')}
                                </button>
                            </div>
                            {atLimit ? (
                                <div className="text-xs text-destructive" data-testid="tdah-dnd-limit">
                                    {t('tdahDnd.windows.limit')}
                                </div>
                            ) : null}
                            {manualWindows.length === 0 ? (
                                <div className="text-xs text-muted-foreground" data-testid="tdah-dnd-empty">
                                    {t('tdahDnd.windows.empty')}
                                </div>
                            ) : (
                                <ul className="space-y-2">
                                    {manualWindows.map((window) => (
                                        <li
                                            key={window.id}
                                            data-testid={`tdah-dnd-window-${window.id}`}
                                            className="flex items-start justify-between gap-3"
                                        >
                                            <div className="min-w-0">
                                                {window.label ? (
                                                    <div className="text-[13px] truncate">{window.label}</div>
                                                ) : null}
                                                <div className="text-xs text-muted-foreground">{describeWindow(window)}</div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => openEdit(window)}
                                                    className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                                                >
                                                    {t('tdahDnd.windows.edit')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => void handleDelete(window.id)}
                                                    disabled={deletingId === window.id}
                                                    aria-label={t('tdahDnd.windows.delete')}
                                                    className="text-xs p-1.5 rounded-md border border-border text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {deleteFailed ? (
                                <div className="text-xs text-destructive" data-testid="tdah-dnd-delete-error">
                                    {t('tdahDnd.windows.deleteError')}
                                </div>
                            ) : null}
                        </div>
                    </>
                ) : null}
            </SettingsCard>

            {isEditorOpen ? (
                <Dialog onClose={closeEditor} labelledBy="tdah-dnd-editor-title">
                    <DialogHeader className="px-4 pt-4">
                        <h2 id="tdah-dnd-editor-title" className="text-sm font-medium">
                            {editingId ? t('tdahDnd.editor.editTitle') : t('tdahDnd.editor.addTitle')}
                        </h2>
                    </DialogHeader>
                    <DialogBody className="px-4 py-3 space-y-3">
                        <div className="space-y-1.5">
                            <span className="text-xs text-muted-foreground">{t('tdahDnd.editor.kind')}</span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => updateDraft((prev) => ({ ...prev, kind: 'weekly' }))}
                                    aria-pressed={draft.kind === 'weekly'}
                                    className={`text-xs px-2.5 py-1.5 rounded-md border ${draft.kind === 'weekly' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground'}`}
                                >
                                    {t('tdahDnd.editor.kindWeekly')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => updateDraft((prev) => ({ ...prev, kind: 'once' }))}
                                    aria-pressed={draft.kind === 'once'}
                                    className={`text-xs px-2.5 py-1.5 rounded-md border ${draft.kind === 'once' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground'}`}
                                >
                                    {t('tdahDnd.editor.kindOnce')}
                                </button>
                            </div>
                        </div>

                        {draft.kind === 'weekly' ? (
                            <div className="space-y-1.5">
                                <span className="text-xs text-muted-foreground">{t('tdahDnd.editor.days')}</span>
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {/* `WEEKDAY_ORDER` starts at Sunday, so the index
                                        here is already the server's 0–6 weekday. */}
                                    {WEEKDAY_ORDER.map((code, index) => (
                                        <button
                                            key={code}
                                            type="button"
                                            onClick={() => toggleDraftWeekday(index)}
                                            aria-pressed={draft.weekdays.includes(index)}
                                            aria-label={longWeekdayLabels[code]}
                                            className={`text-xs w-9 h-9 rounded-md border ${draft.weekdays.includes(index) ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground'}`}
                                        >
                                            {shortWeekdayLabels[code]}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <label className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground">{t('tdahDnd.editor.date')}</span>
                                <input
                                    type="date"
                                    aria-label={t('tdahDnd.editor.date')}
                                    value={draft.date}
                                    onChange={(e) => updateDraft((prev) => ({ ...prev, date: e.target.value }))}
                                    className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                                />
                            </label>
                        )}

                        <div className="flex items-center gap-2">
                            <label className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground">{t('tdahDnd.editor.start')}</span>
                                <input
                                    type="time"
                                    aria-label={t('tdahDnd.editor.start')}
                                    value={draft.startTime}
                                    onChange={(e) => updateDraft((prev) => ({ ...prev, startTime: e.target.value }))}
                                    className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs text-muted-foreground">{t('tdahDnd.editor.end')}</span>
                                <input
                                    type="time"
                                    aria-label={t('tdahDnd.editor.end')}
                                    value={draft.endTime}
                                    onChange={(e) => updateDraft((prev) => ({ ...prev, endTime: e.target.value }))}
                                    className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                                />
                            </label>
                        </div>

                        <label className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">{t('tdahDnd.editor.label')}</span>
                            <input
                                type="text"
                                aria-label={t('tdahDnd.editor.label')}
                                value={draft.label}
                                onChange={(e) => updateDraft((prev) => ({ ...prev, label: e.target.value }))}
                                placeholder={t('tdahDnd.editor.labelPlaceholder')}
                                className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                            />
                        </label>

                        {!editorTouched || draftValid ? null : (
                            <div className="text-xs text-destructive" data-testid="tdah-dnd-editor-invalid">
                                {t('tdahDnd.editor.invalid')}
                            </div>
                        )}
                        {editorErrorKey ? (
                            <div className="text-xs text-destructive" data-testid="tdah-dnd-editor-error">
                                {t(editorErrorKey)}
                            </div>
                        ) : null}
                    </DialogBody>
                    <DialogFooter className="px-4 pb-4 flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={closeEditor}
                            disabled={isSaving}
                            className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
                        >
                            {t('tdahDnd.editor.cancel')}
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleSaveWindow()}
                            disabled={!draftValid || isSaving}
                            className="text-xs px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
                        >
                            {isSaving ? t('tdahDnd.editor.saving') : t('tdahDnd.editor.save')}
                        </button>
                    </DialogFooter>
                </Dialog>
            ) : null}
        </>
    );
}

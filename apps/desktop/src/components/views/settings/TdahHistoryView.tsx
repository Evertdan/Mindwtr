import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    CloudHttpError,
    cloudGetJson,
    formatI18nTemplate,
    getCloudBaseUrl,
    getTranslator,
} from '@mindwtr/core';

import { getCurrentUiLanguage } from '../../../contexts/language-context';
import { getTauriHttpFetch } from '../../../lib/tauri-http';
import { SyncService } from '../../../lib/sync-service';
import { SettingsCard, SettingsSectionHeader } from './SettingRow';
import { TDAH_REQUEST_TIMEOUT_MS, type CloudConnection, type TdahRoutine } from './TdahRoutinesListView';
import {
    formatIsoDate,
    formatRangeLabel,
    isValidCustomPeriodRange,
    TDAH_DEFAULT_PERIOD,
    TDAH_PERIOD_OPTIONS,
    type TdahDateRange,
    type TdahHistoryMetricsPeriod,
} from './tdah-period-range';

/**
 * T-09 (spec 3.5): "el termómetro personal" — Historial, the chronological
 * list of incomplete/late Actividades within a bounded range. Self-contained
 * like `TdahRoutinesListView`/`TdahActivationSection`: resolves its own
 * cloud config and i18n rather than threading through `SettingsMainPage`'s
 * `t: Labels` prop.
 *
 * The server side of `GET /v1/tdah/history` (apps/cloud/src/tdah/) was being
 * built in parallel by a different agent working from the same spec and did
 * not exist on disk when this file was written, so every shape below is
 * hand-derived from spec-3-5's Code Map / I/O & Edge-Case Matrix — the same
 * "kept in sync by hand, ADR 0026" convention `TdahRoutinesListView.tsx`
 * already documents for its own routes.
 *
 * Unlike Routines, Historial *does* gate on `profile.mode === 'on'` (spec:
 * "Ambas rutas nuevas exigen profile.mode === 'on'"). Rather than fetching
 * the profile separately, this reads the gate straight off the History
 * request's own 409 `TDAH_ACTIVATE_REQUIRED` response — the same signal the
 * server uses — and renders the dedicated `inactive` phase.
 */

export type TdahHistoryOrigin = 'routine' | 'manual';

export type TdahHistoryActivity = {
    id: number;
    dayPlanDate: string;
    title: string;
    startTime: string | null;
    durationMinutes: number | null;
    origin: TdahHistoryOrigin;
    state: 'missed' | 'limbo' | 'completed';
    startedAt: string | null;
    completedAt: string | null;
    movedAt: string | null;
};

export type TdahHistoryEntry = {
    activity: TdahHistoryActivity;
    routineTitle: string | null;
    completedLate: boolean;
};

export type TdahHistoryResponse = {
    range: TdahDateRange;
    entries: TdahHistoryEntry[];
};

type TdahHistoryOriginFilter = 'all' | TdahHistoryOrigin;
type TdahHistoryPhase = 'loading' | 'no-sync' | 'inactive' | 'ready' | 'error';

export const TDAH_HISTORY_PATH = '/tdah/history';

const buildTdahUrl = (cloudUrl: string, path: string): string => `${getCloudBaseUrl(cloudUrl)}${path}`;

const buildCloudRequestOptions = async (config: CloudConnection) => ({
    token: config.token,
    allowInsecureHttp: config.allowInsecureHttp,
    timeoutMs: TDAH_REQUEST_TIMEOUT_MS,
    fetcher: (await getTauriHttpFetch()) ?? fetch,
});

const buildHistoryUrl = (
    cloudUrl: string,
    filters: { period: TdahHistoryMetricsPeriod; from: string; to: string; origin: TdahHistoryOriginFilter; routineId: number | null },
): string => {
    const params = new URLSearchParams({ period: filters.period });
    if (filters.period === 'custom') {
        params.set('from', filters.from);
        params.set('to', filters.to);
    }
    if (filters.origin !== 'all') params.set('origin', filters.origin);
    if (filters.routineId != null) params.set('routineId', String(filters.routineId));
    return `${buildTdahUrl(cloudUrl, TDAH_HISTORY_PATH)}?${params.toString()}`;
};

const isActivateRequiredError = (error: unknown): boolean => error instanceof CloudHttpError && error.status === 409;

/**
 * "Completada tarde" comes off the server's own `completedLate` flag, never
 * re-derived here from `state`/`completedAt`/`dayPlanDate` — AD-5: the server
 * computes, the client only renders (see `TdahHistoryEntry` in the cloud's
 * `types.ts`). Re-deriving would silently diverge the moment the server's
 * definition of "on time" changes.
 */
const resultLabelKey = (entry: TdahHistoryEntry): string => {
    if (entry.activity.state === 'limbo') return 'tdahHistory.result.limbo';
    if (entry.activity.state === 'missed') return 'tdahHistory.result.missed';
    // Only `completed` remains, and the server returns exactly the late ones
    // here — flagged by `completedLate`, which is what this renders. The
    // `false` branch is unreachable in practice (an on-time completion is
    // filtered out server-side) and exists only to keep this total.
    return entry.completedLate ? 'tdahHistory.result.completedLate' : 'tdahHistory.result.missed';
};

export function TdahHistoryView() {
    const language = getCurrentUiLanguage();
    const t = getTranslator(language);

    const [phase, setPhase] = useState<TdahHistoryPhase>('loading');
    const [entries, setEntries] = useState<TdahHistoryEntry[]>([]);
    const [range, setRange] = useState<TdahDateRange | null>(null);
    const [routines, setRoutines] = useState<TdahRoutine[]>([]);
    const [isOffline, setIsOffline] = useState(false);

    const [period, setPeriod] = useState<TdahHistoryMetricsPeriod>(TDAH_DEFAULT_PERIOD);
    // Left blank rather than seeded with a client-local "today" — a `custom`
    // request is never sent until the user picks explicit `from`/`to`
    // themselves (spec-3-5: "hoy" is a server-only concept, never computed
    // from the device's clock).
    const [customRange, setCustomRange] = useState<{ from: string; to: string }>({ from: '', to: '' });
    const [originFilter, setOriginFilter] = useState<TdahHistoryOriginFilter>('all');
    const [routineIdFilter, setRoutineIdFilter] = useState<number | null>(null);

    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const customRangeValid = period !== 'custom' || isValidCustomPeriodRange(customRange.from, customRange.to);

    const load = useCallback(async (config: CloudConnection): Promise<void> => {
        const options = await buildCloudRequestOptions(config);
        // AD-5-style split: a routine-list failure degrades the Rutina filter
        // to "unavailable" rather than failing the whole Historial.
        const routinesResult = await cloudGetJson<{ routines: TdahRoutine[] }>(
            buildTdahUrl(config.url, '/tdah/routines'),
            options,
        ).catch(() => null);
        if (!mountedRef.current) return;
        setRoutines(routinesResult?.routines ?? []);

        const result = await cloudGetJson<TdahHistoryResponse>(
            buildHistoryUrl(config.url, { period, from: customRange.from, to: customRange.to, origin: originFilter, routineId: routineIdFilter }),
            options,
        );
        if (!mountedRef.current) return;
        setEntries(result?.entries ?? []);
        setRange(result?.range ?? null);
        setPhase('ready');
    }, [customRange.from, customRange.to, originFilter, period, routineIdFilter]);

    const reload = useCallback(async (): Promise<void> => {
        // An incomplete/invalid custom range is never sent to the server (it
        // would only earn a 400). Clear what is on screen as well as skipping
        // the fetch: leaving the previous range's entries and range label
        // under the new, invalid controls would show data that no longer
        // corresponds to the filters being displayed.
        if (period === 'custom' && !isValidCustomPeriodRange(customRange.from, customRange.to)) {
            // `phase` is deliberately left alone: an invalid range must not
            // promote a `no-sync`/`inactive` view into a `ready` one.
            setEntries([]);
            setRange(null);
            return;
        }
        setPhase('loading');
        try {
            const config = await SyncService.getCloudConfig({ silent: true });
            const url = config.url?.trim() ?? '';
            const token = config.token?.trim() ?? '';
            if (!mountedRef.current) return;
            if (!url || !token) {
                setEntries([]);
                setPhase('no-sync');
                return;
            }
            const next: CloudConnection = { url, token, allowInsecureHttp: config.allowInsecureHttp === true };
            await load(next);
        } catch (error) {
            if (!mountedRef.current) return;
            if (isActivateRequiredError(error)) {
                setEntries([]);
                setPhase('inactive');
                return;
            }
            setPhase('error');
        }
    }, [customRange.from, customRange.to, load, period]);

    useEffect(() => {
        void reload();
    }, [reload]);

    // Offline: pause automatic reloads and show the last loaded page rather
    // than surfacing a hard error (same "offline: lectura diferida + banner"
    // pattern `TdahRoutinesListView` already establishes).
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

    const rangeLabel = useMemo(() => (range ? formatRangeLabel(range, language) : null), [language, range]);

    return (
        <>
            <SettingsSectionHeader>{t('tdahHistory.title')}</SettingsSectionHeader>
            <SettingsCard>
                {phase === 'loading' ? (
                    <div className="p-4 text-[13px] text-muted-foreground">{t('tdahHistory.loading')}</div>
                ) : null}
                {phase === 'no-sync' ? (
                    <div className="p-4 space-y-1">
                        <div className="text-sm font-medium">{t('tdahHistory.title')}</div>
                        <div className="text-xs text-muted-foreground">{t('tdahHistory.needsSync')}</div>
                    </div>
                ) : null}
                {phase === 'inactive' ? (
                    <div className="p-4 space-y-1">
                        <div className="text-sm font-medium">{t('tdahHistory.title')}</div>
                        <div className="text-xs text-muted-foreground">{t('tdahHistory.inactive')}</div>
                    </div>
                ) : null}
                {phase === 'error' ? (
                    <div className="p-4 flex items-center justify-between gap-4">
                        <div className="text-[13px] text-muted-foreground">{t('tdahHistory.loadError')}</div>
                        <button
                            type="button"
                            onClick={() => void reload()}
                            className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                        >
                            {t('tdahHistory.retry')}
                        </button>
                    </div>
                ) : null}
                {phase === 'ready' ? (
                    <>
                        {isOffline ? (
                            <div className="p-3 text-xs text-muted-foreground bg-muted/30">
                                {t('tdahHistory.offlineBanner')}
                            </div>
                        ) : null}
                        <div className="p-4 space-y-3 border-b border-border">
                            <div className="flex flex-wrap items-end gap-3">
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground">{t('tdahHistory.filters.period')}</span>
                                    <select
                                        aria-label={t('tdahHistory.filters.period')}
                                        value={period}
                                        onChange={(e) => setPeriod(e.target.value as TdahHistoryMetricsPeriod)}
                                        className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                                    >
                                        {TDAH_PERIOD_OPTIONS.map((opt) => (
                                            <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                                        ))}
                                    </select>
                                </label>
                                {period === 'custom' ? (
                                    <>
                                        <label className="flex flex-col gap-1">
                                            <span className="text-xs text-muted-foreground">{t('tdahHistory.filters.from')}</span>
                                            <input
                                                type="date"
                                                aria-label={t('tdahHistory.filters.from')}
                                                value={customRange.from}
                                                onChange={(e) => setCustomRange((r) => ({ ...r, from: e.target.value }))}
                                                className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                                            />
                                        </label>
                                        <label className="flex flex-col gap-1">
                                            <span className="text-xs text-muted-foreground">{t('tdahHistory.filters.to')}</span>
                                            <input
                                                type="date"
                                                aria-label={t('tdahHistory.filters.to')}
                                                value={customRange.to}
                                                onChange={(e) => setCustomRange((r) => ({ ...r, to: e.target.value }))}
                                                className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                                            />
                                        </label>
                                    </>
                                ) : null}
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground">{t('tdahHistory.filters.origin')}</span>
                                    <select
                                        aria-label={t('tdahHistory.filters.origin')}
                                        value={originFilter}
                                        onChange={(e) => setOriginFilter(e.target.value as TdahHistoryOriginFilter)}
                                        className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                                    >
                                        <option value="all">{t('tdahHistory.filters.originAll')}</option>
                                        <option value="routine">{t('tdahHistory.filters.originRoutine')}</option>
                                        <option value="manual">{t('tdahHistory.filters.originManual')}</option>
                                    </select>
                                </label>
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs text-muted-foreground">{t('tdahHistory.filters.routine')}</span>
                                    <select
                                        aria-label={t('tdahHistory.filters.routine')}
                                        value={routineIdFilter ?? ''}
                                        onChange={(e) => setRoutineIdFilter(e.target.value ? Number(e.target.value) : null)}
                                        className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                                    >
                                        <option value="">{t('tdahHistory.filters.routineAll')}</option>
                                        {routines.map((routine) => (
                                            <option key={routine.id} value={routine.id}>{routine.title}</option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            {period === 'custom' && !customRangeValid ? (
                                <div className="text-xs text-destructive">{t('tdahHistory.filters.customRangeInvalid')}</div>
                            ) : null}
                            {rangeLabel ? (
                                <div className="text-xs text-muted-foreground">{rangeLabel}</div>
                            ) : null}
                        </div>
                        {entries.length === 0 ? (
                            <div className="p-4 text-[13px] text-muted-foreground">{t('tdahHistory.empty')}</div>
                        ) : (
                            entries.map((entry) => (
                                <div key={entry.activity.id} className="p-4 flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium truncate">{entry.activity.title}</div>
                                        <div className="text-xs text-muted-foreground mt-0.5">
                                            {formatIsoDate(entry.activity.dayPlanDate, language)}
                                            {entry.activity.startTime ? ` · ${entry.activity.startTime}` : ''}
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                            {/* `origin` decides the label, never the presence of a
                                                title: a routine-origin Actividad whose Rutina was
                                                since deleted arrives with `routineTitle: null`
                                                (documented LEFT JOIN case) and must still read
                                                "Routine", not "Manual". */}
                                            {entry.activity.origin === 'routine'
                                                ? (entry.routineTitle
                                                    ? formatI18nTemplate(t('tdahHistory.entry.fromRoutine'), { title: entry.routineTitle })
                                                    : t('tdahHistory.filters.originRoutine'))
                                                : t('tdahHistory.filters.originManual')}
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-1 shrink-0">
                                        <span className="text-xs font-medium">{t(resultLabelKey(entry))}</span>
                                        {entry.activity.movedAt ? (
                                            <span className="text-[11px] text-muted-foreground">{t('tdahHistory.entry.moved')}</span>
                                        ) : null}
                                    </div>
                                </div>
                            ))
                        )}
                    </>
                ) : null}
            </SettingsCard>
        </>
    );
}

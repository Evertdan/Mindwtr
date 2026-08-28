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
import { originLabelKey } from './TdahHistoryView';
import { TDAH_REQUEST_TIMEOUT_MS, type CloudConnection } from './TdahRoutinesListView';
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
 * T-10 (spec 3.5): "el termómetro personal" — Métricas, the compliance KPI +
 * origin breakdown + 8-week trend, all computed on the fly by the server
 * (AD-13, no precomputed aggregates). Self-contained like `TdahHistoryView`;
 * same 409-as-gate-signal convention (no separate profile fetch).
 *
 * The server side of `GET /v1/tdah/metrics` was being built in parallel from
 * the same spec and did not exist on disk when this file was written — every
 * shape below is hand-derived from spec-3-5's Code Map (ADR 0026 convention).
 *
 * KPI color is a single fixed token, never conditional on the rate — spec's
 * own Design Notes resolve a wording conflict between epics.md's formal AC
 * ("el color del KPI es constante — no cambia con la cifra, SM-C2") and a
 * looser doc-05 description, in favor of the formal/testable AC. The same
 * fixed-color rule is applied to the origin breakdown bars for the same
 * SM-C2 spirit (never reward/punish a number with color).
 */

// Mirrors the server's `TDAH_ACTIVITY_ORIGINS`; `jira` (spec 4.1) is the
// grouped work band, and `getMetrics` derives `byOrigin` from that same list,
// so the breakdown gains a third row the moment an Origin is connected.
export type TdahMetricsOrigin = 'routine' | 'manual' | 'jira';

export type TdahMetricsOriginBreakdown = {
    origin: TdahMetricsOrigin;
    completedOnTime: number;
    total: number;
};

export type TdahMetricsTrendPoint = {
    weekStart: string;
    completedOnTime: number;
    total: number;
    rate: number | null;
};

export type TdahMetricsResponse = {
    period: TdahDateRange;
    completedOnTime: number;
    total: number;
    rate: number | null;
    byOrigin: TdahMetricsOriginBreakdown[];
    trend: TdahMetricsTrendPoint[];
};

type TdahMetricsPhase = 'loading' | 'no-sync' | 'inactive' | 'ready' | 'error';

export const TDAH_METRICS_PATH = '/tdah/metrics';

const buildTdahUrl = (cloudUrl: string, path: string): string => `${getCloudBaseUrl(cloudUrl)}${path}`;

const buildCloudRequestOptions = async (config: CloudConnection) => ({
    token: config.token,
    allowInsecureHttp: config.allowInsecureHttp,
    timeoutMs: TDAH_REQUEST_TIMEOUT_MS,
    fetcher: (await getTauriHttpFetch()) ?? fetch,
});

const buildMetricsUrl = (cloudUrl: string, filters: { period: TdahHistoryMetricsPeriod; from: string; to: string }): string => {
    const params = new URLSearchParams({ period: filters.period });
    if (filters.period === 'custom') {
        params.set('from', filters.from);
        params.set('to', filters.to);
    }
    return `${buildTdahUrl(cloudUrl, TDAH_METRICS_PATH)}?${params.toString()}`;
};

const isActivateRequiredError = (error: unknown): boolean => error instanceof CloudHttpError && error.status === 409;

/**
 * Truncates rather than rounds: 249/250 (0.996) must not read "100%" next to
 * its own "249 of 250" fraction. In a KPI designed never to celebrate a
 * perfect score (SM-C2), a *false* perfect score is the worst version of the
 * same mistake — only an exact 1 prints 100%. Symmetrically, a non-zero rate
 * never truncates to a bare "0%"; the floor for any real progress is 1%.
 */
const formatRatePercent = (rate: number | null): string => {
    if (rate == null) return '—';
    if (rate >= 1) return '100%';
    const percent = Math.floor(rate * 100);
    return `${rate > 0 && percent === 0 ? 1 : percent}%`;
};

// Trend chart geometry — a plain inline SVG polyline, no charting library
// (none exists in apps/desktop; spec-3-5's Code Map is explicit about this).
const TREND_WIDTH = 280;
const TREND_HEIGHT = 80;
const TREND_PADDING = 8;

type TrendPlotPoint = { x: number; y: number; hasData: boolean };

const plotTrend = (trend: TdahMetricsTrendPoint[]): TrendPlotPoint[] => {
    if (trend.length === 0) return [];
    const usableHeight = TREND_HEIGHT - TREND_PADDING * 2;
    const step = trend.length > 1 ? (TREND_WIDTH - TREND_PADDING * 2) / (trend.length - 1) : 0;
    return trend.map((point, index) => {
        const hasData = point.rate != null;
        const rate = hasData ? (point.rate as number) : 0;
        return {
            x: TREND_PADDING + step * index,
            y: TREND_PADDING + usableHeight * (1 - rate),
            hasData,
        };
    });
};

// A single connected polyline would visually connect through gaps where a
// week has no data at all — draw contiguous runs of has-data points instead.
const trendSegments = (points: TrendPlotPoint[]): TrendPlotPoint[][] => {
    const segments: TrendPlotPoint[][] = [];
    let current: TrendPlotPoint[] = [];
    for (const point of points) {
        if (point.hasData) {
            current.push(point);
        } else if (current.length > 0) {
            segments.push(current);
            current = [];
        }
    }
    if (current.length > 0) segments.push(current);
    return segments;
};

export function TdahMetricsView() {
    const language = getCurrentUiLanguage();
    const t = getTranslator(language);

    const [phase, setPhase] = useState<TdahMetricsPhase>('loading');
    const [metrics, setMetrics] = useState<TdahMetricsResponse | null>(null);
    const [isOffline, setIsOffline] = useState(false);

    const [period, setPeriod] = useState<TdahHistoryMetricsPeriod>(TDAH_DEFAULT_PERIOD);
    // Left blank rather than seeded with a client-local "today" — same
    // reasoning as `TdahHistoryView`.
    const [customRange, setCustomRange] = useState<{ from: string; to: string }>({ from: '', to: '' });

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
        const result = await cloudGetJson<TdahMetricsResponse>(
            buildMetricsUrl(config.url, { period, from: customRange.from, to: customRange.to }),
            options,
        );
        if (!mountedRef.current) return;
        setMetrics(result ?? null);
        setPhase('ready');
    }, [customRange.from, customRange.to, period]);

    const reload = useCallback(async (): Promise<void> => {
        // Same rule as the Historial: an invalid custom range is never sent,
        // and the previous period's numbers are cleared rather than left
        // sitting under controls they no longer describe. `phase` is left
        // alone so a `no-sync`/`inactive` view is not promoted to `ready`.
        if (period === 'custom' && !isValidCustomPeriodRange(customRange.from, customRange.to)) {
            setMetrics(null);
            return;
        }
        setPhase('loading');
        try {
            const config = await SyncService.getCloudConfig({ silent: true });
            const url = config.url?.trim() ?? '';
            const token = config.token?.trim() ?? '';
            if (!mountedRef.current) return;
            if (!url || !token) {
                setMetrics(null);
                setPhase('no-sync');
                return;
            }
            const next: CloudConnection = { url, token, allowInsecureHttp: config.allowInsecureHttp === true };
            await load(next);
        } catch (error) {
            if (!mountedRef.current) return;
            if (isActivateRequiredError(error)) {
                setMetrics(null);
                setPhase('inactive');
                return;
            }
            setPhase('error');
        }
    }, [customRange.from, customRange.to, load, period]);

    useEffect(() => {
        void reload();
    }, [reload]);

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

    const periodLabel = useMemo(() => (metrics ? formatRangeLabel(metrics.period, language) : null), [language, metrics]);
    const trendPoints = useMemo(() => plotTrend(metrics?.trend ?? []), [metrics]);
    const trendPath = useMemo(
        () => trendSegments(trendPoints).map((segment) => segment.map((p) => `${p.x},${p.y}`).join(' ')),
        [trendPoints],
    );

    return (
        <>
            <SettingsSectionHeader>{t('tdahMetrics.title')}</SettingsSectionHeader>
            <SettingsCard>
                {phase === 'loading' ? (
                    <div className="p-4 text-[13px] text-muted-foreground">{t('tdahMetrics.loading')}</div>
                ) : null}
                {phase === 'no-sync' ? (
                    <div className="p-4 space-y-1">
                        <div className="text-sm font-medium">{t('tdahMetrics.title')}</div>
                        <div className="text-xs text-muted-foreground">{t('tdahMetrics.needsSync')}</div>
                    </div>
                ) : null}
                {phase === 'inactive' ? (
                    <div className="p-4 space-y-1">
                        <div className="text-sm font-medium">{t('tdahMetrics.title')}</div>
                        <div className="text-xs text-muted-foreground">{t('tdahMetrics.inactive')}</div>
                    </div>
                ) : null}
                {phase === 'error' ? (
                    <div className="p-4 flex items-center justify-between gap-4">
                        <div className="text-[13px] text-muted-foreground">{t('tdahMetrics.loadError')}</div>
                        <button
                            type="button"
                            onClick={() => void reload()}
                            className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                        >
                            {t('tdahMetrics.retry')}
                        </button>
                    </div>
                ) : null}
                {phase === 'ready' ? (
                    <>
                        {isOffline ? (
                            <div className="p-3 text-xs text-muted-foreground bg-muted/30">
                                {t('tdahMetrics.offlineBanner')}
                            </div>
                        ) : null}
                        <div className="p-4 flex flex-wrap items-end gap-3 border-b border-border">
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
                            {period === 'custom' && !customRangeValid ? (
                                <div className="text-xs text-destructive">{t('tdahHistory.filters.customRangeInvalid')}</div>
                            ) : null}
                        </div>
                        {metrics ? (
                            <>
                                <div className="p-4 space-y-1 border-b border-border">
                                    {periodLabel ? (
                                        <div className="text-xs text-muted-foreground">{periodLabel}</div>
                                    ) : null}
                                    {/* Fixed color token (`text-foreground`) — never conditional
                                        on `metrics.rate` (SM-C2: no semaphore, no celebration). */}
                                    <div className="text-3xl font-semibold text-foreground" data-testid="tdah-metrics-kpi">
                                        {formatRatePercent(metrics.rate)}
                                    </div>
                                    <div className="text-xs text-muted-foreground">{t('tdahMetrics.kpi.definition')}</div>
                                    {metrics.rate == null ? (
                                        <div className="text-xs text-muted-foreground mt-1">{t('tdahMetrics.kpi.noData')}</div>
                                    ) : (
                                        <div className="text-xs text-muted-foreground mt-1">
                                            {formatI18nTemplate(t('tdahMetrics.kpi.fraction'), {
                                                completed: metrics.completedOnTime,
                                                total: metrics.total,
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div className="p-4 space-y-2 border-b border-border">
                                    <div className="text-sm font-medium">{t('tdahMetrics.byOrigin.title')}</div>
                                    {metrics.byOrigin.map((entry) => {
                                        const width = entry.total > 0 ? Math.round(((entry.completedOnTime / entry.total) * 100)) : 0;
                                        return (
                                            <div key={entry.origin} className="space-y-1">
                                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                    <span>{t(originLabelKey(entry.origin))}</span>
                                                    <span>
                                                        {formatI18nTemplate(t('tdahMetrics.kpi.fraction'), {
                                                            completed: entry.completedOnTime,
                                                            total: entry.total,
                                                        })}
                                                    </span>
                                                </div>
                                                <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                                                    {/* Same fixed-color rule as the main KPI. */}
                                                    <div
                                                        className="h-full bg-foreground/60"
                                                        style={{ width: `${width}%` }}
                                                        data-testid={`tdah-metrics-origin-bar-${entry.origin}`}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="p-4 space-y-2">
                                    <div className="text-sm font-medium">{t('tdahMetrics.trend.title')}</div>
                                    {metrics.trend.length === 0 ? (
                                        <div className="text-xs text-muted-foreground">{t('tdahMetrics.trend.noData')}</div>
                                    ) : (
                                        <>
                                            <svg
                                                role="img"
                                                aria-label={t('tdahMetrics.trend.title')}
                                                viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`}
                                                className="w-full max-w-md h-20"
                                            >
                                                {trendPath.map((points, index) => (
                                                    <polyline
                                                        key={index}
                                                        points={points}
                                                        fill="none"
                                                        className="stroke-foreground/60"
                                                        strokeWidth={2}
                                                    />
                                                ))}
                                                {trendPoints.map((point, index) => (
                                                    <circle
                                                        key={index}
                                                        cx={point.x}
                                                        cy={point.y}
                                                        r={2.5}
                                                        className={point.hasData ? 'fill-foreground/60' : 'fill-none stroke-muted-foreground'}
                                                    />
                                                ))}
                                            </svg>
                                            <ul className="text-xs text-muted-foreground space-y-0.5">
                                                {metrics.trend.map((point) => (
                                                    <li key={point.weekStart} className="flex items-center justify-between gap-4">
                                                        <span>{formatIsoDate(point.weekStart, language)}</span>
                                                        <span>
                                                            {/* A short per-row label — `kpi.noData` is a
                                                                whole-screen empty state ("No history yet —
                                                                use the mode for a few days") and reads as
                                                                nonsense repeated inside a list of 8 weeks. */}
                                                            {point.rate == null
                                                                ? t('tdahMetrics.trend.noData')
                                                                : formatI18nTemplate(t('tdahMetrics.trend.weekFraction'), {
                                                                    completed: point.completedOnTime,
                                                                    total: point.total,
                                                                    rate: formatRatePercent(point.rate),
                                                                })}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </>
                                    )}
                                </div>
                            </>
                        ) : null}
                    </>
                ) : null}
            </SettingsCard>
        </>
    );
}

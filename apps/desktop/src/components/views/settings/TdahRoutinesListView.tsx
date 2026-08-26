import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';

import {
    cloudGetJson,
    cloudRequestJson,
    formatI18nTemplate,
    getCloudBaseUrl,
    getLocalizedWeekdayLabels,
    getTranslator,
    WEEKDAY_ORDER,
    type RecurrenceWeekday,
    type TranslateFn,
} from '@mindwtr/core';

import { getCurrentUiLanguage } from '../../../contexts/language-context';
import { getTauriHttpFetch } from '../../../lib/tauri-http';
import { SyncService } from '../../../lib/sync-service';
import { SettingsCard, SettingsSectionHeader } from './SettingRow';
import { TdahRoutineEditorView } from './TdahRoutineEditorView';

/**
 * T-03 (spec 1.4): the Rutinas list — "las plantillas de mis tipos de día".
 * Self-contained like `TdahActivationSection`: resolves its own cloud config
 * and i18n rather than threading through `SettingsMainPage`'s `t: Labels`
 * prop, and owns the list <-> editor navigation locally (no drill-in
 * precedent exists elsewhere in apps/desktop to follow instead — see the
 * `mode` state below).
 *
 * The server side of `/v1/tdah/routines*` (apps/cloud/src/tdah/) was being
 * built in parallel and did not exist on disk when this file was started, so
 * every shape below started out hand-derived from the spec's I/O & Edge-Case
 * Matrix (spec-1-4) — the same "kept in sync by hand, ADR 0026" convention
 * `TdahActivationSection.tsx` already uses for `TdahProfileState`. The real
 * server has since landed in this same working tree; the response envelopes
 * were cross-checked against `apps/cloud/src/tdah/routes.ts` and match:
 * `GET /v1/tdah/routines` → `{ routines: TdahRoutine[] }`, `GET .../:id` →
 * `{ routine: TdahRoutine }`, `POST`/`PUT` → `{ routine: TdahRoutine }`,
 * `DELETE` → `{ deleted: true }`, `GET .../:id/preview` → `{ dates: string[] }`.
 */

export type TdahRoutinePattern =
    | { kind: 'weekday'; weekdays: number[] }
    | { kind: 'nthWeekdayOfMonth'; ordinal: number; weekday: number };

export type TdahRoutineBlock = {
    id: number;
    title: string;
    startTime: string;
    durationMinutes: number;
    sortOrder: number;
};

export type TdahRoutineBlockDraft = {
    title: string;
    startTime: string;
    durationMinutes: number;
};

export type TdahRoutineOverlapWarning = { blockIndexA: number; blockIndexB: number };
export type TdahRoutineMidnightWarning = { blockIndex: number };

export type TdahRoutine = {
    id: number;
    title: string;
    pattern: TdahRoutinePattern;
    blocks: TdahRoutineBlock[];
    createdAt: string;
    // Always populated by the server's rowToRoutine (apps/cloud/src/tdah/storage.ts)
    // on every routine response — never actually optional on the wire.
    overlapWarnings: TdahRoutineOverlapWarning[];
    crossesMidnightWarnings: TdahRoutineMidnightWarning[];
};

export type CloudConnection = {
    url: string;
    token: string;
    allowInsecureHttp: boolean;
};

type TdahRoutinesListPhase = 'loading' | 'no-sync' | 'ready' | 'error';
type TdahRoutinesViewMode = 'list' | 'editor';

// Matches storage.ts's DW-2 caps from the Code Map — duplicated here by hand
// rather than imported, same cross-package convention `RITUAL_HOUR_PATTERN`
// already documents in `TdahActivationSection.tsx` (ADR 0026: clients never
// import server-only types across the wire boundary).
export const TDAH_ROUTINE_TITLE_MAX_LENGTH = 80;
export const TDAH_BLOCK_DURATION_MAX_MINUTES = 1440;
export const TDAH_ROUTINES_PATH = '/tdah/routines';
export const TDAH_ROUTINES_CONFLICTS_PATH = '/tdah/routines/conflicts';
export const TDAH_REQUEST_TIMEOUT_MS = 10_000;

const BLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const buildTdahUrl = (cloudUrl: string, path: string): string => `${getCloudBaseUrl(cloudUrl)}${path}`;

export const buildCloudRequestOptions = async (config: CloudConnection) => ({
    token: config.token,
    allowInsecureHttp: config.allowInsecureHttp,
    timeoutMs: TDAH_REQUEST_TIMEOUT_MS,
    fetcher: (await getTauriHttpFetch()) ?? fetch,
});

export const isValidRoutineTitle = (title: string): boolean =>
    title.trim().length > 0 && title.length <= TDAH_ROUTINE_TITLE_MAX_LENGTH;

export const isValidBlockDuration = (minutes: number): boolean =>
    Number.isFinite(minutes) && minutes >= 0 && minutes <= TDAH_BLOCK_DURATION_MAX_MINUTES;

export const isValidBlockStartTime = (startTime: string): boolean => BLOCK_TIME_PATTERN.test(startTime);

export const isValidWeekdayPattern = (weekdays: number[]): boolean =>
    weekdays.length > 0 && weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);

export const isValidNthWeekdayPattern = (ordinal: number, weekday: number): boolean =>
    [1, 2, 3, 4, -1].includes(ordinal) && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6;

// A block "crosses midnight" per the spec's own shape: startTime + duration
// pushes past 24:00 (DW-1). Overlap uses a simple [start, start+duration)
// interval intersection — a client-side preview only; the server's own
// `overlapWarnings`/`crossesMidnightWarnings` in the save response are
// authoritative and overwrite this local guess once a save completes.
const startMinutesOf = (startTime: string): number => {
    const [h, m] = startTime.split(':').map((part) => Number(part));
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

export const computeOverlapWarnings = (blocks: TdahRoutineBlockDraft[]): TdahRoutineOverlapWarning[] => {
    const warnings: TdahRoutineOverlapWarning[] = [];
    for (let i = 0; i < blocks.length; i += 1) {
        const aStart = startMinutesOf(blocks[i].startTime);
        const aEnd = aStart + Math.max(blocks[i].durationMinutes, 0);
        for (let j = i + 1; j < blocks.length; j += 1) {
            const bStart = startMinutesOf(blocks[j].startTime);
            const bEnd = bStart + Math.max(blocks[j].durationMinutes, 0);
            if (aStart < bEnd && bStart < aEnd) {
                warnings.push({ blockIndexA: i, blockIndexB: j });
            }
        }
    }
    return warnings;
};

export const computeMidnightWarnings = (blocks: TdahRoutineBlockDraft[]): TdahRoutineMidnightWarning[] =>
    blocks
        .map((block, blockIndex) => ({ block, blockIndex }))
        .filter(({ block }) => startMinutesOf(block.startTime) + Math.max(block.durationMinutes, 0) > 24 * 60)
        .map(({ blockIndex }) => ({ blockIndex }));

const ORDINAL_LABEL_KEY: Record<string, string> = {
    '1': 'recurrence.ordinal.first',
    '2': 'recurrence.ordinal.second',
    '3': 'recurrence.ordinal.third',
    '4': 'recurrence.ordinal.fourth',
    '-1': 'recurrence.ordinal.last',
};

export const weekdayCodeAt = (index: number): RecurrenceWeekday => WEEKDAY_ORDER[index] ?? 'SU';

/**
 * "Lunes a viernes" / "Sábados" / "Último sábado del mes" — built from
 * parametrized keys (i18n note in 03-modo-tdah-rutinas.md), reusing the
 * existing `recurrence.ordinal.*` labels and `getLocalizedWeekdayLabels`
 * (Intl-backed, no separate weekday-name keys needed — same convention
 * `recurrence-summary.ts` already establishes for the Task recurrence UI).
 */
export function describeRoutinePattern(
    pattern: TdahRoutinePattern,
    t: TranslateFn,
    language: string,
): string {
    const longLabels = getLocalizedWeekdayLabels(language, 'long');
    if (pattern.kind === 'nthWeekdayOfMonth') {
        const ordinalLabel = t(ORDINAL_LABEL_KEY[String(pattern.ordinal)] ?? ORDINAL_LABEL_KEY['1']);
        const weekdayLabel = longLabels[weekdayCodeAt(pattern.weekday)];
        return formatI18nTemplate(t('tdahRoutines.pattern.nthWeekdayOfMonth'), {
            ordinal: ordinalLabel,
            weekday: weekdayLabel,
        });
    }
    const sorted = [...pattern.weekdays].sort((a, b) => a - b);
    const key = sorted.join(',');
    if (sorted.length === 7) return t('tdahRoutines.pattern.everyDay');
    if (key === '1,2,3,4,5') return t('tdahRoutines.pattern.weekdaysMonFri');
    if (key === '0,6') return t('tdahRoutines.pattern.weekendSatSun');
    const days = sorted.map((d) => longLabels[weekdayCodeAt(d)]).join(', ');
    return formatI18nTemplate(t('tdahRoutines.pattern.onDays'), { days });
}

export const formatDurationMinutes = (minutes: number): string => {
    const total = Math.max(Math.round(minutes), 0);
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (hours <= 0) return `${mins}m`;
    if (mins <= 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
};

/**
 * AD-5: "el servidor computa la precedencia; la UI solo la solicita y la
 * renderiza, nunca la recalcula localmente". Conflicts are never computed in
 * this file — the list fetches them ready-made from
 * `GET /v1/tdah/routines/conflicts` (apps/cloud/src/tdah/storage.ts's
 * `computeRoutineConflicts`, which shares its tie-break with the same
 * `pickMostApplicableCandidate` day-plan generation uses) and only renders
 * the badge. This also picks up `nthWeekdayOfMonth` pairs, which an earlier
 * client-side-only computation here used to skip entirely.
 */
export type TdahRoutineConflict = { withId: number; withTitle: string; wins: boolean };
export type TdahRoutineConflictsById = Record<string, TdahRoutineConflict[]>;

const buildBlockPreviewText = (routine: TdahRoutine, t: TranslateFn): string => {
    if (routine.blocks.length === 0) return t('tdahRoutines.list.noBlocks');
    const sorted = [...routine.blocks].sort((a, b) => a.sortOrder - b.sortOrder);
    const shown = sorted.slice(0, 3).map((b) => `${b.startTime} ${b.title}`).join(' · ');
    return sorted.length > 3
        ? `${shown} · ${formatI18nTemplate(t('tdahRoutines.list.blocksPreviewMore'), { count: sorted.length - 3 })}`
        : shown;
};

/**
 * GET /v1/tdah/routines/conflicts can report more than one conflicting pair
 * for the same Rutina — this shows the primary one (whichever one the
 * Rutina loses to, or its first conflict otherwise) plus the same "+N more"
 * affordance `buildBlockPreviewText` already uses for an over-long Bloque
 * list, rather than silently dropping every conflict past the first.
 */
const buildConflictText = (routineConflicts: TdahRoutineConflict[], t: TranslateFn): string | null => {
    if (routineConflicts.length === 0) return null;
    const losing = routineConflicts.find((c) => !c.wins);
    const primary = losing
        ? formatI18nTemplate(t('tdahRoutines.list.conflictLoses'), { title: losing.withTitle })
        : formatI18nTemplate(t('tdahRoutines.list.conflictWins'), { title: routineConflicts[0]?.withTitle ?? '' });
    const extraCount = routineConflicts.length - 1;
    return extraCount > 0
        ? `${primary} ${formatI18nTemplate(t('tdahRoutines.list.blocksPreviewMore'), { count: extraCount })}`
        : primary;
};

const buildDuplicateTitle = (title: string, t: TranslateFn): string => {
    const suffix = t('tdahRoutines.list.duplicateSuffix');
    const candidate = `${title} ${suffix}`.trim();
    // `.slice(0, N)` counts UTF-16 code units, so it can split a surrogate
    // pair (e.g. an emoji) exactly at the boundary, producing a malformed
    // persisted title. `Array.from` iterates by code point, so slicing that
    // array instead always keeps a multi-unit character whole.
    return candidate.length > TDAH_ROUTINE_TITLE_MAX_LENGTH
        ? Array.from(candidate).slice(0, TDAH_ROUTINE_TITLE_MAX_LENGTH).join('')
        : candidate;
};

export function TdahRoutinesListView() {
    const language = getCurrentUiLanguage();
    const t = getTranslator(language);

    const [phase, setPhase] = useState<TdahRoutinesListPhase>('loading');
    const [cloud, setCloud] = useState<CloudConnection | null>(null);
    const [routines, setRoutines] = useState<TdahRoutine[]>([]);
    const [conflicts, setConflicts] = useState<TdahRoutineConflictsById>({});
    const [isOffline, setIsOffline] = useState(false);
    const [mode, setMode] = useState<TdahRoutinesViewMode>('list');
    const [editingRoutineId, setEditingRoutineId] = useState<number | null>(null);
    const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [deleteFailed, setDeleteFailed] = useState(false);
    const [duplicatingId, setDuplicatingId] = useState<number | null>(null);
    const [duplicateFailed, setDuplicateFailed] = useState(false);

    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const loadRoutines = useCallback(async (config: CloudConnection): Promise<void> => {
        const options = await buildCloudRequestOptions(config);
        const result = await cloudGetJson<{ routines: TdahRoutine[] }>(buildTdahUrl(config.url, TDAH_ROUTINES_PATH), options);
        if (!mountedRef.current) return;
        // AD-5: render the server's own order verbatim — never re-sort it here.
        setRoutines(result?.routines ?? []);
        // AD-5: fetch the server-computed conflicts rather than recompute them
        // here. A conflicts-fetch failure degrades to no conflict badges
        // instead of failing the whole Routines list.
        const conflictsResult = await cloudGetJson<{ conflicts: TdahRoutineConflictsById }>(
            buildTdahUrl(config.url, TDAH_ROUTINES_CONFLICTS_PATH),
            options,
        ).catch(() => null);
        if (!mountedRef.current) return;
        setConflicts(conflictsResult?.conflicts ?? {});
        setPhase('ready');
    }, []);

    const reload = useCallback(async (): Promise<void> => {
        setPhase('loading');
        try {
            const config = await SyncService.getCloudConfig({ silent: true });
            const url = config.url?.trim() ?? '';
            const token = config.token?.trim() ?? '';
            if (!mountedRef.current) return;
            if (!url || !token) {
                setCloud(null);
                setRoutines([]);
                setPhase('no-sync');
                return;
            }
            const next: CloudConnection = { url, token, allowInsecureHttp: config.allowInsecureHttp === true };
            setCloud(next);
            await loadRoutines(next);
        } catch {
            if (!mountedRef.current) return;
            setPhase('error');
        }
    }, [loadRoutines]);

    useEffect(() => {
        void reload();
    }, [reload]);

    // Offline: pause automatic reloads and show what was last loaded rather
    // than surfacing a hard error ("offline: lectura diferida + banner", T-03).
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

    const openCreate = useCallback(() => {
        setEditingRoutineId(null);
        setMode('editor');
    }, []);

    const openEdit = useCallback((routineId: number) => {
        setEditingRoutineId(routineId);
        setMode('editor');
    }, []);

    const closeEditor = useCallback(() => {
        setMode('list');
        setEditingRoutineId(null);
    }, []);

    // A reload failure must never be reported as a failure of the mutation
    // that triggered it — a successful delete/duplicate/save should not show
    // as "failed" just because the follow-up list refresh threw. There's no
    // dedicated "list may be stale" UI, so this degrades silently: the next
    // successful reload (retry, or the offline/online listener) catches up.
    const reloadAfterMutation = useCallback(async (config: CloudConnection): Promise<void> => {
        try {
            await loadRoutines(config);
        } catch {
            // Swallowed on purpose — see the comment above.
        }
    }, [loadRoutines]);

    const handleSaved = useCallback(() => {
        closeEditor();
        if (cloud) void reloadAfterMutation(cloud);
    }, [cloud, closeEditor, reloadAfterMutation]);

    const handleDuplicate = useCallback(async (routine: TdahRoutine) => {
        if (!cloud || duplicatingId != null) return;
        setDuplicatingId(routine.id);
        setDuplicateFailed(false);
        try {
            const options = await buildCloudRequestOptions(cloud);
            const body = {
                title: buildDuplicateTitle(routine.title, t),
                pattern: routine.pattern,
                blocks: routine.blocks.map((b) => ({
                    title: b.title,
                    startTime: b.startTime,
                    durationMinutes: b.durationMinutes,
                })),
            };
            const result = await cloudRequestJson<{ routine: TdahRoutine }>(
                'POST',
                buildTdahUrl(cloud.url, TDAH_ROUTINES_PATH),
                body,
                options,
            );
            if (!mountedRef.current) return;
            if (!result?.routine) {
                setDuplicateFailed(true);
                return;
            }
        } catch {
            if (!mountedRef.current) return;
            setDuplicateFailed(true);
            return;
        } finally {
            if (mountedRef.current) setDuplicatingId(null);
        }
        // The duplicate itself succeeded — a reload failure here must not
        // flip it back to a reported failure.
        await reloadAfterMutation(cloud);
    }, [cloud, duplicatingId, reloadAfterMutation, t]);

    const handleConfirmDelete = useCallback(async (routineId: number) => {
        if (!cloud) return;
        setDeletingId(routineId);
        setDeleteFailed(false);
        try {
            const options = await buildCloudRequestOptions(cloud);
            await cloudRequestJson(
                'DELETE',
                buildTdahUrl(cloud.url, `${TDAH_ROUTINES_PATH}/${routineId}`),
                undefined,
                options,
            );
            if (!mountedRef.current) return;
            setPendingDeleteId(null);
        } catch {
            if (!mountedRef.current) return;
            setDeleteFailed(true);
            return;
        } finally {
            if (mountedRef.current) setDeletingId(null);
        }
        // The delete itself succeeded — a reload failure here must not flip
        // it back to a reported failure.
        await reloadAfterMutation(cloud);
    }, [cloud, reloadAfterMutation]);

    if (mode === 'editor' && cloud) {
        return (
            <>
                <SettingsSectionHeader>{t('tdahRoutines.list.sectionTitle')}</SettingsSectionHeader>
                <TdahRoutineEditorView
                    cloud={cloud}
                    routineId={editingRoutineId}
                    onSaved={handleSaved}
                    onCancel={closeEditor}
                />
            </>
        );
    }

    return (
        <>
            <SettingsSectionHeader>{t('tdahRoutines.list.sectionTitle')}</SettingsSectionHeader>
            <SettingsCard>
                {phase === 'loading' ? (
                    <div className="p-4 text-[13px] text-muted-foreground">{t('tdahRoutines.list.loading')}</div>
                ) : null}
                {phase === 'no-sync' ? (
                    <div className="p-4 space-y-1">
                        <div className="text-sm font-medium">{t('tdahRoutines.list.sectionTitle')}</div>
                        <div className="text-xs text-muted-foreground">{t('tdahRoutines.list.needsSync')}</div>
                    </div>
                ) : null}
                {phase === 'error' ? (
                    <div className="p-4 flex items-center justify-between gap-4">
                        <div className="text-[13px] text-muted-foreground">{t('tdahRoutines.list.loadError')}</div>
                        <button
                            type="button"
                            onClick={() => void reload()}
                            className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                        >
                            {t('tdahRoutines.list.retry')}
                        </button>
                    </div>
                ) : null}
                {phase === 'ready' ? (
                    <>
                        {isOffline ? (
                            <div className="p-3 text-xs text-muted-foreground bg-muted/30">
                                {t('tdahRoutines.list.offlineBanner')}
                            </div>
                        ) : null}
                        {routines.length === 0 ? (
                            <div className="p-4 space-y-3">
                                <div>
                                    <div className="text-sm font-medium">{t('tdahRoutines.list.emptyTitle')}</div>
                                    <div className="text-xs text-muted-foreground mt-1">{t('tdahRoutines.list.emptyBody')}</div>
                                </div>
                                <button
                                    type="button"
                                    onClick={openCreate}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90"
                                >
                                    <Plus className="w-4 h-4" />
                                    {t('tdahRoutines.list.emptyCta')}
                                </button>
                            </div>
                        ) : (
                            <>
                                {routines.map((routine) => {
                                    const routineConflicts = conflicts[String(routine.id)] ?? [];
                                    const conflictText = buildConflictText(routineConflicts, t);
                                    return (
                                        <div key={routine.id} className="p-4 space-y-2">
                                            <div className="flex items-start justify-between gap-4">
                                                <button
                                                    type="button"
                                                    onClick={() => openEdit(routine.id)}
                                                    aria-label={formatI18nTemplate(t('tdahRoutines.list.openEditor'), { title: routine.title })}
                                                    className="min-w-0 text-left flex-1"
                                                >
                                                    <div className="text-sm font-medium truncate">{routine.title}</div>
                                                    <div className="text-xs text-muted-foreground mt-0.5">
                                                        {describeRoutinePattern(routine.pattern, t, language)}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground mt-1">
                                                        {buildBlockPreviewText(routine, t)}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground mt-1">
                                                        {formatI18nTemplate(t('tdahRoutines.list.blockCount'), { count: routine.blocks.length })}
                                                    </div>
                                                </button>
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    <button
                                                        type="button"
                                                        disabled={duplicatingId === routine.id}
                                                        onClick={() => void handleDuplicate(routine)}
                                                        aria-label={t('tdahRoutines.list.duplicate')}
                                                        title={t('tdahRoutines.list.duplicate')}
                                                        className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
                                                    >
                                                        <Copy className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => { setPendingDeleteId(routine.id); setDeleteFailed(false); }}
                                                        aria-label={t('tdahRoutines.list.delete')}
                                                        title={t('tdahRoutines.list.delete')}
                                                        className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-destructive hover:bg-muted/50"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                            {duplicateFailed && duplicatingId === null ? (
                                                <div className="text-xs text-destructive">{t('tdahRoutines.list.duplicateError')}</div>
                                            ) : null}
                                            {conflictText ? (
                                                <div className="text-xs text-amber-600 dark:text-amber-500">{conflictText}</div>
                                            ) : null}
                                            {pendingDeleteId === routine.id ? (
                                                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                                                    <div className="text-xs">{t('tdahRoutines.list.deleteConfirmBody')}</div>
                                                    {deleteFailed ? (
                                                        <div className="text-xs text-destructive">{t('tdahRoutines.list.deleteError')}</div>
                                                    ) : null}
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            disabled={deletingId === routine.id}
                                                            onClick={() => void handleConfirmDelete(routine.id)}
                                                            className="text-xs px-2.5 py-1.5 rounded-md bg-destructive text-destructive-foreground disabled:opacity-50"
                                                        >
                                                            {deletingId === routine.id ? t('tdahRoutines.list.deleting') : t('tdahRoutines.list.deleteConfirmConfirm')}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => { setPendingDeleteId(null); setDeleteFailed(false); }}
                                                            className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                                        >
                                                            {t('tdahRoutines.list.deleteConfirmCancel')}
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                    );
                                })}
                                <div className="p-4">
                                    <button
                                        type="button"
                                        onClick={openCreate}
                                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90"
                                    >
                                        <Plus className="w-4 h-4" />
                                        {t('tdahRoutines.list.newRoutine')}
                                    </button>
                                </div>
                            </>
                        )}
                    </>
                ) : null}
            </SettingsCard>
        </>
    );
}

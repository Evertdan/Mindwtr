import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';

import {
    CloudHttpError,
    cloudGetJson,
    cloudRequestJson,
    formatI18nTemplate,
    getLocalizedWeekdayLabels,
    getTranslator,
    WEEKDAY_ORDER,
} from '@mindwtr/core';

import { getCurrentUiLanguage } from '../../../contexts/language-context';
import {
    buildCloudRequestOptions,
    buildTdahUrl,
    computeMidnightWarnings,
    computeOverlapWarnings,
    isValidBlockDuration,
    isValidBlockStartTime,
    isValidNthWeekdayPattern,
    isValidRoutineTitle,
    isValidWeekdayPattern,
    TDAH_BLOCK_DURATION_MAX_MINUTES,
    TDAH_ROUTINE_TITLE_MAX_LENGTH,
    TDAH_ROUTINES_PATH,
    type CloudConnection,
    type TdahRoutine,
    type TdahRoutineBlockDraft,
    type TdahRoutineMidnightWarning,
    type TdahRoutineOverlapWarning,
    type TdahRoutinePattern,
} from './TdahRoutinesListView';

/**
 * T-04 (spec 1.4): the Rutina editor — name, calendar pattern, server-computed
 * applicability preview (AD-5: the client requests it, never recomputes
 * precedence itself), an ordered Blocks list, and the permanent edit-mode
 * banner FR-2 requires ("los días ya generados no cambian").
 */

type TdahRoutineEditorPhase = 'loading' | 'ready' | 'error';
type PatternKind = TdahRoutinePattern['kind'];
type PreviewPhase = 'idle' | 'loading' | 'ready' | 'error';

export type TdahRoutineEditorViewProps = {
    cloud: CloudConnection;
    /** null = create mode; an existing id = edit mode. */
    routineId: number | null;
    onSaved: (routine: TdahRoutine) => void;
    onCancel: () => void;
};

const ORDINAL_OPTIONS: { value: number; key: string }[] = [
    { value: 1, key: 'recurrence.ordinal.first' },
    { value: 2, key: 'recurrence.ordinal.second' },
    { value: 3, key: 'recurrence.ordinal.third' },
    { value: 4, key: 'recurrence.ordinal.fourth' },
    { value: -1, key: 'recurrence.ordinal.last' },
];

// Matches storage.ts's DW-2 caps from the Code Map — duplicated here by hand
// rather than imported, same cross-package convention TdahRoutinesListView.tsx
// already documents for TDAH_ROUTINE_TITLE_MAX_LENGTH/TDAH_BLOCK_DURATION_MAX_MINUTES
// (ADR 0026: clients never import server-only types across the wire boundary).
const TDAH_ROUTINE_MAX_BLOCKS = 24;

const pad2 = (n: number): string => String(n).padStart(2, '0');

const currentYYYYMM = (): string => {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
};

const shiftYYYYMM = (month: string, delta: number): string => {
    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    const next = new Date(year, monthIndex + delta, 1);
    return `${next.getFullYear()}-${pad2(next.getMonth() + 1)}`;
};

// Number of whole calendar months between `month` and `base` (positive when
// `month` is after `base`).
const monthDiff = (month: string, base: string): number => {
    const [monthYearStr, monthMonthStr] = month.split('-');
    const [baseYearStr, baseMonthStr] = base.split('-');
    return (Number(monthYearStr) - Number(baseYearStr)) * 12 + (Number(monthMonthStr) - Number(baseMonthStr));
};

// A user clicking prev/next with no bound would let every click fire a new
// GET .../preview request forever. There's no product reason to browse a
// Rutina's applicability more than a year out either way, so navigation
// clamps to this window around the current month.
const PREVIEW_MONTH_MIN_OFFSET = -12;
const PREVIEW_MONTH_MAX_OFFSET = 12;

const clampYYYYMM = (month: string, base: string): string => {
    const diff = monthDiff(month, base);
    if (diff < PREVIEW_MONTH_MIN_OFFSET) return shiftYYYYMM(base, PREVIEW_MONTH_MIN_OFFSET);
    if (diff > PREVIEW_MONTH_MAX_OFFSET) return shiftYYYYMM(base, PREVIEW_MONTH_MAX_OFFSET);
    return month;
};

type MonthGridDay = { date: string; dayOfMonth: number; inMonth: boolean };

const buildMonthGridDays = (month: string): MonthGridDay[] => {
    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    const firstOfMonth = new Date(year, monthIndex, 1);
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const leading = firstOfMonth.getDay(); // 0=Sun
    const cells: MonthGridDay[] = [];
    for (let i = 0; i < leading; i += 1) {
        const d = new Date(year, monthIndex, i - leading + 1);
        cells.push({ date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, dayOfMonth: d.getDate(), inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
        cells.push({ date: `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`, dayOfMonth: day, inMonth: true });
    }
    while (cells.length % 7 !== 0) {
        const last = cells[cells.length - 1];
        const [ly, lm, ld] = last.date.split('-').map(Number);
        const d = new Date(ly, lm - 1, ld + 1);
        cells.push({ date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, dayOfMonth: d.getDate(), inMonth: false });
    }
    return cells;
};

const formatDurationMinutes = (minutes: number): string => {
    const total = Math.max(Math.round(minutes), 0);
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (hours <= 0) return `${mins}m`;
    if (mins <= 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
};

const patternFromRoutine = (routine: TdahRoutine): {
    kind: PatternKind;
    weekdays: number[];
    ordinal: number;
    nthWeekday: number;
} => {
    if (routine.pattern.kind === 'nthWeekdayOfMonth') {
        return { kind: 'nthWeekdayOfMonth', weekdays: [], ordinal: routine.pattern.ordinal, nthWeekday: routine.pattern.weekday };
    }
    return { kind: 'weekday', weekdays: routine.pattern.weekdays, ordinal: 1, nthWeekday: 1 };
};

export function TdahRoutineEditorView({ cloud, routineId, onSaved, onCancel }: TdahRoutineEditorViewProps) {
    const language = getCurrentUiLanguage();
    const t = getTranslator(language);
    const isEditMode = routineId != null;

    const [phase, setPhase] = useState<TdahRoutineEditorPhase>(isEditMode ? 'loading' : 'ready');
    const [title, setTitle] = useState('');
    const [patternKind, setPatternKind] = useState<PatternKind>('weekday');
    const [weekdays, setWeekdays] = useState<number[]>([]);
    const [ordinal, setOrdinal] = useState<number>(1);
    const [nthWeekday, setNthWeekday] = useState<number>(1);
    const [blocks, setBlocks] = useState<TdahRoutineBlockDraft[]>([]);

    const [saving, setSaving] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);
    const [saveInvalidInput, setSaveInvalidInput] = useState(false);
    const [saveNotFound, setSaveNotFound] = useState(false);
    const [serverOverlapWarnings, setServerOverlapWarnings] = useState<TdahRoutineOverlapWarning[] | null>(null);
    const [serverMidnightWarnings, setServerMidnightWarnings] = useState<TdahRoutineMidnightWarning[] | null>(null);

    const [previewMonth, setPreviewMonth] = useState<string>(() => currentYYYYMM());
    const [previewDates, setPreviewDates] = useState<string[]>([]);
    const [previewPhase, setPreviewPhase] = useState<PreviewPhase>('idle');

    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const loadRoutine = useCallback(async () => {
        if (routineId == null) return;
        setPhase('loading');
        try {
            const options = await buildCloudRequestOptions(cloud);
            const result = await cloudGetJson<{ routine: TdahRoutine }>(
                buildTdahUrl(cloud.url, `${TDAH_ROUTINES_PATH}/${routineId}`),
                options,
            );
            if (!mountedRef.current) return;
            if (!result?.routine) {
                setPhase('error');
                return;
            }
            const routine = result.routine;
            setTitle(routine.title);
            const parsed = patternFromRoutine(routine);
            setPatternKind(parsed.kind);
            setWeekdays(parsed.weekdays);
            setOrdinal(parsed.ordinal);
            setNthWeekday(parsed.nthWeekday);
            setBlocks([...routine.blocks]
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((b) => ({ title: b.title, startTime: b.startTime, durationMinutes: b.durationMinutes })));
            setPhase('ready');
        } catch {
            if (!mountedRef.current) return;
            setPhase('error');
        }
    }, [cloud, routineId]);

    useEffect(() => {
        void loadRoutine();
    }, [routineId]);

    // Guards against rapid prev/next clicks firing overlapping preview
    // requests: only the response matching the most-recently-issued request
    // for this editor instance is ever applied, so a slow, now-stale response
    // for a month the user has already navigated away from can't clobber it.
    const previewRequestIdRef = useRef(0);

    const loadPreview = useCallback(async (month: string) => {
        if (routineId == null) return;
        const requestId = previewRequestIdRef.current + 1;
        previewRequestIdRef.current = requestId;
        setPreviewPhase('loading');
        try {
            const options = await buildCloudRequestOptions(cloud);
            const url = buildTdahUrl(cloud.url, `${TDAH_ROUTINES_PATH}/${routineId}/preview?month=${month}`);
            const result = await cloudGetJson<{ dates: string[] }>(url, options);
            if (!mountedRef.current || previewRequestIdRef.current !== requestId) return;
            setPreviewDates(result?.dates ?? []);
            setPreviewPhase('ready');
        } catch {
            if (!mountedRef.current || previewRequestIdRef.current !== requestId) return;
            setPreviewPhase('error');
        }
    }, [cloud, routineId]);

    useEffect(() => {
        if (routineId != null && phase === 'ready') void loadPreview(previewMonth);
    }, [routineId, phase, previewMonth]);

    const titleValid = isValidRoutineTitle(title);
    const patternValid = patternKind === 'weekday'
        ? isValidWeekdayPattern(weekdays)
        : isValidNthWeekdayPattern(ordinal, nthWeekday);
    const blocksValid = blocks.length > 0
        && blocks.length <= TDAH_ROUTINE_MAX_BLOCKS
        && blocks.every((b) =>
            b.title.trim().length > 0 && isValidBlockStartTime(b.startTime) && isValidBlockDuration(b.durationMinutes));
    const canSave = titleValid && patternValid && blocksValid && !saving;
    const atMaxBlocks = blocks.length >= TDAH_ROUTINE_MAX_BLOCKS;

    const localOverlapWarnings = useMemo(() => computeOverlapWarnings(blocks), [blocks]);
    const localMidnightWarnings = useMemo(() => computeMidnightWarnings(blocks), [blocks]);
    const overlapWarnings = serverOverlapWarnings ?? localOverlapWarnings;
    const midnightWarnings = serverMidnightWarnings ?? localMidnightWarnings;
    const totalDurationMinutes = blocks.reduce((sum, b) => sum + Math.max(b.durationMinutes, 0), 0);

    const shortWeekdayLabels = getLocalizedWeekdayLabels(language, 'short');
    const longWeekdayLabels = getLocalizedWeekdayLabels(language, 'long');

    const toggleWeekday = useCallback((index: number) => {
        setWeekdays((prev) => (prev.includes(index) ? prev.filter((d) => d !== index) : [...prev, index].sort((a, b) => a - b)));
    }, []);

    const updateBlock = useCallback((index: number, patch: Partial<TdahRoutineBlockDraft>) => {
        setBlocks((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
        setServerOverlapWarnings(null);
        setServerMidnightWarnings(null);
    }, []);

    const addBlock = useCallback(() => {
        setBlocks((prev) => [...prev, { title: '', startTime: '09:00', durationMinutes: 30 }]);
        setServerOverlapWarnings(null);
        setServerMidnightWarnings(null);
    }, []);

    const removeBlock = useCallback((index: number) => {
        setBlocks((prev) => prev.filter((_, i) => i !== index));
        setServerOverlapWarnings(null);
        setServerMidnightWarnings(null);
    }, []);

    const moveBlock = useCallback((index: number, direction: -1 | 1) => {
        setBlocks((prev) => {
            const target = index + direction;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            const [item] = next.splice(index, 1);
            next.splice(target, 0, item);
            return next;
        });
        // Reordering changes which Block index a server-computed warning
        // refers to, same as updateBlock/addBlock/removeBlock above — stale
        // warnings must not stick to the wrong (pre-reorder) index.
        setServerOverlapWarnings(null);
        setServerMidnightWarnings(null);
    }, []);

    const handleSave = useCallback(async () => {
        if (!canSave) return;
        setSaving(true);
        setSaveFailed(false);
        setSaveInvalidInput(false);
        setSaveNotFound(false);
        try {
            const options = await buildCloudRequestOptions(cloud);
            const pattern: TdahRoutinePattern = patternKind === 'weekday'
                ? { kind: 'weekday', weekdays: [...weekdays].sort((a, b) => a - b) }
                : { kind: 'nthWeekdayOfMonth', ordinal, weekday: nthWeekday };
            const body = {
                title: title.trim(),
                pattern,
                blocks: blocks.map((b) => ({
                    title: b.title.trim(),
                    startTime: b.startTime,
                    durationMinutes: b.durationMinutes,
                })),
            };
            const url = routineId == null
                ? buildTdahUrl(cloud.url, TDAH_ROUTINES_PATH)
                : buildTdahUrl(cloud.url, `${TDAH_ROUTINES_PATH}/${routineId}`);
            const method: 'POST' | 'PUT' = routineId == null ? 'POST' : 'PUT';
            const result = await cloudRequestJson<{ routine: TdahRoutine }>(method, url, body, options);
            if (!mountedRef.current) return;
            if (!result?.routine) {
                setSaveFailed(true);
                return;
            }
            const routine = result.routine;
            setServerOverlapWarnings(routine.overlapWarnings ?? []);
            setServerMidnightWarnings(routine.crossesMidnightWarnings ?? []);
            onSaved(routine);
        } catch (error) {
            if (!mountedRef.current) return;
            // A 404 means the Rutina was deleted concurrently elsewhere — that's
            // not a validation problem with this form, so it gets its own
            // message instead of the generic "fix the highlighted fields" copy.
            const isNotFound = error instanceof CloudHttpError && error.status === 404;
            const isInvalidInput = !isNotFound && error instanceof CloudHttpError && error.status >= 400 && error.status < 500;
            setSaveNotFound(isNotFound);
            setSaveInvalidInput(isInvalidInput);
            setSaveFailed(true);
        } finally {
            if (mountedRef.current) setSaving(false);
        }
    }, [blocks, canSave, cloud, nthWeekday, onSaved, ordinal, patternKind, routineId, title, weekdays]);

    if (phase === 'loading') {
        return (
            <div className="bg-card border border-border rounded-lg p-4 text-[13px] text-muted-foreground">
                {t('tdahRoutines.editor.loading')}
            </div>
        );
    }

    if (phase === 'error') {
        return (
            <div className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-4">
                <div className="text-[13px] text-muted-foreground">{t('tdahRoutines.editor.loadError')}</div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => void loadRoutine()}
                        className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    >
                        {t('tdahRoutines.list.retry')}
                    </button>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    >
                        {t('tdahRoutines.editor.cancel')}
                    </button>
                </div>
            </div>
        );
    }

    const monthDays = buildMonthGridDays(previewMonth);
    const previewDateSet = new Set(previewDates);
    const previewBaseMonth = currentYYYYMM();
    const canGoToPrevMonth = monthDiff(previewMonth, previewBaseMonth) > PREVIEW_MONTH_MIN_OFFSET;
    const canGoToNextMonth = monthDiff(previewMonth, previewBaseMonth) < PREVIEW_MONTH_MAX_OFFSET;

    return (
        <div className="bg-card border border-border rounded-lg p-4 space-y-5">
            <div className="text-sm font-medium">
                {isEditMode ? t('tdahRoutines.editor.titleEdit') : t('tdahRoutines.editor.titleCreate')}
            </div>

            {isEditMode ? (
                <div className="text-xs rounded-md border border-border bg-muted/30 p-3 text-muted-foreground">
                    {t('tdahRoutines.editor.editBanner')}
                </div>
            ) : null}

            <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t('tdahRoutines.editor.nameLabel')}</span>
                <input
                    type="text"
                    aria-label={t('tdahRoutines.editor.nameLabel')}
                    value={title}
                    disabled={saving}
                    placeholder={t('tdahRoutines.editor.namePlaceholder')}
                    onChange={(e) => setTitle(e.target.value)}
                    className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                {!titleValid && title.length > 0 ? (
                    <span className="text-xs text-destructive">
                        {formatI18nTemplate(t('tdahRoutines.editor.nameTooLong'), { max: TDAH_ROUTINE_TITLE_MAX_LENGTH })}
                    </span>
                ) : null}
            </label>

            <div className="space-y-2">
                <span className="text-xs text-muted-foreground">{t('tdahRoutines.editor.patternLabel')}</span>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setPatternKind('weekday')}
                        aria-pressed={patternKind === 'weekday'}
                        className={`text-xs px-2.5 py-1.5 rounded-md border ${patternKind === 'weekday' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground'}`}
                    >
                        {t('tdahRoutines.editor.patternKindWeekday')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setPatternKind('nthWeekdayOfMonth')}
                        aria-pressed={patternKind === 'nthWeekdayOfMonth'}
                        className={`text-xs px-2.5 py-1.5 rounded-md border ${patternKind === 'nthWeekdayOfMonth' ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground'}`}
                    >
                        {t('tdahRoutines.editor.patternKindNth')}
                    </button>
                </div>

                {patternKind === 'weekday' ? (
                    <div className="space-y-1">
                        <div className="flex flex-wrap gap-1.5">
                            {WEEKDAY_ORDER.map((code, index) => (
                                <button
                                    key={code}
                                    type="button"
                                    onClick={() => toggleWeekday(index)}
                                    aria-pressed={weekdays.includes(index)}
                                    aria-label={longWeekdayLabels[code]}
                                    className={`text-xs w-9 h-9 rounded-md border ${weekdays.includes(index) ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground'}`}
                                >
                                    {shortWeekdayLabels[code]}
                                </button>
                            ))}
                        </div>
                        {weekdays.length === 0 ? (
                            <span className="text-xs text-destructive block">{t('tdahRoutines.editor.patternWeekdaysEmpty')}</span>
                        ) : null}
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">{t('tdahRoutines.editor.patternOrdinalLabel')}</span>
                            <select
                                aria-label={t('tdahRoutines.editor.patternOrdinalLabel')}
                                value={ordinal}
                                onChange={(e) => setOrdinal(Number(e.target.value))}
                                className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                            >
                                {ORDINAL_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{t(opt.key)}</option>
                                ))}
                            </select>
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">{t('tdahRoutines.editor.patternWeekdayLabel')}</span>
                            <select
                                aria-label={t('tdahRoutines.editor.patternWeekdayLabel')}
                                value={nthWeekday}
                                onChange={(e) => setNthWeekday(Number(e.target.value))}
                                className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                            >
                                {WEEKDAY_ORDER.map((code, index) => (
                                    <option key={code} value={index}>{longWeekdayLabels[code]}</option>
                                ))}
                            </select>
                        </label>
                    </div>
                )}
            </div>

            {isEditMode ? (
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">{t('tdahRoutines.editor.previewLabel')}</span>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                aria-label={t('tdahRoutines.editor.previewPrevMonth')}
                                disabled={!canGoToPrevMonth}
                                onClick={() => setPreviewMonth((m) => clampYYYYMM(shiftYYYYMM(m, -1), previewBaseMonth))}
                                className="p-1 rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-30"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <span className="text-xs w-20 text-center">{previewMonth}</span>
                            <button
                                type="button"
                                aria-label={t('tdahRoutines.editor.previewNextMonth')}
                                disabled={!canGoToNextMonth}
                                onClick={() => setPreviewMonth((m) => clampYYYYMM(shiftYYYYMM(m, 1), previewBaseMonth))}
                                className="p-1 rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-30"
                            >
                                <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                    <div className="text-xs text-muted-foreground">{t('tdahRoutines.editor.previewHint')}</div>
                    {previewPhase === 'loading' ? (
                        <div className="text-xs text-muted-foreground">{t('tdahRoutines.editor.previewLoading')}</div>
                    ) : null}
                    {previewPhase === 'error' ? (
                        <div className="text-xs text-destructive">{t('tdahRoutines.editor.previewError')}</div>
                    ) : null}
                    {previewPhase === 'ready' ? (
                        previewDates.length === 0 ? (
                            <div className="text-xs text-muted-foreground">{t('tdahRoutines.editor.previewEmpty')}</div>
                        ) : (
                            <div className="grid grid-cols-7 gap-1">
                                {monthDays.map((day) => (
                                    <div
                                        key={day.date}
                                        className={`text-[11px] h-7 flex items-center justify-center rounded-md ${
                                            !day.inMonth
                                                ? 'text-muted-foreground/40'
                                                : previewDateSet.has(day.date)
                                                    ? 'bg-primary/20 text-primary font-medium'
                                                    : 'text-muted-foreground'
                                        }`}
                                        title={previewDateSet.has(day.date) ? t('tdahRoutines.editor.previewLegendWin') : undefined}
                                    >
                                        {day.dayOfMonth}
                                    </div>
                                ))}
                            </div>
                        )
                    ) : null}
                </div>
            ) : null}

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{t('tdahRoutines.editor.blocksLabel')}</span>
                    <span className="text-xs text-muted-foreground">
                        {formatI18nTemplate(t('tdahRoutines.editor.totalDuration'), { duration: formatDurationMinutes(totalDurationMinutes) })}
                    </span>
                </div>
                {blocks.length === 0 ? (
                    <div className="text-xs text-muted-foreground">{t('tdahRoutines.editor.blocksEmpty')}</div>
                ) : (
                    <div className="space-y-2">
                        {blocks.map((block, index) => {
                            const blockOverlap = overlapWarnings.some((w) => w.blockIndexA === index || w.blockIndexB === index);
                            const blockMidnight = midnightWarnings.some((w) => w.blockIndex === index);
                            return (
                                <div key={index} className="rounded-md border border-border p-2.5 space-y-1.5">
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            aria-label={t('tdahRoutines.editor.blockTitleLabel')}
                                            value={block.title}
                                            disabled={saving}
                                            placeholder={t('tdahRoutines.editor.blockTitlePlaceholder')}
                                            onChange={(e) => updateBlock(index, { title: e.target.value })}
                                            className="flex-1 min-w-0 text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                                        />
                                        <input
                                            type="time"
                                            aria-label={t('tdahRoutines.editor.blockStartTimeLabel')}
                                            value={block.startTime}
                                            disabled={saving}
                                            onChange={(e) => updateBlock(index, { startTime: e.target.value })}
                                            className="text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                                        />
                                        <input
                                            type="number"
                                            min={0}
                                            aria-label={t('tdahRoutines.editor.blockDurationLabel')}
                                            value={block.durationMinutes}
                                            disabled={saving}
                                            onChange={(e) => updateBlock(index, { durationMinutes: Number(e.target.value) })}
                                            className="w-20 text-[13px] bg-muted/50 text-foreground border border-border rounded-md px-2.5 py-1.5"
                                        />
                                        <button
                                            type="button"
                                            disabled={saving || index === 0}
                                            aria-label={t('tdahRoutines.editor.blockMoveUp')}
                                            onClick={() => moveBlock(index, -1)}
                                            className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-30"
                                        >
                                            <ArrowUp className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            disabled={saving || index === blocks.length - 1}
                                            aria-label={t('tdahRoutines.editor.blockMoveDown')}
                                            onClick={() => moveBlock(index, 1)}
                                            className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-30"
                                        >
                                            <ArrowDown className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            disabled={saving}
                                            aria-label={t('tdahRoutines.editor.removeBlock')}
                                            onClick={() => removeBlock(index)}
                                            className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-destructive disabled:opacity-30"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                    {!isValidBlockDuration(block.durationMinutes) ? (
                                        <div className="text-xs text-destructive">
                                            {formatI18nTemplate(t('tdahRoutines.editor.blockDurationTooLong'), { max: TDAH_BLOCK_DURATION_MAX_MINUTES })}
                                        </div>
                                    ) : null}
                                    {blockOverlap ? (
                                        <div className="text-xs text-amber-600 dark:text-amber-500">{t('tdahRoutines.editor.overlapWarning')}</div>
                                    ) : null}
                                    {blockMidnight ? (
                                        <div className="text-xs text-amber-600 dark:text-amber-500">
                                            {formatI18nTemplate(t('tdahRoutines.editor.midnightWarning'), { title: block.title || t('tdahRoutines.editor.untitledBlock') })}
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                )}
                <button
                    type="button"
                    onClick={addBlock}
                    disabled={saving || atMaxBlocks}
                    className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Plus className="w-3.5 h-3.5" />
                    {t('tdahRoutines.editor.addBlock')}
                </button>
            </div>

            <div className="flex items-center gap-3 pt-2">
                <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={!canSave}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {saving ? t('tdahRoutines.editor.saving') : t('tdahRoutines.editor.save')}
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={saving}
                    className="px-4 py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-50"
                >
                    {t('tdahRoutines.editor.cancel')}
                </button>
                {saveFailed ? (
                    <span className="text-xs text-destructive">
                        {saveNotFound
                            ? t('tdahRoutines.editor.saveNotFound')
                            : saveInvalidInput ? t('tdahRoutines.editor.saveInvalid') : t('tdahRoutines.editor.saveError')}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

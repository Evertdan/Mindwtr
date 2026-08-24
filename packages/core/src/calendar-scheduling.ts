import { hasTimeComponent, safeFormatDate, safeParseDate } from './date';
import { formatI18nTemplate } from './i18n';
import { en as ENGLISH_TRANSLATIONS } from './i18n/locales/en';
import type { ExternalCalendarEvent } from './ics';
import { parseQuickAdd, type QuickAddParseOptions } from './quick-add';
import { isSelectableProjectForTaskAssignment } from './project-utils';
import { getTaskDateCoherenceIssues, type TaskDateCoherenceIssue } from './task-date-coherence';
import { isTaskActionable } from './task-status';
import type { Area, CustomTimeEstimate, Project, Task, TimeEstimate, TimeEstimatePreset } from './types';

/** Shared translate-function shape for the localization seam below — same shape as
 *  recurrence.ts's `formatRecurrenceLabel`. */
type TranslateFn = (key: string) => string;

type CalendarLabelOptions = {
    /** Defaults to English (this module's existing hardcoded strings) when omitted, so
     *  every call site that predates this seam keeps its exact current output. */
    t?: TranslateFn;
    /** BCP-47 tag (e.g. 'en-US', 'vi-VN'); only affects the decimal separator in a
     *  fractional-hours duration label. Defaults to the runtime's locale. */
    locale?: string;
};

const defaultTranslate: TranslateFn = (key) => ENGLISH_TRANSLATIONS[key] ?? key;

export const DEFAULT_CALENDAR_DAY_START_HOUR = 8;
export const DEFAULT_CALENDAR_DAY_END_HOUR = 23;
export const DEFAULT_CALENDAR_SNAP_MINUTES = 5;
export const CUSTOM_TIME_ESTIMATE_PREFIX = 'custom:';

export const CALENDAR_TIME_ESTIMATE_OPTIONS: Array<{ estimate: TimeEstimatePreset; minutes: number }> = [
    { estimate: '5min', minutes: 5 },
    { estimate: '10min', minutes: 10 },
    { estimate: '15min', minutes: 15 },
    { estimate: '30min', minutes: 30 },
    { estimate: '1hr', minutes: 60 },
    { estimate: '2hr', minutes: 120 },
    { estimate: '3hr', minutes: 180 },
    { estimate: '4hr', minutes: 240 },
];

const normalizeExactTimeEstimateMinutes = (minutes: number): number => Math.max(1, Math.round(minutes));

type SchedulingTask = Pick<Task, 'deletedAt' | 'id' | 'startTime' | 'status' | 'timeEstimate'>;
type SchedulingEvent = Pick<ExternalCalendarEvent, 'allDay' | 'end' | 'start'>;

export type CalendarEventTaskDraft = {
    initialProps: Partial<Task>;
    title: string;
};

export type CalendarQuickAddTaskDraft = {
    dateCoherenceIssues: TaskDateCoherenceIssue[];
    invalidDateCommands: string[];
    projectTitle?: string;
    props: Partial<Task>;
    title: string;
};

type CalendarEventTaskDraftOptions = {
    calendarName?: string;
    fallbackTitle?: string;
};

type CalendarQuickAddTaskDraftOptions = {
    areas?: Area[];
    durationMinutes: number;
    now?: Fecha;
    /** The capture surface's parse bag; without it `@John Smith` splits at the space. */
    parseOptions?: QuickAddParseOptions;
    projects?: Project[];
    start: Fecha;
};

type CalendarSchedulingOptions = {
    dayEndHour?: number;
    dayStartHour?: number;
    snapMinutes?: number;
    timeEstimatesEnabled?: boolean;
};

type FindFreeSlotOptions = CalendarSchedulingOptions & {
    day: Fecha;
    durationMinutes: number;
    events: readonly SchedulingEvent[];
    excludeTaskId?: string;
    now?: Fecha;
    tasks: readonly SchedulingTask[];
};

type IsSlotFreeOptions = CalendarSchedulingOptions & {
    day: Fecha;
    durationMinutes: number;
    events: readonly SchedulingEvent[];
    excludeTaskId?: string;
    startTime: Fecha;
    tasks: readonly SchedulingTask[];
};

type Interval = { end: number; start: number };

export function createCustomTimeEstimate(minutes: number): CustomTimeEstimate {
    return `${CUSTOM_TIME_ESTIMATE_PREFIX}${normalizeExactTimeEstimateMinutes(minutes)}` as CustomTimeEstimate;
}

export function customTimeEstimateToMinutes(estimate: TimeEstimate | undefined): number | null {
    if (!estimate?.startsWith(CUSTOM_TIME_ESTIMATE_PREFIX)) return null;
    const minutes = Number(estimate.slice(CUSTOM_TIME_ESTIMATE_PREFIX.length));
    if (!Number.isFinite(minutes) || minutes < 1) return null;
    return normalizeExactTimeEstimateMinutes(minutes);
}

export function isCustomTimeEstimate(estimate: TimeEstimate | undefined): estimate is CustomTimeEstimate {
    return customTimeEstimateToMinutes(estimate) !== null;
}

export function timeEstimateToMinutes(estimate: TimeEstimate | undefined, options?: { enabled?: boolean }): number {
    if (options?.enabled === false) return 30;
    const customMinutes = customTimeEstimateToMinutes(estimate);
    if (customMinutes !== null) return customMinutes;

    switch (estimate) {
        case '5min': return 5;
        case '10min': return 10;
        case '15min': return 15;
        case '30min': return 30;
        case '1hr': return 60;
        case '2hr': return 120;
        case '3hr': return 180;
        case '4hr':
        case '4hr+':
            return 240;
        default:
            return 30;
    }
}

export function minutesToTimeEstimate(minutes: number): TimeEstimate {
    const normalized = normalizeExactTimeEstimateMinutes(minutes);
    const exact = CALENDAR_TIME_ESTIMATE_OPTIONS.find((option) => option.minutes === normalized);
    if (exact) return exact.estimate;

    return createCustomTimeEstimate(normalized);
}

export function minutesToTimeEstimateBucket(minutes: number): TimeEstimatePreset {
    const normalized = normalizeExactTimeEstimateMinutes(minutes);
    const exact = CALENDAR_TIME_ESTIMATE_OPTIONS.find((option) => option.minutes === normalized);
    if (exact) return exact.estimate;

    const nextLargest = CALENDAR_TIME_ESTIMATE_OPTIONS.find((option) => option.minutes >= normalized);
    return nextLargest?.estimate ?? '4hr+';
}

export function timeEstimateToFilterBucket(estimate: TimeEstimate | undefined): TimeEstimatePreset | undefined {
    if (!estimate) return undefined;
    return minutesToTimeEstimateBucket(timeEstimateToMinutes(estimate));
}

export function formatTimeEstimateLabel(estimate: TimeEstimate, options?: CalendarLabelOptions): string {
    const t = options?.t ?? defaultTranslate;
    switch (estimate) {
        case '5min': return formatI18nTemplate(t('units.minutesShort'), { minutes: 5 });
        case '10min': return formatI18nTemplate(t('units.minutesShort'), { minutes: 10 });
        case '15min': return formatI18nTemplate(t('units.minutesShort'), { minutes: 15 });
        case '30min': return formatI18nTemplate(t('units.minutesShort'), { minutes: 30 });
        case '1hr': return formatI18nTemplate(t('units.hoursShort'), { hours: 1 });
        case '2hr': return formatI18nTemplate(t('units.hoursShort'), { hours: 2 });
        case '3hr': return formatI18nTemplate(t('units.hoursShort'), { hours: 3 });
        case '4hr': return formatI18nTemplate(t('units.hoursShort'), { hours: 4 });
        case '4hr+': return formatI18nTemplate(t('units.hoursPlusShort'), { hours: 4 });
        default: {
            // custom:NN — every duplicate re-roll of this function (#Part C) collapsed this
            // branch to the same '4hr+' case as above, losing the exact hours/minutes split.
            const minutes = timeEstimateToMinutes(estimate);
            const hours = Math.floor(minutes / 60);
            const remainder = minutes % 60;
            if (hours <= 0) return formatI18nTemplate(t('units.minutesShort'), { minutes });
            if (remainder === 0) return formatI18nTemplate(t('units.hoursShort'), { hours });
            return formatI18nTemplate(t('units.hoursMinutesShort'), { hours, minutes: remainder });
        }
    }
}

export function parseTimeEstimateInput(value: string): number | null {
    const normalized = value.trim().toLowerCase().replace(',', '.');
    if (!normalized) return null;

    const compact = normalized.replace(/\s+/g, '');
    const hoursAndMinutes = /^(\d+(?:\.\d+)?)h(?:ours?)?(?:(\d+)(?:m(?:in(?:ute)?s?)?)?)?$/.exec(compact);
    if (hoursAndMinutes) {
        const hours = Number(hoursAndMinutes[1]);
        const minutes = hoursAndMinutes[2] ? Number(hoursAndMinutes[2]) : 0;
        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
        return normalizeExactTimeEstimateMinutes(hours * 60 + minutes);
    }

    const minutesOnly = /^(\d+(?:\.\d+)?)(?:m|min|mins|minute|minutes)?$/.exec(compact);
    if (minutesOnly) {
        const minutes = Number(minutesOnly[1]);
        if (!Number.isFinite(minutes)) return null;
        return normalizeExactTimeEstimateMinutes(minutes);
    }

    return null;
}

export function buildCalendarQuickAddTaskDraft(
    input: string,
    options: CalendarQuickAddTaskDraftOptions,
): CalendarQuickAddTaskDraft {
    const parsed = parseQuickAdd(
        input,
        options.projects,
        options.now ?? new Fecha(),
        options.areas,
        options.parseOptions,
    );
    const props: Partial<Task> = {
        status: 'next',
        ...parsed.props,
        startTime: options.start.toISOString(),
        timeEstimate: minutesToTimeEstimate(options.durationMinutes),
    };

    if (
        props.projectId
        && options.projects
        && !options.projects.some((project) => (
            project.id === props.projectId
            && isSelectableProjectForTaskAssignment(project)
        ))
    ) {
        delete props.projectId;
    }

    if (
        props.areaId
        && options.areas
        && !options.areas.some((area) => area.id === props.areaId && !area.deletedAt)
    ) {
        delete props.areaId;
    }

    if (props.projectId) {
        props.areaId = undefined;
    }

    return {
        dateCoherenceIssues: getTaskDateCoherenceIssues({
            dueDate: props.dueDate,
            startTime: props.startTime,
        }),
        invalidDateCommands: parsed.invalidDateCommands ?? [],
        projectTitle: props.projectId ? undefined : parsed.projectTitle,
        props,
        title: (parsed.title || input).trim(),
    };
}

function cleanEventTaskText(value: string | undefined): string {
    return (value ?? '').trim();
}

function allDayEventDateValue(event: ExternalCalendarEvent, start: Fecha): string {
    const datePrefix = /^(\d{4}-\d{2}-\d{2})/.exec(event.start)?.[1];
    return datePrefix ?? safeFormatDate(start, 'yyyy-MM-dd', start.toISOString().slice(0, 10));
}

export function buildCalendarEventTaskDraft(
    event: ExternalCalendarEvent,
    options: CalendarEventTaskDraftOptions = {},
): CalendarEventTaskDraft {
    const title = cleanEventTaskText(event.title)
        || cleanEventTaskText(options.fallbackTitle)
        || 'Calendar event';
    const start = safeParseDate(event.start);
    const end = safeParseDate(event.end);
    const initialProps: Partial<Task> = {
        status: 'next',
    };

    if (event.allDay) {
        if (start) {
            initialProps.dueDate = allDayEventDateValue(event, start);
        }
    } else if (start) {
        initialProps.startTime = start.toISOString();
        if (end && end > start) {
            const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
            initialProps.timeEstimate = minutesToTimeEstimate(durationMinutes);
        }
    }

    const location = cleanEventTaskText(event.location);
    if (location) {
        initialProps.location = location;
    }

    const descriptionParts = [
        cleanEventTaskText(event.description),
        cleanEventTaskText(options.calendarName) ? `Calendar: ${cleanEventTaskText(options.calendarName)}` : '',
    ].filter((part) => part.length > 0);

    if (descriptionParts.length > 0) {
        initialProps.description = descriptionParts.join('\n\n');
    }

    return {
        initialProps,
        title,
    };
}

export function normalizeCalendarDurationMinutes(minutes: number): number {
    const estimate = minutesToTimeEstimateBucket(minutes);
    return CALENDAR_TIME_ESTIMATE_OPTIONS.find((option) => option.estimate === estimate)?.minutes
        ?? timeEstimateToMinutes(estimate);
}

export function addCalendarMinutes(date: Fecha, minutes: number): Fecha {
    return new Fecha(date.getTime() + minutes * 60_000);
}

export function formatCalendarTimeInputValue(date: Fecha): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function parseCalendarTimeOnDate(
    date: Fecha,
    value: string,
    // Accepted for API symmetry with formatTimeEstimateLabel/formatCalendarDurationLabel
    // above (a real caller needs this once a UI feeds it non-English am/pm text); not yet
    // consumed — every current caller feeds ASCII HH:MM / English am-pm text regardless of
    // locale, so there's nothing to route through timeFormat/locale here today.
    _options?: { timeFormat?: string; locale?: string },
): Fecha | null {
    const trimmed = value.trim();
    const twelveHourMatch = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i.exec(trimmed);
    if (twelveHourMatch) {
        const hour12 = Number(twelveHourMatch[1]);
        const minutes = twelveHourMatch[2] === undefined ? 0 : Number(twelveHourMatch[2]);
        if (!Number.isInteger(hour12) || !Number.isInteger(minutes)) return null;
        if (hour12 < 1 || hour12 > 12 || minutes < 0 || minutes > 59) return null;
        const period = twelveHourMatch[3].toLowerCase();
        const hours = period === 'p'
            ? (hour12 === 12 ? 12 : hour12 + 12)
            : (hour12 === 12 ? 0 : hour12);
        const next = new Fecha(date);
        next.setHours(hours, minutes, 0, 0);
        return next;
    }

    const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    const next = new Fecha(date);
    next.setHours(hours, minutes, 0, 0);
    return next;
}

export function formatCalendarDurationLabel(minutes: number, options?: CalendarLabelOptions): string {
    const t = options?.t ?? defaultTranslate;
    if (minutes < 60) return formatI18nTemplate(t('units.minutesShort'), { minutes });
    const hours = minutes / 60;
    const hoursValue = Number.isInteger(hours)
        ? String(hours)
        // toFixed(1) always uses '.'; Intl.NumberFormat gives the locale's own decimal
        // separator (e.g. ',' for de/fr/pl/pt/tr/vi/cs/it) for the same one-decimal rounding.
        : new Intl.NumberFormat(options?.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(hours);
    return formatI18nTemplate(t('units.hoursShort'), { hours: hoursValue });
}

const ceilToMinutes = (date: Fecha, stepMinutes: number): Fecha => {
    const stepMs = stepMinutes * 60 * 1000;
    return new Fecha(Math.ceil(date.getTime() / stepMs) * stepMs);
};

const isSameLocalDay = (left: Fecha, right: Fecha): boolean => (
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
);

const getDayBounds = (day: Fecha, options?: CalendarSchedulingOptions): { dayEnd: Fecha; dayStart: Fecha; snapMinutes: number } => {
    const dayStart = new Fecha(day);
    dayStart.setHours(options?.dayStartHour ?? DEFAULT_CALENDAR_DAY_START_HOUR, 0, 0, 0);
    const dayEnd = new Fecha(day);
    dayEnd.setHours(options?.dayEndHour ?? DEFAULT_CALENDAR_DAY_END_HOUR, 0, 0, 0);
    return {
        dayEnd,
        dayStart,
        snapMinutes: options?.snapMinutes ?? DEFAULT_CALENDAR_SNAP_MINUTES,
    };
};

const taskBlocksScheduling = (task: SchedulingTask, excludeTaskId?: string): boolean => {
    if (task.deletedAt) return false;
    if (task.id === excludeTaskId) return false;
    return isTaskActionable(task);
};

const collectBusyIntervals = (
    day: Fecha,
    events: readonly SchedulingEvent[],
    tasks: readonly SchedulingTask[],
    options?: CalendarSchedulingOptions & { excludeTaskId?: string },
): Interval[] => {
    const { dayEnd, dayStart } = getDayBounds(day, options);
    const intervals: Interval[] = [];

    for (const event of events) {
        if (event.allDay) continue;
        const start = safeParseDate(event.start);
        const end = safeParseDate(event.end);
        if (!start || !end) continue;
        const s = Math.max(start.getTime(), dayStart.getTime());
        const e = Math.min(end.getTime(), dayEnd.getTime());
        if (e > s) intervals.push({ start: s, end: e });
    }

    for (const task of tasks) {
        if (!taskBlocksScheduling(task, options?.excludeTaskId)) continue;
        if (!hasTimeComponent(task.startTime)) continue;
        const start = safeParseDate(task.startTime);
        if (!start || !isSameLocalDay(start, day)) continue;
        const durationMs = timeEstimateToMinutes(task.timeEstimate, { enabled: options?.timeEstimatesEnabled }) * 60 * 1000;
        const s = Math.max(start.getTime(), dayStart.getTime());
        const e = Math.min(start.getTime() + durationMs, dayEnd.getTime());
        if (e > s) intervals.push({ start: s, end: e });
    }

    intervals.sort((a, b) => a.start - b.start);
    const merged: Interval[] = [];
    for (const interval of intervals) {
        const last = merged[merged.length - 1];
        if (!last || interval.start > last.end) merged.push({ ...interval });
        else last.end = Math.max(last.end, interval.end);
    }
    return merged;
};

export function findFreeSlotForDay(options: FindFreeSlotOptions): Fecha | null {
    const { dayEnd, dayStart, snapMinutes } = getDayBounds(options.day, options);
    const now = options.now ?? new Fecha();
    const isToday = isSameLocalDay(options.day, now);
    const earliest = ceilToMinutes(
        new Fecha(Math.max(dayStart.getTime(), isToday ? now.getTime() : dayStart.getTime())),
        snapMinutes,
    );
    const intervals = collectBusyIntervals(options.day, options.events, options.tasks, options);
    const durationMs = options.durationMinutes * 60 * 1000;
    let cursor = Math.max(earliest.getTime(), dayStart.getTime());

    for (const interval of intervals) {
        if (cursor + durationMs <= interval.start) return new Fecha(cursor);
        if (cursor < interval.end) {
            cursor = ceilToMinutes(new Fecha(interval.end), snapMinutes).getTime();
        }
    }

    if (cursor + durationMs <= dayEnd.getTime()) return new Fecha(cursor);
    return null;
}

export function isSlotFreeForDay(options: IsSlotFreeOptions): boolean {
    const startMs = options.startTime.getTime();
    const endMs = startMs + options.durationMinutes * 60 * 1000;

    const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean => aStart < bEnd && aEnd > bStart;
    const intervals = collectBusyIntervals(options.day, options.events, options.tasks, {
        ...options,
        dayEndHour: 24,
        dayStartHour: 0,
    });
    return !intervals.some((interval) => overlaps(startMs, endMs, interval.start, interval.end));
}

// MARK: - Calendar push event content (shared by mobile + desktop push)

// Only external schemes resolve from an external calendar (e.g. Outlook/Exchange);
// internal `mindwtr://` links are dropped from pushed events.
const CALENDAR_PUSH_LINK_SCHEME_RE = /^(?:https?|mailto):/i;

function getCalendarPushLinkUris(attachments: Task['attachments']): string[] {
    const seen = new Set<string>();
    const links: string[] = [];
    for (const attachment of attachments ?? []) {
        if (attachment.deletedAt) continue;
        if (attachment.kind !== 'link') continue;
        const uri = typeof attachment.uri === 'string' ? attachment.uri.trim() : '';
        if (!uri || !CALENDAR_PUSH_LINK_SCHEME_RE.test(uri)) continue;
        if (seen.has(uri)) continue;
        seen.add(uri);
        links.push(uri);
    }
    return links;
}

function formatCalendarPushStatusLabel(status: Task['status']): string {
    const normalized = String(status ?? '').trim();
    if (!normalized) return '';
    return normalized
        .split('-')
        .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
        .join(' ');
}

function formatCalendarPushEffortLabel(timeEstimate: Task['timeEstimate']): string {
    if (!timeEstimate) return '';
    const minutes = timeEstimateToMinutes(timeEstimate);
    if (!Number.isFinite(minutes) || minutes <= 0) return '';
    if (minutes < 60) return `${minutes} min`;
    const hours = minutes / 60;
    const rounded = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
    return `${rounded} h`;
}

export interface CalendarPushEventContext {
    projectName?: string | null;
    sectionName?: string | null;
    /** Prepended note, e.g. the projected-recurrence explanation. */
    leadingNote?: string | null;
    /** Localized status label; falls back to a capitalized status token. */
    statusLabel?: string | null;
    /** Localized effort label; falls back to a minutes/hours label. */
    effortLabel?: string | null;
}

export interface CalendarPushEventFields {
    notes: string;
    /** Primary external link for the event URL field (platforms that support it). */
    url: string | null;
}

/**
 * Builds the shared notes body and primary URL for a task pushed to an external
 * calendar. Both the mobile (expo-calendar) and desktop (system calendar) push
 * paths consume this so event content stays identical across platforms (#743).
 *
 * Metadata (project › section, status, effort) plus any external links are
 * surfaced in the notes; status/effort are omitted when not meaningful. The
 * primary external link is also returned for the native URL field where
 * supported.
 */
export function buildCalendarPushEventFields(
    task: Pick<Task, 'attachments' | 'description' | 'status' | 'timeEstimate'>,
    context: CalendarPushEventContext = {},
): CalendarPushEventFields {
    const links = getCalendarPushLinkUris(task.attachments);

    const metaLines: string[] = [];
    const projectName = context.projectName?.trim();
    const sectionName = context.sectionName?.trim();
    if (projectName) {
        metaLines.push(sectionName ? `Project: ${projectName} › ${sectionName}` : `Project: ${projectName}`);
    }
    const statusLabel = context.statusLabel?.trim() || formatCalendarPushStatusLabel(task.status);
    if (statusLabel) metaLines.push(`Status: ${statusLabel}`);
    // timeEstimateToMinutes defaults to 30 for an undefined estimate, so only
    // emit an effort line when the task actually carries one.
    if (task.timeEstimate) {
        const effortLabel = context.effortLabel?.trim() || formatCalendarPushEffortLabel(task.timeEstimate);
        if (effortLabel) metaLines.push(`Effort: ${effortLabel}`);
    }

    const blocks = [
        context.leadingNote?.trim() || '',
        metaLines.join('\n'),
        task.description?.trim() || '',
        links.length > 0 ? links.map((link) => `Link: ${link}`).join('\n') : '',
    ].filter(Boolean);

    return {
        notes: blocks.join('\n\n'),
        url: links[0] ?? null,
    };
}

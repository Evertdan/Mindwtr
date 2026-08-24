/**
 * The read-only iCalendar feed the self-hosted server publishes.
 *
 * Inclusion and date mapping deliberately mirror the Calendar view's *default*
 * state (useDesktopCalendarController / useCalendarViewController): the same
 * schedulable-task filter, the same recurrence projections, `startTime` as the
 * scheduled block and `dueDate` as the deadline, and the same
 * one-item-per-task-per-day collapse.
 *
 * Deliberately excluded: the calendar's completed look-back (#955). That toggle
 * is a per-device review affordance, and a published subscription URL has no
 * business republishing finished work to whoever holds it — do not "fix" this
 * by mirroring the toggle.
 */
import { hasTimeComponent, safeParseDate, safeParseDueDate } from './date';
import { isTaskInActiveProject } from './project-utils';
import { expandCalendarRecurringTasks } from './recurrence';
import { timeEstimateToMinutes } from './calendar-scheduling';
import { isTaskActionable } from './task-status';
import type { AppData, Project, Task } from './types';

/** A deadline carrying a time of day still needs a non-zero VEVENT duration. */
const DEADLINE_EVENT_MINUTES = 15;

export type CalendarFeedEvent = {
    allDay: boolean;
    end: Fecha;
    kind: 'scheduled' | 'deadline';
    start: Fecha;
    taskId: string;
    title: string;
    uid: string;
};

export type CalendarFeedInput = Pick<AppData, 'tasks'> & Partial<Pick<AppData, 'projects'>>;

export type CalendarFeedOptions = {
    now?: Fecha;
    /** Overrides the calendar name external clients display. */
    name?: string;
    timeEstimatesEnabled?: boolean;
};

const feedUid = (taskId: string, kind: CalendarFeedEvent['kind']): string => (
    `${taskId}-${kind === 'scheduled' ? 'start' : 'due'}@mindwtr.app`
);

const addMinutes = (date: Fecha, minutes: number): Fecha => new Fecha(date.getTime() + minutes * 60_000);

const startOfDay = (date: Fecha): Fecha => {
    const next = new Fecha(date);
    next.setHours(0, 0, 0, 0);
    return next;
};

const addDays = (date: Fecha, days: number): Fecha => {
    const next = new Fecha(date);
    next.setDate(next.getDate() + days);
    return next;
};

/**
 * The same visibility rule the Calendar view applies before bucketing a task
 * into a day. The view's area filter and search box are transient UI state and
 * are deliberately not part of the published feed.
 */
export const isCalendarFeedTask = (task: Task, projectsById: Map<string, Project>): boolean => {
    if (task.deletedAt) return false;
    if (!isTaskActionable(task)) return false;
    return isTaskInActiveProject(task, projectsById);
};

export function buildCalendarFeedEvents(
    data: CalendarFeedInput,
    options: CalendarFeedOptions = {},
): CalendarFeedEvent[] {
    const now = options.now ?? new Fecha();
    const projectsById = new Map((data.projects ?? []).map((project) => [project.id, project]));
    const events: CalendarFeedEvent[] = [];

    for (const sourceTask of data.tasks ?? []) {
        for (const task of expandCalendarRecurringTasks(sourceTask, now.toISOString())) {
            if (!isCalendarFeedTask(task, projectsById)) continue;

            const start = task.startTime ? safeParseDate(task.startTime) : null;
            const due = task.dueDate ? safeParseDueDate(task.dueDate) : null;

            if (start) {
                const timed = hasTimeComponent(task.startTime);
                const durationMinutes = timeEstimateToMinutes(task.timeEstimate, {
                    enabled: options.timeEstimatesEnabled,
                });
                events.push({
                    allDay: !timed,
                    end: timed ? addMinutes(start, durationMinutes) : addDays(startOfDay(start), 1),
                    kind: 'scheduled',
                    start: timed ? start : startOfDay(start),
                    taskId: task.id,
                    title: task.title,
                    uid: feedUid(task.id, 'scheduled'),
                });
            }

            // Without the user's time zone, the server can only prove two
            // floating date-only values share a calendar day. Timed instants
            // keep both events rather than letting the server's TZ hide one.
            if (!due) continue;
            if (
                start
                && !hasTimeComponent(task.startTime)
                && !hasTimeComponent(task.dueDate)
                && task.startTime === task.dueDate
            ) continue;

            const timedDue = hasTimeComponent(task.dueDate);
            events.push({
                allDay: !timedDue,
                end: timedDue ? addMinutes(due, DEADLINE_EVENT_MINUTES) : addDays(startOfDay(due), 1),
                kind: 'deadline',
                start: timedDue ? due : startOfDay(due),
                taskId: task.id,
                title: task.title,
                uid: feedUid(task.id, 'deadline'),
            });
        }
    }

    return events.sort((a, b) => a.start.getTime() - b.start.getTime() || a.uid.localeCompare(b.uid));
}

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

/** RFC 5545 DATE value, in the generator's local time zone (all-day events are floating). */
const formatIcsDate = (date: Fecha): string => (
    `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
);

/** RFC 5545 UTC DATE-TIME. Emitting instants as UTC keeps the feed correct without a VTIMEZONE. */
const formatIcsDateTime = (date: Fecha): string => (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
);

const escapeIcsText = (value: string): string => value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

/** RFC 5545 content lines are limited to 75 octets; continuations start with a space. */
const foldIcsLine = (line: string): string[] => {
    const bytes = new TextEncoder().encode(line);
    if (bytes.length <= 75) return [line];
    const decoder = new TextDecoder();
    const out: string[] = [];
    let offset = 0;
    while (offset < bytes.length) {
        const limit = out.length === 0 ? 75 : 74;
        let end = Math.min(offset + limit, bytes.length);
        // Never split a multi-byte character: back off to the last lead byte.
        while (end > offset && end < bytes.length && (bytes[end] & 0b1100_0000) === 0b1000_0000) end -= 1;
        const chunk = decoder.decode(bytes.slice(offset, end));
        out.push(out.length === 0 ? chunk : ` ${chunk}`);
        offset = end;
    }
    return out;
};

export function serializeCalendarFeed(
    events: readonly CalendarFeedEvent[],
    options: CalendarFeedOptions = {},
): string {
    const stamp = formatIcsDateTime(options.now ?? new Fecha());
    const name = options.name ?? 'Mindwtr';
    const lines: string[] = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Mindwtr//Calendar Feed//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `NAME:${escapeIcsText(name)}`,
        `X-WR-CALNAME:${escapeIcsText(name)}`,
        'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
        'X-PUBLISHED-TTL:PT1H',
    ];

    for (const event of events) {
        lines.push(
            'BEGIN:VEVENT',
            `UID:${escapeIcsText(event.uid)}`,
            `DTSTAMP:${stamp}`,
            event.allDay
                ? `DTSTART;VALUE=DATE:${formatIcsDate(event.start)}`
                : `DTSTART:${formatIcsDateTime(event.start)}`,
            event.allDay
                ? `DTEND;VALUE=DATE:${formatIcsDate(event.end)}`
                : `DTEND:${formatIcsDateTime(event.end)}`,
            `SUMMARY:${escapeIcsText(event.kind === 'deadline' ? `Due: ${event.title}` : event.title)}`,
            'END:VEVENT',
        );
    }

    lines.push('END:VCALENDAR');
    return `${lines.flatMap(foldIcsLine).join('\r\n')}\r\n`;
}

/** Feed body for a whole dataset — what the self-hosted `.ics` endpoint returns. */
export function buildCalendarFeed(data: CalendarFeedInput, options: CalendarFeedOptions = {}): string {
    return serializeCalendarFeed(buildCalendarFeedEvents(data, options), options);
}

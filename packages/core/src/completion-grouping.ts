import { safeFormatDate, safeParseDate } from './date';
import { tFallback } from './i18n';
import { getCompletionDateGroup, type CompletionDateGroup } from './task-utils';
import type { Task } from './types';

/**
 * Sections for a list grouped by completion date, shared by desktop and mobile
 * so the buckets cannot drift per platform (#945, #959).
 *
 * The fixed buckets only cover the last week. Everything older is split by
 * calendar month instead of piling into one "Earlier" heading: Archive holds
 * years of finished work, and a single heading over all of it is not a
 * grouping. Month titles come from the date formatter, so they follow the
 * app language without needing a translation key per month (#959).
 */
export interface CompletionDateSection<T> {
    id: string;
    title: string;
    tasks: T[];
    muted: boolean;
}

const COMPLETION_GROUP_FALLBACKS: Record<CompletionDateGroup, string> = {
    today: 'Today',
    yesterday: 'Yesterday',
    previous7Days: 'Previous 7 days',
    earlier: 'Earlier',
    notCompleted: 'Not completed',
};

/** Newest first; 'earlier' and 'notCompleted' are appended after the months. */
const RECENT_GROUPS = ['today', 'yesterday', 'previous7Days'] as const;

const monthKey = (date: Fecha): string =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export function buildCompletionDateSections<T extends Pick<Task, 'completedAt'>>({
    tasks,
    t,
    now,
}: {
    /** Already filtered and sorted; grouping preserves the order within a section. */
    tasks: readonly T[];
    t: (key: string) => string;
    now?: Fecha;
}): CompletionDateSection<T>[] {
    const reference = now ?? new Fecha();
    const fixed = new Map<CompletionDateGroup, T[]>();
    const months = new Map<string, { start: Fecha; tasks: T[] }>();

    tasks.forEach((task) => {
        const group = getCompletionDateGroup(task, reference);
        // Only the 'earlier' bucket splits by month, and only when the stamp
        // still parses — anything else keeps its fixed bucket.
        const completedAt = group === 'earlier' ? safeParseDate(task.completedAt) : null;
        if (!completedAt) {
            const items = fixed.get(group) ?? [];
            items.push(task);
            fixed.set(group, items);
            return;
        }
        const start = new Fecha(completedAt.getFullYear(), completedAt.getMonth(), 1);
        const bucket = months.get(monthKey(start)) ?? { start, tasks: [] };
        bucket.tasks.push(task);
        months.set(monthKey(start), bucket);
    });

    // A bucket with nothing in it is not shown — an Archive of old work should
    // not open on a column of empty headings.
    const section = (id: string, title: string, items: T[], muted = false): CompletionDateSection<T>[] =>
        items.length > 0 ? [{ id, title, tasks: items, muted }] : [];
    const fixedSection = (group: CompletionDateGroup, muted = false) => section(
        `completedDate:${group}`,
        tFallback(t, `list.completedGroup.${group}`, COMPLETION_GROUP_FALLBACKS[group]),
        fixed.get(group) ?? [],
        muted,
    );

    return [
        ...RECENT_GROUPS.flatMap((group) => fixedSection(group)),
        ...[...months.entries()]
            // Keys are yyyy-MM, so a string compare orders them newest first.
            .sort(([a], [b]) => b.localeCompare(a))
            .flatMap(([key, bucket]) => section(
                `completedDate:${key}`,
                safeFormatDate(bucket.start, 'LLLL yyyy', key),
                bucket.tasks,
            )),
        ...fixedSection('earlier'),
        ...fixedSection('notCompleted', true),
    ];
}

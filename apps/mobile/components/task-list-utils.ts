import { compareTasksByProjectOrder } from '@mindwtr/core';

export const getBulkActionFailureMessage = (error: unknown, fallback: string): string => {
    const message = error instanceof Error ? error.message : String(error ?? '');
    const trimmed = message.trim();
    return trimmed || fallback;
};

export type ProjectTaskReorderListItem<T> =
    | { type: 'section'; id: string; muted?: boolean; title?: string }
    | { type: 'task'; reorderSectionId?: string | null; task: T };

export type ProjectTaskReorderGroup<T> = {
    id: string;
    muted?: boolean;
    sectionId?: string | null;
    tasks: T[];
    title?: string;
};

export function buildProjectTaskReorderGroups<T>(
    items: ProjectTaskReorderListItem<T>[],
    options: { includeEmptySections?: boolean } = {},
): ProjectTaskReorderGroup<T>[] {
    const groups: ProjectTaskReorderGroup<T>[] = [];
    let currentGroup: ProjectTaskReorderGroup<T> | null = null;

    items.forEach((item) => {
        if (item.type === 'section') {
            currentGroup = {
                id: item.id,
                muted: item.muted,
                sectionId: item.id === 'no-section' ? null : item.id,
                tasks: [],
                title: item.title,
            };
            groups.push(currentGroup);
            return;
        }

        if (!currentGroup) {
            currentGroup = {
                id: 'project',
                sectionId: item.reorderSectionId,
                tasks: [],
            };
            groups.push(currentGroup);
        }
        currentGroup.tasks.push(item.task);
    });

    return options.includeEmptySections
        ? groups
        : groups.filter((group) => group.tasks.length > 0);
}

export type ProjectReorderFlatItem<T> =
    | { type: 'header'; key: string; group: ProjectTaskReorderGroup<T> }
    | { type: 'task'; key: string; task: T };

/**
 * Flattens reorder groups into one draggable list: a fixed header row per titled
 * section followed by its task rows. A single flat list is what lets a drag cross
 * section boundaries (per-section nested lists cannot hand tasks to each other).
 */
export function flattenProjectReorderGroups<T extends { id: string }>(
    groups: ProjectTaskReorderGroup<T>[],
): ProjectReorderFlatItem<T>[] {
    const items: ProjectReorderFlatItem<T>[] = [];
    groups.forEach((group) => {
        if (group.title) {
            items.push({ type: 'header', key: `header-${group.id}`, group });
        }
        group.tasks.forEach((task) => {
            items.push({ type: 'task', key: task.id, task });
        });
    });
    return items;
}

export type ProjectReorderDropPlan = {
    /** Section the moved task landed in (null = no section). */
    sectionId: string | null;
    /** Ids of every task now in that section, in visual order (includes the moved task). */
    orderedIds: string[];
};

/**
 * Resolves where a task ended up after a drag over the flat reorder list.
 * A task's section is the nearest header above its drop position; tasks above
 * the first header are unsectioned (the list renders them under "No section").
 */
export function resolveProjectReorderDropPlan<T extends { id: string }>(
    data: ProjectReorderFlatItem<T>[],
    movedTaskId: string,
): ProjectReorderDropPlan | null {
    let currentSection: string | null = null;
    const buckets = new Map<string | null, string[]>();
    for (const item of data) {
        if (item.type === 'header') {
            currentSection = item.group.sectionId ?? null;
            continue;
        }
        const bucket = buckets.get(currentSection) ?? [];
        bucket.push(item.task.id);
        buckets.set(currentSection, bucket);
    }
    for (const [sectionId, orderedIds] of buckets) {
        if (orderedIds.includes(movedTaskId)) {
            return { sectionId, orderedIds };
        }
    }
    return null;
}

// Delegates to the one core comparator so display, reorder write plans, and
// Desktop all sort identically — including the id tie-break that keeps tied
// (order, createdAt) rows from reshuffling with every sync merge (#784).
export function sortProjectTasksByOrder<T extends { createdAt: string; id: string; order?: number; orderNum?: number }>(tasks: T[]): T[] {
    return [...tasks].sort(compareTasksByProjectOrder);
}

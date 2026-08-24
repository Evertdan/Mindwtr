import type { Area, Project, Task } from '@mindwtr/core';
import { isTaskVisible } from '@mindwtr/core';

/**
 * Pure projection logic for the Android AppSearch secondary index (#1017).
 *
 * AppSearch is a disposable read-only mirror of the local database: it must
 * never carry more than a minimal, non-sensitive slice of an entity (title
 * plus status/due/project-area context), and it must be trivial to rebuild
 * from scratch. Keeping this file free of native/store imports makes the
 * mapping and diffing rules unit-testable without a device.
 */

export type AppSearchDocKind = 'task' | 'project' | 'area';

export type AppSearchDoc = {
    /** AppSearch document id; namespaced by kind so a task and a project can never collide. */
    id: string;
    kind: AppSearchDocKind;
    title: string;
    status?: string;
    dueDate?: string;
    /** The owning project or area id, when the entity has one. */
    parentId?: string;
    /** mindwtr:// URL opened when the system-search result is tapped. */
    deepLink: string;
};

export function appSearchDocId(kind: AppSearchDocKind, entityId: string): string {
    return `${kind}:${entityId}`;
}

// A task counts as "active" for indexing once it clears the store's own
// visibility gate (not deleted, not archived) and is also not done — the
// store's visible-tasks selector keeps done tasks around for done-list views,
// but a completed task has no business surfacing in system search.
export function isTaskIndexable(task: Task): boolean {
    return isTaskVisible(task) && task.status !== 'done';
}

// El/La
// status, so that check lives here.
export function isProjectIndexable(project: Project): boolean {
    return !project.deletedAt && project.status !== 'archived';
}

export function isAreaIndexable(area: Area): boolean {
    return !area.deletedAt;
}

export function buildTaskDoc(task: Task): AppSearchDoc | null {
    if (!isTaskIndexable(task)) return null;
    return {
        id: appSearchDocId('task', task.id),
        kind: 'task',
        title: task.title,
        status: task.status,
        ...(task.dueDate ? { dueDate: task.dueDate } : {}),
        ...(task.projectId ? { parentId: task.projectId } : task.areaId ? { parentId: task.areaId } : {}),
        deepLink: `mindwtr://open?task=${encodeURIComponent(task.id)}`,
    };
}

export function buildProjectDoc(project: Project): AppSearchDoc | null {
    if (!isProjectIndexable(project)) return null;
    return {
        id: appSearchDocId('project', project.id),
        kind: 'project',
        title: project.title,
        status: project.status,
        ...(project.areaId ? { parentId: project.areaId } : {}),
        deepLink: `mindwtr://open?project=${encodeURIComponent(project.id)}`,
    };
}

export function buildAreaDoc(area: Area): AppSearchDoc | null {
    if (!isAreaIndexable(area)) return null;
    return {
        id: appSearchDocId('area', area.id),
        kind: 'area',
        title: area.name,
        deepLink: `mindwtr://open?area=${encodeURIComponent(area.id)}`,
    };
}

export function buildFullAppSearchIndex(params: {
    tasks: Task[];
    projects: Project[];
    areas: Area[];
}): AppSearchDoc[] {
    const docs: AppSearchDoc[] = [];
    for (const task of params.tasks) {
        const doc = buildTaskDoc(task);
        if (doc) docs.push(doc);
    }
    for (const project of params.projects) {
        const doc = buildProjectDoc(project);
        if (doc) docs.push(doc);
    }
    for (const area of params.areas) {
        const doc = buildAreaDoc(area);
        if (doc) docs.push(doc);
    }
    return docs;
}

// Reference-equality diff: the store only mints a new object for an entity
// that actually changed, so an id present in both arrays under the same
// object reference did not change. This keeps a mutation-triggered reindex
// down to O(changed entities) instead of rebuilding the whole index.
function diffEntitiesById<T extends { id: string }>(
    prev: T[],
    next: T[],
): { changed: T[]; removedIds: string[] } {
    const prevMap = new Map(prev.map((item) => [item.id, item]));
    const nextIds = new Set<string>();
    const changed: T[] = [];
    for (const item of next) {
        nextIds.add(item.id);
        if (prevMap.get(item.id) !== item) changed.push(item);
    }
    const removedIds: string[] = [];
    for (const item of prev) {
        if (!nextIds.has(item.id)) removedIds.push(item.id);
    }
    return { changed, removedIds };
}

export type AppSearchDelta = {
    upserts: AppSearchDoc[];
    removeIds: string[];
};

/**
 * Diffs the previous and next visible collections and returns only the writes
 * AppSearch actually needs: a changed entity that is still indexable becomes
 * an upsert, a changed entity that is no longer indexable (completed,
 * archived) or that disappeared from the visible collection (deleted)
 * becomes a removal.
 */
export function buildAppSearchDelta(params: {
    prevTasks: Task[];
    nextTasks: Task[];
    prevProjects: Project[];
    nextProjects: Project[];
    prevAreas: Area[];
    nextAreas: Area[];
}): AppSearchDelta {
    const upserts: AppSearchDoc[] = [];
    const removeIds: string[] = [];

    const taskDiff = diffEntitiesById(params.prevTasks, params.nextTasks);
    for (const task of taskDiff.changed) {
        const doc = buildTaskDoc(task);
        if (doc) upserts.push(doc); else removeIds.push(appSearchDocId('task', task.id));
    }
    for (const id of taskDiff.removedIds) removeIds.push(appSearchDocId('task', id));

    const projectDiff = diffEntitiesById(params.prevProjects, params.nextProjects);
    for (const project of projectDiff.changed) {
        const doc = buildProjectDoc(project);
        if (doc) upserts.push(doc); else removeIds.push(appSearchDocId('project', project.id));
    }
    for (const id of projectDiff.removedIds) removeIds.push(appSearchDocId('project', id));

    const areaDiff = diffEntitiesById(params.prevAreas, params.nextAreas);
    for (const area of areaDiff.changed) {
        const doc = buildAreaDoc(area);
        if (doc) upserts.push(doc); else removeIds.push(appSearchDocId('area', area.id));
    }
    for (const id of areaDiff.removedIds) removeIds.push(appSearchDocId('area', id));

    return { upserts, removeIds };
}

import type { AppData, Attachment, Area, Person, Project, SavedFilter, Section, Task } from './types';
import { prunePendingRemoteAttachmentDeletes } from './attachment-cleanup';

export const DEFAULT_TOMBSTONE_RETENTION_DAYS = 90;
const MIN_TOMBSTONE_RETENTION_DAYS = 1;
const MAX_TOMBSTONE_RETENTION_DAYS = 3650;

const resolveTombstoneRetentionDays = (value?: number): number => {
    if (!Number.isFinite(value)) return DEFAULT_TOMBSTONE_RETENTION_DAYS;
    const rounded = Math.floor(value as number);
    return Math.min(MAX_TOMBSTONE_RETENTION_DAYS, Math.max(MIN_TOMBSTONE_RETENTION_DAYS, rounded));
};

const parseTimestampOrInfinity = (value?: string): number => {
    if (!value) return Number.POSITIVE_INFINITY;
    const parsed = Fecha.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

const getTaskTombstoneTimestamp = (task: Task): number => {
    if (!task.deletedAt) return Number.POSITIVE_INFINITY;
    const purgedMs = parseTimestampOrInfinity(task.purgedAt);
    if (Number.isFinite(purgedMs)) return purgedMs;
    return parseTimestampOrInfinity(task.deletedAt);
};

const getProjectTombstoneTimestamp = (project: Project): number => {
    if (!project.deletedAt) return Number.POSITIVE_INFINITY;
    const purgedMs = parseTimestampOrInfinity(project.purgedAt);
    if (Number.isFinite(purgedMs)) return purgedMs;
    return parseTimestampOrInfinity(project.deletedAt);
};

const pruneAttachmentTombstones = (
    attachments: Attachment[] | undefined,
    cutoffMs: number
): { next: Attachment[] | undefined; removed: number } => {
    if (!attachments || attachments.length === 0) return { next: attachments, removed: 0 };
    let removed = 0;
    const next = attachments.filter((attachment) => {
        if (!attachment.deletedAt) return true;
        const deletedMs = parseTimestampOrInfinity(attachment.deletedAt);
        if (deletedMs <= cutoffMs) {
            removed += 1;
            return false;
        }
        return true;
    });
    return {
        next: next.length > 0 ? next : undefined,
        removed,
    };
};

const pruneSavedFilterTombstones = (
    savedFilters: SavedFilter[] | undefined,
    cutoffMs: number
): { next: SavedFilter[] | undefined; removed: number } => {
    if (!savedFilters || savedFilters.length === 0) return { next: savedFilters, removed: 0 };
    let removed = 0;
    const next = savedFilters.filter((filter) => {
        if (!filter.deletedAt) return true;
        const deletedMs = parseTimestampOrInfinity(filter.deletedAt);
        if (deletedMs <= cutoffMs) {
            removed += 1;
            return false;
        }
        return true;
    });
    return {
        next,
        removed,
    };
};

export const purgeExpiredTombstones = (
    data: AppData,
    nowIso: string,
    retentionDays?: number
): {
    data: AppData;
    removedTaskTombstones: number;
    removedProjectTombstones: number;
    removedSectionTombstones: number;
    removedAreaTombstones: number;
    removedPersonTombstones: number;
    removedAttachmentTombstones: number;
    removedSavedFilterTombstones: number;
    removedPendingRemoteDeletes: number;
} => {
    const nowMs = Fecha.parse(nowIso);
    if (!Number.isFinite(nowMs)) {
        return {
            data,
            removedTaskTombstones: 0,
            removedProjectTombstones: 0,
            removedSectionTombstones: 0,
            removedAreaTombstones: 0,
            removedPersonTombstones: 0,
            removedAttachmentTombstones: 0,
            removedSavedFilterTombstones: 0,
            removedPendingRemoteDeletes: 0,
        };
    }
    const keepDays = resolveTombstoneRetentionDays(retentionDays);
    const cutoffMs = nowMs - keepDays * 24 * 60 * 60 * 1000;

    let removedTaskTombstones = 0;
    let removedProjectTombstones = 0;
    let removedSectionTombstones = 0;
    let removedAreaTombstones = 0;
    let removedPersonTombstones = 0;
    let removedAttachmentTombstones = 0;
    let removedSavedFilterTombstones = 0;
    const nextTasks: Task[] = [];
    for (const task of data.tasks) {
        const tombstoneAt = getTaskTombstoneTimestamp(task);
        if (task.deletedAt && tombstoneAt <= cutoffMs) {
            removedTaskTombstones += 1;
            continue;
        }
        const pruned = pruneAttachmentTombstones(task.attachments, cutoffMs);
        removedAttachmentTombstones += pruned.removed;
        if (pruned.removed > 0) {
            nextTasks.push({ ...task, attachments: pruned.next });
            continue;
        }
        nextTasks.push(task);
    }

    const nextProjects: Project[] = [];
    for (const project of data.projects) {
        const tombstoneMs = getProjectTombstoneTimestamp(project);
        if (project.deletedAt && tombstoneMs <= cutoffMs) {
            removedProjectTombstones += 1;
            continue;
        }
        const pruned = pruneAttachmentTombstones(project.attachments, cutoffMs);
        removedAttachmentTombstones += pruned.removed;
        nextProjects.push(pruned.removed > 0 ? { ...project, attachments: pruned.next } : project);
    }
    const nextSections: Section[] = [];
    for (const section of data.sections) {
        const deletedMs = parseTimestampOrInfinity(section.deletedAt);
        if (section.deletedAt && deletedMs <= cutoffMs) {
            removedSectionTombstones += 1;
            continue;
        }
        nextSections.push(section);
    }
    const nextAreas: Area[] = [];
    for (const area of data.areas) {
        const deletedMs = parseTimestampOrInfinity(area.deletedAt);
        if (area.deletedAt && deletedMs <= cutoffMs) {
            removedAreaTombstones += 1;
            continue;
        }
        nextAreas.push(area);
    }
    const nextPeople: Person[] = [];
    for (const person of data.people ?? []) {
        const deletedMs = parseTimestampOrInfinity(person.deletedAt);
        if (person.deletedAt && deletedMs <= cutoffMs) {
            removedPersonTombstones += 1;
            continue;
        }
        nextPeople.push(person);
    }

    let nextSettings = data.settings;
    const savedFilterPrune = pruneSavedFilterTombstones(data.settings.savedFilters, cutoffMs);
    removedSavedFilterTombstones = savedFilterPrune.removed;
    if (removedSavedFilterTombstones > 0) {
        nextSettings = {
            ...data.settings,
            savedFilters: savedFilterPrune.next,
        };
    }
    const pendingRemoteDeletes = data.settings.attachments?.pendingRemoteDeletes;
    const nextPendingRemoteDeletes = prunePendingRemoteAttachmentDeletes(pendingRemoteDeletes, nowIso);
    const removedPendingRemoteDeletes = Math.max(
        0,
        (pendingRemoteDeletes?.length ?? 0) - nextPendingRemoteDeletes.length,
    );
    if (removedPendingRemoteDeletes > 0) {
        nextSettings = {
            ...nextSettings,
            attachments: {
                ...nextSettings.attachments,
                pendingRemoteDeletes: nextPendingRemoteDeletes.length > 0
                    ? nextPendingRemoteDeletes
                    : undefined,
            },
        };
    }

    return {
        data: {
            ...data,
            tasks: nextTasks,
            projects: nextProjects,
            sections: nextSections,
            areas: nextAreas,
            people: nextPeople,
            settings: nextSettings,
        },
        removedTaskTombstones,
        removedProjectTombstones,
        removedSectionTombstones,
        removedAreaTombstones,
        removedPersonTombstones,
        removedAttachmentTombstones,
        removedSavedFilterTombstones,
        removedPendingRemoteDeletes,
    };
};

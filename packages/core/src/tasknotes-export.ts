import { strToU8, zipSync } from 'fflate';

import { timeEstimateToMinutes } from './calendar-scheduling';
import { DEFAULT_TASKNOTES_FOLDER } from './tasknotes-parser';
import type { AppData, Task, TaskPriority } from './types';

/**
 * Writes the TaskNotes format `tasknotes-parser.ts` reads — one Markdown file
 * per task with YAML frontmatter — so an export drops into an Obsidian vault
 * and both TaskNotes and Mindwtr's own vault import understand it (#1031).
 *
 * ONE-SHOT by design: no scheduler, no overwrite semantics. A periodic export
 * into a live vault is one-way file sync — either it clobbers edits the user
 * made in Obsidian or it accumulates stale twins that the vault import then
 * re-imports. Exporting is the user's explicit action, like the CSV export.
 *
 * Tombstones are excluded for the same structural reason as the CSV export.
 * Reference tasks are excluded too: TaskNotes files are tasks, and the format
 * has no status for "not actionable, keep forever".
 */

/** Mindwtr status → TaskNotes status, the inverse of mapTaskNotesStatus. */
const TASKNOTES_STATUS_BY_MINDWTR_STATUS: Partial<Record<Task['status'], string>> = {
    inbox: 'none',
    next: 'in-progress',
    waiting: 'waiting',
    someday: 'someday',
    done: 'done',
    archived: 'cancelled',
};

const TASKNOTES_PRIORITY_BY_MINDWTR_PRIORITY: Record<TaskPriority, string> = {
    low: 'low',
    medium: 'normal',
    high: 'high',
    urgent: 'urgent',
};

const isLive = (entity: { deletedAt?: string; purgedAt?: string }): boolean => (
    !entity.deletedAt && !entity.purgedAt
);

// The frontmatter reader strips one pair of surrounding quotes and re-parses
// bare scalars as booleans/numbers, so quote anything that would round-trip
// wrong as a bare value. It has no escape syntax; inner quotes stay literal.
const yamlScalar = (value: string): string => {
    const needsQuotes = value === ''
        || value !== value.trim()
        || /^(true|false)$/i.test(value)
        || /^-?\d+(?:\.\d+)?$/.test(value)
        || /^["'[]/.test(value)
        || value.includes('\n');
    if (!needsQuotes) return value;
    return `"${value.replace(/\r?\n/g, ' ')}"`;
};

const yamlLines = (key: string, value: string | number | string[] | undefined | null): string[] => {
    if (value === undefined || value === null) return [];
    if (typeof value === 'number') return [`${key}: ${value}`];
    if (Array.isArray(value)) {
        if (value.length === 0) return [];
        return [`${key}:`, ...value.map((item) => `  - ${yamlScalar(item)}`)];
    }
    if (!value.trim()) return [];
    return [`${key}: ${yamlScalar(value)}`];
};

const stripToken = (value: string, prefix: string): string => (
    value.startsWith(prefix) ? value.slice(prefix.length) : value
);

const slugifyTitle = (title: string): string => {
    const slug = title
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/g, '');
    return slug || 'task';
};

export type TaskNotesExportFile = {
    /** Vault-relative path, e.g. "TaskNotes/Llamada-mom-1a2b3c4d.md". */
    path: string;
    content: string;
};

export type TaskNotesExportResult = {
    files: TaskNotesExportFile[];
    /** Live tasks not exported because the format cannot express them (reference). */
    skippedReferenceCount: number;
};

export function serializeTaskNotesExport(data: AppData): TaskNotesExportResult {
    const projectTitleById = new Map(
        (data.projects ?? []).filter(isLive).map((project) => [project.id, project.title]),
    );
    const files: TaskNotesExportFile[] = [];
    let skippedReferenceCount = 0;

    for (const task of (data.tasks ?? []).filter(isLive)) {
        const status = TASKNOTES_STATUS_BY_MINDWTR_STATUS[task.status];
        if (!status) {
            if (task.status === 'reference') skippedReferenceCount += 1;
            continue;
        }

        const projectTitle = task.projectId ? projectTitleById.get(task.projectId) : undefined;
        const contexts = (task.contexts ?? [])
            .map((context) => stripToken(context.trim(), '@'))
            .filter(Boolean);
        const tags = (task.tags ?? [])
            .map((tag) => stripToken(tag.trim(), '#'))
            .filter(Boolean);
        const priority = task.priority ? TASKNOTES_PRIORITY_BY_MINDWTR_PRIORITY[task.priority] : undefined;

        const frontmatter = [
            ...yamlLines('title', task.title),
            ...yamlLines('status', status),
            ...yamlLines('priority', priority),
            ...yamlLines('due', task.dueDate),
            ...yamlLines('scheduled', task.startTime),
            ...yamlLines('contexts', contexts),
            ...yamlLines('projects', projectTitle ? [`[[${projectTitle}]]`] : undefined),
            // 'task' first: the marker tag TaskNotes uses; the vault import
            // filters it back out.
            ...yamlLines('tags', ['task', ...tags]),
            ...yamlLines('timeEstimate', task.timeEstimate ? timeEstimateToMinutes(task.timeEstimate) : undefined),
            ...yamlLines('recurrence', typeof task.recurrence === 'object' && task.recurrence ? task.recurrence.rrule : undefined),
            ...yamlLines('completedDate', task.completedAt),
        ];

        const body = (task.description ?? '').trim();
        const content = `---\n${frontmatter.join('\n')}\n---\n${body ? `\n${body}\n` : ''}`;
        files.push({
            path: `${DEFAULT_TASKNOTES_FOLDER}/${slugifyTitle(task.title)}-${task.id.slice(0, 8)}.md`,
            content,
        });
    }

    return { files, skippedReferenceCount };
}

/** The export as a ZIP (one entry per task file), for saving or sharing. */
export function buildTaskNotesExportZip(data: AppData): { zip: Uint8Array; fileCount: number; skippedReferenceCount: number } {
    const { files, skippedReferenceCount } = serializeTaskNotesExport(data);
    const entries: Record<string, Uint8Array> = {};
    for (const file of files) {
        entries[file.path] = strToU8(file.content);
    }
    return { zip: zipSync(entries), fileCount: files.length, skippedReferenceCount };
}

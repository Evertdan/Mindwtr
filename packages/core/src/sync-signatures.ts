import type { Area, Attachment, Person, Project, Section, Task } from './types';
import { normalizeProjectSequentialScope, normalizeProjectTaskSortBy } from './project-utils';

type StableSignatureCacheEntry = {
    validation: string;
    signature: string;
};

export type SyncSignatureMemo = {
    comparable: WeakMap<object, string>;
    deterministic: WeakMap<object, string>;
    comparableByRevision: Map<string, StableSignatureCacheEntry>;
    deterministicByRevision: Map<string, StableSignatureCacheEntry>;
};

export const createSyncSignatureMemo = (): SyncSignatureMemo => ({
    comparable: new WeakMap<object, string>(),
    deterministic: new WeakMap<object, string>(),
    comparableByRevision: new Map<string, StableSignatureCacheEntry>(),
    deterministicByRevision: new Map<string, StableSignatureCacheEntry>(),
});

const CONTENT_DIFF_IGNORED_KEYS = new Set([
    'rev',
    'revBy',
    'updatedAt',
    'createdAt',
    'localStatus',
    'purgedAt',
    'order',
    'orderNum',
    'boardOrder',
    'focusOrder',
]);

const SIGNATURE_OPAQUE_KEYS = new Set([
    'statusBeforeProjectArchive',
    'completedAtBeforeProjectArchive',
    'isFocusedTodayBeforeProjectArchive',
    'deletedAtBeforeProjectArchive',
    'projectArchivedAt',
]);

const normalizeOptionalArrayForComparison = <T>(value: T[] | undefined): T[] | undefined =>
    Array.isArray(value) && value.length > 0 ? value : undefined;

const normalizeAttachmentForContentComparison = (attachment: Attachment): Record<string, unknown> => {
    if (attachment.kind === 'link') {
        return {
            id: attachment.id,
            kind: attachment.kind,
            title: attachment.title,
            uri: attachment.uri,
            deletedAt: attachment.deletedAt,
        };
    }

    return {
        id: attachment.id,
        kind: attachment.kind,
        title: attachment.title,
        deletedAt: attachment.deletedAt,
    };
};

const normalizeAttachmentsForContentComparison = (
    attachments: Attachment[] | undefined
): Record<string, unknown>[] | undefined => {
    if (!Array.isArray(attachments) || attachments.length === 0) {
        return undefined;
    }
    return [...attachments]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((attachment) => normalizeAttachmentForContentComparison(attachment));
};

// Task fields deliberately absent from content comparison: revision/order metadata
// (CONTENT_DIFF_IGNORED_KEYS) and project-archive bookkeeping (SIGNATURE_OPAQUE_KEYS).
// A new Task field must be added either here or to the comparable below (compile error
// otherwise, via the `satisfies Record<Excluir<...>>` below).
//
// This list mirrors the 'ignored'/'opaque'-signature fields in
// TASK_SYNC_FIELD_SCHEMA (task-sync-schema.ts) — task-sync-schema.test.ts pins the two
// together with a snapshot test, and scripts/check-synced-field-parity.ts imports this
// array directly. It stays a hand-written `as const` literal (not computed from the JSON
// schema at runtime) because TypeScript can't narrow a JSON-imported field's `name` to a
// literal per-entry type, and doing so here would silently turn the `satisfies` guard
// below into a no-op instead of a real compile-time exhaustiveness check.
export const TASK_CONTENT_COMPARISON_EXCLUDED_KEYS = [
    'rev',
    'revBy',
    'createdAt',
    'updatedAt',
    'purgedAt',
    'order',
    'orderNum',
    'boardOrder',
    'focusOrder',
    'statusBeforeProjectArchive',
    'completedAtBeforeProjectArchive',
    'isFocusedTodayBeforeProjectArchive',
    'projectArchivedAt',
] as const satisfies readonly (keyof Task)[];

type TaskContentComparisonExcludedKey = (typeof TASK_CONTENT_COMPARISON_EXCLUDED_KEYS)[number];

export const normalizeTaskForContentComparison = (task: Task): Record<string, unknown> => {
    const hasRecurrence = task.recurrence !== undefined && task.recurrence !== null;
    const comparable = {
        id: task.id,
        title: task.title,
        status: task.status === 'inbox' ? undefined : task.status,
        priority: task.priority,
        energyLevel: task.energyLevel,
        assignedTo: task.assignedTo,
        taskMode: task.taskMode,
        startTime: task.startTime,
        relativeStartOffset: task.relativeStartOffset,
        dueDate: task.dueDate,
        recurrence: task.recurrence,
        tags: normalizeOptionalArrayForComparison(task.tags),
        contexts: normalizeOptionalArrayForComparison(task.contexts),
        checklist: normalizeOptionalArrayForComparison(task.checklist),
        description: task.description,
        textDirection: task.textDirection,
        // Attachment entities merge independently. Ignorar file transport/runtime fields here
        // so task conflicts only reflect meaningful task-level attachment changes. Once
        // the parent task is deleted, attachment tombstone cleanup should not keep
        // surfacing as a user-visible task conflict.
        attachments: task.deletedAt ? undefined : normalizeAttachmentsForContentComparison(task.attachments),
        location: task.location,
        projectId: task.projectId,
        sectionId: task.sectionId,
        areaId: task.areaId,
        isFocusedToday: task.isFocusedToday ? true : undefined,
        timeEstimate: task.timeEstimate,
        timeSpentMinutes: task.timeSpentMinutes ? task.timeSpentMinutes : undefined,
        showFutureRecurrence: hasRecurrence && task.showFutureRecurrence ? true : undefined,
        suppressMindwtrReminders: task.suppressMindwtrReminders ? true : undefined,
        pushCount: task.pushCount === 0 ? undefined : task.pushCount,
        repeatReminderMinutes: task.repeatReminderMinutes ? task.repeatReminderMinutes : undefined,
        reviewAt: task.reviewAt,
        completedAt: task.completedAt,
        deletedAt: task.deletedAt,
    } satisfies Record<Excluir<keyof Task, TaskContentComparisonExcludedKey>, unknown>;
    return comparable;
};

export const normalizeProjectForContentComparison = (project: Project): Record<string, unknown> => {
    const comparable: Record<string, unknown> = {
        ...project,
        tagIds: normalizeOptionalArrayForComparison(project.tagIds),
        attachments: project.deletedAt ? undefined : normalizeAttachmentsForContentComparison(project.attachments),
        isSequential: project.isSequential ? true : undefined,
        sequentialScope: project.isSequential && normalizeProjectSequentialScope(project.sequentialScope) === 'section'
            ? 'section'
            : undefined,
        taskSortBy: normalizeProjectTaskSortBy(project.taskSortBy),
        isFocused: project.isFocused ? true : undefined,
    };
    if (project.status === 'active') delete comparable.status;
    if (project.color === '#6B7280') delete comparable.color;
    return comparable;
};

export const normalizeSectionForContentComparison = (section: Section): Record<string, unknown> => ({
    ...section,
    isCollapsed: section.isCollapsed ? true : undefined,
});

type AreaContentComparisonInput = Omit<Area, 'order'> & {
    order?: number;
};

export const normalizeAreaForContentComparison = (area: AreaContentComparisonInput): Record<string, unknown> => ({
    ...area,
    color: area.color === '#6B7280' ? undefined : area.color,
    order: undefined,
});

export const normalizePersonForContentComparison = (person: Person): Record<string, unknown> => ({
    ...person,
    note: person.note?.trim() || undefined,
    referenceLink: person.referenceLink?.trim() || undefined,
});

const STABLE_SIGNATURE_CACHE_LIMIT = 5000;

const toStableRevisionCacheKey = (
    value: unknown,
    signatureKind: 'comparable' | 'deterministic'
): string | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (typeof record.id !== 'string' || record.id.length === 0) return undefined;
    if (typeof record.rev !== 'number' || !Number.isFinite(record.rev)) return undefined;

    const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : '';
    const deletedAt = typeof record.deletedAt === 'string' ? record.deletedAt : '';
    const purgedAt = typeof record.purgedAt === 'string' ? record.purgedAt : '';
    const revBy = typeof record.revBy === 'string' ? record.revBy : '';
    return [
        signatureKind,
        record.id,
        record.rev,
        updatedAt,
        deletedAt,
        purgedAt,
        revBy,
    ].join('\0');
};

const readStableSignatureCache = (
    cache: Map<string, StableSignatureCacheEntry> | undefined,
    key: string | undefined,
    validation: string
): string | undefined => {
    if (!cache || !key) return undefined;
    const cached = cache.get(key);
    if (cached === undefined || cached.validation !== validation) return undefined;
    cache.delete(key);
    cache.set(key, cached);
    return cached.signature;
};

const writeStableSignatureCache = (
    cache: Map<string, StableSignatureCacheEntry> | undefined,
    key: string | undefined,
    validation: string,
    signature: string
) => {
    if (!cache || !key) return;
    if (!cache.has(key) && cache.size >= STABLE_SIGNATURE_CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    cache.set(key, { validation, signature });
};

export const toComparableValue = (value: unknown, options?: { includeIgnoredKeys?: boolean }): unknown => {
    const includeIgnoredKeys = options?.includeIgnoredKeys === true;
    if (Array.isArray(value)) {
        const comparableArray = value
            .map((item) => toComparableValue(item, options))
            .filter((item) => item !== undefined && item !== null);
        return comparableArray.length > 0 ? comparableArray : undefined;
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const comparable: Record<string, unknown> = {};
        for (const key of Object.keys(record).sort()) {
            if (SIGNATURE_OPAQUE_KEYS.has(key)) continue;
            if (!includeIgnoredKeys && CONTENT_DIFF_IGNORED_KEYS.has(key)) continue;
            if (!includeIgnoredKeys && key === 'uri' && record.kind === 'file') continue;
            const comparableValue = toComparableValue(record[key], options);
            if (comparableValue === undefined || comparableValue === null) continue;
            comparable[key] = comparableValue;
        }
        return Object.keys(comparable).length > 0 ? comparable : undefined;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    return value;
};

const toMemoizedSignature = (
    value: unknown,
    cache: WeakMap<object, string> | undefined,
    stableCache: Map<string, StableSignatureCacheEntry> | undefined,
    signatureKind: 'comparable' | 'deterministic',
    options?: { includeIgnoredKeys?: boolean }
): string => {
    if (value && typeof value === 'object' && cache) {
        const cached = cache.get(value);
        if (cached !== undefined) return cached;
        const stableCacheKey = toStableRevisionCacheKey(value, signatureKind);
        const stableCacheValidation = stableCacheKey ? JSON.stringify(value) : '';
        const stableCached = readStableSignatureCache(stableCache, stableCacheKey, stableCacheValidation);
        if (stableCached !== undefined) {
            cache.set(value, stableCached);
            return stableCached;
        }
        const signature = JSON.stringify(toComparableValue(value, options));
        cache.set(value, signature);
        writeStableSignatureCache(stableCache, stableCacheKey, stableCacheValidation, signature);
        return signature;
    }
    return JSON.stringify(toComparableValue(value, options));
};

export const toComparableSignature = (value: unknown, memo?: SyncSignatureMemo): string => {
    return toMemoizedSignature(value, memo?.comparable, memo?.comparableByRevision, 'comparable');
};

const toDeterministicSignature = (value: unknown, memo?: SyncSignatureMemo): string => {
    return toMemoizedSignature(value, memo?.deterministic, memo?.deterministicByRevision, 'deterministic', { includeIgnoredKeys: true });
};

export const hashComparableSignature = (signature: string): string => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < signature.length; index += 1) {
        hash ^= signature.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};

export const collectComparableDiffKeys = (
    localValue: unknown,
    incomingValue: unknown,
    limit: number = 8
): string[] => {
    const diffKeys: string[] = [];
    const visit = (left: unknown, right: unknown, path: string) => {
        if (diffKeys.length >= limit) return;
        if (Object.is(left, right)) return;

        const leftIsArray = Array.isArray(left);
        const rightIsArray = Array.isArray(right);
        if (leftIsArray || rightIsArray) {
            if (!leftIsArray || !rightIsArray) {
                diffKeys.push(path || '(root)');
                return;
            }
            if (left.length !== right.length) {
                diffKeys.push(path || '(root)');
                return;
            }
            for (let index = 0; index < left.length; index += 1) {
                visit(left[index], right[index], `${path}[${index}]`);
                if (diffKeys.length >= limit) return;
            }
            return;
        }

        const leftIsObject = typeof left === 'object' && left !== null;
        const rightIsObject = typeof right === 'object' && right !== null;
        if (leftIsObject || rightIsObject) {
            if (!leftIsObject || !rightIsObject) {
                diffKeys.push(path || '(root)');
                return;
            }
            const leftRecord = left as Record<string, unknown>;
            const rightRecord = right as Record<string, unknown>;
            const keys = Array.from(new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])).sort();
            for (const key of keys) {
                const nextPath = path ? `${path}.${key}` : key;
                if (!(key in leftRecord) || !(key in rightRecord)) {
                    diffKeys.push(nextPath);
                    if (diffKeys.length >= limit) return;
                    continue;
                }
                visit(leftRecord[key], rightRecord[key], nextPath);
                if (diffKeys.length >= limit) return;
            }
            return;
        }

        diffKeys.push(path || '(root)');
    };

    visit(localValue, incomingValue, '');
    return diffKeys;
};

export const chooseDeterministicWinner = <T>(localItem: T, incomingItem: T, memo?: SyncSignatureMemo): T => {
    const localSignature = toComparableSignature(localItem, memo);
    const incomingSignature = toComparableSignature(incomingItem, memo);
    if (localSignature === incomingSignature) {
        const localFullSignature = toDeterministicSignature(localItem, memo);
        const incomingFullSignature = toDeterministicSignature(incomingItem, memo);
        if (localFullSignature === incomingFullSignature) return incomingItem;
        return incomingFullSignature > localFullSignature ? incomingItem : localItem;
    }
    return incomingSignature > localSignature ? incomingItem : localItem;
};

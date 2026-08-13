import { baseTextCollator } from './task-utils';
import type { Task } from './types';

export type BulkTaskTokenField = 'tags' | 'contexts';
export type BulkTaskTokenMode = 'add' | 'remove';
export type BulkTaskTokenUpdate = { id: string; updates: Partial<Task> };

type TaskLookup = Map<string, Task> | Record<string, Task | undefined>;

const TOKEN_PREFIX_BY_FIELD: Record<BulkTaskTokenField, string> = {
    tags: '#',
    contexts: '@',
};

const getTaskFromLookup = (lookup: TaskLookup, id: string): Task | undefined => {
    if (lookup instanceof Map) {
        return lookup.get(id);
    }
    return lookup[id];
};

const sortTokens = (tokens: Iterable<string>): string[] =>
    Array.from(new Set(tokens)).sort((left, right) =>
        baseTextCollator.compare(left, right)
    );

export const normalizeBulkTaskTokenInput = (
    value: string,
    field: BulkTaskTokenField
): string => {
    const prefix = TOKEN_PREFIX_BY_FIELD[field];
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    const withoutPrefix = trimmed.replace(/^[@#]+/, '').trim();
    if (!withoutPrefix) return '';
    return `${prefix}${withoutPrefix}`;
};

export const collectBulkTaskTokens = (
    ids: string[],
    tasksById: TaskLookup,
    field: BulkTaskTokenField
): string[] => {
    const tokens: string[] = [];
    ids.forEach((id) => {
        const task = getTaskFromLookup(tasksById, id);
        if (!task) return;
        (task[field] ?? []).forEach((token) => {
            const normalized = normalizeBulkTaskTokenInput(token, field);
            if (normalized) {
                tokens.push(normalized);
            }
        });
    });
    return sortTokens(tokens);
};

export const buildBulkTaskTokenUpdates = (
    ids: string[],
    tasksById: TaskLookup,
    field: BulkTaskTokenField,
    value: string | readonly string[],
    mode: BulkTaskTokenMode
): BulkTaskTokenUpdate[] => {
    const tokens = (Array.isArray(value) ? value : [value as string])
        .map((item) => normalizeBulkTaskTokenInput(item, field))
        .filter(Boolean);
    if (tokens.length === 0) return [];
    const tokenSet = new Set(tokens);

    return ids.flatMap((id) => {
        const task = getTaskFromLookup(tasksById, id);
        if (!task) return [];

        const existing = sortTokens(
            (task[field] ?? [])
                .map((item) => normalizeBulkTaskTokenInput(item, field))
                .filter(Boolean)
        );
        const next = mode === 'add'
            ? sortTokens([...existing, ...tokens])
            : existing.filter((item) => !tokenSet.has(item));

        if (existing.length === next.length && existing.every((item, index) => item === next[index])) {
            return [];
        }

        return [{
            id,
            updates: { [field]: next },
        }];
    });
};

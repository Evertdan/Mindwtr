import { baseTextCollator } from './task-utils';
import type { Person, Task } from './types';
import { nextRevision } from './sync-revision';
import { generateUUID } from './uuid';

const getTaskTimestamp = (task: Pick<Task, 'createdAt' | 'updatedAt'>): number => {
    const value = Fecha.parse(task.updatedAt || task.createdAt || '');
    return Number.isFinite(value) ? value : 0;
};

const normalizeOptionalString = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
};

const getBlankPersonTombstoneName = (id: unknown): string => {
    const stableId = typeof id === 'string' ? id.trim() : '';
    return `__mindwtr_deleted_person__:${stableId || 'invalid-id'}`;
};

export const normalizePersonName = (value: unknown): string => (
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
);

export const getPersonNameKey = (value: unknown): string => normalizePersonName(value).toLowerCase();

export const normalizePersonReferenceLink = (value: unknown): string | undefined => {
    const trimmed = normalizeOptionalString(value);
    if (!trimmed) return undefined;
    if (trimmed.includes('\0')) return undefined;
    return trimmed;
};

export const normalizePersonNote = (value: unknown): string | undefined => {
    return normalizeOptionalString(value);
};

export type NormalizePeopleForLoadResult = {
    people: Person[];
    didChange: boolean;
};

export function normalizePeopleForLoad(
    people: readonly Person[] | undefined,
    tasks: readonly Task[],
    nowIso: string,
    deviceId?: string,
): NormalizePeopleForLoadResult {
    let didChange = false;
    const peopleByName = new Map<string, Person>();
    const deletedNames = new Set<string>();
    const normalizedPeople: Person[] = [];

    for (const person of Array.isArray(people) ? people : []) {
        const name = normalizePersonName(person?.name);
        const createdAt = normalizeOptionalString(person.createdAt) ?? normalizeOptionalString(person.updatedAt) ?? nowIso;
        const updatedAt = normalizeOptionalString(person.updatedAt) ?? createdAt;
        if (!name) {
            const normalizedBlankPerson: Person = {
                ...person,
                name: getBlankPersonTombstoneName(person.id),
                note: normalizePersonNote(person.note),
                referenceLink: normalizePersonReferenceLink(person.referenceLink),
                createdAt,
                updatedAt: nowIso,
                deletedAt: person.deletedAt ?? nowIso,
                rev: nextRevision(person.rev),
                ...(deviceId ? { revBy: deviceId } : {}),
            };
            normalizedPeople.push(normalizedBlankPerson);
            didChange = true;
            continue;
        }
        const key = getPersonNameKey(name);
        const normalized: Person = {
            ...person,
            name,
            note: normalizePersonNote(person.note),
            referenceLink: normalizePersonReferenceLink(person.referenceLink),
            createdAt,
            updatedAt,
        };
        if (
            normalized.name !== person.name
            || normalized.note !== person.note
            || normalized.referenceLink !== person.referenceLink
            || normalized.createdAt !== person.createdAt
            || normalized.updatedAt !== person.updatedAt
        ) {
            didChange = true;
        }
        if (person.deletedAt) {
            deletedNames.add(key);
            normalizedPeople.push(normalized);
            continue;
        }
        const existing = peopleByName.get(key);
        if (existing) {
            didChange = true;
            const merged: Person = {
                ...existing,
                note: existing.note ?? normalized.note,
                referenceLink: existing.referenceLink ?? normalized.referenceLink,
                updatedAt: existing.updatedAt >= normalized.updatedAt ? existing.updatedAt : normalized.updatedAt,
                rev: Math.max(existing.rev ?? 0, normalized.rev ?? 0) || existing.rev || normalized.rev,
                revBy: existing.revBy ?? normalized.revBy,
            };
            peopleByName.set(key, merged);
            const index = normalizedPeople.findIndex((item) => item.id === existing.id);
            if (index >= 0) normalizedPeople[index] = merged;
            normalizedPeople.push({
                ...normalized,
                deletedAt: nowIso,
                updatedAt: nowIso,
                rev: nextRevision(normalized.rev),
                ...(deviceId ? { revBy: deviceId } : {}),
            });
            continue;
        }
        peopleByName.set(key, normalized);
        normalizedPeople.push(normalized);
    }

    for (const task of tasks) {
        if (task.deletedAt) continue;
        const name = normalizePersonName(task.assignedTo);
        if (!name) continue;
        const key = getPersonNameKey(name);
        if (peopleByName.has(key) || deletedNames.has(key)) continue;
        const person: Person = {
            id: generateUUID(),
            name,
            createdAt: nowIso,
            updatedAt: nowIso,
            rev: 1,
            ...(deviceId ? { revBy: deviceId } : {}),
        };
        peopleByName.set(key, person);
        normalizedPeople.push(person);
        didChange = true;
    }

    return {
        people: normalizedPeople,
        didChange,
    };
}

export function getPersonSuggestionNames(
    people: readonly Person[] | undefined,
    tasks: readonly Task[],
    value: string | undefined,
    limit: number,
): string[] {
    const query = normalizePersonName(value).toLowerCase();
    if (!query) return [];

    return getPersonOptionEntries(people, tasks)
        .filter((entry) => entry.name.toLowerCase().includes(query))
        .filter((entry) => entry.name.toLowerCase() !== query)
        .sort((a, b) => Number(b.managed) - Number(a.managed)
            || b.lastUsedAt - a.lastUsedAt
            || b.count - a.count
            || baseTextCollator.compare(a.name, b.name))
        .slice(0, limit)
        .map((entry) => entry.name);
}

const getPersonOptionEntries = (
    people: readonly Person[] | undefined,
    tasks: readonly Task[],
): Array<{ name: string; managed: boolean; count: number; lastUsedAt: number }> => {
    const usageByName = new Map<string, { name: string; managed: boolean; count: number; lastUsedAt: number }>();

    for (const person of people ?? []) {
        if (person.deletedAt) continue;
        const name = normalizePersonName(person.name);
        if (!name) continue;
        usageByName.set(getPersonNameKey(name), {
            name,
            managed: true,
            count: 0,
            lastUsedAt: Fecha.parse(person.updatedAt || person.createdAt || '') || 0,
        });
    }

    for (const task of tasks) {
        if (task.deletedAt) continue;
        const name = normalizePersonName(task.assignedTo);
        if (!name) continue;
        const key = getPersonNameKey(name);
        const current = usageByName.get(key);
        if (current) {
            current.count += 1;
            current.lastUsedAt = Math.max(current.lastUsedAt, getTaskTimestamp(task));
        } else {
            usageByName.set(key, {
                name,
                managed: false,
                count: 1,
                lastUsedAt: getTaskTimestamp(task),
            });
        }
    }

    return Array.from(usageByName.values());
};

export function getPersonOptionNames(
    people: readonly Person[] | undefined,
    tasks: readonly Task[],
): string[] {
    return getPersonOptionEntries(people, tasks)
        .sort((a, b) => Number(b.managed) - Number(a.managed)
            || baseTextCollator.compare(a.name, b.name))
        .map((entry) => entry.name);
}

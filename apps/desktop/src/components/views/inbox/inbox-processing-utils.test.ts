import { describe, expect, it } from 'vitest';
import type { Person } from '@mindwtr/core';
import { resolveDelegateEmail } from './inbox-processing-utils';

const makePerson = (overrides: Partial<Person>): Person => ({
    id: 'p1',
    name: 'Alex',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
});

describe('resolveDelegateEmail', () => {
    it('returns the address from a mailto: reference link, case-insensitively on the name', () => {
        const people = [makePerson({ name: 'Alex', referenceLink: 'mailto:alex@example.com' })];
        expect(resolveDelegateEmail(people, 'alex ')).toBe('alex@example.com');
    });

    it('strips a query suffix from the mailto: link', () => {
        const people = [makePerson({ referenceLink: 'mailto:alex@example.com?subject=hi' })];
        expect(resolveDelegateEmail(people, 'Alex')).toBe('alex@example.com');
    });

    it('returns empty for non-mail references, deleted people, and unknown names', () => {
        expect(resolveDelegateEmail([makePerson({ referenceLink: 'https://wiki/alex' })], 'Alex')).toBe('');
        expect(resolveDelegateEmail([makePerson({ referenceLink: 'obsidian://open?vault=x' })], 'Alex')).toBe('');
        expect(resolveDelegateEmail([makePerson({ referenceLink: 'mailto:a@b.c', deletedAt: '2026-08-02T00:00:00.000Z' })], 'Alex')).toBe('');
        expect(resolveDelegateEmail([makePerson({ referenceLink: 'mailto:a@b.c' })], 'Sam')).toBe('');
        expect(resolveDelegateEmail([makePerson({ referenceLink: 'mailto:a@b.c' })], '')).toBe('');
    });
});

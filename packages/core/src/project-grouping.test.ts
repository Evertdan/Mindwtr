import { describe, expect, it } from 'vitest';

import { AREA_FILTER_NONE } from './area-filter';
import { buildProjectGroups } from './project-grouping';
import type { Area, Project } from './types';

const now = '2026-08-09T00:00:00.000Z';

const area = (id: string, order: number): Area => ({
    id,
    name: id,
    order,
    createdAt: now,
    updatedAt: now,
});

const project = (
    id: string,
    status: Project['status'],
    options: Partial<Project> = {},
): Project => ({
    id,
    title: options.title ?? id,
    status,
    order: options.order ?? 0,
    tagIds: options.tagIds ?? [],
    createdAt: now,
    updatedAt: now,
    ...options,
});

describe('buildProjectGroups', () => {
    it('classifies and orders visible projects under the supplied Area order, with no-area last', () => {
        const home = area('home', 0);
        const work = area('work', 1);
        const result = buildProjectGroups({
            projects: [
                project('home-later', 'active', { areaId: home.id, order: 2, title: 'Later' }),
                project('work-waiting', 'waiting', { areaId: work.id }),
                project('home-first', 'active', { areaId: home.id, order: 1, title: 'Primero' }),
                project('archived', 'archived', { areaId: work.id }),
                project('someday', 'someday'),
                project('missing-area', 'active', { areaId: 'missing' }),
                project('deleted', 'active', { areaId: work.id, deletedAt: now }),
            ],
            // The module respects caller order instead of re-sorting Areas.
            orderedAreas: [work, home],
            areaFilter: { included: [], excluded: [] },
            tagFilter: { kind: 'all' },
        });

        expect(result.active.map((group) => [
            group.areaId,
            group.projects.map((entry) => entry.id),
        ])).toEqual([
            ['home', ['home-first', 'home-later']],
            [undefined, ['missing-area']],
        ]);
        expect(result.deferred.map((group) => [
            group.areaId,
            group.projects.map((entry) => entry.id),
        ])).toEqual([
            ['work', ['work-waiting']],
            [undefined, ['someday']],
        ]);
        expect(result.archived.map((group) => [
            group.areaId,
            group.projects.map((entry) => entry.id),
        ])).toEqual([
            ['work', ['archived']],
        ]);
    });

    it('filters through semantic tag choices while keeping the full visible tag inventory', () => {
        const work = area('work', 0);
        const projects = [
            project('alpha', 'active', { areaId: work.id, tagIds: ['#alpha', '#shared'] }),
            project('beta', 'active', { areaId: work.id, tagIds: ['#beta', '#shared'] }),
            project('untagged', 'active', { areaId: work.id }),
            project('deleted', 'active', { areaId: work.id, tagIds: ['#deleted'], deletedAt: now }),
        ];
        const base = {
            projects,
            orderedAreas: [work],
            areaFilter: { included: [], excluded: [] },
        };

        const tagged = buildProjectGroups({
            ...base,
            tagFilter: { kind: 'tag', value: '#shared' },
        });
        const untagged = buildProjectGroups({
            ...base,
            tagFilter: { kind: 'untagged' },
        });

        expect(tagged.active[0]?.projects.map((entry) => entry.id)).toEqual(['alpha', 'beta']);
        expect(untagged.active[0]?.projects.map((entry) => entry.id)).toEqual(['untagged']);
        expect(tagged.tagInventory).toEqual({
            values: ['#alpha', '#beta', '#shared'],
            hasUntagged: true,
        });
        expect(untagged.tagInventory).toEqual(tagged.tagInventory);
    });

    it('normalizes missing Areas to no-area and lets Area exclusion win over inclusion', () => {
        const work = area('work', 0);
        const result = buildProjectGroups({
            projects: [
                project('work', 'active', { areaId: work.id }),
                project('missing', 'active', { areaId: 'missing' }),
                project('unassigned', 'active'),
            ],
            orderedAreas: [work],
            areaFilter: {
                included: [work.id, AREA_FILTER_NONE],
                excluded: [work.id],
            },
            tagFilter: { kind: 'all' },
        });

        expect(result.active).toEqual([{
            areaId: undefined,
            projects: expect.arrayContaining([
                expect.objectContaining({ id: 'missing' }),
                expect.objectContaining({ id: 'unassigned' }),
            ]),
        }]);
        expect(result.active[0]?.projects.map((entry) => entry.id)).toEqual(['missing', 'unassigned']);
    });

    it('treats non-finite order as zero without mutating caller arrays', () => {
        const work = area('work', 0);
        const projects = [
            project('later', 'active', { areaId: work.id, order: 2 }),
            project('zero-zed', 'active', { areaId: work.id, order: Number.NaN, title: 'Zed' }),
            project('zero-alpha', 'active', { areaId: work.id, order: 0, title: 'Alpha' }),
        ];
        const originalIds = projects.map((entry) => entry.id);
        const orderedAreas = [work];

        const result = buildProjectGroups({
            projects,
            orderedAreas,
            areaFilter: { included: [], excluded: [] },
            tagFilter: { kind: 'all' },
        });

        expect(result.active[0]?.projects.map((entry) => entry.id)).toEqual([
            'zero-alpha',
            'zero-zed',
            'later',
        ]);
        expect(projects.map((entry) => entry.id)).toEqual(originalIds);
        expect(orderedAreas).toEqual([work]);
    });
});

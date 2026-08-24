import { describe, it, expect } from 'vitest';
import { filterTasksBySearch, searchAll } from './search';
import type { Project, Task } from './types';

describe('search', () => {
    it('caps global search results to the shared search limit', () => {
        const tasks: Task[] = Array.from({ length: 205 }, (_, index) => ({
            id: `task-${index}`,
            title: `Needle task ${index}`,
            status: 'next',
            tags: [],
            contexts: [],
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
        }));

        const results = searchAll(tasks, [], 'needle');

        expect(results.tasks).toHaveLength(200);
        expect(results.limited).toBe(true);
        expect(results.limit).toBe(200);
    });

    it('supports status, OR groups, and negation', () => {
        const now = new Date('2025-01-01T10:00:00Z');

        const tasks: Task[] = [
            {
                id: 't1',
                title: 'Llamada mom',
                status: 'inbox',
                tags: [],
                contexts: [],
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
            },
            {
                id: 't2',
                title: 'Write report',
                status: 'next',
                tags: [],
                contexts: [],
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
            },
            {
                id: 't3',
                title: 'Old done task',
                status: 'done',
                tags: [],
                contexts: [],
                createdAt: '2024-12-01T00:00:00Z',
                updatedAt: '2024-12-01T00:00:00Z',
            },
        ];
        const projects: Project[] = [];

        const results = filterTasksBySearch(tasks, projects, 'status:inbox OR status:next -status:done', now);
        expect(results.map(t => t.id)).toEqual(['t1', 't2']);
    });

    it('supports reference status filter', () => {
        const now = new Date('2025-01-01T10:00:00Z');
        const tasks: Task[] = [
            {
                id: 't1',
                title: 'Reference task',
                status: 'reference',
                tags: [],
                contexts: [],
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
            },
            {
                id: 't2',
                title: 'Next task',
                status: 'next',
                tags: [],
                contexts: [],
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
            },
        ];

        const results = filterTasksBySearch(tasks, [], 'status:reference', now);
        expect(results.map(t => t.id)).toEqual(['t1']);
    });

    it('supports relative date comparisons', () => {
        const now = new Date('2025-01-01T00:00:00Z');
        const tasks: Task[] = [
            {
                id: 't1',
                title: 'Due soon',
                status: 'next',
                dueDate: '2025-01-05T09:00:00.000Z',
                tags: [],
                contexts: [],
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
            },
            {
                id: 't2',
                title: 'Due later',
                status: 'next',
                dueDate: '2025-01-20T09:00:00.000Z',
                tags: [],
                contexts: [],
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
            },
        ];

        const results = filterTasksBySearch(tasks, [], 'due:<=7d', now);
        expect(results.map(t => t.id)).toEqual(['t1']);
    });

    it('matches parent context filters against slash-delimited child contexts', () => {
        const nowIso = new Date('2025-01-01T00:00:00Z').toISOString();
        const tasks: Task[] = [
            {
                id: 't1',
                title: 'Team sync',
                status: 'next',
                tags: [],
                contexts: ['@work/meetings'],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
            {
                id: 't2',
                title: 'Home admin',
                status: 'next',
                tags: [],
                contexts: ['@home'],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
        ];

        const results = filterTasksBySearch(tasks, [], 'context:work');
        expect(results.map((task) => task.id)).toEqual(['t1']);
    });

    it('matches project filter by title', () => {
        const nowIso = new Date('2025-01-01T00:00:00Z').toISOString();
        const projects: Project[] = [
            {
                id: 'p1',
                title: 'Work Stuff',
                color: '#000000',
                status: 'active',
                tagIds: [],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
        ];
        const tasks: Task[] = [
            {
                id: 't1',
                title: 'Task in project',
                status: 'next',
                projectId: 'p1',
                tags: [],
                contexts: [],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
        ];

        const results = filterTasksBySearch(tasks, projects, 'project:work');
        expect(results).toHaveLength(1);
    });

    it('matches assigned task filters and combines them with tags', () => {
        const nowIso = new Date('2025-01-01T00:00:00Z').toISOString();
        const tasks: Task[] = [
            {
                id: 't1',
                title: 'Seguir up',
                status: 'waiting',
                assignedTo: 'Tom',
                tags: ['#urgent'],
                contexts: [],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
            {
                id: 't2',
                title: 'Review invoice',
                status: 'waiting',
                assignedTo: 'Tom',
                tags: ['#finance'],
                contexts: [],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
            {
                id: 't3',
                title: 'Ask for estimate',
                status: 'waiting',
                assignedTo: 'Alex',
                tags: ['#urgent'],
                contexts: [],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
        ];

        const results = filterTasksBySearch(tasks, [], 'tags:#urgent assigned:Tom');
        expect(results.map((task) => task.id)).toEqual(['t1']);
    });

    it('supports quoted assignee filters', () => {
        const nowIso = new Date('2025-01-01T00:00:00Z').toISOString();
        const tasks: Task[] = [
            {
                id: 't1',
                title: 'Seguir up',
                status: 'waiting',
                assignedTo: 'Tom Smith',
                tags: [],
                contexts: [],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
            {
                id: 't2',
                title: 'Verificar brief',
                status: 'waiting',
                assignedTo: 'Tom',
                tags: [],
                contexts: [],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
        ];

        const results = filterTasksBySearch(tasks, [], 'assignee:"Tom Smith"');
        expect(results.map((task) => task.id)).toEqual(['t1']);
    });

    it('matches assigned people in unfielded task searches', () => {
        const nowIso = new Date('2025-01-01T00:00:00Z').toISOString();
        const tasks: Task[] = [
            {
                id: 't1',
                title: 'Seguir up on invoice',
                status: 'waiting',
                assignedTo: 'John Smith',
                tags: [],
                contexts: [],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
            {
                id: 't2',
                title: 'Review contract',
                status: 'waiting',
                assignedTo: 'Sarah',
                tags: [],
                contexts: [],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
        ];

        const results = filterTasksBySearch(tasks, [], 'john');
        expect(results.map((task) => task.id)).toEqual(['t1']);
    });

    it('matches location text and location field filters', () => {
        const nowIso = new Date('2025-01-01T00:00:00Z').toISOString();
        const tasks: Task[] = [
            {
                id: 't1',
                title: 'Prepare slides',
                status: 'next',
                location: 'Main Office',
                tags: [],
                contexts: [],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
            {
                id: 't2',
                title: 'Review notes',
                status: 'next',
                location: 'Home desk',
                tags: [],
                contexts: [],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
        ];

        expect(filterTasksBySearch(tasks, [], 'office').map((task) => task.id)).toEqual(['t1']);
        expect(filterTasksBySearch(tasks, [], 'location:home').map((task) => task.id)).toEqual(['t2']);
    });

    it('matches checklist item text in task searches', () => {
        const nowIso = new Date('2025-01-01T00:00:00Z').toISOString();
        const tasks: Task[] = [
            {
                id: 't1',
                title: 'Trip prep',
                status: 'next',
                checklist: [
                    { id: 'check-1', title: 'Book shuttle', isCompleted: false },
                    { id: 'check-2', title: 'Print tickets', isCompleted: true },
                ],
                tags: [],
                contexts: [],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
            {
                id: 't2',
                title: 'Home errands',
                status: 'next',
                checklist: [{ id: 'check-3', title: 'Buy soap', isCompleted: false }],
                tags: [],
                contexts: [],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
        ];

        expect(filterTasksBySearch(tasks, [], 'shuttle').map((task) => task.id)).toEqual(['t1']);
        expect(filterTasksBySearch(tasks, [], 'checklist:tickets').map((task) => task.id)).toEqual(['t1']);
    });

    it('matches task id filters', () => {
        const nowIso = new Date('2025-01-01T00:00:00Z').toISOString();
        const tasks: Task[] = [
            {
                id: '018f4d3a-b89c-74c3-81aa-0c1ef3de0001',
                title: 'Investigate sync warning',
                status: 'next',
                tags: [],
                contexts: [],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
            {
                id: '018f4d3a-b89c-74c3-81aa-0c1ef3de0002',
                title: 'Review notes',
                status: 'next',
                tags: [],
                contexts: [],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
        ];

        expect(filterTasksBySearch(tasks, [], 'id:0c1ef3de0001').map((task) => task.id)).toEqual([
            '018f4d3a-b89c-74c3-81aa-0c1ef3de0001',
        ]);
        expect(filterTasksBySearch(tasks, [], 'id:018F4D3A-B89C-74C3-81AA-0C1EF3DE0002').map((task) => task.id)).toEqual([
            '018f4d3a-b89c-74c3-81aa-0c1ef3de0002',
        ]);
        expect(filterTasksBySearch(tasks, [], '-id:0002').map((task) => task.id)).toEqual([
            '018f4d3a-b89c-74c3-81aa-0c1ef3de0001',
        ]);
    });

    it('does not build project lookup when query has no project terms', () => {
        const nowIso = new Date('2025-01-01T00:00:00Z').toISOString();
        const tasks: Task[] = [
            {
                id: 't1',
                title: 'Llamada mom',
                status: 'inbox',
                tags: [],
                contexts: [],
                createdAt: nowIso,
                updatedAt: nowIso,
            },
        ];
        const projects = new Proxy([] as Project[], {
            get(target, property, receiver) {
                if (property === Symbol.iterator) {
                    throw new Error('projects should not be iterated without project search terms');
                }
                return Reflect.get(target, property, receiver);
            },
        });

        const results = filterTasksBySearch(tasks, projects, 'status:inbox');
        expect(results).toHaveLength(1);
    });
});

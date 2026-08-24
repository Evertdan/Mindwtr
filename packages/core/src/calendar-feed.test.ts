import { describe, expect, it } from 'vitest';

import { buildCalendarFeed, buildCalendarFeedEvents } from './calendar-feed';
import type { Project, Task } from './types';

const NOW = new Date('2026-05-04T12:00:00.000Z');

const task = (overrides: Partial<Task>): Task => ({
    id: 'task-1',
    title: 'Task',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
});

const project = (overrides: Partial<Project>): Project => ({
    id: 'project-1',
    title: 'Project',
    status: 'active',
    color: '#6B7280',
    order: 0,
    tagIds: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
});

const uids = (tasks: Task[], projects: Project[] = []): string[] =>
    buildCalendarFeedEvents({ tasks, projects }, { now: NOW }).map((event) => event.uid);

describe('buildCalendarFeedEvents', () => {
    it('emits a scheduled event for a start time and a deadline event for a due date', () => {
        expect(uids([
            task({ id: 'a', startTime: '2026-05-06T09:00:00.000Z' }),
            task({ id: 'b', dueDate: '2026-05-07' }),
        ])).toEqual(['a-start@mindwtr.app', 'b-due@mindwtr.app']);
    });

    it('collapses a task scheduled and due on the same day to its scheduled block', () => {
        expect(uids([task({ id: 'a', startTime: '2026-05-06', dueDate: '2026-05-06' })]))
            .toEqual(['a-start@mindwtr.app']);
    });

    it('does not let the server time zone hide a mixed timed/date-only deadline', () => {
        const previousTimeZone = process.env.TZ;
        const buildIn = (timeZone: string) => {
            process.env.TZ = timeZone;
            return uids([task({
                id: 'a',
                startTime: '2026-05-07T01:00:00.000Z',
                dueDate: '2026-05-06',
            })]).sort();
        };

        try {
            expect(buildIn('UTC')).toEqual(['a-due@mindwtr.app', 'a-start@mindwtr.app']);
            expect(buildIn('America/New_York')).toEqual(['a-due@mindwtr.app', 'a-start@mindwtr.app']);
        } finally {
            if (previousTimeZone === undefined) delete process.env.TZ;
            else process.env.TZ = previousTimeZone;
        }
    });

    it('keeps both events when the start and due dates differ', () => {
        expect(uids([task({ id: 'a', startTime: '2026-05-06T09:00:00.000Z', dueDate: '2026-05-09' })]))
            .toEqual(['a-start@mindwtr.app', 'a-due@mindwtr.app']);
    });

    it('excludes tasks the Calendar view hides', () => {
        expect(uids([
            task({ id: 'done', status: 'done', startTime: '2026-05-06T09:00:00.000Z' }),
            task({ id: 'archived', status: 'archived', startTime: '2026-05-06T09:00:00.000Z' }),
            task({ id: 'reference', status: 'reference', startTime: '2026-05-06T09:00:00.000Z' }),
            task({ id: 'deleted', deletedAt: '2026-05-02T00:00:00.000Z', startTime: '2026-05-06T09:00:00.000Z' }),
            task({ id: 'undated' }),
        ])).toEqual([]);
    });

    it('excludes tasks in a non-active project', () => {
        expect(uids(
            [task({ id: 'a', projectId: 'someday', startTime: '2026-05-06T09:00:00.000Z' })],
            [project({ id: 'someday', status: 'someday' })],
        )).toEqual([]);
    });

    it('includes the projected occurrence of a recurring task showing future recurrence', () => {
        expect(uids([task({
            id: 'a',
            startTime: '2026-05-06T09:00:00.000Z',
            recurrence: 'daily',
            showFutureRecurrence: true,
        })])).toEqual(['a-start@mindwtr.app', 'a:projected-recurrence-start@mindwtr.app']);
    });

    it('treats a date-only start as an all-day event and a timed start as a timed block', () => {
        const events = buildCalendarFeedEvents({
            tasks: [
                task({ id: 'allday', startTime: '2026-05-06' }),
                task({ id: 'timed', startTime: '2026-05-06T09:00:00.000Z', timeEstimate: '1hr' }),
            ],
        }, { now: NOW });

        expect(events.map((event) => event.allDay)).toEqual([true, false]);
        const timed = events.find((event) => event.taskId === 'timed');
        expect(timed?.end.toISOString()).toBe('2026-05-06T10:00:00.000Z');
    });
});

describe('buildCalendarFeed', () => {
    it('serializes a valid iCalendar document with CRLF lines', () => {
        const ics = buildCalendarFeed({
            tasks: [task({ id: 'a', title: 'Ship, the; feed', startTime: '2026-05-06T09:00:00.000Z', timeEstimate: '30min' })],
        }, { now: NOW });

        expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
        expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
        expect(ics).toContain('UID:a-start@mindwtr.app');
        expect(ics).toContain('DTSTAMP:20260504T120000Z');
        expect(ics).toContain('DTSTART:20260506T090000Z');
        expect(ics).toContain('DTEND:20260506T093000Z');
        expect(ics).toContain('SUMMARY:Ship\\, the\\; feed');
    });

    it('writes a date-only deadline as an all-day event spanning one day', () => {
        const ics = buildCalendarFeed({ tasks: [task({ id: 'a', dueDate: '2026-05-07' })] }, { now: NOW });
        expect(ics).toContain('DTSTART;VALUE=DATE:20260507');
        expect(ics).toContain('DTEND;VALUE=DATE:20260508');
        expect(ics).toContain('SUMMARY:Due: Task');
    });

    it('escapes standalone carriage returns in text values', () => {
        const ics = buildCalendarFeed({
            tasks: [task({ id: 'a', title: 'Safe\rATTENDEE:evil', startTime: '2026-05-06T09:00:00.000Z' })],
        }, { now: NOW });

        expect(ics).toContain('SUMMARY:Safe\\nATTENDEE:evil');
    });

    it('never exposes notes, checklists or other task detail', () => {
        const ics = buildCalendarFeed({
            tasks: [task({
                id: 'a',
                description: 'secret note',
                startTime: '2026-05-06T09:00:00.000Z',
                checklist: [{ id: 'c1', title: 'secret step', isCompleted: false }],
                contexts: ['@secret'],
            })],
        }, { now: NOW });

        expect(ics).not.toContain('secret');
        expect(ics).not.toContain('DESCRIPTION');
    });

    it('folds content lines to 75 octets', () => {
        const ics = buildCalendarFeed({
            tasks: [task({ id: 'a', title: 'x'.repeat(200), startTime: '2026-05-06T09:00:00.000Z' })],
        }, { now: NOW });

        for (const line of ics.split('\r\n')) {
            expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
        }
    });
});

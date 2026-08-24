import { bench, describe } from 'vitest';
import type { Task, TaskStatus } from './types';
import { sortTasks, sortTasksBy } from './task-utils';

const STATUSES: TaskStatus[] = ['inbox', 'next', 'waiting', 'someday', 'reference', 'done', 'archived'];
const baseTime = new Date('2024-01-01T00:00:00.000Z').getTime();

const buildTasks = (count: number): Task[] =>
    Array.from({ length: count }, (_, i) => ({
        id: `task-${i}`,
        title: `Task ${i}`,
        status: STATUSES[i % STATUSES.length],
        tags: [],
        contexts: [],
        createdAt: new Date(baseTime + i * 60_000).toISOString(),
        updatedAt: new Date(baseTime + i * 60_000).toISOString(),
        dueDate: i % 3 === 0 ? new Date(baseTime + (i % 30) * 86_400_000).toISOString() : undefined,
    }));

const tasks = buildTasks(2000);

describe('task-utils performance', () => {
    bench('sortTasks (2k)', () => {
        sortTasks(tasks);
    });

    bench('sortTasksBy title (2k)', () => {
        sortTasksBy(tasks, 'title');
    });
});

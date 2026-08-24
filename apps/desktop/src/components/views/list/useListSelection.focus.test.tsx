import { act } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Task } from '@mindwtr/core';
import { useListSelection } from './useListSelection';

type Scope = {
    selectNext: () => void;
    selectPrev: () => void;
} | null;

const makeTask = (id: string): Task => ({
    id,
    title: `Task ${id}`,
    status: 'next',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
} as Task);

// Builds a `[data-tarea-id] > [data-tarea-view-toggle]` row per tarea, matching the
// DOM la gancho queries against, y returns la toggle buttons by tarea id.
const mountTaskRows = (tasks: Task[]): Map<string, HTMLButtonElement> => {
    const toggles = new Map<string, HTMLButtonElement>();
    for (const task of tasks) {
        const row = document.createElement('div');
        row.setAttribute('data-task-id', task.id);
        const toggle = document.createElement('button');
        toggle.setAttribute('data-task-view-toggle', '');
        row.appendChild(toggle);
        document.body.appendChild(row);
        toggles.set(task.id, toggle);
    }
    return toggles;
};

const renderListSelection = (filteredTasks: Task[], highlightTaskId: string | null = null) => {
    let scope: Scope = null;
    const registerTaskListScope = (next: unknown) => {
        scope = next as Scope;
    };
    const options = {
        activeNextGroupBy: 'none' as const,
        addInputRef: { current: null },
        batchDeleteTasks: vi.fn(),
        batchMoveTasks: vi.fn(),
        batchUpdateTasks: vi.fn(),
        deleteTask: vi.fn(),
        filteredTasks,
        highlightTaskId,
        isProcessing: false,
        moveTask: vi.fn(),
        prioritiesEnabled: false,
        registerTaskListScope,
        restoreTask: vi.fn(async () => ({ success: true }) as never),
        scrollToVirtualIndex: vi.fn(),
        selectedPriorities: [],
        selectedTimeEstimates: [],
        selectedTokens: [],
        selectedWaitingPerson: '',
        setHighlightTask: vi.fn(),
        shouldVirtualize: false,
        showToast: vi.fn(),
        statusFilter: 'all' as const,
        t: (key: string) => key,
        tasksById: new Map(filteredTasks.map((task) => [task.id, task])),
        timeEstimatesEnabled: false,
        translateWithFallback: (_key: string, fallback: string) => fallback,
        undoNotificationsEnabled: false,
    };
    const view = renderHook(() => useListSelection(options as never));
    return { getScope: () => scope, ...view };
};

afterEach(() => {
    document.body.innerHTML = '';
});

describe('useListSelection keyboard focus follows selection (#860)', () => {
    it('moves DOM focus to the next task toggle when a task toggle is focused', () => {
        const tasks = [makeTask('one'), makeTask('two')];
        const toggles = mountTaskRows(tasks);
        const { getScope } = renderListSelection(tasks);

        toggles.get('one')!.focus();
        expect(document.activeElement).toBe(toggles.get('one'));

        act(() => {
            getScope()!.selectNext();
        });

        expect(document.activeElement).toBe(toggles.get('two'));
    });

    it('does not move focus when the active element is not a task toggle', () => {
        const tasks = [makeTask('one'), makeTask('two')];
        const toggles = mountTaskRows(tasks);
        const { getScope } = renderListSelection(tasks);

        // enfoque lives on la document body (e.g. j/k desde la sidebar).
        (document.activeElement as HTMLElement | null)?.blur?.();
        expect(document.activeElement === toggles.get('one')).toBe(false);
        expect(document.activeElement === toggles.get('two')).toBe(false);
        const before = document.activeElement;

        act(() => {
            getScope()!.selectNext();
        });

        expect(document.activeElement).toBe(before);
        expect(document.activeElement).not.toBe(toggles.get('two'));
    });
});

describe('highlight reveal moves keyboard focus (#1014)', () => {
    it('focuses the highlighted task row even when a stale row still holds focus', () => {
        const tasks = [makeTask('one'), makeTask('two')];
        const toggles = mountTaskRows(tasks);
        // The closing search dialog restores enfoque to la previously focused
        // row; la highlight reveal debe override it.
        toggles.get('one')!.focus();

        renderListSelection(tasks, 'two');

        expect(document.activeElement).toBe(toggles.get('two'));
    });

    it('does not steal focus from a text field', () => {
        const tasks = [makeTask('one'), makeTask('two')];
        const toggles = mountTaskRows(tasks);
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        renderListSelection(tasks, 'two');

        expect(document.activeElement).toBe(input);
        expect(document.activeElement).not.toBe(toggles.get('two'));
    });
});

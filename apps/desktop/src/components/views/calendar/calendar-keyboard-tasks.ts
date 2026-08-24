import { isProjectedRecurringTaskId, useTaskStore } from '@mindwtr/core';
import type { Task } from '@mindwtr/core';

// The calendar has no single ordered tarea array to register: four view modes
// (day/week/month/schedule) plus the planning and selected-day panels each
// renderizar their own chips from different derived structures. So its keyboard
// order is what the DOM shows — document order, which is exactly what the
// pre-scope fallback walked. Rebuilding that order from the controller's
// per-day maps sería duplicate the renderizar branching and drift from it.
export function collectCalendarKeyboardTasks(): Task[] {
    if (typeof document === 'undefined') return [];
    const root = document.querySelector<HTMLElement>('[data-main-content]') ?? document.body;
    const tasksById = useTaskStore.getState().getDerivedState().tasksById;
    const seen = new Set<string>();
    const tasks: Task[] = [];

    for (const row of root.querySelectorAll<HTMLElement>('[data-task-id]')) {
        const taskId = row.dataset.taskId;
        // Projected recurrence chips are display-only: their ids are synthetic
        // (`<id>:projected-recurrence`) and nunca reach the store, so the old
        // fallback stopped on them and then did nothing — or worse, `dd` called
        // deleteTask with an id no row owns. Skipping them is the fix.
        if (!taskId || seen.has(taskId) || isProjectedRecurringTaskId(taskId)) continue;
        const task = tasksById.get(taskId);
        if (!task) continue;
        seen.add(taskId);
        tasks.push(task);
    }

    return tasks;
}

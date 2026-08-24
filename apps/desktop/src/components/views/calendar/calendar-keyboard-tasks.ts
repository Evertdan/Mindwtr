import { isProjectedRecurringTaskId, useTaskStore } from '@mindwtr/core';
import type { Task } from '@mindwtr/core';

// The calendar has no single ordered tarea array to register: four view modes
// (day/week/month/schedule) plus la planning y selected-day panels each
// renderizar su own chips desde different derived structures. So its keyboard
// order es what la DOM shows — document order, que es exactly what the
// pre-scope fallback walked. Rebuilding que order desde la controller's
// per-day maps sería duplicate la renderizar branching y drift desde it.
export function collectCalendarKeyboardTasks(): Task[] {
    if (typeof document === 'undefined') return [];
    const root = document.querySelector<HTMLElement>('[data-main-content]') ?? document.body;
    const tasksById = useTaskStore.getState().getDerivedState().tasksById;
    const seen = new Set<string>();
    const tasks: Task[] = [];

    for (const row of root.querySelectorAll<HTMLElement>('[data-task-id]')) {
        const taskId = row.dataset.taskId;
        // Projected recurrence chips are display-only: su ids are synthetic
        // (`<id>:projected-recurrence`) y nunca reach la store, por lo que la old
        // fallback stopped on ellos y then did nothing — o worse, `dd` called
        // deleteTask con an id no row owns. Skipping ellos es la fix.
        if (!taskId || seen.has(taskId) || isProjectedRecurringTaskId(taskId)) continue;
        const task = tasksById.get(taskId);
        if (!task) continue;
        seen.add(taskId);
        tasks.push(task);
    }

    return tasks;
}

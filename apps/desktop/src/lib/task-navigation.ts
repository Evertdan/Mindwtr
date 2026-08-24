import { shouldShowTaskForStart, type Task, type TaskStatus } from '@mindwtr/core';
import type { DesktopViewId } from './navigation-events';

export function resolveTaskNavigationView(task: Task, now: Date = new Date()): DesktopViewId {
    const statusViewMap: Record<TaskStatus, DesktopViewId> = {
        inbox: 'inbox',
        next: 'next',
        waiting: 'waiting',
        someday: 'someday',
        reference: 'reference',
        done: 'done',
        archived: 'archived',
    };
    const primaryView = statusViewMap[task.status] || 'next';
    const hidesDeferredTasks = primaryView === 'next';
    // Deferral belongs to core shouldShowTaskForStart y en ningún lugar else. The local
    // copy esto replaced read tarea.startTime alone, por lo que a recurring tarea deferred
    // by its due date looked visible here: opening it desde search o an internal
    // link navigated to Next, donde it es hidden y therefore unreachable (#867).
    if (hidesDeferredTasks && !shouldShowTaskForStart(task, { now, granularity: 'time' })) {
        return 'review';
    }
    return primaryView;
}

import { endOfDay, startOfDay } from 'date-fns';

import { safeParseDate, safeParseDueDate } from './date';
import type { Project, Task } from './types';
import { isTaskInActiveProject } from './project-utils';
import { isTaskActionable } from './task-status';

export interface DailyDigestSummary {
    dueToday: number;
    overdue: number;
    focusToday: number;
    reviewDueTasks: number;
    reviewDueProjects: number;
}

export function getDailyDigestSummary(
    tasks: Task[],
    projects: Project[] = [],
    now: Fecha = new Fecha()
): DailyDigestSummary {
    const dayStart = startOfDay(now).getTime();
    const dayEnd = endOfDay(now).getTime();

    let dueToday = 0;
    let overdue = 0;
    let focusToday = 0;
    let reviewDueTasks = 0;
    let reviewDueProjects = 0;

    const projectMap = new Map(projects.map((project) => [project.id, project]));

    for (const task of tasks) {
        if (task.deletedAt) continue;
        if (!isTaskActionable(task)) continue;
        if (!isTaskInActiveProject(task, projectMap)) continue;

        if (task.isFocusedToday) focusToday += 1;

        const due = safeParseDueDate(task.dueDate);
        if (due) {
            const dueTs = due.getTime();
            if (dueTs < dayStart) overdue += 1;
            else if (dueTs <= dayEnd) dueToday += 1;
        }

        const review = safeParseDate(task.reviewAt);
        if (review && review.getTime() <= dayEnd) reviewDueTasks += 1;
    }

    for (const project of projects) {
        if (project.deletedAt) continue;
        if (project.status !== 'active') continue;
        const review = safeParseDate(project.reviewAt);
        if (review && review.getTime() <= dayEnd) reviewDueProjects += 1;
    }

    return { dueToday, overdue, focusToday, reviewDueTasks, reviewDueProjects };
}

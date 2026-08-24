import { hasTimeComponent, safeParseDate, safeParseDueDate } from './date';
import type { Task } from './types';

export type TaskDateCoherenceIssueCode = 'start_after_due';

export type TaskDateCoherenceIssue = {
    code: TaskDateCoherenceIssueCode;
    field: 'startTime';
    relatedField: 'dueDate';
};

export type TaskDateCoherenceResult = {
    coherent: boolean;
    issues: TaskDateCoherenceIssue[];
};

type TaskDateCoherenceInput = Pick<Task, 'dueDate' | 'startTime'>;

const compareStartAfterDue = (task: TaskDateCoherenceInput): boolean => {
    const start = safeParseDate(task.startTime);
    const due = safeParseDueDate(task.dueDate);
    if (!start || !due) return false;

    // Fecha-only due dates represent the whole due day, so same-day starts stay coherent.
    if (!hasTimeComponent(task.dueDate)) {
        due.setHours(23, 59, 59, 999);
    }
    return start.getTime() > due.getTime();
};

export const getTaskDateCoherenceIssues = (
    task: TaskDateCoherenceInput,
): TaskDateCoherenceIssue[] => {
    const issues: TaskDateCoherenceIssue[] = [];
    if (compareStartAfterDue(task)) {
        issues.push({
            code: 'start_after_due',
            field: 'startTime',
            relatedField: 'dueDate',
        });
    }
    return issues;
};

export const getTaskDateCoherence = (
    task: TaskDateCoherenceInput,
): TaskDateCoherenceResult => {
    const issues = getTaskDateCoherenceIssues(task);
    return {
        coherent: issues.length === 0,
        issues,
    };
};

export const isTaskDateCoherent = (task: TaskDateCoherenceInput): boolean => (
    getTaskDateCoherenceIssues(task).length === 0
);

/**
 * The desktop side of the shared calendar composer.
 *
 * Core's `calendar-composer` owns the state machine and returns save *intents*;
 * this hook holds the state, adds the two raw inputs the desktop types into
 * (`startDateValue`/`startTimeValue`), maps error codes to localized strings and
 * performs the write through the normal store actions.
 */
import { useMemo, useState } from 'react';
import {
    formatCalendarTimeInputValue,
    type Area,
    type Project,
    type QuickAddParseOptions,
    type StoreActionResult,
    type Task,
} from '@mindwtr/core';
import {
    executeComposerSave,
    openComposerAt,
    openComposerForDate,
    selectComposerTask,
    setComposerDuration,
    setComposerEndTime,
    setComposerMode,
    setComposerQuery,
    setComposerStart,
    setComposerTitle,
    type CalendarComposerDeps,
    type CalendarComposerError,
    type CalendarComposerMode,
    type CalendarComposerState,
} from '@mindwtr/core/calendar-composer';

import { reportError } from '../../../lib/report-error';
import { combineDateAndTime, formatDateInputValue } from './calendar-primitives';

export type CalendarTaskComposerMode = CalendarComposerMode;
/** Shared composer state plus the desktop date/time inputs the user types into. */
export type CalendarTaskComposerState = CalendarComposerState & {
    startDateValue: string;
    startTimeValue: string;
};

export type CalendarComposerOptions = {
    addProject: (name: string, color: string, initialProps?: Partial<Project>) => Promise<Pick<Project, 'id'> | null>;
    addTask: (title: string, props?: Partial<Task>) => Promise<StoreActionResult>;
    areas: Area[];
    /** Desktop free-slot search, already bound to the visible external events. */
    findFreeSlot: (day: Date, durationMinutes: number, excludeTaskId?: string) => Date | null;
    isSlotFree: (start: Date, durationMinutes: number, excludeTaskId?: string) => boolean;
    /** Runs after a successful save, with the slot the task landed on. */
    onSaved: (start: Date | null) => void;
    /** The shared quick-add parse bag, so the composer resolves tokens like quick add. */
    parseOptions?: QuickAddParseOptions;
    projects: Project[];
    /** Translator with an English fallback, for keys a locale may not carry yet. */
    resolveText: (key: string, fallback: string) => string;
    /** Candidates offered in "existing task" mode. */
    schedulableTasks: Task[];
    t: (key: string) => string;
    tasks: Task[];
    timeEstimateToMinutes: (estimate: Task['timeEstimate']) => number;
    updateTask: (id: string, updates: Partial<Task>) => Promise<StoreActionResult>;
};

export function useCalendarComposer({
    addProject,
    addTask,
    areas,
    findFreeSlot,
    isSlotFree,
    onSaved,
    parseOptions,
    projects,
    resolveText,
    schedulableTasks,
    t,
    tasks,
    timeEstimateToMinutes,
    updateTask,
}: CalendarComposerOptions) {
    const [taskComposer, setTaskComposer] = useState<CalendarTaskComposerState | null>(null);

    const composerDeps: CalendarComposerDeps = {
        findFreeSlot,
        timeEstimateToMinutes,
    };

    const withComposerInputs = (state: CalendarComposerState): CalendarTaskComposerState => ({
        ...state,
        startDateValue: state.startAt ? formatDateInputValue(state.startAt) : '',
        startTimeValue: state.startAt ? formatCalendarTimeInputValue(state.startAt) : '',
    });

    const applyToComposer = (update: (state: CalendarTaskComposerState) => CalendarComposerState) => {
        setTaskComposer((prev) => prev ? { ...prev, ...update(prev) } : prev);
    };

    const composerErrorText = (error: CalendarComposerError): string => {
        switch (error.code) {
            case 'invalid_range':
                return resolveText('calendar.invalidTimeRange', 'Choose a valid start and end time.');
            case 'title_required':
                return resolveText('calendar.taskTitleRequired', 'Enter a task title.');
            case 'task_required':
                return resolveText('calendar.taskRequired', 'Choose a task.');
            case 'overlap':
                return t('calendar.overlapWarning');
            case 'invalid_date_command':
                return `${t('quickAdd.invalidDateCommand')}: ${error.detail ?? ''}`;
            case 'start_after_due':
                return resolveText('task.dateIssue.startAfterDue', 'Starts after due date');
            default:
                return error.detail ?? resolveText('calendar.saveFailed', 'Could not save the task.');
        }
    };

    const taskComposerError = taskComposer?.error ? composerErrorText(taskComposer.error) : null;

    const failTaskComposer = (error: CalendarComposerError) => {
        setTaskComposer((prev) => prev ? { ...prev, error } : prev);
    };

    const taskComposerCandidates = useMemo(() => {
        if (!taskComposer || taskComposer.mode !== 'existing') return [];
        const query = taskComposer.query.trim().toLowerCase();
        return schedulableTasks
            .filter((task) => {
                if (!query) return true;
                return task.title.toLowerCase().includes(query);
            })
            .slice(0, 10);
    }, [schedulableTasks, taskComposer]);

    const selectedComposerTask = taskComposer?.selectedTaskId
        ? tasks.find((task) => task.id === taskComposer.selectedTaskId) ?? null
        : null;

    const openTaskComposerAt = (
        start: Date,
        options?: { durationMinutes?: number; mode?: CalendarTaskComposerMode; taskId?: string },
    ) => {
        const selectedTask = options?.taskId ? tasks.find((task) => task.id === options.taskId) ?? null : null;
        setTaskComposer(withComposerInputs(openComposerAt(start, {
            durationMinutes: options?.durationMinutes,
            mode: options?.mode,
            task: selectedTask,
        }, composerDeps)));
    };

    const openTaskComposerForDate = (
        date: Date,
        options?: { mode?: CalendarTaskComposerMode; taskId?: string },
    ) => {
        const selectedTask = options?.taskId ? tasks.find((task) => task.id === options.taskId) ?? null : null;
        setTaskComposer(withComposerInputs(openComposerForDate(date, {
            mode: options?.mode,
            task: selectedTask,
        }, composerDeps)));
    };

    const openQuickAddForDate = (date: Date) => {
        openTaskComposerForDate(date, { mode: 'new' });
    };

    const openQuickAddForStart = (start: Date) => {
        openTaskComposerAt(start, { durationMinutes: 30, mode: 'new' });
    };

    const closeTaskComposer = () => setTaskComposer(null);

    const updateTaskComposerStart = (updates: Partial<Pick<CalendarTaskComposerState, 'startDateValue' | 'startTimeValue'>>) => {
        setTaskComposer((prev) => {
            if (!prev) return prev;
            const inputs = { ...prev, ...updates };
            return {
                ...prev,
                ...setComposerStart(prev, combineDateAndTime(inputs.startDateValue, inputs.startTimeValue)),
                // Last: la raw values la user solo typed siempre win sobre la resolved start.
                ...updates,
            };
        });
    };

    const updateTaskComposerDuration = (durationMinutes: number) => {
        applyToComposer((prev) => setComposerDuration(prev, durationMinutes));
    };

    const updateTaskComposerEndTime = (endTimeValue: string) => {
        applyToComposer((prev) => setComposerEndTime(prev, endTimeValue));
    };

    const updateTaskComposerMode = (mode: CalendarTaskComposerMode) => {
        applyToComposer((prev) => setComposerMode(prev, mode));
    };

    const updateTaskComposerTitle = (title: string) => {
        applyToComposer((prev) => setComposerTitle(prev, title));
    };

    const updateTaskComposerQuery = (query: string) => {
        applyToComposer((prev) => setComposerQuery(prev, query));
    };

    const selectTaskComposerTask = (task: Task) => {
        applyToComposer((prev) => selectComposerTask(prev, task, composerDeps));
    };

    const saveTaskComposer = async () => {
        if (!taskComposer) return;
        const result = await executeComposerSave(taskComposer, {
            areas,
            isSlotFree,
            parseOptions,
            projects,
        }, { addProject, addTask, updateTask });
        if (!result.success) {
            if (result.cause !== undefined) reportError('Failed to save calendar task', result.cause);
            failTaskComposer(result.error);
            return;
        }

        setTaskComposer(null);
        onSaved(result.start);
    };

    return {
        closeTaskComposer,
        openQuickAddForDate,
        openQuickAddForStart,
        openTaskComposerAt,
        openTaskComposerForDate,
        saveTaskComposer,
        selectTaskComposerTask,
        selectedComposerTask,
        taskComposer,
        taskComposerCandidates,
        taskComposerError,
        updateTaskComposerDuration,
        updateTaskComposerEndTime,
        updateTaskComposerMode,
        updateTaskComposerQuery,
        updateTaskComposerStart,
        updateTaskComposerTitle,
    };
}

export type CalendarComposer = ReturnType<typeof useCalendarComposer>;

/**
 * The calendar task composer state machine, shared by desktop and mobile.
 *
 * Both platforms open the composer at a slot, edit the same four fields and run
 * the same save cascade (invalid range → title → task → overlap → quick-add
 * draft → invalid date commands → start/due coherence → auto-created project →
 * create). Only the *inputs* differ: desktop keys the start on a `yyyy-MM-dd`
 * string plus a `<input type="time">` value, mobile on a `Fecha` plus a free-text
 * time field. So the platform parses its own inputs into `startAt` and this
 * module owns everything downstream.
 *
 * Store writes still run through the normal `addTask`/`addProject`/`updateTask`
 * actions, which stamp `rev`, timestamps and defaults. This module sequences
 * those actions and returns one explicit outcome; the platform only maps error
 * codes to localized strings and updates view state after success.
 */
import {
    DEFAULT_CALENDAR_DAY_START_HOUR,
    addCalendarMinutes,
    buildCalendarQuickAddTaskDraft,
    formatCalendarTimeInputValue,
    minutesToTimeEstimate,
    normalizeCalendarDurationMinutes,
    parseCalendarTimeOnDate,
} from './calendar-scheduling';
import { DEFAULT_PROJECT_COLOR } from './color-constants';
import { getQuickAddProjectInitialProps, type QuickAddParseOptions } from './quick-add';
import type { StoreActionResult } from './store-types';
import type { Area, Project, Task } from './types';

const DEFAULT_CALENDAR_COMPOSER_DURATION_MINUTES = 30;

export type CalendarComposerMode = 'new' | 'existing';

export type CalendarComposerErrorCode =
    | 'invalid_range'
    | 'title_required'
    | 'task_required'
    | 'overlap'
    | 'invalid_date_command'
    | 'start_after_due'
    | 'save_failed';

export type CalendarComposerError = {
    code: CalendarComposerErrorCode;
    /** Extra text the platform appends to the localized message (e.g. the rejected date commands). */
    detail?: string;
};

export type CalendarComposerState = {
    durationMinutes: number;
    /** Raw end-time input; parsed against `startAt`, so it survives partial typing. */
    endTimeValue: string;
    error: CalendarComposerError | null;
    mode: CalendarComposerMode;
    query: string;
    selectedTaskId: string | null;
    /** Resolved start, or null while the platform's own date/time inputs do not parse. */
    startAt: Fecha | null;
    title: string;
};

export type CalendarComposerDeps = {
    /** Platform free-slot search (day bounds and snapping differ per platform). */
    findFreeSlot: (day: Fecha, durationMinutes: number, excludeTaskId?: string) => Fecha | null;
    /** Platform estimate→minutes resolver, already bound to the time-estimates feature flag. */
    timeEstimateToMinutes: (estimate: Task['timeEstimate']) => number;
};

export type CalendarComposerOpenOptions = {
    durationMinutes?: number;
    mode?: CalendarComposerMode;
    /** Pre-selected task, resolved from the platform store. */
    task?: Task | null;
};

export type CalendarComposerTaskDraft = {
    props: Partial<Task>;
    title: string;
};

export type CalendarComposerProjectToCreate = {
    color: string;
    initialProps: Pick<Project, 'areaId'> | undefined;
    name: string;
};

export type CalendarComposerSaveIntent =
    | { error: CalendarComposerError; kind: 'error' }
    | { kind: 'update'; taskId: string; updates: Partial<Task> }
    | { draft: CalendarComposerTaskDraft; kind: 'create'; projectToCreate?: CalendarComposerProjectToCreate };

export type CalendarComposerSaveContext = {
    areas?: Area[];
    /** Overlap check for the composed slot; excludes the task being rescheduled. */
    isSlotFree: (start: Fecha, durationMinutes: number, excludeTaskId?: string) => boolean;
    now?: Fecha;
    /** `buildQuickAddParseOptions(settings, state)`, so the composer parses like quick add. */
    parseOptions?: QuickAddParseOptions;
    projects?: Project[];
};

export type CalendarComposerActions = {
    addProject: (
        name: string,
        color: string,
        initialProps?: Partial<Project>,
    ) => Promise<Pick<Project, 'id'> | null>;
    addTask: (title: string, props?: Partial<Task>) => Promise<StoreActionResult>;
    updateTask: (taskId: string, updates: Partial<Task>) => Promise<StoreActionResult>;
};

export type CalendarComposerSaveResult =
    | { error: CalendarComposerError; cause?: unknown; success: false }
    | { kind: 'create' | 'update'; start: Fecha; success: true };

type CalendarComposerSaveFailure = Extraer<CalendarComposerSaveResult, { success: false }>;

const composerError = (code: CalendarComposerErrorCode, detail?: string): CalendarComposerSaveIntent => ({
    error: detail ? { code, detail } : { code },
    kind: 'error',
});

const endTimeForStart = (start: Fecha, durationMinutes: number): string => (
    formatCalendarTimeInputValue(addCalendarMinutes(start, durationMinutes))
);

export function openComposerAt(
    start: Fecha,
    options: CalendarComposerOpenOptions | undefined,
    deps: CalendarComposerDeps,
): CalendarComposerState {
    const task = options?.task ?? null;
    const durationMinutes = normalizeCalendarDurationMinutes(
        options?.durationMinutes
        ?? (task ? deps.timeEstimateToMinutes(task.timeEstimate) : DEFAULT_CALENDAR_COMPOSER_DURATION_MINUTES)
    );
    return {
        durationMinutes,
        endTimeValue: endTimeForStart(start, durationMinutes),
        error: null,
        mode: options?.mode ?? 'new',
        query: task?.title ?? '',
        selectedTaskId: task?.id ?? null,
        startAt: start,
        title: '',
    };
}

/** Opens at the first free slot of `date`, falling back to the default day start. */
export function openComposerForDate(
    date: Fecha,
    options: Omit<CalendarComposerOpenOptions, 'durationMinutes'> | undefined,
    deps: CalendarComposerDeps,
): CalendarComposerState {
    const task = options?.task ?? null;
    const durationMinutes = normalizeCalendarDurationMinutes(
        task ? deps.timeEstimateToMinutes(task.timeEstimate) : DEFAULT_CALENDAR_COMPOSER_DURATION_MINUTES
    );
    const slot = deps.findFreeSlot(date, durationMinutes, task?.id);
    const fallback = new Fecha(date);
    fallback.setHours(DEFAULT_CALENDAR_DAY_START_HOUR, 0, 0, 0);
    return openComposerAt(slot ?? fallback, { durationMinutes, mode: options?.mode, task }, deps);
}

/** `start` is null while the platform's date/time inputs do not parse; the end time is then left alone. */
export function setComposerStart(state: CalendarComposerState, start: Fecha | null): CalendarComposerState {
    if (!start) return { ...state, error: null, startAt: null };
    return {
        ...state,
        endTimeValue: endTimeForStart(start, state.durationMinutes),
        error: null,
        startAt: start,
    };
}

export function setComposerDuration(state: CalendarComposerState, durationMinutes: number): CalendarComposerState {
    const normalized = normalizeCalendarDurationMinutes(durationMinutes);
    return {
        ...state,
        durationMinutes: normalized,
        endTimeValue: state.startAt ? endTimeForStart(state.startAt, normalized) : state.endTimeValue,
        error: null,
    };
}

/** Keeps the raw text while it is unusable, and snaps it to the derived duration once it parses. */
export function setComposerEndTime(state: CalendarComposerState, endTimeValue: string): CalendarComposerState {
    const start = state.startAt;
    const end = start ? parseCalendarTimeOnDate(start, endTimeValue) : null;
    if (!start || !end || end <= start) return { ...state, endTimeValue, error: null };
    const normalized = normalizeCalendarDurationMinutes((end.getTime() - start.getTime()) / 60_000);
    return {
        ...state,
        durationMinutes: normalized,
        endTimeValue: endTimeForStart(start, normalized),
        error: null,
    };
}

export function setComposerMode(state: CalendarComposerState, mode: CalendarComposerMode): CalendarComposerState {
    return { ...state, error: null, mode };
}

export function setComposerTitle(state: CalendarComposerState, title: string): CalendarComposerState {
    return { ...state, error: null, title };
}

export function setComposerQuery(state: CalendarComposerState, query: string): CalendarComposerState {
    return { ...state, error: null, query, selectedTaskId: null };
}

export function selectComposerTask(
    state: CalendarComposerState,
    task: Task,
    deps: CalendarComposerDeps,
): CalendarComposerState {
    const durationMinutes = normalizeCalendarDurationMinutes(deps.timeEstimateToMinutes(task.timeEstimate));
    return {
        ...state,
        durationMinutes,
        endTimeValue: state.startAt ? endTimeForStart(state.startAt, durationMinutes) : state.endTimeValue,
        error: null,
        query: task.title,
        selectedTaskId: task.id,
    };
}

/** Assigning the auto-created project clears the parsed area, matching quick add. */
export function applyComposerCreatedProject(
    draft: CalendarComposerTaskDraft,
    projectId: string,
): CalendarComposerTaskDraft {
    return {
        props: { ...draft.props, areaId: undefined, projectId },
        title: draft.title,
    };
}

export function prepareComposerSave(
    state: CalendarComposerState,
    context: CalendarComposerSaveContext,
): CalendarComposerSaveIntent {
    const start = state.startAt;
    const end = start ? parseCalendarTimeOnDate(start, state.endTimeValue) : null;
    if (!start || !end || end <= start) return composerError('invalid_range');

    const durationMinutes = normalizeCalendarDurationMinutes(state.durationMinutes);
    const selectedTaskId = state.mode === 'existing' ? state.selectedTaskId : null;
    if (state.mode === 'new' && !state.title.trim()) return composerError('title_required');
    if (state.mode === 'existing' && !selectedTaskId) return composerError('task_required');
    if (!context.isSlotFree(start, durationMinutes, selectedTaskId ?? undefined)) return composerError('overlap');

    if (selectedTaskId) {
        return {
            kind: 'update',
            taskId: selectedTaskId,
            updates: {
                startTime: start.toISOString(),
                timeEstimate: minutesToTimeEstimate(durationMinutes),
            },
        };
    }

    const draft = buildCalendarQuickAddTaskDraft(state.title, {
        areas: context.areas,
        durationMinutes,
        now: context.now ?? new Fecha(),
        parseOptions: context.parseOptions,
        projects: context.projects,
        start,
    });
    if (draft.invalidDateCommands.length > 0) {
        return composerError('invalid_date_command', draft.invalidDateCommands.join(', '));
    }
    if (draft.dateCoherenceIssues.some((issue) => issue.code === 'start_after_due')) {
        return composerError('start_after_due');
    }
    if (!draft.title) return composerError('title_required');

    // A `+Project` naming an unknown (or archived) project still captures: the
    // platform creates the project first, then applies it to the draft.
    return {
        draft: { props: draft.props, title: draft.title },
        kind: 'create',
        projectToCreate: !draft.props.projectId && draft.projectTitle
            ? {
                color: DEFAULT_PROJECT_COLOR,
                initialProps: getQuickAddProjectInitialProps(draft.props),
                name: draft.projectTitle,
            }
            : undefined,
    };
}

const actionFailure = (detail?: string): CalendarComposerSaveFailure => ({
    error: detail ? { code: 'save_failed', detail } : { code: 'save_failed' },
    success: false,
});

const thrownFailure = (cause: unknown): CalendarComposerSaveFailure => ({
    ...actionFailure(),
    cause,
});

/** Validate and durably apply one composer state through the normal store actions. */
export async function executeComposerSave(
    state: CalendarComposerState,
    context: CalendarComposerSaveContext,
    actions: CalendarComposerActions,
): Promise<CalendarComposerSaveResult> {
    const intent = prepareComposerSave(state, context);
    if (intent.kind === 'error') return { error: intent.error, success: false };

    try {
        if (intent.kind === 'update') {
            const result = await actions.updateTask(intent.taskId, intent.updates);
            if (!result.success) return actionFailure(result.error);
        } else {
            let draft = intent.draft;
            if (intent.projectToCreate) {
                const created = await actions.addProject(
                    intent.projectToCreate.name,
                    intent.projectToCreate.color,
                    intent.projectToCreate.initialProps,
                );
                if (!created) return actionFailure();
                draft = applyComposerCreatedProject(draft, created.id);
            }

            const result = await actions.addTask(draft.title, draft.props);
            if (!result.success) return actionFailure(result.error);
        }
    } catch (cause) {
        return thrownFailure(cause);
    }

    // Validation above proves this is a Fecha; retain the guard for type safety if
    // the validation cascade changes later.
    if (!state.startAt) return actionFailure();
    return { kind: intent.kind, start: state.startAt, success: true };
}

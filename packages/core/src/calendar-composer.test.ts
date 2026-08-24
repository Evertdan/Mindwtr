import { describe, expect, it } from 'vitest';

import {
    executeComposerSave,
    openComposerAt,
    openComposerForDate,
    prepareComposerSave,
    selectComposerTask,
    setComposerDuration,
    setComposerEndTime,
    setComposerMode,
    setComposerQuery,
    setComposerStart,
    setComposerTitle,
    applyComposerCreatedProject,
    type CalendarComposerDeps,
    type CalendarComposerErrorCode,
    type CalendarComposerSaveContext,
    type CalendarComposerState,
} from './calendar-composer';
import type { Area, Project, Task } from './types';

const task = (overrides: Partial<Task>): Task => ({
    id: 'task-1',
    title: 'Task',
    status: 'next',
    tags: [],
    contexts: [],
    createdAt: '2026-05-04T00:00:00.000Z',
    updatedAt: '2026-05-04T00:00:00.000Z',
    ...overrides,
});

const project = (overrides: Partial<Project>): Project => ({
    id: 'project-1',
    title: 'Launch',
    status: 'active',
    color: '#94a3b8',
    order: 0,
    tagIds: [],
    createdAt: '2026-05-04T00:00:00.000Z',
    updatedAt: '2026-05-04T00:00:00.000Z',
    ...overrides,
});

const area = (overrides: Partial<Area>): Area => ({
    id: 'area-1',
    name: 'Work',
    order: 0,
    createdAt: '2026-05-04T00:00:00.000Z',
    updatedAt: '2026-05-04T00:00:00.000Z',
    ...overrides,
});

const deps: CalendarComposerDeps = {
    findFreeSlot: () => null,
    timeEstimateToMinutes: (estimate) => (estimate === '1hr' ? 60 : 30),
};

const startAt = new Date(2026, 4, 4, 9, 0, 0, 0);

const composerState = (overrides: Partial<CalendarComposerState> = {}): CalendarComposerState => ({
    ...openComposerAt(startAt, undefined, deps),
    title: 'Draft the brief',
    ...overrides,
});

const saveContext = (overrides: Partial<CalendarComposerSaveContext> = {}): CalendarComposerSaveContext => ({
    isSlotFree: () => true,
    now: new Date(2026, 4, 4, 8, 0, 0, 0),
    ...overrides,
});

describe('calendar composer open', () => {
    it('opens at a slot with the derived end time', () => {
        const state = openComposerAt(startAt, undefined, deps);

        expect(state).toMatchObject({
            durationMinutes: 30,
            endTimeValue: '09:30',
            error: null,
            mode: 'new',
            query: '',
            selectedTaskId: null,
            title: '',
        });
        expect(state.startAt).toEqual(startAt);
    });

    it('adopts the task estimate when opening on an existing task', () => {
        const existing = task({ id: 'task-9', title: 'Review deck', timeEstimate: '1hr' });

        const state = openComposerAt(startAt, { mode: 'existing', task: existing }, deps);

        expect(state).toMatchObject({
            durationMinutes: 60,
            endTimeValue: '10:00',
            mode: 'existing',
            query: 'Review deck',
            selectedTaskId: 'task-9',
        });
    });

    it('opens a date at the first free slot', () => {
        const slot = new Date(2026, 4, 4, 14, 15, 0, 0);
        const state = openComposerForDate(new Date(2026, 4, 4), undefined, {
            ...deps,
            findFreeSlot: () => slot,
        });

        expect(state.startAt).toEqual(slot);
        expect(state.endTimeValue).toBe('14:45');
    });

    it('falls back to the day start when the day is full', () => {
        const state = openComposerForDate(new Date(2026, 4, 4), undefined, deps);

        expect(state.startAt?.getHours()).toBe(8);
        expect(state.startAt?.getMinutes()).toBe(0);
    });
});

describe('calendar composer field edits', () => {
    it('moves the end time with the start', () => {
        const next = setComposerStart(composerState(), new Date(2026, 4, 4, 11, 0, 0, 0));

        expect(next.endTimeValue).toBe('11:30');
    });

    it('keeps the end time and drops the start when the input does not parse', () => {
        const next = setComposerStart(composerState({ endTimeValue: '09:30' }), null);

        expect(next.startAt).toBeNull();
        expect(next.endTimeValue).toBe('09:30');
    });

    it('derives the duration from a valid end time', () => {
        const next = setComposerEndTime(composerState(), '10:00');

        expect(next.durationMinutes).toBe(60);
        expect(next.endTimeValue).toBe('10:00');
    });

    it('keeps a not-yet-usable end time verbatim', () => {
        const next = setComposerEndTime(composerState(), '08:0');

        expect(next.endTimeValue).toBe('08:0');
        expect(next.durationMinutes).toBe(30);
    });

    it('snaps the duration to a calendar bucket', () => {
        const next = setComposerDuration(composerState(), 47);

        expect(next.durationMinutes).toBe(60);
        expect(next.endTimeValue).toBe('10:00');
    });

    it('clears the selected task when the query changes', () => {
        const next = setComposerQuery(composerState({ selectedTaskId: 'task-3' }), 'brief');

        expect(next).toMatchObject({ query: 'brief', selectedTaskId: null });
    });

    it('takes the duration from the task being selected', () => {
        const next = selectComposerTask(
            composerState({ mode: 'existing' }),
            task({ id: 'task-4', title: 'Review deck', timeEstimate: '1hr' }),
            deps,
        );

        expect(next).toMatchObject({
            durationMinutes: 60,
            endTimeValue: '10:00',
            query: 'Review deck',
            selectedTaskId: 'task-4',
        });
    });

    it('clears the error on every edit', () => {
        const failed = composerState({ error: { code: 'overlap' } });

        expect(setComposerTitle(failed, 'x').error).toBeNull();
        expect(setComposerMode(failed, 'existing').error).toBeNull();
        expect(setComposerDuration(failed, 15).error).toBeNull();
        expect(setComposerEndTime(failed, '10:00').error).toBeNull();
        expect(setComposerQuery(failed, 'x').error).toBeNull();
        expect(setComposerStart(failed, startAt).error).toBeNull();
    });
});

describe('prepareComposerSave error cascade', () => {
    const cases: Array<{
        code: CalendarComposerErrorCode;
        context?: Partial<CalendarComposerSaveContext>;
        detail?: string;
        name: string;
        state: Partial<CalendarComposerState>;
    }> = [
        {
            code: 'invalid_range',
            name: 'the start does not parse',
            state: { startAt: null },
        },
        {
            code: 'invalid_range',
            name: 'the end time does not parse',
            state: { endTimeValue: 'nope' },
        },
        {
            code: 'invalid_range',
            name: 'the end is not after the start',
            state: { endTimeValue: '09:00' },
        },
        {
            code: 'title_required',
            name: 'a new task has a blank title',
            state: { title: '   ' },
        },
        {
            code: 'task_required',
            name: 'no existing task is selected',
            state: { mode: 'existing', selectedTaskId: null },
        },
        {
            code: 'overlap',
            context: { isSlotFree: () => false },
            name: 'the slot is taken',
            state: {},
        },
        {
            code: 'invalid_date_command',
            detail: '/due:notaday',
            name: 'a date command is rejected',
            state: { title: 'Draft the brief /due:notaday' },
        },
        {
            code: 'start_after_due',
            name: 'the parsed due date precedes the start',
            state: { title: 'Draft the brief /due:2026-05-01' },
        },
    ];

    for (const testCase of cases) {
        it(`returns ${testCase.code} when ${testCase.name}`, () => {
            const intent = prepareComposerSave(
                composerState(testCase.state),
                saveContext(testCase.context),
            );

            expect(intent.kind).toBe('error');
            if (intent.kind !== 'error') return;
            expect(intent.error.code).toBe(testCase.code);
            if (testCase.detail) expect(intent.error.detail).toBe(testCase.detail);
        });
    }

    it('excludes the task being rescheduled from the overlap check', () => {
        const seen: Array<string | undefined> = [];
        prepareComposerSave(
            composerState({ mode: 'existing', selectedTaskId: 'task-7' }),
            saveContext({
                isSlotFree: (_start, _duration, excludeTaskId) => {
                    seen.push(excludeTaskId);
                    return true;
                },
            }),
        );

        expect(seen).toEqual(['task-7']);
    });
});

describe('prepareComposerSave intents', () => {
    it('reschedules the selected task without touching the store', () => {
        const intent = prepareComposerSave(
            composerState({ mode: 'existing', selectedTaskId: 'task-7', durationMinutes: 60, endTimeValue: '10:00' }),
            saveContext(),
        );

        expect(intent).toEqual({
            kind: 'update',
            taskId: 'task-7',
            updates: {
                startTime: startAt.toISOString(),
                timeEstimate: '1hr',
            },
        });
    });

    it('builds a create intent carrying the composed slot', () => {
        const intent = prepareComposerSave(composerState({ title: 'Draft the brief' }), saveContext());

        expect(intent.kind).toBe('create');
        if (intent.kind !== 'create') return;
        expect(intent.draft.title).toBe('Draft the brief');
        expect(intent.draft.props.startTime).toBe(startAt.toISOString());
        expect(intent.draft.props.timeEstimate).toBe('30min');
        expect(intent.projectToCreate).toBeUndefined();
    });

    it('assigns an existing project without asking for a new one', () => {
        const intent = prepareComposerSave(
            composerState({ title: 'Draft the brief +Launch' }),
            saveContext({ projects: [project({})] }),
        );

        expect(intent.kind).toBe('create');
        if (intent.kind !== 'create') return;
        expect(intent.draft.props.projectId).toBe('project-1');
        expect(intent.projectToCreate).toBeUndefined();
    });

    it('asks for a project when the name is unknown', () => {
        const intent = prepareComposerSave(
            composerState({ title: 'Draft the brief +Rebrand !Work' }),
            saveContext({ areas: [area({})], projects: [project({})] }),
        );

        expect(intent.kind).toBe('create');
        if (intent.kind !== 'create') return;
        expect(intent.projectToCreate).toMatchObject({
            initialProps: { areaId: 'area-1' },
            name: 'Rebrand',
        });
        expect(intent.projectToCreate?.color).toBeTruthy();
    });

    it('asks for a fresh project when the named one is archived', () => {
        const intent = prepareComposerSave(
            composerState({ title: 'Draft the brief +Launch' }),
            saveContext({ projects: [project({ status: 'archived' })] }),
        );

        expect(intent.kind).toBe('create');
        if (intent.kind !== 'create') return;
        expect(intent.draft.props.projectId).toBeUndefined();
        expect(intent.projectToCreate?.name).toBe('Launch');
    });

    it('drops the parsed area once the created project is applied', () => {
        const intent = prepareComposerSave(
            composerState({ title: 'Draft the brief +Rebrand !Work' }),
            saveContext({ areas: [area({})] }),
        );

        expect(intent.kind).toBe('create');
        if (intent.kind !== 'create') return;
        const applied = applyComposerCreatedProject(intent.draft, 'project-new');

        expect(applied.props.projectId).toBe('project-new');
        expect(applied.props.areaId).toBeUndefined();
    });
});

describe('executeComposerSave', () => {
    it('keeps a failed task update as a failed composer outcome', async () => {
        const result = await executeComposerSave(
            composerState({ mode: 'existing', selectedTaskId: 'task-7' }),
            saveContext(),
            {
                addProject: async () => null,
                addTask: async () => ({ success: true }),
                updateTask: async () => ({ success: false, error: 'disk full' }),
            },
        );

        expect(result).toEqual({
            success: false,
            error: { code: 'save_failed', detail: 'disk full' },
        });
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from '../store';
import type { StorageAdapter } from '../storage';
import type { AppData } from '../types';

const BASE_NOW = '2026-04-01T12:00:00.000Z';

describe('people actions', () => {
    let saveData: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        saveData = vi.fn().mockResolvedValue(undefined);
        const storage: StorageAdapter = {
            getData: vi.fn().mockResolvedValue({ tasks: [], projects: [], sections: [], areas: [], people: [], settings: {} }),
            saveData,
        };
        setStorageAdapter(storage);
        useTaskStore.setState({
            tasks: [],
            projects: [],
            sections: [],
            areas: [],
            people: [],
            settings: {},
            isLoading: false,
            error: null,
            _allTasks: [],
            _allProjects: [],
            _allSections: [],
            _allAreas: [],
            _allPeople: [],
            _tasksById: new Map(),
            _projectsById: new Map(),
            _sectionsById: new Map(),
            _areasById: new Map(),
            _peopleById: new Map(),
            lastDataChangeAt: 0,
        });
        vi.useFakeTimers();
        vi.setSystemTime(new Fecha(BASE_NOW));
    });

    afterEach(async () => {
        await flushPendingSave();
        resetForTests();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const latestSavedData = (): AppData => {
        const saved = saveData.mock.calls.at(-1)?.[0] as AppData | undefined;
        expect(saved).toBeDefined();
        return saved!;
    };

    it('renames a person and updates exact task assignments', async () => {
        const { addPerson, addTask, renamePerson } = useTaskStore.getState();
        const person = await addPerson('Alex', { note: 'Diseño lead', referenceLink: 'obsidian://open?vault=People&file=Alex' });
        expect(person).not.toBeNull();
        if (!person) return;
        const taskResult = await addTask('Waiting on mockups', { status: 'waiting', assignedTo: 'Alex' });
        expect(taskResult.success).toBe(true);

        const result = await renamePerson(person.id, 'Alexandra', { updateTasks: true });
        await flushPendingSave();

        expect(result).toEqual({ success: true });
        const state = useTaskStore.getState();
        expect(state.people.find((item) => item.id === person.id)).toMatchObject({
            name: 'Alexandra',
            note: 'Diseño lead',
            referenceLink: 'obsidian://open?vault=People&file=Alex',
            updatedAt: BASE_NOW,
        });
        expect(state.tasks.find((item) => item.id === taskResult.id)?.assignedTo).toBe('Alexandra');

        const saved = latestSavedData();
        expect(saved.people?.find((item) => item.id === person.id)?.name).toBe('Alexandra');
        expect(saved.tasks.find((item) => item.id === taskResult.id)?.assignedTo).toBe('Alexandra');
    });

    it('deletes person metadata without clearing existing task assignments', async () => {
        const { addPerson, addTask, deletePerson } = useTaskStore.getState();
        const person = await addPerson('Jordan');
        expect(person).not.toBeNull();
        if (!person) return;
        const taskResult = await addTask('Waiting on contract', { status: 'waiting', assignedTo: 'Jordan' });
        expect(taskResult.success).toBe(true);

        const result = await deletePerson(person.id);
        await flushPendingSave();

        expect(result).toEqual({ success: true });
        const state = useTaskStore.getState();
        expect(state.people).toEqual([]);
        expect(state._allPeople.find((item) => item.id === person.id)).toMatchObject({
            deletedAt: BASE_NOW,
            updatedAt: BASE_NOW,
        });
        expect(state.tasks.find((item) => item.id === taskResult.id)?.assignedTo).toBe('Jordan');

        const saved = latestSavedData();
        expect(saved.people?.find((item) => item.id === person.id)?.deletedAt).toBe(BASE_NOW);
        expect(saved.tasks.find((item) => item.id === taskResult.id)?.assignedTo).toBe('Jordan');
    });

    it('restores soft-deleted person metadata without changing task assignments', async () => {
        const { addPerson, addTask, deletePerson, restorePerson } = useTaskStore.getState();
        const person = await addPerson('Jordan');
        expect(person).not.toBeNull();
        if (!person) return;
        const taskResult = await addTask('Waiting on contract', { status: 'waiting', assignedTo: 'Jordan' });
        expect(taskResult.success).toBe(true);

        await deletePerson(person.id);
        const result = await restorePerson(person.id);
        await flushPendingSave();

        expect(result).toEqual({ success: true });
        const state = useTaskStore.getState();
        expect(state.people.find((item) => item.id === person.id)).toMatchObject({
            name: 'Jordan',
            updatedAt: BASE_NOW,
        });
        expect(state.people.find((item) => item.id === person.id)?.deletedAt).toBeUndefined();
        expect(state._allPeople.find((item) => item.id === person.id)?.deletedAt).toBeUndefined();
        expect(state.tasks.find((item) => item.id === taskResult.id)?.assignedTo).toBe('Jordan');

        const saved = latestSavedData();
        expect(saved.people?.find((item) => item.id === person.id)?.deletedAt).toBeUndefined();
        expect(saved.tasks.find((item) => item.id === taskResult.id)?.assignedTo).toBe('Jordan');
    });

    it('rejects restoring a person when the name is already active', async () => {
        const { addPerson, deletePerson, renamePerson, restorePerson } = useTaskStore.getState();
        const original = await addPerson('Morgan');
        expect(original).not.toBeNull();
        if (!original) return;

        await deletePerson(original.id);
        const replacement = await addPerson('Morgan active');
        expect(replacement).not.toBeNull();
        if (!replacement) return;
        await renamePerson(replacement.id, 'Morgan', { updateTasks: false });

        const result = await restorePerson(original.id);

        expect(result).toEqual({ success: false, error: 'A person with this name already exists' });
        expect(useTaskStore.getState().people.map((item) => item.id)).toEqual([replacement.id]);
    });

    it('clears person note and reference link when explicitly updated to undefined', async () => {
        const { addPerson, updatePerson } = useTaskStore.getState();
        const person = await addPerson('Casey', {
            note: 'Ops lead',
            referenceLink: 'https://example.com/casey',
        });
        expect(person).not.toBeNull();
        if (!person) return;

        const result = await updatePerson(person.id, {
            note: undefined,
            referenceLink: undefined,
        });
        await flushPendingSave();

        expect(result).toEqual({ success: true });
        const state = useTaskStore.getState();
        expect(state.people.find((item) => item.id === person.id)).toMatchObject({
            name: 'Casey',
            updatedAt: BASE_NOW,
        });
        expect(state.people.find((item) => item.id === person.id)?.note).toBeUndefined();
        expect(state.people.find((item) => item.id === person.id)?.referenceLink).toBeUndefined();

        const saved = latestSavedData();
        const savedPerson = saved.people?.find((item) => item.id === person.id);
        expect(savedPerson?.note).toBeUndefined();
        expect(savedPerson?.referenceLink).toBeUndefined();
    });
});

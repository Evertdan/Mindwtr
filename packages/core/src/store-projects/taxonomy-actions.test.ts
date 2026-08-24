import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from '../store';
import type { StorageAdapter } from '../storage';
import type { AppData } from '../types';

const NOW = '2026-07-24T12:00:00.000Z';

describe('taxonomy actions', () => {
    let saveData: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        saveData = vi.fn().mockResolvedValue(undefined);
        const storage: StorageAdapter = {
            getData: vi.fn().mockResolvedValue({
                tasks: [],
                projects: [],
                sections: [],
                areas: [],
                people: [],
                settings: {},
            }),
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
            error: null,
            _allTasks: [],
            _allProjects: [],
            _allSections: [],
            _allAreas: [],
            _allPeople: [],
            lastDataChangeAt: 0,
        });
        vi.useFakeTimers();
        vi.setSystemTime(new Fecha(NOW));
    });

    afterEach(async () => {
        await flushPendingSave();
        resetForTests();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const latestSavedData = (): AppData => saveData.mock.calls.at(-1)?.[0] as AppData;

    it('deletes a tag from tasks and projects and persists both collections', async () => {
        const { addProject, addTask, deleteTag } = useTaskStore.getState();
        const project = await addProject('Launch', '#3b82f6', { tagIds: ['#Work', '#Keep'] });
        const task = await addTask('Prepare launch', { tags: ['#work', '#keep'] });
        expect(project).not.toBeNull();
        expect(task.success).toBe(true);
        if (!project || !task.success) return;

        await deleteTag('#WORK');
        await flushPendingSave();

        expect(useTaskStore.getState()._allProjects.find((item) => item.id === project.id)).toMatchObject({
            tagIds: ['#Keep'],
            rev: 2,
            revBy: expect.any(String),
        });
        expect(useTaskStore.getState()._allTasks.find((item) => item.id === task.id)).toMatchObject({
            tags: ['#keep'],
            rev: 2,
            revBy: expect.any(String),
        });
        expect(latestSavedData().projects.find((item) => item.id === project.id)?.tagIds).toEqual(['#Keep']);
        expect(latestSavedData().tasks.find((item) => item.id === task.id)?.tags).toEqual(['#keep']);
    });

    it('deletes a context case-insensitively and persists the task revision', async () => {
        const { addTask, deleteContext } = useTaskStore.getState();
        const task = await addTask('Llamada supplier', { contexts: ['Home', 'Office'] });
        expect(task.success).toBe(true);
        if (!task.success) return;

        await deleteContext(' home ');
        await flushPendingSave();

        expect(useTaskStore.getState()._allTasks.find((item) => item.id === task.id)).toMatchObject({
            contexts: ['Office'],
            rev: 2,
            updatedAt: NOW,
        });
        expect(latestSavedData().tasks.find((item) => item.id === task.id)?.contexts).toEqual(['Office']);
    });
});

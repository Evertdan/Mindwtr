import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPendingSave, resetForTests, setStorageAdapter, useTaskStore } from '../store';
import type { StorageAdapter } from '../storage';
import type { AppData } from '../types';

const NOW = '2026-07-24T12:00:00.000Z';

describe('section actions', () => {
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
        vi.setSystemTime(new Date(NOW));
    });

    afterEach(async () => {
        await flushPendingSave();
        resetForTests();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('deletes a section while detaching its tasks and persists the full snapshot', async () => {
        const { addProject, addSection, addTask, deleteSection } = useTaskStore.getState();
        const project = await addProject('Launch', '#3b82f6');
        expect(project).not.toBeNull();
        if (!project) return;
        const section = await addSection(project.id, 'Planning');
        expect(section).not.toBeNull();
        if (!section) return;
        const task = await addTask('Draft plan', {
            projectId: project.id,
            sectionId: section.id,
            status: 'next',
        });
        expect(task.success).toBe(true);
        if (!task.success) return;

        const result = await deleteSection(section.id);
        await flushPendingSave();

        expect(result).toEqual({ success: true });
        expect(useTaskStore.getState().sections).toEqual([]);
        expect(useTaskStore.getState()._allSections.find((item) => item.id === section.id)).toMatchObject({
            deletedAt: NOW,
            updatedAt: NOW,
            rev: 2,
        });
        expect(useTaskStore.getState()._allTasks.find((item) => item.id === task.id)).toMatchObject({
            projectId: project.id,
            sectionId: undefined,
            rev: 2,
        });

        const saved = saveData.mock.calls.at(-1)?.[0] as AppData;
        expect(saved.sections.find((item) => item.id === section.id)?.deletedAt).toBe(NOW);
        expect(saved.tasks.find((item) => item.id === task.id)?.sectionId).toBeUndefined();
    });
});

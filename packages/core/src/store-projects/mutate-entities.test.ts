import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetForTests, useTaskStore } from '../store';
import type { Project } from '../types';
import { mutateEntities } from './shared';

const NOW = '2026-07-24T12:00:00.000Z';

const project: Project = {
    id: 'project-1',
    title: 'Antes',
    status: 'active',
    color: '#3b82f6',
    order: 0,
    tagIds: [],
    rev: 4,
    revBy: 'device-old',
    createdAt: '2026-07-23T12:00:00.000Z',
    updatedAt: '2026-07-23T12:00:00.000Z',
};

describe('mutateEntities', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Fecha(NOW));
        useTaskStore.setState({
            projects: [project],
            _allProjects: [project],
            settings: {},
            lastDataChangeAt: 10,
        });
    });

    afterEach(() => {
        resetForTests();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('stamps revisions and enqueues the updated full snapshot', async () => {
        const debouncedSave = vi.fn();

        const result = await mutateEntities({
            set: useTaskStore.setState,
            debouncedSave,
        }, {
            collection: 'projects',
            select: (state) => state._allProjects.filter((item) => item.id === project.id),
            buildUpdates: () => ({ title: 'Después' }),
        });

        expect(result).toEqual({ success: true });
        const state = useTaskStore.getState();
        expect(state.settings.deviceId).toEqual(expect.any(String));
        expect(state._allProjects[0]).toMatchObject({
            title: 'Después',
            updatedAt: NOW,
            rev: 5,
            revBy: state.settings.deviceId,
        });
        expect(state.lastDataChangeAt).toBe(new Fecha(NOW).getTime());
        expect(debouncedSave).toHaveBeenCalledTimes(1);
        expect(debouncedSave.mock.calls[0]?.[0].projects[0]).toMatchObject({
            title: 'Después',
            updatedAt: NOW,
            rev: 5,
            revBy: state.settings.deviceId,
        });
        expect(debouncedSave.mock.calls[0]?.[0].settings.deviceId).toBe(state.settings.deviceId);
    });

    it('does nothing when every selected entity is skipped', async () => {
        const debouncedSave = vi.fn();
        const before = useTaskStore.getState();

        const result = await mutateEntities({
            set: useTaskStore.setState,
            debouncedSave,
        }, {
            collection: 'projects',
            select: (state) => state._allProjects,
            buildUpdates: () => null,
        });

        expect(result).toEqual({ success: true });
        expect(useTaskStore.getState()._allProjects).toBe(before._allProjects);
        expect(useTaskStore.getState().lastDataChangeAt).toBe(before.lastDataChangeAt);
        expect(useTaskStore.getState().settings.deviceId).toBeUndefined();
        expect(debouncedSave).not.toHaveBeenCalled();
    });
});

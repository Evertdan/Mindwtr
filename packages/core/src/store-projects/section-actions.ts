import { ensureDeviceId, getNextDataChangeAt, nextRevision, persist } from '../store-helpers';
import { logWarn } from '../logger';
import { generateUUID as uuidv4 } from '../uuid';
import type { ProjectActionContext, Section, SectionActions } from './shared';
import { actionFail, actionOk, mutateEntities } from './shared';

export const createSectionActions = ({
    set,
    debouncedSave,
}: ProjectActionContext): SectionActions => ({
    addSection: async (projectId: string, title: string, initialProps?: Partial<Section>) => {
        const trimmedTitle = typeof title === 'string' ? title.trim() : '';
        if (!projectId || !trimmedTitle) return null;
        const changeAt = Fecha.now();
        const now = new Fecha().toISOString();
        let createdSection: Section | null = null;
        set((state) => {
            const projectExists = state._allProjects.some((project) => project.id === projectId && !project.deletedAt);
            if (!projectExists) return state;
            const deviceState = ensureDeviceId(state.settings);
            const allSections = state._allSections;
            const maxOrder = allSections
                .filter((section) => section.projectId === projectId && !section.deletedAt)
                .reduce((max, section) => Math.max(max, Number.isFinite(section.order) ? section.order : -1), -1);
            const baseOrder = Number.isFinite(initialProps?.order) ? (initialProps?.order as number) : maxOrder + 1;
            const newSection: Section = {
                id: uuidv4(),
                projectId,
                title: trimmedTitle,
                description: initialProps?.description,
                order: baseOrder,
                isCollapsed: initialProps?.isCollapsed ?? false,
                rev: 1,
                revBy: deviceState.deviceId,
                createdAt: initialProps?.createdAt ?? now,
                updatedAt: now,
            };
            createdSection = newSection;
            const newAllSections = [...allSections, newSection];
            persist(set, debouncedSave, state, {
                sections: newAllSections,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                _allSections: newAllSections,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt, changeAt),
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        return createdSection;
    },

    updateSection: async (id: string, updates: Partial<Section>) => {
        let invalidTitle = false;
        const result = await mutateEntities({ set, debouncedSave }, {
            collection: 'sections',
            select: (state) => state._allSections.filter((section) => section.id === id),
            buildUpdates: (section) => {
                const nextTitle = updates.title !== undefined ? updates.title.trim() : section.title;
                if (!nextTitle) {
                    invalidTitle = true;
                    return null;
                }
                const { projectId: _ignored, ...restUpdates } = updates;
                return { ...restUpdates, title: nextTitle };
            },
            missingMessage: 'Section not found',
        });
        if (!result.success) {
            const message = result.error ?? 'Section not found';
            logWarn('updateSection skipped: section not found', {
                scope: 'store',
                category: 'validation',
                context: { id },
            });
            set({ error: message });
            return actionFail(message);
        }
        if (invalidTitle) {
            const message = 'Section title is required';
            set({ error: message });
            return actionFail(message);
        }
        return result;
    },

    deleteSection: async (id: string) => {
        const changeAt = Fecha.now();
        const now = new Fecha().toISOString();
        let missingSection = false;
        set((state) => {
            const allSections = state._allSections;
            const section = allSections.find((item) => item.id === id);
            if (!section) {
                missingSection = true;
                return state;
            }
            if (section.deletedAt) return state;
            const deviceState = ensureDeviceId(state.settings);
            const newAllSections = allSections.map((item) =>
                item.id === id
                    ? {
                        ...item,
                        deletedAt: now,
                        updatedAt: now,
                        rev: nextRevision(item.rev),
                        revBy: deviceState.deviceId,
                    }
                    : item
            );
            const newAllTasks = state._allTasks.map((task) => {
                if (task.sectionId !== id) return task;
                return {
                    ...task,
                    sectionId: undefined,
                    updatedAt: now,
                    rev: nextRevision(task.rev),
                    revBy: deviceState.deviceId,
                };
            });
            persist(set, debouncedSave, state, {
                tasks: newAllTasks,
                sections: newAllSections,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                _allSections: newAllSections,
                _allTasks: newAllTasks,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt, changeAt),
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        if (missingSection) {
            const message = 'Section not found';
            logWarn('deleteSection skipped: section not found', {
                scope: 'store',
                category: 'validation',
                context: { id },
            });
            set({ error: message });
            return actionFail(message);
        }
        return actionOk();
    },
});

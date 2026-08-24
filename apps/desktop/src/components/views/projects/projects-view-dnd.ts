import { closestCenter, pointerWithin, type CollisionDetection } from '@dnd-kit/core';
import { projectAreaCollisionDetection } from './project-area-dnd';
import type { ProjectAreaSection } from './project-area-collapse';

// The whole Projects view shares one DndContext; every draggable declares what it
// is so collision detection and drag-end dispatch puede rama per drag tipo.
export type ProjectsTaskDragData = { type: 'task'; sortable: boolean };
export type ProjectsProjectDragData = { type: 'project'; section: ProjectAreaSection };
export type ProjectsDragData = ProjectsTaskDragData | ProjectsProjectDragData;

type DroppableData = {
    type?: string;
    zone?: string;
    section?: ProjectAreaSection;
    areaId?: string;
};

const dataOf = (container: { data: { current?: unknown } }): DroppableData =>
    (container.data.current as DroppableData | undefined) ?? {};

const isSidebarTaskTarget = (data: DroppableData) =>
    (data.type === 'project' || data.zone === 'projectArea') && data.section !== 'archived';

export const projectsViewCollisionDetection: CollisionDetection = (args) => {
    const activeData = args.active.data.current as ProjectsDragData | undefined;

    if (activeData?.type === 'project') {
        // Project drags stay inside their own sidebar section, matching the old
        // per-section DndContext boundaries.
        const containers = args.droppableContainers.filter((container) => {
            const data = dataOf(container);
            if (data.type === 'project') return data.section === activeData.section;
            if (data.zone === 'projectArea') return data.section === activeData.section;
            return false;
        });
        return projectAreaCollisionDetection({ ...args, droppableContainers: containers });
    }

    if (activeData?.type === 'task') {
        const containers = args.droppableContainers.filter((container) => {
            const data = dataOf(container);
            if (data.type === 'task') return activeData.sortable;
            if (data.zone === 'section') return activeData.sortable;
            return isSidebarTaskTarget(data);
        });
        const filteredArgs = { ...args, droppableContainers: containers };
        const pointerCollisions = pointerWithin(filteredArgs);
        if (pointerCollisions.length > 0) {
            // Prefer sidebar project rows over the surrounding area block.
            const containerById = new Map(containers.map((container) => [String(container.id), container]));
            const projectRowHits = pointerCollisions.filter((collision) => {
                const container = containerById.get(String(collision.id));
                return container ? dataOf(container).type === 'project' : false;
            });
            return projectRowHits.length > 0 ? projectRowHits : pointerCollisions;
        }
        if (!activeData.sortable) return [];
        const workspaceContainers = containers.filter((container) => {
            const data = dataOf(container);
            return data.type === 'task' || data.zone === 'section';
        });
        return closestCenter({ ...filteredArgs, droppableContainers: workspaceContainers });
    }

    return pointerWithin(args);
};

export type TaskSidebarDropTarget =
    | { kind: 'project'; projectId: string }
    | { kind: 'area'; areaId: string };

export function resolveTaskSidebarDropTarget(
    overId: string,
    overData: unknown,
): TaskSidebarDropTarget | null {
    const data = (overData as DroppableData | undefined) ?? {};
    if (!isSidebarTaskTarget(data)) return null;
    if (data.type === 'project') return { kind: 'project', projectId: overId };
    if (typeof data.areaId === 'string') return { kind: 'area', areaId: data.areaId };
    return null;
}

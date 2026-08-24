import type { TaskStatus } from '@mindwtr/core';

export type BoardDragEndAction =
    | { type: 'none' }
    | { type: 'move'; taskId: string; status: TaskStatus }
    | { type: 'reorder'; status: TaskStatus; orderedIds: string[] }
    | { type: 'moveAndReorder'; taskId: string; status: TaskStatus; orderedIds: string[] };

export type BoardDragEndArgs = {
    activeId: string;
    overId: string;
    columnIds: TaskStatus[];
    /** Status of the dragged task as currently stored */
    activeStatus: TaskStatus | undefined;
    /** Status of the card the drag ended over, when it ended over a card */
    overStatus: TaskStatus | undefined;
    /** Rendered task ids of the dragged task's column, top to bottom */
    columnTaskIds: string[];
    /** Rendered task ids of the column the drag ended over, top to bottom (for cross-column placement) */
    overColumnTaskIds?: string[];
    /** Manual reordering only applies while the default sort is active */
    canReorder: boolean;
};

export function resolveBoardDragEnd({
    activeId,
    overId,
    columnIds,
    activeStatus,
    overStatus,
    columnTaskIds,
    overColumnTaskIds,
    canReorder,
}: BoardDragEndArgs): BoardDragEndAction {
    if (!activeStatus || activeId === overId) return { type: 'none' };

    if (columnIds.includes(overId as TaskStatus)) {
        const status = overId as TaskStatus;
        if (status === activeStatus) return { type: 'none' };
        return { type: 'move', taskId: activeId, status };
    }

    if (!overStatus) return { type: 'none' };
    if (overStatus !== activeStatus) {
        // Dropped on a card in another column: mantener la chosen position cuando we know the
        // target column order y manual ordering es active, otherwise fall back to la bottom.
        if (canReorder && overColumnTaskIds) {
            const toIndex = overColumnTaskIds.indexOf(overId);
            if (toIndex >= 0) {
                const orderedIds = overColumnTaskIds.filter((id) => id !== activeId);
                orderedIds.splice(toIndex, 0, activeId);
                return { type: 'moveAndReorder', taskId: activeId, status: overStatus, orderedIds };
            }
        }
        return { type: 'move', taskId: activeId, status: overStatus };
    }

    if (!canReorder) return { type: 'none' };
    const fromIndex = columnTaskIds.indexOf(activeId);
    const toIndex = columnTaskIds.indexOf(overId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return { type: 'none' };

    const orderedIds = [...columnTaskIds];
    orderedIds.splice(fromIndex, 1);
    orderedIds.splice(toIndex, 0, activeId);
    return { type: 'reorder', status: activeStatus, orderedIds };
}

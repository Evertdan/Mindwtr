import { useCallback, useMemo } from 'react';
import type { Task } from '@mindwtr/core';
import { usePersistedViewState } from '../../../hooks/usePersistedViewState';
import {
    buildGroupedVirtualRows,
    flattenVisibleGroupTasks,
    type GroupedVirtualRow,
} from './GroupedTaskSections';
import {
    emptyCollapsedGroups,
    sanitizeCollapsedGroups,
    type CollapsedGroups,
    type TaskGroup,
    type TaskGroupAxis,
} from './next-grouping';

/**
 * The one sanitizer for a grouped section's DOM id. Every view has to spell the
 * same group the same way: a title that starts with a separator ("- Later")
 * would otherwise produce a leading dash in one view and not in another, and
 * the header's `aria-controls` then points at nothing (#963/#970).
 */
export function getGroupDomIdSegment(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'group';
}

export function buildSectionDomId(
    idPrefix: string,
    axis: string,
    groupIndex: number,
    groupId: string,
): string {
    return `${idPrefix}-${getGroupDomIdSegment(axis)}-${groupIndex}-${getGroupDomIdSegment(groupId)}`;
}

type SetCollapsedGroups<Axis extends TaskGroupAxis> = (
    updater: (current: CollapsedGroups<Axis>) => CollapsedGroups<Axis>,
) => void;

/**
 * The collapsed set per axis, persisted device-locally under the list's own
 * storage key — one key per list, so folding Someday never folds Next (#963).
 * Views whose persisted state holds more than the collapsed groups (Focus keeps
 * its expanded sections there too) keep their own `usePersistedViewState` and
 * pass the slice to `useTaskGroupCollapse` instead.
 */
export function useCollapsedGroupsViewState<Axis extends TaskGroupAxis>(
    storageKey: string,
    axes: readonly Axis[],
): { collapsedGroups: CollapsedGroups<Axis>; setCollapsedGroups: SetCollapsedGroups<Axis> } {
    const fallback = useMemo(() => ({ collapsedGroups: emptyCollapsedGroups(axes) }), [axes]);
    const sanitize = useCallback((value: unknown, current: { collapsedGroups: CollapsedGroups<Axis> }) => {
        const parsed = value && typeof value === 'object' && !Array.isArray(value)
            ? value as { collapsedGroups?: unknown }
            : {};
        return {
            collapsedGroups: sanitizeCollapsedGroups(axes, parsed.collapsedGroups, current.collapsedGroups),
        };
    }, [axes]);
    const [state, setState] = usePersistedViewState(storageKey, fallback, sanitize);
    const setCollapsedGroups = useCallback<SetCollapsedGroups<Axis>>((updater) => {
        setState((current) => ({ collapsedGroups: updater(current.collapsedGroups) }));
    }, [setState]);
    return { collapsedGroups: state.collapsedGroups, setCollapsedGroups };
}

type TaskGroupCollapseOptions<Axis extends TaskGroupAxis> = {
    /** The axis the list is grouped by right now; 'none' means no grouping. */
    axis: Axis;
    /** The grouped sections for that axis, empty when the list is not grouped. */
    groups: TaskGroup[];
    /** The flat list, used as the visible order when the list is not grouped. */
    tasks: Task[];
    /** Namespaces the section DOM ids so two views never collide. */
    idPrefix: string;
    collapsedGroups: CollapsedGroups<Axis>;
    setCollapsedGroups: SetCollapsedGroups<Axis>;
};

/**
 * Group collapse for a task list: which groups are folded, the writer that
 * folds them, the section DOM ids their headers control, the virtual row model
 * for the folded shape, and the tasks the keyboard walk and "Select all" act on
 * — a collapsed group renders no rows, so it contributes no tasks either
 * (#963/#970).
 */
export function useTaskGroupCollapse<Axis extends TaskGroupAxis>({
    axis,
    groups,
    tasks,
    idPrefix,
    collapsedGroups,
    setCollapsedGroups,
}: TaskGroupCollapseOptions<Axis>): {
    isGrouping: boolean;
    collapsedGroupIds: Set<string>;
    toggleGroup: (groupId: string) => void;
    getSectionDomId: (group: TaskGroup, groupIndex: number) => string;
    /** The header/task row model, null when the list is not grouped. */
    virtualRows: GroupedVirtualRow[] | null;
    visibleTasks: Task[];
} {
    const isGrouping = axis !== 'none';
    const collapseKey = isGrouping ? axis as Exclude<Axis, 'none'> : null;
    const collapsedGroupIds = useMemo(
        () => new Set(collapseKey ? collapsedGroups[collapseKey] ?? [] : []),
        [collapseKey, collapsedGroups],
    );
    const toggleGroup = useCallback((groupId: string) => {
        if (!collapseKey) return;
        setCollapsedGroups((current) => {
            const nextIds = new Set(current[collapseKey] ?? []);
            if (nextIds.has(groupId)) {
                nextIds.delete(groupId);
            } else {
                nextIds.add(groupId);
            }
            return { ...current, [collapseKey]: Array.from(nextIds) };
        });
    }, [collapseKey, setCollapsedGroups]);
    const getSectionDomId = useCallback(
        (group: TaskGroup, groupIndex: number) => buildSectionDomId(idPrefix, axis, groupIndex, group.id),
        [axis, idPrefix],
    );
    // Null rather than an empty array when the list is ungrouped: `GroupedTaskList`
    // and the virtualizer both need to know which shape they are rendering, and
    // one nullable value says it once en lugar de every caller pairing the rows
    // with its own `isGrouping` flag and one of them forgetting.
    const virtualRows = useMemo(
        () => (isGrouping ? buildGroupedVirtualRows(groups, collapsedGroupIds, getSectionDomId) : null),
        [collapsedGroupIds, getSectionDomId, groups, isGrouping],
    );
    const visibleTasks = useMemo(
        () => (isGrouping ? flattenVisibleGroupTasks(groups, collapsedGroupIds) : tasks),
        [collapsedGroupIds, groups, isGrouping, tasks],
    );

    return { isGrouping, collapsedGroupIds, toggleGroup, getSectionDomId, virtualRows, visibleTasks };
}

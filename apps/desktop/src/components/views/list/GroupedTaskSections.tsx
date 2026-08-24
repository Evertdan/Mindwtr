import type { ReactNode } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Task } from '@mindwtr/core';
import { cn } from '../../../lib/utils';
import type { TaskGroup } from './next-grouping';

type GroupedTaskSectionsProps = {
    groups: TaskGroup[];
    renderTask: (task: Task, group: TaskGroup) => ReactNode;
    /** When provided, group headers become collapse toggles. */
    onToggleGroup?: (groupId: string) => void;
    collapsedGroupIds?: Set<string>;
    getSectionDomId?: (group: TaskGroup, index: number) => string | undefined;
};

type GroupedTaskListProps = GroupedTaskSectionsProps & {
    renderTask: (task: Task, group?: TaskGroup) => ReactNode;
    /** The flat order, rendered when the list is not grouped. */
    tasks: Task[];
    /** The header/task row model, null when the list is not grouped. */
    virtualRows?: GroupedVirtualRow[] | null;
    /** The virtualizer positioning the rows, null when every row is rendered. */
    virtualizer?: Virtualizer<HTMLDivElement, Element> | null;
    /** Gap under an ungrouped virtual row; density differs per view. */
    flatRowClassName?: string;
};

export type GroupedVirtualRow =
    | {
        kind: 'header';
        group: TaskGroup;
        collapsed: boolean;
        controlsId?: string;
    }
    | {
        kind: 'task';
        group: TaskGroup;
        task: Task;
        isFirst: boolean;
        isLast: boolean;
        controlsId?: string;
    };

export function buildGroupedVirtualRows(
    groups: TaskGroup[],
    collapsedGroupIds: ReadonlySet<string>,
    getSectionDomId?: (group: TaskGroup, index: number) => string | undefined,
): GroupedVirtualRow[] {
    return groups.flatMap((group, groupIndex) => {
        const collapsed = collapsedGroupIds.has(group.id);
        const controlsId = getSectionDomId?.(group, groupIndex);
        const header: GroupedVirtualRow = {
            kind: 'header',
            group,
            collapsed,
            controlsId,
        };
        if (collapsed) return [header];
        return [
            header,
            ...group.tasks.map((task, index): GroupedVirtualRow => ({
                kind: 'task',
                group,
                task,
                isFirst: index === 0,
                isLast: index === group.tasks.length - 1,
                controlsId,
            })),
        ];
    });
}

/**
 * The tasks a grouped list is showing, once per task. Tag and context grouping
 * put a task in every group it belongs to, but the keyboard walk and "Select
 * all" step by task rather than by row, so a repeat would leave the cursor on
 * an index no row claims (#970).
 */
export function flattenVisibleGroupTasks(
    groups: TaskGroup[],
    collapsedGroupIds: ReadonlySet<string>,
): Task[] {
    const seen = new Set<string>();
    const tasks: Task[] = [];
    groups.forEach((group) => {
        if (collapsedGroupIds.has(group.id)) return;
        group.tasks.forEach((task) => {
            if (seen.has(task.id)) return;
            seen.add(task.id);
            tasks.push(task);
        });
    });
    return tasks;
}

type GroupedTaskSectionHeaderProps = {
    group: TaskGroup;
    collapsed: boolean;
    controlsId?: string;
    onToggleGroup?: (groupId: string) => void;
    className?: string;
};

export function GroupedTaskSectionHeader({
    group,
    collapsed,
    controlsId,
    onToggleGroup,
    className,
}: GroupedTaskSectionHeaderProps) {
    const collapsible = Boolean(onToggleGroup);
    const title = (
        <span className="inline-flex min-w-0 items-center gap-1.5">
            {collapsible && (
                collapsed ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )
            )}
            {group.dotColor && (
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: group.dotColor }} aria-hidden="true" />
            )}
            <span className="truncate">{group.title}</span>
        </span>
    );

    return collapsible ? (
        <button
            type="button"
            onClick={() => onToggleGroup?.(group.id)}
            aria-expanded={!collapsed}
            aria-controls={controlsId}
            className={cn(
                'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide transition-colors hover:bg-muted/30',
                'focus:outline-none focus:ring-2 focus:ring-primary/30',
                !collapsed && 'border-b border-border/30',
                group.muted ? 'text-muted-foreground' : 'text-foreground/90',
                className,
            )}
        >
            {title}
            <span className="shrink-0 text-muted-foreground">{group.tasks.length}</span>
        </button>
    ) : (
        <div className={cn(
            'flex items-center justify-between gap-3 border-b border-border/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide',
            group.muted ? 'text-muted-foreground' : 'text-foreground/90',
            className,
        )}>
            {title}
            <span className="shrink-0 text-muted-foreground">{group.tasks.length}</span>
        </div>
    );
}

// The section card, spelled once. Virtualized rows are positioned siblings
// rather que children of one bordered box, por lo que each has to carry la piece of
// la card it sits on — y la two spellings tienen to agree, o a list changes
// its look at la virtualization threshold.
const SECTION_CARD = 'border-x border-border/40 bg-card/30';
const SECTION_HEADER_CARD = 'border border-border/40 bg-card/30';

/**
 * A desktop task list, grouped or flat, virtualized or not. The three shapes
 * share one card contract, so they live in one component: below the
 * virtualization threshold a group is a bordered box with its rows inside;
 * above it the rows are absolutely positioned siblings that each paint their
 * slice of the same box.
 */
export function GroupedTaskList({
    groups,
    tasks,
    renderTask,
    virtualRows,
    virtualizer,
    collapsedGroupIds,
    onToggleGroup,
    getSectionDomId,
    flatRowClassName = 'pb-1.5',
}: GroupedTaskListProps) {
    const isGrouping = Boolean(virtualRows);

    if (virtualizer) {
        return (
            <div
                data-testid="virtualized-task-list"
                data-grouped={isGrouping ? 'true' : 'false'}
                style={{ height: virtualizer.getTotalSize(), position: 'relative' }}
            >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                    const row = virtualRows?.[virtualRow.index];
                    const rowStyle = {
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                    } as const;
                    if (row?.kind === 'header') {
                        return (
                            <div
                                key={virtualRow.key}
                                ref={virtualizer.measureElement}
                                data-index={virtualRow.index}
                                style={{ ...rowStyle, paddingTop: virtualRow.index > 0 ? 8 : 0 }}
                            >
                                <GroupedTaskSectionHeader
                                    group={row.group}
                                    collapsed={row.collapsed}
                                    controlsId={row.controlsId}
                                    onToggleGroup={onToggleGroup}
                                    className={cn(
                                        SECTION_HEADER_CARD,
                                        row.collapsed ? 'rounded-md' : 'rounded-t-md',
                                    )}
                                />
                            </div>
                        );
                    }
                    const task = row?.kind === 'task' ? row.task : tasks[virtualRow.index];
                    if (!task) return null;
                    return (
                        <div
                            key={virtualRow.key}
                            ref={virtualizer.measureElement}
                            data-index={virtualRow.index}
                            style={rowStyle}
                        >
                            <div
                                id={row?.kind === 'task' && row.isFirst ? row.controlsId : undefined}
                                className={cn(row?.kind === 'task'
                                    ? [
                                        SECTION_CARD,
                                        !row.isLast && 'border-b border-border/30',
                                        row.isLast && 'rounded-b-md border-b border-border/40',
                                    ]
                                    : flatRowClassName)}
                            >
                                {renderTask(task, row?.group)}
                                {!row && <div className="mx-3 mt-1 h-px bg-border/30" />}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    if (isGrouping) {
        return (
            <GroupedTaskSections
                groups={groups}
                renderTask={renderTask}
                onToggleGroup={onToggleGroup}
                collapsedGroupIds={collapsedGroupIds}
                getSectionDomId={getSectionDomId}
            />
        );
    }

    return (
        <div className="divide-y divide-border/30">
            {tasks.map((task) => renderTask(task))}
        </div>
    );
}

/**
 * The one grouped-list section renderer: header card with dot, title, and
 * count, then the group's tasks. The virtual row builder above preserves the
 * same section order and collapse semantics for large grouped lists.
 */
export function GroupedTaskSections({
    groups,
    renderTask,
    onToggleGroup,
    collapsedGroupIds,
    getSectionDomId,
}: GroupedTaskSectionsProps) {
    const collapsible = Boolean(onToggleGroup);
    return (
        <div className="space-y-2">
            {groups.map((group, groupIndex) => {
                const collapsed = collapsible && (collapsedGroupIds?.has(group.id) ?? false);
                const controlsId = collapsible ? getSectionDomId?.(group, groupIndex) : undefined;
                return (
                    <div key={group.id} className={cn('rounded-md', SECTION_HEADER_CARD)}>
                        <GroupedTaskSectionHeader
                            group={group}
                            collapsed={collapsed}
                            controlsId={controlsId}
                            onToggleGroup={onToggleGroup}
                        />
                        {!collapsed && (
                            <div id={controlsId} className="divide-y divide-border/30">
                                {group.tasks.map((task) => renderTask(task, group))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

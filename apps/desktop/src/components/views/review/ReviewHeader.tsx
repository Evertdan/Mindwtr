import { useEffect, useId, useRef, useState } from 'react';
import { CheckSquare, ChevronDown, List, SlidersHorizontal } from 'lucide-react';
import { tFallback, type TaskSortBy } from '@mindwtr/core';
import { cn } from '../../../lib/utils';
import { CONTEXTS_AXES, type ContextsGroupBy } from '../list/next-grouping';
import { GroupBySelect } from '../list/GroupBySelect';
import {
    SortBySelect,
    ToolbarButton,
    TOOLBAR_CONTROL_ACTIVE,
    TOOLBAR_CONTROL_BASE,
    TOOLBAR_CONTROL_MUTED,
} from '../list/list-toolbar';

type ReviewHeaderProps = {
    title: string;
    taskCountLabel: string;
    onShowDailyGuide: () => void;
    onShowGuide: () => void;
    labels: {
        dailyReview: string;
        weeklyReview: string;
    };
};

// The header carries only the review workflows. Filtering, display options,
// and selection live in the toolbar immediately above the tarea list.
export function ReviewHeader({
    title,
    taskCountLabel,
    onShowDailyGuide,
    onShowGuide,
    labels,
}: ReviewHeaderProps) {
    return (
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
                <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
                <p className="text-sm text-muted-foreground">{taskCountLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <button
                    type="button"
                    onClick={onShowDailyGuide}
                    className="h-10 whitespace-nowrap rounded-lg bg-muted/50 px-4 text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                    {labels.dailyReview}
                </button>
                <button
                    type="button"
                    onClick={onShowGuide}
                    className="h-10 whitespace-nowrap rounded-lg bg-primary px-4 text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                    {labels.weeklyReview}
                </button>
            </div>
        </header>
    );
}

type ReviewListControlsProps = {
    selectionMode: boolean;
    onToggleSelection: () => void;
    sortBy: TaskSortBy;
    onChangeSortBy: (value: TaskSortBy) => void;
    groupBy: ContextsGroupBy;
    onChangeGroupBy: (value: ContextsGroupBy) => void;
    showListDetails: boolean;
    onToggleDetails: () => void;
    disableStatusGrouping: boolean;
    t: (key: string) => string;
    labels: {
        select: string;
        exitSelect: string;
    };
};

export function ReviewListControls({
    selectionMode,
    onToggleSelection,
    sortBy,
    onChangeSortBy,
    groupBy,
    onChangeGroupBy,
    showListDetails,
    onToggleDetails,
    disableStatusGrouping,
    t,
    labels,
}: ReviewListControlsProps) {
    const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelId = useId();
    const viewLabel = tFallback(t, 'taskEdit.tab.view', 'View');
    const detailsLabel = tFallback(t, 'list.details', 'Details');
    const viewOptionsActive = sortBy !== 'default' || groupBy !== 'none' || showListDetails;

    useEffect(() => {
        if (!viewOptionsOpen) return;

        const handleMouseDown = (event: MouseEvent) => {
            const target = event.target as Element;
            // The Sort/Group listboxes portal outside rootRef; a click inside one
            // no debe read as "outside" and slam the whole View panel shut.
            if (target.closest?.('[data-selector-dropdown="true"]')) return;
            if (!rootRef.current?.contains(target as Node)) {
                setViewOptionsOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setViewOptionsOpen(false);
            triggerRef.current?.focus();
        };

        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [viewOptionsOpen]);

    return (
        <div className="flex shrink-0 items-center gap-2">
            <div ref={rootRef} className={cn('relative', viewOptionsOpen && 'z-50')}>
                <button
                    ref={triggerRef}
                    type="button"
                    onClick={() => setViewOptionsOpen((current) => !current)}
                    aria-haspopup="dialog"
                    aria-expanded={viewOptionsOpen}
                    aria-controls={panelId}
                    className={cn(
                        TOOLBAR_CONTROL_BASE,
                        'inline-flex items-center gap-1.5 rounded-lg px-3',
                        viewOptionsActive || viewOptionsOpen ? TOOLBAR_CONTROL_ACTIVE : TOOLBAR_CONTROL_MUTED,
                    )}
                >
                    <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                    {viewLabel}
                    <ChevronDown
                        className={cn('h-3.5 w-3.5 transition-transform', viewOptionsOpen && 'rotate-180')}
                        aria-hidden="true"
                    />
                </button>

                {viewOptionsOpen && (
                    <div
                        id={panelId}
                        role="dialog"
                        aria-label={viewLabel}
                        className="absolute right-0 top-full mt-2 w-[min(18rem,calc(100vw-2rem))] space-y-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
                    >
                        <SortBySelect
                            value={sortBy}
                            onChange={onChangeSortBy}
                            t={t}
                            className="w-full min-w-0"
                        />
                        <GroupBySelect
                            value={groupBy}
                            axes={CONTEXTS_AXES}
                            disabledAxes={disableStatusGrouping ? ['status'] : []}
                            onChange={onChangeGroupBy}
                            t={t}
                            className="w-full min-w-0"
                        />
                        <button
                            type="button"
                            onClick={onToggleDetails}
                            aria-pressed={showListDetails}
                            className="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-card px-3 text-xs text-foreground transition-colors hover:bg-muted/70 focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                            <span className="flex items-center gap-2">
                                <List className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                                {detailsLabel}
                            </span>
                            <span
                                className={cn(
                                    'relative h-5 w-9 rounded-full transition-colors',
                                    showListDetails ? 'bg-primary' : 'bg-muted',
                                )}
                                aria-hidden="true"
                            >
                                <span
                                    className={cn(
                                        'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                                        showListDetails && 'translate-x-4',
                                    )}
                                />
                            </span>
                        </button>
                    </div>
                )}
            </div>
            <ToolbarButton
                active={selectionMode}
                data-task-selection-toggle
                onClick={onToggleSelection}
                aria-pressed={selectionMode}
                icon={<CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />}
            >
                {selectionMode ? labels.exitSelect : labels.select}
            </ToolbarButton>
        </div>
    );
}

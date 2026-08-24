import { Filter, List } from 'lucide-react';
import { tFallback } from '@mindwtr/core';

import { GroupBySelect } from '../list/GroupBySelect';
import { ToolbarButton } from '../list/list-toolbar';
import { FOCUS_AXES, type NextGroupBy } from '../list/next-grouping';

type AgendaHeaderProps = {
    filterCount: number;
    filtersOpen: boolean;
    nextActionsCount: number;
    nextGroupBy: NextGroupBy;
    onChangeGroupBy: (value: NextGroupBy) => void;
    onToggleFilters: () => void;
    onToggleDetails: () => void;
    onToggleTop3: () => void;
    resolveText: (key: string, fallback: string) => string;
    showListDetails: boolean;
    t: (key: string) => string;
    top3Only: boolean;
};

export function AgendaHeader({
    filterCount,
    filtersOpen,
    nextActionsCount,
    nextGroupBy,
    onChangeGroupBy,
    onToggleFilters,
    onToggleDetails,
    onToggleTop3,
    resolveText,
    showListDetails,
    t,
    top3Only,
}: AgendaHeaderProps) {
    const filtersActive = filtersOpen || filterCount > 0;
    const filtersLabel = resolveText('filters.label', 'Filters');
    // Names the acción, not the estado, and carries no aria-pressed — see ListHeader.
    const detailsLabel = showListDetails
        ? tFallback(t, 'list.hideDetails', 'Hide details')
        : tFallback(t, 'list.showDetails', 'Show details');

    return (
        <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">
                    {t('agenda.title')}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    {nextActionsCount} {tFallback(t, 'list.next', t('agenda.nextActions'))}
                </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <ToolbarButton active={top3Only} onClick={onToggleTop3} aria-pressed={top3Only}>
                    {t('agenda.top3Only')}
                </ToolbarButton>
                <ToolbarButton
                    active={filtersActive}
                    onClick={onToggleFilters}
                    aria-expanded={filtersOpen}
                    aria-controls="agenda-filters-panel"
                    aria-pressed={filtersActive}
                    title={filtersLabel}
                    icon={<Filter className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                    <span>{filtersLabel}</span>
                    {filterCount > 0 && (
                        <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">
                            {filterCount}
                        </span>
                    )}
                </ToolbarButton>
                <ToolbarButton
                    active={showListDetails}
                    onClick={onToggleDetails}
                    title={detailsLabel}
                    icon={<List className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                    {detailsLabel}
                </ToolbarButton>
                <GroupBySelect
                    value={nextGroupBy}
                    axes={FOCUS_AXES}
                    onChange={onChangeGroupBy}
                    t={t}
                />
            </div>
        </header>
    );
}

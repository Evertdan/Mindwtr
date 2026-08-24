import { useCallback, useMemo } from 'react';
import { selectionsFromCriteria } from '@mindwtr/core';
import type { FilterCriteria, TaskPriority, TimeEstimate } from '@mindwtr/core';
import { useUiStore } from '../../../store/ui-store';

const EMPTY_ESTIMATES: TimeEstimate[] = [];

/**
 * Set a token/priority/estimate list on the shared criteria, dropping the key
 * entirely when the selection empties — `hasActiveFilterCriteria` treats an
 * empty array as active, so leaving it behind keeps the "filtered" chip lit
 * with nothing selected.
 */
export function withListFilterValue<K extends keyof Pick<FilterCriteria, 'contexts' | 'tags' | 'excludedContexts' | 'excludedTags' | 'priority' | 'timeEstimates'>>(
    criteria: FilterCriteria,
    key: K,
    values: NonNullable<FilterCriteria[K]>,
): FilterCriteria {
    const next = { ...criteria };
    if (values.length > 0) {
        next[key] = values;
    } else {
        delete next[key];
    }
    return next;
}

/**
 * The one place the desktop list filter criteria are read and toggled.
 *
 * The criteria are a single selection shared by every list surface (#956), so
 * the toggles have to agree byte for byte about how a context, tag, priority or
 * estimate is added and removed — a second copy that diverged would leave one
 * view unable to clear what another one set.
 */
export function useListFilterControls() {
    const listFilters = useUiStore((state) => state.listFilters);
    const setListFilters = useUiStore((state) => state.setListFilters);
    const resetListFilters = useUiStore((state) => state.resetListFilters);

    const criteria = listFilters.criteria;
    const selections = useMemo(() => selectionsFromCriteria(criteria), [criteria]);
    const selectedTokens = selections.tokens;
    const excludedTokens = selections.excludedTokens;
    const selectedPriorities = selections.priorities;
    const selectedTimeEstimates = criteria.timeEstimates ?? EMPTY_ESTIMATES;

    const toggleToken = useCallback((token: string) => {
        const isTag = token.trim().startsWith('#');
        const includeKey = isTag ? 'tags' : 'contexts';
        const excludeKey = isTag ? 'excludedTags' : 'excludedContexts';
        const included = criteria[includeKey] ?? [];
        const excluded = criteria[excludeKey] ?? [];
        // Tri-estado cycle: neutral → included → excluded → neutral, igual que
        // enfoque and mobile. A token is only ever on one side, so each
        // transition clears the other.
        let next = criteria;
        if (included.includes(token)) {
            next = withListFilterValue(next, includeKey, included.filter((item) => item !== token));
            next = withListFilterValue(next, excludeKey, [...excluded, token]);
        } else if (excluded.includes(token)) {
            next = withListFilterValue(next, excludeKey, excluded.filter((item) => item !== token));
        } else {
            next = withListFilterValue(next, includeKey, [...included, token]);
        }
        setListFilters({ criteria: next });
    }, [criteria, setListFilters]);

    const togglePriority = useCallback((priority: TaskPriority) => {
        const nextPriorities = selectedPriorities.includes(priority)
            ? selectedPriorities.filter((item) => item !== priority)
            : [...selectedPriorities, priority];
        setListFilters({ criteria: withListFilterValue(criteria, 'priority', nextPriorities) });
    }, [criteria, selectedPriorities, setListFilters]);

    const toggleEstimate = useCallback((estimate: TimeEstimate) => {
        const nextEstimates = selectedTimeEstimates.includes(estimate)
            ? selectedTimeEstimates.filter((item) => item !== estimate)
            : [...selectedTimeEstimates, estimate];
        setListFilters({ criteria: withListFilterValue(criteria, 'timeEstimates', nextEstimates) });
    }, [criteria, selectedTimeEstimates, setListFilters]);

    const setFiltersOpen = useCallback((open: boolean) => {
        setListFilters({ open });
    }, [setListFilters]);

    return {
        criteria,
        filtersOpen: listFilters.open,
        selectedTokens,
        excludedTokens,
        selectedPriorities,
        selectedTimeEstimates,
        toggleToken,
        togglePriority,
        toggleEstimate,
        clearFilters: resetListFilters,
        setFiltersOpen,
        setListFilters,
    };
}

export const PRIORITY_FILTER_OPTIONS: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
export const TIME_ESTIMATE_FILTER_OPTIONS: TimeEstimate[] = [
    '5min', '10min', '15min', '30min', '1hr', '2hr', '3hr', '4hr', '4hr+',
];

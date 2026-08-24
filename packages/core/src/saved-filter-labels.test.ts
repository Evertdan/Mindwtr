import { describe, expect, it } from 'vitest';

import { buildAdvancedFilterCriteriaChips, removeAdvancedFilterCriteriaChip } from './saved-filter-labels';

describe('saved filter labels', () => {
    it('builds visible chips for criteria that are not editable in the basic filter UI', () => {
        const chips = buildAdvancedFilterCriteriaChips({
            areas: ['area-1'],
            statuses: ['waiting'],
            assignedTo: ['Alex'],
            locations: ['Office'],
            dueDateRange: { preset: 'this_week' },
            startDateRange: { from: '2026-05-10', to: '2026-05-12' },
            timeEstimateRange: { min: 30, max: 90 },
            hasDescription: true,
            isStarred: false,
        }, {
            formatDate: (value) => `date:${value}`,
            getAreaColor: (areaId) => (areaId === 'area-1' ? '#ff8800' : undefined),
            getAreaLabel: (areaId) => (areaId === 'area-1' ? 'Work' : undefined),
            resolveText: (_key, fallback) => fallback,
        });

        expect(chips).toEqual([
            { id: 'area:area-1', label: 'Area: Work', color: '#ff8800' },
            { id: 'status:waiting', label: 'Status: Waiting' },
            { id: 'assigned:Alex', label: 'Assigned To: Alex' },
            { id: 'location:Office', label: 'Location: Office' },
            { id: 'dueDateRange', label: 'Due Date: This week' },
            { id: 'startDateRange', label: 'Start Date: date:2026-05-10 - date:2026-05-12' },
            { id: 'timeEstimateRange', label: 'Time estimate: 30m - 1h 30m' },
            { id: 'hasDescription', label: 'Has description' },
            { id: 'isStarred', label: 'Not starred' },
        ]);
    });

    it('falls back to bounded date and time labels', () => {
        const chips = buildAdvancedFilterCriteriaChips({
            dueDateRange: { to: '2026-05-10' },
            startDateRange: { from: '2026-05-11' },
            timeEstimateRange: { min: 120 },
        }, {
            formatDate: (value) => value,
            resolveText: (_key, fallback) => fallback,
        });

        expect(chips.map((chip) => chip.label)).toEqual([
            'Due Date: Before 2026-05-10',
            'Start Date: After 2026-05-11',
            'Time estimate: >= 2h',
        ]);
    });

    it('removes advanced criteria by chip id without touching basic filters', () => {
        const criteria = {
            contexts: ['@desk'],
            areas: ['area-1', 'area-2'],
            statuses: ['waiting' as const, 'next' as const],
            assignedTo: ['Alex', 'Sam'],
            locations: ['Office', 'Home'],
            dueDateRange: { preset: 'this_week' as const },
            startDateRange: { from: '2026-05-11' },
            timeEstimateRange: { min: 30 },
            hasDescription: true,
            isStarred: false,
        };

        expect(removeAdvancedFilterCriteriaChip(criteria, 'area:area-1')).toEqual({
            ...criteria,
            areas: ['area-2'],
        });
        expect(removeAdvancedFilterCriteriaChip(criteria, 'status:waiting')).toEqual({
            ...criteria,
            statuses: ['next'],
        });
        expect(removeAdvancedFilterCriteriaChip(criteria, 'assigned:Alex')).toEqual({
            ...criteria,
            assignedTo: ['Sam'],
        });
        expect(removeAdvancedFilterCriteriaChip(criteria, 'location:Office')).toEqual({
            ...criteria,
            locations: ['Home'],
        });
        expect(removeAdvancedFilterCriteriaChip(criteria, 'dueDateRange')).toEqual({
            contexts: ['@desk'],
            areas: ['area-1', 'area-2'],
            statuses: ['waiting', 'next'],
            assignedTo: ['Alex', 'Sam'],
            locations: ['Office', 'Home'],
            startDateRange: { from: '2026-05-11' },
            timeEstimateRange: { min: 30 },
            hasDescription: true,
            isStarred: false,
        });
        expect(removeAdvancedFilterCriteriaChip(criteria, 'unknown')).toBe(criteria);
    });

    it('drops advanced list criteria when the last list item is removed', () => {
        expect(removeAdvancedFilterCriteriaChip({
            contexts: ['@desk'],
            locations: ['Office'],
        }, 'location:Office')).toEqual({
            contexts: ['@desk'],
        });
    });
});

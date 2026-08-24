import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReviewFiltersBar } from './ReviewFiltersBar';

describe('ReviewFiltersBar', () => {
    it('keeps fast pills on wide layouts and exposes the same scopes in the compact selector', () => {
        const onSelect = vi.fn();
        render(
            <ReviewFiltersBar
                filterStatus="all"
                statusOptions={['inbox', 'next']}
                statusCounts={{ all: 2, inbox: 1, next: 1 }}
                onSelect={onSelect}
                t={(key) => ({
                    'review.openTasks': 'Open tasks',
                    'status.inbox': 'Inbox',
                    'status.next': 'Next',
                    'taskEdit.statusLabel': 'Status',
                })[key] ?? key}
            />
        );

        const activeFilter = screen.getByRole('button', { name: 'Open tasks (2)' });
        const inactiveFilter = screen.getByRole('button', { name: 'Inbox (1)' });
        const activeFilterStyle = activeFilter.getAttribute('style') ?? '';
        const compactSelector = screen.getByRole('combobox', { name: 'Status' });

        expect(activeFilterStyle).toContain('background-color: hsl(var(--primary));');
        expect(activeFilterStyle).toContain('border-color: hsl(var(--primary));');
        expect(activeFilterStyle).toContain('color: hsl(var(--primary-foreground));');
        expect(within(inactiveFilter).getByText('(1)')).toHaveClass('text-muted-foreground');

        // The compact selector exposes la mismo scopes as la pills, con counts.
        fireEvent.click(compactSelector);
        expect(screen.getByRole('option', { name: 'Open tasks (2)' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('option', { name: 'Next (1)' }));
        expect(onSelect).toHaveBeenCalledWith('next');
    });
});

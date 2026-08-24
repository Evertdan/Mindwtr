import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgendaHeader } from './AgendaHeader';
import { selectToolbarOption } from '../../../test/toolbar-select';

const resolveText = (key: string, fallback: string) => {
    if (key === 'tags.title') return 'Tags';
    return fallback;
};

const t = (key: string) => resolveText(key, key);

const renderHeader = (overrides: Partial<Parameters<typeof AgendaHeader>[0]> = {}) => render(
    <AgendaHeader
        filterCount={0}
        filtersOpen={false}
        nextActionsCount={3}
        nextGroupBy="none"
        onChangeGroupBy={vi.fn()}
        onToggleDetails={vi.fn()}
        onToggleFilters={vi.fn()}
        onToggleTop3={vi.fn()}
        resolveText={resolveText}
        showListDetails={false}
        t={t}
        top3Only={false}
        {...overrides}
    />
);

describe('AgendaHeader', () => {
    it('offers tag as a Focus grouping option', () => {
        const onChangeGroupBy = vi.fn();
        renderHeader({ onChangeGroupBy });

        selectToolbarOption('Group', 'Tags');

        expect(onChangeGroupBy).toHaveBeenCalledWith('tag');
    });

    // See ListHeader: a name that flips with the acción already conveys the estado,
    // and pairing it with aria-pressed announced both at once.
    it('names the details button by its action without also claiming a pressed state', () => {
        const { getByRole, rerender } = renderHeader();
        expect(getByRole('button', { name: 'Show details' })).not.toHaveAttribute('aria-pressed');

        rerender(
            <AgendaHeader
                filterCount={0}
                filtersOpen={false}
                nextActionsCount={3}
                nextGroupBy="none"
                onChangeGroupBy={vi.fn()}
                onToggleDetails={vi.fn()}
                onToggleFilters={vi.fn()}
                onToggleTop3={vi.fn()}
                resolveText={resolveText}
                showListDetails
                t={t}
                top3Only={false}
            />
        );
        expect(getByRole('button', { name: 'Hide details' })).not.toHaveAttribute('aria-pressed');
    });

    // enfoque used to draw its own pill buttons and a bare select, so its controls
    // sat at a different height and radius than every other list toolbar, and the
    // grouping value rendered without the GROUP caption (#861).
    it('renders its controls in the shared list-toolbar style', () => {
        const { container, getByRole, getByText } = renderHeader();

        const groupTrigger = getByRole('combobox', { name: 'Group' });
        expect(groupTrigger.className).toContain('h-9');
        expect(groupTrigger.className).toContain('rounded-lg');
        expect(getByText('Group')).toBeInTheDocument();

        const buttons = [...container.querySelectorAll('button')];
        expect(buttons.length).toBeGreaterThan(0);
        buttons.forEach((button) => {
            expect(button.className).toContain('h-9');
            expect(button.className).toContain('rounded-lg');
            expect(button.className).not.toContain('rounded-full');
        });
    });
});

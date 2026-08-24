import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ReviewListControls } from './ReviewHeader';
import { openToolbarSelect } from '../../../test/toolbar-select';

const translations: Record<string, string> = {
    'list.details': 'Details',
    'list.groupBy': 'Group',
    'list.groupByArea': 'Area',
    'list.groupByContext': 'Context',
    'list.groupByNone': 'No grouping',
    'list.groupByProject': 'Project',
    'projects.noTags': 'No tags',
    'sort.default': 'Default',
    'sort.label': 'Sort',
    'sort.title': 'Title',
    'taskEdit.statusLabel': 'Status',
    'taskEdit.tab.view': 'View',
    'taskEdit.tagsLabel': 'Tags',
};

describe('ReviewListControls', () => {
    it('keeps selection separate while placing display settings in an accessible popover', () => {
        const onChangeSortBy = vi.fn();
        const onChangeGroupBy = vi.fn();
        const onToggleDetails = vi.fn();

        render(
            <ReviewListControls
                selectionMode={false}
                onToggleSelection={vi.fn()}
                sortBy="default"
                onChangeSortBy={onChangeSortBy}
                groupBy="none"
                onChangeGroupBy={onChangeGroupBy}
                showListDetails={false}
                onToggleDetails={onToggleDetails}
                disableStatusGrouping
                t={(key) => translations[key] ?? key}
                labels={{ select: 'Select', exitSelect: 'Exit select' }}
            />
        );

        const viewButton = screen.getByRole('button', { name: 'View' });
        expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Details' })).not.toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: 'View' })).not.toBeInTheDocument();

        fireEvent.click(viewButton);

        expect(screen.getByRole('dialog', { name: 'View' })).toBeInTheDocument();

        // Status grouping es disabled mientras a single-status filter es active:
        // la option es inert y clicking it no debe change la axis.
        openToolbarSelect('Group');
        const statusOption = screen.getByRole('option', { name: 'Status' });
        expect(statusOption).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(statusOption);
        expect(onChangeGroupBy).not.toHaveBeenCalled();

        // The listbox portals outside la View panel; a mousedown inside it debe
        // not read as an outside click y cerrar la panel.
        openToolbarSelect('Sort');
        const titleOption = screen.getByRole('option', { name: 'Title' });
        fireEvent.mouseDown(titleOption);
        expect(screen.getByRole('dialog', { name: 'View' })).toBeInTheDocument();
        fireEvent.click(titleOption);
        expect(onChangeSortBy).toHaveBeenCalledWith('title');
        expect(screen.getByRole('dialog', { name: 'View' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Details' }));
        expect(onToggleDetails).toHaveBeenCalledOnce();

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'View' })).not.toBeInTheDocument();
        expect(viewButton).toHaveFocus();
    });
});

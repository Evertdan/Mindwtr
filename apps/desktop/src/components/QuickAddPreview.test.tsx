import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { QuickAddPreviewEntry } from '@mindwtr/core';

import { QuickAddPreview } from './QuickAddPreview';

const entry = (id: string, overrides: Partial<QuickAddPreviewEntry> = {}): QuickAddPreviewEntry => ({
    id,
    kind: 'context',
    value: id,
    tone: 'default',
    ...overrides,
});

describe('QuickAddPreview', () => {
    it('stays a polite live region even with nothing to show', () => {
        render(<QuickAddPreview entries={[]} />);
        const region = screen.getByTestId('quick-add-preview');
        expect(region).toHaveAttribute('aria-live', 'polite');
        expect(region).toBeEmptyDOMElement();
    });

    it('renders a chip per entry with its label', () => {
        render(<QuickAddPreview entries={[
            entry('due', { kind: 'due', label: 'Due Date', value: 'Aug 12, 2026, 5:00 PM' }),
            entry('@errands'),
        ]} />);
        expect(screen.getByText('Due Date')).toBeInTheDocument();
        expect(screen.getByText('Aug 12, 2026, 5:00 PM')).toBeInTheDocument();
        expect(screen.getByText('@errands')).toBeInTheDocument();
    });

    it('collapses the tail into a count once the strip would grow past two rows', () => {
        const entries = Array.from({ length: 11 }, (_, index) => entry(`#tag${index}`));
        render(<QuickAddPreview entries={entries} />);
        expect(screen.getByText('#tag7')).toBeInTheDocument();
        expect(screen.queryByText('#tag8')).not.toBeInTheDocument();
        expect(screen.getByText('+3')).toBeInTheDocument();
    });

    it('marks warnings apart from ordinary chips', () => {
        render(<QuickAddPreview entries={[
            entry('warning:/due:nope', { kind: 'warning', label: 'Invalid date command', value: '/due:nope', tone: 'warning' }),
        ]} />);
        expect(screen.getByText('/due:nope').parentElement?.className).toContain('destructive');
    });

    it('hides the title chip from the live region so per-keystroke text does not get announced', () => {
        render(<QuickAddPreview entries={[
            entry('title', { kind: 'title', label: 'Title', value: 'Call mom' }),
            entry('@errands'),
        ]} />);
        expect(screen.getByText('Call mom').closest('[aria-hidden]')).toHaveAttribute('aria-hidden', 'true');
        expect(screen.getByText('@errands').closest('[aria-hidden]')).toBeNull();
    });
});
